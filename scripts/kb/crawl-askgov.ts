/**
 * Crawl the published questions of one or more ask.gov.sg agencies into data/kb/raw/.
 *
 *   npx tsx scripts/kb/crawl-askgov.ts moh cpf
 *   npx tsx scripts/kb/crawl-askgov.ts moh --limit 20        # a taste, for development
 *   npx tsx scripts/kb/crawl-askgov.ts moh --refresh         # re-fetch pages already held
 *
 * An honest crawler (vault dec-suara-0009): it names itself, it reads robots.txt and obeys
 * it, it waits between requests, and it never fetches a page it already holds unless asked
 * to. robots.txt allows everything except `/api/` and `/*​/questions/new`.
 *
 * One file per question, named by ask.gov.sg's own id, so a second run is resumable and a
 * third run only fetches what is new. Each page also carries its agency's top-questions
 * widget, so one fetch usually yields several questions; the extras are written too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { agencyOf, parseQuestions, questionUrls, type CrawledQuestion } from '../../src/lib/kb/askgov';

const ROOT = path.resolve(import.meta.dirname, '../..');
const RAW = path.join(ROOT, 'data/kb/raw');
const UA = 'SuaraBot/0.1 (knowledge base of official answers for older Singaporeans)';
const SITE = 'https://ask.gov.sg';
/** Two a second. The site is a small public service, not a CDN to hammer. */
const GAP_MS = 500;

const args = process.argv.slice(2);
/** Flags that take a value, so the word after them is not an agency name. */
const VALUED = ['limit'];
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const agencies = args.filter((a, i) => !a.startsWith('--') && !VALUED.some((v) => args[i - 1] === `--${v}`));
const limit = Number(value('limit') ?? Infinity);
const refresh = flag('refresh');

if (agencies.length === 0) {
	console.error('name at least one agency, as in: npx tsx scripts/kb/crawl-askgov.ts moh cpf');
	process.exit(2);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml' } });
		if (res.ok) return await res.text();
		// A 429 or a 5xx is the site asking for room; anything else will not improve by asking again.
		if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${res.statusText} for ${url}`);
		const back = GAP_MS * 10 * attempt;
		console.warn(`  ${res.status} on ${url}, waiting ${back} ms`);
		await wait(back);
	}
	throw new Error(`gave up on ${url}`);
}

/** The rules we are actually bound by, read rather than assumed. */
async function disallowed(): Promise<string[]> {
	const txt = await get(`${SITE}/robots.txt`);
	const rules: string[] = [];
	let applies = false;
	for (const line of txt.split(/\r?\n/)) {
		const parts = line.split(':', 2).map((s) => s.trim());
		const key = parts[0] ?? '';
		const rest = parts[1] ?? '';
		if (/^user-agent$/i.test(key)) applies = rest === '*' || UA.startsWith(rest);
		else if (applies && /^disallow$/i.test(key) && rest) rules.push(rest);
	}
	return rules;
}

const blocked = (rules: string[], url: string) => {
	const p = new URL(url).pathname;
	return rules.some((rule) => {
		const re = new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}`);
		return re.test(p);
	});
};

fs.mkdirSync(RAW, { recursive: true });
const held = new Set(fs.readdirSync(RAW).filter((f) => f.endsWith('.json')));
const rules = await disallowed();
console.log(`robots.txt disallows: ${rules.join(' ') || 'nothing'}`);
console.log(`${held.size} question(s) already held in data/kb/raw`);

let fetched = 0;
let written = 0;
let skipped = 0;

for (const agency of agencies) {
	const sitemap = await get(`${SITE}/${agency}/sitemap.xml`);
	const urls = questionUrls(sitemap);
	console.log(`\n${agency}: ${urls.length} question pages published`);

	for (const url of urls) {
		if (fetched >= limit) break;
		const id = url.split('/').pop()!;
		if (blocked(rules, url)) {
			console.warn(`  robots.txt disallows ${url}`);
			continue;
		}
		if (!refresh && held.has(`${id}.json`)) {
			skipped += 1;
			continue;
		}
		await wait(GAP_MS);
		let html: string;
		try {
			html = await get(url);
		} catch (err) {
			console.warn(`  ${(err as Error).message}`);
			continue;
		}
		fetched += 1;
		const retrievedAt = new Date().toISOString();
		const questions = parseQuestions(html);
		for (const q of questions) {
			const file = path.join(RAW, `${q.id}.json`);
			// The page's own question is authoritative for itself; the widget copies of other
			// questions are written only where we do not already hold them.
			if (q.id !== id && fs.existsSync(file)) continue;
			const pageUrl = q.id === id ? url : `${SITE}/${agency}/questions/${q.id}`;
			const record: CrawledQuestion = { ...q, agency: agencyOf(pageUrl) || agency, url: pageUrl, retrievedAt };
			fs.writeFileSync(file, `${JSON.stringify(record, null, '\t')}\n`);
			held.add(`${q.id}.json`);
			written += 1;
		}
		if (fetched % 25 === 0) console.log(`  ${fetched} fetched, ${written} written, ${skipped} already held`);
	}
}

console.log(`\nfetched ${fetched} page(s), wrote ${written} question(s), skipped ${skipped} already held`);
console.log(`data/kb/raw now holds ${fs.readdirSync(RAW).filter((f) => f.endsWith('.json')).length} question(s)`);
