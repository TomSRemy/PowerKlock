// ════════════════════════════════════════════════════════════════════
// PPA PRICER · AGGREGATION CONTRACT FOR A PARK UNDER COMPLÉMENT DE RÉMUNÉRATION
//   The State pays the producer the complément (reference tariff − M0); Selfee
//   sells the output on the market and pays the producer an amount indexed on
//   the M0 of the technology:  A % × M0  ·  M0 − B  ·  A % × M0 − B
//   Selfee's margin per MWh = what the park earns on the day-ahead market
//                             − payment to the producer − imbalance − fixed costs
//   A and B come from the market (the park's gap to the M0, the imbalance cost)
//   and from the fixed costs, margin included.
//   Data: data/cre_m0.json (official M0 by technology, CRE; PowerKlock estimate
//   for the months not yet published), data/history/fr_hourly/YYYY.json (prices,
//   national output), data/history/fr_imbalance_cost.json, the park's own curve
//   when one is loaded in the pricer (file, or Production forecast › Price this park).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const f2 = v => v == null || !isFinite(v) ? '–' : (+v).toFixed(2);
  const f1 = v => v == null || !isFinite(v) ? '–' : (+v).toFixed(1);
  const f0 = v => v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-GB');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const Y0 = 2017;
  const S = { formula: 'ab', margin: 2, feeMWh: 0.5, feeMonth: 0, imbF: 1.5, imb: null, stop: true, years: 'recent', vol: null };
  let M0 = null, IMB = null, HOURLY = {}, loading = null, LAST = null;

  function load() {
    if (loading) return loading;
    const get = p => fetch(DATA_BASE + p).then(r => r.ok ? r.json() : null).catch(() => null);
    const yNow = new Date().getUTCFullYear();
    loading = Promise.all([get('cre_m0.json'), get('history/fr_imbalance_cost.json'),
      ...Array.from({ length: yNow - Y0 + 1 }, (_, i) => get(`history/fr_hourly/${Y0 + i}.json`).then(j => { if (j) HOURLY[Y0 + i] = j.days; }))])
      .then(([m, i]) => { M0 = m; IMB = i; });
    return loading;
  }
  // M0 of the technology for a month: official (CRE), else PowerKlock estimate
  function m0(tech, ym) {
    const o = M0 && M0.official && M0.official[tech] && M0.official[tech][ym];
    if (o != null) return { v: o, src: 'CRE' };
    const e = M0 && M0.estimate && M0.estimate[ym];
    return e && e[tech] != null ? { v: e[tech], src: 'estimate' } : null;
  }
  // national imbalance cost of the technology over the last 12 months (€/MWh produced)
  function imbNational(tech) {
    if (!IMB || !IMB.months) return tech === 'solar' ? 3.5 : 2.3;
    const ks = Object.keys(IMB.months).sort().slice(-12); let c = 0, e = 0;
    ks.forEach(k => { const x = IMB.months[k][tech]; if (x) { c += x.costEur; e += x.mwh; } });
    return e > 0 ? c / e : (tech === 'solar' ? 3.5 : 2.3);
  }
  // hourly output of the park: its own curve when the pricer has one, else the national profile of the technology
  function profile(st) {
    const tech = st.tech === 'wind' ? 'wind' : 'solar';
    if (st.asset && st.asset.slots && st.asset.slots.size) {
      const out = new Map();
      st.asset.slots.forEach((a, d) => { const h = new Array(24).fill(0); for (let q = 0; q < 96; q++) h[q >> 2] += (+a[q] || 0) / 1000; out.set(d, h); });
      return { tech, get: d => out.get(d) || null, own: true, name: st.assetName || 'your curve' };
    }
    const k = tech === 'solar' ? 's' : 'w';
    return { tech, own: false, name: `national ${tech} profile`, get: d => { const y = HOURLY[+d.slice(0, 4)]; const r = y && y[d]; return r && r[k] ? r[k] : null; } };
  }
  // month by month: what the park earned on the market against the M0
  function monthly(st) {
    const P = profile(st), rows = {};
    Object.keys(HOURLY).sort().forEach(y => Object.keys(HOURLY[y]).forEach(d => {
      const pr = HOURLY[y][d].p, g = P.get(d); if (!pr || !g) return;
      const ym = d.slice(0, 7), o = rows[ym] || (rows[ym] = { ym, e: 0, v: 0, eNeg: 0, days: 0 }); o.days++;
      for (let h = 0; h < 24; h++) { const x = +g[h] || 0, p = pr[h]; if (p == null || !x) continue;
        if (p < 0) { o.eNeg += x; if (S.stop) continue; } o.e += x; o.v += x * p; }
    }));
    return Object.values(rows).filter(r => r.e > 0 && r.days >= 25).map(r => { const m = m0(P.tech, r.ym); return m ? Object.assign(r, { price: r.v / r.e, m0: m.v, src: m.src, ratio: r.v / r.e / m.v }) : null; }).filter(Boolean).sort((a, b) => a.ym < b.ym ? -1 : 1);
  }
  // weighted least squares: park price = a × M0 + c, weights = output (the share of the M0 that hedges Selfee best)
  function wls(rows) {
    const W = rows.reduce((s, r) => s + r.e, 0), mx = rows.reduce((s, r) => s + r.e * r.m0, 0) / W, my = rows.reduce((s, r) => s + r.e * r.price, 0) / W;
    let sxy = 0, sxx = 0; rows.forEach(r => { sxy += r.e * (r.m0 - mx) * (r.price - my); sxx += r.e * (r.m0 - mx) ** 2; });
    const a = sxx > 0 ? sxy / sxx : 1; return { a, c: my - a * mx, mx, my };
  }
  // Selfee's margin per MWh in a month under a formula
  const pay = (f, A, B, m) => f === 'a' ? A * m : f === 'b' ? m - B : A * m - B;
  function solve(rows, cost, mLevel) {
    const W = rows.reduce((s, r) => s + r.e, 0), my = rows.reduce((s, r) => s + r.e * r.price, 0) / W, mx = rows.reduce((s, r) => s + r.e * r.m0, 0) / W;
    const ratio = my / mx;                                   // the park earns ratio × M0 on average (volume-weighted)
    const L = mLevel || mx;                                  // M0 level the contract is priced at
    const out = {};
    out.a = { A: (ratio * L - cost) / L, B: 0 };
    out.b = { A: 1, B: L - (ratio * L - cost) };             // = cost + gap, the gap scaled to the M0 level
    const r = wls(rows), A = Math.max(0, Math.min(1.2, r.a));
    out.ab = { A, B: A * L - (ratio * L - cost) };           // A from the hedge, B balances the margin
    return { out, ratio, mx, my, L, hedge: r };
  }
  // Monte Carlo: a contract year = for each calendar month, a month drawn from the years kept (park price and M0 of the SAME month)
  function simulate(rows, f, A, B, imb, feeMWh, feeMonthMWh, k = 1) {
    const byM = {}; rows.forEach(r => (byM[+r.ym.slice(5, 7)] = byM[+r.ym.slice(5, 7)] || []).push(r));
    const ms = Object.keys(byM).map(Number); if (ms.length < 12) return null;
    const res = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let it = 0; it < 4000; it++) { let e = 0, mg = 0;
      ms.forEach(m => { const a = byM[m], r = a[Math.floor(rnd() * a.length)], scale = r.eTyp || 1;
        const em = r.e / scale; e += em; mg += em * (k * r.price - pay(f, A, B, k * r.m0) - imb - feeMWh - feeMonthMWh); });   // fixed costs per month: spread over a typical year's output
      res.push(mg / e); }
    res.sort((a, b) => a - b); const q = p => res[Math.floor(p * (res.length - 1))];
    return { p10: q(0.1), p50: q(0.5), p90: q(0.9), loss: res.filter(x => x < 0).length / res.length };
  }

  async function run() {
    const host = $('pp-cr-body'); if (!host) return;
    const st = window.PKPpa && window.PKPpa.state; if (!st) return;
    await load();
    const P = profile(st), tech = P.tech;
    const all = monthly(st);
    if (all.length < 12) { host.innerHTML = '<div class="fuel-note">Not enough months with prices, output and an M0 to price the contract.</div>'; return; }
    const yNow = new Date().getUTCFullYear();
    const keep = r => { const y = +r.ym.slice(0, 4); return S.years === 'recent' ? y >= yNow - 3 : S.years === 'no2022' ? y !== 2022 : true; };
    const rows = all.filter(keep);
    // output scale: months of the same calendar month weigh like a typical year
    const mean = {}; rows.forEach(r => { const m = +r.ym.slice(5, 7); (mean[m] = mean[m] || []).push(r.e); });
    rows.forEach(r => { const a = mean[+r.ym.slice(5, 7)]; r.eTyp = r.e / (a.reduce((s, x) => s + x, 0) / a.length); });
    const yearE = Object.values(mean).reduce((s, a) => s + a.reduce((t, x) => t + x, 0) / a.length, 0);   // MWh in a typical year
    S.vol = S.volIn > 0 ? S.volIn : (P.own ? yearE : (st.volume || 10000));
    const nat = imbNational(tech), imb = S.imb != null ? S.imb : nat * S.imbF;
    const feeMonthMWh = S.vol > 0 ? S.feeMonth * 12 / S.vol : 0;
    const cost = imb + S.feeMWh + feeMonthMWh + S.margin;
    // M0 level for the contract: the M0 expected from the forwards (next 12 months, CRE method), else the average of the years kept
    //   weighted by the park's typical output of each calendar month (a winter M0 weighs little for solar)
    const typ = m => { const a = mean[m]; return a ? a.reduce((s, x) => s + x, 0) / a.length : 0; };
    const fc = (M0 && M0.forecast || []).filter(x => x[tech] != null).slice(0, 12).map(x => ({ v: x[tech], w: typ(+x.month.slice(5, 7)) })).filter(x => x.w > 0);
    const fcW = fc.reduce((s, x) => s + x.w, 0);
    const L = S.level === 'fwd' && fc.length >= 6 && fcW > 0 ? fc.reduce((s, x) => s + x.v * x.w, 0) / fcW : null;
    const sol = solve(rows, cost, L);
    const kL = sol.L / sol.mx, ab = sol.out[S.formula], sim = simulate(rows, S.formula, ab.A, ab.B, imb, S.feeMWh, feeMonthMWh, kL);
    const simAll = Object.fromEntries(['a', 'b', 'ab'].map(f => [f, simulate(rows, f, sol.out[f].A, sol.out[f].B, imb, S.feeMWh, feeMonthMWh, kL)]));
    LAST = { rows, all, sol, sim, cost, imb, nat, feeMonthMWh, tech, P };
    const sB = b => (b >= 0 ? '− ' : '+ ') + f2(Math.abs(b));
    const fm = f => f === 'a' ? `${f1(sol.out.a.A * 100)} % × M0` : f === 'b' ? `M0 ${sB(sol.out.b.B)} €/MWh` : `${f1(sol.out.ab.A * 100)} % × M0 ${sB(sol.out.ab.B)} €/MWh`;
    const yrs = [...new Set(rows.map(r => r.ym.slice(0, 4)))];
    $('pp-cr-kpis').innerHTML = [
      _fuelKpi('Formula to offer', S.formula === 'a' ? f1(ab.A * 100) + ' %' : S.formula === 'b' ? sB(ab.B) : f1(ab.A * 100) + ' % ' + sB(ab.B), S.formula === 'a' ? '× M0' : '€/MWh', fm(S.formula)),
      _fuelKpi('Park vs M0', f1((sol.ratio - 1) * 100), '%', `the park earns ${f1(sol.ratio * 100)} % of the M0 (${yrs[0]}–${yrs[yrs.length - 1]}, ${P.own ? 'its own curve' : 'national profile'})`),
      _fuelKpi('Costs to cover', f2(cost), '€/MWh', `imbalance ${f2(imb)} + fees ${f2(S.feeMWh + feeMonthMWh)} + margin ${f2(S.margin)}`),
      _fuelKpi('Selfee margin, P10', sim ? f2(sim.p10) : '–', '€/MWh', sim ? `P50 ${f2(sim.p50)} · P90 ${f2(sim.p90)} · loss in ${Math.round(sim.loss * 100)} % of years` : ''),
      _fuelKpi('M0 level priced', f2(sol.L), '€/MWh', L ? `expected from the forwards, next ${fc.length} months, weighted by output` : 'average of the months used')].join('');
    // the three formulas side by side
    const fx = f => { const s = simAll[f]; return `<tr${f === S.formula ? ' style="font-weight:600"' : ''}><td style="text-align:left">${f === 'a' ? 'A % × M0' : f === 'b' ? 'M0 − B' : 'A % × M0 − B'}</td><td>${fm(f)}</td><td>${s ? f2(s.p10) : '–'}</td><td>${s ? f2(s.p50) : '–'}</td><td>${s ? f2(s.p90) : '–'}</td><td>${s ? f2(s.p90 - s.p10) : '–'}</td><td>${s ? Math.round(s.loss * 100) + ' %' : '–'}</td></tr>`; };
    host.innerHTML = `<div class="fuel-grid-2"><div class="chart-container fuel-card"><div class="fuel-card-head"><div><div class="table-title">The three formulas, same expected margin</div><div class="fuel-card-sub">Selfee margin per MWh in a contract year · 4,000 years drawn month by month from ${esc(yrs.join(', '))}, scaled to the M0 level priced</div></div></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th style="text-align:left">Formula</th><th>Parameters</th><th>P10</th><th>P50</th><th>P90</th><th>Spread</th><th>Loss years</th></tr></thead><tbody>${['a', 'b', 'ab'].map(fx).join('')}</tbody></table></div>
      <div class="fuel-note">Same target margin for the three: they differ by who carries what. <b>A % × M0</b>: Selfee keeps a share of every euro, its margin rises and falls with prices. <b>M0 − B</b>: fixed discount, Selfee carries the gap between the park and the M0 in euros, which widens when prices are high. <b>A % × M0 − B</b>: A is the share of the M0 that the park really follows (${f1(sol.hedge.a * 100)} %, regression on the months kept), B balances the margin: the narrowest spread when the park does not follow the M0 one for one.</div></div>
      <div class="chart-container fuel-card"><div class="fuel-card-head"><div><div class="table-title">Park price against the M0, month by month</div><div class="fuel-card-sub">€/MWh · ${esc(P.name)}${S.stop ? ' · park stopped at prices < 0' : ''}</div></div><span class="source-badge">CRE · ENTSO-E</span></div><div style="position:relative;height:280px"><canvas id="pp-cr-chart" style="width:100%;height:280px"></canvas></div></div></div>
      <details class="pp-fold" style="margin-top:12px"><summary>Year by year: what each formula would have paid and earned</summary>${yearTable(all, sol, imb, feeMonthMWh)}</details>
      <div class="fuel-note">How A and B are set: the park's market value per MWh (output × day-ahead price of each hour${S.stop ? ', hours at negative prices not produced, as the M0 leaves them out (hours at 0 € count, at 0)' : ''}) against the M0 of the technology (CRE, PowerKlock estimate for months not yet published), on the months kept; the gap is applied as a ratio to the M0 level priced, so a discount B learned on high prices is not carried into a cheaper market. Imbalance: national ${tech} cost over the last 12 months (${f2(nat)} €/MWh, ENTSO-E) × ${f1(S.imbF)} for a single park, unless entered. Fixed costs per month are spread over ${f0(S.vol)} MWh a year. Not modelled: the complément itself (paid by the State to the producer), the rules of each contract generation at negative prices (compensation for stopping), capacity guarantees and GOs (those of a supported park belong to the State).</div>`;
    chart(all, rows);
  }
  function yearTable(all, sol, imb, feeMonthMWh) {
    const Y = {}; all.forEach(r => { const y = r.ym.slice(0, 4), o = Y[y] || (Y[y] = { e: 0, v: 0, m: 0, n: 0, neg: 0, est: false }); o.e += r.e; o.v += r.v; o.m += r.m0 * r.e; o.n++; o.neg += r.eNeg; if (r.src !== 'CRE') o.est = true; });
    const mg = (y, f) => { let e = 0, g = 0; all.filter(r => r.ym.startsWith(y)).forEach(r => { e += r.e; g += r.e * (r.price - pay(f, sol.out[f].A, sol.out[f].B, r.m0) - imb - S.feeMWh - feeMonthMWh); }); return g / e; };
    return `<div class="table-scroll"><table class="data-table"><thead><tr><th style="text-align:left">Year</th><th>Months</th><th>Park €/MWh</th><th>M0 €/MWh</th><th>Park ÷ M0</th><th>Output at < 0 €</th><th>Margin A %</th><th>Margin M0 − B</th><th>Margin A % − B</th></tr></thead><tbody>${Object.keys(Y).sort().map(y => { const o = Y[y];
      return `<tr><td style="text-align:left">${y}${o.est ? ' <span style="color:var(--tx3)">· M0 partly estimated</span>' : ''}</td><td>${o.n}</td><td>${f2(o.v / o.e)}</td><td>${f2(o.m / o.e)}</td><td>${f1(o.v / o.m * 100)} %</td><td>${f1(o.neg / (o.e + (S.stop ? o.neg : 0)) * 100)} %</td>${['a', 'b', 'ab'].map(f => { const v = mg(y, f); return `<td style="color:${v < 0 ? '#ED6965' : 'inherit'}">${f2(v)}</td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div>
      <div class="fuel-note">Margins in €/MWh with the parameters above, replayed on each past year (2022: prices of the gas crisis). Years outside the window used for A and B show how the formula would have held in another market.</div>`;
  }
  function chart(all, rows) {
    const kept = new Set(rows.map(r => r.ym));
    _fuelChart('pp-cr-chart', { type: 'line', data: { labels: all.map(r => r.ym), datasets: [
      { label: 'Park market value (€/MWh)', data: all.map(r => +r.price.toFixed(2)), borderColor: LAST.tech === 'solar' ? '#F4C430' : '#14D3A9', borderWidth: 2, pointRadius: all.map(r => kept.has(r.ym) ? 2 : 0) },
      { label: 'M0 (€/MWh)', data: all.map(r => +r.m0.toFixed(2)), borderColor: '#7FC8F8', borderWidth: 1.6, borderDash: [5, 3], pointRadius: 0 },
      { type: 'bar', label: 'Park ÷ M0 − 1 (%)', data: all.map(r => +((r.ratio - 1) * 100).toFixed(1)), backgroundColor: all.map(r => r.ratio < 1 ? 'rgba(237,105,101,.45)' : 'rgba(20,211,169,.4)'), yAxisID: 'y1' }] },
      options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh'), y1: _fuelAxis('% vs M0', { position: 'right', grid: { display: false } }) } }) }, 'cr-park-vs-m0');
  }
  function bind() {
    const num = (id, k) => { const e = $(id); if (!e) return; e.value = S[k] == null ? '' : S[k]; e.addEventListener('change', () => { S[k] = e.value === '' ? null : +e.value; run(); }); };
    const sel = (id, k) => { const e = $(id); if (!e) return; e.value = S[k]; e.addEventListener('change', () => { S[k] = e.value; run(); }); };
    num('pp-cr-margin', 'margin'); num('pp-cr-fee', 'feeMWh'); num('pp-cr-feem', 'feeMonth'); num('pp-cr-imb', 'imb'); num('pp-cr-imbf', 'imbF'); num('pp-cr-vol', 'volIn');
    sel('pp-cr-formula', 'formula'); sel('pp-cr-years', 'years'); sel('pp-cr-level', 'level');
    const st = $('pp-cr-stop'); if (st) { st.checked = S.stop; st.addEventListener('change', () => { S.stop = st.checked; run(); }); }
  }
  S.level = 'fwd'; S.volIn = null;
  document.addEventListener('DOMContentLoaded', bind);
  document.addEventListener('pk-ppa-run', () => { if ($('hs-pp-cr') && $('hs-pp-cr').offsetParent) run(); });
  document.addEventListener('pk-view', e => { if (e.detail && e.detail.key === 'ppapricer' && /M0/.test(e.detail.label)) setTimeout(run, 50); });
  window.PKPpaCR = { run, state: S, last: () => LAST };
})();
