import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { adminNext, adminStart, type AdminState } from '../../lib/admin-flow';
import type { WebAnswer } from '../../lib/kb/web-answer';
import type { GuideListing, KeptGuide } from '../../lib/kb/web-guides';
import { AdminView, type AdminViewProps } from './Admin';

/** The screens of the approved mockup, design/admin/admin.html. */
const NOW = Date.parse('2026-09-27T12:00:00Z');
const row = (id: string, status: GuideListing['status'], over: Partial<GuideListing> = {}): GuideListing => ({
	id,
	question: 'How can I buy bitcoin on Coinbase?',
	title: 'How to buy Bitcoin on Coinbase',
	sites: ['Coinbase Help', 'Monetary Authority of Singapore'],
	language: 'en',
	status,
	foundAt: '2026-09-27T08:00:00.000Z',
	official: false,
	space: 'openai',
	...over,
});
const answer: WebAnswer = {
	kind: 'steps',
	title_short: 'Buy Bitcoin',
	title_full: 'How to buy Bitcoin on Coinbase',
	summary: 'Verify, add a card, then buy.',
	answer: '',
	answer_urls: [],
	prerequisites: 'You need a verified Coinbase account.',
	steps: [{ name: 'Add a payment method', text: 'Add a debit card.', confirm_label: 'Added', source_urls: ['https://help.coinbase.com/a'] }],
	legal: { applies: true, text: 'Coinbase Singapore is licensed by MAS.', source_urls: ['https://eservices.mas.gov.sg/fid'] },
	disclaimer: 'Not financial advice.',
	sources: [
		{ url: 'https://help.coinbase.com/a', title: 'Payment methods', site: 'Coinbase Help' },
		{ url: 'https://eservices.mas.gov.sg/fid', title: 'Financial Institutions Directory', site: 'Monetary Authority of Singapore' },
	],
	cautions: [],
	dropped: 0,
	official: false,
};
const kept = (id: string): KeptGuide => ({ id, question: 'How can I buy bitcoin on Coinbase?', answer, language: 'en', foundAt: '2026-09-27T08:00:00.000Z', status: 'pending', space: 'openai' });

const signedIn = (guides: GuideListing[]): AdminState => [{ type: 'SIGNED_IN' as const }, { type: 'LOADED' as const, guides }].reduce(adminNext, adminStart());
const noop = () => {};
const render = (state: AdminState, over: Partial<AdminViewProps> = {}) =>
	renderToStaticMarkup(<AdminView state={state} now={NOW} dispatch={noop} onSignIn={noop} onSignOut={noop} onAdd={noop} {...over} />)
		.replace(/&#x27;/g, "'")
		.replace(/&quot;(?![^<]*>)/g, '"')
		.replace(/&amp;/g, '&');

describe('Sign in', () => {
	it('asks for the password, and says when it was wrong', () => {
		const html = render({ ...adminStart(), signedIn: false, error: 'That is not the password.' });
		expect(html).toMatch(/<input[^>]*type="password"[^>]*autoComplete="current-password"|<input[^>]*type="password"/);
		expect(html).toContain('Sign in');
		expect(html).toContain('That is not the password.');
	});

	it('shows nothing but a quiet page while the session is checked', () => {
		expect(render(adminStart())).not.toContain('Sign in');
	});
});

describe('The queue', () => {
	it('has Waiting and Live tabs with counts, newest first', () => {
		const html = render(signedIn([row('a', 'pending'), row('b', 'pending'), row('l', 'live')]));
		expect(html).toMatch(/Waiting <span class="count">2<\/span>/);
		expect(html).toMatch(/Live <span class="count">1<\/span>/);
		expect(html.match(/class="row"/g)).toHaveLength(2);
	});

	it('shows each guide with its question, sites, badge and age', () => {
		const html = render(signedIn([row('a', 'pending')]));
		expect(html).toContain('How to buy Bitcoin on Coinbase');
		expect(html).toContain('“How can I buy bitcoin on Coinbase?”');
		expect(html).toContain('Coinbase Help, Monetary Authority of Singapore');
		expect(html).toMatch(/class="badge wait">Waiting/);
		expect(html).toContain('Today');
	});

	it('marks a guide from government pages only', () => {
		const html = render({ ...signedIn([row('g', 'live', { sites: ['CPF Board'], official: true })]), tab: 'live' });
		expect(html).toMatch(/class="badge gov">Government pages only/);
		expect(render(signedIn([row('a', 'pending')]))).not.toContain('Government pages only');
	});

	it('does not say the queue is empty before the list has arrived', () => {
		const html = render(adminNext(adminStart(), { type: 'SIGNED_IN' }));
		expect(html).not.toContain('Nothing waiting');
		expect(html).toContain('class="skel"');
	});

	it('says what an empty Waiting means', () => {
		expect(render(signedIn([]))).toContain('Nothing waiting');
	});

	it('offers to add a guide by question', () => {
		expect(render(signedIn([]))).toMatch(/<form class="add"[^>]*>.*placeholder="Add a guide: type a question"/);
	});
});

describe('One guide, open', () => {
	const open = () => adminNext(adminNext(signedIn([row('a', 'pending'), row('b', 'pending')]), { type: 'OPEN', id: 'a' }), { type: 'DETAIL', guide: kept('a') });

	it('says why it waits, naming the sites that are not government pages', () => {
		expect(render(open())).toContain('Waiting because it cites Coinbase Help, not only government pages.');
	});

	it('shows the guide as a person sees it, and every source to check', () => {
		const html = render(open());
		expect(html).toContain('From the web');
		expect(html).toContain('Add a debit card.');
		expect(html).toMatch(/class="legal".*Coinbase Singapore is licensed by MAS\./);
		expect(html).toMatch(/href="https:\/\/eservices\.mas\.gov\.sg\/fid"/);
		expect(html).toContain('1 of 2 waiting');
	});

	it('offers Approve and Discard while it waits, and Take down once live', () => {
		expect(render(open())).toMatch(/Discard.*Approve/);
		const live = adminNext(adminNext({ ...signedIn([row('l', 'live')]), tab: 'live' }, { type: 'OPEN', id: 'l' }), { type: 'DETAIL', guide: { ...kept('l'), status: 'live' } });
		const html = render(live);
		expect(html).toContain('Take down');
		expect(html).not.toContain('Approve');
	});

	it('shows a skeleton until the guide has loaded', () => {
		const loading = adminNext(signedIn([row('a', 'pending')]), { type: 'OPEN', id: 'a' });
		expect(render(loading)).toContain('class="skel"');
	});
});

describe('After an action', () => {
	it('offers Undo', () => {
		const s = [{ type: 'OPEN' as const, id: 'a' }, { type: 'ACT' as const, action: 'discard' as const }].reduce(adminNext, signedIn([row('a', 'pending')]));
		const html = render(s);
		expect(html).toMatch(/class="toast".*Discarded\..*Undo/);
	});
});
