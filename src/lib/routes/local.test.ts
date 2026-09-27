import { describe, expect, it } from 'vitest';
import { webAllowed } from '../kb/web-answer';
import { buildRoutes, resolveRoute, ROUTE_LABEL } from './index';
import { LOCAL_ASR_URL, localRoute } from './local';
import { voiceFor } from './voice';

/** The local route (vault plan-suara-0018): Polyglot-Lion on this PC hears, gpt-6-luna reads. */
const hearing = { greeting: false, meaning_en: 'How do I apply for CHAS?', short: 'Apply for CHAS', sentence: 'You want to apply for CHAS.', language: 'en', confidence: 0.9 };

function fakes(local: { ok: boolean; text?: string }) {
	const calls: { url: string; body: unknown }[] = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		calls.push({ url, body: init.body });
		if (url.startsWith(LOCAL_ASR_URL)) {
			if (!local.ok) throw new TypeError('fetch failed: connection refused');
			return new Response(JSON.stringify({ text: local.text, language: 'English', ms: 2100 }));
		}
		return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(hearing) }] }] }));
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}
const audio = new Uint8Array([1, 2, 3]).buffer;

describe('the local route', () => {
	it('is a route a page can be opened on', () => {
		expect(resolveRoute('local', undefined)).toBe('local');
		expect(ROUTE_LABEL.local).toBe('Local · Polyglot-Lion on this PC + gpt-6-luna');
	});

	it('fails over to the Cloudflare route, then OpenAI, then Gemini', () => {
		expect(buildRoutes('local', { OPENAI_API_KEY: 'k' }).map((r) => r.id)).toEqual(['local', 'cloudflare', 'openai-ws', 'gemini']);
	});

	it('sends the recording to the server on this PC with the language, then asks gpt-6-luna', async () => {
		const { fetchImpl, calls } = fakes({ ok: true, text: 'How to apply CHAS card ah' });
		const h = await localRoute({ apiKey: 'sk', fetchImpl }).hear(audio, 'audio/webm', 'en');
		expect(h.said).toBe('How to apply CHAS card ah');
		expect(calls[0]!.url).toBe(`${LOCAL_ASR_URL}/transcribe?language=en`);
		expect(new Uint8Array(calls[0]!.body as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
		expect(JSON.parse(String(calls[1]!.body))).toMatchObject({ model: 'gpt-6-luna' });
	});

	it('steps aside for the next route when the server is not running', async () => {
		const err = await localRoute({ apiKey: 'sk', fetchImpl: fakes({ ok: false }).fetchImpl }).hear(audio, 'audio/webm', 'en').catch((e) => e);
		expect(err).toMatchObject({ route: 'local', reason: 'vendor-error' });
	});

	it('answers from the web and speaks, as the Cloudflare route does', () => {
		expect(webAllowed('local')).toBe(true);
		expect(voiceFor('local', { OPENAI_API_KEY: 'k' })).toBeDefined();
	});
});
