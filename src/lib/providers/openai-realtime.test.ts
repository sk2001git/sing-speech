import { describe, expect, it } from 'vitest';
import { createRealtimeCall, realtimeSession } from './openai-realtime';
import { RESPONSE_SCHEMA } from './prompt';

function recorder(status = 201, text = 'v=0 answer') {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init! });
		return new Response(text, { status });
	}) as typeof fetch;
	return { calls, fetchImpl };
}

describe('createRealtimeCall', () => {
	it('forwards the browser offer to the calls endpoint with the server-held key', async () => {
		const { calls, fetchImpl } = recorder();
		const res = await createRealtimeCall('v=0 offer', { apiKey: 'sk-test', fetchImpl });

		expect(calls[0]!.url).toBe('https://api.openai.com/v1/realtime/calls');
		expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer sk-test');
		const form = calls[0]!.init.body as FormData;
		expect(form.get('sdp')).toBe('v=0 offer');
		expect(JSON.parse(String(form.get('session'))).model).toBe('gpt-realtime-2.1');
		expect(res).toEqual({ status: 201, body: 'v=0 answer' });
	});

	it('passes an upstream failure through with its status', async () => {
		const { fetchImpl } = recorder(401, 'bad key');
		expect(await createRealtimeCall('v=0', { apiKey: 'sk-x', fetchImpl })).toEqual({
			status: 401,
			body: 'bad key',
		});
	});

	it('refuses to run with no key rather than calling out anonymously', async () => {
		const { fetchImpl } = recorder();
		await expect(createRealtimeCall('v=0', { apiKey: '', fetchImpl })).rejects.toThrow(/OPENAI_API_KEY/);
	});
});

describe('realtimeSession', () => {
	it('turns off voice activity detection, so only the user ends a turn', () => {
		expect(realtimeSession().audio.input.turn_detection).toBeNull();
	});

	it('asks for text only, because speech out stays on the device', () => {
		expect(realtimeSession().output_modalities).toEqual(['text']);
	});

	it('forces the understanding tool with the schema both providers share', () => {
		const s = realtimeSession();
		expect(s.tool_choice).toBe('required');
		expect(s.tools[0]).toMatchObject({
			type: 'function',
			name: 'report_understanding',
			parameters: RESPONSE_SCHEMA,
		});
	});

	it('transcribes the input as a corroboration channel, never as the decider', () => {
		expect(realtimeSession().audio.input.transcription).toEqual({ model: 'gpt-4o-transcribe' });
	});

	it('defaults to gpt-realtime-2.1 and accepts mini', () => {
		expect(realtimeSession().model).toBe('gpt-realtime-2.1');
		expect(realtimeSession('gpt-realtime-2.1-mini').model).toBe('gpt-realtime-2.1-mini');
	});

	it('rejects a model with no recorded price, including one that cannot hear audio', () => {
		expect(() => realtimeSession('gpt-5.6-luna')).toThrow(/gpt-5.6-luna/);
	});
});
