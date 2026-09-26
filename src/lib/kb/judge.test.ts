import { describe, expect, it } from 'vitest';
import example from '../../../docs/knowledge-base/examples/sg.moh.gpfirst-emergency-referral.json';
import { parseEntry, type Entry } from './entry';
import { judgeBody, openaiJudge } from './judge';

const card = (id: string, title: string, summary: string): Entry => {
	const r = parseEntry(structuredClone(example));
	if (!r.ok) throw new Error(r.errors.join('\n'));
	return { ...r.entry, id, title: { short: title.slice(0, 16), full: title }, summary: { ...r.entry.summary, text: summary } };
};
const CARDS = [
	card('sg.cpf.cpfis-55', 'CPFIS withdrawal at 55', 'You can withdraw CPFIS investments if you have set aside the FRS.'),
	card('sg.cpf.topup', 'How to apply for a CPF top-up', 'Choose the type of top-up you want, then follow its guide.'),
];

describe('judgeBody', () => {
	it('asks gpt-6-luna, strictly, whether any card answers the question itself', () => {
		const body = judgeBody('how can I invest my CPF', CARDS);
		expect(body.model).toBe('gpt-6-luna');
		expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
		const input = JSON.stringify(body.input);
		expect(input).toContain('how can I invest my CPF');
		expect(input).toContain('CPFIS withdrawal at 55');
		expect(input).toContain('You can withdraw CPFIS investments');
		expect(input).toMatch(/same topic.*does not count/i);
	});
});

describe('openaiJudge', () => {
	const reply = (text: string, status = 200) =>
		(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { status })) as unknown as typeof fetch;

	it('reads the verdict', async () => {
		expect(await openaiJudge('k', undefined, reply('{"answered":false,"card_id":""}'))('q', CARDS)).toBe(false);
		expect(await openaiJudge('k', undefined, reply('{"answered":true,"card_id":"sg.cpf.topup"}'))('q', CARDS)).toBe(true);
	});

	it('cannot say, rather than failing the search, when the call or the reply goes wrong', async () => {
		expect(await openaiJudge('k', undefined, reply('', 500))('q', CARDS)).toBeNull();
		expect(await openaiJudge('k', undefined, reply('not json'))('q', CARDS)).toBeNull();
		const broken = (async () => {
			throw new Error('network');
		}) as unknown as typeof fetch;
		expect(await openaiJudge('k', undefined, broken)('q', CARDS)).toBeNull();
	});
});
