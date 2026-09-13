import type { Procedure } from './procedure';
import type { Intent } from './understanding';

/**
 * A visit to the hospital, as a sample flow for design review.
 *
 * NOT CHECKED against any hospital. It exists so the owner can walk the readback →
 * steps journey end to end before real content is sourced. `sample: true` keeps it
 * behind demo mode and under a visible label; `verified: false` keeps every gate that
 * protects real users closed. The wording is deliberately generic — no phone numbers,
 * counters, times or eligibility — because those are exactly the details a wrong sample
 * would teach.
 */
export const HOSPITAL_VISIT: Procedure = {
	id: 'hospital-visit',
	ministry: 'moh',
	title: { en: 'Your hospital visit' },
	topic: 'hospital appointment',
	metadata: {
		cues: ['appointment', 'hospital', 'polyclinic', 'what to bring', 'see doctor'],
		aliases: ['clinic visit', 'doctor appointment'],
	},
	entry: 'letter',
	steps: [
		{
			id: 'letter',
			instruction: { en: 'Find your appointment letter or SMS. It shows the date, the time and the clinic.' },
			image: null,
			next: {
				question: { en: 'Do you have your appointment letter or SMS?' },
				yes: 'bring',
				no: 'call',
			},
		},
		{
			id: 'call',
			instruction: { en: 'Call the hospital and ask them to send your appointment details again.' },
			image: null,
			next: 'bring',
		},
		{
			id: 'bring',
			instruction: { en: 'The night before, put your IC, your appointment letter and your medicines in one bag.' },
			image: null,
			next: 'arrive',
		},
		{
			id: 'arrive',
			instruction: { en: 'Arrive a little early. Follow the signs to Registration.' },
			image: null,
			next: 'register',
		},
		{
			id: 'register',
			instruction: { en: 'At Registration, show your IC and your letter. You will get a queue number.' },
			image: null,
			next: 'wait',
		},
		{
			id: 'wait',
			instruction: { en: 'Sit where you can see the screen. Wait for your queue number to be called.' },
			image: null,
			next: 'consult',
		},
		{
			id: 'consult',
			instruction: { en: 'See the doctor. It is fine to ask them to speak slowly or say it again.' },
			image: null,
			next: 'pharmacy',
		},
		{
			id: 'pharmacy',
			instruction: { en: 'Collect your medicine and pay. Ask how and when to take each one.' },
			image: null,
			next: null,
		},
	],
	verified: false,
	sample: true,
	source: '',
	checkedOn: null,
};

/**
 * Which flow a confirmed request walks into.
 *
 * One table so the mapping can be argued with in one place. Treating the hospital as the
 * overarching service is the owner's framing (2026-09-13); which intents belong under it
 * is a guess recorded in plan-suara-0004.
 */
const FLOWS: Partial<Record<Intent, Procedure>> = {
	appointment_prep: HOSPITAL_VISIT,
	chas_subsidy: HOSPITAL_VISIT,
};

export function procedureFor(intent: Intent): Procedure | null {
	return FLOWS[intent] ?? null;
}

/**
 * The procedure, if this page is allowed to show it.
 *
 * Verified content always. A sample only in demo mode. Unverified content that is not a
 * sample never — that is the failure the whole content gate exists to prevent.
 */
export function usableProcedure(proc: Procedure | null, demo: boolean): Procedure | null {
	if (!proc) return null;
	if (proc.verified) return proc;
	return demo && proc.sample === true ? proc : null;
}
