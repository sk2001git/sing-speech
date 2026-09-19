import { describe, expect, it } from 'vitest';
import { onePerPage, richness } from './dedupe';
import { parseEntry, type Entry } from './entry';
import example from '../../../docs/knowledge-base/examples/sg.moh.gpfirst-emergency-referral.json';

function entry(id: string, url: string, over: Partial<Entry> = {}): Entry {
	const parsed = parseEntry(structuredClone(example));
	if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
	const e = { ...parsed.entry, id, ...over };
	e.sources = [{ ...parsed.entry.sources[0]!, url }];
	return e;
}

const page = 'https://ask.gov.sg/cpf/questions/cm7b5q0m400jlyb4ux7hpp87j';
const other = 'https://ask.gov.sg/cpf/questions/cm0f52kw0003npz7a2bpygdlq';

describe('onePerPage', () => {
	it('keeps one entry per official page', () => {
		const kept = onePerPage([entry('sg.cpf.how-mmss-works', page), entry('sg.cpf.how-the-medisave-match-works', page)]);
		expect(kept).toHaveLength(1);
	});

	it('keeps the one that says more', () => {
		const thin = entry('sg.cpf.thin', page, { details: undefined, steps: undefined, kind: 'answer' });
		thin.summary = { ...thin.summary, text: 'Short.' };
		const full = entry('sg.cpf.full', page);
		expect(onePerPage([thin, full])[0]!.id).toBe('sg.cpf.full');
		expect(onePerPage([full, thin])[0]!.id).toBe('sg.cpf.full');
	});

	it('leaves entries from different pages alone', () => {
		const kept = onePerPage([entry('sg.cpf.one', page), entry('sg.cpf.two', other)]);
		expect(kept.map((e) => e.id).sort()).toEqual(['sg.cpf.one', 'sg.cpf.two']);
	});

	it('keeps the order it was given, so a build is repeatable', () => {
		const kept = onePerPage([entry('sg.cpf.b', other), entry('sg.cpf.a', page)]);
		expect(kept.map((e) => e.id)).toEqual(['sg.cpf.b', 'sg.cpf.a']);
	});
});

describe('richness', () => {
	it('counts what a person actually gets: steps, details and quotes', () => {
		const withSteps = entry('sg.cpf.steps', page);
		const without = entry('sg.cpf.plain', page, { steps: undefined, details: undefined, kind: 'answer' });
		expect(richness(withSteps)).toBeGreaterThan(richness(without));
	});
});
