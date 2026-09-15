import { NothingHeard, type Hearing } from '../kb/hearing';

export { NothingHeard } from '../kb/hearing';
import { GeminiHearer } from '../providers/gemini-hear';
import { OpenAiWsRoute } from './openai-ws';
import { RouteUnavailable, type HearingRoute, type UnavailableReason } from './types';

export { OpenAiWsRoute } from './openai-ws';
export { RouteUnavailable, type HearingRoute, type UnavailableReason } from './types';

/** Registry order is failover order after the chosen route (vault dec-suara-0016). */
export const ROUTE_IDS = ['openai-ws', 'gemini'] as const;
export type RouteId = (typeof ROUTE_IDS)[number];
export const DEFAULT_ROUTE: RouteId = 'openai-ws';

export const ROUTE_LABEL: Record<RouteId, string> = {
	'openai-ws': 'OpenAI · gpt-5.6-luna over WebSocket',
	gemini: 'Google · gemini-3.5-flash-lite',
};

const isRoute = (v: unknown): v is RouteId => typeof v === 'string' && (ROUTE_IDS as readonly string[]).includes(v);

/** `?route=` or the request's choice, then `SUARA_ROUTE`, then the default. Unknown values fall through. */
export function resolveRoute(requested: string | null | undefined, configured: string | undefined): RouteId {
	if (isRoute(requested)) return requested;
	if (isRoute(configured)) return configured;
	return DEFAULT_ROUTE;
}

export interface RouteEnv {
	OPENAI_API_KEY?: string;
	SUARA_OPENAI_HEAR_MODEL?: string;
	GEMINI_API_KEY?: string;
	SUARA_MODEL?: string;
}

function build(id: RouteId, env: RouteEnv): HearingRoute {
	switch (id) {
		case 'openai-ws':
			return new OpenAiWsRoute({ apiKey: env.OPENAI_API_KEY, model: env.SUARA_OPENAI_HEAR_MODEL });
		case 'gemini': {
			const hearer = env.GEMINI_API_KEY ? new GeminiHearer({ apiKey: env.GEMINI_API_KEY, model: env.SUARA_MODEL }) : undefined;
			return {
				id,
				vendor: 'google',
				label: ROUTE_LABEL.gemini,
				hear: async (audio, mime) => {
					if (!hearer) throw new RouteUnavailable(id, 'missing-key', 'GEMINI_API_KEY is not set');
					return hearer.hear(audio, mime);
				},
			};
		}
	}
}

/** The chosen route first, then every other route as failover. */
export function buildRoutes(primary: RouteId, env: RouteEnv): HearingRoute[] {
	return [primary, ...ROUTE_IDS.filter((id) => id !== primary)].map((id) => build(id, env));
}

export interface Heard {
	hearing: Hearing;
	route: string;
	skipped: { route: string; reason: UnavailableReason }[];
}

export async function hearVia(chain: readonly HearingRoute[], audio: ArrayBuffer, mimeType?: string): Promise<Heard> {
	const skipped: Heard['skipped'] = [];
	for (const route of chain) {
		try {
			return { hearing: await route.hear(audio, mimeType), route: route.id, skipped };
		} catch (err) {
			if (err instanceof RouteUnavailable && err.reason === 'nothing-heard') throw new NothingHeard(err.message);
			skipped.push({ route: route.id, reason: err instanceof RouteUnavailable ? err.reason : 'vendor-error' });
			console.warn(`route ${route.id} skipped:`, err instanceof Error ? err.message.slice(0, 200) : err);
		}
	}
	throw new Error(`every route failed: ${skipped.map((s) => `${s.route} ${s.reason}`).join(', ')}`);
}
