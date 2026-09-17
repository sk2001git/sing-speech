/**
 * Read the open datasets behind the "where is…" answers into one file.
 *
 *   npx tsx scripts/kb/build-places.ts
 *
 * Writes data/kb/places.json: the places themselves, and for each dataset its id, name,
 * agency, the date the agency last updated it and the date we read it — so a card can say
 * where the address came from and how old it is. Singapore Open Data Licence.
 *
 * data.gov.sg allows 5 requests a minute, so this waits between calls.
 */
import fs from 'node:fs';
import path from 'node:path';
import { placeFromChas, placeFromEldercare, placeFromPharmacy, type Place } from '../../src/lib/places/places';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'data/kb/places.json');
const UA = 'SuaraBot/0.1 (knowledge base of official answers for older Singaporeans)';
const GAP_MS = 13_000;

const DATASETS = [
	{ id: 'd_548c33ea2d99e29ec63a7cc9edcccedc', kind: 'chas-clinic', read: placeFromChas },
	{ id: 'd_f0fd1b3643ed8bd34bd403dedd7c1533', kind: 'eldercare', read: placeFromEldercare },
	{ id: 'd_bb92615f43de22933e4479558b1f6c36', kind: 'pharmacy', read: placeFromPharmacy },
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (url: string) => {
	const res = await fetch(url, { headers: { 'User-Agent': UA } });
	if (!res.ok) throw new Error(`${url} -> ${res.status}`);
	return res;
};

const sources: Array<Record<string, string>> = [];
const places: Place[] = [];
const at = new Date().toISOString();

for (const dataset of DATASETS) {
	const meta = (await (await get(`https://api-production.data.gov.sg/v2/public/api/datasets/${dataset.id}/metadata`)).json()) as {
		data: { name: string; managedBy: string; lastUpdatedAt: string; format: string };
	};
	await sleep(GAP_MS);

	const poll = (await (await get(`https://api-open.data.gov.sg/v1/public/api/datasets/${dataset.id}/poll-download`)).json()) as {
		data: { url: string };
	};
	const geo = (await (await get(poll.data.url)).json()) as { features: unknown[] };
	await sleep(GAP_MS);

	let kept = 0;
	for (const feature of geo.features) {
		const place = dataset.read(feature as never);
		if (place) {
			places.push(place);
			kept++;
		}
	}
	sources.push({
		datasetId: dataset.id,
		kind: dataset.kind,
		name: meta.data.name,
		agency: meta.data.managedBy,
		lastUpdatedAt: meta.data.lastUpdatedAt,
		url: `https://data.gov.sg/datasets/${dataset.id}/view`,
		licence: 'Singapore Open Data Licence',
		fetchedAt: at,
	});
	console.log(`${meta.data.name}: ${kept} of ${geo.features.length} features kept (${meta.data.managedBy}, updated ${meta.data.lastUpdatedAt.slice(0, 10)})`);
}

fs.writeFileSync(OUT, `${JSON.stringify({ built_at: at, sources, places })}\n`);
console.log(`\nWrote ${path.relative(ROOT, OUT)}: ${places.length} places from ${sources.length} datasets.`);
