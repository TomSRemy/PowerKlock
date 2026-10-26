// js/hist/core.js — Historical prices: gif worker, chart helpers, individual chart renders.
// Part of the former js/hist.js (lines 1–1098), split without changes: the parts are plain scripts loaded
// in this order by index.html and share their globals as before.
// ── gif.js worker fix ──────────────────────────────────────────────────────
// gif.js spawns a Web Worker from workerScript. A cross-origin worker (jsdelivr)
// throws "SecurityError: Failed to construct 'Worker'" on GitHub Pages. Fetch the
// worker script once and serve it from a same-origin blob URL instead.
window._pkGetGifWorkerUrl = window._pkGetGifWorkerUrl || (function () {
  let cached = null;
  return async function () {
    if (cached) return cached;
    const res = await fetch('js/vendor/gif.worker.js');
    if (!res.ok) throw new Error('Failed to fetch gif.worker.js (' + res.status + ')');
    cached = URL.createObjectURL(await res.blob());
    return cached;
  };
})();

// ── Period label sync helper · maps window codes to human-friendly labels ──
function pkUpdateHistPeriodLabels(w) {
  const labels = {
    '7D': '7 days', '1M': '1 month', '3M': '3 months', '6M': '6 months',
    '1Y': '1 year', '2Y': '2 years', '5Y': '5 years', 'All': 'all time', 'YTD': 'year-to-date',
  };
  const txt = labels[w] || w;

  // Compute date range from period (mirrors pkUpdateTimeComboLabel logic in index.html)
  const fmt = (d) => {
    if (!(d instanceof Date) || isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const today = new Date();
  let dateRange = '';
  if (HIST.customRange && HIST.customRange.from && HIST.customRange.to) {
    const from = new Date(HIST.customRange.from);
    const to   = new Date(HIST.customRange.to);
    dateRange = fmt(from) + ' \u2192 ' + fmt(to);
  } else {
    const dayMap = { '7D': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '2Y': 730, '5Y': 1825 };
    if (w === 'YTD') {
      const start = new Date(today.getFullYear(), 0, 1);
      dateRange = fmt(start) + ' \u2192 ' + fmt(today);
    } else if (dayMap[w] != null) {
      const start = new Date(today);
      start.setDate(start.getDate() - dayMap[w]);
      dateRange = fmt(start) + ' \u2192 ' + fmt(today);
    }
    // 'All' → no specific range
  }

  // Builds: "3 months · 19 Feb 2026 → 21 May 2026" (Cross-zone style)
  //     or: "3 months · 19 Feb 2026 → 21 May 2026 · ENTSO-E" (DA Board style)
  const baseLabel = dateRange ? (txt + ' \u00b7 ' + dateRange) : txt;
  const boardLabel = baseLabel + ' \u00b7 ENTSO-E';

  // pr-hist-period-label-h is inside the DA Board section header (gets ENTSO-E suffix)
  const elBoard = document.getElementById('pr-hist-period-label-h');
  if (elBoard) elBoard.textContent = boardLabel;

  // pr-hmz-period-label is inside the Cross-zone section header (no ENTSO-E suffix)
  const elHmz = document.getElementById('pr-hmz-period-label');
  if (elHmz) elHmz.textContent = baseLabel;

  // pr-hist-period-label is the legacy span used in some inline text — keep short form
  const elLegacy = document.getElementById('pr-hist-period-label');
  if (elLegacy) elLegacy.textContent = txt;
}
window.pkUpdateHistPeriodLabels = pkUpdateHistPeriodLabels;

// ── Fetch helpers ──
// One download of the price history (≈15 MB) for the whole site, only when a
// page needs it, cached by the browser for the day (?v = Paris date).
window.pkSummary = function () {
  if (!window.__pkSummaryP) {
    const base = typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : './data/';
    const v = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    window.__pkSummaryP = fetch(base + 'history/summary.json?v=' + v).then(r => r.ok ? r.json() : null).catch(() => null)
      .then(s => { if (!s) window.__pkSummaryP = null; return s; });
  }
  return window.__pkSummaryP;
};
// France only, price fields only (summary_fr.json, ≈0.4 MB): what Today needs on first load. The full history is
// used instead when a page has already downloaded it; the full file when the light one is missing.
window.pkSummaryFR = function () {
  if (window.__pkSummaryP) return window.__pkSummaryP;
  if (!window.__pkSummaryFrP) {
    const base = typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : './data/';
    const v = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    window.__pkSummaryFrP = fetch(base + 'history/summary_fr.json?v=' + v).then(r => r.ok ? r.json() : null).catch(() => null)
      .then(s => s && s.zones && s.zones.FR ? s : window.pkSummary());
  }
  return window.__pkSummaryFrP;
};
async function fetchSummary() {
  if (HIST.summary) return HIST.summary;
  const s = await window.pkSummary();
  if (s) HIST.summary = s;
  return s;
}


// ── Fetch monthly summary (pre-aggregated, no hourly) ──
async function fetchMonthly(yearMonth) {
  if (HIST.monthly[yearMonth]) return HIST.monthly[yearMonth];
  try {
    const base = typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : './data/';
    const r = await fetch(base + 'history/monthly/' + yearMonth + '.json?t=' + Date.now());
    if (!r.ok) return null;
    HIST.monthly[yearMonth] = await r.json();
    return HIST.monthly[yearMonth];
  } catch { return null; }
}

async function fetchDaily(dateStr) {
  try {
    const base = typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : './data/';
    const r = await fetch(base + 'history/daily/' + dateStr + '.json?t=' + Date.now());
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Fetch every daily file in [start, end] (inclusive, 'YYYY-MM-DD' strings).
// Used by the Renewables trend/stack/capture charts, which need per-day
// solar/wind hourly arrays that only live in the daily files (summary.json
// and the monthly aggregates only carry avg/min/max/negH). Results are
// cached per-date in HIST.daily so switching window presets back and forth
// doesn't re-fetch. Batched (not all at once) to stay polite to the server;
// missing days are silently skipped. The `needGenMix` flag is accepted for
// call-site clarity but every daily file already carries whatever fields it
// has, so there is nothing extra to fetch.
async function fetchDailyRange(start, end, needGenMix) {
  const dates = [];
  let d = new Date(start + 'T00:00:00Z');
  const endD = new Date(end + 'T00:00:00Z');
  while (d <= endD) {
    dates.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  const CONCURRENCY = 24;
  const results = [];
  for (let i = 0; i < dates.length; i += CONCURRENCY) {
    const batch = dates.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(batch.map(async (ds) => {
      if (Object.prototype.hasOwnProperty.call(HIST.daily, ds)) return HIST.daily[ds];
      const day = await fetchDaily(ds);
      HIST.daily[ds] = day;
      return day;
    }));
    fetched.forEach((day) => { if (day) results.push(day); });
  }
  results.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return results;
}

// ── Section toggle: collapse is disabled (sections are always open).
// This function is still called for ID-based renderers — we ensure body
// stays "open" and trigger the render once.
function toggleHistSection(id) {
  const header = document.querySelector('#hs-' + id + ' .hist-section-header');
  const body   = document.getElementById('hs-body-' + id);
  if (!header || !body) return;
  // Always keep open (no collapse anymore)
  header.classList.add('open');
  body.classList.add('open');
  // Trigger renderer
  const renders = {
    'spot-history':     renderHistSpot,
    'hist-da':          renderHistSpot,
    'spread-history':   renderHistSpread,
    'hist-neg':         renderHistNeg,
    'neghours-history': renderHistNeg,
    'fr-neighbours':    renderHistNeighbours,
    'hist-dist':        renderHistDist,
    'distribution':     renderHistDist,
    'ren-trend':        renderHistRenTrend,
    'ren-stack':        renderHistRenStack,
    'imb-history':      renderHistImb,
    'fcr-history':      renderHistFCR,
    'eua-history':      renderHistEUA,
    'multicc':          renderCompareChart,
    'prices-main':      () => {},
  };
  if (renders[id]) renders[id]();
}

// ── Window selector ──
function setHistZone(key, zone) {
  HIST.zones = HIST.zones || {};
  HIST.zones[key] = zone;
  const renders = {
    'spot':     renderHistSpot,
    'spread':   renderHistSpread,
    'neg':      renderHistNeg,
  };
  if (renders[key]) renders[key]();
}

function getHistZone(key) {
  return (HIST.zones && HIST.zones[key]) || 'FR';
}

function setHistWindow(key, window, btn) {
  HIST.windows[key] = window;
  // Clear custom date range when preset is chosen (only for 'ho')
  if (key === 'ho') {
    HIST.customRange = null;
    const dfEl = document.getElementById('ho-date-from');
    const dtEl = document.getElementById('ho-date-to');
    if (dfEl) dfEl.value = '';
    if (dtEl) dtEl.value = '';
  }
  // Update button states (only if btn was passed — local buttons pass `this`,
  // but FS handlers and programmatic callers may omit it).
  if (btn && typeof btn.closest === 'function') {
    const wrap = btn.closest('.hist-window-btns');
    if (wrap) {
      const btns = wrap.querySelectorAll('.hw-btn');
      btns.forEach(b => b.classList.remove('active'));
    }
    if (typeof btn.classList !== 'undefined') btn.classList.add('active');
  }
  // Sync [period] labels in section titles
  if (typeof pkUpdateHistPeriodLabels === 'function') pkUpdateHistPeriodLabels(window);
  // Sync the global sticky bar period buttons
  // ho/hsz/hmz share the Historical sticky bar; dist has its own.
  if (key === 'ho' || key === 'hsz' || key === 'hmz') {
    const grp = document.getElementById('pk-gf-hist-period');
    if (grp) {
      grp.querySelectorAll('.pk-gf-btn').forEach(b => {
        if (b.dataset.w === window) b.classList.add('active');
        else b.classList.remove('active');
      });
    }
    // Mirror to the other two blocs so all three stay in sync
    HIST.windows['ho']  = window;
    HIST.windows['hsz'] = window;
    HIST.windows['hmz'] = window;
  } else if (key === 'dist') {
    const grp = document.getElementById('pk-gf-dist-period');
    if (grp) {
      grp.querySelectorAll('.pk-gf-btn').forEach(b => {
        if (String(b.dataset.w).toLowerCase() === String(window).toLowerCase()) b.classList.add('active');
        else b.classList.remove('active');
      });
    }
  }
  // Auto-tune HMZ heatmap granularity when window changes (overrides user override
  // by design: the previous Day mode in 7D doesn't make sense once switched to 1Y).
  // Only HMZ uses this; HSZ/HO have their own logic.
  if (key === 'hmz' || key === 'ho' || key === 'hsz') {
    // ho/hsz/hmz share the window, but auto-mode only matters for HMZ heatmap
    if (typeof _hmzApplyAutoHeatmapMode === 'function') {
      _hmzApplyAutoHeatmapMode();
    }
  }

  // Re-render. Capture the promise (renderHistMulti is async) so callers
  // (especially FS onclick wrappers) can wait before refreshing the FS.
  const renders = {
    'spot':      renderHistSpot,
    'spread':    renderHistSpread,
    'neg':       renderHistNeg,
    'nbr':       renderHistNeighbours,
    'dist':      renderHistDist,
    'ren-trend': renderHistRenTrend,
    'ren-stack': renderHistRenStack,
    'imb-hist':  renderHistImb,
    'fcr-hist':  renderHistFCR,
    'eua-hist':  renderHistEUA,
    'ho':        renderHistOverview,
    'hmz':       renderHistMulti,
    'hms':       renderHistMonthlyTable,
  };
  const renderPromise = renders[key] ? renders[key]() : null;

  // If the fullscreen overlay is open on Historical, rebuild it so the FS chart
  // and KPIs reflect the new window (the overlay snapshots the filtered series
  // at creation time, so a HIST.windows update isn't enough on its own).
  if ((key === 'ho' || key === 'hsz' || key === 'hmz') && _hoFsIsOpen()) {
    const fsZone = window._HO_OPEN_ZONE;
    if (fsZone && typeof _openHoFullscreen === 'function') {
      // Slight delay so renderHistOverview() can rebuild _HO_LAST_SERIES first.
      setTimeout(() => _openHoFullscreen(fsZone), 30);
    }
  }
  return renderPromise;
}

// Returns true if a Historical fullscreen overlay is currently open.
// Works whether the overlay is the legacy ho-fs-overlay or the unified
// pk-fs-overlay tagged with data-fs-context="historical".
function _hoFsIsOpen() {
  return !!(document.getElementById('ho-fs-overlay')
    || document.querySelector('#pk-fs-overlay[data-fs-context="historical"]'));
}

// ── Custom date range from picker ──
function setHistCustomRange() {
  const fromEl = document.getElementById('ho-date-from');
  const toEl   = document.getElementById('ho-date-to');
  const from = fromEl?.value;
  const to   = toEl?.value;
  // Both must be filled
  if (!from || !to) return;
  if (from > to) return;
  // Activate custom mode: clear preset highlights (all period pills, both A-mode and popup)
  HIST.customRange = { from, to };
  document.querySelectorAll('#hw-ho .hw-btn, #pk-gf-hist-period .pk-gf-btn, #pk-gf-hist-time-popup .pk-gf-popup-pill').forEach(b => b.classList.remove('active'));
  // Sync popup inputs (so user sees the chosen range if they open the popup later)
  const dfP = document.getElementById('ho-date-from-popup');
  const dtP = document.getElementById('ho-date-to-popup');
  if (dfP) dfP.value = from;
  if (dtP) dtP.value = to;
  // Update C-mode combo button label
  if (typeof window.pkUpdateTimeComboLabel === 'function') window.pkUpdateTimeComboLabel(null, from, to);
  renderHistOverview();
}
window.setHistCustomRange = setHistCustomRange;

// ── Filter data by window ──
function filterByWindow(data, windowKey) {
  const now = new Date();
  // YTD: start of current calendar year
  if (windowKey === 'YTD') {
    const cutoff = new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);
    return data.filter(d => d.d >= cutoff);
  }
  const cutoffs = {
    '7D': 7, '1M': 30, '3M': 91, '6M': 183, '1Y': 365,
    '2Y': 730, '5Y': 1826, 'All': 99999,
  };
  const days = cutoffs[windowKey] || 365;
  const cutoff = new Date(now - days * 86400000).toISOString().slice(0,10);
  return data.filter(d => d.d >= cutoff);
}

// ── Filter data by custom date range (Overview only) ──
function filterByRange(data, from, to) {
  return data.filter(d => d.d >= from && d.d <= to);
}

// ── Window code → {start, end} ISO date strings, same cutoffs as filterByWindow ──
function windowToDates(windowKey) {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  if (windowKey === 'YTD') {
    return { start: new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10), end };
  }
  const cutoffs = {
    '7D': 7, '1M': 30, '3M': 91, '6M': 183, '1Y': 365,
    '2Y': 730, '5Y': 1826, 'All': 99999,
  };
  const days = cutoffs[windowKey] || 365;
  return { start: new Date(now - days * 86400000).toISOString().slice(0, 10), end };
}

// ── Rolling average ──
function rolling(arr, n) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i-n+1), i+1).filter(v => v != null);
    return slice.length ? round2(slice.reduce((a,b)=>a+b,0)/slice.length) : null;
  });
}

// Rolling mean computed on the FULL series (not just the filtered window).
// `filteredEntries` = entries currently displayed (e.g. last 7 days when
// window=7D). `fullEntries` = the unfiltered zone series. Both are sorted asc
// by date. Returns an array of length = filteredEntries.length where index i
// is the n-day average ending at filteredEntries[i].d, using values from
// fullEntries that may precede the visible window.
//
// FAST PATH: if entries carry pre-computed `roll{N}` keys (set by
// enrich_summary.py: roll7, roll30, roll90, roll365, spread30), we just read
// them. Computation cost = 0. Falls back to live computation otherwise.
//
// Without this, a 30D rolling on a 7D window collapses to a 7-point average —
// visually labelled "30D" but no longer reflecting 30 days.
function _rollingWithContext(filteredEntries, fullEntries, n, valKey) {
  valKey = valKey || 'avg';
  if (!filteredEntries.length) return [];

  // Fast path: pre-computed rolling on each entry (avg field only, and spread30)
  if (valKey === 'avg' && [7, 30, 90, 365].includes(n)) {
    const preKey = 'roll' + n;
    if (filteredEntries[0][preKey] !== undefined) {
      return filteredEntries.map(e => e[preKey] != null ? e[preKey] : null);
    }
  }
  if (valKey === 'spread' && n === 30) {
    if (filteredEntries[0]['spread30'] !== undefined) {
      return filteredEntries.map(e => e['spread30'] != null ? e['spread30'] : null);
    }
  }

  // Slow path: compute live from the full series with a date-index map
  const dateIdx = new Map();
  fullEntries.forEach((e, i) => dateIdx.set(e.d, i));
  const fullVals = fullEntries.map(e => e[valKey]);
  return filteredEntries.map(fe => {
    const idx = dateIdx.get(fe.d);
    if (idx == null) return null;
    const slice = fullVals.slice(Math.max(0, idx - n + 1), idx + 1).filter(v => v != null);
    if (!slice.length) return null;
    return round2(slice.reduce((a, b) => a + b, 0) / slice.length);
  });
}

// Same idea for rolling standard deviation (used by Volatility tab).
function _rollingSigmaWithContext(filteredEntries, fullEntries, n, valKey) {
  valKey = valKey || 'avg';
  if (!filteredEntries.length) return [];
  const dateIdx = new Map();
  fullEntries.forEach((e, i) => dateIdx.set(e.d, i));
  const fullVals = fullEntries.map(e => e[valKey]);
  return filteredEntries.map(fe => {
    const idx = dateIdx.get(fe.d);
    if (idx == null) return null;
    const slice = fullVals.slice(Math.max(0, idx - n + 1), idx + 1).filter(v => v != null);
    if (slice.length < 3) return null;
    const m = slice.reduce((a, b) => a + b, 0) / slice.length;
    const v = slice.reduce((a, b) => a + Math.pow(b - m, 2), 0) / slice.length;
    return Math.sqrt(v);
  });
}
function round2(v) { return Math.round(v * 100) / 100; }

// ── Destroy & recreate chart ──
function mkHistChart(canvasId, config) {
  if (HIST.charts[canvasId]) {
    HIST.charts[canvasId].destroy();
    delete HIST.charts[canvasId];
  }
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  // Remove any "no data" message from previous attempt
  const wrap = canvas.parentNode;
  const old = wrap.querySelector('.no-data-msg');
  if (old) old.remove();
  canvas.style.display = '';
  // Force responsive sizing
  canvas.style.width = '100%';
  if (!canvas.style.height) canvas.style.height = '220px';
  config.options = config.options || {};
  config.options.responsive = true;
  config.options.maintainAspectRatio = false;

  // ── Auto-inject standard interactions (norme PowerKlock) ──
  // Click-and-drag rectangle zoom + double-click reset on every chart.
  config.options.plugins = config.options.plugins || {};
  if (!('zoom' in config.options.plugins)) {
    config.options.plugins.zoom = _zoomConfig({ mode: 'xy' });
  }
  if (!config.options.onClick) {
    config.options.onClick = (evt) => {
      if (evt && evt.native && evt.native.detail === 2) {
        const c = HIST.charts[canvasId];
        if (c && typeof c.resetZoom === 'function') c.resetZoom();
      }
    };
  }

  if (window.pkHoverReadoutPlugin) {
    window.pkPrepHoverReadout(config);
    config.plugins = config.plugins || [];
    if (!config.plugins.includes(window.pkHoverReadoutPlugin)) config.plugins.push(window.pkHoverReadoutPlugin);
  }

  HIST.charts[canvasId] = new Chart(canvas, config);
}

// Colour aliases (redefined here since const doesn't cross script blocks).
// IMPORTANT: Chart.js does NOT resolve CSS variables like `var(--text)` — it
// reads them as literal strings and falls back to black. Always pass actual
// hex/rgba values to Chart.js plugin options (title.color, ticks.color, …).
var _HIST_TEXT = '#E1ECF7';  // main text (titles)
var _HIST_TX2  = '#B8C9D9';  // secondary text (subtitles, axis titles) · aligned with Daily C_TX2
var _HIST_TX3  = '#4A6280';  // tertiary text (axis ticks, faint legend) — overridden by data.js to '#7A93AB' via CSS var --text3
var _HIST_ACC  = '#14D3A9';
var _HIST_WARN = '#EE9B00';
var _HIST_DN   = '#ED6965';  // aligned with Daily C_DN (brand coral instead of generic red)
var _HIST_UP   = '#14D3A9';  // aligned with Daily C_UP / C_ACC (brand teal instead of generic green)
var _HIST_GRID = 'rgba(255,255,255,0.04)';

function baseOptions(yLabel) {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 200 },
    // Reserve a few pixels at the bottom for the X axis title (the banner below
    // already keeps a 32px margin-top, so this padding only handles axis title spacing).
    layout: { padding: { bottom: 8 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index', intersect: false,
        callbacks: { label: ctx => ` ${ctx.dataset.label || ''}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) : 'n/a'}` }
      }
    },
    scales: {
      x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 10 } },
      y: {
        grid: { color: _HIST_GRID },
        ticks: { color: _HIST_TX3, font: { size: 10 } },
        title: yLabel ? { display: true, text: yLabel, color: _HIST_TX3, font: { size: 10 } } : undefined,
      },
    },
  };
}

// Emits the same .kpi-card.kpi-flat markup as the Daily reference's KPI
// strip, so every section's summary stats look identical site-wide — the
// old .hist-stat/-label/-val/-unit classes were this helper's own thing.
function statsHtml(stats) {
  return stats.map(s =>
    '<div class="kpi-card kpi-flat"><div class="kpi-label">' + s.l + '</div>' +
    '<div class="kpi-value">' + s.v + (s.u ? '<span class="kpi-unit">' + s.u + '</span>' : '') + '</div></div>'
  ).join('');
}

function setStats(id, stats) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = statsHtml(stats);
}

function noDataMsg(canvasId, msg, hint) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  // Replace canvas with a message div
  const wrap = c.parentNode;
  let msgDiv = wrap.querySelector('.no-data-msg');
  if (!msgDiv) {
    msgDiv = document.createElement('div');
    msgDiv.className = 'no-data-msg';
    msgDiv.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:120px;color:var(--text3);font-size:12px;gap:6px;padding:20px;text-align:center;';
    c.style.display = 'none';
    wrap.appendChild(msgDiv);
  }
  const text = msg || 'No historical data yet';
  // Default hint assumes an ENTSO-E source backfill.py can fill; callers with
  // a different/external data source (EUA, Imbalance, FCR, …) pass their own.
  const hintText = hint == null ? 'Run backfill.py to populate · Data available on GitHub Pages after fetch' : hint;
  msgDiv.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
    '<span>' + text + '</span>' +
    '<span style="font-size:10px;opacity:0.6">' + hintText + '</span>';
}

// ════════════════════════
// INDIVIDUAL CHART RENDERS
// ════════════════════════

async function renderHistSpot() {
  const w    = HIST.windows['spot'] || '1M';
  const zone = getHistZone('spot');
  const s    = await fetchSummary();
  if (!s?.zones?.[zone]) return noDataMsg('hist-spot-canvas');

  const data = filterByWindow(s.zones[zone], w);
  if (!data.length) return noDataMsg('hist-spot-canvas');

  const labels = data.map(d => d.d);
  const avgs   = data.map(d => d.avg);
  // Rolling 7D/30D computed on FULL zone series (not just visible window)
  // so the trend lines remain meaningful when the user picks a short window.
  const roll7  = _rollingWithContext(data, s.zones[zone], 7);
  const roll30 = _rollingWithContext(data, s.zones[zone], 30);

  // "Now" marker -- index of today
  const today = pkTodayISO();
  const nowIdx = labels.indexOf(today);

  // Period label
  const periodEl = document.getElementById('hist-spot-period');
  if (periodEl) periodEl.textContent = periodLabel(data);

  const color = zoneColor(zone);

  const annotations = {};
  if (nowIdx !== -1) {
    annotations.nowLine = {
      type: 'line', scaleID: 'x', value: nowIdx,
      borderColor: 'rgba(255,255,255,0.5)', borderWidth: 1, borderDash: [4,3],
      label: { enabled: true, content: 'Now', position: 'start', color: '#fff',
               font: { size: 9 }, backgroundColor: 'rgba(0,0,0,0.5)', padding: 3 }
    };
  }

  // Min/max annotations
  const validAvgs = avgs.filter(v => v != null);
  if (validAvgs.length) {
    const minVal = Math.min(...validAvgs);
    const maxVal = Math.max(...validAvgs);
    const minIdx = avgs.indexOf(minVal);
    const maxIdx = avgs.indexOf(maxVal);
    annotations.minPt = {
      type: 'point', xValue: minIdx, yValue: minVal,
      backgroundColor: _HIST_DN, radius: 4,
      label: { enabled: true, content: minVal.toFixed(0)+'€', color: '#fff',
               font: { size: 9 }, backgroundColor: _HIST_DN, position: 'bottom', padding: 2 }
    };
    annotations.maxPt = {
      type: 'point', xValue: maxIdx, yValue: maxVal,
      backgroundColor: _HIST_UP, radius: 4,
      label: { enabled: true, content: maxVal.toFixed(0)+'€', color: '#fff',
               font: { size: 9 }, backgroundColor: _HIST_UP, position: 'top', padding: 2 }
    };
  }

  mkHistChart('hist-spot-canvas', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Daily avg', data: avgs,   borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1,   pointRadius: 0, tension: 0, spanGaps: true, fill: false },
        { label: '7D avg',    data: roll7,  borderColor: color,                   borderWidth: 1.5, pointRadius: 0, tension: 0, spanGaps: true, fill: false },
        { label: '30D avg',   data: roll30, borderColor: _HIST_WARN,              borderWidth: 1.5, pointRadius: 0, tension: 0, spanGaps: true, fill: false, borderDash: [5,3] },
      ],
    },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        legend: { display: true, labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 24, usePointStyle: true, pointStyle: 'line' } },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            title: ctx => ctx[0]?.label || '',
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          },
        },
        annotation: { annotations },
      },
    },
  });

  const valid = avgs.filter(v => v != null);
  setStats('hist-spot-stats', [
    { l: 'Last',     v: valid.slice(-1)[0]?.toFixed(1), u: '€/MWh' },
    { l: 'Avg',      v: round2(valid.reduce((a,b)=>a+b,0)/valid.length)?.toFixed(1), u: '€/MWh' },
    { l: '7D avg',   v: roll7.filter(v=>v!=null).slice(-1)[0]?.toFixed(1), u: '€/MWh' },
    { l: '30D avg',  v: roll30.filter(v=>v!=null).slice(-1)[0]?.toFixed(1), u: '€/MWh' },
    { l: 'Min',      v: Math.min(...data.map(d=>d.min)).toFixed(1), u: '€/MWh' },
    { l: 'Max',      v: Math.max(...data.map(d=>d.max)).toFixed(1), u: '€/MWh' },
    { l: 'Neg h',    v: Math.round(data.reduce((a,d)=>a+(d.negH||0),0)), u: 'h' },
  ]);
}


async function renderHistSpread() {
  const w    = HIST.windows['spread'] || '1M';
  const zone = getHistZone('spread');
  const s    = await fetchSummary();
  if (!s?.zones?.[zone]) return noDataMsg('hist-spread-canvas');
  const data = filterByWindow(s.zones[zone], w);
  if (!data.length) return noDataMsg('hist-spread-canvas');

  const periodEl = document.getElementById('hist-spread-period');
  if (periodEl) periodEl.textContent = periodLabel(data);

  const labels  = data.map(d => d.d);
  const spreads = data.map(d => d.min != null && d.max != null ? round2(d.max - d.min) : null);
  // 30D rolling on spread, computed on the FULL zone series so a short window
  // doesn't truncate the trailing 30-day average.
  const fullSpreads = s.zones[zone].map(d => (d.min != null && d.max != null) ? round2(d.max - d.min) : null);
  const fullSpreadEntries = s.zones[zone].map((d, i) => ({ d: d.d, spread: fullSpreads[i] }));
  const roll30 = _rollingWithContext(
    data.map(d => ({ d: d.d })),
    fullSpreadEntries,
    30,
    'spread'
  );

  mkHistChart('hist-spread-canvas', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Daily spread', data: spreads,
          // Intensity, not good/bad: a wide spread is an opportunity, not an alarm.
          backgroundColor: spreads.map(v => v != null && v > 200 ? 'rgba(20,211,169,0.85)' : v != null && v > 100 ? 'rgba(20,211,169,0.6)' : 'rgba(20,211,169,0.3)'),
          borderWidth: 0,
        },
        { label: '30D avg', data: roll30, type: 'line', borderColor: '#FBBF24', borderWidth: 2, pointRadius: 0, tension: 0, spanGaps: true, fill: false, borderDash: [4,3], order:0 },
      ],
    },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        legend: { display: true, labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 24, usePointStyle: true, pointStyle: 'line' } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)} €/MWh` } },
      },
    },
  });

  if (typeof renderBess === 'function') renderBess();
  const valid = spreads.filter(v => v != null);
  setStats('hist-spread-stats', [
    { l: 'Avg spread',  v: round2(valid.reduce((a,b)=>a+b,0)/valid.length)?.toFixed(1), u: '€/MWh' },
    { l: 'Max spread',  v: Math.max(...valid)?.toFixed(1), u: '€/MWh' },
    { l: 'Min spread',  v: Math.min(...valid)?.toFixed(1), u: '€/MWh' },
    { l: 'Days > 100€', v: valid.filter(v=>v>100).length },
    { l: 'Days > 200€', v: valid.filter(v=>v>200).length },
  ]);
}

async function renderHistNeg() {
  const w    = HIST.windows['neg'] || '1M';
  const zone = getHistZone('neg');
  const s    = await fetchSummary();
  if (!s?.zones?.[zone]) return noDataMsg('hist-neg-canvas');
  const data = filterByWindow(s.zones[zone], w);
  if (!data.length) return noDataMsg('hist-neg-canvas');

  const periodEl = document.getElementById('hist-neg-period');
  if (periodEl) periodEl.textContent = periodLabel(data);

  const labels = data.map(d => d.d);
  const negH   = data.map(d => d.negH || 0);

  mkHistChart('hist-neg-canvas', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Neg hours', data: negH,
        backgroundColor: negH.map(v => v > 8 ? 'rgba(239,68,68,0.85)' : v > 4 ? 'rgba(249,115,22,0.75)' : v > 0 ? 'rgba(234,179,8,0.65)' : 'rgba(255,255,255,0.05)'),
        borderWidth: 0,
      }],
    },
    options: {
      ...baseOptions('Hours'),
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${_fmtNegH(ctx.parsed.y)} negative` } },
      },
    },
  });

  const totalNeg = negH.reduce((a,b)=>a+b,0);
  const daysNeg  = negH.filter(v=>v>0).length;
  setStats('hist-neg-stats', [
    { l: 'Total neg h',    v: Math.round(totalNeg), u: 'h' },
    { l: 'Days with neg',  v: daysNeg },
    { l: 'Max neg hours',  v: Math.round(Math.max(...negH)), u: 'h' },
    { l: '% days with neg',v: data.length ? (daysNeg/data.length*100).toFixed(0) : '0', u: '%' },
  ]);

  // ── KPIs
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const curYear  = `${now.getFullYear()}`;
  const allData  = s.zones[zone] || [];

  const monthH = allData.filter(d => d.d && d.d.startsWith(curMonth)).reduce((a,d) => a + (d.negH||0), 0);
  const yearH  = allData.filter(d => d.d && d.d.startsWith(curYear)).reduce((a,d) => a + (d.negH||0), 0);

  // worst month: group by YYYY-MM
  const byMonth = {};
  allData.forEach(d => {
    if (!d.d) return;
    const m = d.d.slice(0,7);
    byMonth[m] = (byMonth[m] || 0) + (d.negH || 0);
  });
  let worstM = '--', worstH = 0;
  Object.entries(byMonth).forEach(([m, h]) => { if (h > worstH) { worstH = h; worstM = m; }});

  const el_m = document.getElementById('neg-kpi-month');
  const el_y = document.getElementById('neg-kpi-year');
  const el_w = document.getElementById('neg-kpi-worst');
  const el_ms = document.getElementById('neg-kpi-month-sub');
  const el_ws = document.getElementById('neg-kpi-worst-sub');
  if (el_m) el_m.innerHTML = _fmtNegH(monthH);
  if (el_y) el_y.innerHTML = _fmtNegH(yearH);
  if (el_w) el_w.innerHTML = _fmtNegH(worstH);
  if (el_ms) el_ms.textContent = curMonth;
  if (el_ws) el_ws.textContent = worstM;

  // ── Calendar heatmap
  renderNegCalendar(allData, zone);

  // ── Monthly summary
  renderNegMonthlySummary(byMonth);
}

function renderNegCalendar(allData, zone) {
  const container = document.getElementById('neg-calendar-heatmap');
  if (!container) return;

  // Build lookup
  const byDay = {};
  allData.forEach(d => { if (d.d) byDay[d.d] = d.negH || 0; });

  // Show last 12 months
  const today = new Date();
  const start = new Date(today);
  start.setMonth(start.getMonth() - 11);
  start.setDate(1);

  const months = [];
  let cur = new Date(start);
  while (cur <= today) {
    const m = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`;
    if (!months.length || months[months.length-1].key !== m) {
      months.push({ key: m, label: cur.toLocaleDateString('en-GB',{month:'short',year:'2-digit'}), days: [] });
    }
    const dStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    months[months.length-1].days.push({ d: dStr, h: byDay[dStr] || 0, dow: cur.getDay() });
    cur.setDate(cur.getDate() + 1);
  }

  const cellSize = 13, gap = 2;
  const DAYS = ['M','T','W','T','F','S','S'];

  let html = `<div style="display:flex;gap:6px;align-items:flex-start">`;
  html += `<div style="display:flex;flex-direction:column;gap:${gap}px;margin-top:20px">`;
  DAYS.forEach(d => { html += `<div style="width:${cellSize}px;height:${cellSize}px;font-size:9px;color:var(--tx3);line-height:${cellSize}px;text-align:center">${d}</div>`; });
  html += `</div>`;

  months.forEach(month => {
    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">`;
    html += `<div style="font-size:9px;color:var(--tx3);margin-bottom:3px;white-space:nowrap">${month.label}</div>`;

    // Grid: 7 rows (Mon–Sun), n columns
    const firstDow = month.days[0].dow; // 0=Sun
    const adjustedFirst = (firstDow === 0 ? 6 : firstDow - 1); // Mon=0
    const grid = Array(7).fill(null).map(() => []);
    const totalWeeks = Math.ceil((adjustedFirst + month.days.length) / 7);
    month.days.forEach((day, i) => {
      const pos = adjustedFirst + i;
      const col = Math.floor(pos / 7);
      const row = pos % 7;
      if (!grid[row]) grid[row] = [];
      grid[row][col] = day;
    });

    html += `<div style="display:grid;grid-template-columns:repeat(${totalWeeks},${cellSize}px);grid-template-rows:repeat(7,${cellSize}px);gap:${gap}px">`;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < totalWeeks; col++) {
        const day = grid[row] && grid[row][col];
        if (!day) {
          html += `<div style="width:${cellSize}px;height:${cellSize}px"></div>`;
        } else {
          const h = day.h;
          const bg = h > 16 ? '#7f1d1d' : h > 12 ? '#b91c1c' : h > 8 ? '#ef4444' : h > 4 ? '#f97316' : h > 0 ? '#fbbf24' : h === 0 && day.d <= new Date().toISOString().slice(0,10) ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.04)';
          html += `<div title="${day.d}: ${h.toFixed(1)}h neg" style="width:${cellSize}px;height:${cellSize}px;background:${bg};border-radius:2px;cursor:default"></div>`;
        }
      }
    }
    html += `</div></div>`;
  });

  html += `</div>`;
  html += `<div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:10px;color:var(--tx3)">
    <span>0h</span>
    <div style="width:12px;height:12px;background:rgba(16,185,129,0.2);border-radius:2px"></div>
    <div style="width:12px;height:12px;background:#fbbf24;border-radius:2px"></div>
    <span>1–4h</span>
    <div style="width:12px;height:12px;background:#f97316;border-radius:2px"></div>
    <span>4–8h</span>
    <div style="width:12px;height:12px;background:#ef4444;border-radius:2px"></div>
    <span>8–12h</span>
    <div style="width:12px;height:12px;background:#b91c1c;border-radius:2px"></div>
    <span>12–16h</span>
    <div style="width:12px;height:12px;background:#7f1d1d;border-radius:2px"></div>
    <span>>16h</span>
  </div>`;

  container.innerHTML = html;
}

function renderNegMonthlySummary(byMonth) {
  const container = document.getElementById('neg-monthly-summary');
  if (!container) return;
  const sorted = Object.entries(byMonth).sort(([a],[b]) => a.localeCompare(b)).slice(-24);
  container.innerHTML = sorted.map(([m, h]) => {
    const col = h > 40 ? '#ef4444' : h > 20 ? '#f97316' : h > 5 ? '#fbbf24' : 'rgba(16,185,129,0.7)';
    return `<div style="background:var(--bg3);border:1px solid var(--bd);border-radius:6px;padding:8px 10px;text-align:center">
      <div style="font-size:10px;color:var(--tx3);margin-bottom:4px">${m}</div>
      <div style="font-size:16px;font-weight:700;color:${col}">${Math.round(h)}<span style="font-size:10px;font-weight:400;color:var(--tx3)">h</span></div>
    </div>`;
  }).join('');
}

async function renderHistNeighbours() {
  const w = HIST.windows['nbr'] || '1M';
  const s = await fetchSummary();
  if (!s?.zones) return noDataMsg('hist-nbr-canvas');

  const zones   = ['FR','DE_LU','BE','ES','NL'];
  const frData  = filterByWindow(s.zones['FR'] || [], w);
  if (!frData.length) return noDataMsg('hist-nbr-canvas');

  const periodEl = document.getElementById('hist-nbr-period');
  if (periodEl) periodEl.textContent = periodLabel(frData);

  const allDates = frData.map(d => d.d);
  const datasets = zones.map(code => {
    const byDate = Object.fromEntries((s.zones[code] || []).map(d => [d.d, d.avg]));
    return {
      label: code === 'DE_LU' ? 'DE' : code,
      data:  allDates.map(d => byDate[d] ?? null),
      borderColor: zoneColor(code),
      borderWidth: code === 'FR' ? 2 : 1.2,
      pointRadius: 0, tension: 0, spanGaps: true, fill: false,
    };
  });

  mkHistChart('hist-nbr-canvas', {
    type: 'line',
    data: { labels: allDates, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        legend: { display: true, labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 24, usePointStyle: true, pointStyle: 'line' } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)} €/MWh` } },
      },
    },
  });
}

async function renderHistDist() {
  const w    = HIST.windows['dist'] || '1M';
  const zone = getHistZone('dist');
  const s    = await fetchSummary();
  if (!s?.zones?.[zone]) return noDataMsg('hist-dist-canvas');
  const data = filterByWindow(s.zones[zone], w);
  if (!data.length) return noDataMsg('hist-dist-canvas');

  const periodEl = document.getElementById('hist-dist-period');
  if (periodEl) periodEl.textContent = periodLabel(data);

  const avgs   = data.map(d => d.avg).filter(v => v != null);
  if (!avgs.length) return noDataMsg('hist-dist-canvas');

  const BIN_SIZE = 10;
  const binMin   = Math.floor(Math.min(...avgs) / BIN_SIZE) * BIN_SIZE;
  const binMax   = Math.ceil(Math.max(...avgs) / BIN_SIZE) * BIN_SIZE;
  const bins = [], counts = [];
  for (let b = binMin; b <= binMax; b += BIN_SIZE) {
    bins.push(b);
    counts.push(avgs.filter(v => v >= b && v < b + BIN_SIZE).length);
  }

  const mean   = avgs.reduce((a,b)=>a+b,0) / avgs.length;
  const sorted = [...avgs].sort((a,b)=>a-b);
  const median = sorted[Math.floor(sorted.length/2)];
  const stddev = Math.sqrt(avgs.reduce((a,v)=>a+(v-mean)**2,0)/avgs.length);

  mkHistChart('hist-dist-canvas', {
    type: 'bar',
    data: {
      labels: bins.map(b => b+'€'),
      datasets: [{
        label: 'Days', data: counts,
        backgroundColor: bins.map(b => b < 0 ? 'rgba(239,68,68,0.65)' : 'rgba(0,212,168,0.5)'),
        borderWidth: 0,
      }],
    },
    options: {
      ...baseOptions('Days'),
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} days` } },
      },
    },
  });

  setStats('hist-dist-stats', [
    { l: 'Mean',   v: mean.toFixed(1),   u: '€/MWh' },
    { l: 'Median', v: median.toFixed(1), u: '€/MWh' },
    { l: 'Std dev',v: stddev.toFixed(1), u: '€/MWh' },
    { l: 'P5',     v: sorted[Math.floor(sorted.length*0.05)]?.toFixed(1), u: '€/MWh' },
    { l: 'P95',    v: sorted[Math.floor(sorted.length*0.95)]?.toFixed(1), u: '€/MWh' },
    { l: 'Min',    v: sorted[0]?.toFixed(1), u: '€/MWh' },
    { l: 'Max',    v: sorted[sorted.length-1]?.toFixed(1), u: '€/MWh' },
  ]);
}

async function renderHistRenTrend() {
  const w = HIST.windows['ren-trend'] || '1M';
  const s = await fetchSummary();
  if (!s?.zones?.FR) return noDataMsg('hist-ren-trend');

  const data = filterByWindow(s.zones.FR, w);
  if (!data.length) return noDataMsg('hist-ren-trend');

  // Check if any entry has solar/wind in summary
  // Summary doesn't store gen -- we need to fetch from daily files
  // For perf, sample: fetch last N daily files
  const { start, end } = windowToDates(w);
  // Fetch 7 days earlier so the 7D rolling at the start of the visible window
  // has the full 7-day context (not truncated to 1-7 points).
  const extStart = new Date(start);
  extStart.setDate(extStart.getDate() - 7);
  const extStartIso = extStart.toISOString().slice(0, 10);
  const dailies = await fetchDailyRange(extStartIso, end, true);

  if (!dailies.length) return noDataMsg('hist-ren-trend');

  // Compute solar/wind over the EXTENDED range, then slice off the 7-day prefix
  // before plotting — but keep it for rolling-context computation.
  const fullLabels = [], fullSolar = [], fullWind = [];
  dailies.forEach(day => {
    const fr = day.zones?.FR;
    if (!fr) return;
    fullLabels.push(day.date);
    const s = fr.solar ? round2(fr.solar.reduce((a,b)=>a+b,0)/fr.solar.length) : null;
    const w = fr.wind  ? round2(fr.wind.reduce((a,b)=>a+b,0)/fr.wind.length)   : null;
    fullSolar.push(s);
    fullWind.push(w);
  });

  // Visible window starts at `start` (extStartIso + 7 days)
  const startIso = start instanceof Date ? start.toISOString().slice(0, 10) : start;
  const visibleStartIdx = fullLabels.findIndex(d => d >= startIso);
  const labels = visibleStartIdx >= 0 ? fullLabels.slice(visibleStartIdx) : fullLabels;
  const solar  = visibleStartIdx >= 0 ? fullSolar.slice(visibleStartIdx)  : fullSolar;
  const wind   = visibleStartIdx >= 0 ? fullWind.slice(visibleStartIdx)   : fullWind;

  // 7D rolling computed on the full extended range, then sliced to visible window
  const fullSolarEntries = fullLabels.map((d, i) => ({ d, v: fullSolar[i] }));
  const fullWindEntries  = fullLabels.map((d, i) => ({ d, v: fullWind[i] }));
  const visEntries = labels.map(d => ({ d }));
  const sr7 = _rollingWithContext(visEntries, fullSolarEntries, 7, 'v');
  const wr7 = _rollingWithContext(visEntries, fullWindEntries, 7, 'v');

  mkHistChart('hist-ren-trend', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Solar',       data: solar, borderColor:'rgba(251,191,36,0.4)',  borderWidth:1, pointRadius:0, tension:0, spanGaps:true },
        { label:'Solar 7D',    data: sr7,   borderColor:'#fbbf24', borderWidth:1.5, pointRadius:0, tension:0, spanGaps:true, borderDash:[4,3] },
        { label:'Wind',        data: wind,  borderColor:'rgba(0,212,168,0.4)',   borderWidth:1, pointRadius:0, tension:0, spanGaps:true },
        { label:'Wind 7D',     data: wr7,   borderColor: _HIST_ACC,  borderWidth:1.5, pointRadius:0, tension:0, spanGaps:true, borderDash:[4,3] },
      ],
    },
    options: {
      ...baseOptions('MW'),
      plugins: { legend: { display:true, labels:{ color:_HIST_TX3, font:{size:10}, boxWidth:12 } } },
    },
  });
}

// ── RENEWABLES STACKED AREA ──
async function renderHistRenStack() {
  const w = HIST.windows['ren-stack'] || '7D';
  const { start, end } = windowToDates(w);
  const dailies = await fetchDailyRange(start, end, true);
  if (!dailies.length) return noDataMsg('hist-ren-stack');

  const labels = [], solarData = [], windData = [];

  dailies.forEach(day => {
    const fr = day.zones?.FR;
    if (!fr?.solar || !fr?.wind) return;
    fr.solar.forEach((v, h) => {
      labels.push(day.date + ' ' + String(h).padStart(2,'0') + ':00');
      solarData.push(v || 0);
      windData.push((fr.wind[h] || 0));
    });
  });

  mkHistChart('hist-ren-stack', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Wind',  data: windData,  borderColor: _HIST_ACC,   backgroundColor:'rgba(0,212,168,0.3)',  borderWidth:1.5, pointRadius:0, tension:0, fill:true  },
        { label:'Solar', data: solarData, borderColor:'#fbbf24', backgroundColor:'rgba(251,191,36,0.4)', borderWidth:1.5, pointRadius:0, tension:0, fill:true  },
      ],
    },
    options: {
      ...baseOptions('MW'),
      plugins: { legend: { display:true, labels:{ color:_HIST_TX3, font:{size:10}, boxWidth:12 } } },
      scales: {
        x: { grid:{color:_HIST_GRID}, ticks:{ color:_HIST_TX3, font:{size:9}, maxTicksLimit:12 } },
        y: { grid:{color:_HIST_GRID}, ticks:{ color:_HIST_TX3, font:{size:10} }, stacked: false },
      },
    },
  });
}

// ── IMBALANCE HISTORICAL (stub -- needs RTE data source) ──
async function renderHistImb() {
  noDataMsg('hist-imb-canvas', 'Imbalance historical requires RTE eCO2mix API integration', 'Planned in a future release — RTE eCO2mix integration, not covered by backfill.py');
}

// ── FCR HISTORICAL (stub -- needs ENTSO-E A96/A63) ──
async function renderHistFCR() {
  noDataMsg('hist-fcr-canvas', 'FCR historical requires ENTSO-E A96 (Contracted Reserves) data', 'Planned in a future release — ENTSO-E A96 integration, not covered by backfill.py');
}

// ── EUA HISTORICAL (stub -- ICE/EEX not on ENTSO-E) ──
async function renderHistEUA() {
  noDataMsg('hist-eua-canvas', 'EUA historical source: ICE/EEX — not yet connected', 'Upload via CSV or connect the GO price automation, not covered by backfill.py');
  noDataMsg('hist-spark-canvas', 'Clean Spark Spread history — upload via CSV or connect GO price automation', 'Upload via CSV or connect the GO price automation, not covered by backfill.py');
}


// Auto-load summary for datepicker neg dots on prices page open
// Hook into existing showPage via a post-call observer
// negative-price days of France for the date picker, read when Prices is shown
PK.onPage('prices', () => {
  fetchSummary().then(s => {
    if (s?.zones?.FR) {
      s.zones.FR.forEach(d => { if (d.negH > 0) DP.negDays[d.d] = d.negH; });
    }
  });
});


