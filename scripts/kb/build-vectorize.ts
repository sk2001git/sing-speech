/**
 * Build the Cloudflare route's card index (vault plan-suara-0016): every text the served index
 * holds, embedded with Workers AI bge-m3 and upserted into Vectorize.
 *
 *   npx tsx scripts/kb/build-vectorize.ts          embed, write the file, upsert
 *   npx tsx scripts/kb/build-vectorize.ts --dry    embed and write the file only
 *
 * The same texts in the same order as data/kb/index.json: each card, then each example phrasing,
 * as plain text (bge-m3 takes no instruction, as cf-search.ts embeds questions). Vector ids
 * come from cf-search.ts, because card ids are longer than Vectorize allows. Upsert replaces
 * vectors with the same id; a card that was removed leaves its vectors behind, which the Worker
 * skips because it no longer knows the card. About a cent of neurons, within the free daily allowance.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { CF_EMBEDDING, vectorId } from '../../src/lib/kb/cf-search';
import type { Entry } from '../../src/lib/kb/entry';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.resolve(ROOT, '../.scratch/vectorize');
const FILE = path.join(OUT, `${CF_EMBEDDING.index}.ndjson`);
const dry = process.argv.includes('--dry');

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kb/index.json'), 'utf8')) as { entries: Entry[] };

const jobs = index.entries.flatMap((e) => {
	const card = [`${e.title.full}.`, e.summary.text, ...(e.details ?? []).map((d) => `${d.heading}: ${d.body}`), ...(e.steps ?? []).map((s) => `${s.position}. ${s.name}. ${s.text}`)].join(' ');
	return [{ entryId: e.id, text: card, kind: 'doc' as const }, ...e.search.example_phrasings.map((p) => ({ entryId: e.id, text: p, kind: 'query' as const }))].map((j, n) => ({ ...j, id: vectorId(e.id, n) }));
});

const proxy = await getPlatformProxy<{ AI: { run(model: string, input: Record<string, unknown>): Promise<{ data: number[][] }> } }>({ configPath: path.join(ROOT, 'wrangler.jsonc') });
const BATCH = 32; // the model's limit per call

async function embed(kind: 'doc' | 'query'): Promise<Map<string, number[]>> {
	const mine = jobs.filter((j) => j.kind === kind);
	const out = new Map<string, number[]>();
	for (let i = 0; i < mine.length; i += BATCH) {
		const batch = mine.slice(i, i + BATCH);
		const texts = batch.map((j) => j.text);
		const input = { text: texts };
		// Workers AI sometimes answers "internal error": try a batch three times before giving up.
		let data: number[][] | undefined;
		for (let attempt = 1; !data; attempt++) {
			try {
				data = (await proxy.env.AI.run(CF_EMBEDDING.model, input)).data;
			} catch (err) {
				if (attempt === 3) throw err;
			}
		}
		batch.forEach((j, k) => out.set(j.id, data![k]!));
	}
	return out;
}

const t0 = Date.now();
const vectors = new Map([...(await embed('doc')), ...(await embed('query'))]);
await proxy.dispose();
const dims = [...vectors.values()][0]!.length;
if (dims !== CF_EMBEDDING.dimensions) throw new Error(`expected ${CF_EMBEDDING.dimensions} dimensions, got ${dims}`);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(FILE, jobs.map((j) => JSON.stringify({ id: j.id, values: vectors.get(j.id)!.map((x) => Number(x.toFixed(6))) })).join('\n') + '\n');
console.log(`${index.entries.length} cards, ${jobs.length} vectors at ${dims} dimensions in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${path.relative(ROOT, FILE)}`);

if (!dry) {
	execFileSync('npx', ['wrangler', 'vectorize', 'upsert', CF_EMBEDDING.index, `--file=${FILE}`], { cwd: ROOT, stdio: 'inherit', shell: true });
}
