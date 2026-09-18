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

	it('still finds the page when the question arrives as a whole spoken sentence', () => {
		// What the hearing model passes on, not what a person types. The words that carry the
		// question are outnumbered by ordinary ones.
		const spoken = 'You want to know whether you can use your MediSave to pay your father hospital bill';
		expect(searchRaw(index, spoken)[0]!.doc.id).toBe('medisave-family');
	});

	it('meets the person’s words with the agency’s', () => {
		// "take out" is what a person says; "withdraw" is what CPF writes.
		const both = buildRawIndex([
			doc('withdrawal-55', 'When can I withdraw my CPF savings?', 'You may make a withdrawal from age 55.'),
			doc('top-up-limit', 'What is the maximum amount of top-ups I can receive?', 'The limit depends on your retirement sum.'),
		]);
		expect(searchRaw(both, 'how much CPF can I take out at 55')[0]!.doc.id).toBe('withdrawal-55');
	});

	it('still prefers the page that uses the person’s own word', () => {
		const both = buildRawIndex([
			doc('withdraw', 'When can I withdraw my CPF savings?', 'You may withdraw from age 55.'),
			doc('take-out', 'When can I take out my CPF savings?', 'You may take out savings from age 55.'),
		]);
		expect(searchRaw(both, 'when can I take out my CPF savings')[0]!.doc.id).toBe('take-out');
	});

	it('matches a plural against the singular the agency wrote', () => {
		expect(searchRaw(index, 'medisave withdrawal limit')[0]!.doc.id).toBe('medisave-limits');
		expect(searchRaw(index, 'cpf nominations')[0]!.doc.id).toBe('cpf-nomination');
	});
});
