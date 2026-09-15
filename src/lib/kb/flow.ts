import type { Entry, EntryLanguage } from './entry';

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

export type FlowState =
	| { view: View; phase: 'home'; greeting: boolean; notice?: 'nothing' }
	| { view: View; phase: 'arming' }
	| { view: View; phase: 'listening' }
	| { view: View; phase: 'searching'; topic: Area | null }
	| Results
	| { view: View; phase: 'confirm'; entry: Entry; back: Results }
	| { view: View; phase: 'steps'; entry: Entry; index: number; back: Results }
	| { view: View; phase: 'done'; entry: Entry; back: Results }
	| { view: View; phase: 'notfound'; heard: Heard }
	| { view: View; phase: 'denied'; reason: MicFailure }
	| { view: View; phase: 'offline' };

export type FlowEvent =
	| { type: 'PRESS' }
	| { type: 'GRANTED' }
	| { type: 'DENIED'; reason: MicFailure }
	| { type: 'STOP' }
	| { type: 'FAIL' }
	| { type: 'RESULTS'; result: SearchResult }
	| { type: 'GREETING' }
	/** No words: the silence gate gave up before speech, or the route heard none. */
	| { type: 'SILENCE' }
	| { type: 'NOTHING'; heard: Heard }
	| { type: 'TOPIC'; area: Area }
	| { type: 'OPEN'; id: string }
	| { type: 'VIEW'; view: View }
	| { type: 'MORE'; cards: Entry[]; nextOffset: number | null }
	| { type: 'START'; id: string }
	| { type: 'YES' }
	| { type: 'NO' }
	| { type: 'STEP_DONE' }
	| { type: 'BACK' }
	| { type: 'HOME' };

export function initial(view: View = 'grid'): FlowState {
	return { view, phase: 'home', greeting: false };
}

const CAN_SPEAK = new Set<FlowState['phase']>(['home', 'results', 'notfound', 'done', 'denied', 'offline', 'steps']);
const CAN_PICK_TOPIC = new Set<FlowState['phase']>(['home', 'results', 'notfound', 'done', 'offline']);

export function canSpeak(state: FlowState): boolean {
	return CAN_SPEAK.has(state.phase);
}

export function next(state: FlowState, event: FlowEvent): FlowState {
	const view = state.view;
	switch (event.type) {
		case 'PRESS':
			return canSpeak(state) ? { view, phase: 'arming' } : state;
		case 'GRANTED':
			return state.phase === 'arming' ? { view, phase: 'listening' } : state;
		case 'DENIED':
			return state.phase === 'arming' ? { view, phase: 'denied', reason: event.reason } : state;
		case 'STOP':
			return state.phase === 'listening' ? { view, phase: 'searching', topic: null } : state;
		case 'FAIL':
			return state.phase === 'searching' || state.phase === 'arming' ? { view, phase: 'offline' } : state;
		case 'RESULTS':
			return state.phase === 'searching' ? { view, phase: 'results', result: event.result, openId: null } : state;
		case 'GREETING':
			return state.phase === 'searching' ? { view, phase: 'home', greeting: true } : state;
		case 'SILENCE':
			return state.phase === 'listening' || state.phase === 'searching' ? { view, phase: 'home', greeting: false, notice: 'nothing' } : state;
		case 'NOTHING':
			return state.phase === 'searching' ? { view, phase: 'notfound', heard: event.heard } : state;
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
			return state.phase === 'confirm' ? { view, phase: 'steps', entry: state.entry, index: 0, back: state.back } : state;
		case 'NO':
			return state.phase === 'confirm' ? state.back : state;
		case 'STEP_DONE': {
			if (state.phase !== 'steps') return state;
			const last = (state.entry.steps?.length ?? 0) - 1;
			return state.index < last
				? { ...state, index: state.index + 1 }
				: { view, phase: 'done', entry: state.entry, back: state.back };
		}
		case 'BACK':
			return state.phase === 'confirm' || state.phase === 'steps' || state.phase === 'done' ? state.back : state;
		case 'HOME':
			return { view, phase: 'home', greeting: false };
	}
}
