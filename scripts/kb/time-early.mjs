/**
 * Does the question go before the 3 s pause ends? Plays a recorded question (with quiet after
 * it) into a real headless Chromium as its microphone, taps the microphone on the dev server, and
 * times three things from the tap: each /api/search request, the moment the phone stops
 * listening, and the moment the answer is on screen (vault plan-suara-0021, L1).
 *
 *   node scripts/kb/time-early.mjs <chrome.exe> <clip.wav> [base url] [route]
 *
 * The clip should end in several seconds of quiet, or the fake microphone loops the speech.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [chrome, wav, base = 'http://localhost:4388/', route = 'openai-ws'] = process.argv.slice(2);
if (!chrome || !wav) throw new Error('usage: time-early.mjs <chrome> <clip.wav> [base url] [route]');
const PORT = 9334;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'suara-early-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(chrome, [
	'--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
	'--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`,
	'--autoplay-policy=no-user-gesture-required', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
	await sleep(200);
	try {
		target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
	} catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0;
const pending = new Map();
const events = [];
ws.on('message', (raw) => {
	const m = JSON.parse(raw);
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m.result);
		pending.delete(m.id);
	} else if (m.method) events.push({ ...m, t: Date.now() });
});
const send = (method, params = {}) => new Promise((r) => {
	id += 1;
	pending.set(id, r);
	ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;

await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url: `${base}?route=${route}` });
await sleep(6000);
// Listening shows the stop button; an answer shows a card, a web answer or a "not in Suara" heading.
const phase = () => evaluate(`(() => document.querySelector('.k-stop') ? 'listening' : document.querySelector('[data-card], .k-web-card, .k-web-searching, .k-webstages') ? 'answer' : document.querySelector('.k-skeleton') && /You said/.test(document.querySelector('main')?.innerText ?? '') ? 'heard' : 'other')()`);
const t0 = Date.now();
await evaluate(`document.querySelector('.k-orb')?.click()`);
const seen = {};
while (Date.now() - t0 < 40000) {
	const p = await phase();
	if (!seen[p]) seen[p] = Date.now() - t0;
	if (seen.listening && p !== 'listening' && !seen.stopped) seen.stopped = Date.now() - t0;
	if (p === 'answer') break;
	await sleep(100);
}
const searches = events.filter((e) => e.method === 'Network.requestWillBeSent' && e.params.request.url.includes('/api/search'));
// Recalled means aborted by the page; a stream the page stopped reading after its answer is not.
const failed = new Set(events.filter((e) => e.method === 'Network.loadingFailed' && !e.params.canceled).map((e) => e.params.requestId));
const canceled = new Set(events.filter((e) => e.method === 'Network.loadingFailed' && e.params.canceled).map((e) => e.params.requestId));
console.log(`route ${route}, times from the tap:`);
for (const s of searches) console.log(`  /api/search sent at ${s.t - t0} ms${failed.has(s.params.requestId) ? ' (failed)' : canceled.has(s.params.requestId) ? ' (cancelled by the page)' : ''}`);
console.log(`  stopped listening at ${seen.stopped ?? '?'} ms; their words on screen at ${seen.heard ?? 'never'} ms; answer on screen at ${seen.answer ?? 'never'} ms`);
if (seen.stopped && seen.answer) console.log(`  wait after the phone stopped listening: ${seen.answer - seen.stopped} ms`);
if (process.env.SAVE_BODY && searches[0]) {
	const body = await send('Network.getRequestPostData', { requestId: searches[0].params.requestId });
	fs.writeFileSync(process.env.SAVE_BODY, body?.postData ?? '');
	console.log(`  saved the first request body to ${process.env.SAVE_BODY}`);
}
console.log(`  screen at the end: ${JSON.stringify((await evaluate(`document.querySelector('main')?.innerText ?? ''`)).slice(0, 160))}`);
ws.close();
browser.kill();
