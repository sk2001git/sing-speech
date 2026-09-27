import { excelDate, type Sheets } from './xlsx';

/**
 * MOH's Waiting Time for Admission to Ward (vault plan-suara-0017, dec-suara-0025): the median
 * time, per public hospital per day, from "Decision by doctor to admit patient" to "Time patient
 * exits EMD" (to go to inpatient ward). Hours, as MOH states such waits. Not the wait to see a
 * doctor, and every screen that shows it says so.
 *
 * Published weekly as a spreadsheet on MOH's page under the Singapore Open Data Licence, which
 * asks for a conspicuous credit and a link to the licence: the chart card carries both.
 */
export const ED_WAIT_PAGE = 'https://www.moh.gov.sg/others/resources-and-statistics/healthcare-institution-statistics-waiting-time-for-admission-to-ward/';
export const OPEN_DATA_LICENCE = 'https://data.gov.sg/open-data-licence';

/** The hospitals in MOH's file, by its column codes. `match`: how a question names them. */
export const HOSPITALS: Record<string, { en: string; zh: string; match: RegExp }> = {
	AH: { en: 'Alexandra Hospital (urgent care)', zh: '亚历山大医院（紧急护理）', match: /\balexandra\b|亚历山大/i },
	CGH: { en: 'Changi General', zh: '樟宜综合医院', match: /\bchangi\b|\bcgh\b|樟宜/i },
	KTPH: { en: 'Khoo Teck Puat', zh: '邱德拔医院', match: /\bkhoo teck puat\b|\bktph\b|邱德拔/i },
	NTFGH: { en: 'Ng Teng Fong General', zh: '黄廷方综合医院', match: /\bng teng fong\b|\bntfgh\b|黄廷方/i },
	'NUH(A)': { en: 'National University Hospital', zh: '国立大学医院', match: /\bnational university hospital\b|\bnuh\b|国大医院|国立大学医院/i },
	SGH: { en: 'Singapore General', zh: '新加坡中央医院', match: /\bsingapore general\b|\bsgh\b|中央医院/i },
	SKH: { en: 'Sengkang General', zh: '盛港综合医院', match: /\bsengkang\b|\bskh\b|盛港/i },
	TTSH: { en: 'Tan Tock Seng', zh: '陈笃生医院', match: /\btan tock seng\b|\bttsh\b|陈笃生/i },
	WH: { en: 'Woodlands Health', zh: '兀兰医院', match: /\bwoodlands\b|兀兰/i },
};

export interface EdWaitDay {
	date: string;
	values: Record<string, number>;
}

export interface EdWaitSummary {
	/** The last seven days MOH published. */
	week: { from: string; to: string };
	/** A typical day that week per hospital: the median of its daily medians, hours. */
	latest: Record<string, number>;
	/** 26 weeks to that week, oldest first; a week MOH published nothing for is empty. */
	weeks: { end: string; values: Record<string, number> }[];
	first: string;
}

/** Every day in every sheet (the history and the latest week), oldest first, one row per date. */
export function edWaitDays(sheets: Sheets): EdWaitDay[] {
	const byDate = new Map<string, Record<string, number>>();
	for (const rows of Object.values(sheets)) {
		let header: string[] | null = null;
		for (const row of rows) {
			if (row[0] === 'Date') {
				header = row.map((c) => (typeof c === 'string' ? c.trim() : ''));
				continue;
			}
			if (!header || typeof row[0] !== 'number') continue;
			const values: Record<string, number> = {};
			header.forEach((code, i) => {
				const v = row[i];
				if (i > 0 && code in HOSPITALS && typeof v === 'number' && Number.isFinite(v)) values[code] = v;
			});
			if (Object.keys(values).length) byDate.set(excelDate(row[0]), { ...byDate.get(excelDate(row[0])), ...values });
		}
	}
	return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, values }));
}

const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const round2 = (x: number) => Math.round(x * 100) / 100;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function typical(days: EdWaitDay[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const code of Object.keys(HOSPITALS)) {
		const vs = days.map((d) => d.values[code]).filter((v): v is number => v !== undefined);
		if (vs.length) out[code] = round2(median(vs));
	}
	return out;
}

export function summariseEdWait(days: EdWaitDay[], weeks = 26): EdWaitSummary {
	if (days.length === 0) throw new Error('no days to summarise');
	const last = days.at(-1)!.date;
	const within = (end: string) => days.filter((d) => d.date > addDays(end, -7) && d.date <= end);
	return {
		week: { from: addDays(last, -6), to: last },
		latest: typical(within(last)),
		weeks: Array.from({ length: weeks }, (_, k) => {
			const end = addDays(last, -7 * (weeks - 1 - k));
			return { end, values: typical(within(end)) };
		}),
		first: days[0]!.date,
	};
}

/** This week's spreadsheet on MOH's page: the file name changes every week. */
export function findEdWaitFile(html: string): string | null {
	const m = /https:\/\/isomer-user-content\.by\.gov\.sg\/[^"'<>]*?admission[^"'<>]*?\.xlsx/i.exec(html);
	return m ? encodeURI(decodeURI(m[0])) : null;
}

const EMERGENCY = /\b(a\s*&\s*e|a and e|accident\s*(?:and|&)\s*emergency|emergency\s*(?:department|dept|room|medicine)|emergency|\bed\b)|急诊|急症/i;
const WAITING = /\b(wait|waiting|queue|how long|crowded|busy|full)\b|等|多久|排队|拥挤/i;

/**
 * Is this a question about how long people wait at A&E? A fixed rule, not a model's guess: a
 * chart of health figures shown for the wrong question is worse than none. Needs both an A&E word
 * and a waiting word, so "go to emergency, is it cheaper" or "wait for my CPF" never match.
 */
export function edWaitAsked(question: string): { focus: string | null } | null {
	if (!EMERGENCY.test(question) || !WAITING.test(question)) return null;
	const focus = Object.entries(HOSPITALS).find(([, h]) => h.match.test(question))?.[0] ?? null;
	return { focus };
}
