import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FlowState } from '../../lib/kb/flow';
import { readBack } from '../../lib/kb/readback';
import KbScreen, { type KbScreenProps } from './KbScreen';
import Said from './Said';

/**
 * Owner, 2026-09-27: "double confirm where we will always read to the reader what their question
 * is, and allow them to type to correct if needed. i think it helps, if a social volunteer uses."
 */
const noop = () => {};
const clean = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;(?![^<]*>)/g, '"').replace(/&amp;/g, '&');

describe('Said', () => {
	it('shows their words and offers to correct them by typing', () => {
		const html = clean(renderToStaticMarkup(<Said said="How do I apply for chas?" label="You said" lang="en" onAsk={noop} />));
		expect(html).toContain('You said');
		expect(html).toContain('“How do I apply for chas?”');
		expect(html).toMatch(/<button[^>]*class="k-said-edit"[^>]*>Not right\? Change it<\/button>/);
	});

	it('offers no correction where a typed question cannot be taken', () => {
		expect(renderToStaticMarkup(<Said said="x" label="You said" lang="en" />)).not.toContain('k-said-edit');
	});

	it('speaks Chinese to a Chinese reader', () => {
		expect(renderToStaticMarkup(<Said said="急诊要等多久" label="您说" lang="zh-Hans" onAsk={noop} />)).toContain('不对？修改');
	});
});

describe('every answer screen shows the question', () => {
	const render = (state: FlowState, over: Partial<KbScreenProps> = {}) =>
		clean(renderToStaticMarkup(<KbScreen state={state} setting="en" englishIds={[]} loadingMore={false} dispatch={noop} onSpeak={noop} onMore={noop} onTopic={noop} onSay={noop} onLanguage={noop} onAsk={noop} {...over} />));

	it('including a life event, which did not show it before', () => {
		const state = {
			view: 'single',
			phase: 'journey',
			done: [],
			result: {
				heard: { short: 'Father passed away', sentence: 'Your father passed away.', said: 'My father passed away last week' },
				journey: { id: 'j', title: { short: 't', full: 'When someone dies' }, summary: 's', stages: [], ends: 'e', sources: [] },
				cards: [],
				language: 'en',
			},
		} as unknown as FlowState;
		const html = render(state);
		expect(html).toContain('“My father passed away last week”');
		expect(html).toContain('Not right? Change it');
	});

	it('including a question nothing answered', () => {
		const html = render({ view: 'single', phase: 'notfound', heard: { short: 'x', sentence: 'x', said: 'my aircon is broken' } });
		expect(html).toContain('“my aircon is broken”');
		expect(html).toContain('Not right? Change it');
	});
});

describe('readBack', () => {
	it('says the question before the answer, spoken or typed', () => {
		expect(readBack({ short: 's', sentence: 'You want CHAS.', said: 'How do I apply for CHAS' }, 'en', 'Best match: Ways to apply for CHAS.')).toBe('You asked: How do I apply for CHAS. Best match: Ways to apply for CHAS.');
		expect(readBack({ short: 's', sentence: 'how do I apply for CHAS?' }, 'en', 'Best match.')).toBe('You asked: how do I apply for CHAS? Best match.');
	});

	it('in Chinese', () => {
		expect(readBack({ short: 's', sentence: 's', said: '急诊要等多久' }, 'zh-Hans', '上周…')).toBe('您问：急诊要等多久。上周…');
	});

	it('says only the answer when there is no question to repeat', () => {
		expect(readBack(undefined, 'en', 'Hello! What do you need?')).toBe('Hello! What do you need?');
	});
});
