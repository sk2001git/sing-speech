/**
 * The day's spend, kept in one Durable Object per day (vault plan-suara-0021, H4): strongly
 * consistent, so two requests at once cannot both spend the last of it, which KV (eventually
 * consistent, up to 60 s) would allow. Pure here; the object only stores it.
 */
export interface Ledger {
	/** US dollars reserved today. */
	spent: number;
	/** Per session id. */
	sessions: Record<string, number>;
}

export interface Caps {
	day: number;
	session: number;
}

export type Reserved = { ok: true; ledger: Ledger } | { ok: false; reason: 'day' | 'session'; ledger: Ledger };

export function reserve(ledger: Ledger, session: string, cost: number, caps: Caps): Reserved {
	if (ledger.spent + cost > caps.day + 1e-9) return { ok: false, reason: 'day', ledger };
	const mine = ledger.sessions[session] ?? 0;
	if (mine + cost > caps.session + 1e-9) return { ok: false, reason: 'session', ledger };
	return { ok: true, ledger: { spent: ledger.spent + cost, sessions: { ...ledger.sessions, [session]: mine + cost } } };
}

/** The day a ledger belongs to, in Singapore time, where Suara's readers are. */
export function ledgerDay(now: number): string {
	return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
