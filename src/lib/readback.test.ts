import { describe, expect, it } from 'vitest';
import { anUnderstanding } from './providers/fake';
import { readbackFor } from './readback';
import type { SessionState } from './session';
import type { Screen } from './uispec';
import type { Understanding } from './understanding';

const ANSWER: Screen = { kind: 'answer', title: 'Help', say: 'You can get help at the clinic.', facts: [] };

const at = (screen: Screen, understanding: Understanding) =>
	({ phase: 'readback', screen, heard: '', understanding }) as Extract<SessionState, { phase: 'readback' }>;

describe('readbackFor', () => {
	it('shows the model restatement as the sentence to confirm', () => {
		const u = anUnderstanding({
			intent: 'chas_subsidy',
			confidence: 0.93,
			restatement: 'You need help paying for your clinic visits.',
		});
		const r = readbackFor(at(ANSWER, u));
		expect(r.sentence).toBe('You need help paying for your clinic visits.');
		expect(r.spoken).toContain('You need help paying for your clinic visits.');
		expect(r.canContinue).toBe(true);
	});

	it('falls back to the intent label when the model gave no restatement', () => {
		const r = readbackFor(at(ANSWER, anUnderstanding({ intent: 'chas_subsidy', confidence: 0.93 })));
		expect(r.sentence).toBe('You need help paying for a doctor or medicine.');
	});

	it('offers "something else" as an ordinary answer, never a bare "is that right"', () => {
		const r = readbackFor(at(ANSWER, anUnderstanding({ intent: 'wayfinding', confidence: 0.9 })));
		expect(r.spoken).toMatch(/something else/);
	});

	it('speaks the policy question unchanged on a confirm screen', () => {
		const say = 'I heard that you need the Silver Support payout. Have I got that right, or is it something else?';
		const screen: Screen = { kind: 'confirm', intent: 'silver_support', say, yes: 'Yes', no: 'No' };
		const r = readbackFor(at(screen, anUnderstanding({ intent: 'silver_support', confidence: 0.7 })));
		expect(r.spoken).toBe(say);
		expect(r.canContinue).toBe(true);
	});

	it('cannot continue from a repeat or a handoff', () => {
		const u = anUnderstanding({ intent: 'human_handoff', confidence: 0.4 });
		const repeat: Screen = { kind: 'repeat', say: 'Sorry, say it again.', example: 'I need help' };
		const handoff: Screen = { kind: 'handoff', say: 'I will get someone.', phone: '1800 222 0000' };
		expect(readbackFor(at(repeat, u)).canContinue).toBe(false);
		expect(readbackFor(at(handoff, u)).canContinue).toBe(false);
	});
});
