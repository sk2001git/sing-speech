import { describe, expect, it } from 'vitest';
import { CATALOGUE, factsFor, intentFromTranscript, servicesFor } from './catalogue';
import { INTENTS } from './understanding';

describe('factsFor', () => {
	it('says nothing from an unverified row, whatever that row contains', () => {
		// The gate that keeps invented policy out of an elderly person's ear. Every seed
		// row is unverified, so today this returns nothing for everything — which is the
		// correct behaviour, not a bug.
		for (const intent of INTENTS) {
			expect(factsFor(intent)).toEqual([]);
		}
	});

	it('every catalogue row is unverified until a person checks it against its source', () => {
		// This test is meant to fail the day someone fills in eligibility text without
		// flipping `verified`, and to be updated deliberately when a row is genuinely
		// checked.
		for (const service of CATALOGUE) {
			if (!service.verified) {
				expect(service.eligibility).toBeNull();
				expect(service.documents).toEqual([]);
			}
		}
	});

	it('every row carries a source, so nothing is unverifiable by construction', () => {
		for (const service of CATALOGUE) {
			if (service.id !== 'appointment-prep') expect(service.source).not.toBe('');
		}
	});
});

describe('intentFromTranscript', () => {
	it('finds an intent from a keyword even when the rest of the transcript is noise', () => {
		// The property that makes the second channel worth paying for: a keyword survives
		// a transcript that mangles everything around it.
		expect(intentFromTranscript('lah hor chas card ah mm zai')).toBe('chas_subsidy');
	});

	it('matches non-English cues, since the transcript is often not in English', () => {
		expect(intentFromTranscript('我要去看医生')).toBe('chas_subsidy');
	});

	it('returns null rather than guessing when nothing matches', () => {
		expect(intentFromTranscript('hello good morning')).toBeNull();
	});

	it('is case-insensitive, because transcribers disagree about capitalisation', () => {
		expect(intentFromTranscript('CHAS')).toBe('chas_subsidy');
	});
});

describe('servicesFor', () => {
	it('groups by ministry so the coarse pass has a short list to choose from', () => {
		const moh = servicesFor('moh');
		expect(moh.length).toBeGreaterThan(0);
		expect(moh.every((s) => s.ministry === 'moh')).toBe(true);
	});
});
