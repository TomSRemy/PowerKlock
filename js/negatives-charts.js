// ════════════════════════════════════════════════════════════════════
// NEGATIVE PRICES · CHARTS (Prices › Negative prices)
// Every chart of the page drawn with the site's chart engine (hover readout,
// fullscreen, PNG, ☆ to My Dashboard) instead of hand-drawn SVG:
//   cross-zone  — by zone × year, ranking, seasonality, hour of day, pace
//   one zone    — by month, per year, pace, daily, hour of day,
//                 month × hour heatmap, calendar
// Daily figures: history/summary.json (negH = hours below 0 per day, min);
// hour-of-day figures: history/neg_profile.json (scripts/build_neg_profile.py).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const RED = '#ED6965', RED_DEEP = '#A33A3A', GREYS = ['#3A4654', '#4E5D6E', '#677A8D', '#8597AA'];
  const PAL = ['#14D3A9', '#7FC8F8', '#FBBF24', '#A87DC4', '#ED6965', '#C4A57B', '#3FA6B4', '#B8C9D9'];
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const HRS = [...Array(24).keys()].map(h => String(h).padStart(2, '0') + 'h');
  const FEATURED = ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'SE', 'PL', 'FI'];
  const cache = {};
  const get = (k, path) => cache[k] || (cache[k] = fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => null));
  const summary = () => window.pkSummary();
  const profile = () => get('prof', 'history/neg_profile.json');
  const today = () => (typeof pkTodayISO === 'function' ? pkTodayISO() : new Date().toISOString().slice(0, 10));
  const cy = () => today().slice(0, 4);
  const zname = c => { try { return (ZONE_META[c] && ZONE_META[c].country) || c; } catch (_) { return c; } };
  const winDays = w => ({ '1M': 31, '3M': 92, '1Y': 365, '2Y': 730, '5Y': 1825, all: 99999 }[w] || 365);
  const leap = y => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
  const doy = ds => { const d = new Date(ds + 'T12:00:00Z'); return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000); };
  function yearInfo(ser) {
    const o = {};
    (ser || []).forEach(d => { const y = d.d.slice(0, 4); const r = o[y] || (o[y] = { h: 0, n: 0, days: 0 }); r.h += d.negH || 0; r.n++; if ((d.negH || 0) > 0) r.days++; });
    Object.keys(o).forEach(y => { const exp = y === cy() ? doy(today()) : (leap(+y) ? 366 : 365); o[y].complete = o[y].n >= 0.95 * exp; o[y].partial = y === cy(); });
    return o;
  }
  const legend = () => ({ display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } });
  const yearColors = years => years.map((y, i) => y === cy() ? RED_DEEP : i === years.length - (years.includes(cy()) ? 2 : 1) ? RED : GREYS[Math.max(0, GREYS.length - (years.length - i) + (years.includes(cy()) ? 1 : 0))] || GREYS[0]);
  const optsBar = (yTitle, extra) => _fuelOpts(Object.assign({ scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis(yTitle, { beginAtZero: true }) }, plugins: { legend: legend() } }, extra || {}));

  // ── Cross-zone ────────────────────────────────────────────────────
  const CC = {
    async year(cid) {
      const s = await summary(); const zones = FEATURED.filter(z => s && s.zones && s.zones[z]);
      if (!zones.length) { noDataMsg(cid, 'History not available', ''); return null; }
      const years = []; for (let y = 2022; y <= +cy(); y++) years.push(String(y));
      const info = Object.fromEntries(zones.map(z => [z, yearInfo(s.zones[z])]));
      const cols = yearColors(years);
      _fuelChart(cid, { type: 'bar', data: { labels: zones.map(z => z.replace('_LU', '')), datasets: years.map((y, i) => ({
        label: y + (y === cy() ? ' (YTD)' : ''), data: zones.map(z => { const r = info[z][y]; return r && (r.complete || r.partial) ? Math.round(r.h) : null; }),
        backgroundColor: cols[i], borderRadius: 2, borderWidth: y === cy() ? 1 : 0, borderColor: RED, borderDash: [3, 2] })) },
        options: optsBar('hours below 0 €/MWh') }, 'negative-hours-by-zone-year');
      return { title: 'Negative hours by zone and year', sub: '2022 → ' + cy() + ' · ' + cy() + ' to date · years with incomplete history left out' };
    },
    async rank(cid, p) {
      const s = await summary(); if (!s || !s.zones) { noDataMsg(cid, 'History not available', ''); return null; }
      const n = winDays(p.win);
      const rows = Object.keys(s.zones).map(z => ({ z, v: s.zones[z].slice(-n).reduce((a, d) => a + (d.negH || 0), 0) })).filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 20);
      _fuelChart(cid, { type: 'bar', data: { labels: rows.map(r => r.z), datasets: [{ label: 'Negative hours', data: rows.map(r => Math.round(r.v * 10) / 10), backgroundColor: rows.map(r => r.z === 'FR' ? '#7FC8F8' : RED), borderRadius: 3 }] },
        options: _fuelOpts({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: _fuelAxis('hours', { beginAtZero: true }), y: { grid: { display: false }, ticks: { color: C_TX2, font: { size: 11 }, autoSkip: false } } } }) }, 'negative-hours-ranking');
      return { title: 'Ranking · negative hours over the window', sub: 'Last ' + (p.win === 'all' ? 'available history' : p.win) + ' · top 20 zones · France in blue' };
    },
    async season(cid) {
      const s = await summary(); const zones = FEATURED.filter(z => s && s.zones && s.zones[z]);
      if (!zones.length) { noDataMsg(cid, 'History not available', ''); return null; }
      const ds = zones.map((z, i) => {
        const info = yearInfo(s.zones[z]), full = Object.keys(info).filter(y => info[y].complete && !info[y].partial && +y >= 2022);
        const m = new Array(12).fill(0); s.zones[z].forEach(d => { if (full.includes(d.d.slice(0, 4))) m[+d.d.slice(5, 7) - 1] += d.negH || 0; });
        return _fuelLineDs(z.replace('_LU', ''), full.length ? m.map(v => Math.round(v / full.length * 10) / 10) : m.map(() => null), PAL[i % PAL.length], { borderWidth: z === 'FR' ? 2.6 : 1.6, tension: .3, pointRadius: 2 });
      });
      _fuelChart(cid, { type: 'line', data: { labels: MN, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('hours per month', { beginAtZero: true }) }, plugins: { legend: legend() } }) }, 'negative-hours-seasonality');
      return { title: 'Seasonality · average negative hours per month', sub: 'Average of the complete years since 2022' };
    },
    async hour(cid) {
      const pr = await profile(); const zones = FEATURED.filter(z => pr && pr.zones && pr.zones[z]);
      if (!zones.length) { noDataMsg(cid, 'Hourly profile not available', ''); return null; }
      const ds = zones.map((z, i) => { const r = last12(pr.zones[z]); return _fuelLineDs(z.replace('_LU', ''), r.map(v => v == null ? null : Math.round(v * 10) / 10), PAL[i % PAL.length], { borderWidth: z === 'FR' ? 2.6 : 1.6, tension: .3 }); });
      _fuelChart(cid, { type: 'line', data: { labels: HRS, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('% of days negative', { beginAtZero: true }) }, plugins: { legend: legend() } }) }, 'negative-hours-by-hour');
      return { title: 'Hour of day · share of days with a negative price', sub: 'Last 12 months · the solar signature: negative prices cluster around midday' };
    },
    async cumul(cid) {
      const s = await summary(); const zones = FEATURED.filter(z => s && s.zones && s.zones[z]);
      if (!zones.length) { noDataMsg(cid, 'History not available', ''); return null; }
      const y = cy(), labels = []; const d0 = Date.UTC(+y, 0, 1);
      for (let i = 0; i < doy(today()); i++) labels.push(new Date(d0 + i * 86400000).toISOString().slice(5, 10));
      const ds = zones.map((z, i) => {
        const m = new Map(s.zones[z].filter(d => d.d.slice(0, 4) === y).map(d => [d.d.slice(5, 10), d.negH || 0]));
        let c = 0; return _fuelLineDs(z.replace('_LU', ''), labels.map(l => m.has(l) ? (c += m.get(l), Math.round(c * 10) / 10) : null), PAL[i % PAL.length], { borderWidth: z === 'FR' ? 2.6 : 1.6, spanGaps: true });
      });
      _fuelChart(cid, { type: 'line', data: { labels, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('cumulative hours', { beginAtZero: true }) }, plugins: { legend: legend() } }) }, 'negative-hours-pace');
      return { title: 'Pace · cumulative negative hours in ' + y, sub: 'Featured zones, year to date' };
    },
  };
  // % of days with a negative price at each hour over the last 12 complete months
  function last12(zp, year) {
    const out = new Array(24).fill(0); let days = 0;
    const t = today(), Y = +t.slice(0, 4), M = +t.slice(5, 7) - 1;
    for (let k = 1; k <= 12; k++) {
      let m = M - k, y = Y; while (m < 0) { m += 12; y--; }
      if (year && String(y) !== String(year)) continue;
      const r = zp[String(y)]; if (!r) continue;
      days += r.days[m]; for (let h = 0; h < 24; h++) out[h] += r.mh[m][h];
    }
    return days ? out.map(v => v / days * 100) : out.map(() => null);
  }

  // ── One zone ──────────────────────────────────────────────────────
  const ZONE = {
    async month(cid, p) {
      const s = await summary(), ser = s && s.zones && s.zones[p.zone];
      if (!ser) { noDataMsg(cid, 'No history for ' + p.zone, ''); return null; }
      const info = yearInfo(ser), years = Object.keys(info).filter(y => info[y].complete || info[y].partial).slice(-4), cols = yearColors(years);
      const ds = years.map((y, i) => { const m = new Array(12).fill(0); ser.forEach(d => { if (d.d.slice(0, 4) === y) m[+d.d.slice(5, 7) - 1] += d.negH || 0; }); return { label: y + (y === cy() ? ' (YTD)' : ''), data: m.map(v => Math.round(v * 10) / 10), backgroundColor: cols[i], borderRadius: 2 }; });
      _fuelChart(cid, { type: 'bar', data: { labels: MN, datasets: ds }, options: optsBar('hours') }, 'negative-hours-by-month-' + p.zone);
      return { title: 'Negative hours by month', sub: zname(p.zone) + ' · last ' + years.length + ' years' };
    },
    async year(cid, p) {
      const s = await summary(), ser = s && s.zones && s.zones[p.zone];
      if (!ser) { noDataMsg(cid, 'No history for ' + p.zone, ''); return null; }
      const info = yearInfo(ser), years = Object.keys(info).sort();
      _fuelChart(cid, { type: 'bar', data: { labels: years.map(y => y + (info[y].partial ? ' YTD' : !info[y].complete ? ' *' : '')), datasets: [
        { label: 'Negative hours', data: years.map(y => Math.round(info[y].h)), backgroundColor: years.map(y => info[y].partial ? 'rgba(237,105,101,.45)' : !info[y].complete ? 'rgba(122,147,171,.5)' : RED), borderRadius: 3 },
        { type: 'line', label: 'Days with a negative price', data: years.map(y => info[y].days), borderColor: '#B8C9D9', borderWidth: 1.6, pointRadius: 3, yAxisID: 'y1' },
      ] }, options: optsBar('hours', { scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('hours', { beginAtZero: true }), y1: _fuelAxis('days', { position: 'right', beginAtZero: true, grid: { display: false } }) } }) }, 'negative-hours-per-year-' + p.zone);
      return { title: 'Negative hours per year', sub: zname(p.zone) + ' · ' + years[0] + ' → ' + years[years.length - 1] + ' · * incomplete history' };
    },
    async cumul(cid, p) {
      const s = await summary(), ser = s && s.zones && s.zones[p.zone];
      if (!ser) { noDataMsg(cid, 'No history for ' + p.zone, ''); return null; }
      const info = yearInfo(ser), years = Object.keys(info).filter(y => info[y].complete || info[y].partial).slice(-5);
      const labels = []; for (let i = 0; i < 366; i++) labels.push(new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(5, 10));
      const ds = years.map((y, i) => { const m = new Map(ser.filter(d => d.d.slice(0, 4) === y).map(d => [d.d.slice(5, 10), d.negH || 0])); let c = 0, seen = false;
        return _fuelLineDs(y + (y === cy() ? ' (YTD)' : ''), labels.map(l => { if (m.has(l)) { seen = true; c += m.get(l); return Math.round(c * 10) / 10; } return y === cy() && l > today().slice(5) ? null : seen ? Math.round(c * 10) / 10 : null; }),
          y === cy() ? RED : GREYS[Math.max(0, GREYS.length - (years.length - i))] || GREYS[0], { borderWidth: y === cy() ? 2.8 : 1.5, spanGaps: true }); });
      _fuelChart(cid, { type: 'line', data: { labels, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('cumulative hours', { beginAtZero: true }) }, plugins: { legend: legend() } }) }, 'negative-hours-pace-' + p.zone);
      return { title: 'Pace · cumulative negative hours', sub: zname(p.zone) + ' · this year against the previous ones' };
    },
    async daily(cid, p) {
      const s = await summary(), ser = s && s.zones && s.zones[p.zone];
      if (!ser) { noDataMsg(cid, 'No history for ' + p.zone, ''); return null; }
      const rows = ser.slice(-winDays(p.win));
      _fuelChart(cid, { type: 'bar', data: { labels: rows.map(d => d.d), datasets: [
        { label: 'Negative hours', data: rows.map(d => d.negH || 0), backgroundColor: 'rgba(237,105,101,.75)', borderWidth: 0, yAxisID: 'y' },
        { type: 'line', label: 'Lowest price of the day (€/MWh)', data: rows.map(d => d.min == null ? null : d.min), borderColor: '#7FC8F8', borderWidth: 1.2, pointRadius: 0, yAxisID: 'y1' },
      ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('hours', { beginAtZero: true }), y1: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }) }, plugins: { legend: legend() } }) }, 'negative-hours-daily-' + p.zone);
      return { title: 'Daily negative hours and lowest price', sub: zname(p.zone) + ' · last ' + (p.win === 'all' ? 'available history' : p.win) };
    },
    async hour(cid, p) {
      const pr = await profile(), zp = pr && pr.zones && pr.zones[p.zone];
      if (!zp) { noDataMsg(cid, 'Hourly profile not available for ' + p.zone, ''); return null; }
      const years = Object.keys(zp).sort().slice(-4);
      const ds = years.map((y, i) => { const r = zp[y], tot = r.days.reduce((a, b) => a + b, 0), v = HRS.map((_, h) => tot ? Math.round(r.mh.reduce((a, row) => a + row[h], 0) / tot * 1000) / 10 : null);
        return _fuelLineDs(y + (y === cy() ? ' (YTD)' : ''), v, y === cy() ? RED : PAL[i % PAL.length], { borderWidth: y === cy() ? 2.6 : 1.6, tension: .3 }); });
      _fuelChart(cid, { type: 'line', data: { labels: HRS, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('% of days negative', { beginAtZero: true }) }, plugins: { legend: legend() } }) }, 'negative-hours-by-hour-' + p.zone);
      return { title: 'Hour of day · share of days with a negative price', sub: zname(p.zone) + ' · by year' };
    },
  };

  // HTML views: month × hour heatmap and calendar
  async function heatmapHTML(zone) {
    const pr = await profile(), zp = pr && pr.zones && pr.zones[zone];
    if (!zp) return '<div class="fuel-note">Hourly profile not available for ' + zone + '.</div>';
    const years = Object.keys(zp).sort().slice(-3), mh = MN.map(() => new Array(24).fill(0)), days = new Array(12).fill(0);
    years.forEach(y => zp[y].mh.forEach((row, m) => { days[m] += zp[y].days[m]; row.forEach((v, h) => { mh[m][h] += v; }); }));
    const pct = mh.map((row, m) => row.map(v => days[m] ? v / days[m] * 100 : 0)), max = Math.max(1, ...pct.flat());
    const col = v => v <= 0 ? 'transparent' : `rgba(237,105,101,${(0.12 + 0.88 * v / max).toFixed(2)})`;
    return `<div class="neg-hm"><table><thead><tr><th></th>${HRS.map((h, i) => `<th>${i % 3 ? '' : h}</th>`).join('')}</tr></thead><tbody>` +
      pct.map((row, m) => `<tr><th>${MN[m]}</th>${row.map((v, h) => `<td style="background:${col(v)}" title="${MN[m]} ${HRS[h]}: negative on ${v.toFixed(0)} % of days">${v >= 10 ? Math.round(v) : ''}</td>`).join('')}</tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">% of days with a negative price at each hour, ${years[0]}–${years[years.length - 1]} (${zname(zone)}). Darker = more often negative; figures shown from 10 %.</div>`;
  }
  async function calendarHTML(zone) {
    const s = await summary(), ser = s && s.zones && s.zones[zone];
    if (!ser) return '<div class="fuel-note">No history for ' + zone + '.</div>';
    const last = ser.slice(-371), max = Math.max(1, ...last.map(d => d.negH || 0));
    const col = v => !v ? 'var(--bg3)' : `rgba(237,105,101,${(0.25 + 0.75 * v / max).toFixed(2)})`;
    const pad = (new Date(last[0].d + 'T12:00:00Z').getUTCDay() + 6) % 7;
    let cells = '', months = '', prevM = '';
    for (let i = 0; i < pad; i++) cells += '<i class="neg-cal-x"></i>';
    last.forEach((d, i) => { cells += `<i style="background:${col(d.negH || 0)}" title="${d.d}: ${(d.negH || 0).toFixed(2)} h below 0${d.min != null ? ' · min ' + d.min.toFixed(1) + ' €/MWh' : ''}"></i>`;
      const m = d.d.slice(5, 7); if (m !== prevM && d.d.slice(8) <= '07') { months += `<span style="grid-column:${Math.floor((i + pad) / 7) + 1}">${MN[+m - 1]}</span>`; prevM = m; } });
    const negDays = last.filter(d => (d.negH || 0) > 0).length;
    const weeks = Math.ceil((last.length + pad) / 7), cols = `grid-template-columns:repeat(${weeks},minmax(9px,1fr))`;
    return `<div class="neg-cal-wrap"><div class="neg-cal-m" style="${cols}">${months}</div><div class="neg-cal" style="${cols}">${cells}</div></div>
      <div class="neg-cal-leg"><span>0 h</span><i style="background:var(--bg3)"></i><i style="background:rgba(237,105,101,.35)"></i><i style="background:rgba(237,105,101,.65)"></i><i style="background:rgba(237,105,101,1)"></i><span>${max.toFixed(0)} h</span>
      <span class="neg-cal-note">${negDays} days with a negative price over the last 12 months · hover a day for details</span></div>`;
  }

  // ── Catalogue widgets (☆ from the page with the current settings) ──
  if (window.PKW) {
    const CCV = [['year', 'By zone × year'], ['rank', 'Ranking'], ['season', 'Seasonality'], ['hour', 'Hour of day'], ['cumul', 'Pace this year']];
    const ZV = [['month', 'By month'], ['year', 'Per year'], ['cumul', 'Pace'], ['daily', 'Daily'], ['hour', 'Hour of day']];
    const WIN = { key: 'win', label: 'Window', options: [['1M', '1 month'], ['3M', '3 months'], ['1Y', '1 year'], ['2Y', '2 years'], ['5Y', '5 years'], ['all', 'All']] };
    PKW.register({ id: 'neg-crosszone', title: 'Negative prices · cross-zone', category: 'prices', page: 'prices', pageCanvas: 'neg-cc-canvas', source: 'ENTSO-E', size: { w: 12, h: 5 },
      desc: 'Negative-price hours across European zones: by zone and year, ranking, seasonality, hour of day, pace this year.',
      titleFn: p => 'Negative prices · ' + (CCV.find(v => v[0] === p.view) || CCV[0])[1],
      params: [{ key: 'view', label: 'View', options: CCV, inTitle: true }, WIN], defaults: { view: 'year', win: '1Y' },
      pageParams: () => ({ view: (window.NEGC_STATE || {}).cc || 'year', win: (window.NEGC_STATE || {}).win || '1Y' }),
      async draw(cid, p) { return (CC[p.view] || CC.year)(cid, p); } });
    PKW.register({ id: 'neg-zone', title: 'Negative prices · one zone', category: 'prices', page: 'prices', pageCanvas: 'neg-drill-canvas', source: 'ENTSO-E', size: { w: 12, h: 5 },
      desc: 'Negative-price hours of one zone: by month, per year, pace, daily with the lowest price, hour of day.',
      titleFn: p => 'Negative prices · ' + p.zone + ' · ' + (ZV.find(v => v[0] === p.view) || ZV[0])[1],
      params: [{ key: 'zone', label: 'Zone', options: ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'PT', 'IT_NORD', 'AT', 'CH', 'PL', 'CZ', 'HU', 'SE', 'FI', 'DK_W', 'DK_E', 'EE', 'LT', 'LV', 'GR', 'RO', 'BG', 'HR', 'SI', 'SK', 'RS', 'NO_1', 'ME', 'MK', 'IT_SICI'].map(z => [z, z]) },
        { key: 'view', label: 'View', options: ZV }, WIN], defaults: { zone: 'FR', view: 'month', win: '1Y' },
      pageParams: () => ({ zone: (window.NEGC_STATE || {}).zone || 'FR', view: (window.NEGC_STATE || {}).zv || 'month', win: (window.NEGC_STATE || {}).win || '1Y' }),
      async draw(cid, p) { return (ZONE[p.view] || ZONE.month)(cid, p); } });
    PKW.register({ id: 'neg-zone-heatmap', kind: 'html', title: 'Negative prices · month × hour', category: 'prices', page: 'prices', source: 'ENTSO-E', size: { w: 12, h: 6 },
      desc: 'How often each hour of each month has a negative price in a zone (last three years).',
      params: [{ key: 'zone', label: 'Zone', options: ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'PT', 'AT', 'CH', 'PL', 'SE', 'FI', 'DK_W'].map(z => [z, z]), inTitle: true }], defaults: { zone: 'FR' },
      pageParams: () => ({ zone: (window.NEGC_STATE || {}).zone || 'FR' }),
      async html(host, p) { host.innerHTML = await heatmapHTML(p.zone); } });
  }

  // Card markup: same head as every chart card of the site
  function card(id, title, sub, inner) {
    return `<div class="chart-container fuel-card neg-card"><div class="fuel-card-head"><div><div class="table-title" id="${id}-t">${title}</div><div class="fuel-card-sub" id="${id}-s">${sub}</div></div><span class="source-badge">ENTSO-E</span></div>${inner}</div>`;
  }
  async function drawInto(hostId, cid, wid, p, height) {
    const host = document.getElementById(hostId); if (!host) return;
    host.innerHTML = card(cid, '…', '', `<div style="position:relative;height:${height || 340}px"><canvas id="${cid}" style="width:100%;height:${height || 340}px"></canvas></div>`);
    const r = await PKW.draw(wid, cid, p);
    if (r) { const t = document.getElementById(cid + '-t'), s = document.getElementById(cid + '-s'); if (t && r.title) t.textContent = r.title; if (s && r.sub) s.textContent = r.sub; }
  }
  window.NegCharts = {
    cc(view, win) { window.NEGC_STATE = Object.assign(window.NEGC_STATE || {}, { cc: view, win }); return drawInto('neg-cc-chart', 'neg-cc-canvas', 'neg-crosszone', { view, win }); },
    async zone(code, view, win) {
      window.NEGC_STATE = Object.assign(window.NEGC_STATE || {}, { zone: code, zv: view, win });
      const hostId = 'neg-drill-chart-' + code, host = document.getElementById(hostId); if (!host) return;
      if (view === 'mh') { host.innerHTML = card('neg-hm', 'When do negative prices hit · month × hour', zname(code) + ' · % of days negative at each hour', '<div id="neg-hm-body"></div>'); document.getElementById('neg-hm-body').innerHTML = await heatmapHTML(code); PKW.star('neg-zone-heatmap', 'neg-hm-body'); return; }
      if (view === 'cal') { host.innerHTML = card('neg-cal', 'Calendar · negative hours per day', zname(code) + ' · last 12 months', '<div id="neg-cal-body"></div>'); document.getElementById('neg-cal-body').innerHTML = await calendarHTML(code); return; }
      return drawInto(hostId, 'neg-drill-canvas', 'neg-zone', { zone: code, view, win });
    },
  };

  const css = document.createElement('style');
  css.textContent = `
  .neg-card { margin-top: 10px; }
  .neg-hm { overflow-x: auto; }
  .neg-hm table { border-collapse: separate; border-spacing: 2px; width: 100%; min-width: 640px; font: 10px 'JetBrains Mono', monospace; }
  .neg-hm th { color: var(--text3); font-weight: 500; padding: 2px 4px; text-align: center; white-space: nowrap; }
  .neg-hm tbody th { text-align: right; padding-right: 8px; color: var(--text2); }
  .neg-hm td { height: 22px; border-radius: 3px; text-align: center; color: #fff; background: var(--bg3); font-size: 9.5px; }
  .neg-cal-wrap { overflow-x: auto; padding: 4px 0 2px; }
  .neg-cal-m { display: grid; gap: 3px; font: 10px 'JetBrains Mono', monospace; color: var(--text3); height: 15px; min-width: 520px; }
  .neg-cal { display: grid; grid-template-rows: repeat(7, auto); grid-auto-flow: column; gap: 3px; min-width: 520px; }
  .neg-cal i { display: block; width: 100%; aspect-ratio: 1; border-radius: 3px; }
  .neg-cal i.neg-cal-x { background: transparent; }
  .neg-cal-leg { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 10px; font: 10px 'JetBrains Mono', monospace; color: var(--text3); }
  .neg-cal-leg i { display: inline-block; width: 12px; height: 12px; border-radius: 2px; }
  .neg-cal-note { margin-left: 14px; }
  `;
  document.head.appendChild(css);
})();
