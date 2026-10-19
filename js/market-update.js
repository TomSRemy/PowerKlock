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
function _muToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()); }
function _muAdd(iso, n) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
const _muDay = iso => +iso.slice(8) + ' ' + MU_MON[+iso.slice(5, 7) - 1];
const _muLegend = () => ({ display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !/^_/.test(it.text) } });
const _muMean = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
// vertical "today" line on a category axis
function _muTodayPlugin(idx) {
  return { id: 'muToday', afterDatasetsDraw(ch) { if (idx < 0) return; const x = ch.scales.x.getPixelForValue(idx), a = ch.chartArea, g = ch.ctx;
    g.save(); g.strokeStyle = 'rgba(226,232,240,.45)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, a.top); g.lineTo(x, a.bottom); g.stroke();
    g.fillStyle = 'rgba(226,232,240,.7)'; g.font = '9px "IBM Plex Mono", monospace'; g.fillText('today', x + 4, a.top + 10); g.restore(); } };
}

const MU_ZONE = { key: 'zone', label: 'Zone', inTitle: true, options: (typeof ZONES !== 'undefined' ? ZONES : [{ code: 'FR', name: 'France' }]).map(z => [z.code, z.name]).sort((a, b) => a[1].localeCompare(b[1])) };
const MU_FWD = { key: 'country', label: 'Market', inTitle: true, options: [['FR', 'France'], ['DE', 'Germany'], ['NL', 'Netherlands'], ['UK', 'Great Britain']] };
const _muZoneName = z => ((typeof ZONES !== 'undefined' ? ZONES : []).find(x => x.code === z) || {}).name || z;
function _muReg(def) { if (window.PKW) PKW.register(Object.assign({ size: { w: 6, h: 5 } }, def)); }

// ── 1. outlook vs normal ──
const MU_OUT_COUNTRY = { key: 'country', label: 'Country', inTitle: true, options: [['FR', 'France'], ['DE', 'Germany'], ['ES', 'Spain'], ['BE', 'Belgium'], ['NL', 'Netherlands'], ['IT', 'Italy'], ['CH', 'Switzerland'], ['AT', 'Austria']] };
const MU_OUT = {
  precip: { title: 'Hydro proxy · precipitation vs normal', col: '#3B82F6', above: 'rgba(42,163,100,.30)', below: 'rgba(237,105,101,.30)' },
  solar: { title: 'Solar production vs normal', col: '#FBBF24', above: 'rgba(42,163,100,.30)', below: 'rgba(237,105,101,.30)' },
  wind: { title: 'Wind production vs normal', col: '#14D3A9', above: 'rgba(42,163,100,.30)', below: 'rgba(237,105,101,.30)' },
  temp: { title: 'Temperature vs normal', col: '#F97316', above: 'rgba(249,115,22,.28)', below: 'rgba(59,130,246,.30)' },
};
_muReg({
  id: 'wx-outlook', title: '5-week outlook vs normal', category: 'weather', page: 'wxcities', pageCanvas: 'wx-out-wind', source: 'Open-Meteo GFS ensemble · RTE',
  desc: 'Next 5 weeks against the 2016–2025 normal: temperature, wind and solar production (GWh/day, calibrated on RTE or ENTSO-E output) or hydro-basin precipitation; France, Germany, Spain, Belgium, Netherlands, Italy, Switzerland, Austria. Band = 10th–90th percentile of the 31 ensemble members.',
  params: [MU_OUT_COUNTRY, { key: 'series', label: 'Series', inTitle: true, options: [['temp', 'Temperature'], ['wind', 'Wind production'], ['solar', 'Solar production'], ['precip', 'Hydro (precipitation)']] }],
  defaults: { country: 'FR', series: 'wind' },
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
    // start at the first day with a forecast
    const i0 = Math.max(0, s.mean.findIndex(v => v != null));
    const sl = a => (a || []).slice(i0);
    const days = sl(s.days), st = MU_OUT[p.series];
    const r = v => v == null ? null : Math.round(v * 10) / 10;
    const ds = [
      { label: 'Normal ' + j.normal_years.join('–'), data: sl(s.normal).map(r), borderColor: 'rgba(226,232,240,.7)', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0, fill: false, order: 2 },
      { label: 'Forecast (ensemble mean)', data: sl(s.mean).map(r), borderColor: st.col, borderWidth: 2.2, pointRadius: 0, tension: .25, order: 1,
        fill: { target: 0, above: st.above, below: st.below } },
      { label: '_p90', data: sl(s.p90).map(r), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(148,163,184,.14)', order: 3 },
      { label: 'Ensemble 10–90 %', data: sl(s.p10).map(r), borderWidth: 0, pointRadius: 0, fill: false, backgroundColor: 'rgba(148,163,184,.14)', order: 3 },
    ];
    if (s.actual && s.actual.some(v => v != null)) ds.push({ label: 'Actual (RTE)', data: sl(s.actual), borderColor: '#F8FAFC', backgroundColor: '#F8FAFC', showLine: false, pointRadius: 2.5, order: 0 });
    const ti = days.indexOf(_muToday());
    _fuelChart(cid, { type: 'line', data: { labels: days.map(_muDay), datasets: ds }, plugins: [_muTodayPlugin(ti)],
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 10, maxRotation: 0 } }), y: _fuelAxis(s.unit) },
        plugins: { legend: _muLegend() } }) }, 'outlook-' + cc + '-' + p.series);
    const fut = days.map((d, i) => d > _muToday() ? i : -1).filter(i => i >= 0);
    const fm = _muMean(fut.map(i => sl(s.mean)[i])), nm = _muMean(fut.map(i => sl(s.normal)[i]));
    const dev = fm != null && nm ? (p.series === 'temp' ? (fm - nm).toFixed(1) + ' °C' : ((fm / nm - 1) * 100).toFixed(0) + ' %') : '';
    return { sub: `Next ${fut.length} days: ${fm == null ? '–' : fm.toFixed(1)} ${s.unit} vs normal ${nm == null ? '–' : nm.toFixed(1)} (${dev && (fm >= nm ? '+' : '')}${dev}) · updated ${j.updated.slice(0, 10)}` };
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
    const cols = ['#FBBF24', '#B45309', '#A78BFA'];
    _fuelChart(cid, { type: 'bar', data: { labels: MU_MON, datasets: years.map((yy, i) => ({ label: String(yy), data: MU_MON.map((_, m) => twh(yy, m + 1)), backgroundColor: cols[i], borderRadius: 3, borderWidth: 0 })) },
      options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('TWh', { beginAtZero: true }) }, plugins: { legend: _muLegend() } }) }, 'nuclear-monthly');
    const cur = j.rows[j.rows.length - 1].d;
    return { sub: `${years.join(' · ')} · ${MU_MON[+cur.slice(5, 7) - 1]} ${y} provisional (to ${cur})` };
  },
});

// ── 3. EU gas storage by year ──
_muReg({
  id: 'gas-storage-years', title: 'EU gas storage by year', category: 'fuels', page: 'eua', pageCanvas: 'fuel-gas-years', source: 'GIE AGSI',
  desc: 'Aggregate EU gas storage filling level (%), one line per year since 2022.',
  async draw(cid) {
    const j = await _muGet('cs', 'history/commodities_series.json');
    const pts = j && j.series && j.series.agsi && j.series.agsi.points;
    if (!pts) { noDataMsg(cid, 'Gas storage history not available', ''); return null; }
    const y = +_muToday().slice(0, 4), years = [y - 4, y - 3, y - 2, y - 1, y];
    const doy = d => Math.floor((Date.parse(d) - Date.UTC(+d.slice(0, 4), 0, 1)) / 864e5);
    const lbl = Array.from({ length: 366 }, (_, i) => { const t = new Date(Date.UTC(2001, 0, 1 + i)); return t.getUTCDate() === 1 ? MU_MON[t.getUTCMonth()] : ''; });
    const cols = ['#1E3A8A', '#16A34A', '#86EFAC', '#94A3B8', '#F8FAFC'];
    const ds = years.map((yy, i) => {
      const arr = new Array(366).fill(null);
      pts.forEach(([d, v]) => { if (+d.slice(0, 4) === yy) arr[Math.min(365, doy(d))] = v; });
      return { label: String(yy), data: arr, borderColor: cols[i], borderWidth: yy === y ? 2.6 : 1.4, pointRadius: 0, spanGaps: true, fill: false };
    });
    _fuelChart(cid, { type: 'line', data: { labels: lbl, datasets: ds }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0, callback: (v, i) => lbl[i] } }), y: _fuelAxis('% full', { min: 20, max: 100 }) },
      plugins: { legend: _muLegend() } }) }, 'gas-storage-years');
    const last = pts[pts.length - 1], ly = pts.filter(([d]) => d.startsWith(String(y - 1)) && d.slice(5) <= last[0].slice(5)).slice(-1)[0];
    return { sub: `${last[1].toFixed(1)} % on ${last[0]}` + (ly ? ` · ${(last[1] - ly[1] >= 0 ? '+' : '')}${(last[1] - ly[1]).toFixed(1)} pts vs ${y - 1}` : '') };
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
      { label: 'Normal 2016–2025', data: nv, borderColor: 'rgba(226,232,240,.7)', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0, fill: false },
      { label: 'Consumption, 7-day average', data: roll7, borderColor: '#60A5FA', borderWidth: 2.2, pointRadius: 0, tension: .2, fill: { target: 0, above: 'rgba(249,115,22,.25)', below: 'rgba(42,163,100,.25)' } },
      { label: 'Daily consumption', data: act, borderColor: 'rgba(96,165,250,.35)', borderWidth: 1, pointRadius: 0, tension: .2, fill: false },
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 10, maxRotation: 0 } }), y: _fuelAxis('GWh/day') }, plugins: { legend: _muLegend() } }) }, 'consumption-vs-normal');
    const a7 = roll7[roll7.length - 1], n7 = _muMean(nv.slice(-7));
    return { sub: `Last 7 days ${a7 ? a7.toFixed(0) : '–'} GWh/day, ${n7 ? ((a7 / n7 - 1) * 100 >= 0 ? '+' : '') + ((a7 / n7 - 1) * 100).toFixed(1) + ' %' : ''} vs normal` };
  },
});

// ── 5. prices ──
_muReg({
  id: 'fr-cal-history', title: 'Calendar forwards', category: 'forwards', page: 'prices', pageCanvas: 'cal-history', source: 'Market data',
  desc: 'Daily settlements of a market’s baseload calendar contracts (fixed delivery years). UK in GBP.',
  titleFn: p => (MU_FWD.options.find(o => o[0] === p.country) || ['', 'France'])[1] + ' · calendar forwards',
  params: [MU_FWD, { key: 'win', label: 'Window', options: [['3M', '3 months'], ['6M', '6 months'], ['1Y', '1 year'], ['3Y', '3 years']] }], defaults: { win: '3M', country: 'FR' },
  async draw(cid, p) {
    const c = await _muGet('chain', 'history/fr_market_calchain.json');
    const cc = p.country || 'FR', yrs = c && c[cc] && c[cc].years;
    if (!yrs) { noDataMsg(cid, 'Forward history not available', ''); return null; }
    const from = _muAdd(_muToday(), -({ '3M': 92, '6M': 183, '1Y': 366, '3Y': 1096 }[p.win] || 92));
    const dates = [...new Set(Object.values(yrs).flatMap(v => v.dates.filter(d => d >= from)))].sort();
    const cols = ['#FDE047', '#B45309', '#F472B6', '#5EEAD4', '#A78BFA'];
    const ds = Object.keys(yrs).sort().map((y, i) => { const m = new Map(yrs[y].dates.map((d, k) => [d, yrs[y].values[k]])); return _fuelLineDs('Cal ' + y, dates.map(d => m.has(d) ? m.get(d) : null), cols[i % cols.length], { borderWidth: i ? 1.6 : 2.4, spanGaps: true }); });
    _fuelChart(cid, { type: 'line', data: { labels: dates, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis(cc === 'UK' ? '£/MWh' : '€/MWh') }, plugins: { legend: _muLegend() } }) }, 'calendar-forwards-' + cc);
    const k = Object.keys(yrs).sort()[0], v = yrs[k].values, first = v[yrs[k].dates.findIndex(d => d >= from)];
    return { sub: `Cal ${k}: ${v[v.length - 1].toFixed(2)} ${cc === 'UK' ? '£' : '€'}/MWh, ${first ? ((v[v.length - 1] - first) >= 0 ? '+' : '') + (v[v.length - 1] - first).toFixed(2) : '–'} over ${p.win}` };
  },
});

_muReg({
  id: 'fr-cal-drivers', title: 'Cal+1 and its drivers', category: 'forwards', page: 'prices', pageCanvas: 'cal-drivers', source: 'Market data',
  desc: 'A market’s Cal+1 baseload against TTF day-ahead gas and EUA carbon, indexed to 100 at the start of the window.',
  titleFn: p => 'Cal+1 ' + (MU_FWD.options.find(o => o[0] === p.country) || ['', 'France'])[1] + ' and its drivers',
  params: [MU_FWD, { key: 'win', label: 'Window', options: [['3M', '3 months'], ['6M', '6 months'], ['1Y', '1 year']] }], defaults: { win: '6M', country: 'FR' },
  async draw(cid, p) {
    const [c, cs] = await Promise.all([_muGet('chain', 'history/fr_market_calchain.json'), _muGet('cs', 'history/commodities_series.json')]);
    const cc = p.country || 'FR', yrs = c && c[cc] && c[cc].years, ser = cs && cs.series;
    if (!yrs || !ser) { noDataMsg(cid, 'Data not available', ''); return null; }
    const from = _muAdd(_muToday(), -({ '3M': 92, '6M': 183, '1Y': 366 }[p.win] || 183));
    const k = Object.keys(yrs).sort()[0];
    const cal = new Map(yrs[k].dates.map((d, i) => [d, yrs[k].values[i]]));
    const pts = key => new Map(((ser[key] || {}).points || []).filter(([d]) => d >= from));
    const ttf = pts('ttf'), eua = pts('eua');
    const dates = [...cal.keys()].filter(d => d >= from).sort();
    const idx = (m) => { const b = dates.map(d => m.get(d)).find(v => v != null); return dates.map(d => m.has(d) && b ? Math.round(m.get(d) / b * 1000) / 10 : null); };
    _fuelChart(cid, { type: 'line', data: { labels: dates, datasets: [
      _fuelLineDs('Cal ' + k + ' ' + cc, idx(cal), '#FDE047', { borderWidth: 2.4, spanGaps: true }),
      _fuelLineDs('TTF day-ahead', idx(ttf), '#F97316', { borderWidth: 1.5, spanGaps: true }),
      _fuelLineDs('EUA', idx(eua), '#A78BFA', { borderWidth: 1.5, spanGaps: true }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('index, start = 100') }, plugins: { legend: _muLegend() } }) }, 'cal-drivers');
    return { sub: 'Indexed to 100 on ' + dates[0] };
  },
});

// Daily baseload of a zone: summary.json (long history, 5 zones), monthly
// files (every zone since 2025) and the daily files of the last days.
async function _muZoneDaily(zone) {
  const rows = new Map();
  const s = await _muGet('sum', 'history/summary.json');
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
      { type: 'bar', label: 'Monthly average', data: avg, backgroundColor: avg.map(v => v > mean ? '#D97706' : '#15803D'), borderRadius: 3, borderWidth: 0, order: 2 },
      { type: 'line', label: '12-month mean ' + mean.toFixed(1), data: avg.map(() => Math.round(mean * 10) / 10), borderColor: '#14D3A9', borderDash: [4, 3], borderWidth: 1.4, pointRadius: 0, order: 1 },
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
      { label: '30-day mean ' + mean.toFixed(1), data: v.map(() => Math.round(mean * 10) / 10), borderColor: 'rgba(226,232,240,.6)', borderDash: [4, 3], borderWidth: 1.2, pointRadius: 0 },
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 10, maxRotation: 0 } }), y: _fuelAxis('€/MWh') }, plugins: { legend: _muLegend() } }) }, 'spot-30d-' + (p.zone || 'FR'));
    const last = rows[rows.length - 1];
    return { sub: `Last session ${_muDay(last[0])}: ${last[1].toFixed(1)} €/MWh · 30-day mean ${mean.toFixed(1)} · range ${Math.min(...v).toFixed(0)} → ${Math.max(...v).toFixed(0)}` };
  },
});

// Day card: average, change, cheapest / most expensive hour and 3-hour windows, curve with bands.
if (window.PKW) PKW.register({
  id: 'fr-spot-day', kind: 'html', title: 'Spot · day profile', category: 'prices', page: 'prices', source: 'ENTSO-E', size: { w: 6, h: 7 },
  desc: 'One delivery day of day-ahead prices of a zone: average and change, cheapest and most expensive hour, cheapest and dearest 3-hour windows.',
  params: [MU_ZONE, { key: 'day', label: 'Day', options: [['latest', 'Latest delivery day'], ['previous', 'Day before']] }], defaults: { zone: 'FR', day: 'latest' },
  titleFn: p => _muZoneName(p.zone || 'FR') + ' spot · ' + (p.day === 'previous' ? 'previous day' : 'latest day'),
  async html(host, p) {
    const t = _muToday();
    let d = null;
    const Z = p.zone || 'FR';
    for (const c of [_muAdd(t, 1), t, _muAdd(t, -1)]) { const j = await _muGet('d' + c, 'history/daily/' + c + '.json'); if (j && j.zones && j.zones[Z] && j.zones[Z].hourly) { d = c; break; } }
    if (!d) { host.innerHTML = '<div class="fuel-note">No prices for ' + Z + '.</div>'; return; }
    if (p.day === 'previous') d = _muAdd(d, -1);
    const [J, P] = await Promise.all([_muGet('d' + d, 'history/daily/' + d + '.json'), _muGet('d' + _muAdd(d, -1), 'history/daily/' + _muAdd(d, -1) + '.json')]);
    const q = J && J.zones && J.zones[Z] && J.zones[Z].hourly, qp = P && P.zones && P.zones[Z] && P.zones[Z].hourly;
    if (!q) { host.innerHTML = '<div class="fuel-note">No prices for ' + Z + ' on ' + d + '.</div>'; return; }
    const per = q.length / 24, h = Array.from({ length: 24 }, (_, i) => _muMean(q.slice(i * per, (i + 1) * per)));
    const avg = _muMean(q), avgP = qp ? _muMean(qp) : null, chg = avgP ? (avg / avgP - 1) * 100 : null;
    let lo = 0, hi = 0; h.forEach((v, i) => { if (v < h[lo]) lo = i; if (v > h[hi]) hi = i; });
    const win = sign => { let b = 0, bv = null; for (let i = 0; i <= 21; i++) { const m = (h[i] + h[i + 1] + h[i + 2]) / 3; if (bv == null || sign * m > sign * bv) { bv = m; b = i; } } return b; };
    const wl = win(-1), wh = win(1);
    const cid = 'mu-day-' + Math.random().toString(36).slice(2, 8);
    const dl = new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    host.innerHTML = `<div class="mu-day"><div class="mu-day-h"><div><div class="mu-day-t">${_muZoneName(Z)} · ${dl}</div><div class="mu-day-avg">${avg.toFixed(2)}<small> €/MWh</small></div></div>
      ${chg == null ? '' : `<span class="mu-day-chg ${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '▲' : '▼'} ${chg >= 0 ? '+' : ''}${chg.toFixed(1)} % vs previous day</span>`}</div>
      <div class="mu-day-k"><div class="lo"><b>Cheapest</b> ${h[lo].toFixed(2)} €/MWh at ${lo} h<span>trough ${wl} h → ${wl + 3} h</span></div>
      <div class="hi"><b>Most expensive</b> ${h[hi].toFixed(2)} €/MWh at ${hi} h<span>peak ${wh} h → ${wh + 3} h</span></div></div>
      <div class="mu-day-c"><canvas id="${cid}"></canvas></div></div>`;
    const bands = { id: 'muBands', beforeDatasetsDraw(ch) { const a = ch.chartArea, x = ch.scales.x, g = ch.ctx;
      [[wl, 'rgba(42,163,100,.16)', 'TROUGH'], [wh, 'rgba(249,115,22,.16)', 'PEAK']].forEach(([s, c, t]) => { const x0 = x.getPixelForValue(s), x1 = x.getPixelForValue(Math.min(23, s + 3)); g.save(); g.fillStyle = c; g.fillRect(x0, a.top, x1 - x0, a.bottom - a.top); g.fillStyle = 'rgba(226,232,240,.6)'; g.font = '9px "IBM Plex Mono", monospace'; g.fillText(t, x0 + 3, a.top + 10); g.restore(); }); } };
    new Chart(document.getElementById(cid), { type: 'line', data: { labels: h.map((_, i) => String(i).padStart(2, '0') + 'h'), datasets: [
      { label: 'Price', data: h.map(v => Math.round(v * 100) / 100), borderColor: '#F97316', borderWidth: 2.2, tension: .35, fill: false,
        pointRadius: h.map((_, i) => i === lo || i === hi ? 5 : 0), pointBackgroundColor: h.map((_, i) => i === lo ? '#16A34A' : '#F97316') },
      { label: 'Average', data: h.map(() => Math.round(avg * 100) / 100), borderColor: '#60A5FA', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0 },
    ] }, plugins: [bands], options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: '#7A93AB', font: { size: 9 }, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#7A93AB', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } } } } });
  },
});

// Latest headlines (geopolitics / markets)
if (window.PKW) PKW.register({
  id: 'news-latest', kind: 'html', title: 'Energy news · latest', category: 'intel', page: 'news', source: 'News feeds', size: { w: 6, h: 6 },
  desc: 'The latest energy-market headlines (gas, power, carbon, geopolitics).',
  async html(host) {
    const j = await _muGet('news', 'news.json');
    const items = (j && (j.items || j.articles || j)) || [];
    const list = (Array.isArray(items) ? items : []).slice(0, 8);
    host.innerHTML = list.length ? '<ul class="mu-news">' + list.map(n => `<li><a href="${n.link || n.url || '#'}" target="_blank" rel="noopener">${(n.title || '').replace(/</g, '&lt;')}</a><span>${(n.source || '').replace(/</g, '&lt;')}${n.date || n.published ? ' · ' + String(n.date || n.published).slice(0, 10) : ''}</span></li>`).join('') + '</ul>' : '<div class="fuel-note">No news.</div>';
  },
});

(function () {
  const css = document.createElement('style');
  css.textContent = `
  .mu-day{display:flex;flex-direction:column;gap:10px;height:100%}
  .mu-day-h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
  .mu-day-t{font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
  .mu-day-avg{font-family:'IBM Plex Mono',monospace;font-size:26px;color:var(--text)} .mu-day-avg small{font-size:11px;color:var(--text3)}
  .mu-day-chg{font-size:11px;padding:3px 8px;border-radius:999px;font-weight:600} .mu-day-chg.up{color:#F97316;background:rgba(249,115,22,.12)} .mu-day-chg.down{color:#16A34A;background:rgba(22,163,74,.14)}
  .mu-day-k{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .mu-day-k>div{background:var(--bg3);border:1px solid var(--border);border-left:3px solid;border-radius:6px;padding:8px 10px;font-size:12px;color:var(--text2);display:flex;flex-direction:column;gap:2px}
  .mu-day-k .lo{border-left-color:#16A34A} .mu-day-k .hi{border-left-color:#F97316}
  .mu-day-k b{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text)} .mu-day-k span{font-size:11px;color:var(--text3)}
  .mu-day-c{position:relative;flex:1;min-height:180px}
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
    PKW.draw('fr-spot-monthly', 'spt-monthly', { zone: z }).then(r => sub('spt-monthly-sub', r));
    PKW.draw('fr-spot-30d', 'spt-30d', { zone: z }).then(r => sub('spt-30d-sub', r));
    const a = document.getElementById('spt-day-latest'), b = document.getElementById('spt-day-prev');
    if (a) PKW.get('fr-spot-day').html(a, { zone: z, day: 'latest' });
    if (b) PKW.get('fr-spot-day').html(b, { zone: z, day: 'previous' });
  },
  drawCal() {
    const sel = document.getElementById('cal-country'); if (!sel || !window.PKW) return;
    const c = sel.value || 'FR', sub = (id, r) => { const e = document.getElementById(id); if (e && r && r.sub) e.textContent = r.sub; };
    PKW.draw('fr-cal-history', 'cal-history', { country: c, win: '3M' }).then(r => sub('cal-history-sub', r));
    PKW.draw('fr-cal-drivers', 'cal-drivers', { country: c, win: '6M' }).then(r => sub('cal-drivers-sub', r));
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
      if (d === 'da') once('da', () => setTimeout(PKSpot.draw, 300));
      if (d === 'forward') once('fwd', () => setTimeout(PKSpot.drawCal, 300));
      return r;
    };
  }
  const innerShow = window.showPage;
  window.showPage = function (id) {
    innerShow(id);
    if (id === 'load') once('load', () => setTimeout(PKSpot.load, 300));
    if (id === 'wxcities') once('wx', () => { setTimeout(PKSpot.outlook, 300); const sel = document.getElementById('wx-country'); if (sel) sel.addEventListener('change', () => PKSpot.outlook()); });
    if (id === 'prices') {   // the Day-Ahead sub-page can be the one open by default
      const da = document.querySelector('[data-subdomain-panel="da"].active');
      if (da) once('da', () => setTimeout(PKSpot.draw, 300));
    }
  };
}, 50));
