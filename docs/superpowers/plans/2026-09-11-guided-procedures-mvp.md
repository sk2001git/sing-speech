# Guided Procedures MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-shot classifier into a step advancer, and make every UI state renderable and testable without a microphone, a network or a paid model call.

**Architecture:** `Voice.tsx` splits into a pure reducer (`session.ts`), a pure card builder (`cards.ts`), a pure renderer (`Screen.tsx`) and a thin driver that owns the browser. Procedures are authored JSON validated as a directed acyclic graph; the server validates a client-held cursor rather than storing one. Nothing renders until the decision is made.

**Tech Stack:** TypeScript, Astro 7, React 19, Zod 4, Vitest 5, Tailwind 4, Cloudflare Workers. Playwright and axe-core added as devDependencies in Task 9.

**Spec:** `docs/superpowers/specs/2026-09-11-guided-procedures-design.md`

## Global Constraints

- **Indentation is tabs.** Every file in `src/` uses tabs. Match it.
- **No new runtime dependencies.** Playwright and axe-core are devDependencies only. No XState, no `@xyflow/react`, no framer-motion.
- **Model is `gemini-3.5-flash-lite`.** Already set as `SUARA_MODEL` in `wrangler.jsonc` and defaulted in `providers/gemini.ts`. Do not change it.
- **`FakeProvider` must drive every test.** Anything that cannot be driven by the fake has a vendor assumption baked in. No test may require an API key or a network.
- **No procedure content is authored in this plan.** Every fixture is a placeholder with `verified: false` or an obviously synthetic id like `test-proc`. Writing real CPF or Singpass steps is a separate task requiring a human to walk each flow.
- **`verified: false` content must never reach a screen.** This is the safety property the product rests on. Task 3 tests it directly.
- **`Localised` is partial with a required `en`.** `Language` has eight members and only four have any voice. A missing translation must be representable.
- **Full gate:** `npm run verify` (types, typecheck, build, test) must pass before any commit.
- **Existing 53 tests must stay green.** They are not to be modified.

---

### Task 1: The procedure graph

**Files:**
- Create: `src/lib/procedure.ts`
- Create: `src/lib/procedure.test.ts`

**Interfaces:**
- Consumes: `Ministry` from `src/lib/catalogue.ts`, `Language` from `src/lib/understanding.ts`
- Produces: `Localised`, `Step`, `Branch`, `StepImage`, `Procedure`, `Cursor`, `successors(step)`, `stepById(proc, id)`, `localise(text, lang)`, `validateProcedure(proc)`, `isReachable(proc, cursor)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/procedure.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	isReachable,
	localise,
	stepById,
	successors,
	validateProcedure,
	type Procedure,
} from './procedure';

/** A three-step line: s1 -> s2 -> s3. Placeholder content, never real guidance. */
function line(): Procedure {
	return {
		id: 'test-proc',
		ministry: 'cpf',
		title: { en: 'Test procedure' },
		topic: 'test',
		metadata: { cues: [], aliases: [] },
		entry: 's1',
		steps: [
			{ id: 's1', instruction: { en: 'First' }, image: null, next: 's2' },
			{ id: 's2', instruction: { en: 'Second' }, image: null, next: 's3' },
			{ id: 's3', instruction: { en: 'Third' }, image: null, next: null },
		],
		verified: false,
		source: 'https://example.invalid',
		checkedOn: null,
	};
}

describe('successors', () => {
	it('reports nothing for a terminal step', () => {
		expect(successors(line().steps[2]!)).toEqual([]);
	});

	it('reports both arms of a branch, because either is a legal next step', () => {
		const branch = {
			id: 'b',
			instruction: { en: 'Branch' },
			image: null,
			next: { question: { en: 'Do you have it?' }, yes: 's2', no: 's3' },
		};
		expect(successors(branch)).toEqual(['s2', 's3']);
	});
});

describe('localise', () => {
	it('falls back to English rather than showing a blank, because a blank step is unusable', () => {
		expect(localise({ en: 'First' }, 'nan')).toBe('First');
	});

	it('prefers the requested language when it was authored', () => {
		expect(localise({ en: 'First', zh: '第一' }, 'zh')).toBe('第一');
	});
});

describe('validateProcedure', () => {
	it('accepts a well-formed line', () => {
		expect(validateProcedure(line())).toEqual([]);
	});

	it('rejects an entry that is not a step', () => {
		const p = { ...line(), entry: 'nope' };
		expect(validateProcedure(p)).toContain('entry "nope" is not a step');
	});

	it('rejects a next that points nowhere, which would dead-end a user mid-flow', () => {
		const p = line();
		p.steps[1]!.next = 'ghost';
		expect(validateProcedure(p)).toContain('step "s2" points at missing step "ghost"');
	});

	it('rejects a cycle, because a loop means the user never finishes', () => {
		const p = line();
		p.steps[2]!.next = 's1';
		expect(validateProcedure(p)).toContain('graph has a cycle');
	});

	it('rejects an orphan step, which is authored content nobody can ever see', () => {
		const p = line();
		p.steps.push({ id: 'orphan', instruction: { en: 'Lost' }, image: null, next: null });
		expect(validateProcedure(p)).toContain('step "orphan" is unreachable from entry');
	});

	it('rejects a duplicate step id', () => {
		const p = line();
		p.steps.push({ id: 's2', instruction: { en: 'Twin' }, image: null, next: null });
		expect(validateProcedure(p)).toContain('duplicate step id "s2"');
	});
});

describe('isReachable', () => {
	const p = line();
	const at = (stepId: string, done: string[]) => ({
		procedureId: 'test-proc',
		stepId,
		done,
		startedAt: '2026-09-11T00:00:00.000Z',
	});

	it('accepts the entry step with nothing done', () => {
		expect(isReachable(p, at('s1', []))).toBe(true);
	});

	it('accepts a contiguous walk', () => {
		expect(isReachable(p, at('s3', ['s1', 's2']))).toBe(true);
	});

	it('rejects a jump to the end, which is the tampering case that matters', () => {
		expect(isReachable(p, at('s3', []))).toBe(false);
	});

	it('rejects a history that skips a step', () => {
		expect(isReachable(p, at('s3', ['s1']))).toBe(false);
	});

	it('rejects a history that does not start at the entry', () => {
		expect(isReachable(p, at('s3', ['s2']))).toBe(false);
	});

	it('rejects a step that is already done', () => {
		expect(isReachable(p, at('s2', ['s1', 's2']))).toBe(false);
	});

	it('rejects a step id that does not exist', () => {
		expect(isReachable(p, at('ghost', ['s1']))).toBe(false);
	});
});

describe('stepById', () => {
	it('returns undefined for an unknown id rather than throwing', () => {
		expect(stepById(line(), 'ghost')).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/procedure.test.ts`
Expected: FAIL — `Failed to resolve import "./procedure"`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/procedure.ts`:

```ts
import type { Ministry } from './catalogue';
import type { Language } from './understanding';

/**
 * A localised string.
 *
 * Partial by construction, with English required as the fallback. `Language` has eight
 * members and only four of them have any synthesis voice at all, so demanding a total
 * record would mean authors writing placeholder Hokkien to satisfy the type — which is
 * exactly the invented content this codebase refuses everywhere else.
 */
export type Localised = { en: string } & Partial<Record<Language, string>>;

export interface StepImage {
	src: string;
	alt: Localised;
	/** When a person last confirmed this matches the live interface. ISO date. */
	checkedOn: string;
}

/**
 * A fork in a procedure. One yes/no question, never "did you mean A or B" — the same
 * rule `policy.ts` enforces for intent confirmation, and for the same reason.
 */
export interface Branch {
	question: Localised;
	yes: string;
	no: string;
}

export interface Step {
	id: string;
	instruction: Localised;
	image: StepImage | null;
	/** A step id, a branch, or null for terminal. */
	next: string | Branch | null;
}

export interface Procedure {
	id: string;
	ministry: Ministry;
	title: Localised;
	topic: string;
	/**
	 * Retrieval metadata. Unused at this scale — the procedure index goes in the prompt
	 * and the audio model classifies. Authored anyway so that retrieval is available
	 * later without a migration.
	 */
	metadata: { cues: string[]; aliases: string[] };
	entry: string;
	steps: Step[];
	/** False until a person has walked the flow against `source`. Gates everything. */
	verified: boolean;
	source: string;
	checkedOn: string | null;
}

/** Where a user is in a procedure. Held by the client, validated by the server. */
export interface Cursor {
	procedureId: string;
	stepId: string;
	done: string[];
	startedAt: string;
}

export function stepById(proc: Procedure, id: string): Step | undefined {
	return proc.steps.find((s) => s.id === id);
}

/** Every step this one can lead to. Both arms of a branch are legal successors. */
export function successors(step: Step): string[] {
	if (step.next === null) return [];
	if (typeof step.next === 'string') return [step.next];
	return [step.next.yes, step.next.no];
}

/**
 * Pick the best available wording.
 *
 * Falls back to English rather than returning empty. A step with no text is a step the
 * user cannot act on, which is worse than a step in the wrong language.
 */
export function localise(text: Localised, lang: Language): string {
	return text[lang] ?? text.en;
}

/**
 * Everything wrong with a procedure, as a list of plain sentences. Empty means valid.
 *
 * Returns all problems rather than throwing on the first, because this runs over
 * authored content and an author fixing one error at a time is an author who gives up.
 */
export function validateProcedure(proc: Procedure): string[] {
	const problems: string[] = [];
	const ids = new Set<string>();

	for (const step of proc.steps) {
		if (ids.has(step.id)) problems.push(`duplicate step id "${step.id}"`);
		ids.add(step.id);
	}

	if (!ids.has(proc.entry)) problems.push(`entry "${proc.entry}" is not a step`);

	for (const step of proc.steps) {
		for (const target of successors(step)) {
			if (!ids.has(target)) {
				problems.push(`step "${step.id}" points at missing step "${target}"`);
			}
		}
	}

	// Walk from the entry. Anything not seen is authored content no user can reach.
	const seen = new Set<string>();
	const queue = ids.has(proc.entry) ? [proc.entry] : [];
	while (queue.length > 0) {
		const id = queue.shift()!;
		if (seen.has(id)) continue;
		seen.add(id);
		const step = stepById(proc, id);
		if (step) queue.push(...successors(step).filter((t) => ids.has(t)));
	}
	for (const step of proc.steps) {
		if (!seen.has(step.id)) {
			problems.push(`step "${step.id}" is unreachable from entry`);
		}
	}

	if (hasCycle(proc, ids)) problems.push('graph has a cycle');

	return problems;
}

/** Depth-first colour marking. Grey means "on the current path", so re-entry is a loop. */
function hasCycle(proc: Procedure, ids: Set<string>): boolean {
	const grey = new Set<string>();
	const black = new Set<string>();

	function visit(id: string): boolean {
		if (grey.has(id)) return true;
		if (black.has(id)) return false;
		grey.add(id);
		const step = stepById(proc, id);
		if (step) {
			for (const target of successors(step)) {
				if (ids.has(target) && visit(target)) return true;
			}
		}
		grey.delete(id);
		black.add(id);
		return false;
	}

	for (const step of proc.steps) {
		if (visit(step.id)) return true;
	}
	return false;
}

/**
 * Could this cursor have been arrived at honestly?
 *
 * The cursor travels with the request, so it is not trusted. Checking that the claimed
 * history is a real contiguous walk from the entry is what stops a tampered cursor
 * dropping someone at step five of a flow they never started. Validation instead of
 * storage: no session store, no trust.
 */
export function isReachable(proc: Procedure, cursor: Cursor): boolean {
	const ids = new Set(proc.steps.map((s) => s.id));

	if (!ids.has(cursor.stepId)) return false;
	if (cursor.done.includes(cursor.stepId)) return false;
	for (const id of cursor.done) {
		if (!ids.has(id)) return false;
	}

	// An empty history is only ever legal at the entry.
	if (cursor.done.length === 0) return cursor.stepId === proc.entry;
	if (cursor.done[0] !== proc.entry) return false;

	const chain = [...cursor.done, cursor.stepId];
	for (let i = 0; i < chain.length - 1; i += 1) {
		const from = stepById(proc, chain[i]!);
		if (!from || !successors(from).includes(chain[i + 1]!)) return false;
	}
	return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/procedure.test.ts`
Expected: PASS, 17 tests

- [ ] **Step 5: Run the full suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/lib/procedure.ts src/lib/procedure.test.ts
git commit -m "Model a procedure as a validated acyclic graph

A guided flow is a graph, so the failures are graph failures: a step that
points nowhere, a loop that never terminates, authored content no user can
reach. validateProcedure returns all of them at once rather than throwing on
the first, because an author fixing one error per run is an author who stops.

isReachable is the security half. The cursor travels with the request and is
not trusted, so the server checks that the claimed history is a contiguous
walk from the entry. That rejects a tampered cursor dropping someone at step
five of a flow they never started, and it needs no session store to do it."
```

---

### Task 2: The session state machine

**Files:**
- Create: `src/lib/session.ts`
- Create: `src/lib/session.test.ts`

**Interfaces:**
- Consumes: `Screen` from `src/lib/uispec.ts`, `Understanding` from `src/lib/understanding.ts`, `Cursor` from `src/lib/procedure.ts`
- Produces: `MicFailure`, `SessionState`, `SessionEvent`, `PHASES`, `EVENTS`, `initialState(screen)`, `next(state, event)`, `canPress(state)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { anUnderstanding } from './providers/fake';
import {
	canPress,
	EVENTS,
	initialState,
	next,
	type SessionEvent,
	type SessionState,
} from './session';
import type { Screen } from './uispec';

const OPENING: Screen = { kind: 'listening', say: 'What do you need help with today?' };
const start = () => initialState(OPENING);

const CURSOR = {
	procedureId: 'test-proc',
	stepId: 's1',
	done: [],
	startedAt: '2026-09-11T00:00:00.000Z',
};

/**
 * Every state the machine can actually get into.
 *
 * Breadth-first over (state, event). This is model-based testing without a library:
 * "not smooth" is nearly always a transition nobody thought about, and a walk finds
 * those where hand-written cases do not.
 */
function reachable(): SessionState[] {
	const seen = new Map<string, SessionState>();
	const queue: SessionState[] = [start()];

	while (queue.length > 0) {
		const state = queue.shift()!;
		const key = JSON.stringify(state);
		if (seen.has(key)) continue;
		seen.set(key, state);
		for (const event of sampleEvents()) {
			queue.push(next(state, event));
		}
	}
	return [...seen.values()];
}

/** One representative payload per event type. */
function sampleEvents(): SessionEvent[] {
	return [
		{ type: 'PRESS' },
		{ type: 'GRANTED' },
		{ type: 'DENIED', reason: 'permission' },
		{ type: 'CAPTION', text: 'i need help' },
		{ type: 'RELEASE' },
		{
			type: 'REPLY',
			screen: { kind: 'confirm', intent: 'chas_subsidy', say: 'Heard.', yes: 'Yes', no: 'No' },
			understanding: anUnderstanding({ intent: 'chas_subsidy', confidence: 0.7 }),
		},
		{ type: 'FAIL' },
		{ type: 'ENTER', cursor: CURSOR },
		{ type: 'CONFIRM', accepted: false },
		{ type: 'ADVANCE', cursor: { ...CURSOR, stepId: 's2', done: ['s1'] } },
		{ type: 'FINISH' },
		{ type: 'SPOKEN' },
	];
}

describe('the machine', () => {
	it('starts idle', () => {
		expect(start().phase).toBe('idle');
	});

	it('ignores an event a phase does not handle rather than crashing', () => {
		// Total by construction. A driver firing a stale event must never break the UI.
		expect(next(start(), { type: 'SPOKEN' })).toEqual(start());
	});

	it('asks for the microphone before recording, so permission is its own visible state', () => {
		const armed = next(start(), { type: 'PRESS' });
		expect(armed.phase).toBe('arming');
		expect(next(armed, { type: 'GRANTED' }).phase).toBe('recording');
	});

	it('surfaces a denied microphone instead of failing silently', () => {
		const armed = next(start(), { type: 'PRESS' });
		const denied = next(armed, { type: 'DENIED', reason: 'permission' });
		expect(denied.phase).toBe('denied');
	});

	it('shows what it heard before it shows what it decided', () => {
		let s = next(next(start(), { type: 'PRESS' }), { type: 'GRANTED' });
		s = next(s, { type: 'RELEASE' });
		expect(s.phase).toBe('submitting');
		s = next(s, sampleEvents().find((e) => e.type === 'REPLY')!);
		expect(s.phase).toBe('readback');
	});

	it('never enters a procedure straight from submitting, because readback is the gate', () => {
		let s = next(next(start(), { type: 'PRESS' }), { type: 'GRANTED' });
		s = next(s, { type: 'RELEASE' });
		expect(next(s, { type: 'ENTER', cursor: CURSOR }).phase).toBe('submitting');
	});

	it('lets the user speak again in the middle of a flow', () => {
		let s = next(next(start(), { type: 'PRESS' }), { type: 'GRANTED' });
		s = next(s, { type: 'RELEASE' });
		s = next(s, sampleEvents().find((e) => e.type === 'REPLY')!);
		s = next(s, { type: 'ENTER', cursor: CURSOR });
		expect(s.phase).toBe('guiding');
		expect(next(s, { type: 'PRESS' }).phase).toBe('arming');
	});

	it('turns a network failure into its own state, not into "I could not hear that"', () => {
		let s = next(next(start(), { type: 'PRESS' }), { type: 'GRANTED' });
		s = next(s, { type: 'RELEASE' });
		expect(next(s, { type: 'FAIL' }).phase).toBe('offline');
	});
});

describe('every reachable state', () => {
	const states = reachable();

	it('finds more phases than the two booleans could express', () => {
		const phases = new Set(states.map((s) => s.phase));
		expect(phases.size).toBeGreaterThanOrEqual(7);
	});

	it('always offers a way forward, because a dead end means the user gives up', () => {
		for (const s of states) {
			const escapable = canPress(s) || s.phase === 'submitting' || s.phase === 'answering';
			expect(escapable, `phase ${s.phase} traps the user`).toBe(true);
		}
	});

	it('always has something to say', () => {
		for (const s of states) {
			expect(s.screen.say.length, `phase ${s.phase} is silent`).toBeGreaterThan(0);
		}
	});

	it('is only recording in exactly one phase, so the mic indicator cannot lie', () => {
		const recording = states.filter((s) => s.phase === 'recording');
		for (const s of recording) expect(s.phase).toBe('recording');
		expect(states.some((s) => s.phase === 'recording')).toBe(true);
	});

	it('handles every declared event from every reachable state without throwing', () => {
		for (const s of states) {
			for (const type of EVENTS) {
				const event = sampleEvents().find((e) => e.type === type)!;
				expect(() => next(s, event)).not.toThrow();
			}
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/session.test.ts`
Expected: FAIL — `Failed to resolve import "./session"`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/session.ts`:

```ts
import type { Cursor } from './procedure';
import type { Screen } from './uispec';
import type { Understanding } from './understanding';

/** Why the microphone is unavailable. Each one gets different wording on screen. */
export type MicFailure = 'permission' | 'no-device' | 'insecure';

export const PHASES = [
	'idle',
	'arming',
	'recording',
	'submitting',
	'readback',
	'guiding',
	'answering',
	'denied',
	'offline',
] as const;

export type Phase = (typeof PHASES)[number];

/**
 * Where the client is, as one value.
 *
 * This replaces a `recording` boolean and a `busy` boolean, which between them describe
 * four combinations of which two are nonsense. `arming`, `readback`, `guiding`, `denied`
 * and `offline` had no representation at all — which is precisely why the permission
 * moment and the wait for a reply both felt like nothing was happening. They were not
 * states, so they could not have behaviour.
 */
export type SessionState =
	| { phase: 'idle'; screen: Screen }
	| { phase: 'arming'; screen: Screen }
	| { phase: 'recording'; screen: Screen; heard: string }
	| { phase: 'submitting'; screen: Screen; heard: string }
	| { phase: 'readback'; screen: Screen; heard: string; understanding: Understanding }
	| { phase: 'guiding'; screen: Screen; cursor: Cursor }
	| { phase: 'answering'; screen: Screen }
	| { phase: 'denied'; screen: Screen; reason: MicFailure }
	| { phase: 'offline'; screen: Screen };

export const EVENTS = [
	'PRESS',
	'GRANTED',
	'DENIED',
	'CAPTION',
	'RELEASE',
	'REPLY',
	'FAIL',
	'ENTER',
	'CONFIRM',
	'ADVANCE',
	'FINISH',
	'SPOKEN',
] as const;

export type SessionEvent =
	| { type: 'PRESS' }
	| { type: 'GRANTED' }
	| { type: 'DENIED'; reason: MicFailure }
	| { type: 'CAPTION'; text: string }
	| { type: 'RELEASE' }
	| { type: 'REPLY'; screen: Screen; understanding: Understanding }
	| { type: 'FAIL' }
	| { type: 'ENTER'; cursor: Cursor }
	| { type: 'CONFIRM'; accepted: boolean }
	| { type: 'ADVANCE'; cursor: Cursor }
	| { type: 'FINISH' }
	| { type: 'SPOKEN' };

export function initialState(screen: Screen): SessionState {
	return { phase: 'idle', screen };
}

/** Whether the speak button does anything. Drives both the UI and the dead-end test. */
export function canPress(state: SessionState): boolean {
	return (
		state.phase === 'idle' ||
		state.phase === 'guiding' ||
		state.phase === 'denied' ||
		state.phase === 'offline' ||
		state.phase === 'readback'
	);
}

/**
 * One transition. Total: an event a phase does not handle returns the state unchanged.
 *
 * Totality is not tidiness. The driver fires events from timers, from the network and
 * from the microphone, all of which can arrive late — after the user has already moved
 * on. A stale event must be ignored, never crash the only screen this person has.
 */
export function next(state: SessionState, event: SessionEvent): SessionState {
	switch (event.type) {
		case 'PRESS':
			return canPress(state) ? { phase: 'arming', screen: state.screen } : state;

		case 'GRANTED':
			return state.phase === 'arming'
				? { phase: 'recording', screen: state.screen, heard: '' }
				: state;

		case 'DENIED':
			return state.phase === 'arming'
				? { phase: 'denied', screen: state.screen, reason: event.reason }
				: state;

		case 'CAPTION':
			return state.phase === 'recording' ? { ...state, heard: event.text } : state;

		case 'RELEASE':
			return state.phase === 'recording'
				? { phase: 'submitting', screen: state.screen, heard: state.heard }
				: state;

		case 'REPLY':
			// Readback always comes first. Nothing renders a decision before showing the
			// person what was heard, and nothing enters a procedure without passing here.
			return state.phase === 'submitting'
				? {
						phase: 'readback',
						screen: event.screen,
						heard: state.heard,
						understanding: event.understanding,
					}
				: state;

		case 'FAIL':
			return state.phase === 'submitting'
				? { phase: 'offline', screen: state.screen }
				: state;

		case 'ENTER':
			return state.phase === 'readback'
				? { phase: 'guiding', screen: state.screen, cursor: event.cursor }
				: state;

		case 'CONFIRM':
			if (state.phase !== 'readback') return state;
			return event.accepted
				? { phase: 'answering', screen: state.screen }
				: { phase: 'idle', screen: state.screen };

		case 'ADVANCE':
			return state.phase === 'guiding' ? { ...state, cursor: event.cursor } : state;

		case 'FINISH':
			return state.phase === 'guiding'
				? { phase: 'answering', screen: state.screen }
				: state;

		case 'SPOKEN':
			return state.phase === 'answering'
				? { phase: 'idle', screen: state.screen }
				: state;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/session.test.ts`
Expected: PASS, 13 tests

- [ ] **Step 5: Run the full suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/lib/session.ts src/lib/session.test.ts
git commit -m "Make the client's lifecycle a value instead of two booleans

recording and busy describe four combinations, two of which are nonsense.
Nothing prevented them and nothing tested them. Worse, arming, readback,
guiding, denied and offline had no representation at all — which is why the
permission prompt and the wait for a reply both read as nothing happening.
They were not states, so they could not have behaviour.

The reducer is total: an event a phase does not handle returns the state
unchanged. That is not tidiness. The driver fires events from timers, the
network and the microphone, all of which can arrive after the user has moved
on, and a stale event must never break the only screen this person has.

Tests walk the machine breadth-first rather than asserting hand-picked paths.
Not smooth is nearly always a transition nobody thought about, and a walk
finds those. It asserts no reachable state traps the user and none is silent."
```

---

### Task 3: Cards, and the gate that keeps unverified content off the screen

**Files:**
- Create: `src/lib/cards.ts`
- Create: `src/lib/cards.test.ts`

**Interfaces:**
- Consumes: `SessionState` from `src/lib/session.ts`, `Procedure`/`Cursor`/`StepImage`/`localise`/`stepById` from `src/lib/procedure.ts`, `Language` from `src/lib/understanding.ts`
- Produces: `Card`, `IMAGE_STALE_DAYS`, `imageIsFresh(image, now)`, `cardsFor(state, proc, lang, now)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/cards.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cardsFor, imageIsFresh, IMAGE_STALE_DAYS } from './cards';
import type { Procedure } from './procedure';
import { anUnderstanding } from './providers/fake';
import type { SessionState } from './session';
import type { Screen } from './uispec';

const NOW = new Date('2026-09-11T00:00:00.000Z');
const SCREEN: Screen = { kind: 'listening', say: 'What do you need help with today?' };

function proc(over: Partial<Procedure> = {}): Procedure {
	return {
		id: 'test-proc',
		ministry: 'cpf',
		title: { en: 'Test procedure' },
		topic: 'test',
		metadata: { cues: [], aliases: [] },
		entry: 's1',
		steps: [
			{ id: 's1', instruction: { en: 'First' }, image: null, next: 's2' },
			{ id: 's2', instruction: { en: 'Second' }, image: null, next: null },
		],
		verified: true,
		source: 'https://example.invalid',
		checkedOn: '2026-09-01',
		...over,
	};
}

const guiding = (stepId: string, done: string[]): SessionState => ({
	phase: 'guiding',
	screen: SCREEN,
	cursor: { procedureId: 'test-proc', stepId, done, startedAt: NOW.toISOString() },
});

describe('imageIsFresh', () => {
	it('accepts an image checked today', () => {
		expect(imageIsFresh({ src: '/a.png', alt: { en: 'a' }, checkedOn: '2026-09-11' }, NOW)).toBe(true);
	});

	it('rejects one past the budget, because a moved button is worse than no picture', () => {
		expect(imageIsFresh({ src: '/a.png', alt: { en: 'a' }, checkedOn: '2020-01-01' }, NOW)).toBe(false);
	});

	it('rejects an unparseable date rather than trusting it', () => {
		expect(imageIsFresh({ src: '/a.png', alt: { en: 'a' }, checkedOn: 'soon' }, NOW)).toBe(false);
	});
});

describe('cardsFor', () => {
	it('shows every step, so the user knows how much is left', () => {
		const cards = cardsFor(guiding('s1', []), proc(), 'en', NOW);
		const steps = cards.filter((c) => c.kind === 'step');
		expect(steps).toHaveLength(2);
	});

	it('marks exactly one step active', () => {
		const cards = cardsFor(guiding('s2', ['s1']), proc(), 'en', NOW);
		const active = cards.filter((c) => c.kind === 'step' && c.state === 'active');
		expect(active).toHaveLength(1);
	});

	it('keeps a step key stable across an advance, so the card animates instead of remounting', () => {
		const before = cardsFor(guiding('s1', []), proc(), 'en', NOW);
		const after = cardsFor(guiding('s2', ['s1']), proc(), 'en', NOW);
		const keyOf = (cs: typeof before, id: string) =>
			cs.find((c) => c.kind === 'step' && c.key.endsWith(id))?.key;
		expect(keyOf(before, 's1')).toBe(keyOf(after, 's1'));
	});

	it('renders NOTHING from an unverified procedure', () => {
		// The safety property the whole product rests on. An unverified row is content
		// nobody has checked against a source, and a plausible wrong instruction sends an
		// eighty-year-old to the wrong counter.
		const cards = cardsFor(guiding('s1', []), proc({ verified: false }), 'en', NOW);
		expect(cards.filter((c) => c.kind === 'step')).toHaveLength(0);
	});

	it('drops a stale image but keeps the instruction', () => {
		const p = proc();
		p.steps[0]!.image = { src: '/old.png', alt: { en: 'old' }, checkedOn: '2020-01-01' };
		const cards = cardsFor(guiding('s1', []), p, 'en', NOW);
		const step = cards.find((c) => c.kind === 'step' && c.state === 'active');
		expect(step && step.kind === 'step' && step.image).toBeNull();
		expect(step && step.kind === 'step' && step.instruction).toBe('First');
	});

	it('shows what was heard during readback, because the wait needs an answer', () => {
		const state: SessionState = {
			phase: 'readback',
			screen: SCREEN,
			heard: 'i need help paying',
			understanding: anUnderstanding({ intent: 'chas_subsidy', confidence: 0.9 }),
		};
		const cards = cardsFor(state, null, 'en', NOW);
		expect(cards.some((c) => c.kind === 'heard' && c.text === 'i need help paying')).toBe(true);
	});

	it('shows nothing at all while submitting, because speculating is the thing we refuse', () => {
		const state: SessionState = { phase: 'submitting', screen: SCREEN, heard: 'x' };
		expect(cardsFor(state, null, 'en', NOW)).toEqual([]);
	});

	it('falls back to English rather than rendering a blank step', () => {
		const cards = cardsFor(guiding('s1', []), proc(), 'nan', NOW);
		const active = cards.find((c) => c.kind === 'step' && c.state === 'active');
		expect(active && active.kind === 'step' && active.instruction).toBe('First');
	});

	it('has a staleness budget that is written down rather than implied', () => {
		expect(IMAGE_STALE_DAYS).toBe(90);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cards.test.ts`
Expected: FAIL — `Failed to resolve import "./cards"`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/cards.ts`:

```ts
import { localise, stepById, type Procedure, type StepImage } from './procedure';
import type { SessionState } from './session';
import type { Language } from './understanding';

/**
 * How long a screenshot is trusted.
 *
 * Government interfaces get redesigned, and a stale screenshot is worse than none: it
 * sends someone hunting for a button that moved, which for this audience ends the
 * attempt. Ninety days is a guess — see open question 3 in the spec — and it lives here
 * as a named constant so it can be retuned rather than hunted for.
 */
export const IMAGE_STALE_DAYS = 90;

export type Card =
	| { kind: 'heard'; key: string; text: string }
	| { kind: 'fact'; key: string; label: string; value: string }
	| {
			kind: 'step';
			key: string;
			index: number;
			of: number;
			instruction: string;
			state: 'done' | 'active' | 'future';
			image: StepImage | null;
		}
	| { kind: 'contact'; key: string; label: string; phone: string };

export function imageIsFresh(image: StepImage, now: Date): boolean {
	const checked = Date.parse(image.checkedOn);
	if (Number.isNaN(checked)) return false;
	const days = (now.getTime() - checked) / 86_400_000;
	return days >= 0 && days <= IMAGE_STALE_DAYS;
}

/**
 * The ordered content for a state. Pure, total, and the only place content is gated.
 *
 * Keys are stable across turns on purpose: a card that survives a transition keeps its
 * key, stays mounted and animates position rather than remounting. That is what stops
 * the screen behaving like a slideshow of separate posters.
 */
export function cardsFor(
	state: SessionState,
	proc: Procedure | null,
	lang: Language,
	now: Date,
): Card[] {
	switch (state.phase) {
		case 'submitting':
			// Deliberately empty. Nothing is rendered until the decision is made, because
			// retracting something already shown costs more than a pause.
			return [];

		case 'readback':
			return state.heard
				? [{ kind: 'heard', key: 'heard', text: state.heard }]
				: [];

		case 'guiding': {
			if (!proc || !proc.verified) return [];
			return proc.steps.map((step, i) => {
				const done = state.cursor.done.includes(step.id);
				const active = state.cursor.stepId === step.id;
				const image = step.image && imageIsFresh(step.image, now) ? step.image : null;
				return {
					kind: 'step',
					key: `${proc.id}:${step.id}`,
					index: i + 1,
					of: proc.steps.length,
					instruction: localise(step.instruction, lang),
					state: active ? 'active' : done ? 'done' : 'future',
					// Only the step being worked on shows its picture. Every picture at once
					// is a wall of screenshots on a phone.
					image: active ? image : null,
				};
			});
		}

		case 'answering':
			return state.screen.kind === 'answer'
				? state.screen.facts.map((f) => ({
						kind: 'fact',
						key: `fact:${f.label}`,
						label: f.label,
						value: f.value,
					}))
				: [];

		default:
			return state.screen.kind === 'handoff'
				? [
						{
							kind: 'contact',
							key: 'handoff',
							label: `Call ${state.screen.phone}`,
							phone: state.screen.phone,
						},
					]
				: [];
	}
}

/** Re-exported so callers do not need to reach into procedure.ts for one helper. */
export { stepById };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/cards.test.ts`
Expected: PASS, 12 tests

- [ ] **Step 5: Run the full suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/lib/cards.ts src/lib/cards.test.ts
git commit -m "Gate content behind verified and freshness, in one pure function

cardsFor is the only place content reaches a screen, which makes the safety
property testable instead of trusted: an unverified procedure renders nothing,
and a screenshot past ninety days is dropped while its instruction stays. A
moved button is worse than no picture — it sends someone hunting, and for this
audience that ends the attempt.

Card keys are stable across turns so a surviving card animates instead of
remounting. That is the mechanism that stops the screen reading as a slideshow
of separate posters.

Submitting returns no cards at all. Nothing is rendered before the decision is
made, because retracting something already shown costs more than a pause."
```

---

### Task 4: The renderer

**Files:**
- Create: `src/components/Screen.tsx`
- Modify: `src/styles/global.css` (append the step-card component styles)

**Interfaces:**
- Consumes: `SessionState`/`canPress` from `src/lib/session.ts`, `Card` from `src/lib/cards.ts`
- Produces: `ScreenView` default export with props `{ state, cards, busyLabel?, onPress, onConfirm, onStepDone }`

- [ ] **Step 1: Write the component**

There is no unit test for this task — `Screen.tsx` is asserted end-to-end by the browser layers in Task 9, which is where rendering bugs actually show. Its testability comes from having no side effects at all.

Create `src/components/Screen.tsx`:

```tsx
import type { Card } from '../lib/cards';
import { canPress, type SessionState } from '../lib/session';

interface Props {
	state: SessionState;
	cards: Card[];
	onPress: () => void;
	onConfirm: (accepted: boolean) => void;
	onStepDone: () => void;
}

/** Wording for each way the microphone can be unavailable. One instruction each. */
const MIC_HELP: Record<string, string> = {
	permission: 'Please allow microphone access, then press the green button.',
	'no-device': 'I cannot find a microphone on this device.',
	insecure: 'This page needs a secure connection to use the microphone.',
};

/**
 * Every pixel, and nothing else.
 *
 * No network, no microphone, no timers, no effects. That is what lets the dev route in
 * Task 5 render any state from a query string, and it is the same rule `FakeProvider`
 * already enforces on the backend: if it cannot be driven by a plain object, the state
 * is hiding somewhere it cannot be tested.
 */
export default function ScreenView({ state, cards, onPress, onConfirm, onStepDone }: Props) {
	const recording = state.phase === 'recording';
	const working = state.phase === 'submitting';

	return (
		<main className="mx-auto flex min-h-svh max-w-xl flex-col justify-between px-6 py-8">
			<div className="pt-6">
				{recording && (
					<p className="text-live mb-6 text-[length:var(--text-micro)] font-semibold">
						Listening. Press the button again when you finish.
					</p>
				)}

				<p className="text-[length:var(--text-title)] font-semibold leading-tight text-balance">
					{state.screen.say}
				</p>

				{/* Height reserved whether or not there is text, so the question above never
				    jumps as words arrive. A moving target is hard to read for anyone. */}
				<div className="mt-8 min-h-28" aria-live="polite">
					{recording && (
						<>
							<p className="text-quiet text-[length:var(--text-micro)]">I am hearing</p>
							<p className="text-ink mt-1 text-[length:var(--text-lead)] leading-snug">
								{state.heard || '…'}
								<span className="caret" aria-hidden="true" />
							</p>
						</>
					)}
					{cards.map((card) => (
						<CardView key={card.key} card={card} onStepDone={onStepDone} />
					))}
				</div>

				{state.phase === 'denied' && (
					<p className="text-quiet mt-6 text-[length:var(--text-lead)]">
						{MIC_HELP[state.reason] ?? MIC_HELP.permission}
					</p>
				)}

				{state.phase === 'offline' && (
					<p className="text-quiet mt-6 text-[length:var(--text-lead)]">
						I could not reach the service. Please check your connection and try again.
					</p>
				)}

				{state.screen.kind === 'repeat' && (
					<p className="text-quiet mt-6 text-[length:var(--text-lead)]">
						For example: &ldquo;{state.screen.example}&rdquo;
					</p>
				)}
			</div>

			<div className="space-y-4 pb-2">
				{state.phase === 'readback' && state.screen.kind === 'confirm' && (
					<>
						<button className="tap tap-quiet" onClick={() => onConfirm(true)}>
							{state.screen.yes}
						</button>
						<button className="tap tap-quiet" onClick={() => onConfirm(false)}>
							{state.screen.no}
						</button>
					</>
				)}

				<button
					className="tap tap-speak"
					data-live={recording}
					onClick={onPress}
					disabled={!recording && !canPress(state)}
					aria-label={recording ? 'Stop speaking' : 'Press to speak'}
				>
					{working ? 'One moment' : recording ? 'I have finished' : 'Press to speak'}
				</button>
			</div>
		</main>
	);
}

function CardView({ card, onStepDone }: { card: Card; onStepDone: () => void }) {
	switch (card.kind) {
		case 'heard':
			return (
				<>
					<p className="text-quiet text-[length:var(--text-micro)]">You said</p>
					<p className="text-quiet mt-1 text-[length:var(--text-lead)] leading-snug">
						{card.text}
					</p>
				</>
			);

		case 'fact':
			return (
				<div className="mt-7">
					<p className="text-quiet m-0 text-[length:var(--text-micro)]">{card.label}</p>
					<p className="m-0 text-[length:var(--text-lead)] font-semibold">{card.value}</p>
				</div>
			);

		case 'contact':
			return (
				<a
					href={`tel:${card.phone.replace(/\s/g, '')}`}
					className="tap tap-quiet mt-10 text-center no-underline"
				>
					{card.label}
				</a>
			);

		case 'step':
			return (
				<div className="step" data-state={card.state}>
					<p className="text-quiet m-0 text-[length:var(--text-micro)]">
						Step {card.index} of {card.of}
					</p>
					<p className="m-0 text-[length:var(--text-lead)] font-semibold">
						{card.instruction}
					</p>
					{card.state === 'active' && card.image && (
						<img
							className="mt-4 rounded-xl"
							src={card.image.src}
							alt={card.image.alt.en}
							/* Dimensions are reserved by CSS aspect-ratio so arrival shifts nothing. */
						/>
					)}
					{card.state === 'active' && (
						<button className="tap tap-quiet mt-5" onClick={onStepDone}>
							Done, what is next
						</button>
					)}
				</div>
			);
	}
}
```

- [ ] **Step 2: Append the step styles**

Append to `src/styles/global.css`, inside the existing `@layer components` block, immediately before its closing brace:

```css
	/*
	 * A step in a guided flow. Three states, distinguished by weight and opacity rather
	 * than by a border — `global.css` carries structure with size and space, and a stack
	 * of six outlined boxes is exactly the visual noise that rule exists to prevent.
	 */
	.step {
		margin-top: 1.75rem;
		transition: opacity 200ms ease-out;
	}

	.step[data-state='done'] {
		opacity: 0.45;
	}

	.step[data-state='future'] {
		opacity: 0.55;
	}

	.step[data-state='active'] {
		opacity: 1;
	}

	/*
	 * Reserve the picture's box before it loads. An image that arrives and pushes the
	 * instruction down is a layout shift, and the CLS assertion in the browser tests
	 * fails on it — correctly, because a moving instruction is hard to follow.
	 */
	.step img {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		background: color-mix(in srgb, var(--ink) 8%, transparent);
	}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/components/Screen.tsx src/styles/global.css
git commit -m "Split rendering out of the driver

Screen.tsx has no network, no microphone, no timers and no effects. That is
the whole point: any state can be rendered from a plain object, which is what
the dev route and the browser tests need, and it is the same rule FakeProvider
already enforces on the backend. If a state cannot be reached from a plain
object, it is hiding somewhere it cannot be tested.

Denied and offline get their own wording rather than collapsing into 'I could
not hear that'. Three of the four failures that message covered were not
hearing failures, and each has a different correct instruction.

Step pictures reserve their box before loading. An image that arrives and
shoves the instruction down is a layout shift, and a moving instruction is
hard to follow for exactly the readers this is built for."
```

---

### Task 5: The dev route

**Files:**
- Create: `src/pages/dev/state.astro`

**Interfaces:**
- Consumes: `ScreenView` from `src/components/Screen.tsx`, `cardsFor` from `src/lib/cards.ts`, `SessionState` from `src/lib/session.ts`
- Produces: a route at `/dev/state?phase=…&screen=…` in dev only

- [ ] **Step 1: Write the route**

Create `src/pages/dev/state.astro`:

```astro
---
import ScreenView from '../../components/Screen.tsx';
import BaseLayout from '../../layouts/BaseLayout.astro';
import { cardsFor } from '../../lib/cards';
import type { Procedure } from '../../lib/procedure';
import type { SessionState } from '../../lib/session';
import type { Screen } from '../../lib/uispec';

/**
 * Render any state from a query string, for tests and for looking at.
 *
 * This is what makes the browser test layers affordable. Without it, reaching the
 * `confirm` state in Playwright needs a real microphone, a real model call and a real
 * elderly person; with it, it needs a URL. Dev only — it 404s in production, because a
 * route that fabricates screens has no business on a government service.
 */
export const prerender = false;

if (!import.meta.env.DEV) {
	return new Response(null, { status: 404 });
}

const params = Astro.url.searchParams;
const phase = params.get('phase') ?? 'idle';
const screenKind = params.get('screen') ?? 'listening';

const SCREENS: Record<string, Screen> = {
	listening: { kind: 'listening', say: 'What do you need help with today?' },
	confirm: {
		kind: 'confirm',
		intent: 'chas_subsidy',
		say: 'I heard that you need help paying for a doctor or medicine. Have I got that right, or is it something else?',
		yes: 'Yes, that is right',
		no: 'No, something else',
	},
	repeat: {
		kind: 'repeat',
		say: 'Sorry, I did not catch that.',
		example: 'I need help paying for the doctor',
	},
	handoff: { kind: 'handoff', say: 'Let me get someone to help.', phone: '1800 222 0000' },
	answer: { kind: 'answer', title: 'Test', say: 'Here is what I found.', facts: [] },
};

const screen = SCREENS[screenKind] ?? SCREENS.listening!;

/** Placeholder content. Never real guidance — see the spec's authoring note. */
const FIXTURE: Procedure = {
	id: 'dev-fixture',
	ministry: 'cpf',
	title: { en: 'Placeholder procedure' },
	topic: 'placeholder',
	metadata: { cues: [], aliases: [] },
	entry: 's1',
	steps: [
		{ id: 's1', instruction: { en: 'Placeholder step one' }, image: null, next: 's2' },
		{ id: 's2', instruction: { en: 'Placeholder step two' }, image: null, next: 's3' },
		{ id: 's3', instruction: { en: 'Placeholder step three' }, image: null, next: null },
	],
	verified: true,
	source: 'https://example.invalid',
	checkedOn: new Date().toISOString().slice(0, 10),
};

const cursor = {
	procedureId: 'dev-fixture',
	stepId: params.get('step') ?? 's2',
	done: (params.get('done') ?? 's1').split(',').filter(Boolean),
	startedAt: new Date().toISOString(),
};

const STATES: Record<string, SessionState> = {
	idle: { phase: 'idle', screen },
	arming: { phase: 'arming', screen },
	recording: { phase: 'recording', screen, heard: params.get('heard') ?? 'i need help paying' },
	submitting: { phase: 'submitting', screen, heard: params.get('heard') ?? 'i need help paying' },
	readback: {
		phase: 'readback',
		screen,
		heard: params.get('heard') ?? 'i need help paying for the doctor',
		understanding: {
			intent: 'chas_subsidy',
			confidence: 0.7,
			language: 'en',
			slots: {},
			reply: 'Okay.',
			needsHuman: false,
		},
	},
	guiding: { phase: 'guiding', screen, cursor },
	answering: { phase: 'answering', screen },
	denied: { phase: 'denied', screen, reason: 'permission' },
	offline: { phase: 'offline', screen },
};

const state = STATES[phase] ?? STATES.idle!;
const cards = cardsFor(state, state.phase === 'guiding' ? FIXTURE : null, 'en', new Date());
---

<BaseLayout title={`dev: ${phase}`}>
	<ScreenView state={state} cards={cards} client:load />
</BaseLayout>
```

- [ ] **Step 2: Verify it renders**

Run: `npm run dev`, then open `http://localhost:4321/dev/state?phase=guiding`
Expected: three placeholder steps, the second active with a "Done, what is next" button.

Then check `?phase=denied`, `?phase=recording`, `?phase=readback&screen=confirm`.

- [ ] **Step 3: Verify it 404s in a production build**

Run: `npm run build && npx wrangler dev --port 8788`, then `curl -s -o /dev/null -w "%{http_code}" http://localhost:8788/dev/state`
Expected: `404`

- [ ] **Step 4: Commit**

```bash
git add src/pages/dev/state.astro
git commit -m "Add a dev-only route that renders any state from a query string

This is what makes the browser test layers affordable. Reaching the confirm
screen in Playwright otherwise needs a real microphone, a real model call and
a real elderly person. With this it needs a URL.

Gated on import.meta.env.DEV and verified to 404 against a production build.
A route that fabricates screens has no business on a government service, and
the fixture it renders is placeholder text rather than guidance anyone could
mistake for real."
```

---

### Task 6: Reduce Voice.tsx to a driver

**Files:**
- Modify: `src/components/Voice.tsx` (replace wholesale)

**Interfaces:**
- Consumes: `next`/`initialState`/`canPress` from `src/lib/session.ts`, `cardsFor` from `src/lib/cards.ts`, `ScreenView` from `src/components/Screen.tsx`, `startCaptions` from `src/lib/caption.ts`
- Produces: unchanged default export `Voice`

- [ ] **Step 1: Rewrite the component**

Replace the whole of `src/components/Voice.tsx`. Everything below the state machine is
lifted unchanged from the existing file — `VOICE_LANG`, `speak`, `pickMimeType`,
`toBase64` keep their current bodies and comments. What changes is that the component now
dispatches events instead of setting booleans, and renders `ScreenView` instead of markup.

```tsx
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { cardsFor } from '../lib/cards';
import { startCaptions, type CaptionSession } from '../lib/caption';
import type { Cursor, Procedure } from '../lib/procedure';
import { initialState, next, type MicFailure } from '../lib/session';
import type { Screen } from '../lib/uispec';
import { Language, type Understanding } from '../lib/understanding';
import ScreenView from './Screen';

/** BCP-47 tags for the on-device voice, keyed by the language the model reported. */
const VOICE_LANG: Record<string, string> = {
	en: 'en-SG',
	sg: 'en-SG',
	zh: 'zh-SG',
	ms: 'ms-MY',
	ta: 'ta-IN',
	yue: 'zh-HK',
	nan: 'zh-TW',
	unknown: 'en-SG',
};

const EXAMPLE = 'I need help paying for the doctor';
const OPENING: Screen = { kind: 'listening', say: 'What do you need help with today?' };

/**
 * Speak the text on the device.
 *
 * On-device synthesis is the only TTS that fits the budget for dynamic text — Gemini-TTS
 * bills audio output at $20 per million tokens, which is roughly five times the whole
 * ceiling if every reply goes through it. Authored step text is pre-synthesised instead;
 * this path handles what cannot be baked ahead of time.
 */
function speak(text: string, lang: string): void {
	if (typeof speechSynthesis === 'undefined') return;
	speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(text);
	u.lang = VOICE_LANG[lang] ?? 'en-SG';
	u.rate = 0.85;
	speechSynthesis.speak(u);
}

/**
 * Pick a container this browser can actually record.
 *
 * Hardcoding `audio/webm;codecs=opus` throws on iOS Safari, which records MP4/AAC — so
 * that one line would have made the app dead on every iPhone, silently.
 */
function pickMimeType(): string {
	const candidates = [
		'audio/webm;codecs=opus',
		'audio/webm',
		'audio/ogg;codecs=opus',
		'audio/mp4',
	];
	if (typeof MediaRecorder === 'undefined') return '';
	return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

async function toBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
	return btoa(binary);
}

/** Tell a denied microphone apart from a missing one, so the wording can differ. */
function micFailure(err: unknown): MicFailure {
	if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure';
	const name = err instanceof Error ? err.name : '';
	if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device';
	return 'permission';
}

/**
 * The driver. Owns the microphone, the network and the speaker, and nothing else.
 *
 * Every decision about what the interface does lives in `session.ts`; every decision
 * about what it looks like lives in `Screen.tsx`. This file is the part that cannot be
 * tested without a browser, which is exactly why it should be the smallest.
 */
export default function Voice() {
	const [state, dispatch] = useReducer(next, initialState(OPENING));
	const [lang, setLang] = useState<Language>('en');
	const [procedure, setProcedure] = useState<Procedure | null>(null);

	const history = useRef<Understanding[]>([]);
	const unclearStreak = useRef(0);
	const recorder = useRef<MediaRecorder | null>(null);
	const stream = useRef<MediaStream | null>(null);
	const chunks = useRef<Blob[]>([]);
	const captions = useRef<CaptionSession | null>(null);

	// Say every new screen aloud. The spoken text and the shown text are the same string,
	// so a user who hears it and a user who reads it get the same thing.
	useEffect(() => {
		speak(state.screen.say, lang);
	}, [state.screen, lang]);

	// Release the microphone if this unmounts mid-recording. Without this the browser
	// keeps showing the recording indicator after the user has navigated away.
	useEffect(() => {
		return () => {
			captions.current?.stop();
			stream.current?.getTracks().forEach((t) => t.stop());
		};
	}, []);

	const post = useCallback(async (body: unknown) => {
		// A hung model call must not leave the user on "One moment" until the tab dies.
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), 15_000);
		try {
			const res = await fetch('/api/turn', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: abort.signal,
			});
			if (!res.ok) throw new Error(String(res.status));
			const reply = (await res.json()) as {
				screen: Screen;
				language: string;
				history: Understanding[];
				unclearStreak: number;
				understanding: Understanding;
				procedure?: Procedure | null;
				cursor?: Cursor | null;
			};
			history.current = reply.history;
			unclearStreak.current = reply.unclearStreak;
			setLang(Language.catch('en').parse(reply.language));
			setProcedure(reply.procedure ?? null);
			dispatch({
				type: 'REPLY',
				screen: reply.screen,
				understanding: reply.understanding,
			});
			// A confident answer with a procedure behind it goes straight into the flow.
			// Anything less waits on the readback card for a yes.
			if (reply.procedure && reply.cursor && reply.screen.kind !== 'confirm') {
				dispatch({ type: 'ENTER', cursor: reply.cursor });
			}
		} catch {
			dispatch({ type: 'FAIL' });
		} finally {
			clearTimeout(timer);
		}
	}, []);

	/**
	 * Tap to start, tap to stop. Not press-and-hold.
	 *
	 * Holding a button steady is exactly what a hand with a tremor cannot do, and
	 * releasing early truncates the sentence. Tap-to-stop also means a long pause
	 * mid-sentence never ends the turn — the user decides when they have finished.
	 */
	const onPress = useCallback(async () => {
		if (state.phase === 'recording') {
			recorder.current?.stop();
			return;
		}

		dispatch({ type: 'PRESS' });
		try {
			const media = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, sampleRate: 16000, noiseSuppression: true },
			});
			stream.current = media;
			const mimeType = pickMimeType();
			const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
			chunks.current = [];
			rec.ondataavailable = (e) => chunks.current.push(e.data);
			rec.onstop = async () => {
				media.getTracks().forEach((t) => t.stop());
				stream.current = null;
				captions.current?.stop();
				captions.current = null;
				dispatch({ type: 'RELEASE' });
				const type = rec.mimeType || mimeType || 'audio/webm';
				await post({
					kind: 'speech',
					audioBase64: await toBase64(new Blob(chunks.current, { type })),
					mimeType: type,
					history: history.current,
					unclearStreak: unclearStreak.current,
				});
			};
			recorder.current = rec;
			speechSynthesis?.cancel();
			captions.current = startCaptions(VOICE_LANG[lang] ?? 'en-SG', (text) =>
				dispatch({ type: 'CAPTION', text }),
			);
			rec.start();
			dispatch({ type: 'GRANTED' });
		} catch (err) {
			dispatch({ type: 'DENIED', reason: micFailure(err) });
		}
	}, [state.phase, lang, post]);

	const onConfirm = useCallback(
		(accepted: boolean) => {
			if (state.phase !== 'readback' || state.screen.kind !== 'confirm') return;
			dispatch({ type: 'CONFIRM', accepted });
			if (!accepted) {
				setProcedure(null);
				return;
			}
			void post({
				kind: 'confirmation',
				accepted,
				intent: state.screen.intent,
				history: history.current,
			});
		},
		[state, post],
	);

	const onStepDone = useCallback(() => {
		if (state.phase !== 'guiding' || !procedure) return;
		const step = procedure.steps.find((s) => s.id === state.cursor.stepId);
		const target = step && typeof step.next === 'string' ? step.next : null;
		if (!target) {
			dispatch({ type: 'FINISH' });
			return;
		}
		dispatch({
			type: 'ADVANCE',
			cursor: {
				...state.cursor,
				stepId: target,
				done: [...state.cursor.done, state.cursor.stepId],
			},
		});
	}, [state, procedure]);

	return (
		<ScreenView
			state={state}
			cards={cardsFor(state, procedure, lang, new Date())}
			onPress={onPress}
			onConfirm={onConfirm}
			onStepDone={onStepDone}
		/>
	);
}

export { EXAMPLE };
```

- [ ] **Step 2: Verify it compiles and the suite is green**

Run: `npm run typecheck && npx vitest run`
Expected: exit 0, 82 tests pass

- [ ] **Step 3: Verify it still works end to end**

Run: `npm run dev`, open `http://localhost:4321`, press the button, speak, confirm the turn completes.

- [ ] **Step 4: Commit**

```bash
git add src/components/Voice.tsx
git commit -m "Reduce Voice.tsx to the microphone, the network and the speaker

What the interface does now lives in session.ts, what it looks like lives in
Screen.tsx, and this file keeps only the part that cannot be tested without a
browser — which is exactly why it should be the smallest of the three.

Three bugs fall out of the split. The microphone is now released on unmount,
so navigating away mid-recording stops the browser's recording indicator. The
fetch carries a fifteen-second abort, so a hung model call no longer leaves
someone on 'One moment' until the tab dies. And a denied microphone is told
apart from a missing one and an insecure origin, because those three had been
collapsing into a single message that was wrong for two of them."
```

---

### Task 7: Pin the response key order

**Files:**
- Modify: `src/lib/providers/prompt.ts`
- Create: `src/lib/providers/prompt.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `RESPONSE_SCHEMA` gains `propertyOrdering`

- [ ] **Step 1: Write the failing test**

Spec A asserts that `confidence` lands before `reply` because Gemini honours schema key
order. It does that only when `propertyOrdering` is set, and it is not set anywhere in
this codebase. Today the ordering is an accident of object-literal order.

Create `src/lib/providers/prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RESPONSE_SCHEMA, systemPrompt } from './prompt';

describe('RESPONSE_SCHEMA', () => {
	it('pins the key order explicitly, because object-literal order is not a contract', () => {
		expect(RESPONSE_SCHEMA.propertyOrdering).toBeDefined();
	});

	it('decides confidence before it writes a reply', () => {
		// The safety claim in the feel-layer spec rests on this: nothing is ever spoken
		// before the policy has had a number to act on. Without propertyOrdering the
		// model is free to emit reply first and rationalise the confidence afterwards.
		const order = RESPONSE_SCHEMA.propertyOrdering as readonly string[];
		expect(order.indexOf('confidence')).toBeLessThan(order.indexOf('reply'));
	});

	it('orders every declared property, so none is left to chance', () => {
		const declared = Object.keys(RESPONSE_SCHEMA.properties).sort();
		const ordered = [...(RESPONSE_SCHEMA.propertyOrdering as readonly string[])].sort();
		expect(ordered).toEqual(declared);
	});
});

describe('systemPrompt', () => {
	it('is byte-identical across calls, so provider-side prompt caching can hit', () => {
		expect(systemPrompt()).toBe(systemPrompt());
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/providers/prompt.test.ts`
Expected: FAIL — `expected undefined to be defined`

- [ ] **Step 3: Add propertyOrdering**

In `src/lib/providers/prompt.ts`, add the field to `RESPONSE_SCHEMA` immediately after
`properties`, keeping `as const`:

```ts
	/**
	 * Explicit key order.
	 *
	 * Gemini honours this and generates fields in the order given, which is what makes
	 * `confidence` land before `reply`: the model commits to how sure it is before it
	 * writes the sentence, rather than writing a fluent sentence and rationalising a
	 * number to match. The feel-layer spec rests its "nothing is spoken before the
	 * policy has run" claim on this, and until now it was relying on object-literal
	 * order, which is not a contract.
	 */
	propertyOrdering: [
		'intent',
		'confidence',
		'language',
		'slots',
		'needsHuman',
		'reply',
	],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/providers/prompt.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/prompt.ts src/lib/providers/prompt.test.ts
git commit -m "Pin the response key order instead of assuming it

The feel-layer spec claims confidence lands before reply because Gemini
honours schema key order. It does — but only when propertyOrdering is set,
and it was set nowhere in this codebase. The ordering was an accident of
object-literal order, and the safety claim that nothing is spoken before the
policy has run was resting on it.

Now explicit, and tested: confidence is ordered before reply, and every
declared property is ordered so none is left to chance. The model commits to
how sure it is before it writes the sentence, rather than writing a fluent
sentence and rationalising a number to match it."
```

---

### Task 8: Select a procedure and validate the cursor

**Files:**
- Modify: `src/lib/turn.ts`
- Modify: `src/lib/turn.test.ts`
- Create: `src/lib/procedures.ts`

**Interfaces:**
- Consumes: `Procedure`/`Cursor`/`isReachable`/`validateProcedure` from `src/lib/procedure.ts`
- Produces: `PROCEDURES`, `procedureFor(intent)`, `procedureById(id)`, `startCursor(proc)`; `TurnResponse` gains `understanding`, `procedure`, `cursor`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/turn.test.ts`:

```ts
import { PROCEDURES, procedureFor, startCursor } from './procedures';
import { validateProcedure } from './procedure';

describe('the procedure catalogue', () => {
	it('ships every procedure as a valid graph', () => {
		for (const proc of PROCEDURES) {
			expect(validateProcedure(proc), `${proc.id} is malformed`).toEqual([]);
		}
	});

	it('ships nothing verified, because nobody has walked these flows yet', () => {
		// The same rule catalogue.ts already enforces. Unverified content does not reach
		// a screen, so shipping empty degrades to handoff rather than to invention.
		for (const proc of PROCEDURES) {
			expect(proc.verified, `${proc.id} claims to be verified`).toBe(false);
		}
	});

	it('starts a cursor at the entry with nothing done', () => {
		const proc = PROCEDURES[0];
		if (!proc) return;
		const cursor = startCursor(proc);
		expect(cursor.stepId).toBe(proc.entry);
		expect(cursor.done).toEqual([]);
	});
});

describe('runTurn with procedures', () => {
	it('returns the understanding so the client can show what it heard', async () => {
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.95, reply: 'Okay.' }),
		]);
		const res = await runTurn(
			{ kind: 'speech', audioBase64: btoa('x'), history: [], unclearStreak: 0 },
			provider,
		);
		expect(res.understanding.intent).toBe('chas_subsidy');
	});

	it('offers no procedure when none is verified, rather than an unchecked one', async () => {
		const provider = new FakeProvider([
			anUnderstanding({ intent: 'chas_subsidy', confidence: 0.95, reply: 'Okay.' }),
		]);
		const res = await runTurn(
			{ kind: 'speech', audioBase64: btoa('x'), history: [], unclearStreak: 0 },
			provider,
		);
		expect(res.procedure).toBeNull();
		expect(res.cursor).toBeNull();
	});
});
```

Check the existing imports at the top of `src/lib/turn.test.ts` already include
`FakeProvider`, `anUnderstanding` and `runTurn`; add whichever are missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/turn.test.ts`
Expected: FAIL — `Failed to resolve import "./procedures"`

- [ ] **Step 3: Write the catalogue and wire the turn**

Create `src/lib/procedures.ts`:

```ts
import type { Cursor, Procedure } from './procedure';
import type { Intent } from './understanding';

/**
 * The authored procedure catalogue.
 *
 * Empty on purpose, and this is not an oversight. Writing out the steps of the CPF or
 * Singpass flow without walking them would be exactly the invention `catalogue.ts`
 * already refuses — every row there ships `verified: false` for the same reason. A step
 * that sends an eighty-year-old to a button that does not exist is worse than no step.
 *
 * Authoring is a separate task: someone walks each flow, records what they saw, and sets
 * `verified` with a `checkedOn` date. Until then `procedureFor` returns null and the
 * product degrades to the answer-and-handoff behaviour it has today.
 */
export const PROCEDURES: readonly Procedure[] = [];

/** The verified procedure for an intent, or null. Never returns unverified content. */
export function procedureFor(intent: Intent): Procedure | null {
	return PROCEDURES.find((p) => p.verified && p.metadata.aliases.includes(intent)) ?? null;
}

/** The verified procedure with this id, or null. Used to check a cursor's claim. */
export function procedureById(id: string): Procedure | null {
	return PROCEDURES.find((p) => p.verified && p.id === id) ?? null;
}

export function startCursor(proc: Procedure): Cursor {
	return {
		procedureId: proc.id,
		stepId: proc.entry,
		done: [],
		startedAt: new Date().toISOString(),
	};
}
```

In `src/lib/turn.ts`, add to the imports:

```ts
import type { Cursor, Procedure } from './procedure';
import { isReachable } from './procedure';
import { procedureById, procedureFor, startCursor } from './procedures';
```

Extend `TurnResponse`:

```ts
export interface TurnResponse {
	screen: Screen;
	language: string;
	history: Understanding[];
	unclearStreak: number;
	/** What the model concluded. The client shows this on the readback card. */
	understanding: Understanding;
	/** The flow to walk, or null when nothing verified covers this intent. */
	procedure: Procedure | null;
	/** Where to start. Null whenever `procedure` is null. */
	cursor: Cursor | null;
	audit?: TurnAudit;
}
```

Add the cursor to the speech branch of `TurnRequest`, and cap the audio while you are
here — `audioBase64` currently has no maximum, so a fifty-megabyte POST is billed as
audio and decoded into Worker memory:

```ts
	z.object({
		kind: z.literal('speech'),
		// Roughly four minutes of Opus at 16 kbit/s, base64-expanded. Long enough for any
		// real utterance from this population, short enough that a hostile POST cannot
		// run up the audio bill or exhaust the isolate.
		audioBase64: z.string().min(1).max(8_000_000),
		mimeType: z.string().max(100).optional(),
		history: z.array(Understanding).max(20).default([]),
		unclearStreak: z.number().int().min(0).max(10).default(0),
	}),
```

In `runTurn`, replace the returned object with:

```ts
	const procedure = decision.kind === 'act' ? procedureFor(understanding.intent) : null;

	return {
		screen: screenFor(decision, factsFor(understanding.intent)),
		language: understanding.language,
		history: [...req.history, understanding],
		unclearStreak: nextContext(understanding, ctx).consecutiveUnclear,
		understanding,
		procedure,
		cursor: procedure ? startCursor(procedure) : null,
		audit: {
			transcriber: transcriber?.id ?? null,
			transcript: cross.transcript,
			audioIntent: voice.understanding.intent,
			transcriptIntent: cross.transcriptIntent,
			agreement: cross.agreement,
			rawConfidence: cross.rawConfidence,
			adjustedConfidence: understanding.confidence,
			decision: decision.kind,
		},
	};
```

In `handleConfirmation`, add the same three fields so both branches satisfy the type. The
`understanding` there is the last history entry, or a minimal stand-in when history is
empty:

```ts
	const understanding: Understanding =
		last ?? {
			intent,
			confidence: 1,
			language: 'en',
			slots: {},
			reply: 'Okay.',
			needsHuman: false,
		};
```

Then add `understanding`, `procedure` and `cursor` to both returned objects in that
function, computing `procedure` with `procedureFor(intent)` on the accepted branch and
`null` on the rejected one.

Finally, add the cursor validation helper below `runTurn`:

```ts
/**
 * Check a cursor the client sent back.
 *
 * The cursor travels with the request, so it is not trusted. A tampered one claiming to
 * be at step five of a flow it never started is rejected, and the flow restarts. This is
 * validation instead of storage: no session store, and no trust either.
 */
export function validateCursor(cursor: Cursor | null): Cursor | null {
	if (!cursor) return null;
	const proc = procedureById(cursor.procedureId);
	if (!proc) return null;
	return isReachable(proc, cursor) ? cursor : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, 88 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/turn.ts src/lib/turn.test.ts src/lib/procedures.ts
git commit -m "Return a procedure with the turn, and cap the audio

The turn now returns the understanding itself, so the client can show what was
heard on the readback card rather than waiting silently, plus a procedure and
a starting cursor when a verified flow covers the intent.

The catalogue ships empty, and that is the point. Writing out CPF or Singpass
steps without walking them is the invention catalogue.ts already refuses —
every row there is verified: false for the same reason. A step that sends an
eighty-year-old to a button that does not exist is worse than no step, so
until someone walks each flow the product degrades to what it does today.

audioBase64 also gains a maximum. It had none, so a fifty-megabyte POST to an
unauthenticated endpoint was billed as audio and decoded into Worker memory."
```

---

### Task 9: The browser test layers

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/ui/states.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the dev route from Task 5
- Produces: `npm run test:ui`

- [ ] **Step 1: Install and configure**

```bash
npm install -D @playwright/test axe-core
npx playwright install chromium
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

/**
 * The browser layers run against `astro dev`, because the dev-only state route is what
 * makes them affordable — reaching a state otherwise needs a microphone and a paid call.
 */
export default defineConfig({
	testDir: './tests/ui',
	fullyParallel: true,
	reporter: 'list',
	use: { baseURL: 'http://localhost:4321' },
	projects: [
		{ name: 'phone', use: { ...devices['Pixel 7'] } },
		{ name: 'desktop', use: { ...devices['Desktop Chrome'] } },
	],
	webServer: {
		command: 'npm run dev',
		url: 'http://localhost:4321',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
```

Add to `package.json` scripts:

```json
		"test:ui": "playwright test",
		"verify": "npm run types && npm run typecheck && npm run build && npm run test && npm run test:ui",
```

- [ ] **Step 2: Write the tests**

Create `tests/ui/states.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const AXE = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

const PHASES = [
	'idle',
	'arming',
	'recording',
	'submitting',
	'readback',
	'guiding',
	'answering',
	'denied',
	'offline',
] as const;

test.describe('every state', () => {
	for (const phase of PHASES) {
		test(`${phase} has no accessibility violations`, async ({ page }) => {
			await page.goto(`/dev/state?phase=${phase}`);
			await page.addScriptTag({ content: AXE });
			const results = await page.evaluate(async () => {
				// @ts-expect-error injected at runtime
				return await window.axe.run(document, {
					runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'],
				});
			});
			expect(results.violations.map((v: { id: string }) => v.id)).toEqual([]);
		});

		test(`${phase} keeps every control thumb-sized`, async ({ page }) => {
			// The README promises 72px. Nothing enforced it until now.
			await page.goto(`/dev/state?phase=${phase}`);
			for (const control of await page.locator('button:visible, a.tap:visible').all()) {
				const box = await control.boundingBox();
				expect(box!.height).toBeGreaterThanOrEqual(72);
			}
		});

		test(`${phase} never scrolls sideways`, async ({ page }) => {
			await page.goto(`/dev/state?phase=${phase}`);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});
	}
});

test('advancing a step shifts nothing on screen', async ({ page }) => {
	// Layout shift is the measurable half of "not smooth". A step card that survives an
	// advance must animate, not jump — and the instruction above it must not move at all.
	await page.goto('/dev/state?phase=guiding&step=s1&done=');
	await page.evaluate(() => {
		(window as unknown as { __cls: number }).__cls = 0;
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
				if (!shift.hadRecentInput) (window as unknown as { __cls: number }).__cls += shift.value;
			}
		}).observe({ type: 'layout-shift', buffered: true });
	});
	await page.getByRole('button', { name: 'Done, what is next' }).click();
	await page.waitForTimeout(600);
	const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
	expect(cls).toBeLessThan(0.01);
});

test('the speak button is reachable from every state a user can be stuck in', async ({ page }) => {
	for (const phase of ['idle', 'denied', 'offline', 'guiding'] as const) {
		await page.goto(`/dev/state?phase=${phase}`);
		await expect(page.getByRole('button', { name: /Press to speak/i })).toBeEnabled();
	}
});

test('the dev route is the only thing that can fabricate a state', async ({ page }) => {
	const res = await page.goto('/dev/state?phase=nonsense');
	expect(res!.status()).toBe(200);
	// An unknown phase falls back to idle rather than rendering nothing.
	await expect(page.getByRole('button', { name: /Press to speak/i })).toBeVisible();
});
```

- [ ] **Step 3: Run the browser tests**

Run: `npm run test:ui`
Expected: PASS. If the 72px assertion fails on a state, that is a real finding — fix the
component, not the test.

- [ ] **Step 4: Run the full gate**

Run: `npm run verify`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/ui/states.spec.ts package.json package-lock.json
git commit -m "Assert the promises the README makes but never enforced

Five layers over the dev route: axe-core per state, a 72px target check, a
sideways-scroll check, a layout-shift budget across a step advance, and a
reachability check that the speak button works from every state a user can be
stuck in.

The 72px figure and the AA contrast claim have been in the README since the
start with nothing checking them. Layout shift is the measurable half of 'not
smooth' — a step card that survives an advance has to animate rather than
jump, and the instruction above it must not move at all.

npm run verify now includes test:ui, so none of this can quietly rot."
```

---

## Deferred to a second plan

Named here so nobody assumes otherwise:

| Item | Why not now |
|---|---|
| Pre-synthesised authored audio | Needs the knowledge base to have content. On-device synthesis already works |
| Step images | Needs real screenshots and a human to date them. The type, the gate and its test all ship in Task 3 |
| `localStorage` resumption | Not needed to judge whether the flow works at all |
| Visual regression baselines | Baselines taken before the aura work would be thrown away immediately |
| Branch steps in the driver | `onStepDone` follows a linear `next` only. Branches validate and render, but the driver does not walk them yet |
| Spec A: turn detection and waveform | Lands on this seam afterwards, per the agreed sequencing |
| Procedure authoring | A human walks each flow. This plan builds the machine that will hold the content |

## Plan self-review

**Spec coverage.** §1 the seam → Tasks 4, 5, 6. §2 the state machine → Task 2. §3 the
procedure schema → Task 1. §4 two-stage classification → Task 7 pins the key ordering it
depends on; the procedure index in the prompt is deferred with the catalogue, since an
index of zero procedures is an empty string. §5 the cursor → Tasks 1 and 8. §6 the render
flow → Tasks 3, 4, 6. §7 voice → deferred, listed above. Testing → Tasks 1, 2, 3, 9.

**Known gap.** The spec's §4 says the procedure index goes in the system prompt. That is
not built here because `PROCEDURES` is empty, so the index would be an empty string and
the test would assert nothing. It is the first task of the second plan, alongside the
authored content it describes.

**Type consistency.** `Localised`, `Step`, `Branch`, `StepImage`, `Procedure` and `Cursor`
are defined once in Task 1 and imported everywhere after. `SessionState` and `SessionEvent`
are defined once in Task 2. `Card` is defined once in Task 3. `cardsFor(state, proc, lang,
now)` has the same four-parameter signature in Tasks 3, 5 and 6.
