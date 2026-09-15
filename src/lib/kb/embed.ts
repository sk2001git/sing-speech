import type { Entry } from './entry';

/**
 * What gets embedded, and how vectors are compared.
 *
 * Qwen3-Embedding-8B takes its task as text: queries carry an instruction, documents do
 * not. OpenRouter's `input_type` changed a Qwen3 vector by cosine 0.99994 — no effect —
 * so the instruction is written into the string (vault dec-suara-0013).
 */
export const QUERY_INSTRUCTION =
	'Given a spoken request from an older Singaporean, retrieve the official answer that addresses it';

export const queryText = (meaning: string) => `Instruct: ${QUERY_INSTRUCTION}\nQuery:${meaning}`;

/**
 * The answer itself, then each example phrasing. A short spoken request often sits closer
 * to "doctor ask me go emergency, got cheaper or not" than to the official wording, so the
 * phrasings are embedded as queries and the entry keeps its best score.
 */
export function documentTexts(e: Entry): string[] {
	const parts = [
		`${e.title.full}.`,
		e.summary.text,
		...(e.details ?? []).map((d) => `${d.heading}: ${d.body}`),
		...(e.steps ?? []).map((s) => `${s.position}. ${s.name}. ${s.text}`),
	];
	return [parts.join(' '), ...e.search.example_phrasings.map(queryText)];
}

export function cosine(a: readonly number[], b: readonly number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i]!;
		const y = b[i] ?? 0;
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export interface StoredVector {
	entryId: string;
	vector: number[];
}

/** Brute force. Fine for the seed corpus; Vectorize replaces it in build step 6. */
export function nearest(query: readonly number[], vectors: readonly StoredVector[]) {
	return vectors.map((v) => ({ entryId: v.entryId, score: cosine(query, v.vector) }));
}
