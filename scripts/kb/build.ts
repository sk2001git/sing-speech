/**
 * Build the served knowledge-base index from the authored entries.
 *
 *   npx tsx scripts/kb/build.ts            validate, check grounding, embed, write data/kb/index.json
 *   npx tsx scripts/kb/build.ts --no-embed validate and check grounding only
 *
 * Authored entries in data/kb/entries stay as written. The index holds only entries that
 * passed every check, with their checks and source hashes filled in, plus one vector per
 * embedded text. Page snapshots in data/kb/pages are what quotes are checked against:
 * <agency>-<question id>.txt, the extracted text of https://ask.gov.sg/<agency>/questions/<id>.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { documentTexts } from '../../src/lib/kb/embed';
import { parseEntry, type Entry } from '../../src/lib/kb/entry';
import { checkQuotesFound, checkRefsResolve, type Check } from '../../src/lib/kb/grounding';
import { OpenAi } from '../../src/lib/providers/openai';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENTRIES = path.join(ROOT, 'data/kb/entries');
const PAGES = path.join(ROOT, 'data/kb/pages');
const INDEX = path.join(ROOT, 'data/kb/index.json');
/**
 * text-embedding-3-large, shortened to 768 dimensions.
 *
 * Measured on this corpus (scripts/kb/bench-embed.ts, 141 entries, 450 phrasings):
 *
 *   large @ 768   right entry in the first six 95.6%   gap to out-of-scope 0.109
 *   large @ 1536  96.0%                                0.107
 *   small @ 1536  84.0%                                0.064
 *   small @ 768   83.8%                                0.056
 *
 * 768 over 1536 because the second half buys nothing here and doubles what the Worker
 * carries; large over small because twelve points of recall is the difference between
 * finding the right card and writing a new one (vault dec-suara-0022).
 */
const MODEL = 'text-embedding-3-large';
const DIMENSIONS = 768;
const BATCH = 96;

function envKey(name: string): string | undefined {
	if (process.env[name]) return process.env[name];
	const file = path.join(ROOT, '.env');
	if (!fs.existsSync(file)) return undefined;
	const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
	return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

function snapshotFor(url: string): string | undefined {
	const m = url.match(/^https:\/\/ask\.gov\.sg\/([a-z0-9]+)\/questions\/([a-z0-9]+)$/);
	if (!m) return undefined;
	const file = path.join(PAGES, `${m[1]}-${m[2]}.txt`);
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

/**
 * Four decimals. The vectors are the bulk of the served index, and six decimals of a
 * cosine nobody compares to that precision cost half a megabyte of the Worker's budget.
 */
const round = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4);

async function main() {
	const embed = !process.argv.includes('--no-embed');
	const at = new Date().toISOString();
	const grounded: Entry[] = [];
	let failed = 0;

	for (const name of fs.readdirSync(ENTRIES).filter((f) => f.endsWith('.json')).sort()) {
		const parsed = parseEntry(JSON.parse(fs.readFileSync(path.join(ENTRIES, name), 'utf8')));
		if (!parsed.ok) {
			failed++;
			console.log(`INVALID  ${name}\n  ${parsed.errors.join('\n  ')}`);
			continue;
		}
		const e = parsed.entry;
		if (`${e.id}.json` !== name) {
			failed++;
			console.log(`INVALID  ${name}: file name does not match id ${e.id}`);
			continue;
		}

		const pages: Record<string, string> = {};
		for (const s of e.sources) {
			const text = snapshotFor(s.url);
			if (text === undefined) continue;
			pages[s.id] = text;
			s.content_hash = `sha256:${createHash('sha256').update(text).digest('hex')}`;
		}

		const checks: Check[] = [
			checkRefsResolve(e, at),
			checkQuotesFound(e, pages, at),
			// Lengths are enforced by parseEntry above; recorded so the index says so.
			{ type: 'lengths', passed: true, at },
		];
		const ok = checks.every((c) => c.passed);
		e.verification = { status: ok ? 'grounded' : 'withdrawn', checks, next_check_due: null };
		if (ok) grounded.push(e);
		else failed++;
		console.log(`${ok ? 'GROUNDED' : 'WITHDRAWN'} ${e.id}${ok ? '' : `\n  ${checks.filter((c) => !c.passed).map((c) => `${c.type}: ${c.note}`).join('\n  ')}`}`);
	}

	console.log(`\n${grounded.length} grounded, ${failed} not served.`);
	if (!embed) return;

	const key = envKey('OPENAI_API_KEY');
	if (!key) throw new Error('OPENAI_API_KEY is not set (environment or suara/.env)');
	const openai = new OpenAi({ apiKey: key });

	const jobs = grounded.flatMap((e) => documentTexts(e).map((text) => ({ entryId: e.id, text })));
	const vectors: { entryId: string; vector: number[] }[] = [];
	for (let i = 0; i < jobs.length; i += BATCH) {
		const batch = jobs.slice(i, i + BATCH);
		const out = await openai.embed(MODEL, batch.map((j) => j.text), DIMENSIONS);
		out.forEach((v, k) => vectors.push({ entryId: batch[k]!.entryId, vector: round(v) }));
	}

	fs.writeFileSync(
		INDEX,
		`${JSON.stringify({ built_at: at, embedding: { model: MODEL, dimensions: DIMENSIONS }, entries: grounded, vectors })}\n`,
	);
	console.log(`Wrote ${path.relative(ROOT, INDEX)}: ${grounded.length} entries, ${vectors.length} vectors.`);
	if (failed > 0) process.exitCode = 1;
}

await main();
