import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { edWaitAsked, edWaitDays, findEdWaitFile, HOSPITALS, summariseEdWait } from './ed-wait';
import { readSheets } from './xlsx';

/**
 * MOH's Waiting Time for Admission to Ward, read the way the Worker reads it (vault plan-suara-0017).
 * The figures must match the mockup the owner approved (design/charts/ed-wait.json).
 */
const file = new Uint8Array(readFileSync('fixtures/charts/moh-wt-admission-to-ward-2026-w37.xlsx'));
const page = readFileSync('fixtures/charts/moh-wt-admission-to-ward-page.html', 'utf8');

describe('edWaitDays', () => {
	it('reads every day from both sheets, oldest first, per hospital, in hours', async () => {
		const days = edWaitDays(await readSheets(file));
		expect(days[0]).toMatchObject({ date: '2023-01-01', values: { AH: 1.6 } });
		expect(days.at(-1)).toMatchObject({ date: '2026-09-19', values: { TTSH: 3.37 } });
		expect(new Set(days.map((d) => d.date)).size).toBe(days.length);
	});

	it('keeps MOH\'s missing week missing', async () => {
		const dates = new Set(edWaitDays(await readSheets(file)).map((d) => d.date));
		expect(dates.has('2026-08-01')).toBe(true);
		expect(dates.has('2026-08-05')).toBe(false);
		expect(dates.has('2026-08-09')).toBe(true);
	});
});

describe('summariseEdWait', () => {
	it('gives a typical day last week per hospital, as in the approved mockup', async () => {
		const s = summariseEdWait(edWaitDays(await readSheets(file)));
		expect(s.week).toEqual({ from: '2026-09-13', to: '2026-09-19' });
		expect(s.latest.TTSH).toBeCloseTo(3.75, 2);
		expect(s.latest.SKH).toBeCloseTo(14.18, 2);
		expect(s.latest.AH).toBeCloseTo(1.13, 2);
		expect(Object.keys(s.latest)).toHaveLength(9);
	});

	it('gives 26 weeks of trend, with the missing week empty rather than invented', async () => {
		const s = summariseEdWait(edWaitDays(await readSheets(file)));
		expect(s.weeks).toHaveLength(26);
		expect(s.weeks.at(-1)!.end).toBe('2026-09-19');
		expect(s.weeks.find((w) => w.end === '2026-08-08')!.values).toEqual({});
	});
});

describe('findEdWaitFile', () => {
	it('finds this week\'s spreadsheet on MOH\'s page', () => {
		expect(findEdWaitFile(page)).toBe('https://isomer-user-content.by.gov.sg/3/ac3f67c6-6b56-479a-8894-8d7a0adca41a/WT%20for%20Admission%20to%20Ward_week37Y2026.xlsx');
		expect(findEdWaitFile('<html>no file</html>')).toBeNull();
	});
});

describe('edWaitAsked', () => {
	it('knows a question about waiting at A&E, and which hospital it names', () => {
		expect(edWaitAsked('how long is the wait at A&E now')).toEqual({ focus: null });
		expect(edWaitAsked('how long do I wait at Tan Tock Seng emergency department')).toEqual({ focus: 'TTSH' });
		expect(edWaitAsked('is the SGH accident and emergency very crowded today')).toEqual({ focus: 'SGH' });
		expect(edWaitAsked('waiting time for a bed after A&E at Sengkang')).toEqual({ focus: 'SKH' });
		expect(edWaitAsked('急诊要等多久')).toEqual({ focus: null });
		expect(edWaitAsked('陈笃生医院急诊等多久')).toEqual({ focus: 'TTSH' });
	});

	it('leaves other questions alone, even ones about A&E or about waiting', () => {
		expect(edWaitAsked('my doctor gave me a letter to go to emergency, is it cheaper')).toBeNull();
		expect(edWaitAsked('how long must I wait for my CPF payout')).toBeNull();
		expect(edWaitAsked('where is the nearest polyclinic')).toBeNull();
		expect(edWaitAsked('my father fell, emergency, what do I do')).toBeNull();
	});

	it('names every hospital MOH reports, in English and Chinese', () => {
		expect(Object.keys(HOSPITALS).sort()).toEqual(['AH', 'CGH', 'KTPH', 'NTFGH', 'NUH(A)', 'SGH', 'SKH', 'TTSH', 'WH']);
		for (const h of Object.values(HOSPITALS)) expect(h.zh).toMatch(/[一-鿿]/);
	});
});
