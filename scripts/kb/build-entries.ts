/**
 * Structure the questions our audience actually asks into entries, up front.
 *
 *   npx tsx scripts/kb/build-entries.ts                 # 12 per priority topic
 *   npx tsx scripts/kb/build-entries.ts --per 20        # more of each
 *   npx tsx scripts/kb/build-entries.ts --topic medishield --per 30
 *   npx tsx scripts/kb/build-entries.ts --refresh       # rewrite entries already held
 *   npx tsx scripts/kb/build-entries.ts --find "how do I register a death"
 *                                                     # one card for one thing we need
 *   npx tsx scripts/kb/build-entries.ts --page clw1fhgtk001lrjdsx1grsvy3
 *                                                     # one card for one page, chosen by hand
 *
 * The on-demand path (`src/lib/kb/compose.ts`) answers anything, but it makes the first
 * person to ask wait for a model call. The topics the crawl says the agencies publish most
 * and our audience asks most — MediShield Life, MediSave against a bill, subsidies,
 * CareShield and ElderShield, CPF used overseas, scams, retirement payouts — are worth
 * paying for once, here, so nobody waits for them.
 *
 * Writes the entry to data/kb/entries and the page it was written from to data/kb/pages, so
 * `build.ts` can check every quote against that page and embed what passes. Nothing here
 * bypasses those checks: an entry that fails them never reaches the index.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compose, type ComposeRequest } from '../../src/lib/kb/compose';
import { buildRawIndex, searchRaw, type RawDoc } from '../../src/lib/kb/raw-store';
import { writerFor } from '../../src/lib/routes/write';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PRIORITY = path.join(ROOT, 'data/kb/priority.json');
const ENTRIES = path.join(ROOT, 'data/kb/entries');
const PAGES = path.join(ROOT, 'data/kb/pages');

const args = process.argv.slice(2);
const at = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const per = Number(at('per') ?? 12) || 12;
const onlyTopic = at('topic');
const refresh = args.includes('--refresh');
/** Four at a time: polite to the vendor, and fast enough that this is a coffee, not an evening. */
const LANES = 4;

function envValue(name: string): string | undefined {
	if (process.env[name]) return process.env[name];
	const file = path.join(ROOT, '.env');
	if (!fs.existsSync(file)) return undefined;
	const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
	return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

const writer = writerFor({
	...(envValue('OPENAI_API_KEY') ? { openaiKey: envValue('OPENAI_API_KEY')! } : {}),
	...(envValue('OPENROUTER_API_KEY') ? { openrouterKey: envValue('OPENROUTER_API_KEY')! } : {}),
	...(envValue('SUARA_WRITE_MODEL') ? { model: envValue('SUARA_WRITE_MODEL')! } : {}),
});
if (!writer) {
	console.error('no OPENAI_API_KEY or OPENROUTER_API_KEY, so nothing can be written');
	process.exit(2);
}

interface Chosen extends RawDoc {
	priority: string;
	/** The words of the need, when this card was asked for by name. */
	asked?: string;
}

interface PriorityFile {
	topics: { key: string; label: string }[];
	questions: (RawDoc & { priority: string })[];
}

const priority = JSON.parse(fs.readFileSync(PRIORITY, 'utf8')) as PriorityFile;
fs.mkdirSync(ENTRIES, { recursive: true });
fs.mkdirSync(PAGES, { recursive: true });

const chosen: Chosen[] = [];

/*
 * `--find` structures the answer to a particular need. The pages come from the same word
 * search the app uses on a miss, so what gets written is what a person asking that would
 * have been shown.
 */
const byId = args.filter((a, i) => args[i - 1] === '--page');
if (byId.length > 0) {
	const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/kb/raw-index.json'), 'utf8')) as { questions: RawDoc[] };
	for (const id of byId) {
		const doc = raw.questions.find((q) => q.id === id);
		if (!doc) {
			console.warn(`no crawled page with id ${id}`);
			continue;
		}
		console.log(`${doc.agency}: ${doc.title.slice(0, 84)}`);
		chosen.push({ ...doc, priority: 'asked-for' });
	}
}

const needed = args.filter((a, i) => args[i - 1] === '--find');
if (needed.length > 0) {
	const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/kb/raw-index.json'), 'utf8')) as { questions: RawDoc[] };
	const index = buildRawIndex(raw.questions);
	for (const phrase of needed) {
		const hits = searchRaw(index, phrase, 3);
		if (hits.length === 0) {
			console.warn(`nothing held for "${phrase}"`);
			continue;
		}
		console.log(`"${phrase}" -> ${hits[0]!.doc.agency}: ${hits[0]!.doc.title.slice(0, 80)}`);
		chosen.push({ ...hits[0]!.doc, priority: 'asked-for', asked: phrase });
	}
}

for (const topic of needed.length > 0 || byId.length > 0 ? [] : priority.topics) {
	if (onlyTopic && topic.key !== onlyTopic) continue;
	const mine = priority.questions.filter((q) => q.priority === topic.key).slice(0, per);
	chosen.push(...mine);
	console.log(`${topic.label}: ${mine.length} of ${priority.questions.filter((q) => q.priority === topic.key).length}`);
}

const held = new Set(fs.readdirSync(ENTRIES).filter((f) => f.endsWith('.json')));
let written = 0;
let refused = 0;
let failed = 0;
const reasons = new Map<string, number>();

async function structure(doc: RawDoc & { priority: string; asked?: string }) {
	// The page's own question is how the agency phrased it, which is the fairest starting
	// point for a card written without a person in front of us. Where this was asked for by
	// name, the words of the need are used instead, so the card answers that.
	const req: ComposeRequest = { asked: doc.asked ?? doc.title, docs: [doc], language: 'en' };
	const made = await compose(req, writer!, new Date().toISOString());
	if (!made.ok) {
		const first = made.errors[0] ?? 'unknown';
		const reason = first.includes('does not answer') ? 'the page does not answer its own question' : first.slice(0, 60);
		reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
		if (first.includes('does not answer')) refused += 1;
		else failed += 1;
		return;
	}
	const entry = made.entry;
	if (!refresh && held.has(`${entry.id}.json`)) return;

	/*
	 * A rerun that chooses a different heading must replace this page's card, not add a
	 * second one: that is how one MediSave page ended up as four entries.
	 */
	for (const name of fs.readdirSync(ENTRIES).filter((f) => f.endsWith('.json') && f !== `${entry.id}.json`)) {
		const held = JSON.parse(fs.readFileSync(path.join(ENTRIES, name), 'utf8')) as { sources?: { url?: string }[] };
		if (held.sources?.[0]?.url === doc.url) fs.rmSync(path.join(ENTRIES, name));
	}
	fs.writeFileSync(path.join(ENTRIES, `${entry.id}.json`), `${JSON.stringify(entry, null, '\t')}\n`);
	// The page as crawled, which is what build.ts checks every quote against.
	fs.writeFileSync(path.join(PAGES, `${doc.agency}-${doc.id}.txt`), `${doc.title}\n${doc.text}\n`);
	held.add(`${entry.id}.json`);
	written += 1;
	console.log(`  ${entry.kind === 'process' ? 'steps' : 'answer'}  ${entry.id}  ${entry.title.full}`);
}

const queue = [...chosen];
await Promise.all(
	Array.from({ length: LANES }, async () => {
		while (queue.length > 0) {
			const doc = queue.shift();
			if (!doc) return;
			try {
				await structure(doc);
			} catch (err) {
				failed += 1;
				console.warn(`  failed ${doc.id}: ${(err as Error).message.slice(0, 120)}`);
			}
		}
	}),
);

console.log(`\n${chosen.length} considered, ${written} written, ${refused} refused by the writer, ${failed} failed`);
for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(3)}  ${reason}`);
console.log('\nnext: npx tsx scripts/kb/build.ts   (checks every quote against the page, then embeds)');
