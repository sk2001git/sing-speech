import { describe, expect, it } from 'vitest';
import example from '../../../docs/knowledge-base/examples/sg.moh.gpfirst-emergency-referral.json';
import { parseEntry, type Entry } from './entry';
import { checkTranslation } from './grounding';
import { applyTranslation, displayText, translateEntry, type ChatJson, type Translator } from './translate';

const AT = '2026-09-15T08:00:00.000Z';

function original(): Entry {
	const r = parseEntry(structuredClone(example));
	if (!r.ok) throw new Error(r.errors.join('\n'));
	return r.entry;
}

/** A faithful Chinese reply for the example: same counts, every label present. */
function chineseText(e: Entry) {
	const t = displayText(e);
	return {
		title: { short: '急诊 GPFirst', full: 'GPFirst：去急诊部可以少付钱' },
		summary: '当天带医生给的 GPFirst 正本表格，去合作医院的急诊部。',
		details: t.details.map((_, i) => ({ heading: `说明 ${i + 1}`, body: '详细内容。' })),
		steps: t.steps.map((s, i) => ({
			name: `第 ${i + 1} 步`,
			text: '按说明做。',
			confirm_label: '好了',
			...(s.action_label ? { action_label: '看医院' } : {}),
		})),
		action_label: '开始步骤',
		example_phrasings: t.example_phrasings.map((_, i) => `例子 ${i + 1}`),
	};
}

describe('displayText', () => {
	it('sends only what a person reads — never quotes, sources or ids', () => {
		const text = JSON.stringify(displayText(original()));
		expect(text).toContain('GPFirst at A&E');
		expect(text).not.toContain('ask.gov.sg');
		expect(text).not.toContain('q1');
		expect(text).not.toContain('This programme is available at the participating GP clinics');
	});
});

describe('applyTranslation', () => {
	it('rebuilds a valid translation around the original evidence', () => {
		const e = original();
		const result = applyTranslation(e, chineseText(e), 'zh-Hans', 'deepseek/deepseek-v4.1-flash', AT);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.entry.language).toBe('zh-Hans');
		expect(result.entry.quotes).toEqual(e.quotes);
		expect(result.entry.steps![2]!.quote_refs).toEqual(e.steps![2]!.quote_refs);
		expect(result.entry.provenance.translated?.model).toBe('deepseek/deepseek-v4.1-flash');
		expect(checkTranslation(e, result.entry, AT).passed).toBe(true);
	});

	it('rejects a reply that dropped a detail, which strict JSON schema did not prevent', () => {
		const e = original();
		const text = chineseText(e);
		text.details.pop();
		const result = applyTranslation(e, text, 'zh-Hans', 'm', AT);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('details');
	});

	it('rejects a reply that lost a step action label', () => {
		const e = original();
		const text = chineseText(e);
		delete (text.steps[2] as { action_label?: string }).action_label;
		expect(applyTranslation(e, text, 'zh-Hans', 'm', AT).ok).toBe(false);
	});

	it('rejects a grid title too long for one line', () => {
		const e = original();
		const text = chineseText(e);
		text.title.short = '这是一个非常非常非常非常长的标题名称';
		expect(applyTranslation(e, text, 'zh-Hans', 'm', AT).ok).toBe(false);
	});
});

describe('translateEntry', () => {
	const translators: Translator[] = [
		{ model: 'deepseek/deepseek-v4.1-flash', structured: true },
		{ model: 'nex-agi/nex-n2.5-pro:free', structured: false },
	];

	it('uses the first translator whose reply validates, and records which one served it', async () => {
		const e = original();
		const calls: string[] = [];
		const chat: ChatJson = async ({ model }) => {
			calls.push(model);
			return { content: JSON.stringify(chineseText(e)), model };
		};
		const result = await translateEntry(e, 'zh-Hans', translators, chat, AT);
		expect(calls).toEqual(['deepseek/deepseek-v4.1-flash']);
		expect(result?.provenance.translated?.model).toBe('deepseek/deepseek-v4.1-flash');
	});

	it('moves to the next translator after an error or an invalid reply', async () => {
		const e = original();
		const calls: string[] = [];
		const chat: ChatJson = async ({ model }) => {
			calls.push(model);
			if (model.startsWith('deepseek')) return { content: 'We need to translate…', model };
			return { content: '```json\n' + JSON.stringify(chineseText(e)) + '\n```', model };
		};
		const result = await translateEntry(e, 'zh-Hans', translators, chat, AT);
		expect(calls).toEqual(['deepseek/deepseek-v4.1-flash', 'nex-agi/nex-n2.5-pro:free']);
		expect(result?.provenance.translated?.model).toBe('nex-agi/nex-n2.5-pro:free');
	});

	it('returns null when every translator fails, so the English card is shown', async () => {
		const chat: ChatJson = async () => {
			throw new Error('429');
		};
		expect(await translateEntry(original(), 'zh-Hans', translators, chat, AT)).toBeNull();
	});

	it('asks the structured translator for a JSON schema and the free one for plain JSON', async () => {
		const e = original();
		const seen: Array<[string, boolean]> = [];
		const chat: ChatJson = async ({ model, schema }) => {
			seen.push([model, schema !== undefined]);
			throw new Error('fail');
		};
		await translateEntry(e, 'zh-Hans', translators, chat, AT);
		expect(seen).toEqual([
			['deepseek/deepseek-v4.1-flash', true],
			['nex-agi/nex-n2.5-pro:free', false],
		]);
	});
});
