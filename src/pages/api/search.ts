import type { APIRoute } from 'astro';
import { EMBEDDING, loadCorpus, loadJourneys, loadPlaces, loadRaw } from '../../lib/kb/corpus';
import { CF_THRESHOLDS, cloudflareEmbed, vectorizeNearest } from '../../lib/kb/cf-search';
import { queryText, type StoredVector } from '../../lib/kb/embed';
import type { RawDoc } from '../../lib/kb/raw-store';
import { MemoryTranslations, runSearch, SearchRequest, type SearchDeps } from '../../lib/kb/search';
import { DEFAULT_TRANSLATORS, LUNA_6_TRANSLATORS, translateEntry } from '../../lib/kb/translate';
import { runtimeEnv } from '../../lib/env';
import { OpenAi } from '../../lib/providers/openai';
import { buildRoutes, hearVia, resolveRoute } from '../../lib/routes';
import { writerFor } from '../../lib/routes/write';
import { openaiJudge } from '../../lib/kb/judge';
import { webAllowed } from '../../lib/kb/web-answer';
import { guidesFor } from '../../lib/kb/web-guides';

export const prerender = false;

/**
 * Lines for text-embedding-3-large at 768 dimensions, measured against the served index by
 * `scripts/kb/calibrate-thresholds.ts` on 2026-09-19, using questions the index has never
 * seen — 29 real ones in a person's own words, 12 nobody official can answer:
 *
 *   real questions        p05 0.828   median 0.886
 *   unanswerable ones     median 0.667   worst 0.761
 *   floor 0.80            keeps 29 of 29, turns away 12 of 12
 *
 * Everything between the floor and `strong` also asks Tier B, so a middling fit is a reason
 * to look harder rather than a reason to show the nearest thing.
 */
const THRESHOLDS = { strong: 0.86, weak: 0.82, floor: 0.8 };

/** Lives as long as the isolate. D1 replaces it in build step 6. */
const translations = new MemoryTranslations();

/** Cards written from the crawl in this isolate, embedded for the Cloudflare route's search. */
const cfWritten: StoredVector[] = [];

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
		if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
		const openai = new OpenAi({ apiKey: env.OPENAI_API_KEY });
		const route = resolveRoute((raw as { route?: string }).route, env.SUARA_ROUTE);
		const chain = buildRoutes(route, env);
		let served: string | undefined;
		const ctx = (locals as { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } }).cfContext;
		// The Cloudflare route writes and translates with gpt-6-luna alone (plan-suara-0016).
		const lean = route === 'cloudflare';
		const writer = writerFor({
			openaiKey: env.OPENAI_API_KEY,
			...(lean ? { model: 'gpt-6-luna' } : env.SUARA_WRITE_MODEL ? { model: env.SUARA_WRITE_MODEL } : {}),
			// Kept as a stand-in only: if the OpenAI account cannot be paid, a card is still
			// better than an error. Nothing routes here by choice any more.
			...(env.OPENROUTER_API_KEY && !lean ? { openrouterKey: env.OPENROUTER_API_KEY } : {}),
		});

		// The Cloudflare route searches its own index: qwen3 on Workers AI and Vectorize
		// (plan-suara-0016). It falls back to the OpenAI index if either binding is missing.
		const shared = loadCorpus();
		const vectorize = env.SUARA_CARDS;
		const cf = lean && env.AI && vectorize ? { embed: cloudflareEmbed(env.AI), nearest: vectorizeNearest(vectorize, shared.entries.keys(), () => cfWritten) } : null;
		const deps: SearchDeps = {
			corpus: cf ? { entries: shared.entries, vectors: cfWritten } : shared,
			...(cf ? { nearest: cf.nearest } : {}),
			places: loadPlaces(),
			journeys: loadJourneys(),
			embed: cf ? cf.embed : async (text, kind) => (await openai.embed(EMBEDDING.model, [kind === 'query' ? queryText(text) : text], EMBEDDING.dimensions))[0]!,
			hear: async (audio, mime, hint) => {
				const heard = await hearVia(chain, audio, mime, hint);
				served = heard.route;
				return heard.hearing;
			},
			translate: (entry, language) => translateEntry(entry, language, lean ? LUNA_6_TRANSLATORS : DEFAULT_TRANSLATORS, openai.chatJson, new Date().toISOString()),
			cache: translations,
			// Tier B: a question no entry answers is looked up in the crawl and written into a
			// card by the route's own model, then kept. Grounding decides whether it is shown.
			// The crawl is a static asset, fetched on the first request that needs it.
			raw: () => loadRaw(() => crawledQuestions(request, locals)),
			...(writer ? { write: writer } : {}),
			// Near is not answered: the six nearest are read, and the web is next if none answers.
			// Only where there is a web to go to.
			...(webAllowed(route) ? { judge: openaiJudge(env.OPENAI_API_KEY, env.SUARA_WEB_MODEL), guides: guidesFor(env.SUARA_GUIDES, cf ? 'cloudflare' : 'openai') } : {}),
			thresholds: cf ? CF_THRESHOLDS : THRESHOLDS,
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

/**
 * The crawl, from the site's own static files.
 *
 * In a Worker that is the ASSETS binding; under the dev server there is no binding, so the
 * same path is fetched over HTTP. Either way it is the file the build wrote, and it never
 * leaves the origin.
 */
async function crawledQuestions(request: Request, locals: unknown): Promise<{ questions: RawDoc[] }> {
	const url = new URL('/kb/raw-index.json', request.url);
	const assets = (locals as { runtime?: { env?: { ASSETS?: { fetch: (req: Request) => Promise<Response> } } } }).runtime?.env
		?.ASSETS;
	const res = assets ? await assets.fetch(new Request(url)) : await fetch(url);
	if (!res.ok) throw new Error(`crawl ${res.status}`);
	return (await res.json()) as { questions: RawDoc[] };
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
