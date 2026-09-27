import type { WebAnswer, WebStage } from './web-answer';
import type { KeptGuide, KvGuides } from './web-guides';

/**
 * The owner adds a guide by typing a question (approved mockup, design/admin/admin.html): Suara
 * searches the web as it would for anyone, and holds the result in Waiting for the owner to
 * check, whatever pages it cites. English only for now: the question is the meaning it is kept under.
 */
export interface AddGuideDeps {
	search: (question: string, onStage: (s: WebStage) => void) => Promise<WebAnswer>;
	/** The query embedding of a question, as the search makes it. */
	embed: (question: string) => Promise<number[]>;
	store: KvGuides;
	onStage: (s: WebStage) => void;
}

export async function addGuide(question: string, deps: AddGuideDeps): Promise<{ ok: true; guide: KeptGuide } | { ok: false; error: string }> {
	let answer: WebAnswer;
	try {
		answer = await deps.search(question, deps.onStage);
	} catch {
		return { ok: false, error: 'The web search failed. Try again in a moment.' };
	}
	if (answer.kind === 'none') return { ok: false, error: 'The web had no reliable answer to that.' };
	const guide = await deps.store.save({ question, vector: await deps.embed(question), answer, language: 'en' }, { status: 'pending' });
	return guide ? { ok: true, guide } : { ok: false, error: 'The web had no reliable answer to that.' };
}
