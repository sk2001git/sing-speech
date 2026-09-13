import { describe, expect, it } from 'vitest';
import { anUnderstanding } from './providers/fake';
import { initialState, next, type SessionState } from './session';
import type { Screen } from './uispec';

const OPENING: Screen = { kind: 'listening', say: 'What do you need help with today?' };
const ANSWER: Screen = {
	kind: 'answer',
	title: 'Help paying for a doctor or medicine',
	say: 'You can get help paying at the clinic.',
	facts: [],
};

const readback: SessionState = {
	phase: 'readback',
	screen: { kind: 'confirm', intent: 'chas_subsidy', say: 'Heard.', yes: 'Yes', no: 'No' },
	heard: '',
	understanding: anUnderstanding({ intent: 'chas_subsidy', confidence: 0.7 }),
};

describe('screens that travel with an event', () => {
	it('carries the answer screen into answering when the readback is accepted', () => {
		expect(next(readback, { type: 'CONFIRM', accepted: true, screen: ANSWER })).toEqual({
			phase: 'answering',
			screen: ANSWER,
		});
	});

	it('keeps the current screen when accepted without one', () => {
		const s = next(readback, { type: 'CONFIRM', accepted: true });
		expect(s.screen).toEqual(readback.screen);
	});

	it('carries a closing screen out of a finished flow', () => {
		const guiding: SessionState = {
			phase: 'guiding',
			screen: OPENING,
			cursor: { procedureId: 'p', stepId: 's1', done: [], startedAt: '2026-09-13T00:00:00.000Z' },
		};
		expect(next(guiding, { type: 'FINISH', screen: ANSWER })).toEqual({
			phase: 'answering',
			screen: ANSWER,
		});
	});
});

describe('a failed connection', () => {
	it('is offline while arming, not a refused microphone, because the wording differs', () => {
		const armed = next(initialState(OPENING), { type: 'PRESS' });
		expect(next(armed, { type: 'FAIL' }).phase).toBe('offline');
	});
});
