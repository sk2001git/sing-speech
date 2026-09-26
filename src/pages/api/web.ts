import type { APIRoute } from 'astro';
import { z } from 'zod';
import { EntryLanguage } from '../../lib/kb/entry';
import { searchWeb, webAllowed, type WebStage } from '../../lib/kb/web-answer';
import { runtimeEnv } from '../../lib/env';
import { resolveRoute } from '../../lib/routes';
import { EMBEDDING } from '../../lib/kb/corpus';
import { queryText } from '../../lib/kb/embed';
import { guides, keepAs } from '../../lib/kb/web-guides';
import { OpenAi } from '../../lib/providers/openai';

export const prerender = false;

const WebRequest = z.object({
	question: z.string().trim().min(1).max(300),
	language: EntryLanguage,
	route: z.string().optional(),
	/** The English meaning Suara searched. Given, the answer is kept under it for the next person. */
	query: z.string().trim().min(1).max(240).optional(),
});

/**
 * A question Suara had no answer for, searched on the web (vault plan
 * suara-2026-09-25-feature-web-steps). OpenAI routes only.
 *
 * Streams one JSON object per line, so the phone can show each real stage as it happens:
 *   {"type":"stage","stage":"searching"} ... {"type":"answer","answer":{...}} or {"type":"error"}
 */
export const POST: APIRoute = async ({ request }) => {
	let parsed: z.infer<typeof WebRequest>;
	try {
		parsed = WebRequest.parse(await request.json());
	} catch {
		return json({ error: 'bad request' }, 400);
	}
	const env = await runtimeEnv();
	if (!webAllowed(resolveRoute(parsed.route, env.SUARA_ROUTE))) return json({ error: 'not on this route' }, 404);
	if (!env.OPENAI_API_KEY) return json({ error: 'web search is not set up' }, 503);
	const apiKey = env.OPENAI_API_KEY;
	const model = env.SUARA_WEB_MODEL;

	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
			try {
				const answer = await searchWeb(parsed.question, parsed.language, {
					apiKey,
					...(model ? { model } : {}),
					onStage: (s: WebStage) => send({ type: 'stage', ...s }),
					signal: request.signal,
				});
				send({ type: 'answer', answer });
				// Kept for next time, after they already have it: official pages straight in, the
				// rest held for the owner (vault dec-suara-0024).
				if (parsed.query && keepAs(answer)) {
					try {
						const [vector] = await new OpenAi({ apiKey }).embed(EMBEDDING.model, [queryText(parsed.query)], EMBEDDING.dimensions);
						if (vector) guides.save({ question: parsed.query, vector, answer, language: parsed.language });
					} catch (err) {
						console.error('web guide not kept:', err instanceof Error ? err.message.slice(0, 120) : err);
					}
				}
			} catch (err) {
				// Nothing about the person reaches the log: no question, no reply body.
				console.error('web search failed:', err instanceof Error ? err.message.slice(0, 200) : err);
				send({ type: 'error' });
			}
			controller.close();
		},
	});
	return new Response(body, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
