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
	transcribe(audio: ArrayBuffer, mimeType?: string): Promise<TranscriptResult>;
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

/**
 * Gemini 3.5 Transcribe, file endpoint.
 *
 * Prices checked 2026-09-08: $2.00 per 1M audio input tokens and $12.00 per 1M text
 * output, blending to roughly $0.005 per minute. That is about 11x Cloudflare Whisper,
 * which matters: as the corroboration channel it costs ~$20/month per thousand users
 * against ~$1.80 for Whisper.
 *
 * What it buys is a second channel worth listening to. Google reports 2.6% WER, where
 * Whisper is documented misclassifying Singaporean-accented English as Malay in over 90%
 * of some conditions. A corroborator that is wrong in ordinary ways manufactures false
 * disagreements, and a false disagreement costs the user a clarifying question they did
 * not need. A cheap bad second opinion is worse than none.
 *
 * There is also `gemini-3.5-transcribe-live` for real-time streaming over WebSockets at
 * ~$0.009/min. Not used here: this design captures whole utterances by design and has
 * nothing to stream into, and streaming would nearly double this line.
 */
export class GeminiTranscriber implements TranscriptProvider {
	readonly id = 'gemini:3.5-transcribe';
	readonly price: Pricing = {
		audioPerMinUsd: 0.005,
		inPerMTokUsd: 2.0,
		outPerMTokUsd: 12.0,
	};

	private readonly doFetch: typeof fetch;

	constructor(
		private readonly apiKey: string,
		fetchImpl?: typeof fetch,
	) {
		// Bound, for the same reason as in gemini.ts: an unbound global fetch called as a
		// property throws "Illegal invocation" in workerd.
		this.doFetch = fetchImpl ?? fetch.bind(globalThis);
	}

	async transcribe(audio: ArrayBuffer, mimeType = 'audio/webm'): Promise<TranscriptResult> {
		const started = Date.now();

		const res = await this.doFetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key=${this.apiKey}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					contents: [
						{
							role: 'user',
							parts: [
								{ text: 'Transcribe this audio verbatim. Output only the transcript.' },
								{ inlineData: { mimeType, data: base64(audio) } },
							],
						},
					],
				}),
			},
		);

		if (!res.ok) throw new Error(`gemini-transcribe ${res.status}: ${await res.text()}`);

		const json = (await res.json()) as {
			candidates?: { content?: { parts?: { text?: string }[] } }[];
			usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
		};

		const usage = json.usageMetadata;
		return {
			text: json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '',
			// No calibrated per-utterance confidence is returned, and inventing one would
			// corrupt the corroboration maths.
			confidence: null,
			language: null,
			usage: {
				audioSeconds: (usage?.promptTokenCount ?? 0) / 32,
				inputTokens: usage?.promptTokenCount ?? 0,
				outputTokens: usage?.candidatesTokenCount ?? 0,
			},
			latencyMs: Date.now() - started,
		};
	}
}

function base64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
	return btoa(binary);
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
