import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EdWaitChart } from '../../lib/charts/ed-wait-source';
import { canSpeak, initial, next, type FlowState } from '../../lib/kb/flow';
import KbScreen, { type KbScreenProps } from './KbScreen';

/** The A&E chart card, as approved in design/charts/ed-wait.html (vault plan-suara-0017). */
const data: EdWaitChart = {
	week: { from: '2026-09-13', to: '2026-09-19' },
	latest: { AH: 1.13, CGH: 1.72, TTSH: 3.75, SKH: 14.18 },
	weeks: [
		{ end: '2026-07-25', values: { AH: 1.2, CGH: 1.5, TTSH: 3.5, SKH: 9 } },
		{ end: '2026-08-08', values: {} },
		{ end: '2026-09-19', values: { AH: 1.13, CGH: 1.72, TTSH: 3.75, SKH: 14.18 } },
	],
	first: '2023-01-01',
	fetchedAt: '2026-09-27T08:00:00.000Z',
	file: 'WT for Admission to Ward_week37Y2026.xlsx',
};
const heard = { short: 'A&E wait', sentence: 'How long is the wait at A&E?', said: 'How long is the wait at A&E?' };
const chart = (focus: string | null, language: 'en' | 'zh-Hans' = 'en'): FlowState => ({ view: 'single', phase: 'chart', result: { chart: 'ed-wait', heard, data, focus, language } });

const noop = () => {};
const render = (state: FlowState, setting: 'en' | 'zh-Hans' = 'en', over: Partial<KbScreenProps> = {}) =>
	renderToStaticMarkup(<KbScreen state={state} setting={setting} englishIds={[]} loadingMore={false} dispatch={noop} onSpeak={noop} onMore={noop} onTopic={noop} onSay={noop} onLanguage={noop} {...over} />)
		.replace(/&#x27;/g, "'")
		.replace(/&quot;(?![^<]*>)/g, '"')
		.replace(/&amp;/g, '&');

describe('the chart in the flow', () => {
	it('comes after a search, and lets them ask again or pick a topic', () => {
		const searching = next(next(next(initial(), { type: 'PRESS' }), { type: 'GRANTED' }), { type: 'STOP' });
		const shown = next(searching, { type: 'CHART', result: { chart: 'ed-wait', heard, data, focus: 'TTSH', language: 'en' } });
		expect(shown).toMatchObject({ phase: 'chart', result: { focus: 'TTSH' } });
		expect(canSpeak(shown)).toBe(true);
		expect(next(shown, { type: 'TOPIC', area: 'health' }).phase).toBe('searching');
		expect(next(initial(), { type: 'CHART', result: { chart: 'ed-wait', heard, data, focus: null, language: 'en' } }).phase).toBe('home');
	});
});

describe('the A&E chart card', () => {
	it('states the finding in the headline, across all hospitals', () => {
		expect(render(chart(null))).toContain('Last week, the wait for a ward bed ran from about 1 h 10 min at Alexandra Hospital to about 14 h 10 min at Sengkang General');
	});

	it('names the asked-about hospital in the headline and highlights its bar', () => {
		const html = render(chart('TTSH'));
		expect(html).toContain('Last week at Tan Tock Seng, people waited about 3 h 50 min for a ward bed');
		expect(html).toMatch(/class="k-cbar" data-on="true"[^>]*>.*Tan Tock Seng/);
	});

	it('ranks the bars shortest first, from zero, each labelled', () => {
		const html = render(chart(null));
		const order = [...html.matchAll(/class="k-cbar-name">([^<]+)</g)].map((m) => m[1]);
		expect(order).toEqual(['Alexandra Hospital (urgent care)', 'Changi General', 'Tan Tock Seng', 'Sengkang General']);
		expect(html).toMatch(/0 h<\/span>/);
	});

	it('says plainly what the figure is not, and what to do in an emergency', () => {
		const html = render(chart(null));
		expect(html).toContain('This is not the wait to see a doctor.');
		expect(html).toMatch(/href="tel:995"/);
	});

	it('shows the trend for the named hospital, with MOH\'s missing week named', () => {
		const html = render(chart('TTSH'));
		expect(html).toMatch(/<svg[^>]*aria-label="Tan Tock Seng: weekly wait/);
		expect(html).toContain('MOH published no figures for 2 Aug to 8 Aug.');
	});

	it('gives the numbers as a table too, for screen readers', () => {
		expect(render(chart(null))).toMatch(/<table>.*Sengkang General.*14 h 10 min/);
	});

	it('always credits MOH, the week, the licence and when Suara checked', () => {
		const html = render(chart(null));
		expect(html).toMatch(/Ministry of Health, <a href="https:\/\/www\.moh\.gov\.sg\/[^"]+"[^>]*>Waiting Time for Admission to Ward<\/a>/);
		expect(html).toMatch(/<a href="https:\/\/data\.gov\.sg\/open-data-licence"[^>]*>Singapore Open Data Licence<\/a>/);
		expect(html).toContain('13 Sept to 19 Sept 2026');
		expect(html).toMatch(/checked 27 Sept 2026/);
	});

	it('speaks Chinese to a Chinese reader', () => {
		const html = render(chart('TTSH', 'zh-Hans'), 'zh-Hans');
		expect(html).toContain('陈笃生医院');
		expect(html).toContain('这不是看医生的等待时间');
		expect(html).toContain('卫生部');
	});
});
