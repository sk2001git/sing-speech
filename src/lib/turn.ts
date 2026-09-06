import { z } from 'zod';
import { decide, nextContext, type PolicyContext } from './policy';
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

export interface TurnResponse {
	screen: Screen;
	language: string;
	history: Understanding[];
	unclearStreak: number;
}

/**
 * One turn, start to finish. Pure apart from the provider call, so it is testable
 * against `FakeProvider` with no network.
 */
export async function runTurn(
	req: TurnRequest,
	provider: VoiceProvider,
): Promise<TurnResponse> {
	if (req.kind === 'confirmation') {
		return handleConfirmation(req.accepted, req.intent, req.history);
	}

	const audio = decodeBase64(req.audioBase64);
	const { understanding } = await provider.understand(audio, { history: req.history });

	const ctx: PolicyContext = { consecutiveUnclear: req.unclearStreak };
	const decision = decide(understanding, ctx);

	return {
		screen: screenFor(decision),
		language: understanding.language,
		history: [...req.history, understanding],
		unclearStreak: nextContext(understanding, ctx).consecutiveUnclear,
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
			screen: screenFor({
				kind: 'act',
				intent,
				say: last?.reply ?? 'Let me get that for you.',
			}),
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
