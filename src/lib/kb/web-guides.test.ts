import { describe, expect, it } from 'vitest';
import type { WebAnswer } from './web-answer';
import { keepAs, MemoryGuides } from './web-guides';

/**
 * Web answers kept as guides, so the next person is answered from Suara (owner, 2026-09-27:
 * "a self adjusting kb"). Official pages only go straight in; the rest wait for the owner.
 */
const answer = (over: Partial<WebAnswer> = {}): WebAnswer => ({
	kind: 'steps',
	title_short: 'Invest CPF',
	title_full: 'How to invest your CPF savings',
	summary: 'Use CPFIS.',
	answer: '',
	answer_urls: [],
	prerequisites: '',
	steps: [{ name: 'Check eligibility', text: 'You must be 18.', confirm_label: 'Checked', source_urls: ['https://www.cpf.gov.sg/a'] }],
	legal: { applies: false, text: '', source_urls: [] },
	disclaimer: 'Not advice.',
	sources: [{ url: 'https://www.cpf.gov.sg/a', title: 'Investing', site: 'CPF Board' }],
	cautions: [],
	dropped: 0,
	official: true,
	...over,
});
const DAY = 86_400_000;
const T0 = Date.parse('2026-09-27T00:00:00Z');

describe('keepAs', () => {
	it('puts a guide from official pages straight in, and holds the rest for review', () => {
		expect(keepAs(answer())).toBe('live');
		expect(keepAs(answer({ official: false }))).toBe('pending');
	});

	it('keeps nothing when there was no answer', () => {
		expect(keepAs(answer({ kind: 'none', steps: [] }))).toBeNull();
	});
});

describe('MemoryGuides', () => {
	it('serves a live guide to a question near the one that found it', () => {
		const store = new MemoryGuides(() => T0);
		store.save({ question: 'how can I invest my CPF', vector: [1, 0], answer: answer(), language: 'en' });
		const found = store.find([0.99, Math.sqrt(1 - 0.99 ** 2)], 'en', 0.86);
		expect(found?.answer.title_full).toBe('How to invest your CPF savings');
		expect(found?.foundAt).toBe('2026-09-27T00:00:00.000Z');
	});

	it('does not serve a guide to a question that is not near', () => {
		const store = new MemoryGuides(() => T0);
		store.save({ question: 'how can I invest my CPF', vector: [1, 0], answer: answer(), language: 'en' });
		expect(store.find([0.5, Math.sqrt(0.75)], 'en', 0.86)).toBeNull();
	});

	it('never serves a guide waiting for review, but lists it', () => {
		const store = new MemoryGuides(() => T0);
		store.save({ question: 'how do I buy bitcoin', vector: [1, 0], answer: answer({ official: false }), language: 'en' });
		expect(store.find([1, 0], 'en', 0.86)).toBeNull();
		expect(store.pending().map((g) => g.question)).toEqual(['how do I buy bitcoin']);
	});

	it('serves a reviewed guide once approved', () => {
		const store = new MemoryGuides(() => T0);
		const kept = store.save({ question: 'how do I buy bitcoin', vector: [1, 0], answer: answer({ official: false }), language: 'en' });
		expect(store.approve(kept!.id)).toBe(true);
		expect(store.find([1, 0], 'en', 0.86)).not.toBeNull();
		expect(store.pending()).toEqual([]);
	});

	it('keeps each language apart', () => {
		const store = new MemoryGuides(() => T0);
		store.save({ question: 'how can I invest my CPF', vector: [1, 0], answer: answer(), language: 'en' });
		expect(store.find([1, 0], 'zh-Hans', 0.86)).toBeNull();
	});

	it('lets a guide go after 30 days, so rules and prices do not go stale', () => {
		let now = T0;
		const store = new MemoryGuides(() => now);
		store.save({ question: 'how can I invest my CPF', vector: [1, 0], answer: answer(), language: 'en' });
		now = T0 + 29 * DAY;
		expect(store.find([1, 0], 'en', 0.86)).not.toBeNull();
		now = T0 + 31 * DAY;
		expect(store.find([1, 0], 'en', 0.86)).toBeNull();
	});

	it('replaces an older guide for the same question rather than piling up', () => {
		const store = new MemoryGuides(() => T0);
		store.save({ question: 'how can I invest my CPF', vector: [1, 0], answer: answer({ title_full: 'Old' }), language: 'en' });
		store.save({ question: 'how can I invest my CPF', vector: [1, 0], answer: answer({ title_full: 'New' }), language: 'en' });
		expect(store.find([1, 0], 'en', 0.86)?.answer.title_full).toBe('New');
		expect(store.size()).toBe(1);
	});
});
