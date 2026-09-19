/**
 * Which embedding model should serve retrieval, measured on our own corpus.
 *
 *   npx tsx scripts/kb/bench-embed.ts
 *
 * Each entry is embedded as a document; each of its example phrasings is embedded as a
 * query. A model earns its place by putting the right entry first, and by keeping the
 * scores for questions Suara cannot answer below the scores for questions it can — the gap
 * between those two is what the thresholds are set from, so it is measured here too.
 *
 * Prices are read from the vendor's own page on the day, never from memory. Cost of one
 * run is a fraction of a cent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cosine, documentTexts, queryText } from '../../src/lib/kb/embed';
import { parseEntry, type Entry } from '../../src/lib/kb/entry';
import { OpenAi } from '../../src/lib/providers/openai';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENTRIES = path.join(ROOT, 'data/kb/entries');
const BATCH = 96;

function envValue(name: string): string | undefined {
	if (process.env[name]) return process.env[name];
	const file = path.join(ROOT, '.env');
	if (!fs.existsSync(file)) return undefined;
	const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
	return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

const openai = new OpenAi({ apiKey: envValue('OPENAI_API_KEY')! });

const entries: Entry[] = fs
	.readdirSync(ENTRIES)
	.filter((f) => f.endsWith('.json'))
	.map((f) => {
		const parsed = parseEntry(JSON.parse(fs.readFileSync(path.join(ENTRIES, f), 'utf8')));
		if (!parsed.ok) throw new Error(`${f}: ${parsed.errors.join('; ')}`);
		return parsed.entry;
	});

/** Questions no official page answers. Their best score is what the floor has to sit above. */
const OUT_OF_SCOPE = [
	'which brand of vitamin should I buy for my knee',
	'what is the weather tomorrow',
	'can you call my daughter for me',
	'my neighbour is very noisy at night',
	'how do I cook chicken rice',
	'is the stock market going up',
	'my phone screen is cracked',
	'when is the next bus to Tampines',
];

const docs = entries.map((e) => documentTexts(e)[0]!);
const asked: { entryId: string; text: string }[] = entries.flatMap((e) =>
	e.search.example_phrasings.map((p) => ({ entryId: e.id, text: queryText(p) })),
);
const outside = OUT_OF_SCOPE.map(queryText);

async function embedAll(model: string, dimensions: number, texts: string[]): Promise<number[][]> {
	const out: number[][] = [];
	for (let i = 0; i < texts.length; i += BATCH) out.push(...(await openai.embed(model, texts.slice(i, i + BATCH), dimensions)));
	return out;
}

const candidates = [
	{ model: 'text-embedding-3-small', dimensions: 768, price: 0.02 },
	{ model: 'text-embedding-3-small', dimensions: 1536, price: 0.02 },
	{ model: 'text-embedding-3-large', dimensions: 768, price: 0.13 },
	{ model: 'text-embedding-3-large', dimensions: 1536, price: 0.13 },
];

console.log(`${entries.length} entries, ${asked.length} phrasings, ${outside.length} out-of-scope questions\n`);

for (const c of candidates) {
	const started = Date.now();
	const docVectors = await embedAll(c.model, c.dimensions, docs);
	const askVectors = await embedAll(c.model, c.dimensions, asked.map((a) => a.text));
	const outVectors = await embedAll(c.model, c.dimensions, outside);

	let top1 = 0;
	let top6 = 0;
	const rightScores: number[] = [];
	for (const [i, a] of asked.entries()) {
		const scored = docVectors
			.map((v, j) => ({ id: entries[j]!.id, score: cosine(askVectors[i]!, v) }))
			.sort((x, y) => y.score - x.score);
		if (scored[0]!.id === a.entryId) top1 += 1;
		if (scored.slice(0, 6).some((s) => s.id === a.entryId)) top6 += 1;
		rightScores.push(scored.find((s) => s.id === a.entryId)?.score ?? 0);
	}

	const outBest = outVectors.map((v) => Math.max(...docVectors.map((d) => cosine(v, d))));
	const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!;

	console.log(`${c.model} @ ${c.dimensions} dims, $${c.price} per M tokens, ${(Date.now() - started) / 1000}s`);
	console.log(`   right entry first: ${((top1 / asked.length) * 100).toFixed(1)}%   in the first six: ${((top6 / asked.length) * 100).toFixed(1)}%`);
	console.log(`   right answer scores: p10 ${pct(rightScores, 0.1).toFixed(3)}  median ${pct(rightScores, 0.5).toFixed(3)}`);
	console.log(`   out-of-scope best:   median ${pct(outBest, 0.5).toFixed(3)}  worst ${Math.max(...outBest).toFixed(3)}`);
	console.log(`   gap between them:    ${(pct(rightScores, 0.1) - Math.max(...outBest)).toFixed(3)}\n`);
}
