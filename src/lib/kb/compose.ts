/**
 * Writing a card for a question we hold an official answer to but have never structured.
 *
 * The person asks something; Tier A has nothing near enough; Tier B finds the official page
 * that answers it (`raw-store.ts`). This turns that page into an entry — a one-line
 * heading, a short summary, and steps to confirm one at a time — using the model the
 * person's vendor route already provides.
 *
 * The model's job is narrow on purpose: choose what matters for *this* question, order it,
 * and put it in the person's register. It may not contribute facts. Every line it writes
 * cites a `quote`, and this module refuses the draft unless that quote appears verbatim in
 * the page we crawled. A refused draft shows "not in Suara yet", which is the honest
 * outcome and the one the PRD promises.
 */
import { SCHEMA_VERSION, type Entry, type EntryLanguage } from './entry';
import type { RawDoc } from './raw-store';

export interface ComposeRequest {
	/** What the person said, in their words. */
	asked: string;
	/**
	 * The official pages Tier B retrieved, best first.
	 *
	 * More than one on purpose: the agencies split a subject across neighbouring questions —
	 * who administers ElderFund, who is eligible, what it pays — and a card answering what a
	 * person asked often needs a line from two of them. Every quote is still checked against
	 * the page it came from, and only pages actually quoted appear on the card.
	 */
	docs: RawDoc[];
	language: EntryLanguage;
}

export interface DraftStep {
	name: string;
	text: string;
	/** The step as shown: an optional lead-in, then one to four short sentences. */
	points: { lead?: string; items: string[] };
	/** "More about this step": at most two sentences, or empty. */
	about: string;
	about_quote: string;
	confirm_label: string;
	quote: string;
}

export interface DraftDetail {
	heading: string;
	body: string;
	quote: string;
}

export interface Draft {
	/** `none`: the page does not answer the question, so no card should be shown. */
	kind: 'answer' | 'process' | 'none';
	short: string;
	full: string;
	summary: string;
	summary_quote: string;
	steps: DraftStep[];
	details: DraftDetail[];
	phrasings: string[];
}

export type Composed = { ok: true; entry: Entry } | { ok: false; errors: string[] };

/** The model is asked for this and nothing else, so a bad reply is a parse failure. */
export const PROMPT_VERSION = 'compose-2';

const LIMITS = { short: 16, full: 60, summary: 140, step: 300, confirm: 24, heading: 40, body: 600, point: 140, lead: 60, about: 280 } as const;

/**
 * How each step is written, given to the model in so many words (owner, 2026-09-29: "pass the
 * agent the cornell or harvard review pose exactly so the LLM gives us correct, adequate,
 * extensive and concise content"). Sources and the older-reader finding: vault obs-0073.
 */
export const STEP_RULES = [
	'How to write each step. These are the rules of two sources, applied to an older person following a guide on a phone:',
	'- Todd Rogers and Jessica Lasky-Fink, Writing for Busy Readers (Harvard Kennedy School): less is more; make reading easy; design for easy navigation; use enough formatting, but no more; tell readers why they should care; make responding easy.',
	'- The Cornell note-taking system (Walter Pauk, Cornell University): a cue, then notes in short, concise sentences, then a summary of the gist in your own words.',
	'So, for every step:',
	'- name is the cue: the one action, verb first.',
	`- points are the notes: 1 to 4 items, one idea each, each a short complete sentence. Keep the words that link ideas ("if", "so", "then", "only"): older readers lose the meaning when those are cut. Use "lead", ending in a colon, only when the items are short parts that complete it, as in "The form must show:" then "The referral date". Items alike in form and in length. Leave "lead" out otherwise.`,
	'- about is what the person reads under "More about this step": at most two sentences, never points. Put the bottom line up front: the first sentence is the one thing this person most needs to know about this step, and why it matters to them; the second, only if needed, is the one detail or exception that changes what they do. Nothing the points already say. Leave it "" when the pages say nothing more about this step. about_quote is the verbatim line it rests on.',
	'- confirm_label is the summary, in the person\'s own words: what they tap when the step is done.',
	'- text is the step read aloud: what the points say, as one or two plain sentences.',
	'- Adequate and concise: every condition, exception, deadline and number on the pages that bears on a step appears in its points or its about, and nothing that does not bear on it.',
].join('\n');

/** Sentences in a short text: a stop, question or exclamation mark followed by a space or the end. */
export const sentenceCount = (text: string) => (text.match(/[.!?。！？]+(?=\s|$)/g) ?? []).length;

export function composePrompt(req: ComposeRequest, problems?: string[]): string {
	const { asked, docs, language } = req;
	const reply = language === 'zh-Hans' ? 'Simplified Chinese' : 'plain English';
	const pages = docs.flatMap((doc, i) => [
		`Page ${i + 1}, published by ${doc.agency.toUpperCase()} at ${doc.url}. Its question and its answer may both be quoted:`,
		`Question: ${doc.title}`,
		'Answer:',
		doc.text,
		'',
	]);
	const lines = [
		'You are writing one card for Suara, which reads official Singapore government answers aloud to older people.',
		'',
		`The person said: "${asked}"`,
		'',
		`Official pages held on this subject, nearest first. Use whichever of them bear on the question, and ignore the rest:`,
		'',
		...pages,
		'If none of them answers what the person asked, reply {"kind":"none"} and nothing else.',
		'That is the right reply surprisingly often: these are the nearest pages held, which is not the same as an answer.',
		'',
		'Otherwise write the card as JSON, and nothing else. Shape:',
		'{"kind":"process"|"answer","short":"","full":"","summary":"","summary_quote":"",',
		' "steps":[{"name":"","text":"","points":{"lead":"","items":[""]},"about":"","about_quote":"","confirm_label":"","quote":""}],',
		' "details":[{"heading":"","body":"","quote":""}],',
		' "phrasings":["","",""]}',
		'',
		'Rules, all of them binding:',
		`- Every quote field must be copied verbatim from one of the pages above, as one unbroken run of its text. A line that is on none of them is rejected and the person is told Suara does not know.`,
		'- You may choose, order and shorten. You may not add a fact, a number, a name or a condition that is not above.',
		`- "kind":"process" when the answer is something to do, with steps in order; "answer" when it is something to know, with details.`,
		'- Steps are what the person does, one action each, in order. confirm_label is what they tap when that step is done, in their own words: "I have the form", "I called them". Never "Done", "Next", "OK" or "Continue".',
		`- Answer the question that was asked. Leave out what is on the page but does not bear on it.`,
		`- Write in ${reply}, short sentences, no jargon, no "please note", nothing about websites the person cannot use.`,
		`- Lengths, in characters: short <= ${LIMITS.short}, full <= ${LIMITS.full}, summary <= 120 (the hard limit is ${LIMITS.summary}, so leave room), step text <= ${LIMITS.step}, each point <= ${LIMITS.point}, lead <= ${LIMITS.lead}, about <= ${LIMITS.about}, confirm_label <= ${LIMITS.confirm}, detail heading <= ${LIMITS.heading}, detail body <= ${LIMITS.body}.`,
		'- short is the one line on the card: two or three words, no punctuation.',
		'- full is a heading that names the thing, not a sentence and never ending in a full stop: "What ElderFund is for", "Paying a bill with MediSave". It says more than short does, so the two are never the same words.',
		'- Exactly three or four phrasings: short, different ways a person might ask this out loud, including the way this person did. Fewer than three and the card is rejected.',
		'- At most 6 steps and at most 4 details.',
		'',
		STEP_RULES,
	];
	if (problems?.length) {
		lines.push('', 'Your previous attempt was rejected:', ...problems.map((p) => `- ${p}`), '', 'Send the corrected JSON, nothing else.');
	}
	return lines.join('\n');
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

const AGENCY_AREA: Record<string, Entry['topic']['area']> = {
	moh: 'health',
	cpf: 'cpf-and-support',
	hdb: 'bills-and-housing',
	ica: 'digital-services',
	mom: 'cpf-and-support',
};

/** `Paying a family member’s bill with MediSave` -> `paying-a-family-members-bill-with-medisave`. */
function slug(text: string): string {
	const words = text
		.toLowerCase()
		.replace(/[‘’ʼ']/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.split('-')
		.filter(Boolean);
	const out: string[] = [];
	for (const word of words) {
		if (out.join('-').length + word.length + 1 > 60) break;
		out.push(word);
	}
	return out.join('-');
}

/** Words that carry no weight at the start or end of a label. */
const FILLER = /^(the|a|an|of|for|your|my|to|with|and|when|from|in|at|on|how|what|who|why|is|are|was|were|do|does|can|will|be)$/i;

/**
 * How much a word tells a person. A scheme's name is worth most — MediSave, CHAS, Healthier
 * SG — and the first word of a heading is always capitalised, so that one earns nothing for
 * it. Filler earns nothing at all.
 */
const informative = (word: string, isFirstInHeading: boolean) => {
	if (FILLER.test(word)) return 0;
	// A gerund is how a heading starts, not what it is about: "Getting help for premiums" is
	// about premiums. Worth something, but never enough to win on its own.
	if (/ing$/i.test(word) && word.length > 5) return 0.5;
	let score = 1;
	if (!isFirstInHeading && /^[A-Z]/.test(word)) score += 2;
	if (word.length > 6) score += 1;
	return score;
};

/**
 * The part of a heading that says the most, within the limit.
 *
 * Every starting point is tried, because the words that name the thing are rarely the first
 * ones: "Checking your MediSave top-up limit" is about MediSave top-ups, and "Who is in a
 * household" is about a household. A label never ends on filler, and never ends mid-word.
 */
export function shorten(text: string, limit: number): string {
	const words = squash(text).split(' ').filter(Boolean);
	if (words.length === 0) return '';

	const fit = (from: number): string[] => {
		const out: string[] = [];
		for (const word of words.slice(from)) {
			if ([...[...out, word].join(' ')].length > limit) break;
			out.push(word);
		}
		while (out.length > 0 && FILLER.test(out[out.length - 1]!)) out.pop();
		// And never begin on filler: "the CPF Safety" is a worse label than "CPF Safety".
		while (out.length > 0 && FILLER.test(out[0]!)) out.shift();
		return out;
	};

	let best: string[] = [];
	let bestScore = -1;
	for (let start = 0; start < words.length; start += 1) {
		const candidate = fit(start);
		if (candidate.length === 0) continue;
		const score = candidate.reduce((sum, w, i) => sum + informative(w, start + i === 0), 0);
		// Earliest wins a tie: the heading's own order is the author's.
		if (score > bestScore) {
			best = candidate;
			bestScore = score;
		}
	}
	if (best.length > 0) return best.join(' ');
	return [...squash(text)].slice(0, limit).join('').trim();
}

/** Words a kiosk uses. A person says what they did. */
const LAZY_CONFIRM = new Set(['done', 'next', 'ok', 'okay', 'continue', 'confirm', 'yes', 'proceed', 'finish', 'finished']);

/**
 * A Singapore public-service number as the agencies write it: 1800 650 6060, 6222 1222,
 * +65 6222 1222. Anything shorter is a year, a dollar amount or a form number.
 */
const PHONE = /(?:\+?65[\s-]?)?(?:1800[\s-]?\d{3}[\s-]?\d{4}|[63]\d{3}[\s-]?\d{4})/;

/** The call a card can offer, taken from a quote already checked against the page. */
export function callAction(quotes: Entry['quotes']): Entry['action'] | undefined {
	for (const quote of quotes) {
		const found = PHONE.exec(quote.text);
		if (!found) continue;
		const number = found[0].replace(/[^\d+]/g, '');
		const label = `Call ${number}`;
		if (label.length > 24) continue;
		return { type: 'call', label, value: number, quote_refs: [quote.id] };
	}
	return undefined;
}

const scamWords = /scam|phish|impersonat|fraud/i;

function areaFor(doc: RawDoc, title: string): Entry['topic']['area'] {
	if (scamWords.test(`${doc.title} ${doc.topics.join(' ')} ${title}`)) return 'scams';
	return AGENCY_AREA[doc.agency] ?? 'digital-services';
}

/** Topic labels become tags, so a composed entry sits where the crawl put it. */
function tagsFor(doc: RawDoc): string[] {
	const tags = new Set<string>();
	for (const label of doc.topics) {
		for (const part of label.split('/')) {
			const tag = slug(part);
			if (tag && tag.length <= 40) tags.add(tag);
		}
	}
	return [...tags].slice(0, 12);
}

interface Limited {
	where: string;
	value: string;
	limit: number;
}

/**
 * Turn a model's draft into an entry, or say why it cannot be one.
 *
 * Nothing here trims or paraphrases to make a draft fit. A summary silently cut at 140
 * characters is a sentence the agency did not write and nobody approved, and the card that
 * carries it looks exactly as authoritative as a correct one.
 */
export function draftToEntry(input: Draft, req: ComposeRequest, now: string): Composed {
	let draft = input;
	const errors: string[] = [];
	const docs = req.docs.filter(Boolean);
	const primary = docs[0];
	if (!primary) return { ok: false, errors: ['no page to write from'] };

	// The model's own refusal, which is a finding rather than a failure: no card is shown and
	// the person is told Suara does not know.
	if (draft.kind === 'none') return { ok: false, errors: ['the page does not answer this question'] };
	if (draft.kind !== 'answer' && draft.kind !== 'process') errors.push(`kind must be "answer" or "process", not ${String(draft.kind)}`);
	const steps = draft.steps ?? [];
	const details = draft.details ?? [];
	if (draft.kind === 'process' && steps.length === 0) errors.push('a process needs at least one step');
	if (draft.kind === 'answer' && steps.length > 0) errors.push('an answer has no steps');
	if (steps.length > 6) errors.push('at most 6 steps');
	if (details.length > 4) errors.push('at most 4 details');

	/*
	 * `short` is the one-line label on the card, not a claim about the world, so an overlong
	 * one is repaired from the heading rather than sent back: every model tested overshot 16
	 * characters sometimes, and making the person wait for a retry to fix a label is worse
	 * than shortening it here. Everything that carries meaning is still rejected outright.
	 */
	// Held before the repair below reassigns `draft` and widens the kind back to include
	// "none", which the refusal above has already ruled out.
	const kind: 'answer' | 'process' = draft.kind;

	if ([...(draft.short ?? '')].length > LIMITS.short && (draft.full ?? '').trim()) {
		draft = { ...draft, short: shorten(draft.full, LIMITS.short) };
	}

	const limits: Limited[] = [
		{ where: 'short', value: draft.short ?? '', limit: LIMITS.short },
		{ where: 'full', value: draft.full ?? '', limit: LIMITS.full },
		{ where: 'summary', value: draft.summary ?? '', limit: LIMITS.summary },
		...steps.flatMap((s, i) => [
			{ where: `steps.${i}.name`, value: s.name ?? '', limit: 40 },
			{ where: `steps.${i}.text`, value: s.text ?? '', limit: LIMITS.step },
			{ where: `steps.${i}.confirm_label`, value: s.confirm_label ?? '', limit: LIMITS.confirm },
		]),
		...details.flatMap((d, i) => [
			{ where: `details.${i}.heading`, value: d.heading ?? '', limit: LIMITS.heading },
			{ where: `details.${i}.body`, value: d.body ?? '', limit: LIMITS.body },
		]),
	];
	/*
	 * A confirmation button is the one place a person speaks in this product: tapping "I have
	 * the form" is a different act from tapping "Done", and the difference is whether the
	 * screen sounds like a person or a kiosk.
	 */
	for (const [i, step] of steps.entries()) {
		if (LAZY_CONFIRM.has(squash(step.confirm_label ?? '').toLowerCase())) {
			errors.push(`steps.${i}.confirm_label must be the person's own words, not "${step.confirm_label}"`);
		}
	}

	/*
	 * Points and "more" (vault obs-0073). A step without points would show as prose on a screen
	 * built for points, so it is sent back; a lead-in that does not end in a colon is not
	 * leading into anything; a "more" of three sentences has stopped being the bottom line.
	 */
	const pointsOf = (s: DraftStep) => (Array.isArray(s.points?.items) ? s.points.items.map((t) => squash(String(t ?? ''))).filter(Boolean) : []);
	for (const [i, step] of steps.entries()) {
		const items = pointsOf(step);
		if (items.length === 0) errors.push(`steps.${i}.points has no items: write the step as 1 to 4 short sentences`);
		else if (items.length > 4) errors.push(`steps.${i}.points has ${items.length} items, at most 4`);
		items.forEach((t, j) => {
			if ([...t].length > LIMITS.point) errors.push(`steps.${i}.points.items.${j} is ${[...t].length} characters, over the limit of ${LIMITS.point}`);
		});
		const lead = squash(step.points?.lead ?? '');
		if (lead && !/[:：]$/.test(lead)) errors.push(`steps.${i}.points.lead must end in a colon and be completed by the items, or be left out`);
		if ([...lead].length > LIMITS.lead) errors.push(`steps.${i}.points.lead is ${[...lead].length} characters, over the limit of ${LIMITS.lead}`);
		const about = squash(step.about ?? '');
		if ([...about].length > LIMITS.about) errors.push(`steps.${i}.about is ${[...about].length} characters, over the limit of ${LIMITS.about}`);
		if (sentenceCount(about) > 2) errors.push(`steps.${i}.about is ${sentenceCount(about)} sentences: at most two, the bottom line first`);
	}

	// The label is what fits on the card; the heading is what the card is about. Identical
	// ones waste the only line that can say more.
	if (squash(draft.short ?? '').toLowerCase() === squash(draft.full ?? '').toLowerCase()) {
		errors.push('full must say more than short does');
	}

	// A heading that is a sentence reads as an answer and crowds the card; the model writes
	// one whenever it is not told otherwise.
	if ((draft.full ?? '').trim().endsWith('.')) errors.push('full is a heading, not a sentence: drop the full stop');

	for (const { where, value, limit } of limits) {
		if (!value.trim()) errors.push(`${where} is empty`);
		else if ([...value].length > limit) errors.push(`${where} is ${[...value].length} characters, over the limit of ${limit}`);
	}

	/*
	 * Quotes: each must be on one of the pages, and each distinct quote is stored once.
	 *
	 * A page is its published question and its answer. Some answers are a single line —
	 * "Please call 1800-650-6060 for assistance." — and the only statement of what the page
	 * is about sits in the question above it, which a card has to be able to quote.
	 */
	const pageText = docs.map((d) => squash(`${d.title}\n${d.text}`));
	const sourceId = new Map<number, string>();
	const quoteId = new Map<string, string>();
	const quotes: Entry['quotes'] = [];
	const refFor = (raw: string | undefined, where: string): string[] => {
		const text = squash(raw ?? '');
		if (!text) {
			errors.push(`${where} cites no quote`);
			return [];
		}
		const found = pageText.findIndex((page) => page.includes(text));
		if (found < 0) {
			errors.push(`${where} quotes text that is not on the page: "${text.slice(0, 80)}"`);
			return [];
		}
		const held = quoteId.get(text);
		if (held) return [held];
		// Only pages actually quoted become sources, numbered in the order they are first used.
		let source = sourceId.get(found);
		if (!source) {
			source = `src${sourceId.size + 1}`;
			sourceId.set(found, source);
		}
		const id = `q${quotes.length + 1}`;
		quoteId.set(text, id);
		quotes.push({ id, source, text });
		return [id];
	};

	const summaryRefs = refFor(draft.summary_quote, 'summary');
	const stepRefs = steps.map((s, i) => refFor(s.quote, `steps.${i}`));
	// A "more" rests on its own line of the page; an empty one cites nothing and is left off.
	const aboutRefs = steps.map((s, i) => (squash(s.about ?? '') ? refFor(s.about_quote, `steps.${i}.about`) : []));
	const detailRefs = details.map((d, i) => refFor(d.quote, `details.${i}`));

	/*
	 * The person's words, then the model's, then the page's own question and the card's
	 * heading if those leave fewer than three. A phrasing is how somebody might ask for this,
	 * not a statement about the world, so filling it costs nothing and rejecting a good card
	 * for want of one costs an answer.
	 */
	const phrasings = [req.asked, ...(draft.phrasings ?? []), primary.title, squash(draft.full ?? '')]
		.map((p) => squash(p))
		.filter((p) => p.length >= 3 && p.length <= 120)
		.filter((p, i, all) => all.indexOf(p) === i)
		.slice(0, 12);
	if (phrasings.length < 3) errors.push('at least 3 phrasings are needed, including the words the person used');

	if (errors.length > 0) return { ok: false, errors };

	const cited = [...sourceId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
	const id = `sg.${docs[cited[0]?.[0] ?? 0]!.agency}.${slug(draft.full)}`;
	const checks: Entry['verification']['checks'] = [
		{
			type: 'quotes-found',
			passed: true,
			at: now,
			note: `checked against ${cited.length} crawled page(s): ${cited.map(([i]) => docs[i]!.url).join(' ')}`.slice(0, 300),
		},
		{ type: 'refs-resolve', passed: true, at: now },
	];

	const entry: Entry = {
		schema_version: SCHEMA_VERSION,
		id,
		kind,
		language: req.language,
		translation_of: null,
		title: { short: squash(draft.short), full: squash(draft.full) },
		summary: { text: squash(draft.summary), quote_refs: summaryRefs },
		...(details.length
			? { details: details.map((d, i) => ({ heading: squash(d.heading), body: squash(d.body), quote_refs: detailRefs[i]! })) }
			: {}),
		...(steps.length
			? {
					steps: steps.map((s, i) => {
						const lead = squash(s.points?.lead ?? '');
						const about = squash(s.about ?? '');
						return {
							position: i + 1,
							name: squash(s.name),
							text: squash(s.text),
							points: { ...(lead ? { lead } : {}), items: pointsOf(s) },
							...(about ? { about: { text: about, quote_refs: aboutRefs[i]! } } : {}),
							confirm_label: squash(s.confirm_label),
							quote_refs: stepRefs[i]!,
						};
					}),
				}
			: {}),
		...(callAction(quotes) ? { action: callAction(quotes)! } : {}),
		topic: { area: areaFor(primary, draft.full), ...(tagsFor(primary).length ? { tags: tagsFor(primary) } : {}) },
		search: { example_phrasings: phrasings },
		sources: cited.map(([i, sid]) => {
			const d = docs[i]!;
			return {
				id: sid,
				publisher: d.agency.toUpperCase(),
				url: d.url,
				page_title: d.title.slice(0, 300),
				...(d.updatedAt && /^\d{4}-\d{2}-\d{2}/.test(d.updatedAt) ? { source_modified_at: d.updatedAt.slice(0, 10) } : {}),
				retrieved_at: now,
			};
		}),
		quotes,
		provenance: {
			collected: { method: 'sitemap-crawl', at: now },
			structured: { method: 'model', model: null, prompt_version: PROMPT_VERSION, at: now },
		},
		// Grounded because the quotes were just checked against the page, not because a
		// model wrote it. `provenance.structured.method` is how a review pass finds these.
		verification: { status: 'grounded', checks },
		lifecycle: { version: 1, created_at: now, updated_at: now },
	};

	return { ok: true, entry };
}

/** The model may fence its JSON, or wrap it in a sentence. Take the outermost object. */
export function readDraft(reply: string): Draft | undefined {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
	const body = fenced ? fenced[1]! : reply;
	const start = body.indexOf('{');
	const end = body.lastIndexOf('}');
	if (start < 0 || end <= start) return undefined;
	try {
		const parsed = JSON.parse(body.slice(start, end + 1)) as Draft;
		return parsed && typeof parsed === 'object' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export type Writer = (prompt: string) => Promise<string>;

/**
 * Ask the writer for a card, and once more with the reasons if the first is refused.
 *
 * One retry, not more: the person is waiting, and a model that invents a quote twice is not
 * going to stop on the third attempt.
 */
export async function compose(req: ComposeRequest, writer: Writer, now: string): Promise<Composed> {
	let problems: string[] | undefined;
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		const reply = await writer(composePrompt(req, problems));
		const draft = readDraft(reply);
		if (!draft) {
			problems = ['the reply was not the JSON card that was asked for'];
			continue;
		}
		if (draft.kind === 'none') return { ok: false, errors: ['the page does not answer this question'] };
		const made = draftToEntry(draft, req, now);
		if (made.ok) return made;
		problems = made.errors;
	}
	return { ok: false, errors: problems ?? ['no draft'] };
}
