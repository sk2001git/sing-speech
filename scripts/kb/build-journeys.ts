/**
 * Check the journeys and put them in the served index.
 *
 *   npx tsx scripts/kb/build-journeys.ts
 *
 * A journey is the only part of the corpus written by hand rather than composed from a
 * page, so it is the part most able to drift: a card it names can be replaced when the
 * corpus is rebuilt, and a stage pointing at nothing would show a person an empty screen in
 * the worst week of their life. Nothing here is served unless every card it names exists in
 * `data/kb/index.json` and is grounded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseEntry, type Entry } from '../../src/lib/kb/entry';
import { nowNext, parseJourney, type Journey } from '../../src/lib/kb/journey';

const ROOT = path.resolve(import.meta.dirname, '../..');
const JOURNEYS = path.join(ROOT, 'data/kb/journeys');
const INDEX = path.join(ROOT, 'data/kb/index.json');
const OUT = path.join(ROOT, 'data/kb/journey-index.json');

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8')) as { entries: unknown[] };
const cards = new Map<string, Entry>();
for (const raw of index.entries) {
	const parsed = parseEntry(raw);
	if (parsed.ok && parsed.entry.verification.status === 'grounded') cards.set(parsed.entry.id, parsed.entry);
}

const served: Journey[] = [];
let failed = 0;

for (const name of fs.readdirSync(JOURNEYS).filter((f) => f.endsWith('.json')).sort()) {
	const parsed = parseJourney(JSON.parse(fs.readFileSync(path.join(JOURNEYS, name), 'utf8')));
	if (!parsed.ok) {
		failed += 1;
		console.log(`INVALID  ${name}\n  ${parsed.errors.join('\n  ')}`);
		continue;
	}
	const journey = parsed.entry;

	const missing: string[] = [];
	for (const stage of journey.stages) for (const id of stage.cards) if (!cards.has(id)) missing.push(`${stage.id} -> ${id}`);
	if (missing.length > 0) {
		failed += 1;
		console.log(`BROKEN   ${journey.id}: cards that are not in the index\n  ${missing.join('\n  ')}`);
		continue;
	}

	const start = nowNext(journey, new Set());
	served.push(journey);
	console.log(`READY    ${journey.id}: ${journey.stages.length} stages, ${journey.stages.reduce((n, s) => n + s.cards.length, 0)} cards`);
	console.log(`         first: ${start.now.map((s) => s.name).join(' · ')}`);
	console.log(`         ends:  ${journey.concludes_when}`);
}

fs.writeFileSync(OUT, `${JSON.stringify({ built_at: new Date().toISOString(), journeys: served })}\n`);
console.log(`\n${served.length} journey(s) served, ${failed} not.`);
if (failed > 0) process.exitCode = 1;
