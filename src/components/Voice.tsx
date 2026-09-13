import { useEffect, useReducer, useRef, useState } from 'react';
import { cardsFor } from '../lib/cards';
import { factsFor } from '../lib/catalogue';
import { procedureFor, usableProcedure } from '../lib/guide';
import { micFailure } from '../lib/mic';
import type { Mode } from '../lib/mode';
import { advance, localise, stepById, type Procedure } from '../lib/procedure';
import { connectRealtime, RealtimeUnavailable, type RealtimeLink } from '../lib/realtime';
import { readbackFor } from '../lib/readback';
import { canPress, initialState, next, type SessionState } from '../lib/session';
import { screenFor, type Screen } from '../lib/uispec';
import { LANGUAGES, type Language, type Understanding } from '../lib/understanding';
import ScreenView, { MIC_HELP, OFFLINE_HELP } from './Screen';

/** BCP-47 tags for the on-device voice, keyed by the language the model reported. */
const VOICE_LANG: Record<string, string> = {
	en: 'en-SG',
	sg: 'en-SG',
	zh: 'zh-SG',
	ms: 'ms-MY',
	ta: 'ta-IN',
	yue: 'zh-HK',
	nan: 'zh-TW',
	unknown: 'en-SG',
};

const OPENING: Screen = {
	kind: 'listening',
	say: 'What do you need help with today?',
};

const FINISHED_SAY =
	'That is every step. If anything was different on the day, press the button and tell me.';

interface TurnReply {
	screen: Screen;
	language: string;
	history: Understanding[];
	unclearStreak: number;
}

/**
 * Speak the text on the device.
 *
 * On-device synthesis is the only TTS that fits the budget — a per-character API costs
 * $17 to $69 a month at a thousand users against a ten dollar ceiling. It is also
 * instant and works with no network, which matters more here than voice quality.
 * Returns false when the device cannot speak, so the caller does not wait for an end
 * event that will never come.
 */
function speak(text: string, lang: string, onEnd?: () => void): boolean {
	if (typeof speechSynthesis === 'undefined') return false;
	speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(text);
	u.lang = VOICE_LANG[lang] ?? 'en-SG';
	// Slower than default. Comprehension, not throughput, is the constraint.
	u.rate = 0.85;
	if (onEnd) {
		u.onend = onEnd;
		u.onerror = onEnd;
	}
	speechSynthesis.speak(u);
	return true;
}

function silence(): void {
	if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/**
 * Pick a container this browser can actually record.
 *
 * Hardcoding `audio/webm;codecs=opus` throws on iOS Safari, which records MP4/AAC — so
 * that one line would have made the app dead on every iPhone, silently, at the moment
 * the user first presses the button. Candidates are ordered by preference and every one
 * of them is a format Gemini accepts. An empty string means "browser default", which is
 * the honest fallback when nothing is recognised.
 */
function pickMimeType(): string {
	const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
	if (typeof MediaRecorder === 'undefined') return '';
	return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

async function toBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
	return btoa(binary);
}

function asLanguage(code: string): Language {
	return (LANGUAGES as readonly string[]).includes(code) ? (code as Language) : 'en';
}

/**
 * The words for a state — spoken and shown alike, so a user who hears it and a user who
 * reads it get the same thing. Empty while the microphone is open: nothing talks over
 * the person speaking.
 */
function lineFor(state: SessionState, proc: Procedure | null, lang: Language): string {
	switch (state.phase) {
		case 'arming':
		case 'recording':
		case 'submitting':
			return '';
		case 'readback':
			return readbackFor(state).spoken;
		case 'guiding': {
			const step = proc ? stepById(proc, state.cursor.stepId) : undefined;
			if (!step) return state.screen.say;
			const instruction = localise(step.instruction, lang);
			return step.next !== null && typeof step.next === 'object'
				? `${instruction} ${localise(step.next.question, lang)}`
				: instruction;
		}
		case 'denied':
			return MIC_HELP[state.reason] ?? MIC_HELP.permission!;
		case 'offline':
			return OFFLINE_HELP;
		default:
			return state.screen.say;
	}
}

interface Recording {
	rec: MediaRecorder;
	stream: MediaStream;
	mimeType: string;
	chunks: Blob[];
}

/**
 * The driver: microphone, network and speech. Every pixel is in `Screen.tsx`.
 *
 * Two ways to hear a turn, one way to decide it. In `gemini` mode the utterance is
 * recorded and posted whole. In `openai` mode it streams to OpenAI Realtime over WebRTC
 * and the resulting understanding is posted instead. Either way `/api/turn` applies the
 * same thresholds, and the user sees the same readback card.
 *
 * Tap to start, tap to stop — never press-and-hold, and no voice-activity detection in
 * either mode. The user decides when they have finished.
 */
export default function Voice({ mode, demo }: { mode: Mode; demo: boolean }) {
	const [state, dispatch] = useReducer(next, OPENING, initialState);
	const [lang, setLang] = useState<Language>('en');
	const [procedure, setProcedure] = useState<Procedure | null>(null);

	const history = useRef<Understanding[]>([]);
	const unclearStreak = useRef(0);
	const recording = useRef<Recording | null>(null);
	const link = useRef<RealtimeLink | null>(null);

	const line = lineFor(state, procedure, lang);

	// Say every new line aloud. `answering` waits for the speech to end before the button
	// comes back; a fallback timer covers a synthesiser that never reports the end.
	useEffect(() => {
		if (!line) {
			silence();
			return;
		}
		const spoken = () => dispatch({ type: 'SPOKEN' });
		if (!speak(line, lang, spoken)) {
			spoken();
			return;
		}
		const fallback = setTimeout(spoken, Math.max(4000, line.length * 90));
		return () => clearTimeout(fallback);
	}, [line, lang]);

	useEffect(
		() => () => {
			link.current?.close();
			recording.current?.stream.getTracks().forEach((t) => t.stop());
		},
		[],
	);

	async function startCapture(): Promise<void> {
		if (mode === 'openai') {
			link.current ??= await connectRealtime();
			link.current.begin();
			return;
		}
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, sampleRate: 16000, noiseSuppression: true },
		});
		const mimeType = pickMimeType();
		const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
		const chunks: Blob[] = [];
		rec.ondataavailable = (e) => chunks.push(e.data);
		recording.current = { rec, stream, mimeType, chunks };
		rec.start();
	}

	async function finishCapture(): Promise<unknown> {
		if (mode === 'openai') {
			const current = link.current;
			if (!current) throw new RealtimeUnavailable('not connected');
			try {
				const turn = await current.finish(history.current);
				return {
					kind: 'understanding',
					understanding: turn.understanding,
					transcript: turn.transcript,
					history: history.current,
					unclearStreak: unclearStreak.current,
				};
			} catch (err) {
				// Reconnect on the next press rather than reuse a session in an unknown state.
				current.close();
				link.current = null;
				throw err;
			}
		}

		const current = recording.current;
		if (!current) throw new Error('not recording');
		const stopped = new Promise<void>((resolve) => {
			current.rec.onstop = () => resolve();
		});
		current.rec.stop();
		await stopped;
		current.stream.getTracks().forEach((t) => t.stop());
		recording.current = null;

		// rec.mimeType is what the browser actually chose, which is not always what was
		// asked for. Send that, not the request.
		const type = current.rec.mimeType || current.mimeType || 'audio/webm';
		return {
			kind: 'speech',
			audioBase64: await toBase64(new Blob(current.chunks, { type })),
			mimeType: type,
			history: history.current,
			unclearStreak: unclearStreak.current,
		};
	}

	async function onPress(): Promise<void> {
		if (state.phase === 'recording') {
			dispatch({ type: 'RELEASE' });
			try {
				const body = await finishCapture();
				const res = await fetch('/api/turn', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
				});
				if (!res.ok) throw new Error(String(res.status));
				const reply = (await res.json()) as TurnReply;
				const understanding = reply.history[reply.history.length - 1];
				if (!understanding) throw new Error('reply carried no understanding');
				history.current = reply.history;
				unclearStreak.current = reply.unclearStreak;
				setLang(asLanguage(reply.language));
				dispatch({ type: 'REPLY', screen: reply.screen, understanding });
			} catch {
				dispatch({ type: 'FAIL' });
			}
			return;
		}

		if (!canPress(state)) return;
		silence();
		dispatch({ type: 'PRESS' });
		try {
			await startCapture();
			dispatch({ type: 'GRANTED' });
		} catch (err) {
			dispatch(
				err instanceof RealtimeUnavailable
					? { type: 'FAIL' }
					: { type: 'DENIED', reason: micFailure(err, window.isSecureContext) },
			);
		}
	}

	/** "Yes, that is right." Into a flow if one may be shown, otherwise to the answer. */
	function onContinue(): void {
		if (state.phase !== 'readback') return;
		const u = state.understanding;
		const proc = usableProcedure(procedureFor(u.intent), demo);
		unclearStreak.current = 0;

		if (proc) {
			setProcedure(proc);
			dispatch({
				type: 'ENTER',
				cursor: {
					procedureId: proc.id,
					stepId: proc.entry,
					done: [],
					startedAt: new Date().toISOString(),
				},
			});
			return;
		}

		dispatch({
			type: 'CONFIRM',
			accepted: true,
			screen: screenFor({ kind: 'act', intent: u.intent, say: u.reply }, factsFor(u.intent)),
		});
	}

	/** "Done", or the answer to a step's yes/no question. */
	function onStep(answer?: boolean): void {
		if (state.phase !== 'guiding' || !procedure) return;
		const cursor = advance(procedure, state.cursor, answer);
		if (cursor === null) {
			dispatch({
				type: 'FINISH',
				screen: { kind: 'answer', title: localise(procedure.title, lang), say: FINISHED_SAY, facts: [] },
			});
			return;
		}
		dispatch({ type: 'ADVANCE', cursor });
	}

	function onReplay(): void {
		speak(line || state.screen.say, lang);
	}

	return (
		<ScreenView
			state={state}
			cards={cardsFor(state, procedure, lang, new Date(), { samples: demo })}
			procedure={procedure}
			lang={lang}
			mode={mode}
			demo={demo}
			onPress={onPress}
			onContinue={onContinue}
			onStep={onStep}
			onReplay={onReplay}
		/>
	);
}
