// ════════════════════════════════════════════════════════════════════
// WHAT DRIVES THE PRICE (Markets › What drives the price, #markets/drivers)
// How much of the move of the French spot, M+1, Q+1 and Cal+1 over the last
// week, month or quarter comes from gas, carbon, coal, wind, solar, demand and
// nuclear availability, and how much stays unexplained.
//   · Flows view: a Sankey from the fundamentals (left) to the maturities
//     (right); ribbon width = weight of the fundamental in that maturity over
//     one year, colour on arrival = its effect over the period (red pushed the
//     price up, green pushed it down), hatched block = unexplained share.
//   · Table view: the same contributions as a table, in €/MWh.
//   · A replay slider walks the weekly frames; the period (1 wk, 1 month,
//     3 months) sums the weekly contributions.
//   · PKDrivers.tile(host, opts) draws the 4 maturity cards for Today (Quick
//     look) and the dashboard widget 'price-drivers' (js/dash-widgets.js).
// Data: data/drivers/frames.json (scripts/build_drivers.py documents how it is
// rebuilt from the warehouse). d3 (js/vendor/d3.min.js) is loaded only when the
// Flows view is drawn; the cards and the table do not need it.
// Texts are written in English and translated by js/i18n.js (assets/i18n_fr.json,
// assets/i18n_fr_tpl.json); numbers are written the English way and put in the
// French format by the same script.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const DATA = (typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : './data/') + 'drivers/frames.json';
  const D3 = 'js/vendor/d3.min.js';
  const tr = s => (window.PKI18n && PKI18n.tr ? PKI18n.tr(s) : s);
  const esc = s => (window.PK && PK.esc ? PK.esc(s) : String(s));
  const fill = (s, o) => s.replace(/\{(\w+)\}/g, (m, k) => (k in o ? o[k] : m));
  const css = v => (getComputedStyle(document.documentElement).getPropertyValue(v) || '').trim();
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── data ──
  let F = null, fP = null;
  const load = () => fP || (fP = fetch(DATA).then(r => (r.ok ? r.json() : null)).then(j => { F = j; return j; }).catch(() => { fP = null; return null; }));
  let d3P = null;
  const needD3 = () => (window.d3 ? Promise.resolve(window.d3) : d3P || (d3P = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = D3; s.async = true;
    s.onload = () => res(window.d3); s.onerror = () => { d3P = null; rej(new Error('d3 failed to load')); };
    document.head.appendChild(s);
  })));

  // fundamentals: name, short name (narrow screens), colour variable, unit, maturity whose frames carry the level
  const DN = {
    load: { n: 'Demand', s: 'Demand', c: '--text2', u: 'GW', src: 'spot' },
    wind: { n: 'Wind', s: 'Wind', c: '--gen-wind', u: 'GW', src: 'spot' },
    sol: { n: 'Solar', s: 'Solar', c: '--gen-solar', u: 'GW', src: 'spot' },
    nuc: { n: 'Nuclear avail.', s: 'Nuclear', c: '--gen-nuclear', u: 'GW', src: 'spot' },
    ttf: { n: 'TTF gas', s: 'Gas', c: '--cat-gas', u: '€/MWh', src: 'cal' },
    eua: { n: 'CO₂ EUA', s: 'CO₂', c: '--cat-carbon', u: '€/t', src: 'cal' },
    coal: { n: 'API2 coal', s: 'Coal', c: '--cat-fuels', u: '$/t', src: 'cal' },
  };
  const KEYS = Object.keys(DN);
  const ORDER = ['spot', 'm1', 'q1', 'cal'];
  // one-year regressions (Nov 2025 → Nov 2026, see the Method section): weight of each fundamental (i), share explained (r2),
  // pass-through of 1 €/MWh of gas (b). scripts/build_drivers.py will write them into the file (F[h].i, .r2, .b), read first.
  const SENS = {
    spot: { t: 'Spot', i: { ttf: 0.21, wind: 0.13, load: 0.24, nuc: 0.13, sol: 0.05 }, r2: 0.76, b: 2.19 },
    m1: { t: 'M+1', i: { ttf: 0.61, eua: 0.11, nuc: 0.02 }, r2: 0.74, b: 1.36 },
    q1: { t: 'Q+1', i: { ttf: 0.59, eua: 0.10, coal: 0.04, nuc: 0.01 }, r2: 0.74, b: 0.99 },
    cal: { t: 'CAL+1', i: { ttf: 0.50, eua: 0.12, coal: 0.01, nuc: 0.01 }, r2: 0.64, b: 0.49 },
  };
  const L = h => { const s = SENS[h], f = F && F[h] || {}; return { t: s.t, i: f.i || s.i, r2: f.r2 != null ? f.r2 : s.r2, b: f.b != null ? f.b : s.b, sub: sub(h) }; };
  // the contract each maturity stands for, from the last forward date
  function sub(h) {
    const last = F && F.cal && F.cal.w.length ? F.cal.w[F.cal.w.length - 1].d : new Date().toISOString().slice(0, 10);
    const [y, m] = last.split('-').map(Number);
    if (h === 'spot') return tr('day-ahead');
    if (h === 'm1') { const d = new Date(Date.UTC(y, m, 15)); return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }
    if (h === 'q1') { const q = Math.floor((m - 1) / 3) + 1; return q === 4 ? 'Q1 ' + (y + 1) : 'Q' + (q + 1) + ' ' + y; }
    return 'Cal ' + (y + 1);
  }

  // ── numbers (English format; js/i18n.js writes them the French way) ──
  const nf = (v, d = 1) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
  const sg = (v, d = 1) => (v > 0 ? '+' : '') + nf(v, d);
  const tone = v => (Math.abs(v) < 0.5 ? 'cqp-flat' : v > 0 ? 'cqp-rise' : 'cqp-fall');
  const kpiTone = v => (Math.abs(v) < 0.5 ? '' : v > 0 ? ' kpi-down' : ' kpi-up');   // price up = red (--down), down = green (--up)
  const dt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const rgba = (hex, a) => { const h = hex.replace('#', ''), n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

  // ── frames ──
  const NW = () => F.cal.w.length;
  const frame = (h, w) => { const W = F[h] && F[h].w; if (!W) return null; const j = W.length - (NW() - w); return j >= 0 && j < W.length ? W[j] : null; };
  // the period of `per` weeks ending at week w: price, reference, change, contribution of each fundamental, unexplained
  function agg(h, w, per) {
    const fs = []; for (let k = w - per + 1; k <= w; k++) { const f = frame(h, k); if (f) fs.push(f); }
    if (!fs.length || !frame(h, w)) return null;
    const S = L(h), c = {}; KEYS.forEach(k => { c[k] = sum(fs, f => f.c[k]); });
    const dy = fs[fs.length - 1].p - fs[0].r, ux = dy - sum(KEYS.filter(k => S.i[k]), k => c[k]);
    const d0 = new Date(fs[0].d + 'T12:00:00Z'); d0.setUTCDate(d0.getUTCDate() - 7);
    return { p: fs[fs.length - 1].p, r: fs[0].r, dy, c, ux, d: fs[fs.length - 1].d, d0: d0.toISOString().slice(0, 10) };
  }
  const xval = (k, w) => { const f = frame(DN[k].src, w) || frame('cal', w); return f && f.x ? f.x[k] : null; };
  const top2 = (h, a) => Object.entries(a.c).filter(([k, v]) => L(h).i[k] && Math.abs(v) >= 1).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 2);

  // ── the 4 maturity cards (page, Today, dashboards) ──
  function cardsHTML(w, per, o) {
    o = o || {};
    return ORDER.map(h => {
      const S = L(h), a = agg(h, w, per), lab = `<div class="kpi-label">${S.t} · ${esc(S.sub)}</div>`;
      const tag = o.link ? 'a' : 'div', attr = o.link ? ' href="#markets/drivers" data-route="markets/drivers"' : o.pick ? ' role="button" tabindex="0"' : '';
      if (!a) return `<${tag} class="kpi-card cqp-kpi"${attr} data-h="${h}">${lab}<div class="kpi-value">–</div><div class="kpi-meta">${tr('not yet quoted')}</div></${tag}>`;
      const t = top2(h, a);
      const why = t.length ? `${tr('Mainly:')} ` + t.map(([k, v]) => `<span class="cqp-dn">${tr(DN[k].n)}</span> <b class="${tone(v)}">${sg(v, 0)}</b>`).join(', ') : tr('Quiet period');
      return `<${tag} class="kpi-card cqp-kpi${kpiTone(a.dy)}${o.focus === h ? ' cqp-on' : ''}"${attr} data-h="${h}" title="${esc(tr('Open What drives the price'))}">${lab}` +
        `<div class="kpi-value">${nf(a.p)}<span class="kpi-unit">€/MWh</span></div>` +
        `<div class="kpi-chg ${tone(a.dy)}">${sg(a.dy)} (${sg(a.dy / a.r * 100)} %)</div>` +
        `<div class="kpi-meta cqp-why">${why}</div>` +
        (o.compact ? '' : `<div class="cqp-expl" aria-hidden="true"><i style="width:${Math.round(S.r2 * 100)}%"></i></div><div class="kpi-meta">${tr(fill('{r} % explained · gas pass-through × {b}', { r: Math.round(S.r2 * 100), b: S.b.toFixed(2) }))}</div>`) +
        `</${tag}>`;
    }).join('');
  }
  // Today › Quick look and the dashboard widget: one row of 4 cards, each opening the page
  async function tile(host, opts) {
    if (!host) return;
    const j = await load();
    if (!j || !j.cal) { host.innerHTML = `<div class="fuel-note">${tr('Price drivers not available yet.')}</div>`; return; }
    const solo = document.body.classList.contains('pk-solo');   // a shared dashboard leads nowhere else
    const w = NW() - 1, a = agg('cal', w, 1);
    host.innerHTML = (opts && opts.head ? `<div class="fuel-card-head"><div><div class="table-title">${tr('What drives the price')}</div><div class="fuel-card-sub">${tr(fill('France · week to {d} · €/MWh', { d: dt(a.d) }))}</div></div>${solo ? '' : `<a class="cqp-more" href="#markets/drivers" data-route="markets/drivers">${tr('See the detail ›')}</a>`}</div>` : '') +
      `<div class="kpi-strip cqp-kpis cqp-kpis-c">${cardsHTML(w, 1, { link: !solo, compact: true })}</div>`;
  }

  // ── the page ──
  const st = { per: 1, week: null, view: 'flux', focus: 'cal', playing: false, timer: 0, G: null, ready: false };
  const $ = id => document.getElementById(id);

  function lede() {
    const el = $('cqp-lede'); if (!el) return;
    const a = agg('cal', st.week, st.per), s = agg('spot', st.week, st.per), g0 = xval('ttf', st.week - st.per), g1 = xval('ttf', st.week);
    if (!a || !s || !g0 || !g1) { el.textContent = ''; return; }
    const g = (g1 / g0 - 1) * 100, cal = L('cal').sub;
    const key = g < 0 ? 'Over the period, gas fell {g}. {cal} moved {c}, spot {s}. Gas sets the near-term price; {cal} depends far less on it.'
      : 'Over the period, gas rose {g}. {cal} moved {c}, spot {s}. Gas sets the near-term price; {cal} depends far less on it.';
    el.innerHTML = fill(tr(key), { g: `<b>${Math.abs(g).toFixed(0)} %</b>`, cal: esc(cal), c: `<b class="${tone(a.dy)}">${sg(a.dy)} €/MWh</b>`, s: `<b class="${tone(s.dy)}">${sg(s.dy)} €/MWh</b>` });
  }
  function kpis() {
    const box = $('cqp-kpis'); if (!box) return;
    box.innerHTML = cardsHTML(st.week, st.per, { pick: true, focus: st.focus });
    box.querySelectorAll('.cqp-kpi').forEach(k => {
      const pick = () => { st.focus = k.dataset.h; render(); };
      k.addEventListener('click', pick);
      k.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }
  function legend() {
    const el = $('cqp-leg'); if (!el) return;
    if (st.view === 'table') { el.innerHTML = ''; return; }
    el.innerHTML = `<span><i style="background:${css('--down')}"></i>${tr('pushed the price up')}</span><span><i style="background:${css('--up')}"></i>${tr('pushed the price down')}</span><span><i class="cqp-hatch"></i>${tr('unexplained')}</span>`;
  }
  function heads() {
    const t = $('cqp-ctitle'), s = $('cqp-csub');
    if (st.view === 'table') { t.textContent = tr('Contributions by fundamental'); s.textContent = tr('€/MWh over the period · the stronger the colour, the larger the effect'); }
    else { t.textContent = tr('Fundamentals → maturities'); s.textContent = tr('width: weight over one year · colour on arrival: effect over the period · €/MWh'); }
  }

  // tooltip
  let tipEl = null;
  const tip = () => tipEl || (tipEl = Object.assign(document.createElement('div'), { className: 'cqp-tip', role: 'tooltip' }), document.body.appendChild(tipEl), tipEl);
  function showTip(e, h) { const t = tip(); if (h != null) t.innerHTML = h; t.style.opacity = 1; t.style.left = Math.max(8, Math.min(innerWidth - t.offsetWidth - 10, e.clientX + 14)) + 'px'; t.style.top = Math.max(8, Math.min(innerHeight - t.offsetHeight - 10, e.clientY + 14)) + 'px'; }
  const hideTip = () => { if (tipEl) tipEl.style.opacity = 0; };
  const row = (a, b, cls) => `<div class="cqp-tr"><span>${a}</span><span class="${cls || ''}">${b}</span></div>`;
  const perName = () => tr(st.per === 1 ? '1 wk' : st.per === 4 ? '1 month' : '3 months');

  // ── Sankey ──
  function sankey(d3, host) {
    const W = host.clientWidth, mob = W < 700, H = mob ? 440 : 470, top = 10, bot = 10, nw = 6, padL = mob ? 98 : 170, padR = mob ? 64 : 210, x0 = padL, x1 = W - padR;
    const C = { rise: css('--down'), fall: css('--up'), ux: css('--border3'), bg: css('--bg2'), bg0: css('--bg'), t2: css('--text2'), t3: css('--text3') };
    const col = k => css(DN[k].c);
    const svg = d3.select(host).append('svg').attr('width', W).attr('height', H).attr('class', 'cqp-svg').attr('role', 'img').attr('aria-label', tr('Fundamentals → maturities')), defs = svg.append('defs');
    const hp = defs.append('pattern').attr('id', 'cqp-hatch').attr('width', 6).attr('height', 6).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
    hp.append('rect').attr('width', 6).attr('height', 6).attr('fill', C.bg); hp.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6).attr('stroke', C.ux).attr('stroke-width', 2);
    const links = []; ORDER.forEach(h => KEYS.forEach(k => { const v = L(h).i[k]; if (v >= 0.01) links.push({ k, h, v }); }));
    const leftTot = KEYS.map(k => sum(links.filter(l => l.k === k), l => l.v));
    const gapR = 22, s = Math.min((H - top - bot - gapR * 3) / 4, (H - top - bot - 60) / sum(leftTot, x => x)) * 0.95;
    const MIN = mob ? 30 : 40, slots = leftTot.map(v => Math.max(v * s, MIN)), gL = Math.max(4, (H - top - bot - sum(slots, x => x)) / (KEYS.length - 1));
    const ln = {}; let y = top; KEYS.forEach((k, i) => { const hh = leftTot[i] * s; ln[k] = { y: y + (slots[i] - hh) / 2, h: hh, o: 0, cy: y + slots[i] / 2 }; y += slots[i] + gL; });
    const rn = {}; y = top; ORDER.forEach(h => { rn[h] = { y, h: s, o: 0 }; y += s + gapR; });
    links.sort((a, b) => ORDER.indexOf(a.h) - ORDER.indexOf(b.h)); links.forEach(l => { l.y0 = ln[l.k].y + ln[l.k].o; ln[l.k].o += l.v * s; });
    links.sort((a, b) => KEYS.indexOf(a.k) - KEYS.indexOf(b.k)); links.forEach(l => { l.y1 = rn[l.h].y + rn[l.h].o; rn[l.h].o += l.v * s; });
    const g = svg.append('g');
    const path = l => { const w = l.v * s, xa = x0 + nw, xb = x1, xm = (xa + xb) / 2; return `M${xa},${l.y0}C${xm},${l.y0} ${xm},${l.y1} ${xb},${l.y1}L${xb},${l.y1 + w}C${xm},${l.y1 + w} ${xm},${l.y0 + w} ${xa},${l.y0 + w}Z`; };
    // each ribbon leaves in the fundamental's colour and arrives in the colour of its effect (a data encoding, not decoration)
    links.forEach((l, i) => { l.id = 'cqp-g' + i; const gr = defs.append('linearGradient').attr('id', l.id).attr('x1', 0).attr('x2', 1);
      l.s0 = gr.append('stop').attr('offset', '0').attr('stop-color', col(l.k)).attr('stop-opacity', 0.7);
      l.s1 = gr.append('stop').attr('offset', '.6').attr('stop-color', col(l.k)).attr('stop-opacity', 0.35);
      l.s2 = gr.append('stop').attr('offset', '1').attr('stop-color', col(l.k)).attr('stop-opacity', 0.35); });
    const clip = defs.append('clipPath').attr('id', 'cqp-rv').append('rect').attr('height', H).attr('width', reduced() ? W : x0 + nw);
    if (!reduced()) clip.transition().duration(700).ease(d3.easeCubicOut).attr('width', W);
    const rib = g.append('g').attr('clip-path', 'url(#cqp-rv)').selectAll('path').data(links).join('path').attr('class', 'cqp-rib').attr('d', path).attr('fill', l => `url(#${l.id})`);
    const ux = g.selectAll('g.cqp-ux').data(ORDER).join('g').attr('class', 'cqp-nd cqp-ux');
    ux.append('rect').attr('x', x1 - 46).attr('y', h => rn[h].y + rn[h].o).attr('width', 46 + nw).attr('height', h => Math.max(0, rn[h].h - rn[h].o)).attr('fill', 'url(#cqp-hatch)').attr('stroke', C.ux).attr('stroke-width', 0.6);
    if (!mob) links.filter(l => l.k === 'ttf').forEach(l => g.append('text').attr('class', 'cqp-nv cqp-mult').attr('x', x0 + nw + 8).attr('y', l.y0 + l.v * s / 2).attr('dominant-baseline', 'central').style('fill', C.bg0).text(`→ ${L(l.h).t} ×${L(l.h).b.toFixed(2)}`));
    const pills = g.selectAll('g.cqp-pill').data(links).join('g').attr('class', 'cqp-pill').attr('transform', l => `translate(${x1 - 6},${l.y1 + l.v * s / 2})`);
    pills.append('rect').attr('rx', 3).attr('height', 17).attr('y', -8.5).attr('fill', C.bg0).attr('stroke-width', 1);
    pills.append('text').attr('text-anchor', 'end').attr('x', -6).attr('dominant-baseline', 'central');
    const uxp = g.selectAll('g.cqp-uxp').data(ORDER).join('g').attr('class', 'cqp-pill cqp-uxp').attr('transform', h => `translate(${x1 - 52},${(rn[h].y + rn[h].o + rn[h].y + rn[h].h) / 2})`);
    uxp.append('rect').attr('rx', 3).attr('height', 17).attr('y', -8.5).attr('fill', C.bg0).attr('stroke', C.ux);
    uxp.append('text').attr('text-anchor', 'end').attr('x', -6).attr('dominant-baseline', 'central').attr('fill', C.t2);
    const lg = g.selectAll('g.cqp-l').data(KEYS).join('g').attr('class', 'cqp-nd cqp-l');
    lg.append('rect').attr('x', x0).attr('y', k => ln[k].y).attr('width', nw).attr('height', k => Math.max(2, ln[k].h)).attr('rx', 1).attr('fill', col);
    lg.append('text').attr('class', 'cqp-nl').attr('x', x0 - 8).attr('y', k => ln[k].cy - (mob ? 0 : 7)).attr('text-anchor', 'end').attr('dominant-baseline', 'central').style('font-size', mob ? '11px' : null).text(k => tr(mob ? DN[k].s : DN[k].n));
    if (!mob) lg.append('text').attr('class', 'cqp-nv cqp-lv').attr('x', x0 - 12).attr('y', k => ln[k].cy + 8).attr('text-anchor', 'end').attr('dominant-baseline', 'central');
    const rg = g.selectAll('g.cqp-r').data(ORDER).join('g').attr('class', 'cqp-nd cqp-r');
    rg.append('rect').attr('x', x1).attr('y', h => rn[h].y).attr('width', nw).attr('height', h => rn[h].h).attr('rx', 1).attr('fill', C.t2);
    rg.append('text').attr('class', 'cqp-nl').attr('x', x1 + nw + (mob ? 6 : 12)).attr('y', h => rn[h].y + rn[h].h / 2 - (mob ? 8 : 12)).attr('dominant-baseline', 'central').text(h => (mob ? L(h).t : `${L(h).t} · ${L(h).sub}`));
    if (!mob) rg.append('text').attr('class', 'cqp-pv').attr('x', x1 + nw + 12).attr('y', h => rn[h].y + rn[h].h / 2 + 6).attr('dominant-baseline', 'central');
    rg.append('text').attr('class', 'cqp-nv cqp-rd').attr('x', x1 + nw + (mob ? 6 : 12)).attr('y', h => rn[h].y + rn[h].h / 2 + (mob ? 8 : 24)).attr('dominant-baseline', 'central');
    // one annotation: the weather only weighs on the spot
    const wl = links.find(l => l.k === 'wind');
    if (wl && !mob) { const xa = x0 + (x1 - x0) * 0.22, t = (xa - x0 - nw) / (x1 - x0 - nw), ya = wl.y0 + (wl.y1 - wl.y0) * (3 * t * t - 2 * t * t * t);
      g.append('path').attr('class', 'cqp-annl').attr('d', `M${xa},${ya}L${xa + 60},${ya - 4}`); g.append('text').attr('class', 'cqp-annt').attr('x', xa + 64).attr('y', ya - 1).text(tr('weather only weighs on the spot')); }
    // hover: a node or a ribbon lights its links, the rest dims
    const hl = (pr, nd) => { g.classed('cqp-dim', true); rib.classed('cqp-hi', pr); pills.classed('cqp-hi', pr); g.selectAll('g.cqp-nd').classed('cqp-hi', nd); };
    const clr = () => { g.classed('cqp-dim', false); hideTip(); };
    lg.on('mouseenter', (e, k) => { hl(l => l.k === k, n => n === k || links.some(l => l.k === k && l.h === n));
      showTip(e, `<b>${tr(DN[k].n)}</b>` + ORDER.map(h => { const a = agg(h, st.week, st.per), w = L(h).i[k]; return row(L(h).t, (w ? Math.round(w * 100) + ' %' : '–') + ' · ' + (a && w ? `<span class="${tone(a.c[k])}">${sg(a.c[k])}</span>` : '–')); }).join('')); })
      .on('mousemove', e => showTip(e)).on('mouseleave', clr);
    rg.on('mouseenter', (e, h) => { hl(l => l.h === h, n => n === h || !!L(h).i[n]); const a = agg(h, st.week, st.per);
      showTip(e, `<b>${L(h).t} · ${esc(L(h).sub)}</b>` + (a ? Object.entries(a.c).filter(([k]) => L(h).i[k]).sort((x, z) => Math.abs(z[1]) - Math.abs(x[1])).map(([k, v]) => row(tr(DN[k].n), sg(v), tone(v))).join('') +
        row(tr('Unexplained'), sg(a.ux), tone(a.ux)) + `<div class="cqp-tr cqp-tt"><span>${tr('Price change')}</span><span class="${tone(a.dy)}">${sg(a.dy)}</span></div>` : '')); })
      .on('mousemove', e => showTip(e)).on('mouseleave', clr);
    rib.on('mouseenter', (e, l) => { hl(x => x === l, n => n === l.k || n === l.h); const a = agg(l.h, st.week, st.per);
      showTip(e, `<b>${tr(DN[l.k].n)} → ${L(l.h).t}</b>` + row(tr('weight'), Math.round(l.v * 100) + ' %') + (a ? row(perName(), sg(a.c[l.k]) + ' €/MWh', tone(a.c[l.k])) : '')); })
      .on('mousemove', e => showTip(e)).on('mouseleave', clr);
    ux.on('mouseenter', (e, h) => { const a = agg(h, st.week, st.per);
      showTip(e, `<b>${tr('Unexplained')} · ${L(h).t}</b>` + row(tr('weight'), Math.round((1 - L(h).r2) * 100) + ' %') + (a ? row('€/MWh', sg(a.ux), tone(a.ux)) : '') + `<div class="cqp-tn">${tr('Germany, expectations, other')}</div>`); })
      .on('mousemove', e => showTip(e)).on('mouseleave', hideTip);
    return { d3, links, lg, rg, pills, uxp, s, mob, C, col };
  }
  function updSankey() {
    const G = st.G; if (!G) return;
    const { d3, links, lg, rg, pills, uxp, s, C, col } = G, full = st.per === 1 ? 12 : st.per === 4 ? 25 : 45;
    links.forEach(l => { const a = agg(l.h, st.week, st.per), c = a ? a.c[l.k] : null, m = c == null ? 0 : Math.min(1, Math.abs(c) / full);
      const cc = c == null || Math.abs(c) < 0.5 ? col(l.k) : d3.interpolateRgb(col(l.k), c > 0 ? C.rise : C.fall)(0.3 + 0.7 * m);
      l.s2.attr('stop-color', cc).attr('stop-opacity', a ? 0.35 + 0.6 * m : 0.08); l.s0.attr('stop-opacity', a ? 0.7 : 0.12); l.s1.attr('stop-opacity', a ? 0.35 : 0.06); l.c = c; });
    pills.each(function (l) { const el = d3.select(this), show = l.c != null && Math.abs(l.c) >= 1 && l.v * s >= 12; el.style('display', show ? null : 'none'); if (!show) return;
      el.select('text').text(sg(l.c)).attr('fill', l.c > 0 ? C.rise : C.fall); const w = el.select('text').node().getComputedTextLength() + 12; el.select('rect').attr('x', -w).attr('width', w).attr('stroke', l.c > 0 ? C.rise : C.fall); });
    uxp.each(function (h) { const a = agg(h, st.week, st.per), el = d3.select(this), show = a && Math.abs(a.ux) >= 1; el.style('display', show ? null : 'none'); if (!show) return;
      el.select('text').text(sg(a.ux)); const w = el.select('text').node().getComputedTextLength() + 12; el.select('rect').attr('x', -w).attr('width', w); });
    lg.select('.cqp-lv').text(k => { const v = xval(k, st.week), v0 = xval(k, st.week - st.per); if (v == null) return ''; const p = v0 ? (v / v0 - 1) * 100 : 0; return `${nf(v)} ${DN[k].u} · ${Math.abs(p) < 0.5 ? '=' : sg(p, 0) + ' %'}`; });
    rg.select('.cqp-pv').text(h => { const a = agg(h, st.week, st.per); return a ? nf(a.p) : '–'; });
    rg.select('.cqp-rd').each(function (h) { const a = agg(h, st.week, st.per), el = d3.select(this);
      if (!a) { el.attr('fill', C.t3).text(tr('not yet quoted')); return; }
      el.attr('fill', Math.abs(a.dy) < 0.5 ? C.t3 : a.dy > 0 ? C.rise : C.fall).text(sg(a.dy) + (G.mob ? '' : ' €/MWh')); });
  }

  // narrow screens: under the Sankey, bars for the chosen maturity (tap a card to switch)
  function mlist(host) {
    const a = agg(st.focus, st.week, st.per), S = L(st.focus);
    if (!a) { host.innerHTML = `<div class="fuel-note">${tr('not yet quoted')}</div>`; return; }
    const rows = KEYS.filter(k => S.i[k]).map(k => [k, a.c[k]]).concat([['ux', a.ux]]), mx = Math.max(...rows.map(r => Math.abs(r[1])), Math.abs(a.dy), 1);
    const bar = v => { const w = Math.abs(v) / mx * 50; return `<div class="cqp-b2"><i class="${v > 0 ? 'cqp-bg-rise' : 'cqp-bg-fall'}" style="left:${v < 0 ? 50 - w : 50}%;width:${w}%"></i></div>`; };
    host.innerHTML = `<div class="table-title cqp-mt">${S.t} · ${esc(S.sub)} <span class="fuel-card-sub">${tr('tap a card to switch')}</span></div><div class="cqp-ml">` +
      rows.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).map(([k, v]) => `<div class="cqp-mr"><span class="cqp-mk"><i ${k === 'ux' ? 'class="cqp-hatch"' : `style="background:${css(DN[k].c)}"`}></i>${tr(k === 'ux' ? 'Unexplained' : DN[k].n)}</span>${bar(v)}<span class="cqp-mv ${tone(v)}">${sg(v)}</span></div>`).join('') +
      `<div class="cqp-mr cqp-mtot"><span class="cqp-mk">${tr('Price change')}</span>${bar(a.dy)}<span class="cqp-mv ${tone(a.dy)}">${sg(a.dy)}</span></div></div>`;
  }

  // Table view: contributions in €/MWh, the colour grows with the size of the effect
  function table(host) {
    const A = {}; ORDER.forEach(h => { A[h] = agg(h, st.week, st.per); });
    const mx = Math.max(1, ...ORDER.flatMap(h => (A[h] ? KEYS.map(k => Math.abs(A[h].c[k] || 0)) : [0])));
    const rise = css('--down'), fall = css('--up');
    const cell = (v, on) => { if (!on) return '<td class="cqp-na">·</td>'; if (Math.abs(v) < 0.5) return `<td class="cqp-flat">${sg(v)}</td>`;
      const al = 0.12 + 0.55 * Math.min(1, Math.abs(v) / mx); return `<td class="${tone(v)}" style="background:${rgba(v > 0 ? rise : fall, al.toFixed(2))};color:var(--text)">${sg(v)}</td>`; };
    let h = `<div class="cqp-tw"><table class="fuel-table cqp-ht"><thead><tr><th style="text-align:left">${tr('Fundamental')}</th>` + ORDER.map(o => `<th>${L(o).t}<span class="cqp-thsub">${esc(L(o).sub)}</span></th>`).join('') + '</tr></thead><tbody>';
    h += KEYS.map(k => `<tr><td class="cqp-k"><i style="background:${css(DN[k].c)}"></i>${tr(DN[k].n)}</td>` + ORDER.map(o => (A[o] ? cell(A[o].c[k], !!L(o).i[k]) : '<td>–</td>')).join('') + '</tr>').join('');
    h += `<tr><td class="cqp-k"><i class="cqp-hatch"></i>${tr('Unexplained')}</td>` + ORDER.map(o => (A[o] ? cell(A[o].ux, true) : '<td>–</td>')).join('') + '</tr>';
    h += `<tr class="cqp-tot"><td class="cqp-k">${tr('Price change')}</td>` + ORDER.map(o => (A[o] ? `<td class="${tone(A[o].dy)}">${sg(A[o].dy)}</td>` : '<td>–</td>')).join('') + '</tr>';
    h += `<tr><td class="cqp-k">${tr('Price at the end of the period')}</td>` + ORDER.map(o => `<td>${A[o] ? nf(A[o].p) : '–'}</td>`).join('') + '</tr></tbody></table></div>';
    host.innerHTML = h;
  }

  async function render(full) {
    const host = $('cqp-viz'); if (!host || !F) return;
    heads(); legend(); kpis(); lede();
    const a = agg('cal', st.week, st.per), wk = $('cqp-wk'); if (wk) wk.textContent = a ? `${dt(a.d0)} → ${dt(a.d)}` : '';
    const rng = $('cqp-rng'); if (rng) rng.value = st.week;
    const mob = host.clientWidth < 700;
    if (st.view === 'table') { st.G = null; table(host); return; }
    if (full || mob || !st.G || !host.querySelector('svg')) {
      let d3; try { d3 = await needD3(); } catch (e) { host.innerHTML = `<div class="fuel-note">${tr('The flow chart could not load: the Table view shows the same figures.')}</div>`; return; }
      if (st.view !== 'flux') return;
      host.innerHTML = ''; st.G = null;
      const top = document.createElement('div'); host.appendChild(top);
      st.G = sankey(d3, top);
      if (mob) { const b = document.createElement('div'); b.className = 'cqp-mlw'; host.appendChild(b); mlist(b); }
    }
    updSankey();
  }

  function stop() { st.playing = false; clearTimeout(st.timer); const b = $('cqp-play'); if (b) { b.textContent = '▶'; b.setAttribute('aria-label', tr('Replay the weeks')); } }
  function tick() { if (!st.playing) return; if (st.week >= NW() - 1) { stop(); return; } st.week++; render(); st.timer = setTimeout(tick, 600); }

  // tabs and period answer at once, before the data is in (the address ?v=1 clicks the Table tab right away)
  function controls() {
    const pg = $('page-drivers'); if (!pg || pg.dataset.cqp) return; pg.dataset.cqp = '1';
    pg.querySelectorAll('#cqp-tabs .tab-btn').forEach(b => b.addEventListener('click', () => {
      st.view = b.dataset.v; pg.querySelectorAll('#cqp-tabs .tab-btn').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
      hideTip(); if (F) render(true);
    }));
    pg.querySelectorAll('#cqp-per .pk-gf-btn').forEach(b => b.addEventListener('click', () => {
      st.per = +b.dataset.p; pg.querySelectorAll('#cqp-per .pk-gf-btn').forEach(x => x.classList.toggle('active', x === b));
      if (st.week != null && st.week < st.per - 1) st.week = st.per - 1; if (F) render();
    }));
    let rt = 0; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (F && pg.classList.contains('active')) render(true); }, 200); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', controls); else controls();

  function wire() {
    if (st.ready) return; st.ready = true;
    const rng = $('cqp-rng'); rng.max = NW() - 1; rng.addEventListener('input', () => { st.week = +rng.value; stop(); render(); });
    $('cqp-play').addEventListener('click', () => { if (st.playing) { stop(); return; } st.playing = true; if (st.week >= NW() - 1) st.week = Math.min(NW() - 1, st.per); const b = $('cqp-play'); b.textContent = '❚❚'; b.setAttribute('aria-label', tr('Pause')); render(); st.timer = setTimeout(tick, 600); });
    const upd = $('cqp-upd'); if (upd) upd.textContent = tr(fill('France · to {d}', { d: dt(F.spot.w[F.spot.w.length - 1].d) }));
    const meta = $('cqp-meta'); if (meta) meta.textContent = tr(fill('{n} maturities · one frame a week since {d}', { n: ORDER.length, d: dt(F.cal.w[0].d) }));
  }

  async function open() {
    const host = $('cqp-viz'); if (!host) return;
    if (!F) host.innerHTML = '<div class="loading-row" style="padding:14px"><span class="spinner"></span></div>';
    const j = await load();
    if (!j || !j.cal) { host.innerHTML = `<div class="fuel-note">${tr('Price drivers not available yet.')}</div>`; return; }
    if (st.week == null) st.week = NW() - 1;
    wire();
    const act = document.querySelector('#cqp-tabs .tab-btn.active'); if (act) st.view = act.dataset.v;
    render(true);
  }

  if (window.PK && PK.onPage) {
    PK.onPage('drivers', open);
    // Today › Quick look: the 4 cards under the tiles
    PK.onPage('morning', () => { const h = $('mrn-q-drivers'); if (h && !h.dataset.done) { h.dataset.done = '1'; tile(h, { head: true }); } });
  }
  window.addEventListener('load', () => setTimeout(() => {
    const pg = document.querySelector('.page.active');
    if (pg && pg.id === 'page-morning') { const h = $('mrn-q-drivers'); if (h && !h.dataset.done) { h.dataset.done = '1'; tile(h, { head: true }); } }
  }, 60));

  window.PKDrivers = { tile, load };
})();
