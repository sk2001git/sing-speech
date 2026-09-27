import { describe, expect, it, vi } from 'vitest';
import example from '../../../docs/knowledge-base/examples/sg.moh.gpfirst-emergency-referral.json';
import { parseEntry, type Entry } from './entry';
import { needsTranslation } from './grounding';
import { NothingHeard, type Hearing } from './hearing';
import { MemoryTranslations, runSearch, type Corpus, type SearchDeps } from './search';

const T = { strong: 0.6, weak: 0.45, floor: 0.3 };
const AT = '2026-09-15T08:00:00.000Z';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function entry(id: string, area: Entry['topic']['area'], title: string): Entry {
	const r = parseEntry(structuredClone(example));
	if (!r.ok) throw new Error(r.errors.join('\n'));
	const e = r.entry;
	e.id = id;
	e.topic = { ...e.topic, area };
	e.title = { short: title.slice(0, 16), full: title };
	e.verification = { status: 'grounded', checks: [] };
	return e;
}

/** Eight health entries at falling similarity to the query [1, 0], then one CPF entry. */
function corpus(): Corpus {
	const entries = Array.from({ length: 8 }, (_, i) => entry(`sg.moh.e${i}`, 'health', `Health ${i}`));
	entries.push(entry('sg.cpf.balance', 'cpf-and-support', 'CPF balance'));
	const vectors = entries.map((e, i) => {
		const s = 0.9 - i * 0.05;
		return { entryId: e.id, vector: [s, Math.sqrt(1 - s * s)] };
	});
	return { entries: new Map(entries.map((e) => [e.id, e])), vectors };
}

const heard = (over: Partial<Hearing> = {}): Hearing => ({
	greeting: false,
	meaning_en: 'what health help can I get',
	short: 'Health help',
	sentence: 'You want to know what health help you can get.',
	language: 'en',
	confidence: 0.9,
	...over,
});

const chinese = async (e: Entry): Promise<Entry> => ({ ...e, language: 'zh-Hans', title: { short: '中文', full: '中文标题' } });

function deps(over: Partial<SearchDeps> = {}): SearchDeps {
	return {
		corpus: corpus(),
		embed: async () => [1, 0],
		hear: async () => heard(),
		translate: async () => null,
		cache: new MemoryTranslations(),
		thresholds: T,
		translateBudgetMs: 50,
		now: () => AT,
		...over,
	};
}

const speech = (reply: 'en' | 'zh-Hans' | 'auto' = 'en') => ({ kind: 'speech' as const, audioBase64: 'AAAA', mimeType: 'audio/webm', reply });
const ids = (r: Awaited<ReturnType<typeof runSearch>>) => (r.kind === 'results' ? r.result.cards.map((c) => c.id) : r.kind);

describe('runSearch, speech', () => {
	it('greets back without searching', async () => {
		const embed = vi.fn(async () => [1, 0]);
		const r = await runSearch(speech(), deps({ hear: async () => heard({ greeting: true, meaning_en: '' }), embed }));
		expect(r).toEqual({ kind: 'greeting', language: 'en' });
		expect(embed).not.toHaveBeenCalled();
	});

	it('returns the six nearest, best first, with what was heard and the meaning it searched', async () => {
		const embed = vi.fn(async (_text: string) => [1, 0]);
		const r = await runSearch(speech(), deps({ embed }));
		expect(ids(r)).toEqual(['sg.moh.e0', 'sg.moh.e1', 'sg.moh.e2', 'sg.moh.e3', 'sg.moh.e4', 'sg.moh.e5']);
		expect(r).toMatchObject({
			kind: 'results',
			result: { fit: 'strong', nextOffset: 6, query: 'what health help can I get', heard: { short: 'Health help' } },
		});
		// The meaning, marked as a query: each route's embedder adds its own instruction.
		expect(embed.mock.calls[0]).toEqual(['what health help can I get', 'query']);
	});

	it('reports silence when the route heard nothing, without searching', async () => {
		const embed = vi.fn(async () => [1, 0]);
		const hear = async () => {
			throw new NothingHeard();
		};
		expect(await runSearch(speech(), deps({ hear, embed }))).toEqual({ kind: 'silence', language: 'en' });
		expect(embed).not.toHaveBeenCalled();
	});

	it('carries what they said into the heard row', async () => {
		const r = await runSearch(speech(), deps({ hear: async () => heard({ said: 'what health help can I get ah' }) }));
		expect(r.kind === 'results' && r.result.heard.said).toBe('what health help can I get ah');
	});

	it('says nothing is close when even the best card is below the weak line', async () => {
		const r = await runSearch(speech(), deps({ embed: async () => [-1, 0] }));
		expect(r).toMatchObject({ kind: 'nothing', heard: { short: 'Health help' }, language: 'en' });
	});
});

describe('runSearch, places', () => {
	const chas = { id: 'chas:1', kind: 'chas-clinic' as const, name: 'Bedok Family Clinic', street: 'BEDOK NORTH STREET 1', postal: '460123', phone: '61234567' };
	const withPlaces = (over: Partial<SearchDeps> = {}) =>
		deps({ places: { places: [chas], sources: [{ datasetId: 'd_548', name: 'CHAS Clinics', agency: 'Ministry of Health', lastUpdatedAt: '2024-06-06', licence: 'Singapore Open Data Licence', url: 'https://data.gov.sg', fetchedAt: AT, kind: 'chas-clinic' }] }, ...over });

	it('answers a "where is" question from the open data, not the knowledge base', async () => {
		const embed = vi.fn(async () => [1, 0]);
		const r = await runSearch(speech(), withPlaces({ hear: async () => heard({ meaning_en: 'Where is the nearest CHAS clinic in Bedok?' }), embed }));
		expect(r.kind).toBe('places');
		if (r.kind !== 'places') return;
		expect(r.places.map((p) => p.name)).toEqual(['Bedok Family Clinic']);
		expect(r.source.name).toBe('CHAS Clinics');
		expect(embed).not.toHaveBeenCalled();
	});

	it('falls back to the knowledge base when the area matches nothing', async () => {
		const r = await runSearch(speech(), withPlaces({ hear: async () => heard({ meaning_en: 'Where is the nearest clinic in Atlantis?' }) }));
		expect(r.kind).toBe('results');
	});

	it('leaves questions that are not about a place alone', async () => {
		const r = await runSearch(speech(), withPlaces({ hear: async () => heard({ meaning_en: 'What is CHAS and who can use it?' }) }));
		expect(r.kind).toBe('results');
	});
});

describe('runSearch, text and topic', () => {
	it('loads the next page from the English meaning', async () => {
		const r = await runSearch({ kind: 'text', query: 'what health help can I get', offset: 6, reply: 'en' }, deps());
		expect(ids(r)).toEqual(['sg.moh.e6', 'sg.moh.e7', 'sg.cpf.balance']);
		expect(r.kind === 'results' && r.result.nextOffset).toBeNull();
	});

	it('lists a topic without the microphone or the index', async () => {
		const hear = vi.fn();
		const embed = vi.fn();
		const r = await runSearch({ kind: 'topic', area: 'cpf-and-support', offset: 0, reply: 'en' }, deps({ hear, embed }));
		expect(ids(r)).toEqual(['sg.cpf.balance']);
		expect(r).toMatchObject({ kind: 'results', result: { fit: 'topic', nextOffset: null } });
		expect(hear).not.toHaveBeenCalled();
		expect(embed).not.toHaveBeenCalled();
	});
});

describe('runSearch, Chinese on need', () => {
	it('translates each card once, records it in the original metadata, and reuses it', async () => {
		const translate = vi.fn(chinese);
		const d = deps({ translate });
		const first = await runSearch(speech('zh-Hans'), d);
		expect(first.kind === 'results' && first.result.cards.every((c) => c.language === 'zh-Hans')).toBe(true);
		expect(first.kind === 'results' && first.englishIds).toEqual([]);
		expect(translate).toHaveBeenCalledTimes(6);
		expect(needsTranslation(d.corpus.entries.get('sg.moh.e0')!, 'zh-Hans')).toBe(false);

		await runSearch(speech('zh-Hans'), d);
		expect(translate).toHaveBeenCalledTimes(6);
	});

	it('shows the English card, marked, when translation fails', async () => {
		const r = await runSearch(speech('zh-Hans'), deps({ translate: async () => null }));
		expect(r.kind === 'results' && r.result.cards.every((c) => c.language === 'en')).toBe(true);
		expect(r.kind === 'results' && r.englishIds).toHaveLength(6);
	});

	it('does not hold the page for a slow translation, and keeps the result for next time', async () => {
		const translate = vi.fn(async (e: Entry) => {
			await sleep(150);
			return chinese(e);
		});
		const d = deps({ translate, translateBudgetMs: 20 });
		const first = await runSearch(speech('zh-Hans'), d);
		expect(first.kind === 'results' && first.englishIds).toHaveLength(6);
		await sleep(250);
		const second = await runSearch(speech('zh-Hans'), d);
		expect(second.kind === 'results' && second.englishIds).toEqual([]);
		expect(translate).toHaveBeenCalledTimes(6);
	});

	it('follows the spoken language on Automatic', async () => {
		const r = await runSearch(speech('auto'), deps({ hear: async () => heard({ language: 'zh' }), translate: chinese }));
		expect(r.kind === 'results' && r.result.language).toBe('zh-Hans');
	});

	it('stays English when English is chosen, even if Chinese is heard', async () => {
		const translate = vi.fn(chinese);
		const r = await runSearch(speech('en'), deps({ hear: async () => heard({ language: 'zh' }), translate }));
		expect(r.kind === 'results' && r.result.language).toBe('en');
		expect(translate).not.toHaveBeenCalled();
	});
});
