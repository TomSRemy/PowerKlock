// ════════════════════════════════════════════════════════════════════
// BESS · BOA pricer. Floor + upside, tolling, partial tolling or merchant offtake of a battery: what the developer
// is paid each year, the debt service cover (DSCR) and what is left to the offtaker. k€ per MW per year.
//   · Debt service is a proper annuity: DS = Debt × r(1+r)^n / ((1+r)^n − 1), Debt = CAPEX × LTV.
//   · DSCR = (developer payment − OPEX) / DS, tested year by year (1.20× needed every year).
//   · Floor adjusted = floor at COD × (1 − step-down)^year × (1 − degradation)^year.
// The revenue scenarios (aFRR, day-ahead + intraday, capacity mechanism) are assumptions the user sets; the check
// beside them is what the day-ahead market alone really paid over the last 12 months (data/history/bess_da.json).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const BOA_START = 2028, BASE = 10;
  const S = { struct: 'floor', scen: 'mid', tab: 'pnl' };
  const COL = { low: '#ED6965', mid: '#14D3A9', high: '#7FC8F8' };
  const SKEYS = ['afrr', 'fcr', 'mfrr', 'da', 'id', 'cap', 'turpe'];
  const SLABELS = ['aFRR', 'FCR', 'mFRR', 'DA arb.', 'Intraday', 'Cap. mech.', 'TURPE 7'];
  const SCOLORS = ['#14D3A9', '#8D99AE', '#ED6965', '#FBBF24', '#7FC8F8', '#A87DC4', '#0FAC8A'];
  const SCEN = {
    low: { name: 'Low · bear', note: 'aFRR falls as fast as in Belgium. Batteries compress day-ahead spreads sooner.', v: [50, 6, 56, 62, 10] },
    mid: { name: 'Mid · base', note: 'Central case: aFRR falls to 10 k€ by 2037.', v: [65, 10, 66, 74, 19] },
    high: { name: 'High · bull', note: 'Slower battery build-out and faster solar widen day-ahead spreads.', v: [80, 18, 74, 88, 24] },
  };
  const FIELDS = [['afrr-cod', 'aFRR at COD (2028)', 20, 120, 1], ['afrr-end', 'aFRR in 2037', 3, 40, 1], ['da-cod', 'DA + intraday at COD', 30, 90, 1], ['da-end', 'DA + intraday in 2037', 40, 110, 1], ['cap-end', 'Capacity mechanism 2037', 0, 30, 1]];
  const PFX = { low: 'l', mid: 'm', high: 'h' };

  const ss = t => t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;
  const g = id => +$(id).value;
  const f1 = v => (+v).toFixed(1);

  function row(id, label, min, max, step, val, unit, dec) {
    return '<div class="bess-row"><label for="' + id + '">' + label + '</label><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><span class="bess-val" id="' + id + '-d" data-u="' + unit + '" data-dec="' + (dec || 0) + '"></span></div>';
  }
  function html() {
    const scen = ['low', 'mid', 'high'].map(k => '<div class="chart-container fuel-card bess-scen bess-scen-' + k + '"><div class="fuel-card-head"><div><div class="table-title">' + SCEN[k].name + '</div><div class="fuel-card-sub">' + SCEN[k].note + '</div></div></div>' +
      FIELDS.map(([f, l, mn, mx, st], i) => row('boa-' + PFX[k] + '-' + f, l, mn, mx, st, SCEN[k].v[i], 'k')).join('') + '</div>').join('');
    const btn = (attr, v, label, on) => '<button type="button" class="pk-gf-btn' + (on ? ' active' : '') + '" data-' + attr + '="' + v + '">' + label + '</button>';
    const cfg = '<div class="fuel-grid-2 pk-stack">' +
      '<div class="chart-container fuel-card"><div class="fuel-card-head"><div><div class="table-title">Contract structure</div><div class="fuel-card-sub">What the developer receives from the offtaker</div></div></div>' +
      '<div class="pk-gf-group" id="boa-struct">' + btn('s', 'floor', 'Floor + upside', 1) + btn('s', 'toll', 'Full tolling') + btn('s', 'partial', 'Partial tolling') + btn('s', 'merchant', 'Merchant') + '</div>' +
      '<div id="boa-sp">' +
      '<div id="r-floor">' + row('boa-floor', 'Floor at COD (k€/MW/yr)', 30, 120, 1, 70, 'k') + '</div>' +
      '<div id="r-step">' + row('boa-step', 'Floor step-down (%/yr)', 0, 5, 0.5, 0, '%', 1) + '</div>' +
      '<div id="r-share">' + row('boa-share', 'Developer share of the upside (%)', 50, 95, 5, 70, '%') + '</div>' +
      '<div id="r-toll" hidden>' + row('boa-toll', 'Toll price (k€/MW/yr)', 60, 120, 1, 87, 'k') + '</div>' +
      '<div id="r-pfrac" hidden>' + row('boa-pfrac', 'Tolled fraction (%)', 20, 80, 5, 60, '%') + '</div></div>' +
      '<div class="table-title" style="margin-top:14px">Scenario shown</div>' +
      '<div class="pk-gf-group" id="boa-scen">' + btn('c', 'mid', 'Mid (base)', 1) + btn('c', 'low', 'Low (bear)') + btn('c', 'high', 'High (bull)') + btn('c', 'all', 'All three') + '</div></div>' +
      '<div class="chart-container fuel-card"><div class="fuel-card-head"><div><div class="table-title">Financing</div><div class="fuel-card-sub">Optimistic defaults: change them to see where the structure breaks</div></div></div>' +
      row('boa-capex', 'CAPEX (k€/MW)', 600, 1000, 10, 750, 'k') + row('boa-opex', 'OPEX (k€/MW/yr)', 8, 25, 1, 12, 'k') + row('boa-ltv', 'Gearing, LTV (%)', 40, 85, 5, 70, '%') +
      row('boa-rate', 'Debt rate (%)', 3, 8, 0.25, 5, '%', 2) + row('boa-tenor', 'Debt tenor (years)', 5, 15, 1, 10, 'yrs') + row('boa-deg', 'Degradation (%/yr)', 1, 4, 0.5, 2, '%', 1) +
      '<div class="fuel-note">CAPEX: lower bound of an HTB2 French project (Capstone DC, November 2025). Check it against current quotes.</div></div></div>';
    $('boa-in-root').innerHTML = '<div class="bess-scen-grid">' + scen + '</div>' + cfg;
    $('boa-out-root').innerHTML =
      '<div class="kpi-strip fuel-kpis" id="boa-anchor"></div>' +
      '<div id="boa-best" class="bess-best"></div>' +
      '<div class="fuel-grid-2 pk-stack">' +
      '<div class="chart-container fuel-card"><div class="fuel-card-head"><div><div class="table-title">DSCR year by year</div><div class="fuel-card-sub">1.20× needed every year · 1.10 to 1.20× cash sweep · under 1.10× restricted</div></div></div><div style="position:relative;height:250px"><canvas id="boa-dscr" style="width:100%;height:250px"></canvas></div></div>' +
      '<div class="chart-container fuel-card"><div class="fuel-card-head"><div><div class="table-title">Market revenue and developer payment</div><div class="fuel-card-sub">k€ per MW per year</div></div></div><div style="position:relative;height:250px"><canvas id="boa-rev" style="width:100%;height:250px"></canvas></div></div></div>' +
      '<div class="kpi-strip fuel-kpis" id="boa-kpis"></div>' +
      '<div class="chart-container fuel-card"><div class="pk-gf-group" id="boa-tabs" style="margin-bottom:10px">' + btn('t', 'pnl', 'P&L table', 1) + btn('t', 'stack', 'Revenue stack') + btn('t', 'compare', 'Structure comparison') + '</div>' +
      '<div id="boa-tab-pnl"><div class="table-wrap" style="overflow-x:auto"><table class="data-table" id="boa-pnl"></table></div></div>' +
      '<div id="boa-tab-stack" hidden><div style="position:relative;height:260px"><canvas id="boa-stack" style="width:100%;height:260px"></canvas></div></div>' +
      '<div id="boa-tab-compare" hidden><div class="fuel-note" style="margin-bottom:8px">Each structure with its own default terms, mid scenario, current financing. Full tolling is tested on a 7-year debt.</div><div class="table-wrap" style="overflow-x:auto"><table class="data-table" id="boa-cmp"></table></div></div></div>' +
      '<div class="fuel-note">Debt service is an annuity, not the shortcut (rate + 1/n), which overstates it by about 15%. Developer payment = floor adjusted + share × max(market × capacity left − floor adjusted, 0). Offtaker margin = (1 − share) × the same upside. Market scenarios are assumptions, not forecasts. Sources of the central case: Clean Horizon (aFRR trajectory, 2025), Capstone DC (CAPEX, November 2025).</div>';
  }

  function buildStack(ac, ae, dc, de, ce, n) {
    return Array.from({ length: n }, (_, i) => {
      const ic = Math.min(i, BASE - 1), t = ic / (BASE - 1), ts = ss(t);
      const afrr = lerp(ac, ae, ts), daid = lerp(dc, de, Math.pow(t, 0.7));
      const da = daid * 0.6, id = daid * 0.4, fcr = lerp(9, 4, t), mfrr = lerp(14, 13, t);
      const cap = ic < 2 ? 0 : lerp(0, ce, ss((ic - 2) / Math.max(BASE - 3, 1)));
      const turpe = ic < 1 ? 0 : 4;
      // years 11 to 15: straight line from the slope of the last modelled years
      const ex = Math.max(i - 9, 0), t8 = ss(7 / (BASE - 1));
      const sa = ((lerp(ac, ae, 1) - lerp(ac, ae, t8)) / 2) * 0.7, sd = ((lerp(dc, de, 1) - lerp(dc, de, t8)) / 2) * 0.4;
      const Af = ex ? Math.max(afrr + ex * sa, 1) : afrr, Fc = ex ? Math.max(fcr - ex * 0.25, 1.5) : fcr, Mf = ex ? Math.max(mfrr - ex * 0.2, 8) : mfrr;
      const Da = ex ? Math.max(da + ex * sd * 0.6, 18) : da, Id = ex ? Math.max(id + ex * sd * 0.4, 12) : id, Ca = ex ? Math.min(cap + ex, 30) : cap;
      const o = { afrr: Af, fcr: Fc, mfrr: Mf, da: Da, id: Id, cap: Ca, turpe };
      o.total = Af + Fc + Mf + Da + Id + Ca + turpe;
      return o;
    });
  }
  const cfgOf = k => FIELDS.map(([f]) => g('boa-' + PFX[k] + '-' + f));
  function P() {
    return { floor: g('boa-floor'), step: g('boa-step') / 100, sh: g('boa-share') / 100, toll: g('boa-toll'), pf: g('boa-pfrac') / 100,
      capex: g('boa-capex'), opex: g('boa-opex'), ltv: g('boa-ltv') / 100, rate: g('boa-rate') / 100, tenor: g('boa-tenor'), deg: g('boa-deg') / 100 };
  }
  function annuity(p) {
    const d = p.capex * p.ltv, r = p.rate, n = p.tenor;
    return d * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  }
  const floorAdj = (p, i) => p.floor * Math.pow(1 - p.step, i) * Math.pow(1 - p.deg, i);
  function pay(mkt, i, p, s) {
    const cap = Math.pow(1 - p.deg, i);
    if (s === 'toll') return p.toll * cap;
    if (s === 'merchant') return mkt * cap;
    if (s === 'partial') return p.toll * p.pf * cap + mkt * (1 - p.pf) * cap;
    const fl = floorAdj(p, i);
    return Math.max(fl, fl + p.sh * Math.max(mkt * cap - fl, 0));
  }
  function margin(mkt, dev, i, p, s) {
    const cap = Math.pow(1 - p.deg, i);
    if (s === 'merchant') return 0;
    if (s === 'toll' || s === 'partial') return mkt * cap - dev;
    return Math.max(mkt * cap - floorAdj(p, i), 0) * (1 - p.sh);
  }
  function rows(stack, p, ds, s) {
    return stack.slice(0, p.tenor).map((r, i) => {
      const dev = pay(r.total, i, p, s), e = dev - p.opex;
      return { mkt: r.total, dev, stk: margin(r.total, dev, i, p, s), ebitda: e, dscr: e / ds, fl: s === 'floor' || s === 'partial' ? floorAdj(p, i) : null };
    });
  }
  const tone = d => d >= 1.2 ? 'ok' : d >= 1.1 ? 'warn' : 'bad';
  const fr = () => { try { return localStorage.getItem('pk-lang') !== 'en'; } catch (_) { return true; } };
  const T = (en, frs) => fr() ? frs : en;
  const SC = k => T(k, { low: 'bas', mid: 'central', high: 'haut' }[k]);

  function best(s, p, ds, mid) {
    const R = rows(mid, p, ds, s), minD = Math.min(...R.map(r => r.dscr)), avg = R.reduce((a, r) => a + r.stk, 0) / R.length, ok = minD >= 1.2;
    const m = '<b>' + minD.toFixed(2) + '×</b>', dsv = '<b>' + f1(ds) + '</b>';
    let cls = ok ? 'ok' : 'bad', msg;
    if (s === 'floor') msg = T(
      (ok ? 'Floor + upside is bankable' : 'Floor + upside is not bankable (mid scenario)') + ': floor ' + p.floor + ' k, ' + Math.round(p.sh * 100) + '/' + Math.round(100 - p.sh * 100) + ' split, ' + Math.round(p.ltv * 100) + '% gearing, ' + (p.rate * 100).toFixed(2) + '% rate, ' + p.tenor + ' years. Debt service ' + dsv + ' k, minimum DSCR ' + m + ', average offtaker margin <b>' + f1(avg) + ' k</b>/MW/yr. ' + (ok ? 'A flat floor is enough: degradation already lowers the obligation.' : 'Raise the floor or lengthen the debt to reach 1.20×.'),
      (ok ? 'Floor + upside finançable' : 'Floor + upside non finançable (scénario central)') + ' : floor ' + p.floor + ' k, partage ' + Math.round(p.sh * 100) + '/' + Math.round(100 - p.sh * 100) + ', gearing ' + Math.round(p.ltv * 100) + ' %, taux ' + (p.rate * 100).toFixed(2) + ' %, ' + p.tenor + ' ans. Service de la dette ' + dsv + ' k, DSCR minimum ' + m + ', marge moyenne de l’acheteur <b>' + f1(avg) + ' k</b>/MW/an. ' + (ok ? 'Un floor plat suffit : la dégradation réduit déjà l’engagement.' : 'Relever le floor ou allonger la dette pour atteindre 1,20×.'));
    else if (s === 'toll') { cls = ok && avg > 0 ? 'ok' : 'warn'; msg = T(
      'Full tolling: toll ' + p.toll + ' k, ' + p.tenor + ' years. Debt service ' + dsv + ' k, minimum DSCR ' + m + ', average offtaker margin <b>' + f1(avg) + ' k</b>. ' + (ok ? 'The developer is bankable.' : 'Not bankable: raise the toll.') + (avg > 0 ? '' : ' The offtaker margin is negative: toll too high or debt too long.') + ' A debt of 7 years or less protects the offtaker margin in the late years.',
      'Tolling complet : toll ' + p.toll + ' k, ' + p.tenor + ' ans. Service de la dette ' + dsv + ' k, DSCR minimum ' + m + ', marge moyenne de l’acheteur <b>' + f1(avg) + ' k</b>. ' + (ok ? 'Le développeur est finançable.' : 'Non finançable : relever le toll.') + (avg > 0 ? '' : ' La marge de l’acheteur est négative : toll trop haut ou dette trop longue.') + ' Une dette de 7 ans ou moins protège la marge de l’acheteur en fin de période.'); }
    else if (s === 'partial') msg = T(
      'Partial tolling (' + Math.round(p.pf * 100) + '% tolled): toll ' + p.toll + ' k. Debt service ' + dsv + ' k, minimum DSCR ' + m + ', average offtaker margin <b>' + f1(avg) + ' k</b>. ' + (ok ? 'Bankable: the lender counts the tolled share.' : 'Raise the toll or the tolled share.') + ' Two separate optimisation contracts are needed for the split.',
      'Tolling partiel (' + Math.round(p.pf * 100) + ' % sous toll) : toll ' + p.toll + ' k. Service de la dette ' + dsv + ' k, DSCR minimum ' + m + ', marge moyenne de l’acheteur <b>' + f1(avg) + ' k</b>. ' + (ok ? 'Finançable : le prêteur retient la part sous toll.' : 'Relever le toll ou la part sous toll.') + ' Le partage demande deux contrats d’optimisation distincts.');
    else { cls = 'bad'; msg = T(
      'Merchant: no guaranteed payment. Debt service ' + dsv + ' k, minimum DSCR ' + m + '. Lenders apply a 40 to 50% haircut to the revenues. It is not bankable at 1.20× with these terms: it would need gearing of 50% or less, a tenor of 15 years or a 6-month debt service reserve at COD.',
      'Merchant : aucun paiement garanti. Service de la dette ' + dsv + ' k, DSCR minimum ' + m + '. Les prêteurs appliquent une décote de 40 à 50 % sur les revenus. Non finançable à 1,20× avec ces paramètres : il faudrait un gearing de 50 % ou moins, 15 ans de dette ou une réserve de 6 mois de service de la dette au COD.'); }
    const el = $('boa-best'); el.className = 'bess-best bess-' + cls; el.innerHTML = msg;
  }

  function update() {
    if (!$('boa-in-root') || !$('boa-pnl')) return;
    document.querySelectorAll('#boa-in-root .bess-val').forEach(sp => {
      const v = g(sp.id.slice(0, -2)), d = +sp.dataset.dec; const u = sp.dataset.u;
      sp.textContent = v.toFixed(d) + (u === '%' ? '%' : u === 'k' ? ' k' : u === 'yrs' ? T(' yrs', ' ans') : ' ' + u);
    });
    const p = P(), n = p.tenor, ds = annuity(p), s = S.struct;
    const stacks = {};
    ['low', 'mid', 'high'].forEach(k => { stacks[k] = buildStack(...cfgOf(k), n); });
    const all = {}; ['low', 'mid', 'high'].forEach(k => { all[k] = rows(stacks[k], p, ds, s); });
    const act = S.scen === 'all' ? 'mid' : S.scen, R = all[act];
    const minD = Math.min(...R.map(r => r.dscr)), avgD = R.reduce((a, r) => a + r.dscr, 0) / n;
    const br = all.low.findIndex(r => r.dscr < 1.2), avgM = R.reduce((a, r) => a + r.stk, 0) / n;
    $('boa-kpis').innerHTML =
      _fuelKpi('Debt service', f1(ds), 'k€/MW/yr', 'annuity · fixed') +
      _fuelKpi('Minimum DSCR', minD.toFixed(2), '×', 'worst year · the binding one', minD >= 1.2 ? 'up' : 'down') +
      _fuelKpi('Average DSCR', avgD.toFixed(2), '×', 'for reference') +
      _fuelKpi('First year under 1.20×', br >= 0 ? String(BOA_START + br) : 'None', '', 'low scenario', br >= 0 ? 'down' : 'up') +
      _fuelKpi('Offtaker margin', f1(avgM), 'k€/MW/yr', 'yearly average', avgM >= 0 ? 'up' : 'down');
    best(s, p, ds, stacks.mid);

    const years = Array.from({ length: n }, (_, i) => String(BOA_START + i)), show = S.scen === 'all' ? ['low', 'mid', 'high'] : [S.scen];
    const dsd = show.map(k => ({ label: 'DSCR (' + SC(k) + ')', data: all[k].map(r => +r.dscr.toFixed(2)), borderColor: COL[k], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 4,
      pointBackgroundColor: all[k].map(r => r.dscr >= 1.2 ? '#14D3A9' : r.dscr >= 1.1 ? '#FBBF24' : '#ED6965'), tension: 0 }));
    dsd.push({ label: '1.20× minimum', data: Array(n).fill(1.2), borderColor: '#ED6965', borderWidth: 1.3, borderDash: [5, 3], pointRadius: 0, fill: false });
    dsd.push({ label: '1.10× cash sweep', data: Array(n).fill(1.1), borderColor: '#FBBF24', borderWidth: 1, borderDash: [3, 3], pointRadius: 0, fill: false });
    _fuelChart('boa-dscr', { type: 'line', data: { labels: years, datasets: dsd }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('DSCR', { min: 0.5, max: 3, ticks: { color: '#7A93AB', font: { size: 10 }, callback: v => v.toFixed(1) + '×' } }) } }) }, 'bess-boa-dscr');
    const rv = [];
    show.forEach(k => {
      rv.push({ label: T('Market revenue', 'Revenu de marché') + ' (' + SC(k) + ')', data: all[k].map(r => +r.mkt.toFixed(1)), borderColor: COL[k], borderWidth: 1.4, borderDash: [4, 3], pointRadius: 0, tension: 0, fill: false });
      rv.push({ label: T('Developer payment', 'Paiement au développeur') + ' (' + SC(k) + ')', data: all[k].map(r => +r.dev.toFixed(1)), borderColor: COL[k], borderWidth: 2.4, pointRadius: 0, tension: 0, fill: false });
    });
    if (s === 'floor' || s === 'partial') rv.push({ label: 'Floor adjusted', data: Array.from({ length: n }, (_, i) => +floorAdj(p, i).toFixed(1)), borderColor: '#FBBF24', borderWidth: 2, borderDash: [6, 3], pointRadius: 0, tension: 0, fill: false });
    _fuelChart('boa-rev', { type: 'line', data: { labels: years, datasets: rv }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('k€/MW/yr', { min: 30 }) } }) }, 'bess-boa-revenue');
    _fuelChart('boa-stack', { type: 'bar', data: { labels: years, datasets: SKEYS.map((k, i) => ({ label: SLABELS[i], data: stacks[act].slice(0, n).map(r => +r[k].toFixed(1)), backgroundColor: SCOLORS[i], borderWidth: 0, stack: 's' })) },
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis('k€/MW/yr', { stacked: true }) } }) }, 'bess-boa-stack');

    $('boa-pnl').innerHTML = '<thead><tr><th>Year</th><th>Market revenue</th><th>Capacity left</th><th>Floor adjusted</th><th>Developer payment</th><th>OPEX</th><th>EBITDA</th><th>Debt service</th><th>DSCR</th><th>Offtaker margin</th></tr></thead><tbody>' +
      R.map((r, i) => '<tr><td>' + (BOA_START + i) + '</td><td>' + f1(r.mkt) + '</td><td>' + (Math.pow(1 - p.deg, i) * 100).toFixed(1) + '%</td><td>' + (r.fl == null ? '–' : f1(r.fl)) + '</td><td><b>' + f1(r.dev) + '</b></td><td>' + p.opex + '</td><td>' + f1(r.ebitda) +
        '</td><td>' + f1(ds) + '</td><td class="bess-' + tone(r.dscr) + '">' + r.dscr.toFixed(2) + '×</td><td class="' + (r.stk >= 0 ? 'bess-okt' : 'bess-badt') + '">' + f1(r.stk) + '</td></tr>').join('') + '</tbody>';

    const defs = [['floor', 'Floor + upside', { floor: 70, step: 0, sh: 0.7 }, 'Floor 70 k, no step-down, 70/30'], ['toll', 'Full tolling (7-year debt)', { toll: 87, tenor: Math.min(n, 7) }, 'Toll 87 k'],
      ['partial', 'Partial tolling (60%)', { toll: 90, pf: 0.6 }, 'Toll 90 k on 60%'], ['merchant', 'Merchant', {}, 'No guarantee']];
    $('boa-cmp').innerHTML = '<thead><tr><th>Structure</th><th>Terms</th><th>Debt service</th><th>Minimum DSCR (mid)</th><th>Minimum DSCR (low)</th><th>Offtaker margin (mid)</th><th>Bankable</th></tr></thead><tbody>' +
      defs.map(([k, l, o, t]) => {
        const q = Object.assign({}, p, o), d2 = annuity(q), rm = rows(stacks.mid, q, d2, k), rl = rows(stacks.low, q, d2, k);
        const a = Math.min(...rm.map(r => r.dscr)), b = Math.min(...rl.map(r => r.dscr)), m = rm.reduce((x, r) => x + r.stk, 0) / rm.length;
        return '<tr><td>' + l + '</td><td>' + t + '</td><td>' + f1(d2) + '</td><td class="bess-' + tone(a) + '">' + a.toFixed(2) + '×</td><td class="bess-' + tone(b) + 't">' + b.toFixed(2) + '×</td><td>' + f1(m) + '</td><td>' + (a >= 1.2 ? 'Yes' : 'No') + '</td></tr>';
      }).join('') + '</tbody>';
    anchor();
  }

  function anchor() {
    PKBess.load().then(doc => {
      const el = $('boa-anchor'); if (!el || !doc) return;
      const L = doc.summary_ltm['2h'], daMid = g('boa-m-da-cod');
      el.innerHTML = _fuelKpi('Day-ahead alone, last 12 months', f1(L.pw), 'k€/MW/yr', '2 h battery · perfect schedule · net of wear') +
        _fuelKpi('Day-ahead alone, no foresight', f1(L.nv), 'k€/MW/yr', '2 h battery · fixed schedule') +
        _fuelKpi('Mid scenario: DA + intraday at COD', f1(daMid), 'k€/MW/yr', 'from the assumptions above');
    });
  }

  function setup() {
    const root = $('page-bess'); if (!root || root.dataset.boa) return; root.dataset.boa = '1';
    html();
    root.addEventListener('input', e => { if (e.target.closest('#boa-in-root')) update(); });
    const bind = (gid, attr, key) => $(gid).addEventListener('click', e => {
      const b = e.target.closest('button[data-' + attr + ']'); if (!b) return;
      $(gid).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      S[key] = b.dataset[attr]; if (key === 'struct') defaults(); update();
    });
    bind('boa-struct', 's', 'struct'); bind('boa-scen', 'c', 'scen');
    $('boa-tabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-t]'); if (!b) return;
      $('boa-tabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      ['pnl', 'stack', 'compare'].forEach(t => { $('boa-tab-' + t).hidden = t !== b.dataset.t; });
      if (b.dataset.t === 'stack') update();
    });
    update();
  }
  function defaults() {
    const s = S.struct;
    $('boa-sp').hidden = s === 'merchant';
    $('r-floor').hidden = $('r-step').hidden = !(s === 'floor' || s === 'partial');
    $('r-share').hidden = s !== 'floor'; $('r-toll').hidden = !(s === 'toll' || s === 'partial'); $('r-pfrac').hidden = s !== 'partial';
    $('boa-floor').value = 70; $('boa-step').value = 0; $('boa-share').value = 70; $('boa-toll').value = s === 'partial' ? 90 : 87; $('boa-pfrac').value = 60;
  }
  if (window.PK && PK.onPage) PK.onPage('bess', () => setTimeout(setup, 0));
})();
