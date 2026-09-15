import { z } from 'zod';
import type { EntryLanguage } from './entry';

/**
 * What the audio model hears in one request, for search rather than classification.
 *
 * There is no intent list: the knowledge base is open, so the model writes the meaning
 * as an English search sentence and the index finds the nearest answers. English because
 * the collected entries are English; the reader still sees their own language.
 */
export const HEARD_LANGUAGES = ['en', 'zh', 'other'] as const;

export const Hearing = z
	.object({
		greeting: z.boolean(),
		meaning_en: z.string().max(240),
		short: z.string().min(1).max(40),
		sentence: z.string().min(1).max(240),
		language: z.enum(HEARD_LANGUAGES),
		confidence: z.number().min(0).max(1),
	})
	.superRefine((h, ctx) => {
		if (!h.greeting && h.meaning_en.trim() === '')
			ctx.addIssue({ code: 'custom', path: ['meaning_en'], message: 'a request needs an English meaning to search' });
	});

export type Hearing = z.infer<typeof Hearing>;

/** The language setting: chosen once, visible on every screen (vault dec-suara-0007). */
export type ReplySetting = 'en' | 'zh-Hans' | 'auto';

export function replyLanguage(setting: ReplySetting, heard: Hearing['language']): EntryLanguage {
	if (setting === 'auto') return heard === 'zh' ? 'zh-Hans' : 'en';
	return setting;
}

export const HEARING_SCHEMA = {
	type: 'object',
	properties: {
		greeting: { type: 'boolean' },
		meaning_en: { type: 'string' },
		short: { type: 'string' },
		sentence: { type: 'string' },
		language: { type: 'string', enum: [...HEARD_LANGUAGES] },
		confidence: { type: 'number' },
	},
	required: ['greeting', 'meaning_en', 'short', 'sentence', 'language', 'confidence'],
} as const;

/**
 * `audio` for a model that hears the recording itself; `transcript` for a text model that
 * reads a speech-to-text transcript, which may carry recognition mistakes.
 */
export function hearingPrompt(source: 'audio' | 'transcript' = 'audio'): string {
	const intake =
		source === 'audio'
			? 'Listen to the audio and fill in:'
			: 'You are given an automatic transcript of what they said. It may contain recognition mistakes, so read it for what they most likely meant. Fill in:';
	return `You are the ears of Suara, a voice-first knowledge base of official Singapore government answers for older people. They may speak English, Singlish, Mandarin, Malay, Tamil, Hokkien or Cantonese, or mix them in one sentence.

${intake}

- greeting: true only when they are just greeting you or making small talk with no question, such as "hello", "good morning" or "你好". A greeting followed by a question is not a greeting.
- meaning_en: one plain English sentence saying what they want to know, written as a search query, whatever language they spoke. Keep any scheme name, place, card or number they said. Empty only for a greeting.
- short: at most five words saying what they asked, in the language they spoke, for a one-line heading. For a greeting, the greeting itself.
- sentence: one short sentence saying back what they want to know, in the language they spoke, addressed to them. The meaning, not their exact words. Never add anything they did not say.
- language: "zh" if they mainly spoke Mandarin or another Chinese language, "en" for English or Singlish, "other" for anything else.
- confidence: from 0 to 1, how sure you are of meaning_en. Low when the audio is unclear.

Do not transcribe word for word. Do not answer the question. Do not invent details.`;
}
