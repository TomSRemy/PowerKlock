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
//   improvements kept from the backtest on RTE regional data (scripts/
//   fcst_backtest.py, data/history/fcst_backtest.json): average of several
//   weather models, monthly solar correction learned on French production,
//   curtailment at prices ≤ 0, calibration on the site's own metered output
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const S = { tech: 'solar', lat: 49.44, lon: 1.10, mw: 10, tilt: 30, az: 0, lossS: 14, hub: 120, cls: 'medium', lossW: 12, zone: 'FR', calFr: true, curt: false, cal: {}, inj: '', p50: '', p50cache: {} };
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
    const cap = S.inj !== '' && +S.inj > 0 ? Math.min(S.mw, +S.inj) : S.mw;   // injection limit clips the output
    return Math.max(0, Math.min(cap, S.mw * gti / 1000 * (1 - 0.004 * (tc - 25)) * (1 - S.lossS / 100)));
  };
  // the site's own calibration (from its metered output), keyed by technology and coordinates
  const siteKey = () => `${S.tech}|${(+S.lat).toFixed(3)}|${(+S.lon).toFixed(3)}`;
  const siteCal = () => (S.cal || {})[siteKey()] || null;
  function windMW(v) {
    if (v == null) return null;
    const c = siteCal();
    if (c && c.bins) {   // empirical curve of the site: share of capacity by forecast wind speed (0.5 m/s bins)
      const b = Math.min(c.bins.length - 1, Math.max(0, Math.floor(v * 2)));
      let k = b; while (k > 0 && c.bins[k] == null) k--;
      return S.mw * (c.bins[k] == null ? 0 : c.bins[k]);
    }
    const r = curve(v, S.cls); return r == null ? null : S.mw * r * (1 - S.lossW / 100);
  }
  let CAL = null, LAST_ACT = null, ERA = null;
  const calFr = () => CAL || (CAL = fetch(DATA_BASE + 'history/fcst_calib.json').then(r => r.ok ? r.json() : null).catch(() => null));
  const OTHER = { solar: ['meteofrance_seamless', 'icon_seamless', 'gfs_seamless'], wind: ['icon_seamless', 'gfs_seamless'] };
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
    const oth = `https://api.open-meteo.com/v1/forecast?${base}&past_days=2&models=${OTHER[S.tech].join(',')}&hourly=` + (S.tech === 'solar' ? `global_tilted_irradiance&tilt=${S.tilt}&azimuth=${S.az}` : 'wind_speed_100m');
    let D, E, O, C;
    try { [D, E, O, C] = await Promise.all([getJSON(det), getJSON(ens).catch(() => null), getJSON(oth).catch(() => null), calFr()]); }
    catch (e) { if (st) st.textContent = 'Weather forecast not available: ' + e.message; return; }
    const h = D.hourly, T = h.time, n = T.length;
    // central forecast: average of the weather models available for the hour (best model + Météo-France, ICON, GFS)
    const oh = O && O.hourly, oIdx = oh ? new Map(oh.time.map((t, k) => [t, k])) : null;
    let nModels = 1;
    const P = T.map((t, i) => {
      const own = S.tech === 'solar' ? solarMW(h.global_tilted_irradiance[i], h.temperature_2m[i]) : windMW(hubWind(h, i));
      const vals = own == null ? [] : [own];
      if (oh) { const k = oIdx.get(t); if (k != null) OTHER[S.tech].forEach(m => {
        const x = oh[(S.tech === 'solar' ? 'global_tilted_irradiance_' : 'wind_speed_100m_') + m]; if (!x || x[k] == null) return;
        vals.push(S.tech === 'solar' ? solarMW(x[k], h.temperature_2m[i]) : windMW(x[k] * Math.pow(S.hub / 100, 0.14)));
      }); }
      nModels = Math.max(nModels, vals.length);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    // P50 entered (kWh/kWc a year): the level is set so the model's yield over last year matches it
    let p50k = null;
    if (S.tech === 'solar' && S.p50 !== '' && +S.p50 > 0 && !siteCal()) {
      const key = `${siteKey()}|${S.tilt}|${S.az}|${S.lossS}|${S.inj}`;
      if (S.p50cache[key] == null) {
        try {
          const y = new Date().getUTCFullYear() - 1;
          const A = (await getJSON(`https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${S.lat}&longitude=${S.lon}&timezone=Europe%2FParis&start_date=${y}-01-01&end_date=${y}-12-31&hourly=global_tilted_irradiance,temperature_2m&tilt=${S.tilt}&azimuth=${S.az}`)).hourly;
          let e = 0; A.time.forEach((t, i) => { const v = solarMW(A.global_tilted_irradiance[i], A.temperature_2m[i]); if (v != null) e += v * ((C && C.solar_month && C.solar_month[String(+t.slice(5, 7))]) || 1); });
          S.p50cache[key] = e / S.mw;   // kWh/kWc of the model over a full year
          save();
        } catch (_) {}
      }
      if (S.p50cache[key]) p50k = +S.p50 / S.p50cache[key];
    }
    // corrections: the site's own calibration first, else the monthly French solar correction
    const sc = siteCal(), fr = C && C.solar_month;
    const corr = t => S.tech !== 'solar' ? 1 : sc && sc.scale ? sc.scale : ((S.calFr && fr && fr[String(+t.slice(5, 7))]) || 1) * (p50k || 1);
    const capOut = S.inj !== '' && +S.inj > 0 ? Math.min(S.mw, +S.inj) : S.mw;
    T.forEach((t, i) => { if (P[i] != null) P[i] = Math.min(capOut, P[i] * corr(t)); });
    if (S.tech === 'wind' && sc && sc.scale) T.forEach((t, i) => { if (P[i] != null) P[i] = Math.min(S.mw, P[i] * sc.scale); });
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
          const c = corr(t);
          vals.forEach((v, j) => { vals[j] = v * c; });
          const m = q(vals, 0.5);
          band.lo[i] = Math.max(0, Math.min(S.mw, P[i] + q(vals, 0.10) - m));
          band.hi[i] = Math.max(0, Math.min(S.mw, P[i] + q(vals, 0.90) - m));
        }
      });
    }
    const now = new Date(), nowKey = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).format(now).replace(' ', 'T').slice(0, 13) + ':00';
    const iNow = T.indexOf(nowKey);
    render({ T, P, band, iNow });
    const calTxt = !sc && p50k ? `level set on the P50 entered (${S.p50} kWh/kWc, model ×${p50k.toFixed(2)})` : sc ? `calibrated on the site’s metered output (${sc.period}, error ${(sc.nmae0 * 100).toFixed(1)} → ${(sc.nmae1 * 100).toFixed(1)} % of capacity)` : S.tech === 'solar' && S.calFr ? 'monthly correction learned on French solar output' : 'generic model';
    if (st) st.textContent = `${S.tech === 'solar' ? 'Solar' : 'Wind'} · ${f2(S.lat)}, ${f2(S.lon)} · ${f1(S.mw)} MW · average of ${nModels} weather models · ${calTxt} · fetched ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}`;
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
      { label: 'Forecast (average of the weather models)', data: sl(P), borderColor: col, backgroundColor: col, borderWidth: 2.2, pointRadius: 0, tension: .25, fill: false },
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
      let rev = 0, neg = 0, negE = 0; prod.forEach((v, hh) => { if (v == null || pr[hh] == null) return; if (pr[hh] <= 0) { neg++; negE += v; if (S.curt) { const k = siteCal() && siteCal().curtRatio != null ? siteCal().curtRatio : 0; negE -= v * k; rev += v * k * pr[hh]; return; } } rev += v * pr[hh]; });
      const base = pr.filter(x => x != null).reduce((s, x) => s + x, 0) / pr.filter(x => x != null).length;
      const Ep = S.curt ? E - negE : E;
      rows.push({ d, E: Ep, rev, cap: Ep ? rev / Ep : null, base, neg, negE });
    }
    const name = d => d === t0 ? 'Today' : 'Tomorrow';
    host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Day</th><th>Production MWh</th><th>Day-ahead base €/MWh</th><th>Capture price €/MWh</th><th>Revenue €</th><th>Hours ≤ 0 €</th><th>Output in those hours MWh</th></tr></thead><tbody>` +
      rows.map(r => r.none ? `<tr><td style="text-align:left">${name(r.d)}</td><td>${f1(r.E)}</td><td colspan="5" style="text-align:left;color:var(--tx3)">day-ahead prices not published yet (around 13:00 the day before)</td></tr>`
        : `<tr><td style="text-align:left">${name(r.d)}</td><td>${f1(r.E)}</td><td>${f2(r.base)}</td><td><b>${f2(r.cap)}</b></td><td>${f0(r.rev)}</td><td>${r.neg}</td><td>${f1(r.negE)}${r.negE > 0 ? (S.curt ? ' <span style="color:var(--tx3)">· curtailed</span>' : ' <span style="color:#ED6965">· curtail?</span>') : ''}</td></tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">Zone ${S.zone} · forecast production × the hourly day-ahead price of the zone. Hours at zero or negative prices: output there is paid nothing or costs money, the hours to curtail under a contract that allows it.</div>`;
  }

  function wire() {
    const page = $('page-fcst'); if (!page || page.dataset.wired) return; page.dataset.wired = '1';
    const ids = { 'fc-inj': 'inj', 'fc-p50': 'p50', 'fc-tech': 'tech', 'fc-lat': 'lat', 'fc-lon': 'lon', 'fc-mw': 'mw', 'fc-tilt': 'tilt', 'fc-az': 'az', 'fc-loss-s': 'lossS', 'fc-hub': 'hub', 'fc-cls': 'cls', 'fc-loss-w': 'lossW', 'fc-zone': 'zone' };
    // sane ranges: a value outside is brought back to the nearest limit, and said so
    const RANGE = { lat: [-90, 90, 'latitude'], lon: [-180, 180, 'longitude'], mw: [0.01, 5000, 'capacity (MW)'], tilt: [0, 90, 'tilt (°)'], az: [-180, 180, 'azimuth (°)'],
      lossS: [0, 60, 'losses (%)'], lossW: [0, 60, 'losses (%)'], hub: [20, 250, 'hub height (m)'], inj: [0, 5000, 'injection limit (MW)'], p50: [0, 3000, 'P50 (kWh/kWc)'] };
    Object.entries(ids).forEach(([id, k]) => { const e = $(id); if (!e) return; e.value = S[k]; e.addEventListener('change', () => {
      let v = e.type === 'number' ? (e.value === '' ? (k === 'inj' || k === 'p50' ? '' : S[k]) : +e.value) : e.value;
      const r = RANGE[k], note = $('fc-range-note');
      if (r && v !== '' && typeof v === 'number' && (v < r[0] || v > r[1] || !isFinite(v))) { const was = v; v = Math.min(r[1], Math.max(r[0], isFinite(v) ? v : r[0])); e.value = v; if (note) { note.textContent = `${r[2]} ${was} is outside ${r[0]}–${r[1]}: set to ${v}.`; note.hidden = false; setTimeout(() => { note.hidden = true; }, 6000); } }
      S[k] = v; vis(); run(); }); });
    [['fc-calfr', 'calFr'], ['fc-curt', 'curt']].forEach(([id, k]) => { const e = $(id); if (!e) return; e.checked = !!S[k]; e.addEventListener('change', () => { S[k] = e.checked; run(); }); });
    const cf = $('fc-calfile'); if (cf) cf.addEventListener('change', async () => { const f = cf.files[0]; cf.value = ''; if (f) await calibrate(f); });
    const hb = $('fc-hist-btn'); if (hb) hb.addEventListener('click', buildHistory); const hp = $('fc-hist-pptx'); if (hp) hp.addEventListener('click', parkSheet);
    const sbt = $('fc-hist-send'); if (sbt) sbt.addEventListener('click', sendToPricer);
    const cr = $('fc-calreset'); if (cr) cr.addEventListener('click', () => { delete S.cal[siteKey()]; save(); calInfo(); run(); });
    const pasteBox = $('fc-paste');
    if (pasteBox) pasteBox.addEventListener('change', () => { const m = pasteBox.value.match(/(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)/); if (m) { S.lat = +m[1].replace(',', '.'); S.lon = +m[2].replace(',', '.'); $('fc-lat').value = S.lat; $('fc-lon').value = S.lon; pasteBox.value = ''; run(); } });
    vis(); calInfo(); run(); backtest();
  }
  function calInfo() {
    const el = $('fc-calinfo'); if (!el) return;
    const c = siteCal();
    el.innerHTML = c ? `<b>Calibrated on this site:</b> ${c.n.toLocaleString('en-GB')} hours (${c.period}) · ${c.bins ? 'empirical power curve' : c.scale ? 'scale factor ' + c.scale.toFixed(3) : 'level kept (less than 9 months to fit it)'}${c.curtRatio != null ? ` · at prices ≤ 0 the site kept ${Math.round(c.curtRatio * 100)} % of its output (curtailment)` : ''}${c.shift && (c.shift.winter || c.shift.summer) ? ` · clock of the file corrected (${c.shift.winter >= 0 ? '+' : ''}${c.shift.winter} h winter, ${c.shift.summer >= 0 ? '+' : ''}${c.shift.summer} h summer)` : ''}. Tested on the last third, never used to fit: hourly error ${(c.nmae0 * 100).toFixed(1)} % of capacity before, <b>${(c.nmae1 * 100).toFixed(1)} %</b> after.`
      : 'Not calibrated on this site yet: load its metered output to adjust the model to it.';
  }

  // Calibration on the site's metered output (lessons of the backtest on real sites):
  //  · the clock of metered files is checked: the shift between the file and the forecast is found
  //    separately for summer and winter time (Enedis curves were 2 h behind in winter, 1 h in summer)
  //  · the fit uses only hours priced above 5 €/MWh, so the site's curtailment at negative prices
  //    does not bias it; that curtailment is learned apart (share of the output kept at prices ≤ 0)
  //  · a scale factor needs 9 months of data or more, else the monthly French correction stays
  //  · fitted on the first two thirds, tested on the last third, applied only if it beats the model
  const isDST = t => { const y = +t.slice(0, 4), m = +t.slice(5, 7), d = +t.slice(8, 10);
    const lastSun = mm => { const x = new Date(Date.UTC(y, mm, 0)); return x.getUTCDate() - x.getUTCDay(); };
    return (m > 3 && m < 10) || (m === 3 && d >= lastSun(3)) || (m === 10 && d < lastSun(10)); };
  const shiftKey = (t, h) => { const d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13) + h)); return d.toISOString().slice(0, 13) + ':00'; };
  const corrOf = (a, b) => { const n = a.length; if (n < 50) return -1; const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
    let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; } return saa && sbb ? sab / Math.sqrt(saa * sbb) : -1; };
  async function frPrices(years) {
    const P = {};
    for (const y of years) { try { const r = await fetch(DATA_BASE + 'history/fr_prices/' + y + '.json'); if (r.ok) Object.assign(P, (await r.json()).days || {}); } catch (_) {} }
    return t => { const a = P[t.slice(0, 10)]; if (!a) return null; const k = a.length / 24, h = +t.slice(11, 13); const v = a.slice(h * k, h * k + k).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  }
  async function calibrate(file) {
    const el = $('fc-calinfo'); if (el) el.textContent = 'Reading the file…';
    try {
      if (!window.PKLoadCurve) throw new Error('reader not loaded');
      const cv = window.PKLoadCurve.build(await window.PKLoadCurve.readFile(file));
      const act = new Map();   // file label 'YYYY-MM-DDTHH:00' → MW (hourly average)
      LAST_ACT = { key: siteKey(), act };
      [...cv.slots.keys()].sort().forEach(d => { const e = cv.slots.get(d); for (let hh = 0; hh < 24; hh++) { let s = 0, k = 0; for (let q4 = 0; q4 < 4; q4++) { const v = e[hh * 4 + q4]; if (v != null) { s += v; k++; } } if (k) act.set(`${d}T${String(hh).padStart(2, '0')}:00`, s * 4 / k / 1000); } });
      const days = [...cv.slots.keys()].sort(); if (days.length < 30) throw new Error('at least 30 days of output are needed');
      const d0 = days[0] < '2022-01-01' ? '2022-01-01' : days[0], d1 = days[days.length - 1];
      if (el) el.textContent = `Fetching the forecast archive ${d0} → ${d1}…`;
      const v = S.tech === 'solar' ? `global_tilted_irradiance,temperature_2m&tilt=${S.tilt}&azimuth=${S.az}` : 'wind_speed_80m,wind_speed_100m,wind_speed_120m,wind_speed_180m';
      const [Hj, C, price] = await Promise.all([
        getJSON(`https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${S.lat}&longitude=${S.lon}&timezone=Europe%2FParis&wind_speed_unit=ms&start_date=${d0}&end_date=${d1}&hourly=${v}`),
        calFr(), S.zone === 'FR' ? frPrices([...new Set(days.map(d => d.slice(0, 4)))]) : Promise.resolve(() => null)]);
      const H = Hj.hourly;
      const keep = S.cal[siteKey()]; delete S.cal[siteKey()];   // the raw model, without any earlier calibration
      const X = new Map();
      H.time.forEach((t, i) => { const x = S.tech === 'solar' ? (H.global_tilted_irradiance[i] == null ? null : solarMW(H.global_tilted_irradiance[i], H.temperature_2m[i])) : windMW(hubWind(H, i));
        if (x != null) X.set(t, { x, ws: S.tech === 'wind' ? hubWind(H, i) : null }); });
      if (keep) S.cal[siteKey()] = keep;
      // the clock of the file: best shift (−3 … +3 h) for summer time and for winter time apart
      const shift = {};
      for (const dst of [true, false]) {
        let best = 0, bc = -2;
        for (let h = -3; h <= 3; h++) {
          const a = [], b = [];
          act.forEach((y, t) => { if (isDST(t) !== dst) return; const m = X.get(shiftKey(t, h)); if (m && (m.x > 0 || y > 0)) { a.push(y); b.push(m.x); } });
          const c = corrOf(a, b); if (c > bc + 0.005) { bc = c; best = h; }
        }
        shift[dst ? 'summer' : 'winter'] = best;
      }
      const fr = C && C.solar_month, frc = t => S.tech === 'solar' && fr ? (fr[String(+t.slice(5, 7))] || 1) : 1;
      const rows = [];
      act.forEach((y, t) => { const tm = shiftKey(t, shift[isDST(t) ? 'summer' : 'winter']); const m = X.get(tm); if (m) rows.push({ t: tm, y, x: m.x, ws: m.ws, p: price(tm) }); });
      rows.sort((a, b) => a.t < b.t ? -1 : 1);
      if (rows.length < 500) throw new Error('too few hours match the forecast archive');
      const cut = Math.floor(rows.length * 2 / 3), tr = rows.slice(0, cut), te = rows.slice(cut);
      const span = (Date.parse(tr[tr.length - 1].t.slice(0, 10)) - Date.parse(tr[0].t.slice(0, 10))) / 864e5;
      const err = (arr, f) => arr.reduce((s, r) => s + Math.abs(f(r) - r.y), 0) / arr.length / S.mw;
      const daylight = r => S.tech !== 'solar' || r.x > 0 || r.y > 0;
      const free = r => r.p == null || r.p > 5, neg = r => r.p != null && r.p <= 0;
      const trF = tr.filter(r => daylight(r) && free(r)), teD = te.filter(daylight);
      const base = r => Math.min(S.mw, r.x * frc(r.t));   // what the tool shows without calibration
      let scale = null;
      if (span >= 270) scale = trF.reduce((s, r) => s + r.y, 0) / Math.max(1e-9, trF.reduce((s, r) => s + r.x, 0));
      let fitU = r => scale ? Math.min(S.mw, r.x * scale) : base(r), bins = null;
      if (S.tech === 'wind' && trF.length >= 1500) {
        const sum = [], cnt = []; trF.forEach(r => { const b = Math.min(59, Math.floor(r.ws * 2)); sum[b] = (sum[b] || 0) + r.y / S.mw; cnt[b] = (cnt[b] || 0) + 1; });
        const bb = Array.from({ length: 60 }, (_, b) => cnt[b] >= 10 ? sum[b] / cnt[b] : null);
        for (let b = 1; b < 40; b++) if (bb[b] != null && bb[b - 1] != null && bb[b] < bb[b - 1]) bb[b] = bb[b - 1];
        const at = w => { let k = Math.min(59, Math.floor(w * 2)); while (k > 0 && bb[k] == null) k--; return bb[k] == null ? 0 : bb[k]; };
        const fb = r => S.mw * at(r.ws), teF = te.filter(free);
        if (err(teF, fb) < err(teF, fitU)) { bins = bb; fitU = fb; scale = null; }
      }
      const trN = tr.filter(r => neg(r) && daylight(r));
      const curtRatio = trN.length >= 30 ? Math.min(1, trN.reduce((s, r) => s + r.y, 0) / Math.max(1e-9, trN.reduce((s, r) => s + fitU(r), 0))) : null;
      const fit = r => neg(r) && curtRatio != null ? fitU(r) * curtRatio : fitU(r);
      const cal = { n: rows.length, period: `${rows[0].t.slice(0, 10)} → ${rows[rows.length - 1].t.slice(0, 10)}`, shift, curtRatio, span: Math.round(span) };
      if (bins) cal.bins = bins; else if (scale) cal.scale = scale;
      cal.nmae0 = err(teD, base); cal.nmae1 = err(teD, fit);
      try { perfCheck(rows, r => daylight(r) && free(r), cal.nmae1 < cal.nmae0 ? fit : base); } catch (e) { console.warn('[fcst] perf', e); }
      if (!(cal.nmae1 < cal.nmae0)) { if (el) el.innerHTML = `Calibration not applied: on the test third it does not beat the model (${(cal.nmae0 * 100).toFixed(1)} % → ${(cal.nmae1 * 100).toFixed(1)} % of capacity). Clock of the file: ${shift.winter >= 0 ? '+' : ''}${shift.winter} h in winter, ${shift.summer >= 0 ? '+' : ''}${shift.summer} h in summer. Check the technology, the coordinates and the capacity entered.`; return; }
      S.cal[siteKey()] = cal; save(); calInfo(); run();
    } catch (e) { if (el) el.textContent = 'Calibration failed: ' + e.message; }
  }

  // ── Performance check: the park against what the weather allowed, week by week; days it stopped ──
  //   ratio = metered output ÷ modelled output on hours priced above 5 €/MWh (no curtailment); a week below the
  //   usual ratio by more than 15 % (or 2.5 robust deviations) is flagged; a day is "stopped" when the model
  //   expected a real output and the park gave less than 5 % of it
  function perfCheck(rows, use, model) {
    const host = $('fc-perf'); if (!host) return;
    const wk = {}, dy = {};
    const monday = t => { const d = new Date(t.slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); };
    rows.forEach(r => { if (!use(r)) return; const m = model(r), w = monday(r.t), d = r.t.slice(0, 10);
      const a = wk[w] || (wk[w] = [0, 0]); a[0] += r.y; a[1] += m; const b = dy[d] || (dy[d] = [0, 0]); b[0] += r.y; b[1] += m; });
    const W = Object.keys(wk).sort().filter(w => wk[w][1] > 0.02 * S.mw * 24);
    if (W.length < 8) { host.innerHTML = ''; return; }
    const R = W.map(w => wk[w][0] / wk[w][1]), srt = R.slice().sort((a, b) => a - b), med = srt[Math.floor(srt.length / 2)];
    const mad = R.map(x => Math.abs(x - med)).sort((a, b) => a - b)[Math.floor(R.length / 2)] * 1.4826;
    // usual ratio of the same calendar month when it has 3 weeks or more (the model is weaker in winter: low sun, fog, snow)
    const byM = {}; W.forEach((w, i) => (byM[w.slice(5, 7)] = byM[w.slice(5, 7)] || []).push(R[i]));
    const usual = w => { const a = byM[w.slice(5, 7)]; if (!a || a.length < 3) return med; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    const limW = w => Math.min(usual(w) * 0.85, usual(w) - 2.5 * mad), lim = Math.min(med * 0.85, med - 2.5 * mad);
    const flags = W.map((w, i) => R[i] < limW(w) ? { w, r: R[i] / usual(w), lost: (wk[w][1] * usual(w) - wk[w][0]) } : null).filter(Boolean);
    const typDay = Object.values(dy).map(x => x[1]).sort((a, b) => a - b)[Math.floor(Object.keys(dy).length / 2)] || 0;
    const stops = Object.keys(dy).sort().filter(d => dy[d][1] > 0.3 * typDay && dy[d][0] < 0.05 * dy[d][1]);
    const lostTot = flags.reduce((s, x) => s + x.lost, 0) + stops.reduce((s, d) => s + dy[d][1] * usual(d) - dy[d][0], 0);
    const totE = W.reduce((s, w) => s + wk[w][0], 0);
    host.innerHTML = `<div class="chart-container fuel-card" style="margin-top:10px"><div class="fuel-card-head"><div><div class="table-title">Performance check · the park against its weather</div><div class="fuel-card-sub">Metered ÷ modelled output each week, hours priced above 5 €/MWh (no curtailment) · usual ratio ${med.toFixed(2)} (by month when known), alert 15 % below it</div></div><span class="source-badge">Your file · Open-Meteo</span></div>
      <div style="position:relative;height:220px"><canvas id="fc-perf-c" style="width:100%;height:220px"></canvas></div>
      <div class="fuel-note">${flags.length || stops.length ? `<b>${flags.length} week${flags.length === 1 ? '' : 's'} under the usual level</b>${flags.length ? ' (' + flags.slice(-6).map(x => x.w + ' ' + Math.round((x.r - 1) * 100) + ' %').join(', ') + (flags.length > 6 ? '…' : '') + ')' : ''} and <b>${stops.length} day${stops.length === 1 ? '' : 's'} stopped</b> while the weather allowed output${stops.length ? ' (' + stops.slice(-6).join(', ') + (stops.length > 6 ? '…' : '') + ')' : ''}: about <b>${(lostTot).toLocaleString('en-GB', { maximumFractionDigits: 0 })} MWh</b> not produced, ${(lostTot / Math.max(1e-9, totE) * 100).toFixed(1)} % of the output over the period. Worth checking with the operator: outages, inverter faults, grid works, soiling, shading.` : 'No week below the usual level and no stopped day: the park produced what its weather allowed.'} The model is the forecast archive of the place, so a week with poor forecasts can also look low; a flag that repeats or a stopped day is the signal.</div></div>`;
    _fuelChart('fc-perf-c', { type: 'bar', data: { labels: W, datasets: [
      { label: 'Metered ÷ modelled', data: R.map(x => +x.toFixed(3)), backgroundColor: R.map((x, i) => x < limW(W[i]) ? 'rgba(237,105,101,.75)' : 'rgba(127,200,248,.5)'), borderRadius: 2 },
      { type: 'line', label: 'Usual for the month', data: W.map(w => +usual(w).toFixed(3)), borderColor: '#E6EDF3', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0 },
      { type: 'line', label: 'Alert', data: W.map(w => +limW(w).toFixed(3)), borderColor: '#ED6965', borderDash: [3, 3], borderWidth: 1.2, pointRadius: 0 }] },
      options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('ratio', { beginAtZero: true }) } }) }, 'park-performance');
  }
  function vis() {
    document.querySelectorAll('#page-fcst .fc-solar').forEach(e => { e.hidden = S.tech !== 'solar'; });
    document.querySelectorAll('#page-fcst .fc-wind').forEach(e => { e.hidden = S.tech !== 'wind'; });
    const m = $('fc-method'); if (m) m.innerHTML = S.tech === 'solar'
      ? `Irradiance on the panel plane (tilt ${S.tilt}°, azimuth ${S.az}°, 0 = south, −90 = east, 90 = west) from Open-Meteo, converted with the cell temperature (NOCT 45 °C, −0.4 % per °C above 25 °C), minus ${S.lossS} % losses (inverter, cabling, soiling), capped at the capacity. Band: spread of the 31 members of the GFS ensemble (10th to 90th percentile around their median), centred on the forecast.`
      : `Wind at ${S.hub} m interpolated between the 80, 120 and 180 m levels of Open-Meteo, through a generic power curve, ${CLS_T[S.cls]}, cut-out at 25 m/s, minus ${S.lossW} % losses (wake, availability, electrical). Band: spread of the 31 members of the GFS ensemble (100 m wind, 0.14 shear to hub height), centred on the forecast.`;
  }
  // ── Backtest on real data (scripts/fcst_backtest.py) ──
  const STEP = { v0: 'Tool', v1: 'Grid', v2: '+ bias', v3: '+ shape', v4: '+ MOS', v5: '+ price', v6: '+ models' };
  async function backtest() {
    const host = $('fc-bt'); if (!host || host.dataset.done) return;
    let j; try { const r = await fetch(DATA_BASE + 'history/fcst_backtest.json'); j = r.ok ? await r.json() : null; } catch (_) { j = null; }
    if (!j) { host.innerHTML = '<div class="fuel-note">Backtest not available.</div>'; return; }
    host.dataset.done = '1';
    const keys = Object.keys(j.results), vs = Object.keys(STEP);
    host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Fleet tested</th>${vs.map(v => `<th>${STEP[v]}</th>`).join('')}</tr></thead><tbody>` +
      keys.map(k => { const [t, reg] = k.split('|'), r = j.results[k], best = Math.min(...vs.map(v => r[v] ? r[v].nmae : 9));
        return `<tr><td style="text-align:left">${t === 'solar' ? 'Solar' : 'Wind'} · ${reg}</td>${vs.map(v => r[v] ? `<td${r[v].nmae === best ? ' style="font-weight:700;color:var(--acc)"' : ''}>${(r[v].nmae * 100).toFixed(1)}</td>` : '<td>–</td>').join('')}</tr>`; }).join('') +
      `</tbody></table></div><div class="fuel-note">Steps, each adding to the previous one: Tool = the first version at one point · Grid = averaged over 9 points of the region · + bias = monthly scale factor · + shape = solar correction by month × hour, wind empirical power curve · + MOS = regression on several forecast variables · + price = curtailment at day-ahead prices ≤ 0 · + models = Météo-France, ICON and GFS next to the best model, recent months weighing more. Hourly error in % of installed capacity (solar: daylight hours), ${j.period[0]} → ${j.period[1]}, each month predicted with the forecast issued the day before and corrections learned only on the months before it. The tool for a single site uses the steps that carry over to one site: several weather models, the monthly French solar correction, curtailment at negative prices, and the calibration on the site’s own output.</div>`;
    const draw = (cid, key, col) => { const a = j.samples[key]; if (!a || !a.length) return;
      const L = a.map(r => r[0].slice(11, 13) === '00' ? new Date(r[0].slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }) : r[0].slice(11, 16));
      _fuelChart(cid, { type: 'line', data: { labels: L, datasets: [
        { label: 'Actual (RTE)', data: a.map(r => r[1] * 100), borderColor: '#E6EDF3', borderWidth: 2, pointRadius: 0, fill: false },
        { label: 'Tool, first version', data: a.map(r => r[2] == null ? null : r[2] * 100), borderColor: 'rgba(122,147,171,.8)', borderDash: [4, 3], borderWidth: 1.3, pointRadius: 0, fill: false },
        { label: 'Best version (v6)', data: a.map(r => r[3] == null ? null : r[3] * 100), borderColor: col, borderWidth: 2, pointRadius: 0, fill: false },
      ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } },
        scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0, callback: (v, i) => /^[A-Z]/.test(L[i]) ? L[i] : '' } }), y: _fuelAxis('load factor, %', { beginAtZero: true }) } }) }, cid); };
    nationalBlock();
    draw('fc-bt-solar', 'solar|Occitanie|summer', '#F4C430');
    draw('fc-bt-wind', 'wind|Hauts-de-France|winter', '#14D3A9');
  }
  // France as a whole: our model vs the TSO day-ahead forecast published on ENTSO-E (scripts/fcst_national.py)
  async function nationalBlock() {
    const host = $('fc-nat'); if (!host) return;
    let j; try { const r = await fetch(DATA_BASE + 'history/fcst_national.json'); j = r.ok ? await r.json() : null; } catch (_) { j = null; }
    if (!j) { host.innerHTML = ''; return; }
    const N = { ent: 'ENTSO-E (TSO day-ahead)', n0: 'Ours · generic', n1: 'Ours · + monthly level', n2: 'Ours · full (regression, price, several models)', mix: 'Average of ENTSO-E and ours' };
    const R = j.results, pc = v => (v * 100).toFixed(2);
    host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Forecast issued the day before</th><th>Solar · hourly error</th><th>Solar · bias</th><th>Wind · hourly error</th><th>Wind · bias</th></tr></thead><tbody>` +
      Object.keys(N).map(k => { const b = ['solar', 'wind'].map(t => Math.min(...Object.keys(N).map(x => R[t][x].nmae)));
        return `<tr><td style="text-align:left">${N[k]}</td>${['solar', 'wind'].map((t, i) => `<td${R[t][k].nmae === b[i] ? ' style="font-weight:700;color:var(--acc)"' : ''}>${pc(R[t][k].nmae)} %</td><td>${R[t][k].bias >= 0 ? '+' : ''}${pc(R[t][k].bias)}</td>`).join('')}</tr>`; }).join('') +
      `</tbody></table></div><div class="fuel-note">France, ${j.period[0]} → ${j.period[1]}: error of the national solar and wind output in % of installed capacity (solar: daylight hours), each month predicted with corrections learned only on the months before. Actual output: RTE éCO2mix. Ours: one point per region weighted by its installed capacity, offshore farms apart.</div>`;
    const draw = (cid, t) => { const m = j.monthly[t]; if (!m) return; const L = Object.keys(m);
      _fuelChart(cid, { type: 'line', data: { labels: L, datasets: [
        { label: 'ENTSO-E', data: L.map(k => m[k].ent), borderColor: 'rgba(122,147,171,.9)', borderWidth: 1.6, pointRadius: 2, fill: false },
        { label: 'Ours', data: L.map(k => m[k].n2), borderColor: t === 'solar' ? '#F4C430' : '#14D3A9', borderWidth: 2, pointRadius: 2, fill: false },
        { label: 'Average of both', data: L.map(k => m[k].mix), borderColor: '#A87DC4', borderDash: [5, 4], borderWidth: 1.6, pointRadius: 0, fill: false },
      ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } }, scales: { x: _fuelXAxis(), y: _fuelAxis('hourly error, % of capacity', { beginAtZero: true }) } }) }, cid); };
    draw('fc-nat-solar', 'solar'); draw('fc-nat-wind', 'wind');
  }
  document.addEventListener('pk-view', () => {});

  window.addEventListener('load', () => setTimeout(() => {
    const inner = window.showPage;
    if (typeof inner === 'function') window.showPage = function (id) { const r = inner.apply(this, arguments); if (id === 'fcst') wire(); return r; };
    if (document.querySelector('#page-fcst.active')) wire();
  }, 0));
  // ════════════════════════════════════════════════════════════════
  // PRICE A PARK — its synthetic history, with or without its own data
  //   1  weather of every hour 2005 → last year at the park: ERA5 reanalysis
  //   2  the tool's physical model (panels, injection limit, power curve)
  //   3  prior correction learned on the real output of the park's region
  //      (RTE vs ERA5, month by month, 2016 → 2025: data/history/era5_calib.json)
  //   4  the park's own evidence, pooled with the prior (empirical Bayes):
  //      metered output → level fitted on the same hours (priced > 5 €/MWh),
  //      weight n days ÷ (n + 180); else the P50 entered sets the level
  //   5  every weather year is a scenario: P50 / P90 of the yearly output from
  //      21 years, model uncertainty added (spread of the regional factor)
  //   6  priced on the real hourly day-ahead price of the same hour (2016 →):
  //      capture rate and output at prices ≤ 0 year by year, the real link
  //      between weather and price kept; then sent to the PPA pricer
  // ════════════════════════════════════════════════════════════════
  const Y_FROM = 2005;
  async function regionOf(lat, lon) {
    try { const r = await fetch(`https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=nom,codeRegion&format=json`); const j = r.ok ? await r.json() : []; return j[0] || null; } catch (_) { return null; }
  }
  async function buildHistory() {
    const host = $('fc-hist'), st = $('fc-hist-status'); if (!host) return;
    const yEnd = new Date().getUTCFullYear() - 1;
    if (st) st.textContent = `Fetching ${yEnd - Y_FROM + 1} years of hourly weather at the park (ERA5)…`;
    try {
      const v = S.tech === 'solar' ? `global_tilted_irradiance,temperature_2m&tilt=${S.tilt}&azimuth=${S.az}` : 'wind_speed_100m';
      const [A, EC, com, prY] = await Promise.all([
        getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${S.lat}&longitude=${S.lon}&timezone=Europe%2FParis&wind_speed_unit=ms&models=era5&start_date=${Y_FROM}-01-01&end_date=${yEnd}-12-31&hourly=${v}`),
        ERA || (ERA = fetch(DATA_BASE + 'history/era5_calib.json').then(r => r.ok ? r.json() : null).catch(() => null)),
        regionOf(S.lat, S.lon),
        S.zone === 'FR' ? frPrices(Array.from({ length: yEnd - 2016 + 1 }, (_, i) => 2016 + i)) : Promise.resolve(() => null)]);
      price = prY;
      const H = A.hourly;
      // 1–2 raw model, MW
      const raw = H.time.map((t, i) => S.tech === 'solar' ? solarMW(H.global_tilted_irradiance[i], H.temperature_2m[i]) : (H.wind_speed_100m[i] == null ? null : windMW(H.wind_speed_100m[i] * Math.pow(S.hub / 100, 0.14))));
      // 3 prior: regional monthly factor (national when the region is unknown)
      const regName = com && EC ? Object.keys(EC.codes || {}).find(r => EC.codes[r] === com.codeRegion) : null;
      const fac = EC ? ((regName && EC[S.tech][regName]) || EC.national[S.tech]) : null;
      const sdModel = EC && regName && EC.stability[S.tech] && EC.stability[S.tech][regName] ? EC.stability[S.tech][regName].sd : 0.05;
      const capOut = S.inj !== '' && +S.inj > 0 ? Math.min(S.mw, +S.inj) : S.mw;
      let P = raw.map((x, i) => x == null ? null : Math.min(capOut, x * (fac ? fac[String(+H.time[i].slice(5, 7))] || 1 : 1)));
      // 4 the park's evidence
      let level = 1, how = regName ? `prior: real output of ${regName} vs the same simulation (RTE, 2020–2025)` : 'prior: national factor', wSite = 0;
      const sc = siteCal();
      if (LAST_ACT && LAST_ACT.key === siteKey() && sc) {
        const idx = new Map(H.time.map((t, i) => [t, i]));
        let sy = 0, sp = 0; const days = new Set();
        LAST_ACT.act.forEach((y, t) => { const tm = shiftKey(t, (sc.shift || {})[isDST(t) ? 'summer' : 'winter'] || 0); const i = idx.get(tm); if (i == null || P[i] == null) return;
          const p = price(tm); if (p != null && p <= 5) return; if (S.tech === 'solar' && P[i] <= 0 && y <= 0) return; sy += y; sp += P[i]; days.add(tm.slice(0, 10)); });
        if (sp > 0 && days.size >= 30) { const site = sy / sp; wSite = days.size / (days.size + 180); level = wSite * site + (1 - wSite); how = `park’s metered output (${days.size} days, weight ${Math.round(wSite * 100)} %) pooled with the regional prior`; }
      } else if (S.tech === 'solar' && S.p50 !== '' && +S.p50 > 0) {
        const yrs = new Set(H.time.map(t => t.slice(0, 4))).size, e = P.reduce((s, x) => s + (x || 0), 0) / yrs / S.mw;
        if (e > 0) { level = +S.p50 / e; how = `level set on the P50 entered (${S.p50} kWh/kWc), regional prior for the shape`; }
      }
      if (level !== 1) P = P.map(x => x == null ? null : Math.min(capOut, x * level));
      // 5 yearly output, P50 / P90
      const Y = {}; H.time.forEach((t, i) => { if (P[i] == null) return; const y = t.slice(0, 4); Y[y] = (Y[y] || 0) + P[i]; });
      const ys = Object.keys(Y).sort(), E = ys.map(y => Y[y]);
      const mean = E.reduce((a, b) => a + b, 0) / E.length, sdW = Math.sqrt(E.reduce((a, b) => a + (b - mean) ** 2, 0) / (E.length - 1));
      const sdTot = Math.sqrt(sdW ** 2 + (mean * sdModel * (1 - wSite)) ** 2);
      const p90 = mean - 1.2816 * sdTot, p50 = mean;
      // 6 capture rate year by year on the real day-ahead prices
      //   at prices ≤ 0 the park keeps only part of its output: the share learned on its metered data, else 35 %
      //   (two metered parks, 2024–2026: 31–46 %; counting every hour produced put the capture rate 19–25 points too low)
      const kNeg = sc && sc.curtRatio != null ? sc.curtRatio : 0.35, kHow = sc && sc.curtRatio != null ? 'learned on the park' : 'typical of French parks';
      const cap = {};
      H.time.forEach((t, i) => { if (P[i] == null || +t.slice(0, 4) < 2016) return; const p = price(t); if (p == null) return; const y = t.slice(0, 4);
        const o = cap[y] || (cap[y] = { e: 0, v: 0, b: 0, n: 0, neg: 0 }); const x = p <= 0 ? P[i] * kNeg : P[i]; o.e += x; o.v += x * p; o.b += p; o.n++; if (p <= 0) o.neg += P[i]; });
      const capY = Object.keys(cap).sort().filter(y => cap[y].n > 8000);
      const series = { time: H.time, P };
      ERA_LAST = { series, ys, E, p50, p90, how, regName, capY, cap, sdTot };
      // render
      const f = v => (v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 });
      host.innerHTML = `<div class="kpi-strip fuel-kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:10px">${[
        _fuelKpi('P50 yearly output', f(p50), 'GWh', `${Math.round(p50 / S.mw)} kWh/kWc · ${ys.length} weather years`),
        _fuelKpi('P90 yearly output', f(p90), 'GWh', `${((p90 / p50 - 1) * 100).toFixed(1)} % · weather + model uncertainty`),
        _fuelKpi('Capture rate, last 3 years', capY.length ? (capY.slice(-3).reduce((s, y) => s + cap[y].v / cap[y].e / (cap[y].b / cap[y].n), 0) / Math.min(3, capY.length) * 100).toFixed(1) : '–', '%', 'on the real day-ahead price of each hour'),
        _fuelKpi('Output at prices ≤ 0, last year', capY.length ? (cap[capY[capY.length - 1]].neg / Y[capY[capY.length - 1]] * 100).toFixed(1) : '–', '%', `${Math.round(kNeg * 100)} % of it kept (${kHow})`)].join('')}</div>
        <div class="fuel-grid-2"><div class="chart-container fuel-card"><div class="fuel-card-head"><div><div class="table-title">Yearly output, ${ys[0]}–${ys[ys.length - 1]}</div><div class="fuel-card-sub">GWh · each weather year replayed on today’s park</div></div><span class="source-badge">ERA5 · RTE</span></div><div style="position:relative;height:260px"><canvas id="fc-hist-y" style="width:100%;height:260px"></canvas></div></div>
        <div class="chart-container fuel-card"><div class="fuel-card-head"><div><div class="table-title">Capture rate year by year</div><div class="fuel-card-sub">the park’s simulated output on the real day-ahead price of each hour</div></div><span class="source-badge">ERA5 · ENTSO-E</span></div><div style="position:relative;height:260px"><canvas id="fc-hist-c" style="width:100%;height:260px"></canvas></div></div></div>
        <div class="fuel-note">How the level is set: ${how}. P90 = P50 − 1.28 σ, σ combining the spread of the ${ys.length} weather years and the uncertainty of the correction (${(sdModel * 100).toFixed(1)} % a year, less as the park’s own data weighs more). Capture rate: at prices ≤ 0 the park keeps ${Math.round(kNeg * 100)} % of its output (${kHow}); checked on two metered parks over their second year, output value within 1–3 % when the level comes from 12 months of metering, 9–11 % too high on the regional prior alone.</div>`;
      _fuelChart('fc-hist-y', { type: 'bar', data: { labels: ys, datasets: [
        { label: 'Yearly output (GWh)', data: E.map(x => +(x / 1000).toFixed(2)), backgroundColor: S.tech === 'solar' ? 'rgba(244,196,48,.7)' : 'rgba(20,211,169,.7)', borderRadius: 3 },
        { type: 'line', label: 'P50', data: ys.map(() => +(p50 / 1000).toFixed(2)), borderColor: '#E6EDF3', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0 },
        { type: 'line', label: 'P90', data: ys.map(() => +(p90 / 1000).toFixed(2)), borderColor: '#ED6965', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0 }] },
        options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GWh', { beginAtZero: true }) } }) }, 'park-yearly-output');
      _fuelChart('fc-hist-c', { type: 'line', data: { labels: capY, datasets: [
        { label: 'Capture rate (%)', data: capY.map(y => +(cap[y].v / cap[y].e / (cap[y].b / cap[y].n) * 100).toFixed(1)), borderColor: '#F4C430', borderWidth: 2.2, pointRadius: 3, yAxisID: 'y' },
        { type: 'bar', label: 'Output at prices ≤ 0 (%)', data: capY.map(y => +(cap[y].neg / Y[y] * 100).toFixed(1)), backgroundColor: 'rgba(237,105,101,.45)', borderRadius: 3, yAxisID: 'y1' }] },
        options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('capture rate, %'), y1: _fuelAxis('% of output', { position: 'right', beginAtZero: true, grid: { display: false } }) } }) }, 'park-capture-rate');
      if (st) st.textContent = `${S.tech === 'solar' ? 'Solar' : 'Wind'} park at ${(+S.lat).toFixed(3)}, ${(+S.lon).toFixed(3)}${com ? ' (' + com.nom + ')' : ''} · ${S.mw} MW · history built ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}`;
      const sb = $('fc-hist-send'); if (sb) sb.hidden = false; const pb = $('fc-hist-pptx'); if (pb) pb.hidden = !window.PKExport;
    } catch (e) { if (st) st.textContent = 'History not built: ' + e.message; }
  }
  let ERA_LAST = null;
  let price = () => null;
  // the synthetic years with prices go to the PPA pricer as the asset curve (kWh per quarter-hour, Paris days)
  function sendToPricer() {
    if (!ERA_LAST || !window.PKPpa) return;
    const slots = new Map(), { time, P } = ERA_LAST.series;
    time.forEach((t, i) => { if (+t.slice(0, 4) < 2016 || P[i] == null) return; const d = t.slice(0, 10), h = +t.slice(11, 13);
      let a = slots.get(d); if (!a) { a = new Array(96).fill(0); slots.set(d, a); } const q = P[i] * 1000 / 4; for (let k = 0; k < 4; k++) a[h * 4 + k] = q; });
    const st = window.PKPpa.state;
    st.asset = { slots, info: { rows: slots.size * 24, step: 60, unit: 'kwh', stamp: 'start' } };
    st.assetName = `Park ${(+S.lat).toFixed(3)}, ${(+S.lon).toFixed(3)} (synthetic ${[...slots.keys()][0].slice(0, 4)}–${[...slots.keys()].pop().slice(0, 4)})`;
    st.tech = S.tech; st.years = null; st.volume = Math.round(ERA_LAST.p50); st.mw = S.mw;
    showPage('ppapricer'); setTimeout(() => { try { const e = document.getElementById('pp-tech'); if (e) e.value = S.tech; const c = document.getElementById('pp-asset-clear'); if (c) c.hidden = false; window.PKPpa.run(); } catch (_) {} }, 300);
  }

  // the park on a few slides: what it produces, what it captures, and the prices from the pricer when they were run for it
  async function parkSheet() {
    if (!ERA_LAST || !window.PKExport || !PKExport.deck) return;
    const btn = $('fc-hist-pptx'), lab = btn.textContent; btn.disabled = true; btn.textContent = 'Preparing…';
    try {
      const L = ERA_LAST, f = v => (v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 }), c3 = L.capY.slice(-3);
      const capAvg = c3.length ? c3.reduce((s, y) => s + L.cap[y].v / L.cap[y].e / (L.cap[y].b / L.cap[y].n), 0) / c3.length * 100 : null;
      const where = `${(+S.lat).toFixed(3)}, ${(+S.lon).toFixed(3)}${L.regName ? ' · ' + L.regName : ''}`;
      const lines = [`${S.tech === 'solar' ? 'Solar' : 'Wind'} park · ${S.mw} MW${S.inj !== '' && +S.inj > 0 ? ' (injection ' + S.inj + ' MW)' : ''} · ${where}`,
        `Yearly output: P50 ${f(L.p50)} GWh (${Math.round(L.p50 / S.mw)} kWh/kW), P90 ${f(L.p90)} GWh, from ${L.ys.length} weather years ${L.ys[0]}–${L.ys[L.ys.length - 1]}`,
        `Capture rate, last three years: ${capAvg == null ? '–' : capAvg.toFixed(1) + ' %'} of the baseload, on the real day-ahead price of each hour`,
        `How the level is set: ${L.how}`];
      const P = window.PKPpa && PKPpa.state, o = P && P.last;
      if (o && P.assetName && /^Park /.test(P.assetName)) lines.push(`PPA pricer (${P.assetName}): ${o.ppa != null ? o.ppa.toFixed(2) + ' €/MWh' : '–'} over ${o.tenor ? o.tenor[0] + '–' + o.tenor[o.tenor.length - 1] : '–'}`);
      const cr = window.PKPpaCR && PKPpaCR.last();
      if (cr && cr.P && cr.P.own) { const x = cr.sol.out[PKPpaCR.state.formula];
        lines.push(`Aggregation contract under complément de rémunération: ${PKPpaCR.state.formula === 'a' ? (x.A * 100).toFixed(1) + ' % × M0' : PKPpaCR.state.formula === 'b' ? 'M0 − ' + x.B.toFixed(2) + ' €/MWh' : (x.A * 100).toFixed(1) + ' % × M0 − ' + x.B.toFixed(2) + ' €/MWh'} (park ${((cr.sol.ratio - 1) * 100).toFixed(1)} % vs M0, costs ${cr.cost.toFixed(2)} €/MWh)`); }
      const specs = [{ k: 'note', title: 'The park in brief', text: lines.join('\n') }];
      for (const [id, title, sub] of [['fc-hist-y', 'Yearly output', 'GWh · each weather year replayed on today’s park'], ['fc-hist-c', 'Capture rate year by year', 'On the real day-ahead price of each hour']]) {
        const el = $(id) && $(id).closest('.chart-container'); if (el && el.offsetHeight) specs.push({ k: 'card', title, sub, src: 'PowerKlock · ERA5 · RTE · ENTSO-E', r: await PKExport.snap(el) }); }
      specs.push({ k: 'note', title: 'Method and limits', text: 'Hourly weather of the reanalysis ERA5 at the park since 2005 through the physical model of the production forecast tool, corrected month by month on the real output of the region (RTE, 2020–2025); level from the park’s metering pooled with that prior, or from its P50. P90 = P50 − 1.28 σ (weather years and model uncertainty). Checked on two metered parks over their second year: output value within 1–3 % with 12 months of metering, 9–11 % too high on the regional prior alone. Not included: availability losses beyond those in the metering, degradation, future curtailment rules.' });
      await PKExport.deck(`Park sheet · ${S.tech} ${S.mw} MW · ${where}`, specs);
    } catch (e) { const st = $('fc-hist-status'); if (st) st.textContent = 'Park sheet failed: ' + (e.message || e); }
    btn.disabled = false; btn.textContent = lab;
  }
  window.PKFcst = { run, state: S, buildHistory, sendToPricer, parkSheet, perfCheck };
})();
