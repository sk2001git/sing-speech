import type { EntryLanguage } from './entry';
import type { WebAnswer } from './web-answer';

/**
 * Web answers kept as guides, so the next person who asks is answered from Suara at once
 * (owner, 2026-09-27: "a self adjusting kb where u can add to the guides"; vault dec-suara-0024).
 *
 * The owner's rule: a guide built only from Singapore government pages goes straight in; one
 * that cites any other site (Coinbase, IBKR, Trip.com) waits until the owner approves it.
 * Kept guides stay until the owner takes them down (owner, 2026-09-27: "KV shouldn't self
 * delete"). Freshness is shown rather than enforced: the fine print carries the date found, and
 * the review list its age.
 *
 * Stored in Workers KV, one JSON value per guide (owner: "KV with json"), with status and
 * title in the key's metadata so the review list needs no reads. KV cannot search by
 * similarity, so each isolate holds a copy of the guides and refreshes it every minute; a
 * guide saved elsewhere is seen within that minute. The copy loads every guide: fine for
 * hundreds, to be revisited in the thousands.
 */
export type GuideStatus = 'live' | 'pending';

export interface KeptGuide {
	id: string;
	/** The English meaning that was searched, which later questions are matched against. */
	question: string;
	answer: WebAnswer;
	language: EntryLanguage;
	foundAt: string;
	status: GuideStatus;
}

/** A row in the review list, from key metadata alone. */
export interface GuideListing {
	id: string;
	question: string;
	title: string;
	sites: string[];
	language: EntryLanguage;
	status: GuideStatus;
	foundAt: string;
}

export interface GuideFinder {
	/** The live guide nearest `vector` in this language, if at least `min` alike. */
	find(vector: number[], language: EntryLanguage, min: number): Promise<KeptGuide | null>;
}

const PREFIX = 'guide:';

/** Where a web answer goes: served at once, held for review, or not kept. */
export function keepAs(answer: WebAnswer): GuideStatus | null {
	if (answer.kind === 'none') return null;
	return answer.official ? 'live' : 'pending';
}

/** The part of Workers KV this uses, so tests and the dev fallback can stand in for it. */
export interface KvLike {
	get(key: string, type: 'json'): Promise<unknown>;
	put(key: string, value: string, opts?: { expiration?: number; metadata?: unknown }): Promise<void>;
	delete(key: string): Promise<void>;
	list(opts: { prefix: string; cursor?: string }): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
}

type Stored = Omit<KeptGuide, 'id'> & { vector: number[]; at: number };

const cosine = (a: number[], b: number[]) => {
	let dot = 0,
		na = 0,
		nb = 0;
	for (let i = 0; i < a.length; i++) {
		const y = b[i] ?? 0;
		dot += a[i]! * y;
		na += a[i]! * a[i]!;
		nb += y * y;
	}
	return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/** A stable id from the language and the question: the same question again replaces its guide. */
function idFor(language: EntryLanguage, question: string): string {
	let h = 0x811c9dc5;
	for (const ch of question.trim().toLowerCase()) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
	return `${language}-${h.toString(36)}`;
}

export class KvGuides implements GuideFinder {
	private copy: Map<string, Stored> | null = null;
	private loadedAt = 0;

	constructor(
		private readonly kv: KvLike,
		private readonly now: () => number = Date.now,
		private readonly refreshMs = 60_000,
	) {}

	/** Keep an answer under the question that found it, after the person already has it. */
	async save(g: { question: string; vector: number[]; answer: WebAnswer; language: EntryLanguage }): Promise<KeptGuide | null> {
		const status = keepAs(g.answer);
		if (!status) return null;
		const id = idFor(g.language, g.question);
		const at = this.now();
		const stored: Stored = { question: g.question, answer: g.answer, language: g.language, vector: g.vector, status, at, foundAt: new Date(at).toISOString() };
		await this.write(id, stored);
		return view(id, stored);
	}

	async find(vector: number[], language: EntryLanguage, min: number): Promise<KeptGuide | null> {
		const all = await this.load();
		let best: [string, Stored] | null = null;
		let bestScore = min;
		for (const [id, g] of all) {
			if (g.status !== 'live' || g.language !== language) continue;
			const score = cosine(vector, g.vector);
			if (score >= bestScore) {
				best = [id, g];
				bestScore = score;
			}
		}
		return best ? view(...best) : null;
	}

	/** Every kept guide, newest first, from key metadata. */
	async list(): Promise<GuideListing[]> {
		const rows: GuideListing[] = [];
		let cursor: string | undefined;
		do {
			const page = await this.kv.list({ prefix: PREFIX, ...(cursor ? { cursor } : {}) });
			for (const k of page.keys) if (k.metadata) rows.push({ id: k.name.slice(PREFIX.length), ...(k.metadata as Omit<GuideListing, 'id'>) });
			cursor = page.list_complete ? undefined : page.cursor;
		} while (cursor);
		return rows.sort((a, b) => b.foundAt.localeCompare(a.foundAt));
	}

	async get(id: string): Promise<KeptGuide | null> {
		const g = (await this.kv.get(PREFIX + id, 'json')) as Stored | null;
		return g ? view(id, g) : null;
	}

	async approve(id: string): Promise<boolean> {
		const g = (await this.kv.get(PREFIX + id, 'json')) as Stored | null;
		if (!g || g.status !== 'pending') return false;
		await this.write(id, { ...g, status: 'live' });
		return true;
	}

	async remove(id: string): Promise<boolean> {
		const g = await this.kv.get(PREFIX + id, 'json');
		if (!g) return false;
		await this.kv.delete(PREFIX + id);
		this.copy?.delete(id);
		return true;
	}

	private async write(id: string, g: Stored): Promise<void> {
		const metadata: Omit<GuideListing, 'id'> = {
			question: g.question.slice(0, 200),
			title: g.answer.title_full.slice(0, 120),
			sites: [...new Set(g.answer.sources.map((s) => s.site))].slice(0, 5).map((s) => s.slice(0, 60)),
			language: g.language,
			status: g.status,
			foundAt: g.foundAt,
		};
		// No expiration: a guide stays until the owner takes it down.
		await this.kv.put(PREFIX + id, JSON.stringify(g), { metadata });
		this.copy?.set(id, g);
	}

	private async load(): Promise<Map<string, Stored>> {
		if (this.copy && this.now() - this.loadedAt < this.refreshMs) return this.copy;
		const listed = await this.list();
		const rows = await Promise.all(listed.filter((l) => l.status === 'live').map(async (l) => [l.id, (await this.kv.get(PREFIX + l.id, 'json')) as Stored | null] as const));
		this.copy = new Map(rows.filter((r): r is readonly [string, Stored] => r[1] !== null));
		this.loadedAt = this.now();
		return this.copy;
	}
}

const view = (id: string, { question, answer, language, foundAt, status }: Stored): KeptGuide => ({ id, question, answer, language, foundAt, status });

/**
 * KV in memory, honouring expiry: for tests, and for a server with no SUARA_GUIDES binding,
 * where guides last as long as the isolate.
 */
export function memoryKv(now: () => number = Date.now): KvLike {
	const store = new Map<string, { value: string; expiration?: number; metadata?: unknown }>();
	const alive = (key: string) => {
		const v = store.get(key);
		if (v?.expiration !== undefined && v.expiration * 1000 <= now()) {
			store.delete(key);
			return undefined;
		}
		return v;
	};
	return {
		async get(key) {
			const v = alive(key);
			return v ? JSON.parse(v.value) : null;
		},
		async put(key, value, opts) {
			store.set(key, { value, ...(opts?.expiration !== undefined ? { expiration: opts.expiration } : {}), ...(opts?.metadata !== undefined ? { metadata: opts.metadata } : {}) });
		},
		async delete(key) {
			store.delete(key);
		},
		async list({ prefix }) {
			const keys = [...store.keys()].filter((k) => k.startsWith(prefix) && alive(k)).map((name) => ({ name, metadata: store.get(name)!.metadata }));
			return { keys, list_complete: true };
		},
	};
}

/**
 * The store for this isolate: KV when the Worker has the SUARA_GUIDES binding, memory when it
 * does not. One per binding, so the minute-long copy is shared by every request.
 */
let shared: { kv: KvLike; store: KvGuides } | null = null;
export function guidesFor(kv: KvLike | undefined): KvGuides {
	const backing = kv ?? fallback;
	if (!shared || shared.kv !== backing) shared = { kv: backing, store: new KvGuides(backing) };
	return shared.store;
}
const fallback = memoryKv();
