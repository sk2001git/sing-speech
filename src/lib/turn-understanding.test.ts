import { describe, expect, it } from 'vitest';
import { runTurn, TurnRequest } from './turn';

/** What `report_understanding` hands back over the realtime data channel. Slots on the wire are a list. */
const WIRE = {
	intent: 'chas_subsidy',
	confidence: 0.93,
	language: 'en',
	slots: [],
	reply: 'You can get help paying at the clinic.',
	needsHuman: false,
};

function relayed(over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
	return TurnRequest.parse({
		kind: 'understanding',
		understanding: { ...WIRE, ...over },
		history: [],
		unclearStreak: 0,
		...extra,
	});
}

describe('a relayed understanding from the realtime channel', () => {
	it('runs the same policy with no audio provider at all', async () => {
		const res = await runTurn(relayed());
		expect(res.screen.kind).toBe('answer');
		expect(res.history).toHaveLength(1);
	});

	it('asks one yes/no question in the unsure band, exactly as the Gemini path does', async () => {
		const res = await runTurn(relayed({ confidence: 0.72 }));
		expect(res.screen).toMatchObject({ kind: 'confirm', intent: 'chas_subsidy' });
	});

	it('lets the realtime transcript corroborate, so a disagreement still costs confidence', async () => {
		const res = await runTurn(relayed({ confidence: 0.9 }, { transcript: 'which bus do i take' }));
		expect(res.audit?.agreement).toBe('disagreed');
		expect(res.screen.kind).toBe('repeat');
	});

	it('rejects a confidence outside 0..1 before it can reach the policy', () => {
		const forged = { kind: 'understanding', understanding: { ...WIRE, confidence: 1.4 } };
		expect(TurnRequest.safeParse(forged).success).toBe(false);
	});

	it('folds the wire slot list into a record, the same as the Gemini provider', () => {
		const req = relayed({ slots: [{ key: 'clinic', value: 'Bedok Polyclinic' }] });
		expect(req.kind === 'understanding' && req.understanding.slots).toEqual({
			clinic: 'Bedok Polyclinic',
		});
	});

	it('still refuses a speech turn when no audio provider is configured', async () => {
		const speech = TurnRequest.parse({ kind: 'speech', audioBase64: 'AAAA' });
		await expect(runTurn(speech)).rejects.toThrow();
	});
});
