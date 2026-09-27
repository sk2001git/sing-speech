import { useState, type FormEvent } from 'react';
import type { EntryLanguage } from '../../lib/kb/entry';

/**
 * The question, as Suara heard it or as it was typed, always open above an answer so the person
 * can check it before reading on, and with "Not right? Change it" so they, or a volunteer beside
 * them, can type the correction and search again (owner, 2026-09-27).
 */
const W = {
	en: { edit: 'Not right? Change it', again: 'Search again', cancel: 'Cancel', field: 'Your question' },
	'zh-Hans': { edit: '不对？修改', again: '重新搜索', cancel: '取消', field: '您的问题' },
};

export default function Said({ said, label, lang, onAsk }: { said: string; label: string; lang: EntryLanguage; onAsk?: (text: string) => void }) {
	const [editing, setEditing] = useState(false);
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
				<textarea id="k-said-q" name="q" defaultValue={said} rows={2} maxLength={300} autoFocus />
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
