import { describe, expect, it } from 'vitest';
import { stageTimer } from './timing';

describe('stageTimer', () => {
	it('times each stage and writes a Server-Timing header, in the order they finished', async () => {
		let clock = 0;
		const t = stageTimer(() => clock);
		await t.time('transcribe', async () => {
			clock += 1200;
		});
		await t.time('read', async () => {
			clock += 800.4;
		});
		expect(t.header()).toBe('transcribe;dur=1200, read;dur=800');
	});

	it('numbers a stage that runs more than once, and still times one that fails', async () => {
		let clock = 0;
		const t = stageTimer(() => clock);
		await t.time('judge', async () => void (clock += 100));
		await t.time('judge', async () => void (clock += 50));
		await expect(
			t.time('write', async () => {
				clock += 30;
				throw new Error('refused');
			}),
		).rejects.toThrow('refused');
		expect(t.header()).toBe('judge;dur=100, judge-2;dur=50, write;dur=30');
	});

	it('counts overlapping stages each in full', async () => {
		let clock = 0;
		const t = stageTimer(() => clock);
		const a = t.time('embed', () => new Promise<void>((r) => setTimeout(() => ((clock = 300), r()), 5)));
		const b = t.time('guides', async () => void 0);
		await Promise.all([a, b]);
		expect(t.header()).toContain('embed;dur=300');
		expect(t.header()).toContain('guides;dur=0');
	});
});
