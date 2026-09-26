import type { Entry } from './entry';

/**
 * Do the six nearest cards answer the question, or only share its subject?
 *
 * Similarity cannot tell: "how can I invest my CPF" came back a strong match of six CPF cards,
 * none of them about investing, and "top up my EZ-Link card" matched "How to apply for a CPF
 * top-up" (owner, 2026-09-27). When no card answers, the search looks further: an official
 * page first, then the web.
 *
 * `null` means the judge could not say (network, a bad reply): the search then behaves as it
 * did before the judge existed, rather than failing.
 */
export type Judge = (question: string, cards: Entry[]) => Promise<boolean | null>;

/** Checked against Artificial Analysis and live pricing for web answers (vault obs-0049). */
export const DEFAULT_JUDGE_MODEL = 'gpt-6-luna';

const SYSTEM = `You check whether a help service already has the answer to an older person's question.
You get their question and a few answer cards, each with a title and summary.
answered is true only if at least one card directly answers what they asked, so that reading it
tells them what they wanted to know or do. A card on the same topic that answers a different
question does not count. Give that card's id in card_id; otherwise an empty string.`;

const SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['answered', 'card_id'],
	properties: { answered: { type: 'boolean' }, card_id: { type: 'string' } },
} as const;

export function judgeBody(question: string, cards: Entry[], model = DEFAULT_JUDGE_MODEL) {
	const list = cards.map((c) => `- id: ${c.id}\n  title: ${c.title.full}\n  summary: ${c.summary.text}`).join('\n');
	return {
		model,
		reasoning: { effort: 'low' },
		input: [
			{ role: 'system', content: SYSTEM },
			{ role: 'user', content: `Question: ${question}\n\nCards:\n${list}` },
		],
		text: { format: { type: 'json_schema', name: 'judge', strict: true, schema: SCHEMA } },
		// Reasoning tokens come out of the same budget (see write.ts), so leave room.
		max_output_tokens: 1500,
	};
}

/** The judge on the OpenAI Responses API. Five seconds at most: a person is waiting. */
export function openaiJudge(key: string, model = DEFAULT_JUDGE_MODEL, fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Judge {
	return async (question, cards) => {
		try {
			const res = await fetchImpl('https://api.openai.com/v1/responses', {
				method: 'POST',
				headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
				body: JSON.stringify(judgeBody(question, cards, model)),
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (!res.ok) return null;
			const data = (await res.json()) as { output?: { type?: string; content?: { text?: string }[] }[] };
			const text = data.output?.find((o) => o.type === 'message')?.content?.find((c) => typeof c.text === 'string')?.text;
			const verdict = JSON.parse(text ?? '') as { answered?: unknown };
			return typeof verdict.answered === 'boolean' ? verdict.answered : null;
		} catch {
			return null;
		}
	};
}
