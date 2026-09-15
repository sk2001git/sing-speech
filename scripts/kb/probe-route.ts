/**
 * Call a hearing route live on recorded clips, outside the Worker.
 *
 *   npx tsx scripts/kb/probe-route.ts [clip.mp4 ...]
 *
 * Node's global WebSocket cannot send an Authorization header, so this uses the `ws`
 * package for the socket. In the Worker, `workersConnect` does the same job.
 */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { OpenAiWsRoute, type Connect } from '../../src/lib/routes/openai-ws';

const ROOT = path.resolve(import.meta.dirname, '../..');

function key(name: string): string | undefined {
	if (process.env[name]) return process.env[name];
	const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
	return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
}

let transport = 'unknown';
const nodeConnect: Connect = (url, headers) =>
	new Promise((resolve, reject) => {
		const ws = new WebSocket(url, { headers });
		ws.once('unexpected-response', (_req, res) => reject(new Error(`websocket handshake refused: ${res.statusCode}`)));
		ws.once('error', reject);
		ws.once('open', () => {
			transport = 'websocket';
			resolve({
				send: (data) => ws.send(data),
				onMessage: (fn) => ws.on('message', (data) => fn(data.toString())),
				close: () => ws.close(),
			});
		});
	});

const clips = process.argv.slice(2);
const files = clips.length ? clips : ['fixtures/audio/eval/chas-clean.mp4', 'fixtures/audio/eval/appt-clean-noise.mp4'];

const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
	if (String(args[0]).includes('websocket unavailable')) transport = 'http fallback';
	originalWarn(...args);
};

const route = new OpenAiWsRoute({ apiKey: key('OPENAI_API_KEY'), connect: nodeConnect, timeoutMs: 30_000 });
for (const file of files) {
	transport = 'unknown';
	const audio = fs.readFileSync(path.join(ROOT, file));
	const t0 = Date.now();
	try {
		const heard = await route.hear(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength), 'audio/mp4');
		console.log(`${path.basename(file)}: ok ${Date.now() - t0}ms via ${transport}\n   ${JSON.stringify(heard)}`);
	} catch (err) {
		const e = err as { reason?: string; message?: string };
		console.log(`${path.basename(file)}: FAILED ${Date.now() - t0}ms via ${transport} reason=${e.reason ?? '-'} ${e.message}`);
	}
}
