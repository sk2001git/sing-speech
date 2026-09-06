import type { APIRoute } from 'astro';
import { providerFrom, type ProviderEnv } from '../../lib/providers';
import {
	WorkersAiTranscriber,
	type WorkersAiBinding,
} from '../../lib/providers/transcript';
import { runTurn, TurnRequest } from '../../lib/turn';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
	let parsed: TurnRequest;
	try {
		parsed = TurnRequest.parse(await request.json());
	} catch {
		return json({ error: 'bad request' }, 400);
	}

	// Cloudflare bindings arrive on locals.runtime.env in a deployed Worker. Under
	// `astro dev` there is no Worker, so fall back to import.meta.env, which Astro fills
	// from .env. There is no `process` in either runtime, so nothing reads it.
	const env = {
		...(import.meta.env as unknown as ProviderEnv),
		...((locals as { runtime?: { env?: ProviderEnv } }).runtime?.env ?? {}),
	} satisfies ProviderEnv;

	// The second channel runs only where the Workers AI binding exists. Without it the
	// turn still works on the audio model alone, just without corroboration — so a
	// missing binding degrades the cross-check rather than breaking the product.
	const ai = (locals as { runtime?: { env?: { AI?: WorkersAiBinding } } }).runtime?.env
		?.AI;
	const transcriber = ai ? new WorkersAiTranscriber(ai) : undefined;

	try {
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
