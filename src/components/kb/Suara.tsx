import { useEffect, useReducer, useRef, useState } from 'react';
import type { Area } from '../../lib/kb/areas';
import type { EntryLanguage } from '../../lib/kb/entry';
import { canSpeak, initial, next, type View } from '../../lib/kb/flow';
import type { ReplySetting } from '../../lib/kb/hearing';
import type { SearchResponse } from '../../lib/kb/search';
import { micFailure } from '../../lib/mic';
import { blobToBase64, pickMimeType } from '../../lib/record';
import KbScreen from './KbScreen';

const VOICE: Record<EntryLanguage, string> = { en: 'en-SG', 'zh-Hans': 'zh-SG' };

function say(text: string, language: EntryLanguage): void {
	if (typeof speechSynthesis === 'undefined') return;
	speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(text);
	u.lang = VOICE[language];
	// Slower than default: comprehension, not throughput, is the constraint.
	u.rate = 0.85;
	speechSynthesis.speak(u);
}

function silence(): void {
	if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/** Per-phone conveniences. Storage can be missing or throw; the page works without it. */
function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
	try {
		const v = localStorage.getItem(key);
		return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
	} catch {
		return fallback;
	}
}
function store(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* private window: not remembered */
	}
}

type LastQuery = { kind: 'text'; query: string; heard: { short: string; sentence: string } } | { kind: 'topic'; area: Area };

interface Recording {
	rec: MediaRecorder;
	stream: MediaStream;
	mimeType: string;
	chunks: Blob[];
}

/**
 * The driver for the knowledge-base screens: microphone, network and speech. Every pixel
 * is in `KbScreen.tsx`, every transition in `lib/kb/flow.ts`.
 */
export default function Suara({ route, routeLabel }: { route: string; routeLabel: string }) {
	const [state, dispatch] = useReducer(next, 'grid' as View, initial);
	const [setting, setSetting] = useState<ReplySetting>('en');
	const [englishIds, setEnglishIds] = useState<string[]>([]);
	const [loadingMore, setLoadingMore] = useState(false);
	const recording = useRef<Recording | null>(null);
	const last = useRef<LastQuery | null>(null);

	// Restore the remembered view and language after hydration, so server and client agree.
	useEffect(() => {
		setSetting(stored('suara.lang', ['en', 'zh-Hans', 'auto'] as const, 'en'));
		dispatch({ type: 'VIEW', view: stored('suara.view', ['grid', 'single'] as const, 'grid') });
	}, []);

	useEffect(() => store('suara.view', state.view), [state.view]);

	// Read the open step aloud as it arrives.
	const stepKey = state.phase === 'steps' ? `${state.entry.id}:${state.index}` : '';
	useEffect(() => {
		if (state.phase !== 'steps') return;
		const step = state.entry.steps?.[state.index];
		if (step) say(`${step.name}. ${step.text}`, state.entry.language);
	}, [stepKey]);

	useEffect(
		() => () => {
			recording.current?.stream.getTracks().forEach((t) => t.stop());
			silence();
		},
		[],
	);

	async function post(body: Record<string, unknown>): Promise<SearchResponse> {
		const res = await fetch('/api/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...body, reply: setting, route }),
		});
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as SearchResponse;
	}

	function show(reply: SearchResponse): void {
		if (reply.kind === 'greeting') {
			dispatch({ type: 'GREETING' });
			say(reply.language === 'zh-Hans' ? '您好！您需要什么帮助？' : 'Hello! What do you need?', reply.language);
			return;
		}
		if (reply.kind === 'nothing') {
			dispatch({ type: 'NOTHING', heard: reply.heard });
			say(reply.language === 'zh-Hans' ? 'Suara 还没有这个答案。' : 'That is not in Suara yet.', reply.language);
			return;
		}
		setEnglishIds(reply.englishIds);
		dispatch({ type: 'RESULTS', result: reply.result });
		const top = reply.result.cards[0];
		if (!top) return;
		const zh = reply.result.language === 'zh-Hans';
		const lead =
			reply.result.fit === 'weak'
				? zh ? '最接近的答案是' : 'The closest I have is'
				: zh ? '最符合的是' : 'Best match:';
		say(`${lead} ${top.title.full}. ${top.summary.text}`, top.language);
	}

	async function onSpeak(): Promise<void> {
		if (state.phase === 'listening') {
			const current = recording.current;
			if (!current) return;
			dispatch({ type: 'STOP' });
			try {
				const stopped = new Promise<void>((resolve) => (current.rec.onstop = () => resolve()));
				current.rec.stop();
				await stopped;
				current.stream.getTracks().forEach((t) => t.stop());
				recording.current = null;
				const type = current.rec.mimeType || current.mimeType || 'audio/webm';
				const reply = await post({ kind: 'speech', audioBase64: await blobToBase64(new Blob(current.chunks, { type })), mimeType: type });
				if (reply.kind === 'results') last.current = { kind: 'text', query: reply.result.query, heard: reply.result.heard };
				show(reply);
			} catch {
				dispatch({ type: 'FAIL' });
			}
			return;
		}

		if (!canSpeak(state)) return;
		silence();
		dispatch({ type: 'PRESS' });
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true } });
			const mimeType = pickMimeType();
			const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
			const chunks: Blob[] = [];
			rec.ondataavailable = (e) => chunks.push(e.data);
			recording.current = { rec, stream, mimeType, chunks };
			rec.start();
			dispatch({ type: 'GRANTED' });
		} catch (err) {
			dispatch({ type: 'DENIED', reason: micFailure(err, window.isSecureContext) });
		}
	}

	async function onTopic(area: Area): Promise<void> {
		silence();
		dispatch({ type: 'TOPIC', area });
		try {
			last.current = { kind: 'topic', area };
			show(await post({ kind: 'topic', area, offset: 0 }));
		} catch {
			dispatch({ type: 'FAIL' });
		}
	}

	async function onMore(): Promise<void> {
		if (state.phase !== 'results' || state.result.nextOffset === null || !last.current) return;
		setLoadingMore(true);
		try {
			const offset = state.result.nextOffset;
			const q = last.current;
			const reply = await post(q.kind === 'topic' ? { kind: 'topic', area: q.area, offset } : { kind: 'text', query: q.query, heard: q.heard, offset });
			if (reply.kind === 'results') {
				setEnglishIds((ids) => [...ids, ...reply.englishIds]);
				dispatch({ type: 'MORE', cards: reply.result.cards, nextOffset: reply.result.nextOffset });
			}
		} catch {
			/* The cards already shown stay; the button can be pressed again. */
		} finally {
			setLoadingMore(false);
		}
	}

	function onLanguage(next: ReplySetting): void {
		setSetting(next);
		store('suara.lang', next);
	}

	return (
		<KbScreen
			state={state}
			setting={setting}
			englishIds={englishIds}
			loadingMore={loadingMore}
			dispatch={dispatch}
			onSpeak={onSpeak}
			onMore={onMore}
			onTopic={onTopic}
			onSay={say}
			onLanguage={onLanguage}
			routeLabel={routeLabel}
		/>
	);
}
