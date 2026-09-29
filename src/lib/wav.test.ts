import { describe, expect, it } from 'vitest';
import { bytesToBase64, encodeWav, WAV_RATE } from './wav';

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const text = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

describe('encodeWav', () => {
	it('writes a 16 kHz mono 16-bit WAV that any prefix of a recording can be sent as', () => {
		expect(WAV_RATE).toBe(16000);
		// 0.1 s at 48 kHz in two blocks, as the microphone delivers it.
		const wav = encodeWav([new Float32Array(2400).fill(0.5), new Float32Array(2400).fill(-0.5)], 48000);
		const v = view(wav);
		expect(text(wav, 0)).toBe('RIFF');
		expect(text(wav, 8)).toBe('WAVE');
		expect(v.getUint16(22, true)).toBe(1); // mono
		expect(v.getUint32(24, true)).toBe(16000);
		expect(v.getUint16(34, true)).toBe(16);
		const samples = v.getUint32(40, true) / 2;
		expect(samples).toBe(1600);
		expect(v.getUint32(4, true)).toBe(36 + samples * 2);
		expect(wav.byteLength).toBe(44 + samples * 2);
		// The first half is +0.5, the second -0.5, at 16-bit scale.
		expect(v.getInt16(44, true)).toBe(Math.round(0.5 * 0x7fff));
		expect(v.getInt16(44 + 2 * 1599, true)).toBe(Math.round(-0.5 * 0x8000));
	});

	it('clips what is louder than full scale instead of wrapping round', () => {
		const wav = encodeWav([new Float32Array(30).fill(2)], 16000);
		expect(view(wav).getInt16(44, true)).toBe(0x7fff);
	});

	it('is an empty but valid WAV when nothing was captured', () => {
		const wav = encodeWav([], 48000);
		expect(wav.byteLength).toBe(44);
		expect(view(wav).getUint32(40, true)).toBe(0);
	});
});

describe('bytesToBase64', () => {
	it('encodes large recordings without overflowing the call stack', () => {
		const bytes = new Uint8Array(300_000).map((_, i) => i % 251);
		const b64 = bytesToBase64(bytes);
		expect(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual(bytes);
	});
});
