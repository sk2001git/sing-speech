import index from '../../../data/kb/index.json';
import { parseEntry, type Entry } from './entry';
import type { Corpus } from './search';

/**
 * The served corpus, bundled with the Worker from `data/kb/index.json`
 * (built by `scripts/kb/build.ts`). Re-validated at load: an index built by an older
 * schema must fail here, not in front of a reader. D1 and Vectorize replace this file in
 * build step 6.
 */
export const EMBEDDING = index.embedding as { model: string; dimensions: number };

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
