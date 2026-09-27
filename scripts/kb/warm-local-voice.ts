/**
 * Speak every fixed card and step line once in the local route's voice, so the local route reads
 * a card at once instead of making the reader wait about 5 s a line (vault obs-0071).
 *
 *   python local-asr/server.py                       first, on this PC
 *   npx tsx scripts/kb/warm-local-voice.ts            missing lines only; about 25 minutes for all
 *
 * The audio is kept by the local server in local-asr/runtime/voice-cache (gitignored), not in
 * public/: it is only ever played on this PC, so it has no place in the repository or a deploy.
 * The server keeps a line only when asked ("keep"), which only this script does.
 */
import fs from 'node:fs';
import path from 'node:path';
import index from '../../data/kb/index.json';
import { parseEntry } from '../../src/lib/kb/entry';
import { LOCAL_ASR_URL } from '../../src/lib/routes/local';
import { spokenLines } from '../../src/lib/voice-cache';

const ROOT = path.resolve(import.meta.dirname, '../..');

function setting(name: string): string | undefined {
	if (process.env[name]) return process.env[name];
	const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
	return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
}

const base = (setting('SUARA_LOCAL_ASR_URL') ?? LOCAL_ASR_URL).replace(/\/$/, '');
const voice = setting('SUARA_LOCAL_VOICE') ?? 'aiden';
const lines = (index.entries as unknown[]).flatMap((raw) => {
	const parsed = parseEntry(raw);
	if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
	return spokenLines(parsed.entry);
});

const started = Date.now();
let made = 0;
let had = 0;
for (const [i, text] of lines.entries()) {
	const t = Date.now();
	const res = await fetch(`${base}/speak`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text, language: 'en', voice, keep: true }),
	});
	if (!res.ok) throw new Error(`the local server answered ${res.status}; is local-asr/server.py running?`);
	await res.arrayBuffer();
	// A kept line comes straight off the disk.
	if (Date.now() - t < 300) had++;
	else made++;
	if ((i + 1) % 25 === 0) console.log(`${i + 1}/${lines.length}`);
}
console.log(`${lines.length} lines in ${voice}: ${made} spoken now, ${had} already kept, ${((Date.now() - started) / 60000).toFixed(1)} min.`);
