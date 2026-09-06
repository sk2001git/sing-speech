import { Understanding } from '../understanding';
import { RESPONSE_SCHEMA, systemPrompt } from './prompt';
import type { Pricing, ProviderResult, TurnContext, VoiceProvider } from './types';

/**
 * Prices checked 2026-09-07 against ai.google.dev/gemini-api/docs/pricing.
 * Audio bills at 32 tokens per second, so a minute is 1,920 tokens.
 *
 * Re-check before trusting the cost harness — these move, and a stale number here makes
 * every downstream projection wrong. See obs-0008 in the vault.
 */
const PRICES: Record<string, Pricing> = {
	'gemini-2.5-flash-lite': {
		audioPerMinUsd: (0.3 / 1_000_000) * 1920,
		inPerMTokUsd: 0.1,
		outPerMTokUsd: 0.4,
	},
	'gemini-3.8-flash': {
		audioPerMinUsd: (0.75 / 1_000_000) * 1920,
		inPerMTokUsd: 0.75,
		outPerMTokUsd: 3.75,
	},
};

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiOptions {
	apiKey: string;
	model?: keyof typeof PRICES;
	fetchImpl?: typeof fetch;
}

/**
 * Audio in, understanding out, one call.
 *
 * There is no transcription step and no second model to interpret a string. That is the
 * point: the waveform reaches the reasoning directly, so dialect speech that would
 * transcribe badly never has to survive being turned into words.
 */
export class GeminiProvider implements VoiceProvider {
	readonly id: string;
	readonly caps = {
		audio: true,
		structured: true,
		languages: ['en', 'zh', 'ms', 'ta', 'sg', 'yue'] as const,
	};
	readonly price: Pricing;

	private readonly apiKey: string;
	private readonly model: string;
	private readonly doFetch: typeof fetch;

	constructor(opts: GeminiOptions) {
		const model = opts.model ?? 'gemini-2.5-flash-lite';
		const price = PRICES[model];
		if (!price) throw new Error(`no pricing recorded for model ${model}`);

		this.id = `gemini:${model}`;
		this.model = model;
		this.price = price;
		this.apiKey = opts.apiKey;
		this.doFetch = opts.fetchImpl ?? fetch;
	}

	async understand(audio: ArrayBuffer, ctx: TurnContext): Promise<ProviderResult> {
		const started = Date.now();

		const body = {
			systemInstruction: { parts: [{ text: systemPrompt() }] },
			contents: [
				{
					role: 'user',
					parts: [
						{ text: turnPreamble(ctx) },
						{
							inlineData: {
								mimeType: 'audio/ogg',
								data: toBase64(audio),
							},
						},
					],
				},
			],
			generationConfig: {
				responseMimeType: 'application/json',
				responseSchema: RESPONSE_SCHEMA,
				// Understanding is a classification, not a creative task. Low temperature
				// also makes confidence scores more stable across identical audio, which
				// the threshold policy depends on.
				temperature: 0.1,
			},
		};

		const res = await this.doFetch(
			`${ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			},
		);

		if (!res.ok) {
			throw new Error(`gemini ${res.status}: ${await res.text()}`);
		}

		const json = (await res.json()) as GeminiResponse;
		const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
		if (!text) throw new Error('gemini returned no content');

		// Re-validated rather than trusted. A schema-constrained response is still a
		// model output, and a confidence of 1.4 or an invented intent must fail loudly
		// here rather than reach the policy and get acted on.
		const understanding = Understanding.parse(JSON.parse(text));

		const usage = json.usageMetadata;
		return {
			understanding,
			usage: {
				audioSeconds: (usage?.promptTokenCount ?? 0) / 32,
				inputTokens: usage?.promptTokenCount ?? 0,
				outputTokens: usage?.candidatesTokenCount ?? 0,
			},
			latencyMs: Date.now() - started,
		};
	}
}

/**
 * The prior turns, as text.
 *
 * Text, not audio, and that is the cost model's single most important line. Audio is
 * roughly 13x denser than the words it carries, so replaying the session's audio each
 * turn would multiply the bill by the length of the conversation.
 */
function turnPreamble(ctx: TurnContext): string {
	if (ctx.history.length === 0) {
		return 'This is the first thing they said. Listen to the audio.';
	}
	const prior = ctx.history
		.map((h, i) => `Turn ${i + 1}: they wanted ${h.intent} (confidence ${h.confidence}).`)
		.join('\n');
	return `Earlier in this conversation:\n${prior}\n\nNow listen to the new audio.`;
}

function toBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i]!);
	}
	return btoa(binary);
}

interface GeminiResponse {
	candidates?: { content?: { parts?: { text?: string }[] } }[];
	usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
