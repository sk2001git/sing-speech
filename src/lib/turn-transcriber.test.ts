import { describe, expect, it } from 'vitest';
import { anUnderstanding, FakeProvider } from './providers/fake';
import type { TranscriptProvider } from './providers/transcript';
import { runTurn, TurnRequest } from './turn';

/**
 * A corroboration channel that throws, the way the Workers AI binding does when its
 * remote session token expires ("error code: 1031", seen live on 2026-09-13).
 */
const broken: TranscriptProvider = {
	id: 'workers-ai:whisper',
	price: { audioPerMinUsd: 0, inPerMTokUsd: 0, outPerMTokUsd: 0 },
	transcribe: async () => {
		throw new Error('error code: 1031');
	},
};

const speech = () => TurnRequest.parse({ kind: 'speech', audioBase64: btoa('\0'.repeat(2000)) });

describe('a failing transcriber', () => {
	it('does not fail the turn, because corroboration is an upgrade and not a dependency', async () => {
		const provider = new FakeProvider([anUnderstanding({ intent: 'chas_subsidy', confidence: 0.95 })]);
		const res = await runTurn(speech(), provider, broken);
		expect(res.screen.kind).toBe('answer');
	});

	it('is treated as no signal, so it neither raises nor lowers confidence', async () => {
		const provider = new FakeProvider([anUnderstanding({ intent: 'chas_subsidy', confidence: 0.8 })]);
		const res = await runTurn(speech(), provider, broken);
		expect(res.audit?.agreement).toBe('no-signal');
		expect(res.audit?.adjustedConfidence).toBe(0.8);
	});

	it('is named as failed in the audit record rather than silently absent', async () => {
		const provider = new FakeProvider([anUnderstanding({ intent: 'wayfinding', confidence: 0.9 })]);
		const res = await runTurn(speech(), provider, broken);
		expect(res.audit?.transcriber).toBe('workers-ai:whisper (failed)');
	});

	it('still fails the turn when the audio model itself fails, because that one decides', async () => {
		const failing = {
			...new FakeProvider([anUnderstanding({ intent: 'wayfinding', confidence: 0.9 })]),
			id: 'broken-audio',
			caps: { audio: true, structured: true, languages: ['en'] as const },
			price: { audioPerMinUsd: 0, inPerMTokUsd: 0, outPerMTokUsd: 0 },
			understand: async () => {
				throw new Error('gemini 500');
			},
		};
		await expect(runTurn(speech(), failing, broken)).rejects.toThrow('gemini 500');
	});
});
