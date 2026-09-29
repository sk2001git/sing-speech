/**
 * The page's side of the session (vault plan-suara-0021, H3). Every call to Suara's own API gets
 * a session first: once per visit, with an invisible Turnstile check when the site has a key. A
 * call refused for want of a session (401: expired, or the cookie was cleared) gets a new one and
 * is sent once more. The session itself is an HttpOnly cookie the page never sees; `suara_has`
 * only says there is one, so a reload does not ask again.
 */
const SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY as string | undefined;

let original: typeof fetch | null = null;
let pending: Promise<void> | null = null;

const hasSession = () => typeof document !== 'undefined' && /(?:^|;\s*)suara_has=1/.test(document.cookie);

export function ensureSession(fresh = false): Promise<void> {
	if (!fresh && !pending && hasSession()) return Promise.resolve();
	if (!pending || fresh) {
		pending = start().catch((err) => {
			pending = null;
			throw err;
		});
	}
	return pending;
}

async function start(): Promise<void> {
	const token = SITE_KEY ? await turnstileToken(SITE_KEY) : undefined;
	const res = await (original ?? fetch)('/api/session', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(token ? { token } : {}),
	});
	if (!res.ok) throw new Error(`session ${res.status}`);
}

interface Turnstile {
	render(el: HTMLElement, opts: Record<string, unknown>): string;
	remove(id: string): void;
}

/** Cloudflare's widget, shown only if it needs the person to do something. */
async function turnstileToken(sitekey: string): Promise<string> {
	const w = window as unknown as { turnstile?: Turnstile };
	if (!w.turnstile) {
		await new Promise<void>((resolve, reject) => {
			const s = document.createElement('script');
			s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
			s.async = true;
			s.onload = () => resolve();
			s.onerror = () => reject(new Error('turnstile did not load'));
			document.head.appendChild(s);
		});
	}
	const el = document.createElement('div');
	el.className = 'k-turnstile';
	document.body.appendChild(el);
	return new Promise<string>((resolve, reject) => {
		const id = w.turnstile!.render(el, {
			sitekey,
			appearance: 'interaction-only',
			callback: (token: string) => {
				resolve(token);
				setTimeout(() => {
					w.turnstile!.remove(id);
					el.remove();
				}, 0);
			},
			'error-callback': () => reject(new Error('turnstile failed')),
		});
	});
}

/** Wrap the page's fetch once: Suara's own API calls carry a session. */
export function installSessionFetch(): void {
	if (typeof window === 'undefined' || original) return;
	original = window.fetch.bind(window);
	const plain = original;
	window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const url = new URL(href, location.href);
		const own = url.origin === location.origin && url.pathname.startsWith('/api/') && url.pathname !== '/api/session' && !url.pathname.startsWith('/api/admin/');
		if (!own) return plain(input, init);
		await ensureSession();
		const res = await plain(input, init);
		if (res.status !== 401) return res;
		await ensureSession(true);
		return plain(input, init);
	};
}

installSessionFetch();
