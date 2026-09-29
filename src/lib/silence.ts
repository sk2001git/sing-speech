/**
 * When to stop recording without a second tap (owner, 2026-09-16: "if pause > 3 seconds,
 * then end if no sound"). Tapping to stop still works; this only ends a turn the person
 * has plainly finished.
 *
 * Pure: fed one loudness reading at a time with its timestamp, so it is tested without a
 * microphone. Loudness is RMS of the time-domain samples, 0 to 1.
 */
export const SILENCE_MS = 3000;
/**
 * Quiet long enough to send the question while still listening (vault plan-suara-0021, L1):
 * the answer is on its way when the 3 s pause ends. Speech again recalls it.
 */
export const EARLY_MS = 1500;

export type Verdict = 'listen' | 'done' | 'nothing';

export interface GateOptions {
	/** Pause after speech that ends the turn. */
	silenceMs?: number;
	/** Before anyone speaks, how long to wait. Older speakers often take a moment to start. */
	startMs?: number;
	/** Hard limit on one recording. */
	maxMs?: number;
	/** Loud readings in a row, at ~100 ms apart, that count as speech rather than a bump. */
	speechFrames?: number;
	/** Once talking, a lone loud reading counts only if another came within this long. */
	clusterMs?: number;
}

export function createSilenceGate(opts: GateOptions = {}) {
	const silenceMs = opts.silenceMs ?? SILENCE_MS;
	const startMs = opts.startMs ?? 8000;
	const maxMs = opts.maxMs ?? 60_000;
	const speechFrames = opts.speechFrames ?? 3;
	const clusterMs = opts.clusterMs ?? 1000;

	let started: number | null = null;
	let floor = Number.POSITIVE_INFINITY;
	let loudRun = 0;
	let heardSpeech = false;
	let lastLoud = 0;
	let previousLoud = Number.NEGATIVE_INFINITY;

	return {
		push(level: number, now: number): Verdict {
			if (started === null) started = now;
			const threshold = Math.max(0.02, Math.min(floor, 0.1) * 3);

			if (level >= threshold) {
				loudRun += 1;
				// Three loud readings in a row tell speech from a click, so they are what starts a
				// turn. Once someone is talking, loud readings close together mean they still are:
				// soft speech rises above the line one or two readings at a time, and demanding three
				// in a row cut people off mid-sentence (owner, 2026-09-27; 17 of 38 soft turns in a
				// replay). A lone reading with none in the second before is the room, not the person:
				// counting it, a click every 1.5 s kept 23 of 38 turns open for ever (owner, 2026-09-28).
				if (loudRun >= speechFrames) heardSpeech = true;
				if (heardSpeech && (loudRun >= 2 || now - previousLoud <= clusterMs)) lastLoud = now;
				previousLoud = now;
			} else {
				loudRun = 0;
				// Background noise is learned only from quiet moments, so speech never
				// raises the bar it has to clear.
				floor = level < floor ? level : floor + (level - floor) * 0.05;
			}
			if (floor === Number.POSITIVE_INFINITY) floor = level;

			// A recording that reached the limit is sent; the server decides if it held words.
			if (now - started >= maxMs) return 'done';
			if (heardSpeech) return now - lastLoud >= silenceMs ? 'done' : 'listen';
			return now - started >= startMs ? 'nothing' : 'listen';
		},
		get heardSpeech() {
			return heardSpeech;
		},
		/** When speech was last heard, or null before any: a question sent early is stale once this moves. */
		get lastSpeech(): number | null {
			return heardSpeech ? lastLoud : null;
		},
	};
}

export function rms(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
	return Math.sqrt(sum / samples.length);
}
