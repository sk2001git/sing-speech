import { describe, expect, it } from 'vitest';
import { OpenAi } from './openai';

const respondWith = (body: unknown, status = 200) => {
	const seen: { url: string; body: Record<string, unknown> }[] = [];
	const impl = (async (url: string, init: RequestInit) => {
		seen.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	}) as unknown as typeof fetch;
	return { seen, impl };
};

describe('embed', () => {
	it('returns one vector per input, in the order asked', async () => {
		const { seen, impl } = respondWith({
			data: [
				{ index: 1, embedding: [0, 1] },
				{ index: 0, embedding: [1, 0] },
			],
		});
		const openai = new OpenAi({ apiKey: 'k', fetchImpl: impl });
		expect(await openai.embed('text-embedding-3-small', ['first', 'second'], 768)).toEqual([
			[1, 0],
			[0, 1],
		]);
		expect(seen[0]!.url).toBe('https://api.openai.com/v1/embeddings');
		expect(seen[0]!.body).toMatchObject({ model: 'text-embedding-3-small', dimensions: 768 });
	});

	it('refuses a reply with the wrong number of vectors rather than mismatching them', async () => {
		const { impl } = respondWith({ data: [{ index: 0, embedding: [1, 0] }] });
		const openai = new OpenAi({ apiKey: 'k', fetchImpl: impl });
		await expect(openai.embed('text-embedding-3-small', ['first', 'second'], 768)).rejects.toThrow(/expected 2/);
	});

	it('says which vendor failed and why', async () => {
		const { impl } = respondWith({ error: { message: 'insufficient_quota' } }, 429);
		const openai = new OpenAi({ apiKey: 'k', fetchImpl: impl });
		await expect(openai.embed('text-embedding-3-small', ['x'], 768)).rejects.toThrow(/openai .*429.*insufficient_quota/);
	});

	it('does not send a dimensions field to a model that has no use for one', async () => {
		const { seen, impl } = respondWith({ data: [{ index: 0, embedding: [1] }] });
		const openai = new OpenAi({ apiKey: 'k', fetchImpl: impl });
		await openai.embed('text-embedding-ada-002', ['x'], 0);
		expect(seen[0]!.body.dimensions).toBeUndefined();
	});
});

describe('chatJson', () => {
	it('asks the Responses endpoint and returns the text', async () => {
		const { seen, impl } = respondWith({ output_text: '{"ok":true}', model: 'gpt-5.6-luna' });
		const openai = new OpenAi({ apiKey: 'k', fetchImpl: impl });
		const got = await openai.chatJson({ model: 'gpt-5.6-luna', system: 'be brief', user: 'translate this' });
		expect(got).toEqual({ content: '{"ok":true}', model: 'gpt-5.6-luna' });
		expect(seen[0]!.url).toBe('https://api.openai.com/v1/responses');
		expect(String(seen[0]!.body.input)).toContain('translate this');
		expect(String(seen[0]!.body.instructions)).toContain('be brief');
	});

	it('reads the text out of the output array when there is no output_text', async () => {
		const { impl } = respondWith({ output: [{ content: [{ type: 'output_text', text: '{"a":1}' }] }] });
		const openai = new OpenAi({ apiKey: 'k', fetchImpl: impl });
		expect((await openai.chatJson({ model: 'gpt-5.6-luna', system: 's', user: 'u' })).content).toBe('{"a":1}');
	});

	it('asks for the schema the caller wants, so a translation comes back in one shape', async () => {
		const { seen, impl } = respondWith({ output_text: '{}' });
		const openai = new OpenAi({ apiKey: 'k', fetchImpl: impl });
		const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false };
		await openai.chatJson({ model: 'gpt-5.6-luna', system: 's', user: 'u', schema });
		expect(seen[0]!.body.text).toMatchObject({ format: { type: 'json_schema', name: 'reply', strict: true, schema } });
	});

	it('refuses an empty reply rather than passing nothing on', async () => {
		const { impl } = respondWith({ output_text: '   ' });
		const openai = new OpenAi({ apiKey: 'k', fetchImpl: impl });
		await expect(openai.chatJson({ model: 'gpt-5.6-luna', system: 's', user: 'u' })).rejects.toThrow(/no content/);
	});
});
