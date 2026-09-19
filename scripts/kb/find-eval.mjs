/**
 * Does typing a few letters find the right card?
 *
 *   node scripts/kb/find-eval.mjs
 *   node scripts/kb/find-eval.mjs --show     # print the six offered for each fragment
 *
 * Twenty fragments in the shape people actually type: half a word, the words in the wrong
 * order, a letter missed, a letter doubled. Each says what the card must be about — matched
 * against the label and heading, because card ids change as the corpus is rebuilt and what
 * matters is that a person sees the right thing first.
 *
 * No server and no model: this is the same scoring the browser runs on each keystroke, over
 * the same index it fetches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '../..');
const show = process.argv.includes('--show');

// The scorer is TypeScript; tsx compiles it when this is run through `npx tsx`, and Node
// alone cannot. Loaded through a small shim so the eval runs either way.
const require = createRequire(import.meta.url);
let quickFind;
try {
	({ quickFind } = await import(pathToFileURL(path.join(ROOT, 'src/lib/kb/quick.ts')).href));
} catch {
	require('tsx/cjs');
	({ quickFind } = require(path.join(ROOT, 'src/lib/kb/quick.ts')));
}

const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/kb/find.json'), 'utf8')).cards ?? [];

/** `typed` is what a person puts in the box; `about` is what the first card must be about. */
const FRAGMENTS = [
	{ typed: 'medisave', about: /medisave/i },
	{ typed: 'medsav', about: /medisave/i },
	{ typed: 'chas', about: /chas/i },
	{ typed: 'cha', about: /chas/i },
	{ typed: 'medishield', about: /medishield/i },
	{ typed: 'medishld', about: /medishield/i },
	{ typed: 'careshield', about: /careshield/i },
	{ typed: 'careshld claim', about: /careshield/i },
	{ typed: 'eldershield', about: /eldershield/i },
	{ typed: 'elderfund', about: /elderfund/i },
	{ typed: 'nursing home', about: /nursing|long-term care|residential/i },
	{ typed: 'home nursing', about: /nursing|long-term care|residential/i },
	{ typed: 'scam', about: /scam|phish|fraud|impersonat/i },
	{ typed: 'pioneer', about: /pioneer/i },
	{ typed: 'merdeka', about: /merdeka/i },
	{ typed: 'healthier sg', about: /healthier sg/i },
	{ typed: 'retirement sum', about: /retirement sum|retirement/i },
	{ typed: 'payout', about: /payout|withdraw/i },
	{ typed: 'withdraw 55', about: /withdraw|55/i },
	{ typed: 'top up limit', about: /top-?up|limit/i },
];

let first = 0;
let anywhere = 0;
let slowest = 0;
let slowestTyped = '';

// The first call compiles; a person's first keystroke is not the one to optimise for, and
// timing it measures the engine rather than the search.
quickFind(cards, 'warm up', 6);

for (const { typed, about } of FRAGMENTS) {
	const started = performance.now();
	const hits = quickFind(cards, typed, 6);
	const took = performance.now() - started;
	if (took > slowest) {
		slowest = took;
		slowestTyped = typed;
	}

	const text = (hit) => `${hit.item.label} ${hit.item.heading}`;
	const isFirst = hits[0] && about.test(text(hits[0]));
	const isAnywhere = hits.some((hit) => about.test(text(hit)));
	if (isFirst) first += 1;
	if (isAnywhere) anywhere += 1;

	console.log(`${isFirst ? 'PASS' : isAnywhere ? 'NEAR' : 'FAIL'}  ${typed.padEnd(16)} -> ${hits[0]?.item.label ?? '(nothing)'}`);
	if (show) for (const hit of hits) console.log(`         ${hit.score.toFixed(1)}  ${hit.item.label}  ·  ${hit.item.heading}`);
}

console.log(`\n${first} of ${FRAGMENTS.length} put the right card first, ${anywhere} of ${FRAGMENTS.length} offer it at all`);
console.log(`slowest keystroke over ${cards.length} cards: ${slowest.toFixed(1)} ms, on "${slowestTyped}"`);

const TARGET = 18;
if (first < TARGET || slowest > 5) {
	console.log(`\nnot met: target is ${TARGET} of ${FRAGMENTS.length} first, and under 5 ms a keystroke`);
	process.exit(1);
}
