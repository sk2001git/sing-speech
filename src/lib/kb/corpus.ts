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
import rawIndex from '../../../data/kb/raw-index.json';
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

let rawCached: RawIndex | undefined;

/**
 * Tier B: every crawled official answer, searched by words when no entry is near enough
 * (`raw-store.ts`, built by `scripts/kb/build-raw.ts`).
 *
 * The word index is built on first use rather than at module load, because most requests
 * are answered from the entries and never look at it.
 */
export function loadRaw(): RawIndex {
	rawCached ??= buildRawIndex(rawIndex.questions as RawDoc[]);
	return rawCached;
}

export const RAW_BUILT = rawIndex.built as string;
export const RAW_COUNT = rawIndex.count as number;
