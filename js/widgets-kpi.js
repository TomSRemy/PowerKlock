// ════════════════════════════════════════════════════════════════════
// widgets-kpi.js · key-figure tiles for My Dashboard
// One number, its unit, the change and where it comes from. Same sources
// and conventions as the pages: rising prices and costs in red.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.PKW) return;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f = (v, dp) => v == null || isNaN(v) ? '–' : Number(v).toFixed(dp == null ? 1 : dp);
  const signed = (v, dp) => v == null || isNaN(v) ? '–' : (v >= 0 ? '+' : '') + Number(v).toFixed(dp == null ? 1 : dp);

  // tone: 'up' (green), 'down' (red) or null.
  function tile(host, o) {
    host.innerHTML = `<div class="pkd-kpi">
      <div class="pkd-kpi-v">${esc(o.value)}<span class="pkd-kpi-u">${esc(o.unit || '')}</span></div>
      ${o.chg ? `<div class="pkd-kpi-c ${o.tone || ''}">${esc(o.chg)}</div>` : ''}
      <div class="pkd-kpi-m" title="${esc(o.meta || '')}">${esc(o.meta || '')}</div>
    </div>`;
  }
  function empty(host, msg) { host.innerHTML = `<div class="pkd-kpi"><div class="pkd-kpi-v pkd-kpi-na">–</div><div class="pkd-kpi-m">${esc(msg)}</div></div>`; }

  const ZONE_OPTS = (typeof ZONES !== 'undefined' ? ZONES : [])
    .map(z => [z.code, z.name + ' (' + z.code + ')'])
    .sort((a, b) => a[1].localeCompare(b[1]));
  const zoneName = c => ((typeof ZONES !== 'undefined' ? ZONES : []).find(z => z.code === c) || {}).name || c;

  PKW.register({
    id: 'kpi-da', kind: 'html', title: 'Day-ahead base', category: 'kpi', source: 'ENTSO-E', page: 'prices', size: { w: 2, h: 2 },
    desc: 'Baseload day-ahead price of a zone for the current delivery day, change vs the day before.',
    params: [{ key: 'zone', label: 'Zone', options: ZONE_OPTS }], defaults: { zone: 'FR' },
    titleFn: p => zoneName(p.zone) + ' · DA base',
    async html(host, p) {
      const data = await PKW.waitFor(() => (typeof pricesData !== 'undefined' && pricesData && pricesData.length) ? pricesData : null);
      const z = data && data.find(x => x.code === p.zone);
      if (!z || z.today == null) return empty(host, 'No price for ' + p.zone + ' yet');
      // Rising power price = red, as on the Prices table.
      tile(host, {
        value: f(z.today, 2), unit: ' €/MWh',
        chg: z.vsYday != null ? (z.vsYday >= 0 ? '▲ ' : '▼ ') + signed(z.vsYday, 2) + ' d/d' : '',
        tone: z.vsYday == null ? null : z.vsYday > 0 ? 'down' : 'up',
        meta: 'min ' + f(z.min, 1) + ' · max ' + f(z.max, 1) + (z.negHours ? ' · ' + z.negHours + ' h < 0' : ''),
      });
    },
  });

  const FUELS = {
    eua: { label: 'EUA', unit: ' €/t', dp: 2, contract: true },
    ttf: { label: 'TTF day-ahead', unit: ' €/MWh', dp: 2 },
    coal: { label: 'API2 coal', unit: ' $/t', dp: 2, contract: true },
    brent: { label: 'Brent M+1', unit: ' $/bbl', dp: 2 },
    the: { label: 'THE day-ahead', unit: ' €/MWh', dp: 2 },
    peg: { label: 'PEG day-ahead', unit: ' €/MWh', dp: 2 },
    jkm: { label: 'JKM M+1', unit: ' $/MMBtu', dp: 2 },
    agsi: { label: 'EU gas storage', unit: ' %', dp: 1, level: true },
  };
  PKW.register({
    id: 'kpi-fuel', kind: 'html', title: 'Fuel & carbon close', category: 'kpi', source: 'Market data', page: 'eua', size: { w: 2, h: 2 },
    desc: 'Last close of a fuel or carbon benchmark and its daily change.',
    params: [{ key: 'c', label: 'Product', options: Object.keys(FUELS).map(k => [k, FUELS[k].label]) }], defaults: { c: 'eua' },
    titleFn: p => (FUELS[p.c] || FUELS.eua).label + (FUELS[p.c] && FUELS[p.c].contract && window.PKC && PKC.data ? ' ' + PKC.contractLabel(p.c) : ''),
    async html(host, p) {
      if (!window.PKC) return empty(host, 'Market data unavailable');
      await PKC.ready;
      const d = FUELS[p.c] || FUELS.eua;
      const l = PKC.last(p.c);
      if (!l) return empty(host, 'No close available');
      tile(host, {
        value: f(l.v, d.dp), unit: d.unit,
        chg: l.chg == null ? '' : d.level
          ? (l.chg >= 0 ? '▲ ' : '▼ ') + signed(l.chg, 2) + ' pts d/d'
          : (l.chg >= 0 ? '▲ ' : '▼ ') + signed(l.pct, 2) + ' % d/d',
        // A rising cost is red; a rising storage level is green.
        tone: l.chg == null || l.chg === 0 ? null : (l.chg > 0) === !!d.level ? 'up' : 'down',
        meta: 'close ' + l.d,
      });
    },
  });

  PKW.register({
    id: 'kpi-fr-nuclear', kind: 'html', title: 'FR nuclear available', category: 'kpi', source: 'Market data', page: 'nuclear', size: { w: 2, h: 2 },
    desc: 'Available French nuclear capacity, share of the 63 GW installed fleet.',
    async html(host) {
      if (!window.PKC) return empty(host, 'Market data unavailable');
      await PKC.ready;
      const l = PKC.last('fr_nuc_avail');
      if (!l) return empty(host, 'No availability published');
      tile(host, {
        value: f(l.v / 1000, 1), unit: ' GW',
        chg: l.chg == null ? '' : (l.chg >= 0 ? '▲ ' : '▼ ') + signed(l.chg / 1000, 2) + ' GW d/d',
        tone: l.chg == null || l.chg === 0 ? null : l.chg > 0 ? 'up' : 'down',
        meta: Math.round(l.v / 63000 * 100) + ' % of 63 GW · ' + l.d,
      });
    },
  });

  // Latest published quarter-hour of today's éCO2mix.
  let e2mP = null;
  function e2mNow() {
    if (!e2mP) e2mP = (window.PK_E2M ? PK_E2M.day(pkTodayISO()) : Promise.resolve(null)).then(d => {
      if (!d) return null;
      let i = -1; d.consommation.forEach((v, k) => { if (v != null) i = k; });
      if (i < 0) return null;
      const net = -PK_E2M.BORDERS.reduce((a, b) => a + (d[b.key][i] || 0), 0);   // RTE: negative = export
      return { load: d.consommation[i], fc: d.prevision_j1[i], net, t: makeTimeLabels(96)[i] };
    }).catch(() => null);
    return e2mP;
  }
  PKW.register({
    id: 'kpi-fr-load', kind: 'html', title: 'FR consumption', category: 'kpi', source: 'RTE éCO2mix', page: 'load', size: { w: 2, h: 2 },
    desc: 'Latest French consumption, against RTE’s day-before forecast.',
    async html(host) {
      const r = await e2mNow();
      if (!r) return empty(host, 'éCO2mix not reachable');
      const dev = r.fc ? r.load - r.fc : null;
      tile(host, {
        value: f(r.load / 1000, 1), unit: ' GW',
        chg: dev == null ? '' : signed(dev / 1000, 2) + ' GW vs D-1 forecast',
        meta: 'at ' + r.t + ' (Paris)',
      });
    },
  });
  PKW.register({
    id: 'kpi-fr-net', kind: 'html', title: 'FR net exports', category: 'kpi', source: 'RTE éCO2mix', page: 'crossborder', size: { w: 2, h: 2 },
    desc: 'Net commercial exchanges of France, latest quarter-hour (positive = net exporter).',
    async html(host) {
      const r = await e2mNow();
      if (!r) return empty(host, 'éCO2mix not reachable');
      tile(host, {
        value: signed(r.net / 1000, 1), unit: ' GW',
        chg: r.net >= 0 ? 'net exporter' : 'net importer',
        tone: r.net >= 0 ? 'up' : 'down',
        meta: 'at ' + r.t + ' (Paris)',
      });
    },
  });

  PKW.register({
    id: 'kpi-hdd', kind: 'html', title: 'FR heating degree days', category: 'kpi', source: 'Open-Meteo', page: 'wxhdd', size: { w: 2, h: 2 },
    desc: 'Today’s population-weighted mean temperature in France and heating degree days (base 18 °C).',
    async html(host) {
      if (typeof _wxForecast !== 'function') return empty(host, 'Weather unavailable');
      const res = await _wxForecast('FR', 7);
      if (!res) return empty(host, 'Open-Meteo not reachable');
      const di = res[0].daily.time.indexOf(pkTodayISO());
      const m = di < 0 ? null : _wxWeighted(res, 'FR', r => r.daily.temperature_2m_mean)[di];
      if (m == null) return empty(host, 'No forecast for today');
      const n = di + 1 < res[0].daily.time.length ? _wxWeighted(res, 'FR', r => r.daily.temperature_2m_mean)[di + 1] : null;
      tile(host, {
        value: f(Math.max(0, 18 - m), 1), unit: ' HDD',
        chg: n == null ? '' : 'tomorrow ' + f(Math.max(0, 18 - n), 1) + ' HDD',
        meta: 'mean ' + f(m, 1) + ' °C today',
      });
    },
  });

  PKW.register({
    id: 'kpi-go', kind: 'html', title: 'GO renewables · mid', category: 'kpi', source: 'Commerg', page: 'goprices', size: { w: 2, h: 2 },
    desc: 'Guarantees of origin, renewable, latest weekly mid price.',
    async html(host) {
      if (typeof GO_REAL !== 'undefined' && !GO_REAL && typeof autoloadGo === 'function' && !window._pkdGoTried) { window._pkdGoTried = true; autoloadGo(); }
      const real = await PKW.waitFor(() => (typeof GO_REAL !== 'undefined' && GO_REAL) ? GO_REAL.byKey.renewable : null);
      if (!real || !real.weekly.length) return empty(host, 'GO prices not loaded');
      const last = real.weekly[real.weekly.length - 1];
      tile(host, {
        value: f(last.mid, 3), unit: ' €/MWh',
        chg: real.d == null ? '' : (real.d >= 0 ? '▲ ' : '▼ ') + signed(real.d, 3) + ' w/w',
        tone: real.d == null || real.d === 0 ? null : real.d > 0 ? 'up' : 'down',
        meta: 'week of ' + (typeof fmtGoDate === 'function' ? fmtGoDate(last.t) : ''),
      });
    },
  });
})();
