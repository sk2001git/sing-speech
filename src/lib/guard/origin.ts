/**
 * Another site calling Suara's API from a visitor's browser (vault plan-suara-0021, H1). The
 * browser says where a request came from; a request that says nothing (a script) is not refused
 * here, but it still needs a session, which only the page can get.
 */
export function crossOrigin(request: Request): boolean {
	const site = request.headers.get('sec-fetch-site');
	if (site === 'cross-site' || site === 'same-site') return true;
	const origin = request.headers.get('origin');
	if (!origin) return false;
	try {
		return new URL(origin).host !== new URL(request.url).host;
	} catch {
		return true;
	}
}
