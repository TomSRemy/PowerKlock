// ════════════════════════════════════════════════════════════════════
// Market pages' tiles → their chart full size (js/pk-tilewin.js): day-ahead, negative prices, intraday spread,
// power forwards, fuels and carbon, gas forwards, spark and dark spreads, guarantees of origin.
// Each rule names the tile by its English label (or its id) and builds its series from the shared history files.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.PKTile) return;
  const { rule, data: D, T } = PKTile;
  const C = { a: '#14D3A9', b: '#7FC8F8', c: '#A87DC4', d: '#FBBF24', e: '#ED6965', f: '#C4A57B', g: '#B8C9D9' };
  const ZN = { FR: 'France', DE_LU: T('Allemagne', 'Germany') };
  const mean = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const roll = (pts, n) => pts.map((p, i) => [p[0], i + 1 >= Math.min(n, 5) ? mean(pts.slice(Math.max(0, i - n + 1), i + 1).map(x => x[1])) : null]);
  const eur = '€/MWh';

  // ── day-ahead (Markets › Spot) ──
  const spot = (z, extra) => async () => {
    const pts = await D.zone(z, 'avg');
    return Object.assign({ unit: eur, series: [[z, T('Base ', 'Baseload ') + (ZN[z] || z), C.a, 'y', true, pts], [z + 'roll', T('Moyenne 30 jours', '30-day average'), C.g, 'y', true, roll(pts, 30)]] }, extra || {});
  };
  rule('prices', c => c.id === 'kpicard-fr', async () => { const d = await spot('FR')(); d.series.push(['DE_LU', T('Base Allemagne', 'Baseload Germany'), C.d, 'y', false, await D.zone('DE_LU', 'avg')]); return d; });
  rule('prices', c => c.id === 'kpicard-de', async () => { const d = await spot('DE_LU')(); d.series.push(['FR', T('Base France', 'Baseload France'), C.b, 'y', false, await D.zone('FR', 'avg')]); return d; });
  rule('prices', c => c.id === 'kpicard-peak' || c.id === 'kpicard-offpeak', async c => {
    const pk = await D.zone('FR', 'peakAvg'), op = await D.zone('FR', 'offAvg'), peak = c.id === 'kpicard-peak';
    return { unit: eur, series: [[peak ? 'pk' : 'op', peak ? T('Pointe 8–20 h', 'Peak 8–20h') : T('Hors pointe', 'Off-peak'), C.a, 'y', true, peak ? pk : op], [peak ? 'op' : 'pk', peak ? T('Hors pointe', 'Off-peak') : T('Pointe 8–20 h', 'Peak 8–20h'), C.d, 'y', true, peak ? op : pk]] };
  });
  rule('prices', c => c.id === 'kpicard-avg', async () => ({ unit: eur, series: [['all', T('Moyenne des zones', 'Zones’ average'), C.a, 'y', true, await D.across(rs => mean(rs.map(r => r.avg)))], ['FR', T('Base France', 'Baseload France'), C.b, 'y', false, await D.zone('FR', 'avg')]] }));
  // the strip's Max / Min = the most expensive and the cheapest zone of the day (baseload)
  rule('prices', c => c.id === 'kpicard-max' || c.id === 'kpicard-min', async c => {
    const v = rs => rs.map(r => r.avg).filter(x => x != null), mx = await D.across(rs => v(rs).length > 3 ? Math.max(...v(rs)) : null), mn = await D.across(rs => v(rs).length > 3 ? Math.min(...v(rs)) : null), isMax = c.id === 'kpicard-max';
    return { unit: '€/MWh', series: [[isMax ? 'mx' : 'mn', isMax ? T('Zone la plus chère (base)', 'Most expensive zone (baseload)') : T('Zone la moins chère (base)', 'Cheapest zone (baseload)'), isMax ? C.e : C.b, 'y', true, isMax ? mx : mn],
      ['fr', T('Base France', 'Baseload France'), C.a, 'y', true, await D.zone('FR', 'avg')], [isMax ? 'mn' : 'mx', isMax ? T('Zone la moins chère', 'Cheapest zone') : T('Zone la plus chère', 'Most expensive zone'), isMax ? C.b : C.e, 'y', false, isMax ? mn : mx]] };
  });

  // cross-zone comparison strip
  const avgAcross = f => D.across(rs => { const v = rs.map(r => r.avg).filter(x => x != null); return v.length > 3 ? f(v, rs) : null; });
  rule('prices', c => c.id === 'cc-kpi-cheapest' || c.id === 'cc-kpi-priciest', async c => {
    const lo = await avgAcross(v => Math.min(...v)), hi = await avgAcross(v => Math.max(...v)), cheap = c.id === 'cc-kpi-cheapest';
    return { unit: eur, series: [['x', cheap ? T('Zone la moins chère (base)', 'Cheapest zone (baseload)') : T('Zone la plus chère (base)', 'Most expensive zone (baseload)'), cheap ? C.b : C.e, 'y', true, cheap ? lo : hi], ['fr', T('Base France', 'Baseload France'), C.a, 'y', true, await D.zone('FR', 'avg')]] };
  });
  rule('prices', c => c.id === 'cc-kpi-spread', async () => ({ unit: eur, pct: false, neutral: true, series: [['sp', T('Écart entre la zone la plus chère et la moins chère', 'Gap between the most expensive and the cheapest zone'), C.d, 'y', true, await avgAcross(v => Math.max(...v) - Math.min(...v))]] }));
  rule('prices', c => c.id === 'cc-kpi-frgap', async () => ({ unit: eur, pct: false, series: [['gap', T('France moins la zone la moins chère', 'France minus the cheapest zone'), C.a, 'y', true, await D.across(rs => { const f = rs.find(r => r.z === 'FR'), v = rs.map(r => r.avg).filter(x => x != null); return f && f.avg != null && v.length > 3 ? f.avg - Math.min(...v) : null; })]] }));

  // ── negative prices ──
  const hours = { unit: 'h', pct: false, dp: 1, neutral: true, yZero: true, range: '6M' };
  const negOf = z => async () => Object.assign({}, hours, { series: [[z, T('Heures à prix négatif, ', 'Negative-price hours, ') + (ZN[z] || z), C.b, 'y', true, await D.zone(z, 'negH'), 'bar'], [z + 'roll', T('Moyenne 30 jours', '30-day average'), C.d, 'y', true, roll(await D.zone(z, 'negH'), 30)]] });
  rule('prices', 'FR neg hours', negOf('FR'));
  rule('prices', 'DE neg hours', negOf('DE_LU'));
  rule('prices', 'Zones in negative', async () => Object.assign({}, hours, { unit: T('zones', 'zones'), dp: 0, series: [['n', T('Zones avec au moins un prix négatif', 'Zones with at least one negative price'), C.b, 'y', true, await D.across(rs => rs.filter(r => (r.negH || 0) > 0).length), 'bar']] }));
  rule('prices', 'Total neg hours', async () => Object.assign({}, hours, { series: [['t', T('Heures négatives, toutes zones', 'Negative hours, all zones'), C.b, 'y', true, await D.across(rs => rs.reduce((s, r) => s + (r.negH || 0), 0)), 'bar']] }));
  rule('prices', 'Most neg hours', async () => Object.assign({}, hours, { series: [['m', T('Zone la plus touchée, heures', 'Most affected zone, hours'), C.b, 'y', true, await D.across(rs => Math.max(...rs.map(r => r.negH || 0))), 'bar']] }));
  rule('prices', 'Deepest print', async () => ({ unit: eur, pct: false, series: [['d', T('Prix le plus bas du jour, toutes zones', 'Lowest price of the day, all zones'), C.b, 'y', true, await D.across(rs => Math.min(...rs.filter(r => r.min != null).map(r => r.min)))]] }));

  // ── intraday spread (the page's zone) ──
  rule('prices', c => !!c.closest('#hist-spread-stats'), async () => {
    const z = typeof getHistZone === 'function' ? getHistZone('spread') : 'FR', s = await D.summary();
    const pts = ((s && s.zones && s.zones[z]) || []).filter(r => r.max != null && r.min != null).map(r => [r.d, r.max - r.min]);
    return { unit: eur, pct: false, neutral: true, yZero: true, series: [['sp', T('Écart max − min du jour, ', 'Daily max − min spread, ') + (ZN[z] || z), C.a, 'y', true, pts, 'bar'], ['sproll', T('Moyenne 30 jours', '30-day average'), C.d, 'y', true, roll(pts, 30)]] };
  });

  // ── power forwards (Markets › Forwards): the three next calendar years of the country ──
  rule('prices', c => !!c.closest('#prfwd-kpi-strip'), async (c, lab) => {
    const cc = /France/.test(lab) ? 'FR' : /UK/.test(lab) ? 'UK' : /Germany/.test(lab) ? 'DE' : /Netherlands/.test(lab) ? 'NL' : null; if (!cc) return null;
    const ys = await D.cal(cc), cols = [C.a, C.b, C.c];
    return { unit: cc === 'UK' ? '£/MWh' : eur, route: null, series: ys.map((y, i) => ['cal' + y.y, 'Cal ' + y.y, cols[i], 'y', true, y.pts]) };
  });

  // ── fuels and carbon ──
  const sw = async () => { const [ttf, coal, fx] = await Promise.all([D.series('ttf'), D.series('coal'), D.series('eurusd')]); const c = D.asof(coal), f = D.asof(fx);
    return window.PKC ? ttf.map(([d, v]) => [d, PKC.switchPrice(v, c(d), f(d))]).filter(p => p[1] != null) : []; };
  const one = (key, name, col, unit, more) => async () => Object.assign({ unit, series: [[key, name, col, 'y', true, await D.series(key)]] }, more ? await more() : {});
  rule('eua', /^EUA Dec-\d\d$/, async () => { const d = await one('eua', 'EUA', C.c, '€/t')(); d.series.push(['sw', T('Prix de bascule charbon → gaz, €/t', 'Coal → gas switch price, €/t'), C.f, 'y', false, await sw()]); return d; });
  rule('euafwd', /^EUA Dec-\d\d$/, one('eua', 'EUA', C.c, '€/t'));
  const ttfDa = async () => ({ unit: eur, unit2: '%', series: [['ttf', 'TTF day-ahead', C.d, 'y', true, await D.series('ttf')], ['agsi', T('Stocks de gaz UE, % (axe droit)', 'EU gas storage, % (right axis)'), C.b, 'y2', false, await D.series('agsi')]] });
  rule('eua', 'TTF day-ahead', ttfDa);
  rule('euafwd', 'TTF day-ahead', ttfDa);
  rule('eua', /^API2 coal/, one('coal', T('Charbon API2', 'Coal API2'), C.f, '$/t'));
  rule('eua', /^Brent/, one('brent', 'Brent', C.e, '$/b'));
  rule('eua', 'EU gas storage', async () => {
    const st = await D.series('agsi'), by = new Map(st.map(p => [p[0], p[1]]));
    // the same calendar day, average of the five previous years
    const avg5 = st.map(([d]) => { const y = +d.slice(0, 4), v = [1, 2, 3, 4, 5].map(k => by.get((y - k) + d.slice(4))).filter(x => x != null); return [d, v.length >= 3 ? mean(v) : null]; });
    return { unit: '%', pct: false, dp: 1, inv: true, series: [['agsi', T('Stocks de gaz UE', 'EU gas storage'), C.b, 'y', true, st], ['avg5', T('Moyenne des 5 années précédentes', 'Average of the 5 previous years'), C.g, 'y', true, avg5]] };
  });
  const switchDef = async () => ({ unit: '€/t', series: [['sw', T('Prix de bascule charbon → gaz', 'Coal → gas switch price'), C.f, 'y', true, await sw()], ['eua', T('EUA (sous la bascule, le charbon passe devant le gaz)', 'EUA (below the switch, coal runs before gas)'), C.c, 'y', true, await D.series('eua')]] });
  rule('eua', /^Coal.gas switch$/, switchDef);
  rule('spark', /^Coal.gas switch$/, switchDef);
  rule('euafwd', /^TTF Cal-\d\d$/, async () => {
    const c = await D.cs(), cy = (c && c.calYears && c.calYears.ttf) || {}, cols = [C.d, C.f, C.c];
    return { unit: eur, series: Object.keys(cy).sort().map((y, i) => ['ttf' + y, 'TTF Cal ' + y, cols[i] || C.g, 'y', true, cy[y].dates.map((d, k) => [d, cy[y].values[k]])]) };
  });

  // ── spark and dark spreads: the day-ahead baseload against the gas (or coal) plant's fuel and carbon cost ──
  const css = async z => { const [p, ttf, eua] = await Promise.all([D.zone(z, 'avg'), D.series('ttf'), D.series('eua')]); const t = D.asof(ttf), e = D.asof(eua);
    return window.PKC ? p.map(([d, v]) => [d, PKC.cleanSpark(v, t(d), e(d))]).filter(x => x[1] != null) : []; };
  const cds = async z => { const [p, coal, fx, eua] = await Promise.all([D.zone(z, 'avg'), D.series('coal'), D.series('eurusd'), D.series('eua')]); const c = D.asof(coal), f = D.asof(fx), e = D.asof(eua);
    return window.PKC ? p.map(([d, v]) => [d, PKC.cleanDark(v, c(d), f(d), e(d))]).filter(x => x[1] != null) : []; };
  const margin = { unit: eur, pct: false };
  rule('spark', 'FR CSS base', async () => Object.assign({}, margin, { series: [['fr', T('Clean spark France, base', 'Clean spark France, baseload'), C.a, 'y', true, await css('FR')], ['de', T('Clean spark Allemagne', 'Clean spark Germany'), C.d, 'y', false, await css('DE_LU')]] }));
  rule('spark', 'DE CSS base', async () => Object.assign({}, margin, { series: [['de', T('Clean spark Allemagne, base', 'Clean spark Germany, baseload'), C.d, 'y', true, await css('DE_LU')], ['fr', T('Clean spark France', 'Clean spark France'), C.a, 'y', false, await css('FR')]] }));
  rule('spark', 'DE CDS base', async () => Object.assign({}, margin, { series: [['cds', T('Clean dark Allemagne, base', 'Clean dark Germany, baseload'), C.f, 'y', true, await cds('DE_LU')], ['css', T('Clean spark Allemagne', 'Clean spark Germany'), C.d, 'y', false, await css('DE_LU')]] }));
  rule('spark', /^Gas \+ CO₂ cost$/, async () => { const [ttf, eua] = await Promise.all([D.series('ttf'), D.series('eua')]); const e = D.asof(eua);
    const cost = window.PKC ? ttf.map(([d, v]) => [d, e(d) != null ? PKC.gasCost(v) + e(d) * PKC.FUEL.gasCO2 : null]).filter(p => p[1] != null) : [];
    return { unit: eur, series: [['cost', T('Coût combustible + CO₂ d’une centrale gaz', 'Fuel + CO₂ cost of a gas plant'), C.e, 'y', true, cost], ['fr', T('Base France', 'Baseload France'), C.a, 'y', true, await D.zone('FR', 'avg')]] }; });
  rule('spark', /^Zones CSS > 0$/, async () => {
    const [ttf, eua] = await Promise.all([D.series('ttf'), D.series('eua')]); const t = D.asof(ttf), e = D.asof(eua);
    return { unit: T('zones', 'zones'), pct: false, dp: 0, neutral: true, yZero: true, series: [['n', T('Zones où la centrale gaz gagne de l’argent en base', 'Zones where a gas plant earns money at baseload'), C.a, 'y', true,
      await D.across(rs => { const d = rs[0].d; return window.PKC && t(d) != null && e(d) != null ? rs.filter(r => r.avg != null && PKC.cleanSpark(r.avg, t(d), e(d)) > 0).length : null; }), 'bar']] };
  });

  // ── guarantees of origin (the product chosen on the page, next production year) ──
  rule('goprices', c => !!c.closest('#go-kpi-strip'), async () => {
    const key = typeof GO_SERIES !== 'undefined' && typeof goProd !== 'undefined' ? Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable' : 'renewable';
    const real = typeof GO_REAL !== 'undefined' && GO_REAL && GO_REAL.byKey[key]; if (!real || !real.weekly.length) return null;
    const pts = f => real.weekly.filter(w => w[f] != null).map(w => [new Date(w.t).toISOString().slice(0, 10), w[f]]);
    return { unit: eur, dp: 2, range: 'ALL', series: [['mid', T('Milieu', 'Mid'), C.a, 'y', true, pts('mid')], ['bid', T('Offre d’achat', 'Bid'), C.b, 'y', true, pts('bid')], ['ask', T('Offre de vente', 'Ask'), C.e, 'y', true, pts('ask')]],
      whyMore: T('Une cotation par semaine (courtier), toujours sur l’année de production suivante.', 'One broker quote a week, always on the next production year.') };
  });
})();
