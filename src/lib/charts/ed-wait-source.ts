import type { KvLike } from '../kb/web-guides';
import { ED_WAIT_PAGE, edWaitDays, findEdWaitFile, summariseEdWait, type EdWaitSummary } from './ed-wait';
import { readSheets } from './xlsx';

/**
 * The A&E chart's figures at request time (vault plan-suara-0017). MOH publishes weekly; a person
 * asking should never wait on MOH's site, so:
 *
 *   a copy in KV under a day old          served as is
 *   a copy older than that                served at once, refreshed in the background
 *   no copy                               MOH's page and file, fetched now (8 s at most)
 *   MOH unreachable                       whatever copy there is, else the one built into the app
 *
 * The chart's credit shows `fetchedAt`, so an old copy is never passed off as today's.
 */
export interface EdWaitChart extends EdWaitSummary {
	fetchedAt: string;
	/** The spreadsheet the figures were read from. */
	file: string;
}

/** Honest about who is asking: MOH's file server refuses curl's default agent, not this one. */
export const SUARA_AGENT = 'SuaraBot/0.1 (+https://suara.sg; public-good help for older Singaporeans)';
const KEY = 'chart:ed-wait';
const FRESH_MS = 24 * 3_600_000;

export interface LoadEdWaitOptions {
	kv: KvLike | undefined;
	fetchImpl?: typeof fetch;
	now?: () => number;
	/** The copy built into the app, for when there is no other. */
	snapshot: EdWaitChart;
	waitUntil?: (p: Promise<unknown>) => void;
	timeoutMs?: number;
}

async function fromMoh(fetchImpl: typeof fetch, now: number, timeoutMs: number): Promise<EdWaitChart> {
	const get = (url: string) => fetchImpl(url, { headers: { 'user-agent': SUARA_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
	const page = await get(ED_WAIT_PAGE);
	if (!page.ok) throw new Error(`MOH page ${page.status}`);
	const file = findEdWaitFile(await page.text());
	if (!file) throw new Error("no spreadsheet on MOH's page");
	const res = await get(file);
	if (!res.ok) throw new Error(`MOH file ${res.status}`);
	const summary = summariseEdWait(edWaitDays(await readSheets(new Uint8Array(await res.arrayBuffer()))));
	return { ...summary, fetchedAt: new Date(now).toISOString(), file: decodeURIComponent(file.split('/').pop() ?? '') };
}

export async function loadEdWait(opts: LoadEdWaitOptions): Promise<EdWaitChart> {
	const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
	const now = opts.now ?? Date.now;
	const timeoutMs = opts.timeoutMs ?? 8000;
	const kept = opts.kv ? ((await opts.kv.get(KEY, 'json').catch(() => null)) as EdWaitChart | null) : null;

	const refresh = async () => {
		const chart = await fromMoh(fetchImpl, now(), timeoutMs);
		await opts.kv?.put(KEY, JSON.stringify(chart));
		return chart;
	};

	if (kept) {
		if (now() - Date.parse(kept.fetchedAt) < FRESH_MS) return kept;
		const background = refresh().catch((err) => console.error('A&E figures not refreshed:', err instanceof Error ? err.message : err));
		if (opts.waitUntil) opts.waitUntil(background);
		else await background;
		return opts.waitUntil ? kept : ((await opts.kv?.get(KEY, 'json')) as EdWaitChart | null) ?? kept;
	}
	try {
		return await refresh();
	} catch (err) {
		console.error('A&E figures from the built-in copy:', err instanceof Error ? err.message : err);
		return opts.snapshot;
	}
}
