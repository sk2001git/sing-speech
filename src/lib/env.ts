import type { ProviderEnv, WorkersAiBinding } from './providers';

export interface RuntimeEnv extends ProviderEnv {
	AI?: WorkersAiBinding;
	/** Secret. Only the realtime session route reads it; it never reaches the browser. */
	OPENAI_API_KEY?: string;
	SUARA_OPENAI_MODEL?: string;
	/** `gemini` or `openai`. `?mode=` overrides it per page load. */
	SUARA_MODE?: string;
	/** `true` shows unverified sample flows outside the dev server. */
	SUARA_DEMO?: string;
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
export async function runtimeEnv(): Promise<RuntimeEnv> {
	let bindings: RuntimeEnv = {};
	try {
		const mod = (await import('cloudflare:workers')) as { env?: RuntimeEnv };
		bindings = mod.env ?? {};
	} catch {
		// Not running inside a Worker. import.meta.env alone is correct here.
	}
	return { ...(import.meta.env as unknown as RuntimeEnv), ...bindings };
}
