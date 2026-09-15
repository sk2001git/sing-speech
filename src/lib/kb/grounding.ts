import type { Entry, EntryLanguage } from './entry';

/**
 * Grounding checks that need no network. Each returns the record stored in
 * `verification.checks`, so what decided an entry's status is kept with the entry.
 */
export type CheckType = 'refs-resolve' | 'quotes-found' | 'lengths' | 'translation-matches-original';

export interface Check {
	type: CheckType;
	passed: boolean;
	at: string;
	note?: string;
}

const NOTE_LIMIT = 300;

function verdict(type: CheckType, problems: string[], at: string): Check {
	if (problems.length === 0) return { type, passed: true, at };
	return { type, passed: false, at, note: problems.join('; ').slice(0, NOTE_LIMIT) };
}

/** Every place a person-visible line cites quotes, labelled by where it sits. */
function citations(e: Entry): Array<[string, string[]]> {
	const out: Array<[string, string[]]> = [['summary', e.summary.quote_refs]];
	e.details?.forEach((d, i) => out.push([`details.${i}`, d.quote_refs]));
	e.steps?.forEach((s, i) => {
		out.push([`steps.${i}`, s.quote_refs]);
		if (s.action?.quote_refs) out.push([`steps.${i}.action`, s.action.quote_refs]);
	});
	if (e.action?.quote_refs) out.push(['action', e.action.quote_refs]);
	return out;
}

export function checkRefsResolve(e: Entry, at: string): Check {
	const quotes = new Set(e.quotes.map((q) => q.id));
	const sources = new Set(e.sources.map((s) => s.id));
	const problems: string[] = [];
	for (const [where, refs] of citations(e)) {
		for (const ref of refs) if (!quotes.has(ref)) problems.push(`${where} cites missing ${ref}`);
	}
	for (const q of e.quotes) if (!sources.has(q.source)) problems.push(`${q.id} cites missing ${q.source}`);
	return verdict('refs-resolve', problems, at);
}

/**
 * Only whitespace is forgiven. Pages reflow text across lines and non-breaking spaces;
 * a changed word, digit or punctuation mark is a different quote.
 */
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** `pages` maps a source id to the main text of its page at retrieval. */
export function checkQuotesFound(e: Entry, pages: Record<string, string>, at: string): Check {
	const problems: string[] = [];
	const text = new Map<string, string>();
	for (const s of e.sources) {
		const page = pages[s.id];
		if (page === undefined) problems.push(`no page text for ${s.id}`);
		else text.set(s.id, squash(page));
	}
	for (const q of e.quotes) {
		const page = text.get(q.source);
		if (page !== undefined && !page.includes(squash(q.text))) problems.push(`${q.id} not found on ${q.source}`);
	}
	return verdict('quotes-found', problems, at);
}

/** What a translation must keep identical: the evidence and which line cites which part of it. */
function structure(e: Entry) {
	return {
		kind: e.kind,
		summary: e.summary.quote_refs,
		details: e.details?.map((d) => d.quote_refs) ?? [],
		steps: e.steps?.map((s) => [s.position, s.quote_refs, s.action?.type ?? null, s.action?.quote_refs ?? null]) ?? [],
		action: e.action ? [e.action.type, e.action.quote_refs ?? null] : null,
	};
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function checkTranslation(original: Entry, translation: Entry, at: string): Check {
	const problems: string[] = [];
	const from = translation.translation_of;

	if (original.translation_of) problems.push('the original is itself a translation');
	if (translation.id !== original.id) problems.push(`id ${translation.id} is not ${original.id}`);
	if (translation.language === original.language) problems.push(`language is the original's (${original.language})`);
	if (!from) problems.push('not marked as a translation');
	else if (from.id !== original.id) problems.push(`translation_of names ${from.id}`);
	else if (from.version !== original.lifecycle.version)
		problems.push(`made from version ${from.version}, original is version ${original.lifecycle.version}`);

	if (!same(translation.quotes, original.quotes)) problems.push('quotes differ from the original');
	if (!same(translation.sources, original.sources)) problems.push('sources differ from the original');

	const a = structure(original);
	const b = structure(translation);
	for (const part of Object.keys(a) as Array<keyof typeof a>) {
		if (!same(a[part], b[part])) problems.push(`${part} structure differs from the original`);
	}
	return verdict('translation-matches-original', problems, at);
}

/** Decided from the original's metadata alone, so no translation row is read to find out. */
export function needsTranslation(original: Entry, language: EntryLanguage): boolean {
	if (language === original.language) return false;
	const record = (original.translations as Partial<Record<EntryLanguage, { from_version: number }>> | undefined)?.[language];
	return !record || record.from_version < original.lifecycle.version;
}
