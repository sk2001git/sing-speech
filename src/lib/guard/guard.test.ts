import { describe, expect, it } from 'vitest';
import { crossOrigin } from './origin';
import { policyFor } from './policy';
import { reserve, type Ledger } from './ledger';
import { signSession, verifySession } from './session';
import { guard } from './guard';

/** The guard in front of every paid API (vault plan-suara-0021, H1-H4). */
describe('session', () => {
	const secret = 'test-secret-that-is-long-enough';
	it('verifies a session it signed, until it expires', async () => {
		const token = await signSession(secret, 'abc123', 1_000_000);
		expect(await verifySession(secret, token, 999_000)).toBe('abc123');
		expect(await verifySession(secret, token, 1_000_001)).toBeNull();
	});

	it('refuses a session signed with another secret, or altered', async () => {
		const token = await signSession(secret, 'abc123', 1_000_000);
		expect(await verifySession('another-secret-entirely', token, 0)).toBeNull();
		const [body, sig] = token.split('.');
		const forged = `${btoa(JSON.stringify({ id: 'someone-else', exp: 1_000_000 })).replace(/=+$/, '')}.${sig}`;
		expect(await verifySession(secret, forged, 0)).toBeNull();
		expect(await verifySession(secret, `${body}.`, 0)).toBeNull();
		expect(await verifySession(secret, 'nonsense', 0)).toBeNull();
	});
});

describe('crossOrigin', () => {
	const req = (headers: Record<string, string>) => new Request('https://suara.sg/api/search', { method: 'POST', headers });
	it('lets the page itself through, and a caller that sends neither header (it still needs a session)', () => {
		expect(crossOrigin(req({ origin: 'https://suara.sg', 'sec-fetch-site': 'same-origin' }))).toBe(false);
		expect(crossOrigin(req({}))).toBe(false);
	});
	it('refuses another site calling the API from a visitor’s browser', () => {
		expect(crossOrigin(req({ origin: 'https://evil.example' }))).toBe(true);
		expect(crossOrigin(req({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
		expect(crossOrigin(req({ origin: 'https://suara.sg.evil.example' }))).toBe(true);
	});
});

describe('policyFor', () => {
	it('gives every paid API a rate bucket and a cost, and asks for a session', () => {
		expect(policyFor('/api/search', 'POST')).toMatchObject({ bucket: 'search', session: true });
		expect(policyFor('/api/web', 'POST')!.cost).toBeGreaterThan(policyFor('/api/search', 'POST')!.cost);
		expect(policyFor('/api/speak', 'GET')).toMatchObject({ bucket: 'speak', session: true });
		expect(policyFor('/api/live/session', 'POST')).toMatchObject({ bucket: 'live' });
	});
	it('lets a visitor ask for a session, limited by address, and leaves pages and assets alone', () => {
		expect(policyFor('/api/session', 'POST')).toMatchObject({ bucket: 'session', session: false, cost: 0 });
		expect(policyFor('/', 'GET')).toBeNull();
		expect(policyFor('/kb-audio/x.mp3', 'GET')).toBeNull();
	});
	it('guards an API it does not know, rather than letting it through', () => {
		expect(policyFor('/api/something-new', 'POST')).toMatchObject({ session: true, bucket: 'other' });
	});
});

describe('reserve (the daily budget)', () => {
	const caps = { day: 3, session: 0.25 };
	it('takes each cost from the day and the session, and refuses once either would run out', () => {
		let ledger: Ledger = { spent: 0, sessions: {} };
		for (let i = 0; i < 6; i++) {
			const r = reserve(ledger, 's1', 0.04, caps);
			expect(r.ok).toBe(true);
			ledger = r.ledger;
		}
		expect(ledger.spent).toBeCloseTo(0.24);
		const over = reserve(ledger, 's1', 0.04, caps);
		expect(over).toMatchObject({ ok: false, reason: 'session' });
		expect(over.ledger).toBe(ledger);
		expect(reserve(ledger, 's2', 0.04, caps).ok).toBe(true);
	});
	it('refuses everyone once the day is spent', () => {
		const ledger: Ledger = { spent: 2.99, sessions: {} };
		expect(reserve(ledger, 's9', 0.03, caps)).toMatchObject({ ok: false, reason: 'day' });
	});
});

describe('guard, in front of every paid API', () => {
	const now = 1_700_000_000_000;
	const secret = 'a-secret-for-the-guard-tests';
	const counter = (limit: number) => {
		const seen = new Map<string, number>();
		return { limit: async ({ key }: { key: string }) => ({ success: (seen.set(key, (seen.get(key) ?? 0) + 1).get(key) ?? 0) <= limit }) };
	};
	const budget = (caps: { day: number; session: number }) => {
		let ledger: Ledger = { spent: 0, sessions: {} };
		return { idFromName: (n: string) => n, get: () => ({ reserve: async (s: string, cost: number) => {
			const r = reserve(ledger, s, cost, caps);
			ledger = r.ledger;
			return r.ok ? { ok: true } : { ok: false, reason: r.reason };
		} }) };
	};
	const withSession = async () => `suara_s=${await signSession(secret, 'visitor-1', now + 60_000)}`;
	const post = (path: string, headers: Record<string, string> = {}) => new Request(`https://suara.sg${path}`, { method: 'POST', headers });

	it('closes the paid APIs when there is no session secret, outside this PC', async () => {
		const r = await guard(post('/api/search'), {}, { dev: false, now });
		expect(r?.status).toBe(503);
	});

	it('lets a session through, then slows a burst, then stops the session at its budget', async () => {
		const env = { SUARA_SESSION_SECRET: secret, SUARA_RL_SPEAK: counter(3), SUARA_BUDGET: budget({ day: 3, session: 0.005 }) };
		const cookie = await withSession();
		const speak = () => guard(new Request('https://suara.sg/api/speak?text=hi', { headers: { cookie } }), env, { dev: false, now });
		expect(await speak()).toBeNull();
		expect(await speak()).toBeNull();
		// 0.002 each: the third would take the session past 0.005.
		expect((await speak())?.status).toBe(429);
		expect(await (await speak())!.json()).toEqual({ error: 'busy' });
	});

	it('says Suara is resting when the whole day is spent', async () => {
		const env = { SUARA_SESSION_SECRET: secret, SUARA_BUDGET: budget({ day: 0.006, session: 1 }) };
		const cookie = await withSession();
		expect(await guard(post('/api/search', { cookie }), env, { dev: false, now })).toBeNull();
		const r = await guard(post('/api/search', { cookie }), env, { dev: false, now });
		expect(r?.status).toBe(429);
		expect(await r!.json()).toEqual({ error: 'resting' });
	});

	it('limits getting a session by address, not by session', async () => {
		const env = { SUARA_SESSION_SECRET: secret, SUARA_RL_SESSION: counter(1) };
		const ask = (ip: string) => guard(post('/api/session', { 'cf-connecting-ip': ip }), env, { dev: false, now });
		expect(await ask('1.2.3.4')).toBeNull();
		expect((await ask('1.2.3.4'))?.status).toBe(429);
		expect(await ask('5.6.7.8')).toBeNull();
	});

	it('leaves pages alone', async () => {
		expect(await guard(new Request('https://suara.sg/'), {}, { dev: false, now })).toBeNull();
	});
});
