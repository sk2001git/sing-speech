/**
 * What each API may cost and how often it may be called (vault plan-suara-0021, H2 and H4).
 *
 * Costs are estimates in US dollars, reserved from the daily budget before the call and rounded
 * up, from the prices checked on 2026-09-29/30: a spoken question is a transcription, two
 * gpt-6-luna calls and an embedding, well under a cent; a web answer is gpt-6-luna with the
 * web_search tool, 1-3 cents; a line read aloud is a few seconds of TTS; a live or realtime
 * session is a minute or more of a voice model.
 */
export type Bucket = 'search' | 'web' | 'speak' | 'live' | 'session' | 'other';

export interface Policy {
	bucket: Bucket;
	/** Needs a signed session cookie. */
	session: boolean;
	/** Reserved from the budget, US dollars. */
	cost: number;
	/** Largest body accepted, bytes. */
	maxBytes: number;
}

/** Calls per minute per session (per address for `session`), one Workers rate-limit binding each. */
export const PER_MINUTE: Record<Bucket, number> = { search: 12, web: 4, speak: 40, live: 3, session: 5, other: 10 };

const SMALL = 16 * 1024;

export function policyFor(path: string, method: string): Policy | null {
	if (!path.startsWith('/api/')) return null;
	if (path === '/api/session') return { bucket: 'session', session: false, cost: 0, maxBytes: SMALL };
	// The owner's own screens carry their own password check.
	if (path.startsWith('/api/admin/')) return { bucket: 'other', session: false, cost: 0, maxBytes: SMALL };
	if (path === '/api/search') return { bucket: 'search', session: true, cost: 0.005, maxBytes: 3 * 1024 * 1024 };
	if (path === '/api/web') return { bucket: 'web', session: true, cost: 0.03, maxBytes: SMALL };
	if (path === '/api/speak') return { bucket: 'speak', session: true, cost: 0.002, maxBytes: SMALL };
	if (path === '/api/turn') return { bucket: 'search', session: true, cost: 0.01, maxBytes: 3 * 1024 * 1024 };
	if (path === '/api/live/session' || path === '/api/realtime/session') return { bucket: 'live', session: true, cost: 0.05, maxBytes: SMALL };
	if (path === '/api/guides/add') return { bucket: 'web', session: true, cost: 0.03, maxBytes: SMALL };
	if (path === '/api/guides' && method === 'GET') return { bucket: 'other', session: true, cost: 0, maxBytes: SMALL };
	// A new API is guarded until it is given its own line here.
	return { bucket: 'other', session: true, cost: 0.01, maxBytes: SMALL };
}
