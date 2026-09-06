import type { Pricing, Usage } from './types';

/**
 * The second channel.
 *
 * Speech-to-text runs alongside the audio-reasoning provider, not instead of it. They
 * answer different questions and fail in different ways, which is the entire reason to
 * pay for both:
 *
 * - The audio model hears tone, hesitation, self-correction and dialect, and returns an
 *   intent. It is the one that decides.
 * - The transcriber returns words. It is better at proper nouns, numbers and dates —
 *   the lexical detail an intent classifier discards — and it produces the literal
 *   record that audit, dispute resolution and offline analytics need.
 *
 * The transcript never drives a decision. It corroborates one. A 46%-WER transcript
 * treated as content is a false record; the same transcript treated as a second opinion
 * is genuinely useful, because the ways it fails are not the ways the audio model fails.
 */
export interface TranscriptResult {
	text: string;
	/** The transcriber's own confidence, where it reports one. */
	confidence: number | null;
	/** Language the transcriber detected, which may disagree with the audio model. */
	language: string | null;
	usage: Usage;
	latencyMs: number;
}

export interface TranscriptProvider {
	readonly id: string;
	readonly price: Pricing;
	transcribe(audio: ArrayBuffer): Promise<TranscriptResult>;
}

/**
 * Cloudflare Workers AI Whisper.
 *
 * $0.00045 per audio minute as checked on 2026-09-07 — the cheapest credible
 * transcriber available, and it runs on the same platform this deploys to, so the audio
 * never leaves the account to reach it.
 */
export class WorkersAiTranscriber implements TranscriptProvider {
	readonly id = 'workers-ai:whisper';
	readonly price: Pricing = {
		audioPerMinUsd: 0.00045,
		inPerMTokUsd: 0,
		outPerMTokUsd: 0,
	};

	constructor(private readonly ai: WorkersAiBinding) {}

	async transcribe(audio: ArrayBuffer): Promise<TranscriptResult> {
		const started = Date.now();
		const res = await this.ai.run('@cf/openai/whisper', {
			audio: [...new Uint8Array(audio)],
		});

		return {
			text: res.text ?? '',
			// Whisper does not report a usable per-utterance confidence, and inventing one
			// would corrupt the corroboration maths. Absent is honest.
			confidence: null,
			language: null,
			usage: { audioSeconds: 0, inputTokens: 0, outputTokens: 0 },
			latencyMs: Date.now() - started,
		};
	}
}

export interface WorkersAiBinding {
	run(model: string, input: { audio: number[] }): Promise<{ text?: string }>;
}

/** Canned transcripts, so corroboration is testable with no key and no network. */
export class FakeTranscriber implements TranscriptProvider {
	readonly id = 'fake-transcriber';
	readonly price: Pricing = { audioPerMinUsd: 0, inPerMTokUsd: 0, outPerMTokUsd: 0 };

	constructor(private readonly text: string) {}

	async transcribe(): Promise<TranscriptResult> {
		return {
			text: this.text,
			confidence: null,
			language: null,
			usage: { audioSeconds: 0, inputTokens: 0, outputTokens: 0 },
			latencyMs: 0,
		};
	}
}
