/**
 * Answers from the web, the add-on behind the knowledge base (vault plan
 * suara-2026-09-25-feature-web-steps, decision dec-suara-0023).
 *
 * When nothing in Suara answers a question, the OpenAI route asks Luna to search the web and
 * reply to a strict schema: steps (to do something), a direct answer (to know something), or
 * none. Nothing the model says is trusted as is: every step, the answer and the legal note must
 * cite pages the search actually saw, or they are dropped. The search tool also writes its own
 * citation markup into text, which is stripped.
 *
 * Measured in the spike (obs-0049): 2-8 steps or an answer, 7-19 s, 1-3 cents a question.
 */
import { HOSPITALS } from '../charts/ed-wait';
import type { EntryLanguage } from './entry';
import { firstTwoSentences, STEP_WRITING } from './step-writing';

export const DEFAULT_WEB_MODEL = 'gpt-6-luna';

export interface WebStep {
	name: string;
	text: string;
	/** The step in points and its "more" (plan-suara-0020); absent on guides kept before them. */
	points?: { lead?: string; items: string[] };
	about?: string;
	confirm_label: string;
	source_urls: string[];
}
/** A step as the model writes it: the strict schema says "none" as null or empty. */
export interface RawWebStep extends Omit<WebStep, 'points' | 'about'> {
	points_lead?: string | null;
	points?: string[];
	about?: string | null;
}
export interface WebSource {
	url: string;
	title: string;
	site: string;
}
/** One figure for one place, e.g. a ward bill at one hospital. */
export interface WebFigure {
	label: string;
	/** The place's English name, whatever language the answer is in: checked against known names. */
	label_en: string;
	detail: string;
	/** As the page shows it: "$2,406". */
	value: string;
	/** The same, as a number, for ordering. */
	number: number;
	source_urls: string[];
}
/**
 * One measure compared across places, drawn as a table rather than written as a paragraph
 * (owner, 2026-09-28: "diagram being the first ... form a table with each hospital").
 */
export interface WebFigures {
	caption: string;
	label_heading: string;
	value_heading: string;
	/** Which end is better for the person; the best row is marked only when one is. */
	better: 'lower' | 'higher' | 'neither';
	rows: WebFigure[];
}
/** The model's reply, before grounding. */
export interface RawWebAnswer {
	kind: 'steps' | 'answer' | 'none';
	title_short: string;
	title_full: string;
	summary: string;
	answer: string;
	answer_urls: string[];
	prerequisites: string;
	steps: RawWebStep[];
	legal: { applies: boolean; text: string; source_urls: string[] };
	disclaimer: string;
	sources: WebSource[];
	cautions: string[];
	figures: WebFigures;
}
/** What the phone shows: grounded, cleaned, and honest about what was left out. */
export interface WebAnswer extends Omit<RawWebAnswer, 'figures' | 'steps'> {
	steps: WebStep[];
	/** Three or more grounded rows, best first; absent otherwise, and on guides kept before it. */
	figures?: WebFigures;
	/** Steps dropped because their pages were not among those the search saw. */
	dropped: number;
	/** Every kept page is a Singapore government site. */
	official: boolean;
}

export type WebStage = { stage: 'searching' } | { stage: 'reading'; pages: number } | { stage: 'writing' };

const SYSTEM = `You help an older person in Singapore. Search the web, read the most
authoritative pages (the organisation's own help pages and official sources first), then answer.
Decide the kind:
- "steps" when they want to DO something: a short guide, as many steps as the task needs
  (2 for a simple thing, up to 10 for a long one), one action per step.
- "answer" when they want to KNOW something: a direct answer in plain words, no steps.
- "none" when you cannot find a reliable answer.
Rules:
- Only what the pages support. Every step, and the answer, cites the URL(s) it came from, copied exactly.
- prerequisites: what they must already have before starting, in ONE short plain sentence.
  Empty string if nothing.
- legal: if Singapore law touches this at all (licences, regulated activities, tax, contracts,
  age limits, penalties, rules on where or how something may be done), set applies true and say
  plainly what the law means for them, citing the source. Do not repeat the answer word for word.
  Otherwise applies false and empty text.
- disclaimer: one fine-print sentence fitting this topic (e.g. not financial, legal or medical
  advice; prices and rules change). Always give one.
- cautions: other things worth checking (fees, delays, scams). Short.
- figures: when the answer compares ONE measure across three or more places, plans or groups
  (a bill at each hospital, a wait at each clinic), give each as a row: label is the place
  written out in full, never an abbreviation ("Changi General Hospital", not "CGH"); label_en is
  its official English name, even when writing in Chinese; detail is
  what distinguishes the row ("C ward"), or empty; value as the page shows it ("$2,406");
  number is the same as a plain number (2406); source_urls as for steps. caption says exactly
  what is measured, in one line. better says whether a lower or a higher figure is better for
  the person, or neither. When there are rows, the answer gives the range and what the figures
  mean; it does not list them again. Otherwise rows is empty and the other fields empty strings,
  with better "neither".
- Step name at most 40 characters, text at most 300, each point at most 140, points_lead at most
  60, about at most 280, confirm_label at most 24 ("I have signed in"). points_lead and about are
  null when a step has none.
- Plain text only in every field: no URLs, no markdown, no citation brackets.
  URLs go only in answer_urls, source_urls and sources.`;

const LANGUAGE: Record<EntryLanguage, string> = {
	en: 'Write every field in plain English.',
	'zh-Hans': 'Write every field in Simplified Chinese, in plain words.',
};

const str = { type: 'string' } as const;
const urls = { type: 'array', items: str } as const;
const SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['kind', 'title_short', 'title_full', 'summary', 'answer', 'answer_urls', 'prerequisites', 'steps', 'legal', 'disclaimer', 'sources', 'cautions', 'figures'],
	properties: {
		kind: { type: 'string', enum: ['steps', 'answer', 'none'] },
		title_short: { type: 'string', description: 'At most 16 characters' },
		title_full: { type: 'string', description: 'At most 60 characters' },
		summary: { type: 'string', description: 'One sentence, at most 140 characters' },
		answer: { type: 'string', description: 'For kind answer: at most 600 characters. Empty otherwise.' },
		answer_urls: urls,
		prerequisites: str,
		steps: {
			type: 'array',
			maxItems: 12,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['name', 'text', 'points_lead', 'points', 'about', 'confirm_label', 'source_urls'],
				properties: {
					name: str,
					text: str,
					points_lead: { type: ['string', 'null'] },
					points: { type: 'array', maxItems: 4, items: str },
					about: { type: ['string', 'null'] },
					confirm_label: str,
					source_urls: urls,
				},
			},
		},
		legal: {
			type: 'object',
			additionalProperties: false,
			required: ['applies', 'text', 'source_urls'],
			properties: { applies: { type: 'boolean' }, text: str, source_urls: urls },
		},
		disclaimer: str,
		sources: {
			type: 'array',
			items: { type: 'object', additionalProperties: false, required: ['url', 'title', 'site'], properties: { url: str, title: str, site: str } },
		},
		cautions: { type: 'array', items: str },
		figures: {
			type: 'object',
			additionalProperties: false,
			required: ['caption', 'label_heading', 'value_heading', 'better', 'rows'],
			properties: {
				caption: str,
				label_heading: { type: 'string', description: 'e.g. "Hospital"' },
				value_heading: { type: 'string', description: 'e.g. "Bill"' },
				better: { type: 'string', enum: ['lower', 'higher', 'neither'] },
				rows: {
					type: 'array',
					maxItems: 12,
					items: {
						type: 'object',
						additionalProperties: false,
						required: ['label', 'label_en', 'detail', 'value', 'number', 'source_urls'],
						properties: { label: str, label_en: { type: 'string', description: 'The official English name, always' }, detail: str, value: str, number: { type: 'number' }, source_urls: urls },
					},
				},
			},
		},
	},
} as const;

/** The Responses API request: web search from Singapore, low reasoning, strict schema, streamed. */
export function webRequestBody(question: string, language: EntryLanguage, model = DEFAULT_WEB_MODEL) {
	return {
		model,
		stream: true,
		reasoning: { effort: 'low' },
		tools: [{ type: 'web_search', user_location: { type: 'approximate', country: 'SG' } }],
		include: ['web_search_call.action.sources'],
		input: [
			// The same step rules as Suara's own cards, word for word (step-writing.ts).
			{ role: 'system', content: `${SYSTEM}\n${STEP_WRITING.join('\n')}\n${LANGUAGE[language]}` },
			{ role: 'user', content: question },
		],
		text: { format: { type: 'json_schema', name: 'web_answer', strict: true, schema: SCHEMA } },
		max_output_tokens: 6000,
	};
}

/**
 * The search tool appends its own citation markup even when told not to: "([site](url))",
 * markdown links, bare URLs, **bold**. The words stay; the URLs live in the url fields.
 */
export function cleanText(t: string): string {
	return t
		.replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/\s*(?:See:?\s*)?https?:\/\/\S+(?:\s*[;,])?/g, '')
		.replace(/\s+([.;,])/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/** A URL as a page, not a visit: no query, fragment or trailing slash. */
function page(u: string): string {
	try {
		const x = new URL(u);
		return (x.origin + x.pathname).replace(/\/$/, '');
	} catch {
		return u;
	}
}

/** Every page the tool saw: search results, and pages it opened directly. */
export function seenUrls(output: unknown[]): Set<string> {
	const seen = new Set<string>();
	for (const item of output as { type?: string; action?: { sources?: { url?: string }[]; url?: string } }[]) {
		if (item.type !== 'web_search_call') continue;
		for (const s of item.action?.sources ?? []) if (s.url) seen.add(s.url);
		if (item.action?.url) seen.add(item.action.url);
	}
	return seen;
}

const isGov = (u: string) => {
	try {
		return new URL(u).hostname.endsWith('.gov.sg');
	} catch {
		return false;
	}
};

/**
 * A public hospital's Chinese name from Suara's checked list, not the model's: live, it wrote
 * Ng Teng Fong General Hospital (黄廷方综合医院) as 恩颂纪念医院. Other places keep the model's name.
 */
function placeName(r: WebFigure): string {
	const label = cleanText(r.label);
	if (!/\p{Script=Han}/u.test(label)) return label;
	return Object.values(HOSPITALS).find((h) => h.match.test(r.label_en ?? ''))?.zh ?? label;
}

/** Keep only what the search saw; clean the words; say what was left out. */
export function groundAnswer(raw: RawWebAnswer, seen: Set<string>): WebAnswer {
	const pages = new Set([...seen].map(page));
	const known = (urls: string[]) => urls.length > 0 && urls.every((u) => pages.has(page(u)));
	const steps = raw.kind === 'steps' ? raw.steps.filter((s) => known(s.source_urls)) : [];
	const dropped = raw.kind === 'steps' ? raw.steps.length - steps.length : 0;
	const answerOk = raw.kind === 'answer' && raw.answer.trim() !== '' && known(raw.answer_urls);
	const kind: WebAnswer['kind'] = raw.kind === 'steps' ? (steps.length ? 'steps' : 'none') : raw.kind === 'answer' ? (answerOk ? 'answer' : 'none') : 'none';
	const legal = raw.legal.applies && known(raw.legal.source_urls) ? { ...raw.legal, text: cleanText(raw.legal.text) } : { applies: false, text: '', source_urls: [] };
	const sources = raw.sources.filter((s) => pages.has(page(s.url)));
	// Figures, like steps, must cite pages the search saw; fewer than three is no comparison.
	const f = raw.figures;
	const rows = kind === 'answer' && f ? f.rows.filter((r) => known(r.source_urls) && Number.isFinite(r.number) && r.value.trim() !== '') : [];
	rows.sort((x, y) => (f?.better === 'higher' ? y.number - x.number : x.number - y.number));
	const figures: WebFigures | undefined =
		f && rows.length >= 3
			? {
					caption: cleanText(f.caption),
					label_heading: cleanText(f.label_heading),
					value_heading: cleanText(f.value_heading),
					better: f.better,
					rows: rows.map((r) => ({ ...r, label: placeName(r), detail: cleanText(r.detail), value: cleanText(r.value) })),
				}
			: undefined;
	return {
		...(figures ? { figures } : {}),
		kind,
		title_short: cleanText(raw.title_short),
		title_full: cleanText(raw.title_full),
		summary: cleanText(raw.summary),
		answer: kind === 'answer' ? cleanText(raw.answer) : '',
		answer_urls: kind === 'answer' ? raw.answer_urls : [],
		prerequisites: cleanText(raw.prerequisites),
		steps: steps.map((s): WebStep => {
			const items = (s.points ?? []).map(cleanText).filter(Boolean).slice(0, 4);
			const lead = cleanText(s.points_lead ?? '');
			// A "more" that ran on keeps its bottom line and one detail, as the rules ask.
			const about = firstTwoSentences(cleanText(s.about ?? ''));
			return {
				name: cleanText(s.name),
				text: cleanText(s.text),
				...(items.length ? { points: { ...(lead ? { lead } : {}), items } } : {}),
				...(about ? { about } : {}),
				confirm_label: cleanText(s.confirm_label),
				source_urls: s.source_urls,
			};
		}),
		legal,
		disclaimer: cleanText(raw.disclaimer),
		sources,
		cautions: raw.cautions.map(cleanText).filter(Boolean),
		dropped,
		official: sources.length > 0 && sources.every((s) => isGov(s.url)),
	};
}

/**
 * Read the Responses API's server-sent events: report each real stage once, as it happens,
 * and return the finished response. Chunks do not respect event boundaries.
 */
export async function readStream(body: ReadableStream<Uint8Array>, onStage: (s: WebStage) => void): Promise<{ output: unknown[] }> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let pages = 0;
	const told = new Set<string>();
	const tell = (s: WebStage) => {
		const key = s.stage === 'reading' ? `reading:${s.pages}` : s.stage;
		if (told.has(key)) return;
		told.add(key);
		onStage(s);
	};
	for (;;) {
		const { value, done } = await reader.read();
		if (value) buf += decoder.decode(value, { stream: true });
		let cut: number;
		while ((cut = buf.indexOf('\n\n')) >= 0) {
			const block = buf.slice(0, cut);
			buf = buf.slice(cut + 2);
			const event = block.match(/^event: (.+)$/m)?.[1];
			const data = block.match(/^data: (.+)$/m)?.[1];
			if (!event || !data) continue;
			if (event === 'response.web_search_call.searching') tell({ stage: 'searching' });
			else if (event === 'response.output_item.done') {
				const item = (JSON.parse(data) as { item?: { type?: string; action?: { sources?: unknown[] } } }).item;
				if (item?.type === 'web_search_call') {
					pages += item.action?.sources?.length ?? 0;
					if (pages) tell({ stage: 'reading', pages });
				}
			} else if (event === 'response.output_text.delta') tell({ stage: 'writing' });
			else if (event === 'response.completed') return (JSON.parse(data) as { response: { output: unknown[] } }).response;
			else if (event === 'response.failed' || event === 'error') throw new Error(`web search failed: ${event}`);
		}
		if (done) throw new Error('the stream ended without a response');
	}
}

/** The model's JSON, from the finished response's message. */
function answerText(output: unknown[]): string {
	for (const item of output as { type?: string; content?: { type?: string; text?: string }[] }[]) {
		if (item.type !== 'message') continue;
		for (const c of item.content ?? []) if (typeof c.text === 'string') return c.text;
	}
	return '';
}

/** Web answers run on the OpenAI routes only; Gemini has no web search here. */
export const webAllowed = (route: string): boolean => route === 'openai-ws' || route === 'openai-live' || route === 'cloudflare' || route === 'local';

export interface SearchWebOptions {
	apiKey: string;
	model?: string;
	fetch?: typeof fetch;
	onStage: (s: WebStage) => void;
	signal?: AbortSignal;
}

/**
 * One question, searched and answered. Errors say what failed and nothing else: neither the
 * question nor OpenAI's reply body reaches a log.
 */
export async function searchWeb(question: string, language: EntryLanguage, opts: SearchWebOptions): Promise<WebAnswer> {
	const res = await (opts.fetch ?? fetch)('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
		body: JSON.stringify(webRequestBody(question, language, opts.model)),
		...(opts.signal ? { signal: opts.signal } : {}),
	});
	if (!res.ok || !res.body) throw new Error(`web search ${res.status}`);
	const done = await readStream(res.body, opts.onStage);
	let raw: RawWebAnswer;
	try {
		raw = JSON.parse(answerText(done.output)) as RawWebAnswer;
		if (!Array.isArray(raw.steps) || !raw.legal || !Array.isArray(raw.sources)) throw new Error('shape');
	} catch {
		throw new Error('the reply was not a web answer');
	}
	return groundAnswer(raw, seenUrls(done.output));
}
