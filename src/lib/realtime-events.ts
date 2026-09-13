/**
 * The OpenAI Realtime data channel, reduced to what suara uses.
 *
 * Pure on purpose: the WebRTC glue in `realtime.ts` cannot run under the test runner,
 * so every decision about what an event means lives here where it can be tested.
 * Event names checked 2026-09-13 against developers.openai.com Realtime client and
 * server event references.
 */

export const TOOL_NAME = 'report_understanding';

export type RealtimeSignal =
	/** Something entered the conversation. Collected so the turn can delete it after. */
	| { kind: 'item'; itemId: string }
	| { kind: 'transcript'; itemId: string; text: string }
	| { kind: 'understanding'; args: unknown; itemIds: string[] }
	| { kind: 'failed'; message: string };

export type ClientEvent =
	| { type: 'input_audio_buffer.clear' }
	| { type: 'input_audio_buffer.commit' }
	| { type: 'response.create' }
	| { type: 'conversation.item.delete'; item_id: string }
	| {
			type: 'conversation.item.create';
			item: { type: 'message'; role: 'user'; content: { type: 'input_text'; text: string }[] };
		};

interface WireEvent {
	type?: unknown;
	item?: { id?: unknown };
	item_id?: unknown;
	transcript?: unknown;
	response?: { status?: unknown; output?: unknown };
	error?: { message?: unknown };
}

interface WireOutput {
	id?: unknown;
	type?: unknown;
	name?: unknown;
	arguments?: unknown;
}

export function parseRealtimeEvent(raw: string): RealtimeSignal | null {
	let event: WireEvent;
	try {
		event = JSON.parse(raw) as WireEvent;
	} catch {
		return null;
	}
	if (!event || typeof event !== 'object') return null;

	switch (event.type) {
		// GA sends `added`; the beta sent `created`. Accepting both costs nothing.
		case 'conversation.item.added':
		case 'conversation.item.created':
			return typeof event.item?.id === 'string' ? { kind: 'item', itemId: event.item.id } : null;

		case 'conversation.item.input_audio_transcription.completed':
			return {
				kind: 'transcript',
				itemId: String(event.item_id ?? ''),
				text: String(event.transcript ?? ''),
			};

		case 'response.done': {
			const output = (Array.isArray(event.response?.output) ? event.response.output : []) as WireOutput[];
			const itemIds = output.map((o) => o?.id).filter((id): id is string => typeof id === 'string');
			const call = output.find((o) => o?.type === 'function_call' && o?.name === TOOL_NAME);
			if (!call || typeof call.arguments !== 'string') {
				return {
					kind: 'failed',
					message: `response ${String(event.response?.status ?? 'done')} without ${TOOL_NAME}`,
				};
			}
			try {
				return { kind: 'understanding', args: JSON.parse(call.arguments), itemIds };
			} catch {
				return { kind: 'failed', message: `${TOOL_NAME} arguments were not JSON` };
			}
		}

		case 'error':
			return { kind: 'failed', message: String(event.error?.message ?? 'realtime error') };

		default:
			return null;
	}
}

/** Pressed: throw away anything the open track sent while nobody was speaking. */
export function beginTurnEvents(): ClientEvent[] {
	return [{ type: 'input_audio_buffer.clear' }];
}

/**
 * Finished: earlier turns as text, then the audio, then ask for the answer.
 *
 * The preamble goes in before the commit so the conversation reads in order. Earlier
 * turns travel as text, never as their audio — the same rule `gemini.ts` follows.
 */
export function finishTurnEvents(preamble: string): ClientEvent[] {
	const events: ClientEvent[] = [];
	if (preamble) {
		events.push({
			type: 'conversation.item.create',
			item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: preamble }] },
		});
	}
	events.push({ type: 'input_audio_buffer.commit' }, { type: 'response.create' });
	return events;
}

/**
 * After the answer: delete everything the turn added.
 *
 * A realtime session otherwise keeps every prior turn's audio in context and bills it
 * again on each response, which is the cost multiplication the README forbids.
 */
export function forgetItemsEvents(ids: readonly string[]): ClientEvent[] {
	return ids.map((id) => ({ type: 'conversation.item.delete', item_id: id }));
}
