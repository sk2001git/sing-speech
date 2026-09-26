import { describe, expect, it } from 'vitest';
import { staticBars } from './LiveWaveform';

/** Bars from one frame of frequency data, as ElevenLabs' LiveWaveform lays them out in static mode. */
describe('staticBars', () => {
	const bins = (fill: (i: number) => number, n = 512) => Uint8Array.from({ length: n }, (_, i) => fill(i));

	it('fills the width, mirrored about the centre', () => {
		const bars = staticBars(bins((i) => i % 255), 20);
		expect(bars).toHaveLength(20);
		expect(bars.slice(0, 10)).toEqual(bars.slice(10).reverse());
	});

	it('never falls below a thin resting bar, and never above full height', () => {
		expect(staticBars(bins(() => 0), 10).every((v) => v === 0.05)).toBe(true);
		expect(staticBars(bins(() => 255), 10, 3).every((v) => v === 1)).toBe(true);
	});

	it('puts the voice band in the middle: low frequencies at the centre, higher towards the edges', () => {
		// loud only in the lowest part of the voice band (5-10% of bins)
		const bars = staticBars(bins((i) => (i >= 25 && i < 51 ? 255 : 0)), 20);
		expect(bars[9]).toBe(1);
		expect(bars[10]).toBe(1);
		expect(bars[0]).toBe(0.05);
		expect(bars[19]).toBe(0.05);
	});
});
