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
	/** The official page Tier B retrieved. */
	doc: RawDoc;
	language: EntryLanguage;
}

export interface DraftStep {
	name: string;
	text: string;
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
export const PROMPT_VERSION = 'compose-1';

const LIMITS = { short: 16, full: 60, summary: 140, step: 300, confirm: 24, heading: 40, body: 600 } as const;

export function composePrompt(req: ComposeRequest, problems?: string[]): string {
	const { asked, doc, language } = req;
	const reply = language === 'zh-Hans' ? 'Simplified Chinese' : 'plain English';
	const lines = [
		'You are writing one card for Suara, which reads official Singapore government answers aloud to older people.',
		'',
		`The person said: "${asked}"`,
		'',
		`The official page, published by ${doc.agency.toUpperCase()} at ${doc.url}. Both lines below may be quoted:`,
		`Question: ${doc.title}`,
		'Answer:',
		doc.text,
		'',
		'If that answer does not actually answer what the person asked, reply {"kind":"none"} and nothing else.',
		'That is the right reply surprisingly often: the page is the closest thing held, which is not the same as an answer.',
		'',
		'Otherwise write the card as JSON, and nothing else. Shape:',
		'{"kind":"process"|"answer","short":"","full":"","summary":"","summary_quote":"",',
		' "steps":[{"name":"","text":"","confirm_label":"","quote":""}],',
		' "details":[{"heading":"","body":"","quote":""}],',
		' "phrasings":["","",""]}',
		'',
		'Rules, all of them binding:',
		`- Every quote field must be copied verbatim from the answer above, as one unbroken run of its text. A line that is not on the page is rejected and the person is told Suara does not know.`,
		'- You may choose, order and shorten. You may not add a fact, a number, a name or a condition that is not above.',
		`- "kind":"process" when the answer is something to do, with steps in order; "answer" when it is something to know, with details.`,
		'- Steps are what the person does, one action each, in order. confirm_label is what they tap when that step is done, in their voice: "I have the form".',
		`- Answer the question that was asked. Leave out what is on the page but does not bear on it.`,
		`- Write in ${reply}, short sentences, no jargon, no "please note", nothing about websites the person cannot use.`,
		`- Lengths, in characters: short <= ${LIMITS.short}, full <= ${LIMITS.full}, summary <= ${LIMITS.summary}, step text <= ${LIMITS.step}, confirm_label <= ${LIMITS.confirm}, detail heading <= ${LIMITS.heading}, detail body <= ${LIMITS.body}.`,
		'- short is the one line on the card: two or three words, no punctuation.',
		'- full is a heading that names the thing, not a sentence and never ending in a full stop: "What ElderFund is for", "Paying a bill with MediSave".',
		'- At least 3 phrasings: other ways a person might ask this out loud, including the way this person did.',
		'- At most 6 steps and at most 4 details.',
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

/** The first whole words of a heading that fit, so a label never ends mid-word. */
export function shorten(text: string, limit: number): string {
	const words = squash(text).split(' ');
	let out = '';
	for (const word of words) {
		const next = out ? `${out} ${word}` : word;
		if ([...next].length > limit) break;
		out = next;
	}
	return out || [...squash(text)].slice(0, limit).join('');
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
	const { doc } = req;

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
	// A heading that is a sentence reads as an answer and crowds the card; the model writes
	// one whenever it is not told otherwise.
	if ((draft.full ?? '').trim().endsWith('.')) errors.push('full is a heading, not a sentence: drop the full stop');

	for (const { where, value, limit } of limits) {
		if (!value.trim()) errors.push(`${where} is empty`);
		else if ([...value].length > limit) errors.push(`${where} is ${[...value].length} characters, over the limit of ${limit}`);
	}

	/*
	 * Quotes: each must be on the page, and each distinct quote is stored once.
	 *
	 * The page is its published question and its answer. Some answers are a single line —
	 * "Please call 1800-650-6060 for assistance." — and the only statement of what the page
	 * is about sits in the question above it, which a card has to be able to quote.
	 */
	const page = squash(`${doc.title}\n${doc.text}`);
	const quoteId = new Map<string, string>();
	const quotes: Entry['quotes'] = [];
	const refFor = (raw: string | undefined, where: string): string[] => {
		const text = squash(raw ?? '');
		if (!text) {
			errors.push(`${where} cites no quote`);
			return [];
		}
		if (!page.includes(text)) {
			errors.push(`${where} quotes text that is not on the page: "${text.slice(0, 80)}"`);
			return [];
		}
		const held = quoteId.get(text);
		if (held) return [held];
		const id = `q${quotes.length + 1}`;
		quoteId.set(text, id);
		quotes.push({ id, source: 'src1', text });
		return [id];
	};

	const summaryRefs = refFor(draft.summary_quote, 'summary');
	const stepRefs = steps.map((s, i) => refFor(s.quote, `steps.${i}`));
	const detailRefs = details.map((d, i) => refFor(d.quote, `details.${i}`));

	const phrasings = [req.asked, ...(draft.phrasings ?? [])]
		.map((p) => squash(p))
		.filter((p) => p.length >= 3 && p.length <= 120)
		.filter((p, i, all) => all.indexOf(p) === i)
		.slice(0, 12);
	if (phrasings.length < 3) errors.push('at least 3 phrasings are needed, including the words the person used');

	if (errors.length > 0) return { ok: false, errors };

	const id = `sg.${doc.agency}.${slug(draft.full)}`;
	const checks: Entry['verification']['checks'] = [
		{ type: 'quotes-found', passed: true, at: now, note: `checked against ${doc.url} as crawled` },
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
					steps: steps.map((s, i) => ({
						position: i + 1,
						name: squash(s.name),
						text: squash(s.text),
						confirm_label: squash(s.confirm_label),
						quote_refs: stepRefs[i]!,
					})),
				}
			: {}),
		topic: { area: areaFor(doc, draft.full), ...(tagsFor(doc).length ? { tags: tagsFor(doc) } : {}) },
		search: { example_phrasings: phrasings },
		sources: [
			{
				id: 'src1',
				publisher: doc.agency.toUpperCase(),
				url: doc.url,
				page_title: doc.title.slice(0, 300),
				...(doc.updatedAt ? { source_modified_at: doc.updatedAt.slice(0, 10) } : {}),
				retrieved_at: now,
			},
		],
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
