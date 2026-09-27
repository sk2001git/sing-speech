import { cosine, type StoredVector } from './embed';
import type { Thresholds } from './rank';

/**
 * Card search on the Cloudflare route (vault plan-suara-0016): Workers AI bge-m3 ($0.012 per M
 * tokens) and a Vectorize index, instead of OpenAI's embedding and the in-memory index the OpenAI
 * route uses.
 *
 * Measured with scripts/kb/bench-cf-embed.ts on the calibration questions, 2026-09-27: today's top
 * card is in bge-m3's six nearest for 29 of 29 (the relevance check reads six); answerable and
 * unanswerable questions sit as far apart as with OpenAI's embedding (lowest answerable 0.704,
 * worst unanswerable 0.631). qwen3-embedding-0.6b separated them further but took a median 1.4 s
 * and up to 10 s a query, against bge-m3's 0.16 s: someone is waiting. The lines sit where
 * today's sit on bge-m3's own scale.
 */
export const CF_EMBEDDING = { model: '@cf/baai/bge-m3', dimensions: 1024, index: 'suara-cards-bge-m3' } as const;
export const CF_THRESHOLDS: Thresholds = { strong: 0.79, weak: 0.7, floor: 0.66 };

export interface AiEmbedder {
	run(model: string, input: Record<string, unknown>): Promise<unknown>;
}
export interface VectorizeLike {
	query(vector: number[], opts: { topK: number }): Promise<{ matches: { id: string; score: number }[] }>;
}

/** bge-m3 embeds questions and cards alike, with no instruction. */
export function cloudflareEmbed(ai: AiEmbedder) {
	return async (text: string, _kind: 'query' | 'document'): Promise<number[]> => {
		const out = (await ai.run(CF_EMBEDDING.model, { text: [text] })) as { data?: number[][] };
		const vector = out.data?.[0];
		if (!vector) throw new Error('Workers AI returned no embedding');
		return vector;
	};
}

/**
 * Card ids run to 67 characters and Vectorize allows 64, so a vector's id is a short hash of its
 * card's id and the text's position within the card. The Worker, holding every card, maps back.
 */
function key(entryId: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < entryId.length; i++) h = Math.imul(h ^ entryId.charCodeAt(i), 0x01000193) >>> 0;
	let g = 0x9e3779b9;
	for (let i = entryId.length - 1; i >= 0; i--) g = Math.imul(g ^ entryId.charCodeAt(i), 0x85ebca6b) >>> 0;
	return h.toString(36) + g.toString(36);
}
export const vectorId = (entryId: string, n: number) => `${key(entryId)}:${n}`;

/**
 * The nearest cards' vectors, as the in-memory search returns them. `extra`: cards written from the
 * crawl in this isolate, kept in memory like the OpenAI route keeps them.
 */
export function vectorizeNearest(index: VectorizeLike, entryIds: Iterable<string>, extra: () => StoredVector[] = () => []) {
	const byKey = new Map<string, string>();
	for (const id of entryIds) byKey.set(key(id), id);
	return async (vector: number[]): Promise<{ entryId: string; score: number }[]> => {
		const { matches } = await index.query(vector, { topK: 100 });
		const found = matches.flatMap((m) => {
			const entryId = byKey.get(m.id.split(':')[0]!);
			return entryId ? [{ entryId, score: m.score }] : [];
		});
		return [...found, ...extra().map((v) => ({ entryId: v.entryId, score: cosine(vector, v.vector) }))];
	};
}
