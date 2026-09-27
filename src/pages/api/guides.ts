import type { APIRoute } from 'astro';
import { z } from 'zod';
import { readSession } from '../../lib/admin-auth';
import { runtimeEnv } from '../../lib/env';
import { guidesFor } from '../../lib/kb/web-guides';

export const prerender = false;

/**
 * The owner's review of kept web guides (vault dec-suara-0024). Signed-in only.
 *
 *   GET                              every kept guide, newest first; ?id= for one in full
 *   POST {"id","action":"approve"}   a guide waiting for review goes live
 *   POST {"id","action":"discard"}   a guide is forgotten
 */
const Act = z.object({ id: z.string().min(1).max(100), action: z.enum(['approve', 'discard']) });

export const GET: APIRoute = async ({ request, url }) => {
	const env = await runtimeEnv();
	if (!(await readSession(request.headers.get('cookie'), env.SUARA_ADMIN_PASSWORD))) return json({ error: 'sign in first' }, 401);
	const store = guidesFor(env.SUARA_GUIDES);
	const id = url.searchParams.get('id');
	if (id) {
		const g = await store.get(id);
		return g ? json({ guide: g }) : json({ error: 'no such guide' }, 404);
	}
	return json({ guides: await store.list() });
};

export const POST: APIRoute = async ({ request }) => {
	const env = await runtimeEnv();
	if (!(await readSession(request.headers.get('cookie'), env.SUARA_ADMIN_PASSWORD))) return json({ error: 'sign in first' }, 401);
	let act: z.infer<typeof Act>;
	try {
		act = Act.parse(await request.json());
	} catch {
		return json({ error: 'bad request' }, 400);
	}
	const store = guidesFor(env.SUARA_GUIDES);
	const done = act.action === 'approve' ? await store.approve(act.id) : await store.remove(act.id);
	return done ? json({ ok: true, ...act }) : json({ error: act.action === 'approve' ? 'no such guide waiting' : 'no such guide' }, 404);
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
