import { useEffect, useReducer, useRef, useState } from 'react';
import type { Area } from '../../lib/kb/areas';
import type { EntryLanguage } from '../../lib/kb/entry';
import { canSpeak, initial, next, type View } from '../../lib/kb/flow';
import type { ReplySetting } from '../../lib/kb/hearing';
import type { SearchResponse } from '../../lib/kb/search';
import { connectLive, LiveUnavailable, type LiveLink } from '../../lib/live-client';
import { micFailure } from '../../lib/mic';
import { commentaryFor } from '../../lib/routes/live';
import { blobToBase64, pickMimeType } from '../../lib/record';
import { createSilenceGate, rms } from '../../lib/silence';
import KbScreen from './KbScreen';

const VOICE: Record<EntryLanguage, string> = { en: 'en-SG', 'zh-Hans': 'zh-SG' };

/** The route's own voice while it plays, so a new line or a tap can cut it off. */
let playing: HTMLAudioElement | null = null;
let speechTurn = 0;

function phoneSay(text: string, language: EntryLanguage): void {
	if (typeof speechSynthesis === 'undefined') return;
	speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(text);
	u.lang = VOICE[language];
	// Slower than default: comprehension, not throughput, is the constraint.
	u.rate = 0.85;
	speechSynthesis.speak(u);
}

function silence(): void {
	speechTurn += 1;
	if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
	playing?.pause();
	playing = null;
}

/**
 * Speak in the route's voice (`/api/speak`); the phone's voice when the route has none
 * (204) or the call fails, so a reader always hears the line.
 */
async function routeSay(text: string, language: EntryLanguage, route: string): Promise<void> {
	silence();
	const turn = speechTurn;
	try {
		const res = await fetch('/api/speak', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: text.slice(0, 1000), language, route }),
		});
		if (turn !== speechTurn) return;
		if (res.status !== 200) return phoneSay(text, language);
		const url = URL.createObjectURL(await res.blob());
		if (turn !== speechTurn) return URL.revokeObjectURL(url);
		const audio = new Audio(url);
		audio.onended = () => URL.revokeObjectURL(url);
		playing = audio;
		await audio.play();
	} catch {
		if (turn === speechTurn) phoneSay(text, language);
	}
}

/** Loudness readings from the open microphone, about ten a second. */
function watchLevel(stream: MediaStream, onLevel: (level: number, now: number) => void): () => void {
	const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctx) return () => {};
	const ctx = new Ctx();
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 1024;
	ctx.createMediaStreamSource(stream).connect(analyser);
	const buf = new Float32Array(analyser.fftSize);
	const timer = setInterval(() => {
		analyser.getFloatTimeDomainData(buf);
		onLevel(rms(buf), performance.now());
	}, 100);
	return () => {
		clearInterval(timer);
		void ctx.close();
	};
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
	stopWatching: () => void;
	/** Whether the silence gate heard speech; a recording with none is not sent. */
	heardSpeech: () => boolean;
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
	/** Loudness for the waveform: only while the microphone is open, ten times a second. */
	const [level, setLevel] = useState(0);
	const [finding, setFinding] = useState(false);
	const recording = useRef<Recording | null>(null);
	const live = useRef<LiveLink | null>(null);
	const isLive = route === 'openai-live';
	const last = useRef<LastQuery | null>(null);
	const say = (text: string, language: EntryLanguage) => void routeSay(text, language, route);
	/** The latest finish function, so the silence timer never calls a stale closure. */
	const finishRef = useRef<(auto: 'done' | 'nothing' | 'tap') => void>(() => {});

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
			recording.current?.stopWatching();
			recording.current?.stream.getTracks().forEach((t) => t.stop());
			live.current?.close();
			silence();
		},
		[],
	);

	/** End the recording: by a tap, after 3 s of quiet following speech, or with no speech at all. */
	async function finish(how: 'done' | 'nothing' | 'tap'): Promise<void> {
		const current = recording.current;
		if (!current) return;
		recording.current = null;
		current.stopWatching();
		const stopped = new Promise<void>((resolve) => (current.rec.onstop = () => resolve()));
		current.rec.stop();
		await stopped;
		current.stream.getTracks().forEach((t) => t.stop());

		if (how === 'nothing' || (how === 'tap' && !current.heardSpeech() && current.chunks.length === 0)) {
			dispatch({ type: 'SILENCE' });
			return;
		}
		dispatch({ type: 'STOP' });
		try {
			const type = current.rec.mimeType || current.mimeType || 'audio/webm';
			const reply = await post({ kind: 'speech', audioBase64: await blobToBase64(new Blob(current.chunks, { type })), mimeType: type });
			if (reply.kind === 'results') last.current = { kind: 'text', query: reply.result.query, heard: reply.result.heard };
			show(reply);
		} catch {
			dispatch({ type: 'FAIL' });
		}
	}
	finishRef.current = (how) => void finish(how);

	/**
	 * GPT-Live: one continuous session. It decides when a turn ended and speaks the answer
	 * we hand back, so there is no silence gate and no reply from the phone's voice.
	 */
	async function openLive(): Promise<void> {
		dispatch({ type: 'PRESS' });
		try {
			live.current = await connectLive({
				onTranscript: () => {},
				onRequest: async ({ said, answer }) => {
					// GPT-Live can delegate on a fragment it half heard. Searching those words
					// wastes a turn and shows cards for nothing.
					if (said.trim().length < 12) {
						answer('Sorry, could you say that again?');
						return;
					}
					dispatch({ type: 'ASKING' });
					try {
						const heard = { short: said.slice(0, 40), sentence: said, said };
						const reply = await post({ kind: 'text', query: said, heard });
						if (reply.kind === 'results') last.current = { kind: 'text', query: reply.result.query, heard };
						show(reply, { spoken: true });
						answer(
							reply.kind === 'results'
								? commentaryFor(reply.result, reply.result.language)
								: reply.kind === 'greeting'
									? 'Hello. Ask me about health costs, CPF or your Singpass.'
									: 'That is not in Suara yet. Ask again in another way.',
						);
					} catch {
						dispatch({ type: 'FAIL' });
						answer('Sorry, I could not reach the answers just now.');
					}
				},
				onClosed: () => {
					live.current = null;
					dispatch({ type: 'HOME' });
				},
				onError: () => dispatch({ type: 'FAIL' }),
			});
			dispatch({ type: 'GRANTED' });
		} catch (err) {
			live.current = null;
			dispatch(
				err instanceof LiveUnavailable
					? { type: 'FAIL' }
					: { type: 'DENIED', reason: micFailure(err, window.isSecureContext) },
			);
		}
	}

	async function post(body: Record<string, unknown>): Promise<SearchResponse> {
		const res = await fetch('/api/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...body, reply: setting, route }),
		});
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as SearchResponse;
	}

	/** `spoken` means the route is already saying it aloud, so the phone stays quiet. */
	function show(reply: SearchResponse, opts: { spoken?: boolean } = {}): void {
		const tell = (text: string, language: EntryLanguage) => {
			if (!opts.spoken) say(text, language);
		};
		if (reply.kind === 'silence') {
			dispatch({ type: 'SILENCE' });
			tell(reply.language === 'zh-Hans' ? '我没听到。请点一下再说。' : "I didn't hear you. Tap and try again.", reply.language);
			return;
		}
		if (reply.kind === 'journey') {
			dispatch({ type: 'JOURNEY', result: reply });
			tell(`${reply.journey.title.full}. ${reply.journey.summary}`, reply.language);
			return;
		}
		if (reply.kind === 'places') {
			dispatch({ type: 'PLACES', result: reply });
			const first = reply.places[0];
			if (first) {
				const zh = reply.language === 'zh-Hans';
				tell(zh ? `最近的是${first.name}。` : `The nearest one is ${first.name}.`, reply.language);
			}
			return;
		}
		if (reply.kind === 'greeting') {
			dispatch({ type: 'GREETING' });
			tell(reply.language === 'zh-Hans' ? '您好！您需要什么帮助？' : 'Hello! What do you need?', reply.language);
			return;
		}
		if (reply.kind === 'nothing') {
			dispatch({ type: 'NOTHING', heard: reply.heard });
			tell(reply.language === 'zh-Hans' ? 'Suara 还没有这个答案。' : 'That is not in Suara yet.', reply.language);
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
		tell(`${lead} ${top.title.full}. ${top.summary.text}`, top.language);
	}

	async function onSpeak(): Promise<void> {
		if (isLive) {
			// One tap opens the session and keeps it open; the next tap ends it.
			if (live.current) {
				live.current.close();
				live.current = null;
				dispatch({ type: 'HOME' });
				return;
			}
			silence();
			await openLive();
			return;
		}

		if (state.phase === 'listening') {
			await finish('tap');
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
			const gate = createSilenceGate();
			let ended = false;
			const stopWatching = watchLevel(stream, (loudness, now) => {
				setLevel(loudness);
				const verdict = gate.push(loudness, now);
				if (verdict !== 'listen' && !ended) {
					ended = true;
					finishRef.current(verdict);
				}
			});
			recording.current = { rec, stream, mimeType, chunks, stopWatching, heardSpeech: () => gate.heardSpeech };
			rec.start();
			dispatch({ type: 'GRANTED' });
		} catch (err) {
			dispatch({ type: 'DENIED', reason: micFailure(err, window.isSecureContext) });
		}
	}

	/*
	 * Choosing a found card asks for it in words, rather than jumping straight to one card:
	 * the neighbours around it are usually why somebody was looking, and the screen then
	 * behaves exactly as it does after a spoken question.
	 */
	async function onFound(_id: string, label: string): Promise<void> {
		silence();
		const heard = { short: label.slice(0, 40), sentence: label };
		dispatch({ type: 'ASKING' });
		try {
			last.current = { kind: 'text', query: label, heard };
			show(await post({ kind: 'text', query: label, heard, offset: 0 }));
		} catch {
			dispatch({ type: 'FAIL' });
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

	// Ctrl+K and Cmd+K, the shortcut anyone who types expects. It is never the only way in:
	// the header carries a Find control at the same size as everything else.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
			event.preventDefault();
			setFinding((was) => !was);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

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
			level={level}
			finding={finding}
			onFind={() => setFinding(true)}
			onFindClose={() => setFinding(false)}
			onFound={onFound}
		/>
	);
}
