// ════════════════════════════════════════════════════════════════════
// RENEWABLES — wind & solar output, forecast accuracy, capture prices
//
// Real data only:
//   - daily history files (generation arrays + day-ahead prices, realigned
//     to Paris time by gen-align.js) for any past day and for history;
//   - renewables.json for the day-ahead wind/solar forecast of its own day;
//   - summary.json to find which days carry generation data.
// Capture price = Σ(MW × price) ÷ Σ(MW) over the day's slots; capture rate =
// capture price ÷ baseload (simple average price of the same day).
// ════════════════════════════════════════════════════════════════════

const REN = { day: null, window: 'All', cache: new Map() };
const C_WON = '#C4A57B', C_WOFF = '#7FC8F8', C_SOL = '#FBBF24';

function _renISO(d) { return d.toISOString().slice(0, 10); }
function _renAdd(iso, n) { const [y, m, d] = iso.split('-').map(Number); return _renISO(new Date(Date.UTC(y, m - 1, d + n))); }
function _renFmtDay(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
function _renMean(a) { const v = (a || []).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }

async function _renDaily(iso) {
  if (!REN.cache.has(iso)) {
    REN.cache.set(iso, fetch(DATA_BASE + 'history/daily/' + iso + '.json').then(r => r.ok ? r.json() : null).catch(() => null));
  }
  return REN.cache.get(iso);
}

// Generation-weighted average price over slots where both exist.
function _renCapture(gen, price) {
  if (!gen || !price) return null;
  const n = Math.min(gen.length, price.length);
  const per = price.length / gen.length;            // prices may be 96 vs gen 96/24
  let sw = 0, swp = 0;
  for (let i = 0; i < gen.length; i++) {
    const g = gen[i], p = per === 1 ? price[i] : _renMean(price.slice(i * per, (i + 1) * per));
    if (g == null || p == null || g <= 0) continue;
    sw += g; swp += g * p;
  }
  return sw > 0 ? swp / sw : null;
}

function _renDayStats(z) {
  if (!z) return null;
  const price = z.hourly || [];
  const base = _renMean(price);
  const wind = z.wind || (z.windOnshore && z.windOffshore ? z.windOnshore.map((v, i) => v == null ? null : v + (z.windOffshore[i] || 0)) : z.windOnshore);
  const solar = z.solar;
  const wCap = _renCapture(wind, price), sCap = _renCapture(solar, price);
  const ok = b => b != null && b > 1;
  return {
    base, wind, solar,
    windAvg: _renMean(wind), solarAvg: _renMean(solar),
    wCap, sCap,
    wCR: ok(base) && wCap != null ? wCap / base * 100 : null,
    sCR: ok(base) && sCap != null ? sCap / base * 100 : null,
  };
}

async function _renDaysWithGen(zone) {
  const s = typeof fetchSummary === 'function' ? await fetchSummary() : null;
  const ser = s && s.zones && s.zones[zone] || [];
  const set = new Set(ser.filter(e => e.windAvg != null || e.solarAvg != null).map(e => e.d));
  // summary.json isn't refreshed by the daily fetch: probe the last 14 days.
  const t = pkTodayISO();
  const recent = Array.from({ length: 14 }, (_, i) => _renAdd(t, -i));
  const files = await Promise.all(recent.map(_renDaily));
  recent.forEach((d, i) => { const z = files[i] && files[i].zones && files[i].zones[zone]; if (z && ((z.solar || []).some(v => v) || (z.wind || []).some(v => v))) set.add(d); });
  return [...set].sort();
}

function renShiftDay(n) {
  if (n === 0) REN.day = null; else if (REN.day) REN.day = _renAdd(REN.day, n);
  loadRenewables();
}
function renSetWindow(w, btn) {
  REN.window = w;
  if (btn) { btn.parentNode.querySelectorAll('.pk-gf-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
  _renHistory();
}
// Kept for old call sites (header buttons were removed with the redesign).
function setRenTab() { loadRenewables(); }
function setRenTech() { loadRenewables(); }
function drawRenChart() { loadRenewables(); }

async function loadRenewables() {
  const zone = (document.getElementById('ren-country') || {}).value || 'FR';
  const days = await _renDaysWithGen(zone);
  // Today's file may exist before the summary lists it; probe today/yesterday too.
  const latestCandidates = [pkTodayISO(), _renAdd(pkTodayISO(), -1)].concat(days.slice().reverse());
  if (!REN.day) {
    for (const d of latestCandidates) {
      const j = await _renDaily(d);
      const z = j && j.zones && j.zones[zone];
      if (z && Array.isArray(z.solar) && z.solar.some(v => v)) { REN.day = d; break; }
    }
  }
  const day = REN.day || pkTodayISO();
  document.getElementById('ren-day').textContent = _renFmtDay(day);

  const j = await _renDaily(day);
  const z = j && j.zones && j.zones[zone];
  const st = _renDayStats(z);
  const kpis = document.getElementById('ren-kpis');
  if (!st || (!st.wind && !st.solar)) {
    kpis.innerHTML = `<div class="fuel-note" style="grid-column:1/-1">No wind/solar data for ${zone} on ${_renFmtDay(day)}.</div>`;
    ['ren-intraday', 'ren-fc'].forEach(id => { if (typeof noDataMsg === 'function') noDataMsg(id, 'No generation data for this day', ''); });
    _renHistory();
    return;
  }
  ['ren-intraday', 'ren-fc'].forEach(_renRestore);

  // Day-ahead forecast: only renewables.json has it, for its own day.
  const live = window._renData && window._renData[zone];
  const liveDay = window._renUpdated ? new Date(window._renUpdated).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }) : null;
  const fc = (live && liveDay === day) ? live : null;
  const wape = (act, f) => {
    if (!act || !f) return null; let e = 0, s = 0;
    act.forEach((v, i) => { if (v != null && f[i] != null) { e += Math.abs(v - f[i]); s += f[i]; } });
    return s > 0 ? e / s * 100 : null;
  };
  const wErr = fc ? wape(st.wind, fc.windForecast) : null, sErr = fc ? wape(st.solar, fc.solarForecast) : null;
  const total = ['nuclear', 'hydro', 'fossil', 'biomass', 'other', 'wind', 'solar'].map(k => _renMean(z[k]) || 0).reduce((a, b) => a + b, 0);
  const vrePct = total > 0 ? ((st.windAvg || 0) + (st.solarAvg || 0)) / total * 100 : null;
  const peakOf = a => { let mi = -1; (a || []).forEach((v, i) => { if (v != null && (mi < 0 || v > a[mi])) mi = i; }); return mi; };
  const n = (st.solar || st.wind).length, lbls = typeof makeTimeLabels === 'function' ? makeTimeLabels(n) : [];
  const sp = peakOf(st.solar), wp = peakOf(st.wind);
  const crTone = v => v == null ? null : v >= 100 ? 'up' : 'down';
  const g = v => v == null ? '–' : (v / 1000).toFixed(2);
  const pub = (st.solar || st.wind).filter(v => v != null).length;
  const partial = pub < n ? ` · partial day ${pub}/${n} slots` : '';
  kpis.innerHTML =
    _fuelKpi('Wind avg', g(st.windAvg), 'GW', wp >= 0 ? `peak ${g(st.wind[wp])} GW at ${lbls[wp]}` : '') +
    _fuelKpi('Solar avg', g(st.solarAvg), 'GW', sp >= 0 ? `peak ${g(st.solar[sp])} GW at ${lbls[sp]}` : '') +
    _fuelKpi('Wind + solar share', vrePct == null ? '–' : vrePct.toFixed(1), '%', 'of published generation' + partial) +
    _fuelKpi('Wind capture', st.wCap == null ? '–' : st.wCap.toFixed(2), '€/MWh', st.wCR == null ? '' : `${st.wCR.toFixed(0)}% of baseload ${st.base.toFixed(2)}`, crTone(st.wCR)) +
    _fuelKpi('Solar capture', st.sCap == null ? '–' : st.sCap.toFixed(2), '€/MWh', st.sCR == null ? '' : `${st.sCR.toFixed(0)}% of baseload ${st.base.toFixed(2)}`, crTone(st.sCR)) +
    _fuelKpi('DA forecast error', wErr == null && sErr == null ? '–' : `${wErr == null ? '–' : wErr.toFixed(1)} / ${sErr == null ? '–' : sErr.toFixed(1)}`, '%',
      fc ? 'wind / solar · WAPE on published slots' : 'forecast kept for the latest day only');

  // Intraday stacked output + price
  const GW = a => a ? a.map(v => v == null ? null : v / 1000) : null;
  const ds = [];
  if (z.windOnshore) ds.push({ label: 'Wind onshore', data: GW(z.windOnshore), backgroundColor: rgba(C_WON, .55), borderColor: C_WON, borderWidth: 1, fill: true, pointRadius: 0, stack: 'g', yAxisID: 'y', tension: 0 });
  if (z.windOffshore && z.windOffshore.some(v => v)) ds.push({ label: 'Wind offshore', data: GW(z.windOffshore), backgroundColor: rgba(C_WOFF, .55), borderColor: C_WOFF, borderWidth: 1, fill: true, pointRadius: 0, stack: 'g', yAxisID: 'y', tension: 0 });
  if (!z.windOnshore && st.wind) ds.push({ label: 'Wind', data: GW(st.wind), backgroundColor: rgba(C_WON, .55), borderColor: C_WON, borderWidth: 1, fill: true, pointRadius: 0, stack: 'g', yAxisID: 'y', tension: 0 });
  if (st.solar) ds.push({ label: 'Solar', data: GW(st.solar), backgroundColor: rgba(C_SOL, .55), borderColor: C_SOL, borderWidth: 1, fill: true, pointRadius: 0, stack: 'g', yAxisID: 'y', tension: 0 });
  if (z.hourly && z.hourly.length === n) ds.push({ label: 'Day-ahead price', data: z.hourly, type: 'line', borderColor: '#FFFFFF', borderWidth: 1.4, pointRadius: 0, fill: false, yAxisID: 'y1', tension: 0, order: -1, stack: 'p' });
  _fuelChart('ren-intraday', { type: 'line', data: { labels: lbls, datasets: ds }, options: _fuelOpts({
    scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 13, maxRotation: 0 } }),
      y: _fuelAxis('GW', { stacked: true, beginAtZero: true }), y1: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }) },
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
      annotation: { annotations: (() => { const a = nowLineAnnotation({ slots: n, labels: lbls, chartDate: day }); return a ? { nowLine: a } : {}; })() } } }) }, 'renewables-' + zone + '-' + day);
  document.getElementById('ren-intraday-title').textContent = `Intraday output vs price · ${zone} · ${_renFmtDay(day)}`;

  // Forecast vs actual
  if (fc && (fc.windForecast || fc.solarForecast)) {
    const fds = [];
    if (st.wind) fds.push(_fuelLineDs('Wind actual', GW(st.wind), C_WON, { borderWidth: 2 }));
    if (fc.windForecast) fds.push(_fuelLineDs('Wind forecast', GW(fc.windForecast), C_WON, { borderDash: [5, 4], borderWidth: 1.3 }));
    if (st.solar) fds.push(_fuelLineDs('Solar actual', GW(st.solar), C_SOL, { borderWidth: 2 }));
    if (fc.solarForecast) fds.push(_fuelLineDs('Solar forecast', GW(fc.solarForecast), C_SOL, { borderDash: [5, 4], borderWidth: 1.3 }));
    _fuelChart('ren-fc', { type: 'line', data: { labels: lbls, datasets: fds }, options: _fuelOpts({
      scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 13, maxRotation: 0 } }), y: _fuelAxis('GW', { beginAtZero: true }) } }) }, 'ren-forecast-' + zone + '-' + day);
  } else if (typeof noDataMsg === 'function') {
    noDataMsg('ren-fc', 'Day-ahead forecast not stored for this day', `The forecast is kept for the latest fetched day${liveDay ? ' (' + _renFmtDay(liveDay) + ')' : ''} — use "Latest".`);
  }
  _renHistory();
}

async function _renHistory() {
  const zone = (document.getElementById('ren-country') || {}).value || 'FR';
  let days = await _renDaysWithGen(zone);
  const today = pkTodayISO();
  const from = REN.window === 'All' ? '0000' : REN.window === 'YTD' ? today.slice(0, 4) + '-01-01'
    : _renAdd(today, -({ '30D': 30, '90D': 90, '1Y': 365 }[REN.window] || 3650));
  days = days.filter(d => d >= from);
  const files = await Promise.all(days.map(d => _renDaily(d)));
  const rows = days.map((d, i) => ({ d, st: _renDayStats(files[i] && files[i].zones && files[i].zones[zone]) })).filter(r => r.st && r.st.base != null);
  document.getElementById('ren-coverage').textContent = rows.length
    ? `${rows.length} days with generation data for ${zone} (${_renFmtDay(rows[0].d)} → ${_renFmtDay(rows[rows.length - 1].d)})`
    : `No generation history for ${zone} in this window`;
  if (!rows.length) {
    ['ren-cr', 'ren-daily'].forEach(id => { if (typeof noDataMsg === 'function') noDataMsg(id, 'No history', ''); });
    document.getElementById('ren-summary-tbody').innerHTML = '';
    return;
  }
  ['ren-cr', 'ren-daily'].forEach(_renRestore);
  const labels = rows.map(r => r.d);
  const r1 = v => v == null ? null : Math.round(v * 10) / 10;
  _fuelChart('ren-cr', { type: 'line', data: { labels, datasets: [
    _fuelLineDs('Wind CR', rows.map(r => r1(r.st.wCR)), C_WON, { pointRadius: 2, spanGaps: false }),
    _fuelLineDs('Solar CR', rows.map(r => r1(r.st.sCR)), C_SOL, { pointRadius: 2, spanGaps: false }),
  ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('% of baseload') },
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
      annotation: { annotations: { par: { type: 'line', yMin: 100, yMax: 100, borderColor: 'rgba(184,201,217,.35)', borderWidth: 1, borderDash: [4, 4] } } } } }) }, 'capture-rates-' + zone);

  const roll = (a, k) => a.map((_, i) => { const w = a.slice(Math.max(0, i - k + 1), i + 1).filter(v => v != null); return w.length ? Math.round(w.reduce((s, v) => s + v, 0) / w.length) / 1000 : null; });
  const wA = rows.map(r => r.st.windAvg), sA = rows.map(r => r.st.solarAvg);
  _fuelChart('ren-daily', { type: 'line', data: { labels, datasets: [
    _fuelLineDs('Wind', wA.map(v => v == null ? null : v / 1000), rgba(C_WON, .55), { borderWidth: 1 }),
    _fuelLineDs('Wind 7D', roll(wA, 7), C_WON, { borderWidth: 2 }),
    _fuelLineDs('Solar', sA.map(v => v == null ? null : v / 1000), rgba(C_SOL, .55), { borderWidth: 1 }),
    _fuelLineDs('Solar 7D', roll(sA, 7), C_SOL, { borderWidth: 2 }),
  ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { beginAtZero: true }) } }) }, 'ren-daily-' + zone);

  // Period table
  const periods = [['Last 7 days', 7], ['Last 30 days', 30], ['Last 90 days', 90], ['Year to date', 'YTD'], ['Window', 'ALL']];
  const agg = sel => {
    let wsw = 0, wswp = 0, ssw = 0, sswp = 0, bs = 0, bn = 0, wsum = 0, ssum = 0, n = 0;
    sel.forEach(r => {
      const p = r.st; n++;
      if (p.base != null) { bs += p.base; bn++; }
      if (p.windAvg != null && p.wCap != null) { wsw += p.windAvg; wswp += p.windAvg * p.wCap; }
      if (p.solarAvg != null && p.sCap != null) { ssw += p.solarAvg; sswp += p.solarAvg * p.sCap; }
      wsum += p.windAvg || 0; ssum += p.solarAvg || 0;
    });
    const base = bn ? bs / bn : null, wc = wsw ? wswp / wsw : null, sc = ssw ? sswp / ssw : null;
    return { n, base, wAvg: n ? wsum / n : null, sAvg: n ? ssum / n : null, wc, sc, wcr: base > 1 && wc != null ? wc / base * 100 : null, scr: base > 1 && sc != null ? sc / base * 100 : null };
  };
  const last = rows[rows.length - 1].d;
  const crCell = v => `<td style="color:${v == null ? 'var(--text3)' : v >= 100 ? 'var(--up)' : 'var(--down)'};font-weight:600">${v == null ? '–' : v.toFixed(0) + '%'}</td>`;
  document.getElementById('ren-summary-tbody').innerHTML = periods.map(([lbl, k]) => {
    const sel = k === 'ALL' ? rows : k === 'YTD' ? rows.filter(r => r.d >= last.slice(0, 4) + '-01-01') : rows.filter(r => r.d > _renAdd(last, -k));
    if (!sel.length) return '';
    const a = agg(sel);
    return `<tr><td>${lbl}</td><td>${a.n}</td><td>${_fuelFmt(a.base)}</td><td>${_fuelFmt(a.wAvg / 1000)} GW</td><td>${_fuelFmt(a.wc)}</td>${crCell(a.wcr)}` +
      `<td>${_fuelFmt(a.sAvg / 1000)} GW</td><td>${_fuelFmt(a.sc)}</td>${crCell(a.scr)}</tr>`;
  }).join('');
  document.getElementById('ren-note').textContent =
    'Period capture prices are output-weighted across days (Σ daily avg MW × daily capture ÷ Σ daily avg MW); baseload = mean of daily averages. ' +
    'Only days with generation data are counted (see coverage above). Generation slots realigned to CET/CEST.';
}

function _renRestore(id) {
  const c = document.getElementById(id); if (!c) return;
  const m = c.parentNode.querySelector('.no-data-msg'); if (m) m.remove();
  c.style.display = 'block';
}
