import { Understanding } from '../understanding';
import type { ProviderResult, TurnContext, VoiceProvider } from './types';

/**
 * A provider that returns canned answers.
 *
 * This is the most important provider in the project, not a testing afterthought. It
 * makes the entire suite — policy, renderer, eval harness, cost harness — runnable with
 * no API key, no network and no spend. Every test in this repo that is not explicitly
 * about a vendor runs against this.
 *
 * It also proves the seam is real: if something upstream cannot be driven by the fake,
 * that code has a vendor assumption baked into it.
 */
export class FakeProvider implements VoiceProvider {
	readonly id = 'fake';
	readonly caps = {
		audio: true,
		structured: true,
		languages: ['en', 'zh', 'ms', 'ta', 'sg', 'nan', 'yue'] as const,
	};
	/** Free, so a replayed session prices at zero and only real providers show up. */
	readonly price = { audioPerMinUsd: 0, inPerMTokUsd: 0, outPerMTokUsd: 0 };

	private queue: Understanding[];
	private calls = 0;

	constructor(responses: Understanding[]) {
		if (responses.length === 0) {
			throw new Error('FakeProvider needs at least one response');
		}
		this.queue = responses.map((r) => Understanding.parse(r));
	}

	/** How many times it was asked. Lets tests assert we did not call the model twice. */
	get callCount(): number {
		return this.calls;
	}

	async understand(audio: ArrayBuffer, _ctx: TurnContext): Promise<ProviderResult> {
		const index = Math.min(this.calls, this.queue.length - 1);
		this.calls += 1;
		const understanding = this.queue[index]!;

		return {
			understanding,
			usage: {
				// Opus at roughly 16 kbit/s, which is close enough to make the cost
				// harness exercise real arithmetic instead of multiplying by zero.
				audioSeconds: audio.byteLength / 2000,
				inputTokens: 0,
				outputTokens: 0,
			},
			latencyMs: 0,
		};
	}
}

/** Convenience for tests: one understanding, with sane defaults for the rest. */
export function anUnderstanding(
	over: Partial<Understanding> & Pick<Understanding, 'intent' | 'confidence'>,
): Understanding {
	return Understanding.parse({
		language: 'en',
		slots: {},
		reply: 'Okay.',
		needsHuman: false,
		...over,
	});
}
