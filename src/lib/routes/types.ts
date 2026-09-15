import type { Hearing } from '../kb/hearing';

/**
 * A vendor route: one way of turning a recording into a `Hearing`. Everything after
 * hearing — search, translation, screens — is shared, so swapping a vendor is a config
 * change (vault dec-suara-0016).
 */
export interface HearingRoute {
	id: string;
	vendor: string;
	/** Shown small at the foot of the page. */
	label: string;
	hear(audio: ArrayBuffer, mimeType?: string): Promise<Hearing>;
}

/**
 * Why a route could not serve. The first three are for the operator — add a key, fix a
 * key, top up — and are logged, never shown to the reader.
 */
export type UnavailableReason = 'missing-key' | 'bad-key' | 'needs-top-up' | 'rate-limited' | 'nothing-heard' | 'vendor-error';

export class RouteUnavailable extends Error {
	constructor(
		readonly route: string,
		readonly reason: UnavailableReason,
		message: string,
	) {
		super(`${route}: ${message}`);
		this.name = 'RouteUnavailable';
	}
}
