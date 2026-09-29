/**
 * A visitor's session: a signed, expiring id in an HttpOnly cookie, issued once per visit after
 * Turnstile (vault plan-suara-0021, H3). Every paid API needs one, so rate limits and the daily
 * budget can be kept per visitor. The id is random and says nothing about the person.
 */
export const SESSION_COOKIE = 'suara_s';
/** Twelve hours: a day's use without a second challenge. */
export const SESSION_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

/** `expires` in milliseconds since the epoch. */
export async function signSession(secret: string, id: string, expires: number): Promise<string> {
	const body = b64url(encoder.encode(JSON.stringify({ id, exp: expires })));
	return `${body}.${b64url(await hmac(secret, body))}`;
}

/** The session id, or null when the token is missing, forged, altered or expired. */
export async function verifySession(secret: string, token: string | null | undefined, now: number): Promise<string | null> {
	if (!token) return null;
	const [body, sig] = token.split('.');
	if (!body || !sig) return null;
	let expected: Uint8Array;
	let given: Uint8Array;
	try {
		expected = await hmac(secret, body);
		given = fromB64url(sig);
	} catch {
		return null;
	}
	// Compared in full, whatever differs first, so the time taken says nothing about the key.
	if (given.length !== expected.length) return null;
	let diff = 0;
	for (let i = 0; i < given.length; i++) diff |= given[i]! ^ expected[i]!;
	if (diff !== 0) return null;
	try {
		const { id, exp } = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { id?: unknown; exp?: unknown };
		return typeof id === 'string' && typeof exp === 'number' && now < exp ? id : null;
	} catch {
		return null;
	}
}

/** A new random session id. */
export function newSessionId(): string {
	return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

export function cookieValue(header: string | null, name: string): string | null {
	if (!header) return null;
	for (const part of header.split(';')) {
		const [k, ...v] = part.trim().split('=');
		if (k === name) return v.join('=');
	}
	return null;
}
