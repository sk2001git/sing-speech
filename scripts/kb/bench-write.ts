/**
 * Which model should write an on-demand card, measured rather than assumed.
 *
 *   npx tsx scripts/kb/bench-write.ts
 *   npx tsx scripts/kb/bench-write.ts --runs 2
 *
 * A card has to arrive while somebody is holding a phone waiting for it, and it has to pass
 * the grounding checks first time or the person waits for a retry as well. So each candidate
 * is asked to write the same three cards from the same crawled pages, and what is recorded
 * is: how long it took, whether the draft validated, and what it actually wrote.
 *
 * Prices are read live from OpenRouter's own catalogue, never from memory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { composePrompt, draftToEntry, readDraft, type ComposeRequest } from '../../src/lib/kb/compose';
import type { RawDoc } from '../../src/lib/kb/raw-store';
import { openaiWriter, openrouterWriter } from '../../src/lib/routes/write';

const ROOT = path.resolve(import.meta.dirname, '../..');
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1] ?? 1) || 1;

const env = Object.fromEntries(
	fs
		.readFileSync(path.join(ROOT, '.env'), 'utf8')
		.split(/\r?\n/)
		.filter((l) => l.includes('=') && !l.startsWith('#'))
		.map((l) => {
			const i = l.indexOf('=');
			return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
		}),
) as Record<string, string>;

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/kb/raw-index.json'), 'utf8')) as { questions: RawDoc[] };
const byWords = (words: string) => {
	const found = index.questions.find((q) => q.title.toLowerCase().includes(words.toLowerCase()));
	if (!found) throw new Error(`no crawled question matching "${words}"`);
	return found;
};

/** Three real pages, three real ways of asking about them. */
const cases: ComposeRequest[] = [
	{ asked: 'what is ElderFund for', docs: [byWords('ElderFund')], language: 'en' },
	{ asked: 'how do I claim CareShield Life for my mother', docs: [byWords('claim for CareShield Life')], language: 'en' },
	{ asked: 'my father cannot afford his CareShield premium, can I pay it', docs: [byWords('help my family members pay for their CareShield Life premiums')], language: 'en' },
];

const candidates = [
	{ name: 'openai gpt-5.6-luna', write: openaiWriter(env.OPENAI_API_KEY!, 'gpt-5.6-luna') },
	{ name: 'or deepseek-v4.1-flash', write: openrouterWriter(env.OPENROUTER_API_KEY!, 'deepseek/deepseek-v4.1-flash') },
	{ name: 'or deepseek-v4-flash', write: openrouterWriter(env.OPENROUTER_API_KEY!, 'deepseek/deepseek-v4-flash') },
	{ name: 'or gemini-3.5-flash-lite', write: openrouterWriter(env.OPENROUTER_API_KEY!, 'google/gemini-3.5-flash-lite') },
];

const now = new Date().toISOString();

for (const candidate of candidates) {
	const times: number[] = [];
	let valid = 0;
	let attempts = 0;
	const notes: string[] = [];
	for (let run = 0; run < runs; run += 1) {
		for (const req of cases) {
			attempts += 1;
			const started = Date.now();
			try {
				const reply = await candidate.write(composePrompt(req));
				times.push(Date.now() - started);
				const drafted = readDraft(reply);
				if (!drafted) {
					notes.push(`${req.docs[0]!.id}: reply was not a card`);
					continue;
				}
				const made = draftToEntry(drafted, req, now);
				if (made.ok) {
					valid += 1;
					if (run === 0) notes.push(`"${made.entry.title.full}" / ${made.entry.steps?.length ?? 0} steps / ${made.entry.summary.text}`);
				} else {
					notes.push(`${req.docs[0]!.id}: ${made.errors.slice(0, 2).join('; ')}`);
				}
			} catch (err) {
				times.push(Date.now() - started);
				notes.push(`${req.docs[0]!.id}: ${(err as Error).message.slice(0, 120)}`);
			}
		}
	}
	const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0;
	console.log(`\n${candidate.name}: ${valid}/${attempts} usable first time, median ${(median / 1000).toFixed(1)} s, slowest ${(Math.max(...times) / 1000).toFixed(1)} s`);
	for (const note of notes) console.log(`   ${note}`);
}
