import { describe, expect, it } from 'vitest';
import { quickFind, scoreOne, type Findable } from './quick';

const card = (id: string, label: string, heading: string, extra: Partial<Findable> = {}): Findable => ({
	id,
	label,
	heading,
	tags: [],
	asked: '',
	...extra,
});

const corpus: Findable[] = [
	card('sg.cpf.medisave-family', 'MediSave family', 'Paying a family member’s bill with MediSave', {
		tags: ['healthcare-financing', 'medisave'],
		asked: 'can I use my MediSave to pay my father hospital bill',
	}),
	card('sg.cpf.medisave-limits', 'MediSave limits', 'MediSave withdrawal limits for hospitalisation'),
	card('sg.moh.chas-apply', 'Apply for CHAS', 'Applying for a CHAS card', { tags: ['chas', 'subsidies'] }),
	card('sg.moh.chas-clinics', 'CHAS clinics', 'Finding a clinic that takes CHAS'),
	card('sg.cpf.nomination', 'CPF nomination', 'Making a CPF nomination'),
	card('sg.moh.nursing-home', 'Nursing home', 'Paying nursing home bills'),
];

describe('scoreOne', () => {
	it('scores a word the person typed in full above one they only started', () => {
		const whole = scoreOne('chas', card('a', 'Apply for CHAS', 'Applying for a CHAS card'));
		const part = scoreOne('cha', card('a', 'Apply for CHAS', 'Applying for a CHAS card'));
		expect(whole).toBeGreaterThan(part);
	});

	it('gives nothing when a letter of the term is missing', () => {
		expect(scoreOne('zzz', card('a', 'MediSave family', 'Paying with MediSave'))).toBe(0);
	});

	it('prefers a match at the start of a word to one buried inside', () => {
		const atStart = scoreOne('med', card('a', 'MediSave limits', 'MediSave withdrawal limits'));
		const inside = scoreOne('med', card('b', 'Remedies', 'Legal remedies'));
		expect(atStart).toBeGreaterThan(inside);
	});

	it('prefers letters that run together to letters scattered through the words', () => {
		const together = scoreOne('save', card('a', 'MediSave limits', 'MediSave withdrawal limits'));
		const scattered = scoreOne('save', card('b', 'Silver Support and value', 'Silver Support and value'));
		expect(together).toBeGreaterThan(scattered);
	});
});

describe('quickFind', () => {
	const ids = (typed: string) => quickFind(corpus, typed).map((hit) => hit.item.id);

	it('finds a card from the first letters of one word', () => {
		expect(ids('medi')[0]).toMatch(/medisave/);
	});

	it('finds a card when the words are typed in the wrong order', () => {
		expect(ids('family medisave')[0]).toBe('sg.cpf.medisave-family');
		expect(ids('medisave family')[0]).toBe('sg.cpf.medisave-family');
	});

	it('forgives one typo in a word long enough to have one', () => {
		expect(ids('medsave')[0]).toMatch(/medisave/);
		expect(ids('mediave')[0]).toMatch(/medisave/);
		expect(ids('nursign home')[0]).toBe('sg.moh.nursing-home');
	});

	it('does not forgive a typo in a short word, where it would match everything', () => {
		expect(ids('cha')).toContain('sg.moh.chas-apply');
		expect(quickFind(corpus, 'xyz')).toEqual([]);
	});

	it('requires every word typed to match something', () => {
		// "limits" belongs to another card, so the pair should find nothing rather than
		// showing the card that matches half of what was asked for.
		expect(quickFind(corpus, 'family limits')).toEqual([]);
	});

	it('ranks the card about the thing above the card that merely mentions it', () => {
		expect(ids('chas')[0]).toBe('sg.moh.chas-apply');
	});

	it('matches the tags and the question a person once asked, not only the title', () => {
		expect(ids('hospital bill father')[0]).toBe('sg.cpf.medisave-family');
		expect(ids('subsidies')[0]).toBe('sg.moh.chas-apply');
	});

	it('says where the letters matched, so they can be marked on screen', () => {
		const [hit] = quickFind(corpus, 'chas');
		expect(hit!.marks.length).toBeGreaterThan(0);
		const marked = hit!.marks.map(([from, to]) => hit!.item.label.slice(from, to)).join('');
		expect(marked.toLowerCase()).toBe('chas');
	});

	it('returns nothing for an empty box rather than the whole corpus', () => {
		expect(quickFind(corpus, '   ')).toEqual([]);
	});

	it('gives back at most the number asked for, best first', () => {
		const hits = quickFind(corpus, 'a', 3);
		expect(hits.length).toBeLessThanOrEqual(3);
		for (let i = 1; i < hits.length; i += 1) expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
	});

	it('is fast enough to run on every keystroke', () => {
		const many = Array.from({ length: 2000 }, (_, i) => card(`sg.x.${i}`, `Card ${i}`, `A heading about MediSave ${i}`));
		const started = performance.now();
		for (const typed of ['m', 'me', 'med', 'medi', 'medis']) quickFind(many, typed);
		expect(performance.now() - started).toBeLessThan(250);
	});
});
