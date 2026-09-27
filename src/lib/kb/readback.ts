import type { EntryLanguage } from './entry';
import type { Heard } from './flow';

/**
 * Every spoken reply begins with the question, in the person's own words where Suara has them
 * (owner, 2026-09-27: "always read to the reader what their question is ... it helps, if a social
 * volunteer uses"). The person hears what Suara heard, or what the volunteer typed, and can
 * correct it on the screen before relying on the answer.
 */
export function readBack(heard: Heard | undefined, language: EntryLanguage, line: string): string {
	// A corrected question is read back as Suara now understands it, not as the fragment typed.
	if (heard?.corrected && heard.sentence.trim()) {
		const sentence = heard.sentence.trim();
		return language === 'zh-Hans' ? `已更正。${/[。？！]$/.test(sentence) ? sentence : `${sentence}。`}${line}` : `Corrected. ${/[.?!]$/.test(sentence) ? sentence : `${sentence}.`} ${line}`;
	}
	const asked = (heard?.said ?? heard?.sentence ?? '').trim();
	if (!asked) return line;
	if (language === 'zh-Hans') return `您问：${asked.replace(/[。？！?.!]+$/, '')}。${line}`;
	return `You asked: ${/[.?!]$/.test(asked) ? asked : `${asked}.`} ${line}`;
}
