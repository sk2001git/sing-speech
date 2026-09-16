import { describe, expect, it } from 'vitest';
import index from '../../data/kb/index.json';
import { parseEntry, type Entry } from './kb/entry';
import { audioPath, spokenLines, speechKey } from './voice-cache';

const entry = (id: string): Entry => {
	const raw = (index.entries as unknown[]).find((e) => (e as { id: string }).id === id);
	const parsed = parseEntry(raw);
	if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
	return parsed.entry;
};

describe('speechKey', () => {
	it('is the same for the same words, voice and model, so the audio is paid for once', async () => {
		const a = await speechKey('Hello there', 'marin', 'gpt-4o-mini-tts');
		const b = await speechKey('Hello there', 'marin', 'gpt-4o-mini-tts');
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{32}$/);
	});

	it('changes when the words, the voice or the model change', async () => {
		const base = await speechKey('Hello there', 'marin', 'gpt-4o-mini-tts');
		expect(await speechKey('Hello there!', 'marin', 'gpt-4o-mini-tts')).not.toBe(base);
		expect(await speechKey('Hello there', 'gleam', 'gpt-4o-mini-tts')).not.toBe(base);
		expect(await speechKey('Hello there', 'marin', 'tts-1')).not.toBe(base);
	});

	it('ignores spacing differences, which do not change what is heard', async () => {
		expect(await speechKey('Hello  there\n', 'marin', 'gpt-4o-mini-tts')).toBe(await speechKey('Hello there', 'marin', 'gpt-4o-mini-tts'));
	});
});

describe('spokenLines', () => {
	const lines = spokenLines(entry('sg.cpf.singpass-password-reset'));

	it('covers every line the app reads aloud for a card: the card itself and each step', () => {
		const e = entry('sg.cpf.singpass-password-reset');
		expect(lines[0]).toBe(`${e.title.full}. ${e.summary.text}`);
		expect(lines).toHaveLength(1 + e.steps!.length);
		expect(lines[1]).toBe(`${e.steps![0]!.name}. ${e.steps![0]!.text}`);
	});

	it('gives an answer card one line', () => {
		expect(spokenLines(entry('sg.moh.medishield-vs-careshield'))).toHaveLength(1);
	});
});

describe('audioPath', () => {
	it('is a static file under the site, so a built line costs nothing to serve', () => {
		expect(audioPath('0123456789abcdef0123456789abcdef')).toBe('/kb-audio/0123456789abcdef0123456789abcdef.mp3');
	});
});
