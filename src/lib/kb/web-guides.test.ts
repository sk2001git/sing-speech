import { describe, expect, it } from 'vitest';
import type { WebAnswer } from './web-answer';
import { KvGuides, keepAs, memoryKv } from './web-guides';

/**
 * Web answers kept as guides, so the next person is answered from Suara (owner, 2026-09-27:
 * "a self adjusting kb"). Official pages only go straight in; the rest wait for the owner.
 * Kept in Workers KV, one JSON value per guide (owner: "KV with json").
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
const cpf = { question: 'how can I invest my CPF', vector: [1, 0], answer: answer(), language: 'en' as const };
const coin = { question: 'how do I buy bitcoin', vector: [0, 1], answer: answer({ official: false, title_full: 'Buy Bitcoin' }), language: 'en' as const };

function setup(start = T0) {
	let now = start;
	const kv = memoryKv(() => now);
	const store = (refreshMs = 60_000) => new KvGuides(kv, () => now, refreshMs);
	return { kv, store, tick: (ms: number) => (now += ms) };
}

describe('keepAs', () => {
	it('puts a guide from official pages straight in, and holds the rest for review', () => {
		expect(keepAs(answer())).toBe('live');
		expect(keepAs(answer({ official: false }))).toBe('pending');
	});

	it('keeps nothing when there was no answer', () => {
		expect(keepAs(answer({ kind: 'none', steps: [] }))).toBeNull();
	});
});

describe('KvGuides', () => {
	it('serves a live guide to a question near the one that found it', async () => {
		const s = setup().store();
		await s.save(cpf);
		const found = await s.find([0.99, Math.sqrt(1 - 0.99 ** 2)], 'en', 0.86);
		expect(found?.answer.title_full).toBe('How to invest your CPF savings');
		expect(found?.foundAt).toBe('2026-09-27T00:00:00.000Z');
	});

	it('does not serve a guide to a question that is not near, or in another language', async () => {
		const s = setup().store();
		await s.save(cpf);
		expect(await s.find([0.5, Math.sqrt(0.75)], 'en', 0.86)).toBeNull();
		expect(await s.find([1, 0], 'zh-Hans', 0.86)).toBeNull();
	});

	it('never serves a guide waiting for review, but lists it for the owner', async () => {
		const s = setup().store();
		await s.save(coin);
		expect(await s.find([0, 1], 'en', 0.86)).toBeNull();
		expect((await s.list()).map((g) => [g.title, g.status])).toEqual([['Buy Bitcoin', 'pending']]);
	});

	it('serves a reviewed guide once approved, and forgets a discarded one', async () => {
		const s = setup().store();
		const kept = await s.save(coin);
		expect(await s.approve(kept!.id)).toBe(true);
		expect(await s.find([0, 1], 'en', 0.86)).not.toBeNull();
		expect(await s.remove(kept!.id)).toBe(true);
		expect(await s.find([0, 1], 'en', 0.86)).toBeNull();
		expect(await s.list()).toEqual([]);
	});

	it('keeps guides across isolates: a fresh store over the same KV finds them', async () => {
		const { store } = setup();
		await store().save(cpf);
		expect(await store().find([1, 0], 'en', 0.86)).not.toBeNull();
	});

	it('sees another isolate\'s new guide once its copy is refreshed', async () => {
		const { store, tick } = setup();
		const a = store(), b = store();
		expect(await b.find([1, 0], 'en', 0.86)).toBeNull(); // b loads, empty
		await a.save(cpf);
		expect(await b.find([1, 0], 'en', 0.86)).toBeNull(); // b's copy is still fresh
		tick(61_000);
		expect(await b.find([1, 0], 'en', 0.86)).not.toBeNull();
	});

	it('keeps a guide until the owner takes it down, however old: the date found is shown instead', async () => {
		const { store, tick } = setup();
		await store().save(cpf);
		tick(365 * DAY);
		expect((await store().find([1, 0], 'en', 0.86))?.foundAt).toBe('2026-09-27T00:00:00.000Z');
	});

	it('holds a guide the owner added for review, even from government pages', async () => {
		const s = setup().store();
		const kept = await s.save(cpf, { status: 'pending' });
		expect(kept?.status).toBe('pending');
		expect(await s.find([1, 0], 'en', 0.86)).toBeNull();
	});

	it('replaces an older guide for the same question rather than piling up', async () => {
		const s = setup().store();
		await s.save({ ...cpf, answer: answer({ title_full: 'Old' }) });
		await s.save({ ...cpf, answer: answer({ title_full: 'New' }) });
		expect((await s.find([1, 0], 'en', 0.86))?.answer.title_full).toBe('New');
		expect(await s.list()).toHaveLength(1);
	});

	it('sends new wording from other sites back to review: the approval was for the old one', async () => {
		const s = setup().store();
		const kept = await s.save(coin);
		await s.approve(kept!.id);
		await s.save({ ...coin, answer: answer({ official: false, title_full: 'Buy Bitcoin, reworded' }) });
		expect(await s.get(kept!.id)).toMatchObject({ status: 'pending', answer: { title_full: 'Buy Bitcoin, reworded' } });
	});
});
