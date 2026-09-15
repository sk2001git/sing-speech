import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import index from '../../../data/kb/index.json';
import { parseEntry, type Entry } from '../../lib/kb/entry';
import type { FlowState, SearchResult } from '../../lib/kb/flow';
import KbScreen, { type KbScreenProps } from './KbScreen';

const entries = (index.entries as unknown[]).map((raw) => {
	const r = parseEntry(raw);
	if (!r.ok) throw new Error(r.errors.join('\n'));
	return r.entry;
});
const byId = (id: string) => entries.find((e) => e.id === id)!;

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
	heard: { short: 'A&E referral costs', sentence: 'Your doctor sent you to A&E, and you want to know if it costs less.' },
	fit: 'strong',
	cards: entries.slice(0, 6),
	nextOffset: 6,
	query: 'doctor referred me to A&E',
	language: 'en',
	...over,
});

const noop = () => {};
function render(state: FlowState, over: Partial<KbScreenProps> = {}) {
	// Text compared as a reader sees it: React escapes apostrophes and ampersands.
	return renderToStaticMarkup(
		<KbScreen state={state} setting="en" englishIds={[]} loadingMore={false} dispatch={noop} onSpeak={noop} onMore={noop} onTopic={noop} onSay={noop} onLanguage={noop} {...over} />,
	)
		.replace(/&#x27;/g, "'")
		.replace(/&quot;(?![^<]*>)/g, '"')
		.replace(/&amp;/g, '&');
}

const results = (r: SearchResult, openId: string | null = null, view: 'grid' | 'single' = 'grid'): FlowState => ({ phase: 'results', view, result: r, openId });

describe('Home', () => {
	it('asks what they need, offers the microphone and six topics, and no helpline', () => {
		const html = render({ phase: 'home', view: 'grid', greeting: false });
		expect(html).toContain('What do you need?');
		expect(html).toContain('Tap to speak');
		expect(html.match(/data-topic=/g)).toHaveLength(6);
		expect(html).not.toMatch(/helpline|1800-/i);
	});

	it('greets back after a greeting', () => {
		expect(render({ phase: 'home', view: 'grid', greeting: true })).toContain('Hello! What do you need?');
	});
});

describe('Results', () => {
	it('shows six closed cards with one-line titles, the best match marked, and a way to load six more', () => {
		const html = render(results(result()));
		expect(html.match(/data-card=/g)).toHaveLength(6);
		expect(html).toContain('6 answers');
		expect(html.match(/Best match/g)).toHaveLength(1);
		expect(html).toContain('Show 6 more');
		expect(html).toContain(entries[0]!.title.short);
		expect(html).not.toContain(entries[0]!.summary.text);
	});

	it('opens a card in place: summary, detail drop-downs, source link and its action', () => {
		const e = byId('sg.moh.medishield-vs-careshield');
		const html = render(results(result({ cards: [e] }), e.id));
		expect(html).toContain(e.summary.text);
		expect(html).toContain('<details');
		expect(html).toContain(e.details![0]!.heading);
		expect(html).toContain(e.sources[0]!.url);
		expect(html).toContain('Read aloud');
	});

	it('gives a process card a Start guide button, and a phone answer a call link', () => {
		const guide = byId('sg.moh.gpfirst-emergency-referral');
		expect(render(results(result({ cards: [guide] }), guide.id))).toContain('Start guide');
		const call = byId('sg.moh.pioneer-card-replacement');
		expect(render(results(result({ cards: [call] }), call.id))).toContain('href="tel:18006506060"');
	});

	it('labels weak matches as the closest, never as a sure match', () => {
		const html = render(results(result({ fit: 'weak' })));
		expect(html).toContain('Closest I have, not a sure match');
		expect(html).not.toContain('Best match');
	});

	it('marks cards still in English for a Chinese reader', () => {
		const html = render(results(result({ language: 'zh-Hans' })), { setting: 'zh-Hans', englishIds: [entries[0]!.id] });
		expect(html).toContain('English');
		expect(html.match(/data-english=/g)).toHaveLength(1);
	});

	it('switches between two per row and one large card', () => {
		expect(render(results(result(), null, 'grid'))).toContain('data-view="grid"');
		expect(render(results(result(), null, 'single'))).toContain('data-view="single"');
	});
});

describe('Guided steps', () => {
	const e: Entry = byId('sg.moh.gpfirst-emergency-referral');
	const back = results(result({ cards: [e] })) as Extract<FlowState, { phase: 'results' }>;

	it('asks before starting, with full-card yes and no', () => {
		const html = render({ phase: 'confirm', view: 'grid', entry: e, back });
		expect(html).toContain('Start these steps?');
		expect(html).toContain('confirm-yes');
		expect(html).toContain('confirm-no');
	});

	it('shows one open step with its own confirm label, done steps above and later steps closed', () => {
		const html = render({ phase: 'steps', view: 'grid', entry: e, index: 1, back });
		expect(html).toContain('Step 2 of 5');
		expect(html).toContain(e.steps![1]!.confirm_label);
		expect(html).toContain(e.steps![1]!.text);
		expect(html).not.toContain(e.steps![2]!.text);
		expect(html).toContain(e.steps![2]!.name);
	});
});

describe('Not in Suara', () => {
	it('says so plainly and offers topics and asking again, never a person', () => {
		const html = render({ phase: 'notfound', view: 'grid', heard: { short: 'Renew my passport', sentence: 'x' } });
		expect(html).toContain('Not in Suara yet');
		expect(html).toContain('Renew my passport');
		expect(html).toContain('Ask again');
		expect(html).not.toMatch(/helpline|person|1800-/i);
	});
});

describe('Chinese interface', () => {
	it('uses Chinese words when Chinese is chosen', () => {
		const html = render({ phase: 'home', view: 'grid', greeting: false }, { setting: 'zh-Hans' });
		expect(html).toContain('您需要什么帮助？');
		expect(html).toContain('中文');
	});
});
