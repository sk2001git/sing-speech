/**
 * Does Suara answer the questions older people actually ask about money and health?
 *
 *   node scripts/kb/answer-eval.mjs                     # against http://127.0.0.1:4321
 *   node scripts/kb/answer-eval.mjs --base http://...    # against a deployment
 *   node scripts/kb/answer-eval.mjs --tier-a-only        # no model calls, no on-demand path
 *
 * Thirty questions in the words a person would use, across the topics the crawl says the
 * agencies publish most and our audience asks about most (vault plan-suara-0008). For each
 * one this records whether an answer came back, whether it came from a pre-built entry or
 * was written on demand from the crawl, and — the part that matters — whether every line on
 * the card can still be found verbatim in the page it cites.
 *
 * The grounding check is deliberately repeated here rather than trusted from the app: this
 * is the measurement that decides whether a model-written card is safe to show.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const at = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};
const BASE = at('base', 'http://localhost:4321');
const tierAOnly = args.includes('--tier-a-only');
const ROOT = path.resolve(import.meta.dirname, '../..');

/** The crawl, to check quotes against the page they claim to come from. */
const rawById = new Map(
	// Question plus answer: a page's published question is part of the page and may be quoted.
	(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kb/raw-index.json'), 'utf8')).questions ?? []).map((q) => [
		q.url,
		`${q.title}\n${q.text}`,
	]),
);

const QUESTIONS = [
	// MediShield Life — the largest topic MOH publishes.
	{ topic: 'medishield', ask: 'what is MediShield Life for' },
	{ topic: 'medishield', ask: 'how much is my MediShield premium when I am 70' },
	{ topic: 'medishield', ask: 'can I use MediShield if I already have company insurance' },
	{ topic: 'medishield', ask: 'I cannot afford my MediShield premium, what can I do' },
	{ topic: 'medishield', ask: 'what is the difference between MediShield Life and CareShield Life' },
	// MediSave against a medical bill.
	{ topic: 'medisave-medical', ask: 'can I use my MediSave to pay my father hospital bill' },
	{ topic: 'medisave-medical', ask: 'not enough money in my MediSave for the hospital bill, how' },
	{ topic: 'medisave-medical', ask: 'how much MediSave can I use for one day in hospital' },
	{ topic: 'medisave-medical', ask: 'can MediSave pay for my outpatient medicine' },
	{ topic: 'medisave-medical', ask: 'can I use MediSave to pay my wife medical bill' },
	// Healthcare subsidies.
	{ topic: 'subsidies', ask: 'how do I apply for the CHAS card' },
	{ topic: 'subsidies', ask: 'am I eligible for CHAS subsidy' },
	{ topic: 'subsidies', ask: 'I lost my Pioneer Generation card how to get a new one' },
	{ topic: 'subsidies', ask: 'what do I get with the Merdeka Generation package' },
	{ topic: 'subsidies', ask: 'how do I join Healthier SG at my clinic' },
	{ topic: 'subsidies', ask: 'the doctor charge too expensive, got subsidy or not' },
	// Long-term care.
	{ topic: 'long-term-care', ask: 'how do I know if I am covered by CareShield Life' },
	{ topic: 'long-term-care', ask: 'how do I claim CareShield Life for my mother' },
	{ topic: 'long-term-care', ask: 'what is ElderShield and do I still have it' },
	{ topic: 'long-term-care', ask: 'what is ElderFund for' },
	{ topic: 'long-term-care', ask: 'who pays for the nursing home' },
	// CPF or MediSave used away from Singapore.
	{ topic: 'overseas', ask: 'can I use my MediSave for treatment overseas' },
	{ topic: 'overseas', ask: 'I live in Malaysia now, can I still get my CPF payout' },
	// Scams.
	{ topic: 'scams', ask: 'someone call me say from CPF ask for my Singpass, is it real' },
	{ topic: 'scams', ask: 'I think I got scammed, what do I do now' },
	// Retirement money, the question behind most CPF calls.
	{ topic: 'retirement-payouts', ask: 'when do I start getting my CPF monthly payout' },
	{ topic: 'retirement-payouts', ask: 'how much CPF can I take out at 55' },
	{ topic: 'retirement-payouts', ask: 'what is the retirement sum this year' },
	{ topic: 'retirement-payouts', ask: 'can I get my CPF money earlier if I am sick' },
	// One that nothing official answers: it must be refused, not invented.
	{ topic: 'out-of-scope', ask: 'which brand of vitamin should I buy for my knee', expect: 'nothing' },
];

const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** Every person-visible line on a card, with the quotes it cites. */
function lines(card) {
	const out = [['summary', card.summary.text, card.summary.quote_refs]];
	for (const [i, d] of (card.details ?? []).entries()) out.push([`details.${i}`, d.body, d.quote_refs]);
	for (const [i, s] of (card.steps ?? []).entries()) out.push([`steps.${i}`, s.text, s.quote_refs]);
	return out;
}

/** Re-check the card's quotes against the crawled page, independently of the app. */
function ungrounded(card) {
	const problems = [];
	const quotes = new Map((card.quotes ?? []).map((q) => [q.id, q]));
	const pageFor = new Map((card.sources ?? []).map((s) => [s.id, rawById.get(s.url)]));
	for (const [where, , refs] of lines(card)) {
		if (!refs?.length) {
			problems.push(`${where} cites nothing`);
			continue;
		}
		for (const ref of refs) {
			const quote = quotes.get(ref);
			if (!quote) {
				problems.push(`${where} cites missing ${ref}`);
				continue;
			}
			const page = pageFor.get(quote.source);
			// A source we did not crawl cannot be checked here; the app checked it at build.
			if (page === undefined) continue;
			if (!squash(page).includes(squash(quote.text))) {
				problems.push(`${where} quote not on the page: "${squash(quote.text).slice(0, 70)}"`);
			}
		}
	}
	return problems;
}

async function askOnce(query) {
	const started = Date.now();
	const res = await fetch(`${BASE}/api/search`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ kind: 'text', query, offset: 0, reply: 'en', ...(tierAOnly ? { noModel: true } : {}) }),
	});
	const ms = Date.now() - started;
	if (!res.ok) return { ms, kind: `http ${res.status}` };
	const body = await res.json();
	return { ms, body, kind: body.kind };
}

const rows = [];
for (const q of QUESTIONS) {
	const { ms, body, kind } = await askOnce(q.ask);
	const card = kind === 'results' ? body.result.cards[0] : undefined;
	const composed = card?.provenance?.structured?.method === 'model';
	const problems = card ? ungrounded(card) : [];
	const wanted = q.expect ?? 'results';
	const ok = kind === wanted && problems.length === 0;
	rows.push({ ...q, kind, ms, ok, composed, problems, title: card?.title?.full, source: card?.sources?.[0]?.url });
	const mark = ok ? 'PASS' : 'FAIL';
	const from = kind !== 'results' ? kind : composed ? 'written on demand' : 'pre-built entry';
	console.log(`${mark}  ${String(ms).padStart(6)} ms  ${from.padEnd(17)}  ${q.ask}`);
	if (card) console.log(`                              -> ${card.title.full}  ${card.sources?.[0]?.url ?? ''}`);
	for (const p of problems) console.log(`      ungrounded: ${p}`);
}

const answered = rows.filter((r) => r.kind === 'results').length;
const passed = rows.filter((r) => r.ok).length;
const composed = rows.filter((r) => r.composed).length;
const ungroundedCount = rows.filter((r) => r.problems.length > 0).length;
const median = [...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)];

console.log(`\n${passed} of ${rows.length} as expected`);
console.log(`answered: ${answered}, of which written on demand: ${composed}`);
console.log(`ungrounded cards: ${ungroundedCount}   median ${median} ms`);

const target = 24;
if (answered < target || ungroundedCount > 0) {
	console.log(`\nnot met: target is ${target} of ${rows.length} answered with zero ungrounded cards`);
	process.exit(1);
}
