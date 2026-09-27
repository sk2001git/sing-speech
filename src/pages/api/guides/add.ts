import type { APIRoute } from 'astro';
import { z } from 'zod';
import { readSession } from '../../../lib/admin-auth';
import { runtimeEnv } from '../../../lib/env';
import { addGuide } from '../../../lib/kb/add-guide';
import { EMBEDDING } from '../../../lib/kb/corpus';
import { queryText } from '../../../lib/kb/embed';
import { searchWeb } from '../../../lib/kb/web-answer';
import { guidesFor } from '../../../lib/kb/web-guides';
import { OpenAi } from '../../../lib/providers/openai';

export const prerender = false;

/**
 * The owner adds a guide by question (lib/kb/add-guide.ts). Signed-in only. Streams one JSON
 * object per line, like /api/web: stages, then {"type":"guide","guide"} or {"type":"error","error"}.
 */
const Add = z.object({ question: z.string().trim().min(3).max(240) });

export const POST: APIRoute = async ({ request }) => {
	const env = await runtimeEnv();
	if (!(await readSession(request.headers.get('cookie'), env.SUARA_ADMIN_PASSWORD))) return json({ error: 'sign in first' }, 401);
	if (!env.OPENAI_API_KEY) return json({ error: 'web search is not set up' }, 503);
	let question: string;
	try {
		question = Add.parse(await request.json()).question;
	} catch {
		return json({ error: 'bad request' }, 400);
	}
	const apiKey = env.OPENAI_API_KEY;
	const model = env.SUARA_WEB_MODEL;
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
			const r = await addGuide(question, {
				search: (q, onStage) => searchWeb(q, 'en', { apiKey, ...(model ? { model } : {}), onStage, signal: request.signal }),
				embed: async (q) => (await new OpenAi({ apiKey }).embed(EMBEDDING.model, [queryText(q)], EMBEDDING.dimensions))[0]!,
				store: guidesFor(env.SUARA_GUIDES),
				onStage: (s) => send({ type: 'stage', ...s }),
			});
			send(r.ok ? { type: 'guide', guide: r.guide } : { type: 'error', error: r.error });
			controller.close();
		},
	});
	return new Response(body, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
