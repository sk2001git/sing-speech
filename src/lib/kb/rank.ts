/**
 * From similarity scores to the cards a person sees.
 *
 * Pure: no index, no model. The thresholds belong to the embedding model that produced
 * the scores — Qwen3's correct matches scored 0.61–0.77 where Gemini's scored 0.76–0.81 on
 * the same pairs (vault obs-0030) — so they are passed in, never assumed here.
 */
export const PAGE_SIZE = 6;

export interface Thresholds {
	/** At or above: a sure match, the first card marked best. */
	strong: number;
	/** At or above, below strong: the closest cards, labelled as not a sure match. */
	weak: number;
	/** Below this a card is never shown, however few that leaves. */
	floor: number;
}

export interface Scored {
	id: string;
	score: number;
}

export type Fit = 'strong' | 'weak' | 'none';

export interface Ranked {
	fit: Fit;
	ids: string[];
	/** How many cards could be shown in all, across pages. */
	total: number;
	/** Where the next page starts, or null when this page is the last. */
	nextOffset: number | null;
}

const byScoreThenId = (a: Scored, b: Scored) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** An entry has several vectors (answer, example phrasings); its best one stands for it. */
export function bestPerEntry(hits: ReadonlyArray<{ entryId: string; score: number }>): Scored[] {
	const best = new Map<string, number>();
	for (const h of hits) {
		const prev = best.get(h.entryId);
		if (prev === undefined || h.score > prev) best.set(h.entryId, h.score);
	}
	return [...best].map(([id, score]) => ({ id, score })).sort(byScoreThenId);
}

export function rank(scored: readonly Scored[], t: Thresholds, offset = 0, size = PAGE_SIZE): Ranked {
	const sorted = [...scored].sort(byScoreThenId);
	const top = sorted[0]?.score ?? Number.NEGATIVE_INFINITY;
	if (top < t.weak) return { fit: 'none', ids: [], total: 0, nextOffset: null };

	const shown = sorted.filter((s) => s.score >= t.floor);
	const end = offset + size;
	return {
		fit: top >= t.strong ? 'strong' : 'weak',
		ids: shown.slice(offset, end).map((s) => s.id),
		total: shown.length,
		nextOffset: end < shown.length ? end : null,
	};
}
