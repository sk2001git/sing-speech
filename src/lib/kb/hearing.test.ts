import { describe, expect, it } from 'vitest';
import { Hearing, HEARING_SCHEMA, hearingPrompt, replyLanguage } from './hearing';

const request = {
	greeting: false,
	meaning_en: 'My doctor referred me to A&E. Is it cheaper?',
	short: 'A&E referral costs',
	sentence: 'Your doctor sent you to A&E, and you want to know if it costs less.',
	language: 'en',
	confidence: 0.9,
};

describe('Hearing', () => {
	it('accepts a request', () => {
		expect(Hearing.safeParse(request).success).toBe(true);
	});

	it('accepts a bare greeting with nothing to search', () => {
		expect(Hearing.safeParse({ ...request, greeting: true, meaning_en: '' }).success).toBe(true);
	});

	it('rejects a request with no English meaning, since there would be nothing to search', () => {
		expect(Hearing.safeParse({ ...request, meaning_en: '' }).success).toBe(false);
	});

	it('keeps what they said, word for word, when the route has it', () => {
		const r = Hearing.safeParse({ ...request, said: 'my doctor give me one letter, go emergency cheaper or not' });
		expect(r.success && r.data.said).toBe('my doctor give me one letter, go emergency cheaper or not');
	});

	it('rejects a "You asked" line too long for one row', () => {
		expect(Hearing.safeParse({ ...request, short: 'a'.repeat(41) }).success).toBe(false);
	});
});

describe('replyLanguage', () => {
	it('follows Chinese when Chinese is heard, even with English chosen', () => {
		// Owner, 2026-09-28: "use chinese as the display its okay if internally we change to
		// english for matching". Reverses dec-suara-0007's per-turn rule for Chinese.
		expect(replyLanguage('en', 'zh')).toBe('zh-Hans');
		expect(replyLanguage('en', 'en')).toBe('en');
		expect(replyLanguage('en', 'other')).toBe('en');
	});

	it('uses Chinese when Chinese is chosen', () => {
		expect(replyLanguage('zh-Hans', 'en')).toBe('zh-Hans');
	});

	it('follows the spoken language on Automatic, and falls back to English', () => {
		expect(replyLanguage('auto', 'zh')).toBe('zh-Hans');
		expect(replyLanguage('auto', 'other')).toBe('en');
	});
});

describe('hearingPrompt', () => {
	const prompt = hearingPrompt();

	it('asks for the meaning in English whatever language was spoken, because the index is English', () => {
		expect(prompt).toMatch(/meaning_en/);
		expect(prompt).toMatch(/English/);
	});

	it('tells a greeting apart from a request', () => {
		expect(prompt).toMatch(/greeting/);
	});

	it('never offers to hand the person over: Suara is a knowledge base, not a helpdesk', () => {
		expect(prompt).not.toMatch(/needsHuman|helpline|hand (?:off|over)|transfer/i);
	});

	it('requires every field in the response schema', () => {
		expect([...HEARING_SCHEMA.required].sort()).toEqual(['confidence', 'greeting', 'language', 'meaning_en', 'said', 'sentence', 'short']);
	});
});
