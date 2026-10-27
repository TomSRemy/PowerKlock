// ════════════════════════════════════════════════════════════════════
// BESS · BOA pricer. Floor + upside, tolling, partial tolling or merchant offtake of a battery: what the developer
// is paid each year, the debt service cover (DSCR) and what is left to the offtaker. k€ per MW per year.
//   · Debt service is a proper annuity: DS = Debt × r(1+r)^n / ((1+r)^n − 1), Debt = CAPEX × LTV.
//   · DSCR = (developer payment − OPEX) / DS, tested year by year (1.20× needed every year).
//   · Floor adjusted = floor at COD × (1 − step-down)^year × (1 − degradation)^year.
// The revenue scenarios (aFRR, day-ahead + intraday, capacity mechanism) are assumptions the user sets; the check
// beside them is what the day-ahead market alone really paid over the last 12 months (data/history/bess_da.json).
// Layout: formulas, the verdict box, three tinted scenario cards, then settings on the left and the DSCR, five
// status tiles and the revenue chart on the right; the P&L, stack and comparison in tabs below, then a short guide.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const BOA_START = 2028, BASE = 10;
  const S = { struct: 'floor', scen: 'mid', tab: 'pnl' };
  // scenarios: red (low), blue (mid), amber (high); green only means "bankable"
  const COL = { low: '#ED6965', mid: '#7FC8F8', high: '#FBBF24' };
  const OK = '#4ADE80', WARN = '#FBBF24', BAD = '#ED6965';
  const TINT = { ok: 'rgba(74,222,128,.10)', warn: 'rgba(251,191,36,.12)', bad: 'rgba(237,105,101,.12)', info: 'rgba(127,200,248,.12)' };
  const SKEYS = ['afrr', 'fcr', 'mfrr', 'da', 'id', 'cap', 'turpe'];
  const SLABELS = ['aFRR', 'FCR', 'mFRR', 'DA arb.', 'Intraday', 'Cap. mech.', 'TURPE 7'];
  const SCOLORS = ['#7FC8F8', '#8D99AE', '#ED6965', '#FBBF24', '#F2A65A', '#A87DC4', '#C4A57B'];
  const fr = () => { try { return localStorage.getItem('pk-lang') !== 'en'; } catch (_) { return true; } };
  const T = (en, frs) => fr() ? frs : en;
  const SCEN = {
    low: { name: () => T('Low · bear', 'Bas · bear'), src: () => T('aFRR falls as fast as in Belgium', 'aFRR qui chute à la vitesse belge'), note: () => T('Batteries compress day-ahead spreads sooner.', 'Les batteries compriment plus tôt les spreads day-ahead.'), v: [50, 6, 56, 62, 10] },
    mid: { name: () => T('Mid · base', 'Central · base'), src: () => 'Clean Horizon S2 2025', note: () => T('Central case: aFRR falls to 10 k€ by 2037.', 'Cas central : l’aFRR descend à 10 k€ en 2037.'), v: [65, 10, 66, 74, 19] },
    high: { name: () => T('High · bull', 'Haut · bull'), src: () => T('slower battery build-out', 'déploiement des batteries plus lent'), note: () => T('Slower battery build-out and faster solar widen day-ahead spreads.', 'Moins de batteries et plus de solaire élargissent les spreads day-ahead.'), v: [80, 18, 74, 88, 24] },
  };
  const FIELDS = [['afrr-cod', () => T('aFRR at COD (2028)', 'aFRR au COD (2028)'), 20, 120, 1], ['afrr-end', () => T('aFRR in 2037', 'aFRR en 2037'), 3, 40, 1],
    ['da-cod', () => T('DA + intraday at COD', 'DA + intraday au COD'), 30, 90, 1], ['da-end', () => T('DA + intraday in 2037', 'DA + intraday en 2037'), 40, 110, 1], ['cap-end', () => T('Capacity mechanism 2037', 'Mécanisme de capacité 2037'), 0, 30, 1]];
  const PFX = { low: 'l', mid: 'm', high: 'h' };

  const ss = t => t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;
  const g = id => +$(id).value;
  const f1 = v => { const s = (+v).toFixed(1); return fr() ? s.replace('.', ',') : s; };
  const f2 = v => { const s = (+v).toFixed(2); return fr() ? s.replace('.', ',') : s; };
  const band = d => d >= 1.2 ? 'ok' : d >= 1.1 ? 'warn' : 'bad';
  const bandCol = d => ({ ok: OK, warn: WARN, bad: BAD })[band(d)];

  function row(id, label, min, max, step, val, unit, dec) {
    return '<div class="bess-row"><label for="' + id + '">' + label + '</label><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><span class="bess-val" id="' + id + '-d" data-u="' + unit + '" data-dec="' + (dec || 0) + '"></span></div>';
  }
  const pill = (attr, v, label, on, cls) => '<button type="button" class="boa-pill' + (cls ? ' ' + cls : '') + (on ? ' active' : '') + '" data-' + attr + '="' + v + '">' + label + '</button>';
  const tile = (id, label, sub) => '<div class="boa-tile" id="' + id + '"><div class="boa-tile-l">' + label + '</div><div class="boa-tile-v" id="' + id + '-v">–</div><div class="boa-tile-s">' + sub + '</div></div>';

  function html() {
    const formulas = '<details class="boa-formulas"><summary>' + T('Formulas and method', 'Formules et méthode') + '</summary><div class="boa-f3">' +
      '<div><b>' + T('Debt service, a proper annuity', 'Service de la dette, une vraie annuité') + '</b><code>DS = Debt × r(1+r)ⁿ ÷ [(1+r)ⁿ − 1]</code>' + T('Debt = CAPEX × LTV, r = rate, n = tenor. Not the shortcut (rate + 1/n), which overstates it by about 15%.', 'Dette = CAPEX × LTV, r = taux, n = maturité. Pas le raccourci (taux + 1/n), qui le surestime d’environ 15 %.') + '</div>' +
      '<div><b>' + T('DSCR, year by year', 'DSCR, année par année') + '</b><code>DSCR = (' + T('Dev. payment', 'Paiement dév.') + ' − OPEX) ÷ DS</code>' + T('≥ 1.20× every year, not on average. 1.10 to 1.20×: cash sweep. Under 1.0×: event of default.', '≥ 1,20× chaque année, pas en moyenne. 1,10 à 1,20× : cash sweep. Sous 1,0× : défaut.') + '</div>' +
      '<div><b>' + T('Floor adjusted and payment', 'Floor ajusté et paiement') + '</b><code>Fl = floor<sub>COD</sub> × (1−step)<sup>yr</sup> × (1−deg)<sup>yr</sup></code>' + T('Dev. payment = max(Fl, Fl + share × max(market × capacity − Fl, 0)). Offtaker = (1 − share) × the same upside.', 'Paiement dév. = max(Fl, Fl + part × max(marché × capacité − Fl, 0)). Acheteur = (1 − part) × le même upside.') + '</div>' +
      '</div></details>';
    const scen = ['low', 'mid', 'high'].map(k => '<div class="boa-scen boa-scen-' + k + '"><div class="boa-sec">' + SCEN[k].name() + ' <span class="boa-src">(' + SCEN[k].src() + ')</span></div>' +
      FIELDS.map(([f, l, mn, mx, st], i) => row('boa-' + PFX[k] + '-' + f, l(), mn, mx, st, SCEN[k].v[i], 'k')).join('') + '<p class="boa-note">' + SCEN[k].note() + '</p>' + (k === 'mid' ? '<p class="boa-note boa-live" id="boa-live"></p>' : '') + '</div>').join('');
    const left = '<div class="boa-card">' +
      '<div class="boa-sec">' + T('Contract structure', 'Structure du contrat') + '</div>' +
      '<div class="boa-pills" id="boa-struct">' + pill('s', 'floor', 'Floor + upside ★', 1) + pill('s', 'toll', T('Full tolling', 'Tolling complet')) + pill('s', 'partial', T('Partial tolling', 'Tolling partiel')) + pill('s', 'merchant', 'Merchant') + '</div>' +
      '<div id="boa-sp">' +
      '<div id="r-floor">' + row('boa-floor', T('Floor at COD (k€/MW/yr)', 'Floor au COD (k€/MW/an)'), 30, 120, 1, 70, 'k') + '</div>' +
      '<div id="r-step">' + row('boa-step', T('Floor step-down (%/yr)', 'Baisse annuelle du floor (%/an)'), 0, 5, 0.5, 0, '%', 1) + '</div>' +
      '<div id="r-share">' + row('boa-share', T('Developer share of the upside (%)', 'Part de l’upside pour le développeur (%)'), 50, 95, 5, 70, '%') + '</div>' +
      '<div id="r-toll" hidden>' + row('boa-toll', T('Toll price (k€/MW/yr)', 'Prix du toll (k€/MW/an)'), 60, 120, 1, 87, 'k') + '</div>' +
      '<div id="r-pfrac" hidden>' + row('boa-pfrac', T('Tolled fraction (%)', 'Part sous toll (%)'), 20, 80, 5, 60, '%') + '</div></div>' +
      '<div class="boa-div"></div><div class="boa-sec">' + T('Financing · optimistic defaults', 'Financement · valeurs par défaut optimistes') + '</div>' +
      row('boa-capex', 'CAPEX (k€/MW)', 600, 1000, 10, 750, 'k') + row('boa-opex', T('OPEX (k€/MW/yr)', 'OPEX (k€/MW/an)'), 8, 25, 1, 12, 'k') + row('boa-ltv', T('Gearing, LTV (%)', 'Gearing, LTV (%)'), 40, 85, 5, 70, '%') +
      row('boa-rate', T('Debt rate (%)', 'Taux de la dette (%)'), 3, 8, 0.25, 5, '%', 2) + row('boa-tenor', T('Debt tenor (years)', 'Maturité de la dette (années)'), 5, 15, 1, 10, 'yrs') + row('boa-deg', T('Degradation (%/yr)', 'Dégradation (%/an)'), 1, 4, 0.5, 2, '%', 1) +
      '<div class="boa-div"></div><div class="boa-sec">' + T('Scenario shown', 'Scénario affiché') + '</div>' +
      '<div class="boa-pills" id="boa-scen">' + pill('c', 'mid', T('Mid (base)', 'Central (base)'), 1, 'is-mid') + pill('c', 'low', T('Low (bear)', 'Bas (bear)'), 0, 'is-low') + pill('c', 'high', T('High (bull)', 'Haut (bull)'), 0, 'is-high') + pill('c', 'all', T('All three', 'Les trois')) + '</div>' +
      '<p class="boa-note">' + T('Charts and tables follow the scenario shown. CAPEX: lower bound of an HTB2 French project (Capstone DC, November 2025); check it against current quotes.', 'Graphiques et tableaux suivent le scénario affiché. CAPEX : borne basse d’un projet HTB2 en France (Capstone DC, novembre 2025) ; à comparer aux devis actuels.') + '</p></div>';
    const right = '<div class="boa-card">' +
      '<div class="boa-sec">' + T('DSCR year by year over the contract', 'DSCR année par année sur la durée du contrat') + '</div>' +
      '<div class="boa-legend"><span><i style="background:' + OK + '"></i>' + T('≥ 1.20× bankable', '≥ 1,20× finançable') + '</span><span><i style="background:' + WARN + '"></i>' + T('1.10–1.20× cash sweep', '1,10–1,20× cash sweep') + '</span><span><i style="background:' + BAD + '"></i>' + T('< 1.10× restricted or default', '< 1,10× bloqué ou défaut') + '</span></div>' +
      '<div style="position:relative;height:220px"><canvas id="boa-dscr" style="width:100%;height:220px"></canvas></div>' +
      '<div class="boa-tiles">' + tile('boa-t-ds', T('Debt service', 'Service de la dette'), T('k€/MW/yr · annuity', 'k€/MW/an · annuité')) + tile('boa-t-min', T('Minimum DSCR', 'DSCR minimum'), T('worst year · binding', 'pire année · contraignante')) +
      tile('boa-t-avg', T('Average DSCR', 'DSCR moyen'), T('for reference', 'pour mémoire')) + tile('boa-t-br', T('First year < 1.20×', 'Première année < 1,20×'), T('low scenario', 'scénario bas')) + tile('boa-t-m', T('Offtaker margin', 'Marge de l’acheteur'), T('average k€/MW/yr', 'moyenne k€/MW/an')) + '</div>' +
      '<div style="position:relative;height:170px"><canvas id="boa-rev" style="width:100%;height:170px"></canvas></div></div>';
    $('boa-in-root').innerHTML = formulas + '<div id="boa-best" class="boa-best"></div><div class="boa-scen-grid">' + scen + '</div><div class="boa-grid2">' + left + right + '</div>';
    const tabs = '<div class="boa-card"><div class="boa-tabs" id="boa-tabs">' + pill('t', 'pnl', T('P&L table', 'Tableau de P&L'), 1) + pill('t', 'stack', T('Revenue stack', 'Empilement des revenus')) + pill('t', 'compare', T('Structure comparison', 'Comparaison des structures')) + '</div>' +
      '<div id="boa-tab-pnl"><p class="boa-note">' + T('Scenario and structure shown. DSCR green ≥ 1.20, amber 1.10 to 1.20, red under 1.10.', 'Scénario et structure affichés. DSCR vert ≥ 1,20, ambre 1,10 à 1,20, rouge sous 1,10.') + '</p><div class="table-wrap" style="overflow-x:auto"><table class="data-table boa-table" id="boa-pnl"></table></div></div>' +
      '<div id="boa-tab-stack" hidden><div style="position:relative;height:260px"><canvas id="boa-stack" style="width:100%;height:260px"></canvas></div><div class="boa-legend">' + SLABELS.map((l, i) => '<span><i class="sq" style="background:' + SCOLORS[i] + '"></i>' + l + '</span>').join('') + '</div></div>' +
      '<div id="boa-tab-compare" hidden><p class="boa-note">' + T('Each structure with its own default terms, mid scenario, current financing. Full tolling is tested on a 7-year debt. Bankable = minimum DSCR ≥ 1.20× every year in the mid scenario.', 'Chaque structure avec ses paramètres par défaut, scénario central, financement actuel. Le tolling complet est testé sur une dette de 7 ans. Finançable = DSCR minimum ≥ 1,20× chaque année dans le scénario central.') + '</p><div class="table-wrap" style="overflow-x:auto"><table class="data-table boa-table" id="boa-cmp"></table></div></div></div>';
    const guide = '<div class="boa-guide"><b>' + T('How to use it', 'Comment s’en servir') + '</b><ol>' +
      '<li>' + T('Floor + upside by default: a flat floor of 70 k, check the DSCR stays ≥ 1.20× in the mid scenario.', 'Floor + upside par défaut : floor plat de 70 k, vérifier que le DSCR reste ≥ 1,20× en scénario central.') + '</li>' +
      '<li>' + T('Switch to the low scenario: the year the DSCR dips under 1.20× is where a reopener clause would bite.', 'Passer en scénario bas : l’année où le DSCR passe sous 1,20× est celle où une clause de révision jouerait.') + '</li>' +
      '<li>' + T('Full tolling at 87 k: the DSCR holds but the offtaker margin shrinks in the late years.', 'Tolling complet à 87 k : le DSCR tient mais la marge de l’acheteur fond en fin de contrat.') + '</li>' +
      '<li>' + T('Raise CAPEX to 800 k or the rate to 6 %: debt service rises and the minimum DSCR falls; financing assumptions matter as much as the market.', 'Monter le CAPEX à 800 k ou le taux à 6 % : le service de la dette monte et le DSCR minimum baisse ; les hypothèses de financement pèsent autant que le marché.') + '</li></ol></div>';
    $('boa-out-root').innerHTML = '<div class="kpi-strip fuel-kpis" id="boa-anchor"></div>' + tabs + guide +
      '<div class="fuel-note">' + T('Market scenarios are assumptions, not forecasts. Sources of the central case: Clean Horizon (aFRR trajectory, 2025), Capstone DC (CAPEX, November 2025).', 'Les scénarios de marché sont des hypothèses, pas des prévisions. Sources du cas central : Clean Horizon (trajectoire aFRR, 2025), Capstone DC (CAPEX, novembre 2025).') + '</div>';
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
  const SC = k => T(k, { low: 'bas', mid: 'central', high: 'haut' }[k]);

  // the verdict box: tinted by the answer, the reason in one sentence
  function best(s, p, ds, mid) {
    const R = rows(mid, p, ds, s), minD = Math.min(...R.map(r => r.dscr)), avg = R.reduce((a, r) => a + r.stk, 0) / R.length, ok = minD >= 1.2;
    const m = '<b style="color:' + bandCol(minD) + '">' + f2(minD) + '×</b>', dsv = '<b>' + f1(ds) + ' k</b>', mg = '<b style="color:' + (avg >= 0 ? OK : BAD) + '">' + f1(avg) + ' k</b>';
    let tone = ok ? 'ok' : 'bad', head, msg;
    if (s === 'floor') {
      head = ok ? T('✓ Floor + upside is bankable', '✓ Floor + upside finançable') : T('✗ Floor + upside is not bankable (mid scenario)', '✗ Floor + upside non finançable (scénario central)');
      msg = T(`floor ${p.floor} k, ${Math.round(p.sh * 100)}/${Math.round(100 - p.sh * 100)} split, ${Math.round(p.ltv * 100)}% gearing, ${f2(p.rate * 100)}% rate, ${p.tenor} years. Debt service ${dsv} · minimum DSCR ${m} · average offtaker margin ${mg}/MW/yr. `, `floor ${p.floor} k, partage ${Math.round(p.sh * 100)}/${Math.round(100 - p.sh * 100)}, gearing ${Math.round(p.ltv * 100)} %, taux ${f2(p.rate * 100)} %, ${p.tenor} ans. Service de la dette ${dsv} · DSCR minimum ${m} · marge moyenne de l’acheteur ${mg}/MW/an. `) +
        (ok ? T('A flat floor is enough: degradation already lowers the obligation.', 'Un floor plat suffit : la dégradation réduit déjà l’engagement.') : T('Raise the floor or lengthen the debt to reach 1.20×.', 'Relever le floor ou allonger la dette pour atteindre 1,20×.'));
    } else if (s === 'toll') {
      tone = ok && avg > 0 ? 'ok' : 'warn'; head = T('Full tolling', 'Tolling complet');
      msg = T(`toll ${p.toll} k, ${p.tenor} years. Debt service ${dsv} · minimum DSCR ${m} · average offtaker margin ${mg}. `, `toll ${p.toll} k, ${p.tenor} ans. Service de la dette ${dsv} · DSCR minimum ${m} · marge moyenne de l’acheteur ${mg}. `) +
        (ok ? T('The developer is bankable. ', 'Le développeur est finançable. ') : T('Not bankable: raise the toll. ', 'Non finançable : relever le toll. ')) + (avg > 0 ? '' : T('The offtaker margin is negative: toll too high or debt too long. ', 'La marge de l’acheteur est négative : toll trop haut ou dette trop longue. ')) + T('A debt of 7 years or less protects the offtaker margin in the late years.', 'Une dette de 7 ans ou moins protège la marge de l’acheteur en fin de contrat.');
    } else if (s === 'partial') {
      tone = ok ? 'info' : 'bad'; head = T(`Partial tolling (${Math.round(p.pf * 100)}% tolled)`, `Tolling partiel (${Math.round(p.pf * 100)} % sous toll)`);
      msg = T(`toll ${p.toll} k on the tolled share. Debt service ${dsv} · minimum DSCR ${m} · average offtaker margin ${mg}. `, `toll ${p.toll} k sur la part sous toll. Service de la dette ${dsv} · DSCR minimum ${m} · marge moyenne de l’acheteur ${mg}. `) +
        (ok ? T('Bankable: the lender counts the tolled share. ', 'Finançable : le prêteur retient la part sous toll. ') : T('Raise the toll or the tolled share. ', 'Relever le toll ou la part sous toll. ')) + T('The split needs two separate optimisation contracts.', 'Le partage demande deux contrats d’optimisation distincts.');
    } else {
      tone = 'bad'; head = T('✗ Merchant', '✗ Merchant');
      msg = T(`no guaranteed payment. Debt service ${dsv} · minimum DSCR ${m}. Lenders apply a 40 to 50% haircut to the revenues: not bankable at 1.20× with these terms. It would need gearing of 50% or less, a 15-year tenor or a 6-month debt service reserve at COD.`, `aucun paiement garanti. Service de la dette ${dsv} · DSCR minimum ${m}. Les prêteurs appliquent une décote de 40 à 50 % sur les revenus : non finançable à 1,20× avec ces paramètres. Il faudrait un gearing de 50 % ou moins, 15 ans de dette ou une réserve de 6 mois de service de la dette au COD.`);
    }
    const el = $('boa-best'); el.className = 'boa-best boa-' + tone; el.innerHTML = '<b class="boa-best-h">' + head + '</b> : ' + msg;
  }

  function setTile(id, value, tone) {
    const t = $(id), v = $(id + '-v'); if (!t || !v) return;
    v.textContent = value; t.className = 'boa-tile' + (tone ? ' boa-' + tone : '');
  }

  // the danger zone under 1.20×, painted behind the lines
  const zone = { id: 'boaZone', beforeDatasetsDraw(c) {
    const y = c.scales.y, a = c.chartArea; if (!y) return; const g2 = c.ctx, y12 = y.getPixelForValue(1.2), y11 = y.getPixelForValue(1.1);
    g2.save(); g2.fillStyle = 'rgba(237,105,101,.07)'; g2.fillRect(a.left, y11, a.right - a.left, a.bottom - y11);
    g2.fillStyle = 'rgba(251,191,36,.07)'; g2.fillRect(a.left, y12, a.right - a.left, y11 - y12); g2.restore(); } };

  function update() {
    if (!$('boa-in-root') || !$('boa-pnl')) return;
    document.querySelectorAll('#boa-in-root .bess-val').forEach(sp => {
      const v = g(sp.id.slice(0, -2)), d = +sp.dataset.dec; const u = sp.dataset.u;
      const n = fr() ? v.toFixed(d).replace('.', ',') : v.toFixed(d);
      sp.textContent = n + (u === '%' ? (fr() ? ' %' : '%') : u === 'k' ? ' k' : u === 'yrs' ? T(' yrs', ' ans') : ' ' + u);
    });
    const p = P(), n = p.tenor, ds = annuity(p), s = S.struct;
    const stacks = {};
    ['low', 'mid', 'high'].forEach(k => { stacks[k] = buildStack(...cfgOf(k), n); });
    const all = {}; ['low', 'mid', 'high'].forEach(k => { all[k] = rows(stacks[k], p, ds, s); });
    const act = S.scen === 'all' ? 'mid' : S.scen, R = all[act];
    const minD = Math.min(...R.map(r => r.dscr)), avgD = R.reduce((a, r) => a + r.dscr, 0) / n;
    const br = all.low.findIndex(r => r.dscr < 1.2), avgM = R.reduce((a, r) => a + r.stk, 0) / n;
    setTile('boa-t-ds', f1(ds) + ' k', null);
    setTile('boa-t-min', f2(minD) + '×', band(minD));
    setTile('boa-t-avg', f2(avgD) + '×', null);
    setTile('boa-t-br', br >= 0 ? String(BOA_START + br) : T('None', 'Aucune'), br >= 0 ? 'warn' : 'ok');
    setTile('boa-t-m', f1(avgM) + ' k', avgM >= 0 ? 'ok' : 'bad');
    best(s, p, ds, stacks.mid);

    const years = Array.from({ length: n }, (_, i) => String(BOA_START + i)), show = S.scen === 'all' ? ['low', 'mid', 'high'] : [S.scen];
    const dsd = show.map(k => ({ label: 'DSCR (' + SC(k) + ')', data: all[k].map(r => +r.dscr.toFixed(2)), borderColor: COL[k], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 4.5,
      pointBackgroundColor: all[k].map(r => bandCol(r.dscr)), pointBorderColor: all[k].map(r => bandCol(r.dscr)), tension: 0 }));
    dsd.push({ label: T('1.20× minimum', '1,20× minimum'), data: Array(n).fill(1.2), borderColor: BAD, borderWidth: 1.3, borderDash: [5, 3], pointRadius: 0, fill: false });
    dsd.push({ label: T('1.10× cash sweep', '1,10× cash sweep'), data: Array(n).fill(1.1), borderColor: WARN, borderWidth: 1, borderDash: [3, 3], pointRadius: 0, fill: false });
    _fuelChart('boa-dscr', { type: 'line', data: { labels: years, datasets: dsd }, plugins: [zone], options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('DSCR', { min: 0.5, max: 3, ticks: { color: '#7A93AB', font: { size: 10 }, callback: v => f1(v) + '×' } }) } }) }, 'bess-boa-dscr');
    const rv = [];
    show.forEach(k => {
      rv.push({ label: T('Market revenue', 'Revenu de marché') + ' (' + SC(k) + ')', data: all[k].map(r => +r.mkt.toFixed(1)), borderColor: COL[k], borderWidth: 1.4, borderDash: [4, 3], pointRadius: 0, tension: 0, fill: false });
      rv.push({ label: T('Developer payment', 'Paiement au développeur') + ' (' + SC(k) + ')', data: all[k].map(r => +r.dev.toFixed(1)), borderColor: COL[k], borderWidth: 2.4, pointRadius: 0, tension: 0, fill: false });
    });
    if (s === 'floor' || s === 'partial') rv.push({ label: T('Floor adjusted', 'Floor ajusté'), data: Array.from({ length: n }, (_, i) => +floorAdj(p, i).toFixed(1)), borderColor: '#C4A57B', borderWidth: 2, borderDash: [6, 3], pointRadius: 0, tension: 0, fill: false });
    _fuelChart('boa-rev', { type: 'line', data: { labels: years, datasets: rv }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis(T('k€/MW/yr', 'k€/MW/an'), { min: 30 }) } }) }, 'bess-boa-revenue');
    _fuelChart('boa-stack', { type: 'bar', data: { labels: years, datasets: SKEYS.map((k, i) => ({ label: SLABELS[i], data: stacks[act].slice(0, n).map(r => +r[k].toFixed(1)), backgroundColor: SCOLORS[i], borderWidth: 0, stack: 's' })) },
      options: _fuelOpts({ plugins: { legend: { display: false } }, scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis(SC(act) + ' · ' + T('k€/MW/yr', 'k€/MW/an'), { stacked: true }) } }) }, 'bess-boa-stack');

    const chip = d => '<span class="boa-chip boa-' + band(d) + '">' + f2(d) + '×</span>';
    $('boa-pnl').innerHTML = '<thead><tr><th>' + T('Year', 'Année') + '</th><th>' + T('Market revenue', 'Revenu de marché') + '</th><th>' + T('Capacity left', 'Capacité restante') + '</th><th>' + T('Floor adjusted', 'Floor ajusté') + '</th><th>' + T('Developer payment', 'Paiement au développeur') + '</th><th>OPEX</th><th>EBITDA</th><th>' + T('Debt service', 'Service de la dette') + '</th><th>DSCR</th><th>' + T('Offtaker margin', 'Marge de l’acheteur') + '</th></tr></thead><tbody>' +
      R.map((r, i) => '<tr><td>' + (BOA_START + i) + '</td><td class="c-mkt">' + f1(r.mkt) + '</td><td class="c-mut">' + f1(Math.pow(1 - p.deg, i) * 100) + ' %</td><td class="c-fl">' + (r.fl == null ? '–' : f1(r.fl)) + '</td><td><b>' + f1(r.dev) + '</b></td><td class="c-mut">' + p.opex + '</td><td>' + f1(r.ebitda) +
        '</td><td class="c-mut">' + f1(ds) + '</td><td>' + chip(r.dscr) + '</td><td style="font-weight:600;color:' + (r.stk >= 0 ? OK : BAD) + '">' + f1(r.stk) + '</td></tr>').join('') + '</tbody>';

    const defs = [['floor', 'Floor + upside ★', { floor: 70, step: 0, sh: 0.7 }, T('Floor 70 k, no step-down, 70/30', 'Floor 70 k, sans baisse, 70/30')], ['toll', T('Full tolling (7-year debt)', 'Tolling complet (dette de 7 ans)'), { toll: 87, tenor: Math.min(n, 7) }, 'Toll 87 k'],
      ['partial', T('Partial tolling (60%)', 'Tolling partiel (60 %)'), { toll: 90, pf: 0.6 }, T('Toll 90 k on 60%', 'Toll 90 k sur 60 %')], ['merchant', 'Merchant', {}, T('No guarantee', 'Aucune garantie')]];
    $('boa-cmp').innerHTML = '<thead><tr><th>Structure</th><th>' + T('Terms', 'Paramètres') + '</th><th>' + T('Debt service', 'Service de la dette') + '</th><th>' + T('Minimum DSCR (mid)', 'DSCR minimum (central)') + '</th><th>' + T('Minimum DSCR (low)', 'DSCR minimum (bas)') + '</th><th>' + T('Offtaker margin (mid)', 'Marge de l’acheteur (central)') + '</th><th>' + T('Bankable', 'Finançable') + '</th></tr></thead><tbody>' +
      defs.map(([k, l, o, t]) => {
        const q = Object.assign({}, p, o), d2 = annuity(q), rm = rows(stacks.mid, q, d2, k), rl = rows(stacks.low, q, d2, k);
        const a = Math.min(...rm.map(r => r.dscr)), b = Math.min(...rl.map(r => r.dscr)), m = rm.reduce((x, r) => x + r.stk, 0) / rm.length;
        return '<tr><td><b>' + l + '</b></td><td class="c-mut">' + t + '</td><td>' + f1(d2) + '</td><td>' + chip(a) + '</td><td style="font-weight:600;color:' + bandCol(b) + '">' + f2(b) + '×</td><td style="font-weight:600;color:' + (m >= 0 ? OK : BAD) + '">' + f1(m) + ' k</td><td style="font-weight:600;color:' + (a >= 1.2 ? OK : BAD) + '">' + (a >= 1.2 ? T('Yes', 'Oui') : T('No', 'Non')) + '</td></tr>';
      }).join('') + '</tbody>';
    anchor();
  }

  function anchor() {
    PKBess.load().then(doc => {
      const el = $('boa-anchor'); if (!el || !doc) return;
      const L = doc.summary_ltm['2h'], daMid = g('boa-m-da-cod');
      el.innerHTML = _fuelKpi(T('Day-ahead alone, last 12 months', 'Day-ahead seul, 12 derniers mois'), f1(L.pw), T('k€/MW/yr', 'k€/MW/an'), T('2 h battery · perfect schedule · net of wear', 'batterie 2 h · programme parfait · net d’usure')) +
        _fuelKpi(T('Day-ahead alone, no foresight', 'Day-ahead seul, sans anticipation'), f1(L.nv), T('k€/MW/yr', 'k€/MW/an'), T('2 h battery · fixed schedule', 'batterie 2 h · programme fixe')) +
        _fuelKpi(T('Mid scenario: DA + intraday at COD', 'Scénario central : DA + intraday au COD'), f1(daMid), T('k€/MW/yr', 'k€/MW/an'), T('from the assumptions above', 'd’après les hypothèses ci-dessus'));
    });
  }

  function setup() {
    const root = $('page-boa'); if (!root || root.dataset.boa) return; root.dataset.boa = '1';
    html();
    root.addEventListener('input', e => { if (e.target.closest('#boa-in-root')) update(); });
    const bind = (gid, attr, key) => $(gid).addEventListener('click', e => {
      const b = e.target.closest('button[data-' + attr + ']'); if (!b) return;
      $(gid).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      S[key] = b.dataset[attr]; if (key === 'struct') defaults(); update();
    });
    bind('boa-struct', 's', 'struct'); bind('boa-scen', 'c', 'scen');
    root.addEventListener('input', e => { if (/^boa-[lmh]-da-cod$/.test(e.target.id)) root.dataset.daTouched = '1'; }, true);
    live();
    $('boa-tabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-t]'); if (!b) return;
      $('boa-tabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      ['pnl', 'stack', 'compare'].forEach(t => { $('boa-tab-' + t).hidden = t !== b.dataset.t; });
      if (b.dataset.t === 'stack') update();
    });
    update();
  }
  // the day-ahead part of the scenarios starts from what the market really paid: the 2 h battery, perfect schedule
  // net of wear, last 12 months (data/history/bess_da.json, recomputed every day); low and high keep their gap
  // to the central case (0.85× and 1.12×, the ratios of the reference assumptions). Intraday, reserves and the
  // trajectories to 2037 stay assumptions.
  function live() {
    PKBess.load().then(doc => {
      const L = doc && doc.summary_ltm && doc.summary_ltm['2h']; if (!L || L.pw == null) return;
      const root = $('page-boa'), mid = Math.round(L.pw), when = doc.last ? new Date(doc.last + 'T12:00:00Z').toLocaleDateString(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
      if (!root.dataset.daTouched) {
        [['m', mid], ['l', Math.round(mid * 0.85)], ['h', Math.round(mid * 1.12)]].forEach(([k, v]) => { const el = $('boa-' + k + '-da-cod'); if (el) el.value = Math.max(+el.min, Math.min(+el.max, v)); });
        update();
      }
      $('boa-live').innerHTML = T(`<b>Live:</b> “DA + intraday at COD” starts from the day-ahead the market really paid a 2 h battery over 12 months, <b>${mid} k€/MW/yr</b> (net of wear, to ${when}); low and high keep their gap. Intraday, reserves and the 2037 values remain assumptions.`,
        `<b>Données réelles :</b> « DA + intraday au COD » part du day-ahead réellement payé à une batterie 2 h sur 12 mois, <b>${mid} k€/MW/an</b> (net d’usure, au ${when}) ; bas et haut gardent leur écart. Intraday, réserves et valeurs 2037 restent des hypothèses.`);
      const u = $('boa-upd'); if (u) u.textContent = T('Day-ahead updated ', 'Day-ahead à jour au ') + when;
    });
  }
  function defaults() {
    const s = S.struct;
    $('boa-sp').hidden = s === 'merchant';
    $('r-floor').hidden = $('r-step').hidden = !(s === 'floor' || s === 'partial');
    $('r-share').hidden = s !== 'floor'; $('r-toll').hidden = !(s === 'toll' || s === 'partial'); $('r-pfrac').hidden = s !== 'partial';
    $('boa-floor').value = 70; $('boa-step').value = 0; $('boa-share').value = 70; $('boa-toll').value = s === 'partial' ? 90 : 87; $('boa-pfrac').value = 60;
  }
  if (window.PK && PK.onPage) PK.onPage('boa', () => setTimeout(setup, 0));
})();
