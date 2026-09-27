import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { excelDate, readSheets } from './xlsx';

/** MOH's own file, Waiting Time for Admission to Ward, week 37 of 2026, as downloaded. */
const file = readFileSync('fixtures/charts/moh-wt-admission-to-ward-2026-w37.xlsx');

describe('readSheets', () => {
	it('reads every sheet of a real .xlsx by name, with no library', async () => {
		const sheets = await readSheets(new Uint8Array(file));
		expect(Object.keys(sheets)).toEqual(['Historical', 'Sheet1']);
	});

	it('gives rows as the spreadsheet shows them, text and numbers', async () => {
		const { Historical } = await readSheets(new Uint8Array(file));
		expect(Historical![0]![0]).toBe('Waiting Times (50th Percentile) for Admission from ED');
		// A blank row sits between MOH's title and its header.
		expect(Historical![1]).toEqual([]);
		expect(Historical![2]!.slice(0, 10)).toEqual(['Date', 'AH', 'CGH', 'KTPH', 'NTFGH', 'NUH(A)', 'SGH', 'SKH', 'TTSH', 'WH']);
		const first = Historical![3]!;
		expect(excelDate(first[0] as number)).toBe('2023-01-01');
		expect(first[1]).toBeCloseTo(1.6);
	});

	it('refuses something that is not a spreadsheet', async () => {
		await expect(readSheets(new TextEncoder().encode('<html>not found</html>'))).rejects.toThrow(/not an .xlsx/);
	});
});

describe('excelDate', () => {
	it('turns Excel\'s day numbers into dates', () => {
		expect(excelDate(45292)).toBe('2024-01-01');
		expect(excelDate(46284)).toBe('2026-09-19');
	});
});
