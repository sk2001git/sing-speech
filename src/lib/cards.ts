import { localise, stepById, type Procedure, type StepImage } from './procedure';
import type { SessionState } from './session';
import type { Language } from './understanding';

/**
 * How long a screenshot is trusted.
 *
 * Government interfaces get redesigned, and a stale screenshot is worse than none: it
 * sends someone hunting for a button that moved, which for this audience ends the
 * attempt. Ninety days is a guess — see open question 3 in the spec — and it lives here
 * as a named constant so it can be retuned rather than hunted for.
 */
export const IMAGE_STALE_DAYS = 90;

export type Card =
	| { kind: 'heard'; key: string; text: string }
	| { kind: 'fact'; key: string; label: string; value: string }
	| {
			kind: 'step';
			key: string;
			index: number;
			of: number;
			instruction: string;
			state: 'done' | 'active' | 'future';
			image: StepImage | null;
		}
	| { kind: 'contact'; key: string; label: string; phone: string };

export function imageIsFresh(image: StepImage, now: Date): boolean {
	const checked = Date.parse(image.checkedOn);
	if (Number.isNaN(checked)) return false;
	const days = (now.getTime() - checked) / 86_400_000;
	return days >= 0 && days <= IMAGE_STALE_DAYS;
}

/**
 * The ordered content for a state. Pure, total, and the only place content is gated.
 *
 * Keys are stable across turns on purpose: a card that survives a transition keeps its
 * key, stays mounted and animates position rather than remounting. That is what stops
 * the screen behaving like a slideshow of separate posters.
 */
export function cardsFor(
	state: SessionState,
	proc: Procedure | null,
	lang: Language,
	now: Date,
): Card[] {
	switch (state.phase) {
		case 'submitting':
			// Deliberately empty. Nothing is rendered until the decision is made, because
			// retracting something already shown costs more than a pause.
			return [];

		case 'readback':
			return state.heard ? [{ kind: 'heard', key: 'heard', text: state.heard }] : [];

		case 'guiding': {
			if (!proc || !proc.verified) return [];
			return proc.steps.map((step, i) => {
				const done = state.cursor.done.includes(step.id);
				const active = state.cursor.stepId === step.id;
				const image = step.image && imageIsFresh(step.image, now) ? step.image : null;
				return {
					kind: 'step',
					key: `${proc.id}:${step.id}`,
					index: i + 1,
					of: proc.steps.length,
					instruction: localise(step.instruction, lang),
					state: active ? 'active' : done ? 'done' : 'future',
					// Only the step being worked on shows its picture. Every picture at once
					// is a wall of screenshots on a phone.
					image: active ? image : null,
				};
			});
		}

		case 'answering':
			return state.screen.kind === 'answer'
				? state.screen.facts.map((f) => ({
						kind: 'fact',
						key: `fact:${f.label}`,
						label: f.label,
						value: f.value,
					}))
				: [];

		default:
			return state.screen.kind === 'handoff'
				? [
						{
							kind: 'contact',
							key: 'handoff',
							label: `Call ${state.screen.phone}`,
							phone: state.screen.phone,
						},
					]
				: [];
	}
}

/** Re-exported so callers do not need to reach into procedure.ts for one helper. */
export { stepById };
