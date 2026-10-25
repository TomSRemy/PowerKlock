/* ════════════════════════════════════════════════════════════════════════════
 * MARKET ANALYSIS v3 — Causal multi-panel + crosshair + AI synthesis
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   1. Drivers strip   · 6 sparklines (TTF · EUA · Wind · Temp · Nuc · Flux)
 *   2. 4 main panels   · Price (with the gas-plant cost and the neighbour)
 *                        / Residual load vs nuclear and imports / Load vs Ren /
 *                        Mix supply (Chart.js)
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
 *   - Spark spread      · DERIVED (PKC.cleanSpark, site-wide convention); drawn
 *                         as the CCGT cost line on the price panel (price − cost)
 *   - Residual load     · load − wind − solar (GW)
 *   - Neighbour price   · same daily file (FR ↔ DE_LU, others ↔ FR)
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
    nuclear: 'Nuclear', wind: 'Wind', solar: 'Solar', hydro: 'Hydro',
    biomass: 'Biomass', fossil: 'Fossil', other: 'Other',
  };


  const EPISODE_KIND_COLOURS = {
    floor: '#14D3A9', weekend: '#FBBF24', cannibalisation: '#A78BFA', peak: '#ED6965',
  };

  // Neighbour shown on the price panel
  const NEIGHBOUR = { FR: 'DE_LU', DE_LU: 'FR', ES: 'FR', BE: 'FR', NL: 'DE_LU' };
  const ZONE_SHORT = { FR: 'FR', DE_LU: 'DE', ES: 'ES', BE: 'BE', NL: 'NL' };
  const ZONE_NAME = { FR: 'France', DE_LU: 'Germany', ES: 'Spain', BE: 'Belgium', NL: 'Netherlands' };   // series names at the end of the lines
  // What sets the price in a slot: a reading of price vs the gas-plant cost and the mix
  function _marginal(price, srmc, fossil, wind, solar, load) {
    if (price == null) return { t: '--', c: 'hydro' };
    const ren = (wind || 0) + (solar || 0);
    if (price <= 5) return { t: ren > 0 && load ? 'Wind / solar surplus' : 'Renewable surplus', c: 'ren' };
    if (srmc != null && price > srmc * 1.25 && fossil > 0.5) return { t: 'Scarcity · peakers / imports', c: 'gas' };
    if (srmc != null && fossil > 0.5 && Math.abs(price - srmc) <= srmc * 0.25) return { t: 'Gas CCGT', c: 'gas' };
    if (srmc != null && price < srmc * 0.6) return { t: 'Nuclear / hydro modulation', c: 'hydro' };
    return { t: fossil > 0.5 ? 'Gas CCGT' : 'Hydro / imports', c: fossil > 0.5 ? 'gas' : 'hydro' };
  }

  const DRIVER_COLOURS = {
    ttf: '#F59E0B', eua: '#A78BFA', wind: '#14D3A9',
    temp: '#ED6965', nuc: '#A98BD4', flux: '#7A93AB',
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
    showFc: true,   // TSO day-ahead forecasts of load, wind and solar (js/pk-forecast.js)
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

  // French unless the EN / FR button says English (js/i18n.js): dates and the generated sentences
  const _fr = () => !window.PKI18n || PKI18n.lang !== 'en';
  const _loc = () => _fr() ? 'fr-FR' : 'en-GB';
  function _fmtDate(d) { return d.toISOString().slice(0, 10); }
  function _dayLabel(d) {
    return d.toLocaleDateString(_loc(), { weekday: 'short' }) + ' ' + d.toISOString().slice(8, 10) + '/' + d.toISOString().slice(5, 7);
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
    const gran = _granularitySpec();
    const slotsPerDay = gran.slotsPerDay;
    const days = [];
    if (window.PKC) await PKC.ready;
    const lastDay = STATE.endDate ? String(STATE.endDate).slice(0, 10) : pkTodayISO();
    const firstDay = _renAdd(lastDay, -(STATE.windowDays - 1));
    const wx = await _fetchWeather(zone, firstDay, lastDay);
    const nulls = () => new Array(slotsPerDay).fill(null);

    // Delivery days are Paris calendar days; each day's slots start at local
    // midnight (the old code kept the current time of day, so slot labels
    // and key-moment times were shifted by the hour the page was opened).
    const endISO = STATE.endDate ? String(STATE.endDate).slice(0, 10) : pkTodayISO();
    // Forecast days after the last day with data (today, tomorrow once published) are appended.
    const fcOn = STATE.showFc && window.PKF;
    const dates = [];
    for (let d = STATE.windowDays - 1; d >= 0; d--) dates.push(_renAdd(endISO, -d));
    if (fcOn) {
      const t = pkTodayISO();
      for (const x of [t, _renAdd(t, 1)]) if (x > endISO && await PKF.day(zone, x)) dates.push(x);
    }
    for (const dateStr of dates) {
      const [yy, mm, dd] = dateStr.split('-').map(Number);
      const dt = new Date(yy, mm - 1, dd, 0, 0, 0, 0);
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
      let loadReal = zd && Array.isArray(zd.load) && zd.load.some(v => v) ? _resample(zd.load, zd.load.length === 96 ? 96 : 24, slotsPerDay) : null;
      // France: RTE éCO2mix consumption (real time / consolidated) when the
      // daily file has no ENTSO-E load.
      if (!loadReal && zone === 'FR' && window.PK_E2M) {
        const e = await PK_E2M.day(dateStr);
        if (e && e.consommation.some(v => v != null)) loadReal = _resample(typeof _e2mFill === 'function' ? _e2mFill(e.consommation) : e.consommation, 96, slotsPerDay);
      }
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
      // TSO day-ahead forecast of the day (MW, 96 quarter-hours)
      const fd = fcOn ? await PKF.day(zone, dateStr) : null;
      const fcs = k => fd && fd[k] ? _resample(fd[k], 96, slotsPerDay) : nulls();
      const fc = { solar: fcs('solar'), wind: fcs('wind'), load: fcs('load') };
      // Running cost of a gas plant (CCGT, fuel + CO₂): price − spark
      const srmc = ttf.map((t, i) => (window.PKC && t != null && eua[i] != null) ? -PKC.cleanSpark(0, t, eua[i]) : null);
      // Neighbour day-ahead price (coupling / decoupling)
      const nbZ = NEIGHBOUR[zone], nbd = nbZ && daily && daily.zones && daily.zones[nbZ];
      const nbPrice = nbd && Array.isArray(nbd.hourly) ? _resample(nbd.hourly, nbd.hourly.length === 96 ? 96 : 24, slotsPerDay) : nulls();

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
        date: dateStr, jsDate: dt, dow: dt.toLocaleDateString(_loc(), { weekday: 'long' }),
        isReal: isReal, price: price, spark: spark, srmc: srmc, nbPrice: nbPrice, wind: wind, solar: solar, load: load,
        mix: mix, carbon: carbon, fc: fc,
        drivers: { ttf: ttf, eua: eua, windSpeed: windSpeed, temp: temp, nucAvail: nucAvail, flux: flux },
      });
    }

    const flat = {
      price: [], spark: [], srmc: [], nbPrice: [], resid: [], wind: [], solar: [], load: [], carbon: [],
      mix: { nuclear: [], hydro: [], fossil: [], biomass: [], other: [] },
      drivers: { ttf: [], eua: [], windSpeed: [], temp: [], nucAvail: [], flux: [] },
      labels: [], slotDates: [],
      fc: { solar: [], wind: [], load: [], resid: [] },
    };
    days.forEach(day => {
      for (let i = 0; i < slotsPerDay; i++) {
        const dt = new Date(day.jsDate);
        dt.setMinutes(i * gran.minutes);
        flat.slotDates.push(dt);
        flat.labels.push(_slotShortLabel(dt, gran));
        flat.price.push(day.price[i]);
        flat.spark.push(day.spark[i]);
        flat.srmc.push(day.srmc[i]);
        flat.nbPrice.push(day.nbPrice[i]);
        flat.resid.push(day.load[i] == null ? null : (day.load[i] - (day.wind[i] || 0) - (day.solar[i] || 0)) / 1000);
        const gw = v => v == null ? null : v / 1000;
        flat.wind.push(gw(day.wind[i]));
        flat.solar.push(gw(day.solar[i]));
        flat.load.push(gw(day.load[i]));
        flat.carbon.push(day.carbon[i]);
        const fl = day.fc.load[i], fw = day.fc.wind[i], fs = day.fc.solar[i];
        flat.fc.load.push(gw(fl)); flat.fc.wind.push(gw(fw)); flat.fc.solar.push(gw(fs));
        flat.fc.resid.push(fl == null ? null : (fl - (fw || 0) - (fs || 0)) / 1000);
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

    // Where the forecast takes over: after the last slot with measured load or output;
    // "now" = the current slot when today is in the window.
    let lastAct = -1;
    flat.load.forEach((v, i) => { if (v != null || flat.wind[i] != null || flat.solar[i] != null) lastAct = i; });
    const anyFc = i => flat.fc.load[i] != null || flat.fc.wind[i] != null || flat.fc.solar[i] != null;
    flat.fcFrom = fcOn && flat.fc.load.some((_, i) => i > lastAct && anyFc(i)) ? lastAct + 1 : -1;
    const ti = days.findIndex(d => d.date === pkTodayISO());
    flat.nowIdx = ti >= 0 && window.PKF ? ti * slotsPerDay + Math.floor(PKF.nowSlot() * slotsPerDay / 96) : -1;
    return { zone: zone, nbZone: NEIGHBOUR[zone], days: days, flat: flat, slotsPerDay: slotsPerDay, gran: gran };
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
    const dow = dt.toLocaleDateString(_loc(), { weekday: 'long' });
    const time = String(dt.getHours()).padStart(2, '0') + 'h';
    // Demand: ENTSO-E load when stored, otherwise total generation.
    const totGen = ['nuclear', 'hydro', 'fossil', 'biomass', 'other'].reduce((t, k) => t + (f.mix[k][i] || 0), 0) + (wind || 0) + (solar || 0);
    const demand = load != null ? load : totGen;
    const renCover = demand ? (((wind || 0) + (solar || 0)) / demand * 100).toFixed(0) : '--';
    const fmt = (v, d) => (v == null || isNaN(v)) ? '--' : v.toFixed(d == null ? 1 : d);
    const dowCap = dow.charAt(0).toUpperCase() + dow.slice(1);

    // Sentences only cite the figures the slot actually has (no "--" in the text)
    const ok = v => v != null && !isNaN(v);
    const W = t => '<b style="color:#fff">' + t + '</b>';
    const srmc = f.srmc[i], resid = f.resid[i], nucA = f.drivers.nucAvail[i], nbP = f.nbPrice[i], nbN = ZONE_SHORT[data.nbZone] || 'neighbour';
    const parts = [];
    let title, body;
    const dec = v => _fr() ? String(v).replace('.', ',') : v;   // 12.5 → 12,5
    const fmt2 = (v, d) => dec(fmt(v, d));
    if (_fr()) {   // the same sentences in French
      const nbF = ZONE_SHORT[data.nbZone] || 'voisin';
      if (moment.kind === 'floor') {
        title = dowCap + ' ' + time + ' · ' + ((solar || 0) > (wind || 0) ? 'le solaire' : 'l’éolien') + ' fait le prix';
        if (ok(windSpeed)) parts.push('vent à ' + fmt2(windSpeed) + ' m/s (100 m)');
        if (ok(wind) || ok(solar)) parts.push(W(fmt2((wind || 0) + (solar || 0)) + ' GW d’éolien et de solaire') + (load != null ? ' pour ' + fmt2(demand) + ' GW de demande (' + renCover + ' %)' : ''));
        if (ok(resid) && ok(nucA)) parts.push('demande résiduelle de ' + fmt2(resid) + ' GW, ' + (resid < nucA ? 'sous' : 'au-dessus de') + ' ' + fmt2(nucA, 0) + ' GW de nucléaire disponible');
        body = (parts.length ? parts.join(', ') + ' : ' : '') + 'le gaz sort de l’ordre de mérite' + (ok(srmc) ? ' (coût ' + fmt2(srmc, 0) + ' €)' : '') + ', le prix tombe à <b style="color:#14D3A9">' + fmt2(price, 1) + ' €</b>' + (ok(nbP) ? ' (' + nbF + ' ' + fmt2(nbP, 0) + ' €)' : '') + '.';
      } else if (moment.kind === 'peak') {
        title = dowCap + ' ' + time + ' · pic';
        if (ok(wind)) parts.push('seulement <b style="color:#ED6965">' + fmt2(wind) + ' GW</b> d’éolien' + (ok(windSpeed) ? ' (' + fmt2(windSpeed) + ' m/s)' : ''));
        if (ok(load)) parts.push('demande à ' + fmt2(demand) + ' GW');
        if (ok(resid) && ok(nucA)) parts.push('demande résiduelle ' + W(fmt2(resid) + ' GW') + ' pour ' + fmt2(nucA, 0) + ' GW de nucléaire');
        body = (parts.length ? parts.join(', ') + ' : ' : '') + (ok(fossil) && fossil > 0.5 ? 'les centrales gaz tournent (' + W(fmt2(fossil) + ' GW') + ')' : 'il faut des imports et des centrales flexibles')
          + (ok(srmc) ? ', prix ' + (price > srmc ? W(fmt2(price - srmc, 0) + ' € au-dessus') : W(fmt2(srmc - price, 0) + ' € en dessous')) + ' du coût d’une centrale gaz (' + fmt2(srmc, 0) + ' €)' : '')
          + (ok(ttf) && ok(eua) ? '. TTF ' + fmt2(ttf, 0) + ' · EUA ' + fmt2(eua, 0) : '') + '.';
      } else if (moment.kind === 'cannibalisation') {
        const solarCover = demand ? ((solar || 0) / demand * 100).toFixed(0) : null;
        title = dowCap + ' ' + time + ' · courbe en canard';
        body = 'Le solaire à ' + W(fmt2(solar) + ' GW') + (solarCover ? ' couvre ' + solarCover + ' % de la demande' : '') + ' à midi : cannibalisation classique, prix à <b style="color:#A78BFA">' + fmt2(price, 1) + ' €</b>. Le taux de capture solaire en pâtit.';
      } else {
        title = dowCap + ' · creux du week-end';
        body = (ok(demand) && demand > 0 ? 'Industrie à l’arrêt, demande ' + W(fmt2(demand) + ' GW') + ', ' : 'Industrie à l’arrêt, ') + 'le nucléaire module, l’hydraulique stocke. Pas de tension, prix ' + fmt2(price, 0) + ' €' + (ok(srmc) ? ' pour un coût de centrale gaz de ' + fmt2(srmc, 0) + ' €' : '') + '.';
      }
      return { title: title, body: body.charAt(0).toUpperCase() + body.slice(1), price: fmt2(price, price < 1 ? 2 : 1), spark: fmt(spark, 0) };
    }
    if (moment.kind === 'floor') {
      title = dowCap + ' ' + time + ' · ' + ((solar || 0) > (wind || 0) ? 'solar' : 'wind') + ' sets the price';
      if (ok(windSpeed)) parts.push('wind at ' + fmt(windSpeed) + ' m/s (100 m)');
      if (ok(wind) || ok(solar)) parts.push(W(fmt((wind || 0) + (solar || 0)) + ' GW of wind and solar') + (load != null ? ' for ' + fmt(demand) + ' GW of demand (' + renCover + '%)' : ''));
      if (ok(resid) && ok(nucA)) parts.push('residual load ' + fmt(resid) + ' GW ' + (resid < nucA ? 'below' : 'above') + ' the ' + fmt(nucA, 0) + ' GW of nuclear available');
      body = (parts.length ? parts.join(', ') + ': ' : '') + 'gas is out of the merit order' + (ok(srmc) ? ' (cost ' + fmt(srmc, 0) + ' €)' : '') + ', so the price falls to <b style="color:#14D3A9">' + fmt(price, 1) + ' €</b>' + (ok(nbP) ? ' (' + nbN + ' ' + fmt(nbP, 0) + ' €)' : '') + '.';
    } else if (moment.kind === 'peak') {
      title = dowCap + ' ' + time + ' · spike';
      if (ok(wind)) parts.push('only <b style="color:#ED6965">' + fmt(wind) + ' GW</b> of wind' + (ok(windSpeed) ? ' (' + fmt(windSpeed) + ' m/s)' : ''));
      if (ok(load)) parts.push('demand at ' + fmt(demand) + ' GW');
      if (ok(resid) && ok(nucA)) parts.push('residual load ' + W(fmt(resid) + ' GW') + ' vs ' + fmt(nucA, 0) + ' GW of nuclear');
      body = (parts.length ? parts.join(', ') + ': ' : '') + (ok(fossil) && fossil > 0.5 ? 'gas plants run (' + W(fmt(fossil) + ' GW') + ')' : 'imports and flexible plants are needed')
        + (ok(srmc) ? ', price ' + (price > srmc ? W(fmt(price - srmc, 0) + ' € above') : W(fmt(srmc - price, 0) + ' € below')) + ' the gas plant cost (' + fmt(srmc, 0) + ' €)' : '')
        + (ok(ttf) && ok(eua) ? '. TTF ' + fmt(ttf, 0) + ' · EUA ' + fmt(eua, 0) : '') + '.';
    } else if (moment.kind === 'cannibalisation') {
      const solarCover = demand ? ((solar || 0) / demand * 100).toFixed(0) : null;
      title = dowCap + ' ' + time + ' · duck curve';
      body = 'Solar at ' + W(fmt(solar) + ' GW') + (solarCover ? ' covers ' + solarCover + '% of demand' : '') + ' at midday: classic cannibalisation, price at <b style="color:#A78BFA">' + fmt(price, 1) + ' €</b>. Solar capture rate hit.';
    } else {
      title = dowCap + ' · weekend lull';
      body = (ok(demand) && demand > 0 ? 'Industry idle, load ' + W(fmt(demand) + ' GW') + ', ' : 'Industry idle, ') + 'nuclear modulating, hydro storing. No system stress, price ' + fmt(price, 0) + ' €' + (ok(srmc) ? ' vs a gas plant cost of ' + fmt(srmc, 0) + ' €' : '') + '.';
    }
    return { title: title, body: body.charAt(0).toUpperCase() + body.slice(1), price: fmt(price, price < 1 ? 2 : 1), spark: fmt(spark, 0) };
  }

  // ════════════════════════════════════════════════════════════════
  // RENDER · DRIVERS STRIP
  // ════════════════════════════════════════════════════════════════

  function _renderDriversStrip() {
    const host = document.getElementById('ma-drivers-strip');
    if (!host) return;
    const f = STATE.data.flat;
    const drivers = [
      { id: 'ttf',  label: 'TTF (gas)',     series: f.drivers.ttf,       color: DRIVER_COLOURS.ttf,  dec: 1, unit: '€/MWh' },
      { id: 'eua',  label: 'EUA (CO₂)',     series: f.drivers.eua,       color: DRIVER_COLOURS.eua,  dec: 1, unit: '€/t' },
      { id: 'wind', label: 'Wind at 100 m', series: f.drivers.windSpeed, color: DRIVER_COLOURS.wind, dec: 1, unit: 'm/s', src: 'weather source not responding' },
      { id: 'temp', label: 'Temperature',   series: f.drivers.temp,      color: DRIVER_COLOURS.temp, dec: 1, unit: '°C', src: 'weather source not responding' },
      { id: 'nuc',  label: STATE.zone === 'FR' ? 'Nuclear available' : 'Nuclear output', series: f.drivers.nucAvail, color: DRIVER_COLOURS.nuc, dec: 1, unit: 'GW' },
      { id: 'flux', label: 'Net imports',   series: f.drivers.flux,      color: DRIVER_COLOURS.flux, dec: 1, unit: 'GW' },
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
      const deltaTxt = !valid.length ? (d.src || 'not available') : isFlat ? 'stable over the window' : (arrow + ' ' + Math.abs(deltaPct).toFixed(0) + '% over the window');
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
      html += '<div class="ma-kpi-card' + (valid.length ? '' : ' na') + '" style="--kpi-accent:' + d.color + '">'
        + '<div class="ma-kpi-head">'
        +   '<span class="ma-kpi-label">' + d.label + '</span>'
        +   '<svg class="ma-kpi-spark" viewBox="0 0 100 16" preserveAspectRatio="none"><path d="' + pts + '" stroke="' + d.color + '" stroke-width="1.6" fill="none"/></svg>'
        + '</div>'
        + '<div class="ma-kpi-val">' + (valid.length ? fx(vN, d.dec) + '<span class="u">' + d.unit + '</span>' : 'No data') + '</div>'
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

  // Every series named at the right of its last point (a band of a stacked chart in its middle): no need to
  // match colours with a legend. Labels are pushed apart when they would overlap.
  const endLabels = { id: 'maEndLabels', afterDatasetsDraw(chart) {
    const o = chart.options.plugins && chart.options.plugins.maEndLabels; if (!o || !o.on) return;
    const area = chart.chartArea, ctx = chart.ctx, items = [];
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i); if (meta.hidden || ds.pkNoEnd || !ds.label) return;
      let k = -1; for (let j = ds.data.length - 1; j >= 0; j--) if (ds.data[j] != null && !isNaN(ds.data[j])) { k = j; break; }
      if (k < 0 || !meta.data[k]) return;
      let y = meta.data[k].y;
      if (o.stacked) { const below = i > 0 ? chart.getDatasetMeta(i - 1).data[k] : null; y = (y + (below ? below.y : chart.scales.y.getPixelForValue(0))) / 2; }
      const txt = ds.endLabel || ds.label;
      items.push({ y, text: window.PKI18n ? PKI18n.tr(txt) : txt, color: ds.endColor || (typeof ds.borderColor === 'string' && ds.borderColor !== 'transparent' ? ds.borderColor : '#B8C9D9') });
    });
    items.sort((a, b) => a.y - b.y);
    let prev = -1e9; ctx.save(); ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle';
    items.forEach(it => { const y = Math.min(Math.max(it.y, prev + 13, area.top + 6), area.bottom - 4); prev = y; ctx.fillStyle = it.color; ctx.fillText(it.text, area.right + 6, y); });
    ctx.restore();
  } };

  // ════════════════════════════════════════════════════════════════
  // RENDER · MAIN PANELS
  // ════════════════════════════════════════════════════════════════

  function _buildXLabels() {
    const f = STATE.data.flat;
    const slotsPerDay = STATE.data.slotsPerDay;
    return f.slotDates.map((dt, i) => {
      const slotInDay = i % slotsPerDay;
      if (slotInDay === 0) {
        return dt.toLocaleDateString(_loc(), { weekday: 'short' }) + ' ' + String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
      }
      return '';
    });
  }

  function _commonChartOpts(yTitle) {
    return {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      layout: { padding: { right: 118 } },   // room for the series names (endLabels)
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        maEndLabels: { on: true },
        pkFcZone: STATE.data && STATE.data.flat ? { from: STATE.data.flat.fcFrom, now: STATE.data.flat.nowIdx } : false,
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
    // The side panel (ma-hover-tooltip) is the readout here: no second box on the charts.
    options.plugins.pkHoverReadout = false;
    STATE.charts[canvasId] = new window.Chart(canvas, {
      type: type, data: data, options: options, plugins: [crosshairPlugin, endLabels],
    });
  }

  function _hasFc() {
    const f = STATE.data && STATE.data.flat;
    return !!(f && f.fc && (f.fc.load.some(v => v != null) || f.fc.wind.some(v => v != null)));
  }

  function _renderPanels() {
    const f = STATE.data.flat;
    const labels = f.labels;

    _mkChart('ma-canvas-price', 'line', {
      labels: labels,
      datasets: [{
        label: 'DA Price', endLabel: ZONE_NAME[STATE.zone] || STATE.zone, data: f.price,
        borderColor: '#E6EDF3', borderWidth: 1.6, pointRadius: 0,
        tension: 0, spanGaps: false,
      }, {
        label: 'Gas plant cost', endLabel: 'Gas plant cost', data: f.srmc,
        borderColor: DRIVER_COLOURS.ttf, borderWidth: 1.3, borderDash: [6, 4], pointRadius: 0, tension: 0, fill: false,
      }, {
        label: (_fr() ? 'Prix ' : '') + (ZONE_SHORT[STATE.data.nbZone] || '') + (_fr() ? '' : ' price'), endLabel: ZONE_NAME[STATE.data.nbZone] || 'Neighbour', data: f.nbPrice,
        borderColor: 'rgba(127,200,248,0.75)', borderWidth: 1, pointRadius: 0, tension: 0, fill: false, spanGaps: false,
      }],
    }, (function () {   // the key moments, numbered on the price chart (same numbers as the cards above)
      const o = _commonChartOpts('€/MWh'), ann = {};
      (STATE.cursors || []).forEach(function (m, i) {
        const col = EPISODE_KIND_COLOURS[m.kind] || '#7A93AB';
        ann['km' + i] = { type: 'line', xMin: m.idx, xMax: m.idx, borderColor: _hexA(col, 0.6), borderWidth: 1, borderDash: [3, 3],
          label: { display: true, content: String(i + 1), position: 'start', backgroundColor: col, color: '#0B1118', font: { size: 10, weight: 'bold' }, padding: { x: 5, y: 2 }, borderRadius: 8 } };
      });
      o.plugins = Object.assign({}, o.plugins, { annotation: { annotations: ann } });
      return o;
    })());
    _renderPanelLegend('ma-legend-price', [
      { label: ZONE_SHORT[STATE.zone] + ' day-ahead', color: '#E6EDF3' },
      { label: 'Gas plant cost (gas + CO₂): above it, gas plants earn money', color: DRIVER_COLOURS.ttf },
      { label: (ZONE_SHORT[STATE.data.nbZone] || 'Neighbour') + ' day-ahead', color: 'rgba(127,200,248,0.75)' },
    ]);

    _mkChart('ma-canvas-spark', 'line', {
      labels: labels,
      datasets: [
        { label: 'Residual load', endLabel: 'Residual load', data: f.resid, borderColor: '#E6EDF3', borderWidth: 1.4, pointRadius: 0, tension: 0, spanGaps: false,
          backgroundColor: 'rgba(230,237,243,0.08)', fill: 'origin' },
        { label: STATE.zone === 'FR' ? 'Nuclear available' : 'Nuclear output', endLabel: 'Nuclear avail.', data: f.drivers.nucAvail, borderColor: FUEL_COLORS.nuclear, borderWidth: 1.6, borderDash: [5, 3], pointRadius: 0, tension: 0, fill: false },
        { label: 'Net import', endLabel: 'Imports', data: f.drivers.flux, borderColor: DRIVER_COLOURS.flux, borderWidth: 1.2, pointRadius: 0, tension: 0, fill: false },
      ].concat(_hasFc() ? [{ label: 'Residual load · forecast', pkNoEnd: true, data: f.fc.resid, borderColor: '#E6EDF3', borderWidth: 1.3, borderDash: [2, 3], pointRadius: 0, tension: 0, fill: false, spanGaps: false }] : []),
    }, _commonChartOpts('GW'));
    _renderPanelLegend('ma-legend-resid', [
      { label: 'Residual load (demand − wind − solar)', color: '#E6EDF3' },
      { label: STATE.zone === 'FR' ? 'Nuclear available' : 'Nuclear output', color: FUEL_COLORS.nuclear },
      { label: 'Net import (− = export)', color: DRIVER_COLOURS.flux },
    ].concat(_hasFc() ? [{ label: 'Residual load · forecast (dotted)', color: '#E6EDF3', fc: true }] : []));

    _mkChart('ma-canvas-loadren', 'line', {
      labels: labels,
      datasets: [
        {
          label: 'Solar', endColor: FUEL_COLORS.solar, data: f.solar,
          backgroundColor: _hexA(FUEL_COLORS.solar, 0.45),
          borderColor: 'transparent', borderWidth: 0,
          fill: 'origin', pointRadius: 0, tension: 0, stack: 'ren',
        },
        {
          label: 'Wind', endColor: FUEL_COLORS.wind, data: f.wind,
          backgroundColor: _hexA(FUEL_COLORS.wind, 0.55),
          borderColor: 'transparent', borderWidth: 0,
          fill: 'origin', pointRadius: 0, tension: 0, stack: 'ren',
        },
        {
          label: 'Load', endLabel: 'Demand', data: f.load,
          borderColor: '#fff', borderWidth: 1.5, borderDash: [3, 2],
          pointRadius: 0, tension: 0, fill: false,
        },
      ].concat(_hasFc() ? [
        { label: 'Solar · forecast', pkNoEnd: true, data: f.fc.solar, borderColor: FUEL_COLORS.solar, borderWidth: 1.6, borderDash: [6, 4], pointRadius: 0, tension: 0, fill: false, spanGaps: false },
        { label: 'Wind · forecast', pkNoEnd: true, data: f.fc.wind, borderColor: FUEL_COLORS.wind, borderWidth: 1.6, borderDash: [6, 4], pointRadius: 0, tension: 0, fill: false, spanGaps: false },
        { label: 'Load · forecast', pkNoEnd: true, data: f.fc.load, borderColor: 'rgba(255,255,255,.75)', borderWidth: 1.2, borderDash: [1, 3], pointRadius: 0, tension: 0, fill: false, spanGaps: false },
      ] : []),
    }, _commonChartOpts('GW'));
    _renderPanelLegend('ma-legend-loadren', [
      { label: 'Solar', color: FUEL_COLORS.solar },
      { label: 'Wind', color: FUEL_COLORS.wind },
      { label: 'Load', color: '#fff' },
    ].concat(_hasFc() ? [{ label: 'Forecasts (TSO day-ahead): dashed lines', color: 'transparent', fc: true }] : []));

    const stackDatasets = FUEL_STACK.map(function (fuel) {
      const data = (fuel === 'wind' || fuel === 'solar') ? f[fuel] : f.mix[fuel];
      return {
        label: FUEL_LABELS[fuel], endColor: FUEL_COLORS[fuel], data: data,
        backgroundColor: _hexA(FUEL_COLORS[fuel], 0.78),
        borderColor: FUEL_COLORS[fuel], borderWidth: 0,
        fill: true, pointRadius: 0, tension: 0, stack: 'mix',
      };
    });
    const mixOpts = _commonChartOpts('GW');
    mixOpts.scales.y.stacked = true;
    mixOpts.scales.y.beginAtZero = true;
    mixOpts.plugins.maEndLabels = { on: true, stacked: true };
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
      if (it.fc) return '<span class="ma-fc-key"><span class="dot" style="background:transparent;border:1px dashed ' + (it.color === 'transparent' ? 'var(--acc,#7FC8F8)' : it.color) + '"></span>' + it.label + '</span>';
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
    const i = _lastIndex();
    if (i >= 0) _renderTooltip(i, null);
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
    const dateLbl = dt.toLocaleDateString(_loc(), { weekday: 'short', day: '2-digit', month: '2-digit' });
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

    const srmc = f.srmc[idx], nbP = f.nbPrice[idx], resid = f.resid[idx];
    const mg = _marginal(price, srmc, fossil, wind, solar, load);
    const marginal = mg.t, marginalClass = mg.c;

    const priceClass = price < 5 ? 'floor' : (price > 100 ? 'peak' : '');
    const sparkClass = spark < 0 ? 'floor' : (spark > 20 ? 'peak' : '');
    const priceColor = priceClass === 'peak' ? '#ED6965' : (priceClass === 'floor' ? '#14D3A9' : '#E6EDF3');
    const sparkColor = sparkClass === 'peak' ? '#ED6965' : (sparkClass === 'floor' ? '#14D3A9' : '#E6EDF3');
    const mgColor = marginalClass === 'gas' ? '#ED6965' : marginalClass === 'ren' ? '#14D3A9' : '#3FA6B4';
    const dot = (c) => '<span class="ma-ht-dot" style="background:' + c + '"></span>';

    const fl = f.fc ? f.fc.load[idx] : null, fw = f.fc ? f.fc.wind[idx] : null, fs = f.fc ? f.fc.solar[idx] : null, fr = f.fc ? f.fc.resid[idx] : null;
    const isFc = f.fcFrom >= 0 && idx >= f.fcFrom;
    const fcBlock = (fl != null || fw != null || fs != null)
      ? '<div class="ma-ht-box ma-ht-fc"><div class="ma-ht-section">' + (window.PKF ? PKF.chip('Forecast') : 'Forecast') + ' <span>TSO day-ahead</span></div><div class="ma-ht-grid">'
        + [['#E6EDF3', 'Demand', fl], [FUEL_COLORS.wind, 'Wind', fw], [FUEL_COLORS.solar, 'Solar', fs], ['#94a3b8', 'Residual load', fr]].filter(r => r[2] != null && !isNaN(r[2]))
          .map(r => '<div class="ma-ht-row"><span class="k">' + dot(r[0]) + r[1] + '</span><span class="v">' + fx(r[2], 1) + ' GW</span></div>').join('')
        + '</div>'
        + (!isFc && wind != null && fw != null ? '<div class="ma-ht-miss"><span>Forecast error (wind · solar)</span> : ' + (wind - fw >= 0 ? '+' : '') + fx(wind - fw, 1) + ' · ' + (solar != null && fs != null ? (solar - fs >= 0 ? '+' : '') + fx(solar - fs, 1) : '--') + ' GW</div>' : '')
        + '</div>'
      : '';
    // rows with a value only; what is missing is said once, at the end of its section
    const has = v => v != null && !isNaN(v);
    const rows = (list, missingNote) => {
      const ok = list.filter(r => has(r[2]));
      const miss = list.filter(r => !has(r[2])).map(r => r[1]);
      return (ok.length ? '<div class="ma-ht-grid">' + ok.map(([c, k, v, u, d, cls]) => '<div class="ma-ht-row"><span class="k">' + dot(c) + k + '</span><span class="v' + (cls ? ' ' + cls : '') + '">' + (d === 's' ? (v > 0 ? '+' : '') + fx(v, 1) : fx(v, d)) + ' ' + u + '</span></div>').join('') + '</div>' : '')
        + (miss.length ? '<div class="ma-ht-miss"><span>' + (missingNote || 'Not available') + '</span> : ' + miss.map(m => '<span>' + m + '</span>').join(', ') + '</div>' : '');   // one text per span: each is translated
    };
    const box = (title, body) => body ? '<div class="ma-ht-box"><div class="ma-ht-section">' + title + '</div>' + body + '</div>' : '';
    tip.innerHTML =
      '<div class="ma-ht-time">' + dateLbl + ' · ' + timeLbl + (isFc ? ' ' + (window.PKF ? PKF.chip('Forecast') : '') : '') + '</div>'
      + box('Prices',
          '<div class="ma-ht-hero">'
          + '<div class="ma-ht-hero-cell" style="border-left-color:' + priceColor + '"><div class="lab">Day-ahead ' + (ZONE_SHORT[STATE.zone] || '') + '</div><div class="big" style="color:' + priceColor + '">' + fx(price, price < 1 ? 2 : 1) + ' <span class="u">€</span></div></div>'
          + '<div class="ma-ht-hero-cell" style="border-left-color:' + sparkColor + '"><div class="lab">vs gas plant cost</div><div class="big" style="color:' + sparkColor + '">' + (has(spark) ? (spark >= 0 ? '+' : '') + fx(spark, 0) : '--') + ' <span class="u">€</span></div></div>'
          + '</div>'
          + rows([[DRIVER_COLOURS.ttf, 'Gas plant cost', srmc, '€', 0], ['rgba(127,200,248,0.75)', (_fr() ? 'Prix ' + (ZONE_SHORT[STATE.data.nbZone] || 'voisin') : (ZONE_SHORT[STATE.data.nbZone] || 'Neighbour') + ' price'), nbP, '€', 0]]))
      + box('Who sets the price', '<div class="ma-ht-marginal" style="background:' + _hexA(mgColor, 0.15) + ';color:' + mgColor + '">' + dot(mgColor) + marginal + '</div>')
      + (isFc ? fcBlock : '')
      + box('Generation and demand', rows([
          ['#E6EDF3', 'Demand', load, 'GW', 1], ['#94a3b8', 'Residual load', resid, 'GW', 1],
          [FUEL_COLORS.nuclear, 'Nuclear', nuc, 'GW', 1], [FUEL_COLORS.hydro, 'Hydro', hydro, 'GW', 1],
          [FUEL_COLORS.wind, 'Wind', wind, 'GW', 1], [FUEL_COLORS.solar, 'Solar', solar, 'GW', 1],
          [FUEL_COLORS.fossil, 'Fossil', fossil, 'GW', 1, fossil > 1 ? 'gas' : '']], isFc ? 'Not published yet for this hour' : 'Not available'))
      + box('Drivers', rows([
          [DRIVER_COLOURS.ttf, 'TTF', ttf, '€/MWh', 1], [DRIVER_COLOURS.eua, 'EUA', eua, '€/t', 1],
          [DRIVER_COLOURS.nuc, 'Nuclear available', nucA, 'GW', 0], [DRIVER_COLOURS.flux, 'Net imports', flux, 'GW', 's'],
          [DRIVER_COLOURS.wind, 'Wind 100 m', windS, 'm/s', 0], [DRIVER_COLOURS.temp, 'Temperature', temp, '°C', 0]], 'No data'))
      + (isFc ? '' : fcBlock);

    // Docked in its own column beside the charts (never over them).
    tip.style.display = 'block';
  }

  // Default readout: the last slot with a price, shown until the mouse
  // moves over the charts and again when it leaves them.
  function _lastIndex() {
    const p = (STATE.data && STATE.data.flat && STATE.data.flat.price) || [];
    for (let i = p.length - 1; i >= 0; i--) if (p[i] != null) return i;
    return -1;
  }

  // ════════════════════════════════════════════════════════════════
  // RENDER · EPISODES + CURSOR BADGES
  // ════════════════════════════════════════════════════════════════

  (function () { const st = document.createElement('style'); st.textContent = '.ma-episodes-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}.ma-episodes-top .ma-episode-card{cursor:pointer}'; document.head.appendChild(st); })();
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
    const labels = _fr() ? { floor: 'Plancher', peak: 'Pic', cannibalisation: 'Cannibalisation', weekend: 'Week-end' } : { floor: 'Floor', peak: 'Peak', cannibalisation: 'Cannibal', weekend: 'Weekend' };
    host.innerHTML = moments.map(function (m, i) {
      const colour = EPISODE_KIND_COLOURS[m.kind] || '#7A93AB';
      const dt = STATE.data.flat.slotDates[m.idx];
      const day = dt.toLocaleDateString(_loc(), { weekday: 'short' });
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
        gas_plant_cost: _r(f.srmc[m.idx], 0),
        residual_load_GW: _r(f.resid[m.idx], 1),
        nuclear_available_GW: _r(f.drivers.nucAvail[m.idx], 1),
        net_import_GW: _r(f.drivers.flux[m.idx], 1),
        neighbour_price: _r(f.nbPrice[m.idx], 1),
        marginal_reading: _marginal(f.price[m.idx], f.srmc[m.idx], f.mix.fossil[m.idx], f.wind[m.idx], f.solar[m.idx], f.load[m.idx]).t,
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
      gas_plant_cost_avg: _r(_avg(f.srmc), 0),
      share_of_slots_above_gas_cost: (function () { let n = 0, a = 0; f.price.forEach(function (p, i) { if (p != null && f.srmc[i] != null) { n++; if (p >= f.srmc[i]) a++; } }); return n ? _r(a / n * 100, 0) : null; })(),
      neighbour: STATE.data.nbZone,
      neighbour_price_avg: _r(_avg(f.nbPrice), 1),
      residual_load_avg_GW: _r(_avg(f.resid), 1),
      nuclear_available_avg_GW: _r(_avg(f.drivers.nucAvail), 1),
      net_import_avg_GW: _r(_avg(f.drivers.flux), 1),
      moments: moments,
      forecast_ahead: (function () {
        if (f.fcFrom < 0) return null;
        const sl = a => a.slice(f.fcFrom);
        return { note: 'TSO day-ahead forecasts for the slots after the last measured one (not actuals)',
          slots: f.fc.load.length - f.fcFrom, load_avg_GW: _r(_avg(sl(f.fc.load)), 1), wind_avg_GW: _r(_avg(sl(f.fc.wind)), 1),
          solar_avg_GW: _r(_avg(sl(f.fc.solar)), 1), residual_load_avg_GW: _r(_avg(sl(f.fc.resid)), 1),
          residual_load_max_GW: _r(Math.max.apply(null, sl(f.fc.resid).filter(v => v != null)), 1) };
      })(),
    };
  }

  // the market read written from the window's data (no AI): who set the price, coupling, residual load vs nuclear, renewables, commodities
  function _ruleRead() {
    const out = document.getElementById('ma-ai-content'); if (!out || !STATE.data) return;
    const f = STATE.data.flat, fr = _fr(), T2 = (a, b) => fr ? a : b, B = (t, c) => '<b style="color:' + (c || '#fff') + '">' + t + '</b>';
    const n = (v, d) => { if (v == null || isNaN(v)) return '–'; let t = (+v).toFixed(d); if (/^-0(\.0+)?$/.test(t)) t = t.slice(1); return fr ? t.replace('.', ',') : t; };
    const ZN = z => fr ? ({ FR: 'France', DE_LU: 'Allemagne', BE: 'Belgique', NL: 'Pays-Bas', ES: 'Espagne', PT: 'Portugal', IT_NORD: 'Italie Nord', CH: 'Suisse', AT: 'Autriche', PL: 'Pologne' }[z] || ZONE_NAME[z] || z) : (ZONE_NAME[z] || z);
    const pc = v => Math.abs(v) < 0.5 ? T2('stable', 'steady') : (v >= 0 ? '+' : '−') + n(Math.abs(v), 0) + ' %';
    const idx = f.price.map((p, i) => p != null ? i : -1).filter(i => i >= 0); if (!idx.length) { out.innerHTML = ''; return; }
    const P = idx.map(i => f.price[i]), avg = _avg(P), hi = idx.reduce((a, i) => f.price[i] > f.price[a] ? i : a, idx[0]), lo = idx.reduce((a, i) => f.price[i] < f.price[a] ? i : a, idx[0]);
    const when = i => { const d = f.slotDates[i]; return d.toLocaleDateString(_loc(), { weekday: 'short', day: 'numeric' }) + ' ' + String(d.getHours()).padStart(2, '0') + (fr ? ' h' : ':00'); };
    const S = [];
    S.push(T2('Sur la fenêtre, le day-ahead ', 'Over the window, the day-ahead ') + ZN(STATE.zone) + T2(' a fait ', ' averaged ') + B(n(avg, 1) + ' €/MWh') + T2(' en moyenne, de ', ', from ') + B(n(f.price[lo], 0) + ' €', '#14D3A9') + ' (' + when(lo) + ')' + T2(' à ', ' to ') + B(n(f.price[hi], 0) + ' €', '#ED6965') + ' (' + when(hi) + ').');
    const gs = idx.filter(i => f.srmc[i] != null), gasSet = gs.filter(i => f.price[i] >= f.srmc[i] - 5).length;
    if (gs.length) { const sh = gasSet / gs.length * 100;
      S.push(sh >= 40 ? T2('Le gaz a fixé le prix ', 'Gas set the price ') + B(n(sh, 0) + ' %') + T2(' du temps (prix au niveau du coût d’une centrale gaz) : le TTF et le CO₂ comptent directement.', ' of the time (price at a gas plant’s cost): TTF and CO₂ matter directly.')
        : T2('Le prix n’a atteint le coût d’une centrale gaz que ', 'The price reached a gas plant’s cost only ') + B(n(sh, 0) + ' %') + T2(' du temps : nucléaire, hydraulique et renouvelables fixent le prix, l’histoire est physique plus que gazière.', ' of the time: nuclear, hydro and renewables set it, the story is physical rather than gas.')); }
    const nb = idx.filter(i => f.nbPrice[i] != null);
    if (nb.length) { const cp = nb.filter(i => Math.abs(f.price[i] - f.nbPrice[i]) < 1).length / nb.length * 100, gap = _avg(nb.map(i => f.price[i] - f.nbPrice[i]));
      S.push(T2('Couplage avec ', 'Coupling with ') + (STATE.data.nbZone ? ZN(STATE.data.nbZone) : T2('le voisin', 'the neighbour')) + ' : ' + B(n(cp, 0) + ' %') + T2(' des heures au même prix ; écart moyen ', ' of hours at the same price; mean gap ') + B((gap >= 0 ? '+' : '') + n(gap, 1) + ' €') + '.'); }
    const rn = idx.filter(i => f.resid[i] != null && f.drivers.nucAvail[i] != null);
    if (rn.length) { const over = rn.filter(i => f.resid[i] > f.drivers.nucAvail[i]).length / rn.length * 100;
      S.push(T2('La charge résiduelle (conso − éolien − solaire) a dépassé le nucléaire disponible ', 'Residual load (demand − wind − solar) exceeded available nuclear ') + B(n(over, 0) + ' %', over > 30 ? '#ED6965' : '#14D3A9') + T2(' des heures : ', ' of hours: ') + (over > 30 ? T2('il a fallu des imports ou du gaz, d’où les pointes.', 'imports or gas were needed, hence the peaks.') : T2('le nucléaire et les renouvelables ont suffi la plupart du temps.', 'nuclear and renewables were enough most of the time.'))); }
    const neg = P.filter(p => p <= 0).length, w = _avg(idx.map(i => f.wind[i])), so = _avg(idx.map(i => f.solar[i]));
    S.push(T2('Éolien ', 'Wind ') + B(n(w, 1) + ' GW') + T2(' et solaire ', ' and solar ') + B(n(so, 1) + ' GW') + T2(' en moyenne', ' on average') + (neg ? T2(' ; ', '; ') + B(neg + T2(' créneaux à 0 € ou moins', ' slots at 0 € or below'), '#14D3A9') : '') + '.');
    const ttf = f.drivers.ttf.filter(v => v != null), eua = f.drivers.eua.filter(v => v != null);
    if (ttf.length > 1 && eua.length > 1) { const dt = (ttf[ttf.length - 1] / ttf[0] - 1) * 100, de = (eua[eua.length - 1] / eua[0] - 1) * 100;
      S.push(Math.abs(dt) < 3 && Math.abs(de) < 3 ? T2('TTF et CO₂ stables : les mouvements de prix viennent de la météo et de la disponibilité, pas des combustibles.', 'TTF and CO₂ steady: price moves come from weather and availability, not fuels.')
        : T2('Combustibles : TTF ', 'Fuels: TTF ') + B(pc(dt)) + T2(', CO₂ ', ', CO₂ ') + B(pc(de)) + T2(' sur la fenêtre.', ' over the window.')); }
    out.innerHTML = '<div style="font-family:Inter,sans-serif;font-size:12.5px;color:var(--tx2);line-height:1.75">' + S.join(' ') + '</div>';
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
    const systemPrompt = 'You are a senior power market analyst writing for a director-level origination audience (PPA, BESS, supply). Given window data with prices, the gas plant cost (CCGT fuel + CO2: price above it = gas in the money, price far below = nuclear/hydro/renewables set the price), the neighbour’s price, residual load (demand − wind − solar) against nuclear availability and net imports, key moments and drivers (TTF, EUA, wind, weather), write a SHORT causal market read.\n\nStyle:\n- Trading desk morning note tone\n- UK English\n- 3-5 punchy sentences, no bullets\n- Each sentence chains causes: "X happened, therefore Y, therefore Z"\n- Be specific with numbers\n- Use <b style="color:#fff">…</b> to highlight key figures, fuels, and turning points\n- Use <b style="color:#14D3A9">…</b> for positive/floor values and <b style="color:#ED6965">…</b> for peaks/risks\n- Focus on what an originator needs: capture rates, marginal fuel switches, BESS arbitrage spreads, PPA stress signals\n- No preamble. Just the text.\n\nReading order: the weather drives the supply mix, which drives the marginal fuel and price. If TTF and EUA are stable, the price story is physical (weather, availability), not commodity. In France, compare residual load with nuclear availability: when residual load exceeds it, imports or gas set the price. Say how often the price reached the gas plant cost and whether the market stayed coupled with the neighbour. Reflect this hierarchy explicitly.';

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
      // the model's text is escaped, then only its <b style="color:#…"> highlights are given back
      const safe = String(text || 'No response received.').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
        .replace(/&lt;b style=&quot;color:(#[0-9A-Fa-f]{3,6})&quot;&gt;/g, '<b style="color:$1">').replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
      out.innerHTML = '<div style="font-family:\'Inter\',sans-serif;font-size:12px;color:#B8C9D9;line-height:1.7">' + safe + '</div>';
    } catch (err) {
      out.innerHTML = '<div style="color:#ED6965;font-family:\'JetBrains Mono\',monospace;font-size:11px;padding:10px">API error: ' + err.message + '. On a static deployment a serverless proxy is needed to hide the API key.</div>';
    } finally {
      STATE.aiBusy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '✦ ' + (_fr() ? 'Version IA (facultatif)' : 'AI version (optional)'); }
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

    const fcp = document.getElementById('ma-fc-pills');
    if (fcp) fcp.innerHTML = pkPill({ label: 'On', active: STATE.showFc, onClick: 'maSetForecast(true)' }) + pkPill({ label: 'Off', active: !STATE.showFc, onClick: 'maSetForecast(false)' });

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
    _ruleRead();
    _clearHover();   // side panel starts on the latest slot
  }

  window.maSetWindow = function (days) { STATE.windowDays = days; _reload(); };
  window.maSetGranularity = function (g) { STATE.granularity = g; _reload(); };
  window.maSetZone = function (zone) { STATE.zone = zone; _reload(); _renderOutlook(); };
  window.maSetForecast = function (on) { STATE.showFc = !!on; _reload(); };

  // Forecast section under the panels: tomorrow in figures, the next 48 h, and the 5-week weather outlook.
  const OUTLOOK_CC = { FR: 'FR', DE_LU: 'DE', BE: 'BE', NL: 'NL', ES: 'ES' };
  function _renderOutlook() {
    if (!window.PKW || !window.PKF) return;
    const z = STATE.zone, cc = OUTLOOK_CC[z] || 'FR';
    const t = document.getElementById('ma-fc-tiles'); if (t) PKF.tiles(t, z);
    const sub = (id, r) => { const e = document.getElementById(id); if (e && r && r.sub) e.textContent = r.sub; };
    PKW.draw('fc-48h', 'ma-fc-48h', { zone: z }).then(r => sub('ma-fc-48h-sub', r));
    PKW.draw('wx-outlook', 'ma-fc-wind', { country: cc, series: 'wind', past: '7' }).then(r => sub('ma-fc-wind-sub', r));
    PKW.draw('wx-outlook', 'ma-fc-solar', { country: cc, series: 'solar', past: '7' }).then(r => sub('ma-fc-solar-sub', r));
  }

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
    // STATE.endDate is a Paris calendar day 'YYYY-MM-DD' (latest day with data).
    if (!STATE.endDate) {
      const today = pkTodayISO();
      for (let i = 0; i < 8; i++) {
        const ds = _renAdd(today, -i);
        const d = await _fetchDaily(ds);
        if (d && d.zones && d.zones[STATE.zone]) { STATE.endDate = ds; break; }
      }
      if (!STATE.endDate) STATE.endDate = today;
    }

    const wrap = document.getElementById('ma-panels-wrap');
    if (wrap) wrap.addEventListener('mouseleave', _clearHover);

    await _reload();
    _renderOutlook();
  };

  window.maGenerateAIRefresh = window.maGenerateAI;

})();
