// Voice the synthetic test requests in fixtures/audio/phrases.json with Gemini TTS.
//
//   node scripts/test-audio/generate.mjs            # generate missing files
//   node scripts/test-audio/generate.mjs --force    # regenerate everything
//   node scripts/test-audio/generate.mjs --only sg-en-hello
//
// Writes fixtures/audio/<id>.wav (24 kHz mono 16-bit PCM) and fixtures/audio/manifest.json.
// Claude models output text only, so the scripts are Claude's and the audio is Gemini's.
// Synthetic accents are an approximation; they never stand in for real older speakers.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const audioDir = path.join(root, 'fixtures', 'audio');
const model = process.env.TTS_MODEL ?? 'gemini-3.1-flash-tts-preview';

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

function apiKey() {
	if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
	const envFile = path.join(root, '.env');
	if (!fs.existsSync(envFile)) return null;
	for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
		const match = line.match(/^GEMINI_API_KEY=(.+)$/);
		if (match) return match[1].trim();
	}
	return null;
}

/** Wrap raw little-endian PCM in a WAV header. */
function wav(pcm, sampleRate, channels = 1, bitsPerSample = 16) {
	const byteRate = (sampleRate * channels * bitsPerSample) / 8;
	const blockAlign = (channels * bitsPerSample) / 8;
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write('data', 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds to wait from a Gemini 429 body's RetryInfo, or null when it gives none. */
function retryDelaySeconds(bodyText) {
	try {
		const details = JSON.parse(bodyText)?.error?.details ?? [];
		const info = details.find((d) => String(d['@type'] ?? '').endsWith('RetryInfo'));
		const match = /^(\d+(?:\.\d+)?)s$/.exec(info?.retryDelay ?? '');
		return match ? Number(match[1]) : null;
	} catch {
		return null;
	}
}

/** The TTS preview quota is small and per minute: pace requests and honour the server's retry delay. */
async function voice(phrase, key, attempt = 1) {
	const result = await voiceOnce(phrase, key);
	if (result.retryAfter === undefined) return result;
	if (attempt >= 4) throw new Error(`${phrase.id}: still rate limited after ${attempt} attempts`);
	const wait = Math.ceil((result.retryAfter ?? 30) + 2);
	console.log(`wait ${phrase.id}: rate limited, retrying in ${wait}s (attempt ${attempt + 1})`);
	await sleep(wait * 1000);
	return voice(phrase, key, attempt + 1);
}

async function voiceOnce(phrase, key) {
	const res = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
			body: JSON.stringify({
				contents: [{ parts: [{ text: `${phrase.direction}: ${phrase.text}` }] }],
				generationConfig: {
					responseModalities: ['AUDIO'],
					speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: phrase.voice } } },
				},
			}),
		},
	);
	if (res.status === 429) {
		const text = await res.text();
		return { retryAfter: retryDelaySeconds(text) };
	}
	if (!res.ok) throw new Error(`${phrase.id}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
	const json = await res.json();
	const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
	if (!part) throw new Error(`${phrase.id}: no audio in response`);
	const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000);
	const pcm = Buffer.from(part.inlineData.data, 'base64');
	return { buffer: wav(pcm, rate), rate, seconds: pcm.length / 2 / rate, mimeType: part.inlineData.mimeType };
}

const key = apiKey();
if (!key) {
	console.error('GEMINI_API_KEY is not set in the environment or suara/.env');
	process.exit(1);
}

const { phrases } = JSON.parse(fs.readFileSync(path.join(audioDir, 'phrases.json'), 'utf8'));
const manifestPath = path.join(audioDir, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};

let failures = 0;
for (const phrase of phrases) {
	if (only && phrase.id !== only) continue;
	const file = path.join(audioDir, `${phrase.id}.wav`);
	if (!force && fs.existsSync(file)) {
		console.log(`skip ${phrase.id} (exists)`);
		continue;
	}
	try {
		const out = await voice(phrase, key);
		fs.writeFileSync(file, out.buffer);
		manifest[phrase.id] = {
			file: `${phrase.id}.wav`,
			text: phrase.text,
			direction: phrase.direction,
			voice: phrase.voice,
			language: phrase.language,
			expect: phrase.expect,
			synthetic: true,
			model,
			source_mime: out.mimeType,
			seconds: Number(out.seconds.toFixed(2)),
			generated_at: new Date().toISOString(),
		};
		console.log(`ok   ${phrase.id}  ${out.seconds.toFixed(1)}s  ${out.mimeType}`);
		// Space requests out; the preview TTS quota counts requests per minute.
		await sleep(Number(process.env.TTS_GAP_MS ?? 7000));
	} catch (err) {
		failures += 1;
		console.error(`fail ${err.message}`);
	}
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
process.exit(failures ? 1 : 0);
