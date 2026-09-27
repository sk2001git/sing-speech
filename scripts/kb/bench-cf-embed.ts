/**
 * Can a Workers AI embedding serve the Cloudflare route's card search (vault plan-suara-0016)?
 *
 *   npx tsx scripts/kb/bench-cf-embed.ts
 *
 * Embeds every text in the served index (each card, and each example phrasing as a query) with
 * each candidate, then asks the calibration questions: the 29 answerable ones should score high
 * and find the same card OpenAI's embedding finds (or a better one); the 12 unanswerable ones
 * should score below them. The floor sweep says how cleanly a threshold separates the two.
 *
 * Prices from developers.cloudflare.com/workers-ai/platform/pricing, 2026-09-27: bge-m3 and
 * qwen3-embedding-0.6b both $0.012 per M input tokens. A run is a fraction of a cent, within the
 * free daily neurons. Vectors are saved to .scratch so the chosen model's can be uploaded as is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { cosine, QUERY_INSTRUCTION, queryText } from '../../src/lib/kb/embed';
import type { Entry } from '../../src/lib/kb/entry';
import { OpenAi } from '../../src/lib/providers/openai';
import { ASKED, OUT_OF_SCOPE } from './calibration-questions';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.resolve(ROOT, '../.scratch/embed-bench');
fs.mkdirSync(OUT, { recursive: true });

function envValue(name: string): string | undefined {
	const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
	return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kb/index.json'), 'utf8')) as {
	embedding: { model: string; dimensions: number };
	entries: Entry[];
	vectors: { entryId: string; vector: number[] }[];
};
const title = new Map(index.entries.map((e) => [e.id, e.title.full]));

/** The index's own texts, in its own order: each card, then each phrasing as a query. */
function indexTexts(e: Entry): { text: string; kind: 'doc' | 'query' }[] {
	const parts = [`${e.title.full}.`, e.summary.text, ...(e.details ?? []).map((d) => `${d.heading}: ${d.body}`), ...(e.steps ?? []).map((s) => `${s.position}. ${s.name}. ${s.text}`)];
	return [{ text: parts.join(' '), kind: 'doc' }, ...e.search.example_phrasings.map((p) => ({ text: p, kind: 'query' as const }))];
}
const jobs = index.entries.flatMap((e) => indexTexts(e).map((j) => ({ entryId: e.id, ...j })));

const proxy = await getPlatformProxy<{ AI: { run(model: string, input: Record<string, unknown>): Promise<{ data: number[][] }> } }>({ configPath: path.join(ROOT, 'wrangler.jsonc') });
const ai = proxy.env.AI;

type Embed = (texts: string[], kind: 'doc' | 'query') => Promise<number[][]>;
async function batched(texts: string[], size: number, one: (batch: string[]) => Promise<number[][]>): Promise<number[][]> {
	const out: number[][] = [];
	for (let i = 0; i < texts.length; i += size) out.push(...(await one(texts.slice(i, i + size))));
	return out;
}
const MODELS: Record<string, Embed> = {
	'@cf/baai/bge-m3': (texts) => batched(texts, 32, async (b) => (await ai.run('@cf/baai/bge-m3', { text: b })).data),
	'@cf/qwen/qwen3-embedding-0.6b': (texts, kind) =>
		batched(texts, 32, async (b) => (await ai.run('@cf/qwen/qwen3-embedding-0.6b', kind === 'doc' ? { documents: b } : { queries: b, instruction: QUERY_INSTRUCTION })).data),
};

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!;
function rankFor(vector: number[], vectors: { entryId: string; vector: number[] }[]) {
	const best = new Map<string, number>();
	for (const v of vectors) {
		const s = cosine(vector, v.vector);
		if (s > (best.get(v.entryId) ?? -1)) best.set(v.entryId, s);
	}
	return [...best].sort((a, b) => b[1] - a[1]);
}

interface Report {
	model: string;
	dims: number;
	realP05: number;
	realMedian: number;
	outMedian: number;
	outWorst: number;
	/** The floor that keeps the most real questions while letting no unanswerable one in. */
	bestFloor: { floor: number; kept: number } | null;
	top1: string[];
	/** The six nearest cards per question: what the relevance check reads. */
	top6: string[][];
	topScore: number[];
	outTop: number[];
}

function report(model: string, vectors: { entryId: string; vector: number[] }[], askedV: number[][], outV: number[][]): Report {
	const ranks = askedV.map((v) => rankFor(v, vectors));
	const topScore = ranks.map((r) => r[0]?.[1] ?? 0);
	const outTop = outV.map((v) => rankFor(v, vectors)[0]?.[1] ?? 0);
	const worst = Math.max(...outTop);
	const kept = topScore.filter((s) => s > worst).length;
	return {
		model,
		dims: vectors[0]!.vector.length,
		realP05: pct(topScore, 0.05),
		realMedian: pct(topScore, 0.5),
		outMedian: pct(outTop, 0.5),
		outWorst: worst,
		bestFloor: { floor: Number((worst + 0.005).toFixed(3)), kept },
		top1: ranks.map((r) => r[0]?.[0] ?? ''),
		top6: ranks.map((r) => r.slice(0, 6).map(([id]) => id)),
		topScore,
		outTop,
	};
}

// Today's model, from the served index, for comparison.
const openai = new OpenAi({ apiKey: envValue('OPENAI_API_KEY')! });
const oaiQ = async (qs: string[]) => openai.embed(index.embedding.model, qs.map(queryText), index.embedding.dimensions);
const reports: Report[] = [report(`${index.embedding.model}@${index.embedding.dimensions} (today)`, index.vectors, await oaiQ(ASKED), await oaiQ(OUT_OF_SCOPE))];

for (const [model, embed] of Object.entries(MODELS)) {
	const t0 = Date.now();
	const saved = path.join(OUT, `${model.split('/').pop()}.json`);
	if (fs.existsSync(saved)) {
		// The card vectors do not change between runs: only the questions are embedded again.
		const { vectors } = JSON.parse(fs.readFileSync(saved, 'utf8')) as { vectors: { entryId: string; vector: number[] }[] };
		reports.push(report(model, vectors, await embed([...ASKED], 'query'), await embed([...OUT_OF_SCOPE], 'query')));
		continue;
	}
	const docIdx = jobs.flatMap((j, i) => (j.kind === 'doc' ? [i] : []));
	const qIdx = jobs.flatMap((j, i) => (j.kind === 'query' ? [i] : []));
	const docV = await embed(docIdx.map((i) => jobs[i]!.text), 'doc');
	const qV = await embed(qIdx.map((i) => jobs[i]!.text), 'query');
	const all: number[][] = [];
	docIdx.forEach((i, k) => (all[i] = docV[k]!));
	qIdx.forEach((i, k) => (all[i] = qV[k]!));
	const vectors = jobs.map((j, i) => ({ entryId: j.entryId, vector: all[i]! }));
	fs.writeFileSync(path.join(OUT, `${model.split('/').pop()}.json`), JSON.stringify({ model, vectors }));
	reports.push(report(model, vectors, await embed([...ASKED], 'query'), await embed([...OUT_OF_SCOPE], 'query')));
	console.log(`${model}: ${vectors.length} vectors in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

console.log(`\n${index.entries.length} cards, ${jobs.length} texts; ${ASKED.length} answerable and ${OUT_OF_SCOPE.length} unanswerable questions\n`);
console.log('model'.padEnd(44), 'dims', 'real p05', 'real med', 'out med', 'out worst', 'kept above worst', 'same top card as today', "today's card in its top 6");
const base = reports[0]!;
for (const r of reports) {
	const same = r.top1.filter((id, i) => id === base.top1[i]).length;
	const inSix = r.top6.filter((six, i) => six.includes(base.top1[i]!)).length;
	console.log(r.model.padEnd(44), String(r.dims).padStart(4), r.realP05.toFixed(3).padStart(8), r.realMedian.toFixed(3).padStart(8), r.outMedian.toFixed(3).padStart(7), r.outWorst.toFixed(3).padStart(9), `${r.bestFloor?.kept}/${ASKED.length}`.padStart(16), `${same}/${ASKED.length}`.padStart(22), `${inSix}/${ASKED.length}`.padStart(25));
}
console.log('\nWhere a candidate picks a different top card from today:');
for (const r of reports.slice(1)) {
	for (const [i, q] of ASKED.entries()) {
		if (r.top1[i] !== base.top1[i]) console.log(`  ${r.model.split('/').pop()} | "${q}"\n      today: ${title.get(base.top1[i]!)}\n      this:  ${title.get(r.top1[i]!)}`);
	}
}
console.log('\nScores, lowest first, for placing the thresholds:');
for (const r of reports) {
	const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b).map((x) => x.toFixed(3)).join(' ');
	console.log(`  ${r.model.split('/').pop()}\n    answerable:   ${sorted(r.topScore)}\n    unanswerable: ${sorted(r.outTop)}`);
}
await proxy.dispose();
