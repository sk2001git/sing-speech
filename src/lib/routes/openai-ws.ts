import { Hearing, HEARING_SCHEMA, hearingPrompt } from '../kb/hearing';
import { RouteUnavailable, type HearingRoute } from './types';

const API = 'https://api.openai.com/v1';
const SOCKET_URL = 'wss://api.openai.com/v1/responses';
const ID = 'openai-ws';

/** The part of a WebSocket this route uses, so Workers, Node and tests can each supply one. */
export interface SocketLike {
	send(data: string): void;
	onMessage(fn: (data: string) => void): void;
	close(): void;
}

export type Connect = (url: string, headers: Record<string, string>) => Promise<SocketLike>;

/**
 * Cloudflare Workers: an outbound WebSocket is a fetch with `Upgrade: websocket`, which,
 * unlike the browser constructor, can carry the Authorization header.
 */
export const workersConnect: Connect = async (url, headers) => {
	const res = await fetch(url.replace(/^wss:/, 'https:'), { headers: { ...headers, Upgrade: 'websocket' } });
	const ws = (res as Response & { webSocket?: WebSocket & { accept(): void } }).webSocket;
	if (!ws) throw new Error(`websocket handshake refused: ${res.status}`);
	ws.accept();
	return {
		send: (data) => ws.send(data),
		onMessage: (fn) => ws.addEventListener('message', (e) => fn(typeof e.data === 'string' ? e.data : '')),
		close: () => ws.close(),
	};
};

export interface OpenAiWsOptions {
	apiKey: string | undefined;
	/** gpt-5.6-luna: $0.20 / $1.20 per M tokens, text and image input (checked 2026-09-16). */
	model?: string;
	/** gpt-transcribe: $0.0045 a minute (checked 2026-09-16). */
	transcribeModel?: string;
	fetchImpl?: typeof fetch;
	connect?: Connect;
	timeoutMs?: number;
}

const EXTENSION: Record<string, string> = {
	'audio/webm': 'webm',
	'audio/mp4': 'mp4',
	'audio/m4a': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
};

/** Strict structured output needs every property required and nothing extra allowed. */
const STRICT_HEARING = { ...HEARING_SCHEMA, additionalProperties: false };

/**
 * OpenAI, two steps: transcribe the recording, then ask Luna — which takes text, not
 * audio — for the same `Hearing` Gemini returns, over the Responses API WebSocket.
 */
export class OpenAiWsRoute implements HearingRoute {
	readonly id = ID;
	readonly vendor = 'openai';
	readonly label: string;
	private readonly model: string;
	private readonly transcribeModel: string;
	private readonly doFetch: typeof fetch;
	private readonly connect: Connect;
	private readonly timeoutMs: number;

	constructor(private readonly opts: OpenAiWsOptions) {
		this.model = opts.model ?? 'gpt-5.6-luna';
		this.transcribeModel = opts.transcribeModel ?? 'gpt-transcribe';
		this.label = `OpenAI · ${this.model} over WebSocket`;
		// Bound: workerd rejects a detached global fetch with "Illegal invocation".
		this.doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
		this.connect = opts.connect ?? workersConnect;
		this.timeoutMs = opts.timeoutMs ?? 20_000;
	}

	async hear(audio: ArrayBuffer, mimeType?: string): Promise<Hearing> {
		const key = this.opts.apiKey;
		if (!key) throw new RouteUnavailable(ID, 'missing-key', 'OPENAI_API_KEY is not set');

		const transcript = await this.transcribe(key, audio, mimeType);
		if (transcript.trim() === '') throw new RouteUnavailable(ID, 'nothing-heard', 'the transcript was empty');

		const request = {
			model: this.model,
			store: false,
			reasoning: { effort: 'none' },
			instructions: hearingPrompt('transcript'),
			input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `Transcript:\n${transcript}` }] }],
			text: { format: { type: 'json_schema', name: 'hearing', strict: true, schema: STRICT_HEARING } },
		};

		let text: string;
		try {
			text = await this.overSocket(key, request);
		} catch (err) {
			if (err instanceof RouteUnavailable) throw err;
			// The socket was refused (the Luna model page lists WebSocket as not supported):
			// the same payload over HTTP, so the route still serves.
			console.warn(`${ID}: websocket unavailable, using HTTP:`, err instanceof Error ? err.message : err);
			text = await this.overHttp(key, request);
		}
		return Hearing.parse(JSON.parse(text));
	}

	private async transcribe(key: string, audio: ArrayBuffer, mimeType?: string): Promise<string> {
		const base = (mimeType ?? 'audio/webm').split(';')[0]!.trim().toLowerCase();
		const form = new FormData();
		form.append('model', this.transcribeModel);
		form.append('file', new File([audio], `speech.${EXTENSION[base] ?? 'webm'}`, { type: base }));
		const res = await this.doFetch(`${API}/audio/transcriptions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}` },
			body: form,
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		const json = (await res.json().catch(() => ({}))) as { text?: string; error?: { code?: string; message?: string } };
		if (!res.ok) throw failure(res.status, json.error);
		return json.text ?? '';
	}

	private async overSocket(key: string, request: Record<string, unknown>): Promise<string> {
		const socket = await this.connect(SOCKET_URL, { Authorization: `Bearer ${key}` });
		try {
			return await new Promise<string>((resolve, reject) => {
				const timer = setTimeout(() => reject(new RouteUnavailable(ID, 'vendor-error', 'no response within the time limit')), this.timeoutMs);
				socket.onMessage((data) => {
					let event: any;
					try {
						event = JSON.parse(data);
					} catch {
						return;
					}
					if (event.type === 'response.completed') {
						clearTimeout(timer);
						const out = outputText(event.response);
						out ? resolve(out) : reject(new RouteUnavailable(ID, 'vendor-error', 'response completed with no text'));
					} else if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') {
						clearTimeout(timer);
						const error = event.error ?? event.response?.error;
						reject(error?.code ? failure(0, error) : new RouteUnavailable(ID, 'vendor-error', `response ${event.type.replace('response.', '')}: ${error?.message ?? 'no message'}`));
					}
				});
				socket.send(JSON.stringify({ type: 'response.create', ...request }));
			});
		} finally {
			socket.close();
		}
	}

	private async overHttp(key: string, request: Record<string, unknown>): Promise<string> {
		const res = await this.doFetch(`${API}/responses`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(request),
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
		if (!res.ok) throw failure(res.status, json.error);
		const out = outputText(json);
		if (!out) throw new RouteUnavailable(ID, 'vendor-error', 'response had no text');
		return out;
	}
}

function outputText(response: any): string {
	for (const item of response?.output ?? []) {
		for (const part of item?.content ?? []) if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
	}
	return '';
}

function failure(status: number, error?: { code?: string; message?: string }): RouteUnavailable {
	const code = error?.code ?? '';
	if (status === 401 || code === 'invalid_api_key') return new RouteUnavailable(ID, 'bad-key', 'OPENAI_API_KEY was rejected');
	if (code === 'insufficient_quota') return new RouteUnavailable(ID, 'needs-top-up', 'the OpenAI balance needs a top-up');
	if (status === 429 || code === 'rate_limit_exceeded') return new RouteUnavailable(ID, 'rate-limited', 'rate limited');
	return new RouteUnavailable(ID, 'vendor-error', `${status || 'error'}: ${error?.message ?? 'no message'}`);
}
