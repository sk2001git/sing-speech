import { describe, expect, it } from 'vitest';
import { adminNext, adminStart, visible, type AdminEvent, type AdminState } from './admin-flow';
import type { GuideListing } from './kb/web-guides';

/** The owner's review of web guides, as approved in design/admin/admin.html. */
const row = (id: string, status: GuideListing['status'], foundAt = '2026-09-27T00:00:00.000Z'): GuideListing => ({
	id,
	question: `question ${id}`,
	title: `Guide ${id}`,
	sites: ['Coinbase Help'],
	language: 'en',
	status,
	foundAt,
	official: false,
});
const loaded = (): AdminState =>
	run([{ type: 'SIGNED_IN' }, { type: 'LOADED', guides: [row('a', 'pending'), row('b', 'pending'), row('c', 'pending'), row('l', 'live')] }], adminStart());
const run = (events: AdminEvent[], from: AdminState) => events.reduce(adminNext, from);

describe('the review queue', () => {
	it('starts not knowing whether the owner is signed in, then shows Waiting', () => {
		expect(adminStart().signedIn).toBeNull();
		const s = loaded();
		expect(s.tab).toBe('pending');
		expect(visible(s).map((g) => g.id)).toEqual(['a', 'b', 'c']);
	});

	it('switches to Live and closes any open guide', () => {
		const s = run([{ type: 'OPEN', id: 'a' }, { type: 'TAB', tab: 'live' }], loaded());
		expect(visible(s).map((g) => g.id)).toEqual(['l']);
		expect(s.open).toBeNull();
	});

	it('moves through the open tab with next and previous, stopping at the ends', () => {
		const s = run([{ type: 'OPEN', id: 'a' }, { type: 'NEXT' }, { type: 'NEXT' }, { type: 'NEXT' }], loaded());
		expect(s.open).toBe('c');
		expect(run([{ type: 'PREV' }, { type: 'PREV' }, { type: 'PREV' }], s).open).toBe('a');
	});

	it('drops the detail it had when another guide opens', () => {
		const s = run([{ type: 'OPEN', id: 'a' }], loaded());
		const withDetail = adminNext(s, { type: 'DETAIL', guide: { id: 'a' } as never });
		expect(adminNext(withDetail, { type: 'NEXT' }).detail).toBeNull();
	});
});

describe('approve and discard', () => {
	it('approves at once on screen, opens the next guide, and offers Undo', () => {
		const s = run([{ type: 'OPEN', id: 'a' }, { type: 'ACT', action: 'approve' }], loaded());
		expect(visible(s).map((g) => g.id)).toEqual(['b', 'c']);
		expect(s.guides.find((g) => g.id === 'a')?.status).toBe('live');
		expect(s.open).toBe('b');
		expect(s.undo).toMatchObject({ id: 'a', action: 'approve' });
	});

	it('opens the one before when the last is acted on, and closes when none is left', () => {
		const last = run([{ type: 'OPEN', id: 'c' }, { type: 'ACT', action: 'discard' }], loaded());
		expect(last.open).toBe('b');
		const one = run([{ type: 'TAB', tab: 'live' }, { type: 'OPEN', id: 'l' }, { type: 'ACT', action: 'discard' }], loaded());
		expect(one.open).toBeNull();
	});

	it('only approves a guide that is waiting', () => {
		const s = run([{ type: 'TAB', tab: 'live' }, { type: 'OPEN', id: 'l' }], loaded());
		expect(adminNext(s, { type: 'ACT', action: 'approve' })).toBe(s);
	});

	it('undoes, putting the guide back where it was and opening it', () => {
		const s = run([{ type: 'OPEN', id: 'b' }, { type: 'ACT', action: 'discard' }, { type: 'UNDO' }], loaded());
		expect(visible(s).map((g) => g.id)).toEqual(['a', 'b', 'c']);
		expect(s.open).toBe('b');
		expect(s.undo).toBeNull();
	});

	it('forgets the Undo once the action is sent', () => {
		const s = run([{ type: 'OPEN', id: 'a' }, { type: 'ACT', action: 'approve' }, { type: 'COMMITTED', id: 'a' }], loaded());
		expect(s.undo).toBeNull();
		expect(s.guides.find((g) => g.id === 'a')?.status).toBe('live');
	});

	it('keeps a newer Undo when an older action is sent', () => {
		const s = run([{ type: 'OPEN', id: 'a' }, { type: 'ACT', action: 'approve' }, { type: 'ACT', action: 'approve' }, { type: 'COMMITTED', id: 'a' }], loaded());
		expect(s.undo).toMatchObject({ id: 'b' });
	});
});

describe('adding a guide', () => {
	it('shows the search stages, then opens the new guide in Waiting', () => {
		let s = run([{ type: 'TAB', tab: 'live' }, { type: 'ADD_START', question: 'How do I renew my passport?' }], loaded());
		expect(s.adding).toMatchObject({ question: 'How do I renew my passport?', stage: null });
		s = adminNext(s, { type: 'ADD_STAGE', stage: { stage: 'reading', pages: 12 } });
		expect(s.adding).toMatchObject({ stage: { stage: 'reading', pages: 12 }, pages: 12 });
		s = adminNext(s, { type: 'ADD_DONE', guides: [row('new', 'pending'), ...s.guides], id: 'new' });
		expect(s).toMatchObject({ adding: null, tab: 'pending', open: 'new' });
	});

	it('says why when the web had nothing reliable', () => {
		const s = run([{ type: 'ADD_START', question: 'q' }, { type: 'ADD_FAILED', error: 'No reliable answer on the web.' }], loaded());
		expect(s).toMatchObject({ adding: null, error: 'No reliable answer on the web.' });
	});
});

describe('signing out', () => {
	it('forgets the guides', () => {
		const s = adminNext(loaded(), { type: 'SIGNED_OUT' });
		expect(s).toMatchObject({ signedIn: false, guides: [], open: null });
	});
});
