import { intentFromTranscript } from './catalogue';
import type { Understanding } from './understanding';

/**
 * How the two channels compared.
 *
 * Kept as a value rather than folded straight into the number, because this is what
 * gets written to the audit record. Six months later, "confidence was 0.55" explains
 * nothing; "the audio model said chas_subsidy, the transcript said silver_support, so we
 * asked" explains everything.
 */
export type Agreement = 'agreed' | 'disagreed' | 'no-signal';

export interface Corroboration {
	understanding: Understanding;
	agreement: Agreement;
	/** Confidence before adjustment, so the audit record shows both. */
	rawConfidence: number;
	transcript: string;
	transcriptIntent: string | null;
}

/**
 * Ceiling on a corroborated boost.
 *
 * Two channels agreeing is real evidence, but it is not proof — they share an input, so
 * a genuinely ambiguous utterance can fool both. Confidence never reaches certainty
 * through corroboration alone.
 */
const AGREEMENT_CEILING = 0.97;
const AGREEMENT_BOOST = 0.1;
const DISAGREEMENT_PENALTY = 0.35;

/**
 * Cross-check the audio model against the transcript.
 *
 * The adjustment is deliberately asymmetric: disagreement costs more than agreement
 * pays. A wrongly raised confidence acts silently on a mistake, which is the failure
 * that harms someone. A wrongly lowered one costs a clarifying question, which is
 * merely mildly annoying. When the two error modes are that unequal, the arithmetic
 * should be too.
 *
 * A transcript with no cue hit is treated as no signal, not as disagreement. A garbled
 * transcript is the expected case for the dialect speakers this exists for, and letting
 * silence count against them would push exactly those users toward handoff.
 */
export function corroborate(
	understanding: Understanding,
	transcript: string,
): Corroboration {
	const transcriptIntent = intentFromTranscript(transcript);
	const raw = understanding.confidence;

	let agreement: Agreement = 'no-signal';
	let confidence = raw;

	if (transcriptIntent === understanding.intent) {
		agreement = 'agreed';
		confidence = Math.min(raw + AGREEMENT_BOOST, AGREEMENT_CEILING);
	} else if (transcriptIntent !== null) {
		agreement = 'disagreed';
		confidence = Math.max(raw - DISAGREEMENT_PENALTY, 0);
	}

	return {
		understanding: { ...understanding, confidence },
		agreement,
		rawConfidence: raw,
		transcript,
		transcriptIntent,
	};
}
