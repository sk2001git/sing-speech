import { z } from 'zod';
import { AREA_LABEL, AREAS } from './areas';
import { compose, type Writer } from './compose';
import type { Journey } from './journey';
import { journeyFor } from './journey-match';
import { documentTexts, nearest, type StoredVector } from './embed';
import { TRANSLATABLE, type Entry, type EntryLanguage } from './entry';
import type { Heard, SearchResult } from './flow';
import { needsTranslation } from './grounding';
import { NothingHeard, replyLanguage, typedLanguage, type Hearing } from './hearing';
import { findPlaces, placeIntent, type Place, type PlaceKind } from '../places/places';
import { bestPerEntry, PAGE_SIZE, rank, type Thresholds } from './rank';
import { searchRaw, type RawIndex } from './raw-store';
import type { Judge } from './judge';
import type { StepContext, Turn } from './thread';
import type { GuideFinder } from './web-guides';
import type { WebAnswer } from './web-answer';
import { edWaitAsked } from '../charts/ed-wait';
import type { EdWaitChart } from '../charts/ed-wait-source';

const Reply = z.enum(['en', 'zh-Hans', 'auto']).default('en');
const Offset = z.number().int().min(0).max(1000).default(0);
/**
 * The earlier turns of this question, when the request is a correction of them (lib/kb/thread.ts).
 * Absent means an ordinary question.
 */
const Thread = z
	.array(z.object({ role: z.literal('user'), kind: z.enum(['speech', 'text']), said: z.string().min(1).max(1000), correction: z.literal(true).optional() }))
	.min(1)
	.max(6)
	.optional();

/**
 * The step of a guide the question was asked about ("Ask about this step"; vault plan-suara-0020,
 * C1): it helps understand the question and is never a source for the answer (C4).
 */
const Context = z
	.object({
		guide: z.string().min(1).max(120),
		step: z.number().int().min(1).max(20),
		of: z.number().int().min(1).max(20),
		name: z.string().min(1).max(60),
		points: z.array(z.string().max(300)).max(5),
	})
	.optional();

export const SearchRequest = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('speech'), audioBase64: z.string().min(1), mimeType: z.string().max(100).optional(), reply: Reply, thread: Thread, context: Context }),
	z.object({
		kind: z.literal('text'),
		query: z.string().min(1).max(240),
		/** `said` carries their own words when the caller already has them, as a live session does. */
		heard: z.object({ short: z.string().max(40), sentence: z.string().max(240), said: z.string().max(1000).optional() }).optional(),
		offset: Offset,
		reply: Reply,
		thread: Thread,
		context: Context,
	}),
	z.object({ kind: z.literal('topic'), area: z.enum(AREAS), offset: Offset, reply: Reply }),
]);

export type SearchRequest = z.infer<typeof SearchRequest>;

export type SearchResponse =
	| { kind: 'greeting'; language: EntryLanguage }
	| { kind: 'silence'; language: EntryLanguage }
	/** Addresses from open data, which are rows in a published dataset rather than quoted answers. */
	| { kind: 'places'; heard: Heard; places: Place[]; what: PlaceKind; area: string; source: PlaceSource; language: EntryLanguage }
	/** A life event rather than a question: what to do now, what waits, and how it ends. */
	| { kind: 'journey'; heard: Heard; journey: Journey; cards: Entry[]; language: EntryLanguage }
	/** `query`: the English meaning searched, so a web answer found next can be kept under it. */
	| { kind: 'nothing'; heard: Heard; language: EntryLanguage; query?: string }
	/**
	 * A guide found on the web for an earlier question like this one, and kept. `closest`: the
	 * cards that were near but did not answer, one Back away.
	 */
	| { kind: 'web'; heard: Heard; language: EntryLanguage; answer: WebAnswer; foundAt: string; closest?: SearchResult }
	/**
	 * A chart Suara draws from government figures (vault plan-suara-0017). `focus`: the hospital the
	 * question named, highlighted; null for all of them.
	 */
	| { kind: 'chart'; chart: 'ed-wait'; heard: Heard; language: EntryLanguage; data: EdWaitChart; focus: string | null }
	/**
	 * `englishIds`: cards shown in English although the reader's language is not English.
	 * `webFirst`: none of these answers the question; they are the closest, and the web is next.
	 */
	| { kind: 'results'; result: SearchResult; englishIds: string[]; webFirst?: true };

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

/** One dataset behind the place cards, named on screen with the date it was read. */
export interface PlaceSource {
	datasetId: string;
	kind: string;
	name: string;
	agency: string;
	lastUpdatedAt: string;
	url: string;
	licence: string;
	fetchedAt: string;
}

export interface PlaceIndex {
	places: Place[];
	sources: PlaceSource[];
}

export interface SearchDeps {
	corpus: Corpus;
	/** Life events. Absent means every request is treated as a question. */
	journeys?: Journey[];
	/** Open-data addresses. Absent means "where is…" questions fall through to the entries. */
	places?: PlaceIndex;
	/** Embed a question (a query) or a card (a document); each embedder adds its own instruction. */
	embed: (text: string, kind: 'query' | 'document') => Promise<number[]>;
	/**
	 * Scores for the nearest vectors, where a route keeps its own index (the Cloudflare route's
	 * Vectorize). Absent means every vector in `corpus` is scored in memory.
	 */
	nearest?: (vector: number[]) => Promise<{ entryId: string; score: number }[]>;
	/** `hint`: the language the reader chose, en or zh; none on Automatic (vault obs-0054). */
	/** `onTranscript`: called with the words as soon as they are heard, before they are read. */
	hear?: (audio: ArrayBuffer, mimeType?: string, hint?: 'en' | 'zh', onTranscript?: (transcript: string) => void) => Promise<Hearing>;
	translate?: (original: Entry, language: EntryLanguage) => Promise<Entry | null>;
	cache: TranslationCache;
	thresholds: Thresholds;
	/** How long a page waits for translations before showing English for the rest. */
	translateBudgetMs: number;
	now: () => string;
	/** Keeps a translation running after the response, where the runtime allows it. */
	waitUntil?: (work: Promise<unknown>) => void;
	/**
	 * Tier B: every crawled official answer, searched by words when no entry is near enough.
	 * Absent means a miss stays a miss.
	 *
	 * A function because the crawl is a 3.9 MB static asset rather than part of the Worker,
	 * so it is fetched on the first request that actually needs it and never on the others.
	 */
	raw?: RawIndex | (() => Promise<RawIndex>);
	/** Writes a card from a retrieved page. Absent means the crawl is never drawn on. */
	write?: Writer;
	/** Keeps what was composed beyond this isolate, where a store is configured. */
	remember?: (entry: Entry) => void;
	/** Whether the nearest cards answer the question. Absent means similarity alone decides. */
	judge?: Judge;
	/** Web answers kept from earlier questions. Absent means every such question searches the web. */
	guides?: GuideFinder;
	/** A correction's thread, resolved to the one question meant now (lib/kb/thread.ts). */
	resolve?: (turns: import('./thread').Turn[], context?: import('./thread').StepContext) => Promise<Hearing>;
	/** MOH's A&E ward-bed waiting times, for the questions they answer. Absent means no chart. */
	edWait?: () => Promise<EdWaitChart>;
}

/** The latest turn, marked a correction when it follows a thread, resolved with the step if there is one. */
function resolveWith(resolve: NonNullable<SearchDeps['resolve']>, thread: Turn[] | undefined, turn: Turn, context: StepContext | undefined): Promise<Hearing> {
	const turns = thread ? [...thread, { ...turn, correction: true as const }] : [turn];
	return context ? resolve(turns, context) : resolve(turns);
}

/** Which step the answer is about, for the screen to say so (C2). */
const aboutOf = (context: StepContext | undefined) => (context ? { about: { step: context.step, name: context.name } } : {});

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
			h = await deps.hear(decodeBase64(req.audioBase64), req.mimeType, req.reply === 'en' ? 'en' : req.reply === 'zh-Hans' ? 'zh' : undefined);
		} catch (err) {
			if (err instanceof NothingHeard) return { kind: 'silence', language: req.reply === 'zh-Hans' ? 'zh-Hans' : 'en' };
			throw err;
		}
		if (h.greeting && !req.thread && !req.context) return { kind: 'greeting', language: replyLanguage(req.reply, h.language) };
		// A spoken correction, or a question about a step: the thread, the step and this
		// transcript make the question meant now.
		if ((req.thread || req.context) && deps.resolve) {
			const corrected = await resolveWith(deps.resolve, req.thread, { role: 'user', kind: 'speech', said: (h.said ?? h.sentence).trim() }, req.context);
			language = replyLanguage(req.reply, corrected.language);
			heard = { short: corrected.short, sentence: corrected.sentence, said: corrected.said ?? '', ...(req.thread ? { corrected: true as const } : {}), ...aboutOf(req.context) };
			query = corrected.meaning_en;
		} else {
			language = replyLanguage(req.reply, h.language);
			if (h.greeting) return { kind: 'greeting', language };
			heard = { short: h.short, sentence: h.sentence, ...(h.said?.trim() ? { said: h.said.trim() } : {}) };
			query = h.meaning_en;
		}
	} else if ((req.thread || req.context) && deps.resolve) {
		// A typed correction, perhaps a volunteer's, or a question about a step: the thread and
		// the step make the question meant now.
		const corrected = await resolveWith(deps.resolve, req.thread, { role: 'user', kind: 'text', said: req.query.trim() }, req.context);
		language = replyLanguage(req.reply, corrected.language);
		heard = { short: corrected.short, sentence: corrected.sentence, said: req.query.trim(), ...(req.thread ? { corrected: true as const } : {}), ...aboutOf(req.context) };
		query = corrected.meaning_en;
		offset = req.offset;
	} else {
		language = replyLanguage(req.reply, typedLanguage(req.query));
		heard = req.heard ?? { short: req.query.slice(0, 40), sentence: req.query };
		query = req.query;
		offset = req.offset;
	}

	/*
	 * "My father passed away" is not a question; it is the start of nine months of them. The
	 * test is narrow on purpose (`journey-match.ts`): a question that merely mentions death
	 * falls through to the ordinary search, where an answer belongs.
	 */
	const event = deps.journeys ? journeyFor(deps.journeys, heard.said ?? query) : undefined;
	if (event) {
		const cards = event.stages
			.flatMap((stage) => stage.cards)
			.map((id) => deps.corpus.entries.get(id))
			.filter((e): e is Entry => e !== undefined);
		return { kind: 'journey', heard, journey: event, cards, language };
	}

	// "How long is the wait at A&E" is answered from MOH's own figures, drawn as a chart. A fixed
	// rule decides, on the meaning and on what they said, so a Chinese question counts too.
	const asked = deps.edWait ? edWaitAsked(`${query} ${heard.said ?? ''}`) : null;
	if (asked && deps.edWait) {
		try {
			return { kind: 'chart', chart: 'ed-wait', heard, language, data: await deps.edWait(), focus: asked.focus };
		} catch (err) {
			// No figures at all: the question goes on to the cards and the web like any other.
			console.error('A&E chart unavailable:', err instanceof Error ? err.message.slice(0, 120) : err);
		}
	}

	// "Where is a clinic in Bedok" is answered from the dataset, not from quoted pages. An
	// area that matches nothing falls through, so a question we misread still gets answers.
	const nearby = deps.places ? placesFor(query, deps.places) : null;
	if (nearby) return { kind: 'places', heard, language, ...nearby };

	/*
	 * Tier A needs the embedding vendor; Tier B does not. When embedding fails — no credit,
	 * rate limit, vendor down — falling through to the word search keeps Suara answering
	 * from the crawl instead of showing an error to somebody who asked a plain question.
	 */
	let vector: number[] | null = null;
	try {
		vector = await deps.embed(query, 'query');
	} catch (err) {
		console.error('embedding failed, falling back to the word search:', err instanceof Error ? err.message.slice(0, 120) : err);
	}
	if (!vector) return (await onDemand(query, heard, language, deps)) ?? { kind: 'nothing', heard, language, query };

	const scored = deps.nearest ? await deps.nearest(vector) : nearest(vector, deps.corpus.vectors);
	const ranked = rank(bestPerEntry(scored), deps.thresholds, offset);
	const cards = ranked.ids.map((id) => deps.corpus.entries.get(id)).filter((e): e is Entry => e !== undefined);

	/*
	 * A weak fit is the most dangerous answer in the product: the nearest entry is about
	 * something else, and it looks as official as a right one. "Can I use MediSave for my
	 * father's bill" matched a card about the Matched MediSave Scheme at 0.6-something,
	 * which is how a corpus of 17 entries answers everything badly. So anything short of a
	 * strong fit also asks Tier B, and a composed card that passes its grounding checks
	 * goes first, with the weak entries kept behind it.
	 */
	/*
	 * Near is not the same as answered: six CPF cards are near "how can I invest my CPF" and
	 * none says how. The judge reads them; when none answers, an official page is tried as for
	 * a weak fit, and failing that the cards are shown as the closest with the web next.
	 */
	const answered = offset === 0 && ranked.fit !== 'none' && deps.judge && cards.length > 0 ? await deps.judge(query, cards.slice(0, PAGE_SIZE)) : null;
	const unanswered = offset === 0 && (ranked.fit === 'none' || answered === false);

	// A guide the web found for an earlier question like this one: instant, and no search.
	const kept = unanswered && deps.guides ? await deps.guides.find(vector, language, deps.thresholds.strong) : null;
	const closestOf = async () => {
		const r = await results(cards, { heard, fit: 'weak', nextOffset: ranked.nextOffset, query, language }, deps);
		return r.kind === 'results' ? r : null;
	};
	if (kept) {
		const closest = ranked.fit === 'none' ? null : await closestOf();
		return { kind: 'web', heard, language, answer: kept.answer, foundAt: kept.foundAt, ...(closest ? { closest: closest.result } : {}) };
	}

	if ((ranked.fit !== 'strong' || answered === false) && offset === 0) {
		const composed = await onDemand(query, heard, language, deps, cards);
		if (composed) return composed;
	}
	if (ranked.fit === 'none') return { kind: 'nothing', heard, language, query };
	if (answered === false) {
		const closest = await closestOf();
		return closest ? { ...closest, webFirst: true } : { kind: 'nothing', heard, language, query };
	}

	return results(cards, { heard, fit: ranked.fit, nextOffset: ranked.nextOffset, query, language }, deps);
}

/**
 * Nothing in the entries is near enough. Look through the whole crawl, and if an official
 * page answers this, have the route's model write the card from that page — then keep it.
 *
 * "Search first, then store": the first person to ask waits for one model call, everybody
 * after them is served from Tier A like any other card. A composed card that fails its
 * grounding checks is not shown at all; `nothing` is the honest answer and the PRD promises
 * it.
 */
/**
 * How many retrieved pages the writer sees at once.
 *
 * One page per attempt meant refusing questions the agencies answer across two neighbouring
 * pages — "what is ElderFund for" against pages on who administers it and who is eligible.
 * Three is enough to cover a subject without burying the question in text.
 */
const PAGES_OFFERED = 3;

async function onDemand(
	query: string,
	heard: Heard,
	language: EntryLanguage,
	deps: SearchDeps,
	existing: Entry[] = [],
): Promise<SearchResponse | null> {
	if (!deps.raw || !deps.write) return null;
	let index: RawIndex;
	try {
		index = typeof deps.raw === 'function' ? await deps.raw() : deps.raw;
	} catch (err) {
		// The crawl could not be loaded. The entries have already failed to answer, so this
		// request ends honestly rather than in an error page.
		console.error('tier B unavailable:', err instanceof Error ? err.message.slice(0, 120) : err);
		return null;
	}
	const hits = searchRaw(index, query, PAGES_OFFERED);
	if (hits.length === 0) return null;

	/*
	 * Each retrieved page in turn, until one produces a card. BM25's first choice is
	 * sometimes a page that merely shares words with the question, and the model can only
	 * refuse the page it is handed — so being refused is a reason to offer the next one,
	 * not to give up. Two at most: the person is waiting, and a third is rarely nearer.
	 */
	const made = await compose({ asked: query, docs: hits.map((h) => h.doc), language: 'en' }, deps.write, deps.now());
	if (!made.ok) return null;
	const entry = made.entry;

	deps.corpus.entries.set(entry.id, entry);
	try {
		// One embedding, of the card itself: enough for the next person's query to find it.
		deps.corpus.vectors.push({ entryId: entry.id, vector: await deps.embed(documentTexts(entry)[0]!, 'document') });
	} catch {
		// The card still shows. It will simply be composed again for the next person.
	}
	deps.remember?.(entry);

	const behind = existing.filter((e) => e.id !== entry.id).slice(0, PAGE_SIZE - 1);
	return results([entry, ...behind], { heard, fit: 'weak', nextOffset: null, query, language }, deps);
}

function placesFor(query: string, index: PlaceIndex): { places: Place[]; what: PlaceKind; area: string; source: PlaceSource } | null {
	const intent = placeIntent(query);
	if (!intent) return null;
	const found = findPlaces(index.places, intent);
	const source = index.sources.find((s) => s.kind === intent.kind);
	if (found.length === 0 || !source) return null;
	return { places: found, what: intent.kind, area: intent.area, source };
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
