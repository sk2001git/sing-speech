import { z } from 'zod';
import { parseEntry, type Entry, type EntryLanguage } from './entry';
import { checkTranslation } from './grounding';

/**
 * Translation on need (vault dec-suara-0012, dec-suara-0014, dec-suara-0015).
 *
 * The model sees only what a person reads. Code rebuilds the translated entry around the
 * original's quotes, sources, references and step positions, so a model cannot change the
 * evidence even by accident — then the result must pass the same checks as any entry.
 */
export const TRANSLATE_PROMPT_VERSION = 'translate-1';

export interface Translator {
	model: string;
	/** Whether the model honours `response_format: json_schema`. Free models mostly do not. */
	structured: boolean;
}

/** DeepSeek first (obs-0031); free models that answered in the probe after it (obs-0030). */
/**
 * One vendor, cheapest first (OpenAI list prices, read 2026-09-19; gpt-6-luna OpenRouter catalogue and Artificial Analysis, 2026-09-29).
 *
 *   gpt-6-luna     $0.10 / $0.50 per M tokens
 *   gpt-5.4-nano   $0.20 / $1.25
 *   gpt-5.4-mini   $0.75 / $4.50
 *
 * The rotation stays because a translation that fails validation is retried elsewhere, not
 * shown. It no longer crosses vendors: the owner's direction of 2026-09-19 was one route,
 * OpenAI, cheapest luna (vault dec-suara-0022).
 */
export const DEFAULT_TRANSLATORS: Translator[] = [
	{ model: 'gpt-6-luna', structured: true },
	{ model: 'gpt-5.4-nano', structured: true },
	{ model: 'gpt-5.4-mini', structured: true },
];

/** The Cloudflare route: gpt-6-luna only (owner, 2026-09-27: "use openai luna 6 only"; plan-suara-0016). */
export const LUNA_6_TRANSLATORS: Translator[] = [{ model: 'gpt-6-luna', structured: true }];

export type ChatJson = (req: {
	model: string;
	system: string;
	user: string;
	/** A JSON Schema to hold the reply to, or absent for plain-JSON prompting. */
	schema?: Record<string, unknown>;
}) => Promise<{ content: string; model: string }>;

const LANGUAGE_NAME: Record<EntryLanguage, string> = {
	en: 'English',
	'zh-Hans': 'Simplified Chinese',
};

export interface DisplayText {
	title: { short: string; full: string };
	summary: string;
	details: { heading: string; body: string }[];
	/** `points` is empty and `points_lead` and `about` null where the original has none. */
	steps: { name: string; text: string; points_lead: string | null; points: string[]; about: string | null; confirm_label: string; action_label?: string }[];
	action_label?: string;
	example_phrasings: string[];
}

export function displayText(e: Entry): DisplayText {
	return {
		title: { short: e.title.short, full: e.title.full },
		summary: e.summary.text,
		details: (e.details ?? []).map((d) => ({ heading: d.heading, body: d.body })),
		steps: (e.steps ?? []).map((s) => ({
			name: s.name,
			text: s.text,
			points_lead: s.points?.lead ?? null,
			points: s.points?.items ?? [],
			about: s.about?.text ?? null,
			confirm_label: s.confirm_label,
			...(s.action ? { action_label: s.action.label } : {}),
		})),
		...(e.action ? { action_label: e.action.label } : {}),
		example_phrasings: [...e.search.example_phrasings],
	};
}

/**
 * "There is no action here" arrives as `null` from a strict schema and as an absent key
 * from a plain-JSON model. Both mean the same thing, and rejecting the first threw away
 * every translation OpenAI produced.
 */
const optionalLabel = z
	.string()
	.nullish()
	.transform((v) => v ?? undefined);

const Reply = z.object({
	title: z.object({ short: z.string(), full: z.string() }),
	summary: z.string(),
	details: z.array(z.object({ heading: z.string(), body: z.string() })).default([]),
	steps: z
		.array(
			z.object({
				name: z.string(),
				text: z.string(),
				points_lead: optionalLabel,
				points: z.array(z.string()).default([]),
				about: optionalLabel,
				confirm_label: z.string(),
				action_label: optionalLabel,
			}),
		)
		.default([]),
	action_label: optionalLabel,
	example_phrasings: z.array(z.string()),
});

export type Applied = { ok: true; entry: Entry } | { ok: false; reason: string };

function countProblems(original: Entry, r: z.infer<typeof Reply>): string[] {
	const problems: string[] = [];
	const details = original.details?.length ?? 0;
	const steps = original.steps ?? [];
	if (r.details.length !== details) problems.push(`details: got ${r.details.length}, expected ${details}`);
	if (r.steps.length !== steps.length) problems.push(`steps: got ${r.steps.length}, expected ${steps.length}`);
	steps.forEach((s, i) => {
		const reply = r.steps[i];
		if (reply && !!s.action !== !!reply.action_label) problems.push(`step ${i + 1}: action label presence differs`);
		if (!reply) return;
		const points = s.points?.items.length ?? 0;
		if (reply.points.length !== points) problems.push(`step ${i + 1}: points: got ${reply.points.length}, expected ${points}`);
		if (!!s.points?.lead !== !!reply.points_lead) problems.push(`step ${i + 1}: points lead-in presence differs`);
		if (!!s.about !== !!reply.about) problems.push(`step ${i + 1}: "more" presence differs`);
	});
	if (!!original.action !== !!r.action_label) problems.push('action label presence differs');
	if (r.example_phrasings.length !== original.search.example_phrasings.length)
		problems.push(`example_phrasings: got ${r.example_phrasings.length}, expected ${original.search.example_phrasings.length}`);
	return problems;
}

export function applyTranslation(original: Entry, reply: unknown, language: EntryLanguage, model: string, at: string): Applied {
	const parsed = Reply.safeParse(reply);
	if (!parsed.success) return { ok: false, reason: `reply shape: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}` };
	const r = parsed.data;
	const counts = countProblems(original, r);
	if (counts.length > 0) return { ok: false, reason: counts.join('; ') };

	const t = structuredClone(original);
	delete t.translations;
	t.language = language;
	t.translation_of = { id: original.id, version: original.lifecycle.version };
	t.title = { short: r.title.short, full: r.title.full };
	t.summary = { ...t.summary, text: r.summary };
	if (t.details) t.details = t.details.map((d, i) => ({ ...d, heading: r.details[i]!.heading, body: r.details[i]!.body }));
	if (t.steps) {
		t.steps = t.steps.map((s, i) => {
			const rs = r.steps[i]!;
			return {
				...s,
				name: rs.name,
				text: rs.text,
				...(s.points ? { points: { ...(rs.points_lead ? { lead: rs.points_lead } : {}), items: rs.points } } : {}),
				...(s.about ? { about: { ...s.about, text: rs.about! } } : {}),
				confirm_label: rs.confirm_label,
				...(s.action ? { action: { ...s.action, label: rs.action_label! } } : {}),
			};
		});
	}
	if (t.action) t.action = { ...t.action, label: r.action_label! };
	t.search = { ...t.search, example_phrasings: r.example_phrasings };
	t.provenance = { ...t.provenance, translated: { method: 'model', model, prompt_version: TRANSLATE_PROMPT_VERSION, at } };
	t.lifecycle = { version: 1, created_at: at, updated_at: at };
	t.verification = { status: 'draft', checks: [] };

	const valid = parseEntry(t);
	if (!valid.ok) return { ok: false, reason: valid.errors.join('; ') };
	const check = checkTranslation(original, valid.entry, at);
	if (!check.passed) return { ok: false, reason: check.note ?? 'does not match the original' };

	// A translation carries the original's evidence, so it is as grounded as the original.
	valid.entry.verification = { status: original.verification.status === 'grounded' ? 'grounded' : 'draft', checks: [check] };
	return { ok: true, entry: valid.entry };
}

const str = (max?: number) => (max ? { type: 'string', minLength: 1, maxLength: max } : { type: 'string', minLength: 1 });

/**
 * Optional, the way a strict schema has to say it.
 *
 * OpenAI rejects a schema whose `required` omits any property — "'required' is required to
 * be supplied and to be an array including every key in properties" — so an optional field
 * is listed as required and allowed to be null. Leaving `action_label` merely absent from
 * `required` made every translation fail with a 400 and showed the Chinese reader six
 * English cards.
 */
const orNull = (schema: Record<string, unknown>) => ({ ...schema, type: [schema.type, 'null'] });

function replySchema(): Record<string, unknown> {
	return {
		type: 'object',
		additionalProperties: false,
		required: ['title', 'summary', 'details', 'steps', 'action_label', 'example_phrasings'],
		properties: {
			title: { type: 'object', additionalProperties: false, required: ['short', 'full'], properties: { short: str(16), full: str(60) } },
			summary: str(140),
			details: {
				type: 'array',
				items: { type: 'object', additionalProperties: false, required: ['heading', 'body'], properties: { heading: str(40), body: str(600) } },
			},
			steps: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					required: ['name', 'text', 'points_lead', 'points', 'about', 'confirm_label', 'action_label'],
					properties: {
						name: str(40),
						text: str(300),
						points_lead: orNull(str(60)),
						points: { type: 'array', items: str(200) },
						about: orNull(str(280)),
						confirm_label: str(24),
						action_label: orNull(str(24)),
					},
				},
			},
			action_label: orNull(str(24)),
			example_phrasings: { type: 'array', items: str(120) },
		},
	};
}

function systemPrompt(language: EntryLanguage, structured: boolean): string {
	return [
		`You translate Singapore government answers into ${LANGUAGE_NAME[language]} for older readers.`,
		'Plain, short, warm wording. Keep names of schemes, hospitals, forms and phone numbers recognisable.',
		'Keep the same number of details, steps, points in each step and example phrasings, in the same order. Keep action_label, points_lead and about only where the input has one, and null otherwise.',
		'Limits: title.short 16 characters, title.full 60, summary 140, detail heading 40, step name 40, each point 200, points_lead 60, about 280 and at most two sentences, confirm_label and action_label 24.',
		'Example phrasings should sound like how an older Singaporean would say it aloud in that language.',
		structured ? '' : 'Reply with the JSON only, with exactly the same keys as the input. No explanation, no code fence.',
	]
		.filter(Boolean)
		.join(' ');
}

const stripFence = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

/** Try each translator in order; the first reply that validates is the translation. */
export async function translateEntry(
	original: Entry,
	language: EntryLanguage,
	translators: readonly Translator[],
	chat: ChatJson,
	at: string,
): Promise<Entry | null> {
	const user = JSON.stringify(displayText(original));
	for (const tr of translators) {
		try {
			const reply = await chat({
				model: tr.model,
				system: systemPrompt(language, tr.structured),
				user,
				...(tr.structured ? { schema: replySchema() } : {}),
			});
			const applied = applyTranslation(original, JSON.parse(stripFence(reply.content)), language, reply.model || tr.model, at);
			if (applied.ok) return applied.entry;
			console.warn(`translation of ${original.id} by ${tr.model} rejected: ${applied.reason}`);
		} catch (err) {
			console.warn(`translation of ${original.id} by ${tr.model} failed:`, err instanceof Error ? err.message : err);
		}
	}
	return null;
}
