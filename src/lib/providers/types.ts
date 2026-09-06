import type { Understanding } from '../understanding';

/**
 * What a turn knows besides the audio itself.
 *
 * Deliberately small. Note that no prior audio appears here and there is no field it
 * could go in: audio bills at roughly 32 tokens per second, about 13x the density of
 * the text it carries, so resending it would multiply every turn by the whole history.
 * Audio enters the context once. What persists is the structured result.
 */
export interface TurnContext {
	/** Structured results of prior turns this session. Never raw audio. */
	history: Understanding[];
	/** Which intents remain plausible, if a previous turn narrowed them. */
	candidates?: readonly string[];
	/** Set by the helper during setup when the user speaks a dialect. Routes providers. */
	dialectHint?: string;
}

/**
 * Per-unit prices, in USD.
 *
 * This is not documentation. `src/eval/cost.ts` reads these fields to price a replayed
 * session, so a provider that lies here makes the cost harness lie too. Update them
 * when the vendor does, and record the date you checked in the provider file.
 */
export interface Pricing {
	audioPerMinUsd: number;
	inPerMTokUsd: number;
	outPerMTokUsd: number;
}

export interface Capabilities {
	/** False means this provider cannot take audio and must not be routed voice turns. */
	audio: boolean;
	/** Whether it can be held to a JSON schema, or needs parsing and repair. */
	structured: boolean;
	/** ISO-ish codes from `LANGUAGES`. Used for routing, not for filtering input. */
	languages: readonly string[];
}

/** What a call actually consumed, so the cost harness measures rather than estimates. */
export interface Usage {
	audioSeconds: number;
	inputTokens: number;
	outputTokens: number;
}

export interface ProviderResult {
	understanding: Understanding;
	usage: Usage;
	/** Wall-clock milliseconds. Latency is a UX property here, so it gets measured. */
	latencyMs: number;
}

/**
 * The seam that makes models swappable.
 *
 * Everything above this interface deals in `Understanding` and knows nothing about
 * Gemini, MERaLiON, or whatever replaces them. Swapping a model is a config change.
 */
export interface VoiceProvider {
	readonly id: string;
	readonly caps: Capabilities;
	readonly price: Pricing;
	understand(audio: ArrayBuffer, ctx: TurnContext): Promise<ProviderResult>;
}
