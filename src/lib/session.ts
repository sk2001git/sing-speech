import type { Cursor } from './procedure';
import type { Screen } from './uispec';
import type { Understanding } from './understanding';

/** Why the microphone is unavailable. Each one gets different wording on screen. */
export type MicFailure = 'permission' | 'no-device' | 'insecure';

export const PHASES = [
	'idle',
	'arming',
	'recording',
	'submitting',
	'readback',
	'guiding',
	'answering',
	'denied',
	'offline',
] as const;

export type Phase = (typeof PHASES)[number];

/**
 * Where the client is, as one value.
 *
 * This replaces a `recording` boolean and a `busy` boolean, which between them describe
 * four combinations of which two are nonsense. `arming`, `readback`, `guiding`, `denied`
 * and `offline` had no representation at all — which is precisely why the permission
 * moment and the wait for a reply both felt like nothing was happening. They were not
 * states, so they could not have behaviour.
 */
export type SessionState =
	| { phase: 'idle'; screen: Screen }
	| { phase: 'arming'; screen: Screen }
	| { phase: 'recording'; screen: Screen; heard: string }
	| { phase: 'submitting'; screen: Screen; heard: string }
	| { phase: 'readback'; screen: Screen; heard: string; understanding: Understanding }
	| { phase: 'guiding'; screen: Screen; cursor: Cursor }
	| { phase: 'answering'; screen: Screen }
	| { phase: 'denied'; screen: Screen; reason: MicFailure }
	| { phase: 'offline'; screen: Screen };

export const EVENTS = [
	'PRESS',
	'GRANTED',
	'DENIED',
	'CAPTION',
	'RELEASE',
	'REPLY',
	'FAIL',
	'ENTER',
	'CONFIRM',
	'ADVANCE',
	'FINISH',
	'SPOKEN',
] as const;

export type SessionEvent =
	| { type: 'PRESS' }
	| { type: 'GRANTED' }
	| { type: 'DENIED'; reason: MicFailure }
	| { type: 'CAPTION'; text: string }
	| { type: 'RELEASE' }
	| { type: 'REPLY'; screen: Screen; understanding: Understanding }
	| { type: 'FAIL' }
	| { type: 'ENTER'; cursor: Cursor }
	| { type: 'CONFIRM'; accepted: boolean }
	| { type: 'ADVANCE'; cursor: Cursor }
	| { type: 'FINISH' }
	| { type: 'SPOKEN' };

export function initialState(screen: Screen): SessionState {
	return { phase: 'idle', screen };
}

/** Whether the speak button does anything. Drives both the UI and the dead-end test. */
export function canPress(state: SessionState): boolean {
	return (
		state.phase === 'idle' ||
		state.phase === 'guiding' ||
		state.phase === 'denied' ||
		state.phase === 'offline' ||
		state.phase === 'readback'
	);
}

/**
 * One transition. Total: an event a phase does not handle returns the state unchanged.
 *
 * Totality is not tidiness. The driver fires events from timers, from the network and
 * from the microphone, all of which can arrive late — after the user has already moved
 * on. A stale event must be ignored, never crash the only screen this person has.
 */
export function next(state: SessionState, event: SessionEvent): SessionState {
	switch (event.type) {
		case 'PRESS':
			return canPress(state) ? { phase: 'arming', screen: state.screen } : state;

		case 'GRANTED':
			return state.phase === 'arming'
				? { phase: 'recording', screen: state.screen, heard: '' }
				: state;

		case 'DENIED':
			return state.phase === 'arming'
				? { phase: 'denied', screen: state.screen, reason: event.reason }
				: state;

		case 'CAPTION':
			return state.phase === 'recording' ? { ...state, heard: event.text } : state;

		case 'RELEASE':
			return state.phase === 'recording'
				? { phase: 'submitting', screen: state.screen, heard: state.heard }
				: state;

		case 'REPLY':
			// Readback always comes first. Nothing renders a decision before showing the
			// person what was heard, and nothing enters a procedure without passing here.
			return state.phase === 'submitting'
				? {
						phase: 'readback',
						screen: event.screen,
						heard: state.heard,
						understanding: event.understanding,
					}
				: state;

		case 'FAIL':
			return state.phase === 'submitting'
				? { phase: 'offline', screen: state.screen }
				: state;

		case 'ENTER':
			return state.phase === 'readback'
				? { phase: 'guiding', screen: state.screen, cursor: event.cursor }
				: state;

		case 'CONFIRM':
			if (state.phase !== 'readback') return state;
			return event.accepted
				? { phase: 'answering', screen: state.screen }
				: { phase: 'idle', screen: state.screen };

		case 'ADVANCE':
			return state.phase === 'guiding' ? { ...state, cursor: event.cursor } : state;

		case 'FINISH':
			return state.phase === 'guiding'
				? { phase: 'answering', screen: state.screen }
				: state;

		case 'SPOKEN':
			return state.phase === 'answering'
				? { phase: 'idle', screen: state.screen }
				: state;
	}
}
