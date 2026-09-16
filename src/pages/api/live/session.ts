import type { APIRoute } from 'astro';
import { z } from 'zod';
import { runtimeEnv } from '../../../lib/env';
import { createLiveSession } from '../../../lib/routes/live';
import { RouteUnavailable } from '../../../lib/routes/types';

export const prerender = false;

const Offer = z.object({ sdp: z.string().min(1).max(200_000) });

/**
 * Open a GPT-Live session for this browser. The key stays here: the page sends its WebRTC
 * offer, OpenAI answers, and the answer goes back to the page.
 */
export const POST: APIRoute = async ({ request }) => {
	let offer: z.infer<typeof Offer>;
	try {
		offer = Offer.parse(await request.json());
	} catch {
		return json({ error: 'bad request' }, 400);
	}

	const env = await runtimeEnv();
	try {
		const session = await createLiveSession(env.OPENAI_API_KEY, offer.sdp, { voice: env.SUARA_LIVE_VOICE, model: env.SUARA_LIVE_MODEL });
		return json(session);
	} catch (err) {
		const reason = err instanceof RouteUnavailable ? err.reason : 'vendor-error';
		// The operator reason is logged and returned; nothing about the person is.
		console.warn('live session unavailable:', err instanceof Error ? err.message.slice(0, 200) : err);
		return json({ error: 'live unavailable', reason }, 502);
	}
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
