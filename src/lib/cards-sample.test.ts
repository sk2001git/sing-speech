import { describe, expect, it } from 'vitest';
import { cardsFor } from './cards';
import type { Procedure } from './procedure';
import type { SessionState } from './session';

const NOW = new Date('2026-09-13T00:00:00.000Z');

function sample(over: Partial<Procedure> = {}): Procedure {
	return {
		id: 'sample-proc',
		ministry: 'moh',
		title: { en: 'Sample' },
		topic: 'sample',
		metadata: { cues: [], aliases: [] },
		entry: 's1',
		steps: [
			{ id: 's1', instruction: { en: 'First' }, image: null, next: 's2' },
			{ id: 's2', instruction: { en: 'Second' }, image: null, next: null },
		],
		verified: false,
		sample: true,
		source: '',
		checkedOn: null,
		...over,
	};
}

const guiding: SessionState = {
	phase: 'guiding',
	screen: { kind: 'listening', say: 'What do you need help with today?' },
	cursor: { procedureId: 'sample-proc', stepId: 's1', done: [], startedAt: NOW.toISOString() },
};

const steps = (cards: ReturnType<typeof cardsFor>) => cards.filter((c) => c.kind === 'step');

describe('sample procedures', () => {
	it('render nothing unless samples are switched on', () => {
		expect(steps(cardsFor(guiding, sample(), 'en', NOW))).toHaveLength(0);
	});

	it('render every step when samples are on', () => {
		expect(steps(cardsFor(guiding, sample(), 'en', NOW, { samples: true }))).toHaveLength(2);
	});

	it('never unlock an unverified procedure that is not a sample', () => {
		const plain = sample({ sample: false });
		expect(steps(cardsFor(guiding, plain, 'en', NOW, { samples: true }))).toHaveLength(0);
	});
});
