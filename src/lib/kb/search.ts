import { z } from 'zod';
import { AREA_LABEL, AREAS } from './areas';
import { nearest, queryText, type StoredVector } from './embed';
import { TRANSLATABLE, type Entry, type EntryLanguage } from './entry';
import type { Heard, SearchResult } from './flow';
import { needsTranslation } from './grounding';
import { NothingHeard, replyLanguage, type Hearing } from './hearing';
import { bestPerEntry, PAGE_SIZE, rank, type Thresholds } from './rank';

const Reply = z.enum(['en', 'zh-Hans', 'auto']).default('en');
const Offset = z.number().int().min(0).max(1000).default(0);

export const SearchRequest = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('speech'), audioBase64: z.string().min(1), mimeType: z.string().max(100).optional(), reply: Reply }),
	z.object({
		kind: z.literal('text'),
		query: z.string().min(1).max(240),
		/** `said` carries their own words when the caller already has them, as a live session does. */
		heard: z.object({ short: z.string().max(40), sentence: z.string().max(240), said: z.string().max(1000).optional() }).optional(),
		offset: Offset,
		reply: Reply,
	}),
	z.object({ kind: z.literal('topic'), area: z.enum(AREAS), offset: Offset, reply: Reply }),
]);

export type SearchRequest = z.infer<typeof SearchRequest>;

export type SearchResponse =
	| { kind: 'greeting'; language: EntryLanguage }
	| { kind: 'silence'; language: EntryLanguage }
	| { kind: 'nothing'; heard: Heard; language: EntryLanguage }
	/** `englishIds`: cards shown in English although the reader's language is not English. */
	| { kind: 'results'; result: SearchResult; englishIds: string[] };

export interface Corpus {
	/** Only grounded originals. */
	entries: Map<string, Entry>;
	vectors: StoredVector[];
}

export interface TranslationCache {
	get(id: string, version: number, language: EntryLanguage): Entry | undefined;
	set(original: Entry, translation: Entry): void;
}

/**
 * Per-isolate store for translations. Lost on restart, when the original's metadata says
 * "translated" but the entry is gone, so it is simply translated again. D1 replaces it in
 * build step 6.
 */
export class MemoryTranslations implements TranslationCache {
	private readonly store = new Map<string, Entry>();
	private key(id: string, version: number, language: EntryLanguage) {
		return `${id}@${version}:${language}`;
	}
	get(id: string, version: number, language: EntryLanguage) {
		return this.store.get(this.key(id, version, language));
	}
	set(original: Entry, translation: Entry) {
		this.store.set(this.key(original.id, original.lifecycle.version, translation.language), translation);
	}
}

export interface SearchDeps {
	corpus: Corpus;
	/** Embed one query text, already carrying its instruction. */
	embed: (text: string) => Promise<number[]>;
	hear?: (audio: ArrayBuffer, mimeType?: string) => Promise<Hearing>;
	translate?: (original: Entry, language: EntryLanguage) => Promise<Entry | null>;
	cache: TranslationCache;
	thresholds: Thresholds;
	/** How long a page waits for translations before showing English for the rest. */
	translateBudgetMs: number;
	now: () => string;
	/** Keeps a translation running after the response, where the runtime allows it. */
	waitUntil?: (work: Promise<unknown>) => void;
}

export async function runSearch(req: SearchRequest, deps: SearchDeps): Promise<SearchResponse> {
	if (req.kind === 'topic') return topic(req, deps);

	let heard: Heard;
	let query: string;
	let language: EntryLanguage;
	let offset = 0;

	if (req.kind === 'speech') {
		if (!deps.hear) throw new Error('no hearing provider configured');
		let h: Hearing;
		try {
			h = await deps.hear(decodeBase64(req.audioBase64), req.mimeType);
		} catch (err) {
			if (err instanceof NothingHeard) return { kind: 'silence', language: req.reply === 'zh-Hans' ? 'zh-Hans' : 'en' };
			throw err;
		}
		language = replyLanguage(req.reply, h.language);
		if (h.greeting) return { kind: 'greeting', language };
		heard = { short: h.short, sentence: h.sentence, ...(h.said?.trim() ? { said: h.said.trim() } : {}) };
		query = h.meaning_en;
	} else {
		language = req.reply === 'zh-Hans' ? 'zh-Hans' : 'en';
		heard = req.heard ?? { short: req.query.slice(0, 40), sentence: req.query };
		query = req.query;
		offset = req.offset;
	}

	const vector = await deps.embed(queryText(query));
	const ranked = rank(bestPerEntry(nearest(vector, deps.corpus.vectors)), deps.thresholds, offset);
	if (ranked.fit === 'none') return { kind: 'nothing', heard, language };

	const cards = ranked.ids.map((id) => deps.corpus.entries.get(id)).filter((e): e is Entry => e !== undefined);
	return results(cards, { heard, fit: ranked.fit, nextOffset: ranked.nextOffset, query, language }, deps);
}

async function topic(req: Extract<SearchRequest, { kind: 'topic' }>, deps: SearchDeps): Promise<SearchResponse> {
	const language: EntryLanguage = req.reply === 'zh-Hans' ? 'zh-Hans' : 'en';
	const label = AREA_LABEL[req.area][language];
	const heard = { short: label, sentence: label };
	const all = [...deps.corpus.entries.values()]
		.filter((e) => e.topic.area === req.area)
		.sort((a, b) => a.title.full.localeCompare(b.title.full));
	if (all.length === 0) return { kind: 'nothing', heard, language };
	const end = req.offset + PAGE_SIZE;
	return results(
		all.slice(req.offset, end),
		{ heard, fit: 'topic', nextOffset: end < all.length ? end : null, query: '', language },
		deps,
	);
}

async function results(cards: Entry[], meta: Omit<SearchResult, 'cards'>, deps: SearchDeps): Promise<SearchResponse> {
	const shown = meta.language === 'en' || !deps.translate ? cards : await localise(cards, meta.language, deps);
	return {
		kind: 'results',
		result: { ...meta, cards: shown },
		englishIds: shown.filter((c) => c.language !== meta.language).map((c) => c.id),
	};
}

/**
 * Translations are shared across requests only once finished, through the cache. A
 * promise started by one request is never awaited by another: Workers tie I/O to the
 * request that began it, and a second request awaiting it hung for 34 s in dev.
 */
function localise(cards: Entry[], language: EntryLanguage, deps: SearchDeps): Promise<Entry[]> {
	const pending = new Map<string, Promise<Entry | null>>();

	return Promise.all(
		cards.map(async (original) => {
			if (original.language === language) return original;

			// Decided from the original's metadata first, as the owner specified.
			if (!needsTranslation(original, language)) {
				const stored = deps.cache.get(original.id, original.lifecycle.version, language);
				if (stored) return stored;
			}

			const key = `${original.id}@${original.lifecycle.version}:${language}`;
			let work = pending.get(key);
			if (!work) {
				work = deps.translate!(original, language)
					.then((translation) => {
						if (translation) {
							deps.cache.set(original, translation);
							if ((TRANSLATABLE as readonly string[]).includes(language)) {
								original.translations = {
									...original.translations,
									[language]: { from_version: original.lifecycle.version, at: deps.now() },
								};
							}
						}
						return translation;
					})
					.catch(() => null)
					.finally(() => pending.delete(key));
				pending.set(key, work);
				deps.waitUntil?.(work);
			}
			return (await withinBudget(work, deps.translateBudgetMs)) ?? original;
		}),
	);
}

function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), ms);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(null);
			},
		);
	});
}

function decodeBase64(b64: string): ArrayBuffer {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}
