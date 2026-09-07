/**
 * Live captions while the user speaks.
 *
 * This uses the browser's own `SpeechRecognition`, which is free and runs as the person
 * talks. It exists for one reason: the single biggest anxiety in a voice interface is
 * "is it even listening?", and for someone who is unsure of technology a silent screen
 * during recording reads as broken. Words appearing as they speak answers that question
 * better than any spinner.
 *
 * It is display only, and that separation is the whole design:
 *
 * - These captions never reach the model, never touch `Understanding`, and never
 *   influence a decision. They are pixels.
 * - The authoritative transcript still comes from Workers AI Whisper after the turn, and
 *   replaces the caption when it arrives.
 *
 * So the browser being wrong about Singlish costs nothing. It is the reason we can use a
 * free recogniser here at all — accuracy is not load-bearing, and the one place it would
 * be is served by a channel we already pay for.
 *
 * Turn-taking is untouched. The recogniser reports words; it never decides the utterance
 * has ended. The user still ends the turn by pressing the button, so nothing here
 * reintroduces the voice-activity detection this product refuses to use.
 *
 * Privacy note worth stating plainly: in Chrome this streams audio to Google for
 * recognition. The same audio is already going to Gemini for understanding, so the
 * marginal exposure is small — but it is not zero, and if the audio provider is ever
 * swapped to something self-hosted, this should be reconsidered rather than inherited.
 */

interface RecognitionAlternative {
	transcript: string;
}
interface RecognitionResult {
	readonly length: number;
	isFinal: boolean;
	[index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
	resultIndex: number;
	results: { readonly length: number; [index: number]: RecognitionResult };
}
interface Recognition {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	maxAlternatives: number;
	start(): void;
	stop(): void;
	abort(): void;
	onresult: ((e: RecognitionEvent) => void) | null;
	onerror: (() => void) | null;
	onend: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

/**
 * Merge one recognition event into the caption so far.
 *
 * Pulled out and exported because this is the only part with logic worth being wrong.
 * The recogniser reports a rolling window starting at `resultIndex`: entries marked
 * final are settled and must be appended exactly once, everything after is provisional
 * and must be replaced, not appended. Get that backwards and the caption stutters,
 * repeating each phrase as the user speaks — which for this audience reads as the
 * machine being confused by them.
 */
export function mergeResults(
	settled: string,
	results: { readonly length: number; [i: number]: RecognitionResult },
	resultIndex: number,
): { settled: string; text: string } {
	let nextSettled = settled;
	let interim = '';

	for (let i = resultIndex; i < results.length; i += 1) {
		const result = results[i];
		if (!result) continue;
		const text = result[0]?.transcript ?? '';
		if (result.isFinal) nextSettled += text;
		else interim += text;
	}

	return { settled: nextSettled, text: (nextSettled + interim).trim() };
}

function recognitionCtor(): RecognitionCtor | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as {
		SpeechRecognition?: RecognitionCtor;
		webkitSpeechRecognition?: RecognitionCtor;
	};
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when this browser can show live captions at all. */
export function captionsAvailable(): boolean {
	return recognitionCtor() !== null;
}

export interface CaptionSession {
	stop(): void;
}

/**
 * Start captioning until `stop()` is called.
 *
 * Returns null when the browser has no recogniser, which is a normal outcome and not an
 * error — the caller shows a listening indicator instead. Nothing about the turn
 * changes.
 */
export function startCaptions(
	lang: string,
	onText: (text: string) => void,
): CaptionSession | null {
	const Ctor = recognitionCtor();
	if (!Ctor) return null;

	let stopped = false;
	const rec = new Ctor();
	rec.lang = lang;
	// Continuous, because an elderly speaker pausing mid-sentence must not end the
	// caption stream any more than it ends the recording.
	rec.continuous = true;
	rec.interimResults = true;
	rec.maxAlternatives = 1;

	let settled = '';

	rec.onresult = (e) => {
		const merged = mergeResults(settled, e.results, e.resultIndex);
		settled = merged.settled;
		onText(merged.text);
	};

	rec.onerror = () => {
		// A failed recogniser must never surface to the user. The recording is unaffected
		// and the real transcript is still coming.
	};

	// Chrome ends the session on its own after a silence. Restart it, because silence
	// here means the person is thinking, not finished.
	rec.onend = () => {
		if (stopped) return;
		try {
			rec.start();
		} catch {
			// Already starting, or no longer permitted. Captions simply stop.
		}
	};

	try {
		rec.start();
	} catch {
		return null;
	}

	return {
		stop() {
			stopped = true;
			try {
				rec.stop();
			} catch {
				// Nothing to do; it was not running.
			}
		},
	};
}
