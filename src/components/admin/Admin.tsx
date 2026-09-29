import '../../lib/session-client';
import { useEffect, useReducer, useRef, type FormEvent, type ReactNode } from 'react';
import { adminNext, adminStart, visible, type AdminAction, type AdminEvent, type AdminState } from '../../lib/admin-flow';
import type { WebStage } from '../../lib/kb/web-answer';
import type { GuideListing, KeptGuide } from '../../lib/kb/web-guides';

/**
 * The owner's review of kept web guides, as approved in design/admin/admin.html (vault obs-0052,
 * dec-suara-0024). Every pixel is in AdminView; the network, the deferred actions and the
 * keyboard are in Admin; every transition is in lib/admin-flow.ts.
 */
export interface AdminViewProps {
	state: AdminState;
	/** For "Today" and "3 days ago". */
	now: number;
	dispatch: (e: AdminEvent) => void;
	onSignIn: (password: string) => void;
	onSignOut: () => void;
	onAdd: (question: string) => void;
	/** Approve or discard the open guide; the driver defers it behind Undo. */
	onAct?: (action: AdminAction) => void;
	onUndo?: () => void;
}

const DAY = 86_400_000;
const gov = (u: string) => {
	try {
		return new URL(u).hostname.endsWith('.gov.sg');
	} catch {
		return false;
	}
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ago = (foundAt: string, now: number) => {
	const days = Math.max(0, Math.floor((now - Date.parse(foundAt)) / DAY));
	return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
};

export function AdminView(p: AdminViewProps) {
	const s = p.state;
	if (s.signedIn === null) return <div className="adm" />;
	if (!s.signedIn) return <SignIn {...p} />;
	return (
		<div className="adm">
			<Bar onSignOut={p.onSignOut} />
			<main className="page">
				<div>
					<h1>Web guides</h1>
					<p className="lead">Answers Suara found on the web and kept, so the next person is answered at once. Each stays until you take it down.</p>
				</div>
				<AddForm onAdd={p.onAdd} busy={Boolean(s.adding)} />
				{s.error && (
					<p className="err" role="alert">
						{s.error}
					</p>
				)}
				<Tabs {...p} />
				<List {...p} />
			</main>
			{s.adding ? <Adding state={s} /> : s.open ? <Drawer {...p} /> : null}
			{s.undo && <Toast {...p} />}
		</div>
	);
}

function SignIn(p: AdminViewProps) {
	const submit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const pw = (e.currentTarget.elements.namedItem('pw') as HTMLInputElement | null)?.value ?? '';
		if (pw) p.onSignIn(pw);
	};
	return (
		<div className="adm">
			<main className="signin">
				<form className="card" onSubmit={submit}>
					<span className="mk">
						<WaveIcon />
					</span>
					<h1>Suara admin</h1>
					<p className="lead">Review the guides Suara found on the web before anyone else sees them.</p>
					<div className="field">
						<label htmlFor="pw">Password</label>
						<input id="pw" name="pw" type="password" autoComplete="current-password" autoFocus required />
					</div>
					{p.state.error && (
						<p className="err" role="alert">
							{p.state.error}
						</p>
					)}
					<button className="btn big" type="submit">
						Sign in
					</button>
				</form>
			</main>
		</div>
	);
}

function Bar({ onSignOut }: { onSignOut: () => void }) {
	return (
		<header className="bar">
			<span className="mk">
				<WaveIcon />
			</span>
			<span className="nm">
				Suara <small>Web guides</small>
			</span>
			<span className="grow" />
			<button className="btn quiet icon-sm" type="button" onClick={onSignOut} aria-label="Sign out">
				<OutIcon />
				<span className="tx">Sign out</span>
			</button>
		</header>
	);
}

function AddForm({ onAdd, busy }: { onAdd: (q: string) => void; busy: boolean }) {
	const submit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const input = e.currentTarget.elements.namedItem('q') as HTMLInputElement | null;
		const q = input?.value.trim() ?? '';
		if (!input || q.length < 3 || busy) return;
		onAdd(q);
		input.value = '';
	};
	return (
		<form className="add" onSubmit={submit}>
			<input name="q" placeholder="Add a guide: type a question" aria-label="Add a guide: type a question" autoComplete="off" maxLength={240} />
			<button className="btn" type="submit" disabled={busy}>
				<PlusIcon />
				<span className="tx">Find it</span>
			</button>
		</form>
	);
}

function Tabs({ state, dispatch }: AdminViewProps) {
	const count = (status: GuideListing['status']) => state.guides.filter((g) => g.status === status).length;
	const tab = (status: GuideListing['status'], label: string) => (
		<button className="tab" role="tab" type="button" aria-selected={state.tab === status} onClick={() => dispatch({ type: 'TAB', tab: status })}>
			{label} <span className="count">{count(status)}</span>
		</button>
	);
	return (
		<div className="tabs" role="tablist">
			{tab('pending', 'Waiting')}
			{tab('live', 'Live')}
		</div>
	);
}

function List({ state, dispatch, now }: AdminViewProps) {
	const rows = visible(state);
	if (!state.loaded) {
		return (
			<div className="list">
				<div className="skel" aria-hidden="true">
					<i />
					<i />
					<i />
				</div>
			</div>
		);
	}
	if (rows.length === 0) {
		return (
			<div className="list">
				{state.tab === 'pending' ? (
					<div className="empty">
						<b>Nothing waiting</b>
						<span>A guide that cites any site other than government pages lands here before anyone sees it.</span>
					</div>
				) : (
					<div className="empty">
						<b>No live guides yet</b>
						<span>Guides from government pages go live by themselves. Approved ones join them.</span>
					</div>
				)}
			</div>
		);
	}
	return (
		<div className="list">
			{rows.map((g) => (
				<button key={g.id} className="row" type="button" aria-current={state.open === g.id} onClick={() => dispatch({ type: 'OPEN', id: g.id })}>
					<span className="t">{g.title}</span>
					<span className="side">
						{g.status === 'pending' ? (
							<span className="badge wait">Waiting</span>
						) : (
							<span className="badge live">
								<TickIcon />
								Live
							</span>
						)}
						<span className="age">{ago(g.foundAt, now)}</span>
					</span>
					<span className="q">&ldquo;{g.question}&rdquo;</span>
					<span className="m">
						<span>{g.sites.join(', ')}</span>
						{g.official && <span className="badge gov">Government pages only</span>}
					</span>
				</button>
			))}
		</div>
	);
}

function Drawer(p: AdminViewProps) {
	const s = p.state;
	const rows = visible(s);
	const i = rows.findIndex((g) => g.id === s.open);
	const row = rows[i];
	if (!row) return null;
	const close = () => p.dispatch({ type: 'CLOSE' });
	return (
		<>
			<div className="scrim" onClick={close} aria-hidden="true" />
			<aside className="drawer" role="dialog" aria-modal="true" aria-label={row.title}>
				<div className="dh">
					<span className="pos">
						{i + 1} of {rows.length} {s.tab === 'pending' ? 'waiting' : 'live'}
					</span>
					<span className="grow" />
					<button className="ib" type="button" aria-label="Previous" disabled={i === 0} onClick={() => p.dispatch({ type: 'PREV' })}>
						<UpIcon />
					</button>
					<button className="ib" type="button" aria-label="Next" disabled={i === rows.length - 1} onClick={() => p.dispatch({ type: 'NEXT' })}>
						<DownIcon />
					</button>
					<button className="ib" type="button" aria-label="Close" onClick={close}>
						<CrossIcon />
					</button>
				</div>
				<div className="db">
					{s.detail && s.detail.id === row.id ? (
						<Evidence guide={s.detail} now={p.now} />
					) : (
						<div className="skel" aria-hidden="true">
							<i />
							<i />
							<i />
						</div>
					)}
				</div>
				<div className="df">
					{row.status === 'pending' ? (
						<>
							<button className="btn danger big" type="button" onClick={() => p.onAct?.('discard')}>
								Discard
							</button>
							<button className="btn big" type="button" onClick={() => p.onAct?.('approve')}>
								<TickIcon />
								Approve
							</button>
						</>
					) : (
						<button className="btn danger big" type="button" onClick={() => p.onAct?.('discard')}>
							Take down
						</button>
					)}
				</div>
				<p className="keys">
					<kbd>A</kbd> approve · <kbd>D</kbd> discard · <kbd>J</kbd> <kbd>K</kbd> next and previous · <kbd>Esc</kbd> close
				</p>
			</aside>
		</>
	);
}

/** The guide exactly as a person would see it, and every page it came from (Stripe's evidence). */
function Evidence({ guide, now }: { guide: KeptGuide; now: number }) {
	const g = guide.answer;
	const others = [...new Set(g.sources.filter((src) => !gov(src.url)).map((src) => src.site))];
	const why =
		guide.status === 'pending' ? (
			<div className="why">
				<InfoIcon />
				<span>
					{others.length ? `Waiting because it cites ${others.join(', ')}, not only government pages.` : 'Waiting because you added it.'} Check the pages below say what the guide says.
				</span>
			</div>
		) : (
			<div className="why ok">
				<TickIcon />
				<span>{g.official ? 'Live by itself: every page it cites is a government page.' : 'Live: you approved it.'} Stays until you take it down.</span>
			</div>
		);
	return (
		<>
			{why}
			<p className="asked">
				Asked: <b>&ldquo;{guide.question}&rdquo;</b> · {ago(guide.foundAt, now)}
			</p>
			<section className="phone">
				<span className="webb">
					<GlobeIcon />
					From the web
				</span>
				<p className="gt">{g.title_full}</p>
				{g.kind === 'steps' ? (
					<>
						<p className="gs">{g.summary}</p>
						{g.prerequisites && (
							<p className="pre">
								<b>Before you start:</b> {g.prerequisites}
							</p>
						)}
						<ol className="steps">
							{g.steps.map((st, n) => (
								<li key={n}>
									<b>{st.name}</b>
									<span>{st.text}</span>
								</li>
							))}
						</ol>
					</>
				) : (
					<p className="gs ink">{g.answer}</p>
				)}
				{g.legal.applies && (
					<div className="legal">
						<span className="lh">
							<ScaleIcon />
							Legal
						</span>
						{g.legal.text}
					</div>
				)}
				<p className="fine">{`${g.official ? 'From official government pages, found by web search.' : 'Found on the web, not an official answer.'}${g.disclaimer ? ` ${g.disclaimer}` : ''}`}</p>
			</section>
			<div className="srcs">
				<div className="h">
					<span>WHERE THIS IS FROM</span>
					<span>{plural(g.sources.length, 'page', 'pages')}</span>
				</div>
				{g.sources.map((src) => (
					<a key={src.url} className="src" href={src.url} target="_blank" rel="noopener noreferrer">
						<div>
							<b>
								{src.site}
								{gov(src.url) ? ' · gov' : ''}
							</b>
							<span>{src.title}</span>
						</div>
						<ExtIcon />
					</a>
				))}
			</div>
		</>
	);
}

function Adding({ state }: { state: AdminState }) {
	const a = state.adding!;
	const at = a.stage ? ['searching', 'reading', 'writing'].indexOf(a.stage.stage) : 0;
	const mark = (i: number) => (i < at ? 'done' : i === at ? 'now' : 'todo');
	return (
		<>
			<div className="scrim" aria-hidden="true" />
			<aside className="drawer" role="dialog" aria-modal="true" aria-label="Finding a guide">
				<div className="dh">
					<span className="pos">Adding a guide</span>
				</div>
				<div className="db">
					<p className="asked">
						Question: <b>&ldquo;{a.question}&rdquo;</b>
					</p>
					<h2 className="h2" aria-live="polite">
						Searching the web
					</h2>
					<div className="stages">
						<div className="stage" data-s={mark(0)}>
							<i />
							Finding pages
						</div>
						<div className="stage" data-s={mark(1)}>
							<i />
							{a.pages ? `Reading ${plural(a.pages, 'page', 'pages')}` : 'Reading the pages'}
						</div>
						<div className="stage" data-s={mark(2)}>
							<i />
							Writing the guide
						</div>
					</div>
					<p className="lead">It lands in Waiting for you to check, whichever pages it uses.</p>
				</div>
			</aside>
		</>
	);
}

function Toast(p: AdminViewProps) {
	const u = p.state.undo!;
	const text = u.action === 'approve' ? 'Approved. It is live now.' : u.before.status === 'live' ? 'Taken down.' : 'Discarded.';
	return (
		<div className="toast" role="status">
			<span>{text}</span>
			<button type="button" onClick={p.onUndo}>
				Undo
			</button>
		</div>
	);
}

/** How long Undo is offered before the action is sent. */
const UNDO_MS = 5000;

async function readLines(res: Response, onLine: (line: Record<string, unknown>) => void): Promise<void> {
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (value) buf += decoder.decode(value, { stream: true });
		let cut: number;
		while ((cut = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, cut).trim();
			buf = buf.slice(cut + 1);
			if (line) onLine(JSON.parse(line) as Record<string, unknown>);
		}
		if (done) return;
	}
}

export default function Admin() {
	const [state, dispatch] = useReducer(adminNext, undefined, adminStart);
	const latest = useRef(state);
	latest.current = state;
	/** The last action, shown with Undo and not yet sent. */
	const waiting = useRef<{ id: string; action: AdminAction; timer: ReturnType<typeof setTimeout> } | null>(null);

	async function load(): Promise<void> {
		const res = await fetch('/api/guides', { cache: 'no-store' });
		if (res.status === 401) return dispatch({ type: 'SIGNED_OUT' });
		if (!res.ok) return dispatch({ type: 'ERROR', error: 'Could not load the guides.' });
		dispatch({ type: 'LOADED', guides: ((await res.json()) as { guides: GuideListing[] }).guides });
	}

	useEffect(() => {
		void (async () => {
			const res = await fetch('/api/admin/session', { cache: 'no-store' });
			const { signedIn } = (await res.json()) as { signedIn: boolean };
			if (!signedIn) return dispatch({ type: 'SIGNED_OUT' });
			dispatch({ type: 'SIGNED_IN' });
			await load();
		})();
	}, []);

	// The open guide in full, for its evidence.
	useEffect(() => {
		const id = state.open;
		if (!id || state.detail?.id === id) return;
		void (async () => {
			const res = await fetch(`/api/guides?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
			if (res.ok) dispatch({ type: 'DETAIL', guide: ((await res.json()) as { guide: KeptGuide }).guide });
		})();
	}, [state.open]);

	function send(id: string, action: AdminAction): void {
		// keepalive: the action still reaches the server if the tab is closed straight after.
		void fetch('/api/guides', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }) }).then(
			(res) => {
				if (!res.ok) {
					dispatch({ type: 'ERROR', error: 'That did not save. The list has been reloaded.' });
					void load();
				}
			},
			() => dispatch({ type: 'ERROR', error: 'That did not save. Check the connection.' }),
		);
		dispatch({ type: 'COMMITTED', id });
	}

	/** Send the action waiting behind Undo now: another action came, or the page is closing. */
	function flush(): void {
		const w = waiting.current;
		if (!w) return;
		clearTimeout(w.timer);
		waiting.current = null;
		send(w.id, w.action);
	}

	function act(action: AdminAction): void {
		const s = latest.current;
		const row = visible(s).find((g) => g.id === s.open);
		if (!row || (action === 'approve' && row.status !== 'pending')) return;
		flush();
		dispatch({ type: 'ACT', action });
		const id = row.id;
		waiting.current = {
			id,
			action,
			timer: setTimeout(() => {
				waiting.current = null;
				send(id, action);
			}, UNDO_MS),
		};
	}

	function undo(): void {
		const w = waiting.current;
		if (w) clearTimeout(w.timer);
		waiting.current = null;
		dispatch({ type: 'UNDO' });
	}

	useEffect(() => {
		const onHide = () => flush();
		window.addEventListener('pagehide', onHide);
		return () => window.removeEventListener('pagehide', onHide);
	}, []);

	// Linear's and Stripe's keys: A approve, D discard, J / K next and previous, Esc close.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const s = latest.current;
			if (!s.open || s.adding || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest('input, textarea')) return;
			const k = e.key.toLowerCase();
			if (k === 'a') act('approve');
			else if (k === 'd') act('discard');
			else if (k === 'j') dispatch({ type: 'NEXT' });
			else if (k === 'k') dispatch({ type: 'PREV' });
			else if (k === 'escape') dispatch({ type: 'CLOSE' });
			else return;
			e.preventDefault();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	async function signIn(password: string): Promise<void> {
		const res = await fetch('/api/admin/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
		if (!res.ok) return dispatch({ type: 'ERROR', error: 'That is not the password.' });
		dispatch({ type: 'SIGNED_IN' });
		await load();
	}

	async function signOut(): Promise<void> {
		flush();
		await fetch('/api/admin/session', { method: 'DELETE' });
		dispatch({ type: 'SIGNED_OUT' });
	}

	async function add(question: string): Promise<void> {
		flush();
		dispatch({ type: 'ADD_START', question });
		try {
			const res = await fetch('/api/guides/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
			if (res.status === 401) return dispatch({ type: 'SIGNED_OUT' });
			if (!res.ok || !res.body) throw new Error(String(res.status));
			let added: string | null = null;
			let error = '';
			await readLines(res, (line) => {
				if (line.type === 'stage') {
					const { type: _t, ...stage } = line;
					dispatch({ type: 'ADD_STAGE', stage: stage as WebStage });
				} else if (line.type === 'guide') added = (line.guide as KeptGuide).id;
				else if (line.type === 'error') error = String(line.error);
			});
			if (!added) return dispatch({ type: 'ADD_FAILED', error: error || 'The web search failed. Try again in a moment.' });
			const list = await fetch('/api/guides', { cache: 'no-store' });
			const { guides } = (await list.json()) as { guides: GuideListing[] };
			dispatch({ type: 'ADD_DONE', guides, id: added });
		} catch {
			dispatch({ type: 'ADD_FAILED', error: 'The web search failed. Try again in a moment.' });
		}
	}

	return <AdminView state={state} now={Date.now()} dispatch={dispatch} onSignIn={signIn} onSignOut={signOut} onAdd={add} onAct={act} onUndo={undo} />;
}

/* Icons: inline SVG, as in KbScreen. */
function Svg({ children, size = 18, width = 2 }: { children: ReactNode; size?: number; width?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{children}
		</svg>
	);
}
const WaveIcon = () => (
	<Svg width={2.2}>
		<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3" />
	</Svg>
);
const GlobeIcon = () => (
	<Svg size={15}>
		<circle cx="12" cy="12" r="9" />
		<path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
	</Svg>
);
const ScaleIcon = () => (
	<Svg size={15}>
		<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z" />
	</Svg>
);
const PlusIcon = () => (
	<Svg width={2.4}>
		<path d="M12 5v14M5 12h14" />
	</Svg>
);
const CrossIcon = () => (
	<Svg width={2.2}>
		<path d="M6 6l12 12M18 6 6 18" />
	</Svg>
);
const UpIcon = () => (
	<Svg width={2.2}>
		<path d="m6 15 6-6 6 6" />
	</Svg>
);
const DownIcon = () => (
	<Svg width={2.2}>
		<path d="m6 9 6 6 6-6" />
	</Svg>
);
const TickIcon = () => (
	<Svg size={16} width={2.6}>
		<path d="m5 12.5 4.5 4.5L19 7.5" />
	</Svg>
);
const ExtIcon = () => (
	<Svg size={16}>
		<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
	</Svg>
);
const InfoIcon = () => (
	<Svg>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 11v5.5M12 7.5v.01" />
	</Svg>
);
const OutIcon = () => (
	<Svg>
		<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10" />
	</Svg>
);
