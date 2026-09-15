import { describe, expect, it } from 'vitest';
import { OpenRouter } from './openrouter';

type Call = { url: string; init: RequestInit; body: Record<string, any> };

function fakeFetch(respond: (call: Call) => { status?: number; json: unknown }) {
	const calls: Call[] = [];
	const impl = (async (url: string, init: RequestInit) => {
		const call = { url, init, body: JSON.parse(String(init.body)) };
		calls.push(call);
		const r = respond(call);
		return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
	}) as unknown as typeof fetch;
	return { impl, calls };
}

describe('OpenRouter.embed', () => {
	it('asks for the model and dimensions, and returns vectors in input order', async () => {
		const { impl, calls } = fakeFetch(() => ({
			json: { data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] },
		}));
		const or = new OpenRouter({ apiKey: 'k', fetchImpl: impl });
		const vectors = await or.embed('qwen/qwen3-embedding-8b', ['a', 'b'], 768);
		expect(vectors).toEqual([[1, 0], [0, 1]]);
		expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/embeddings');
		expect(calls[0]!.body).toMatchObject({ model: 'qwen/qwen3-embedding-8b', input: ['a', 'b'], dimensions: 768 });
		expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer k');
	});

	it('fails loudly on an error status', async () => {
		const { impl } = fakeFetch(() => ({ status: 402, json: { error: { message: 'Insufficient credits' } } }));
		await expect(new OpenRouter({ apiKey: 'k', fetchImpl: impl }).embed('m', ['a'], 768)).rejects.toThrow(/402/);
	});
});

describe('OpenRouter.chatJson', () => {
	const ok = { json: { model: 'deepseek/deepseek-v4.1-flash', choices: [{ message: { content: '{"a":1}' } }] } };

	it('holds a structured model to the schema, on providers that support it, with reasoning off', async () => {
		const { impl, calls } = fakeFetch(() => ok);
		const or = new OpenRouter({ apiKey: 'k', fetchImpl: impl });
		const reply = await or.chatJson({ model: 'deepseek/deepseek-v4.1-flash', system: 's', user: 'u', schema: { type: 'object' } });
		expect(reply).toEqual({ content: '{"a":1}', model: 'deepseek/deepseek-v4.1-flash' });
		expect(calls[0]!.body).toMatchObject({
			response_format: { type: 'json_schema', json_schema: { strict: true, schema: { type: 'object' } } },
			provider: { require_parameters: true },
			reasoning: { enabled: false },
		});
	});

	it('sends no response_format to a model prompted for plain JSON', async () => {
		const { impl, calls } = fakeFetch(() => ok);
		await new OpenRouter({ apiKey: 'k', fetchImpl: impl }).chatJson({ model: 'nex-agi/nex-n2.5-pro:free', system: 's', user: 'u' });
		expect(calls[0]!.body.response_format).toBeUndefined();
		expect(calls[0]!.body.reasoning).toEqual({ effort: 'low' });
	});

	it('treats a 200 with no content as a failure', async () => {
		const { impl } = fakeFetch(() => ({ json: { choices: [{ message: { content: '' } }] } }));
		await expect(new OpenRouter({ apiKey: 'k', fetchImpl: impl }).chatJson({ model: 'm', system: 's', user: 'u' })).rejects.toThrow(
			/no content/,
		);
	});
});
