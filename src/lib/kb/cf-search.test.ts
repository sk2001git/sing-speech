import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CF_EMBEDDING, CF_THRESHOLDS, cloudflareEmbed, vectorId, vectorizeNearest } from './cf-search';

/**
 * The Cloudflare route's card search (vault plan-suara-0016): Workers AI bge-m3 and a Vectorize
 * index. On the calibration questions bge-m3 keeps today's card in its six nearest for 29 of 29,
 * with the same gap as today between answerable and not, and answers in 0.16 s (qwen3: 1.4 s).
 */
const entries = (JSON.parse(readFileSync('data/kb/index.json', 'utf8')) as { entries: { id: string }[] }).entries.map((e) => e.id);

describe('vectorId', () => {
	it('fits Vectorize\'s 64-byte id limit for every card, even the longest', () => {
		// The longest an id can be (a 60-character slug after "sg.<agency>."), whatever the index
		// holds today: a rewrite of the cards shortened the longest real one to 58 (2026-09-29).
		const longest = `sg.mylegacy.${'a'.repeat(60)}`;
		expect(longest.length).toBeGreaterThan(64);
		for (const id of [...entries, longest]) expect(new TextEncoder().encode(vectorId(id, 99)).length).toBeLessThanOrEqual(64);
	});

	it('gives no two cards the same key', () => {
		const keys = new Set(entries.map((id) => vectorId(id, 0).split(':')[0]));
		expect(keys.size).toBe(entries.length);
	});
});

describe('cloudflareEmbed', () => {
	it('embeds questions and cards alike, as plain text', async () => {
		const run = vi.fn(async () => ({ data: [[0.1, 0.2]] }));
		expect(await cloudflareEmbed({ run })('how do I claim CHAS', 'query')).toEqual([0.1, 0.2]);
		await cloudflareEmbed({ run })('CHAS card. You can apply online.', 'document');
		expect(run.mock.calls).toEqual([
			['@cf/baai/bge-m3', { text: ['how do I claim CHAS'] }],
			['@cf/baai/bge-m3', { text: ['CHAS card. You can apply online.'] }],
		]);
	});

	it('is the model the thresholds were set for', () => {
		expect(CF_EMBEDDING).toEqual({ model: '@cf/baai/bge-m3', dimensions: 1024, index: 'suara-cards-bge-m3' });
		expect(CF_THRESHOLDS).toEqual({ strong: 0.79, weak: 0.7, floor: 0.66 });
	});
});

describe('vectorizeNearest', () => {
	it('asks Vectorize for the nearest and names the card behind each match', async () => {
		const query = vi.fn(async () => ({
			matches: [
				{ id: vectorId(entries[0]!, 2), score: 0.91 },
				{ id: vectorId(entries[1]!, 0), score: 0.88 },
				{ id: 'nobody:0', score: 0.5 },
			],
		}));
		const nearest = vectorizeNearest({ query }, entries);
		expect(await nearest([0.1, 0.2])).toEqual([
			{ entryId: entries[0], score: 0.91 },
			{ entryId: entries[1], score: 0.88 },
		]);
		expect(query).toHaveBeenCalledWith([0.1, 0.2], { topK: 100 });
	});

	it('adds cards written in this isolate, which Vectorize does not hold', async () => {
		const nearest = vectorizeNearest({ query: async () => ({ matches: [] }) }, entries, () => [{ entryId: 'sg.new.card', vector: [1, 0] }]);
		expect(await nearest([1, 0])).toEqual([{ entryId: 'sg.new.card', score: 1 }]);
	});
});
