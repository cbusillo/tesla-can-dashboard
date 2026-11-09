/* Battery sheet: replay-only dashboard design. Nothing here can reach a vehicle. */
(async function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* preference only */ } },
  };

  let F;
  try {
    const r = await fetch('fixture.json');
    if (!r.ok) throw new Error(String(r.status));
    F = await r.json();
  } catch (e) {
    $('#app').innerHTML = '<p class="fail">The replay file did not load. Serve the design folder with <code>python3 -m http.server</code> and open this page through it.</p>';
    return;
  }

  const LOOP = F.scenarios[F.scenarios.length - 1].atSeconds + 5;
  const SIGNAL_NAMES = {
    displayedChargePercent: 'Charge', voltageV: 'Voltage', currentA: 'Current',
    fullPackEnergyKwh: 'Full pack energy', minimumTemperatureC: 'Lowest temperature', maximumTemperatureC: 'Highest temperature',
  };

  /* ---------- Replay timeline derived from fixture scenarios ---------- */
  const SEGS = F.scenarios.map((s, i) => {
    const next = F.scenarios[i + 1];
    let kind = 'ok', label = 'Connected', sub = 'All readings';
    if (s.signal) { kind = 'partial'; label = (SIGNAL_NAMES[s.signal] || s.signal).split(' ').pop().replace(/^./, (c) => c.toUpperCase()) + ' missing'; sub = 'One reading'; }
    else if (s.state === 'stale') { kind = 'stale'; label = 'Stale'; sub = 'Held values'; }
    else if (s.state === 'disconnected') { kind = 'lost'; label = 'Disconnected'; sub = 'No link'; }
    else if (i > 0) { kind = 'recovered'; label = 'Recovered'; sub = 'Data back'; }
    return { from: s.atSeconds, to: next ? next.atSeconds : LOOP, kind, label, sub };
  });

  function derive(t) {
    const q = { t, link: 'connected', off: new Set(), lastGood: null, gap: null, recoveredAt: null };
    for (const s of F.scenarios) {
      if (s.atSeconds > t) break;
      if (s.signal) { if (s.state === 'unavailable') q.off.add(s.signal); else q.off.delete(s.signal); continue; }
      if (s.state === 'connected') {
        if (q.link !== 'connected') { q.recoveredAt = s.atSeconds; q.gap = s.atSeconds - q.lastGood; }
        q.link = 'connected'; q.off.clear();
      } else {
        if (q.link === 'connected') q.lastGood = s.atSeconds;
        q.link = s.state;
      }
    }
    return q;
  }
  const keyOf = (q) => q.link + '|' + [...q.off].join(',') + '|' + (q.recoveredAt !== null);

  /* ---------- App state ---------- */
  const S = {
    t: 0, playing: true, view: 'overview', arranging: false,
    sort: 'pack', selected: null, nextResult: 'confirmed',
    actions: {}, log: [],
  };
  let Q = derive(0), lastKey = keyOf(Q);

  const V = F.values;
  const cells = F.cellGroups.filter((c) => c.state === 'valid' && c.voltageV != null);
  const voltOf = (c) => c.voltageV;
  const mean = cells.reduce((a, c) => a + voltOf(c), 0) / cells.length;
  const byVolt = [...cells].sort((a, b) => voltOf(a) - voltOf(b));
  const low = byVolt[0], high = byVolt[byVolt.length - 1];
  const spreadMv = (voltOf(high) - voltOf(low)) * 1000;
  const sumV = cells.reduce((a, c) => a + voltOf(c), 0);
  S.selected = low.index;

  /* ---------- Numerals ---------- */
  const ADV = { '.': 22, '-': 56, '1': 46 };
  function glyphs(str) {
    let x = 0, out = '';
    for (const ch of str) {
      if (ch === '.') out += `<use href="#dp" x="${x}" class="pt"/>`;
      else if (ch === '-') out += `<use href="#dm" x="${x}"/>`;
      else out += `<use href="#d${ch}" x="${x}"/>`;
      x += ADV[ch] || 62;
    }
    return { out, w: x };
  }
  function num(str, aria) {
    const g = glyphs(str);
    return `<svg class="num" viewBox="0 0 ${g.w} 100" role="img" aria-label="${esc(aria || str)}">${g.out}</svg>`;
  }

  /* ---------- Reading quality ---------- */
  function readState(sources) {
    if (Q.link === 'disconnected') return 'lost';
    if (sources.some((k) => Q.off.has(k) || (k !== 'cells' && V[k] == null))) return 'void';
    if (sources.includes('cells') && !cells.length) return 'void';
    return Q.link === 'stale' ? 'stale' : 'ok';
  }
  const heldFor = () => Q.t - Q.lastGood;
  const ageSpan = (kind) => `<span data-age="${kind}">${ageText(kind)}</span>`;
  function ageText(kind) {
    if (kind === 'held') return Q.lastGood === null ? '' : `Held ${heldFor()} s`;
    if (kind === 'last') return Q.lastGood === null ? '' : `${heldFor()} s ago`;
    return '';
  }
  const cross = '<svg viewBox="0 0 34 34" aria-hidden="true"><rect x="1" y="1" width="32" height="32"/><path d="M1 1l32 32M33 1 1 33"/></svg>';

  /* ---------- Instruments ---------- */
  const INST = {
    charge: { name: 'Charge', unit: '%', sources: ['displayedChargePercent'], dec: 1, val: () => V.displayedChargePercent, say: 'percent' },
    voltage: { name: 'Pack voltage', unit: 'V', sources: ['voltageV'], dec: 1, val: () => V.voltageV, say: 'volts' },
    current: {
      name: 'Pack current', unit: 'A', sources: ['currentA'], dec: 1, val: () => V.currentA, say: 'amps',
      note: 'Sign as reported, direction not verified',
    },
    temp: {
      name: 'Battery temperature', unit: '°C', sources: ['minimumTemperatureC', 'maximumTemperatureC'], range: true,
      note: `${(V.maximumTemperatureC - V.minimumTemperatureC).toFixed(1)} °C lowest to highest`,
    },
    energy: { name: 'Full pack energy', unit: 'kWh', sources: ['fullPackEnergyKwh'], dec: 1, val: () => V.fullPackEnergyKwh, say: 'kilowatt hours' },
    left: {
      name: 'Energy left', unit: 'kWh', sources: ['displayedChargePercent', 'fullPackEnergyKwh'], dec: 1,
      val: () => V.displayedChargePercent / 100 * V.fullPackEnergyKwh, say: 'kilowatt hours', note: 'Estimate: charge × full pack energy',
    },
    power: {
      name: 'Power', unit: 'kW', sources: ['voltageV', 'currentA'], dec: 2,
      val: () => Math.abs(V.voltageV * V.currentA) / 1000, say: 'kilowatts', note: 'Size only, direction not verified',
    },
    spread: { name: 'Cell spread', unit: 'mV', sources: ['cells'], dec: 1, val: () => spreadMv, say: 'millivolts', note: `Across ${cells.length} groups` },
    sum: { name: 'Sum of groups', unit: 'V', sources: ['cells'], dec: 2, val: () => sumV, say: 'volts', note: `Pack reports ${V.voltageV.toFixed(2)} V` },
  };
  const DEFAULT_LAYOUT = ['charge', 'voltage', 'current', 'temp', 'energy'];
  function loadLayout() {
    try {
      const l = JSON.parse(store.get('battery-sheet-layout'));
      if (Array.isArray(l) && l.length === 5 && l.every((id) => INST[id])) return l;
    } catch (e) { /* fall through */ }
    return [...DEFAULT_LAYOUT];
  }
  let layout = loadLayout();
  const saveLayout = () => store.set('battery-sheet-layout', JSON.stringify(layout));

  function lastKnown(ins) {
    if (ins.range) return `${V.minimumTemperatureC.toFixed(1)} to ${V.maximumTemperatureC.toFixed(1)} ${ins.unit}`;
    const v = ins.val();
    return v == null ? null : `${v.toFixed(ins.dec).replace('-', '−')} ${ins.unit}`;
  }
  function voidBlock(st, ins) {
    if (st === 'lost') {
      const lk = lastKnown(ins);
      return `<div class="void">${cross}<span class="void-word">No data link<span class="void-sub">${lk ? `Last ${esc(lk)}, ${ageSpan('last')}` : 'No earlier reading'}</span></span></div>`;
    }
    return `<div class="void">${cross}<span class="void-word">Not reported<span class="void-sub">Waiting for this reading</span></span></div>`;
  }
  function valueBlock(ins) {
    if (ins.range) {
      const lo = V.minimumTemperatureC, hi = V.maximumTemperatureC;
      return `<div class="val">${num(lo.toFixed(1), lo.toFixed(1) + ' degrees Celsius lowest')}<span class="to">to</span>${num(hi.toFixed(1), hi.toFixed(1) + ' degrees Celsius highest')}<span class="unit">${ins.unit}</span></div>`;
    }
    const v = ins.val();
    return `<div class="val">${num(v.toFixed(ins.dec), `${v.toFixed(ins.dec)} ${ins.say}`)}<span class="unit">${ins.unit}</span></div>`;
  }

  function chargeDiagram() {
    const st = readState(['displayedChargePercent']);
    const pct = V.displayedChargePercent / 100;
    const W = 380, stale = st === 'stale';
    const outline = stale ? 'stroke-dasharray="6 5"' : '';
    let inner = '';
    if (st === 'ok' || st === 'stale') {
      inner = `<rect x="3" y="7" width="${W * pct}" height="38" fill="url(#${stale ? 'hatch-stale' : 'hatch'})"/>
        <line x1="${3 + W * pct}" y1="2" x2="${3 + W * pct}" y2="58" class="dim-l" ${outline}/>
        <line x1="3" y1="54" x2="${3 + W * pct}" y2="54" class="dim-l" marker-start="url(#arw)" marker-end="url(#arw)" ${outline}/>`;
    }
    return `<svg class="hero-diagram" viewBox="0 0 400 60" aria-hidden="true">
      <rect x="3" y="7" width="${W}" height="38" class="dim-l" ${outline}/>
      <rect x="${3 + W}" y="18" width="11" height="16" class="dim-l" ${outline}/>
      ${inner}
    </svg>`;
  }

  function heroNote(id) {
    if (id === 'charge') {
      const st = readState(['fullPackEnergyKwh']);
      if (st === 'void') return 'Energy left needs full pack energy, which is not reported.';
      if (st === 'lost') return 'Energy left needs a data link.';
      return `About ${(V.displayedChargePercent / 100 * V.fullPackEnergyKwh).toFixed(1)} kWh left, estimated from charge and full pack energy.`;
    }
    const ins = INST[id];
    return ins.note || '';
  }

  function instrumentBody(id, hero) {
    const ins = INST[id];
    const st = readState(ins.sources);
    const name = esc(ins.name);
    let body = (st === 'void' || st === 'lost') ? voidBlock(st, ins) : valueBlock(ins);
    let extra = '';
    if (st === 'stale') extra = `<span class="q-note">${ageSpan('held')}</span>`;
    if (hero) {
      const dia = (id === 'charge' && (st === 'ok' || st === 'stale')) ? chargeDiagram() : '';
      const note = (st === 'ok' || st === 'stale' || id === 'charge') ? heroNote(id) : '';
      return `<div class="hero-face-in q-${st}"><div class="lab">${name} ${extra}</div>${body}${dia}<div class="hero-note">${esc(note)}</div></div>`;
    }
    const noteTxt = (st === 'ok' || st === 'stale') && ins.note ? `<em>${esc(ins.note)}</em>` : '';
    return `<div class="q-${st}"><div class="lab"><span>${name}</span>${noteTxt}${extra}</div>${body}</div>`;
  }

  /* ---------- Sheet head ---------- */
  function stateWord() {
    if (Q.link === 'disconnected') return { cls: 'lost', b: 'Disconnected', s: `Last reading ${heldFor()} s ago` };
    if (Q.link === 'stale') return { cls: 'stale', b: 'Stale', s: `Values held for ${heldFor()} s` };
    if (Q.off.size) return { cls: 'partial', b: 'Partly reported', s: `${[...Q.off].map((k) => SIGNAL_NAMES[k] || k).join(', ')} missing` };
    if (Q.recoveredAt !== null) return { cls: 'recovered', b: 'Recovered', s: `After a ${Q.gap} s gap` };
    return { cls: '', b: 'Data current', s: 'All readings arriving' };
  }
  function titleBlock() {
    const w = stateWord();
    return `<div class="tb">
      <div><b>Replay</b><small id="tb-time">${Q.t} s of ${LOOP}</small></div>
      <div class="tb-state ${w.cls}"><b id="tb-b">${esc(w.b)}</b><small id="tb-s">${esc(w.s)}</small></div>
    </div>`;
  }
  function head(title, extra) {
    return `<div class="head"><h1>${esc(title)}</h1>${extra || ''}${titleBlock()}</div>`;
  }
  function refreshStatus() {
    const tb = $('.tb');
    if (!tb) return;
    const w = stateWord();
    $('#tb-time').textContent = `${Q.t} s of ${LOOP}`;
    $('#tb-b').textContent = w.b;
    $('#tb-s').textContent = w.s;
    const st = $('.tb-state');
    st.className = 'tb-state ' + w.cls;
    document.querySelectorAll('[data-age]').forEach((el) => { el.textContent = ageText(el.dataset.age); });
  }

  /* ---------- Overview ---------- */
  function ribbon() {
    const up = (voltOf(high) - mean) * 1000, down = (mean - voltOf(low)) * 1000;
    const k = 22 / ((up + down) || 1), zero = 1 + up * k;
    const bars = cells.map((c, i) => {
      const dy = ((voltOf(c) - mean) * 1000) * k;
      return `<rect x="${i + 0.08}" y="${(dy > 0 ? zero - dy : zero).toFixed(2)}" width="0.84" height="${Math.max(0.5, Math.abs(dy)).toFixed(2)}"/>`;
    }).join('');
    return `<svg class="ribbon" viewBox="0 0 ${cells.length} 24" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">${bars}</svg>`;
  }
  function miniBody() {
    const st = readState(['cells']);
    if (st === 'lost' || st === 'void') {
      return `<span class="lab">Cell spread</span><span class="void q-lost">${cross}<span class="void-word" style="font-size:16px">${st === 'lost' ? 'No data link' : 'Not reported'}</span></span>`;
    }
    const q = st === 'stale' ? ' q-stale' : '';
    return `<span class="lab">Cell spread<br>${cells.length} groups</span>
      <span class="val${q}">${num(spreadMv.toFixed(1), spreadMv.toFixed(1) + ' millivolts')}<span class="unit">mV</span></span>
      <span class="${q}" style="flex:1 1 auto;display:flex;color:${st === 'stale' ? 'var(--amber)' : 'var(--dim)'}">${ribbon()}</span>
      <span class="go">Open cells</span>`;
  }
  function tapeSvg(key) {
    const seg = [];
    for (let s = 0; s < LOOP; s += 1) {
      const q = derive(s);
      const st = q.link === 'disconnected' ? 'gap' : q.off.has(key) ? 'gap' : q.link === 'stale' ? 'stale' : 'ok';
      if (s > Q.t) break;
      const last = seg[seg.length - 1];
      if (last && last.st === st) last.to = s + 1; else seg.push({ st, from: s, to: s + 1 });
    }
    const x = (s) => (Math.min(s, Q.t + 1) / LOOP) * 300;
    const lines = seg.map((g) => `<line x1="${x(g.from).toFixed(1)}" y1="5" x2="${x(g.to).toFixed(1)}" y2="5" class="t-${g.st}"/>`).join('');
    const cursor = `<line x1="${x(Q.t + 1).toFixed(1)}" y1="0" x2="${x(Q.t + 1).toFixed(1)}" y2="10" class="t-cur"/>`;
    return `<svg viewBox="0 0 300 10" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="5" x2="300" y2="5" class="t-rest"/>${lines}${cursor}</svg>`;
  }
  const TAPE_LANES = [['Voltage', 'voltageV'], ['Current', 'currentA'], ['Charge', 'displayedChargePercent'], ['Full pack energy', 'fullPackEnergyKwh']];
  function tapeBody() {
    return `<div class="note">Last ${LOOP} seconds. This capture is parked, so traces stay level. A break means no data, and dashes mean held data.</div>` +
      TAPE_LANES.map(([n, k]) => `<div class="ln">${esc(n)}</div><div data-tape="${k}">${tapeSvg(k)}</div>`).join('');
  }
  function refreshTape() {
    document.querySelectorAll('[data-tape]').forEach((el) => { el.innerHTML = tapeSvg(el.dataset.tape); });
  }
  function renderOverview() {
    const slotButton = (i, cls) => {
      const body = instrumentBody(layout[i], i === 0);
      return S.arranging
        ? `<button class="${cls}" data-slot="${i}" aria-label="Replace ${esc(INST[layout[i]].name)}">${body}</button>`
        : `<div class="${cls}">${body}</div>`;
    };
    const slotsHtml = [1, 2, 3, 4].map((i) => slotButton(i, 'slot')).join('');
    $('#sheet').innerHTML = head('Overview', `<button class="btn" id="arrange" aria-pressed="${S.arranging}">${S.arranging ? 'Done' : 'Arrange'}</button>`) +
      `<div class="ov${S.arranging ? ' arranging' : ''}">
        <div class="hero">${slotButton(0, 'hero-face')}</div>
        <div class="slots">${slotsHtml}</div>
        <div class="tape">${tapeBody()}</div>
        <button class="mini" id="to-cells" aria-label="Open cells sheet">${miniBody()}</button>
      </div>`;
    $('#arrange').onclick = () => { S.arranging = !S.arranging; render(); };
    $('#to-cells').onclick = () => go('cells');
    document.querySelectorAll('[data-slot]').forEach((b) => { b.onclick = () => openPicker(+b.dataset.slot); });
  }

  /* ---------- Instrument picker ---------- */
  function openPicker(slot) {
    const p = $('#picker');
    p.innerHTML = `<h2>Choose an instrument</h2>
      <div class="pk-sub">This replaces ${esc(INST[layout[slot]].name)}. Saved on this browser.</div>
      <div class="pk-grid">${Object.entries(INST).map(([id, ins]) =>
        `<button class="pk-opt" data-pick="${id}" aria-pressed="${layout[slot] === id}">${esc(ins.name)}<small>${esc(ins.note || ins.unit)}</small></button>`).join('')}</div>
      <div class="pk-foot"><button class="btn" id="pk-reset">Reset layout</button><button class="btn" id="pk-close">Keep ${esc(INST[layout[slot]].name)}</button></div>`;
    p.hidden = false;
    p.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => { layout[slot] = b.dataset.pick; saveLayout(); closePicker(); };
    });
    $('#pk-reset').onclick = () => { layout = [...DEFAULT_LAYOUT]; saveLayout(); closePicker(); };
    $('#pk-close').onclick = closePicker;
    $('#pk-close').focus();
  }
  function closePicker() { $('#picker').hidden = true; render(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#picker').hidden) closePicker(); });

  /* ---------- Cells ---------- */
  const orderNow = () => (S.sort === 'pack' ? cells : byVolt);
  function renderCells() {
    const st = readState(['cells']);
    const shape = st === 'lost' ? '' : `<div class="seg" role="group" aria-label="Bar order">
      <button data-sort="pack" aria-pressed="${S.sort === 'pack'}">Pack order</button>
      <button data-sort="volt" aria-pressed="${S.sort === 'volt'}">By voltage</button></div>`;
    const big = st === 'lost'
      ? `<div class="void q-lost">${cross}<span class="void-word">No data link<span class="void-sub">Last spread ${spreadMv.toFixed(1)} mV, ${ageSpan('last')}</span></span></div>`
      : `<div class="c-big q-${st}">${num(spreadMv.toFixed(1), spreadMv.toFixed(1) + ' millivolts spread')}<span class="unit">mV</span></div>`;
    const sentence = st === 'lost'
      ? 'Cell readings return when the connection does.'
      : `between the lowest and highest of ${cells.length} groups, ${(spreadMv / 10 / (mean)).toFixed(2)} % of the ${mean.toFixed(4)} V average. Each bar is one group, measured from the average.`;
    $('#sheet').innerHTML = head('Cells') +
      `<div class="c-top">${big}<p>${esc(sentence)}</p>${shape}</div>
       <div id="cchart" class="q-${st}" role="application" aria-label="Group voltages. Drag to choose a group."></div>
       <div id="cdetail"></div>`;
    document.querySelectorAll('[data-sort]').forEach((b) => { b.onclick = () => { S.sort = b.dataset.sort; renderCells(); }; });
    renderDetail(st);
    drawChart(st);
    const ch = $('#cchart');
    if (st !== 'lost') {
      const pick = (e) => {
        const r = ch.getBoundingClientRect();
        const m = chartMetrics(r.width);
        const i = Math.max(0, Math.min(cells.length - 1, Math.floor((e.clientX - r.left - m.L) / m.bw)));
        const c = orderNow()[i];
        if (c && c.index !== S.selected) { S.selected = c.index; drawSel(); renderDetail(st); }
      };
      ch.addEventListener('pointerdown', (e) => { ch.setPointerCapture(e.pointerId); pick(e); });
      ch.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') pick(e); });
    }
  }
  function chartMetrics(W) {
    const L = 42, R = 70;
    return { L, R, bw: (W - L - R) / cells.length };
  }
  function chartScale(H) {
    const T = 14, B = 10;
    const lo = (voltOf(low) - mean) * 1000 - 0.5, hi = (voltOf(high) - mean) * 1000 + 0.5;
    const y = (mv) => T + ((hi - mv) / (hi - lo)) * (H - T - B);
    return { y, lo, hi };
  }
  function drawChart(st) {
    const el = $('#cchart');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = Math.max(280, r.width), H = Math.max(120, r.height);
    if (st === 'lost') { el.innerHTML = `<div class="c-msg">No data link. No group voltages to show.</div>`; return; }
    const { L, bw } = chartMetrics(W);
    const { y, lo, hi } = chartScale(H);
    let grid = '';
    for (let m = Math.ceil(lo); m <= Math.floor(hi); m += 1) {
      if (m === 0) continue;
      grid += `<line x1="${L}" y1="${y(m).toFixed(1)}" x2="${W - 70}" y2="${y(m).toFixed(1)}" class="gl"/>
               <text x="${L - 6}" y="${(y(m) + 5).toFixed(1)}" text-anchor="end" class="ctxt">${m > 0 ? '+' : '−'}${Math.abs(m)}</text>`;
    }
    const zero = y(0);
    const bars = orderNow().map((c, i) => {
      const mv = (voltOf(c) - mean) * 1000;
      const y1 = y(mv);
      const top = Math.min(y1, zero), h = Math.max(1.2, Math.abs(y1 - zero));
      const ext = c === low || c === high ? ' ext' : '';
      return `<rect class="bar${ext}" x="${(L + i * bw + 0.5).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1.5, bw - 1.2).toFixed(1)}" height="${h.toFixed(1)}"/>`;
    }).join('');
    const yH = y((voltOf(high) - mean) * 1000), yL = y((voltOf(low) - mean) * 1000);
    const dx = W - 36;
    const dim = `<line x1="${L}" y1="${yH}" x2="${W - 8}" y2="${yH}" class="dim-ext"/>
      <line x1="${L}" y1="${yL}" x2="${W - 8}" y2="${yL}" class="dim-ext"/>
      <line x1="${dx}" y1="${yH}" x2="${dx}" y2="${yL}" class="dim-l" marker-start="url(#arw)" marker-end="url(#arw)"/>
      <text x="${dx - 7}" y="${((yH + yL) / 2 + 5).toFixed(1)}" text-anchor="end" class="dim-t">${spreadMv.toFixed(1)}</text>
      <text x="${dx - 7}" y="${((yH + yL) / 2 + 22).toFixed(1)}" text-anchor="end" class="ctxt">mV</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${grid}
      <line x1="${L}" y1="${zero}" x2="${W - 70}" y2="${zero}" class="gl0"/>
      <text x="${L - 6}" y="${zero + 5}" text-anchor="end" class="ctxt">0 mV</text>
      ${bars}${dim}<g id="csel"></g></svg>`;
    drawSel();
  }
  function drawSel() {
    const el = $('#cchart'), g = $('#csel');
    if (!el || !g) return;
    const r = el.getBoundingClientRect();
    const { L, bw } = chartMetrics(r.width);
    const { y } = chartScale(r.height);
    const i = orderNow().findIndex((c) => c.index === S.selected);
    if (i < 0) { g.innerHTML = ''; return; }
    const c = orderNow()[i];
    const x = L + i * bw + 0.5, w = Math.max(1.5, bw - 1.2);
    const mv = (voltOf(c) - mean) * 1000, y1 = y(mv), z = y(0);
    const top = Math.min(y1, z), h = Math.max(1.2, Math.abs(y1 - z));
    const cx = x + w / 2;
    g.innerHTML = `<line x1="${cx}" y1="4" x2="${cx}" y2="${r.height - 4}" class="sel-guide"/>
      <rect class="sel-bar" x="${x}" y="${top}" width="${w}" height="${h}"/>`;
  }
  function renderDetail(st) {
    const box = $('#cdetail');
    if (!box) return;
    if (st === 'lost') { box.innerHTML = ''; return; }
    const c = cells.find((x) => x.index === S.selected) || low;
    const mv = (voltOf(c) - mean) * 1000;
    const pos = byVolt.indexOf(c) + 1;
    const rank = c === low ? 'Lowest of the pack' : c === high ? 'Highest of the pack' : `${pos} of ${cells.length} from lowest`;
    box.innerHTML = `<div class="c-detail">
      <button class="step" id="prev" aria-label="Previous group"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="c-read q-${st}">
        <div class="g">Group ${c.index}${st === 'stale' ? ` <span class="q-note">${ageSpan('held')}</span>` : ''}</div>
        <div class="v">${num(voltOf(c).toFixed(4), voltOf(c).toFixed(4) + ' volts')}<span class="unit">V</span></div>
        <ul>
          <li><b>${mv >= 0 ? '+' : '−'}${Math.abs(mv).toFixed(1)} mV</b> from the average</li>
          <li>${esc(rank)}</li>
          <li>Seen ${c.minimumV.toFixed(4)} to ${c.maximumV.toFixed(4)} V</li>
        </ul>
      </div>
      <button class="step" id="next" aria-label="Next group"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      <div class="c-jump"><button class="btn" id="j-low">Lowest</button><button class="btn" id="j-high">Highest</button></div>
    </div>`;
    const stepBy = (d) => {
      const o = orderNow(); const i = o.findIndex((x) => x.index === S.selected);
      S.selected = o[(i + d + o.length) % o.length].index; drawSel(); renderDetail(st);
    };
    $('#prev').onclick = () => stepBy(-1);
    $('#next').onclick = () => stepBy(1);
    $('#j-low').onclick = () => { S.selected = low.index; drawSel(); renderDetail(st); };
    $('#j-high').onclick = () => { S.selected = high.index; drawSel(); renderDetail(st); };
  }

  /* ---------- Performance (simulated) ---------- */
  function svgNum(x, y, h, str) {
    const g = glyphs(str), k = h / 100;
    return `<g class="num" style="--sw:${(7).toString()}" transform="translate(${x} ${y}) scale(${k})">${g.out}</g>`;
  }
  function renderPerf() {
    const P = F.performanceDemo;
    const X = (s) => 16 + s * 40.4;
    const ticks = Array.from({ length: 16 }, (_, s) => {
      const major = s % 5 === 0;
      return `<line x1="${X(s)}" y1="228" x2="${X(s)}" y2="${major ? 242 : 235}" class="dim-l"/>${major ? `<text x="${X(s)}" y="260" text-anchor="middle" class="p-t2">${s} s</text>` : ''}`;
    }).join('');
    const a = P.zeroTo60MphSeconds, b = P.quarterMileSeconds;
    const dig = 0.74, wA = glyphs(a.toFixed(1)).w * dig, wB = glyphs(b.toFixed(1)).w * dig;
    $('#sheet').innerHTML = head('Performance') +
      `<div class="p-top"><div class="stamp">Simulated</div><p class="p-note">${esc(P.note)}.</p></div>
       <svg class="p-rule" viewBox="0 0 640 268" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Simulated timing. Zero to 60 miles per hour in ${a} seconds. Quarter mile in ${b} seconds.">
         <line x1="${X(0)}" y1="228" x2="${X(15)}" y2="228" class="dim-l"/>
         ${ticks}
         <line x1="${X(0)}" y1="228" x2="${X(0)}" y2="24" class="dim-ext"/>
         <line x1="${X(a)}" y1="228" x2="${X(a)}" y2="24" class="dim-ext"/>
         <line x1="${X(b)}" y1="228" x2="${X(b)}" y2="118" class="dim-ext"/>
         <line x1="${X(0)}" y1="88" x2="${X(a)}" y2="88" class="dim-l" marker-start="url(#arw)" marker-end="url(#arw)"/>
         <text x="${X(0) + 10}" y="74" class="p-t">0 to 60 mph</text>
         <text x="${X(0) + 10}" y="110" class="p-t2">Simulated</text>
         ${svgNum(X(a) + 14, 28, 74, a.toFixed(1))}
         <text x="${X(a) + 14 + wA + 6}" y="100" class="p-t">s</text>
         <line x1="${X(0)}" y1="194" x2="${X(b)}" y2="194" class="dim-l" marker-start="url(#arw)" marker-end="url(#arw)"/>
         <text x="${X(0) + 10}" y="180" class="p-t">Quarter mile</text>
         <text x="${X(0) + 10}" y="214" class="p-t2">Simulated</text>
         ${svgNum(X(b) - wB - 30, 110, 74, b.toFixed(1))}
         <text x="${X(b) - 22}" y="182" class="p-t">s</text>
       </svg>
       <div class="p-low">
         <div class="p-pk"><div class="lab">Peak battery power, simulated</div><div class="val">${num(String(P.peakBatteryPowerKw), P.peakBatteryPowerKw + ' kilowatts')}<span class="unit">kW</span></div></div>
         <div class="p-rules"><b>Timing: rollout ${esc(P.rollout)}.</b> The clock starts the moment the car moves, with no credit for the first foot of travel. Times in seconds, speed in mph, quarter mile is 402 m. These numbers do not change with the data state.</div>
       </div>`;
  }

  /* ---------- Convenience (simulated) ---------- */
  const ACTION_LABELS = { glovebox: ['Open glovebox', 'Glovebox opened'], 'fold mirrors': ['Fold mirrors', 'Mirrors folded'], 'charge port': ['Open charge port', 'Charge port opened'] };
  const ICONS = {
    glovebox: '<rect x="8" y="16" width="48" height="34" rx="3"/><path d="M8 27h48M26 38h12"/>',
    'fold mirrors': '<path d="M12 21c0-5 5-8 12-8h20c6 0 9 4 9 9 0 14-8 24-21 24h-8c-8 0-12-9-12-25z"/><path d="M53 32h7"/>',
    'charge port': '<path d="M32 7c14 0 24 10 24 25S46 57 32 57 8 47 8 32 18 7 32 7z"/><circle cx="23" cy="30" r="4.5"/><circle cx="41" cy="30" r="4.5"/><circle cx="32" cy="17" r="2.6"/><circle cx="24" cy="45" r="2.6"/><circle cx="40" cy="45" r="2.6"/>',
  };
  function tileHtml(act) {
    const a = S.actions[act] || { s: 'idle' };
    const lab = ACTION_LABELS[act] || [act, act];
    const msg = {
      idle: 'Tap to simulate',
      pending: 'Pending, waiting for the car (simulated)',
      confirmed: `${lab[1]}, confirmed (simulated)`,
      unconfirmed: a.why || 'Unconfirmed (simulated). No reply came back, so check the car.',
    }[a.s];
    return `<button class="a-tile ${a.s}" data-act="${esc(act)}" ${a.s === 'pending' ? 'disabled' : ''}>
      <svg viewBox="0 0 64 64" aria-hidden="true">${ICONS[act] || ''}</svg>
      <span class="a-name">${esc(lab[0])}</span>
      <span class="a-state">${esc(msg)}</span>
    </button>`;
  }
  function renderAct() {
    const C = F.controlDemo;
    $('#sheet').innerHTML = head('Convenience') +
      `<p class="a-banner">Simulation only. These tiles send nothing to the car.</p>
       <div class="a-row">${C.actions.map(tileHtml).join('')}</div>
       <div class="a-foot">
         <div><div class="lab">Next simulated result</div>
           <div class="seg" role="group" aria-label="Next simulated result">
             <button data-next="confirmed" aria-pressed="${S.nextResult === 'confirmed'}">Confirmed</button>
             <button data-next="unconfirmed" aria-pressed="${S.nextResult === 'unconfirmed'}">Unconfirmed</button>
           </div></div>
         <ul class="a-log" aria-label="Simulated action log">${S.log.slice(0, 3).map((l) => `<li>${esc(l)}</li>`).join('') || '<li>No simulated actions yet. Tap a tile to try one.</li>'}</ul>
       </div>`;
    document.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => runAct(b.dataset.act); });
    document.querySelectorAll('[data-next]').forEach((b) => { b.onclick = () => { S.nextResult = b.dataset.next; renderAct(); }; });
  }
  function runAct(act) {
    const lab = (ACTION_LABELS[act] || [act])[0];
    S.actions[act] = { s: 'pending' };
    if (S.view === 'act') renderAct();
    setTimeout(() => {
      const offline = Q.link === 'disconnected';
      const outcome = offline ? 'unconfirmed' : S.nextResult;
      S.actions[act] = { s: outcome, why: offline ? 'Unconfirmed (simulated). The data link is down, so no reply can arrive.' : null };
      S.log.unshift(`${Q.t} s, ${lab}: ${outcome === 'confirmed' ? 'confirmed' : 'unconfirmed'} (simulated)`);
      if (S.view === 'act') renderAct();
    }, 1400);
  }

  /* ---------- Rail, strip, routing ---------- */
  const NAV = [
    ['overview', 'Overview', '<rect x="3" y="7" width="16" height="10" rx="1"/><path d="M19 10h2v4h-2M7 7v10M11 7v10"/>'],
    ['cells', 'Cells', '<path d="M4 20v-8M9 20V6M14 20v-11M19 20V4"/>'],
    ['perf', 'Performance', '<path d="M3 17h18M6 17v-3M10 17v-5M14 17v-3M18 17v-5"/><path d="M4 7h14l-3-3M18 7l-3 3"/>'],
    ['act', 'Convenience', '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'],
  ];
  function renderRail() {
    $('#tabs').innerHTML = NAV.map(([id, label, icon]) =>
      `<button class="tab" data-tab="${id}" ${S.view === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${label}</button>`).join('');
    document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
    const th = document.documentElement.dataset.theme;
    $('#theme').innerHTML = [['day', 'Day'], ['night', 'Night']].map(([id, l]) =>
      `<button class="theme-btn" data-theme-set="${id}" aria-pressed="${th === id}">${l}</button>`).join('');
    document.querySelectorAll('[data-theme-set]').forEach((b) => {
      b.onclick = () => { document.documentElement.dataset.theme = b.dataset.themeSet; store.set('battery-sheet-theme', b.dataset.themeSet); renderRail(); };
    });
  }
  function renderStrip() {
    const playIcon = S.playing
      ? '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>';
    const cur = SEGS.findIndex((g) => Q.t >= g.from && Q.t < g.to);
    $('#strip').innerHTML = `<button class="play" id="play" aria-label="${S.playing ? 'Pause replay' : 'Play replay'}">${playIcon}</button>
      <div class="tl">${SEGS.map((g, i) =>
        `<button class="tl-seg k-${g.kind}" style="flex-grow:${g.to - g.from}" data-seg="${i}" aria-pressed="${i === cur}">${esc(g.label)}<small>${esc(g.sub)}</small></button>`).join('')}
        <div class="tl-head" id="tl-head" style="width:${(Q.t / LOOP * 100).toFixed(2)}%"></div></div>`;
    $('#play').onclick = () => { S.playing = !S.playing; renderStrip(); };
    document.querySelectorAll('[data-seg]').forEach((b) => {
      b.onclick = () => { setTime(SEGS[+b.dataset.seg].from + 2); S.playing = false; renderStrip(); };
    });
  }
  function setTime(t) {
    S.t = t;
    Q = derive(t);
    const k = keyOf(Q);
    const head = $('#tl-head');
    if (head) head.style.width = (t / LOOP * 100).toFixed(2) + '%';
    if (k !== lastKey) { lastKey = k; renderSheet(); renderStrip(); }
    else { refreshStatus(); if (S.view === 'overview') refreshTape(); }
  }
  function renderSheet() {
    if (S.view === 'overview') renderOverview();
    else if (S.view === 'cells') renderCells();
    else if (S.view === 'perf') renderPerf();
    else renderAct();
  }
  function render() { renderRail(); renderStrip(); renderSheet(); }
  function go(view) { S.view = view; S.arranging = false; render(); $('#sheet').scrollTop = 0; }

  const savedTheme = store.get('battery-sheet-theme');
  if (savedTheme === 'day' || savedTheme === 'night') document.documentElement.dataset.theme = savedTheme;

  render();
  setInterval(() => { if (S.playing) setTime(S.t + 1 >= LOOP ? 0 : S.t + 1); }, 1000);
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.view === 'cells') renderSheet(); }, 150); });
})();
