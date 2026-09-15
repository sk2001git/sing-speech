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

	it('greets back on a greeting, and says so when nothing is close', () => {
		expect(next(searching, { type: 'GREETING' })).toMatchObject({ phase: 'home', greeting: true });
		expect(next(searching, { type: 'NOTHING', heard: result().heard })).toMatchObject({ phase: 'notfound' });
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
