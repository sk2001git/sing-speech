import type { WebStage } from './kb/web-answer';
import type { GuideListing, GuideStatus, KeptGuide } from './kb/web-guides';

/**
 * The owner's review of kept web guides as one value, following the approved mockup
 * (design/admin/admin.html; vault obs-0052). The driver is components/admin/Admin.tsx.
 *
 * Approve and Discard change the screen at once and are sent after the Undo has had its
 * moment (Linear and Gmail do the same), so Undo never needs the server to reverse anything.
 */
export type AdminTab = GuideStatus;
export type AdminAction = 'approve' | 'discard';

export interface AdminState {
	/** null until the session has been checked. */
	signedIn: boolean | null;
	tab: AdminTab;
	guides: GuideListing[];
	/** Whether the list has arrived: until then the queue is not known to be empty. */
	loaded: boolean;
	open: string | null;
	/** The open guide in full, once fetched. */
	detail: KeptGuide | null;
	/** The last action, not yet sent: shown with Undo. */
	undo: { id: string; action: AdminAction; before: GuideListing; at: number } | null;
	adding: { question: string; stage: WebStage | null; pages: number } | null;
	error: string;
}

export type AdminEvent =
	| { type: 'SIGNED_IN' }
	| { type: 'SIGNED_OUT' }
	| { type: 'LOADED'; guides: GuideListing[] }
	| { type: 'TAB'; tab: AdminTab }
	| { type: 'OPEN'; id: string }
	| { type: 'DETAIL'; guide: KeptGuide }
	| { type: 'CLOSE' }
	| { type: 'NEXT' }
	| { type: 'PREV' }
	| { type: 'ACT'; action: AdminAction }
	| { type: 'UNDO' }
	| { type: 'COMMITTED'; id: string }
	| { type: 'ADD_START'; question: string }
	| { type: 'ADD_STAGE'; stage: WebStage }
	| { type: 'ADD_DONE'; guides: GuideListing[]; id: string }
	| { type: 'ADD_FAILED'; error: string }
	| { type: 'ERROR'; error: string };

export function adminStart(): AdminState {
	return { signedIn: null, tab: 'pending', guides: [], loaded: false, open: null, detail: null, undo: null, adding: null, error: '' };
}

/** The guides in the open tab, in the store's order: newest first. */
export const visible = (s: AdminState) => s.guides.filter((g) => g.status === s.tab);

const opened = (s: AdminState, id: string | null): AdminState => ({ ...s, open: id, detail: s.detail && s.detail.id === id ? s.detail : null });

export function adminNext(s: AdminState, e: AdminEvent): AdminState {
	switch (e.type) {
		case 'SIGNED_IN':
			return { ...s, signedIn: true, error: '' };
		case 'SIGNED_OUT':
			return { ...adminStart(), signedIn: false };
		case 'LOADED':
			return { ...s, guides: e.guides, loaded: true };
		case 'TAB':
			return { ...opened(s, null), tab: e.tab };
		case 'OPEN':
			return opened(s, e.id);
		case 'DETAIL':
			return s.open === e.guide.id ? { ...s, detail: e.guide } : s;
		case 'CLOSE':
			return opened(s, null);
		case 'NEXT':
		case 'PREV': {
			const rows = visible(s);
			const i = rows.findIndex((g) => g.id === s.open);
			const j = e.type === 'NEXT' ? i + 1 : i - 1;
			return i < 0 || j < 0 || j >= rows.length ? s : opened(s, rows[j]!.id);
		}
		case 'ACT': {
			const rows = visible(s);
			const i = rows.findIndex((g) => g.id === s.open);
			const row = rows[i];
			if (!row || (e.action === 'approve' && row.status !== 'pending')) return s;
			// The next one opens, so a queue is cleared without going back to the list.
			const then = rows[i + 1] ?? rows[i - 1] ?? null;
			const guides = e.action === 'approve' ? s.guides.map((g) => (g.id === row.id ? { ...g, status: 'live' as const } : g)) : s.guides.filter((g) => g.id !== row.id);
			return { ...opened({ ...s, guides }, then?.id ?? null), undo: { id: row.id, action: e.action, before: row, at: s.guides.indexOf(row) } };
		}
		case 'UNDO': {
			if (!s.undo) return s;
			const { before, at } = s.undo;
			const rest = s.guides.filter((g) => g.id !== before.id);
			const guides = [...rest.slice(0, at), before, ...rest.slice(at)];
			return { ...opened({ ...s, guides, tab: before.status }, before.id), undo: null };
		}
		case 'COMMITTED':
			return s.undo?.id === e.id ? { ...s, undo: null } : s;
		case 'ADD_START':
			return { ...opened(s, null), adding: { question: e.question, stage: null, pages: 0 }, error: '' };
		case 'ADD_STAGE':
			return s.adding ? { ...s, adding: { ...s.adding, stage: e.stage, pages: e.stage.stage === 'reading' ? e.stage.pages : s.adding.pages } } : s;
		case 'ADD_DONE':
			return { ...opened({ ...s, guides: e.guides, tab: 'pending' }, e.id), adding: null };
		case 'ADD_FAILED':
			return { ...s, adding: null, error: e.error };
		case 'ERROR':
			return { ...s, error: e.error };
	}
}
