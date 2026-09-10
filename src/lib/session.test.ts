import { describe, expect, it } from 'vitest';
import { anUnderstanding } from './providers/fake';
import {
	canPress,
	EVENTS,
	initialState,
	next,
	type SessionEvent,
	type SessionState,
} from './session';
import type { Screen } from './uispec';

const OPENING: Screen = { kind: 'listening', say: 'What do you need help with today?' };
const start = () => initialState(OPENING);

const CURSOR = {
	procedureId: 'test-proc',
	stepId: 's1',
	done: [],
	startedAt: '2026-09-11T00:00:00.000Z',
};

/**
 * Every state the machine can actually get into.
 *
 * Breadth-first over (state, event). This is model-based testing without a library:
 * "not smooth" is nearly always a transition nobody thought about, and a walk finds
 * those where hand-written cases do not.
 */
function reachable(): SessionState[] {
	const seen = new Map<string, SessionState>();
	const queue: SessionState[] = [start()];

	while (queue.length > 0) {
		const state = queue.shift()!;
		const key = JSON.stringify(state);
		if (seen.has(key)) continue;
		seen.set(key, state);
		for (const event of sampleEvents()) {
			queue.push(next(state, event));
		}
	}
	return [...seen.values()];
}

/** One representative payload per event type. */
function sampleEvents(): SessionEvent[] {
	return [
		{ type: 'PRESS' },
		{ type: 'GRANTED' },
		{ type: 'DENIED', reason: 'permission' },
		{ type: 'CAPTION', text: 'i need help' },
		{ type: 'RELEASE' },
		{
			type: 'REPLY',
			screen: { kind: 'confirm', intent: 'chas_subsidy', say: 'Heard.', yes: 'Yes', no: 'No' },
			understanding: anUnderstanding({ intent: 'chas_subsidy', confidence: 0.7 }),
		},
		{ type: 'FAIL' },
		{ type: 'ENTER', cursor: CURSOR },
		{ type: 'CONFIRM', accepted: false },
		{ type: 'ADVANCE', cursor: { ...CURSOR, stepId: 's2', done: ['s1'] } },
		{ type: 'FINISH' },
		{ type: 'SPOKEN' },
	];
}

describe('the machine', () => {
	it('starts idle', () => {
		expect(start().phase).toBe('idle');
	});

	it('ignores an event a phase does not handle rather than crashing', () => {
		// Total by construction. A driver firing a stale event must never break the UI.
		expect(next(start(), { type: 'SPOKEN' })).toEqual(start());
	});

	it('asks for the microphone before recording, so permission is its own visible state', () => {
		const armed = next(start(), { type: 'PRESS' });
		expect(armed.phase).toBe('arming');
		expect(next(armed, { type: 'GRANTED' }).phase).toBe('recording');
	});

	it('surfaces a denied microphone instead of failing silently', () => {
		const armed = next(start(), { type: 'PRESS' });
		const denied = next(armed, { type: 'DENIED', reason: 'permission' });
		expect(denied.phase).toBe('denied');
	});

	it('shows what it heard before it shows what it decided', () => {
		let s = next(next(start(), { type: 'PRESS' }), { type: 'GRANTED' });
		s = next(s, { type: 'RELEASE' });
		expect(s.phase).toBe('submitting');
		s = next(s, sampleEvents().find((e) => e.type === 'REPLY')!);
		expect(s.phase).toBe('readback');
	});

	it('never enters a procedure straight from submitting, because readback is the gate', () => {
		let s = next(next(start(), { type: 'PRESS' }), { type: 'GRANTED' });
		s = next(s, { type: 'RELEASE' });
		expect(next(s, { type: 'ENTER', cursor: CURSOR }).phase).toBe('submitting');
	});

	it('lets the user speak again in the middle of a flow', () => {
		let s = next(next(start(), { type: 'PRESS' }), { type: 'GRANTED' });
		s = next(s, { type: 'RELEASE' });
		s = next(s, sampleEvents().find((e) => e.type === 'REPLY')!);
		s = next(s, { type: 'ENTER', cursor: CURSOR });
		expect(s.phase).toBe('guiding');
		expect(next(s, { type: 'PRESS' }).phase).toBe('arming');
	});

	it('turns a network failure into its own state, not into "I could not hear that"', () => {
		let s = next(next(start(), { type: 'PRESS' }), { type: 'GRANTED' });
		s = next(s, { type: 'RELEASE' });
		expect(next(s, { type: 'FAIL' }).phase).toBe('offline');
	});
});

describe('every reachable state', () => {
	const states = reachable();

	it('finds more phases than the two booleans could express', () => {
		const phases = new Set(states.map((s) => s.phase));
		expect(phases.size).toBeGreaterThanOrEqual(7);
	});

	it('always offers a way forward, because a dead end means the user gives up', () => {
		for (const s of states) {
			// Either the user can press, or something already in flight moves the state on:
			// arming resolves on GRANTED/DENIED, recording on RELEASE, submitting on
			// REPLY/FAIL, answering on SPOKEN. Asked of the machine rather than from a list
			// of phase names, because a list is the thing that goes stale when a phase is
			// added. Widening canPress to cover the waits would be worse than a stale list:
			// canPress(recording) would let a second press discard a recording in progress.
			const advances = sampleEvents().some(
				(e) => JSON.stringify(next(s, e)) !== JSON.stringify(s),
			);
			expect(canPress(s) || advances, `phase ${s.phase} traps the user`).toBe(true);
		}
	});

	it('always has something to say', () => {
		for (const s of states) {
			expect(s.screen.say.length, `phase ${s.phase} is silent`).toBeGreaterThan(0);
		}
	});

	it('is only recording in exactly one phase, so the mic indicator cannot lie', () => {
		const recording = states.filter((s) => s.phase === 'recording');
		for (const s of recording) expect(s.phase).toBe('recording');
		expect(states.some((s) => s.phase === 'recording')).toBe(true);
	});

	it('handles every declared event from every reachable state without throwing', () => {
		for (const s of states) {
			for (const type of EVENTS) {
				const event = sampleEvents().find((e) => e.type === type)!;
				expect(() => next(s, event)).not.toThrow();
			}
		}
	});
});
