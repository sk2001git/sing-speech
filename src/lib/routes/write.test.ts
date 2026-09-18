import { describe, expect, it } from 'vitest';
import { openaiWriter, openrouterWriter, writerFor } from './write';

const reply = (body: unknown, status = 200) =>
	(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('openaiWriter', () => {
	it('reads the card out of a Responses reply', async () => {
		const write = openaiWriter('k', 'gpt-5.6-luna', reply({ output_text: '{"kind":"answer"}' }));
		expect(await write('prompt')).toBe('{"kind":"answer"}');
	});

	it('reads it out of the output array when there is no output_text', async () => {
		const body = { output: [{ content: [{ type: 'output_text', text: '{"kind":' }, { type: 'output_text', text: '"answer"}' }] }] };
		expect(await openaiWriter('k', 'gpt-5.6-luna', reply(body))('prompt')).toBe('{"kind":"answer"}');
	});

	it('says which vendor failed and why', async () => {
		const write = openaiWriter('k', 'gpt-5.6-luna', reply({ error: { message: 'no credit' } }, 402));
		await expect(write('prompt')).rejects.toThrow(/openai 402/);
	});

	it('sends the prompt and the model, and nothing about a person', async () => {
		let sent: { model?: string; input?: string } = {};
		const spy = (async (_url: string, init: RequestInit) => {
			sent = JSON.parse(String(init.body)) as typeof sent;
			return new Response(JSON.stringify({ output_text: '{}' }), { status: 200 });
		}) as unknown as typeof fetch;
		await openaiWriter('k', 'gpt-5.6-luna', spy)('write the card');
		expect(sent.model).toBe('gpt-5.6-luna');
		expect(sent.input).toBe('write the card');
	});
});

describe('openrouterWriter', () => {
	it('reads the card out of a chat reply', async () => {
		const body = { choices: [{ message: { content: '{"kind":"process"}' } }] };
		expect(await openrouterWriter('k', 'deepseek/deepseek-v4.1-flash', reply(body))('prompt')).toBe('{"kind":"process"}');
	});
});

describe('writerFor', () => {
	const seen = () => {
		const calls: { url: string; body: { model?: string } }[] = [];
		const impl = (async (url: string, init: RequestInit) => {
			calls.push({ url, body: JSON.parse(String(init.body)) as { model?: string } });
			return new Response(JSON.stringify({ output_text: '{}', choices: [{ message: { content: '{}' } }] }), { status: 200 });
		}) as unknown as typeof fetch;
		return { calls, impl };
	};

	it('uses the measured default writer when no model is named', async () => {
		const { calls, impl } = seen();
		await writerFor({ openaiKey: 'a', openrouterKey: 'b', fetchImpl: impl })!('p');
		expect(calls[0]!.url).toContain('openrouter');
		expect(calls[0]!.body.model).toBe('google/gemini-3.5-flash-lite');
	});

	it('sends a gpt- model to OpenAI, which is the one knob for switching vendor', async () => {
		const { calls, impl } = seen();
		await writerFor({ openaiKey: 'a', openrouterKey: 'b', model: 'gpt-5.6-luna', fetchImpl: impl })!('p');
		expect(calls[0]!.url).toContain('api.openai.com');
		expect(calls[0]!.body.model).toBe('gpt-5.6-luna');
	});

	it('sends any other model name to OpenRouter', async () => {
		const { calls, impl } = seen();
		await writerFor({ openrouterKey: 'b', model: 'google/gemini-3.8-flash', fetchImpl: impl })!('p');
		expect(calls[0]!.body.model).toBe('google/gemini-3.8-flash');
	});

	it('falls back to OpenAI when that is the only key, even for a named OpenRouter model', async () => {
		const { calls, impl } = seen();
		await writerFor({ openaiKey: 'a', model: 'google/gemini-3.5-flash-lite', fetchImpl: impl })!('p');
		expect(calls[0]!.url).toContain('api.openai.com');
		expect(calls[0]!.body.model).toBe('gpt-5.6-luna');
	});

	it('hands over to the other vendor when the first cannot be paid', async () => {
		const calls: string[] = [];
		const impl = (async (url: string) => {
			calls.push(url);
			if (url.includes('openrouter')) {
				return new Response(JSON.stringify({ error: { message: 'add credits' } }), { status: 402 });
			}
			return new Response(JSON.stringify({ output_text: '{"kind":"answer"}' }), { status: 200 });
		}) as unknown as typeof fetch;
		const write = writerFor({ openaiKey: 'a', openrouterKey: 'b', fetchImpl: impl })!;
		expect(await write('p')).toBe('{"kind":"answer"}');
		expect(calls[0]).toContain('openrouter');
		expect(calls[1]).toContain('api.openai.com');
	});

	it('does not hand over a failure the other vendor would repeat', async () => {
		const calls: string[] = [];
		const impl = (async (url: string) => {
			calls.push(url);
			return new Response(JSON.stringify({ error: { message: 'no such model' } }), { status: 400 });
		}) as unknown as typeof fetch;
		const write = writerFor({ openaiKey: 'a', openrouterKey: 'b', fetchImpl: impl })!;
		await expect(write('p')).rejects.toThrow(/400/);
		expect(calls).toHaveLength(1);
	});

	it('returns nothing when the deployment has no key, so a miss stays a miss', () => {
		expect(writerFor({})).toBeUndefined();
	});
});
