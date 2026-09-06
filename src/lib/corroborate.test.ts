import { describe, expect, it } from 'vitest';
import { corroborate } from './corroborate';
import { THRESHOLDS } from './policy';
import { anUnderstanding } from './providers/fake';

describe('corroborate', () => {
	it('raises confidence when the transcript backs the audio model', () => {
		const c = corroborate(
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.7 }),
			'i want the chas card for my medicine',
		);
		expect(c.agreement).toBe('agreed');
		expect(c.understanding.confidence).toBeGreaterThan(0.7);
	});

	it('never lets corroboration reach certainty, since both channels share one input', () => {
		const c = corroborate(
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.99 }),
			'chas card',
		);
		expect(c.understanding.confidence).toBeLessThan(1);
	});

	it('drops a confident guess below the act threshold when the transcript disagrees', () => {
		// The case this whole mechanism exists for: the audio model is sure and wrong, and
		// the second channel is the only thing that catches it before someone is sent to
		// the wrong service.
		const c = corroborate(
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.9 }),
			'i want to ask about the silver support payout',
		);
		expect(c.agreement).toBe('disagreed');
		expect(c.understanding.confidence).toBeLessThan(THRESHOLDS.act);
	});

	it('penalises disagreement harder than it rewards agreement', () => {
		// Asymmetric on purpose. A wrongly raised confidence acts silently on a mistake; a
		// wrongly lowered one costs a question.
		const base = anUnderstanding({ intent: 'chas_subsidy', confidence: 0.5 });
		const up = corroborate(base, 'chas card').understanding.confidence - 0.5;
		const down = 0.5 - corroborate(base, 'silver support').understanding.confidence;
		expect(down).toBeGreaterThan(up);
	});

	it('treats a garbled transcript as no signal, not as disagreement', () => {
		// The expected case for the dialect speakers this exists for. Counting silence
		// against them would push exactly those users toward handoff.
		const c = corroborate(
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.9 }),
			'wa lai kong ho liao mai',
		);
		expect(c.agreement).toBe('no-signal');
		expect(c.understanding.confidence).toBe(0.9);
	});

	it('is a no-op when no transcriber ran', () => {
		const c = corroborate(anUnderstanding({ intent: 'wayfinding', confidence: 0.8 }), '');
		expect(c.agreement).toBe('no-signal');
		expect(c.understanding.confidence).toBe(0.8);
	});

	it('keeps the pre-adjustment confidence for the audit record', () => {
		const c = corroborate(
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.9 }),
			'silver support',
		);
		expect(c.rawConfidence).toBe(0.9);
		expect(c.understanding.confidence).not.toBe(0.9);
	});
});
