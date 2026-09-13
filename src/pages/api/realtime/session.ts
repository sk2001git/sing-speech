import type { APIRoute } from 'astro';
import { runtimeEnv } from '../../../lib/env';
import { createRealtimeCall } from '../../../lib/providers/openai-realtime';

export const prerender = false;

/** A browser SDP offer is a few kilobytes. Anything far larger is not one. */
const MAX_OFFER_BYTES = 20_000;

/**
 * Exchange the browser's WebRTC offer for OpenAI's answer.
 *
 * The browser posts its SDP here, this route adds the session config and the API key
 * and forwards both to OpenAI, and the browser gets back only the answer SDP. The key
 * stays on the server.
 */
export const POST: APIRoute = async ({ request }) => {
	const sdp = await request.text();
	if (!sdp.startsWith('v=') || sdp.length > MAX_OFFER_BYTES) {
		return new Response('bad offer', { status: 400 });
	}

	const env = await runtimeEnv();

	try {
		const call = await createRealtimeCall(sdp, {
			apiKey: env.OPENAI_API_KEY ?? '',
			model: env.SUARA_OPENAI_MODEL || undefined,
		});
		if (call.status < 200 || call.status >= 300) {
			console.error('realtime call failed:', call.status, call.body.slice(0, 300));
			return new Response('realtime unavailable', { status: 502 });
		}
		return new Response(call.body, {
			status: 200,
			headers: { 'content-type': 'application/sdp' },
		});
	} catch (err) {
		console.error('realtime session failed:', err instanceof Error ? err.message : err);
		return new Response('realtime unavailable', { status: 502 });
	}
};
