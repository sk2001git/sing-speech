import type { APIRoute } from 'astro';
import { z } from 'zod';
import { checkPassword, clearedCookie, readSession, sessionCookie } from '../../../lib/admin-auth';
import { runtimeEnv } from '../../../lib/env';

export const prerender = false;

/**
 * The owner's sign-in (lib/admin-auth.ts).
 *   GET     {"signedIn": boolean}
 *   POST    {"password"} signs in for 12 hours
 *   DELETE  signs out
 */
const SignIn = z.object({ password: z.string().min(1).max(200) });

export const GET: APIRoute = async ({ request }) => {
	const env = await runtimeEnv();
	return json({ signedIn: await readSession(request.headers.get('cookie'), env.SUARA_ADMIN_PASSWORD) });
};

export const POST: APIRoute = async ({ request }) => {
	const env = await runtimeEnv();
	let password: string;
	try {
		password = SignIn.parse(await request.json()).password;
	} catch {
		return json({ error: 'bad request' }, 400);
	}
	if (!(await checkPassword(password, env.SUARA_ADMIN_PASSWORD))) {
		// A second's wait on every wrong guess: slow for a script, unnoticed by the owner.
		await new Promise((r) => setTimeout(r, 1000));
		return json({ error: 'wrong password' }, 401);
	}
	return json({ signedIn: true }, 200, { 'set-cookie': await sessionCookie(env.SUARA_ADMIN_PASSWORD!) });
};

export const DELETE: APIRoute = async () => json({ signedIn: false }, 200, { 'set-cookie': clearedCookie });

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}
