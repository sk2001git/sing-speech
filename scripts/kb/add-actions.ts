/**
 * Give every held entry the call its page already offers.
 *
 *   npx tsx scripts/kb/add-actions.ts            # show what would change
 *   npx tsx scripts/kb/add-actions.ts --write    # write it
 *
 * Entries written before `compose.ts` learned to read a phone number carry the number in
 * their text and no button. The rule is the same one composition now applies, and the
 * number is taken from a quote already checked against the page — so this adds an
 * affordance, not a claim, and needs no model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { callAction } from '../../src/lib/kb/compose';
import { parseEntry } from '../../src/lib/kb/entry';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENTRIES = path.join(ROOT, 'data/kb/entries');
const write = process.argv.includes('--write');

let changed = 0;
for (const name of fs.readdirSync(ENTRIES).filter((f) => f.endsWith('.json')).sort()) {
	const file = path.join(ENTRIES, name);
	const parsed = parseEntry(JSON.parse(fs.readFileSync(file, 'utf8')));
	if (!parsed.ok) {
		console.warn(`skipped ${name}: ${parsed.errors[0]}`);
		continue;
	}
	const entry = parsed.entry;
	if (entry.action) continue;

	const action = callAction(entry.quotes);
	if (!action) continue;
	console.log(`${entry.id}  ->  ${action.label}`);
	changed += 1;
	if (!write) continue;

	const updated = { ...entry, action };
	const check = parseEntry(updated);
	if (!check.ok) {
		console.warn(`  left alone, the change would break the schema: ${check.errors.join('; ')}`);
		continue;
	}
	fs.writeFileSync(file, `${JSON.stringify(updated, null, '\t')}\n`);
}

console.log(`\n${changed} card(s) ${write ? 'now offer' : 'would offer'} the call`);
if (!write) console.log('run again with --write to apply, then npx tsx scripts/kb/build.ts');
