import { describe, expect, it } from 'vitest';
import index from '../../data/kb/index.json';
import { parseEntry, type Entry } from './kb/entry';
import { audioPath, spokenLines, speechKey } from './voice-cache';

/**
 * Picked by shape, not by id: the index holds one card per official page and is rebuilt
 * whenever the crawl grows, so an id that exists today can be replaced by a richer card
 * for the same page tomorrow. What these tests need is an answer and a process, not two
 * particular entries.
 */
const pick = (wanted: (e: Entry) => boolean): Entry => {
	for (const raw of index.entries as unknown[]) {
		const parsed = parseEntry(raw);
		if (parsed.ok && wanted(parsed.entry)) return parsed.entry;
	}
	throw new Error('no entry in data/kb/index.json matches what this test needs');
};

const anAnswer = () => pick((e) => e.kind === 'answer' && (e.details?.length ?? 0) > 0);
const aProcess = () => pick((e) => e.kind === 'process' && (e.steps?.length ?? 0) > 1);

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
	it('covers every line the app reads aloud for a card: the card itself and each step', () => {
		const e = aProcess();
		const lines = spokenLines(e);
		expect(lines[0]).toBe(`${e.title.full}. ${e.summary.text}`);
		expect(lines).toHaveLength(1 + e.steps!.length);
		expect(lines[1]).toBe(`${e.steps![0]!.name}. ${e.steps![0]!.text}`);
	});

	it('gives an answer card one line', () => {
		expect(spokenLines(anAnswer())).toHaveLength(1);
	});
});

describe('audioPath', () => {
	it('is a static file under the site, so a built line costs nothing to serve', () => {
		expect(audioPath('0123456789abcdef0123456789abcdef')).toBe('/kb-audio/0123456789abcdef0123456789abcdef.mp3');
	});
});
