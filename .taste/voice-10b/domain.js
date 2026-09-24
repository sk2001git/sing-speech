/* ═══════════════ DOMAIN: Suara round 2, 10 decisions, one screen each ═══════════════
   Held fixed from round 1 (obs-0047): just the mic on home, black action, Apple blue,
   best answer large, standard speed, tick and ripple. Round 1 said "none of these" to the
   listening, loading and yes/no options; the owner named ElevenLabs UI for listening and
   Airbnb cards for choices, and "cleaner" overall. Values below are read from ElevenLabs UI's
   source (github.com/elevenlabs/ui) and Airbnb's live site (computed styles, 2026-09-24). */
const EL = (c) => ({name: 'ElevenLabs UI ' + c, url: 'https://github.com/elevenlabs/ui/tree/main/apps/www/registry/elevenlabs-ui/ui'});
const AB = (what) => ({name: 'Airbnb, measured: ' + what, url: 'https://www.airbnb.com/'});
const LAB = {
  id: 'suara-voice-10b',
  title: 'Suara · round 2 · 10 choices',
  choose: 3, askWorst: false, repeatEvery: 0,
  order: ['listen', 'voice', 'think', 'confirm', 'heading', 'header', 'topics', 'page', 'card', 'button'],
  genes: {
    listen:  {label: 'While it listens', scene: 'listening', values: {
      orb:  {name: 'A living orb', source: EL('Orb')},
      vbtn: {name: 'Voice button with a waveform', source: EL('Voice Button')},
      bviz: {name: 'Bar visualiser', source: EL('Bar Visualizer')}}},
    voice:   {label: 'Colour of the voice', scene: 'listening', values: {
      pastel: {name: 'Soft blue-grey', source: {name: 'ElevenLabs Orb default #CADCFC / #A0B9D1', url: 'https://github.com/elevenlabs/ui'}},
      apple:  {name: 'Apple blue', source: 'Round 1 pick'},
      mono:   {name: 'Greys only', source: 'Generated: the extreme'}}},
    think:   {label: 'While it finds the answer', scene: 'searching', values: {
      orb:   {name: 'The orb, thinking', source: EL('Orb, thinking state')},
      shim:  {name: 'Shimmering words', source: EL('Shimmering Text')},
      pulse: {name: 'Grey outline, pulsing', source: AB('#EBEBEB loading bars')}}},
    confirm: {label: 'Yes and no', scene: 'confirm', values: {
      sheet: {name: 'A sheet, one black button', source: AB('sheet 32px, button #222 8px 48px')},
      tiles: {name: 'Two outlined tiles', source: AB('tiles, 1px #DDD, 2px #222')},
      cards: {name: 'Two picture cards', source: AB('listing card shadow')}}},
    heading: {label: 'Headings', scene: 'home', values: {
      airbnb: {name: 'Medium, 26px', source: AB('26px / 600, -0.02em')},
      bold:   {name: 'Heavy, 34px', source: 'Current Suara'},
      light:  {name: 'Light, 30px', source: 'Generated: the extreme'}}},
    header:  {label: 'Top of the screen', scene: 'home', values: {
      suara: {name: 'Logo, Find, English', source: 'Current Suara'},
      ask:   {name: 'One search pill', source: AB('search pill, 40px, shadow 0 6px 20px')},
      none:  {name: 'Nearly nothing', source: 'Generated: the extreme'}}},
    topics:  {label: 'Where the topics are', scene: 'home', values: {
      quiet: {name: 'One button', source: 'Round 1 pick'},
      chips: {name: 'A row of chips', source: AB('chips 34px, 24px radius, 1px #DDDDDD')},
      link:  {name: 'A text link'}}},
    page:    {label: 'Background', scene: 'results', values: {
      white: {name: 'White', source: 'Current Suara'},
      warm:  {name: 'Warm off-white', source: AB('sheet #F4F2EC')},
      grey:  {name: 'Light grey', source: AB('#F7F7F7')}}},
    card:    {label: 'Answer cards', scene: 'results', values: {
      lift:   {name: 'White, soft shadow', source: 'Round 1 pick'},
      airbnb: {name: 'Rounder, crisper shadow', source: AB('card 28px, 0 2px 4px 18% + 1px ring')},
      rows:   {name: 'No cards, just lines', source: AB('#EBEBEB dividers')}}},
    button:  {label: 'Main buttons', scene: 'done', values: {
      airbnb: {name: 'Near-black, gently rounded', source: AB('#222, 8px, 48px')},
      pill:   {name: 'Black pill'},
      current:{name: 'Black, rounder corners', source: 'Current Suara'}}},
  },
  scenes: [
    {id: 'home', name: 'Home', group: 'Start'},
    {id: 'listening', name: 'Listening', group: 'Voice'},
    {id: 'searching', name: 'Finding the answer', group: 'Voice'},
    {id: 'results', name: 'Answers', group: 'Answers'},
    {id: 'confirm', name: 'Start these steps?', group: 'Steps'},
    {id: 'done', name: 'Finished', group: 'Steps'},
  ],
  priors: {},
  pool: null,
  render: renderSuara2,
};

const IC = {
  wave: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
  micSm: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  stop: '<svg width="16" height="16" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>',
  tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.3l3 3 6-6.3"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
};
const PALETTE = {
  pastel: {c0: '#FFFFFF', c1: '#CADCFC', c2: '#A0B9D1', b1: '#E4EDFF', b2: '#8FA9C4', bar: '#8FA9C4'},
  apple:  {c0: '#FFFFFF', c1: '#9CCBFF', c2: '#007AFF', b1: '#D6EAFF', b2: '#0062CC', bar: '#007AFF'},
  mono:   {c0: '#FFFFFF', c1: '#DADADE', c2: '#8E8E93', b1: '#F2F2F7', b2: '#6C6C70', bar: '#6C6C70'},
};
const HEAD = {airbnb: ['26px', 600, '-0.02em'], bold: ['34px', 700, '-0.03em'], light: ['30px', 500, '-0.01em']};
const PAGE = {white: '#FFFFFF', warm: '#F4F2EC', grey: '#F7F7F7'};
const CARD = {lift: ['18px', '0 1px 2px rgb(0 0 0/5%),0 8px 22px rgb(0 0 0/8%)'], airbnb: ['28px', '0 2px 4px rgb(0 0 0/18%),0 0 0 1px rgb(0 0 0/8%)'], rows: ['0', 'none']};
const BTN = {airbnb: ['#222222', '8px', '48px'], pill: ['#000000', '999px', '52px'], current: ['#000000', '16px', '52px']};

const orb = (state, size, pal) => `<div class="orb-wrap" data-s="${state}"><div class="orb" style="--o:${size}px;--c0:${pal.c0};--c1:${pal.c1};--c2:${pal.c2};--b1:${pal.b1};--b2:${pal.b2}"><i class="o1"></i><i class="o2"></i><i class="o3"></i></div></div>`;
const mark = (size, flourish) => `<span class="mx-mark" aria-hidden="true" data-variant="filled" data-flourish="${flourish}" style="--mx-size:${size}px;--mx-sizen:${size};--mx-delay:.1s;--mx-stroke:${size > 40 ? 4.5 : 2.6}"><span class="mx-fx mx-fx-glow"></span><span class="mx-fx mx-fx-ripple"></span><span class="mx-fx mx-fx-burst">${'<i></i>'.repeat(8)}</span><span class="mx-disc"></span><svg class="mx-ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.8" pathLength="1"/></svg><svg class="mx-tick" viewBox="0 0 24 24"><path d="M7.4 12.4l3.1 3.1 6.2-6.4" pathLength="1"/></svg></span>`;
const bars = (n, cls) => Array.from({length: n}, (_, i) => `<i style="animation-delay:-${((i * 0.37) % 1.1).toFixed(2)}s"></i>`).join('');

function header(kind) {
  if (kind === 'ask') return `<div class="bar"><span class="ask">${IC.micSm}Ask Suara anything</span><span class="globe">EN</span></div>`;
  if (kind === 'none') return `<div class="bar"><span class="brand" style="font-size:15px">Suara</span><span class="small" style="font-weight:600;color:#222">EN</span></div>`;
  return `<div class="bar"><span class="mark">${IC.wave}</span><span class="brand">Suara</span><span class="pill">Find</span><span class="pill">English</span></div>`;
}

function renderSuara2(el, scene, g) {
  const pal = PALETTE[g.voice], [hs, hw, hl] = HEAD[g.heading], [cr, csh] = CARD[g.card], [ba, br, bh] = BTN[g.button];
  const vars = `--h-size:${hs};--h-weight:${hw};--h-ls:${hl};--page:${PAGE[g.page]};--card-r:${cr};--card-sh:${csh};--act:${ba};--s-rb:${br};--b-h:${bh};` +
    `--bar:${pal.bar};--mx-light:#007AFF;--mx-accent:#007AFF;--mx-t:1.15`;
  let body = '', cycle = null;

  if (scene === 'home') {
    const topics = g.topics === 'chips'
      ? `<div class="grow"></div><p class="small center">Or pick a topic</p><div class="chips">${['🩺 Health costs', '💰 CPF', '🛡️ Scams', '🚌 Getting around', '🏠 Bills', '📱 Phone help'].map((x) => `<span class="chip">${x}</span>`).join('')}</div>`
      : g.topics === 'link' ? `<div class="grow"></div><p class="link">Browse topics instead</p>`
      : `<div class="grow"></div><div class="quiet">Or pick a topic</div>`;
    body = `<h1 style="margin-top:6px">What do you need?</h1><div class="mz"><div class="mic" style="background:${ba}">${IC.mic}</div><p class="miclbl">Tap to speak</p></div>${topics}`;
  }

  if (scene === 'listening') {
    const vis = g.listen === 'orb' ? orb('listen', 170, pal)
      : g.listen === 'vbtn' ? `<div class="vbtn" style="--c2:${pal.c2}"><span class="stop">${IC.stop}</span><span class="bars">${bars(34)}</span></div>`
      : `<div class="bviz">${bars(15)}</div>`;
    body = `<h1 style="margin-top:6px">I'm listening</h1><p class="lead">Say it in your own words. Take your time.</p>
      <div class="grow" style="display:grid;place-items:center">${vis}</div>
      ${g.listen === 'vbtn' ? '<p class="miclbl center">Tap the square when done</p>' : `<div style="display:grid;justify-items:center;gap:8px"><div class="mic" style="width:56px;height:56px;background:${ba}">${IC.stop}</div><p class="small">Tap when done</p></div>`}`;
    cycle = 3000;
  }

  if (scene === 'searching') {
    const said = `<p class="said">You said <b>How much is a polyclinic visit for me?</b></p>`;
    const vis = g.think === 'orb'
      ? `<div class="grow" style="display:grid;place-items:center;align-content:center;gap:18px">${orb('think', 120, pal)}<h1 style="font-size:20px">Finding answers</h1></div>`
      : g.think === 'shim'
      ? `<h1><span class="shim"><span class="base">Finding answers</span><span class="win"><span class="hi">Finding answers</span></span></span></h1><div class="skel"><i></i><i></i><i></i></div>`
      : `<h1>Finding answers</h1><div class="skel pulse"><i></i><i></i><i></i></div><div class="skel pulse"><i></i><i></i></div>`;
    body = `${said}${vis}`;
    cycle = 2500;
  }

  if (scene === 'results') {
    const row = (t, m) => `<div class="sc"><span class="t">${t}</span><span class="meta">${m}</span></div>`;
    body = `<p class="said">You said <b>How much is a polyclinic visit for me?</b></p>
      <div class="sc"><span class="bm">${mark(18, 'none')}Best match</span><span class="t lg">Polyclinic fees for seniors</span><span class="sum">Pioneer and Merdeka cardholders pay less at polyclinics.</span><span class="meta">Answer · MOH</span></div>
      ${row('CHAS card: what it covers', 'Answer · MOH')}${row('MediSave for outpatient bills', '2 steps · CPF')}${row('Replacing a lost Pioneer card', 'Answer · MOH')}`;
  }

  if (scene === 'confirm') {
    const title = `<h1>Start these steps?</h1><p class="lead">MediSave for outpatient bills. 2 steps, and you confirm each one.</p>`;
    if (g.confirm === 'sheet') {
      body = `<div style="opacity:.5">${title}</div><div class="sheet-bg"></div><div class="sheet"><h1 style="font-size:22px">Start these steps?</h1>
        <p class="lead">MediSave for outpatient bills. 2 steps, and you confirm each one.</p><div class="btn pressme" style="margin-top:6px">Yes, start</div><p class="link">Not this</p></div>`;
    } else if (g.confirm === 'tiles') {
      body = `${title}<div class="tiles" style="margin-top:6px"><div class="tile s-pick"><i class="ring"></i><span style="color:#1F7A36">${IC.tick}</span>Yes, start</div><div class="tile"><span style="color:#B3122A">${IC.cross}</span>Not this</div></div>`;
    } else {
      body = `${title}<div class="lcards" style="margin-top:6px"><div class="lc y s-pick"><i class="ring"></i><div class="art">${IC.tick}</div><b>Yes, start</b></div><div class="lc n"><div class="art">${IC.cross}</div><b>Not this</b></div></div>`;
    }
    cycle = 2400;
  }

  if (scene === 'done') {
    body = `<div class="done">${mark(76, 'ripple')}<h1>That is every step</h1><p class="lead">MediSave for outpatient bills</p></div><div class="grow"></div><div class="btn">Ask something else</div>`;
    cycle = 2400;
  }

  el.innerHTML = `<div class="ph" data-card="${g.card}" style="${vars}">${header(g.header)}${body}</div>`;
  return cycle;
}
/* ═══════════════ END DOMAIN ═══════════════ */
