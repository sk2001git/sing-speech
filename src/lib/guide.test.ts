import { describe, expect, it } from 'vitest';
import { HOSPITAL_VISIT, procedureFor, usableProcedure } from './guide';
import { advance, isReachable, validateProcedure, type Cursor, type Procedure } from './procedure';

describe('the hospital sample', () => {
	it('is a valid graph', () => {
		expect(validateProcedure(HOSPITAL_VISIT)).toEqual([]);
	});

	it('is marked as a sample and never as verified', () => {
		expect(HOSPITAL_VISIT.sample).toBe(true);
		expect(HOSPITAL_VISIT.verified).toBe(false);
	});

	it('opens with one yes/no question about the appointment letter', () => {
		const entry = HOSPITAL_VISIT.steps.find((s) => s.id === HOSPITAL_VISIT.entry)!;
		expect(typeof entry.next).toBe('object');
	});
});

describe('procedureFor', () => {
	it('sends appointment and doctor-cost requests into the hospital visit', () => {
		expect(procedureFor('appointment_prep')?.id).toBe('hospital-visit');
		expect(procedureFor('chas_subsidy')?.id).toBe('hospital-visit');
	});

	it('has no flow for a request it does not guide', () => {
		expect(procedureFor('wayfinding')).toBeNull();
		expect(procedureFor('human_handoff')).toBeNull();
	});
});

describe('usableProcedure', () => {
	it('hides a sample outside demo mode', () => {
		expect(usableProcedure(HOSPITAL_VISIT, false)).toBeNull();
	});

	it('allows a sample in demo mode', () => {
		expect(usableProcedure(HOSPITAL_VISIT, true)).toBe(HOSPITAL_VISIT);
	});

	it('never allows unverified content that is not a sample, even in demo mode', () => {
		expect(usableProcedure({ ...HOSPITAL_VISIT, sample: false }, true)).toBeNull();
	});

	it('always allows verified content', () => {
		const checked = { ...HOSPITAL_VISIT, sample: false, verified: true };
		expect(usableProcedure(checked, false)).toBe(checked);
	});
});

describe('advance', () => {
	const proc: Procedure = {
		id: 'p',
		ministry: 'moh',
		title: { en: 'P' },
		topic: 't',
		metadata: { cues: [], aliases: [] },
		entry: 's1',
		steps: [
			{ id: 's1', instruction: { en: 'Q' }, image: null, next: { question: { en: 'Q?' }, yes: 's2', no: 's3' } },
			{ id: 's2', instruction: { en: 'Two' }, image: null, next: 's3' },
			{ id: 's3', instruction: { en: 'Three' }, image: null, next: null },
		],
		verified: true,
		source: 'https://example.invalid',
		checkedOn: '2026-09-13',
	};
	const at = (stepId: string, done: string[] = []): Cursor => ({
		procedureId: 'p',
		stepId,
		done,
		startedAt: '2026-09-13T00:00:00.000Z',
	});

	it('does not move past a question without an answer', () => {
		expect(advance(proc, at('s1'))).toEqual(at('s1'));
	});

	it('follows yes', () => {
		expect(advance(proc, at('s1'), true)).toEqual(at('s2', ['s1']));
	});

	it('follows no', () => {
		expect(advance(proc, at('s1'), false)).toEqual(at('s3', ['s1']));
	});

	it('moves along a plain step', () => {
		expect(advance(proc, at('s2', ['s1']))).toEqual(at('s3', ['s1', 's2']));
	});

	it('returns null after the last step', () => {
		expect(advance(proc, at('s3', ['s1', 's2']))).toBeNull();
	});

	it('only ever produces a cursor the server would accept as reachable', () => {
		expect(isReachable(proc, advance(proc, at('s1'), false)!)).toBe(true);
	});
});
