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
 *   - TTF / EUA / Wind speed / Temp / Nuc dispo / Flux · SIMULATED (V1)
 *   - Mix (nuc/hydro/fossil/biomass) · SIMULATED (anchored on live genmix)
 *   - Spark spread      · DERIVED from Power - TTF/η - EUA·EF
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

  // CCGT cost formula (mirrors js/eua.js)
  const CCGT_EFF = 0.49;
  const CCGT_EF = 0.365;

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
    return d.toLocaleDateString('fr-FR', { weekday: 'short' }) + ' ' + d.toISOString().slice(8, 10) + '/' + d.toISOString().slice(5, 7);
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
    if (!arr || !arr.length) return new Array(targetSlotsPerDay).fill(0);
    if (sourceSlotsPerDay === targetSlotsPerDay) return arr.slice(0, targetSlotsPerDay);
    const out = new Array(targetSlotsPerDay).fill(0);
    if (sourceSlotsPerDay > targetSlotsPerDay) {
      const ratio = sourceSlotsPerDay / targetSlotsPerDay;
      for (let i = 0; i < targetSlotsPerDay; i++) {
        let sum = 0, n = 0;
        for (let j = 0; j < ratio; j++) {
          const idx = Math.floor(i * ratio) + j;
          if (idx < arr.length && arr[idx] != null) { sum += arr[idx]; n++; }
        }
        out[i] = n > 0 ? sum / n : 0;
      }
    } else {
      for (let i = 0; i < targetSlotsPerDay; i++) {
        const src = (i / targetSlotsPerDay) * sourceSlotsPerDay;
        const lo = Math.floor(src), hi = Math.min(lo + 1, sourceSlotsPerDay - 1);
        const t = src - lo;
        const a = arr[lo] != null ? arr[lo] : 0;
        const b = arr[hi] != null ? arr[hi] : a;
        out[i] = a * (1 - t) + b * t;
      }
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════
  // SIMULATIONS
  // ════════════════════════════════════════════════════════════════

  const LOAD_SHAPE_24 = [
    0.62, 0.58, 0.55, 0.53, 0.52, 0.54, 0.60, 0.70,
    0.80, 0.85, 0.87, 0.88, 0.86, 0.84, 0.82, 0.81,
    0.83, 0.88, 0.95, 1.00, 0.97, 0.90, 0.80, 0.70,
  ];

  function _simulateLoad(date, slotsPerDay) {
    const month = date.getMonth();
    const peakLoad = (month <= 1 || month >= 10) ? 78000 :
                     (month >= 5 && month <= 7) ? 48000 : 60000;
    const dow = date.getDay();
    const wkCorr = (dow === 0 || dow === 6) ? 0.85 : 1.0;
    const shape24 = LOAD_SHAPE_24.map(v => v * peakLoad * wkCorr);
    return _resample(shape24, 24, slotsPerDay);
  }

  function _simulateTemp(date, slotsPerDay) {
    const month = date.getMonth();
    const monthlyMean = [5, 6, 9, 12, 15, 19, 22, 22, 18, 13, 8, 5];
    const mean = monthlyMean[month];
    const out = [];
    for (let i = 0; i < slotsPerDay; i++) {
      const h = (i / slotsPerDay) * 24;
      const cyc = Math.sin((h - 9) * Math.PI / 12);
      out.push(mean + cyc * 3 + (Math.random() - 0.5) * 1);
    }
    return out;
  }

  function _estimateWindSpeed(windPowerMW) {
    const cap = 22000;
    const out = [];
    for (let i = 0; i < windPowerMW.length; i++) {
      const cf = Math.max(0, Math.min(1, windPowerMW[i] / cap));
      out.push(Math.pow(cf, 1 / 3) * 14);
    }
    return out;
  }

  function _simulateTTF(date, slotsPerDay) {
    const base = 46;
    const dayOffset = (date.getTime() / 86400000) % 100;
    const slow = Math.sin(dayOffset / 30) * 4;
    return new Array(slotsPerDay).fill(0).map((_, i) => base + slow + (i / slotsPerDay) * 0.3);
  }
  function _simulateEUA(date, slotsPerDay) {
    const base = 75;
    const dayOffset = (date.getTime() / 86400000) % 100;
    const slow = Math.sin(dayOffset / 25) * 3;
    return new Array(slotsPerDay).fill(0).map(() => base + slow);
  }

  function _simulateNuc(date, slotsPerDay) {
    const month = date.getMonth();
    const seasonal = (month >= 5 && month <= 8) ? 38 : 48;
    return new Array(slotsPerDay).fill(seasonal + (Math.random() - 0.5) * 2);
  }

  function _simulateFlux(date, slotsPerDay) {
    const out = [];
    for (let i = 0; i < slotsPerDay; i++) {
      const h = (i / slotsPerDay) * 24;
      const cyc = Math.sin((h - 13) * Math.PI / 12) * 3;
      out.push(cyc + (Math.random() - 0.5) * 2);
    }
    return out;
  }

  function _simulateMix(loadMW, wind, solar, nucAvail, slotsPerDay) {
    const snap = (window._genmixData && window._genmixData[STATE.zone])
              || (window.GM_DEMO && window.GM_DEMO[STATE.zone])
              || { nuclear: 45000, hydro: 6000, fossil: 4000, biomass: 800, other: 400 };
    const hydroBase = snap.hydro || 6000;
    const bioBase = snap.biomass || 800;
    const otherBase = snap.other || 400;

    const nuclear = [], hydro = [], fossil = [], biomass = [], other = [];
    const maxLoad = Math.max.apply(null, loadMW);
    for (let i = 0; i < slotsPerDay; i++) {
      const load = loadMW[i];
      const ren = (wind[i] || 0) + (solar[i] || 0);
      const loadNorm = load / maxLoad;
      const nucCap = (nucAvail[i] || 45) * 1000;
      nuclear.push(Math.min(nucCap, nucCap * (0.85 + 0.10 * loadNorm)));
      biomass.push(bioBase * (0.95 + 0.05 * Math.random()));
      other.push(otherBase);
      const supplied = nuclear[i] + biomass[i] + other[i] + ren;
      const residual = load - supplied;
      hydro.push(Math.max(0, Math.min(hydroBase * 1.6, residual * 0.45)));
      const stillNeeded = load - (nuclear[i] + biomass[i] + other[i] + ren + hydro[i]);
      fossil.push(Math.max(0, stillNeeded));
    }
    return { nuclear: nuclear, hydro: hydro, fossil: fossil, biomass: biomass, other: other };
  }

  function _synthPrice24() {
    return Array.from({ length: 24 }, (_, h) => {
      const morning = 25 * Math.exp(-Math.pow(h - 8, 2) / 6);
      const evening = 45 * Math.exp(-Math.pow(h - 19, 2) / 5);
      const midday = -15 * Math.exp(-Math.pow(h - 13, 2) / 8);
      return Math.max(-5, 55 + morning + evening + midday + (Math.random() - 0.5) * 6);
    });
  }
  function _synthWind24() {
    const lvl = 3000 + Math.random() * 6000;
    return Array.from({ length: 24 }, () => Math.max(0, lvl * (0.7 + Math.random() * 0.6)));
  }
  function _synthSolar24() {
    const cap = 6000 + Math.random() * 4000;
    return Array.from({ length: 24 }, (_, h) => Math.max(0, cap * Math.exp(-Math.pow(h - 13, 2) / 9)));
  }

  // ════════════════════════════════════════════════════════════════
  // ASSEMBLE WINDOW DATA
  // ════════════════════════════════════════════════════════════════

  async function _assemble() {
    const zone = STATE.zone;
    const end = STATE.endDate ? new Date(STATE.endDate) : new Date();
    const gran = _granularitySpec();
    const slotsPerDay = gran.slotsPerDay;
    const days = [];

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
        sourceSlots = 24;
        priceSrc = _synthPrice24();
        windSrc = _synthWind24();
        solarSrc = _synthSolar24();
        isReal = false;
      }
      // Generation arrays share the hourly resolution (96 or 24); synth fallback is 24.
      const genSlots = sourceSlots;

      const price = _resample(priceSrc, sourceSlots, slotsPerDay);
      const wind = _resample(windSrc, genSlots, slotsPerDay);
      const solar = _resample(solarSrc, genSlots, slotsPerDay);
      const load = _simulateLoad(dt, slotsPerDay);
      const temp = _simulateTemp(dt, slotsPerDay);
      const windSpeed = _estimateWindSpeed(wind);
      // Real TTF (EUR/MWh, one value/day from Yahoo via fetch_data.py) if archived; else simulate.
      // Gas is ~flat intraday, so broadcasting the daily close across slots is realistic.
      const ttfReal = (daily && typeof daily.ttf === 'number') ? daily.ttf : null;
      const ttf = (ttfReal != null) ? new Array(slotsPerDay).fill(ttfReal) : _simulateTTF(dt, slotsPerDay);
      const eua = _simulateEUA(dt, slotsPerDay);
      const nucAvail = _simulateNuc(dt, slotsPerDay);
      const flux = _simulateFlux(dt, slotsPerDay);
      // Real generation mix (MW) if archived, else simulate. Flat-builder divides by 1000 → GW.
      const mix = mixSrc ? {
        nuclear: _resample(mixSrc.nuclear, genSlots, slotsPerDay),
        hydro:   _resample(mixSrc.hydro,   genSlots, slotsPerDay),
        fossil:  _resample(mixSrc.fossil,  genSlots, slotsPerDay),
        biomass: _resample(mixSrc.biomass, genSlots, slotsPerDay),
        other:   _resample(mixSrc.other,   genSlots, slotsPerDay),
      } : _simulateMix(load, wind, solar, nucAvail, slotsPerDay);

      const spark = price.map((p, i) => {
        const ttfCost = (ttf[i] || 46) / CCGT_EFF;
        const co2Cost = (eua[i] || 75) * CCGT_EF;
        return p - ttfCost - co2Cost;
      });

      const carbon = [];
      for (let i = 0; i < slotsPerDay; i++) {
        const gens = {
          nuclear: mix.nuclear[i], hydro: mix.hydro[i], fossil: mix.fossil[i],
          biomass: mix.biomass[i], other: mix.other[i],
          wind: wind[i] || 0, solar: solar[i] || 0,
        };
        let totGen = 0, totCO2 = 0;
        for (const f in gens) {
          totGen += gens[f];
          totCO2 += gens[f] * (CO2_FACTORS[f] || 0);
        }
        carbon.push(totGen > 0 ? totCO2 / totGen : 0);
      }

      days.push({
        date: dateStr, jsDate: dt, dow: dt.toLocaleDateString('fr-FR', { weekday: 'long' }),
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
        flat.wind.push(day.wind[i] / 1000);
        flat.solar.push(day.solar[i] / 1000);
        flat.load.push(day.load[i] / 1000);
        flat.carbon.push(day.carbon[i]);
        ['nuclear', 'hydro', 'fossil', 'biomass', 'other'].forEach(f => {
          flat.mix[f].push(day.mix[f][i] / 1000);
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

    let floorIdx = 0;
    for (let i = 1; i < f.price.length; i++) if (f.price[i] < f.price[floorIdx]) floorIdx = i;
    moments.push({ idx: floorIdx, kind: 'floor' });

    let peakIdx = 0;
    for (let i = 1; i < f.price.length; i++) if (f.price[i] > f.price[peakIdx]) peakIdx = i;
    moments.push({ idx: peakIdx, kind: 'peak' });

    let cannibalIdx = -1, cannibalScore = -Infinity;
    f.solar.forEach((s, i) => {
      const score = s - f.price[i] * 0.02;
      if (s > 4 && f.price[i] < 30 && score > cannibalScore) {
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
    const dow = dt.toLocaleDateString('fr-FR', { weekday: 'long' });
    const time = String(dt.getHours()).padStart(2, '0') + 'h';
    const renCover = ((wind + solar) / load * 100).toFixed(0);
    const fmt = (v, d) => (v == null || isNaN(v)) ? '--' : v.toFixed(d == null ? 1 : d);
    const dowCap = dow.charAt(0).toUpperCase() + dow.slice(1);

    let title, body;
    if (moment.kind === 'floor') {
      title = dowCap + ' ' + time + ' · le vent fait le prix';
      body = 'Vent à ' + fmt(windSpeed) + ' m/s donc <b style="color:#fff">' + fmt(wind) + ' GW d\'éolien</b> qui couvre <b style="color:#fff">' + renCover + '%</b> de la conso, donc fossile sort du merit order (' + fmt(fossil) + ' GW), donc spark plonge à <b style="color:#fff">' + (spark >= 0 ? '+' : '') + fmt(spark, 0) + ' €</b>, donc prix touche <b style="color:#14D3A9">' + fmt(price, 1) + ' €</b>.';
    } else if (moment.kind === 'peak') {
      title = dowCap + ' ' + time + ' · spike';
      body = 'Vent tombé à ' + fmt(windSpeed) + ' m/s donc <b style="color:#ED6965">' + fmt(wind) + ' GW</b> seulement, demande à ' + fmt(load) + ' GW, donc gas CCGT marginal à <b style="color:#fff">' + fmt(fossil) + ' GW</b>, spark explose à <b style="color:#fff">' + (spark >= 0 ? '+' : '') + fmt(spark, 0) + ' €</b>. TTF ' + fmt(ttf, 0) + ' · EUA ' + fmt(eua, 0) + '.';
    } else if (moment.kind === 'cannibalisation') {
      const solarCover = (solar / load * 100).toFixed(0);
      title = dowCap + ' ' + time + ' · duck curve';
      body = 'Solar à <b style="color:#fff">' + fmt(solar) + ' GW</b> couvre ' + solarCover + '% de la conso au milieu d\'une demande faible, donc cannibalisation classique. Prix midi à <b style="color:#A78BFA">' + fmt(price, 1) + ' €</b>. Capture rate solaire impacté.';
    } else {
      title = dowCap + ' · respiration weekend';
      body = 'Industrie au repos donc load <b style="color:#fff">' + fmt(load) + ' GW</b>, nucléaire module, hydro en mode stockage. Aucun stress sur le système, prix moyen ' + fmt(price, 0) + ' €.';
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
      { id: 'wind', label: 'Vent',      series: f.drivers.windSpeed, color: DRIVER_COLOURS.wind, dec: 0, unit: 'm/s' },
      { id: 'temp', label: 'Temp',      series: f.drivers.temp,      color: DRIVER_COLOURS.temp, dec: 0, unit: '°C' },
      { id: 'nuc',  label: 'Nuc dispo', series: f.drivers.nucAvail,  color: DRIVER_COLOURS.nuc,  dec: 0, unit: 'GW' },
      { id: 'flux', label: 'Flux',      series: f.drivers.flux,      color: DRIVER_COLOURS.flux, dec: 1, unit: 'GW' },
    ];
    const fx = (v, d) => (v == null || isNaN(v)) ? '--' : v.toFixed(d);

    let html = '<div class="ma-kpi-row">';
    drivers.forEach((d) => {
      const v0 = d.series[0], vN = d.series[d.series.length - 1];
      const delta = vN - v0;
      const deltaPct = v0 !== 0 ? (delta / Math.abs(v0)) * 100 : 0;
      const isFlat = Math.abs(deltaPct) < 1;
      const cls = isFlat ? 'flat' : (delta > 0 ? 'up' : 'down');
      const arrow = isFlat ? '·' : (delta > 0 ? '▲' : '▼');
      const deltaTxt = isFlat ? '—' : (arrow + ' ' + Math.abs(deltaPct).toFixed(0) + '%');
      const min = Math.min.apply(null, d.series);
      const max = Math.max.apply(null, d.series);
      const range = (max - min) || 1;
      const pts = d.series.map((v, idx) => {
        const x = (idx / (d.series.length - 1)) * 100;
        const y = 15 - ((v - min) / range) * 13;
        return (idx === 0 ? 'M' : 'L') + ' ' + x.toFixed(1) + ' ' + y.toFixed(1);
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
        return dt.toLocaleDateString('fr-FR', { weekday: 'short' }) + ' ' + String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
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
        label: 'Prix DA', data: f.price,
        borderColor: '#E6EDF3', borderWidth: 1.4, pointRadius: 0,
        tension: 0.15, spanGaps: true,
      }],
    }, _commonChartOpts('€/MWh'));

    _mkChart('ma-canvas-spark', 'line', {
      labels: labels,
      datasets: [{
        label: 'Spark', data: f.spark,
        borderColor: '#ED6965', borderWidth: 1.4, pointRadius: 0,
        tension: 0.15, spanGaps: true,
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
          fill: 'origin', pointRadius: 0, tension: 0.15, stack: 'ren',
        },
        {
          label: 'Wind', data: f.wind,
          backgroundColor: _hexA(FUEL_COLORS.wind, 0.55),
          borderColor: 'transparent', borderWidth: 0,
          fill: 'origin', pointRadius: 0, tension: 0.15, stack: 'ren',
        },
        {
          label: 'Load', data: f.load,
          borderColor: '#fff', borderWidth: 1.5, borderDash: [3, 2],
          pointRadius: 0, tension: 0.15, fill: false,
        },
      ],
    }, _commonChartOpts('GW'));

    const stackDatasets = FUEL_STACK.map(function (fuel) {
      const data = (fuel === 'wind' || fuel === 'solar') ? f[fuel] : f.mix[fuel];
      return {
        label: FUEL_LABELS[fuel], data: data,
        backgroundColor: _hexA(FUEL_COLORS[fuel], 0.78),
        borderColor: FUEL_COLORS[fuel], borderWidth: 0,
        fill: true, pointRadius: 0, tension: 0.1, stack: 'mix',
      };
    });
    const mixOpts = _commonChartOpts('GW');
    mixOpts.scales.y.stacked = true;
    mixOpts.scales.y.beginAtZero = true;
    _mkChart('ma-canvas-mix', 'line', { labels: labels, datasets: stackDatasets }, mixOpts);
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
    const dateLbl = dt.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
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
      +   '<div class="ma-ht-hero-cell" style="border-left-color:' + priceColor + '"><div class="lab">Prix DA</div><div class="big" style="color:' + priceColor + '">' + fx(price, price < 1 ? 2 : 1) + ' <span class="u">€</span></div></div>'
      +   '<div class="ma-ht-hero-cell" style="border-left-color:' + sparkColor + '"><div class="lab">Spark CCGT</div><div class="big" style="color:' + sparkColor + '">' + (spark >= 0 ? '+' : '') + fx(spark, 0) + ' <span class="u">€</span></div></div>'
      + '</div>'
      + '<div class="ma-ht-marginal" style="background:' + _hexA(mgColor, 0.15) + ';color:' + mgColor + '">' + dot(mgColor) + 'Marginal · ' + marginal + '</div>'
      + '<div class="ma-ht-section">Demande &amp; mix</div>'
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
      host.innerHTML = '<div style="color:var(--tx3);font-family:\'JetBrains Mono\',monospace;font-size:11px;padding:10px">Aucun moment-clé détecté. Marché plat ou données insuffisantes.</div>';
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
      const day = dt.toLocaleDateString('fr-FR', { weekday: 'short' });
      const time = String(dt.getHours()).padStart(2, '0') + 'h';
      const price = STATE.data.flat.price[m.idx];
      return '<span class="ma-cursor-badge" style="color:' + colour + ';border-color:' + _hexA(colour, 0.4) + ';background:' + _hexA(colour, 0.12) + '">'
        + '<b>' + (i + 1) + ' · ' + (labels[m.kind] || m.kind) + '</b>&nbsp; ' + day + ' ' + time + ' · ' + price.toFixed(price < 1 ? 2 : 1) + ' €'
        + '</span>';
    }).join('');
  }

  // ════════════════════════════════════════════════════════════════
  // AI SYNTHESIS
  // ════════════════════════════════════════════════════════════════

  function _buildAIContext() {
    const f = STATE.data.flat;
    const moments = STATE.cursors.map(function (m) {
      const dt = f.slotDates[m.idx];
      return {
        kind: m.kind,
        date: dt.toISOString().slice(0, 16),
        price: +f.price[m.idx].toFixed(1),
        spark: +f.spark[m.idx].toFixed(0),
        wind_GW: +f.wind[m.idx].toFixed(1),
        solar_GW: +f.solar[m.idx].toFixed(1),
        load_GW: +f.load[m.idx].toFixed(1),
        fossil_GW: +f.mix.fossil[m.idx].toFixed(1),
        wind_speed: +f.drivers.windSpeed[m.idx].toFixed(0),
        ttf: +f.drivers.ttf[m.idx].toFixed(1),
        eua: +f.drivers.eua[m.idx].toFixed(1),
      };
    });
    const prices = f.price.filter(function (p) { return p != null; });
    const sparks = f.spark.filter(function (p) { return p != null; });
    return {
      zone: STATE.zone,
      window_days: STATE.windowDays,
      granularity: STATE.granularity,
      price_min: +Math.min.apply(null, prices).toFixed(1),
      price_max: +Math.max.apply(null, prices).toFixed(1),
      price_avg: +(prices.reduce(function (a, b) { return a + b; }, 0) / prices.length).toFixed(1),
      spark_min: +Math.min.apply(null, sparks).toFixed(0),
      spark_max: +Math.max.apply(null, sparks).toFixed(0),
      ttf_avg: +(f.drivers.ttf.reduce(function (a, b) { return a + b; }, 0) / f.drivers.ttf.length).toFixed(1),
      eua_avg: +(f.drivers.eua.reduce(function (a, b) { return a + b; }, 0) / f.drivers.eua.length).toFixed(1),
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
