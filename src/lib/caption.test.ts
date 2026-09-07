import { describe, expect, it } from 'vitest';
import { mergeResults } from './caption';

/** Shapes one recognition result the way the browser hands it over. */
function r(transcript: string, isFinal: boolean) {
	return { length: 1, isFinal, 0: { transcript } };
}

function results(...items: ReturnType<typeof r>[]) {
	return Object.assign({ length: items.length }, items);
}

describe('mergeResults', () => {
	it('shows provisional words immediately, because a silent screen reads as broken', () => {
		const m = mergeResults('', results(r('i need help', false)), 0);
		expect(m.text).toBe('i need help');
		// Not settled: the recogniser may still revise it.
		expect(m.settled).toBe('');
	});

	it('settles a final result so later interim text cannot erase it', () => {
		const m = mergeResults('', results(r('i need help ', true)), 0);
		expect(m.settled).toBe('i need help ');
		expect(m.text).toBe('i need help');
	});

	it('replaces interim text rather than appending it, so the caption does not stutter', () => {
		// The bug this function exists to prevent: appending every interim result gives
		// "i need i need help i need help paying", which reads as the machine being
		// confused by the speaker.
		const first = mergeResults('', results(r('i need', false)), 0);
		const second = mergeResults(first.settled, results(r('i need help paying', false)), 0);
		expect(second.text).toBe('i need help paying');
	});

	it('keeps settled text and appends the next phrase after a pause', () => {
		const m = mergeResults('i need help ', results(r('paying for the doctor', false)), 0);
		expect(m.text).toBe('i need help paying for the doctor');
	});

	it('starts from resultIndex, ignoring results the browser already reported settled', () => {
		const m = mergeResults(
			'first. ',
			results(r('first. ', true), r('second', false)),
			1,
		);
		expect(m.text).toBe('first. second');
	});

	it('survives a malformed result instead of dropping the whole caption', () => {
		const broken = Object.assign({ length: 2 }, [undefined, r('still here', false)]);
		const m = mergeResults('', broken as never, 0);
		expect(m.text).toBe('still here');
	});
});
