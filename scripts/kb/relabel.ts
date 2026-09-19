/**
 * Recompute the one-line label on every held entry.
 *
 *   npx tsx scripts/kb/relabel.ts            # show what would change
 *   npx tsx scripts/kb/relabel.ts --write    # write it
 *
 * The label is the card's one line, and eighteen of them read as truncations — "Checking
 * your", "Deactivating the", "Benefits of the" — because the repair took the first words of
 * the heading rather than the words that name the thing. This applies the corrected rule
 * without calling a model: a label is derived from the heading, not a claim about the world,
 * so nothing here needs grounding again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { shorten } from '../../src/lib/kb/compose';
import { parseEntry } from '../../src/lib/kb/entry';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENTRIES = path.join(ROOT, 'data/kb/entries');
const write = process.argv.includes('--write');
const LIMIT = 16;

/** A label that stops before it says anything. */
const DANGLING = /\b(the|a|an|of|for|your|my|to|with|and|when|from|in|at|on)$/i;

let changed = 0;
for (const name of fs.readdirSync(ENTRIES).filter((f) => f.endsWith('.json')).sort()) {
	const file = path.join(ENTRIES, name);
	const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as { title: { short: string; full: string } };
	const { short, full } = entry.title;
	// Left alone unless it reads as a truncation: a label the model wrote well is better than
	// anything derived from the heading.
	if (!DANGLING.test(short) && [...short].length <= LIMIT) continue;

	const better = shorten(full, LIMIT);
	if (!better || better === short) continue;
	console.log(`${short.padEnd(18)} -> ${better.padEnd(18)}  (${full})`);
	changed += 1;
	if (!write) continue;

	entry.title.short = better;
	const parsed = parseEntry(entry);
	if (!parsed.ok) {
		console.warn(`  left alone, the change would break the schema: ${parsed.errors.join('; ')}`);
		continue;
	}
	fs.writeFileSync(file, `${JSON.stringify(entry, null, '\t')}\n`);
}

console.log(`\n${changed} label(s) ${write ? 'rewritten' : 'would change'}`);
if (!write) console.log('run again with --write to apply, then npx tsx scripts/kb/build.ts');
