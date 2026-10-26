// ════════════════════════════════════════════════════════════════════
// POWER MAP — European electricity, hour by hour.
// Inspired by Electricity Maps and RTE éCO2mix: choropleth by carbon
// intensity / day-ahead price / renewable or low-carbon share / net
// import, animated cross-border flows, hour slider, zone ranking, and a
// detail panel (electricity origin, 24 h mix and price, intensity).
//
// Data
//   data/map/YYYY-MM-DD.json      generation per ENTSO-E type, load, net
//                                 import per country, hourly, Paris clock
//                                 (Energy-Charts; scripts/fetch_energy_charts.py --map)
//   data/history/flows/YYYY-MM.json  physical flows per border, hourly
//   data/history/daily/D.json     day-ahead prices per bidding zone
//   France: RTE éCO2mix (js/fr-rte.js) instead of Energy-Charts.
//   data/geo/europe.json          Natural Earth 1:50m, Europe subset
// Carbon factors: CARBON_FACTORS / productionIntensity (js/carbon.js).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const NAMES = { AL: 'Albania', AT: 'Austria', BA: 'Bosnia & Herz.', BE: 'Belgium', BG: 'Bulgaria', CH: 'Switzerland', CZ: 'Czechia',
    DE: 'Germany', DK: 'Denmark', EE: 'Estonia', ES: 'Spain', FI: 'Finland', FR: 'France', GB: 'Great Britain', GR: 'Greece', HR: 'Croatia',
    HU: 'Hungary', IE: 'Ireland', IT: 'Italy', LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia', ME: 'Montenegro', MK: 'North Macedonia',
    NL: 'Netherlands', NO: 'Norway', PL: 'Poland', PT: 'Portugal', RO: 'Romania', RS: 'Serbia', SE: 'Sweden', SI: 'Slovenia', SK: 'Slovakia',
    XK: 'Kosovo', MT: 'Malta', UA: 'Ukraine', MD: 'Moldova', TR: 'Türkiye', BY: 'Belarus', IS: 'Iceland', CY: 'Cyprus' };
  // Country → bidding zones whose day-ahead prices are averaged
  const PRICE_ZONES = { FR: ['FR'], DE: ['DE_LU'], LU: ['DE_LU'], BE: ['BE'], NL: ['NL'], ES: ['ES'], PT: ['PT'], AT: ['AT'], CH: ['CH'],
    CZ: ['CZ'], SK: ['SK'], HU: ['HU'], PL: ['PL'], RO: ['RO'], HR: ['HR'], SI: ['SI'], RS: ['RS'], BG: ['BG'], GR: ['GR'], MK: ['MK'],
    ME: ['ME'], FI: ['FI'], EE: ['EE'], LV: ['LV'], LT: ['LT'],
    IT: ['IT_NORD', 'IT_CNOR', 'IT_CSUD', 'IT_SUD', 'IT_CALA', 'IT_SICI', 'IT_SARD'], DK: ['DK_E', 'DK_W'],
    SE: ['SE', 'SE_1', 'SE_2', 'SE_3', 'SE_4'], NO: ['NO_1', 'NO_2', 'NO_3', 'NO_4', 'NO_5'] };
  // Display groups (Electricity Maps order), ENTSO-E codes
  const GROUPS = [
    { k: 'nuclear', label: 'Nuclear', color: '#7B4B9C', codes: ['B14'] },
    { k: 'wind', label: 'Wind', color: '#14D3A9', codes: ['B18', 'B19'] },
    { k: 'solar', label: 'Solar', color: '#FBBF24', codes: ['B16'] },
    { k: 'hydro', label: 'Hydro', color: '#3FA6B4', codes: ['B11', 'B12', 'B13'] },
    { k: 'storage', label: 'Hydro storage & batteries', color: '#60A5FA', codes: ['B10', 'B25'] },
    { k: 'bio', label: 'Biomass & other RES', color: '#94D2BD', codes: ['B01', 'B09', 'B15'] },
    { k: 'gas', label: 'Gas', color: '#F97316', codes: ['B04', 'B03'] },
    { k: 'coal', label: 'Coal & lignite', color: '#78716C', codes: ['B02', 'B05', 'B08'] },
    { k: 'oil', label: 'Oil', color: '#B45309', codes: ['B06', 'B07'] },
    { k: 'other', label: 'Waste & unknown', color: '#94A3B8', codes: ['B17', 'B20'] },
  ];
  const REN = ['B01', 'B09', 'B11', 'B12', 'B13', 'B15', 'B16', 'B18', 'B19'];
  const LOWC = REN.concat(['B14']);
  const FALLBACK_CO2 = { B01: 230, B02: 1050, B03: 820, B04: 490, B05: 820, B06: 650, B07: 900, B08: 1000, B09: 38, B10: 24, B11: 24, B12: 24,
    B13: 17, B14: 12, B15: 26, B16: 45, B17: 580, B18: 12, B19: 11, B20: 700, B25: 0 };
  const co2Of = c => (typeof CARBON_FACTORS !== 'undefined' && CARBON_FACTORS[c]) ? CARBON_FACTORS[c].co2 : (FALLBACK_CO2[c] ?? 700);

  const METRICS = {
    co2: { label: 'Carbon intensity', unit: 'g/kWh', fmt: v => Math.round(v), lowGood: true },
    price: { label: 'Day-ahead price', unit: '€/MWh', fmt: v => v.toFixed(1), lowGood: true },
    ren: { label: 'Renewable share', unit: '%', fmt: v => Math.round(v), lowGood: false },
    lowc: { label: 'Low-carbon share', unit: '%', fmt: v => Math.round(v), lowGood: false },
    net: { label: 'Net import', unit: 'GW', fmt: v => (v > 0 ? '+' : '') + (v / 1000).toFixed(1), lowGood: null },
    // market (daily = the hour slider does not apply)
    delta: { label: 'Price vs previous day', unit: '€/MWh', fmt: v => (v > 0 ? '+' : '') + v.toFixed(1), lowGood: true, daily: true, market: true },
    tb2: { label: 'Battery spread (TB2)', unit: '€/MWh', fmt: v => Math.round(v), lowGood: false, daily: true, market: true },
    neg: { label: 'Negative-price hours', unit: 'h', fmt: v => v % 1 ? v.toFixed(2) : String(v), lowGood: false, daily: true, market: true },
    scap: { label: 'Solar capture rate', unit: '% of base', fmt: v => Math.round(v), lowGood: false, daily: true, market: true },
    wcap: { label: 'Wind capture rate', unit: '% of base', fmt: v => Math.round(v), lowGood: false, daily: true, market: true },
    css: { label: 'Clean spark spread', unit: '€/MWh', fmt: v => (v > 0 ? '+' : '') + v.toFixed(1), lowGood: false, market: true },
    cds: { label: 'Clean dark spread', unit: '€/MWh', fmt: v => (v > 0 ? '+' : '') + v.toFixed(1), lowGood: false, market: true },
    fwd: { label: 'Forward Y+1 baseload', unit: '€/MWh', fmt: v => v.toFixed(1), lowGood: true, daily: true, market: true },
  };
  METRICS.price.market = true;

  const S = { day: 0, hour: null, avg: false, metric: 'co2', sel: 'FR', playing: null, data: null, map: null, geo: null,
    layer: null, flowLayer: null, labelLayer: null, charts: {}, init: false };

  // ── helpers ──
  const iso = d => d.toISOString().slice(0, 10);
  function parisToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()); }
  function parisHour() { return +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date()); }
  function addDays(s, n) { const [y, m, d] = s.split('-').map(Number); return iso(new Date(Date.UTC(y, m - 1, d + n))); }
  const base = () => (typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : 'data/');
  const getJSON = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
  const flag = c => c && c.length === 2 && c !== 'XK' ? String.fromCodePoint(...[...c].map(ch => 127397 + ch.charCodeAt(0))) : '';
  const fmtMW = v => v == null ? '–' : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + ' GW' : Math.round(v) + ' MW';
  const lerp = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  function ramp(stops, v) {
    if (v == null || isNaN(v)) return null;
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
      const t = (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return lerp(stops[i - 1][1], stops[i][1], t);
    }
    return stops[stops.length - 1][1];
  }
  const RAMPS = {
    co2: [[0, [42, 163, 100]], [150, [245, 235, 77]], [400, [158, 66, 41]], [800, [56, 29, 2]]],
    price: [[-20, [59, 130, 246]], [0, [20, 211, 169]], [60, [245, 235, 77]], [130, [249, 115, 22]], [250, [190, 30, 45]]],
    ren: [[0, [56, 29, 2]], [30, [158, 66, 41]], [60, [245, 235, 77]], [100, [42, 163, 100]]],
    lowc: [[0, [56, 29, 2]], [30, [158, 66, 41]], [60, [245, 235, 77]], [100, [42, 163, 100]]],
    net: [[-8000, [20, 211, 169]], [0, [71, 85, 105]], [8000, [249, 115, 22]]],
    delta: [[-40, [59, 130, 246]], [0, [71, 85, 105]], [40, [249, 115, 22]]],
    tb2: [[0, [30, 41, 59]], [40, [20, 120, 140]], [120, [20, 211, 169]], [250, [245, 235, 77]]],
    neg: [[0, [51, 65, 85]], [2, [96, 165, 250]], [8, [59, 130, 246]], [14, [30, 58, 138]]],
    scap: [[20, [190, 30, 45]], [60, [245, 235, 77]], [100, [42, 163, 100]]],
    wcap: [[50, [190, 30, 45]], [80, [245, 235, 77]], [105, [42, 163, 100]]],
    css: [[-60, [190, 30, 45]], [0, [71, 85, 105]], [60, [42, 163, 100]]],
    cds: [[-60, [190, 30, 45]], [0, [71, 85, 105]], [60, [42, 163, 100]]],
    fwd: [[40, [20, 211, 169]], [90, [245, 235, 77]], [150, [249, 115, 22]], [220, [190, 30, 45]]],
  };
  const colorFor = (m, v) => { const c = ramp(RAMPS[m], v); return c ? `rgb(${c[0]},${c[1]},${c[2]})` : null; };

  // ── data ──
  async function loadDay(dateISO) {
    const [mapF, flowsF, pricesF, prevF, fwdF] = await Promise.all([
      getJSON(base() + 'map/' + dateISO + '.json'),
      getJSON(base() + 'history/flows/' + dateISO.slice(0, 7) + '.json'),
      getJSON(base() + 'history/daily/' + dateISO + '.json'),
      getJSON(base() + 'history/daily/' + addDays(dateISO, -1) + '.json'),
      S.fwd || (S.fwd = getJSON(base() + 'fr_market.json')),
    ]);
    let refs = null;
    if (window.PKC) { try { await PKC.ready; refs = PKC.refsFor(dateISO); } catch (_) { refs = null; } }
    const C = {};   // country → { gen: {code: [24]}, load, net, storageIn, price: [24] }
    if (mapF && mapF.countries) Object.entries(mapF.countries).forEach(([c, v]) => { C[c] = { gen: v.gen || {}, load: v.load, net: v.net, storageIn: v.storageIn, src: 'Energy-Charts' }; });
    // France from RTE éCO2mix (complete, 15-min, live)
    if (window.pkRte) {
      const R = await window.pkRte.day(dateISO).catch(() => null);
      if (R && Array.isArray(R.nuclear)) {
        const h = a => Array.isArray(a) ? Array.from({ length: 24 }, (_, i) => { const v = a.slice(i * 4, i * 4 + 4).filter(x => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; }) : null;
        const split = Array.isArray(R.windOnshore) && R.windOnshore.some(v => v != null);
        const g = { B14: h(R.nuclear), B19: h(split ? R.windOnshore : R.wind), B18: split ? h(R.windOffshore) : null, B16: h(R.solar),
          B11: h(R.hydroRoR), B12: h(R.hydroLake), B10: h(R.hydroPS), B04: h(R.gas), B05: h(R.coal), B06: h(R.oil), B01: h(R.bio), B25: h(R.batteryDischarge) };
        Object.keys(g).forEach(k => { if (!g[k] || !g[k].some(v => v)) delete g[k]; });
        const ex = h(R.exchanges);
        const sIn = [h(R.pumping), h(R.batteryCharge)].filter(Boolean);
        // éCO2mix physical exchanges: + = import, − = export (same sign as the map)
        C.FR = { gen: g, load: h(R.load), net: ex || (C.FR && C.FR.net), src: 'RTE éCO2mix',
          storageIn: sIn.length ? sIn[0].map((v, i) => sIn.reduce((s, a) => s + (a[i] || 0), 0)) : null };
      }
    }
    // Prices (hourly means of the 96 Paris slots)
    const toHourly = (file, c) => {
      const zones = file && file.zones || {};
      // A whole day at exactly 0.00 is a broken feed (same rule as pkSanitizeZones), not a price.
      const arrs = PRICE_ZONES[c].map(z => zones[z] && zones[z].hourly).filter(a => Array.isArray(a) && a.length && a.some(v => v != null && v !== 0));
      if (!arrs.length) return null;
      const hourly = Array.from({ length: 24 }, (_, i) => {
        const v = []; arrs.forEach(a => { const per = a.length / 24; a.slice(i * per, (i + 1) * per).forEach(x => { if (x != null) v.push(x); }); });
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
      });
      // negative quarter-hours averaged over the country's zones, in hours
      const negH = arrs.reduce((s, a) => s + a.filter(x => x != null && x < 0).length * 24 / a.length, 0) / arrs.length;
      // the published daily average (a 25-hour day counts its repeated hour, which the 96-slot series leaves out)
      const avgs = PRICE_ZONES[c].map(z => zones[z] && zones[z].avg).filter(v => v != null);
      return { hourly, negH, avg: avgs.length === arrs.length && avgs.length ? avgs.reduce((s, x) => s + x, 0) / avgs.length : null };
    };
    Object.keys(PRICE_ZONES).forEach(c => {
      const t = toHourly(pricesF, c); if (!t) return;
      const d = (C[c] = C[c] || { gen: {} });
      d.price = t.hourly; d.priceAvg = t.avg; d.negH = Math.round(t.negH * 4) / 4;
      const pv = toHourly(prevF, c); if (pv) { d.pricePrev = pv.hourly; d.pricePrevAvg = pv.avg; }
    });
    // Forward Y+1 baseload (FR, DE, NL, GB converted from GBP)
    const F = fwdF && fwdF.countries || {};
    let gbpEur = null;
    if (window.PKC) { const g = PKC.last('gbpusd'), e = PKC.last('eurusd'); gbpEur = g && e ? g.v / e.v : null; }
    [['FR', 'FR', 1], ['DE', 'DE', 1], ['NL', 'NL', 1], ['GB', 'UK', gbpEur]].forEach(([c, k, conv]) => {
      const r = F[k] && (F[k].forwardCurve || []).find(x => x.tenor === 'Y+1');
      if (r && r.value != null && conv) { (C[c] = C[c] || { gen: {} }).fwd = { value: r.value * conv, contract: (r.contract || '').replace(/\s+base$/, '') }; }
    });
    // Border flows: edge "A|B" (A < B) → [24] MW from A to B
    const E = {};
    const fd = flowsF && flowsF.days && flowsF.days[dateISO] || {};
    Object.entries(fd).forEach(([c, byN]) => Object.entries(byN).forEach(([n, arr]) => {
      if (!Array.isArray(arr) || n === c) return;
      const [a, b] = c < n ? [c, n] : [n, c];
      const key = a + '|' + b;
      if (E[key]) return;   // first reporter wins
      // arr = import into c from n
      E[key] = arr.map(v => v == null ? null : (c === a ? -v : v));
    }));
    return { date: dateISO, C, E, refs, reporters: Object.keys(fd), hasGen: !!(mapF && mapF.countries) || !!(C.FR && C.FR.gen && Object.keys(C.FR.gen).length) };
  }

  // Values of one country at hour h (null = daily average)
  function snapshot(c, h) {
    const d = S.data && S.data.C[c]; if (!d) return null;
    const at = a => {
      if (!Array.isArray(a)) return null;
      if (h != null) return a[h] ?? null;
      const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    };
    const gen = {}; let tot = 0;
    Object.entries(d.gen || {}).forEach(([k, a]) => { const v = at(a); if (v != null && v > 0) { gen[k] = v; tot += v; } });
    const out = { c, gen, total: tot || null, price: at(d.price), load: at(d.load), net: at(d.net), src: d.src };
    // market — daily figures
    const P = Array.isArray(d.price) ? d.price : null;
    if (P) {
      const pv = P.map((v, i) => [v, i]).filter(x => x[0] != null);
      const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
      out.base = d.priceAvg != null ? d.priceAvg : mean(pv.map(x => x[0]));
      out.peak = mean(pv.filter(x => x[1] >= 8 && x[1] < 20).map(x => x[0]));
      out.min = pv.length ? Math.min(...pv.map(x => x[0])) : null;
      out.max = pv.length ? Math.max(...pv.map(x => x[0])) : null;
      const srt = pv.map(x => x[0]).sort((a, b) => a - b);
      out.tb2 = srt.length >= 4 ? (srt[srt.length - 1] + srt[srt.length - 2] - srt[0] - srt[1]) / 2 : null;
      out.negH = d.negH;
      if (Array.isArray(d.pricePrev)) { const b0 = d.pricePrevAvg != null ? d.pricePrevAvg : mean(d.pricePrev.filter(x => x != null)); out.delta = b0 != null && out.base != null ? out.base - b0 : null; out.basePrev = b0; }
      // capture prices over the hours where both output and price exist
      const capture = codes => {
        let sw = 0, sp = 0, bs = [];
        for (let i = 0; i < 24; i++) {
          if (P[i] == null) continue;
          let g = null; codes.forEach(k => { const a = d.gen && d.gen[k]; if (a && a[i] != null) g = (g || 0) + a[i]; });
          if (g == null) continue;
          bs.push(P[i]); if (g > 0) { sw += g; sp += g * P[i]; }
        }
        const b = mean(bs);
        return sw > 0 && b != null ? { price: sp / sw, rate: b > 5 ? sp / sw / b * 100 : null } : null;
      };
      out.solarCap = capture(['B16']); out.windCap = capture(['B18', 'B19']);
      out.scap = out.solarCap && out.solarCap.rate; out.wcap = out.windCap && out.windCap.rate;
      // clean spark / dark at the hour (or on the daily base)
      const R = S.data && S.data.refs, ref = h != null ? out.price : out.base;
      if (R && window.PKC && ref != null) {
        out.css = PKC.cleanSpark(ref, R.ttf, R.eua);
        out.cds = PKC.cleanDark(ref, R.coal, R.eurusd, R.eua);
      }
    }
    if (d.fwd) { out.fwd = d.fwd.value; out.fwdContract = d.fwd.contract; }
    if (tot > 0) {
      let em = 0, ren = 0, low = 0, prim = 0;
      Object.entries(gen).forEach(([k, v]) => {
        if (k === 'B10' || k === 'B25') return;   // storage: shifted energy, not primary generation
        prim += v; em += v * co2Of(k);
        if (REN.includes(k)) ren += v;
        if (LOWC.includes(k)) low += v;
      });
      out.co2Prod = prim ? em / prim : null;
      out.ren = prim ? ren / prim * 100 : null;
      out.lowc = prim ? low / prim * 100 : null;
    }
    return out;
  }
  // Consumption-based intensity where every border of the country is known
  function withConsumption(snaps, h) {
    const rep = new Set(S.data.reporters);
    Object.values(snaps).forEach(s => {
      s.co2 = s.co2Prod ?? null; s.co2Basis = 'production';
      if (!rep.has(s.c) || s.co2Prod == null) return;
      let em = s.total * s.co2Prod, cons = s.total, ok = true;
      imports(s.c, h).forEach(f => {
        if (f.mw > 0) { const o = snaps[f.n]; if (!o || o.co2Prod == null) { ok = false; return; } em += f.mw * o.co2Prod; cons += f.mw; }
        else { em += f.mw * s.co2Prod; cons += f.mw; }
      });
      if (ok && cons > 0) { s.co2 = em / cons; s.co2Basis = 'consumption'; }
    });
  }
  // Flows touching a country at hour h: [{ n, mw }] with + = import into c
  function imports(c, h) {
    const out = [];
    Object.entries(S.data.E).forEach(([key, arr]) => {
      const [a, b] = key.split('|'); if (a !== c && b !== c) return;
      let v;
      if (h != null) v = arr[h];
      else { const x = arr.filter(y => y != null); v = x.length ? x.reduce((s, y) => s + y, 0) / x.length : null; }
      if (v == null) return;
      out.push({ n: a === c ? b : a, mw: a === c ? -v : v });
    });
    return out.sort((x, y) => y.mw - x.mw);
  }
  function allSnaps() {
    const h = S.avg ? null : S.hour;
    const snaps = {};
    Object.keys(S.data.C).forEach(c => { const s = snapshot(c, h); if (s) snaps[c] = s; });
    withConsumption(snaps, h);
    return snaps;
  }
  const valueOf = (s, m) => !s ? null : m === 'co2' ? s.co2 : m === 'ren' ? s.ren : m === 'lowc' ? s.lowc : m === 'net' ? s.net : (s[m] ?? null);

  // ── map ──
  function styleFor(feature, snaps) {
    const c = feature.properties.iso, v = valueOf(snaps[c], S.metric), col = colorFor(S.metric, v);
    const sel = c === S.sel;
    return { fillColor: col || '#1e2630', fillOpacity: col ? 0.88 : 0.55, color: sel ? '#ffffff' : 'rgba(10,14,20,.9)', weight: sel ? 2.2 : 0.8 };
  }
  function drawMap() {
    if (!S.map || !S.geo) return;
    const snaps = allSnaps();
    S.snaps = snaps;
    if (!S.layer) {
      S.layer = L.geoJSON(S.geo, {
        style: f => styleFor(f, S.snaps),
        onEachFeature: (f, layer) => {
          layer.on('click', () => select(f.properties.iso));
          layer.on('mouseover', e => { e.target.setStyle({ weight: 2, color: '#e2e8f0' }); showTip(f.properties.iso, e.latlng); });
          layer.on('mousemove', e => showTip(f.properties.iso, e.latlng));
          layer.on('mouseout', e => { S.layer.resetStyle(e.target); S.map.closeTooltip(S.tip); });
        },
        smoothFactor: 0.5,
      }).addTo(S.map);
    } else S.layer.setStyle(f => styleFor(f, snaps));
    drawLabels(snaps);
    drawFlows();
  }
  function showTip(c, latlng) {
    const s = S.snaps[c], m = METRICS[S.metric], v = valueOf(s, S.metric);
    const html = `<div class="pm-tip"><b>${flag(c)} ${NAMES[c] || c}</b><span>${m.label}: <b>${v == null ? 'no data' : m.fmt(v) + ' ' + m.unit}</b></span>` +
      (s && s.co2 != null && S.metric !== 'co2' ? `<span>${Math.round(s.co2)} g/kWh</span>` : '') + `</div>`;
    if (!S.tip) S.tip = L.tooltip({ direction: 'top', offset: [0, -6], className: 'pm-leaflet-tip' });
    S.tip.setLatLng(latlng).setContent(html); S.map.openTooltip(S.tip);
  }
  function center(c) {
    const f = S.geo.features.find(x => x.properties.iso === c);
    return f && f.properties.lx != null ? [f.properties.ly, f.properties.lx] : null;
  }
  function drawLabels(snaps) {
    if (S.labelLayer) S.labelLayer.clearLayers(); else S.labelLayer = L.layerGroup().addTo(S.map);
    const m = METRICS[S.metric];
    Object.values(snaps).forEach(s => {
      const v = valueOf(s, S.metric), p = center(s.c); if (v == null || !p) return;
      const icon = L.divIcon({ className: 'pm-label', html: `<span>${m.fmt(v)}</span>`, iconSize: [40, 16], iconAnchor: [20, 8] });
      S.labelLayer.addLayer(L.marker(p, { icon, interactive: false, keyboard: false }));
    });
  }
  function drawFlows() {
    if (S.flowLayer) S.flowLayer.clearLayers(); else S.flowLayer = L.layerGroup().addTo(S.map);
    const h = S.avg ? null : S.hour;
    Object.entries(S.data.E).forEach(([key, arr]) => {
      const [a, b] = key.split('|');
      let v = h != null ? arr[h] : (() => { const x = arr.filter(y => y != null); return x.length ? x.reduce((s, y) => s + y, 0) / x.length : null; })();
      if (v == null || Math.abs(v) < 50) return;
      const [from, to] = v > 0 ? [a, b] : [b, a];
      const p1 = center(from), p2 = center(to); if (!p1 || !p2) return;
      // shorten both ends so arrows sit across the border
      const k = 0.28, s1 = [p1[0] + (p2[0] - p1[0]) * k, p1[1] + (p2[1] - p1[1]) * k], s2 = [p1[0] + (p2[0] - p1[0]) * (1 - k), p1[1] + (p2[1] - p1[1]) * (1 - k)];
      const w = Math.max(1.5, Math.min(8, Math.sqrt(Math.abs(v)) / 10));
      const pf = S.snaps[from] && (h != null ? S.snaps[from].price : S.snaps[from].base), pt = S.snaps[to] && (h != null ? S.snaps[to].price : S.snaps[to].base);
      const spread = pf != null && pt != null ? pt - pf : null;
      const adverse = spread != null && spread < -1;          // flowing from the expensive to the cheap side
      const mkt = METRICS[S.metric].market;
      const col = mkt && adverse ? '#FB923C' : '#E2E8F0';
      const line = L.polyline([s1, s2], { color: col, weight: w, opacity: 0.85, className: 'pm-flow', interactive: true });
      line.bindTooltip(`${flag(from)} ${from} → ${flag(to)} ${to}<br><b>${fmtMW(Math.abs(v))}</b>` +
        (spread != null ? `<br>${from} ${pf.toFixed(1)} → ${to} ${pt.toFixed(1)} €/MWh<br>spread ${spread >= 0 ? '+' : ''}${spread.toFixed(1)} €/MWh${adverse ? ' · <span style="color:#FB923C">against the price signal</span>' : Math.abs(spread) < 1 ? ' · prices coupled' : ''}` : ''),
        { sticky: true, className: 'pm-leaflet-tip' });
      S.flowLayer.addLayer(line);
      // arrow head at the far end
      const ang = Math.atan2(-(s2[0] - s1[0]), s2[1] - s1[1]) * 180 / Math.PI;   // screen angle (lat up)
      const head = L.divIcon({ className: 'pm-arrow', html: `<div style="transform:rotate(${ang}deg);--w:${4 + w}px;--c:${col}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
      S.flowLayer.addLayer(L.marker(s2, { icon: head, interactive: false, keyboard: false }));
    });
  }

  // ── side lists ──
  function drawRanking() {
    const host = document.getElementById('pm-rank'); if (!host) return;
    const m = METRICS[S.metric];
    const q = (document.getElementById('pm-search') || {}).value || '';
    const rows = Object.values(S.snaps).map(s => ({ s, v: valueOf(s, S.metric) })).filter(r => r.v != null)
      .filter(r => !q || (NAMES[r.s.c] || r.s.c).toLowerCase().includes(q.toLowerCase()) || r.s.c.toLowerCase().includes(q.toLowerCase()));
    rows.sort((a, b) => m.lowGood === false ? b.v - a.v : a.v - b.v);
    if (S.metric === 'net') rows.sort((a, b) => b.v - a.v);
    const vals = rows.map(r => Math.abs(r.v)), mx = Math.max(1, ...vals);
    host.innerHTML = rows.map((r, i) => `<button class="pm-rank-row${r.s.c === S.sel ? ' sel' : ''}" onclick="PKMap.select('${r.s.c}')">
      <span class="pm-rank-i">${i + 1}</span><span class="pm-rank-f">${flag(r.s.c)}</span><span class="pm-rank-n">${NAMES[r.s.c] || r.s.c}</span>
      <span class="pm-rank-bar"><i style="width:${Math.abs(r.v) / mx * 100}%;background:${colorFor(S.metric, r.v)}"></i></span>
      <span class="pm-rank-v">${m.fmt(r.v)}</span></button>`).join('') || '<div class="pm-empty">No data for this hour</div>';
  }
  function drawKpis() {
    const host = document.getElementById('pm-kpis'); if (!host) return;
    const list = Object.values(S.snaps);
    const withCo2 = list.filter(s => s.co2 != null && s.total);
    const totG = withCo2.reduce((a, s) => a + s.total, 0);
    const eu = totG ? withCo2.reduce((a, s) => a + s.co2 * s.total, 0) / totG : null;
    const best = withCo2.slice().sort((a, b) => a.co2 - b.co2)[0], worst = withCo2.slice().sort((a, b) => b.co2 - a.co2)[0];
    const pr = list.filter(s => s.price != null).sort((a, b) => b.price - a.price);
    const k = (lbl, val, sub) => `<div class="kpi-card kpi-flat pm-kpi"><div class="kpi-label">${lbl}</div><div class="kpi-value">${val}</div><div class="kpi-meta">${sub}</div></div>`;
    if (METRICS[S.metric].market) {
      const h = S.avg ? null : S.hour;
      const val = s => h != null ? s.price : s.base;
      const P = list.filter(s => val(s) != null).sort((a, b) => val(a) - val(b));
      const avgP = P.length ? P.reduce((a, s) => a + val(s), 0) / P.length : null;
      const negN = list.filter(s => h != null ? s.price != null && s.price < 0 : s.negH > 0).length;
      let best = null;
      Object.keys(S.data.E).forEach(key => { const [a, b] = key.split('|'); const x = S.snaps[a], y = S.snaps[b]; if (!x || !y || val(x) == null || val(y) == null) return;
        const d = Math.abs(val(x) - val(y)); if (!best || d > best.d) best = { a, b, d }; });
      host.innerHTML =
        k(h != null ? 'Average price' : 'Average baseload', avgP == null ? '–' : avgP.toFixed(1) + '<small> €/MWh</small>', P.length + ' countries, simple mean') +
        k('Cheapest → most expensive', P.length ? val(P[0]).toFixed(0) + ' → ' + val(P[P.length - 1]).toFixed(0) + '<small> €/MWh</small>' : '–', P.length ? flag(P[0].c) + ' ' + NAMES[P[0].c] + ' · ' + flag(P[P.length - 1].c) + ' ' + NAMES[P[P.length - 1].c] : '') +
        k(h != null ? 'Negative prices now' : 'Countries with negative hours', negN + '<small> countries</small>', h != null ? 'at ' + String(h).padStart(2, '0') + ':00' : 'day-ahead, this day') +
        k('Widest border spread', best ? best.d.toFixed(1) + '<small> €/MWh</small>' : '–', best ? flag(best.a) + ' ' + best.a + ' ↔ ' + flag(best.b) + ' ' + best.b + ' · congestion' : '');
      return;
    }
    host.innerHTML =
      k('Europe average', eu == null ? '–' : Math.round(eu) + '<small> g/kWh</small>', withCo2.length + ' countries, weighted by generation') +
      k('Cleanest', best ? flag(best.c) + ' ' + Math.round(best.co2) + '<small> g/kWh</small>' : '–', best ? NAMES[best.c] : '') +
      k('Most carbon-intensive', worst ? flag(worst.c) + ' ' + Math.round(worst.co2) + '<small> g/kWh</small>' : '–', worst ? NAMES[worst.c] : '') +
      k('Price range', pr.length ? Math.round(pr[pr.length - 1].price) + ' → ' + Math.round(pr[0].price) + '<small> €/MWh</small>' : '–',
        pr.length ? flag(pr[pr.length - 1].c) + ' ' + pr[pr.length - 1].c + ' · ' + flag(pr[0].c) + ' ' + pr[0].c : '');
  }
  const LEG_NOTES = {
    co2: 'Consumption-based where all borders are known, production-based elsewhere · life-cycle factors (IPCC)',
    price: 'Hourly day-ahead, mean of the country\'s bidding zones',
    delta: 'Daily baseload minus the previous day\'s',
    tb2: 'Mean of the 2 highest hours minus mean of the 2 lowest: what a 2-hour battery could capture',
    neg: 'Hours with a negative day-ahead price (quarter-hours ÷ 4)',
    scap: 'Output-weighted price ÷ baseload over the hours with output data',
    wcap: 'Output-weighted price ÷ baseload over the hours with output data',
    css: 'Power − TTF ÷ 49.13% − EUA × 0.411 t/MWh (site convention)',
    cds: 'Power − API2 coal at 36% − EUA × 0.947 t/MWh (site convention)',
    fwd: 'Baseload calendar Y+1: France, Germany, Netherlands, Great Britain only',
  };
  function drawLegend() {
    const host = document.getElementById('pm-legend'); if (!host) return;
    const st = RAMPS[S.metric], m = METRICS[S.metric];
    const lo = st[0][0], hi = st[st.length - 1][0];
    const grad = st.map(([v, c]) => `rgb(${c}) ${((v - lo) / (hi - lo) * 100).toFixed(0)}%`).join(',');
    const f = v => S.metric === 'net' ? (v / 1000) + '' : v;
    host.innerHTML = `<div class="pm-leg-t">${m.label} (${m.unit})</div><div class="pm-leg-bar" style="background:linear-gradient(90deg,${grad})"></div>
      <div class="pm-leg-s"><span>${f(lo)}</span><span>${f(st[Math.floor(st.length / 2)][0])}</span><span>${f(hi)}+</span></div>` +
      (LEG_NOTES[S.metric] ? '<div class="pm-leg-n">' + LEG_NOTES[S.metric] + '</div>' : '') +
      (METRICS[S.metric].market ? '<div class="pm-leg-n"><span style="color:#FB923C">━</span> flow against the price signal (expensive → cheap)</div>' : '');
  }

  // ── detail panel ──
  function select(c) {
    S.sel = c;
    if (S.layer) S.layer.setStyle(f => styleFor(f, S.snaps));
    drawRanking();
    drawDetail();
  }
  function groupSums(gen) {
    return GROUPS.map(g => ({ g, v: g.codes.reduce((s, k) => s + (gen[k] || 0), 0) })).filter(x => x.v > 0);
  }
  function drawDetail() {
    const host = document.getElementById('pm-detail'); if (!host) return;
    const c = S.sel, s = S.snaps[c];
    const when = S.avg ? 'daily average' : String(S.hour).padStart(2, '0') + ':00–' + String(S.hour + 1).padStart(2, '0') + ':00';
    const dateLbl = new Date(S.data.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
    if (!s) { host.innerHTML = `<div class="pm-d-h"><span class="pm-d-flag">${flag(c)}</span><div><div class="pm-d-name">${NAMES[c] || c}</div><div class="pm-d-when">${dateLbl} · ${when}</div></div></div><div class="pm-empty">No data for ${NAMES[c] || c} on this day.</div>`; return; }
    const tile = (lbl, v, unit, col) => `<div class="pm-d-k"><div class="pm-d-kl">${lbl}</div><div class="pm-d-kv" ${col ? `style="color:${col}"` : ''}>${v}<small>${unit}</small></div></div>`;
    const gs = groupSums(s.gen), tot = gs.reduce((a, x) => a + x.v, 0) || 1;
    const fl = imports(c, S.avg ? null : S.hour);
    const mxBar = Math.max(1, ...gs.map(x => x.v), ...fl.map(f => Math.abs(f.mw)));
    const f1 = v => v == null || isNaN(v) ? '–' : v.toFixed(1), sg = v => v == null || isNaN(v) ? '–' : (v > 0 ? '+' : '') + v.toFixed(1);
    const R = S.data.refs || {};
    const cell = (lbl, v, sub, col) => `<div class="pm-m-c"><div class="pm-m-l">${lbl}</div><div class="pm-m-v"${col ? ` style="color:${col}"` : ''}>${v}</div>${sub ? `<div class="pm-m-s">${sub}</div>` : ''}</div>`;
    const tone = v => v == null ? null : v >= 0 ? 'var(--up,#14D3A9)' : 'var(--down,#ED6965)';
    const h = S.avg ? null : S.hour;
    const neigh = fl.map(f => { const o = S.snaps[f.n]; const pn = o ? (h != null ? o.price : o.base) : null, pc = h != null ? s.price : s.base; return { n: f.n, mw: f.mw, pn, sp: pn != null && pc != null ? pn - pc : null }; });
    const market = s.base == null && s.fwd == null ? '' : `
      <div class="pm-d-sec">Market <span>day-ahead ${S.data.date}${R.ttf != null ? ' · TTF ' + R.ttf.toFixed(1) + ' · EUA ' + (R.eua != null ? R.eua.toFixed(1) : '–') : ''}</span></div>
      <div class="pm-market">
        ${cell('Baseload', f1(s.base), s.delta != null ? sg(s.delta) + ' vs previous day' : '', null)}
        ${cell('Peak 08–20', f1(s.peak), s.base ? 'ratio ' + (s.peak / s.base).toFixed(2) : '')}
        ${cell('Min / max', s.min == null ? '–' : Math.round(s.min) + ' / ' + Math.round(s.max), 'hourly')}
        ${cell('Battery TB2', f1(s.tb2), 'top 2 h − bottom 2 h')}
        ${cell('Negative hours', s.negH == null ? '–' : s.negH, 'day-ahead', s.negH > 0 ? '#60A5FA' : null)}
        ${cell('Solar capture', s.solarCap ? f1(s.solarCap.price) : '–', s.scap != null ? Math.round(s.scap) + '% of base' : '', s.scap != null ? colorFor('scap', s.scap) : null)}
        ${cell('Wind capture', s.windCap ? f1(s.windCap.price) : '–', s.wcap != null ? Math.round(s.wcap) + '% of base' : '', s.wcap != null ? colorFor('wcap', s.wcap) : null)}
        ${cell('Clean spark', sg(s.css), h != null ? 'at ' + String(h).padStart(2, '0') + ':00' : 'on baseload', tone(s.css))}
        ${cell('Clean dark', sg(s.cds), h != null ? 'at ' + String(h).padStart(2, '0') + ':00' : 'on baseload', tone(s.cds))}
        ${s.fwd != null ? cell('Forward Y+1', f1(s.fwd), s.fwdContract || 'baseload') : ''}
      </div>
      ${neigh.length ? `<div class="pm-o-sep">Neighbours ${h != null ? 'at ' + String(h).padStart(2, '0') + ':00' : '(daily base)'} · price, spread, physical flow</div>
        <div class="pm-nb">${neigh.map(x => `<div class="pm-nb-r"><span>${flag(x.n)} ${NAMES[x.n] || x.n}</span><span>${f1(x.pn)}</span><span style="color:${x.sp == null ? 'var(--tx3)' : Math.abs(x.sp) < 1 ? 'var(--tx3)' : x.sp > 0 ? '#F97316' : '#60A5FA'}">${x.sp == null ? '–' : Math.abs(x.sp) < 1 ? 'coupled' : sg(x.sp)}</span><span>${x.mw >= 0 ? '← ' : '→ '}${fmtMW(Math.abs(x.mw))}</span></div>`).join('')}</div>` : ''}
      <div class="pm-d-sec">24 h day-ahead price <span>this day vs previous day</span></div>
      <div class="pm-d-chart small"><canvas id="pm-chart-price"></canvas></div>`;
    const bar = (lbl, v, col, extra) => `<div class="pm-o-row"><span class="pm-o-l">${lbl}</span><span class="pm-o-b">${v < 0 ? `<i class="neg" style="width:${Math.abs(v) / mxBar * 50}%;background:${col}"></i>` : `<i style="width:${v / mxBar * 100}%;background:${col}"></i>`}</span><span class="pm-o-v">${fmtMW(v)}${extra || ''}</span></div>`;
    host.innerHTML = `
      <div class="pm-d-h"><span class="pm-d-flag">${flag(c)}</span><div><div class="pm-d-name">${NAMES[c] || c}</div><div class="pm-d-when">${dateLbl} · ${when} · ${s.src || 'Energy-Charts'}</div></div>
        ${c === 'FR' ? '<button class="pk-btn-ghost pm-d-link" onclick="switchDashboard && switchDashboard(\'france\')">France page →</button>' : ''}</div>
      <div class="pm-d-kpis">
        ${tile('Carbon intensity', s.co2 == null ? '–' : Math.round(s.co2), ' g/kWh', colorFor('co2', s.co2))}
        ${tile('Low-carbon', s.lowc == null ? '–' : Math.round(s.lowc), ' %')}
        ${tile('Renewable', s.ren == null ? '–' : Math.round(s.ren), ' %')}
        ${tile('Day-ahead', s.price == null ? '–' : s.price.toFixed(1), ' €/MWh')}
      </div>
      ${METRICS[S.metric].market ? market : ''}
      <div class="pm-d-sec">Electricity origin <span>${s.co2Basis === 'consumption' ? 'consumption-based intensity' : 'production-based intensity'}</span></div>
      <div class="pm-origin">
        ${gs.sort((a, b) => b.v - a.v).map(x => bar(x.g.label, x.v, x.g.color, ` <em>${Math.round(x.v / tot * 100)}%</em>`)).join('')}
        ${fl.length ? '<div class="pm-o-sep">Cross-border (physical, + import)</div>' + fl.map(f => bar(flag(f.n) + ' ' + (NAMES[f.n] || f.n), f.mw, f.mw >= 0 ? '#94A3B8' : '#475569')).join('') : ''}
        ${s.load != null ? `<div class="pm-o-foot">Load ${fmtMW(s.load)} · generation ${fmtMW(s.total)}${s.net != null ? ' · net ' + (s.net >= 0 ? 'import ' : 'export ') + fmtMW(Math.abs(s.net)) : ''}</div>` : ''}
      </div>
      ${METRICS[S.metric].market ? '' : market}
      <div class="pm-d-sec">24 h generation mix and price</div>
      <div class="pm-d-chart"><canvas id="pm-chart-mix"></canvas></div>
      <div class="pm-d-sec">24 h carbon intensity</div>
      <div class="pm-d-chart small"><canvas id="pm-chart-co2"></canvas></div>
      <div class="pm-d-src">Generation: ${s.src === 'RTE éCO2mix' ? 'RTE éCO2mix (ODRÉ)' : 'Energy-Charts.info (Fraunhofer ISE, CC BY 4.0) from ENTSO-E and national sources'} · flows: Energy-Charts physical flows · prices: ENTSO-E day-ahead · emission factors: IPCC life-cycle medians.</div>`;
    drawDetailCharts(c);
  }
  function drawDetailCharts(c) {
    Object.values(S.charts).forEach(ch => { try { ch.destroy(); } catch (_) {} });
    S.charts = {};
    const d = S.data.C[c]; if (!d || typeof Chart === 'undefined') return;
    const labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + 'h');
    const sets = GROUPS.map(g => {
      const data = labels.map((_, i) => { let v = 0, any = false; g.codes.forEach(k => { const a = d.gen && d.gen[k]; if (a && a[i] != null) { v += a[i]; any = true; } }); return any ? Math.round(v) / 1000 : null; });
      return data.some(v => v) ? { type: 'line', label: g.label, data, backgroundColor: g.color + 'CC', borderColor: g.color, borderWidth: 0.5, fill: true, stack: 'g', pointRadius: 0, tension: 0.25, yAxisID: 'y' } : null;
    }).filter(Boolean);
    if (Array.isArray(d.price)) sets.push({ type: 'line', label: 'Day-ahead', data: d.price.map(v => v == null ? null : Math.round(v * 10) / 10), borderColor: '#F8FAFC', borderWidth: 1.6, pointRadius: 0, fill: false, yAxisID: 'y2', tension: 0.2 });
    const sel = S.avg ? null : S.hour;
    const marker = { id: 'pmHour', afterDatasetsDraw(ch) { if (sel == null) return; const x = ch.scales.x.getPixelForValue(sel), a = ch.chartArea, g = ch.ctx; g.save(); g.strokeStyle = 'rgba(255,255,255,.5)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, a.top); g.lineTo(x, a.bottom); g.stroke(); g.restore(); } };
    const tx = { color: '#7A93AB', font: { size: 9 } }, grid = { color: 'rgba(255,255,255,.04)' };
    const mix = document.getElementById('pm-chart-mix');
    if (mix) S.charts.mix = new Chart(mix, { data: { labels, datasets: sets }, plugins: [marker],
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: { x: { ticks: Object.assign({ maxTicksLimit: 8 }, tx), grid }, y: { stacked: true, beginAtZero: true, ticks: tx, grid, title: { display: true, text: 'GW', color: '#7A93AB', font: { size: 9 } } },
          y2: { position: 'right', ticks: tx, grid: { display: false }, title: { display: true, text: '€/MWh', color: '#7A93AB', font: { size: 9 } } } } } });
    const pc = document.getElementById('pm-chart-price');
    if (pc && Array.isArray(d.price)) S.charts.price = new Chart(pc, { type: 'line', data: { labels, datasets: [
        { label: 'Day-ahead', data: d.price.map(v => v == null ? null : Math.round(v * 10) / 10), borderColor: '#14D3A9', backgroundColor: 'rgba(20,211,169,.12)', fill: true, borderWidth: 1.8, pointRadius: 0, tension: 0.2 },
        Array.isArray(d.pricePrev) ? { label: 'Previous day', data: d.pricePrev.map(v => v == null ? null : Math.round(v * 10) / 10), borderColor: 'rgba(148,163,184,.8)', borderDash: [4, 3], borderWidth: 1.2, pointRadius: 0, fill: false, tension: 0.2 } : null,
      ].filter(Boolean) }, plugins: [marker],
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } },
        scales: { x: { ticks: Object.assign({ maxTicksLimit: 8 }, tx), grid }, y: { ticks: tx, grid, title: { display: true, text: '€/MWh', color: '#7A93AB', font: { size: 9 } } } } } });
    const co2 = labels.map((_, i) => { const s = snapshot(c, i); return s && s.co2Prod != null ? Math.round(s.co2Prod) : null; });
    const cc = document.getElementById('pm-chart-co2');
    if (cc) S.charts.co2 = new Chart(cc, { type: 'bar', data: { labels, datasets: [{ label: 'Production intensity', data: co2, backgroundColor: co2.map(v => colorFor('co2', v) || '#334155'), borderWidth: 0 }] }, plugins: [marker],
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: Object.assign({ maxTicksLimit: 8 }, tx), grid }, y: { ticks: tx, grid, beginAtZero: true, title: { display: true, text: 'g/kWh', color: '#7A93AB', font: { size: 9 } } } } } });
  }

  // ── controls ──
  function latestHour() {
    // latest hour with generation for at least half of the countries
    const cs = Object.values(S.data.C).filter(d => d.gen && Object.keys(d.gen).length);
    for (let h = 23; h >= 0; h--) {
      const n = cs.filter(d => Object.values(d.gen).some(a => a && a[h] != null)).length;
      if (n && n >= cs.length / 2) return h;
    }
    return S.day === 1 ? 12 : 0;
  }
  function syncControls() {
    const sl = document.getElementById('pm-hour'); if (sl) { sl.value = S.hour; sl.disabled = S.avg; }
    const lbl = document.getElementById('pm-hour-lbl'); if (lbl) lbl.textContent = METRICS[S.metric].daily ? 'Daily figure' : S.avg ? 'Daily average' : String(S.hour).padStart(2, '0') + ':00';
    document.querySelectorAll('.pm-metric .pk-gf-btn').forEach(b => b.classList.toggle('active', b.dataset.m === S.metric));
    document.querySelectorAll('#pm-day .pk-gf-btn').forEach(b => b.classList.toggle('active', +b.dataset.d === S.day));
    const av = document.getElementById('pm-avg'); if (av) av.classList.toggle('active', S.avg);
    const play = document.getElementById('pm-play'); if (play) play.textContent = S.playing ? '❚❚' : '▶';
    const upd = document.getElementById('pm-upd');
    if (upd) upd.textContent = S.data.hasGen ? 'Energy-Charts · RTE · ENTSO-E' : 'Prices only for this day';
  }
  function redraw() { drawMap(); drawRanking(); drawKpis(); drawLegend(); drawDetail(); syncControls(); }

  async function setDay(n) {
    // n: -1 yesterday, 0 today, 1 tomorrow, or a date 'YYYY-MM-DD' (the date picker: any kept day)
    const today = parisToday();
    if (typeof n === 'string') { const k = Math.round((Date.parse(n) - Date.parse(today)) / 864e5); n = k === 0 || k === 1 || k === -1 ? k : n; }
    S.day = n;
    const date = typeof n === 'string' ? n : addDays(today, n === 1 ? 1 : n === -1 ? -1 : 0);
    const dp = document.getElementById('pm-date'); if (dp) { dp.value = date; dp.max = addDays(today, 1); dp.min = addDays(today, -30); }
    const upd = document.getElementById('pm-upd'); if (upd) upd.textContent = 'Loading…';
    S.data = await loadDay(date);
    if (n === 1 && !METRICS[S.metric].market) S.metric = 'price';   // tomorrow: prices only
    S.hour = n === 0 ? Math.min(latestHour(), parisHour()) : n === 1 ? 12 : typeof n === 'string' ? 12 : latestHour();
    redraw();
  }

  async function open() {
    if (!S.init) {
      S.init = true;
      S.map = L.map('pm-map', { center: [52, 12], zoom: 4, minZoom: 3, maxZoom: 7, zoomControl: true, attributionControl: true, zoomSnap: 0.25,
        maxBounds: [[25, -35], [75, 50]] });
      S.map.attributionControl.setPrefix('').addAttribution('Natural Earth · Energy-Charts (CC BY 4.0) · RTE · ENTSO-E');
      S.geo = await getJSON(base() + 'geo/europe.json');
      if (window.innerWidth < 760) S.map.setView([50, 10], 3.25);
    }
    await setDay(S.day);
    setTimeout(() => S.map.invalidateSize(), 50);
  }

  window.PKMap = {
    open, select, setDay,
    setMetric(m) { if (S.day === 1 && !(METRICS[m] && METRICS[m].market)) return; S.metric = m; redraw(); },
    setHour(h) { S.hour = +h; S.avg = false; redraw(); },
    toggleAvg() { S.avg = !S.avg; redraw(); },
    play() {
      if (S.playing) { clearInterval(S.playing); S.playing = null; syncControls(); return; }
      S.avg = false;
      const last = S.day === 0 ? latestHour() : 23;   // a past day plays in full
      if (S.hour >= last) S.hour = 0;
      S.playing = setInterval(() => {
        if (S.hour >= last) { clearInterval(S.playing); S.playing = null; syncControls(); return; }
        S.hour++; redraw();
      }, 900);
      syncControls();
    },
    search() { drawRanking(); },
    _state: () => S,
  };

  // styles
  const css = document.createElement('style');
  css.textContent = `
  .pm-date{height:26px;padding:0 6px;border:1px solid var(--border);border-radius:5px;background:var(--bg3);color:var(--text);font-size:11px;color-scheme:dark}
  .pm-wrap{display:grid;grid-template-columns:250px minmax(0,1fr) 380px;gap:12px;align-items:stretch}
  .pm-card{background:var(--bg2);border:1px solid var(--bd);border-radius:10px}
  .pm-mapbox{position:relative;overflow:hidden;min-height:640px}
  #pm-map{position:absolute;inset:0;background:#0b1118}
  #pm-map .leaflet-container,#pm-map{font-family:inherit}
  .pm-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
  .pm-time{display:flex;align-items:center;gap:8px;flex:1;min-width:260px}
  .pm-time input[type=range]{flex:1;accent-color:#14D3A9}
  .pm-time .pm-hl{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--tx);min-width:96px;text-align:right}
  .pm-play{width:30px;height:28px;border-radius:6px;border:1px solid var(--bd);background:var(--bg3,#121a24);color:var(--tx);cursor:pointer;font-size:11px}
  .pm-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
  .pm-kpi{min-width:0}.pm-kpi .kpi-value,.pm-kpi .kpi-meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pm-kpi-l{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--tx3);font-weight:600}
  .pm-kpi-v{font-family:'IBM Plex Mono',monospace;font-size:18px;color:var(--tx);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pm-kpi-v small,.pm-kpi .kpi-value small{font-size:10px;color:var(--tx3)} .pm-kpi-s{font-size:10px;color:var(--tx3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pm-side{display:flex;flex-direction:column;max-height:640px}
  .pm-side input{margin:10px;padding:7px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--tx);font-size:12px}
  #pm-rank{overflow-y:auto;padding:0 6px 8px}
  .pm-rank-row{display:grid;grid-template-columns:18px 20px minmax(0,1fr) 54px 44px;gap:6px;align-items:center;width:100%;padding:5px 6px;border:0;background:transparent;color:var(--tx2);font-size:11.5px;text-align:left;cursor:pointer;border-radius:5px}
  .pm-rank-row:hover{background:rgba(255,255,255,.04)} .pm-rank-row.sel{background:rgba(20,211,169,.10);color:var(--tx)}
  .pm-rank-i{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--tx4,#4b5d70)} .pm-rank-n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pm-rank-bar{height:6px;background:rgba(255,255,255,.05);border-radius:3px;overflow:hidden} .pm-rank-bar i{display:block;height:100%}
  .pm-rank-v{font-family:'IBM Plex Mono',monospace;font-size:11px;text-align:right;color:var(--tx)}
  .pm-legend{position:absolute;right:12px;top:12px;z-index:500;background:rgba(11,17,24,.92);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;width:220px}
  .pm-leg-t{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3);margin-bottom:6px}
  .pm-leg-bar{height:8px;border-radius:4px} .pm-leg-s{display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:var(--tx3);margin-top:3px}
  .pm-leg-n{font-size:9.5px;color:var(--tx3);margin-top:6px;line-height:1.35}
  .pm-label span{display:inline-block;transform:translate(0,0);font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.9),0 0 6px rgba(0,0,0,.6);white-space:nowrap}
  .pm-label{text-align:center;pointer-events:none}
  .pm-flow{stroke-dasharray:6 7;animation:pmflow 1.1s linear infinite;stroke-linecap:round}
  @keyframes pmflow{to{stroke-dashoffset:-13}}
  .pm-arrow div{width:0;height:0;border-top:calc(var(--w)/1.4) solid transparent;border-bottom:calc(var(--w)/1.4) solid transparent;border-left:var(--w) solid var(--c,#E2E8F0);margin:auto;position:relative;top:2px;transform-origin:center}
  .pm-leaflet-tip{background:rgba(11,17,24,.95);border:1px solid var(--bd);color:var(--tx);border-radius:7px;box-shadow:0 6px 20px rgba(0,0,0,.4);font-size:11px}
  .pm-leaflet-tip:before{display:none}
  .pm-tip{display:flex;flex-direction:column;gap:2px} .pm-tip span{color:var(--tx2)}
  .pm-detail{padding:14px;max-height:640px;overflow-y:auto}
  .pm-d-h{display:flex;align-items:center;gap:10px;margin-bottom:12px} .pm-d-flag{font-size:26px;line-height:1}
  .pm-d-name{font-size:16px;font-weight:700;color:var(--tx)} .pm-d-when{font-size:10.5px;color:var(--tx3);font-family:'IBM Plex Mono',monospace}
  .pm-d-link{margin-left:auto;font-size:10px}
  .pm-d-kpis{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
  .pm-d-k{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px 10px}
  .pm-d-kl{font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--tx3);font-weight:600}
  .pm-d-kv{font-family:'IBM Plex Mono',monospace;font-size:19px;color:var(--tx);margin-top:2px} .pm-d-kv small{font-size:10px;color:var(--tx3)}
  .pm-d-sec{display:flex;justify-content:space-between;align-items:baseline;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--tx2);font-weight:600;margin:14px 0 6px}
  .pm-d-sec span{font-size:9.5px;letter-spacing:0;text-transform:none;color:var(--tx3);font-weight:400}
  .pm-o-row{display:grid;grid-template-columns:118px minmax(0,1fr) 92px;gap:8px;align-items:center;font-size:11px;color:var(--tx2);padding:2px 0}
  .pm-o-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pm-o-b{height:9px;background:rgba(255,255,255,.04);border-radius:3px;position:relative;overflow:hidden}
  .pm-o-b i{position:absolute;left:0;top:0;bottom:0;border-radius:3px} .pm-o-b i.neg{left:auto;right:50%}
  .pm-o-v{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--tx);text-align:right;white-space:nowrap} .pm-o-v em{color:var(--tx3);font-style:normal}
  .pm-o-sep{font-size:9.5px;color:var(--tx3);margin:8px 0 3px;text-transform:uppercase;letter-spacing:.06em}
  .pm-o-foot{font-size:10.5px;color:var(--tx3);margin-top:8px;font-family:'IBM Plex Mono',monospace}
  .pm-market{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  .pm-m-c{background:var(--bg);border:1px solid var(--bd);border-radius:7px;padding:6px 8px;min-width:0}
  .pm-m-l{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pm-m-v{font-family:'IBM Plex Mono',monospace;font-size:14px;color:var(--tx);margin-top:2px;white-space:nowrap}
  .pm-m-s{font-size:9px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pm-nb-r{display:grid;grid-template-columns:minmax(0,1fr) 56px 64px 76px;gap:6px;font-size:11px;color:var(--tx2);padding:3px 0;border-bottom:1px solid rgba(255,255,255,.03)}
  .pm-nb-r span:not(:first-child){font-family:'IBM Plex Mono',monospace;text-align:right}
  .pm-nb-r span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pm-mgroup{display:flex;align-items:center;gap:6px}.pm-mgroup-l{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3);font-weight:600}
  .pm-d-chart{position:relative;height:260px} .pm-d-chart.small{height:200px}
  .pm-d-src{font-size:9.5px;color:var(--tx3);line-height:1.45;margin-top:12px}
  .pm-empty{padding:18px;color:var(--tx3);font-size:12px;text-align:center}
  @media (max-width:1250px){.pm-wrap{grid-template-columns:220px minmax(0,1fr)}.pm-detail-card{grid-column:1/-1}.pm-detail{max-height:none}}
  @media (max-width:760px){.pm-leg-n{display:none}.pm-wrap{grid-template-columns:minmax(0,1fr)}.pm-mapbox{min-height:420px;order:1}.pm-detail-card{order:2}.pm-side{order:3;max-height:420px}
    .pm-kpis{grid-template-columns:1fr 1fr}.pm-legend{width:170px}.pm-o-row{grid-template-columns:96px minmax(0,1fr) 84px}}
  `;
  document.head.appendChild(css);
})();
