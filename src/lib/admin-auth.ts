/**
 * Sign-in for the owner's admin pages: reviewing and adding web guides (owner, 2026-09-27:
 * "i don't mind adding auth too for now").
 *
 * One password, held as the Worker secret SUARA_ADMIN_PASSWORD (in .env for the dev server).
 * Signing in sets a cookie carrying its expiry and an HMAC of that expiry keyed by the
 * password, so there is nothing to store, and changing the password signs everyone out. No
 * password set means nobody gets in.
 */
export const SESSION_COOKIE = 'suara_admin';
export const SESSION_HOURS = 12;

const enc = new TextEncoder();

async function hmac(key: string, message: string): Promise<string> {
	const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
	return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Equal strings, compared in time that does not depend on where they differ. */
function same(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export async function checkPassword(given: string, password: string | undefined): Promise<boolean> {
	if (!password || !given) return false;
	// Compare digests, so the length of the password is not given away either.
	return same(await hmac('suara-admin-check', given), await hmac('suara-admin-check', password));
}

/** The Set-Cookie value for a new session. */
export async function sessionCookie(password: string, now = Date.now()): Promise<string> {
	const exp = now + SESSION_HOURS * 3600_000;
	const value = `${exp}.${await hmac(password, `session:${exp}`)}`;
	return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

export const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** Whether the request's Cookie header carries a live session. */
export async function readSession(cookieHeader: string | null, password: string | undefined, now = Date.now()): Promise<boolean> {
	if (!password || !cookieHeader) return false;
	const raw = cookieHeader
		.split(';')
		.map((c) => c.trim())
		.find((c) => c.startsWith(`${SESSION_COOKIE}=`))
		?.slice(SESSION_COOKIE.length + 1);
	const [exp, sig] = raw?.split('.') ?? [];
	if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) <= now) return false;
	return same(sig, await hmac(password, `session:${exp}`));
}
