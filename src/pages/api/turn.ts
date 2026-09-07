import type { APIRoute } from 'astro';
import {
	providerFrom,
	transcriberFrom,
	type ProviderEnv,
	type WorkersAiBinding,
} from '../../lib/providers';
import { runTurn, TurnRequest } from '../../lib/turn';

export const prerender = false;

interface RuntimeEnv extends ProviderEnv {
	AI?: WorkersAiBinding;
}

/**
 * Read Worker bindings and secrets.
 *
 * `Astro.locals.runtime.env` was removed in Astro 6; bindings now come from the
 * `cloudflare:workers` virtual module. It is imported dynamically and guarded because
 * that module only exists inside workerd — under plain Node (tests, or a non-Worker
 * runtime) the import throws, and falling back to `import.meta.env` keeps the route
 * working rather than turning a missing binding into a 500.
 */
async function runtimeEnv(): Promise<RuntimeEnv> {
	let bindings: RuntimeEnv = {};
	try {
		const mod = (await import('cloudflare:workers')) as { env?: RuntimeEnv };
		bindings = mod.env ?? {};
	} catch {
		// Not running inside a Worker. import.meta.env alone is correct here.
	}
	return { ...(import.meta.env as unknown as RuntimeEnv), ...bindings };
}

export const POST: APIRoute = async ({ request }) => {
	let parsed: TurnRequest;
	try {
		parsed = TurnRequest.parse(await request.json());
	} catch {
		return json({ error: 'bad request' }, 400);
	}

	const env = await runtimeEnv();

	// Undefined here is fine: the turn runs on the audio model alone and reports
	// 'no-signal', so a missing binding degrades the cross-check rather than the product.
	const transcriber = transcriberFrom(env);

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
