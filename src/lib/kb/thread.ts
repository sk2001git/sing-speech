import { Hearing, HEARING_SCHEMA } from './hearing';

/**
 * A question and its corrections, as a conversation (owner, 2026-09-27: "a correction disclaimer to
 * overwrite the previous, so that any ai seeing it is able to deal with it accordingly. Like how we
 * have 'user' correction. use json idea here").
 *
 * Each turn is what the person said or typed. A turn with `correction: true` replaces or amends the
 * question before it: the earlier words were misheard or mistyped. A model reads the whole thread
 * and writes the one question the person means now, so "not Tan Tock Seng, Changi" becomes "How
 * long is the wait at Changi General A&E?". Everything after works on that question as usual.
 */
export interface Turn {
	role: 'user';
	kind: 'speech' | 'text';
	/** Their words: the transcript of what they said, or what was typed. */
	said: string;
	correction?: true;
}

export const RESOLVE_MODEL = 'gpt-6-luna';

const SYSTEM = `You are the ears of Suara, a voice-first help service for older people in Singapore. You are given one
person's question as a JSON conversation, {"turns": [...]}, oldest first. Each turn is what they said
(kind "speech", an automatic transcript that may have recognition mistakes) or what was typed for them
(kind "text", perhaps by a volunteer). A turn marked "correction": true replaces or amends the question
before it: the earlier words were misheard or mistyped, and the correction is what they actually mean.
A correction may be a whole new question, or only the part that was wrong ("not Tan Tock Seng, Changi").

Work out the one question the person is asking now, whole and standalone, and fill in:
- greeting: false.
- said: the latest turn's words, as given.
- meaning_en: one plain English sentence saying what they want to know, written as a search query. Keep
  every scheme name, place, card or number from the question, with the correction applied.
- short: at most five words saying what they asked, in the language of the latest turn.
- sentence: one short sentence saying back the corrected question, in the language of the latest turn,
  addressed to them. Never add anything they did not say.
- language: "zh" if the latest turn is mainly Chinese, "en" for English or Singlish, "other" otherwise.
- confidence: from 0 to 1, how sure you are of meaning_en.

Do not answer the question. Do not invent details.`;

const STRICT = { ...HEARING_SCHEMA, additionalProperties: false };

export function resolveBody(turns: Turn[], model = RESOLVE_MODEL) {
	return {
		model,
		store: false,
		reasoning: { effort: 'low' },
		input: [
			{ role: 'system', content: SYSTEM },
			{ role: 'user', content: JSON.stringify({ turns }) },
		],
		text: { format: { type: 'json_schema', name: 'hearing', strict: true, schema: STRICT } },
		max_output_tokens: 1200,
	};
}

/**
 * The corrected question. If the model cannot be reached, the correction as written stands: a
 * volunteer's typed words are a fair question on their own.
 */
export async function resolveQuestion(turns: Turn[], opts: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): Promise<Hearing> {
	const latest = turns.at(-1)!.said.trim();
	try {
		const res = await (opts.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
			method: 'POST',
			headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
			body: JSON.stringify(resolveBody(turns, opts.model)),
			signal: AbortSignal.timeout(8000),
		});
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as { output?: { type?: string; content?: { text?: string }[] }[] };
		const text = data.output?.find((o) => o.type === 'message')?.content?.find((c) => typeof c.text === 'string')?.text ?? '';
		return Hearing.parse({ ...JSON.parse(text), greeting: false, said: latest });
	} catch (err) {
		console.error('correction not resolved, using it as written:', err instanceof Error ? err.message.slice(0, 120) : err);
		return Hearing.parse({ greeting: false, said: latest, meaning_en: latest, short: latest.slice(0, 40), sentence: latest, language: /[一-鿿]/.test(latest) ? 'zh' : 'en', confidence: 0.5 });
	}
}
