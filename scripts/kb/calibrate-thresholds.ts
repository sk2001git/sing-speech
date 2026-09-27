/**
 * Where the three lines go, measured against the index the Worker actually serves.
 *
 *   npx tsx scripts/kb/calibrate-thresholds.ts
 *
 * `bench-embed.ts` compares models using one vector per entry. The served index holds more
 * than that — each entry's example phrasings are embedded too, and a phrasing is a much
 * easier thing for a stray question to match. Set the floor from the bench and an
 * out-of-scope question walks in: "which brand of vitamin should I buy for my knee" was
 * answered from "Aged 60 and above and feeling unwell".
 *
 * So the floor is set here, against every vector in data/kb/index.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cosine, queryText } from '../../src/lib/kb/embed';
import type { Entry } from '../../src/lib/kb/entry';
import { OpenAi } from '../../src/lib/providers/openai';
import { ASKED, OUT_OF_SCOPE } from './calibration-questions';

const ROOT = path.resolve(import.meta.dirname, '../..');
const INDEX = path.join(ROOT, 'data/kb/index.json');

function envValue(name: string): string | undefined {
	if (process.env[name]) return process.env[name];
	const file = path.join(ROOT, '.env');
	if (!fs.existsSync(file)) return undefined;
	const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
	return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8')) as {
	embedding: { model: string; dimensions: number };
	entries: Entry[];
	vectors: { entryId: string; vector: number[] }[];
};
const openai = new OpenAi({ apiKey: envValue('OPENAI_API_KEY')! });

const asked = ASKED.map((text) => ({ entryId: '', text }));

const best = (vector: number[]) => {
	const scores = new Map<string, number>();
	for (const v of index.vectors) {
		const score = cosine(vector, v.vector);
		if (score > (scores.get(v.entryId) ?? -1)) scores.set(v.entryId, score);
	}
	return [...scores].sort((a, b) => b[1] - a[1]);
};

const BATCH = 96;
async function embedAll(texts: string[]): Promise<number[][]> {
	const out: number[][] = [];
	for (let i = 0; i < texts.length; i += BATCH) {
		out.push(...(await openai.embed(index.embedding.model, texts.slice(i, i + BATCH).map(queryText), index.embedding.dimensions)));
	}
	return out;
}

const rightVectors = await embedAll(asked.map((a) => a.text));
const outVectors = await embedAll(OUT_OF_SCOPE);

const rightTop: number[] = [];
for (const [i] of asked.entries()) rightTop.push(best(rightVectors[i]!)[0]?.[1] ?? 0);
const outTop = outVectors.map((v) => best(v)[0]?.[1] ?? 0);

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!;
const worstOut = Math.max(...outTop);

console.log(`${index.entries.length} entries, ${index.vectors.length} vectors, ${index.embedding.model} @ ${index.embedding.dimensions}`);
console.log(`\nquestions we can answer: p05 ${pct(rightTop, 0.05).toFixed(3)}  p10 ${pct(rightTop, 0.1).toFixed(3)}  median ${pct(rightTop, 0.5).toFixed(3)}`);
for (const [i, q] of ASKED.entries()) if (rightTop[i]! < 0.6) console.log(`   ${rightTop[i]!.toFixed(3)}  ${q}`);
console.log(`out of scope: median ${pct(outTop, 0.5).toFixed(3)}  worst ${worstOut.toFixed(3)}`);
for (const [i, q] of OUT_OF_SCOPE.entries()) if (outTop[i]! > 0.45) console.log(`   ${outTop[i]!.toFixed(3)}  ${q}`);

/*
 * The two distributions overlap — they always will, because "my grandson wants to borrow
 * money" is genuinely close to CPF questions. The floor is placed to let through as many
 * real questions as possible while turning away every one we cannot answer, and where that
 * is impossible, turning away is the side to err on.
 */
for (const floor of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) {
	const kept = rightTop.filter((s) => s >= floor).length;
	const letIn = outTop.filter((s) => s >= floor).length;
	console.log(`floor ${floor.toFixed(2)}: ${kept} of ${rightTop.length} real questions kept, ${letIn} of ${outTop.length} unanswerable ones let in`);
}
console.log(`\nout-of-scope median ${pct(outTop, 0.5).toFixed(3)}, worst ${worstOut.toFixed(3)}; real-question median ${pct(rightTop, 0.5).toFixed(3)}`);
