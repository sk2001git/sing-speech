/**
 * How a turn is heard.
 *
 * `gemini` records the whole utterance and posts it — the original flow. `openai` streams
 * the microphone to OpenAI Realtime over WebRTC while the button is held open. Both end in
 * the same `Understanding`, the same policy and the same readback card.
 */
export const MODES = ['gemini', 'openai'] as const;
export type Mode = (typeof MODES)[number];

function isMode(value: unknown): value is Mode {
	return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

/**
 * `?mode=` wins for review, then `SUARA_MODE`, then Gemini.
 *
 * An unknown value falls through rather than throwing: a typo in a URL must still give
 * the person a working page, not an error.
 */
export function resolveMode(query: string | null | undefined, configured: string | undefined): Mode {
	if (isMode(query)) return query;
	if (isMode(configured)) return configured;
	return 'gemini';
}
