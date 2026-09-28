import { z } from 'zod';

/**
 * The runtime copy of `docs/knowledge-base/entry.schema.json`.
 *
 * JSON Schema compilers generate code at runtime, which Cloudflare Workers forbid, and
 * zod's own JSON Schema reader does not support the schema's if/then/else. So the rules
 * are written twice, and `entry.test.ts` runs the same valid and invalid entries through
 * both. Change one, change the other in the same commit.
 */
export const SCHEMA_VERSION = '1.1.0';

export const ENTRY_LANGUAGES = ['en', 'zh-Hans'] as const;
export const EntryLanguage = z.enum(ENTRY_LANGUAGES);
export type EntryLanguage = z.infer<typeof EntryLanguage>;

/** Languages an English original can be translated into on need. */
export const TRANSLATABLE = ['zh-Hans'] as const;

const ENTRY_ID = /^sg\.[a-z0-9]+\.[a-z0-9]+(-[a-z0-9]+)*$/;
const QUOTE_ID = /^q[0-9]+$/;
const SOURCE_ID = /^src[0-9]+$/;
const PUBLISHER_CODE = /^[A-Z][A-Z0-9]{1,11}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const TAG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const text = (min: number, max?: number) => (max === undefined ? z.string().min(min) : z.string().min(min).max(max));
const dateTime = () => z.iso.datetime({ offset: true });
const unique = <T>(items: T[]) => new Set(items).size === items.length;
const uniqueArray = <T extends z.ZodType>(item: T) =>
	z.array(item).refine((xs) => unique(xs), { message: 'items must be unique' });

const QuoteRefs = uniqueArray(z.string().regex(QUOTE_ID)).check(z.minLength(1));

const Action = z.strictObject({
	type: z.enum(['start-steps', 'call', 'open-website', 'go-to-place', 'bring-items', 'none']),
	label: text(1, 24),
	value: z.string().max(300).optional(),
	quote_refs: QuoteRefs.optional(),
});

/**
 * A step in points (owner, 2026-09-29; vault obs-0073): an optional lead-in the points
 * complete, then one to four short sentences, one idea each. Reshaped from the step's own
 * quote, so it cites nothing of its own.
 */
const Points = z.strictObject({
	lead: text(1, 60).optional(),
	items: z.array(text(1, 140)).min(1).max(4),
});

/** More about a step: at most two sentences, the bottom line first, citing its own quote. */
const About = z.strictObject({
	text: text(1, 280),
	quote_refs: QuoteRefs,
});

const Step = z.strictObject({
	position: z.int().min(1),
	name: text(1, 40),
	text: text(1, 300),
	points: Points.optional(),
	about: About.optional(),
	confirm_label: text(1, 24),
	action: Action.optional(),
	quote_refs: QuoteRefs,
});

const Detail = z.strictObject({
	heading: text(1, 40),
	body: text(1, 600),
	quote_refs: QuoteRefs,
});

const TranslationOf = z.strictObject({
	id: z.string().regex(ENTRY_ID),
	version: z.int().min(1),
});

const TranslationRecord = z.strictObject({
	from_version: z.int().min(1),
	at: dateTime(),
});
export type TranslationRecord = z.infer<typeof TranslationRecord>;

const Source = z.strictObject({
	id: z.string().regex(SOURCE_ID),
	publisher: z.string().regex(PUBLISHER_CODE),
	url: z.url().regex(/^https:\/\//),
	page_title: text(1, 300),
	source_modified_at: z.iso.date().nullable().optional(),
	retrieved_at: dateTime(),
	content_hash: z.string().regex(SHA256).optional(),
});

const Quote = z.strictObject({
	id: z.string().regex(QUOTE_ID),
	source: z.string().regex(SOURCE_ID),
	text: text(1, 2000),
});

const ModelStep = z.strictObject({
	method: z.enum(['model', 'manual']),
	model: z.string().nullable().optional(),
	prompt_version: z.string().nullable().optional(),
	at: dateTime(),
});

const Check = z.strictObject({
	type: z.enum(['quotes-found', 'url-live', 'source-unchanged', 'refs-resolve', 'lengths', 'translation-matches-original']),
	passed: z.boolean(),
	at: dateTime(),
	note: z.string().max(300).optional(),
});

export const Entry = z
	.strictObject({
		schema_version: z.literal(SCHEMA_VERSION),
		id: z.string().regex(ENTRY_ID),
		kind: z.enum(['answer', 'process']),
		language: EntryLanguage,
		translation_of: TranslationOf.nullable().optional(),
		translations: z.partialRecord(z.enum(TRANSLATABLE), TranslationRecord).optional(),
		title: z.strictObject({ short: text(1, 16), full: text(1, 60) }),
		summary: z.strictObject({ text: text(1, 140), quote_refs: QuoteRefs }),
		details: z.array(Detail).max(8).optional(),
		steps: z.array(Step).min(1).max(12).optional(),
		action: Action.optional(),
		topic: z.strictObject({
			area: z.enum(['health', 'cpf-and-support', 'scams', 'transport', 'bills-and-housing', 'digital-services']),
			tags: uniqueArray(z.string().regex(TAG)).check(z.maxLength(12)).optional(),
		}),
		audience: z
			.strictObject({
				min_age: z.int().min(0).max(120).optional(),
				residency: uniqueArray(z.enum(['citizen', 'permanent-resident', 'foreigner'])).optional(),
				card_holders: uniqueArray(
					z.enum(['pioneer-generation', 'merdeka-generation', 'chas-blue', 'chas-orange', 'chas-green']),
				).optional(),
			})
			.optional(),
		search: z.strictObject({
			example_phrasings: z.array(text(3, 120)).min(3).max(12),
			keywords: uniqueArray(text(2, 40)).check(z.maxLength(20)).optional(),
		}),
		sources: z.array(Source).min(1),
		quotes: z.array(Quote).min(1),
		provenance: z.strictObject({
			collected: z.strictObject({
				method: z.enum(['web-search', 'sitemap-crawl', 'manual']),
				model: z.string().nullable().optional(),
				at: dateTime(),
			}),
			structured: ModelStep,
			translated: ModelStep.required({ model: true }).optional(),
		}),
		verification: z.strictObject({
			status: z.enum(['draft', 'grounded', 'stale', 'withdrawn']),
			checks: z.array(Check),
			next_check_due: z.iso.date().nullable().optional(),
		}),
		lifecycle: z.strictObject({
			version: z.int().min(1),
			created_at: dateTime(),
			updated_at: dateTime(),
			supersedes_version: z.int().min(1).nullable().optional(),
			content_hash: z.string().regex(SHA256).optional(),
		}),
		related: uniqueArray(z.string().regex(ENTRY_ID)).check(z.maxLength(6)).optional(),
	})
	.superRefine((e, ctx) => {
		if (e.kind === 'process' && !e.steps) ctx.addIssue({ code: 'custom', path: ['steps'], message: 'a process needs steps' });
		if (e.kind === 'answer' && e.steps) ctx.addIssue({ code: 'custom', path: ['steps'], message: 'an answer has no steps' });

		const isTranslation = e.translation_of != null;
		if (isTranslation && !e.provenance.translated)
			ctx.addIssue({ code: 'custom', path: ['provenance', 'translated'], message: 'a translation must say how it was translated' });
		if (isTranslation && e.translations)
			ctx.addIssue({ code: 'custom', path: ['translations'], message: 'only originals list translations' });
		if (!isTranslation && e.provenance.translated)
			ctx.addIssue({ code: 'custom', path: ['provenance', 'translated'], message: 'an original was not translated' });
	});

export type Entry = z.infer<typeof Entry>;

export type ParsedEntry = { ok: true; entry: Entry } | { ok: false; errors: string[] };

/** Validate anything claiming to be an entry: a stored row, a pipeline output, a model reply. */
export function parseEntry(input: unknown): ParsedEntry {
	const result = Entry.safeParse(input);
	if (result.success) return { ok: true, entry: result.data };
	return { ok: false, errors: result.error.issues.map((i) => `${i.path.join('.') || '(entry)'}: ${i.message}`) };
}
