import type { Entry, EntryLanguage } from './entry';
import type { Journey } from './journey';
import type { Place, PlaceKind } from '../places/places';
import type { WebAnswer, WebStage } from './web-answer';
import type { EdWaitChart } from '../charts/ed-wait-source';

/**
 * The knowledge-base screens as one value, following the approved UX flows
 * (vault spec-suara-0005) and canvas (spec-suara-0006).
 *
 * Total, like `session.ts`: an event a phase does not handle returns the same state
 * object. The microphone, the network and speech all report late, and a late event must
 * never move a person off the screen they are reading.
 */
export type Area = Entry['topic']['area'];
export type View = 'grid' | 'single';
export type MicFailure = 'permission' | 'no-device' | 'insecure';

export interface Heard {
	/** One line for the "You asked" row, in the reader's language. */
	short: string;
	/** What Suara understood, as a sentence, shown when the row is opened. */
	sentence: string;
	/** What they said, word for word, when the route has it. Shown open. */
	said?: string;
	/** The question was corrected: `sentence` is the corrected question, from the whole thread. */
	corrected?: true;
	/** Asked about a step of a guide: which one (vault plan-suara-0020, C2). */
	about?: { step: number; name: string };
}

export interface SearchResult {
	heard: Heard;
	fit: 'strong' | 'weak' | 'topic';
	cards: Entry[];
	nextOffset: number | null;
	/** The English meaning that was searched, reused to load the next page. */
	query: string;
	language: EntryLanguage;
}

type Results = { view: View; phase: 'results'; result: SearchResult; openId: string | null };

/**
 * A life event, and how far through it they are.
 *
 * `done` is the person's own word for it — Suara never decides that a stage is finished,
 * because being wrong means a missed legal deadline. It is held on the device and nowhere
 * else (vault plan-suara-0010).
 */
export interface JourneyResult {
	heard: Heard;
	journey: Journey;
	cards: Entry[];
	language: EntryLanguage;
}

type JourneyPhase = { view: View; phase: 'journey'; result: JourneyResult; done: string[] };

/** Addresses from open data: a different kind of answer, so a different screen. */
export interface PlacesResult {
	heard: Heard;
	places: Place[];
	what: PlaceKind;
	area: string;
	source: {
		datasetId: string;
		kind: string;
		name: string;
		agency: string;
		lastUpdatedAt: string;
		url: string;
		licence: string;
		fetchedAt: string;
	};
	language: EntryLanguage;
}

/**
 * An answer from the web, when nothing in Suara had one (vault plan
 * suara-2026-09-25-feature-web-steps). Shaped like the other results, with `language`, so the
 * screens behind it can find the reader's language the same way.
 */
export interface WebResult {
	heard: Heard;
	answer: WebAnswer;
	language: EntryLanguage;
	/** Kept from an earlier search: when the web found it. */
	foundAt?: string;
}

/** `from`: the closest answers they chose to look past, so Back returns to them. */
type WebPhase = { view: View; phase: 'web'; result: WebResult; from?: Results };

/** A chart Suara draws from government figures (vault plan-suara-0017). */
export interface ChartResult {
	chart: 'ed-wait';
	heard: Heard;
	data: EdWaitChart;
	/** The hospital the question named, highlighted; null for none. */
	focus: string | null;
	language: EntryLanguage;
}

type Phase =
	| { view: View; phase: 'home'; greeting: boolean; notice?: 'nothing' }
	| { view: View; phase: 'arming' }
	| { view: View; phase: 'listening' }
	/** `said`: their words, shown as soon as they are heard, before the answer (plan-suara-0021, L2). */
	| { view: View; phase: 'searching'; topic: Area | null; said?: string }
	| Results
	| JourneyPhase
	| { view: View; phase: 'places'; result: PlacesResult }
	| { view: View; phase: 'chart'; result: ChartResult }
	| { view: View; phase: 'confirm'; entry: Entry; back: Results }
	/** `reached`: the furthest step they got to; every step before it is cleared (the step count when all are). */
	| { view: View; phase: 'steps'; entry: Entry; index: number; reached?: number; back: Results }
	| { view: View; phase: 'done'; entry: Entry; back: Results }
	| { view: View; phase: 'web-searching'; heard: Heard; language: EntryLanguage; stage: WebStage | null; pages: number; from?: Results }
	| WebPhase
	| { view: View; phase: 'web-confirm'; back: WebPhase }
	| { view: View; phase: 'web-steps'; index: number; reached?: number; back: WebPhase }
	| { view: View; phase: 'web-done'; back: WebPhase }
	/** `web`: the web was searched too, and had no reliable answer either. */
	| { view: View; phase: 'notfound'; heard: Heard; web?: true }
	| { view: View; phase: 'denied'; reason: MicFailure }
	/** `held`: the guard refused it (plan-suara-0021): the day's budget, this visitor's, or too fast. */
	| { view: View; phase: 'offline'; held?: Held };

/** A guide, Suara's or the web's, on the step the person was on. */
export type GuideState = Extract<Phase, { phase: 'steps' | 'web-steps' }>;

/**
 * `guide`: the guide they left to ask a question, from "Ask about this step" or "Ask something
 * else". It rides along through the question and its answer, so Back returns to the same step
 * with the stages cleared still cleared (vault plan-suara-0020, C3 and C5).
 */
export type FlowState = Phase & { guide?: GuideState };

/** Why the guard said no: the whole day's budget is spent, this visitor's is, or they are going too fast. */
export type Held = 'resting' | 'enough' | 'busy';

export type FlowEvent =
	| { type: 'PRESS' }
	| { type: 'GRANTED' }
	| { type: 'DENIED'; reason: MicFailure }
	| { type: 'STOP' }
	/** Their words are heard; the answer is still being found. */
	| { type: 'HEARD'; said: string }
	| { type: 'FAIL'; held?: Held }
	| { type: 'RESULTS'; result: SearchResult }
	| { type: 'GREETING' }
	/** No words: the silence gate gave up before speech, or the route heard none. */
	| { type: 'SILENCE' }
	/** A live session asked us a question: it can come while they are anywhere. */
	/** A question is on its way, however it was asked: spoken live, or found by typing. */
	| { type: 'ASKING' }
	| { type: 'NOTHING'; heard: Heard }
	| { type: 'PLACES'; result: PlacesResult }
	| { type: 'JOURNEY'; result: JourneyResult }
	/** The person says a stage is finished, or takes it back. */
	| { type: 'STAGE_DONE'; id: string }
	| { type: 'STAGE_UNDONE'; id: string }
	/** Open one stage's cards, keeping the journey to come back to. */
	| { type: 'STAGE_CARDS'; id: string }
	| { type: 'TOPIC'; area: Area }
	| { type: 'OPEN'; id: string }
	| { type: 'VIEW'; view: View }
	| { type: 'MORE'; cards: Entry[]; nextOffset: number | null }
	| { type: 'START'; id: string }
	| { type: 'YES' }
	| { type: 'NO' }
	| { type: 'STEP_DONE' }
	/** In a guide: one step back; from the first step it leaves, from the end it reopens the last. */
	| { type: 'STEP_BACK' }
	/** In a guide, after going back: forward to a step already cleared, without clearing it again. */
	| { type: 'STEP_NEXT' }
	/** At the end of a guide: through it again from step 1. */
	| { type: 'STEPS_AGAIN' }
	| { type: 'BACK' }
	| { type: 'HOME' }
	/** Nothing in Suara: search the web instead (OpenAI routes only; the driver decides). */
	| { type: 'WEB_SEARCH'; heard: Heard; language: EntryLanguage }
	| { type: 'WEB_STAGE'; stage: WebStage }
	| { type: 'WEB_ANSWER'; answer: WebAnswer; foundAt?: string }
	| { type: 'WEB_START' }
	| { type: 'CHART'; result: ChartResult };

export function initial(view: View = 'grid'): FlowState {
	return { view, phase: 'home', greeting: false };
}

// 'web-searching': a mishearing can be corrected by voice while the web search runs (it is cancelled).
const CAN_SPEAK = new Set<FlowState['phase']>(['home', 'results', 'places', 'chart', 'notfound', 'done', 'denied', 'offline', 'steps', 'web', 'web-searching', 'web-steps', 'web-done']);
const CAN_PICK_TOPIC = new Set<FlowState['phase']>(['home', 'results', 'places', 'chart', 'notfound', 'done', 'offline', 'web', 'web-done']);

export function canSpeak(state: FlowState): boolean {
	return CAN_SPEAK.has(state.phase);
}

/** Where a question and its answer live: a guide left for a question is kept through these. */
const ASKING_PHASES = new Set<FlowState['phase']>(['arming', 'listening', 'searching', 'results', 'places', 'chart', 'journey', 'web-searching', 'web', 'notfound', 'denied', 'offline']);

export function next(state: FlowState, event: FlowEvent): FlowState {
	// Only a question starts the ride: Back or Home out of a guide leaves it behind.
	const onGuide = state.phase === 'steps' || state.phase === 'web-steps';
	const guide = onGuide ? (event.type === 'PRESS' || event.type === 'ASKING' ? state : undefined) : state.guide;
	const out = advance(state, event);
	if (!guide || event.type === 'HOME') return out;
	// Back from an answer with nowhere else to go, or nothing said: the step they left.
	if (event.type === 'BACK' && out === state && state.guide) return state.guide;
	if (event.type === 'SILENCE' && out.phase === 'home' && state.guide) return state.guide;
	return ASKING_PHASES.has(out.phase) && !out.guide ? { ...out, guide } : out;
}

function advance(state: FlowState, event: FlowEvent): FlowState {
	const view = state.view;
	switch (event.type) {
		case 'PRESS':
			return canSpeak(state) ? { view, phase: 'arming' } : state;
		case 'GRANTED':
			return state.phase === 'arming' ? { view, phase: 'listening' } : state;
		case 'DENIED':
			return state.phase === 'arming' ? { view, phase: 'denied', reason: event.reason } : state;
		case 'HEARD':
			return state.phase === 'searching' ? { ...state, said: event.said } : state;
		case 'STOP':
			return state.phase === 'listening' ? { view, phase: 'searching', topic: null } : state;
		case 'FAIL':
			return state.phase === 'searching' || state.phase === 'arming' ? { view, phase: 'offline', ...(event.held ? { held: event.held } : {}) } : state;
		case 'RESULTS':
			return state.phase === 'searching' ? { view, phase: 'results', result: event.result, openId: null } : state;
		case 'GREETING':
			return state.phase === 'searching' ? { view, phase: 'home', greeting: true } : state;
		case 'ASKING':
			return { view, phase: 'searching', topic: null };
		case 'SILENCE':
			return state.phase === 'listening' || state.phase === 'searching' ? { view, phase: 'home', greeting: false, notice: 'nothing' } : state;
		case 'JOURNEY':
			return { view, phase: 'journey', result: event.result, done: [] };
		case 'STAGE_DONE':
			return state.phase === 'journey' && !state.done.includes(event.id)
				? { ...state, done: [...state.done, event.id] }
				: state;
		case 'STAGE_UNDONE':
			return state.phase === 'journey' ? { ...state, done: state.done.filter((id) => id !== event.id) } : state;
		case 'STAGE_CARDS': {
			if (state.phase !== 'journey') return state;
			const stage = state.result.journey.stages.find((s) => s.id === event.id);
			if (!stage) return state;
			const cards = stage.cards
				.map((id) => state.result.cards.find((card) => card.id === id))
				.filter((card): card is Entry => card !== undefined);
			if (cards.length === 0) return state;
			return {
				view,
				phase: 'results',
				result: {
					heard: { short: stage.name, sentence: stage.note ?? stage.name },
					fit: 'topic',
					cards,
					nextOffset: null,
					query: stage.name,
					language: state.result.language,
				},
				openId: cards[0]!.id,
			};
		}
		case 'PLACES':
			return state.phase === 'searching' ? { view, phase: 'places', result: event.result } : state;
		case 'CHART':
			return state.phase === 'searching' ? { view, phase: 'chart', result: event.result } : state;
		case 'NOTHING':
			if (state.phase === 'web-searching' && state.from) return state.from;
			return state.phase === 'searching' || state.phase === 'web-searching' ? { view, phase: 'notfound', heard: event.heard } : state;
		case 'WEB_SEARCH':
			if (state.phase === 'searching') return { view, phase: 'web-searching', heard: event.heard, language: event.language, stage: null, pages: 0 };
			// From the closest answers, when they ask for more than a weak match.
			return state.phase === 'results' && state.result.fit === 'weak'
				? { view, phase: 'web-searching', heard: event.heard, language: event.language, stage: null, pages: 0, from: state }
				: state;
		case 'WEB_STAGE':
			if (state.phase !== 'web-searching') return state;
			// The page count stays shown once writing starts.
			return { ...state, stage: event.stage, pages: event.stage.stage === 'reading' ? event.stage.pages : state.pages };
		case 'WEB_ANSWER':
			if (state.phase !== 'web-searching') return state;
			if (event.answer.kind === 'none' && state.from) return state.from;
			return event.answer.kind === 'none'
				? { view, phase: 'notfound', heard: state.heard, web: true }
				: { view, phase: 'web', result: { heard: state.heard, answer: event.answer, language: state.language, ...(event.foundAt ? { foundAt: event.foundAt } : {}) }, ...(state.from ? { from: state.from } : {}) };
		case 'WEB_START':
			return state.phase === 'web' && state.result.answer.kind === 'steps' && state.result.answer.steps.length > 0
				? { view, phase: 'web-confirm', back: state }
				: state;
		case 'TOPIC':
			return CAN_PICK_TOPIC.has(state.phase) ? { view, phase: 'searching', topic: event.area } : state;
		case 'OPEN':
			return state.phase === 'results' ? { ...state, openId: state.openId === event.id ? null : event.id } : state;
		case 'VIEW':
			return { ...state, view: event.view };
		case 'MORE': {
			if (state.phase !== 'results') return state;
			const shown = new Set(state.result.cards.map((c) => c.id));
			const added = event.cards.filter((c) => !shown.has(c.id));
			return { ...state, result: { ...state.result, cards: [...state.result.cards, ...added], nextOffset: event.nextOffset } };
		}
		case 'START': {
			if (state.phase !== 'results') return state;
			const entry = state.result.cards.find((c) => c.id === event.id);
			return entry?.kind === 'process' && entry.steps?.length ? { view, phase: 'confirm', entry, back: state } : state;
		}
		case 'YES':
			if (state.phase === 'web-confirm') return { view, phase: 'web-steps', index: 0, back: state.back };
			return state.phase === 'confirm' ? { view, phase: 'steps', entry: state.entry, index: 0, back: state.back } : state;
		case 'NO':
			return state.phase === 'confirm' || state.phase === 'web-confirm' ? state.back : state;
		case 'STEP_DONE': {
			if (state.phase !== 'steps' && state.phase !== 'web-steps') return state;
			const reached = Math.max(state.reached ?? state.index, state.index + 1);
			if (state.phase === 'web-steps') {
				const last = state.back.result.answer.steps.length - 1;
				return state.index < last ? { ...state, index: state.index + 1, reached } : { view, phase: 'web-done', back: state.back };
			}
			const last = (state.entry.steps?.length ?? 0) - 1;
			return state.index < last
				? { ...state, index: state.index + 1, reached }
				: { view, phase: 'done', entry: state.entry, back: state.back };
		}
		case 'STEP_NEXT': {
			if (state.phase !== 'steps' && state.phase !== 'web-steps') return state;
			if (state.index >= (state.reached ?? state.index)) return state;
			const n = state.phase === 'steps' ? (state.entry.steps?.length ?? 0) : state.back.result.answer.steps.length;
			if (state.index + 1 < n) return { ...state, index: state.index + 1 };
			return state.phase === 'steps' ? { view, phase: 'done', entry: state.entry, back: state.back } : { view, phase: 'web-done', back: state.back };
		}
		case 'STEP_BACK':
			if (state.phase === 'steps' || state.phase === 'web-steps') return state.index > 0 ? { ...state, index: state.index - 1 } : state.back;
			if (state.phase === 'done') {
				const n = state.entry.steps?.length ?? 1;
				return { view, phase: 'steps', entry: state.entry, index: n - 1, reached: n, back: state.back };
			}
			if (state.phase === 'web-done') {
				const n = state.back.result.answer.steps.length;
				return { view, phase: 'web-steps', index: n - 1, reached: n, back: state.back };
			}
			return state;
		case 'STEPS_AGAIN':
			if (state.phase === 'done') return { view, phase: 'steps', entry: state.entry, index: 0, back: state.back };
			if (state.phase === 'web-done') return { view, phase: 'web-steps', index: 0, back: state.back };
			return state;
		case 'BACK':
			if (state.phase === 'web') return state.from ?? state;
			return state.phase === 'confirm' || state.phase === 'steps' || state.phase === 'done' || state.phase === 'web-confirm' || state.phase === 'web-steps' || state.phase === 'web-done'
				? state.back
				: state;
		case 'HOME':
			return { view, phase: 'home', greeting: false };
	}
}
