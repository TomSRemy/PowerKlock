// js/prices/envelope.js — Prices: historical envelope per zone, bands.
// Part of the former js/prices.js (lines 1659–2249), split without changes: plain scripts loaded in this order
// by index.html, sharing their globals as before.
// ════════════════════════════════════════════
// fetchHistoricalEnvelopeP — fetches per-zone historical envelope
// (P0/P10/P50/P90/P100) over the last nDays. Resampled to nPts.
// Extracted from the legacy globals.js (which isn't loaded as a script).
// Cached on window._envelopePCache to avoid re-fetching the same window.
// ════════════════════════════════════════════
async function fetchHistoricalEnvelopeP(code, nDays, nPts) {
  const cacheKey = `${code}|${nDays}|${nPts}`;
  window._envelopePCache = window._envelopePCache || {};
  if (window._envelopePCache[cacheKey]) return window._envelopePCache[cacheKey];

  const today = new Date();
  const dates = [];
  if (nDays === -1) {
    // YTD: every day of current year before today
    const yr = today.getFullYear();
    for (let i = 1; i <= 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      if (d.getFullYear() === yr) dates.push(d.toISOString().slice(0,10));
    }
  } else {
    // Sliding window of nDays (0 → 5y cap)
    const limit = nDays === 0 ? 5 * 365 : nDays;
    for (let i = 1; i <= limit; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0,10));
    }
  }

  const all = [];
  await Promise.all(dates.map(async (dt) => {
    try {
      const r = await fetch(`data/history/daily/${dt}.json`);
      if (!r.ok) return;
      const j = await r.json();
      let z = null;
      if (j.zones && j.zones[code]) z = j.zones[code];
      else if (Array.isArray(j.zones)) z = j.zones.find(x => x.code === code);
      if (!z) return;
      const h = z.hourly || z.h;
      if (!Array.isArray(h) || !h.length) return;
      // Resample to the requested nPts using bucket-mean
      const ratio = h.length / nPts;
      const resampled = [];
      for (let i = 0; i < nPts; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.max(start + 1, Math.floor((i+1) * ratio));
        const slice = h.slice(start, end).filter(v => v != null);
        resampled.push(slice.length ? slice.reduce((a,b)=>a+b,0) / slice.length : null);
      }
      all.push(resampled);
    } catch (e) { /* silent — 404 on dates with no data is expected */ }
  }));

  if (!all.length) {
    console.warn(`[fetchHistoricalEnvelopeP] no data found for ${code} over ${nDays}d (cache key ${cacheKey})`);
    return null;
  }
  console.log(`[fetchHistoricalEnvelopeP] ${code}: aggregated ${all.length}/${dates.length} days`);

  // Linear interpolation percentile
  const _pct = (sortedArr, p) => {
    if (!sortedArr.length) return null;
    if (sortedArr.length === 1) return sortedArr[0];
    const rank = p * (sortedArr.length - 1);
    const lo = Math.floor(rank), hi = Math.ceil(rank);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (rank - lo);
  };

  const p0 = [], p10 = [], p50 = [], p90 = [], p100 = [];
  for (let i = 0; i < nPts; i++) {
    const vals = all.map(arr => arr[i]).filter(v => v != null).sort((a,b)=>a-b);
    if (!vals.length) { p0.push(null); p10.push(null); p50.push(null); p90.push(null); p100.push(null); continue; }
    p0.push(vals[0]);
    p10.push(_pct(vals, 0.10));
    p50.push(_pct(vals, 0.50));
    p90.push(_pct(vals, 0.90));
    p100.push(vals[vals.length - 1]);
  }

  const result = { p0, p10, p50, p90, p100, n: all.length };
  window._envelopePCache[cacheKey] = result;
  return result;
}
window.fetchHistoricalEnvelopeP = fetchHistoricalEnvelopeP;

async function _loadAndApplyRowBand(idx, z) {
  window._drillBandWindow = window._drillBandWindow || {};
  const cur = window._drillBandWindow[idx] || 'off';
  const chart = _rowCharts[idx];
  if (!chart) return;
  if (cur === 'off') {
    _removeBandDatasets(chart);
    // Auto-restore J-1 visibility when bands turn off (only if the user
    // didn't manually hide it via the legend in the meantime).
    _setJ1Hidden(chart, false);
    chart.update('none');
    _syncRowChartToFullscreen(chart);
    _clearBreakdownBandStats(idx);
    _clearBreakdownTableP50(idx);
    return;
  }
  const opt = _ROW_BAND_OPTIONS.find(o => o.key === cur);
  if (!opt) return;
  const nPts = chart.data.datasets[0]?.data?.length || 96;
  if (typeof fetchHistoricalEnvelopeP !== 'function') return;
  let env;
  try {
    env = await fetchHistoricalEnvelopeP(z.code, opt.days, nPts);
  } catch (e) {
    console.warn('[row-band] fetch failed', e);
    return;
  }
  if (!env) return;
  if ((window._drillBandWindow[idx] || 'off') !== cur) return;
  _removeBandDatasets(chart);
  // Steel-blue palette for historical bands — distinguishes the past clearly
  // from the mint-coloured today and the dashed grey J-1.
  chart.data.datasets.push(
    {
      label: `Range 0-100% (${opt.label})`, data: env.p100,
      borderColor: 'rgba(56,116,203,0.20)', backgroundColor: 'rgba(56,116,203,0.10)',
      borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
      fill: '+1', order: 8,
    },
    {
      label: '__band_outer_min', data: env.p0,
      borderColor: 'rgba(56,116,203,0.20)', backgroundColor: 'transparent',
      borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
      fill: false, order: 8,
    },
    {
      label: `Typical 10-90% (${opt.label})`, data: env.p90,
      borderColor: 'rgba(56,116,203,0.40)', backgroundColor: 'rgba(56,116,203,0.22)',
      borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
      fill: '+1', order: 7,
    },
    {
      label: '__band_inner_min', data: env.p10,
      borderColor: 'rgba(56,116,203,0.40)', backgroundColor: 'transparent',
      borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
      fill: false, order: 7,
    },
    {
      label: `Median ${opt.label}`, data: env.p50,
      borderColor: 'rgba(120,170,230,0.95)', borderWidth: 1.4, pointRadius: 0,
      tension: 0, spanGaps: true, fill: false, borderDash: [3, 3], order: 6,
    }
  );
  // Auto-hide J-1 once a band is active — the historical envelope already
  // provides comparable context, and J-1 clutters the chart. User can
  // re-show J-1 anytime by clicking its legend entry.
  _setJ1Hidden(chart, true);
  chart.update('none');
  // ── Propagate to the fullscreen chart if open (so the band shows there too) ──
  _syncRowChartToFullscreen(chart);
  // Update the breakdown stats line for this drill-down (median, today percentile, divergence)
  _updateBreakdownBandStats(idx, z, env, opt.label);
  // Update the breakdown table cells: show P50 + vs P50 columns per slot
  _updateBreakdownTableP50(idx, z, env, opt.label);
}

// When a fullscreen overlay (pkOpenFullscreen) is open and tracks _fsChart,
// copy the inline chart's datasets so they stay in sync.
function _syncRowChartToFullscreen(srcChart) {
  const fs = document.getElementById('pk-fs-overlay');
  if (!fs || !fs._fsChart) return;
  try {
    fs._fsChart.data.datasets = JSON.parse(JSON.stringify(srcChart.data.datasets));
    fs._fsChart.update('none');
  } catch (e) {
    console.warn('[fs] sync to fullscreen chart failed', e);
  }
}
window._loadAndApplyRowBand = _loadAndApplyRowBand;

// Compute & inject the band stats line for a drill-down:
//   Period · Median · Today percentile · Today vs median · Max divergence
function _updateBreakdownBandStats(idx, z, env, periodLabel) {
  const host = document.getElementById(`row-band-stats-${idx}`);
  if (!host || !env) return;

  // Today's hourly (96 × 15min or 24h) — pick the array used by the chart
  const todayRaw = (z.hourly && z.hourly.length) ? z.hourly : (z.h24 || []);
  const nPts = env.p50.length;
  // Resample today to nPts (same logic as in fetchHistoricalEnvelopeP)
  const today = [];
  if (todayRaw.length === nPts) {
    today.push(...todayRaw);
  } else {
    const ratio = todayRaw.length / nPts;
    for (let i = 0; i < nPts; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.max(start + 1, Math.floor((i+1) * ratio));
      const slice = todayRaw.slice(start, end).filter(v => v != null);
      today.push(slice.length ? slice.reduce((a,b)=>a+b,0) / slice.length : null);
    }
  }

  // Median (single value = mean of P50 slots, weighted equally)
  const validMed = env.p50.filter(v => v != null);
  const medianAvg = validMed.length ? validMed.reduce((a,b)=>a+b,0) / validMed.length : null;

  // Today's avg
  const validToday = today.filter(v => v != null);
  const todayAvg = validToday.length ? validToday.reduce((a,b)=>a+b,0) / validToday.length : null;

  // Today percentile: rank today's avg within the distribution of all historical slot values
  // We use the union of all env.p0...p100 per-slot data, then count how many are below todayAvg.
  // Simpler & robust: compare each slot to its (p0..p100) — count fraction of slot ranks where today >= that slot's percentile range.
  // Even simpler: for the daily avg, rank against the daily P50 distribution.
  // Use a slot-by-slot percentile approach: for each slot, compute today's percentile in [p0, p50, p100] (linear interpolation).
  // Then aggregate as mean percentile across slots.
  const slotPercentiles = [];
  for (let i = 0; i < nPts; i++) {
    const t = today[i], p0 = env.p0[i], p10 = env.p10[i], p50 = env.p50[i], p90 = env.p90[i], p100 = env.p100[i];
    if (t == null || p0 == null || p100 == null) continue;
    // Piecewise linear interpolation: P0 → P10 → P50 → P90 → P100
    let pct;
    if (t <= p0) pct = 0;
    else if (t >= p100) pct = 100;
    else if (t <= p10) pct = 10 * (t - p0) / Math.max(p10 - p0, 0.01);
    else if (t <= p50) pct = 10 + 40 * (t - p10) / Math.max(p50 - p10, 0.01);
    else if (t <= p90) pct = 50 + 40 * (t - p50) / Math.max(p90 - p50, 0.01);
    else               pct = 90 + 10 * (t - p90) / Math.max(p100 - p90, 0.01);
    slotPercentiles.push(pct);
  }
  const todayPercentile = slotPercentiles.length
    ? slotPercentiles.reduce((a,b)=>a+b,0) / slotPercentiles.length
    : null;

  // Today vs median (€/MWh)
  const todayVsMedian = (todayAvg != null && medianAvg != null) ? (todayAvg - medianAvg) : null;

  // Max divergence: largest signed gap (today - p50) across slots, with slot label
  let maxDiv = null, maxDivSlot = null;
  for (let i = 0; i < nPts; i++) {
    if (today[i] == null || env.p50[i] == null) continue;
    const diff = today[i] - env.p50[i];
    if (maxDiv == null || Math.abs(diff) > Math.abs(maxDiv)) {
      maxDiv = diff;
      maxDivSlot = i;
    }
  }
  const slotToHour = (i) => {
    // If 96 slots, each = 15min; if 24, each = 1h
    if (nPts === 96) {
      const h = Math.floor(i / 4), m = (i % 4) * 15;
      return `${String(h).padStart(2,'0')}h${m === 0 ? '' : String(m).padStart(2,'0')}`;
    }
    return `${String(i).padStart(2,'0')}h`;
  };

  // Color helpers
  const pctCol = todayPercentile == null ? 'var(--tx3)' : (todayPercentile > 80 ? '#ED6965' : todayPercentile < 20 ? '#14D3A9' : 'var(--tx)');
  const vsMedCol = todayVsMedian == null ? 'var(--tx3)' : (todayVsMedian > 0 ? '#ED6965' : '#14D3A9');
  const divCol = maxDiv == null ? 'var(--tx3)' : (maxDiv > 0 ? '#ED6965' : '#14D3A9');
  const sign = v => v >= 0 ? '+' : '';

  // The separate grey "Today vs 7D band · Median … · Percentile …" line
  // has been merged into the amber Market Read banner below.
  // Keep the host hidden so its DOM stays in place (referenced elsewhere).
  host.innerHTML = '';
  host.style.display = 'none';

  // Extend Market Read banner with a richer "vs band" sentence containing
  // the median, percentile, today vs median delta and max divergence.
  const banderSpan = document.getElementById(`row-market-read-band-${idx}`);
  if (banderSpan) {
    if (todayPercentile != null && todayVsMedian != null) {
      let qualifier;
      if (todayPercentile >= 80) qualifier = `<span style="color:#ED6965;font-weight:600">expensive</span>`;
      else if (todayPercentile <= 20) qualifier = `<span style="color:#14D3A9;font-weight:600">cheap</span>`;
      else qualifier = `<span style="color:var(--tx)">in line</span>`;

      const divPart = (maxDiv != null && maxDivSlot != null)
        ? ` Max divergence <span style="color:${divCol};font-weight:600">${sign(maxDiv)}${maxDiv.toFixed(2)} €/MWh</span> at ${slotToHour(maxDivSlot)}.`
        : '';

      banderSpan.innerHTML = ` <span style="display:block;margin-top:4px;padding-top:4px;border-top:1px dashed rgba(251,191,36,0.25);font-style:italic">Today vs ${periodLabel}: sits at <span style="color:${pctCol};font-weight:600">P${todayPercentile.toFixed(0)}</span> — ${qualifier} with <span style="color:${vsMedCol};font-weight:600">${sign(todayVsMedian)}${todayVsMedian.toFixed(2)} €/MWh</span> vs median (${medianAvg != null ? medianAvg.toFixed(2) : '--'}).${divPart}</span>`;
    } else {
      banderSpan.innerHTML = '';
    }
  }
}

function _clearBreakdownBandStats(idx) {
  const host = document.getElementById(`row-band-stats-${idx}`);
  if (host) {
    host.innerHTML = '';
    host.style.display = 'none';
  }
  // Also clear the "vs band" sentence in the Market Read banner
  const banderSpan = document.getElementById(`row-market-read-band-${idx}`);
  if (banderSpan) banderSpan.innerHTML = '';
}

// Show / update the P50 + vs P50 columns in the breakdown table for a given row idx.
// env = { p0, p10, p50, p90, p100 } (from fetchHistoricalEnvelopeP).
// periodLabel = '7D' | '1M' etc. (shown in the header).
function _updateBreakdownTableP50(idx, z, env, periodLabel) {
  if (!env || !env.p50) return;
  // Show the columns (headers + cells) — they are display:none by default
  document.querySelectorAll(`th.bd-p50-h, th.bd-vsp50-h`).forEach(el => el.style.display = '');
  document.querySelectorAll(`td.bd-p50-cell, td.bd-vsp50-cell`).forEach(el => el.style.display = '');
  // Update header label with current period
  const hdr = document.getElementById(`bd-p50-header-${idx}`);
  if (hdr) hdr.textContent = `(${periodLabel})`;

  // Resample today to env's nPts (same as chart datasets)
  const nPts = env.p50.length;
  const todayRaw = (z.hourly && z.hourly.length) ? z.hourly : (z.h24 || []);
  let today = [];
  if (todayRaw.length === nPts) today = todayRaw;
  else {
    const ratio = todayRaw.length / nPts;
    for (let i = 0; i < nPts; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.max(start + 1, Math.floor((i+1) * ratio));
      const slice = todayRaw.slice(start, end).filter(v => v != null);
      today.push(slice.length ? slice.reduce((a,b)=>a+b,0) / slice.length : null);
    }
  }

  // Resolve table data length (may be 96 if 15min, or 24 if hourly). Cells in DOM are based on tblData.
  // We assume tblData.length === env.p50.length (both 96 by default). If not, resample.
  const cells = document.querySelectorAll(`td[data-bd-p50-row^="${idx}-"]`);
  cells.forEach(cell => {
    const slotIdx = parseInt(cell.dataset.bdP50Row.split('-')[1], 10);
    if (isNaN(slotIdx) || slotIdx >= env.p50.length) return;
    const p50 = env.p50[slotIdx];
    cell.textContent = p50 != null ? p50.toFixed(2) : '--';
    cell.style.color = 'var(--tx2)';
  });
  document.querySelectorAll(`td[data-bd-vsp50-row^="${idx}-"]`).forEach(cell => {
    const slotIdx = parseInt(cell.dataset.bdVsp50Row.split('-')[1], 10);
    if (isNaN(slotIdx) || slotIdx >= env.p50.length) return;
    const p50 = env.p50[slotIdx];
    const t = today[slotIdx];
    if (p50 == null || t == null) { cell.textContent = '--'; cell.style.color = 'var(--tx3)'; return; }
    const diff = t - p50;
    const sign = diff >= 0 ? '+' : '';
    cell.textContent = `${sign}${diff.toFixed(2)}`;
    cell.style.color = diff > 5 ? '#ED6965' : diff < -5 ? '#14D3A9' : 'var(--tx2)';
  });
}

function _clearBreakdownTableP50(idx) {
  // Hide the columns (cells in breakdown for this idx)
  document.querySelectorAll(`th.bd-p50-h, th.bd-vsp50-h`).forEach(el => el.style.display = 'none');
  document.querySelectorAll(`td.bd-p50-cell, td.bd-vsp50-cell`).forEach(el => el.style.display = 'none');
}

// Compute today's KPI values for a zone, fetch J-1 from history, and apply
// matching border-left colour + sub-text tint based on direction (±1 €/MWh)
async function applyExpandKPIColours(idx, z, today) {
  const displayDate = window._currentPriceDate || window.DP?.selectedDate || pkTodayISO();
  if (typeof fetchHistoricalDaily !== 'function') return;
  // Files are named by DELIVERY date: J-1's file = displayDate − 1.
  const [yy,mm,dd] = displayDate.split('-').map(Number);
  const j1Auc = new Date(Date.UTC(yy, mm-1, dd));
  j1Auc.setUTCDate(j1Auc.getUTCDate() - 1);
  const j1FileISO = j1Auc.toISOString().slice(0,10);
  const yData = await fetchHistoricalDaily(j1FileISO);
  if (!yData) return;
  const yz = yData.zones[z.code];
  if (!yz) return;

  // Compute J-1 reference values for this zone on raw slots
  const yHourly = yz.hourly || [];
  const yValid  = yHourly.filter(v => v != null);
  if (yValid.length === 0) return;
  const yAvg = yValid.reduce((a,b)=>a+b,0) / yValid.length;
  const yMin = Math.min(...yValid);
  const yMax = Math.max(...yValid);

  const yNph = yHourly.length > 24 ? Math.round(yHourly.length / 24) : 1;
  const yPeak = [], yOff = [];
  yHourly.forEach((v, i) => {
    if (v == null) return;
    const hr = Math.floor(i / yNph);
    (hr >= 8 && hr < 20 ? yPeak : yOff).push(v);
  });
  const yPeakAvg = yPeak.length ? yPeak.reduce((a,b)=>a+b,0)/yPeak.length : null;
  const yOffAvg  = yOff.length  ? yOff.reduce((a,b)=>a+b,0)/yOff.length   : null;

  const apply = (kpiKey, todayVal, yVal) => {
    const card = document.getElementById(`row-kpi-${idx}-${kpiKey}`);
    if (!card) return;
    const chg = card.querySelector('.row-kpi-chg');
    card.classList.remove('kpi-up','kpi-down','kpi-flat');
    if (todayVal == null || yVal == null) {
      card.classList.add('kpi-flat');
      if (chg) { chg.style.color = 'var(--text3)'; chg.textContent = '--'; }
      return;
    }
    const delta = todayVal - yVal;
    let cls = 'kpi-flat', subColor = 'var(--text3)';
    if (Math.abs(delta) >= 1) {
      if (delta > 0) { cls = 'kpi-down'; subColor = 'var(--down)'; }
      else           { cls = 'kpi-up';   subColor = 'var(--up)'; }
    }
    card.classList.add(cls);
    if (chg) {
      chg.style.color = subColor;
      if (Math.abs(delta) < 0.5) {
        chg.textContent = '≈ 0 vs J-1';
      } else {
        const arrow = delta > 0 ? '▲' : '▼';
        const sign  = delta > 0 ? '+' : '';
        chg.textContent = `${arrow} ${sign}${delta.toFixed(1)} vs J-1`;
      }
    }
  };

  // Updated to match the 6-KPI layout (Avg / Peak-Off / Extremes+Neg / σ / Spread / Mix).
  // For merged cards (peakoff, extremes, mix) we colour the card but skip the
  // chg label since they use customHtml and don't have a single delta value.
  apply('avg',      today.avg,                yAvg);
  apply('peakoff',  today.peakAvg,            yPeakAvg);   // colour by peak delta (representative)
  apply('extremes', today.maxV,               yMax);       // colour by max delta (representative)
  // sigma, spread, mix: no Y-1 comparison from yesterday's single day → flat
  apply('sigma',    null, null);
  apply('spread',   null, null);
  apply('mix',      null, null);
}


// Compare-mode pool: use SERIES_POOL from globals.js (8 hand-picked + farthest-point fallback)
const COMPARE_COLORS = SERIES_POOL;

// Build a colour map for a list of zones. Priority:
//  1. ZONE_COLORS[code] if defined (FR=Mint Leaf, etc — fixed identity)
//  2. else: pick from SERIES_POOL by index, skipping colours already used
function buildZoneColorMap(zones) {
  const map = {};
  const used = new Set();
  // Pass 1: assign fixed colours from ZONE_COLORS
  zones.forEach(z => {
    const fixed = (typeof ZONE_COLORS !== 'undefined') ? ZONE_COLORS[z.code] : null;
    if (fixed) { map[z.code] = fixed; used.add(fixed.toUpperCase()); }
  });
  // Pass 2: assign generated colours, skipping ones already used by Pass 1
  let poolIdx = 0;
  zones.forEach(z => {
    if (map[z.code]) return;
    let c, guard = 0;
    do {
      c = getSeriesColor(poolIdx++);
      guard++;
    } while (used.has(c.toUpperCase()) && guard < 100);
    map[z.code] = c;
    used.add(c.toUpperCase());
  });
  return map;
}

function buildCompareDropdown() { buildCompareChips(); } // alias kept

function toggleCompareFilterPanel() {
  const panel = document.getElementById('compare-filter-panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) { positionPanel('compare-filter-panel','compare-filter-btn'); buildCompareChips(); }
  const zp = document.getElementById('zone-filter-panel');
  if (zp) zp.style.display = 'none';
}

function clearCompareZones() {
  window._compareZones = new Set();
  window._userZones = window._compareZones;
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
  document.dispatchEvent(new CustomEvent('zones-changed'));
}

function compareNeighbours() {
  window._compareZones = new Set(['FR','DE_LU','BE','NL','ES','IT_NORD','CH','AT','PT']);
  window._userZones = window._compareZones;
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
  document.dispatchEvent(new CustomEvent('zones-changed'));
}

function compareWithGenMix() {
  window._compareZones = new Set(getGenMixDefaultZones());
  window._userZones = window._compareZones;
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
  document.dispatchEvent(new CustomEvent('zones-changed'));
}

function buildCompareChips() {
  const container = document.getElementById('compare-zone-chips');
  if (!container || !window._pricesSorted) return;
  const selected = window._compareZones || new Set(['FR']);
  if (!window._zoneColorMap) {
    window._zoneColorMap = buildZoneColorMap(window._pricesSorted);
  }
  container.innerHTML = window._pricesSorted.map(z => {
    const isOn = selected.has(z.code);
    const col  = window._zoneColorMap[z.code] || '#4A6280';
    const meta = ZONE_META[z.code] || {country: z.name || z.code};
    return `<button onclick="toggleCompareChip('${z.code}')" id="chip-${z.code}" style="
      display:flex;align-items:center;gap:5px;width:100%;padding:5px 8px;border-radius:5px;font-size:11px;cursor:pointer;
      border:none;text-align:left;background:${isOn?col+'18':'transparent'};color:${isOn?col:'rgba(255,255,255,.45)'};
    ">
      <span style="width:14px;height:14px;border-radius:3px;border:1.5px solid ${isOn?col:'rgba(255,255,255,.2)'};background:${isOn?col+'33':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        ${isOn?`<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`:''}
      </span>
      <span style="font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;min-width:52px">${z.flag||''} ${z.code}</span>
      <span style="font-size:11px">${meta.country}</span>
    </button>`;
  }).join('');
  // Update label
  const lbl = document.getElementById('compare-filter-label');
  if (lbl) {
    const n = selected.size;
    lbl.textContent = n === 1 ? [...selected][0]+' selected' : `${n} zones selected`;
  }
}

function toggleCompareChip(code) {
  const allCodes = new Set((window._pricesSorted || []).map(z => z.code));

  // Si pas encore initialisé, partir de FR uniquement
  if (!window._compareZones) window._compareZones = new Set(['FR']);

  if (window._compareZones.has(code)) {
    window._compareZones.delete(code);
    // Garder au moins une zone
    if (window._compareZones.size === 0) window._compareZones.add(code);
  } else {
    window._compareZones.add(code);
  }

  // Sync global state
  window._userZones = window._compareZones;
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
  // Refresh tabbar context (chips list/highlight if Spread view)
  if (typeof _ccUpdateTabContext === 'function') {
    _ccUpdateTabContext(window._ccView || 'lines');
  }
  document.dispatchEvent(new CustomEvent('zones-changed'));
}

function renderComparePeakStrip() {
  const strip = document.getElementById('compare-peak-strip');
  if (!strip || !window._pricesSorted || !window._compareZones) return;
  const selected = window._compareZones;
  const cards = [];
  window._pricesSorted.forEach(z => {
    if (!selected.has(z.code)) return;
    const col = window._zoneColorMap?.[z.code] || '#4A6280';
    if (!z.hourly || z.hourly.length < 24) return;
    const h = z.hourly; const nph = Math.round(h.length/24);
    const pkV=[], opV=[];
    h.forEach((v,i) => { if(v==null)return; const hr=Math.floor(i/nph); (hr>=8&&hr<20?pkV:opV).push(v); });
    const pk = pkV.length ? (pkV.reduce((a,b)=>a+b,0)/pkV.length).toFixed(1) : '--';
    const op = opV.length ? (opV.reduce((a,b)=>a+b,0)/opV.length).toFixed(1) : '--';
    const spread = pkV.length && opV.length ? (pkV.reduce((a,b)=>a+b,0)/pkV.length - opV.reduce((a,b)=>a+b,0)/opV.length).toFixed(1) : '--';
    cards.push(`<div style="background:var(--bg2);border:1px solid ${col}44;border-left:3px solid ${col};border-radius:6px;padding:6px 10px;min-width:110px">
      <div style="font-size:10px;font-weight:700;color:${col};margin-bottom:4px">${z.flag} ${z.code}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:10px;color:var(--tx2)">
        <span style="color:var(--tx3)">Peak</span><span style="font-family:'JetBrains Mono',monospace">${pk}</span>
        <span style="color:var(--tx3)">Off-pk</span><span style="font-family:'JetBrains Mono',monospace">${op}</span>
        <span style="color:var(--tx3)">Spread</span><span style="font-family:'JetBrains Mono',monospace;color:${parseFloat(spread)>0?'var(--up)':'var(--tx3)'}">${spread !== '--' ? (parseFloat(spread)>0?'+':'')+spread : '--'}</span>
      </div>
    </div>`);
  });
  strip.innerHTML = cards.join('');
}

function onCompareSelectChange(sel) {
  // Legacy shim - now handled by chips
  const vals = Array.from(sel.selectedOptions).map(o => o.value);
  window._compareZones = new Set(vals.length ? vals : ['FR']);
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
}

