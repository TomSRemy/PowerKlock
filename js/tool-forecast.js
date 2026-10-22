// ════════════════════════════════════════════════════════════════════
// TOOLS › PRODUCTION FORECAST — solar or wind, from coordinates only
//   weather   Open-Meteo forecast (best model, 16 days, hourly, Paris clock)
//             + GFS ensemble (31 members) for the P10–P90 band
//   solar     irradiance on the panel plane (tilt, azimuth) → DC power with
//             the cell temperature (NOCT 45 °C, −0.4 %/°C), minus losses,
//             clipped at the capacity
//   wind      wind at hub height (80 / 120 / 180 m interpolated; ensemble:
//             100 m with a 0.14 shear) → generic power curve of the turbine
//             class chosen (low, medium, high wind), minus losses
//   market    today and tomorrow: production × day-ahead price of the zone
//             (when published), revenue, capture price, hours ≤ 0 €
// No calibration on a real site yet: a generic model, flagged as such.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const S = { tech: 'solar', lat: 49.44, lon: 1.10, mw: 10, tilt: 30, az: 0, lossS: 14, hub: 120, cls: 'medium', lossW: 12, zone: 'FR' };
  try { Object.assign(S, JSON.parse(localStorage.getItem('pk-fcst') || '{}')); } catch (_) {}
  const save = () => { try { localStorage.setItem('pk-fcst', JSON.stringify(S)); } catch (_) {} };
  const f1 = v => v == null || !isFinite(v) ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const f0 = v => v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-GB');
  const f2 = v => v == null || !isFinite(v) ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const q = (a, p) => { const v = a.filter(x => x != null).sort((x, y) => x - y); if (!v.length) return null; const r = p * (v.length - 1), lo = Math.floor(r), hi = Math.ceil(r); return v[lo] + (v[hi] - v[lo]) * (r - lo); };

  // generic power curves, share of rated power at 0, 1, … 25 m/s (cut-out above 25)
  const CURVES = {
    low:    [0, 0, 0, .02, .06, .13, .23, .37, .54, .72, .88, .97, 1],
    medium: [0, 0, 0, .015, .045, .10, .18, .29, .43, .59, .75, .88, .96, 1],
    high:   [0, 0, 0, .01, .035, .08, .14, .23, .34, .47, .61, .74, .85, .93, .98, 1],
  };
  const CLS_T = { low: 'low-wind class (large rotor, rated ≈ 12 m/s)', medium: 'medium-wind class (rated ≈ 13 m/s)', high: 'high-wind class (rated ≈ 15 m/s)' };
  function curve(v, cls) {
    if (v == null || v < 0) return null;
    if (v >= 25) return 0;
    const c = CURVES[cls] || CURVES.medium, i = Math.floor(v);
    if (i >= c.length - 1) return 1;
    return c[i] + (c[i + 1] - c[i]) * (v - i);
  }
  const solarMW = (gti, t) => {
    if (gti == null) return null;
    const tc = (t == null ? 15 : t) + gti * (45 - 20) / 800;
    return Math.max(0, Math.min(S.mw, S.mw * gti / 1000 * (1 - 0.004 * (tc - 25)) * (1 - S.lossS / 100)));
  };
  const windMW = v => { const c = curve(v, S.cls); return c == null ? null : S.mw * c * (1 - S.lossW / 100); };
  // wind at hub height from the 80 / 120 / 180 m levels (log-height interpolation)
  function hubWind(h, i) {
    const L = [[80, h.wind_speed_80m], [120, h.wind_speed_120m], [180, h.wind_speed_180m]].filter(x => x[1] && x[1][i] != null);
    if (!L.length) return h.wind_speed_100m ? h.wind_speed_100m[i] * Math.pow(S.hub / 100, 0.14) : null;
    if (S.hub <= L[0][0]) return L[0][1][i] * Math.pow(S.hub / L[0][0], 0.14);
    for (let k = 0; k < L.length - 1; k++) {
      const [z0, a] = L[k], [z1, b] = L[k + 1];
      if (S.hub <= z1) { const t = Math.log(S.hub / z0) / Math.log(z1 / z0); return a[i] + (b[i] - a[i]) * t; }
    }
    const [zl, a] = L[L.length - 1]; return a[i] * Math.pow(S.hub / zl, 0.14);
  }

  async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error('weather service ' + r.status); return r.json(); }
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const addDay = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  async function dayPrices(iso, zone) {
    try {
      const r = await fetch(DATA_BASE + 'history/daily/' + iso + '.json', { cache: 'no-cache' }); if (!r.ok) return null;
      const j = await r.json(), a = j.zones && j.zones[zone] && j.zones[zone].hourly;
      if (!Array.isArray(a) || !a.some(v => v != null)) return null;
      const k = a.length / 24; return Array.from({ length: 24 }, (_, h) => { const v = a.slice(h * k, h * k + k).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; });
    } catch (_) { return null; }
  }

  async function run() {
    const st = $('fc-status'); if (st) st.textContent = 'Fetching the weather forecast…';
    save();
    const base = `latitude=${S.lat}&longitude=${S.lon}&timezone=Europe%2FParis&wind_speed_unit=ms&forecast_days=16`;
    const det = S.tech === 'solar'
      ? `https://api.open-meteo.com/v1/forecast?${base}&past_days=2&hourly=global_tilted_irradiance,shortwave_radiation,temperature_2m&tilt=${S.tilt}&azimuth=${S.az}`
      : `https://api.open-meteo.com/v1/forecast?${base}&past_days=2&hourly=wind_speed_80m,wind_speed_100m,wind_speed_120m,wind_speed_180m`;
    const ens = `https://ensemble-api.open-meteo.com/v1/ensemble?${base}&models=gfs_seamless&hourly=` + (S.tech === 'solar' ? 'shortwave_radiation,temperature_2m' : 'wind_speed_100m');
    let D, E;
    try { [D, E] = await Promise.all([getJSON(det), getJSON(ens).catch(() => null)]); }
    catch (e) { if (st) st.textContent = 'Weather forecast not available: ' + e.message; return; }
    const h = D.hourly, T = h.time, n = T.length;
    // central forecast (best model)
    const P = T.map((_, i) => S.tech === 'solar' ? solarMW(h.global_tilted_irradiance[i], h.temperature_2m[i]) : windMW(hubWind(h, i)));
    // ensemble members on the same hours
    const band = { lo: new Array(n).fill(null), hi: new Array(n).fill(null) };
    if (E && E.hourly) {
      const eh = E.hourly, idx = new Map(eh.time.map((t, k) => [t, k]));
      const key = S.tech === 'solar' ? 'shortwave_radiation' : 'wind_speed_100m';
      const mem = Object.keys(eh).filter(k => k === key || k.startsWith(key + '_member'));
      T.forEach((t, i) => {
        const k = idx.get(t); if (k == null) return;
        const vals = mem.map(m => {
          const x = eh[m][k]; if (x == null) return null;
          if (S.tech === 'solar') {
            const ghi = h.shortwave_radiation[i], gti = h.global_tilted_irradiance[i];
            const ratio = ghi > 20 ? gti / ghi : 1;
            return solarMW(x * ratio, eh.temperature_2m ? eh.temperature_2m[k] : h.temperature_2m[i]);
          }
          return windMW(x * Math.pow(S.hub / 100, 0.14));
        }).filter(v => v != null);
        // the ensemble gives the spread; it is centred on the best-model forecast (other model, other resolution)
        if (vals.length >= 5 && P[i] != null) {
          const m = q(vals, 0.5);
          band.lo[i] = Math.max(0, Math.min(S.mw, P[i] + q(vals, 0.10) - m));
          band.hi[i] = Math.max(0, Math.min(S.mw, P[i] + q(vals, 0.90) - m));
        }
      });
    }
    const now = new Date(), nowKey = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).format(now).replace(' ', 'T').slice(0, 13) + ':00';
    const iNow = T.indexOf(nowKey);
    render({ T, P, band, iNow });
    if (st) st.textContent = `${S.tech === 'solar' ? 'Solar' : 'Wind'} · ${f2(S.lat)}, ${f2(S.lon)} · ${f1(S.mw)} MW · forecast fetched ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })} · Open-Meteo (best model + GFS ensemble, 31 members)`;
  }

  function render(R) {
    const { T, P, band, iNow } = R, n = T.length;
    const t0 = today(), t1 = addDay(t0, 1);
    const dayOf = t => t.slice(0, 10);
    const sumDay = (arr, d) => arr.reduce((s, v, i) => s + (dayOf(T[i]) === d && v != null ? v : 0), 0);
    // daily energy (MWh): central and band
    const days = [...new Set(T.map(dayOf))];
    const daily = days.map(d => ({ d, p: sumDay(P, d), lo: sumDay(band.lo, d), hi: sumDay(band.hi, d), past: d < t0 }));
    const fut = daily.filter(x => !x.past);
    const wk = fut.slice(0, 7), e7 = wk.reduce((s, x) => s + x.p, 0), e7lo = wk.reduce((s, x) => s + x.lo, 0), e7hi = wk.reduce((s, x) => s + x.hi, 0);
    const dT = daily.find(x => x.d === t1) || {}, dN = daily.find(x => x.d === t0) || {};
    const cf7 = S.mw ? e7 / (S.mw * 24 * wk.length) : null;
    const kpi = $('fc-kpis');
    if (kpi) kpi.innerHTML = [
      _fuelKpi('Today', f1(dN.p), 'MWh', `band ${f1(dN.lo)}–${f1(dN.hi)} MWh`),
      _fuelKpi('Tomorrow', f1(dT.p), 'MWh', `band ${f1(dT.lo)}–${f1(dT.hi)} MWh`),
      _fuelKpi('Next 7 days', f0(e7), 'MWh', `band ${f0(e7lo)}–${f0(e7hi)} MWh`),
      _fuelKpi('Load factor, 7 days', cf7 == null ? '–' : (cf7 * 100).toFixed(1), '%', `${f1(S.mw)} MW`),
    ].join('');
    // hourly chart: 2 past days + 7 days ahead
    const iEnd = Math.min(n, T.findIndex(t => dayOf(t) === addDay(t0, 7)) > 0 ? T.findIndex(t => dayOf(t) === addDay(t0, 7)) : n);
    const sl = a => a.slice(0, iEnd).map(v => v == null ? null : Math.round(v * 100) / 100);
    const lbl = T.slice(0, iEnd).map(t => t.slice(11, 13) === '00' ? new Date(t.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', timeZone: 'UTC' }) : t.slice(11, 16));
    const col = S.tech === 'solar' ? '#F4C430' : '#14D3A9';
    _fuelChart('fc-hourly', { type: 'line', data: { labels: lbl, datasets: [
      { label: '_hi', data: sl(band.hi), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(127,200,248,.18)' },
      { label: 'P10–P90 (31 weather scenarios)', data: sl(band.lo), borderWidth: 0, pointRadius: 0, fill: false, backgroundColor: 'rgba(127,200,248,.18)' },
      { label: 'Forecast (best model)', data: sl(P), borderColor: col, backgroundColor: col, borderWidth: 2.2, pointRadius: 0, tension: .25, fill: false },
    ] }, options: _fuelOpts({ plugins: { pkFcZone: { from: Math.max(0, iNow), now: iNow, label: 'FORECAST' }, legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !/^_/.test(it.text) } } },
      scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0, callback: (v, i) => /^[A-Z]/.test(lbl[i]) ? lbl[i] : '' } }), y: _fuelAxis('MW', { beginAtZero: true }) } }) }, 'production-forecast-hourly');
    // daily chart, 16 days
    const DL = daily.map(x => new Date(x.d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }));
    _fuelChart('fc-daily', { type: 'bar', data: { labels: DL, datasets: [
      { label: 'Daily energy (MWh)', data: daily.map(x => +x.p.toFixed(1)), backgroundColor: daily.map(x => x.past ? 'rgba(122,147,171,.45)' : col + 'CC'), borderRadius: 3, order: 2 },
      { type: 'line', label: 'P90 (low)', data: daily.map(x => x.lo ? +x.lo.toFixed(1) : null), borderColor: 'rgba(127,200,248,.9)', borderDash: [4, 3], borderWidth: 1.4, pointRadius: 2, fill: false, order: 1 },
      { type: 'line', label: 'P10 (high)', data: daily.map(x => x.hi ? +x.hi.toFixed(1) : null), borderColor: 'rgba(237,105,101,.8)', borderDash: [4, 3], borderWidth: 1.4, pointRadius: 2, fill: false, order: 1 },
    ] }, options: _fuelOpts({ plugins: { pkFcZone: { from: daily.findIndex(x => !x.past), now: daily.findIndex(x => x.d === t0), nowLabel: 'today', label: 'FORECAST' }, legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } },
      scales: { x: _fuelXAxis(), y: _fuelAxis('MWh per day', { beginAtZero: true }) } }) }, 'production-forecast-daily');
    market(R, t0, t1);
  }

  async function market(R, t0, t1) {
    const host = $('fc-market'); if (!host) return;
    const { T, P } = R;
    const rows = [];
    for (const d of [t0, t1]) {
      const pr = await dayPrices(d, S.zone);
      const prod = Array.from({ length: 24 }, (_, hh) => { const i = T.indexOf(d + 'T' + String(hh).padStart(2, '0') + ':00'); return i >= 0 ? P[i] : null; });
      const E = prod.reduce((s, v) => s + (v || 0), 0);
      if (!pr) { rows.push({ d, E, none: true }); continue; }
      let rev = 0, neg = 0, negE = 0; prod.forEach((v, hh) => { if (v == null || pr[hh] == null) return; rev += v * pr[hh]; if (pr[hh] <= 0) { neg++; negE += v; } });
      const base = pr.filter(x => x != null).reduce((s, x) => s + x, 0) / pr.filter(x => x != null).length;
      rows.push({ d, E, rev, cap: E ? rev / E : null, base, neg, negE });
    }
    const name = d => d === t0 ? 'Today' : 'Tomorrow';
    host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Day</th><th>Production MWh</th><th>Day-ahead base €/MWh</th><th>Capture price €/MWh</th><th>Revenue €</th><th>Hours ≤ 0 €</th><th>Output in those hours MWh</th></tr></thead><tbody>` +
      rows.map(r => r.none ? `<tr><td style="text-align:left">${name(r.d)}</td><td>${f1(r.E)}</td><td colspan="5" style="text-align:left;color:var(--tx3)">day-ahead prices not published yet (around 13:00 the day before)</td></tr>`
        : `<tr><td style="text-align:left">${name(r.d)}</td><td>${f1(r.E)}</td><td>${f2(r.base)}</td><td><b>${f2(r.cap)}</b></td><td>${f0(r.rev)}</td><td>${r.neg}</td><td>${f1(r.negE)}${r.negE > 0 ? ' <span style="color:#ED6965">· curtail?</span>' : ''}</td></tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">Zone ${S.zone} · forecast production × the hourly day-ahead price of the zone. Hours at zero or negative prices: output there is paid nothing or costs money, the hours to curtail under a contract that allows it.</div>`;
  }

  function wire() {
    const page = $('page-fcst'); if (!page || page.dataset.wired) return; page.dataset.wired = '1';
    const ids = { 'fc-tech': 'tech', 'fc-lat': 'lat', 'fc-lon': 'lon', 'fc-mw': 'mw', 'fc-tilt': 'tilt', 'fc-az': 'az', 'fc-loss-s': 'lossS', 'fc-hub': 'hub', 'fc-cls': 'cls', 'fc-loss-w': 'lossW', 'fc-zone': 'zone' };
    Object.entries(ids).forEach(([id, k]) => { const e = $(id); if (!e) return; e.value = S[k]; e.addEventListener('change', () => { S[k] = e.type === 'number' ? +e.value : e.value; vis(); run(); }); });
    const pasteBox = $('fc-paste');
    if (pasteBox) pasteBox.addEventListener('change', () => { const m = pasteBox.value.match(/(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)/); if (m) { S.lat = +m[1].replace(',', '.'); S.lon = +m[2].replace(',', '.'); $('fc-lat').value = S.lat; $('fc-lon').value = S.lon; pasteBox.value = ''; run(); } });
    vis(); run();
  }
  function vis() {
    document.querySelectorAll('#page-fcst .fc-solar').forEach(e => { e.hidden = S.tech !== 'solar'; });
    document.querySelectorAll('#page-fcst .fc-wind').forEach(e => { e.hidden = S.tech !== 'wind'; });
    const m = $('fc-method'); if (m) m.innerHTML = S.tech === 'solar'
      ? `Irradiance on the panel plane (tilt ${S.tilt}°, azimuth ${S.az}°, 0 = south, −90 = east, 90 = west) from Open-Meteo, converted with the cell temperature (NOCT 45 °C, −0.4 % per °C above 25 °C), minus ${S.lossS} % losses (inverter, cabling, soiling), capped at the capacity. Band: spread of the 31 members of the GFS ensemble (10th to 90th percentile around their median), centred on the forecast.`
      : `Wind at ${S.hub} m interpolated between the 80, 120 and 180 m levels of Open-Meteo, through a generic power curve, ${CLS_T[S.cls]}, cut-out at 25 m/s, minus ${S.lossW} % losses (wake, availability, electrical). Band: spread of the 31 members of the GFS ensemble (100 m wind, 0.14 shear to hub height), centred on the forecast.`;
  }
  window.addEventListener('load', () => setTimeout(() => {
    const inner = window.showPage;
    if (typeof inner === 'function') window.showPage = function (id) { const r = inner.apply(this, arguments); if (id === 'fcst') wire(); return r; };
    if (document.querySelector('#page-fcst.active')) wire();
  }, 0));
  window.PKFcst = { run, state: S };
})();
