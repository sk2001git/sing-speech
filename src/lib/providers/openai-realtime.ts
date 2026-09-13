import { TOOL_NAME } from '../realtime-events';
import { RESPONSE_SCHEMA, systemPrompt } from './prompt';
import type { Pricing } from './types';

/**
 * Prices checked 2026-09-13 against developers.openai.com/api/docs/pricing, per 1M tokens.
 *
 * `audioPerMinUsd` assumes 600 audio tokens a minute (one per 100ms). That rate comes from
 * community threads about the older gpt-4o realtime models, NOT from a 2.1 doc page — see
 * obs-0018. Measure it from `response.done.usage` before a cost projection relies on it.
 *
 * For scale: `gemini-3.5-flash-lite` is $0.00058 a minute. gpt-realtime-2.1 is roughly 33x
 * that; mini roughly 10x.
 */
export const REALTIME_PRICES = {
	'gpt-realtime-2.1': {
		audioPerMinUsd: (32 / 1_000_000) * 600,
		inPerMTokUsd: 4,
		outPerMTokUsd: 24,
	},
	'gpt-realtime-2.1-mini': {
		audioPerMinUsd: (10 / 1_000_000) * 600,
		inPerMTokUsd: 0.6,
		outPerMTokUsd: 2.4,
	},
} satisfies Record<string, Pricing>;

export type RealtimeModel = keyof typeof REALTIME_PRICES;

const CALLS_ENDPOINT = 'https://api.openai.com/v1/realtime/calls';

export interface RealtimeSessionConfig {
	type: 'realtime';
	model: RealtimeModel;
	instructions: string;
	output_modalities: ['text'];
	audio: {
		input: {
			turn_detection: null;
			transcription: { model: string };
		};
	};
	tools: {
		type: 'function';
		name: string;
		description: string;
		parameters: typeof RESPONSE_SCHEMA;
	}[];
	tool_choice: 'required';
}

function isRealtimeModel(model: string): model is RealtimeModel {
	return Object.hasOwn(REALTIME_PRICES, model);
}

/**
 * The session, shaped by the same rules as the Gemini path.
 *
 * - `turn_detection: null` — no voice-activity detection. The user ends the turn by
 *   tapping, never a silence timer. This is the product's non-interruptive promise.
 * - `output_modalities: ['text']` — the model does not speak. Speech out stays on the
 *   device, which is both the budget and the rule that shown text equals spoken text.
 * - A forced tool call with `RESPONSE_SCHEMA` — the model returns an `Understanding`, not
 *   prose, so the policy thresholds apply unchanged.
 * - Input transcription — the corroboration channel from dec-0001. It never decides.
 */
export function realtimeSession(model = 'gpt-realtime-2.1'): RealtimeSessionConfig {
	if (!isRealtimeModel(model)) {
		throw new Error(
			`no pricing recorded for realtime model ${model}. Known: ${Object.keys(REALTIME_PRICES).join(', ')}`,
		);
	}
	return {
		type: 'realtime',
		model,
		instructions: `${systemPrompt()}\n\nAlways answer by calling ${TOOL_NAME} exactly once, with every field filled in. Never answer in any other way.`,
		output_modalities: ['text'],
		audio: {
			input: {
				turn_detection: null,
				transcription: { model: 'gpt-4o-transcribe' },
			},
		},
		tools: [
			{
				type: 'function',
				name: TOOL_NAME,
				description: 'Report what the person needs, how sure you are, and what to say back to them.',
				parameters: RESPONSE_SCHEMA,
			},
		],
		tool_choice: 'required',
	};
}

export interface RealtimeCallOptions {
	apiKey: string;
	model?: string;
	fetchImpl?: typeof fetch;
}

/**
 * Forward the browser's SDP offer to OpenAI and return the answer.
 *
 * The "unified interface" from the voice-webrtc guide: the server posts the offer and the
 * session together, so the API key never reaches the browser and no ephemeral key has to
 * be minted. The upstream status is passed through for the route to decide on.
 */
export async function createRealtimeCall(
	sdp: string,
	opts: RealtimeCallOptions,
): Promise<{ status: number; body: string }> {
	if (!opts.apiKey) throw new Error('OPENAI_API_KEY is not set');

	const session = realtimeSession(opts.model);
	// Bound, as in gemini.ts: an unbound global fetch called as a property throws
	// "Illegal invocation" in workerd.
	const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);

	const form = new FormData();
	form.set('sdp', sdp);
	form.set('session', JSON.stringify(session));

	const res = await doFetch(CALLS_ENDPOINT, {
		method: 'POST',
		headers: { Authorization: `Bearer ${opts.apiKey}` },
		body: form,
	});
	return { status: res.status, body: await res.text() };
}
