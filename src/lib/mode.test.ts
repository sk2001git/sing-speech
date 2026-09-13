import { describe, expect, it } from 'vitest';
import { micFailure } from './mic';
import { resolveMode } from './mode';

describe('resolveMode', () => {
	it('defaults to gemini, the original flow', () => {
		expect(resolveMode(null, undefined)).toBe('gemini');
	});

	it('uses the configured mode', () => {
		expect(resolveMode(null, 'openai')).toBe('openai');
	});

	it('lets ?mode= override config for review', () => {
		expect(resolveMode('gemini', 'openai')).toBe('gemini');
		expect(resolveMode('openai', undefined)).toBe('openai');
	});

	it('ignores an unknown value rather than selecting nothing', () => {
		expect(resolveMode('luna', 'nope')).toBe('gemini');
	});
});

describe('micFailure', () => {
	it('names an insecure origin first, since nothing else can be fixed until it is', () => {
		expect(micFailure({ name: 'NotAllowedError' }, false)).toBe('insecure');
	});

	it('tells a missing microphone apart from a refused one', () => {
		expect(micFailure({ name: 'NotFoundError' }, true)).toBe('no-device');
		expect(micFailure({ name: 'NotAllowedError' }, true)).toBe('permission');
	});

	it('treats anything unrecognised as a permission problem, which has an instruction', () => {
		expect(micFailure(new Error('weird'), true)).toBe('permission');
	});
});
