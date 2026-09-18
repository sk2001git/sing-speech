import { describe, expect, it } from 'vitest';
import { buildRawIndex, searchRaw, tokenise, type RawDoc } from './raw-store';

const doc = (id: string, title: string, text: string, extra: Partial<RawDoc> = {}): RawDoc => ({
	id,
	agency: 'cpf',
	url: `https://ask.gov.sg/cpf/questions/${id}`,
	title,
	text,
	topics: [],
	useful: 0,
	updatedAt: null,
	...extra,
});

const docs: RawDoc[] = [
	doc(
		'medisave-family',
		'Can I use my MediSave to pay for my family member’s medical bills?',
		'You can use your MediSave for your spouse, children, parents and grandparents, up to the withdrawal limit for the treatment.',
		{ topics: ['Healthcare Financing / MediSave'], useful: 12 },
	),
	doc(
		'medisave-limits',
		'What are the MediSave withdrawal limits for hospitalisation?',
		'MediSave withdrawal limits apply per day of hospitalisation and per surgical procedure.',
		{ topics: ['Healthcare Financing / MediSave'], useful: 40 },
	),
	doc('cpf-nomination', 'How do I make a CPF nomination?', 'You can make a CPF nomination online with your Singpass.', {
		topics: ['Account Services / Nomination'],
		useful: 90,
	}),
	doc('employer-late', 'What happens if an employer pays CPF contributions late?', 'Late payment interest is charged at 1.5% per month.', {
		topics: ['Employer / Obligations'],
		useful: 3,
	}),
];

const index = buildRawIndex(docs);

describe('tokenise', () => {
	it('folds case, drops punctuation and reduces a plural to its singular', () => {
		expect(tokenise('MediSave — withdrawal LIMITS?')).toEqual(['medisave', 'withdrawal', 'limit']);
	});

	it('leaves a short name alone, because CHAS is not a plural of CHA', () => {
		// "how do I apply for the CHAS card" retrieved lost-card replacement pages: the word
		// the whole question turns on had been stemmed away.
		expect(tokenise('how do I apply for the CHAS card')).toEqual(['apply', 'chas', 'card']);
		// A four-letter acronym keeps its s, even a plural one: getting CHAS right matters more
		// than matching SOC to SOCs, which nobody says out loud.
		expect(tokenise('MediSave and CPF and HDB and SOCs')).toEqual(['medisave', 'cpf', 'hdb', 'socs']);
	});

	it('still reduces a real plural', () => {
		expect(tokenise('nominations premiums claims')).toEqual(['nomination', 'premium', 'claim']);
	});

	it('treats a curly apostrophe like a straight one', () => {
		expect(tokenise('member’s')).toEqual(tokenise("member's"));
	});

	it('drops words that carry no meaning in a question', () => {
		expect(tokenise('what is the how do i can')).toEqual([]);
	});
});

describe('searchRaw', () => {
	it('finds the question that is actually about the words asked', () => {
		const hits = searchRaw(index, 'can I use my CPF to pay my father hospital bill');
		expect(hits[0]!.doc.id).toBe('medisave-family');
	});

	it('does not answer a question it holds nothing about', () => {
		expect(searchRaw(index, 'when is the next bus to Tampines')).toEqual([]);
	});

	it('ranks by the words, not by how popular a question is', () => {
		// cpf-nomination is the most useful-marked document by a wide margin.
		const hits = searchRaw(index, 'MediSave withdrawal limit hospitalisation');
		expect(hits[0]!.doc.id).toBe('medisave-limits');
	});

	it('uses popularity only to separate two equally good matches', () => {
		const tied = buildRawIndex([
			doc('quiet', 'How do I top up my MediSave?', 'Top up your MediSave online.', { useful: 1 }),
			doc('asked', 'How do I top up my MediSave?', 'Top up your MediSave online.', { useful: 200 }),
		]);
		expect(searchRaw(tied, 'how do I top up my MediSave')[0]!.doc.id).toBe('asked');
	});

	it('counts a topic label as part of the question', () => {
		const hits = searchRaw(index, 'healthcare financing');
		expect(hits.map((h) => h.doc.id)).toContain('medisave-family');
	});

	it('returns at most the number asked for, best first', () => {
		const hits = searchRaw(index, 'MediSave CPF', 2);
		expect(hits).toHaveLength(2);
		expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
	});

	it('ignores a page that shares only one stray word with the question', () => {
		// "which brand of vitamin should I buy for my knee" found a page about whether a TCM
		// clinic may advertise acupuncture for knee pain: one word in common, nothing to do
		// with the question, and a model will happily write a card from it.
		const strays = buildRawIndex([
			doc(
				'tcm-advertising',
				'Can Traditional Chinese Medicine practitioners advertise that acupuncture treats knee pain?',
				'No. Non-licensees cannot advertise that acupuncture can treat specific medical conditions such as backache and knee pain.',
			),
		]);
		expect(searchRaw(strays, 'which brand of vitamin should I buy for my knee')).toEqual([]);
	});

	it('keeps a page that answers the question in the words asked', () => {
		const strays = buildRawIndex([
			doc('acupuncture', 'Can a TCM clinic advertise acupuncture for knee pain?', 'No. Non-licensees cannot advertise that.'),
		]);
		expect(searchRaw(strays, 'can the TCM clinic advertise acupuncture for my knee pain')[0]!.doc.id).toBe('acupuncture');
	});

	it('matches a plural against the singular the agency wrote', () => {
		expect(searchRaw(index, 'medisave withdrawal limit')[0]!.doc.id).toBe('medisave-limits');
		expect(searchRaw(index, 'cpf nominations')[0]!.doc.id).toBe('cpf-nomination');
	});
});
