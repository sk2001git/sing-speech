import { crossOrigin } from './origin';
import { ledgerDay, type Caps } from './ledger';
import { PER_MINUTE, policyFor, type Bucket } from './policy';
import { cookieValue, SESSION_COOKIE, verifySession } from './session';

/**
 * Everything in front of a paid API, in order (vault plan-suara-0021): another site's page is
 * refused; an oversized body is refused; a visitor without a session is told to get one; each
 * session (or, for getting a session, each address) has a rate per minute; and each call reserves
 * its estimated cost from the day's budget and the session's. Returns the refusal, or null.
 *
 * Nothing about the person is logged: not the question, not the address.
 */
export interface RateLimit {
	limit(opts: { key: string }): Promise<{ success: boolean }>;
}
export interface BudgetStub {
	reserve(session: string, cost: number, caps: Caps): Promise<{ ok: boolean; reason?: 'day' | 'session' }>;
}
export interface BudgetNamespace {
	idFromName(name: string): unknown;
	get(id: unknown): BudgetStub;
}

export interface GuardEnv {
	/** Secret. Signs session cookies. Without it in production, paid APIs are closed. */
	SUARA_SESSION_SECRET?: string;
	SUARA_DAILY_BUDGET_USD?: string;
	SUARA_SESSION_BUDGET_USD?: string;
	SUARA_BUDGET?: BudgetNamespace;
	SUARA_RL_SEARCH?: RateLimit;
	SUARA_RL_WEB?: RateLimit;
	SUARA_RL_SPEAK?: RateLimit;
	SUARA_RL_LIVE?: RateLimit;
	SUARA_RL_SESSION?: RateLimit;
	SUARA_RL_OTHER?: RateLimit;
}

const LIMITER: Record<Bucket, keyof GuardEnv> = {
	search: 'SUARA_RL_SEARCH',
	web: 'SUARA_RL_WEB',
	speak: 'SUARA_RL_SPEAK',
	live: 'SUARA_RL_LIVE',
	session: 'SUARA_RL_SESSION',
	other: 'SUARA_RL_OTHER',
};

/** Only on this PC: a fixed key, so the dev server works without secrets. Never in a build. */
export const DEV_SESSION_SECRET = 'suara-dev-only-session-secret';

export const DEFAULT_CAPS: Caps = { day: 3, session: 0.25 };

const refuse = (status: number, error: string, extra: Record<string, string> = {}) =>
	new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

export function sessionSecret(env: GuardEnv, dev: boolean): string | undefined {
	return env.SUARA_SESSION_SECRET || (dev ? DEV_SESSION_SECRET : undefined);
}

export function capsOf(env: GuardEnv): Caps {
	const n = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : fallback);
	return { day: n(env.SUARA_DAILY_BUDGET_USD, DEFAULT_CAPS.day), session: n(env.SUARA_SESSION_BUDGET_USD, DEFAULT_CAPS.session) };
}

export async function guard(request: Request, env: GuardEnv, opts: { dev: boolean; now: number }): Promise<Response | null> {
	const url = new URL(request.url);
	const policy = policyFor(url.pathname, request.method);
	if (!policy) return null;

	if (crossOrigin(request)) return refuse(403, 'cross-origin');
	const length = Number(request.headers.get('content-length') ?? '0');
	if (length > policy.maxBytes) return refuse(413, 'too-large');

	const secret = sessionSecret(env, opts.dev);
	if (!secret) {
		console.error('SUARA_SESSION_SECRET is not set: paid APIs are closed');
		return refuse(503, 'not-configured');
	}

	let key: string;
	let session = '';
	if (policy.session) {
		const id = await verifySession(secret, cookieValue(request.headers.get('cookie'), SESSION_COOKIE), opts.now);
		if (!id) return refuse(401, 'session');
		key = session = id;
	} else {
		key = request.headers.get('cf-connecting-ip') ?? 'local';
	}

	const limiter = env[LIMITER[policy.bucket]] as RateLimit | undefined;
	if (limiter) {
		const { success } = await limiter.limit({ key: `${policy.bucket}:${key}` });
		if (!success) return refuse(429, 'busy', { 'retry-after': '60' });
	}

	if (policy.cost > 0 && session && env.SUARA_BUDGET) {
		const stub = env.SUARA_BUDGET.get(env.SUARA_BUDGET.idFromName(ledgerDay(opts.now)));
		const r = await stub.reserve(session, policy.cost, capsOf(env));
		if (!r.ok) return refuse(429, r.reason === 'day' ? 'resting' : 'enough-for-today');
	}
	return null;
}

/** Headers every response carries (H7): no framing, no sniffing, microphone for this site only. */
export function secure(response: Response): Response {
	const res = new Response(response.body, response);
	res.headers.set('x-content-type-options', 'nosniff');
	res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	res.headers.set('x-frame-options', 'DENY');
	res.headers.set('permissions-policy', 'microphone=(self), camera=(), geolocation=()');
	return res;
}

export { PER_MINUTE };
