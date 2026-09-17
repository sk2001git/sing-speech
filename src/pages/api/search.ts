import type { APIRoute } from 'astro';
import { EMBEDDING, loadCorpus, loadPlaces } from '../../lib/kb/corpus';
import { MemoryTranslations, runSearch, SearchRequest, type SearchDeps } from '../../lib/kb/search';
import { DEFAULT_TRANSLATORS, translateEntry } from '../../lib/kb/translate';
import { runtimeEnv } from '../../lib/env';
import { OpenRouter } from '../../lib/providers/openrouter';
import { buildRoutes, hearVia, resolveRoute } from '../../lib/routes';

export const prerender = false;

/**
 * Qwen3-Embedding-8B lines, set on 24 held-out requests against the seed corpus: right
 * answers scored 0.774-0.995, questions Suara cannot answer 0.370-0.654. Recalibrate on
 * the eval set.
 */
const THRESHOLDS = { strong: 0.75, weak: 0.6, floor: 0.45 };

/** Lives as long as the isolate. D1 replaces it in build step 6. */
const translations = new MemoryTranslations();

export const POST: APIRoute = async ({ request, locals }) => {
	let raw: unknown;
	let parsed: SearchRequest;
	try {
		raw = await request.json();
		parsed = SearchRequest.parse(raw);
	} catch {
		return json({ error: 'bad request' }, 400);
	}

	try {
		const env = await runtimeEnv();
		if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set');
		const or = new OpenRouter({ apiKey: env.OPENROUTER_API_KEY });
		const chain = buildRoutes(resolveRoute((raw as { route?: string }).route, env.SUARA_ROUTE), env);
		let served: string | undefined;
		const ctx = (locals as { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } }).cfContext;

		const deps: SearchDeps = {
			corpus: loadCorpus(),
			places: loadPlaces(),
			embed: async (text) => (await or.embed(EMBEDDING.model, [text], EMBEDDING.dimensions))[0]!,
			hear: async (audio, mime) => {
				const heard = await hearVia(chain, audio, mime);
				served = heard.route;
				return heard.hearing;
			},
			translate: (entry, language) => translateEntry(entry, language, DEFAULT_TRANSLATORS, or.chatJson, new Date().toISOString()),
			cache: translations,
			thresholds: THRESHOLDS,
			translateBudgetMs: 4000,
			now: () => new Date().toISOString(),
			...(ctx?.waitUntil ? { waitUntil: (p) => ctx.waitUntil!(p) } : {}),
		};
		return json({ ...(await runSearch(parsed, deps)), ...(served ? { route: served } : {}) });
	} catch (err) {
		// Nothing about the person reaches the log: no audio, no query text.
		console.error('search failed:', err instanceof Error ? err.message.slice(0, 200) : err);
		return json({ error: 'search failed' }, 502);
	}
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
