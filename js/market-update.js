// ════════════════════════════════════════════════════════════════════
// MARKET UPDATE charts — the internal "point marché", shown on their
// pages and gathered in the built-in "Market update" dashboard.
//   Supply:  5-week outlook vs normal (hydro precipitation, solar, wind),
//            French nuclear output by month and year, EU gas storage by year
//   Demand:  temperature outlook vs normal, consumption vs normal
//   Prices:  calendar forwards, Cal+1 and its drivers, spot by month over
//            12 months, spot over 30 days, today's and yesterday's curve
// Sources: data/weather_outlook.json (scripts/fetch_weather_outlook.py,
// Open-Meteo GFS ensemble + ERA5 normals, RTE calibration), RTE éCO2mix
// (history/rte/fr_daily.json), GIE AGSI (commodities_series.json), market
// data (fr_market_calchain.json, commodities), ENTSO-E day-ahead.
// ════════════════════════════════════════════════════════════════════
const MU = { cache: {} };
const MU_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function _muGet(key, path) { if (!MU.cache[key]) MU.cache[key] = fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => null); return MU.cache[key]; }
// French or English for the sentences built here
const _muT = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
function _muToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()); }
function _muAdd(iso, n) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
const _muDay = iso => +iso.slice(8) + ' ' + MU_MON[+iso.slice(5, 7) - 1];
const _muLegend = () => ({ display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !/^_/.test(it.text) } });
const _muMean = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
// vertical "today" line on a category axis
function _muTodayPlugin(idx) {
  return { id: 'muToday', afterDatasetsDraw(ch) { if (idx < 0) return; const x = ch.scales.x.getPixelForValue(idx), a = ch.chartArea, g = ch.ctx;
    g.save(); g.strokeStyle = 'rgba(184,201,217,.45)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, a.top); g.lineTo(x, a.bottom); g.stroke();
    g.fillStyle = 'rgba(184,201,217,.8)'; g.font = '9px "IBM Plex Mono", monospace'; g.fillText('today', x + 4, a.top + 10); g.restore(); } };
}

const MU_ZONE = { key: 'zone', label: 'Zone', inTitle: true, options: (typeof ZONES !== 'undefined' ? ZONES : [{ code: 'FR', name: 'France' }]).map(z => [z.code, z.name]).sort((a, b) => a[1].localeCompare(b[1])) };
const MU_FWD = { key: 'country', label: 'Market', inTitle: true, options: [['FR', 'France'], ['DE', 'Germany'], ['NL', 'Netherlands'], ['UK', 'Great Britain']] };
const _muZoneName = z => ((typeof ZONES !== 'undefined' ? ZONES : []).find(x => x.code === z) || {}).name || z;
function _muReg(def) { if (window.PKW) PKW.register(Object.assign({ size: { w: 6, h: 5 } }, def)); }

// ── 1. outlook vs normal ──
const MU_OUT_COUNTRY = { key: 'country', label: 'Country', inTitle: true, options: [['FR', 'France'], ['DE', 'Germany'], ['ES', 'Spain'], ['BE', 'Belgium'], ['NL', 'Netherlands'], ['IT', 'Italy'], ['CH', 'Switzerland'], ['AT', 'Austria']] };
const MU_OUT = {
  // site palette: more supply than normal = accent, less = down red; warmer = warn, colder = blue
  precip: { title: 'Hydro proxy · precipitation vs normal', col: '#3FA6B4', above: 'rgba(20,211,169,.20)', below: 'rgba(237,105,101,.20)' },
  solar: { title: 'Solar production vs normal', col: '#FBBF24', above: 'rgba(20,211,169,.20)', below: 'rgba(237,105,101,.20)' },
  wind: { title: 'Wind production vs normal', col: '#14D3A9', above: 'rgba(20,211,169,.20)', below: 'rgba(237,105,101,.20)' },
  temp: { title: 'Temperature vs normal', col: '#EE9B00', above: 'rgba(238,155,0,.20)', below: 'rgba(127,200,248,.20)' },
};
_muReg({
  id: 'wx-outlook', title: '5-week outlook vs normal', category: 'weather', page: 'wxcities', pageCanvas: 'wx-out-wind', source: 'Open-Meteo GFS ensemble · RTE',
  desc: 'Next 5 weeks against the 2016–2025 normal: temperature, wind and solar production (GWh/day, calibrated on RTE or ENTSO-E output) or hydro-basin precipitation; France, Germany, Spain, Belgium, Netherlands, Italy, Switzerland, Austria. Band = 10th–90th percentile of the 31 ensemble members.',
  params: [MU_OUT_COUNTRY, { key: 'series', label: 'Series', inTitle: true, options: [['temp', 'Temperature'], ['wind', 'Wind production'], ['solar', 'Solar production'], ['precip', 'Hydro (precipitation)']] },
    { key: 'past', label: 'Past days shown', options: [['7', '7 days'], ['14', '14 days']] }],
  defaults: { country: 'FR', series: 'wind', past: '7' },
  titleFn: p => (MU_OUT_COUNTRY.options.find(o => o[0] === (p.country || 'FR')) || ['', 'France'])[1] + ' · ' + (MU_OUT[p.series] || MU_OUT.wind).title,
  async draw(cid, p) {
    const j = await _muGet('out', 'weather_outlook.json');
    const cc = p.country || 'FR';
    const C = j && (j.countries ? j.countries[cc] : (cc === 'FR' ? j : null));
    const s = C && C.series && C.series[p.series];
    if (!s) {
      const why = !j ? 'Outlook not available yet' : !C ? 'No outlook for this country' : (C.notes && C.notes[p.series]) || (p.series === 'precip' ? 'No hydro proxy for ' + C.name + ' (little hydro)' : p.series === 'temp' ? 'No temperature outlook' : 'No calibrated ' + p.series + ' outlook for ' + C.name);
      noDataMsg(cid, why, ''); return null;
    }
    // the future matters: show only the last `past` days before today
    const firstData = Math.max(0, s.days.findIndex((_, i) => s.mean[i] != null || (s.actual && s.actual[i] != null)));
    const tIdx = s.days.indexOf(_muToday());
    const i0 = Math.max(firstData, tIdx >= 0 ? tIdx - (+p.past || 7) : 0);
    const sl = a => (a || []).slice(i0);
    const days = sl(s.days), st = MU_OUT[p.series];
    const r = v => v == null ? null : Math.round(v * 10) / 10;
    const ds = [
      { label: 'Normal ' + j.normal_years.join('–'), data: sl(s.normal).map(r), borderColor: 'rgba(184,201,217,.75)', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0, fill: false, order: 2 },
      { label: 'Forecast (ensemble mean)', data: sl(s.mean).map(r), borderColor: st.col, borderWidth: 2.2, pointRadius: 0, tension: .25, order: 1,
        fill: { target: 0, above: st.above, below: st.below } },
      { label: '_p90', data: sl(s.p90).map(r), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(122,147,171,.14)', order: 3 },
      { label: 'Ensemble 10–90 %', data: sl(s.p10).map(r), borderWidth: 0, pointRadius: 0, fill: false, backgroundColor: 'rgba(122,147,171,.14)', order: 3 },
    ];
    if (s.actual && s.actual.some(v => v != null)) ds.push({ label: p.series === 'solar' || p.series === 'wind' ? (cc === 'FR' ? 'Actual (RTE)' : 'Actual (ENTSO-E)') : 'Observed', data: sl(s.actual), borderColor: '#FFFFFF', backgroundColor: '#FFFFFF', borderWidth: 1.8, pointRadius: 0, tension: .25, spanGaps: false, order: 0 });
    const ti = days.indexOf(_muToday());
    // the forecast part (days after the last observed one) sits on the hatched FORECAST band (js/pk-forecast.js)
    const obs = sl(s.actual); let fi = -1; obs.forEach((v, i) => { if (v != null) fi = i; });
    const from = window.PKF ? Math.max(fi + 1, ti >= 0 ? ti : 0) : -1;
    _fuelChart(cid, { type: 'line', data: { labels: days.map(_muDay), datasets: ds }, plugins: window.PKF ? [] : [_muTodayPlugin(ti)],
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 10, maxRotation: 0 } }), y: _fuelAxis(s.unit) },
        plugins: { legend: _muLegend(), pkFcZone: { from: from, now: ti, nowLabel: 'today', label: 'FORECAST · ensemble' } } }) }, 'outlook-' + cc + '-' + p.series);
    const fut = days.map((d, i) => d > _muToday() ? i : -1).filter(i => i >= 0);
    const fm = _muMean(fut.map(i => sl(s.mean)[i])), nm = _muMean(fut.map(i => sl(s.normal)[i]));
    const dev = fm != null && nm ? (p.series === 'temp' ? (fm - nm).toFixed(1) + ' °C' : ((fm / nm - 1) * 100).toFixed(0) + ' %') : '';
    return { sub: _muT(`${fut.length} prochains jours : ${fm == null ? '–' : fm.toFixed(1)} ${s.unit.replace('/day', '/jour')} vs normale ${nm == null ? '–' : nm.toFixed(1)} (${dev && (fm >= nm ? '+' : '')}${dev}) · mis à jour le ${j.updated.slice(0, 10)}`, `Next ${fut.length} days: ${fm == null ? '–' : fm.toFixed(1)} ${s.unit} vs normal ${nm == null ? '–' : nm.toFixed(1)} (${dev && (fm >= nm ? '+' : '')}${dev}) · updated ${j.updated.slice(0, 10)}`) };
  },
});

// ── 2. nuclear output by month and year (RTE) ──
_muReg({
  id: 'nuc-monthly-years', title: 'France nuclear output by month', category: 'france', page: 'nuclear', pageCanvas: 'nuc-monthly', source: 'RTE éCO2mix',
  desc: 'Monthly French nuclear generation (TWh), current year against the two previous years; the current month is provisional.',
  async draw(cid) {
    const j = await _muGet('frd', 'history/rte/fr_daily.json');
    if (!j || !j.rows) { noDataMsg(cid, 'RTE history not available', ''); return null; }
    const y = +_muToday().slice(0, 4), years = [y - 2, y - 1, y];
    const by = {}; j.rows.forEach(r => { if (r.nuclearAvg == null) return; const k = r.d.slice(0, 7); (by[k] = by[k] || []).push(r.nuclearAvg); });
    const twh = (yy, m) => { const a = by[yy + '-' + String(m).padStart(2, '0')]; return a ? Math.round(a.reduce((s, v) => s + v, 0) * 24 / 1e6 * 10) / 10 : null; };
    const cols = ['#4A6280', '#7A93AB', '#A87DC4'];   // older years muted, current year in the nuclear colour
    _fuelChart(cid, { type: 'bar', data: { labels: MU_MON, datasets: years.map((yy, i) => ({ label: String(yy), data: MU_MON.map((_, m) => twh(yy, m + 1)), backgroundColor: cols[i], borderRadius: 3, borderWidth: 0 })) },
      options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('TWh', { beginAtZero: true }) }, plugins: { legend: _muLegend() } }) }, 'nuclear-monthly');
    const cur = j.rows[j.rows.length - 1].d;
    return { sub: `${years.join(' · ')} · ${MU_MON[+cur.slice(5, 7) - 1]} ${y} provisional (to ${cur})` };
  },
});

// ── 3. EU gas storage by year ──
_muReg({
  id: 'gas-storage-years', title: 'EU gas storage by year', category: 'fuels', page: 'eua', pageCanvas: 'fuel-gas-years', source: 'GIE AGSI',
  desc: 'Aggregate EU gas storage filling level (%): this year and last year against the range and mean of the earlier years since 2019.',
  async draw(cid) {
    const j = await _muGet('cs', 'history/commodities_series.json');
    const pts = j && j.series && j.series.agsi && j.series.agsi.points;
    if (!pts) { noDataMsg(cid, 'Gas storage history not available', ''); return null; }
    const y = +_muToday().slice(0, 4);
    const doy = d => Math.floor((Date.parse(d) - Date.UTC(+d.slice(0, 4), 0, 1)) / 864e5);
    const lbl = Array.from({ length: 366 }, (_, i) => { const t = new Date(Date.UTC(2001, 0, 1 + i)); return t.getUTCDate() === 1 ? MU_MON[t.getUTCMonth()] : ''; });
    const byYear = {};
    pts.forEach(([d, v]) => { const yy = +d.slice(0, 4); (byYear[yy] = byYear[yy] || new Array(366).fill(null))[Math.min(365, doy(d))] = v; });
    const histYears = Object.keys(byYear).map(Number).filter(yy => yy < y - 1).sort();
    const band = (fn) => lbl.map((_, i) => { const v = histYears.map(yy => byYear[yy][i]).filter(x => x != null); return v.length ? Math.round(fn(v) * 10) / 10 : null; });
    const r1 = histYears[0] + '–' + histYears[histYears.length - 1];
    const ds = [
      { label: r1 + ' range', data: band(v => Math.max(...v)), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(122,147,171,.18)', spanGaps: true },
      { label: '_min', data: band(v => Math.min(...v)), borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true },
      { label: r1 + ' mean', data: band(v => v.reduce((a, b) => a + b, 0) / v.length), borderColor: 'rgba(184,201,217,.7)', borderDash: [5, 4], borderWidth: 1.3, pointRadius: 0, fill: false, spanGaps: true },
      { label: String(y - 1), data: byYear[y - 1] || [], borderColor: '#7FC8F8', borderWidth: 1.5, pointRadius: 0, fill: false, spanGaps: true },
      { label: String(y), data: byYear[y] || [], borderColor: '#14D3A9', borderWidth: 2.6, pointRadius: 0, fill: false, spanGaps: true },
    ];
    _fuelChart(cid, { type: 'line', data: { labels: lbl, datasets: ds }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0, callback: (v, i) => lbl[i] },
        grid: { color: c => lbl[c.index] ? 'rgba(26,45,63,.5)' : 'transparent', drawTicks: false } }), y: _fuelAxis('% full', { min: 0, max: 100 }) },
      plugins: { legend: _muLegend() } }) }, 'gas-storage-years');
    const last = pts[pts.length - 1], ly = pts.filter(([d]) => d.startsWith(String(y - 1)) && d.slice(5) <= last[0].slice(5)).slice(-1)[0];
    return { sub: `${last[1].toFixed(1)} % ${_muT('au', 'on')} ${last[0]}` + (ly ? ` · ${(last[1] - ly[1] >= 0 ? '+' : '')}${(last[1] - ly[1]).toFixed(1)} pts vs ${y - 1}` : '') };
  },
});

// ── 4. demand: consumption vs normal (RTE) ──
_muReg({
  id: 'fr-load-normal', title: 'France consumption vs normal', category: 'france', page: 'load', pageCanvas: 'load-normal', source: 'RTE éCO2mix',
  desc: 'French consumption over the last 60 days (daily and 7-day average) against the 2016–2025 average of the same calendar days (GWh/day).',
  async draw(cid) {
    const j = await _muGet('frd', 'history/rte/fr_daily.json');
    if (!j || !j.rows) { noDataMsg(cid, 'RTE history not available', ''); return null; }
    const norm = {}; j.rows.forEach(r => { const yy = +r.d.slice(0, 4); if (yy < 2016 || yy > 2025 || r.loadAvg == null) return; (norm[r.d.slice(5)] = norm[r.d.slice(5)] || []).push(r.loadAvg * 24 / 1000); });
    const rows = j.rows.filter(r => r.loadAvg != null).slice(-60);
    const nv = rows.map(r => { const k = r.d.slice(5); const a = norm[k]; return a ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null; });
    const act = rows.map(r => Math.round(r.loadAvg * 24 / 1000));
    // weekly cycle: compare the 7-day average with the (calendar-day) normal
    const all = j.rows.filter(r => r.loadAvg != null), off = all.length - rows.length;
    const roll7 = rows.map((_, i) => { const w = all.slice(off + i - 6, off + i + 1).map(r => r.loadAvg * 24 / 1000); return w.length === 7 ? Math.round(_muMean(w)) : null; });
    _fuelChart(cid, { type: 'line', data: { labels: rows.map(r => _muDay(r.d)), datasets: [
      { label: 'Normal 2016–2025', data: nv, borderColor: 'rgba(184,201,217,.75)', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0, fill: false },
      { label: 'Consumption, 7-day average', data: roll7, borderColor: '#7FC8F8', borderWidth: 2.2, pointRadius: 0, tension: .2, fill: { target: 0, above: 'rgba(238,155,0,.20)', below: 'rgba(20,211,169,.20)' } },
      { label: 'Daily consumption', data: act, borderColor: 'rgba(127,200,248,.35)', borderWidth: 1, pointRadius: 0, tension: .2, fill: false },
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 10, maxRotation: 0 } }), y: _fuelAxis('GWh/day') }, plugins: { legend: _muLegend() } }) }, 'consumption-vs-normal');
    const a7 = roll7[roll7.length - 1], n7 = _muMean(nv.slice(-7));
    const dv = n7 ? ((a7 / n7 - 1) * 100 >= 0 ? '+' : '') + ((a7 / n7 - 1) * 100).toFixed(1) + ' %' : '';
    return { sub: _muT(`7 derniers jours : ${a7 ? a7.toFixed(0) : '–'} GWh/jour, ${dv} vs normale`, `Last 7 days ${a7 ? a7.toFixed(0) : '–'} GWh/day, ${dv} vs normal`) };
  },
});

// ── forward contracts, contract by contract (power: fr_market_contracts.json, TTF: ttf_contracts.json) ──
async function _muContracts(cc) {
  if (cc === 'TTF') { const j = await _muGet('ttfc', 'history/ttf_contracts.json'); return j && j.TTF; }
  // one country's file when it exists (≈1 MB), the four countries otherwise
  const one = await _muGet('contracts-' + cc, 'history/fr_market_contracts_' + cc + '.json'); if (one && one[cc]) return one[cc];
  const C = await _muGet('contracts', 'history/fr_market_contracts.json'); return C && C[cc];
}
const _MU_KIND = { month: 0, quarter: 1, year: 2, season: 3 };   // seasons last in tables and legends
// the liquid products: delivery not started, quoted in the last 7 days; base or peak; nearest first within each type
// set 'liquid': the exchange's standard strip only (3 months, 3 quarters, 2 seasons, 3 calendar years), as traded on EEX / ICE Endex
const _MU_STRIP = { month: 3, quarter: 3, season: 2, year: 3 };
function _muLiquid(all, kinds, peak, set, cap) {
  const strip = Object.assign({}, _MU_STRIP, cap || {});
  const today = _muToday(), fresh = _muAdd(today, -7), isPeak = (k, c) => /peak/i.test(k + ' ' + (c.marketName || ''));
  return Object.entries(all || {}).filter(([k, c]) => c && c.points && (!kinds || kinds.includes(c.kind)) && (c.deliveryStart || '') > today && isPeak(k, c) === !!peak
      && Object.keys(c.points).some(d => d >= fresh))
    .sort((a, b) => _MU_KIND[a[1].kind] - _MU_KIND[b[1].kind] || (a[1].deliveryStart < b[1].deliveryStart ? -1 : 1))
    .filter(function ([, c]) { if (set !== 'liquid') return true; this[c.kind] = (this[c.kind] || 0) + 1; return this[c.kind] <= strip[c.kind]; }, {});
}
const _muCLabel = (k, c) => (c.marketName || k).replace(/^(FR|GE|DE|NL|UK|TTF)\s+/i, '').replace(/\s+(base|peak)$/i, '').replace(/\s*\(.*\)$/, '');
// last settlement, change vs the previous one and vs a week before, from a contract's own history
function _muCStats(c) {
  const ks = Object.keys(c.points).sort(), d = ks[ks.length - 1], v = c.points[d], p1 = ks.length > 1 ? c.points[ks[ks.length - 2]] : null;
  const wk = _muAdd(d, -7), kw = ks.filter(x => x <= wk).pop(), pw = kw ? c.points[kw] : null;
  return { d, v, d1: p1 != null ? v - p1 : null, p1: p1 ? (v / p1 - 1) * 100 : null, w1: pw != null ? v - pw : null, pw: pw ? (v / pw - 1) * 100 : null };
}
function _muCTable(rows, unit, note) {
  const chg = (v, q) => v == null ? '<td>–</td>' : `<td class="${v > 0 ? 'mu-up' : v < 0 ? 'mu-dn' : ''}">${v > 0 ? '+' : ''}${v.toFixed(2)} <span class="mu-pct">${q > 0 ? '+' : ''}${q.toFixed(1)} %</span></td>`;
  const KN = { month: 'Month', quarter: 'Quarter', season: 'Season', year: 'Year' };
  const last = rows.reduce((a, r) => r.s.d > a ? r.s.d : a, '');
  return `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Product</th><th>${unit}</th><th>vs D-1</th><th>vs W-1</th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr${i && rows[i - 1].kind !== r.kind ? ' class="mu-sep"' : ''}><td style="text-align:left">${r.label} <span class="mu-kind">${KN[r.kind]}</span></td><td><b>${r.s.v.toFixed(2)}</b></td>${chg(r.s.d1, r.s.p1)}${chg(r.s.w1, r.s.pw)}</tr>`).join('') +
    `</tbody></table></div><div class="fuel-note">${rows.length} products · settlements of ${last}. ${note || ''}A rise is shown red (cost up for a buyer).</div>`;
}
const _muCRows = (all, kinds, peak, set, cap) => _muLiquid(all, kinds, peak, set, cap).map(([k, c]) => ({ label: _muCLabel(k, c), kind: c.kind, s: _muCStats(c) }));
// the chart: every liquid product of the chosen types over the window
function _muCChart(cid, all, p, unit, tag) {
  const kinds = String(p.kinds || 'year,season,quarter,month').split(','), today = _muToday(), peak = p.load === 'peak';
  const from = _muAdd(today, -({ '3M': 92, '6M': 183, '1Y': 366, '3Y': 1096, all: 20000 }[p.win] || 92));
  // p.front: one front month and one front quarter next to the calendar years (Today)
  const pick = _muLiquid(all, kinds, peak, p.set || 'liquid', p.front ? { month: 1, quarter: 1 } : null).filter(([, c]) => Object.keys(c.points).some(d => d >= from));
  if (!pick.length) { noDataMsg(cid, 'No contract of these types quoted in this window', ''); return null; }
  const dates = [...new Set(pick.flatMap(([, c]) => Object.keys(c.points).filter(d => d >= from)))].sort();
  const PAL = { year: ['#14D3A9', '#7FC8F8', '#A87DC4', '#FBBF24', '#C4A57B', '#ED6965', '#34D399', '#94A3B8'], season: ['#F59E0B', '#60A5FA', '#F472B6', '#A3E635', '#FB7185', '#38BDF8'],
    quarter: ['#22D3EE', '#FB923C', '#C084FC', '#4ADE80', '#F87171', '#FACC15', '#818CF8', '#2DD4BF'], month: ['#E6EDF3', '#93C5FD', '#FDA4AF', '#86EFAC', '#FCD34D', '#C4B5FD', '#67E8F9', '#FDBA74', '#F9A8D4', '#BEF264', '#A5B4FC', '#99F6E4'] };
  const n = {};
  const ds = pick.map(([k, c]) => { const i = (n[c.kind] = (n[c.kind] || 0) + 1) - 1;
    return _fuelLineDs(_muCLabel(k, c), dates.map(d => c.points[d] != null ? c.points[d] : null), PAL[c.kind][i % PAL[c.kind].length],
      { borderWidth: c.kind === 'year' ? 2.2 : 1.5, borderDash: c.kind === 'month' ? [3, 3] : c.kind === 'quarter' ? [6, 3] : c.kind === 'season' ? [10, 4] : [], spanGaps: true }); });
  _fuelChart(cid, { type: 'line', data: { labels: dates, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis(unit) }, plugins: { legend: _muLegend() } }) }, tag);
  const y0 = pick.find(([, c]) => c.kind === 'year') || pick[0], pts = y0[1].points, ks = Object.keys(pts).filter(d => d >= from).sort();
  const last = pts[ks[ks.length - 1]], first = pts[ks[0]];
  const nf = v => _muT(v.toFixed(2).replace('.', ','), v.toFixed(2)), dv = last - first, liq = (p.set || 'liquid') === 'liquid';
  return { sub: _muT(`${peak ? 'Pointe' : 'Base'} · ${pick.length} contrats ${liq ? 'liquides' : 'cotés'} · ${_muCLabel(y0[0], y0[1])} : ${nf(last)} ${unit} (${dv >= 0 ? '+' : '−'}${nf(Math.abs(dv))} sur ${p.win.replace('M', ' mois').replace('Y', ' an')})`,
    `${peak ? 'Peakload' : 'Baseload'} · ${pick.length} ${liq ? 'liquid' : 'quoted'} contracts · ${_muCLabel(y0[0], y0[1])}: ${nf(last)} ${unit} (${dv >= 0 ? '+' : '−'}${nf(Math.abs(dv))} over ${p.win})`) };
}

// ── 5. prices ──
_muReg({
  id: 'fr-cal-history', title: 'Forward contracts', category: 'forwards', page: 'prices', pageCanvas: 'cal-history', source: 'Market data',
  desc: 'Daily settlements of every liquid forward contract of a market (quoted in the last 7 days, still to deliver): months, quarters, seasons and calendar years, each type shown or hidden. UK in GBP.',
  titleFn: p => (MU_FWD.options.find(o => o[0] === p.country) || ['', 'France'])[1] + ' · forward contracts',
  params: [MU_FWD, { key: 'win', label: 'Window', options: [['3M', '3 months'], ['6M', '6 months'], ['1Y', '1 year'], ['3Y', '3 years'], ['all', 'All']] }, { key: 'set', label: 'Products', options: [['liquid', 'Liquid (exchange strip)'], ['all', 'All quoted']] },
    { key: 'load', label: 'Load', options: [['base', 'Baseload'], ['peak', 'Peakload']] },
    { key: 'kinds', label: 'Products', options: [['year', 'Calendar years'], ['year,season', 'Years and seasons'], ['year,season,quarter', 'Years, seasons, quarters'], ['year,season,quarter,month', 'All products']] }],
  defaults: { win: '3M', country: 'FR', kinds: 'year,season,quarter,month', load: 'base', set: 'liquid' },
  async draw(cid, p) {
    const cc = p.country || 'FR', all = await _muContracts(cc);
    if (!all) { noDataMsg(cid, 'Forward history not available', ''); return null; }
    return _muCChart(cid, all, p, cc === 'UK' ? '£/MWh' : '€/MWh', 'forward-contracts-' + cc);
  },
});

_muReg({
  id: 'fr-cal-drivers', title: 'Cal+1 and its drivers', category: 'forwards', page: 'prices', pageCanvas: 'cal-drivers', source: 'Market data',
  desc: 'A market’s Cal+1 baseload against its drivers: TTF gas of the same calendar year, EUA carbon, API2 coal Cal+1 and Brent oil, indexed to 100 at the start of the window.',
  titleFn: p => 'Cal+1 ' + (MU_FWD.options.find(o => o[0] === p.country) || ['', 'France'])[1] + ' and its drivers',
  params: [MU_FWD, { key: 'win', label: 'Window', options: [['3M', '3 months'], ['6M', '6 months'], ['1Y', '1 year'], ['3Y', '3 years']] }], defaults: { win: '6M', country: 'FR' },
  async draw(cid, p) {
    const [c, cs] = await Promise.all([_muGet('chain', 'history/fr_market_calchain.json'), _muGet('cs', 'history/commodities_series.json')]);
    const cc = p.country || 'FR', yrs = c && c[cc] && c[cc].years, ser = cs && cs.series;
    if (!yrs || !ser) { noDataMsg(cid, 'Data not available', ''); return null; }
    const from = _muAdd(_muToday(), -({ '3M': 92, '6M': 183, '1Y': 366, '3Y': 1096 }[p.win] || 183));
    const k = Object.keys(yrs).sort()[0];
    const cal = new Map(yrs[k].dates.map((d, i) => [d, yrs[k].values[i]]));
    const pts = key => new Map(((ser[key] || {}).points || []).filter(([d]) => d >= from));
    const eua = pts('eua'), coal = pts('coal'), oil = pts('brent');
    const com = await _muGet('cs', 'history/commodities_series.json'), ty = com && com.calYears && com.calYears.ttf && com.calYears.ttf[k];
    const ttfCal = ty ? new Map(ty.dates.map((d, i) => [d, ty.values[i]]).filter(([d]) => d >= from)) : null;
    const dates = [...cal.keys()].filter(d => d >= from).sort();
    const idx = (m) => { const b = dates.map(d => m.get(d)).find(v => v != null); return dates.map(d => m.has(d) && b ? Math.round(m.get(d) / b * 1000) / 10 : null); };
    _fuelChart(cid, { type: 'line', data: { labels: dates, datasets: [
      _fuelLineDs('Cal ' + k + ' ' + cc, idx(cal), '#14D3A9', { borderWidth: 2.4, spanGaps: true }),
      ...(ttfCal ? [_fuelLineDs('TTF Cal ' + k, idx(ttfCal), '#C4A57B', { borderWidth: 1.8, spanGaps: true })] : []),
      _fuelLineDs('EUA', idx(eua), '#A87DC4', { borderWidth: 1.5, spanGaps: true }),
      _fuelLineDs('Coal API2 Cal+1', idx(coal), '#94A3B8', { borderWidth: 1.4, spanGaps: true }),
      _fuelLineDs('Brent', idx(oil), '#E6EDF3', { borderWidth: 1.2, borderDash: [4, 3], spanGaps: true }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('index, start = 100') }, plugins: { legend: _muLegend() } }) }, 'cal-drivers');
    return { sub: 'Indexed to 100 on ' + dates[0] };
  },
});

// ── TTF forwards ──
// Snapshot of the TTF strip (months, quarters, seasons, years) and the
// fixed delivery-year calendar contracts over their life (commodities.json).
function _muTtfRows(c) {
  return ((c && c.curves && c.curves.ttf) || []).filter(r => r.value != null).map(r => {
    const back = pct => pct == null ? null : r.value - r.value / (1 + pct / 100);
    return { label: r.label || r.contract, kind: /^M/.test(r.tenor) ? 'Month' : /^Q/.test(r.tenor) ? 'Quarter' : /^S/.test(r.tenor) ? 'Season' : 'Year', v: r.value, d1: back(r.varD1Pct), w1: back(r.varW1Pct), p1: r.varD1Pct, pw: r.varW1Pct, date: r.date };
  });
}
_muReg({
  id: 'ttf-fwd-table', kind: 'html', title: 'TTF forwards · table', category: 'forwards', page: 'euafwd', source: 'Market data', size: { w: 6, h: 6 },
  desc: 'Every liquid TTF gas forward product (months, quarters, seasons, calendar years quoted in the last 7 days): settlement, change vs the previous day and vs a week before.',
  params: [{ key: 'set', label: 'Products', options: [['liquid', 'Liquid (exchange strip)'], ['all', 'All quoted']] }], defaults: { set: 'liquid' },
  async html(host, p) {
    const all = await _muContracts('TTF'), rows = all ? _muCRows(all, p && p.seasons === 'no' ? ['month', 'quarter', 'year'] : null, false, (p && p.set) || 'liquid') : [];
    if (rows.length) { host.innerHTML = _muCTable(rows, '€/MWh'); return; }
    const snap = _muTtfRows(await _muGet('com', 'commodities.json'));   // contract history missing: the day's strip
    if (!snap.length) { host.innerHTML = '<div class="fuel-note">TTF forwards not available.</div>'; return; }
    host.innerHTML = _muCTable(snap.map(r => ({ label: r.label, kind: r.kind.toLowerCase(), s: { d: r.date, v: r.v, d1: r.d1, p1: r.p1, w1: r.w1, pw: r.pw } })), '€/MWh');
  },
});
// ── Power forwards, same table as the TTF one: the strip of a market (months, quarters, seasons, years, base) ──
_muReg({
  id: 'power-fwd-table', kind: 'html', title: 'Power forwards · table', category: 'forwards', page: 'prices', source: 'Market data', size: { w: 6, h: 8 },
  desc: 'Every liquid power forward product of a market (baseload months, quarters, seasons, calendar years quoted in the last 7 days): settlement, change vs the previous day and vs a week before.',
  params: [MU_FWD, { key: 'set', label: 'Products', options: [['liquid', 'Liquid (exchange strip)'], ['all', 'All quoted']] }], defaults: { country: 'FR', set: 'liquid' },
  titleFn: p => (MU_FWD.options.find(o => o[0] === p.country) || ['', 'France'])[1] + ' power forwards · table',
  async html(host, p) {
    const cc = (p && p.country) || 'FR', all = await _muContracts(cc), rows = all ? _muCRows(all, p && p.seasons === 'no' ? ['month', 'quarter', 'year'] : null, false, (p && p.set) || 'liquid') : [];
    if (!rows.length) { host.innerHTML = '<div class="fuel-note">Power forwards not available for this market.</div>'; return; }
    host.innerHTML = _muCTable(rows, cc === 'UK' ? '£/MWh' : '€/MWh', 'Baseload. ');
  },
});
// on Prices › Forward: the table drawn when it comes into view, redrawn when the market changes
(function () {
  const go = () => { const h = document.getElementById('pf-fwd-host'), sel = document.getElementById('pf-fwd-mkt'); if (!h || !sel || !window.PKW) return;
    const st = document.getElementById('pf-fwd-set');
    const draw = () => PKW.get('power-fwd-table').html(h, { country: sel.value, set: st ? st.value : 'liquid' });
    sel.addEventListener('change', draw); if (st) st.addEventListener('change', draw);
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); draw(); } }, { rootMargin: '200px' }); io.observe(h); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
_muReg({
  id: 'ttf-cal-history', title: 'TTF forward contracts', category: 'forwards', page: 'euafwd', pageCanvas: 'ttf-cal', source: 'Market data',
  desc: 'Daily settlements of every liquid TTF gas forward contract (quoted in the last 7 days, still to deliver): months, quarters, seasons and calendar years, each type shown or hidden.',
  params: [{ key: 'win', label: 'Window', options: [['3M', '3 months'], ['6M', '6 months'], ['1Y', '1 year'], ['3Y', '3 years']] }, { key: 'set', label: 'Products', options: [['liquid', 'Liquid (exchange strip)'], ['all', 'All quoted']] },
    { key: 'kinds', label: 'Products', options: [['year', 'Calendar years'], ['year,season', 'Years and seasons'], ['year,season,quarter', 'Years, seasons, quarters'], ['year,season,quarter,month', 'All products']] }],
  defaults: { win: '6M', kinds: 'year,season,quarter,month', set: 'liquid' },
  async draw(cid, p) {
    const all = await _muContracts('TTF');
    if (!all) { noDataMsg(cid, 'TTF contract history not available', ''); return null; }
    const r = _muCChart(cid, all, p, '€/MWh', 'ttf-forward-contracts');
    if (r) r.sub = r.sub.replace(/^Baseload · /, '');
    return r;
  },
});

window.PKTtf = {
  render() {
    const w = (document.getElementById('ttf-cal-win') || {}).value || '6M';
    const kinds = [...document.querySelectorAll('#ttf-kinds input:checked')].map(x => x.value).join(',') || 'year';
    const set = (document.getElementById('ttf-set') || {}).value || 'liquid';
    PKW.draw('ttf-cal-history', 'ttf-cal', { win: w, kinds, set }).then(r => { const e = document.getElementById('ttf-cal-sub'); if (e && r && r.sub) e.textContent = r.sub; });
    const host = document.getElementById('ttf-fwd-host'); if (host) PKW.get('ttf-fwd-table').html(host, { set });
  },
};
window.addEventListener('load', () => setTimeout(() => {
  const sel = document.getElementById('ttf-cal-win'); if (sel) sel.addEventListener('change', () => PKTtf.render());
  let done = false;
  PK.onPage('euafwd', () => { if (!done) { done = true; setTimeout(() => PKTtf.render(), 200); } });
}, 0));

// Daily baseload of a zone: summary.json (long history, 5 zones), monthly
// files (every zone since 2025) and the daily files of the last days.
async function _muZoneDaily(zone) {
  const rows = new Map();
  const s = await (zone === 'FR' && window.pkSummaryFR ? window.pkSummaryFR() : window.pkSummary());   // France: the light file (0.4 MB, not 19)
  ((s && s.zones && s.zones[zone]) || []).forEach(r => { if (r.avg != null) rows.set(r.d, r.avg); });
  const t = _muToday();
  const months = []; for (let i = 13; i >= 0; i--) { const d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1 - i, 1)); months.push(d.toISOString().slice(0, 7)); }
  const files = await Promise.all(months.map(m => _muGet('m' + m, 'history/monthly/' + m + '.json')));
  files.forEach(f => ((f && f.zones && f.zones[zone]) || []).forEach(r => { if (r.avg != null && !rows.has(r.d)) rows.set(r.d, r.avg); }));
  for (let i = -10; i <= 1; i++) {
    const d = _muAdd(t, i); if (rows.has(d)) continue;
    const j = await _muGet('d' + d, 'history/daily/' + d + '.json');
    const h = j && j.zones && j.zones[zone] && j.zones[zone].hourly;
    const v = Array.isArray(h) ? h.filter(x => x != null) : [];
    if (v.length && !v.every(x => x === 0)) rows.set(d, Math.round(_muMean(v) * 100) / 100);
  }
  return [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

_muReg({
  id: 'fr-spot-monthly', title: 'Spot by month · 12 months', category: 'prices', page: 'prices', pageCanvas: 'spt-monthly', source: 'ENTSO-E',
  desc: 'Monthly average day-ahead baseload of a zone over the last 12 months against their 12-month mean; bars above the mean in orange.',
  params: [MU_ZONE], defaults: { zone: 'FR' }, titleFn: p => _muZoneName(p.zone) + ' · spot by month, 12 months',
  async draw(cid, p) {
    const rows = await _muZoneDaily(p.zone || 'FR');
    if (!rows.length) { noDataMsg(cid, 'Price history not available', ''); return null; }
    const by = new Map(); rows.forEach(([d, v]) => { if (v == null) return; const k = d.slice(0, 7); (by.get(k) || by.set(k, []).get(k)).push(v); });
    const months = [...by.keys()].sort().slice(-13);
    const avg = months.map(k => Math.round(_muMean(by.get(k)) * 10) / 10);
    const mean = _muMean(avg.slice(0, -1).slice(-12));
    _fuelChart(cid, { type: 'bar', data: { labels: months.map(k => MU_MON[+k.slice(5) - 1] + ' ' + k.slice(2, 4)), datasets: [
      { type: 'bar', label: 'Monthly average', data: avg, backgroundColor: avg.map(v => v > mean ? 'rgba(237,105,101,.75)' : 'rgba(20,211,169,.75)'), borderRadius: 3, borderWidth: 0, order: 2 },
      { type: 'line', label: '12-month mean ' + mean.toFixed(1), data: avg.map(() => Math.round(mean * 10) / 10), borderColor: '#B8C9D9', borderDash: [4, 3], borderWidth: 1.4, pointRadius: 0, order: 1 },
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh', { beginAtZero: true }) }, plugins: { legend: _muLegend() } }) }, 'spot-monthly-' + (p.zone || 'FR'));
    const cur = avg[avg.length - 1];
    const rank = avg.slice(0, -1).filter(v => v < cur).length / Math.max(1, avg.length - 1);
    return { sub: `${MU_MON[+months[months.length - 1].slice(5) - 1]} ${months[months.length - 1].slice(0, 4)} so far: ${cur.toFixed(1)} €/MWh · ${rank > .75 ? 'high' : rank < .25 ? 'low' : 'average'} · ${cur - mean >= 0 ? '+' : ''}${(cur - mean).toFixed(1)} vs 12-month mean` };
  },
});

_muReg({
  id: 'fr-spot-30d', title: 'Spot · last 30 days', category: 'prices', page: 'prices', pageCanvas: 'spt-30d', source: 'ENTSO-E',
  desc: 'Daily day-ahead baseload of a zone over the last 30 delivery days with the 30-day mean.',
  params: [MU_ZONE], defaults: { zone: 'FR' }, titleFn: p => _muZoneName(p.zone) + ' · spot, last 30 days',
  async draw(cid, p) {
    const rows = (await _muZoneDaily(p.zone || 'FR')).slice(-30);
    if (!rows.length) { noDataMsg(cid, 'Price history not available', ''); return null; }
    const v = rows.map(r => r[1]), mean = _muMean(v);
    _fuelChart(cid, { type: 'line', data: { labels: rows.map(r => _muDay(r[0])), datasets: [
      { label: 'Daily baseload', data: v, borderColor: '#14D3A9', backgroundColor: 'rgba(20,211,169,.10)', fill: true, borderWidth: 2, pointRadius: 2.5, tension: .35 },
      { label: '30-day mean ' + mean.toFixed(1), data: v.map(() => Math.round(mean * 10) / 10), borderColor: 'rgba(184,201,217,.7)', borderDash: [4, 3], borderWidth: 1.2, pointRadius: 0 },
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 10, maxRotation: 0 } }), y: _fuelAxis('€/MWh') }, plugins: { legend: _muLegend() } }) }, 'spot-30d-' + (p.zone || 'FR'));
    const last = rows[rows.length - 1];
    return { sub: `Last session ${_muDay(last[0])}: ${last[1].toFixed(1)} €/MWh · 30-day mean ${mean.toFixed(1)} · range ${Math.min(...v).toFixed(0)} → ${Math.max(...v).toFixed(0)}` };
  },
});

// Day card: average, change, cheapest / most expensive hour and 3-hour windows, curve with bands.
// Day charts of one zone shown together (Today's three days, a dashboard) share one price axis, so they read as a continuous run
function _muSyncDays(Z) {
  if (!window.Chart) return;
  const all = [...document.querySelectorAll('.mu-day-c canvas')].map(c => Chart.getChart(c)).filter(ch => ch && ch.$muZone === Z && ch.canvas.isConnected);
  if (all.length < 2) return;
  const vals = all.flatMap(ch => ch.data.datasets[0].data.filter(v => v != null));
  let lo = Math.min(0, ...vals), hi = Math.max(...vals);
  const step = hi - lo > 200 ? 50 : hi - lo > 80 ? 20 : 10;
  lo = Math.floor(lo / step) * step; hi = Math.ceil((hi + (hi - lo) * 0.2) / step) * step;   // room above the curve for the band labels
  all.forEach(ch => { ch.options.scales.y.min = lo; ch.options.scales.y.max = hi; ch.$pkFitAlone = ['y']; ch.update('none'); });
}

if (window.PKW) PKW.register({
  id: 'fr-spot-day', kind: 'html', title: 'Spot · day profile', category: 'prices', page: 'prices', source: 'ENTSO-E', size: { w: 6, h: 7 },
  desc: 'One delivery day of day-ahead prices of a zone: average and change, cheapest and most expensive hour, cheapest and dearest 3-hour windows.',
  params: [MU_ZONE, { key: 'day', label: 'Day', options: [['latest', 'Latest delivery day'], ['previous', 'Day before'], ['yesterday', 'Yesterday'], ['today', 'Today'], ['tomorrow', 'Tomorrow (forecast until published)']] }], defaults: { zone: 'FR', day: 'latest' },
  titleFn: p => _muZoneName(p.zone || 'FR') + ' spot · ' + ({ previous: 'previous day', yesterday: 'yesterday', today: 'today', tomorrow: 'tomorrow' }[p.day] || 'latest day'),
  async html(host, p) {
    const t = _muToday();
    const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
    let d = null, fcast = false;
    const Z = p.zone || 'FR';
    if (p.day === 'yesterday' || p.day === 'today' || p.day === 'tomorrow') d = { yesterday: _muAdd(t, -1), today: t, tomorrow: _muAdd(t, 1) }[p.day];
    else {
      for (const c of [_muAdd(t, 1), t, _muAdd(t, -1)]) { const j = await _muGet('d' + c, 'history/daily/' + c + '.json'); if (j && j.zones && j.zones[Z] && j.zones[Z].hourly) { d = c; break; } }
      if (!d) { host.innerHTML = '<div class="fuel-note">No prices for ' + Z + '.</div>'; return; }
      if (p.day === 'previous') d = _muAdd(d, -1);
    }
    const [J, P] = await Promise.all([_muGet('d' + d, 'history/daily/' + d + '.json'), _muGet('d' + _muAdd(d, -1), 'history/daily/' + _muAdd(d, -1) + '.json')]);
    let q = J && J.zones && J.zones[Z] && J.zones[Z].hourly; const qp = P && P.zones && P.zones[Z] && P.zones[Z].hourly;
    // tomorrow before the auction (about 13:00): France only, the PowerKlock forecast, said as such
    if (!q && Z === 'FR' && p.day === 'tomorrow') { const nf = await _muGet('negf', 'neg_forecast.json'); const f = nf && nf.days && nf.days[d]; if (f && f.price && f.price.filter(v => v != null).length >= 20) { q = f.price.slice(0, 24); fcast = true; } }
    if (!q) { const _dd = o => new Date(d + 'T12:00:00Z').toLocaleDateString(T('fr-FR', 'en-GB'), Object.assign({ timeZone: 'UTC' }, o)); host.innerHTML = `<div class="mu-day mu-day-grey"><div class="mu-day-h"><div><div class="mu-day-t">${_muZoneName(Z)} · <span class="mu-day-dl">${_dd({ weekday: 'long', day: 'numeric', month: 'long' })}</span><span class="mu-day-ds">${_dd({ weekday: 'short', day: 'numeric', month: 'short' })}</span></div></div></div><div class="fuel-note mu-day-why" style="padding:26px 6px;text-align:center"></div></div>`;
      // three different cases, three messages: not published yet (and how the forecast is doing), late, or a failed load
      const why = host.querySelector('.mu-day-why'), now = new Date(), parisH = +now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Paris' });
      if (d > t) {
        const nf = Z === 'FR' ? await _muGet('negf', 'neg_forecast.json') : null, upd = nf && nf.updated ? new Date(nf.updated) : null;
        const when = upd ? upd.toLocaleString(T('fr-FR', 'en-GB'), { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : null;
        const fc = Z !== 'FR' ? '' : parisH >= 10 ? T(`<br>Prévision PowerKlock en retard aujourd’hui${when ? ' (dernière mise à jour ' + when + ')' : ''}.`, `<br>PowerKlock forecast late today${when ? ' (last update ' + when + ')' : ''}.`)
          : T('<br>La prévision PowerKlock arrive dans la matinée.', '<br>The PowerKlock forecast comes in the morning.');
        why.innerHTML = parisH < 13 ? T('Pas encore publié : prix connu vers 13 h.', 'Not published yet: price known around 13:00.') + fc
          : T('Prix en cours de publication (attendu vers 13 h, en retard).', 'Price being published (due around 13:00, late).') + fc;
      } else {
        why.innerHTML = T('Chargement impossible.', 'Could not load.') + ` <button type="button" class="pk-btn-ghost mu-day-retry" style="margin-left:6px">${T('Réessayer', 'Retry')}</button>`;
        why.querySelector('.mu-day-retry').addEventListener('click', () => { delete MU.cache['d' + d]; PKW.get('fr-spot-day').html(host, p); });
      }
      return; }
    const per = q.length / 24, h = Array.from({ length: 24 }, (_, i) => _muMean(q.slice(i * per, (i + 1) * per)));
    // the day's average as published (a 25-hour day counts its repeated hour, which the 96-slot series leaves out)
    const zd = !fcast && J && J.zones && J.zones[Z], zp = P && P.zones && P.zones[Z];
    const avg = zd && zd.avg != null ? zd.avg : _muMean(q), avgP = zp && zp.avg != null ? zp.avg : qp ? _muMean(qp) : null, chg = avgP ? (avg / avgP - 1) * 100 : null;
    let lo = 0, hi = 0; h.forEach((v, i) => { if (v < h[lo]) lo = i; if (v > h[hi]) hi = i; });
    const win = sign => { let b = 0, bv = null; for (let i = 0; i <= 21; i++) { const m = (h[i] + h[i + 1] + h[i + 2]) / 3; if (bv == null || sign * m > sign * bv) { bv = m; b = i; } } return b; };
    const wl = win(-1), wh = win(1);
    const cid = 'mu-day-' + Math.random().toString(36).slice(2, 8);
    // the two clock-change days: 25 hours (last Sunday of October) and 23 (last Sunday of March)
    const dd = new Date(d + 'T12:00:00Z'), lastSun = dd.getUTCDay() === 0 && dd.getUTCDate() > 24, dst = lastSun && dd.getUTCMonth() === 9 ? 25 : lastSun && dd.getUTCMonth() === 2 ? 23 : 0;
    const dstNote = dst ? `<div class="fuel-note mu-day-dst">${dst === 25 ? T('Journée de 25 h (passage à l’heure d’hiver) : l’heure 2 h–3 h, jouée deux fois, compte dans la moyenne mais n’est tracée qu’une fois.', '25-hour day (end of summer time): the hour 2–3 am, played twice, counts in the average but is drawn once.') : T('Journée de 23 h (passage à l’heure d’été) : il n’y a pas d’heure 2 h–3 h.', '23-hour day (start of summer time): there is no 2–3 am hour.')}</div>` : '';
    const dl = new Date(d + 'T12:00:00Z').toLocaleDateString(T('fr-FR', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }), n2 = v => T(v.toFixed(2).replace('.', ','), v.toFixed(2));
    host.innerHTML = `<div class="mu-day${fcast ? ' mu-day-grey' : ''}"><div class="mu-day-h"><div><div class="mu-day-t">${_muZoneName(Z)} · <span class="mu-day-dl">${dl}</span><span class="mu-day-ds">${new Date(d + 'T12:00:00Z').toLocaleDateString(T('fr-FR', 'en-GB'), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>${fcast ? ' · <span class="mu-day-fc">' + T('prévision', 'forecast') + '</span>' : ''}</div><div class="mu-day-avg">${n2(avg)}<small> €/MWh</small></div></div>
      ${chg == null ? '' : `<span class="mu-day-chg ${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '▲' : '▼'} ${chg >= 0 ? '+' : ''}${T(chg.toFixed(1).replace('.', ','), chg.toFixed(1))} %<span class="mu-day-vs"> ${T('vs veille', 'vs previous day')}</span></span>`}</div>
      <div class="mu-day-k"><div class="lo"><b>${T('Min', 'Min')}</b> ${n2(h[lo])} € ${T('à', 'at')} ${lo} h</div>
      <div class="hi"><b>${T('Max', 'Max')}</b> ${n2(h[hi])} € ${T('à', 'at')} ${hi} h</div></div>
      <div class="mu-day-c"><canvas id="${cid}"></canvas></div>${dstNote}</div>`;
    // the cheapest and the dearest 3 hours of the day, each band labelled with its start and end
    const bands = { id: 'muBands', beforeDatasetsDraw(ch) { const a = ch.chartArea, x = ch.scales.x, g = ch.ctx;
      [[wl, 'rgba(20,211,169,.12)', '#0E9F7E', T('MOINS CHER', 'CHEAPEST')], [wh, 'rgba(237,105,101,.12)', '#D64545', T('PLUS CHER', 'DEAREST')]].forEach(([s, c, tc, t]) => {
        const x0 = x.getPixelForValue(s), x1 = x.getPixelForValue(Math.min(23, s + 3)), hrs = s + ' h – ' + (s + 3) + ' h';
        g.save(); g.fillStyle = c; g.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        g.fillStyle = tc; g.font = '600 10px "IBM Plex Mono", monospace';
        const w = Math.max(g.measureText(t).width, g.measureText(hrs).width) / 2, tx = Math.min(a.right - w, Math.max(a.left + w, (x0 + x1) / 2));   // centred on the band, kept inside the chart
        g.textAlign = 'center';
        g.fillText(t, tx, a.top + 12); g.font = '10px "IBM Plex Mono", monospace'; g.fillText(hrs, tx, a.top + 24); g.restore(); });
      // the dotted line says what it is
      const yA = ch.scales.y.getPixelForValue(avg); if (yA > a.top + 30 && yA < a.bottom - 4) { g.save(); g.fillStyle = '#7FC8F8'; g.font = '10px "IBM Plex Mono", monospace'; g.textAlign = 'right'; g.fillText(T('moyenne ', 'average ') + n2(avg), a.right - 2, yA - 4); g.restore(); } } };
    const dayCh = new Chart(document.getElementById(cid), { type: 'line', data: { labels: h.map((_, i) => String(i).padStart(2, '0') + 'h'), datasets: [
      { label: fcast ? T('Prévision', 'Forecast') : T('Prix', 'Price'), data: h.map(v => Math.round(v * 100) / 100), borderColor: fcast ? '#8A9BAD' : '#14D3A9', borderDash: fcast ? [5, 4] : [], borderWidth: 2.2, tension: 0, fill: false,   // straight between hours: a smoothed curve invents values
        segment: { borderColor: c => (c.p0.parsed.y < 0 || c.p1.parsed.y < 0) ? '#ED6965' : undefined },   // below 0 €: the line turns red
        pointRadius: h.map((_, i) => i === lo || i === hi ? 5 : 0), pointBackgroundColor: h.map((_, i) => fcast ? '#8A9BAD' : i === lo ? '#14D3A9' : '#ED6965'), pointBorderColor: '#0a0e13' },
      { label: T('Moyenne', 'Average'), data: h.map(() => Math.round(avg * 100) / 100), borderColor: '#7FC8F8', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0 },
    ] }, plugins: [bands], options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: '#7A93AB', font: { size: 11 }, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,.04)' }, title: { display: true, text: T('heure (Paris)', 'hour (Paris)'), color: '#7A93AB', font: { size: 11 } } }, y: { ticks: { color: '#7A93AB', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,.04)' }, title: { display: true, text: '€/MWh', color: '#7A93AB', font: { size: 11 } } } } } });
    dayCh.$muZone = Z; dayCh.canvas.dataset.fsTitle = _muZoneName(Z) + ' · ' + dl + (fcast ? ' · ' + T('prévision', 'forecast') : ''); _muSyncDays(Z);
  },
});

// Latest headlines (geopolitics / markets)
if (window.PKW) PKW.register({
  id: 'news-latest', kind: 'html', title: 'Energy news · latest', category: 'intel', page: 'news', source: 'News feeds', size: { w: 6, h: 6 },
  desc: 'Every energy-market headline of the last 7 days, newest first, filtered as you choose in the settings (⚙): what (market movers, geopolitics, regulation, deals, new capacity…), where (country) and from which source.',
  params: [
    { key: 'what', label: 'Articles', options: [['movers', 'Market movers'], ['all', 'All'], ['geopolitics', 'Geopolitics'], ['regulation', 'Regulation'], ['deal', 'Deals'], ['build', 'New capacity'], ['gas', 'Gas'], ['carbon', 'Carbon'], ['markets', 'Markets']] },
    { key: 'country', label: 'Country', options: [['', 'All countries'], ['FR', 'France'], ['EU', 'Europe / EU'], ['DE', 'Germany'], ['BE', 'Belgium'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['UK', 'United Kingdom']] },
    { key: 'source', label: 'Source', options: [['', 'All sources'], ['GreenUnivers', 'GreenUnivers'], ['CRE', 'CRE'], ['Pexapark', 'Pexapark'], ['AleaSoft', 'AleaSoft'], ['Connaissance des Énergies', 'Connaissance des Énergies'], ['Révolution Énergétique', 'Révolution Énergétique'], ['Le Monde · Énergies', 'Le Monde · Énergies'], ['UFE', 'UFE'], ['PV Tech', 'PV Tech'], ['pv magazine', 'pv magazine'], ['Energy-Storage.news', 'Energy-Storage.news'], ['Windpower Monthly', 'Windpower Monthly'], ['WindEurope', 'WindEurope'], ['World Nuclear News', 'World Nuclear News'], ['Carbon Pulse', 'Carbon Pulse'], ['Carbon Brief', 'Carbon Brief'], ['Energy Monitor', 'Energy Monitor'], ['GIE', 'GIE'], ['Clean Energy Wire', 'Clean Energy Wire'], ['Enerdata', 'Enerdata'], ['E-CUBE', 'E-CUBE']] }],
  defaults: { what: 'movers', country: '', source: '' },
  titleFn: p => 'Energy news · ' + ({ movers: 'market movers', all: 'latest', geopolitics: 'geopolitics', regulation: 'regulation', deal: 'deals', build: 'new capacity', gas: 'gas', carbon: 'carbon', markets: 'markets' }[p.what || 'movers']) + (p.country ? ' · ' + p.country : '') + (p.source ? ' · ' + p.source : ''),
  async html(host, p) {
    const j = await _muGet('news', 'news.json');
    const isFr = n => (n.tags || []).includes('fr') || (typeof _newsIsFr === 'function' && _newsIsFr(n));
    let list = ((j && j.items) || []).filter(n => (!p.country || (n.countries || []).includes(p.country) || (p.country === 'FR' && isFr(n))) && (!p.source || n.source === p.source));
    const what = p.what || 'movers';
    // every article of the last 7 days matching the filters, newest first (the card scrolls)
    list = list.filter(n => Date.now() - Date.parse(n.date) < 7 * 864e5);
    if (what === 'movers') list = list.filter(n => (n.impact || 0) >= 3);
    else if (what !== 'all') list = list.filter(n => (n.tags || []).includes(what));
    list.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const esc = PK.esc;   // js/pk-core.js
    host.innerHTML = list.length ? '<ul class="mu-news">' + list.map(n => `<li><a href="${/^https?:\/\//.test(n.link || '') ? esc(n.link) : '#'}" target="_blank" rel="noopener">${esc(n.title)}</a><span>${esc(n.source)}${(n.countries || []).length ? ' · ' + esc(n.countries.slice(0, 2).join(' · ')) : ''} · ${new Date(n.date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}</span></li>`).join('') + `</ul><div class="fuel-note">${list.length} article${list.length > 1 ? 's' : ''} over the last 7 days, newest first.</div>`
      : '<div class="fuel-note">No article for these filters: change them in the settings (⚙).</div>';
  },
});

(function () {
  const css = document.createElement('style');
  css.textContent = `
  .mu-day{display:flex;flex-direction:column;gap:10px;flex:1 1 auto;min-height:0}
  .mu-day-h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
  .mu-day-t{font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
  .mu-day-avg{font-family:'IBM Plex Mono',monospace;font-size:28px;margin-top:2px;color:var(--text)} .mu-day-avg small{font-size:11px;color:var(--text3)}
  .mu-day-chg{font-size:12px;padding:3px 8px;border-radius:999px;font-weight:600} .mu-day-chg.up{color:var(--down);background:var(--down-dim)} .mu-day-chg.down{color:var(--up);background:var(--up-dim)}
  .mu-day-k{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .mu-day-k>div{background:var(--bg3);border:1px solid var(--border);border-left:3px solid;border-radius:6px;padding:4px 9px;font-size:12px;color:var(--text2);display:flex;align-items:baseline;flex-wrap:wrap;gap:0 6px;white-space:nowrap}
  .mu-day-k .lo{border-left-color:var(--up)} .mu-day-k .hi{border-left-color:var(--down)}
  .mu-day-k b{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text)} .mu-day-k span{font-size:11px;color:var(--text3)}
  .mu-day-grey{opacity:.6;filter:grayscale(1)} .mu-day-grey .mu-day-fc{color:var(--text2)}
  .mu-day-c{position:relative;flex:1 1 auto;min-height:200px}
  .mu-news{list-style:none;margin:0;padding:0} .mu-news li{padding:7px 0;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:2px}
  .mu-news a{color:var(--text);font-size:12.5px;text-decoration:none} .mu-news a:hover{color:var(--accent)} .mu-news span{font-size:10.5px;color:var(--text3)}
  `;
  document.head.appendChild(css);
})();

// ── page hooks: Prices › Day-Ahead (spot trend), Prices › Forward (calendar
//    contracts), Load & Demand (consumption vs normal) ──
window.PKSpot = {
  draw() {
    const sel = document.getElementById('spt-zone'); if (!sel || !window.PKW) return;
    if (!sel.options.length) sel.innerHTML = MU_ZONE.options.map(([c, n]) => `<option value="${c}"${c === 'FR' ? ' selected' : ''}>${n}</option>`).join('');
    const z = sel.value || 'FR', sub = (id, r) => { const e = document.getElementById(id); if (e && r && r.sub) e.textContent = r.sub; };
    PKW.draw('fr-spot-30d', 'spt-30d', { zone: z }).then(r => sub('spt-30d-sub', r));
    const a = document.getElementById('spt-day-latest'), b = document.getElementById('spt-day-prev');
    if (a) PKW.get('fr-spot-day').html(a, { zone: z, day: 'latest' });
    if (b) PKW.get('fr-spot-day').html(b, { zone: z, day: 'previous' });
  },
  // spot by month: top of Prices › Day-Ahead › Historical, its own zone (France by default)
  drawMonthly() {
    const sel = document.getElementById('spt-m-zone'); if (!sel || !window.PKW) return;
    if (!sel.options.length) { const src = document.getElementById('spt-zone'); sel.innerHTML = src && src.options.length ? src.innerHTML : '<option value="FR">France</option>'; sel.value = 'FR'; }
    PKW.draw('fr-spot-monthly', 'spt-monthly', { zone: sel.value || 'FR' }).then(r => { const e = document.getElementById('spt-monthly-sub'); if (e && r && r.sub) e.textContent = r.sub; });
  },
  drawCal() {
    const sel = document.getElementById('cal-country'); if (!sel || !window.PKW) return;
    const c = sel.value || 'FR', sub = (id, r) => { const e = document.getElementById(id); if (e && r && r.sub) e.textContent = r.sub; };
    const W = window._muCalWin || (window._muCalWin = { h: '3M', d: '6M' });
    const kinds = [...document.querySelectorAll('#cal-kinds input:checked')].map(x => x.value).join(',') || 'year';
    const load = (document.getElementById('cal-load') || {}).value || 'base';
    const set = (document.getElementById('cal-set') || {}).value || 'liquid';
    const hist = () => PKW.draw('fr-cal-history', 'cal-history', { country: c, win: W.h, kinds, load, set }).then(r => sub('cal-history-sub', r));
    const drv = () => PKW.draw('fr-cal-drivers', 'cal-drivers', { country: c, win: W.d }).then(r => sub('cal-drivers-sub', r));
    hist(); drv();
    // period buttons in each card's header (the history goes back to 2022)
    PKW.periodButtons('cal-history', [['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['3Y', '3Y'], ['all', 'All']], W.h, v => { W.h = v; hist(); });
    PKW.periodButtons('cal-drivers', [['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['3Y', '3Y']], W.d, v => { W.d = v; drv(); });
  },
  outlook() {
    const sel = document.getElementById('wx-country');
    const cc = sel && MU_OUT_COUNTRY.options.some(o => o[0] === sel.value) ? sel.value : 'FR';
    const note = document.getElementById('wx-out-note');
    if (note) note.textContent = sel && cc !== sel.value ? 'No outlook for ' + sel.options[sel.selectedIndex].text + ': France shown.' : '';
    ['temp', 'wind', 'solar', 'precip'].forEach(k => PKW.draw('wx-outlook', 'wx-out-' + k, { country: cc, series: k }).then(r => { const e = document.getElementById('wx-out-' + k + '-sub'); if (e) e.textContent = r && r.sub ? r.sub : ''; }));
  },
  load() { if (window.PKW) PKW.draw('fr-load-normal', 'load-normal', {}).then(r => { const e = document.getElementById('load-normal-sub'); if (e && r && r.sub) e.textContent = r.sub; }); },
};
window.addEventListener('load', () => setTimeout(() => {
  const done = {};
  const once = (k, fn) => { if (!done[k]) { done[k] = true; fn(); } };
  if (typeof window.prSelectSubdomain === 'function') {
    const inner = window.prSelectSubdomain;
    window.prSelectSubdomain = function (d) {
      const r = inner.apply(this, arguments);
      if (d === 'da') once('da', () => setTimeout(() => { PKSpot.draw(); PKSpot.drawMonthly(); }, 300));
      if (d === 'forward') once('fwd', () => setTimeout(PKSpot.drawCal, 300));
      return r;
    };
  }
  PK.onPage('*', id => {
    if (id === 'load') once('load', () => setTimeout(PKSpot.load, 300));
    if (id === 'wxcities') once('wx', () => { setTimeout(PKSpot.outlook, 300); setTimeout(() => window.PKHydro && PKHydro.render(), 400); const sel = document.getElementById('wx-country'); if (sel) sel.addEventListener('change', () => PKSpot.outlook()); });
    if (id === 'prices') {   // the Day-Ahead sub-page can be the one open by default
      const da = document.querySelector('[data-subdomain-panel="da"].active');
      if (da) once('da', () => setTimeout(() => { PKSpot.draw(); PKSpot.drawMonthly(); }, 300));
    }
  });
  // whatever way the page was opened (menu route, tab, link), each chart draws the first time it shows
  if ('IntersectionObserver' in window) [['spt-monthly', () => PKSpot.drawMonthly()], ['spt-30d', () => PKSpot.draw()]].forEach(([id, fn]) => {
    const cv = document.getElementById(id); if (!cv) return;
    new IntersectionObserver((es, ob) => { if (es.some(e => e.isIntersecting)) { ob.disconnect(); if (!(window.Chart && Chart.getChart(cv))) fn(); } }).observe(cv);
  });
}, 50));

// ── Hydro reservoirs (ENTSO-E A72, weekly stored energy) ──
const MU_HYDRO = { key: 'country', label: 'Country', inTitle: true, options: [['FR', 'France'], ['CH', 'Switzerland'], ['ES', 'Spain'], ['PT', 'Portugal'], ['AT', 'Austria'], ['IT', 'Italy'], ['NO', 'Norway'], ['SE', 'Sweden'], ['FI', 'Finland']] };
_muReg({
  id: 'hydro-reservoirs', title: 'Hydro reservoir filling', category: 'weather', page: 'wxcities', pageCanvas: 'hydro-res', source: 'ENTSO-E',
  desc: 'Energy stored in hydro reservoirs (weekly): this year and last year against the range and mean of the earlier years since 2015.',
  params: [MU_HYDRO], defaults: { country: 'FR' },
  titleFn: p => (MU_HYDRO.options.find(o => o[0] === p.country) || ['', 'France'])[1] + ' · hydro reservoir filling',
  async draw(cid, p) {
    const j = await _muGet('hydro', 'history/hydro_reservoirs.json');
    const c = j && j.countries && j.countries[p.country || 'FR'];
    if (!c) { noDataMsg(cid, 'No reservoir data for this country', ''); return null; }
    const y = +_muToday().slice(0, 4);
    const big = Math.max(...c.weeks.map(w => w[1])) > 2e7;      // Norway, Sweden: TWh
    const div = big ? 1e6 : 1e3, unit = big ? 'TWh' : 'GWh';
    const wk = d => Math.min(52, Math.floor((Date.parse(d) - Date.UTC(+d.slice(0, 4), 0, 1)) / (7 * 864e5)));
    const by = {}; c.weeks.forEach(([d, v]) => { const yy = +d.slice(0, 4); (by[yy] = by[yy] || new Array(53).fill(null))[wk(d)] = Math.round(v / div * 100) / 100; });
    const hist = Object.keys(by).map(Number).filter(yy => yy < y - 1 && by[yy].filter(v => v != null).length > 40).sort();
    const band = fn => by[y] ? by[y].map((_, i) => { const v = hist.map(yy => by[yy][i]).filter(x => x != null); return v.length ? Math.round(fn(v) * 100) / 100 : null; }) : [];
    const r1 = hist[0] + '–' + hist[hist.length - 1];
    const mean = band(v => v.reduce((a, b) => a + b, 0) / v.length);
    _fuelChart(cid, { type: 'line', data: { labels: Array.from({ length: 53 }, (_, i) => 'W' + (i + 1)), datasets: [
      { label: r1 + ' range', data: band(v => Math.max(...v)), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(122,147,171,.18)', spanGaps: true },
      { label: '_min', data: band(v => Math.min(...v)), borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true },
      { label: r1 + ' mean', data: mean, borderColor: 'rgba(184,201,217,.7)', borderDash: [5, 4], borderWidth: 1.3, pointRadius: 0, fill: false, spanGaps: true },
      { label: String(y - 1), data: by[y - 1] || [], borderColor: '#7FC8F8', borderWidth: 1.5, pointRadius: 0, fill: false, spanGaps: true },
      { label: String(y), data: by[y] || [], borderColor: '#3FA6B4', borderWidth: 2.6, pointRadius: 0, fill: false, spanGaps: true },
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 13, maxRotation: 0 } }), y: _fuelAxis(unit, { beginAtZero: true }) },
      plugins: { legend: _muLegend() } }) }, 'hydro-reservoirs-' + (p.country || 'FR'));
    const last = c.weeks[c.weeks.length - 1], li = wk(last[0]), lv = last[1] / div, mv = mean[li];
    return { sub: _muT(`${lv.toFixed(big ? 1 : 0)} ${unit} la semaine du ${last[0]}`, `${lv.toFixed(big ? 1 : 0)} ${unit} in the week of ${last[0]}`) + (mv ? ` · ${lv >= mv ? '+' : ''}${((lv / mv - 1) * 100).toFixed(0)} % ${_muT('vs moyenne', 'vs')} ${r1}${_muT('', ' mean')}` : '') };
  },
});
window.PKHydro = {
  render() {
    const sel = document.getElementById('hydro-country'); if (!sel || !window.PKW) return;
    if (!sel.options.length) sel.innerHTML = MU_HYDRO.options.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
    PKW.draw('hydro-reservoirs', 'hydro-res', { country: sel.value || 'FR' }).then(r => { const e = document.getElementById('hydro-res-sub'); if (e) e.textContent = r && r.sub ? r.sub : ''; });
  },
};
