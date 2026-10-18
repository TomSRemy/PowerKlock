/* ════════════════════════════════════════════════════════════════════════════
 * MARKET ANALYSIS v3 — Causal multi-panel + crosshair + AI synthesis
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   1. Drivers strip   · 6 sparklines (TTF · EUA · Wind · Temp · Nuc · Flux)
 *   2. 4 main panels   · Prix / Spark / Load vs Ren / Mix supply (Chart.js)
 *   3. Crosshair       · synchronised vertical line across all 4 panels
 *   4. Hover tooltip   · all values at hovered timestamp (3 sections)
 *   5. Episode cards   · auto-detected key moments (template-narrative)
 *   6. AI synthesis    · global window read via Claude API (on demand)
 *
 * Data status:
 *   - DA price hourly   · REAL (data/history/daily/*.json)
 *   - Wind / Solar      · REAL (same)
 *   - TTF / EUA         · REAL (data/commodities.json via window.PKC)
 *   - Temp / wind 100 m · REAL (Open-Meteo, hourly, zone reference point)
 *   - Nuclear           · FR: available capacity (SEFE); others: actual output
 *   - Load / net import · REAL when the day carries ENTSO-E load (A65);
 *                         net import = load − total generation
 *   - Mix               · REAL (ENTSO-E A75); days without data stay empty
 *   - Spark spread      · DERIVED (PKC.cleanSpark, site-wide convention)
 * ════════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  // CONSTANTS
  // ════════════════════════════════════════════════════════════════

  const CO2_FACTORS = {
    nuclear: 12, wind: 11, solar: 45, hydro: 24,
    biomass: 230, fossil: 820, other: 400,
  };
  const FUEL_COLORS = {
    nuclear: '#7B4B9C', wind: '#14D3A9', solar: '#FBBF24', hydro: '#3FA6B4',
    biomass: '#94D2BD', fossil: '#ED6965', other: '#7A93AB',
  };
  // Stack order from bottom to top (baseload first, marginal on top)
  const FUEL_STACK = ['nuclear', 'hydro', 'wind', 'solar', 'fossil'];
  const FUEL_LABELS = {
    nuclear: 'Nuc', wind: 'Wind', solar: 'Solar', hydro: 'Hydro',
    biomass: 'Biomass', fossil: 'Fossil', other: 'Other',
  };


  const EPISODE_KIND_COLOURS = {
    floor: '#14D3A9', weekend: '#FBBF24', cannibalisation: '#A78BFA', peak: '#ED6965',
  };

  const DRIVER_COLOURS = {
    ttf: '#F59E0B', eua: '#A78BFA', wind: '#14D3A9',
    temp: '#ED6965', nuc: '#7B4B9C', flux: '#7A93AB',
  };

  // ════════════════════════════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════════════════════════════

  const STATE = {
    zone: 'FR',
    windowDays: 4,
    granularity: '1h',
    endDate: null,
    data: null,
    charts: {},
    hoverIndex: -1,
    cursors: [],
    aiBusy: false,
  };

  const WINDOWS = [
    { key: 2, label: '2D' },
    { key: 4, label: '4D' },
    { key: 7, label: '7D' },
    { key: 14, label: '14D' },
    { key: 30, label: '30D' },
  ];
  const GRANULARITIES = [
    { key: '15min', label: '15min', slotsPerDay: 96, minutes: 15 },
    { key: '1h',    label: '1h',    slotsPerDay: 24, minutes: 60 },
    { key: '4h',    label: '4h',    slotsPerDay: 6,  minutes: 240 },
    { key: '1D',    label: '1D',    slotsPerDay: 1,  minutes: 1440 },
  ];

  // ════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════

  function _fmtDate(d) { return d.toISOString().slice(0, 10); }
  function _dayLabel(d) {
    return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + d.toISOString().slice(8, 10) + '/' + d.toISOString().slice(5, 7);
  }
  function _hexA(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function _granularitySpec() {
    return GRANULARITIES.find(g => g.key === STATE.granularity) || GRANULARITIES[1];
  }

  // ════════════════════════════════════════════════════════════════
  // DATA FETCH
  // ════════════════════════════════════════════════════════════════

  async function _fetchDaily(dateStr) {
    try {
      const r = await fetch('data/history/daily/' + dateStr + '.json', { cache: 'no-cache' });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  }

  function _resample(arr, sourceSlotsPerDay, targetSlotsPerDay) {
    if (!arr || !arr.length) return new Array(targetSlotsPerDay).fill(null);
    if (sourceSlotsPerDay === targetSlotsPerDay) return arr.slice(0, targetSlotsPerDay);
    const out = new Array(targetSlotsPerDay).fill(null);
    if (sourceSlotsPerDay > targetSlotsPerDay) {
      const ratio = sourceSlotsPerDay / targetSlotsPerDay;
      for (let i = 0; i < targetSlotsPerDay; i++) {
        let sum = 0, n = 0;
        for (let j = 0; j < ratio; j++) {
          const idx = Math.floor(i * ratio) + j;
          if (idx < arr.length && arr[idx] != null) { sum += arr[idx]; n++; }
        }
        out[i] = n > 0 ? sum / n : null;
      }
    } else {
      for (let i = 0; i < targetSlotsPerDay; i++) {
        const src = (i / targetSlotsPerDay) * sourceSlotsPerDay;
        const lo = Math.floor(src), hi = Math.min(lo + 1, sourceSlotsPerDay - 1);
        const t = src - lo;
        const a = arr[lo];
        const b = arr[hi] != null ? arr[hi] : a;
        out[i] = a * (1 - t) + b * t;
      }
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════
  // SIMULATIONS
  // ════════════════════════════════════════════════════════════════










  // ════════════════════════════════════════════════════════════════
  // ASSEMBLE WINDOW DATA
  // ════════════════════════════════════════════════════════════════

  // Reference points for weather drivers (one per zone, roughly central).
  const WX_POINTS = {
    FR: [47.0, 2.4], DE_LU: [51.0, 10.0], BE: [50.6, 4.6], NL: [52.2, 5.4],
    ES: [40.3, -3.7], PT: [39.6, -8.0], IT_NORD: [45.5, 9.6], AT: [47.6, 14.1],
  };
  const _wxCache = new Map();
  // Hourly temperature (°C) and 100 m wind speed (m/s), Europe/Paris clock.
  async function _fetchWeather(zone, startISO, endISO) {
    const pt = WX_POINTS[zone]; if (!pt) return null;
    const key = zone + startISO + endISO;
    if (!_wxCache.has(key)) {
      const today = pkTodayISO();
      const old = (Date.parse(today) - Date.parse(startISO)) / 864e5 > 85;
      const host = old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
      const url = host + '?latitude=' + pt[0] + '&longitude=' + pt[1] + '&hourly=temperature_2m,wind_speed_100m'
        + '&wind_speed_unit=ms&timezone=Europe%2FParis&start_date=' + startISO + '&end_date=' + endISO;
      _wxCache.set(key, fetch(url).then(r => r.ok ? r.json() : null).then(j => {
        if (!j || !j.hourly) return null;
        const byDay = {};
        j.hourly.time.forEach((t, i) => {
          const d = t.slice(0, 10), h = +t.slice(11, 13);
          (byDay[d] = byDay[d] || { temp: new Array(24).fill(null), wind: new Array(24).fill(null) });
          byDay[d].temp[h] = j.hourly.temperature_2m[i]; byDay[d].wind[h] = j.hourly.wind_speed_100m[i];
        });
        return byDay;
      }).catch(() => null));
    }
    return _wxCache.get(key);
  }

  async function _assemble() {
    const zone = STATE.zone;
    const end = STATE.endDate ? new Date(STATE.endDate) : new Date();
    const gran = _granularitySpec();
    const slotsPerDay = gran.slotsPerDay;
    const days = [];
    if (window.PKC) await PKC.ready;
    const firstDay = (() => { const t = new Date(end); t.setDate(t.getDate() - (STATE.windowDays - 1)); return _fmtDate(t); })();
    const wx = await _fetchWeather(zone, firstDay, _fmtDate(end));
    const nulls = () => new Array(slotsPerDay).fill(null);

    for (let d = STATE.windowDays - 1; d >= 0; d--) {
      const dt = new Date(end);
      dt.setDate(dt.getDate() - d);
      const dateStr = _fmtDate(dt);
      const daily = await _fetchDaily(dateStr);
      const zd = daily && daily.zones && daily.zones[zone];

      let priceSrc, windSrc, solarSrc, sourceSlots, isReal;
      let mixSrc = null; // real per-fuel generation arrays (MW) when archived
      if (zd && Array.isArray(zd.hourly)) {
        sourceSlots = zd.hourly.length === 96 ? 96 : 24;
        priceSrc = zd.hourly;
        windSrc = (Array.isArray(zd.wind) && zd.wind.length) ? zd.wind : (zd.windOnshore || []);
        solarSrc = zd.solar || [];
        isReal = true;
        // Real generation mix (MW per slot) from ENTSO-E actuals, same resolution as hourly
        const hasMix = ['nuclear', 'hydro', 'fossil'].some(k => Array.isArray(zd[k]) && zd[k].length);
        if (hasMix) {
          mixSrc = {
            nuclear: zd.nuclear || [], hydro: zd.hydro || [], fossil: zd.fossil || [],
            biomass: zd.biomass || [], other: zd.other || [],
          };
        }
      } else {
        // No archived day: leave it empty rather than inventing a curve.
        sourceSlots = 24;
        priceSrc = []; windSrc = []; solarSrc = [];
        isReal = false;
      }
      // Generation arrays share the hourly resolution (96 or 24); synth fallback is 24.
      const genSlots = sourceSlots;

      const price = _resample(priceSrc, sourceSlots, slotsPerDay);
      const wind = _resample(windSrc, genSlots, slotsPerDay);
      const solar = _resample(solarSrc, genSlots, slotsPerDay);
      const mix = mixSrc ? {
        nuclear: _resample(mixSrc.nuclear, genSlots, slotsPerDay),
        hydro:   _resample(mixSrc.hydro,   genSlots, slotsPerDay),
        fossil:  _resample(mixSrc.fossil,  genSlots, slotsPerDay),
        biomass: _resample(mixSrc.biomass, genSlots, slotsPerDay),
        other:   _resample(mixSrc.other,   genSlots, slotsPerDay),
      } : { nuclear: nulls(), hydro: nulls(), fossil: nulls(), biomass: nulls(), other: nulls() };
      const totalGen = Array.from({ length: slotsPerDay }, (_, i) => {
        const parts = [mix.nuclear[i], mix.hydro[i], mix.fossil[i], mix.biomass[i], mix.other[i], wind[i], solar[i]];
        return parts.every(v => v == null) ? null : parts.reduce((a, v) => a + (v || 0), 0);
      });
      // Demand: ENTSO-E load when stored for the day; net import = load − generation.
      const loadReal = zd && Array.isArray(zd.load) && zd.load.some(v => v) ? _resample(zd.load, zd.load.length === 96 ? 96 : 24, slotsPerDay) : null;
      const load = loadReal || nulls();
      const flux = loadReal ? loadReal.map((v, i) => v == null || totalGen[i] == null ? null : (v - totalGen[i]) / 1000) : nulls();
      // Weather (hourly → slots)
      const wd = wx && wx[dateStr];
      const temp = wd ? _resample(wd.temp, 24, slotsPerDay) : nulls();
      const windSpeed = wd ? _resample(wd.wind, 24, slotsPerDay) : nulls();
      // Gas & carbon: day-ahead TTF traded the day before, EUA close (flat intraday)
      const refs = window.PKC ? PKC.refsFor(dateStr) : {};
      const ttfV = refs.ttf != null ? refs.ttf : ((daily && typeof daily.ttf === 'number') ? daily.ttf : null);
      const ttf = new Array(slotsPerDay).fill(ttfV);
      const eua = new Array(slotsPerDay).fill(refs.eua != null ? refs.eua : null);
      // Nuclear: FR available capacity (SEFE, daily); other zones actual output
      const frAvail = (zone === 'FR' && window.PKC) ? PKC.valueOn('fr_nuc_avail', dateStr) : null;
      const nucAvail = frAvail != null ? new Array(slotsPerDay).fill(frAvail / 1000) : mix.nuclear.map(v => v == null ? null : v / 1000);

      const spark = price.map((p, i) => (window.PKC ? PKC.cleanSpark(p, ttf[i], eua[i]) : null));

      const carbon = [];
      for (let i = 0; i < slotsPerDay; i++) {
        const gens = {
          nuclear: mix.nuclear[i], hydro: mix.hydro[i], fossil: mix.fossil[i],
          biomass: mix.biomass[i], other: mix.other[i],
          wind: wind[i] || 0, solar: solar[i] || 0,
        };
        let totGen = 0, totCO2 = 0;
        for (const f in gens) {
          totGen += gens[f] || 0;
          totCO2 += (gens[f] || 0) * (CO2_FACTORS[f] || 0);
        }
        carbon.push(totGen > 0 ? totCO2 / totGen : null);
      }

      days.push({
        date: dateStr, jsDate: dt, dow: dt.toLocaleDateString('en-GB', { weekday: 'long' }),
        isReal: isReal, price: price, spark: spark, wind: wind, solar: solar, load: load,
        mix: mix, carbon: carbon,
        drivers: { ttf: ttf, eua: eua, windSpeed: windSpeed, temp: temp, nucAvail: nucAvail, flux: flux },
      });
    }

    const flat = {
      price: [], spark: [], wind: [], solar: [], load: [], carbon: [],
      mix: { nuclear: [], hydro: [], fossil: [], biomass: [], other: [] },
      drivers: { ttf: [], eua: [], windSpeed: [], temp: [], nucAvail: [], flux: [] },
      labels: [], slotDates: [],
    };
    days.forEach(day => {
      for (let i = 0; i < slotsPerDay; i++) {
        const dt = new Date(day.jsDate);
        dt.setMinutes(i * gran.minutes);
        flat.slotDates.push(dt);
        flat.labels.push(_slotShortLabel(dt, gran));
        flat.price.push(day.price[i]);
        flat.spark.push(day.spark[i]);
        const gw = v => v == null ? null : v / 1000;
        flat.wind.push(gw(day.wind[i]));
        flat.solar.push(gw(day.solar[i]));
        flat.load.push(gw(day.load[i]));
        flat.carbon.push(day.carbon[i]);
        ['nuclear', 'hydro', 'fossil', 'biomass', 'other'].forEach(f => {
          flat.mix[f].push(gw(day.mix[f][i]));
        });
        flat.drivers.ttf.push(day.drivers.ttf[i]);
        flat.drivers.eua.push(day.drivers.eua[i]);
        flat.drivers.windSpeed.push(day.drivers.windSpeed[i]);
        flat.drivers.temp.push(day.drivers.temp[i]);
        flat.drivers.nucAvail.push(day.drivers.nucAvail[i]);
        flat.drivers.flux.push(day.drivers.flux[i]);
      }
    });

    return { zone: zone, days: days, flat: flat, slotsPerDay: slotsPerDay, gran: gran };
  }

  function _slotShortLabel(dt, gran) {
    if (gran.key === '1D') return _dayLabel(dt);
    const h = String(dt.getHours()).padStart(2, '0');
    const m = String(dt.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  // ════════════════════════════════════════════════════════════════
  // KEY MOMENTS DETECTION
  // ════════════════════════════════════════════════════════════════

  function _detectKeyMoments(data) {
    const f = data.flat;
    const moments = [];
    if (!f.price.length) return moments;

    // Only slots with a price (days without archived data are empty).
    let floorIdx = -1, peakIdx = -1;
    for (let i = 0; i < f.price.length; i++) {
      const p = f.price[i]; if (p == null) continue;
      if (floorIdx < 0 || p < f.price[floorIdx]) floorIdx = i;
      if (peakIdx < 0 || p > f.price[peakIdx]) peakIdx = i;
    }
    if (floorIdx < 0) return moments;
    moments.push({ idx: floorIdx, kind: 'floor' });
    moments.push({ idx: peakIdx, kind: 'peak' });

    let cannibalIdx = -1, cannibalScore = -Infinity;
    f.solar.forEach((s, i) => {
      const score = s - f.price[i] * 0.02;
      if (s != null && f.price[i] != null && s > 4 && f.price[i] < 30 && score > cannibalScore) {
        cannibalScore = score; cannibalIdx = i;
      }
    });
    if (cannibalIdx >= 0 && cannibalIdx !== floorIdx) {
      moments.push({ idx: cannibalIdx, kind: 'cannibalisation' });
    }

    let weekendIdx = -1;
    for (let i = 0; i < f.slotDates.length; i++) {
      const dt = f.slotDates[i];
      if ((dt.getDay() === 0 || dt.getDay() === 6) && weekendIdx === -1) {
        const slotsPerDay = data.slotsPerDay;
        weekendIdx = Math.floor(i / slotsPerDay) * slotsPerDay + Math.floor(slotsPerDay / 2);
        break;
      }
    }
    if (weekendIdx >= 0 && weekendIdx !== floorIdx && weekendIdx !== peakIdx && weekendIdx !== cannibalIdx) {
      moments.push({ idx: weekendIdx, kind: 'weekend' });
    }

    moments.sort((a, b) => a.idx - b.idx);
    return moments.slice(0, 4);
  }

  // ════════════════════════════════════════════════════════════════
  // NARRATIVE GENERATION
  // ════════════════════════════════════════════════════════════════

  function _narrate(moment, data) {
    const f = data.flat;
    const i = moment.idx;
    const price = f.price[i];
    const wind = f.wind[i];
    const solar = f.solar[i];
    const load = f.load[i];
    const spark = f.spark[i];
    const ttf = f.drivers.ttf[i];
    const eua = f.drivers.eua[i];
    const windSpeed = f.drivers.windSpeed[i];
    const fossil = f.mix.fossil[i];
    const dt = f.slotDates[i];
    const dow = dt.toLocaleDateString('en-GB', { weekday: 'long' });
    const time = String(dt.getHours()).padStart(2, '0') + 'h';
    // Demand: ENTSO-E load when stored, otherwise total generation.
    const totGen = ['nuclear', 'hydro', 'fossil', 'biomass', 'other'].reduce((t, k) => t + (f.mix[k][i] || 0), 0) + (wind || 0) + (solar || 0);
    const demand = load != null ? load : totGen;
    const renCover = demand ? (((wind || 0) + (solar || 0)) / demand * 100).toFixed(0) : '--';
    const fmt = (v, d) => (v == null || isNaN(v)) ? '--' : v.toFixed(d == null ? 1 : d);
    const dowCap = dow.charAt(0).toUpperCase() + dow.slice(1);

    let title, body;
    if (moment.kind === 'floor') {
      title = dowCap + ' ' + time + ' · wind sets the price';
      body = 'Wind at ' + fmt(windSpeed) + ' m/s (100 m) so <b style="color:#fff">' + fmt(wind) + ' GW of wind</b> covers <b style="color:#fff">' + renCover + '%</b> of demand, so fossil drops out of the merit order (' + fmt(fossil) + ' GW), so spark plunges to <b style="color:#fff">' + (spark >= 0 ? '+' : '') + fmt(spark, 0) + ' €</b>, so price touches <b style="color:#14D3A9">' + fmt(price, 1) + ' €</b>.';
    } else if (moment.kind === 'peak') {
      title = dowCap + ' ' + time + ' · spike';
      body = 'Wind dropped to ' + fmt(windSpeed) + ' m/s so only <b style="color:#ED6965">' + fmt(wind) + ' GW</b>, demand at ' + fmt(demand) + ' GW, so gas CCGT sets the margin at <b style="color:#fff">' + fmt(fossil) + ' GW</b>, spark explodes to <b style="color:#fff">' + (spark >= 0 ? '+' : '') + fmt(spark, 0) + ' €</b>. TTF ' + fmt(ttf, 0) + ' · EUA ' + fmt(eua, 0) + '.';
    } else if (moment.kind === 'cannibalisation') {
      const solarCover = demand ? ((solar || 0) / demand * 100).toFixed(0) : '--';
      title = dowCap + ' ' + time + ' · duck curve';
      body = 'Solar at <b style="color:#fff">' + fmt(solar) + ' GW</b> covers ' + solarCover + '% of demand in the middle of low demand, so classic cannibalisation. Midday price at <b style="color:#A78BFA">' + fmt(price, 1) + ' €</b>. Solar capture rate hit.';
    } else {
      title = dowCap + ' · weekend lull';
      body = 'Industry idle so load <b style="color:#fff">' + fmt(demand) + ' GW</b>, nuclear modulating, hydro in storage mode. No system stress, average price ' + fmt(price, 0) + ' €.';
    }
    return { title: title, body: body, price: fmt(price, price < 1 ? 2 : 1), spark: fmt(spark, 0) };
  }

  // ════════════════════════════════════════════════════════════════
  // RENDER · DRIVERS STRIP
  // ════════════════════════════════════════════════════════════════

  function _renderDriversStrip() {
    const host = document.getElementById('ma-drivers-strip');
    if (!host) return;
    const f = STATE.data.flat;
    const drivers = [
      { id: 'ttf',  label: 'TTF',       series: f.drivers.ttf,       color: DRIVER_COLOURS.ttf,  dec: 1, unit: '€' },
      { id: 'eua',  label: 'EUA',       series: f.drivers.eua,       color: DRIVER_COLOURS.eua,  dec: 1, unit: '€' },
      { id: 'wind', label: 'Wind 100 m', series: f.drivers.windSpeed, color: DRIVER_COLOURS.wind, dec: 1, unit: 'm/s' },
      { id: 'temp', label: 'Temp',       series: f.drivers.temp,      color: DRIVER_COLOURS.temp, dec: 1, unit: '°C' },
      { id: 'nuc',  label: STATE.zone === 'FR' ? 'Nuc avail.' : 'Nuc output', series: f.drivers.nucAvail, color: DRIVER_COLOURS.nuc, dec: 1, unit: 'GW' },
      { id: 'flux', label: 'Net import', series: f.drivers.flux,      color: DRIVER_COLOURS.flux, dec: 1, unit: 'GW' },
    ];
    const fx = (v, d) => (v == null || isNaN(v)) ? '--' : v.toFixed(d);

    let html = '<div class="ma-kpi-row">';
    drivers.forEach((d) => {
      const valid = d.series.filter(v => v != null && !isNaN(v));
      const v0 = valid.length ? valid[0] : null, vN = valid.length ? valid[valid.length - 1] : null;
      const delta = (v0 != null && vN != null) ? vN - v0 : 0;
      const deltaPct = v0 ? (delta / Math.abs(v0)) * 100 : 0;
      const isFlat = !valid.length || Math.abs(deltaPct) < 1;
      const cls = isFlat ? 'flat' : (delta > 0 ? 'up' : 'down');
      const arrow = isFlat ? '·' : (delta > 0 ? '▲' : '▼');
      const deltaTxt = !valid.length ? 'no data' : isFlat ? '—' : (arrow + ' ' + Math.abs(deltaPct).toFixed(0) + '%');
      const min = valid.length ? Math.min.apply(null, valid) : 0;
      const max = valid.length ? Math.max.apply(null, valid) : 1;
      const range = (max - min) || 1;
      let pen = 'M';
      const pts = d.series.map((v, idx) => {
        if (v == null || isNaN(v)) { pen = 'M'; return ''; }
        const x = (idx / (d.series.length - 1)) * 100;
        const y = 15 - ((v - min) / range) * 13;
        const seg = pen + ' ' + x.toFixed(1) + ' ' + y.toFixed(1); pen = 'L'; return seg;
      }).join(' ');
      html += '<div class="ma-kpi-card" style="--kpi-accent:' + d.color + '">'
        + '<div class="ma-kpi-head">'
        +   '<span class="ma-kpi-label">' + d.label + '</span>'
        +   '<svg class="ma-kpi-spark" viewBox="0 0 100 16" preserveAspectRatio="none"><path d="' + pts + '" stroke="' + d.color + '" stroke-width="1.6" fill="none"/></svg>'
        + '</div>'
        + '<div class="ma-kpi-val">' + fx(vN, d.dec) + '<span class="u">' + d.unit + '</span></div>'
        + '<div class="ma-kpi-delta ' + cls + '">' + deltaTxt + '</div>'
        + '</div>';
    });
    html += '</div>';
    host.innerHTML = html;
  }

  // ════════════════════════════════════════════════════════════════
  // CROSSHAIR PLUGIN
  // ════════════════════════════════════════════════════════════════

  // Crosshair is drawn as a single continuous overlay spanning all panels
  // (see _positionCrosshair), so the per-chart plugin is now a no-op.
  const crosshairPlugin = { id: 'maCrosshair' };

  // ════════════════════════════════════════════════════════════════
  // RENDER · MAIN PANELS
  // ════════════════════════════════════════════════════════════════

  function _buildXLabels() {
    const f = STATE.data.flat;
    const slotsPerDay = STATE.data.slotsPerDay;
    return f.slotDates.map((dt, i) => {
      const slotInDay = i % slotsPerDay;
      if (slotInDay === 0) {
        return dt.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
      }
      return '';
    });
  }

  function _commonChartOpts(yTitle) {
    return {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false },
          ticks: {
            color: '#7A93AB', font: { family: 'JetBrains Mono', size: 10 },
            autoSkip: false, maxRotation: 0,
            callback: function (val, idx) {
              const labels = _buildXLabels();
              return labels[idx] || '';
            },
          },
        },
        y: {
          afterFit: function (scale) { scale.width = 48; },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 11 }, maxTicksLimit: 4 },
          title: { display: false },
        },
      },
      onHover: function (event, items) {
        if (items && items.length > 0) {
          _updateHoverIndex(items[0].index, event);
        }
      },
    };
  }

  function _mkChart(canvasId, type, data, options) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    if (STATE.charts[canvasId]) { try { STATE.charts[canvasId].destroy(); } catch (_) {} }
    options.plugins = options.plugins || {};
    STATE.charts[canvasId] = new window.Chart(canvas, {
      type: type, data: data, options: options, plugins: [crosshairPlugin],
    });
  }

  function _renderPanels() {
    const f = STATE.data.flat;
    const labels = f.labels;

    _mkChart('ma-canvas-price', 'line', {
      labels: labels,
      datasets: [{
        label: 'DA Price', data: f.price,
        borderColor: '#E6EDF3', borderWidth: 1.4, pointRadius: 0,
        tension: 0, spanGaps: false,
      }],
    }, _commonChartOpts('€/MWh'));

    _mkChart('ma-canvas-spark', 'line', {
      labels: labels,
      datasets: [{
        label: 'Spark', data: f.spark,
        borderColor: '#ED6965', borderWidth: 1.4, pointRadius: 0,
        tension: 0, spanGaps: false,
        backgroundColor: function (ctx) {
          if (!ctx.chart || !ctx.chart.ctx) return 'rgba(237,105,101,0.10)';
          const c = ctx.chart.ctx;
          const grad = c.createLinearGradient(0, 0, 0, ctx.chart.height);
          grad.addColorStop(0, 'rgba(237,105,101,0.0)');
          grad.addColorStop(1, 'rgba(237,105,101,0.18)');
          return grad;
        },
        fill: 'origin',
      }],
    }, _commonChartOpts('€/MWh CCGT'));

    _mkChart('ma-canvas-loadren', 'line', {
      labels: labels,
      datasets: [
        {
          label: 'Solar', data: f.solar,
          backgroundColor: _hexA(FUEL_COLORS.solar, 0.45),
          borderColor: 'transparent', borderWidth: 0,
          fill: 'origin', pointRadius: 0, tension: 0, stack: 'ren',
        },
        {
          label: 'Wind', data: f.wind,
          backgroundColor: _hexA(FUEL_COLORS.wind, 0.55),
          borderColor: 'transparent', borderWidth: 0,
          fill: 'origin', pointRadius: 0, tension: 0, stack: 'ren',
        },
        {
          label: 'Load', data: f.load,
          borderColor: '#fff', borderWidth: 1.5, borderDash: [3, 2],
          pointRadius: 0, tension: 0, fill: false,
        },
      ],
    }, _commonChartOpts('GW'));
    _renderPanelLegend('ma-legend-loadren', [
      { label: 'Solar', color: FUEL_COLORS.solar },
      { label: 'Wind', color: FUEL_COLORS.wind },
      { label: 'Load', color: '#fff' },
    ]);

    const stackDatasets = FUEL_STACK.map(function (fuel) {
      const data = (fuel === 'wind' || fuel === 'solar') ? f[fuel] : f.mix[fuel];
      return {
        label: FUEL_LABELS[fuel], data: data,
        backgroundColor: _hexA(FUEL_COLORS[fuel], 0.78),
        borderColor: FUEL_COLORS[fuel], borderWidth: 0,
        fill: true, pointRadius: 0, tension: 0, stack: 'mix',
      };
    });
    const mixOpts = _commonChartOpts('GW');
    mixOpts.scales.y.stacked = true;
    mixOpts.scales.y.beginAtZero = true;
    _mkChart('ma-canvas-mix', 'line', { labels: labels, datasets: stackDatasets }, mixOpts);
    _renderPanelLegend('ma-legend-mix', FUEL_STACK.map(function (fuel) {
      return { label: FUEL_LABELS[fuel], color: FUEL_COLORS[fuel] };
    }));
  }

  // Static colour-key for the two multi-series panels (Demande vs Ren, Mix
  // supply) — their Chart.js legend is off (plugins.legend.display:false,
  // the shared crosshair tooltip handles per-value labelling on hover), but
  // with the mouse away there was previously no way to tell the series apart.
  function _renderPanelLegend(hostId, items) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = items.map(function (it) {
      return '<span><span class="dot" style="background:' + it.color + '"></span>' + it.label + '</span>';
    }).join('');
  }

  // ════════════════════════════════════════════════════════════════
  // CROSSHAIR + HOVER TOOLTIP
  // ════════════════════════════════════════════════════════════════

  function _updateHoverIndex(idx, event) {
    STATE.hoverIndex = idx;
    _positionCrosshair(idx);
    _renderTooltip(idx, event);
  }

  function _clearHover() {
    STATE.hoverIndex = -1;
    const line = document.getElementById('ma-crosshair-line');
    if (line) line.style.display = 'none';
    const tip = document.getElementById('ma-hover-tooltip');
    if (tip) tip.style.display = 'none';
  }

  // Single vertical bar across the whole panel section. Because every chart
  // now shares the same y-axis width (afterFit), the x-pixel from any chart
  // is valid for the full stack, so the line is perfectly aligned everywhere.
  function _positionCrosshair(idx) {
    const wrap = document.getElementById('ma-panels-wrap');
    if (!wrap) return;
    let line = document.getElementById('ma-crosshair-line');
    if (!line) {
      line = document.createElement('div');
      line.id = 'ma-crosshair-line';
      line.style.cssText = 'position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.45);pointer-events:none;z-index:4;display:none';
      wrap.appendChild(line);
    }
    const chart = STATE.charts['ma-canvas-price'];
    if (!chart || idx < 0 || !chart.scales || !chart.scales.x) { line.style.display = 'none'; return; }
    const xPix = chart.scales.x.getPixelForValue(idx);
    if (xPix == null || isNaN(xPix)) { line.style.display = 'none'; return; }
    const wrapRect = wrap.getBoundingClientRect();
    const canvasRect = chart.canvas.getBoundingClientRect();
    line.style.left = ((canvasRect.left - wrapRect.left) + xPix) + 'px';
    line.style.display = 'block';
  }

  function _renderTooltip(idx, event) {
    const tip = document.getElementById('ma-hover-tooltip');
    if (!tip) return;
    const f = STATE.data.flat;
    if (idx < 0 || idx >= f.price.length) { tip.style.display = 'none'; return; }

    const dt = f.slotDates[idx];
    const dateLbl = dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const timeLbl = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');

    const price = f.price[idx];
    const spark = f.spark[idx];
    const load = f.load[idx];
    const wind = f.wind[idx];
    const solar = f.solar[idx];
    const nuc = f.mix.nuclear[idx];
    const hydro = f.mix.hydro[idx];
    const fossil = f.mix.fossil[idx];
    const ttf = f.drivers.ttf[idx];
    const eua = f.drivers.eua[idx];
    const windS = f.drivers.windSpeed[idx];
    const temp = f.drivers.temp[idx];
    const nucA = f.drivers.nucAvail[idx];
    const flux = f.drivers.flux[idx];

    // Null-safe formatter: ENTSO-E slots can have gaps; show '--' instead of crashing
    const fx = (v, d) => (v == null || isNaN(v)) ? '--' : v.toFixed(d == null ? 1 : d);

    let marginal = 'Hydro / STEP', marginalClass = 'hydro';
    if (fossil > 0.5) { marginal = 'Gas CCGT'; marginalClass = 'gas'; }

    const priceClass = price < 5 ? 'floor' : (price > 100 ? 'peak' : '');
    const sparkClass = spark < 0 ? 'floor' : (spark > 20 ? 'peak' : '');
    const priceColor = priceClass === 'peak' ? '#ED6965' : (priceClass === 'floor' ? '#14D3A9' : '#E6EDF3');
    const sparkColor = sparkClass === 'peak' ? '#ED6965' : (sparkClass === 'floor' ? '#14D3A9' : '#E6EDF3');
    const mgColor = marginalClass === 'gas' ? '#ED6965' : '#3FA6B4';
    const dot = (c) => '<span class="ma-ht-dot" style="background:' + c + '"></span>';

    tip.innerHTML =
      '<div class="ma-ht-time">' + dateLbl + ' · ' + timeLbl + '</div>'
      + '<div class="ma-ht-hero">'
      +   '<div class="ma-ht-hero-cell" style="border-left-color:' + priceColor + '"><div class="lab">DA Price</div><div class="big" style="color:' + priceColor + '">' + fx(price, price < 1 ? 2 : 1) + ' <span class="u">€</span></div></div>'
      +   '<div class="ma-ht-hero-cell" style="border-left-color:' + sparkColor + '"><div class="lab">Spark CCGT</div><div class="big" style="color:' + sparkColor + '">' + (spark >= 0 ? '+' : '') + fx(spark, 0) + ' <span class="u">€</span></div></div>'
      + '</div>'
      + '<div class="ma-ht-marginal" style="background:' + _hexA(mgColor, 0.15) + ';color:' + mgColor + '">' + dot(mgColor) + 'Marginal · ' + marginal + '</div>'
      + '<div class="ma-ht-section">Demand &amp; mix</div>'
      + '<div class="ma-ht-grid">'
      +   '<div class="ma-ht-row"><span class="k">' + dot('#E6EDF3') + 'Load</span><span class="v">' + fx(load, 1) + ' GW</span></div>'
      +   '<div class="ma-ht-row"><span class="k">' + dot(FUEL_COLORS.wind) + 'Wind</span><span class="v">' + fx(wind, 1) + ' GW</span></div>'
      +   '<div class="ma-ht-row"><span class="k">' + dot(FUEL_COLORS.solar) + 'Solar</span><span class="v">' + fx(solar, 1) + ' GW</span></div>'
      +   '<div class="ma-ht-row"><span class="k">' + dot(FUEL_COLORS.nuclear) + 'Nuc</span><span class="v">' + fx(nuc, 1) + ' GW</span></div>'
      +   '<div class="ma-ht-row"><span class="k">' + dot(FUEL_COLORS.hydro) + 'Hydro</span><span class="v">' + fx(hydro, 1) + ' GW</span></div>'
      +   '<div class="ma-ht-row"><span class="k">' + dot(FUEL_COLORS.fossil) + 'Fossil</span><span class="v ' + (fossil > 1 ? 'gas' : '') + '">' + fx(fossil, 1) + ' GW</span></div>'
      + '</div>'
      + '<div class="ma-ht-section">Drivers</div>'
      + '<div class="ma-ht-grid">'
      +   '<div class="ma-ht-row"><span class="k">' + dot(DRIVER_COLOURS.ttf) + 'TTF</span><span class="v">' + fx(ttf, 1) + ' €</span></div>'
      +   '<div class="ma-ht-row"><span class="k">' + dot(DRIVER_COLOURS.eua) + 'EUA</span><span class="v">' + fx(eua, 1) + ' €</span></div>'
      +   '<div class="ma-ht-row"><span class="k">' + dot(DRIVER_COLOURS.wind) + 'Vent</span><span class="v">' + fx(windS, 0) + ' m/s</span></div>'
      +   '<div class="ma-ht-row"><span class="k">' + dot(DRIVER_COLOURS.temp) + 'Temp</span><span class="v">' + fx(temp, 0) + '°C</span></div>'
      +   '<div class="ma-ht-row"><span class="k">' + dot(DRIVER_COLOURS.nuc) + 'Nuc dispo</span><span class="v">' + fx(nucA, 0) + ' GW</span></div>'
      +   '<div class="ma-ht-row"><span class="k">' + dot(DRIVER_COLOURS.flux) + 'Flux</span><span class="v">' + (flux > 0 ? '+' : '') + fx(flux, 1) + ' GW</span></div>'
      + '</div>';

    tip.style.display = 'block';
    const wrap = document.getElementById('ma-panels-wrap');
    if (!wrap || !event || event.clientX == null) return;
    const rect = wrap.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = (event.clientY != null) ? event.clientY - rect.top : 10;
    const tipW = tip.offsetWidth || 280;
    const tipH = tip.offsetHeight || 200;
    const margin = 12;
    let left = (x + tipW + margin > rect.width) ? x - tipW - margin : x + margin;
    left = Math.max(4, Math.min(rect.width - tipW - 4, left));
    let top = y - tipH / 2;
    top = Math.max(4, Math.min(rect.height - tipH - 4, top));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  // ════════════════════════════════════════════════════════════════
  // RENDER · EPISODES + CURSOR BADGES
  // ════════════════════════════════════════════════════════════════

  function _renderEpisodes() {
    const host = document.getElementById('ma-episodes');
    if (!host) return;
    const moments = STATE.cursors;
    if (!moments.length) {
      host.innerHTML = '<div style="color:var(--tx3);font-family:\'JetBrains Mono\',monospace;font-size:11px;padding:10px">No key moment detected. Flat market or insufficient data.</div>';
      return;
    }
    host.innerHTML = moments.map(function (m, i) {
      const n = _narrate(m, STATE.data);
      const colour = EPISODE_KIND_COLOURS[m.kind] || '#7A93AB';
      return '<div class="ma-episode-card" data-cursor-idx="' + m.idx + '" style="background:' + _hexA(colour, 0.05) + ';border-left-color:' + colour + '">'
        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">'
        + '<div class="ma-badge" style="background:' + _hexA(colour, 0.18) + ';color:' + colour + '">' + (i + 1) + '</div>'
        + '<div style="font-size:11.5px;color:#fff;font-weight:700">' + n.title + '</div>'
        + '<div style="margin-left:auto;font-family:\'JetBrains Mono\',monospace;font-size:9px;color:' + colour + ';font-weight:700">' + n.price + ' €</div>'
        + '</div>'
        + '<div style="font-size:11px;color:#B8C9D9;line-height:1.65">' + n.body + '</div>'
        + '</div>';
    }).join('');

    Array.prototype.forEach.call(host.querySelectorAll('.ma-episode-card'), function (card) {
      card.addEventListener('click', function () {
        const idx = parseInt(card.getAttribute('data-cursor-idx'), 10);
        if (!isNaN(idx)) _updateHoverIndex(idx, { clientX: 0 });
      });
    });
  }

  function _renderCursorBadges() {
    const host = document.getElementById('ma-cursor-badges');
    if (!host) return;
    const moments = STATE.cursors;
    const labels = { floor: 'Floor', peak: 'Peak', cannibalisation: 'Cannibal', weekend: 'Weekend' };
    host.innerHTML = moments.map(function (m, i) {
      const colour = EPISODE_KIND_COLOURS[m.kind] || '#7A93AB';
      const dt = STATE.data.flat.slotDates[m.idx];
      const day = dt.toLocaleDateString('en-GB', { weekday: 'short' });
      const time = String(dt.getHours()).padStart(2, '0') + 'h';
      const price = STATE.data.flat.price[m.idx];
      return '<span class="ma-cursor-badge" style="color:' + colour + ';border-color:' + _hexA(colour, 0.4) + ';background:' + _hexA(colour, 0.12) + '">'
        + '<b>' + (i + 1) + ' · ' + (labels[m.kind] || m.kind) + '</b>&nbsp; ' + day + ' ' + time + ' · ' + (price == null ? '--' : price.toFixed(price < 1 ? 2 : 1)) + ' €'
        + '</span>';
    }).join('');
  }

  // ════════════════════════════════════════════════════════════════
  // AI SYNTHESIS
  // ════════════════════════════════════════════════════════════════

  function _r(v, d) { return v == null || isNaN(v) || !isFinite(v) ? null : +(+v).toFixed(d); }
  function _avg(a) { const v = (a || []).filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; }
  function _buildAIContext() {
    const f = STATE.data.flat;
    const moments = STATE.cursors.map(function (m) {
      const dt = f.slotDates[m.idx];
      return {
        kind: m.kind,
        date: dt.toISOString().slice(0, 16),
        price: _r(f.price[m.idx], 1),
        spark: _r(f.spark[m.idx], 0),
        wind_GW: _r(f.wind[m.idx], 1),
        solar_GW: _r(f.solar[m.idx], 1),
        load_GW: _r(f.load[m.idx], 1),
        fossil_GW: _r(f.mix.fossil[m.idx], 1),
        wind_speed: _r(f.drivers.windSpeed[m.idx], 0),
        ttf: _r(f.drivers.ttf[m.idx], 1),
        eua: _r(f.drivers.eua[m.idx], 1),
      };
    });
    const prices = f.price.filter(function (p) { return p != null; });
    const sparks = f.spark.filter(function (p) { return p != null; });
    return {
      zone: STATE.zone,
      window_days: STATE.windowDays,
      granularity: STATE.granularity,
      price_min: _r(Math.min.apply(null, prices), 1),
      price_max: _r(Math.max.apply(null, prices), 1),
      price_avg: _r(_avg(prices), 1),
      spark_min: _r(Math.min.apply(null, sparks), 0),
      spark_max: _r(Math.max.apply(null, sparks), 0),
      ttf_avg: _r(_avg(f.drivers.ttf), 1),
      eua_avg: _r(_avg(f.drivers.eua), 1),
      negative_hours: prices.filter(function (p) { return p < 0; }).length,
      moments: moments,
    };
  }

  window.maGenerateAI = async function () {
    if (STATE.aiBusy) return;
    const out = document.getElementById('ma-ai-content');
    const btn = document.getElementById('ma-ai-btn');
    if (!out) return;
    STATE.aiBusy = true;
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Analysing...'; }
    out.innerHTML = '<div style="color:var(--tx3);font-family:\'JetBrains Mono\',monospace;font-size:11px;padding:10px">Building causal market read...</div>';

    const ctx = _buildAIContext();
    const systemPrompt = 'You are a senior power market analyst writing for a director-level origination audience (PPA, BESS, supply). Given window data with prices, spark spread, key moments and drivers (TTF, EUA, wind, weather, nuclear, flows), write a SHORT causal market read.\n\nStyle:\n- Trading desk morning note tone\n- UK English\n- 3-5 punchy sentences, no bullets\n- Each sentence chains causes: "X happened, therefore Y, therefore Z"\n- Be specific with numbers\n- Use <b style="color:#fff">…</b> to highlight key figures, fuels, and turning points\n- Use <b style="color:#14D3A9">…</b> for positive/floor values and <b style="color:#ED6965">…</b> for peaks/risks\n- Focus on what an originator needs: capture rates, marginal fuel switches, BESS arbitrage spreads, PPA stress signals\n- No preamble. Just the text.\n\nReading order: the weather drives the supply mix, which drives the marginal fuel and price. If TTF and EUA are stable, the price story is physical (weather, availability), not commodity. Reflect this hierarchy explicitly.';

    const userPrompt = 'Analyse this ' + ctx.window_days + '-day window for ' + ctx.zone + ':\n\n' + JSON.stringify(ctx, null, 2);

    // AI proxy URL — your Cloudflare Worker (holds the API key server-side).
    // Replace YOUR-SUBDOMAIN with your deployed Worker URL after setup.
    const MA_AI_PROXY = 'https://powerklock-ai.tom-s-remy.workers.dev';

    try {
      const response = await fetch(MA_AI_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      const data = await response.json();
      const text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
      out.innerHTML = '<div style="font-family:\'Inter\',sans-serif;font-size:12px;color:#B8C9D9;line-height:1.7">' + (text || 'No response received.') + '</div>';
    } catch (err) {
      out.innerHTML = '<div style="color:#ED6965;font-family:\'JetBrains Mono\',monospace;font-size:11px;padding:10px">API error: ' + err.message + '. On a static deployment a serverless proxy is needed to hide the API key.</div>';
    } finally {
      STATE.aiBusy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '✦ Generate causal market read'; }
    }
  };

  // ════════════════════════════════════════════════════════════════
  // CONTROLS + LIFECYCLE
  // ════════════════════════════════════════════════════════════════

  function _paintControls() {
    const pkPill = window.pkPill || function (o) {
      return '<button onclick="' + o.onClick + '" style="padding:4px 10px;font-size:9px;border-radius:12px;cursor:pointer;background:' + (o.active ? 'rgba(20,211,169,0.15)' : 'transparent') + ';color:' + (o.active ? '#14D3A9' : 'var(--tx3)') + ';border:1px solid ' + (o.active ? 'rgba(20,211,169,0.4)' : 'var(--bd)') + ';font-family:\'JetBrains Mono\',monospace;font-weight:600">' + o.label + '</button>';
    };

    const win = document.getElementById('ma-window-pills');
    if (win) {
      win.innerHTML = WINDOWS.map(function (w) {
        return pkPill({ label: w.label, active: w.key === STATE.windowDays, onClick: 'maSetWindow(' + w.key + ')' });
      }).join('');
    }

    const gran = document.getElementById('ma-granularity-pills');
    if (gran) {
      gran.innerHTML = GRANULARITIES.map(function (g) {
        return pkPill({ label: g.label, active: g.key === STATE.granularity, onClick: 'maSetGranularity(\'' + g.key + '\')' });
      }).join('');
    }
  }

  async function _reload() {
    const host = document.getElementById('ma-panels-wrap');
    if (host) host.style.opacity = '0.5';
    STATE.data = await _assemble();
    STATE.cursors = _detectKeyMoments(STATE.data);
    if (host) host.style.opacity = '1';
    _paintControls();
    _renderDriversStrip();
    _renderPanels();
    _renderEpisodes();
    _renderCursorBadges();
  }

  window.maSetWindow = function (days) { STATE.windowDays = days; _reload(); };
  window.maSetGranularity = function (g) { STATE.granularity = g; _reload(); };
  window.maSetZone = function (zone) { STATE.zone = zone; _reload(); };

  // Native fullscreen on the whole 4-panel group, not the usual per-chart
  // addFullscreen() — these panels share one crosshair/hover tooltip across
  // all 4, so isolating a single canvas would break the sync they're built
  // around. Chart.js canvases need an explicit resize() nudge once the
  // container's real size settles post-transition.
  window.maFullscreenPanels = function () {
    const wrap = document.getElementById('ma-panels-wrap');
    if (!wrap) return;
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    wrap.requestFullscreen().then(function () {
      setTimeout(function () {
        Object.keys(STATE.charts).forEach(function (id) {
          const c = STATE.charts[id];
          if (c && typeof c.resize === 'function') c.resize();
        });
      }, 120);
    }).catch(function (e) { console.warn('[market-analysis] fullscreen failed', e); });
  };

  window.loadMarketAnalysis = async function () {
    if (window._maLoaded && STATE.data) return;
    window._maLoaded = true;
    if (!STATE.endDate) {
      const today = new Date();
      for (let i = 0; i < 8; i++) {
        const dt = new Date(today); dt.setDate(dt.getDate() - i);
        const d = await _fetchDaily(_fmtDate(dt));
        if (d && d.zones && d.zones[STATE.zone]) { STATE.endDate = dt; break; }
      }
      if (!STATE.endDate) STATE.endDate = today;
    }

    const wrap = document.getElementById('ma-panels-wrap');
    if (wrap) wrap.addEventListener('mouseleave', _clearHover);

    await _reload();
  };

  window.maGenerateAIRefresh = window.maGenerateAI;

})();
