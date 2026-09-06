import { z } from 'zod';
import { factsFor } from './catalogue';
import { corroborate, type Agreement } from './corroborate';
import { decide, nextContext, type PolicyContext } from './policy';
import type { TranscriptProvider } from './providers/transcript';
import type { VoiceProvider } from './providers/types';
import { screenFor, type Screen } from './uispec';
import { Understanding, type Intent } from './understanding';

/**
 * What the client sends.
 *
 * Session state travels with the request rather than living on the server. Workers are
 * stateless and short-lived, so the alternative is a KV round-trip per turn for state
 * that only this client needs. For an informational-only v1 nothing here is
 * security-sensitive — the moment a turn can write to a government system, this moves
 * server-side and gets signed.
 */
export const TurnRequest = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('speech'),
		audioBase64: z.string().min(1),
		history: z.array(Understanding).max(20).default([]),
		unclearStreak: z.number().int().min(0).max(10).default(0),
	}),
	z.object({
		/** The user answered a read-back question by button rather than by voice. */
		kind: z.literal('confirmation'),
		accepted: z.boolean(),
		intent: Understanding.shape.intent,
		history: z.array(Understanding).max(20).default([]),
	}),
]);

export type TurnRequest = z.infer<typeof TurnRequest>;

/**
 * The audit record for one turn.
 *
 * This is what compliance actually needs, and it is better than a transcript alone: the
 * literal words heard, what each channel concluded, whether they agreed, the confidence
 * before and after adjustment, and what the system did about it. A transcript on its own
 * records what might have been said; this records why the system did what it did.
 */
export interface TurnAudit {
	transcript: string;
	audioIntent: Intent;
	transcriptIntent: string | null;
	agreement: Agreement;
	rawConfidence: number;
	adjustedConfidence: number;
	decision: string;
}

export interface TurnResponse {
	screen: Screen;
	language: string;
	history: Understanding[];
	unclearStreak: number;
	audit?: TurnAudit;
}

/**
 * One turn, start to finish.
 *
 * Both channels run, and they run concurrently — the transcriber is not on the critical
 * path behind the audio model, so corroboration costs a few cents per thousand users
 * and no extra latency.
 */
export async function runTurn(
	req: TurnRequest,
	provider: VoiceProvider,
	transcriber?: TranscriptProvider,
): Promise<TurnResponse> {
	if (req.kind === 'confirmation') {
		return handleConfirmation(req.accepted, req.intent, req.history);
	}

	const audio = decodeBase64(req.audioBase64);

	const [voice, transcript] = await Promise.all([
		provider.understand(audio, { history: req.history }),
		transcriber?.transcribe(audio) ?? Promise.resolve(null),
	]);

	// With no transcriber configured this is a no-op that reports 'no-signal', so the
	// single-channel path stays exactly as it was.
	const cross = corroborate(voice.understanding, transcript?.text ?? '');
	const understanding = cross.understanding;

	const ctx: PolicyContext = { consecutiveUnclear: req.unclearStreak };
	const decision = decide(understanding, ctx);

	return {
		screen: screenFor(decision, factsFor(understanding.intent)),
		language: understanding.language,
		history: [...req.history, understanding],
		unclearStreak: nextContext(understanding, ctx).consecutiveUnclear,
		audit: {
			transcript: cross.transcript,
			audioIntent: voice.understanding.intent,
			transcriptIntent: cross.transcriptIntent,
			agreement: cross.agreement,
			rawConfidence: cross.rawConfidence,
			adjustedConfidence: understanding.confidence,
			decision: decision.kind,
		},
	};
}

/**
 * A "no" is information, not a failure.
 *
 * Rejecting the read-back tells us our best guess was wrong, so the next turn must not
 * offer it again. It also resets the unclear streak: the user communicated clearly, we
 * simply had the wrong answer, and holding that against their handoff counter would
 * punish them for our mistake.
 */
function handleConfirmation(
	accepted: boolean,
	intent: Intent,
	history: Understanding[],
): TurnResponse {
	const last = history[history.length - 1];
	const language = last?.language ?? 'en';

	if (accepted) {
		return {
			screen: screenFor(
				{ kind: 'act', intent, say: last?.reply ?? 'Let me get that for you.' },
				factsFor(intent),
			),
			language,
			history,
			unclearStreak: 0,
		};
	}

	return {
		screen: {
			kind: 'repeat',
			say: 'Sorry about that. Please tell me again what you need.',
			example: 'I need help paying for the doctor',
		},
		language,
		history,
		unclearStreak: 0,
	};
}

function decodeBase64(b64: string): ArrayBuffer {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}
