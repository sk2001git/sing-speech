/**
 * Walk the live knowledge-base UI in a real headless Chromium, over the DevTools protocol,
 * with a fake microphone playing a recorded clip. Screenshots every screen at phone size.
 *
 *   node scripts/kb/walk-ui.mjs <chrome.exe> <clip.wav> <out dir> [base url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const [chrome, wav, outDir, base = 'http://127.0.0.1:4321/'] = process.argv.slice(2);
if (!chrome || !wav || !outDir) throw new Error('usage: walk-ui.mjs <chrome> <clip.wav> <out dir> [base url]');
fs.mkdirSync(outDir, { recursive: true });
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
	chrome,
	[
		'--headless=new',
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${path.join(outDir, 'profile')}`,
		'--use-fake-ui-for-media-stream',
		'--use-fake-device-for-media-stream',
		`--use-file-for-fake-audio-capture=${wav}`,
		'--autoplay-policy=no-user-gesture-required',
		'--no-first-run',
		'about:blank',
	],
	{ stdio: 'ignore' },
);

const results = [];
const errors = [];
function check(name, ok, detail = '') {
	results.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

try {
	let target;
	for (let i = 0; i < 50 && !target; i++) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
			target = list.find((t) => t.type === 'page');
		} catch {
			await sleep(200);
		}
	}
	if (!target) throw new Error('browser did not start');

	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r) => ws.once('open', r));
	let id = 0;
	const pending = new Map();
	ws.on('message', (raw) => {
		const msg = JSON.parse(raw.toString());
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
		} else if (msg.method === 'Runtime.exceptionThrown') {
			errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
		} else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
			errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
		}
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const n = ++id;
			pending.set(n, { resolve, reject });
			ws.send(JSON.stringify({ id: n, method, params }));
		});
	const js = async (expression) => {
		const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
		return r.result.value;
	};
	const waitFor = async (expression, ms = 20000) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (await js(`!!(${expression})`)) return true;
			await sleep(150);
		}
		return false;
	};
	const click = (selector) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
	let shotN = 0;
	const shot = async (name) => {
		const { contentSize } = await send('Page.getLayoutMetrics');
		const h = Math.min(Math.ceil(contentSize.height), 3000);
		const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: h, scale: 1 } });
		const file = path.join(outDir, `${String(++shotN).padStart(2, '0')}-${name}.png`);
		fs.writeFileSync(file, Buffer.from(data, 'base64'));
	};

	await send('Page.enable');
	await send('Runtime.enable');
	await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
	await send('Page.navigate', { url: base });
	const hydrated = await waitFor(`document.querySelector('.k-orb') && !document.querySelector('astro-island[ssr]')`, 30000);
	check('home loads and hydrates', hydrated);
	check('home shows six topics', (await js(`document.querySelectorAll('[data-topic]').length`)) === 6);
	check('home names the default route', (await js(`document.querySelector('.k-foot')?.textContent ?? ''`)).includes('OpenAI'));
	await shot('home');

	// Speak: tap, let the fake mic play the clip, tap again.
	await click('.k-orb');
	const live = await waitFor(`document.querySelector('.k-orb[data-live="true"]')`, 10000);
	check('tap opens the microphone', live);
	if (live) await shot('listening');
	if (process.env.WALK_MODE === 'live') {
		// GPT-Live: one tap opens a continuous session; it decides when the question ended.
		const t0 = Date.now();
		const answered = await waitFor(`document.querySelector('[data-card]') || /Not in Suara/.test(document.body.innerText) || document.querySelector('.k-notice')`, 90000);
		const live = await js(`({ cards: document.querySelectorAll('[data-card]').length, said: document.querySelector('.k-said p')?.textContent ?? '', notice: document.querySelector('.k-notice')?.textContent ?? '', foot: document.querySelector('.k-foot')?.textContent ?? '' })`);
		check('live session answers without a second tap', answered && !live.notice, `${Date.now() - t0} ms ${JSON.stringify(live)}`);
		await shot('live-result');
		check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
		throw new Error('__done__');
	}
	if (process.env.WALK_AUTO_STOP === 'silence') {
		// A clip of pure silence: the gate must give up by itself and say so.
		check('silence ends the turn by itself', await waitFor(`/didn't hear you/.test(document.body.innerText)`, 15000));
		await shot('nothing-heard');
		check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
		throw new Error('__done__');
	}
	if (process.env.WALK_AUTO_STOP) {
		// No second tap: the clip ends in silence, and the gate must stop by itself.
		const t0 = Date.now();
		const stopped = await waitFor(`!document.querySelector('.k-orb[data-live="true"]')`, 20000);
		check('recording stops by itself after the pause', stopped, `${Date.now() - t0} ms after it opened`);
	} else {
		await sleep(4500);
		await click('.k-orb');
	}
	if (process.env.WALK_EXPECT === 'places') {
		// A "where is…" question is answered from open data, on its own card.
		const shown = await waitFor(`document.querySelector('[data-place]')`, 60000);
		const places = await js(
			`({ count: document.querySelectorAll('[data-place]').length, said: document.querySelector('.k-said p')?.textContent ?? '', heading: document.querySelector('.k-h1')?.textContent ?? '', first: document.querySelector('.k-place-name')?.textContent ?? '', address: document.querySelector('.k-place-address')?.textContent ?? '', source: document.querySelector('a.k-source')?.textContent ?? '', call: document.querySelectorAll('a[href^="tel:"]').length })`,
		);
		check('a spoken "where is" question is answered with addresses', shown && places.count > 0, JSON.stringify(places));
		check('the card names the dataset, the agency and when it was read', /data\.gov\.sg/.test(places.source) && /checked/i.test(places.source), places.source);
		check('at least one place can be called', places.call > 0, `${places.call} numbers`);
		await shot('places');
		check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
		throw new Error('__done__');
	}
	check('searching after the recording ends', await waitFor(`document.querySelector('.k-dots') || document.querySelector('[data-card]') || document.querySelector('.k-notice')`, 5000));
	const answered = await waitFor(`document.querySelector('[data-card]') || /Not in Suara|还没有/.test(document.body.innerText) || document.querySelector('.k-notice')`, 60000);
	const speech = await js(`({ cards: document.querySelectorAll('[data-card]').length, said: document.querySelector('.k-said p')?.textContent ?? '', heard: document.querySelector('.k-heard-text')?.textContent ?? '', best: document.querySelectorAll('.k-badge').length, weak: !!document.querySelector('.k-closest'), notice: document.querySelector('.k-notice')?.textContent ?? '' })`);
	check('spoken request returns an answer screen', answered && !speech.notice, JSON.stringify(speech));
	check('what they said is shown word for word', speech.said.length > 5, speech.said);
	await shot('speech-result');

	// Topic: Phone help holds the two Singpass guides and the CPF app answer.
	await click('.k-brand');
	await waitFor(`document.querySelector('[data-topic="cpf-and-support"]')`);
	await click('[data-topic="cpf-and-support"]');
	check('topic shows six cards', await waitFor(`document.querySelectorAll('[data-card]').length === 6`, 20000));
	check('grid is two per row', (await js(`getComputedStyle(document.querySelector('.k-cards')).gridTemplateColumns.split(' ').length`)) === 2);
	check('cards start closed', (await js(`document.querySelectorAll('.k-card-body').length`)) === 0);
	await shot('topic-grid');

	check('Show 6 more is offered', await js(`[...document.querySelectorAll('button')].some(b => /Show 6 more/.test(b.textContent))`));
	await js(`[...document.querySelectorAll('button')].find(b => /Show 6 more/.test(b.textContent))?.click()`);
	const more = await waitFor(`document.querySelectorAll('[data-card]').length > 6`, 20000);
	check('Show 6 more adds the remaining cards and removes the button', more && !(await js(`[...document.querySelectorAll('button')].some(b => /Show 6 more/.test(b.textContent))`)), `${await js(`document.querySelectorAll('[data-card]').length`)} cards`);

	await click('[data-card] .k-card-head');
	check('tapping a card opens it in place', await waitFor(`document.querySelector('.k-card[data-open="true"] .k-summary')`, 3000));
	check('opened card links its source', await js(`!!document.querySelector('.k-card[data-open="true"] a.k-source[href^="https://ask.gov.sg/"]')`));
	await shot('card-open');
	const detail = await js(`(() => { const d = document.querySelector('.k-card[data-open="true"] details.k-detail'); if (!d) return 'none'; d.querySelector('summary').click(); return d.open ? 'opened' : 'closed'; })()`);
	check('detail drop-down opens', detail === 'opened' || detail === 'none', detail);

	await click('[aria-label="One large card"]');
	check('single view is one per row', await waitFor(`getComputedStyle(document.querySelector('.k-cards')).gridTemplateColumns.split(' ').length === 1`, 3000));
	await shot('single-view');
	await click('[aria-label="Two per row"]');

	// Guided steps, from Phone help.
	await click('.k-brand');
	await waitFor(`document.querySelector('[data-topic="digital-services"]')`);
	await click('[data-topic="digital-services"]');
	await waitFor(`document.querySelector('[data-card="sg.cpf.singpass-password-reset"]')`, 20000);
	await click('[data-card="sg.cpf.singpass-password-reset"] .k-card-head');
	await waitFor(`[...document.querySelectorAll('button')].some(b => /Start guide/.test(b.textContent))`, 3000);
	await js(`[...document.querySelectorAll('button')].find(b => /Start guide/.test(b.textContent)).click()`);
	check('Start guide asks first', await waitFor(`document.querySelector('.confirm-yes') && document.querySelector('.confirm-no')`, 3000));
	await shot('confirm');
	await click('.confirm-no');
	check('Not this returns to the same cards', await waitFor(`document.querySelector('.k-card[data-open="true"][data-card="sg.cpf.singpass-password-reset"]')`, 3000));
	await js(`[...document.querySelectorAll('button')].find(b => /Start guide/.test(b.textContent)).click()`);
	await waitFor(`document.querySelector('.confirm-yes')`, 3000);
	await click('.confirm-yes');
	check('steps start at step 1 of 4', await waitFor(`/Step 1 of 4/i.test(document.body.innerText)`, 3000));
	await click('.k-btn-yes');
	check('confirming a step moves to the next', await waitFor(`/Step 2 of 4/i.test(document.body.innerText)`, 3000));
	await shot('step-2');
	for (let i = 0; i < 3; i++) {
		await click('.k-btn-yes');
		await sleep(200);
	}
	check('last confirmation finishes the guide', await waitFor(`/That is every step/.test(document.body.innerText)`, 3000));
	await shot('done');

	// A topic with no entries yet.
	await click('.k-brand');
	await waitFor(`document.querySelector('[data-topic="scams"]')`);
	await click('[data-topic="scams"]');
	check('empty topic says Not in Suara yet', await waitFor(`/Not in Suara yet/.test(document.body.innerText)`, 20000));
	await shot('not-in-suara');

	// Chinese.
	await click('.k-brand');
	await waitFor(`document.querySelector('.k-pill')`);
	await click('.k-pill');
	check('language pill switches to 中文', await waitFor(`document.querySelector('.k-pill').textContent === '中文'`, 3000));
	await click('[data-topic="health"]');
	await waitFor(`document.querySelectorAll('[data-card]').length > 0`, 30000);
	await click('.k-brand');
	await sleep(9000);
	await click('[data-topic="health"]');
	await waitFor(`document.querySelectorAll('[data-card]').length > 0`, 30000);
	const zh = await js(`({ cards: document.querySelectorAll('[data-card]').length, english: document.querySelectorAll('[data-english]').length, titles: [...document.querySelectorAll('.k-card-title')].map(t => t.textContent) })`);
	check('Chinese reader gets Chinese cards', zh.cards > 0 && zh.english < zh.cards, JSON.stringify(zh));
	await shot('chinese');
	await click('.k-pill');
	await click('.k-pill');

	check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
	ws.close();
} catch (err) {
	if (err?.message !== '__done__') results.push({ name: 'walk crashed', ok: false, detail: String(err) });
} finally {
	browser.kill();
	const failed = results.filter((r) => !r.ok).length;
	fs.writeFileSync(path.join(outDir, 'walk.json'), JSON.stringify({ results, errors }, null, 2));
	console.log(`\n${results.length - failed} passed, ${failed} failed`);
	process.exitCode = failed ? 1 : 0;
}
