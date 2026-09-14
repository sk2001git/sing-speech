import { describe, expect, it } from 'vitest';
import example from '../../../docs/knowledge-base/examples/sg.moh.gpfirst-emergency-referral.json';
import { parseEntry, type Entry } from './entry';
import { checkQuotesFound, checkRefsResolve, checkTranslation, needsTranslation } from './grounding';

const AT = '2026-09-15T08:00:00.000Z';

function original(): Entry {
	const result = parseEntry(structuredClone(example));
	if (!result.ok) throw new Error(result.errors.join('\n'));
	return result.entry;
}

function chinese(from: Entry = original()): Entry {
	const t = structuredClone(from);
	t.language = 'zh-Hans';
	t.translation_of = { id: from.id, version: from.lifecycle.version };
	t.title = { short: '急诊 GPFirst', full: 'GPFirst：急诊费用较低' };
	t.summary = { ...t.summary, text: '当天带医生开的 GPFirst 表格原件去合作医院急诊部。' };
	t.steps = t.steps?.map((s) => ({ ...s, name: `第 ${s.position} 步`, text: '按表格说明做。', confirm_label: '好了' }));
	t.provenance = { ...t.provenance, translated: { method: 'model', model: 'thinkingmachines/inkling:free', prompt_version: 'translate-1', at: AT } };
	return t;
}

describe('checkRefsResolve', () => {
	it('passes the reviewed example', () => {
		expect(checkRefsResolve(original(), AT)).toEqual({ type: 'refs-resolve', passed: true, at: AT });
	});

	it('fails a summary citing a quote that does not exist, and names it', () => {
		const e = original();
		e.summary.quote_refs = ['q9'];
		const check = checkRefsResolve(e, AT);
		expect(check.passed).toBe(false);
		expect(check.note).toContain('q9');
	});

	it('fails a step action citing a missing quote', () => {
		const e = original();
		e.steps![2]!.action = { type: 'go-to-place', label: 'See hospitals', quote_refs: ['q99'] };
		expect(checkRefsResolve(e, AT).note).toContain('q99');
	});

	it('fails a quote citing a source that does not exist', () => {
		const e = original();
		e.quotes[0]!.source = 'src2';
		const check = checkRefsResolve(e, AT);
		expect(check.passed).toBe(false);
		expect(check.note).toContain('src2');
	});
});

describe('checkQuotesFound', () => {
	const page = (e: Entry) =>
		'Is the GPFirst programme applicable at all EDs?\n\n' + e.quotes.map((q) => q.text.replace(/ /g, '  \n ')).join('\n\nMore text.\n');

	it('passes when every quote is on the page, whatever the line breaks and spacing', () => {
		const e = original();
		expect(checkQuotesFound(e, { src1: page(e) }, AT)).toEqual({ type: 'quotes-found', passed: true, at: AT });
	});

	it('fails when one word of a quote differs from the page, and names the quote', () => {
		const e = original();
		const text = page(e).replace('same  \n day', 'next  \n day');
		const check = checkQuotesFound(e, { src1: text }, AT);
		expect(check.passed).toBe(false);
		expect(check.note).toContain('q4');
	});

	it('fails when the source page text is missing', () => {
		const check = checkQuotesFound(original(), {}, AT);
		expect(check.passed).toBe(false);
		expect(check.note).toContain('src1');
	});
});

describe('checkTranslation', () => {
	it('passes a translation that keeps quotes, sources and structure', () => {
		const e = original();
		expect(checkTranslation(e, chinese(e), AT)).toEqual({ type: 'translation-matches-original', passed: true, at: AT });
	});

	const broken: Array<[string, (t: Entry) => void]> = [
		['a quote reworded', (t) => (t.quotes[1]!.text = '原件'),],
		['a source changed', (t) => (t.sources[0]!.url = 'https://ask.gov.sg/moh')],
		['a step re-cited', (t) => (t.steps![0]!.quote_refs = ['q2'])],
		['a step dropped', (t) => t.steps!.pop()],
		['a step renumbered', (t) => (t.steps![1]!.position = 9)],
		['a detail dropped', (t) => t.details!.pop()],
		['the summary re-cited', (t) => (t.summary.quote_refs = ['q1'])],
		['the kind changed', (t) => (t.kind = 'answer')],
		['a different id', (t) => (t.id = 'sg.moh.something-else')],
		['the same language as the original', (t) => (t.language = 'en')],
	];

	it.each(broken)('fails %s', (_name, change) => {
		const e = original();
		const t = chinese(e);
		change(t);
		expect(checkTranslation(e, t, AT).passed).toBe(false);
	});

	it('fails a translation made from an older version of the original', () => {
		const e = original();
		const t = chinese(e);
		e.lifecycle.version = 2;
		const check = checkTranslation(e, t, AT);
		expect(check.passed).toBe(false);
		expect(check.note).toContain('version');
	});
});

describe('needsTranslation', () => {
	it('is true when the original lists no translation into that language', () => {
		expect(needsTranslation(original(), 'zh-Hans')).toBe(true);
	});

	it('is false when the listed translation was made from the current version', () => {
		const e = original();
		e.translations = { 'zh-Hans': { from_version: 1, at: AT } };
		expect(needsTranslation(e, 'zh-Hans')).toBe(false);
	});

	it('is true when the original has changed since it was translated', () => {
		const e = original();
		e.lifecycle.version = 2;
		e.translations = { 'zh-Hans': { from_version: 1, at: AT } };
		expect(needsTranslation(e, 'zh-Hans')).toBe(true);
	});

	it('is false when the reader wants the language the original is already in', () => {
		expect(needsTranslation(original(), 'en')).toBe(false);
	});
});
