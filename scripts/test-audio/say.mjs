/**
 * Speak a question with OpenAI text-to-speech as WAV, then pad it with silence, so the
 * headless browser's fake microphone can play it and the silence gate can end the turn.
 * WAV, because Chromium's fake audio capture takes nothing else, and padded in plain Node
 * so this needs no ffmpeg.
 */
import fs from 'node:fs';
import path from 'node:path';

const ENV = 'C:/Users/Admin/Desktop/sean_web_new/suara/.env';
const OUT = process.argv[3] ?? 'C:/Users/Admin/AppData/Local/Temp/suara-check/ask.wav';
const TEXT = process.argv[2] ?? 'Got clinic near Bedok that take CHAS or not?';
const SILENCE_SECONDS = 6;

const line = fs.readFileSync(ENV, 'utf8').split(/\r?\n/).find((l) => l.startsWith('OPENAI_API_KEY='));
const key = line.slice('OPENAI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');

const res = await fetch('https://api.openai.com/v1/audio/speech', {
	method: 'POST',
	headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
	body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'marin', input: TEXT, response_format: 'wav', speed: 0.95 }),
});
if (!res.ok) throw new Error(`speech ${res.status}: ${(await res.text()).slice(0, 200)}`);
const wav = Buffer.from(await res.arrayBuffer());

// Read the format chunk, then rewrite the file with trailing silence.
const channels = wav.readUInt16LE(22);
const rate = wav.readUInt32LE(24);
const bits = wav.readUInt16LE(34);
const dataAt = wav.indexOf('data', 12, 'ascii');
const dataSize = wav.readUInt32LE(dataAt + 4);
const audio = wav.subarray(dataAt + 8, dataAt + 8 + dataSize);
const silence = Buffer.alloc(rate * channels * (bits / 8) * SILENCE_SECONDS);

const header = Buffer.from(wav.subarray(0, dataAt + 8));
header.writeUInt32LE(header.length - 8 + audio.length + silence.length, 4);
header.writeUInt32LE(audio.length + silence.length, dataAt + 4);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, audio, silence]));
console.log(`${OUT}: ${rate} Hz, ${channels} ch, ${bits}-bit, ${(audio.length / (rate * channels * (bits / 8))).toFixed(1)}s speech + ${SILENCE_SECONDS}s silence`);
