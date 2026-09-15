import type { ChatJson } from '../kb/translate';

const BASE = 'https://openrouter.ai/api/v1';

export interface OpenRouterOptions {
	apiKey: string;
	fetchImpl?: typeof fetch;
	/** Shown in the OpenRouter dashboard against each request. */
	title?: string;
	/** 90 s: the slowest valid free translation in the probe took 67 s (vault obs-0030). */
	timeoutMs?: number;
}

/**
 * One OpenRouter key for search embeddings (Qwen3, dec-suara-0013) and translation
 * (DeepSeek then free models, dec-suara-0015).
 */
export class OpenRouter {
	private readonly doFetch: typeof fetch;
	private readonly headers: Record<string, string>;
	private readonly timeoutMs: number;

	constructor(opts: OpenRouterOptions) {
		// Bound: workerd rejects a detached global fetch with "Illegal invocation".
		this.doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
		this.headers = {
			Authorization: `Bearer ${opts.apiKey}`,
			'Content-Type': 'application/json',
			'X-Title': opts.title ?? 'Suara',
		};
		this.timeoutMs = opts.timeoutMs ?? 90_000;
	}

	private async post(path: string, body: unknown): Promise<any> {
		const res = await this.doFetch(`${BASE}${path}`, {
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
		if (!res.ok) throw new Error(`openrouter ${path} ${res.status}: ${json.error?.message ?? 'no message'}`);
		return json;
	}

	async embed(model: string, input: string[], dimensions: number): Promise<number[][]> {
		const json = (await this.post('/embeddings', { model, input, dimensions })) as {
			data?: { index: number; embedding: number[] }[];
		};
		if (!Array.isArray(json.data) || json.data.length !== input.length)
			throw new Error(`openrouter embeddings: expected ${input.length} vectors, got ${json.data?.length ?? 0}`);
		return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
	}

	chatJson: ChatJson = async ({ model, system, user, schema }) => {
		const json = (await this.post('/chat/completions', {
			model,
			temperature: 0.2,
			max_tokens: 4000,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
			...(schema
				? {
						response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema } },
						// Only route to providers that honour the schema.
						provider: { require_parameters: true },
						// Reasoning cost 1.3-5x more for the same checks (obs-0031).
						reasoning: { enabled: false },
					}
				: { reasoning: { effort: 'low' } }),
		})) as { model?: string; choices?: { message?: { content?: string } }[] };
		const content = json.choices?.[0]?.message?.content;
		if (typeof content !== 'string' || content.trim() === '') throw new Error(`openrouter ${model}: no content`);
		return { content, model: json.model ?? model };
	};
}
