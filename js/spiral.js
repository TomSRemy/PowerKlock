// ════════════════════════════════════════════════════════════════════
// spiral.js · "La Spirale" in Power system › Yearly review: every hourly French day-ahead price since 2019 on one
// 24-hour dial (1 day = 1 turn, 2019 at the centre, today at the edge), or laid flat (1 column = 1 day), in 2D or
// in relief (height = price). Filters: negative hours, the 2021-22 crisis, noon against evening, the review's year.
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
          <div class="sp-k"><span class="sp-kl">${T('Heures négatives', 'Negative hours')}</span><span class="sp-kv sp-cy" data-k="neg">–</span><span class="sp-ks" data-k="negs"></span></div>
          <div class="sp-k"><span class="sp-kl">${T('Record bas', 'Record low')}</span><span class="sp-kv sp-cy" data-k="min">–</span><span class="sp-ks" data-k="mins"></span></div>
          <div class="sp-k"><span class="sp-kl">${T('Record haut', 'Record high')}</span><span class="sp-kv sp-rd" data-k="max">–</span><span class="sp-ks" data-k="maxs"></span></div>
          <div class="sp-btns"><button type="button" data-f="all" class="on">${T('Tout', 'All')}</button><button type="button" data-f="neg">${T('Heures négatives', 'Negative hours')}</button><button type="button" data-f="crise">${T('Crise 2022', '2022 crisis')}</button><button type="button" data-f="midi">${T('Midi vs soir', 'Noon vs evening')}</button>${year ? `<button type="button" data-f="year">${year}</button>` : ''}</div>
          <div class="sp-btns"><button type="button" class="sp-alt" data-a="lin">${T('Linéaire', 'Linear')}</button><button type="button" class="sp-alt" data-a="3d">3D</button><button type="button" data-a="replay">↺ ${T('Rejouer', 'Replay')}</button></div>
          <div class="sp-leg"><span>−200</span><i></i><span>500+ €</span></div>
          ${widget ? '' : `<p class="bl-foot sp-note">${T('Rayon proportionnel à la racine du temps : chaque jour a la même surface. En relief, hauteur en échelle logarithmique. Les heures négatives sont comptées sur la moyenne horaire ; le bilan les compte sur les pas publiés (quart d’heure depuis octobre 2025).', 'Radius in proportion to the square root of time: every day has the same area. In relief, height on a log scale. Negative hours are counted on the hourly mean; the review counts them on the published steps (quarter-hour since October 2025).')}</p>`}
        </div></div></div>`;
    const $ = s => host.querySelector(s);
    const stage = $('.sp-stage'), cv = $('.sp-cv'), ov = $('.sp-ov'), g3 = $('.sp-g3'), tip = $('.sp-tip'), hint = $('.sp-hint');
    const ctx = cv.getContext('2d'), octx = ov.getContext('2d');
    $('.sp-leg i').style.background = 'linear-gradient(90deg,' + [-200, -100, -30, -1, 0, 30, 60, 100, 150, 250, 400, 500, 1500].map(v => `rgb(${col(v)})`).join(',') + ')';
    let D, N, S, DPR, CX, CY, R0, R1, LX0, LX1, LY0, LY1, img, filt = 'all', lin = false, on3 = false, P0 = 1, raf = 0, t0 = null;
    const val = (d, h) => D.v[d * 24 + h];
    const keep = (d, h, v) => {
      if (filt === 'neg') return v < 0;
      if (filt === 'crise') { const t = dayDate(D, d); const y = t.getUTCFullYear(); return y === 2022 || (y === 2021 && t.getUTCMonth() >= 8); }
      if (filt === 'midi') return (h >= 11 && h <= 15) || (h >= 18 && h <= 21);
      if (filt === 'year') return String(dayDate(D, d).getUTCFullYear()) === year;
      return true;
    };
    const tOfR = r => { const u = (r - R0) / (R1 - R0); return u * u * N; }, rOfT = t => R0 + (R1 - R0) * Math.sqrt(Math.max(0, t) / N);
    function hit(x, y) {
      if (lin) { if (x < LX0 || x >= LX1 || y < LY0 || y >= LY1) return null; return [Math.floor((x - LX0) / (LX1 - LX0) * N), Math.floor((y - LY0) / (LY1 - LY0) * 24)]; }
      const dx = x - CX, dy = y - CY, r = Math.hypot(dx, dy); if (r < R0 || r > R1) return null;
      let a = Math.atan2(dx, -dy); if (a < 0) a += 2 * Math.PI; const d = Math.floor(tOfR(r)); if (d >= N) return null;
      return [d, Math.floor(a / (2 * Math.PI) * 24)];
    }
    function size() {
      DPR = Math.min(2, window.devicePixelRatio || 1); const b = stage.getBoundingClientRect(); S = Math.max(240, Math.floor(b.width));
      [cv, ov].forEach(c => { c.width = S * DPR; c.height = S * DPR; c.style.width = c.style.height = S + 'px'; });
      CX = CY = S * DPR / 2; R1 = S * DPR * 0.44; R0 = S * DPR * 0.05; LX0 = S * DPR * 0.1; LX1 = S * DPR * 0.98; LY0 = S * DPR * 0.16; LY1 = S * DPR * 0.84;
    }
    function build() {
      const W = cv.width; img = ctx.createImageData(W, W); const P = img.data; const bg = light() ? [255, 255, 255] : [15, 20, 25];
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const q = hit(x, y); if (!q) continue; const [d, h] = q; const v = val(d, h); let [r, g, b] = col(v);
        if (!keep(d, h, v)) { const m = (r + g + b) / 3; r = bg[0] * 0.75 + m * 0.25; g = bg[1] * 0.75 + m * 0.25; b = bg[2] * 0.75 + m * 0.25; }
        const i = (y * W + x) * 4; P[i] = r; P[i + 1] = g; P[i + 2] = b; P[i + 3] = 255;
      }
      cv.dataset.pkDrawn = '1';
    }
    const txt = () => light() ? ['#1F2D3D', '#5E6B80', '#8DA3BA'] : ['#E8EDF5', '#9AA7BA', '#5E6B80'];
    function axes(p) {
      octx.clearRect(0, 0, ov.width, ov.height); const f = DPR, [t1, t2, t3] = txt();
      octx.font = `600 ${11 * f}px Inter,system-ui,sans-serif`;
      if (lin) {
        octx.textAlign = 'right'; octx.textBaseline = 'middle';
        for (let h = 0; h <= 24; h += 3) { octx.fillStyle = h % 6 ? t3 : t1; octx.fillText(h + ' h', LX0 - 6 * f, LY0 + (LY1 - LY0) * h / 24); }
        octx.textAlign = 'center'; octx.textBaseline = 'top'; octx.font = `700 ${10 * f}px 'JetBrains Mono',monospace`;
        for (let y = Y0; y <= dayDate(D, N - 1).getUTCFullYear(); y++) { const t = (Date.UTC(y, 6, 1) - D.d0) / 864e5; if (t > N) break; octx.fillStyle = t2; octx.fillText(y, LX0 + (LX1 - LX0) * Math.max(0, t) / N, LY1 + 8 * f); }
        return;
      }
      octx.textAlign = 'center'; octx.textBaseline = 'middle';
      for (let h = 0; h < 24; h++) { const a = h / 24 * 2 * Math.PI, r = R1 + 15 * f; octx.fillStyle = h % 6 ? t3 : t1; octx.fillText(h + ' h', CX + Math.sin(a) * r, CY - Math.cos(a) * r); }
      octx.font = `700 ${10 * f}px 'JetBrains Mono',monospace`;
      const yl = dayDate(D, N - 1).getUTCFullYear(), span = yl - Y0;
      for (let y = Y0 + 1; y <= yl; y++) {
        const t = (Date.UTC(y, 0, 1) - D.d0) / 864e5; if (t > p * N) break; const r = rOfT(t);
        octx.strokeStyle = light() ? 'rgba(31,45,61,.25)' : 'rgba(232,237,245,.18)'; octx.lineWidth = f; octx.setLineDash([2 * f, 4 * f]); octx.beginPath(); octx.arc(CX, CY, r, 0, 2 * Math.PI); octx.stroke(); octx.setLineDash([]);
        // labels fanned out along the night side, so they never sit on top of each other
        const a = -Math.PI * (0.05 + 0.9 * (y - Y0) / Math.max(1, span)) * 0.5 - Math.PI * 0.05, x = CX + Math.sin(a) * r, yy = CY - Math.cos(a) * r;
        octx.fillStyle = light() ? 'rgba(255,255,255,.85)' : 'rgba(15,20,25,.85)'; octx.fillRect(x - 17 * f, yy - 7 * f, 34 * f, 14 * f); octx.fillStyle = t2; octx.fillText(y, x, yy);
      }
      octx.fillStyle = t3; octx.fillText(String(Y0), CX, CY);
    }
    // figures follow the reveal
    let NEG, RMIN, RMAX;
    function prep() {
      NEG = new Int32Array(N); RMIN = []; RMAX = []; let c = 0, lo = [1e9, 0, 0], hi = [-1e9, 0, 0];
      for (let d = 0; d < N; d++) { for (let h = 0; h < 24; h++) { const v = val(d, h); if (v < 0) c++; if (v < lo[0]) lo = [v, d, h]; if (v > hi[0]) hi = [v, d, h]; } NEG[d] = c; RMIN.push(lo); RMAX.push(hi); }
    }
    function kpis(p) {
      const d = Math.min(N - 1, Math.floor(p * N)), lo = RMIN[d], hi = RMAX[d], set = (k, s) => { const e = host.querySelector(`[data-k="${k}"]`); if (e) e.textContent = s; };
      set('neg', NEG[d].toLocaleString(T('fr-FR', 'en-GB')) + ' h'); set('negs', `${fmtD(D, 0)} → ${fmtD(D, d)}`);
      set('min', fmtN(lo[0]) + ' €'); set('mins', `${fmtD(D, lo[1])} · ${String(lo[2]).padStart(2, '0')} h`);
      set('max', fmtN(hi[0]) + ' €'); set('maxs', `${fmtD(D, hi[1])} · ${String(hi[2]).padStart(2, '0')} h`);
    }
    function draw(p) {
      const W = cv.width; ctx.clearRect(0, 0, W, W); ctx.putImageData(img, 0, 0);
      if (p < 1) {
        ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.beginPath();
        if (lin) ctx.rect(0, 0, LX0 + (LX1 - LX0) * p, W); else ctx.arc(CX, CY, rOfT(p * N), 0, 2 * Math.PI);
        ctx.fill(); ctx.restore();
        ctx.strokeStyle = '#FFD23F'; ctx.lineWidth = 2 * DPR; ctx.beginPath();
        if (lin) { const x = LX0 + (LX1 - LX0) * p; ctx.moveTo(x, LY0); ctx.lineTo(x, LY1); } else ctx.arc(CX, CY, rOfT(p * N), 0, 2 * Math.PI);
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
      if (lin) { const yy = LY0 + (LY1 - LY0) * (h + 0.5) / 24, xx = LX0 + (LX1 - LX0) * (d + 0.5) / N; octx.moveTo(LX0, yy); octx.lineTo(LX1, yy); octx.stroke(); octx.lineWidth = DPR; octx.beginPath(); octx.moveTo(xx, LY0); octx.lineTo(xx, LY1); octx.stroke(); }
      else { const a = (h + 0.5) / 24 * 2 * Math.PI; octx.moveTo(CX, CY); octx.lineTo(CX + Math.sin(a) * R1, CY - Math.cos(a) * R1); octx.stroke(); octx.lineWidth = DPR; octx.beginPath(); octx.arc(CX, CY, rOfT(d + 0.5), 0, 2 * Math.PI); octx.stroke(); }
      const s = D.sol[d * 24 + h], w = D.win[d * 24 + h];
      tip.innerHTML = `${fmtD(D, d)} · ${String(h).padStart(2, '0')} h<b class="${v < 0 ? 'sp-cy' : v > 150 ? 'sp-rd' : v > 60 ? 'sp-am' : ''}">${fmtN(v)} €/MWh</b>${!isNaN(s) || !isNaN(w) ? `<small>${T('solaire', 'solar')} ${isNaN(s) ? '–' : fmtN(s / 1000)} GW · ${T('éolien', 'wind')} ${isNaN(w) ? '–' : fmtN(w / 1000)} GW</small>` : ''}`;
      const sb = stage.getBoundingClientRect(); let lx = e.clientX - sb.left + 14; if (lx > sb.width - 190) lx -= 210;
      tip.style.left = lx + 'px'; tip.style.top = (e.clientY - sb.top + 14) + 'px'; tip.style.opacity = 1;
    });
    ov.addEventListener('pointerleave', () => { tip.style.opacity = 0; if (P0 >= 1) draw(1); });

    // ── relief (Three.js, loaded on first use) ──
    let TH = null, R3 = null;
    async function relief(onOff) {
      on3 = onOff; g3.style.display = on3 ? 'block' : 'none'; cv.style.visibility = ov.style.visibility = on3 ? 'hidden' : 'visible';
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
      for (let d = 0; d < rows; d++) { const r = 0.12 + 0.88 * Math.sqrt((d + 0.5) / N); for (let a = 0; a <= A; a++) { const j = d * (A + 1) + a, i = j * 3, th = a / A * 2 * Math.PI, v = vAt(d, a % A);
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
          C[j * 3] = c3.r; C[j * 3 + 1] = c3.g; C[j * 3 + 2] = c3.b; P[j * 3] = src[j * 3]; P[j * 3 + 2] = src[j * 3 + 2]; P[j * 3 + 1] = ok ? (filt === 'neg' ? YY[j] * 4 : YY[j]) : YY[j] * 0.15; }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
        dial.forEach(o => { o.visible = !lin; }); flat.forEach(o => { o.visible = lin; }); disc.visible = !lin;
        recs.forEach(r => { const x = lin ? ((r.d + 0.5) / N - 0.5) * 2.6 : Math.sin((r.h + 0.5) / 24 * 2 * Math.PI) * (0.12 + 0.88 * Math.sqrt((r.d + 0.5) / N)), z = lin ? ((r.h + 0.5) / 24 - 0.5) : -Math.cos((r.h + 0.5) / 24 * 2 * Math.PI) * (0.12 + 0.88 * Math.sqrt((r.d + 0.5) / N));
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
    host.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => {
      host.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b)); filt = b.dataset.f; build(); draw(P0); if (R3) R3.layout();
    }));
    host.querySelector('[data-a="replay"]').addEventListener('click', () => { if (on3 && R3) R3.grow(); else play(); });
    host.querySelector('[data-a="lin"]').addEventListener('click', e => {
      lin = !lin; e.currentTarget.textContent = lin ? T('Spirale', 'Spiral') : T('Linéaire', 'Linear'); build(); if (R3) { R3.layout(); if (on3) R3.grow(); } if (!on3) play();
    });
    host.querySelector('[data-a="3d"]').addEventListener('click', e => { e.currentTarget.textContent = on3 ? '3D' : '2D'; relief(!on3); });
    new ResizeObserver(() => { if (!D) return; const w = Math.floor(stage.getBoundingClientRect().width); if (Math.abs(w - S) > 4) { size(); build(); draw(P0); } }).observe(stage);

    load().then(data => {
      if (!host.isConnected) return;
      if (!data) { host.querySelector('.sp-grid').innerHTML = `<div class="fuel-note">${T('Prix horaires indisponibles.', 'Hourly prices not available.')}</div>`; return; }
      D = data; N = D.n; prep(); size(); build();
      // play the drawing once, when the section comes into view
      const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); play(); } }, { threshold: 0.3 });
      P0 = 0; draw(0); io.observe(stage);
    });
  }

  window.PKSpiral = { mount };
})();
