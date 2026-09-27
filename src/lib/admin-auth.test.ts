import { describe, expect, it } from 'vitest';
import { checkPassword, readSession, SESSION_COOKIE, sessionCookie, SESSION_HOURS } from './admin-auth';

const T0 = Date.parse('2026-09-27T00:00:00Z');
const cookieOf = (setCookie: string) => setCookie.split(';')[0]!;

describe('checkPassword', () => {
	it('accepts the password and nothing else', async () => {
		expect(await checkPassword('correct horse', 'correct horse')).toBe(true);
		expect(await checkPassword('correct hors', 'correct horse')).toBe(false);
		expect(await checkPassword('', 'correct horse')).toBe(false);
	});

	it('lets nobody in when no password is set', async () => {
		expect(await checkPassword('', undefined)).toBe(false);
		expect(await checkPassword('anything', '')).toBe(false);
	});
});

describe('the admin session', () => {
	it('is a signed, HttpOnly, strict cookie that reads back as signed in', async () => {
		const set = await sessionCookie('pw', T0);
		expect(set).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
		expect(set).toContain('HttpOnly');
		expect(set).toContain('Secure');
		expect(set).toContain('SameSite=Strict');
		expect(set).toContain(`Max-Age=${SESSION_HOURS * 3600}`);
		expect(await readSession(cookieOf(set), 'pw', T0 + 1000)).toBe(true);
	});

	it(`ends after ${SESSION_HOURS} hours`, async () => {
		const set = await sessionCookie('pw', T0);
		expect(await readSession(cookieOf(set), 'pw', T0 + SESSION_HOURS * 3600_000 + 1)).toBe(false);
	});

	it('is refused when tampered with, or when the password has changed', async () => {
		const set = cookieOf(await sessionCookie('pw', T0));
		const [name, value] = set.split('=');
		const [exp, sig] = value!.split('.');
		expect(await readSession(`${name}=${Number(exp) + 999999}.${sig}`, 'pw', T0)).toBe(false);
		expect(await readSession(set, 'new password', T0)).toBe(false);
		expect(await readSession(null, 'pw', T0)).toBe(false);
		expect(await readSession('other=1', 'pw', T0)).toBe(false);
	});

	it('is never valid when no password is set', async () => {
		const set = cookieOf(await sessionCookie('pw', T0));
		expect(await readSession(set, undefined, T0)).toBe(false);
	});
});
