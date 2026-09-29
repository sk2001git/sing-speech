import { CLOUDFLARE_TEXT_MODEL } from './cloudflare';
import { OpenAiWsRoute } from './openai-ws';
import { RouteUnavailable, type HearingRoute } from './types';
import type { StageTimer } from '../timing';

/**
 * The local route (vault plan-suara-0018): the recording goes to Qwen3-ASR running on this PC
 * (suara/local-asr/server.py), then gpt-6-luna reads the transcript, as on the Cloudflare route.
 *
 * Only reachable where the server is: the dev server on this PC, or a Worker with a tunnel to it.
 * When it is not running the route steps aside and the Cloudflare route hears instead.
 */
export const LOCAL_ASR_URL = 'http://127.0.0.1:8791';
const ID = 'local';

export interface LocalRouteOptions {
	apiKey: string | undefined;
	/** Where local-asr/server.py listens. */
	url?: string;
	fetchImpl?: typeof fetch;
	timing?: StageTimer;
}

export function localRoute(opts: LocalRouteOptions): HearingRoute {
	const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
	const base = (opts.url ?? LOCAL_ASR_URL).replace(/\/$/, '');
	return new OpenAiWsRoute({
		id: ID,
		vendor: 'local',
		label: `Local · Qwen3-ASR and Qwen3-TTS on this PC + ${CLOUDFLARE_TEXT_MODEL}`,
		apiKey: opts.apiKey,
		model: CLOUDFLARE_TEXT_MODEL,
		socket: false,
		fetchImpl: doFetch,
		...(opts.timing ? { timing: opts.timing } : {}),
		transcribe: async (audio, mime, hint) => {
			let res: Response;
			try {
				res = await doFetch(`${base}/transcribe${hint ? `?language=${hint}` : ''}`, {
					method: 'POST',
					headers: { 'content-type': mime ?? 'application/octet-stream' },
					body: audio,
					// The CPU takes about 2 s for a short question; a stuck server must not hold the person.
					signal: AbortSignal.timeout(20_000),
				});
			} catch (err) {
				throw new RouteUnavailable(ID, 'vendor-error', `the local server is not reachable: ${err instanceof Error ? err.message.slice(0, 80) : 'failed'}`);
			}
			if (!res.ok) throw new RouteUnavailable(ID, 'vendor-error', `the local server answered ${res.status}`);
			return ((await res.json()) as { text?: string }).text ?? '';
		},
	});
}
