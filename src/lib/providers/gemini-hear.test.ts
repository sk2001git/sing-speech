import { describe, expect, it } from 'vitest';
import { GeminiHearer } from './gemini-hear';

const request = {
	greeting: false,
	meaning_en: 'How do I check my Silver Support eligibility?',
	short: 'Silver Support check',
	sentence: 'You want to know if you can get Silver Support.',
	language: 'en',
	confidence: 0.88,
};

function fakeFetch(status: number, text: string) {
	const calls: { url: string; body: any }[] = [];
	const impl = (async (url: string, init: RequestInit) => {
		calls.push({ url, body: JSON.parse(String(init.body)) });
		const json = status === 200 ? { candidates: [{ content: { parts: [{ text }] } }] } : { error: { message: text } };
		return new Response(JSON.stringify(json), { status });
	}) as unknown as typeof fetch;
	return { impl, calls };
}

describe('GeminiHearer', () => {
	it('sends the audio once with the hearing schema, and returns what it heard', async () => {
		const { impl, calls } = fakeFetch(200, JSON.stringify(request));
		const hearer = new GeminiHearer({ apiKey: 'k', fetchImpl: impl });
		const heard = await hearer.hear(new Uint8Array([1, 2, 3]).buffer, 'audio/mp4');
		expect(heard).toEqual(request);
		expect(calls[0]!.url).toContain('gemini-3.5-flash-lite:generateContent');
		const parts = calls[0]!.body.contents[0].parts;
		expect(parts.find((p: any) => p.inlineData)!.inlineData.mimeType).toBe('audio/m4a');
		expect(calls[0]!.body.generationConfig.responseSchema.required).toContain('meaning_en');
		expect(calls[0]!.body.systemInstruction.parts[0].text).toContain('meaning_en');
	});

	it('rejects a request with no meaning rather than searching for nothing', async () => {
		const { impl } = fakeFetch(200, JSON.stringify({ ...request, meaning_en: '' }));
		await expect(new GeminiHearer({ apiKey: 'k', fetchImpl: impl }).hear(new ArrayBuffer(1))).rejects.toThrow();
	});

	it('fails with the status on an API error', async () => {
		const { impl } = fakeFetch(429, 'quota');
		await expect(new GeminiHearer({ apiKey: 'k', fetchImpl: impl }).hear(new ArrayBuffer(1))).rejects.toThrow(/429/);
	});
});
