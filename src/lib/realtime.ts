import {
	beginTurnEvents,
	finishTurnEvents,
	forgetItemsEvents,
	parseRealtimeEvent,
	type ClientEvent,
} from './realtime-events';
import type { Understanding } from './understanding';

/**
 * The browser half of the OpenAI Realtime mode: one peer connection, push-to-talk.
 *
 * Everything that decides what an event means is in `realtime-events.ts`, where it is
 * tested. This file is only the WebRTC plumbing, which the test runner cannot exercise.
 */

/** The connection could not be made or was lost. Distinct from a refused microphone. */
export class RealtimeUnavailable extends Error {}

export interface RealtimeTurn {
	/** The raw `report_understanding` arguments. The server validates them. */
	understanding: unknown;
	transcript: string;
}

export interface RealtimeLink {
	/** The user pressed: open the microphone to the model. */
	begin(): void;
	/** The user finished: close the microphone and wait for the understanding. */
	finish(history: Understanding[]): Promise<RealtimeTurn>;
	close(): void;
}

/** How long the transcript may trail the understanding. It corroborates; it must not stall a turn. */
const TRANSCRIPT_GRACE_MS = 1500;
/** Upper bound on one response. Past this the turn is a failure the user can retry. */
const RESPONSE_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** Audio already captured is still in flight when the button is tapped. Let it land. */
const TAIL_MS = 250;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new RealtimeUnavailable(`${what} timed out`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

/** Earlier turns as text. Empty on the first turn. Mirrors `turnPreamble` in gemini.ts. */
function preamble(history: Understanding[]): string {
	if (history.length === 0) return '';
	const prior = history
		.map((h, i) => `Turn ${i + 1}: they wanted ${h.intent} (confidence ${h.confidence}).`)
		.join('\n');
	return `Earlier in this conversation:\n${prior}\n\nNow listen to the new audio.`;
}

/**
 * Ask for the microphone, then connect.
 *
 * A microphone error is thrown as-is so the caller can word it; anything after that is a
 * `RealtimeUnavailable`. The track starts disabled — nothing reaches the model until the
 * user presses.
 */
export async function connectRealtime(): Promise<RealtimeLink> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true },
	});
	const track = stream.getAudioTracks()[0];
	if (!track) {
		stream.getTracks().forEach((t) => t.stop());
		throw new DOMException('no audio track', 'NotFoundError');
	}
	track.enabled = false;

	const pc = new RTCPeerConnection();
	pc.addTrack(track, stream);
	const dc = pc.createDataChannel('oai-events');

	const opened = new Promise<void>((resolve, reject) => {
		dc.addEventListener('open', () => resolve(), { once: true });
		dc.addEventListener('error', () => reject(new RealtimeUnavailable('data channel failed')), { once: true });
	});

	try {
		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);
		const res = await fetch('/api/realtime/session', {
			method: 'POST',
			headers: { 'content-type': 'application/sdp' },
			body: offer.sdp,
		});
		if (!res.ok) throw new RealtimeUnavailable(`session ${res.status}`);
		await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
		await withTimeout(opened, CONNECT_TIMEOUT_MS, 'connect');
	} catch (err) {
		stream.getTracks().forEach((t) => t.stop());
		pc.close();
		throw err instanceof RealtimeUnavailable ? err : new RealtimeUnavailable(String(err));
	}

	const send = (events: ClientEvent[]) => {
		for (const event of events) dc.send(JSON.stringify(event));
	};

	let items = new Set<string>();
	let pending: {
		resolve: (turn: RealtimeTurn) => void;
		reject: (err: Error) => void;
		understanding?: unknown;
		transcript?: string;
		grace?: ReturnType<typeof setTimeout>;
	} | null = null;

	const forget = () => {
		if (items.size > 0 && dc.readyState === 'open') send(forgetItemsEvents([...items]));
		items = new Set();
	};

	const settle = () => {
		if (!pending || pending.understanding === undefined) return;
		const done = pending;
		pending = null;
		clearTimeout(done.grace);
		done.resolve({ understanding: done.understanding, transcript: done.transcript ?? '' });
		forget();
	};

	const fail = (err: Error) => {
		if (!pending) return;
		const done = pending;
		pending = null;
		clearTimeout(done.grace);
		done.reject(err);
		forget();
	};

	dc.addEventListener('message', (message) => {
		const signal = parseRealtimeEvent(String(message.data));
		if (!signal) return;

		switch (signal.kind) {
			case 'item':
				items.add(signal.itemId);
				return;
			case 'transcript':
				if (!pending) return;
				pending.transcript = signal.text;
				if (pending.understanding !== undefined) settle();
				return;
			case 'understanding':
				if (!pending) return;
				signal.itemIds.forEach((id) => items.add(id));
				pending.understanding = signal.args;
				if (pending.transcript !== undefined) settle();
				else pending.grace = setTimeout(settle, TRANSCRIPT_GRACE_MS);
				return;
			case 'failed':
				// An error with no turn in flight — for example deleting an item that was
				// already gone — is not the user's problem.
				fail(new RealtimeUnavailable(signal.message));
				return;
		}
	});

	pc.addEventListener('connectionstatechange', () => {
		if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
			fail(new RealtimeUnavailable(`connection ${pc.connectionState}`));
		}
	});

	return {
		begin() {
			send(beginTurnEvents());
			track.enabled = true;
		},

		async finish(history) {
			await new Promise((resolve) => setTimeout(resolve, TAIL_MS));
			track.enabled = false;
			if (dc.readyState !== 'open') throw new RealtimeUnavailable('data channel closed');

			const result = new Promise<RealtimeTurn>((resolve, reject) => {
				pending = { resolve, reject };
			});
			send(finishTurnEvents(preamble(history)));
			try {
				return await withTimeout(result, RESPONSE_TIMEOUT_MS, 'response');
			} catch (err) {
				pending = null;
				throw err;
			}
		},

		close() {
			stream.getTracks().forEach((t) => t.stop());
			dc.close();
			pc.close();
		},
	};
}
