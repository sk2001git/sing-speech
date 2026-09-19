import index from '../../../data/kb/index.json';
import { parseEntry, type Entry } from './entry';
import type { Corpus } from './search';

/**
 * The served corpus, bundled with the Worker from `data/kb/index.json`
 * (built by `scripts/kb/build.ts`). Re-validated at load: an index built by an older
 * schema must fail here, not in front of a reader. D1 and Vectorize replace this file in
 * build step 6.
 */
import places from '../../../data/kb/places.json';
import journeyIndex from '../../../data/kb/journey-index.json';
import { parseJourney, type Journey } from './journey';
import { buildRawIndex, type RawDoc, type RawIndex } from './raw-store';
import type { PlaceIndex } from './search';

export const EMBEDDING = index.embedding as { model: string; dimensions: number };

/**
 * Addresses from data.gov.sg, built by `scripts/kb/build-places.ts`. Not validated against
 * the entry schema: these are dataset rows, not quoted answers, and they carry their own
 * source line instead.
 */
export function loadPlaces(): PlaceIndex {
	return places as unknown as PlaceIndex;
}

let cached: Corpus | undefined;

export function loadCorpus(): Corpus {
	if (cached) return cached;
	const entries = new Map<string, Entry>();
	for (const raw of index.entries as unknown[]) {
		const parsed = parseEntry(raw);
		if (!parsed.ok) throw new Error(`index entry invalid: ${parsed.errors.join('; ')}`);
		if (parsed.entry.verification.status === 'grounded') entries.set(parsed.entry.id, parsed.entry);
	}
	const vectors = (index.vectors as { entryId: string; vector: number[] }[]).filter((v) => entries.has(v.entryId));
	cached = { entries, vectors };
	return cached;
}

let rawCached: Promise<RawIndex> | undefined;

/**
 * Tier B: every crawled official answer, searched by words when no entry is near enough
 * (`raw-store.ts`, built by `scripts/kb/build-raw.ts`).
 *
 * Fetched rather than bundled. The crawl is 3.9 MB and the Worker script has a 3 MB
 * compressed budget for everything it carries; Tier B is a fallback most requests never
 * reach. `fetchJson` is whatever can reach the site's own static files — the ASSETS
 * binding in a Worker, plain fetch in dev.
 *
 * Held per isolate: the first miss pays for the fetch and the word index, and nothing
 * after it does.
 */
export function loadRaw(fetchJson: () => Promise<{ questions: RawDoc[] }>): Promise<RawIndex> {
	rawCached ??= fetchJson()
		.then((body) => buildRawIndex(body.questions ?? []))
		.catch((err) => {
			// A Tier B that cannot be loaded must not take the answers down with it: the next
			// request tries again, and meanwhile the entries still answer.
			rawCached = undefined;
			throw err;
		});
	return rawCached;
}

let journeysCached: Journey[] | undefined;

/**
 * Life events, checked at build time: every card a stage names exists in the index above
 * and is grounded (`scripts/kb/build-journeys.ts`). Re-validated here for the same reason
 * entries are — an index built by an older schema must fail at load, not in front of
 * somebody who has just been bereaved.
 */
export function loadJourneys(): Journey[] {
	if (journeysCached) return journeysCached;
	const out: Journey[] = [];
	for (const raw of (journeyIndex.journeys ?? []) as unknown[]) {
		const parsed = parseJourney(raw);
		if (!parsed.ok) throw new Error(`journey invalid: ${parsed.errors.join('; ')}`);
		out.push(parsed.entry);
	}
	journeysCached = out;
	return out;
}
