// ════════════════════════════════════════════════════════════════════
// COMMODITIES — gas, carbon, coal, oil, FX and FR nuclear availability
// Source: data/commodities.json (last ~400 days, every page) and
// data/history/commodities_series.json (full history, on demand), both
// written by scripts/fetch_commodities.py from SEFE's public cockpit.
//
// Also the single home of the fuel-cost conventions used for clean spark /
// clean dark spreads, so every page computes them the same way.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const BASE = (typeof DATA_BASE !== 'undefined' && DATA_BASE) ? DATA_BASE : 'data/';
  let light = null, full = null, fullPromise = null;

  const ready = fetch(BASE + 'commodities.json?t=' + Date.now())
    .then(r => r.ok ? r.json() : null)
    .then(j => { light = j; return j; })
    .catch(() => null);

  function loadFull() {
    if (full) return Promise.resolve(full);
    if (!fullPromise) {
      fullPromise = fetch(BASE + 'history/commodities_series.json?t=' + Date.now())
        .then(r => r.ok ? r.json() : null)
        .then(j => { full = j; return j; })
        .catch(() => null);
    }
    return fullPromise;
  }

  function src(useFull) { return (useFull && full) ? full : light; }
  function meta(key) { const s = src(true); return s && s.series && s.series[key] || null; }
  function pts(key, useFull) { const s = src(useFull); return (s && s.series && s.series[key] && s.series[key].points) || []; }

  // Latest close and change vs the previous close.
  function last(key) {
    const p = pts(key);
    if (!p.length) return null;
    const [d, v] = p[p.length - 1];
    // The cockpit repeats the last settlement over weekends / holidays:
    // compare with the last *different* close (within 7 points).
    let prev = null;
    for (let k = p.length - 2; k >= Math.max(0, p.length - 8); k--) { if (p[k][1] !== v) { prev = p[k]; break; } }
    if (!prev && p.length > 1) prev = p[p.length - 2];
    return {
      d, v,
      prevD: prev ? prev[0] : null,
      prev: prev ? prev[1] : null,
      chg: prev ? v - prev[1] : null,
      pct: prev && prev[1] ? (v / prev[1] - 1) * 100 : null,
    };
  }

  // Last close on or before dateISO (binary search over the sorted points).
  function valueOn(key, dateISO, useFull) {
    const p = pts(key, useFull);
    let lo = 0, hi = p.length - 1, ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (p[mid][0] <= dateISO) { ans = p[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return ans ? ans[1] : null;
  }

  // Map of date → value, convenient for joins with daily power series.
  function asMap(key, useFull) {
    const m = new Map();
    pts(key, useFull).forEach(([d, v]) => m.set(d, v));
    return m;
  }

  // ── Generation-cost conventions (one place, used site-wide) ──────────
  // CCGT: 49.13% HHV-equivalent efficiency is the market convention for
  // clean spark quotes; natural gas emits 0.202 tCO2/MWh_th.
  // Coal: 36% efficiency, API2 6,000 kcal/kg ⇒ 6.978 MWh_th/t, 0.341 tCO2/MWh_th.
  const FUEL = {
    gasEff: 0.4913, gasEF: 0.202,
    coalEff: 0.36, coalMWhPerT: 6.978, coalEF: 0.341,
  };
  FUEL.gasCO2 = FUEL.gasEF / FUEL.gasEff;     // ≈ 0.411 tCO2/MWh_e
  FUEL.coalCO2 = FUEL.coalEF / FUEL.coalEff;  // ≈ 0.947 tCO2/MWh_e

  function gasCost(ttf) { return ttf / FUEL.gasEff; }
  function coalCost(coalUsd, eurusd) { return (coalUsd / eurusd) / (FUEL.coalMWhPerT * FUEL.coalEff); }
  function cleanSpark(power, ttf, eua) {
    if (power == null || ttf == null || eua == null) return null;
    return power - gasCost(ttf) - eua * FUEL.gasCO2;
  }
  function cleanDark(power, coalUsd, eurusd, eua) {
    if (power == null || coalUsd == null || !eurusd || eua == null) return null;
    return power - coalCost(coalUsd, eurusd) - eua * FUEL.coalCO2;
  }
  // EUA price at which a CCGT and a coal unit have the same short-run cost.
  function switchPrice(ttf, coalUsd, eurusd) {
    if (ttf == null || coalUsd == null || !eurusd) return null;
    return (gasCost(ttf) - coalCost(coalUsd, eurusd)) / (FUEL.coalCO2 - FUEL.gasCO2);
  }
  // Fuel references for a delivery day: day-ahead gas traded the day before,
  // carbon/coal last close on or before that day.
  function refsFor(dateISO) {
    const prev = (() => { const [y, m, d] = dateISO.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d - 1)); return t.toISOString().slice(0, 10); })();
    return {
      ttf: valueOn('ttf', prev) ?? valueOn('ttf', dateISO),
      eua: valueOn('eua', dateISO),
      coal: valueOn('coal', dateISO),
      eurusd: valueOn('eurusd', dateISO),
    };
  }

  // ── Ticker items ─────────────────────────────────────────────────────
  function tickerItems() {
    const out = [];
    const add = (cat, catLabel, key, name, unit, dp) => {
      const l = last(key);
      if (!l) return;
      out.push({
        cat, catLabel, name, unit,
        val: l.v.toFixed(dp),
        chg: l.pct == null ? '' : (l.pct >= 0 ? '▲' : '▼') + Math.abs(l.pct).toFixed(2) + '%',
        up: l.pct == null ? null : l.pct >= 0,
      });
    };
    add('gas', 'GAS', 'ttf', 'TTF DA', '€/MWh', 2);
    add('gas', 'GAS', 'peg', 'PEG DA', '€/MWh', 2);
    add('gas', 'GAS', 'the', 'THE DA', '€/MWh', 2);
    add('gas', 'GAS', 'nbp', 'NBP DA', 'p/th', 2);
    add('carbon', 'CARBON', 'eua', 'EUA ' + contractLabel('eua'), '€/t', 2);
    add('fuels', 'COAL', 'coal', 'API2 ' + contractLabel('coal'), '$/t', 2);
    add('fuels', 'OIL', 'brent', 'Brent M+1', '$/bbl', 2);
    return out.concat(goItems);
  }

  // GO Cal+1 mid (Commerg weekly) for the ticker, read from go_prices.csv
  // after first paint so it never delays the page.
  let goItems = [];
  function loadGoTicker() {
    fetch(BASE + 'go_prices.csv?t=' + Date.now()).then(r => r.ok ? r.text() : null).then(text => {
      if (!text) return;
      const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
      const head = lines[0].split(',');
      const ix = n => head.indexOf(n);
      const iMail = ix('mail_date'), iProd = ix('product'), iYear = ix('year'), iBid = ix('bid'), iAsk = ix('ask');
      const calY = String(new Date().getFullYear() + 1);
      const want = { 'GO AIB Renewable': 'GO Renew', 'GO AIB Wind': 'GO Wind' };
      const byProd = {};
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(',');
        if (!want[c[iProd]] || c[iYear] !== calY) continue;
        const bid = parseFloat(c[iBid]), ask = parseFloat(c[iAsk]);
        const mid = (!isNaN(bid) && !isNaN(ask)) ? (bid + ask) / 2 : (!isNaN(bid) ? bid : (!isNaN(ask) ? ask : null));
        if (mid == null) continue;
        (byProd[c[iProd]] = byProd[c[iProd]] || []).push([c[iMail], mid]);
      }
      goItems = Object.entries(byProd).map(([prod, rows]) => {
        rows.sort((a, b) => a[0] < b[0] ? -1 : 1);
        const [, v] = rows[rows.length - 1];
        const pv = rows.length > 1 ? rows[rows.length - 2][1] : null;
        const pct = pv ? (v / pv - 1) * 100 : null;
        return { cat: 'go', catLabel: 'GO', name: want[prod] + ' Cal-' + calY.slice(-2), unit: '€/MWh', val: v.toFixed(2),
          chg: pct == null ? '' : (pct >= 0 ? '▲' : '▼') + Math.abs(pct).toFixed(1) + '% w/w', up: pct == null ? null : pct >= 0 };
      });
      if (typeof buildTicker === 'function' && typeof pricesData !== 'undefined' && pricesData && pricesData.length) buildTicker(pricesData);
    }).catch(() => {});
  }
  setTimeout(loadGoTicker, 2500);

  // 'CO2 EUA Dec 2026' → 'Dec-26', 'Coal ARA CIF Cal2027' → 'Cal-27'
  function contractLabel(key) {
    const c = (meta(key) || {}).contract || '';
    let m = c.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s?(\d{2,4})$/);
    if (m) return m[1] + '-' + m[2].slice(-2);
    m = c.match(/Cal\s?(\d{4})$/);
    if (m) return 'Cal-' + m[1].slice(-2);
    return '';
  }

  window.PKC = {
    ready, loadFull, meta, pts, last, valueOn, asMap, refsFor, contractLabel,
    FUEL, gasCost, coalCost, cleanSpark, cleanDark, switchPrice, tickerItems,
    get data() { return light; },
    get updated() { return light && light.updated; },
  };

  // Rebuild the ticker once market data is in (power data may already be).
  ready.then(() => {
    try {
      if (typeof buildTicker === 'function' && typeof pricesData !== 'undefined' && pricesData && pricesData.length) buildTicker(pricesData);
    } catch (_) {}
  });
})();
