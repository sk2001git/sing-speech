import type { Intent } from './understanding';

/**
 * The pre-cached service catalogue, keyed by ministry.
 *
 * Two jobs. It narrows classification — a coarse ministry decision followed by a small
 * within-ministry choice keeps every individual decision a short closed set, which is
 * what makes noisy dialect audio classifiable, while still covering more than six
 * services. And it grounds the answer: what the user is told comes from this table, not
 * from what a model remembers about Singaporean policy.
 *
 * That second job is the important one. A model asked about CHAS eligibility will
 * produce a fluent, plausible, occasionally wrong answer, and the user has no way to
 * tell which they got. Everything factual said to a user must come from a row here with
 * `verified: true` and a `source` someone actually checked.
 */

export const MINISTRIES = ['moh', 'msf', 'cpf', 'hdb', 'mom', 'lta'] as const;
export type Ministry = (typeof MINISTRIES)[number];

export const MINISTRY_LABELS: Record<Ministry, string> = {
	moh: 'health and medical costs',
	msf: 'family support and payouts',
	cpf: 'CPF and retirement',
	hdb: 'housing',
	mom: 'work and employment',
	lta: 'transport and concession',
};

export interface Service {
	id: string;
	ministry: Ministry;
	intent: Intent;
	/** What the service is called in plain words, not its official title. */
	name: string;
	/**
	 * Phrases that indicate this service, per language. Used to derive a second opinion
	 * from the transcript channel by lexical match — deliberately not a model call, since
	 * a second model per turn would double the bill for a cross-check.
	 */
	cues: string[];
	/**
	 * Facts told to the user. EMPTY until someone verifies them against the source.
	 * `verified` gates whether any of this may be spoken.
	 */
	eligibility: string | null;
	documents: string[];
	/**
	 * False until a person has checked this row against `source`. `factsFor` refuses to
	 * return anything from an unverified row, so shipping with these unfilled degrades
	 * to "I will get someone to help you" rather than to confident invention.
	 */
	verified: boolean;
	source: string;
}

/**
 * Seed rows.
 *
 * Every row is `verified: false` on purpose. The cue phrases are safe to guess at —
 * a wrong cue costs a clarifying question. The eligibility and document fields are not,
 * because a wrong one sends an eighty-year-old to a counter with the wrong papers, so
 * they stay null until checked against the source and are unreachable until then.
 */
export const CATALOGUE: readonly Service[] = [
	{
		id: 'chas',
		ministry: 'moh',
		intent: 'chas_subsidy',
		name: 'the CHAS card',
		cues: ['chas', 'blue card', 'orange card', 'cheaper doctor', 'subsidy', 'clinic', 'medicine', 'see doctor', '看医生', '补贴', 'ubat', 'doktor'],
		eligibility: null,
		documents: [],
		verified: false,
		source: 'https://www.chas.sg',
	},
	{
		id: 'silver-support',
		ministry: 'cpf',
		intent: 'silver_support',
		name: 'the Silver Support Scheme',
		cues: ['silver support', 'quarterly payout', 'old age money', 'government give money', '银发', '补助'],
		eligibility: null,
		documents: [],
		verified: false,
		source: 'https://www.cpf.gov.sg/member/retirement-income/government-support/silver-support-scheme',
	},
	{
		id: 'pioneer-merdeka',
		ministry: 'moh',
		intent: 'pioneer_merdeka',
		name: 'Pioneer and Merdeka Generation benefits',
		cues: ['pioneer', 'merdeka', 'generation card', 'my card benefits', '建国', '立国'],
		eligibility: null,
		documents: [],
		verified: false,
		source: 'https://www.pioneers.gov.sg',
	},
	{
		id: 'appointment-prep',
		ministry: 'moh',
		intent: 'appointment_prep',
		name: 'preparing for an appointment',
		cues: ['what to bring', 'appointment', 'polyclinic', 'hospital tomorrow', 'need bring what', '要带什么', '预约'],
		eligibility: null,
		documents: [],
		verified: false,
		source: '',
	},
	{
		id: 'concession',
		ministry: 'lta',
		intent: 'wayfinding',
		name: 'getting there and concession fares',
		cues: ['how to go', 'which bus', 'mrt', 'concession', 'ez-link', 'senior card', '怎么去', '几号巴士'],
		eligibility: null,
		documents: [],
		verified: false,
		source: 'https://www.lta.gov.sg',
	},
];

/** Services grouped by ministry, for the coarse first pass. */
export function servicesFor(ministry: Ministry): readonly Service[] {
	return CATALOGUE.filter((s) => s.ministry === ministry);
}

/**
 * Facts we are allowed to say out loud.
 *
 * Returns nothing for an unverified row. The caller must treat an empty result as "hand
 * this to a person", never as "say something general instead" — a plausible-sounding
 * gap-filler is exactly the failure this gate exists to prevent.
 */
export function factsFor(intent: Intent): { label: string; value: string }[] {
	const service = CATALOGUE.find((s) => s.intent === intent);
	if (!service || !service.verified) return [];

	const facts: { label: string; value: string }[] = [];
	if (service.eligibility) facts.push({ label: 'Who can get this', value: service.eligibility });
	for (const doc of service.documents) facts.push({ label: 'Bring with you', value: doc });
	return facts;
}

/**
 * The transcript channel's opinion, by lexical cue match.
 *
 * Deliberately dumb and deliberately cheap. It exists to be wrong in different ways
 * than the audio model is wrong — a keyword hit on "chas" or "看医生" survives a
 * transcript that mangles everything around it, and a model that misheard the intent
 * entirely will not usually produce that keyword by accident.
 */
export function intentFromTranscript(transcript: string): Intent | null {
	const text = transcript.toLowerCase();
	let best: { intent: Intent; hits: number } | null = null;

	for (const service of CATALOGUE) {
		const hits = service.cues.filter((cue) => text.includes(cue.toLowerCase())).length;
		if (hits > 0 && (!best || hits > best.hits)) {
			best = { intent: service.intent, hits };
		}
	}

	return best?.intent ?? null;
}
