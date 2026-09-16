/**
 * Speak every fixed line once and keep the audio in the repository, so a reader's device
 * costs nothing to talk to (owner, 2026-09-16).
 *
 *   npx tsx scripts/kb/build-audio.ts            missing lines only
 *   npx tsx scripts/kb/build-audio.ts --all      rebuild every line
 *
 * Writes public/kb-audio/<key>.mp3 and data/kb/audio.json (key -> line). Runtime speech
 * checks that manifest first and only calls the vendor for words it has never said.
 */
import fs from 'node:fs';
import path from 'node:path';
import index from '../../data/kb/index.json';
import { parseEntry, type Entry } from '../../src/lib/kb/entry';
import { OpenAiVoice } from '../../src/lib/routes/voice';
import { AUDIO_DIR, speechKey, spokenLines } from '../../src/lib/voice-cache';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'public', AUDIO_DIR);
const MANIFEST = path.join(ROOT, 'data/kb/audio.json');
const MODEL = 'gpt-4o-mini-tts';
const VOICE = 'marin';

function key(name: string): string | undefined {
	if (process.env[name]) return process.env[name];
	const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
	return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
}

const entries = (index.entries as unknown[]).map((raw) => {
	const parsed = parseEntry(raw);
	if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
	return parsed.entry;
});

const all = process.argv.includes('--all');
fs.mkdirSync(OUT, { recursive: true });
const manifest: Record<string, { text: string; voice: string; model: string; bytes: number }> =
	!all && fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};

const voice = new OpenAiVoice({ apiKey: key('OPENAI_API_KEY'), model: MODEL, voice: VOICE });
const lines = entries.flatMap((e: Entry) => spokenLines(e));
let made = 0;
let had = 0;

for (const text of lines) {
	const id = await speechKey(text, VOICE, MODEL);
	const file = path.join(OUT, `${id}.mp3`);
	if (!all && manifest[id] && fs.existsSync(file)) {
		had++;
		continue;
	}
	const audio = await voice.speak(text, 'en');
	const bytes = Buffer.from(await new Response(audio.body).arrayBuffer());
	fs.writeFileSync(file, bytes);
	manifest[id] = { text, voice: VOICE, model: MODEL, bytes: bytes.length };
	made++;
	console.log(`${id}  ${(bytes.length / 1024).toFixed(0)} KB  ${text.slice(0, 60)}`);
}

fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
const total = Object.values(manifest).reduce((n, m) => n + m.bytes, 0);
console.log(`\n${made} spoken now, ${had} already had audio. ${Object.keys(manifest).length} lines, ${(total / 1024 / 1024).toFixed(1)} MB in public/${AUDIO_DIR}.`);
