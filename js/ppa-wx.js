// ════════════════════════════════════════════════════════════════════
// PPA PRICER · MONTE CARLO ON SIMULATED WEATHER (fourth method)
// Each simulated year, day by day:
//   weather     daily solar and wind capacity factors drawn from each month's
//               real distribution, with day-to-day persistence and the
//               solar ↔ wind link (scripts/prod_model.py → fr_prod_model.json)
//   production  × the installed capacity projected for the delivery year
//               (PPE3 path), hourly shape of a real day with a close output
//   demand      consumption and nuclear availability of a recent real day of
//               the same month and day type
//   price       month level of the forward curve × the effect of the net
//               residual load (consumption − solar − wind − nuclear available),
//               measured on the last two complete years by season and time of
//               day, × a residual drawn from the same years; then the whole
//               year is rescaled to its Cal exactly
// Correlated: production and prices of the same simulated year. Decorrelated:
// production of one year, prices of another. The gap is the cannibalisation.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const getJ = p => fetch(DATA_BASE + p).then(r => r.ok ? r.json() : null).catch(() => null);
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const dtype = iso => { const w = new Date(iso + 'T12:00:00Z').getUTCDay(); return w === 0 ? 2 : w === 6 ? 1 : 0; };
  const block = h => h < 9 ? 0 : h < 17 ? 1 : 2;   // night / day / evening
  const summer = m => m >= 4 && m <= 9 ? 1 : 0;
  const daysOf = y => { const out = [], d = new Date(Date.UTC(y, 0, 1)); while (d.getUTCFullYear() === y) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return out; };
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const ncdf = x => 0.5 * (1 + erf(x / Math.SQRT2));
  function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
  const quant = (v, p) => { const r = p * (v.length - 1), lo = Math.floor(r), hi = Math.min(lo + 1, v.length - 1); return v[lo] + (v[hi] - v[lo]) * (r - lo); };

  let BASE = null;
  // historical days: capacity factors, hourly shapes, consumption, nuclear, prices
  async function base(capGW) {
    if (BASE) return BASE;
    const model = await getJ('history/fr_prod_model.json');
    if (!model) return null;
    const ys = model.years.slice();
    const files = await Promise.all(ys.map(y => getJ('history/fr_hourly/' + y + '.json')));
    const capAt = (tech, iso) => { const y = +iso.slice(0, 4), c = capGW[tech], a = c[y - 1] != null ? c[y - 1] : c[y], b = c[y] != null ? c[y] : c[y - 1]; if (a == null || b == null) return null;
      const doy = (Date.parse(iso) - Date.UTC(y, 0, 1)) / 864e5; return a + (b - a) * (doy + 0.5) / (y % 4 ? 365 : 366); };
    const days = [];
    files.forEach((f, k) => { if (!f) return; Object.entries(f.days).forEach(([iso, v]) => {
      if (!['s', 'w', 'l', 'n', 'p'].every(x => Array.isArray(v[x]) && v[x].every(z => z != null))) return;
      const gs = capAt('solar', iso), gw = capAt('wind', iso); if (!gs || !gw) return;
      const ds = mean(v.s) / (gs * 1000), dw = mean(v.w) / (gw * 1000); if (!(ds > 0) || !(dw > 0)) return;
      days.push({ iso, y: ys[k], m: +iso.slice(5, 7), t: dtype(iso), cfS: ds, cfW: dw, sAbs: v.s, wAbs: v.w, shS: v.s.map(x => x / (ds * gs * 1000)), shW: v.w.map(x => x / (dw * gw * 1000)), L: v.l, N: v.n, nav: Math.max(...v.n), P: v.p }); }); });
    // analog search: per month, days sorted by solar and by wind capacity factor
    const byM = {}; for (let m = 1; m <= 12; m++) { const md = days.filter(d => d.m === m); byM[m] = { s: md.slice().sort((a, b) => a.cfS - b.cfS), w: md.slice().sort((a, b) => a.cfW - b.cfW) }; }
    BASE = { model, days, byM, ys };
    return BASE;
  }
  const nearest = (arr, key, v, R) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid][key] < v) lo = mid + 1; else hi = mid; } const k = Math.max(0, Math.min(arr.length - 1, lo - 5 + Math.floor(R() * 10))); return arr[k]; };

  // the price curve: ratio of the price to its month average against the net residual load, recent years
  function priceCurve(B, recent) {
    const tab = {}, res = {};
    const R = B.days.filter(d => recent.includes(d.y));
    const mAvg = {}; R.forEach(d => { const k = d.y * 100 + d.m; (mAvg[k] = mAvg[k] || []).push(...d.P); });
    Object.keys(mAvg).forEach(k => { mAvg[k] = mean(mAvg[k]); });
    const pts = [];
    R.forEach(d => { const ma = mAvg[d.y * 100 + d.m]; if (!(ma > 1)) return;
      for (let h = 0; h < 24; h++) { const net = (d.L[h] - d.sAbs[h] - d.wAbs[h] - d.nav) / 1000, g = summer(d.m) * 3 + block(h), b = Math.round(net);
        const k = g + '|' + b; (tab[k] = tab[k] || []).push(d.P[h] / ma); pts.push([g, b, d.P[h] / ma]); } });
    const T = {}; Object.entries(tab).forEach(([k, v]) => { if (v.length >= 20) T[k] = mean(v); });
    pts.forEach(([g, b, r]) => { const f = lookup(T, g, b); if (f > 0.05) (res[g] = res[g] || []).push(r / f); });
    return { T, res };
  }
  function lookup(T, g, b) { let k = 0; while (T[g + '|' + b] == null && k < 120) { b += b > 0 ? -1 : 1; k++; } return T[g + '|' + b] != null ? T[g + '|' + b] : 1; }

  // the asset as national + local deviation, from its own curve (days it shares with the national files):
  // asset day factor = 1 + β × (national day factor − 1) + ε, ε with its own spread and persistence
  function fitAsset(st, B, tech) {
    if (!st.asset || !st.asset.slots) return null;
    const nat = {}; B.days.forEach(d => { nat[d.iso] = d; });
    const pairs = [];
    st.asset.slots.forEach((a, iso) => { const n = nat[iso]; if (!n) return; let e = 0; for (let q = 0; q < 96; q++) e += a[q] || 0; pairs.push({ iso, m: n.m, a: e, n: tech === 'S' ? n.cfS : n.cfW }); });
    if (pairs.length < 60) return null;
    // normalise by month so that seasons do not count as correlation
    const mA = {}, mN = {}; pairs.forEach(p => { (mA[p.m] = mA[p.m] || []).push(p.a); (mN[p.m] = mN[p.m] || []).push(p.n); });
    Object.keys(mA).forEach(m => { mA[m] = mean(mA[m]); mN[m] = mean(mN[m]); });
    const xs = [], ys = [];
    pairs.sort((a, b) => a.iso < b.iso ? -1 : 1).forEach(p => { if (mA[p.m] > 0 && mN[p.m] > 0) { xs.push(p.n / mN[p.m] - 1); ys.push(p.a / mA[p.m] - 1); } });
    const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    const beta = sxx ? sxy / sxx : 1, r2 = sxx && syy ? sxy * sxy / (sxx * syy) : 0;
    const eps = ys.map((y, i) => y - beta * xs[i]), sd = Math.sqrt(mean(eps.map(e => e * e)));
    let num = 0, den = 0; for (let i = 1; i < eps.length; i++) { num += eps[i] * eps[i - 1]; den += eps[i - 1] * eps[i - 1]; }
    return { beta, r2, sd, phi: den ? Math.max(0, Math.min(0.95, num / den)) : 0, n: pairs.length };
  }

  // o: pricer result, st: state, D: data, capPathFor(tech) → GW by year, monthLevel(y, m) → €/MWh (forward curve)
  async function compute(o, st, D, capPathFor, monthLevel, nSim, sigModel) {
    const B = await base(D.capGW); if (!B) return null;
    const N = nSim || 120, R = rng(20261021);
    const complete = B.ys.filter(y => y !== 2022 && B.days.filter(d => d.y === y).length > 330);
    const recent = complete.slice(-2);
    const PC = priceCurve(B, recent);
    const recentDays = {}; B.days.filter(d => recent.includes(d.y)).forEach(d => { const k = d.m + '|' + d.t; (recentDays[k] = recentDays[k] || []).push(d); });
    const tech = st.tech === 'solar' ? 'S' : 'W', pos = st.conv !== 'all', baseAll = st.conv === 'curt';
    const AF = o.useAsset ? fitAsset(st, B, tech) : null;
    const meanCF = {}; for (let m = 1; m <= 12; m++) { const q = B.model.months[String(m)][tech === 'S' ? 's' : 'w']; meanCF[m] = mean(q); }
    let eA = 0;
    const M = B.model, phiS = M.phi.s, phiW = M.phi.w, rho = M.rho;
    const out = o.tenor.map(() => ({ rate: new Float64Array(N), rateD: new Float64Array(N), vol: new Float64Array(N) }));
    const sims = [];   // keep prices and production of each simulated year for the decorrelated pairing
    let zs = 0, zw = 0;
    const gauss = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
    let week = null;
    // the forward level of a delivery year: its Cal, or the day-weighted mean of its months' levels when only some are delivered
    const calOf = (Y, Mo) => { if (!Mo || Mo.length === 12) return monthLevel(Y, 0); let a = 0, n = 0; Mo.forEach(m => { const d = new Date(Date.UTC(Y, m, 0)).getUTCDate(); a += monthLevel(Y, m) * d; n += d; }); return n ? a / n : monthLevel(Y, 0); };
    o.tenor.forEach((Y, yi) => {
      const Mo = o.monthsOf ? o.monthsOf(Y) : null;   // a year delivered in part: its months only
      const capS = capPathFor('solar')(Y), capW = capPathFor('wind')(Y), days = daysOf(Y).filter(d => !Mo || Mo.includes(+d.slice(5, 7)));
      const simsY = [];
      for (let n = 0; n < N; n++) {
        const P = new Float64Array(days.length * 24), V = new Float64Array(days.length * 24);
        days.forEach((iso, di) => {
          const m = +iso.slice(5, 7), t = dtype(iso);
          const e1 = gauss(), e2 = gauss();
          zs = phiS * zs + Math.sqrt(1 - phiS * phiS) * e1;
          zw = phiW * zw + Math.sqrt(1 - phiW * phiW) * (rho * e1 + Math.sqrt(1 - rho * rho) * e2);
          const q = M.months[String(m)], cS = quant(q.s, ncdf(zs)), cW = quant(q.w, ncdf(zw));
          const aS = nearest(B.byM[m].s, 'cfS', cS, R), aW = nearest(B.byM[m].w, 'cfW', cW, R);
          const pool = recentDays[m + '|' + t] || recentDays[m + '|0'], dem = pool[Math.floor(R() * pool.length)];
          const lvl = monthLevel(Y, m);
          // the asset's day: follows the national day through β, plus its own persistent deviation
          let aDay = 1;
          if (AF) { eA = AF.phi * eA + Math.sqrt(1 - AF.phi * AF.phi) * AF.sd * gauss(); const xn = (tech === 'S' ? cS : cW) / meanCF[m] - 1; aDay = Math.max(0, 1 + AF.beta * xn + eA) / Math.max(0.05, 1 + xn); }
          for (let h = 0; h < 24; h++) {
            const s = cS * aS.shS[h] * capS * 1000, w = cW * aW.shW[h] * capW * 1000;
            const net = (dem.L[h] - s - w - dem.nav) / 1000, g = summer(m) * 3 + block(h);
            const rs = PC.res[g], noise = rs && rs.length ? rs[Math.floor(R() * rs.length)] : 1;
            const k = di * 24 + h;
            P[k] = lvl * lookup(PC.T, g, Math.round(net)) * noise;
            V[k] = (tech === 'S' ? cS * aS.shS[h] : cW * aW.shW[h]) * aDay;
          }
        });
        // the year averages exactly its Cal (a part year: the average level of its months)
        const cal = calOf(Y, Mo); let ps = 0; for (let k = 0; k < P.length; k++) ps += P[k]; const f = cal / (ps / P.length); for (let k = 0; k < P.length; k++) P[k] *= f;
        simsY.push({ P, V });
        if (yi === 0 && n === 0) { const a0 = days.indexOf(Y + '-06-01'), a = a0 >= 0 ? a0 : 0; week = Array.from({ length: 7 * 24 }, (_, k) => ({ p: P[a * 24 + k], v: V[a * 24 + k] })); }
      }
      const capRate = (V, P) => { let num = 0, den = 0, ps = 0, pn = 0; for (let k = 0; k < P.length; k++) { const paid = !pos || P[k] > 0; if (paid || baseAll) { ps += P[k]; pn++; } if (!paid) continue; num += V[k] * P[k]; den += V[k]; } return den && pn ? (num / den) / (ps / pn) : null; };
      simsY.forEach((s, n) => { out[yi].rate[n] = capRate(s.V, s.P); out[yi].rateD[n] = capRate(s.V, simsY[(n + 1) % N].P); let v = 0; for (let k = 0; k < s.V.length; k++) v += s.V[k]; out[yi].vol[n] = v; });
      sims.push(simsY);
    });
    // model risk: one persistent deviation per trajectory, the size of the method's past errors (historical replay)
    const sm = sigModel || 0;
    if (sm > 0) for (let n = 0; n < N; n++) { const z = gauss() * sm; out.forEach(r => { r.rate[n] += z; }); }
    // per delivery year: correlated and decorrelated capture rates, cannibalisation, spread
    const srt = a => Float64Array.from(a).sort();
    const years = o.tenor.map((y, i) => { const r = srt(out[i].rate), d = srt(out[i].rateD), cal = calOf(y, o.monthsOf ? o.monthsOf(y) : null);
      return { y, cal, rate: mean(Array.from(r)), rateD: mean(Array.from(d)), cannib: mean(Array.from(r)) - mean(Array.from(d)), p10: quant(r, 0.1), p90: quant(r, 0.9), capture: cal * mean(Array.from(r)) }; });
    // value per MWh over the delivery, trajectory by trajectory (weights of the step-by-step method)
    const W = o.years.reduce((a, r) => a + r.w, 0) || 1;
    const U = new Float64Array(N);
    for (let n = 0; n < N; n++) U[n] = o.tenor.reduce((a, y, i) => a + o.years[i].w / W * years[i].cal * out[i].rate[n], 0);
    const Us = srt(U), fair = mean(Array.from(U)), qU = quant(Us, o.alpha / 100), premium = fair - qU;
    const refW = years.reduce((a, r, i) => a + o.years[i].w / W * r.cal, 0);
    const ppa = qU - refW * o.add / 100 - o.imb + o.goW - o.margin;
    return { N, recent, asset: AF, sigModel: sm, years, U: Us, fair, qU, premium, refW, ppa, week, capS: o.tenor.map(y => capPathFor('solar')(y)), capW: o.tenor.map(y => capPathFor('wind')(y)) };
  }
  window.PKWx = { compute };
})();
