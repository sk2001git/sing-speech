/**
 * The microphone as plain WAV: 16 kHz, mono, 16-bit (vault plan-suara-0021, L1).
 *
 * A browser's WebM recording is not a finished file until the recorder stops, and OpenAI's
 * transcriber refused the first part of one ("Audio file might be corrupted or unsupported";
 * the same bytes re-wrapped transcribed perfectly). A WAV is finished at every sample, so the
 * question can be sent after 1.5 s of quiet while the phone goes on listening. 16 kHz is what
 * speech recognisers use; it is 32 KB a second, about 2.5 times the WebM.
 */
export const WAV_RATE = 16000;

/** Float samples at `inRate`, in the blocks they arrived in, as one WAV at 16 kHz. */
export function encodeWav(blocks: readonly Float32Array[], inRate: number): Uint8Array {
	const total = blocks.reduce((n, b) => n + b.length, 0);
	const input = new Float32Array(total);
	let at = 0;
	for (const b of blocks) {
		input.set(b, at);
		at += b.length;
	}
	// Each output sample is the average of the input samples it covers: a crude low-pass, enough
	// for speech, and exact when the rates are equal.
	const ratio = inRate / WAV_RATE;
	const count = Math.floor(total / ratio);
	const out = new Uint8Array(44 + count * 2);
	const v = new DataView(out.buffer);
	const ascii = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
	ascii(0, 'RIFF');
	v.setUint32(4, 36 + count * 2, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, 1, true); // mono
	v.setUint32(24, WAV_RATE, true);
	v.setUint32(28, WAV_RATE * 2, true);
	v.setUint16(32, 2, true);
	v.setUint16(34, 16, true);
	ascii(36, 'data');
	v.setUint32(40, count * 2, true);
	for (let i = 0; i < count; i++) {
		const from = Math.floor(i * ratio);
		const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
		let sum = 0;
		for (let j = from; j < to; j++) sum += input[j]!;
		const s = Math.max(-1, Math.min(1, sum / (to - from)));
		v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
	}
	return out;
}

/** Base64 in slices, so a minute of audio does not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}
