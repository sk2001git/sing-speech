import { describe, expect, it, vi } from 'vitest';
import { resolveBody, resolveQuestion, type Turn } from './thread';

/**
 * A correction is a turn in a conversation, marked as one (owner, 2026-09-27: "a correction
 * disclaimer to overwrite the previous, so that any ai seeing it is able to deal with it
 * accordingly. Like how we have 'user' correction. use json idea here").
 */
const turns: Turn[] = [
	{ role: 'user', kind: 'speech', said: 'How long do I wait at Tantok Seng A and E?' },
	{ role: 'user', kind: 'text', said: 'not Tan Tock Seng, Changi', correction: true },
];
const hearing = {
	greeting: false,
	meaning_en: 'How long is the wait at Changi General Hospital A&E?',
	short: 'Changi A&E wait',
	sentence: 'You want to know how long the wait is at Changi General A&E.',
	language: 'en',
	confidence: 0.9,
};

describe('resolveBody', () => {
	it('sends the thread as JSON, oldest first, the correction marked, to gpt-6-luna with a strict schema', () => {
		const body = resolveBody(turns);
		expect(body.model).toBe('gpt-6-luna');
		expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
		const sent = JSON.parse(body.input[1]!.content);
		expect(sent).toEqual({ turns });
		expect(body.input[0]!.content).toMatch(/"correction": true/);
		expect(body.input[0]!.content).toMatch(/replaces/i);
	});
});

describe('a question asked about a step of a guide', () => {
	const step = { guide: 'GPFirst: paying less at the emergency department', step: 3, of: 5, name: 'Go to A&E the same day', points: ['Go on the day the form was given.', 'Given between 10pm and midnight? You can go until 2am.'] };
	const asked: Turn[] = [{ role: 'user', kind: 'speech', said: 'which hospital ah?' }];

	it('sends the step with the question, marked as what they were reading', () => {
		const body = resolveBody(asked, undefined, step);
		expect(JSON.parse(body.input[1]!.content)).toEqual({ context: step, turns: asked });
		const system = body.input[0]!.content;
		expect(system).toMatch(/"context"/);
		expect(system).toMatch(/stand(s)? on its own|standalone/i);
		expect(system).toMatch(/not facts to answer from|never an answer/i);
	});

	it('sends no context when there is none, so an ordinary question is unchanged', () => {
		expect(JSON.parse(resolveBody(asked).input[1]!.content)).toEqual({ turns: asked });
	});
});

describe('resolveQuestion', () => {
	it('returns the one question the person means now', async () => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(hearing) }] }] })));
		const h = await resolveQuestion(turns, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
		expect(h.meaning_en).toBe('How long is the wait at Changi General Hospital A&E?');
		expect(h.said).toBe('not Tan Tock Seng, Changi');
	});

	it('falls back to the correction as written when the model cannot be reached', async () => {
		const fetchImpl = vi.fn(async () => new Response('down', { status: 503 }));
		const h = await resolveQuestion(turns, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
		expect(h).toMatchObject({ meaning_en: 'not Tan Tock Seng, Changi', sentence: 'not Tan Tock Seng, Changi', said: 'not Tan Tock Seng, Changi' });
	});
});
