/**
 * Render the knowledge-base screens to static HTML with real seed entries, for review
 * without a browser session.
 *
 *   npx tsx scripts/kb/preview.tsx <out.html>
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import index from '../../data/kb/index.json';
import KbScreen from '../../src/components/kb/KbScreen';
import { parseEntry, type Entry } from '../../src/lib/kb/entry';
import type { FlowState, SearchResult } from '../../src/lib/kb/flow';

const ROOT = path.resolve(import.meta.dirname, '../..');
const out = process.argv[2] ?? path.join(ROOT, 'kb-preview.html');

const entries = (index.entries as unknown[]).map((raw) => {
	const r = parseEntry(raw);
	if (!r.ok) throw new Error(r.errors.join('\n'));
	return r.entry;
});
const by = (id: string) => entries.find((e) => e.id === id)!;

const ids = ['sg.cpf.singpass-password-reset', 'sg.cpf.singpass-update-contact', 'sg.cpf.cpf-mobile-qr-login', 'sg.cpf.change-address', 'sg.cpf.book-appointment', 'sg.cpf.yearly-statement'];
const result: SearchResult = {
	heard: { short: 'Forgot Singpass password', sentence: 'You forgot your Singpass password and want to reset it.' },
	fit: 'strong',
	cards: ids.map(by),
	nextOffset: 6,
	query: 'I forgot my Singpass password',
	language: 'en',
};
const results = (openId: string | null, view: 'grid' | 'single' = 'grid'): Extract<FlowState, { phase: 'results' }> => ({ phase: 'results', view, result, openId });
const proc: Entry = by('sg.cpf.singpass-password-reset');

// Real rows from data/kb/places.json, so the card is judged on real addresses.
const placesFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kb/places.json'), 'utf8')) as {
	places: Array<Record<string, unknown>>;
	sources: Array<Record<string, string>>;
};
const bedok = placesFile.places.filter((p) => /BEDOK/i.test(String(p.street ?? '')) && p.kind === 'chas-clinic').slice(0, 4);

const placesState: FlowState = {
	phase: 'places',
	view: 'grid',
	result: {
		heard: { short: 'Clinic near Bedok', sentence: 'You want a clinic near Bedok that takes CHAS.', said: 'got clinic near bedok that take chas or not' },
		places: bedok as never,
		what: 'chas-clinic',
		area: 'bedok',
		source: placesFile.sources.find((s) => s.kind === 'chas-clinic') as never,
		language: 'en',
	},
};

const screens: Array<[string, FlowState, Record<string, unknown>?]> = [
	['Places from open data', placesState],
	['Home', { phase: 'home', view: 'grid', greeting: false }],
	['Listening', { phase: 'listening', view: 'grid' }],
	['Results, grid', results(null)],
	['Results, card open', results('sg.cpf.cpf-mobile-qr-login')],
	['Results, single', results(null, 'single')],
	['Weak match', { ...results(null), result: { ...result, fit: 'weak', heard: { short: 'Renew my passport', sentence: 'x' }, nextOffset: null } }],
	['Start these steps?', { phase: 'confirm', view: 'grid', entry: proc, back: results(proc.id) }],
	['Step 3 of 4', { phase: 'steps', view: 'grid', entry: proc, index: 2, back: results(proc.id) }],
	['Not in Suara yet', { phase: 'notfound', view: 'grid', heard: { short: 'Apply for an HDB flat', sentence: 'x' } }],
	['中文 Home', { phase: 'home', view: 'grid', greeting: true }, { setting: 'zh-Hans' }],
];

const noop = () => {};
const css = fs.readFileSync(path.join(ROOT, 'src/styles/global.css'), 'utf8');
const tokens = css.slice(css.indexOf(':root {'), css.indexOf('@layer base'));
const kb = fs.readFileSync(path.join(ROOT, 'src/styles/kb.css'), 'utf8');

// Two faces, side by side, for the owner to choose: the low-vision face against Inter.
const FONTS: Array<[string, string]> = [
	['Atkinson Hyperlegible Next', "'Atkinson Hyperlegible Next'"],
	['Inter', "'Inter Variable'"],
];

const render = (state: FlowState, over?: Record<string, unknown>) =>
	renderToStaticMarkup(
		<KbScreen state={state} setting="en" englishIds={[]} loadingMore={false} dispatch={noop} onSpeak={noop} onMore={noop} onTopic={noop} onSay={noop} onLanguage={noop} routeLabel="OpenAI · gpt-5.6-luna over WebSocket" level={0.4} {...over} />,
	);

const frames = screens
	.map(([name, state, over]) => `<figure><figcaption>${name}</figcaption><div class="phone">${render(state, over)}</div></figure>`)
	.join('\n');

// The same two screens in each face, so the choice is made on the real thing.
const compare = FONTS.map(
	([label, stack]) =>
		`<figure><figcaption>Font: ${label}</figcaption>` +
		screens
			.filter(([name]) => name === 'Home' || name === 'Results, card open')
			.map(([, state, over]) => `<div class="phone" style="font-family: ${stack}, sans-serif">${render(state, over)}</div>`)
			.join('') +
		`</figure>`,
).join('\n');

fs.writeFileSync(
	out,
	`<!doctype html><html><head><meta charset="utf-8"><title>Suara screens</title><style>
${tokens}
@keyframes pulse{50%{opacity:.35}} @keyframes ring{to{transform:scale(1.18);opacity:0}} @keyframes wave{to{height:2rem}}
${kb}
@font-face{font-family:'Atkinson Hyperlegible Next';src:url('fonts/atkinson-hyperlegible-next-latin.woff2') format('woff2');font-weight:400 700;font-display:swap}
@font-face{font-family:'Inter Variable';src:url('fonts/inter-latin.woff2') format('woff2');font-weight:400 700;font-display:swap}
html{background:#e9e9ee;font-family:var(--font-sans);-webkit-font-smoothing:antialiased}
body{margin:0;padding:24px;display:flex;flex-wrap:wrap;gap:24px;font-size:1.25rem;line-height:1.45}
figure{margin:0;display:flex;gap:12px} figcaption{font:600 14px/1.4 system-ui;color:#5f5f64;margin:0 0 6px;flex-basis:100%}
.phone{width:390px;height:844px;overflow:hidden;border-radius:28px;background:var(--ground);box-shadow:0 8px 30px rgba(0,0,0,.12)}
.phone .k-app{min-height:844px} .phone .k-bar{position:static}
figure{flex-wrap:wrap}
</style></head><body>${frames}${compare}</body></html>`,
);
console.log(`wrote ${out}`);
