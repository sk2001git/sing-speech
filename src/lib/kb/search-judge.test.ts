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
			points: { items: ['Tell the hospital you wish to use MediSave.', 'Sign the Medical Claims Authorisation Form.'] },
			about: '',
			about_quote: '',
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
		space: 'openai' as const,
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

describe('runSearch, on a route that searches its own index', () => {
	it('asks that index for the nearest cards instead of the in-memory one', async () => {
		const nearest = vi.fn(async () => [{ entryId: 'sg.cpf.e3', score: 0.95 }]);
		const r = await runSearch(speech, deps({ nearest }));
		expect(nearest).toHaveBeenCalledWith([1, 0]);
		expect(r.kind === 'results' && r.result.cards.map((c) => c.id)).toEqual(['sg.cpf.e3']);
	});
});

describe('runSearch, questions a government chart answers', () => {
	const chart = { week: { from: '2026-09-13', to: '2026-09-19' }, latest: { TTSH: 3.75 }, weeks: [], first: '2023-01-01', fetchedAt: '2026-09-27T00:00:00.000Z', file: 'f.xlsx' };
	const text = (query: string) => ({ kind: 'text' as const, query, offset: 0, reply: 'en' as const });

	it('answers an A&E waiting question with the chart, before any card search', async () => {
		const edWait = vi.fn(async () => chart);
		const embed = vi.fn(async () => [1, 0]);
		const r = await runSearch(text('how long do I wait at Tan Tock Seng A&E'), deps({ edWait, embed }));
		expect(r).toMatchObject({ kind: 'chart', chart: 'ed-wait', focus: 'TTSH', data: chart, language: 'en' });
		expect(embed).not.toHaveBeenCalled();
	});

	it('leaves every other question to the cards', async () => {
		const edWait = vi.fn(async () => chart);
		const r = await runSearch(text('how do I apply for CHAS'), deps({ edWait }));
		expect(r.kind).not.toBe('chart');
		expect(edWait).not.toHaveBeenCalled();
	});
});

describe('runSearch, a correction', () => {
	const said = { role: 'user' as const, kind: 'speech' as const, said: 'How long do I wait at Tantok Seng A and E?' };
	const resolved = { greeting: false, said: 'not Tan Tock Seng, Changi', meaning_en: 'how can I use my medisave for my father', short: 'MediSave for father', sentence: 'You want to use MediSave for your father.', language: 'en' as const, confidence: 0.9 };

	it('sends the thread with the typed correction marked, and searches the question it resolves to', async () => {
		const resolve = vi.fn(async () => resolved);
		const embed = vi.fn(async () => [1, 0]);
		const r = await runSearch({ kind: 'text', query: 'not Tan Tock Seng, Changi', offset: 0, reply: 'en', thread: [said] }, deps({ resolve, embed }));
		expect(resolve).toHaveBeenCalledWith([said, { role: 'user', kind: 'text', said: 'not Tan Tock Seng, Changi', correction: true }]);
		expect(embed).toHaveBeenCalledWith('how can I use my medisave for my father', 'query');
		expect(r).toMatchObject({ kind: 'results', result: { heard: { sentence: 'You want to use MediSave for your father.', corrected: true } } });
	});

	it('does the same for a spoken correction, with its transcript', async () => {
		const resolve = vi.fn(async () => resolved);
		await runSearch({ ...speech, thread: [said] }, deps({ resolve }));
		expect(resolve).toHaveBeenCalledWith([said, { role: 'user', kind: 'speech', said: 'You want to pay your father’s hospital bill with MediSave.', correction: true }]);
	});

	it('is an ordinary question when there is no thread', async () => {
		const resolve = vi.fn(async () => resolved);
		await runSearch({ kind: 'text', query: 'how do I apply for CHAS', offset: 0, reply: 'en' }, deps({ resolve }));
		expect(resolve).not.toHaveBeenCalled();
	});
});

describe('runSearch, a question asked about a step of a guide (plan-suara-0020, C1 and C2)', () => {
	const step = { guide: 'GPFirst: paying less at the emergency department', step: 3, of: 5, name: 'Go to A&E the same day', points: ['Go on the day the form was given.'] };
	const resolved = { greeting: false, said: 'which hospital ah', meaning_en: 'which hospitals accept the GPFirst form at A&E', short: 'GPFirst hospitals', sentence: 'You want to know which hospitals take the GPFirst form at A&E.', language: 'en' as const, confidence: 0.9 };

	it('understands a spoken question with the step, searches the standalone question, and says which step it was about', async () => {
		const resolve = vi.fn(async () => resolved);
		const embed = vi.fn(async () => [1, 0]);
		const r = await runSearch({ ...speech, context: step }, deps({ resolve, embed }));
		expect(resolve).toHaveBeenCalledWith([{ role: 'user', kind: 'speech', said: 'You want to pay your father’s hospital bill with MediSave.' }], step);
		expect(embed).toHaveBeenCalledWith('which hospitals accept the GPFirst form at A&E', 'query');
		expect(r).toMatchObject({ kind: 'results', result: { heard: { sentence: resolved.sentence, about: { step: 3, name: 'Go to A&E the same day' } } } });
	});

	it('does the same for a typed question', async () => {
		const resolve = vi.fn(async () => resolved);
		const r = await runSearch({ kind: 'text', query: 'which hospital ah', offset: 0, reply: 'en', context: step }, deps({ resolve }));
		expect(resolve).toHaveBeenCalledWith([{ role: 'user', kind: 'text', said: 'which hospital ah' }], step);
		expect(r).toMatchObject({ result: { heard: { about: { step: 3 } } } });
	});

	it('keeps the step when the question is then corrected', async () => {
		const resolve = vi.fn(async () => resolved);
		const said = { role: 'user' as const, kind: 'speech' as const, said: 'which hospital ah' };
		await runSearch({ kind: 'text', query: 'the one near Bedok', offset: 0, reply: 'en', thread: [said], context: step }, deps({ resolve }));
		expect(resolve).toHaveBeenCalledWith([said, { role: 'user', kind: 'text', said: 'the one near Bedok', correction: true }], step);
	});
});
