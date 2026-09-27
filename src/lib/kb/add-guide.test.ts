import { describe, expect, it, vi } from 'vitest';
import { addGuide } from './add-guide';
import type { WebAnswer, WebStage } from './web-answer';
import { KvGuides, memoryKv } from './web-guides';

/** The owner types a question; Suara searches the web and holds the guide for them to check. */
const answer = (over: Partial<WebAnswer> = {}): WebAnswer =>
	({
		kind: 'steps',
		title_full: 'Renew your passport',
		steps: [{ name: 'Apply online', text: 'Use the ICA site.', confirm_label: 'Done', source_urls: ['https://www.ica.gov.sg/a'] }],
		sources: [{ url: 'https://www.ica.gov.sg/a', title: 'Passport', site: 'ICA' }],
		official: true,
		...over,
	}) as WebAnswer;

describe('addGuide', () => {
	it('searches, reports stages, and keeps the guide waiting, even from government pages', async () => {
		const store = new KvGuides(memoryKv());
		const stages: WebStage[] = [];
		const search = vi.fn(async (_q: string, onStage: (s: WebStage) => void) => {
			onStage({ stage: 'searching' });
			return answer();
		});
		const embed = vi.fn(async () => [1, 0]);
		const r = await addGuide('How do I renew my passport?', { search, embed, store, onStage: (s) => stages.push(s) });
		expect(r).toMatchObject({ ok: true, guide: { status: 'pending', question: 'How do I renew my passport?' } });
		expect(stages).toEqual([{ stage: 'searching' }]);
		expect(embed).toHaveBeenCalledWith('How do I renew my passport?');
		expect((await store.list()).map((g) => g.status)).toEqual(['pending']);
	});

	it('keeps nothing and says so when the web had no reliable answer', async () => {
		const store = new KvGuides(memoryKv());
		const r = await addGuide('q', { search: async () => answer({ kind: 'none', steps: [] }), embed: async () => [1, 0], store, onStage: () => {} });
		expect(r).toEqual({ ok: false, error: 'The web had no reliable answer to that.' });
		expect(await store.list()).toEqual([]);
	});

	it('says plainly when the search itself failed', async () => {
		const store = new KvGuides(memoryKv());
		const r = await addGuide('q', {
			search: async () => {
				throw new Error('web search 429');
			},
			embed: async () => [1, 0],
			store,
			onStage: () => {},
		});
		expect(r).toEqual({ ok: false, error: 'The web search failed. Try again in a moment.' });
	});
});
