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
	/** `hint`: the reader's language, when they chose one; Whisper guesses badly on short Singlish. */
	/** `onTranscript`: the words, as soon as they are heard and before they are read. */
	hear(audio: ArrayBuffer, mimeType?: string, hint?: HearingHint, onTranscript?: (transcript: string) => void): Promise<Hearing>;
}

/** The language a recording is in, as far as the reader's setting says (vault obs-0054). */
export type HearingHint = 'en' | 'zh';

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
