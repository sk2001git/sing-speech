import { describe, expect, it } from 'vitest';
import { OpenAiVoice, voiceFor } from './voice';

function fakeFetch(status: number, body: BodyInit, type = 'audio/mpeg') {
	const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
	const impl = (async (url: string, init: RequestInit) => {
		calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
		return new Response(body, { status, headers: { 'content-type': type } });
	}) as unknown as typeof fetch;
	return { impl, calls };
}

describe('OpenAiVoice', () => {
	it("speaks with OpenAI's voice, slowly, as mp3", async () => {
		const { impl, calls } = fakeFetch(200, new Uint8Array([1, 2, 3]));
		const audio = await new OpenAiVoice({ apiKey: 'sk', fetchImpl: impl }).speak('Best match: GPFirst at A&E.', 'en');
		expect(audio.contentType).toBe('audio/mpeg');
		expect(new Uint8Array(await new Response(audio.body).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
		expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/speech');
		expect(calls[0]!.headers.Authorization).toBe('Bearer sk');
		expect(calls[0]!.body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'marin', input: 'Best match: GPFirst at A&E.', response_format: 'mp3' });
		expect(calls[0]!.body.instructions).toMatch(/slow/i);
	});

	it('asks for Mandarin delivery for Chinese text', async () => {
		const { impl, calls } = fakeFetch(200, new Uint8Array([1]));
		await new OpenAiVoice({ apiKey: 'sk', fetchImpl: impl }).speak('您好', 'zh-Hans');
		expect(calls[0]!.body.instructions).toMatch(/Mandarin/);
	});

	it('names a missing key and an empty balance for the operator', async () => {
		await expect(new OpenAiVoice({ apiKey: undefined }).speak('x', 'en')).rejects.toMatchObject({ reason: 'missing-key' });
		const { impl } = fakeFetch(429, JSON.stringify({ error: { code: 'insufficient_quota' } }), 'application/json');
		await expect(new OpenAiVoice({ apiKey: 'sk', fetchImpl: impl }).speak('x', 'en')).rejects.toMatchObject({ reason: 'needs-top-up' });
	});
});

describe('voiceFor', () => {
	it('gives the OpenAI route its own voice and leaves Gemini on the phone voice', () => {
		expect(voiceFor('openai-ws', { OPENAI_API_KEY: 'sk' })).toBeInstanceOf(OpenAiVoice);
		expect(voiceFor('gemini', { OPENAI_API_KEY: 'sk' })).toBeUndefined();
	});
});
