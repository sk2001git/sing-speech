import type { APIRoute } from 'astro';
import { z } from 'zod';
import audio from '../../../data/kb/audio.json';
import { runtimeEnv } from '../../lib/env';
import { resolveRoute } from '../../lib/routes';
import { voiceFor } from '../../lib/routes/voice';
import { audioPath, speechKey } from '../../lib/voice-cache';

export const prerender = false;

const SpeakRequest = z.object({
	text: z.string().min(1).max(1000),
	language: z.enum(['en', 'zh-Hans']).default('en'),
	route: z.string().max(40).optional(),
});

const built = audio as Record<string, { text: string; voice: string; model: string }>;

type Ctx = { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } };

/**
 * Speech in the route's own voice, paid for once.
 *
 * A line that was spoken at build time (every card and step) redirects to its file. A new
 * line is spoken once and kept in the Worker cache, keyed by words, voice and model. 204
 * means "no voice on this route, or it failed": the phone speaks instead.
 *
 * GET, so the phone's audio element plays it as it arrives (plan-suara-0021, L5); POST is kept
 * for callers that send a body.
 */
export const GET: APIRoute = async ({ request, locals }) => {
	const q = new URL(request.url).searchParams;
	const parsed = SpeakRequest.safeParse({ text: q.get('text') ?? '', language: q.get('language') ?? undefined, route: q.get('route') ?? undefined });
	if (!parsed.success) return new Response(null, { status: 400 });
	return speak(parsed.data, request, locals as Ctx);
};

export const POST: APIRoute = async ({ request, locals }) => {
	let req: z.infer<typeof SpeakRequest>;
	try {
		req = SpeakRequest.parse(await request.json());
	} catch {
		return new Response(null, { status: 400 });
	}
	return speak(req, request, locals as Ctx);
};

async function speak(req: z.infer<typeof SpeakRequest>, request: Request, locals: Ctx): Promise<Response> {

	const env = await runtimeEnv();
	const voice = voiceFor(resolveRoute(req.route, env.SUARA_ROUTE), env);
	if (!voice) return new Response(null, { status: 204 });

	// Keyed by the route's own voice and model: the local route never plays OpenAI's recording.
	const key = await speechKey(req.text, voice.voice, voice.model);

	// Built at `npx tsx scripts/kb/build-audio.ts`: served as a static file, no vendor call.
	if (built[key]) return Response.redirect(new URL(audioPath(key), request.url).toString(), 302);

	const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
	const cacheKey = new Request(new URL(`/_speech/${key}.mp3`, request.url).toString());
	const hit = await cache?.match(cacheKey);
	// Which path answered, for anyone timing it: a cached line or a freshly made one.
	if (hit) {
		const kept = new Response(hit.body, hit);
		kept.headers.set('x-speech', 'kept');
		return kept;
	}

	try {
		const spoken = await voice.speak(req.text, req.language);
		const headers = { 'content-type': spoken.contentType, 'cache-control': 'public, max-age=31536000, immutable' };
		const fresh = { ...headers, 'x-speech': 'made' };
		// One copy to the reader as it is made, one to the cache after the reply, so the reader
		// hears it sooner and the next reader costs nothing (L5). It used to wait for the cache.
		// Called on its context: detached, the runtime refuses it ("Illegal invocation").
		const ctx = locals.cfContext;
		if (spoken.body && cache && ctx?.waitUntil) {
			const [reader, kept] = spoken.body.tee();
			ctx.waitUntil(cache.put(cacheKey, new Response(kept, { headers })).catch(() => {}));
			return new Response(reader, { headers: fresh });
		}
		const res = new Response(spoken.body, { headers });
		await cache?.put(cacheKey, res.clone());
		res.headers.set("x-speech", "made");
		return res;
	} catch (err) {
		// The operator reason (missing key, top-up) is logged; the text spoken is not.
		console.warn('voice unavailable:', err instanceof Error ? err.message.slice(0, 200) : err);
		return new Response(null, { status: 204 });
	}
}
