// ── NUCLEAR (France) ──────────────────────────────────────────────────
// Available capacity (actual + operator forecast) from SEFE's cockpit via
// window.PKC; output from the daily ENTSO-E generation files.
// Installed capacity: 57 reactors incl. Flamanville 3 (RTE, 2025).
const FR_NUC_INSTALLED_MW = 63000;

async function drawNuclear() {
  await PKC.ready; await PKC.loadFull();
  const av = PKC.pts('fr_nuc_avail', true), fc = PKC.pts('fr_nuc_avail_fc', true);
  if (!av.length) { document.getElementById('nuc-kpis').innerHTML = '<div class="fuel-note">No availability data.</div>'; return; }
  const last = av[av.length - 1], prev = av[av.length - 2];
  const lyISO = _renAdd(last[0], -364);
  const ly = PKC.valueOn('fr_nuc_avail', lyISO, true);
  const ytd = av.filter(p => p[0] >= last[0].slice(0, 4) + '-01-01'), ytdAvg = ytd.reduce((s, p) => s + p[1], 0) / ytd.length;
  const fcLast = fc[fc.length - 1];
  const GW = v => v == null ? '–' : (v / 1000).toFixed(1);
  const chg = prev ? last[1] - prev[1] : null;
  document.getElementById('nuc-upd').textContent = 'SEFE · ' + _fuelDate(last[0]);
  document.getElementById('nuc-kpis').innerHTML =
    _fuelKpi('Available', GW(last[1]), 'GW', chg == null ? '' : `<span style="color:${chg >= 0 ? 'var(--up)' : 'var(--down)'}">${chg >= 0 ? '▲' : '▼'} ${(Math.abs(chg) / 1000).toFixed(2)} GW</span> d/d`) +
    _fuelKpi('Unavailable', GW(FR_NUC_INSTALLED_MW - last[1]), 'GW', `of ${GW(FR_NUC_INSTALLED_MW)} GW installed`, 'down') +
    _fuelKpi('Availability factor', (last[1] / FR_NUC_INSTALLED_MW * 100).toFixed(1), '%', _fuelDate(last[0])) +
    _fuelKpi('vs last year', ly == null ? '–' : _fuelSigned((last[1] - ly) / 1000, 1), 'GW', ly == null ? '' : `same weekday ${_fuelDate(lyISO)}: ${GW(ly)} GW`, ly == null ? null : (last[1] >= ly ? 'up' : 'down')) +
    _fuelKpi('YTD average', GW(ytdAvg), 'GW', (ytdAvg / FR_NUC_INSTALLED_MW * 100).toFixed(1) + '% availability') +
    _fuelKpi('Operator forecast', GW(fcLast && fcLast[1]), 'GW', fcLast ? 'as published ' + _fuelDate(fcLast[0]) : '');

  // 1 · History with forecast and installed capacity
  const from = _fuelWindowStart('nuc'), to = _fuelWindowEnd('nuc');
  const j = _fuelJoin([PKC.asMap('fr_nuc_avail', true), PKC.asMap('fr_nuc_avail_fc', true)], from, to);
  const g = a => a.map(v => v == null ? null : Math.round(v / 10) / 100);
  _fuelChart('nuc-hist', { type: 'line', data: { labels: j.labels, datasets: [
    _fuelLineDs('Available (actual)', g(j.cols[0]), C_NUC, { borderWidth: 2, fill: true, backgroundColor: rgba('#7B4B9C', .12) }),
    _fuelLineDs('Operator forecast', g(j.cols[1]), '#C4A7E7', { borderDash: [5, 4], borderWidth: 1.3 }),
  ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { min: 0, suggestedMax: 66 }) },
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
      annotation: { annotations: { inst: { type: 'line', yMin: FR_NUC_INSTALLED_MW / 1000, yMax: FR_NUC_INSTALLED_MW / 1000, borderColor: 'rgba(184,201,217,.45)', borderWidth: 1, borderDash: [4, 4],
        label: { display: true, content: 'Installed ' + GW(FR_NUC_INSTALLED_MW) + ' GW', position: 'start', color: C_TX2, backgroundColor: 'rgba(10,14,22,.8)', font: { size: 9 } } } } } } }) }, 'fr-nuclear-availability');

  // 2 · Seasonal: current year vs previous 5 years (day of year)
  const by = {};
  av.forEach(([d, v]) => { const y = d.slice(0, 4); const doy = Math.floor((Date.parse(d) - Date.parse(y + '-01-01')) / 864e5); (by[y] = by[y] || [])[doy] = v; });
  const cy = +last[0].slice(0, 4), prevY = []; for (let y = cy - 5; y < cy; y++) if (by[y]) prevY.push(by[y]);
  const labels = [], mn = [], mx = [], avg = [], cur = [];
  for (let i = 0; i < 366; i++) {
    labels.push(new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }));
    const v = prevY.map(a => a[i]).filter(x => x != null);
    mn.push(v.length ? Math.min(...v) / 1000 : null); mx.push(v.length ? Math.max(...v) / 1000 : null);
    avg.push(v.length ? v.reduce((a, b) => a + b, 0) / v.length / 1000 : null);
    cur.push(by[cy] && by[cy][i] != null ? by[cy][i] / 1000 : null);
  }
  _fuelChart('nuc-season', { type: 'line', data: { labels, datasets: [
    _fuelLineDs(`${cy - 5}–${cy - 1} range`, mx, C_TX3, { borderWidth: 0, fill: '+1', backgroundColor: 'rgba(122,147,171,.14)' }),
    _fuelLineDs('min', mn, C_TX3, { borderWidth: 0 }),
    _fuelLineDs('5-year average', avg, C_TX2, { borderDash: [4, 3], borderWidth: 1.2 }),
    _fuelLineDs(String(cy), cur, C_NUC, { borderWidth: 2 }),
  ] }, options: _fuelOpts({
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10, filter: it => it.text !== 'min' } }, zoom: ZOOM_CFG },
    scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 } }), y: _fuelAxis('GW', { suggestedMin: 25 }) } }) }, 'fr-nuclear-seasonal');

  // 3 · Output vs availability over days with generation data
  const days = (await _renDaysWithGen('FR')).filter(d => d >= from && d <= to);
  const files = await Promise.all(days.map(_renDaily));
  const rows = days.map((d, i) => {
    const z = files[i] && files[i].zones && files[i].zones.FR;
    const out = z && _renMean(z.nuclear);
    return out ? { d, out: out / 1000, avail: (PKC.valueOn('fr_nuc_avail', d, true) || 0) / 1000 } : null;
  }).filter(Boolean);
  if (rows.length) {
    _renRestore('nuc-mod');
    _fuelChart('nuc-mod', { type: 'line', data: { labels: rows.map(r => r.d), datasets: [
      _fuelLineDs('Available', rows.map(r => +r.avail.toFixed(2)), '#C4A7E7', { borderWidth: 1.5, pointRadius: 2 }),
      _fuelLineDs('Output', rows.map(r => +r.out.toFixed(2)), C_NUC, { borderWidth: 2, pointRadius: 2, fill: true, backgroundColor: rgba('#7B4B9C', .14) }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { suggestedMin: 25 }) } }) }, 'fr-nuclear-modulation');
    const mod = rows.map(r => r.avail - r.out).filter(v => v > 0);
    document.getElementById('nuc-mod-sub').textContent = `Daily average output vs available capacity (GW) · mean modulation ${(mod.reduce((a, b) => a + b, 0) / (mod.length || 1)).toFixed(1)} GW over ${rows.length} days`;
  } else if (typeof noDataMsg === 'function') {
    noDataMsg('nuc-mod', 'No ENTSO-E nuclear output archived in this period', 'Output history exists for the days with generation data (see Renewables coverage).');
  }
  document.getElementById('nuc-note').textContent =
    `Available capacity = daily average of the capacity declared available by the operator (SEFE cockpit, from ${_fuelDate(av[0][0])}); the forecast series is the operator's day-ahead view as published each day. ` +
    `Installed capacity ${GW(FR_NUC_INSTALLED_MW)} GW (57 reactors, incl. Flamanville 3). Output − availability gap = modulation / load-following.`;
}

// ── IMBALANCE PRICES ──────────────────────────────────────────────────
// Belgium: Elia open data (Opendatasoft, CORS-enabled, no key) —
// ods162 = today near real time, ods134 = validated history; 15-min
// single imbalance price and system imbalance (MW, negative = short).
// Day-ahead reference: BE daily history files (ENTSO-E).
const ELIA = 'https://opendata.elia.be/api/explore/v2.1/catalog/datasets/';
const IMB = { day: null, cache: new Map() };
function imbShiftDay(n) {
  const t = pkTodayISO();
  IMB.day = n === 0 ? t : _renAdd(IMB.day || t, n);
  if (IMB.day > t) IMB.day = t;
  drawImbalance();
}
function _eliaRange(ds, fromUTC, toUTC) {
  const k = ds + fromUTC + toUTC;
  if (!IMB.cache.has(k)) {
    const where = `datetime>="${fromUTC}" and datetime<"${toUTC}"`;
    const url = ELIA + ds + '/exports/json?select=datetime,imbalanceprice,systemimbalance&where=' + encodeURIComponent(where) + '&order_by=datetime';
    IMB.cache.set(k, fetch(url).then(r => r.ok ? r.json() : null).catch(() => null));
  }
  return IMB.cache.get(k);
}
async function _imbDay(dateISO) {
  const [a, b] = PK_E2M.dayBoundsUTC(dateISO);
  let rows = await _eliaRange('ods134', a, b);
  if (!rows || !rows.length) rows = await _eliaRange('ods162', a, b);
  if (!rows || !rows.length) return null;
  const t0 = Date.parse(a + 'Z'), price = new Array(96).fill(null), sys = new Array(96).fill(null);
  rows.forEach(r => { const i = Math.round((Date.parse(r.datetime) - t0) / 900e3); if (i >= 0 && i < 96) { price[i] = r.imbalanceprice; sys[i] = r.systemimbalance; } });
  return { price, sys };
}
async function _daDay(zone, dateISO) {
  const j = await _renDaily(dateISO);
  const z = j && j.zones && j.zones[zone];
  if (!z || !z.hourly) return null;
  const h = z.hourly; return h.length === 96 ? h : (typeof upsampleHourly === 'function' ? upsampleHourly(h) : null);
}

async function drawImbalance() {
  const zone = 'BE';
  const day = IMB.day || pkTodayISO();
  document.getElementById('imb-day').textContent = _renFmtDay(day);
  ['imb-intraday', 'imb-days', 'imb-dist'].forEach(_renRestore);
  const [im, da] = await Promise.all([_imbDay(day), _daDay(zone, day)]);
  if (!im) {
    document.getElementById('imb-kpis').innerHTML = `<div class="fuel-note" style="grid-column:1/-1">No Elia imbalance data for ${_renFmtDay(day)}.</div>`;
    noDataMsg('imb-intraday', 'No data for this day', '');
  } else {
    const lbl = makeTimeLabels(96), ip = im.price, vI = ip.filter(v => v != null);
    const lastI = ip.map((v, i) => v != null ? i : -1).filter(i => i >= 0).pop();
    const avgI = vI.reduce((a, b) => a + b, 0) / vI.length;
    const pairs = ip.map((v, i) => v != null && da && da[i] != null ? v - da[i] : null);
    const vp = pairs.filter(v => v != null);
    const avgDA = da ? _renMean(da.slice(0, lastI + 1)) : null;
    const short = im.sys.filter(v => v != null && v < 0).length, nS = im.sys.filter(v => v != null).length;
    const sd = Math.sqrt(vI.reduce((s, v) => s + (v - avgI) ** 2, 0) / vI.length);
    document.getElementById('imb-kpis').innerHTML =
      _fuelKpi('Latest imbalance price', _fuelFmt(ip[lastI]), '€/MWh', `${lbl[lastI]} · system ${im.sys[lastI] < 0 ? 'short' : 'long'} ${Math.abs(im.sys[lastI]).toFixed(0)} MW`) +
      _fuelKpi('Average', _fuelFmt(avgI), '€/MWh', `${vI.length}/96 quarter-hours`) +
      _fuelKpi('Day-ahead (same slots)', _fuelFmt(avgDA), '€/MWh', 'BE, ENTSO-E') +
      _fuelKpi('Imbalance − DA', vp.length ? _fuelSigned(vp.reduce((a, b) => a + b, 0) / vp.length) : '–', '€/MWh', vp.length ? `max |spread| ${Math.max(...vp.map(Math.abs)).toFixed(0)} €/MWh` : '', vp.length ? (vp.reduce((a, b) => a + b, 0) > 0 ? 'down' : 'up') : null) +
      _fuelKpi('Volatility', sd.toFixed(1), '€/MWh', 'std dev of quarter-hour prices') +
      _fuelKpi('System short', nS ? (short / nS * 100).toFixed(0) : '–', '%', `${short} of ${nS} quarter-hours`);
    _fuelChart('imb-intraday', { type: 'bar', data: { labels: lbl, datasets: [
      { type: 'line', label: 'Imbalance price', data: ip, borderColor: '#ED6965', borderWidth: 1.6, pointRadius: 0, tension: 0, yAxisID: 'y', order: -2 },
      { type: 'line', label: 'Day-ahead', data: da || [], borderColor: '#FFFFFF', borderWidth: 1.4, borderDash: [4, 3], pointRadius: 0, tension: 0, yAxisID: 'y', order: -1 },
      { label: 'System imbalance (MW)', data: im.sys, backgroundColor: im.sys.map(v => v == null ? 'transparent' : v < 0 ? 'rgba(237,105,101,.28)' : 'rgba(20,211,169,.28)'), yAxisID: 'y1', barPercentage: 1, categoryPercentage: 1 },
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 13, maxRotation: 0 } }),
      y: _fuelAxis('€/MWh', { position: 'left' }), y1: _fuelAxis('MW', { position: 'right', grid: { display: false } }) },
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
        annotation: { annotations: (() => { const a = nowLineAnnotation({ slots: 96, labels: lbl, chartDate: day }); return a ? { nowLine: a } : {}; })() } } }) }, 'be-imbalance-' + day);
    document.getElementById('imb-intraday-title').textContent = 'Imbalance price vs day-ahead · Belgium · ' + _renFmtDay(day);
    const top = ip.map((v, i) => ({ i, v, d: da && da[i], s: pairs[i] })).filter(x => x.s != null).sort((a, b) => Math.abs(b.s) - Math.abs(a.s)).slice(0, 10);
    document.getElementById('imb-tbody').innerHTML = top.map(x =>
      `<tr><td>${lbl[x.i]}</td><td>${_fuelFmt(x.v)}</td><td>${_fuelFmt(x.d)}</td><td style="color:${x.s > 0 ? 'var(--down)' : 'var(--up)'};font-weight:600">${_fuelSigned(x.s)}</td>` +
      `<td>${im.sys[x.i] == null ? '–' : im.sys[x.i].toFixed(0) + ' MW'}</td><td class="l" style="text-align:left">${im.sys[x.i] < 0 ? '<span style="color:var(--down)">System short</span>' : '<span style="color:var(--up)">System long</span>'}</td></tr>`).join('');
  }

  // 30-day history (validated dataset) + DA from daily files
  const from = PK_E2M.dayBoundsUTC(_renAdd(day, -30))[0], to = PK_E2M.dayBoundsUTC(_renAdd(day, -1))[1];
  const rows = await _eliaRange('ods134', from, to) || [];
  const byDay = {};
  rows.forEach(r => { const d = new Date(r.datetime).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }); (byDay[d] = byDay[d] || []).push(r.imbalanceprice); });
  const days = Object.keys(byDay).sort();
  const das = await Promise.all(days.map(d => _daDay(zone, d)));
  const avgs = days.map(d => { const v = byDay[d].filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; });
  const sds = days.map((d, k) => { const v = byDay[d].filter(x => x != null); const m = avgs[k]; return v.length ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) : null; });
  const r2 = v => v == null ? null : Math.round(v * 100) / 100;
  if (days.length) {
    _fuelChart('imb-days', { type: 'line', data: { labels: days.map(d => d.slice(8, 10) + '/' + d.slice(5, 7)), datasets: [
      _fuelLineDs('Imbalance avg', avgs.map(r2), '#ED6965', { borderWidth: 2, pointRadius: 2 }),
      _fuelLineDs('Day-ahead avg', das.map(a => r2(a ? _renMean(a) : null)), '#FFFFFF', { borderDash: [4, 3], pointRadius: 2 }),
      _fuelLineDs('Imbalance std dev', sds.map(r2), '#FBBF24', { borderWidth: 1.2, pointRadius: 0 }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') } }) }, 'be-imbalance-30d');
    // Distribution of quarter-hour spreads
    const spreads = [];
    days.forEach((d, k) => {
      const da = das[k]; if (!da) return;
      const [a] = PK_E2M.dayBoundsUTC(d), t0 = Date.parse(a + 'Z');
      rows.forEach(r => { const dd = new Date(r.datetime).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }); if (dd !== d || r.imbalanceprice == null) return;
        const i = Math.round((Date.parse(r.datetime) - t0) / 900e3); if (da[i] != null) spreads.push(r.imbalanceprice - da[i]); });
    });
    const edges = [-300, -150, -100, -50, -25, 0, 25, 50, 100, 150, 300];
    const bins = new Array(edges.length + 1).fill(0);
    spreads.forEach(v => { let k = 0; while (k < edges.length && v >= edges[k]) k++; bins[k]++; });
    const blabels = ['< -300'].concat(edges.slice(0, -1).map((e, k) => `${e} … ${edges[k + 1]}`)).concat(['> 300']);
    _fuelChart('imb-dist', { type: 'bar', data: { labels: blabels, datasets: [{ label: 'Quarter-hours', data: bins,
      backgroundColor: blabels.map((_, k) => k <= 5 ? rgba('#14D3A9', .6) : rgba('#ED6965', .6)), borderRadius: 2 }] },
      options: _fuelOpts({ plugins: { legend: { display: false }, zoom: ZOOM_CFG }, scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 9 }, autoSkip: false, maxRotation: 45 } }), y: _fuelAxis('quarter-hours', { beginAtZero: true }) } }) }, 'be-imbalance-spread-dist');
    const med = spreads.slice().sort((a, b) => a - b)[Math.floor(spreads.length / 2)];
    document.getElementById('imb-dist-sub').textContent = `Imbalance − day-ahead, ${spreads.length} quarter-hours over ${days.length} days · median ${med == null ? '–' : med.toFixed(1)} €/MWh`;
  }
  document.getElementById('imb-note').textContent = 'Elia single imbalance price (incl. alpha component) per quarter-hour; today from the near-real-time dataset (not validated), earlier days from the validated history. ' +
    'Day-ahead = BE ENTSO-E price for the same quarter-hour. France (RTE), Germany (reBAP) and the Netherlands (TenneT) require API access that is not wired up yet.';
}

// ── OUTAGES & REMIT ───────────────────────────────────────────────────
async function renderRemit() {
  await PKC.ready; await PKC.loadFull();
  const av = PKC.pts('fr_nuc_avail', true), fc = PKC.pts('fr_nuc_avail_fc', true);
  if (!av.length) return;
  const I = FR_NUC_INSTALLED_MW, last = av[av.length - 1];
  const un = v => v == null ? null : (I - v) / 1000;
  // Same calendar day, previous 5 years
  const prevYears = [1, 2, 3, 4, 5].map(k => PKC.valueOn('fr_nuc_avail', (+last[0].slice(0, 4) - k) + last[0].slice(4), true)).filter(v => v != null);
  const avg5 = prevYears.length ? prevYears.reduce((a, b) => a + b, 0) / prevYears.length : null;
  const fcLast = fc[fc.length - 1];
  document.getElementById('remit-upd').textContent = 'SEFE · ' + _fuelDate(last[0]);
  document.getElementById('remit-kpis').innerHTML =
    _fuelKpi('FR nuclear unavailable', un(last[1]).toFixed(1), 'GW', _fuelDate(last[0]), 'down') +
    _fuelKpi('Share of fleet', ((I - last[1]) / I * 100).toFixed(1), '%', 'of 63.0 GW installed') +
    _fuelKpi('vs 5-year same date', avg5 == null ? '–' : _fuelSigned(un(last[1]) - un(avg5), 1), 'GW', avg5 == null ? '' : `5y avg ${un(avg5).toFixed(1)} GW unavailable`, avg5 == null ? null : (last[1] >= avg5 ? 'up' : 'down')) +
    _fuelKpi('Operator forecast', fcLast ? un(fcLast[1]).toFixed(1) : '–', 'GW', fcLast ? 'unavailable, as of ' + _fuelDate(fcLast[0]) : '') +
    _fuelKpi('180-day max', Math.max(...av.slice(-180).map(p => un(p[1]))).toFixed(1), 'GW', 'unavailable') +
    _fuelKpi('180-day min', Math.min(...av.slice(-180).map(p => un(p[1]))).toFixed(1), 'GW', 'unavailable');
  const from = _renAdd(last[0], -180);
  const j = _fuelJoin([PKC.asMap('fr_nuc_avail', true), PKC.asMap('fr_nuc_avail_fc', true)], from, '9999');
  _fuelChart('remit-unavail', { type: 'line', data: { labels: j.labels, datasets: [
    _fuelLineDs('Unavailable (actual)', j.cols[0].map(v => v == null ? null : +un(v).toFixed(2)), C_DN, { borderWidth: 2, fill: true, backgroundColor: rgba(C_DN, .12) }),
    _fuelLineDs('Unavailable (operator forecast)', j.cols[1].map(v => v == null ? null : +un(v).toFixed(2)), '#F4A3A0', { borderDash: [5, 4], borderWidth: 1.3 }),
  ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { beginAtZero: true }) } }) }, 'fr-nuclear-unavailability');
}
