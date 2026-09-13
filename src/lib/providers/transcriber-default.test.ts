import { describe, expect, it } from 'vitest';
import { transcriberFrom, type WorkersAiBinding } from './index';

const binding: WorkersAiBinding = { run: async () => ({ text: '' }) };

describe('transcriberFrom', () => {
	it('uses no transcriber when SUARA_TRANSCRIBER is unset, even with the Workers AI binding attached', () => {
		// Whisper is attached on purpose, never picked up because a binding happens to exist.
		// Seen 2026-09-14: it hallucinated Malay for 5 of 10 Singlish clips (obs-0024).
		expect(transcriberFrom({ AI: binding })).toBeUndefined();
	});

	it('uses Whisper only when SUARA_TRANSCRIBER names it and the binding is there', () => {
		expect(transcriberFrom({ SUARA_TRANSCRIBER: 'workers-ai', AI: binding })?.id).toBe('workers-ai:whisper');
	});

	it('uses nothing when Whisper is named but the binding is missing', () => {
		expect(transcriberFrom({ SUARA_TRANSCRIBER: 'workers-ai' })).toBeUndefined();
	});

	it('uses the Gemini transcriber when named and a key is set', () => {
		expect(transcriberFrom({ SUARA_TRANSCRIBER: 'gemini', GEMINI_API_KEY: 'k' })?.id).toBe('gemini:3.5-transcribe');
	});

	it('honours an explicit none', () => {
		expect(transcriberFrom({ SUARA_TRANSCRIBER: 'none', AI: binding })).toBeUndefined();
	});

	it('refuses an unknown value instead of selecting nothing silently', () => {
		expect(() => transcriberFrom({ SUARA_TRANSCRIBER: 'whisperx' })).toThrow(/SUARA_TRANSCRIBER/);
	});
});
