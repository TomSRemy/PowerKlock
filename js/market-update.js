// ════════════════════════════════════════════════════════════════════
// MARKET UPDATE — the internal "point marché" charts, France.
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

function _muReg(def) { if (window.PKW) PKW.register(Object.assign({ page: 'marketupdate', size: { w: 6, h: 5 } }, def)); }

// ── 1. outlook vs normal ──
const MU_OUT = {
  precip: { title: 'Hydro proxy · precipitation vs normal', col: '#3B82F6', above: 'rgba(42,163,100,.30)', below: 'rgba(237,105,101,.30)' },
  solar: { title: 'Solar production vs normal', col: '#FBBF24', above: 'rgba(42,163,100,.30)', below: 'rgba(237,105,101,.30)' },
  wind: { title: 'Wind production vs normal', col: '#14D3A9', above: 'rgba(42,163,100,.30)', below: 'rgba(237,105,101,.30)' },
  temp: { title: 'Temperature vs normal', col: '#F97316', above: 'rgba(249,115,22,.28)', below: 'rgba(59,130,246,.30)' },
};
_muReg({
  id: 'wx-outlook', title: 'France 5-week outlook vs normal', category: 'weather', pageCanvas: 'mu-out-wind', source: 'Open-Meteo GFS ensemble · RTE',
  desc: 'Next 5 weeks for France against the 2016–2025 normal: temperature, wind and solar production (GWh/day, calibrated on RTE) or hydro-basin precipitation. Band = 10th–90th percentile of the 31 ensemble members.',
  params: [{ key: 'series', label: 'Series', inTitle: true, options: [['temp', 'Temperature'], ['wind', 'Wind production'], ['solar', 'Solar production'], ['precip', 'Hydro (precipitation)']] }],
  defaults: { series: 'wind' },
  titleFn: p => 'France · ' + (MU_OUT[p.series] || MU_OUT.wind).title,
  async draw(cid, p) {
    const j = await _muGet('out', 'weather_outlook.json');
    const s = j && j.series && j.series[p.series];
    if (!s) { noDataMsg(cid, 'Outlook not available yet', 'data/weather_outlook.json'); return null; }
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
        plugins: { legend: _muLegend() } }) }, 'outlook-' + p.series);
    const fut = days.map((d, i) => d > _muToday() ? i : -1).filter(i => i >= 0);
    const fm = _muMean(fut.map(i => sl(s.mean)[i])), nm = _muMean(fut.map(i => sl(s.normal)[i]));
    const dev = fm != null && nm ? (p.series === 'temp' ? (fm - nm).toFixed(1) + ' °C' : ((fm / nm - 1) * 100).toFixed(0) + ' %') : '';
    return { sub: `Next ${fut.length} days: ${fm == null ? '–' : fm.toFixed(1)} ${s.unit} vs normal ${nm == null ? '–' : nm.toFixed(1)} (${dev && (fm >= nm ? '+' : '')}${dev}) · updated ${j.updated.slice(0, 10)}` };
  },
});

// ── 2. nuclear output by month and year (RTE) ──
_muReg({
  id: 'nuc-monthly-years', title: 'France nuclear output by month', category: 'france', pageCanvas: 'mu-nuc', source: 'RTE éCO2mix',
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
  id: 'gas-storage-years', title: 'EU gas storage by year', category: 'fuels', pageCanvas: 'mu-gas', source: 'GIE AGSI',
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
  id: 'fr-load-normal', title: 'France consumption vs normal', category: 'france', pageCanvas: 'mu-load', source: 'RTE éCO2mix',
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
  id: 'fr-cal-history', title: 'France calendar forwards', category: 'forwards', pageCanvas: 'mu-cal', source: 'Market data',
  desc: 'Daily settlements of the French baseload calendar contracts (fixed delivery years).',
  params: [{ key: 'win', label: 'Window', options: [['3M', '3 months'], ['6M', '6 months'], ['1Y', '1 year'], ['3Y', '3 years']] }], defaults: { win: '3M' },
  async draw(cid, p) {
    const c = await _muGet('chain', 'history/fr_market_calchain.json');
    const yrs = c && c.FR && c.FR.years;
    if (!yrs) { noDataMsg(cid, 'Forward history not available', ''); return null; }
    const from = _muAdd(_muToday(), -({ '3M': 92, '6M': 183, '1Y': 366, '3Y': 1096 }[p.win] || 92));
    const dates = [...new Set(Object.values(yrs).flatMap(v => v.dates.filter(d => d >= from)))].sort();
    const cols = ['#FDE047', '#B45309', '#F472B6', '#5EEAD4', '#A78BFA'];
    const ds = Object.keys(yrs).sort().map((y, i) => { const m = new Map(yrs[y].dates.map((d, k) => [d, yrs[y].values[k]])); return _fuelLineDs('Cal ' + y, dates.map(d => m.has(d) ? m.get(d) : null), cols[i % cols.length], { borderWidth: i ? 1.6 : 2.4, spanGaps: true }); });
    _fuelChart(cid, { type: 'line', data: { labels: dates, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') }, plugins: { legend: _muLegend() } }) }, 'fr-calendar-forwards');
    const k = Object.keys(yrs).sort()[0], v = yrs[k].values, first = v[yrs[k].dates.findIndex(d => d >= from)];
    return { sub: `Cal ${k}: ${v[v.length - 1].toFixed(2)} €/MWh, ${first ? ((v[v.length - 1] - first) >= 0 ? '+' : '') + (v[v.length - 1] - first).toFixed(2) : '–'} over ${p.win}` };
  },
});

_muReg({
  id: 'fr-cal-drivers', title: 'Cal+1 France and its drivers', category: 'forwards', pageCanvas: 'mu-drivers', source: 'Market data',
  desc: 'French Cal+1 baseload against TTF day-ahead gas and EUA carbon, indexed to 100 at the start of the window.',
  params: [{ key: 'win', label: 'Window', options: [['3M', '3 months'], ['6M', '6 months'], ['1Y', '1 year']] }], defaults: { win: '6M' },
  async draw(cid, p) {
    const [c, cs] = await Promise.all([_muGet('chain', 'history/fr_market_calchain.json'), _muGet('cs', 'history/commodities_series.json')]);
    const yrs = c && c.FR && c.FR.years, ser = cs && cs.series;
    if (!yrs || !ser) { noDataMsg(cid, 'Data not available', ''); return null; }
    const from = _muAdd(_muToday(), -({ '3M': 92, '6M': 183, '1Y': 366 }[p.win] || 183));
    const k = Object.keys(yrs).sort()[0];
    const cal = new Map(yrs[k].dates.map((d, i) => [d, yrs[k].values[i]]));
    const pts = key => new Map(((ser[key] || {}).points || []).filter(([d]) => d >= from));
    const ttf = pts('ttf'), eua = pts('eua');
    const dates = [...cal.keys()].filter(d => d >= from).sort();
    const idx = (m) => { const b = dates.map(d => m.get(d)).find(v => v != null); return dates.map(d => m.has(d) && b ? Math.round(m.get(d) / b * 1000) / 10 : null); };
    _fuelChart(cid, { type: 'line', data: { labels: dates, datasets: [
      _fuelLineDs('Cal ' + k + ' FR', idx(cal), '#FDE047', { borderWidth: 2.4, spanGaps: true }),
      _fuelLineDs('TTF day-ahead', idx(ttf), '#F97316', { borderWidth: 1.5, spanGaps: true }),
      _fuelLineDs('EUA', idx(eua), '#A78BFA', { borderWidth: 1.5, spanGaps: true }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('index, start = 100') }, plugins: { legend: _muLegend() } }) }, 'cal-drivers');
    return { sub: 'Indexed to 100 on ' + dates[0] };
  },
});

async function _muFrDaily() {
  // FR daily baseload: summary.json, completed with the daily files of the last days
  const s = await _muGet('sum', 'history/summary.json');
  const rows = new Map(((s && s.zones && s.zones.FR) || []).map(r => [r.d, r.avg]));
  const t = _muToday();
  for (let i = -10; i <= 1; i++) {
    const d = _muAdd(t, i); if (rows.has(d)) continue;
    const j = await _muGet('d' + d, 'history/daily/' + d + '.json');
    const h = j && j.zones && j.zones.FR && j.zones.FR.hourly;
    const m = Array.isArray(h) ? _muMean(h) : null; if (m != null) rows.set(d, Math.round(m * 100) / 100);
  }
  return [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

_muReg({
  id: 'fr-spot-monthly', title: 'France spot by month · 12 months', category: 'prices', pageCanvas: 'mu-spm', source: 'ENTSO-E',
  desc: 'Monthly average French day-ahead baseload over the last 12 months against their 12-month mean; bars above the mean in orange.',
  async draw(cid) {
    const rows = await _muFrDaily();
    if (!rows.length) { noDataMsg(cid, 'Price history not available', ''); return null; }
    const by = new Map(); rows.forEach(([d, v]) => { if (v == null) return; const k = d.slice(0, 7); (by.get(k) || by.set(k, []).get(k)).push(v); });
    const months = [...by.keys()].sort().slice(-13);
    const avg = months.map(k => Math.round(_muMean(by.get(k)) * 10) / 10);
    const mean = _muMean(avg.slice(0, -1).slice(-12));
    _fuelChart(cid, { type: 'bar', data: { labels: months.map(k => MU_MON[+k.slice(5) - 1] + ' ' + k.slice(2, 4)), datasets: [
      { type: 'bar', label: 'Monthly average', data: avg, backgroundColor: avg.map(v => v > mean ? '#D97706' : '#15803D'), borderRadius: 3, borderWidth: 0, order: 2 },
      { type: 'line', label: '12-month mean ' + mean.toFixed(1), data: avg.map(() => Math.round(mean * 10) / 10), borderColor: '#14D3A9', borderDash: [4, 3], borderWidth: 1.4, pointRadius: 0, order: 1 },
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh', { beginAtZero: true }) }, plugins: { legend: _muLegend() } }) }, 'fr-spot-monthly');
    const cur = avg[avg.length - 1];
    const rank = avg.slice(0, -1).filter(v => v < cur).length / Math.max(1, avg.length - 1);
    return { sub: `${MU_MON[+months[months.length - 1].slice(5) - 1]} ${months[months.length - 1].slice(0, 4)} so far: ${cur.toFixed(1)} €/MWh · ${rank > .75 ? 'high' : rank < .25 ? 'low' : 'average'} · ${cur - mean >= 0 ? '+' : ''}${(cur - mean).toFixed(1)} vs 12-month mean` };
  },
});

_muReg({
  id: 'fr-spot-30d', title: 'France spot · last 30 days', category: 'prices', pageCanvas: 'mu-sp30', source: 'ENTSO-E',
  desc: 'Daily French day-ahead baseload over the last 30 delivery days with the 30-day mean.',
  async draw(cid) {
    const rows = (await _muFrDaily()).slice(-30);
    if (!rows.length) { noDataMsg(cid, 'Price history not available', ''); return null; }
    const v = rows.map(r => r[1]), mean = _muMean(v);
    _fuelChart(cid, { type: 'line', data: { labels: rows.map(r => _muDay(r[0])), datasets: [
      { label: 'Daily baseload', data: v, borderColor: '#14D3A9', backgroundColor: 'rgba(20,211,169,.10)', fill: true, borderWidth: 2, pointRadius: 2.5, tension: .35 },
      { label: '30-day mean ' + mean.toFixed(1), data: v.map(() => Math.round(mean * 10) / 10), borderColor: 'rgba(226,232,240,.6)', borderDash: [4, 3], borderWidth: 1.2, pointRadius: 0 },
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 10, maxRotation: 0 } }), y: _fuelAxis('€/MWh') }, plugins: { legend: _muLegend() } }) }, 'fr-spot-30d');
    const last = rows[rows.length - 1];
    return { sub: `Last session ${_muDay(last[0])}: ${last[1].toFixed(1)} €/MWh · 30-day mean ${mean.toFixed(1)} · range ${Math.min(...v).toFixed(0)} → ${Math.max(...v).toFixed(0)}` };
  },
});

// Day card: average, change, cheapest / most expensive hour and 3-hour windows, curve with bands.
if (window.PKW) PKW.register({
  id: 'fr-spot-day', kind: 'html', title: 'France spot · day profile', category: 'prices', page: 'marketupdate', source: 'ENTSO-E', size: { w: 6, h: 7 },
  desc: 'One delivery day of French day-ahead prices: average and change, cheapest and most expensive hour, cheapest and dearest 3-hour windows.',
  params: [{ key: 'day', label: 'Day', options: [['latest', 'Latest delivery day'], ['previous', 'Day before']] }], defaults: { day: 'latest' },
  titleFn: p => 'France spot · ' + (p.day === 'previous' ? 'previous day' : 'latest day'),
  async html(host, p) {
    const t = _muToday();
    let d = null;
    for (const c of [_muAdd(t, 1), t, _muAdd(t, -1)]) { const j = await _muGet('d' + c, 'history/daily/' + c + '.json'); if (j && j.zones && j.zones.FR && j.zones.FR.hourly) { d = c; break; } }
    if (!d) { host.innerHTML = '<div class="fuel-note">No French prices.</div>'; return; }
    if (p.day === 'previous') d = _muAdd(d, -1);
    const [J, P] = await Promise.all([_muGet('d' + d, 'history/daily/' + d + '.json'), _muGet('d' + _muAdd(d, -1), 'history/daily/' + _muAdd(d, -1) + '.json')]);
    const q = J && J.zones && J.zones.FR && J.zones.FR.hourly, qp = P && P.zones && P.zones.FR && P.zones.FR.hourly;
    if (!q) { host.innerHTML = '<div class="fuel-note">No French prices for ' + d + '.</div>'; return; }
    const per = q.length / 24, h = Array.from({ length: 24 }, (_, i) => _muMean(q.slice(i * per, (i + 1) * per)));
    const avg = _muMean(q), avgP = qp ? _muMean(qp) : null, chg = avgP ? (avg / avgP - 1) * 100 : null;
    let lo = 0, hi = 0; h.forEach((v, i) => { if (v < h[lo]) lo = i; if (v > h[hi]) hi = i; });
    const win = sign => { let b = 0, bv = null; for (let i = 0; i <= 21; i++) { const m = (h[i] + h[i + 1] + h[i + 2]) / 3; if (bv == null || sign * m > sign * bv) { bv = m; b = i; } } return b; };
    const wl = win(-1), wh = win(1);
    const cid = 'mu-day-' + Math.random().toString(36).slice(2, 8);
    const dl = new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    host.innerHTML = `<div class="mu-day"><div class="mu-day-h"><div><div class="mu-day-t">${dl}</div><div class="mu-day-avg">${avg.toFixed(2)}<small> €/MWh</small></div></div>
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
  id: 'news-latest', kind: 'html', title: 'Energy news · latest', category: 'intel', page: 'marketupdate', source: 'News feeds', size: { w: 6, h: 6 },
  desc: 'The latest energy-market headlines (gas, power, carbon, geopolitics).',
  async html(host) {
    const j = await _muGet('news', 'news.json');
    const items = (j && (j.items || j.articles || j)) || [];
    const list = (Array.isArray(items) ? items : []).slice(0, 8);
    host.innerHTML = list.length ? '<ul class="mu-news">' + list.map(n => `<li><a href="${n.link || n.url || '#'}" target="_blank" rel="noopener">${(n.title || '').replace(/</g, '&lt;')}</a><span>${(n.source || '').replace(/</g, '&lt;')}${n.date || n.published ? ' · ' + String(n.date || n.published).slice(0, 10) : ''}</span></li>`).join('') + '</ul>' : '<div class="fuel-note">No news.</div>';
  },
});

async function renderMarketUpdate() {
  const sub = (id, r) => { const e = document.getElementById(id); if (e && r && r.sub) e.textContent = r.sub; };
  ['precip', 'solar', 'wind', 'temp'].forEach(s => PKW.draw('wx-outlook', 'mu-out-' + s, { series: s }).then(r => sub('mu-out-' + s + '-sub', r)));
  PKW.draw('nuc-monthly-years', 'mu-nuc', {}).then(r => sub('mu-nuc-sub', r));
  PKW.draw('gas-storage-years', 'mu-gas', {}).then(r => sub('mu-gas-sub', r));
  PKW.draw('fr-load-normal', 'mu-load', {}).then(r => sub('mu-load-sub', r));
  PKW.draw('fuel-coal-oil', 'mu-oil', {});
  PKW.draw('fr-cal-history', 'mu-cal', { win: '3M' }).then(r => sub('mu-cal-sub', r));
  PKW.draw('fr-cal-drivers', 'mu-drivers', { win: '6M' }).then(r => sub('mu-drivers-sub', r));
  PKW.draw('fr-spot-monthly', 'mu-spm', {}).then(r => sub('mu-spm-sub', r));
  PKW.draw('fr-spot-30d', 'mu-sp30', {}).then(r => sub('mu-sp30-sub', r));
  const d1 = document.getElementById('mu-day-latest'), d0 = document.getElementById('mu-day-prev');
  if (d1) PKW.get('fr-spot-day').html(d1, { day: 'latest' });
  if (d0) PKW.get('fr-spot-day').html(d0, { day: 'previous' });
  const nw = document.getElementById('mu-news'); if (nw) PKW.get('news-latest').html(nw, {});
}

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
