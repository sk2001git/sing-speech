import type { EntryLanguage } from './entry';
import type { WebAnswer } from './web-answer';

/**
 * Web answers kept as guides, so the next person who asks is answered from Suara at once
 * (owner, 2026-09-27: "a self adjusting kb where u can add to the guides").
 *
 * The owner's rule: a guide built only from Singapore government pages goes straight in; one
 * that cites any other site (Coinbase, IBKR, Trip.com) waits for the owner to approve it.
 * Kept guides lapse after 30 days, so rules, fees and prices are searched again rather than
 * served stale.
 *
 * Per isolate for now, like the translation cache: the Worker has no KV or D1 binding yet.
 */
export interface KeptGuide {
	id: string;
	/** The English meaning that was searched, which later questions are matched against. */
	question: string;
	answer: WebAnswer;
	language: EntryLanguage;
	foundAt: string;
}

export interface GuideFinder {
	/** The live guide nearest `vector` in this language, if at least `min` alike. */
	find(vector: number[], language: EntryLanguage, min: number): KeptGuide | null;
}

export const GUIDE_DAYS = 30;

/** Where a web answer goes: served at once, held for review, or not kept. */
export function keepAs(answer: WebAnswer): 'live' | 'pending' | null {
	if (answer.kind === 'none') return null;
	return answer.official ? 'live' : 'pending';
}

const cosine = (a: number[], b: number[]) => {
	let dot = 0,
		na = 0,
		nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i]! * (b[i] ?? 0);
		na += a[i]! * a[i]!;
		nb += (b[i] ?? 0) * (b[i] ?? 0);
	}
	return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

type Stored = KeptGuide & { vector: number[]; status: 'live' | 'pending'; at: number };

export class MemoryGuides implements GuideFinder {
	private readonly guides = new Map<string, Stored>();
	constructor(private readonly now: () => number = Date.now) {}

	/** Keep an answer under the question that found it. The same question again replaces it. */
	save(g: { question: string; vector: number[]; answer: WebAnswer; language: EntryLanguage }): KeptGuide | null {
		const status = keepAs(g.answer);
		if (!status) return null;
		const id = `${g.language}:${g.question.trim().toLowerCase()}`;
		const at = this.now();
		const kept: Stored = { id, question: g.question, answer: g.answer, language: g.language, vector: g.vector, status, at, foundAt: new Date(at).toISOString() };
		this.guides.set(id, kept);
		return strip(kept);
	}

	find(vector: number[], language: EntryLanguage, min: number): KeptGuide | null {
		const fresh = this.now() - GUIDE_DAYS * 86_400_000;
		let best: Stored | null = null;
		let bestScore = min;
		for (const g of this.guides.values()) {
			if (g.status !== 'live' || g.language !== language || g.at < fresh) continue;
			const score = cosine(vector, g.vector);
			if (score >= bestScore) {
				best = g;
				bestScore = score;
			}
		}
		return best ? strip(best) : null;
	}

	pending(): KeptGuide[] {
		return [...this.guides.values()].filter((g) => g.status === 'pending').map(strip);
	}

	approve(id: string): boolean {
		const g = this.guides.get(id);
		if (!g || g.status !== 'pending') return false;
		g.status = 'live';
		return true;
	}

	size(): number {
		return this.guides.size;
	}
}

const strip = ({ id, question, answer, language, foundAt }: Stored): KeptGuide => ({ id, question, answer, language, foundAt });

/** One store per isolate, shared by the search and the web routes. */
export const guides = new MemoryGuides();
