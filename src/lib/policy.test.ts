import { describe, expect, it } from 'vitest';
import { decide, nextContext, THRESHOLDS } from './policy';
import { anUnderstanding } from './providers/fake';
import { INTENT_LABELS } from './understanding';

const fresh = { consecutiveUnclear: 0 };

describe('decide', () => {
	it('acts only when the model is sure, because acting on a guess sends someone to the wrong service', () => {
		const d = decide(
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.95, reply: 'You qualify.' }),
			fresh,
		);
		expect(d.kind).toBe('act');
		expect(d.say).toBe('You qualify.');
	});

	it('confirms instead of acting in the middle band', () => {
		const d = decide(anUnderstanding({ intent: 'silver_support', confidence: 0.7 }), fresh);
		expect(d.kind).toBe('confirm');
	});

	it('never names a second intent, which would make the user hold both in mind to answer', () => {
		const d = decide(anUnderstanding({ intent: 'wayfinding', confidence: 0.7 }), fresh);
		const others = Object.entries(INTENT_LABELS)
			.filter(([k]) => k !== 'wayfinding')
			.map(([, label]) => label);
		for (const label of others) expect(d.say).not.toContain(label);
	});

	it('offers "something else" so declining is an ordinary answer, not a correction', () => {
		// Acquiescence is the failure mode here: a question that only invites agreement
		// gets agreement from someone who did not parse it. See the confirm-intent skill.
		const d = decide(anUnderstanding({ intent: 'wayfinding', confidence: 0.7 }), fresh);
		expect(d.say).toContain('something else');
	});

	it('does not ask "is that right", which leaks the answer it expects', () => {
		const d = decide(anUnderstanding({ intent: 'chas_subsidy', confidence: 0.7 }), fresh);
		expect(d.say.toLowerCase()).not.toContain('is that right');
	});

	it('names the guess in plain words rather than an intent code', () => {
		const d = decide(anUnderstanding({ intent: 'chas_subsidy', confidence: 0.7 }), fresh);
		expect(d.say).toContain('help paying for a doctor');
		expect(d.say).not.toContain('chas_subsidy');
	});

	it('asks for a repeat below the confirm threshold rather than confirming a guess it does not have', () => {
		const d = decide(anUnderstanding({ intent: 'chas_subsidy', confidence: 0.3 }), fresh);
		expect(d.kind).toBe('repeat');
	});

	it('gives an example when asking for a repeat, because "please repeat" just gets the same audio louder', () => {
		const d = decide(anUnderstanding({ intent: 'chas_subsidy', confidence: 0.3 }), fresh);
		expect(d.say).toContain('You can say something like');
	});

	it('hands off after two unclear turns instead of asking a third time', () => {
		const d = decide(anUnderstanding({ intent: 'chas_subsidy', confidence: 0.3 }), {
			consecutiveUnclear: THRESHOLDS.repeatsBeforeHandoff,
		});
		expect(d.kind).toBe('handoff');
	});

	it('hands off on an explicit request for a person even when confidence is high', () => {
		const d = decide(
			anUnderstanding({ intent: 'human_handoff', confidence: 0.99 }),
			fresh,
		);
		expect(d.kind).toBe('handoff');
	});

	it('hands off when the model flags distress, whatever it thinks the intent is', () => {
		const d = decide(
			anUnderstanding({ intent: 'wayfinding', confidence: 0.99, needsHuman: true }),
			fresh,
		);
		expect(d.kind).toBe('handoff');
	});

	it('never acts silently below the act threshold, at any confidence in the band', () => {
		// The rule the whole safety story rests on, checked across the range rather than
		// at one convenient point.
		for (let c = 0; c < THRESHOLDS.act; c += 0.05) {
			const d = decide(anUnderstanding({ intent: 'chas_subsidy', confidence: c }), fresh);
			expect(d.kind).not.toBe('act');
		}
	});
});

describe('nextContext', () => {
	it('counts consecutive unclear turns', () => {
		const ctx = nextContext(anUnderstanding({ intent: 'chas_subsidy', confidence: 0.2 }), fresh);
		expect(ctx.consecutiveUnclear).toBe(1);
	});

	it('resets the streak after a turn that worked, because struggling once is not being in trouble', () => {
		const ctx = nextContext(anUnderstanding({ intent: 'chas_subsidy', confidence: 0.9 }), {
			consecutiveUnclear: 1,
		});
		expect(ctx.consecutiveUnclear).toBe(0);
	});
});
