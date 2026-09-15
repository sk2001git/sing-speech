import type { EntryLanguage } from '../kb/entry';
import type { RouteEnv } from './index';
import { RouteUnavailable } from './types';

/**
 * A route's own voice (owner, 2026-09-16: the OpenAI route should speak with OpenAI's
 * voice, not the phone's). Routes without one leave speech to the browser.
 */
export interface RouteVoice {
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
	private readonly doFetch: typeof fetch;

	constructor(private readonly opts: OpenAiVoiceOptions) {
		// Bound: workerd rejects a detached global fetch with "Illegal invocation".
		this.doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
	}

	async speak(text: string, language: EntryLanguage) {
		if (!this.opts.apiKey) throw new RouteUnavailable('openai-ws', 'missing-key', 'OPENAI_API_KEY is not set');
		const res = await this.doFetch('https://api.openai.com/v1/audio/speech', {
			method: 'POST',
			headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.opts.model ?? 'gpt-4o-mini-tts',
				voice: this.opts.voice ?? 'marin',
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

export function voiceFor(route: string, env: RouteEnv & { SUARA_OPENAI_VOICE?: string }): RouteVoice | undefined {
	return route === 'openai-ws' ? new OpenAiVoice({ apiKey: env.OPENAI_API_KEY, voice: env.SUARA_OPENAI_VOICE }) : undefined;
}
