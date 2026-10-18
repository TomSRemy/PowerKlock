// ── CROSS-BORDER ─────────────────────────────────────────────────────
// France: RTE éCO2mix commercial exchanges per border (15-min, real time).
// Other countries: Energy-Charts physical flows (hourly, data/history/flows).
window._cbDay = null;
function cbShiftDay(n) {
  const t = pkTodayISO();
  window._cbDay = n === 0 ? t : _renAdd(window._cbDay || t, n);
  if (window._cbDay > t) window._cbDay = t;
  loadCrossBorder();
}

async function loadCrossBorder() {
  window._cbLoaded = true;
  const country = document.getElementById('cb-country').value;
  // Just after midnight nothing is published for the new day yet: show the latest day with data.
  const day = window._cbDay || (country === 'FR' ? await _cbLatestDay() : null);
  if (day) document.getElementById('cb-day').textContent = _renFmtDay(day);
  ['cb-intraday', 'cb-days'].forEach(_renRestore);
  if (country === 'FR') {
    ['cb-intraday-badge', 'cb-days-badge'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = 'RTE éCO2mix'; });
    document.getElementById('cb-intraday-sub').textContent = 'GW · positive = import into France, negative = export';
    return _cbFrance(day);
  }
  return _cbOther(country);
}

async function _cbFrance(day) {
  const d = await PK_E2M.day(day);
  const B = PK_E2M.BORDERS;
  if (!d || !d.published) {
    document.getElementById('cb-kpis').innerHTML = `<div class="fuel-note" style="grid-column:1/-1">No éCO2mix exchange data for ${_renFmtDay(day)} (the real-time dataset covers roughly the last 7 weeks).</div>`;
    ['cb-intraday', 'cb-days'].forEach(id => noDataMsg(id, 'No data for this day', ''));
    document.getElementById('cb-tbody').innerHTML = '';
    return;
  }
  const n = 96, lbls = makeTimeLabels(n);
  const net = Array.from({ length: n }, (_, i) => { const v = B.map(b => d[b.key][i]); return v.every(x => x == null) ? null : v.reduce((a, x) => a + (x || 0), 0); });
  const valid = net.filter(v => v != null);
  const avgNet = valid.reduce((a, b) => a + b, 0) / valid.length;
  // Gross per border: a border can import while France is a net exporter overall.
  let exportGWh = 0, importGWh = 0;
  B.forEach(b => d[b.key].forEach(v => { if (v == null) return; if (v < 0) exportGWh -= v * 0.25 / 1000; else importGWh += v * 0.25 / 1000; }));
  const lastI = net.map((v, i) => v != null ? i : -1).filter(i => i >= 0).pop();
  const stats = B.map(b => {
    const v = d[b.key].filter(x => x != null);
    const avg = v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
    const mn = v.length ? Math.min(...v) : null, mx = v.length ? Math.max(...v) : null;
    return { b, avg, maxExp: mn != null && mn < 0 ? -mn : null, maxImp: mx != null && mx > 0 ? mx : null,
      hExp: v.filter(x => x < 0).length * 0.25, gwh: v.reduce((a, x) => a + x, 0) * 0.25 / 1000 };
  }).sort((x, y) => (x.avg ?? 0) - (y.avg ?? 0));
  const top = stats[0];
  const GW = v => v == null ? '–' : (v / 1000).toFixed(2);
  document.getElementById('cb-kpis').innerHTML =
    _fuelKpi('Net position', GW(Math.abs(avgNet)), 'GW', avgNet < 0 ? 'net exporter · day average' : 'net importer · day average', avgNet < 0 ? 'up' : 'down') +
    _fuelKpi('Latest', GW(Math.abs(net[lastI])), 'GW', `${net[lastI] < 0 ? 'export' : 'import'} at ${lbls[lastI]}`) +
    _fuelKpi('Exported', exportGWh.toFixed(1), 'GWh', `gross, ${valid.length}/96 slots`) +
    _fuelKpi('Imported', importGWh.toFixed(1), 'GWh', 'gross, all borders') +
    _fuelKpi('Main outlet', top.avg < 0 ? top.b.label : '–', '', top.avg < 0 ? `${GW(-top.avg)} GW average export` : 'no net export border') +
    _fuelKpi('Physical balance', GW(Math.abs(_renMean(d.ech_physiques))), 'GW', 'all borders, physical (éCO2mix)');

  PKW.draw('cb-intraday', 'cb-intraday', { day });
  const cbN = window._cbDaysN || '14';
  PKW.draw('cb-days', 'cb-days', { day, n: cbN });
  PKW.periodButtons('cb-days', CB_DAYS_PARAM.options.map(o => [o[0], o[0] + 'D']), cbN, v => { window._cbDaysN = v; PKW.draw('cb-days', 'cb-days', { day, n: v }); });
  document.getElementById('cb-intraday-title').textContent = 'Intraday exchanges by border · ' + _renFmtDay(day);

  document.getElementById('cb-table-title').textContent = 'Borders · ' + _renFmtDay(day);
  document.getElementById('cb-updated').textContent = 'RTE éCO2mix · commercial';
  document.getElementById('cb-tbody').innerHTML = stats.map(st => {
    const dir = st.avg == null ? '–' : st.avg < 0 ? '<span style="color:var(--up)">▶ France exports</span>' : '<span style="color:var(--down)">◀ France imports</span>';
    return `<tr><td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${st.b.color};margin-right:7px"></span>${st.b.label}</td>` +
      `<td style="font-weight:600">${_fuelSigned(st.avg / 1000)} GW</td><td>${st.maxExp != null ? GW(st.maxExp) + ' GW' : '–'}</td><td>${st.maxImp != null ? GW(st.maxImp) + ' GW' : '–'}</td>` +
      `<td>${st.hExp.toFixed(1)} h</td><td>${_fuelSigned(st.gwh, 1)} GWh</td><td class="l" style="text-align:left">${dir}</td></tr>`;
  }).join('');
  document.getElementById('cb-note').textContent = 'Commercial exchanges scheduled per border, RTE sign convention (negative = export from France); "Germany + Belgium" is reported jointly by RTE. Energy = Σ 15-min values × 0.25 h.';
}

// ── Other countries: physical flows from Energy-Charts (repo files) ──
// data/history/flows/YYYY-MM.json, hourly MW per country and neighbour on
// the Paris day, + = import into the country (scripts/fetch_energy_charts.py).
const CB_EC = { DE: 'Germany', BE: 'Belgium', NL: 'Netherlands', ES: 'Spain', IT: 'Italy', CH: 'Switzerland',
  AT: 'Austria', PL: 'Poland', CZ: 'Czechia', DK: 'Denmark', PT: 'Portugal' };
const CB_NB_NAME = { AT: 'Austria', BE: 'Belgium', CZ: 'Czechia', DK: 'Denmark', FR: 'France', DE: 'Germany', LU: 'Luxembourg',
  NL: 'Netherlands', NO: 'Norway', PL: 'Poland', SE: 'Sweden', CH: 'Switzerland', IT: 'Italy', ES: 'Spain', PT: 'Portugal',
  GB: 'Great Britain', SI: 'Slovenia', SK: 'Slovakia', HU: 'Hungary', LT: 'Lithuania', GR: 'Greece', ME: 'Montenegro', MT: 'Malta', IE: 'Ireland' };
const CB_NB_COL = ['#FBBF24', '#7FC8F8', '#ED6965', '#14D3A9', '#C4A57B', '#A87DC4', '#94D2BD', '#F472B6', '#8D99AE', '#D6A77A', '#3FA6B4'];
const _cbEcCache = new Map();
function _cbEcMonth(ym) {
  if (!_cbEcCache.has(ym)) _cbEcCache.set(ym, fetch(DATA_BASE + 'history/flows/' + ym + '.json').then(r => r.ok ? r.json() : null).catch(() => null));
  return _cbEcCache.get(ym);
}
async function _cbEcDay(country, day) {
  const m = await _cbEcMonth(day.slice(0, 7));
  return m && m.days && m.days[day] && m.days[day][country] || null;
}
// Latest day with at least 20 published hours for the country (within 10 days).
async function _cbEcLatest(country) {
  for (let k = 0; k < 10; k++) {
    const d = _renAdd(pkTodayISO(), -k), f = await _cbEcDay(country, d);
    if (f && Object.values(f).some(a => a.filter(v => v != null).length >= 20)) return d;
  }
  return pkTodayISO();
}
const CB_COUNTRY_PARAM = { key: 'country', label: 'Country', inTitle: true, options: [['FR', 'France']].concat(Object.entries(CB_EC)) };

// ── France exchanges charts (page + dashboard) ─────────────────────
// Latest day with published éCO2mix exchanges (today, else yesterday).
async function _cbLatestDay() {
  const t = pkTodayISO();
  const d = await PK_E2M.day(t);
  return d && d.published ? t : _renAdd(t, -1);
}
function _cbReg(def) {
  if (!window.PKW) return;
  PKW.register(Object.assign({ category: 'flows', page: 'crossborder', source: 'RTE éCO2mix', size: { w: 6, h: 5 } }, def));
}

_cbReg({
  id: 'cb-intraday', title: 'Exchanges by border', pageCanvas: 'cb-intraday', size: { w: 12, h: 5 }, source: 'RTE éCO2mix · Energy-Charts',
  desc: 'Exchanges per border and net position through the day (+ import / − export): France 15-min commercial (RTE), other countries hourly physical flows (Energy-Charts).',
  params: [CB_COUNTRY_PARAM], defaults: { country: 'FR' },
  async draw(cid, p) {
    if (p.country && p.country !== 'FR') return _cbEcIntraday(cid, p.country, p.day);
    const day = p.day || await _cbLatestDay();
    const d = await PK_E2M.day(day);
    if (!d || !d.published) { noDataMsg(cid, 'No éCO2mix exchange data for ' + _renFmtDay(day), ''); return null; }
    const B = PK_E2M.BORDERS, n = 96, lbls = makeTimeLabels(n);
    const net = Array.from({ length: n }, (_, i) => { const v = B.map(b => d[b.key][i]); return v.every(x => x == null) ? null : v.reduce((a, x) => a + (x || 0), 0); });
    const ds = B.map(b => ({ label: b.label, data: d[b.key].map(v => v == null ? null : v / 1000), backgroundColor: rgba(b.color, .6), borderColor: b.color, borderWidth: 1, fill: true, pointRadius: 0, tension: 0, stack: 'x' }));
    ds.push({ label: 'Net', data: net.map(v => v == null ? null : v / 1000), type: 'line', borderColor: '#FFFFFF', borderWidth: 1.5, pointRadius: 0, fill: false, order: -1, stack: 'n', tension: 0 });
    const a = nowLineAnnotation({ slots: n, labels: lbls, chartDate: day });
    _fuelChart(cid, { type: 'line', data: { labels: lbls, datasets: ds }, options: _fuelOpts({
      scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 13, maxRotation: 0 } }), y: _fuelAxis('GW', { stacked: true }) },
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
        annotation: { annotations: Object.assign({ zero: { type: 'line', yMin: 0, yMax: 0, borderColor: 'rgba(184,201,217,.35)', borderWidth: 1 } }, a ? { nowLine: a } : {}) } } }) }, 'fr-exchanges-' + day);
    return { sub: _renFmtDay(day) };
  },
});

const CB_DAYS_PARAM = { key: 'n', label: 'Window', options: [['7', '7 days'], ['14', '14 days'], ['30', '30 days'], ['45', '45 days']] };
_cbReg({
  id: 'cb-days', title: 'Daily exchanges by border', pageCanvas: 'cb-days', source: 'RTE éCO2mix · Energy-Charts',
  desc: 'Daily average exchange per border over the last days (+ import / − export).',
  params: [CB_COUNTRY_PARAM, CB_DAYS_PARAM], defaults: { country: 'FR', n: '14' },
  async draw(cid, p) {
    if (p.country && p.country !== 'FR') return _cbEcDays(cid, p.country, +p.n || 14, p.day);
    const day = p.day || await _cbLatestDay();
    const B = PK_E2M.BORDERS;
    const from = PK_E2M.dayBoundsUTC(_renAdd(day, 1 - (+p.n || 14)))[0], to = PK_E2M.dayBoundsUTC(day)[1];
    const rows = await PK_E2M.fetchRange(from, to) || [];
    const byDay = {};
    rows.forEach(r => {
      const dd = new Date(r.date_heure).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
      const o = byDay[dd] = byDay[dd] || {};
      B.forEach(b => { if (r[b.key] != null) { (o[b.key] = o[b.key] || []).push(r[b.key]); } });
    });
    const days = Object.keys(byDay).sort();
    if (!days.length) { noDataMsg(cid, 'éCO2mix not reachable', ''); return null; }
    _fuelChart(cid, { type: 'bar', data: { labels: days.map(x => x.slice(8, 10) + '/' + x.slice(5, 7)), datasets: B.map(b => ({
      label: b.label, data: days.map(x => { const v = byDay[x][b.key] || []; return v.length ? +(v.reduce((a, y) => a + y, 0) / v.length / 1000).toFixed(2) : null; }),
      backgroundColor: rgba(b.color, .7), borderRadius: 2, stack: 's' })) },
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis('GW', { stacked: true }) } }) }, 'fr-exchanges-' + p.n + 'd');
    return { sub: days.length + ' days to ' + _renFmtDay(day) };
  },
});

_cbReg({
  id: 'cb-fr-avg', title: 'France · average exchange by border', size: { w: 4, h: 5 },
  desc: 'Day-average commercial exchange per border, latest day (+ import / − export).',
  async draw(cid, p) {
    const day = p.day || await _cbLatestDay();
    const d = await PK_E2M.day(day);
    if (!d || !d.published) { noDataMsg(cid, 'No éCO2mix exchange data for ' + _renFmtDay(day), ''); return null; }
    const B = PK_E2M.BORDERS;
    const avg = B.map(b => { const v = d[b.key].filter(x => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length / 1000 : null; });
    _fuelChart(cid, { type: 'bar', data: { labels: B.map(b => b.label), datasets: [
      { label: 'Average exchange (GW)', data: avg.map(v => v == null ? null : +v.toFixed(2)), backgroundColor: avg.map(v => v < 0 ? rgba(C_UP, .65) : rgba(C_DN, .55)), borderRadius: 3 },
    ] }, options: _fuelOpts({ indexAxis: 'y', plugins: { legend: { display: false }, zoom: ZOOM_CFG },
      scales: { x: _fuelAxis('GW · − export / + import'), y: { grid: { display: false }, ticks: { color: C_TX2, font: { size: 10 } } } } }) }, 'fr-exchanges-avg-' + day);
    return { sub: _renFmtDay(day) };
  },
});

async function _cbEcIntraday(cid, country, day) {
  day = day || await _cbEcLatest(country);
  const f = await _cbEcDay(country, day);
  if (!f) { noDataMsg(cid, 'No Energy-Charts flow data for ' + (CB_EC[country] || country) + ' on ' + _renFmtDay(day), ''); return null; }
  const nbs = Object.keys(f).sort((a, b) => _renMean(f[a]) - _renMean(f[b]));
  const lbls = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0') + ':00');
  const net = lbls.map((_, h) => { const v = nbs.map(n => f[n][h]).filter(x => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / 1000 : null; });
  const ds = nbs.map((n, k) => ({ label: CB_NB_NAME[n] || n, type: 'bar', data: f[n].map(v => v == null ? null : v / 1000), backgroundColor: rgba(CB_NB_COL[k % CB_NB_COL.length], .65), borderWidth: 0, stack: 'x' }));
  ds.push({ label: 'Net', type: 'line', data: net, borderColor: '#FFFFFF', borderWidth: 1.6, pointRadius: 0, fill: false, order: -1, stack: 'n', tension: 0 });
  _fuelChart(cid, { type: 'bar', data: { labels: lbls, datasets: ds }, options: _fuelOpts({
    scales: { x: Object.assign(_fuelXAxis(), { stacked: true, ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 } }), y: _fuelAxis('GW · + import / − export', { stacked: true }) },
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
      annotation: { annotations: { zero: { type: 'line', yMin: 0, yMax: 0, borderColor: 'rgba(184,201,217,.35)', borderWidth: 1 } } } } }) }, 'flows-' + country + '-' + day);
  return { sub: (CB_EC[country] || country) + ' · ' + _renFmtDay(day) + ' · hourly physical flows', day, f };
}

async function _cbEcDays(cid, country, n, day) {
  day = day || await _cbEcLatest(country);
  const days = Array.from({ length: n }, (_, i) => _renAdd(day, i - n + 1));
  const rows = await Promise.all(days.map(d => _cbEcDay(country, d)));
  const nbs = [...new Set(rows.flatMap(r => r ? Object.keys(r) : []))];
  if (!nbs.length) { noDataMsg(cid, 'No Energy-Charts flow data for ' + (CB_EC[country] || country), ''); return null; }
  _fuelChart(cid, { type: 'bar', data: { labels: days.map(x => x.slice(8, 10) + '/' + x.slice(5, 7)), datasets: nbs.map((nb, k) => ({
    label: CB_NB_NAME[nb] || nb, data: rows.map(r => { const a = r && r[nb]; const m = a ? _renMean(a) : null; return m == null ? null : +(m / 1000).toFixed(2); }),
    backgroundColor: rgba(CB_NB_COL[k % CB_NB_COL.length], .7), borderRadius: 2, stack: 's' })) },
    options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis('GW', { stacked: true }) } }) }, 'flows-' + country + '-' + n + 'd');
  return { sub: (CB_EC[country] || country) + ' · ' + n + ' days to ' + _renFmtDay(day) };
}

// Page view for countries other than France.
async function _cbOther(country) {
  const day = window._cbDay || await _cbEcLatest(country);
  document.getElementById('cb-day').textContent = _renFmtDay(day);
  document.getElementById('cb-updated').textContent = 'Energy-Charts · physical flows';
  ['cb-intraday-badge', 'cb-days-badge'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = 'Energy-Charts'; });
  const r = await PKW.draw('cb-intraday', 'cb-intraday', { country, day });
  const cbN = window._cbDaysN || '14';
  PKW.draw('cb-days', 'cb-days', { country, day, n: cbN });
  PKW.periodButtons('cb-days', CB_DAYS_PARAM.options.map(o => [o[0], o[0] + 'D']), cbN, v => { window._cbDaysN = v; PKW.draw('cb-days', 'cb-days', { country, day, n: v }); });
  document.getElementById('cb-intraday-title').textContent = 'Hourly physical flows by border · ' + (CB_EC[country] || country) + ' · ' + _renFmtDay(day);
  document.getElementById('cb-intraday-sub').textContent = 'GW · positive = import into ' + (CB_EC[country] || country) + ', negative = export';
  const f = r && r.f;
  if (!f) {
    document.getElementById('cb-kpis').innerHTML = `<div class="fuel-note" style="grid-column:1/-1">No physical flow data for ${CB_EC[country] || country} on ${_renFmtDay(day)}.</div>`;
    document.getElementById('cb-tbody').innerHTML = ''; return;
  }
  const nbs = Object.keys(f);
  const hourNet = Array.from({ length: 24 }, (_, h) => { const v = nbs.map(n => f[n][h]).filter(x => x != null); return v.length ? v.reduce((a, x) => a + x, 0) : null; });
  const valid = hourNet.filter(v => v != null), avgNet = valid.reduce((a, b) => a + b, 0) / (valid.length || 1);
  let expGWh = 0, impGWh = 0;
  nbs.forEach(n => f[n].forEach(v => { if (v == null) return; if (v < 0) expGWh -= v / 1000; else impGWh += v / 1000; }));
  const stats = nbs.map(n => { const v = f[n].filter(x => x != null), avg = _renMean(v); return { n, avg, maxExp: Math.min(0, ...v), maxImp: Math.max(0, ...v), hExp: v.filter(x => x < 0).length, gwh: v.reduce((a, x) => a + x, 0) / 1000 }; }).sort((a, b) => a.avg - b.avg);
  const GW = v => v == null ? '–' : (v / 1000).toFixed(2), top = stats[0];
  document.getElementById('cb-kpis').innerHTML =
    _fuelKpi('Net position', GW(Math.abs(avgNet)), 'GW', avgNet < 0 ? 'net exporter · day average' : 'net importer · day average', avgNet < 0 ? 'up' : 'down') +
    _fuelKpi('Exported', expGWh.toFixed(1), 'GWh', `gross, ${valid.length}/24 hours`) +
    _fuelKpi('Imported', impGWh.toFixed(1), 'GWh', 'gross, all borders') +
    _fuelKpi('Main outlet', top && top.avg < 0 ? (CB_NB_NAME[top.n] || top.n) : '–', '', top && top.avg < 0 ? `${GW(-top.avg)} GW average export` : 'no net export border') +
    _fuelKpi('Borders', nbs.length, '', 'reported by Energy-Charts');
  document.getElementById('cb-table-title').textContent = 'Borders · ' + _renFmtDay(day);
  document.getElementById('cb-tbody').innerHTML = stats.map(st =>
    `<tr><td>${CB_NB_NAME[st.n] || st.n}</td><td style="font-weight:600">${_fuelSigned(st.avg / 1000)} GW</td><td>${st.maxExp < 0 ? GW(-st.maxExp) + ' GW' : '–'}</td><td>${st.maxImp > 0 ? GW(st.maxImp) + ' GW' : '–'}</td>` +
    `<td>${st.hExp} h</td><td>${_fuelSigned(st.gwh, 1)} GWh</td><td class="l" style="text-align:left">${st.avg < 0 ? '<span style="color:var(--up)">▶ exports</span>' : '<span style="color:var(--down)">◀ imports</span>'}</td></tr>`).join('');
  document.getElementById('cb-note').textContent = 'Physical cross-border flows, hourly averages on the Paris day; + = import into ' + (CB_EC[country] || country) + '. Source: Energy-Charts.info (Fraunhofer ISE), CC BY 4.0. France uses RTE commercial exchanges (15-min) instead.';
}


// ════════════════════════════════════════════
// LOAD
// ════════════════════════════════════════════
window._loadDayOffset = 0;
window._loadUserPicked = false;
function setLoadDay(offset, btn) {
  window._loadDayOffset = offset;
  window._loadUserPicked = true;
  document.querySelectorAll('#load-day-btns .day-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadLoad();
}

// éCO2mix history is half-hourly: fill isolated 15-min gaps by interpolation
// (never extrapolates past the last published value).
function _e2mFill(a) {
  if (!a) return a;
  const o = a.slice();
  for (let i = 1; i < o.length - 1; i++) if (o[i] == null && o[i - 1] != null && o[i + 1] != null) o[i] = (o[i - 1] + o[i + 1]) / 2;
  return o;
}

const LOAD_NAMES = { FR: 'France', DE_LU: 'Germany', BE: 'Belgium', NL: 'Netherlands', ES: 'Spain', GB: 'Great Britain', IT_NORD: 'Italy North' };
const _loadAdd = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const _loadFetchDay = async iso => { try { const r = await fetch(DATA_BASE + 'history/daily/' + iso + '.json'); return r.ok ? await r.json() : null; } catch (_) { return null; } };
const _loadHas = a => !!(a && a.some(v => v != null));

// Load of one zone and day. France: RTE éCO2mix (consumption, D-1 and
// intraday forecasts; real-time then consolidated history). Other zones:
// ENTSO-E live snapshot for its day, daily history file otherwise.
async function _loadDay(country, dayISO) {
  const lyISO = _loadAdd(dayISO, -364);
  let actual = null, forecast = null, forecastJ = null, src = '';
  if (country === 'FR' && window.PK_E2M) {
    const e = await PK_E2M.day(dayISO);
    if (e && _loadHas(e.consommation)) {
      actual = _e2mFill(e.consommation); forecast = _e2mFill(e.prevision_j1); forecastJ = _e2mFill(e.prevision_j);
      src = 'RTE éCO2mix · ' + e.dataset;
    }
  }
  const live = window._loadData && window._loadData[country];
  const liveDate = window._loadDataUpdated ? new Date(window._loadDataUpdated).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }) : null;
  if (!actual && live && liveDate === dayISO) { actual = live.actual; forecast = live.forecast || null; src = 'ENTSO-E A65 · live snapshot'; }
  if (!actual) {
    const day = await _loadFetchDay(dayISO);
    const z = day && day.zones && day.zones[country];
    if (z && Array.isArray(z.load)) { actual = z.load; forecast = z.loadForecast || null; src = 'ENTSO-E A65 · daily history'; }
  }
  let lastYear = null;
  if (country === 'FR' && window.PK_E2M) {
    const e = await PK_E2M.day(lyISO);
    if (e && _loadHas(e.consommation)) lastYear = _e2mFill(e.consommation);
  }
  if (!lastYear) {
    const lyDay = await _loadFetchDay(lyISO);
    const lyZ = lyDay && lyDay.zones && lyDay.zones[country];
    lastYear = lyZ && Array.isArray(lyZ.load) ? lyZ.load : null;
  }
  return { day: dayISO, lyISO, liveDate, actual: _loadHas(actual) ? actual : null, forecast, forecastJ, lastYear, src };
}

// Today, else the live snapshot's day, else yesterday.
async function _loadLatest(country) {
  const t = pkTodayISO();
  let D = await _loadDay(country, t);
  if (D.actual) return D;
  if (D.liveDate && D.liveDate < t) { D = await _loadDay(country, D.liveDate); if (D.actual) return D; }
  return _loadDay(country, _loadAdd(t, -1));
}

if (window.PKW) PKW.register({
  id: 'load-day', title: 'Load · actual vs forecast', category: 'system', page: 'load', pageCanvas: 'load-canvas', source: 'RTE éCO2mix · ENTSO-E', size: { w: 6, h: 5 },
  desc: 'Actual load against the day-ahead forecast and the same weekday last year.',
  params: [{ key: 'zone', label: 'Zone', inTitle: true, options: Object.keys(LOAD_NAMES).map(k => [k, LOAD_NAMES[k]]) }], defaults: { zone: 'FR' },
  async draw(cid, p) {
    const D = p.D || await _loadLatest(p.zone);
    if (!D.actual) { noDataMsg(cid, `No load data stored for ${LOAD_NAMES[p.zone] || p.zone} on ${_renFmtDay(D.day)}`, 'Load history is kept from the daily fetch onwards (actual + day-ahead forecast).'); return null; }
    _fuelRestoreCanvas(cid);
    const n = D.actual.length;
    const GW = a => a ? a.map(v => v == null ? null : v / 1000) : null;
    const A = GW(D.actual), F = GW(D.forecast), L = GW(D.lastYear && D.lastYear.length === n ? D.lastYear : null), FJ = GW(D.forecastJ);
    const labels = makeTimeLabels(n);
    const ds = [{ label: 'Actual', data: A, borderColor: C_UP, borderWidth: 2, backgroundColor: rgba(C_UP, .08), fill: true, pointRadius: 0, tension: 0, spanGaps: false }];
    if (F) ds.push({ label: 'Day-ahead forecast', data: F, borderColor: C_WIND, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0, fill: false });
    if (FJ && FJ.some(v => v != null)) ds.push({ label: 'Intraday forecast', data: FJ, borderColor: '#7FC8F8', borderWidth: 1.2, borderDash: [2, 3], pointRadius: 0, tension: 0, fill: false });
    if (L) ds.push({ label: 'Same weekday last year', data: L, borderColor: 'rgba(184,201,217,.45)', borderWidth: 1, borderDash: [2, 3], pointRadius: 0, tension: 0, fill: false });
    const a = nowLineAnnotation({ slots: n, labels, chartDate: D.day });
    mkChart(cid, {
      type: 'line', data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 12 } },
          tooltip: { mode: 'index', callbacks: { label: ctx => ctx.raw == null ? null : ` ${ctx.dataset.label}: ${ctx.raw.toFixed(2)} GW` } },
          zoom: ZOOM_CFG,
          annotation: { annotations: a ? { nowLine: a } : {} },
        },
        scales: { x: { grid: GRID, ticks: { color: C_TX3, maxTicksLimit: 13, maxRotation: 0 } },
                  y: { grid: GRID, ticks: { color: C_TX3, callback: v => v.toFixed(0) + ' GW' } } },
      },
    });
    return { sub: _renFmtDay(D.day) + ' · ' + D.src.split(' · ')[0] };
  },
});

async function loadLoad() {
  window._loadLoaded = true;
  const country = (document.getElementById('load-country') || {}).value || 'FR';
  const offset  = window._loadDayOffset || 0;
  const cname = LOAD_NAMES[country] || country;
  const dayISO = _loadAdd(pkTodayISO(), offset);
  const D = await _loadDay(country, dayISO);
  const { actual, forecast, lastYear, lyISO, liveDate, src } = D;

  const setKPI = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const fmtDay = _renFmtDay;
  const el_title = document.getElementById('load-chart-title');
  if (el_title) el_title.textContent = `${cname} — load (GW) · ${fmtDay(dayISO)}`;
  document.getElementById('load-updated').textContent = actual ? src : 'No data for this day';

  // First visit before today's data exists: show the latest available day
  // instead of an empty "Today".
  if (!actual && !window._loadUserPicked && offset === 0 && liveDate && liveDate < dayISO) {
    const back = Math.round((Date.parse(liveDate) - Date.parse(dayISO)) / 864e5);
    window._loadDayOffset = back;
    document.querySelectorAll('#load-day-btns .day-tab').forEach(b => b.classList.toggle('active', (b.getAttribute('onclick') || '').includes('(' + back + ',')));
    return loadLoad();
  }
  PKW.draw('load-day', 'load-canvas', { zone: country, D }).then(() => {
    setTimeout(() => { addFullscreen('load-canvas'); addDownload('load-canvas', 'load-' + country + '-' + dayISO); }, 100);
  });
  if (!actual) {
    ['load-kpi-peak-actual','load-kpi-peak-fc','load-kpi-avg','load-kpi-dev','load-kpi-yoy'].forEach(id => setKPI(id, '–'));
    ['load-kpi-peak-actual-sub','load-kpi-peak-fc-sub','load-kpi-dev-sub','load-kpi-yoy-sub'].forEach(id => setKPI(id, ''));
    const tb = document.getElementById('load-hourly-tbody'); if (tb) tb.innerHTML = '';
    return;
  }

  const n = actual.length, per = n / 24;
  const GW = a => a ? a.map(v => v == null ? null : v / 1000) : null;
  const A = GW(actual), F = GW(forecast), L = GW(lastYear && lastYear.length === n ? lastYear : null);
  const labels = makeTimeLabels(n);
  const valid = a => a ? a.filter(v => v != null) : [];
  const argmax = a => { let mi = -1; (a || []).forEach((v, i) => { if (v != null && (mi < 0 || v > a[mi])) mi = i; }); return mi; };
  const iA = argmax(A), iF = argmax(F);
  const avgA = valid(A).reduce((x, y) => x + y, 0) / valid(A).length;
  // Forecast error (MAPE) over slots where both are published
  const pairs = A.map((v, i) => (v != null && F && F[i] != null) ? [v, F[i]] : null).filter(Boolean);
  const bias = pairs.length ? pairs.reduce((s, [a, f]) => s + (a - f), 0) / pairs.reduce((s, [, f]) => s + f, 0) * 100 : null;
  const mape = pairs.length ? pairs.reduce((s, [a, f]) => s + Math.abs(a - f), 0) / pairs.reduce((s, [, f]) => s + f, 0) * 100 : null;
  const lyPairs = L ? A.map((v, i) => (v != null && L[i] != null) ? [v, L[i]] : null).filter(Boolean) : [];
  const yoy = lyPairs.length ? (lyPairs.reduce((s, [a]) => s + a, 0) / lyPairs.reduce((s, [, l]) => s + l, 0) - 1) * 100 : null;

  setKPI('load-kpi-peak-actual', `${A[iA].toFixed(1)}<span class="kpi-unit">GW</span>`);
  setKPI('load-kpi-peak-actual-sub', `<span style="color:var(--tx3)">at ${labels[iA]} · ${valid(A).length}/${n} slots published</span>`);
  setKPI('load-kpi-peak-fc', iF >= 0 ? `${F[iF].toFixed(1)}<span class="kpi-unit">GW</span>` : '–');
  setKPI('load-kpi-peak-fc-sub', iF >= 0 ? `<span style="color:var(--tx3)">at ${labels[iF]}</span>` : '<span style="color:var(--tx3)">forecast not available</span>');
  setKPI('load-kpi-avg', `${avgA.toFixed(1)}<span class="kpi-unit">GW</span>`);
  setKPI('load-kpi-avg-sub', valid(A).length < n ? 'average so far' : 'daily average');
  setKPI('load-chart-src', src.split(' · ')[0]);
  setKPI('load-kpi-dev', bias == null ? '–' : `<span class="${bias >= 0 ? 'up' : 'down'}">${bias >= 0 ? '+' : ''}${bias.toFixed(1)}<span class="kpi-unit">%</span></span>`);
  setKPI('load-kpi-dev-sub', bias == null ? '' : `${bias >= 0 ? 'above' : 'below'} forecast · MAPE ${mape.toFixed(1)}%`);
  setKPI('load-kpi-yoy', yoy == null ? '–' : `<span class="${yoy >= 0 ? 'up' : 'down'}">${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}<span class="kpi-unit">%</span></span>`);
  setKPI('load-kpi-yoy-sub', yoy == null ? `no data for ${fmtDay(lyISO)}` : `vs ${fmtDay(lyISO)} (same weekday)`);

  // Hourly table (mean of the hour's slots), Paris time
  const hourAvg = (a, h) => { if (!a) return null; const v = a.slice(h * per, (h + 1) * per).filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const tbody = document.getElementById('load-hourly-tbody');
  if (tbody) {
    tbody.innerHTML = Array.from({ length: 24 }, (_, h) => {
      const act = hourAvg(A, h), fc = hourAvg(F, h);
      const dev2 = (act != null && fc) ? (act - fc) / fc * 100 : null;
      return `<tr style="opacity:${act == null ? .45 : 1}">
        <td style="font-family:'JetBrains Mono',monospace">${String(h).padStart(2, '0')}:00</td>
        <td style="font-family:'JetBrains Mono',monospace">${act != null ? Math.round(act * 1000).toLocaleString('en-GB') : '–'}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:var(--tx3)">${fc != null ? Math.round(fc * 1000).toLocaleString('en-GB') : '–'}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:${dev2 == null ? 'var(--tx3)' : dev2 >= 0 ? 'var(--up)' : 'var(--down)'}">${dev2 != null ? (dev2 >= 0 ? '+' : '') + dev2.toFixed(1) + '%' : '–'}</td>
      </tr>`;
    }).join('');
  }
}

// ═════════════════════════════════════════════
// NEWS
// ════════════════════════════════════════════
// Feeds are fetched server-side by scripts/fetch_news.py → data/news.json.
