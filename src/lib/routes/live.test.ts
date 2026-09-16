import { describe, expect, it } from 'vitest';
import { commentaryFor, createLiveSession, liveInstructions, LIVE_VOICE, sessionBody, TranscriptBuffer } from './live';

const card = (id: string, title: string, summary: string, steps = 0) =>
	({ id, title: { short: title.slice(0, 16), full: title }, summary: { text: summary }, steps: steps ? Array(steps).fill({}) : undefined }) as any;

describe('sessionBody', () => {
	it('asks for GPT-Live with a US English voice and client delegation', () => {
		const body = sessionBody('v=0 offer', {});
		expect(body).toMatchObject({
			session: { model: 'gpt-live-1', delegation: { type: 'client' }, audio: { output: { voice: 'gleam' } } },
			transport: { type: 'webrtc', sdp: 'v=0 offer' },
		});
		expect(LIVE_VOICE).toBe('gleam');
	});

	it('takes a different voice and model from configuration', () => {
		const body = sessionBody('x', { voice: 'meridian', model: 'gpt-live-2' });
		expect(body.session.audio.output.voice).toBe('meridian');
		expect(body.session.model).toBe('gpt-live-2');
	});
});

describe('liveInstructions', () => {
	const text = liveInstructions();

	it('keeps answers short and in English', () => {
		expect(text).toMatch(/one or two short sentences/i);
		expect(text).toMatch(/English/);
	});

	it('tells the model to delegate every request and to speak only what comes back', () => {
		expect(text).toMatch(/delegate/i);
		expect(text).toMatch(/only.*(what|the answer).*(sent|returned|given)/i);
	});

	it('never offers a person, since Suara is a knowledge base', () => {
		expect(text).not.toMatch(/helpline|transfer|human agent/i);
	});
});

describe('createLiveSession', () => {
	it('posts the offer to OpenAI and returns the session id and answer', async () => {
		const calls: { url: string; body: any; auth?: string }[] = [];
		const fetchImpl = (async (url: string, init: RequestInit) => {
			calls.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
			return new Response(JSON.stringify({ session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'v=0 answer' } }), { status: 201 });
		}) as unknown as typeof fetch;

		expect(await createLiveSession('sk', 'v=0 offer', {}, fetchImpl)).toEqual({ id: 'live_1', sdp: 'v=0 answer' });
		expect(calls[0]!.url).toBe('https://api.openai.com/v1/live/sessions');
		expect(calls[0]!.auth).toBe('Bearer sk');
	});

	it('reports a missing key and an empty balance by reason', async () => {
		await expect(createLiveSession(undefined, 'x', {})).rejects.toMatchObject({ reason: 'missing-key' });
		const fetchImpl = (async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 })) as unknown as typeof fetch;
		await expect(createLiveSession('sk', 'x', {}, fetchImpl)).rejects.toMatchObject({ reason: 'needs-top-up' });
	});
});

describe('TranscriptBuffer', () => {
	it('joins fragments in delivery order', () => {
		const buffer = new TranscriptBuffer();
		buffer.add('I forgot ');
		buffer.add('my Singpass ');
		buffer.add('password');
		expect(buffer.text()).toBe('I forgot my Singpass password');
	});

	it('gives each request only the words said since the last one', () => {
		const buffer = new TranscriptBuffer();
		buffer.add('I forgot my Singpass password');
		expect(buffer.take()).toBe('I forgot my Singpass password');
		expect(buffer.take()).toBe('');
		buffer.add('and how do I check my CPF');
		expect(buffer.take()).toBe('and how do I check my CPF');
	});
});

describe('commentaryFor', () => {
	const result = {
		fit: 'strong' as const,
		cards: [card('a', 'Changing or resetting your Singpass password', 'On the Singpass website, select Log in, then Reset password under Services.', 4), card('b', 'Second', 'x')],
	};

	it('speaks the best answer in one short line, and says the cards are on screen', () => {
		const said = commentaryFor(result as any, 'en');
		expect(said).toContain('Changing or resetting your Singpass password');
		expect(said).toMatch(/on your screen|on screen/i);
		expect(said.split(/\s+/).length).toBeLessThanOrEqual(45);
	});

	it('says it is only the closest when the match is weak', () => {
		expect(commentaryFor({ ...result, fit: 'weak' } as any, 'en')).toMatch(/closest/i);
	});

	it('says plainly when there is nothing', () => {
		expect(commentaryFor({ fit: 'strong', cards: [] } as any, 'en')).toMatch(/not in Suara yet/i);
	});

	it('never runs past the 500-token append limit, whatever the card says', () => {
		const long = card('c', 'x'.repeat(60), 'y'.repeat(140), 5);
		expect(commentaryFor({ fit: 'strong', cards: [long] } as any, 'en').length).toBeLessThanOrEqual(400);
	});
});
