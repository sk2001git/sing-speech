import { describe, expect, it, vi } from 'vitest';
import example from '../../../docs/knowledge-base/examples/sg.moh.gpfirst-emergency-referral.json';
import type { Draft } from './compose';
import { parseEntry, type Entry } from './entry';
import { buildRawIndex, type RawDoc } from './raw-store';
import { MemoryTranslations, runSearch, type Corpus, type SearchDeps } from './search';

/**
 * Tier A holds one entry, about something else entirely. Tier B holds the official page
 * that answers the question. What the person gets should come from the page.
 */
const AT = '2026-09-18T14:00:00.000Z';
const T = { strong: 0.6, weak: 0.45, floor: 0.3 };

function entry(id: string): Entry {
	const r = parseEntry(structuredClone(example));
	if (!r.ok) throw new Error(r.errors.join('\n'));
	const e = r.entry;
	e.id = id;
	e.verification = { status: 'grounded', checks: [] };
	return e;
}

/** One entry, and a query vector at right angles to it: nothing in Tier A is near. */
function corpus(): Corpus {
	const e = entry('sg.moh.gpfirst-emergency-referral');
	return { entries: new Map([[e.id, e]]), vectors: [{ entryId: e.id, vector: [0, 1] }] };
}

const doc: RawDoc = {
	id: 'cm8qljjgm00mx6vqhm53h5lk0',
	agency: 'cpf',
	url: 'https://ask.gov.sg/cpf/questions/cm8qljjgm00mx6vqhm53h5lk0',
	title: 'Can I use my MediSave to pay for my family member’s medical bills?',
	text: [
		'You may use your MediSave for yourself and your approved dependants: your spouse, children, parents and grandparents.',
		'Tell the hospital or clinic that you wish to use MediSave, and sign the Medical Claims Authorisation Form.',
	].join('\n'),
	topics: ['Healthcare Financing / MediSave'],
	useful: 12,
	updatedAt: '2026-05-04T02:00:00.000Z',
};

const draft: Draft = {
	kind: 'process',
	short: 'MediSave family',
	full: 'Paying a family member’s bill with MediSave',
	summary: 'You may use your MediSave for your parents.',
	summary_quote: 'You may use your MediSave for yourself and your approved dependants: your spouse, children, parents and grandparents.',
	steps: [
		{
			name: 'Tell the hospital',
			text: 'Tell the hospital you wish to use MediSave and sign the Medical Claims Authorisation Form.',
			confirm_label: 'I have told them',
			quote: 'Tell the hospital or clinic that you wish to use MediSave, and sign the Medical Claims Authorisation Form.',
		},
	],
	details: [],
	phrasings: ['use medisave for my father bill', 'pay parent hospital bill with medisave', 'medisave for family'],
};

function deps(over: Partial<SearchDeps> = {}): SearchDeps {
	return {
		corpus: corpus(),
		embed: async () => [1, 0],
		cache: new MemoryTranslations(),
		thresholds: T,
		translateBudgetMs: 50,
		now: () => AT,
		raw: buildRawIndex([doc]),
		write: async () => JSON.stringify(draft),
		...over,
	};
}

const ask = (query: string) => ({ kind: 'text' as const, query, offset: 0, reply: 'en' as const });

describe('a question Tier A cannot answer', () => {
	it('is answered from the crawled page instead of turned away', async () => {
		const r = await runSearch(ask('can I use my CPF to pay my father hospital bill'), deps());
		expect(r.kind).toBe('results');
		if (r.kind !== 'results') return;
		expect(r.result.cards).toHaveLength(1);
		expect(r.result.cards[0]!.title.full).toBe('Paying a family member’s bill with MediSave');
		expect(r.result.cards[0]!.steps).toHaveLength(1);
		expect(r.result.cards[0]!.sources[0]!.url).toBe(doc.url);
	});

	it('is still turned away honestly when the crawl holds nothing either', async () => {
		const r = await runSearch(ask('when is the next bus to Tampines'), deps());
		expect(r.kind).toBe('nothing');
	});

	it('does not call the model when the crawl holds nothing', async () => {
		const write = vi.fn(async () => JSON.stringify(draft));
		await runSearch(ask('when is the next bus to Tampines'), deps({ write }));
		expect(write).not.toHaveBeenCalled();
	});

	it('is turned away rather than shown a card the page does not support', async () => {
		const invented = { ...draft, summary_quote: 'MediSave pays for everything.' };
		const r = await runSearch(ask('can I use my CPF to pay my father hospital bill'), deps({ write: async () => JSON.stringify(invented) }));
		expect(r.kind).toBe('nothing');
	});

	it('is kept, so the next person is answered without a model call', async () => {
		const write = vi.fn(async () => JSON.stringify(draft));
		const shared = deps({ write });
		await runSearch(ask('can I use my CPF to pay my father hospital bill'), shared);
		expect(write).toHaveBeenCalledTimes(1);
		expect(shared.corpus.entries.has('sg.cpf.paying-a-family-members-bill-with-medisave')).toBe(true);

		// Second time round the entry is in Tier A, so the vector search finds it and the
		// model is never asked again.
		const again = await runSearch(ask('can I use my CPF to pay my father hospital bill'), shared);
		expect(write).toHaveBeenCalledTimes(1);
		expect(again.kind).toBe('results');
	});

	it('is left alone when no writer is configured', async () => {
		const r = await runSearch(ask('can I use my CPF to pay my father hospital bill'), deps({ write: undefined }));
		expect(r.kind).toBe('nothing');
	});

	it('goes first when the entries are only a weak fit, with those entries behind it', async () => {
		// cosine 0.5 against the query: above the floor, below strong. The most dangerous
		// answer in the product, because a card about something else looks just as official.
		const weak = corpus();
		weak.vectors = [{ entryId: 'sg.moh.gpfirst-emergency-referral', vector: [0.5, Math.sqrt(1 - 0.25)] }];
		const r = await runSearch(ask('can I use my CPF to pay my father hospital bill'), deps({ corpus: weak }));
		expect(r.kind).toBe('results');
		if (r.kind !== 'results') return;
		expect(r.result.cards.map((c) => c.id)).toEqual([
			'sg.cpf.paying-a-family-members-bill-with-medisave',
			'sg.moh.gpfirst-emergency-referral',
		]);
	});

	it('leaves a weak fit as it was when the model cannot be grounded', async () => {
		const weak = corpus();
		weak.vectors = [{ entryId: 'sg.moh.gpfirst-emergency-referral', vector: [0.5, Math.sqrt(1 - 0.25)] }];
		const invented = { ...draft, summary_quote: 'MediSave pays for everything.' };
		const r = await runSearch(
			ask('can I use my CPF to pay my father hospital bill'),
			deps({ corpus: weak, write: async () => JSON.stringify(invented) }),
		);
		expect(r.kind).toBe('results');
		if (r.kind !== 'results') return;
		expect(r.result.cards.map((c) => c.id)).toEqual(['sg.moh.gpfirst-emergency-referral']);
	});

	it('does not write a new card while someone is paging through the ones they have', async () => {
		const weak = corpus();
		weak.vectors = [{ entryId: 'sg.moh.gpfirst-emergency-referral', vector: [0.5, Math.sqrt(1 - 0.25)] }];
		const write = vi.fn(async () => JSON.stringify(draft));
		await runSearch({ ...ask('can I use my CPF to pay my father hospital bill'), offset: 6 }, deps({ corpus: weak, write }));
		expect(write).not.toHaveBeenCalled();
	});

	it('never reaches Tier B when Tier A already has something near enough', async () => {
		const write = vi.fn(async () => JSON.stringify(draft));
		// Query vector now points at the held entry.
		const r = await runSearch(ask('doctor sent me to the emergency department'), deps({ embed: async () => [0, 1], write }));
		expect(r.kind).toBe('results');
		expect(write).not.toHaveBeenCalled();
	});
});
