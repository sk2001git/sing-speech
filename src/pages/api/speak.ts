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

const MODEL = 'gpt-4o-mini-tts';
const built = audio as Record<string, { text: string; voice: string; model: string }>;

/**
 * Speech in the route's own voice, paid for once.
 *
 * A line that was spoken at build time (every card and step) redirects to its file. A new
 * line is spoken once and kept in the Worker cache, keyed by words, voice and model. 204
 * means "no voice on this route, or it failed": the phone speaks instead.
 */
export const POST: APIRoute = async ({ request }) => {
	let req: z.infer<typeof SpeakRequest>;
	try {
		req = SpeakRequest.parse(await request.json());
	} catch {
		return new Response(null, { status: 400 });
	}

	const env = await runtimeEnv();
	const voice = voiceFor(resolveRoute(req.route, env.SUARA_ROUTE), env);
	if (!voice) return new Response(null, { status: 204 });

	const voiceName = env.SUARA_OPENAI_VOICE ?? 'marin';
	const key = await speechKey(req.text, voiceName, MODEL);

	// Built at `npx tsx scripts/kb/build-audio.ts`: served as a static file, no vendor call.
	if (built[key]) return Response.redirect(new URL(audioPath(key), request.url).toString(), 302);

	const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
	const cacheKey = new Request(new URL(`/_speech/${key}.mp3`, request.url).toString());
	const hit = await cache?.match(cacheKey);
	if (hit) return hit;

	try {
		const spoken = await voice.speak(req.text, req.language);
		const res = new Response(spoken.body, {
			headers: { 'content-type': spoken.contentType, 'cache-control': 'public, max-age=31536000, immutable' },
		});
		// One copy to the reader, one to the cache, so the next reader costs nothing.
		await cache?.put(cacheKey, res.clone());
		return res;
	} catch (err) {
		// The operator reason (missing key, top-up) is logged; the text spoken is not.
		console.warn('voice unavailable:', err instanceof Error ? err.message.slice(0, 200) : err);
		return new Response(null, { status: 204 });
	}
};
