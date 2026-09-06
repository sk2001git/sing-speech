import { z } from 'zod';
import type { Decision } from './policy';
import { Intent, INTENT_LABELS } from './understanding';

/**
 * The whitelist. Five screens, and there will never be many more.
 *
 * The model does not emit markup and does not choose a layout. It chooses an intent and
 * reports a confidence; the policy turns that into a Decision; this file turns the
 * Decision into one of five screens. The UI is dynamic — it is assembled per need,
 * which is the point — but it is assembled deterministically, by code that can be read
 * and tested.
 *
 * That is a deliberate rejection of letting the model generate UI. Generated markup is
 * an injection surface, an accessibility regression, an extra round-trip of latency and
 * an extra slice of a one-cent budget, and it buys nothing here: with six intents there
 * are not enough distinct screens to be worth generating.
 */
export const Screen = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('listening'),
		say: z.string(),
	}),
	z.object({
		kind: z.literal('answer'),
		title: z.string(),
		say: z.string(),
		/** Facts pulled from the profile vault, shown and read back for verification. */
		facts: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
	}),
	z.object({
		kind: z.literal('confirm'),
		/** Carried so the client can answer by button without re-inferring anything. */
		intent: Intent,
		say: z.string(),
		yes: z.string(),
		no: z.string(),
	}),
	z.object({
		kind: z.literal('repeat'),
		say: z.string(),
		example: z.string(),
	}),
	z.object({
		kind: z.literal('handoff'),
		say: z.string(),
		phone: z.string(),
	}),
]);

export type Screen = z.infer<typeof Screen>;

/** Where a user goes when the machine has run out of ways to help. */
const HELPLINE = '1800 222 0000';

/**
 * One decision, one screen. Total and deterministic.
 *
 * Every branch produces something the user can act on. There is no dead end and no
 * screen whose only affordance is failure, because a dead end for this population means
 * giving up on the service entirely.
 */
export function screenFor(decision: Decision): Screen {
	switch (decision.kind) {
		case 'act':
			return {
				kind: 'answer',
				title: capitalise(INTENT_LABELS[decision.intent]),
				say: decision.say,
				facts: [],
			};

		case 'confirm':
			return {
				kind: 'confirm',
				intent: decision.intent,
				say: decision.say,
				// Spelled out rather than "Yes"/"No" so the buttons still make sense to
				// someone who did not hear the question.
				yes: 'Yes, that is right',
				no: 'No, something else',
			};

		case 'repeat':
			return {
				kind: 'repeat',
				say: decision.say,
				example: 'I need help paying for the doctor',
			};

		case 'handoff':
			return { kind: 'handoff', say: decision.say, phone: HELPLINE };
	}
}

function capitalise(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
