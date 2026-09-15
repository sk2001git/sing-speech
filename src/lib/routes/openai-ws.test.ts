import { describe, expect, it } from 'vitest';
import { OpenAiWsRoute, type SocketLike } from './openai-ws';
import { RouteUnavailable } from './types';

const hearing = {
	greeting: false,
	meaning_en: 'How do I reset my Singpass password?',
	short: 'Reset Singpass',
	sentence: 'You want to reset your Singpass password.',
	language: 'en',
	confidence: 0.92,
};

/** A socket that answers each response.create with the given server events. */
function fakeSocket(events: (sent: any) => unknown[]) {
	const sent: any[] = [];
	const connect = async (url: string, headers: Record<string, string>) => {
		let onMessage: (data: string) => void = () => {};
		const socket: SocketLike = {
			send(data) {
				const msg = JSON.parse(data);
				sent.push({ url, headers, msg });
				queueMicrotask(() => events(msg).forEach((e) => onMessage(JSON.stringify(e))));
			},
			onMessage(fn) {
				onMessage = fn;
			},
			close() {},
		};
		return socket;
	};
	return { connect, sent };
}

function fakeFetch(status: number, body: unknown) {
	const calls: { url: string; form: FormData }[] = [];
	const impl = (async (url: string, init: RequestInit) => {
		calls.push({ url, form: init.body as FormData });
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof fetch;
	return { impl, calls };
}

const completed = (text: string) => ({
	type: 'response.completed',
	response: { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] },
});

describe('OpenAiWsRoute', () => {
	it('transcribes, then asks Luna over the Responses WebSocket for strict JSON, and returns what it heard', async () => {
		const tx = fakeFetch(200, { text: 'I forgot my Singpass password' });
		const ws = fakeSocket(() => [{ type: 'response.in_progress' }, completed(JSON.stringify(hearing))]);
		const route = new OpenAiWsRoute({ apiKey: 'sk', fetchImpl: tx.impl, connect: ws.connect });

		// What they said is the transcript itself, not the model's retelling of it.
		expect(await route.hear(new Uint8Array([1, 2]).buffer, 'audio/webm;codecs=opus')).toEqual({ ...hearing, said: 'I forgot my Singpass password' });

		expect(tx.calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
		expect(tx.calls[0]!.form.get('model')).toBe('gpt-transcribe');
		expect((tx.calls[0]!.form.get('file') as File).name).toBe('speech.webm');

		const { url, headers, msg } = ws.sent[0]!;
		expect(url).toBe('wss://api.openai.com/v1/responses');
		expect(headers.Authorization).toBe('Bearer sk');
		expect(msg).toMatchObject({
			type: 'response.create',
			model: 'gpt-5.6-luna',
			store: false,
			reasoning: { effort: 'none' },
			text: { format: { type: 'json_schema', strict: true } },
		});
		expect(JSON.stringify(msg.input)).toContain('I forgot my Singpass password');
	});

	it('names the missing key so the operator knows to add it', async () => {
		const route = new OpenAiWsRoute({ apiKey: undefined });
		await expect(route.hear(new ArrayBuffer(1))).rejects.toMatchObject({ reason: 'missing-key' });
	});

	it('reports a rejected key and an empty balance differently', async () => {
		const bad = new OpenAiWsRoute({ apiKey: 'sk', fetchImpl: fakeFetch(401, { error: { code: 'invalid_api_key' } }).impl });
		await expect(bad.hear(new ArrayBuffer(1))).rejects.toMatchObject({ reason: 'bad-key' });

		const empty = new OpenAiWsRoute({ apiKey: 'sk', fetchImpl: fakeFetch(429, { error: { code: 'insufficient_quota' } }).impl });
		const err = await empty.hear(new ArrayBuffer(1)).catch((e) => e);
		expect(err).toBeInstanceOf(RouteUnavailable);
		expect(err.reason).toBe('needs-top-up');
	});

	it('fails when the response fails or returns something that is not a hearing', async () => {
		const tx = fakeFetch(200, { text: 'hello' });
		const failed = new OpenAiWsRoute({ apiKey: 'sk', fetchImpl: tx.impl, connect: fakeSocket(() => [{ type: 'response.failed', response: { error: { message: 'x' } } }]).connect });
		await expect(failed.hear(new ArrayBuffer(1))).rejects.toThrow(/failed/);

		const junk = new OpenAiWsRoute({ apiKey: 'sk', fetchImpl: tx.impl, connect: fakeSocket(() => [completed('{"nope":1}')]).connect });
		await expect(junk.hear(new ArrayBuffer(1))).rejects.toThrow();
	});

	it('treats a reply with no meaning as nothing heard, not as a broken vendor', async () => {
		const tx = fakeFetch(200, { text: 'mm' });
		const route = new OpenAiWsRoute({ apiKey: 'sk', fetchImpl: tx.impl, connect: fakeSocket(() => [completed(JSON.stringify({ ...hearing, meaning_en: '' }))]).connect });
		await expect(route.hear(new ArrayBuffer(1))).rejects.toMatchObject({ reason: 'nothing-heard' });
	});

	it('treats silence as nothing heard rather than searching for an empty sentence', async () => {
		const route = new OpenAiWsRoute({ apiKey: 'sk', fetchImpl: fakeFetch(200, { text: '  ' }).impl, connect: fakeSocket(() => []).connect });
		await expect(route.hear(new ArrayBuffer(1))).rejects.toMatchObject({ reason: 'nothing-heard' });
	});
});
