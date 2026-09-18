/**
 * Tier B: the whole crawled corpus, searched by words.
 *
 * Tier A is the structured entries with their embeddings — instant, quoted, six cards. It
 * will never cover everything: MOH and CPF publish 3,811 answers and our audience asks
 * about maybe a few hundred of them, in wording nobody can predict. So the crawl is held
 * whole (`data/kb/raw/`) and searched here when Tier A has nothing near enough.
 *
 * Why words and not vectors: a miss already costs a model call to write the card, and
 * embedding 3,811 answers would put a 3 MB vector asset in front of every reader for a
 * path most readers never take. BM25 over question titles is strong exactly where this is
 * used — the titles are questions, and the person is asking a question. If the eval shows
 * it missing, embeddings go behind the same interface.
 */
export interface RawDoc {
	id: string;
	agency: string;
	url: string;
	title: string;
	text: string;
	topics: string[];
	useful: number;
	updatedAt: string | null;
}

export interface RawHit {
	doc: RawDoc;
	score: number;
}

/**
 * Words that appear in almost every question asked of a government service, and so tell us
 * nothing about which answer is wanted.
 */
const STOP = new Set([
	'a', 'about', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could', 'did', 'do',
	'does', 'for', 'from', 'get', 'got', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my',
	'need', 'not', 'of', 'on', 'or', 'our', 'should', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'they',
	'this', 'to', 'up', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you',
	'your',
]);

/**
 * `nominations` and `nomination` are the same word to a person asking.
 *
 * Nothing of four letters or fewer is touched. Singapore's public services are named in
 * acronyms — CHAS, SOCs, AIC, LOG — and stemming CHAS to "cha" sent "how do I apply for the
 * CHAS card" to the lost-card replacement pages, because the one word the question turned
 * on had been filed away.
 */
const stem = (word: string) => {
	if (word.length > 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
	if (word.length > 5 && (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('hes'))) return word.slice(0, -2);
	if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
	return word;
};

export function tokenise(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[‘’ʼ]/g, "'")
		.split(/[^a-z0-9']+/)
		.map((w) => w.replace(/^'+|'+$/g, ''))
		.filter((w) => w.length > 1 && !STOP.has(w))
		.map(stem);
}

/**
 * What a person says, and what the agency wrote.
 *
 * Query side only: the document keeps the agency's own words, so a quote stays a quote.
 * Each group is treated as one requirement — a page matching any member counts as matching
 * the word that was said.
 */
const SAID_MEANS: string[][] = [
	['take', 'takeout', 'withdraw', 'withdrawal'],
	['out', 'withdraw', 'withdrawal'],
	['money', 'saving', 'fund', 'payout'],
	['pay', 'payment', 'paying'],
	['bill', 'charge', 'fee', 'cost', 'expense'],
	['expensive', 'cost', 'charge', 'fee', 'subsidy', 'subsidies'],
	['doctor', 'gp', 'practitioner', 'clinic', 'physician'],
	['old', 'senior', 'elderly', 'age'],
	['home', 'nursing', 'residential'],
	['sick', 'ill', 'illness', 'medical', 'condition'],
	['help', 'assistance', 'support', 'subsidy'],
	['card', 'chas', 'membership'],
	['scam', 'phishing', 'fraud', 'impersonation'],
	['claim', 'application', 'apply'],
	['cover', 'coverage', 'covered', 'insurance'],
	// People say where they are, not the category the agency files it under.
	['malaysia', 'overseas', 'abroad'],
	['johor', 'overseas', 'abroad'],
	['australia', 'overseas', 'abroad'],
	['oversea', 'overseas', 'abroad'],
];

/** The words a term may be met by, itself first. */
function meanings(term: string): string[] {
	const group = SAID_MEANS.find((g) => g.includes(term));
	return group ? [term, ...group.filter((w) => w !== term)] : [term];
}

/**
 * A document is the question, its topic labels and its answer. The question is worth more
 * than the answer — someone asking "medisave for my father" wants the page titled that,
 * not a page whose answer mentions MediSave in passing — so the title counts three times
 * and the topics twice.
 */
const TITLE_WEIGHT = 3;
const TOPIC_WEIGHT = 2;

function termsOf(doc: RawDoc): Map<string, number> {
	const counts = new Map<string, number>();
	const add = (text: string, weight: number) => {
		for (const term of tokenise(text)) counts.set(term, (counts.get(term) ?? 0) + weight);
	};
	add(doc.title, TITLE_WEIGHT);
	for (const topic of doc.topics) add(topic, TOPIC_WEIGHT);
	add(doc.text, 1);
	return counts;
}

interface Indexed {
	doc: RawDoc;
	terms: Map<string, number>;
	length: number;
}

export interface RawIndex {
	docs: Indexed[];
	/** How many documents each term appears in. */
	df: Map<string, number>;
	averageLength: number;
}

export function buildRawIndex(docs: readonly RawDoc[]): RawIndex {
	const indexed: Indexed[] = [];
	const df = new Map<string, number>();
	for (const doc of docs) {
		const terms = termsOf(doc);
		let length = 0;
		for (const [term, count] of terms) {
			length += count;
			df.set(term, (df.get(term) ?? 0) + 1);
		}
		indexed.push({ doc, terms, length });
	}
	const total = indexed.reduce((sum, d) => sum + d.length, 0);
	return { docs: indexed, df, averageLength: indexed.length ? total / indexed.length : 0 };
}

const K1 = 1.2;
const B = 0.75;

/**
 * How much of the question a page has to account for before it is offered as an answer.
 *
 * Measured need: "which brand of vitamin should I buy for my knee" retrieved a page about
 * whether a TCM clinic may advertise acupuncture for knee pain — one word in common out of
 * four. BM25 alone is happy with that, and a model handed that page writes a confident card
 * about nothing.
 *
 * Counted by rarity, not by word. A spoken question reaches this as the hearing model's
 * whole sentence — "You want to know whether you can use MediSave to pay your father's
 * hospital bill" — where the common words outnumber the ones that carry the question, and
 * an unweighted count sank the right page below the floor.
 */
const MIN_COVERAGE = 0.4;

/**
 * Okapi BM25, with usefulness as the tiebreak only.
 *
 * The popularity nudge is deliberately tiny: `numPositiveFeedback` is how many readers
 * marked an answer useful, which says how popular a page is, not whether it answers *this*
 * question. Left any larger it would drag every request towards the front-page questions —
 * the exact failure that produced the thin seed corpus (vault obs-0039).
 */
export function searchRaw(index: RawIndex, query: string, limit = 6, minCoverage = MIN_COVERAGE): RawHit[] {
	const terms = tokenise(query);
	if (terms.length === 0 || index.docs.length === 0) return [];
	const n = index.docs.length;
	const idf = (term: string) => {
		const df = index.df.get(term) ?? 1;
		return Math.log(1 + (n - df + 0.5) / (df + 0.5));
	};

	// One requirement per distinct word said, each carrying the words it may be met by.
	const groups = [...new Set(terms)].map((term) => {
		const words = meanings(term);
		return { words, weight: idf(term) };
	});
	const wantedWeight = groups.reduce((sum, g) => sum + g.weight, 0);

	const hits: RawHit[] = [];
	for (const { doc, terms: docTerms, length } of index.docs) {
		let score = 0;
		let matchedWeight = 0;
		for (const group of groups) {
			let best = 0;
			for (const word of group.words) {
				const tf = docTerms.get(word);
				if (!tf) continue;
				const norm = tf + K1 * (1 - B + (B * length) / (index.averageLength || 1));
				// The word said is worth its own rarity; a stand-in is worth a little less, so a
				// page using the person's own words still wins.
				const weight = word === group.words[0] ? idf(word) : idf(word) * 0.7;
				best = Math.max(best, weight * ((tf * (K1 + 1)) / norm));
			}
			if (best === 0) continue;
			matchedWeight += group.weight;
			score += best;
		}
		if (score <= 0 || matchedWeight / (wantedWeight || 1) < minCoverage) continue;
		hits.push({ doc, score: score + Math.log1p(doc.useful) / 1000 });
	}
	return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
