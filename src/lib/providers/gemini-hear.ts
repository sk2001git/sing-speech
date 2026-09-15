import { Hearing, HEARING_SCHEMA, hearingPrompt } from '../kb/hearing';
import { geminiMime, toBase64 } from './gemini';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiHearerOptions {
	apiKey: string;
	model?: string;
	fetchImpl?: typeof fetch;
}

/**
 * Audio in, a search meaning out, one call — the knowledge-base counterpart of
 * `GeminiProvider`, with no intent list. Same model and price: 3.5 Flash-Lite bills audio
 * at 32 tokens a second (see gemini.ts).
 */
export class GeminiHearer {
	private readonly apiKey: string;
	private readonly model: string;
	private readonly doFetch: typeof fetch;

	constructor(opts: GeminiHearerOptions) {
		this.apiKey = opts.apiKey;
		this.model = opts.model ?? 'gemini-3.5-flash-lite';
		// Bound, for the same "Illegal invocation" reason as GeminiProvider.
		this.doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
	}

	async hear(audio: ArrayBuffer, mimeType?: string): Promise<Hearing> {
		const res = await this.doFetch(`${ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				systemInstruction: { parts: [{ text: hearingPrompt() }] },
				contents: [
					{
						role: 'user',
						parts: [{ text: 'Listen to the audio.' }, { inlineData: { mimeType: geminiMime(mimeType), data: toBase64(audio) } }],
					},
				],
				generationConfig: { responseMimeType: 'application/json', responseSchema: HEARING_SCHEMA, temperature: 0.1 },
			}),
		});
		if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);

		const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
		const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
		if (!text) throw new Error('gemini returned no content');
		// Re-validated: a schema-constrained reply is still a model output.
		return Hearing.parse(JSON.parse(text));
	}
}
