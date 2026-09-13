import type { APIRoute } from 'astro';
import { runtimeEnv } from '../../lib/env';
import { providerFrom, transcriberFrom } from '../../lib/providers';
import { runTurn, TurnRequest } from '../../lib/turn';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	let parsed: TurnRequest;
	try {
		parsed = TurnRequest.parse(await request.json());
	} catch {
		return json({ error: 'bad request' }, 400);
	}

	try {
		// Only a speech turn needs an audio provider. A relayed realtime understanding or a
		// button confirmation must not fail because GEMINI_API_KEY is absent in OpenAI mode.
		if (parsed.kind !== 'speech') return json(await runTurn(parsed));

		const env = await runtimeEnv();
		// Undefined here is fine: the turn runs on the audio model alone and reports
		// 'no-signal', so a missing binding degrades the cross-check rather than the product.
		const transcriber = transcriberFrom(env);
		return json(await runTurn(parsed, providerFrom(env), transcriber));
	} catch (err) {
		// The client turns any failure into a plain spoken instruction. Nothing about the
		// error reaches the user, and nothing about the user reaches the log.
		console.error('turn failed:', err instanceof Error ? err.message : err);
		return json({ error: 'turn failed' }, 502);
	}
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}
