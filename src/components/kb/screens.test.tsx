import { readFileSync } from 'node:fs';
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
/**
 * Picked by shape, not by id. The index holds one card per official page and is rebuilt as
 * the crawl grows, so a card that exists today may be replaced by a richer one for the same
 * page tomorrow — these tests need an answer with details, a process with steps and a card
 * that offers a phone call, not three particular entries.
 */
const pick = (wanted: (e: Entry) => boolean, what: string) => {
	const found = entries.find(wanted);
	if (!found) throw new Error(`no ${what} in data/kb/index.json for this test`);
	return found;
};
const anAnswer = () => pick((e) => e.kind === 'answer' && (e.details?.length ?? 0) > 0, 'answer card with details');
const aProcess = () => pick((e) => e.kind === 'process' && (e.steps?.length ?? 0) > 2, 'process card with three or more steps');
/**
 * An answer, not a process: a process card offers "Start guide" in that place, so the call
 * only ever shows on an answer.
 */
const aPhoneCard = () => pick((e) => e.kind === 'answer' && e.action?.type === 'call', 'answer card offering a call');

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

	it('says plainly when it heard nothing', () => {
		expect(render({ phase: 'home', view: 'grid', greeting: false, notice: 'nothing' })).toContain("I didn't hear you. Tap and try again.");
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
		const e = anAnswer();
		const html = render(results(result({ cards: [e] }), e.id));
		expect(html).toContain(e.summary.text);
		expect(html).toContain('<details');
		expect(html).toContain(e.details![0]!.heading);
		expect(html).toContain(e.sources[0]!.url);
		expect(html).toContain('Read aloud');
	});

	it('gives a process card a Start guide button, and a phone answer a call link', () => {
		const guide = aProcess();
		expect(render(results(result({ cards: [guide] }), guide.id))).toContain('Start guide');
		const call = aPhoneCard();
		const number = call.action!.value!;
		expect(render(results(result({ cards: [call] }), call.id))).toContain(`href="tel:${number}"`);
	});

	it('shows what they said, word for word, open above the cards', () => {
		const said = 'my doctor give me one letter, go emergency cheaper or not';
		const html = render(results(result({ heard: { ...result().heard, said } })));
		expect(html).toContain('You said');
		expect(html).toContain(said);
		expect(html.indexOf(said)).toBeLessThan(html.indexOf('data-card='));
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

describe('Held back', () => {
	it('says Suara is resting for the day, with nothing to tap that would only be refused', () => {
		const html = render({ phase: 'offline', view: 'grid', held: 'resting' });
		expect(html).toContain('Suara is resting');
		expect(html).not.toContain('Try again');
		expect(html).not.toContain('I could not connect');
	});
	it('asks a busy visitor to wait a minute, and lets them try again', () => {
		const html = render({ phase: 'offline', view: 'grid', held: 'busy' });
		expect(html).toContain('wait a minute');
		expect(html).toContain('Try again');
	});
});

describe('Searching', () => {
	it('shows what they said as soon as it is heard, while the answer is found', () => {
		const html = render({ phase: 'searching', view: 'grid', topic: null, said: 'medisave for my father can or not' });
		expect(html).toContain('medisave for my father can or not');
		expect(html).toContain('Finding answers');
	});
});

describe('Guided steps', () => {
	const e: Entry = aProcess();
	const back = results(result({ cards: [e] })) as Extract<FlowState, { phase: 'results' }>;

	it('shows every step before it starts, then one button to start (owner, 2026-09-29)', () => {
		const html = render({ phase: 'confirm', view: 'grid', entry: e, back });
		for (const st of e.steps!) expect(html).toContain(st.name);
		expect(html).toContain(`${e.steps!.length} steps · from`);
		expect(html).toContain('Start the guide');
		expect(html).toContain('confirm-yes');
		expect(html).not.toContain('Start these steps?');
	});

	it('shows a step in points, with its lead-in', () => {
		const inPoints = structuredClone(e);
		inPoints.steps![1]!.points = { lead: 'The form must show:', items: ['The referral date', 'The clinic stamp'] };
		const html = render({ phase: 'steps', view: 'grid', entry: inPoints, index: 1, back });
		expect(html).toMatch(/The form must show:[\s\S]*<ul class="k-pts"><li>The referral date<\/li><li>The clinic stamp<\/li><\/ul>/);
		expect(html).not.toContain(e.steps![1]!.text);
	});

	it('keeps "more" in a drop-down: the bottom line in bold, then the detail, the source, and asking about the step', () => {
		const withMore = structuredClone(e);
		withMore.steps![1]!.about = { text: 'GPFirst is only valid with the original form. A copy does not count.', quote_refs: [withMore.quotes[0]!.id] };
		const html = render({ phase: 'steps', view: 'grid', entry: withMore, index: 1, back });
		expect(html).toMatch(/<details class="k-xp"><summary>[\s\S]*More about this step[\s\S]*<b>GPFirst is only valid with the original form\.<\/b> A copy does not count\.[\s\S]*Ask about this step[\s\S]*<\/details>/);
		expect(html).not.toContain('k-guide-sheet');
	});

	it('does not bold a "more" that is one long sentence', () => {
		const long = structuredClone(e);
		long.steps![1]!.about = { text: 'GPFirst is accepted at Changi General Hospital, Khoo Teck Puat Hospital, National University Hospital, Ng Teng Fong General Hospital and Sengkang General Hospital.', quote_refs: [long.quotes[0]!.id] };
		const html = render({ phase: 'steps', view: 'grid', entry: long, index: 1, back });
		expect(html).toContain('<p class="k-about">GPFirst is accepted at Changi');
	});

	it('says so plainly when the source has nothing more about a step', () => {
		const html = render({ phase: 'steps', view: 'grid', entry: e, index: 1, back });
		expect(html).toMatch(/says nothing more about this step/);
	});

	it('shows one step on the page, with the stage before and the next either side of it', () => {
		const html = render({ phase: 'steps', view: 'grid', entry: e, index: 1, back });
		// Every bubble is named by its step; the count is for screen readers.
		expect(html).toContain(`Now, step 2 of ${e.steps!.length}: </span>${e.steps![1]!.name}</span>`);
		expect(html).toContain('aria-current="step"');
		expect(html).toContain(e.steps![1]!.confirm_label);
		// The step as written now: its points, or its text if it was written before points.
		expect(html).toContain((e.steps![1]!.points?.items[0] ?? e.steps![1]!.text));
		expect(html).toContain(`Cleared: step 1, ${e.steps![0]!.name}`);
		expect(html).toContain(e.steps![2]!.name);
		expect(html).not.toContain(e.steps![2]!.text);
		if (e.steps!.length > 3) expect(html).not.toContain(e.steps![3]!.name);
		expect(html).toContain('More about this step');
		expect(html).toContain('Back');
	});

	it('after going back, marks the next stage cleared and lets them go forward to it', () => {
		const html = render({ phase: 'steps', view: 'grid', entry: e, index: 0, reached: 2, back });
		expect(html).toContain(`Cleared: step 2, ${e.steps![1]!.name}. Go to it`);
		expect(render({ phase: 'steps', view: 'grid', entry: e, index: 1, reached: 1, back })).not.toContain('Go to it');
		const n = e.steps!.length;
		expect(render({ phase: 'steps', view: 'grid', entry: e, index: n - 1, reached: n, back })).toContain('Every step cleared. Go to the end');
	});

	it('marks the ends: Start before the first step, Finish after the last', () => {
		const n = e.steps!.length;
		expect(render({ phase: 'steps', view: 'grid', entry: e, index: 0, back })).toContain('Start');
		expect(render({ phase: 'steps', view: 'grid', entry: e, index: n - 1, back })).toContain('Finish');
	});

	it('ends with every step ticked, and a way through it again', () => {
		const html = render({ phase: 'done', view: 'grid', entry: e, back });
		for (const st of e.steps!) expect(html).toContain(`Cleared: </span>${st.name}`);
		expect(html).toContain('Go through it again');
		expect(html).toContain('Ask something else');
	});
});

describe('Places', () => {
	const placesState: FlowState = {
		phase: 'places',
		view: 'grid',
		result: {
			heard: { short: 'Clinic in Bedok', sentence: 'You want a CHAS clinic in Bedok.', said: 'got clinic near bedok or not' },
			places: [
				{ id: 'chas:1', kind: 'chas-clinic', name: 'BALKIS FAMILY CLINIC', phone: '96153314', block: '631', street: 'BEDOK RESERVOIR RD', unit: '01-968', postal: '470631', tags: ['CHAS'] },
				{ id: 'chas:2', kind: 'chas-clinic', name: 'Bedok Day Clinic', street: 'BEDOK SOUTH AVENUE 2', postal: '460456' },
			],
			what: 'chas-clinic',
			area: 'bedok',
			source: { datasetId: 'd_548', kind: 'chas-clinic', name: 'CHAS Clinics', agency: 'Ministry of Health', lastUpdatedAt: '2024-06-06', url: 'https://data.gov.sg/datasets/d_548/view', licence: 'Singapore Open Data Licence', fetchedAt: '2026-09-17T00:00:00Z' },
			language: 'en',
		},
	};

	it('lists each place with a readable address, not the shouting in the file', () => {
		const html = render(placesState);
		expect(html.match(/data-place=/g)).toHaveLength(2);
		expect(html).toContain('Balkis Family Clinic');
		expect(html).toContain('Blk 631 Bedok Reservoir Rd, #01-968, Singapore 470631');
	});

	it('offers a call for a place with a number, and nothing pretend for one without', () => {
		const html = render(placesState);
		expect(html.match(/href="tel:/g)).toHaveLength(1);
		expect(html).toContain('href="tel:96153314"');
	});

	it('names the dataset, the agency and when it was read, because this is not a quoted answer', () => {
		const html = render(placesState);
		expect(html).toContain('CHAS Clinics');
		expect(html).toContain('Ministry of Health');
		expect(html).toContain('data.gov.sg');
		expect(html).toMatch(/checked/i);
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

/**
 * The owner's taste-lab picks, rounds 1 and 2 (vault plan
 * suara-2026-09-25-feature-apply-taste-lab-picks): a quiet home, a voice pill while listening,
 * a grey outline while searching, the best answer first, and a sheet for yes and no.
 */
describe('Motion and state', () => {
	const home = (): FlowState => ({ phase: 'home', view: 'single', greeting: false });
	const e = aProcess();
	const back = results(result({ cards: [e] })) as Extract<FlowState, { phase: 'results' }>;

	it('keeps home to the microphone, with the topics behind one button', () => {
		const html = render(home());
		expect(html).not.toContain('k-wave-canvas');
		expect(html).not.toContain('k-chip');
		expect(html).toMatch(/<details class="k-more"><summary[^>]*>[^<]*Or pick a topic/);
		expect(html.match(/data-topic=/g)).toHaveLength(6);
	});

	it('listens with a live waveform above one big stop button at the bottom', () => {
		const html = render({ phase: 'listening', view: 'single' }, { level: 0.5 });
		expect(html).toMatch(/class="k-listen"[\s\S]*class="k-livewave"[^>]*role="img" aria-label="Live audio waveform"[\s\S]*class="k-stop" type="button" aria-label="Tap when done"/);
		expect(html).not.toContain('k-voice');
		expect(html).not.toContain('class="k-orb"');
	});

	it('shows a pulsing grey outline where the answer will be, and no light', () => {
		const html = render({ phase: 'searching', view: 'single', topic: null });
		expect(html).toContain('Finding answers');
		expect(html).toContain('k-skeleton');
		expect(html).not.toContain('mx-bolt');
		expect(html).not.toContain('class="k-orb"');
	});

	it('leads with the best answer: ticked, and with its summary showing', () => {
		const html = render(results(result(), null, 'single'));
		expect(html.match(/Best match/g)).toHaveLength(1);
		expect(html.match(/class="mx-mark/g)).toHaveLength(1);
		expect(html).toContain(entries[0]!.summary.text);
		expect(html).not.toContain(entries[1]!.summary.text);
		expect(html).not.toContain('mx-bolt');
	});

	it('gives a weak match no tick', () => {
		expect(render(results(result({ fit: 'weak' })))).not.toContain('mx-mark');
	});

	it('starts a guide from its list of steps, not from a yes-or-no sheet', () => {
		const html = render({ phase: 'confirm', view: 'single', entry: e, back });
		expect(html).toMatch(/<ol class="k-ov"[\s\S]*class="k-btn k-btn-primary confirm-yes"/);
		expect(html).not.toContain('class="k-sheet"');
	});

	it('comes back to the step from a question asked about it, and says which step it was about', () => {
		const step = { phase: 'steps' as const, view: 'single' as const, entry: e, index: 2, reached: 3, back };
		const heard = { short: 'GPFirst hospitals', sentence: 'You want to know which hospitals take the form.', about: { step: 3, name: e.steps![2]!.name } };
		const html = render({ ...results(result({ heard }), null, 'single'), guide: step } as FlowState);
		expect(html).toContain('Back to step 3');
		expect(html).toContain(`About step 3 · ${e.steps![2]!.name}`);
	});

	it('shows how far through the steps they are as three stages, not a bar (taste lab steps-10)', () => {
		const html = render({ phase: 'steps', view: 'single', entry: e, index: 1, back });
		expect(html.match(/class="k-trk[ "]/g)).toHaveLength(1);
		expect(html.match(/<li class="k-trk-/g)).toHaveLength(3);
		expect(html).not.toContain('role="progressbar"');
	});

	it('ends with a ticked list, not one large tick (taste lab steps-10)', () => {
		const html = render({ phase: 'done', view: 'single', entry: e, back });
		expect(html.match(/class="k-checks-d"/g)).toHaveLength(e.steps!.length);
		expect(html).not.toContain('--mx-size:80px');
	});
});

describe('Colour', () => {
	const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
	/** Every value the token takes: the light scheme first, then dark. */
	const token = (name: string) => [...css.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))].map((m) => m[1]!);
	const lum = (hex: string) => {
		const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
		return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
	};
	const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

	it('uses Apple blue for ticks and progress, in both schemes', () => {
		expect(token('light')).toEqual(['#007aff', '#007aff']);
	});

	it('puts white text on yes and on no at 4.5:1 or better, light and dark', () => {
		for (const name of ['ready', 'live']) {
			const values = token(name);
			expect(values).toHaveLength(2);
			for (const hex of values) expect(contrast(hex, '#ffffff'), `--${name} ${hex}`).toBeGreaterThanOrEqual(4.5);
		}
	});
});
