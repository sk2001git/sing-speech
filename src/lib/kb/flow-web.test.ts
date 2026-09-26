import { describe, expect, it } from 'vitest';
import { canSpeak, initial, next, type FlowEvent, type FlowState, type Heard } from './flow';
import type { WebAnswer } from './web-answer';

/** Web answers: the add-on behind the knowledge base (vault plan suara-2026-09-25-feature-web-steps). */
const heard: Heard = { short: 'Buy bitcoin', sentence: 'How can I buy bitcoin on Coinbase?', said: 'How can I buy bitcoin on Coinbase?' };

const guide = (over: Partial<WebAnswer> = {}): WebAnswer => ({
	kind: 'steps',
	title_short: 'Buy Bitcoin',
	title_full: 'How to buy Bitcoin on Coinbase',
	summary: 'Add a payment method, then review and buy.',
	answer: '',
	answer_urls: [],
	prerequisites: 'You need a verified Coinbase account.',
	steps: [
		{ name: 'Add a payment method', text: 'Add a debit card.', confirm_label: 'Card added', source_urls: ['https://help.coinbase.com/a'] },
		{ name: 'Review and buy', text: 'Tap Buy now.', confirm_label: 'Bought', source_urls: ['https://help.coinbase.com/b'] },
	],
	legal: { applies: false, text: '', source_urls: [] },
	disclaimer: 'Not financial advice.',
	sources: [{ url: 'https://help.coinbase.com/a', title: 'Pay', site: 'Coinbase Help' }],
	cautions: [],
	dropped: 0,
	official: false,
	...over,
});

const run = (events: FlowEvent[], from: FlowState = initial()) => events.reduce(next, from);
const toSearching: FlowEvent[] = [{ type: 'PRESS' }, { type: 'GRANTED' }, { type: 'STOP' }];
const toWebSearch: FlowEvent[] = [...toSearching, { type: 'WEB_SEARCH', heard, language: 'en' }];

describe('web search, when the knowledge base has nothing', () => {
	it('moves from searching to searching the web, keeping what was heard', () => {
		const s = run(toWebSearch);
		expect(s).toMatchObject({ phase: 'web-searching', heard, language: 'en', stage: null });
	});

	it('only starts from a search in progress', () => {
		const home = initial();
		expect(next(home, { type: 'WEB_SEARCH', heard, language: 'en' })).toBe(home);
	});

	it('shows each real stage as the search reports it', () => {
		const s = run([...toWebSearch, { type: 'WEB_STAGE', stage: { stage: 'searching' } }, { type: 'WEB_STAGE', stage: { stage: 'reading', pages: 9 } }]);
		expect(s).toMatchObject({ phase: 'web-searching', stage: { stage: 'reading', pages: 9 } });
	});

	it('ignores a stage that arrives after the answer', () => {
		const s = run([...toWebSearch, { type: 'WEB_ANSWER', answer: guide() }]);
		expect(next(s, { type: 'WEB_STAGE', stage: { stage: 'writing' } })).toBe(s);
	});

	it('shows the answer from the web', () => {
		const s = run([...toWebSearch, { type: 'WEB_ANSWER', answer: guide() }]);
		expect(s).toMatchObject({ phase: 'web', result: { heard, language: 'en', answer: { kind: 'steps' } } });
	});

	it('says plainly when the web had no reliable answer either', () => {
		const s = run([...toWebSearch, { type: 'WEB_ANSWER', answer: guide({ kind: 'none', steps: [] }) }]);
		expect(s).toMatchObject({ phase: 'notfound', heard, web: true });
	});

	it('falls back to "not in Suara yet" when the web search fails', () => {
		const s = run([...toWebSearch, { type: 'NOTHING', heard }]);
		expect(s).toMatchObject({ phase: 'notfound', heard });
		expect(s).not.toHaveProperty('web');
	});
});

describe('web steps', () => {
	const shown = () => run([...toWebSearch, { type: 'WEB_ANSWER', answer: guide() }]);

	it('asks before starting, and "Not this" returns to the answer', () => {
		const answer = shown();
		const confirm = next(answer, { type: 'WEB_START' });
		expect(confirm.phase).toBe('web-confirm');
		expect(next(confirm, { type: 'NO' })).toBe(answer);
	});

	it('walks every step, then says it is done; Back returns to the answer', () => {
		const answer = shown();
		const first = run([{ type: 'WEB_START' }, { type: 'YES' }], answer);
		expect(first).toMatchObject({ phase: 'web-steps', index: 0 });
		const second = next(first, { type: 'STEP_DONE' });
		expect(second).toMatchObject({ phase: 'web-steps', index: 1 });
		const done = next(second, { type: 'STEP_DONE' });
		expect(done.phase).toBe('web-done');
		expect(next(done, { type: 'BACK' })).toBe(answer);
		expect(next(first, { type: 'BACK' })).toBe(answer);
	});

	it('has nothing to start on a direct answer', () => {
		const answer = run([...toWebSearch, { type: 'WEB_ANSWER', answer: guide({ kind: 'answer', answer: 'No.', steps: [] }) }]);
		expect(next(answer, { type: 'WEB_START' })).toBe(answer);
	});

	it('lets them ask again by voice from the answer, a step, or the end', () => {
		const answer = shown();
		expect(canSpeak(answer)).toBe(true);
		expect(canSpeak(run([{ type: 'WEB_START' }, { type: 'YES' }], answer))).toBe(true);
		expect(canSpeak(run([{ type: 'WEB_START' }, { type: 'YES' }, { type: 'STEP_DONE' }, { type: 'STEP_DONE' }], answer))).toBe(true);
		expect(canSpeak(run(toWebSearch))).toBe(false);
	});

	it('lets them pick a topic from the answer', () => {
		expect(next(shown(), { type: 'TOPIC', area: 'health' }).phase).toBe('searching');
	});
});
