/* ═══════════════ DOMAIN: Suara voice screens, 10 decisions, one screen each ═══════════════
   Owner's limits (2026-09-24): at most 10 multiple-choice screens, broad decisions only, no
   repeats. So: one screen per decision in a fixed order through the app, three options each,
   best pick only, then the combined result. One pick per decision is a direct choice, not a
   settled estimate; the Profile says so. */
const SRC = {
  current: 'Current Suara',
  x: {name: 'X / Twitter legacy blue', url: 'https://mobbin.com/colors/brand/twitter'},
  apple: {name: 'Apple systemBlue', url: 'https://sarunw.com/posts/dark-color-cheat-sheet/'},
  paypal: {name: 'PayPal brand guide', url: 'https://www.scribd.com/document/959133671/PayPal-Newsroom-2022'},
  visa: {name: 'Visa brand standards', url: 'https://corporate.visa.com/content/dam/VCOM/corporate/about-visa/documents/visa-brand-standards-sept2025.pdf'},
  mui: 'modern-ui default',
  gen: 'Generated: the extreme',
};
const LAB = {
  id: 'suara-voice-10',
  title: 'Suara · 10 choices',
  choose: 3,
  askWorst: false,       // one pick per screen
  repeatEvery: 0,        // no repeat screens
  order: ['home', 'action', 'listen', 'light', 'loading', 'results', 'surface', 'confirm', 'tempo', 'done'],
  genes: {
    home:    {label: 'Home screen', scene: 'home', values: {
      tiles: {name: 'Mic and topic tiles', source: SRC.current},
      list:  {name: 'Mic and a topic list'},
      big:   {name: 'Just the mic', source: SRC.gen}}},
    action:  {label: 'Main button colour', scene: 'home', values: {
      black: {name: 'Black', source: SRC.current, hex: '#000000'},
      blue:  {name: 'Payment blue', source: SRC.paypal, hex: '#0070E0'},
      navy:  {name: 'Card navy', source: SRC.visa, hex: '#1A1F71'}}},
    listen:  {label: 'Microphone while listening', scene: 'listening', values: {
      red:   {name: 'Red', source: SRC.current},
      blue:  {name: 'Blue'},
      black: {name: 'Black, blue ring'}}},
    light:   {label: 'Blue for "working" and "done"', scene: 'searching', values: {
      x:     {name: 'X blue', source: SRC.x, hex: '#1D9BF0'},
      apple: {name: 'Apple blue', source: SRC.apple, hex: '#007AFF'},
      cobalt:{name: 'Cobalt', source: SRC.mui, hex: '#2F5BEA'}}},
    loading: {label: 'While it searches', scene: 'searching', values: {
      one:   {name: 'One light round the card', source: SRC.current},
      twin:  {name: 'Two lights'},
      spin:  {name: 'A spinner'}}},
    results: {label: 'How answers are laid out', scene: 'results', values: {
      grid:  {name: 'Two per row', source: SRC.current},
      list:  {name: 'One per row'},
      lead:  {name: 'Best answer large, others below'}}},
    surface: {label: 'Card style', scene: 'results', values: {
      tint:     {name: 'Soft grey', source: SRC.current},
      hairline: {name: 'White with a line'},
      lift:     {name: 'White with a shadow'}}},
    confirm: {label: 'Yes and no', scene: 'confirm', values: {
      squares: {name: 'Two big squares', source: SRC.current},
      stacked: {name: 'Two wide rows'},
      buttons: {name: 'Two plain buttons'}}},
    tempo:   {label: 'Animation speed', scene: 'confirm', values: {
      standard: {name: 'Standard', t: 1.15, source: SRC.current},
      calm:     {name: 'Calm', t: 1.6},
      brisk:    {name: 'Brisk', t: 0.75}}},
    done:    {label: 'The last step is done', scene: 'done', values: {
      ripple: {name: 'Tick and a ripple', source: SRC.current},
      plain:  {name: 'Just the tick'},
      burst:  {name: 'Tick and a burst'}}},
  },
  scenes: [
    {id: 'home', name: 'Home', group: 'Start'},
    {id: 'listening', name: 'Listening', group: 'Voice'},
    {id: 'searching', name: 'Finding the answer', group: 'Voice'},
    {id: 'results', name: 'Answers', group: 'Answers'},
    {id: 'confirm', name: 'Start these steps?', group: 'Steps'},
    {id: 'done', name: 'Finished', group: 'Steps'},
  ],
  // The current approved direction, as a nudge only; one pick overturns it.
  priors: {home: {tiles: [2, 1]}, action: {black: [2, 1]}, listen: {red: [2, 1]}, results: {grid: [2, 1]}},
  pool: null,
  render: renderSuara,
};

const IC = {
  wave: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  tick: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5l4 4 8-9"/></svg>',
  cross: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
};
const TOPICS = ['Health costs', 'CPF and support', 'Scams', 'Getting around', 'Bills and housing', 'Phone help'];
const bar = () => `<div class="bar"><span class="mark">${IC.wave}</span><span class="brand">Suara</span><span class="pill">Find</span><span class="pill">English</span></div>`;
const mark = (size, flourish = 'none', stroke) => `<span class="mx-mark" aria-hidden="true" data-variant="filled" data-flourish="${flourish}"
  style="--mx-size:${size}px;--mx-sizen:${size};--mx-delay:.1s${stroke ? `;--mx-stroke:${stroke}` : ''}"><span class="mx-fx mx-fx-glow"></span><span class="mx-fx mx-fx-ripple"></span>
  <span class="mx-fx mx-fx-burst">${'<i></i>'.repeat(8)}</span><span class="mx-disc"></span>
  <svg class="mx-ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.8" pathLength="1"/></svg>
  <svg class="mx-tick" viewBox="0 0 24 24"><path d="M7.4 12.4l3.1 3.1 6.2-6.4" pathLength="1"/></svg></span>`;
const edge = (state, inner, twin) => `<div class="mx-edge mx-bolt" data-state="${state}"${twin ? ' data-twin="true"' : ''} style="--mx-edge-r:18px">
  <span class="mx-edge-halo"><span><i></i></span></span><span class="mx-edge-ring"><i></i></span>${inner}</div>`;
const level = (active, inner) => `<span class="mx-level" data-active="${active}"><span class="mx-level-disc" data-layer="outer"></span><span class="mx-level-disc" data-layer="inner"></span>${inner}</span>`;

/** Re-runs a scene's own timeline each time the lab replays the card (it toggles .play). */
function onPlay(el, run) {
  el._mo?.disconnect();
  const clear = () => { (el._ts || []).forEach(clearTimeout); el._ts = []; };
  const go = () => { clear(); run((ms, f) => el._ts.push(setTimeout(f, ms))); };
  el._mo = new MutationObserver(() => { if (el.classList.contains('play') && !el.classList.contains('resetting')) go(); });
  el._mo.observe(el, {attributes: true, attributeFilter: ['class']});
  go();
}

function renderSuara(el, scene, g) {
  const V = LAB.genes, t = V.tempo.values[g.tempo].t, light = V.light.values[g.light].hex, act = V.action.values[g.action].hex;
  const listenFill = g.listen === 'red' ? '#D70015' : g.listen === 'blue' ? '#0070E0' : '#000000';
  const listenRing = g.listen === 'red' ? '#D70015' : light;
  const vars = `--act:${act};--mx-light:${light};--mx-accent:${light};--mx-t:${t};--listen-ring:${listenRing}`;
  let body = '', cycle = null;

  if (scene === 'home') {
    const big = g.home === 'big';
    const topics = g.home === 'tiles' ? `<p class="lbl">Or pick a topic</p><div class="tiles">${TOPICS.map((x) => `<div class="tile">${x}</div>`).join('')}</div>`
      : g.home === 'list' ? `<p class="lbl">Or pick a topic</p><div class="rows">${TOPICS.map((x) => `<div class="row">${x}${IC.chev}</div>`).join('')}</div>`
      : `<div class="grow"></div><div class="quiet">Or pick a topic</div>`;
    body = `<h1>What do you need?</h1><div class="mz" style="--mic:${big ? 150 : g.home === 'list' ? 92 : 104}px;${big ? 'padding-top:40px' : ''}">
      ${level(false, `<div class="mic">${IC.mic}</div>`)}<p class="miclbl">Tap to speak</p></div>${topics}`;
  }

  if (scene === 'listening') {
    body = `<h1>I'm listening</h1><p class="lead">Say it in your own words. Take your time.</p>
      <div class="mz" style="--mic:118px;--act:${listenFill};padding-top:34px">${level(true, `<div class="mic">${IC.stop}</div>`)}
      <div class="wave" style="margin-top:22px">${'<i></i>'.repeat(18)}</div><p class="miclbl">Tap when done</p></div>`;
    cycle = 3000;
  }

  if (scene === 'searching') {
    const said = `<p class="said"><span class="small">You said </span><b>How much is a polyclinic visit for me?</b></p>`;
    const answer = (st) => `<div class="sc best"><span class="bm">${st === 'run' ? '' : mark(20)}${st === 'run' ? '' : 'Best match'}</span>
      <span class="t">Polyclinic fees for seniors</span><span class="sum">Pioneer and Merdeka cardholders pay less.</span></div>`;
    const waiting = g.loading === 'spin'
      ? `<div class="sc best"><span class="spin"><span class="mx-spinner" data-visible="true"></span>Finding the right answer</span><div class="ph-bars"><i></i><i></i><i></i></div></div>`
      : edge('run', `<div class="sc best"><div class="ph-bars"><i></i><i></i><i></i></div></div>`, g.loading === 'twin');
    body = `${said}<h1 class="head">Finding answers</h1><div class="slot">${waiting}</div>`;
    cycle = Math.round(3600 * t / 1.15);
    setTimeout(() => onPlay(el, (at) => {
      const slot = el.querySelector('.slot'), head = el.querySelector('.head'); if (!slot) return;
      slot.innerHTML = waiting; head.textContent = 'Finding answers';
      at(Math.round(1800 * t / 1.15), () => {
        head.textContent = '1 answer';
        slot.innerHTML = g.loading === 'spin' ? answer('land') : edge('land', answer('land'));
        at(Math.round(900 * t / 1.15), () => { const e = slot.querySelector('.mx-edge'); if (e) e.dataset.state = 'off'; });
      });
    }), 0);
  }

  if (scene === 'results') {
    const best = (lg) => `<div class="sc best"><span class="bm">${mark(20)}Best match</span><span class="t${lg ? ' lg' : ''}">${lg ? 'Polyclinic fees for seniors' : 'Polyclinic fees'}</span>${lg ? '<span class="sum">Pioneer and Merdeka cardholders pay less at polyclinics.</span>' : ''}<span class="meta"><b>Answer</b>${IC.chev}</span></div>`;
    const others = [['CHAS card', 'CHAS card: what it covers', 'Answer'], ['MediSave outpatient', 'MediSave for outpatient bills', '2 steps'], ['Pioneer card', 'Replacing a lost Pioneer card', 'Answer']];
    const said = `<p class="said"><span class="small">You said </span><b>How much is a polyclinic visit for me?</b></p><p class="lbl" style="margin-top:2px">4 answers</p>`;
    const cards = g.results === 'grid'
      ? `<div class="grid2 cards">${best(false)}${others.map(([s, , m]) => `<div class="sc"><span class="t">${s}</span><span class="meta">${m}${IC.chev}</span></div>`).join('')}</div>`
      : g.results === 'list'
      ? `<div class="list cards">${best(true)}${others.map(([, f, m]) => `<div class="sc"><span class="t">${f}</span><span class="meta">${m}${IC.chev}</span></div>`).join('')}</div>`
      : `<div class="list cards">${best(true)}${others.map(([, f, m]) => `<div class="sc compact"><span class="t">${f}</span><span class="meta">${m}${IC.chev}</span></div>`).join('')}</div>`;
    body = `${said}${cards}`;
    cycle = 2400;
  }

  if (scene === 'confirm') {
    const l = g.confirm;
    body = `<h1 style="margin-top:6px">Start these steps?</h1><p class="lead">MediSave for outpatient bills. 2 steps, and you confirm each one.</p>
      <div class="yn" data-l="${l}" style="margin-top:6px">
        <div class="ch yes"><i class="fill"></i><i class="tap"></i><span class="disc">${IC.tick}</span><span>Yes, start</span></div>
        <div class="ch no"><span class="disc">${IC.cross}</span><span>Not this</span></div></div>`;
    cycle = Math.round(2400 * t / 1.15) + 600;
  }

  if (scene === 'done') {
    const fl = g.done === 'plain' ? 'none' : g.done;
    body = `<div class="done">${mark(76, fl, 4.5)}<h1>That is every step</h1><p class="lead">MediSave for outpatient bills</p></div>
      <div class="grow"></div><div class="btn">Ask something else</div>`;
    cycle = Math.round(2400 * t / 1.15);
  }

  el.innerHTML = `<div class="ph" data-surface="${g.surface}" style="${vars}">${bar()}${body}</div>`;
  return cycle;
}
/* ═══════════════ END DOMAIN ═══════════════ */
