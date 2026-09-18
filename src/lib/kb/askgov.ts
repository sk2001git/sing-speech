/**
 * Reading ask.gov.sg.
 *
 * The agencies publish 1,045 (MOH) and 2,766 (CPF) question pages, each with an answer,
 * topic labels, dates and a count of readers who found it useful (vault obs-0039).
 * robots.txt allows every one of them; only `/api/` and `/*​/questions/new` are closed, and
 * there is no public search endpoint, so the corpus has to be crawled and held.
 *
 * The pages are a Next.js RSC stream. Nothing is in the HTML body: the state arrives as
 * JSON packed inside JS string literals in `self.__next_f.push([1,"..."])`. Two things go
 * wrong if that is read carelessly, and both are covered by tests:
 *
 *  - unescaping with a latin-1 rule corrupts every `\uXXXX` character, and the answers are
 *    full of them (≥, ·, curly quotes);
 *  - every page — agency, topic, question — embeds the agency's top-questions widget, so
 *    the same question appears two or three times, sometimes abbreviated.
 */

export interface RawQuestion {
	/** ask.gov.sg's own id, stable across crawls, and the last part of the page url. */
	id: string;
	title: string;
	/** The answer as lines of plain text. What quotes are taken from. */
	text: string;
	/** The answer as published, kept so a better reader can be written later. */
	html: string;
	/** "Covid-19 / I am unwell", parent first. */
	topics: string[];
	/** Readers who marked the answer useful. The only published popularity signal. */
	useful: number;
	updatedAt: string | null;
}

/** One crawled question, with where it came from. Written to `data/kb/raw/`. */
export interface CrawledQuestion extends RawQuestion {
	agency: string;
	url: string;
	retrievedAt: string;
}

const CHUNK = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;

/** Every flight chunk on the page, unescaped and joined. */
export function readPayload(html: string): string {
	let out = '';
	for (const m of html.matchAll(CHUNK)) {
		try {
			out += JSON.parse(`"${m[1]}"`) as string;
		} catch {
			// A chunk that is not a valid JS string literal is not state we can use.
		}
	}
	return out;
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	middot: '·',
	bull: '•',
	ndash: '–',
	mdash: '—',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“',
	hellip: '…',
	deg: '°',
	ge: '≥',
	le: '≤',
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
		if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16));
		if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
		return ENTITIES[name.toLowerCase()] ?? whole;
	});
}

/** Anything that ends a line when it ends an element. */
const BLOCK = /<\/?(p|div|li|ul|ol|br|h[1-6]|tr|table|blockquote)\b[^>]*>/gi;

/**
 * The published answer as plain text, one line per paragraph or list item.
 *
 * Lines matter: a quote has to be findable verbatim in this text, and a step usually is one
 * line of the original. Running paragraphs together would produce quotes that exist in our
 * store and nowhere on the page.
 */
export function answerText(html: string): string {
	const withBreaks = html.replace(BLOCK, '\n');
	const stripped = withBreaks.replace(/<[^>]*>/g, '');
	return decodeEntities(stripped)
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
}

/**
 * Pull every JSON object out of the payload that starts with an id and a title.
 *
 * A regex cannot do this — answer bodies contain braces and escaped quotes — so the object
 * is walked to its matching brace, tracking string state.
 */
function objectsWithId(payload: string): string[] {
	const out: string[] = [];
	// Matched on the id alone: the widget copies are serialised {"id","title",...} but the
	// page's own question arrives as {"id","body","title",...} inside a react-query cache
	// entry, and insisting on a key order drops exactly the answer the page is about.
	for (const m of payload.matchAll(/\{"id":"[A-Za-z0-9_-]{10,}"[,}]/g)) {
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let i = m.index; i < payload.length; i += 1) {
			const c = payload[i]!;
			if (inString) {
				if (escaped) escaped = false;
				else if (c === '\\') escaped = true;
				else if (c === '"') inString = false;
				continue;
			}
			if (c === '"') inString = true;
			else if (c === '{') depth += 1;
			else if (c === '}') {
				depth -= 1;
				if (depth === 0) {
					out.push(payload.slice(m.index, i + 1));
					break;
				}
			}
		}
	}
	return out;
}

/**
 * Rows that hold a long string on their own.
 *
 * React Server Components stream a long value as its own row — `64:T685,<p>…` where 685 is
 * the byte length — and leave `"$64"` where the value belongs. A quarter of the crawl came
 * back as `"$64"` before this was handled, including the CHAS application page, which is
 * the single most asked-for answer in the corpus.
 */
function textRows(payload: string): Map<string, string> {
	const rows = new Map<string, string>();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	for (const m of payload.matchAll(/(?:^|\n)([0-9a-f]+):T([0-9a-f]+),/g)) {
		const start = m.index + m[0].length;
		const bytes = encoder.encode(payload.slice(start));
		rows.set(m[1]!, decoder.decode(bytes.slice(0, parseInt(m[2]!, 16))));
	}

	// The shorter form: the row is simply a JSON string.
	for (const m of payload.matchAll(/(?:^|\n)([0-9a-f]+):("(?:[^"\\]|\\.)*")/g)) {
		if (rows.has(m[1]!)) continue;
		try {
			rows.set(m[1]!, JSON.parse(m[2]!) as string);
		} catch {
			// Not a string row, so not a value we can use.
		}
	}
	return rows;
}

/** `$64` means "the value is in row 64". */
const REFERENCE = /^\$([0-9a-f]+)$/;

/**
 * Flight marks a Date as `$D2024-10-28T04:32:57.990Z`. Left in place the prefix reaches the
 * entry schema as `$D2024-10-` and every entry built from that page is rejected as an
 * invalid date — which is how 46 of 141 entries failed their first build.
 */
export const readDate = (value: string | null | undefined): string | null =>
	value ? value.replace(/^\$D/, '') : null;

interface Embedded {
	id: string;
	title?: string;
	updatedAt?: string | null;
	answer?: { body?: string; numPositiveFeedback?: number | null } | null;
	topics?: { title?: string; parentTopic?: { title?: string } | null }[] | null;
}

const topicLine = (t: NonNullable<Embedded['topics']>[number]) =>
	[t.parentTopic?.title, t.title].filter(Boolean).join(' / ');

/**
 * Every question the page carries, once each, in the order they first appear.
 *
 * Where a question appears more than once the longest copy wins: the top-questions widget
 * carries an abbreviated version with no topics, and taking that would throw away the
 * labels the whole priority ranking depends on.
 */
export function parseQuestions(html: string): RawQuestion[] {
	const payload = readPayload(html);
	const rows = textRows(payload);
	const best = new Map<string, { raw: string; question: RawQuestion }>();
	for (const raw of objectsWithId(payload)) {
		let obj: Embedded;
		try {
			obj = JSON.parse(raw) as Embedded;
		} catch {
			continue;
		}
		const referenced = REFERENCE.exec(obj.answer?.body ?? '');
		// A reference whose row is not on the page leaves nothing to quote, so the question is
		// left out rather than stored with a placeholder for an answer.
		const body = referenced ? rows.get(referenced[1]!) : obj.answer?.body;
		if (!obj.title || !body) continue;
		const question: RawQuestion = {
			id: obj.id,
			title: decodeEntities(obj.title).replace(/\s+/g, ' ').trim(),
			text: answerText(body),
			html: body,
			topics: (obj.topics ?? []).map(topicLine).filter(Boolean),
			useful: obj.answer?.numPositiveFeedback ?? 0,
			updatedAt: readDate(obj.updatedAt),
		};
		const held = best.get(obj.id);
		if (!held || raw.length > held.raw.length) best.set(obj.id, { raw, question });
	}
	return [...best.values()].map((v) => v.question);
}

/** Question pages from an agency sitemap, each once, leaving the topic listings out. */
export function questionUrls(sitemapXml: string): string[] {
	const seen = new Set<string>();
	for (const m of sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
		const url = decodeEntities(m[1]!.trim());
		if (url.includes('/questions/') && !url.endsWith('/questions/new')) seen.add(url);
	}
	return [...seen];
}

/** `https://ask.gov.sg/moh/questions/abc` -> `moh`. */
export function agencyOf(url: string): string {
	return new URL(url).pathname.split('/').filter(Boolean)[0] ?? '';
}
