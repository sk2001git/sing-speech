import { useCallback, useEffect, useRef, useState } from 'react';
import { startCaptions, type CaptionSession } from '../lib/caption';
import type { Screen } from '../lib/uispec';
import type { Understanding } from '../lib/understanding';

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

const EXAMPLE = 'I need help paying for the doctor';

const OPENING: Screen = {
	kind: 'listening',
	say: 'What do you need help with today?',
};

/**
 * Speak the text on the device.
 *
 * On-device synthesis is the only TTS that fits the budget — a per-character API costs
 * $17 to $69 a month at a thousand users against a ten dollar ceiling. It is also
 * instant and works with no network, which matters more here than voice quality.
 */
function speak(text: string, lang: string): void {
	if (typeof speechSynthesis === 'undefined') return;
	speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(text);
	u.lang = VOICE_LANG[lang] ?? 'en-SG';
	// Slower than default. Comprehension, not throughput, is the constraint.
	u.rate = 0.85;
	speechSynthesis.speak(u);
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
	const candidates = [
		'audio/webm;codecs=opus',
		'audio/webm',
		'audio/ogg;codecs=opus',
		'audio/mp4',
	];
	if (typeof MediaRecorder === 'undefined') return '';
	return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

async function toBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
	return btoa(binary);
}

export default function Voice() {
	const [screen, setScreen] = useState<Screen>(OPENING);
	const [recording, setRecording] = useState(false);
	const [busy, setBusy] = useState(false);
	const [lang, setLang] = useState('en');

	// What the user is saying, shown as they say it. Display only — see lib/caption.ts.
	const [caption, setCaption] = useState('');
	// True once the caption has been replaced by the transcript we actually acted on.
	const [captionConfirmed, setCaptionConfirmed] = useState(false);

	const history = useRef<Understanding[]>([]);
	const unclearStreak = useRef(0);
	const recorder = useRef<MediaRecorder | null>(null);
	const chunks = useRef<Blob[]>([]);
	const captions = useRef<CaptionSession | null>(null);

	// Say every new screen aloud. The spoken text and the shown text are the same string,
	// so a user who hears it and a user who reads it get the same thing and there is
	// never a caption that disagrees with the audio.
	useEffect(() => {
		speak(screen.say, lang);
	}, [screen, lang]);

	const post = useCallback(async (body: unknown) => {
		setBusy(true);
		try {
			const res = await fetch('/api/turn', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!res.ok) throw new Error(String(res.status));
			const next = (await res.json()) as {
				screen: Screen;
				language: string;
				history: Understanding[];
				unclearStreak: number;
				audit?: { transcript: string };
			};
			history.current = next.history;
			unclearStreak.current = next.unclearStreak;
			// Replace the browser's guess with the transcript the decision was actually
			// made on. If the two differ, what is shown is the one that counted.
			if (next.audit?.transcript) {
				setCaption(next.audit.transcript);
				setCaptionConfirmed(true);
			}
			setLang(next.language);
			setScreen(next.screen);
		} catch {
			// Errors give direction, never an apology and never a code. The user can
			// always act on what this says.
			setScreen({
				kind: 'repeat',
				say: 'I could not hear that. Please press the green button and say it again.',
				example: EXAMPLE,
			});
		} finally {
			setBusy(false);
		}
	}, []);

	/**
	 * Tap to start, tap to stop. Not press-and-hold.
	 *
	 * Holding a button steady is exactly what a hand with a tremor cannot do, and
	 * releasing early truncates the sentence. Tap-to-stop also means a long pause
	 * mid-sentence never ends the turn — the user decides when they have finished, not a
	 * silence detector. That is the whole non-interruptive promise, and it is why there
	 * is no voice-activity detection anywhere in this file.
	 */
	const toggle = useCallback(async () => {
		if (recording) {
			recorder.current?.stop();
			return;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, sampleRate: 16000, noiseSuppression: true },
			});
			const mimeType = pickMimeType();
			const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
			chunks.current = [];
			rec.ondataavailable = (e) => chunks.current.push(e.data);
			rec.onstop = async () => {
				stream.getTracks().forEach((t) => t.stop());
				captions.current?.stop();
				captions.current = null;
				setRecording(false);
				// rec.mimeType is what the browser actually chose, which is not always what
				// was asked for. Send that, not the request.
				const type = rec.mimeType || mimeType || 'audio/webm';
				const blob = new Blob(chunks.current, { type });
				await post({
					kind: 'speech',
					audioBase64: await toBase64(blob),
					mimeType: type,
					history: history.current,
					unclearStreak: unclearStreak.current,
				});
			};
			recorder.current = rec;
			speechSynthesis?.cancel();
			setCaption('');
			setCaptionConfirmed(false);
			// Captions run alongside the recording and never end the turn. The button does.
			captions.current = startCaptions(VOICE_LANG[lang] ?? 'en-SG', setCaption);
			rec.start();
			setRecording(true);
		} catch {
			// Covers a denied permission, no microphone, and an insecure origin —
			// getUserMedia needs HTTPS or localhost, so this fires on a phone hitting a
			// plain-http dev server. The user gets one instruction either way.
			setScreen({
				kind: 'repeat',
				say: 'I cannot use the microphone. Please allow microphone access, then press the green button.',
				example: EXAMPLE,
			});
		}
	}, [recording, post]);

	const answerConfirm = useCallback(
		(accepted: boolean) => {
			if (screen.kind !== 'confirm') return;
			void post({
				kind: 'confirmation',
				accepted,
				intent: screen.intent,
				history: history.current,
			});
		},
		[screen, post],
	);

	return (
		<main className="mx-auto flex min-h-svh max-w-xl flex-col justify-between px-6 py-8">
			<div className="pt-6">
				{recording && (
					<p className="text-live mb-6 text-[length:var(--text-micro)] font-semibold">
						Listening. Press the button again when you finish.
					</p>
				)}

				<p className="text-[length:var(--text-title)] font-semibold leading-tight text-balance">
					{screen.say}
				</p>

				{/*
				  Subtitles. The height is reserved whether or not there is text, so the
				  question above never jumps as words arrive — a moving target is hard to
				  read for anyone, and worse for the eyes this is built for.

				  aria-live is polite and the region is not focusable: a screen reader user
				  is already hearing themselves speak and does not need it announced over
				  the top.
				*/}
				<div className="mt-8 min-h-28" aria-live="polite">
					{(recording || caption) && (
						<>
							<p className="text-quiet text-[length:var(--text-micro)]">
								{recording ? 'I am hearing' : captionConfirmed ? 'You said' : 'I heard'}
							</p>
							<p
								className={`mt-1 text-[length:var(--text-lead)] leading-snug ${
									recording ? 'text-ink' : 'text-quiet'
								}`}
							>
								{caption || (recording ? '…' : '')}
								{recording && <span className="caret" aria-hidden="true" />}
							</p>
						</>
					)}
				</div>

				{screen.kind === 'repeat' && (
					<p className="text-quiet mt-6 text-[length:var(--text-lead)]">
						For example: &ldquo;{screen.example}&rdquo;
					</p>
				)}

				{screen.kind === 'answer' && screen.facts.length > 0 && (
					// Label above value, value large. The user is verifying the values, so
					// the values are what must be legible from arm's length — the reverse
					// of how a form usually prints them.
					<dl className="mt-10 space-y-7">
						{screen.facts.map((f) => (
							<div key={f.label}>
								<dt className="text-quiet text-[length:var(--text-micro)]">
									{f.label}
								</dt>
								<dd className="m-0 text-[length:var(--text-lead)] font-semibold">
									{f.value}
								</dd>
							</div>
						))}
					</dl>
				)}

				{screen.kind === 'handoff' && (
					<a
						href={`tel:${screen.phone.replace(/\s/g, '')}`}
						className="tap tap-quiet mt-10 text-center no-underline"
					>
						Call {screen.phone}
					</a>
				)}
			</div>

			<div className="space-y-4 pb-2">
				{screen.kind === 'confirm' && (
					<>
						<button
							className="tap tap-quiet"
							onClick={() => answerConfirm(true)}
							disabled={busy}
						>
							{screen.yes}
						</button>
						<button
							className="tap tap-quiet"
							onClick={() => answerConfirm(false)}
							disabled={busy}
						>
							{screen.no}
						</button>
					</>
				)}

				<button
					className="tap tap-speak"
					data-live={recording}
					onClick={toggle}
					disabled={busy}
					aria-label={recording ? 'Stop speaking' : 'Press to speak'}
				>
					{busy ? 'One moment' : recording ? 'I have finished' : 'Press to speak'}
				</button>
			</div>
		</main>
	);
}
