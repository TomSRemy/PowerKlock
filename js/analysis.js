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
  // Partial day (generation published only up to some slot): compare the
  // capture price with the baseload of the SAME slots, otherwise the
  // missing evening peak inflates the rate.
  const n = (wind || solar || []).length, per = n ? price.length / n : 1;
  const pubIdx = []; for (let i = 0; i < n; i++) if ((wind && wind[i] != null) || (solar && solar[i] != null)) pubIdx.push(i);
  const partial = n && pubIdx.length < n;
  const basePub = partial ? _renMean(pubIdx.flatMap(i => price.slice(i * per, (i + 1) * per))) : base;
  const ok = b => b != null && b > 1;
  return {
    base: basePub, baseFull: base, partial, wind, solar,
    windAvg: _renMean(wind), solarAvg: _renMean(solar),
    wCap, sCap,
    wCR: ok(basePub) && wCap != null ? wCap / basePub * 100 : null,
    sCR: ok(basePub) && sCap != null ? sCap / basePub * 100 : null,
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

// Latest day whose file carries solar output for the zone.
async function _renLatestDay(zone) {
  const days = await _renDaysWithGen(zone);
  // Today's file may exist before the summary lists it; probe today/yesterday too.
  const cands = [pkTodayISO(), _renAdd(pkTodayISO(), -1)].concat(days.slice().reverse());
  for (const d of cands) {
    const j = await _renDaily(d);
    const z = j && j.zones && j.zones[zone];
    if (z && Array.isArray(z.solar) && z.solar.some(v => v)) return d;
  }
  return pkTodayISO();
}

// One zone, one day: generation, stats and (latest day only) the DA forecast.
async function _renDay(zone, day) {
  day = day || await _renLatestDay(zone);
  const j = await _renDaily(day);
  const z = j && j.zones && j.zones[zone];
  const st = _renDayStats(z);
  if (!st || (!st.wind && !st.solar)) return { day, z: null };
  // Day-ahead forecast: only renewables.json has it, for its own day.
  const live = window._renData && window._renData[zone];
  const liveDay = window._renUpdated ? new Date(window._renUpdated).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }) : null;
  const fc = (live && liveDay === day) ? live : null;
  const n = (st.solar || st.wind).length;
  return { day, z, st, fc, liveDay, n, lbls: makeTimeLabels(n) };
}
const _renGW = a => a ? a.map(v => v == null ? null : v / 1000) : null;
const _renXAxis = () => Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 13, maxRotation: 0 } });

// France: daily stats precomputed from RTE éCO2mix (history since 2015,
// scripts/fetch_rte_eco2mix.py), so long windows don't load every daily file.
let _renFrDaily = null;
async function _renFrRows() {
  if (!_renFrDaily) _renFrDaily = fetch(DATA_BASE + 'history/rte/fr_daily.json').then(r => r.ok ? r.json() : null).catch(() => null);
  const j = await _renFrDaily;
  if (!j || !Array.isArray(j.rows) || !j.rows.length) return null;
  const ok = b => b != null && b > 5;   // capture rates are meaningless around a 0 €/MWh baseload
  return j.rows.filter(r => r.base != null).map(r => ({ d: r.d, st: { base: r.base, baseFull: r.base, partial: false, windAvg: r.windAvg, solarAvg: r.solarAvg,
    wCap: r.wCap, sCap: r.sCap, wCR: ok(r.base) && r.wCap != null ? r.wCap / r.base * 100 : null, sCR: ok(r.base) && r.sCap != null ? r.sCap / r.base * 100 : null } }));
}

// Daily stats over a window, days with generation only.
async function _renRows(zone, win) {
  const today = pkTodayISO();
  const from = win === 'All' ? '0000' : win === 'YTD' ? today.slice(0, 4) + '-01-01'
    : _renAdd(today, -({ '30D': 30, '90D': 90, '1Y': 365 }[win] || 3650));
  if (zone === 'FR') {
    const fr = await _renFrRows();
    if (fr) {
      // Days after the precomputed file (today, yesterday) come from the daily files.
      const last = fr[fr.length - 1].d, extra = [];
      for (let d = _renAdd(last, 1); d <= today; d = _renAdd(d, 1)) extra.push(d);
      const files = await Promise.all(extra.map(_renDaily));
      const tail = extra.map((d, i) => ({ d, st: _renDayStats(files[i] && files[i].zones && files[i].zones.FR) })).filter(r => r.st && r.st.base != null);
      return fr.concat(tail).filter(r => r.d >= from);
    }
  }
  let days = await _renDaysWithGen(zone);
  days = days.filter(d => d >= from);
  const files = await Promise.all(days.map(d => _renDaily(d)));
  return days.map((d, i) => ({ d, st: _renDayStats(files[i] && files[i].zones && files[i].zones[zone]) })).filter(r => r.st && r.st.base != null);
}

// Long windows: one point per month. Capture = output-weighted capture price,
// base = mean of daily baseloads, rate = capture ÷ base.
const REN_MONTHLY_FROM = 400;
function _renMonthly(rows) {
  const by = new Map();
  rows.forEach(r => { const k = r.d.slice(0, 7); if (!by.has(k)) by.set(k, []); by.get(k).push(r.st); });
  return [...by.entries()].map(([m, a]) => {
    const mean = f => { const v = a.map(f).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const wtd = (g, c) => { let sw = 0, sp = 0; a.forEach(x => { if (x[g] != null && x[c] != null) { sw += x[g]; sp += x[g] * x[c]; } }); return sw ? sp / sw : null; };
    const base = mean(x => x.base), wCap = wtd('windAvg', 'wCap'), sCap = wtd('solarAvg', 'sCap');
    return { d: m, st: { base, windAvg: mean(x => x.windAvg), solarAvg: mean(x => x.solarAvg), wCap, sCap,
      wCR: base > 5 && wCap != null ? wCap / base * 100 : null, sCR: base > 5 && sCap != null ? sCap / base * 100 : null } };
  });
}

const REN_ZONE_PARAM = { key: 'zone', label: 'Zone', inTitle: true, options: [['FR', 'France'], ['DE_LU', 'Germany'], ['ES', 'Spain'], ['BE', 'Belgium'], ['NL', 'Netherlands']] };
const REN_WINDOW_PARAM = { key: 'window', label: 'Window', options: [['30D', '30 days'], ['90D', '90 days'], ['YTD', 'Year to date'], ['1Y', '1 year'], ['All', 'All']] };
function _renReg(def) {
  if (!window.PKW) return;
  PKW.register(Object.assign({ category: 'renewables', page: 'renewables', source: 'ENTSO-E', size: { w: 6, h: 5 },
    params: [REN_ZONE_PARAM], defaults: { zone: 'FR' } }, def));
}

_renReg({
  id: 'ren-intraday', title: 'Wind & solar output vs price', pageCanvas: 'ren-intraday',
  desc: 'Stacked wind and solar output of the latest day with the day-ahead price.',
  async draw(cid, p) {
    const D = await _renDay(p.zone, p.day);
    if (!D.z) { noDataMsg(cid, 'No generation data for ' + p.zone + ' on ' + _renFmtDay(D.day), ''); return { day: D.day }; }
    const { z, st, n, lbls, day } = D;
    const ds = [];
    const area = (label, data, col) => ({ label, data, backgroundColor: rgba(col, .55), borderColor: col, borderWidth: 1, fill: true, pointRadius: 0, stack: 'g', yAxisID: 'y', tension: 0 });
    if (z.windOnshore) ds.push(area('Wind onshore', _renGW(z.windOnshore), C_WON));
    if (z.windOffshore && z.windOffshore.some(v => v)) ds.push(area('Wind offshore', _renGW(z.windOffshore), C_WOFF));
    if (!z.windOnshore && st.wind) ds.push(area('Wind', _renGW(st.wind), C_WON));
    if (st.solar) ds.push(area('Solar', _renGW(st.solar), C_SOL));
    if (z.hourly && z.hourly.length === n) ds.push({ label: 'Day-ahead price', data: z.hourly, type: 'line', borderColor: '#FFFFFF', borderWidth: 1.4, pointRadius: 0, fill: false, yAxisID: 'y1', tension: 0, order: -1, stack: 'p' });
    const a = nowLineAnnotation({ slots: n, labels: lbls, chartDate: day });
    _fuelChart(cid, { type: 'line', data: { labels: lbls, datasets: ds }, options: _fuelOpts({
      scales: { x: _renXAxis(), y: _fuelAxis('GW', { stacked: true, beginAtZero: true }), y1: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }) },
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
        annotation: { annotations: a ? { nowLine: a } : {} } } }) }, 'renewables-' + p.zone + '-' + day);
    return { day, sub: _renFmtDay(day), D };
  },
});

_renReg({
  id: 'ren-fc', title: 'Wind & solar · forecast vs actual', pageCanvas: 'ren-fc',
  desc: 'Day-ahead forecast against actual output, latest fetched day.',
  async draw(cid, p) {
    let D = await _renDay(p.zone, p.day);
    const hasFc = x => x.z && x.fc && (x.fc.windForecast || x.fc.solarForecast);
    // no day asked and the forecast of the newest day not stored yet: show the latest day that has one
    if (!hasFc(D) && !p.day && D.liveDay && D.liveDay !== D.day) D = await _renDay(p.zone, D.liveDay);
    const fc = D.fc;
    if (!hasFc(D)) {
      noDataMsg(cid, 'Day-ahead forecast not stored for this day', `The forecast is kept for the latest fetched day${D.liveDay ? ' (' + _renFmtDay(D.liveDay) + ')' : ''}.`);
      return null;
    }
    const st = D.st, fds = [];
    if (st.wind) fds.push(_fuelLineDs('Wind actual', _renGW(st.wind), C_WON, { borderWidth: 2 }));
    if (fc.windForecast) fds.push(_fuelLineDs('Wind forecast', _renGW(fc.windForecast), C_WON, { borderDash: [5, 4], borderWidth: 1.3 }));
    if (st.solar) fds.push(_fuelLineDs('Solar actual', _renGW(st.solar), C_SOL, { borderWidth: 2 }));
    if (fc.solarForecast) fds.push(_fuelLineDs('Solar forecast', _renGW(fc.solarForecast), C_SOL, { borderDash: [5, 4], borderWidth: 1.3 }));
    _fuelChart(cid, { type: 'line', data: { labels: D.lbls, datasets: fds }, options: _fuelOpts({
      scales: { x: _renXAxis(), y: _fuelAxis('GW', { beginAtZero: true }) } }) }, 'ren-forecast-' + p.zone + '-' + D.day);
    return { sub: _renFmtDay(D.day) };
  },
});

_renReg({
  id: 'ren-cr', title: 'Wind & solar capture rates', pageCanvas: 'ren-cr',
  desc: 'Daily capture price as a share of baseload, wind and solar.',
  params: [REN_ZONE_PARAM, REN_WINDOW_PARAM], defaults: { zone: 'FR', window: 'All' },
  async draw(cid, p) {
    let rows = p.rows || await _renRows(p.zone, p.window);
    if (!rows.length) { noDataMsg(cid, 'No generation history for ' + p.zone + ' in this window', ''); return null; }
    const nDays = rows.length, monthly = nDays > REN_MONTHLY_FROM;
    if (monthly) rows = _renMonthly(rows);
    const r1 = v => v == null ? null : Math.round(v * 10) / 10;
    _fuelChart(cid, { type: 'line', data: { labels: rows.map(r => r.d), datasets: [
      _fuelLineDs(monthly ? 'Wind CR (monthly)' : 'Wind CR', rows.map(r => r1(r.st.wCR)), C_WON, { pointRadius: 2, spanGaps: false }),
      _fuelLineDs(monthly ? 'Solar CR (monthly)' : 'Solar CR', rows.map(r => r1(r.st.sCR)), C_SOL, { pointRadius: 2, spanGaps: false }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('% of baseload') },
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
        annotation: { annotations: { par: { type: 'line', yMin: 100, yMax: 100, borderColor: 'rgba(184,201,217,.35)', borderWidth: 1, borderDash: [4, 4] } } } } }) }, 'capture-rates-' + p.zone);
    return { sub: nDays + ' days with generation data' + (monthly ? ' · monthly points' : '') };
  },
});

_renReg({
  id: 'ren-daily', title: 'Daily wind & solar output', pageCanvas: 'ren-daily',
  desc: 'Daily average wind and solar output with 7-day averages.',
  params: [REN_ZONE_PARAM, REN_WINDOW_PARAM], defaults: { zone: 'FR', window: 'All' },
  async draw(cid, p) {
    let rows = p.rows || await _renRows(p.zone, p.window);
    if (!rows.length) { noDataMsg(cid, 'No generation history for ' + p.zone + ' in this window', ''); return null; }
    if (rows.length > REN_MONTHLY_FROM) {
      const m = _renMonthly(rows);
      _fuelChart(cid, { type: 'line', data: { labels: m.map(r => r.d), datasets: [
        _fuelLineDs('Wind (monthly avg)', m.map(r => r.st.windAvg == null ? null : Math.round(r.st.windAvg) / 1000), C_WON, { borderWidth: 2, pointRadius: 1.5 }),
        _fuelLineDs('Solar (monthly avg)', m.map(r => r.st.solarAvg == null ? null : Math.round(r.st.solarAvg) / 1000), C_SOL, { borderWidth: 2, pointRadius: 1.5 }),
      ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { beginAtZero: true }) } }) }, 'ren-daily-' + p.zone);
      return;
    }
    const roll = (a, k) => a.map((_, i) => { const w = a.slice(Math.max(0, i - k + 1), i + 1).filter(v => v != null); return w.length ? Math.round(w.reduce((s, v) => s + v, 0) / w.length) / 1000 : null; });
    const wA = rows.map(r => r.st.windAvg), sA = rows.map(r => r.st.solarAvg);
    _fuelChart(cid, { type: 'line', data: { labels: rows.map(r => r.d), datasets: [
      _fuelLineDs('Wind', wA.map(v => v == null ? null : v / 1000), rgba(C_WON, .55), { borderWidth: 1 }),
      _fuelLineDs('Wind 7D', roll(wA, 7), C_WON, { borderWidth: 2 }),
      _fuelLineDs('Solar', sA.map(v => v == null ? null : v / 1000), rgba(C_SOL, .55), { borderWidth: 1 }),
      _fuelLineDs('Solar 7D', roll(sA, 7), C_SOL, { borderWidth: 2 }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { beginAtZero: true }) } }) }, 'ren-daily-' + p.zone);
  },
});

async function loadRenewables() {
  const zone = (document.getElementById('ren-country') || {}).value || 'FR';
  if (!REN.day) REN.day = await _renLatestDay(zone);
  const day = REN.day;
  document.getElementById('ren-day').textContent = _renFmtDay(day);
  document.getElementById('ren-intraday-title').textContent = `Intraday output vs price · ${zone} · ${_renFmtDay(day)}`;

  // France generation comes from RTE éCO2mix (js/fr-rte.js), other zones from ENTSO-E.
  const srcLbl = { 'ren-intraday': zone === 'FR' ? 'RTE éCO2mix' : 'ENTSO-E', 'ren-fc': zone === 'FR' ? 'RTE actual · ENTSO-E forecast' : 'ENTSO-E',
    'ren-cr': zone === 'FR' ? 'RTE éCO2mix' : 'ENTSO-E', 'ren-daily': zone === 'FR' ? 'RTE éCO2mix' : 'ENTSO-E' };
  Object.entries(srcLbl).forEach(([id, t]) => { const c = document.getElementById(id); const b = c && c.closest('.fuel-card') && c.closest('.fuel-card').querySelector('.source-badge'); if (b) b.textContent = t; });

  const D = await _renDay(zone, day);
  const kpis = document.getElementById('ren-kpis');
  PKW.draw('ren-intraday', 'ren-intraday', { zone, day });
  PKW.draw('ren-fc', 'ren-fc', { zone, day });
  _renHistory();
  if (typeof renderM0 === 'function') renderM0();
  if (!D.z) {
    kpis.innerHTML = `<div class="fuel-note" style="grid-column:1/-1">No wind/solar data for ${zone} on ${_renFmtDay(day)}.</div>`;
    return;
  }
  const { z, st, fc, n, lbls } = D;
  const wape = (act, f) => {
    if (!act || !f) return null; let e = 0, s = 0;
    act.forEach((v, i) => { if (v != null && f[i] != null) { e += Math.abs(v - f[i]); s += f[i]; } });
    return s > 0 ? e / s * 100 : null;
  };
  const wErr = fc ? wape(st.wind, fc.windForecast) : null, sErr = fc ? wape(st.solar, fc.solarForecast) : null;
  const total = ['nuclear', 'hydro', 'fossil', 'biomass', 'other', 'wind', 'solar'].map(k => _renMean(z[k]) || 0).reduce((a, b) => a + b, 0);
  const vrePct = total > 0 ? ((st.windAvg || 0) + (st.solarAvg || 0)) / total * 100 : null;
  const peakOf = a => { let mi = -1; (a || []).forEach((v, i) => { if (v != null && (mi < 0 || v > a[mi])) mi = i; }); return mi; };
  const sp = peakOf(st.solar), wp = peakOf(st.wind);
  const crTone = v => v == null ? null : v >= 100 ? 'up' : 'down';
  const g = v => v == null ? '–' : (v / 1000).toFixed(2);
  const pub = (st.solar || st.wind).filter(v => v != null).length;
  const partial = pub < n ? ` · partial day ${pub}/${n} slots` : '';
  kpis.innerHTML =
    _fuelKpi('Wind avg', g(st.windAvg), 'GW', wp >= 0 ? `peak ${g(st.wind[wp])} GW at ${lbls[wp]}` : '') +
    _fuelKpi('Solar avg', g(st.solarAvg), 'GW', sp >= 0 ? `peak ${g(st.solar[sp])} GW at ${lbls[sp]}` : '') +
    _fuelKpi('Wind + solar share', vrePct == null ? '–' : vrePct.toFixed(1), '%', 'of published generation' + partial) +
    _fuelKpi('Wind capture', st.wCap == null ? '–' : st.wCap.toFixed(2), '€/MWh', st.wCR == null ? '' : `${st.wCR.toFixed(0)}% of ${st.partial ? 'base on published slots' : 'baseload'} ${st.base.toFixed(2)}`, crTone(st.wCR)) +
    _fuelKpi('Solar capture', st.sCap == null ? '–' : st.sCap.toFixed(2), '€/MWh', st.sCR == null ? '' : `${st.sCR.toFixed(0)}% of ${st.partial ? 'base on published slots' : 'baseload'} ${st.base.toFixed(2)}`, crTone(st.sCR)) +
    _fuelKpi('DA forecast error', wErr == null && sErr == null ? '–' : `${wErr == null ? '–' : wErr.toFixed(1)} / ${sErr == null ? '–' : sErr.toFixed(1)}`, '%',
      fc ? 'wind / solar · WAPE on published slots' : 'forecast kept for the latest day only');
}

async function _renHistory() {
  const zone = (document.getElementById('ren-country') || {}).value || 'FR';
  const rows = await _renRows(zone, REN.window);
  document.getElementById('ren-coverage').textContent = rows.length
    ? `${rows.length} days with generation data for ${zone} (${_renFmtDay(rows[0].d)} → ${_renFmtDay(rows[rows.length - 1].d)})`
    : `No generation history for ${zone} in this window`;
  PKW.draw('ren-cr', 'ren-cr', { zone, rows });
  PKW.draw('ren-daily', 'ren-daily', { zone, rows });
  if (!rows.length) { document.getElementById('ren-summary-tbody').innerHTML = ''; return; }

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
