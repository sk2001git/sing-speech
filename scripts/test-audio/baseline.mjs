// Send every generated test clip to a running Suara and record what it does.
//
//   node scripts/test-audio/baseline.mjs                       # against http://127.0.0.1:4321
//   SUARA_URL=https://… node scripts/test-audio/baseline.mjs
//
// Writes fixtures/audio/results/<timestamp>.json and prints one line per clip, with the
// path each phrase is expected to take next to what actually happened.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const audioDir = path.join(root, 'fixtures', 'audio');
const base = process.env.SUARA_URL ?? 'http://127.0.0.1:4321';

const manifest = JSON.parse(fs.readFileSync(path.join(audioDir, 'manifest.json'), 'utf8'));
const results = [];

for (const [id, clip] of Object.entries(manifest)) {
	const audio = fs.readFileSync(path.join(audioDir, clip.file));
	const started = Date.now();
	let row;
	try {
		const res = await fetch(`${base}/api/turn`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: base },
			body: JSON.stringify({
				kind: 'speech',
				audioBase64: audio.toString('base64'),
				mimeType: 'audio/wav',
				history: [],
				unclearStreak: 0,
			}),
		});
		const ms = Date.now() - started;
		const body = await res.json().catch(() => ({}));
		const heard = body.history?.[body.history.length - 1];
		row = {
			id,
			status: res.status,
			ms,
			expect: clip.expect,
			screen: body.screen?.kind ?? null,
			decision: body.audit?.decision ?? null,
			intent: heard?.intent ?? null,
			confidence: heard?.confidence ?? null,
			needs_human: heard?.needsHuman ?? null,
			restatement: heard?.restatement ?? null,
			transcript: body.audit?.transcript ?? null,
			agreement: body.audit?.agreement ?? null,
		};
	} catch (err) {
		row = { id, status: 'error', ms: Date.now() - started, expect: clip.expect, error: String(err) };
	}
	results.push(row);
	console.log(
		[
			row.id.padEnd(30),
			`expect ${row.expect?.path ?? '?'}`.padEnd(10),
			`${row.status}`.padEnd(5),
			`${row.screen ?? '-'}`.padEnd(9),
			`${row.intent ?? '-'}`.padEnd(17),
			`${row.confidence ?? '-'}`.padEnd(5),
			`human=${row.needs_human ?? '-'}`.padEnd(11),
			`${row.ms}ms`,
		].join(' '),
	);
}

const outDir = path.join(audioDir, 'results');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = path.join(outDir, `${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ base, ran_at: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`\nwrote ${path.relative(root, outFile)}`);
