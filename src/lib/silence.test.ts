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
