import { useState, type ReactNode } from 'react';
import { ED_WAIT_PAGE, HOSPITALS, OPEN_DATA_LICENCE } from '../../lib/charts/ed-wait';
import type { EntryLanguage } from '../../lib/kb/entry';
import type { ChartResult } from '../../lib/kb/flow';
import Said from './Said';

/**
 * MOH's A&E ward-bed waiting times, drawn by Suara (vault plan-suara-0017, dec-suara-0025), as
 * approved in design/charts/ed-wait.html. Chart rules from the UK Government Analysis Function:
 * bars ranked, from zero, labelled on the bar, one colour with the asked-about hospital in blue, a
 * headline that states the finding, a subtitle that says what is measured, and a table.
 */
const W = {
	en: {
		badge: 'Government data',
		headAll: (lo: string, loName: string, hi: string, hiName: string) => `Last week, the wait for a ward bed ran from about ${lo} at ${loName} to about ${hi} at ${hiName}`,
		headOne: (name: string, t: string) => `Last week at ${name}, people waited about ${t} for a ward bed`,
		sub: (from: string, to: string) => `A typical day, ${from} to ${to}. Half of patients waited less, half waited longer.`,
		not: 'This is not the wait to see a doctor. It is the time from the A&E doctor deciding you need to stay in hospital, to leaving A&E for a ward.',
		tap: 'Tap a hospital to see how its wait has changed.',
		trend: (name: string, now: string, then: string, since: string) => `${name}: about ${now} last week, against about ${then} in the week to ${since}.`,
		mid: 'Middle of all hospitals',
		gap: (ranges: string) => `The gap: MOH published no figures for ${ranges}.`,
		sos: 'In an emergency, call',
		sosAfter: 'Do not wait for a better time.',
		numbers: 'See the numbers',
		hospital: 'Hospital',
		typical: 'Typical wait last week',
		readAloud: 'Read aloud',
		source: 'Source:',
		moh: 'Ministry of Health',
		page: 'Waiting Time for Admission to Ward',
		weekly: '(weekly hospital submissions)',
		hours: 'Figures in hours, as MOH reports them.',
		usedUnder: 'Used under the',
		licence: 'Singapore Open Data Licence',
		drawn: (checked: string) => `. Drawn by Suara from MOH's figures; checked ${checked}.`,
		weeklyWait: 'weekly wait over the past 26 weeks',
		h: (H: number, M: number) => (H === 0 ? `${M} min` : M === 0 ? `${H} h` : `${H} h ${M} min`),
		axis: (n: number) => `${n} h`,
	},
	'zh-Hans': {
		badge: '政府数据',
		headAll: (lo: string, loName: string, hi: string, hiName: string) => `上周，等候病床的时间从${loName}的约${lo}到${hiName}的约${hi}不等`,
		headOne: (name: string, t: string) => `上周在${name}，病人等候病床约${t}`,
		sub: (from: string, to: string) => `${from}至${to}的典型一天。一半病人等得比这短，一半等得比这长。`,
		not: '这不是看医生的等待时间。这是从急诊医生决定您需要住院，到离开急诊部前往病房的时间。',
		tap: '点一下医院，看看等候时间的变化。',
		trend: (name: string, now: string, then: string, since: string) => `${name}：上周约${now}；截至${since}那一周约${then}。`,
		mid: '所有医院的中间值',
		gap: (ranges: string) => `中断处：卫生部没有公布${ranges}的数字。`,
		sos: '紧急情况请拨打',
		sosAfter: '不要等。',
		numbers: '查看数字',
		hospital: '医院',
		typical: '上周典型等候时间',
		readAloud: '朗读',
		source: '来源：',
		moh: '卫生部',
		page: '等候入住病房时间',
		weekly: '（各医院每周呈报）',
		hours: '数字以小时计，与卫生部的报告一致。',
		usedUnder: '依据',
		licence: '新加坡开放数据许可',
		drawn: (checked: string) => `使用。由 Suara 根据卫生部的数字绘制；查询于 ${checked}。`,
		weeklyWait: '过去26周的每周等候时间',
		h: (H: number, M: number) => (H === 0 ? `${M}分钟` : M === 0 ? `${H}小时` : `${H}小时${M}分钟`),
		axis: (n: number) => `${n}小时`,
	},
};

/** Rounded to 10 minutes: precise enough to plan by, no false precision. */
function hm(hours: number, lang: EntryLanguage): string {
	const m = Math.round((hours * 60) / 10) * 10;
	return W[lang].h(Math.floor(m / 60), m % 60);
}
const locale = (lang: EntryLanguage) => (lang === 'zh-Hans' ? 'zh-SG' : 'en-SG');
const day = (iso: string, lang: EntryLanguage, year = true) =>
	new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(lang), { day: 'numeric', month: 'short', timeZone: 'UTC', ...(year ? { year: 'numeric' } : {}) });
const name = (code: string, lang: EntryLanguage) => (lang === 'zh-Hans' ? HOSPITALS[code]?.zh : HOSPITALS[code]?.en) ?? code;
const shortName = (code: string, lang: EntryLanguage) => name(code, lang).replace(/ \(urgent care\)|（紧急护理）/, '');

/** The words the headline says: shown, and read aloud. */
export function chartHeadline(r: ChartResult): string {
	const w = W[r.language];
	const rows = Object.entries(r.data.latest).sort((a, b) => a[1] - b[1]);
	if (r.focus && r.data.latest[r.focus] !== undefined) return w.headOne(name(r.focus, r.language), hm(r.data.latest[r.focus]!, r.language));
	const [lo, hi] = [rows[0]!, rows.at(-1)!];
	return w.headAll(hm(lo[1], r.language), shortName(lo[0], r.language), hm(hi[1], r.language), name(hi[0], r.language));
}

function Trend({ r, code }: { r: ChartResult; code: string }) {
	const w = W[r.language];
	const weeks = r.data.weeks;
	// A week MOH published nothing for stays a gap: the line breaks, and the note below names it.
	const mine = weeks.map((wk) => wk.values[code]);
	const mid = weeks.map((wk) => {
		const v = Object.values(wk.values).sort((a, b) => a - b);
		return v.length ? v[Math.floor(v.length / 2)] : undefined;
	});
	const known = [...mine, ...mid].filter((v): v is number => typeof v === 'number');
	if (weeks.length < 2 || known.length === 0) return null;
	const top = Math.max(4, Math.ceil(Math.max(...known) / 2) * 2);
	const [Wd, H, L, B, T, R] = [480, 170, 44, 24, 10, 8];
	const x = (i: number) => L + (i * (Wd - L - R)) / (weeks.length - 1);
	const y = (v: number) => T + (1 - v / top) * (H - T - B);
	const path = (vs: (number | undefined)[]) =>
		vs.map((v, i) => (typeof v !== 'number' ? '' : `${i && typeof vs[i - 1] === 'number' ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
	const firstKnown = mine.findIndex((v) => typeof v === 'number');
	const now = mine.at(-1);
	const gaps = weeks
		.filter((wk) => Object.keys(wk.values).length === 0)
		.map((wk) => `${day(new Date(Date.parse(`${wk.end}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), r.language, false)} – ${day(wk.end, r.language, false)}`.replace(' – ', r.language === 'zh-Hans' ? '至' : ' to '));
	return (
		<section className="k-trend">
			{typeof now === 'number' && firstKnown >= 0 && (
				<h3 className="k-trend-title">{w.trend(name(code, r.language), hm(now, r.language), hm(mine[firstKnown]!, r.language), day(weeks[firstKnown]!.end, r.language, false))}</h3>
			)}
			<svg viewBox={`0 0 ${Wd} ${H}`} width="100%" role="img" aria-label={`${name(code, r.language)}: ${w.weeklyWait}`}>
				{[0, top / 2, top].map((t) => (
					<g key={t}>
						<line x1={L} x2={Wd - R} y1={y(t)} y2={y(t)} stroke="var(--line-strong)" strokeWidth="1" />
						<text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">
							{w.axis(t)}
						</text>
					</g>
				))}
				<path d={path(mid)} fill="none" stroke="var(--busy)" strokeWidth="2.5" strokeDasharray="5 4" />
				<path d={path(mine)} fill="none" stroke="var(--light)" strokeWidth="3.5" strokeLinejoin="round" />
				{typeof now === 'number' && <circle cx={x(weeks.length - 1)} cy={y(now)} r="5" fill="var(--light)" />}
				<text x={L} y={H - 4} fontSize="12" fill="var(--muted)">
					{day(weeks[0]!.end, r.language, false)}
				</text>
				<text x={Wd - R} y={H - 4} fontSize="12" fill="var(--muted)" textAnchor="end">
					{day(weeks.at(-1)!.end, r.language, false)}
				</text>
			</svg>
			<p className="k-trend-key">
				<span>
					<i style={{ background: 'var(--light)' }} />
					{name(code, r.language)}
				</span>
				<span>
					<i style={{ background: 'var(--busy)' }} />
					{w.mid}
				</span>
			</p>
			{gaps.length > 0 && <p className="k-trend-key">{w.gap(gaps.join(', '))}</p>}
		</section>
	);
}

export default function ChartCard({ result: r, onSay, onAsk, footer }: { result: ChartResult; onSay: (text: string, language: EntryLanguage) => void; onAsk?: (text: string) => void; footer?: ReactNode }) {
	const [tapped, setTapped] = useState<string | null>(null);
	const w = W[r.language];
	const lang = r.language;
	const rows = Object.entries(r.data.latest).sort((a, b) => a[1] - b[1]);
	const max = Math.max(5, Math.ceil((rows.at(-1)?.[1] ?? 5) / 5) * 5);
	const focus = tapped ?? r.focus;
	const headline = chartHeadline(r);
	return (
		<>
			<Said said={r.heard.said ?? r.heard.sentence} label={r.heard.said ? (lang === 'zh-Hans' ? '您说' : 'You said') : lang === 'zh-Hans' ? '您问' : 'You asked'} lang={lang} {...(onAsk ? { onAsk } : {})} />
			<article className="k-card k-chart">
				<span className="k-badge">
					<ChartIcon />
					{w.badge}
				</span>
				<h1 className="k-chart-head">{headline}</h1>
				<p className="k-chart-sub">{w.sub(day(r.data.week.from, lang, false), day(r.data.week.to, lang))}</p>
				<p className="k-chart-not">
					<InfoIcon />
					<span>{w.not}</span>
				</p>
				<div className="k-cbars" {...(focus ? { 'data-focus': 'true' } : {})}>
					{rows.map(([code, v]) => (
						<button key={code} className="k-cbar" {...(code === focus ? { 'data-on': 'true' } : {})} type="button" aria-label={`${name(code, lang)}: ${hm(v, lang)}`} onClick={() => setTapped(tapped === code ? null : code)}>
							<span className="k-cbar-row">
								<span className="k-cbar-name">{name(code, lang)}</span>
								<span className="k-cbar-value">{hm(v, lang)}</span>
							</span>
							<span className="k-cbar-track">
								<span className="k-cbar-fill" style={{ width: `${((v / max) * 100).toFixed(1)}%` }} />
							</span>
						</button>
					))}
					<div className="k-cbar-scale">
						<span>{w.axis(0)}</span>
						<span>{w.axis(max / 2)}</span>
						<span>{w.axis(max)}</span>
					</div>
				</div>
				<p className="k-chart-hint">{w.tap}</p>
				{focus && <Trend r={r} code={focus} />}
				<button className="k-btn k-btn-quiet k-btn-mid" type="button" onClick={() => onSay(headline, lang)}>
					<SpeakerIcon />
					{w.readAloud}
				</button>
			</article>
			<p className="k-chart-sos">
				<PhoneIcon />
				<span>
					{w.sos} <a href="tel:995">995</a>. {w.sosAfter}
				</span>
			</p>
			<details className="k-chart-nums">
				<summary>
					<span>{w.numbers}</span>
					<ChevronIcon />
				</summary>
				<table>
					<thead>
						<tr>
							<th>{w.hospital}</th>
							<th>{w.typical}</th>
						</tr>
					</thead>
					<tbody>
						{rows.map(([code, v]) => (
							<tr key={code}>
								<td>{name(code, lang)}</td>
								<td>{hm(v, lang)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>
			<div className="k-chart-credit">
				<span>
					<b>{w.source}</b> {w.moh},{' '}
					<a href={ED_WAIT_PAGE} target="_blank" rel="noopener noreferrer">
						{w.page}
					</a>{' '}
					{w.weekly}, {day(r.data.week.from, lang, false)}
					{lang === 'zh-Hans' ? '至' : ' to '}
					{day(r.data.week.to, lang)}. {w.hours}
				</span>
				<span>
					{w.usedUnder}{' '}
					<a href={OPEN_DATA_LICENCE} target="_blank" rel="noopener noreferrer">
						{w.licence}
					</a>
					{w.drawn(day(r.data.fetchedAt.slice(0, 10), lang))}
				</span>
			</div>
			{footer}
		</>
	);
}

function Svg({ children }: { children: ReactNode }) {
	return (
		<svg className="k-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{children}
		</svg>
	);
}
const ChartIcon = () => (
	<Svg>
		<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />
	</Svg>
);
const InfoIcon = () => (
	<Svg>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 11v5.5M12 7.5v.01" />
	</Svg>
);
const SpeakerIcon = () => (
	<Svg>
		<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
		<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
	</Svg>
);
const PhoneIcon = () => (
	<Svg>
		<path d="M6.6 3.5h2.6l1.4 4-2 1.4a11 11 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z" />
	</Svg>
);
const ChevronIcon = () => (
	<Svg>
		<path d="m6 9 6 6 6-6" />
	</Svg>
);
