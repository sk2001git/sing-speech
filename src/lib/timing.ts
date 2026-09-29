/**
 * How long each stage of a question took, sent back as a Server-Timing header so the phone's
 * developer tools and scripts/kb/time-routes.py can see where the wait goes (vault
 * plan-suara-0021). Durations only: no question text, no audio, nothing about the person.
 */
export interface StageTimer {
	time<T>(stage: string, run: () => Promise<T>): Promise<T>;
	header(): string;
}

export function stageTimer(now: () => number = () => performance.now()): StageTimer {
	const done: string[] = [];
	const seen = new Map<string, number>();
	return {
		async time(stage, run) {
			const n = (seen.get(stage) ?? 0) + 1;
			seen.set(stage, n);
			const name = n === 1 ? stage : `${stage}-${n}`;
			const start = now();
			try {
				return await run();
			} finally {
				done.push(`${name};dur=${Math.round(now() - start)}`);
			}
		},
		header: () => done.join(', '),
	};
}

/** A timer that times nothing, for code paths with no one to report to. */
export const noTimer: StageTimer = { time: (_stage, run) => run(), header: () => '' };
