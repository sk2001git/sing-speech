import { describe, expect, it } from 'vitest';
import { cardsFor, imageIsFresh, IMAGE_STALE_DAYS } from './cards';
import type { Procedure } from './procedure';
import { anUnderstanding } from './providers/fake';
import type { SessionState } from './session';
import type { Screen } from './uispec';

const NOW = new Date('2026-09-11T00:00:00.000Z');
const SCREEN: Screen = { kind: 'listening', say: 'What do you need help with today?' };

function proc(over: Partial<Procedure> = {}): Procedure {
	return {
		id: 'test-proc',
		ministry: 'cpf',
		title: { en: 'Test procedure' },
		topic: 'test',
		metadata: { cues: [], aliases: [] },
		entry: 's1',
		steps: [
			{ id: 's1', instruction: { en: 'First' }, image: null, next: 's2' },
			{ id: 's2', instruction: { en: 'Second' }, image: null, next: null },
		],
		verified: true,
		source: 'https://example.invalid',
		checkedOn: '2026-09-01',
		...over,
	};
}

const guiding = (stepId: string, done: string[]): SessionState => ({
	phase: 'guiding',
	screen: SCREEN,
	cursor: { procedureId: 'test-proc', stepId, done, startedAt: NOW.toISOString() },
});

describe('imageIsFresh', () => {
	it('accepts an image checked today', () => {
		expect(imageIsFresh({ src: '/a.png', alt: { en: 'a' }, checkedOn: '2026-09-11' }, NOW)).toBe(true);
	});

	it('rejects one past the budget, because a moved button is worse than no picture', () => {
		expect(imageIsFresh({ src: '/a.png', alt: { en: 'a' }, checkedOn: '2020-01-01' }, NOW)).toBe(false);
	});

	it('rejects an unparseable date rather than trusting it', () => {
		expect(imageIsFresh({ src: '/a.png', alt: { en: 'a' }, checkedOn: 'soon' }, NOW)).toBe(false);
	});
});

describe('cardsFor', () => {
	it('shows every step, so the user knows how much is left', () => {
		const cards = cardsFor(guiding('s1', []), proc(), 'en', NOW);
		const steps = cards.filter((c) => c.kind === 'step');
		expect(steps).toHaveLength(2);
	});

	it('marks exactly one step active', () => {
		const cards = cardsFor(guiding('s2', ['s1']), proc(), 'en', NOW);
		const active = cards.filter((c) => c.kind === 'step' && c.state === 'active');
		expect(active).toHaveLength(1);
	});

	it('keeps a step key stable across an advance, so the card animates instead of remounting', () => {
		const before = cardsFor(guiding('s1', []), proc(), 'en', NOW);
		const after = cardsFor(guiding('s2', ['s1']), proc(), 'en', NOW);
		const keyOf = (cs: typeof before, id: string) =>
			cs.find((c) => c.kind === 'step' && c.key.endsWith(id))?.key;
		expect(keyOf(before, 's1')).toBe(keyOf(after, 's1'));
	});

	it('renders NOTHING from an unverified procedure', () => {
		// The safety property the whole product rests on. An unverified row is content
		// nobody has checked against a source, and a plausible wrong instruction sends an
		// eighty-year-old to the wrong counter.
		const cards = cardsFor(guiding('s1', []), proc({ verified: false }), 'en', NOW);
		expect(cards.filter((c) => c.kind === 'step')).toHaveLength(0);
	});

	it('drops a stale image but keeps the instruction', () => {
		const p = proc();
		p.steps[0]!.image = { src: '/old.png', alt: { en: 'old' }, checkedOn: '2020-01-01' };
		const cards = cardsFor(guiding('s1', []), p, 'en', NOW);
		const step = cards.find((c) => c.kind === 'step' && c.state === 'active');
		expect(step && step.kind === 'step' && step.image).toBeNull();
		expect(step && step.kind === 'step' && step.instruction).toBe('First');
	});

	it('shows what was heard during readback, because the wait needs an answer', () => {
		const state: SessionState = {
			phase: 'readback',
			screen: SCREEN,
			heard: 'i need help paying',
			understanding: anUnderstanding({ intent: 'chas_subsidy', confidence: 0.9 }),
		};
		const cards = cardsFor(state, null, 'en', NOW);
		expect(cards.some((c) => c.kind === 'heard' && c.text === 'i need help paying')).toBe(true);
	});

	it('shows nothing at all while submitting, because speculating is the thing we refuse', () => {
		const state: SessionState = { phase: 'submitting', screen: SCREEN, heard: 'x' };
		expect(cardsFor(state, null, 'en', NOW)).toEqual([]);
	});

	it('falls back to English rather than rendering a blank step', () => {
		const cards = cardsFor(guiding('s1', []), proc(), 'nan', NOW);
		const active = cards.find((c) => c.kind === 'step' && c.state === 'active');
		expect(active && active.kind === 'step' && active.instruction).toBe('First');
	});

	it('has a staleness budget that is written down rather than implied', () => {
		expect(IMAGE_STALE_DAYS).toBe(90);
	});
});
