// ════════════════════════════════════════════════════════════════════
// WEATHER & DEGREE DAYS — Open-Meteo (free, keyless, CORS-enabled)
//   forecast API: hourly + daily, 7 days back / 14 days ahead (92 back for HDD)
//   archive API : daily mean temperature since 2016 for the normals
// Country values are population-weighted averages over the main load
// centres (metro-area population, millions), the usual proxy for
// temperature-driven demand.
// ════════════════════════════════════════════════════════════════════
const WX_CITIES = {
  FR: [['Paris', 48.86, 2.35, 12.3], ['Lyon', 45.76, 4.84, 2.3], ['Marseille', 43.30, 5.37, 1.9], ['Lille', 50.63, 3.06, 1.5],
       ['Toulouse', 43.60, 1.44, 1.5], ['Bordeaux', 44.84, -0.58, 1.4], ['Nantes', 47.22, -1.55, 1.0], ['Strasbourg', 48.57, 7.75, 0.8]],
  DE: [['Berlin', 52.52, 13.40, 6.1], ['Ruhr / Cologne', 50.94, 6.96, 3.6], ['Hamburg', 53.55, 9.99, 3.3], ['Munich', 48.14, 11.58, 2.9],
       ['Stuttgart', 48.78, 9.18, 2.8], ['Frankfurt', 50.11, 8.68, 2.7], ['Leipzig', 51.34, 12.37, 1.1]],
  ES: [['Madrid', 40.42, -3.70, 6.8], ['Barcelona', 41.39, 2.17, 5.6], ['Valencia', 39.47, -0.38, 1.9], ['Seville', 37.39, -5.98, 1.5],
       ['Bilbao', 43.26, -2.93, 1.0], ['Zaragoza', 41.65, -0.89, 0.8]],
  BE: [['Brussels', 50.85, 4.35, 2.1], ['Antwerp', 51.22, 4.40, 1.1], ['Ghent', 51.05, 3.72, 0.6], ['Liège', 50.63, 5.57, 0.6]],
  NL: [['Amsterdam', 52.37, 4.90, 2.5], ['Rotterdam', 51.92, 4.48, 1.8], ['The Hague', 52.07, 4.30, 1.1], ['Utrecht', 52.09, 5.12, 0.9], ['Eindhoven', 51.44, 5.47, 0.8]],
  IT: [['Milan', 45.46, 9.19, 4.3], ['Rome', 41.90, 12.50, 4.3], ['Naples', 40.85, 14.27, 3.0], ['Turin', 45.07, 7.69, 2.2], ['Palermo', 38.12, 13.36, 1.2], ['Bologna', 44.49, 11.34, 1.0]],
  GB: [['London', 51.51, -0.13, 9.6], ['Birmingham', 52.49, -1.89, 2.9], ['Manchester', 53.48, -2.24, 2.8], ['Leeds', 53.80, -1.55, 1.9], ['Glasgow', 55.86, -4.25, 1.8]],
};
const WX_NAMES = { FR: 'France', DE: 'Germany', ES: 'Spain', BE: 'Belgium', NL: 'Netherlands', IT: 'Italy', GB: 'Great Britain' };
const HDD_BASE = 18, CDD_BASE = 21;
const WX = { var: 'temp', cache: new Map() };

function _wxCoords(cc) { const c = WX_CITIES[cc]; return 'latitude=' + c.map(x => x[1]).join(',') + '&longitude=' + c.map(x => x[2]).join(','); }
function _wxGet(url) {
  if (!WX.cache.has(url)) WX.cache.set(url, fetch(url).then(r => r.ok ? r.json() : null).then(j => j == null ? null : (Array.isArray(j) ? j : [j])).catch(() => null));
  return WX.cache.get(url);
}
function _wxForecast(cc, pastDays) {
  return _wxGet('https://api.open-meteo.com/v1/forecast?' + _wxCoords(cc) +
    '&hourly=temperature_2m,wind_speed_100m,shortwave_radiation,precipitation' +
    '&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,shortwave_radiation_sum' +
    '&past_days=' + pastDays + '&forecast_days=14&timezone=Europe%2FParis&wind_speed_unit=ms');
}
// 10-year archive = heavy request for Open-Meteo's quota: keep one copy per
// country per day in localStorage (best effort, page works without it).
async function _wxArchive(cc) {
  const end = _renAdd(pkTodayISO(), -6), key = 'pk-wx-arch-' + cc;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && c.end === end && Array.isArray(c.data)) return c.data;
  } catch (_) {}
  const data = await _wxGet('https://archive-api.open-meteo.com/v1/archive?' + _wxCoords(cc) +
    '&start_date=2016-01-01&end_date=' + end + '&daily=temperature_2m_mean&timezone=Europe%2FParis');
  if (data) {
    try {
      const slim = data.map(r => ({ daily: { time: r.daily.time, temperature_2m_mean: r.daily.temperature_2m_mean } }));
      localStorage.setItem(key, JSON.stringify({ end, data: slim }));
    } catch (_) {}
  }
  return data;
}
// Population-weighted average of one series across cities (null-safe).
function _wxWeighted(res, cc, pick) {
  const c = WX_CITIES[cc], n = pick(res[0]).length;
  const out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    let s = 0, w = 0;
    res.forEach((r, k) => { const v = pick(r)[i]; if (v != null) { s += v * c[k][3]; w += c[k][3]; } });
    out[i] = w ? s / w : null;
  }
  return out;
}
const _hdd = t => t == null ? null : Math.max(0, HDD_BASE - t);
const _cdd = t => t == null ? null : Math.max(0, t - CDD_BASE);

function setWxVar(v, btn) {
  WX.var = v;
  document.querySelectorAll('#wx-var-btns .day-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadWeather();
}

// ── Page 1 · Energy weather ──────────────────────────────────────────
async function loadWeather() {
  const cc = (document.getElementById('wx-country') || {}).value || 'FR';
  const res = await _wxForecast(cc, 7);
  if (!res) { document.getElementById('wx-kpis').innerHTML = '<div class="fuel-note">Open-Meteo unavailable.</div>'; return; }
  const cities = WX_CITIES[cc], today = pkTodayISO();
  const H = res[0].hourly.time, D = res[0].daily.time;
  const nowKey = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 13).replace(' ', 'T') + ':00';
  const nowI = Math.max(0, H.indexOf(nowKey));
  const di = D.indexOf(today);
  const wT = _wxWeighted(res, cc, r => r.hourly.temperature_2m);
  const wW = _wxWeighted(res, cc, r => r.hourly.wind_speed_100m);
  const wR = _wxWeighted(res, cc, r => r.hourly.shortwave_radiation);
  const dMean = _wxWeighted(res, cc, r => r.daily.temperature_2m_mean);
  const next7 = dMean.slice(di + 1, di + 8).filter(v => v != null);
  const prev7 = dMean.slice(Math.max(0, di - 7), di).filter(v => v != null);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const f1 = v => v == null ? '–' : v.toFixed(1);
  document.getElementById('wx-upd').textContent = 'Open-Meteo · ' + WX_NAMES[cc];
  document.getElementById('wx-kpis').innerHTML =
    _fuelKpi('Temperature now', f1(wT[nowI]), '°C', 'population-weighted · ' + H[nowI].slice(11, 16)) +
    _fuelKpi('Today mean', f1(dMean[di]), '°C', `HDD ${f1(_hdd(dMean[di]))} · CDD ${f1(_cdd(dMean[di]))}`) +
    _fuelKpi('Next 7 days', f1(avg(next7)), '°C', prev7.length ? `${_fuelSigned(avg(next7) - avg(prev7), 1)} °C vs last 7 days` : '',
      prev7.length ? (avg(next7) < avg(prev7) ? 'down' : 'up') : null) +
    _fuelKpi('Wind 100 m now', f1(wW[nowI]), 'm/s', 'weighted over cities') +
    _fuelKpi('Radiation now', wR[nowI] == null ? '–' : Math.round(wR[nowI]), 'W/m²', 'shortwave, weighted') +
    _fuelKpi('Heating demand 14 d', Math.round(dMean.slice(di, di + 14).reduce((s, t) => s + (_hdd(t) || 0), 0)), 'HDD', 'today + 13 days, base 18 °C');

  PKW.draw('wx-forecast', 'wx-forecast-canvas', { cc, v: WX.var });
  document.getElementById('wx-forecast-canvas-title').textContent = WX_VARS[WX.var].label + ' · ' + WX_NAMES[cc];

  // City table (today)
  const totW = cities.reduce((s, c) => s + c[3], 0);
  document.getElementById('wx-table-title').textContent = `Cities — ${_renFmtDay(today)}`;
  document.getElementById('wx-city-tbody').innerHTML = res.map((r, k) => {
    const d = r.daily, mean = d.temperature_2m_mean[di];
    const wMax = r.hourly.wind_speed_100m.slice(di * 24, di * 24 + 24).filter(v => v != null);
    return `<tr><td>${cities[k][0]}</td><td>${(cities[k][3] / totW * 100).toFixed(0)}%</td><td>${f1(r.hourly.temperature_2m[nowI])}</td>` +
      `<td>${f1(d.temperature_2m_min[di])} / ${f1(d.temperature_2m_max[di])}</td><td>${f1(mean)}</td>` +
      `<td>${wMax.length ? (wMax.reduce((a, b) => a + b, 0) / wMax.length).toFixed(1) : '–'}</td>` +
      `<td>${d.shortwave_radiation_sum[di] == null ? '–' : (d.shortwave_radiation_sum[di] / 3.6).toFixed(2)}</td><td>${f1(d.precipitation_sum[di])}</td><td>${f1(_hdd(mean))}</td></tr>`;
  }).join('');
  document.getElementById('wx-note').textContent = 'Weights = metro-area population of each city. Wind = daily mean at 100 m (hub height). Radiation = daily shortwave sum. HDD base 18 °C on the daily mean. Model: Open-Meteo best match (ECMWF / DWD ICON / Météo-France blend).';
}

// ── Weather charts (page + dashboard) ───────────────────────────────
const WX_VARS = {
  temp: { key: 'temperature_2m', label: 'Temperature', unit: '°C' },
  wind: { key: 'wind_speed_100m', label: 'Wind speed at 100 m', unit: 'm/s' },
  radiation: { key: 'shortwave_radiation', label: 'Solar radiation', unit: 'W/m²' },
  precip: { key: 'precipitation', label: 'Precipitation', unit: 'mm/h' },
};
const WX_CC_PARAM = { key: 'cc', label: 'Country', inTitle: true, options: Object.keys(WX_NAMES).map(k => [k, WX_NAMES[k]]) };
function _wxReg(def) {
  if (!window.PKW) return;
  PKW.register(Object.assign({ category: 'weather', source: 'Open-Meteo', size: { w: 6, h: 5 } }, def));
}

_wxReg({
  id: 'wx-forecast', title: 'Weather forecast', page: 'wxcities', pageCanvas: 'wx-forecast-canvas',
  desc: 'Hourly forecast, 7 days back and ahead: population-weighted country line and its main cities.',
  params: [WX_CC_PARAM, { key: 'v', label: 'Variable', inTitle: true, options: Object.keys(WX_VARS).map(k => [k, WX_VARS[k].label]) }],
  defaults: { cc: 'FR', v: 'temp' },
  async draw(cid, p) {
    const res = await _wxForecast(p.cc, 7);
    if (!res) { noDataMsg(cid, 'Open-Meteo unavailable', ''); return null; }
    const V = WX_VARS[p.v] || WX_VARS.temp, cities = WX_CITIES[p.cc], H = res[0].hourly.time;
    const nowKey = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 13).replace(' ', 'T') + ':00';
    const nowI = Math.max(0, H.indexOf(nowKey));
    const w = _wxWeighted(res, p.cc, r => r.hourly[V.key]);
    const pal = ['#7FC8F8', '#C4A57B', '#ED6965', '#A87DC4', '#FBBF24', '#94D2BD', '#F472B6', '#8D99AE'];
    const labels = H.map(t => t.slice(8, 10) + '/' + t.slice(5, 7) + ' ' + t.slice(11, 16));
    const ds = [{ label: WX_NAMES[p.cc] + ' (weighted)', data: w.map(v => v == null ? null : +v.toFixed(2)), borderColor: '#FFFFFF', borderWidth: 2.2, pointRadius: 0, tension: 0, fill: false, order: -1 }]
      .concat(res.map((r, k) => ({ label: cities[k][0], data: r.hourly[V.key], borderColor: rgba(pal[k % pal.length], .7), borderWidth: 1, pointRadius: 0, tension: 0, fill: false })));
    if (p.v === 'precip') ds.forEach(d => { d.type = 'bar'; d.backgroundColor = d.borderColor; });
    _fuelChart(cid, { type: 'line', data: { labels, datasets: ds }, options: _fuelOpts({
      scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 11, maxRotation: 0, callback: function (v) { const l = this.getLabelForValue(v); return l.slice(0, 5); } } }),
        y: _fuelAxis(V.unit, p.v === 'temp' ? {} : { beginAtZero: true }) },
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } }, zoom: ZOOM_CFG,
        annotation: { annotations: { now: { type: 'line', xMin: nowI, xMax: nowI, borderColor: 'rgba(255,253,130,.7)', borderWidth: 1.2, borderDash: [3, 3],
          label: { display: true, content: 'NOW', position: 'start', color: '#0A1218', backgroundColor: '#FFFD82', font: { size: 9, weight: '700' }, padding: { top: 1, bottom: 1, left: 5, right: 5 } } } } } } }) }, 'weather-' + p.cc + '-' + p.v);
  },
});

const HDD_BACK_PARAM = { key: 'back', label: 'History', options: [['30', '30 days'], ['60', '60 days'], ['90', '90 days'], ['180', '180 days'], ['365', '1 year']] };

// Daily weighted mean temperatures, normals and heating-season cumulatives of one country.
const _wxSeriesCache = new Map();
function _wxSeries(cc) {
  if (!_wxSeriesCache.has(cc)) _wxSeriesCache.set(cc, (async () => {
    const [fc, ar] = await Promise.all([_wxForecast(cc, 92), _wxArchive(cc)]);
    if (!fc || !ar) { WX.cache.clear(); _wxSeriesCache.delete(cc); return null; }   // allow a retry
    const today = pkTodayISO();
    // Archive (≤ today−6) then forecast API (92 d back + 14 ahead)
    const T = new Map();
    const aw = _wxWeighted(ar, cc, r => r.daily.temperature_2m_mean);
    ar[0].daily.time.forEach((d, i) => { if (aw[i] != null) T.set(d, aw[i]); });
    const fw = _wxWeighted(fc, cc, r => r.daily.temperature_2m_mean);
    fc[0].daily.time.forEach((d, i) => { if (fw[i] != null) T.set(d, fw[i]); });
    // Normal = mean of the same calendar day over 2016–2025
    const normal = md => { const v = []; for (let y = 2016; y <= 2025; y++) { const t = T.get(y + '-' + md); if (t != null) v.push(t); } return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const day = iso => ({ d: iso, t: T.get(iso), n: normal(iso.slice(5)) });
    const lastFc = fc[0].daily.time[fc[0].daily.time.length - 1];
    const series = []; for (let d = _renAdd(today, -60); d <= lastFc; d = _renAdd(d, 1)) series.push(day(d));
    // Heating season (Sep 1 → today) and the previous one
    const sStart = (today.slice(5) >= '09-01' ? today.slice(0, 4) : String(+today.slice(0, 4) - 1)) + '-09-01';
    const cum = (from, to, f) => { const out = []; let c = 0; for (let d = from; d <= to; d = _renAdd(d, 1)) { const v = f(d); if (v != null) c += v; out.push({ d, c }); } return out; };
    const seasonEnd = lastFc < _renAdd(sStart, 272) ? lastFc : _renAdd(sStart, 272);
    const curCum = cum(sStart, seasonEnd, d => _hdd(T.get(d)));
    const prevStart = (+sStart.slice(0, 4) - 1) + '-09-01';
    const prevCum = cum(prevStart, _renAdd(prevStart, curCum.length - 1), d => _hdd(T.get(d)));
    const normCum = cum(sStart, seasonEnd, d => _hdd(normal(d.slice(5))));
    return { today, T, normal, day, series, lastFc, sStart, curCum, prevCum, normCum };
  })());
  return _wxSeriesCache.get(cc);
}

_wxReg({
  id: 'hdd', title: 'Heating degree days', page: 'wxhdd', pageCanvas: 'hdd-canvas',
  desc: 'Daily HDD of the past days and the 14-day forecast, against the 2016–2025 normal.',
  params: [WX_CC_PARAM, HDD_BACK_PARAM], defaults: { cc: 'FR', back: '60' },
  async draw(cid, p) {
    const S = await _wxSeries(p.cc);
    if (!S) { noDataMsg(cid, 'Open-Meteo did not respond', 'Rate limit or network; retry later.'); return null; }
    const today = S.today, series = [];
    for (let d = _renAdd(today, -(+p.back || 60)); d <= S.lastFc; d = _renAdd(d, 1)) series.push(S.day(d));
    const nowIdx = series.findIndex(x => x.d === today);
    _fuelChart(cid, { type: 'bar', data: { labels: series.map(x => x.d.slice(8, 10) + '/' + x.d.slice(5, 7)), datasets: [
      { label: 'HDD (actual / forecast)', data: series.map(x => x.t == null ? null : +_hdd(x.t).toFixed(2)), backgroundColor: series.map(x => x.d > today ? rgba('#7FC8F8', .45) : rgba('#7FC8F8', .85)), borderRadius: 2 },
      { label: 'Normal 2016–2025', data: series.map(x => x.n == null ? null : +_hdd(x.n).toFixed(2)), type: 'line', borderColor: '#FBBF24', borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, fill: false, tension: 0 },
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 } }), y: _fuelAxis('HDD', { beginAtZero: true }) },
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
        annotation: { annotations: nowIdx >= 0 ? { now: { type: 'line', xMin: nowIdx, xMax: nowIdx, borderColor: 'rgba(255,253,130,.7)', borderWidth: 1.2, borderDash: [3, 3] } } : {} } } }) }, 'hdd-daily-' + p.cc);
  },
});

_wxReg({
  id: 'hdd-cum', title: 'Heating season, cumulative HDD', page: 'wxhdd', pageCanvas: 'hdd-cum',
  desc: 'HDD accumulated since 1 September against the normal and the previous season.',
  params: [WX_CC_PARAM], defaults: { cc: 'FR' },
  async draw(cid, p) {
    const S = await _wxSeries(p.cc);
    if (!S) { noDataMsg(cid, 'Open-Meteo did not respond', 'Rate limit or network; retry later.'); return null; }
    const { curCum, prevCum, normCum, sStart, today } = S;
    _fuelChart(cid, { type: 'line', data: { labels: curCum.map(x => x.d.slice(8, 10) + '/' + x.d.slice(5, 7)), datasets: [
      _fuelLineDs('Season ' + sStart.slice(0, 4) + '/' + String(+sStart.slice(0, 4) + 1).slice(2), curCum.map(x => x.d <= today ? +x.c.toFixed(1) : null), '#7FC8F8', { borderWidth: 2 }),
      _fuelLineDs('Forecast', curCum.map(x => x.d >= today ? +x.c.toFixed(1) : null), '#7FC8F8', { borderDash: [5, 4], borderWidth: 1.5 }),
      _fuelLineDs('Normal', normCum.map(x => +x.c.toFixed(1)), '#FBBF24', { borderDash: [4, 3], borderWidth: 1.3 }),
      _fuelLineDs('Previous season', prevCum.map(x => +x.c.toFixed(1)), C_TX3, { borderWidth: 1.2 }),
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 10, maxRotation: 0 } }), y: _fuelAxis('cumulative HDD', { beginAtZero: true }) } }) }, 'hdd-season-' + p.cc);
  },
});

// ── Page 2 · Degree days ─────────────────────────────────────────────
async function renderHDD() {
  const cc = (document.getElementById('hdd-country') || {}).value || 'FR';
  const kp = document.getElementById('hdd-kpis');
  if (!kp.innerHTML.trim()) kp.innerHTML = '<div class="fuel-note" style="grid-column:1/-1"><span class="spinner"></span> Loading weather history and 2016–2025 normals…</div>';
  const S = await _wxSeries(cc);
  if (!S) {
    kp.innerHTML = '<div class="fuel-note" style="grid-column:1/-1">Open-Meteo did not respond (rate limit or network). Change country or reload to retry.</div>';
    return;
  }
  const { today, T, day, series, curCum, prevCum, normCum } = S;
  const at = (arr, d) => { const r = arr.find(x => x.d === d); return r ? r.c : null; };
  const toDate = at(curCum, today), normTo = at(normCum, today), prevTo = prevCum[curCum.findIndex(x => x.d === today)];
  const mtd = series.filter(x => x.d.slice(0, 7) === today.slice(0, 7) && x.d <= today);
  const mtdH = mtd.reduce((s, x) => s + (_hdd(x.t) || 0), 0), mtdN = mtd.reduce((s, x) => s + (_hdd(x.n) || 0), 0);
  const next = series.filter(x => x.d > today).slice(0, 14);
  const nH = next.reduce((s, x) => s + (_hdd(x.t) || 0), 0), nN = next.reduce((s, x) => s + (_hdd(x.n) || 0), 0);
  const yCDD = [...T.entries()].filter(([d]) => d.slice(0, 4) === today.slice(0, 4) && d <= today).reduce((s, [, t]) => s + (_cdd(t) || 0), 0);
  const pct = (a, b) => b ? (a / b - 1) * 100 : null;
  const tone = v => v == null ? null : v > 0 ? 'down' : 'up';   // more heating = more demand (red)
  const td = day(today);
  document.getElementById('hdd-upd').textContent = 'Open-Meteo · ' + WX_NAMES[cc];
  document.getElementById('hdd-kpis').innerHTML =
    _fuelKpi('Today', td.t == null ? '–' : _hdd(td.t).toFixed(1), 'HDD', td.t == null ? '' : `mean ${td.t.toFixed(1)} °C · normal ${td.n.toFixed(1)} °C`) +
    _fuelKpi('Month to date', mtdH.toFixed(0), 'HDD', mtdN ? `${_fuelSigned(pct(mtdH, mtdN), 0)}% vs normal (${mtdN.toFixed(0)})` : '', tone(pct(mtdH, mtdN))) +
    _fuelKpi('Season to date', toDate == null ? '–' : toDate.toFixed(0), 'HDD', normTo ? `${_fuelSigned(pct(toDate, normTo), 0)}% vs normal · since 1 Sep` : '', tone(pct(toDate, normTo))) +
    _fuelKpi('vs last season', prevTo && toDate != null ? _fuelSigned(toDate - prevTo.c, 0) : '–', 'HDD', prevTo ? `same date ${prevTo.d.slice(0, 4)}: ${prevTo.c.toFixed(0)}` : '') +
    _fuelKpi('Next 14 days', nH.toFixed(0), 'HDD', nN ? `${_fuelSigned(pct(nH, nN), 0)}% vs normal (${nN.toFixed(0)})` : '', tone(pct(nH, nN))) +
    _fuelKpi('Cooling YTD', yCDD.toFixed(0), 'CDD', 'base 21 °C, since 1 Jan');

  const hb = window._hddBack || '60';
  PKW.draw('hdd', 'hdd-canvas', { cc, back: hb });
  PKW.periodButtons('hdd-canvas', HDD_BACK_PARAM.options.map(o => [o[0], o[0] === '365' ? '1Y' : o[0] + 'D']), hb, v => { window._hddBack = v; PKW.draw('hdd', 'hdd-canvas', { cc, back: v }); });
  PKW.draw('hdd-cum', 'hdd-cum', { cc });

  // Weekly table (ISO weeks, last 8 + forecast)
  const weeks = {};
  series.forEach(x => {
    const dt = new Date(x.d + 'T12:00:00Z'), wd = (dt.getUTCDay() + 6) % 7, mon = _renAdd(x.d, -wd);
    (weeks[mon] = weeks[mon] || []).push(x);
  });
  document.getElementById('hdd-tbody').innerHTML = Object.keys(weeks).sort().reverse().slice(0, 10).map(m => {
    const w = weeks[m].filter(x => x.t != null);
    if (!w.length) return '';
    const mt = w.reduce((s, x) => s + x.t, 0) / w.length, mn = w.reduce((s, x) => s + (x.n || 0), 0) / w.length;
    const h = w.reduce((s, x) => s + _hdd(x.t), 0), hn = w.reduce((s, x) => s + (_hdd(x.n) || 0), 0), c = w.reduce((s, x) => s + _cdd(x.t), 0);
    const p = hn ? (h / hn - 1) * 100 : null, fut = m > today ? ' <span style="color:var(--text3)">(fcst)</span>' : (_renAdd(m, 6) > today ? ' <span style="color:var(--text3)">(partial fcst)</span>' : '');
    return `<tr><td>w/c ${_renFmtDay(m)}${fut}</td><td>${mt.toFixed(1)}</td><td>${mn.toFixed(1)}</td><td>${h.toFixed(0)}</td><td>${hn.toFixed(0)}</td>` +
      `<td style="color:${p == null ? 'var(--text3)' : p > 0 ? 'var(--down)' : 'var(--up)'}">${p == null ? '–' : _fuelSigned(p, 0) + '%'}</td><td>${c.toFixed(1)}</td></tr>`;
  }).join('');
  document.getElementById('hdd-note').textContent = `HDD = max(0, 18 °C − daily mean), CDD = max(0, daily mean − 21 °C), on the population-weighted daily mean of ${WX_CITIES[cc].map(c => c[0]).join(', ')}. ` +
    'Normal = mean of the same calendar day 2016–2025 (Open-Meteo ERA5 archive); recent days and forecast from the Open-Meteo forecast API.';
}
