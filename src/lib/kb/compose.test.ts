import { describe, expect, it } from 'vitest';
import { compose, composePrompt, draftToEntry, type Draft } from './compose';
import { parseEntry } from './entry';
import { checkQuotesFound, checkRefsResolve } from './grounding';
import type { RawDoc } from './raw-store';

const doc: RawDoc = {
	id: 'cm8qljjgm00mx6vqhm53h5lk0',
	agency: 'cpf',
	url: 'https://ask.gov.sg/cpf/questions/cm8qljjgm00mx6vqhm53h5lk0',
	title: 'Can I use my MediSave to pay for my family member’s medical bills?',
	text: [
		'You may use your MediSave for yourself and your approved dependants: your spouse, children, parents and grandparents.',
		'Tell the hospital or clinic that you wish to use MediSave, and sign the Medical Claims Authorisation Form.',
		'Withdrawal limits apply to each treatment.',
	].join('\n'),
	topics: ['Healthcare Financing / MediSave'],
	useful: 12,
	updatedAt: '2026-05-04T02:00:00.000Z',
};

const NOW = '2026-09-18T14:00:00.000Z';
const ASKED = 'can I use my CPF to pay my father hospital bill';

const draft: Draft = {
	kind: 'process',
	short: 'MediSave family',
	full: 'Paying a family member’s bill with MediSave',
	summary: 'You may use your MediSave for your parents, with a limit for each treatment.',
	summary_quote: 'You may use your MediSave for yourself and your approved dependants: your spouse, children, parents and grandparents.',
	steps: [
		{
			name: 'Check the relation',
			text: 'Your parents count as approved dependants, along with your spouse, children and grandparents.',
			confirm_label: 'He is my father',
			quote: 'You may use your MediSave for yourself and your approved dependants: your spouse, children, parents and grandparents.',
		},
		{
			name: 'Tell the hospital',
			text: 'Tell the hospital you want to use MediSave, and sign the Medical Claims Authorisation Form.',
			confirm_label: 'I have told them',
			quote: 'Tell the hospital or clinic that you wish to use MediSave, and sign the Medical Claims Authorisation Form.',
		},
	],
	details: [],
	phrasings: ['can I use my CPF for my father hospital bill', 'use medisave for parents medical bill', 'pay my mother hospital bill with medisave'],
};

describe('composePrompt', () => {
	const prompt = composePrompt({ asked: ASKED, docs: [doc], language: 'en' });

	it('gives the model the person’s own words and the official answer, and nothing else to draw on', () => {
		expect(prompt).toContain(ASKED);
		expect(prompt).toContain('Withdrawal limits apply to each treatment.');
		expect(prompt).toContain(doc.title);
	});

	it('states the rule that makes the card safe', () => {
		expect(prompt.toLowerCase()).toContain('verbatim');
	});

	it('states the limits the schema enforces, so a draft is not rejected for length', () => {
		expect(prompt).toContain('16');
		expect(prompt).toContain('140');
	});
});

describe('draftToEntry', () => {
	it('produces an entry the schema accepts', () => {
		const made = draftToEntry(draft, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		expect(made.ok).toBe(true);
		if (!made.ok) return;
		expect(parseEntry(made.entry).ok).toBe(true);
		expect(made.entry.id).toBe('sg.cpf.paying-a-family-members-bill-with-medisave');
		expect(made.entry.kind).toBe('process');
		expect(made.entry.steps?.map((s) => s.position)).toEqual([1, 2]);
	});

	it('every line it shows resolves to a quote that is on the page', () => {
		const made = draftToEntry(draft, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		if (!made.ok) throw new Error(made.errors.join('; '));
		expect(checkRefsResolve(made.entry, NOW).passed).toBe(true);
		expect(checkQuotesFound(made.entry, { src1: doc.text }, NOW).passed).toBe(true);
	});

	it('names the page, the agency and when it was read', () => {
		const made = draftToEntry(draft, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		if (!made.ok) throw new Error(made.errors.join('; '));
		expect(made.entry.sources[0]).toMatchObject({ id: 'src1', publisher: 'CPF', url: doc.url, page_title: doc.title });
		expect(made.entry.provenance.collected.method).toBe('sitemap-crawl');
		expect(made.entry.provenance.structured.method).toBe('model');
	});

	it('refuses a quote that is not on the page, however plausible it reads', () => {
		const invented = {
			...draft,
			steps: [{ ...draft.steps[0]!, quote: 'You may use your MediSave for your parents up to $500 a year.' }, draft.steps[1]!],
		};
		const made = draftToEntry(invented, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		expect(made.ok).toBe(false);
		if (made.ok) return;
		expect(made.errors.join(' ')).toContain('not on the page');
	});

	it('forgives a quote that differs only in spacing', () => {
		const respaced = { ...draft, summary_quote: draft.summary_quote.replace(/ /g, '  ') };
		expect(draftToEntry(respaced, { asked: ASKED, docs: [doc], language: 'en' }, NOW).ok).toBe(true);
	});

	it('uses one quote once, however many lines cite it', () => {
		const made = draftToEntry(draft, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		if (!made.ok) throw new Error(made.errors.join('; '));
		expect(made.entry.quotes).toHaveLength(2);
	});

	it('keeps the person’s own words as a phrasing, so the next person finds it', () => {
		const made = draftToEntry(draft, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		if (!made.ok) throw new Error(made.errors.join('; '));
		expect(made.entry.search.example_phrasings).toContain(ASKED);
	});

	it('shortens an overlong label from the heading instead of making the person wait', () => {
		// Every model tested overshot the 16-character label sometimes. A label is not a claim,
		// so it is repaired here rather than sent back for another attempt.
		const wordy = { ...draft, short: 'Using MediSave for a family member' };
		const made = draftToEntry(wordy, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		if (!made.ok) throw new Error(made.errors.join('; '));
		expect(made.entry.title.short).toBe('Paying a family');
		expect(made.entry.title.full).toBe('Paying a family member’s bill with MediSave');
	});

	it('refuses a summary too long for the card, because that carries meaning', () => {
		const wordy = { ...draft, summary: 'You may use your MediSave for your parents, '.repeat(5) };
		const made = draftToEntry(wordy, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		expect(made.ok).toBe(false);
		if (made.ok) return;
		expect(made.errors.join(' ')).toMatch(/summary is \d+ characters/);
	});

	it('refuses a heading written as a sentence', () => {
		const sentence = { ...draft, full: 'You can pay a family member bill.' };
		const made = draftToEntry(sentence, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		expect(made.ok).toBe(false);
		if (made.ok) return;
		expect(made.errors.join(' ')).toContain('heading, not a sentence');
	});

	it('refuses "Done" as a confirmation, because it is the person’s own words that reassure', () => {
		for (const label of ['Done', 'Next', 'OK', 'Continue']) {
			const lazy = { ...draft, steps: [{ ...draft.steps[0]!, confirm_label: label }] };
			const made = draftToEntry(lazy, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
			expect(made.ok, label).toBe(false);
		}
	});

	it('refuses a heading that only repeats the label', () => {
		const same = { ...draft, short: 'Who pays first', full: 'Who pays first' };
		const made = draftToEntry(same, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		expect(made.ok).toBe(false);
		if (made.ok) return;
		expect(made.errors.join(' ')).toMatch(/full/);
	});

	it('is an answer, not a process, when there are no steps', () => {
		const flat: Draft = {
			...draft,
			kind: 'answer',
			steps: [],
			details: [{ heading: 'Who counts', body: 'Your spouse, children, parents and grandparents.', quote: draft.summary_quote }],
		};
		const made = draftToEntry(flat, { asked: ASKED, docs: [doc], language: 'en' }, NOW);
		if (!made.ok) throw new Error(made.errors.join('; '));
		expect(made.entry.kind).toBe('answer');
		expect(made.entry.steps).toBeUndefined();
		expect(made.entry.details).toHaveLength(1);
	});
});

describe('a card written from more than one page', () => {
	const second: RawDoc = {
		...doc,
		id: 'cm0f52l0001mbpz7a9k6vyr1w',
		url: 'https://ask.gov.sg/cpf/questions/cm0f52l0001mbpz7a9k6vyr1w',
		title: 'What happens if my MediSave does not cover the whole bill?',
		text: 'Any amount above your withdrawal limit is paid in cash at the hospital.',
		agency: 'moh',
	};

	it('cites each quote to the page it came from', () => {
		const spread = {
			...draft,
			details: [{ heading: 'If it is not enough', body: 'The rest is paid in cash.', quote: 'Any amount above your withdrawal limit is paid in cash at the hospital.' }],
		};
		const made = draftToEntry(spread, { asked: ASKED, docs: [doc, second], language: 'en' }, NOW);
		if (!made.ok) throw new Error(made.errors.join('; '));
		expect(made.entry.sources.map((s) => s.url)).toEqual([doc.url, second.url]);
		const sourceOf = (starts: string) => made.entry.quotes.find((q) => q.text.startsWith(starts))?.source;
		expect(sourceOf('You may use your MediSave')).toBe('src1');
		expect(sourceOf('Any amount above your withdrawal limit')).toBe('src2');
	});

	it('names only the pages it actually quoted', () => {
		// The third page was offered and not used; a source line claiming it would be false.
		const made = draftToEntry(draft, { asked: ASKED, docs: [doc, second], language: 'en' }, NOW);
		if (!made.ok) throw new Error(made.errors.join('; '));
		expect(made.entry.sources).toHaveLength(1);
		expect(made.entry.sources[0]!.url).toBe(doc.url);
	});

	it('gives the writer every page it may draw on', () => {
		const prompt = composePrompt({ asked: ASKED, docs: [doc, second], language: 'en' });
		expect(prompt).toContain('Page 1');
		expect(prompt).toContain('Page 2');
		expect(prompt).toContain(second.text);
	});

	it('refuses a quote that is on none of them', () => {
		const invented = { ...draft, summary_quote: 'MediSave pays the whole bill.' };
		const made = draftToEntry(invented, { asked: ASKED, docs: [doc, second], language: 'en' }, NOW);
		expect(made.ok).toBe(false);
	});
});

describe('compose', () => {
	const request = { asked: ASKED, docs: [doc], language: 'en' as const };

	it('asks the writer once and returns the entry', async () => {
		const asked: string[] = [];
		const result = await compose(request, async (prompt) => {
			asked.push(prompt);
			return JSON.stringify(draft);
		}, NOW);
		expect(result.ok).toBe(true);
		expect(asked).toHaveLength(1);
	});

	it('reads a draft the model wrapped in a code fence', async () => {
		const result = await compose(request, async () => '```json\n' + JSON.stringify(draft) + '\n```', NOW);
		expect(result.ok).toBe(true);
	});

	it('tries once more, telling the model what was wrong', async () => {
		const prompts: string[] = [];
		const result = await compose(request, async (prompt) => {
			prompts.push(prompt);
			return JSON.stringify(prompts.length === 1 ? { ...draft, summary: 'MediSave covers your parents. '.repeat(8) } : draft);
		}, NOW);
		expect(result.ok).toBe(true);
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain('summary');
	});

	it('gives up rather than show an invention', async () => {
		const result = await compose(request, async () => JSON.stringify({ ...draft, summary_quote: 'MediSave covers everything.' }), NOW);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.join(' ')).toContain('not on the page');
	});

	it('takes the model’s word when the page does not answer the question', async () => {
		// The crawl returns the nearest page, which is not the same as an answer: "which brand
		// of vitamin for my knee" reached a page about advertising acupuncture for knee pain.
		let asked = 0;
		const result = await compose(
			request,
			async () => {
				asked += 1;
				return '{"kind":"none"}';
			},
			NOW,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.join(' ')).toContain('does not answer');
		expect(asked).toBe(1);
	});

	it('tells the model it may refuse', () => {
		expect(composePrompt(request)).toContain('{"kind":"none"}');
	});

	it('gives up on a reply that is not a draft at all', async () => {
		const result = await compose(request, async () => 'I cannot help with that.', NOW);
		expect(result.ok).toBe(false);
	});
});
