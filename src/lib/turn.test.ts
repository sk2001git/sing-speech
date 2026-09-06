import { describe, expect, it } from 'vitest';
import { anUnderstanding, FakeProvider } from './providers/fake';
import { FakeTranscriber } from './providers/transcript';
import { runTurn } from './turn';

/** A short silence. Content does not matter — the fake ignores it. */
const AUDIO = btoa('\0'.repeat(2000));

function speech(over: Partial<Parameters<typeof runTurn>[0]> = {}) {
	return {
		kind: 'speech' as const,
		audioBase64: AUDIO,
		history: [],
		unclearStreak: 0,
		...over,
	} as Parameters<typeof runTurn>[0];
}

describe('runTurn', () => {
	it('runs a whole turn with no network, which is what makes the suite free to run', async () => {
		const provider = new FakeProvider([
			anUnderstanding({
				intent: 'chas_subsidy',
				confidence: 0.95,
				language: 'sg',
				reply: 'You can get help paying at the clinic.',
			}),
		]);

		const res = await runTurn(speech(), provider);

		expect(res.screen.kind).toBe('answer');
		expect(res.language).toBe('sg');
		expect(provider.callCount).toBe(1);
	});

	it('calls the model exactly once per turn, because audio is the expensive part', async () => {
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'wayfinding', confidence: 0.9 }),
		]);
		await runTurn(speech(), provider);
		expect(provider.callCount).toBe(1);
	});

	it('returns a confirm screen carrying the intent, so answering by button needs no re-inference', async () => {
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'silver_support', confidence: 0.7 }),
		]);
		const res = await runTurn(speech(), provider);
		expect(res.screen).toMatchObject({ kind: 'confirm', intent: 'silver_support' });
	});

	it('accumulates history as structured results, never as audio', async () => {
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'wayfinding', confidence: 0.9 }),
		]);
		const res = await runTurn(speech(), provider);
		expect(res.history).toHaveLength(1);
		expect(JSON.stringify(res.history)).not.toContain('audioBase64');
	});

	it('carries the unclear streak forward so the third failure hands off', async () => {
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.2 }),
		]);
		const res = await runTurn(speech({ unclearStreak: 2 }), provider);
		expect(res.screen.kind).toBe('handoff');
	});

	it('acts on an accepted read-back without calling the model again', async () => {
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.99 }),
		]);
		const res = await runTurn(
			{
				kind: 'confirmation',
				accepted: true,
				intent: 'chas_subsidy',
				history: [
					anUnderstanding({
						intent: 'chas_subsidy',
						confidence: 0.7,
						reply: 'You can get help paying.',
					}),
				],
			},
			provider,
		);
		expect(res.screen.kind).toBe('answer');
		expect(provider.callCount).toBe(0);
	});

	it('treats a rejected read-back as information, not as another failed hearing', async () => {
		// The user communicated clearly; we simply guessed wrong. Counting that against
		// their handoff streak would punish them for our mistake.
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.7 }),
		]);
		const res = await runTurn(
			{
				kind: 'confirmation',
				accepted: false,
				intent: 'chas_subsidy',
				history: [anUnderstanding({ intent: 'chas_subsidy', confidence: 0.7 })],
			},
			provider,
		);
		expect(res.screen.kind).toBe('repeat');
		expect(res.unclearStreak).toBe(0);
	});

	it('lets the transcript veto a confident but wrong audio guess', async () => {
		// The reason both channels are paid for. Alone, the audio model would have acted
		// on 0.9 confidence and sent someone to the wrong service.
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.9 }),
		]);
		const res = await runTurn(
			speech(),
			provider,
			new FakeTranscriber('i am asking about the silver support payout'),
		);
		expect(res.screen.kind).not.toBe('act');
		expect(res.audit?.agreement).toBe('disagreed');
	});

	it('records both channels and both confidences, which is a better audit trail than a transcript alone', async () => {
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.7 }),
		]);
		const res = await runTurn(speech(), provider, new FakeTranscriber('chas card please'));

		expect(res.audit).toMatchObject({
			transcript: 'chas card please',
			audioIntent: 'chas_subsidy',
			transcriptIntent: 'chas_subsidy',
			agreement: 'agreed',
			rawConfidence: 0.7,
		});
		expect(res.audit!.adjustedConfidence).toBeGreaterThan(0.7);
	});

	it('behaves exactly as before when no transcriber is configured', async () => {
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.9 }),
		]);
		const res = await runTurn(speech(), provider);
		expect(res.screen.kind).toBe('answer');
		expect(res.audit?.agreement).toBe('no-signal');
	});

	it('shows no facts while the catalogue row is unverified, rather than inventing policy', async () => {
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.95 }),
		]);
		const res = await runTurn(speech(), provider);
		expect(res.screen).toMatchObject({ kind: 'answer', facts: [] });
	});
});
