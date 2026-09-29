import { defineMiddleware } from 'astro:middleware';
import { runtimeEnv } from './lib/env';
import { guard, secure, type GuardEnv } from './lib/guard/guard';

/**
 * Every request passes the guard (lib/guard/guard.ts, vault plan-suara-0021): the paid APIs need
 * the page's own session, keep to a rate, and reserve their cost from the day's budget. Pages and
 * files pass untouched, with the security headers added.
 */
export const onRequest = defineMiddleware(async (context, next) => {
	const env = (await runtimeEnv()) as GuardEnv;
	const refused = await guard(context.request, env, { dev: import.meta.env.DEV, now: Date.now() });
	return secure(refused ?? (await next()));
});
