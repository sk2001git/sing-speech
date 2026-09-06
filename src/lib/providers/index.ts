import { GeminiProvider } from './gemini';
import type { TurnContext, VoiceProvider } from './types';

export type { Capabilities, Pricing, ProviderResult, TurnContext, Usage, VoiceProvider } from './types';
export { FakeProvider, anUnderstanding } from './fake';
export { GeminiProvider } from './gemini';

export interface ProviderEnv {
	SUARA_PROVIDER?: string;
	SUARA_MODEL?: string;
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
				model: env.SUARA_MODEL as 'gemini-2.5-flash-lite' | undefined,
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
