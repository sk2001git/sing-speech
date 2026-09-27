import { OpenAiWsRoute } from './openai-ws';
import { RouteUnavailable, type HearingRoute } from './types';

/**
 * The economical route (vault plan-suara-0016): Workers AI hears, gpt-6-luna reads.
 *
 * whisper-large-v3-turbo with the reader's language as a hint scored 13.9% error on the 38
 * Singlish and Mandarin clips, against gpt-transcribe's 13.7%, at $0.0005 a minute instead of
 * $0.0045, and the free 10,000 neurons a day cover about 214 audio minutes (vault obs-0054).
 * The old `@cf/openai/whisper` is not this model: it answered Singlish in Malay.
 *
 * Reading the transcript is the OpenAI route's own step, on gpt-6-luna (the same Artificial
 * Analysis score as gpt-5.6-luna at half the price, obs-0053), over HTTP.
 */
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';
export const CLOUDFLARE_TEXT_MODEL = 'gpt-6-luna';
const ID = 'cloudflare';

/** The part of the Workers AI binding this uses. */
export interface AiLike {
	run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface CloudflareRouteOptions {
	ai: AiLike | undefined;
	apiKey: string | undefined;
	model?: string;
	fetchImpl?: typeof fetch;
	reasoning?: 'none' | 'low';
}

/** Base64 without Buffer, which the Workers runtime lacks unless nodejs_compat supplies it. */
function base64(audio: ArrayBuffer): string {
	const bytes = new Uint8Array(audio);
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

export function cloudflareRoute(opts: CloudflareRouteOptions): HearingRoute {
	return new OpenAiWsRoute({
		id: ID,
		vendor: 'cloudflare',
		label: `Cloudflare · whisper-large-v3-turbo + ${opts.model ?? CLOUDFLARE_TEXT_MODEL}`,
		apiKey: opts.apiKey,
		model: opts.model ?? CLOUDFLARE_TEXT_MODEL,
		socket: false,
		...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
		...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
		transcribe: async (audio, _mime, hint) => {
			if (!opts.ai) throw new RouteUnavailable(ID, 'missing-key', 'the Worker has no AI binding');
			let out: { text?: string };
			try {
				out = (await opts.ai.run(WHISPER_MODEL, { audio: base64(audio), ...(hint ? { language: hint } : {}) })) as { text?: string };
			} catch (err) {
				throw new RouteUnavailable(ID, 'vendor-error', `Workers AI: ${err instanceof Error ? err.message.slice(0, 160) : 'failed'}`);
			}
			return out.text ?? '';
		},
	});
}
