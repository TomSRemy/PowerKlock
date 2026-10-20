// ════════════════════════════════════════════════════════════════════
// TOOLS › CARBON FOOTPRINT OF A LOAD CURVE (France)
// A consumer loads its consumption curve (CSV / Excel / Enedis export) and
// gets, quarter-hour by quarter-hour against RTE éCO2mix:
//   · the carbon intensity of what it actually consumed (location-based,
//     hourly-weighted) and the gap with the annual-average factor,
//   · the physical mix behind its consumption,
//   · GHG Protocol Scope 2: location-based and market-based (guarantees of
//     origin, PPA, supplier factor, AIB residual mix for the rest),
//   · its renewable coverage, annual and hour by hour when a PPA or
//     on-site production is entered,
//   · the cost of its profile on the day-ahead market vs baseload.
// Everything runs in the browser: the file never leaves the computer.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const getJSON = path => fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => null);
  const XLSX_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const MIX = [['nuclear', 'Nuclear', '#7B4B9C'], ['hydro', 'Hydro', '#3FA6B4'], ['wind', 'Wind', '#14D3A9'], ['solar', 'Solar', '#FBBF24'],
    ['bio', 'Bioenergy', '#8BC34A'], ['gas', 'Gas', '#C4A57B'], ['coal', 'Coal', '#6B6B6B'], ['oil', 'Oil', '#A0522D']];
  const S = { cons: null, meta: null, res: null, settings: { unit: 'auto', stamp: 'auto', go: 0, ppaTech: 'solar', ppa: 0, supplier: '', residual: '' } };

  // ── Parsing ───────────────────────────────────────────────────────
  // A row → { y, m, d, hh, mi } in Paris local time (naive), or null.
  const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function parisParts(dt) {
    const p = {}; PARIS.formatToParts(dt).forEach(x => { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mi: +p.minute };
  }
  function parseStamp(v, timeCol) {
    if (v instanceof Date && !isNaN(v)) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate(), hh: v.getHours(), mi: v.getMinutes() };
    if (typeof v === 'number' && v > 20000 && v < 80000) {   // Excel serial date
      const ms = Math.round((v - 25569) * 86400000), dt = new Date(ms);
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), hh: dt.getUTCHours(), mi: dt.getUTCMinutes() };
    }
    let s = String(v == null ? '' : v).trim().replace(/^"|"$/g, '');
    if (timeCol != null) s += ' ' + String(timeCol).trim();
    let m;
    // ISO with an offset or Z → convert to Paris time
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/))) {
      const dt = new Date(s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      return isNaN(dt) ? null : parisParts(dt);
    }
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/))) return { y: +m[1], m: +m[2], d: +m[3], hh: +(m[4] || 0), mi: +(m[5] || 0) };
    if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\s+(\d{1,2})[:h](\d{2}))?/))) return { y: +m[3], m: +m[2], d: +m[1], hh: +(m[4] || 0), mi: +(m[5] || 0) };
    return null;
  }
  const toNum = v => {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).trim().replace(/\s/g, '').replace(/^"|"$/g, '');
    if (!s) return null;
    const n = parseFloat(/,\d+$/.test(s) && !/\.\d+,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
    return isFinite(n) ? n : null;
  };

  function rowsFromCSV(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const sample = lines.slice(0, 30).join('\n');
    const delim = [';', '\t', ','].map(d => [d, (sample.match(new RegExp(d === '\t' ? '\t' : '\\' + d, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
    return lines.map(l => l.split(delim).map(c => c.trim()));
  }

  // rows (arrays) → { slots: Map(date → Float64Array(96) kWh), info }
  function buildCurve(rows) {
    // header row and columns
    let start = 0, header = null;
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const r = rows[i];
      if (r.length >= 2 && parseStamp(r[0], /^\d{1,2}:\d{2}/.test(String(r[1])) ? r[1] : null) && r.slice(1).some(c => toNum(c) != null)) { start = i; header = i > 0 ? rows[i - 1] : null; break; }
    }
    const sepTime = rows[start] && /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(rows[start][1]).trim());
    const valCol = (() => { for (let c = sepTime ? 2 : 1; c < (rows[start] || []).length; c++) if (toNum(rows[start][c]) != null) return c; return 1; })();
    const htxt = (header || []).join(' ').toLowerCase();
    const enedis = /horodate|valeur/.test(htxt);
    let unit = S.settings.unit;
    if (unit === 'auto') unit = /\(w\)|\bw\b|valeur/.test(htxt) && !/kw/.test(htxt) ? 'w' : /kwh/.test(htxt) ? 'kwh' : /\bkw\b|\(kw\)/.test(htxt) ? 'kw' : /mwh/.test(htxt) ? 'mwh' : 'kwh';
    let stamp = S.settings.stamp;
    if (stamp === 'auto') stamp = enedis ? 'end' : 'start';
    const pts = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i]; if (!r || r.length < 2) continue;
      const t = parseStamp(r[0], sepTime ? r[1] : null), v = toNum(r[valCol]);
      if (!t || v == null) continue;
      pts.push({ t, k: Date.UTC(t.y, t.m - 1, t.d, t.hh, t.mi) / 60000, v });
    }
    if (pts.length < 4) throw new Error('No timestamp + value rows found. Expected two columns: date-time and consumption.');
    pts.sort((a, b) => a.k - b.k);
    const diffs = []; for (let i = 1; i < pts.length; i++) { const d = pts[i].k - pts[i - 1].k; if (d > 0) diffs.push(d); }
    diffs.sort((a, b) => a - b);
    const step = diffs[Math.floor(diffs.length / 2)] || 60;
    const toKWh = v => unit === 'kwh' ? v : unit === 'mwh' ? v * 1000 : unit === 'kw' ? v * step / 60 : v / 1000 * step / 60;
    const slots = new Map();
    const add = (k, e) => {
      const dt = new Date(k * 60000), key = dt.toISOString().slice(0, 10), q = Math.floor((dt.getUTCHours() * 60 + dt.getUTCMinutes()) / 15);
      let a = slots.get(key); if (!a) { a = new Float64Array(96); slots.set(key, a); }
      a[q] += e;
    };
    pts.forEach(p => {
      const e = toKWh(p.v), k0 = stamp === 'end' ? p.k - step : p.k;
      if (step >= 15) { const n = Math.max(1, Math.round(step / 15)); for (let j = 0; j < n; j++) add(k0 + j * 15, e / n); }
      else add(k0, e);
    });
    const days = [...slots.keys()].sort();
    return { slots, info: { rows: pts.length, step, unit, stamp, enedis, from: days[0], to: days[days.length - 1], days: days.length } };
  }

  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = XLSX_LIB; s.onload = res; s.onerror = () => rej(new Error('Excel reader failed to load')); document.head.appendChild(s); });
  }
  async function readFile(file) {
    if (/\.xlsx?$/i.test(file.name)) {
      await loadXLSX();
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    }
    return rowsFromCSV(await file.text());
  }

  // Example: an office building, ~1.1 GWh a year, 2025, quarter-hours
  function example() {
    const rows = [['timestamp', 'kWh']];
    const t0 = Date.UTC(2025, 0, 1);
    for (let i = 0; i < 365 * 96; i++) {
      const dt = new Date(t0 + i * 900000), dow = dt.getUTCDay(), h = dt.getUTCHours() + dt.getUTCMinutes() / 60, doy = Math.floor(i / 96);
      const heat = 1 + 0.45 * Math.max(0, Math.cos((doy - 15) / 365 * 2 * Math.PI)), cool = 1 + 0.25 * Math.max(0, Math.cos((doy - 200) / 365 * 2 * Math.PI) - 0.4);
      const open = dow > 0 && dow < 6 && h >= 7 && h < 19.5;
      let kw = 55 + (open ? 150 * (h < 8 || h > 18.5 ? 0.55 : 1) * heat * cool : 0) + (h >= 5 && h < 7 && dow > 0 && dow < 6 ? 60 * heat : 0);
      kw *= 0.95 + 0.1 * Math.sin(i * 1.7);
      rows.push([dt.toISOString().slice(0, 16).replace('T', ' '), (kw / 4).toFixed(2)]);
    }
    return rows;
  }

  // ── Reference data ────────────────────────────────────────────────
  const monthCache = {}, priceCache = {};
  const rteMonth = ym => monthCache[ym] || (monthCache[ym] = getJSON('history/rte/' + ym + '.json'));
  const priceYear = y => priceCache[y] || (priceCache[y] = getJSON('history/fr_prices/' + y + '.json'));

  // ── Computation ───────────────────────────────────────────────────
  async function compute() {
    const days = [...S.cons.slots.keys()].sort();
    const months = [...new Set(days.map(d => d.slice(0, 7)))];
    const years = [...new Set(days.map(d => d.slice(0, 4)))];
    const [rte, prices] = await Promise.all([Promise.all(months.map(rteMonth)), Promise.all(years.map(priceYear))]);
    const R = {}; months.forEach((m, i) => { if (rte[i] && rte[i].days) Object.assign(R, rte[i].days); });
    const P = {}; years.forEach((y, i) => { if (prices[i] && prices[i].days) Object.assign(P, prices[i].days); });
    const o = { E: 0, Ecov: 0, em: 0, nat: { em: 0, load: 0 }, mix: {}, cost: 0, Ep: 0, base: { s: 0, n: 0 },
      daily: [], hourC: new Float64Array(24), hourI: new Float64Array(24), hourN: new Float64Array(24), hourW: new Float64Array(24),
      monthly: {}, missing: 0, ppa: { prof: new Float64Array(24), match: 0, surplus: 0 } };
    MIX.forEach(([k]) => { o.mix[k] = 0; });
    const ppaKey = S.settings.ppaTech;
    let ppaShape = 0;  // sum of the national profile over the period (to scale the PPA volume)
    days.forEach(d => { const r = R[d]; if (r && r[ppaKey]) r[ppaKey].forEach(v => { ppaShape += Math.max(0, v || 0); }); });
    const ppaMWh = +S.settings.ppa || 0;
    const nWeekdays = new Float64Array(24);
    days.forEach(d => {
      const c = S.cons.slots.get(d), r = R[d], p = P[d];
      let dE = 0, dEm = 0;
      const mk = d.slice(0, 7), M = o.monthly[mk] || (o.monthly[mk] = { E: 0, em: 0 });
      const wd = new Date(d + 'T12:00:00Z').getUTCDay(), isWd = wd > 0 && wd < 6;
      for (let q = 0; q < 96; q++) {
        const e = c[q] || 0;            // kWh
        const ci = r && r.co2 ? r.co2[q] : null;
        if (r && r.co2 && r.load && r.load[q] != null && ci != null) { o.nat.em += ci * r.load[q]; o.nat.load += r.load[q]; }
        if (!e) continue;
        dE += e;
        if (ci == null) { o.missing += e; continue; }
        dEm += e * ci;                   // g
        const h = Math.floor(q / 4);
        o.hourC[h] += e; o.hourI[h] += e * ci; o.hourN[h] += e;
        if (isWd) { o.hourW[h] += e; }
        // physical mix (French production at the time of consumption)
        let tot = 0; const sh = {};
        MIX.forEach(([k]) => { const v = r[k] ? Math.max(0, r[k][q] || 0) : 0; sh[k] = v; tot += v; });
        if (tot > 0) MIX.forEach(([k]) => { o.mix[k] += e * sh[k] / tot; });
        // spot cost
        if (p && p[q] != null) { o.cost += e / 1000 * p[q]; o.Ep += e; }
        // PPA / on-site profile, hourly matching
        if (ppaMWh && ppaShape && r[ppaKey]) {
          const g = Math.max(0, r[ppaKey][q] || 0) / ppaShape * ppaMWh * 1000;   // kWh
          o.ppa.match += Math.min(e, g); o.ppa.surplus += Math.max(0, g - e); o.ppa.prof[h] += g;
        }
      }
      if (p) for (let q = 0; q < 96; q++) if (p[q] != null) { o.base.s += p[q]; o.base.n++; }
      o.E += dE; o.em += dEm; M.E += dE; M.em += dEm;
      o.daily.push({ d, E: dE, ci: dE ? dEm / dE : null });
    });
    o.ciHourly = o.E - o.missing > 0 ? o.em / (o.E - o.missing) : null;   // g/kWh
    o.ciAnnual = o.nat.load ? o.nat.em / o.nat.load : null;              // national consumption-weighted average, same period
    o.emAnnualMethod = o.ciAnnual != null ? o.E * o.ciAnnual : null;      // g
    o.emLocation = o.ciHourly != null ? o.ciHourly * o.E : null;          // g, missing slots at the period average
    // Market-based
    const year = days[days.length - 1].slice(0, 4);
    // Residual mix: entered by the user from the AIB publication (AIB data
    // are copyrighted, all rights reserved: PowerKlock does not redistribute them)
    o.rmCI = S.settings.residual === '' || S.settings.residual == null ? null : +S.settings.residual;
    const goMWh = +S.settings.go || 0;
    const coveredMWh = Math.min(o.E / 1000, goMWh + ppaMWh);
    const supplier = S.settings.supplier === '' ? null : +S.settings.supplier;
    o.covered = coveredMWh; o.coverage = o.E ? coveredMWh / (o.E / 1000) : 0;
    o.factorRest = supplier != null && isFinite(supplier) ? supplier : o.rmCI;
    o.factorRestSrc = supplier != null && isFinite(supplier) ? 'supplier-specific factor' : 'residual mix factor entered';
    o.emMarket = o.factorRest != null ? (o.E / 1000 - coveredMWh) * 1000 * o.factorRest : null;   // g
    o.hourly = ppaMWh ? o.ppa.match / o.E : null;
    o.costAvg = o.Ep ? o.cost / (o.Ep / 1000) : null;
    o.baseAvg = o.base.n ? o.base.s / o.base.n : null;
    o.year = year; o.days = days;
    return o;
  }

  // ── Rendering ─────────────────────────────────────────────────────
  const f0 = v => v == null ? '–' : Math.round(v).toLocaleString('en-GB');
  const f1 = v => v == null ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const f2 = v => v == null ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const t = g => g == null ? null : g / 1e6;   // g → t
  // emissions with a unit that suits the size: kg below one tonne
  const em = (g, small) => g == null ? ['–', 't CO₂'] : (small ? [f0(g / 1000), 'kg CO₂'] : [f2(g / 1e6), 't CO₂']);

  function renderKpis(o) {
    const timing = o.ciAnnual && o.ciHourly ? (o.ciHourly / o.ciAnnual - 1) * 100 : null;
    const shape = o.costAvg != null && o.baseAvg ? (o.costAvg / o.baseAvg - 1) * 100 : null;
    const small = (o.emLocation || 0) < 1e6, eL = em(o.emLocation, small), eM = em(o.emMarket, small);
    $('cf-kpis').innerHTML = [
      _fuelKpi('Consumption', o.E < 100000 ? f2(o.E / 1000) : f1(o.E / 1000), 'MWh', `${o.days.length} days · ${o.days[0]} → ${o.days[o.days.length - 1]}`),
      _fuelKpi('Location-based', eL[0], eL[1], `${f1(o.ciHourly)} g/kWh · quarter-hour by quarter-hour`),
      _fuelKpi('Timing effect', timing == null ? '–' : (timing > 0 ? '+' : '') + timing.toFixed(1), '%', `vs national average ${f1(o.ciAnnual)} g/kWh over the period`, timing == null ? '' : timing <= 0 ? 'up' : 'down'),
      _fuelKpi('Market-based', eM[0], eM[1], o.factorRest == null ? 'enter the residual mix factor above' : `${f1(o.emMarket / o.E)} g/kWh · rest at ${o.factorRestSrc}`),
      _fuelKpi('Renewable coverage', o.coverage ? (o.coverage * 100).toFixed(0) : '0', '%', o.hourly != null ? `hour by hour ${(o.hourly * 100).toFixed(0)} % (${o.settingsPpaTech} profile)` : 'annual volume (GOs + PPA)', o.coverage >= 0.999 ? 'up' : ''),
      _fuelKpi('Cost on the spot', f2(o.costAvg), '€/MWh', shape == null ? 'prices not available' : `${shape > 0 ? '+' : ''}${shape.toFixed(1)} % vs baseload ${f2(o.baseAvg)}`, shape == null ? '' : shape > 0 ? 'down' : 'up'),
    ].join('');
  }

  function charts(o) {
    // daily consumption + carbon intensity of what was consumed
    const L = o.daily.map(x => x.d);
    _fuelChart('cf-daily', { type: 'bar', data: { labels: L, datasets: [
      { label: 'Consumption (MWh)', data: o.daily.map(x => x.E / 1000), backgroundColor: 'rgba(127,200,248,.45)', borderWidth: 0, yAxisID: 'y' },
      { type: 'line', label: 'Carbon intensity of your consumption (g/kWh)', data: o.daily.map(x => x.ci == null ? null : Math.round(x.ci * 10) / 10), borderColor: '#A87DC4', borderWidth: 1.6, pointRadius: 0, tension: 0.2, yAxisID: 'y1' },
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('MWh', { beginAtZero: true }), y1: _fuelAxis('g CO₂/kWh', { position: 'right', beginAtZero: true, grid: { display: false } }) } }) }, 'carbon-daily');
    // average day: consumption profile vs intensity
    const H = [...Array(24).keys()].map(h => String(h).padStart(2, '0') + 'h');
    const nd = o.days.length;
    _fuelChart('cf-hours', { type: 'bar', data: { labels: H, datasets: [
      { label: 'Average consumption (kWh per hour)', data: [...o.hourC].map(v => Math.round(v / nd)), backgroundColor: 'rgba(127,200,248,.45)', borderWidth: 0, yAxisID: 'y' },
      ...(o.ppa.prof.some(v => v) ? [{ label: 'PPA / on-site output (kWh per hour)', data: [...o.ppa.prof].map(v => Math.round(v / nd)), backgroundColor: o.settingsPpaTech === 'wind' ? 'rgba(20,211,169,.45)' : 'rgba(251,191,36,.45)', borderWidth: 0, yAxisID: 'y' }] : []),
      { type: 'line', label: 'Grid intensity when you consume (g/kWh)', data: [...o.hourI].map((v, h) => o.hourN[h] ? Math.round(v / o.hourN[h] * 10) / 10 : null), borderColor: '#A87DC4', borderWidth: 1.8, pointRadius: 0, tension: 0.3, yAxisID: 'y1' },
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('kWh', { beginAtZero: true }), y1: _fuelAxis('g CO₂/kWh', { position: 'right', beginAtZero: true, grid: { display: false } }) } }) }, 'carbon-average-day');
    // physical mix
    const tot = MIX.reduce((s, [k]) => s + o.mix[k], 0) || 1;
    const mix = MIX.map(([k, l, c]) => [l, o.mix[k] / tot * 100, c]).filter(x => x[1] > 0.05).sort((a, b) => b[1] - a[1]);
    _fuelChart('cf-mix', { type: 'bar', data: { labels: mix.map(x => x[0]), datasets: [
      { label: 'Share of your consumption (%)', data: mix.map(x => Math.round(x[1] * 10) / 10), backgroundColor: mix.map(x => x[2]), borderWidth: 0, borderRadius: 3 },
    ] }, options: _fuelOpts({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: _fuelAxis('%', { beginAtZero: true }), y: { grid: { display: false }, ticks: { color: C_TX2, font: { size: 11 } } } } }) }, 'carbon-mix');
    // monthly Scope 2, both methods
    const ms = Object.keys(o.monthly).sort();
    const share = o.E ? 1 - o.covered * 1000 / o.E : 1;
    _fuelChart('cf-monthly', { type: 'bar', data: { labels: ms, datasets: [
      { label: 'Location-based (t CO₂)', data: ms.map(m => +(o.monthly[m].em / 1e6).toFixed(3)), backgroundColor: 'rgba(168,125,196,.75)', borderRadius: 3 },
      { label: 'Market-based (t CO₂)', data: ms.map(m => o.factorRest == null ? null : +(o.monthly[m].E * share * o.factorRest / 1e6).toFixed(3)), backgroundColor: 'rgba(20,211,169,.7)', borderRadius: 3 },
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('t CO₂', { beginAtZero: true }) } }) }, 'carbon-monthly');
  }

  function report(o) {
    const rows = [
      ['Location-based · quarter-hourly (RTE éCO2mix)', t(o.emLocation), o.ciHourly, 'Consumption × French grid intensity at the same quarter-hour. Most precise view of the physical impact of your consumption timing.'],
      ['Location-based · period average', t(o.emAnnualMethod), o.ciAnnual, 'Consumption × national consumption-weighted average intensity over the same period: the usual GHG Protocol location-based figure when hourly data are not used.'],
      ['Market-based', t(o.emMarket), o.emMarket != null ? o.emMarket / o.E : null, `Guarantees of origin and PPA volume (${f1(o.covered)} MWh) at 0 g; the rest (${f1(o.E / 1000 - o.covered)} MWh) ${o.factorRest != null ? 'at the ' + esc(o.factorRestSrc) + ' (' + f1(o.factorRest) + ' g/kWh)' : 'needs a residual mix factor: enter the French residual mix of the reporting year published by the AIB'}.`],
    ];
    $('cf-report').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Scope 2 · ${esc(o.days[0])} → ${esc(o.days[o.days.length - 1])}</th><th>t CO₂</th><th>g CO₂/kWh</th><th style="text-align:left">How it is computed</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td style="text-align:left"><b>${r[0]}</b></td><td>${f2(r[1])}</td><td>${f1(r[2])}</td><td style="text-align:left;white-space:normal;color:var(--text2);min-width:280px">${r[3]}</td></tr>`).join('') +
      `</tbody></table></div>
      <div class="fuel-note">Direct emissions of French generation as published by RTE (éCO2mix), excluding imports and life-cycle emissions; most carbon reporting frameworks add an upstream factor on top. Physical mix = French generation at the time of each consumption quarter-hour. Residual mix: the factor you enter, normally the AIB European Residual Mix of the reporting year (published each May for the previous year). Renewable coverage counts guarantees of origin and the PPA / on-site volume against total consumption; the hour-by-hour figure assumes the PPA follows the national ${esc(o.settingsPpaTech)} profile. ${o.missing ? f1(o.missing / 1000) + ' MWh fall on quarter-hours without RTE data and are counted at the period average. ' : ''}Your file is processed in this browser only: nothing is sent or stored.</div>`;
  }

  async function run() {
    if (!S.cons) return;
    $('cf-results').hidden = false;
    $('cf-status').textContent = 'Computing…';
    let o;
    try { o = await compute(); } catch (e) { console.warn(e); $('cf-status').textContent = 'Computation failed: ' + e.message; return; }
    o.settingsPpaTech = S.settings.ppaTech;
    S.res = o;
    renderKpis(o); charts(o); report(o);
    const i = S.cons.info;
    $('cf-status').textContent = `${S.meta} · ${i.rows.toLocaleString('en-GB')} rows · ${i.step}-min steps · values read as ${{ kwh: 'kWh per step', mwh: 'MWh per step', kw: 'kW (average power)', w: 'W (average power)' }[i.unit]}, timestamps at the ${i.stamp} of each step`;
  }

  async function load(rows, name) {
    try {
      S.raw = rows; S.meta = name;
      S.cons = buildCurve(rows);
      await run();
    } catch (e) { $('cf-status').textContent = e.message; }
  }

  function exportCSV() {
    const o = S.res; if (!o) return;
    const lines = [['date', 'consumption_kWh', 'carbon_intensity_g_per_kWh', 'location_based_kgCO2'].join(';')];
    o.daily.forEach(x => lines.push([x.d, x.E.toFixed(2), x.ci == null ? '' : x.ci.toFixed(1), x.ci == null ? '' : (x.E * x.ci / 1000).toFixed(2)].join(';')));
    lines.push('');
    lines.push('summary;value;unit');
    [['consumption', (o.E / 1000).toFixed(3), 'MWh'], ['location_based_quarter_hourly', t(o.emLocation).toFixed(3), 't CO2'], ['location_based_period_average', o.emAnnualMethod == null ? '' : t(o.emAnnualMethod).toFixed(3), 't CO2'],
      ['market_based', o.emMarket == null ? '' : t(o.emMarket).toFixed(3), 't CO2'], ['residual_or_supplier_factor', o.factorRest == null ? '' : o.factorRest, 'g CO2/kWh'], ['renewable_coverage_annual', (o.coverage * 100).toFixed(1), '%'],
      ['renewable_coverage_hourly', o.hourly == null ? '' : (o.hourly * 100).toFixed(1), '%'], ['spot_cost_profile', o.costAvg == null ? '' : o.costAvg.toFixed(2), 'EUR/MWh'], ['spot_baseload', o.baseAvg == null ? '' : o.baseAvg.toFixed(2), 'EUR/MWh']]
      .forEach(r => lines.push(r.join(';')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'powerklock-scope2-' + o.days[0] + '_' + o.days[o.days.length - 1] + '.csv';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function template() {
    const lines = ['timestamp;kWh', '2025-01-01 00:00;12.4', '2025-01-01 00:15;12.1', '2025-01-01 00:30;11.9', '…'];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'powerklock-load-curve-template.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function wire() {
    const page = $('page-carbonfoot'); if (!page || page.dataset.wired) return;
    page.dataset.wired = '1';
    const file = $('cf-file'), drop = $('cf-drop');
    file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; $('cf-status').textContent = 'Reading ' + f.name + '…'; try { await load(await readFile(f), f.name); } catch (e) { $('cf-status').textContent = e.message; } file.value = ''; });
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('on'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('on'); }));
    drop.addEventListener('drop', async e => { const f = e.dataTransfer.files[0]; if (!f) return; $('cf-status').textContent = 'Reading ' + f.name + '…'; try { await load(await readFile(f), f.name); } catch (er) { $('cf-status').textContent = er.message; } });
    $('cf-example').addEventListener('click', () => load(example(), 'Example: office building, 2025'));
    $('cf-template').addEventListener('click', template);
    $('cf-export').addEventListener('click', exportCSV);
    const bind = (id, key, rebuild) => $(id).addEventListener('change', e => { S.settings[key] = e.target.value; if (S.raw) (rebuild ? load(S.raw, S.meta) : run()); });
    bind('cf-unit', 'unit', true); bind('cf-stamp', 'stamp', true);
    bind('cf-go', 'go'); bind('cf-ppa', 'ppa'); bind('cf-ppa-tech', 'ppaTech'); bind('cf-supplier', 'supplier'); bind('cf-residual', 'residual');
  }

  window.addEventListener('load', () => setTimeout(() => {
    wire();
    const inner = window.showPage;
    if (typeof inner === 'function') window.showPage = function (id) { const r = inner.apply(this, arguments); if (id === 'carbonfoot') wire(); return r; };
  }, 0));
  window.PKCarbonTool = { load, example, compute: () => compute(), state: S };
})();
