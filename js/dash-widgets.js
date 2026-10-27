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
      if (techs.length === 1) {   // one technology: the Blend of the three model methods and the P10–P90 band of the default one
        const g = k => days.map(d => j.days[d][techs[0]] && j.days[d][techs[0]][k] != null ? j.days[d][techs[0]][k] : null), col = COL[techs[0]];
        if (g('hi').some(v => v != null)) {
          ds.push(_fuelLineDs('P90', g('hi'), col, { borderWidth: 0, pointRadius: 0, fill: false, backgroundColor: 'transparent' }));
          ds.push(_fuelLineDs(_mT('Bande P10–P90', 'P10–P90 band'), g('lo'), col, { borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: col + '22' }));
        }
        if (g('blend').some(v => v != null)) ds.push(_fuelLineDs(_mT('Blend (3 méthodes)', 'Blend (3 methods)'), g('blend'), '#E6EDF3', { borderWidth: 1.4, borderDash: [5, 4] }));
        ds.push(_fuelLineDs(_mT('Forward base de la période', 'Baseload forward of the tenor'), g('ref'), '#7A93AB', { borderWidth: 1.2, borderDash: [2, 3] }));
      }
      _fuelChart(cid, { type: 'line', data: { labels: days, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') }, plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10, filter: it => it.text !== 'P90' } } } }) }, 'ppa-benchmark');
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
        (L[t].blend != null ? `<span class="mrn2-tc">Blend <b>${_mN(L[t].blend, 2)}</b>${L[t].lo != null ? ' · P10–P90 <b>' + _mN(L[t].lo, 1) + '–' + _mN(L[t].hi, 1) + '</b>' : ''}</span>` : '') +
        `<span class="mrn3-tx"><span>${_mT('forward', 'forward')} <b>${_mN(L[t].ref, 2)}</b> · PPA ÷ forward <b>${_mN(L[t].ppa / L[t].ref * 100, 0)} %</b></span><span>${all[all.length - 1]}</span></span></div>`;
      host.innerHTML = '<div class="mrn2-tiles" style="grid-template-columns:1fr 1fr">' + cell('solar') + cell('wind') + '</div>';
    } });

  // ── PowerKlock BESS index: forward (day-ahead value over the Cal strip) and realised best market (scripts/bess_optim.py) ──
  R({ id: 'bess-index', title: 'BESS index · France', category: 'prices', page: 'bess', size: { w: 6, h: 5 },
    desc: 'The PowerKlock BESS index of a 1 MW, 2 h battery, recalculated every day: the forward index (day-ahead value over the Cal strip of the PPA benchmark) and the realised value co-optimised between day-ahead and FCR, in k€ per MW per year.',
    params: [{ key: 'win', label: 'Period', options: [['6M', '6M'], ['1Y', '1Y'], ['2Y', '2Y'], ['all', 'All']] }], defaults: { win: '1Y' },
    async draw(cid, p) {
      const j = await get('bessidx', 'history/bess_index.json'); if (!j || !j.forward) { noDataMsg(cid, _mT('Indice pas encore calculé', 'Index not computed yet'), ''); return null; }
      const F = Object.keys(j.forward).sort(), last = F[F.length - 1], n = { '6M': 183, '1Y': 366, '2Y': 731 }[p.win];
      const from = n ? new Date(Date.parse(last) - n * 864e5).toISOString().slice(0, 10) : '';
      const days = F.filter(d => d >= from);
      // realised best market: 30-day rolling mean, annualised
      const val = r => r.co != null ? r.co : r.best, RK = Object.keys(j.realised).sort().filter(d => val(j.realised[d]) != null);
      const roll = days.map(d => { const w = RK.filter(x => x <= d).slice(-30); return w.length >= 20 && w[w.length - 1] >= new Date(Date.parse(d) - 5 * 864e5).toISOString().slice(0, 10) ? +(w.reduce((a, x) => a + val(j.realised[x]), 0) / w.length * 0.365).toFixed(1) : null; });
      _fuelChart(cid, { type: 'line', data: { labels: days, datasets: [
        _fuelLineDs(_mT('Indice forward', 'Forward index'), days.map(d => j.forward[d].v), '#A87DC4', { borderWidth: 2 }),
        _fuelLineDs(_mT('Réalisé co-optimisé, day-ahead + FCR (30 j glissants)', 'Realised co-optimised, day-ahead + FCR (rolling 30 d)'), roll, '#8D99AE', { borderWidth: 1.5, borderDash: [5, 3] }),
      ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis(_mT('k€/MW/an', 'k€/MW/yr'), { beginAtZero: true }) }, plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } } } }) }, 'bess-index');
      const L = j.forward[last], wk = F.filter(d => d <= new Date(Date.parse(last) - 7 * 864e5).toISOString().slice(0, 10)).pop();
      const st = j.strip.split('-');
      return { sub: _mT('Batterie 1 MW, 2 h · forward ', '1 MW, 2 h battery · forward ') + _mN(L.v, 1) + _mT(' k€/MW/an', ' k€/MW/yr') + (wk ? ' (' + _mS(L.v - j.forward[wk].v, 1) + _mT(' sur 7 j)', ' on 7 d)') : '') + ' · Cal ' + st[0] + '–' + st[st.length - 1] };
    } });
  // ── what moved the PPA benchmark between two dates: forwards, capture (shape and cannibalisation), GO, imbalance ──
  //    ppa = ref × R + go − imb − margin, R = (ppa − go + imb + margin) ÷ ref (what one forward MWh is worth once shaped)
  //    Δppa = Δref × R₀ (forwards) + ref₁ × ΔR (capture) + Δgo (GO) − Δimb (imbalance): the four add up exactly
  R({ id: 'ppa-bridge', title: 'PPA benchmark · what moved it', category: 'renewables', page: 'ppapricer', size: { w: 6, h: 5 },
    desc: 'The change of the PPA benchmark over a week, a month or a year, split into the part due to the forwards, to the capture (production profile and cannibalisation), to the GO and to the imbalance cost.',
    params: [{ key: 'tech', label: 'Technology', inTitle: true, options: [['solar', 'Solar'], ['wind', 'Wind']] }, { key: 'win', label: 'Over', options: [['7', '7 days'], ['30', '30 days'], ['365', '1 year']] }], defaults: { tech: 'solar', win: '30' },
    async draw(cid, p) {
      const j = await bench(); if (!j || !j.days) { noDataMsg(cid, _mT('Benchmark pas encore calculé', 'Benchmark not computed yet'), ''); return null; }
      const ks = Object.keys(j.days).sort(), d1 = ks[ks.length - 1], lim = new Date(Date.parse(d1) - (+p.win || 30) * 864e5).toISOString().slice(0, 10), d0 = ks.filter(d => d <= lim).pop() || ks[0];
      const a = j.days[d0][p.tech], b = j.days[d1][p.tech]; if (!a || !b) return null;
      const M = 1, Rr = x => (x.ppa - x.go + x.imb + M) / x.ref;   // the pricer's default margin, 1 €/MWh
      const parts = [[_mT('Forwards', 'Forwards'), (b.ref - a.ref) * Rr(a)], [_mT('Capture', 'Capture'), b.ref * (Rr(b) - Rr(a))], ['GO', b.go - a.go], [_mT('Écarts', 'Imbalance'), -(b.imb - a.imb)]];
      let run = a.ppa; const bars = [[_mT('Début ', 'Start ') + d0, [0, a.ppa], '#7A93AB']];
      parts.forEach(([l, v]) => { bars.push([l, [run, run + v], v >= 0 ? '#14D3A9' : '#ED6965']); run += v; });
      bars.push([_mT('Fin ', 'End ') + d1, [0, b.ppa], COL[p.tech]]);
      _fuelChart(cid, { type: 'bar', data: { labels: bars.map(x => x[0]), datasets: [{ label: '€/MWh', data: bars.map(x => x[1]), backgroundColor: bars.map(x => x[2]), borderWidth: 0 }] },
        options: _fuelOpts({ plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const r = c.raw; return Array.isArray(r) ? (c.dataIndex === 0 || c.dataIndex === bars.length - 1 ? _mN(r[1], 2) : _mS(r[1] - r[0], 2)) + ' €/MWh' : ''; } } } },
          scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh', { beginAtZero: false }) } }) }, 'ppa-bridge');
      const big = parts.slice().sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0];
      return { sub: (p.tech === 'solar' ? _mT('Solaire ', 'Solar ') : _mT('Éolien ', 'Wind ')) + _mN(a.ppa, 2) + ' → ' + _mN(b.ppa, 2) + ' €/MWh (' + _mS(b.ppa - a.ppa, 2) + ')' + _mT(' · surtout ', ' · mostly ') + big[0].toLowerCase() + ' ' + _mS(big[1], 2) };
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
      host.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 6px"><p class="mrn2-lbl" style="margin:0">${monthName(m, true)}</p>` +
        (window.PKExport ? `<button type="button" class="pk-btn-ghost" data-month-ppt="${m}">${_mT('PowerPoint du mois', 'Month deck (PowerPoint)')}</button>` : '') + '</div><ul class="mrn3-lines">' + L.map(([x, y]) => `<li><b>${x}</b><span>${y}</span></li>`).join('') + '</ul>';
    } });

  // ── the monthly review as a PowerPoint in one click: the month written out, then its charts (drawn off screen and
  //    captured), in the user's own template when one is kept (js/pptx-export.js) ──
  const DECK = [['fr-spot-monthly', { zone: 'FR' }, 'Spot by month · 12 months'], ['fr-sys-monthly', { view: 'twh', win: '3Y' }, 'France monthly production by source'],
    ['spark-monthly', { zone: 'FR', period: '1Y' }, 'Spreads · monthly averages'], ['ppa-benchmark', { tech: 'both', win: '1Y' }, 'PPA benchmark · France'], ['neg-cost', {}, 'Hours at 0 € or below · what they cost']];
  async function monthDeck(btn, m) {
    const txt = btn.textContent; btn.disabled = true; btn.textContent = _mT('Préparation…', 'Preparing…');
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-12000px;top:0;width:1100px;background:var(--bg2);padding:16px';
    document.body.appendChild(box);
    try {
      const review = btn.closest('.pkd-body, .chart-container, div')?.parentElement?.querySelector('.mrn3-lines');
      const lines = review ? [...review.querySelectorAll('li')].map(li => li.innerText.replace(/\n/g, ' : ')) : [];
      const specs = [{ k: 'note', title: _mT('Le mois en revue · ', 'The month in review · ') + monthName(m, true), text: lines.join('\n') }];
      for (const [wid, p, title] of DECK) {
        const w = PKW.get(wid); if (!w) continue;
        const card = document.createElement('div'); card.style.cssText = 'width:1060px;padding:12px;background:var(--bg2)';
        card.innerHTML = `<div class="table-title" style="margin-bottom:8px">${title}</div>` + (w.kind === 'html' ? '<div class="dk-h"></div>' : `<div style="position:relative;height:460px"><canvas id="dk-${wid}" style="width:100%;height:460px"></canvas></div>`);
        box.appendChild(card);
        let sub = '';
        try { if (w.kind === 'html') await w.html(card.querySelector('.dk-h'), Object.assign({}, w.defaults, p)); else { const r = await PKW.draw(wid, 'dk-' + wid, p); sub = (r && r.sub) || ''; } } catch (_) {}
        await new Promise(r => setTimeout(r, 400));
        specs.push({ k: 'card', title: (window.PKI18n && PKI18n.tr ? PKI18n.tr(title) : title), sub, src: w.source || 'PowerKlock', r: await PKExport.snap(card) });
      }
      await PKExport.deck(_mT('Revue mensuelle · ', 'Monthly review · ') + monthName(m, true), specs);
    } catch (e) { console.warn('[month deck]', e); alert(_mT('Export impossible : ', 'Export failed: ') + (e && e.message || e)); }
    finally { box.remove(); btn.disabled = false; btn.textContent = txt; }
  }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-month-ppt]'); if (b) { e.preventDefault(); e.stopPropagation(); monthDeck(b, b.dataset.monthPpt); } }, true);

  // ── imbalance cost of a 10 MW park, solar or wind, month by month (national estimate, scripts/fetch_fr_imbalance_cost.py) ──
  R({ id: 'imb-park', kind: 'html', title: 'Imbalance cost · 10 MW park', category: 'balancing', page: 'imbalance', source: 'ENTSO-E (A69, A85) · RTE éCO2mix · PowerKlock', size: { w: 6, h: 5 },
    desc: 'What forecast errors cost a 10 MW solar or wind park each month: the national error settled at the imbalance price, per MWh and in euros for the park\u2019s output.',
    async html(host) {
      const j = await get('imbc', 'history/fr_imbalance_cost.json'); const ms = j && j.months ? Object.keys(j.months).sort().slice(-6).reverse() : [];
      if (!ms.length) { host.innerHTML = '<div class="fuel-note">' + _mT('Coûts d’écart pas encore calculés.', 'Imbalance costs not computed yet.') + '</div>'; return; }
      const st = await Promise.all(ms.map(monthStats));
      const cell = (mm, i, k, tk) => { const c = (j.months[mm] || {})[k], o = st[i]; if (!c) return '<td>–</td>'; const mwh = o ? o[tk].all * 10 : null;
        return `<td><b>${mwh != null ? _mN(c.eurMWh * mwh, 0) + ' €' : '–'}</b><span class="m0-rng">${_mN(c.eurMWh, 2)} €/MWh · ${mwh != null ? _mN(mwh, 0) + ' MWh' : ''}</span></td>`; };
      host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">${_mT('Mois', 'Month')}</th><th>${_mT('Solaire 10 MW', 'Solar 10 MW')}</th><th>${_mT('Éolien 10 MW', 'Wind 10 MW')}</th></tr></thead><tbody>` +
        ms.map((mm, i) => `<tr><td style="text-align:left">${monthName(mm)}</td>${cell(mm, i, 'solar', 's')}${cell(mm, i, 'wind', 'w')}</tr>`).join('') + '</tbody></table></div>' +
        `<div class="fuel-note">${_mT('Coût = erreur de la prévision nationale J-1 réglée au prix des écarts, par MWh produit, appliqué à la production d’un parc de 10 MW (production nationale ÷ parc installé). Un parc réel fait mieux ou moins bien selon sa prévision.', 'Cost = the national day-ahead forecast error settled at the imbalance price, per MWh produced, applied to the output of a 10 MW park (national output ÷ installed fleet). A real park does better or worse with its own forecast.')}</div>`;
    } });
})();
