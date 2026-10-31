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
//   · the cost of its profile on the day-ahead market vs baseload,
//   · its consumption pattern (heatmap, weekday / weekend, load duration),
//   · two simulators: load flexibility (move part of each day to cheaper
//     hours) and on-site solar (self-consumption, coverage, value, CO₂),
//   · the reporting datapoints (GHG Protocol Scope 2, CSRD ESRS E1-5 / E1-6).
// Everything runs in the browser: the file never leaves the computer.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = PK.esc;   // js/pk-core.js
  // French or English for the sentences built here (fixed labels go through assets/i18n_fr.json)
  const _c = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  // a tab of the page by its English name, whatever the language shown
  const tabBtn = name => [...document.querySelectorAll('#page-carbonfoot .pk-views .tab-btn')].find(b => (window.pkEN ? pkEN(b.textContent) : b.textContent) === name || b.textContent === name);
  const getJSON = path => fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => null);
  const XLSX_LIB = 'js/vendor/xlsx.full.min.js';
  const MIX = [['nuclear', 'Nuclear', '#7B4B9C'], ['hydro', 'Hydro', '#3FA6B4'], ['wind', 'Wind', '#14D3A9'], ['solar', 'Solar', '#FBBF24'],
    ['bio', 'Bioenergy', '#8BC34A'], ['gas', 'Gas', '#C4A57B'], ['coal', 'Coal', '#6B6B6B'], ['oil', 'Oil', '#A0522D']];
  const S = { cons: null, meta: null, res: null, settings: { unit: 'auto', stamp: 'auto', go: 0, ppaTech: 'solar', ppa: 0, supplier: '', residual: '', rmCountry: 'FR', annualFactor: '', flexPct: 10, flexGoal: 'cost', pvKwp: 0, pvYield: 1150, fixPeriod: 'cal1',
    conn: 'auto', margin: 2, cee: 10, goP: 0, turpe: '', turpeFix: '', net: 'dist', turpeAcc: '', accRisk: '', accKwc: 0, accKey: 100, accYield: 1150, accPrice: 80, pmo: 7.5, country: 'FR', gc: '' } };
  // Residual mix CO2 factors (g/kWh) quoted from the AIB European Residual Mix
  // results (www.aib-net.org), France and Belgium only; other countries: entered by the user.
  const RM = { FR: { 2022: 124.96, 2023: 40.74, 2024: 23.52, 2025: 17.11 }, BE: { 2022: 144.27, 2023: 167.49, 2024: 131.73, 2025: 171.01 } };

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
  function buildCurve(rows, opts) {
    opts = opts || S.settings;
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
    let unit = opts.unit || 'auto';
    if (unit === 'auto') unit = /\(w\)|\bw\b|valeur/.test(htxt) && !/kw/.test(htxt) ? 'w' : /kwh/.test(htxt) ? 'kwh' : /\bkw\b|\(kw\)/.test(htxt) ? 'kw' : /mwh/.test(htxt) ? 'mwh' : 'kwh';
    let stamp = opts.stamp || 'auto';
    if (stamp === 'auto') stamp = enedis ? 'end' : 'start';
    const pts = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i]; if (!r || r.length < 2) continue;
      const t = parseStamp(r[0], sepTime ? r[1] : null), v = toNum(r[valCol]);
      if (!t || v == null) continue;
      pts.push({ t, k: Date.UTC(t.y, t.m - 1, t.d, t.hh, t.mi) / 60000, v });
    }
    if (pts.length < 4) throw new Error(_c('Aucune ligne date + valeur trouvée. Attendu : deux colonnes, une date-heure et une valeur (consommation ou production).', 'No timestamp + value rows found. Expected two columns: date-time and a value (consumption or production).'));
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
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = XLSX_LIB; s.onload = res; s.onerror = () => rej(new Error(_c('Le lecteur Excel n’a pas pu se charger', 'Excel reader failed to load'))); document.head.appendChild(s); });
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
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const HRS = [...Array(24).keys()].map(h => String(h).padStart(2, '0') + 'h');
  const dow = d => new Date(d + 'T12:00:00Z').getUTCDay();
  const qTime = (d, q) => `${d} ${String(Math.floor(q / 4)).padStart(2, '0')}:${String(q % 4 * 15).padStart(2, '0')}`;

  // ── Computation ───────────────────────────────────────────────────
  // One row per day: consumption (kWh per quarter-hour), day-ahead price,
  // grid CO₂ intensity and the national generation behind it (RTE éCO2mix).
  async function rowsFor(days) {
    const months = [...new Set(days.map(d => d.slice(0, 7)))], years = [...new Set(days.map(d => d.slice(0, 4)))];
    const [rte, prices] = await Promise.all([Promise.all(months.map(rteMonth)), Promise.all(years.map(priceYear))]);
    const R = {}, P = {};
    rte.forEach(f => { if (f && f.days) Object.assign(R, f.days); });
    prices.forEach(f => { if (f && f.days) Object.assign(P, f.days); });
    return days.map(d => ({ d, e: S.cons.slots.get(d), r: R[d] || null, p: P[d] || null }));
  }

  // Load flexibility: each day, move a share of the energy from the most
  // expensive (or most carbon-intensive) quarter-hours to the cheapest ones,
  // never above the day's own peak (the contracted power does not change).
  function flex(rows, pct, goal) {
    let save = 0, dCO2 = 0, moved = 0; const after = new Float64Array(24), before = new Float64Array(24); let n = 0;
    rows.forEach(({ e, r, p }) => {
      if (!p || !r || !r.co2) return;
      const key = q => goal === 'co2' ? r.co2[q] : p[q];
      const qs = [...Array(96).keys()].filter(q => p[q] != null && r.co2[q] != null);
      if (qs.length < 90) return;
      const x = Float64Array.from(e), tot = x.reduce((a, b) => a + b, 0), peak = Math.max(...x);
      let M = tot * pct / 100;
      const hi = qs.slice().sort((a, b) => key(b) - key(a)), lo = qs.slice().sort((a, b) => key(a) - key(b));
      let j = 0;
      for (const q of hi) {
        if (M <= 1e-9) break;
        let take = Math.min(x[q], M);
        while (take > 1e-9 && j < lo.length) {
          const t = lo[j]; if (key(t) >= key(q)) { take = 0; break; }
          const room = peak - x[t]; if (room <= 1e-9) { j++; continue; }
          const m = Math.min(take, room);
          x[q] -= m; x[t] += m; take -= m; M -= m; moved += m;
          save += m * (p[q] - p[t]) / 1000; dCO2 += m * (r.co2[t] - r.co2[q]);
        }
      }
      for (let q = 0; q < 96; q++) { before[q >> 2] += e[q]; after[q >> 2] += x[q]; }
      n++;
    });
    return { save, dCO2, moved, before: [...before].map(v => n ? v / n : 0), after: [...after].map(v => n ? v / n : 0) };
  }

  // On-site solar: the national solar profile of the same quarter-hours,
  // scaled to the installation (kWp × specific yield, kWh/kWp/yr).
  function solar(rows, kwp, yieldKWh) {
    let natSum = 0; rows.forEach(({ r }) => { if (r && r.solar) for (let q = 0; q < 96; q++) natSum += Math.max(0, r.solar[q] || 0); });
    const out = { prod: 0, self: 0, surplus: 0, valSelf: 0, valSurplus: 0, co2: 0, hourP: new Float64Array(24), hourS: new Float64Array(24), hourC: new Float64Array(24), monthly: {} };
    if (!kwp || !natSum) return out;
    const k = kwp * yieldKWh * (rows.length / 365) / natSum;
    rows.forEach(({ d, e, r, p }) => {
      if (!r || !r.solar) return;
      const M = out.monthly[d.slice(0, 7)] || (out.monthly[d.slice(0, 7)] = { E: 0, self: 0, prod: 0 });
      for (let q = 0; q < 96; q++) {
        const g = Math.max(0, r.solar[q] || 0) * k, c = e[q] || 0, s = Math.min(g, c), x = g - s;
        out.prod += g; out.self += s; out.surplus += x; M.prod += g; M.self += s; M.E += c;
        if (p && p[q] != null) { out.valSelf += s * p[q] / 1000; out.valSurplus += x * p[q] / 1000; }
        if (r.co2 && r.co2[q] != null) out.co2 += s * r.co2[q];
        const h = q >> 2; out.hourP[h] += g; out.hourS[h] += s; out.hourC[h] += c;
      }
    });
    const nd = rows.length || 1; ['hourP', 'hourS', 'hourC'].forEach(kk => { out[kk] = [...out[kk]].map(v => v / nd); });
    return out;
  }

  const CAP_PRICE = 18646.63;   // €/MW, capacity price of winter 2026-27 (RTE, single price set on 1 October)
  async function compute() {
    const days = [...S.cons.slots.keys()].sort();
    const rows = await rowsFor(days), st = S.settings;
    const o = { rows, days, E: 0, em: 0, missing: 0, nat: { em: 0, load: 0 }, mix: {}, cost: 0, Ep: 0, base: { s: 0, n: 0 },
      daily: [], monthly: {}, hourC: new Float64Array(24), hourI: new Float64Array(24), hourN: new Float64Array(24), hourP: new Float64Array(24), hourPn: new Float64Array(24),
      wk: { wd: new Float64Array(24), we: new Float64Array(24), nwd: 0, nwe: 0 }, mh: [...Array(12)].map(() => ({ e: new Float64Array(24), n: new Float64Array(24), ci: new Float64Array(24), cn: new Float64Array(24) })),
      shp: [...Array(12)].map(() => [new Float64Array(96), new Float64Array(96)]), shpN: [...Array(12)].map(() => [0, 0]),
      kw: [], peak: { v: -Infinity, at: '' }, offHours: 0, dailyMinKW: [], capDays: [], ppa: { prof: new Float64Array(24), match: 0, surplus: 0, monthly: {} } };
    MIX.forEach(([k]) => { o.mix[k] = 0; });
    const ppaKey = st.ppaTech, ppaMWh = +st.ppa || 0;
    let ppaShape = 0; rows.forEach(({ r }) => { if (r && r[ppaKey]) r[ppaKey].forEach(v => { ppaShape += Math.max(0, v || 0); }); });
    rows.forEach(({ d, e, r, p }) => {
      const mk = d.slice(0, 7), M = o.monthly[mk] || (o.monthly[mk] = { E: 0, em: 0, cost: 0, Ep: 0, ppa: 0 }), mi = +d.slice(5, 7) - 1;
      const wd = dow(d), isWd = wd > 0 && wd < 6; let dE = 0, dEm = 0, dMin = Infinity;
      if (isWd) o.wk.nwd++; else o.wk.nwe++;
      o.shpN[mi][isWd ? 0 : 1]++;
      for (let q = 0; q < 96; q++) o.shp[mi][isWd ? 0 : 1][q] += e[q] || 0;
      for (let q = 0; q < 96; q++) {
        const c = e[q] || 0, kw = c * 4, h = q >> 2;
        o.kw.push(kw); if (kw > o.peak.v) o.peak = { v: kw, at: qTime(d, q) }; if (kw < dMin) dMin = kw;
        if (!isWd || h < 7 || h >= 20) o.offHours += c;
        (isWd ? o.wk.wd : o.wk.we)[h] += c;
        o.mh[mi].e[h] += c; o.mh[mi].n[h] += 0.25;
        const ci = r && r.co2 ? r.co2[q] : null;
        if (ci != null) { o.mh[mi].ci[h] += ci; o.mh[mi].cn[h]++; if (r.load && r.load[q] != null) { o.nat.em += ci * r.load[q]; o.nat.load += r.load[q]; } }
        if (p && p[q] != null) { o.base.s += p[q]; o.base.n++; o.hourP[h] += p[q]; o.hourPn[h]++; }
        if (!c) continue;
        dE += c; M.E += c; o.hourC[h] += c;
        if (ci == null) { o.missing += c; } else {
          dEm += c * ci; M.em += c * ci; o.hourI[h] += c * ci; o.hourN[h] += c;
          let tot = 0; const sh = {}; MIX.forEach(([k]) => { const v = r[k] ? Math.max(0, r[k][q] || 0) : 0; sh[k] = v; tot += v; });
          if (tot > 0) MIX.forEach(([k]) => { o.mix[k] += c * sh[k] / tot; });
        }
        if (p && p[q] != null) { o.cost += c / 1000 * p[q]; o.Ep += c; M.cost += c / 1000 * p[q]; M.Ep += c; }
        if (ppaMWh && ppaShape && r && r[ppaKey]) { const g = Math.max(0, r[ppaKey][q] || 0) / ppaShape * ppaMWh * 1000; o.ppa.match += Math.min(c, g); o.ppa.surplus += Math.max(0, g - c); o.ppa.prof[h] += g; M.ppa += Math.min(c, g); }
      }
      o.dailyMinKW.push(dMin);
      // capacity mechanism (winter peak days, 07:00-10:00 and 17:00-20:00): the day's national load and the site's load in the windows
      if (isWd && (mi >= 10 || mi <= 2) && r && r.load) {
        const nl = r.load.filter(v => v != null); let win = 0;
        for (let q = 28; q < 40; q++) win += e[q] || 0;
        for (let q = 68; q < 80; q++) win += e[q] || 0;
        if (nl.length > 80) o.capDays.push({ d, nat: nl.reduce((a, b) => a + b, 0) / nl.length, kw: win * 4 / 24 });
      }
      o.E += dE; o.em += dEm;
      o.daily.push({ d, E: dE, ci: dE ? dEm / dE : null, cost: null });
    });
    // the capacity obligation, new mechanism (RTE single buyer, winter 2026-27 price 18,646.63 € per MW consumed at the
    // peak): RTE's peak days are not public here, so the 22 weekdays of highest national load per winter stand in for them
    if (o.capDays.length) {
      const k = Math.max(1, Math.round(22 * o.capDays.length / 105));
      const top = o.capDays.slice().sort((a, b) => b.nat - a.nat).slice(0, k);
      const mw = top.reduce((a, x) => a + x.kw, 0) / top.length / 1000;
      o.capacity = { days: top.map(x => x.d).sort(), mw, cost: mw * CAP_PRICE, avgMW: o.E / (days.length * 24) / 1000 };
    }
    const nd = days.length;
    o.avgKW = o.E / (nd * 24);
    const sortedKW = o.kw.slice().sort((a, b) => b - a);
    o.p95 = sortedKW[Math.floor(sortedKW.length * 0.05)] || 0;
    o.baseKW = o.dailyMinKW.slice().sort((a, b) => a - b)[Math.floor(o.dailyMinKW.length / 2)] || 0;
    o.duration = sortedKW.filter((_, i) => i % Math.max(1, Math.floor(sortedKW.length / 400)) === 0);
    o.loadFactor = o.peak.v ? o.avgKW / o.peak.v : null;
    o.ciHourly = o.E - o.missing > 0 ? o.em / (o.E - o.missing) : null;
    o.ciAnnual = o.nat.load ? o.nat.em / o.nat.load : null;
    o.emLocation = o.ciHourly != null ? o.ciHourly * o.E : null;
    o.emAnnualMethod = o.ciAnnual != null ? o.E * o.ciAnnual : null;
    o.emAnnualFactor = st.annualFactor !== '' && st.annualFactor != null && isFinite(+st.annualFactor) ? o.E * +st.annualFactor : null;
    // market-based (GHG Protocol Scope 2)
    const year = days[days.length - 1].slice(0, 4);
    const typed = st.residual === '' || st.residual == null ? null : +st.residual;
    const tab = RM[st.rmCountry], tabYears = tab ? Object.keys(tab).sort() : [];
    const rmYear = tab ? (tabYears.includes(year) ? year : tabYears.filter(y => y <= year).pop() || tabYears[tabYears.length - 1]) : null;
    o.rmCI = typed != null ? typed : tab ? tab[rmYear] : null;
    o.rmLabel = typed != null ? _c('facteur de mix résiduel saisi', 'residual mix factor entered') : tab ? _c(`mix résiduel AIB ${st.rmCountry === 'FR' ? 'France' : 'Belgique'} ${rmYear}${rmYear !== year ? ' (dernier publié)' : ''}`, `AIB residual mix ${st.rmCountry === 'FR' ? 'France' : 'Belgium'} ${rmYear}${rmYear !== year ? ' (latest published)' : ''}`) : null;
    const goMWh = +st.go || 0, supplier = st.supplier === '' ? null : +st.supplier;
    o.goMWh = goMWh; o.ppaMWh = ppaMWh;
    o.covered = Math.min(o.E / 1000, goMWh + ppaMWh); o.coverage = o.E ? o.covered / (o.E / 1000) : 0;
    o.factorRest = supplier != null && isFinite(supplier) ? supplier : o.rmCI;
    o.factorRestSrc = supplier != null && isFinite(supplier) ? _c('facteur propre au fournisseur', 'supplier-specific factor') : o.rmLabel || _c('mix résiduel', 'residual mix');
    o.emMarket = o.factorRest != null ? (o.E / 1000 - o.covered) * 1000 * o.factorRest : null;
    o.hourly = ppaMWh ? o.ppa.match / o.E : null;
    o.costAvg = o.Ep ? o.cost / (o.Ep / 1000) : null;
    o.baseAvg = o.base.n ? o.base.s / o.base.n : null;
    o.year = year;
    o.flex = flex(rows, +st.flexPct || 0, st.flexGoal);
    o.pv = solar(rows, +st.pvKwp || 0, +st.pvYield || 1150);
    o.pvHint = Math.max(10, Math.round(o.avgKW / 10) * 10);
    o.pvAuto = solar(rows, o.pvHint, +st.pvYield || 1150);
    o.flexAuto = st.flexPct ? o.flex : flex(rows, 10, 'cost');
    try { o.fixed = await fixedPrice(o, st.fixPeriod, o.shp); } catch (e) { console.warn('[carbon] fixed price', e); o.fixed = null; }
    o.acc = accSim(o, rows, st);
    if (o.acc) { try { o.acc.fixed = await fixedPrice(o, st.fixPeriod, o.acc.shp); } catch (e) { console.warn('[carbon] ACC complement', e); } }
    if (o.acc) {   // national cost of solar forecast errors (€/MWh produced), ENTSO-E, scripts/fetch_fr_imbalance_cost.py
      const ic = await (imbP || (imbP = getJSON('history/fr_imbalance_cost.json')));
      let c = 0, m = 0; if (ic && ic.months) { const own = Object.values(ic.months).filter(x => x.solar && x.solar.ours).length >= 3 && (!ic.use || ic.use.solar === 'ours'); Object.values(ic.months).forEach(x => { const b = x.solar && (own ? x.solar.ours : x.solar); if (b && b.mwh) { c += b.costEur; m += b.mwh; } }); }
      o.acc.imbNat = m ? c / m : null;
    }
    return o;
  }

  // ── Fixed price of your consumption ───────────────────────────────
  // Energy price a supplier would fix today for your profile over a future
  // delivery period: each month's baseload forward × your profile factor
  // (what your quarter-hours cost on the spot ÷ the baseload, measured with
  // your average day of that month, working days and weekends apart, on the
  // last two complete years of French day-ahead prices), + the capacity cost
  // spread over the volume. Excludes grid fees, taxes, guarantees of origin
  // and the supplier's margin and risk premium.
  let fwdP = null, imbP = null;
  // Collective self-consumption (ACC): a share (allocation key) of a local solar installation's output
  // (national solar profile scaled to kWc × yield) covers the site quarter-hour by quarter-hour; the
  // rest (allo-consumption) comes from the supplier. Returns the residual average days for its price.
  function accSim(o, rows, st) {
    const kwc = +st.accKwc || 0; if (!kwc) return null;
    const key = Math.min(100, Math.max(0, +st.accKey || 0)) / 100, yld = +st.accYield || 1150;
    let natSum = 0; rows.forEach(({ r }) => { if (r && r.solar) for (let q = 0; q < 96; q++) natSum += Math.max(0, r.solar[q] || 0); });
    if (!natSum || !key) return null;
    const k = kwc * yld * (rows.length / 365) / natSum * key;
    const shp = [...Array(12)].map(() => [new Float64Array(96), new Float64Array(96)]);
    // average day per month, hour by hour (kWh per hour per day): consumption, ACC production, self-consumed
    const day = [...Array(12)].map(() => ({ c: new Float64Array(24), g: new Float64Array(24), x: new Float64Array(24), n: 0 }));
    let prod = 0, self = 0;
    rows.forEach(({ d, e, r }) => {
      const mi = +d.slice(5, 7) - 1, w = dow(d), t = w > 0 && w < 6 ? 0 : 1, D = day[mi];
      D.n++;
      for (let q = 0; q < 96; q++) {
        const g = r && r.solar ? Math.max(0, r.solar[q] || 0) * k : 0, c = e[q] || 0, x = Math.min(g, c);
        prod += g; self += x; shp[mi][t][q] += c - x;
        D.c[q >> 2] += c; D.g[q >> 2] += g; D.x[q >> 2] += x;
      }
    });
    // capacity: your load in the peak windows of the same peak days, after the ACC share
    let capR = null;
    if (o.capacity) {
      const want = new Set(o.capacity.days); let tot = 0, nd = 0;
      rows.forEach(({ d, e, r }) => {
        if (!want.has(d)) return; let win = 0;
        const g = q => r && r.solar ? Math.max(0, r.solar[q] || 0) * k : 0;
        for (const [a, b] of [[28, 40], [68, 80]]) for (let q = a; q < b; q++) win += Math.max(0, (e[q] || 0) - g(q));
        tot += win * 4 / 24; nd++;
      });
      if (nd) capR = (tot / nd / 1000) * CAP_PRICE;
    }
    return { kwc, key, yld, prod, self, surplus: prod - self, share: o.E ? self / o.E : 0, exempt: kwc < 1000, shp, capR, day };
  }

  async function fixedPrice(o, period, shp) {
    const fwd = await (fwdP || (fwdP = getJSON('history/fr_forward_monthly.json')));
    if (!fwd || !fwd.months) return null;
    const now = new Date(), Y = now.getUTCFullYear(), hy = [Y - 2, Y - 1];
    const hist = await Promise.all(hy.map(priceYear));
    // your average day per month and day type (kWh per quarter-hour); months without data take the all-months shape
    const avg = (m, k) => o.shpN[m][k] ? [...shp[m][k]].map(v => v / o.shpN[m][k]) : null;
    const all = [0, 1].map(k => { const n = o.shpN.reduce((a, x) => a + x[k], 0); if (!n) return null; const v = new Float64Array(96); shp.forEach(x => x[k].forEach((y, q) => { v[q] += y; })); return [...v].map(y => y / n); });
    const shape = (m, k) => avg(m, k) || all[k] || all[1 - k];
    const factors = [...Array(12)].map(() => []);
    hist.forEach(h => {
      if (!h || !h.days) return;
      const acc = [...Array(12)].map(() => ({ w: 0, e: 0, b: 0, n: 0 }));
      Object.entries(h.days).forEach(([d, p]) => {
        const m = +d.slice(5, 7) - 1, wd = dow(d), sh = shape(m, wd > 0 && wd < 6 ? 0 : 1); if (!sh || !p) return;
        const A = acc[m];
        for (let q = 0; q < 96; q++) { if (p[q] == null) continue; A.w += sh[q] * p[q]; A.e += sh[q]; A.b += p[q]; A.n++; }
      });
      acc.forEach((A, m) => { if (A.e && A.n > 2000 && A.b) factors[m].push((A.w / A.e) / (A.b / A.n)); });
    });
    // delivery months
    const ym = (y, m) => y + '-' + String(m + 1).padStart(2, '0');
    let months = [];
    if (period === 'next12') { for (let i = 1; i <= 12; i++) { const d = new Date(Date.UTC(Y, now.getUTCMonth() + i, 1)); months.push(ym(d.getUTCFullYear(), d.getUTCMonth())); } }
    else { const y = Y + (period === 'cal2' ? 2 : 1); for (let m = 0; m < 12; m++) months.push(ym(y, m)); }
    const rows = [];
    for (const k of months) {
      const F = fwd.months[k]; const m = +k.slice(5) - 1, f = factors[m];
      if (!F || !f.length) return { missing: k, period };
      // working days and weekends of that month × your average day of each
      const [yy, mm] = k.split('-').map(Number), nd = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      let E = 0; for (let d = 1; d <= nd; d++) { const w = new Date(Date.UTC(yy, mm - 1, d)).getUTCDay(), sh = shape(m, w > 0 && w < 6 ? 0 : 1); if (sh) E += sh.reduce((a, b) => a + b, 0); }
      const fac = f.reduce((a, b) => a + b, 0) / f.length;
      rows.push({ k, E, F: F.value, from: F.from, fac, lo: Math.min(...f), hi: Math.max(...f) });
    }
    const Et = rows.reduce((a, r) => a + r.E, 0); if (!Et) return null;
    const wavg = key => rows.reduce((a, r) => a + r.E * (key === 'p' ? r.F * r.fac : key === 'lo' ? r.F * r.lo : key === 'hi' ? r.F * r.hi : r.F), 0) / Et;
    const energy = wavg('p'), base = wavg('F');
    const cap = o.capacity && o.capacity.cost ? o.capacity.cost / (Et / 1000) : null;   // € per winter ÷ MWh per year
    return { period, months: rows, E: Et, energy, base, factor: energy / base, lo: wavg('lo'), hi: wavg('hi'), cap, total: energy + (cap || 0),
      histYears: hy, asOf: fwd.asOf, realised: o.costAvg != null && o.baseAvg ? o.costAvg / o.baseAvg : null };
  }

  // ── Rendering helpers ─────────────────────────────────────────────
  const f0 = v => v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-GB');
  const f1 = v => v == null || !isFinite(v) ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const f2 = v => v == null || !isFinite(v) ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pc = v => v == null || !isFinite(v) ? '–' : Math.round(v * 100) + ' %';
  const t = g => g == null ? null : g / 1e6;   // g → t
  const em = (g, small) => g == null ? ['–', 't CO₂'] : (small ? [f0(g / 1000), 'kg CO₂'] : [f2(g / 1e6), 't CO₂']);
  const MWh = kwh => kwh >= 10000 ? f1(kwh / 1000) + ' MWh' : f0(kwh) + ' kWh';
  const eur = v => Math.abs(v) >= 10000 ? f1(v / 1000) + ' k€' : f0(v) + ' €';
  const legend = () => ({ display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10, filter: it => !/^_/.test(it.text) } });
  const xCat = () => Object.assign(_fuelXAxis(), { grid: { display: false } });
  function heat(hostId, grid, unit, pal) {
    const host = $(hostId); if (!host) return;
    const vals = grid.flat().filter(v => v != null), lo = Math.min(...vals), hi = Math.max(...vals);
    const col = v => { if (v == null) return 'transparent'; const x = hi > lo ? (v - lo) / (hi - lo) : 0.5; const [a, b] = pal; const c = a.map((ai, i) => Math.round(ai + (b[i] - ai) * x)); return `rgba(${c[0]},${c[1]},${c[2]},${(0.18 + 0.82 * x).toFixed(2)})`; };
    const fmt = v => v == null ? '' : Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
    host.innerHTML = `<div class="cf-hm"><table><thead><tr><th></th>${HRS.map((h, i) => `<th>${i % 3 ? '' : h}</th>`).join('')}</tr></thead><tbody>` +
      grid.map((row, m) => row.every(v => v == null) ? '' : `<tr><th>${MON[m]}</th>${row.map((v, h) => `<td style="background:${col(v)}" title="${MON[m]} ${HRS[h]}: ${v == null ? '–' : fmt(v) + ' ' + unit}">${fmt(v)}</td>`).join('')}</tr>`).join('') +
      `</tbody></table></div><div class="cf-hm-leg"><span>${fmt(lo)} ${unit}</span><i style="background:linear-gradient(90deg,${col(lo)},${col(hi)})"></i><span>${fmt(hi)} ${unit}</span></div>`;
  }

  // ── Overview ──────────────────────────────────────────────────────
  function words(o) {
    const per = `${o.days[0]} → ${o.days[o.days.length - 1]}`, timing = o.ciAnnual && o.ciHourly ? (o.ciHourly / o.ciAnnual - 1) * 100 : null;
    const shape = o.costAvg != null && o.baseAvg ? (o.costAvg / o.baseAvg - 1) * 100 : null, fx = o.flexAuto, pvA = o.pvAuto;
    const li = [
      _c(`Du ${o.days[0]} au ${o.days[o.days.length - 1]}, vous avez consommé <b>${MWh(o.E)}</b> : <b>${f0(o.avgKW)} kW</b> en moyenne, une pointe de <b>${f0(o.peak.v)} kW</b> (${o.peak.at}) et un talon de <b>${f0(o.baseKW)} kW</b> (minimum habituel de la nuit). <b>${pc(o.offHours / o.E)}</b> tombe hors des heures ouvrées (nuits et week-ends).`,
        `Over ${per} you consumed <b>${MWh(o.E)}</b>: an average of <b>${f0(o.avgKW)} kW</b>, a peak of <b>${f0(o.peak.v)} kW</b> (${o.peak.at}) and a base load of <b>${f0(o.baseKW)} kW</b> (typical night-time minimum). <b>${pc(o.offHours / o.E)}</b> of it falls outside working hours (nights and weekends).`),
      _c(`En méthode « location-based », cela représente <b>${em(o.emLocation, o.emLocation < 1e6).join(' ')}</b> (${f1(o.ciHourly)} g/kWh).${timing == null ? '' : ` Vous consommez quand le réseau est <b>${timing <= 0 ? 'moins carboné' : 'plus carboné'}</b> que la moyenne nationale : ${timing > 0 ? '+' : ''}${timing.toFixed(1)} % vs ${f1(o.ciAnnual)} g/kWh.`}`,
        `Location-based, it emitted <b>${em(o.emLocation, o.emLocation < 1e6).join(' ')}</b> (${f1(o.ciHourly)} g/kWh).${timing == null ? '' : ` You consume when the grid is <b>${timing <= 0 ? 'cleaner' : 'more carbon-intensive'}</b> than the national average: ${timing > 0 ? '+' : ''}${timing.toFixed(1)} % vs ${f1(o.ciAnnual)} g/kWh.`}`),
      o.emMarket != null ? _c(`En méthode « market-based » (GHG Protocol Scope 2)${o.covered ? `, avec ${f0(o.covered)} MWh couverts par des garanties d’origine ou un PPA` : ''} : <b>${em(o.emMarket, o.emMarket < 1e6).join(' ')}</b>.`,
        `Market-based (GHG Protocol Scope 2)${o.covered ? `, with ${f0(o.covered)} MWh covered by guarantees of origin or a PPA` : ''}: <b>${em(o.emMarket, o.emMarket < 1e6).join(' ')}</b>.`) : _c('Market-based : indiquez le facteur du mix résiduel (ou gardez France) pour l’obtenir.', 'Market-based: enter the residual mix factor (or keep France) to get it.'),
      shape == null ? '' : _c(`Sur le marché spot, votre profil coûte <b>${f2(o.costAvg)} €/MWh</b>, ${Math.abs(shape).toFixed(1)} % ${shape > 0 ? 'au-dessus' : 'en dessous'} du prix base (${f2(o.baseAvg)} €/MWh) : <b>${eur(o.cost)}</b> d’énergie sur la période.`,
        `On the day-ahead market your profile costs <b>${f2(o.costAvg)} €/MWh</b>, ${Math.abs(shape).toFixed(1)} % ${shape > 0 ? 'above' : 'below'} baseload (${f2(o.baseAvg)} €/MWh): <b>${eur(o.cost)}</b> of energy over the period.`),
      fx.moved ? _c(`Décaler ${S.settings.flexPct || 10} % de la consommation de chaque jour vers les heures les moins chères (même jour, sans nouvelle pointe) ferait économiser environ <b>${eur(fx.save)}</b> et changerait les émissions de <b>${fx.dCO2 > 0 ? '+' : ''}${f0(fx.dCO2 / 1000)} kg CO₂</b> — voir Coût & flexibilité.`,
        `Moving ${S.settings.flexPct || 10} % of each day's consumption to the cheapest hours (same day, no new peak) would save about <b>${eur(fx.save)}</b> and change emissions by <b>${fx.dCO2 > 0 ? '+' : ''}${f0(fx.dCO2 / 1000)} kg CO₂</b> — see Cost & flexibility.`) : '',
      pvA.prod ? _c(`Une installation solaire de <b>${f0(o.pvHint)} kWc</b> (dimensionnée sur votre puissance moyenne) produirait ${MWh(pvA.prod)}, couvrirait <b>${pc(pvA.self / o.E)}</b> de votre consommation et serait autoconsommée à <b>${pc(pvA.self / pvA.prod)}</b> — voir Solaire & couverture.`,
        `A solar installation of <b>${f0(o.pvHint)} kWp</b> (sized on your average load) would produce ${MWh(pvA.prod)}, cover <b>${pc(pvA.self / o.E)}</b> of your consumption and be <b>${pc(pvA.self / pvA.prod)}</b> self-consumed — see Solar & coverage.`) : '',
    ].filter(Boolean);
    $('cf-words').innerHTML = `<ul>${li.map(x => `<li>${x}</li>`).join('')}</ul>`;
  }
  // ── the summary: four figures in large, one sentence that ties them, kept for Today (this browser only) ──
  function summary(o, timing, shape) {
    const big = $('cf-big'); if (!big) return;
    const yr = 365 / Math.max(1, o.days.length), fx = o.flexAuto, gain = fx && fx.moved ? fx.save * yr : null, small = (o.emLocation || 0) < 1e6;
    const eL = em(o.emLocation, small), eM = em(o.emMarket, small);
    const K = (n, v, u, sub) => `<div class="cf-k"><span class="cf-k-n">${n}</span><span class="cf-k-v">${v}<small>${u}</small></span><span class="cf-k-s">${sub}</span></div>`;
    big.innerHTML = [
      K(_c('Émissions (location-based)', 'Emissions (location-based)'), eL[0], eL[1], `${f1(o.ciHourly)} g/kWh${timing == null ? '' : ` · <b class="${timing <= 0 ? 'cf-dn' : 'cf-up'}">${timing > 0 ? '+' : ''}${timing.toFixed(1)} %</b> ${_c('vs moyenne France', 'vs French average')}`}`),
      K(_c('Émissions (market-based)', 'Emissions (market-based)'), eM[0], eM[1], o.factorRest == null ? _c('il faut un facteur de mix résiduel', 'needs a residual mix factor') : esc(o.factorRestSrc)),
      K(_c('Coût de votre profil au spot', 'Your profile on the spot'), Math.abs(o.cost) >= 1000 ? f1(o.cost / 1000) : f0(o.cost), Math.abs(o.cost) >= 1000 ? 'k€' : '€', shape == null ? '' : `<b class="${shape > 0 ? 'cf-up' : 'cf-dn'}">${shape > 0 ? '+' : ''}${shape.toFixed(1)} %</b> ${_c('vs prix base', 'vs baseload')} · ${f2(o.costAvg)} €/MWh`),
      K(_c('Ce que vous pourriez gagner', 'What you could save'), gain == null ? '–' : Math.abs(gain) >= 1000 ? f1(gain / 1000) : f0(gain), gain != null && Math.abs(gain) >= 1000 ? _c('k€/an', 'k€/yr') : _c('€/an', '€/yr'), _c(`en décalant ${S.settings.flexPct || 10} % de chaque jour vers les heures les moins chères`, `moving ${S.settings.flexPct || 10} % of each day to the cheapest hours`)),
    ].join('');
    // one sentence: volume and when, cost against baseload, carbon against France, the solar hint
    const wd = o.wk.nwd && o.wk.nwe ? (o.wk.wd.reduce((a, b) => a + b, 0) / o.wk.nwd) / Math.max(1e-9, o.wk.we.reduce((a, b) => a + b, 0) / o.wk.nwe) : 1;
    const when = wd > 1.4 ? _c('surtout en semaine', 'mostly on weekdays') : _c('aussi bien en semaine que le week-end', 'on weekdays and weekends alike');
    const pvA = o.pvAuto, pv = pvA && pvA.prod ? _c(` Un toit solaire de ${f0(o.pvHint)} kWc couvrirait ${pc(pvA.self / o.E)} de vos besoins.`, ` A ${f0(o.pvHint)} kWp solar roof would cover ${pc(pvA.self / o.E)} of your needs.`) : '';
    const yE = o.E / 1000 * yr;
    $('cf-sentence').innerHTML = _c(`Vous consommez <b>${f0(yE)} MWh par an</b>, ${when} : ${shape == null ? '' : shape > 0 ? 'un peu plus cher que le prix base' : 'moins cher que le prix base'}${timing == null ? '' : ', ' + (timing <= 0 ? 'moins carboné que la moyenne française' : 'plus carboné que la moyenne française')}.${pv}`,
      `You use <b>${f0(yE)} MWh a year</b>, ${when}: ${shape == null ? '' : shape > 0 ? 'a little dearer than baseload' : 'cheaper than baseload'}${timing == null ? '' : ', ' + (timing <= 0 ? 'cleaner than the French average' : 'more carbon-intensive than the French average')}.${pv}`);
    try { localStorage.setItem('pk-cf-last', JSON.stringify({ at: new Date().toISOString().slice(0, 10), meta: S.meta, mwh: yE, ciH: o.ciHourly, timing, emL: o.emLocation, emM: o.emMarket, costAvg: o.costAvg, shape, gain })); } catch (_) {}
  }
  // the client sheet: the summary as one PowerPoint slide (js/export.js)
  async function clientSheet(btn) {
    const box = $('cf-sum'); if (!box || !window.PKExport) return;
    const t = btn.textContent; btn.disabled = true; btn.textContent = _c('Préparation…', 'Preparing…');
    try { await PKExport.deck(_c('Empreinte de votre consommation · ', 'Your consumption footprint · ') + (S.meta || ''), [{ k: 'card', title: _c('Empreinte de votre consommation', 'Your consumption footprint'), sub: S.meta || '', src: 'PowerKlock · RTE éCO2mix · ENTSO-E · AIB', r: await PKExport.snap(box) }]); }
    catch (e) { console.warn('[carbon] sheet', e); }
    finally { btn.disabled = false; btn.textContent = t; }
  }
  // the three steps at the top of « Your data »
  function steps(n) { document.querySelectorAll('#cf-steps .cf-step').forEach(e => { const k = +e.dataset.s; e.classList.toggle('on', k === n); e.classList.toggle('done', k < n); }); }
  function renderOverview(o) {
    const timing = o.ciAnnual && o.ciHourly ? (o.ciHourly / o.ciAnnual - 1) * 100 : null, small = (o.emLocation || 0) < 1e6;
    const eL = em(o.emLocation, small), eM = em(o.emMarket, small), shape = o.costAvg != null && o.baseAvg ? (o.costAvg / o.baseAvg - 1) * 100 : null;
    $('cf-kpis').innerHTML = [
      _fuelKpi('Consumption', o.E < 100000 ? f2(o.E / 1000) : f1(o.E / 1000), 'MWh', _c(`${o.days.length} jours · moyenne ${f0(o.avgKW)} kW`, `${o.days.length} days · average ${f0(o.avgKW)} kW`)),
      _fuelKpi('Peak power', f0(o.peak.v), 'kW', _c(`talon ${f0(o.baseKW)} kW · facteur de charge ${pc(o.loadFactor)}`, `base ${f0(o.baseKW)} kW · load factor ${pc(o.loadFactor)}`)),
      _fuelKpi('Location-based', eL[0], eL[1], `${f1(o.ciHourly)} g/kWh · ${_c('moment', 'timing')} ${timing == null ? '–' : (timing > 0 ? '+' : '') + timing.toFixed(1) + ' %'}`, timing == null ? '' : timing <= 0 ? 'up' : 'down'),
      _fuelKpi('Market-based', eM[0], eM[1], o.factorRest == null ? _c('il faut un facteur de mix résiduel', 'needs a residual mix factor') : `${f1(o.emMarket / o.E)} g/kWh`),
      _fuelKpi('Spot cost', f2(o.costAvg), '€/MWh', shape == null ? '' : `${shape > 0 ? '+' : ''}${shape.toFixed(1)} % ${_c('vs base', 'vs baseload')} · ${eur(o.cost)}`, shape == null ? '' : shape > 0 ? 'down' : 'up'),
      _fuelKpi('Renewable coverage', o.coverage ? Math.round(o.coverage * 100) : '0', '%', o.hourly != null ? _c(`heure par heure ${pc(o.hourly)}`, `hour by hour ${pc(o.hourly)}`) : 'GOs + PPA, annual volume', o.coverage >= 0.999 ? 'up' : ''),
    ].join('');
    words(o);
    summary(o, timing, shape);
    const ms = Object.keys(o.monthly).sort();
    _fuelChart('cf-monthly-ov', { type: 'bar', data: { labels: ms.map(m => MON[+m.slice(5) - 1] + ' ' + m.slice(2, 4)), datasets: [
      { label: 'Consumption (MWh)', data: ms.map(m => +(o.monthly[m].E / 1000).toFixed(2)), backgroundColor: 'rgba(127,200,248,.55)', borderRadius: 3, yAxisID: 'y' },
      { type: 'line', label: 'Emissions, location-based (t CO₂)', data: ms.map(m => +(o.monthly[m].em / 1e6).toFixed(3)), borderColor: '#A87DC4', borderWidth: 2, pointRadius: 3, yAxisID: 'y1' },
      { type: 'line', label: 'Spot cost (k€)', data: ms.map(m => +(o.monthly[m].cost / 1000).toFixed(2)), borderColor: '#FBBF24', borderWidth: 1.6, borderDash: [5, 4], pointRadius: 2, yAxisID: 'y2' },
    ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: xCat(), y: _fuelAxis('MWh', { beginAtZero: true }), y1: _fuelAxis('t CO₂', { position: 'right', beginAtZero: true, grid: { display: false } }), y2: { display: false, beginAtZero: true } } }) }, 'carbon-monthly-overview');
  }

  // ── Consumption ───────────────────────────────────────────────────
  function renderConsumption(o) {
    heat('cf-hm-kw', o.mh.map(m => [...m.e].map((v, h) => m.n[h] ? v / m.n[h] : null)), 'kW', [[30, 70, 110], [127, 200, 248]]);
    const H = HRS, wd = [...o.wk.wd].map(v => o.wk.nwd ? v / o.wk.nwd : null), we = [...o.wk.we].map(v => o.wk.nwe ? v / o.wk.nwe : null);   // kWh in that hour per day = average kW
    // kWh per hour per day = average kW of that hour
    _fuelChart('cf-week', { type: 'line', data: { labels: H, datasets: [
      { label: 'Working days (Mon–Fri)', data: wd.map(v => v == null ? null : Math.round(v)), borderColor: '#7FC8F8', borderWidth: 2.4, pointRadius: 0, tension: .3, fill: false },
      { label: 'Weekends', data: we.map(v => v == null ? null : Math.round(v)), borderColor: '#A87DC4', borderWidth: 2, pointRadius: 0, tension: .3, borderDash: [5, 4], fill: false },
      { label: 'Base load', data: H.map(() => Math.round(o.baseKW)), borderColor: 'rgba(184,201,217,.6)', borderWidth: 1, borderDash: [2, 3], pointRadius: 0, fill: false },
    ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: _fuelXAxis(), y: _fuelAxis('kW (average)', { beginAtZero: true }) } }) }, 'carbon-weekday-weekend');
    const L = o.duration.map((_, i) => Math.round(i / (o.duration.length - 1) * 100) + ' %');
    _fuelChart('cf-duration', { type: 'line', data: { labels: L, datasets: [
      { label: 'Power, sorted from the highest quarter-hour', data: o.duration.map(v => Math.round(v)), borderColor: '#7FC8F8', backgroundColor: 'rgba(127,200,248,.15)', fill: 'origin', borderWidth: 2, pointRadius: 0 },
      { label: _c(`Pointe ${f0(o.peak.v)} kW`, `Peak ${f0(o.peak.v)} kW`), data: L.map(() => Math.round(o.peak.v)), borderColor: '#ED6965', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0, fill: false },
      { label: _c(`95 % du temps sous ${f0(o.p95)} kW`, `95 % of the time below ${f0(o.p95)} kW`), data: L.map(() => Math.round(o.p95)), borderColor: '#FBBF24', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0, fill: false },
      { label: _c(`Talon ${f0(o.baseKW)} kW`, `Base load ${f0(o.baseKW)} kW`), data: L.map(() => Math.round(o.baseKW)), borderColor: '#14D3A9', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0, fill: false },
    ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: Object.assign(_fuelXAxis(), { title: { display: true, text: 'share of the time', color: C_TX3, font: { size: 10 } } }), y: _fuelAxis('kW', { beginAtZero: true }) } }) }, 'carbon-load-duration');
    $('cf-duration-note').textContent = _c(`L’écart entre la pointe (${f0(o.peak.v)} kW) et le niveau dépassé seulement 5 % du temps (${f0(o.p95)} kW) montre de combien la puissance souscrite pourrait baisser en écrêtant les pointes rares. Facteur de charge ${pc(o.loadFactor)} : moyenne ÷ pointe.`,
      `The gap between the peak (${f0(o.peak.v)} kW) and the level exceeded only 5 % of the time (${f0(o.p95)} kW) shows how much the contracted power could be lowered by trimming rare peaks. Load factor ${pc(o.loadFactor)}: average ÷ peak.`);
  }

  // ── Carbon ────────────────────────────────────────────────────────
  function renderCarbon(o) {
    const L = o.daily.map(x => x.d);
    _fuelChart('cf-daily', { type: 'bar', data: { labels: L, datasets: [
      { label: 'Consumption (MWh)', data: o.daily.map(x => x.E / 1000), backgroundColor: 'rgba(127,200,248,.45)', borderWidth: 0, yAxisID: 'y' },
      { type: 'line', label: 'Carbon intensity of your consumption (g/kWh)', data: o.daily.map(x => x.ci == null ? null : Math.round(x.ci * 10) / 10), borderColor: '#A87DC4', borderWidth: 1.6, pointRadius: 0, tension: 0.2, yAxisID: 'y1' },
    ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: _fuelXAxis(), y: _fuelAxis('MWh', { beginAtZero: true }), y1: _fuelAxis('g CO₂/kWh', { position: 'right', beginAtZero: true, grid: { display: false } }) } }) }, 'carbon-daily');
    const nd = o.days.length;
    _fuelChart('cf-hours', { type: 'bar', data: { labels: HRS, datasets: [
      { label: 'Average consumption (kWh per hour)', data: [...o.hourC].map(v => Math.round(v / nd)), backgroundColor: 'rgba(127,200,248,.45)', borderWidth: 0, yAxisID: 'y' },
      { type: 'line', label: 'Grid intensity when you consume (g/kWh)', data: [...o.hourI].map((v, h) => o.hourN[h] ? Math.round(v / o.hourN[h] * 10) / 10 : null), borderColor: '#A87DC4', borderWidth: 1.8, pointRadius: 0, tension: 0.3, yAxisID: 'y1' },
    ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: _fuelXAxis(), y: _fuelAxis('kWh', { beginAtZero: true }), y1: _fuelAxis('g CO₂/kWh', { position: 'right', beginAtZero: true, grid: { display: false } }) } }) }, 'carbon-average-day');
    heat('cf-hm-ci', o.mh.map(m => [...m.ci].map((v, h) => m.cn[h] ? v / m.cn[h] : null)), 'g/kWh', [[20, 120, 100], [168, 125, 196]]);
    const tot = MIX.reduce((s, [k]) => s + o.mix[k], 0) || 1;
    const mix = MIX.map(([k, l, c]) => [l, o.mix[k] / tot * 100, c]).filter(x => x[1] > 0.05).sort((a, b) => b[1] - a[1]);
    _fuelChart('cf-mix', { type: 'bar', data: { labels: mix.map(x => x[0]), datasets: [{ label: 'Share of your consumption (%)', data: mix.map(x => Math.round(x[1] * 10) / 10), backgroundColor: mix.map(x => x[2]), borderWidth: 0, borderRadius: 3 }] },
      options: _fuelOpts({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: _fuelAxis('%', { beginAtZero: true }), y: { grid: { display: false }, ticks: { color: C_TX2, font: { size: 11 } } } } }) }, 'carbon-mix');
    const ms = Object.keys(o.monthly).sort(), share = o.E ? 1 - o.covered * 1000 / o.E : 1;
    _fuelChart('cf-monthly', { type: 'bar', data: { labels: ms.map(m => MON[+m.slice(5) - 1] + ' ' + m.slice(2, 4)), datasets: [
      { label: 'Location-based (t CO₂)', data: ms.map(m => +(o.monthly[m].em / 1e6).toFixed(3)), backgroundColor: 'rgba(168,125,196,.75)', borderRadius: 3 },
      { label: 'Market-based (t CO₂)', data: ms.map(m => o.factorRest == null ? null : +(o.monthly[m].E * share * o.factorRest / 1e6).toFixed(3)), backgroundColor: 'rgba(20,211,169,.7)', borderRadius: 3 },
    ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: xCat(), y: _fuelAxis('t CO₂', { beginAtZero: true }) } }) }, 'carbon-monthly');
  }

  // ── Cost & flexibility ────────────────────────────────────────────
  function renderCost(o) {
    const ms = Object.keys(o.monthly).sort();
    _fuelChart('cf-cost-m', { type: 'bar', data: { labels: ms.map(m => MON[+m.slice(5) - 1] + ' ' + m.slice(2, 4)), datasets: [
      { label: 'Energy cost on the spot (k€)', data: ms.map(m => +(o.monthly[m].cost / 1000).toFixed(2)), backgroundColor: 'rgba(251,191,36,.6)', borderRadius: 3, yAxisID: 'y' },
      { type: 'line', label: 'Your price (€/MWh)', data: ms.map(m => o.monthly[m].Ep ? +(o.monthly[m].cost / (o.monthly[m].Ep / 1000)).toFixed(2) : null), borderColor: '#ED6965', borderWidth: 2, pointRadius: 3, yAxisID: 'y1' },
    ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: xCat(), y: _fuelAxis('k€', { beginAtZero: true }), y1: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }) } }) }, 'carbon-cost-monthly');
    const nd = o.days.length;
    _fuelChart('cf-cost-h', { type: 'bar', data: { labels: HRS, datasets: [
      { label: 'Average consumption (kWh per hour)', data: [...o.hourC].map(v => Math.round(v / nd)), backgroundColor: 'rgba(127,200,248,.45)', borderWidth: 0, yAxisID: 'y' },
      { type: 'line', label: 'Average day-ahead price (€/MWh)', data: [...o.hourP].map((v, h) => o.hourPn[h] ? Math.round(v / o.hourPn[h] * 10) / 10 : null), borderColor: '#FBBF24', borderWidth: 2, pointRadius: 0, tension: .3, yAxisID: 'y1' },
    ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: _fuelXAxis(), y: _fuelAxis('kWh', { beginAtZero: true }), y1: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }) } }) }, 'carbon-cost-hours');
    const cp = o.capacity, ce = $('cf-cap-kpis');
    if (ce) ce.innerHTML = cp ? [
      _fuelKpi('Capacity cost', eur(cp.cost), '', _c(`${f1(cp.mw * 1000)} kW en moyenne sur les plages de pointe × 18 647 €/MW (hiver 2026-27)`, `${f1(cp.mw * 1000)} kW average in the peak windows × 18,647 €/MW (winter 2026-27)`)),
      _fuelKpi('Peak vs average', cp.avgMW ? (cp.mw / cp.avgMW * 100).toFixed(0) : '–', '%', 'your load in the peak windows ÷ your average load', cp.mw > cp.avgMW ? 'down' : 'up'),
      _fuelKpi('Saving per kW cut', f1(CAP_PRICE / 1000), '€', _c(`chaque kW de moins sur les plages des ${cp.days.length} jours de pointe, chaque hiver`, `each kW less in the ${cp.days.length} peak days' windows, every winter`)),
    ].join('') + `<div class="fuel-note" style="grid-column:1/-1">${_c(`Plages de pointe : 07h–10h et 17h–20h les jours de pointe d’hiver de RTE (jusqu’à 22 par hiver, annoncés la veille). La liste de RTE n’est pas publique ici : les ${cp.days.length} jours ouvrés de plus forte consommation nationale dans vos données en tiennent lieu`, `Peak windows: 07:00–10:00 and 17:00–20:00 on RTE's winter peak days (up to 22 per winter, announced the day before). RTE's own list is not public here: the ${cp.days.length} weekdays of highest national consumption in your data stand in for them`)} (${cp.days.slice(0, 6).join(', ')}${cp.days.length > 6 ? '…' : ''}).</div>` : `<div class="fuel-note" style="grid-column:1/-1">${_c('Aucun jour ouvré d’hiver (novembre à mars) dans vos données : le coût de capacité en a besoin.', 'No winter weekday (November to March) in your data: the capacity cost needs one.')}</div>`;
    renderFixed(o);
    const fx = o.flex, pct = +S.settings.flexPct || 0;
    $('cf-flex-kpis').innerHTML = [
      _fuelKpi('Energy moved', MWh(fx.moved), '', _c(`${pct} % de chaque jour, même jour, sans nouvelle pointe`, `${pct} % of each day, same day, no new peak`)),
      _fuelKpi('Saving on the spot', eur(fx.save), '', o.cost ? _c(`${(fx.save / o.cost * 100).toFixed(1)} % du coût de l’énergie`, `${(fx.save / o.cost * 100).toFixed(1)} % of the energy cost`) : '', fx.save > 0 ? 'up' : ''),
      _fuelKpi('Emissions change', (fx.dCO2 > 0 ? '+' : '') + f0(fx.dCO2 / 1000), 'kg CO₂', o.em ? `${(fx.dCO2 / o.em * 100).toFixed(1)} % ${_c('en location-based', 'location-based')}` : '', fx.dCO2 < 0 ? 'up' : fx.dCO2 > 0 ? 'down' : ''),
    ].join('');
    _fuelChart('cf-flex', { type: 'line', data: { labels: HRS, datasets: [
      { label: 'Today: average kWh per hour', data: fx.before.map(v => Math.round(v)), borderColor: 'rgba(127,200,248,.8)', borderWidth: 2, pointRadius: 0, tension: .3, fill: false },
      { label: _c(`Après décalage de ${pct} %`, `After moving ${pct} %`), data: fx.after.map(v => Math.round(v)), borderColor: '#14D3A9', borderWidth: 2.4, pointRadius: 0, tension: .3, fill: { target: 0, above: 'rgba(20,211,169,.15)', below: 'rgba(237,105,101,.15)' } },
    ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: _fuelXAxis(), y: _fuelAxis('kWh per hour', { beginAtZero: true }) } }) }, 'carbon-flexibility');
  }

  // ── Solar & coverage ──────────────────────────────────────────────
  function renderSolar(o) {
    const pv = o.pv, kwp = +S.settings.pvKwp || 0;
    $('cf-pv-hint').textContent = _c(`Point de départ suggéré : ${f0(o.pvHint)} kWc (votre puissance moyenne). France : environ 1 000 kWh/kWc/an au nord à 1 400 au sud.`, `Suggested starting point: ${f0(o.pvHint)} kWp (your average load). France: about 1,000 kWh/kWp/yr in the north to 1,400 in the south.`);
    if (!kwp) {
      $('cf-pv-kpis').innerHTML = '<div class="fuel-note" style="grid-column:1/-1">Enter a size in kWp to simulate an installation on your site.</div>';
      ['cf-pv-day', 'cf-pv-m'].forEach(id => noDataMsg(id, 'Enter an installation size (kWp)', 'The production follows the national solar profile of the same days (RTE)'));
    } else {
      $('cf-pv-kpis').innerHTML = [
        _fuelKpi('Production', MWh(pv.prod), '', _c(`${f0(kwp)} kWc × ${f0(+S.settings.pvYield || 1150)} kWh/kWc/an`, `${f0(kwp)} kWp × ${f0(+S.settings.pvYield || 1150)} kWh/kWp/yr`)),
        _fuelKpi('Self-consumed', pc(pv.prod ? pv.self / pv.prod : null), '', MWh(pv.self) + _c(' utilisés sur site', ' used on site')),
        _fuelKpi('Coverage of your needs', pc(o.E ? pv.self / o.E : null), '', 'self-sufficiency'),
        _fuelKpi('Spot value', eur(pv.valSelf), '', _c(`achats évités · surplus valant ${eur(pv.valSurplus)}`, `avoided purchases · surplus worth ${eur(pv.valSurplus)}`), 'up'),
        _fuelKpi('CO₂ avoided', em(pv.co2, pv.co2 < 1e6).join(' '), '', 'location-based, on self-consumption', 'up'),
      ].join('');
      _fuelChart('cf-pv-day', { type: 'line', data: { labels: HRS, datasets: [
        { label: 'Self-consumed solar', data: pv.hourS.map(v => Math.round(v)), borderColor: 'rgba(251,191,36,.9)', backgroundColor: 'rgba(251,191,36,.35)', fill: 'origin', borderWidth: 0, pointRadius: 0, tension: .3 },
        { label: 'Solar production', data: pv.hourP.map(v => Math.round(v)), borderColor: '#FBBF24', borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: .3, fill: false },
        { label: 'Your consumption', data: pv.hourC.map(v => Math.round(v)), borderColor: '#7FC8F8', borderWidth: 2.4, pointRadius: 0, tension: .3, fill: false },
      ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: _fuelXAxis(), y: _fuelAxis('kWh per hour (average day)', { beginAtZero: true }) } }) }, 'carbon-solar-day');
      const ms = Object.keys(pv.monthly).sort();
      _fuelChart('cf-pv-m', { type: 'bar', data: { labels: ms.map(m => MON[+m.slice(5) - 1] + ' ' + m.slice(2, 4)), datasets: [
        { label: 'Self-sufficiency (% of consumption)', data: ms.map(m => pv.monthly[m].E ? Math.round(pv.monthly[m].self / pv.monthly[m].E * 1000) / 10 : null), backgroundColor: 'rgba(251,191,36,.7)', borderRadius: 3 },
        { label: 'Self-consumption (% of production)', data: ms.map(m => pv.monthly[m].prod ? Math.round(pv.monthly[m].self / pv.monthly[m].prod * 1000) / 10 : null), backgroundColor: 'rgba(20,211,169,.6)', borderRadius: 3 },
      ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: xCat(), y: _fuelAxis('%', { beginAtZero: true, max: 100 }) } }) }, 'carbon-solar-monthly');
    }
    // PPA / GO coverage hour by hour
    const nd = o.days.length;
    if (o.ppaMWh) {
      _fuelChart('cf-ppa-chart', { type: 'bar', data: { labels: HRS, datasets: [
        { label: 'Your consumption (kWh per hour)', data: [...o.hourC].map(v => Math.round(v / nd)), backgroundColor: 'rgba(127,200,248,.45)', borderWidth: 0 },
        { type: 'line', label: S.settings.ppaTech === 'wind' ? _c('Production du PPA éolien (kWh par heure)', 'Wind PPA output (kWh per hour)') : _c('Production du PPA solaire (kWh par heure)', 'Solar PPA output (kWh per hour)'), data: [...o.ppa.prof].map(v => Math.round(v / nd)), borderColor: S.settings.ppaTech === 'wind' ? '#14D3A9' : '#FBBF24', borderWidth: 2.4, pointRadius: 0, tension: .3, fill: false },
      ] }, options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: _fuelXAxis(), y: _fuelAxis('kWh', { beginAtZero: true }) } }) }, 'carbon-ppa-hours');
      $('cf-ppa-note').textContent = _c(`Couverture en volume annuel ${pc(o.coverage)} ; heure par heure, seulement ${pc(o.hourly)} de votre consommation est couverte par la production du PPA au même moment (vue 24/7), ${MWh(o.ppa.surplus)} de production du PPA dépassent vos besoins au moment où ils sont produits.`,
        `Annual volume coverage ${pc(o.coverage)}; hour by hour only ${pc(o.hourly)} of your consumption is matched by the PPA output at the same time (24/7 view), ${MWh(o.ppa.surplus)} of PPA output exceed your needs at the time they are produced.`);
    } else { noDataMsg('cf-ppa-chart', 'No PPA volume entered', 'Enter a renewable PPA volume in “Your contracts” to see its hour-by-hour coverage'); $('cf-ppa-note').textContent = ''; }
  }


  // ── Explorer: one matrix, a measure to choose, a click on a cell, a row, a column or a calendar day opens its detail ──
  const EX = { metric: 'ci', grid: 'mh' };
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const EXM = {
    kw: ['Your power', 'kW', c => c.n ? c.E / (c.n / 4) : null, [[30, 70, 110], [127, 200, 248]]],
    ci: ['Grid carbon intensity', 'g/kWh', c => c.cin ? c.ci / c.cin : null, [[20, 120, 100], [168, 125, 196]]],
    em: ['Your emissions', 'kg CO₂', c => c.E ? c.em / 1000 : null, [[40, 40, 70], [168, 125, 196]]],
    p: ['Day-ahead price', '€/MWh', c => c.pn ? c.p / c.pn : null, [[30, 90, 80], [251, 191, 36]]],
    cost: ['Your spot cost', '€', c => c.Ep ? c.cost : null, [[40, 60, 40], [251, 191, 36]]],
    share: ['Share of your consumption', '%', (c, tot) => tot ? c.E / tot * 100 : null, [[30, 70, 110], [127, 200, 248]]],
  };
  const exKey = (grid, d, q) => grid === 'mh' ? [+d.slice(5, 7) - 1, q >> 2] : [(dow(d) + 6) % 7, q >> 2];
  function exAgg(o, pred) {
    const c = { E: 0, n: 0, ci: 0, cin: 0, em: 0, p: 0, pn: 0, cost: 0, Ep: 0, mix: {}, days: new Set() };
    o.rows.forEach(({ d, e, r, p }) => { for (let q = 0; q < 96; q++) { if (!pred(d, q)) continue;
      const x = e[q] || 0, ci = r && r.co2 ? r.co2[q] : null, pr = p ? p[q] : null; c.E += x; c.n++; c.days.add(d);
      if (ci != null) { c.ci += ci; c.cin++; c.em += x * ci; let t = 0; const sh = {}; MIX.forEach(([k]) => { const v = r[k] ? Math.max(0, r[k][q] || 0) : 0; sh[k] = v; t += v; }); if (t > 0) MIX.forEach(([k]) => { c.mix[k] = (c.mix[k] || 0) + sh[k] / t; }); }
      if (pr != null) { c.p += pr; c.pn++; c.cost += x / 1000 * pr; c.Ep += x; } } });
    return c;
  }
  function renderExplore(o) {
    const host = $('cf-ex'); if (!host) return;
    const rows = EX.grid === 'mh' ? 12 : 7, G = [...Array(rows)].map(() => [...Array(24)].map(() => ({ E: 0, n: 0, ci: 0, cin: 0, em: 0, p: 0, pn: 0, cost: 0, Ep: 0 })));
    o.rows.forEach(({ d, e, r, p }) => { for (let q = 0; q < 96; q++) { const [a, h] = exKey(EX.grid, d, q), c = G[a][h], x = e[q] || 0, ci = r && r.co2 ? r.co2[q] : null, pr = p ? p[q] : null;
      c.E += x; c.n++; if (ci != null) { c.ci += ci; c.cin++; c.em += x * ci; } if (pr != null) { c.p += pr; c.pn++; c.cost += x / 1000 * pr; c.Ep += x; } } });
    const [name, unit, fn, pal] = EXM[EX.metric], V = G.map(row => row.map(c => c.n ? fn(c, o.E) : null));
    const vals = V.flat().filter(v => v != null), lo = Math.min(...vals), hi = Math.max(...vals);
    const col = v => { if (v == null) return 'transparent'; const x = hi > lo ? (v - lo) / (hi - lo) : 0.5; const [a, b] = pal; const c = a.map((ai, i) => Math.round(ai + (b[i] - ai) * x)); return `rgba(${c[0]},${c[1]},${c[2]},${(0.18 + 0.82 * x).toFixed(2)})`; };
    const fmt = v => v == null ? '' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-GB') : v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
    const lab = EX.grid === 'mh' ? MON : DOW;
    host.innerHTML = `<div class="cf-hm cf-ex"><table><thead><tr><th></th>${HRS.map((h, i) => `<th data-h="${i}" title="${_c(`Clic : toutes les ${h} de la période`, `Click: every ${h} of the period`)}">${i % 3 ? '' : h}</th>`).join('')}</tr></thead><tbody>` +
      V.map((row, a) => row.every(v => v == null) ? '' : `<tr><th data-a="${a}" title="${_c(`Clic : tout ${lab[a]}`, `Click: the whole of ${lab[a]}`)}">${lab[a]}</th>${row.map((v, h) => `<td data-a="${a}" data-h="${h}" style="background:${col(v)}" title="${lab[a]} ${HRS[h]}: ${v == null ? '–' : fmt(v) + ' ' + unit} · ${_c('clic pour le détail', 'click for the detail')}">${fmt(v)}</td>`).join('')}</tr>`).join('') +
      `</tbody></table></div><div class="cf-hm-leg"><span>${fmt(lo)} ${unit}</span><i style="background:linear-gradient(90deg,${col(lo)},${col(hi)})"></i><span>${fmt(hi)} ${unit}</span><span style="margin-left:auto">${name} · ${_c(`cliquez une case, un ${EX.grid === 'mh' ? 'mois' : 'jour de la semaine'}, une heure ou un jour du calendrier`, `click a cell, a ${EX.grid === 'mh' ? 'month' : 'day of the week'}, an hour, or a day of the calendar`)}</span></div>`;
    host.querySelectorAll('td[data-a], th[data-a], th[data-h]').forEach(el => el.addEventListener('click', () => {
      host.querySelectorAll('.cf-ex-on').forEach(x => x.classList.remove('cf-ex-on')); el.classList.add('cf-ex-on');
      const a = el.dataset.a != null ? +el.dataset.a : null, h = el.dataset.h != null ? +el.dataset.h : null;
      exDetail(o, a, h);
    }));
  }
  function exDetail(o, a, h) {
    const box = $('cf-ex-detail'); if (!box) return;
    const lab = EX.grid === 'mh' ? MON : DOW, inRow = (d) => a == null || exKey(EX.grid, d, 0)[0] === a;
    const pred = (d, q) => inRow(d) && (h == null || (q >> 2) === h);
    const c = exAgg(o, pred);
    const title = a != null && h != null ? `${lab[a]} · ${HRS[h]}` : a != null ? `${EX.grid === 'mh' ? _c('Mois', 'Month') : _c('Tous les', 'Every')} ${lab[a]}` : `${_c('Toutes les', 'Every')} ${HRS[h]}`;
    const ciMine = c.E && c.cin ? c.em / c.E : null, pAvg = c.pn ? c.p / c.pn : null;
    const mixT = Object.values(c.mix).reduce((s, x) => s + x, 0) || 1;
    let shift = '';
    if (h != null && c.E > 0) {   // the same days, other hours: where would 10 % of this consumption be greener, cheaper
      const hrs = [...Array(24).keys()].map(k => k === h ? null : exAgg(o, (d, q) => inRow(d) && (q >> 2) === k));
      const best = (f) => hrs.map((x, k) => x && f(x) != null ? [k, f(x)] : null).filter(Boolean).sort((u, v) => u[1] - v[1])[0];
      const bc = best(x => x.cin ? x.ci / x.cin : null), bp = best(x => x.pn ? x.p / x.pn : null), mv = c.E * (S.settings.flexPct || 10) / 100;
      const gCI = c.cin && bc ? mv * (c.ci / c.cin - bc[1]) / 1000 : null, gP = pAvg != null && bp ? mv / 1000 * (pAvg - bp[1]) : null;
      shift = `<div class="cf-ex-tip"><b>${_c('En décaler', 'Moving')} ${S.settings.flexPct || 10} %${_c('', ' of it')}</b> (${MWh(mv)})<br>${_c('vers', 'to')} ${HRS[bc ? bc[0] : 0]}, ${a != null ? _c('l’heure la moins carbonée des mêmes jours', 'the cleanest hour of the same days') : _c('l’heure la moins carbonée de la période', 'the cleanest hour of the same period')} : <b>${gCI == null ? '–' : Math.abs(gCI) < 1 ? '≈ 0 kg CO₂' : (gCI >= 0 ? '−' : '+') + f0(Math.abs(gCI)) + ' kg CO₂'}</b><br>${_c('vers', 'to')} ${HRS[bp ? bp[0] : 0]}, ${_c('la moins chère', 'the cheapest')} : <b>${gP == null ? '–' : Math.abs(gP) < 1 ? '≈ 0 €' : (gP >= 0 ? '−' : '+') + eur(Math.abs(gP))}</b><div style="color:var(--text3);font-size:10px;margin-top:4px">${_c('Aux conditions moyennes de ces heures ; un vrai décalage dépend aussi de ce que le procédé permet.', 'At the average conditions of those hours; a real shift also depends on what the process allows.')}</div></div>`;
    }
    box.innerHTML = `<div class="table-title" style="margin-bottom:6px">${title}</div>
      <div class="cf-ex-kv"><span>Consumption</span><b>${MWh(c.E)}</b><span>${c.n ? f0(c.E / (c.n / 4)) + _c(' kW en moyenne', ' kW on average') : ''} · ${pc(o.E ? c.E / o.E : null)} ${_c('du total', 'of the total')}</span>
      <span>Grid intensity</span><b>${c.cin ? f0(c.ci / c.cin) + ' g/kWh' : '–'}</b><span>${ciMine != null && o.ciHourly ? (ciMine > o.ciHourly ? '+' : '') + Math.round((ciMine / o.ciHourly - 1) * 100) + _c(' % vs votre moyenne', ' % vs your average') : ''}</span>
      <span>Your emissions</span><b>${em(c.em, c.em < 1e6).join(' ')}</b><span>${pc(o.em ? c.em / o.em : null)} ${_c('du total', 'of the total')}</span>
      <span>Day-ahead price</span><b>${pAvg == null ? '–' : f2(pAvg) + ' €/MWh'}</b><span>${pAvg != null && o.costAvg ? (pAvg > o.costAvg ? '+' : '') + Math.round((pAvg / o.costAvg - 1) * 100) + _c(' % vs votre moyenne', ' % vs your average') : ''}</span>
      <span>Your spot cost</span><b>${c.Ep ? eur(c.cost) : '–'}</b><span>${c.days.size} ${_c('jours', 'days')}</span></div>
      <div class="cf-ex-mix">${MIX.filter(([k]) => (c.mix[k] || 0) / mixT > 0.005).map(([k, n, colr]) => `<i style="flex:${(c.mix[k] / mixT).toFixed(3)};background:${colr}" title="${n} ${pc(c.mix[k] / mixT)}"></i>`).join('')}</div>
      <div class="cf-ex-mixl">${MIX.filter(([k]) => (c.mix[k] || 0) / mixT > 0.02).map(([k, n, colr]) => `<span><i style="background:${colr}"></i>${n} ${pc(c.mix[k] / mixT)}</span>`).join('')}</div>${shift}`;
  }
  function exDay(o, d) {
    const box = $('cf-ex-detail'), row = o.rows.find(x => x.d === d); if (!box || !row) return;
    const { e, r, p } = row, L = [...Array(96).keys()].map(q => q % 4 ? '' : HRS[q >> 2]);
    const E = e.reduce((s, x) => s + (x || 0), 0), emD = e.reduce((s, x, q) => s + (x || 0) * (r && r.co2 && r.co2[q] != null ? r.co2[q] : 0), 0);
    box.innerHTML = `<div class="table-title" style="margin-bottom:6px">${new Date(d + 'T12:00:00Z').toLocaleDateString(_c('fr-FR', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div class="cf-ex-kv"><span>Consumption</span><b>${MWh(E)}</b><span>${_c('pointe', 'peak')} ${f0(Math.max(...e.map(x => (x || 0) * 4)))} kW</span><span>Emissions</span><b>${em(emD, emD < 1e6).join(' ')}</b><span>${E ? f0(emD / E) + ' g/kWh' : ''}</span></div>
      <div style="position:relative;height:200px"><canvas id="cf-ex-day" style="width:100%;height:200px"></canvas></div>`;
    _fuelChart('cf-ex-day', { type: 'bar', data: { labels: L, datasets: [
      { label: 'Your power (kW)', data: e.map(x => Math.round((x || 0) * 4)), backgroundColor: 'rgba(127,200,248,.5)', yAxisID: 'y' },
      { type: 'line', label: 'Grid g/kWh', data: r && r.co2 ? r.co2.map(v => v == null ? null : Math.round(v)) : [], borderColor: '#A87DC4', borderWidth: 1.6, pointRadius: 0, yAxisID: 'y1' },
      { type: 'line', label: 'Price €/MWh', data: p ? p.map(v => v == null ? null : +(+v).toFixed(1)) : [], borderColor: '#FBBF24', borderWidth: 1.4, borderDash: [4, 3], pointRadius: 0, yAxisID: 'y2' }] },
      options: _fuelOpts({ plugins: { legend: legend() }, scales: { x: _fuelXAxis(), y: _fuelAxis('kW', { beginAtZero: true }), y1: _fuelAxis('g/kWh', { position: 'right', grid: { display: false } }), y2: { display: false } } }) }, 'carbon-day-detail');
  }
  // ── Green days calendar (Carbon tab) and 24/7 coverage (Solar & coverage tab) ──
  function renderCalendar(o) {
    const host = $('cf-cal'); if (!host) return;
    const days = o.daily.filter(x => x.ci != null);
    if (!days.length) { host.innerHTML = ''; return; }
    const sorted = days.map(x => x.ci).sort((a, b) => a - b), q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const cuts = [q(0.2), q(0.4), q(0.6), q(0.8)], COLS = ['#0E7C5A', '#14D3A9', '#FBBF24', '#F2A65A', '#ED6965'];
    const col = v => COLS[cuts.findIndex(c => v <= c) < 0 ? 4 : cuts.findIndex(c => v <= c)];
    const byDay = new Map(days.map(x => [x.d, x]));
    const first = new Date(days[0].d + 'T12:00:00Z'), pad = (first.getUTCDay() + 6) % 7;
    let html = '<div class="cf-cal">' + '<i style="visibility:hidden"></i>'.repeat(pad);
    for (let t = new Date(first); t <= new Date(days[days.length - 1].d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1)) {
      const d = t.toISOString().slice(0, 10), x = byDay.get(d);
      html += x ? `<i data-d="${d}" style="background:${col(x.ci)};cursor:pointer" title="${d} · ${f0(x.ci)} g/kWh · ${f1(x.E / 1000)} MWh · ${_c('clic pour le jour', 'click for the day')}"></i>` : `<i title="${d} · ${_c('pas de données', 'no data')}"></i>`;
    }
    const best = days.slice().sort((a, b) => a.ci - b.ci)[0], worst = days.slice().sort((a, b) => b.ci - a.ci)[0];
    host.innerHTML = html + '</div><div class="cf-cal-leg">' + _c('moins carboné ', 'cleaner ') + COLS.map(c => `<i style="background:${c}"></i>`).join('') + _c(` plus carboné · quintiles de vos jours : `, ` dirtier · quintiles of your days: `) + `${cuts.map(c => f0(c)).join(' / ')} g/kWh</div>`;
    // how to read it (note 50)
    host.insertAdjacentHTML('beforeend', '<div class="fuel-note" style="margin-top:8px">' + _c('<b>Comment le lire</b> : chaque carré est un jour de votre consommation. Sa couleur dit combien de CO₂ chaque kWh a émis ce jour-là, heure par heure, pondéré par votre consommation : vert = électricité surtout nucléaire, hydraulique et renouvelable ; rouge = plus de gaz, de charbon ou d’imports. Les couleurs comparent vos jours entre eux (cinq groupes égaux). Usage : repérer les périodes vertes et y décaler ce qui peut l’être. Cliquer un jour pour son détail heure par heure.',
      '<b>How to read it</b>: each square is one day of your consumption. Its colour says how much CO₂ each kWh emitted that day, hour by hour, weighted by your consumption: green = mostly nuclear, hydro and renewable power; red = more gas, coal or imports. The colours compare your days with each other (five equal groups). Use: spot the green periods and shift what can be shifted into them. Click a day for its hour-by-hour detail.') + '</div>');
    host.querySelectorAll('i[data-d]').forEach(el => el.addEventListener('click', () => { exDay(o, el.dataset.d); const b = $('cf-ex-detail'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }));
    $('cf-cal-sub').textContent = _c(`Un carré par jour (semaines en colonnes, lundi en haut) · le plus vert ${best.d} (${f0(best.ci)} g/kWh), le plus carboné ${worst.d} (${f0(worst.ci)} g/kWh)`, `One square per day (weeks in columns, Monday on top) · greenest ${best.d} (${f0(best.ci)} g/kWh), most carbon-intensive ${worst.d} (${f0(worst.ci)} g/kWh)`);
  }
  function render247(o) {
    const host = $('cf-247'); if (!host) return;
    const pv = o.pv || {}, matched = (o.ppa.match || 0) + (pv.self || 0), annual = Math.min(o.E, (+S.settings.go || 0) * 1000 + (+S.settings.ppa || 0) * 1000 + (pv.self || 0));
    host.innerHTML = [
      _fuelKpi('24/7 score', o.E ? (Math.min(1, matched / o.E) * 100).toFixed(1) : '–', '%', 'consumption matched hour by hour by your PPA and on-site solar'),
      _fuelKpi('Annual matching', o.E ? (annual / o.E * 100).toFixed(1) : '–', '%', 'the same contracts counted over the year (GO included), the usual claim'),
      _fuelKpi('Gap', o.E ? ((annual - Math.min(annual, matched)) / o.E * 100).toFixed(1) : '–', 'pts', 'what annual matching claims beyond hour-by-hour reality'),
    ].join('') + '<div class="fuel-note" style="grid-column:1/-1">' + _c('Couverture 24/7, telle que Google et le 24/7 Carbon-Free Energy Compact la comptent : une heure n’est couverte que par de la production renouvelable de cette même heure. Les garanties d’origine sont des certificats annuels : elles comptent dans la couverture annuelle, pas en 24/7.', '24/7 matching, as Google and the 24/7 Carbon-Free Energy Compact count it: an hour is covered only by renewable production of that same hour. Guarantees of origin are yearly certificates: they count in annual matching, not in 24/7.') + '</div>';
  }

  function renderFixed(o) {
    const host = $('cf-fix'); if (!host) return;
    const x = o.fixed;
    if (!x) { host.innerHTML = `<div class="fuel-note">${_c('Prix à terme indisponibles : le prix fixe ne peut pas être calculé.', 'Forward prices not available: the fixed price cannot be computed.')}</div>`; return; }
    if (x.missing) { host.innerHTML = `<div class="fuel-note">${_c(`Pas de prix à terme ou d’historique de prix pour ${esc(x.missing)} : choisissez une autre période.`, `No forward price or price history for ${esc(x.missing)}: pick another period.`)}</div>`; return; }
    const lbl = { cal1: 'Cal ' + x.months[0].k.slice(0, 4), cal2: 'Cal ' + x.months[0].k.slice(0, 4), next12: _c('12 prochains mois', 'next 12 months') }[x.period];
    const pct1 = v => (v * 100).toFixed(1) + ' %';
    host.innerHTML = `<div class="kpi-strip fuel-kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:10px">` + [
      _fuelKpi('Fixed price · energy', f2(x.energy), '€/MWh', _c(`${lbl} · fourchette ${f2(x.lo)}–${f2(x.hi)} selon l’année d’historique`, `${lbl} · range ${f2(x.lo)}–${f2(x.hi)} with each history year`)),
      _fuelKpi('Your profile factor', pct1(x.factor), '', _c(`vs le prix à terme base pondéré par votre volume (${f2(x.base)} €/MWh) · mesuré sur ${x.histYears.join(' et ')}${x.realised ? ' · ' + pct1(x.realised) + ' sur votre propre période' : ''}`, `vs the forward baseload weighted by your volume (${f2(x.base)} €/MWh) · measured on ${x.histYears.join(' and ')}${x.realised ? ' · ' + pct1(x.realised) + ' in your own period' : ''}`), x.factor > 1 ? 'down' : 'up'),
      _fuelKpi('Capacity', x.cap == null ? '–' : f2(x.cap), '€/MWh', x.cap == null ? _c('il faut un jour ouvré d’hiver dans vos données', 'needs a winter weekday in your data') : 'winter peak days, spread over the year'),
      _fuelKpi('Energy + capacity', f2(x.total), '€/MWh', _c(`≈ ${eur(x.total * x.E / 1000)} pour ${f1(x.E / 1000)} MWh`, `≈ ${eur(x.total * x.E / 1000)} for ${f1(x.E / 1000)} MWh`)),
    ].join('') + `</div><div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Month</th><th>Volume MWh</th><th>Forward base €/MWh</th><th style="text-align:left">Contract</th><th>Profile factor</th><th>Your price €/MWh</th></tr></thead><tbody>` +
      x.months.map(r => `<tr><td style="text-align:left">${MON[+r.k.slice(5) - 1]} ${r.k.slice(0, 4)}</td><td>${f1(r.E / 1000)}</td><td>${f2(r.F)}</td><td style="text-align:left;color:var(--tx3)">${esc(r.from || '')}</td><td>${pct1(r.fac)}</td><td><b>${f2(r.F * r.fac)}</b></td></tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">${_c(`Calcul : le prix à terme base de chaque mois (dernier règlement, ${esc(x.asOf || '')} ; un mois sans contrat propre prend son trimestre, sa saison ou son année, profilé par les ratios du spot) × votre facteur de profil de ce mois, c’est-à-dire ce que votre jour ouvré moyen et votre week-end moyen auraient coûté sur le spot français en ${x.histYears.join(' et ')}, divisé par le prix base (la fourchette prend chaque année seule). Volume = vos jours moyens répétés sur le calendrier de livraison. Capacité = le coût des jours de pointe d’hiver ci-dessus, réparti sur le volume. <b>Non inclus</b> : TURPE, taxes (accise, CTA, TVA), garanties d’origine, la marge du fournisseur et sa prime de risque volume et profil (souvent 1 à 5 €/MWh).`,
        `How it is computed: each month's baseload forward (latest settlement, ${esc(x.asOf || '')}; a month without its own contract takes its quarter, season or year shaped by day-ahead ratios) × your profile factor for that month, i.e. what your average working day and weekend would have cost on the French day-ahead market in ${x.histYears.join(' and ')} divided by the baseload (the range uses each year alone). Volume = your average days repeated over the delivery calendar. Capacity = the winter peak-day cost above spread over the volume. <b>Not included</b>: grid fees (TURPE), taxes (excise, CTA, VAT), guarantees of origin, the supplier's margin and its volume and shape risk premium (often 1 to 5 €/MWh).`)}</div>`;
    renderBill(o);
  }

  // ── ACC: average day hour by hour (consumption, ACC share, complement, surplus) ──
  function renderAccDay(o) {
    const card = $('cf-accday-card'), A = o.acc; if (!card) return;
    card.hidden = !A; if (!A) return;
    const sel = $('cf-accday-m'), m = sel ? sel.value : 'all';
    const ms = m === 'all' ? [...Array(12).keys()] : m === 'sum' ? [3, 4, 5, 6, 7, 8] : m === 'win' ? [9, 10, 11, 0, 1, 2] : [+m];
    const agg = k => { const v = new Float64Array(24); let n = 0; ms.forEach(i => { const D = A.day[i]; if (!D.n) return; n += D.n; D[k].forEach((y, h) => { v[h] += y; }); }); return [...v].map(y => n ? y / n : null); };
    const c = agg('c'), g = agg('g'), x = agg('x');
    if (c.every(v => !v)) { noDataMsg('cf-accday', 'No data for this period', ''); return; }
    const r1 = v => v == null ? null : Math.round(v * 10) / 10;
    const comp = c.map((v, h) => r1(v - x[h])), sur = g.map((v, h) => r1(v - x[h]));
    _fuelChart('cf-accday', { type: 'bar', data: { labels: HRS, datasets: [
      { label: 'Covered by the ACC', data: x.map(r1), backgroundColor: 'rgba(251,191,36,.85)', stack: 's', borderWidth: 0, order: 2 },
      { label: 'Complement from the supplier', data: comp, backgroundColor: 'rgba(127,200,248,.55)', stack: 's', borderWidth: 0, order: 2 },
      { label: 'Surplus (your share not consumed)', data: sur, backgroundColor: 'rgba(237,105,101,.55)', stack: 's', borderWidth: 0, order: 2 },
      { type: 'line', label: 'Your consumption', stack: 'lc', data: c.map(r1), borderColor: '#E6EDF3', borderWidth: 2, pointRadius: 0, tension: .3, fill: false, order: 1 },
      { type: 'line', label: 'Your share of the ACC production', stack: 'lg', data: g.map(r1), borderColor: '#FBBF24', borderDash: [5, 4], borderWidth: 1.6, pointRadius: 0, tension: .3, fill: false, order: 1 },
    ] }, options: _fuelOpts({ plugins: { legend: legend(), tooltip: { callbacks: { label: t => ` ${t.dataset.label}: ${f1(t.raw)} kWh` } } },
      scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis('kWh per hour (average day)', { stacked: true, beginAtZero: true }) } }) }, 'carbon-acc-average-day');
    const S = v => v.reduce((a, b) => a + (b || 0), 0), sc = S(c), sx = S(x), sg = S(g);
    const sub = $('cf-accday-sub'); if (sub) sub.textContent = _c(`Jour moyen · l’ACC couvre ${pc(sc ? sx / sc : 0)} de votre consommation · ${pc(sg ? sx / sg : 0)} de votre part autoconsommée, ${f1(S(sur))} kWh de surplus par jour`, `Average day · ACC covers ${pc(sc ? sx / sc : 0)} of your consumption · ${pc(sg ? sx / sg : 0)} of your share self-consumed, ${f1(S(sur))} kWh a day surplus`);
  }

  // ── The whole bill, before VAT: supplier only vs with ACC ─────────
  // €/MWh, ZNI surcharge included (≤ 36 kVA; > 36 kVA), revised every 1 February and 1 August (CIBS L. 312-37):
  //   1 Feb 2026 30.85 / 26.58 · 1 Aug 2026 30.62 / 26.35 (24.69 + ZNI 5.93 for households)
  const ACCISE = { small: 30.62, large: 26.35, since: '1 August 2026' };
  // Belgium (professional use), INDICATIVE 2026 values to check against the supplier's tariff card: federal special
  // excise by yearly consumption band (€/MWh; band rates found on 2026 supplier tariff cards, not on an official text),
  // energy contribution (kept for professional use after the 1 August 2026 reform, Programme Act of 30 May 2026)
  const BE_EXCISE = [[20, 14.21], [50, 12.09], [1000, 11.39]], BE_CONTRIB = 1.9261;
  const beExcise = mwh => { let left = mwh, prev = 0, eur = 0; for (const [up, r] of BE_EXCISE) { const q = Math.max(0, Math.min(left, up - prev)); eur += q * r; left -= q; prev = up; } if (left > 0) eur += left * BE_EXCISE[BE_EXCISE.length - 1][1]; return mwh ? eur / mwh : BE_EXCISE[0][1]; };
  const BE_REG = { WAL: 'Wallonia', VLA: 'Flanders', BRU: 'Brussels' };
  function renderBill(o) {
    const host = $('cf-bill'), x = o.fixed; if (!host) return;
    if (!x || x.missing) { host.innerHTML = ''; return; }
    const st = S.settings, n = v => v === '' || v == null || !isFinite(+v) ? 0 : +v;
    const conn = st.conn === 'auto' ? (o.peak.v <= 36 ? 'small' : 'large') : st.conn;
    const BE = /^BE/.test(st.country || 'FR'), reg = BE ? BE_REG[st.country.slice(3)] || 'Belgium' : '';
    const has = v => v !== '' && v != null && isFinite(+v), turpeIn = has(st.turpe) || has(st.turpeFix);
    const yearMWh = o.E / 1000 * 365 / Math.max(1, o.days.length);
    const acc = BE ? beExcise(yearMWh) : ACCISE[conn];
    const ctaRate = st.net === 'trans' ? 0.05 : 0.15;   // CTA from 1 Feb 2026: 15 % of the fixed TURPE on distribution networks, 5 % on transmission
    const E = x.E / 1000, capEur = (x.cap || 0) * E;   // MWh, € per year
    const per = (eur, mwh) => mwh ? eur / mwh : 0;
    const lines = [];
    const A = o.acc && o.acc.fixed && !o.acc.fixed.missing ? o.acc : null;
    const Er = A ? A.fixed.E / 1000 : E, Ea = E - Er;
    const row = (label, a, b, note) => lines.push({ label, a, b, note });
    row(BE ? 'Energy (fixed price, French forwards)' : 'Energy (fixed price)', x.energy * E, A ? A.fixed.energy * Er : null, A ? `complement priced on your residual profile: ${f2(A.fixed.energy)} €/MWh vs ${f2(x.energy)} for all your consumption (profile factor ${(A.fixed.factor * 100).toFixed(1)} % vs ${(x.factor * 100).toFixed(1)} %)` : `${f2(x.energy)} €/MWh`);
    const capB = A && A.capR != null && o.capacity && o.capacity.cost ? capEur * A.capR / o.capacity.cost : capEur;
    if (!BE) row('Capacity', capEur, A ? capB : null, A ? `winter peak days; with ACC on your load left in the 07–10h and 17–20h windows (${pc(o.capacity && o.capacity.cost ? 1 - capB / capEur : 0)} lower)` : 'winter peak days, 07–10h and 17–20h');
    if (BE) row('Green certificates (regional quota)', n(st.gc) * E, A ? n(st.gc) * Er : null, has(st.gc) ? _c(`${f2(n(st.gc))} €/MWh sur l’énergie vendue par le fournisseur (${reg})`, `${f2(n(st.gc))} €/MWh on the energy the supplier sells (${reg})`) : `enter the cost from your supplier's tariff card (${reg}: quota × certificate price; Wallonia's is the highest)`);
    else row('Energy savings certificates (CEE)', n(st.cee) * E, A ? n(st.cee) * Er : null, _c(`${f2(n(st.cee))} €/MWh sur l’énergie vendue par le fournisseur`, `${f2(n(st.cee))} €/MWh on the energy the supplier sells`));
    if (n(st.goP)) row('Guarantees of origin', n(st.goP) * E, A ? n(st.goP) * Er : null, `${f2(n(st.goP))} €/MWh`);
    row('Supplier margin', n(st.margin) * E, A ? n(st.margin) * Er : null, `${f2(n(st.margin))} €/MWh`);
    if (A) {
      row('ACC energy (to the producer)', 0, n(st.accPrice) * Ea, `${f1(Ea)} MWh at ${f2(n(st.accPrice))} €/MWh`);
      row('PMO fees', 0, n(st.pmo) * Ea, `${f2(n(st.pmo))} €/MWh of ACC energy`);
      const risk = has(st.accRisk) ? n(st.accRisk) : (A.imbNat != null ? Math.max(0, A.imbNat) : 0);
      row('Complement risk (ACC volume)', 0, risk * Ea, `the supplier carries the forecast error of the ACC output on the complement: ${f2(risk)} €/MWh of ACC energy${has(st.accRisk) ? ' (entered)' : ' (national solar imbalance cost, ENTSO-E; a single site is less predictable: raise it if needed)'}`);
    }
    if (BE) {
      row('Federal special excise', acc * E, A ? acc * E : null, `${f2(acc)} €/MWh on ${f0(yearMWh)} MWh a year, bands ${BE_EXCISE.map(([u, r]) => '≤ ' + u + ' MWh ' + r).join(' · ')} €/MWh (indicative 2026, professional use: check your tariff card) · shared energy taxed like any other`);
      row('Energy contribution', BE_CONTRIB * E, A ? BE_CONTRIB * E : null, `${BE_CONTRIB} €/MWh (professional use; abolished for households from 1 August 2026)`);
    } else row('Excise (accise)', acc * E, A ? acc * Er + (A.exempt ? 0 : acc * Ea) : null, `${f2(acc)} €/MWh (${conn === 'small' ? '≤ 36 kVA' : '> 36 kVA'}, since ${ACCISE.since}; revised each 1 Feb and 1 Aug)` + (A ? (A.exempt ? ' · ACC part at 0 €/MWh (installation under 1 MW)' : ' · ACC part taxed (installation of 1 MW or more)') : ''));
    if (turpeIn) {
      const tv = n(st.turpe), tva = has(st.turpeAcc) ? n(st.turpeAcc) : tv, tf = n(st.turpeFix);
      row(BE ? 'Grid fees · variable part' : 'TURPE · variable part', tv * E, A ? tv * Er + tva * Ea : null, BE ? `${f2(tv)} €/MWh (distribution, transmission, federal and regional surcharges of your DSO's tariff card)${A ? ` · ${f2(tva)} €/MWh on the shared energy${has(st.turpeAcc) ? '' : ' (same rate: enter the reduced local-sharing rate if your DSO grants one)'}` : ''}` : `${f2(tv)} €/MWh drawn${A ? (has(st.turpeAcc) ? ` · ${f2(tva)} €/MWh on the ACC energy (ACC withdrawal option, self-produced indices)` : ' · same rate on the ACC energy (enter the ACC option rate if chosen)') : ''}`);
      if (tf) row(BE ? 'Grid fees · fixed part' : 'TURPE · fixed part', tf, A ? tf : null, `${eur(tf)} a year (management, metering, ${BE ? 'capacity' : 'subscribed power'})`);
      if (tf && !BE) row('CTA', tf * ctaRate, A ? tf * ctaRate : null, `${(ctaRate * 100).toFixed(0)} % of the fixed TURPE (${st.net === 'trans' ? 'transmission' : 'distribution'} network, rate from 1 Feb 2026): does not move with volume`);
    }
    const tA = lines.reduce((s, l) => s + l.a, 0), tB = A ? lines.reduce((s, l) => s + l.b, 0) : null;
    o.bill = { lines, tA, tB, E, acc: !!A };
    // what the supplier charges per MWh it supplies: full consumption vs complement only
    const SUP = ['Energy (fixed price)', 'Energy (fixed price, French forwards)', 'Capacity', 'Energy savings certificates (CEE)', 'Green certificates (regional quota)', 'Guarantees of origin', 'Supplier margin', 'Complement risk (ACC volume)'];
    const supA = lines.filter(l => SUP.includes(l.label)).reduce((a, l) => a + l.a, 0) / (E || 1);
    const supB = A ? lines.filter(l => SUP.includes(l.label)).reduce((a, l) => a + l.b, 0) / (Er || 1) : null;
    const k = v => v == null ? '–' : eur(v);
    host.innerHTML = `<div class="kpi-strip fuel-kpis" style="grid-template-columns:repeat(${A ? 3 : 2},1fr);margin-bottom:10px">` + [
      _fuelKpi('All-in · supplier only', f2(per(tA, E)), '€/MWh', _c(`${k(tA)} par an HT${turpeIn ? '' : ' · TURPE non saisi'}`, `${k(tA)} a year before VAT${turpeIn ? '' : ' · grid fees not entered'}`)),
      _fuelKpi('Volume', f1(E), 'MWh', 'over the delivery period'),
      ...(A ? [_fuelKpi('All-in · with ACC', f2(per(tB, E)), '€/MWh', _c(`${k(tB)} par an HT`, `${k(tB)} a year before VAT`), tB < tA ? 'up' : 'down'),
        _fuelKpi('ACC covers', pc(A.share), '', `${f0(A.kwc)} kWc × ${Math.round(A.key * 100)} % · ${tB < tA ? _c('économie', 'saving') : _c('surcoût', 'extra cost')} ${k(Math.abs(tA - tB))} ${_c('par an', 'a year')}`, tB < tA ? 'up' : 'down'),
        _fuelKpi('Supplier price · complement', f2(supB), '€/MWh', _c(`vs ${f2(supA)} €/MWh pour fournir toute votre consommation (+${f2(supB - supA)}) : moins d’heures, plus chères, et le risque de volume de l’ACC`, `vs ${f2(supA)} €/MWh to supply all your consumption (+${f2(supB - supA)}): fewer, dearer hours and the ACC volume risk`), 'down'),
        _fuelKpi('Break-even ACC price', Ea ? f2(n(st.accPrice) + (tA - tB) / Ea) : '–', '€/MWh', _c('au-dessus, l’ACC vous coûte plus que le fournisseur seul', 'above it, the ACC costs you more than supplier only'))] : []),
    ].join('') + `</div><div class="chart-container fuel-card" style="margin-bottom:12px"><div class="fuel-card-head"><div><div class="table-title">What your bill is made of</div><div class="fuel-card-sub">${_c('€/MWh de votre consommation totale, HT · chaque bloc de la facture', '€/MWh of your total consumption, before VAT · each block of the bill')}${A ? _c(', fournisseur seul vs avec ACC', ', supplier only vs with ACC') : ''}</div>${A ? '<div class="fuel-card-sub" style="margin-top:4px">' + _c('Avec l’ACC, deux achats : l’<b>énergie ACC</b>, produite par le parc solaire partagé et payée au producteur au prix ACC (plus les frais de la PMO) ; et le <b>complément</b>, tout ce que le parc ne couvre pas (soir, nuit, hiver), acheté au fournisseur. Le complément coûte plus cher au MWh : ce sont les heures sans soleil, les plus chères, et le fournisseur porte l’incertitude sur la production du parc.', 'With the ACC, two purchases: the <b>ACC energy</b>, produced by the shared solar plant and paid to the producer at the ACC price (plus the PMO fees); and the <b>complement</b>, everything the plant does not cover (evening, night, winter), bought from the supplier. The complement costs more per MWh: those are the hours without sun, the dearest ones, and the supplier carries the uncertainty on the plant output.') + '</div>' : ''}</div><span class="source-badge">PowerKlock</span></div><div style="position:relative;height:${A ? 230 : 160}px"><canvas id="cf-bill-chart" style="width:100%;height:${A ? 230 : 160}px"></canvas></div></div><div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Component</th><th>Supplier only · €/MWh</th><th>k€</th>${A ? '<th>With ACC · €/MWh</th><th>k€</th>' : ''}<th style="text-align:left">Basis</th></tr></thead><tbody>` +
      lines.map(l => `<tr><td style="text-align:left">${l.label}</td><td>${f2(per(l.a, E))}</td><td>${f1(l.a / 1000)}</td>${A ? `<td>${f2(per(l.b, E))}</td><td>${f1(l.b / 1000)}</td>` : ''}<td style="text-align:left;white-space:normal;color:var(--tx3)">${l.note}</td></tr>`).join('') +
      `<tr><td style="text-align:left"><b>Total before VAT</b></td><td><b>${f2(per(tA, E))}</b></td><td><b>${f1(tA / 1000)}</b></td>${A ? `<td><b>${f2(per(tB, E))}</b></td><td><b>${f1(tB / 1000)}</b></td>` : ''}<td style="text-align:left;color:var(--tx3)">${_c(`€/MWh de votre consommation totale · TVA ${BE ? 21 : 20} % en sus (récupérable pour la plupart des entreprises)`, `€/MWh of your total consumption · VAT ${BE ? 21 : 20} % on top (recoverable for most businesses)`)}</td></tr></tbody></table></div>` +
      `<div class="fuel-note">${A ? _c(`ACC : ${f1(A.prod / 1000)} MWh produits pour vous sur la période de vos données, ${pc(A.self / (A.prod || 1))} consommés sur site quart d’heure par quart d’heure, ${f1(A.surplus / 1000)} MWh de surplus (vendus par le producteur, hors de votre facture). Sans les heures solaires, le reste de votre fourniture coûte plus cher au MWh : c’est l’écart à garder en tête. `, `ACC: ${f1(A.prod / 1000)} MWh produced for you over your data period, ${pc(A.self / (A.prod || 1))} consumed on site quarter-hour by quarter-hour, ${f1(A.surplus / 1000)} MWh surplus (sold by the producer, outside your bill). Without the solar hours, the rest of your supply costs more per MWh: that is the spread to keep in mind. `) : ''}${BE ? _c(`Belgique (${reg}) : énergie valorisée sur les prix à terme français (les prix à terme belges ne sont pas dans PowerKlock ; les deux marchés sont couplés et en général à quelques €/MWh : ajustez la marge si votre offre diffère). Pas de bloc capacité (le mécanisme de capacité belge passe par les tarifs réseau). Partage d’énergie : l’énergie partagée paie l’accise et la cotisation énergie comme toute autre ; les frais de réseau sont ceux de votre GRD, réduits dans certaines régions pour le partage local : saisissez ce tarif comme tarif réseau ACC. Tranches d’accise et certificats verts indicatifs : vérifiez la grille de votre fournisseur.`, `Belgium (${reg}): energy priced on the French forwards (Belgian forwards are not in PowerKlock; the two markets are coupled and usually within a few €/MWh: adjust the margin if your offer differs). No capacity block (the Belgian capacity mechanism is paid through the grid tariffs). Energy sharing (partage d'énergie / energiedelen): the shared energy pays the excise and the energy contribution like any other; grid fees are your DSO's, reduced in some regions for local sharing: enter that rate as the ACC grid rate. Excise bands and green certificates are indicative: check your supplier's tariff card.`) : _c(`Exonération d’accise pour l’ACC : chaque installation renouvelable de moins de 1 MW (avec deux parcs, vérifiez la lecture du seuil pour le vôtre), consommation par les participants (CIBS L. 312-79 et L. 312-87, loi de finances 2025 art. 75, confirmée par le Conseil d’État le 30 mars 2026). CEE : environ 10 €/MWh en période 6 (2026-2030) ; appliqués ici à l’énergie du fournisseur seulement. Taux d’accise réduits (électro-intensifs, certaines activités) et TURPE dépendent de votre contrat : saisissez ce que montre votre facture.`, `Excise exemption for ACC: each renewable installation under 1 MW (with two parks, check how the threshold is read for yours), consumption by the participants (CIBS L. 312-79 and L. 312-87, Finance Law 2025 art. 75, upheld by the Conseil d’État on 30 March 2026). CEE: around 10 €/MWh in period 6 (2026-2030); applied here to the supplier's energy only. Reduced excise rates (electro-intensive, some activities) and grid fees depend on your contract: enter what your bill shows.`)}</div>`;
    // stacked bar: one bar per scenario, one block per component, totals at the end
    const COL = { 'Energy (fixed price)': '#7FC8F8', 'Energy (fixed price, French forwards)': '#7FC8F8', 'Capacity': '#A87DC4', 'Energy savings certificates (CEE)': '#F59E0B', 'Guarantees of origin': '#34D399', 'Supplier margin': '#94A3B8',
      'ACC energy (to the producer)': '#FBBF24', 'PMO fees': '#FDE68A', 'Excise (accise)': '#ED6965', 'Complement risk (ACC volume)': '#F97316', 'TURPE · variable part': '#64748B', 'TURPE · fixed part': '#475569', 'CTA': '#334155',
      'Green certificates (regional quota)': '#22C55E', 'Federal special excise': '#ED6965', 'Energy contribution': '#F87171', 'Grid fees · variable part': '#64748B', 'Grid fees · fixed part': '#475569' };
    const bars = A ? ['Supplier only', 'With ACC'] : ['Supplier only'];
    const r2 = v => Math.round(v * 100) / 100;
    const tot = A ? [per(tA, E), per(tB, E)] : [per(tA, E)];
    const totals = { id: 'cfBillTotals', afterDatasetsDraw(ch) { const g = ch.ctx, xs = ch.scales.x, ys = ch.scales.y; g.save(); g.font = '600 12px "IBM Plex Mono", monospace'; g.fillStyle = C_TX2 || '#B8C9D9'; g.textBaseline = 'middle';
      tot.forEach((t, i) => g.fillText(f2(t) + ' €/MWh', xs.getPixelForValue(t) + 8, ys.getPixelForValue(i))); g.restore(); } };
    const inBar = { id: 'cfBillLabels', afterDatasetsDraw(ch) { const g = ch.ctx; g.save(); g.font = '600 10px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#0B1620';
      ch.data.datasets.forEach((d, di) => ch.getDatasetMeta(di).data.forEach((el, i) => { const v = d.data[i]; if (!v) return; const w = Math.abs(el.x - el.base); if (w < 34) return; g.fillText(v.toFixed(v >= 10 ? 0 : 1), (el.x + el.base) / 2, el.y); })); g.restore(); } };
    renderAccDay(o);
    _fuelChart('cf-bill-chart', { type: 'bar', data: { labels: bars, datasets: lines.filter(l => l.a || l.b).map(l => ({
      label: l.label, data: A ? [r2(per(l.a, E)), r2(per(l.b, E))] : [r2(per(l.a, E))], backgroundColor: COL[l.label] || '#7A93AB', borderWidth: 0, borderSkipped: false, barPercentage: .62, categoryPercentage: .9 })) },
      plugins: [totals, inBar],
      options: _fuelOpts({ indexAxis: 'y', layout: { padding: { right: 110 } }, plugins: { legend: legend(), tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${f2(c.raw)} €/MWh` } } },
        scales: { x: _fuelAxis('€/MWh', { stacked: true, beginAtZero: true }), y: { stacked: true, grid: { display: false }, ticks: { color: C_TX2, font: { size: 11 } } } } }) }, 'carbon-bill-blocks');
  }

  // ── Reporting ─────────────────────────────────────────────────────
  function renderReport(o) {
    const rows = [
      ['Location-based · quarter-hourly (RTE éCO2mix)', t(o.emLocation), o.ciHourly, 'Consumption × French grid intensity at the same quarter-hour. The most precise view of the physical impact of your consumption timing.'],
      ['Location-based · period average', t(o.emAnnualMethod), o.ciAnnual, 'Consumption × national consumption-weighted intensity over the same period: the usual location-based figure when hourly data are not used.'],
      ...(o.emAnnualFactor != null ? [['Location-based · your reporting factor', t(o.emAnnualFactor), +S.settings.annualFactor, 'Consumption × the annual factor you entered (e.g. the factor of your carbon accounting database), for consistency with your other reports.']] : []),
      ['Market-based', t(o.emMarket), o.emMarket != null ? o.emMarket / o.E : null, _c(`Garanties d’origine et volume du PPA (${f1(o.covered)} MWh) à 0 g ; le reste (${f1(o.E / 1000 - o.covered)} MWh) ${o.factorRest != null ? 'au ' + esc(o.factorRestSrc) + ' (' + f1(o.factorRest) + ' g/kWh)' : 'demande un facteur de mix résiduel'}.`, `Guarantees of origin and PPA volume (${f1(o.covered)} MWh) at 0 g; the rest (${f1(o.E / 1000 - o.covered)} MWh) ${o.factorRest != null ? 'at the ' + esc(o.factorRestSrc) + ' (' + f1(o.factorRest) + ' g/kWh)' : 'needs a residual mix factor'}.`)],
    ];
    $('cf-report').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">GHG Protocol · Scope 2 · ${esc(o.days[0])} → ${esc(o.days[o.days.length - 1])}</th><th>t CO₂</th><th>g CO₂/kWh</th><th style="text-align:left">How it is computed</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td style="text-align:left"><b>${r[0]}</b></td><td>${f2(r[1])}</td><td>${f1(r[2])}</td><td style="text-align:left;white-space:normal;color:var(--text2);min-width:280px">${r[3]}</td></tr>`).join('') + `</tbody></table></div>`;
    const ren = o.covered, renShare = o.E ? ren * 1000 / o.E : 0;
    const esrs = [
      ['E1-5', 'Electricity consumption', f1(o.E / 1000) + ' MWh', 'Total purchased electricity over the period'],
      ['E1-5', 'of which from renewable sources', f1(ren) + ' MWh · ' + pc(renShare), 'Covered by guarantees of origin or a renewable PPA (contractual instruments)'],
      ['E1-5', 'of which from nuclear sources', f1(o.mix.nuclear / 1000) + ' MWh', 'Physical mix of the grid at the time of consumption (RTE); report per your accounting policy'],
      ['E1-6', 'Gross Scope 2 · location-based', f2(t(o.emLocation)) + ' t CO₂', 'Quarter-hourly method (or the period average / your reporting factor above)'],
      ['E1-6', 'Gross Scope 2 · market-based', o.emMarket == null ? '–' : f2(t(o.emMarket)) + ' t CO₂', 'Contractual instruments, then residual mix'],
      ['E1-6', 'Intensity', o.emMarket == null ? '–' : f1(o.emMarket / o.E) + _c(' g CO₂/kWh (market-based) · ', ' g CO₂/kWh (market) · ') + f1(o.ciHourly) + _c(' (location-based)', ' (location)'), 'Per kWh consumed; divide by your revenue for the ESRS intensity per net revenue'],
    ];
    $('cf-esrs').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">ESRS</th><th style="text-align:left">Datapoint</th><th>Value</th><th style="text-align:left">Note</th></tr></thead><tbody>` +
      esrs.map(r => `<tr><td style="text-align:left">${r[0]}</td><td style="text-align:left"><b>${r[1]}</b></td><td>${r[2]}</td><td style="text-align:left;white-space:normal;color:var(--text2)">${r[3]}</td></tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">${_c('CSRD (ESRS E1) : consommation et mix énergétiques (E1-5), émissions brutes de Scope 2 location- et market-based (E1-6). France, Bilan GES : ces chiffres alimentent le poste « émissions indirectes liées à la consommation d’électricité » (Scope 2). Les facteurs réseau sont ici les émissions directes de la production française selon RTE (sans imports ni amont) : la plupart des bases carbone ajoutent une part amont — saisissez le facteur annuel de votre base dans « Vos contrats » pour déclarer avec. Mix résiduel : AIB European Residual Mix (France et Belgique cités ; autres pays à saisir).', 'CSRD (ESRS E1): energy consumption and mix (E1-5), gross Scope 2 emissions location- and market-based (E1-6). France, Bilan GES: these figures feed the item “indirect emissions from electricity consumption” (Scope 2). Grid factors here are RTE\'s direct emissions of French generation (no imports, no upstream): most carbon databases add an upstream share — enter your database\'s annual factor in “Your contracts” to report with it. Residual mix: AIB European Residual Mix (France and Belgium quoted; other countries entered).')}</div>`;
    $('cf-quality').innerHTML = `<div class="fuel-note">${_c('Fichier', 'File')} : ${esc(S.meta)} · ${S.cons.info.rows.toLocaleString('en-GB')} ${_c('lignes', 'rows')} · ${_c('pas de', 'steps of')} ${S.cons.info.step} min · ${o.days.length} ${_c('jours', 'days')} (${o.days[0]} → ${o.days[o.days.length - 1]}) · ${o.missing ? f1(o.missing / 1000) + _c(' MWh sur des quarts d’heure sans données RTE (comptés à la moyenne de la période)', ' MWh on quarter-hours without RTE data (counted at the period average)') : _c('chaque quart d’heure apparié aux données RTE', 'every quarter-hour matched with RTE data')}. ${_c('Votre fichier est traité dans ce navigateur seulement : rien n’est envoyé ni stocké.', 'Your file is processed in this browser only: nothing is sent or stored.')}</div>`;
  }

  // one line on every tab but the inputs: what is loaded, with a way back to edit it
  function sumbar(o) {
    const el = $('cf-sumbar'); if (!el || !o) return;
    const st = S.settings;
    el.innerHTML = `<span><b>${esc(S.meta || 'Your curve')}</b></span><span>${o.days[0]} → ${o.days[o.days.length - 1]}</span><span><b>${f1(o.E / 1000)}</b> MWh</span>` +
      (+st.go ? `<span>GO ${f1(+st.go)} MWh</span>` : '') + (+st.ppa ? `<span>${st.ppaTech === 'wind' ? _c('PPA éolien', 'Wind PPA') : _c('PPA solaire', 'Solar PPA')} ${f1(+st.ppa)} MWh</span>` : '') +
      (+st.pvKwp ? `<span>${_c('Solaire sur site', 'Solar on site')} ${f0(+st.pvKwp)} ${_c('kWc', 'kWp')}</span>` : '') + `<button type="button" class="cf-edit">${_c('Modifier les données', 'Edit data')}</button>`;
    el.querySelector('.cf-edit').addEventListener('click', () => { const t = tabBtn('Your data'); if (t) t.click(); });
    sumVis();
  }
  function sumVis() {
    const el = $('cf-sumbar'), act = document.querySelector('#page-carbonfoot .pk-views .tab-btn.active');
    if (!el) return;
    el.hidden = !act || act === tabBtn('Your data');
    if (!S.res && !el.hidden) {
      el.innerHTML = _c('<span>Aucune consommation chargée : chargez votre courbe (ou essayez l’exemple) dans <b>Vos données</b>.</span><button type="button" class="cf-edit">Charger des données</button>', '<span>No consumption loaded yet: load your curve (or try the example) in <b>Your data</b>.</span><button type="button" class="cf-edit">Load data</button>');
      el.querySelector('.cf-edit').addEventListener('click', () => { const t = tabBtn('Your data'); if (t) t.click(); });
    }
  }
  document.addEventListener('pk-view', e => { if (e.detail && e.detail.key === 'carbonfoot') sumVis(); });

  async function run() {
    if (!S.cons) return;
    $('cf-results').hidden = false;
    $('cf-status').textContent = _c('Calcul…', 'Computing…');
    let o;
    try { o = await compute(); } catch (e) { console.warn(e); $('cf-status').textContent = _c('Le calcul a échoué : ', 'Computation failed: ') + e.message; return; }
    S.res = o;
    [renderOverview, renderConsumption, renderCarbon, renderCost, renderSolar, renderReport, renderCalendar, render247, renderExplore].forEach(fn => { try { fn(o); } catch (e) { console.warn('[carbon]', fn.name, e); } });
    const i = S.cons.info;
    $('cf-status').textContent = _c(`${S.meta} · ${i.rows.toLocaleString('en-GB')} lignes · pas de ${i.step} min · valeurs lues en ${{ kwh: 'kWh par pas', mwh: 'MWh par pas', kw: 'kW (puissance moyenne)', w: 'W (puissance moyenne)' }[i.unit]}, horodatage ${i.stamp === 'end' ? 'à la fin' : 'au début'} de chaque pas`,
      `${S.meta} · ${i.rows.toLocaleString('en-GB')} rows · ${i.step}-min steps · values read as ${{ kwh: 'kWh per step', mwh: 'MWh per step', kw: 'kW (average power)', w: 'W (average power)' }[i.unit]}, timestamps at the ${i.stamp} of each step`);
    // charts drawn in hidden view tabs get their size when shown
    document.querySelectorAll('#cf-results canvas').forEach(c => { const ch = window.Chart && Chart.getChart(c); if (ch) ch.resize(); });
    sumbar(o);
    steps(3); const see = $('cf-see'); if (see) see.hidden = false;
    // first result: open the Overview (the inputs stay one click away)
    if (!S.shown) { S.shown = true; const t = tabBtn('Overview'); if (t) t.click(); }
  }

  async function load(rows, name) {
    try {
      S.raw = rows; S.meta = name;
      S.cons = buildCurve(rows);
      // a curve mostly negative is an injection or an export sign convention: read as consumption, and said so
      let neg = 0, pos = 0; S.cons.slots.forEach(a => a.forEach(v => { if (v < 0) neg++; else if (v > 0) pos++; }));
      S.flipped = neg > pos;
      if (S.flipped) S.cons.slots.forEach(a => { for (let q = 0; q < a.length; q++) if (a[q] != null) a[q] = Math.abs(a[q]); });
      await run();
      if (S.flipped) $('cf-status').textContent += _c(' · valeurs négatives (convention de signe d’export ?) : lues comme consommation', ' · values were negative (export sign convention?): read as consumption');
    } catch (e) { $('cf-status').textContent = e.message; }
  }

  // ── Exports ───────────────────────────────────────────────────────
  function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  function exportCSV() {
    const o = S.res; if (!o) return;
    const lines = [['date', 'consumption_kWh', 'carbon_intensity_g_per_kWh', 'location_based_kgCO2'].join(';')];
    o.daily.forEach(x => lines.push([x.d, x.E.toFixed(2), x.ci == null ? '' : x.ci.toFixed(1), x.ci == null ? '' : (x.E * x.ci / 1000).toFixed(2)].join(';')));
    download('powerklock-scope2-' + o.days[0] + '_' + o.days[o.days.length - 1] + '.csv', new Blob([lines.join('\n')], { type: 'text/csv' }));
  }
  async function exportXlsx() {
    const o = S.res; if (!o) return;
    const b = $('cf-xlsx'); if (b) b.textContent = 'Preparing…';
    try {
      await loadXLSX();
      const wb = XLSX.utils.book_new(), add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), n), r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
      add('Summary', [
        ['Period', o.days[0] + ' → ' + o.days[o.days.length - 1]], ['Consumption (MWh)', r2(o.E / 1000)], ['Average power (kW)', r2(o.avgKW)], ['Peak power (kW)', r2(o.peak.v)], ['Peak at', o.peak.at],
        ['Power exceeded 5 % of the time (kW)', r2(o.p95)], ['Base load (kW)', r2(o.baseKW)], ['Load factor', r2(o.loadFactor)], ['Share outside working hours', r2(o.offHours / o.E)],
        ['Scope 2 location-based, quarter-hourly (t CO2)', r2(t(o.emLocation))], ['Intensity (g/kWh)', r2(o.ciHourly)], ['Scope 2 location-based, period average (t CO2)', r2(t(o.emAnnualMethod))],
        ...(o.emAnnualFactor != null ? [['Scope 2 location-based, reporting factor (t CO2)', r2(t(o.emAnnualFactor))]] : []),
        ['Scope 2 market-based (t CO2)', r2(t(o.emMarket))], ['Residual mix / supplier factor (g/kWh)', r2(o.factorRest)], ['Renewable coverage (GOs + PPA)', r2(o.coverage)],
        ['Spot cost (€)', r2(o.cost)], ['Spot cost (€/MWh)', r2(o.costAvg)], ['Baseload (€/MWh)', r2(o.baseAvg)],
        ['Flexibility: share moved', +S.settings.flexPct || 0], ['Flexibility: saving (€)', r2(o.flex.save)], ['Flexibility: CO2 change (kg)', r2(o.flex.dCO2 / 1000)],
        ['Solar: size (kWp)', +S.settings.pvKwp || 0], ['Solar: production (MWh)', r2(o.pv.prod / 1000)], ['Solar: self-consumed (MWh)', r2(o.pv.self / 1000)], ['Solar: CO2 avoided (t)', r2(t(o.pv.co2))],
        ['Source', 'PowerKlock — RTE éCO2mix, ENTSO-E day-ahead, AIB residual mix'],
      ].map(([k, v]) => ({ Item: k, Value: v })));
      if (o.fixed && o.fixed.months) add('Fixed price', o.fixed.months.map(r => ({ Month: r.k, 'Volume MWh': r2(r.E / 1000), 'Forward base €/MWh': r2(r.F), Contract: r.from, 'Profile factor': Math.round(r.fac * 10000) / 10000, 'Your price €/MWh': r2(r.F * r.fac) }))
        .concat([{ Month: 'Total', 'Volume MWh': r2(o.fixed.E / 1000), 'Forward base €/MWh': r2(o.fixed.base), 'Profile factor': Math.round(o.fixed.factor * 10000) / 10000, 'Your price €/MWh': r2(o.fixed.energy) },
          { Month: 'Capacity €/MWh', 'Your price €/MWh': r2(o.fixed.cap) }, { Month: 'Energy + capacity €/MWh', 'Your price €/MWh': r2(o.fixed.total) },
          { Month: 'Excludes grid fees, taxes, guarantees of origin, supplier margin and risk premium' }]));
      if (o.bill) add('Bill', o.bill.lines.map(l => Object.assign({ Component: l.label, 'Supplier only €': r2(l.a), 'Supplier only €/MWh': r2(l.a / o.bill.E) }, o.bill.acc ? { 'With ACC €': r2(l.b), 'With ACC €/MWh': r2(l.b / o.bill.E) } : {}, { Basis: l.note.replace(/<[^>]+>/g, '') }))
        .concat([Object.assign({ Component: 'Total before VAT', 'Supplier only €': r2(o.bill.tA), 'Supplier only €/MWh': r2(o.bill.tA / o.bill.E) }, o.bill.acc ? { 'With ACC €': r2(o.bill.tB), 'With ACC €/MWh': r2(o.bill.tB / o.bill.E) } : {})]));
      add('Monthly', Object.keys(o.monthly).sort().map(m => ({ Month: m, 'Consumption MWh': r2(o.monthly[m].E / 1000), 'Location-based t CO2': r2(o.monthly[m].em / 1e6), 'Spot cost €': r2(o.monthly[m].cost) })));
      add('Daily', o.daily.map(x => ({ Date: x.d, 'Consumption kWh': r2(x.E), 'Intensity g/kWh': r2(x.ci) })));
      add('Average day', HRS.map((h, i) => ({ Hour: h, 'Consumption kWh': r2(o.hourC[i] / o.days.length), 'Grid intensity g/kWh': o.hourN[i] ? r2(o.hourI[i] / o.hourN[i]) : null, 'Day-ahead €/MWh': o.hourPn[i] ? r2(o.hourP[i] / o.hourPn[i]) : null })));
      download(`PowerKlock_carbon_${o.days[0]}_${o.days[o.days.length - 1]}.xlsx`, new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    } catch (e) { console.warn('[carbon] xlsx', e); }
    if (b) b.textContent = '⤓ Excel';
  }
  function template() {
    download('powerklock-load-curve-template.csv', new Blob([['timestamp;kWh', '2025-01-01 00:00;12.4', '2025-01-01 00:15;12.1', '2025-01-01 00:30;11.9'].join('\n')], { type: 'text/csv' }));
  }

  function wire() {
    const page = $('page-carbonfoot'); if (!page || page.dataset.wired) return;
    page.dataset.wired = '1';
    const file = $('cf-file'), drop = $('cf-drop');
    const read = async f => { $('cf-status').textContent = _c('Lecture de ', 'Reading ') + f.name + '…'; try { await load(await readFile(f), f.name); } catch (e) { $('cf-status').textContent = e.message; } };
    file.addEventListener('change', async () => { const f = file.files[0]; if (f) await read(f); file.value = ''; });
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('on'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('on'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) read(f); });
    [['cf-ex-metric', 'metric'], ['cf-ex-grid', 'grid']].forEach(([id, k]) => { const e = $(id); if (e) e.addEventListener('change', () => { EX[k] = e.value; if (S.res) { renderExplore(S.res); $('cf-ex-detail').innerHTML = `<div class="fuel-note">${_c('Cliquez une case de la matrice, un mois ou une heure, ou un jour du calendrier ci-dessous.', 'Click a cell of the matrix, a month or an hour, or a day of the calendar below.')}</div>`; } }); });
    $('cf-example').addEventListener('click', () => load(example(), _c('Exemple : immeuble de bureaux, 2025', 'Example: office building, 2025')));
    const see = $('cf-see'); if (see) see.addEventListener('click', () => { const t = tabBtn('Overview'); if (t) t.click(); });
    const ppt = $('cf-ppt'); if (ppt) ppt.addEventListener('click', () => clientSheet(ppt));
    const ct = $('cf-contracts'); if (ct) { if (+S.settings.go || +S.settings.ppa || S.settings.supplier) ct.open = true; ct.addEventListener('toggle', () => { if (ct.open) steps(2); }); }
    $('cf-template').addEventListener('click', template);
    $('cf-export').addEventListener('click', exportCSV);
    $('cf-xlsx').addEventListener('click', exportXlsx);
    const am = $('cf-accday-m'); if (am) am.addEventListener('change', () => { if (S.res) renderAccDay(S.res); });
    // France / Belgium: the fields that only exist in one country
    const beUI = () => { const be = /^BE/.test(S.settings.country || 'FR'), lab = (id, fr, bel) => { const e = $(id); const sp = e && e.closest('.cf-field') && e.closest('.cf-field').querySelector('span'); if (sp) sp.textContent = be ? bel : fr; };
      document.querySelectorAll('#page-carbonfoot .cf-be').forEach(e => { e.hidden = !be; });
      ['cf-fix-cee', 'cf-fix-conn', 'cf-fix-net'].forEach(id => { const f = $(id) && $(id).closest('.cf-field'); if (f) f.hidden = be; });
      lab('cf-fix-turpe', _c('TURPE part variable', 'TURPE variable part'), _c('Frais de réseau, variable (grille du GRD)', 'Grid fees, variable (DSO card)')); lab('cf-fix-turpefix', _c('TURPE part fixe', 'TURPE fixed part'), _c('Frais de réseau, fixe', 'Grid fees, fixed')); };
    const cty = $('cf-fix-country'); if (cty) { cty.value = S.settings.country || 'FR'; cty.addEventListener('change', () => setTimeout(beUI, 0)); setTimeout(beUI, 0); }
    const bind = (id, key, rebuild) => { const el = $(id); if (el) el.addEventListener('change', e => { S.settings[key] = e.target.value; if (S.raw) (rebuild ? load(S.raw, S.meta) : run()); }); };
    bind('cf-unit', 'unit', true); bind('cf-stamp', 'stamp', true);
    ['go', 'ppa', 'ppa-tech:ppaTech', 'supplier', 'residual', 'rm-country:rmCountry', 'annual:annualFactor', 'flex-pct:flexPct', 'flex-goal:flexGoal', 'pv-kwp:pvKwp', 'pv-yield:pvYield', 'fix-period:fixPeriod',
      'fix-country:country', 'fix-gc:gc', 'fix-conn:conn', 'fix-margin:margin', 'fix-cee:cee', 'fix-go:goP', 'fix-turpe:turpe', 'fix-turpefix:turpeFix', 'fix-net:net', 'acc-turpe:turpeAcc', 'acc-risk:accRisk', 'acc-kwc:accKwc', 'acc-key:accKey', 'acc-yield:accYield', 'acc-price:accPrice', 'acc-pmo:pmo'].forEach(x => { const [id, key] = x.split(':'); bind('cf-' + id, key || id); });
  }

  window.addEventListener('load', () => setTimeout(() => {
    wire();
    PK.onPage('carbonfoot', wire);
  }, 0));
  window.PKCarbonTool = { load, example, compute: () => compute(), state: S };
  // Shared with the PPA pricer: read a CSV / Excel curve into quarter-hour energy per Paris day
  window.PKLoadCurve = { readFile, build: (rows, opts) => buildCurve(rows, opts || { unit: 'auto', stamp: 'auto' }) };
})();
