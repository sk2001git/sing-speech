import type { MicFailure } from './session';

/**
 * Which of the three microphone problems this is.
 *
 * Each gets different words on screen, because each has a different fix. An insecure
 * origin comes first: until the page is on HTTPS or localhost, no permission prompt can
 * even appear. Anything unrecognised is treated as permission, which at least has an
 * instruction the user can follow.
 */
export function micFailure(err: unknown, secure: boolean): MicFailure {
	if (!secure) return 'insecure';
	const name =
		typeof err === 'object' && err !== null && 'name' in err
			? String((err as { name: unknown }).name)
			: '';
	if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device';
	return 'permission';
}
