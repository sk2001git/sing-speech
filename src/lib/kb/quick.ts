/**
 * Quick find: what a person has typed so far, matched against the cards we hold.
 *
 * This is not the retrieval in `raw-store.ts`. BM25 ranks whole words in documents; here
 * somebody is halfway through a word, may have typed the words in the order they thought of
 * them, and may have mistyped one. It runs in the browser on every keystroke, over a small
 * index of labels, with no network call and no model.
 *
 * The approach is uFuzzy's (MIT, leeoniya), ported rather than depended on, as the
 * components were (vault dec-suara-0020):
 *
 *  - every term the person typed must match, so "family limits" finds nothing rather than
 *    the card that answers half of it;
 *  - a term matches when its letters appear **in order** in the candidate, not necessarily
 *    together — "medsav" matches "MediSave";
 *  - what ranks a match is where and how tightly it landed: a word start beats the middle
 *    of a word, letters that run together beat letters scattered across a sentence, and a
 *    short label beats a long one for the same match;
 *  - one mistyped letter is forgiven on a term of five letters or more, where forgiving it
 *    cannot make the term match everything.
 */
export interface Findable {
	id: string;
	/** The one line on the card. What is searched hardest and what is marked on screen. */
	label: string;
	/** The fuller heading. */
	heading: string;
	tags: string[];
	/** One way a person has asked for this before. */
	asked: string;
}

export interface Hit {
	item: Findable;
	score: number;
	/** Ranges in `label` that matched, for marking the letters on screen. */
	marks: [number, number][];
}

/** Where a term matched, and how well. */
interface Landing {
	score: number;
	marks: [number, number][];
}

const LABEL_WEIGHT = 1;
const HEADING_WEIGHT = 0.7;
const TAG_WEIGHT = 0.5;
const ASKED_WEIGHT = 0.45;
/** Below this, forgiving a letter would let a term match almost anything. */
const TYPO_FROM = 5;

const fold = (text: string) => text.toLowerCase().replace(/[‘’ʼ]/g, "'");

/**
 * A card with its text folded once. Held against the card itself, so callers pass the same
 * array on every keystroke and pay for the folding on the first one only.
 */
interface Prepared {
	label: string;
	heading: string;
	tags: string[];
	asked: string;
	/** One bit per letter a-z present anywhere on the card, and one for any digit. */
	letters: number;
}

/** `medisave` -> the bits for m, e, d, i, s, a, v. */
function lettersOf(text: string): number {
	let mask = 0;
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		if (code >= 97 && code <= 122) mask |= 1 << (code - 97);
		else if (code >= 48 && code <= 57) mask |= 1 << 26;
	}
	return mask;
}

const prepared = new WeakMap<Findable, Prepared>();

function prepare(item: Findable): Prepared {
	let held = prepared.get(item);
	if (!held) {
		const label = fold(item.label);
		const heading = fold(item.heading);
		const tags = item.tags.map(fold);
		const asked = fold(item.asked);
		held = { label, heading, tags, asked, letters: lettersOf(`${label} ${heading} ${tags.join(' ')} ${asked}`) };
		prepared.set(item, held);
	}
	return held;
}

/**
 * Where a word starts, as a person sees it: the beginning, after anything that is not a
 * letter or digit, and before a capital inside a word. The last one is why "save" finds
 * MediSave and "sg" finds Healthier SG.
 */
const isBoundary = (folded: string, original: string, at: number) => {
	if (at === 0) return true;
	if (!/[a-z0-9]/.test(folded[at - 1] ?? '')) return true;
	return /[A-Z]/.test(original[at] ?? '') && !/[A-Z]/.test(original[at - 1] ?? '');
};

/**
 * How far apart the letters of a term may land before the match stops meaning anything.
 *
 * Without this, "limits" matched l-i-m-i-t scattered through "can I use my MediSave to pay
 * my father hospital bill", and typing "family limits" returned the family card — half an
 * answer presented as a whole one.
 */
const span = (term: string) => term.length * 3 + 4;

/**
 * The best place `term` lands in `text`, as a score, or 0 if its letters are not all there
 * in order and close enough together. Greedy from each starting point, which is enough for
 * labels of a few words and is what keeps this within a keystroke.
 */
function land(term: string, original: string, folded?: string, wantMarks = false): Landing {
	const text = folded ?? fold(original);
	if (term.length === 0 || text.length === 0) return { score: 0, marks: [] };
	let best: Landing = { score: 0, marks: [] };

	for (let start = 0; start <= text.length - term.length; start += 1) {
		if (text[start] !== term[0]) continue;
		// People type the start of a word. Allowing a match to begin mid-word is what let
		// "limits" land on the l in "family" and wander off through the sentence.
		if (!isBoundary(text, original, start)) continue;

		const marks: [number, number][] = wantMarks ? [] : EMPTY_MARKS;
		let at = start;
		let matched = 0;
		let runs = 0;
		let boundaries = 0;
		let gaps = 0;

		while (matched < term.length && at < text.length) {
			if (text[at] === term[matched]) {
				const from = at;
				while (matched < term.length && at < text.length && text[at] === term[matched]) {
					matched += 1;
					at += 1;
				}
				if (wantMarks) marks.push([from, at]);
				runs += 1;
				// Worth what the run carries: a single stray letter that happens to start a word
				// is not the same as half the term landing there.
				if (isBoundary(text, original, from)) boundaries += (at - from) / term.length;
			} else {
				at += 1;
				gaps += 1;
			}
			if (at - start > span(term)) break;
		}
		if (matched < term.length) continue;

		// A run of letters together is worth more than the same letters scattered; a match at
		// the start of a word is worth more than one inside it; and the earlier it lands in a
		// short label, the more likely it is the thing being looked for.
		const density = term.length / runs;
		const score = term.length * 2 + density * 3 + boundaries * 5 - gaps * 0.15 - start * 0.05 - text.length * 0.01;
		if (score > best.score) best = { score, marks: wantMarks ? marks : EMPTY_MARKS };
	}
	return best;
}

/** Shared, never written to: the fields that only rank a card collect no ranges. */
const EMPTY_MARKS: [number, number][] = [];

/** The same term with one letter dropped, for forgiving a single mistyped letter. */
function withOneLetterDropped(term: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < term.length; i += 1) {
		const shorter = term.slice(0, i) + term.slice(i + 1);
		if (!out.includes(shorter)) out.push(shorter);
	}
	return out;
}

/**
 * How well one typed term fits one card, across its label, heading, tags and the way
 * somebody once asked for it.
 */
export function scoreOne(term: string, item: Findable): number {
	return fit(fold(term), item).score;
}

function fit(term: string, item: Findable, mask = lettersOf(term)): Landing {
	const folded = prepare(item);
	// One integer compares out most of the corpus: a card that does not hold every letter of
	// the term cannot contain it in order either.
	if ((mask & ~folded.letters) !== 0) return { score: 0, marks: [] };

	const label = land(term, item.label, folded.label, true);
	const heading = land(term, item.heading, folded.heading);
	const tags = item.tags.reduce((best, tag, i) => Math.max(best, land(term, tag, folded.tags[i]).score), 0);
	const asked = land(term, item.asked, folded.asked);

	const score =
		label.score * LABEL_WEIGHT + heading.score * HEADING_WEIGHT + tags * TAG_WEIGHT + asked.score * ASKED_WEIGHT;
	return { score, marks: label.marks };
}

/**
 * Cards that fit everything typed, best first.
 *
 * Every term must match somewhere on the card. Somebody who types two words has told us
 * two things about what they want, and a result that honours one of them is a wrong answer
 * wearing a right one's clothes — the failure this product keeps having to design out.
 */
export function quickFind(items: readonly Findable[], typed: string, limit = 6): Hit[] {
	const terms = fold(typed).split(/[^a-z0-9']+/).filter(Boolean);
	if (terms.length === 0) return [];

	// Worked out once per keystroke rather than once per card: the variants, and the letters
	// each of them needs.
	const masks = terms.map(lettersOf);
	const forgiving = terms.map((term) =>
		term.length >= TYPO_FROM ? withOneLetterDropped(term).map((shorter) => ({ shorter, mask: lettersOf(shorter) })) : [],
	);

	const hits: Hit[] = [];
	for (const item of items) {
		let total = 0;
		const marks: [number, number][] = [];
		let everyTermFits = true;

		for (const [i, term] of terms.entries()) {
			let landing = fit(term, item, masks[i]!);
			if (landing.score === 0) {
				// One letter forgiven, and the match is worth less for having needed it.
				for (const { shorter, mask } of forgiving[i]!) {
					const softer = fit(shorter, item, mask);
					if (softer.score > landing.score) landing = { score: softer.score * 0.6, marks: softer.marks };
				}
			}
			if (landing.score === 0) {
				everyTermFits = false;
				break;
			}
			total += landing.score;
			marks.push(...landing.marks);
		}
		if (!everyTermFits) continue;
		hits.push({ item, score: total, marks: merge(marks) });
	}

	return hits.sort((a, b) => b.score - a.score || a.item.label.length - b.item.label.length).slice(0, limit);
}

/** Overlapping marks joined, so the screen underlines each letter once. */
function merge(marks: [number, number][]): [number, number][] {
	const sorted = [...marks].sort((a, b) => a[0] - b[0]);
	const out: [number, number][] = [];
	for (const [from, to] of sorted) {
		const last = out[out.length - 1];
		if (last && from <= last[1]) last[1] = Math.max(last[1], to);
		else out.push([from, to]);
	}
	return out;
}
