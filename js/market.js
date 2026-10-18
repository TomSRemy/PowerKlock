// ── CROSS-BORDER ─────────────────────────────────────────────────────
// France: RTE éCO2mix commercial exchanges per border (15-min, real time).
// Other zones: ENTSO-E A11 physical flows from data/crossborder.json
// (daily average per partner). No demo fallback.
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
  const day = window._cbDay || pkTodayISO();
  document.getElementById('cb-day').textContent = _renFmtDay(day);
  ['cb-intraday', 'cb-days'].forEach(_renRestore);
  if (country === 'FR') return _cbFrance(day);
  return _cbEntsoe(country);
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

  const ds = B.map(b => ({ label: b.label, data: d[b.key].map(v => v == null ? null : v / 1000), backgroundColor: rgba(b.color, .6), borderColor: b.color, borderWidth: 1, fill: true, pointRadius: 0, tension: 0, stack: 'x' }));
  ds.push({ label: 'Net', data: net.map(v => v == null ? null : v / 1000), type: 'line', borderColor: '#FFFFFF', borderWidth: 1.5, pointRadius: 0, fill: false, order: -1, stack: 'n', tension: 0 });
  _fuelChart('cb-intraday', { type: 'line', data: { labels: lbls, datasets: ds }, options: _fuelOpts({
    scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 13, maxRotation: 0 } }), y: _fuelAxis('GW', { stacked: true }) },
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
      annotation: { annotations: Object.assign({ zero: { type: 'line', yMin: 0, yMax: 0, borderColor: 'rgba(184,201,217,.35)', borderWidth: 1 } },
        (() => { const a = nowLineAnnotation({ slots: n, labels: lbls, chartDate: day }); return a ? { nowLine: a } : {}; })()) } } }) }, 'fr-exchanges-' + day);
  document.getElementById('cb-intraday-title').textContent = 'Intraday exchanges by border · ' + _renFmtDay(day);

  // 14 days, one request
  const from = PK_E2M.dayBoundsUTC(_renAdd(day, -13))[0], to = PK_E2M.dayBoundsUTC(day)[1];
  const rows = await PK_E2M.fetchRange(from, to) || [];
  const byDay = {};
  rows.forEach(r => {
    const dd = new Date(r.date_heure).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const o = byDay[dd] = byDay[dd] || {};
    B.forEach(b => { if (r[b.key] != null) { (o[b.key] = o[b.key] || []).push(r[b.key]); } });
  });
  const days = Object.keys(byDay).sort();
  _fuelChart('cb-days', { type: 'bar', data: { labels: days.map(x => x.slice(8, 10) + '/' + x.slice(5, 7)), datasets: B.map(b => ({
    label: b.label, data: days.map(x => { const v = byDay[x][b.key] || []; return v.length ? +(v.reduce((a, y) => a + y, 0) / v.length / 1000).toFixed(2) : null; }),
    backgroundColor: rgba(b.color, .7), borderRadius: 2, stack: 's' })) },
    options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis('GW', { stacked: true }) } }) }, 'fr-exchanges-14d');

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

function _cbEntsoe(country) {
  const flows = (window._cbData && window._cbData[country]) || [];
  const anyData = flows.some(f => f.imports || f.exports);
  document.getElementById('cb-day').textContent = window._cbUpdated ? _renFmtDay(new Date(window._cbUpdated).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })) : '–';
  document.getElementById('cb-updated').textContent = 'ENTSO-E A11 · physical';
  if (!anyData) {
    document.getElementById('cb-kpis').innerHTML = `<div class="fuel-note" style="grid-column:1/-1">The ENTSO-E cross-border feed returned no flow values for ${country} in the last fetch (parser fixed in this release — values appear after the next scheduled fetch). France is available in real time from RTE.</div>`;
    ['cb-intraday', 'cb-days'].forEach(id => noDataMsg(id, 'No ENTSO-E flow data yet', ''));
    document.getElementById('cb-tbody').innerHTML = '';
    document.getElementById('cb-note').textContent = '';
    return;
  }
  const tot = k => flows.reduce((a, f) => a + (f[k] || 0), 0);
  const net = tot('imports') - tot('exports');
  document.getElementById('cb-kpis').innerHTML =
    _fuelKpi('Net position', (Math.abs(net) / 1000).toFixed(2), 'GW', net < 0 ? 'net exporter' : 'net importer', net < 0 ? 'up' : 'down') +
    _fuelKpi('Exports', (tot('exports') / 1000).toFixed(2), 'GW', 'average over published hours') +
    _fuelKpi('Imports', (tot('imports') / 1000).toFixed(2), 'GW', 'average over published hours') +
    _fuelKpi('Borders', flows.length, '', 'with ENTSO-E data');
  const lbl = flows.map(f => f.partner);
  _fuelChart('cb-intraday', { type: 'bar', data: { labels: lbl, datasets: [
    { label: 'Exports', data: flows.map(f => -(f.exports || 0) / 1000), backgroundColor: rgba(C_UP, .65), borderRadius: 2 },
    { label: 'Imports', data: flows.map(f => (f.imports || 0) / 1000), backgroundColor: rgba(C_DN, .6), borderRadius: 2 },
  ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW') } }) }, 'flows-' + country);
  document.getElementById('cb-intraday-title').textContent = 'Average physical flows by partner';
  noDataMsg('cb-days', 'Daily history is available for France only', '');
  document.getElementById('cb-tbody').innerHTML = flows.map(f => {
    const n2 = (f.imports || 0) - (f.exports || 0);
    return `<tr><td>${f.partner}</td><td style="font-weight:600">${_fuelSigned(n2 / 1000)} GW</td><td>${((f.exports || 0) / 1000).toFixed(2)} GW</td><td>${((f.imports || 0) / 1000).toFixed(2)} GW</td><td>–</td><td>–</td>` +
      `<td class="l" style="text-align:left">${n2 < 0 ? '<span style="color:var(--up)">▶ exports</span>' : '<span style="color:var(--down)">◀ imports</span>'}</td></tr>`;
  }).join('');
  document.getElementById('cb-note').textContent = 'ENTSO-E A11 physical flows, average of the published hours of the fetch day.';
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

async function loadLoad() {
  window._loadLoaded = true;
  const country = (document.getElementById('load-country') || {}).value || 'FR';
  const offset  = window._loadDayOffset || 0;
  const countryNames = { FR:'France', DE_LU:'Germany', BE:'Belgium', NL:'Netherlands', ES:'Spain', GB:'Great Britain', IT_NORD:'Italy North' };
  const cname = countryNames[country] || country;
  const today = pkTodayISO();
  const dayISO = (() => { const [y,m,d] = today.split('-').map(Number); return new Date(Date.UTC(y, m-1, d + offset)).toISOString().slice(0,10); })();
  const lyISO  = (() => { const [y,m,d] = dayISO.split('-').map(Number); return new Date(Date.UTC(y, m-1, d - 364)).toISOString().slice(0,10); })();
  const fetchDay = async iso => { try { const r = await fetch(DATA_BASE + 'history/daily/' + iso + '.json'); return r.ok ? await r.json() : null; } catch (_) { return null; } };

  // Day data. France: RTE éCO2mix (consumption, D-1 and intraday forecasts;
  // real-time then consolidated history). Other zones: ENTSO-E live
  // snapshot for its day, daily history file otherwise.
  let actual = null, forecast = null, forecastJ = null, src = '';
  if (country === 'FR' && window.PK_E2M) {
    const e = await PK_E2M.day(dayISO);
    if (e && e.consommation.some(v => v != null)) {
      actual = _e2mFill(e.consommation); forecast = _e2mFill(e.prevision_j1); forecastJ = _e2mFill(e.prevision_j);
      src = 'RTE éCO2mix · ' + e.dataset;
    }
  }
  const live = window._loadData && window._loadData[country];
  const liveDate = window._loadDataUpdated ? new Date(window._loadDataUpdated).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }) : null;
  if (!actual && live && liveDate === dayISO) { actual = live.actual; forecast = live.forecast || null; src = 'ENTSO-E A65 · live snapshot'; }
  if (!actual) {
    const day = await fetchDay(dayISO);
    const z = day && day.zones && day.zones[country];
    if (z && Array.isArray(z.load)) { actual = z.load; forecast = z.loadForecast || null; src = 'ENTSO-E A65 · daily history'; }
  }
  let lastYear = null;
  if (country === 'FR' && window.PK_E2M) {
    const e = await PK_E2M.day(lyISO);
    if (e && e.consommation.some(v => v != null)) lastYear = _e2mFill(e.consommation);
  }
  if (!lastYear) {
    const lyDay = await fetchDay(lyISO);
    const lyZ = lyDay && lyDay.zones && lyDay.zones[country];
    lastYear = lyZ && Array.isArray(lyZ.load) ? lyZ.load : null;
  }

  const setKPI = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const fmtDay = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
  const el_title = document.getElementById('load-chart-title');
  if (el_title) el_title.textContent = `${cname} — load (GW) · ${fmtDay(dayISO)}`;
  document.getElementById('load-updated').textContent = actual ? src : 'No data for this day';

  // First visit before today's data exists: show the latest available day
  // instead of an empty "Today".
  if ((!actual || !actual.some(v => v != null)) && !window._loadUserPicked && offset === 0 && liveDate && liveDate < dayISO) {
    const back = Math.round((Date.parse(liveDate) - Date.parse(dayISO)) / 864e5);
    window._loadDayOffset = back;
    document.querySelectorAll('#load-day-btns .day-tab').forEach(b => b.classList.toggle('active', (b.getAttribute('onclick') || '').includes('(' + back + ',')));
    return loadLoad();
  }
  if (!actual || !actual.some(v => v != null)) {
    ['load-kpi-peak-actual','load-kpi-peak-fc','load-kpi-avg','load-kpi-dev','load-kpi-yoy'].forEach(id => setKPI(id, '–'));
    ['load-kpi-peak-actual-sub','load-kpi-peak-fc-sub','load-kpi-dev-sub','load-kpi-yoy-sub'].forEach(id => setKPI(id, ''));
    if (typeof noDataMsg === 'function') noDataMsg('load-canvas', `No load data stored for ${cname} on ${fmtDay(dayISO)}`, 'Load history is kept from the daily fetch onwards (actual + day-ahead forecast).');
    const tb = document.getElementById('load-hourly-tbody'); if (tb) tb.innerHTML = '';
    return;
  }
  const c = document.getElementById('load-canvas'); if (c) { const m = c.parentNode.querySelector('.no-data-msg'); if (m) m.remove(); c.style.display = 'block'; }

  const n = actual.length, per = n / 24;
  const GW = a => a ? a.map(v => v == null ? null : v / 1000) : null;
  const A = GW(actual), F = GW(forecast), L = GW(lastYear && lastYear.length === n ? lastYear : null);
  const labels = (typeof makeTimeLabels === 'function') ? makeTimeLabels(n) : Array.from({ length: n }, (_, i) => String(Math.floor(i / per)).padStart(2, '0') + ':' + String((i % per) * (60 / per)).padStart(2, '0'));
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

  const ds = [{ label: 'Actual', data: A, borderColor: C_UP, borderWidth: 2, backgroundColor: rgba(C_UP, .08), fill: true, pointRadius: 0, tension: 0, spanGaps: false }];
  if (F) ds.push({ label: 'Day-ahead forecast', data: F, borderColor: C_WIND, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0, fill: false });
  const FJ = GW(forecastJ);
  if (FJ && FJ.some(v => v != null)) ds.push({ label: 'Intraday forecast', data: FJ, borderColor: '#7FC8F8', borderWidth: 1.2, borderDash: [2, 3], pointRadius: 0, tension: 0, fill: false });
  if (L) ds.push({ label: 'Same weekday last year', data: L, borderColor: 'rgba(184,201,217,.45)', borderWidth: 1, borderDash: [2, 3], pointRadius: 0, tension: 0, fill: false });
  mkChart('load-canvas', {
    type: 'line', data: { labels, datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 12 } },
        tooltip: { mode: 'index', callbacks: { label: ctx => ctx.raw == null ? null : ` ${ctx.dataset.label}: ${ctx.raw.toFixed(2)} GW` } },
        zoom: ZOOM_CFG,
        annotation: { annotations: (() => { const a = nowLineAnnotation({ slots: n, labels, chartDate: dayISO }); return a ? { nowLine: a } : {}; })() }
      },
      scales: { x: { grid: GRID, ticks: { color: C_TX3, maxTicksLimit: 13, maxRotation: 0 } },
                y: { grid: GRID, ticks: { color: C_TX3, callback: v => v.toFixed(0) + ' GW' } } }
    }
  });
  setTimeout(() => { addFullscreen('load-canvas'); addDownload('load-canvas', 'load-' + country + '-' + dayISO); }, 100);

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
