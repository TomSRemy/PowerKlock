// ════════════════════════════════════════════════════════════════════
// PPA PRICER · ASSET-SPECIFIC FPC METHOD (three pricings)
//   FPC     hourly forward price curve of France: shaping coefficients
//           (month in year, day type in month, hour in day type) averaged on
//           the years used, skeleton normalised to 1 a year, calibrated on
//           today's quotes without arbitrage: months, then quarters, then
//           seasons, then years (a period already set is not changed)
//   (1)     historical pricing: actual production × actual prices, per year
//   (2)     forward pricing: expected (P50) production × FPC, per delivery year
//   (3)     decorrelated pricing: actual production × the FPC skeleton
//           recalibrated on that year's realised monthly prices
//   cannib  (1) − (3) per year, as a share of the baseload; projected with
//           installed capacity (or flat), added to (2)
//   price_y = Cal_y × (1 + forward profile cost_y + cannibalisation_y)
// Data: data/history/fr_hourly/YYYY.json (scripts/build_fr_hourly.py).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const C = {};
  const getY = y => C[y] || (C[y] = fetch(DATA_BASE + 'history/fr_hourly/' + y + '.json').then(r => r.ok ? r.json() : null).catch(() => null));
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const dtype = iso => { const w = new Date(iso + 'T12:00:00Z').getUTCDay(); return w === 0 ? 2 : w === 6 ? 1 : 0; };   // 0 weekday, 1 Saturday, 2 Sunday
  const daysOf = y => { const out = [], d = new Date(Date.UTC(y, 0, 1)); while (d.getUTCFullYear() === y) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return out; };
  const linreg = (xs, ys) => { const n = xs.length; if (n < 2) return null; const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; }); return sxx ? { sl: sxy / sxx, ic: my - (sxy / sxx) * mx } : null; };

  // ── shaping coefficients from the years used ──
  function coefficients(H, years) {
    const mc = {}, dc = {}, hc = {};
    years.forEach(y => {
      const D = H[y]; if (!D) return;
      const all = []; Object.values(D.days).forEach(v => v.p.forEach(p => p != null && all.push(p)));
      const ya = mean(all); if (!ya) return;
      for (let m = 1; m <= 12; m++) {
        const md = Object.entries(D.days).filter(([d]) => +d.slice(5, 7) === m);
        const mp = []; md.forEach(([, v]) => v.p.forEach(p => p != null && mp.push(p)));
        if (!mp.length) continue;
        const ma = mean(mp); (mc[m] = mc[m] || []).push(ma / ya);
        for (let t = 0; t < 3; t++) {
          const tp = md.filter(([d]) => dtype(d) === t).map(([, v]) => v.p);
          const tv = []; tp.forEach(a => a.forEach(p => p != null && tv.push(p)));
          if (!tv.length) continue;
          const ta = mean(tv); (dc[m + '|' + t] = dc[m + '|' + t] || []).push(ta / ma);
          for (let h = 0; h < 24; h++) { const hv = tp.map(a => a[h]).filter(p => p != null); if (hv.length) (hc[m + '|' + t + '|' + h] = hc[m + '|' + t + '|' + h] || []).push(mean(hv) / ta); }
        }
      }
    });
    const avg = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, mean(v)]));
    return { mc: avg(mc), dc: avg(dc), hc: avg(hc) };
  }
  const shape = (K, iso, h) => { const m = +iso.slice(5, 7), t = dtype(iso); return (K.mc[m] || 1) * (K.dc[m + '|' + t] || 1) * (K.hc[m + '|' + t + '|' + h] || 1); };

  // ── quotes → periods (inclusive ISO days) ──
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  const endOf = (y, m) => iso(y, m + 1, 0);
  function periodOf(contract) {
    const c = (contract || '').replace(/^FR\s+/i, '').replace(/\s+base$/i, '').trim();
    let m;
    if ((m = /^([A-Za-z]{3})\s?(\d{2})$/.exec(c)) && MON[m[1].toLowerCase()]) { const y = 2000 + +m[2], mo = MON[m[1].toLowerCase()]; return { kind: 'month', rank: 0, a: iso(y, mo, 1), b: endOf(y, mo) }; }
    if ((m = /^Q([1-4])\s?(\d{2})$/.exec(c))) { const y = 2000 + +m[2], q = +m[1]; return { kind: 'quarter', rank: 1, a: iso(y, 3 * q - 2, 1), b: endOf(y, 3 * q) }; }
    if ((m = /^Sum\s?(\d{4})$/i.exec(c))) { const y = +m[1]; return { kind: 'season', rank: 2, a: iso(y, 4, 1), b: endOf(y, 9) }; }
    if ((m = /^Win\s?(\d{4})/i.exec(c))) { const y = +m[1]; return { kind: 'season', rank: 2, a: iso(y, 10, 1), b: endOf(y + 1, 3) }; }
    if ((m = /^Cal\s?(\d{4})$/i.exec(c))) { const y = +m[1]; return { kind: 'year', rank: 3, a: iso(y, 1, 1), b: iso(y, 12, 31) }; }
    return null;
  }

  // ── the curve: skeleton over the delivery years, calibrated without arbitrage ──
  function buildFPC(K, years, quotes) {
    const pts = [];
    years.forEach(y => daysOf(y).forEach(d => { for (let h = 0; h < 24; h++) pts.push({ d, h, v: shape(K, d, h), set: false }); }));
    // normalise the skeleton to 1 per calendar year
    years.forEach(y => { const ys = pts.filter(p => +p.d.slice(0, 4) === y); const s = mean(ys.map(p => p.v)); ys.forEach(p => { p.v /= s; }); });
    const used = [];
    quotes.map(q => Object.assign({}, q, periodOf(q.contract))).filter(q => q.kind && q.value != null).sort((a, b) => a.rank - b.rank).forEach(q => {
      const inP = pts.filter(p => p.d >= q.a && p.d <= q.b); if (!inP.length) return;
      const free = inP.filter(p => !p.set), fixed = inP.filter(p => p.set);
      if (!free.length) return;
      // pseudo-quote for the part not set yet: the period keeps the quote on average
      const target = (q.value * inP.length - fixed.reduce((a, p) => a + p.v, 0)) / free.length;
      const s = mean(free.map(p => p.v));
      free.forEach(p => { p.v = p.v / s * target; p.set = true; });
      used.push(q.contract);
    });
    // the Cal must hold exactly: months, quarters and seasons give the shape inside the year, then each year
    // is rescaled to its Cal (the quotes do not always add up; the gap is reported)
    const calGap = {};
    quotes.map(q => Object.assign({}, q, periodOf(q.contract))).filter(q => q.kind === 'year' && q.value != null).forEach(q => {
      const yp = pts.filter(p => p.d >= q.a && p.d <= q.b); if (!yp.length) return;
      const m = mean(yp.map(p => p.v)); calGap[q.a.slice(0, 4)] = m - q.value;
      yp.forEach(p => { p.v = p.v / m * q.value; });
    });
    return { pts, used, calGap };
  }

  // profile cost of a production curve on a price curve: Σ V·P / (Σ V × mean P) − 1
  function profileCost(V, P, mask) {
    let num = 0, den = 0, ps = 0, pn = 0;
    for (let i = 0; i < P.length; i++) { if (P[i] == null || (mask && !mask[i])) continue; ps += P[i]; pn++; if (V[i] == null) continue; num += V[i] * P[i]; den += V[i]; }
    return den && pn ? (num / den) / (ps / pn) - 1 : null;
  }

  // o = pricer result (step-by-step engine), st = state, D = reference data, capPath = capacity path for the technology
  async function compute(o, st, D) {
    const tech = st.tech === 'solar' ? 's' : 'w', years = o.sel.slice();
    const H = {}; (await Promise.all(years.map(getY))).forEach((f, i) => { if (f) H[years[i]] = f; });
    const yrs = years.filter(y => H[y]);
    if (yrs.length < 2) return null;
    const K = coefficients(H, yrs);
    const pos = st.conv === 'pos';
    const capOf = D.capGW[st.tech];
    // production by hour for a historical year: the asset's curve (kWh per quarter-hour → MW) or the national one
    const assetH = st.asset && o.useAsset ? (() => { const out = {}; st.asset.slots.forEach((a, d) => { const h = []; for (let k = 0; k < 24; k++) { let s = 0, n = 0; for (let q = 0; q < 4; q++) { const v = a[k * 4 + q]; if (v != null) { s += v * 4 / 1000; n++; } } h.push(n ? s / n : null); } out[d] = h; }); return out; })() : null;
    const prodOf = (y, d) => assetH ? (assetH[d] || null) : ((H[y].days[d] || {})[tech] || null);
    // (1) historical and (3) decorrelated, per year
    const hist = yrs.map(y => {
      const days = Object.keys(H[y].days).sort();
      const P = [], V = [], S = [], M = [];
      const mAvg = {}; for (let m = 1; m <= 12; m++) { const v = []; days.filter(d => +d.slice(5, 7) === m).forEach(d => H[y].days[d].p.forEach(p => p != null && v.push(p))); mAvg[m] = mean(v); }
      days.forEach(d => { const pr = prodOf(y, d), m = +d.slice(5, 7); for (let h = 0; h < 24; h++) { const p = H[y].days[d].p[h]; P.push(p); V.push(pr ? pr[h] : null); S.push(shape(K, d, h)); M.push(m); } });
      // decorrelated curve: the skeleton, each month scaled to its realised average
      const Pt = S.slice(); for (let m = 1; m <= 12; m++) { const idx = []; M.forEach((x, i) => x === m && idx.push(i)); if (!idx.length || mAvg[m] == null) continue; const s = mean(idx.map(i => S[i])); idx.forEach(i => { Pt[i] = S[i] / s * mAvg[m]; }); }
      const mask = pos ? P.map(p => p != null && p > 0) : null;
      const hasV = V.some(v => v != null && v > 0);
      if (!hasV) return null;
      const h = profileCost(V, P, mask), d = profileCost(V, Pt, mask);
      return h == null || d == null ? null : { y, hist: h, decorr: d, cannib: h - d, gw: capOf[y] || null };
    }).filter(Boolean);
    if (!hist.length) return null;
    // projection of the cannibalisation: a + b·ln(GW), anchored on the last year used; or flat at the average
    const fitPts = hist.filter(x => x.gw);
    const reg = fitPts.length >= 3 ? linreg(fitPts.map(x => Math.log(x.gw)), fitPts.map(x => x.cannib)) : null;
    const last = hist[hist.length - 1], flat = st.model === 'flat' || !reg || !last.gw;
    const meanC = mean(hist.map(x => x.cannib));
    const resid = reg ? fitPts.map(x => x.cannib - (reg.ic + reg.sl * Math.log(x.gw))) : hist.map(x => x.cannib - meanC);
    const sigC = Math.sqrt(mean(resid.map(r => r * r))) || 0.02;
    const cannibOf = y => flat ? meanC : last.cannib + reg.sl * (Math.log(o.capPath(y)) - Math.log(last.gw));
    // (2) forward: expected production by month × hour (the asset's average, or the national load factor), on the FPC
    const prof = {}, cnt = {};
    yrs.forEach(y => Object.keys(H[y].days).forEach(d => { const pr = prodOf(y, d); if (!pr) return; const m = +d.slice(5, 7), cap = assetH ? 1 : (capOf[y] || null); if (!cap) return; for (let h = 0; h < 24; h++) if (pr[h] != null) { const k = m + '|' + h; prof[k] = (prof[k] || 0) + pr[h] / cap; cnt[k] = (cnt[k] || 0) + 1; } }));
    const pAt = (d, h) => { const k = +d.slice(5, 7) + '|' + h; return cnt[k] ? prof[k] / cnt[k] : 0; };
    // today's quotes; a Cal entered by the user replaces the market one
    const userY = new Set(o.tenor.filter(y => st.fwd[y] != null));
    const quotes = (D.fwdRows || []).filter(q => { const p = periodOf(q.contract); return !(p && p.kind === 'year' && userY.has(+p.a.slice(0, 4))); })
      .concat([...userY].map(y => ({ contract: 'FR Cal' + y + ' base', value: st.fwd[y] })));
    const F = buildFPC(K, o.tenor, quotes);
    const fwd = o.tenor.map((y, i) => {
      const pts = F.pts.filter(p => +p.d.slice(0, 4) === y);
      const V = pts.map(p => pAt(p.d, p.h)), P = pts.map(p => p.v);
      const cal = mean(P), f = profileCost(V, P, null), c = cannibOf(y);
      return { y, cal, fwdCost: f, cannib: c, capture: cal * (1 + f + c), rate: 1 + f + c,
        months: Array.from({ length: 12 }, (_, m) => mean(pts.filter(p => +p.d.slice(5, 7) === m + 1).map(p => p.v))) };
    });
    // value and premium: the same weights as the step-by-step method; the premium from the spread of the yearly cannibalisation
    const W = o.years.reduce((a, r) => a + r.w, 0) || 1;
    const fair = fwd.reduce((a, r, i) => a + o.years[i].w / W * r.capture, 0);
    const refW = fwd.reduce((a, r, i) => a + o.years[i].w / W * r.cal, 0);
    const z = { 5: 1.645, 10: 1.2816, 15: 1.0364, 20: 0.8416, 25: 0.6745, 30: 0.5244, 35: 0.3853, 40: 0.2533, 45: 0.1257, 50: 0 };
    const za = z[Math.round(Math.min(50, Math.max(5, o.alpha)) / 5) * 5] || 0.6745;
    const premium = refW * sigC * za;
    const ppa = fair - premium - refW * o.add / 100 - o.imb + o.goW - o.margin;
    // a typical week of the first delivery year, for the chart
    const y0 = o.tenor[0], wk = F.pts.filter(p => p.d >= iso(y0, 6, 1) && p.d < iso(y0, 6, 8));
    return { K, hist, reg, flat, meanC, sigC, fwd, fair, refW, premium, ppa, used: F.used, calGap: F.calGap, week: wk.map(p => ({ d: p.d, h: p.h, v: p.v, prod: pAt(p.d, p.h) })), years: yrs, asset: !!assetH, cannibOf };
  }

  window.PKFpc = { compute, coefficients, buildFPC, periodOf, profileCost };
})();
