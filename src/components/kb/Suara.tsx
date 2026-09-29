import { useEffect, useReducer, useRef, useState } from 'react';
import type { Area } from '../../lib/kb/areas';
import type { EntryLanguage } from '../../lib/kb/entry';
import { canSpeak, initial, next, type Heard, type View } from '../../lib/kb/flow';
import type { ReplySetting } from '../../lib/kb/hearing';
import type { SearchResponse } from '../../lib/kb/search';
import { webAllowed, type WebAnswer, type WebStage } from '../../lib/kb/web-answer';
import { connectLive, LiveUnavailable, type LiveLink } from '../../lib/live-client';
import { micFailure } from '../../lib/mic';
import { commentaryFor } from '../../lib/routes/live';
import { bytesToBase64, encodeWav } from '../../lib/wav';
import { ensureSession } from '../../lib/session-client';
import { createSilenceGate, EARLY_MS, rms } from '../../lib/silence';
import { chartHeadline } from './ChartCard';
import { readBack } from '../../lib/kb/readback';
import type { StepContext, Turn } from '../../lib/kb/thread';
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
	// Pausing is not enough while a line still streams in: dropping its source stops the download.
	if (playing) {
		playing.pause();
		playing.removeAttribute('src');
		playing.load();
	}
	playing = null;
}

/**
 * Speak in the route's voice (`/api/speak`); the phone's voice when the route has none
 * (204) or the call fails, so a reader always hears the line.
 */
async function routeSay(text: string, language: EntryLanguage, route: string): Promise<void> {
	silence();
	const turn = speechTurn;
	// An audio element cannot go through the page's fetch, so it waits for the session here.
	await ensureSession().catch(() => {});
	if (turn !== speechTurn) return;
	// Played as it arrives (GET, plan-suara-0021, L5), instead of after the whole clip is fetched.
	// No voice on the route (204) or a failure is an error on the element: the phone speaks.
	const audio = new Audio(`/api/speak?${new URLSearchParams({ text: text.slice(0, 1000), language, route })}`);
	const fallBack = () => {
		if (turn === speechTurn) phoneSay(text, language);
	};
	audio.onerror = fallBack;
	playing = audio;
	try {
		await audio.play();
	} catch {
		if (playing === audio) fallBack();
	}
}

/**
 * Loudness readings from the open microphone, about ten a second. The analyser is also handed
 * to the listening screen, which reads its frequency bands every frame to draw the wave.
 */
function watchLevel(
	stream: MediaStream,
	onLevel: (level: number, now: number) => void,
	onAnalyser?: (a: AnalyserNode | null) => void,
	onSamples?: (block: Float32Array, rate: number) => void,
): () => void {
	const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctx) return () => {};
	const ctx = new Ctx();
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 1024;
	const source = ctx.createMediaStreamSource(stream);
	source.connect(analyser);
	onAnalyser?.(analyser);
	// The recording itself, as samples (lib/wav.ts): a processor must reach the destination to
	// run, and it writes silence there, so nothing is heard.
	if (onSamples) {
		const processor = ctx.createScriptProcessor(4096, 1, 1);
		processor.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate);
		source.connect(processor);
		processor.connect(ctx.destination);
	}
	const buf = new Float32Array(analyser.fftSize);
	const timer = setInterval(() => {
		analyser.getFloatTimeDomainData(buf);
		onLevel(rms(buf), performance.now());
	}, 100);
	return () => {
		clearInterval(timer);
		onAnalyser?.(null);
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

const NOT_IN: Record<EntryLanguage, string> = { en: 'That is not in Suara yet.', 'zh-Hans': 'Suara 还没有这个答案。' };
const NO_WEB: Record<EntryLanguage, string> = { en: 'I could not reach the web just now.', 'zh-Hans': '现在连不上网络。' };
const NOT_ON_WEB: Record<EntryLanguage, string> = {
	en: 'I could not find a reliable answer on the web either.',
	'zh-Hans': '我在网上也找不到可靠的答案。',
};

/** What is said aloud when a web answer arrives: one sentence, then the screen carries the rest. */
function webLine(a: WebAnswer): string {
	return a.kind === 'steps' ? `${a.title_full}. ${a.summary}` : a.summary;
}

/** `/api/web`: one JSON object per line, a stage at a time, then the answer or an error. */
async function fetchWeb(question: string, query: string | undefined, language: EntryLanguage, route: string, onStage: (s: WebStage) => void, signal: AbortSignal): Promise<WebAnswer | null> {
	const res = await fetch('/api/web', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		// `query`: the English meaning Suara searched, which the answer is kept under for next time.
		body: JSON.stringify({ question, language, route, ...(query ? { query } : {}) }),
		signal,
	});
	if (!res.ok || !res.body) throw new Error(String(res.status));
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (value) buf += decoder.decode(value, { stream: true });
		let cut: number;
		while ((cut = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, cut).trim();
			buf = buf.slice(cut + 1);
			if (!line) continue;
			const msg = JSON.parse(line) as { type: 'stage' } & WebStage | { type: 'answer'; answer: WebAnswer } | { type: 'error' };
			if (msg.type === 'answer') return msg.answer;
			if (msg.type === 'error') throw new Error('web search failed');
			const { type: _t, ...stage } = msg;
			onStage(stage as WebStage);
		}
		if (done) throw new Error('the web search ended without an answer');
	}
}

type LastQuery ={ kind: 'text'; query: string; heard: { short: string; sentence: string } } | { kind: 'topic'; area: Area };

interface Recording {
	stream: MediaStream;
	/** The microphone's samples so far, and their rate; sent as WAV (lib/wav.ts). */
	blocks: Float32Array[];
	rate: number;
	stopWatching: () => void;
	/** Whether the silence gate heard speech; a recording with none is not sent. */
	heardSpeech: () => boolean;
	/** When speech was last heard, from the silence gate. */
	lastSpeech: () => number | null;
	/** The question sent early, at 1.5 s of quiet, if any (plan-suara-0021, L1). */
	early: Early | null;
}

/** What has been recorded so far, as base64 WAV. */
const wavOf = (r: Recording) => bytesToBase64(encodeWav(r.blocks.slice(), r.rate));

/**
 * A question sent while the person may still be talking: `at` is the moment of speech it was
 * cut after. If speech is heard again, it is recalled and the turn goes on as before.
 */
interface Early {
	at: number;
	reply: Promise<SearchResponse | null>;
	abort: AbortController;
	/** Their words, once the server has heard them: shown when this question is kept. */
	said?: string;
	/** Set when the question is kept, so words heard after that go to the screen. */
	onHeard?: (said: string) => void;
}

/**
 * The driver for the knowledge-base screens: microphone, network and speech. Every pixel
 * is in `KbScreen.tsx`, every transition in `lib/kb/flow.ts`.
 */
export default function Suara({ route, routeLabel }: { route: string; routeLabel?: string }) {
	const [state, dispatch] = useReducer(next, 'single' as View, initial);
	const [setting, setSetting] = useState<ReplySetting>('en');
	const [englishIds, setEnglishIds] = useState<string[]>([]);
	const [loadingMore, setLoadingMore] = useState(false);
	/** Loudness for the waveform: only while the microphone is open, ten times a second. */
	const [level, setLevel] = useState(0);
	const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
	const [finding, setFinding] = useState(false);
	const recording = useRef<Recording | null>(null);
	const live = useRef<LiveLink | null>(null);
	const isLive = route === 'openai-live';
	/** The web search in flight; a new question cancels it. */
	const web = useRef<AbortController | null>(null);
	const canWeb = webAllowed(route);
	const last = useRef<LastQuery | null>(null);
	/**
	 * The question on screen and its corrections, oldest first (lib/kb/thread.ts). A new question
	 * starts it again; a correction is sent with it and then joins it.
	 */
	const thread = useRef<Turn[]>([]);
	/** The next recording is a spoken correction of the question on screen. */
	const correcting = useRef(false);
	/** The step the next question is about, from "Ask about this step" (plan-suara-0020, C1). Sent once. */
	const askContext = useRef<StepContext | null>(null);
	/** The step last read aloud, so coming back to it from its question does not read it again. */
	const spokenStep = useRef('');
	const say = (text: string, language: EntryLanguage) => void routeSay(text, language, route);
	/** The latest finish function, so the silence timer never calls a stale closure. */
	const finishRef = useRef<(auto: 'done' | 'nothing' | 'tap') => void>(() => {});

	// Restore the remembered view and language after hydration, so server and client agree.
	useEffect(() => {
		setSetting(stored('suara.lang', ['en', 'zh-Hans', 'auto'] as const, 'en'));
		dispatch({ type: 'VIEW', view: stored('suara.view', ['grid', 'single'] as const, 'single') });
	}, []);

	useEffect(() => store('suara.view', state.view), [state.view]);

	// Read the open step aloud as it arrives, from Suara or from the web.
	const stepKey =
		state.phase === 'steps' ? `${state.entry.id}:${state.index}` : state.phase === 'web-steps' ? `web:${state.back.result.answer.title_full}:${state.index}` : '';
	useEffect(() => {
		if (!stepKey) {
			// Asking about the step keeps it in mind; leaving the guide forgets it.
			if (!state.guide) spokenStep.current = '';
			return;
		}
		if (stepKey === spokenStep.current) return;
		spokenStep.current = stepKey;
		if (state.phase === 'web-steps') {
			const step = state.back.result.answer.steps[state.index];
			if (step) say(`${step.name}. ${step.text}`, state.back.result.language);
			return;
		}
		if (state.phase !== 'steps') return;
		const step = state.entry.steps?.[state.index];
		if (step) say(`${step.name}. ${step.text}`, state.entry.language);
	}, [stepKey, state.guide]);

	useEffect(
		() => () => {
			recording.current?.stopWatching();
			recording.current?.stream.getTracks().forEach((t) => t.stop());
			live.current?.close();
			web.current?.abort();
			silence();
		},
		[],
	);

	// Leaving the search screen (Home, a topic, a new question) cancels the search, so a late
	// answer is never read aloud over whatever they moved on to.
	useEffect(() => {
		if (state.phase !== 'web-searching') web.current?.abort();
	}, [state.phase]);

	/**
	 * Nothing in Suara answered: search the web, showing each stage as it happens. Returns the
	 * answer, or null when there was none or the search failed, which leaves "not in Suara".
	 */
	async function searchTheWeb(heard: Heard, language: EntryLanguage, opts: { spoken?: boolean; fromClosest?: boolean; query?: string } = {}): Promise<WebAnswer | null> {
		web.current?.abort();
		const controller = new AbortController();
		web.current = controller;
		dispatch({ type: 'WEB_SEARCH', heard, language });
		try {
			// A question about a step searches the question it stands for, not "which hospital ah?".
			const question = heard.about && opts.query ? opts.query : heard.said ?? heard.sentence;
			const answer = await fetchWeb(question, opts.query, language, route, (stage) => dispatch({ type: 'WEB_STAGE', stage }), controller.signal);
			if (controller.signal.aborted) return null;
			if (!answer) throw new Error('no answer');
			dispatch({ type: 'WEB_ANSWER', answer });
			if (!opts.spoken) say(readBack(heard, language, answer.kind === 'none' ? NOT_ON_WEB[language] : webLine(answer)), language);
			return answer.kind === 'none' ? null : answer;
		} catch {
			if (controller.signal.aborted) return null;
			dispatch({ type: 'NOTHING', heard });
			if (!opts.spoken) say(readBack(heard, language, opts.fromClosest ? NO_WEB[language] : NOT_IN[language]), language);
			return null;
		} finally {
			if (web.current === controller) web.current = null;
		}
	}

	/** End the recording: by a tap, after 3 s of quiet following speech, or with no speech at all. */
	async function finish(how: 'done' | 'nothing' | 'tap'): Promise<void> {
		const current = recording.current;
		if (!current) return;
		recording.current = null;
		current.stopWatching();
		current.stream.getTracks().forEach((t) => t.stop());

		if (how === 'nothing' || (how === 'tap' && !current.heardSpeech() && current.blocks.length === 0)) {
			current.early?.abort.abort();
			dispatch({ type: 'SILENCE' });
			return;
		}
		dispatch({ type: 'STOP' });
		try {
			const isCorrection = correcting.current && thread.current.length > 0;
			// The question sent early stands if nothing was said after it: its answer is already
			// on its way, often here (plan-suara-0021, L1). Otherwise it is recalled.
			const kept = current.early && current.early.at === current.lastSpeech() ? current.early : null;
			if (!kept) current.early?.abort.abort();
			// Their words may already be heard; show them while the answer finishes (L2).
			if (kept?.said) dispatch({ type: 'HEARD', said: kept.said });
			if (kept) kept.onHeard = (said) => dispatch({ type: 'HEARD', said });
			const early = kept ? await kept.reply : null;
			const reply = early ?? (await post(speechBody(wavOf(current)), undefined, (said) => dispatch({ type: 'HEARD', said })));
			correcting.current = false;
			askContext.current = null;
			remember(reply, 'speech', isCorrection);
			if (reply.kind === 'results') last.current = { kind: 'text', query: reply.result.query, heard: reply.result.heard };
			show(reply, { asked: true });
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
						const context = askContext.current;
						askContext.current = null;
						const reply = await post({ kind: 'text', query: said, heard, ...(context ? { context } : {}) });
						if (reply.kind === 'results') last.current = { kind: 'text', query: reply.result.query, heard };
						// Nothing in Suara: GPT-Live waits while the web is searched, then says the one line.
						if ((reply.kind === 'nothing' || (reply.kind === 'results' && reply.webFirst)) && canWeb) {
							if (reply.kind === 'results') dispatch({ type: 'RESULTS', result: reply.result });
							const asked = reply.kind === 'results' ? reply.result : reply;
							const found = await searchTheWeb(asked.heard, asked.language, { spoken: true, fromClosest: reply.kind === 'results', ...(asked.query ? { query: asked.query } : {}) });
							answer(found ? webLine(found) : asked.language === 'zh-Hans' ? NOT_ON_WEB['zh-Hans'] : 'That is not in Suara, and I could not find a reliable answer on the web.');
							return;
						}
						show(reply, { spoken: true });
						answer(
							reply.kind === 'web'
								? webLine(reply.answer)
								: reply.kind === 'chart'
								? chartHeadline({ chart: reply.chart, heard: reply.heard, data: reply.data, focus: reply.focus, language: reply.language })
								: reply.kind === 'results'
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

	/** A spoken question as sent: the recording, and the thread or step it goes with. Read, not cleared. */
	function speechBody(audioBase64: string): Record<string, unknown> {
		const isCorrection = correcting.current && thread.current.length > 0;
		const context = askContext.current;
		return { kind: 'speech', audioBase64, mimeType: 'audio/wav', ...(isCorrection ? { thread: thread.current } : {}), ...(context ? { context } : {}) };
	}

	/** Send what has been said so far, while still listening; null if it is recalled or fails. */
	function sendEarly(current: Recording, at: number): Early {
		const abort = new AbortController();
		const early: Early = { at, abort, reply: Promise.resolve(null) };
		early.reply = (async () => {
			try {
				return await post(speechBody(wavOf(current)), abort.signal, (said) => {
					early.said = said;
					early.onHeard?.(said);
				});
			} catch {
				return null;
			}
		})();
		return early;
	}

	/**
	 * A question to /api/search, read as it streams (plan-suara-0021, L2): their words as soon as
	 * they are heard, then the answer.
	 */
	async function post(body: Record<string, unknown>, signal?: AbortSignal, onHeard?: (said: string) => void): Promise<SearchResponse> {
		const res = await fetch('/api/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
			body: JSON.stringify({ ...body, reply: setting, route }),
			...(signal ? { signal } : {}),
		});
		if (!res.ok || !res.body) throw new Error(String(res.status));
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		for (;;) {
			const { value, done } = await reader.read();
			buf += decoder.decode(value, { stream: !done });
			let nl: number;
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (!line) continue;
				const event = JSON.parse(line) as { type: 'heard'; said: string } | { type: 'answer'; reply: SearchResponse } | { type: 'error' };
				if (event.type === 'heard') onHeard?.(event.said);
				else if (event.type === 'answer') {
					void reader.cancel().catch(() => {});
					return event.reply;
				}
				else throw new Error('search failed');
			}
			if (done) throw new Error('the answer never came');
		}
	}

	/**
	 * `spoken` means the route is already saying it aloud, so the phone stays quiet. `asked`
	 * means it was a question in their own words, which the web can take when Suara has nothing.
	 */
	function show(reply: SearchResponse, opts: { spoken?: boolean; asked?: boolean } = {}): void {
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
			tell(readBack(reply.heard, reply.language, `${reply.journey.title.full}. ${reply.journey.summary}`), reply.language);
			return;
		}
		if (reply.kind === 'places') {
			dispatch({ type: 'PLACES', result: reply });
			const first = reply.places[0];
			if (first) {
				const zh = reply.language === 'zh-Hans';
				tell(readBack(reply.heard, reply.language, zh ? `最近的是${first.name}。` : `The nearest one is ${first.name}.`), reply.language);
			}
			return;
		}
		if (reply.kind === 'greeting') {
			dispatch({ type: 'GREETING' });
			tell(reply.language === 'zh-Hans' ? '您好！您需要什么帮助？' : 'Hello! What do you need?', reply.language);
			return;
		}
		if (reply.kind === 'nothing') {
			if (opts.asked && canWeb) {
				void searchTheWeb(reply.heard, reply.language, { ...opts, ...(reply.query ? { query: reply.query } : {}) });
				return;
			}
			dispatch({ type: 'NOTHING', heard: reply.heard });
			tell(readBack(reply.heard, reply.language, NOT_IN[reply.language]), reply.language);
			return;
		}
		// A chart drawn from government figures: the headline says the finding, so it is read aloud.
		if (reply.kind === 'chart') {
			const result = { chart: reply.chart, heard: reply.heard, data: reply.data, focus: reply.focus, language: reply.language };
			dispatch({ type: 'CHART', result });
			tell(readBack(reply.heard, reply.language, chartHeadline(result)), reply.language);
			return;
		}
		// A guide the web found for an earlier question like this one: shown at once.
		if (reply.kind === 'web') {
			if (reply.closest) {
				setEnglishIds([]);
				dispatch({ type: 'RESULTS', result: reply.closest });
			}
			dispatch({ type: 'WEB_SEARCH', heard: reply.heard, language: reply.language });
			dispatch({ type: 'WEB_ANSWER', answer: reply.answer, foundAt: reply.foundAt });
			tell(readBack(reply.heard, reply.language, webLine(reply.answer)), reply.language);
			return;
		}
		setEnglishIds(reply.englishIds);
		dispatch({ type: 'RESULTS', result: reply.result });
		// None of these answers it: they stay as the closest, one Back away, and the web is searched.
		if (reply.webFirst && opts.asked && canWeb) {
			void searchTheWeb(reply.result.heard, reply.result.language, { ...opts, fromClosest: true, query: reply.result.query });
			return;
		}
		const top = reply.result.cards[0];
		if (!top) return;
		const zh = reply.result.language === 'zh-Hans';
		const lead =
			reply.result.fit === 'weak'
				? zh ? '最接近的答案是' : 'The closest I have is'
				: zh ? '最符合的是' : 'Best match:';
		tell(readBack(reply.result.heard, reply.result.language, `${lead} ${top.title.full}. ${top.summary.text}`), top.language);
	}

	/** `context`: the step, when asked with "Ask about this step"; nothing for any other question. */
	async function onSpeak(context?: StepContext): Promise<void> {
		// Only a step is sent: a click handler passing its event here must never reach the server.
		if (state.phase !== 'listening') askContext.current = context && typeof context === 'object' && 'step' in context && 'guide' in context ? context : null;
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
			const blocks: Float32Array[] = [];
			let rate = 48000;
			const gate = createSilenceGate();
			let ended = false;
			const stopWatching = watchLevel(stream, (loudness, now) => {
				setLevel(loudness);
				const verdict = gate.push(loudness, now);
				const mine = recording.current;
				const spoke = gate.lastSpeech;
				if (mine && spoke !== null && verdict === 'listen') {
					// They went on after the early question: recall it; the next pause sends another.
					if (mine.early && mine.early.at !== spoke) {
						mine.early.abort.abort();
						mine.early = null;
					}
					if (!mine.early && now - spoke >= EARLY_MS) mine.early = sendEarly(mine, spoke);
				}
				if (verdict !== 'listen' && !ended) {
					ended = true;
					finishRef.current(verdict);
				}
			}, setAnalyser, (block, r) => {
				blocks.push(block);
				rate = r;
				if (recording.current) recording.current.rate = r;
			});
			recording.current = {
				stream,
				blocks,
				rate,
				stopWatching,
				heardSpeech: () => gate.heardSpeech,
				lastSpeech: () => gate.lastSpeech,
				early: null,
			};
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

	/** From the closest answers: look past a weak match on the web. They come back with Back. */
	function onWebSearch(): void {
		if (state.phase !== 'results' || state.result.fit !== 'weak') return;
		silence();
		void searchTheWeb(state.result.heard, state.result.language, { fromClosest: true, query: state.result.query });
	}

	/** A typed question: the same search as a spoken one, and the web behind it. */
	/** Keep the thread: what was said or typed, as the server heard it, marked if it corrected. */
	function remember(reply: SearchResponse, kind: Turn['kind'], isCorrection: boolean, typed?: string): void {
		const heard = reply.kind === 'results' ? reply.result.heard : 'heard' in reply ? reply.heard : undefined;
		const said = (typed ?? heard?.said ?? heard?.sentence ?? '').trim();
		if (!said) return;
		const turn: Turn = { role: 'user', kind, said, ...(isCorrection ? { correction: true as const } : {}) };
		thread.current = isCorrection ? [...thread.current, turn].slice(-6) : [turn];
	}

	/** A typed correction of the question on screen, sent with what it corrects. */
	async function onCorrect(text: string): Promise<void> {
		if (thread.current.length === 0) return onAsk(text);
		silence();
		const heard = { short: text.slice(0, 40), sentence: text };
		dispatch({ type: 'ASKING' });
		try {
			const reply = await post({ kind: 'text', query: text, heard, offset: 0, thread: thread.current });
			remember(reply, 'text', true, text);
			if (reply.kind === 'results') last.current = { kind: 'text', query: reply.result.query, heard: reply.result.heard };
			show(reply, { asked: true });
		} catch {
			dispatch({ type: 'FAIL' });
		}
	}

	/** A spoken correction: the next recording goes with the thread. */
	function onCorrectBySpeech(): void {
		correcting.current = true;
		void onSpeak();
	}

	async function onAsk(text: string): Promise<void> {
		silence();
		const heard = { short: text.slice(0, 40), sentence: text };
		dispatch({ type: 'ASKING' });
		try {
			const reply = await post({ kind: 'text', query: text, heard, offset: 0 });
			remember(reply, 'text', false, text);
			if (reply.kind === 'results') last.current = { kind: 'text', query: reply.result.query, heard };
			show(reply, { asked: true });
		} catch {
			dispatch({ type: 'FAIL' });
		}
	}

	async function onTopic(area: Area): Promise<void> {
		silence();
		// A topic is not a question: nothing to correct.
		thread.current = [];
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
			analyser={analyser}
			finding={finding}
			onFind={() => setFinding(true)}
			onFindClose={() => setFinding(false)}
			onFound={onFound}
			onAsk={onAsk}
			onCorrect={onCorrect}
			onCorrectBySpeech={onCorrectBySpeech}
			{...(canWeb ? { onWebSearch } : {})}
		/>
	);
}
