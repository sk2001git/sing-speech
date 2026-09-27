import { describe, expect, it } from 'vitest';
import { webAllowed } from '../kb/web-answer';
import { buildRoutes, resolveRoute, ROUTE_LABEL } from './index';
import { LOCAL_ASR_URL, localRoute } from './local';
import { LocalVoice, voiceFor } from './voice';

/** The local route (vault plan-suara-0018): Qwen3-ASR on this PC hears, gpt-6-luna reads. */
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
		expect(ROUTE_LABEL.local).toBe('Local · Qwen3-ASR and Qwen3-TTS on this PC + gpt-6-luna');
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

	it('answers from the web, as the Cloudflare route does', () => {
		expect(webAllowed('local')).toBe(true);
	});
});

/** The local voice (vault obs-0071): Qwen3-TTS on this PC speaks, not OpenAI. */
describe('the local voice', () => {
	function speakFakes(res: () => Response) {
		const calls: { url: string; body: any }[] = [];
		const fetchImpl = (async (url: string, init: RequestInit) => {
			calls.push({ url, body: JSON.parse(String(init.body)) });
			return res();
		}) as unknown as typeof fetch;
		return { fetchImpl, calls };
	}

	it('is the voice of the local route, aiden unless set otherwise', () => {
		const voice = voiceFor('local', {});
		expect(voice).toBeInstanceOf(LocalVoice);
		expect(voice).toMatchObject({ voice: 'aiden', model: 'qwen3-tts-1.7b' });
		expect(voiceFor('local', { SUARA_LOCAL_VOICE: 'uncle_fu' })).toMatchObject({ voice: 'uncle_fu' });
	});

	it('sends the line, its language and the voice to the server on this PC, and returns mp3', async () => {
		const { fetchImpl, calls } = speakFakes(() => new Response(new Uint8Array([7, 8]), { headers: { 'content-type': 'audio/mpeg' } }));
		const audio = await new LocalVoice({ fetchImpl }).speak('您问：怎样查看我的公积金余额？', 'zh-Hans');
		expect(calls[0]!.url).toBe(`${LOCAL_ASR_URL}/speak`);
		expect(calls[0]!.body).toEqual({ text: '您问：怎样查看我的公积金余额？', language: 'zh-Hans', voice: 'aiden' });
		expect(audio.contentType).toBe('audio/mpeg');
		expect(new Uint8Array(await new Response(audio.body).arrayBuffer())).toEqual(new Uint8Array([7, 8]));
	});

	it('steps aside, so the phone speaks, when the server is off or has no voice', async () => {
		const off = speakFakes(() => {
			throw new TypeError('fetch failed');
		});
		await expect(new LocalVoice({ fetchImpl: off.fetchImpl }).speak('x', 'en')).rejects.toMatchObject({ route: 'local', reason: 'vendor-error' });
		const mute = speakFakes(() => new Response('{"error":"the voice is off"}', { status: 503 }));
		await expect(new LocalVoice({ fetchImpl: mute.fetchImpl }).speak('x', 'en')).rejects.toMatchObject({ route: 'local', reason: 'vendor-error' });
	});

	it('keys its lines apart from the OpenAI voice, so a card never plays OpenAI’s recording', () => {
		const local = voiceFor('local', {})!;
		const openai = voiceFor('openai-ws', { OPENAI_API_KEY: 'k' })!;
		expect(`${local.model}|${local.voice}`).not.toBe(`${openai.model}|${openai.voice}`);
		expect(openai).toMatchObject({ voice: 'marin', model: 'gpt-4o-mini-tts' });
	});
});
