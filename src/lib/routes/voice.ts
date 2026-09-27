import type { EntryLanguage } from '../kb/entry';
import type { RouteEnv } from './index';
import { LOCAL_ASR_URL } from './local';
import { RouteUnavailable } from './types';

/**
 * A route's own voice (owner, 2026-09-16: the OpenAI route should speak with OpenAI's
 * voice, not the phone's). Routes without one leave speech to the browser.
 */
export interface RouteVoice {
	/** Which voice and model: with the words, the key a spoken line is kept under. */
	readonly voice: string;
	readonly model: string;
	speak(text: string, language: EntryLanguage): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string }>;
}

const INSTRUCTIONS: Record<EntryLanguage, string> = {
	en: 'Speak slowly, warmly and clearly to an older listener in Singapore. Pause briefly between sentences.',
	'zh-Hans': 'Speak Mandarin slowly, warmly and clearly to an older listener in Singapore. Pause briefly between sentences.',
};

export interface OpenAiVoiceOptions {
	apiKey: string | undefined;
	/** gpt-4o-mini-tts: $0.60 per M text tokens in, $12 per M audio tokens out (checked 2026-09-16). */
	model?: string;
	/** OpenAI recommends marin or cedar for quality. */
	voice?: string;
	fetchImpl?: typeof fetch;
}

export class OpenAiVoice implements RouteVoice {
	readonly voice: string;
	readonly model: string;
	private readonly doFetch: typeof fetch;

	constructor(private readonly opts: OpenAiVoiceOptions) {
		this.voice = opts.voice ?? 'marin';
		this.model = opts.model ?? 'gpt-4o-mini-tts';
		// Bound: workerd rejects a detached global fetch with "Illegal invocation".
		this.doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
	}

	async speak(text: string, language: EntryLanguage) {
		if (!this.opts.apiKey) throw new RouteUnavailable('openai-ws', 'missing-key', 'OPENAI_API_KEY is not set');
		const res = await this.doFetch('https://api.openai.com/v1/audio/speech', {
			method: 'POST',
			headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.model,
				voice: this.voice,
				input: text,
				instructions: INSTRUCTIONS[language],
				response_format: 'mp3',
			}),
			signal: AbortSignal.timeout(20_000),
		});
		if (!res.ok) {
			const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
			const code = json.error?.code ?? '';
			if (res.status === 401) throw new RouteUnavailable('openai-ws', 'bad-key', 'OPENAI_API_KEY was rejected');
			if (code === 'insufficient_quota') throw new RouteUnavailable('openai-ws', 'needs-top-up', 'the OpenAI balance needs a top-up');
			throw new RouteUnavailable('openai-ws', res.status === 429 ? 'rate-limited' : 'vendor-error', `speech ${res.status}: ${json.error?.message ?? ''}`);
		}
		return { body: res.body, contentType: res.headers.get('content-type') ?? 'audio/mpeg' };
	}
}

export interface LocalVoiceOptions {
	/** Where local-asr/server.py listens. */
	url?: string;
	/** A Qwen3-TTS preset; the owner picked aiden by ear, 2026-09-28 (design/local-voice). */
	voice?: string;
	fetchImpl?: typeof fetch;
}

/**
 * The local route's voice (vault obs-0071): Qwen3-TTS 1.7B on this PC, its model on the GPU.
 * About 0.45 s per second of speech. When the server is off, the phone speaks instead.
 */
export class LocalVoice implements RouteVoice {
	readonly voice: string;
	readonly model = 'qwen3-tts-1.7b';
	private readonly doFetch: typeof fetch;
	private readonly base: string;

	constructor(opts: LocalVoiceOptions = {}) {
		this.voice = opts.voice ?? 'aiden';
		this.base = (opts.url ?? LOCAL_ASR_URL).replace(/\/$/, '');
		this.doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
	}

	async speak(text: string, language: EntryLanguage) {
		let res: Response;
		try {
			res = await this.doFetch(`${this.base}/speak`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text, language, voice: this.voice }),
				// A long card line takes about 10 s on this PC; a stuck server must not hold the person.
				signal: AbortSignal.timeout(45_000),
			});
		} catch (err) {
			throw new RouteUnavailable('local', 'vendor-error', `the local voice is not reachable: ${err instanceof Error ? err.message.slice(0, 80) : 'failed'}`);
		}
		if (!res.ok) throw new RouteUnavailable('local', 'vendor-error', `the local voice answered ${res.status}`);
		return { body: res.body, contentType: res.headers.get('content-type') ?? 'audio/mpeg' };
	}
}

export function voiceFor(route: string, env: RouteEnv & { SUARA_OPENAI_VOICE?: string; SUARA_LOCAL_VOICE?: string }): RouteVoice | undefined {
	if (route === 'local') return new LocalVoice({ url: env.SUARA_LOCAL_ASR_URL, voice: env.SUARA_LOCAL_VOICE });
	// The Cloudflare route speaks with OpenAI's voice until the owner picks a Workers AI one by ear.
	return route === 'openai-ws' || route === 'cloudflare' ? new OpenAiVoice({ apiKey: env.OPENAI_API_KEY, voice: env.SUARA_OPENAI_VOICE }) : undefined;
}
