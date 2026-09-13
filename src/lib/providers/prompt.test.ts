import { describe, expect, it } from 'vitest';
import { Understanding } from '../understanding';
import { RESPONSE_SCHEMA, systemPrompt } from './prompt';

describe('the restatement', () => {
	it('is required from the model, so every readback has a sentence to confirm', () => {
		expect(RESPONSE_SCHEMA.required).toContain('restatement');
		expect(RESPONSE_SCHEMA.properties.restatement.type).toBe('string');
	});

	it('is explained in the prompt rather than left to the field name', () => {
		expect(systemPrompt()).toMatch(/restatement/);
	});

	it('stays optional in the internal type, so stored history from before still parses', () => {
		const old = { intent: 'wayfinding', confidence: 0.9, language: 'en', reply: 'Okay.' };
		expect(Understanding.safeParse(old).success).toBe(true);
	});

	it('is capped at one short sentence', () => {
		const long = {
			intent: 'wayfinding',
			confidence: 0.9,
			language: 'en',
			reply: 'Okay.',
			restatement: 'x'.repeat(241),
		};
		expect(Understanding.safeParse(long).success).toBe(false);
	});
});
