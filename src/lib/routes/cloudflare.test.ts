import { describe, expect, it, vi } from 'vitest';
import { webAllowed } from '../kb/web-answer';
import { cloudflareRoute, WHISPER_MODEL } from './cloudflare';
import { buildRoutes, resolveRoute, ROUTE_LABEL } from './index';
import { RouteUnavailable } from './types';
import { voiceFor } from './voice';

/**
 * The economical route (vault plan-suara-0016): Workers AI whisper-large-v3-turbo hears, with the
 * reader's language as a hint (obs-0054), then gpt-6-luna reads the transcript.
 */
const hearing = {
	greeting: false,
	meaning_en: 'How do I reset my Singpass password?',
	short: 'Reset Singpass',
	sentence: 'You want to reset your Singpass password.',
	language: 'en',
	confidence: 0.92,
};

function fakeAi(text: string) {
	const calls: { model: string; input: Record<string, unknown> }[] = [];
	const ai = {
		run: vi.fn(async (model: string, input: Record<string, unknown>) => {
			calls.push({ model, input });
			return { text };
		}),
	};
	return { ai, calls };
}

function fakeLuna(reply: unknown) {
	const calls: { url: string; body: any }[] = [];
	const impl = (async (url: string, init: RequestInit) => {
		calls.push({ url, body: JSON.parse(String(init.body)) });
		return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reply) }] }] }), { status: 200 });
	}) as unknown as typeof fetch;
	return { impl, calls };
}

const audio = new Uint8Array([1, 2, 3]).buffer;

describe('the cloudflare route', () => {
	it('is a route a page can be opened on, labelled for review', () => {
		expect(resolveRoute('cloudflare', undefined)).toBe('cloudflare');
		expect(ROUTE_LABEL.cloudflare).toBe('Cloudflare · whisper-large-v3-turbo + gpt-6-luna');
	});

	it('fails over to the OpenAI route, then Gemini, and leaves the other chains as they were', () => {
		expect(buildRoutes('cloudflare', { OPENAI_API_KEY: 'k' }).map((r) => r.id)).toEqual(['cloudflare', 'openai-ws', 'gemini']);
		expect(buildRoutes('openai-ws', { OPENAI_API_KEY: 'k' }).map((r) => r.id)).toEqual(['openai-ws', 'gemini']);
	});

	it('hears with whisper-large-v3-turbo, passing the language, then asks gpt-6-luna over HTTP', async () => {
		const ai = fakeAi(' I forgot my Singpass password ');
		const luna = fakeLuna(hearing);
		const route = cloudflareRoute({ ai: ai.ai, apiKey: 'sk', fetchImpl: luna.impl });

		expect(await route.hear(audio, 'audio/webm', 'en')).toEqual({ ...hearing, said: 'I forgot my Singpass password' });
		expect(ai.calls[0]).toEqual({ model: WHISPER_MODEL, input: { audio: 'AQID', language: 'en' } });
		expect(WHISPER_MODEL).toBe('@cf/openai/whisper-large-v3-turbo');
		expect(luna.calls[0]!.url).toBe('https://api.openai.com/v1/responses');
		expect(luna.calls[0]!.body).toMatchObject({ model: 'gpt-6-luna', text: { format: { type: 'json_schema', strict: true } } });
		expect(JSON.stringify(luna.calls[0]!.body.input)).toContain('I forgot my Singpass password');
	});

	it('asks for Chinese when the reader reads Chinese, and guesses when they chose Automatic', async () => {
		const zh = fakeAi('我忘记了密码');
		await cloudflareRoute({ ai: zh.ai, apiKey: 'sk', fetchImpl: fakeLuna({ ...hearing, language: 'zh' }).impl }).hear(audio, 'audio/webm', 'zh');
		expect(zh.calls[0]!.input.language).toBe('zh');
		const auto = fakeAi('I forgot my password');
		await cloudflareRoute({ ai: auto.ai, apiKey: 'sk', fetchImpl: fakeLuna(hearing).impl }).hear(audio, 'audio/webm');
		expect(auto.calls[0]!.input).not.toHaveProperty('language');
	});

	it('says nothing was heard when the transcript is empty', async () => {
		const route = cloudflareRoute({ ai: fakeAi('   ').ai, apiKey: 'sk', fetchImpl: fakeLuna(hearing).impl });
		await expect(route.hear(audio, 'audio/webm', 'en')).rejects.toMatchObject({ reason: 'nothing-heard' });
	});

	it('steps aside for the next route when the Worker has no AI binding', async () => {
		const route = cloudflareRoute({ ai: undefined, apiKey: 'sk', fetchImpl: fakeLuna(hearing).impl });
		const err = await route.hear(audio, 'audio/webm', 'en').catch((e) => e);
		expect(err).toBeInstanceOf(RouteUnavailable);
		expect(err).toMatchObject({ route: 'cloudflare', reason: 'missing-key' });
	});

	it('answers from the web, and speaks, as the OpenAI route does', () => {
		expect(webAllowed('cloudflare')).toBe(true);
		expect(voiceFor('cloudflare', { OPENAI_API_KEY: 'k' })).toBeDefined();
	});
});
