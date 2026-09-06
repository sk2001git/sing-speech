import { describe, expect, it } from 'vitest';
import { Understanding } from './understanding';

const valid = {
	intent: 'chas_subsidy',
	confidence: 0.9,
	language: 'sg',
	reply: 'You can get help paying.',
	needsHuman: false,
};

describe('Understanding', () => {
	it('rejects an intent the model invented', () => {
		// A schema-constrained response is still a model output. An intent outside the
		// closed set must fail here, not reach the policy and get acted on.
		expect(() => Understanding.parse({ ...valid, intent: 'apply_for_hdb' })).toThrow();
	});

	it('rejects a confidence outside 0 to 1, which would defeat every threshold', () => {
		expect(() => Understanding.parse({ ...valid, confidence: 1.4 })).toThrow();
		expect(() => Understanding.parse({ ...valid, confidence: -0.1 })).toThrow();
	});

	it('rejects an empty reply, since there would be nothing to say aloud', () => {
		expect(() => Understanding.parse({ ...valid, reply: '' })).toThrow();
	});

	it('caps reply length, because a long answer read aloud is a failure not a feature', () => {
		expect(() => Understanding.parse({ ...valid, reply: 'a'.repeat(401) })).toThrow();
	});

	it('defaults slots and needsHuman so a terse provider response is still usable', () => {
		const u = Understanding.parse({
			intent: 'wayfinding',
			confidence: 0.9,
			language: 'en',
			reply: 'Go to Block 123.',
		});
		expect(u.slots).toEqual({});
		expect(u.needsHuman).toBe(false);
	});

	it('has no transcript field, because the transcript is the thing this design removes', () => {
		const u = Understanding.parse({ ...valid, transcript: 'wa ai khuann i-seng' });
		expect(u).not.toHaveProperty('transcript');
	});
});
