/**
 * Score held-out spoken-style requests against the built index, to set the strong and
 * weak lines for the embedding model. None of these sentences is an example phrasing in
 * any entry, so the scores are not flattered by matching an entry's own text.
 *
 *   npx tsx scripts/kb/calibrate.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import index from '../../data/kb/index.json';
import { nearest, queryText } from '../../src/lib/kb/embed';
import { bestPerEntry } from '../../src/lib/kb/rank';
import { OpenRouter } from '../../src/lib/providers/openrouter';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** [request, expected entry id, or null when nothing in the corpus answers it] */
const CASES: Array<[string, string | null]> = [
	['The polyclinic doctor gave me a letter to go to the emergency department, will I pay less?', 'sg.moh.gpfirst-emergency-referral'],
	['I cannot find my Pioneer Generation card anywhere', 'sg.moh.pioneer-card-replacement'],
	['My Merdeka card is torn, how do I get another one', 'sg.moh.merdeka-card-replacement'],
	['Which insurance covers a big hospital bill', 'sg.moh.medishield-vs-careshield'],
	['I am 72 and I have a fever and a cough', 'sg.moh.unwell-aged-60'],
	['My test kit shows positive but I feel okay, can I go to the market', 'sg.moh.covid-positive-but-well'],
	['Do I need a mask when I visit my husband in the ward', 'sg.moh.masks-in-healthcare'],
	['How do I sign up for Silver Support', 'sg.cpf.silver-support-no-application'],
	['Am I eligible for Silver Support this year', 'sg.cpf.silver-support-eligibility'],
	['I want to meet a CPF officer face to face', 'sg.cpf.book-appointment'],
	['I forgot my Singpass password', 'sg.cpf.singpass-password-reset'],
	['Singpass keeps sending the code to my old phone number', 'sg.cpf.singpass-update-contact'],
	['The CPF app will not let me log in with the QR code', 'sg.cpf.cpf-mobile-qr-login'],
	['I need a copy of my CPF statement for last year', 'sg.cpf.yearly-statement'],
	['I moved to a new flat, how does CPF know my address', 'sg.cpf.change-address'],
	['If my daughter puts money into my MediSave, does the government add more', 'sg.cpf.matched-medisave'],
	['How much money can be put into my retirement account', 'sg.cpf.top-up-limit'],
	['How do I renew my passport', null],
	['What time does the MRT start running', null],
	['How much is the bus fare for seniors', null],
	['Someone called saying they are from the police and asked me to transfer money', null],
	['Where can I buy durian', null],
	['How do I apply for an HDB flat', null],
	['What is the weather tomorrow', null],
];

function key(): string {
	if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
	const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('OPENROUTER_API_KEY='));
	if (!line) throw new Error('OPENROUTER_API_KEY is not set');
	return line.slice('OPENROUTER_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
}

const or = new OpenRouter({ apiKey: key(), title: 'Suara calibration' });
const vectors = await or.embed(index.embedding.model, CASES.map(([q]) => queryText(q)), index.embedding.dimensions);

const inTop: number[] = [];
const outTop: number[] = [];
const wrongTop: number[] = [];
let top1 = 0;
let top6 = 0;
CASES.forEach(([q, want], i) => {
	const ranked = bestPerEntry(nearest(vectors[i]!, index.vectors));
	const best = ranked[0]!;
	const pos = want ? ranked.findIndex((r) => r.id === want) : -1;
	if (want) {
		if (pos === 0) top1++;
		if (pos >= 0 && pos < 6) top6++;
		(pos === 0 ? inTop : wrongTop).push(best.score);
	} else outTop.push(best.score);
	const tag = want ? (pos === 0 ? 'ok  ' : `rank${pos + 1}`) : 'none';
	console.log(`${tag.padEnd(6)} ${best.score.toFixed(3)} ${best.id.padEnd(38)} next ${ranked[1]!.score.toFixed(3)}  "${q}"`);
});

const range = (xs: number[]) => (xs.length ? `${Math.min(...xs).toFixed(3)}-${Math.max(...xs).toFixed(3)}` : '-');
console.log(`\nin-scope top-1 ${top1}/17, top-6 ${top6}/17`);
console.log(`top score when right: ${range(inTop)}; when wrong: ${range(wrongTop)}; out of scope: ${range(outTop)}`);
