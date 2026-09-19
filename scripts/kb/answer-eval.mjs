/**
 * Does Suara answer the questions older people actually ask about money and health?
 *
 *   node scripts/kb/answer-eval.mjs                      # against http://localhost:4321
 *   node scripts/kb/answer-eval.mjs --base http://...     # against a deployment
 *   node scripts/kb/answer-eval.mjs --verbose             # print every card in full
 *
 * Thirty questions in the words a person would use, across the topics the crawl says the
 * agencies publish most and our audience asks most (vault plan-suara-0008). Each one is
 * judged on three things:
 *
 *   1. Did an answer come back at all, or was the person turned away?
 *   2. Is every line on the card still found verbatim in the page it cites? The grounding
 *      check is repeated here rather than trusted from the app, because this is the
 *      measurement that decides whether a model-written card is safe to show.
 *   3. Is the card about what was asked? `must` lists words the answer cannot omit and
 *      still be an answer. Without this a card can be perfectly grounded and about
 *      something else, which is the failure the thin corpus used to produce.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const at = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};
const BASE = at('base', 'http://localhost:4321');
const verbose = args.includes('--verbose');
const ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Entries already in the served index. Every entry is model-structured, so provenance
 * cannot tell a pre-built card from one written while the person waited — only this can.
 */
const prebuilt = new Set(
	(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kb/index.json'), 'utf8')).entries ?? []).map((e) => e.id),
);

/** The crawl, to check quotes against the page they claim to come from. */
const pageByUrl = new Map(
	// Question plus answer: a page's published question is part of the page and may be quoted.
	(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/kb/raw-index.json'), 'utf8')).questions ?? []).map((q) => [
		q.url,
		`${q.title}\n${q.text}`,
	]),
);

const QUESTIONS = [
	// MediShield Life — the largest topic MOH publishes.
	{ ask: 'what is MediShield Life for', must: ['medishield'] },
	{ ask: 'how much is my MediShield premium when I am 70', must: ['premium'] },
	{ ask: 'can I use MediShield if I already have company insurance', must: ['medishield', 'employer|company|insurance'] },
	{ ask: 'I cannot afford my MediShield premium, what can I do', must: ['premium', 'help|assistance|subsid|support'] },
	{ ask: 'what is the difference between MediShield Life and CareShield Life', must: ['medishield', 'careshield'] },
	// MediSave against a medical bill.
	{ ask: 'can I use my MediSave to pay my father hospital bill', must: ['medisave', 'parent|father|family|dependant'] },
	{ ask: 'not enough money in my MediSave for the hospital bill, how', must: ['medisave', 'bill|pay|cash|assistance'] },
	{ ask: 'how much MediSave can I use for one day in hospital', must: ['medisave', 'hospital|day|limit'] },
	{ ask: 'can MediSave pay for my outpatient medicine', must: ['medisave', 'outpatient|medication|medicine|chronic'] },
	{ ask: 'can I use MediSave to pay my wife medical bill', must: ['medisave', 'spouse|wife|family|dependant'] },
	// Healthcare subsidies.
	{ ask: 'how do I apply for the CHAS card', must: ['chas', 'apply|application'] },
	{ ask: 'am I eligible for CHAS subsidy', must: ['chas'] },
	{ ask: 'I lost my Pioneer Generation card how to get a new one', must: ['pioneer', 'replace|call|1800'] },
	{ ask: 'what do I get with the Merdeka Generation package', must: ['merdeka'] },
	{ ask: 'how do I join Healthier SG at my clinic', must: ['healthier sg'] },
	{ ask: 'the doctor charge too expensive, got subsidy or not', must: ['subsid'] },
	// Long-term care.
	{ ask: 'how do I know if I am covered by CareShield Life', must: ['careshield'] },
	{ ask: 'how do I claim CareShield Life for my mother', must: ['careshield', 'claim|apply|assessment'] },
	{ ask: 'what is ElderShield and do I still have it', must: ['eldershield'] },
	{ ask: 'what is ElderFund for', must: ['elderfund'] },
	{ ask: 'who pays for the nursing home', must: ['nursing home|long-term care|residential'] },
	// CPF or MediSave used away from Singapore.
	{ ask: 'can I use my MediSave for treatment overseas', must: ['medisave', 'overseas|outside singapore|abroad'] },
	{ ask: 'I live in Malaysia now, can I still get my CPF payout', must: ['payout|withdraw', 'overseas|malaysia|outside singapore|abroad'] },
	// Scams.
	{ ask: 'someone call me say from CPF ask for my Singpass, is it real', must: ['cpf|singpass', 'scam|never ask|do not share|verify|official'] },
	{ ask: 'I think I got scammed, what do I do now', must: ['scam|police|report'] },
	// Retirement money, the question behind most CPF calls.
	{ ask: 'when do I start getting my CPF monthly payout', must: ['payout', '65|70|age'] },
	{ ask: 'how much CPF can I take out at 55', must: ['55', 'withdraw|take out|lump sum'] },
	{ ask: 'what is the retirement sum this year', must: ['retirement sum'] },
	{ ask: 'can I get my CPF money earlier if I am sick', must: ['withdraw|early', 'medical|illness|ill health|terminal'] },
	// One that nothing official answers: it must be refused, not invented.
	{ ask: 'which brand of vitamin should I buy for my knee', expect: 'nothing' },
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
	const pageFor = new Map((card.sources ?? []).map((s) => [s.id, pageByUrl.get(s.url)]));
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

/** Everything the person can read on the card, for judging what it is about. */
const cardText = (card) =>
	[card.title.full, card.summary.text, ...lines(card).map(([, text]) => text)].join(' ').toLowerCase();

const missing = (card, must = []) => must.filter((group) => !group.split('|').some((word) => cardText(card).includes(word)));

async function askOnce(query) {
	const started = Date.now();
	const res = await fetch(`${BASE}/api/search`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ kind: 'text', query, offset: 0, reply: 'en' }),
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
	const composed = Boolean(card) && !prebuilt.has(card.id);
	const problems = card ? ungrounded(card) : [];
	const absent = card ? missing(card, q.must) : [];
	const wanted = q.expect ?? 'results';
	const ok = kind === wanted && problems.length === 0 && absent.length === 0;
	rows.push({ ...q, kind, ms, ok, composed, problems, absent, title: card?.title?.full });

	const from = kind !== 'results' ? kind : composed ? 'written on demand' : 'pre-built entry';
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(ms).padStart(6)} ms  ${from.padEnd(17)}  ${q.ask}`);
	if (card) console.log(`                              -> ${card.title.full}  ${card.sources?.[0]?.url ?? ''}`);
	if (verbose && card) {
		console.log(`         summary: ${card.summary.text}`);
		for (const s of card.steps ?? []) console.log(`         ${s.position}. ${s.name}: ${s.text}  [${s.confirm_label}]`);
		for (const d of card.details ?? []) console.log(`         ${d.heading}: ${d.body}`);
	}
	for (const p of problems) console.log(`      ungrounded: ${p}`);
	for (const a of absent) console.log(`      not about the question: no "${a}" anywhere on the card`);
}

const answered = rows.filter((r) => r.kind === 'results').length;
const passed = rows.filter((r) => r.ok).length;
const composed = rows.filter((r) => r.composed).length;
const ungroundedCount = rows.filter((r) => r.problems.length > 0).length;
const offTopic = rows.filter((r) => r.absent.length > 0).length;
const median = [...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)];

console.log(`\n${passed} of ${rows.length} answered the question that was asked`);
console.log(`answered at all: ${answered}, of which written on demand: ${composed}`);
console.log(`ungrounded cards: ${ungroundedCount}   off the question: ${offTopic}   median ${median} ms`);

const target = 24;
if (passed < target || ungroundedCount > 0) {
	console.log(`\nnot met: target is ${target} of ${rows.length} answering the question, with zero ungrounded cards`);
	process.exit(1);
}
