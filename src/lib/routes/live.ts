import type { EntryLanguage } from '../kb/entry';
import type { SearchResult } from '../kb/flow';
import { RouteUnavailable } from './types';

/**
 * GPT-Live: one continuous voice session that listens and speaks while our own code
 * answers (client delegation). The model decides when a turn ended, so this route needs
 * no silence gate, and it speaks in OpenAI's voice rather than the phone's.
 *
 * $0.05 a minute of session (checked 2026-09-16), so a session is opened on a tap and
 * closed when the person leaves the screen.
 */
export const LIVE_MODEL = 'gpt-live-1';

/** US English, feminine. The 12 built-in voices are English accents and Brazilian Portuguese. */
export const LIVE_VOICE = 'gleam';

export const LIVE_SESSIONS_URL = 'https://api.openai.com/v1/live/sessions';

export interface LiveOptions {
	voice?: string;
	model?: string;
	instructions?: string;
}

export function liveInstructions(): string {
	return [
		'You are Suara, a voice guide to official Singapore government answers for older people.',
		'Speak English only, slowly and warmly, in one or two short sentences. Never more.',
		'Delegate every request, question or follow-up to the application, however small, and wait for the result.',
		'Say only the answer the application returned. Never add facts, figures, eligibility rules or steps of your own, and never guess while you wait.',
		'If the application says an answer is not in Suara, say exactly that and suggest asking in another way.',
		'The cards on the screen carry the detail. Tell them the answers are on their screen instead of reading every one aloud.',
	].join(' ');
}

export function sessionBody(sdp: string, opts: LiveOptions) {
	return {
		session: {
			model: opts.model ?? LIVE_MODEL,
			instructions: opts.instructions ?? liveInstructions(),
			// Our own code answers: no second OpenAI model runs behind the voice.
			delegation: { type: 'client' as const },
			audio: { output: { voice: opts.voice ?? LIVE_VOICE } },
		},
		transport: { type: 'webrtc' as const, sdp },
	};
}

export interface LiveSession {
	id: string;
	sdp: string;
}

export async function createLiveSession(
	apiKey: string | undefined,
	sdp: string,
	opts: LiveOptions,
	fetchImpl: typeof fetch = fetch,
): Promise<LiveSession> {
	if (!apiKey) throw new RouteUnavailable('openai-live', 'missing-key', 'OPENAI_API_KEY is not set');
	const res = await fetchImpl(LIVE_SESSIONS_URL, {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(sessionBody(sdp, opts)),
		signal: AbortSignal.timeout(20_000),
	});
	const json = (await res.json().catch(() => ({}))) as {
		session?: { id?: string };
		transport?: { sdp?: string };
		error?: { code?: string; message?: string };
	};
	if (!res.ok) {
		const code = json.error?.code ?? '';
		if (res.status === 401 || code === 'invalid_api_key') throw new RouteUnavailable('openai-live', 'bad-key', 'OPENAI_API_KEY was rejected');
		if (code === 'insufficient_quota') throw new RouteUnavailable('openai-live', 'needs-top-up', 'the OpenAI balance needs a top-up');
		throw new RouteUnavailable('openai-live', res.status === 429 ? 'rate-limited' : 'vendor-error', `live session ${res.status}: ${json.error?.message ?? ''}`);
	}
	if (!json.session?.id || !json.transport?.sdp) throw new RouteUnavailable('openai-live', 'vendor-error', 'live session came back without an answer');
	return { id: json.session.id, sdp: json.transport.sdp };
}

/**
 * Transcript fragments arrive in delivery order with no turn-completed event, so the
 * application keeps the words itself and takes what is new when work is delegated.
 */
export class TranscriptBuffer {
	private parts: string[] = [];
	private taken = 0;

	add(delta: string): void {
		this.parts.push(delta);
	}

	text(): string {
		return this.parts.join('');
	}

	/** The words said since the last request, trimmed. */
	take(): string {
		const all = this.text();
		const fresh = all.slice(this.taken).trim();
		this.taken = all.length;
		return fresh;
	}
}

const LIMIT = 400;

/** What GPT-Live says aloud: one short line. Appends are capped at 500 tokens. */
export function commentaryFor(result: Pick<SearchResult, 'fit' | 'cards'>, language: EntryLanguage): string {
	const top = result.cards[0];
	if (!top) {
		return language === 'zh-Hans'
			? 'Suara 还没有这个答案。请换个说法再问一次。'
			: 'That is not in Suara yet. Ask again in another way.';
	}
	const lead = result.fit === 'weak' ? 'The closest I have is' : 'Here is the best match:';
	const steps = top.steps?.length ? ` It has ${top.steps.length} steps on the screen.` : '';
	const line = `${lead} ${top.title.full}. ${top.summary.text}${steps} The answers are on your screen.`;
	return line.length <= LIMIT ? line : `${line.slice(0, LIMIT - 1).trimEnd()}…`;
}
