/**
 * How a step of a guide is written, given to every model that writes one, in so many words
 * (owner, 2026-09-29: "pass the agent the cornell or harvard review pose exactly so the LLM
 * gives us correct, adequate, extensive and concise content"). Sources and the older-reader
 * finding: vault obs-0073. Suara's own cards (`compose.ts`) and web guides (`web-answer.ts`)
 * both use these lines, so the two cannot drift apart.
 */
export const STEP_WRITING: readonly string[] = [
	'How to write each step. These are the rules of two sources, applied to an older person following a guide on a phone:',
	'- Todd Rogers and Jessica Lasky-Fink, Writing for Busy Readers (Harvard Kennedy School): less is more; make reading easy; design for easy navigation; use enough formatting, but no more; tell readers why they should care; make responding easy.',
	'- The Cornell note-taking system (Walter Pauk, Cornell University): a cue, then notes in short, concise sentences, then a summary of the gist in your own words.',
	'So, for every step:',
	'- name is the cue: the one action, verb first.',
	`- points are the notes: 1 to 4 items, one idea each, each a short complete sentence. Keep the words that link ideas ("if", "so", "then", "only"): older readers lose the meaning when those are cut. Use "lead", ending in a colon, only when the items are short parts that complete it, as in "The form must show:" then "The referral date". Items alike in form and in length. Leave "lead" out otherwise.`,
	'- about is what the person reads under "More about this step": at most two sentences, never points. Put the bottom line up front: the first sentence is the one thing this person most needs to know about this step, and why it matters to them; the second, only if needed, is the one detail or exception that changes what they do. Nothing the points already say. Leave it empty when the pages say nothing more about this step.',
	'- confirm_label is the summary, in the person\'s own words: what they tap when the step is done.',
	'- text is the step read aloud: what the points say, as one or two plain sentences.',
	'- Adequate and concise: every condition, exception, deadline and number on the pages that bears on a step appears in its points or its about, and nothing that does not bear on it.',
	'- A place the person must go to is named in full in the step where they go, in its points or its about, never left as "a participating centre". A list of places too long for one point goes in that step’s about, or one place to a point.',
	'- Every step stands on its own, because the person sees one step at a time: never "below", "above", "listed", "named", "the list" or "these" pointing outside the step.',
	'- Words as people say them: "2am", not "0200hrs"; short forms spelled out ("Urgent Care Centre", not "UCC"), except A&E.',
];

/** Sentences in a short text: a stop, question or exclamation mark followed by a space or the end. */
export const sentenceCount = (text: string) => (text.match(/[.!?。！？]+(?=\s|$)/g) ?? []).length;

/** The first two sentences, for a "more" that ran on: the bottom line and its one detail. */
export function firstTwoSentences(text: string): string {
	const parts = text.trim().split(/(?<=[.!?。！？])\s+/);
	return parts.slice(0, 2).join(' ');
}
