import type { ChatJson } from '../kb/translate';

const BASE = 'https://api.openai.com/v1';

export interface OpenAiOptions {
	apiKey: string;
	fetchImpl?: typeof fetch;
	/** 60 s. A translation of one card is a few hundred tokens; longer than this is a stall. */
	timeoutMs?: number;
}

/**
 * One OpenAI key for everything the product reasons with: hearing (the routes), writing a
 * card from a crawled page, retrieval embeddings, and translation.
 *
 * The owner's direction of 2026-09-19 — "the idea is by routes, lets do everything openai"
 * — replaces the split where retrieval and translation went through OpenRouter and only
 * hearing went direct. One account, one bill, one thing to top up (vault dec-suara-0022).
 */
export class OpenAi {
	private readonly doFetch: typeof fetch;
	private readonly headers: Record<string, string>;
	private readonly timeoutMs: number;

	constructor(opts: OpenAiOptions) {
		// Bound: workerd rejects a detached global fetch with "Illegal invocation".
		this.doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
		this.headers = { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' };
		this.timeoutMs = opts.timeoutMs ?? 60_000;
	}

	private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
		const res = await this.doFetch(`${BASE}${path}`, {
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
		if (!res.ok) throw new Error(`openai ${path} ${res.status}: ${json.error?.message ?? 'no message'}`);
		return json as Record<string, unknown>;
	}

	/**
	 * `dimensions` shortens the vector: the 3-series models are trained so a truncated
	 * vector still works, which keeps the stored index small. Passing 0 leaves it off, for
	 * models that have no such option.
	 */
	async embed(model: string, input: string[], dimensions: number): Promise<number[][]> {
		const json = (await this.post('/embeddings', {
			model,
			input,
			...(dimensions > 0 ? { dimensions } : {}),
		})) as { data?: { index: number; embedding: number[] }[] };
		if (!Array.isArray(json.data) || json.data.length !== input.length) {
			throw new Error(`openai embeddings: expected ${input.length} vectors, got ${json.data?.length ?? 0}`);
		}
		return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
	}

	/**
	 * The Responses endpoint, shaped like the `ChatJson` the translator already speaks, so
	 * moving vendor did not mean rewriting what depends on it.
	 */
	chatJson: ChatJson = async ({ model, system, user, schema }) => {
		const json = (await this.post('/responses', {
			model,
			instructions: system,
			input: user,
			max_output_tokens: 4000,
			// Translating or restructuring one card is not a thinking task, and every second of
			// it is someone waiting for a screen.
			reasoning: { effort: 'low' },
			...(schema ? { text: { format: { type: 'json_schema', name: 'reply', strict: true, schema } } } : {}),
		})) as {
			model?: string;
			output_text?: string;
			output?: { content?: { type?: string; text?: string }[] }[];
		};

		const parts: string[] = [];
		if (typeof json.output_text === 'string') parts.push(json.output_text);
		else for (const item of json.output ?? []) for (const c of item.content ?? []) if (typeof c.text === 'string') parts.push(c.text);
		const content = parts.join('');
		if (content.trim() === '') throw new Error(`openai ${model}: no content`);
		return { content, model: json.model ?? model };
	};
}
