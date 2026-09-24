// Builds lab.html: the taste-discovery lab with Suara's screens, and four options the owner's
// limits need (10 screens, no repeats, one pick, fixed order). Run: node build.cjs
// The engine options are patched into this copy only; the skill's lab.html is read, never written.
const fs = require('fs');
const path = require('path');
const here = __dirname;
const SKILL = 'C:/Users/Admin/Desktop/knowledge-store/skills/taste-discovery/assets/lab.html';
const MOTION = path.resolve(here, '../../src/components/motion/motion.css');

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

// Specimens: motion primitives (as Suara ships them) + Suara screen styles
between('<style id="domain-css">', '</style>', '\n' + fs.readFileSync(MOTION, 'utf8') + '\n' + fs.readFileSync(path.join(here, 'domain.css'), 'utf8') + '\n', 'domain css');
// Domain: genes, scenes, render
const jsStart = html.indexOf('/* ═══════════════ DOMAIN:'), jsEnd = html.indexOf('/* ═══════════════ END DOMAIN ═══════════════ */');
if (jsStart < 0 || jsEnd < 0) throw new Error('domain js markers not found');
html = html.slice(0, jsStart) + fs.readFileSync(path.join(here, 'domain.js'), 'utf8').trim() + '\n' + html.slice(jsEnd + '/* ═══════════════ END DOMAIN ═══════════════ */'.length);
// No webfont requests: the lab uses the system face and the specimens use Suara's.
html = html.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, '');

// 1. LAB.repeatEvery: 0 turns the consistency repeats off
swap('const K = Math.max(2, LAB.choose || 3), CHECK_EVERY = 8;', 'const K = Math.max(2, LAB.choose || 3), CHECK_EVERY = LAB.repeatEvery ?? 8;', 'repeatEvery');
swap('if (n && n % CHECK_EVERY === CHECK_EVERY-1 && past.length){', 'if (CHECK_EVERY > 0 && n && n % CHECK_EVERY === CHECK_EVERY-1 && past.length){', 'repeat guard');
// 2. LAB.order: one screen per dimension, in this order, advanced only by an answer or a skip
swap('function nextGene(){ // rotate', 'function nextGene(){ if (LAB.order) return (S.lastGene = LAB.order[Math.min(S.qi || 0, LAB.order.length - 1)]); // rotate', 'order');
swap('const g = nextGene(), scene = nextScene(), base = champion();', 'const g = nextGene(), scene = G[g].scene || nextScene(), base = champion();', 'scene per decision');
swap('function showBoard(){\n  ch = makeBoard();', 'function showBoard(){\n  if (LAB.order && (S.qi || 0) >= LAB.order.length) return finished();\n  ch = makeBoard();', 'finish');
swap("    S.rounds++; S.history.push(ch.rec); if (S.history.length > 300)", "    S.rounds++; S.qi = (S.qi || 0) + 1; S.history.push(ch.rec); if (S.history.length > 300)", 'advance on best');
swap("  nextBoard(kind==='skip' ? 0 : 420);", "  if (LAB.order) { S.qi = (S.qi || 0) + (kind === 'skip' || ch.cards.length ? 1 : 0); save(); meta(); }\n  nextBoard(kind==='skip' ? 0 : 420);", 'advance on other');
// 3. LAB.askWorst: false skips the "least liked" step
swap("    if (shown.length > 2) phase('worst'); else nextBoard();", "    if (shown.length > 2 && LAB.askWorst !== false) phase('worst'); else nextBoard();", 'askWorst');
// 4. Progress and the end
swap("const meta = () => $('rounds').textContent = `${S.rounds} round${S.rounds===1?'':'s'}`;",
  "const meta = () => $('rounds').textContent = LAB.order ? `${Math.min((S.qi || 0) + 1, LAB.order.length)} of ${LAB.order.length}` : `${S.rounds} round${S.rounds===1?'':'s'}`;", 'meta');
swap("  $('note').textContent = n < 12 ?", "  $('note').textContent = LAB.order ? `${Math.min(S.qi || 0, LAB.order.length)} of ${LAB.order.length} choices made. One pick per decision: these are your choices put together, not a settled estimate.` : n < 12 ?", 'profile note');
swap('function source(v){', `function finished(){
  ch = null; $('cGene').textContent = 'All ' + LAB.order.length + ' done'; $('cScene').textContent = ''; $('cStep').textContent = '';
  $('cHint').textContent = 'Here is Suara with every choice you made. Reset on the Profile tab starts again.';
  $('board').style.setProperty('--k', 1); $('board').innerHTML = '<p class="learned">Opening your Suara…</p>';
  meta(); setTimeout(() => document.querySelector('[data-tab="profile"]').click(), 700);
}
function source(v){`, 'finished()');

fs.writeFileSync(path.join(here, 'lab.html'), html);
console.log('lab.html written,', html.length, 'bytes');
