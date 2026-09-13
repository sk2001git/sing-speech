import type { SessionState } from './session';
import { INTENT_LABELS } from './understanding';

type Readback = Extract<SessionState, { phase: 'readback' }>;

export interface ReadbackView {
	/** The one sentence the user is asked to confirm. */
	sentence: string;
	/** What is said aloud. */
	spoken: string;
	/** Whether "yes, continue" is on offer. Not after a repeat or a handoff. */
	canContinue: boolean;
}

/**
 * What the readback card says.
 *
 * The sentence is the model's restatement — meaning, in the user's own terms — and falls
 * back to the intent label when there is none, so the card is never empty. The spoken
 * question always offers "something else" as an ordinary answer: "is that right?" on its
 * own invites the reflexive yes that `policy.ts` warns about.
 */
export function readbackFor(state: Readback): ReadbackView {
	const { screen, understanding } = state;
	const sentence = understanding.restatement ?? `You need ${INTENT_LABELS[understanding.intent]}.`;

	switch (screen.kind) {
		case 'answer':
			return {
				sentence,
				spoken: `I understood: ${sentence} Is that right, or is it something else?`,
				canContinue: true,
			};
		case 'confirm':
			// The policy already phrased this question carefully. Say it as written.
			return { sentence, spoken: screen.say, canContinue: true };
		case 'repeat':
		case 'handoff':
		case 'listening':
			return { sentence: screen.say, spoken: screen.say, canContinue: false };
	}
}
