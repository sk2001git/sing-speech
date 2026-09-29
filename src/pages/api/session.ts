import type { APIRoute } from 'astro';
import { z } from 'zod';
import { runtimeEnv } from '../../lib/env';
import { sessionSecret, type GuardEnv } from '../../lib/guard/guard';
import { newSessionId, SESSION_COOKIE, SESSION_SECONDS, signSession } from '../../lib/guard/session';

export const prerender = false;

const Body = z.object({ token: z.string().max(4096).optional() });

interface SessionEnv extends GuardEnv {
	/** Secret. Turnstile's server key; with it, a session needs a passed challenge. */
	SUARA_TURNSTILE_SECRET?: string;
}

/**
 * A visitor's session, once per visit (vault plan-suara-0021, H3). With SUARA_TURNSTILE_SECRET set,
 * the page's Turnstile token is checked with Cloudflare first: tokens are single use and last five
 * minutes, so the session cookie is what later calls carry. Getting a session is itself limited
 * per address by the guard.
 */
export const POST: APIRoute = async ({ request }) => {
	const parsed = Body.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) return new Response(null, { status: 400 });
	const env = (await runtimeEnv()) as SessionEnv;

	if (env.SUARA_TURNSTILE_SECRET) {
		if (!parsed.data.token) return json({ error: 'challenge' }, 403);
		const form = new FormData();
		form.append('secret', env.SUARA_TURNSTILE_SECRET);
		form.append('response', parsed.data.token);
		const ip = request.headers.get('cf-connecting-ip');
		if (ip) form.append('remoteip', ip);
		const verdict = (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
			.then((r) => r.json())
			.catch(() => ({ success: false }))) as { success?: boolean };
		if (!verdict.success) return json({ error: 'challenge' }, 403);
	} else if (!import.meta.env.DEV) {
		// Open without a challenge until the owner adds the secret: logged so it is not forgotten.
		console.warn('SUARA_TURNSTILE_SECRET is not set: sessions are issued without a challenge');
	}

	const secret = sessionSecret(env, import.meta.env.DEV);
	if (!secret) return json({ error: 'not-configured' }, 503);
	const token = await signSession(secret, newSessionId(), Date.now() + SESSION_SECONDS * 1000);
	const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
	const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
	headers.append('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`);
	// Readable by the page, and says only that there is a session, so a reload does not ask again.
	headers.append('set-cookie', `suara_has=1; Path=/; SameSite=Strict; Max-Age=${SESSION_SECONDS - 60}${secure}`);
	return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}
