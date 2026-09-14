// Score Suara's spoken understanding against the labelled evaluation set.
//
//   node scripts/test-audio/evaluate.mjs                  # against http://127.0.0.1:4321
//   SUARA_URL=https://… node scripts/test-audio/evaluate.mjs
//
// Sends every clip in fixtures/audio/eval/manifest.json to /api/turn and reports:
//   - intent precision, recall and F1 per label, macro and weighted averages, micro F1
//   - "acted correctly" precision, recall and F1: did Suara answer, without asking, with the
//     right service — the error that sends someone to the wrong place
//   - accuracy by perturbation, a confusion matrix, and median latency
// Writes fixtures/audio/eval/results/<timestamp>.json and a Markdown report beside it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const evalDir = path.join(root, 'fixtures', 'audio', 'eval');
const base = process.env.SUARA_URL ?? 'http://127.0.0.1:4321';

const set = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'audio', 'eval-set.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(evalDir, 'manifest.json'), 'utf8'));
const labels = set.labels;
const SERVICES = labels.filter((l) => l !== 'none' && l !== 'human_handoff');

// The free-tier Gemini key behind /api/turn allows 15 requests a minute for
// gemini-3.5-flash-lite (seen 2026-09-14). Pace below that, or later clips 502 and score as
// misses for a reason that has nothing to do with understanding.
const gapMs = Number(process.env.EVAL_GAP_MS ?? 4500);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rows = [];
const notGenerated = [];
let sent = 0;
for (const item of set.items) {
	if (manifest[item.id] && sent > 0) await sleep(gapMs);
	if (manifest[item.id]) sent += 1;
	const clip = manifest[item.id];
	if (!clip) {
		notGenerated.push(item.id);
		console.log(`missing ${item.id} (not generated)`);
		continue;
	}
	const audio = fs.readFileSync(path.join(evalDir, clip.file));
	const started = Date.now();
	let row = { id: item.id, gold: item.expect_intent, also: item.also_acceptable ?? [], perturbation: item.perturbation, difficulty: item.difficulty };
	try {
		const res = await fetch(`${base}/api/turn`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: base },
			body: JSON.stringify({ kind: 'speech', audioBase64: audio.toString('base64'), mimeType: 'audio/mp4', history: [], unclearStreak: 0 }),
		});
		const body = await res.json().catch(() => ({}));
		const heard = body.history?.[body.history.length - 1];
		row = {
			...row,
			status: res.status,
			ms: Date.now() - started,
			pred: heard?.intent ?? null,
			confidence: heard?.confidence ?? null,
			needs_human: heard?.needsHuman ?? null,
			decision: body.audit?.decision ?? null,
			screen: body.screen?.kind ?? null,
			restatement: heard?.restatement ?? null,
		};
	} catch (err) {
		row = { ...row, status: 'error', ms: Date.now() - started, error: String(err) };
	}
	// A prediction in also_acceptable counts as correct, and is scored as that label.
	row.correct = row.pred !== null && (row.pred === row.gold || row.also.includes(row.pred));
	row.scored_gold = row.correct ? row.pred : row.gold;
	rows.push(row);
	console.log(
		[row.id.padEnd(24), `gold ${row.gold}`.padEnd(22), `pred ${row.pred ?? '-'}`.padEnd(22), `${row.confidence ?? '-'}`.padEnd(5), `${row.decision ?? row.status}`.padEnd(8), row.correct ? 'ok' : 'WRONG'].join(' '),
	);
}

// Every clip that was sent is scored. A failed request has no prediction and counts as a
// miss for its gold label — a failure must never make the numbers look better.
const scored = rows;
const failed = rows.filter((r) => r.pred === null);
const f1 = (p, r) => (p + r === 0 ? 0 : (2 * p * r) / (p + r));
const safe = (n, d) => (d === 0 ? 0 : n / d);

// Intent classification, single label per clip.
const perLabel = labels.map((label) => {
	const tp = scored.filter((r) => r.pred === label && r.scored_gold === label).length;
	const fp = scored.filter((r) => r.pred === label && r.scored_gold !== label).length;
	const fn = scored.filter((r) => r.scored_gold === label && r.pred !== label).length;
	const support = scored.filter((r) => r.scored_gold === label).length;
	const precision = safe(tp, tp + fp);
	const recall = safe(tp, tp + fn);
	return { label, support, tp, fp, fn, precision, recall, f1: f1(precision, recall) };
});
const withSupport = perLabel.filter((l) => l.support > 0);
const macro = {
	precision: withSupport.reduce((s, l) => s + l.precision, 0) / withSupport.length,
	recall: withSupport.reduce((s, l) => s + l.recall, 0) / withSupport.length,
	f1: withSupport.reduce((s, l) => s + l.f1, 0) / withSupport.length,
};
const total = withSupport.reduce((s, l) => s + l.support, 0);
const weighted = {
	precision: withSupport.reduce((s, l) => s + l.precision * l.support, 0) / total,
	recall: withSupport.reduce((s, l) => s + l.recall * l.support, 0) / total,
	f1: withSupport.reduce((s, l) => s + l.f1 * l.support, 0) / total,
};
const micro = safe(scored.filter((r) => r.correct).length, scored.length);

// Acted correctly: the system answered without asking ("act"), with the right service.
const acts = scored.filter((r) => r.decision === 'act');
const actsCorrect = acts.filter((r) => r.correct && SERVICES.includes(r.pred)).length;
const shouldAct = scored.filter((r) => SERVICES.includes(r.scored_gold)).length;
const action = {
	acted: acts.length,
	acted_correctly: actsCorrect,
	should_act: shouldAct,
	precision: safe(actsCorrect, acts.length),
	recall: safe(actsCorrect, shouldAct),
};
action.f1 = f1(action.precision, action.recall);
const confidentWrong = acts.filter((r) => !r.correct);

// Accuracy by perturbation.
const byPerturbation = {};
for (const r of scored) {
	for (const p of r.perturbation ?? []) {
		byPerturbation[p] ??= { n: 0, correct: 0 };
		byPerturbation[p].n += 1;
		byPerturbation[p].correct += r.correct ? 1 : 0;
	}
}

// Confusion matrix, gold rows by predicted columns.
const confusion = Object.fromEntries(labels.map((g) => [g, Object.fromEntries(labels.map((p) => [p, 0]))]));
for (const r of scored) if (confusion[r.scored_gold] && r.pred in confusion[r.scored_gold]) confusion[r.scored_gold][r.pred] += 1;

const latencies = rows.map((r) => r.ms).sort((a, b) => a - b);
const medianMs = latencies[Math.floor(latencies.length / 2)];

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(evalDir, 'results');
fs.mkdirSync(outDir, { recursive: true });

const md = [
	`# Suara understanding eval — ${new Date().toISOString()}`,
	'',
	`Server: ${base}. Clips: ${rows.length} sent and scored, ${failed.length} of them failed with no prediction (counted as misses), ${notGenerated.length} in the set not generated and not scored${notGenerated.length ? `: ${notGenerated.join(', ')}` : ''}. Median latency ${medianMs} ms.`,
	'Synthetic Gemini TTS audio, MP4/AAC. Labels: six intents plus none.',
	'',
	'## Intent classification',
	'',
	'| Label | Support | Precision | Recall | F1 |',
	'|---|---|---|---|---|',
	...perLabel.map((l) => `| ${l.label} | ${l.support} | ${pct(l.precision)} | ${pct(l.recall)} | ${pct(l.f1)} |`),
	`| **Macro** | ${total} | ${pct(macro.precision)} | ${pct(macro.recall)} | ${pct(macro.f1)} |`,
	`| **Weighted** | ${total} | ${pct(weighted.precision)} | ${pct(weighted.recall)} | ${pct(weighted.f1)} |`,
	`| **Micro (accuracy)** | ${total} | ${pct(micro)} | ${pct(micro)} | ${pct(micro)} |`,
	'',
	'## Acted correctly (answered without asking, right service)',
	'',
	`Acted ${action.acted} times, correctly ${action.acted_correctly}; ${action.should_act} clips needed a service answer.`,
	'',
	`| Precision | Recall | F1 |`,
	`|---|---|---|`,
	`| ${pct(action.precision)} | ${pct(action.recall)} | ${pct(action.f1)} |`,
	'',
	`Confident wrong answers (acted, wrong): ${confidentWrong.map((r) => `${r.id} → ${r.pred} ${r.confidence}`).join('; ') || 'none'}`,
	'',
	'## Accuracy by perturbation',
	'',
	'| Perturbation | Clips | Correct | Accuracy |',
	'|---|---|---|---|',
	...Object.entries(byPerturbation).sort().map(([p, v]) => `| ${p} | ${v.n} | ${v.correct} | ${pct(v.correct / v.n)} |`),
	'',
	'## Confusion matrix (rows gold, columns predicted)',
	'',
	`| gold \\ pred | ${labels.join(' | ')} |`,
	`|---|${labels.map(() => '---').join('|')}|`,
	...labels.map((g) => `| ${g} | ${labels.map((p) => confusion[g][p]).join(' | ')} |`),
	'',
	'## Every clip',
	'',
	'| Clip | Gold | Predicted | Confidence | Decision | Correct | Restatement |',
	'|---|---|---|---|---|---|---|',
	...rows.map((r) => `| ${r.id} | ${r.gold} | ${r.pred ?? r.status} | ${r.confidence ?? ''} | ${r.decision ?? ''} | ${r.correct ? 'yes' : 'no'} | ${(r.restatement ?? '').replace(/\|/g, '/')} |`),
	'',
].join('\n');

fs.writeFileSync(path.join(outDir, `${stamp}.json`), JSON.stringify({ base, ran_at: new Date().toISOString(), rows, perLabel, macro, weighted, micro, action, byPerturbation, confusion, medianMs }, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, `${stamp}.md`), md);

console.log(`\nclips sent ${rows.length}, failed ${failed.length}, not generated ${notGenerated.length}`);
console.log(`macro P ${pct(macro.precision)}  R ${pct(macro.recall)}  F1 ${pct(macro.f1)}   micro F1 ${pct(micro)}`);
console.log(`acted-correctly P ${pct(action.precision)}  R ${pct(action.recall)}  F1 ${pct(action.f1)}   confident wrong ${confidentWrong.length}`);
console.log(`median ${medianMs} ms   report fixtures/audio/eval/results/${stamp}.md`);
