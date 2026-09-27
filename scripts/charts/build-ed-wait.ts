/**
 * The copy of MOH's A&E ward-bed waiting times built into the app (vault plan-suara-0017), for
 * when neither KV nor MOH can answer. Fetched exactly as the Worker fetches it.
 *
 *   npx tsx scripts/charts/build-ed-wait.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEdWait } from '../../src/lib/charts/ed-wait-source';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'data/charts/ed-wait.json');

const none = { week: { from: '', to: '' }, latest: {}, weeks: [], first: '', fetchedAt: '', file: '' };
const chart = await loadEdWait({ kv: undefined, snapshot: none });
if (!chart.file) throw new Error('MOH could not be read; the built-in copy was left as it was');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(chart)}\n`);
console.log(`${path.relative(ROOT, OUT)}: ${chart.file}, ${chart.week.from} to ${chart.week.to}, ${Object.keys(chart.latest).length} hospitals, fetched ${chart.fetchedAt}`);
