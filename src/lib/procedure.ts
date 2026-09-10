import type { Ministry } from './catalogue';
import type { Language } from './understanding';

/**
 * A localised string.
 *
 * Partial by construction, with English required as the fallback. `Language` has eight
 * members and only four of them have any synthesis voice at all, so demanding a total
 * record would mean authors writing placeholder Hokkien to satisfy the type — which is
 * exactly the invented content this codebase refuses everywhere else.
 */
export type Localised = { en: string } & Partial<Record<Language, string>>;

export interface StepImage {
	src: string;
	alt: Localised;
	/** When a person last confirmed this matches the live interface. ISO date. */
	checkedOn: string;
}

/**
 * A fork in a procedure. One yes/no question, never "did you mean A or B" — the same
 * rule `policy.ts` enforces for intent confirmation, and for the same reason.
 */
export interface Branch {
	question: Localised;
	yes: string;
	no: string;
}

export interface Step {
	id: string;
	instruction: Localised;
	image: StepImage | null;
	/** A step id, a branch, or null for terminal. */
	next: string | Branch | null;
}

export interface Procedure {
	id: string;
	ministry: Ministry;
	title: Localised;
	topic: string;
	/**
	 * Retrieval metadata. Unused at this scale — the procedure index goes in the prompt
	 * and the audio model classifies. Authored anyway so that retrieval is available
	 * later without a migration.
	 */
	metadata: { cues: string[]; aliases: string[] };
	entry: string;
	steps: Step[];
	/** False until a person has walked the flow against `source`. Gates everything. */
	verified: boolean;
	source: string;
	checkedOn: string | null;
}

/** Where a user is in a procedure. Held by the client, validated by the server. */
export interface Cursor {
	procedureId: string;
	stepId: string;
	done: string[];
	startedAt: string;
}

export function stepById(proc: Procedure, id: string): Step | undefined {
	return proc.steps.find((s) => s.id === id);
}

/** Every step this one can lead to. Both arms of a branch are legal successors. */
export function successors(step: Step): string[] {
	if (step.next === null) return [];
	if (typeof step.next === 'string') return [step.next];
	return [step.next.yes, step.next.no];
}

/**
 * Pick the best available wording.
 *
 * Falls back to English rather than returning empty. A step with no text is a step the
 * user cannot act on, which is worse than a step in the wrong language.
 */
export function localise(text: Localised, lang: Language): string {
	return text[lang] ?? text.en;
}

/**
 * Everything wrong with a procedure, as a list of plain sentences. Empty means valid.
 *
 * Returns all problems rather than throwing on the first, because this runs over
 * authored content and an author fixing one error at a time is an author who gives up.
 */
export function validateProcedure(proc: Procedure): string[] {
	const problems: string[] = [];
	const ids = new Set<string>();

	for (const step of proc.steps) {
		if (ids.has(step.id)) problems.push(`duplicate step id "${step.id}"`);
		ids.add(step.id);
	}

	if (!ids.has(proc.entry)) problems.push(`entry "${proc.entry}" is not a step`);

	for (const step of proc.steps) {
		for (const target of successors(step)) {
			if (!ids.has(target)) {
				problems.push(`step "${step.id}" points at missing step "${target}"`);
			}
		}
	}

	// Walk from the entry. Anything not seen is authored content no user can reach.
	const seen = new Set<string>();
	const queue = ids.has(proc.entry) ? [proc.entry] : [];
	while (queue.length > 0) {
		const id = queue.shift()!;
		if (seen.has(id)) continue;
		seen.add(id);
		const step = stepById(proc, id);
		if (step) queue.push(...successors(step).filter((t) => ids.has(t)));
	}
	for (const step of proc.steps) {
		if (!seen.has(step.id)) {
			problems.push(`step "${step.id}" is unreachable from entry`);
		}
	}

	if (hasCycle(proc, ids)) problems.push('graph has a cycle');

	return problems;
}

/** Depth-first colour marking. Grey means "on the current path", so re-entry is a loop. */
function hasCycle(proc: Procedure, ids: Set<string>): boolean {
	const grey = new Set<string>();
	const black = new Set<string>();

	function visit(id: string): boolean {
		if (grey.has(id)) return true;
		if (black.has(id)) return false;
		grey.add(id);
		const step = stepById(proc, id);
		if (step) {
			for (const target of successors(step)) {
				if (ids.has(target) && visit(target)) return true;
			}
		}
		grey.delete(id);
		black.add(id);
		return false;
	}

	for (const step of proc.steps) {
		if (visit(step.id)) return true;
	}
	return false;
}

/**
 * Could this cursor have been arrived at honestly?
 *
 * The cursor travels with the request, so it is not trusted. Checking that the claimed
 * history is a real contiguous walk from the entry is what stops a tampered cursor
 * dropping someone at step five of a flow they never started. Validation instead of
 * storage: no session store, no trust.
 */
export function isReachable(proc: Procedure, cursor: Cursor): boolean {
	const ids = new Set(proc.steps.map((s) => s.id));

	if (!ids.has(cursor.stepId)) return false;
	if (cursor.done.includes(cursor.stepId)) return false;
	for (const id of cursor.done) {
		if (!ids.has(id)) return false;
	}

	// An empty history is only ever legal at the entry.
	if (cursor.done.length === 0) return cursor.stepId === proc.entry;
	if (cursor.done[0] !== proc.entry) return false;

	const chain = [...cursor.done, cursor.stepId];
	for (let i = 0; i < chain.length - 1; i += 1) {
		const from = stepById(proc, chain[i]!);
		if (!from || !successors(from).includes(chain[i + 1]!)) return false;
	}
	return true;
}
