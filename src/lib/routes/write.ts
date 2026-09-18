/**
 * The writer behind an on-demand card.
 *
 * When Tier B finds an official page that answers a question no entry covers, something has
 * to turn that page into a card. That is a text call, not a voice one, so it does not go
 * over the route's WebSocket — but it uses the same model the chosen route already uses, so
 * no new vendor and no new key enters the product (vault dec-suara-0016).
 *
 * OpenAI first, because `openai-ws` is the default route. Where there is no OpenAI key the
 * OpenRouter chat call stands in, with the same model family the translator rotation uses,
 * so a Gemini-only deployment still answers misses.
 */
import type { Writer } from '../kb/compose';

export interface WriterOptions {
	openaiKey?: string;
	openrouterKey?: string;
	/**
	 * One knob, `SUARA_WRITE_MODEL`. A `gpt-` name goes to OpenAI, anything else to
	 * OpenRouter, so switching vendor is switching one string.
	 */
	model?: string;
	fetchImpl?: typeof fetch;
}

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** gpt-5.6-luna: $0.20 / $1.20 per M tokens (OpenRouter catalogue, 2026-09-18). */
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
/**
 * gemini-3.5-flash-lite: $0.30 / $2.50 per M tokens (OpenRouter catalogue, 2026-09-18).
 *
 * Chosen on measurement, not on price. `scripts/kb/bench-write.ts` wrote the same three
 * cards from the same crawled pages with each candidate:
 *
 *   gemini-3.5-flash-lite   3/3 usable first time   median 1.9 s
 *   gpt-5.6-luna            2/3                     median 7.1 s
 *   deepseek-v4.1-flash     0/3                     median 22.3 s
 *   deepseek-v4-flash       0/3                     median 28.5 s
 *
 * A card costs about a tenth of a cent either way and is written once, then kept. Nine
 * seconds of a person holding a phone is the thing actually being bought here.
 */
export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.5-flash-lite';

/**
 * One card is a few hundred tokens, but on the gpt-5 family reasoning tokens are drawn from
 * the same budget: at 1,200 the model spent it thinking and the reply arrived truncated,
 * which reads as "the reply was not a card". The cap is there to stop a runaway, not to trim.
 */
const MAX_TOKENS = 2500;

function textFromResponses(body: unknown): string {
	const b = body as {
		output_text?: string;
		output?: { content?: { type?: string; text?: string }[] }[];
	};
	if (typeof b.output_text === 'string' && b.output_text.trim()) return b.output_text;
	const parts: string[] = [];
	for (const item of b.output ?? []) {
		for (const c of item.content ?? []) if (typeof c.text === 'string') parts.push(c.text);
	}
	return parts.join('');
}

export function openaiWriter(key: string, model = DEFAULT_OPENAI_MODEL, fetchImpl: typeof fetch = fetch): Writer {
	return async (prompt) => {
		const res = await fetchImpl(OPENAI_URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
			body: JSON.stringify({
				model,
				input: prompt,
				max_output_tokens: MAX_TOKENS,
				// Choosing and ordering lines from one page is not a thinking task, and every
				// second of it is someone holding a phone waiting.
				reasoning: { effort: 'low' },
			}),
		});
		if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
		return textFromResponses(await res.json());
	};
}

export function openrouterWriter(key: string, model = DEFAULT_OPENROUTER_MODEL, fetchImpl: typeof fetch = fetch): Writer {
	return async (prompt) => {
		const res = await fetchImpl(OPENROUTER_URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
			body: JSON.stringify({
				model,
				messages: [{ role: 'user', content: prompt }],
				max_tokens: MAX_TOKENS,
				response_format: { type: 'json_object' },
			}),
		});
		if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
		const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
		return body.choices?.[0]?.message?.content ?? '';
	};
}

/**
 * Vendor failures that the other vendor can absorb: no credit, a bad key, a rate limit.
 * A wrong model name or a malformed request would fail the same way twice, so it is not
 * retried elsewhere.
 */
const HAND_OVER = /\b(401|402|429|5\d\d)\b/;

/** Try the chosen writer; hand over to the other vendor if it cannot be paid. */
function chain(first: Writer, second: Writer): Writer {
	return async (prompt) => {
		try {
			return await first(prompt);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (!HAND_OVER.test(message)) throw err;
			console.error('writer handing over to the other vendor:', message.slice(0, 120));
			return await second(prompt);
		}
	};
}

/**
 * The writer this deployment can use, or nothing — in which case a miss stays a miss.
 *
 * Both keys present means both are used: the chosen model first, the other vendor when the
 * first cannot be paid. An OpenRouter balance of -$0.09 took the whole product down with it
 * on 2026-09-18, which is a bad way to learn that one account is a single point of failure.
 */
export function writerFor(opts: WriterOptions): Writer | undefined {
	const openai = opts.model?.startsWith('gpt-');
	const viaOpenai = opts.openaiKey ? openaiWriter(opts.openaiKey, openai ? opts.model : undefined, opts.fetchImpl) : undefined;
	const viaOpenrouter = opts.openrouterKey
		? openrouterWriter(opts.openrouterKey, openai ? undefined : opts.model, opts.fetchImpl)
		: undefined;

	const chosen = openai ? viaOpenai ?? viaOpenrouter : viaOpenrouter ?? viaOpenai;
	const other = chosen === viaOpenai ? viaOpenrouter : viaOpenai;
	if (!chosen) return undefined;
	return other ? chain(chosen, other) : chosen;
}
