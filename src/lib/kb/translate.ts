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
export const DEFAULT_TRANSLATORS: Translator[] = [
	{ model: 'deepseek/deepseek-v4.1-flash', structured: true },
	{ model: 'nex-agi/nex-n2.5-pro:free', structured: false },
	{ model: 'nvidia/nemotron-3-ultra-550b-a55b:free', structured: false },
	{ model: 'google/gemma-4-31b-it:free', structured: false },
	{ model: 'google/gemma-4-26b-a4b-it:free', structured: false },
	{ model: 'poolside/laguna-s-2.1:free', structured: false },
];

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
	steps: { name: string; text: string; confirm_label: string; action_label?: string }[];
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
			confirm_label: s.confirm_label,
			...(s.action ? { action_label: s.action.label } : {}),
		})),
		...(e.action ? { action_label: e.action.label } : {}),
		example_phrasings: [...e.search.example_phrasings],
	};
}

const Reply = z.object({
	title: z.object({ short: z.string(), full: z.string() }),
	summary: z.string(),
	details: z.array(z.object({ heading: z.string(), body: z.string() })).default([]),
	steps: z
		.array(z.object({ name: z.string(), text: z.string(), confirm_label: z.string(), action_label: z.string().optional() }))
		.default([]),
	action_label: z.string().optional(),
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

function replySchema(): Record<string, unknown> {
	return {
		type: 'object',
		additionalProperties: false,
		required: ['title', 'summary', 'details', 'steps', 'example_phrasings'],
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
					required: ['name', 'text', 'confirm_label'],
					properties: { name: str(40), text: str(300), confirm_label: str(24), action_label: str(24) },
				},
			},
			action_label: str(24),
			example_phrasings: { type: 'array', items: str(120) },
		},
	};
}

function systemPrompt(language: EntryLanguage, structured: boolean): string {
	return [
		`You translate Singapore government answers into ${LANGUAGE_NAME[language]} for older readers.`,
		'Plain, short, warm wording. Keep names of schemes, hospitals, forms and phone numbers recognisable.',
		'Keep the same number of details, steps and example phrasings, in the same order. Keep action_label only where the input has one.',
		'Limits: title.short 16 characters, title.full 60, summary 140, detail heading 40, step name 40, confirm_label and action_label 24.',
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
