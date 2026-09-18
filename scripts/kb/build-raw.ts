/**
 * Turn the crawl in data/kb/raw/ into the Tier B index the Worker carries, and print what
 * the corpus is actually about.
 *
 *   npx tsx scripts/kb/build-raw.ts
 *   npx tsx scripts/kb/build-raw.ts --report      # the trend analysis only, no write
 *
 * Writes:
 *   data/kb/raw-index.json   every usable question: id, agency, url, title, text, topics,
 *                            usefulness, last modified. 3,811 answers is ~1.6 MB, which
 *                            the Worker can carry; vectors for them could not.
 *   data/kb/priority.json    the questions in the topics our audience asks about, ranked,
 *                            for `build-entries.ts` to structure up front.
 *
 * The report is the answer to the owner's question of 2026-09-18 — "there must be some list
 * or trend we can analyze" — and it is read off the agencies' own labels and their own
 * usefulness counts, not guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CrawledQuestion } from '../../src/lib/kb/askgov';
import type { RawDoc } from '../../src/lib/kb/raw-store';

const ROOT = path.resolve(import.meta.dirname, '../..');
const RAW = path.join(ROOT, 'data/kb/raw');
const INDEX = path.join(ROOT, 'data/kb/raw-index.json');
const PRIORITY = path.join(ROOT, 'data/kb/priority.json');
const reportOnly = process.argv.includes('--report');

/**
 * What an older person, or whoever helps them, actually asks about: their money and their
 * health. Matched against the agency's own topic labels and question titles.
 *
 * Order is the order we structure them in. The first five are the topics the owner named on
 * 2026-09-18; scams is PRD v2 feature 3.
 */
const PRIORITY_TOPICS: { key: string; label: string; match: RegExp; and?: RegExp }[] = [
	{ key: 'medishield', label: 'MediShield Life', match: /medishield|integrated shield|premium|claim limit/i },
	{ key: 'medisave-medical', label: 'MediSave and medical bills', match: /medisave|medical bill|hospital bill|healthcare financing|withdrawal limit/i },
	{ key: 'subsidies', label: 'Healthcare subsidies', match: /chas|subsid|healthier sg|pioneer generation|merdeka generation|means test/i },
	{ key: 'long-term-care', label: 'CareShield, ElderShield, ElderFund', match: /careshield|eldershield|elderfund|long-term care|disability/i },
	{
		key: 'overseas',
		label: 'Using CPF or MediSave overseas',
		match: /overseas|abroad|outside singapore|foreign hospital/i,
		// Both halves, or the bucket fills with doctor-registration and employer-posting
		// questions that merely contain the word "overseas".
		and: /medisave|medishield|cpf savings|treatment|hospital|medical|healthcare|premium/i,
	},
	{ key: 'scams', label: 'Scams', match: /scam|phishing|impersonat|fraud/i },
	{ key: 'retirement-payouts', label: 'Retirement payouts', match: /retirement sum|payout|cpf life|withdraw.*55|monthly payout/i },
];

const files = fs.readdirSync(RAW).filter((f) => f.endsWith('.json'));
const all: CrawledQuestion[] = files.map((f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')) as CrawledQuestion);

/**
 * An answer of a few words is a link or a picture with the text stripped out — nothing can
 * be quoted from it, so it cannot become a card and is left out of the index.
 */
const usable = all.filter((q) => q.text.replace(/\s+/g, ' ').trim().length >= 40);
const dropped = all.length - usable.length;

const docs: RawDoc[] = usable
	.map((q) => ({
		id: q.id,
		agency: q.agency,
		url: q.url,
		title: q.title,
		text: q.text,
		topics: q.topics,
		useful: q.useful,
		updatedAt: q.updatedAt,
	}))
	.sort((a, b) => a.id.localeCompare(b.id));

const subject = (q: RawDoc) => `${q.title} ${q.topics.join(' ')}`;
const bucket = (q: RawDoc) => {
	const text = subject(q);
	return PRIORITY_TOPICS.find((t) => t.match.test(text) && (!t.and || t.and.test(text)))?.key;
};

const byAgency = new Map<string, number>();
for (const q of docs) byAgency.set(q.agency, (byAgency.get(q.agency) ?? 0) + 1);

console.log(`crawled ${all.length} question(s); ${docs.length} usable, ${dropped} with too little text to quote`);
console.log(`by agency: ${[...byAgency].map(([a, n]) => `${a} ${n}`).join(', ')}`);

const topicCounts = new Map<string, number>();
for (const q of docs) for (const t of q.topics.length ? q.topics : ['(no topic)']) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
console.log('\nthe agencies’ twelve largest topics, by questions published:');
for (const [topic, n] of [...topicCounts].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${topic}`);

console.log('\nthe fifteen answers most readers marked useful:');
for (const q of [...docs].sort((a, b) => b.useful - a.useful).slice(0, 15)) {
	console.log(`  ${String(q.useful).padStart(4)}  ${q.agency}  ${q.title.slice(0, 84)}`);
}

console.log('\nwhat our audience asks about, by the agencies’ own labels:');
const priority: RawDoc[] = [];
for (const topic of PRIORITY_TOPICS) {
	const mine = docs.filter((q) => bucket(q) === topic.key).sort((a, b) => b.useful - a.useful || a.title.localeCompare(b.title));
	priority.push(...mine);
	const useful = mine.reduce((sum, q) => sum + q.useful, 0);
	console.log(`  ${String(mine.length).padStart(4)} questions, ${String(useful).padStart(5)} useful marks  ${topic.label}`);
	for (const q of mine.slice(0, 3)) console.log(`         ${q.agency}  ${q.title.slice(0, 80)}`);
}
console.log(`  ${String(docs.length - priority.length).padStart(4)} questions outside those topics, held for the on-demand path`);

if (reportOnly) process.exit(0);

const built = new Date().toISOString();
fs.writeFileSync(INDEX, `${JSON.stringify({ built, source: 'https://ask.gov.sg', count: docs.length, questions: docs })}\n`);
fs.writeFileSync(
	PRIORITY,
	`${JSON.stringify(
		{
			built,
			topics: PRIORITY_TOPICS.map((t) => ({ key: t.key, label: t.label })),
			questions: priority.map((q) => ({ ...q, priority: bucket(q) })),
		},
		null,
		'\t',
	)}\n`,
);

const mb = (file: string) => (fs.statSync(file).size / 1e6).toFixed(2);
console.log(`\nwrote ${INDEX} (${mb(INDEX)} MB) and ${PRIORITY} (${mb(PRIORITY)} MB)`);
