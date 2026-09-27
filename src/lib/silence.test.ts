import { describe, expect, it } from 'vitest';
import { createSilenceGate, rms, SILENCE_MS } from './silence';

/** Feed `levels` at 100 ms steps from `start`, returning the first non-'listen' verdict and when. */
function run(gate: ReturnType<typeof createSilenceGate>, levels: number[], start = 0) {
	for (let i = 0; i < levels.length; i++) {
		const v = gate.push(levels[i]!, start + i * 100);
		if (v !== 'listen') return { verdict: v, at: start + i * 100 };
	}
	return { verdict: 'listen' as const, at: -1 };
}

const quiet = (n: number) => Array(n).fill(0.004);
const speech = (n: number) => Array(n).fill(0.08);

describe('createSilenceGate', () => {
	it('ends three seconds after the person stops speaking', () => {
		expect(SILENCE_MS).toBe(3000);
		const gate = createSilenceGate();
		const r = run(gate, [...quiet(5), ...speech(20), ...quiet(40)]);
		expect(r.verdict).toBe('done');
		// Speech ends at 2400 ms; the 3 s pause is complete at 5400 ms.
		expect(r.at).toBe(5400);
	});

	it('does not end on a short pause between words', () => {
		const gate = createSilenceGate();
		expect(run(gate, [...quiet(5), ...speech(10), ...quiet(25), ...speech(10), ...quiet(5)]).verdict).toBe('listen');
	});

	it('keeps listening to soft speech, whose loud moments come one or two at a time', () => {
		// Owner, 2026-09-27: "premature closing of the speech... I was still talking and it closed."
		// Replayed 12 dB softer, 17 of 38 turns were cut off: in the last 3 s before each cut there
		// were 6-9 loud readings, but never three in a row, so the talking stopped counting.
		const gate = createSilenceGate();
		const soft = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 0.03 : i % 3 === 1 ? 0.025 : 0.012));
		expect(run(gate, [...quiet(5), ...speech(5), ...soft]).verdict).toBe('listen');
		// It still ends once they really stop.
		expect(run(gate, quiet(31), 7000).verdict).toBe('done');
	});

	it('ends on time when the room keeps making small sounds after the person stops', () => {
		// Owner, 2026-09-28: "it doesn't really sense when it ends". Replayed with a click every
		// 1.5 s after the talking, 23 of 38 turns never ended: each lone click restarted the 3 s.
		const gate = createSilenceGate();
		// A click 1.3 s after the last word, then every 1.5 s.
		const clicks = Array.from({ length: 80 }, (_, i) => (i % 15 === 12 ? 0.3 : 0.004));
		const r = run(gate, [...quiet(5), ...speech(20), ...clicks]);
		expect(r.verdict).toBe('done');
		// Speech ends at 2400 ms; the clicks do not move the end.
		expect(r.at).toBe(5400);
	});

	it('still hears soft speech whose loud moments come alone but close together', () => {
		const gate = createSilenceGate();
		const blips = Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? 0.03 : 0.004));
		expect(run(gate, [...quiet(5), ...speech(5), ...blips]).verdict).toBe('listen');
	});

	it('waits longer before anyone has spoken, then reports nothing heard', () => {
		const gate = createSilenceGate();
		const r = run(gate, quiet(120));
		expect(r.verdict).toBe('nothing');
		expect(r.at).toBe(8000);
	});

	it('ignores a single click or bump as speech', () => {
		const gate = createSilenceGate();
		expect(run(gate, [...quiet(5), 0.3, ...quiet(80)]).verdict).toBe('nothing');
	});

	it('adapts to steady background noise, so a fan does not keep it listening forever', () => {
		const gate = createSilenceGate();
		const fan = (n: number) => Array(n).fill(0.03);
		const r = run(gate, [...fan(5), ...Array(15).fill(0.2), ...fan(40)]);
		expect(r.verdict).toBe('done');
	});

	it('stops at the hard limit however long they talk', () => {
		const gate = createSilenceGate({ maxMs: 5000 });
		expect(run(gate, speech(100))).toEqual({ verdict: 'done', at: 5000 });
	});
});

describe('rms', () => {
	it('is zero for silence and larger for louder samples', () => {
		expect(rms(new Float32Array(64))).toBe(0);
		expect(rms(new Float32Array(64).fill(0.5))).toBeCloseTo(0.5);
	});
});
