import { TranscriptBuffer } from './routes/live';

/**
 * The browser half of the GPT-Live route: microphone out, voice in, events on a data
 * channel. The key never reaches the page — `/api/live/session` exchanges the offer.
 *
 * GPT-Live decides when a turn ends, so there is no silence gate here. It delegates work
 * to us (`session.delegation.created`), we answer with `session.commentary.append`, and it
 * speaks that line.
 */
export interface LiveHandlers {
	/** Everything heard so far this turn, growing as fragments arrive. */
	onTranscript: (text: string) => void;
	/** GPT-Live wants an answer: reply with `answer(text)`. */
	onRequest: (request: { id: string; said: string; answer: (spoken: string) => void }) => void;
	onClosed: (reason: string) => void;
	onError: (message: string) => void;
}

export interface LiveLink {
	stream: MediaStream;
	close: () => void;
}

export class LiveUnavailable extends Error {
	constructor(readonly reason: string) {
		super(`live unavailable: ${reason}`);
		this.name = 'LiveUnavailable';
	}
}

export async function connectLive(handlers: LiveHandlers): Promise<LiveLink> {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true } });
	const pc = new RTCPeerConnection();
	const speaker = new Audio();
	speaker.autoplay = true;
	const heard = new TranscriptBuffer();
	let closed = false;

	const close = () => {
		if (closed) return;
		closed = true;
		try {
			if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'session.close' }));
		} catch {
			/* already gone */
		}
		stream.getTracks().forEach((t) => t.stop());
		speaker.pause();
		pc.close();
	};

	for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
	pc.ontrack = (e) => {
		speaker.srcObject = e.streams[0] ?? null;
		void speaker.play().catch(() => {});
	};
	pc.onconnectionstatechange = () => {
		if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') handlers.onClosed(pc.connectionState);
	};

	const channel = pc.createDataChannel('oai-events');
	channel.onmessage = (e) => {
		let event: { type?: string; delta?: string; delegation?: { id?: string; target?: string }; reason?: string; error?: { message?: string } };
		try {
			event = JSON.parse(String(e.data));
		} catch {
			return;
		}
		switch (event.type) {
			case 'session.input_transcript.delta':
				heard.add(event.delta ?? '');
				handlers.onTranscript(heard.text());
				break;
			case 'session.delegation.created':
				if (event.delegation?.target !== 'client' || !event.delegation.id) return;
				handlers.onRequest({
					id: event.delegation.id,
					said: heard.take(),
					answer: (spoken) => {
						if (channel.readyState === 'open')
							channel.send(JSON.stringify({ type: 'session.commentary.append', delegation_id: event.delegation!.id, content: spoken }));
					},
				});
				break;
			case 'session.closed':
				closed = true;
				handlers.onClosed(event.reason ?? 'closed');
				break;
			case 'error':
				handlers.onError(event.error?.message ?? 'live error');
				break;
		}
	};

	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);

	const res = await fetch('/api/live/session', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ sdp: offer.sdp }),
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { reason?: string };
		close();
		throw new LiveUnavailable(body.reason ?? String(res.status));
	}
	const answer = (await res.json()) as { sdp: string };
	await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
	return { stream, close };
}
