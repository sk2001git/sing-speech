import { useEffect, useMemo, useRef, useState } from 'react';
import { quickFind, type Findable, type Hit } from '../../lib/kb/quick';

/**
 * Find: type a few letters and the card appears.
 *
 * For the helper at a counter with somebody waiting, and for anyone who would rather type
 * than talk. Ctrl+K or Cmd+K opens it, but the shortcut is not the door — the primary user
 * will never press it, so there is a Find control in the header at the same size as
 * everything else.
 *
 * Everything here happens in the browser: the small index of labels is fetched once, on
 * first open, and scored on each keystroke (`quick.ts`). No request goes out while a person
 * types, which also means nothing about what they type leaves the phone.
 */
export interface PaletteWords {
	find: string;
	placeholder: string;
	nothing: string;
	speakInstead: string;
	close: string;
}

export interface PaletteProps {
	open: boolean;
	words: PaletteWords;
	onClose: () => void;
	/** Opens the chosen card exactly as a spoken question would. */
	onChoose: (id: string, label: string) => void;
	onSpeak: () => void;
	/** Where the index lives. Overridden in tests. */
	source?: string;
	/** Given instead of fetching, in tests. */
	items?: Findable[];
}

const LIMIT = 6;

/** The matched letters marked, so a person can see why a card is being offered. */
function Marked({ text, marks }: { text: string; marks: [number, number][] }) {
	if (marks.length === 0) return <>{text}</>;
	const parts: React.ReactNode[] = [];
	let at = 0;
	for (const [from, to] of marks) {
		if (from > at) parts.push(text.slice(at, from));
		parts.push(<mark key={`${from}-${to}`}>{text.slice(from, to)}</mark>);
		at = to;
	}
	if (at < text.length) parts.push(text.slice(at));
	return <>{parts}</>;
}

export default function Palette({ open, words, onClose, onChoose, onSpeak, source = '/kb/find.json', items }: PaletteProps) {
	const [index, setIndex] = useState<Findable[]>(items ?? []);
	const [typed, setTyped] = useState('');
	const [cursor, setCursor] = useState(0);
	const box = useRef<HTMLInputElement>(null);
	/** Focus goes back where it came from when this closes. */
	const opener = useRef<Element | null>(null);

	useEffect(() => {
		if (!open || items || index.length > 0) return;
		let live = true;
		fetch(source)
			.then((res) => (res.ok ? (res.json() as Promise<{ cards?: Findable[] }>) : Promise.reject(new Error(String(res.status)))))
			.then((body) => {
				if (live) setIndex(body.cards ?? []);
			})
			// A palette that cannot load its index simply finds nothing; the microphone still works.
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [open, source, items, index.length]);

	useEffect(() => {
		if (open) {
			opener.current = document.activeElement;
			box.current?.focus();
			setTyped('');
			setCursor(0);
		} else if (opener.current instanceof HTMLElement) {
			opener.current.focus();
		}
	}, [open]);

	const hits: Hit[] = useMemo(() => quickFind(index, typed, LIMIT), [index, typed]);
	useEffect(() => setCursor(0), [typed]);

	if (!open) return null;

	const choose = (hit: Hit | undefined) => {
		if (!hit) return;
		onChoose(hit.item.id, hit.item.label);
		onClose();
	};

	const onKey = (event: React.KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			setCursor((c) => Math.min(c + 1, Math.max(hits.length - 1, 0)));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			setCursor((c) => Math.max(c - 1, 0));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			choose(hits[cursor]);
		}
	};

	return (
		<div className="k-find-wrap" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="k-find" role="dialog" aria-modal="true" aria-label={words.find} onKeyDown={onKey}>
				<div className="k-find-box">
					<SearchIcon />
					<input
						ref={box}
						className="k-find-input"
						type="search"
						value={typed}
						placeholder={words.placeholder}
						aria-label={words.placeholder}
						aria-controls="k-find-list"
						aria-activedescendant={hits[cursor] ? `k-find-${hits[cursor]!.item.id}` : undefined}
						autoComplete="off"
						spellCheck={false}
						onChange={(e) => setTyped(e.target.value)}
					/>
					<button className="k-find-close" type="button" onClick={onClose} aria-label={words.close}>
						{words.close}
					</button>
				</div>

				{typed.trim() !== '' && hits.length === 0 ? (
					<div className="k-find-empty">
						<p>{words.nothing}</p>
						<button
							className="k-btn k-btn-quiet"
							type="button"
							onClick={() => {
								onClose();
								onSpeak();
							}}
						>
							{words.speakInstead}
						</button>
					</div>
				) : (
					<ul className="k-find-list" id="k-find-list" role="listbox" aria-label={words.find}>
						{hits.map((hit, i) => (
							<li key={hit.item.id}>
								<button
									id={`k-find-${hit.item.id}`}
									className="k-find-hit"
									type="button"
									role="option"
									aria-selected={i === cursor}
									data-on={i === cursor}
									onMouseEnter={() => setCursor(i)}
									onClick={() => choose(hit)}
								>
									<span className="k-find-label">
										<Marked text={hit.item.label} marks={hit.marks} />
									</span>
									<span className="k-find-heading">{hit.item.heading}</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function SearchIcon() {
	return (
		<svg className="k-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
			<circle cx="11" cy="11" r="6.5" />
			<path d="m16 16 4.5 4.5" />
		</svg>
	);
}
