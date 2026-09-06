import { z } from 'zod';

/**
 * The closed intent set.
 *
 * Small and closed is the whole trick. Selecting one of six distinctive options
 * tolerates far more acoustic noise than reconstructing a sentence, which is what makes
 * dialect speech workable on models that report 46% WER on it. Every intent added here
 * makes the classification harder, so adding one is a product decision, not a chore.
 *
 * `human_handoff` is an intent rather than a failure path because users ask for it
 * directly ("I want to talk to someone"), not only because we ran out of confidence.
 */
export const INTENTS = [
	'chas_subsidy',
	'silver_support',
	'pioneer_merdeka',
	'appointment_prep',
	'wayfinding',
	'human_handoff',
] as const;

export const Intent = z.enum(INTENTS);
export type Intent = z.infer<typeof Intent>;

/**
 * Languages we route and measure separately. This is not the set the model must
 * support — it is the set the eval reports per-language accuracy for, because a single
 * average would hide that Hokkien is failing while English carries the mean.
 */
export const LANGUAGES = [
	'en', // includes Singapore English
	'zh', // Mandarin
	'ms', // Malay
	'ta', // Tamil
	'sg', // Singlish / code-switched
	'nan', // Hokkien
	'yue', // Cantonese
	'unknown',
] as const;

export const Language = z.enum(LANGUAGES);
export type Language = z.infer<typeof Language>;

/**
 * What every provider must return, whatever model is behind it.
 *
 * Note what is absent: there is no transcript field. The transcript is the lossy
 * intermediate this design removes, and giving it a slot here would invite the rest of
 * the system to start trusting it. If a provider happens to produce one it belongs in
 * `evidence` as a debugging aid, never as content.
 */
export const Understanding = z.object({
	intent: Intent,

	/**
	 * How sure the model is that `intent` is what the user actually wants. Drives the
	 * clarification policy in `policy.ts` — this is the number the whole safety story
	 * rests on, so a provider that cannot produce a calibrated one must say so rather
	 * than return a flat 1.0.
	 */
	confidence: z.number().min(0).max(1),

	language: Language,

	/**
	 * Anything the model picked out that narrows the request — a named clinic, "my
	 * wife", a date. Never used to fill a form field directly; only to select which
	 * facts to pull from the profile vault and read back for confirmation.
	 */
	slots: z.record(z.string(), z.string()).default({}),

	/**
	 * What to say to the user, in their language, already phrased for speech. One or two
	 * short sentences. Long replies are a design failure, not a formatting problem.
	 */
	reply: z.string().min(1).max(400),

	/** The model's own judgement that this needs a person, independent of confidence. */
	needsHuman: z.boolean().default(false),

	/** Free-form provider notes for debugging. Never shown to the user, never trusted. */
	evidence: z.string().optional(),
});

export type Understanding = z.infer<typeof Understanding>;

/** Human-readable labels, used in clarifying questions and read aloud. */
export const INTENT_LABELS: Record<Intent, string> = {
	chas_subsidy: 'help paying for a doctor or medicine',
	silver_support: 'the Silver Support payout',
	pioneer_merdeka: 'your Pioneer or Merdeka Generation benefits',
	appointment_prep: 'what to bring to an appointment',
	wayfinding: 'how to get somewhere',
	human_handoff: 'speaking to a person',
};
