// ════════════════════════════════════════════════════════════════════
// dash-widgets.js · widgets made for the business dashboards
// ────────────────────────────────────────────────────────────────────
//   ppa-benchmark   the PPA price of the site's pricer, recalculated every day
//                   (scripts/ppa_daily.py → data/history/ppa_benchmark.json)
//   ppa-today       the same, today's figures in a tile
//   fr-imb-price    France imbalance prices against the day-ahead
//                   (scripts/fetch_fr_imbalance_cost.py → data/history/fr_imbalance_price/)
//   neg-cost        hours at 0 € or below and what they cost a solar or wind park
//   month-review    the last full month in a few written lines
// Texts in both languages (_mT, js/morning.js).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.PKW || typeof _mT !== 'function') return;
  const cache = {};
  const get = (k, path) => cache[k] || (cache[k] = fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => { delete cache[k]; return null; }));
  const bench = () => get('bench', 'history/ppa_benchmark.json');
  const hourly = y => get('h' + y, 'history/fr_hourly/' + y + '.json');
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const B = t => '<b>' + t + '</b>';
  const monthName = (ym, long) => new Date(ym + '-15T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' });
  const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const R = def => PKW.register(Object.assign({ source: 'PowerKlock' }, def));
  const TECH = { key: 'tech', label: 'Technology', inTitle: true, options: [['both', 'Solar and wind'], ['solar', 'Solar'], ['wind', 'Wind']] };
  const COL = { solar: '#FBBF24', wind: '#7FC8F8' };

  // ── PPA benchmark ──
  R({ id: 'ppa-benchmark', title: 'PPA benchmark · France', category: 'renewables', page: 'ppapricer', size: { w: 6, h: 5 },
    desc: 'The PPA price of the PowerKlock pricer (default settings, Cal+1 to Cal+3, pay-as-produced, curtailed at 0 € or below), recalculated every day: how the price moves with the forwards, the capture rates and the GO.',
    params: [TECH, { key: 'win', label: 'Period', options: [['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['all', 'All']] }], defaults: { tech: 'both', win: '6M' },
    async draw(cid, p) {
      const j = await bench(); if (!j || !j.days) { noDataMsg(cid, _mT('Benchmark pas encore calculé', 'Benchmark not computed yet'), ''); return null; }
      const all = Object.keys(j.days).sort(), last = all[all.length - 1];
      const n = { '3M': 92, '6M': 183, '1Y': 366 }[p.win];
      const from = n ? new Date(Date.parse(last) - n * 864e5).toISOString().slice(0, 10) : '';
      const days = all.filter(d => d >= from), techs = p.tech === 'both' ? ['solar', 'wind'] : [p.tech];
      const ds = [];
      techs.forEach(t => {
        // the rebuilt past days dashed, the daily runs solid
        ds.push(_fuelLineDs(t === 'solar' ? _mT('PPA solaire', 'Solar PPA') : _mT('PPA éolien', 'Wind PPA'), days.map(d => j.days[d][t] ? j.days[d][t].ppa : null), COL[t],
          { borderWidth: 2, segment: { borderDash: c => j.days[days[c.p1DataIndex]] && j.days[days[c.p1DataIndex]].rebuilt ? [4, 3] : undefined } }));
      });
      if (techs.length === 1) ds.push(_fuelLineDs(_mT('Forward base de la période', 'Baseload forward of the tenor'), days.map(d => j.days[d][techs[0]] ? j.days[d][techs[0]].ref : null), '#7A93AB', { borderWidth: 1.2, borderDash: [2, 3] }));
      _fuelChart(cid, { type: 'line', data: { labels: days, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') } }) }, 'ppa-benchmark');
      const L = j.days[last], wk = all.filter(d => d <= new Date(Date.parse(last) - 7 * 864e5).toISOString().slice(0, 10)).pop();
      const mv = t => wk && j.days[wk][t] && L[t] ? ' (' + _mS(L[t].ppa - j.days[wk][t].ppa, 2) + _mT(' sur 7 j)', ' on 7 d)') : '';
      const reb = days.some(d => j.days[d].rebuilt);
      return { sub: techs.map(t => (t === 'solar' ? _mT('Solaire ', 'Solar ') : _mT('Éolien ', 'Wind ')) + _mN(L[t] && L[t].ppa, 2) + ' €/MWh' + mv(t)).join(' · ') +
        ' · Cal ' + (L.tenor || '').replace(/-/g, '–') + (reb ? _mT(' · pointillés : jours reconstruits (forwards du jour, modèle actuel)', ' · dashed: rebuilt days (that day’s forwards, current model)') : '') };
    } });
  R({ id: 'ppa-today', kind: 'html', title: 'PPA benchmark · today', category: 'kpi', page: 'ppapricer', size: { w: 6, h: 3 },
    desc: 'Today’s PPA price of the PowerKlock pricer for French solar and wind, with the move on the day and on 7 days.',
    async html(host) {
      const j = await bench(); if (!j || !j.days) { host.innerHTML = '<div class="fuel-note">' + _mT('Benchmark pas encore calculé.', 'Benchmark not computed yet.') + '</div>'; return; }
      const all = Object.keys(j.days).sort(), L = j.days[all[all.length - 1]], P = j.days[all[all.length - 2]] || {}, W = j.days[all[Math.max(0, all.length - 6)]] || {};
      const cell = t => !L[t] ? '' : `<div class="mrn2-tile"><span class="mrn2-tn">${t === 'solar' ? _mT('PPA solaire', 'Solar PPA') : _mT('PPA éolien', 'Wind PPA')} · Cal ${(L.tenor || '').replace(/-/g, '–')}</span><span class="mrn2-tv">${_mN(L[t].ppa, 2)}<small>€/MWh</small></span>` +
        `<span class="mrn2-tc">${P[t] ? _mS(L[t].ppa - P[t].ppa, 2) + ' ' + _mT('J-1', 'D-1') : ''}${W[t] ? ' · ' + _mS(L[t].ppa - W[t].ppa, 2) + ' ' + _mT('5 j ouvrés', '5 runs') : ''}</span>` +
        `<span class="mrn3-tx"><span>${_mT('forward', 'forward')} <b>${_mN(L[t].ref, 2)}</b> · PPA ÷ forward <b>${_mN(L[t].ppa / L[t].ref * 100, 0)} %</b></span><span>${all[all.length - 1]}</span></span></div>`;
      host.innerHTML = '<div class="mrn2-tiles" style="grid-template-columns:1fr 1fr">' + cell('solar') + cell('wind') + '</div>';
    } });

  // ── France imbalance price ──
  R({ id: 'fr-imb-price', title: 'France · imbalance price vs day-ahead', category: 'balancing', page: 'imbalance', source: 'ENTSO-E (A85) · ENTSO-E day-ahead', size: { w: 6, h: 5 },
    desc: 'Latest full day: the price paid for an excess and for a deficit, quarter-hour by quarter-hour, against the day-ahead price; or 30 days of daily averages.',
    params: [{ key: 'view', label: 'View', options: [['day', 'Latest day'], ['30d', '30 days']] }], defaults: { view: 'day' },
    async draw(cid, p) {
      const t = today(), months = [t.slice(0, 7), addMonths(t.slice(0, 7), -1)];
      const files = await Promise.all(months.map(m => get('imb' + m, 'history/fr_imbalance_price/' + m + '.json')));
      const days = Object.assign({}, ...(files.filter(Boolean).reverse().map(f => f.days || {})));
      const keys = Object.keys(days).sort();
      if (!keys.length) { noDataMsg(cid, _mT('Prix des écarts France pas encore collectés', 'France imbalance prices not collected yet'), _mT('collecte quotidienne ENTSO-E', 'daily ENTSO-E collection')); return null; }
      const da = async d => { const j = await get('da' + d, 'history/daily/' + d + '.json'); const h = j && j.zones && j.zones.FR && j.zones.FR.hourly; return Array.isArray(h) ? h : null; };
      const mean = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      if (p.view === '30d') {
        const ks = keys.slice(-30), spot = await Promise.all(ks.map(da));
        _fuelChart(cid, { type: 'line', data: { labels: ks, datasets: [
          _fuelLineDs(_mT('Écart, excédent (moyenne)', 'Imbalance, excess (mean)'), ks.map(d => mean(days[d].long)), '#14D3A9'),
          _fuelLineDs(_mT('Écart, déficit (moyenne)', 'Imbalance, deficit (mean)'), ks.map(d => mean(days[d].short)), '#ED6965'),
          _fuelLineDs(_mT('Day-ahead (moyenne)', 'Day-ahead (mean)'), spot.map(s => s ? mean(s) : null), '#7A93AB', { borderDash: [4, 3] })] },
          options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') } }) }, 'fr-imbalance-30d');
        return { sub: _mT('Moyennes journalières, ', 'Daily means, ') + ks[0] + ' → ' + ks[ks.length - 1] };
      }
      const d = keys[keys.length - 1], s = await da(d), q = i => s ? (s.length === 96 ? s[i] : s[Math.floor(i / 4)]) : null;
      const lbl = Array.from({ length: 96 }, (_, i) => String(Math.floor(i / 4)).padStart(2, '0') + ':' + String(i % 4 * 15).padStart(2, '0'));
      const same = days[d].long.every((v, i) => v === days[d].short[i]);
      const ds = [_fuelLineDs(same ? _mT('Prix des écarts', 'Imbalance price') : _mT('Écart, excédent', 'Imbalance, excess'), days[d].long, '#14D3A9', { stepped: true })];
      if (!same) ds.push(_fuelLineDs(_mT('Écart, déficit', 'Imbalance, deficit'), days[d].short, '#ED6965', { stepped: true }));
      ds.push(_fuelLineDs('Day-ahead', lbl.map((_, i) => q(i)), '#7A93AB', { stepped: true, borderDash: [4, 3] }));
      _fuelChart(cid, { type: 'line', data: { labels: lbl, datasets: ds }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0, callback: (v, i) => i % 16 === 0 ? lbl[i] : '' } }), y: _fuelAxis('€/MWh') } }) }, 'fr-imbalance-day');
      const gap = s ? mean(days[d].short.map((v, i) => v != null && q(i) != null ? Math.abs(v - q(i)) : null)) : null;
      return { sub: _mDay(d) + (gap != null ? _mT(' · écart moyen au day-ahead ', ' · mean gap to the day-ahead ') + _mN(gap, 1) + ' €/MWh' : '') };
    } });

  // ── hours at 0 € or below, and what they cost ──
  // output of 1 MW: RTE national output ÷ installed capacity of the year (Energy-Charts), hour by hour
  async function monthStats(ym) {
    const [h, cap] = await Promise.all([hourly(ym.slice(0, 4)), get('cap', 'history/capacity.json')]);
    if (!h || !h.days) return null;
    const T = cap && cap.countries && cap.countries.FR, yi = T ? T.years.reduce((b, y, i) => y <= +ym.slice(0, 4) ? i : b, -1) : -1;
    const cs = yi >= 0 ? T.types['Solar AC'][yi] * 1000 : null, cw = yi >= 0 ? ((T.types['Wind onshore'][yi] || 0) + (T.types['Wind offshore'][yi] || 0)) * 1000 : null;
    const o = { hours: 0, n: 0, base: 0, s: { all: 0, neg: 0, val: 0 }, w: { all: 0, neg: 0, val: 0 }, nuc: 0, nn: 0 };
    Object.keys(h.days).filter(d => d.startsWith(ym)).forEach(d => {
      const v = h.days[d];
      (v.p || []).forEach((p, i) => {
        if (p == null) return;
        o.n++; o.base += p; const neg = p <= 0;
        if (neg) o.hours++;
        [['s', v.s, cs], ['w', v.w, cw]].forEach(([k, a, c]) => { const x = a && a[i] != null && c ? a[i] / c : 0; o[k].all += x; o[k].val += x * p; if (neg) o[k].neg += x; });
        if (v.n && v.n[i] != null) { o.nuc += v.n[i]; o.nn++; }
      });
    });
    o.base = o.n ? o.base / o.n : null;
    ['s', 'w'].forEach(k => { const x = o[k]; x.capture = x.all > 0 && o.base ? x.val / x.all / o.base : null; });
    o.nuc = o.nn ? o.nuc / o.nn / 1000 : null;
    return o.n ? o : null;
  }
  R({ id: 'neg-cost', kind: 'html', title: 'Hours at 0 € or below · what they cost', category: 'renewables', page: 'prices', source: 'ENTSO-E · RTE éCO2mix · Energy-Charts · PowerKlock', size: { w: 6, h: 6 },
    desc: 'This month, last month and the same month a year ago: hours at 0 € or below in France, the output of 1 MW of solar or wind in those hours, and its value at today’s PPA benchmark (not paid when the park is curtailed).',
    async html(host) {
      const m = today().slice(0, 7), ms = [m, addMonths(m, -1), addMonths(m, -12)];
      const [st, j] = await Promise.all([Promise.all(ms.map(monthStats)), bench()]);
      const L = j && j.days ? j.days[Object.keys(j.days).sort().pop()] : null;
      const price = { s: L && L.solar ? L.solar.ppa : null, w: L && L.wind ? L.wind.ppa : null };
      // per technology: the cost first (€ per MW), then the output in those hours and its share of the month
      const row = (o, i) => !o ? '' : `<tr><td style="text-align:left">${monthName(ms[i])}${i === 0 ? _mT(' (en cours)', ' (to date)') : ''}</td><td><b>${o.hours} h</b></td>` +
        ['s', 'w'].map(k => `<td><b>${price[k] != null ? _mN(o[k].neg * price[k], 0) + ' €' : '–'}</b><span class="m0-rng">${_mN(o[k].neg, 1)} MWh · ${_mN(o[k].all ? o[k].neg / o[k].all * 100 : null, 0)} %</span></td>`).join('') + '</tr>';
      host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">${_mT('Mois', 'Month')}</th><th>${_mT('Heures ≤ 0 €', 'Hours ≤ 0 €')}</th><th>${_mT('Solaire, par MW', 'Solar, per MW')}</th><th>${_mT('Éolien, par MW', 'Wind, per MW')}</th></tr></thead><tbody>` +
        st.map(row).join('') + `</tbody></table></div><div class="fuel-note">${_mT('Production d’1 MW (production nationale RTE ÷ parc installé) pendant les heures à 0 € ou moins, et sa part de la production du mois. Coût = cette production non payée, au prix PPA benchmark du jour', 'Output of 1 MW (RTE national output ÷ installed fleet) in the hours at 0 € or below, and its share of the month’s output. Cost = that output unpaid, at today’s PPA benchmark')} (${_mT('solaire', 'solar')} ${_mN(price.s, 2)}, ${_mT('éolien', 'wind')} ${_mN(price.w, 2)} €/MWh).</div>`;
    } });

  // ── the month in a few lines ──
  R({ id: 'month-review', kind: 'html', title: 'The month in review · France', category: 'intel', page: 'morning', size: { w: 12, h: 5 },
    desc: 'The last full month written out: spot and hours at 0 €, solar and wind capture, output, nuclear, forwards, gas, carbon and the PPA benchmark, each against the month before and a year before.',
    async html(host) {
      const m = addMonths(today().slice(0, 7), -1), pm = addMonths(m, -1), ly = addMonths(m, -12);
      const [a, b, c, cs, chain, j] = await Promise.all([monthStats(m), monthStats(pm), monthStats(ly), get('cs', 'history/commodities_series.json'), get('chain', 'history/fr_market_calchain.json'), bench()]);
      if (!a) { host.innerHTML = '<div class="fuel-note">' + _mT('Données du mois indisponibles.', 'Month data not available.') + '</div>'; return; }
      const end = (pts, ym) => { let v = null; for (const p of pts || []) { if (p[0] <= ym + '-31') v = p; else break; } return v; };
      const pct = (x, y) => x != null && y ? (x / y - 1) * 100 : null;
      const L = [];
      L.push([_mT('Spot', 'Spot'), _mT('base moyenne ', 'average baseload ') + B(_mN(a.base, 1) + ' €/MWh') + (b ? ' (' + _mS(a.base - b.base, 1) + _mT(' € sur un mois', ' € on a month') : '') + (c ? ', ' + _mS(a.base - c.base, 1) + _mT(' € sur un an)', ' € on a year)') : b ? ')' : '') +
        '; ' + B(a.hours + ' h') + _mT(' à 0 € ou moins', ' at 0 € or below') + (c ? _mT(' contre ', ' against ') + c.hours + _mT(' h un an plus tôt', ' h a year earlier') : '') + '.']);
      const cap = k => a[k].capture != null ? B(_mN(a[k].capture * 100, 0) + ' %') + (c && c[k].capture != null ? ' (' + _mS((a[k].capture - c[k].capture) * 100, 0) + _mT(' pts sur un an)', ' pts on a year)') : '') : '–';
      L.push([_mT('Capture', 'Capture'), _mT('solaire ', 'solar ') + cap('s') + _mT(', éolien ', ', wind ') + cap('w') + _mT(' (prix capté ÷ base, toutes heures).', ' (captured price ÷ baseload, all hours).')]);
      L.push([_mT('Production', 'Output'), _mT('1 MW solaire a produit ', '1 MW of solar produced ') + B(_mN(a.s.all, 0) + ' MWh') + (c ? ' (' + _mS(pct(a.s.all, c.s.all), 0) + _mT(' % sur un an)', ' % on a year)') : '') + _mT(', 1 MW éolien ', ', 1 MW of wind ') + B(_mN(a.w.all, 0) + ' MWh') + (c ? ' (' + _mS(pct(a.w.all, c.w.all), 0) + ' %)' : '') + _mT('; nucléaire ', '; nuclear ') + B(_mN(a.nuc, 1) + ' GW') + _mT(' en moyenne', ' on average') + (c && c.nuc ? ' (' + _mS(a.nuc - c.nuc, 1) + _mT(' GW sur un an)', ' GW on a year)') : '') + '.']);
      const yrs = chain && chain.FR && chain.FR.years, y1 = String(+m.slice(0, 4) + 1);
      if (yrs && yrs[y1]) { const pts = yrs[y1].dates.map((d, i) => [d, yrs[y1].values[i]]), e1 = end(pts, m), e0 = end(pts, pm);
        if (e1 && e0) L.push([_mT('Forwards', 'Forwards'), 'Cal ' + y1.slice(2) + ' ' + B(_mN(e1[1], 1) + ' €/MWh') + _mT(' fin ', ' at the end of ') + monthName(m, true) + ' (' + _mS(e1[1] - e0[1], 1) + _mT(' € sur le mois).', ' € on the month).')]); }
      const S = cs && cs.series, mv = (k, u, d) => { const p = S && S[k] && S[k].points, e1 = end(p, m), e0 = end(p, pm); return e1 && e0 ? B(_mN(e1[1], d) + ' ' + u) + ' (' + _mS(pct(e1[1], e0[1]), 0) + ' %)' : null; };
      const g = [['TTF', mv('ttf', '€/MWh', 1)], ['EUA', mv('eua', '€/t', 1)], ['Brent', mv('brent', '$/b', 1)]].filter(x => x[1]);
      if (g.length) L.push([_mT('Gaz, CO₂, pétrole', 'Gas, CO₂, oil'), g.map(x => x[0] + ' ' + x[1]).join(' · ') + _mT(' en fin de mois.', ' at the end of the month.')]);
      if (j && j.days) { const ks = Object.keys(j.days).sort(), e1 = ks.filter(d => d <= m + '-31').pop(), e0 = ks.filter(d => d <= pm + '-31').pop();
        if (e1 && e0 && e1 !== e0) L.push([_mT('PPA benchmark', 'PPA benchmark'), _mT('solaire ', 'solar ') + B(_mN(j.days[e1].solar.ppa, 2)) + ' (' + _mS(j.days[e1].solar.ppa - j.days[e0].solar.ppa, 2) + ')' + _mT(', éolien ', ', wind ') + B(_mN(j.days[e1].wind.ppa, 2)) + ' (' + _mS(j.days[e1].wind.ppa - j.days[e0].wind.ppa, 2) + ') €/MWh' + _mT(' en fin de mois.', ' at the end of the month.')]); }
      host.innerHTML = `<p class="mrn2-lbl" style="margin:0 0 6px">${monthName(m, true)}</p><ul class="mrn3-lines">` + L.map(([x, y]) => `<li><b>${x}</b><span>${y}</span></li>`).join('') + '</ul>';
    } });
})();
