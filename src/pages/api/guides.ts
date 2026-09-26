import type { APIRoute } from 'astro';
import { z } from 'zod';
import { runtimeEnv } from '../../lib/env';
import { guides } from '../../lib/kb/web-guides';

export const prerender = false;

/**
 * Web guides waiting for the owner: guides that cite any page outside .gov.sg are kept but not
 * served until approved (vault dec-suara-0024). GET lists them; POST {"id"} approves one.
 *
 * Dev and demo builds only: there is no sign-in yet, and approving puts a guide in front of
 * everyone. The review screen will be designed and shown before it is built.
 */
const Approve = z.object({ id: z.string().min(1).max(400) });

async function allowed(): Promise<boolean> {
	const env = await runtimeEnv();
	return import.meta.env.DEV || env.SUARA_DEMO === 'true';
}

export const GET: APIRoute = async () => {
	if (!(await allowed())) return json({ error: 'not here' }, 404);
	return json({
		pending: guides.pending().map((g) => ({ id: g.id, question: g.question, title: g.answer.title_full, sites: [...new Set(g.answer.sources.map((s) => s.site))], foundAt: g.foundAt })),
	});
};

export const POST: APIRoute = async ({ request }) => {
	if (!(await allowed())) return json({ error: 'not here' }, 404);
	let id: string;
	try {
		id = Approve.parse(await request.json()).id;
	} catch {
		return json({ error: 'bad request' }, 400);
	}
	return guides.approve(id) ? json({ approved: id }) : json({ error: 'no such guide waiting' }, 404);
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
