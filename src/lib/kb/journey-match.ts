import type { Journey } from './journey';

/**
 * Is this person in the middle of a life event, rather than asking a question?
 *
 * The difference matters. "What happens to CPF savings after death" wants one card;
 * "my father passed away" wants what to do now, and what can wait. Offering the journey to
 * the first would bury an answer under a seven-stage process; missing it for the second
 * leaves somebody to work out nine agencies by themselves.
 *
 * So the test is deliberately narrow: the words have to say that it happened, and that it
 * happened to somebody — the way people actually say it. A near miss falls through to the
 * ordinary search, which is where a question belongs.
 */

/** The event itself, in the words people use for it. */
const HAPPENED = /\b(passed away|passed on|died|death of|has died|have died|dies)\b/i;

/** Somebody it happened to. "Death" alone is a subject; "my father died" is an event. */
const SOMEBODY =
	/\b(my|our|his|her|their|the)\s+(father|mother|dad|mum|mom|papa|mama|husband|wife|spouse|son|daughter|brother|sister|grandfather|grandmother|grandpa|grandma|parent|parents|friend|neighbour|neighbor|partner|uncle|aunt|relative|loved one|next[- ]of[- ]kin|family member)\b/i;

/** Or the person asking is plainly in it. */
const IN_IT =
	/\b(someone|somebody|a person)\b.{0,24}\b(died|passed away|passed on)\b|\bwhat do i do when someone dies\b|\bafter a death in\b/i;

export function journeyFor(journeys: readonly Journey[], said: string): Journey | undefined {
	if (journeys.length === 0) return undefined;
	const text = said.toLowerCase();

	const isEvent = (HAPPENED.test(text) && SOMEBODY.test(text)) || IN_IT.test(text);
	if (!isEvent) return undefined;

	// One journey today. When there are several, the one whose phrasings share most with
	// what was said wins; until then, matching the event is the whole test.
	let best: Journey | undefined;
	let bestScore = 0;
	for (const journey of journeys) {
		const score = journey.search.example_phrasings.reduce((most, phrase) => Math.max(most, overlap(text, phrase)), 0);
		if (score > bestScore) {
			best = journey;
			bestScore = score;
		}
	}
	return best ?? journeys[0];
}

/** How much of a phrasing's distinctive words are in what was said. */
function overlap(said: string, phrase: string): number {
	const words = phrase
		.toLowerCase()
		.split(/[^a-z']+/)
		.filter((w) => w.length > 2);
	if (words.length === 0) return 0;
	const hit = words.filter((w) => said.includes(w)).length;
	return hit / words.length;
}
