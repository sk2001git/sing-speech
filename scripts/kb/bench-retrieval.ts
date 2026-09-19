/**
 * What Tier B actually retrieves, with no model in the way.
 *
 *   npx tsx scripts/kb/bench-retrieval.ts
 *   npx tsx scripts/kb/bench-retrieval.ts --coverage 0.3
 *
 * The answer eval measures the whole path, so a wrong card could be bad retrieval or a
 * model that would not refuse. This prints the three pages the word search offers for each
 * question, which separates the two.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildRawIndex, searchRaw, tokenise, type RawDoc } from '../../src/lib/kb/raw-store';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const coverage = Number(args[args.indexOf('--coverage') + 1] ?? 0.4) || 0.4;

const docs = (JSON.parse(fs.readFileSync(path.join(ROOT, 'public/kb/raw-index.json'), 'utf8')) as { questions: RawDoc[] }).questions;
const index = buildRawIndex(docs);
console.log(`${docs.length} crawled questions, coverage floor ${coverage}\n`);

const QUESTIONS = [
	'what is MediShield Life for',
	'how much is my MediShield premium when I am 70',
	'I cannot afford my MediShield premium, what can I do',
	'can I use my MediSave to pay my father hospital bill',
	'not enough money in my MediSave for the hospital bill, how',
	'how much MediSave can I use for one day in hospital',
	'can MediSave pay for my outpatient medicine',
	'how do I apply for the CHAS card',
	'am I eligible for CHAS subsidy',
	'what do I get with the Merdeka Generation package',
	'how do I join Healthier SG at my clinic',
	'the doctor charge too expensive, got subsidy or not',
	'what is ElderShield and do I still have it',
	'what is ElderFund for',
	'who pays for the nursing home',
	'I live in Malaysia now, can I still get my CPF payout',
	'I think I got scammed, what do I do now',
	'how much CPF can I take out at 55',
	'what is the retirement sum this year',
];

for (const q of QUESTIONS) {
	const hits = searchRaw(index, q, 3, coverage);
	console.log(`${q}   [${tokenise(q).join(' ')}]`);
	if (hits.length === 0) console.log('   (nothing offered)');
	for (const h of hits) console.log(`   ${h.score.toFixed(2)}  ${h.doc.agency}  ${h.doc.title.slice(0, 92)}`);
	console.log();
}
