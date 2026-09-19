import { z } from 'zod';

/**
 * A journey: one life event, carried as ordered stages rather than forty separate questions.
 *
 * A death in the family is not a question. It is forty of them, owed to nine agencies, over
 * nine months, in an order that matters, carried by somebody grieving who has never done it
 * before. What makes that a product rather than a list is time, priority and an ending
 * (vault plan-suara-0010, the owner's direction of 2026-09-19):
 *
 *  - `when` is the window, not a date — a person in the first day should not be reading
 *    about probate;
 *  - `priority` separates what is urgent from what merely feels it;
 *  - `blocked_by` holds back only work that genuinely cannot start yet;
 *  - `done_when` is how a person knows a stage is finished, and they say so — Suara never
 *    infers it, because being wrong means a missed legal deadline;
 *  - `concludes_when` is the ending. A journey without one is a list that follows a
 *    grieving person around for the rest of their life.
 *
 * The journey itself asserts nothing about entitlements: every factual line a person reads
 * comes from the cards, which are quoted from official pages and checked. A stage with no
 * card behind it would be our words wearing an agency's authority, so it is rejected.
 */
export const JOURNEY_SCHEMA_VERSION = '1.0.0';

/** How far away the work is, in the words a person would use. */
export const HORIZONS = ['within-24-hours', 'first-week', 'first-month', 'months', 'when-ready'] as const;
export type Horizon = (typeof HORIZONS)[number];

/** What is actually urgent, against what merely feels it at the time. */
export const PRIORITIES = ['must-do-now', 'soon', 'settlement', 'optional'] as const;
export type Priority = (typeof PRIORITIES)[number];

const HORIZON_ORDER: Record<Horizon, number> = {
	'within-24-hours': 0,
	'first-week': 1,
	'first-month': 2,
	months: 3,
	'when-ready': 4,
};

const PRIORITY_ORDER: Record<Priority, number> = { 'must-do-now': 0, soon: 1, settlement: 2, optional: 3 };

/** More than this in front of somebody at once is not a list they can hold. */
export const AT_ONCE = 3;

const ENTRY_ID = /^sg\.[a-z0-9]+\.[a-z0-9]+(-[a-z0-9]+)*$/;
const STAGE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const text = (min: number, max: number) => z.string().min(min).max(max);

const Stage = z.strictObject({
	id: z.string().regex(STAGE_ID),
	name: text(1, 60),
	/** One line saying what this stage is, in the person's register. */
	note: text(1, 300).optional(),
	when: z.enum(HORIZONS),
	priority: z.enum(PRIORITIES),
	/** Who they will be dealing with: an agency, a service, or a kind of firm. */
	who: z.array(text(1, 60)).min(1).max(6),
	/** The cards a person reads here. Each is a grounded entry. */
	cards: z.array(z.string().regex(ENTRY_ID)).min(1).max(8),
	/** How a person knows this one is finished. They decide, not us. */
	done_when: text(1, 160),
	/** Stages that genuinely have to happen first. */
	blocked_by: z.array(z.string().regex(STAGE_ID)).max(6).default([]),
});

export const Journey = z
	.strictObject({
		schema_version: z.literal(JOURNEY_SCHEMA_VERSION),
		id: z.string().regex(/^sg\.journey\.[a-z0-9]+(-[a-z0-9]+)*$/),
		language: z.enum(['en', 'zh-Hans']),
		title: z.strictObject({ short: text(1, 20), full: text(1, 70) }),
		summary: text(1, 200),
		search: z.strictObject({ example_phrasings: z.array(text(3, 120)).min(3).max(12) }),
		stages: z.array(Stage).min(1).max(20),
		concludes_when: text(1, 200),
	})
	.superRefine((j, ctx) => {
		const ids = new Set<string>();
		for (const s of j.stages) {
			if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: ['stages'], message: `two stages called ${s.id}` });
			ids.add(s.id);
		}

		for (const s of j.stages) {
			for (const needs of s.blocked_by) {
				if (needs === s.id) {
					ctx.addIssue({ code: 'custom', path: ['stages'], message: `${s.id} waits on itself` });
					continue;
				}
				const before = j.stages.find((other) => other.id === needs);
				if (!before) {
					ctx.addIssue({ code: 'custom', path: ['stages'], message: `${s.id} waits on ${needs}, which is not a stage here` });
					continue;
				}
				// Urgent work cannot wait on work that is months away: that is not an order, it
				// is a contradiction, and a person would sit on their hands holding a deadline.
				if (HORIZON_ORDER[before.when] > HORIZON_ORDER[s.when]) {
					ctx.addIssue({
						code: 'custom',
						path: ['stages'],
						message: `${s.id} is due ${s.when} but waits on ${needs}, which is not until ${before.when}`,
					});
				}
			}
		}

		// A cycle further round than a pair.
		const seen = new Map<string, number>();
		const walk = (id: string): boolean => {
			const mark = seen.get(id) ?? 0;
			if (mark === 1) return true;
			if (mark === 2) return false;
			seen.set(id, 1);
			const here = j.stages.find((s) => s.id === id);
			for (const needs of here?.blocked_by ?? []) if (walk(needs)) return true;
			seen.set(id, 2);
			return false;
		};
		for (const s of j.stages) {
			if (walk(s.id)) {
				ctx.addIssue({ code: 'custom', path: ['stages'], message: `stages wait on each other in a cycle, at ${s.id}` });
				break;
			}
		}

		const urgent = j.stages.filter((s) => s.priority === 'must-do-now');
		if (urgent.length > AT_ONCE) {
			ctx.addIssue({
				code: 'custom',
				path: ['stages'],
				message: `${urgent.length} stages are must-do-now; a person can hold three`,
			});
		}
	});

export type Journey = z.infer<typeof Journey>;
export type Stage = z.infer<typeof Stage>;

export type ParsedJourney = { ok: true; entry: Journey } | { ok: false; errors: string[] };

export function parseJourney(input: unknown): ParsedJourney {
	const result = Journey.safeParse(input);
	if (result.success) return { ok: true, entry: result.data };
	return { ok: false, errors: result.error.issues.map((i) => `${i.path.join('.') || '(journey)'}: ${i.message}`) };
}

export interface WhereTheyAre {
	/** What can be started, soonest and most urgent first, never more than three. */
	now: Stage[];
	/** Real work, not yet: it waits on something, or its time has not come. */
	later: Stage[];
	/** What they have told us is finished. */
	done: Stage[];
	finished: boolean;
}

const order = (a: Stage, b: Stage) =>
	HORIZON_ORDER[a.when] - HORIZON_ORDER[b.when] || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];

/**
 * What to put in front of somebody, given what they have already done.
 *
 * The filter the owner asked for: urgent work first and alone, everything that genuinely
 * waits held back until it can be started, and a plain answer to whether this is over.
 */
export function nowNext(journey: Journey, done: ReadonlySet<string>): WhereTheyAre {
	const finishedStages = journey.stages.filter((s) => done.has(s.id));
	const remaining = journey.stages.filter((s) => !done.has(s.id));
	const ready = remaining.filter((s) => s.blocked_by.every((needs) => done.has(needs)));
	const waiting = remaining.filter((s) => !ready.includes(s));

	const sorted = [...ready].sort(order);
	return {
		now: sorted.slice(0, AT_ONCE),
		later: [...sorted.slice(AT_ONCE), ...waiting].sort(order),
		done: finishedStages,
		finished: remaining.length === 0,
	};
}
