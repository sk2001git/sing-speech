import type { APIRoute } from 'astro';
import { z } from 'zod';
import { runtimeEnv } from '../../lib/env';
import { resolveRoute } from '../../lib/routes';
import { voiceFor } from '../../lib/routes/voice';

export const prerender = false;

const SpeakRequest = z.object({
	text: z.string().min(1).max(1000),
	language: z.enum(['en', 'zh-Hans']).default('en'),
	route: z.string().max(40).optional(),
});

/**
 * Speech in the route's own voice. 204 means "this route has no voice, or it failed":
 * the phone speaks instead, so a reader always hears something.
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
	try {
		const audio = await voice.speak(req.text, req.language);
		return new Response(audio.body, { headers: { 'content-type': audio.contentType, 'cache-control': 'no-store' } });
	} catch (err) {
		// The operator reason (missing key, top-up) is logged; the text spoken is not.
		console.warn('voice unavailable:', err instanceof Error ? err.message.slice(0, 200) : err);
		return new Response(null, { status: 204 });
	}
};
