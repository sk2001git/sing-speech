import { GeminiProvider } from './gemini';
import {
	GeminiTranscriber,
	WorkersAiTranscriber,
	type TranscriptProvider,
	type WorkersAiBinding,
} from './transcript';
import type { TurnContext, VoiceProvider } from './types';

export type { Capabilities, Pricing, ProviderResult, TurnContext, Usage, VoiceProvider } from './types';
export { FakeProvider, anUnderstanding } from './fake';
export { GeminiProvider } from './gemini';
export {
	FakeTranscriber,
	GeminiTranscriber,
	WorkersAiTranscriber,
	type TranscriptProvider,
	type WorkersAiBinding,
} from './transcript';

export interface ProviderEnv {
	SUARA_PROVIDER?: string;
	SUARA_MODEL?: string;
	SUARA_TRANSCRIBER?: string;
	GEMINI_API_KEY?: string;
}

/**
 * Build the provider named by config.
 *
 * The registry is a switch on purpose. A plugin loader would be more elegant and would
 * also let a typo in an environment variable silently select nothing; here an unknown
 * id fails at startup with the list of what was valid.
 */
export function providerFrom(env: ProviderEnv): VoiceProvider {
	const id = env.SUARA_PROVIDER ?? 'gemini';

	switch (id) {
		case 'gemini': {
			const apiKey = env.GEMINI_API_KEY;
			if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
			return new GeminiProvider({
				apiKey,
				model: env.SUARA_MODEL as 'gemini-3.5-flash-lite' | undefined,
			});
		}
		default:
			throw new Error(`unknown SUARA_PROVIDER "${id}". Known: gemini`);
	}
}

/**
 * Pick a provider for one turn.
 *
 * Routing exists so the cheap general model can carry the common case while a
 * dialect-specialised model handles what it cannot. Today there is one provider and
 * this returns it — the seam is here so that adding MERaLiON later is a change to this
 * function and nothing else.
 */
export function routeTurn(
	providers: readonly VoiceProvider[],
	ctx: TurnContext,
): VoiceProvider {
	const audioCapable = providers.filter((p) => p.caps.audio);
	if (audioCapable.length === 0) {
		throw new Error('no audio-capable provider configured');
	}

	if (ctx.dialectHint) {
		const specialist = audioCapable.find((p) =>
			p.caps.languages.includes(ctx.dialectHint!),
		);
		if (specialist) return specialist;
	}

	// Cheapest by audio minute. Audio dominates the bill on a voice turn, so this is the
	// right axis to sort on rather than token price.
	return [...audioCapable].sort(
		(a, b) => a.price.audioPerMinUsd - b.price.audioPerMinUsd,
	)[0]!;
}

/**
 * Build the corroboration channel named by config, or none.
 *
 * Returning undefined is a supported outcome, not a failure: with no transcriber the
 * turn runs on the audio model alone and simply reports 'no-signal'. Corroboration is
 * an upgrade, so a missing binding or an unset variable must not break a turn.
 *
 * `workers-ai` is the default because it costs $0.00045 a minute against Gemini
 * Transcribe's $0.005 — roughly $1.80 versus $20 a month per thousand users.
 */
export function transcriberFrom(
	env: ProviderEnv & { AI?: WorkersAiBinding },
): TranscriptProvider | undefined {
	switch (env.SUARA_TRANSCRIBER ?? (env.AI ? 'workers-ai' : 'none')) {
		case 'none':
			return undefined;
		case 'workers-ai':
			return env.AI ? new WorkersAiTranscriber(env.AI) : undefined;
		case 'gemini':
			return env.GEMINI_API_KEY
				? new GeminiTranscriber(env.GEMINI_API_KEY)
				: undefined;
		default:
			throw new Error(
				`unknown SUARA_TRANSCRIBER "${env.SUARA_TRANSCRIBER}". Known: none, workers-ai, gemini`,
			);
	}
}
