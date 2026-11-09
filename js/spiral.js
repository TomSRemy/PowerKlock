// ════════════════════════════════════════════════════════════════════
// spiral.js · "La Spirale" in Power system › Yearly review: every hourly French day-ahead price since 2019 on one
// 24-hour dial (1 day = 1 turn, 2019 at the centre, today at the edge), or laid flat (1 column = 1 day), in 2D or
// in relief (height = price). Filters that combine: years, hours, season, weekdays, period, price, output (solar, wind),
// events (2020 lockdown, 2021-22 crisis, summer 2022); figures of the selection: average, negative hours and their average, records.
// Data: data/history/fr_hourly/YYYY.json (scripts/build_fr_hourly.py, hourly = mean of the four quarter-hours since
// October 2025), rebuilt every day. Three.js is loaded only when the relief is opened (js/vendor/three.module.min.js).
// Mock-up validated by Tom on 7 Nov. 2026.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const BASE = () => (typeof DATA_BASE !== 'undefined' ? DATA_BASE : 'data/');
  const Y0 = 2019;
  let DATA = null, loading = null;

  // ── data: one value per hour from 1 Jan 2019 to the last published day, plus solar and wind for the tooltip ──
  function load() {
    if (DATA) return Promise.resolve(DATA);
    if (loading) return loading;
    const yNow = new Date().getUTCFullYear() + 1, years = [];
    for (let y = Y0; y <= yNow; y++) years.push(y);
    loading = Promise.all(years.map(y => fetch(BASE() + 'history/fr_hourly/' + y + '.json').then(r => r.ok ? r.json() : null).catch(() => null))).then(files => {
      const all = {};
      files.forEach(f => { if (f && f.days) Object.assign(all, f.days); });
      const keys = Object.keys(all).filter(k => k >= Y0 + '-01-01' && all[k] && all[k].p && all[k].p.some(v => v != null)).sort();
      if (!keys.length) return null;
      const d0 = Date.parse(keys[0] + 'T00:00:00Z'), dN = Date.parse(keys[keys.length - 1] + 'T00:00:00Z'), n = Math.round((dN - d0) / 864e5) + 1;
      const v = new Float32Array(n * 24).fill(NaN), sol = new Float32Array(n * 24).fill(NaN), win = new Float32Array(n * 24).fill(NaN);
      for (const k of keys) {
        const d = Math.round((Date.parse(k + 'T00:00:00Z') - d0) / 864e5), o = all[k];
        for (let h = 0; h < 24; h++) {
          const p = o.p[h];
          v[d * 24 + h] = p == null ? NaN : p;
          if (o.s && o.s[h] != null) sol[d * 24 + h] = o.s[h];
          if (o.w && o.w[h] != null) win[d * 24 + h] = o.w[h];
        }
      }
      // a missing hour (the 23-hour day in March) takes its neighbours' mean, so the dial has no hole
      for (let i = 0; i < v.length; i++) if (isNaN(v[i])) { const a = v[i - 1], b = v[i + 1]; v[i] = !isNaN(a) && !isNaN(b) ? (a + b) / 2 : !isNaN(a) ? a : !isNaN(b) ? b : 0; }
      DATA = { d0, n, v, sol, win, first: keys[0], last: keys[keys.length - 1] };
      return DATA;
    });
    return loading;
  }

  // ── colour: cyan below 0, the page's background for ordinary prices, amber then red then white-hot above ──
  const light = () => document.documentElement.getAttribute('data-theme') === 'light';
  function col(v) {
    let r, g, b; const L = light();
    if (v < 0) { const t = Math.min(1, Math.pow(-v / 120, 0.5)); r = 0; g = 150 + 79 * t; b = 190 + 65 * t; if (v < -150) { const u = Math.min(1, (-v - 150) / 300); r = 220 * u; g = 229 + 26 * u; b = 255; } if (L) { g -= 40; b -= 30; } }
    else if (v < 60) { const t = v / 60; if (L) { r = 226 - 26 * t; g = 232 - 22 * t; b = 240 - 16 * t; } else { r = 20 + 20 * t; g = 28 + 30 * t; b = 44 + 40 * t; } }
    else if (v < 150) { const t = (v - 60) / 90; const s = L ? [200, 210, 224] : [40, 58, 84]; r = s[0] + (150 - s[0]) * t + (L ? 50 * t : 0); g = s[1] + (105 - s[1]) * t; b = s[2] + (40 - s[2]) * t; }
    else if (v < 500) { const t = Math.log(v / 150) / Math.log(500 / 150); r = 255; g = 176 - 117 * t; b = 48 * t; if (t < 0.15) { const u = t / 0.15; r = 150 + 105 * u; g = 105 + 71 * u; b = 40 - 40 * u; } }
    else { const t = Math.min(1, Math.log(v / 500) / Math.log(6)); r = 255; g = 59 + 196 * t; b = 48 + 207 * t; if (L) { g = 59 - 20 * t; b = 48 - 10 * t; r = 220 - 60 * t; } }
    return [r | 0, g | 0, b | 0];
  }

  const fmtN = (v, d = 1) => (v < 0 ? '−' : '') + Math.abs(v).toLocaleString(T('fr-FR', 'en-GB'), { minimumFractionDigits: d, maximumFractionDigits: d });
  const dayDate = (D, d) => new Date(D.d0 + d * 864e5);
  const fmtD = (D, d) => dayDate(D, d).toLocaleDateString(T('fr-FR', 'en-GB'), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  // ── one instance per mount (the review re-renders its page when the year changes) ──
  function mount(host, opts) {
    if (!host) return;
    const year = String((opts && opts.year) || ''), widget = !!(opts && opts.widget);
    host.innerHTML = (widget ? '' : `<div class="bl-t"><h2>${T('La Spirale · tous les prix horaires depuis 2019', 'The Spiral · every hourly price since 2019')}</h2><span class="bl-src">ENTSO-E day-ahead · €/MWh · ${T('moyenne horaire des quarts d’heure depuis oct. 2025', 'hourly mean of the quarter-hours since Oct. 2025')}</span></div>
      <p class="bl-foot" style="margin:0">${T('Une horloge de 24 heures : chaque tour est un jour, 2019 au centre, le dernier jour publié au bord. Le cyan est un prix négatif, l’ambre puis le rouge un prix élevé. Le creux cyan de midi qui grandit, c’est le solaire ; l’anneau rouge, la crise de 2021-2022.', 'A 24-hour clock: each turn is a day, 2019 at the centre, the last published day at the edge. Cyan is a negative price, amber then red a high one. The growing cyan hollow at noon is solar; the red ring is the 2021-22 crisis.')}</p>`) + `
      <div class="sp-wrap${widget ? ' sp-widget' : ''}"><div class="sp-grid"><div class="sp-stage"><canvas class="sp-cv"></canvas><canvas class="sp-ov"></canvas><div class="sp-g3"></div><div class="sp-tip"></div><div class="sp-hint"></div></div>
        <div class="sp-side">
          <div class="sp-sel" data-k="sel"></div>
          <div class="sp-k"><span class="sp-kl">${T('Prix moyen', 'Average price')}</span><span class="sp-kv" data-k="avg">–</span><span class="sp-ks" data-k="avgs"></span></div>
          <div class="sp-k"><span class="sp-kl">${T('Prix moyen des heures négatives', 'Average of the negative hours')}</span><span class="sp-kv sp-cy" data-k="navg">–</span><span class="sp-ks" data-k="navgs"></span></div>
          <div class="sp-k"><span class="sp-kl">${T('Record bas', 'Record low')}</span><span class="sp-kv sp-cy" data-k="min">–</span><span class="sp-ks" data-k="mins"></span></div>
          <div class="sp-k"><span class="sp-kl">${T('Record haut', 'Record high')}</span><span class="sp-kv sp-rd" data-k="max">–</span><span class="sp-ks" data-k="maxs"></span></div>
          <div class="sp-k sp-k-neg"><span class="sp-kl">${T('Heures négatives', 'Negative hours')}</span><span class="sp-kv sp-cy" data-k="neg">–</span><span class="sp-ks" data-k="negs"></span></div>
          <div class="sp-f">
            <div class="sp-fh"><span>${T('Filtres', 'Filters')}</span><button type="button" data-a="reset">${T('Tout réinitialiser', 'Reset all')}</button></div>
            <div class="sp-fg"><span class="sp-fl">${T('Années', 'Years')}</span><div class="sp-btns">${Array.from({ length: new Date().getUTCFullYear() - Y0 + 1 }, (_, i) => Y0 + i).map(y => `<button type="button" data-g="y" data-v="${y}">${y}</button>`).join('')}</div></div>
            <div class="sp-fg"><span class="sp-fl">${T('Heures', 'Hours')}</span><div class="sp-btns"><button type="button" data-g="hp" data-v="nuit">${T('Nuit 0–6 h', 'Night 0–6')}</button><button type="button" data-g="hp" data-v="midi">${T('Midi solaire 11–15 h', 'Solar noon 11–15')}</button><button type="button" data-g="hp" data-v="soir">${T('Pointe du soir 18–21 h', 'Evening peak 18–21')}</button><button type="button" data-g="hp" data-v="hp">${T('Heures pleines 6–22 h', 'Peak hours 6–22')}</button><button type="button" data-g="hp" data-v="hc">${T('Heures creuses 22–6 h', 'Off-peak 22–6')}</button></div>
              <div class="sp-range"><input type="range" min="0" max="23" step="1" value="0" data-r="h0" aria-label="${T('De', 'From')}"><input type="range" min="1" max="24" step="1" value="24" data-r="h1" aria-label="${T('À', 'To')}"><output data-k="hr">0 h → 24 h</output></div></div>
            <div class="sp-fg"><span class="sp-fl">${T('Saison', 'Season')}</span><div class="sp-btns"><button type="button" data-g="se" data-v="w">${T('Hiver', 'Winter')}</button><button type="button" data-g="se" data-v="sp">${T('Printemps', 'Spring')}</button><button type="button" data-g="se" data-v="su">${T('Été', 'Summer')}</button><button type="button" data-g="se" data-v="a">${T('Automne', 'Autumn')}</button></div></div>
            <div class="sp-fg"><span class="sp-fl">${T('Jours', 'Days')}</span><div class="sp-btns"><button type="button" data-g="dy" data-v="wd">${T('Lun.–ven.', 'Mon–Fri')}</button><button type="button" data-g="dy" data-v="we">${T('Week-end', 'Weekend')}</button></div></div>
            <div class="sp-fg"><span class="sp-fl">${T('Période', 'Period')}</span><div class="sp-dates"><input type="date" data-r="from" aria-label="${T('Du', 'From')}"><span>→</span><input type="date" data-r="to" aria-label="${T('Au', 'To')}"></div></div>
            <div class="sp-fg"><span class="sp-fl">${T('Prix', 'Price')}</span><div class="sp-btns"><button type="button" data-g="pr" data-v="neg">&lt; 0 €</button><button type="button" data-g="pr" data-v="gt200">&gt; 200 €</button><button type="button" data-g="pr" data-v="top1">${T('Top 1 % les plus chères', 'Dearest 1 %')}</button></div>
              <div class="sp-dates"><input type="number" step="10" data-r="pmin" placeholder="${T('min €', 'min €')}" aria-label="${T('Prix minimum', 'Minimum price')}"><span>→</span><input type="number" step="10" data-r="pmax" placeholder="${T('max €', 'max €')}" aria-label="${T('Prix maximum', 'Maximum price')}"></div></div>
            <div class="sp-fg"><span class="sp-fl">${T('Production', 'Output')}</span><div class="sp-btns"><button type="button" data-g="pd" data-v="sol">${T('Solaire > 15 GW', 'Solar > 15 GW')}</button><button type="button" data-g="pd" data-v="win">${T('Éolien > 15 GW', 'Wind > 15 GW')}</button><button type="button" data-g="pd" data-v="calm">${T('Ni vent ni soleil', 'No wind, no sun')}</button></div></div>
            <div class="sp-fg"><span class="sp-fl">${T('Événements', 'Events')}</span><div class="sp-btns"><button type="button" data-g="ev" data-v="lock">${T('Confinement 2020', '2020 lockdown')}</button><button type="button" data-g="ev" data-v="crise">${T('Crise 2021-22', '2021-22 crisis')}</button><button type="button" data-g="ev" data-v="ete22">${T('Été 2022', 'Summer 2022')}</button></div></div>
          </div>
          <div class="sp-btns"><button type="button" class="sp-alt" data-a="lin">${T('Linéaire', 'Linear')}</button><button type="button" class="sp-alt" data-a="3d">3D</button><button type="button" data-a="replay">↺ ${T('Rejouer', 'Replay')}</button><button type="button" data-a="full" aria-pressed="false">⤢ ${T('Plein écran', 'Full screen')}</button></div>
          <div class="sp-leg"><i></i><div class="sp-tk">${[[-200, 0], [0, 4], [60, 6], [150, 8], [500, 11]].map(([v, k]) => `<span style="left:${(k / 12 * 100).toFixed(1)}%">${v < 0 ? '−' + -v : v}${v === 500 ? '+' : ''}</span>`).join('')}<span class="u">€/MWh</span></div></div>
          ${widget ? '' : `<p class="bl-foot sp-note">${T('Rayon proportionnel au temps : chaque année a la même épaisseur ; une sélection de dates (années, période, événement) remplit tout le cadran. En relief, hauteur en échelle logarithmique. Les heures négatives sont comptées sur la moyenne horaire ; le bilan les compte sur les pas publiés (quart d’heure depuis octobre 2025).', 'Radius in proportion to time: every year has the same thickness; a date selection (years, period, event) fills the whole dial. In relief, height on a log scale. Negative hours are counted on the hourly mean; the review counts them on the published steps (quarter-hour since October 2025).')}</p>`}
        </div></div></div>`;
    const $ = s => host.querySelector(s);
    const stage = $('.sp-stage'), cv = $('.sp-cv'), ov = $('.sp-ov'), g3 = $('.sp-g3'), tip = $('.sp-tip'), hint = $('.sp-hint');
    const ctx = cv.getContext('2d'), octx = ov.getContext('2d');
    $('.sp-leg i').style.background = 'linear-gradient(90deg,' + [-200, -100, -30, -1, 0, 30, 60, 100, 150, 250, 400, 500, 1500].map(v => `rgb(${col(v)})`).join(',') + ')';
    let FS = 12, OFF = 15, D, N, S, DPR, CX, CY, R0, R1, LX0, LX1, LY0, LY1, img, lin = false, on3 = false, P0 = 1, raf = 0, t0 = null;
    const val = (d, h) => D.v[d * 24 + h];
    // F: years, hours (24 flags), seasons, days, period (day indices), price (mode, min, max), output, events
    const F = { y: new Set(), hs: Array(24).fill(true), se: new Set(), dy: '', d0: -1, d1: 1e9, pr: new Set(), pmin: NaN, pmax: NaN, pd: new Set(), ev: new Set() };
    let DY, DM, DW, P99 = Infinity, EV = {};
    const SEASON = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0];   // Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov autumn
    const SE_K = ['w', 'sp', 'su', 'a'];
    const iso2d = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - D.d0) / 864e5);
    let DAVG, MAVG;
    function calendar() {   // once per data load: each day's year, month, weekday, mean; each month's mean; the 99th percentile; the events
      DY = new Int16Array(N); DM = new Int8Array(N); DW = new Int8Array(N);
      for (let d = 0; d < N; d++) { const t = dayDate(D, d); DY[d] = t.getUTCFullYear(); DM[d] = t.getUTCMonth(); DW[d] = t.getUTCDay(); }
      DAVG = new Float32Array(N); MAVG = new Map(); const ms = new Map();
      for (let d = 0; d < N; d++) { let a = 0; for (let h = 0; h < 24; h++) a += D.v[d * 24 + h]; DAVG[d] = a / 24;
        const k = DY[d] * 12 + DM[d], o = ms.get(k) || [0, 0]; o[0] += DAVG[d]; o[1]++; ms.set(k, o); }
      ms.forEach((o, k) => MAVG.set(k, o[0] / o[1]));
      const all = Array.from(D.v).filter(v => !isNaN(v)).sort((a, b) => a - b); P99 = all[Math.floor(all.length * 0.99)];
      // France's first lockdown: 17 March to 10 May 2020 (lifted on 11 May); the 2021-22 crisis: Sept. 2021 to Dec. 2022; summer 2022: June to August
      EV = { lock: [iso2d('2020-03-17'), iso2d('2020-05-10')], crise: [iso2d('2021-09-01'), iso2d('2022-12-31')], ete22: [iso2d('2022-06-01'), iso2d('2022-08-31')] };
    }
    const keep = (d, h, v) => {
      if (!F.hs[h]) return false;
      if (d < F.d0 || d > F.d1) return false;
      if (F.y.size && !F.y.has(DY[d])) return false;
      if (F.se.size && !F.se.has(SE_K[SEASON[DM[d]]])) return false;
      if (F.dy === 'wd' && (DW[d] === 0 || DW[d] === 6)) return false;
      if (F.dy === 'we' && DW[d] !== 0 && DW[d] !== 6) return false;
      if (F.pr.size && !((F.pr.has('neg') && v < 0) || (F.pr.has('gt200') && v > 200) || (F.pr.has('top1') && v >= P99))) return false;
      if (!isNaN(F.pmin) && v < F.pmin) return false;
      if (!isNaN(F.pmax) && v > F.pmax) return false;
      if (F.pd.size) { const i = d * 24 + h, so = D.sol[i], wi = D.win[i];
        if (F.pd.has('sol') && !(so >= 15000)) return false;
        if (F.pd.has('win') && !(wi >= 15000)) return false;
        if (F.pd.has('calm') && !(so < 2000 && wi < 5000)) return false; }
      if (F.ev.size && ![...F.ev].some(k => EV[k] && d >= EV[k][0] && d <= EV[k][1])) return false;
      return true;
    };
    // radius in proportion to time: every year has the same thickness. VW0..VW0+VWN is the window shown: every day, or only
    // the span of a selection that limits the dates (years, period, events), which then fills the whole dial
    let VW0 = 0, VWN = 1;
    const tOfR = r => VW0 + (r - R0) / (R1 - R0) * VWN, rOfT = t => R0 + (R1 - R0) * Math.max(0, Math.min(1, (t - VW0) / VWN));
    function hit(x, y) {
      if (lin) { if (x < LX0 || x >= LX1 || y < LY0 || y >= LY1) return null; return [VW0 + Math.floor((x - LX0) / (LX1 - LX0) * VWN), Math.floor((y - LY0) / (LY1 - LY0) * 24)]; }
      const dx = x - CX, dy = y - CY, r = Math.hypot(dx, dy); if (r < R0 || r > R1) return null;
      let a = Math.atan2(dx, -dy); if (a < 0) a += 2 * Math.PI; const d = Math.floor(tOfR(r)); if (d < VW0 || d >= VW0 + VWN || d >= N) return null;
      return [d, Math.floor(a / (2 * Math.PI) * 24 + 0.5) % 24];   // each hour's wedge is centred on its label
    }
    function size() {
      DPR = Math.min(2, window.devicePixelRatio || 1); const b = stage.getBoundingClientRect(); S = Math.max(240, Math.floor(b.width));
      [cv, ov].forEach(c => { c.width = S * DPR; c.height = S * DPR; c.style.width = c.style.height = S + 'px'; });
      // the hours sit outside the dial: their size and gap first, then the dial takes the room that is left
      FS = Math.max(10, Math.min(18, S / 36)); OFF = Math.min(26, S * 0.05) * DPR;
      CX = CY = S * DPR / 2; R1 = Math.min(S * DPR * 0.44, S * DPR / 2 - OFF - (FS + 3) * DPR * 1.25); R0 = S * DPR * 0.05; LX0 = S * DPR * 0.1; LX1 = S * DPR * 0.98; LY0 = S * DPR * 0.16; LY1 = S * DPR * 0.84;
    }
    // each hour's colour once, the selected ones bright and the others close to the background (2. the selection stands out)
    let CR, CG, CB;
    function colours() {
      const bg = light() ? [255, 255, 255] : [15, 20, 25]; CR = new Uint8ClampedArray(N * 24); CG = new Uint8ClampedArray(N * 24); CB = new Uint8ClampedArray(N * 24);
      for (let d = 0; d < N; d++) for (let h = 0; h < 24; h++) { const i = d * 24 + h, v = D.v[i]; let [r, g, b] = col(v);
        if (!keep(d, h, v)) { const m2 = (r + g + b) / 3; r = bg[0] * 0.9 + m2 * 0.1; g = bg[1] * 0.9 + m2 * 0.1; b = bg[2] * 0.9 + m2 * 0.1; }
        CR[i] = r; CG[i] = g; CB[i] = b; }
    }
    function build() {
      colours();
      const W = cv.width; img = ctx.createImageData(W, W); const P = img.data;
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        let dA, dB, h;
        if (lin) { if (x < LX0 || x >= LX1 || y < LY0 || y >= LY1) continue; h = Math.floor((y - LY0) / (LY1 - LY0) * 24);
          dA = VW0 + Math.floor((x - LX0) / (LX1 - LX0) * VWN); dB = VW0 + Math.floor((x + 1 - LX0) / (LX1 - LX0) * VWN - 1e-9); }
        else { const dx = x + 0.5 - CX, dy = y + 0.5 - CY, r = Math.hypot(dx, dy); if (r < R0 || r > R1) continue;
          let a = Math.atan2(dx, -dy); if (a < 0) a += 2 * Math.PI; h = Math.floor(a / (2 * Math.PI) * 24 + 0.5) % 24;
          dA = Math.floor(tOfR(Math.max(R0, r - 0.5))); dB = Math.floor(tOfR(Math.min(R1, r + 0.5)) - 1e-9); }
        dA = Math.max(VW0, Math.min(N - 1, dA)); dB = Math.max(dA, Math.min(N - 1, VW0 + VWN - 1, dB));
        // the mean of the days under the pixel (at most 16 of them, evenly spaced)
        const n = dB - dA + 1, st = Math.max(1, Math.floor(n / 16)); let r2 = 0, g2 = 0, b2 = 0, k = 0;
        for (let d = dA; d <= dB; d += st) { const i = d * 24 + h; r2 += CR[i]; g2 += CG[i]; b2 += CB[i]; k++; }
        const o = (y * W + x) * 4; P[o] = r2 / k; P[o + 1] = g2 / k; P[o + 2] = b2 / k; P[o + 3] = 255;
      }
      cv.dataset.pkDrawn = '1';
    }
    const txt = () => light() ? ['#1F2D3D', '#5E6B80', '#8DA3BA'] : ['#E8EDF5', '#9AA7BA', '#5E6B80'];
    function axes(p) {
      octx.clearRect(0, 0, ov.width, ov.height); const f = DPR, [t1, t2, t3] = txt();
      octx.font = `600 ${11 * f}px Inter,system-ui,sans-serif`;
      if (lin) {
        octx.textAlign = 'right'; octx.textBaseline = 'middle';
        const fs = Math.max(11, Math.min(16, S / 40));
        for (let h = 0; h < 24; h += 3) { const main = h % 6 === 0; octx.font = `${main ? 800 : 600} ${(main ? fs + 2 : fs) * f}px Inter,system-ui,sans-serif`; octx.fillStyle = main ? t1 : t2; octx.fillText(h + ' h', LX0 - 6 * f, LY0 + (LY1 - LY0) * (h + 0.5) / 24); }
        octx.textAlign = 'center'; octx.textBaseline = 'top'; octx.font = `700 ${10 * f}px 'JetBrains Mono',monospace`;
        for (let y = Y0; y <= dayDate(D, N - 1).getUTCFullYear(); y++) { const t = (Date.UTC(y, 6, 1) - D.d0) / 864e5; if (t < VW0 || t > VW0 + VWN) continue; octx.fillStyle = t2; octx.fillText(y, LX0 + (LX1 - LX0) * (t - VW0) / VWN, LY1 + 8 * f); }
        return;
      }
      octx.textAlign = 'center'; octx.textBaseline = 'middle';
      // the hours scale with the dial: 0, 6, 12 and 18 h larger and bright, the others readable but quieter
      const fs = FS, off = OFF;
      for (let h = 0; h < 24; h++) { const a = h / 24 * 2 * Math.PI, r = R1 + off, main = h % 6 === 0;
        octx.font = `${main ? 800 : 600} ${(main ? fs + 3 : fs) * f}px Inter,system-ui,sans-serif`; octx.fillStyle = main ? t1 : t2; octx.fillText(h + ' h', CX + Math.sin(a) * r, CY - Math.cos(a) * r); }
      // spokes every 3 hours, the four main ones stronger, to follow an hour across the years
      for (let h = 0; h < 24; h += 3) { const a = h / 24 * 2 * Math.PI, main = h % 6 === 0;
        octx.strokeStyle = light() ? `rgba(31,45,61,${main ? .35 : .18})` : `rgba(232,237,245,${main ? .28 : .13})`; octx.lineWidth = (main ? 1.4 : 1) * f;
        octx.beginPath(); octx.moveTo(CX + Math.sin(a) * R0, CY - Math.cos(a) * R0); octx.lineTo(CX + Math.sin(a) * R1, CY - Math.cos(a) * R1); octx.stroke(); }
      // each 1 January a solid ring, its year written on the 0 h axis (the ring's own top), on a small plate
      octx.font = `700 ${Math.max(10, Math.min(13, S / 60)) * f}px 'JetBrains Mono',monospace`;
      const y0w = dayDate(D, VW0).getUTCFullYear(), y1w = dayDate(D, Math.min(N - 1, VW0 + VWN - 1)).getUTCFullYear();
      for (let y = y0w; y <= y1w + 1; y++) {
        const t = (Date.UTC(y, 0, 1) - D.d0) / 864e5; if (t <= VW0 || t >= VW0 + VWN || t > VW0 + p * VWN) continue; const r = rOfT(t);
        octx.strokeStyle = light() ? 'rgba(31,45,61,.45)' : 'rgba(232,237,245,.38)'; octx.lineWidth = 1.2 * f; octx.beginPath(); octx.arc(CX, CY, r, 0, 2 * Math.PI); octx.stroke();
      }
      for (let y = y0w; y <= y1w; y++) {   // the year in the middle of its band, on the 0 h spoke
        const ta = Math.max(VW0, (Date.UTC(y, 0, 1) - D.d0) / 864e5), tb = Math.min(VW0 + VWN, (Date.UTC(y + 1, 0, 1) - D.d0) / 864e5); if (tb <= ta || ta > VW0 + p * VWN) continue;
        const r = rOfT((ta + tb) / 2), yy = CY - r, w = 40 * f, hh = 16 * f;
        octx.fillStyle = light() ? 'rgba(255,255,255,.9)' : 'rgba(15,20,25,.88)'; octx.fillRect(CX - w / 2, yy - hh / 2, w, hh); octx.fillStyle = t1; octx.fillText(String(y), CX, yy);
      }
    }
    // figures follow the reveal
    let NEG, RMIN, RMAX;
    // the figures count only the hours of the selection (all, negative hours, the 2022 crisis, midday vs evening, the year)
    let F0 = 0, F1 = 0, CNT, SUM, NSUM;
    function prep() {
      NEG = new Int32Array(N); CNT = new Int32Array(N); SUM = new Float64Array(N); NSUM = new Float64Array(N); RMIN = []; RMAX = [];
      let c = 0, k = 0, sm = 0, ns = 0, lo = [1e9, 0, 0], hi = [-1e9, 0, 0]; F0 = -1;
      for (let d = 0; d < N; d++) { for (let h = 0; h < 24; h++) { const v = val(d, h); if (isNaN(v) || !keep(d, h, v)) continue; if (F0 < 0) F0 = d; F1 = d;
        k++; sm += v; if (v < 0) { c++; ns += v; } if (v < lo[0]) lo = [v, d, h]; if (v > hi[0]) hi = [v, d, h]; }
        NEG[d] = c; CNT[d] = k; SUM[d] = sm; NSUM[d] = ns; RMIN.push(lo); RMAX.push(hi); }
      if (F0 < 0) F0 = 0;
      const dated = F.y.size || F.d0 >= 0 || F.d1 < 1e9 || F.ev.size;
      if (dated && F1 >= F0) { VW0 = F0; VWN = F1 - F0 + 1; } else { VW0 = 0; VWN = N; }
    }
    function kpis(p) {
      // (the relief's first frame can come with a negative time)
      const d = Math.max(0, Math.min(N - 1, VW0 + Math.floor((p > 0 ? p : 0) * VWN))), lo = RMIN[d], hi = RMAX[d], set = (k, s) => { const e = host.querySelector(`[data-k="${k}"]`); if (e) e.textContent = s; };
      const none = lo[0] === 1e9;
      set('neg', NEG[d].toLocaleString(T('fr-FR', 'en-GB')) + ' h'); set('negs', d < F0 ? '' : `${fmtD(D, F0)} → ${fmtD(D, Math.min(d, F1))}`);
      set('avg', CNT[d] ? fmtN(SUM[d] / CNT[d]) + ' €' : '–'); set('avgs', CNT[d] ? CNT[d].toLocaleString(T('fr-FR', 'en-GB')) + ' ' + T('heures', 'hours') : '');
      set('navg', NEG[d] ? fmtN(NSUM[d] / NEG[d]) + ' €' : '–'); set('navgs', NEG[d] ? T('sur ', 'over ') + NEG[d].toLocaleString(T('fr-FR', 'en-GB')) + ' h' : '');
      set('min', none ? '–' : fmtN(lo[0]) + ' €'); set('mins', none ? '' : `${fmtD(D, lo[1])} · ${String(lo[2]).padStart(2, '0')} h`);
      const noHi = none || (F.pr.size === 1 && F.pr.has('neg')) || F.pmax < 0;   // among negative hours a « record high » would only be the one closest to zero
      set('max', noHi ? '–' : fmtN(hi[0]) + ' €'); set('maxs', noHi ? '' : `${fmtD(D, hi[1])} · ${String(hi[2]).padStart(2, '0')} h`);
    }
    function draw(p) {
      const W = cv.width; ctx.clearRect(0, 0, W, W); ctx.putImageData(img, 0, 0);
      if (p < 1) {
        ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.beginPath();
        if (lin) ctx.rect(0, 0, LX0 + (LX1 - LX0) * p, W); else ctx.arc(CX, CY, rOfT(VW0 + p * VWN), 0, 2 * Math.PI);
        ctx.fill(); ctx.restore();
        ctx.strokeStyle = '#FFD23F'; ctx.lineWidth = 2 * DPR; ctx.beginPath();
        if (lin) { const x = LX0 + (LX1 - LX0) * p; ctx.moveTo(x, LY0); ctx.lineTo(x, LY1); } else ctx.arc(CX, CY, rOfT(VW0 + p * VWN), 0, 2 * Math.PI);
        ctx.stroke();
      }
      axes(p); kpis(p);
    }
    function play() { cancelAnimationFrame(raf); t0 = null; const step = ts => { if (!host.isConnected) return; if (t0 === null) t0 = ts; const u = Math.min(1, (ts - t0) / 8000); P0 = 1 - Math.pow(1 - u, 2.2); draw(P0); if (u < 1) raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); }

    // hover: the hour and the day under the pointer
    ov.addEventListener('pointermove', e => {
      if (on3) return; const b = ov.getBoundingClientRect(), x = (e.clientX - b.left) * DPR, y = (e.clientY - b.top) * DPR, q = hit(x, y);
      if (!q || P0 < 1) { tip.style.opacity = 0; if (P0 >= 1) draw(1); return; }
      const [d, h] = q, v = val(d, h); draw(1);
      octx.strokeStyle = '#FFD23F'; octx.lineWidth = 2 * DPR; octx.beginPath();
      if (lin) { const yy = LY0 + (LY1 - LY0) * (h + 0.5) / 24, xx = LX0 + (LX1 - LX0) * (d + 0.5 - VW0) / VWN; octx.moveTo(LX0, yy); octx.lineTo(LX1, yy); octx.stroke(); octx.lineWidth = DPR; octx.beginPath(); octx.moveTo(xx, LY0); octx.lineTo(xx, LY1); octx.stroke(); }
      else { const a = h / 24 * 2 * Math.PI; octx.moveTo(CX, CY); octx.lineTo(CX + Math.sin(a) * R1, CY - Math.cos(a) * R1); octx.stroke(); octx.lineWidth = DPR; octx.beginPath(); octx.arc(CX, CY, rOfT(d + 0.5), 0, 2 * Math.PI); octx.stroke(); }
      const s = D.sol[d * 24 + h], w = D.win[d * 24 + h];
      tip.innerHTML = `${fmtD(D, d)} · ${String(h).padStart(2, '0')} h<b class="${v < 0 ? 'sp-cy' : v > 150 ? 'sp-rd' : v > 60 ? 'sp-am' : ''}">${fmtN(v)} €/MWh</b>${!isNaN(s) || !isNaN(w) ? `<small>${T('solaire', 'solar')} ${isNaN(s) ? '–' : fmtN(s / 1000)} GW · ${T('éolien', 'wind')} ${isNaN(w) ? '–' : fmtN(w / 1000)} GW</small>` : ''}` + (() => { const mv = MAVG.get(DY[d] * 12 + DM[d]); return `<small>${T('moyenne du jour', 'day average')} ${fmtN(DAVG[d])} € · ${T('écart au mois', 'vs the month')} ${(DAVG[d] - mv >= 0 ? '+' : '')}${fmtN(DAVG[d] - mv)} €</small>`; })();
      const sb = stage.getBoundingClientRect(); let lx = e.clientX - sb.left + 14; if (lx > sb.width - 190) lx -= 210;
      tip.style.left = lx + 'px'; tip.style.top = (e.clientY - sb.top + 14) + 'px'; tip.style.opacity = 1;
    });
    ov.addEventListener('pointerleave', () => { tip.style.opacity = 0; if (P0 >= 1) draw(1); });

    // ── relief (Three.js, loaded on first use) ──
    let TH = null, R3 = null;
    async function relief(onOff) {
      on3 = onOff; host.querySelector('.sp-wrap').classList.toggle('sp-3d', on3); g3.style.display = on3 ? 'block' : 'none'; cv.style.visibility = ov.style.visibility = on3 ? 'hidden' : 'visible';
      hint.textContent = on3 ? T('Glisser pour tourner · molette ou pincer pour zoomer · creux = prix négatif', 'Drag to turn · wheel or pinch to zoom · hollows = negative prices') : '';
      if (!on3) return;
      if (!TH) { try { TH = await import(new URL('vendor/three.module.min.js', document.querySelector('script[src*="spiral.js"]').src).href); } catch (e) { hint.textContent = T('Relief indisponible sur ce navigateur.', 'Relief not available in this browser.'); return; } }
      if (!R3) R3 = make3D(TH); else { R3.layout(); R3.grow(); }
    }
    function make3D(THREE) {
      const ren = new THREE.WebGLRenderer({ antialias: true }); ren.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); g3.appendChild(ren.domElement);
      const scene = new THREE.Scene(), bgc = light() ? 0xffffff : 0x0f1419; scene.background = new THREE.Color(bgc); scene.fog = new THREE.Fog(bgc, 5, 10);
      const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
      const A = 48, rows = N, n = rows * (A + 1), pos = new Float32Array(n * 3), colr = new Float32Array(n * 3), SP = new Float32Array(n * 3), LP = new Float32Array(n * 3), VV = new Float32Array(n), HH = new Uint8Array(n), YY = new Float32Array(n), idx = new Uint32Array((rows - 1) * A * 6);
      const hOf = v => Math.sign(v) * Math.log1p(Math.abs(v) / 40) * 0.09;
      const vAt = (d, a) => { const hf = a / A * 24 - 0.5, h0 = Math.floor(hf), f = hf - h0; const g = h => { let dd = d, hh = h; if (hh < 0) { hh += 24; dd--; } if (hh > 23) { hh -= 24; dd++; } dd = Math.max(0, Math.min(N - 1, dd)); return val(dd, hh); }; return g(h0) * (1 - f) + g(h0 + 1) * f; };
      for (let d = 0; d < rows; d++) { const r = 0.12 + 0.88 * ((d + 0.5) / N); for (let a = 0; a <= A; a++) { const j = d * (A + 1) + a, i = j * 3, th = a / A * 2 * Math.PI, v = vAt(d, a % A);
        SP[i] = Math.sin(th) * r; SP[i + 2] = -Math.cos(th) * r; LP[i] = ((d + 0.5) / N - 0.5) * 2.6; LP[i + 2] = (a / A - 0.5) * 1.0; VV[j] = v; HH[j] = Math.floor((a % A) / A * 24); YY[j] = hOf(v); } }
      let k = 0; for (let d = 0; d < rows - 1; d++) for (let a = 0; a < A; a++) { const p = d * (A + 1) + a, q = p + A + 1; idx[k++] = p; idx[k++] = q; idx[k++] = p + 1; idx[k++] = p + 1; idx[k++] = q; idx[k++] = q + 1; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colr, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
      mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance=vColor.rgb*0.35;'); };
      const mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
      scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x101820, 0.55)); const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(1.5, 3, 1); scene.add(key);
      const disc = new THREE.Mesh(new THREE.RingGeometry(0.12, 1.02, 128), new THREE.MeshBasicMaterial({ color: 0x00E5FF, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false })); disc.rotation.x = -Math.PI / 2; scene.add(disc);
      const lab = (t, x, y, z, c) => { const q = document.createElement('canvas'); q.width = 128; q.height = 48; const g = q.getContext('2d'); g.font = '600 26px Inter,system-ui'; g.fillStyle = c; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 64, 24);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(q), transparent: true, depthWrite: false })); s.position.set(x, y, z); s.scale.set(0.16, 0.06, 1); scene.add(s); return s; };
      const [t1, t2, t3] = txt();
      const dial = []; for (let h = 0; h < 24; h += 3) { const th = h / 24 * 2 * Math.PI; dial.push(lab(h + ' h', Math.sin(th) * 1.12, 0, -Math.cos(th) * 1.12, h % 6 ? t3 : t1)); }
      const flat = []; for (let h = 0; h <= 24; h += 6) flat.push(lab(h + ' h', -1.42, 0, (h / 24 - 0.5), t2));
      for (let y = Y0; y <= dayDate(D, N - 1).getUTCFullYear(); y++) { const t = (Date.UTC(y, 6, 1) - D.d0) / 864e5; if (t < N) flat.push(lab(String(y), (Math.max(0, t) / N - 0.5) * 2.6, 0, 0.62, t2)); }
      const recs = [RMAX[N - 1], RMIN[N - 1]].map(([v, d, h], i) => { const c = i ? '#00E5FF' : '#FF3B30', y = hOf(v), up = y > 0 ? 0.12 : -0.12;
        const pt = new THREE.Vector3(), line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pt, pt.clone()]), new THREE.LineBasicMaterial({ color: c })); scene.add(line);
        const s = lab(fmtN(v, 0) + ' €', 0, 0, 0, c); return { d, h, y, up, line, s }; });
      let az = 0, el = 0.55, dist = 2.75, auto = true, g0 = 0;
      function recolour() {
        const P = geo.attributes.position.array, C = geo.attributes.color.array, src = lin ? LP : SP, c3 = new THREE.Color();
        for (let j = 0; j < n; j++) { const d = Math.floor(j / (A + 1)), v = VV[j], ok = keep(d, HH[j], v), c = col(v); c3.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
          if (!ok) { const m = (c3.r + c3.g + c3.b) / 3 * 0.18; c3.setRGB(m, m, m); }
          C[j * 3] = c3.r; C[j * 3 + 1] = c3.g; C[j * 3 + 2] = c3.b; P[j * 3] = src[j * 3]; P[j * 3 + 2] = src[j * 3 + 2]; P[j * 3 + 1] = ok ? (F.pr.size === 1 && F.pr.has('neg') ? YY[j] * 4 : YY[j]) : YY[j] * 0.15; }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
        dial.forEach(o => { o.visible = !lin; }); flat.forEach(o => { o.visible = lin; }); disc.visible = !lin;
        recs.forEach(r => { const x = lin ? ((r.d + 0.5) / N - 0.5) * 2.6 : Math.sin((r.h + 0.5) / 24 * 2 * Math.PI) * (0.12 + 0.88 * ((r.d + 0.5) / N)), z = lin ? ((r.h + 0.5) / 24 - 0.5) : -Math.cos((r.h + 0.5) / 24 * 2 * Math.PI) * (0.12 + 0.88 * ((r.d + 0.5) / N));
          r.line.geometry.setFromPoints([new THREE.Vector3(x, r.y, z), new THREE.Vector3(x, r.y + r.up, z)]); r.s.position.set(x, r.y + r.up * 1.35, z); });
      }
      // orbit: drag to turn, wheel or pinch to zoom
      const pts = new Map(); let pinch = 0;
      ren.domElement.style.touchAction = 'none';
      ren.domElement.addEventListener('pointerdown', e => { auto = false; pts.set(e.pointerId, [e.clientX, e.clientY]); ren.domElement.setPointerCapture(e.pointerId); });
      ren.domElement.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; const [x0, y0] = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2) { const [a, b] = [...pts.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) dist = Math.max(0.8, Math.min(6, dist * pinch / dd)); pinch = dd; return; }
        az -= (e.clientX - x0) * 0.008; el = Math.max(-1.35, Math.min(1.45, el + (e.clientY - y0) * 0.006)); });
      const up = e => { pts.delete(e.pointerId); pinch = 0; }; ren.domElement.addEventListener('pointerup', up); ren.domElement.addEventListener('pointercancel', up);
      ren.domElement.addEventListener('wheel', e => { e.preventDefault(); auto = false; dist = Math.max(0.8, Math.min(6, dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: false });
      function resize() { const b = g3.getBoundingClientRect(); if (!b.width) return; ren.setSize(b.width, b.height); cam.aspect = b.width / b.height; cam.updateProjectionMatrix(); }
      new ResizeObserver(resize).observe(g3);
      function frame(ts) {
        if (!host.isConnected) { ren.dispose(); return; }
        requestAnimationFrame(frame); if (!on3) return;
        const u = Math.min(1, (ts - g0) / 9000), e = 1 - Math.pow(1 - u, 2.2), show = Math.max(2, Math.floor(e * N));
        geo.setDrawRange(0, (show - 1) * A * 6); mesh.scale.y = 0.15 + 0.85 * Math.min(1, u * 1.6); kpis(e);
        recs.forEach(r => { r.line.visible = r.s.visible = show > r.d; });
        if (auto) az = ts / 1000 * 0.12;
        const dd = dist * (lin ? 1.35 : 1); cam.position.set(Math.sin(az) * Math.cos(el) * dd, Math.sin(el) * dd, Math.cos(az) * Math.cos(el) * dd); cam.lookAt(0, 0.04, 0); disc.material.opacity = el < 0 ? 0 : 0.06;
        ren.render(scene, cam);
      }
      const R = { layout: recolour, grow: () => { g0 = performance.now(); } };
      recolour(); resize(); R.grow(); requestAnimationFrame(frame);
      return R;
    }

    // ── controls ──
    // the selection in a line (it also says how many hours it keeps)
    function selText() {
      const on = g => [...host.querySelectorAll(`[data-g="${g}"].on`)].map(b => b.textContent.trim()), parts = [];
      if (F.y.size) parts.push([...F.y].sort().join(', '));
      const h0 = +host.querySelector('[data-r="h0"]').value, h1 = +host.querySelector('[data-r="h1"]').value, hp = on('hp');
      if (hp.length) parts.push(hp.join(', ')); else if (h0 !== 0 || h1 !== 24) parts.push(`${h0}–${h1} h`);
      ['se', 'dy', 'pr', 'pd', 'ev'].forEach(g => { const o = on(g); if (o.length) parts.push(o.join(', ')); });
      const a = host.querySelector('[data-r="from"]').value, b2 = host.querySelector('[data-r="to"]').value; if (a || b2) parts.push(`${a || '…'} → ${b2 || '…'}`);
      if (!isNaN(F.pmin) || !isNaN(F.pmax)) parts.push(`${isNaN(F.pmin) ? '…' : F.pmin} → ${isNaN(F.pmax) ? '…' : F.pmax} €`);
      return parts.length ? T('Sélection : ', 'Selection: ') + parts.join(' · ') : T('Toutes les heures', 'Every hour');
    }
    function apply() {
      prep(); build(); draw(P0); if (R3) R3.layout();
      const e = host.querySelector('[data-k="sel"]'); if (e) e.textContent = selText();
    }
    const HP = { nuit: [0, 6], midi: [11, 15], soir: [18, 21], hp: [6, 22], hc: [22, 6] };
    const hoursFromPresets = () => { const on = [...host.querySelectorAll('[data-g="hp"].on')].map(b => b.dataset.v);
      if (!on.length) { const a = +host.querySelector('[data-r="h0"]').value, b2 = +host.querySelector('[data-r="h1"]').value;
        F.hs = Array.from({ length: 24 }, (_, h) => a < b2 ? h >= a && h < b2 : h >= a || h < b2); return; }
      F.hs = Array.from({ length: 24 }, (_, h) => on.some(k => { const [a, b2] = HP[k]; return a < b2 ? h >= a && h < b2 : h >= a || h < b2; })); };
    host.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => {
      const g = b.dataset.g, v = b.dataset.v; b.classList.toggle('on');
      if (g === 'dy') { host.querySelectorAll('[data-g="dy"]').forEach(x => { if (x !== b) x.classList.remove('on'); }); F.dy = b.classList.contains('on') ? v : ''; }
      else if (g === 'hp') { host.querySelector('[data-r="h0"]').value = 0; host.querySelector('[data-r="h1"]').value = 24; hoursFromPresets(); }
      else { const set = { y: F.y, se: F.se, pr: F.pr, pd: F.pd, ev: F.ev }[g], val2 = g === 'y' ? +v : v; if (b.classList.contains('on')) set.add(val2); else set.delete(val2); }
      apply();
    }));
    host.querySelectorAll('[data-r="h0"], [data-r="h1"]').forEach(r => r.addEventListener('input', () => {
      host.querySelectorAll('[data-g="hp"].on').forEach(x => x.classList.remove('on')); hoursFromPresets();
      host.querySelector('[data-k="hr"]').textContent = `${host.querySelector('[data-r="h0"]').value} h → ${host.querySelector('[data-r="h1"]').value} h`; apply(); }));
    host.querySelectorAll('[data-r="from"], [data-r="to"]').forEach(r => r.addEventListener('change', () => {
      const a = host.querySelector('[data-r="from"]').value, b2 = host.querySelector('[data-r="to"]').value; F.d0 = a ? iso2d(a) : -1; F.d1 = b2 ? iso2d(b2) : 1e9; apply(); }));
    host.querySelectorAll('[data-r="pmin"], [data-r="pmax"]').forEach(r => r.addEventListener('change', () => {
      F.pmin = parseFloat(host.querySelector('[data-r="pmin"]').value); F.pmax = parseFloat(host.querySelector('[data-r="pmax"]').value); apply(); }));
    host.querySelector('[data-a="reset"]').addEventListener('click', () => {
      host.querySelectorAll('[data-g].on').forEach(x => x.classList.remove('on')); ['from', 'to', 'pmin', 'pmax'].forEach(k => { host.querySelector(`[data-r="${k}"]`).value = ''; });
      host.querySelector('[data-r="h0"]').value = 0; host.querySelector('[data-r="h1"]').value = 24; host.querySelector('[data-k="hr"]').textContent = '0 h → 24 h';
      Object.assign(F, { hs: Array(24).fill(true), dy: '', d0: -1, d1: 1e9, pmin: NaN, pmax: NaN }); [F.y, F.se, F.pr, F.pd, F.ev].forEach(x => x.clear()); apply(); });
    host.querySelector('[data-a="replay"]').addEventListener('click', () => { if (on3 && R3) R3.grow(); else play(); });
    host.querySelector('[data-a="lin"]').addEventListener('click', e => {
      lin = !lin; e.currentTarget.textContent = lin ? T('Spirale', 'Spiral') : T('Linéaire', 'Linear'); build(); if (R3) { R3.layout(); if (on3) R3.grow(); } if (!on3) play();
    });
    // full screen: the dial as large as the window allows, its figures and filters beside it; Esc or the button again leaves
    const wrap = host.querySelector('.sp-wrap'), fb = host.querySelector('[data-a="full"]');
    const full = on => { wrap.classList.toggle('sp-full', on); document.documentElement.classList.toggle('sp-lock', on);
      fb.setAttribute('aria-pressed', on); fb.textContent = on ? '✕ ' + T('Quitter le plein écran', 'Exit full screen') : '⤢ ' + T('Plein écran', 'Full screen'); };
    fb.addEventListener('click', () => full(!wrap.classList.contains('sp-full')));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && wrap.classList.contains('sp-full')) full(false); });
    host.querySelector('[data-a="3d"]').addEventListener('click', e => { e.currentTarget.textContent = on3 ? '3D' : '2D'; relief(!on3); });
    new ResizeObserver(() => { if (!D) return; const w = Math.floor(stage.getBoundingClientRect().width); if (Math.abs(w - S) > 4) { size(); build(); draw(P0); } }).observe(stage);

    load().then(data => {
      if (!host.isConnected) return;
      if (!data) { host.querySelector('.sp-grid').innerHTML = `<div class="fuel-note">${T('Prix horaires indisponibles.', 'Hourly prices not available.')}</div>`; return; }
      D = data; N = D.n; calendar(); prep(); size(); build();
      { const e = host.querySelector('[data-k="sel"]'); if (e) e.textContent = selText(); }
      // play the drawing once, when the section comes into view
      const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); play(); } }, { threshold: 0.3 });
      P0 = 0; draw(0); io.observe(stage);
    });
  }

  window.PKSpiral = { mount };
})();
