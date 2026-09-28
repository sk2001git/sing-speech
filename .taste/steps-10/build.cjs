// Builds lab.html: the taste-discovery lab (0.3) with Suara's guided-steps screens, and the
// owner's limits: one screen per decision (LAB.perGene 1), a fixed order, one pick, no repeats,
// no duels. Run: node build.cjs. The skill's lab.html is read, never written.
const fs = require('fs');
const path = require('path');
const here = __dirname;
const SKILL = 'C:/Users/Admin/Desktop/knowledge-store/skills/taste-discovery/assets/lab.html';

let html = fs.readFileSync(SKILL, 'utf8');
const swap = (from, to, what) => {
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`${what}: expected 1 match, found ${n}`);
  html = html.replace(from, () => to);
};
const between = (start, end, content, what) => {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`${what}: markers not found`);
  html = html.slice(0, a + start.length) + content + html.slice(b);
};

between('<style id="domain-css">', '</style>', '\n' + fs.readFileSync(path.join(here, 'domain.css'), 'utf8') + '\n', 'domain css');
const jsStart = html.indexOf('/* ═══════════════ DOMAIN:'), jsEnd = html.indexOf('/* ═══════════════ END DOMAIN ═══════════════ */');
if (jsStart < 0 || jsEnd < 0) throw new Error('domain js markers not found');
html = html.slice(0, jsStart) + fs.readFileSync(path.join(here, 'domain.js'), 'utf8').trim() + '\n' + html.slice(jsEnd + '/* ═══════════════ END DOMAIN ═══════════════ */'.length);
// No webfont requests: the lab uses the system face.
html = html.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, '');

// 1. No repeat screens (LAB.repeatEvery: 0)
swap('CHECK_EVERY = 8,', 'CHECK_EVERY = LAB.repeatEvery ?? 8,', 'repeatEvery');
swap('if (n && n % CHECK_EVERY === CHECK_EVERY-1 && past.length){', 'if (CHECK_EVERY > 0 && n && n % CHECK_EVERY === CHECK_EVERY-1 && past.length){', 'repeat guard');
// 2. One pick, no "least liked" (LAB.askWorst: false)
swap("if (shown.length > 2) phase('worst'); else nextBoard();", "if (shown.length > 2 && LAB.askWorst !== false) phase('worst'); else nextBoard();", 'askWorst');
// 3. A fixed order through the guide (LAB.order), each decision on its own scene
swap('  const ids = live.length ? live : GK;', '  if (LAB.order && !S.more){ const o = LAB.order.find(g => live.includes(g)); if (o) return (S.lastGene = o); }\n  const ids = live.length ? live : GK;', 'order');
swap('const g = nextGene(), scene = nextScene(), base = champion();', 'const g = nextGene(), scene = G[g].scene || nextScene(), base = champion();', 'scene per decision');
// 4. Skip moves on rather than asking the same decision again
swap("const geneDone = g => ['settled','indifferent'].includes(status(g)) || shownCount(g) >= PER_GENE;",
  "const geneDone = g => ['settled','indifferent'].includes(status(g)) || shownCount(g) >= PER_GENE || (S.skipped || []).includes(g);", 'skip counts as done');
swap("  nextBoard(kind==='skip' ? 0 : 420);", "  if (kind === 'skip' && ch.gene){ S.skipped = [...new Set([...(S.skipped || []), ch.gene])]; save(); }\n  nextBoard(kind==='skip' ? 0 : 420);", 'record skip');
// 5. The finish: say it plainly, point at the combined result, no duels
swap('<p>${n} screens. Every decision is settled, shows no clear favourite, or has had its ${PER_GENE} screens. Your picks are saved.</p>',
  '<p>${n} of ${GK.length} decisions made, one pick each. Your picks are saved. Open the Profile tab to see them put together.</p>', 'done text');
swap('<p>Optional: ${DUEL_TARGET} quick rounds on the Duel tab check that these winners work together.</p>', '', 'no duel offer');
swap('<button id="cDuel">Check them together (${DUEL_TARGET} duels)</button>', '', 'no duel button');
swap("$('cDuel').onclick =", "if ($('cDuel')) $('cDuel').onclick =", 'no duel handler');

fs.writeFileSync(path.join(here, 'lab.html'), html);
console.log('lab.html written,', html.length, 'bytes');
