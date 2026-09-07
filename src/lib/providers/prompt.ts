import { INTENTS, INTENT_LABELS, LANGUAGES } from '../understanding';

/**
 * The system prompt, built once and shared by every real provider.
 *
 * Kept in one file for two reasons. It is the thing most likely to need tuning against
 * the fixture set, and it is the thing that must be byte-identical across turns so that
 * provider-side prompt caching actually hits — cached input bills at roughly a tenth of
 * the normal rate, which is a meaningful slice of a one-cent-per-user budget.
 */
export function systemPrompt(): string {
	const intentList = INTENTS.map((i) => `- ${i}: ${INTENT_LABELS[i]}`).join('\n');

	return `You are helping an elderly person in Singapore who is speaking to you in their own language. They may speak English, Singlish, Mandarin, Malay, Tamil, Hokkien, Cantonese, or mix several in one sentence.

Listen to the audio and decide which ONE of these they need:

${intentList}

Rules:

1. Do not transcribe. Judge what they need from how they sound, not from words you are unsure of. Hesitation, worry, a half-finished sentence and a switch of language are all evidence.
2. Report honest confidence. If the audio is unclear, or they could plausibly mean two different things, say so with a low number. A confident wrong answer causes far more harm here than an admitted uncertainty — someone will act on it.
3. Set needsHuman when they are distressed, when they ask for a person, or when the request is outside the list above.
4. Write "reply" in the SAME language they spoke, as one or two short sentences meant to be read aloud. Plain words. No lists, no formatting, no jargon. Assume it is being spoken by a machine to someone who may be hard of hearing.
5. Put anything specific they mentioned into "slots", as a list of {key, value} pairs — a clinic name, a person, a date. Do not invent entries. An empty list is the correct answer when they mentioned nothing specific.
6. Choose "language" from: ${LANGUAGES.join(', ')}. Use "sg" for code-switched Singlish and "unknown" only when you genuinely cannot tell.

Never guess to be helpful. A low confidence score gets them a clarifying question, which is a good outcome. A wrong high-confidence answer gets them the wrong government service, which is not.`;
}

/**
 * JSON Schema for structured output, in the subset the Google and OpenAI APIs both
 * accept. Deliberately hand-written rather than generated from the Zod schema: the
 * wire contract and the internal type serve different masters, and the response is
 * re-validated with Zod on arrival anyway.
 *
 * `slots` is a list of key/value pairs rather than an open-ended object because
 * Gemini's response schema rejects `additionalProperties` outright — a 400, not a
 * warning. The provider folds the list back into a record before validation, so the
 * shape the rest of the codebase sees is unaffected.
 */
export const RESPONSE_SCHEMA = {
	type: 'object',
	properties: {
		intent: { type: 'string', enum: [...INTENTS] },
		confidence: { type: 'number' },
		language: { type: 'string', enum: [...LANGUAGES] },
		slots: {
			type: 'array',
			items: {
				type: 'object',
				properties: { key: { type: 'string' }, value: { type: 'string' } },
				required: ['key', 'value'],
			},
		},
		reply: { type: 'string' },
		needsHuman: { type: 'boolean' },
	},
	required: ['intent', 'confidence', 'language', 'reply', 'needsHuman'],
} as const;
