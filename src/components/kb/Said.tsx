import { useState, type FormEvent } from 'react';
import type { EntryLanguage } from '../../lib/kb/entry';

/**
 * The question, as Suara heard it or as it was typed, always open above an answer so the person
 * can check it before reading on, and with "Not right? Change it" so they, or a volunteer beside
 * them, can type the correction and search again (owner, 2026-09-27).
 */
const W = {
	en: { edit: 'Not right? Change it', again: 'Search again', cancel: 'Cancel', field: 'Type the right question, or say it', say: 'Say it instead' },
	'zh-Hans': { edit: '不对？修改', again: '重新搜索', cancel: '取消', field: '输入正确的问题，或直接说', say: '改用说的' },
};

/**
 * `onAsk` takes the typed correction and `onSpeak` records a spoken one; both are sent as a
 * correction of this question (lib/kb/thread.ts), so the model sees what they replace.
 */
export default function Said({
	said,
	label,
	lang,
	onAsk,
	onSpeak,
	startEditing = false,
}: {
	said: string;
	label: string;
	lang: EntryLanguage;
	onAsk?: (text: string) => void;
	onSpeak?: () => void;
	/** Open in the editor: for tests, which render once. */
	startEditing?: boolean;
}) {
	const [editing, setEditing] = useState(startEditing);
	const w = W[lang];
	if (editing && onAsk) {
		const submit = (e: FormEvent<HTMLFormElement>) => {
			e.preventDefault();
			const text = (e.currentTarget.elements.namedItem('q') as HTMLTextAreaElement | null)?.value.trim() ?? '';
			if (!text) return;
			setEditing(false);
			onAsk(text);
		};
		return (
			<form className="k-said k-said-form" onSubmit={submit}>
				<label className="k-heard-label" htmlFor="k-said-q">
					{w.field}
				</label>
				<div className="k-said-input">
					<textarea id="k-said-q" name="q" defaultValue={said} rows={2} maxLength={300} autoFocus />
					{onSpeak && (
						<button
							className="k-said-mic"
							type="button"
							aria-label={w.say}
							onClick={() => {
								setEditing(false);
								onSpeak();
							}}
						>
							<svg className="k-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<rect x="9" y="3" width="6" height="11" rx="3" />
								<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
							</svg>
						</button>
					)}
				</div>
				<div className="k-said-actions">
					<button className="k-btn k-btn-primary k-btn-mid" type="submit">
						{w.again}
					</button>
					<button className="k-link" type="button" onClick={() => setEditing(false)}>
						{w.cancel}
					</button>
				</div>
			</form>
		);
	}
	return (
		<div className="k-said">
			<span className="k-heard-label">{label}</span>
			<p>&ldquo;{said}&rdquo;</p>
			{onAsk && (
				<button className="k-said-edit" type="button" onClick={() => setEditing(true)}>
					{w.edit}
				</button>
			)}
		</div>
	);
}
