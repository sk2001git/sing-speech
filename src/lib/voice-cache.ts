import type { Entry } from './kb/entry';

/**
 * Spoken audio is paid for once (owner, 2026-09-16: "cache the response for sound for all
 * the cards... the only cost should be from our user base input").
 *
 * Card and step lines are fixed text, so they are generated at build time into
 * `public/kb-audio` and served as static files. Anything else a reader hears — their own
 * words read back, a greeting — is spoken once and kept in the Worker cache.
 */
export const AUDIO_DIR = 'kb-audio';

const encoder = new TextEncoder();

/** Same words, same voice, same model: same file. Spacing does not change what is heard. */
export async function speechKey(text: string, voice: string, model: string): Promise<string> {
	const normalised = text.replace(/\s+/g, ' ').trim();
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${model}|${voice}|${normalised}`));
	return [...new Uint8Array(digest)]
		.slice(0, 16)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export const audioPath = (key: string) => `/${AUDIO_DIR}/${key}.mp3`;

/** Every line the screens read aloud for one entry, in the order they can be reached. */
export function spokenLines(entry: Entry): string[] {
	return [
		`${entry.title.full}. ${entry.summary.text}`,
		...(entry.steps ?? []).map((s) => `${s.name}. ${s.text}`),
	];
}
