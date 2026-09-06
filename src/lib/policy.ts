import { INTENT_LABELS, type Intent, type Understanding } from './understanding';

/**
 * Confidence thresholds, in one place so they can be tuned against the fixture set
 * rather than hunted through the codebase.
 *
 * These numbers are guesses until step 4 of the build measures them. They are written
 * down as guesses on purpose — a threshold nobody can find is a threshold nobody
 * retunes.
 */
export const THRESHOLDS = {
	/** At or above this, act. Below it we always ask something. */
	act: 0.85,
	/** At or above this, we have a guess worth confirming. Below it we do not. */
	confirm: 0.6,
	/** Consecutive sub-`confirm` turns before we stop trying and fetch a person. */
	repeatsBeforeHandoff: 2,
} as const;

export interface PolicyContext {
	/** How many turns in a row have already come back below `THRESHOLDS.confirm`. */
	consecutiveUnclear: number;
}

/**
 * What the turn should do next. Each variant maps to exactly one UI component, so the
 * renderer never has to interpret.
 */
export type Decision =
	| { kind: 'act'; intent: Intent; say: string }
	| { kind: 'confirm'; intent: Intent; say: string }
	| { kind: 'repeat'; say: string }
	| { kind: 'handoff'; say: string };

/**
 * Ask about one guess, yes or no — never "did you mean A or B?".
 *
 * Offering two intents makes the user hold both in working memory and pick, which is
 * the exact cognitive load this product exists to remove. A yes/no question about our
 * single best guess is answerable by voice in one syllable in any language, or by
 * pressing one of two buttons, and a "no" still narrows the space usefully.
 *
 * The phrasing matters as much as the shape. "Is that right?" invites a reflexive yes,
 * and this population is the one most prone to giving one — acquiescence rises with
 * cognitive load, unfamiliarity, and deference to authority, so an elderly user who did
 * not fully parse the prompt will often agree just to end the exchange. So the question
 * states what we actually heard, and offers "something else" as an equally ordinary
 * answer rather than as a correction the user has to work up the nerve to make.
 *
 * See the `confirm-intent` skill for the evidence behind this.
 */
function confirmQuestion(intent: Intent): string {
	return `I heard that you need ${INTENT_LABELS[intent]}. Have I got that right, or is it something else?`;
}

/**
 * Never guess silently.
 *
 * The rule this function exists to enforce: below `THRESHOLDS.act`, the system asks
 * rather than proceeds. Everything else here is detail.
 */
export function decide(u: Understanding, ctx: PolicyContext): Decision {
	// An explicit request for a person outranks confidence. Someone who asks for help
	// getting help should not be made to pass a confidence check first.
	if (u.needsHuman || u.intent === 'human_handoff') {
		return {
			kind: 'handoff',
			say: 'I will get someone to help you. Please hold on.',
		};
	}

	// We have tried and failed to understand repeatedly. Continuing to ask is no longer
	// help, it is an obstacle course.
	if (
		u.confidence < THRESHOLDS.confirm &&
		ctx.consecutiveUnclear >= THRESHOLDS.repeatsBeforeHandoff
	) {
		return {
			kind: 'handoff',
			say: 'I am having trouble hearing you. Let me get someone to help.',
		};
	}

	if (u.confidence < THRESHOLDS.confirm) {
		return {
			kind: 'repeat',
			// A concrete example, not "please repeat". Someone who was not understood
			// needs to know what a usable answer sounds like, otherwise they say the same
			// unclear thing again, louder.
			say: 'Sorry, I did not catch that. You can say something like: I need help paying for the doctor.',
		};
	}

	if (u.confidence < THRESHOLDS.act) {
		return { kind: 'confirm', intent: u.intent, say: confirmQuestion(u.intent) };
	}

	return { kind: 'act', intent: u.intent, say: u.reply };
}

/**
 * Track the unclear streak across turns. A turn that produced a usable answer resets it
 * — the streak measures consecutive failure, not lifetime failure, because a user who
 * struggled once and then succeeded is not in trouble.
 */
export function nextContext(u: Understanding, ctx: PolicyContext): PolicyContext {
	return {
		consecutiveUnclear:
			u.confidence < THRESHOLDS.confirm ? ctx.consecutiveUnclear + 1 : 0,
	};
}
