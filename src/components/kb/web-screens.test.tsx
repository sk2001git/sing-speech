import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FlowState, Heard, WebResult } from '../../lib/kb/flow';
import type { WebAnswer } from '../../lib/kb/web-answer';
import type { ReplySetting } from '../../lib/kb/hearing';
import KbScreen, { type KbScreenProps } from './KbScreen';

/**
 * The web-answer screens, ported from the mockup the owner approved
 * (design/web-steps/web-steps.html; vault plan suara-2026-09-25-feature-web-steps).
 */
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
		{ name: 'Add a payment method', text: 'Add a Singapore debit card.', confirm_label: 'Card added', source_urls: ['https://help.coinbase.com/a'] },
		{ name: 'Start a purchase', text: 'Tap Buy.', confirm_label: 'Bitcoin chosen', source_urls: ['https://help.coinbase.com/b'] },
		{ name: 'Review and buy', text: 'Tap Buy now.', confirm_label: 'Bought', source_urls: ['https://help.coinbase.com/b'] },
		{ name: 'Check your balance', text: 'Open Assets.', confirm_label: 'Checked', source_urls: ['https://help.coinbase.com/b'] },
	],
	legal: { applies: true, text: 'Coinbase Singapore is licensed by MAS.', source_urls: ['https://eservices.mas.gov.sg/fid'] },
	disclaimer: 'Not financial advice.',
	sources: [
		{ url: 'https://help.coinbase.com/a', title: 'Payment methods', site: 'Coinbase Help' },
		{ url: 'https://help.coinbase.com/b', title: 'How do I buy crypto?', site: 'Coinbase Help' },
		{ url: 'https://eservices.mas.gov.sg/fid', title: 'Financial Institutions Directory', site: 'MAS' },
	],
	cautions: ['Prices move quickly.'],
	dropped: 0,
	official: false,
	...over,
});
const scooter = (): WebAnswer =>
	guide({
		kind: 'answer',
		title_full: 'Can you ride an e-scooter on footpaths?',
		summary: 'No. Ride only on cycling paths.',
		answer: 'No. E-scooters may be ridden only on cycling paths.',
		answer_urls: ['https://onemotoring.lta.gov.sg/x'],
		prerequisites: '',
		steps: [],
		legal: { applies: false, text: '', source_urls: [] },
		disclaimer: 'Rules may change.',
		sources: [{ url: 'https://onemotoring.lta.gov.sg/x', title: 'E-Scooters', site: 'Land Transport Authority' }],
		cautions: [],
		official: true,
	});

const web = (answer: WebAnswer = guide()): Extract<FlowState, { phase: 'web' }> => ({ view: 'single', phase: 'web', result: { heard, answer, language: 'en' } satisfies WebResult });

const noop = () => {};
function render(state: FlowState, over: Partial<KbScreenProps> = {}, setting: ReplySetting = 'en') {
	return renderToStaticMarkup(
		<KbScreen state={state} setting={setting} englishIds={[]} loadingMore={false} dispatch={noop} onSpeak={noop} onMore={noop} onTopic={noop} onSay={noop} onLanguage={noop} {...over} />,
	)
		.replace(/&#x27;/g, "'")
		.replace(/&quot;(?![^<]*>)/g, '"')
		.replace(/&amp;/g, '&');
}

describe('Home, typing as well as speaking', () => {
	it('keeps the microphone first and offers a text field under it', () => {
		const html = render({ phase: 'home', view: 'single', greeting: false }, { onAsk: noop });
		expect(html).toContain('Tap to speak');
		expect(html).toMatch(/<form class="k-ask"[^>]*>.*<input[^>]*placeholder="Or type your question"/);
		expect(html.indexOf('k-orb')).toBeLessThan(html.indexOf('k-ask'));
	});

	it('has no text field when the driver cannot take one', () => {
		expect(render({ phase: 'home', view: 'single', greeting: false })).not.toContain('k-ask');
	});
});

describe('Searching the web', () => {
	const searching = (stage: Extract<FlowState, { phase: 'web-searching' }>['stage']): FlowState => ({ view: 'single', phase: 'web-searching', heard, language: 'en', stage, pages: stage?.stage === 'reading' ? stage.pages : 0 });

	it('shows what they said and what is happening, not a blank wait', () => {
		const html = render(searching(null));
		expect(html).toContain('How can I buy bitcoin on Coinbase?');
		expect(html).toContain('Searching the web');
		expect(html).toMatch(/class="k-webstage" data-s="now"[^>]*>.*Finding pages/);
	});

	it('marks the stages the search has passed', () => {
		const html = render(searching({ stage: 'reading', pages: 9 }));
		expect(html).toMatch(/data-s="done"[^>]*>.*Finding pages/);
		expect(html).toMatch(/data-s="now"[^>]*>.*Reading 9 pages/);
		expect(html).toMatch(/data-s="todo"[^>]*>.*Writing the answer/);
	});
});

describe('A guide from the web', () => {
	it('says it is from the web and leads with the title, summary and what they need first', () => {
		const html = render(web());
		expect(html).toContain('From the web');
		expect(html).toContain('How to buy Bitcoin on Coinbase');
		expect(html).toContain('Add a payment method, then review and buy.');
		expect(html).toMatch(/class="k-pre"><b>Before you start:<\/b> you need a verified Coinbase account\./);
		expect(html).toContain('4 steps');
		expect(html).toContain('Start guide');
	});

	it('shows the law, open and clearly marked, and keeps the cautions folded', () => {
		const html = render(web());
		expect(html).toMatch(/<section class="k-legal"[^>]*>.*Legal.*Coinbase Singapore is licensed by MAS\./);
		expect(html).toMatch(/<details class="k-know">(?!.*<details class="k-know" open)/);
		expect(html).toContain('Prices move quickly.');
	});

	it('says how many steps it left out, inside the folded notes', () => {
		expect(render(web(guide({ dropped: 2 })))).toMatch(/k-know.*I could only check 4 steps of 6 against the pages I found, so I left 2 out\./);
	});

	it('names every page it used and always carries fine print', () => {
		const html = render(web());
		expect(html).toContain('Financial Institutions Directory');
		expect(html).toMatch(/class="k-fine">Found on the web, not an official answer\. Not financial advice\./);
	});

	it('has no Legal box when the law does not come into it', () => {
		expect(render(web(guide({ legal: { applies: false, text: '', source_urls: [] } })))).not.toContain('k-legal');
	});
});

describe('A direct answer from the web', () => {
	it('answers in words with no guide to start', () => {
		const html = render(web(scooter()));
		expect(html).toContain('No. E-scooters may be ridden only on cycling paths.');
		expect(html).not.toContain('Start guide');
	});

	it('calls government pages official in the fine print', () => {
		expect(render(web(scooter()))).toMatch(/class="k-fine">From official government pages, found by web search\. Rules may change\./);
	});
});

describe('Web steps', () => {
	const answer = web();

	it('asks before starting, in a sheet', () => {
		const html = render({ view: 'single', phase: 'web-confirm', back: answer });
		expect(html).toContain('Start these 4 steps?');
		expect(html).toContain('Yes, start');
		expect(html).toContain('Not this');
	});

	it('opens the current step with its source, and folds the far ones', () => {
		const html = render({ view: 'single', phase: 'web-steps', index: 0, back: answer });
		expect(html).toContain('Step 1 of 4');
		expect(html).toContain('Add a Singapore debit card.');
		expect(html).toContain('Card added');
		expect(html).toMatch(/href="https:\/\/help\.coinbase\.com\/a"[^>]*>From Coinbase Help · Payment methods/);
		expect(html).toMatch(/<details class="k-later">.*1 more step/);
	});

	it('says every step is done at the end', () => {
		const html = render({ view: 'single', phase: 'web-done', back: answer });
		expect(html).toContain('That is every step');
		expect(html).toContain('How to buy Bitcoin on Coinbase');
	});
});

describe('Nothing, even on the web', () => {
	it('says it could not find a reliable answer rather than "not in Suara"', () => {
		const html = render({ view: 'single', phase: 'notfound', heard, web: true });
		expect(html).toContain('I could not find a reliable answer');
		expect(html).not.toContain('Not in Suara yet');
	});
});

describe('In Chinese', () => {
	it('labels the web answer in Chinese', () => {
		const zh = { view: 'single', phase: 'web', result: { heard, answer: guide(), language: 'zh-Hans' } } as const;
		const html = render(zh, {}, 'zh-Hans');
		expect(html).toContain('来自网络');
		expect(html).toContain('开始步骤');
	});
});

describe('A typed question', () => {
	it('is shown in full as asked, not as said', () => {
		const typed = { short: 'How can I buy bitcoin f', sentence: 'How can I buy bitcoin from Coinbase?' };
		const html = render({ view: 'single', phase: 'web', result: { heard: typed, answer: guide(), language: 'en' } });
		expect(html).toMatch(/You asked<\/span><p>“How can I buy bitcoin from Coinbase\?”/);
		expect(html).not.toContain('You said');
	});
});

describe('The closest answers', () => {
	const weak: FlowState = {
		view: 'single',
		phase: 'results',
		openId: null,
		result: { heard, fit: 'weak', cards: [], nextOffset: null, query: 'buy bitcoin', language: 'en' },
	};

	it('stay on screen, with the web one tap away', () => {
		const html = render(weak, { onWebSearch: noop });
		expect(html).toContain('Closest I have, not a sure match');
		expect(html).toMatch(/<button class="k-btn k-btn-quiet k-btn-mid k-web-go" type="button">.*Search the web instead/);
	});

	it('offer no web search where the route has none', () => {
		expect(render(weak)).not.toContain('Search the web instead');
	});

	it('offer no web search over a sure match', () => {
		const strong = { ...weak, result: { ...(weak as Extract<FlowState, { phase: 'results' }>).result, fit: 'strong' as const } };
		expect(render(strong, { onWebSearch: noop })).not.toContain('Search the web instead');
	});
});

describe('A guide kept from an earlier web search', () => {
	it('says in the fine print when it was found', () => {
		const html = render({ view: 'single', phase: 'web', result: { heard, answer: scooter(), language: 'en', foundAt: '2026-09-20T03:00:00.000Z' } });
		expect(html).toMatch(/class="k-fine">From official government pages, found by web search on 20 Sept? 2026\. Rules may change\./);
	});
});
