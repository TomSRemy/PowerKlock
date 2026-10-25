// ════════════════════════════════════════════════════════════════════
// FRANCE SYSTEM — the French power system from RTE éCO2mix, day by day
// and since 2015 (the éCO2mix views, in PowerKlock's catalogue).
//   Day:     production by source with consumption and D-1 forecast,
//            CO2 intensity, commercial exchanges per border, pumped
//            storage and batteries (15-min, Paris clock).
//   History: monthly energy by source, this year against the min–max
//            range of previous years, annual balance.
// Sources: js/fr-rte.js (archive data/history/rte + live ODRÉ),
// data/history/rte/fr_daily.json, js/eco2mix.js (exchanges per border).
// ════════════════════════════════════════════════════════════════════
const FRS = { day: null, envSeries: 'nuclear', monthlyView: 'twh' };
const FRS_COLORS = { nuclear: '#7B4B9C', hydro: '#3FA6B4', hydroPS: '#60A5FA', windOn: '#14D3A9', windOff: '#0EA5E9', wind: '#14D3A9', solar: '#FBBF24',
  gas: '#F97316', coal: '#78716C', oil: '#B45309', bio: '#94D2BD', battery: '#E879F9', pumping: '#1E3A8A', load: '#F8FAFC' };
const FRS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _frsToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()); }
function _frsAdd(iso, n) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function _frsFmtDay(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
const _frsLabels = () => Array.from({ length: 96 }, (_, i) => String(Math.floor(i / 4)).padStart(2, '0') + ':' + String(i % 4 * 15).padStart(2, '0'));
const _frsGW = a => Array.isArray(a) ? a.map(v => v == null ? null : Math.round(v) / 1000) : null;
const _frsSum = (...arrs) => { const a = arrs.filter(Array.isArray); if (!a.length) return null; return a[0].map((_, i) => { let s = null; a.forEach(x => { if (x[i] != null) s = (s || 0) + x[i]; }); return s; }); };
const _frsPos = a => Array.isArray(a) ? a.map(v => v == null ? null : Math.max(0, v)) : null;
const _frsNeg = a => Array.isArray(a) ? a.map(v => v == null ? null : Math.min(0, v)) : null;

let _frsDailyP = null;
function _frsDaily() {
  if (!_frsDailyP) _frsDailyP = fetch(DATA_BASE + 'history/rte/fr_daily.json').then(r => r.ok ? r.json() : null).then(j => j && j.rows || null).catch(() => null);
  return _frsDailyP;
}
async function _frsDay(iso) { return window.pkRte ? window.pkRte.day(iso) : null; }
async function _frsLatestDay() {
  const t = _frsToday();
  for (let i = 0; i < 4; i++) { const d = _frsAdd(t, -i); const R = await _frsDay(d); if (R && R.nuclear && R.nuclear.some(v => v != null)) return d; }
  return _frsAdd(t, -1);
}
const FRS_DAY_PARAM = { key: 'day', label: 'Day', options: [['latest', 'Latest'], ['yesterday', 'Yesterday']] };
async function _frsResolve(p) { return p.day && /^\d{4}-/.test(p.day) ? p.day : p.day === 'yesterday' ? _frsAdd(_frsToday(), -1) : await _frsLatestDay(); }
const _frsArea = (label, data, col, stack, extra) => Object.assign({ type: 'line', label, data, backgroundColor: col + 'D9', borderColor: col, borderWidth: 0.6, fill: true, stack: stack || 'p', pointRadius: 0, tension: 0.2, yAxisID: 'y' }, extra || {});

function _frsReg(def) {
  if (!window.PKW) return;
  PKW.register(Object.assign({ category: 'france', page: 'frsystem', source: 'RTE éCO2mix', size: { w: 12, h: 5 } }, def));
}

_frsReg({
  id: 'fr-sys-prod', title: 'France production by source', pageCanvas: 'frs-prod',
  desc: 'Quarter-hour production by source with consumption and the D-1 forecast (RTE éCO2mix); pumping and battery charging below zero.',
  params: [FRS_DAY_PARAM], defaults: { day: 'latest' },
  async draw(cid, p) {
    const day = await _frsResolve(p), R = await _frsDay(day);
    if (!R || !R.nuclear) { noDataMsg(cid, 'No RTE data for ' + _frsFmtDay(day), ''); return { day }; }
    const split = Array.isArray(R.windOnshore) && R.windOnshore.some(v => v != null);
    const hydroNoPS = Array.isArray(R.hydroRoR) || Array.isArray(R.hydroLake) ? _frsSum(R.hydroRoR, R.hydroLake) : R.hydro;
    const ds = [
      _frsArea('Nuclear', _frsGW(R.nuclear), FRS_COLORS.nuclear),
      _frsArea('Hydro', _frsGW(hydroNoPS), FRS_COLORS.hydro),
      Array.isArray(R.hydroPS) ? _frsArea('Pumped-storage turbining', _frsGW(R.hydroPS), FRS_COLORS.hydroPS) : null,
      split ? _frsArea('Wind onshore', _frsGW(R.windOnshore), FRS_COLORS.windOn) : _frsArea('Wind', _frsGW(R.wind), FRS_COLORS.wind),
      split ? _frsArea('Wind offshore', _frsGW(R.windOffshore), FRS_COLORS.windOff) : null,
      _frsArea('Solar', _frsGW(R.solar), FRS_COLORS.solar),
      _frsArea('Bioenergy', _frsGW(R.bio), FRS_COLORS.bio),
      _frsArea('Gas', _frsGW(R.gas), FRS_COLORS.gas),
      _frsArea('Coal', _frsGW(R.coal), FRS_COLORS.coal),
      _frsArea('Oil', _frsGW(R.oil), FRS_COLORS.oil),
      Array.isArray(R.batteryDischarge) ? _frsArea('Battery discharge', _frsGW(R.batteryDischarge), FRS_COLORS.battery) : null,
      Array.isArray(R.pumping) ? _frsArea('Pumping', _frsGW(_frsNeg(R.pumping)), FRS_COLORS.pumping, 'n') : null,
      Array.isArray(R.batteryCharge) ? _frsArea('Battery charge', _frsGW(_frsNeg(R.batteryCharge)), FRS_COLORS.battery, 'n') : null,
      { type: 'line', label: 'Consumption', data: _frsGW(R.load), borderColor: FRS_COLORS.load, borderWidth: 1.8, pointRadius: 0, fill: false, yAxisID: 'y', stack: 'l1', tension: 0.2 },
      Array.isArray(R.loadForecastD1) ? { type: 'line', label: 'Consumption forecast D-1', data: _frsGW(R.loadForecastD1), borderColor: 'rgba(248,250,252,.55)', borderDash: [4, 3], borderWidth: 1.2, pointRadius: 0, fill: false, yAxisID: 'y', stack: 'l2', tension: 0.2 } : null,
    ].filter(d => d && Array.isArray(d.data) && d.data.some(v => v));
    _fuelChart(cid, { type: 'line', data: { labels: _frsLabels(), datasets: ds },
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 } }), y: _fuelAxis('GW', { stacked: true }) },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } }, zoom: ZOOM_CFG } }) }, 'fr-production-' + day);
    return { day, R };
  },
});

_frsReg({
  id: 'fr-sys-co2', title: 'France CO₂ intensity', pageCanvas: 'frs-co2', size: { w: 6, h: 5 },
  desc: 'Quarter-hour carbon intensity of French generation published by RTE (g CO₂/kWh, direct emissions).',
  params: [FRS_DAY_PARAM], defaults: { day: 'latest' },
  async draw(cid, p) {
    const day = await _frsResolve(p), R = await _frsDay(day);
    if (!R || !Array.isArray(R.co2)) { noDataMsg(cid, 'No CO₂ data for ' + _frsFmtDay(day), ''); return { day }; }
    const col = v => v == null ? 'transparent' : v < 30 ? '#2AA364' : v < 60 ? '#9CC94B' : v < 100 ? '#F5EB4D' : v < 150 ? '#F59E0B' : '#C2410C';
    _fuelChart(cid, { type: 'bar', data: { labels: _frsLabels(), datasets: [{ label: 'CO₂ intensity', data: R.co2, backgroundColor: R.co2.map(col), borderWidth: 0, barPercentage: 1, categoryPercentage: 1 }] },
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 8, maxRotation: 0 } }), y: _fuelAxis('g/kWh', { beginAtZero: true }) },
        plugins: { legend: { display: false } } }) }, 'fr-co2-' + day);
    const v = R.co2.filter(x => x != null);
    return { day, avg: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null };
  },
});

_frsReg({
  id: 'fr-sys-exch', title: 'France commercial exchanges by border', pageCanvas: 'frs-exch', size: { w: 6, h: 5 },
  desc: 'Commercial exchanges per border, quarter-hour (GW, + import, − export), with physical net exchange (RTE éCO2mix).',
  params: [FRS_DAY_PARAM], defaults: { day: 'latest' },
  async draw(cid, p) {
    const day = await _frsResolve(p);
    const E = window.PK_E2M ? await PK_E2M.day(day).catch(() => null) : null;
    const R = await _frsDay(day);
    const borders = [['ech_comm_allemagne_belgique', 'Germany + Belgium', '#FBBF24'], ['ech_comm_angleterre', 'Great Britain', '#7FC8F8'],
      ['ech_comm_suisse', 'Switzerland', '#ED6965'], ['ech_comm_italie', 'Italy', '#14D3A9'], ['ech_comm_espagne', 'Spain', '#C4A57B']];
    const ds = E ? borders.filter(([k]) => Array.isArray(E[k]) && E[k].some(v => v != null)).map(([k, l, c]) =>
      ({ type: 'bar', label: l, data: _frsGW(E[k]), backgroundColor: c + 'CC', borderWidth: 0, stack: 'e', barPercentage: 1, categoryPercentage: 1 })) : [];
    if (R && Array.isArray(R.exchanges)) ds.push({ type: 'line', label: 'Physical net', data: _frsGW(R.exchanges), borderColor: '#F8FAFC', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.2 });
    if (!ds.length) { noDataMsg(cid, 'No exchange data for ' + _frsFmtDay(day), ''); return { day }; }
    _fuelChart(cid, { type: 'bar', data: { labels: _frsLabels(), datasets: ds },
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true, ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 8, maxRotation: 0 } }), y: _fuelAxis('GW (+ import)', { stacked: true }) },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } } }) }, 'fr-exchanges-' + day);
    return { day };
  },
});

_frsReg({
  id: 'fr-sys-flex', title: 'France pumped storage and batteries', pageCanvas: 'frs-flex', size: { w: 6, h: 5 },
  desc: 'Pumped-storage turbining and pumping, battery discharge and charge (GW), with the day-ahead price.',
  params: [FRS_DAY_PARAM], defaults: { day: 'latest' },
  async draw(cid, p) {
    const day = await _frsResolve(p), R = await _frsDay(day);
    if (!R) { noDataMsg(cid, 'No RTE data for ' + _frsFmtDay(day), ''); return { day }; }
    const bar = (l, a, c) => Array.isArray(a) && a.some(v => v) ? { type: 'bar', label: l, data: _frsGW(a), backgroundColor: c, borderWidth: 0, stack: 's', barPercentage: 1, categoryPercentage: 1, yAxisID: 'y' } : null;
    const ds = [bar('Turbining', R.hydroPS, FRS_COLORS.hydroPS), bar('Pumping', R.pumping, FRS_COLORS.pumping),
      bar('Battery discharge', R.batteryDischarge, FRS_COLORS.battery), bar('Battery charge', R.batteryCharge, '#A21CAF')].filter(Boolean);
    const daily = await fetch(DATA_BASE + 'history/daily/' + day + '.json').then(r => r.ok ? r.json() : null).catch(() => null);
    const price = daily && daily.zones && daily.zones.FR && daily.zones.FR.hourly;
    if (Array.isArray(price)) ds.push({ type: 'line', label: 'Day-ahead FR', data: price, borderColor: '#F8FAFC', borderWidth: 1.4, pointRadius: 0, fill: false, yAxisID: 'y2', tension: 0.15 });
    if (!ds.length) { noDataMsg(cid, 'No storage data for ' + _frsFmtDay(day), ''); return { day }; }
    _fuelChart(cid, { type: 'bar', data: { labels: _frsLabels(), datasets: ds },
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true, ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 8, maxRotation: 0 } }), y: _fuelAxis('GW', { stacked: true }),
        y2: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }) },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } } }) }, 'fr-storage-' + day);
    return { day };
  },
});

// ── history ──
const FRS_SOURCES = [['nuclearAvg', 'Nuclear', 'nuclear'], ['hydroAvg', 'Hydro', 'hydro'], ['windAvg', 'Wind', 'wind'], ['solarAvg', 'Solar', 'solar'],
  ['bioAvg', 'Bioenergy', 'bio'], ['gasAvg', 'Gas', 'gas'], ['coalAvg', 'Coal', 'coal'], ['oilAvg', 'Oil', 'oil']];
function _frsMonthly(rows) {
  const by = new Map();
  rows.forEach(r => { const k = r.d.slice(0, 7); if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
  return [...by.entries()].map(([m, a]) => {
    const twh = key => a.reduce((s, r) => s + (r[key] || 0) * 24, 0) / 1e6;   // MW daily avg × 24 h → TWh
    const o = { m, days: a.length, load: twh('loadAvg'), exch: twh('exchAvg') };
    FRS_SOURCES.forEach(([k]) => { o[k] = twh(k); });
    const co2 = a.filter(r => r.co2Avg != null); o.co2 = co2.length ? co2.reduce((s, r) => s + r.co2Avg, 0) / co2.length : null;
    return o;
  });
}

_frsReg({
  id: 'fr-sys-monthly', title: 'France monthly production by source', pageCanvas: 'frs-monthly',
  desc: 'Monthly French electricity production by source since 2015 (TWh or share), with consumption (RTE éCO2mix).',
  params: [{ key: 'view', label: 'View', options: [['twh', 'TWh'], ['share', '% of production']] }, { key: 'win', label: 'Window', options: [['3Y', '3 years'], ['5Y', '5 years'], ['All', 'Since 2015']] }],
  defaults: { view: 'twh', win: 'All' },
  async draw(cid, p) {
    const rows = await _frsDaily();
    if (!rows) { noDataMsg(cid, 'RTE history not available', ''); return null; }
    let ms = _frsMonthly(rows);
    if (ms.length && ms[ms.length - 1].days < 20) ms = ms.slice(0, -1);   // month in progress
    if (p.win !== 'All') ms = ms.slice(-12 * parseInt(p.win, 10));
    const share = p.view === 'share';
    const ds = FRS_SOURCES.map(([k, l, c]) => ({ type: 'bar', label: l, stack: 'p', borderWidth: 0, backgroundColor: FRS_COLORS[c],
      data: ms.map(m => { const tot = FRS_SOURCES.reduce((s, [kk]) => s + m[kk], 0); return share ? (tot ? Math.round(m[k] / tot * 1000) / 10 : null) : Math.round(m[k] * 100) / 100; }) }));
    if (!share) ds.push({ type: 'line', label: 'Consumption', data: ms.map(m => Math.round(m.load * 100) / 100), borderColor: '#F8FAFC', borderWidth: 1.6, pointRadius: 0, fill: false });
    _fuelChart(cid, { type: 'bar', data: { labels: ms.map(m => FRS_MONTHS[+m.m.slice(5) - 1] + ' ' + m.m.slice(0, 4)), datasets: ds },
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis(share ? '% of production' : 'TWh', { stacked: true, max: share ? 100 : undefined }) },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } }, zoom: ZOOM_CFG } }) }, 'fr-monthly-' + p.view);
    return { sub: ms.length + ' months · ' + ms[0].m + ' → ' + ms[ms.length - 1].m };
  },
});

const FRS_ENV = { nuclear: ['nuclearAvg', 'Nuclear output', 'GW', 1000], load: ['loadAvg', 'Consumption', 'GW', 1000], wind: ['windAvg', 'Wind output', 'GW', 1000],
  solar: ['solarAvg', 'Solar output', 'GW', 1000], hydro: ['hydroAvg', 'Hydro output', 'GW', 1000], exch: ['exchAvg', 'Net import (− = export)', 'GW', 1000], co2: ['co2Avg', 'CO₂ intensity', 'g/kWh', 1] };
_frsReg({
  id: 'fr-sys-envelope', title: 'France: this year vs previous years', pageCanvas: 'frs-env',
  desc: 'Weekly average of a French series this year and last year against the min–max range and mean of earlier years since 2015 (RTE éCO2mix).',
  params: [{ key: 'series', label: 'Series', inTitle: true, options: Object.entries(FRS_ENV).map(([k, v]) => [k, v[1]]) }], defaults: { series: 'nuclear' },
  async draw(cid, p) {
    const rows = await _frsDaily();
    if (!rows) { noDataMsg(cid, 'RTE history not available', ''); return null; }
    const [key, label, unit, div] = FRS_ENV[p.series] || FRS_ENV.nuclear;
    const week = d => { const t = Date.parse(d + 'T00:00:00Z'), y0 = Date.UTC(+d.slice(0, 4), 0, 1); return Math.min(51, Math.floor((t - y0) / (7 * 864e5))); };
    const byYear = {};
    rows.forEach(r => { if (r[key] == null) return; const y = r.d.slice(0, 4), w = week(r.d); ((byYear[y] = byYear[y] || {})[w] = byYear[y][w] || []).push(r[key] / div); });
    const years = Object.keys(byYear).sort(), cur = years[years.length - 1], prev = years[years.length - 2];
    const hist = years.filter(y => y !== cur && y !== prev);
    const wk = Array.from({ length: 52 }, (_, i) => i);
    const mean = a => a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    const yv = (y, w) => mean(byYear[y] && byYear[y][w]);
    const r2 = v => v == null ? null : Math.round(v * 100) / 100;
    const lo = wk.map(w => { const v = hist.map(y => yv(y, w)).filter(x => x != null); return v.length ? r2(Math.min(...v)) : null; });
    const hi = wk.map(w => { const v = hist.map(y => yv(y, w)).filter(x => x != null); return v.length ? r2(Math.max(...v)) : null; });
    const av = wk.map(w => { const v = hist.map(y => yv(y, w)).filter(x => x != null); return v.length ? r2(mean(v)) : null; });
    const ds = [
      { label: `${hist[0]}–${hist[hist.length - 1]} range`, data: hi, borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(148,163,184,.18)' },
      { label: `${hist[0]}–${hist[hist.length - 1]} min`, data: lo, borderWidth: 0, pointRadius: 0, fill: false },
      { label: `${hist[0]}–${hist[hist.length - 1]} mean`, data: av, borderColor: 'rgba(148,163,184,.8)', borderDash: [4, 3], borderWidth: 1.2, pointRadius: 0, fill: false },
      { label: prev, data: wk.map(w => r2(yv(prev, w))), borderColor: '#7FC8F8', borderWidth: 1.6, pointRadius: 0, fill: false },
      { label: cur, data: wk.map(w => r2(yv(cur, w))), borderColor: '#14D3A9', borderWidth: 2.4, pointRadius: 0, fill: false },
    ];
    _fuelChart(cid, { type: 'line', data: { labels: wk.map(w => 'W' + (w + 1)), datasets: ds },
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 13, maxRotation: 0 } }), y: _fuelAxis(unit) },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !/ min$/.test(it.text) } } } }) }, 'fr-envelope-' + p.series);
    return { sub: label + ' · weekly averages · range and mean ' + hist[0] + '–' + hist[hist.length - 1] };
  },
});

async function _frsAnnualTable() {
  const host = document.getElementById('frs-annual'); if (!host) return;
  const rows = await _frsDaily(); if (!rows) { host.innerHTML = '<div class="fuel-note">RTE history not available.</div>'; return; }
  const by = {};
  rows.forEach(r => { (by[r.d.slice(0, 4)] = by[r.d.slice(0, 4)] || []).push(r); });
  const f1 = v => v == null ? '–' : v.toFixed(1);
  const lines = Object.entries(by).sort((a, b) => b[0].localeCompare(a[0])).map(([y, a]) => {
    const twh = k => a.reduce((s, r) => s + (r[k] || 0) * 24, 0) / 1e6;
    const prod = FRS_SOURCES.reduce((s, [k]) => s + twh(k), 0);
    const ren = twh('hydroAvg') + twh('windAvg') + twh('solarAvg') + twh('bioAvg');
    const co2 = a.filter(r => r.co2Avg != null), peak = Math.max(...a.map(r => r.loadMax || 0));
    return `<tr><td>${y}${a.length < 365 ? ' <span style="color:var(--text3)">(' + a.length + ' d)</span>' : ''}</td><td>${f1(twh('loadAvg'))}</td><td>${f1(prod)}</td><td>${f1(twh('nuclearAvg'))}</td><td>${f1(twh('hydroAvg'))}</td><td>${f1(twh('windAvg'))}</td><td>${f1(twh('solarAvg'))}</td><td>${f1(twh('gasAvg') + twh('coalAvg') + twh('oilAvg'))}</td><td>${f1(-twh('exchAvg'))}</td><td>${prod ? Math.round(ren / prod * 100) : '–'}%</td><td>${co2.length ? Math.round(co2.reduce((s, r) => s + r.co2Avg, 0) / co2.length) : '–'}</td><td>${peak ? (peak / 1000).toFixed(1) : '–'}</td></tr>`;
  }).join('');
  host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Year</th><th>Consumption</th><th>Production</th><th>Nuclear</th><th>Hydro</th><th>Wind</th><th>Solar</th><th>Fossil</th><th>Net export</th><th>Renewable</th><th>CO₂ g/kWh</th><th>Peak GW</th></tr></thead><tbody>${lines}</tbody></table></div>`;
}

async function _frsKpis(day, R) {
  const host = document.getElementById('frs-kpis'); if (!host) return;
  if (!R || !R.nuclear) { host.innerHTML = ''; return; }
  const pub = R.nuclear.map(v => v != null), n = pub.filter(Boolean).length;
  const avg = a => { if (!Array.isArray(a)) return null; let s = 0, k = 0; a.forEach((v, i) => { if (pub[i] && v != null) { s += v; k++; } }); return k ? s / k : null; };
  const last = R.nuclear.reduce((m, v, i) => v != null ? i : m, -1);
  const prodKeys = ['nuclear', 'hydro', 'wind', 'solar', 'gas', 'coal', 'oil', 'bio'];
  const prod = prodKeys.reduce((s, k) => s + (avg(R[k]) || 0), 0);
  const ren = ['hydro', 'wind', 'solar', 'bio'].reduce((s, k) => s + (avg(R[k]) || 0), 0);
  const loadA = Array.isArray(R.load) ? R.load.filter(v => v != null) : [];
  const peak = loadA.length ? Math.max(...loadA) : null;
  const ex = avg(R.exchanges), co2 = avg(R.co2), lf = avg(R.loadForecastD1), la = avg(R.load);
  const g = v => v == null ? '–' : (v / 1000).toFixed(1);
  const upto = n < 96 ? ` · up to ${String(Math.floor((last + 1) / 4)).padStart(2, '0')}:${String((last + 1) % 4 * 15).padStart(2, '0')}` : '';
  host.innerHTML =
    _fuelKpi('Consumption', g(la), 'GW', `peak ${g(peak)} GW${lf && la ? ' · D-1 forecast ' + ((la - lf) / lf * 100 >= 0 ? '+' : '') + ((la - lf) / lf * 100).toFixed(1) + '%' : ''}`) +
    _fuelKpi('Production', g(prod), 'GW', 'average' + upto) +
    _fuelKpi('Nuclear', g(avg(R.nuclear)), 'GW', prod ? Math.round(avg(R.nuclear) / prod * 100) + '% of production' : '') +
    _fuelKpi('Renewables', prod ? Math.round(ren / prod * 100) : '–', '%', 'hydro + wind + solar + bio') +
    _fuelKpi('CO₂ intensity', co2 == null ? '–' : Math.round(co2), 'g/kWh', 'RTE, direct emissions') +
    _fuelKpi(ex != null && ex < 0 ? 'Net export' : 'Net import', g(ex == null ? null : Math.abs(ex)), 'GW', 'physical exchanges');
}

async function renderFrSystem() {
  const lbl = document.getElementById('frs-day');
  if (!FRS.day) FRS.day = await _frsLatestDay();
  if (lbl) lbl.textContent = _frsFmtDay(FRS.day);
  const p = { day: FRS.day };
  PKW.draw('fr-sys-prod', 'frs-prod', p).then(r => _frsKpis(FRS.day, r && r.R));
  PKW.draw('fr-sys-co2', 'frs-co2', p).then(r => { const s = document.getElementById('frs-co2-sub'); if (s && r) s.textContent = r.avg == null ? '' : 'Daily average ' + Math.round(r.avg) + ' g/kWh · direct emissions (RTE)'; });
  PKW.draw('fr-sys-exch', 'frs-exch', p);
  PKW.draw('fr-sys-flex', 'frs-flex', p);
  if (!FRS.histDone) {
    FRS.histDone = true;
    frsSetMonthly(FRS.monthlyView);
    frsSetEnv(FRS.envSeries);
    _frsAnnualTable();
  }
}
function frsShiftDay(n) {
  if (n === 0) FRS.day = null;
  else { const t = _frsToday(), d = _frsAdd(FRS.day || t, n); if (d > t) return; FRS.day = d; }
  renderFrSystem();
}
function frsSetMonthly(v, btn) {
  FRS.monthlyView = v;
  document.querySelectorAll('#frs-monthly-view .pk-gf-btn').forEach(b => b.classList.toggle('active', b.dataset.v === v));
  PKW.draw('fr-sys-monthly', 'frs-monthly', { view: v, win: 'All' }).then(r => { const s = document.getElementById('frs-monthly-sub'); if (s && r && r.sub) s.textContent = r.sub; });
}
function frsSetEnv(v) {
  FRS.envSeries = v;
  const sel = document.getElementById('frs-env-series'); if (sel) sel.value = v;
  PKW.draw('fr-sys-envelope', 'frs-env', { series: v }).then(r => { const s = document.getElementById('frs-env-sub'); if (s && r && r.sub) s.textContent = r.sub; });
}
