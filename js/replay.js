// ════════════════════════════════════════════════════════════════════
// replay.js · Power system › Replay a day
// ────────────────────────────────────────────────────────────────────
// One French day played back quarter-hour by quarter-hour, a clock running:
//   prices      imbalance price (excess, deficit) against the day-ahead
//               (data/history/fr_imbalance_price, daily files)
//   production  solar, wind, nuclear and consumption (RTE éCO2mix)
// Drawn on one canvas, so "Export video" records exactly what is shown
// (MediaRecorder: MP4 where the browser can, else WebM) in 16:9, 1:1 or 9:16.
// Notable days (highest imbalance price, most hours at 0 € or below) one click away.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const T = (fr, en) => (typeof _mT === 'function' ? _mT(fr, en) : en);
  const cache = {};
  const json = (k, path) => cache[k] || (cache[k] = fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => { delete cache[k]; return null; }));
  const FORMATS = { '16:9': [1280, 720], '1:1': [1080, 1080], '9:16': [1080, 1920] };
  const SPEEDS = { slow: 2, normal: 5, fast: 12 };   // quarter-hours per second
  const S = { day: null, mode: 'prices', fmt: '16:9', speed: 'normal', t: 0, from: 0, to: 95, playing: false, data: null, rec: null };
  const fmtN = (v, d) => v == null || !isFinite(v) ? '–' : (v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0').replace('.', T(',', '.'));
  const hh = q => String(Math.floor(q / 4)).padStart(2, '0') + ':' + String(q % 4 * 15).padStart(2, '0');
  const q96 = a => !Array.isArray(a) ? null : a.length >= 96 ? a.slice(0, 96) : a.length === 24 ? a.flatMap(x => [x, x, x, x]) : null;

  // ── data of one day ──
  async function load(day) {
    const [imb, daily] = await Promise.all([json('imb' + day.slice(0, 7), `history/fr_imbalance_price/${day.slice(0, 7)}.json`), json('d' + day, `history/daily/${day}.json`)]);
    const da = q96(daily && daily.zones && daily.zones.FR && daily.zones.FR.hourly);
    const ib = imb && imb.days && imb.days[day];
    const R = window.pkRte ? await window.pkRte.day(day).catch(() => null) : null;
    const g = k => R && q96(R[k]) ? q96(R[k]).map(x => x == null ? null : x / 1000) : null;
    return {
      prices: [ib && { key: 'short', name: T('Écarts, déficit', 'Imbalance, deficit'), color: '#D9423D', w: 3.2, v: ib.short },
        ib && !ib.long.every((x, i) => x === ib.short[i]) && { key: 'long', name: T('Écarts, excédent', 'Imbalance, excess'), color: '#F08A86', w: 2.2, v: ib.long },
        da && { key: 'da', name: 'Day-ahead', color: '#6B7F94', w: 2.2, dash: [8, 6], v: da }].filter(Boolean),
      production: [g('load') && { key: 'load', name: T('Consommation', 'Consumption'), color: '#111922', w: 2.6, v: g('load') },
        g('nuclear') && { key: 'nuc', name: T('Nucléaire', 'Nuclear'), color: '#8B5CF6', w: 2.4, v: g('nuclear') },
        g('wind') && { key: 'wind', name: T('Éolien', 'Wind'), color: '#0EA5B7', w: 2.4, v: g('wind') },
        g('solar') && { key: 'solar', name: T('Solaire', 'Solar'), color: '#F59E0B', w: 2.4, v: g('solar') }].filter(Boolean),
    };
  }
  const unit = () => S.mode === 'prices' ? '€/MWh' : 'GW';

  // ── commentary: the day's notable moments, found in the data, written as a market note would ──
  function events(D, mode) {
    const E = [], by = k => (D[mode].find(s => s.key === k) || {}).v, at = (a, q) => a ? a[q] : null;
    const arg = (a, fn) => { let b = null; (a || []).forEach((v, q) => { if (v != null && (b == null || fn(v, a[b]))) b = q; }); return b; };
    const push = (q, txt, key) => { if (q != null && !E.some(e => Math.abs(e.q - q) < 8)) E.push({ q, txt, key }); };
    if (mode === 'prices') {
      const sh = by('short'), da = by('da');
      const hi = arg(sh, (a, b) => a > b), lo = arg(sh, (a, b) => a < b);
      if (hi != null && sh[hi] > 250) { const r = at(da, hi) > 0 ? sh[hi] / da[hi] : null;
        push(hi, T(`Le prix des écarts s’envole à ${fmtN(sh[hi], 0)} €/MWh` + (r && r > 1.5 ? `, ${fmtN(r, 1)} fois le day-ahead` : '') + ' : le système manque d’énergie, RTE appelle des réserves chères et ceux qui sont courts paient le prix fort.',
          `The imbalance price jumps to ${fmtN(sh[hi], 0)} €/MWh` + (r && r > 1.5 ? `, ${fmtN(r, 1)} times the day-ahead` : '') + ': the system is short, RTE calls expensive reserves and whoever is short pays the full price.'), 'short'); }
      if (lo != null && sh[lo] < -30) push(lo, T(`Le prix des écarts plonge à ${fmtN(sh[lo], 0)} €/MWh : trop d’énergie sur le réseau, être court rapporte, être long coûte.`, `The imbalance price dives to ${fmtN(sh[lo], 0)} €/MWh: too much energy on the grid, being short pays, being long costs.`), 'short');
      const neg = (da || []).findIndex(v => v != null && v <= 0);
      if (neg >= 0) push(neg, T(`Le day-ahead passe à 0 € ou moins : le soleil et le vent dépassent ce que la France consomme et exporte.`, `The day-ahead goes to 0 € or below: sun and wind exceed what France consumes and exports.`), 'da');
      const pk = arg(da, (a, b) => a > b);
      if (pk != null) push(pk, pk >= 64 && pk <= 88 ? T(`Pointe du soir : le day-ahead atteint ${fmtN(da[pk], 0)} €/MWh quand le soleil se couche et que la demande monte.`, `Evening peak: the day-ahead reaches ${fmtN(da[pk], 0)} €/MWh as the sun sets and demand rises.`)
        : pk >= 24 && pk <= 44 ? T(`Pointe du matin : ${fmtN(da[pk], 0)} €/MWh au day-ahead, avant que le solaire ne monte.`, `Morning peak: ${fmtN(da[pk], 0)} €/MWh on the day-ahead, before solar ramps up.`)
          : T(`Le day-ahead culmine à ${fmtN(da[pk], 0)} €/MWh.`, `The day-ahead tops at ${fmtN(da[pk], 0)} €/MWh.`), 'da');
      let g = null; (sh || []).forEach((v, q) => { if (v != null && at(da, q) != null && !E.some(e => Math.abs(e.q - q) < 8) && (g == null || Math.abs(v - da[q]) > Math.abs(sh[g] - da[g]))) g = q; });
      if (g != null && Math.abs(sh[g] - da[g]) > 100) push(g, T(`Écart de ${fmtN(sh[g] - da[g], 0)} €/MWh entre le prix des écarts et le day-ahead : une erreur de prévision se paie cher à cette heure-là.`, `A ${fmtN(sh[g] - da[g], 0)} €/MWh gap between imbalance and day-ahead: a forecast error costs a lot at that hour.`), 'short');
    } else {
      const ld = by('load'), so = by('solar'), wi = by('wind'), nu = by('nuc');
      const sp = arg(so, (a, b) => a > b);
      if (sp != null && so[sp] > 1) push(sp, T(`Pic solaire : ${fmtN(so[sp], 1)} GW, ${fmtN(so[sp] / ld[sp] * 100, 0)} % de la consommation.`, `Solar peak: ${fmtN(so[sp], 1)} GW, ${fmtN(so[sp] / ld[sp] * 100, 0)} % of consumption.`), 'solar');
      const lp = arg(ld, (a, b) => a > b);
      if (lp != null) push(lp, T(`Pointe de consommation : ${fmtN(ld[lp], 1)} GW.`, `Consumption peak: ${fmtN(ld[lp], 1)} GW.`), 'load');
      if (wi) { let best = null; for (let q = 12; q < 96; q++) if (wi[q] != null && wi[q - 12] != null && (best == null || Math.abs(wi[q] - wi[q - 12]) > Math.abs(wi[best] - wi[best - 12]))) best = q;
        if (best != null && Math.abs(wi[best] - wi[best - 12]) > 2) push(best, wi[best] > wi[best - 12] ? T(`Le vent se lève : +${fmtN(wi[best] - wi[best - 12], 1)} GW d’éolien en 3 heures.`, `The wind picks up: +${fmtN(wi[best] - wi[best - 12], 1)} GW of wind in 3 hours.`)
          : T(`Le vent retombe : ${fmtN(wi[best] - wi[best - 12], 1)} GW d’éolien en 3 heures.`, `The wind drops: ${fmtN(wi[best] - wi[best - 12], 1)} GW of wind in 3 hours.`), 'wind'); }
      if (nu) { const a = arg(nu, (x, y) => x > y), b = arg(nu, (x, y) => x < y);
        if (a != null && b != null && nu[a] - nu[b] > 2) push(b, T(`Le nucléaire module : ${fmtN(nu[b] - nu[a], 1)} GW par rapport à son plus haut du jour, pour laisser la place aux renouvelables.`, `Nuclear modulates: ${fmtN(nu[b] - nu[a], 1)} GW against its daily high, making room for renewables.`), 'nuc'); }
      if (so && wi && ld) { const sh = ld.map((l, q) => l ? ((so[q] || 0) + (wi[q] || 0)) / l : null), m = arg(sh, (x, y) => x > y);
        if (m != null && sh[m] > 0.3) push(m, T(`Éolien et solaire couvrent ${fmtN(sh[m] * 100, 0)} % de la consommation.`, `Wind and solar cover ${fmtN(sh[m] * 100, 0)} % of consumption.`), 'solar'); }
    }
    return E.sort((a, b) => a.q - b.q).slice(0, 5).map((e, i) => Object.assign(e, { n: i + 1 }));
  }
  function wrap(c, text, maxW) {
    const words = text.split(' '), lines = []; let l = '';
    words.forEach(w => { const tr = l ? l + ' ' + w : w; if (c.measureText(tr).width > maxW && l) { lines.push(l); l = w; } else l = tr; });
    if (l) lines.push(l); return lines;
  }

  // ── colours: the site's own (CSS variables), dark by default, light in light mode; series colours by key ──
  function pal() {
    const cs = getComputedStyle(document.documentElement), v = (n, f) => (cs.getPropertyValue(n) || '').trim() || f;
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    return { light, bg: v('--bg2', '#0f1419'), panel: v('--bg3', '#151c24'), text: v('--text', '#FFFFFF'), text2: v('--text2', '#B8C9D9'), text3: v('--text3', '#7A93AB'),
      grid: v('--border', '#1e2d3d'), axis: v('--border2', '#243447'), accent: v('--accent', '#14D3A9'), down: v('--down', '#ED6965'),
      series: light ? { short: '#D2453F', long: '#EC8B86', da: '#5F738A', load: '#13202E', nuc: '#7C4DDB', wind: '#0E8FA3', solar: '#D98A06' }
        : { short: '#ED6965', long: '#F2A3A0', da: '#B8C9D9', load: '#FFFFFF', nuc: '#B794F6', wind: '#7FC8F8', solar: '#FBBF24' } };
  }
  new MutationObserver(() => { if (S.data) draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ── drawing ──
  function nice(lo, hi) {
    const span = hi - lo || 1, step0 = span / 5, p = Math.pow(10, Math.floor(Math.log10(step0))), step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= step0);
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  }
  function draw() {
    const cv = document.getElementById('rp-canvas'); if (!cv || !S.data) return;
    const [W, H] = FORMATS[S.fmt]; if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = cv.getContext('2d'), wide = W / H > 1.4, k = W / 1280 * (wide ? 1 : 1.12), P = 48 * k;
    const C = pal(), ser = S.data[S.mode].map(x => Object.assign({}, x, { color: C.series[x.key] || x.color })), t = Math.max(S.from, Math.min(S.to, S.t)), qi = Math.floor(t);
    c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
    const F = (w, px, fam) => `${w} ${Math.round(px * k)}px ${fam || 'Inter, system-ui, sans-serif'}`;
    // header: brand, date, clock, the headline value
    c.fillStyle = C.text; c.font = F(700, 22); c.textBaseline = 'top'; c.fillText('Power', P, P);
    const bw = c.measureText('Power').width; c.fillStyle = C.accent; c.fillText('.Klock', P + bw, P);
    const dl = new Date(S.day + 'T12:00:00Z').toLocaleDateString(T('fr-FR', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    c.fillStyle = C.text3; c.font = F(500, 18); c.fillText(T('France · ', 'France · ') + dl, P, P + 36 * k);
    c.fillStyle = C.text; c.font = F(700, 84, "'JetBrains Mono', ui-monospace, monospace"); c.fillText(hh(qi), P, P + 66 * k);
    const head = ser[0], hv = head && head.v[qi];
    let x0 = P + c.measureText('00:00').width + 36 * k;
    if (head) {
      c.fillStyle = C.text3; c.font = F(500, 17); c.fillText(head.name, x0, P + 74 * k);
      c.fillStyle = head.color; c.font = F(700, 42, "'JetBrains Mono', ui-monospace, monospace"); c.fillText(fmtN(hv, 0) + ' ' + unit(), x0, P + 98 * k);
      const ref = S.mode === 'prices' ? ser.find(s => s.key === 'da') : null;
      if (ref && hv != null && ref.v[qi]) {
        const r = hv / ref.v[qi], txt = Math.abs(r) >= 1.5 ? fmtN(r, 1) + T(' × le day-ahead', ' × the day-ahead') : T('day-ahead ', 'day-ahead ') + fmtN(ref.v[qi], 0);
        c.font = F(600, 17); const tw = c.measureText(txt).width + 24 * k, ty = P + 150 * k;
        const hot = Math.abs(r) >= 1.5;
        c.fillStyle = hot ? (C.light ? 'rgba(210,69,63,.12)' : 'rgba(237,105,101,.18)') : C.panel; roundRect(c, x0, ty, tw, 30 * k, 15 * k); c.fill();
        c.fillStyle = hot ? C.down : C.text2; c.textBaseline = 'middle'; c.fillText(txt, x0 + 12 * k, ty + 15 * k); c.textBaseline = 'top';
      }
    }
    // the day's extreme so far
    if (head) {
      let mx = -Infinity, mq = null; for (let q = S.from; q <= qi; q++) { const v = head.v[q]; if (v != null && v > mx) { mx = v; mq = q; } }
      if (mq != null) { c.fillStyle = C.text3; c.font = F(500, 16); c.textAlign = 'right'; c.fillText(T('Plus haut jusqu’ici : ', 'High so far: ') + fmtN(mx, 0) + ' ' + unit() + T(' à ', ' at ') + hh(mq), W - P, P + 4 * k); c.textAlign = 'left'; }
    }
    // chart and bars
    const top = P + (wide ? 200 : 210) * k, bottom = H - P - 70 * k;
    const chart = wide ? { x: P + 56 * k, y: top, w: (W - 2 * P) * 0.70 - 56 * k, h: bottom - top } : { x: P + 56 * k, y: top, w: W - 2 * P - 56 * k, h: (bottom - top) * 0.62 };
    const bars = wide ? { x: P + (W - 2 * P) * 0.74, y: top, w: (W - 2 * P) * 0.26, h: bottom - top } : { x: P, y: chart.y + chart.h + 60 * k, w: W - 2 * P, h: bottom - (chart.y + chart.h + 60 * k) };
    const vals = ser.flatMap(s => s.v.slice(S.from, S.to + 1)).filter(v => v != null);
    const Y = nice(Math.min(0, ...vals), Math.max(...vals));
    const yOf = v => chart.y + chart.h - (v - Y.lo) / (Y.hi - Y.lo) * chart.h, xOf = q => chart.x + (q - S.from) / Math.max(1, S.to - S.from) * chart.w;
    c.font = F(500, 14, "'JetBrains Mono', ui-monospace, monospace"); c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let v = Y.lo; v <= Y.hi + 1e-9; v += Y.step) {
      c.strokeStyle = Math.abs(v) < 1e-9 ? C.text3 : C.grid; c.lineWidth = 1; c.beginPath(); c.moveTo(chart.x, yOf(v)); c.lineTo(chart.x + chart.w, yOf(v)); c.stroke();
      c.fillStyle = C.text3; c.fillText(fmtN(v, 0), chart.x - 10 * k, yOf(v));
    }
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let q = Math.ceil(S.from / 16) * 16; q <= S.to; q += 16) c.fillText(hh(q), xOf(q), chart.y + chart.h + 10 * k);
    c.textAlign = 'left';
    ser.slice().reverse().forEach(s => {
      c.strokeStyle = s.color; c.lineWidth = s.w * k; c.setLineDash((s.dash || []).map(x => x * k)); c.lineJoin = 'round'; c.beginPath();
      let pen = false;
      for (let q = S.from; q <= qi; q++) { const v = s.v[q]; if (v == null) { pen = false; continue; } pen ? c.lineTo(xOf(q), yOf(v)) : c.moveTo(xOf(q), yOf(v)); pen = true; }
      const a = s.v[qi], b = s.v[Math.min(qi + 1, 95)];
      if (pen && a != null && b != null && t > qi) c.lineTo(xOf(t), yOf(a + (b - a) * (t - qi)));
      c.stroke(); c.setLineDash([]);
    });
    if (head && hv != null) { c.fillStyle = head.color; c.beginPath(); c.arc(xOf(qi), yOf(hv), 6 * k, 0, 2 * Math.PI); c.fill(); }
    c.strokeStyle = C.text2; c.lineWidth = 1.5 * k; c.beginPath(); c.moveTo(xOf(t), chart.y); c.lineTo(xOf(t), chart.y + chart.h); c.stroke();
    // bars: each series at this quarter-hour
    const n = ser.length, gap = 16 * k, bwid = (bars.w - gap * (n - 1)) / n, base = bars.y + bars.h - 34 * k, tall = bars.h - 70 * k;
    const bmax = Math.max(...vals.map(Math.abs), 1);
    c.strokeStyle = C.axis; c.lineWidth = 1; c.beginPath(); c.moveTo(bars.x, base); c.lineTo(bars.x + bars.w, base); c.stroke();
    ser.forEach((s, i) => {
      const v = s.v[qi], x = bars.x + i * (bwid + gap), h = v == null ? 0 : Math.abs(v) / bmax * tall;
      c.fillStyle = s.color; c.globalAlpha = s.key === 'long' && C.light ? 0.75 : 1;
      if (v != null) { if (v >= 0) c.fillRect(x, base - h, bwid, h); else c.fillRect(x, base, bwid, Math.min(h, 30 * k)); }
      c.globalAlpha = 1; c.fillStyle = C.text; c.font = F(700, 18, "'JetBrains Mono', ui-monospace, monospace"); c.textAlign = 'center';
      c.textBaseline = 'bottom'; c.fillText(fmtN(v, S.mode === 'prices' ? 0 : 1), x + bwid / 2, (v != null && v >= 0 ? base - h : base) - 6 * k);
      c.textBaseline = 'top'; c.fillStyle = C.text2; c.font = F(500, 14); c.fillText(s.name, x + bwid / 2, base + 8 * k); c.textAlign = 'left';
    });
    // commentary: numbered markers on the moments passed, the caption of the latest one for 3 hours of the day
    (S.events || []).forEach(e => {
      if (e.q > t) return;
      const s = ser.find(x => x.key === e.key) || head, v = s && s.v[e.q]; if (v == null) return;
      const x = xOf(e.q), y = yOf(v) + (v < (Y.lo + Y.hi) / 2 && v < 0 ? 22 : -22) * k;   // a low point gets its marker below
      c.fillStyle = C.text; c.beginPath(); c.arc(x, y, 13 * k, 0, 2 * Math.PI); c.fill();
      c.fillStyle = C.bg; c.font = F(700, 14); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(e.n), x, y); c.textAlign = 'left'; c.textBaseline = 'top';
    });
    const cur = (S.events || []).filter(e => e.q <= t && t < e.q + 12).pop();
    if (cur) {
      const a = Math.min(1, (t - cur.q) / 1.5, (cur.q + 12 - t) / 1.5);
      c.globalAlpha = S.playing ? Math.max(0, a) : 1;
      c.font = F(500, 19); const bw2 = Math.min(chart.w * 0.48, 600 * k), lines = wrap(c, cur.txt, bw2 - 64 * k), bh = (lines.length * 26 + 28) * k;
      const bx = xOf(cur.q) > chart.x + chart.w / 2 ? chart.x + 12 * k : chart.x + chart.w - bw2 - 12 * k, by = chart.y + 8 * k;
      c.fillStyle = C.panel; roundRect(c, bx, by, bw2, bh, 12 * k); c.fill();
      c.strokeStyle = C.accent; c.lineWidth = 1.5 * k; c.stroke();
      c.fillStyle = C.accent; c.beginPath(); c.arc(bx + 26 * k, by + 28 * k, 13 * k, 0, 2 * Math.PI); c.fill();
      c.fillStyle = C.bg; c.font = F(700, 14); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(cur.n), bx + 26 * k, by + 28 * k); c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillStyle = C.text; c.font = F(500, 19); lines.forEach((l, i) => c.fillText(l, bx + 50 * k, by + 16 * k + i * 26 * k));
      c.globalAlpha = 1;
    }
    // footer: progress and source
    const fy = H - P - 22 * k;
    c.fillStyle = C.grid; roundRect(c, P, fy, W - 2 * P, 8 * k, 4 * k); c.fill();
    c.fillStyle = C.accent; roundRect(c, P, fy, Math.max(8 * k, (W - 2 * P) * (t - S.from) / Math.max(1, S.to - S.from)), 8 * k, 4 * k); c.fill();
    c.fillStyle = C.text3; c.font = F(500, 13); c.textBaseline = 'top';
    c.fillText(S.mode === 'prices' ? T('ENTSO-E · prix des écarts France et day-ahead, au quart d’heure · powerklock', 'ENTSO-E · France imbalance and day-ahead prices, quarter-hourly · powerklock') : T('RTE éCO2mix · production et consommation, au quart d’heure · powerklock', 'RTE éCO2mix · output and consumption, quarter-hourly · powerklock'), P, fy + 16 * k);
    const lab = document.getElementById('rp-time'); if (lab) lab.textContent = hh(qi);
    const sc = document.getElementById('rp-scrub'); if (sc && document.activeElement !== sc) sc.value = String(qi);
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ── playback ──
  let last = 0, hold = 0;
  function frame(ts) {
    if (!S.playing) return;
    const dt = last ? (ts - last) / 1000 : 0; last = ts;
    if (S.t < S.to) S.t = Math.min(S.to, S.t + dt * SPEEDS[S.speed]);
    else if (S.rec) { hold += dt; if (hold > 1.5) { stopRec(); return; } }
    else { S.playing = false; syncBtn(); }
    draw();
    requestAnimationFrame(frame);
  }
  function play() { if (S.t >= S.to) S.t = S.from; S.playing = true; last = 0; hold = 0; syncBtn(); requestAnimationFrame(frame); }
  function pause() { S.playing = false; syncBtn(); }
  function syncBtn() { const b = document.getElementById('rp-play'); if (b) { b.textContent = S.playing ? T('Pause', 'Pause') : T('Lecture', 'Play'); b.setAttribute('aria-pressed', String(S.playing)); } }

  // ── video export ──
  function record() {
    const cv = document.getElementById('rp-canvas'); if (!cv || !cv.captureStream || !window.MediaRecorder) { alert(T('Ce navigateur ne sait pas enregistrer de vidéo.', 'This browser cannot record video.')); return; }
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(x => MediaRecorder.isTypeSupported(x));
    const rec = new MediaRecorder(cv.captureStream(30), { mimeType: type, videoBitsPerSecond: 6e6 }), parts = [];
    rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(parts, { type }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `powerklock-${S.mode}-${S.day}-${S.fmt.replace(':', 'x')}.${/mp4/.test(type) ? 'mp4' : 'webm'}`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const b = document.getElementById('rp-export'); if (b) { b.disabled = false; b.textContent = T('Exporter en vidéo', 'Export video'); }
    };
    S.rec = rec; S.t = S.from; draw(); rec.start();
    const b = document.getElementById('rp-export'); if (b) { b.disabled = true; b.textContent = T('Enregistrement…', 'Recording…'); }
    play();
  }
  function stopRec() { S.playing = false; syncBtn(); if (S.rec) { S.rec.stop(); S.rec = null; } }

  // ── notable days: highest imbalance price, most hours at 0 € or below (last 90 days) ──
  async function notable() {
    const host = document.getElementById('rp-days'); if (!host) return;
    const t = new Date(), months = [0, 1, 2].map(k => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
    const [fs, h] = await Promise.all([Promise.all(months.map(m => json('imb' + m, `history/fr_imbalance_price/${m}.json`))), json('frh' + t.getUTCFullYear(), `history/fr_hourly/${t.getUTCFullYear()}.json`)]);
    const imb = Object.assign({}, ...fs.filter(Boolean).map(f => f.days || {}));
    const spikes = Object.entries(imb).map(([d, v]) => [d, Math.max(...v.short.filter(x => x != null))]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const neg = Object.entries((h && h.days) || {}).filter(([d]) => d >= new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10))
      .map(([d, v]) => [d, (v.p || []).filter(x => x != null && x <= 0).length]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const lbl = d => new Date(d + 'T12:00:00Z').toLocaleDateString(T('fr-FR', 'en-GB'), { day: 'numeric', month: 'short', timeZone: 'UTC' });
    host.innerHTML = (spikes.length ? `<div class="rp-dg"><b>${T('Pics du prix des écarts', 'Imbalance price spikes')}</b>` + spikes.map(([d, v]) => `<button type="button" class="cmp-pill" data-day="${d}" data-mode="prices">${lbl(d)} · ${fmtN(v, 0)} €</button>`).join('') + '</div>' : '') +
      (neg.length ? `<div class="rp-dg"><b>${T('Heures à 0 € ou moins', 'Hours at 0 € or below')}</b>` + neg.map(([d, n]) => `<button type="button" class="cmp-pill" data-day="${d}" data-mode="production">${lbl(d)} · ${n} h</button>`).join('') + '</div>' : '');
  }

  async function setDay(d) {
    S.day = d; pause(); S.data = await load(d);
    const inp = document.getElementById('rp-date'); if (inp) inp.value = d;
    const note = document.getElementById('rp-note');
    if (note) note.textContent = !S.data[S.mode].length ? (S.mode === 'prices' ? T('Pas de prix des écarts pour ce jour (collecte depuis août 2026). Essayez Production.', 'No imbalance prices for this day (collected since August 2026). Try Production.') : T('Pas de données RTE pour ce jour.', 'No RTE data for this day.')) : '';
    S.events = S.data[S.mode].length ? events(S.data, S.mode) : [];
    const ev = document.getElementById('rp-events');
    if (ev) ev.innerHTML = S.events.map(e => `<button type="button" class="rp-ev" data-q="${e.q}"><b>${e.n}</b><span class="cmp-dates">${hh(e.q)}</span><span>${e.txt}</span></button>`).join('');
    S.t = S.to; draw();
  }
  function controls() {
    const b = document.getElementById('rp-ctl'); if (!b) return;
    const pill = (g, v, t, on) => `<button type="button" class="cmp-pill${on ? ' on' : ''}" data-${g}="${v}">${t}</button>`;
    b.innerHTML = `<label class="cmp-dates">${T('Jour', 'Day')} <input type="date" id="rp-date" value="${S.day || ''}"></label>` +
      '<div class="cmp-grp">' + pill('mode', 'prices', T('Prix des écarts', 'Imbalance prices'), S.mode === 'prices') + pill('mode', 'production', T('Production', 'Production'), S.mode === 'production') + '</div>' +
      '<div class="cmp-grp">' + Object.keys(FORMATS).map(f => pill('fmt', f, f, S.fmt === f)).join('') + '</div>' +
      '<div class="cmp-grp">' + [['slow', T('Lent', 'Slow')], ['normal', T('Normal', 'Normal')], ['fast', T('Rapide', 'Fast')]].map(([v, t]) => pill('speed', v, t, S.speed === v)).join('') + '</div>' +
      `<label class="cmp-dates">${T('De', 'From')} <select id="rp-from">${Array.from({ length: 24 }, (_, h) => `<option value="${h * 4}"${S.from === h * 4 ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select> ${T('à', 'to')} <select id="rp-to">${Array.from({ length: 24 }, (_, h) => `<option value="${h * 4 + 3}"${S.to === h * 4 + 3 ? ' selected' : ''}>${String(h + 1).padStart(2, '0')}:00</option>`).join('')}</select></label>`;
  }
  function bind() {
    const root = document.getElementById('rp-root'); if (!root || root.dataset.bound) return; root.dataset.bound = '1';
    root.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.id === 'rp-play') { S.playing ? pause() : play(); return; }
      if (t.id === 'rp-export') { record(); return; }
      if (t.dataset.day) { S.mode = t.dataset.mode || S.mode; controls(); setDay(t.dataset.day); return; }
      if (t.dataset.mode) { S.mode = t.dataset.mode; controls(); setDay(S.day); return; }
      if (t.dataset.fmt) { S.fmt = t.dataset.fmt; controls(); draw(); return; }
      if (t.dataset.speed) { S.speed = t.dataset.speed; controls(); }
      if (t.dataset.q) { pause(); S.t = Math.max(S.from, Math.min(S.to, +t.dataset.q + 2)); draw(); }
    });
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'rp-date' && t.value) setDay(t.value);
      if (t.id === 'rp-from' || t.id === 'rp-to') { S.from = +document.getElementById('rp-from').value; S.to = Math.max(S.from + 3, +document.getElementById('rp-to').value); S.t = S.to; draw(); }
    });
    root.addEventListener('input', e => { if (e.target.id === 'rp-scrub') { pause(); S.t = Math.max(S.from, Math.min(S.to, +e.target.value)); draw(); } });
  }
  async function init() {
    bind();
    if (!S.day) { // default: the latest day with imbalance prices, else yesterday
      const m = new Date().toISOString().slice(0, 7), f = await json('imb' + m, `history/fr_imbalance_price/${m}.json`);
      const ks = f && f.days ? Object.keys(f.days).sort() : [];
      S.day = ks.length ? ks[ks.length - 1] : new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    }
    controls(); notable(); setDay(S.day);
  }
  window.PKReplay = { init, state: S, draw };
  if (window.PK && PK.onPage) PK.onPage('replay', init);

  const css = document.createElement('style');
  css.textContent = `
  .rp-wrap{display:flex;flex-direction:column;gap:14px}
  .rp-ctl{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .rp-ctl select{background:var(--bg);border:1px solid var(--border);color:var(--text);font-size:11px;padding:3px 6px;border-radius:4px}
  .rp-stage{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;justify-content:center}
  .rp-stage canvas{max-width:100%;max-height:72vh;width:auto;height:auto;border-radius:8px}
  .rp-bar{display:flex;align-items:center;gap:12px}
  .rp-bar input[type=range]{flex:1;accent-color:#14D3A9}
  .rp-days{display:flex;flex-direction:column;gap:8px}
  .rp-events{display:flex;flex-direction:column;gap:6px}
  .rp-ev{display:grid;grid-template-columns:26px 52px minmax(0,1fr);gap:10px;align-items:start;text-align:left;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text2);font:13px Inter,sans-serif;cursor:pointer}
  .rp-ev:hover{border-color:var(--accent)} .rp-ev b{display:inline-flex;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#0B1118;align-items:center;justify-content:center;font-size:12px}
  .rp-dg{display:flex;flex-wrap:wrap;gap:6px;align-items:center} .rp-dg b{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-right:4px}
  `;
  document.head.appendChild(css);
})();
