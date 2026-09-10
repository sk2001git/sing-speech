import { describe, expect, it } from 'vitest';
import {
	isReachable,
	localise,
	stepById,
	successors,
	validateProcedure,
	type Procedure,
} from './procedure';

/** A three-step line: s1 -> s2 -> s3. Placeholder content, never real guidance. */
function line(): Procedure {
	return {
		id: 'test-proc',
		ministry: 'cpf',
		title: { en: 'Test procedure' },
		topic: 'test',
		metadata: { cues: [], aliases: [] },
		entry: 's1',
		steps: [
			{ id: 's1', instruction: { en: 'First' }, image: null, next: 's2' },
			{ id: 's2', instruction: { en: 'Second' }, image: null, next: 's3' },
			{ id: 's3', instruction: { en: 'Third' }, image: null, next: null },
		],
		verified: false,
		source: 'https://example.invalid',
		checkedOn: null,
	};
}

describe('successors', () => {
	it('reports nothing for a terminal step', () => {
		expect(successors(line().steps[2]!)).toEqual([]);
	});

	it('reports both arms of a branch, because either is a legal next step', () => {
		const branch = {
			id: 'b',
			instruction: { en: 'Branch' },
			image: null,
			next: { question: { en: 'Do you have it?' }, yes: 's2', no: 's3' },
		};
		expect(successors(branch)).toEqual(['s2', 's3']);
	});
});

describe('localise', () => {
	it('falls back to English rather than showing a blank, because a blank step is unusable', () => {
		expect(localise({ en: 'First' }, 'nan')).toBe('First');
	});

	it('prefers the requested language when it was authored', () => {
		expect(localise({ en: 'First', zh: '第一' }, 'zh')).toBe('第一');
	});
});

describe('validateProcedure', () => {
	it('accepts a well-formed line', () => {
		expect(validateProcedure(line())).toEqual([]);
	});

	it('rejects an entry that is not a step', () => {
		const p = { ...line(), entry: 'nope' };
		expect(validateProcedure(p)).toContain('entry "nope" is not a step');
	});

	it('rejects a next that points nowhere, which would dead-end a user mid-flow', () => {
		const p = line();
		p.steps[1]!.next = 'ghost';
		expect(validateProcedure(p)).toContain('step "s2" points at missing step "ghost"');
	});

	it('rejects a cycle, because a loop means the user never finishes', () => {
		const p = line();
		p.steps[2]!.next = 's1';
		expect(validateProcedure(p)).toContain('graph has a cycle');
	});

	it('rejects an orphan step, which is authored content nobody can ever see', () => {
		const p = line();
		p.steps.push({ id: 'orphan', instruction: { en: 'Lost' }, image: null, next: null });
		expect(validateProcedure(p)).toContain('step "orphan" is unreachable from entry');
	});

	it('rejects a duplicate step id', () => {
		const p = line();
		p.steps.push({ id: 's2', instruction: { en: 'Twin' }, image: null, next: null });
		expect(validateProcedure(p)).toContain('duplicate step id "s2"');
	});
});

describe('isReachable', () => {
	const p = line();
	const at = (stepId: string, done: string[]) => ({
		procedureId: 'test-proc',
		stepId,
		done,
		startedAt: '2026-09-11T00:00:00.000Z',
	});

	it('accepts the entry step with nothing done', () => {
		expect(isReachable(p, at('s1', []))).toBe(true);
	});

	it('accepts a contiguous walk', () => {
		expect(isReachable(p, at('s3', ['s1', 's2']))).toBe(true);
	});

	it('rejects a jump to the end, which is the tampering case that matters', () => {
		expect(isReachable(p, at('s3', []))).toBe(false);
	});

	it('rejects a history that skips a step', () => {
		expect(isReachable(p, at('s3', ['s1']))).toBe(false);
	});

	it('rejects a history that does not start at the entry', () => {
		expect(isReachable(p, at('s3', ['s2']))).toBe(false);
	});

	it('rejects a step that is already done', () => {
		expect(isReachable(p, at('s2', ['s1', 's2']))).toBe(false);
	});

	it('rejects a step id that does not exist', () => {
		expect(isReachable(p, at('ghost', ['s1']))).toBe(false);
	});
});

describe('stepById', () => {
	it('returns undefined for an unknown id rather than throwing', () => {
		expect(stepById(line(), 'ghost')).toBeUndefined();
	});
});
