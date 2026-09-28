import { describe, expect, it } from 'vitest';
import example from '../../../docs/knowledge-base/examples/sg.moh.gpfirst-emergency-referral.json';
import { parseEntry, type Entry } from './entry';
import { initial, next, type FlowEvent, type FlowState, type SearchResult } from './flow';

function process(): Entry {
	const r = parseEntry(structuredClone(example));
	if (!r.ok) throw new Error(r.errors.join('\n'));
	return r.entry;
}

function answer(id: string): Entry {
	const e = process();
	e.id = id;
	e.kind = 'answer';
	delete e.steps;
	return e;
}

const result = (cards: Entry[] = [process(), answer('sg.moh.chas-referral')], nextOffset: number | null = null): SearchResult => ({
	heard: { short: 'A&E referral costs', sentence: 'Your doctor sent you to A&E.' },
	fit: 'strong',
	cards,
	nextOffset,
	query: 'Doctor referred me to A&E, is it cheaper?',
	language: 'en',
});

const run = (events: FlowEvent[], from: FlowState = initial()) => events.reduce(next, from);

describe('speaking', () => {
	it('goes home, arming, listening, searching', () => {
		expect(run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }]).phase).toBe('searching');
	});

	it('explains a refused microphone, and lets the person try again', () => {
		const denied = run([{ type: 'PRESS' }, { type: 'DENIED', reason: 'permission' }]);
		expect(denied).toMatchObject({ phase: 'denied', reason: 'permission' });
		expect(next(denied, { type: 'PRESS' }).phase).toBe('arming');
	});

	it('goes home saying nothing was heard, from the microphone or from the server', () => {
		const listening = run([{ type: 'PRESS' }, { type: 'GRANTED' }]);
		expect(next(listening, { type: 'SILENCE' })).toMatchObject({ phase: 'home', greeting: false, notice: 'nothing' });
		const searching = next(listening, { type: 'STOP' });
		expect(next(searching, { type: 'SILENCE' })).toMatchObject({ phase: 'home', notice: 'nothing' });
		expect(next(next(searching, { type: 'SILENCE' }), { type: 'PRESS' }).phase).toBe('arming');
	});

	it('shows the offline screen when the search fails', () => {
		expect(run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }, { type: 'FAIL' }]).phase).toBe('offline');
	});
});

describe('results', () => {
	const searching = run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }]);

	it('shows the cards closed, in grid view', () => {
		const s = next(searching, { type: 'RESULTS', result: result() });
		expect(s).toMatchObject({ phase: 'results', openId: null, view: 'grid' });
	});

	it('opens one card at a time', () => {
		let s = next(searching, { type: 'RESULTS', result: result() });
		s = next(s, { type: 'OPEN', id: 'sg.moh.chas-referral' });
		expect(s).toMatchObject({ openId: 'sg.moh.chas-referral' });
		s = next(s, { type: 'OPEN', id: 'sg.moh.chas-referral' });
		expect(s).toMatchObject({ openId: null });
	});

	it('keeps the chosen view for the next search', () => {
		let s = next(searching, { type: 'RESULTS', result: result() });
		s = next(s, { type: 'VIEW', view: 'single' });
		s = run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }, { type: 'RESULTS', result: result() }], s);
		expect(s).toMatchObject({ phase: 'results', view: 'single' });
	});

	it('adds the next six without repeating a card already shown', () => {
		let s = next(searching, { type: 'RESULTS', result: result(undefined, 2) });
		s = next(s, { type: 'MORE', cards: [answer('sg.moh.chas-referral'), answer('sg.cpf.balance')], nextOffset: null });
		expect(s.phase === 'results' && s.result.cards.map((c) => c.id)).toEqual([
			'sg.moh.gpfirst-emergency-referral',
			'sg.moh.chas-referral',
			'sg.cpf.balance',
		]);
		expect(s.phase === 'results' && s.result.nextOffset).toBeNull();
	});

	it('shows addresses when the answer is a list of places, and still takes a new question', () => {
		const places = {
			heard: { short: 'Clinic in Bedok', sentence: 'You want a CHAS clinic in Bedok.' },
			places: [{ id: 'chas:1', kind: 'chas-clinic' as const, name: 'Bedok Family Clinic' }],
			what: 'chas-clinic' as const,
			area: 'bedok',
			source: { datasetId: 'd_548', kind: 'chas-clinic', name: 'CHAS Clinics', agency: 'Ministry of Health', lastUpdatedAt: '2024-06-06', url: 'https://data.gov.sg', licence: 'Singapore Open Data Licence', fetchedAt: '2026-09-17' },
			language: 'en' as const,
		};
		const s = next(searching, { type: 'PLACES', result: places });
		expect(s).toMatchObject({ phase: 'places' });
		expect(next(s, { type: 'PRESS' }).phase).toBe('arming');
		expect(next(s, { type: 'TOPIC', area: 'health' }).phase).toBe('searching');
	});

	it('greets back on a greeting, and says so when nothing is close', () => {
		expect(next(searching, { type: 'GREETING' })).toMatchObject({ phase: 'home', greeting: true });
		expect(next(searching, { type: 'NOTHING', heard: result().heard })).toMatchObject({ phase: 'notfound' });
	});

	it('takes a follow-up question during a live session, from wherever they are', () => {
		const results = run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }, { type: 'RESULTS', result: result() }]);
		expect(next(results, { type: 'ASKING' }).phase).toBe('searching');
		expect(next(initial(), { type: 'ASKING' }).phase).toBe('searching');
		const steps = run([{ type: 'START', id: 'sg.moh.gpfirst-emergency-referral' }, { type: 'YES' }], results);
		expect(next(steps, { type: 'ASKING' }).phase).toBe('searching');
	});

	it('searches a topic without the microphone', () => {
		expect(next(initial(), { type: 'TOPIC', area: 'health' })).toMatchObject({ phase: 'searching', topic: 'health' });
	});
});

describe('guided steps', () => {
	const results = run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }, { type: 'RESULTS', result: result() }]);

	it('asks before starting, and "Not this" returns to the same cards', () => {
		const confirm = next(results, { type: 'START', id: 'sg.moh.gpfirst-emergency-referral' });
		expect(confirm.phase).toBe('confirm');
		expect(next(confirm, { type: 'NO' })).toEqual(results);
	});

	it('walks the steps one confirmation at a time, then finishes', () => {
		let s = run([{ type: 'START', id: 'sg.moh.gpfirst-emergency-referral' }, { type: 'YES' }], results);
		expect(s).toMatchObject({ phase: 'steps', index: 0 });
		for (let i = 0; i < 4; i++) s = next(s, { type: 'STEP_DONE' });
		expect(s).toMatchObject({ phase: 'steps', index: 4 });
		s = next(s, { type: 'STEP_DONE' });
		expect(s.phase).toBe('done');
		expect(next(s, { type: 'BACK' })).toEqual(results);
	});

	it('goes one step back, leaves from the first step, and returns from the end to the last step', () => {
		const first = run([{ type: 'START', id: 'sg.moh.gpfirst-emergency-referral' }, { type: 'YES' }], results);
		const third = run([{ type: 'STEP_DONE' }, { type: 'STEP_DONE' }], first);
		expect(next(third, { type: 'STEP_BACK' })).toMatchObject({ phase: 'steps', index: 1 });
		expect(next(first, { type: 'STEP_BACK' })).toEqual(results);
		const done = run(Array.from({ length: 5 }, () => ({ type: 'STEP_DONE' }) as const), first);
		expect(done.phase).toBe('done');
		expect(next(done, { type: 'STEP_BACK' })).toMatchObject({ phase: 'steps', index: 4 });
		expect(next(done, { type: 'STEPS_AGAIN' })).toMatchObject({ phase: 'steps', index: 0 });
		expect(next(results, { type: 'STEP_BACK' })).toBe(results);
	});

	it('remembers the steps cleared ahead after going back, and goes forward through them without clearing again', () => {
		const first = run([{ type: 'START', id: 'sg.moh.gpfirst-emergency-referral' }, { type: 'YES' }], results);
		const third = run([{ type: 'STEP_DONE' }, { type: 'STEP_DONE' }], first);
		const back = run([{ type: 'STEP_BACK' }, { type: 'STEP_BACK' }], third);
		expect(back).toMatchObject({ phase: 'steps', index: 0, reached: 2 });
		expect(run([{ type: 'STEP_NEXT' }, { type: 'STEP_NEXT' }], back)).toMatchObject({ phase: 'steps', index: 2, reached: 2 });
		// Not past the furthest step reached: that one still needs clearing.
		expect(next(third, { type: 'STEP_NEXT' })).toBe(third);
		expect(next(first, { type: 'STEP_NEXT' })).toBe(first);
		// From the end and back, every step is cleared, so Finish goes to the end again.
		const done = run(Array.from({ length: 5 }, () => ({ type: 'STEP_DONE' }) as const), first);
		const last = next(done, { type: 'STEP_BACK' });
		expect(next(last, { type: 'STEP_NEXT' }).phase).toBe('done');
		expect(next(done, { type: 'STEPS_AGAIN' })).not.toHaveProperty('reached');
	});

	describe('asking a question from a step (plan-suara-0020, C3 and C5)', () => {
		const onStep3 = () => run([{ type: 'START', id: 'sg.moh.gpfirst-emergency-referral' }, { type: 'YES' }, { type: 'STEP_DONE' }, { type: 'STEP_DONE' }, { type: 'STEP_DONE' }, { type: 'STEP_BACK' }], results);
		const heard = { short: 'GPFirst hospitals', sentence: 'You want to know which hospitals take the form.', about: { step: 3, name: 'Go to A&E the same day' } };

		it('keeps the guide through the question, and Back returns to the same step with its stages still cleared', () => {
			const step = onStep3();
			expect(step).toMatchObject({ phase: 'steps', index: 2, reached: 3 });
			const answered = run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }, { type: 'RESULTS', result: { ...result(), heard } }], step);
			expect(answered).toMatchObject({ phase: 'results', guide: { phase: 'steps', index: 2, reached: 3 } });
			expect(next(answered, { type: 'BACK' })).toEqual(step);
		});

		it('comes back the same way from the web, from nothing found, and from a live question', () => {
			const step = onStep3();
			const searching = run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }], step);
			const web = run([{ type: 'WEB_SEARCH', heard, language: 'en' }, { type: 'WEB_ANSWER', answer: { kind: 'answer' } as never }], searching);
			expect(web).toMatchObject({ phase: 'web', guide: { index: 2 } });
			expect(next(web, { type: 'BACK' })).toEqual(step);
			expect(next(next(searching, { type: 'NOTHING', heard }), { type: 'BACK' })).toEqual(step);
			expect(next(next(step, { type: 'ASKING' }), { type: 'BACK' })).toEqual(step);
		});

		it('returns to the step when they said nothing, rather than to home', () => {
			const step = onStep3();
			expect(run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'SILENCE' }], step)).toEqual(step);
		});

		it('lets go of the guide when they go home or start another guide', () => {
			const answered = run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }, { type: 'RESULTS', result: result() }], onStep3());
			expect(next(answered, { type: 'HOME' })).not.toHaveProperty('guide');
			const another = run([{ type: 'START', id: 'sg.moh.gpfirst-emergency-referral' }, { type: 'YES' }], answered);
			expect(another).toMatchObject({ phase: 'steps', index: 0 });
			expect(another).not.toHaveProperty('guide');
		});
	});

	it('does not start steps for an answer card', () => {
		expect(next(results, { type: 'START', id: 'sg.moh.chas-referral' })).toEqual(results);
	});
});

describe('stale events', () => {
	it('ignores a late search result once the person has gone home', () => {
		const home = initial();
		expect(next(home, { type: 'RESULTS', result: result() })).toBe(home);
	});

	it('goes home from anywhere', () => {
		const s = run([{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }, { type: 'RESULTS', result: result() }, { type: 'HOME' }]);
		expect(s).toMatchObject({ phase: 'home', greeting: false });
	});
});

describe('a journey', () => {
	const card = () => process();
	const stage = (id: string, over = {}) => ({
		id,
		name: `Stage ${id}`,
		when: 'first-week',
		priority: 'soon',
		who: ['CPF'],
		cards: ['sg.moh.gpfirst-emergency-referral'],
		done_when: 'You have done it',
		blocked_by: [],
		...over,
	});

	const journeyResult = () => ({
		heard: { short: 'Someone died', sentence: 'Your father has died.' },
		journey: {
			schema_version: '1.0.0',
			id: 'sg.journey.death-of-a-loved-one',
			language: 'en',
			title: { short: 'Someone has died', full: 'When someone close to you dies' },
			summary: 'What happens now.',
			search: { example_phrasings: ['my father passed away', 'my mother died', 'someone died'] },
			stages: [stage('certificate'), stage('funeral')],
			concludes_when: 'The estate is settled.',
		},
		cards: [card()],
		language: 'en',
	});

	it('opens on the journey, with nothing yet done', () => {
		const state = next(initial(), { type: 'JOURNEY', result: journeyResult() } as FlowEvent);
		expect(state.phase).toBe('journey');
		if (state.phase !== 'journey') return;
		expect(state.done).toEqual([]);
	});

	it('remembers what the person says they have finished, and lets them take it back', () => {
		let state = next(initial(), { type: 'JOURNEY', result: journeyResult() } as FlowEvent);
		state = next(state, { type: 'STAGE_DONE', id: 'certificate' } as FlowEvent);
		expect(state.phase === 'journey' && state.done).toEqual(['certificate']);
		state = next(state, { type: 'STAGE_DONE', id: 'certificate' } as FlowEvent);
		expect(state.phase === 'journey' && state.done).toEqual(['certificate']);
		state = next(state, { type: 'STAGE_UNDONE', id: 'certificate' } as FlowEvent);
		expect(state.phase === 'journey' && state.done).toEqual([]);
	});

	it('opens a stage as cards, the same screen as any other answer', () => {
		let state = next(initial(), { type: 'JOURNEY', result: journeyResult() } as FlowEvent);
		state = next(state, { type: 'STAGE_CARDS', id: 'certificate' } as FlowEvent);
		expect(state.phase).toBe('results');
		if (state.phase !== 'results') return;
		expect(state.result.cards).toHaveLength(1);
		expect(state.result.heard.short).toBe('Stage certificate');
	});

	it('ignores a stage that is not in this journey', () => {
		const state = next(next(initial(), { type: 'JOURNEY', result: journeyResult() } as FlowEvent), {
			type: 'STAGE_CARDS',
			id: 'nowhere',
		} as FlowEvent);
		expect(state.phase).toBe('journey');
	});
});
