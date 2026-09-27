import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { memoryKv } from '../kb/web-guides';
import { loadEdWait, SUARA_AGENT, type EdWaitChart } from './ed-wait-source';

/**
 * Where the chart's figures come from at request time (vault plan-suara-0017): a copy in KV at most
 * a day old, else MOH's page and this week's file, else the copy built into the app.
 */
const page = readFileSync('fixtures/charts/moh-wt-admission-to-ward-page.html', 'utf8');
const xlsx = readFileSync('fixtures/charts/moh-wt-admission-to-ward-2026-w37.xlsx');
const T0 = Date.parse('2026-09-27T08:00:00Z');
const HOUR = 3_600_000;

function moh(ok = true) {
	const calls: { url: string; agent: string | null }[] = [];
	const fetchImpl = (async (url: string, init?: RequestInit) => {
		calls.push({ url, agent: new Headers(init?.headers).get('user-agent') });
		if (!ok) return new Response('down', { status: 503 });
		return url.endsWith('.xlsx') ? new Response(xlsx) : new Response(page, { headers: { 'content-type': 'text/html' } });
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}
const snapshot = { week: { from: '2026-09-06', to: '2026-09-12' }, latest: { TTSH: 3 }, weeks: [], first: '2023-01-01', fetchedAt: '2026-09-20T00:00:00.000Z', file: 'old.xlsx' } as EdWaitChart;

describe('loadEdWait', () => {
	it('reads MOH\'s page and this week\'s file when it has no copy, as SuaraBot, and keeps a copy', async () => {
		const kv = memoryKv(() => T0);
		const { fetchImpl, calls } = moh();
		const chart = await loadEdWait({ kv, fetchImpl, now: () => T0, snapshot });
		expect(chart.week.to).toBe('2026-09-19');
		expect(chart.latest.TTSH).toBeCloseTo(3.75, 2);
		expect(chart.fetchedAt).toBe('2026-09-27T08:00:00.000Z');
		expect(calls.map((c) => c.url.endsWith('.xlsx'))).toEqual([false, true]);
		expect(calls.every((c) => c.agent === SUARA_AGENT)).toBe(true);
		expect(await kv.get('chart:ed-wait', 'json')).toMatchObject({ week: { to: '2026-09-19' } });
	});

	it('serves its copy without asking MOH when the copy is under a day old', async () => {
		const kv = memoryKv(() => T0);
		await loadEdWait({ kv, fetchImpl: moh().fetchImpl, now: () => T0, snapshot });
		const again = moh();
		await loadEdWait({ kv, fetchImpl: again.fetchImpl, now: () => T0 + 23 * HOUR, snapshot });
		expect(again.calls).toEqual([]);
	});

	it('serves a stale copy at once and refreshes it in the background', async () => {
		const kv = memoryKv(() => T0);
		await loadEdWait({ kv, fetchImpl: moh().fetchImpl, now: () => T0, snapshot });
		const later = moh();
		const background: Promise<unknown>[] = [];
		const chart = await loadEdWait({ kv, fetchImpl: later.fetchImpl, now: () => T0 + 25 * HOUR, snapshot, waitUntil: (p) => background.push(p) });
		expect(chart.fetchedAt).toBe('2026-09-27T08:00:00.000Z');
		await Promise.all(background);
		expect(later.calls).toHaveLength(2);
		expect(((await kv.get('chart:ed-wait', 'json')) as EdWaitChart).fetchedAt).toBe('2026-09-28T09:00:00.000Z');
	});

	it('falls back to the copy built into the app when MOH cannot be reached', async () => {
		const chart = await loadEdWait({ kv: memoryKv(() => T0), fetchImpl: moh(false).fetchImpl, now: () => T0, snapshot });
		expect(chart).toEqual(snapshot);
	});

	it('works without KV, reading MOH each time', async () => {
		const { fetchImpl, calls } = moh();
		expect((await loadEdWait({ kv: undefined, fetchImpl, now: () => T0, snapshot })).week.to).toBe('2026-09-19');
		expect(calls).toHaveLength(2);
	});
});
