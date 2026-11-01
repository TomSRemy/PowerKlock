// ════════════════════════════════════════════════════════════════════
// PPA PRICER · WHICH HEDGE FOR THIS PPA (buyer–aggregator side, Tom 1 Nov. 2026)
//   The buyer takes the park's output at the PPA price and sells it on the market; it hedges with France baseload
//   futures (the Cal of each delivery year). Same futures as the pricer (js/tool-ppa.js): forward path to delivery,
//   yearly output, drift of the capture rate correlated with output. Here the path runs month by month so that a
//   hedge can be changed along the way. Strategies compared on the same draws:
//     none · back to back (sell the expected volume, once) · back to back 70 % (the usual producer ratio, Pexapark)
//     · capture-adjusted delta at signing (expected volume × expected capture rate: what the PPA's value really moves
//       with when the forward moves) · minimum-variance ratio (regression of the value on the spot, in the draws)
//     · dynamic delta (the capture-adjusted delta updated each month or quarter as the capture drift becomes known)
//   Each trade costs the bid–ask entered (no public source: an assumption to enter). What one MWh of the contract
//   earns, its spread, its P10 and the premium a price at the risk accepted needs (mean − quantile) per strategy.
//   Literature: Chatziandreou & Karbach (arXiv 2607.27814, Germany 2025 out of sample): static baseload removes
//   35–45 % of the PPA's variance, dynamic delta futures 60–68 %, renewable-linked OTC claims 75–82 %.
//   Not modelled: the shape within the year (months, peak), the stop at negative hours as a separate risk, the
//   liquidity of years past the last quoted Cal.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fr = () => !window.PKI18n || PKI18n.lang !== 'en';
  const n2 = v => v == null || !isFinite(v) ? '–' : (fr() ? (+v).toFixed(2).replace('.', ',') : (+v).toFixed(2));
  const n0 = v => v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString(fr() ? 'fr-FR' : 'en-GB');
  const S = { bidask: 0.10, step: 1, N: 4000 };
  let KEY = null;

  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const qtl = (s, q) => { const r = q * (s.length - 1), lo = Math.floor(r); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (r - lo); };
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };

  // the simulation: per draw and delivery year, the month-by-month forward, the capture drift path, the output
  function simulate(o) {
    const Y = o.years, T = Y.length, N = S.N, R = rng(7), now = new Date().getUTCFullYear() + new Date().getUTCMonth() / 12;
    let spare = null; const g = () => { if (spare != null) { const v = spare; spare = null; return v; } let u = 0, v = 0; while (!u) u = R(); v = R(); const m = Math.sqrt(-2 * Math.log(u)); spare = m * Math.sin(2 * Math.PI * v); return m * Math.cos(2 * Math.PI * v); };
    const sigF = o.sigF, sigV = o.sigV, rho = o.rho, rc = Math.sqrt(1 - rho * rho), sig0 = o.sigGen != null ? o.sigGen : o.sig0;
    const tau = Y.map(r => Math.max(1 / 12, r.y + 0.5 - now)), M = Math.max(1, Math.ceil(tau[T - 1] * 12)), dt = 1 / 12;
    const step = S.step, beta = o.capBeta ? o.capBeta.beta : null;                                            // months between two rebalancings of the dynamic delta
    const kg = Y.map(r => (r.kq || 1) * (r.g || 1) * (r.sr || 1));   // the month-shape and part-year factors of the pricer
    const names = ['none', 'b2b', 'b2b70', 'delta0', 'minvar', 'dyn'];
    const U = Object.fromEntries(names.map(k => [k, new Float64Array(N)])), traded = Object.fromEntries(names.map(k => [k, 0]));
    const V = Y.map(() => new Float64Array(N)), SP = Y.map(() => new Float64Array(N)), PR = Y.map(() => new Float64Array(N));
    const HP = Object.fromEntries(['dyn'].map(k => [k, Y.map(() => new Float64Array(N))]));
    const dynTr = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      // one forward Brownian path and one capture-drift path, month by month, shared by the delivery years
      const W = new Float64Array(M + 1), X = new Float64Array(M + 1);
      for (let k = 1; k <= M; k++) { W[k] = W[k - 1] + Math.sqrt(dt) * g(); X[k] = X[k - 1] + Math.sqrt(dt) * sig0 * g(); }
      for (let t = 0; t < T; t++) {
        const r = Y[t], mt = Math.max(1, Math.round(tau[t] * 12)), sY = r.sigY || sigF, F = k => r.fwd * Math.exp(sY * W[k] - sY * sY * k * dt / 2);
        // the output, correlated with the capture drift the year ends on (as the pricer's rho: a sunnier or windier year
        // produces more and captures less)
        const zx = sig0 > 0 ? X[mt] / (sig0 * Math.sqrt(mt * dt)) : 0, zv = rho * zx + rc * g();
        const pr = r.ev * Math.min(2, Math.max(0.3, 1 + sigV * zv));
        const sdT = Math.min(0.95, Math.max(0, r.fsd + X[mt]));
        // the captured price moves with the spot by the measured sensitivity (js/tool-ppa.js captureBeta), else as a share
        const spot = F(mt), cp = beta != null ? Math.max(0, r.fwd * (1 - sdT) + beta * (spot - r.fwd)) : spot * (1 - sdT), v = pr * cp * kg[t];
        V[t][i] = v; SP[t][i] = spot; PR[t][i] = pr;
        // dynamic delta: the capture-adjusted delta with the capture drift known so far, changed every `step` months
        let pnl = 0, h = 0, tr = 0;
        for (let k = 0; k < mt; k++) {
          if (k % step === 0) { const nh = r.ev * kg[t] * (beta != null ? beta : 1 - Math.min(0.95, Math.max(0, r.fsd + X[k]))); tr += Math.abs(nh - h); h = nh; }
          pnl += h * (F(k) - F(k + 1));
        }
        tr += h;   // the position closes at delivery (the future settles on the spot): counted as one more trade
        HP.dyn[t][i] = pnl; dynTr[i] += tr;
      }
    }
    // static hedges: a position h set at signing, settled at delivery: h × (forward − spot)
    const hmv = Y.map((r, t) => { const s = SP[t], v = V[t], ms = mean(Array.from(s)), mv = mean(Array.from(v)); let c = 0, vv = 0; for (let i = 0; i < N; i++) { c += (s[i] - ms) * (v[i] - mv); vv += (s[i] - ms) ** 2; } return vv > 0 ? c / vv : 0; });
    const H = { none: Y.map(() => 0), b2b: Y.map(r => r.ev), b2b70: Y.map(r => 0.7 * r.ev), delta0: Y.map((r, t) => r.ev * kg[t] * (beta != null ? beta : 1 - r.fsd)), minvar: hmv };
    for (let i = 0; i < N; i++) {
      let den = 0; const num = Object.fromEntries(names.map(k => [k, 0]));
      Y.forEach((r, t) => {
        den += r.df * PR[t][i];
        Object.keys(H).forEach(k => { num[k] += r.df * (V[t][i] + H[k][t] * (r.fwd - SP[t][i]) - S.bidask * H[k][t]); });
        num.dyn += r.df * (V[t][i] + HP.dyn[t][i]);
      });
      num.dyn -= S.bidask * dynTr[i] * (Y.reduce((a, r) => a + r.df, 0) / Y.length);
      names.forEach(k => { U[k][i] = num[k] / den; });
    }
    Object.keys(H).forEach(k => { traded[k] = H[k].reduce((a, h) => a + h, 0); });
    traded.dyn = mean(Array.from(dynTr));
    return { names, U, traded, H, hmv, N, volume: Y.reduce((a, r) => a + r.ev, 0) };
  }

  async function run() {
    const host = $('pp-hedge-body'); if (!host || !window.PKPpa || !PKPpa.last) return;
    const o = PKPpa.last(); if (!o || !o.years || !o.years.length) return;
    const key = [o.tenor.join(','), o.st && o.st.tech, o.refW, o.sigV, o.rho, S.bidask, S.step].join('|'); if (KEY === key) return; KEY = key;
    const sm = simulate(o), alpha = (o.alpha || 25) / 100;
    const LBL = fr() ? { none: 'Pas de couverture', b2b: 'Back to back (volume attendu)', b2b70: 'Back to back 70 %', delta0: 'Delta à la signature (volume × sensibilité)', minvar: 'Ratio optimal (variance minimale)', dyn: S.step === 1 ? 'Delta dynamique (chaque mois)' : 'Delta dynamique (chaque trimestre)' }
      : { none: 'No hedge', b2b: 'Back to back (expected volume)', b2b70: 'Back to back 70 %', delta0: 'Delta at signing (volume × sensitivity)', minvar: 'Minimum-variance ratio', dyn: S.step === 1 ? 'Dynamic delta (monthly)' : 'Dynamic delta (quarterly)' };
    const st = sm.names.map(k => { const u = Array.from(sm.U[k]), s = u.slice().sort((a, b) => a - b), m = mean(u);
      return { k, m, sd: sd(u), p10: qtl(s, 0.1), p90: qtl(s, 0.9), prem: m - qtl(s, alpha), tr: sm.traded[k] }; });
    const base = st[0], best = st.slice().sort((a, b) => a.prem - b.prem)[0];
    const red = r => base.sd > 0 ? (1 - (r.sd / base.sd) ** 2) * 100 : 0;
    const ratio = k => k === 'dyn' ? '' : n0(sm.H[k].reduce((a, h) => a + h, 0) / sm.volume * 100) + ' %';
    host.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th style="text-align:left">${fr() ? 'Stratégie' : 'Strategy'}</th><th>${fr() ? 'Couvert' : 'Hedged'}</th><th>${fr() ? 'Moyenne €/MWh' : 'Mean €/MWh'}</th><th>${fr() ? 'Dispersion' : 'Spread'}</th><th>P10</th><th>${fr() ? 'Variance retirée' : 'Variance removed'}</th><th>${fr() ? 'Prime au risque accepté' : 'Premium at the risk accepted'}</th><th>${fr() ? 'MWh échangés' : 'MWh traded'}</th></tr></thead><tbody>${st.map(r => `<tr${r.k === best.k ? ' style="font-weight:600"' : ''}><td style="text-align:left">${LBL[r.k]}</td><td>${ratio(r.k) || (fr() ? 'variable' : 'varies')}</td><td>${n2(r.m)}</td><td>${n2(r.sd)}</td><td>${n2(r.p10)}</td><td>${r.k === 'none' ? '–' : n0(red(r)) + ' %'}</td><td>${n2(r.prem)}</td><td>${n0(r.tr)}</td></tr>`).join('')}</tbody></table></div>
      <div class="fuel-note">${fr()
        ? `<b>Conseil : ${LBL[best.k]}</b>, la prime la plus faible (${n2(best.prem)} €/MWh contre ${n2(base.prem)} sans couverture et ${n2(st[1].prem)} en back to back), coût d’échange de ${n2(S.bidask)} €/MWh compris. Le back to back vend tout le volume attendu ; la valeur du PPA, elle, suit le marché à hauteur de la sensibilité mesurée du prix capté (${o.capBeta ? n2(o.capBeta.beta) : '–'} € par € de prix base, même mois d’une année à l’autre depuis ${o.capBeta ? o.capBeta.from : '–'}) : couvert ${n0(sm.H.b2b.reduce((a, h) => a + h, 0) / sm.volume * 100)} % contre un delta de ${n0(sm.H.delta0.reduce((a, h) => a + h, 0) / sm.volume * 100)} %. Le delta dynamique n’apporte rien de plus ici : cette simulation annuelle ne connaît pas la météo de l’année avant la livraison. Ici, le risque compté va jusqu’à la livraison : le niveau du prix y pèse le plus, et un Cal le retire presque entièrement. La recherche mesure plutôt le risque qui reste à l’intérieur de l’année livrée, forme horaire et météo (Allemagne 2025 : un Cal statique en retire 35 à 45 %, un delta dynamique 60 à 68 %), que cette simulation annuelle ne voit pas, pas plus que la liquidité des années non cotées.`
        : `<b>Advice: ${LBL[best.k]}</b>, the lowest premium (${n2(best.prem)} €/MWh against ${n2(base.prem)} unhedged and ${n2(st[1].prem)} back to back), a trading cost of ${n2(S.bidask)} €/MWh included. Back to back sells the whole expected volume; the PPA's value follows the market by the measured sensitivity of the captured price (${o.capBeta ? n2(o.capBeta.beta) : '–'} € per € of baseload, same month a year apart since ${o.capBeta ? o.capBeta.from : '–'}): hedged ${n0(sm.H.b2b.reduce((a, h) => a + h, 0) / sm.volume * 100)} % against a delta of ${n0(sm.H.delta0.reduce((a, h) => a + h, 0) / sm.volume * 100)} %. The dynamic delta adds nothing here: this yearly simulation does not know the year's weather before delivery. Here the risk counted runs to delivery: the price level weighs most, and a Cal removes almost all of it. Research rather measures the risk left within the delivery year, hourly shape and weather (Germany 2025: a static Cal removes 35–45 % of it, a dynamic delta 60–68 %), which this yearly simulation does not see, nor the liquidity of unquoted years.`}</div>`;
    // short names in the chart (390 px), full ones in the table
    const SH = fr() ? { none: 'Aucune', b2b: 'Back to back', b2b70: 'B2B 70 %', delta0: 'Delta signature', minvar: 'Variance min.', dyn: 'Delta dynamique' }
      : { none: 'None', b2b: 'Back to back', b2b70: 'B2B 70 %', delta0: 'Delta at signing', minvar: 'Min. variance', dyn: 'Dynamic delta' };
    _fuelChart('pp-hedge-chart', { type: 'bar', data: { labels: st.map(r => SH[r.k]), datasets: [
      { label: fr() ? 'P10 – P90' : 'P10 – P90', data: st.map(r => [+r.p10.toFixed(2), +r.p90.toFixed(2)]), backgroundColor: st.map(r => r.k === best.k ? 'rgba(127,200,248,.95)' : 'rgba(159,180,199,.85)'), barThickness: 2, order: 3 },
      { type: 'line', label: '_lo', data: st.map(r => +r.p10.toFixed(2)), showLine: false, pointStyle: 'line', rotation: 90, pointRadius: 7, borderWidth: 2, borderColor: 'rgba(159,180,199,.95)', order: 2 },
      { type: 'line', label: '_hi', data: st.map(r => +r.p90.toFixed(2)), showLine: false, pointStyle: 'line', rotation: 90, pointRadius: 7, borderWidth: 2, borderColor: 'rgba(159,180,199,.95)', order: 2 },
      { type: 'line', label: fr() ? 'Moyenne' : 'Mean', data: st.map(r => +r.m.toFixed(2)), showLine: false, pointRadius: 5, pointStyle: 'rectRot', borderColor: '#D4BE96', backgroundColor: '#D4BE96', order: 1 }] },
      options: _fuelOpts({ indexAxis: 'y', plugins: { legend: { display: true, position: 'bottom', labels: { color: '#B8C9D9', font: { size: 10 }, boxWidth: 10, filter: it => !/^_/.test(it.text) } }, pkHoverReadout: false }, scales: { y: Object.assign(_fuelXAxis(), { grid: { display: false }, ticks: { autoSkip: false, font: { size: 10 } } }), x: _fuelAxis(fr() ? 'ce que rapporte un MWh, €/MWh' : 'what one MWh earns, €/MWh') } }) }, 'ppa-hedge-strategies');
  }
  function bind() {
    const b = $('pp-hedge-bidask'); if (b) { b.value = S.bidask; b.addEventListener('change', () => { const v = parseFloat(b.value); S.bidask = isFinite(v) && v >= 0 ? v : 0.10; run(); }); }
    const s = $('pp-hedge-step'); if (s) { s.value = String(S.step); s.addEventListener('change', () => { S.step = +s.value || 1; run(); }); }
  }
  document.addEventListener('DOMContentLoaded', bind);
  document.addEventListener('pk-ppa-run', () => { if ($('hs-pp-hedge') && $('hs-pp-hedge').offsetParent) setTimeout(run, 30); });
  window.PKPpaHedge = { run, state: S };
})();
