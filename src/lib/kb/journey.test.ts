import { describe, expect, it } from 'vitest';
import { nowNext, parseJourney, type Journey } from './journey';

const stage = (id: string, over: Partial<Journey['stages'][number]> = {}): Journey['stages'][number] => ({
	id,
	name: `Do ${id}`,
	when: 'first-week',
	priority: 'soon',
	who: ['CPF'],
	cards: ['sg.cpf.something'],
	done_when: 'You have told them',
	blocked_by: [],
	...over,
});

const journey = (over: Partial<Journey> = {}): unknown => ({
	schema_version: '1.0.0',
	id: 'sg.journey.death-of-a-loved-one',
	language: 'en',
	title: { short: 'Someone died', full: 'When someone close to you dies' },
	summary: 'What has to happen now, what can wait, and what is settled later.',
	search: {
		example_phrasings: ['my father passed away', 'what do I do when someone dies', 'my husband died last night'],
	},
	stages: [
		stage('register', { when: 'within-24-hours', priority: 'must-do-now', who: ['ICA'], done_when: 'You have the death certificate' }),
		stage('funeral', { when: 'within-24-hours', priority: 'must-do-now' }),
		stage('tell-agencies', { when: 'first-week', priority: 'soon', blocked_by: ['register'] }),
		stage('estate', { when: 'months', priority: 'settlement', blocked_by: ['register'] }),
	],
	concludes_when: 'The estate is settled and nothing is outstanding.',
	...over,
});

describe('parseJourney', () => {
	it('accepts a journey that says what to do, in what order, and when it ends', () => {
		const parsed = parseJourney(journey());
		expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('; ')).toBe(true);
	});

	it('refuses a journey with no ending, because an open list follows a grieving person around', () => {
		const parsed = parseJourney(journey({ concludes_when: '' }));
		expect(parsed.ok).toBe(false);
	});

	it('refuses a stage that does not say how a person knows it is finished', () => {
		const stages = [stage('register', { done_when: '' })];
		expect(parseJourney(journey({ stages: stages as Journey['stages'] })).ok).toBe(false);
	});

	it('refuses a stage with no card behind it, because the words would be ours and not an agency’s', () => {
		const stages = [stage('register', { cards: [] })];
		expect(parseJourney(journey({ stages: stages as Journey['stages'] })).ok).toBe(false);
	});

	it('refuses work that waits on a stage that does not exist', () => {
		const stages = [stage('estate', { blocked_by: ['probate'] })];
		const parsed = parseJourney(journey({ stages: stages as Journey['stages'] }));
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.errors.join(' ')).toContain('probate');
	});

	it('refuses two stages that wait on each other', () => {
		const stages = [stage('a', { blocked_by: ['b'] }), stage('b', { blocked_by: ['a'] })];
		const parsed = parseJourney(journey({ stages: stages as Journey['stages'] }));
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.errors.join(' ')).toMatch(/waits on itself|cycle/i);
	});

	it('refuses urgent work that waits on something months away', () => {
		const stages = [
			stage('estate', { when: 'months', priority: 'settlement' }),
			stage('register', { when: 'within-24-hours', priority: 'must-do-now', blocked_by: ['estate'] }),
		];
		const parsed = parseJourney(journey({ stages: stages as Journey['stages'] }));
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.errors.join(' ')).toMatch(/before|waits/i);
	});

	it('refuses more than three things at once, because that is not a list a person can hold', () => {
		const urgent = ['a', 'b', 'c', 'd'].map((id) => stage(id, { when: 'within-24-hours', priority: 'must-do-now' }));
		const parsed = parseJourney(journey({ stages: urgent as Journey['stages'] }));
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.errors.join(' ')).toMatch(/three|3/);
	});
});

describe('nowNext', () => {
	const made = parseJourney(journey());
	const j = made.ok ? made.entry : (undefined as never);

	it('shows only what can be started, urgent first', () => {
		const { now } = nowNext(j, new Set());
		expect(now.map((s) => s.id)).toEqual(['register', 'funeral']);
	});

	it('keeps back the work that genuinely waits on something else', () => {
		const { later } = nowNext(j, new Set());
		expect(later.map((s) => s.id)).toContain('tell-agencies');
	});

	it('releases the next work when the thing it waited on is done', () => {
		const { now } = nowNext(j, new Set(['register']));
		expect(now.map((s) => s.id)).toContain('tell-agencies');
	});

	it('moves what is finished out of the way', () => {
		const { done, now } = nowNext(j, new Set(['register', 'funeral']));
		expect(done.map((s) => s.id)).toEqual(['register', 'funeral']);
		expect(now.map((s) => s.id)).not.toContain('register');
	});

	it('never puts more than three things in front of a person at once', () => {
		const { now } = nowNext(j, new Set(['register']));
		expect(now.length).toBeLessThanOrEqual(3);
	});

	it('says when it is over', () => {
		const all = new Set(j.stages.map((s) => s.id));
		const { now, finished } = nowNext(j, all);
		expect(now).toEqual([]);
		expect(finished).toBe(true);
	});
});
