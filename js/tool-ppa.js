// ════════════════════════════════════════════════════════════════════
// TOOLS › PPA PRICER (France, solar or wind, pay-as-produced)
// Two methods, same data:
//  · Step by step (default) — every chart of the page is a step of the price:
//      1 forwards       France Cal baseload (market data), editable
//      2 cannibalisation shape discount = 1 − capture price ÷ baseload, per
//                       year (national RTE × day-ahead, or the asset curve ×
//                       France quarter-hour prices), projected over the tenor —
//                       by default from installed capacity (log fit, PPE3 path)
//      3 capture value  Σ forward × k × (1 − projected discount), k = quoted-month factor, weighted by the
//                       expected production and a discount factor
//      4 risk premium   Monte Carlo (10,000 trajectories: forward path,
//                       production, cannibalisation drift, correlated): the
//                       price whose chance of loss equals the risk accepted
//      5 PPA price      = value at risk − imbalance + GO − margin
//  · PPA Dashboard — the team's Streamlit formula: Forward − Forward × (shape
//      discount at a percentile of history + add. discount + volume risk +
//      price risk) − imbalance + GO − margin (the Streamlit tool added it; deducted here like every method)
// Every input is filled automatically (shown as placeholder, "auto · source");
// a typed value overrides it, ↺ goes back to the automatic one.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const get = path => fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => null);
  const thisYear = () => +(typeof pkTodayISO === 'function' ? pkTodayISO() : new Date().toISOString()).slice(0, 4);
  const nowFrac = () => { const d = new Date(); const y = d.getUTCFullYear(); return y + (d - Date.UTC(y, 0, 1)) / (365.25 * 864e5); };
  // null = automatic value
  const S = { curtPct: 50, tech: 'solar', years: null, pct: 74, pdMode: 'projected', pdYears: 3, tenorStart: null, tenorEnd: null, m0: 1, m1: 12, fwd: {}, method: 'build', model: 'capacity', conv: 'curt', hedge: 'hedged',
    mw: null, volume: null, degr: null, alpha: null, imb: null, go: null, margin: null, disc: null, add: null, volRisk: null, priceRisk: null,
    mcVol: null, mcFwd: null, mcSd: null, rho: null, volStress: null, spotStress: null, asset: null, assetName: '', basis: 'asset' };
  let D = null;   // reference data
  const S0 = JSON.parse(JSON.stringify(S));   // defaults, for the site charts (Renewables › Cannibalisation)

  // ── Maths ─────────────────────────────────────────────────────────
  function percentile(arr, p) {   // numpy linear interpolation
    const a = arr.filter(v => v != null && isFinite(v)).slice().sort((x, y) => x - y);
    if (!a.length) return null; if (a.length === 1) return a[0];
    const r = (p / 100) * (a.length - 1), lo = Math.floor(r), hi = Math.ceil(r);
    return a[lo] + (a[hi] - a[lo]) * (r - lo);
  }
  function linreg(xs, ys) {
    const n = xs.length; if (n < 2) return { sl: 0, ic: ys.length ? ys[0] : 0.15, r2: 0 };
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    const sl = sxx ? sxy / sxx : 0; return { sl, ic: my - sl * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
  }
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const std = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ── Reference data ────────────────────────────────────────────────
  async function load() {
    if (D) return D;
    // the methods' weights in the published average (scripts/ppa_weights.py): inverse of their past error, solar
    const pwts = get('history/ppa_weights.json').catch(() => null);
    const [cap, mkt, goCsv, capa, chain, imbc, ccap, hcan, fcst, fwm, pbias] = await Promise.all([get('history/fr_capture.json'), get('fr_market.json'), fetch(DATA_BASE + 'go_prices.csv').then(r => r.ok ? r.text() : '').catch(() => ''), get('history/capacity.json'), get('history/fr_market_calchain.json'), get('history/fr_imbalance_cost.json'), get('history/country_capture.json'), get('history/hourly_cannib.json'), get('history/ppa_forecast.json'), get('history/fr_forward_monthly.json'), get('history/ppa_bias.json')]);
    const fwd = {};
    ((mkt && mkt.forwardCurve) || []).forEach(r => { const m = /Cal\s?(\d{4})/.exec(r.contract || ''); if (m && r.value != null) fwd[+m[1]] = r.value; });
    // GO: latest Commerg mid per production year (AIB renewable)
    const go = {};
    goCsv.split(/\r?\n/).slice(1).forEach(l => { const c = l.split(','); if (c.length < 8 || !/Renewable/i.test(c[4])) return; const bid = parseFloat(c[6]), ask = parseFloat(c[7]); const mid = isFinite(bid) && isFinite(ask) ? (bid + ask) / 2 : isFinite(bid) ? bid : null; if (mid != null && (!go[c[5]] || c[1] >= go[c[5]].d)) go[c[5]] = { d: c[1], v: mid }; });
    // installed capacity (GW) by year: RTE (ODRÉ) for French solar and wind, Energy-Charts otherwise (data/history/capacity.json)
    const fr = capa && capa.countries && capa.countries.FR, capGW = { solar: {}, wind: {} };
    if (fr) fr.years.forEach((y, i) => { const t = fr.types; const s = t['Solar AC'] && t['Solar AC'][i]; const w = (t['Wind onshore'] && t['Wind onshore'][i] || 0) + (t['Wind offshore'] && t['Wind offshore'][i] || 0); if (s) capGW.solar[y] = s; if (w) capGW.wind[y] = w; });
    // forward volatility: France Cal+1 daily settlements
    let fwdVol = null, fwdVolN = 0;
    const c1 = chain && chain.FR && chain.FR.rolling && chain.FR.rolling['Cal+1'];
    if (c1 && c1.values) { const v = c1.values.filter(x => x > 0), r = []; for (let i = 1; i < v.length; i++) r.push(Math.log(v[i] / v[i - 1])); if (r.length > 40) { fwdVol = std(r) * Math.sqrt(252); fwdVolN = r.length; } }
    const F = cap ? cap.fields : [], ix = Object.fromEntries(F.map((f, i) => [f, i + 1]));
    // national imbalance cost per technology, last 12 months with data (scripts/fetch_fr_imbalance_cost.py)
    const imbCost = {};
    if (imbc && imbc.months) ['solar', 'wind'].forEach(k => { const ms = Object.keys(imbc.months).filter(m => imbc.months[m][k]).sort().slice(-12); let c = 0, e = 0; ms.forEach(m => { c += imbc.months[m][k].costEur; e += imbc.months[m][k].mwh; }); if (ms.length >= 3 && e > 0) imbCost[k] = { v: c / e, n: ms.length, from: ms[0], to: ms[ms.length - 1] }; });
    const fwdRows = ((mkt && mkt.forwardCurve) || []).filter(r => r.value != null).map(r => ({ contract: r.contract, value: r.value }));
    D = { hc: hcan || null, cc: (ccap && ccap.countries) || null, fwdRows, imbCost, cap: (cap && cap.days) || [], ix, profile: (cap && cap.profile) || {}, capGW, fwd, fwdDate: mkt && mkt.forwardCurve && mkt.forwardCurve[0] && mkt.forwardCurve[0].date, go, fwdVol, fwdVolN,
      fcst: fcst || null, fwRatio: (fwm && fwm.ratios && fwm.ratios.year) || null, fwM: (fwm && fwm.months) || null, bias: pbias || null };
    D.weights = await pwts;
    // hours with a day-ahead price at or below zero, per year (YTD annualised): the hours the PPA Dashboard convention leaves unpaid
    const negH = {}, ix2 = D.ix;
    D.cap.forEach(r => { const y = +r[0].slice(0, 4), e = negH[y] || (negH[y] = { h: 0, d: 0 }); e.h += (r[ix2.pN] - r[ix2.pNPos]) / 4; e.d++; });
    Object.entries(negH).forEach(([y, e]) => { e.ann = e.h * (+y % 4 ? 365 : 366) / e.d; if (e.d < 20) delete negH[y]; });
    D.negH = negH;
    return D;
  }

  const FRDOC = () => !window.PKI18n || PKI18n.lang !== 'en';
  // one sentence on the method's past-bias correction (scripts/ppa_bias.py), in the page's language
  function biasLine(o, k) {
    if (!o || !o.biasOf) return '';
    const v = o.tenor.map(y => [y, o.biasOf(k, y)]).filter(([, b]) => b);
    const fr = FRDOC(), p = b => (b > 0 ? '−' : '+') + (Math.abs(b) * 100).toFixed(1).replace('.', fr ? ',' : '.') + (fr ? ' pt' : ' pts');
    if (!v.length) return fr ? ' Pas de correction de biais pour cette méthode ici : sur les erreurs passées, elle n’améliorait pas ses prix (scripts/ppa_bias.py).' : ' No bias correction for this method here: on its past errors it did not improve its prices (scripts/ppa_bias.py).';
    return fr ? ` Correction de biais : sa capture est corrigée de son erreur moyenne passée, à la même distance du dernier exercice complet (années livrées 2018–2025 hors 2022, pricées avec les seules années connues alors) : ${v.map(([y, b]) => y + ' ' + p(b)).join(', ')} ; au rejeu 2024–2026, cette correction réduit son erreur moyenne sur 1 à 3 ans (scripts/ppa_bias.py).`
      : ` Bias correction: its capture is corrected by its mean past error at the same distance from the last complete year (delivery years 2018–2025 without 2022, priced with only the years known then): ${v.map(([y, b]) => y + ' ' + p(b)).join(', ')}; on the 2024–2026 replay this lowers its mean error over 1 to 3 years (scripts/ppa_bias.py).`;
  }
  // the methodology of the European price model, in the page's language
  function euDoc(o) {
    const caps = o.eu ? o.eu.map(x => `${x.y} ${pc(x.capture)}`).join(', ') : null;
    return FRDOC() ? `<h4>Modèle européen</h4>
<ol>
<li><b>Prix horaires.</b> Le prix de chaque heure ÷ la moyenne du mois, en fonction de la charge résiduelle de la France, de l’Allemagne, de la Belgique et de l’Espagne ensemble (consommation − solaire − éolien − nucléaire, ÷ consommation), par saison × moment de la journée, appris sur les cinq dernières années complètes (banc d’essai, scripts/ppa_lab.py). Le parc de chaque année de livraison est posé sur chaque année météo passée : la cannibalisation sort des prix horaires, pas d’une tendance.</li>
<li><b>Capture des années du ténor</b>, mois par mois (data/history/ppa_forecast.json, mis à jour chaque dimanche), pondérée par la production de chaque mois (× sa part payée quand la production est arrêtée aux prix ≤ 0) et par le forward de chaque mois ÷ Cal (mois coté, sinon trimestre, saison, puis Cal découpé par l’historique) : ${caps || 'pas de prévision pour ce ténor (le banc d’essai s’arrête en 2030)'}.</li>
<li><b>Prix du PPA</b> = Σ poids × forward Cal × capture − la prime de risque de la tendance de capacité (même Monte Carlo, ${f2(o.premium)} €/MWh) − décote additionnelle − écarts + GO − marge${o.eu ? ` = <code>${f2(o.ppaEu)} €/MWh</code>` : ''}, pour comparer les méthodes à l’identique.</li>
<li><b>Correction de biais.</b>${biasLine(o, 'regional')}</li>
<li><b>Flexibilité et voisins.</b> Éolien : les batteries ajoutées depuis la dernière année complète chargent aux heures de charge résiduelle la plus basse de la région et rendent 85 % aux plus hautes, chaque jour. France au-delà des ~0,7 GW qui servent les réserves (Bilan prévisionnel 2025 de RTE : socle +0,3 GW par an, 2 h, puis +5 GW d’ici 2035, 4 h) ; Allemagne selon le parc d’Energy-Charts, compté à 50 % (surtout des batteries domestiques). Les classes de niveau de prix (sous 60 €, 60–110, au-dessus) se fondent progressivement à ±15 € des seuils. Solaire : ni l’un ni l’autre, ils dégradaient l’erreur rejouée (scripts/ppa_storage_test.py, scripts/ppa_level_soft_test.py). L’Espagne et l’Allemagne ne dépassent pas la trajectoire vers leurs objectifs 2030 (PNIEC : 76 GW solaire, 62 GW éolien ; EEG : 215 GW solaire, 145 GW éolien).</li>
<li><b>Limites.</b> Même avec ces batteries, la région sature à midi à partir de 2028 environ : quelques GW déplacés sur 2 à 4 h n’absorbent pas un surplus de plusieurs dizaines de GW sur toute la journée (constat du Bilan prévisionnel de RTE) ; ils relèvent surtout la capture des heures payées. La capacité française ne fait presque plus bouger cette méthode. Pricée 1, 2 et 3 ans à l’avance sur 2024–2026, elle tient mieux que les méthodes de tendance à 3 ans (scripts/ppa_horizon_test.py).</li>
</ol>` : `<h4>European price model</h4>
<ol>
<li><b>Hourly prices.</b> The price of each hour ÷ the month’s average, as a function of the residual load of France, Germany, Belgium and Spain together (consumption − solar − wind − nuclear, ÷ consumption), by season × time of day, learnt on the last five complete years (test bench, scripts/ppa_lab.py). The fleet of each delivery year is put over every past weather year, so cannibalisation comes out of the hourly prices, not out of a trend.</li>
<li><b>Capture of the tenor years</b>, month by month (data/history/ppa_forecast.json, updated every Sunday), weighted by each month’s output (× its paid share when output stops at prices ≤ 0) and by each month’s forward ÷ Cal (the month quoted, else its quarter, season, then the Cal shaped by history): ${caps || 'no forecast for this tenor (the test bench stops in 2030)'}.</li>
<li><b>PPA price</b> = Σ weight × Cal forward × capture − the capacity trend’s risk premium (same Monte Carlo, ${f2(o.premium)} €/MWh) − additional discount − imbalance + GO − margin${o.eu ? ` = <code>${f2(o.ppaEu)} €/MWh</code>` : ''}, so the methods compare like for like.</li>
<li><b>Bias correction.</b>${biasLine(o, 'regional')}</li>
<li><b>Flexibility and neighbours.</b> Wind: the batteries added since the last complete year charge in the region’s lowest residual-load hours and give back 85 % in the highest, every day. France beyond the ~0.7 GW serving reserves (RTE Bilan prévisionnel 2025: base +0.3 GW a year, 2 h, then +5 GW by 2035, 4 h); Germany from Energy-Charts’ fleet, counted at 50 % (mostly home batteries). The price-level classes (below 60 €, 60–110, above) blend gradually within ±15 € of the thresholds. Solar: neither, they made the replayed error worse (scripts/ppa_storage_test.py, scripts/ppa_level_soft_test.py). Spain and Germany do not go beyond the path to their 2030 targets (PNIEC: 76 GW solar, 62 GW wind; EEG: 215 GW solar, 145 GW wind).</li>
<li><b>Limits.</b> Even with these batteries the region is saturated at midday from about 2028: a few GW moved over 2 to 4 h do not absorb a surplus of tens of GW over the whole day (as RTE’s Bilan prévisionnel finds); they mostly raise the capture of the paid hours. France’s own capacity barely moves this method. Priced 1, 2 and 3 years ahead on 2024–2026, it holds better than the trend methods at 3 years (scripts/ppa_horizon_test.py).</li>
</ol>`;
  }

  // European price model, year by year on the tenor: capture of each month (data/history/ppa_forecast.json,
  // 'regional') weighted by its output (× its paid share when curtailed at prices ≤ 0) and by the month's
  // quoted forward ÷ Cal (quotedShape), so that × the Cal forward it gives the value of one MWh. The asset's own monthly
  // shape and its capture gap to the national profile (last three complete years) when its curve is used.
  // null when a month of the tenor has no forecast (the test bench forecasts up to 2030).
  // The forward of each month ÷ its Cal, as the rest of the tool reads it (fr_forward_monthly.json: the month
  // quoted, else its quarter or season, else the Cal, shaped by the day-ahead's history); null without a quote.
  function quotedShape(y) {
    const M = D.fwM; if (!M) return null;
    const v = [], h = [];
    for (let m = 1; m <= 12; m++) { const e = M[`${y}-${String(m).padStart(2, '0')}`]; if (!e || !(e.value > 0)) return null; v.push(e.value); h.push(new Date(Date.UTC(y, m, 0)).getUTCDate()); }
    const cal = v.reduce((a, x, i) => a + x * h[i], 0) / h.reduce((a, b) => a + b, 0);
    return v.map(x => x / cal);
  }
  // Quoted-shape factor of a delivery year: the value of the asset's output on the quoted months ÷ its value on
  // the flat Cal with the day-ahead's historical seasonal shape (the one the capacity trend's yearly capture carries):
  //   k = Σ w × (F_m ÷ Cal) × c_m ÷ Σ w × (r_m ÷ r̄) × c_m,  w = output share × paid share, c_m = the blend's monthly capture
  // 1 when no month, quarter or season of the year is quoted (both sides are then the Cal × the same ratios).
  function shapeFactors(o, st) {
    const conv = st.conv === 'all' ? 'all' : 'curt';
    const f = D.fcst && D.fcst.forecast && D.fcst.forecast[st.tech] && D.fcst.forecast[st.tech][conv];
    const nat = D.fcst && D.fcst.share && D.fcst.share[st.tech], ratio = D.fwRatio;
    return o.tenor.map(y => {
      const q = quotedShape(y);
      if (!q || !f || !nat || !ratio) return 1;
      const dm = m => new Date(Date.UTC(y, m, 0)).getUTCDate();
      let rn = 0, hn = 0; for (let m = 1; m <= 12; m++) { rn += ratio[m] * dm(m); hn += dm(m); } rn /= hn;
      let a = 0, b = 0;
      for (let m = 1; m <= 12; m++) {
        const e = f[`${y}-${String(m).padStart(2, '0')}`]; if (!e || e.hybrid == null || ratio[m] == null) return 1;
        const w = nat[m] * (conv === 'curt' ? e.paid : 1);
        a += w * q[m - 1] * e.hybrid; b += w * ratio[m] / rn * e.hybrid;
      }
      return b > 0 ? a / b : 1;
    });
  }
  // A delivery that covers only some months of a year. The capacity trend and the past discount project one yearly
  // capture rate; the months delivered are worth more or less than the year (solar: summer cheap, winter dear), so
  //   g  = value of one MWh on the months delivered ÷ on the whole year
  //      = (Σ_M w q c ÷ Σ_M w) ÷ (Σ_all w q c ÷ Σ_all w),  w = output share × paid share, q = month's forward ÷ Cal
  //        (quoted, else the day-ahead's history), c = the month's capture rate forecast (the blend's)
  //   sh = the months' share of the year's output (national profile)
  // g = sh = 1 on a whole year; g = 1 when the monthly forecast is missing.
  function partFactors(tenor, monthsOf, st) {
    const conv = st.conv === 'all' ? 'all' : 'curt';
    const f = D.fcst && D.fcst.forecast && D.fcst.forecast[st.tech] && D.fcst.forecast[st.tech][conv];
    const nat = D.fcst && D.fcst.share && D.fcst.share[st.tech], ratio = D.fwRatio;
    return tenor.map(y => {
      const M = monthsOf(y);
      if (M.length === 12) return { g: 1, sh: 1 };
      const sh = nat ? M.reduce((a, m) => a + (nat[m] || 0), 0) / Math.max(1e-9, Object.values(nat).reduce((a, b) => a + (b || 0), 0)) : M.length / 12;
      if (!f || !nat || !ratio) return { g: 1, sh };
      const q = quotedShape(y);
      let rn = 0, hn = 0; for (let m = 1; m <= 12; m++) { const dm = new Date(Date.UTC(y, m, 0)).getUTCDate(); rn += ratio[m] * dm; hn += dm; } rn /= hn;
      let aA = 0, wA = 0, aM = 0, wM = 0;
      for (let m = 1; m <= 12; m++) {
        const e = f[`${y}-${String(m).padStart(2, '0')}`]; if (!e || e.hybrid == null || ratio[m] == null) return { g: 1, sh };
        const w = nat[m] * (conv === 'curt' ? e.paid : 1), v = (q ? q[m - 1] : ratio[m] / rn) * e.hybrid;
        aA += w * v; wA += w; if (M.includes(m)) { aM += w * v; wM += w; }
      }
      return { g: wM > 0 && aA > 0 ? (aM / wM) / (aA / wA) : 1, sh };
    });
  }
  function euYears(o, st, fld = 'regional') {   // fld: 'regional' (central), 'p10' / 'p90' (the simulated weather's spread)
    const conv = st.conv === 'all' ? 'all' : 'curt';
    const f = D.fcst && D.fcst.forecast && D.fcst.forecast[st.tech] && D.fcst.forecast[st.tech][conv];
    const nat = D.fcst && D.fcst.share && D.fcst.share[st.tech], ratio = D.fwRatio;
    if (!f || !nat || !ratio) return null;
    let sh = m => nat[m], gap = 0;
    if (o.useAsset && st.asset && st.asset.slots) {
      const acc = Array(13).fill(0);
      st.asset.slots.forEach((row, d) => { const m = +String(d).slice(5, 7); row.forEach(v => { if (v) acc[m] += v; }); });
      const tot = acc.reduce((a, b) => a + b, 0);
      if (tot > 0 && acc.slice(1).every(v => v > 0)) sh = m => acc[m] / tot;
      const natY = new Map((o.nat || []).map(x => [x.year, x]));
      const ys = (o.ast || []).filter(x => x.complete && x.cpPct != null && natY.has(x.year) && natY.get(x.year).cpPct != null).slice(-3);
      if (ys.length) gap = mean(ys.map(x => x.cpPct - natY.get(x.year).cpPct));
    }
    const out = [];
    for (const y of o.tenor) {
      let num = 0, den = 0;
      const q = quotedShape(y);   // the quoted months ÷ Cal, else the day-ahead's historical month ÷ year ratios
      let rn = 0, hn = 0; for (let m = 1; m <= 12; m++) { const dm = new Date(Date.UTC(y, m, 0)).getUTCDate(); rn += ratio[m] * dm; hn += dm; } rn /= hn;
      const Mo = o.monthsOf ? o.monthsOf(y) : null;
      for (let m = 1; m <= 12; m++) {
        if (Mo && !Mo.includes(m)) continue;   // a year delivered in part: its months only
        const e = f[`${y}-${String(m).padStart(2, '0')}`];
        if (!e || e[fld] == null || ratio[m] == null) return null;
        const w = sh(m) * (conv === 'curt' ? e.paid : 1);
        num += w * (q ? q[m - 1] : ratio[m] / rn) * (e[fld] + gap); den += w;
      }
      if (!(den > 0)) return null;
      const b = o.biasOf ? o.biasOf('regional', y) : 0;
      out.push({ y, capture: num / den - b, bias: b });
    }
    return out;
  }

  // Column indexes of a day row for the technology and convention:
  // 'curt' = curtailment: output at prices ≤ 0 is stopped and not paid; capture over the paid hours against the
  //          baseload of every hour (the Cal settles on every hour)
  // 'all'  = no curtailment: every hour produced and paid, negative prices included
  // 'pos'  = PPA Dashboard convention (legacy): hours ≤ 0 left out of the capture AND of the baseload
  function cols(st = S) {
    const t = st.tech === 'solar' ? 's' : 'w', c = st.conv, ix = D.ix, pe = c === 'all' ? '' : 'Pos', pb = c === 'pos' ? 'Pos' : '';
    return { E: ix[t + 'E' + pe], R: ix[t + 'R' + pe], P: ix['pSum' + pb], N: ix['pN' + pb], Eall: ix[t + 'E'] };
  }
  // Sum a set of day rows → capture price, baseload, capture rate
  function agg(rows, st = S) {
    const c = cols(st); let E = 0, R = 0, P = 0, N = 0, Ea = 0;
    rows.forEach(r => { E += r[c.E]; R += r[c.R]; P += r[c.P]; N += r[c.N]; Ea += r[c.Eall]; });
    const base = N ? P / N : null, cp = E ? R / E : null;
    return { base, cp, cpPct: cp != null && base > 0 ? cp / base : null, E, Ea };
  }
  // National capture history per year (RTE output × day-ahead price), with the load factor
  function nationalYears(st = S) {
    const by = {}; D.cap.forEach(r => { (by[r[0].slice(0, 4)] = by[r[0].slice(0, 4)] || []).push(r); });
    return Object.keys(by).map(Number).sort().map(y => { const a = agg(by[y], st), gw = D.capGW[st.tech][y];
      return { year: y, base: a.base, cp: a.cp, cpPct: a.cpPct, sd: a.cpPct != null ? 1 - a.cpPct : null, days: by[y].length, complete: y < thisYear() && by[y].length >= 360,
        lf: gw ? a.Ea / 4 / (gw * 1000 * 24 * by[y].length) : null, negShare: (() => { const t = st.tech === 'solar' ? 's' : 'w'; let ep = 0, ea = 0; by[y].forEach(r => { ep += r[D.ix[t + 'EPos']]; ea += r[D.ix[t + 'E']]; }); return ea ? Math.max(0, 1 - ep / ea) : null; })() }; })
      .filter(x => x.cpPct != null);
  }
  // Rolling capture rate and price over 30 / 90 / 365 days (national)
  function rolling(st = S) {
    const c = cols(st), rows = D.cap, n = rows.length, cum = [[0, 0, 0, 0]];
    rows.forEach((r, i) => { const p = cum[i]; cum.push([p[0] + r[c.E], p[1] + r[c.R], p[2] + r[c.P], p[3] + r[c.N]]); });
    const win = w => rows.map((r, i) => { if (i + 1 < w) return null; const a = cum[i + 1], b = cum[i + 1 - w]; const E = a[0] - b[0], R = a[1] - b[1], P = a[2] - b[2], N = a[3] - b[3];
      const base = N ? P / N : null, cp = E ? R / E : null; return { cp, base, pct: cp != null && base > 0 ? cp / base : null }; });
    return { days: rows.map(r => r[0]), w30: win(30), w90: win(90), w365: win(365) };
  }
  // Asset capture history: curve × France quarter-hour prices
  async function assetYears(st = S) {
    const slots = st.asset.slots, days = [...slots.keys()].sort(), years = [...new Set(days.map(d => d.slice(0, 4)))];
    const files = await Promise.all(years.map(y => get('history/fr_prices/' + y + '.json')));
    const P = {}; files.forEach(f => { if (f && f.days) Object.assign(P, f.days); });
    const acc = {};
    const pos = st.conv === 'pos', curt = st.conv === 'curt';
    days.forEach(d => { const p = P[d]; if (!p) return; const c = slots.get(d), y = +d.slice(0, 4), a = acc[y] || (acc[y] = { n: 0, bs: 0, bn: 0, e: 0, rev: 0, all: 0, neg: 0 }); a.n++;
      for (let q = 0; q < 96; q++) { if (p[q] == null) continue; const e = c[q] || 0; a.all += e;
        if (curt && p[q] <= 0) { a.neg += e; a.bs += p[q]; a.bn++; continue; }   // curtailed: not produced, not paid; the baseload keeps the hour
        if (pos && p[q] <= 0) { a.neg += e; continue; }   // PPA Dashboard convention: hours ≤ 0 €/MWh left out
        a.bs += p[q]; a.bn++; if (!e) continue; a.e += e; a.rev += e * p[q]; } });
    return Object.keys(acc).map(Number).sort().map(y => { const a = acc[y], base = a.bs / a.bn, cp = a.e ? a.rev / a.e : null;
      return { year: y, base, cp, cpPct: cp != null && base > 0 ? cp / base : null, sd: cp != null && base > 0 ? 1 - cp / base : null, days: a.n, mwh: a.e / 1000, mwhAll: a.all / 1000, negMwh: a.neg / 1000, complete: a.n >= 330 && y < thisYear() }; })
      .filter(x => x.cpPct != null);
  }

  // ── Installed capacity: observed, then a straight line to the PPE3 targets ──
  const PPE3 = { solar: { 2030: 48.0, 2035: 67.5 }, wind: { 2030: 31.0, 2035: 37.5 } };
  function capPath(tech) {
    const obs = D.capGW[tech], ys = Object.keys(obs).map(Number).sort(), last = ys[ys.length - 1];
    const pts = [[last, obs[last]]].concat(Object.entries(PPE3[tech]).map(([y, g]) => [+y, g]).filter(([y]) => y > last));
    return y => {
      if (obs[y] != null) return obs[y];
      if (y < ys[0]) return obs[ys[0]];
      for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) { const [y0, g0] = pts[i - 1], [y1, g1] = pts[i]; return g0 + (g1 - g0) * (y - y0) / (y1 - y0); }
      const [ya, ga] = pts[pts.length - 2] || pts[0], [yb, gb] = pts[pts.length - 1];   // after 2035: same yearly pace
      return gb + (yb > ya ? (gb - ga) / (yb - ya) : 0) * (y - yb);
    };
  }
  // Capture rate against installed capacity: log fit on complete national years
  function capacityFit(nat, years, tech) {
    const cap = D.capGW[tech];
    let use = nat.filter(x => x.complete && cap[x.year] && years.includes(x.year));
    if (use.length < 2) use = nat.filter(x => x.complete && cap[x.year]).slice(-3);
    if (use.length < 2) return null;
    const r = linreg(use.map(x => Math.log(cap[x.year])), use.map(x => x.cpPct));
    return { f: gw => r.ic + r.sl * Math.log(gw), r2: r.r2, sl: r.sl, use: use.map(x => x.year) };
  }

  async function compute(st = S) {
    await load();
    // Partial stop at prices ≤ 0 (contract parameter, decided 27 Oct. 2026): a share k of the output at those hours is
    // stopped and not paid, the rest runs and is paid the negative price. Each method is priced with full stop and with
    // no stop; its price per paid MWh is the blend of the two revenues over the paid volume:
    //   p = ((1 − k) × p_all + k × p_stop × (1 − s)) ÷ (1 − k × s),  s = share of the output at prices ≤ 0 (weighted over the tenor)
    // The charts and tables show the full-stop case.
    if (st.conv === 'part') {
      const k = clamp((st.curtPct == null || st.curtPct === '' ? 50 : +st.curtPct) / 100, 0, 1);
      const oc = await compute(Object.assign({}, st, { conv: 'curt' })), oa = await compute(Object.assign({}, st, { conv: 'all' }));
      const ns = oc.years.reduce((a, r) => a + r.wt * (r.negShare || 0), 0);
      const mix = (pc, pa) => pc == null || pa == null || !isFinite(pc) || !isFinite(pa) ? null : ((1 - k) * pa + k * pc * (1 - ns)) / (1 - k * ns);
      const keys = ['ppaBuild', 'ppaFpc', 'ppaWx', 'ppaEu', 'ppaPct', 'ppa'];
      oc.partial = { k, ns, stop: Object.fromEntries(keys.map(x => [x, oc[x]])), run: Object.fromEntries(keys.map(x => [x, oa[x]])) };
      keys.forEach(x => { oc[x] = mix(oc[x], oa[x]); });
      oc.st = st;
      return oc;
    }
    const nat = nationalYears(st);
    const ast = st.asset ? (await assetYears(st)) : null;
    const useAsset = ast && ast.length >= 1 && st.basis === 'asset';
    const hist = useAsset ? ast : nat;
    const auto = {};   // key → [value, source]
    const pick = (k, v, src) => { auto[k] = [v, src]; return st[k] != null && isFinite(st[k]) ? st[k] : v; };
    // Years used: chosen one by one; by default the last three complete years.
    const complete = hist.filter(x => x.complete);
    // default: every complete year of history except 2022 (gas crisis); with a curve, the asset's complete years only
    const defY = complete.filter(x => x.year !== 2022).map(x => x.year);
    const def = defY.length ? defY : (complete.length ? complete : hist).slice(-3).map(x => x.year);
    const sel = (st.years || def).filter(y => hist.some(x => x.year === y));
    const used = hist.filter(x => sel.includes(x.year));
    const fitRows = used.length ? used : hist.slice(-3);
    const histSd = fitRows.map(x => x.sd);
    const reg = linreg(fitRows.map(x => x.year), fitRows.map(x => x.sd));
    const lastYr = fitRows[fitRows.length - 1].year;
    const anchor = useAsset ? fitRows[fitRows.length - 1].cpPct : null;
    const start = fitRows[fitRows.length - 1].sd;   // the last year used, as observed
    const excluded = nat.filter(x => x.complete && x.year < lastYr && x.year >= Math.min(...sel) && !sel.includes(x.year)).map(x => x.year);
    // Projection of the shape discount from the last year used
    const cp = capPath(st.tech), cfit = D.capGW[st.tech] && Object.keys(D.capGW[st.tech]).length ? capacityFit(nat, sel, st.tech) : null;
    const model = st.model === 'capacity' && !cfit ? 'damped' : st.model;
    const capOff = cfit ? (1 - start) - cfit.f(cp(lastYr)) : 0;   // anchored on the last year used (asset or national)
    const cl = v => clamp(v, 0, 0.95);
    const proj = y => { const t = Math.max(0, y - lastYr); if (!t) return start;
      return cl(model === 'flat' ? start : model === 'linear' ? start + reg.sl * t : model === 'capacity' ? 1 - (cfit.f(cp(y)) + capOff) : start + 2 * reg.sl * (1 - Math.pow(0.5, t))); };
    const fitLine = y => cl(reg.ic + reg.sl * y);
    // uncertainty of the projection: spread of the years used around their trend (3 to 8 pts), widening with √t
    const resid = fitRows.map(x => x.sd - (reg.ic + reg.sl * x.year));
    const sig0 = pick('mcSd', clamp(Math.sqrt(mean(resid.map(r => r * r)) || 0), 0.03, 0.08) * 100, 'spread of the years used around their trend, 3 to 8 pts') / 100;
    const sigT = t => Math.min(0.2, sig0 * Math.sqrt(Math.max(1, t)));
    // Negative hours: linear in installed solar capacity (they follow the solar build-out), anchored on the last complete year
    const solPath = capPath('solar'), nh = D.negH, nhYears = Object.keys(nh).map(Number).filter(y => y < thisYear() && D.capGW.solar[y]).sort();
    const nhFitYears = nhYears.filter(y => sel.includes(y)).length >= 2 ? nhYears.filter(y => sel.includes(y)) : nhYears.slice(-3);
    const nhReg = nhFitYears.length >= 2 ? linreg(nhFitYears.map(y => D.capGW.solar[y]), nhFitYears.map(y => nh[y].h)) : null;
    const nhLast = nhFitYears.length ? nhFitYears[nhFitYears.length - 1] : null;
    const negHours = y => { if (nh[y] && y < thisYear()) return nh[y].h; if (!nhReg || nhLast == null) return null; return clamp(nh[nhLast].h + Math.max(0, nhReg.sl) * (solPath(y) - solPath(nhLast)), 0, 2500); };
    // share of the production at prices <= 0: asset or national history, scaled with the negative hours
    const shRow = (useAsset ? ast : nat).filter(x => x.complete).slice(-1)[0];
    const shLast = shRow ? (useAsset ? (shRow.mwhAll ? shRow.negMwh / shRow.mwhAll : null) : shRow.negShare) : null;
    // saturating: share = 1 − exp(−hours / h0), h0 calibrated on the last complete year (new hours fall on less productive slots)
    const h0 = shLast != null && shLast > 0 && shLast < 0.95 && shRow && nh[shRow.year] && nh[shRow.year].h ? -nh[shRow.year].h / Math.log(1 - shLast) : null;
    const negShare = y => { const h = negHours(y); return h == null || h0 == null ? null : clamp(1 - Math.exp(-h / h0), 0, 0.8); };
    // Tenor and forwards
    const ty = thisYear();
    const known = Object.keys(D.fwd).map(Number).sort(), lastQ = known.length ? known[known.length - 1] : null;
    const t0 = pick('tenorStart', ty + 1, 'next calendar year');
    const t1 = Math.max(t0, pick('tenorEnd', lastQ != null && lastQ >= t0 ? Math.min(t0 + 4, lastQ) : t0 + 4, lastQ != null ? 'last Cal year quoted' : 'five years'));
    // forwards: market quotes only, never invented; a year without a quote has to be entered
    const fwdAuto = y => D.fwd[y] != null ? D.fwd[y] : null;
    const fwdFor = y => st.fwd[y] != null ? st.fwd[y] : fwdAuto(y);
    const tenor = []; for (let y = t0; y <= t1; y++) tenor.push(y);
    // the months delivered in each year: a delivery can start and end in any month (January to December by default)
    const m0 = clamp(Math.round(st.m0 || 1), 1, 12), m1 = t0 === t1 ? Math.max(clamp(Math.round(st.m1 || 12), 1, 12), m0) : clamp(Math.round(st.m1 || 12), 1, 12);
    const monthsOf = y => { const a = []; for (let m = y === t0 ? m0 : 1; m <= (y === t1 ? m1 : 12); m++) a.push(m); return a; };
    const missing = tenor.filter(y => fwdFor(y) == null);
    if (missing.length && !st.noMC) return { st, nat, ast, hist, useAsset, complete, sel: fitRows.map(x => x.year), histSd, reg, lastYr, proj, fitLine, model, cfit, capOff, capPath: cp, excluded, sig0, sigT, negHours, negShare, nhReg, nhFitYears, shLast, tenor, fwdAuto, auto, missing };
    const lastKnown = y => { const k = known.filter(x => x <= y).pop(); return k != null ? D.fwd[k] : known.length ? D.fwd[known[0]] : 60; };
    const fwds = tenor.map(y => fwdFor(y) != null ? fwdFor(y) : lastKnown(y)), ref = mean(fwds);   // (site charts only reach here with a gap)
    // GO: market price of each production year, else the average of the known ones
    const goKnown = tenor.map(y => D.go[y] && D.go[y].v).filter(v => v != null), goMkt = goKnown.length ? mean(goKnown) : null;
    const goAuto = goMkt != null ? goMkt : 1.0;
    const goVal = pick('go', +goAuto.toFixed(2), goMkt != null ? 'Commerg mid, AIB renewable, tenor years' : 'default');
    const goY = tenor.map(y => st.go != null ? st.go : D.go[y] ? D.go[y].v : goAuto);
    // Volume: asset curve, else capacity × national load factor
    const natLF = nat.filter(x => x.complete && x.lf).slice(-3), lf = natLF.length ? mean(natLF.map(x => x.lf)) : (st.tech === 'solar' ? 0.135 : 0.23);
    const fullA = ast ? ast.filter(x => x.days >= 330) : [];
    const astVol = ast ? (fullA.length ? mean(fullA.map(x => x.mwh)) : ast[ast.length - 1].mwh * 365 / ast[ast.length - 1].days) : null;
    let peak = null; if (st.asset) { let m = 0; st.asset.slots.forEach(a => { for (let q = 0; q < 96; q++) if (a[q] > m) m = a[q]; }); peak = m * 4 / 1000; }
    const mw = pick('mw', peak != null ? +peak.toFixed(1) : null, peak != null ? 'peak of the curve' : 'enter it to size the production');
    const volume = pick('volume', astVol != null ? Math.round(astVol) : mw ? Math.round(mw * lf * 8760) : 52000,
      astVol != null ? 'asset curve, average year' : mw ? `${mw} MW × national load factor ${(lf * 100).toFixed(1)} %` : 'example: enter the capacity or a curve');
    const degr = pick('degr', st.tech === 'solar' ? 0.4 : 0, st.tech === 'solar' ? 'typical PV panel ageing' : 'none for wind') / 100;
    const disc = pick('disc', 0, 'none: values in today’s money') / 100;
    const ic = D.imbCost[st.tech];
    const imb = pick('imb', ic ? +ic.v.toFixed(2) : 1.9, ic ? `national forecast error × (imbalance − spot), ${ic.n} months` : 'past-discount default (national estimate not computed yet)'), margin = pick('margin', 1.0, 'past-discount default'), add = pick('add', 0, 'none');
    const volRisk = pick('volRisk', 0, 'none'), priceRisk = pick('priceRisk', 0, 'none');
    const alpha = pick('alpha', 25, 'one chance in four');
    const volStress = pick('volStress', 20, 'Past discount'), spotStress = pick('spotStress', 20, 'Past discount');
    // Monte Carlo inputs
    const lfs = nat.filter(x => x.complete && x.lf).slice(-6).map(x => x.lf), astFull = fullA.map(x => x.mwh);
    const sigVAuto = astFull.length >= 3 ? std(astFull) / mean(astFull) : lfs.length >= 3 ? std(lfs) / mean(lfs) : 0.08;
    const sigV = pick('mcVol', +(Math.max(0.04, sigVAuto) * 100).toFixed(1), astFull.length >= 3 ? 'spread of the asset’s yearly output' : 'spread of the national load factor, 6 years') / 100;
    const sigF = pick('mcFwd', D.fwdVol ? +(clamp(D.fwdVol, 0.1, 0.8) * 100).toFixed(0) : 25, D.fwdVol ? `France Cal+1, ${D.fwdVolN} sessions` : 'assumption') / 100;
    const rho = clamp(pick('rho', st.tech === 'solar' ? 0.3 : 0.2, 'assumption: a sunnier / windier year cannibalises more'), -0.95, 0.95);
    // Year by year: expected production, discount factor, capture value
    const now = nowFrac();
    // the level month by month, as the common framework says: the yearly capture × the quoted-shape factor
    const kq = shapeFactors({ tenor }, st);
    // each method's past bias, learnt on its own errors (scripts/ppa_bias.py): taken off its capture where the test
    // showed it helps (data/history/ppa_bias.json 'adopt'); the delivery year's horizon after the last complete year, 1 to 3
    const biasOf = (k, y) => { const B = D.bias, conv = st.conv === 'all' ? 'all' : st.conv === 'curt' ? 'curt' : null;
      if (!B || !B.bias || !conv || !((B.adopt[st.tech] || {})[conv] || []).includes(k)) return 0;
      const e = ((B.bias[st.tech] || {})[k] || {})[conv], v = e && e[String(Math.min(3, Math.max(1, y - B.lastYear)))]; return v ? v.value : 0; };
    // a year delivered only in part: its share of the year's output, and its months' value against the whole year's
    const part = partFactors(tenor, monthsOf, st);
    const years = tenor.map((y, i) => { const ns = negShare(y), M = monthsOf(y), ev = volume * Math.pow(1 - degr, i) * part[i].sh * (st.conv !== 'all' && ns != null ? 1 - ns : 1),
      df = Math.pow(1 + disc, -Math.max(0, y + (M[0] - 1 + M[M.length - 1]) / 24 - now)), bs = biasOf('step', y), fsd = proj(y) + bs / Math.max(0.05, kq[i] * part[i].g), cpY = fwds[i] * kq[i] * part[i].g * (1 - fsd);
      return { y, months: M, fwd: fwds[i], kq: kq[i], bias: bs, g: part[i].g, sh: part[i].sh, ev, df, fsd, cp: cpY, go: goY[i], w: ev * df, sig: sigT(y - lastYr), negH: negHours(y), negShare: ns }; });
    const W = years.reduce((a, r) => a + r.w, 0) || 1;
    years.forEach(r => { r.wt = r.w / W; });
    const wavg = k => years.reduce((a, r) => a + r.wt * r[k], 0);
    const refW = wavg('fwd'), fair = wavg('cp'), goW = wavg('go'), sdW = wavg('fsd');
    const o = { st, stAt: { tech: st.tech, conv: st.conv }, biasOf, nat, ast, hist, useAsset, complete, monthsOf, m0, m1, sel: fitRows.map(x => x.year), histSd, reg, lastYr, anchor, proj, fitLine, model, cfit, capOff, capPath: cp, excluded, sig0, sigT,
      tenor, negHours, negShare, nhReg, nhFitYears, shLast, fwds, fwdAuto, ref, refW, goVal, goMkt, goW, fair, sdW, volume, mw, lf, degr, disc, imb, margin, add, volRisk, priceRisk, alpha, volStress, spotStress, sigV, sigF, rho, years, auto };
    // Monte Carlo: the realised value of one MWh of the contract, 10,000 trajectories
    if (!st.noMC) o.mc = simulate(o, st);
    // the published price's P10–P90 (scripts/ppa_daily.py): the same futures, but the capture drift set to the measured
    // spread of the published average's errors (scripts/ppa_bias.py bandSigma: σ(h) = a √h, widened by the Student t of
    // its n errors) instead of the capacity trend's own, about twice as wide; volume and forward risks unchanged
    if (o.mc && D.bias && D.bias.bandSigma) {
      const bs = (D.bias.bandSigma[st.tech] || {})[st.conv === 'all' ? 'all' : 'curt'];
      if (bs && bs.a > 0 && bs.n > 2) { const z = t90(bs.n - 1) * Math.sqrt(1 + 1 / bs.n); o.bandSig0 = bs.a * z / 1.2816; o.mcBand = simulate(Object.assign({}, o, { sig0: o.bandSig0 }), st); }
    }
    // Prices of both methods
    // Past discount, as the team's PPA Dashboard does it. 'projected' (default): each delivery year takes the
    // linear trend of the shape discount over the last N years used (3 by default, as in the tool), shifted by
    // the gap between the chosen percentile and the median of the past discounts (its "trend + offset"
    // projection). 'past': the percentile of the past discounts, no projection (the tool's single headline price).
    const sdPct = percentile(histSd, st.pct);
    const pdRows = fitRows.slice(-Math.max(2, st.pdYears || 3)), pdReg = linreg(pdRows.map(x => x.year), pdRows.map(x => x.sd));
    const pdOff = sdPct - percentile(histSd, 50);
    o.pdMode = st.pdMode === 'past' || !pdReg ? 'past' : 'projected';
    o.pdYears = pdRows.map(x => x.year); o.pdOff = pdOff;
    o.sdPctY = years.map(r => o.pdMode === 'past' ? sdPct : cl(pdReg.ic + pdReg.sl * r.y + pdOff));
    const capPD = years.reduce((a, r, i) => a + r.wt * r.fwd * r.g * (1 - o.sdPctY[i]), 0);
    o.sdCh = o.pdMode === 'past' ? sdPct : years.reduce((a, r, i) => a + r.wt * o.sdPctY[i], 0);
    o.pdEur = o.pdMode === 'past' ? ref * sdPct : ref - capPD;
    o.pdTxt = o.pdMode === 'past' ? `P${st.pct} of the past discounts ${fitRows.map(x => x.year).join(', ')}, no projection` : `trend of ${o.pdYears.join(', ')} + offset P${st.pct} − P50 of the past discounts (${(pdOff * 100).toFixed(1)} pts)`;
    o.ppaPct = (o.pdMode === 'past' ? ref - ref * sdPct : capPD) - ref * (add / 100 + volRisk / 100 + priceRisk / 100) - imb + goVal - margin;
    o.qU = o.mc ? qtl(o.mc.Us, alpha / 100) : fair;
    // where the premium comes from: the same simulation with one source of risk at a time
    if (o.mc) {
      const one = over => { const m = simulate(Object.assign({}, o, over), st); return fair - qtl(m.Us, alpha / 100); };
      o.premSrc = { shape: one({ sigV: 0, sigF: 0 }), volume: one({ sig0: 0, sigF: 0 }), price: one({ sig0: 0, sigV: 0 }) };
    }
    o.premium = fair - o.qU;
    o.ppaBuild = o.qU - refW * add / 100 - imb + goW - margin;
    // European price model: the test bench's monthly capture rates (scripts/ppa_lab.py), with this pricer's Cal
    // forwards, the capacity trend's risk premium, costs, GO and margin, so the methods compare like for like
    o.eu = euYears(o, st);
    o.euFair = o.eu ? years.reduce((a, r, i) => a + r.wt * r.fwd * o.eu[i].capture, 0) : null;
    o.ppaEu = o.eu ? o.euFair - o.premium - refW * add / 100 - imb + goW - margin : null;
    o.method = st.method;
    // asset-specific FPC method (three pricings): js/ppa-fpc.js
    if (!st.noMC && window.PKFpc) { try { o.m3 = await PKFpc.compute(o, st, D); } catch (e) { console.warn('[ppa] fpc', e); o.m3 = null; } }
    o.ppaFpc = o.m3 ? o.m3.ppa : null;
    // Monte Carlo on simulated weather (js/ppa-wx.js): heavier, run on its tab and on Compare
    o.capPathFor = capPath;
    if (!st.noMC && window.PKWx && (st.method === 'wx' || st.view === 'compare')) {
      const monthLevel = (y, m) => { const r = o.m3 && o.m3.fwd.find(f => f.y === y); const i = o.tenor.indexOf(y); return m === 0 ? (r ? r.cal : fwds[i]) : (r && r.months[m - 1] != null ? r.months[m - 1] : fwds[i]); };
      // model risk measured on the historical replay: the weather method's own past errors (2022 left out)
      if (!BT) BT = await get('history/ppa_backtest.json');
      const bt = BT ? BT.rows.filter(r => r.tech === st.tech && r.year !== 2022) : [];
      const sigModel = bt.length >= 3 ? Math.sqrt(mean(bt.map(r => (r.weather - r.actual) ** 2))) : 0;
      try { o.m4 = await PKWx.compute(o, st, D, capPath, monthLevel, 120, sigModel); } catch (e) { console.warn('[ppa] wx', e); o.m4 = null; }
    }
    o.ppaWx = o.m4 ? o.m4.ppa : null;
    o.ppa = st.method === 'pct' ? o.ppaPct : st.method === 'fpc' && o.m3 ? o.ppaFpc : st.method === 'wx' && o.m4 ? o.ppaWx : o.ppaBuild;
    o.goP = st.method === 'pct' ? goVal : goW;
    o.refP = st.method === 'pct' ? ref : refW;
    // P&L per year at the PPA price, central case
    years.forEach(r => { r.pnl = r.cp - imb + r.go - o.ppa; r.pnlK = r.ev * r.pnl / 1000; });
    // P&L against the historical percentiles of the shape discount
    const pcts = [...Array(100).keys()].map(i => i + 1), sdP = pcts.map(p => percentile(histSd, p));
    o.pcts = pcts;
    o.pnlCurve = sdP.map(sd => volume * (o.refP * (1 - sd) - imb + o.goP - o.ppa) / 1000);
    o.be = pcts.find((p, i) => o.pnlCurve[i] < 0) || null;
    // stress scenarios, total over the tenor, k€: around the projection (step by step) or the history (PPA Dashboard)
    const n = tenor.length, vs = volStress / 100, ss = spotStress / 100, sMid = sigT(tenor[Math.floor(n / 2)] - lastYr);
    const c50 = st.method === 'pct' ? percentile(histSd, 50) : sdW, cLo = st.method === 'pct' ? percentile(histSd, 10) : sdW - 1.28 * sMid, cHi = st.method === 'pct' ? percentile(histSd, 90) : sdW + 1.28 * sMid;
    o.scen = [['Base', 1, 0, 0], ['Cannibalisation +' + volStress + ' %', 1, vs, 0], ['Cannibalisation −' + volStress + ' %', 1, -vs, 0], ['Spot +' + spotStress + ' %', 1 + ss, 0, 0], ['Spot −' + spotStress + ' %', 1 - ss, 0, 0],
      ['Volume +' + volStress + ' %', 1, 0, vs], ['Volume −' + volStress + ' %', 1, 0, -vs], ['Total stress', 1 - ss, vs, -vs], ['Total bull', 1 + ss, -vs, vs]]
      .map(([name, sm, da, va]) => { const base = volume * (1 + va) / 1000 * n, v = sd => base * (sm * o.refP * (1 - (sd + da)) - imb + o.goP - o.ppa); return { name, p10: v(cHi), p50: v(c50), p90: v(cLo) }; });
    // beyond history: amplified gaps, distribution tails and named stresses (the history has 2022 once and no
    // 2030 solar fleet): shocks applied on top of the same low / central / high shape discount
    const sdMax = Math.max(...histSd), sdMed = percentile(histSd, 50), amp = Math.max(0, sdMax - sdMed);
    // 2022 as it really moved this technology's shape discount, against 2021 and 2023 (national profile, same
    // convention): solar about −16 to −19 pts (the year's price peak fell in summer), wind about +9 (a winter technology)
    const cpOf = y => { const r = nat.find(x => x.year === y && x.complete); return r ? r.cpPct : null; };
    const c22 = cpOf(2022), cAround = [cpOf(2021), cpOf(2023)];
    const g22 = c22 != null && cAround.every(v => v != null) ? { d: mean(cAround) - c22 } : { d: -0.05 };
    const g22pts = (g22.d > 0 ? '+' : '−') + Math.abs(g22.d * 100).toFixed(0);
    g22.how = c22 == null || cAround.some(v => v == null) ? (FRDOC() ? 'spot ×1,9, décote de forme −5 pts : le gaz fixe le prix à toutes les heures' : 'spot ×1.9, shape discount −5 pts: gas sets the price at all hours')
      : FRDOC() ? `spot ×1,9, décote de forme ${g22pts} pts : l’écart de 2022 à 2021 et 2023 pour ${st.tech === 'wind' ? 'l’éolien (technologie d’hiver, le pic de prix était en été)' : 'le solaire (le pic de prix de l’année est tombé en été)'}`
      : `spot ×1.9, shape discount ${g22pts} pts: 2022 against 2021 and 2023 for ${st.tech === 'wind' ? 'wind (a winter technology; the price peak was in summer)' : 'solar (the year’s price peak fell in summer)'}`;
    const tail = st.method === 'pct' ? percentile(histSd, 99) : sdW + 2.33 * sMid;
    o.scenX = [['Worst past year, gap doubled', 1, sdMax + amp - c50, 0, 'shape discount = worst past year + (worst − median) again'],
      ['Tail: P99 of the shape discount', 1, tail - c50, 0, st.method === 'pct' ? '99th percentile of the past discounts' : 'projection + 2.33 σ'],
      ['Solar fleet doubles (PPE3 high)', 0.85, 0.12, 0, 'spot −15 %, shape discount +12 pts: midday prices sink'],
      ['Gas crisis like 2022', 1.9, g22.d, 0, g22.how],
      ['Price collapse, many negative hours', 0.6, 0.10, 0, 'spot −40 %, shape discount +10 pts'],
      ['Poor weather year', 1, 0, -0.15, 'volume −15 %'],
      ['Everything at once (extreme)', 0.6, 0.15, -0.15, 'spot −40 %, shape discount +15 pts, volume −15 %']]
      .map(([name, sm, da, va, how]) => { const base = volume * (1 + va) / 1000 * n, v = sd => base * (sm * o.refP * (1 - (sd + da)) - imb + o.goP - o.ppa); return { name, how, p10: v(cHi), p50: v(c50), p90: v(cLo) }; });
    if (o.mc) o.mcAt = mcEval(o, o.ppa);
    return o;
  }

  // ── Monte Carlo ───────────────────────────────────────────────────
  // Per trajectory and year: the forward moves as one path to delivery (σ·√τ),
  // production varies around its expectation, the shape discount drifts away
  // from its projection (random walk, σ per √year, as in the projection band),
  // with a correlation between production and that drift. Hedged: the
  // expected volume is sold forward at the Cal price, so only the volume and
  // shape risks remain. U = Σ df × (production × spot × (1 − shape discount)
  // + hedge result) ÷ Σ df × production: what one MWh of the contract earned.
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const qtl = (sorted, q) => { const r = q * (sorted.length - 1), lo = Math.floor(r); return sorted[lo] + (sorted[Math.min(sorted.length - 1, lo + 1)] - sorted[lo]) * (r - lo); };
  // 90th percentile of Student's t with df degrees of freedom (Cornish–Fisher; within 1 % for df ≥ 2)
  const t90 = df => { const z = 1.2816; return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df); };
  function simulate(o, st) {
    const N = 10000, Y = o.years, T = Y.length, R = rng(42);
    let spare = null; const gauss = () => { if (spare != null) { const v = spare; spare = null; return v; } let u = 0, v = 0; while (!u) u = R(); v = R(); const m = Math.sqrt(-2 * Math.log(u)); spare = m * Math.sin(2 * Math.PI * v); return m * Math.cos(2 * Math.PI * v); };
    const now = nowFrac(), tau = Y.map(r => Math.max(0.05, r.y + 0.5 - now)), hedged = st.hedge !== 'open', rc = Math.sqrt(1 - o.rho * o.rho);
    const U = new Float64Array(N), prod = Y.map(() => new Float32Array(N)), val = Y.map(() => new Float32Array(N)), sdM = Y.map(() => new Float32Array(N)), cpM = Y.map(() => new Float32Array(N)), spM = Y.map(() => new Float32Array(N));
    for (let i = 0; i < N; i++) {
      let w = 0, tp = 0, rw = 0, num = 0, den = 0;
      for (let t = 0; t < T; t++) {
        const r = Y[t];
        w += Math.sqrt(tau[t] - tp) * gauss(); tp = tau[t];
        const spot = r.fwd * Math.exp(o.sigF * w - o.sigF * o.sigF * tau[t] / 2);
        const zv = gauss(), pr = r.ev * clamp(1 + o.sigV * zv, 0.3, 2);
        const dt = t === 0 ? Math.max(1, r.y - o.lastYr) : 1;
        rw += Math.sqrt(dt) * o.sig0 * (o.rho * zv + rc * gauss());
        const sd = clamp(r.fsd + rw, 0, 0.95), cap = spot * (r.kq || 1) * (r.g || 1) * (1 - sd);
        const v = pr * cap + (hedged ? r.ev * (r.fwd - spot) : 0);
        prod[t][i] = pr; val[t][i] = v; sdM[t][i] = sd; cpM[t][i] = cap; spM[t][i] = spot;
        num += r.df * v; den += r.df * pr;
      }
      U[i] = num / den;
    }
    const Us = Float64Array.from(U).sort();
    return { N, U, Us, prod, val, sdM, cpM, spM, hedged, mean: mean(Array.from(U)) };
  }
  // the simulated P&L at a given price, k€
  function mcEval(o, price) {
    const mc = o.mc, N = mc.N, T = o.years.length, cum = new Float64Array(N), ann = o.years.map(() => new Float64Array(N));
    for (let t = 0; t < T; t++) { const c = price + o.imb - o.years[t].go; for (let i = 0; i < N; i++) { const p = (mc.val[t][i] - mc.prod[t][i] * c) / 1000; ann[t][i] = p; cum[i] += p; } }
    const sorted = Float64Array.from(cum).sort(), p10 = qtl(sorted, 0.1);
    let es = 0, nes = 0; cum.forEach(v => { if (v <= p10) { es += v; nes++; } });
    const srt = a => Float64Array.from(a).sort();
    const annS = ann.map(srt), sdS = mc.sdM.map(srt), cpS = mc.cpM.map(srt);
    return { cum: sorted, prob: cum.filter(v => v < 0).length / N, es: nes ? es / nes : null,
      pc: [1, 5, 10, 25, 50, 75, 90, 95, 99].reduce((m, p) => (m[p] = qtl(sorted, p / 100), m), {}),
      bands: [5, 10, 25, 50, 75, 90, 95].reduce((m, p) => (m[p] = annS.map(a => qtl(a, p / 100)), m), {}),
      years: o.years.map((r, t) => ({ y: r.y, sdTrend: r.fsd, sd50: qtl(sdS[t], 0.5), sd90: qtl(sdS[t], 0.9), cp50: qtl(cpS[t], 0.5), p10: qtl(annS[t], 0.1), p50: qtl(annS[t], 0.5), p90: qtl(annS[t], 0.9), std: std(Array.from(ann[t])) })) };
  }

  // ── Rendering ─────────────────────────────────────────────────────
  const f2 = v => v == null || !isFinite(v) ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f0 = v => v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-GB');
  const pc = v => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1) + ' %';
  const sgn = v => (v > 0 ? '+' : '') + f0(v);
  const quantFloat = (v, p) => { const r = p * (v.length - 1), lo = Math.floor(r), hi = Math.min(lo + 1, v.length - 1); return v[lo] + (v[hi] - v[lo]) * (r - lo); };
  const esc = PK.esc;   // js/pk-core.js
  const MODEL_T = { capacity: 'driven by installed capacity (PPE3)', flat: 'flat at the last year used', damped: 'trend halving every year', linear: 'straight line (past-discount formula)' };

  // plain-language help on every input (ⓘ next to its label)
  const HELP = {
    'pp-tech': 'Solar or wind: which national production profile, installed capacity and history are used.',
    'pp-t0': 'First calendar year of delivery.', 'pp-t1': 'Last calendar year of delivery. By default the last year with a market price (Cal).',
    'pp-mw': 'Installed capacity of the asset. Used to estimate its yearly production when no curve is loaded.',
    'pp-volume': 'Production expected per year. Sets the P&L in k€ and the weight of each year.',
    'pp-degr': 'Yearly loss of output (panel ageing): later years weigh a little less.',
    'pp-file': 'Hourly or 15-minute production of the asset (CSV or Excel). The price then reflects this asset; without it the national profile is used.',
    'pp-model': 'How the discount is carried into the future: with the installed capacity (PPE3 targets), flat at the last year, or a trend.',
    'pp-pct': 'Past-discount method only: which percentile of the past discounts is used. Projected mode: the trend is shifted by this percentile minus the median. Higher = more cautious.',
    'pp-conv': 'Curtailed: the asset stops when the price is ≤ 0 €; that output is neither produced nor paid, and the forward (Cal) still settles on every hour. No curtailment: every hour is produced and paid, negative prices included. Partial stop: only the share entered stops (for instance the parks under the stop obligation), the rest runs and is paid the negative price. PPA Dashboard convention: the team’s former rule, kept to compare.',
    'pp-alpha': 'The chance of losing money you accept. Lower = a more cautious price and a bigger risk premium.',
    'pp-hedge': 'Whether the expected volume is sold forward at the Cal price. Hedged: only the volume and profile risks remain.',
    'pp-imb': 'Cost of forecast errors per MWh produced. Default: national estimate (forecast error × gap between imbalance and spot prices).',
    'pp-go': 'Value of the guarantees of origin per MWh, from market prices.',
    'pp-margin': 'What the buyer keeps per MWh. Deducted from the price paid to the producer, in every method.',
    'pp-disc': 'Discount rate applied to later years (0 = none).', 'pp-add': 'An extra discount in % of the forward, if you want one.',
    'pp-volrisk': 'Past-discount method: volume risk margin, in % of the forward, entered by hand.', 'pp-pricerisk': 'Past-discount method: price risk margin, in % of the forward, entered by hand.',
    'pp-mcvol': 'How much the yearly production can vary (1 standard deviation).', 'pp-mcfwd': 'How much the forward price can move until delivery (yearly volatility).',
    'pp-mcsd': 'How far the discount can drift from its projection each year.', 'pp-rho': 'Link between a high-production year and a deeper discount (0 = none, 1 = full).',
    'pp-vs': 'Size of the volume and cannibalisation shocks in the stress scenarios.', 'pp-ss': 'Size of the spot price shocks in the stress scenarios.',
  };
  function addHelp() {
    Object.entries(HELP).forEach(([id, tip]) => { const el = $(id); const f = el && el.closest('.cf-field'); const lab = f && f.querySelector(':scope > span'); if (!lab || lab.querySelector('.pp-help')) return;
      const i = document.createElement('i'); i.className = 'pp-help'; i.tabIndex = 0; i.textContent = 'i'; i.dataset.tip = tip; i.setAttribute('aria-label', tip); lab.appendChild(i); });
    const ys = $('pp-yearsel'), lab = ys && ys.closest('.cf-field') && ys.closest('.cf-field').querySelector(':scope > span');
    if (lab && !lab.querySelector('.pp-help')) { const i = document.createElement('i'); i.className = 'pp-help'; i.tabIndex = 0; i.textContent = 'i'; i.dataset.tip = 'Past years used to measure cannibalisation and the price shape. 2022 (gas crisis) is left out by default. With an asset curve, only its complete years.'; lab.appendChild(i); }
  }
  const INTRO = {
    pct: '<b>Past discount</b> (formerly “PPA Dashboard”): the team’s original formula. By default, as in the tool’s projection: each delivery year’s discount = the linear trend of the last 3 years + (chosen percentile − median) of the past discounts; price = Σ forward × (1 − that discount), weighted by output, − risk margins entered by hand. Option: the percentile of the past years alone (the tool’s single headline price), which assumes the delivery years look like the past.',
    build: '<b>Capacity trend</b> (formerly “Step by step”): the discount is projected year by year with the installed capacity (more solar → deeper discount), then a Monte Carlo sets a risk premium for the chance of loss you accept. Suited when cannibalisation keeps growing.',
    fpc: '<b>Forward shape</b> (formerly “Asset-specific FPC”): the method of the pricing deck, the expected production is valued on an hourly forward price curve (profile cost), then a cannibalisation coefficient measured on history — historical (1) minus decorrelated (3) — is added. The most direct link with today’s forward prices.',
    wx: '<b>Weather simulation</b> (formerly “Monte Carlo weather”): simulates the weather, the national production and the hourly prices for many possible years. It captures the link between weather and prices directly; its risk premium covers weather only, not a change of market regime.',
  };

  // input id → state key; an empty field takes the automatic value
  const FIELDS = { 'pp-curtpct': 'curtPct', 'pp-t0': 'tenorStart', 'pp-t1': 'tenorEnd', 'pp-mw': 'mw', 'pp-volume': 'volume', 'pp-degr': 'degr', 'pp-alpha': 'alpha', 'pp-imb': 'imb', 'pp-go': 'go', 'pp-margin': 'margin',
    'pp-disc': 'disc', 'pp-add': 'add', 'pp-volrisk': 'volRisk', 'pp-pricerisk': 'priceRisk', 'pp-mcvol': 'mcVol', 'pp-mcfwd': 'mcFwd', 'pp-mcsd': 'mcSd', 'pp-rho': 'rho', 'pp-vs': 'volStress', 'pp-ss': 'spotStress' };
  function renderAuto(o) {
    Object.entries(FIELDS).forEach(([id, k]) => {
      const inp = $(id), tag = document.querySelector(`.pp-auto[data-for="${id}"]`), a = o.auto[k]; if (!inp || !a) return;
      const v = a[0];
      inp.placeholder = v == null ? '' : String(v);
      if (S[k] == null && document.activeElement !== inp) inp.value = '';
      if (tag) { const man = S[k] != null; tag.className = 'pp-auto' + (man ? ' man' : ''); tag.textContent = man ? `↺ auto${v != null ? ' ' + v : ''}` : 'auto'; tag.title = man ? 'Back to the automatic value: ' + a[1] : 'Automatic: ' + a[1]; tag.dataset.k = k; }
    });
    const steps = document.querySelector('.pp-steps'); if (steps) steps.className = 'pp-steps m-' + (S.view === 'compare' ? 'all' : S.method);
    const pg = $('page-ppapricer'); if (pg) pg.dataset.m = S.view === 'compare' ? 'all' : S.method;
  }

  function renderForwards(o) {
    const host = $('pp-fwd'); if (!host) return;
    // rebuild only when the years or the entered values change: a rebuild under the cursor would drop what is being typed
    const key = o.tenor.join(',') + '|' + o.tenor.map(y => S.fwd[y] != null ? S.fwd[y] : '') .join(',') + '|' + (D.fwdDate || '');
    if (host.dataset.key === key) return;
    host.dataset.key = key;
    host.innerHTML = o.tenor.map((y, i) => { const man = S.fwd[y] != null, a = o.fwdAuto(y), need = !man && a == null;
      return `<label class="cf-field${need ? ' pp-need' : ''}"><span>Cal ${y} <i class="pp-auto${man && a != null ? ' man' : ''}" data-fy="${y}">${man ? (a != null ? '↺ market ' + f2(a) : 'entered') : a == null ? 'not quoted · enter your price' : 'market'}</i></span><span class="cf-in"><input type="number" step="0.01" data-fy="${y}" placeholder="${a != null ? a.toFixed(2) : 'your price'}" value="${man ? S.fwd[y] : ''}"><em>€/MWh</em></span></label>`; }).join('') +
      `<div class="pp-fwd-note">France baseload calendar contracts${D.fwdDate ? ', settlements of ' + D.fwdDate : ''}. A year without a quote is never filled in for you: enter your own price, or shorten the delivery period.</div>`;
    host.querySelectorAll('input[data-fy]').forEach(inp => inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v)) S.fwd[+inp.dataset.fy] = v; else delete S.fwd[+inp.dataset.fy]; run(); }));
    host.querySelectorAll('.pp-auto.man[data-fy]').forEach(t => t.addEventListener('click', e => { e.preventDefault(); delete S.fwd[+t.dataset.fy]; run(); }));
  }

  function renderYears(o) {
    const host = $('pp-yearsel'); if (!host) return;
    host.innerHTML = o.hist.map(x => `<button type="button" class="pp-chip${o.sel.includes(x.year) ? ' on' : ''}" data-y="${x.year}" title="Shape discount ${pc(x.sd)}${x.complete ? '' : ' · incomplete year'}">${x.year}${x.complete ? '' : ' YTD'}<em>${pc(x.sd)}</em></button>`).join('') +
      `<button type="button" class="pp-chip pp-chip-reset" data-y="reset">All but 2022</button>`;
    host.querySelectorAll('.pp-chip').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.y === 'reset') S.years = null;
      else { const y = +b.dataset.y, cur = new Set(o.sel); cur.has(y) ? cur.delete(y) : cur.add(y); if (!cur.size) return; S.years = [...cur].sort(); }
      run();
    }));
  }

  // ── Tab 1 · the price band: the methods with a box to tick, their average, and the step from the market price ──
  // default = the site's benchmark (scripts/ppa_daily.py): average of the three model methods, the past discount left out
  // the past discount is shown as a reference only (review of 27 Oct 2026): it never enters the price. The four model
  // methods are ticked by default: their average is the published PPA benchmark (scripts/ppa_daily.py, blend4)
  const INC0 = { pct: false, build: true, fpc: true, wx: true, eu: true };
  let INC = Object.assign({}, INC0);
  try { const v = JSON.parse(localStorage.getItem('pk-pp-inc') || 'null'); if (v) INC = Object.assign({}, INC0, v); } catch (_) {}
  INC.pct = false;
  const MNAME = { pct: 'Past discount', build: 'Capacity trend', fpc: 'Forward shape', wx: 'Weather simulation', eu: 'European price model' };
  // weight of a method in the average (published price): the inverse of its past error for solar, equal for wind
  // (data/history/ppa_weights.json); keys of the pricer → keys of the test bench
  const WKEY = { build: 'step', fpc: 'fpc', wx: 'weather', eu: 'regional' };
  function wOf(k, st) {
    const t = (st || S).tech === 'wind' ? 'wind' : 'solar', c = (st || S).conv === 'all' ? 'all' : 'curt', W = D && D.weights && D.weights.weights;
    const w = W && W[t] && W[t][c] && W[t][c][WKEY[k]];
    return w != null && isFinite(w) ? w : 1;
  }
  // weighted mean of items {k, [f]} (only those with a value), weights renormalised on the methods ticked
  function wmean(items, f, st) {
    const its = items.filter(m => m[f] != null && isFinite(m[f]));
    const W = its.reduce((a, m) => a + wOf(m.k, st), 0);
    return W > 0 ? its.reduce((a, m) => a + wOf(m.k, st) * m[f], 0) / W : null;
  }
  function methodVals(o) {
    if (o.m4) S.wxLast = Object.assign(S.wxLast || {}, { ppa: o.ppaWx, fair: o.m4.fair, ref: o.m4.refW, fp: fp() });
    const wxc = !o.m4 && S.wxLast && S.wxLast.fp === fp() ? S.wxLast : null;
    return [
      { k: 'pct', v: o.ppaPct, fair: o.ref - o.pdEur, ref: o.ref },
      { k: 'build', v: o.ppaBuild, fair: o.fair, ref: o.refW },
      { k: 'fpc', v: o.ppaFpc, fair: o.m3 ? o.m3.fair : null, ref: o.m3 ? o.m3.refW : null },
      { k: 'wx', v: o.m4 ? o.ppaWx : wxc ? wxc.ppa : null, fair: o.m4 ? o.m4.fair : wxc ? wxc.fair : null, ref: o.m4 ? o.m4.refW : wxc ? wxc.ref : null },
      { k: 'eu', v: o.ppaEu, fair: o.euFair, ref: o.refW },
    ];
  }
  // measured precision of the 4-method average by horizon (scripts/ppa_horizon_test.py), for the band
  let HZ = null;
  // the corrected average's errors (scripts/ppa_bias.py, avg4Mae) when present, else the uncorrected replay's
  const hzLoad = () => HZ || (HZ = Promise.all([fetch(DATA_BASE + 'history/ppa_horizon_test.json').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(DATA_BASE + 'history/ppa_bias.json').then(r => r.ok ? r.json() : null).catch(() => null)]).then(([h, b]) => ({ h, b })));
  function bandRisk(o, use) {
    const el = $('pp-band-risk'); if (!el) return;
    const vs = use.map(m => m.v), lo = Math.min(...vs), hi = Math.max(...vs), fr = FRDOC(), n2 = v => fr ? f2(v).replace('.', ',') : f2(v);
    const spread = use.length > 1 ? (fr ? `Fourchette des méthodes cochées : <b>${n2(lo)} – ${n2(hi)} €/MWh</b> (écart ${n2(hi - lo)} €) : c’est le risque de modèle, à lire avec le prix.` : `Range of the methods ticked: <b>${n2(lo)} – ${n2(hi)} €/MWh</b> (gap ${n2(hi - lo)} €): this is the model risk, to read with the price.`) : '';
    // the weights, when they are not equal (solar): each method weighs by the inverse of its past error
    const ws = use.map(m => [m.k, wOf(m.k)]), wt = ws.reduce((a, [, w]) => a + w, 0), NM = { build: fr ? 'tendance' : 'capacity trend', fpc: fr ? 'forme forward' : 'forward shape', wx: fr ? 'météo' : 'weather', eu: fr ? 'européen' : 'European' };
    const uneven = ws.length > 1 && ws.some(([, w]) => Math.abs(w - ws[0][1]) > 1e-6);
    const wtxt = uneven ? (fr ? ' Moyenne pondérée par l’inverse de l’erreur passée de chaque méthode : ' : ' Average weighted by the inverse of each method’s past error: ') + ws.map(([k, w]) => NM[k] + ' ' + Math.round(w / wt * 100) + ' %').join(' · ') + '.' : '';
    el.innerHTML = spread + wtxt;
    hzLoad().then(j => {
      const m = j && j.h && j.h.mae, am = j && j.b && j.b.avg4Mae, t = S.tech === 'wind' ? 'wind' : 'solar', c = S.conv === 'all' ? 'all' : 'curt';
      const e = h => am && am[t] && am[t][c] && am[t][c][String(h)] != null ? am[t][c][String(h)] : m && m[`${t} ${c} h=${h}`] && m[`${t} ${c} h=${h}`].avg4;
      if (e(1) == null) return;
      el.innerHTML = spread + wtxt + ' ' + (fr ? `Précision mesurée de la moyenne des 4${uneven ? ' (à poids égaux)' : ''} sur 2024–2026 : ${n2(e(1))} € d’erreur moyenne à 1 an, ${n2(e(2))} € à 2 ans, ${n2(e(3))} € à 3 ans ; au-delà du parc déjà observé, l’écart entre méthodes dit mieux l’incertitude.`
        : `Measured precision of the 4-method average${uneven ? ' (equal weights)' : ''} on 2024–2026: ${n2(e(1))} € mean error one year ahead, ${n2(e(2))} € two years, ${n2(e(3))} € three years; beyond the fleet already observed, the gap between methods tells the uncertainty better.`);
    });
  }
  function renderBand(o) {
    const host = $('pp-band'); if (!host || !o) return;
    const M = methodVals(o), use = M.filter(m => INC[m.k] && m.v != null), avg = use.length ? wmean(use, 'v') : null;
    host.innerHTML = `<div class="pp-band-main"><div class="pp-band-l">PPA price</div><div class="pp-band-v">${avg != null ? f2(avg) : '–'}<small> €/MWh</small></div>` +
      `<div class="pp-band-s"><span>${use.length}</span> <span>${use.length === 1 ? 'method ticked' : 'methods ticked'}</span> · <span>${S.tech === 'wind' ? 'Wind' : 'Solar'}</span> · <span>Cal ${o.tenor[0]}–${o.tenor[o.tenor.length - 1]}</span> <span>${f2(o.refW)} €/MWh</span></div></div>` +
      `<div class="pp-offer"><label for="pp-offer-in">Offer received</label><span class="cf-in"><input type="number" id="pp-offer-in" step="0.1" placeholder="€/MWh" value="${S.offer != null ? S.offer : ''}"><em>€/MWh</em></span><div class="pp-offer-out" id="pp-offer-out"></div></div>` +
      `<div class="pp-band-m">${M.map(m => `<label class="pp-mcard${INC[m.k] ? ' on' : ''}${m.v == null || m.k === 'pct' ? ' na' : ''}"><input type="checkbox" data-inc="${m.k}"${INC[m.k] ? ' checked' : ''}${m.v == null || m.k === 'pct' ? ' disabled' : ''}>` +
        `<span class="pp-mcard-n">${MNAME[m.k]}</span><span class="pp-mcard-v">${m.v != null ? f2(m.v) : '…'}</span><span class="pp-mcard-s">${m.k === 'pct' ? 'reference, not for pricing' : m.v != null ? '€/MWh' : m.k === 'eu' ? 'no forecast past 2030' : 'computed on its tab'}</span></label>`).join('')}</div><div class="pp-band-risk" id="pp-band-risk"></div>`;
    const oi = $('pp-offer-in');
    if (oi) oi.addEventListener('input', () => { S.offer = oi.value === '' ? null : +oi.value; offerOut(S.last, avg); });
    bandRisk(o, use);
    offerOut(o, avg);
    host.querySelectorAll('[data-inc]').forEach(c => c.addEventListener('change', () => {
      INC[c.dataset.inc] = c.checked; try { localStorage.setItem('pk-pp-inc', JSON.stringify(INC)); } catch (_) {}
      renderBand(S.last); renderSumWf(S.last); renderSens(S.last);
    }));
  }
  // an offer received, read against the pricer: gap to the price shown, chance of loss and expected P&L at that price
  // (the 10,000 futures of the capacity trend's Monte Carlo, forward hedged, as in its Risk section)
  function offerOut(o, avg) {
    const el = $('pp-offer-out'); if (!el) return;
    if (S.offer == null || !o) { el.innerHTML = '<span class="pp-offer-h">Type the price of an offer to see where it stands</span>'; return; }
    const x = S.offer, mc = o.mc, gap = avg != null ? x - avg : null;
    let prob = null, pnl = null;
    if (mc && mc.Us && mc.N) {
      const base = o.imb - o.goP, c = x + base; let lo = 0, hi = mc.N;
      while (lo < hi) { const m = (lo + hi) >> 1; if (mc.Us[m] < c) lo = m + 1; else hi = m; }
      prob = lo / mc.N; pnl = mean(o.years.map(r => r.ev)) * (mc.mean - base - x) / 1000;
    }
    const col = v => v > 0 ? 'var(--red, #ED6965)' : '#14D3A9';
    el.innerHTML = (gap != null ? `<span><b style="color:${col(gap)}">${gap >= 0 ? '+' : '−'}${f2(Math.abs(gap))}</b> <span>€/MWh vs the price shown</span></span>` : '') +
      (prob != null ? `<span><b>${(prob * 100).toFixed(0)} %</b> <span>chance of loss (capacity trend, 10 000 futures)</span></span><span><b style="color:${pnl >= 0 ? '#14D3A9' : '#ED6965'}">${pnl >= 0 ? '+' : '−'}${f0(Math.abs(pnl))}</b> <span>k€ per year expected</span></span>` : '');
  }
  function renderSumWf(o) {
    if (!$('pp-sum-wf') || !o) return;
    const use = methodVals(o).filter(m => INC[m.k] && m.v != null && m.fair != null && m.ref != null);
    if (!use.length) return;
    const ref = wmean(use, 'ref'), fair = wmean(use, 'fair'), price = wmean(use, 'v');
    const risk = price - (fair - o.imb + o.goW - o.margin);
    const st = [['Cal forward', ref, 1], [S.tech === 'wind' ? 'Wind profile' : 'Solar profile', fair - ref], ['Risk', risk], ['Imbalance', -o.imb], ['GO', o.goW], ['Margin', -o.margin], ['PPA price', price, 1]];
    let run0 = 0;
    const bars = st.map(([l, v, t]) => { if (t) { run0 = v; return [0, v]; } const a = run0; run0 += v; return [a, run0]; });
    const col = st.map(([, v, t], i) => t ? (i ? '#14D3A9' : '#8D99AE') : v < 0 ? '#ED6965' : '#14D3A9');
    _fuelChart('pp-sum-wf', { type: 'bar', data: { labels: st.map(x => window.PKI18n ? PKI18n.tr(x[0]) : x[0]), datasets: [{ label: '€/MWh', data: bars.map(b => [+b[0].toFixed(2), +b[1].toFixed(2)]), backgroundColor: col, borderRadius: 3, barPercentage: 0.7 }] },
      options: _fuelOpts({ plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const v = st[c.dataIndex]; return ' ' + (v[2] ? '' : v[1] >= 0 ? '+' : '−') + f2(Math.abs(v[1])) + ' €/MWh'; } } }, pkHoverReadout: false },
        scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('€/MWh', { beginAtZero: true }) } }) }, 'ppa-sum-waterfall');
  }

  // price up in red, down in green, as everywhere on the site
  // ── Compare tab · what moves the price: each input moved alone, first-order (the capture value scales with the
  //    forward; a capture point is 1 % of the forward; costs pass one for one) ──
  function renderSens(o) {
    if (!$('pp-sens') || !o) return;
    const use = methodVals(o).filter(m => INC[m.k] && m.v != null && m.fair != null && m.ref != null);
    if (!use.length) return;
    const fair = wmean(use, 'fair'), ref = wmean(use, 'ref'), price = wmean(use, 'v');
    const tr = x => window.PKI18n ? PKI18n.tr(x) : x;
    const L = [['Cal forward ± 10 %', fair * 0.10], ['Capture rate ± 5 points', ref * 0.05], ['Imbalance cost ± 1 €/MWh', 1], ['GO value ± 1 €/MWh', 1], ['Margin ± 0.5 €/MWh', 0.5]];
    _fuelChart('pp-sens', { type: 'bar', data: { labels: L.map(x => tr(x[0])), datasets: [
      { label: tr('Input lower'), data: L.map(([l, d]) => +(l.startsWith('Imbalance') || l.startsWith('Margin') ? d : -d).toFixed(2)), backgroundColor: L.map(([l]) => l.startsWith('Imbalance') || l.startsWith('Margin') ? '#ED6965AA' : '#14D3A9AA'), borderRadius: 3 },
      { label: tr('Input higher'), data: L.map(([l, d]) => +(l.startsWith('Imbalance') || l.startsWith('Margin') ? -d : d).toFixed(2)), backgroundColor: L.map(([l]) => l.startsWith('Imbalance') || l.startsWith('Margin') ? '#14D3A9AA' : '#ED6965AA'), borderRadius: 3 },
    ] }, options: _fuelOpts({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + (c.raw >= 0 ? '+' : '−') + f2(Math.abs(c.raw)) + ' €/MWh → ' + f2(price + c.raw) + ' €/MWh' } }, pkHoverReadout: false },
      scales: { x: Object.assign(_fuelAxis('€/MWh vs ' + f2(price)), { stacked: true }), y: Object.assign(_fuelXAxis(), { stacked: true, grid: { display: false } }) } }) }, 'ppa-sensitivity');
  }
  // ── Tab 2 · the park: tiles, a schema, the map, production paid by delivery year ──
  let GEO = null;
  const n1 = v => v == null || !isFinite(v) ? '–' : (+v).toFixed(1);
  function renderPark(o) {
    if (!$('pp-park-tiles') || !o) return;
    // capacity left blank: the one that gives the expected production at the national load factor
    const mwE = o.mw || (o.lf ? o.volume / (o.lf * 8760) : null);
    const tech = S.tech === 'wind' ? 'Wind' : 'Solar', flh = mwE ? o.volume / mwE : null, negLost = o.years.reduce((a, r) => a + (r.negShare || 0), 0) / o.years.length;
    $('pp-park-tiles').innerHTML = _fuelKpi('Technology', tech, '', o.useAsset ? 'own production curve' : 'national profile (RTE)') +
      _fuelKpi('Installed capacity', n1(mwE), 'MW', o.mw ? 'input' : 'from production ÷ national load factor') + _fuelKpi('Expected production', f0(o.volume), 'MWh/yr', 'P50') +
      _fuelKpi('Load factor', flh ? n1(flh / 87.6) : '–', '%', 'production ÷ (capacity × 8 760 h)') + _fuelKpi('Full-load hours', flh ? f0(flh) : '–', 'h/yr', 'production ÷ capacity') +
      _fuelKpi('Lost at prices ≤ 0', S.conv === 'all' ? '0' : n1(negLost * 100), '%', S.conv === 'all' ? 'all hours paid' : 'average over the delivery years');
    $('pp-park-schema-sub').textContent = o.useAsset ? S.assetName : (S.tech === 'wind' ? 'National wind profile' : 'National solar profile');
    const box = (x, a, b) => `<rect x="${x}" y="30" width="120" height="70" rx="10" fill="var(--bg3)" stroke="var(--border2)"/><text x="${x + 60}" y="60" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)">${a}</text><text x="${x + 60}" y="82" text-anchor="middle" font-size="11" fill="var(--text3)">${b}</text>`;
    const arr = x => `<line x1="${x}" x2="${x + 34}" y1="65" y2="65" stroke="#14D3A9" stroke-width="2"/><polygon points="${x + 34},60 ${x + 42},65 ${x + 34},70" fill="#14D3A9"/>`;
    $('pp-park-schema').innerHTML = `<svg viewBox="0 0 570 130" style="width:100%;height:auto;font-family:'JetBrains Mono',monospace">${box(0, tech, n1(mwE) + ' MW')}${arr(124)}${box(150, f0(o.volume / 1000 * 10) / 10 + ' GWh', 'per year, P50')}${arr(274)}${box(300, 'Grid', S.conv === 'all' ? 'all hours paid' : 'stops at ≤ 0 €')}${arr(424)}${box(450, 'Buyer', 'PPA ' + o.tenor[0] + '–' + o.tenor[o.tenor.length - 1])}</svg>`;
    // the asset's own daily profile only means something when a curve is loaded
    const pa = $('pp-prof-asset'); if (pa) { const c = pa.closest('.chart-container'); if (c) c.style.display = o.useAsset ? '' : 'none'; }
    // production paid by delivery year, and what the hours at prices ≤ 0 take away
    const lost = o.years.map((r, i) => S.conv === 'all' || r.negShare == null ? 0 : o.volume * Math.pow(1 - o.degr, i) * r.negShare);
    _fuelChart('pp-park-years', { type: 'bar', data: { labels: o.years.map(r => String(r.y)), datasets: [
      { label: 'Production paid', data: o.years.map(r => Math.round(r.ev)), backgroundColor: S.tech === 'wind' ? '#7FC8F8CC' : '#FBBF24CC', borderRadius: 3, stack: 's' },
      { label: 'Not paid, prices ≤ 0', data: lost.map(Math.round), backgroundColor: '#ED696566', borderRadius: 3, stack: 's' },
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true, grid: { display: false } }), y: _fuelAxis('MWh', { stacked: true, beginAtZero: true }) } }) }, 'ppa-park-years');
    // the map: France, the park when its location is known (Tools › Production forecast › Price this park)
    const loc = S.loc && S.useLoc !== false && o.useAsset ? S.loc : null;
    $('pp-park-map-sub').textContent = loc ? f2(loc.lat) + ' N · ' + f2(loc.lon) + ' E' : 'No location: national profile';
    const draw = () => {
      const fr = GEO && GEO.features.find(f => f.properties.iso === 'FR'); if (!fr) return;
      const W = 360, H = 340, x0 = -5.2, x1 = 9.6, y0 = 41.3, y1 = 51.2, k = Math.cos(46.5 * Math.PI / 180);
      const sx = v => (v - x0) / (x1 - x0) * W, sy = v => H - (v - y0) / (y1 - y0) * H * (k * 1.45);
      const polys = fr.geometry.coordinates.map(p => p[0]).filter(r => r.length > 30 && r.some(([a, b]) => a > -5.5 && a < 9.8 && b > 41 && b < 51.5));
      const path = polys.map(r => 'M' + r.filter(([a, b]) => a > -5.5 && a < 9.8 && b > 41 && b < 51.5).map(([a, b]) => sx(a).toFixed(1) + ',' + sy(b).toFixed(1)).join('L') + 'Z').join('');
      $('pp-park-map').innerHTML = `<svg viewBox="0 ${H - H * k * 1.45 - 6} ${W} ${H * k * 1.45 + 12}" style="width:100%;max-width:380px;height:auto;display:block;margin:auto"><path d="${path}" fill="var(--bg3)" stroke="var(--text3)" stroke-width="1"/>` +
        (loc ? `<circle cx="${sx(loc.lon)}" cy="${sy(loc.lat)}" r="14" fill="#14D3A933"/><circle cx="${sx(loc.lon)}" cy="${sy(loc.lat)}" r="5" fill="#14D3A9"/>` : '') + `</svg>` +
        (loc ? '' : `<div class="fuel-note">Price a precise park from Tools › Production forecast › Price this park: its location and production then show here.</div>`);
    };
    if (GEO) draw(); else get('geo/europe.json').then(j => { GEO = j; draw(); });
  }
  function render(o) {
    renderYears(o); renderAuto(o); addHelp();
    inSummary(o);
    renderRest(o);
    renderResBar(o); renderBand(o); renderSumWf(o); renderPark(o); renderSens(o); advCount(); clampNotes();
  }
  // inputs fingerprint: a price computed on other inputs is never shown as current
  function fp() { const c = Object.assign({}, S, { method: null, view: null, last: null, wxLast: null, asset: S.asset ? S.assetName + ':' + (S.asset.slots ? S.asset.slots.length : 0) : null }); return JSON.stringify(c); }
  // the four prices, always in sight; the replay says which method was closest in the past (information, not a recommendation)
  const RB = [['pct', 'Past discount', 'Past discount', 'dashboard'], ['build', 'Capacity trend', 'Capacity trend', 'step'], ['fpc', 'Forward shape', 'Forward shape', 'fpc'], ['wx', 'Weather simulation', 'Weather simulation', 'weather'], ['eu', 'European price model', 'Short-term (monthly)', null]];
  function renderResBar(o) {
    const host = $('pp-resbar'); if (!host || !o) return;
    if (o.m4) S.wxLast = { ppa: o.ppaWx, fp: fp() };
    const wx = o.m4 ? o.ppaWx : S.wxLast && S.wxLast.fp === fp() ? S.wxLast.ppa : null;
    const val = { pct: o.ppaPct, build: o.ppaBuild, fpc: o.ppaFpc, wx, eu: o.ppaEu };
    const cur = S.view === 'compare' ? null : S.method;
    let rel = '';
    if (BT && BT.rows) { const rs = BT.rows.filter(r => r.tech === S.tech && r.year !== 2022), m = {}; RB.forEach(r => { if (rs.length && r[3]) m[r[3]] = mean(rs.map(x => Math.abs(x[r[3]] - x.actual))); }); const best = RB.filter(r => m[r[3]] != null).sort((a, b) => m[a[3]] - m[b[3]])[0];
      if (best) rel = `<span class="rel" title="Historical replay ${BT.targets ? BT.targets[0] + '–' + BT.targets[BT.targets.length - 1] : ''}, 2022 left out: average gap between the capture rate each method predicted and the real one">Most reliable in the replay (${S.tech}): <b>${best[1]}</b>, ${(m[best[3]] * 100).toFixed(1)} pts average error · <a href="#" data-rb-tab="Compare">see the replay</a></span>`; }
    else if (!BT) get('history/ppa_backtest.json').then(j => { if (j) { BT = j; renderResBar(S.last); } });
    host.innerHTML = `<span class="lbl">PPA price · €/MWh</span>` + RB.map(([k, l, tab]) => `<button type="button" class="pp-rb${cur === k ? ' on' : ''}" data-rb-tab="${tab}" title="Open the ${l} tab">${l} ${val[k] != null ? '<b>' + f2(val[k]) + '</b>' : `<span class="na">${k === 'eu' ? 'no forecast past 2030' : 'open its tab'}</span>`}</button>`).join('') + rel;
    // tabs are found by their English label: in French their text is translated (pkEN gives it back)
    host.querySelectorAll('[data-rb-tab]').forEach(b => b.addEventListener('click', e => { e.preventDefault();
      const t = [...document.querySelectorAll('#page-ppapricer .pk-views .tab-btn')].find(x => (window.pkEN ? pkEN(x.textContent.trim()) : x.textContent.trim()) === b.dataset.rbTab); if (t) t.click(); }));
  }
  // how many advanced settings differ from the automatic ones
  const ADV = ['degr', 'alpha', 'imb', 'go', 'disc', 'add', 'volRisk', 'priceRisk', 'mcVol', 'mcFwd', 'mcSd', 'rho', 'volStress', 'spotStress'];
  function advCount() {
    const n = ADV.filter(k => S[k] != null).length + (S.years ? 1 : 0) + ['model', 'hedge', 'pct'].filter(k => S[k] !== S0[k]).length;
    const e = $('pp-adv-n'); if (e) e.textContent = n ? n + ' changed' : '';
  }
  // long notes fold to two lines; a click opens them
  function clampNotes() { document.querySelectorAll('#page-ppapricer .fuel-note').forEach(n => { if (!n.dataset.clamp) { n.dataset.clamp = '1'; n.classList.add('pp-clamp'); n.title = 'Click to read the whole note'; n.addEventListener('click', () => { n.classList.toggle('pp-clamp'); n.title = n.classList.contains('pp-clamp') ? 'Click to read the whole note' : ''; }); } }); }
  // the inputs in one line, readable when the section is folded
  function inSummary(o) {
    const sum = $('pp-in-sum');
    if (sum && o) { const t = sum.closest('.hist-section').classList.contains('collapsed');
      sum.textContent = t ? [(S.tech === 'solar' ? 'Solar' : 'Wind') + ' ' + o.tenor[0] + (o.tenor.length > 1 ? '–' + o.tenor[o.tenor.length - 1] : ''), f0(o.volume) + ' MWh/yr',
        'Cal ' + o.fwds.map(f2).join(' / '), 'years ' + o.sel.map(y => String(y).slice(2)).join(','), 'imb. ' + f2(o.imb), 'GO ' + f2(o.goW), 'margin ' + f2(o.margin), 'click to edit'].join(' · ')
        : 'Click to fold the inputs into one line'; }
  }
  function renderRest(o) {
    const intro = $('pp-intro'); if (intro) intro.innerHTML = INTRO[S.method] || '';
    const tech = S.tech === 'solar' ? 'Solar' : 'Wind', T0 = o.tenor[0], T1 = o.tenor[o.tenor.length - 1], build = S.method !== 'pct', mcA = o.mcAt;
    const other = build ? `Past-discount method: ${f2(o.ppaPct)} €/MWh` : `Capacity-trend method: ${f2(o.ppaBuild)} €/MWh`;
    const wm = S.method === 'wx' && o.m4 ? o.m4 : null;
    if (wm) {
      const Y0 = wm.years[0], Y1 = wm.years[wm.years.length - 1];
      $('pp-kpis').innerHTML = [
        _fuelKpi('PPA price', f2(o.ppa), '€/MWh', `${tech} · ${T0}–${T1} · Monte Carlo on simulated weather`, ''),
        _fuelKpi('Capture rate', pc(Y0.rate) + (wm.years.length > 1 ? ' → ' + pc(Y1.rate) : ''), '', `average of ${wm.N} simulated years per delivery year`),
        _fuelKpi('Cannibalisation', pc(Y0.cannib) + (wm.years.length > 1 ? ' → ' + pc(Y1.cannib) : ''), '', 'same-year prices vs prices of another simulated year'),
        _fuelKpi('Capture value', f2(wm.fair), '€/MWh', 'average over the simulated years'),
        _fuelKpi('Risk premium', f2(wm.premium), '€/MWh', `${o.alpha} % of simulated deliveries earn less than the price`),
      ].join('');
    }
    const fm = !wm && S.method === 'fpc' && o.m3 ? o.m3 : null;
    if (wm) {} else
    if (fm) { const F0 = fm.fwd[0], F1 = fm.fwd[fm.fwd.length - 1]; $('pp-kpis').innerHTML = [
      _fuelKpi('PPA price', f2(o.ppa), '€/MWh', `${tech} · ${T0}–${T1} · asset-specific FPC method`, ''),
      _fuelKpi('Forward profile cost', pc(F0.fwdCost) + (fm.fwd.length > 1 ? ' → ' + pc(F1.fwdCost) : ''), '', 'expected production on the forward curve (FPC)'),
      _fuelKpi('Cannibalisation', pc(F0.cannib) + (fm.fwd.length > 1 ? ' → ' + pc(F1.cannib) : ''), '', fm.flat ? 'flat at the average of the years used' : 'projected with installed capacity'),
      _fuelKpi('Capture value', f2(fm.fair), '€/MWh', 'Cal × (1 + profile cost + cannibalisation)'),
      _fuelKpi('Risk premium', f2(fm.premium), '€/MWh', `spread of the yearly cannibalisation (± ${(fm.sigC * 100).toFixed(1)} pts), ${o.alpha} % accepted`),
    ].join(''); } else
    $('pp-kpis').innerHTML = (build ? [
      _fuelKpi('PPA price', f2(o.ppa), '€/MWh', `${tech} · ${T0}–${T1} · ${(o.ppa / o.refW * 100).toFixed(1)} % of forward`, ''),
      _fuelKpi('Capture value', f2(o.fair), '€/MWh', 'forward × quoted-month factor × (1 − projected shape discount), no risk'),
      _fuelKpi('Risk premium', f2(o.premium), '€/MWh', `${o.alpha} % chance of loss accepted · Monte Carlo`),
      _fuelKpi('Chance of loss', mcA ? (mcA.prob * 100).toFixed(1) : '–', '%', 'at the PPA price, margin included', mcA && mcA.prob > 0.5 ? 'down' : 'up'),
      _fuelKpi('Production', f0(o.volume), 'MWh/yr', o.auto.volume && S.volume == null ? o.auto.volume[1] : 'entered'),
    ] : [
      _fuelKpi('PPA price', f2(o.ppa), '€/MWh', `${tech} · ${T0}–${T1} · ${(o.ppa / o.ref * 100).toFixed(1)} % of forward`, ''),
      _fuelKpi('Reference forward', f2(o.ref), '€/MWh', 'average of the tenor Cal contracts'),
      _fuelKpi('Shape discount used', pc(o.sdCh), '', `${o.pdMode === 'past' ? 'P' + S.pct + ' of the past' : 'projected, trend + P' + S.pct + ' offset'} (${o.useAsset ? 'asset' : 'national'})`),
      _fuelKpi('Break-even', o.be ? 'P' + o.be : '> P100', '', 'percentile where the P&L turns negative', o.be && o.be <= S.pct ? 'down' : 'up'),
      _fuelKpi('Production', f0(o.volume), 'MWh/yr', o.auto.volume && S.volume == null ? o.auto.volume[1] : 'entered'),
    ]).join('');
    // the price, step by step: each step points to the chart it comes from
    const first = o.years[0], last = o.years[o.years.length - 1];
    const step = (t, n, txt, cls) => `<div class="pp-bs${cls ? ' ' + cls : ''}"><div class="t">${t}</div><b class="n">${n}</b>${txt}</div>`;
    $('pp-build').innerHTML = wm ? [
      step('1 · Weather', wm.N + ' years', 'daily sun and wind drawn from each month’s real distribution, with persistence · <a href="#hs-pp-wx" data-go="hs-pp-wx">simulation</a>'),
      step('2 · Production', f0(wm.capS[0]) + ' GW solar · ' + f0(wm.capW[0]) + ' GW wind', `installed in ${T0} on the PPE3 path, hourly shape of a real day`),
      step('3 · Prices', 'Cal ' + f2(wm.years[0].cal), `forward curve × effect of net residual load, measured on ${wm.recent.join('–')}; each year rescaled to its Cal`),
      step('4 · Capture value', f2(wm.fair) + ' €/MWh', `capture rate ${pc(wm.years[0].rate)} in ${T0}, cannibalisation ${pc(wm.years[0].cannib)}`),
      step('5 · Risk premium', '−' + f2(wm.premium) + ' €/MWh', `${o.alpha} % of simulated deliveries earn less`),
      step('PPA price', f2(o.ppa) + ' €/MWh', `imbalance −${f2(o.imb)}, GO +${f2(o.goW)}, margin −${f2(o.margin)}`, 'final'),
    ].join('') : fm ? [
      step('1 · Forward curve', f2(fm.refW) + ' €/MWh', `hourly FPC calibrated on ${fm.used.length} quotes (${esc(fm.used.slice(0, 4).join(', '))}${fm.used.length > 4 ? '…' : ''}) · <a href="#hs-pp-fpc" data-go="hs-pp-fpc">curve</a>`),
      step('2 · Forward profile cost', pc(fm.fwd[0].fwdCost), `expected ${S.tech} production × FPC, ${T0} (no link with the weather)`),
      step('3 · Cannibalisation', pc(fm.fwd[0].cannib) + (fm.fwd.length > 1 ? ' → ' + pc(fm.fwd[fm.fwd.length - 1].cannib) : ''), `historical (1) − decorrelated (3) on ${fm.years.length} years, ${fm.flat ? 'flat' : 'projected with capacity'} · <a href="#hs-pp-fpc" data-go="hs-pp-fpc">by year</a>`),
      step('4 · Capture value', f2(fm.fair) + ' €/MWh', 'Cal × (1 + profile cost + cannibalisation), weighted'),
      step('5 · Risk premium', '−' + f2(fm.premium) + ' €/MWh', `${o.alpha} % chance to miss, from the spread of the yearly cannibalisation`),
      step('PPA price', f2(o.ppa) + ' €/MWh', `imbalance −${f2(o.imb)}, GO +${f2(o.goW)}, margin −${f2(o.margin)} · other methods ${f2(o.ppaBuild)} / ${f2(o.ppaPct)}`, 'final'),
    ].join('') : build ? [
      step('1 · Forward', f2(o.refW) + ' €/MWh', `Cal ${T0}–${T1}, weighted by production${o.disc ? ' and discounted' : ''} · <a href="#pp-fwd" data-go="hs-pp-in">inputs</a>`),
      step('2 · Cannibalisation', pc(first.fsd) + ' → ' + pc(last.fsd), `shape discount ${T0} → ${T1}, ${MODEL_T[o.model]} · <a href="#hs-pp-mkt" data-go="hs-pp-mkt">chart</a>`),
      step('3 · Capture value', f2(o.fair) + ' €/MWh', 'forward × k × (1 − shape discount), year by year · <a href="#pp-years" data-go="hs-pp-price">table</a>'),
      step('4 · Risk premium', '−' + f2(o.premium) + ' €/MWh', `price with a ${o.alpha} % chance of loss, ${o.mc && o.mc.hedged ? 'forward hedged' : 'forward open'} · <a href="#hs-pp-mc" data-go="hs-pp-mc">Monte Carlo</a>`),
      step('5 · Costs and GO', (o.goW - o.imb - o.margin - o.refW * o.add / 100 >= 0 ? '+' : '−') + f2(Math.abs(o.goW - o.imb - o.margin - o.refW * o.add / 100)) + ' €/MWh', `imbalance −${f2(o.imb)}, GO +${f2(o.goW)}, margin −${f2(o.margin)}${o.add ? ', add. discount −' + f2(o.refW * o.add / 100) : ''}`),
      step('PPA price', f2(o.ppa) + ' €/MWh', other, 'final'),
    ].join('') : [
      step('1 · Forward', f2(o.ref) + ' €/MWh', `average of Cal ${T0}–${T1}`),
      step('2 · Shape discount', pc(o.sdCh), `${o.pdTxt} · <a href="#hs-pp-mkt" data-go="hs-pp-mkt">history</a>`),
      step('3 · Risks', '−' + f2(o.ref * (o.add + o.volRisk + o.priceRisk) / 100) + ' €/MWh', `additional ${o.add} %, volume ${o.volRisk} %, price ${o.priceRisk} % of the forward`),
      step('4 · Costs and GO', (o.goVal - o.margin - o.imb >= 0 ? '+' : '−') + f2(Math.abs(o.goVal - o.margin - o.imb)) + ' €/MWh', `imbalance −${f2(o.imb)}, GO +${f2(o.goVal)}, margin −${f2(o.margin)}`),
      step('PPA price', f2(o.ppa) + ' €/MWh', other, 'final'),
    ].join('');
    $('pp-build').querySelectorAll('a[data-go]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const sec = $(a.dataset.go); if (sec) { sec.classList.remove('collapsed'); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }));
    // waterfall
    const steps = wm
      ? [['Forward', wm.refW], ['Capture discount', wm.fair - wm.refW], ['Risk premium', -wm.premium], ['Add. discount', -wm.refW * o.add / 100], ['Imbalance', -o.imb], ['GO value', o.goW], ['Margin', -o.margin]]
      : fm
      ? [['Forward', fm.refW], ['Profile cost', fm.refW * mean(fm.fwd.map(r => r.fwdCost))], ['Cannibalisation', fm.fair - fm.refW - fm.refW * mean(fm.fwd.map(r => r.fwdCost))], ['Risk premium', -fm.premium], ['Add. discount', -fm.refW * o.add / 100], ['Imbalance', -o.imb], ['GO value', o.goW], ['Margin', -o.margin]]
      : build
      ? [['Forward', o.refW], ['Shape discount', o.fair - o.refW], ['Risk premium', -o.premium], ['Add. discount', -o.refW * o.add / 100], ['Imbalance', -o.imb], ['GO value', o.goW], ['Margin', -o.margin]]
      : [['Forward', o.ref], ['Shape discount', -o.pdEur], ['Add. discount', -o.ref * o.add / 100], ['Volume risk', -o.ref * o.volRisk / 100], ['Price risk', -o.ref * o.priceRisk / 100], ['Imbalance', -o.imb], ['GO value', o.goVal], ['Margin', -o.margin]];
    const st2 = steps.filter(([l, v], i) => i === 0 || Math.abs(v) > 0.005);
    let acc = 0; const bars = st2.map(([l, v], i) => { if (i === 0) { acc = v; return [0, v]; } const a = acc; acc += v; return [a, acc]; });
    bars.push([0, o.ppa]);
    const labels = st2.map(s => s[0].split(' ')).concat([['PPA', 'price']]), colsW = st2.map(([, v], i) => i === 0 ? 'rgba(127,200,248,.75)' : v < 0 ? 'rgba(237,105,101,.8)' : 'rgba(20,211,169,.8)').concat('#FBBF24');
    _fuelChart('pp-waterfall', { type: 'bar', data: { labels, datasets: [{ label: '€/MWh', data: bars, backgroundColor: colsW, borderRadius: 3, borderSkipped: false }] },
      options: _fuelOpts({ plugins: { legend: { display: false }, pkHoverReadout: false, tooltip: { enabled: true, callbacks: { label: c => { const r = c.raw; const v = c.dataIndex === 0 || c.dataIndex === labels.length - 1 ? r[1] : r[1] - r[0]; return ' ' + (v > 0 && c.dataIndex && c.dataIndex < labels.length - 1 ? '+' : '') + v.toFixed(2) + ' €/MWh'; } } } },
        scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false }, ticks: { color: C_TX2, font: { size: 10 }, autoSkip: false, maxRotation: 0 } }), y: _fuelAxis('€/MWh', { beginAtZero: true }) } }) }, 'ppa-waterfall');
    // year table
    $('pp-years').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table pp-ptab"><thead><tr><th style="text-align:left">Year</th><th>Forward</th><th>Shape disc.</th><th>Capture</th><th>Neg. hours</th><th>MWh${S.conv === 'pos' ? ' paid' : ''}</th><th>P&L k€</th></tr></thead><tbody>` +
      o.years.map(r => `<tr><td style="text-align:left">${r.y}</td><td>${f2(r.fwd)}</td><td>${pc(r.fsd)} <span class="pp-hint">± ${(r.sig * 100).toFixed(1)}</span></td><td>${f2(r.cp)}</td><td title="${r.negShare != null ? (r.negShare * 100).toFixed(1) + ' % of the output at prices ≤ 0' : ''}">${f0(r.negH)}</td><td>${f0(r.ev)}</td><td class="${r.pnlK >= 0 ? 'pp-pos' : 'pp-neg'}">${sgn(r.pnlK)}</td></tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">${o.years.some(r => r.kq != null && Math.abs(r.kq - 1) > 0.0005) ? (FRDOC() ? `Facteur des mois cotés k (le niveau lu mois par mois, comme le reste de l’outil) : ${o.years.map(r => r.y + ' ' + (r.kq || 1).toFixed(3)).join(', ')} ; valeur captée = forward × k × capture. ` : `Quoted-month factor k (the level read month by month, as the rest of the tool does): ${o.years.map(r => r.y + ' ' + (r.kq || 1).toFixed(3)).join(', ')}; capture value = forward × k × capture. `) : ''}Shape discount ${MODEL_T[o.model]}, from ${o.lastYr} (${pc(o.proj(o.lastYr))}, ${o.useAsset ? 'asset' : 'national'}); ± = 1 σ of the projection. Negative hours projected with the solar build-out${S.conv === 'pos' ? '; with the PPA Dashboard convention the output at prices ≤ 0 is not paid, so the volume paid shrinks as they grow' : ''}. P&L = production × (capture − imbalance + GO − PPA price), central case.</div>`;
    // P&L vs percentile
    _fuelChart('pp-pnl', { type: 'line', data: { labels: o.pcts.map(p => 'P' + p), datasets: [
      { label: 'Annual P&L (k€)', data: o.pnlCurve.map(v => Math.round(v)), borderColor: '#FFFFFF', borderWidth: 2, pointRadius: 0, fill: { target: { value: 0 }, above: 'rgba(20,211,169,.18)', below: 'rgba(237,105,101,.22)' } },
    ] }, options: _fuelOpts({ plugins: { legend: { display: false } }, scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 11, maxRotation: 0 } }), y: _fuelAxis('k€ per year') } }) }, 'ppa-pnl-percentile');
    $('pp-pnl-sub').textContent = `If cannibalisation came back like the years ${o.sel.join(', ')}: production × (forward × (1 − shape discount at each percentile) − imbalance + GO − PPA)` + (o.be ? ` · break-even P${o.be}` : ' · no loss up to P100');
    // scenarios
    $('pp-scen').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Scenario · total over ${o.tenor.length} years</th><th>Low k€</th><th>Central k€</th><th>High k€</th></tr></thead><tbody>` +
      o.scen.map(r => `<tr><td style="text-align:left">${r.name}</td>${[r.p10, r.p50, r.p90].map(v => `<td class="${v >= 0 ? 'pp-pos' : 'pp-neg'}">${sgn(v)}</td>`).join('')}</tr>`).join('') +
      `<tr class="mu-sep"><td colspan="4" style="text-align:left;color:var(--accent);font-weight:600;font-size:11px;letter-spacing:.05em;text-transform:uppercase">Beyond history</td></tr>` +
      (o.scenX || []).map(r => `<tr><td style="text-align:left" title="${r.how}">${r.name}<div class="fuel-note" style="margin:0">${r.how}</div></td>${[r.p10, r.p50, r.p90].map(v => `<td class="${v >= 0 ? 'pp-pos' : 'pp-neg'}">${sgn(v)}</td>`).join('')}</tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">${build ? 'Low / high: projected shape discount ± 1.28 σ (P90 / P10 of the projection).' : 'Low / high: 90th / 10th percentile of the historical shape discount.'} Spot stress scales the forward; cannibalisation stress shifts the shape discount; volume stress scales production. Beyond history: shocks the past years never showed (amplified gap, 1-in-100 tail, named situations), on the same low / central / high discount. No hedge in this table.</div>`;
    // asset diagnostics
    const ad = $('pp-asset-info');
    if (ad) ad.textContent = o.ast ? `${S.assetName}: capture rate ${o.ast.map(x => x.year + ' ' + pc(x.cpPct) + (x.negMwh > 0.05 && S.conv !== 'all' ? ' (' + f0(x.negMwh) + ' MWh at prices ≤ 0 left out)' : '')).join(' · ')}` : `No asset curve: national ${tech.toLowerCase()} profile (RTE) used. Load a curve or a test curve to price an asset's own profile.`;
    renderDoc(o);
    renderCompare(o);
    renderBacktest();
    try { renderWx(o); } catch (e) { console.warn('[ppa] wx render', e); }
    try { renderFpc(o); } catch (e) { console.warn('[ppa] fpc render', e); }
  }

  // ── Market & methodology charts (the PPA Dashboard Overview and Market Evolution tabs) ──
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MCOL = ['#3B82F6', '#7FC8F8', '#ED6965', '#F4A7A3', '#14D3A9', '#6EE7B7', '#F59E0B', '#FBBF24', '#A87DC4', '#C9CED6', '#1D4ED8', '#93C5FD'];
  // Text labels drawn on given points: [{ ds, i, text, dy }]
  const labelPlugin = (marks) => ({ id: 'ppMarks', afterDatasetsDraw(ch) {
    const g = ch.ctx, placed = []; g.save(); g.font = '600 10.5px "JetBrains Mono", monospace'; g.textAlign = 'center';
    marks.forEach(m => { const meta = ch.getDatasetMeta(m.ds); const el = meta && meta.data[m.i]; if (!el || !ch.isDatasetVisible(m.ds)) return;
      const w = g.measureText(m.text).width + 8, dy = m.dy || -12;
      // first free spot among above, below, right, left; a label that fits nowhere is left to the tooltip
      const spots = [[0, dy], [0, -dy + 6], [w / 2 + 8, 4], [-w / 2 - 8, 4]], a = ch.chartArea;
      const at = spots.map(([ox, oy]) => [el.x + ox, el.y + oy]).find(([x, y]) => x - w / 2 >= a.left - 4 && x + w / 2 <= a.right + 4 && y - 10 >= a.top - 14 && y + 5 <= a.bottom
        && !placed.some(r => x - w / 2 < r[2] && x + w / 2 > r[0] && y - 10 < r[3] && y + 5 > r[1]));
      if (!at) return;
      const [x, y] = at; placed.push([x - w / 2, y - 10, x + w / 2, y + 5]);
      if (m.box) { g.fillStyle = 'rgba(15,20,25,.92)'; g.strokeStyle = m.color || '#FBBF24'; g.lineWidth = 1; g.fillRect(x - w / 2, y - 10, w, 15); g.strokeRect(x - w / 2, y - 10, w, 15); }
      g.fillStyle = m.color || '#FFFFFF'; g.fillText(m.text, x, y + 1); });
    g.restore(); } });
  // Shade category columns (years left out of the regression)
  const shadePlugin = (idx) => ({ id: 'ppShade', beforeDatasetsDraw(ch) {
    const xs = ch.scales.x, a = ch.chartArea, g = ch.ctx; if (!xs || !idx.length) return;
    const step = xs.getPixelForValue(1) - xs.getPixelForValue(0); g.save(); g.fillStyle = 'rgba(251,191,36,.10)';
    idx.forEach(i => { const x = xs.getPixelForValue(i); g.fillRect(x - step / 2, a.top, step, a.bottom - a.top); }); g.restore(); } });

  const IDS = { proj: 'pp-proj', projSub: 'pp-proj-sub', projTable: 'pp-proj-table', capfit: 'pp-capfit', capfitSub: 'pp-capfit-sub', profNat: 'pp-prof-nat', profNatSub: 'pp-prof-nat-sub',
    profAsset: 'pp-prof-asset', profAssetSub: 'pp-prof-asset-sub', xc: 'pp-xc', xcSub: 'pp-xc-sub', hc: 'pp-hc', hcSub: 'pp-hc-sub', xcy: 'pp-xcy', xcySub: 'pp-xcy-sub', monthly: 'pp-monthly', annual: 'pp-annual', rollPct: 'pp-roll-pct', rollEur: 'pp-roll-eur', rollSub: 'pp-roll-pct-sub', negh: 'pp-negh', neghSub: 'pp-negh-sub' };
  // capture rate vs installed capacity, France and its neighbours. x axis: GW installed, % of average load, or % of the installed fleet.
  // Each country: one point per complete year (2022 left out, as in the French fit) and its trend, capture = a + b · ln(x).
  // The legend switches a country on and off, its trend with it.
  const CCOL = { FR: '#FBBF24', DE: '#7FC8F8', BE: '#ED6965', NL: '#F2A65A', ES: '#A87DC4', UK: '#94D2BD' }, CNAME = { FR: 'France', DE: 'Germany', BE: 'Belgium', NL: 'Netherlands', ES: 'Spain', UK: 'United Kingdom' };
  const XC_AX = { gw: ['GW installed', f => f.g], load: ['% of average load', f => f.g / f.avgLoadGW * 100], share: ['% of the installed fleet', f => f.totalGW ? f.g / f.totalGW * 100 : null] };
  const xcHidden = {};
  function drawXC(cid, subId, st) {
    if (!D || !D.cc || !document.getElementById(cid)) return;
    const sel = document.getElementById(cid + '-axis'), mode = sel ? sel.value : 'gw';
    if (sel) { sel._st = st; if (!sel.dataset.wired) { sel.dataset.wired = '1'; sel.addEventListener('change', () => drawXC(cid, subId, sel._st)); } }
    const hide = xcHidden[cid] || (xcHidden[cid] = { NL: true, UK: true });
    const tech = st.tech === 'solar' ? 'Solar' : 'Wind', gk = st.tech === 'solar' ? 'solarGW' : 'windGW';
    const key = st.tech === 'solar' ? (st.conv === 'pos' ? 'solarRatePos' : 'solarRate') : (st.conv === 'pos' ? 'windRatePos' : 'windRate');
    const [axName, xOf] = XC_AX[mode], ds = [], marks = [], r1 = v => Math.round(v * 10) / 10;
    let xMax = 0;
    Object.keys(CNAME).filter(c => D.cc[c]).forEach(c => {
      const pts = Object.entries(D.cc[c].years).map(([y, f]) => ({ y: +y, f: Object.assign({ g: f[gk] }, f) }))
        .filter(r => r.f.complete && r.y !== 2022 && r.f.g && r.f[key] && r.f.avgLoadGW && xOf(r.f))
        .map(r => ({ x: r1(xOf(r.f)), y: Math.round(r.f[key] * 1000) / 10, yr: r.y, c })).sort((a, b) => a.x - b.x);
      if (pts.length < 2) return;
      xMax = Math.max(xMax, ...pts.map(p => p.x));
      const L = pts.map(p => Math.log(p.x)), Y = pts.map(p => p.y), mx = mean(L), my = mean(Y);
      const b = L.reduce((a, l, i) => a + (l - mx) * (Y[i] - my), 0) / (L.reduce((a, l) => a + (l - mx) ** 2, 0) || 1), a0 = my - b * mx;
      const r2 = 1 - Y.reduce((a, y, i) => a + (y - (a0 + b * L[i])) ** 2, 0) / (Y.reduce((a, y) => a + (y - my) ** 2, 0) || 1);
      const hidden = !!hide[c];
      ds.push({ type: 'scatter', label: CNAME[c], cc: c, data: pts, pointRadius: c === 'FR' ? 6 : 4.5, backgroundColor: CCOL[c], borderColor: '#0F1419', hidden });
      const x0 = pts[0].x, x1 = pts[pts.length - 1].x * (c === 'FR' && mode !== 'share' ? 2.6 : 1.15), line = [];
      for (let k = 0; k <= 40; k++) { const x = x0 * Math.pow(x1 / x0, k / 40); line.push({ x: r1(x), y: Math.round((a0 + b * Math.log(x)) * 10) / 10 }); }
      ds.push({ type: 'line', label: CNAME[c] + ' trend', cc: c, trend: true, r2, data: line, borderColor: CCOL[c], borderDash: [5, 4], borderWidth: c === 'FR' ? 2 : 1.3, pointRadius: 0, fill: false, hidden });
      const l = pts.reduce((m, p) => p.yr > m.yr ? p : m, pts[0]);
      marks.push({ ds: ds.length - 2, i: pts.indexOf(l), text: c + ' ' + l.yr, dy: -11, color: CCOL[c] });
    });
    // France's PPE3 targets (GW, or % of today's average load)
    const frY = D.cc.FR && Object.entries(D.cc.FR.years).filter(([, f]) => f.complete && f.avgLoadGW).pop();
    if (frY && mode !== 'share') {
      const tg = Object.entries(PPE3[st.tech]).map(([yr, gw]) => ({ x: r1(mode === 'gw' ? gw : gw / frY[1].avgLoadGW * 100), yr: +yr, gw }));
      const yMin = Math.min(...ds.filter(d => !d.trend && !d.hidden).flatMap(d => d.data.map(p => p.y)), 100) - 4;
      ds.push({ type: 'scatter', label: 'France PPE3', cc: 'PPE', data: tg.map(t => ({ x: t.x, y: yMin, yr: t.yr, gw: t.gw })), pointStyle: 'triangle', pointRadius: 8, backgroundColor: '#FBBF24', borderColor: '#0F1419' });
      tg.forEach((t, i) => marks.push({ ds: ds.length - 1, i, text: `PPE3 ${t.yr}`, dy: -12, color: '#FBBF24' }));
    }
    const legendClick = (e, item, legend) => { const ch = legend.chart, c = ch.data.datasets[item.datasetIndex].cc; const now = !ch.data.datasets[item.datasetIndex].hidden;
      ch.data.datasets.forEach(d => { if (d.cc === c) d.hidden = now; }); if (c !== 'PPE') hide[c] = now; ch.update(); };
    _fuelChart(cid, { type: 'scatter', data: { datasets: ds }, plugins: [labelPlugin(marks)],
      options: _fuelOpts({ interaction: { mode: 'nearest', intersect: true }, plugins: { pkHoverReadout: false,
        legend: { display: true, position: 'bottom', onClick: legendClick, labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: (it, data) => !data.datasets[it.datasetIndex].trend } },
        tooltip: { enabled: true, filter: it => !it.dataset.trend, callbacks: { label: c => c.raw.gw ? ` France PPE3 ${c.raw.yr}: ${c.raw.gw} GW` : ` ${CNAME[c.raw.c]} ${c.raw.yr}: ${c.raw.x.toFixed(1)} ${mode === 'gw' ? 'GW' : '%'} · capture ${c.raw.y.toFixed(1)} %` } } },
        layout: { padding: { right: 24, top: 10 } }, scales: { x: Object.assign(_fuelAxis(tech + ' installed, ' + axName), { type: 'linear', min: 0 }), y: _fuelAxis('capture rate, % of baseload') } }) }, 'ppa-capture-countries');
    const fit = ds.filter(d => d.trend && !d.hidden).map(d => `${d.cc} R² ${d.r2.toFixed(2)}`).join(', ');
    const e = document.getElementById(subId); if (e) e.textContent = `One point per year, 2022 left out · dashed: trend of each country${fit ? ' (' + fit + ')' : ''} · ${st.conv === 'pos' ? 'hours > 0 €' : 'all hours'} · click a country in the legend to hide or show it · Energy-Charts output for every country (France differs from the RTE-based charts by 2–3 points on solar)`;
  }

  // hour by hour: price of the hour (% of the month's average) against the solar or wind share of the load that hour,
  // the country's own share or the share over the coupled region
  function drawHC(cid, subId, st) {
    if (!D || !D.hc || !document.getElementById(cid)) return;
    const sel = document.getElementById(cid + '-mode'), mode = sel ? sel.value : 'regional';
    if (sel) { sel._st = st; if (!sel.dataset.wired) { sel.dataset.wired = '1'; sel.addEventListener('change', () => drawHC(cid, subId, sel._st)); } }
    const tech = st.tech === 'solar' ? 'solar' : 'wind', cv = D.hc.curves[tech] && D.hc.curves[tech][mode];
    if (!cv) return;
    const ds = Object.keys(cv).filter(c => CNAME[c]).map(c => ({ label: CNAME[c], data: cv[c].map(([x, y, n]) => ({ x, y, n })), borderColor: CCOL[c], backgroundColor: CCOL[c],
      borderWidth: c === 'FR' ? 2.8 : 1.6, pointRadius: c === 'FR' ? 3.5 : 2.5, tension: 0, fill: false }));
    _fuelChart(cid, { type: 'line', data: { datasets: ds }, options: _fuelOpts({ interaction: { mode: 'nearest', intersect: false },
      plugins: { pkHoverReadout: false, legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } },
        tooltip: { enabled: true, callbacks: { label: c => ` ${c.dataset.label}: ${c.raw.y.toFixed(0)} % of the month's average price at ${c.raw.x - D.hc.bin / 2}–${c.raw.x + D.hc.bin / 2} % ${tech} (${c.raw.n} hours)` } } },
      scales: { x: Object.assign(_fuelAxis(`${tech} output, % of the load that hour (${mode === 'own' ? 'own country' : 'France + Germany + Belgium + Spain'})`), { type: 'linear', min: 0 }),
        y: _fuelAxis("price of the hour, % of the month's average") } }) }, 'ppa-hourly-cannibalisation');
    const r2 = D.hc.r2[tech], e = document.getElementById(subId);
    if (e) e.textContent = `${D.hc.years[0]}–${D.hc.years[D.hc.years.length - 1]}, every hour · price explained by the ${mode === 'own' ? "country's own" : "coupled region's"} ${tech} share: ` +
      Object.keys(r2).map(c => `${c} ${Math.round(r2[c][mode] * 100)} %`).join(', ') + ` (${mode === 'own' ? 'regional' : 'own'}: ` + Object.keys(r2).map(c => `${c} ${Math.round(r2[c][mode === 'own' ? 'regional' : 'own'] * 100)} %`).join(', ') + ') · Energy-Charts';
  }

  function renderMarket(o, st = S, ids) {
    ids = ids || IDS;
    const has = k => ids[k] && document.getElementById(ids[k]);
    const setT = (k, t) => { const e = ids[k] && document.getElementById(ids[k]); if (e) e.textContent = t; };
    const tech = st.tech === 'solar' ? 'Solar' : 'Wind', tc = st.tech === 'solar' ? '#FBBF24' : '#14D3A9';
    const first = o.hist[0].year, endY = Math.max(2035, o.tenor[o.tenor.length - 1]), Y = [];
    for (let y = first; y <= endY; y++) Y.push(y);
    const pc1 = v => v == null ? null : Math.round(v * 1000) / 10;
    const natM = new Map(o.nat.map(x => [x.year, x])), astM = o.ast ? new Map(o.ast.map(x => [x.year, x])) : null;
    const lastY = o.lastYr, sig = t => o.sigT(t);
    const bandV = (y, z) => y <= lastY ? null : pc1(1 - (o.proj(y) + z * sig(y - lastY)));
    const excluded = o.useAsset ? [] : o.excluded;
    const fit = o.cfit, ppe = fit ? Object.entries(PPE3[st.tech]).map(([yr, gw]) => ({ yr: +yr, gw, cp: fit.f(gw), cpA: fit.f(gw) + o.capOff })) : [];
    const tenorSet = new Set(o.tenor);
    const ds = [
      { label: '_p90', data: Y.map(y => bandV(y, -1.28)), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'P10–P90', data: Y.map(y => bandV(y, 1.28)), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(251,191,36,.12)', fill: '-1' },
      { label: '_p75', data: Y.map(y => bandV(y, -0.674)), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'P25–P75', data: Y.map(y => bandV(y, 0.674)), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(251,191,36,.24)', fill: '-1' },
      { label: 'National ' + tech.toLowerCase() + ' capture rate', data: Y.map(y => natM.has(y) ? pc1(natM.get(y).cpPct) : null), borderColor: '#3FA6B4', borderDash: [6, 4], borderWidth: 1.6, pointStyle: 'rect', pointRadius: 4, backgroundColor: '#3FA6B4', fill: false, spanGaps: false },
      ...(astM ? [{ label: (st.assetName || 'Asset') + ' capture rate', data: Y.map(y => astM.has(y) ? pc1(astM.get(y).cpPct) : null), borderColor: tc, borderWidth: 2, pointRadius: 4, backgroundColor: tc, fill: false }] : []),
      { label: 'Trend (linear regression on the years used)', data: Y.map(y => y >= Math.min(...o.sel) - 4 ? pc1(1 - Math.max(-0.5, Math.min(1.5, o.reg.ic + o.reg.sl * y))) : null), borderColor: 'rgba(184,201,217,.55)', borderDash: [2, 3], borderWidth: 1.2, pointRadius: 0, fill: false },
      { label: 'P50 — tenor', data: Y.map(y => tenorSet.has(y) || y === lastY ? pc1(1 - o.proj(y)) : null), borderColor: '#FFFFFF', borderWidth: 2.6, pointRadius: Y.map(y => tenorSet.has(y) ? 4 : y === lastY ? 5 : 0), backgroundColor: '#FFFFFF', fill: false, spanGaps: true },
      { label: 'P50 after the tenor', data: Y.map(y => y >= o.tenor[o.tenor.length - 1] ? pc1(1 - o.proj(y)) : null), borderColor: 'rgba(255,255,255,.45)', borderDash: [3, 3], borderWidth: 1.2, pointRadius: 2, fill: false, spanGaps: true },
      ...ppe.map(t => ({ label: 'PPE3 ' + t.yr, data: Y.map(y => y === t.yr ? pc1(o.model === 'capacity' ? t.cpA : t.cp) : null), pointStyle: 'rectRot', pointRadius: 8, backgroundColor: '#3FA6B4', borderColor: '#0F1419', showLine: false })),
    ];
    const iP50 = ds.findIndex(d => d.label === 'P50 — tenor');
    const marks = o.tenor.map((y, k) => ({ ds: iP50, i: Y.indexOf(y), text: Math.round((1 - o.proj(y)) * 100) + '%', dy: k % 2 ? 22 : -14, box: true }))
      .concat(ppe.map(t => ({ ds: ds.findIndex(d => d.label === 'PPE3 ' + t.yr), i: Y.indexOf(t.yr), text: t.yr + ' ' + Math.round((o.model === 'capacity' ? t.cpA : t.cp) * 100) + '%', dy: -14, color: '#3FA6B4' })));
    if (has('proj')) _fuelChart(ids.proj, { type: 'line', data: { labels: Y, datasets: ds }, plugins: [labelPlugin(marks), shadePlugin(excluded.map(y => Y.indexOf(y)))],
      options: _fuelOpts({ layout: { padding: { right: 46, top: 10 } }, plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10, filter: it => !/^_/.test(it.text) } } },
        scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0 } }), y: _fuelAxis('capture rate, % of baseload') } }) }, 'ppa-capture-projection');
    setT('projSub', `Projection ${MODEL_T[o.model]} from ${lastY} · ${o.useAsset ? 'asset' : 'national'} years used ${o.sel.join(', ')}${excluded.length ? ' (shaded: left out)' : ''} · bands ± ${(o.sig0 * 100).toFixed(1)} pts × √years · tenor ${o.tenor[0]}–${o.tenor[o.tenor.length - 1]} · this is step 2 of the price`);
    // P10 / P50 / P90 table
    const rows = []; for (let y = lastY + 1; y <= endY; y++) rows.push(y);
    if (has('projTable')) document.getElementById(ids.projTable).innerHTML = `<table class="fuel-table pp-ptab"><thead><tr><th style="text-align:left">Year</th><th>P10</th><th>P50</th><th>P90</th></tr></thead><tbody>` +
      rows.map(y => `<tr class="${tenorSet.has(y) ? 'pp-tenor' : ''}"><td style="text-align:left">${y}</td><td>${bandV(y, 1.28).toFixed(1)}%</td><td><b>${pc1(1 - o.proj(y)).toFixed(1)}%</b></td><td>${bandV(y, -1.28).toFixed(1)}%</td></tr>`).join('') +
      `</tbody></table><div class="fuel-note">Capture rate, % of baseload. Highlighted: tenor. P10 = low capture (strong cannibalisation).</div>`;
    // CP% vs installed capacity
    const cap = D.capGW[st.tech];
    const scat = o.nat.filter(x => cap[x.year]);   // a year without its installed capacity is not placed
    const capOf = x => cap[x.year] || cap[Math.max(...Object.keys(cap).map(Number))];
    if (fit) {
      const xMax = Math.max(...ppe.map(t => t.gw), ...scat.map(capOf)) * 1.05, xMin = Math.min(...scat.map(capOf)) * 0.95, line = [];
      for (let k = 0; k <= 60; k++) { const gw = xMin + (xMax - xMin) * k / 60; line.push({ x: gw, y: pc1(fit.f(gw)) }); }
      const pts = scat.map(x => ({ x: capOf(x), y: pc1(x.cpPct), yr: x.year, partial: !x.complete }));
      const ds2 = [
        { type: 'scatter', label: 'National ' + tech.toLowerCase() + ' (one point per year)', data: pts, pointRadius: 7, backgroundColor: pts.map(p => p.partial ? '#FBBF24' : (o.excluded || []).includes(p.yr) ? 'rgba(63,166,180,.35)' : '#3FA6B4'), borderColor: '#0F1419' },
        { type: 'line', label: `Log fit (R² ${fit.r2.toFixed(2)})`, data: line, borderColor: '#FFFFFF', borderWidth: 1.8, pointRadius: 0, fill: false },
        { type: 'scatter', label: 'PPE3 targets', data: ppe.map(t => ({ x: t.gw, y: pc1(t.cp) })), pointStyle: 'rectRot', pointRadius: 9, backgroundColor: '#ED6965', borderColor: '#0F1419' },
      ];
      const marks2 = pts.map((p, i) => ({ ds: 0, i, text: String(p.yr) + (p.partial ? ' YTD' : ''), dy: p.partial ? 20 : -11, color: p.partial ? '#FBBF24' : '#B8C9D9' }))
        .concat(ppe.map((t, i) => ({ ds: 2, i, text: `PPE3 ${t.yr}: ${t.gw} GW → ${Math.round(t.cp * 100)}%`, dy: -14, color: '#ED6965' })));
      if (has('capfit')) _fuelChart(ids.capfit, { type: 'scatter', data: { datasets: ds2 }, plugins: [labelPlugin(marks2)],
        options: _fuelOpts({ interaction: { mode: 'nearest', intersect: true }, plugins: { pkHoverReadout: false, tooltip: { enabled: true, callbacks: { label: c => ` ${c.raw.yr || ''} ${c.raw.x.toFixed(1)} GW · ${c.raw.y.toFixed(1)} %` } } },
          layout: { padding: { right: 30, top: 10 } }, scales: { x: Object.assign(_fuelAxis(tech + ' installed capacity (GW)'), { type: 'linear' }), y: _fuelAxis('capture rate, % of baseload') } }) }, 'ppa-cp-vs-capacity');
      setT('capfitSub', `Each point = one year (${(st.conv === 'curt' ? 'curtailment at prices ≤ 0' : st.conv === 'pos' ? 'hours > 0 €/MWh' : 'all hours')}). Log fit on ${fit.use.join(', ')}; PPE3 targets ${Object.entries(PPE3[st.tech]).map(([y, g]) => y + ' ' + g + ' GW').join(', ')}${o.model === 'capacity' ? ' · drives the projection (anchored on ' + lastY + ')' : ''}.`);
    } else if (has('capfit')) noDataMsg(ids.capfit, 'Installed capacity not available', '');
    // France and its neighbours: capture rate against installed capacity, one colour per country with its trend (log fit)
    if (has('xc') && D.cc) drawXC(ids.xc, ids.xcSub, st);
    if (has('hc') && D.hc) drawHC(ids.hc, ids.hcSub, st);
    if (has('xcy') && D.cc) {
      const CCOL = { FR: '#FBBF24', DE: '#7FC8F8', BE: '#ED6965', NL: '#F2A65A', ES: '#A87DC4', UK: '#94D2BD' }, CNAME = { FR: 'France', DE: 'Germany', BE: 'Belgium', NL: 'Netherlands', ES: 'Spain', UK: 'United Kingdom' };
      const key = st.tech === 'solar' ? (st.conv === 'pos' ? 'solarRatePos' : 'solarRate') : (st.conv === 'pos' ? 'windRatePos' : 'windRate');
      const yrs = [...new Set(Object.values(D.cc).flatMap(d => Object.keys(d.years)))].sort();
      const ds4 = Object.keys(CNAME).filter(c => D.cc[c]).map(c => ({ label: CNAME[c], data: yrs.map(y => { const f = D.cc[c].years[y]; return f && f[key] ? pc1(f[key]) : null; }),
        borderColor: CCOL[c], backgroundColor: CCOL[c], borderWidth: c === 'FR' ? 2.8 : 1.5, pointRadius: yrs.map(y => D.cc[c].years[y] && !D.cc[c].years[y].complete ? 2 : 3.5), borderDash: c === 'FR' ? undefined : [], tension: 0, fill: false, spanGaps: true,
        segment: { borderDash: g => D.cc[c].years[yrs[g.p1DataIndex]] && !D.cc[c].years[yrs[g.p1DataIndex]].complete ? [4, 4] : undefined } }));
      const i22 = yrs.indexOf('2022');
      _fuelChart(ids.xcy, { type: 'line', data: { labels: yrs.map(y => D.cc.FR && D.cc.FR.years[y] && !D.cc.FR.years[y].complete ? y + ' YTD' : y), datasets: ds4 }, plugins: i22 >= 0 ? [shadePlugin([i22])] : [],
        options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } },
          scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('capture rate, % of baseload') } }) }, 'ppa-capture-countries-years');
      setT('xcySub', `${st.conv === 'pos' ? 'Hours > 0 €' : 'All hours'} · shaded: 2022 gas crisis · dashed: year to date · coupled markets move together · output from Energy-Charts (ENTSO-E) for every country, so France here differs from the RTE-based rate of the other charts (solar 2025: 58.8 % vs 55.9 %)`);
    }
    // negative-price hours: history (YTD annualised, lighter) and projection with the solar build-out
    if (has('negh')) {
      const NY = []; for (let y = Math.min(...Object.keys(D.negH).map(Number)); y <= endY; y++) NY.push(y);
      const ty = thisYear(), last = Math.max(...Object.keys(D.negH).map(Number).filter(y => y < ty));
      const hist = NY.map(y => D.negH[y] ? Math.round(y < ty ? D.negH[y].h : D.negH[y].ann) : null);
      const proj = NY.map(y => y >= last ? (y === last ? D.negH[y].h : Math.round(o.negHours(y) || 0)) : null);
      const share = NY.map(y => y > last && o.negShare(y) != null ? Math.round(o.negShare(y) * 1000) / 10 : null);
      _fuelChart(ids.negh, { type: 'bar', data: { labels: NY, datasets: [
        { label: 'Hours at or below 0 €/MWh, France', data: hist, backgroundColor: NY.map(y => y >= ty ? 'rgba(237,105,101,.35)' : 'rgba(237,105,101,.8)'), borderRadius: 3, yAxisID: 'y' },
        { type: 'line', label: 'Projection (solar build-out to PPE3)', data: proj, borderColor: '#FFFFFF', borderDash: [5, 4], borderWidth: 2, pointRadius: NY.map(y => tenorSet.has(y) ? 4 : 2), spanGaps: true, fill: false, yAxisID: 'y' },
        { type: 'line', label: tech + ' output at prices ≤ 0 (%)', data: share, borderColor: tc, borderWidth: 1.6, pointRadius: 2, fill: false, yAxisID: 'y1' },
      ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } } },
        scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('hours per year', { beginAtZero: true }), y1: _fuelAxis('% of output', { position: 'right', beginAtZero: true, grid: { display: false } }) } }) }, 'negative-hours-projection');
      setT('neghSub', o.nhReg ? `Hours with a day-ahead price at or below zero; ${ty} annualised from ${D.negH[ty] ? D.negH[ty].d : 0} days (light bar). Projection: +${Math.max(0, o.nhReg.sl).toFixed(0)} h per GW of solar, fitted on ${o.nhFitYears.join(', ')}, solar capacity to the PPE3 targets; line = ${tech.toLowerCase()} output in those hours (${o.useAsset ? 'asset' : 'national'}).` : 'Not enough history');
    }
    // daily profiles
    const profYear = String(Math.max(...o.nat.filter(x => x.complete).map(x => x.year)));
    const prof = D.profile[profYear] && D.profile[profYear][st.tech];
    const hrs = [...Array(24).keys()].map(h => h + 'h');
    const profChart = (cid, grid, unit, file) => {
      const avg = hrs.map((_, h) => { const v = grid.map(r => r[h]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 : null; });
      _fuelChart(cid, { type: 'line', data: { labels: hrs, datasets: grid.map((r, m) => ({ label: MONTHS[m], data: r, borderColor: MCOL[m], borderWidth: 1.2, pointRadius: 0, tension: .35, fill: false }))
        .concat([{ label: 'Annual average', data: avg, borderColor: '#FFFFFF', borderWidth: 2.6, pointRadius: 2.5, tension: .35, fill: false }]) },
        options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis(unit, { beginAtZero: true }) } }) }, file);
    };
    if (prof) { if (has('profNat')) profChart(ids.profNat, prof, 'MW', 'ppa-profile-national'); setT('profNatSub', `Average MW by hour, one line per month · France ${profYear} (RTE)`); }
    // asset profile / monthly / annual
    const A = st.asset && st.asset.slots;
    if (A) {
      if (ids === IDS) ['profAsset', 'annual'].filter(has).forEach(k => { const c = $(ids[k]).closest('.chart-container'); if (c) c.hidden = false; });
      const grid = MONTHS.map(() => new Array(24).fill(0)), cnt = MONTHS.map(() => new Array(24).fill(0)), monthE = new Array(12).fill(0), monthDays = new Array(12).fill(0), yearE = {};
      A.forEach((arr, d) => { const m = +d.slice(5, 7) - 1, y = d.slice(0, 4); monthDays[m]++; let tot = 0;
        for (let q = 0; q < 96; q++) { const e = arr[q] || 0; tot += e; grid[m][Math.floor(q / 4)] += e * 4 / 1000 / 4; } for (let h = 0; h < 24; h++) cnt[m][h]++; monthE[m] += tot; yearE[y] = (yearE[y] || 0) + tot; });
      const g2 = grid.map((r, m) => r.map((v, h) => cnt[m][h] ? Math.round(v / cnt[m][h] * 100) / 100 : null));
      if (has('profAsset')) profChart(ids.profAsset, g2, 'MW', 'ppa-profile-asset'); setT('profAssetSub', `Same view for ${st.assetName}, all years of the curve`);
      const yrsN = Object.keys(yearE).length || 1, natMW = prof ? prof.map(r => Math.round(r.reduce((a, b) => a + (b || 0), 0) / 24)) : [];
      if (has('monthly')) _fuelChart(ids.monthly, { type: 'bar', data: { labels: MONTHS, datasets: [
        { label: st.assetName + ' (GWh per month, average year)', data: monthE.map((v, m) => monthDays[m] ? Math.round(v / 1e6 * (30.4 / (monthDays[m] / yrsN)) / yrsN * 100) / 100 : null), backgroundColor: tc, borderRadius: 3, yAxisID: 'y' },
        { type: 'line', label: 'National average MW', data: natMW, borderColor: '#FFFFFF', borderDash: [5, 4], borderWidth: 1.6, pointRadius: 3, yAxisID: 'y1' },
      ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('GWh / month', { beginAtZero: true }), y1: _fuelAxis('MW national', { position: 'right', beginAtZero: true, grid: { display: false } }) } }) }, 'ppa-monthly-production');
      const ys = Object.keys(yearE).sort();
      if (has('annual')) _fuelChart(ids.annual, { type: 'bar', data: { labels: ys, datasets: [{ label: st.assetName + ' (GWh per year)', data: ys.map(y => Math.round(yearE[y] / 1e6 * 100) / 100), backgroundColor: tc, borderRadius: 3 }] },
        options: _fuelOpts({ plugins: { legend: { display: false } }, scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('GWh', { beginAtZero: true }) } }) }, 'ppa-annual-production');
    } else {
      ['profAsset', 'annual'].filter(has).forEach(k => noDataMsg(ids[k], 'Load an asset production curve above', 'Same view for the asset'));
      if (ids === IDS) ['profAsset', 'annual'].filter(has).forEach(k => { const c = $(ids[k]).closest('.chart-container'); if (c) c.hidden = true; });
      const natMW = prof ? prof.map(r => Math.round(r.reduce((a, b) => a + (b || 0), 0) / 24)) : [];
      if (has('monthly')) _fuelChart(ids.monthly, { type: 'line', data: { labels: MONTHS, datasets: [{ label: 'National average MW', data: natMW, borderColor: '#FFFFFF', borderDash: [5, 4], borderWidth: 1.6, pointRadius: 3 }] },
        options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('MW national', { beginAtZero: true }) } }) }, 'ppa-monthly-production');
    }
    // rolling capture
    const R = rolling(st), step = 3, idx = R.days.map((_, i) => i).filter(i => i % step === 0 || i === R.days.length - 1);
    const L = idx.map(i => R.days[i]);
    // the calendar-year value as a flat step over its year, so every hover reads the year it falls in; vertical lines on
    // 1 January (on a short window, on the first of each month), never on random days
    const fr = !window.PKI18n || PKI18n.lang !== 'en', TT = (f, e) => fr ? f : e;
    const calY = L.map(d => { const y = +d.slice(0, 4); return natM.has(y) && natM.get(y).cpPct != null ? pc1(natM.get(y).cpPct) : null; });
    const MSH = fr ? ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const xCal = Object.assign(_fuelXAxis(), { ticks: Object.assign(_fuelXAxis().ticks, { autoSkip: false, maxTicksLimit: undefined, callback(v, i) {
      const k = typeof v === 'number' ? v : i, d = L[k], p = L[k - 1]; if (!d || !p) return null;
      const span = ((this.max ?? L.length - 1) - (this.min ?? 0)) * step;
      if (span > 540) return d.slice(0, 4) !== p.slice(0, 4) ? d.slice(0, 4) : null;   // one line per calendar year
      const every = span > 200 ? 3 : 1;   // one line per quarter, or per month on a short window
      return d.slice(5, 7) !== p.slice(5, 7) && (+d.slice(5, 7) - 1) % every === 0 ? MSH[+d.slice(5, 7) - 1] + ' ' + d.slice(2, 4) : null; } }) });
    if (has('rollPct')) _fuelChart(ids.rollPct, { type: 'line', data: { labels: L, datasets: [
      { label: TT('30 jours', '30 days'), data: idx.map(i => R.w30[i] && pc1(R.w30[i].pct)), borderColor: 'rgba(127,200,248,.55)', borderDash: [2, 2], borderWidth: 1, pointRadius: 0, fill: false },
      { label: TT('90 jours', '90 days'), data: idx.map(i => R.w90[i] && pc1(R.w90[i].pct)), borderColor: '#7FC8F8', borderDash: [6, 3], borderWidth: 1.4, pointRadius: 0, fill: false },
      { label: TT('365 jours', '365 days'), data: idx.map(i => R.w365[i] && pc1(R.w365[i].pct)), borderColor: tc, borderWidth: 2.4, pointRadius: 0, fill: false },
      { label: TT('Année civile', 'Calendar year'), data: calY, stepped: 'before', borderColor: '#E04FBF', borderDash: [8, 4], borderWidth: 2.6, pointRadius: 0, fill: false,
        segment: { borderColor: c => L[c.p0DataIndex].slice(0, 4) !== L[c.p1DataIndex].slice(0, 4) ? 'transparent' : undefined } },   // no riser between two years
    ] }, options: _fuelOpts({ scales: { x: xCal, y: _fuelAxis(TT('taux de capture, % du baseload', 'capture rate, % of baseload')) } }) }, 'ppa-rolling-capture-rate');
    if (has('rollEur')) _fuelChart(ids.rollEur, { type: 'line', data: { labels: L, datasets: [
      { label: 'Baseload, 365 days', data: idx.map(i => R.w365[i] && R.w365[i].base != null ? Math.round(R.w365[i].base * 10) / 10 : null), borderColor: '#B8C9D9', borderWidth: 1.8, pointRadius: 0, fill: false },
      { label: tech + ' captured price, 365 days', data: idx.map(i => R.w365[i] && R.w365[i].cp != null ? Math.round(R.w365[i].cp * 10) / 10 : null), borderColor: tc, borderWidth: 2.4, pointRadius: 0, fill: { target: 0, above: 'rgba(20,211,169,.12)', below: 'rgba(237,105,101,.18)' } },
      { label: tech + ' captured price, 90 days', data: idx.map(i => R.w90[i] && R.w90[i].cp != null ? Math.round(R.w90[i].cp * 10) / 10 : null), borderColor: tc, borderDash: [4, 3], borderWidth: 1, pointRadius: 0, fill: false },
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') } }) }, 'ppa-rolling-captured-price');
    const last = R.w365[R.w365.length - 1], l90 = R.w90[R.w90.length - 1], l30 = R.w30[R.w30.length - 1];
    setT('rollSub', `Latest: 30 days ${pc1(l30 && l30.pct)}% · 90 days ${pc1(l90 && l90.pct)}% · 365 days ${pc1(last && last.pct)}% (${R.days[R.days.length - 1]}) · 100% = no cannibalisation`);
  }

  function renderMC(o) {
    if (!$('pp-mc') || !o.mc) return;
    const mc = o.mc, A = o.mcAt, k = v => (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-GB'), build = S.method !== 'pct';
    $('pp-mc').innerHTML = `<b>What the Monte Carlo decides.</b> The capture value (step 3) is what the production is worth if forwards, volumes and cannibalisation turn out as projected. They will not:
      ${mc.N.toLocaleString('en-GB')} trajectories draw the forward path to delivery (${(o.sigF * 100).toFixed(0)} %/√yr), the yearly production (± ${(o.sigV * 100).toFixed(1)} %) and a drift of the shape discount away from its projection (${(o.sig0 * 100).toFixed(1)} pts/√yr, correlation ${o.rho.toFixed(2)} with production).
      ${mc.hedged ? 'The expected volume is sold forward at the Cal prices, so the price level is hedged and what is left is volume and shape risk.' : 'The forward price is left open: the price level risk is carried in full.'}
      Each trajectory gives what one MWh of the contract really earned; ${build ? `the PPA price is set so that only <b>${o.alpha} %</b> of trajectories lose money: that is the risk premium of <b>${f2(o.premium)} €/MWh</b> (step 4)${o.premSrc ? `. Taken one at a time, cannibalisation drift alone would cost ${f2(o.premSrc.shape)} €, production ${f2(o.premSrc.volume)} € and the price level ${f2(o.premSrc.price)} €; together they partly offset` : ''}.` : `with the Past-discount method the price is fixed first, and the simulation measures its risk: <b>${(A.prob * 100).toFixed(1)} %</b> chance of loss.`}`;
    // 1 · a few futures drawn one by one: a bad (P5 of U), a middle (P50) and a good one (P95), over 12 others
    const L0 = o.tenor.map(String), Y = o.years;
    const order = Array.from(mc.U, (u, i) => [u, i]).sort((a, b) => a[0] - b[0]);
    const pick = q => order[Math.min(mc.N - 1, Math.floor(q * (mc.N - 1)))][1];
    const hi3 = [[pick(0.05), 'Bad future', '#ED6965'], [pick(0.5), 'Middle future', '#FFFFFF'], [pick(0.95), 'Good future', '#14D3A9']];
    const bg = Array.from({ length: 12 }, (_, k) => Math.floor((k + 0.5) * mc.N / 12));
    const series = (get, central, unit, file, cid) => _fuelChart(cid, { type: 'line', data: { labels: L0, datasets: [
      ...bg.map(i => ({ label: '_f' + i, data: Y.map((r, t) => +get(t, i, r).toFixed(1)), borderColor: 'rgba(184,201,217,.22)', borderWidth: 1, pointRadius: 0, fill: false })),
      { label: 'Central case', data: Y.map(central), borderColor: '#B8C9D9', borderDash: [5, 4], borderWidth: 1.6, pointRadius: 0, fill: false },
      ...hi3.map(([i, lbl, col]) => ({ label: `${lbl} · ${f2(mc.U[i])} €/MWh`, data: Y.map((r, t) => +get(t, i, r).toFixed(1)), borderColor: col, borderWidth: 2.2, pointRadius: 3, backgroundColor: col, fill: false })),
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !/^_/.test(it.text) } }, pkHoverReadout: false }, scales: { x: _fuelXAxis(), y: _fuelAxis(unit) } }) }, file);
    series((t, i) => mc.spM[t][i], r => r.fwd, '€/MWh', 'ppa-mc-spot-paths', 'pp-mc-d1');
    series((t, i) => mc.sdM[t][i] * 100, r => +(r.fsd * 100).toFixed(1), '% of baseload', 'ppa-mc-discount-paths', 'pp-mc-d2');
    series((t, i, r) => mc.prod[t][i] / r.ev * 100, () => 100, '% of expected', 'ppa-mc-volume-paths', 'pp-mc-d3');
    const [bi] = hi3[0], [mi] = hi3[1];
    $('pp-mc-draws-note').innerHTML = `Each future draws, year after year, a spot price around the forward, a production around the expected one and a shape discount drifting away from its projection. It then counts what one MWh of the contract earned, hedge included: the value per MWh. In the bad future, the spot of ${Y[Y.length - 1].y} is ${f2(mc.spM[Y.length - 1][bi])} €/MWh and the discount ${pc(mc.sdM[Y.length - 1][bi])}, so one MWh earned <b>${f2(mc.U[bi])} €</b>; in the middle one <b>${f2(mc.U[mi])} €</b>. The PPA price is then set so that only ${o.alpha} % of the 10,000 futures earn less than what is paid.`;
    // 2a · the premium, source by source
    if (o.premSrc) {
      const src = [['Cannibalisation drift', o.premSrc.shape, '#FBBF24'], ['Production', o.premSrc.volume, '#7FC8F8'], ['Price level' + (mc.hedged ? ' (hedged)' : ''), o.premSrc.price, '#A87DC4'], ['All together', o.premium, '#ED6965']];
      _fuelChart('pp-mc-src', { type: 'bar', data: { labels: src.map(x => x[0]), datasets: [{ label: '€/MWh', data: src.map(x => +x[1].toFixed(2)), backgroundColor: src.map(x => x[2]), borderRadius: 3 }] },
        options: _fuelOpts({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: _fuelAxis('risk premium, €/MWh', { beginAtZero: true }), y: Object.assign(_fuelXAxis(), { grid: { display: false } }) } }) }, 'ppa-risk-premium-sources');
    }
    // 2b · price → chance of loss and expected P&L
    const vAvg = mean(Y.map(r => r.ev)), base = o.imb - o.goP, ps = [];
    for (let p = Math.floor(o.fair - 25); p <= Math.ceil(Math.max(o.fair + 5, o.ppaPct + 3)); p += 0.5) ps.push(p);
    const lossAt = p => { const c = p + base; let lo = 0, hi = mc.N; while (lo < hi) { const m = (lo + hi) >> 1; if (mc.Us[m] < c) lo = m + 1; else hi = m; } return lo / mc.N; };
    const mark = (val, col, txt, pos) => ({ type: 'line', xMin: val, xMax: val, borderColor: col, borderWidth: 1.6, borderDash: [5, 4], label: { display: true, content: txt, position: pos, backgroundColor: 'rgba(15,20,25,.85)', color: col, font: { size: 10 } } });
    _fuelChart('pp-mc-curve', { type: 'line', data: { datasets: [
      { label: 'Chance of loss (%)', data: ps.map(p => ({ x: p, y: +(lossAt(p) * 100).toFixed(1) })), borderColor: '#ED6965', borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
      { label: 'Expected P&L (k€ per year)', data: ps.map(p => ({ x: p, y: Math.round(vAvg * (mc.mean - base - p) / 1000) })), borderColor: '#14D3A9', borderWidth: 2, pointRadius: 0, yAxisID: 'y1' },
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } }, pkHoverReadout: false,
      annotation: { annotations: { ppa: mark(o.ppa, '#FBBF24', 'PPA ' + f2(o.ppa), 'start'), dash: mark(o.ppaPct, '#B8C9D9', 'Past discount ' + f2(o.ppaPct), 'end') } } },
      scales: { x: Object.assign(_fuelAxis('PPA price offered, €/MWh'), { type: 'linear' }), y: _fuelAxis('chance of loss, %', { min: 0, max: 100 }), y1: _fuelAxis('k€ per year', { position: 'right', grid: { display: false } }) } }) }, 'ppa-price-risk-curve');
    $('pp-mc-kpis').innerHTML = [
      _fuelKpi('P50 total P&L', k(A.pc[50]), 'k€', `${o.tenor.length} years at ${f2(o.ppa)} €/MWh`, A.pc[50] >= 0 ? 'up' : 'down'),
      _fuelKpi('P10 / P90', k(A.pc[10]) + ' / ' + k(A.pc[90]), 'k€', 'downside / upside'),
      _fuelKpi('Chance of loss', (A.prob * 100).toFixed(1), '%', 'total P&L below zero, margin included', A.prob > 0.5 ? 'down' : A.prob < 0.2 ? 'up' : ''),
      _fuelKpi('Expected shortfall', k(A.es), 'k€', 'average of the worst 10 %', 'down'),
      _fuelKpi('Value per MWh', f2(mc.mean), '€/MWh', `average · P${o.alpha} ${f2(o.qU)} · capture value ${f2(o.fair)}`),
    ].join('');
    // distribution of the value per MWh, with the price lines
    const lo = mc.Us[Math.floor(mc.N * 0.005)], hi = mc.Us[Math.floor(mc.N * 0.995)], nb = 44, w = (hi - lo) / nb || 1, hU = new Array(nb).fill(0);
    mc.Us.forEach(v => { const b = Math.floor((v - lo) / w); if (b >= 0 && b < nb) hU[b]++; });
    const midsU = hU.map((_, b) => lo + (b + 0.5) * w), cut = o.ppa + o.imb - o.goP;
    const vline = (val, color, text, pos) => ({ type: 'line', xMin: (val - lo) / w - 0.5, xMax: (val - lo) / w - 0.5, borderColor: color, borderWidth: 2, borderDash: [5, 4], label: { display: true, content: text, position: pos || 'start', backgroundColor: 'rgba(15,20,25,.85)', color, font: { size: 10 } } });
    _fuelChart('pp-mc-u', { type: 'bar', data: { labels: midsU.map(v => v.toFixed(1)), datasets: [
      { label: 'Trajectories', data: hU.map(v => +(v / mc.N * 100).toFixed(2)), backgroundColor: midsU.map(v => v < cut ? 'rgba(237,105,101,.75)' : 'rgba(20,211,169,.7)'), borderWidth: 0, barPercentage: 1, categoryPercentage: 1 },
    ] }, options: _fuelOpts({ plugins: { legend: { display: false }, annotation: { annotations: { cv: vline(o.fair, '#B8C9D9', 'capture value ' + f2(o.fair)), pp: vline(cut, '#FBBF24', 'PPA price + costs ' + f2(cut), 'end') } } },
      scales: { x: Object.assign(_fuelXAxis(), { title: { display: true, text: '€/MWh earned by the contract (hedge included) · red = below the PPA price + costs', color: C_TX3, font: { size: 10 } } }), y: _fuelAxis('% of trajectories', { beginAtZero: true }) } }) }, 'ppa-montecarlo-value');
    // fan chart, annual P&L
    const L = o.tenor.map(String), B = A.bands, r0 = v => Math.round(v);
    _fuelChart('pp-mc-fan', { type: 'line', data: { labels: L, datasets: [
      { label: '_p5', data: B[5].map(r0), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'P5–P95', data: B[95].map(r0), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(127,200,248,.12)', fill: '-1' },
      { label: '_p10', data: B[10].map(r0), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'P10–P90', data: B[90].map(r0), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(127,200,248,.20)', fill: '-1' },
      { label: '_p25', data: B[25].map(r0), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'P25–P75', data: B[75].map(r0), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(127,200,248,.32)', fill: '-1' },
      { label: 'P50', data: B[50].map(r0), borderColor: '#FFFFFF', borderWidth: 2.4, pointRadius: 3, fill: false },
      { label: 'Break-even', data: L.map(() => 0), borderColor: 'rgba(237,105,101,.8)', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0, fill: false },
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10, filter: it => !/^_/.test(it.text) } } },
      scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('k€ per year') } }) }, 'ppa-montecarlo-fan');
    // histogram of the total P&L
    const lo2 = A.cum[Math.floor(mc.N * 0.005)], hi2 = A.cum[Math.floor(mc.N * 0.995)], w2 = (hi2 - lo2) / nb || 1, hist = new Array(nb).fill(0);
    A.cum.forEach(v => { const b = Math.floor((v - lo2) / w2); if (b >= 0 && b < nb) hist[b]++; });
    const mids = hist.map((_, b) => lo2 + (b + 0.5) * w2);
    _fuelChart('pp-mc-hist', { type: 'bar', data: { labels: mids.map(v => Math.round(v).toLocaleString('en-GB')), datasets: [
      { label: 'Trajectories', data: hist.map(v => +(v / mc.N * 100).toFixed(2)), backgroundColor: mids.map(v => v < 0 ? 'rgba(237,105,101,.75)' : 'rgba(20,211,169,.7)'), borderWidth: 0, barPercentage: 1, categoryPercentage: 1 },
    ] }, options: _fuelOpts({ plugins: { legend: { display: false } }, scales: { x: Object.assign(_fuelXAxis(), { title: { display: true, text: 'total P&L over the tenor, k€', color: C_TX3, font: { size: 10 } } }), y: _fuelAxis('% of trajectories', { beginAtZero: true }) } }) }, 'ppa-montecarlo-distribution');
    const f1 = v => (v * 100).toFixed(1) + ' %';
    $('pp-mc-table').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Year</th><th>Shape disc. projected</th><th>P50</th><th>P90 (worst)</th><th>Capture P50</th><th>P&L P10</th><th>P&L P50</th><th>P&L P90</th></tr></thead><tbody>` +
      A.years.map(r => `<tr><td style="text-align:left">${r.y}</td><td>${f1(r.sdTrend)}</td><td>${f1(r.sd50)}</td><td>${f1(r.sd90)}</td><td>${r.cp50.toFixed(2)}</td><td class="${r.p10 >= 0 ? 'pp-pos' : 'pp-neg'}">${k(r.p10)}</td><td class="${r.p50 >= 0 ? 'pp-pos' : 'pp-neg'}"><b>${k(r.p50)}</b></td><td class="${r.p90 >= 0 ? 'pp-pos' : 'pp-neg'}">${k(r.p90)}</td></tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">k€ per year at the PPA price, ${mc.hedged ? 'hedge included' : 'no hedge'}. Seed fixed: the same inputs always give the same results.</div>`;
  }

  // ── Monte Carlo on simulated weather: what the simulation draws and gives ──
  function renderWx(o) {
    const el = $('pp-wx'); if (!el) return;
    const w = o.m4;
    if (!w) { el.innerHTML = '<b>How this method works.</b> Thousands of possible years are simulated: the weather, then the national solar and wind production on the capacity projected for each delivery year, then the hourly prices that this production causes. Open this tab to run it (a few seconds).'; return; }
    el.innerHTML = `<b>How this method works.</b> ${w.N} years are simulated for each delivery year. Each day draws sun and wind from what that month has really seen (with the persistence of real weather, so calm or sunny spells last), puts it on the capacity installed that year (${f0(w.capS[0])} GW of solar and ${f0(w.capW[0])} GW of wind in ${o.tenor[0]}), and takes consumption and nuclear from a recent real day. The price of each hour follows from what is left to produce once solar, wind and nuclear are counted (the net residual load): the lower it is, the lower the price, as measured on ${w.recent.join(' and ')}. Each simulated year then averages exactly its Cal. ${w.sigModel ? `On top of the weather, each simulated delivery carries a model-risk deviation of ± ${(w.sigModel * 100).toFixed(1)} capture-rate points, the size of this method’s errors in the historical replay (Compare tab): weather alone gives a band far too narrow. ` : ''}<b>Correlated</b> uses the prices of the same simulated year, <b>decorrelated</b> the prices of another one: the gap is the cannibalisation.${biasLine(o, 'weather')}`;
    const L = w.years.map(r => String(r.y));
    _fuelChart('pp-wx-rates', { type: 'bar', data: { labels: L, datasets: [
      { label: 'P10–P90 of the simulated years', data: w.years.map(r => [+(r.p10 * 100).toFixed(1), +(r.p90 * 100).toFixed(1)]), backgroundColor: 'rgba(127,200,248,.35)', borderColor: '#7FC8F8', borderWidth: 1, barPercentage: 0.4, grouped: false },
      { type: 'line', label: 'Correlated (average)', data: w.years.map(r => +(r.rate * 100).toFixed(1)), borderColor: '#FFFFFF', backgroundColor: '#FFFFFF', pointRadius: 5, showLine: false },
      { type: 'line', label: 'Decorrelated (average)', data: w.years.map(r => +(r.rateD * 100).toFixed(1)), borderColor: '#B8C9D9', backgroundColor: '#B8C9D9', pointStyle: 'rect', pointRadius: 5, showLine: false },
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } }, pkHoverReadout: false }, scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('capture rate, % of the Cal') } }) }, 'ppa-wx-capture-rates');
    if (w.week) { const mx = Math.max(...w.week.map(p => p.v)) || 1;
      _fuelChart('pp-wx-week', { type: 'line', data: { labels: w.week.map((p, k) => k % 24 === 0 ? 'day ' + (k / 24 + 1) : ''), datasets: [
        { label: 'Simulated price, €/MWh', data: w.week.map(p => +p.p.toFixed(1)), borderColor: '#FFFFFF', borderWidth: 1.4, pointRadius: 0, yAxisID: 'y' },
        { label: (S.tech === 'solar' ? 'Solar' : 'Wind') + ' production (relative)', data: w.week.map(p => +(p.v / mx * 100).toFixed(1)), borderColor: S.tech === 'solar' ? '#FBBF24' : '#14D3A9', backgroundColor: S.tech === 'solar' ? 'rgba(251,191,36,.18)' : 'rgba(20,211,169,.18)', borderWidth: 1, pointRadius: 0, fill: 'origin', yAxisID: 'y1' },
      ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } }, scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, autoSkip: false, maxRotation: 0, font: { size: 10 } } }), y: _fuelAxis('€/MWh'), y1: _fuelAxis('% of peak', { position: 'right', beginAtZero: true, max: 100, grid: { display: false } }) } }) }, 'ppa-wx-week'); }
    const U = w.U, lo = U[0], hi = U[U.length - 1], nb = 24, bw = (hi - lo) / nb || 1, h = new Array(nb).fill(0);
    U.forEach(v => { const k = Math.min(nb - 1, Math.floor((v - lo) / bw)); h[k]++; });
    const mids = h.map((_, k) => lo + (k + 0.5) * bw);
    _fuelChart('pp-wx-u', { type: 'bar', data: { labels: mids.map(v => v.toFixed(1)), datasets: [{ label: '% of simulated deliveries', data: h.map(v => +(v / U.length * 100).toFixed(1)), backgroundColor: mids.map(v => v < w.qU ? 'rgba(237,105,101,.75)' : 'rgba(20,211,169,.7)'), barPercentage: 1, categoryPercentage: 1 }] },
      options: _fuelOpts({ plugins: { legend: { display: false } }, scales: { x: Object.assign(_fuelXAxis(), { title: { display: true, text: '€ earned per MWh, before costs · red = below the price kept (' + f2(w.qU) + ')', color: C_TX3, font: { size: 10 } } }), y: _fuelAxis('% of deliveries', { beginAtZero: true }) } }) }, 'ppa-wx-value');
    $('pp-wx-table').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Delivery</th><th>Cal</th><th>Capture rate</th><th>P10 – P90</th><th>Decorrelated</th><th>Cannibalisation</th><th>Capture €/MWh</th></tr></thead><tbody>` +
      w.years.map(r => `<tr><td style="text-align:left">${r.y}</td><td>${f2(r.cal)}</td><td>${pc(r.rate)}</td><td>${pc(r.p10)} – ${pc(r.p90)}</td><td>${pc(r.rateD)}</td><td>${pc(r.cannib)}</td><td>${f2(r.capture)}</td></tr>`).join('') + '</tbody></table></div>' +
      `<div class="fuel-note">${w.asset ? `Your asset follows the national ${S.tech} production day to day with a factor β = ${w.asset.beta.toFixed(2)} (R² ${w.asset.r2.toFixed(2)}, ${w.asset.n} days); its own deviations (± ${(w.asset.sd * 100).toFixed(0)} %, persistence ${w.asset.phi.toFixed(2)}) do not move prices, so they are not cannibalised.` : o.useAsset ? 'The asset curve has too few days in common with the national data: national profile used.' : 'National ' + S.tech + ' profile: load a curve to price your asset as national + local deviation.'} Price effect measured on ${w.recent.join(' and ')} only: older years describe a market without today’s solar fleet.</div>`;
  }

  // ── Historical replay of the four methods (scripts/ppa_backtest.py → ppa_backtest.json) ──
  let BT = null;
  async function renderBacktest() {
    if (!$('pp-bt-chart')) return;
    if (!BT) BT = await get('history/ppa_backtest.json');
    if (!BT) { $('pp-bt-table').innerHTML = '<div class="fuel-note">Replay not available.</div>'; return; }
    const tech = S.tech, rs = BT.rows.filter(r => r.tech === tech), M = [['dashboard', 'Past discount', '#B8C9D9'], ['step', 'Capacity trend', '#14D3A9'], ['fpc', 'Forward shape', '#FBBF24'], ['weather', 'Weather simulation', '#A87DC4']];
    const L = rs.map(r => String(r.year)), p1 = v => +(v * 100).toFixed(1);
    _fuelChart('pp-bt-chart', { type: 'line', data: { labels: L, datasets: [
      { label: 'Actual', data: rs.map(r => p1(r.actual)), borderColor: '#FFFFFF', backgroundColor: '#FFFFFF', borderWidth: 2.6, pointRadius: 4, fill: false },
      ...M.map(([k, l, c]) => ({ label: l, data: rs.map(r => p1(r[k])), borderColor: c, backgroundColor: c, borderWidth: 1.4, borderDash: [5, 3], pointRadius: 3, fill: false })),
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } }, scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('capture rate, % of baseload') } }) }, 'ppa-backtest');
    const err = (k, f) => { const x = rs.filter(f); return x.length ? mean(x.map(r => Math.abs(r[k] - r.actual))) : null; };
    const bias = k => { const x = rs.filter(r => r.year !== 2022); return mean(x.map(r => r[k] - r.actual)); };
    const rows = M.map(([k, l]) => ({ k, l, all: err(k, r => r.year !== 2022), rec: err(k, r => r.year >= 2023), b: bias(k) }));
    const best = Math.min(...rows.map(r => r.all)), bestR = Math.min(...rows.map(r => r.rec));
    $('pp-bt-table').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Method</th><th>All years*</th><th>2023–${BT.targets[BT.targets.length - 1]}</th><th>Bias</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td style="text-align:left">${r.l}</td><td class="${r.all === best ? 'pp-pos' : ''}">${(r.all * 100).toFixed(1)} pts</td><td class="${r.rec === bestR ? 'pp-pos' : ''}">${(r.rec * 100).toFixed(1)} pts</td><td>${r.b > 0 ? '+' : ''}${(r.b * 100).toFixed(1)}</td></tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">` + ((!window.PKI18n || PKI18n.lang !== 'en')
        ? `* ${BT.targets[0]}–${BT.targets[BT.targets.length - 1]} sans 2022, une année de crise qu’aucune méthode ne pouvait prévoir. En vert : la plus petite erreur. Chaque année est pricée comme à son début : l’historique d’avant, la capacité extrapolée des deux années précédentes ; toutes les heures comptent. Biais (pts) : positif = la méthode attendait plus que ce que l’actif a vraiment touché (trop optimiste).${rows.every(r => r.b > 0.02) ? ' <b>Toutes les méthodes étaient trop optimistes :</b> aucune n’a vu la vitesse de la cannibalisation en 2024.' : ''} Rejeu du ${BT.updated}.`
        : `* ${BT.targets[0]}–${BT.targets[BT.targets.length - 1]} without 2022, a crisis year no method could foresee. Green: the smallest error. Each year is priced as at its start: the history before it, the capacity extrapolated from the two previous years; all hours count. Bias (pts): positive = the method expected more than the asset really earned (too optimistic).${rows.every(r => r.b > 0.02) ? ' <b>All methods were too optimistic:</b> none saw how fast cannibalisation grew in 2024.' : ''} Replay of ${BT.updated}.`) + `</div>`;
  }

  // ── Three methods side by side ──
  // Projection with P10–P90 by delivery year, method by method (or their average), computed live by the pricer:
  // capture = value of one MWh ÷ the Cal of the year (forward month by month and the months delivered included).
  //   capacity trend   P50 = its projected capture; P10/P90 = ± 1.2816 × its uncertainty on the shape discount (σ × √years)
  //   forward shape    P50 = its capture; P10/P90 = ± 1.2816 × the spread of its yearly cannibalisation
  //   weather          P10 / P50 / P90 of its simulated years
  //   European model   its capture, P10 / P90 from its simulated weather (monthly, data/history/ppa_forecast.json)
  //   average of 4     the average of the four P50s and of their P10s and P90s; the range of the four P50s around it
  let FANM = 'avg';
  function fanMethods(o) {
    const Y = o.years, z = 1.2816, out = {};
    out.build = Y.map(r => { const k = (r.kq || 1) * (r.g || 1), c = (1 - r.fsd) * k, s = r.sig * k; return { y: r.y, p50: c, lo: c - z * s, hi: c + z * s }; });
    if (o.m3) out.fpc = o.m3.fwd.map((r, i) => { const c = r.capture / Y[i].fwd, s = o.m3.sigC * r.cal / Y[i].fwd; return { y: r.y, p50: c, lo: c - z * s, hi: c + z * s }; });
    if (o.m4) out.wx = o.m4.years.map((r, i) => { const f = r.cal / Y[i].fwd; return { y: r.y, p50: r.rate * f, lo: r.p10 * f, hi: r.p90 * f }; });
    if (o.eu) { const lo = euYears(o, o.st, 'p10'), hi = euYears(o, o.st, 'p90');
      out.eu = o.eu.map((e, i) => ({ y: Y[i].y, p50: e.capture, lo: lo ? lo[i].capture : e.capture, hi: hi ? hi[i].capture : e.capture })); }
    const ks = ['build', 'fpc', 'wx', 'eu'].filter(k => out[k]);
    if (ks.length > 1) out.avg = Y.map((r, i) => { const v = f => wmean(ks.map(k => ({ k, x: out[k][i][f] })), 'x'), p = ks.map(k => out[k][i].p50);
      return { y: r.y, p50: v('p50'), lo: v('lo'), hi: v('hi'), min: Math.min(...p), max: Math.max(...p) }; });
    return out;
  }
  function renderFanM(o) {
    const cv = $('pp-fanm'); if (!cv || !o || !o.years) return;
    const fr = FRDOC(), M = fanMethods(o), keys = ['avg', 'build', 'fpc', 'wx', 'eu'].filter(k => M[k]);
    if (!M[FANM]) FANM = keys[0];
    const NAMES = { avg: fr ? 'Moyenne des 4' : 'Average of 4', build: fr ? 'Tendance de capacité' : 'Capacity trend', fpc: fr ? 'Forme forward' : 'Forward shape', wx: fr ? 'Simulation météo' : 'Weather simulation', eu: fr ? 'Modèle européen' : 'European price model' };
    const COL = { avg: '#E6EDF3', build: '#14D3A9', fpc: '#FBBF24', wx: '#A87DC4', eu: '#5B9BD5' };
    const bar = $('pp-fanm-pick');
    if (bar) { bar.innerHTML = keys.map(k => `<button type="button" class="pp-chip${k === FANM ? ' on' : ''}" data-fm="${k}">${NAMES[k]}</button>`).join('');
      bar.querySelectorAll('[data-fm]').forEach(b => b.addEventListener('click', () => { FANM = b.dataset.fm; renderFanM(S.last); })); }
    const unit = ($('pp-fanm-unit') || {}).value === 'value' ? 'value' : 'rate';
    const past = o.hist.filter(x => x.cpPct != null && x.complete), last = past[past.length - 1];
    const yrs = [...new Set([...past.map(x => x.year), ...o.tenor])].sort((a, b) => a - b), iOf = y => o.tenor.indexOf(y);
    const sc = (v, y) => v == null ? null : unit === 'value' ? +(v * (iOf(y) >= 0 ? o.years[iOf(y)].fwd : 0)).toFixed(2) : +(v * 100).toFixed(1);
    const P = M[FANM], c = COL[FANM];
    const ser = f => yrs.map(y => { const i = iOf(y); if (i >= 0) return sc(P[i][f], y); return null; });
    const ds = [
      { label: '_hi', data: ser('hi'), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: c + '30', tension: 0 },
      { label: 'P10–P90', data: ser('lo'), borderWidth: 0, pointRadius: 0, fill: false, backgroundColor: c + '30', tension: 0 },
      { label: 'P50', data: ser('p50'), borderColor: c, backgroundColor: c, borderWidth: 2.6, pointRadius: 3, fill: false, tension: 0 },
    ];
    if (FANM === 'avg') ds.push({ label: fr ? 'Fourchette des méthodes' : 'Range of the methods', data: yrs.map(y => { const i = iOf(y); return i >= 0 ? sc(P[i].max, y) : null; }), borderColor: c + '99', borderDash: [3, 3], borderWidth: 1.2, pointRadius: 0, fill: false, tension: 0 },
      { label: '_min', data: yrs.map(y => { const i = iOf(y); return i >= 0 ? sc(P[i].min, y) : null; }), borderColor: c + '99', borderDash: [3, 3], borderWidth: 1.2, pointRadius: 0, fill: false, tension: 0 });
    if (unit === 'rate') ds.push({ label: fr ? 'Réalisé' : 'Realised', data: yrs.map(y => { const h = past.find(x => x.year === y); return h ? +(h.cpPct * 100).toFixed(1) : null; }), borderColor: C_TX2, backgroundColor: C_TX2, borderWidth: 2, pointRadius: 3, fill: false, tension: 0 });
    _fuelChart('pp-fanm', { type: 'line', data: { labels: yrs.map(String), datasets: ds }, options: _fuelOpts({
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !/^_/.test(it.text) } },
        tooltip: { callbacks: { label: x => /^_/.test(x.dataset.label) || x.raw == null ? null : ` ${x.dataset.label}: ${unit === 'value' ? f2(x.raw) + ' €/MWh' : (fr ? String(x.raw).replace('.', ',') : x.raw) + ' %'}` } } },
      scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis(unit === 'value' ? (fr ? '€ par MWh produit' : '€ per MWh produced') : (fr ? 'capture, % du Cal' : 'capture, % of the Cal')) } }) }, 'ppa-fan-by-method');
    const tb = $('pp-fanm-table');
    if (tb) tb.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">${fr ? 'Année' : 'Year'}</th><th>P10</th><th>P50</th><th>P90</th>${FANM === 'avg' ? `<th>${fr ? 'Méthodes min – max' : 'Methods min – max'}</th>` : ''}</tr></thead><tbody>` +
      P.map((r, i) => { const v = x => unit === 'value' ? f2(x * o.years[i].fwd) + ' €' : (fr ? (x * 100).toFixed(1).replace('.', ',') : (x * 100).toFixed(1)) + ' %';
        return `<tr><td style="text-align:left">${r.y}</td><td>${v(r.lo)}</td><td><b>${v(r.p50)}</b></td><td>${v(r.hi)}</td>${FANM === 'avg' ? `<td>${v(r.min)} – ${v(r.max)}</td>` : ''}</tr>`; }).join('') + '</tbody></table></div>';
    const sub = $('pp-fanm-sub');
    if (sub) sub.textContent = (fr ? `${NAMES[FANM]} · ${S.tech === 'wind' ? 'éolien' : 'solaire'} · P10 et P90 : 1 chance sur 10 d’être en dessous / au-dessus` : `${NAMES[FANM]} · ${S.tech === 'wind' ? 'wind' : 'solar'} · P10 and P90: 1 chance in 10 of being below / above`);
  }
  // Each method against what was realised: every delivery year priced 1, 2 or 3 years ahead with only the years known
  // then (scripts/ppa_horizon_test.py → ppa_vs_actual.py), at the prices that came, so only the capture forecast differs
  let VSA = null, VSH = '1';
  const vsaLoad = () => VSA || (VSA = fetch(DATA_BASE + 'history/ppa_vs_actual.json').then(r => r.ok ? r.json() : null).catch(() => null));
  function renderVsActual() {
    const cv = $('pp-vsa'); if (!cv) return;
    vsaLoad().then(j => {
      const fr = FRDOC(), t = S.tech === 'wind' ? 'wind' : 'solar', c = S.conv === 'all' ? 'all' : 'curt';
      const D = j && j.tech && j.tech[t] && j.tech[t][c] && j.tech[t][c][VSH]; if (!D) return;
      const ys = Object.keys(D).sort(), n2 = v => v == null ? '–' : fr ? f2(v).replace('.', ',') : f2(v);
      const M = [['step', fr ? 'Tendance de capacité' : 'Capacity trend', '#14D3A9'], ['fpc', fr ? 'Forme forward' : 'Forward shape', '#FBBF24'],
        ['weather', fr ? 'Simulation météo' : 'Weather simulation', '#A87DC4'], ['regional', fr ? 'Modèle européen' : 'European price model', '#5B9BD5'], ['avg4', fr ? 'Moyenne des 4' : 'Average of 4', '#8A99A6']];
      const lbl = y => y + (D[y].partial ? (fr ? ' (à date)' : ' (to date)') : '');
      const ds = [{ label: fr ? 'Réalisé' : 'Realised', data: ys.map(y => D[y].actual), borderColor: '#E6EDF3', backgroundColor: '#E6EDF3', borderWidth: 3.2, pointRadius: 4, fill: false, tension: 0 }]
        .concat(M.map(([k, n, col]) => ({ label: n, data: ys.map(y => D[y][k]), borderColor: col, backgroundColor: col, borderWidth: k === 'avg4' ? 2.4 : 1.6, borderDash: k === 'avg4' ? [5, 4] : [], pointRadius: 2.5, fill: false, tension: 0 })));
      _fuelChart('pp-vsa', { type: 'line', data: { labels: ys.map(lbl), datasets: ds }, options: _fuelOpts({
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: x => x.raw == null ? null : ` ${x.dataset.label}: ${n2(x.raw)} €/MWh` } } },
        scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis(fr ? 'valeur d’un MWh produit, €/MWh' : 'value of one MWh produced, €/MWh') } }) }, 'ppa-methods-vs-actual');
      const done = ys.filter(y => +y >= 2024), mae = k => { const e = done.map(y => D[y][k] == null ? null : Math.abs(D[y][k] - D[y].actual)).filter(v => v != null); return e.length ? e.reduce((a, b) => a + b, 0) / e.length : null; };
      const bias = k => { const e = done.map(y => D[y][k] == null ? null : D[y][k] - D[y].actual).filter(v => v != null); return e.length ? e.reduce((a, b) => a + b, 0) / e.length : null; };
      const tb = $('pp-vsa-table');
      if (tb) tb.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">${fr ? 'Méthode' : 'Method'}</th><th>${fr ? 'Erreur moyenne 2024–2026' : 'Mean error 2024–2026'}</th><th>${fr ? 'Biais (+ = trop haut)' : 'Bias (+ = too high)'}</th></tr></thead><tbody>` +
        M.map(([k, n]) => `<tr><td style="text-align:left">${n}</td><td><b>${n2(mae(k))} €</b></td><td>${bias(k) == null ? '–' : (bias(k) >= 0 ? '+' : '−') + n2(Math.abs(bias(k))) + ' €'}</td></tr>`).join('') + '</tbody></table></div>';
      const sub = $('pp-vsa-sub');
      if (sub) sub.textContent = fr ? `${t === 'wind' ? 'Éolien' : 'Solaire'} · chaque année pricée ${VSH} an${VSH === '1' ? '' : 's'} à l’avance avec les seules années connues alors, aux prix réalisés · profil national` : `${t === 'wind' ? 'Wind' : 'Solar'} · each year priced ${VSH} year${VSH === '1' ? '' : 's'} ahead with only the years known then, at the realised prices · national profile`;
    });
  }
  // Price by delivery year and by product quoted on the market (months, quarters, seasons, Cal) inside the tenor.
  // A year: each method's own capture value of that year. A product: its months' values weighted by the output (× paid share):
  //   European model  month by month (its own monthly forecast)
  //   the others      their yearly value spread on the months with the seasonal factor g of a part-year delivery
  //                   (months' forwards × the blend's monthly capture × output), so the year's average stays theirs
  // Each method keeps its risk premium per MWh; imbalance, GO of the year and margin as in its price.
  function renderProducts(o) {
    const host = $('pp-prod'); if (!host || !o || !o.years) return;
    const fr = FRDOC(), Y = o.years, st = o.st;
    const M = [['build', fr ? 'Tendance de capacité' : 'Capacity trend'], ['fpc', fr ? 'Forme forward' : 'Forward shape'], ['wx', fr ? 'Simulation météo' : 'Weather simulation'], ['eu', fr ? 'Modèle européen' : 'European model']];
    const yearVal = { build: Y.map(r => r.cp), fpc: o.m3 ? o.m3.fwd.map(r => r.capture) : null, wx: o.m4 ? o.m4.years.map(r => r.capture) : null, eu: o.eu ? o.eu.map((e, i) => e.capture * Y[i].fwd) : null };
    const prem = { build: o.premium, fpc: o.m3 ? o.m3.premium : null, wx: o.m4 ? o.m4.premium : null, eu: o.premium };
    const price = (k, v, F, go) => v == null || prem[k] == null ? null : v - prem[k] - F * o.add / 100 - o.imb + go - o.margin;
    // month weights and seasonal factors, per delivery year (whole years only)
    const conv = st.conv === 'all' ? 'all' : 'curt', fc = D.fcst && D.fcst.forecast && D.fcst.forecast[st.tech] && D.fcst.forecast[st.tech][conv], nat = D.fcst && D.fcst.share && D.fcst.share[st.tech];
    const mw = (y, m) => { const e = fc && fc[`${y}-${String(m).padStart(2, '0')}`]; return (nat ? nat[m] || 0 : 1 / 12) * (conv === 'curt' && e && e.paid != null ? e.paid : 1); };
    const gm = {}; o.tenor.forEach(y => { gm[y] = {}; for (let m = 1; m <= 12; m++) gm[y][m] = partFactors([y], () => [m], st)[0].g; });
    const euM = (y, m) => { const r = euYears(Object.assign({}, o, { tenor: [y], monthsOf: () => [m] }), st); return r ? r[0].capture * Y[o.tenor.indexOf(y)].fwd : null; };
    const monthVal = (k, y, m) => { const i = o.tenor.indexOf(y); if (i < 0) return null; if (k === 'eu') return euM(y, m); const v = yearVal[k]; return v ? v[i] * gm[y][m] : null; };
    const rowsOf = (label, months, F, isYear, i) => {
      const go = mean(months.map(([y]) => Y[o.tenor.indexOf(y)].go)), W = months.reduce((a, [y, m]) => a + mw(y, m), 0);
      const vals = M.map(([k]) => { if (isYear) return price(k, yearVal[k] ? yearVal[k][i] : null, F, go);
        const ms = months.map(([y, m]) => [mw(y, m), monthVal(k, y, m)]); if (ms.some(([, v]) => v == null)) return null;
        return price(k, ms.reduce((a, [w, v]) => a + w * v, 0) / W, F, go); });
      const ok = vals.filter(v => v != null), avg = ok.length === 4 ? wmean(M.map(([k], j) => ({ k, x: vals[j] })), 'x') : null;
      return { label, F, vals, avg };
    };
    const rows = Y.map((r, i) => rowsOf('Cal ' + r.y, Array.from({ length: 12 }, (_, m) => [r.y, m + 1]), r.fwd, true, i));
    const prods = (D.fwdRows || []).map(q => ({ q, p: window.PKFpc ? PKFpc.periodOf(q.contract) : null })).filter(x => x.p && x.p.kind !== 'year')
      .map(({ q, p }) => { const ms = []; const d = new Date(p.a + 'T00:00:00Z'), e = new Date(p.b + 'T00:00:00Z'); while (d <= e) { ms.push([d.getUTCFullYear(), d.getUTCMonth() + 1]); d.setUTCMonth(d.getUTCMonth() + 1, 1); } return { q, ms }; })
      .filter(x => x.ms.length && x.ms.every(([y]) => o.tenor.includes(y)))
      .map(x => rowsOf(x.q.contract.replace(/^FR\s+/i, '').replace(/\s+base$/i, ''), x.ms, x.q.value, false));
    const n2 = v => v == null ? '–' : fr ? f2(v).replace('.', ',') : f2(v);
    const tr = r => `<tr><td style="text-align:left">${r.label}</td><td>${n2(r.F)}</td>${r.vals.map(v => `<td>${n2(v)}</td>`).join('')}<td><b>${n2(r.avg)}</b></td><td>${r.avg != null && r.F ? (fr ? (r.avg / r.F * 100).toFixed(0) : (r.avg / r.F * 100).toFixed(0)) + ' %' : '–'}</td></tr>`;
    const head = `<tr><th style="text-align:left">${fr ? 'Livraison' : 'Delivery'}</th><th>${fr ? 'Forward coté' : 'Forward quoted'}</th>${M.map(([, n]) => `<th>${n}</th>`).join('')}<th>${fr ? 'Moyenne des 4' : 'Average of 4'}</th><th>${fr ? '% du forward' : '% of forward'}</th></tr>`;
    const sep = t => `<tr><td colspan="8" style="text-align:left;color:var(--text3);font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding-top:10px">${t}</td></tr>`;
    host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead>${head}</thead><tbody>${sep(fr ? 'Par année' : 'By year')}${rows.map(tr).join('')}${prods.length ? sep(fr ? 'Par produit coté' : 'By quoted product') + prods.map(tr).join('') : ''}</tbody></table></div>` +
      (o.m4 ? '' : `<div class="fuel-note">${fr ? 'Simulation météo : ouvrez son onglet ou Comparaison et prix pour la calculer.' : 'Weather simulation: open its tab or Compare & price to compute it.'}</div>`);
  }
  // What the peak / base forwards imply for the capture rate (scripts/build_mkt_implied.py), in observation: not in the
  // average of methods, kept daily to be compared with what is realised as months and quarters deliver
  let MKT = null;
  const mktLoad = () => MKT || (MKT = fetch(DATA_BASE + 'history/mkt_implied.json').then(r => r.ok ? r.json() : null).catch(() => null));
  function renderMkt() {
    const host = $('pp-mkt'); if (!host) return;
    mktLoad().then(j => {
      if (!j || !j.latest) { host.innerHTML = ''; return; }
      const fr = FRDOC(), row = j.days[j.latest], ys = Object.keys(row).sort(), pc = v => v == null ? '–' : (fr ? (v * 100).toFixed(1).replace('.', ',') : (v * 100).toFixed(1)) + ' %';
      const n3 = v => fr ? v.toFixed(2).replace('.', ',') : v.toFixed(2), R = j.realised || {}, dt = new Date(j.latest + 'T12:00:00Z').toLocaleDateString(fr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">${fr ? 'Année' : 'Year'}</th><th>${fr ? 'Peak ÷ base' : 'Peak ÷ base'}</th><th>${fr ? 'Capture solaire implicite' : 'Implied solar capture'}</th><th>${fr ? 'Capture éolienne implicite' : 'Implied wind capture'}</th><th>${fr ? 'Trimestres peak cotés' : 'Peak quarters quoted'}</th></tr></thead><tbody>` +
        (R.year ? `<tr><td style="text-align:left">${R.year} ${fr ? '(réalisé)' : '(realised)'}</td><td>–</td><td>${pc(R.solar)}</td><td>${pc(R.wind)}</td><td>–</td></tr>` : '') +
        ys.map(y => `<tr><td style="text-align:left">${y}</td><td>${n3(row[y].pbRatio)}</td><td><b>${pc(row[y].solar)}</b></td><td><b>${pc(row[y].wind)}</b></td><td>${row[y].quarters} / 4</td></tr>`).join('') + '</tbody></table></div>' +
        `<div class="fuel-note">${fr ? `Forwards France du ${dt}, séparés en heures pleines (lun–ven 8 h–20 h) et creuses, par trimestre quand ils sont cotés ; production nationale ; × la forme des prix à l’intérieur des blocs mesurée en ${j.ratio.year} (la même formule sur les prix réalisés surestimait la capture solaire, d’un rapport passé de 0,90 en 2016 à ${n3(j.ratio.solar)} en ${j.ratio.year}). Capture sur toutes les heures. Repère seulement, hors de la moyenne ; les années sans trimestres peak cotés ignorent la saison et sont moins fiables. Enregistré chaque jour pour être comparé au réalisé.`
          : `France forwards of ${dt}, split into peak (Mon–Fri 8:00–20:00) and off-peak hours, by quarter when quoted; national output; × the shape of prices inside the blocks measured in ${j.ratio.year} (the same formula on realised prices overstated solar capture, by a ratio that went from 0.90 in 2016 to ${n3(j.ratio.solar)} in ${j.ratio.year}). Capture over all hours. A reference only, not in the average; years without peak quarters quoted ignore the season and are less reliable. Kept every day to be compared with what is realised.`}</div>`;
    });
  }
  function renderCompare(o) {
    const host = $('pp-compare'); if (!host) return;
    const m3c = o.m3, mc = o.mc;
    // the step-by-step price for other risk levels: the same 10,000 futures, another percentile
    const atA = a => mc ? qtl(mc.Us, a) - o.refW * o.add / 100 - o.imb + o.goW - o.margin : null;
    const meth = [['Past discount', o.ppaPct, null, null, '#B8C9D9'], ['Capacity trend', o.ppaBuild, atA(0.10), atA(0.50), '#14D3A9'],
      ['Forward shape', o.ppaFpc, m3c ? o.ppaFpc + m3c.premium - m3c.refW * m3c.sigC * 1.2816 : null, m3c ? o.ppaFpc + m3c.premium : null, '#FBBF24'],
      ['Weather simulation', o.ppaWx, o.m4 ? quantFloat(o.m4.U, 0.10) - o.m4.refW * o.add / 100 - o.imb + o.goW - o.margin : null, o.m4 ? quantFloat(o.m4.U, 0.50) - o.m4.refW * o.add / 100 - o.imb + o.goW - o.margin : null, '#A87DC4'],
      // the European model carries the capacity trend's risk: its range is that Monte Carlo's, moved to its own value
      ['European price model', o.ppaEu, o.eu && mc ? atA(0.10) + o.euFair - o.fair : null, o.eu && mc ? atA(0.50) + o.euFair - o.fair : null, '#5B9BD5']].filter(x => x[1] != null);
    $('pp-cmp-kpis').innerHTML = meth.map(([l, v, lo, hi]) => _fuelKpi(l, f2(v), '€/MWh', lo != null ? `${f2(lo)} – ${f2(hi)} at 10–50 % risk` : 'risks entered by hand')).join('') +
      _fuelKpi('Spread', f2(Math.max(...meth.map(x => x[1])) - Math.min(...meth.map(x => x[1]))), '€/MWh', 'highest − lowest method');
    _fuelChart('pp-cmp-price', { type: 'bar', data: { labels: meth.map(x => window.PKI18n ? PKI18n.tr(x[0]) : x[0]), datasets: [
      { label: 'Range', data: meth.map(x => x[2] != null ? [x[2], x[3]] : null), backgroundColor: meth.map(x => x[4] + '33'), borderColor: meth.map(x => x[4]), borderWidth: 1, barPercentage: 0.25, grouped: false },
      { label: 'PPA price', data: meth.map(x => +x[1].toFixed(2)), backgroundColor: meth.map(x => x[4] + 'CC'), borderRadius: 3, barPercentage: 0.6, grouped: false },
    ] }, options: _fuelOpts({ plugins: { legend: { display: false }, tooltip: { enabled: true, callbacks: { label: c => Array.isArray(c.raw) ? ` range ${f2(c.raw[0])} – ${f2(c.raw[1])} €/MWh` : ` ${f2(c.raw)} €/MWh` } }, pkHoverReadout: false },
      scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('€/MWh', { beginAtZero: true }) } }) }, 'ppa-methods-price');
    _fuelChart('pp-cmp-years', { type: 'bar', data: { labels: o.tenor.map(String), datasets: [
      { label: 'Forward (Cal)', type: 'line', data: o.years.map(r => +r.fwd.toFixed(2)), borderColor: '#7FC8F8', borderDash: [5, 4], borderWidth: 1.6, pointRadius: 3, fill: false },
      { label: 'Past discount', data: o.years.map((r, i) => +(r.fwd * (1 - (o.sdPctY ? o.sdPctY[i] : o.sdCh))).toFixed(2)), backgroundColor: '#B8C9D9AA', borderRadius: 3 },
      { label: 'Capacity trend', data: o.years.map(r => +r.cp.toFixed(2)), backgroundColor: '#14D3A9AA', borderRadius: 3 },
      ...(m3c ? [{ label: 'Forward shape', data: m3c.fwd.map(r => +r.capture.toFixed(2)), backgroundColor: '#FBBF24AA', borderRadius: 3 }] : []),
      ...(o.m4 ? [{ label: 'Weather simulation', data: o.m4.years.map(r => +r.capture.toFixed(2)), backgroundColor: '#A87DC4AA', borderRadius: 3 }] : []),
      ...(o.eu ? [{ label: 'European price model', data: o.years.map((r, i) => +(r.fwd * o.eu[i].capture).toFixed(2)), backgroundColor: '#5B9BD5AA', borderRadius: 3 }] : []),
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } }, scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('€/MWh', { beginAtZero: true }) } }) }, 'ppa-methods-years');
    // Cannibalisation by method: the capture rate measured on the past years, then what each method projects for the
    // delivery years (its value of one MWh ÷ the Cal of that year), all starting from the last complete year
    (() => {
      const tr = x => window.PKI18n ? PKI18n.tr(x) : x;
      const past = o.hist.filter(x => x.cpPct != null), last = past.filter(x => x.complete).pop();
      if (!last) return;
      const yrs = [...new Set([...past.map(x => x.year), ...o.tenor])].sort((a, b) => a - b), at = (arr, y) => { const i = o.tenor.indexOf(y); return i < 0 ? null : arr[i]; };
      const r1 = v => v == null ? null : +(v * 100).toFixed(1);
      const line = (label, rates, color, extra) => ({ label: tr(label), data: yrs.map(y => y === last.year ? r1(last.cpPct) : r1(at(rates, y))), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, fill: false, spanGaps: true, tension: 0, ...extra });
      const ds = [
        { label: tr(o.useAsset ? 'Realised (asset)' : 'Realised (national profile)'), data: yrs.map(y => { const h = past.find(x => x.year === y); return h ? r1(h.cpPct) : null; }), borderColor: C_TX2, backgroundColor: C_TX2, borderWidth: 2.4, pointRadius: yrs.map(y => { const h = past.find(x => x.year === y); return h && !h.complete ? 4 : 3; }), pointStyle: yrs.map(y => { const h = past.find(x => x.year === y); return h && !h.complete ? 'rectRot' : 'circle'; }), fill: false, tension: 0 },
        line('Past discount', o.years.map((r, i) => 1 - (o.sdPctY ? o.sdPctY[i] : o.sdCh)), '#B8C9D9', { borderDash: [5, 4], borderWidth: 1.6 }),
        line('Capacity trend', o.years.map(r => r.cp / r.fwd), '#14D3A9', { borderWidth: 3 }),
        ...(m3c ? [line('Forward shape', m3c.fwd.map((r, i) => r.capture / o.years[i].fwd), '#FBBF24')] : []),
        ...(o.m4 ? [line('Weather simulation', o.m4.years.map((r, i) => r.capture / o.years[i].fwd), '#A87DC4')] : []),
        ...(o.eu ? [line('European price model', o.eu.map(e => e.capture), '#5B9BD5')] : []),
      ];
      const sub = $('pp-cmp-cannib-sub');
      if (sub) sub.textContent = tr('Capture rate, % of the Cal · realised, then each method’s projection from') + ' ' + last.year + (past.some(x => !x.complete) ? ' · ' + tr('◆ = year to date') : '');
      _fuelChart('pp-cmp-cannib', { type: 'line', data: { labels: yrs.map(String), datasets: ds }, options: _fuelOpts({
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: c => c.raw == null ? null : ` ${c.dataset.label}: ${FRDOC() ? c.raw.toFixed(1).replace('.', ',') : c.raw.toFixed(1)} %` } } },
        scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis(tr('capture rate, % of the Cal')) } }) }, 'ppa-cannibalisation-by-method');
    })();
    renderProducts(o);
    renderFanM(o);
    renderMkt();
    renderVsActual();
    const m3 = o.m3, m4 = o.m4, Y = o.years, a = Y[0], z = Y[Y.length - 1];
    const col = (lbl, cur) => `<th${cur ? ' class="pp-cur"' : ''}>${lbl}${cur ? ' ✓' : ''}</th>`;
    const W4 = m4 ? m4.years : null;
    const E = o.eu, e0 = E ? E[0].capture : null, e1 = E ? E[E.length - 1].capture : null;
    const rows = [
      ['PPA price, €/MWh', f2(o.ppaPct), f2(o.ppaBuild), m3 ? f2(m3.ppa) : '–', m4 ? f2(m4.ppa) : 'open its tab', E ? f2(o.ppaEu) : 'no forecast past 2030', true],
      ['Forward used', f2(o.ref) + ' (average)', f2(o.refW) + ' (weighted)', m3 ? f2(m3.refW) + ' (FPC, weighted)' : '–', m4 ? f2(m4.refW) + ' (Cal, weighted)' : '–', E ? f2(o.refW) + ' (Cal, weighted)' : '–'],
      ['Shape / profile', o.pdMode === 'past' ? pc(-o.sdCh) + ' (P' + S.pct + ' of history)' : pc(-o.sdPctY[0]) + ' → ' + pc(-o.sdPctY[o.sdPctY.length - 1]) + ' (trend + P' + S.pct + ' offset)', pc(-a.fsd) + ' → ' + pc(-z.fsd) + ' (projected discount)', m3 ? pc(m3.fwd[0].fwdCost) + ' → ' + pc(m3.fwd[m3.fwd.length - 1].fwdCost) + ' (FPC profile cost)' : '–', W4 ? pc(W4[0].rate - 1) + ' → ' + pc(W4[W4.length - 1].rate - 1) + ' (simulated, all effects)' : '–', E ? pc(e0 - 1) + ' → ' + pc(e1 - 1) + ' (hourly price model, all effects)' : '–'],
      ['Cannibalisation', o.pdMode === 'past' ? 'inside the percentile' : 'linear trend of the last years', 'inside the projected discount', m3 ? pc(m3.fwd[0].cannib) + ' → ' + pc(m3.fwd[m3.fwd.length - 1].cannib) + ' ((1) − (3), projected)' : '–', W4 ? pc(W4[0].cannib) + ' → ' + pc(W4[W4.length - 1].cannib) + ' (weather link only)' : '–', E ? 'residual load of France and its neighbours, fleet of each year' : '–'],
      ['Capture value, €/MWh', f2(o.ref - o.pdEur), f2(o.fair), m3 ? f2(m3.fair) : '–', m4 ? f2(m4.fair) : '–', E ? f2(o.euFair) : '–'],
      ['Risk', (o.add + o.volRisk + o.priceRisk) + ' % (entered)', '−' + f2(o.premium) + ' (Monte Carlo)', m3 ? '−' + f2(m3.premium) + ' (spread of the years)' : '–', m4 ? '−' + f2(m4.premium) + ' (simulated weather)' : '–', E ? '−' + f2(o.premium) + ' (capacity trend’s Monte Carlo)' : '–'],
      ['Margin', '−' + f2(o.margin), '−' + f2(o.margin), m3 ? '−' + f2(o.margin) : '–', '−' + f2(o.margin), E ? '−' + f2(o.margin) : '–'],
    ];
    host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table pp-cmp3"><thead><tr><th style="text-align:left"></th>${col('Past discount', S.method === 'pct')}${col('Capacity trend', S.method === 'build')}${col('Forward shape', S.method === 'fpc')}${col('Weather simulation', S.method === 'wx')}${col('European price model', false)}</tr></thead><tbody>` +
      rows.map(r => `<tr${r[6] ? ' class="pp-main"' : ''}><td style="text-align:left">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td></tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">Same data, same costs and GO; ✓ = the method of the last tab opened. Each method has its own tab with its price, its steps and its charts; the European price model is detailed month by month in Short-term (monthly). The past discount is a reference, not a pricing method.</div>`;
  }

  // ── Asset-specific FPC method: the curve, the three pricings by year, the forward years ──
  function renderFpc(o) {
    const m3 = o.m3, sec = $('hs-pp-fpc'); if (!sec) return;
    if (!m3) { $('pp-fpc-note').textContent = 'Not enough hourly history for the years used.'; return; }
    const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], cols = ['#7FC8F8', '#FBBF24', '#A87DC4', '#14D3A9', '#ED6965'];
    _fuelChart('pp-fpc-curve', { type: 'line', data: { labels: MO, datasets: m3.fwd.map((r, i) => ({ label: 'FPC ' + r.y + ' · Cal ' + f2(r.cal), data: r.months.map(v => v == null ? null : +v.toFixed(1)), borderColor: cols[i % 5], borderWidth: 2, pointRadius: 3, fill: false })) },
      options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } }, scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh, monthly average') } }) }, 'ppa-fpc-monthly');
    const W = m3.week, mx = Math.max(...W.map(p => p.prod)) || 1;
    _fuelChart('pp-fpc-week', { type: 'line', data: { labels: W.map(p => p.h === 0 ? p.d.slice(5) : ''), datasets: [
      { label: 'FPC, €/MWh', data: W.map(p => +p.v.toFixed(1)), borderColor: '#FFFFFF', borderWidth: 1.6, pointRadius: 0, fill: false, yAxisID: 'y' },
      { label: 'Expected production (relative)', data: W.map(p => +(p.prod / mx * 100).toFixed(1)), borderColor: S.tech === 'solar' ? '#FBBF24' : '#14D3A9', backgroundColor: S.tech === 'solar' ? 'rgba(251,191,36,.18)' : 'rgba(20,211,169,.18)', borderWidth: 1.2, pointRadius: 0, fill: 'origin', yAxisID: 'y1' },
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } }, scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, autoSkip: false, maxRotation: 0, font: { size: 10 } } }), y: _fuelAxis('€/MWh'), y1: _fuelAxis('% of peak', { position: 'right', beginAtZero: true, max: 100, grid: { display: false } }) } }) }, 'ppa-fpc-week');
    const H = m3.hist, Ys = H.map(x => x.y).concat(m3.fwd.map(r => r.y)), pp = v => v == null ? null : +(v * 100).toFixed(1);
    _fuelChart('pp-fpc-years', { type: 'bar', data: { labels: Ys, datasets: [
      { type: 'line', label: '(1) Historical profile cost', data: Ys.map(y => { const x = H.find(h => h.y === y); return x ? pp(x.hist) : null; }), borderColor: '#7FC8F8', backgroundColor: '#7FC8F8', borderWidth: 0, pointRadius: 5, showLine: false },
      { type: 'line', label: '(3) Decorrelated profile cost', data: Ys.map(y => { const x = H.find(h => h.y === y); return x ? pp(x.decorr) : null; }), borderColor: '#B8C9D9', backgroundColor: '#B8C9D9', borderWidth: 0, pointRadius: 4, pointStyle: 'rect', showLine: false },
      { label: 'Cannibalisation (1) − (3)', data: Ys.map(y => { const x = H.find(h => h.y === y); return x ? pp(x.cannib) : null; }), backgroundColor: 'rgba(237,105,101,.8)', borderRadius: 3 },
      { label: 'Cannibalisation, projected', data: Ys.map(y => { const r = m3.fwd.find(f => f.y === y); return r ? pp(r.cannib) : null; }), backgroundColor: 'rgba(237,105,101,.35)', borderColor: 'rgba(237,105,101,.8)', borderWidth: 1, borderRadius: 3 },
      { type: 'line', label: '(2) Forward profile cost', data: Ys.map(y => { const r = m3.fwd.find(f => f.y === y); return r ? pp(r.fwdCost) : null; }), borderColor: '#FBBF24', backgroundColor: '#FBBF24', borderWidth: 0, pointRadius: 5, pointStyle: 'rectRot', showLine: false },
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } }, scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('% of the baseload') } }) }, 'ppa-fpc-three-pricings');
    $('pp-fpc-table').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Delivery</th><th>Cal (FPC)</th><th>(2) Profile cost</th><th>Cannibalisation</th><th>Capture rate</th><th>Capture €/MWh</th></tr></thead><tbody>` +
      m3.fwd.map(r => `<tr><td style="text-align:left">${r.y}</td><td>${f2(r.cal)}</td><td>${pc(r.fwdCost)}</td><td>${pc(r.cannib)}</td><td>${pc(r.rate)}</td><td>${f2(r.capture)}</td></tr>`).join('') +
      `</tbody></table></div>`;
    { const fr = FRDOC(), yrs = m3.years.join(', '), gaps = Object.entries(m3.calGap || {}).filter(([, g]) => Math.abs(g) > 0.05), f2c = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace('.', fr ? ',' : '.');
      const tech = fr ? (S.tech === 'solar' ? 'solaire' : 'éolien') : S.tech;
      const conv = S.conv === 'pos' ? (fr ? 'heures à prix ≤ 0 retirées de (1) et (3)' : 'hours with a price ≤ 0 left out of (1) and (3)') : S.conv === 'curt' ? (fr ? 'production arrêtée et non payée aux prix ≤ 0, baseload sur toutes les heures' : 'output stopped and not paid at prices ≤ 0, baseload on every hour') : (fr ? 'toutes les heures payées' : 'every hour paid');
      $('pp-fpc-note').innerHTML = (fr
        ? `${m3.asset ? 'Production : la courbe du parc (années ' + yrs + ').' : 'Production : ' + tech + ' national (RTE), années ' + yrs + '.'} Coefficients de mise en forme (mois, type de jour, heure) moyennés sur ces années${m3.half ? ', en penchant vers les plus récentes (poids divisé par deux chaque année en arrière)' : ''}. La FPC est calée sur ${m3.used.join(', ') || 'aucune cotation'} : les mois d’abord, puis trimestres et saisons (une période déjà fixée ne bouge plus), puis chaque année est remise à l’échelle pour valoir exactement son Cal${gaps.map(([y, g]) => ` (${y} : les cotations plus courtes donnaient ${f2c(g)} €/MWh par rapport au Cal)`).join('')}. Cannibalisation = historique (1) − décorrélé (3), année par année et par saison (avril–septembre, octobre–mars), ${m3.flat ? 'à plat à sa moyenne ' + pc(m3.meanC) : 'projetée avec la capacité installée (log), ancrée sur ' + H[H.length - 1].y}, puis pondérée par la valeur de la production de chaque saison · dispersion ± ${(m3.sigC * 100).toFixed(1)} pts. Convention : ${conv}. Au walk-forward 2024–2026 (réglages choisis sur 2019–2023, arrêt aux prix ≤ 0), ces deux choix font passer l’erreur de 7,64 à 5,84 €/MWh en solaire et de 6,23 à 4,94 en éolien ; en toutes heures, éolien −6 %, solaire +2 % (scripts/ppa_fpc_variants.py).`
        : `${m3.asset ? 'Production: the asset’s curve (years ' + yrs + ').' : 'Production: national ' + tech + ' (RTE), years ' + yrs + '.'} Shaping coefficients (month, day type, hour) averaged on the same years${m3.half ? ', leaning towards the recent ones (the weight halves every year back)' : ''}. The FPC is calibrated on ${m3.used.join(', ') || 'no quote'}: months first, then quarters and seasons (a period already set is not changed), then each year is rescaled so that it averages exactly its Cal${gaps.map(([y, g]) => ` (${y}: the shorter quotes gave ${f2c(g)} €/MWh vs the Cal)`).join('')}. Cannibalisation = historical (1) − decorrelated (3), year by year and per season (April–September, October–March), ${m3.flat ? 'flat at its average ' + pc(m3.meanC) : 'projected with installed capacity (log), anchored on ' + H[H.length - 1].y}, then weighted by the value of the output in each season · spread ± ${(m3.sigC * 100).toFixed(1)} pts. Convention: ${conv}. On the 2024–2026 walk-forward (settings chosen on 2019–2023, output stopped at prices ≤ 0), these two choices take the error from 7.64 to 5.84 €/MWh for solar and from 6.23 to 4.94 for wind; with every hour paid, wind −6 %, solar +2 % (scripts/ppa_fpc_variants.py).`) + biasLine(o, 'fpc'); }
  }

  // ── Methodology (with the proposed updates) ──
  function renderDoc(o) {
    const el = $('pp-doc'); if (!el) return;
    el.innerHTML = `
<h4>Capacity-trend method (default)</h4>
<ol>
<li><b>Forward.</b> France baseload Cal contracts of each delivery year (latest settlements), editable. Weighted by the expected production of each year (degradation ${(o.degr * 100).toFixed(2)} %/yr) and a discount factor at ${(o.disc * 100).toFixed(1)} %/yr.</li>
${FRDOC() ? `<li><b>Cannibalisation.</b> Décote de profil = 1 − prix capté ÷ prix base, par année civile : nationale (production RTE éCO2mix × day-ahead ENTSO-E) ou celle du parc (sa courbe × prix quart-horaires France). Convention : ${S.conv === 'pos' ? 'heures à prix ≤ 0 retirées du prix capté et du prix base (décote passée)' : 'toutes les heures (comme le M0 de la CRE)'}.
Projection depuis la dernière année utilisée (${o.lastYr}) : ${MODEL_T[o.model]}.${o.cfit ? ` Modèle de capacité : taux de capture = a + b × ln(GW installés), ajusté sur ${o.cfit.use.join(', ')} (b = ${(o.cfit.sl * 100).toFixed(1).replace('.', ',')} pts par ln GW, R² ${o.cfit.r2.toFixed(2).replace('.', ',')}), parc installé (RTE, ODRÉ) en ligne droite jusqu’aux objectifs PPE3 (${Object.entries(PPE3[S.tech]).map(([y, g]) => y + ' : ' + String(g).replace('.', ',') + ' GW').join(', ')}), ancré sur ${o.lastYr}.` : ''}
Incertitude : ${(o.sig0 * 100).toFixed(1).replace('.', ',')} pts × √années après ${o.lastYr} (les bandes du graphique).</li>` : `<li><b>Cannibalisation.</b> Shape discount = 1 − capture price ÷ baseload, per calendar year: national (RTE éCO2mix production × ENTSO-E day-ahead) or the asset (its curve × France quarter-hour prices). Convention: ${S.conv === 'pos' ? 'hours with a price ≤ 0 left out of both the capture price and the baseload (Past discount)' : 'all hours (as the CRE M0)'}.
Projection from the last year used (${o.lastYr}): ${MODEL_T[o.model]}.${o.cfit ? ` Capacity model: capture rate = a + b × ln(installed GW), fitted on ${o.cfit.use.join(', ')} (b = ${(o.cfit.sl * 100).toFixed(1)} pts per ln GW, R² ${o.cfit.r2.toFixed(2)}), installed capacity going in a straight line to the PPE3 targets (${Object.entries(PPE3[S.tech]).map(([y, g]) => y + ': ' + g + ' GW').join(', ')}), anchored on ${o.lastYr}.` : ''}
Uncertainty: ${(o.sig0 * 100).toFixed(1)} pts × √years after ${o.lastYr} (the bands of the chart).</li>`}
<li><b>Capture value</b> ${FRDOC() ? `= Σ poids × forward Cal × k × (1 − décote de profil projetée) = <code>${f2(o.fair)} €/MWh</code>. <b>k</b>, le facteur des mois cotés, met le niveau au mois comme le reste de l’outil : la valeur de la production sur les forwards des mois (mois coté, sinon trimestre, saison, puis Cal découpé par l’historique, data/history/fr_forward_monthly.json) ÷ sa valeur sur le Cal avec la forme saisonnière historique, que porte la capture annuelle. k = ${o.years.map(r => r.y + ' ' + (r.kq || 1).toFixed(3).replace('.', ',')).join(' ; ')} (1 quand rien n’est coté sous le Cal).${o.years.some(r => r.g !== 1) ? ` Livraison sur une partie d’année : la capture annuelle est ramenée aux mois livrés par <b>g</b> = valeur d’un MWh sur ces mois ÷ sur l’année entière (forward des mois × capture mensuelle prévue × production de chaque mois), et le volume à leur part de la production annuelle : ${o.years.filter(r => r.g !== 1).map(r => r.y + ' g ' + r.g.toFixed(3).replace('.', ',') + ', ' + Math.round(r.sh * 100) + ' % du volume').join(' ; ')}.` : ''}` : `= Σ weight × Cal forward × k × (1 − projected shape discount) = <code>${f2(o.fair)} €/MWh</code>. <b>k</b>, the quoted-month factor, puts the level month by month as the rest of the tool does: the output's value on the months' forwards (the month quoted, else its quarter, season, then the Cal shaped by history, data/history/fr_forward_monthly.json) ÷ its value on the Cal with the historical seasonal shape that the yearly capture carries. k = ${o.years.map(r => r.y + ' ' + (r.kq || 1).toFixed(3)).join(', ')} (1 when nothing below the Cal is quoted).${o.years.some(r => r.g !== 1) ? ` A year delivered in part: the yearly capture is brought to the months delivered by <b>g</b> = value of one MWh on those months ÷ on the whole year (months' forwards × forecast monthly capture × each month's output), and the volume to their share of the year's output: ${o.years.filter(r => r.g !== 1).map(r => r.y + ' g ' + r.g.toFixed(3) + ', ' + Math.round(r.sh * 100) + ' % of the volume').join('; ')}.` : ''}`}</li>
<li><b>${FRDOC() ? 'Correction de biais' : 'Bias correction'}.</b>${biasLine(o, 'step')}</li>
<li><b>Risk premium.</b> Monte Carlo (10,000 trajectories, see the Risk section): value earned per MWh, hedge included; the price is the ${o.alpha}th percentile of that value, so the chance of loss before margin is ${o.alpha} %. Premium = capture value − that percentile = <code>${f2(o.premium)} €/MWh</code>.</li>
<li><b>PPA price</b> = value at risk − additional discount − imbalance + GO − margin = <code>${f2(o.ppaBuild)} €/MWh</code>. The margin is what the buyer keeps, so it is deducted.</li>
</ol>
<h4>Hours at zero or negative prices</h4>
<p>Hours with a French day-ahead price ≤ 0 per year (${Object.keys(D.negH).filter(y => +y < thisYear()).slice(-3).map(y => y + ': ' + Math.round(D.negH[y].h) + ' h').join(', ')}), projected in a straight line with installed solar capacity (fitted on ${o.nhFitYears.join(', ')}, capacity to the PPE3 targets, at most 2,500 h). The share of the output produced in those hours follows 1 − exp(−hours ÷ h₀), calibrated on the last complete year (${o.shLast != null ? (o.shLast * 100).toFixed(1) + ' %' : '–'}). With the PPA Dashboard convention (hours > 0 only), that output is not paid: the volume paid each year is reduced accordingly, which changes the weights and the P&L.</p>
<h4>${FRDOC() ? 'Méthode de la décote passée' : 'Past-discount method'}</h4>
<p>${FRDOC() ? '<b>Repère seulement</b> (revue du 27 oct. 2026) : affichée pour comparaison, elle n’entre jamais dans le prix du PPA.' : '<b>A reference only</b> (review of 27 Oct 2026): shown for comparison, it never enters the PPA price.'}</p>
${FRDOC() ? `<p>Mode projeté (par défaut) : <code>décote(a) = tendance des N dernières années utilisées (a) + [P${S.pct} − P50] des décotes passées</code>, puis <code>PPA = Σ p(a) × F(a) × (1 − décote(a)) − F × (décote additionnelle + risque volume + risque prix) − écarts + GO − marge</code>. Mode passé seul : <code>PPA = F − F × (décote de profil au P${S.pct} des années utilisées + décote additionnelle + risque volume + risque prix) − écarts + GO − marge</code> = <code>${f2(o.ppaPct)} €/MWh</code>, F = moyenne simple des Cal. Comme dans l’outil Streamlit de l’équipe, sauf la marge : il l’ajoutait, ici elle est déduite comme dans toutes les autres méthodes.</p>` : `<p>Projected mode (default): <code>discount(y) = trend of the last N years used (y) + [P${S.pct} − P50] of the past discounts</code>, then <code>PPA = Σ w(y) × F(y) × (1 − discount(y)) − F × (add. discount + volume risk + price risk) − imbalance + GO − margin</code>. Past-only mode: <code>PPA = F − F × (shape discount at P${S.pct} of the years used + add. discount + volume risk + price risk) − imbalance + GO − margin</code> = <code>${f2(o.ppaPct)} €/MWh</code>, F = simple average of the Cal contracts. As in the team's Streamlit tool, except the margin: it added it, here it is deducted like in every other method.</p>`}
<h4>Forward shape method (the pricing deck’s “asset-specific approach”)</h4>
<ol>
<li><b>Forward price curve (FPC).</b> Hourly prices for each delivery year: the usual shape of prices (month in the year, weekday / Saturday / Sunday in the month, hour in the day), averaged on the years used, then calibrated on today’s quotes without arbitrage — months, then quarters and seasons, then each year exactly on its Cal.</li>
<li><b>(2) Forward profile cost.</b> The expected production (average by month and hour) valued on the FPC, compared with a flat delivery. It contains the usual shape, not the weather link: the FPC is smooth.</li>
<li><b>(1) Historical and (3) decorrelated profile costs</b>, year by year: the real production on the real prices (1), and on the FPC shape recalibrated on that year’s monthly prices (3). <b>Cannibalisation = (1) − (3)</b>: what the weather link cost that year.</li>
<li><b>Projection</b> of the cannibalisation with installed capacity (or flat), then <code>capture = Cal × (1 + profile cost + cannibalisation)</code>; the risk premium comes from the spread of the yearly cannibalisation.</li>
</ol>
<h4>Weather simulation method</h4>
<ol>
<li><b>Weather.</b> For each day, solar and wind capacity factors are drawn from that month’s real distribution (2016–2025), with the persistence of real weather and the solar ↔ wind link; the hourly shape comes from a real day with a similar output. Checked against the ten real years.</li>
<li><b>Production</b> on the installed capacity of the delivery year (PPE3 path). With a curve, the asset follows the national production through a factor β plus its own deviations, which do not move prices.</li>
<li><b>Prices.</b> Month level of the FPC × the effect of the net residual load (consumption − solar − wind − nuclear available), measured on the last two complete years only — older years describe a market without today’s solar fleet — with no hour below zero (most plants now stop at negative prices, so the price settles at about zero), then each year rescaled exactly to its Cal.</li>
<li><b>Risk.</b> Weather alone moves a year’s capture rate by a few points only; each simulated delivery also carries a model-risk deviation the size of this method’s past errors (historical replay).</li>
</ol>
${euDoc(o)}
${FRDOC() ? `<h4>Contrat d’agrégation indexé sur le M0 (parc sous complément de rémunération)</h4>
<p>L’État verse au producteur le complément (tarif de référence − M0) ; Selfee vend la production sur le marché day-ahead et paie au producteur <code>A % × M0</code>, <code>M0 − B</code> ou <code>A % × M0 − B</code>, le M0 de la filière publié par la CRE (estimation PowerKlock pour les mois pas encore publiés). Marge Selfee par MWh = valeur de marché du parc − paiement − écarts − coûts fixes. La valeur de marché du parc est sa production × le prix de chaque heure, les heures à prix négatif non produites comme le M0 les exclut (les heures à 0 € comptent, à 0). Sur les mois utilisés, le parc gagne en moyenne <code>ratio × M0</code> ; au niveau de M0 pricé (d’après les forwards, pondérés par la production du parc mois par mois), les formules équilibrent la marge cible : <code>A = (ratio × M0 − coûts) ÷ M0</code>, <code>B = coûts + (1 − ratio) × M0</code> ; pour la formule mixte, A est la part du M0 que le parc suit vraiment (régression pondérée de son prix mensuel sur le M0) et B équilibre la marge, l’écart le plus serré pour Selfee. Risque : 4 000 années de contrat tirées mois par mois dans les mois utilisés (prix du parc et M0 du même mois, ramenés au niveau de M0 pricé). Écarts : coût national de la filière sur 12 mois × 1,5 pour un parc seul, sauf saisie. Non modélisé : le complément lui-même, les règles de compensation aux prix négatifs de chaque génération de contrat, la capacité et les GO (celles d’un parc soutenu reviennent à l’État, vendues aux enchères EEX).</p>` : `<h4>Aggregation contract indexed on the M0 (park under complément de rémunération)</h4>
<p>The State pays the producer the complément (reference tariff − M0); Selfee sells the output on the day-ahead market and pays the producer <code>A % × M0</code>, <code>M0 − B</code> or <code>A % × M0 − B</code>, the M0 of the technology published by the CRE (PowerKlock estimate for the months not yet published). Selfee margin per MWh = park market value − payment − imbalance − fixed costs. The park market value is its output × the price of each hour, hours at negative prices not produced as the M0 leaves them out (hours at 0 € count, at 0). On the months used, the park earns <code>ratio × M0</code> on average; at the M0 level priced (from the forwards, weighted by the park's output month by month) the formulas balance the target margin: <code>A = (ratio × M0 − costs) ÷ M0</code>, <code>B = costs + (1 − ratio) × M0</code>; for the mixed formula A is the share of the M0 the park really follows (weighted regression of its monthly price on the M0) and B balances the margin, the narrowest spread for Selfee. Risk: 4,000 contract years drawn month by month from the months used (park price and M0 of the same month, rescaled to the M0 level priced). Imbalance: national cost of the technology over 12 months × 1.5 for a single park, unless entered. Not modelled: the complément itself, the compensation rules at negative prices of each contract generation, capacity and GOs (those of a supported park belong to the State, sold at the EEX auctions).</p>`}
<h4>Single park, with or without history (Tools › Production forecast › Price this park)</h4>
<p>Hourly ERA5 weather at the park since 2005 through the forecast model, corrected month by month on the real output of its region (RTE load factors 2020–2025 against the same simulation), a single park at 0.887 of its region’s fleet in the same weather (four metered parks), the park's metering pooled with that prior (weight days ÷ (days + 180)), its P50 only when asked (the annex P50s were 8–17 % below real output); P50/P90 from the weather years and the model uncertainty; capture on the real hourly prices with partial curtailment at negative prices (learned on the park, else 35 %). The synthetic curve goes to this pricer as the asset curve. Checked on four metered parks over their second year (ERA5 chain): output value within −0.3 … +7 % with 12 months of metering, within −5 … +3 % with no metering at all (single-park factor, each park left out of its own factor), against +8 … +16 % on the regional prior alone and −12 … −22 % on the annex P50s.</p>
<h4>Imbalance cost</h4>
<p>National and basic: every quarter-hour, (actual − day-ahead forecast of national solar or wind) × (imbalance price − spot), divided by the production; the last 12 months (ENTSO-E forecasts and imbalance prices, RTE actual production, updated weekly). An asset’s own forecast error is usually larger.</p>
<h4>Historical replay</h4>
<p>Each delivery year 2019–2025 is priced as at its start (history before it, capacity extrapolated) and the predicted capture rate is compared with the actual one (Compare tab). On the national profile, without 2022: solar — FPC 4.9 pts of average error, step by step 8.1, Monte Carlo 9.0, Past discount 11.9; wind — step by step 1.5, Past discount 2.3, Monte Carlo 2.5, FPC 4.0. All methods were too optimistic on solar in 2024: cannibalisation grew faster than any history showed.</p>
<h4>P&L</h4>
<p>Everywhere on the page: production × (capture price − imbalance + GO − PPA price). Earlier versions left the imbalance and GO out of the P&L.</p>
<h4>Data</h4>
${FRDOC() ? `<p>RTE éCO2mix (production nationale, 15 min) · prix day-ahead ENTSO-E · capacité installée : RTE (ODRÉ) pour la France, Energy-Charts pour les voisins · objectifs PPE3 · forwards Cal France et historique du Cal+1 (données de marché) · prix mid des GO Commerg (AIB renouvelable). Rien de ce que vous chargez ne quitte le navigateur.</p>` : `<p>RTE éCO2mix (national production, 15 min) · ENTSO-E day-ahead prices · installed capacity: RTE (ODRÉ) for France, Energy-Charts for the neighbours · PPE3 targets · France Cal forwards and Cal+1 history (market data) · Commerg GO mid prices (AIB renewable). Nothing you load leaves the browser.</p>`}
<h4>Proposed updates</h4>
<ul>
<li><b>Hourly price forward curve.</b> Build hourly prices from the Cal forwards and a shape (month × day type × hour, with a solar-hour discount growing with capacity) and price the asset's profile on it, instead of one shape discount per year. Most rigorous; needs the shape calibration.</li>
<li><b>Negative prices as a clause.</b> Model the contract options explicitly: no payment when the price is negative (common in French PPAs) or curtailment from a threshold, with a projected number of negative hours (Negative prices page) — today only the "hours > 0" convention approximates it.</li>
<li><b>Imbalance, asset level.</b> The default imbalance cost is now a basic national estimate (day-ahead forecast error of national solar / wind × (imbalance price − spot), last 12 months). An asset's own forecast error is usually larger: an uplift per technology, or the asset's forecasts, would refine it.</li>
<li><b>Volume risk in two parts.</b> P50 / P90 production from the asset's yield study, plus weather-year noise; today one σ per year.</li>
<li><b>Correlation price ↔ cannibalisation.</b> Calibrate the link between the price level and the shape discount on history (2022 shows high prices with a low discount); today zero by assumption.</li>
<li>${FRDOC() ? '<b>Effet des batteries et de la flexibilité.</b> Un scénario où le stockage (Bilan prévisionnel de RTE) réduit la décote solaire après 2028.' : '<b>Battery and flexibility effect.</b> A scenario where storage capacity (RTE Bilan prévisionnel) narrows the solar discount after 2028.'}</li>
<li><b>Credit and indexation.</b> Counterparty risk premium and contracts indexed on a reference (M0, Cal) rather than fixed.</li>
</ul>`;
  }

  // ── Scenarios: saved pricings compared side by side (localStorage) ──
  const SKEY = 'pk-ppa-scen';
  const scenLoad = () => { try { return JSON.parse(localStorage.getItem(SKEY) || '[]'); } catch (_) { return []; } };
  const scenSave = a => { try { localStorage.setItem(SKEY, JSON.stringify(a.slice(-8))); } catch (_) {} };
  function scenOf(o) {
    const inp = JSON.parse(JSON.stringify(Object.assign({}, S, { asset: null, last: null })));
    const tech = S.tech === 'solar' ? 'Solar' : 'Wind';
    return { id: Date.now(), name: `${tech} · ${o.useAsset ? S.assetName : 'national'} · ${o.tenor[0]}–${o.tenor[o.tenor.length - 1]}${S.method === 'pct' ? ' · past discount' : ' · risk ' + o.alpha + ' %'}${S.hedge === 'open' ? ' · open' : ''}`,
      at: new Date().toISOString().slice(0, 16).replace('T', ' '), inputs: inp, assetName: o.useAsset ? S.assetName : '',
      out: { ppa: o.ppa, build: o.ppaBuild, pct: o.ppaPct, fair: o.fair, premium: o.premium, refW: o.refW, sd0: o.years[0].fsd, sd1: o.years[o.years.length - 1].fsd, prob: o.mcAt ? o.mcAt.prob : null, p10: o.mcAt ? o.mcAt.pc[10] : null, vol: o.volume, alpha: o.alpha, imb: o.imb, go: o.goW, margin: o.margin } };
  }
  function renderScen() {
    const host = $('pp-scen-cmp'); if (!host) return;
    const L = scenLoad();
    if (!L.length) { host.innerHTML = '<div class="fuel-note">No scenario saved yet: set the inputs, then “Save this scenario”; change them and save again to compare.</div>'; return; }
    const rows = [['PPA price €/MWh', x => x.ppa, 2, 'max'], ['Capacity-trend method', x => x.build, 2], ['Past-discount method', x => x.pct, 2], ['Capture value', x => x.fair, 2], ['Risk premium', x => x.premium, 2, 'min'],
      ['Forward (weighted)', x => x.refW, 2], ['Shape discount first year', x => x.sd0, 'pc'], ['Shape discount last year', x => x.sd1, 'pc'], ['Chance of loss', x => x.prob, 'pc', 'min'], ['P10 total P&L k€', x => x.p10, 0, 'max'],
      ['Production MWh/yr', x => x.vol, 0], ['Risk accepted %', x => x.alpha, 0], ['Imbalance', x => x.imb, 2], ['GO', x => x.go, 2], ['Margin', x => x.margin, 2]];
    const fmt = (v, d) => v == null || !isFinite(v) ? '–' : d === 'pc' ? (v * 100).toFixed(1) + ' %' : v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
    const esc = PK.esc;   // js/pk-core.js
    host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table pp-cmp"><thead><tr><th style="text-align:left"></th>${L.map(x => `<th title="${esc(x.at)}">${esc(x.name)}<br><button type="button" class="pp-load" data-id="${x.id}">load</button> <button type="button" class="pp-x" data-id="${x.id}" aria-label="Delete">✕</button></th>`).join('')}</tr></thead><tbody>` +
      rows.map(([lbl, f, d, best]) => { const vals = L.map(x => f(x.out)), ok = vals.filter(v => v != null && isFinite(v)), b = best && ok.length > 1 ? (best === 'max' ? Math.max(...ok) : Math.min(...ok)) : null;
        return `<tr><td style="text-align:left">${lbl}</td>${vals.map(v => `<td class="${b != null && v === b ? 'best' : ''}">${fmt(v, d)}</td>`).join('')}</tr>`; }).join('') +
      `</tbody></table></div><div class="fuel-note">Green: best of the row. “load” puts the scenario’s inputs back (a curve has to be loaded again if the scenario used one).</div>`;
    host.querySelectorAll('.pp-x').forEach(b => b.addEventListener('click', () => { scenSave(scenLoad().filter(x => String(x.id) !== b.dataset.id)); renderScen(); }));
    host.querySelectorAll('.pp-load').forEach(b => b.addEventListener('click', () => {
      const x = scenLoad().find(y => String(y.id) === b.dataset.id); if (!x) return;
      const keep = { asset: S.asset, assetName: S.assetName };
      Object.keys(S).forEach(k => { if (k in x.inputs) S[k] = x.inputs[k]; });
      Object.assign(S, keep);
      Object.entries(FIELDS).forEach(([id, k]) => { const e = $(id); if (e) e.value = S[k] == null ? '' : S[k]; });
      [['pp-tech', 'tech'], ['pp-basis', 'basis'], ['pp-model', 'model'], ['pp-conv', 'conv'], ['pp-method', 'method'], ['pp-hedge', 'hedge'], ['pp-pct', 'pct']].forEach(([id, k]) => { const e = $(id); if (e) e.value = S[k]; });
      $('pp-pct-v').textContent = 'P' + S.pct;
      if (x.assetName && x.assetName !== S.assetName) $('pp-status').textContent = 'This scenario used the curve “' + x.assetName + '”: load it again to reproduce it exactly.';
      run();
    }));
  }

  // ── PowerPoint report: the price, its steps, the charts that make it ──
  async function pptxReport() {
    const o = S.last, btn = $('pp-pptx'); if (!o || !window.PKExport || !PKExport.deck) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Preparing…';
    try {
      const card = id => { const e = $(id); return e && e.closest('.chart-container'); };
      const shots = [['pp-waterfall', 'Price build-up', 'From the baseload forward to the PPA price (€/MWh)'], ['pp-years', 'Year by year', 'What each delivery year contributes'],
        ['pp-proj', 'Cannibalisation · history and projection', ($('pp-proj-sub') || {}).textContent || ''], ['pp-capfit', 'Capture rate vs installed capacity', ($('pp-capfit-sub') || {}).textContent || ''],
        ['pp-mc-u', 'What the asset is worth per MWh · Monte Carlo', 'Realised value per MWh over 10,000 trajectories, line = PPA price'], ['pp-mc-fan', 'Annual P&L at the PPA price', 'k€ per year, P5 to P95'],
        ['pp-scen', 'Stress scenarios', 'Total P&L over the tenor'], ['pp-scen-cmp', 'Scenarios compared', 'Saved pricings side by side']];
      const tech = S.tech === 'solar' ? 'Solar' : 'Wind', T = o.tenor[0] + '–' + o.tenor[o.tenor.length - 1];
      const steps = (S.method === 'pct'
        ? [`Forward: ${f2(o.ref)} €/MWh (Cal ${T})`, `Shape discount: ${pc(o.sdCh)} (P${S.pct} of ${o.sel.join(', ')})`, `Risks: −${f2(o.ref * (o.add + o.volRisk + o.priceRisk) / 100)} €/MWh`, `Imbalance −${f2(o.imb)}, GO +${f2(o.goVal)}, margin −${f2(o.margin)}`, `PPA price: ${f2(o.ppa)} €/MWh (step-by-step method: ${f2(o.ppaBuild)})`]
        : [`1 · Forward: ${f2(o.refW)} €/MWh (Cal ${T}, weighted by production)`, `2 · Cannibalisation: shape discount ${pc(o.years[0].fsd)} → ${pc(o.years[o.years.length - 1].fsd)}, ${MODEL_T[o.model]}`,
          `3 · Capture value: ${f2(o.fair)} €/MWh`, `4 · Risk premium: −${f2(o.premium)} €/MWh (${o.alpha} % chance of loss accepted, Monte Carlo, ${S.hedge === 'open' ? 'forward open' : 'forward hedged'})`,
          `5 · Imbalance −${f2(o.imb)}, GO +${f2(o.goW)}, margin −${f2(o.margin)}`, `PPA price: ${f2(o.ppa)} €/MWh (Past-discount method: ${f2(o.ppaPct)})`]).join('\n');
      const specs = [{ k: 'note', title: `${tech} PPA · ${o.useAsset ? S.assetName : 'national profile'} · ${T}: ${f2(o.ppa)} €/MWh`, text: steps + `\n\nProduction ${f0(o.volume)} MWh/yr · chance of loss at this price ${o.mcAt ? (o.mcAt.prob * 100).toFixed(1) + ' %' : '–'} · P10 total P&L ${o.mcAt ? sgn(o.mcAt.pc[10]) + ' k€' : '–'}` }];
      for (const [id, title, sub] of shots) { const el = card(id); if (!el || !el.offsetHeight) continue; try { specs.push({ k: 'card', title, sub, src: 'PowerKlock PPA pricer', r: await PKExport.snap(el) }); } catch (e) { console.warn('[ppa] snap', id, e); } }
      const a = o.auto, line = (l, k, u) => `${l}: ${a[k] ? a[k][0] : '–'}${u || ''}${S[k] != null ? ' (entered: ' + S[k] + ')' : ' · ' + (a[k] ? a[k][1] : '')}`;
      specs.push({ k: 'note', title: 'Assumptions', text: [line('Production', 'volume', ' MWh/yr'), line('Degradation', 'degr', ' %/yr'), line('Imbalance', 'imb', ' €/MWh'), line('GO', 'go', ' €/MWh'), line('Margin', 'margin', ' €/MWh'), line('Discount rate', 'disc', ' %'),
        line('Risk accepted', 'alpha', ' %'), line('Production uncertainty', 'mcVol', ' %'), line('Forward volatility', 'mcFwd', ' %/√yr'), line('Cannibalisation drift', 'mcSd', ' pts/√yr'), line('Production ↔ cannibalisation', 'rho', ''),
        `Years fitted: ${o.sel.join(', ')} · capture convention: ${S.conv === 'curt' ? 'curtailment at prices ≤ 0' : S.conv === 'pos' ? 'hours with price > 0' : 'all hours'} · forwards of ${D.fwdDate || '–'}`].join('\n') });
      await PKExport.deck(`PPA pricing · ${tech} ${T}`, specs);
    } catch (e) { console.warn('[ppa] pptx', e); $('pp-status').textContent = 'PowerPoint report failed: ' + (e.message || e); }
    btn.disabled = false; btn.textContent = label;
  }

  // ── Excel export ──
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'js/vendor/xlsx.full.min.js'; sc.onload = res; sc.onerror = () => rej(new Error('Excel library failed to load')); document.head.appendChild(sc); });
  }
  async function exportXlsx() {
    const o = S.last; if (!o) return;
    const btn = $('pp-xlsx'); if (btn) btn.textContent = 'Preparing…';
    try {
      await loadXLSX();
      const wb = XLSX.utils.book_new(), add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
      const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100, r4 = v => v == null || !isFinite(v) ? null : Math.round(v * 10000) / 10000;
      const A = o.mcAt;
      add('Summary', [
        { Item: 'Method', Value: S.method === 'pct' ? 'Past discount (percentile of history)' : 'Capacity trend (projection + Monte Carlo premium)' },
        { Item: 'PPA price (€/MWh)', Value: r2(o.ppa) }, { Item: 'Capacity-trend price (€/MWh)', Value: r2(o.ppaBuild) }, { Item: 'Past discount price (€/MWh)', Value: r2(o.ppaPct) }, { Item: 'European price model price (€/MWh)', Value: r2(o.ppaEu) },
        { Item: 'Technology', Value: S.tech }, { Item: 'Tenor', Value: o.tenor[0] + '–' + o.tenor[o.tenor.length - 1] }, { Item: 'Production (MWh/yr)', Value: r2(o.volume) }, { Item: 'Capacity (MW)', Value: o.mw },
        { Item: 'Basis', Value: o.useAsset ? 'asset curve ' + S.assetName : 'national profile' }, { Item: 'Capture convention', Value: S.conv === 'curt' ? 'curtailment at prices ≤ 0' : S.conv === 'pos' ? 'hours with price > 0 (Past discount)' : 'all hours' },
        { Item: 'Years used', Value: o.sel.join(', ') }, { Item: 'Projection', Value: MODEL_T[o.model] }, { Item: 'Forward, weighted (€/MWh)', Value: r2(o.refW) }, { Item: 'Forward, simple average (€/MWh)', Value: r2(o.ref) },
        { Item: 'Capture value (€/MWh)', Value: r2(o.fair) }, { Item: 'Risk accepted (% chance of loss)', Value: o.alpha }, { Item: 'Risk premium (€/MWh)', Value: r2(o.premium) },
        { Item: 'Percentile (past discount)', Value: 'P' + S.pct }, { Item: 'Shape discount at the percentile', Value: r4(o.sdCh) },
        { Item: 'Imbalance (€/MWh)', Value: o.imb }, { Item: 'GO, weighted (€/MWh)', Value: r2(o.goW) }, { Item: 'Margin (€/MWh)', Value: o.margin }, { Item: 'Additional discount (%)', Value: o.add },
        { Item: 'Volume risk (%) · Past discount', Value: o.volRisk }, { Item: 'Price risk (%) · Past discount', Value: o.priceRisk }, { Item: 'Discount rate', Value: o.disc }, { Item: 'Degradation /yr', Value: o.degr },
        { Item: 'MC production σ', Value: r4(o.sigV) }, { Item: 'MC forward volatility /√yr', Value: r4(o.sigF) }, { Item: 'MC cannibalisation drift /√yr', Value: r4(o.sig0) }, { Item: 'MC correlation production–cannibalisation', Value: o.rho }, { Item: 'Forward hedge', Value: S.hedge },
        ...(A ? [{ Item: 'MC P50 total P&L (k€)', Value: r2(A.pc[50]) }, { Item: 'MC P10 total (k€)', Value: r2(A.pc[10]) }, { Item: 'MC P90 total (k€)', Value: r2(A.pc[90]) }, { Item: 'Chance of loss', Value: r4(A.prob) }, { Item: 'Expected shortfall (k€)', Value: r2(A.es) }] : []),
        { Item: 'Exported', Value: new Date().toISOString() }, { Item: 'Source', Value: 'PowerKlock PPA pricer — RTE éCO2mix, ENTSO-E day-ahead, Energy-Charts capacity, PPE3, market forwards, Commerg GO' },
      ]);
      add('Year by year', o.years.map(r => ({ Year: r.y, 'Forward €/MWh': r2(r.fwd), 'Projected shape discount': r4(r.fsd), 'σ': r4(r.sig), 'Capture €/MWh': r2(r.cp), 'GO €/MWh': r2(r.go), 'Production MWh': r2(r.ev), 'Discount factor': r4(r.df), Weight: r4(r.wt), 'P&L k€ (central)': r2(r.pnlK) })));
      add('National history', o.nat.map(x => ({ Year: x.year, 'Baseload €/MWh': r2(x.base), 'Capture €/MWh': r2(x.cp), 'Capture rate': r4(x.cpPct), 'Shape discount': r4(x.sd), 'Load factor': r4(x.lf), Days: x.days, Complete: x.complete })));
      if (o.ast) add('Asset history', o.ast.map(x => ({ Year: x.year, 'Baseload €/MWh': r2(x.base), 'Capture €/MWh': r2(x.cp), 'Capture rate': r4(x.cpPct), 'Shape discount': r4(x.sd), 'Volume MWh': r2(x.mwh), Days: x.days })));
      const pr = []; for (let y = o.lastYr + 1; y <= 2035; y++) { const cs = o.sigT(y - o.lastYr), m = o.proj(y); pr.push({ Year: y, 'Installed GW': r2(o.capPath(y)), 'Capture P10': r4(1 - (m + 1.28 * cs)), 'Capture P50': r4(1 - m), 'Capture P90': r4(1 - (m - 1.28 * cs)), Tenor: o.tenor.includes(y) }); }
      add('Projection', pr);
      add('Percentiles P1-P100', o.pcts.map((p, i) => ({ Percentile: p, 'Annual P&L k€': r2(o.pnlCurve[i]) })));
      add('Scenarios', o.scen.map(r => ({ Scenario: r.name, 'Low k€': r2(r.p10), 'Central k€': r2(r.p50), 'High k€': r2(r.p90) })));
      if (A) add('Monte Carlo', A.years.map(r => ({ Year: r.y, 'Shape disc projected': r4(r.sdTrend), 'Shape disc P50': r4(r.sd50), 'Shape disc P90': r4(r.sd90), 'Capture P50 €/MWh': r2(r.cp50), 'P&L P10 k€': r2(r.p10), 'P&L P50 k€': r2(r.p50), 'P&L P90 k€': r2(r.p90), 'Std k€': r2(r.std) })));
      XLSX.writeFile(wb, `PowerKlock_PPA_${S.tech}_${o.tenor[0]}-${o.tenor[o.tenor.length - 1]}_${pkTodayISO()}.xlsx`);
    } catch (e) { console.warn('[ppa] xlsx', e); }
    if (btn) btn.textContent = '⤓ Excel';
  }

  let busy = false, again = false;
  // the partial stop, said under the price: the share stopped, the two cases blended, the charts showing the full stop
  function partialNote(o) {
    let el = $('pp-partial-note');
    if (!o.partial) { if (el) el.remove(); return; }
    const st = $('pp-status'); if (!el && st) { el = document.createElement('div'); el.id = 'pp-partial-note'; el.className = 'fuel-note'; st.after(el); }
    if (!el) return;
    const P = o.partial, fr = FRDOC(), n = (v, d) => v == null || !isFinite(v) ? '–' : (+v).toFixed(d).replace('.', fr ? ',' : '.');
    el.innerHTML = fr ? `<b>Arrêt partiel aux prix ≤ 0 :</b> ${n(P.k * 100, 0)} % de la production de ces heures s’arrête (non payée), le reste tourne et touche le prix négatif ; ${n(P.ns * 100, 1)} % de la production tombe à ces heures sur le ténor. Chaque méthode mélange ses deux prix : arrêt total ${n(P.stop.ppa, 2)} €/MWh, sans arrêt ${n(P.run.ppa, 2)} €/MWh → <b>${n(o.ppa, 2)} €/MWh</b>, pondéré par les volumes payés. Les graphiques et tableaux montrent le cas d’arrêt total ; la précision mesurée est celle de l’arrêt total.`
      : `<b>Partial stop at prices ≤ 0:</b> ${n(P.k * 100, 0)} % of the output at those hours stops (not paid), the rest runs and is paid the negative price; ${n(P.ns * 100, 1)} % of the output falls in those hours over the tenor. Each method blends its two prices: full stop ${n(P.stop.ppa, 2)} €/MWh, no stop ${n(P.run.ppa, 2)} €/MWh → <b>${n(o.ppa, 2)} €/MWh</b>, weighted by the paid volumes. Charts and tables show the full-stop case; the measured precision is the full-stop one.`;
  }
  async function run() {
    if (busy) { again = true; return; }
    busy = true;
    const cpf = $('pp-curtpct-field'); if (cpf) cpf.hidden = S.conv !== 'part';
    try { await load(); const o = await compute();
      if (o.missing) { S.last = null; renderForwards(o); renderYears(o); renderAuto(o); try { renderMarket(o); } catch (e) { console.warn('[ppa] market', e); }
        $('pp-status').innerHTML = `<b>No market price for Cal ${o.missing.join(', ')}.</b> Enter your forward for ${o.missing.length > 1 ? 'these years' : 'this year'} (step 2), or end the delivery in ${o.missing[0] - 1}. Nothing is priced until then.`;
        $('pp-kpis').innerHTML = ''; $('pp-build').innerHTML = ''; busy = false; if (again) { again = false; run(); } return; }
      S.last = o; renderForwards(o); render(o); partialNote(o); renderScen(); document.dispatchEvent(new CustomEvent('pk-ppa-run')); try { renderMarket(o); } catch (e) { console.warn('[ppa] market', e); } try { renderMC(o); } catch (e) { console.warn('[ppa] mc', e); } $('pp-status').textContent = ''; }
    catch (e) { console.warn('[ppa]', e); $('pp-status').textContent = 'Pricing failed: ' + e.message; }
    busy = false; if (again) { again = false; run(); }
  }

  async function loadAsset(f, name) {
    $('pp-status').textContent = 'Reading ' + name + '…';
    try {
      const rows = await window.PKLoadCurve.readFile(f), a = window.PKLoadCurve.build(rows, { unit: $('pp-unit').value, stamp: 'auto' });
      // a production curve in negative values (consumption sign convention): read as production
      let neg = 0, pos = 0; a.slots.forEach(x => x.forEach(v => { if (v < 0) neg++; else if (v > 0) pos++; }));
      const flipped = neg > pos; if (flipped) a.slots.forEach(x => { for (let q = 0; q < x.length; q++) if (x[q] != null) x[q] = Math.abs(x[q]); });
      const days = a.slots.size;
      S.asset = a; S.years = null; S.assetName = name.replace(/\.[^.]+$/, ''); $('pp-asset-clear').hidden = false;
      await run();
      const warn = [flipped ? 'values were negative: read as production' : '', days < 330 ? `only ${days} days: a capture rate needs a full year (seasons weigh differently), the national profile prices the missing months poorly — read the result with care` : ''].filter(Boolean).join(' · ');
      if (warn) $('pp-status').textContent = name + ': ' + warn;
    }
    catch (e) { $('pp-status').textContent = e.message; }
  }
  function wire() {
    const page = $('page-ppapricer'); if (!page || page.dataset.wired) return;
    page.dataset.wired = '1';
    Object.entries(FIELDS).forEach(([id, k]) => { const e = $(id); if (e) e.addEventListener('change', ev => { const v = ev.target.value === '' ? null : parseFloat(ev.target.value); S[k] = v != null && isFinite(v) ? v : null; run(); }); });
    page.addEventListener('click', e => { const t = e.target.closest('.pp-auto.man[data-k]'); if (!t) return; e.preventDefault(); S[t.dataset.k] = null; const id = Object.keys(FIELDS).find(i => FIELDS[i] === t.dataset.k); if (id) $(id).value = ''; run(); });
    [['pp-tech', 'tech'], ['pp-basis', 'basis'], ['pp-model', 'model'], ['pp-conv', 'conv'], ['pp-method', 'method'], ['pp-hedge', 'hedge']].forEach(([id, k]) => { const e = $(id); if (e) { e.value = S[k]; e.addEventListener('change', ev => { S[k] = ev.target.value; if (k === 'tech') S.years = null; run(); }); } });
    $('pp-pct').addEventListener('change', e => { S.pct = +e.target.value; run(); });
    const pdm = $('pp-pdmode'); if (pdm) pdm.addEventListener('change', e => { S.pdMode = e.target.value; run(); });
    const pdy = $('pp-pdyears'); if (pdy) pdy.addEventListener('change', e => { S.pdYears = +e.target.value; run(); });
    const fu = $('pp-fanm-unit'); if (fu) fu.addEventListener('change', () => renderFanM(S.last));
    const vh = $('pp-vsa-h'); if (vh) vh.addEventListener('change', () => { VSH = vh.value; renderVsActual(); });
    // first and last month delivered (January → December by default: whole calendar years)
    ['pp-m0', 'pp-m1'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', e => { S[id === 'pp-m0' ? 'm0' : 'm1'] = +e.target.value; run(); }); });
    $('pp-pct').addEventListener('input', e => { $('pp-pct-v').textContent = 'P' + e.target.value; });
    $('pp-xlsx').addEventListener('click', exportXlsx);
    // the inputs stay folded once folded; the folded bar shows their summary
    const inSec = $('hs-pp-in');
    if (inSec) { try { if (localStorage.getItem('pk-pp-in') === 'closed') inSec.classList.add('collapsed'); } catch (e) {}
      inSec.querySelector('.hist-section-header').addEventListener('click', () => { try { localStorage.setItem('pk-pp-in', inSec.classList.contains('collapsed') ? 'closed' : 'open'); } catch (e) {} inSummary(S.last); }); }
    // the guide stays closed once the user has closed it
    const gd = $('pp-guide');
    if (gd) { try { if (localStorage.getItem('pk-pp-guide') === 'closed') gd.open = false; } catch (e) {}
      gd.addEventListener('toggle', () => { try { localStorage.setItem('pk-pp-guide', gd.open ? 'open' : 'closed'); } catch (e) {} }); }
    $('pp-scen-save').addEventListener('click', () => { if (!S.last) return; const L = scenLoad(); L.push(scenOf(S.last)); scenSave(L); renderScen(); });
    $('pp-pptx').addEventListener('click', pptxReport);
    renderScen();
    const file = $('pp-file');
    file.addEventListener('change', async () => { const f = file.files[0]; if (f) await loadAsset(f, f.name); file.value = ''; });
    page.querySelectorAll('a[data-sample]').forEach(a => a.addEventListener('click', async e => {
      e.preventDefault();
      const r = await fetch(a.dataset.sample); if (!r.ok) { $('pp-status').textContent = 'Test curve not found'; return; }
      const name = a.dataset.sample.split('/').pop(), f = new File([await r.blob()], name, { type: 'text/csv' });
      S.tech = a.dataset.tech; $('pp-tech').value = S.tech; S.mw = null; S.volume = null;
      await loadAsset(f, name);
    }));
    $('pp-asset-clear').addEventListener('click', () => { S.years = null; S.asset = null; S.assetName = ''; S.loc = null; $('pp-asset-clear').hidden = true; run(); });
    run();
  }
  // one tab per method (js/views.js): the tab sets the method that prices
  const VIEW_METHOD = { 'Past discount': 'pct', 'Capacity trend': 'build', 'Forward shape': 'fpc', 'Weather simulation': 'wx' };
  document.addEventListener('pk-view', e => {
    if (!e.detail || e.detail.key !== 'ppapricer') return;
    const m = VIEW_METHOD[e.detail.label];
    const was = S.view;
    S.view = ['Inputs & price', 'The park', 'Compare & price'].includes(e.detail.label) ? 'compare' : 'method';
    if (S.view === 'compare' && was !== 'compare' && S.last && !S.last.m4 && $('page-ppapricer').dataset.wired) { run(); return; }
    if (m && m !== S.method) { S.method = m; if ($('page-ppapricer') && $('page-ppapricer').dataset.wired) run(); }
    else if (S.last) { renderAuto(S.last); renderResBar(S.last); renderBand(S.last); renderSumWf(S.last); }
  });
  window.addEventListener('load', () => setTimeout(() => {
    ['cn-tech', 'cn-conv', 'cn-model'].forEach(id => { const e = $(id); if (e) e.addEventListener('change', () => PKCannib.render()); });
    let cnDone = false;
    const sec = $('hs-renewables-cannib');
    if (sec && window.IntersectionObserver) new IntersectionObserver(es => { if (!cnDone && es.some(e => e.isIntersecting)) { cnDone = true; PKCannib.render(); } }).observe(sec);
    PK.onPage('ppapricer', wire);
  }, 0));
  // ── Site charts: Renewables › Cannibalisation (same engine, PowerKlock data, no asset) ──
  const stFor = p => Object.assign(JSON.parse(JSON.stringify(S0)), { tech: p.tech || 'solar', conv: p.conv || 'pos', model: p.model || 'capacity', noMC: true });
  async function siteDraw(p, ids) { await load(); const st = stFor(p), o = await compute(st); renderMarket(o, st, ids); return o; }
  const TECH = { key: 'tech', label: 'Technology', options: [['solar', 'Solar'], ['wind', 'Wind']], inTitle: true };
  const CONV = { key: 'conv', label: 'Capture convention', options: [['pos', 'Hours with price > 0 (PPA Dashboard)'], ['all', 'All hours']] };
  const MODEL = { key: 'model', label: 'Projection', options: [['capacity', 'Installed capacity (PPE3)'], ['flat', 'Flat'], ['damped', 'Damped trend'], ['linear', 'Straight line']] };
  const pageP = () => ({ tech: ($('cn-tech') || {}).value || 'solar', conv: ($('cn-conv') || {}).value || 'pos', model: ($('cn-model') || {}).value || 'capacity' });
  if (window.PKW) {
    const reg = (id, title, canvas, desc, params, ids, size) => PKW.register({ id, title, category: 'renewables', page: 'renewables', pageCanvas: canvas, source: 'RTE · ENTSO-E', size: size || { w: 12, h: 6 },
      desc, params, defaults: { tech: 'solar', conv: 'pos', model: 'capacity' }, pageParams: pageP,
      titleFn: p => title + ' · ' + (p.tech === 'wind' ? 'wind' : 'solar'),
      async draw(cid, p) { const sub = cid + '-sub'; const o = await siteDraw(p, ids(cid, sub)); const e = document.getElementById(sub); return { sub: e ? e.textContent : '' }; } });
    reg('cannib-projection', 'Capture rate · history and projection', 'cn-proj', 'National capture rate per year, projected with installed capacity to the PPE3 targets (complete years except 2022), P50 with P10–P90 and P25–P75 bands to 2035.', [TECH, CONV, MODEL], (c, s2) => ({ proj: c, projSub: s2, projTable: c === 'cn-proj' ? 'cn-proj-table' : null }));
    reg('cannib-capacity', 'Capture rate vs installed capacity', 'cn-capfit', 'One point per year: national capture rate against installed capacity, log fit and the PPE3 2030 / 2035 targets.', [TECH, CONV], (c, s2) => ({ capfit: c, capfitSub: s2 }));
    reg('cannib-countries', 'Capture rate vs installed capacity · France and its neighbours', 'cn-xc', 'One colour per country (France, Germany, Belgium, Netherlands, Spain) with its trend: capture rate against installed capacity (GW, % of average load or % of the installed fleet), with the French PPE3 targets.', [TECH, CONV], (c, s2) => ({ xc: c, xcSub: s2 }));
    reg('cannib-hourly', 'Price vs solar or wind share, hour by hour', 'cn-hc', 'Every hour of the last three years: the price of the hour against the solar or wind share of the load, the country alone or the coupled region (France, Germany, Belgium, Spain).', [TECH], (c, s2) => ({ hc: c, hcSub: s2 }));
    reg('cannib-countries-years', 'Capture rate per year · France and its neighbours', 'cn-xcy', 'Solar or wind capture rate per year in France, Germany, Belgium, the Netherlands and Spain: the coupled markets move together.', [TECH, CONV], (c, s2) => ({ xcy: c, xcySub: s2 }));
    reg('cannib-neghours', 'Hours at zero or negative prices · history and projection', 'cn-negh', 'Hours with a day-ahead price at or below zero in France per year, projected with the solar build-out to the PPE3 targets, and the share of solar or wind output in those hours.', [TECH, CONV], (c, s2) => ({ negh: c, neghSub: s2 }));
    reg('cannib-rolling', 'Rolling capture rate', 'cn-roll', 'National capture rate over the last 30, 90 and 365 days, with the calendar-year values.', [TECH, CONV], (c, s2) => ({ rollPct: c, rollSub: s2 }));
    reg('cannib-rolling-eur', 'Rolling captured price vs baseload', 'cn-roll-eur', '365-day captured price against the 365-day baseload: the gap is the shape discount in €/MWh.', [TECH, CONV], c => ({ rollEur: c }));
    reg('cannib-profile', 'Daily production profile by month', 'cn-prof', 'Average MW by hour of the day, one line per month, last complete year (RTE).', [TECH], (c, s2) => ({ profNat: c, profNatSub: s2 }), { w: 6, h: 5 });
  }
  window.PKCannib = { render() { const p = pageP(); [['cannib-projection', 'cn-proj'], ['cannib-capacity', 'cn-capfit'], ['cannib-countries-years', 'cn-xcy'], ['cannib-countries', 'cn-xc'], ['cannib-hourly', 'cn-hc'], ['cannib-neghours', 'cn-negh'], ['cannib-rolling', 'cn-roll'], ['cannib-rolling-eur', 'cn-roll-eur'], ['cannib-profile', 'cn-prof'], ['cannib-penetration-years', 'cn-pen']].forEach(([w, c]) => PKW.get(w) && PKW.draw(w, c, p)); } };
  // the published average for the benchmark (scripts/ppa_daily.py): the four methods with their weights
  const avg4Of = o => { const it = [['build', o.ppaBuild], ['fpc', o.ppaFpc], ['wx', o.ppaWx], ['eu', o.ppaEu]].map(([k, x]) => ({ k, x })); return it.every(m => m.x != null && isFinite(m.x)) ? wmean(it, 'x', o.stAt || o.st) : null; };   // stAt: the state may be restored before this is read
  window.PKPpa = { compute: () => compute(), state: S, run, avg4Of };
})();
