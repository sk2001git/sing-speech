import { describe, expect, it, vi } from 'vitest';
import example from '../../../docs/knowledge-base/examples/sg.moh.gpfirst-emergency-referral.json';
import { parseEntry, type Entry } from './entry';
import type { Draft } from './compose';
import type { Hearing } from './hearing';
import { buildRawIndex, type RawDoc } from './raw-store';
import { MemoryTranslations, runSearch, type Corpus, type SearchDeps } from './search';

/**
 * Whether the six nearest cards actually answer the question (owner, 2026-09-27: "only
 * search on web if top6 card are not relevant enough", e.g. "how can I invest my CPF" came
 * back a strong match of CPF cards, none of them about investing).
 */
const T = { strong: 0.6, weak: 0.45, floor: 0.3 };

function entry(id: string, title: string): Entry {
	const r = parseEntry(structuredClone(example));
	if (!r.ok) throw new Error(r.errors.join('\n'));
	const e = r.entry;
	e.id = id;
	e.title = { short: title.slice(0, 16), full: title };
	e.verification = { status: 'grounded', checks: [] };
	return e;
}

function corpus(): Corpus {
	const entries = Array.from({ length: 8 }, (_, i) => entry(`sg.cpf.e${i}`, `CPF ${i}`));
	const vectors = entries.map((e, i) => {
		const s = 0.9 - i * 0.02;
		return { entryId: e.id, vector: [s, Math.sqrt(1 - s * s)] };
	});
	return { entries: new Map(entries.map((e) => [e.id, e])), vectors };
}

const hearing: Hearing = {
	greeting: false,
	meaning_en: 'can I use my medisave to pay my father hospital bill',
	short: 'MediSave for father',
	sentence: 'You want to pay your father’s hospital bill with MediSave.',
	language: 'en',
	confidence: 0.9,
};

/** An official page on the question, and the card the writer makes from it (as search-ondemand.test.ts). */
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
		hear: async () => hearing,
		cache: new MemoryTranslations(),
		thresholds: T,
		translateBudgetMs: 50,
		now: () => '2026-09-27T08:00:00.000Z',
		...over,
	};
}
const speech = { kind: 'speech' as const, audioBase64: 'AAAA', mimeType: 'audio/webm', reply: 'en' as const };

describe('runSearch, judging the six nearest', () => {
	it('shows the cards as before when one of them answers the question', async () => {
		const judge = vi.fn(async () => true);
		const r = await runSearch(speech, deps({ judge }));
		expect(r).toMatchObject({ kind: 'results', result: { fit: 'strong' } });
		expect(r).not.toHaveProperty('webFirst');
		expect(judge).toHaveBeenCalledWith('can I use my medisave to pay my father hospital bill', expect.any(Array));
		expect((judge.mock.calls[0] as unknown[])[1]).toHaveLength(6);
	});

	it('keeps the cards as the closest, and asks for the web, when none of them answers', async () => {
		const r = await runSearch(speech, deps({ judge: async () => false }));
		expect(r).toMatchObject({ kind: 'results', webFirst: true, result: { fit: 'weak' } });
		if (r.kind === 'results') expect(r.result.cards).toHaveLength(6);
	});

	it('tries an official page before the web, and shows it first', async () => {
		const r = await runSearch(speech, deps({ judge: async () => false, raw: buildRawIndex([doc]), write: async () => JSON.stringify(draft) }));
		expect(r.kind).toBe('results');
		expect(r).not.toHaveProperty('webFirst');
		if (r.kind === 'results') expect(r.result.cards[0]!.title.full).toBe('Paying a family member’s bill with MediSave');
	});

	it('goes to the web when the crawl has no page for it either', async () => {
		const r = await runSearch(speech, deps({ judge: async () => false, raw: buildRawIndex([]), write: async () => JSON.stringify(draft) }));
		expect(r).toMatchObject({ webFirst: true });
	});

	it('shows the cards as before when the judge cannot say', async () => {
		const r = await runSearch(speech, deps({ judge: async () => null }));
		expect(r).toMatchObject({ kind: 'results', result: { fit: 'strong' } });
		expect(r).not.toHaveProperty('webFirst');
	});

	it('does not judge a topic list or a later page', async () => {
		const judge = vi.fn(async () => false);
		await runSearch({ kind: 'topic', area: 'health', offset: 0, reply: 'en' }, deps({ judge }));
		await runSearch({ kind: 'text', query: 'how can I invest my CPF', offset: 6, reply: 'en' }, deps({ judge }));
		expect(judge).not.toHaveBeenCalled();
	});
});

describe('runSearch, guides kept from the web', () => {
	const kept = {
		id: 'g1',
		question: 'can I use my medisave to pay my father hospital bill',
		answer: { kind: 'steps', title_full: 'Kept guide' } as unknown as import('./web-answer').WebAnswer,
		language: 'en' as const,
		foundAt: '2026-09-20T00:00:00.000Z',
		status: 'live' as const,
	};

	it('answers from a kept guide when no card answers, instead of searching the web again', async () => {
		const find = vi.fn(async () => kept);
		const r = await runSearch(speech, deps({ judge: async () => false, guides: { find } }));
		expect(r).toMatchObject({ kind: 'web', answer: { title_full: 'Kept guide' }, foundAt: kept.foundAt, closest: { fit: 'weak' } });
		expect(find).toHaveBeenCalledWith([1, 0], 'en', T.strong);
	});

	it('answers from a kept guide when nothing is near at all', async () => {
		const r = await runSearch(speech, deps({ embed: async () => [-1, 0], guides: { find: async () => kept } }));
		expect(r).toMatchObject({ kind: 'web', answer: { title_full: 'Kept guide' } });
		expect(r).not.toHaveProperty('closest');
	});

	it('leaves a card that answers alone, whatever was kept', async () => {
		const find = vi.fn(async () => kept);
		const r = await runSearch(speech, deps({ judge: async () => true, guides: { find } }));
		expect(r.kind).toBe('results');
		expect(find).not.toHaveBeenCalled();
	});

	it('carries the English meaning it searched when nothing answers, so the web answer can be kept under it', async () => {
		const r = await runSearch(speech, deps({ judge: async () => false }));
		expect(r).toMatchObject({ webFirst: true, result: { query: 'can I use my medisave to pay my father hospital bill' } });
		const none = await runSearch(speech, deps({ embed: async () => [-1, 0] }));
		expect(none).toMatchObject({ kind: 'nothing', query: 'can I use my medisave to pay my father hospital bill' });
	});
});

describe('runSearch, hearing with the language the reader chose', () => {
	it('passes en or zh from the setting, and nothing on Automatic', async () => {
		const hear = vi.fn(async () => hearing);
		await runSearch({ ...speech, reply: 'en' }, deps({ hear }));
		await runSearch({ ...speech, reply: 'zh-Hans' }, deps({ hear }));
		await runSearch({ ...speech, reply: 'auto' as const }, deps({ hear }));
		expect(hear.mock.calls.map((c) => (c as unknown[])[2])).toEqual(['en', 'zh', undefined]);
	});
});
