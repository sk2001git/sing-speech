// Voice Suara's test requests with Gemini TTS.
//
//   node scripts/test-audio/generate.mjs                          # fixtures/audio/phrases.json -> WAV
//   FFMPEG=/path/to/ffmpeg node scripts/test-audio/generate.mjs --set eval-set.json
//                                                                 # -> fixtures/audio/eval/*.mp4
//   ... --force            regenerate everything
//   ... --only <id>        one item
//
// Item sources in a set:
//   tts     voiced from `text` with `direction` and `voice`
//   reuse   converted from an existing fixtures/audio/<from>.wav
//   derive  an earlier item in the same set with pink noise mixed in at amplitude `noise`
//
// MP4 output is AAC in an MP4 container, the format iPhone Safari records. Claude models
// output text only: the scripts are Claude's, the audio is Gemini's, and the accents are an
// approximation that never stands in for real older speakers.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const audioDir = path.join(root, 'fixtures', 'audio');
const model = process.env.TTS_MODEL ?? 'gemini-3.1-flash-tts-preview';
const gapMs = Number(process.env.TTS_GAP_MS ?? 7000);

const args = process.argv.slice(2);
const flag = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : null;
};
const force = args.includes('--force');
const only = flag('--only');
const setName = flag('--set') ?? 'phrases.json';
const isEvalSet = setName !== 'phrases.json';
const format = flag('--format') ?? (isEvalSet ? 'mp4' : 'wav');
const outDir = isEvalSet ? path.join(audioDir, 'eval') : audioDir;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28);
	header.writeUInt16LE((channels * bitsPerSample) / 8, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write('data', 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

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

async function tts(item, key, attempt = 1) {
	const res = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
			body: JSON.stringify({
				contents: [{ parts: [{ text: `${item.direction}: ${item.text}` }] }],
				generationConfig: {
					responseModalities: ['AUDIO'],
					speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: item.voice } } },
				},
			}),
		},
	);
	if (res.status === 429) {
		const body = await res.text();
		const quota = (() => {
			try {
				const details = JSON.parse(body)?.error?.details ?? [];
				const failure = details.find((d) => String(d['@type'] ?? '').endsWith('QuotaFailure'));
				return (failure?.violations ?? []).map((v) => `${v.quotaMetric ?? ''} ${v.quotaId ?? ''} limit=${v.quotaValue ?? '?'}`).join('; ');
			} catch {
				return '';
			}
		})();
		if (attempt >= 4) throw new Error(`${item.id}: still rate limited after ${attempt} attempts${quota ? ` (${quota})` : ''}`);
		const wait = Math.ceil((retryDelaySeconds(body) ?? 30) + 2);
		console.log(`wait ${item.id}: rate limited, retrying in ${wait}s${quota ? ` (${quota})` : ''}`);
		await sleep(wait * 1000);
		return tts(item, key, attempt + 1);
	}
	if (!res.ok) throw new Error(`${item.id}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
	const json = await res.json();
	const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
	if (!part) {
		const candidate = json.candidates?.[0];
		const text = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ').slice(0, 160);
		throw new Error(
			`${item.id}: no audio in response (finishReason=${candidate?.finishReason ?? 'none'}${json.promptFeedback?.blockReason ? `, blocked=${json.promptFeedback.blockReason}` : ''}${text ? `, text="${text}"` : ''})`,
		);
	}
	const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000);
	return wav(Buffer.from(part.inlineData.data, 'base64'), rate);
}

function ffmpegPath() {
	const p = process.env.FFMPEG;
	if (!p || !fs.existsSync(p)) {
		throw new Error('MP4 output needs ffmpeg: set FFMPEG to an ffmpeg binary (for example from the ffmpeg-static package)');
	}
	return p;
}

function run(ffArgs) {
	execFileSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...ffArgs], { stdio: ['ignore', 'ignore', 'inherit'] });
}

/** Encode any input audio to AAC in an MP4 container, mono, 24 kHz. */
function toMp4(input, output) {
	run(['-i', input, '-ac', '1', '-ar', '24000', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', output]);
}

/** Mix pink noise under an existing clip at the given amplitude, encoding to MP4. */
function withNoise(input, output, amplitude) {
	run([
		'-i', input,
		'-filter_complex',
		`[0:a]aformat=sample_rates=24000:channel_layouts=mono[a];anoisesrc=color=pink:amplitude=${amplitude}:sample_rate=24000[n];[a][n]amix=inputs=2:duration=first:normalize=0[out]`,
		'-map', '[out]', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', output,
	]);
}

function durationSeconds(file) {
	try {
		execFileSync(ffmpegPath(), ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
	} catch (err) {
		const match = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(String(err.stderr ?? ''));
		if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
	}
	return null;
}

const set = JSON.parse(fs.readFileSync(path.join(audioDir, setName), 'utf8'));
const items = set.items ?? set.phrases;
fs.mkdirSync(outDir, { recursive: true });
const manifestPath = path.join(outDir, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const key = apiKey();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suara-audio-'));

let failures = 0;
for (const item of items) {
	if (only && item.id !== only) continue;
	const source = item.source ?? 'tts';
	const file = path.join(outDir, `${item.id}.${format}`);
	if (!force && fs.existsSync(file)) {
		console.log(`skip ${item.id} (exists)`);
		continue;
	}
	try {
		if (source === 'tts') {
			if (!key) throw new Error('GEMINI_API_KEY is not set in the environment or suara/.env');
			const buffer = await tts(item, key);
			if (format === 'wav') {
				fs.writeFileSync(file, buffer);
			} else {
				const tmpWav = path.join(tmp, `${item.id}.wav`);
				fs.writeFileSync(tmpWav, buffer);
				toMp4(tmpWav, file);
			}
			await sleep(gapMs);
		} else if (source === 'reuse') {
			const from = path.join(audioDir, `${item.from}.wav`);
			if (!fs.existsSync(from)) throw new Error(`${item.id}: missing ${path.relative(root, from)}`);
			toMp4(from, file);
		} else if (source === 'derive') {
			const from = path.join(outDir, `${item.from}.${format}`);
			if (!fs.existsSync(from)) throw new Error(`${item.id}: generate ${item.from} first`);
			withNoise(from, file, item.noise ?? 0.05);
		} else {
			throw new Error(`${item.id}: unknown source ${source}`);
		}

		const seconds = format === 'mp4' ? durationSeconds(file) : null;
		manifest[item.id] = {
			file: path.basename(file),
			format,
			source,
			from: item.from ?? null,
			noise: item.noise ?? null,
			text: item.text ?? null,
			direction: item.direction ?? null,
			voice: item.voice ?? null,
			language: item.language,
			expect_intent: item.expect_intent ?? null,
			also_acceptable: item.also_acceptable ?? [],
			expect_path: item.expect_path ?? item.expect?.path ?? null,
			perturbation: item.perturbation ?? [],
			difficulty: item.difficulty ?? null,
			expect: item.expect ?? null,
			synthetic: true,
			model: source === 'tts' ? model : null,
			seconds: seconds === null ? null : Number(seconds.toFixed(2)),
			generated_at: new Date().toISOString(),
		};
		console.log(`ok   ${item.id}  ${source}${seconds ? `  ${seconds.toFixed(1)}s` : ''}`);
	} catch (err) {
		failures += 1;
		console.error(`fail ${err.message}`);
	}
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
