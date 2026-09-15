import { describe, expect, it } from 'vitest';
import { bestPerEntry, PAGE_SIZE, rank, type Thresholds } from './rank';

const T: Thresholds = { strong: 0.6, weak: 0.45, floor: 0.3 };

/** `n` entries whose scores fall from `top` in steps of 0.02. */
const falling = (n: number, top: number) =>
	Array.from({ length: n }, (_, i) => ({ id: `sg.moh.e${String(i).padStart(2, '0')}`, score: top - i * 0.02 }));

describe('bestPerEntry', () => {
	it("keeps each entry's best-matching vector and sorts high to low", () => {
		const hits = [
			{ entryId: 'sg.moh.a', score: 0.5 },
			{ entryId: 'sg.moh.b', score: 0.7 },
			{ entryId: 'sg.moh.a', score: 0.8 },
		];
		expect(bestPerEntry(hits)).toEqual([
			{ id: 'sg.moh.a', score: 0.8 },
			{ id: 'sg.moh.b', score: 0.7 },
		]);
	});

	it('breaks ties by id, so the same request always shows the same page', () => {
		const hits = [
			{ entryId: 'sg.moh.z', score: 0.5 },
			{ entryId: 'sg.moh.a', score: 0.5 },
		];
		expect(bestPerEntry(hits).map((s) => s.id)).toEqual(['sg.moh.a', 'sg.moh.z']);
	});
});

describe('rank', () => {
	it('shows six cards at a time', () => {
		expect(PAGE_SIZE).toBe(6);
	});

	it('is a strong fit when the best card clears the strong line', () => {
		const r = rank(falling(10, 0.7), T);
		expect(r.fit).toBe('strong');
		expect(r.ids).toHaveLength(6);
		expect(r.ids[0]).toBe('sg.moh.e00');
		expect(r.nextOffset).toBe(6);
	});

	it('is a weak fit when the best card is between the weak and strong lines', () => {
		expect(rank(falling(3, 0.5), T).fit).toBe('weak');
	});

	it('shows nothing when even the best card is below the weak line', () => {
		const r = rank(falling(10, 0.44), T);
		expect(r).toEqual({ fit: 'none', ids: [], total: 0, nextOffset: null });
	});

	it('never shows a card below the floor, however few that leaves', () => {
		const r = rank(
			[
				{ id: 'sg.moh.a', score: 0.7 },
				{ id: 'sg.moh.b', score: 0.31 },
				{ id: 'sg.moh.c', score: 0.29 },
			],
			T,
		);
		expect(r.ids).toEqual(['sg.moh.a', 'sg.moh.b']);
		expect(r.total).toBe(2);
		expect(r.nextOffset).toBeNull();
	});

	it('pages on from an offset and stops offering more at the end', () => {
		const r = rank(falling(10, 0.7), T, 6);
		expect(r.ids).toEqual(['sg.moh.e06', 'sg.moh.e07', 'sg.moh.e08', 'sg.moh.e09']);
		expect(r.nextOffset).toBeNull();
	});

	it('keeps the fit of the whole answer on later pages', () => {
		expect(rank(falling(10, 0.7), T, 6).fit).toBe('strong');
	});
});
