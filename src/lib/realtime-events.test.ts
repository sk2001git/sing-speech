import { describe, expect, it } from 'vitest';
import {
	beginTurnEvents,
	finishTurnEvents,
	forgetItemsEvents,
	parseRealtimeEvent,
} from './realtime-events';

const ev = (o: unknown) => JSON.stringify(o);

describe('parseRealtimeEvent', () => {
	it('collects every item the conversation adds, under either event name', () => {
		expect(parseRealtimeEvent(ev({ type: 'conversation.item.added', item: { id: 'a' } }))).toEqual({
			kind: 'item',
			itemId: 'a',
		});
		expect(parseRealtimeEvent(ev({ type: 'conversation.item.created', item: { id: 'b' } }))).toEqual({
			kind: 'item',
			itemId: 'b',
		});
	});

	it('reads the input transcription', () => {
		const raw = ev({
			type: 'conversation.item.input_audio_transcription.completed',
			item_id: 'a',
			transcript: 'I need help',
		});
		expect(parseRealtimeEvent(raw)).toEqual({ kind: 'transcript', itemId: 'a', text: 'I need help' });
	});

	it('reads report_understanding from response.done', () => {
		const raw = ev({
			type: 'response.done',
			response: {
				status: 'completed',
				output: [
					{
						id: 'b',
						type: 'function_call',
						name: 'report_understanding',
						arguments: JSON.stringify({ intent: 'wayfinding' }),
					},
				],
			},
		});
		expect(parseRealtimeEvent(raw)).toEqual({
			kind: 'understanding',
			args: { intent: 'wayfinding' },
			itemIds: ['b'],
		});
	});

	it('fails a response that did not call the tool', () => {
		const raw = ev({ type: 'response.done', response: { status: 'completed', output: [{ id: 'c', type: 'message' }] } });
		expect(parseRealtimeEvent(raw)?.kind).toBe('failed');
	});

	it('fails on tool arguments that are not JSON', () => {
		const raw = ev({
			type: 'response.done',
			response: { output: [{ id: 'd', type: 'function_call', name: 'report_understanding', arguments: '{nope' }] },
		});
		expect(parseRealtimeEvent(raw)?.kind).toBe('failed');
	});

	it('surfaces a server error event', () => {
		expect(parseRealtimeEvent(ev({ type: 'error', error: { message: 'bad' } }))).toEqual({
			kind: 'failed',
			message: 'bad',
		});
	});

	it('ignores events it does not use, and junk it cannot parse', () => {
		expect(parseRealtimeEvent(ev({ type: 'session.created' }))).toBeNull();
		expect(parseRealtimeEvent('not json')).toBeNull();
	});
});

describe('turn events', () => {
	it('clears the input buffer when a turn begins', () => {
		expect(beginTurnEvents()).toEqual([{ type: 'input_audio_buffer.clear' }]);
	});

	it('sends earlier turns as text before committing the audio, then asks for a response', () => {
		const events = finishTurnEvents('Earlier: they wanted wayfinding.');
		expect(events.map((e) => e.type)).toEqual([
			'conversation.item.create',
			'input_audio_buffer.commit',
			'response.create',
		]);
		expect(events[0]).toMatchObject({
			item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Earlier: they wanted wayfinding.' }] },
		});
	});

	it('sends no preamble on the first turn', () => {
		expect(finishTurnEvents('').map((e) => e.type)).toEqual(['input_audio_buffer.commit', 'response.create']);
	});

	it('deletes every item of a finished turn, so audio enters the context once', () => {
		expect(forgetItemsEvents(['a', 'b'])).toEqual([
			{ type: 'conversation.item.delete', item_id: 'a' },
			{ type: 'conversation.item.delete', item_id: 'b' },
		]);
	});
});
