/* ═══════════════ DOMAIN: Suara guided steps, 8 decisions, one screen each ═══════════════
   Owner, 2026-09-28: "It should have a check bar on top, like bubble nodes joining together for
   each step, like how u see in delivery ecommerce, like stages ... a confluence like drop box for
   more information ... just the step and a shorter description ... at each stage cleared, make
   it cleared." Owner's limits (2026-09-24): at most 10 screens, broad decisions, one pick each, no
   repeats. Content is Suara's real GPFirst guide (sg.moh.gpfirst-emergency-referral). */
const SRC = {
  current: 'Current Suara',
  owner: 'Owner’s description',
  gen: 'Generated: the extreme',
  govuk: {name: 'GOV.UK step by step', url: 'https://github.com/alphagov/govuk_publishing_components/blob/main/app/assets/stylesheets/govuk_publishing_components/components/_step-by-step-nav.scss'},
  dominos: {name: 'Domino’s Tracker (2026)', url: 'https://ir.dominos.com/news-releases/news-release-details/dominosr-updates-its-iconic-industry-first-tracker-even-better'},
  muiLabel: {name: 'MUI Stepper, labels below', url: 'https://github.com/mui/material-ui/blob/master/packages/mui-material/src/StepLabel/StepLabel.js'},
  antDot: {name: 'Ant Design Steps, dots', url: 'https://github.com/ant-design/ant-design/blob/master/components/steps/style/index.ts'},
  antMax: {name: 'Ant Design Steps, maxCount', url: 'https://github.com/ant-design/ant-design/blob/master/components/steps/index.tsx'},
  govCaption: {name: 'GOV.UK "Question 3 of 9"', url: 'https://design-system.service.gov.uk/patterns/question-pages/'},
  govTask: {name: 'GOV.UK task list', url: 'https://design-system.service.gov.uk/patterns/complete-multiple-tasks/'},
  atlassian: {name: 'Atlassian expand', url: 'https://support.atlassian.com/confluence-cloud/docs/insert-the-expand-macro/'},
  mobile: {name: 'MUI MobileStepper', url: 'https://github.com/mui/material-ui/tree/master/packages/mui-material/src/MobileStepper'},
};
const LAB = {
  id: 'suara-steps-8',
  title: 'Suara guides · 8 choices',
  choose: 3,
  perGene: 1,           // one screen per decision
  askWorst: false,       // one pick per screen
  repeatEvery: 0,        // no repeat screens
  order: ['tracker', 'done', 'layout', 'more', 'button', 'clear', 'long', 'finish'],
  genes: {
    tracker: {label: 'Top bar', scene: 'step', values: {
      numbers: {name: 'Numbered bubbles, joined', source: SRC.govuk},
      named:   {name: 'Bubbles with a name under each', source: SRC.muiLabel},
      dots:    {name: 'Small dots and "Step 3 of 5"', source: SRC.antDot}}},
    done:    {label: 'Colour of a cleared stage', scene: 'step', values: {
      black: {name: 'Black tick', hex: '#1D1D1F'},
      blue:  {name: 'Blue tick', hex: '#007AFF'},
      green: {name: 'Green tick', hex: '#1F7A36'}}},
    layout:  {label: 'Step layout', scene: 'step', values: {
      card: {name: 'One card', source: SRC.dominos},
      list: {name: 'Every step listed, this one open', source: SRC.govuk},
      page: {name: 'The whole screen, no card', source: SRC.gen}}},
    more:    {label: 'More information', scene: 'more', values: {
      expand: {name: 'A line that opens in place', source: SRC.atlassian},
      panel:  {name: 'A grey "Show more" box', source: SRC.govuk},
      sheet:  {name: 'A sheet from below'}}},
    button:  {label: 'Clear button', scene: 'step', values: {
      wide:  {name: 'One wide black button', source: SRC.current},
      tick:  {name: 'A round tick button'},
      split: {name: '"Done" and "I need help"'}}},
    clear:   {label: 'Clearing moment', scene: 'clearing', values: {
      fill:     {name: 'The line runs on to the next'},
      stamp:    {name: 'A "Cleared" stamp', source: SRC.gen},
      collapse: {name: 'It folds into a done row'}}},
    long:    {label: 'Long guide (9 steps)', scene: 'long', values: {
      shrink: {name: 'Every bubble, smaller'},
      window: {name: 'Nearby bubbles and "…"', source: SRC.antMax},
      seg:    {name: 'A segmented bar', source: SRC.mobile}}},
    finish:  {label: 'Last screen', scene: 'finish', values: {
      tracker: {name: 'The full bar and what you did'},
      checks:  {name: 'A ticked list', source: SRC.govTask},
      big:     {name: 'One big tick', source: SRC.current}}},
  },
  scenes: [
    {id: 'step', name: 'Step 3 of 5', group: 'A guide'},
    {id: 'more', name: 'More information', group: 'A guide'},
    {id: 'clearing', name: 'Clearing step 2', group: 'A guide'},
    {id: 'long', name: 'A long guide', group: 'A guide'},
    {id: 'finish', name: 'All cleared', group: 'A guide'},
  ],
  // The owner's words as a nudge only ([3,1] at most); one pick overturns it.
  priors: {tracker: {numbers: [3, 1]}, more: {expand: [3, 1]}},
  pool: null,
  render: renderSteps,
};

const IC = {
  wave: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg>',
  tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5l4 4 8-9"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
  spk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
};

// Suara's GPFirst guide, word for word; "short" is the bubble label, "more" its detail sections.
const GUIDE = {
  title: 'GPFirst at A&E',
  steps: [
    {short: 'Form', name: 'Get the form from your doctor', text: 'Only participating GP clinics near the partner hospitals give a GPFirst referral form.', ok: 'I have the form',
      more: [['Who can use it', 'Everyone living in Singapore, including permanent residents and foreigners.']]},
    {short: 'Check', name: 'Check date, time, stamp', text: 'The form must show the referral date, the referral time and the clinic’s stamp.', ok: 'All three are there', more: []},
    {short: 'Go', name: 'Go to A&E the same day', text: 'Go the same day. If the form was given between 10pm and midnight, you can go until 2am.', ok: 'I am at A&E',
      more: [['Which hospitals', 'Changi General, Khoo Teck Puat, National University (adult A&E only), Ng Teng Fong, Sengkang General, Singapore General and Tan Tock Seng hospitals, and the Alexandra Hospital Urgent Care Centre.']]},
    {short: 'Show', name: 'Show the form and your NRIC', text: 'At registration, show the original, fully completed form together with your NRIC.', ok: 'Done', more: []},
    {short: 'Costs', name: 'Extra tests cost extra', text: 'Special tests or non-standard medicines at A&E are charged separately.', ok: 'Understood', more: []},
  ],
};
// Nine steps, to see what the bar does with many (a layout sample; the words are placeholders).
const LONG = ['Check you can renew', 'Get a photo taken', 'Sign in with Singpass', 'Fill in the form', 'Upload the photo', 'Pay the fee', 'Wait for the SMS', 'Book a collection slot', 'Collect it'];

const topBar = () => `<div class="bar"><span class="mark">${IC.wave}</span><span class="brand">Suara</span><span class="pill">English</span></div>`;
const head = (title) => `<div class="back">${IC.back}Back</div><p class="gtitle">${title}</p>`;

/** The bar on top: n stages, `cur` is the one in hand (index), those before it are cleared. */
function tracker(kind, names, cur, opts = {}) {
  const n = names.length;
  if (kind === 'dots') {
    const nodes = names.map((_, i) => `<div class="n" data-s="${i < cur ? 'done' : i === cur ? 'now' : 'later'}"><span class="c"></span></div>`);
    const lines = names.slice(1).map((_, i) => `<span class="ln"><i style="--f:${i < cur ? 1 : 0}"></i></span>`);
    return `<div class="trkhead"><b>Step ${Math.min(cur + 1, n)} of ${n}</b><span>${names[Math.min(cur, n - 1)]}</span></div>
      <div class="trk dots">${nodes.map((x, i) => x + (lines[i] ?? '')).join('')}</div>`;
  }
  const nd = opts.nd;
  const nodes = names.map((nm, i) => {
    const s = i < cur ? 'done' : i === cur ? 'now' : 'later';
    return `<div class="n" data-s="${s}" data-i="${i}"><span class="c">${s === 'done' ? IC.tick : i + 1}</span>${kind === 'named' ? `<span class="nm">${nm}</span>` : ''}</div>`;
  });
  const lines = names.slice(1).map((_, i) => `<span class="ln"><i style="--f:${i < cur ? 1 : 0}"></i></span>`);
  return `<div class="trk ${kind}"${nd ? ` style="--nd:${nd}px"` : ''}>${nodes.map((x, i) => x + (lines[i] ?? '')).join('')}</div>`;
}

function moreBlock(kind, step, open) {
  if (!step.more.length) return '';
  const body = step.more.map(([h, b]) => `<p><b>${h}</b>${b}</p>`).join('');
  if (kind === 'sheet') return `<div class="more" data-k="sheet"><div class="hd">More about this step ${IC.chev}</div></div>`;
  if (kind === 'panel') return `<div class="more${open ? ' open' : ''}" data-k="panel"><div class="hd">More information<span class="pm">${open ? '−' : '+'}</span></div><div class="bd"><div>${body}</div></div></div>`;
  return `<div class="more${open ? ' open' : ''}" data-k="expand"><div class="hd"><span class="cv">${IC.chev}</span>More information</div><div class="bd"><div>${body}</div></div></div>`;
}

function button(kind, step) {
  const ok = `<span class="ok">${IC.tick}Cleared</span>`;
  if (kind === 'tick') return `<div class="tickrow"><div class="go tickbtn">${IC.tick}${ok}</div><span>${step.ok}</span></div>`;
  if (kind === 'split') return `<div class="split"><div class="go">${IC.tick}Done${ok}</div><div class="help">I need help</div></div>`;
  return `<div class="go">${IC.tick}${step.ok}${ok}</div>`;
}

/** The step in hand, laid out as g.layout says. */
function stepBody(g, i, opts = {}) {
  const s = GUIDE.steps[i], n = GUIDE.steps.length;
  const inner = `<p class="snum">Step ${i + 1} of ${n}</p><p class="sname">${s.name}</p><p class="stext">${s.text}</p>
    ${moreBlock(g.more, s, opts.open)}${button(g.button, s)}<div class="hear">${IC.spk}Read it again</div>`;
  if (g.layout === 'page') return `<div class="page">${inner}</div>`;
  if (g.layout === 'list') {
    const rows = GUIDE.steps.map((st, j) => j === i ? `<div class="open">${inner}</div>`
      : `<div class="row" data-s="${j < i ? 'done' : 'later'}"><span class="d">${j < i ? IC.tick : j + 1}</span>${st.name}</div>`);
    return `<div class="acc">${rows.join('')}</div>`;
  }
  return `<div class="scard">${inner}</div>`;
}

/** Re-runs a scene's own timeline each time the lab replays the card (it toggles .play). */
function onPlay(el, run) {
  el._mo?.disconnect();
  const clear = () => { (el._ts || []).forEach(clearTimeout); el._ts = []; };
  const go = () => { clear(); run((ms, f) => el._ts.push(setTimeout(f, ms))); };
  el._mo = new MutationObserver(() => { if (el.classList.contains('play') && !el.classList.contains('resetting')) go(); });
  el._mo.observe(el, {attributes: true, attributeFilter: ['class']});
  go();
}

function renderSteps(el, scene, g) {
  const V = LAB.genes, done = V.done.values[g.done].hex;
  const names = GUIDE.steps.map((s) => s.short);
  const trk = (cur) => tracker(g.tracker, g.tracker === 'dots' ? GUIDE.steps.map((s) => s.name) : names, cur);
  let body = '', cycle = null, run = null;

  if (scene === 'step') {
    body = `${head(GUIDE.title)}${trk(2)}${stepBody(g, 2)}`;
  }

  if (scene === 'more') {
    body = `${head(GUIDE.title)}${trk(2)}${stepBody(g, 2)}`;
    const s = GUIDE.steps[2];
    if (g.more === 'sheet') body += `<div class="scrim"></div><div class="sheet"><span class="grab"></span><h3>More about this step</h3>${s.more.map(([h, b]) => `<p><b>${h}</b>${b}</p>`).join('')}</div>`;
    cycle = 3600;
    run = (at, ph) => {
      const m = ph.querySelector('.more'); ph.classList.remove('sheet-open'); m?.classList.remove('open');
      const pm = ph.querySelector('.pm'); if (pm) pm.textContent = '+';
      at(1000, () => { if (g.more === 'sheet') ph.classList.add('sheet-open'); else { m?.classList.add('open'); if (pm) pm.textContent = '−'; } });
    };
  }

  if (scene === 'clearing') {
    // Step 2 in hand; the button is pressed, the stage clears, step 3 comes in.
    const prev = stepBody(g, 1), next = stepBody(g, 2);
    const row = g.clear === 'collapse' ? `<div class="donerow"><span class="d">${IC.tick}</span>${GUIDE.steps[1].name}<em>Cleared</em></div>` : '';
    const stamp = g.clear === 'stamp' ? `<div class="stamp"><span>${IC.tick}Cleared</span></div>` : '';
    body = `${head(GUIDE.title)}<div class="trkslot">${trk(1)}</div>${row}<div class="swap rel"><div class="prev rel">${prev}${stamp}</div><div class="next">${next}</div></div>`;
    cycle = 4200;
    run = (at, ph) => {
      ph.classList.remove('pressed', 'cleared');
      const slot = ph.querySelector('.trkslot'); slot.innerHTML = trk(1);
      at(900, () => ph.classList.add('pressed'));
      at(g.clear === 'stamp' ? 1900 : 1300, () => {
        // The bubble takes its tick, and the line runs on to the next one.
        const n1 = slot.querySelector('[data-i="1"]'), n2 = slot.querySelector('[data-i="2"]');
        if (n1) { n1.dataset.s = 'done'; n1.querySelector('.c').innerHTML = IC.tick; }
        if (n2) n2.dataset.s = 'now';
        const lines = slot.querySelectorAll('.ln i'); if (lines[1]) lines[1].style.setProperty('--f', 1);
        if (g.tracker === 'dots') slot.innerHTML = trk(2);
      });
      at(g.clear === 'stamp' ? 2300 : 1700, () => ph.classList.add('cleared'));
    };
  }

  if (scene === 'long') {
    const cur = 4, n = LONG.length;
    let bar;
    if (g.long === 'seg') {
      bar = `<div class="trkhead"><b>Step ${cur + 1} of ${n}</b><span>${LONG[cur]}</span></div><div class="seg">${LONG.map((_, i) => `<i data-s="${i < cur ? 'done' : i === cur ? 'now' : 'later'}"></i>`).join('')}</div>`;
    } else if (g.long === 'window') {
      // Two either side of the one in hand, the rest as "…".
      const show = [cur - 2, cur - 1, cur, cur + 1, cur + 2];
      const nodes = show.map((i) => `<div class="n" data-s="${i < cur ? 'done' : i === cur ? 'now' : 'later'}"><span class="c">${i < cur ? IC.tick : i + 1}</span></div>`);
      bar = `<div class="trk numbers"><span class="gap">…</span>${nodes.map((x, k) => x + (k < 4 ? `<span class="ln"><i style="--f:${show[k] < cur ? 1 : 0}"></i></span>` : '')).join('')}<span class="gap">…</span></div>
        <div class="trkhead"><b>Step ${cur + 1} of ${n}</b><span>${LONG[cur]}</span></div>`;
    } else {
      bar = `${tracker('numbers', LONG, cur, {nd: 22})}<div class="trkhead"><b>Step ${cur + 1} of ${n}</b><span>${LONG[cur]}</span></div>`;
    }
    body = `${head('Renewing a passport (sample)')}${bar}<div class="scard"><p class="snum">Step ${cur + 1} of ${n}</p><p class="sname">${LONG[cur]}</p>
      <p class="stext">A short line says what to do here.</p>${button(g.button, {ok: 'Uploaded'})}</div>`;
  }

  if (scene === 'finish') {
    const n = GUIDE.steps.length;
    if (g.finish === 'tracker') {
      body = `${head(GUIDE.title)}${trk(n)}<div class="fin"><h2>All ${n} stages cleared</h2><p>You brought the form to A&E the same day. Extra tests may still cost extra.</p></div>
        <div class="grow"></div><div class="ask">Ask something else</div>`;
    } else if (g.finish === 'checks') {
      body = `${head(GUIDE.title)}<div class="fin"><h2>Every step done</h2></div><div class="checks">${GUIDE.steps.map((s) => `<div><span class="d">${IC.tick}</span>${s.name}</div>`).join('')}</div>
        <div class="grow"></div><div class="ask">Ask something else</div>`;
    } else {
      body = `${head(GUIDE.title)}<div class="bigtick">${IC.tick}</div><div class="fin" style="justify-items:center;text-align:center"><h2>That is every step</h2><p>${GUIDE.title}</p></div>
        <div class="grow"></div><div class="ask">Ask something else</div>`;
    }
  }

  el.innerHTML = `<div class="ph" style="--done:${done}">${topBar()}${body}</div>`;
  if (run) {
    const ph = el.querySelector('.ph');
    setTimeout(() => onPlay(el, (at) => run(at, ph)), 0);
  }
  return cycle;
}
/* ═══════════════ END DOMAIN ═══════════════ */
