import type { Entry } from './entry';

/**
 * One card per official page.
 *
 * Rebuilding the structured entries produced a new id each time the model chose a slightly
 * different heading, so the same page ended up as four cards — "How MMSS works", "How the
 * Matched MediSave Scheme works", "How the MediSave match works", "Matched MediSave" — and
 * a person asking about MediSave top-ups saw the same answer four times in six results.
 *
 * The page is the identity. Where several entries cite the same first source, the one that
 * gives the person most is kept.
 */
export function richness(e: Entry): number {
	return (e.steps?.length ?? 0) * 3 + (e.details?.length ?? 0) * 2 + e.quotes.length + e.summary.text.length / 1000;
}

export function onePerPage(entries: readonly Entry[]): Entry[] {
	const bestFor = new Map<string, Entry>();
	for (const e of entries) {
		const page = e.sources[0]?.url ?? e.id;
		const held = bestFor.get(page);
		if (!held || richness(e) > richness(held)) bestFor.set(page, e);
	}
	const kept = new Set([...bestFor.values()].map((e) => e.id));
	// The order given is kept, so two builds of the same corpus produce the same index.
	return entries.filter((e) => kept.has(e.id));
}
