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
async function fetchSummary() {
  if (HIST.summary) return HIST.summary;
  try {
    const base = typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : './data/';
    const r = await fetch(base + 'history/summary.json?t=' + Date.now());
    if (!r.ok) return null;
    HIST.summary = await r.json();
    return HIST.summary;
  } catch { return null; }
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
    'capture-solar':    () => renderHistCapture('solar'),
    'capture-wind':     () => renderHistCapture('wind'),
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
    'cap-solar': () => renderHistCapture('solar'),
    'cap-wind':  () => renderHistCapture('wind'),
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

function statsHtml(stats) {
  return stats.map(s =>
    '<div class="hist-stat"><div class="hist-stat-label">' + s.l + '</div>' +
    '<div class="hist-stat-val">' + s.v + '<span class="hist-stat-unit">' + (s.u||'') + '</span></div></div>'
  ).join('');
}

function setStats(id, stats) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = statsHtml(stats);
}

function noDataMsg(canvasId, msg) {
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
  msgDiv.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
    '<span>' + text + '</span>' +
    '<span style="font-size:10px;opacity:0.6">Run backfill.py to populate · Data available on GitHub Pages after fetch</span>';
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
  const today = new Date().toISOString().slice(0,10);
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
          backgroundColor: spreads.map(v => v != null && v > 100 ? 'rgba(239,68,68,0.6)' : 'rgba(0,212,168,0.4)'),
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
  const c = document.getElementById('hist-imb-canvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = _HIST_TX3;
  ctx.font = '11px Inter';
  ctx.textAlign = 'center';
  ctx.fillText('Imbalance historical data requires RTE eCO2mix API integration.', c.width/2, c.height/2 - 10);
  ctx.fillText('Planned in next release.', c.width/2, c.height/2 + 12);
}

// ── FCR HISTORICAL (stub -- needs ENTSO-E A96/A63) ──
async function renderHistFCR() {
  const c = document.getElementById('hist-fcr-canvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = _HIST_TX3;
  ctx.font = '11px Inter';
  ctx.textAlign = 'center';
  ctx.fillText('FCR historical requires ENTSO-E A96 (Contracted Reserves) data.', c.width/2, c.height/2 - 10);
  ctx.fillText('Planned in next release.', c.width/2, c.height/2 + 12);
}

// ── EUA HISTORICAL (stub -- ICE/EEX not on ENTSO-E) ──
async function renderHistEUA() {
  ['hist-eua-canvas','hist-spark-canvas'].forEach(id => {
    const c = document.getElementById(id);
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = _HIST_TX3;
    ctx.font = '11px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('EUA historical data source: ICE/EEX.', c.width/2, c.height/2 - 10);
    ctx.fillText('Upload via CSV or connect GO price automation.', c.width/2, c.height/2 + 12);
  });
}

// ── CAPTURE RATE (rolling WAP / baseload) ──
async function renderHistCapture(tech) {
  const canvasId = 'hist-cap-' + tech;
  const w = HIST.windows['cap-' + tech] || '2Y';
  const { start, end } = windowToDates(w);

  // Fetch 90 days earlier so the 30D and 90D rolling lines have full context
  // at the start of the visible window. (365D context is too expensive to
  // pre-fetch; it remains a window-bounded estimate.)
  const startIso = start instanceof Date ? start.toISOString().slice(0, 10) : start;
  const extStart = new Date(startIso);
  extStart.setDate(extStart.getDate() - 90);
  const extStartIso = extStart.toISOString().slice(0, 10);

  // Fetch daily files -- we need both prices and generation
  const dailies = await fetchDailyRange(extStartIso, end, true);
  if (!dailies.length) return noDataMsg(canvasId);

  // Check at least some days have generation data
  const hasSomeGen = dailies.some(day => {
    const fr = day.zones?.FR;
    return fr && fr[tech === 'solar' ? 'solar' : 'wind'] && fr[tech === 'solar' ? 'solar' : 'wind'].some(v => v > 0);
  });

  if (!hasSomeGen) {
    const c = document.getElementById(canvasId);
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = _HIST_TX3;
    ctx.font = '11px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('No generation data yet.', c.width/2, c.height/2 - 12);
    ctx.fillText('Run: ENTSOE_TOKEN=xxx python3 backfill.py --with-generation', c.width/2, c.height/2 + 10);
    return;
  }

  const genKey = tech === 'solar' ? 'solar' : 'wind';
  // Compute capture for the EXTENDED range first (used as rolling context)
  const fullLabels = [], fullCapture = [];

  dailies.forEach(day => {
    const fr = day.zones?.FR;
    if (!fr?.hourly || !fr?.[genKey]) return;

    const prices = fr.hourly;
    const gen    = fr[genKey];  // 24h MW
    const n = Math.min(prices.length, gen.length);

    // If prices are 96-slot, downsample to 24h for matching
    let prices24;
    if (prices.length === 96) {
      prices24 = Array.from({length:24}, (_,h) => {
        const slots = prices.slice(h*4, h*4+4).filter(v => v != null);
        return slots.length ? slots.reduce((a,b)=>a+b,0)/slots.length : null;
      });
    } else {
      prices24 = prices.slice(0, 24);
    }

    // WAP = Σ(price[h] × gen[h]) / Σ(gen[h])
    let wap_num = 0, wap_den = 0, base_sum = 0, base_n = 0;
    for (let h = 0; h < 24; h++) {
      const p = prices24[h], g = gen[h] || 0;
      if (p != null && g > 0) { wap_num += p * g; wap_den += g; }
      if (p != null) { base_sum += p; base_n++; }
    }
    if (wap_den === 0 || base_n === 0) return;

    const wap      = wap_num / wap_den;
    const baseload = base_sum / base_n;
    const capture  = baseload !== 0 ? round2((wap / baseload) * 100) : null;

    fullLabels.push(day.date);
    fullCapture.push(capture);
  });

  // Slice off the 90-day prefix → visible window
  const visStartIdx = fullLabels.findIndex(d => d >= startIso);
  const labels     = visStartIdx >= 0 ? fullLabels.slice(visStartIdx)  : fullLabels;
  const captureRaw = visStartIdx >= 0 ? fullCapture.slice(visStartIdx) : fullCapture;

  if (!labels.length) return noDataMsg(canvasId);

  // Rolling 30D and 90D have full context thanks to the 90-day prefix.
  // 365D rolling is still window-bounded (would need a 1-year prefix fetch).
  const fullEntries = fullLabels.map((d, i) => ({ d, v: fullCapture[i] }));
  const visEntries  = labels.map(d => ({ d }));
  const roll30  = _rollingWithContext(visEntries, fullEntries, 30, 'v');
  const roll90  = _rollingWithContext(visEntries, fullEntries, 90, 'v');
  const roll365 = _rollingWithContext(visEntries, fullEntries, 365, 'v');

  // Annual averages (dots like Rivex)
  const annualDots = {};
  labels.forEach((d, i) => {
    const yr = d.slice(0,4);
    if (!annualDots[yr]) annualDots[yr] = [];
    if (captureRaw[i] != null) annualDots[yr].push(captureRaw[i]);
  });
  const annualData = labels.map(d => {
    const yr = d.slice(0,4);
    // Only show dot on last day of year in range
    const isLast = !labels.find((l, i) => l.slice(0,4) === yr && i > labels.indexOf(d));
    if (!isLast) return null;
    const vals = annualDots[yr];
    return vals.length ? round2(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
  });

  // YTD
  const currentYear = new Date().getFullYear().toString();
  const ytdVals = captureRaw.filter((_, i) => labels[i].startsWith(currentYear) && captureRaw[i] != null);
  const ytd = ytdVals.length ? round2(ytdVals.reduce((a,b)=>a+b,0)/ytdVals.length) : null;

  const color = tech === 'solar' ? '#fbbf24' : _HIST_ACC;

  mkHistChart(canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'365d rolling', data: roll365, borderColor:'#FBBF24', borderWidth:2.5, pointRadius:0, tension:0, spanGaps:true, order:1 },
        { label:'90d rolling',  data: roll90,  borderColor: color,    borderWidth:1.5, pointRadius:0, tension:0, spanGaps:true, borderDash:[6,3], order:2 },
        { label:'30d rolling',  data: roll30,  borderColor:'rgba(255,255,255,0.3)', borderWidth:1, pointRadius:0, tension:0, spanGaps:true, borderDash:[2,2], order:3 },
        {
          label:'Annual',
          data: annualData,
          borderColor: 'transparent',
          backgroundColor: '#c0392b',
          pointRadius: 5,
          pointStyle: 'rectRot',
          pointHoverRadius: 7,
          showLine: false,
          order: 0,
        },
      ],
    },
    options: {
      ...baseOptions('WAP / Baseload (%)'),
      plugins: {
        legend: { display:true, labels:{ color:_HIST_TX3, font:{size:10}, boxWidth:12 } },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label + ': ' + (ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) + '%' : 'n/a'),
          },
        },
      },
      scales: {
        x: { grid:{color:_HIST_GRID}, ticks:{color:_HIST_TX3, font:{size:10}, maxTicksLimit:10} },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color:_HIST_TX3, font:{size:10}, callback: v => v + '%' },
          title: { display:true, text:'Capture Rate (%)', color:_HIST_TX3, font:{size:10} },
        },
      },
    },
  });

  // Add YTD annotation below chart
  const statsEl = document.getElementById('hist-cap-' + tech + '-stats');
  if (!statsEl && ytd != null) {
    // Create stats row below canvas
    const canvas = document.getElementById(canvasId);
    if (canvas?.parentNode) {
      let statsDiv = canvas.parentNode.querySelector('.cap-stats');
      if (!statsDiv) {
        statsDiv = document.createElement('div');
        statsDiv.className = 'hist-stats-grid cap-stats';
        statsDiv.style.marginTop = '10px';
        canvas.parentNode.appendChild(statsDiv);
      }
      const currentYearVals = captureRaw.filter((_, i) => labels[i].startsWith(currentYear) && captureRaw[i] != null);
      const lastVal = captureRaw.filter(v => v != null).slice(-1)[0];
      statsDiv.innerHTML = statsHtml([
        { l: 'YTD ' + currentYear,  v: ytd?.toFixed(1), u: '%' },
        { l: 'Last 30D',  v: roll30.filter(v=>v!=null).slice(-1)[0]?.toFixed(1), u: '%' },
        { l: 'Last 90D',  v: roll90.filter(v=>v!=null).slice(-1)[0]?.toFixed(1), u: '%' },
        { l: 'Last 365D', v: roll365.filter(v=>v!=null).slice(-1)[0]?.toFixed(1), u: '%' },
        { l: 'Min (30D)', v: Math.min(...roll30.filter(v=>v!=null))?.toFixed(1), u: '%' },
        { l: 'Max (30D)', v: Math.max(...roll30.filter(v=>v!=null))?.toFixed(1), u: '%' },
      ]);
    }
  }
}


// Auto-load summary for datepicker neg dots on prices page open
// Hook into existing showPage via a post-call observer
document.addEventListener('DOMContentLoaded', () => {
  const origSP = window.showPage;
  if (origSP && !window._histHooked) {
    window._histHooked = true;
    window.showPage = function(id) {
      origSP(id);
      if (id === 'prices') {
        fetchSummary().then(s => {
          if (s?.zones?.FR) {
            s.zones.FR.forEach(d => { if (d.negH > 0) DP.negDays[d.d] = d.negH; });
          }
        });
      }
    };
  }
});



// ════════════════════════════════════════════════════════════════
// HISTORICAL TAB · NEW LAYOUT (4 blocks)
// 1. Overview table (multi-zone)
// 2. Single zone section (insta tabs: Lines/YoY/Seasonal/Hourly/Weekly/Vol)
// 3. Multi zone section (insta tabs: Lines/Heatmap/Profile/Bands/Spread)
// 4. Monthly summary table
// ════════════════════════════════════════════════════════════════

// Legacy stubs — no-op if old renderers are still referenced anywhere
// (defensive against stale browser caches or external callers)
window.renderCompareHist = function(){};
window.renderHistYoY = function(){};
window.renderHistSeasonal = function(){};
window.renderHistHourly = function(){};
window.renderHistWeekly = function(){};
window.renderHistVol = function(){};
window.renderHistMonthly = function(){};

// ── Global zone state (shared across Daily Compare + Historical + Prices Table) ──
function getUserZones() {
  if (!window._userZones) {
    // Default: zones with actual GenMix data
    const defaults = typeof getGenMixDefaultZones === 'function'
      ? getGenMixDefaultZones()
      : ['FR','DE_LU','ES','BE','NL','GB','PT'];
    window._userZones = new Set(defaults);
  }
  return Array.from(window._userZones);
}

function setUserZones(zones) {
  window._userZones = new Set(zones);
  // Sync with Daily Compare's set (used by buildCompareChips etc.)
  window._compareZones = new Set(zones);
  // Dispatch event so all listeners update
  document.dispatchEvent(new CustomEvent('zones-changed', { detail: { zones } }));
}

// Listen for changes and re-render concerned sections
document.addEventListener('zones-changed', () => {
  // Re-render Daily Compare
  if (typeof renderCompareChart === 'function') renderCompareChart();
  if (typeof buildCompareChips === 'function') buildCompareChips();
  // Re-render Historical sections (multi-zone)
  if (typeof renderHistOverview === 'function') renderHistOverview();
  if (typeof renderHistMulti === 'function') renderHistMulti();
  // Update zone labels
  updateZoneLabels();

  // ─── Refresh any open Prices fullscreen overlay whose content depends on
  // the user zone selection. Uses the unified pkFsIsOpen(key) helper.
  const fsOpen = (typeof window.pkFsIsOpen === 'function') ? window.pkFsIsOpen : null;

  // Historical drill (HSZ): zone dropdown lists user-selected zones.
  if ((fsOpen && fsOpen('historical')) || (!fsOpen && typeof _hoFsIsOpen === 'function' && _hoFsIsOpen())) {
    const fsZone = window._HO_LAST_ZONE;
    const series = window._HO_LAST_SERIES;
    if (fsZone && series && typeof _openHoFullscreen === 'function') {
      requestAnimationFrame(() => _openHoFullscreen(fsZone));
    }
  }

  // Historical Cross-zone (HMZ): Spread ref chips list user-selected zones.
  if ((fsOpen && fsOpen('hmz')) || (!fsOpen && typeof _hmzFsIsOpen === 'function' && _hmzFsIsOpen())) {
    if (typeof hmzRefreshFullscreen === 'function') {
      requestAnimationFrame(() => hmzRefreshFullscreen());
    }
  }

  // Daily Cross-zone (CC): Spread ref + Bands header chips list user-selected zones.
  if (fsOpen && fsOpen('cc')) {
    if (typeof window.ccRefreshFullscreen === 'function') {
      requestAnimationFrame(() => window.ccRefreshFullscreen());
    }
  }

  // Daily drill: mono-zone view, no zone-list dependency → nothing to refresh.
});

function updateZoneLabels() {
  const n = (window._userZones || new Set()).size;
  const txt = n + (n > 1 ? ' zones' : ' zone');
  const lbl1 = document.getElementById('ho-zone-label');
  if (lbl1) lbl1.textContent = txt;
  const lbl2 = document.getElementById('hmz-zone-label');
  if (lbl2) lbl2.textContent = txt;
  // Existing Daily Compare label
  const lbl3 = document.getElementById('compare-filter-label');
  if (lbl3) lbl3.textContent = n + (n > 1 ? ' zones selected' : ' zone selected');
  // New sticky-bar global filter labels
  const lblHistSticky = document.getElementById('pk-gf-hist-zones-label');
  if (lblHistSticky) lblHistSticky.textContent = txt;
  const lblDailySticky = document.getElementById('pk-gf-daily-zones-label');
  if (lblDailySticky) lblDailySticky.textContent = txt;
}

// ── Global zone panel (the dropdown checkbox panel) ──
function toggleGlobalZonePanel() {
  const p = document.getElementById('global-zone-panel');
  if (!p) return;
  const open = p.style.display === 'block';
  if (open) { p.style.display = 'none'; return; }

  // Anchor to whatever button was clicked
  const target = event?.currentTarget || document.getElementById('ho-zone-btn');
  if (target) {
    const r = target.getBoundingClientRect();
    p.style.top = (r.bottom + 6) + 'px';
    p.style.left = Math.max(8, r.right - 320) + 'px';
  }
  p.style.display = 'block';
  renderGlobalZoneChips();
}

document.addEventListener('click', (e) => {
  const p = document.getElementById('global-zone-panel');
  if (!p || p.style.display !== 'block') return;
  // Don't close if clicking inside panel or on a zone-toggle button
  if (p.contains(e.target)) return;
  if (e.target.closest('#ho-zone-btn, [onclick*="toggleGlobalZonePanel"]')) return;
  p.style.display = 'none';
});

function renderGlobalZoneChips() {
  const wrap = document.getElementById('global-zone-chips');
  if (!wrap) return;
  const s = HIST.summary;
  const allZones = s?.zones ? Object.keys(s.zones).sort() : [];
  if (!allZones.length) {
    wrap.innerHTML = '<div style="font-size:11px;color:var(--tx3);padding:6px">Loading zones...</div>';
    return;
  }
  const selected = window._userZones || new Set(getUserZones());
  wrap.innerHTML = allZones.map(code => {
    const on = selected.has(code);
    const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[code]) || '';
    const color = zoneColor(code);
    return `<label style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;${on?'background:rgba(20,211,169,0.08)':''}">
      <input type="checkbox" ${on?'checked':''} onchange="toggleGlobalZone('${code}')" style="cursor:pointer;accent-color:${color}">
      <span style="font-family:'JetBrains Mono',monospace;color:var(--tx2);min-width:60px">${flag} ${code}</span>
      <span style="width:8px;height:8px;border-radius:50%;background:${color};margin-left:auto"></span>
    </label>`;
  }).join('');
}

function toggleGlobalZone(code) {
  const current = new Set(getUserZones());
  if (current.has(code)) current.delete(code);
  else current.add(code);
  setUserZones(Array.from(current));
  renderGlobalZoneChips();
}

function selectAllGlobalZones() {
  const s = HIST.summary;
  if (!s?.zones) return;
  setUserZones(Object.keys(s.zones));
  renderGlobalZoneChips();
}

function clearGlobalZones() {
  setUserZones(['FR']);
  renderGlobalZoneChips();
}

function presetGlobalNeighbours() {
  const s = HIST.summary;
  const avail = s?.zones ? Object.keys(s.zones) : [];
  const want = ['FR','DE_LU','BE','NL','ES','CH'].filter(z => avail.includes(z));
  setUserZones(want);
  renderGlobalZoneChips();
}

function presetGlobalGenMix() {
  const s = HIST.summary;
  const avail = s?.zones ? Object.keys(s.zones) : [];
  const gm = typeof getGenMixDefaultZones === 'function'
    ? getGenMixDefaultZones()
    : ['FR','DE_LU','ES','BE','NL','GB','PT'];
  const want = gm.filter(z => avail.includes(z));
  setUserZones(want.length ? want : gm);
  renderGlobalZoneChips();
}

window.toggleGlobalZonePanel = toggleGlobalZonePanel;
window.toggleGlobalZone = toggleGlobalZone;
window.selectAllGlobalZones = selectAllGlobalZones;
window.clearGlobalZones = clearGlobalZones;
window.presetGlobalNeighbours = presetGlobalNeighbours;
window.presetGlobalGenMix = presetGlobalGenMix;


// ────────────────────────────────────────────────────────────
// HELPERS · stats for a daily series with optional 15-min source
// ────────────────────────────────────────────────────────────
function _statsForZone(series) {
  // series = filtered array of { d, avg, peakAvg, offAvg, negH, renPct, domFuel, max, min, ... }
  const valid = series.map(d => d.avg).filter(v => v != null && !isNaN(v));
  if (!valid.length) return null;
  const sum = valid.reduce((a, b) => a + b, 0);
  const avg = sum / valid.length;
  const max = Math.max(...valid);
  const min = Math.min(...valid);
  // Dates of min/max (for Extremes card)
  let minDate = null, maxDate = null;
  for (const d of series) {
    if (d.avg === min && !minDate) minDate = d.d;
    if (d.avg === max && !maxDate) maxDate = d.d;
  }
  const variance = valid.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / valid.length;
  const sigma = Math.sqrt(variance);
  // Peak/off-peak avgs (if available in series)
  const peakVals = series.map(d => d.peakAvg).filter(v => v != null);
  const offVals  = series.map(d => d.offAvg ?? d.offPkAvg).filter(v => v != null);
  const peakAvg = peakVals.length ? peakVals.reduce((a,b)=>a+b,0)/peakVals.length : null;
  const offAvg  = offVals.length  ? offVals.reduce((a,b)=>a+b,0)/offVals.length  : null;
  // Intraday spread average = mean of (max_day - min_day) across the series
  // Uses each day's intra-day max/min if present, falls back to peak-offpeak proxy
  const intradayDeltas = series.map(d => {
    if (d.max != null && d.min != null) return d.max - d.min;
    if (d.peakAvg != null && d.offAvg != null) return d.peakAvg - d.offAvg;
    return null;
  }).filter(v => v != null);
  const intradaySpread = intradayDeltas.length
    ? intradayDeltas.reduce((a,b)=>a+b,0) / intradayDeltas.length
    : null;
  const negH = series.reduce((a, d) => a + (d.negH || 0), 0);
  const highH = series.reduce((a, d) => a + (d.highH || 0), 0);
  // %REN avg (only days where renPct present)
  const renVals = series.map(d => d.renPct).filter(v => v != null);
  const renPctAvg = renVals.length ? renVals.reduce((a,b)=>a+b,0)/renVals.length : null;
  // Dominant fuel: most frequent across the window
  const fuelCounts = {};
  series.forEach(d => {
    if (d.domFuel) fuelCounts[d.domFuel] = (fuelCounts[d.domFuel] || 0) + 1;
  });
  const domFuel = Object.keys(fuelCounts).length
    ? Object.keys(fuelCounts).reduce((a,b) => fuelCounts[a] > fuelCounts[b] ? a : b)
    : null;
  return {
    avg, max, min, minDate, maxDate, sigma,
    peakAvg, offAvg, intradaySpread,
    negH, highH, renPctAvg, domFuel,
    days: valid.length
  };
}


// ════════════════════════════════════════════
// BLOCK 1 · OVERVIEW TABLE (multi-zone)
//   - 10 cols: Zone · Avg · Peak · Off-pk · P/OP · σ · Min/Max · Neg h · %REN · Dom.fuel · Days
//   - Click on a zone row → expand: KPI strip + daily-avg / 7D / 30D chart
// ════════════════════════════════════════════

const _HO_NAMES = {
  FR:'France', DE_LU:'Germany', BE:'Belgium', NL:'Netherlands',
  ES:'Spain',  PT:'Portugal',   GB:'Great Britain',
  IT_NORD:'Italy N.', IT_SICI:'Italy S.', AT:'Austria', CH:'Switzerland',
  CZ:'Czechia', PL:'Poland', DK_W:'Denmark W.', DK_E:'Denmark E.',
  SE:'Sweden', NO_1:'Norway 1', FI:'Finland', HU:'Hungary', RO:'Romania',
  HR:'Croatia', SI:'Slovenia', RS:'Serbia', GR:'Greece', BG:'Bulgaria',
  LT:'Lithuania', LV:'Latvia', EE:'Estonia', ME:'Montenegro', MK:'N. Macedonia',
  SK:'Slovakia',
};

// Fuel config aligned with Daily DA (js/prices.js)
const _HO_FUEL_META = {
  Nuclear: { emoji: '⚛', label: 'Nuclear', color: '#7B4B9C' },
  Wind:    { emoji: '🌬', label: 'Wind',    color: '#14D3A9' },
  Solar:   { emoji: '☀', label: 'Solar',   color: '#FBBF24' },
  Hydro:   { emoji: '💧', label: 'Hydro',   color: '#3FA6B4' },
  Biomass: { emoji: '🌿', label: 'Biomass', color: '#94D2BD' },
  Gas:     { emoji: '🔥', label: 'Fossil',  color: '#ED6965' },
};

// Track which row is open and chart instance for that detail row
window._HO_OPEN_ZONE = null;
window._HO_CHART = null;
window._HO_YPRESET = 'standard';  // 'focus' | 'standard' | 'all'

window._hoSetYPreset = function(preset) {
  window._HO_YPRESET = preset;
  const zone = window._HO_OPEN_ZONE;
  const series = window._HO_LAST_SERIES;
  if (zone && series && typeof _buildHoTabChart === 'function') {
    const tab = (window._HO_TABS && window._HO_TABS[zone]) || 'lines';
    _buildHoTabChart(zone, series, tab, false);
    // If fullscreen overlay is open, also re-render its chart
    if (_hoFsIsOpen()) {
      _buildHoTabChart(zone, series, tab, true);
    }
    _hoRenderPresetButtons();
  }
};

window._hoResetZoom = function() {
  // Reset both the manual zoom (drag-selection) and the Y-preset.
  const inline = document.getElementById('ho-detail-chart');
  const fs     = document.getElementById('ho-fs-chart');
  [inline, fs].forEach(canvas => {
    if (!canvas || typeof Chart === 'undefined' || typeof Chart.getChart !== 'function') return;
    const ch = Chart.getChart(canvas);
    if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
  });
  // Also reset the 4 quarter mini-charts in Hourly Quarter mode
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach(q => {
    const c = document.getElementById('hsz-q-canvas-' + q);
    if (!c || typeof Chart === 'undefined' || typeof Chart.getChart !== 'function') return;
    const ch = Chart.getChart(c);
    if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
  });
  // If currently on Lines tab and a non-standard preset is active, reset to standard
  if (window._HO_YPRESET && window._HO_YPRESET !== 'standard') {
    window._HO_YPRESET = 'standard';
    const zone = window._HO_OPEN_ZONE;
    const series = window._HO_LAST_SERIES;
    if (zone && series && typeof _buildHoTabChart === 'function') {
      const tab = (window._HO_TABS && window._HO_TABS[zone]) || 'lines';
      _buildHoTabChart(zone, series, tab, false);
      if (_hoFsIsOpen()) {
        _buildHoTabChart(zone, series, tab, true);
      }
      if (typeof _hoRenderPresetButtons === 'function') _hoRenderPresetButtons();
    }
  }
};

// Update the preset button styles to reflect the active preset
function _hoRenderPresetButtons() {
  ['focus', 'standard', 'all'].forEach(p => {
    const btns = document.querySelectorAll(`[data-ho-preset="${p}"]`);
    const active = window._HO_YPRESET === p;
    btns.forEach(b => {
      b.style.background = active ? 'rgba(20,211,169,0.15)' : 'transparent';
      b.style.borderColor = active ? 'rgba(20,211,169,0.4)' : 'rgba(255,255,255,0.15)';
      b.style.color = active ? '#14D3A9' : 'var(--tx3)';
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Tabs bar inside the ho-detail drill-down row.
// Mirrors the HSZ.tabs list, but writes to the drill-down canvas.
// State is kept in window._HO_TABS[zone] = 'lines' | 'yoy' | …
// ─────────────────────────────────────────────────────────────
function _hoRenderTabsBar(zone, series) {
  const bar = document.getElementById('ho-detail-tabs-bar');
  if (!bar) return;
  const current = (window._HO_TABS && window._HO_TABS[zone]) || 'lines';
  bar.innerHTML = HSZ.tabs.map(t => {
    const on = t.id === current;
    return `<button data-ho-tab="${t.id}" onclick="event.stopPropagation();_hoSetTab('${zone}','${t.id}')" style="
      padding:5px 12px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;
      border:none;background:${on?'var(--bg3)':'transparent'};
      color:${on?'var(--text)':'var(--tx3)'};
      letter-spacing:.03em;
    ">${t.label}</button>`;
  }).join('');
}

window._hoSetTab = function(zone, tabId) {
  if (!window._HO_TABS) window._HO_TABS = {};
  window._HO_TABS[zone] = tabId;
  window._HO_TAB_LAST = tabId;  // remember last tab globally so switching zones preserves view
  HSZ.tab = tabId;  // sync HSZ state so submenu / dispatcher see the right tab
  const series = window._HO_LAST_SERIES;
  if (!series) return;
  _hoRenderTabsBar(zone, series);
  _hoApplyTabVisibility(tabId);
  if (typeof _hszRenderYoYSubmenu === 'function') _hszRenderYoYSubmenu();
  _buildHoTabChart(zone, series, tabId, false);
};

// Show/hide controls that only make sense on specific tabs.
// Y-presets (Focus/Standard/All) → Lines AND YoY (and its sub-modes).
function _hoApplyTabVisibility(tabId) {
  const yp = document.getElementById('ho-detail-ypresets-wrap');
  // Y-presets meaningful on Lines + YoY (all sub-modes have a meaningful Y range)
  const showYPresets = (tabId === 'lines' || tabId === 'yoy');
  if (yp) yp.style.display = showYPresets ? 'flex' : 'none';
}

// Dispatcher used by the drill-down row to render any tab on the
// detail canvas (ho-detail-chart) or the fullscreen canvas (ho-fs-chart).
// All tabs (including Lines) are routed to _hszRenderTab. The legacy
// _buildHoChart (kept below as dead code for now) is no longer used in the
// drill-down flow — Now marker is intentionally dropped on historical
// lookback windows (it only makes sense for live Daily charts).
async function _buildHoTabChart(zone, series, tab, fullscreen) {
  const canvasId = fullscreen ? 'ho-fs-chart' : 'ho-detail-chart';
  // Clear any previous content/grid from the chart wrap (hourly-quarter mode injects one)
  const canvas = document.getElementById(canvasId);
  if (canvas) {
    const wrap = canvas.parentNode;
    // Remove leftover quarter grid from previous renders + hide toggle slot
    const prefix = fullscreen ? 'ho-fs' : 'ho-detail';
    const oldGrid = document.getElementById(prefix + '-quarter-grid');
    if (oldGrid) oldGrid.remove();
    if (typeof _hszHideHourlyToggle === 'function') _hszHideHourlyToggle();
    // Restore canvas visibility (some tabs hide it then show it back)
    canvas.style.display = '';

    // ── CRITICAL: destroy ANY existing Chart.js instance attached to the
    // canvas before re-rendering. Two systems can have left an instance:
    //   • _buildHoChart stores it in window._HO_CHART (or _HO_FS_CHART)
    //   • mkHistChart stores it in HIST.charts[canvasId]
    // If we don't destroy first, Chart.js silently refuses to attach a
    // second chart to the same canvas → the user keeps seeing the previous
    // tab's chart, which is the "all graphs look like Lines" symptom.
    const existing = (typeof Chart !== 'undefined' && typeof Chart.getChart === 'function')
      ? Chart.getChart(canvas) : null;
    if (existing) {
      try { existing.destroy(); } catch (_) {}
    }
    // Clear our internal registries so neither side keeps a stale reference
    const legacyVar = fullscreen ? '_HO_FS_CHART' : '_HO_CHART';
    if (window[legacyVar]) {
      try { window[legacyVar].destroy(); } catch (_) {}
      window[legacyVar] = null;
    }
    if (HIST.charts[canvasId]) {
      try { HIST.charts[canvasId].destroy(); } catch (_) {}
      delete HIST.charts[canvasId];
    }
  }

  // Tab dispatch: all tabs (Lines included) go through _hszRenderTab.
  // The Now marker that used to live in _buildHoChart (legacy) is intentionally
  // dropped here — it makes sense only on Daily charts where the last point IS
  // "now", not on a historical lookback window where it would be misleading.
  const prevTarget = { ..._HSZ_TARGET };
  _HSZ_TARGET.canvasId    = canvasId;
  _HSZ_TARGET.tabsId      = null;
  _HSZ_TARGET.togglePrefix = fullscreen ? 'ho-fs' : 'ho-detail';
  _HSZ_TARGET.getWindow    = () => HIST.windows['ho'] || '3M';
  _HSZ_TARGET.getHourlyMode = () => HSZ.hourlyMode;
  _HSZ_TARGET.getZone       = () => zone;
  _HSZ_TARGET.getTab        = () => tab;
  _HSZ_TARGET.getYPreset    = () => window._HO_YPRESET || 'standard';

  try {
    const summary = await fetchSummary();
    await _hszRenderTab(series, zone, tab, summary);
  } finally {
    // Restore previous context (defensive; nothing else uses it right now)
    Object.assign(_HSZ_TARGET, prevTarget);
  }
}

// ── KPI strip Historical (FR-centric + loaded avg) ──
function _setHoKpi(id, val, unit) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = (val == null || isNaN(val)) ? '--' : val.toFixed(2);
  el.innerHTML = `${v}<span class="kpi-unit">${unit || '€/MWh'}</span>`;
}

// Format negative hours as "HH h MM min" — snapped to the 15-min slot grid
// (because DA prices use 15-min granularity in most ENTSO-E zones, neg hours
// can only be a multiple of 15 min, never 18 or 22 min — that would be a float
// artefact from upstream aggregation). For hourly-only zones, multiples of 60 min.
// Examples: 193.10 → "193 h 00 min" · 0.5 → "0 h 30 min" · 0.30 → "0 h 15 min"
function _fmtNegH(val) {
  // Delegate to shared helper (compact variable: 30min / 1h45 / 194h)
  if (window.PK_FMT && typeof window.PK_FMT.negHours === 'function') {
    return window.PK_FMT.negHours(val);
  }
  // Fallback (should not happen — PK_FMT lives in prices.js, loaded before hist.js)
  if (val == null || isNaN(val)) return '--';
  const totalMinRaw = val * 60;
  const totalMin = Math.round(totalMinRaw / 15) * 15;
  const h  = Math.floor(totalMin / 60);
  const m  = totalMin % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

// ── Interactive sort for Historical Overview table (T2) ────────────────
// State lives in window._HO_SORT = { key, dir }
// Keys map to fields in stats[z] (or special: 'code', 'country', 'minmax' uses st.min)
function _sortHoZones(zones, stats) {
  const sort = window._HO_SORT || { key: 'avg', dir: 'desc' };
  const arr = [...zones];

  const getVal = (z, key) => {
    if (key === 'code') return z;
    if (key === 'country') return (_HO_NAMES[z] || z).toLowerCase();
    const st = stats[z];
    if (!st) return null;
    switch (key) {
      case 'avg':    return st.avg;
      case 'peak':   return st.peakAvg;
      case 'off':    return st.offAvg;
      case 'spread': return st.intradaySpread;
      case 'sigma':  return st.sigma;
      case 'minmax': return st.min; // sort by min as proxy
      case 'negh':   return st.negH;
      case 'ren':    return st.renPctAvg;
      case 'fuel':   return st.domFuel || '';
      case 'days':   return st.days;
      default:       return null;
    }
  };

  arr.sort((a, b) => {
    const va = getVal(a, sort.key);
    const vb = getVal(b, sort.key);
    // Nulls always sort to the bottom regardless of direction
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    let cmp;
    if (typeof va === 'string' && typeof vb === 'string') {
      cmp = va.localeCompare(vb);
    } else {
      cmp = (va > vb) ? 1 : (va < vb ? -1 : 0);
    }
    return sort.dir === 'desc' ? -cmp : cmp;
  });
  return arr;
}

window.sortHoTable = function(key) {
  const cur = window._HO_SORT || { key: 'avg', dir: 'desc' };
  if (cur.key === key) {
    // Toggle direction
    cur.dir = cur.dir === 'desc' ? 'asc' : 'desc';
  } else {
    // New key: default desc for numerics, asc for text (code/country/fuel)
    cur.key = key;
    cur.dir = (key === 'code' || key === 'country' || key === 'fuel') ? 'asc' : 'desc';
  }
  window._HO_SORT = cur;
  // Re-render rows in place without re-fetching
  if (window._HO_STATS && window._HO_SELECTED) {
    const sortedZones = _sortHoZones(window._HO_SELECTED, window._HO_STATS);
    // Trigger a full re-render to reuse the same row template
    if (typeof renderHistOverview === 'function') renderHistOverview();
  }
};

function _resetHoKpiStrip() {
  ['ho-kpi-fr-avg', 'ho-kpi-loaded-avg', 'ho-kpi-fr-peak', 'ho-kpi-fr-off', 'ho-kpi-fr-sigma'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '--<span class="kpi-unit">€/MWh</span>';
  });
  const elN = document.getElementById('ho-kpi-fr-negh');
  if (elN) elN.innerHTML = '--<span class="kpi-unit">h</span>';
  const elH = document.getElementById('ho-kpi-fr-highh');
  if (elH) elH.innerHTML = '--<span class="kpi-unit">h</span>';
  ['ho-kpi-fr-avg-meta', 'ho-kpi-loaded-meta', 'ho-kpi-fr-peak-meta', 'ho-kpi-fr-off-meta', 'ho-kpi-fr-sigma-meta', 'ho-kpi-fr-negh-meta', 'ho-kpi-fr-highh-meta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '--';
    if (el) el.style.color = 'var(--tx3)';
  });
}

// Compute YoY comparison stats by shifting current range exactly 1 year earlier
async function _computeYoYStats(zone, currentSeries, useCustom) {
  const s = await fetchSummary();
  if (!s?.zones?.[zone] || !currentSeries?.length) return { ref: null, status: 'no-ref' };
  const allData = s.zones[zone];
  if (!allData.length) return { ref: null, status: 'no-ref' };
  // Current window bounds
  const curFrom = currentSeries[0].d;
  const curTo   = currentSeries[currentSeries.length - 1].d;
  // Shift by 1 year
  const shiftYear = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${y - 1}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  };
  const prevFrom = shiftYear(curFrom);
  const prevTo   = shiftYear(curTo);
  // Earliest date in data
  const earliestData = allData[0].d;
  // If prevFrom is before earliestData, we have less than full coverage
  const expectedDays = currentSeries.length;
  const refSeries = allData.filter(d => d.d >= prevFrom && d.d <= prevTo);
  const coverage = refSeries.length / Math.max(1, expectedDays);

  if (coverage === 0 || refSeries.length === 0) {
    return { ref: null, status: 'no-ref' };
  }
  const refStats = _statsForZone(refSeries);
  if (coverage < 0.5) {
    return { ref: refStats, status: 'no-ref' };  // not enough coverage to be meaningful
  }
  return { ref: refStats, status: coverage < 0.95 ? 'partial' : 'comparable' };
}

// Format a YoY delta on a KPI meta line
// metric: 'price' (avg/peak/off/sigma) or 'count' (negH)
// inversed: if true, lower current = bad (e.g. negH increase is bad) — not used currently
function _formatYoYDelta(currentVal, refVal, status, fallbackText) {
  if (status === 'no-ref' || refVal == null || currentVal == null || refVal === 0) {
    return { html: fallbackText || '<span style="color:var(--tx3)">— no Y-1 ref</span>', color: 'var(--tx3)' };
  }
  const deltaPct = ((currentVal - refVal) / Math.abs(refVal)) * 100;
  const arrow = deltaPct >= 0 ? '▲' : '▼';
  const sign  = deltaPct >= 0 ? '+' : '';
  // Color: rouge si plus haut (= plus cher/plus volatile = mauvais signal), vert si plus bas
  let color;
  if (status === 'partial') {
    color = '#FBBF24';  // amber = partial coverage
  } else {
    color = deltaPct >= 0 ? '#ED6965' : '#14D3A9';
  }
  const partialBadge = status === 'partial' ? ' <span style="color:var(--tx3);font-size:9px">(~partial)</span>' : '';
  return {
    html: `<span style="color:${color}">${arrow} ${sign}${deltaPct.toFixed(1)}% vs Y-1${partialBadge}</span>`,
    color,
  };
}

async function _updateHoKpiStrip(stats, selected, seriesByZone) {
  const fr = stats['FR'];
  const useCustom = !!(HIST.customRange && HIST.customRange.from && HIST.customRange.to);

  // Helper to set a metric value + meta YoY delta + apply directional class on parent card
  const setMetric = (idVal, idMeta, currentVal, refVal, status, fallbackText, unit) => {
    _setHoKpi(idVal, currentVal, unit);
    const elMeta = document.getElementById(idMeta);
    if (elMeta) {
      const { html } = _formatYoYDelta(currentVal, refVal, status, fallbackText);
      elMeta.innerHTML = html;
    }
    // Apply directional class to parent .kpi-card so the left border colour reflects YoY direction.
    // Convention: "monter = rouge" (market stress signal) — applies to all KPIs (avg, peak, off-peak,
    // σ, neg-hours, high-hours). Higher value vs Y-1 = red border; lower = green; ±1% = flat.
    const elVal = document.getElementById(idVal);
    const card = elVal ? elVal.closest('.kpi-card') : null;
    if (card) {
      card.classList.remove('kpi-up', 'kpi-down', 'kpi-flat');
      let cls = 'kpi-flat';
      if (status !== 'no-ref' && status !== 'partial' && refVal != null && currentVal != null) {
        // Threshold 1% of |ref| to avoid noise on tiny changes
        if (Math.abs(currentVal - refVal) < 0.01 * Math.max(1, Math.abs(refVal))) {
          cls = 'kpi-flat';
        } else {
          // INVERTED: higher current = stress signal = kpi-down (red border)
          cls = currentVal > refVal ? 'kpi-down' : 'kpi-up';
        }
      }
      card.classList.add(cls);
    }
  };

  // FR-centric metrics
  if (fr && seriesByZone['FR']?.length) {
    const yoy = await _computeYoYStats('FR', seriesByZone['FR'], useCustom);
    const ref = yoy.ref;
    const st = yoy.status;
    setMetric('ho-kpi-fr-avg',   'ho-kpi-fr-avg-meta',   fr.avg,     ref?.avg     ?? null, st, null, '€/MWh');
    setMetric('ho-kpi-fr-peak',  'ho-kpi-fr-peak-meta',  fr.peakAvg, ref?.peakAvg ?? null, st, null, '€/MWh');
    setMetric('ho-kpi-fr-off',   'ho-kpi-fr-off-meta',   fr.offAvg,  ref?.offAvg  ?? null, st, null, '€/MWh');
    setMetric('ho-kpi-fr-sigma', 'ho-kpi-fr-sigma-meta', fr.sigma,   ref?.sigma   ?? null, st, null, '€/MWh');
    // Neg hours — formatted as "HH h MM min" (no decimals/floats)
    const elN = document.getElementById('ho-kpi-fr-negh');
    if (elN) elN.innerHTML = _fmtNegH(fr.negH);
    const elNm = document.getElementById('ho-kpi-fr-negh-meta');
    if (elNm) {
      const { html } = _formatYoYDelta(fr.negH, ref?.negH ?? null, st);
      elNm.innerHTML = html;
    }
    // Apply directional class on neg hours card too
    const cardN = elN ? elN.closest('.kpi-card') : null;
    if (cardN) {
      cardN.classList.remove('kpi-up', 'kpi-down', 'kpi-flat');
      let clsN = 'kpi-flat';
      const refNegH = ref?.negH ?? null;
      if (st !== 'no-ref' && st !== 'partial' && refNegH != null && fr.negH != null) {
        if (Math.abs(fr.negH - refNegH) < 0.01 * Math.max(1, Math.abs(refNegH))) {
          clsN = 'kpi-flat';
        } else {
          clsN = fr.negH > refNegH ? 'kpi-down' : 'kpi-up';
        }
      }
      cardN.classList.add(clsN);
    }
    // High hours (> 100 EUR/MWh) — formatted same as neg hours
    const elH = document.getElementById('ho-kpi-fr-highh');
    if (elH) elH.innerHTML = _fmtNegH(fr.highH || 0);
    const elHm = document.getElementById('ho-kpi-fr-highh-meta');
    if (elHm) {
      const { html } = _formatYoYDelta(fr.highH, ref?.highH ?? null, st);
      elHm.innerHTML = html;
    }
    const cardH = elH ? elH.closest('.kpi-card') : null;
    if (cardH) {
      cardH.classList.remove('kpi-up', 'kpi-down', 'kpi-flat');
      let clsH = 'kpi-flat';
      const refHighH = ref?.highH ?? null;
      if (st !== 'no-ref' && st !== 'partial' && refHighH != null && fr.highH != null) {
        if (Math.abs(fr.highH - refHighH) < 0.01 * Math.max(1, Math.abs(refHighH))) {
          clsH = 'kpi-flat';
        } else {
          clsH = fr.highH > refHighH ? 'kpi-down' : 'kpi-up';
        }
      }
      cardH.classList.add(clsH);
    }
  } else {
    _setHoKpi('ho-kpi-fr-avg',   null);
    _setHoKpi('ho-kpi-fr-peak',  null);
    _setHoKpi('ho-kpi-fr-off',   null);
    _setHoKpi('ho-kpi-fr-sigma', null);
    const elN = document.getElementById('ho-kpi-fr-negh');
    if (elN) elN.innerHTML = '--<span class="kpi-unit">h</span>';
    const elH = document.getElementById('ho-kpi-fr-highh');
    if (elH) elH.innerHTML = '--<span class="kpi-unit">h</span>';
    ['ho-kpi-fr-avg-meta','ho-kpi-fr-peak-meta','ho-kpi-fr-off-meta','ho-kpi-fr-sigma-meta','ho-kpi-fr-negh-meta','ho-kpi-fr-highh-meta'].forEach(id=>{
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<span style="color:var(--tx3)">— no Y-1 ref</span>';
    });
  }

  // Loaded zones avg
  const validAvgs = selected.map(z => stats[z]?.avg).filter(v => v != null);
  const loadedAvg = validAvgs.length ? validAvgs.reduce((a,b)=>a+b,0)/validAvgs.length : null;
  _setHoKpi('ho-kpi-loaded-avg', loadedAvg, '€/MWh');

  // YoY for loaded avg: compute per-zone YoY refs and average them
  if (loadedAvg != null && selected.length) {
    const refAvgs = [];
    let anyPartial = false;
    let anyComparable = false;
    for (const z of selected) {
      if (!seriesByZone[z]?.length) continue;
      const yoy = await _computeYoYStats(z, seriesByZone[z], useCustom);
      if (yoy.ref?.avg != null && yoy.status !== 'no-ref') {
        refAvgs.push(yoy.ref.avg);
        if (yoy.status === 'partial') anyPartial = true;
        if (yoy.status === 'comparable') anyComparable = true;
      }
    }
    const refLoadedAvg = refAvgs.length ? refAvgs.reduce((a,b)=>a+b,0)/refAvgs.length : null;
    const st = refAvgs.length === 0 ? 'no-ref' : (anyPartial && !anyComparable ? 'partial' : (anyPartial ? 'partial' : 'comparable'));
    const elMeta = document.getElementById('ho-kpi-loaded-meta');
    if (elMeta) {
      const { html } = _formatYoYDelta(loadedAvg, refLoadedAvg, st, `<span style="color:var(--tx3)">${refAvgs.length}/${selected.length} zones · — no Y-1 ref</span>`);
      elMeta.innerHTML = html;
    }
    // Apply directional class on Loaded card (same convention: monter = rouge)
    const elLoadedVal = document.getElementById('ho-kpi-loaded-avg');
    const cardLoaded = elLoadedVal ? elLoadedVal.closest('.kpi-card') : null;
    if (cardLoaded) {
      cardLoaded.classList.remove('kpi-up', 'kpi-down', 'kpi-flat');
      let clsL = 'kpi-flat';
      if (st !== 'no-ref' && st !== 'partial' && refLoadedAvg != null && loadedAvg != null) {
        if (Math.abs(loadedAvg - refLoadedAvg) < 0.01 * Math.max(1, Math.abs(refLoadedAvg))) {
          clsL = 'kpi-flat';
        } else {
          clsL = loadedAvg > refLoadedAvg ? 'kpi-down' : 'kpi-up';
        }
      }
      cardLoaded.classList.add(clsL);
    }
  } else {
    const elMeta = document.getElementById('ho-kpi-loaded-meta');
    if (elMeta) elMeta.innerHTML = '<span style="color:var(--tx3)">— no Y-1 ref</span>';
    // No reference: reset card to flat
    const elLoadedVal = document.getElementById('ho-kpi-loaded-avg');
    const cardLoaded = elLoadedVal ? elLoadedVal.closest('.kpi-card') : null;
    if (cardLoaded) {
      cardLoaded.classList.remove('kpi-up', 'kpi-down');
      cardLoaded.classList.add('kpi-flat');
    }
  }
}

async function renderHistOverview() {
  const w = HIST.windows['ho'] || '3M';
  const s = await fetchSummary();
  if (!s?.zones) return;

  updateZoneLabels();

  const selected = getUserZones().filter(z => s.zones[z]);
  if (!selected.length) {
    document.getElementById('ho-table-tbody').innerHTML =
      '<tr><td colspan="12" style="text-align:center;padding:20px;color:var(--tx3);font-size:11px">No zone selected</td></tr>';
    _resetHoKpiStrip();
    return;
  }

  // Compute stats per zone + keep filtered series for the detail panel
  const stats = {};
  const seriesByZone = {};
  let earliest = null, latest = null;
  const useCustom = !!(HIST.customRange && HIST.customRange.from && HIST.customRange.to);
  selected.forEach(z => {
    const filtered = useCustom
      ? filterByRange(s.zones[z], HIST.customRange.from, HIST.customRange.to)
      : filterByWindow(s.zones[z], w);
    seriesByZone[z] = filtered;
    stats[z] = _statsForZone(filtered);
    if (filtered.length) {
      const first = filtered[0].d, last = filtered[filtered.length-1].d;
      if (!earliest || first < earliest) earliest = first;
      if (!latest  || last  > latest)   latest   = last;
    }
  });

  // ── Period label + zones count (sub-header) ──
  const periodEl = document.getElementById('ho-period-label');
  let periodText = '';
  if (HIST.customRange && HIST.customRange.from && HIST.customRange.to) {
    periodText = `${HIST.customRange.from} → ${HIST.customRange.to}`;
  } else if (earliest && latest) {
    periodText = periodLabel([{ d: earliest }, { d: latest }]);
  }
  if (periodEl) periodEl.textContent = periodText || '--';
  const zonesLabel = document.getElementById('ho-zones-label');
  if (zonesLabel) zonesLabel.textContent = `${selected.length} zones loaded`;

  // ── KPI strip globale (FR-centric + loaded avg) avec vs Y-1 ──
  _updateHoKpiStrip(stats, selected, seriesByZone);

  // ── Persist state for interactive sort (sortHoTable) ──
  window._HO_STATS = stats;
  window._HO_SELECTED = selected;
  window._HO_SERIES_BY_ZONE = seriesByZone;
  if (!window._HO_SORT) window._HO_SORT = { key: 'avg', dir: 'desc' };

  // Apply current sort to a copy of selected
  const sortedZones = _sortHoZones(selected, stats);

  // ── Table rows ──
  const tbody = document.getElementById('ho-table-tbody');
  if (!tbody) return;

  const rowsHtml = sortedZones.map(z => {
    const st = stats[z];
    const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
    const countryName = _HO_NAMES[z] || z;
    if (!st) {
      return `<tr class="ho-row" data-zone="${z}">
        <td style="text-align:left;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--tx2)"><svg class="row-chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;opacity:0.2;vertical-align:0"><polyline points="9 18 15 12 9 6"/></svg>${flag} ${z}</td>
        <td style="text-align:left;font-size:11px;color:var(--tx2)">${countryName}</td>
        <td colspan="10" style="text-align:center;color:var(--tx3);font-size:10px">no data in selected window</td>
      </tr>`;
    }
    // 2 decimals everywhere for prices/€; thin-space thousands separator via PK_FMT.num.
    const fmt = v => (window.PK_FMT ? PK_FMT.num(v, 2) : ((v == null || isNaN(v)) ? '--' : v.toFixed(2)));
    // Intraday spread (proxy BESS) — harmonised thresholds: <80 neutral / 80-150 light green / >150 intense green
    const spreadColor = window.PK_FMT
      ? PK_FMT.spreadColor(st.intradaySpread)
      : (st.intradaySpread == null ? 'var(--tx3)' : (st.intradaySpread > 80 ? '#14D3A9' : 'var(--tx)'));
    // %REN — harmonised thresholds with Daily: <35 red / 35-65 orange / >65 green
    let renHtml = '<span style="color:var(--tx3)">--</span>';
    if (st.renPctAvg != null) {
      const rp = Math.round(st.renPctAvg);
      const c = window.PK_FMT ? PK_FMT.renColor(rp) : (rp >= 65 ? '#14D3A9' : rp >= 35 ? '#FBBF24' : '#ED6965');
      renHtml = `<span style="color:${c};font-weight:600">${rp}%</span>`;
    }
    // Dom fuel — emoji + color from FUEL_META, aligned with Daily
    const fm = st.domFuel ? _HO_FUEL_META[st.domFuel] : null;
    const fuelHtml = fm
      ? `<span style="color:${fm.color};font-size:11px">${fm.emoji} ${fm.label}</span>`
      : '<span style="color:var(--tx3)">--</span>';
    // Neg h colored only if elevated (harmonised with Daily — orange for any, red for heavy)
    const negColor = window.PK_FMT
      ? PK_FMT.negColor(st.negH, {lightThreshold:0, heavyThreshold:50})
      : (st.negH > 50 ? '#ED6965' : (st.negH > 10 ? '#FBBF24' : 'var(--tx2)'));

    return `<tr class="ho-row" data-zone="${z}" style="cursor:pointer">
      <td style="text-align:left;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--tx2)"><svg class="row-chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;opacity:0.45;vertical-align:0;transition:transform 0.15s ease"><polyline points="9 18 15 12 9 6"/></svg>${flag} ${z}</td>
      <td style="text-align:left;font-size:11px;color:var(--tx2)">${countryName}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--tx)">${fmt(st.avg)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx2)">${fmt(st.peakAvg)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx2)">${fmt(st.offAvg)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${spreadColor};font-weight:600">${fmt(st.intradaySpread)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx2)">${fmt(st.sigma)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx2)">${fmt(st.min)} / ${fmt(st.max)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${negColor}">${_fmtNegH(st.negH)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${renHtml}</td>
      <td style="text-align:left;font-family:'JetBrains Mono',monospace">${fuelHtml}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${st.days}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rowsHtml;

  // Attach click handlers for expand
  tbody.querySelectorAll('.ho-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const z = tr.getAttribute('data-zone');
      _toggleHoRow(z, seriesByZone[z], stats[z]);
    });
  });

  // Re-apply open state if we had one (e.g. after re-render from window change)
  if (window._HO_OPEN_ZONE && seriesByZone[window._HO_OPEN_ZONE]) {
    _openHoRow(window._HO_OPEN_ZONE, seriesByZone[window._HO_OPEN_ZONE], stats[window._HO_OPEN_ZONE]);
  }
}
window.renderHistOverview = renderHistOverview;

// ── Toggle / Open / Close detail row ─────────────────────
function _toggleHoRow(zone, series, st) {
  if (window._HO_OPEN_ZONE === zone) {
    _closeHoRow();
    return;
  }
  if (window._HO_OPEN_ZONE) _closeHoRow();
  _openHoRow(zone, series, st);
}

function _closeHoRow() {
  const detail = document.getElementById('ho-detail-row');
  if (detail) detail.remove();
  document.querySelectorAll('#ho-table-tbody tr.ho-row').forEach(r => r.classList.remove('is-open'));
  if (window._HO_CHART) {
    try { window._HO_CHART.destroy(); } catch (_) {}
    window._HO_CHART = null;
  }
  window._HO_OPEN_ZONE = null;
}

// ── Helper: download Historical detail chart as PNG (calqué sur Daily downloadRowChart) ──
function _downloadHoChart(zone, fullscreen) {
  // Prefer Chart.getChart on the active canvas — works whether the chart
  // was created by _buildHoChart (legacy Lines, stored in window._HO_*_CHART)
  // or by mkHistChart (other tabs, stored in HIST.charts[canvasId]).
  const canvasId = fullscreen ? 'ho-fs-chart' : 'ho-detail-chart';
  const canvas = document.getElementById(canvasId);
  const chart = (canvas && typeof Chart !== 'undefined' && typeof Chart.getChart === 'function')
    ? Chart.getChart(canvas)
    : (fullscreen ? window._HO_FS_CHART : window._HO_CHART);
  if (!chart) {
    console.warn('No Historical chart found for download');
    return;
  }
  const series = window._HO_LAST_SERIES;
  const periodStr = series && series.length
    ? `${series[0].d}_to_${series[series.length-1].d}`
    : new Date().toISOString().slice(0,10);
  const tab = (window._HO_TABS && window._HO_TABS[zone]) || 'lines';
  // High-res PNG with theme bg color
  const bgFill = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#0a0d12';
  const dataUrl = chart.toBase64Image('image/png', 1, bgFill);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `powerklock_historical_${zone}_${tab}_${periodStr}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
window._downloadHoChart = _downloadHoChart;

// ─────────────────────────────────────────────────────────────
// Export the *current chart's* underlying data as CSV.
// Reads Chart.js .data (labels + datasets) directly, so the export
// always matches what the user sees on screen — works for any tab
// (Lines / YoY / Seasonal / Hourly / Weekly / Volatility / Distribution).
// ─────────────────────────────────────────────────────────────
function _exportHoChartCsv(zone, fullscreen) {
  const canvasId = fullscreen ? 'ho-fs-chart' : 'ho-detail-chart';
  const canvas = document.getElementById(canvasId);
  const chart = (canvas && typeof Chart !== 'undefined' && typeof Chart.getChart === 'function')
    ? Chart.getChart(canvas)
    : (fullscreen ? window._HO_FS_CHART : window._HO_CHART);

  // Hourly tab in 'quarter' mode renders a 2×2 grid of mini-charts instead of
  // a single canvas — handle that separately.
  if (!chart) {
    const gridPrefix = fullscreen ? 'ho-fs' : 'ho-detail';
    const grid = document.getElementById(gridPrefix + '-quarter-grid');
    if (grid) {
      return _exportHoQuarterGridCsv(zone, grid);
    }
    console.warn('No chart found for CSV export');
    return;
  }

  const labels = (chart.data && chart.data.labels) || [];
  const datasets = (chart.data && chart.data.datasets) || [];
  if (!labels.length || !datasets.length) {
    console.warn('Chart has no data to export');
    return;
  }

  // Build CSV: first column = label (X), then one column per visible dataset.
  // Skip datasets hidden via legend or `hidden: true` on the dataset itself.
  const visibleDatasets = datasets.filter((ds, i) => {
    const meta = chart.getDatasetMeta ? chart.getDatasetMeta(i) : null;
    if (meta && meta.hidden === true) return false;
    if (ds.hidden === true) return false;
    return true;
  });
  const header = ['X', ...visibleDatasets.map(ds => ds.label || 'Series')];
  const rows = labels.map((lab, i) => {
    const cells = [String(lab == null ? '' : lab)];
    visibleDatasets.forEach(ds => {
      const v = ds.data ? ds.data[i] : null;
      if (v == null || (typeof v === 'number' && isNaN(v))) cells.push('');
      else if (typeof v === 'object' && v !== null && 'y' in v) cells.push(String(v.y));
      else cells.push(String(v));
    });
    return cells;
  });

  const escape = (s) => {
    if (s == null) return '';
    const str = String(s);
    return /[,"\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const csv = [header.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');

  const series = window._HO_LAST_SERIES;
  const periodStr = series && series.length
    ? `${series[0].d}_to_${series[series.length-1].d}`
    : new Date().toISOString().slice(0,10);
  const tab = (window._HO_TABS && window._HO_TABS[zone]) || 'lines';

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `powerklock_historical_${zone}_${tab}_${periodStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
window._exportHoChartCsv = _exportHoChartCsv;

// Hourly · Quarter mode CSV: 4 mini-charts (Q1..Q4) → single CSV with
// a `quarter` column to keep them in one file.
function _exportHoQuarterGridCsv(zone, grid) {
  if (typeof Chart === 'undefined' || typeof Chart.getChart !== 'function') return;
  const canvases = grid.querySelectorAll('canvas');
  if (!canvases.length) return;
  const rows = [['quarter', 'hour', 'series', 'value']];
  canvases.forEach(c => {
    const ch = Chart.getChart(c);
    if (!ch || !ch.data) return;
    const q = (c.id.match(/hsz-q-canvas-(Q\d)/) || [])[1] || c.id;
    const labels = ch.data.labels || [];
    (ch.data.datasets || []).forEach(ds => {
      if (ds.hidden === true) return;
      labels.forEach((lab, i) => {
        const v = ds.data ? ds.data[i] : null;
        if (v == null || (typeof v === 'number' && isNaN(v))) return;
        rows.push([q, String(lab), ds.label || 'Series', String(v)]);
      });
    });
  });
  if (rows.length <= 1) return;
  const escape = (s) => /[,"\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
  const csv = rows.map(r => r.map(escape).join(',')).join('\n');
  const series = window._HO_LAST_SERIES;
  const periodStr = series && series.length
    ? `${series[0].d}_to_${series[series.length-1].d}`
    : new Date().toISOString().slice(0,10);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `powerklock_historical_${zone}_hourly-quarter_${periodStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────
// Tabs bar inside the fullscreen header.
// Mirrors the inline drill-down tabs and shares the same state
// (window._HO_TABS[zone]) so switching tab in fullscreen also
// updates the inline view when it's closed.
// ─────────────────────────────────────────────────────────────
function _hoRenderFsTabsBar(zone, series) {
  const bar = document.getElementById('ho-fs-tabs-bar');
  if (!bar) return;
  const current = (window._HO_TABS && window._HO_TABS[zone]) || 'lines';
  bar.innerHTML = HSZ.tabs.map(t => {
    const on = t.id === current;
    return `<button data-ho-fs-tab="${t.id}" onclick="event.stopPropagation();_hoFsSetTab('${zone}','${t.id}')" style="
      padding:5px 12px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;
      border:none;background:${on?'var(--bg3)':'transparent'};
      color:${on?'var(--text)':'var(--tx3)'};
      letter-spacing:.03em;
    ">${t.label}</button>`;
  }).join('');
}

window._hoFsSetTab = function(zone, tabId) {
  if (!window._HO_TABS) window._HO_TABS = {};
  window._HO_TABS[zone] = tabId;
  window._HO_TAB_LAST = tabId;  // remember last tab globally for cross-zone persistence
  HSZ.tab = tabId;
  const series = window._HO_LAST_SERIES;
  if (!series) return;
  _hoRenderFsTabsBar(zone, series);
  _hoApplyFsTabVisibility(tabId);
  if (typeof _hszRenderYoYSubmenu === 'function') _hszRenderYoYSubmenu();
  _buildHoTabChart(zone, series, tabId, true);
  // Also keep the inline view in sync (so closing fullscreen lands on the same tab)
  if (document.getElementById('ho-detail-tabs-bar')) {
    _hoRenderTabsBar(zone, series);
    _hoApplyTabVisibility(tabId);
  }
};

function _hoApplyFsTabVisibility(tabId) {
  const legend = document.getElementById('ho-fs-legend');
  const yp     = document.getElementById('ho-fs-ypresets-wrap');
  const showYPresets = (tabId === 'lines' || tabId === 'yoy');
  if (legend) legend.style.display = (tabId === 'lines') ? 'flex' : 'none';
  if (yp)     yp.style.display     = showYPresets ? 'flex' : 'none';
}

// ── Helper: short date "15 Feb 2026" ──
function _fmtShortDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[m-1]} ${y}`;
}

// Format any date-like label as "DD-MM-YYYY" (UK numeric) for chart axis ticks.
// Accepts ISO "YYYY-MM-DD", US "MM/DD/YYYY", or any Date-parseable string.
function _fmtTickUK(label) {
  if (!label) return '';
  const pad = (n) => String(n).padStart(2, '0');
  // Fast-path: ISO format we can parse without ambiguity
  if (typeof label === 'string' && /^\d{4}-\d{2}-\d{2}/.test(label)) {
    const [y, m, d] = label.slice(0, 10).split('-');
    return `${d}-${m}-${y}`;
  }
  // Fallback: parse anything else
  const dt = new Date(label);
  if (isNaN(dt)) return String(label);
  return `${pad(dt.getDate())}-${pad(dt.getMonth() + 1)}-${dt.getFullYear()}`;
}

// ── Helper: build "verdict" sentence summarising the period ──
// Format: "● {Verdict} period · σ {σ} €/MWh · {%REN}% renewable · {neg days} days below 0"
// Verdict categorisation:
//   avg < 50 → "Cheap"          50 ≤ avg ≤ 100 → "Average"        avg > 100 → "Expensive"
//   σ < 15  → "stable"          15 ≤ σ < 30   → "moderate"        σ ≥ 30   → "volatile"
function _buildHoVerdict(st) {
  if (!st || st.avg == null) return '';
  // Price level (compared to typical European DA price ranges 2020-2024)
  let level, levelExplain;
  if (st.avg < 50)        { level = 'Low prices';      levelExplain = 'avg < 50 €/MWh — well below typical EU DA levels'; }
  else if (st.avg <= 100) { level = 'Mid-range prices'; levelExplain = 'avg 50–100 €/MWh — within typical EU DA range'; }
  else                    { level = 'High prices';      levelExplain = 'avg > 100 €/MWh — well above typical EU DA levels'; }
  // Volatility (based on std deviation of daily averages)
  let vol, volExplain;
  if (st.sigma == null || st.sigma < 15) { vol = 'low volatility';     volExplain = 'σ < 15 €/MWh — daily prices move little'; }
  else if (st.sigma < 30)                { vol = 'moderate volatility';volExplain = 'σ 15–30 €/MWh — daily prices swing noticeably'; }
  else                                   { vol = 'high volatility';    volExplain = 'σ ≥ 30 €/MWh — daily prices swing strongly'; }
  // Dot colour based on level
  const dotColor = level === 'Low prices'  ? '#14D3A9'
                 : level === 'Mid-range prices' ? '#FBBF24'
                 :                                '#ED6965';
  // Build secondary indicators
  const parts = [];
  if (st.sigma != null)      parts.push(`σ ${st.sigma.toFixed(1)} €/MWh`);
  if (st.renPctAvg != null)  parts.push(`${Math.round(st.renPctAvg)}% renewable`);
  if (st.negH > 0)           parts.push(`${_fmtNegH(st.negH)} negative`);
  const secondary = parts.length ? ' · ' + parts.join(' · ') : '';

  // Tooltip combining both explanations
  const tooltip = `Price level: ${levelExplain}\nVolatility: ${volExplain}\n\nThresholds are calibrated on typical EU DA prices 2020–2024.`;
  const phrase = `${level}, ${vol}`;
  return `<span title="${tooltip.replace(/"/g,'&quot;')}" style="cursor:help"><span style="color:${dotColor};margin-right:6px">●</span><span style="color:var(--tx)">${phrase}</span><span style="color:var(--tx3)">${secondary}</span></span>`;
}
// Exposed on window so prices.js (Daily drill) can call the same verdict builder.
if (typeof window !== 'undefined') window._buildHoVerdict = _buildHoVerdict;

// ════════════════════════════════════════════════════════════════════════════
// CONTEXTUAL BREAKDOWN MODULE
// Each tab shows a different data table in the right-hand pane and below the
// inline chart. Dispatched by _renderHoBreakdown(zone, series, summary).
// Reads the currently active tab/sub-mode from HSZ state.
// ════════════════════════════════════════════════════════════════════════════

// Common table style helpers
const _BD_TABLE_STYLE = 'width:100%;border-collapse:collapse;font-family:\'JetBrains Mono\',monospace;font-size:11px';
const _BD_TH_STYLE = 'text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd);font-size:9px;font-weight:600;color:var(--tx3);letter-spacing:.05em;text-transform:uppercase';
const _BD_TD_STYLE = 'text-align:right;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.04);color:var(--tx2)';
const _BD_TD_LABEL = 'text-align:left;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.04);color:var(--tx)';

function _bdFmt(v, dec = 2) {
  if (v == null || isNaN(v)) return '<span style="color:var(--tx3)">–</span>';
  return v.toFixed(dec);
}
function _bdDelta(v, dec = 1) {
  if (v == null || isNaN(v)) return '<span style="color:var(--tx3)">–</span>';
  const arrow = v >= 0 ? '▲' : '▼';
  const color = v >= 0 ? '#ED6965' : '#14D3A9';  // for prices: higher = bad (red), lower = good (green)
  return `<span style="color:${color}">${arrow} ${v.toFixed(dec)}</span>`;
}

// ── Central dispatcher ──────────────────────────────────────────────────────
// Called after each tab render. Reads HSZ state, picks the right renderer,
// writes into #ho-detail-monthly (inline) AND #ho-fs-monthly (fullscreen).
function _renderHoBreakdown(zone, series, summary) {
  if (!zone || !series || !series.length) return;

  // Determine current view
  const tab = HSZ.tab;
  const yoyMode = HSZ.yoyMode;
  const hourlyMode = HSZ.hourlyMode;

  // Pick renderer + label
  let label = 'Breakdown';
  let renderer = null;
  if (tab === 'lines') {
    label = 'Monthly breakdown';
    renderer = () => _bdLines(zone, series);
  } else if (tab === 'yoy') {
    if (yoyMode === 'daily') {
      label = 'Monthly breakdown';
      renderer = () => _bdLines(zone, series);
    } else if (yoyMode === 'weekly') {
      label = 'Weekly breakdown';
      renderer = () => _bdYoYWeekly(zone, series, summary);
    } else if (yoyMode === 'monthly') {
      label = 'Monthly comparison YoY';
      renderer = () => _bdYoYMonthly(zone, series, summary);
    } else if (yoyMode === 'hourly') {
      if (hourlyMode === 'quarter') {
        label = 'Hourly × Quarter';
        renderer = () => _bdHourlyQuarter(zone, summary);
      } else {
        label = 'Hourly breakdown';
        renderer = () => _bdHourlyAnnual(zone, summary);
      }
    }
  } else if (tab === 'weekday' || tab === 'weekly') {
    label = 'Day of week breakdown';
    renderer = () => _bdWeekday(zone, series);
  } else if (tab === 'volatility') {
    label = 'Volatility breakdown';
    renderer = () => _bdVolatility(zone, series);
  } else if (tab === 'distribution') {
    label = 'Distribution breakdown';
    renderer = () => _bdDistribution(zone, series);
  }

  // Update labels (inline + FS)
  const inlineLabel = document.getElementById('ho-detail-breakdown-label');
  if (inlineLabel) inlineLabel.textContent = label;
  const fsLabel = document.getElementById('ho-fs-breakdown-label');
  if (fsLabel) fsLabel.textContent = label;

  // Render the HTML (renderer returns string)
  const html = renderer ? (renderer() || '<div style="color:var(--tx3);font-size:11px;padding:8px">No data</div>') : '';

  const inlineEl = document.getElementById('ho-detail-monthly');
  if (inlineEl) inlineEl.innerHTML = html;
  const fsEl = document.getElementById('ho-fs-monthly');
  if (fsEl) fsEl.innerHTML = html;

  // FS side pane · show Monthly/Daily toggle only on the Lines tab.
  // On other tabs the breakdown content is intrinsically tied to the chart,
  // so we hide the toggle and keep the default renderer's output.
  const toggleEl = document.getElementById('ho-fs-breakdown-toggle');
  if (toggleEl) {
    toggleEl.style.display = (tab === 'lines') ? 'inline-flex' : 'none';
  }
  // If the user had previously selected Daily and we're back on Lines, render daily
  if (tab === 'lines' && window._HO_BREAKDOWN_MODE === 'daily' && fsEl) {
    const dailyHtml = _bdDaily(zone, series);
    if (dailyHtml) {
      fsEl.innerHTML = dailyHtml;
      if (fsLabel) fsLabel.textContent = 'Daily breakdown';
    }
  } else if (tab !== 'lines') {
    // Reset toggle state for non-lines tabs (purely cosmetic, the toggle is hidden)
    window._HO_BREAKDOWN_MODE = 'monthly';
  }
}

// ── _bdLines / YoY Daily: Monthly breakdown (current behaviour) ────────────
function _bdLines(zone, series) {
  // Group by YYYY-MM
  const monthly = {};
  series.forEach(d => {
    const ym = d.d.slice(0, 7);
    if (!monthly[ym]) monthly[ym] = { rows: [] };
    monthly[ym].rows.push(d);
  });
  const months = Object.keys(monthly).sort();
  if (!months.length) return null;

  const rows = months.map(ym => {
    const monthRows = monthly[ym].rows;
    const mst = _statsForZone(monthRows);
    const spread = (mst?.peakAvg != null && mst?.offAvg != null) ? (mst.peakAvg - mst.offAvg) : null;
    const allMaxes = monthRows.map(r => r.max).filter(v => v != null);
    const allMins  = monthRows.map(r => r.min).filter(v => v != null);
    const absMax = allMaxes.length ? Math.max(...allMaxes) : null;
    const absMin = allMins.length  ? Math.min(...allMins)  : null;
    const negH = monthRows.reduce((s, r) => s + (r.negHours || 0), 0);
    return {
      ym, avg: mst?.avg, peak: mst?.peakAvg, off: mst?.offAvg, spread,
      absMax, absMin, negH, days: monthRows.length,
    };
  }).reverse();  // newest first

  const monthLabel = ym => {
    const [y, m] = ym.split('-');
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1] + ' ' + y;
  };
  const fmtNeg = h => {
    if (!h) return '–';
    if (h >= 1) return `${Math.round(h)}h`;
    return `${Math.round(h * 60)}min`;
  };

  return `<table style="${_BD_TABLE_STYLE}">
    <thead><tr>
      <th style="${_BD_TH_STYLE};text-align:left">Month</th>
      <th style="${_BD_TH_STYLE}">Avg €/MWh</th>
      <th style="${_BD_TH_STYLE}">Min intra-day</th>
      <th style="${_BD_TH_STYLE}">Max intra-day</th>
      <th style="${_BD_TH_STYLE}">Peak avg</th>
      <th style="${_BD_TH_STYLE}">Off-peak</th>
      <th style="${_BD_TH_STYLE}">Spread P-OP</th>
      <th style="${_BD_TH_STYLE}">Neg hours</th>
      <th style="${_BD_TH_STYLE}">Days</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td style="${_BD_TD_LABEL}">${monthLabel(r.ym)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.avg)}</td>
        <td style="${_BD_TD_STYLE};color:#ED6965">${_bdFmt(r.absMin)}</td>
        <td style="${_BD_TD_STYLE};color:#FBBF24">${_bdFmt(r.absMax)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.peak)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.off)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.spread)}</td>
        <td style="${_BD_TD_STYLE};color:#FBBF24">${r.negH ? fmtNeg(r.negH) : '–'}</td>
        <td style="${_BD_TD_STYLE}">${r.days}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ── _bdDaily: per-day breakdown (alternative to monthly) ───────────────────
// Used by the FS toggle Monthly ⇄ Daily on the lines tab.
function _bdDaily(zone, series) {
  if (!series || !series.length) return null;
  // Apply current window filter so the table matches the chart
  const windowed = (typeof filterByWindow === 'function')
    ? filterByWindow(series, HIST.windows['ho'] || '3M')
    : series;
  // Newest first
  const rows = [...windowed].sort((a, b) => (b.d > a.d ? 1 : -1));

  const fmtDay = iso => {
    try {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(y, m-1, d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
    } catch (_) { return iso; }
  };
  const fmtNegH = h => {
    if (!h) return '–';
    if (h >= 1) return `${Math.round(h)}h`;
    return `${Math.round(h * 60)}min`;
  };

  return `<table style="${_BD_TABLE_STYLE}">
    <thead><tr>
      <th style="${_BD_TH_STYLE};text-align:left">Date</th>
      <th style="${_BD_TH_STYLE}">Avg €/MWh</th>
      <th style="${_BD_TH_STYLE}">Min</th>
      <th style="${_BD_TH_STYLE}">Max</th>
      <th style="${_BD_TH_STYLE}">Peak</th>
      <th style="${_BD_TH_STYLE}">Off-pk</th>
      <th style="${_BD_TH_STYLE}">Neg h</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td style="${_BD_TD_LABEL}">${fmtDay(r.d)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.avg)}</td>
        <td style="${_BD_TD_STYLE};color:#ED6965">${_bdFmt(r.min)}</td>
        <td style="${_BD_TD_STYLE};color:#FBBF24">${_bdFmt(r.max)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.peakAvg)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.offAvg)}</td>
        <td style="${_BD_TD_STYLE};color:#FBBF24">${fmtNegH(r.negHours)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ── Toggle Monthly ⇄ Daily breakdown in the FS side pane (Lines tab only).
// Persists the choice in window._HO_BREAKDOWN_MODE.
window._HO_BREAKDOWN_MODE = window._HO_BREAKDOWN_MODE || 'monthly';
window._hoSetBreakdown = function(mode) {
  if (mode !== 'monthly' && mode !== 'daily') return;
  window._HO_BREAKDOWN_MODE = mode;

  // Update toggle button styles
  document.querySelectorAll('#ho-fs-breakdown-toggle [data-ho-breakdown]').forEach(btn => {
    const isActive = btn.dataset.hoBreakdown === mode;
    btn.style.background = isActive ? 'rgba(20,211,169,0.15)' : 'transparent';
    btn.style.color = isActive ? '#14D3A9' : 'var(--tx3)';
  });

  // Re-render side pane content with the chosen mode
  const series = window._HO_LAST_SERIES;
  const zone = window._HO_LAST_ZONE || (series && series[0] && series[0].zone);
  if (!series || !zone) return;

  // Only the lines tab supports the toggle; other tabs always use their default breakdown
  const tab = HSZ.tab;
  if (tab === 'lines' && mode === 'daily') {
    const html = _bdDaily(zone, series) || '<div style="color:var(--tx3);font-size:11px;padding:8px">No data</div>';
    const fsEl = document.getElementById('ho-fs-monthly');
    if (fsEl) fsEl.innerHTML = html;
    const fsLabel = document.getElementById('ho-fs-breakdown-label');
    if (fsLabel) fsLabel.textContent = 'Daily breakdown';
  } else {
    // Fall back to the tab's default renderer
    _renderHoBreakdown(zone, series, window._HO_LAST_SUMMARY);
  }
};

// ── _bdYoYWeekly: Weekly comparison with Y-1 and Y-2 ───────────────────────
function _bdYoYWeekly(zone, series, summary) {
  if (!summary || !summary.zones || !summary.zones[zone]) return null;
  const allEntries = summary.zones[zone];
  // Group by year + ISO week
  const byYearWeek = {};
  allEntries.forEach(e => {
    if (e.avg == null) return;
    const dt = new Date(e.d);
    const { year, week } = _isoYearWeek(dt);
    const k = `${year}-W${String(week).padStart(2,'0')}`;
    if (!byYearWeek[k]) byYearWeek[k] = [];
    byYearWeek[k].push(e.avg);
  });
  const meanByKey = {};
  Object.keys(byYearWeek).forEach(k => {
    const arr = byYearWeek[k];
    meanByKey[k] = arr.reduce((a,b)=>a+b,0) / arr.length;
  });

  // Current year = max year present
  const years = [...new Set(allEntries.map(e => new Date(e.d).getFullYear()))].sort();
  const cy = years[years.length - 1];
  const y1 = years.length >= 2 ? years[years.length - 2] : null;
  const y2 = years.length >= 3 ? years[years.length - 3] : null;

  // Iterate over current year's weeks (only those with data)
  const cyWeeks = Object.keys(byYearWeek)
    .filter(k => k.startsWith(cy + '-W'))
    .sort()
    .reverse();
  if (!cyWeeks.length) return null;

  const rows = cyWeeks.map(k => {
    const w = k.split('-W')[1];
    const curAvg = meanByKey[k];
    const y1Key = y1 ? `${y1}-W${w}` : null;
    const y2Key = y2 ? `${y2}-W${w}` : null;
    const y1Avg = y1Key ? meanByKey[y1Key] : null;
    const y2Avg = y2Key ? meanByKey[y2Key] : null;
    const vsy1 = (y1Avg != null) ? (curAvg - y1Avg) : null;
    const vsy1Pct = (y1Avg != null && y1Avg !== 0) ? ((curAvg - y1Avg) / Math.abs(y1Avg) * 100) : null;
    return { week: 'W' + w, curAvg, y1Avg, y2Avg, vsy1, vsy1Pct };
  });

  return `<table style="${_BD_TABLE_STYLE}">
    <thead><tr>
      <th style="${_BD_TH_STYLE};text-align:left">Week</th>
      <th style="${_BD_TH_STYLE}">${cy} avg</th>
      <th style="${_BD_TH_STYLE}">${y1 || 'Y-1'} avg</th>
      <th style="${_BD_TH_STYLE}">${y2 || 'Y-2'} avg</th>
      <th style="${_BD_TH_STYLE}">vs Y-1 €</th>
      <th style="${_BD_TH_STYLE}">vs Y-1 %</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td style="${_BD_TD_LABEL}">${r.week}</td>
        <td style="${_BD_TD_STYLE};color:var(--tx)">${_bdFmt(r.curAvg)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.y1Avg)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.y2Avg)}</td>
        <td style="${_BD_TD_STYLE}">${_bdDelta(r.vsy1)}</td>
        <td style="${_BD_TD_STYLE}">${_bdDelta(r.vsy1Pct)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// Helper: ISO year + week
function _isoYearWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - target) / (7 * 24 * 60 * 60 * 1000));
  return { year: date.getUTCFullYear(), week };
}

// ── _bdYoYMonthly: Monthly comparison with Y-1 and Y-2 ─────────────────────
function _bdYoYMonthly(zone, series, summary) {
  if (!summary || !summary.zones || !summary.zones[zone]) return null;
  const allEntries = summary.zones[zone];
  const byYearMonth = {};
  allEntries.forEach(e => {
    if (e.avg == null) return;
    const y = e.d.slice(0,4), m = e.d.slice(5,7);
    const k = `${y}-${m}`;
    if (!byYearMonth[k]) byYearMonth[k] = [];
    byYearMonth[k].push(e.avg);
  });
  const meanByKey = {};
  Object.keys(byYearMonth).forEach(k => {
    const arr = byYearMonth[k];
    meanByKey[k] = arr.reduce((a,b)=>a+b,0) / arr.length;
  });

  const years = [...new Set(allEntries.map(e => e.d.slice(0,4)))].sort();
  const cy = years[years.length - 1];
  const y1 = years.length >= 2 ? years[years.length - 2] : null;
  const y2 = years.length >= 3 ? years[years.length - 3] : null;

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const rows = [];
  for (let mi = 11; mi >= 0; mi--) {
    const mm = String(mi + 1).padStart(2, '0');
    const cyAvg = meanByKey[`${cy}-${mm}`];
    if (cyAvg == null) continue;  // skip future months without data
    const y1Avg = y1 ? meanByKey[`${y1}-${mm}`] : null;
    const y2Avg = y2 ? meanByKey[`${y2}-${mm}`] : null;
    const vsy1 = (y1Avg != null) ? (cyAvg - y1Avg) : null;
    const vsy1Pct = (y1Avg != null && y1Avg !== 0) ? ((cyAvg - y1Avg) / Math.abs(y1Avg) * 100) : null;
    const vsy2 = (y2Avg != null) ? (cyAvg - y2Avg) : null;
    rows.push({ month: monthNames[mi] + ' ' + cy, cyAvg, y1Avg, y2Avg, vsy1, vsy1Pct, vsy2 });
  }
  if (!rows.length) return null;

  return `<table style="${_BD_TABLE_STYLE}">
    <thead><tr>
      <th style="${_BD_TH_STYLE};text-align:left">Month</th>
      <th style="${_BD_TH_STYLE}">${cy}</th>
      <th style="${_BD_TH_STYLE}">${y1 || 'Y-1'}</th>
      <th style="${_BD_TH_STYLE}">${y2 || 'Y-2'}</th>
      <th style="${_BD_TH_STYLE}">vs Y-1 €</th>
      <th style="${_BD_TH_STYLE}">vs Y-1 %</th>
      <th style="${_BD_TH_STYLE}">vs Y-2 €</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td style="${_BD_TD_LABEL}">${r.month}</td>
        <td style="${_BD_TD_STYLE};color:var(--tx)">${_bdFmt(r.cyAvg)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.y1Avg)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.y2Avg)}</td>
        <td style="${_BD_TD_STYLE}">${_bdDelta(r.vsy1)}</td>
        <td style="${_BD_TD_STYLE}">${_bdDelta(r.vsy1Pct)}</td>
        <td style="${_BD_TD_STYLE}">${_bdDelta(r.vsy2)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ── _bdHourlyAnnual: 24h breakdown with Y-1/Y-2 + Hist median ─────────────
function _bdHourlyAnnual(zone, summary) {
  if (!summary || !summary.intraday || !summary.intraday[zone]) return null;
  const intra = summary.intraday[zone];
  const years = Object.keys(intra).sort();
  if (!years.length) return null;
  const cy = years[years.length - 1];
  const y1 = years.length >= 2 ? years[years.length - 2] : null;
  const y2 = years.length >= 3 ? years[years.length - 3] : null;
  const curP = intra[cy]?.all;
  const n1P = y1 ? intra[y1]?.all : null;
  const n2P = y2 ? intra[y2]?.all : null;
  if (!curP) return null;
  const dist = summary.intradayDist?.[zone];
  const medLine = dist?.p50;

  const rows = [];
  for (let h = 0; h < 24; h++) {
    const cur = curP[h];
    const y1v = n1P ? n1P[h] : null;
    const y2v = n2P ? n2P[h] : null;
    const med = medLine ? medLine[h] : null;
    const vsy1 = (cur != null && y1v != null) ? (cur - y1v) : null;
    rows.push({ hour: `${String(h).padStart(2,'0')}h`, cur, y1v, y2v, med, vsy1 });
  }

  return `<table style="${_BD_TABLE_STYLE}">
    <thead><tr>
      <th style="${_BD_TH_STYLE};text-align:left">Hour</th>
      <th style="${_BD_TH_STYLE}">${cy} avg</th>
      <th style="${_BD_TH_STYLE}">${y1 || 'Y-1'} avg</th>
      <th style="${_BD_TH_STYLE}">${y2 || 'Y-2'} avg</th>
      <th style="${_BD_TH_STYLE}">Hist median</th>
      <th style="${_BD_TH_STYLE}">vs Y-1</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td style="${_BD_TD_LABEL}">${r.hour}</td>
        <td style="${_BD_TD_STYLE};color:var(--tx)">${_bdFmt(r.cur)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.y1v)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.y2v)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.med)}</td>
        <td style="${_BD_TD_STYLE}">${_bdDelta(r.vsy1)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ── _bdHourlyQuarter: 24h × 4 quarters matrix ─────────────────────────────
function _bdHourlyQuarter(zone, summary) {
  if (!summary || !summary.intraday || !summary.intraday[zone]) return null;
  const intra = summary.intraday[zone];
  const years = Object.keys(intra).sort();
  if (!years.length) return null;
  const cy = years[years.length - 1];
  const qs = ['Q1','Q2','Q3','Q4'];
  const profilesByQ = qs.map(q => intra[cy]?.[q]);
  // If a quarter has no data, mark its column as null
  const rows = [];
  for (let h = 0; h < 24; h++) {
    const vals = profilesByQ.map(p => (p && p[h] != null) ? p[h] : null);
    rows.push({ hour: `${String(h).padStart(2,'0')}h`, vals });
  }

  return `<table style="${_BD_TABLE_STYLE}">
    <thead><tr>
      <th style="${_BD_TH_STYLE};text-align:left">Hour ${cy}</th>
      <th style="${_BD_TH_STYLE};color:#A87DC4">Q1 Winter</th>
      <th style="${_BD_TH_STYLE};color:#14D3A9">Q2 Spring</th>
      <th style="${_BD_TH_STYLE};color:#FBBF24">Q3 Summer</th>
      <th style="${_BD_TH_STYLE};color:#ED6965">Q4 Autumn</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td style="${_BD_TD_LABEL}">${r.hour}</td>
        ${r.vals.map(v => `<td style="${_BD_TD_STYLE}">${_bdFmt(v)}</td>`).join('')}
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ── _bdWeekday: 7-row day of week distribution table ──────────────────────
function _bdWeekday(zone, series) {
  if (!series.length) return null;
  const byDow = Array.from({length: 7}, () => []);
  series.forEach(e => {
    if (e.avg == null) return;
    const dt = new Date(e.d);
    let dow = dt.getUTCDay();
    dow = (dow + 6) % 7;
    byDow[dow].push(e.avg);
  });
  const stats = byDow.map(arr => _boxStats(arr));
  if (stats.every(s => s == null)) return null;
  const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const periodValues = series.map(e => e.avg).filter(v => v != null);
  const periodMedian = periodValues.length ? _percentile([...periodValues].sort((a,b)=>a-b), 0.5) : null;

  const sigma = (arr) => {
    if (arr.length < 2) return null;
    const m = arr.reduce((a,b)=>a+b,0) / arr.length;
    const v = arr.reduce((s,x) => s + (x-m)*(x-m), 0) / (arr.length - 1);
    return Math.sqrt(v);
  };
  const rows = stats.map((s, i) => {
    if (!s) return null;
    return {
      day: labels[i],
      isWeekend: i >= 5,
      n: s.n,
      med: s.p50,
      p25: s.p25,
      p75: s.p75,
      p10: s.p10,
      p90: s.p90,
      min: s.min,
      max: s.max,
      vsPeriod: (periodMedian != null) ? (s.p50 - periodMedian) : null,
      sd: sigma(byDow[i]),
    };
  }).filter(r => r);

  return `<table style="${_BD_TABLE_STYLE}">
    <thead><tr>
      <th style="${_BD_TH_STYLE};text-align:left">Day</th>
      <th style="${_BD_TH_STYLE}">Median</th>
      <th style="${_BD_TH_STYLE}">P25</th>
      <th style="${_BD_TH_STYLE}">P75</th>
      <th style="${_BD_TH_STYLE}">P10</th>
      <th style="${_BD_TH_STYLE}">P90</th>
      <th style="${_BD_TH_STYLE}">Min</th>
      <th style="${_BD_TH_STYLE}">Max</th>
      <th style="${_BD_TH_STYLE}">σ</th>
      <th style="${_BD_TH_STYLE}">vs period med</th>
      <th style="${_BD_TH_STYLE}">n</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr style="${r.isWeekend ? 'background:rgba(168,125,196,0.06)' : ''}">
        <td style="${_BD_TD_LABEL}">${r.day}</td>
        <td style="${_BD_TD_STYLE};color:var(--tx)">${_bdFmt(r.med)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.p25)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.p75)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.p10)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.p90)}</td>
        <td style="${_BD_TD_STYLE};color:#ED6965">${_bdFmt(r.min)}</td>
        <td style="${_BD_TD_STYLE};color:#FBBF24">${_bdFmt(r.max)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.sd)}</td>
        <td style="${_BD_TD_STYLE}">${_bdDelta(r.vsPeriod)}</td>
        <td style="${_BD_TD_STYLE};${r.n < 5 ? 'color:#FBBF24' : ''}">${r.n}${r.n < 5 ? ' ⚠' : ''}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ── _bdVolatility: rolling σ table with weekly/monthly toggle ─────────────
window._bdVolatilityGran = 'month';  // 'week' | 'month'
function _bdSetVolGran(g) {
  window._bdVolatilityGran = g;
  // Trigger rerender of breakdown only
  const zone = window._HO_OPEN_ZONE;
  if (zone && _HO_LAST_SERIES && _HO_LAST_SERIES[zone] && _HO_LAST_SUMMARY) {
    _renderHoBreakdown(zone, _HO_LAST_SERIES[zone], _HO_LAST_SUMMARY);
  }
}
window._bdSetVolGran = _bdSetVolGran;

function _bdVolatility(zone, series) {
  if (!series.length) return null;
  const gran = window._bdVolatilityGran || 'month';
  // Bucket by week (YYYY-W##) or month (YYYY-MM)
  const buckets = {};
  series.forEach(d => {
    if (d.avg == null) return;
    const dt = new Date(d.d);
    let key;
    if (gran === 'week') {
      const { year, week } = _isoYearWeek(dt);
      key = `${year}-W${String(week).padStart(2,'0')}`;
    } else {
      key = d.d.slice(0, 7);
    }
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push({ d: d.d, avg: d.avg, max: d.max, min: d.min });
  });
  const keys = Object.keys(buckets).sort().reverse();
  if (!keys.length) return null;
  const sigma = (arr) => {
    if (arr.length < 2) return null;
    const m = arr.reduce((a,b)=>a+b,0) / arr.length;
    const v = arr.reduce((s,x) => s + (x-m)*(x-m), 0) / (arr.length - 1);
    return Math.sqrt(v);
  };
  const rows = keys.map(k => {
    const arr = buckets[k];
    const vals = arr.map(r => r.avg);
    const sd = sigma(vals);
    // Day-on-day Δ avg
    let dodSum = 0, dodN = 0;
    for (let i = 1; i < arr.length; i++) {
      dodSum += Math.abs(arr[i].avg - arr[i-1].avg);
      dodN++;
    }
    const dodAvg = dodN ? dodSum / dodN : null;
    // Intra-day range avg
    const ranges = arr.filter(r => r.max != null && r.min != null).map(r => r.max - r.min);
    const rangeAvg = ranges.length ? ranges.reduce((a,b)=>a+b,0) / ranges.length : null;
    // Largest spike (day-on-day jump)
    let maxSpike = null, maxSpikeDate = null;
    for (let i = 1; i < arr.length; i++) {
      const delta = Math.abs(arr[i].avg - arr[i-1].avg);
      if (maxSpike == null || delta > maxSpike) { maxSpike = delta; maxSpikeDate = arr[i].d; }
    }
    return { period: k, sd, dodAvg, rangeAvg, maxSpike, maxSpikeDate, n: arr.length };
  });

  const toggle = `<div style="display:flex;gap:4px;margin-bottom:8px;font-family:'JetBrains Mono',monospace">
    <button onclick="_bdSetVolGran('week')" style="background:${gran==='week'?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${gran==='week'?'rgba(20,211,169,0.4)':'var(--bd)'};color:${gran==='week'?'#14D3A9':'var(--tx3)'};padding:3px 8px;font-size:9px;border-radius:3px;cursor:pointer;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Week</button>
    <button onclick="_bdSetVolGran('month')" style="background:${gran==='month'?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${gran==='month'?'rgba(20,211,169,0.4)':'var(--bd)'};color:${gran==='month'?'#14D3A9':'var(--tx3)'};padding:3px 8px;font-size:9px;border-radius:3px;cursor:pointer;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Month</button>
  </div>`;

  return toggle + `<table style="${_BD_TABLE_STYLE}">
    <thead><tr>
      <th style="${_BD_TH_STYLE};text-align:left">${gran === 'week' ? 'Week' : 'Month'}</th>
      <th style="${_BD_TH_STYLE}">σ €/MWh</th>
      <th style="${_BD_TH_STYLE}">Δ DoD avg</th>
      <th style="${_BD_TH_STYLE}">Range avg</th>
      <th style="${_BD_TH_STYLE}">Max Δ DoD</th>
      <th style="${_BD_TH_STYLE}">Spike date</th>
      <th style="${_BD_TH_STYLE}">n days</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td style="${_BD_TD_LABEL}">${r.period}</td>
        <td style="${_BD_TD_STYLE};color:var(--tx)">${_bdFmt(r.sd)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.dodAvg)}</td>
        <td style="${_BD_TD_STYLE}">${_bdFmt(r.rangeAvg)}</td>
        <td style="${_BD_TD_STYLE};color:#FBBF24">${_bdFmt(r.maxSpike)}</td>
        <td style="${_BD_TD_STYLE};color:var(--tx3);font-size:10px">${r.maxSpikeDate || '–'}</td>
        <td style="${_BD_TD_STYLE}">${r.n}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ── _bdDistribution: price bucket distribution (negatives, then ranges) ───
function _bdDistribution(zone, series) {
  if (!series.length) return null;
  const vals = series.map(d => d.avg).filter(v => v != null);
  if (!vals.length) return null;
  // Pre-defined price buckets (in €/MWh)
  const buckets = [
    { lo: -Infinity, hi: 0,    label: '< 0' },
    { lo: 0,         hi: 20,   label: '0 — 20' },
    { lo: 20,        hi: 40,   label: '20 — 40' },
    { lo: 40,        hi: 60,   label: '40 — 60' },
    { lo: 60,        hi: 80,   label: '60 — 80' },
    { lo: 80,        hi: 100,  label: '80 — 100' },
    { lo: 100,       hi: 150,  label: '100 — 150' },
    { lo: 150,       hi: 200,  label: '150 — 200' },
    { lo: 200,       hi: Infinity, label: '≥ 200' },
  ];
  const counts = buckets.map(() => 0);
  vals.forEach(v => {
    for (let i = 0; i < buckets.length; i++) {
      if (v >= buckets[i].lo && v < buckets[i].hi) { counts[i]++; break; }
    }
  });
  const total = vals.length;
  let cum = 0;
  const rows = buckets.map((b, i) => {
    cum += counts[i];
    return {
      label: b.label,
      count: counts[i],
      pct: (counts[i] / total) * 100,
      cumPct: (cum / total) * 100,
      isNeg: b.hi <= 0,
      isHigh: b.lo >= 100,
    };
  });

  return `<table style="${_BD_TABLE_STYLE}">
    <thead><tr>
      <th style="${_BD_TH_STYLE};text-align:left">Bucket €/MWh</th>
      <th style="${_BD_TH_STYLE}">Days</th>
      <th style="${_BD_TH_STYLE}">% of period</th>
      <th style="${_BD_TH_STYLE}">% cumulated</th>
      <th style="${_BD_TH_STYLE};text-align:left">Visual</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td style="${_BD_TD_LABEL};${r.isNeg ? 'color:#ED6965' : (r.isHigh ? 'color:#FBBF24' : '')}">${r.label}</td>
        <td style="${_BD_TD_STYLE}">${r.count}</td>
        <td style="${_BD_TD_STYLE};color:var(--tx)">${r.pct.toFixed(1)}%</td>
        <td style="${_BD_TD_STYLE};color:var(--tx3)">${r.cumPct.toFixed(1)}%</td>
        <td style="text-align:left;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.04)"><span style="display:inline-block;width:${Math.max(2, r.pct * 1.5)}px;height:8px;background:${r.isNeg ? '#ED6965' : (r.isHigh ? '#FBBF24' : 'var(--zone-fr,#14D3A9)')};border-radius:1px;vertical-align:middle"></span></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ── Helper: persist last series + summary for breakdown rerenders (toggle in Volatility) ──
window._HO_LAST_SERIES = window._HO_LAST_SERIES || {};
window._HO_LAST_SUMMARY = null;

// ── Helper: render the monthly breakdown inside the row detail ──
// Replaces the standalone Block 4 table — filtered on the zone + period currently open
async function _renderHoDetailMonthly(zone, series) {
  const container = document.getElementById('ho-detail-monthly');
  if (!container || !series || !series.length) return;

  // Group by YYYY-MM
  const monthly = {};
  series.forEach(d => {
    const ym = d.d.slice(0, 7);
    if (!monthly[ym]) monthly[ym] = { rows: [] };
    monthly[ym].rows.push(d);
  });

  const months = Object.keys(monthly).sort();
  if (!months.length) {
    container.innerHTML = '<div style="color:var(--tx3);font-size:11px;padding:8px">No data in this period</div>';
    return;
  }

  // Aggregate per month using _statsForZone (consistent with the rest of the module)
  const aggregated = months.map(ym => {
    const rows = monthly[ym].rows;
    const mst = _statsForZone(rows);
    const spread = (mst?.peakAvg != null && mst?.offAvg != null) ? (mst.peakAvg - mst.offAvg) : null;
    // Absolute intra-day min/max across all days of the month (uses d.max / d.min if present)
    const allMaxes = rows.map(r => r.max).filter(v => v != null);
    const allMins  = rows.map(r => r.min).filter(v => v != null);
    const absMax = allMaxes.length ? Math.max(...allMaxes) : null;
    const absMin = allMins.length  ? Math.min(...allMins)  : null;
    return { ym, ...mst, spread, absMax, absMin };
  });

  // vs LY (same month previous year)
  aggregated.forEach(row => {
    const [y, m] = row.ym.split('-');
    const prevYm = (parseInt(y)-1) + '-' + m;
    const prev = aggregated.find(r => r.ym === prevYm);
    row.vsLY = (prev && prev.avg != null && row.avg != null) ? (row.avg - prev.avg) : null;
  });

  const fmt = v => v == null ? '--' : v.toFixed(2);
  const upColor = '#14D3A9', dnColor = '#ED6965', warnColor = '#FBBF24';

  // Render rows (most recent first)
  const rowsHtml = aggregated.slice().reverse().map(r => {
    const vsLY = r.vsLY == null ? '--' : (r.vsLY >= 0 ? '+' : '') + r.vsLY.toFixed(2);
    const vsLYColor = r.vsLY == null ? 'var(--tx3)' : (r.vsLY > 0 ? dnColor : (r.vsLY < 0 ? upColor : 'var(--tx2)'));
    // Format month: Jan 2026
    const [y, m] = r.ym.split('-');
    const dt = new Date(parseInt(y), parseInt(m)-1, 1);
    const monthLabel = dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    return `<tr>
      <td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;font-weight:600">${monthLabel}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace">${fmt(r.avg)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:${dnColor}">${fmt(r.absMin)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:${warnColor}">${fmt(r.absMax)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace">${fmt(r.peakAvg)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace">${fmt(r.offAvg)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace">${fmt(r.spread)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10px;color:${r.negH > 0 ? warnColor : 'var(--tx3)'}">${_fmtNegH(r.negH || 0)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${r.days}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:${vsLYColor}">${vsLY}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead>
        <tr style="border-bottom:1px solid var(--bd)">
          <th style="padding:6px 8px;text-align:left;color:var(--tx3);font-weight:600">Month</th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">Avg <span style="font-weight:400;font-size:9px">€/MWh</span></th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">Min <span style="font-weight:400;font-size:9px">intra-day</span></th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">Max <span style="font-weight:400;font-size:9px">intra-day</span></th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">Peak avg <span style="font-weight:400;font-size:9px">08:00-20:00</span></th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">Off-peak <span style="font-weight:400;font-size:9px">€/MWh</span></th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">Spread <span style="font-weight:400;font-size:9px">P-OP</span></th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">Neg hours</th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">Days</th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">vs LY <span style="font-weight:400;font-size:9px">€/MWh</span></th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function _openHoRow(zone, series, st) {
  if (!st || !series || !series.length) return;
  const tbody = document.getElementById('ho-table-tbody');
  const row = tbody.querySelector(`tr.ho-row[data-zone="${zone}"]`);
  if (!row) return;
  row.classList.add('is-open');
  window._HO_OPEN_ZONE = zone;

  const country = _HO_NAMES[zone] || zone;
  const flag    = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[zone]) || '';
  const color   = zoneColor(zone);
  // 2 decimals partout
  const fmt     = v => (v == null || isNaN(v)) ? '--' : v.toFixed(2);
  const ratio   = (st.peakAvg != null && st.offAvg != null && st.offAvg !== 0)
    ? (st.peakAvg / st.offAvg) : null;
  const ratioStr = ratio == null ? '--' : ratio.toFixed(2) + 'x';
  // %REN + fuel meta cohérents avec Daily
  let renHtml = '<span style="color:var(--tx3)">--</span>';
  if (st.renPctAvg != null) {
    const rp = Math.round(st.renPctAvg);
    const c = rp >= 60 ? '#14D3A9' : rp >= 40 ? '#FBBF24' : '#ED6965';
    renHtml = `<span style="color:${c};font-weight:600">${rp}%</span>`;
  }
  const fm = st.domFuel ? _HO_FUEL_META[st.domFuel] : null;
  const fuelLabel = fm ? `${fm.emoji} ${fm.label}` : '--';
  const fuelColor = fm ? fm.color : 'var(--tx3)';
  const periodTxt = (HIST.customRange && HIST.customRange.from)
    ? `${HIST.customRange.from} → ${HIST.customRange.to}`
    : periodLabel(series);

  // Cache for later (fullscreen + dynamic KPI strip refresh)
  window._HO_LAST_SERIES = series;
  window._HO_LAST_ZONE = zone;
  window._HO_LAST_STATS = st;

  const detail = document.createElement('tr');
  detail.id = 'ho-detail-row';
  // Outer wrap: same style as Daily (no extra inner background)
  detail.innerHTML = `
    <td colspan="12" style="padding:0;background:#141a22;border-left:3px solid var(--acc);border-bottom:2px solid var(--bd2)">
      <div id="ho-detail-inner" style="padding:14px 16px">

        <!-- ═══ Drill row header · uses pk-section-* classes ═══ -->
        <div class="pk-section-header">
          <div class="pk-section-header-text">
            <div class="pk-eyebrow">
              Historical <span class="pk-sep">·</span> ${flag} ${zone} <span class="pk-sep">·</span> Single-zone detail
            </div>
            <div class="pk-section-title">${country}</div>
            <div class="pk-section-subtitle">${periodTxt} · ENTSO-E</div>
          </div>
          <div class="pk-section-header-actions">
            <button class="pk-btn-primary" onclick="event.stopPropagation();_openHoFullscreen('${zone}')" title="Open in fullscreen">⛶ Fullscreen</button>
            <button class="pk-btn-ghost" onclick="event.stopPropagation();_closeHoRow()" title="Close detail">✕ Close</button>
          </div>
        </div>

        <!-- KPI strip · 6 cards aligned with Daily drill -->
        <div id="ho-detail-kpi-strip" class="kpi-strip" style="grid-template-columns:repeat(6,1fr);margin-bottom:14px">
          <!-- filled by _renderHoDetailKpis -->
        </div>

        <!-- Verdict bandeau ("Cheap & stable period · σ X · X% renewable · X neg days") -->
        <div id="ho-detail-verdict" style="font-size:11px;color:var(--tx2);margin-bottom:14px;font-family:'Inter',sans-serif">
          ${_buildHoVerdict(st)}
        </div>

        <!-- ═══ Filters bar · tabs + actions ═══ -->
        <div class="pk-filters-bar">
          <!-- Tabs bar: Lines / YoY / Weekday / Volatility / Distribution -->
          <div id="ho-detail-tabs-bar" style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:6px;padding:3px;flex-wrap:wrap;align-self:flex-start;width:max-content;max-width:100%"></div>

          <!-- Generic per-tab submenu slot (YoY pills, Volatility metrics, Distribution modes, etc.) -->
          <div id="ho-detail-tab-submenu" style="display:none;gap:6px;align-items:center;flex-wrap:wrap;padding-left:4px"></div>

          <div class="pk-filters-bar-spacer"></div>

          <!-- Y-presets + Reset + PNG -->
          <!-- Tab-specific toggle slot (legacy, kept hidden) -->
          <div id="ho-detail-toggle-slot" style="display:none;gap:3px;border-right:1px solid rgba(255,255,255,0.25);padding-right:10px;margin-right:6px"></div>
          <div id="ho-detail-ypresets-wrap" style="display:flex;gap:3px;border-right:1px solid var(--bd);padding-right:6px;margin-right:2px">
            <button data-ho-preset="focus" onclick="event.stopPropagation();_hoSetYPreset('focus')" title="Tight Y axis around rolling trend (Daily avg stays visible)"
              style="background:${(window._HO_YPRESET==='focus')?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${(window._HO_YPRESET==='focus')?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${(window._HO_YPRESET==='focus')?'#14D3A9':'var(--tx3)'};padding:3px 8px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Focus</button>
            <button data-ho-preset="standard" onclick="event.stopPropagation();_hoSetYPreset('standard')" title="Default Y axis (balanced)"
              style="background:${(window._HO_YPRESET==='standard'||!window._HO_YPRESET)?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${(window._HO_YPRESET==='standard'||!window._HO_YPRESET)?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${(window._HO_YPRESET==='standard'||!window._HO_YPRESET)?'#14D3A9':'var(--tx3)'};padding:3px 8px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Standard</button>
            <button data-ho-preset="all" onclick="event.stopPropagation();_hoSetYPreset('all')" title="Full Y range — shows all outliers"
              style="background:${(window._HO_YPRESET==='all')?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${(window._HO_YPRESET==='all')?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${(window._HO_YPRESET==='all')?'#14D3A9':'var(--tx3)'};padding:3px 8px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">All</button>
          </div>
          <button class="pk-btn-ghost" id="ho-detail-reset-btn" onclick="event.stopPropagation();window._hoResetZoom()" title="Reset zoom and Y range to standard">↺ Reset</button>
          <button class="pk-btn-primary" onclick="event.stopPropagation();_downloadHoChart('${zone}')" title="Download chart as PNG">📸 PNG</button>
        </div>

        <!-- Tab-specific chart title block (eyebrow + title + subtitle).
             Differs from the header above: this one changes with the active tab
             (Lines vs YoY vs Volatility etc.), while the header above is static. -->
        <div id="ho-detail-title-block" style="margin-top:14px;margin-bottom:8px">
          <div id="ho-detail-eyebrow" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:#14D3A9;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px"></div>
          <div id="ho-detail-title" style="font-family:'Inter',sans-serif;font-size:15px;font-weight:600;color:var(--text);letter-spacing:-.005em;line-height:1.25"></div>
          <div id="ho-detail-subtitle" style="font-family:'Inter',sans-serif;font-size:11px;color:var(--tx2);margin-top:3px;line-height:1.4"></div>
        </div>

        <!-- Chart container — no background, matches Daily style -->
        <div style="position:relative;height:340px;margin-bottom:4px">
          <canvas id="ho-detail-chart" style="width:100%;height:340px"></canvas>
        </div>

        <!-- Analyst banner anchor · unified with Daily drill (fixed div, JS fills innerHTML) -->
        <div id="ho-detail-analyst-banner"></div>

        <!-- Monthly breakdown collapsible (replaces standalone Block 4) -->
        <details id="ho-detail-breakdown-details" style="margin-top:12px" open>
          <summary style="font-size:11px;font-weight:600;color:var(--tx2);cursor:pointer;letter-spacing:.05em;text-transform:uppercase;user-select:none;padding:6px 0">
            <span id="ho-detail-breakdown-label">Monthly breakdown</span>
          </summary>
          <div id="ho-detail-monthly" style="margin-top:8px;overflow-x:auto"></div>
        </details>
      </div>
    </td>`;
  row.after(detail);

  // Render the KPI strip with dynamic border-left colors (vs Y-1)
  _renderHoDetailKpis(zone, series, st);

  // Initialise the tab state for this zone:
  // The last tab the user picked on ANY zone is used (cross-zone persistence).
  // This way, switching countries keeps the same view (Lines → Lines, YoY → YoY, etc.)
  // Fallback: any zone-specific value, then 'lines'.
  if (!window._HO_TABS) window._HO_TABS = {};
  const wantedTab = window._HO_TAB_LAST || window._HO_TABS[zone] || 'lines';
  window._HO_TABS[zone] = wantedTab;
  // Sync HSZ state so submenu and dispatcher see the right tab/zone
  HSZ.tab = wantedTab;
  HSZ.zone = zone;

  // Build the tabs bar + chart
  _hoRenderTabsBar(zone, series);
  _hoApplyTabVisibility(window._HO_TABS[zone]);
  if (typeof _hszRenderYoYSubmenu === 'function') _hszRenderYoYSubmenu();
  _buildHoTabChart(zone, series, window._HO_TABS[zone], false);

  // Register the rerender callback so that shared controls
  // (Y presets, hourly mode toggle) can refresh the active chart.
  _setHszRerender(() => {
    const z = window._HO_OPEN_ZONE;
    const s2 = window._HO_LAST_SERIES;
    if (!z || !s2) return;
    _buildHoTabChart(z, s2, (window._HO_TABS && window._HO_TABS[z]) || 'lines', false);
  });

  // Render the breakdown inside the <details> (lazy: only when expanded).
  // Routed through the contextual breakdown dispatcher so it picks the right
  // table depending on the active tab.
  const detailsEl = detail.querySelector('details');
  if (detailsEl) {
    detailsEl.addEventListener('toggle', () => {
      if (detailsEl.open) _renderHoBreakdown(zone, series, window._HO_LAST_SUMMARY);
    }, { once: false });
  }
}
window._closeHoRow = _closeHoRow;
window._toggleHoRow = _toggleHoRow;

// ── Render the 7 KPI cards in the detail row with dynamic border-left colors ──
// Each card uses the standard .kpi-card class + .kpi-up / .kpi-down / .kpi-flat
// for the left accent bar, based on YoY comparison.
async function _renderHoDetailKpis(zone, series, st) {
  const container = document.getElementById('ho-detail-kpi-strip');
  if (!container) return;

  // 2 decimals
  const fmt = v => (v == null || isNaN(v)) ? '--' : v.toFixed(2);

  // %REN + fuel meta
  let renHtml = '<span style="color:var(--tx3)">--</span>';
  if (st.renPctAvg != null) {
    const rp = Math.round(st.renPctAvg);
    const c = rp >= 60 ? '#14D3A9' : rp >= 40 ? '#FBBF24' : '#ED6965';
    renHtml = `<span style="color:${c};font-weight:600">${rp}%</span>`;
  }
  const fm = st.domFuel ? _HO_FUEL_META[st.domFuel] : null;
  const fuelLabel = fm ? `${fm.emoji} ${fm.label}` : '--';
  const fuelColor = fm ? fm.color : 'var(--tx3)';

  // Format date for Extremes card (short: "15 Feb 2026")
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d} ${months[m-1]} ${y}`;
  };

  // YoY for this zone — drives the color of the border-left
  const useCustom = !!(HIST.customRange && HIST.customRange.from && HIST.customRange.to);
  const yoy = await _computeYoYStats(zone, series, useCustom);
  const ref = yoy.ref;
  const ystat = yoy.status;

  // Decide kpi-up / kpi-down / kpi-flat based on YoY delta for each metric
  // Convention: monter = rouge (stress marché), baisser = vert. ±1% = flat.
  const cls = (cur, prev, status) => {
    if (status === 'no-ref' || prev == null || cur == null) return 'kpi-flat';
    if (status === 'partial') return 'kpi-flat';
    if (Math.abs(cur - prev) < 0.01 * Math.max(1, Math.abs(prev))) return 'kpi-flat';
    return cur > prev ? 'kpi-down' : 'kpi-up';
  };

  // For spread: higher is "good" for BESS arbitrage → inverse colour convention
  const clsSpread = (cur, prev, status) => {
    if (status === 'no-ref' || prev == null || cur == null) return 'kpi-flat';
    if (status === 'partial') return 'kpi-flat';
    if (Math.abs(cur - prev) < 0.01 * Math.max(1, Math.abs(prev))) return 'kpi-flat';
    return cur > prev ? 'kpi-up' : 'kpi-down';  // up spread = good (green)
  };

  // Mini delta line under value (concise, with arrow)
  const meta = (cur, prev, status, inversed) => {
    if (status === 'no-ref' || prev == null || cur == null || prev === 0) {
      return '<span style="color:var(--tx3)">— no Y-1 ref</span>';
    }
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    const arrow = pct >= 0 ? '▲' : '▼';
    const sign  = pct >= 0 ? '+' : '';
    // Colour convention: rouge si plus haut (mauvais), vert si plus bas (bon).
    // inversed=true → inverse (used for spread, where higher = better for BESS)
    let colr;
    if (status === 'partial') colr = '#FBBF24';
    else if (inversed) colr = pct >= 0 ? '#14D3A9' : '#ED6965';
    else colr = pct >= 0 ? '#ED6965' : '#14D3A9';
    const badge = status === 'partial' ? ' <span style="color:var(--tx3);font-size:9px">(~partial)</span>' : '';
    return `<span style="color:${colr}">${arrow} ${sign}${pct.toFixed(1)}% vs Y-1${badge}</span>`;
  };

  // ─── 6 cards aligned with Daily drill ─────────────────────────────────
  // 1. Avg  ·  2. Peak/Off-peak (merged)  ·  3. Extremes (+neg meta)
  // 4. Volatility σ  ·  5. Spread intraday  ·  6. Mix
  // Always exactly 6 cards (Mix shows "--" if data unavailable, for symmetry).
  const cards = [
    // 1. Avg
    {
      key: 'avg',
      cls: cls(st.avg, ref?.avg, ystat),
      label: 'Avg',
      value: `${fmt(st.avg)}<span class="kpi-unit">€/MWh</span>`,
      metaHtml: meta(st.avg, ref?.avg, ystat),
    },
    // 2. Peak / Off-peak (merged 2-line card)
    {
      key: 'peakoff',
      cls: 'kpi-flat',
      label: 'Peak / Off-peak',
      customHtml: `
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;line-height:1.15">
          ▲ ${fmt(st.peakAvg)}<span style="font-size:9px;color:var(--tx3);margin-left:3px;font-weight:400">€/MWh</span>
        </div>
        <div style="font-size:9px;color:var(--tx3);margin-bottom:4px">peak avg</div>
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;line-height:1.15">
          ▼ ${fmt(st.offAvg)}<span style="font-size:9px;color:var(--tx3);margin-left:3px;font-weight:400">€/MWh</span>
        </div>
        <div style="font-size:9px;color:var(--tx3)">off-peak avg</div>
      `,
    },
    // 3. Extremes (max ▲ + min ▼ + neg days/hours in meta)
    {
      key: 'extremes',
      cls: 'kpi-flat',
      label: 'Extremes',
      customHtml: `
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;color:#14D3A9;line-height:1.15">▲ ${fmt(st.max)}<span style="font-size:9px;color:var(--tx3);margin-left:3px">€/MWh</span></div>
        <div style="font-size:9px;color:var(--tx3);margin-bottom:4px">${fmtDate(st.maxDate)}</div>
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;color:#ED6965;line-height:1.15">▼ ${fmt(st.min)}<span style="font-size:9px;color:var(--tx3);margin-left:3px">€/MWh</span></div>
        <div style="font-size:9px;color:var(--tx3)">${fmtDate(st.minDate)}${st.negH != null ? ' · ' + _fmtNegH(st.negH) + ' neg' : ''}</div>
      `,
    },
    // 4. Volatility σ
    {
      key: 'sigma',
      cls: cls(st.sigma, ref?.sigma, ystat),
      label: 'Volatility σ',
      value: `${fmt(st.sigma)}<span class="kpi-unit">€/MWh</span>`,
      metaHtml: meta(st.sigma, ref?.sigma, ystat),
      title: 'Volatility = standard deviation of daily average prices over the selected period. Higher σ means prices swing more day-to-day. Rule of thumb: <15 stable · 15-30 moderate · >30 volatile.',
    },
    // 5. Spread intraday
    {
      key: 'spread',
      cls: clsSpread(st.intradaySpread, ref?.intradaySpread, ystat),
      label: 'Spread',
      value: `${fmt(st.intradaySpread)}<span class="kpi-unit">€/MWh</span>`,
      metaHtml: meta(st.intradaySpread, ref?.intradaySpread, ystat, true),
      title: 'Average intraday spread (max - min per day) — proxy for BESS arbitrage potential',
    },
    // 6. Mix (renewable + dominant fuel) — always shown (shows "--" if data missing)
    {
      key: 'mix',
      cls: 'kpi-flat',
      label: 'Mix',
      customHtml: `
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;line-height:1.15">${renHtml}<span style="font-size:9px;color:var(--tx3);margin-left:5px;font-weight:400">renewable</span></div>
        <div style="font-size:9px;color:var(--tx3);margin-bottom:4px">(W + S + H + B)</div>
        <div style="font-size:13px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${fuelColor};line-height:1.15">${fuelLabel}</div>
        <div style="font-size:9px;color:var(--tx3)">dominant fuel</div>
      `,
    },
  ];

  container.innerHTML = cards.map(c => {
    // Extremes card has 2-line layout, no kpi-value / kpi-meta wrapper
    if (c.customHtml) {
      return `
        <div class="kpi-card ${c.cls}"${c.title ? ` title="${c.title}"` : ''}>
          <div class="kpi-label">${c.label}</div>
          ${c.customHtml}
        </div>`;
    }
    return `
      <div class="kpi-card ${c.cls}"${c.title ? ` title="${c.title}"` : ''}>
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value">${c.value}</div>
        <div class="kpi-meta">${c.metaHtml}</div>
      </div>`;
  }).join('');
}

// ── Fullscreen for Historical chart (aligned with Daily openRowFullscreen) ──
function _openHoFullscreen(zone) {
  const series = window._HO_LAST_SERIES;
  const st     = window._HO_LAST_STATS;
  if (!series || !series.length || !zone) return;

  if (typeof window.pkOpenOrUpdate !== 'function' && typeof window.pkOpenFullscreen !== 'function') {
    console.error('[_openHoFullscreen] pkOpenFullscreen is not loaded');
    return;
  }

  window._HO_LAST_ZONE = zone;
  if (!window._HO_TABS) window._HO_TABS = {};
  const tab = window._HO_TAB_LAST || window._HO_TABS[zone] || 'lines';
  window._HO_TABS[zone] = tab;
  HSZ.tab  = tab;
  HSZ.zone = zone;

  const country = _HO_NAMES[zone] || zone;
  // (FLAG_MAP[zone] no longer used in the title per the no-emoji design)
  const periodTxt = (HIST.customRange && HIST.customRange.from)
    ? `${HIST.customRange.from} → ${HIST.customRange.to}`
    : periodLabel(series);

  // ─── Title / subtitle ──────────────────────────────────────────────────
  // Title is dynamic with the View (sub-tab) name. No emoji per design.
  const subTabLabel = { lines:'Lines', yoy:'YoY', weekday:'Weekday', volatility:'Volatility', distribution:'Distribution' }[tab] || 'Lines';
  const title    = `${zone} — ${country} · ${subTabLabel}`;
  const subtitle = `${periodTxt} · ${series.length} daily slots · ENTSO-E`;

  // ─── KPIs · 8-card strip ──────────────────────────────────────────────
  // We clone the inline strip (it gets re-rendered async by _renderHoDetailKpis,
  // so we re-clone after that finishes via the wire callback below).
  const inlineKpis = document.getElementById('ho-detail-kpi-strip');
  const kpisHtml = inlineKpis
    ? `<div class="kpi-strip" style="grid-template-columns:repeat(6,1fr);width:100%;height:100%">${inlineKpis.innerHTML}</div>`
    : '<div style="color:var(--tx3);font-size:11px;padding:10px">Loading KPIs…</div>';

  // ─── Sub-tabs (Lines / YoY / Weekday / Volatility / Distribution) ─────
  const subTabs = ['lines','yoy','weekday','volatility','distribution'];
  const subTabLabels = { lines:'Lines', yoy:'YoY', weekday:'Weekday', volatility:'Volatility', distribution:'Distribution' };
  const subTabsHtml = subTabs.map(t => `
    <button data-ho-subtab="${t}" style="
      padding:3px 9px;font-size:10px;cursor:pointer;border-radius:3px;
      color:${t === tab ? '#14D3A9' : 'var(--tx3)'};
      background:${t === tab ? 'rgba(20,211,169,0.18)' : 'transparent'};
      border:none;font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em">${subTabLabels[t]}</button>`).join('');

  // ─── Window pills (7D / 1M / 3M / 6M / YTD / 1Y / 2Y / 5Y / All) ───────
  const winKey = HIST.windows['ho'] || '3M';
  const winPillsHtml = ['7D','1M','3M','6M','YTD','1Y','2Y','5Y','All'].map(w => {
    const active = winKey === w;
    return `<button data-ho-win="${w}" style="
      padding:3px 9px;font-size:10px;cursor:pointer;border-radius:3px;
      background:${active ? 'rgba(20,211,169,0.18)' : 'transparent'};
      color:${active ? '#14D3A9' : 'var(--tx3)'};
      border:none;
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;text-transform:uppercase">${w}</button>`;
  }).join('');

  // ─── Y-presets (Focus / Standard / All) + Reset zoom ──────────────────
  const yPreset = window._HO_YPRESET || 'standard';
  const yPresetsHtml = ['focus','standard','all'].map(p => {
    const active = yPreset === p;
    return `<button data-ho-ypreset="${p}" style="
      padding:3px 9px;font-size:10px;cursor:pointer;border-radius:3px;
      background:${active ? 'rgba(20,211,169,0.18)' : 'transparent'};
      color:${active ? '#14D3A9' : 'var(--tx3)'};
      border:none;
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;text-transform:capitalize">${p}</button>`;
  }).join('');

  // ─── Zone selector (dropdown) ──────────────────────────────────────────
  // Limit to zones the user has selected on the page (matches the chart).
  // Falls back to the full catalogue if the selection is empty (defensive,
  // should never happen on a freshly loaded page).
  const userSelected = (typeof getUserZones === 'function') ? getUserZones() : [];
  const availableZones = userSelected.length
    ? userSelected.filter(z => _HO_NAMES[z])
    : Object.keys(_HO_NAMES);
  // Ensure the currently-open zone is in the list (might have been added
  // before the user pruned the selection on the page).
  const zonesList = availableZones.includes(zone)
    ? availableZones.slice().sort()
    : [zone, ...availableZones].slice().sort();
  const zoneOptions = zonesList.map(z => {
    const f = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
    const n = _HO_NAMES[z] || z;
    return `<option value="${z}" ${z === zone ? 'selected' : ''}>${f} ${z} — ${n}</option>`;
  }).join('');

  // ─── Filters HTML (right of the chart, identical placement to Daily) ──
  const filtersHtml = `
    <div style="display:flex;align-items:center;gap:5px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Zone</span>
      <select id="fs-ho-zone-select" style="background:var(--bg);border:1px solid var(--bd);color:var(--tx);font-size:11px;padding:3px 8px;border-radius:4px;font-family:inherit;cursor:pointer;color-scheme:dark">
        ${zoneOptions}
      </select>
    </div>
    <div style="display:flex;align-items:center;gap:5px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">View</span>
      <div id="fs-ho-subtabs" style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">${subTabsHtml}</div>
    </div>
    <div style="display:flex;align-items:center;gap:5px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Period</span>
      <div id="fs-ho-windows" style="display:inline-flex;gap:3px;flex-wrap:wrap">${winPillsHtml}</div>
    </div>
    <div style="display:flex;align-items:center;gap:5px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Y-axis</span>
      <div id="fs-ho-ypresets" style="display:inline-flex;gap:3px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">${yPresetsHtml}</div>
    </div>
    <div id="fs-ho-tab-submenu" style="display:none;align-items:center;gap:6px;flex-wrap:wrap"></div>`;

  // ─── Table · breakdown with Monthly/Daily toggle (Lines tab only) ─────
  const breakdownMode = window._HO_BREAKDOWN_MODE || 'monthly';
  let breakdownHtml = '';
  try {
    if (tab === 'lines' && breakdownMode === 'daily' && typeof _bdDaily === 'function') {
      breakdownHtml = _bdDaily(zone, series) || '';
    } else {
      // Use the tab's default renderer via _renderHoBreakdown indirection.
      // We can't call _renderHoBreakdown here (it writes to the live DOM that
      // doesn't exist yet); instead call _bdLines for the default Monthly view.
      if (typeof _bdLines === 'function') breakdownHtml = _bdLines(zone, series) || '';
    }
  } catch (e) { console.warn('FS breakdown render failed:', e); }

  const breakdownToggleHtml = `
    <div id="fs-ho-breakdown-toggle" style="display:${tab === 'lines' ? 'inline-flex' : 'none'};gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:4px;padding:2px">
      <button data-ho-breakdown="monthly" style="padding:3px 9px;font-size:9px;cursor:pointer;border-radius:3px;background:${breakdownMode === 'monthly' ? 'rgba(20,211,169,0.15)' : 'transparent'};color:${breakdownMode === 'monthly' ? '#14D3A9' : 'var(--tx3)'};border:none;font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em">Monthly</button>
      <button data-ho-breakdown="daily" style="padding:3px 9px;font-size:9px;cursor:pointer;border-radius:3px;background:${breakdownMode === 'daily' ? 'rgba(20,211,169,0.15)' : 'transparent'};color:${breakdownMode === 'daily' ? '#14D3A9' : 'var(--tx3)'};border:none;font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em">Daily</button>
    </div>`;

  const tableHtml = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span id="fs-ho-breakdown-label" style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--tx2);text-transform:uppercase">${tab === 'lines' ? 'Monthly breakdown' : 'Breakdown'}</span>
      ${breakdownToggleHtml}
    </div>
    <div id="fs-ho-breakdown-body">${breakdownHtml || '<div style="color:var(--tx3);font-size:11px;padding:8px">No data</div>'}</div>`;

  // ─── Analysis · verdict banner ────────────────────────────────────────
  const analysisHtml = _buildHoVerdict(st);

  // ─── CSV export ────────────────────────────────────────────────────────
  const onCSV = () => {
    if (typeof _exportHoChartCsv === 'function') {
      _exportHoChartCsv(zone, true);
      return null; // _exportHoChartCsv already triggers the download itself
    }
    return null;
  };

  // ─── chartSource: rebuild the chart into the fullscreen canvas ─────────
  const chartSource = {
    rebuildInto: (canvas) => {
      // _buildHoTabChart looks up the canvas by id 'ho-fs-chart' (legacy),
      // so we tag the host canvas with that id before delegating.
      if (canvas && canvas.id !== 'ho-fs-chart') canvas.id = 'ho-fs-chart';
      try {
        _buildHoTabChart(zone, series, HSZ.tab || 'lines', true);
      } catch (e) { console.warn('[ho-fs] _buildHoTabChart failed', e); }
      // The chart instance is stored in window._HO_FS_CHART by _buildHoTabChart.
      return window._HO_FS_CHART || null;
    }
  };

  // ─── Open / hot-swap the overlay ───────────────────────────────────────
  (window.pkOpenOrUpdate || window.pkOpenFullscreen)({
    title,
    subtitle,
    filenameStem: `powerklock_historical_drill_${zone}_${(HIST.windows['ho']||'3M').toUpperCase()}`,
    storageKey: 'historical-drill',
    kpis: { html: kpisHtml },
    table: { html: tableHtml },
    analysis: { html: analysisHtml },
    onCSV,
    chartSource,
    filters: {
      html: filtersHtml,
      wire: (hostEl) => _hoWireFsFilters(hostEl, zone, series)
    }
  });

  // Tag the overlay so legacy checks (#ho-fs-overlay) can still detect
  // "fullscreen Historical is open" via [data-fs-context="historical"].
  const overlayEl = document.getElementById('pk-fs-overlay');
  if (overlayEl) overlayEl.setAttribute('data-fs-context', 'historical');

  // Re-render KPIs into the new overlay once they finish loading inline.
  // _renderHoDetailKpis writes to #ho-detail-kpi-strip in the inline DOM.
  // After it completes, we clone the freshly-rendered HTML into the FS panel.
  if (typeof _renderHoDetailKpis === 'function') {
    setTimeout(() => {
      _renderHoDetailKpis(zone, series, st).then(() => {
        const src = document.getElementById('ho-detail-kpi-strip');
        const dst = document.querySelector('#pk-fs-overlay .pk-fs-kpi .kpi-strip');
        if (src && dst) dst.innerHTML = src.innerHTML;
      }).catch(() => {});
    }, 60);
  }

  // Render the sub-menu (YoY pills etc.) for the current tab, into the FS host.
  setTimeout(() => {
    if (typeof _hszRenderYoYSubmenu === 'function') {
      // _hszRenderYoYSubmenu writes to its own anchor; if it doesn't find one,
      // we host it in fs-ho-tab-submenu by aliasing the id.
      _hszRenderYoYSubmenu();
    }
  }, 80);
}

// ─── Wire up all filters / controls in the FS host element ────────────────
// hostEl is the .pk-fs-filters div inside the overlay (provided by fullscreen.js).
function _hoWireFsFilters(hostEl, zone, series) {
  if (!hostEl) return;

  // Zone switch: simulate a click on the new zone's row in the Historical
  // overview table. That row's onclick handler will load the series, set
  // _HO_LAST_SERIES / _HO_LAST_STATS, then we re-open the FS with the new zone.
  const sel = hostEl.querySelector('#fs-ho-zone-select');
  if (sel) {
    sel.addEventListener('change', (e) => {
      const newZone = e.target.value;
      if (!newZone || newZone === zone) return;
      // Find the row in the inline table — clicking it opens its drill-down
      // and populates _HO_LAST_SERIES/_HO_LAST_STATS for the new zone.
      const targetRow = document.querySelector(`#ho-table-tbody tr.ho-row[data-zone="${newZone}"]`);
      if (targetRow) {
        // If a different zone is currently open inline, close it first via the
        // row's own toggle logic — easier: just click the new row, _toggleHoRow
        // will close the previously open zone for us.
        targetRow.click();
        // Wait for the inline render to complete, then re-open the FS.
        setTimeout(() => _openHoFullscreen(newZone), 60);
      } else {
        console.warn('[ho-fs] zone row not found for', newZone);
      }
    });
  }

  // Sub-tab switch (Lines / YoY / Weekday / Volatility / Distribution)
  hostEl.querySelectorAll('[data-ho-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newTab = btn.dataset.hoSubtab;
      if (!newTab) return;
      window._HO_TABS = window._HO_TABS || {};
      window._HO_TABS[zone] = newTab;
      window._HO_TAB_LAST = newTab;
      HSZ.tab = newTab;
      // Re-open to refresh everything (filters, table, chart)
      _openHoFullscreen(zone);
    });
  });

  // Window pills (7D / 1M / 3M / ...)
  hostEl.querySelectorAll('[data-ho-win]').forEach(btn => {
    btn.addEventListener('click', () => {
      const w = btn.dataset.hoWin;
      if (!w) return;
      HIST.windows['ho'] = w;
      if (typeof pkUpdateHistPeriodLabels === 'function') pkUpdateHistPeriodLabels(w);
      _openHoFullscreen(zone);
    });
  });

  // Y-presets (Focus / Standard / All)
  hostEl.querySelectorAll('[data-ho-ypreset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.hoYpreset;
      if (!p) return;
      window._HO_YPRESET = p;
      // Re-render chart without reopening the whole FS
      if (typeof _buildHoTabChart === 'function') {
        _buildHoTabChart(zone, series, HSZ.tab || 'lines', true);
      }
      // Update pill styles
      hostEl.querySelectorAll('[data-ho-ypreset]').forEach(b => {
        const a = b.dataset.hoYpreset === p;
        b.style.background = a ? 'rgba(20,211,169,0.18)' : 'transparent';
        b.style.color = a ? '#14D3A9' : 'var(--tx3)';
      });
    });
  });

  // Breakdown toggle (Monthly / Daily) — lives in the right pane, not in hostEl.
  // Wire via document.querySelectorAll since the pane is a sibling section.
  document.querySelectorAll('#fs-ho-breakdown-toggle [data-ho-breakdown]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.hoBreakdown;
      if (mode !== 'monthly' && mode !== 'daily') return;
      window._HO_BREAKDOWN_MODE = mode;
      const body = document.getElementById('fs-ho-breakdown-body');
      const label = document.getElementById('fs-ho-breakdown-label');
      if (body) {
        const html = (mode === 'daily' && typeof _bdDaily === 'function')
          ? _bdDaily(zone, series)
          : (typeof _bdLines === 'function' ? _bdLines(zone, series) : '');
        body.innerHTML = html || '<div style="color:var(--tx3);font-size:11px;padding:8px">No data</div>';
      }
      if (label) label.textContent = mode === 'daily' ? 'Daily breakdown' : 'Monthly breakdown';
      document.querySelectorAll('#fs-ho-breakdown-toggle [data-ho-breakdown]').forEach(b => {
        const a = b.dataset.hoBreakdown === mode;
        b.style.background = a ? 'rgba(20,211,169,0.15)' : 'transparent';
        b.style.color = a ? '#14D3A9' : 'var(--tx3)';
      });
    });
  });
}

window._openHoFullscreen = _openHoFullscreen;

function _hoFsEscHandler(e) {
  if (e.key === 'Escape') _closeHoFullscreen();
}

function _closeHoFullscreen() {
  const overlay = document.getElementById('ho-fs-overlay');
  if (overlay) overlay.remove();
  document.body.style.overflow = '';
  if (window._HO_FS_CHART) {
    try { window._HO_FS_CHART.destroy(); } catch(_) {}
    window._HO_FS_CHART = null;
  }
  document.removeEventListener('keydown', _hoFsEscHandler);
}
window._closeHoFullscreen = _closeHoFullscreen;

// ── Build the daily / 7D / 30D rolling chart for the open zone ──
// fullscreen=true → renders to ho-fs-chart canvas with larger fonts and drag-zoom
function _buildHoChart(zone, series, fullscreen) {
  const canvasId = fullscreen ? 'ho-fs-chart' : 'ho-detail-chart';
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = series.map(d => d.d);
  const daily  = series.map(d => d.avg);
  const maxes  = series.map(d => d.max);
  const mins   = series.map(d => d.min);
  const r7     = rolling(daily, 7);
  const r30    = rolling(daily, 30);
  const color  = zoneColor(zone);

  // Ribbon colors (max-min envelope) — now ultra-discreet
  let ribbonFill = 'rgba(20,211,169,0.05)';
  let maxBorder  = 'rgba(251,191,36,0.30)';
  let minBorder  = 'rgba(237,105,101,0.28)';
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    ribbonFill = `rgba(${r},${g},${b},0.05)`;
  }

  // Find min/max for annotations
  let minIdx = 0, maxIdx = 0;
  for (let i = 1; i < daily.length; i++) {
    if (daily[i] != null && (daily[minIdx] == null || daily[i] < daily[minIdx])) minIdx = i;
    if (daily[i] != null && (daily[maxIdx] == null || daily[i] > daily[maxIdx])) maxIdx = i;
  }

  // ── Y range capping based on preset (focus uses rolling lines range) ──
  const validMaxes = maxes.filter(v => v != null && !isNaN(v));
  const validMins  = mins.filter(v => v != null && !isNaN(v));
  const validDaily = daily.filter(v => v != null);
  const preset = window._HO_YPRESET || 'standard';
  const { yMin: yMinCap, yMax: yMaxCap } = _computeYRange(validDaily, validMaxes, validMins, preset, r7, r30);

  // In Focus mode, hide the ribbon entirely (pure trend view)
  const showRibbon = preset !== 'focus';

  const targetVar = fullscreen ? '_HO_FS_CHART' : '_HO_CHART';
  if (window[targetVar]) {
    try { window[targetVar].destroy(); } catch (_) {}
    window[targetVar] = null;
  }

  const fontSize = fullscreen ? 13 : 10;

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        // ── Ribbon: max-min daily envelope (ultra-discreet, hidden in Focus) ──
        {
          label: 'Daily max',
          data: maxes,
          borderColor: maxBorder,
          backgroundColor: ribbonFill,
          borderWidth: 0.7,
          pointRadius: 0,
          tension: 0,
          spanGaps: true,
          fill: '+1',        // fill DOWN to the next dataset (Daily min)
          order: 5,          // render below the main lines
          hidden: !showRibbon,
        },
        {
          label: 'Daily min',
          data: mins,
          borderColor: minBorder,
          backgroundColor: 'transparent',
          borderWidth: 0.7,
          pointRadius: 0,
          tension: 0,
          spanGaps: true,
          fill: false,
          order: 5,
          hidden: !showRibbon,
        },
        // ── Main 3 lines on top ──
        {
          label: 'Daily avg',
          data: daily,
          borderColor: color,
          backgroundColor: color + '20',
          borderWidth: fullscreen ? 1.5 : 1,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0,
          fill: false,
          order: 3,
        },
        {
          label: '7D rolling',
          data: r7,
          borderColor: '#94a3b8',
          backgroundColor: 'transparent',
          borderWidth: fullscreen ? 2 : 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          tension: 0.2,
          fill: false,
          order: 2,
        },
        {
          label: '30D rolling',
          data: r30,
          borderColor: '#14D3A9',
          backgroundColor: 'transparent',
          borderWidth: fullscreen ? 2.5 : 2,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f1419',
          borderColor: 'rgba(255,255,255,.08)',
          borderWidth: 1,
          padding: fullscreen ? 14 : 10,
          titleFont: { size: fontSize, family: "'JetBrains Mono', monospace" },
          bodyFont:  { size: fontSize, family: "'JetBrains Mono', monospace" },
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? '--' : ctx.parsed.y.toFixed(2)} €/MWh`,
          },
        },
        annotation: {
          annotations: {
            zero: {
              type: 'line', yMin: 0, yMax: 0,
              borderColor: 'rgba(237,105,101,.35)', borderWidth: 1, borderDash: [4,3],
            },
            minPt: {
              type: 'point', xValue: labels[minIdx], yValue: daily[minIdx],
              backgroundColor: '#ED6965', radius: fullscreen ? 6 : 4, borderColor: '#fff', borderWidth: 1,
            },
            maxPt: {
              type: 'point', xValue: labels[maxIdx], yValue: daily[maxIdx],
              backgroundColor: '#14D3A9', radius: fullscreen ? 6 : 4, borderColor: '#fff', borderWidth: 1,
            },
          },
        },
        // Click-and-drag rectangle zoom (both modes).
        // No wheel zoom (too intrusive). Reset via double-click or button.
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20, 211, 169, 0.15)',
              borderColor: 'rgba(20, 211, 169, 0.6)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        // Double-click resets the zoom
        if (evt && evt.native && evt.native.detail === 2) {
          window._hoResetZoom();
        }
      },
      layout: { padding: { top: 16, bottom: 8 } },
      scales: {
        x: {
          type: 'category',
          ticks: {
            color: 'rgba(184,201,217,.5)',
            font: { size: fontSize, family: "'JetBrains Mono', monospace" },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: fullscreen ? 14 : 10,
          },
          grid: { color: 'rgba(255,255,255,.03)' },
        },
        y: {
          grace: '10%',
          min: yMinCap, max: yMaxCap,
          ticks: {
            color: 'rgba(184,201,217,.5)',
            font: { size: fontSize, family: "'JetBrains Mono', monospace" },
            callback: v => v.toFixed(0),
          },
          grid: { color: 'rgba(255,255,255,.04)' },
          title: {
            display: true, text: '€/MWh',
            color: 'rgba(184,201,217,.4)',
            font: { size: fontSize, family: "'JetBrains Mono', monospace" },
          },
        },
      },
    },
  };

  window[targetVar] = new Chart(canvas, cfg);

  // Add double-click to reset zoom in fullscreen
  if (fullscreen) {
    canvas.addEventListener('dblclick', () => {
      if (window._HO_FS_CHART && typeof window._HO_FS_CHART.resetZoom === 'function') {
        window._HO_FS_CHART.resetZoom();
      }
    });
  }
}


// ════════════════════════════════════════════
// BLOCK 2 · SINGLE ZONE SECTION (insta tabs)
// Tabs: Lines · YoY · Seasonal · Hourly · Weekly · Volatility
// ════════════════════════════════════════════

// Per-tab submenu rendering: pills for the active tab go in the same slot in both
// drill-down and FS, with consistent YoY-style design (rounded 14px pills).
// Handles: YoY (sub-modes + hourly mode), Volatility (3 metrics), Distribution (2 modes).
function _hszRenderYoYSubmenu() {
  const tab = HSZ.tab;
  const mode = HSZ.yoyMode;
  const hourlyMode = HSZ.hourlyMode;

  // Shared pill style helpers — aligned with other FS pills (3px radius, no border)
  const pill = (handler, id, label, active) => `
    <button onclick="event.stopPropagation();${handler}('${id}')"
      style="padding:3px 9px;font-size:10px;border:none;cursor:pointer;border-radius:3px;color:${active?'#14D3A9':'var(--tx3)'};background:${active?'rgba(20,211,169,0.18)':'transparent'};font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em">${label}</button>`;
  const sep = `<span style="width:1px;height:14px;background:rgba(255,255,255,0.18);margin:0 4px"></span>`;
  const modePill = (handler, id, label, active) => `
    <button onclick="event.stopPropagation();${handler}('${id}')"
      style="padding:3px 9px;font-size:10px;border:none;cursor:pointer;border-radius:3px;color:${active?'#14D3A9':'var(--tx3)'};background:${active?'rgba(20,211,169,0.18)':'transparent'};font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;text-transform:uppercase">${label}</button>`;

  let html = '';
  let showSubmenu = false;

  if (tab === 'yoy') {
    showSubmenu = true;
    HSZ.yoyModes.forEach(m => { html += pill('setHistYoyMode', m.id, m.label, mode === m.id); });
    if (mode === 'hourly') {
      html += sep
           + modePill('setHistHourlyMode', 'yoy',     'Annual average', hourlyMode === 'yoy')
           + modePill('setHistHourlyMode', 'quarter', 'By quarter',     hourlyMode === 'quarter');
    }
  } else if (tab === 'vol' || tab === 'volatility') {
    showSubmenu = true;
    const cur = window._volMetric || 'sigma';
    html += pill('_setVolMetric', 'sigma', 'σ rolling',       cur === 'sigma');
    html += pill('_setVolMetric', 'dod',   'Day-on-day Δ',    cur === 'dod');
    html += pill('_setVolMetric', 'range', 'Intra-day range', cur === 'range');
  } else if (tab === 'dist' || tab === 'distribution') {
    showSubmenu = true;
    const cur = window._distMode || 'cumulative';
    html += pill('_setDistMode', 'cumulative', 'Cumulative',       cur === 'cumulative');
    html += pill('_setDistMode', 'histo',      'Histogram + KDE',  cur === 'histo');
  }

  ['ho-detail-tab-submenu', 'fs-ho-tab-submenu'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (showSubmenu) {
      el.style.display = 'flex';
      el.innerHTML = html;
    } else {
      el.style.display = 'none';
      el.innerHTML = '';
    }
  });
}

// Global setter — switches YoY sub-mode and re-renders
window.setHistYoyMode = function(mode) {
  if (!HSZ.yoyModes.find(m => m.id === mode)) return;
  HSZ.yoyMode = mode;
  HSZ.tab = 'yoy';  // defensive: pills only visible on yoy anyway
  _hszRenderYoYSubmenu();
  // Re-render via the registered callback (handles inline + fullscreen)
  if (typeof _hszRerender === 'function') _hszRerender();
};

const HSZ = {
  zone: 'FR',
  tab: 'lines',
  // YoY sub-mode: 'hourly' | 'daily' | 'weekly' | 'monthly'
  yoyMode: 'daily',
  // Hourly internal mode (only used when yoyMode === 'hourly')
  hourlyMode: 'quarter',  // 'quarter' | 'yoy'
  tabs: [
    { id: 'lines',   label: 'Lines' },
    { id: 'yoy',     label: 'YoY' },
    { id: 'weekday', label: 'Weekday' },
    { id: 'vol',     label: 'Volatility' },
    { id: 'dist',    label: 'Distribution' },
  ],
  // YoY sub-modes (rendered as pills below the tab when YoY is active)
  yoyModes: [
    { id: 'hourly',  label: 'Hourly' },
    { id: 'daily',   label: 'Daily' },
    { id: 'weekly',  label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
  ],
};

// _HSZ_TARGET: indirection layer used by _hszRender* so the renderers can
// write to the drill-down canvas inside an opened ho-table row (or the
// fullscreen canvas). The legacy hsz-canvas block has been removed; this
// target is mutated by _buildHoTabChart before rendering, then restored.
// Keys:
//   canvasId      → which canvas to draw on
//   tabsId        → unused (legacy); kept for future
//   togglePrefix  → prefix for hourly-toggle/quarter-grid ids (must be unique
//                   per concurrent rendering host to avoid DOM collisions)
//   getWindow()   → returns the active window key (e.g. '3M', '1Y')
//   getHourlyMode() → 'quarter' | 'yoy'
//   getZone()     → active zone code
//   getTab()      → active tab id
//   getYPreset()  → active Y range preset ('focus'|'standard'|'all')
const _HSZ_TARGET = {
  canvasId: null,
  tabsId: null,
  togglePrefix: 'ho-detail',
  getWindow: () => HIST.windows['ho'] || '3M',
  getHourlyMode: () => HSZ.hourlyMode,
  getYoyMode: () => HSZ.yoyMode,
  getZone: () => HSZ.zone,
  getTab:  () => HSZ.tab,
  getYPreset: () => _hszYPreset,
  // Unfiltered zone series — used by rolling-window computations so that the
  // last N days of context are not lost when the user shrinks the window.
  // Populated by _hszRenderTab from the summary it receives.
  getFullSeries: () => null,
};
function _hszCtx() { return _HSZ_TARGET; }

// State callback: the drill-down row registers a "rerender" function so that
// shared controls (Y presets, hourly mode toggle) can refresh the active chart
// without knowing which row owns it.
let _HSZ_RERENDER = null;
function _setHszRerender(fn) { _HSZ_RERENDER = fn; }
function _hszRerender() { if (typeof _HSZ_RERENDER === 'function') _HSZ_RERENDER(); }

function setHistHourlyMode(mode) {
  HSZ.hourlyMode = mode;
  if (typeof _hszRenderYoYSubmenu === 'function') _hszRenderYoYSubmenu();
  _hszRerender();
}
window.setHistHourlyMode = setHistHourlyMode;

// _hszRenderTab: shared dispatcher used by the drill-down row.
// `filtered` = filtered series, `zone` = zone code, `tab` = active tab id,
// `summary` = the fetchSummary() result (needed by YoY / Seasonal renderers).
// The renderers read `_hszCtx()` for canvas/window/etc., so make sure the
// caller has set _HSZ_TARGET appropriately before invoking.
// ─────────────────────────────────────────────────────────────
// Title helper · sets the HTML title block above the chart canvas.
// Hybrid style: small green uppercase "eyebrow" + sans-serif title + muted subtitle.
// Chart.js native title/subtitle are NOT used anywhere on Historical drill-down
// charts — we rely on this HTML block instead (multi-style typography).
// ─────────────────────────────────────────────────────────────
// Helper: format a title with an optional discrete description after a pipe ("Title | description")
// The description appears in a smaller, grey weight to keep the main title prominent.
function _titleWithDescription(title, description) {
  if (!description) return title;
  return `${title} <span style="color:var(--tx3);font-weight:400;font-size:0.78em;margin-left:6px">| ${description}</span>`;
}

// ─────────────────────────────────────────────────────────────
// Analyst banner — amber warning-style bar under each chart
// Contains: line 1 (numbers + factual finding) + market read (verdict)
// Pure market analyst tone: describe what the data says about the market.
// No PPA / BESS / contracting language.
// ─────────────────────────────────────────────────────────────
function _buildAnalystBanner(mode, p) {
  const W = (txt) => `<b style="color:#fff;font-weight:700">${txt}</b>`;     // white bold = key number
  const A = (txt) => `<b style="font-weight:700">${txt}</b>`;                 // amber bold = secondary / extreme
  const ICON = `<span style="font-size:13px;margin-right:6px;vertical-align:-1px">◈</span>`;
  const VR_OPEN = `<span style="display:block;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(251,191,36,0.22);font-style:italic;color:rgba(255,255,255,0.82)">Market read : `;
  const VR_CLOSE = `</span>`;

  // Helper: format date as "DD MMM" from YYYY-MM-DD
  const fmtD = (d) => {
    if (!d) return '--';
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  let line1 = '', verdict = '';

  if (mode === 'lines') {
    const { avg, sigma, min, max, minDate, maxDate } = p;
    const sigmaRegime = sigma < 15 ? 'low' : sigma < 30 ? 'normal' : 'high';
    const levelTier = avg < 40 ? 'bearish baseline' : avg < 70 ? 'neutral baseline' : 'bullish baseline';
    line1 = `Period averaged ${W(avg.toFixed(2) + ' €/MWh')} with ${W(sigmaRegime + ' volatility')} (σ ${W(sigma.toFixed(2))}). Prices spanned ${A(min.toFixed(2))} on ${A(fmtD(minDate))} to ${A(max.toFixed(2) + ' €/MWh')} on ${A(fmtD(maxDate))}.`;
    const sigmaWord = sigma < 15 ? 'calm regime' : sigma < 30 ? 'normal regime' : 'stressed regime';
    const desc = (avg < 40 && sigma > 30) ? 'Low absolute level combined with wide swings.'
              : (avg > 70 && sigma > 30) ? 'High level combined with wide swings.'
              : (sigma > 30) ? 'Wide day-to-day swings across the period.'
              : (avg < 40) ? 'Low absolute level, contained dispersion.'
              : (avg > 70) ? 'High level, contained dispersion.'
              : 'Levels and dispersion both close to historical norms.';
    verdict = `${VR_OPEN}<b>${levelTier}, ${sigmaWord}</b>. ${desc}${VR_CLOSE}`;
  }

  else if (mode === 'yoyDaily' || mode === 'yoyWeekly' || mode === 'yoyMonthly') {
    const { curMean, prevMean, delta, period } = p;
    const pct = prevMean ? (delta / Math.abs(prevMean)) * 100 : 0;
    const verb = delta > 0 ? '+' : '';
    const periodLabel = mode === 'yoyDaily' ? 'This year' : mode === 'yoyWeekly' ? 'Weekly average' : 'This month';
    line1 = `${periodLabel} ${W(curMean.toFixed(2) + ' €/MWh')}, ${A(verb + delta.toFixed(2) + ' €/MWh (' + verb + pct.toFixed(1) + '%)')} vs Y-1.`;
    let read;
    if (Math.abs(pct) < 5) {
      read = `<b>Stable year-on-year</b>. Spread within ±5%.`;
    } else if (pct > 15) {
      read = `<b>Sharply higher year-on-year</b>. Gap to Y-1 exceeds 15%.`;
    } else if (pct > 5) {
      read = `<b>Higher year-on-year</b>. Current level sits above Y-1.`;
    } else if (pct < -15) {
      read = `<b>Sharply lower year-on-year</b>. Gap to Y-1 exceeds 15% on the downside.`;
    } else {
      read = `<b>Lower year-on-year</b>. Current level sits below Y-1.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'yoyHourlyAnnual') {
    const { peakHour, peakVal, floorHour, floorVal, prevFloorVal, prevPeakHour } = p;
    line1 = `Peak at ${W(peakHour + 'h (' + peakVal.toFixed(2) + ' €/MWh)')}, floor at ${W(floorHour + 'h (' + floorVal.toFixed(2) + ' €/MWh)')}.`;
    const midday = (floorHour >= 11 && floorHour <= 16);
    const floorDeeper = (prevFloorVal != null && floorVal < prevFloorVal - 5);
    const peakShifted = (prevPeakHour != null && peakHour > prevPeakHour);
    let read;
    if (midday && floorDeeper) {
      read = `<b>Midday floor deepening</b>. Solar surplus widens the gap to last year; peak sits in the evening.`;
    } else if (midday && peakShifted) {
      read = `<b>Peak shifting later</b>. Midday floor steady, evening hours extending into the night.`;
    } else if (midday) {
      read = `<b>Duck-curve profile</b>. Midday floor and evening peak define the day.`;
    } else if (peakHour <= 10) {
      read = `<b>Morning-peak profile</b>. Demand concentrated in the early hours.`;
    } else {
      read = `<b>Evening-peak profile</b>. Demand concentrated late in the day.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'yoyHourlyQuarter') {
    const { strongestQuarterLabel, strongestPeakVal, strongestPeakHour,
            weakestQuarterLabel, weakestFloorVal, weakestFloorHour } = p;
    line1 = `Strongest peak in ${W(strongestQuarterLabel)} at ${W(strongestPeakHour + 'h (' + strongestPeakVal.toFixed(2) + ' €/MWh)')}, weakest floor in ${W(weakestQuarterLabel)} at ${W(weakestFloorHour + 'h (' + weakestFloorVal.toFixed(2) + ' €/MWh)')}.`;
    const seasonalGap = strongestPeakVal - weakestFloorVal;
    let read;
    if (seasonalGap > 100) {
      read = `<b>Highly polarised quarters</b>. Spread between strongest peak and weakest floor exceeds 100 €/MWh.`;
    } else if (seasonalGap > 50) {
      read = `<b>Pronounced quarterly contrast</b>. Quarters show meaningfully different intraday shapes.`;
    } else {
      read = `<b>Balanced quarterly regime</b>. Intraday shape close across quarters.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'weekday') {
    const { mostExpName, mostExpMedian, cheapestName, cheapestMedian } = p;
    const discount = mostExpMedian > 0 ? (1 - cheapestMedian / mostExpMedian) * 100 : 0;
    line1 = `${W(mostExpName)} most expensive (median ${W(mostExpMedian.toFixed(2) + ' €/MWh')}), ${W(cheapestName)} cheapest (median ${W(cheapestMedian.toFixed(2) + ' €/MWh')}). Weekend discount ${W('~' + discount.toFixed(0) + '%')}.`;
    let read;
    if (discount > 30) {
      read = `<b>Wide weekday-weekend gap</b>. Weekend prices sit more than 30% below the most expensive day.`;
    } else if (discount > 15) {
      read = `<b>Moderate weekday-weekend gap</b>. Spread between weekday and weekend is contained.`;
    } else {
      read = `<b>Flat weekly pattern</b>. Weekday and weekend prices move close together.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'volatility') {
    const { metricLabel, periodMean, regime, daysAbove, threshold, peakVal, peakDate, unit } = p;
    line1 = `${metricLabel} averaged ${W(periodMean.toFixed(2) + ' ' + unit + ' (' + regime + ' regime)')}, ${A(daysAbove + ' days')} above ${W(threshold.toFixed(2) + ' ' + unit)}, peak ${A(peakVal != null ? peakVal.toFixed(2) + ' ' + unit : '--')}${peakDate ? ' on ' + A(fmtD(peakDate)) : ''}.`;
    let read;
    if (regime === 'high') {
      read = `<b>Stressed regime</b>. Day-to-day swings sit well above historical norms.`;
    } else if (regime === 'moderate') {
      read = `<b>Normal regime</b>. Dispersion within historical bounds.`;
    } else {
      read = `<b>Calm regime</b>. Day-to-day swings well below historical norms.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'cumulative') {
    const { median, p95, p5 } = p;
    const skew = (p95 - median) > (median - p5);
    line1 = `Half the days under ${W(median.toFixed(2) + ' €/MWh')}, 95% under ${W(p95.toFixed(2) + ' €/MWh')}. Distribution ${W(skew ? 'right-skewed' : 'symmetric')}.`;
    let read;
    if (skew && median < 60) {
      read = `<b>Right-skewed with quiet baseline</b>. Most days sit low; upper tail stretches with occasional spikes.`;
    } else if (skew) {
      read = `<b>Right-skewed distribution</b>. Long tail above the median weights the average.`;
    } else {
      read = `<b>Symmetric distribution</b>. Upside and downside dispersion close to balanced.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'histo') {
    const { mostFreqBucket, mean, median } = p;
    const skewPct = median > 0 ? ((mean - median) / Math.abs(median)) * 100 : 0;
    const skewWord = Math.abs(skewPct) < 3 ? 'symmetric' : (skewPct > 0 ? 'positive skew' : 'negative skew');
    line1 = `Most common range ${W(mostFreqBucket)} (mode). Mean ${W(mean.toFixed(2) + ' €/MWh')} ${mean > median ? '>' : '≤'} median ${W(median.toFixed(2) + ' €/MWh')} — ${W(skewWord)}.`;
    let read;
    if (skewPct > 5) {
      read = `<b>Mean above median</b>. Upper-tail values pull the mean above the typical day.`;
    } else if (skewPct < -5) {
      read = `<b>Mean below median</b>. Lower-tail values pull the mean below the typical day.`;
    } else {
      read = `<b>Mean and median aligned</b>. No material skew in the distribution.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  // ── Daily drill-down (single zone, single day) ──
  // Mirrors the 2-line layout used by Historical modes: facts on line 1,
  // italic "Market read :" verdict on line 2.
  else if (mode === 'dailyDrill') {
    const { zone, dayLabel, today, j1Avg, delta, deltaPct,
            peakAvg, offPkAvg, peakRatio,
            min, max, minSlot, maxSlot,
            negHours, negMins, negMin, negSlots,
            bandIdSuffix } = p;
    const sign = v => v >= 0 ? '+' : '';

    // ── Line 1 · facts ──
    const factParts = [];
    if (today != null) {
      let s = `Day printed ${W(today.toFixed(2) + ' €/MWh')}`;
      if (delta != null) {
        s += `, ${A(sign(delta) + delta.toFixed(2) + ' €/MWh')} vs J-1`;
        if (deltaPct != null) s += ` (${A(sign(deltaPct) + deltaPct.toFixed(1) + '%')})`;
      }
      factParts.push(s);
    }
    if (peakAvg != null && offPkAvg != null) {
      factParts.push(`peak ${W(peakAvg.toFixed(2))} / off-pk ${W(offPkAvg.toFixed(2))} €/MWh` +
                     (peakRatio != null ? ` (ratio ${A(peakRatio.toFixed(2) + 'x')})` : ''));
    }
    if (min != null && max != null) {
      factParts.push(`range ${A(min.toFixed(2))} on ${A(minSlot || '--')} → ${A(max.toFixed(2) + ' €/MWh')} on ${A(maxSlot || '--')}`);
    }
    if (negHours != null && (negHours > 0 || (negMins != null && negMins > 0))) {
      const dur = negHours + 'h' + (negMins > 0 ? String(negMins).padStart(2,'0') : '');
      factParts.push(`${A('negative-price episode')} ${A(dur)} below zero, min ${A(negMin != null ? negMin.toFixed(2) + ' €/MWh' : '--')}`);
    }
    line1 = factParts.join('. ') + (factParts.length ? '.' : '');

    // ── Line 2 · verdict (market read) ──
    let read;
    const isNeg = negHours != null && negHours > 0;
    const bigMove = (deltaPct != null && Math.abs(deltaPct) >= 15);
    const isFlat = (peakRatio != null && peakRatio < 1.20);
    const isInverted = (peakRatio != null && peakRatio < 1.0);
    const isPeakier = (peakRatio != null && peakRatio > 1.6);

    if (isNeg && isInverted) {
      read = `<b>Renewable stress event</b>. Solar surplus pushed prices through zero and inverted the peak/off-peak relationship.`;
    } else if (isNeg) {
      read = `<b>Negative-price episode</b>. Renewable oversupply during the day; storage and flexible offtake captured rents.`;
    } else if (isInverted) {
      read = `<b>Inverted profile (duck curve)</b>. Off-peak more expensive than peak — solar-driven midday floor.`;
    } else if (isFlat && bigMove && delta > 0) {
      read = `<b>Tight day, sharply higher vs J-1</b>. Limited intraday swings but level reset upward.`;
    } else if (isFlat) {
      read = `<b>Flatter-than-normal day</b>. Peak/off-peak gap compressed vs the 1.30x baseline.`;
    } else if (isPeakier && bigMove) {
      read = `<b>Peaky day with sharp move</b>. Pronounced intraday shape on top of a strong directional shift vs J-1.`;
    } else if (isPeakier) {
      read = `<b>Peakier-than-normal day</b>. Wide intraday swings around the average.`;
    } else if (bigMove && delta > 0) {
      read = `<b>Sharp upside vs J-1</b>. Daily level reset higher with a normal profile shape.`;
    } else if (bigMove && delta < 0) {
      read = `<b>Sharp downside vs J-1</b>. Daily level reset lower with a normal profile shape.`;
    } else {
      read = `<b>Normal day</b>. Level and shape both close to the prior session.`;
    }

    // The band-stats sentence (P50 / vs median) is injected later by
    // _loadAndApplyRowBand into the #row-market-read-band-* placeholder
    // we leave embedded inside the verdict.
    const bandSpan = bandIdSuffix
      ? ` <span class="row-market-read-band" id="row-market-read-band-${bandIdSuffix}"></span>`
      : '';
    verdict = `${VR_OPEN}${read}${bandSpan}${VR_CLOSE}`;
  }

  // ── Compare zones modes (used by Daily + Historical compare-zones charts) ──
  else if (mode === 'ccLines' || mode === 'ccProfile' || mode === 'ccBands' || mode === 'ccSpread' || mode === 'ccHeatmap') {
    const { cheap, pricey, frGap, loadedAvg, zoneCount, view } = p;
    const cheapStr  = cheap  ? `${W(cheap.z + ' ' + cheap.avg.toFixed(2) + ' €/MWh')}`  : '--';
    const priceyStr = pricey ? `${W(pricey.z + ' ' + pricey.avg.toFixed(2) + ' €/MWh')}` : '--';
    const spread    = (cheap && pricey) ? (pricey.avg - cheap.avg) : null;
    line1 = `${W(zoneCount)} zones · avg ${W(loadedAvg != null ? loadedAvg.toFixed(2) + ' €/MWh' : '--')}. Cheapest ${cheapStr}, most expensive ${priceyStr}` +
      (spread != null ? `. Spread ${A(spread.toFixed(2) + ' €/MWh')}.` : '.');
    // Verdict depends on spread magnitude and FR positioning
    let read;
    if (spread != null && cheap && cheap.avg > 0) {
      const spreadPct = (spread / cheap.avg) * 100;
      const frPart = (frGap != null && frGap > 0)
        ? ` FR sits ${A('+' + frGap.toFixed(2) + ' €/MWh')} above ${cheap.z}.`
        : (frGap != null && frGap <= 0)
          ? ` FR is the cheapest market.`
          : '';
      if (spreadPct > 100) {
        read = `<b>Highly fragmented zones</b>. Spread exceeds 100% of the cheapest level.${frPart}`;
      } else if (spreadPct > 40) {
        read = `<b>Pronounced cross-zone divergence</b>. Arbitrage potential significant.${frPart}`;
      } else if (spreadPct > 15) {
        read = `<b>Moderate cross-zone gap</b>. Zones diverge but stay within a common band.${frPart}`;
      } else {
        read = `<b>Tightly aligned zones</b>. European prices move close together.${frPart}`;
      }
    } else {
      read = `<b>Insufficient data</b>. Add zones to enable comparison.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  if (!line1) return '';
  return `<div class="ho-analyst-banner" style="margin-top:32px;padding:11px 14px;font-size:11.5px;border-radius:3px;color:#FBBF24;background:rgba(251,191,36,0.08);border-left:3px solid #FBBF24;line-height:1.6">${ICON}${line1}${verdict}</div>`;
}
// Expose globally so prices.js can reuse the same builder for Compare Zones (Daily)
if (typeof window !== 'undefined') window._buildAnalystBanner = _buildAnalystBanner;

// Insert/replace the analyst banner under a chart canvas (inline or fullscreen)
function _renderAnalystBanner(html) {
  const ctx = _hszCtx();
  const canvas = document.getElementById(ctx.canvasId);
  if (!canvas) return;
  // Detect whether we're in fullscreen mode
  const isFs = (ctx.canvasId === 'ho-fs-chart');
  // Clean all existing banners across all scopes (inline + FS)
  _clearAllAnalystBanners();
  if (!html) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const banner = tmp.firstElementChild;
  if (!banner) return;
  if (isFs) {
    // Fullscreen: insert in ho-fs-chart-pane, AFTER the canvas wrapper but BEFORE ho-fs-legend
    const pane = document.getElementById('ho-fs-chart-pane');
    const legend = document.getElementById('ho-fs-legend');
    if (pane && legend) {
      pane.insertBefore(banner, legend);
    } else if (pane) {
      pane.appendChild(banner);
    }
  } else {
    // Inline: use the fixed anchor div in the drill DOM (#ho-detail-analyst-banner).
    // Unified mechanism with Daily drill (anchor + innerHTML). Falls back to the
    // legacy chart-parent insertion if the anchor isn't found (defensive).
    const anchor = document.getElementById('ho-detail-analyst-banner');
    if (anchor) {
      anchor.innerHTML = banner.outerHTML;
      return;
    }
    const wrap = canvas.parentNode;
    const container = wrap ? wrap.parentNode : null;
    if (!wrap || !container) return;
    if (wrap.nextSibling) container.insertBefore(banner, wrap.nextSibling);
    else container.appendChild(banner);
  }
}

// Remove every analyst banner in the active detail or fullscreen scope.
// Called when switching tab/sub-mode so banners from the previous view don't linger.
function _clearAllAnalystBanners() {
  const scopes = ['ho-detail-row', 'ho-fs-overlay', 'pk-fs-overlay'];
  scopes.forEach(id => {
    const root = document.getElementById(id);
    if (!root) return;
    root.querySelectorAll('.ho-analyst-banner').forEach(el => el.remove());
  });
}

// Align a zone-legend ribbon's inner padding with the active chart's drawing area
// (chart.chartArea.left/right). Chart.js renders asynchronously, so chartArea is
// not always available immediately after creation. We poll via requestAnimationFrame
// for up to ~10 frames (~160ms) until chartArea is populated, then apply paddings.
// Also re-applies on window resize so the alignment stays valid.
function _alignLegendToChartArea(legendId, attempts) {
  attempts = attempts || 0;
  const apply = () => {
    const chart = HIST.charts[_hszCtx().canvasId];
    const canvas = document.getElementById(_hszCtx().canvasId);
    const inner = document.getElementById(legendId + '-inner');
    if (!chart || !canvas || !inner) return false;
    if (!chart.chartArea || chart.chartArea.left == null) return false;
    const canvasW = canvas.clientWidth;
    const padLeft = Math.max(0, chart.chartArea.left);
    const padRight = Math.max(0, canvasW - chart.chartArea.right);
    inner.style.paddingLeft = padLeft + 'px';
    inner.style.paddingRight = padRight + 'px';
    return true;
  };
  if (apply()) {
    // Hook resize re-alignment (only once per legend)
    const legendEl = document.getElementById(legendId);
    if (legendEl && !legendEl._pkResizeHooked) {
      legendEl._pkResizeHooked = true;
      const onResize = () => apply();
      window.addEventListener('resize', onResize);
      // Cleanup when legend removed (MutationObserver on parent)
      const parent = legendEl.parentNode;
      if (parent && typeof MutationObserver !== 'undefined') {
        const obs = new MutationObserver(() => {
          if (!document.contains(legendEl)) {
            window.removeEventListener('resize', onResize);
            obs.disconnect();
          }
        });
        obs.observe(parent, { childList: true });
      }
    }
    return;
  }
  // Retry up to 10 frames
  if (attempts < 10) {
    requestAnimationFrame(() => _alignLegendToChartArea(legendId, attempts + 1));
  }
}

function _setHoTitle({ eyebrow, title, subtitle }) {
  const fs = _hoFsIsOpen();
  const prefix = fs ? 'ho-fs' : 'ho-detail';
  const ey = document.getElementById(prefix + '-eyebrow');
  const ti = document.getElementById(prefix + '-title');
  const su = document.getElementById(prefix + '-subtitle');
  if (ey) ey.textContent = eyebrow || '';
  // Title and subtitle: HTML supported so renderers can render structured content
  // (e.g. "Title | discrete description" in title, formula + stats in subtitle).
  // Renderers are responsible for not interpolating user-controlled input raw.
  if (ti) ti.innerHTML = title || '';
  if (su) su.innerHTML = subtitle || '';
  const otherPrefix = fs ? 'ho-detail' : 'ho-fs';
  const oey = document.getElementById(otherPrefix + '-eyebrow');
  const oti = document.getElementById(otherPrefix + '-title');
  const osu = document.getElementById(otherPrefix + '-subtitle');
  if (oey) oey.textContent = eyebrow || '';
  if (oti) oti.innerHTML = title || '';
  if (osu) osu.innerHTML = subtitle || '';
}

async function _hszRenderTab(filtered, zone, tab, summary) {
  // Backward-compat: legacy 'weekly' tab id → renamed to 'weekday'
  if (tab === 'weekly') tab = 'weekday';
  // Clear ALL analyst banners from the previous tab/mode before rendering this one.
  // (Each renderer will then insert its own banner if needed.)
  _clearAllAnalystBanners();
  // Expose unfiltered zone series for rolling-window stats (7D/30D, sigma, etc.)
  // so they aren't truncated when the user shrinks the visible window.
  const fullZoneSeries = (summary && summary.zones && summary.zones[zone]) || [];
  _HSZ_TARGET.getFullSeries = () => fullZoneSeries;
  const tabLabels = {
    lines: 'Lines', yoy: 'YoY', weekday: 'Weekday', vol: 'Volatility', dist: 'Distribution',
  };
  _setHoTitle({
    eyebrow: `Prices · ${tabLabels[tab] || tab} · ${zone}`,
    title: '',
    subtitle: '',
  });
  const canvas = document.getElementById(_hszCtx().canvasId);
  if (canvas) {
    canvas.style.display = '';
    if (canvas.parentNode) canvas.parentNode.style.display = '';
  }

  const togPrefix = _hszCtx().togglePrefix;
  // Cleanup Hourly-specific UI unless we're on YoY · Hourly mode
  const isHourlySubmode = (tab === 'yoy' && _hszCtx().getYoyMode() === 'hourly');
  if (!isHourlySubmode) {
    _hszHideHourlyToggle();
    const qg = document.getElementById(togPrefix + '-quarter-grid');
    if (qg) qg.remove();
    const ql = document.getElementById(togPrefix + '-quarter-legend');
    if (ql) ql.remove();
  }
  // Cleanup Weekday HTML legend unless we're on Weekday tab
  if (tab !== 'weekday' && tab !== 'weekly') {
    const wdLg = document.getElementById(togPrefix + '-weekday-legend');
    if (wdLg) wdLg.remove();
  }
  // Cleanup Volatility-specific UI unless we're on Volatility tab
  if (tab !== 'vol' && tab !== 'volatility') {
    const volLg = document.getElementById(togPrefix + '-vol-legend');
    if (volLg) volLg.remove();
  }
  // Cleanup Distribution-specific UI (formula strip + legend) unless we're on Distribution tab
  if (tab !== 'dist' && tab !== 'distribution') {
    const df = document.getElementById(togPrefix + '-dist-formula');
    if (df) df.remove();
    const dl = document.getElementById(togPrefix + '-dist-legend');
    if (dl) dl.remove();
  }

  // Persist last series + summary for breakdown rerenders (Volatility toggle, etc.)
  window._HO_LAST_SERIES = window._HO_LAST_SERIES || {};
  window._HO_LAST_SERIES[zone] = filtered;
  window._HO_LAST_SUMMARY = summary;
  // Map our HSZ tab/yoyMode to the dispatcher (read by _renderHoBreakdown)
  // Note: tab is normalised above (weekly→weekday)
  HSZ.tab = tab;

  // Dispatch render by tab
  let renderResult = null;
  if (tab === 'lines')         renderResult = _hszRenderLines(filtered, zone);
  else if (tab === 'yoy') {
    const mode = _hszCtx().getYoyMode();
    if (mode === 'hourly')       renderResult = _hszRenderHourly(filtered, zone);
    else if (mode === 'weekly')  renderResult = _hszRenderWeeklyYoY(filtered, zone, summary);
    else if (mode === 'monthly') renderResult = _hszRenderSeasonal(filtered, zone, summary);
    else                          renderResult = _hszRenderYoY(filtered, zone, summary);  // default = daily
  }
  else if (tab === 'weekday')  renderResult = _hszRenderWeekly(filtered, zone);
  else if (tab === 'vol')      renderResult = _hszRenderVolatility(filtered, zone);
  else if (tab === 'dist')     renderResult = _hszRenderDist(filtered, zone, summary);

  // Normalise tab id for the breakdown dispatcher (vol → volatility, dist → distribution)
  const bdTab = tab === 'vol' ? 'volatility' : (tab === 'dist' ? 'distribution' : tab);
  const oldTab = HSZ.tab;
  HSZ.tab = bdTab;
  try { _renderHoBreakdown(zone, filtered, summary); } catch (e) { console.warn('Breakdown render failed:', e); }
  HSZ.tab = oldTab;

  return renderResult;
}

function _hszPlaceholder(msg) {
  const canvas = document.getElementById(_hszCtx().canvasId);
  if (!canvas) return;
  const wrap = canvas.parentNode;
  const old = wrap.querySelector('.no-data-msg');
  if (old) old.remove();
  canvas.style.display = 'none';
  const div = document.createElement('div');
  div.className = 'no-data-msg';
  div.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--tx3);font-size:12px;font-style:italic;letter-spacing:0.04em;text-align:center;padding:0 20px';
  div.innerHTML = msg;
  wrap.appendChild(div);
}

// HSZ Y zoom preset state (kept per-zone but for simplicity at module level)
let _hszYPreset = 'standard';  // 'focus' | 'standard' | 'all'

function setHszYPreset(preset) {
  _hszYPreset = preset;
  _hszRerender();
}
window.setHszYPreset = setHszYPreset;

function _computeYRange(validAvgs, validMaxes, validMins, preset, roll7, roll30) {
  // Returns {yMin, yMax} based on the preset:
  //  - 'focus':    tight range around the rolling 7D/30D lines (the trend)
  //                avg/ribbon may be clipped — pure trend view
  //  - 'standard': avg ± 30% margin (default, balanced, shows ribbon)
  //  - 'all':      real daily max/min extremes (shows outliers + ribbon)
  if (!validAvgs.length) return { yMin: null, yMax: null };

  if (preset === 'focus' && roll7 && roll30) {
    // Use min/max of the smoothed rolling lines (filtered for nulls)
    const allRolls = [...roll7, ...roll30].filter(v => v != null && !isNaN(v));
    if (allRolls.length) {
      const rMin = Math.min(...allRolls);
      const rMax = Math.max(...allRolls);
      const rRange = Math.max(rMax - rMin, 10);
      const margin = rRange * 0.15;  // 15% margin around the trend
      const yMax = Math.ceil((rMax + margin) / 5) * 5;
      const yMin = Math.floor((rMin - margin) / 5) * 5;
      return { yMin, yMax };
    }
  }

  const avgMin = Math.min(...validAvgs);
  const avgMax = Math.max(...validAvgs);
  const avgRange = Math.max(avgMax - avgMin, 20);
  let yMin = null, yMax = null;

  if (preset === 'all' && validMaxes.length && validMins.length) {
    yMax = Math.ceil(Math.max(...validMaxes) * 1.05 / 25) * 25;
    yMin = Math.floor(Math.min(...validMins) * 1.05 / 25) * 25;
  } else {
    // Standard
    const margin = avgRange * 0.3;
    yMax = Math.ceil((avgMax + margin) / 10) * 10;
    yMin = Math.floor((avgMin - margin) / 10) * 10;
    if (avgMin < 0 && yMin > avgMin) yMin = Math.floor(avgMin * 1.1 / 10) * 10;
  }
  return { yMin, yMax };
}

// _hszInjectYPresets removed — Y preset bar is rendered directly inside the
// drill-down row by _openHoRow (see ho-detail-* IDs).

function _hszResetZoom() {
  const ch = HIST.charts[_hszCtx().canvasId];
  if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
}
window._hszResetZoom = _hszResetZoom;

function _hszRenderLines(filtered, zone) {
  const labels = filtered.map(d => d.d);
  const avgs   = filtered.map(d => d.avg);
  const maxes  = filtered.map(d => d.max);
  const mins   = filtered.map(d => d.min);
  // Rolling 7D/30D computed on the FULL zone series — so a 7D window still
  // shows a meaningful "30D rolling" line based on the 30 days ending at
  // each visible point (most of those days are outside the visible window).
  const fullSeries = _hszCtx().getFullSeries() || [];
  const roll7  = _rollingWithContext(filtered, fullSeries, 7);
  const roll30 = _rollingWithContext(filtered, fullSeries, 30);
  const color = zoneColor(zone);

  // ── Palette differentiation ──
  // Daily avg  → zone colour (primary line, thick 2.2px)
  // 7D rolling → white-ish dashed thin (subtle short-term trend)
  // 30D rolling→ amber #FBBF24 thick solid (long-term trend, never collides with zone colour)
  // Ribbon max/min → very faint, hidden in Focus
  const dailyCol   = color;
  const roll7Col   = 'rgba(255,255,255,0.55)';
  const roll30Col  = '#FBBF24';

  // Convert zone color to rgba for ribbon fill (ultra-discreet)
  let ribbonFill = 'rgba(20,211,169,0.05)';
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    ribbonFill = `rgba(${r},${g},${b},0.04)`;
  }
  const maxBorder = 'rgba(251,191,36,0.35)';
  const minBorder = 'rgba(237,105,101,0.35)';

  // Compute Y range based on preset (Focus uses rolling lines range)
  const validAvgs  = avgs.filter(v => v != null);
  const validMaxes = maxes.filter(v => v != null && !isNaN(v));
  const validMins  = mins.filter(v => v != null && !isNaN(v));
  let { yMin, yMax } = _computeYRange(validAvgs, validMaxes, validMins, _hszCtx().getYPreset(), roll7, roll30);

  // ── Focus mode safety: ensure Daily avg stays visible ──
  // Even in Focus (which targets rolling lines), clamp Y bounds so the
  // primary Daily series is never clipped: extend by 10% on either side
  // if needed. Daily *must* always be visible.
  if (_hszCtx().getYPreset() === 'focus' && validAvgs.length) {
    const dailyMin = Math.min(...validAvgs);
    const dailyMax = Math.max(...validAvgs);
    const span = Math.max(1, dailyMax - dailyMin);
    const pad = span * 0.10;
    if (yMin == null || dailyMin - pad < yMin) yMin = dailyMin - pad;
    if (yMax == null || dailyMax + pad > yMax) yMax = dailyMax + pad;
  }

  // In Focus mode, hide the ribbon entirely (we want pure trend view)
  const showRibbon = _hszCtx().getYPreset() !== 'focus';

  // Min/max avg markers (now with explicit ▼ Min / ▲ Max labels)
  // NOTE: chartjs-plugin-annotation v3+ uses `display: true` on the label,
  // not `enabled: true` (v2 syntax). Wrong key = label silently hidden.
  const annotations = {};
  if (validAvgs.length) {
    const minVal = Math.min(...validAvgs);
    const maxVal = Math.max(...validAvgs);
    annotations.minPt = {
      type: 'point', xValue: avgs.indexOf(minVal), yValue: minVal,
      backgroundColor: _HIST_DN, radius: 5, borderColor: '#fff', borderWidth: 1,
      label: {
        display: true,
        content: `▼ Min ${minVal.toFixed(2)}`,
        color: '#fff',
        font: { size: 10, weight: '600' },
        backgroundColor: _HIST_DN,
        position: 'center',
        yAdjust: 20,
        padding: 4,
        borderRadius: 3,
      },
    };
    annotations.maxPt = {
      type: 'point', xValue: avgs.indexOf(maxVal), yValue: maxVal,
      backgroundColor: _HIST_UP, radius: 5, borderColor: '#fff', borderWidth: 1,
      label: {
        display: true,
        content: `▲ Max ${maxVal.toFixed(2)}`,
        color: '#fff',
        font: { size: 10, weight: '600' },
        backgroundColor: _HIST_UP,
        position: 'center',
        yAdjust: -20,
        padding: 4,
        borderRadius: 3,
      },
    };
  }

  // ── Date formatter helper (DD-MM-YYYY, UK style) ──
  // Reads original ISO labels and reformats to DD-MM-YYYY for display.
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
  };

  // ── HTML title block (hybrid style: eyebrow + title + subtitle) ──
  // Build a short data summary as subtitle.
  const validAvgsOnly = avgs.filter(v => v != null);
  const periodAvg = validAvgsOnly.length
    ? (validAvgsOnly.reduce((a, b) => a + b, 0) / validAvgsOnly.length)
    : null;
  // Compute sigma + min/max with dates for analyst banner
  let sigma = null;
  if (validAvgsOnly.length >= 2) {
    const s = _stdDev(validAvgsOnly);
    if (s != null && !isNaN(s)) sigma = s;
  }
  let minV = null, maxV = null, minDate = null, maxDate = null;
  for (const d of filtered) {
    if (d.avg == null || isNaN(d.avg)) continue;
    if (minV == null || d.avg < minV) { minV = d.avg; minDate = d.d; }
    if (maxV == null || d.avg > maxV) { maxV = d.avg; maxDate = d.d; }
  }
  _setHoTitle({
    eyebrow: `Prices · Lines · ${zone}`,
    title: _titleWithDescription('Daily prices with 7-day and 30-day moving averages', 'Daily average prices over the selected period'),
    subtitle: '',
  });

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        // Ribbon: max-min daily envelope (faint, hidden in Focus)
        {
          label: 'Daily max',
          data: maxes,
          borderColor: maxBorder,
          backgroundColor: ribbonFill,
          borderWidth: 0.8,
          pointRadius: 0,
          tension: 0,
          spanGaps: true,
          fill: '+1',
          order: 5,
          hidden: !showRibbon,
        },
        {
          label: 'Daily min',
          data: mins,
          borderColor: minBorder,
          backgroundColor: 'transparent',
          borderWidth: 0.8,
          pointRadius: 0,
          tension: 0,
          spanGaps: true,
          fill: false,
          order: 5,
          hidden: !showRibbon,
        },
        // Main 3 lines (order matters for stacking)
        { label: 'Daily avg', data: avgs,   borderColor: dailyCol,  borderWidth: 2.2, pointRadius: 0, tension: 0.2, spanGaps: true, fill: false, order: 3 },
        { label: '7D rolling', data: roll7, borderColor: roll7Col,  borderWidth: 1.5, pointRadius: 0, tension: 0.2, spanGaps: true, fill: false, borderDash: [4,3], order: 2 },
        { label: '30D rolling', data: roll30, borderColor: roll30Col, borderWidth: 2.4, pointRadius: 0, tension: 0.3, spanGaps: true, fill: false, order: 1 },
      ],
    },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        // Title/subtitle now rendered as HTML via _setHoTitle above the canvas
        // (hybrid eyebrow + title + subtitle style — multi-style impossible in plugins.title).
        title: { display: false },
        legend: {
          // In FS mode, the dedicated HTML legend below the chart serves this role
          // and the top-right is occupied by toggle buttons (KPIs/Table/Chart-only).
          // In inline mode, keep the native Chart.js legend.
          display: (_hszCtx().canvasId !== 'ho-fs-chart'),
          position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 12, boxHeight: 2, padding: 10,
            usePointStyle: false,
          },
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const index = legendItem.datasetIndex;
            // Clicking Daily max or Daily min toggles BOTH (they are a pair)
            const lbl = ci.data.datasets[index].label;
            if (lbl === 'Daily max' || lbl === 'Daily min') {
              const maxIdx = ci.data.datasets.findIndex(d => d.label === 'Daily max');
              const minIdx = ci.data.datasets.findIndex(d => d.label === 'Daily min');
              const wasVisible = ci.isDatasetVisible(maxIdx);
              ci.setDatasetVisibility(maxIdx, !wasVisible);
              ci.setDatasetVisibility(minIdx, !wasVisible);
            } else {
              const wasVisible = ci.isDatasetVisible(index);
              ci.setDatasetVisibility(index, !wasVisible);
            }
            ci.update();
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            title: (items) => items.length ? fmtDate(items[0].label) : '',
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          }
        },
        annotation: { annotations },
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.12)',
              borderColor: 'rgba(20,211,169,0.5)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        // Double-click resets the zoom
        if (evt.native && evt.native.detail === 2) {
          const ch = HIST.charts[_hszCtx().canvasId];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: {
          grid: { color: _HIST_GRID },
          ticks: {
            color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 8,
            callback: function(value) {
              const lbl = this.getLabelForValue(value);
              return _fmtTickUK(lbl);
            },
          },
        },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          min: yMin, max: yMax,
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    }
  });
  // Analyst banner under the chart
  if (periodAvg != null && sigma != null && minV != null && maxV != null) {
    _renderAnalystBanner(_buildAnalystBanner('lines', {
      avg: periodAvg, sigma, min: minV, max: maxV, minDate, maxDate,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · YoY: same calendar window vs Y-1/Y-2 with historical envelopes.
// Auto-switches to "calendar overlay" mode for windows >= 2Y.
function _hszRenderYoY(filtered, zone, summary) {
  const color = zoneColor(zone);
  const all = summary.zones[zone] || [];
  if (!filtered.length || !all.length) return _hszPlaceholder('Not enough data for YoY');

  // Determine if we're in "long window" mode (2Y, 5Y, All) → calendar overlay
  const w = _hszCtx().getWindow();
  const longWindow = ['2Y', '5Y', 'All'].includes(w);

  if (longWindow) {
    // ── CALENDAR OVERLAY: one line per year, X axis = Jan..Dec ──
    return _hszRenderYoYCalendar(filtered, zone, summary, all);
  }

  // ── SUPERPOSITION MODE: current vs Y-1 vs Y-2 aligned by MM-DD ──
  const curFrom = filtered[0].d;
  const curTo   = filtered[filtered.length - 1].d;

  // Build lookup maps for Y-1 and Y-2 sliced by shifted date window,
  // then re-key by month-day so we align with current[i] regardless of
  // leap-year / missing-day mismatches.
  const sliceWindow = (fromStr, toStr) => all.filter(e => e.d >= fromStr && e.d <= toStr);
  const ny1Arr = sliceWindow(_shiftYearsISO(curFrom, 1), _shiftYearsISO(curTo, 1));
  const ny2Arr = sliceWindow(_shiftYearsISO(curFrom, 2), _shiftYearsISO(curTo, 2));
  const ny1ByMMDD = {};
  ny1Arr.forEach(e => { ny1ByMMDD[e.d.slice(5)] = e.avg; });
  const ny2ByMMDD = {};
  ny2Arr.forEach(e => { ny2ByMMDD[e.d.slice(5)] = e.avg; });

  // Use REAL DATES (current period) as labels so X axis is informative.
  const labels = filtered.map(d => d.d);

  // Align Y-1/Y-2 to current by MM-DD (NOT by index) so they stay
  // mathematically inside the P0–P100 envelope built from the same buckets.
  const cur   = filtered.map(d => d.avg);
  const prev1 = filtered.map(d => ny1ByMMDD[d.d.slice(5)] ?? null);
  const prev2 = filtered.map(d => ny2ByMMDD[d.d.slice(5)] ?? null);

  // Build historical envelopes from years strictly older than the current period start
  const histYears = all.filter(e => e.d < curFrom);
  const env = _historicalEnvelope(filtered, histYears);

  // Aggregate means for subtitle / commentary
  const curMean = _meanIgnoreNull(cur);
  const p1Mean  = _meanIgnoreNull(prev1);
  const p2Mean  = _meanIgnoreNull(prev2);

  // ── Bands ──
  // Outer (P0–P100, Min–Max absolute) → very faint background ribbon
  // Inner (P5–P95, typical regime)    → a bit more visible
  const outerFill = _toRgba(color, 0.04);
  const innerFill = _toRgba(color, 0.10);

  // ── Date formatter (DD-MM-YYYY, UK style) ──
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
  };

  // ── Y-preset handling (Focus / Standard / All) ──
  // Focus    = clip Y to current+Y-1+Y-2 range AND hide both bands (pure line comparison)
  // Standard = include P5–P95 band (typical historical regime)
  // All      = include full Min–Max band (default behaviour)
  const preset = _hszCtx().getYPreset();
  const hideBands = (preset === 'focus');
  let yMin = null, yMax = null;
  const currentLines = [...cur, ...prev1, ...prev2].filter(v => v != null && !isNaN(v));
  if (preset === 'focus' && currentLines.length) {
    const lo = Math.min(...currentLines);
    const hi = Math.max(...currentLines);
    const pad = Math.max(5, (hi - lo) * 0.10);
    yMin = lo - pad;
    yMax = hi + pad;
  } else if (preset === 'standard') {
    const all95 = [...currentLines, ...env.p5Line.filter(v => v != null), ...env.p95Line.filter(v => v != null)];
    if (all95.length) {
      yMin = Math.min(...all95);
      yMax = Math.max(...all95);
      const pad = Math.max(5, (yMax - yMin) * 0.05);
      yMin -= pad; yMax += pad;
    }
  } // 'all' → no clamp, chart auto-fits including Min-Max envelope

  // ── Subtitle cleared : analyst banner under the chart covers the content ──
  const haveYoY = (curMean != null && p1Mean != null);
  const yoyDelta = haveYoY ? curMean - p1Mean : null;

  // HTML title block (hybrid style)
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Daily`,
    title: _titleWithDescription('Daily profile', 'Current year vs Y-1, Y-2, and historical range (Min-Max, P5-P95)'),
    subtitle: '',
  });

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        // ── Outer band: Min–Max absolute (P0–P100) — ultra-faint background ──
        // Single legend entry "Min–Max range" toggles BOTH max+min lines via _bandPair.
        {
          label: 'Min–Max range', data: env.p100Line,
          borderColor: 'rgba(255,255,255,0.08)', backgroundColor: outerFill,
          borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
          fill: '+1', order: 8, _bandPair: 'outer',
          hidden: hideBands,
        },
        {
          label: '_outer_min', data: env.p0Line,
          borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'transparent',
          borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
          fill: false, order: 8, _bandPair: 'outer', _hideFromLegend: true,
          hidden: hideBands,
        },
        // ── Inner band: typical regime (P5–P95) ──
        {
          label: 'Typical range (P5–P95)', data: env.p95Line,
          borderColor: 'rgba(255,255,255,0.20)', backgroundColor: innerFill,
          borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
          fill: '+1', order: 7, _bandPair: 'inner',
          hidden: hideBands,
        },
        {
          label: '_inner_min', data: env.p5Line,
          borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'transparent',
          borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
          fill: false, order: 7, _bandPair: 'inner', _hideFromLegend: true,
          hidden: hideBands,
        },
        // ── Historical median (thin reference line) ──
        {
          label: 'Hist median', data: env.medianLine,
          borderColor: 'rgba(255,255,255,0.30)', borderWidth: 1, pointRadius: 0,
          tension: 0, spanGaps: true, fill: false, borderDash: [2,3], order: 6,
        },
        // ── Y-2 — fine, dashed, subordinate ──
        {
          label: 'Y-2', data: prev2,
          borderColor: 'rgba(168,125,196,0.65)', borderWidth: 1.4, pointRadius: 0,
          tension: 0.2, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
        },
        // ── Y-1 — fine, dashed, subordinate ──
        {
          label: 'Y-1', data: prev1,
          borderColor: 'rgba(255,255,255,0.55)', borderWidth: 1.4, pointRadius: 0,
          tension: 0.2, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
        },
        // ── Current — the star ──
        {
          label: 'Current period', data: cur,
          borderColor: color, borderWidth: 2.4, pointRadius: 0,
          tension: 0.2, spanGaps: true, fill: false, order: 1,
        },
      ],
    },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        // Title/subtitle now rendered as HTML via _setHoTitle above the canvas.
        title: { display: false },
        subtitle: { display: false },
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 14, boxHeight: 2, padding: 12,
            // Hide only the synthetic "lower bound" duplicate entries from the legend
            // — the user toggles a whole band via the visible upper-bound entry.
            filter: (item, chartData) => {
              const ds = chartData.datasets[item.datasetIndex];
              return !ds || !ds._hideFromLegend;
            },
          },
          // Custom click handler: clicking a band entry toggles BOTH members of the pair
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const idx = legendItem.datasetIndex;
            const ds = ci.data.datasets[idx];
            if (ds && ds._bandPair) {
              const pair = ds._bandPair;
              const newVisible = !ci.isDatasetVisible(idx);
              ci.data.datasets.forEach((d, i) => {
                if (d._bandPair === pair) ci.setDatasetVisibility(i, newVisible);
              });
            } else {
              ci.setDatasetVisibility(idx, !ci.isDatasetVisible(idx));
            }
            ci.update();
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          // Don't show synthetic duplicate band lines in tooltip
          filter: (item) => {
            const ds = item.chart.data.datasets[item.datasetIndex];
            return !ds || !ds._hideFromLegend;
          },
          callbacks: {
            title: (items) => items.length ? fmtDate(items[0].label) : '',
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          },
        },
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.12)',
              borderColor: 'rgba(20,211,169,0.5)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        if (evt.native && evt.native.detail === 2) {
          const ch = HIST.charts[_hszCtx().canvasId];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: {
          grid: { color: _HIST_GRID },
          ticks: {
            color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 8,
            callback: function(value) {
              const lbl = this.getLabelForValue(value);
              return _fmtTickUK(lbl);
            },
          },
        },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          min: yMin != null ? yMin : undefined,
          max: yMax != null ? yMax : undefined,
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    },
  });
  // Analyst banner
  if (haveYoY) {
    _renderAnalystBanner(_buildAnalystBanner('yoyDaily', {
      curMean, prevMean: p1Mean, delta: yoyDelta,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · YoY Calendar Overlay (long windows: 2Y+) ──
function _hszRenderYoYCalendar(filtered, zone, summary, all) {
  const color = zoneColor(zone);
  // Group entries by year-month and compute monthly avg per year
  const byYearMonth = {};
  all.forEach(e => {
    if (e.avg == null) return;
    const [y, m] = e.d.split('-');
    const key = y;
    if (!byYearMonth[key]) byYearMonth[key] = Array(12).fill(null);
    if (!byYearMonth[key][parseInt(m) - 1]) byYearMonth[key][parseInt(m) - 1] = [];
    byYearMonth[key][parseInt(m) - 1].push(e.avg);
  });
  // Flatten to monthly avg per year
  const byYear = {};
  Object.keys(byYearMonth).forEach(y => {
    byYear[y] = byYearMonth[y].map(monthArr => {
      if (!monthArr) return null;
      const v = monthArr.filter(x => x != null);
      return v.length ? v.reduce((a,b)=>a+b,0) / v.length : null;
    });
  });
  const years = Object.keys(byYear).sort();
  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Color palette for past years (purple → teal → amber → coral)
  const yearColors = ['rgba(123,75,156,0.5)', 'rgba(63,166,180,0.6)', 'rgba(186,117,23,0.6)', 'rgba(212,83,126,0.55)', 'rgba(20,158,117,0.55)'];

  const datasets = years.map((y, i) => {
    const isCurrent = i === years.length - 1;
    return {
      label: y,
      data: byYear[y],
      borderColor: isCurrent ? color : yearColors[i % yearColors.length],
      borderWidth: isCurrent ? 3 : 1.5,
      pointRadius: isCurrent ? 4 : 3,
      pointBackgroundColor: isCurrent ? color : yearColors[i % yearColors.length],
      tension: 0.25,
      spanGaps: true,
      fill: false,
    };
  });

  // HTML title block (hybrid style)
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Daily`,
    title: 'Monthly averages by year · calendar overlay',
    subtitle: `${years.length} years aligned by month · current year highlighted`,
  });

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        title: { display: false },
        subtitle: { display: false },
        legend: { display: (_hszCtx().canvasId !== 'ho-fs-chart'), position: 'top', align: 'end', labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 12, boxHeight: 2, padding: 10 } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` } },
      },
    },
  });
}

// ── HSZ · YoY · Weekly: weekly averages aligned across years (ISO week 1..53) ──
// Question business: "Comment ce profil hebdomadaire se compare-t-il à l'année dernière ?"
// One point per ISO week. Up to 53 X values. Current vs Y-1 vs Y-2 lines + historical envelope.
function _hszRenderWeeklyYoY(filtered, zone, summary) {
  const color = zoneColor(zone);
  const all = summary.zones[zone] || [];
  if (!all.length) return _hszPlaceholder('No weekly data');

  // ISO week number helper (Mon=1..Sun=7, week 01 contains the first Thursday of the year)
  function isoWeek(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: String(d.getUTCFullYear()), week: weekNo };
  }

  // Aggregate average prices per ISO week per year
  // byYear[year] = Array(53) of weekly avgs (W01..W53), W00 unused
  const byYear = {};
  const counters = {};
  all.forEach(e => {
    if (e.avg == null) return;
    const { year, week } = isoWeek(e.d);
    if (!byYear[year]) {
      byYear[year] = Array(54).fill(null);
      counters[year] = Array(54).fill(0).map(() => ({ sum: 0, n: 0 }));
    }
    counters[year][week].sum += e.avg;
    counters[year][week].n   += 1;
  });
  Object.keys(byYear).forEach(y => {
    for (let w = 1; w <= 53; w++) {
      const c = counters[y][w];
      if (c.n > 0) byYear[y][w] = c.sum / c.n;
    }
  });
  const years = Object.keys(byYear).sort();
  if (years.length === 0) return _hszPlaceholder('Not enough data');

  const currentYear = years[years.length - 1];
  const priorYears = years.slice(0, -1);
  const yMinus1 = priorYears.length >= 1 ? priorYears[priorYears.length - 1] : null;
  const yMinus2 = priorYears.length >= 2 ? priorYears[priorYears.length - 2] : null;
  // Historical envelope: ALL prior years (including Y-1 and Y-2) so that the
  // Y-1/Y-2 lines never visually escape the Min–Max range — the envelope
  // represents "the historical span excluding the current year".
  const envYears = priorYears;

  // X-axis: weeks 1..53
  const labels = [];
  for (let w = 1; w <= 53; w++) labels.push('W' + String(w).padStart(2, '0'));

  // Envelope per week (P0/P100 outer + P5/P95 inner + median)
  const p0Line   = Array(53).fill(null);
  const p100Line = Array(53).fill(null);
  const p5Line   = Array(53).fill(null);
  const p95Line  = Array(53).fill(null);
  const medianLine = Array(53).fill(null);
  for (let w = 1; w <= 53; w++) {
    const vals = envYears.map(y => byYear[y][w]).filter(v => v != null);
    if (vals.length) {
      const sorted = [...vals].sort((a, b) => a - b);
      p0Line[w-1]   = sorted[0];
      p100Line[w-1] = sorted[sorted.length - 1];
      if (sorted.length < 4) {
        p5Line[w-1]  = sorted[0];
        p95Line[w-1] = sorted[sorted.length - 1];
      } else {
        p5Line[w-1]  = _percentile(sorted, 0.05);
        p95Line[w-1] = _percentile(sorted, 0.95);
      }
      medianLine[w-1] = _percentile(sorted, 0.5);
    }
  }

  // Extract year-series aligned to W01..W53
  const seriesFor = (y) => {
    if (!y) return null;
    const out = Array(53).fill(null);
    for (let w = 1; w <= 53; w++) out[w-1] = byYear[y][w];
    return out;
  };
  const curArr = seriesFor(currentYear);
  const y1Arr  = seriesFor(yMinus1);
  const y2Arr  = seriesFor(yMinus2);

  // Means for analyst banner
  const curMean = _meanIgnoreNull(curArr);
  const y1Mean  = y1Arr ? _meanIgnoreNull(y1Arr) : null;
  const y2Mean  = y2Arr ? _meanIgnoreNull(y2Arr) : null;
  const haveYoYWk = (curMean != null && y1Mean != null);
  const yoyDeltaWk = haveYoYWk ? curMean - y1Mean : null;

  // HTML title block
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Weekly`,
    title: _titleWithDescription('Weekly profile', 'Current year vs Y-1, Y-2, and historical range (Min-Max, P5-P95)'),
    subtitle: '',
  });

  // ── Bands & Y-presets ──
  const outerFill = _toRgba(color, 0.04);
  const innerFill = _toRgba(color, 0.10);
  const preset = _hszCtx().getYPreset();
  const hideBands = (preset === 'focus');
  let yMin = null, yMax = null;
  const currentLines = [
    ...(curArr || []), ...(y1Arr || []), ...(y2Arr || [])
  ].filter(v => v != null && !isNaN(v));
  if (preset === 'focus' && currentLines.length) {
    const lo = Math.min(...currentLines);
    const hi = Math.max(...currentLines);
    const pad = Math.max(5, (hi - lo) * 0.10);
    yMin = lo - pad; yMax = hi + pad;
  } else if (preset === 'standard') {
    const all95 = [...currentLines, ...p5Line.filter(v => v != null), ...p95Line.filter(v => v != null)];
    if (all95.length) {
      yMin = Math.min(...all95);
      yMax = Math.max(...all95);
      const pad = Math.max(5, (yMax - yMin) * 0.05);
      yMin -= pad; yMax += pad;
    }
  }

  const datasets = [
    // Outer Min–Max
    {
      label: 'Min–Max range', data: p100Line,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: outerFill,
      borderWidth: 0.8, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: '+1', order: 8, _bandPair: 'outer', hidden: hideBands,
    },
    {
      label: '_outer_min', data: p0Line,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'transparent',
      borderWidth: 0.8, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: false, order: 8, _bandPair: 'outer', _hideFromLegend: true, hidden: hideBands,
    },
    // Inner P5–P95
    {
      label: 'Typical range (P5–P95)', data: p95Line,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: innerFill,
      borderWidth: 1, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: '+1', order: 7, _bandPair: 'inner', hidden: hideBands,
    },
    {
      label: '_inner_min', data: p5Line,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'transparent',
      borderWidth: 1, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: false, order: 7, _bandPair: 'inner', _hideFromLegend: true, hidden: hideBands,
    },
    // Historical median
    {
      label: 'Hist median', data: medianLine,
      borderColor: 'rgba(255,255,255,0.30)', borderWidth: 1, pointRadius: 0,
      tension: 0.2, spanGaps: true, fill: false, borderDash: [2,3], order: 6,
    },
  ];
  if (yMinus2) {
    datasets.push({
      label: yMinus2, data: y2Arr,
      borderColor: 'rgba(168,125,196,0.65)', borderWidth: 1.4,
      pointRadius: 0,
      tension: 0.25, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
    });
  }
  if (yMinus1) {
    datasets.push({
      label: yMinus1, data: y1Arr,
      borderColor: 'rgba(255,255,255,0.55)', borderWidth: 1.4,
      pointRadius: 0,
      tension: 0.25, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
    });
  }
  datasets.push({
    label: currentYear + ' (current)', data: curArr,
    borderColor: color, borderWidth: 2.4,
    pointRadius: 0,
    tension: 0.25, spanGaps: true, fill: false, order: 1,
  });

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        title: { display: false },
        subtitle: { display: false },
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 14, boxHeight: 2, padding: 12,
            filter: (item, chartData) => {
              const ds = chartData.datasets[item.datasetIndex];
              return !ds || !ds._hideFromLegend;
            },
          },
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const idx = legendItem.datasetIndex;
            const ds = ci.data.datasets[idx];
            if (ds && ds._bandPair) {
              const pair = ds._bandPair;
              const newVisible = !ci.isDatasetVisible(idx);
              ci.data.datasets.forEach((d, i) => {
                if (d._bandPair === pair) ci.setDatasetVisibility(i, newVisible);
              });
            } else {
              ci.setDatasetVisibility(idx, !ci.isDatasetVisible(idx));
            }
            ci.update();
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          filter: (item) => {
            const ds = item.chart.data.datasets[item.datasetIndex];
            return !ds || !ds._hideFromLegend;
          },
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          },
        },
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.12)',
              borderColor: 'rgba(20,211,169,0.5)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        if (evt.native && evt.native.detail === 2) {
          const ch = HIST.charts[_hszCtx().canvasId];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 14 },
        },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          min: yMin != null ? yMin : undefined,
          max: yMax != null ? yMax : undefined,
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    },
  });
  if (haveYoYWk) {
    _renderAnalystBanner(_buildAnalystBanner('yoyWeekly', {
      curMean, prevMean: y1Mean, delta: yoyDeltaWk,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · Seasonal: monthly P5-P95 + Min-Max envelopes + median + Y-1, Y-2, current ──
function _hszRenderSeasonal(filtered, zone, summary) {
  const color = zoneColor(zone);
  const all = summary.zones[zone] || [];
  if (!all.length) return _hszPlaceholder('No seasonal data');

  // Pivot: monthly avg per year { year: [12 monthly avgs] }
  const byYM = {};
  all.forEach(e => {
    if (e.avg == null) return;
    const ymKey = e.d.slice(0, 7);
    if (!byYM[ymKey]) byYM[ymKey] = [];
    byYM[ymKey].push(e.avg);
  });
  const byYear = {};
  Object.keys(byYM).forEach(ymKey => {
    const [y, m] = ymKey.split('-');
    if (!byYear[y]) byYear[y] = Array(12).fill(null);
    byYear[y][parseInt(m) - 1] = _meanIgnoreNull(byYM[ymKey]);
  });
  const years = Object.keys(byYear).sort();
  if (years.length === 0) return _hszPlaceholder('No seasonal data');

  const currentYear = years[years.length - 1];
  const priorYears = years.slice(0, -1);
  // Y-1 and Y-2 (the 2 most recent past years; might not exist if too few years)
  const yMinus1 = priorYears.length >= 1 ? priorYears[priorYears.length - 1] : null;
  const yMinus2 = priorYears.length >= 2 ? priorYears[priorYears.length - 2] : null;
  // Historical envelope: ALL prior years (including Y-1 and Y-2) so that the
  // Y-1/Y-2 lines never visually escape the Min–Max range — the envelope
  // represents "the historical span excluding the current year".
  const envYears = priorYears;

  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build envelopes per month: P0/P100 (absolute Min/Max) AND P5/P95 (typical)
  const p0Line   = Array(12).fill(null);
  const p100Line = Array(12).fill(null);
  const p5Line   = Array(12).fill(null);
  const p95Line  = Array(12).fill(null);
  const medianLine = Array(12).fill(null);
  for (let m = 0; m < 12; m++) {
    const vals = envYears.map(y => byYear[y][m]).filter(v => v != null);
    if (vals.length) {
      const sorted = [...vals].sort((a, b) => a - b);
      p0Line[m]   = sorted[0];
      p100Line[m] = sorted[sorted.length - 1];
      if (sorted.length < 4) {
        p5Line[m]  = sorted[0];
        p95Line[m] = sorted[sorted.length - 1];
      } else {
        p5Line[m]  = _percentile(sorted, 0.05);
        p95Line[m] = _percentile(sorted, 0.95);
      }
      medianLine[m] = _percentile(sorted, 0.5);
    }
  }

  // Mean of current year for subtitle
  const curMean = _meanIgnoreNull(byYear[currentYear]);
  const y1Mean  = yMinus1 ? _meanIgnoreNull(byYear[yMinus1]) : null;
  const y2Mean  = yMinus2 ? _meanIgnoreNull(byYear[yMinus2]) : null;

  // ── Bands ──
  const outerFill = _toRgba(color, 0.04);
  const innerFill = _toRgba(color, 0.10);

  // ── Y-preset handling (Focus / Standard / All) ──
  const preset = _hszCtx().getYPreset();
  const hideBands = (preset === 'focus');
  let yMin = null, yMax = null;
  const currentLines = [
    ...(byYear[currentYear] || []),
    ...(yMinus1 ? byYear[yMinus1] : []),
    ...(yMinus2 ? byYear[yMinus2] : []),
  ].filter(v => v != null && !isNaN(v));
  if (preset === 'focus' && currentLines.length) {
    const lo = Math.min(...currentLines);
    const hi = Math.max(...currentLines);
    const pad = Math.max(5, (hi - lo) * 0.10);
    yMin = lo - pad;
    yMax = hi + pad;
  } else if (preset === 'standard') {
    const all95 = [...currentLines, ...p5Line.filter(v => v != null), ...p95Line.filter(v => v != null)];
    if (all95.length) {
      yMin = Math.min(...all95);
      yMax = Math.max(...all95);
      const pad = Math.max(5, (yMax - yMin) * 0.05);
      yMin -= pad; yMax += pad;
    }
  }

  // Analyst banner data
  const haveYoYMo = (curMean != null && y1Mean != null);
  const yoyDeltaMo = haveYoYMo ? curMean - y1Mean : null;

  // HTML title block (hybrid style)
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Monthly`,
    title: _titleWithDescription('Monthly profile', 'Current year vs Y-1, Y-2, and historical range (Min-Max, P5-P95)'),
    subtitle: '',
  });

  const datasets = [
    // ── Outer band: Min–Max absolute (P0–P100) ──
    {
      label: 'Min–Max range', data: p100Line,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: outerFill,
      borderWidth: 0.8, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: '+1', order: 8, _bandPair: 'outer', hidden: hideBands,
    },
    {
      label: '_outer_min', data: p0Line,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'transparent',
      borderWidth: 0.8, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: false, order: 8, _bandPair: 'outer', _hideFromLegend: true, hidden: hideBands,
    },
    // ── Inner band: typical regime (P5–P95) ──
    {
      label: 'Typical range (P5–P95)', data: p95Line,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: innerFill,
      borderWidth: 1, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: '+1', order: 7, _bandPair: 'inner', hidden: hideBands,
    },
    {
      label: '_inner_min', data: p5Line,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'transparent',
      borderWidth: 1, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: false, order: 7, _bandPair: 'inner', _hideFromLegend: true, hidden: hideBands,
    },
    // ── Historical median ──
    {
      label: 'Hist median', data: medianLine,
      borderColor: 'rgba(255,255,255,0.30)', borderWidth: 1, pointRadius: 0,
      tension: 0.2, spanGaps: true, fill: false, borderDash: [2,3], order: 6,
    },
  ];

  // ── Y-2 — fine, dashed, subordinate ──
  if (yMinus2) {
    datasets.push({
      label: yMinus2,
      data: byYear[yMinus2],
      borderColor: 'rgba(168,125,196,0.60)',
      borderWidth: 1.4, pointRadius: 0,
      tension: 0.25, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
    });
  }
  // ── Y-1 — fine, dashed, subordinate ──
  if (yMinus1) {
    datasets.push({
      label: yMinus1,
      data: byYear[yMinus1],
      borderColor: 'rgba(255,255,255,0.55)',
      borderWidth: 1.4, pointRadius: 0,
      tension: 0.25, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
    });
  }
  // ── Current — the star: thick + saturated zone colour ──
  datasets.push({
    label: currentYear + ' (current)',
    data: byYear[currentYear],
    borderColor: color,
    borderWidth: 2.4, pointRadius: 0,
    tension: 0.25, spanGaps: true, fill: false, order: 1,
  });

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        title: { display: false },
        subtitle: { display: false },
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 14, boxHeight: 2, padding: 12,
            filter: (item, chartData) => {
              const ds = chartData.datasets[item.datasetIndex];
              return !ds || !ds._hideFromLegend;
            },
          },
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const idx = legendItem.datasetIndex;
            const ds = ci.data.datasets[idx];
            if (ds && ds._bandPair) {
              const pair = ds._bandPair;
              const newVisible = !ci.isDatasetVisible(idx);
              ci.data.datasets.forEach((d, i) => {
                if (d._bandPair === pair) ci.setDatasetVisibility(i, newVisible);
              });
            } else {
              ci.setDatasetVisibility(idx, !ci.isDatasetVisible(idx));
            }
            ci.update();
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          filter: (item) => {
            const ds = item.chart.data.datasets[item.datasetIndex];
            return !ds || !ds._hideFromLegend;
          },
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          },
        },
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.12)',
              borderColor: 'rgba(20,211,169,0.5)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        if (evt.native && evt.native.detail === 2) {
          const ch = HIST.charts[_hszCtx().canvasId];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } } },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          min: yMin != null ? yMin : undefined,
          max: yMax != null ? yMax : undefined,
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    },
  });
  if (haveYoYMo) {
    _renderAnalystBanner(_buildAnalystBanner('yoyMonthly', {
      curMean, prevMean: y1Mean, delta: yoyDeltaMo,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · Hourly: intraday profile, toggleable Quarter / YoY ──
// Quarter mode: 4 mini-charts (Q1..Q4) each with 24h profile + Y-1 + Y-2 ghosts.
// YoY mode: 1 chart with 24h profile of the whole period vs Y-1 / Y-2.
// Data source: summary.intraday[zone][year] = {Q1: [24h], Q2: [...], ..., all: [...]}
async function _hszRenderHourly(filtered, zone) {
  if (!filtered.length) return _hszPlaceholder('No data');

  const summary = await fetchSummary();
  const intraday = summary?.intraday?.[zone];
  if (!intraday) {
    return _hszPlaceholder('No intraday profile data — run enrich_summary.py to populate it');
  }

  const mode = _hszCtx().getHourlyMode() || 'quarter';

  // Render the mode toggle UI in the chart area header (above the canvas/grid)
  _hszInjectHourlyToggle(mode);

  if (mode === 'quarter') {
    _hszRenderHourlyQuarter(zone, intraday);
  } else {
    _hszRenderHourlyYoY(zone, intraday, summary);
  }
}

// Legacy: previously injected a "By quarter / YoY global" toggle into the
// actions row. NOW SUPERSEDED by the YoY sub-menu pills (rendered by
// _hszRenderYoYSubmenu when on YoY tab with Hourly sub-mode). This stub stays
// for back-compat but does nothing — the slot remains hidden.
function _hszInjectHourlyToggle(_mode) {
  return;
}

// Cleanup helper: hide toggle slot
function _hszHideHourlyToggle() {
  ['ho-detail-toggle-slot', 'ho-fs-toggle-slot'].forEach(id => {
    const s = document.getElementById(id);
    if (s) { s.style.display = 'none'; s.innerHTML = ''; }
  });
}

// Determine "current year" and "Y-1/Y-2" years from the intraday data
// based on the current filter window's last date if possible.
function _hszPickIntradayYears(intraday) {
  const years = Object.keys(intraday).filter(k => /^\d{4}$/.test(k)).sort();
  if (!years.length) return { cur: null, n1: null, n2: null };
  const cur = years[years.length - 1];
  const n1 = years.length >= 2 ? years[years.length - 2] : null;
  const n2 = years.length >= 3 ? years[years.length - 3] : null;
  return { cur, n1, n2 };
}

// Quarter mode: 4 mini-charts grid (Q1..Q4)
function _hszRenderHourlyQuarter(zone, intraday) {
  const color = zoneColor(zone);
  const { cur, n1, n2 } = _hszPickIntradayYears(intraday);
  if (!cur) return _hszPlaceholder('No intraday data');

  // Destroy any existing single chart on the main canvas
  if (HIST.charts[_hszCtx().canvasId]) {
    HIST.charts[_hszCtx().canvasId].destroy();
    delete HIST.charts[_hszCtx().canvasId];
  }
  const canvas = document.getElementById(_hszCtx().canvasId);
  if (!canvas) return;
  canvas.style.display = 'none';
  const wrap = canvas.parentNode;

  // Clean previous grid
  const oldGrid = document.getElementById(_hszCtx().togglePrefix + '-quarter-grid');
  if (oldGrid) oldGrid.remove();
  // Clean previous global legend
  const oldLg = document.getElementById(_hszCtx().togglePrefix + '-quarter-legend');
  if (oldLg) oldLg.remove();

  // HTML title block (hybrid F)
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Hourly · By quarter`,
    title: _titleWithDescription('Intraday 24h profile by quarter', 'Q1, Q2, Q3, Q4 side-by-side — current year vs Y-1 and Y-2'),
    subtitle: `Each panel shows the average price for every hour of day, aggregated over one quarter. Current ${cur}${n1 ? ', Y-1 ' + n1 : ''}${n2 ? ', Y-2 ' + n2 : ''}.`,
  });

  // Global legend bar — inserted AFTER the wrap (canvas container) so it doesn't
  // get clipped by wrap's fixed 340px height. The neg-prices banner sits after.
  const legendEl = document.createElement('div');
  legendEl.id = _hszCtx().togglePrefix + '-quarter-legend';
  legendEl.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:14px;font-size:10px;color:var(--tx3);margin:8px 0;font-family:\'JetBrains Mono\',monospace;flex-wrap:wrap';
  legendEl.innerHTML = `
    <span><span style="display:inline-block;width:14px;height:2.4px;background:${color};vertical-align:middle;margin-right:5px"></span>${cur} (current)</span>
    ${n1 ? `<span><span style="display:inline-block;width:14px;height:1px;border-top:1.4px dashed rgba(255,255,255,0.55);vertical-align:middle;margin-right:5px"></span>${n1} (Y-1)</span>` : ''}
    ${n2 ? `<span><span style="display:inline-block;width:14px;height:1px;border-top:1.4px dashed rgba(168,125,196,0.7);vertical-align:middle;margin-right:5px"></span>${n2} (Y-2)</span>` : ''}
  `;
  // Place the legend right after the canvas wrap (so before the rest of detail content)
  if (wrap.nextSibling) wrap.parentNode.insertBefore(legendEl, wrap.nextSibling);
  else wrap.parentNode.appendChild(legendEl);

  // 2×2 grid — placed AFTER the legend (i.e. AFTER the canvas wrap)
  const grid = document.createElement('div');
  grid.id = _hszCtx().togglePrefix + '-quarter-grid';
  // Equal-height rows: each cell occupies exactly 1fr of the grid's height so
  // empty quarters (e.g. Q3/Q4 when current year hasn't reached them yet)
  // still match the height of populated ones.
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:14px;height:520px;margin-bottom:8px';

  const Qmeta = [
    { id: 'Q1', label: 'Q1 · Winter', sub: 'Jan-Mar', color: '#A87DC4' },
    { id: 'Q2', label: 'Q2 · Spring', sub: 'Apr-Jun', color: '#14D3A9' },
    { id: 'Q3', label: 'Q3 · Summer', sub: 'Jul-Sep', color: '#FBBF24' },
    { id: 'Q4', label: 'Q4 · Autumn', sub: 'Oct-Dec', color: '#ED6965' },
  ];

  Qmeta.forEach(q => {
    const cell = document.createElement('div');
    cell.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid var(--bd);border-radius:6px;padding:10px;display:flex;flex-direction:column;min-height:0;overflow:hidden';
    cell.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;flex-shrink:0">
        <span style="font-size:9px;font-weight:600;color:${q.color};font-family:'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase">${q.label} <span style="color:var(--tx3);font-weight:500">${q.sub}</span></span>
        <span id="hsz-q-meta-${q.id}" style="font-size:9px;color:var(--tx3);font-family:'JetBrains Mono',monospace"></span>
      </div>
      <div style="flex:1;position:relative;min-height:0">
        <canvas id="hsz-q-canvas-${q.id}"></canvas>
      </div>
    `;
    grid.appendChild(cell);
  });

  // Place the grid right after the legend (i.e. AFTER the canvas wrap)
  if (legendEl.nextSibling) legendEl.parentNode.insertBefore(grid, legendEl.nextSibling);
  else legendEl.parentNode.appendChild(grid);

  // Also hide the canvas wrap entirely (saves 340px of empty space)
  wrap.style.display = 'none';

  // Y-preset (shared across all 4 quarters)
  const preset = _hszCtx().getYPreset();

  const hours = Array.from({length: 24}, (_, i) => `${String(i).padStart(2,'0')}h`);
  const quarterStats = {};   // for analyst banner
  Qmeta.forEach(q => {
    const curRaw = intraday[cur]?.[q.id];
    const n1Raw  = n1 ? intraday[n1]?.[q.id] : null;
    const n2Raw  = n2 ? intraday[n2]?.[q.id] : null;

    const curProfile = _hszSanitiseHourlyProfile(curRaw);
    const n1Profile  = _hszSanitiseHourlyProfile(n1Raw);
    const n2Profile  = _hszSanitiseHourlyProfile(n2Raw);

    // Compute quarterly peak / floor / mean (current year) for analyst banner
    if (curProfile && curProfile.some(v => v != null)) {
      let pv = null, ph = null, fv = null, fh = null;
      for (let h = 0; h < 24; h++) {
        const v = curProfile[h];
        if (v == null || isNaN(v)) continue;
        if (pv == null || v > pv) { pv = v; ph = h; }
        if (fv == null || v < fv) { fv = v; fh = h; }
      }
      quarterStats[q.id] = {
        label: q.label, peakVal: pv, peakHour: ph, floorVal: fv, floorHour: fh,
        mean: _meanIgnoreNull(curProfile),
      };
    }

    const cellMeta = document.getElementById(`hsz-q-meta-${q.id}`);

    // If current is empty but Y-1 or Y-2 have data, render those (typical
    // case: current=2026, Q3/Q4 not happened yet but historical context useful).
    const hasAny = (curProfile && curProfile.some(v => v != null))
                 || (n1Profile && n1Profile.some(v => v != null))
                 || (n2Profile && n2Profile.some(v => v != null));
    if (!hasAny) {
      if (cellMeta) cellMeta.textContent = 'no data';
      return;
    }

    if (curProfile && curProfile.some(v => v != null)) {
      const curMean = _meanIgnoreNull(curProfile);
      if (cellMeta) cellMeta.textContent = `${cur} avg ${curMean != null ? curMean.toFixed(1) : '--'} €/MWh`;
    } else if (cellMeta) {
      cellMeta.textContent = `${cur} not in period · showing history`;
      cellMeta.style.color = 'var(--tx3)';
    }

    const datasets = [];
    if (n2Profile) {
      datasets.push({
        label: n2 + ' (Y-2)', data: n2Profile,
        borderColor: 'rgba(168,125,196,0.65)', borderWidth: 1.4,
        pointRadius: 0, tension: 0.25, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
      });
    }
    if (n1Profile) {
      datasets.push({
        label: n1 + ' (Y-1)', data: n1Profile,
        borderColor: 'rgba(255,255,255,0.55)', borderWidth: 1.4,
        pointRadius: 0, tension: 0.25, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
      });
    }
    if (curProfile && curProfile.some(v => v != null)) {
      datasets.push({
        label: cur + ' (current)', data: curProfile,
        borderColor: q.color, borderWidth: 2.4,
        pointRadius: 0, tension: 0.3, spanGaps: true, fill: false, order: 1,
      });
    }

    // ── Y-presets: clip Y axis (per mini-chart) ──
    let yMin = null, yMax = null;
    const allVals = [];
    datasets.forEach(d => d.data.forEach(v => { if (v != null && !isNaN(v)) allVals.push(v); }));
    if (preset === 'focus' && curProfile && curProfile.some(v => v != null)) {
      // Focus on current only — but include Y-1/Y-2 mean line
      const focusVals = [];
      datasets.forEach(d => d.data.forEach(v => { if (v != null && !isNaN(v)) focusVals.push(v); }));
      if (focusVals.length) {
        const lo = Math.min(...focusVals);
        const hi = Math.max(...focusVals);
        const pad = Math.max(5, (hi - lo) * 0.10);
        yMin = lo - pad;
        yMax = hi + pad;
      }
    }
    // Standard / All let Chart.js auto-fit

    mkHistChart(`hsz-q-canvas-${q.id}`, {
      type: 'line',
      data: { labels: hours, datasets },
      options: {
        ...baseOptions(''),
        plugins: {
          title: { display: false },
          subtitle: { display: false },
          legend: { display: false },
          tooltip: {
            mode: 'index', intersect: false,
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` },
          },
          zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
            zoom: {
              drag: {
                enabled: true,
                backgroundColor: 'rgba(20,211,169,0.12)',
                borderColor: 'rgba(20,211,169,0.5)',
                borderWidth: 1,
              },
              wheel: { enabled: false },
              pinch: { enabled: true },
              mode: 'xy',
            },
            pan: { enabled: false },
            limits: { y: { min: 'original', max: 'original' } },
          } : {},
        },
        onClick: (evt) => {
          if (evt.native && evt.native.detail === 2) {
            const ch = HIST.charts[`hsz-q-canvas-${q.id}`];
            if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
          }
        },
        scales: {
          x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 9 }, maxTicksLimit: 8 } },
          y: {
            grid: { color: _HIST_GRID },
            ticks: { color: _HIST_TX3, font: { size: 9 } },
            min: yMin != null ? yMin : undefined,
            max: yMax != null ? yMax : undefined,
          },
        },
      },
    });
  });

  // Analyst banner Quarter — find strongest peak / weakest floor across quarters
  const qWith = Object.values(quarterStats).filter(s => s.peakVal != null && s.floorVal != null);
  if (qWith.length) {
    const strongest = qWith.reduce((a, b) => (a.peakVal > b.peakVal ? a : b));
    const weakest   = qWith.reduce((a, b) => (a.floorVal < b.floorVal ? a : b));
    const html = _buildAnalystBanner('yoyHourlyQuarter', {
      strongestQuarterLabel: strongest.label,
      strongestPeakVal: strongest.peakVal,
      strongestPeakHour: strongest.peakHour,
      weakestQuarterLabel: weakest.label,
      weakestFloorVal: weakest.floorVal,
      weakestFloorHour: weakest.floorHour,
    });
    if (html) {
      // Insert after the grid
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const banner = tmp.firstElementChild;
      if (banner && grid.nextSibling) grid.parentNode.insertBefore(banner, grid.nextSibling);
      else if (banner) grid.parentNode.appendChild(banner);
    }
  }
}

// YoY mode: single chart with 24h profile of period vs Y-1 / Y-2
function _hszRenderHourlyYoY(zone, intraday, summary) {
  const color = zoneColor(zone);
  const { cur, n1, n2 } = _hszPickIntradayYears(intraday);
  if (!cur) return _hszPlaceholder('No intraday data');

  // Remove the quarter grid + global legend if present, show the main canvas
  const oldGrid = document.getElementById(_hszCtx().togglePrefix + '-quarter-grid');
  if (oldGrid) oldGrid.remove();
  const oldLg = document.getElementById(_hszCtx().togglePrefix + '-quarter-legend');
  if (oldLg) oldLg.remove();
  const canvas = document.getElementById(_hszCtx().canvasId);
  if (canvas) {
    canvas.style.display = '';
    if (canvas.parentNode) canvas.parentNode.style.display = '';
  }

  // Sanitise sparse-data years (e.g. 2024 with 1 point every 2h → interpolated)
  const curProfile = _hszSanitiseHourlyProfile(intraday[cur]?.all);
  const n1Profile  = n1 ? _hszSanitiseHourlyProfile(intraday[n1]?.all) : null;
  const n2Profile  = n2 ? _hszSanitiseHourlyProfile(intraday[n2]?.all) : null;

  if (!curProfile) return _hszPlaceholder('No "all" intraday profile for the current year');

  // ── Historical distribution (P0-P100 outer + P5-P95 inner + median) ──
  // Computed by enrich_summary.py on all years EXCEPT current.
  // If missing (older summary.json), fall back to no-bands mode.
  const dist = summary?.intradayDist?.[zone];
  const hasBands = !!(dist && Array.isArray(dist.p0) && dist.p0.length === 24);

  const hours = Array.from({length: 24}, (_, i) => `${String(i).padStart(2,'0')}h`);

  // ── Y-preset (compute first so we can pass hideBands to datasets) ──
  const preset = _hszCtx().getYPreset();
  const hideBands = (preset === 'focus');

  // Convert zone color to rgba for band fills
  const outerFill = _toRgba(color, 0.04);
  const innerFill = _toRgba(color, 0.10);

  const datasets = [];

  if (hasBands) {
    // Outer Min–Max (P0–P100)
    datasets.push({
      label: 'Min–Max range', data: dist.p100,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: outerFill,
      borderWidth: 0.8, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: '+1', order: 8, _bandPair: 'outer', hidden: hideBands,
    });
    datasets.push({
      label: '_outer_min', data: dist.p0,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'transparent',
      borderWidth: 0.8, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: false, order: 8, _bandPair: 'outer', _hideFromLegend: true, hidden: hideBands,
    });
    // Inner P5–P95
    datasets.push({
      label: 'Typical range (P5–P95)', data: dist.p95,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: innerFill,
      borderWidth: 1, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: '+1', order: 7, _bandPair: 'inner', hidden: hideBands,
    });
    datasets.push({
      label: '_inner_min', data: dist.p5,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'transparent',
      borderWidth: 1, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: false, order: 7, _bandPair: 'inner', _hideFromLegend: true, hidden: hideBands,
    });
    // Historical median
    datasets.push({
      label: 'Hist median', data: dist.p50,
      borderColor: 'rgba(255,255,255,0.30)', borderWidth: 1, pointRadius: 0,
      tension: 0.2, spanGaps: true, fill: false, borderDash: [2,3], order: 6,
    });
  }

  if (n2Profile) {
    datasets.push({
      label: n2 + ' (Y-2)', data: n2Profile,
      borderColor: 'rgba(168,125,196,0.65)', borderWidth: 1.4,
      pointRadius: 0, tension: 0.25, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
    });
  }
  if (n1Profile) {
    datasets.push({
      label: n1 + ' (Y-1)', data: n1Profile,
      borderColor: 'rgba(255,255,255,0.55)', borderWidth: 1.4,
      pointRadius: 0, tension: 0.25, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
    });
  }
  datasets.push({
    label: cur + ' (current)', data: curProfile,
    borderColor: color, borderWidth: 2.4,
    pointRadius: 0, tension: 0.3, spanGaps: true, fill: false, order: 1,
  });

  // Stats for analyst banner: peak hour, floor hour, peak val, floor val for current and prev year
  const curMean = _meanIgnoreNull(curProfile);
  const n1Mean  = n1Profile ? _meanIgnoreNull(n1Profile) : null;
  const n2Mean  = n2Profile ? _meanIgnoreNull(n2Profile) : null;
  let peakHour = null, peakVal = null, floorHour = null, floorVal = null;
  let prevPeakHour = null, prevFloorVal = null;
  if (curProfile && curProfile.length === 24) {
    for (let h = 0; h < 24; h++) {
      const v = curProfile[h];
      if (v == null || isNaN(v)) continue;
      if (peakVal == null || v > peakVal) { peakVal = v; peakHour = h; }
      if (floorVal == null || v < floorVal) { floorVal = v; floorHour = h; }
    }
  }
  if (n1Profile && n1Profile.length === 24) {
    let pV = null, fV = null;
    for (let h = 0; h < 24; h++) {
      const v = n1Profile[h];
      if (v == null || isNaN(v)) continue;
      if (pV == null || v > pV) { pV = v; prevPeakHour = h; }
      if (fV == null || v < fV) { fV = v; prevFloorVal = v; }
    }
  }

  // HTML title block (hybrid F)
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Hourly · Annual average`,
    title: _titleWithDescription('Intraday 24h profile', 'Average price by hour of day — current year vs Y-1 and Y-2'),
    subtitle: '',
  });

  // Y-preset: focus uses current+Y-1+Y-2 lines (NOT bands which would dominate)
  let yMin = null, yMax = null;
  if (preset === 'focus') {
    const focusVals = [];
    [curProfile, n1Profile, n2Profile].forEach(p => {
      if (p) p.forEach(v => { if (v != null && !isNaN(v)) focusVals.push(v); });
    });
    if (focusVals.length) {
      const lo = Math.min(...focusVals);
      const hi = Math.max(...focusVals);
      const pad = Math.max(5, (hi - lo) * 0.10);
      yMin = lo - pad;
      yMax = hi + pad;
    }
  } else if (preset === 'standard' && hasBands) {
    // Standard: include P5-P95 band
    const vals = [];
    [curProfile, n1Profile, n2Profile].forEach(p => {
      if (p) p.forEach(v => { if (v != null && !isNaN(v)) vals.push(v); });
    });
    dist.p5.forEach(v => { if (v != null) vals.push(v); });
    dist.p95.forEach(v => { if (v != null) vals.push(v); });
    if (vals.length) {
      yMin = Math.min(...vals);
      yMax = Math.max(...vals);
      const pad = Math.max(5, (yMax - yMin) * 0.05);
      yMin -= pad; yMax += pad;
    }
  }

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: { labels: hours, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        title: { display: false },
        subtitle: { display: false },
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 14, boxHeight: 2, padding: 12,
            // Hide the synthetic "lower bound" duplicate entries from the legend
            filter: (item, chartData) => {
              const ds = chartData.datasets[item.datasetIndex];
              return !ds || !ds._hideFromLegend;
            },
          },
          // Clicking a band entry toggles BOTH members of the pair
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const idx = legendItem.datasetIndex;
            const ds = ci.data.datasets[idx];
            if (ds && ds._bandPair) {
              const pair = ds._bandPair;
              const newVisible = !ci.isDatasetVisible(idx);
              ci.data.datasets.forEach((d, i) => {
                if (d._bandPair === pair) ci.setDatasetVisibility(i, newVisible);
              });
            } else {
              ci.setDatasetVisibility(idx, !ci.isDatasetVisible(idx));
            }
            ci.update();
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          // Filter out the synthetic duplicate band lines from the tooltip
          filter: (item) => {
            const ds = item.chart.data.datasets[item.datasetIndex];
            return !ds || !ds._hideFromLegend;
          },
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` },
        },
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.12)',
              borderColor: 'rgba(20,211,169,0.5)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        if (evt.native && evt.native.detail === 2) {
          const ch = HIST.charts[_hszCtx().canvasId];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } } },
        y: {
          grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } },
          min: yMin != null ? yMin : undefined,
          max: yMax != null ? yMax : undefined,
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    },
  });
  if (peakHour != null && floorHour != null && peakVal != null && floorVal != null) {
    _renderAnalystBanner(_buildAnalystBanner('yoyHourlyAnnual', {
      peakHour, peakVal, floorHour, floorVal, prevFloorVal, prevPeakHour,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · Weekly: avg per day-of-week (Mon..Sun) ──
// ── HSZ · Weekly: box plot per day-of-week (P10/P25/P50/P75/P90) ──
// Chart.js core doesn't natively support box plots — we render it as a stack of:
//  - floating bar dataset for the IQR (P25 to P75)
//  - line overlays for whiskers (P10/P90) and outliers (min/max)
//  - thick median line via a bar dataset
function _hszRenderWeekly(filtered, zone) {
  if (!filtered.length) return _hszPlaceholder('No data');

  // Group avg values by day-of-week (Mon=0..Sun=6)
  const byDow = Array.from({length: 7}, () => []);
  filtered.forEach(e => {
    if (e.avg == null) return;
    const dt = new Date(e.d);
    let dow = dt.getUTCDay();
    dow = (dow + 6) % 7;
    byDow[dow].push(e.avg);
  });

  const stats = byDow.map(arr => _boxStats(arr));
  if (stats.every(s => s == null)) return _hszPlaceholder('Not enough data');

  const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  // ── Compute summary stats for HTML title block ──
  const wdMean = _meanIgnoreNull([].concat(byDow[0], byDow[1], byDow[2], byDow[3], byDow[4]));
  const weMean = _meanIgnoreNull([].concat(byDow[5], byDow[6]));
  const periodValues = filtered.map(e => e.avg).filter(v => v != null);
  const periodMedian = periodValues.length ? _percentile([...periodValues].sort((a,b)=>a-b), 0.5) : null;

  // Find cheapest / most expensive day by median
  let cheapestIdx = null, mostExpIdx = null;
  let cheapestMed = Infinity, mostExpMed = -Infinity;
  stats.forEach((s, i) => {
    if (!s) return;
    if (s.p50 < cheapestMed) { cheapestMed = s.p50; cheapestIdx = i; }
    if (s.p50 > mostExpMed)  { mostExpMed  = s.p50; mostExpIdx  = i; }
  });

  // Subtitle removed: analyst banner under chart conveys the analysis
  const totalObs = stats.reduce((sum, s) => sum + (s ? s.n : 0), 0);

  _setHoTitle({
    eyebrow: `Prices · Weekday · ${zone} · ${totalObs} days observed`,
    title: _titleWithDescription('Price distribution by day of the week', 'Boxplot Mon → Sun · median, P25-P75, P5-P95, min/max'),
    subtitle: '',
  });

  // ── Y range ──
  const validStats = stats.filter(s => s);
  const p90Max = Math.max(...validStats.map(s => s.p90));
  const p10Min = Math.min(...validStats.map(s => s.p10));
  const dataMax = Math.max(...validStats.map(s => s.max));
  const dataMin = Math.min(...validStats.map(s => s.min));
  const yTop = (dataMax > p90Max * 1.5) ? Math.ceil(p90Max * 1.4 / 10) * 10 : Math.ceil(dataMax * 1.05 / 10) * 10;
  const yBot = (dataMin < p10Min * 0.5 || dataMin < 0) ? Math.floor(Math.min(dataMin * 1.05, p10Min - Math.abs(p10Min) * 0.2) / 10) * 10 : Math.floor(Math.max(0, dataMin - Math.abs(dataMin) * 0.05) / 10) * 10;

  // ── Colour ramp by price (gradient green→amber→red across median ranking) ──
  // Sort days by p50, assign colours: cheapest=green, most expensive=red
  const orderedByMed = stats
    .map((s, i) => ({ s, i }))
    .filter(o => o.s)
    .sort((a, b) => a.s.p50 - b.s.p50);
  const colourByIdx = Array(7).fill(null);
  orderedByMed.forEach((o, rank) => {
    const t = orderedByMed.length === 1 ? 0.5 : rank / (orderedByMed.length - 1);
    // 3-stop gradient: green #14D3A9 → amber #E88728 → red #ED6965
    let r, g, b;
    if (t < 0.5) {
      const k = t * 2;
      r = Math.round(20  + (232 - 20)  * k);
      g = Math.round(211 + (135 - 211) * k);
      b = Math.round(169 + (40  - 169) * k);
    } else {
      const k = (t - 0.5) * 2;
      r = Math.round(232 + (237 - 232) * k);
      g = Math.round(135 + (105 - 135) * k);
      b = Math.round(40  + (101 - 40)  * k);
    }
    colourByIdx[o.i] = `rgb(${r},${g},${b})`;
  });

  // Median line color (same family as the box for visual link)
  const fillForBox = (idx, alpha) => {
    const c = colourByIdx[idx] || 'rgba(255,255,255,0.5)';
    const m = c.match(/rgb\((\d+),(\d+),(\d+)\)/);
    if (!m) return c;
    return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
  };

  // ── Custom plugin: render box plots + weekend background tint + period median ──
  const boxPlotPlugin = {
    id: 'boxPlot',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      const yScale = scales.y;

      // 1. Tinted background for weekend (Sat = idx 5, Sun = idx 6)
      const xSatLeft  = xScale.getPixelForValue(5) - (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2;
      const xSunRight = xScale.getPixelForValue(6) + (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2;
      ctx.fillStyle = 'rgba(168,125,196,0.06)';
      ctx.fillRect(xSatLeft, chartArea.top, xSunRight - xSatLeft, chartArea.bottom - chartArea.top);

      // 2. Vertical separator between Fri and Sat
      const xSepX = xScale.getPixelForValue(5) - (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xSepX, chartArea.top);
      ctx.lineTo(xSepX, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      // "WEEKEND" label at top of tinted zone
      ctx.fillStyle = 'rgba(168,125,196,0.7)';
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('WEEKEND', (xSatLeft + xSunRight) / 2, chartArea.top + 2);

      // 3. Period median horizontal line
      if (periodMedian != null && periodMedian >= yScale.min && periodMedian <= yScale.max) {
        const yMed = yScale.getPixelForValue(periodMedian);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartArea.left, yMed);
        ctx.lineTo(chartArea.right, yMed);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Period median ${periodMedian.toFixed(1)}`, chartArea.right - 110, yMed - 8);
      }

      const boxHalfWidth = (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) * 0.22;

      // 4. Box plots
      stats.forEach((s, i) => {
        if (!s) return;
        const boxColor = colourByIdx[i] || '#94A8BD';
        const xPx = xScale.getPixelForValue(i);
        const yP25 = yScale.getPixelForValue(s.p25);
        const yP75 = yScale.getPixelForValue(s.p75);
        const yP10 = yScale.getPixelForValue(s.p10);
        const yP90 = yScale.getPixelForValue(s.p90);
        const yP50 = yScale.getPixelForValue(s.p50);

        // IQR box (P25-P75) — coloured by price rank
        ctx.fillStyle = fillForBox(i, 0.22);
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(xPx - boxHalfWidth, yP75, boxHalfWidth * 2, yP25 - yP75);
        ctx.fill();
        ctx.stroke();

        // Median line (white, thick, for high contrast against the colored box)
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(xPx - boxHalfWidth, yP50);
        ctx.lineTo(xPx + boxHalfWidth, yP50);
        ctx.stroke();

        // Whiskers (P10-P90) — dashed for clarity
        ctx.strokeStyle = fillForBox(i, 0.7);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(xPx, yP25);
        ctx.lineTo(xPx, yP10);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(xPx, yP75);
        ctx.lineTo(xPx, yP90);
        ctx.stroke();
        ctx.setLineDash([]);
        // Whisker caps
        const capWidth = boxHalfWidth * 0.45;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(xPx - capWidth, yP10);
        ctx.lineTo(xPx + capWidth, yP10);
        ctx.moveTo(xPx - capWidth, yP90);
        ctx.lineTo(xPx + capWidth, yP90);
        ctx.stroke();

        // Min / Max outlier dots
        if (s.min >= yScale.min && s.min <= yScale.max) {
          const yMin = yScale.getPixelForValue(s.min);
          ctx.fillStyle = _HIST_DN;
          ctx.beginPath();
          ctx.arc(xPx, yMin, 3, 0, 2 * Math.PI);
          ctx.fill();
        }
        if (s.max >= yScale.min && s.max <= yScale.max) {
          const yMax = yScale.getPixelForValue(s.max);
          ctx.fillStyle = _HIST_WARN;
          ctx.beginPath();
          ctx.arc(xPx, yMax, 3, 0, 2 * Math.PI);
          ctx.fill();
        }

        // 5. Low-confidence warning (n < 5)
        if (s.n < 5) {
          ctx.fillStyle = '#FBBF24';
          ctx.font = '600 9px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(`⚠ n=${s.n}`, xPx, chartArea.bottom + 4);
        }
      });
    },
  };

  // ── Custom HTML legend above the chart (rendered separately into a div) ──
  // Render legend by injecting into a sibling div BEFORE the canvas. We use the
  // togglePrefix to find the right container.
  const legendId = _hszCtx().togglePrefix + '-weekday-legend';
  const oldLg = document.getElementById(legendId);
  if (oldLg) oldLg.remove();
  const canvas = document.getElementById(_hszCtx().canvasId);
  if (canvas && canvas.parentNode) {
    const lg = document.createElement('div');
    lg.id = legendId;
    lg.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:14px;font-size:10px;color:var(--tx3);margin-bottom:6px;font-family:\'JetBrains Mono\',monospace;flex-wrap:wrap';
    lg.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:10px;background:linear-gradient(to right,#14D3A9,#E88728,#ED6965);border-radius:2px"></span>Box P25-P75 (color = price rank)</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:14px;height:2px;background:#fff"></span>Median (P50)</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:14px;border-top:1.4px dashed rgba(255,255,255,0.55)"></span>Whiskers P10-P90</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:14px;border-top:1px dashed rgba(255,255,255,0.5)"></span>Period median ${periodMedian != null ? periodMedian.toFixed(1) + ' €' : ''}</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:6px;height:6px;background:#FBBF24;border-radius:50%;display:inline-block"></span>Max <span style="width:6px;height:6px;background:#ED6965;border-radius:50%;display:inline-block;margin-left:4px"></span>Min</span>
    `;
    canvas.parentNode.insertBefore(lg, canvas);
  }

  mkHistChart(_hszCtx().canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Box plot',
          data: stats.map(s => s ? s.p50 : null),
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidth: 0,
          barPercentage: 0.001,
          categoryPercentage: 1,
        },
      ],
    },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        title: { display: false },
        subtitle: { display: false },
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            label: (ctx) => {
              const s = stats[ctx.dataIndex];
              if (!s) return '';
              const out = [
                ` Min:    ${s.min.toFixed(1)} €/MWh`,
                ` P10:    ${s.p10.toFixed(1)} €/MWh`,
                ` P25:    ${s.p25.toFixed(1)} €/MWh`,
                ` Median: ${s.p50.toFixed(1)} €/MWh`,
                ` P75:    ${s.p75.toFixed(1)} €/MWh`,
                ` P90:    ${s.p90.toFixed(1)} €/MWh`,
                ` Max:    ${s.max.toFixed(1)} €/MWh`,
                ` n = ${s.n}${s.n < 5 ? ' ⚠ low confidence' : ''}`,
              ];
              return out;
            },
          },
        },
        zoom: _zoomConfig({ mode: 'y' }),
      },
      layout: {
        padding: { bottom: 18 },  // room for the ⚠ n=X warning under boxes
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } } },
        y: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } }, min: yBot, max: yTop, title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } } },
      },
    },
    plugins: [boxPlotPlugin],
  });
  // Analyst banner
  if (mostExpIdx != null && cheapestIdx != null) {
    _renderAnalystBanner(_buildAnalystBanner('weekday', {
      mostExpName: labels[mostExpIdx],
      mostExpMedian: stats[mostExpIdx].p50,
      cheapestName: labels[cheapestIdx],
      cheapestMedian: stats[cheapestIdx].p50,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · Volatility: rolling σ on 7D / 30D windows ──
// ── Volatility metric state ────────────────────────────────────────────────
window._volMetric = window._volMetric || 'sigma';  // 'sigma' | 'dod' | 'range'
function _setVolMetric(m) {
  window._volMetric = m;
  // Rerender the active tab (which is volatility)
  const zone = window._HO_OPEN_ZONE;
  if (zone && window._HO_LAST_SERIES && window._HO_LAST_SERIES[zone] && _HSZ_RERENDER) {
    _HSZ_RERENDER();
  }
}
window._setVolMetric = _setVolMetric;

// Each metric's metadata: label, formula, explanation, thresholds (low/high), unit
const _VOL_METRICS = {
  sigma: {
    label: 'σ rolling',
    short: 'σ',
    unit: '€/MWh',
    formula: 'σ_N(D) = stddev of daily avg prices on [D-N+1 .. D]',
    explanation: 'Day-to-day variability over a rolling window. A high σ means daily prices diverge a lot from their mean; a low σ means they stay close to it.',
    thresholds: [15, 30],
    thresholdLabels: ['stable', 'moderate', 'volatile'],
    thresholdColors: ['rgba(20,211,169,0.4)', 'rgba(251,191,36,0.4)', 'rgba(237,105,101,0.4)'],
  },
  dod: {
    label: 'Day-on-day Δ',
    short: 'Δ DoD',
    unit: '€/MWh',
    formula: 'ΔDoD_N(D) = mean of |P_d - P_{d-1}| on [D-N+1 .. D]',
    explanation: 'Average absolute change from one day to the next. A high Δ means prices jump significantly day-to-day; a low Δ means they barely move.',
    thresholds: [10, 25],
    thresholdLabels: ['stable', 'moderate', 'volatile'],
    thresholdColors: ['rgba(20,211,169,0.4)', 'rgba(251,191,36,0.4)', 'rgba(237,105,101,0.4)'],
  },
  range: {
    label: 'Intra-day range',
    short: 'Range',
    unit: '€/MWh',
    formula: 'Range_N(D) = mean of (max_h - min_h) per day on [D-N+1 .. D]',
    explanation: 'Average gap between the highest and lowest hourly prices each day. A wide range means strong intraday swings; a narrow range means flat days.',
    thresholds: [50, 100],
    thresholdLabels: ['narrow', 'moderate', 'wide'],
    thresholdColors: ['rgba(20,211,169,0.4)', 'rgba(251,191,36,0.4)', 'rgba(237,105,101,0.4)'],
  },
};

// Rolling mean of abs day-on-day deltas
function _rollingDoDWithContext(filtered, fullSeries, window) {
  const out = filtered.map(() => null);
  if (!fullSeries.length) return out;
  // Build a date-indexed map of full series for lookup
  const idx = new Map();
  fullSeries.forEach((e, i) => idx.set(e.d, i));
  filtered.forEach((e, fi) => {
    const i = idx.get(e.d);
    if (i == null || i < window) return;
    const deltas = [];
    for (let j = i - window + 1; j <= i; j++) {
      const p = fullSeries[j]?.avg;
      const prev = fullSeries[j - 1]?.avg;
      if (p != null && prev != null) deltas.push(Math.abs(p - prev));
    }
    if (deltas.length >= window / 2) {
      out[fi] = deltas.reduce((a,b) => a+b, 0) / deltas.length;
    }
  });
  return out;
}

// Rolling mean of intra-day range (max - min per day)
function _rollingRangeWithContext(filtered, fullSeries, window) {
  const out = filtered.map(() => null);
  if (!fullSeries.length) return out;
  const idx = new Map();
  fullSeries.forEach((e, i) => idx.set(e.d, i));
  filtered.forEach((e, fi) => {
    const i = idx.get(e.d);
    if (i == null || i < window - 1) return;
    const ranges = [];
    for (let j = i - window + 1; j <= i; j++) {
      const day = fullSeries[j];
      if (day?.max != null && day?.min != null) ranges.push(day.max - day.min);
    }
    if (ranges.length >= window / 2) {
      out[fi] = ranges.reduce((a,b) => a+b, 0) / ranges.length;
    }
  });
  return out;
}

function _hszRenderVolatility(filtered, zone) {
  const color = zoneColor(zone);
  if (!filtered.length) return _hszPlaceholder('No data');

  const metricId = window._volMetric || 'sigma';
  const meta = _VOL_METRICS[metricId];
  const labels = filtered.map(d => d.d);
  const fullSeries = _hszCtx().getFullSeries() || [];

  // Compute the two rolling series (7D and 30D) for the selected metric
  let s7, s30;
  if (metricId === 'sigma') {
    s7  = _rollingSigmaWithContext(filtered, fullSeries, 7);
    s30 = _rollingSigmaWithContext(filtered, fullSeries, 30);
  } else if (metricId === 'dod') {
    s7  = _rollingDoDWithContext(filtered, fullSeries, 7);
    s30 = _rollingDoDWithContext(filtered, fullSeries, 30);
  } else {  // range
    s7  = _rollingRangeWithContext(filtered, fullSeries, 7);
    s30 = _rollingRangeWithContext(filtered, fullSeries, 30);
  }

  // Period-level stats on the 7D series (more reactive than 30D)
  const valid7  = s7.filter(v => v != null && !isNaN(v));
  const period7Mean = valid7.length ? valid7.reduce((a,b)=>a+b,0) / valid7.length : 0;
  // Count days above the "volatile" threshold
  const [t1, t2] = meta.thresholds;
  const daysAboveHigh = valid7.filter(v => v > t2).length;
  // Find top 5 spikes (highest values in s7), keep their date labels
  const indexedS7 = s7.map((v, i) => ({ v, i, d: labels[i] }))
    .filter(o => o.v != null && !isNaN(o.v));
  const topSpikes = [...indexedS7].sort((a,b) => b.v - a.v).slice(0, 3);
  // Period max
  const periodMax = topSpikes.length ? topSpikes[0] : null;

  // Determine current regime label based on period mean
  let regime;
  if (period7Mean < t1) regime = meta.thresholdLabels[0];
  else if (period7Mean < t2) regime = meta.thresholdLabels[1];
  else regime = meta.thresholdLabels[2];

  // Title with discrete description suffix ("Title | description")
  // Subtitle keeps only the formula (italic, smaller); stats + verdict go in the analyst banner below the chart.
  const titleHtml = _titleWithDescription(`${meta.label} — 7-day and 30-day rolling`, meta.explanation);
  const formulaSubtitle = `<span style="color:var(--tx3);font-style:italic;font-size:10px">${meta.formula}</span>`;

  _setHoTitle({
    eyebrow: `Prices · Volatility · ${zone} · ${meta.short}`,
    title: titleHtml,
    subtitle: formulaSubtitle,
  });

  // Y-axis: small headroom (5%) since min/max points no longer have labels
  const allVals = [...s7, ...s30].filter(v => v != null && !isNaN(v));
  const valMax = allVals.length ? Math.max(...allVals) : t2;
  const headroom = Math.max(valMax * 0.05, 3);
  const yMaxData = Math.ceil((valMax + headroom) / 5) * 5;

  // ── Toggle pills are rendered by _hszRenderYoYSubmenu (unified location, top of header) ──
  _hszRenderYoYSubmenu();

  // ── Annotation: top 5 spikes with anti-collision algorithm ──
  // ── Min/Max markers per curve: 4 points (max 7D, min 7D, max 30D, min 30D) ──
  // No labels — values shown via hover tooltip on the chart's curves.
  // Toggleable via the legend (state: window._volShowSpikes).
  if (window._volShowSpikes === undefined) window._volShowSpikes = true;
  const showSpikes = window._volShowSpikes;
  const spikeAnnotations = {};
  if (showSpikes) {
    const find = (series, label) => {
      let maxV = null, maxD = null, minV = null, minD = null;
      series.forEach((v, i) => {
        if (v == null || isNaN(v)) return;
        if (maxV == null || v > maxV) { maxV = v; maxD = labels[i]; }
        if (minV == null || v < minV) { minV = v; minD = labels[i]; }
      });
      return { maxV, maxD, minV, minD };
    };
    const s7stats  = find(s7,  '7D');
    const s30stats = find(s30, '30D');
    if (s7stats.maxV != null) spikeAnnotations.max7 = {
      type: 'point', xValue: s7stats.maxD, yValue: s7stats.maxV,
      backgroundColor: '#ED6965', borderColor: '#000', borderWidth: 1, radius: 4,
      // Hover label: shows "Max 7D: <value> on <date>"
      label: {
        display: false,
        content: ['Max 7D', `${s7stats.maxV.toFixed(2)} ${meta.unit}`, _fmtShortDate(s7stats.maxD)],
        color: '#fff', backgroundColor: 'rgba(11,15,21,0.95)',
        borderColor: '#ED6965', borderWidth: 1, borderRadius: 4,
        font: { size: 10, family: 'JetBrains Mono', weight: '600' },
        padding: 6, position: 'start', yAdjust: -28,
      },
      enter(ctx) { ctx.element.options.label.display = true; ctx.chart.update(); },
      leave(ctx) { ctx.element.options.label.display = false; ctx.chart.update(); },
    };
    if (s7stats.minV != null) spikeAnnotations.min7 = {
      type: 'point', xValue: s7stats.minD, yValue: s7stats.minV,
      backgroundColor: '#14D3A9', borderColor: '#000', borderWidth: 1, radius: 4,
      label: {
        display: false,
        content: ['Min 7D', `${s7stats.minV.toFixed(2)} ${meta.unit}`, _fmtShortDate(s7stats.minD)],
        color: '#fff', backgroundColor: 'rgba(11,15,21,0.95)',
        borderColor: '#14D3A9', borderWidth: 1, borderRadius: 4,
        font: { size: 10, family: 'JetBrains Mono', weight: '600' },
        padding: 6, position: 'start', yAdjust: 28,
      },
      enter(ctx) { ctx.element.options.label.display = true; ctx.chart.update(); },
      leave(ctx) { ctx.element.options.label.display = false; ctx.chart.update(); },
    };
    if (s30stats.maxV != null) spikeAnnotations.max30 = {
      type: 'point', xValue: s30stats.maxD, yValue: s30stats.maxV,
      backgroundColor: '#ED6965', borderColor: '#000', borderWidth: 1, radius: 3.5,
      label: {
        display: false,
        content: ['Max 30D', `${s30stats.maxV.toFixed(2)} ${meta.unit}`, _fmtShortDate(s30stats.maxD)],
        color: '#fff', backgroundColor: 'rgba(11,15,21,0.95)',
        borderColor: '#ED6965', borderWidth: 1, borderRadius: 4,
        font: { size: 10, family: 'JetBrains Mono', weight: '600' },
        padding: 6, position: 'start', yAdjust: -28,
      },
      enter(ctx) { ctx.element.options.label.display = true; ctx.chart.update(); },
      leave(ctx) { ctx.element.options.label.display = false; ctx.chart.update(); },
    };
    if (s30stats.minV != null) spikeAnnotations.min30 = {
      type: 'point', xValue: s30stats.minD, yValue: s30stats.minV,
      backgroundColor: '#14D3A9', borderColor: '#000', borderWidth: 1, radius: 3.5,
      label: {
        display: false,
        content: ['Min 30D', `${s30stats.minV.toFixed(2)} ${meta.unit}`, _fmtShortDate(s30stats.minD)],
        color: '#fff', backgroundColor: 'rgba(11,15,21,0.95)',
        borderColor: '#14D3A9', borderWidth: 1, borderRadius: 4,
        font: { size: 10, family: 'JetBrains Mono', weight: '600' },
        padding: 6, position: 'start', yAdjust: 28,
      },
      enter(ctx) { ctx.element.options.label.display = true; ctx.chart.update(); },
      leave(ctx) { ctx.element.options.label.display = false; ctx.chart.update(); },
    };
  }

  // ── Custom HTML legend above the chart with Spikes toggle ──
  const legendId = _hszCtx().togglePrefix + '-vol-legend';
  const oldLg = document.getElementById(legendId);
  if (oldLg) oldLg.remove();
  const canvasEl = document.getElementById(_hszCtx().canvasId);
  if (canvasEl && canvasEl.parentNode) {
    const lg = document.createElement('div');
    lg.id = legendId;
    lg.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:12px;font-size:10px;color:var(--tx3);margin-bottom:6px;font-family:\'JetBrains Mono\',monospace;flex-wrap:wrap';
    lg.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:14px;height:2px;background:${_HIST_WARN}"></span>7D rolling</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:14px;height:2.5px;background:${color}"></span>30D rolling</span>
      <button onclick="event.stopPropagation();window._volShowSpikes=!window._volShowSpikes;if(_HSZ_RERENDER)_HSZ_RERENDER()"
        title="Show/hide min and max markers · hover them for exact values"
        style="background:${showSpikes?'rgba(255,255,255,0.06)':'transparent'};border:1px solid ${showSpikes?'rgba(255,255,255,0.15)':'rgba(255,255,255,0.10)'};color:${showSpikes?'var(--tx)':'var(--tx3)'};padding:3px 8px;border-radius:3px;font-size:9px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase;display:inline-flex;align-items:center;gap:6px">
        <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:#ED6965;display:inline-block"></span>Max</span>
        <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:#14D3A9;display:inline-block"></span>Min</span>
        ${showSpikes ? '✓' : ''}
      </button>
    `;
    // FS-aware insertion: in FS, place in chart-pane BEFORE the canvas wrapper
    const isFs = (_hszCtx().canvasId === 'ho-fs-chart');
    if (isFs) {
      const pane = document.getElementById('ho-fs-chart-pane');
      const canvasWrapFs = canvasEl.parentNode;
      if (pane && canvasWrapFs) {
        pane.insertBefore(lg, canvasWrapFs);
      }
    } else {
      canvasEl.parentNode.insertBefore(lg, canvasEl);
    }
  }

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        // 7D — thin orange (reactive line, holds the spikes)
        { label: '7D rolling', data: s7,  borderColor: _HIST_WARN, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.2, spanGaps: true, fill: false },
        // 30D — thicker zone color (trend line)
        { label: '30D rolling', data: s30, borderColor: color,    backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.3, spanGaps: true, fill: false },
      ],
    },
    options: {
      ...baseOptions(meta.unit),
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' ' + meta.unit : 'n/a'}` } },
        annotation: {
          annotations: {
            // Regime zones in the background (reinforced alpha 0.10)
            zoneStable:   { type: 'box', yMin: 0,  yMax: Math.min(t1, yMaxData), backgroundColor: 'rgba(20,211,169,0.10)', borderWidth: 0 },
            zoneModerate: { type: 'box', yMin: t1, yMax: Math.min(t2, yMaxData), backgroundColor: 'rgba(251,191,36,0.10)', borderWidth: 0 },
            zoneVolatile: { type: 'box', yMin: t2, yMax: yMaxData,                backgroundColor: 'rgba(237,105,101,0.10)', borderWidth: 0 },
            // Threshold reference lines — labels positioned 'start' (left edge, inside the chart area)
            // with a small background so they read against the colored zones.
            refLow: yMaxData >= t1 ? { type: 'line', yMin: t1, yMax: t1, borderColor: 'rgba(20,211,169,0.55)', borderWidth: 1, borderDash: [3,3],
              label: { display: true, content: `${meta.short}=${t1} · ${meta.thresholdLabels[0]}/${meta.thresholdLabels[1]}`,
                color: '#14D3A9', font: { size: 9, family: 'JetBrains Mono', weight: '600' },
                position: 'start', backgroundColor: 'rgba(11,15,21,0.7)', borderRadius: 2, padding: { top: 2, bottom: 2, left: 5, right: 5 },
                yAdjust: -8 } } : undefined,
            refHigh: yMaxData >= t2 ? { type: 'line', yMin: t2, yMax: t2, borderColor: 'rgba(237,105,101,0.55)', borderWidth: 1, borderDash: [3,3],
              label: { display: true, content: `${meta.short}=${t2} · ${meta.thresholdLabels[1]}/${meta.thresholdLabels[2]}`,
                color: '#ED6965', font: { size: 9, family: 'JetBrains Mono', weight: '600' },
                position: 'start', backgroundColor: 'rgba(11,15,21,0.7)', borderRadius: 2, padding: { top: 2, bottom: 2, left: 5, right: 5 },
                yAdjust: -8 } } : undefined,
            ...spikeAnnotations,
          },
        },
        zoom: _zoomConfig({ mode: 'y' }),
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 8,
          callback: function(value) {
            const lbl = this.getLabelForValue(value);
            return _fmtTickUK(lbl);
          }
        } },
        y: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } }, min: 0, max: yMaxData, title: { display: true, text: meta.unit, color: _HIST_TX3, font: { size: 10 } } },
      },
    },
  });
  // Analyst banner
  if (period7Mean != null) {
    _renderAnalystBanner(_buildAnalystBanner('volatility', {
      metricLabel: meta.label,
      periodMean: period7Mean,
      regime,
      daysAbove: daysAboveHigh,
      threshold: t2,
      peakVal: periodMax ? periodMax.v : null,
      peakDate: periodMax ? periodMax.d : null,
      unit: meta.unit,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · Distribution: histogram of daily avgs for the selected zone ──
// ── Distribution metric state ──────────────────────────────────────────────
window._distMode = window._distMode || 'cumulative';  // 'cumulative' | 'histo'
function _setDistMode(m) {
  window._distMode = m;
  const zone = window._HO_OPEN_ZONE;
  if (zone && _HSZ_RERENDER) _HSZ_RERENDER();
}
window._setDistMode = _setDistMode;

// Default fallback thresholds (used if summary.distThresholds[zone] is missing — typical
// for old summary.json before re-running enrich). Tuned roughly on FR multi-year history.
const _DIST_DEFAULT_THR = { p0: -50, p10: 10, p25: 25, p50: 50, p75: 75, p95: 110, p100: 200, n: 0 };

// Gaussian kernel + KDE evaluator (Silverman rule of thumb for bandwidth)
function _kde(values, xGrid) {
  const n = values.length;
  if (!n) return xGrid.map(() => 0);
  const mean = values.reduce((a,b)=>a+b,0) / n;
  const sd = Math.sqrt(values.reduce((s,v)=>s+(v-mean)*(v-mean),0) / n);
  if (sd === 0) return xGrid.map(() => 0);
  // Silverman's rule: h = 1.06 · σ · n^(-1/5)
  const h = 1.06 * sd * Math.pow(n, -1/5);
  const norm = 1 / (Math.sqrt(2 * Math.PI) * h);
  return xGrid.map(x => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const u = (x - values[i]) / h;
      s += Math.exp(-0.5 * u * u);
    }
    return (s * norm) / n;
  });
}

function _hszRenderDist(filtered, zone, summary) {
  const color = zoneColor(zone);
  if (!filtered.length) return _hszPlaceholder('No data');

  const avgs = filtered.map(d => d.avg).filter(v => v != null && !isNaN(v));
  if (avgs.length < 3) return _hszPlaceholder('Not enough data points');

  const mode = window._distMode || 'cumulative';

  // ── Period-level stats ──
  const sorted = [...avgs].sort((a, b) => a - b);
  const mean    = avgs.reduce((a, b) => a + b, 0) / avgs.length;
  const median  = _percentile(sorted, 0.5);
  const stddev  = Math.sqrt(avgs.reduce((a, v) => a + (v - mean) ** 2, 0) / avgs.length);
  const p5      = _percentile(sorted, 0.05);
  const p95     = _percentile(sorted, 0.95);
  const minV    = sorted[0];
  const maxV    = sorted[sorted.length - 1];

  // ── Zone-historical thresholds (auto-calibrated, fall back to defaults) ──
  const thr = (summary?.distThresholds?.[zone]) || _DIST_DEFAULT_THR;
  // 4 business categories defined by P25, P75, P95 of the zone's full history
  // Negative anchor = 0 (always meaningful regardless of zone)
  const T_NEG = 0;
  const T_LOW = thr.p25;
  const T_HIGH = thr.p75;
  const T_EXTREME = thr.p95;

  // Count days in each business category for subtitle
  const nNeg     = avgs.filter(v => v < T_NEG).length;
  const nLow     = avgs.filter(v => v >= T_NEG && v < T_LOW).length;
  const nNormal  = avgs.filter(v => v >= T_LOW && v < T_HIGH).length;
  const nHigh    = avgs.filter(v => v >= T_HIGH && v < T_EXTREME).length;
  const nExtreme = avgs.filter(v => v >= T_EXTREME).length;
  const pct = n => ((n / avgs.length) * 100).toFixed(1) + '%';

  // ── Toggle pills are rendered by _hszRenderYoYSubmenu (unified location, top of header) ──
  _hszRenderYoYSubmenu();

  // ── Formula strip removed: formula is now part of the subtitle (line 1 italic gray) ──
  // Defensive: remove any stale formula strip from BOTH possible prefixes (inline + FS)
  // in case the user toggled between modes/views and a previous render left it behind.
  ['ho-detail-dist-formula', 'ho-fs-dist-formula'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  const canvasEl = document.getElementById(_hszCtx().canvasId);

  // ── Title block: "Title | discrete description" + subtitle (formula italic only) ──
  // Stats + verdict go in the analyst banner under the chart.
  const titleHtml = (mode === 'cumulative')
    ? _titleWithDescription('Cumulative price distribution', 'For any price level, what % of days fell below it. A steep curve means prices were concentrated in a narrow range; a flat curve means prices were spread out.')
    : _titleWithDescription('Daily average price distribution', 'Frequency of daily prices by price range. Tall bars show the most common price levels; gaps or secondary peaks reveal less common regimes.');
  const formulaLine = (mode === 'cumulative')
    ? `F(x) = days with price ≤ x  /  total · 100%`
    : `count(x) = days with price ∈ [x, x+bin_size]  ·  KDE: density(x) = (1/n·h) · Σ K((x-xᵢ)/h)`;
  // Compute mostFreqBucket for histo banner (used in both modes for context)
  const mostFreqBucket = (() => {
    const range = maxV - minV;
    const BIN = range < 30 ? 2 : range < 80 ? 5 : range < 200 ? 10 : 20;
    const bins = {};
    avgs.forEach(v => {
      const k = Math.floor(v / BIN) * BIN;
      bins[k] = (bins[k] || 0) + 1;
    });
    let best = null, bestC = 0;
    Object.entries(bins).forEach(([k, c]) => { if (c > bestC) { best = +k; bestC = c; } });
    return best != null ? `${best.toFixed(2)} → ${(best+BIN).toFixed(2)} €/MWh` : '—';
  })();
  // p5 for cumulative skew computation (banner)
  const distP5 = sorted.length ? _percentile(sorted, 0.05) : null;
  _setHoTitle({
    eyebrow: `Prices · Distribution · ${zone} · ${avgs.length} days observed`,
    title: titleHtml,
    subtitle: `<span style="color:var(--tx3);font-style:italic">${formulaLine}</span>`,
  });

  // ── Compute shared chart X range (used for both legend ribbon widths and chart axis) ──
  // Round to outer multiples of 10 for clean axis ticks.
  const rawXMin = Math.min(minV, T_NEG - 5);
  const rawXMax = Math.max(maxV, T_EXTREME + 10);
  const chartXMin = Math.floor(rawXMin / 10) * 10;
  const chartXMax = Math.ceil(rawXMax / 10) * 10;
  const xSpan = chartXMax - chartXMin || 1;

  // ── Render legend HTML above the chart, aligned with the chart's coloured zones ──
  // Each tile's width is proportional to its PRICE RANGE on the x-axis (not its day count),
  // so the ribbon visually echoes the bands behind the chart curve.
  const legendId = _hszCtx().togglePrefix + '-dist-legend';
  const oldLg = document.getElementById(legendId);
  if (oldLg) oldLg.remove();
  if (canvasEl && canvasEl.parentNode) {
    const lg = document.createElement('div');
    lg.id = legendId;
    lg.style.cssText = 'margin-top:14px;margin-bottom:2px;font-family:\'JetBrains Mono\',monospace';
    // Width proportion: each category's price-range size divided by total chart x span
    // (Negative covers [chartXMin..0], Low covers [0..P25], etc.)
    const widths = {
      neg:     Math.max(0, T_NEG - chartXMin) / xSpan,
      low:     Math.max(0, T_LOW - T_NEG) / xSpan,
      normal:  Math.max(0, T_HIGH - T_LOW) / xSpan,
      high:    Math.max(0, T_EXTREME - T_HIGH) / xSpan,
      extreme: Math.max(0, chartXMax - T_EXTREME) / xSpan,
    };
    // Minimum visible width so tiles never collapse to 0px even with extreme ratios
    const minPct = 6;
    const tile = (widthPct, bg, borderBottom, label, count, rangeTxt) => {
      const w = Math.max(widthPct * 100, minPct);
      return `<div style="flex:${w} ${w} 0;min-width:0;background:${bg};border-bottom:2px solid ${borderBottom};padding:6px 8px;display:flex;flex-direction:column;gap:2px;justify-content:center;overflow:hidden">
        <div style="font-size:10px;font-weight:600;color:var(--tx);letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><strong>${label}</strong> · ${count}d (${pct(count)})</div>
        <div style="font-size:9px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rangeTxt}</div>
      </div>`;
    };
    // Outer wrapper has placeholder L/R padding — will be adjusted post-render
    // to match the actual Chart.js chartArea (left = Y-axis label + ticks width,
    // right = right margin). This gives pixel-perfect alignment of the legend
    // tiles with the coloured zone bands behind the chart.
    lg.innerHTML = `<div id="${legendId}-inner" style="padding-left:50px;padding-right:12px;transition:padding 0.15s"><div style="display:flex;gap:2px;border-radius:3px;overflow:hidden">
      ${tile(widths.neg,     'rgba(237,105,101,0.18)', 'rgba(237,105,101,0.6)', 'Negative', nNeg,     `< 0.00 €/MWh`)}
      ${tile(widths.low,     'rgba(20,211,169,0.18)',  'rgba(20,211,169,0.6)',  'Low',      nLow,     `0.00 → ${T_LOW.toFixed(2)} €/MWh`)}
      ${tile(widths.normal,  'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.35)', 'Normal',  nNormal,  `${T_LOW.toFixed(2)} → ${T_HIGH.toFixed(2)} €/MWh`)}
      ${tile(widths.high,    'rgba(251,191,36,0.18)',  'rgba(251,191,36,0.6)',  'High',     nHigh,    `${T_HIGH.toFixed(2)} → ${T_EXTREME.toFixed(2)} €/MWh`)}
      ${tile(widths.extreme, 'rgba(237,105,101,0.22)', 'rgba(237,105,101,0.7)', 'Extreme',  nExtreme, `> ${T_EXTREME.toFixed(2)} €/MWh`)}
    </div></div>`;
    // Insert in the right place depending on inline vs fullscreen
    const isFs = (_hszCtx().canvasId === 'ho-fs-chart');
    if (isFs) {
      // FS: insert in chart-pane BEFORE the canvas wrapper (which is the parent of the canvas)
      const pane = document.getElementById('ho-fs-chart-pane');
      const canvasWrapFs = canvasEl.parentNode;
      if (pane && canvasWrapFs) {
        pane.insertBefore(lg, canvasWrapFs);
      }
    } else {
      canvasEl.parentNode.insertBefore(lg, canvasEl);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODE 1: CUMULATIVE (CDF)
  // ─────────────────────────────────────────────────────────────────────────
  if (mode === 'cumulative') {
    // X grid: use the shared chart range (rounded to outer multiples of 10)
    const xMin = chartXMin;
    const xMax = chartXMax;
    const N_POINTS = 100;
    const xGrid = [];
    for (let i = 0; i < N_POINTS; i++) xGrid.push(xMin + (xMax - xMin) * (i / (N_POINTS - 1)));
    // CDF: for each x, % of values <= x
    const cdf = xGrid.map(x => {
      let n = 0;
      for (let i = 0; i < sorted.length; i++) { if (sorted[i] <= x) n++; else break; }
      return (n / sorted.length) * 100;
    });

    // Annotations: zones + threshold labels + P50/P95 crosshairs
    // Label positions: P25 at TOP (low-price side); P75 and P95 at BOTTOM (high-price side, less crowded)
    // P50 and P95 crosshair labels positioned directly BELOW their point.
    const annotations = {
      // Background category zones (reinforced alpha 0.10)
      bandNeg:     { type: 'box', xMin, xMax: T_NEG,      backgroundColor: 'rgba(237,105,101,0.10)', borderWidth: 0 },
      bandLow:     { type: 'box', xMin: T_NEG, xMax: T_LOW,     backgroundColor: 'rgba(20,211,169,0.08)', borderWidth: 0 },
      bandNormal:  { type: 'box', xMin: T_LOW, xMax: T_HIGH,    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 0 },
      bandHigh:    { type: 'box', xMin: T_HIGH, xMax: T_EXTREME, backgroundColor: 'rgba(251,191,36,0.10)', borderWidth: 0 },
      bandExtreme: { type: 'box', xMin: T_EXTREME, xMax,        backgroundColor: 'rgba(237,105,101,0.13)', borderWidth: 0 },
      // Threshold vertical lines: P25 label at TOP, P75/P95 labels at BOTTOM
      thrZero:    T_NEG >= xMin && T_NEG <= xMax ? { type: 'line', xMin: T_NEG, xMax: T_NEG, borderColor: 'rgba(255,255,255,0.25)', borderWidth: 1, borderDash: [2,3] } : undefined,
      thrLow:     { type: 'line', xMin: T_LOW, xMax: T_LOW, borderColor: 'rgba(20,211,169,0.55)', borderWidth: 1, borderDash: [3,3],
        label: { display: true, content: `P25 · ${T_LOW.toFixed(0)} €`, color: '#14D3A9', font: { size: 9, family: 'JetBrains Mono', weight: '600' }, position: 'end', backgroundColor: 'rgba(11,15,21,0.92)', borderRadius: 2, padding: { top: 2, bottom: 2, left: 5, right: 5 }, yAdjust: 12 } },
      thrHigh:    { type: 'line', xMin: T_HIGH, xMax: T_HIGH, borderColor: 'rgba(251,191,36,0.55)', borderWidth: 1, borderDash: [3,3],
        label: { display: true, content: `P75 · ${T_HIGH.toFixed(0)} €`, color: '#FBBF24', font: { size: 9, family: 'JetBrains Mono', weight: '600' }, position: 'start', backgroundColor: 'rgba(11,15,21,0.92)', borderRadius: 2, padding: { top: 2, bottom: 2, left: 5, right: 5 }, yAdjust: -12 } },
      thrExtreme: { type: 'line', xMin: T_EXTREME, xMax: T_EXTREME, borderColor: 'rgba(237,105,101,0.55)', borderWidth: 1, borderDash: [3,3],
        label: { display: true, content: `P95 · ${T_EXTREME.toFixed(0)} €`, color: '#ED6965', font: { size: 9, family: 'JetBrains Mono', weight: '600' }, position: 'start', backgroundColor: 'rgba(11,15,21,0.92)', borderRadius: 2, padding: { top: 2, bottom: 2, left: 5, right: 5 }, yAdjust: -12 } },
      // 50% horizontal + median crosshair (label BELOW the point)
      h50: { type: 'line', yMin: 50, yMax: 50, borderColor: 'rgba(20,211,169,0.35)', borderWidth: 1, borderDash: [2,3] },
      medianPoint: { type: 'point', xValue: median, yValue: 50, backgroundColor: '#14D3A9', borderColor: '#000', borderWidth: 1, radius: 5 },
      medianLabel: { type: 'label', xValue: median, yValue: 50, content: `P50 = ${median.toFixed(1)} €`, color: '#14D3A9', backgroundColor: 'rgba(11,15,21,0.90)', borderColor: 'rgba(20,211,169,0.5)', borderWidth: 1, borderRadius: 3, font: { size: 10, family: 'JetBrains Mono', weight: '600' }, padding: 5, xAdjust: 0, yAdjust: 22 },
      // 95% horizontal + P95 crosshair (label BELOW the point)
      h95: { type: 'line', yMin: 95, yMax: 95, borderColor: 'rgba(251,191,36,0.35)', borderWidth: 1, borderDash: [2,3] },
      p95Point: { type: 'point', xValue: p95, yValue: 95, backgroundColor: '#FBBF24', borderColor: '#000', borderWidth: 1, radius: 5 },
      p95Label: { type: 'label', xValue: p95, yValue: 95, content: `P95 = ${p95.toFixed(1)} €`, color: '#FBBF24', backgroundColor: 'rgba(11,15,21,0.92)', borderColor: 'rgba(251,191,36,0.5)', borderWidth: 1, borderRadius: 3, font: { size: 10, family: 'JetBrains Mono', weight: '600' }, padding: 5, xAdjust: 0, yAdjust: 22 },
    };

    mkHistChart(_hszCtx().canvasId, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Cumulative %',
          data: xGrid.map((x, i) => ({ x, y: cdf[i] })),
          borderColor: color,
          backgroundColor: _toRgba(color, 0.08),
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0,
          fill: 'origin',
        }],
      },
      options: {
        ...baseOptions('Cumulative %'),
        layout: { padding: { bottom: 8 } },
        interaction: { mode: 'index', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index', axis: 'x', intersect: false,
            backgroundColor: 'rgba(11,15,21,0.95)',
            borderColor: 'rgba(20,211,169,0.4)', borderWidth: 1,
            titleColor: '#14D3A9', titleFont: { size: 11, family: 'JetBrains Mono', weight: '600' },
            bodyColor: 'var(--tx)', bodyFont: { size: 11, family: 'JetBrains Mono' },
            padding: 8, displayColors: false,
            callbacks: {
              title: ctx => ctx[0] ? `Price ≤ ${ctx[0].parsed.x.toFixed(1)} €/MWh` : '',
              label: ctx => `  ${ctx.parsed.y.toFixed(1)}% of days`,
              afterLabel: ctx => {
                // Bonus: tell the user which category this price falls into
                const p = ctx.parsed.x;
                if (p < 0) return '  → Negative zone';
                if (p < T_LOW) return `  → Low zone (under P25)`;
                if (p < T_HIGH) return `  → Normal zone (P25–P75)`;
                if (p < T_EXTREME) return `  → High zone (P75–P95)`;
                return `  → Extreme zone (over P95)`;
              },
            },
          },
          annotation: { annotations },
          zoom: _zoomConfig({ mode: 'xy' }),
        },
        scales: {
          x: {
            type: 'linear',
            min: xMin, max: xMax,
            grid: { color: _HIST_GRID },
            ticks: { color: _HIST_TX3, font: { size: 10 }, stepSize: 10, maxRotation: 0, autoSkip: true, maxTicksLimit: 20 },
            title: { display: true, text: 'Daily avg (€/MWh)', color: _HIST_TX3, font: { size: 10 } },
          },
          y: {
            min: 0, max: 100,
            grid: { color: _HIST_GRID },
            ticks: { color: _HIST_TX3, font: { size: 10 }, callback: v => v + '%' },
            title: { display: true, text: '% of days under', color: _HIST_TX3, font: { size: 10 } },
          },
        },
      },
    });
    // Post-render: align legend tiles with chart's drawing area (chartArea.left/right)
    // for pixel-perfect alignment with the coloured zones behind the curve.
    _alignLegendToChartArea(legendId);
    // Analyst banner (Cumulative mode)
    _renderAnalystBanner(_buildAnalystBanner('cumulative', {
      median, p95, p5: distP5,
    }));
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODE 2: HISTOGRAM + KDE OVERLAY
  // ─────────────────────────────────────────────────────────────────────────
  // Bin size: adaptive
  const range = maxV - minV;
  const BIN_SIZE = range < 30 ? 2 : range < 80 ? 5 : range < 200 ? 10 : 20;
  const binMin = Math.floor(Math.min(minV, T_NEG - 5) / BIN_SIZE) * BIN_SIZE;
  const binMax = Math.ceil(Math.max(maxV, T_EXTREME + 10) / BIN_SIZE) * BIN_SIZE;
  const bins = [], counts = [];
  for (let b = binMin; b < binMax; b += BIN_SIZE) {
    bins.push(b);
    counts.push(avgs.filter(v => v >= b && v < b + BIN_SIZE).length);
  }
  // Color bars by business category (based on bin lower bound)
  const catColor = b => {
    if (b < T_NEG) return _toRgba('#ED6965', 0.65);
    if (b < T_LOW) return _toRgba('#14D3A9', 0.55);
    if (b < T_HIGH) return _toRgba(color, 0.65);
    if (b < T_EXTREME) return _toRgba('#FBBF24', 0.55);
    return _toRgba('#ED6965', 0.55);
  };
  const catBorder = b => {
    if (b < T_NEG) return '#ED6965';
    if (b < T_LOW) return '#14D3A9';
    if (b < T_HIGH) return color;
    if (b < T_EXTREME) return '#FBBF24';
    return '#ED6965';
  };
  const barColors = bins.map(catColor);
  const barBorders = bins.map(catBorder);

  // KDE curve over the same x range
  const xGrid = bins.map(b => b + BIN_SIZE / 2);
  const density = _kde(avgs, xGrid);
  // Scale density to peak-match the histogram for visual co-location
  const maxCount = Math.max(...counts);
  const maxDensity = Math.max(...density);
  const kdeScale = maxDensity > 0 ? (maxCount * 0.95) / maxDensity : 1;
  const kdeScaled = density.map(d => d * kdeScale);

  // Annotations: zones + threshold lines + mean + median
  const annotations = {
    // Background category zones aligned with histogram bins (use xValue indices)
    // Note: bar chart x is categorical, so we use the bin index. Compute boundaries.
    bandNeg:     { type: 'box', xMin: -0.5, xMax: bins.findIndex(b => b >= T_NEG) - 0.5,            backgroundColor: 'rgba(237,105,101,0.10)', borderWidth: 0 },
    bandLow:     { type: 'box', xMin: bins.findIndex(b => b >= T_NEG) - 0.5, xMax: bins.findIndex(b => b >= T_LOW) - 0.5, backgroundColor: 'rgba(20,211,169,0.08)', borderWidth: 0 },
    bandNormal:  { type: 'box', xMin: bins.findIndex(b => b >= T_LOW) - 0.5, xMax: bins.findIndex(b => b >= T_HIGH) - 0.5, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 0 },
    bandHigh:    { type: 'box', xMin: bins.findIndex(b => b >= T_HIGH) - 0.5, xMax: bins.findIndex(b => b >= T_EXTREME) - 0.5, backgroundColor: 'rgba(251,191,36,0.10)', borderWidth: 0 },
    bandExtreme: { type: 'box', xMin: bins.findIndex(b => b >= T_EXTREME) - 0.5, xMax: bins.length - 0.5, backgroundColor: 'rgba(237,105,101,0.13)', borderWidth: 0 },
    // μ (mean) and Median: labels positioned at TOP of chart to avoid mid-chart clutter
    meanLine: {
      type: 'line', scaleID: 'x',
      value: bins.findIndex(b => b + BIN_SIZE > mean) - 0.5,
      borderColor: 'rgba(255,255,255,0.45)', borderWidth: 1, borderDash: [3,3],
      label: { display: true, content: `μ ${mean.toFixed(1)} €`, color: 'rgba(255,255,255,0.85)',
        font: { size: 9, family: 'JetBrains Mono', weight: '600' },
        position: 'start', backgroundColor: 'rgba(11,15,21,0.92)', borderRadius: 2,
        padding: { top: 2, bottom: 2, left: 5, right: 5 }, yAdjust: 8 },
    },
    medianLine: {
      type: 'line', scaleID: 'x',
      value: bins.findIndex(b => b + BIN_SIZE > median) - 0.5,
      borderColor: '#14D3A9', borderWidth: 1.5, borderDash: [4,2],
      label: { display: true, content: `Med ${median.toFixed(1)} €`, color: '#14D3A9',
        font: { size: 9, family: 'JetBrains Mono', weight: '600' },
        position: 'start', backgroundColor: 'rgba(11,15,21,0.95)', borderColor: 'rgba(20,211,169,0.5)', borderWidth: 1, borderRadius: 2,
        padding: { top: 2, bottom: 2, left: 5, right: 5 }, yAdjust: 26 },
    },
  };

  mkHistChart(_hszCtx().canvasId, {
    type: 'bar',
    data: {
      labels: bins.map(b => String(b)),
      datasets: [
        {
          type: 'bar',
          label: 'Days',
          data: counts,
          backgroundColor: barColors,
          borderColor: barBorders,
          borderWidth: 1,
          order: 2,
        },
        {
          type: 'line',
          label: 'KDE density (scaled)',
          data: kdeScaled,
          borderColor: '#FBBF24',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      ...baseOptions('Days'),
      layout: { padding: { bottom: 8 } },
      interaction: { mode: 'index', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', axis: 'x', intersect: false,
          backgroundColor: 'rgba(11,15,21,0.95)',
          borderColor: 'rgba(20,211,169,0.4)', borderWidth: 1,
          titleColor: '#14D3A9', titleFont: { size: 11, family: 'JetBrains Mono', weight: '600' },
          bodyColor: 'var(--tx)', bodyFont: { size: 11, family: 'JetBrains Mono' },
          padding: 8, displayColors: false,
          callbacks: {
            title: ctx => {
              if (!ctx[0]) return '';
              const b = bins[ctx[0].dataIndex];
              // Category badge in the title
              let cat = 'Normal';
              if (b < T_NEG) cat = 'Negative';
              else if (b < T_LOW) cat = 'Low';
              else if (b < T_HIGH) cat = 'Normal';
              else if (b < T_EXTREME) cat = 'High';
              else cat = 'Extreme';
              return `${b} → ${b + BIN_SIZE} €/MWh · ${cat}`;
            },
            label: ctx => {
              if (ctx.dataset.type === 'bar') {
                const cum = counts.slice(0, ctx.dataIndex + 1).reduce((a,b)=>a+b,0);
                const cumPct = (cum / avgs.length) * 100;
                return [
                  `  ${ctx.parsed.y} day${ctx.parsed.y > 1 ? 's' : ''} (${((ctx.parsed.y / avgs.length) * 100).toFixed(1)}%)`,
                  `  Cumulative: ${cumPct.toFixed(1)}%`,
                ];
              }
              return null;
            },
          },
        },
        annotation: { annotations },
        zoom: _zoomConfig({ mode: 'y' }),
      },
      scales: {
        x: {
          grid: { color: _HIST_GRID, display: false },
          ticks: { color: _HIST_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0 },
          title: { display: true, text: 'Daily avg (€/MWh)', color: _HIST_TX3, font: { size: 10 } },
        },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          title: { display: true, text: 'Days count', color: _HIST_TX3, font: { size: 10 } },
          beginAtZero: true,
          suggestedMax: Math.ceil(maxCount * 1.10),
        },
      },
    },
  });
  // Post-render: align legend tiles with chart's drawing area
  _alignLegendToChartArea(legendId);
  // Analyst banner (Histo+KDE mode)
  _renderAnalystBanner(_buildAnalystBanner('histo', {
    mostFreqBucket, mean, median,
  }));
}

// Helper: mean ignoring null / NaN
function _meanIgnoreNull(arr) {
  const v = arr.filter(x => x != null && !isNaN(x));
  return v.length ? v.reduce((a,b)=>a+b,0) / v.length : null;
}

// Sanitise an hourly profile. Some historical years have only partial data
// (data import bug → 1h vs 0.25h misalignment, or truncated days). Without
// this fix the chart renders saw-tooth lines or flat-copies the last valid
// value, both visually misleading.
//
// Strategy:
//   • Compute validity ratio overall AND check trailing/leading null run.
//   • If validity >= 80% AND no trailing/leading run > 20% → as-is.
//   • If 40% <= validity AND trailing/leading run ≤ 20% → linearly interpolate
//     internal nulls only (safe: we have anchors on both sides).
//   • Otherwise → return null (renderer drops the series — better than lying).
function _hszSanitiseHourlyProfile(arr) {
  if (!arr || arr.length === 0) return null;
  const n = arr.length;
  const isValid = v => v != null && !isNaN(v);
  const validCount = arr.filter(isValid).length;
  const ratio = validCount / n;
  if (ratio < 0.4) return null;
  // Leading run of nulls
  let leadNull = 0;
  while (leadNull < n && !isValid(arr[leadNull])) leadNull++;
  // Trailing run of nulls
  let trailNull = 0;
  while (trailNull < n && !isValid(arr[n - 1 - trailNull])) trailNull++;
  // If a long contiguous block at start or end is missing → data is broken,
  // not a sparse-sampling case. Drop rather than fabricate.
  const longRunThreshold = Math.floor(n * 0.2); // 20% of the series
  if (leadNull > longRunThreshold || trailNull > longRunThreshold) return null;
  if (ratio >= 0.8) return arr.slice();
  // Internal interpolation only (both sides have anchors)
  const out = arr.slice();
  for (let i = 0; i < n; i++) {
    if (isValid(out[i])) continue;
    let prevI = -1;
    for (let j = i - 1; j >= 0; j--) if (isValid(arr[j])) { prevI = j; break; }
    let nextI = -1;
    for (let j = i + 1; j < n; j++) if (isValid(arr[j])) { nextI = j; break; }
    if (prevI === -1 || nextI === -1) continue; // safety, should not happen here
    const w = (i - prevI) / (nextI - prevI);
    out[i] = arr[prevI] * (1 - w) + arr[nextI] * w;
  }
  return out;
}

// ── Stats helpers shared across multiple chart variants ──
function _percentile(sortedArr, p) {
  // sortedArr must be sorted ascending. p in [0,1].
  if (!sortedArr.length) return null;
  if (p <= 0) return sortedArr[0];
  if (p >= 1) return sortedArr[sortedArr.length - 1];
  const idx = p * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function _boxStats(arr) {
  // Returns {p10, p25, p50, p75, p90, min, max, n} from a numeric array
  const v = arr.filter(x => x != null && !isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return {
    n:   v.length,
    p10: _percentile(v, 0.10),
    p25: _percentile(v, 0.25),
    p50: _percentile(v, 0.50),
    p75: _percentile(v, 0.75),
    p90: _percentile(v, 0.90),
    min: v[0],
    max: v[v.length - 1],
  };
}

function _stdDev(arr) {
  const v = arr.filter(x => x != null && !isNaN(x));
  if (v.length < 2) return null;
  const m = v.reduce((a,b)=>a+b,0) / v.length;
  const variance = v.reduce((a,b)=>a + (b-m)*(b-m), 0) / v.length;
  return Math.sqrt(variance);
}

// Group an array of {d:'YYYY-MM-DD', avg, ...} entries by YYYY-MM key
function _groupByMonth(entries) {
  const m = {};
  entries.forEach(e => {
    const k = e.d.slice(0, 7);
    if (!m[k]) m[k] = [];
    m[k].push(e);
  });
  return m;
}

// Group entries by year
function _groupByYear(entries) {
  const m = {};
  entries.forEach(e => {
    const y = e.d.slice(0, 4);
    if (!m[y]) m[y] = [];
    m[y].push(e);
  });
  return m;
}

// Get the day-of-period index for an entry within a sub-period (used for YoY alignment)
// Returns 0-based index of entry.d within the period [from, to]
function _dayOfPeriod(dateStr, fromStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const f = new Date(fromStr + 'T00:00:00Z');
  return Math.floor((d - f) / 86400000);
}

// Shift date string by N years
function _shiftYearsISO(iso, years) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y - years}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// Compute period historical min/max envelope by day-of-period.
// Returns {minLine: [...], maxLine: [...], medianLine: [...]} aligned with `currentSeries` length.
// `allHistory` should be entries from years OTHER than the current one.
// Uses P5/P95 by default (not absolute min/max) to avoid extreme outliers
// (e.g. 2022 gas crisis) crushing the Y axis.
function _historicalEnvelope(currentSeries, allHistory) {
  const len = currentSeries.length;
  // For each day-of-period (0..len-1), collect all historical values that fall on same month-day
  const buckets = Array.from({length: len}, () => []);
  currentSeries.forEach((cur, idx) => {
    const mmdd = cur.d.slice(5); // 'MM-DD'
    allHistory.forEach(h => {
      if (h.d.slice(5) === mmdd && h.avg != null) {
        buckets[idx].push(h.avg);
      }
    });
  });
  // Robust band (P5–P95) — typical regime
  const p5Line  = buckets.map(b => {
    if (!b.length) return null;
    if (b.length < 4) return Math.min(...b);
    const s = [...b].sort((a, b) => a - b);
    return _percentile(s, 0.05);
  });
  const p95Line = buckets.map(b => {
    if (!b.length) return null;
    if (b.length < 4) return Math.max(...b);
    const s = [...b].sort((a, b) => a - b);
    return _percentile(s, 0.95);
  });
  // Full band (P0–P100) — absolute min/max ever observed for this calendar day
  const minLine = buckets.map(b => b.length ? Math.min(...b) : null);
  const maxLine = buckets.map(b => b.length ? Math.max(...b) : null);
  const medianLine = buckets.map(b => {
    if (!b.length) return null;
    const s = [...b].sort((a, b) => a - b);
    return _percentile(s, 0.5);
  });
  // Backwards-compat aliases: maxLine/minLine map to the P5-P95 band by default
  // (consumers that don't read p0/p100 keep the typical-regime behaviour).
  return {
    minLine: p5Line, maxLine: p95Line, medianLine,
    p5Line, p95Line, p0Line: minLine, p100Line: maxLine,
    sampleCount: buckets.map(b => b.length),
  };
}

// hex/rgb color helper: convert "#RRGGBB" to rgba string
function _toRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) {
    return `rgba(20,211,169,${alpha})`;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Zoom plugin config: click-and-drag rectangle zoom (XY), no wheel zoom.
// Reset via double-click on the chart or via dedicated reset button.
// Falls back to {} if chartjs-plugin-zoom is not loaded.
function _zoomConfig(opts = {}) {
  if (typeof window.Chart === 'undefined' || !window.Chart.registry || !window.Chart.registry.plugins.get('zoom')) {
    return {};
  }
  const mode = opts.mode || 'xy';
  return {
    pan: { enabled: false },
    zoom: {
      drag: {
        enabled: true,
        backgroundColor: 'rgba(20,211,169,0.15)',
        borderColor: 'rgba(20,211,169,0.6)',
        borderWidth: 1,
      },
      wheel: { enabled: false },
      pinch: { enabled: true },
      mode,
    },
    limits: opts.limits || { y: { min: 'original', max: 'original' } },
  };
}

// Reusable reset zoom button HTML — pass the JS expression to call.
// Usage: _resetZoomBtn("HIST.charts['hsz-canvas']") or _resetZoomBtn("_rowCharts[0]") etc.
function _resetZoomBtn(chartRefExpr, label) {
  return `<button onclick="event.stopPropagation();(function(){var c=${chartRefExpr};if(c&&c.resetZoom)c.resetZoom();})()" title="Reset zoom to original view"
    style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--tx3);padding:3px 10px;font-size:9px;border-radius:3px;cursor:pointer;font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.04em;text-transform:uppercase">↺ ${label || 'Reset'}</button>`;
}

// Generic onClick handler for charts: double-click resets the zoom.
function _dblClickResetZoom(canvasId, chartsObj) {
  return (evt) => {
    if (evt && evt.native && evt.native.detail === 2) {
      const c = chartsObj ? chartsObj[canvasId] : null;
      if (c && typeof c.resetZoom === 'function') c.resetZoom();
    }
  };
}


// ════════════════════════════════════════════
// BLOCK 3 · MULTI ZONE SECTION (insta tabs)
// Tabs: Lines · Heatmap · Profile · Bands · Spread
// ════════════════════════════════════════════

const HMZ = {
  tab: 'lines',
  tabs: [
    { id: 'lines',   label: 'Lines' },
    { id: 'heatmap', label: 'Heatmap' },
    { id: 'bands',   label: 'Bands' },
    { id: 'spread',  label: 'Spread' },
  ],
  // Heatmap granularity: 'day' | 'week' | 'month' | 'dow'
  // - day/week/month: chronological cells, useful for short / medium / long windows
  // - dow: zone × day-of-week (Mon..Sun), aggregated across the whole window
  // HoD (hour of day) is not supported on daily-aggregated history; peak/off-peak
  // is already captured in the Lines tab via the peakAvg/offAvg fields.
  heatmapMode: 'day',
  // Spread sub-mode: 'vsRef' (temporal series: zone − baseline) | 'vsPeers' (scatter BESS-hotspot).
  // Persisted in localStorage under 'pk_hmz_spreadMode' to honour the user's last choice.
  spreadMode: (() => {
    try {
      const v = localStorage.getItem('pk_hmz_spreadMode');
      return (v === 'vsRef' || v === 'vsPeers') ? v : 'vsRef';
    } catch (_) { return 'vsRef'; }
  })(),
};

function setHistMultiTab(tabId) {
  HMZ.tab = tabId;
  buildHistMultiTabs();
  _hmzSetTitle(tabId);
  // Return the promise so callers (e.g. FS onclick) can wait for the
  // async rebuild before refreshing the fullscreen.
  return renderHistMulti();
}
window.setHistMultiTab = setHistMultiTab;

// ── HMZ dynamic title block ──────────────────────────────────────────────
// Mirrors _ccSetTitle (Daily Cross-zone). Populates #hmz-eyebrow / #hmz-title /
// #hmz-subtitle based on the active HMZ tab + current window + selected zones.
// Called by setHistMultiTab on tab change, and also by renderHistMulti() so
// the title stays in sync when zones or window change.
function _hmzSetTitle(tab) {
  tab = tab || HMZ.tab || 'lines';
  const selected = (window._compareZones || window._userZones || new Set(['FR']));
  const zonesCount = (selected.size != null) ? selected.size : (selected.length || 0);
  const win = (HIST.windows && HIST.windows['hmz']) || '3M';
  const winLabel = (win === 'YTD') ? 'YTD' : (win === 'All' ? 'All-time' : win);
  const baseline = HIST.hmzBaseline || 'FR';
  const heatmapMode = HMZ.heatmapMode || 'day';
  const heatmapLabel = { day:'daily', week:'weekly', month:'monthly', dow:'by day-of-week' }[heatmapMode] || heatmapMode;

  const titles = {
    lines: {
      eyebrow:  `Historical Cross-zone · Lines · ${zonesCount} zone${zonesCount > 1 ? 's' : ''}`,
      title:    'Daily averages overlay across selected zones',
      subtitle: `${winLabel} window · ENTSO-E`,
    },
    heatmap: {
      eyebrow:  `Historical Cross-zone · Heatmap · ${zonesCount} zone${zonesCount > 1 ? 's' : ''}`,
      title:    `Price intensity — ${heatmapLabel} resolution`,
      subtitle: `${winLabel} window · vs ${baseline} baseline · ENTSO-E`,
    },
    bands: {
      eyebrow:  `Historical Cross-zone · Bands · ${zonesCount} zone${zonesCount > 1 ? 's' : ''}`,
      title:    'Statistical envelope per zone',
      subtitle: `${winLabel} window · P10–P90 distribution · ENTSO-E`,
    },
    spread: {
      eyebrow:  `Historical Cross-zone · Spread · ${zonesCount} zone${zonesCount > 1 ? 's' : ''} vs ${baseline}`,
      title:    `Cross-zone spread vs ${baseline}`,
      subtitle: `${winLabel} window · zone − ${baseline} in €/MWh · ENTSO-E`,
    },
  };
  const t = titles[tab] || titles.lines;

  // Populate inline block
  const ey = document.getElementById('hmz-eyebrow');
  const ti = document.getElementById('hmz-title');
  const su = document.getElementById('hmz-subtitle');
  if (ey) ey.textContent = t.eyebrow;
  if (ti) ti.textContent = t.title;
  if (su) su.textContent = t.subtitle;
}
window._hmzSetTitle = _hmzSetTitle;


function buildHistMultiTabs() {
  const wrap = document.getElementById('hmz-tabs');
  if (!wrap) return;
  wrap.innerHTML = HMZ.tabs.map(t => {
    const on = t.id === HMZ.tab;
    return `<button onclick="setHistMultiTab('${t.id}')" style="
      padding:5px 12px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;
      border:none;background:${on?'var(--bg3)':'transparent'};
      color:${on?'var(--text)':'var(--tx3)'};
      letter-spacing:.03em;
    ">${t.label}</button>`;
  }).join('');
}

function setHmzBaseline(zone) {
  HIST.hmzBaseline = zone;
  return renderHistMulti();
}
window.setHmzBaseline = setHmzBaseline;

// Inline chip picker (same UX as Daily Compare zones · "SPREAD vs [chips]")
function _hmzPopulateRefChips(selected) {
  const host = document.getElementById('hmz-ref-chips');
  if (!host) return;
  const sel = Array.isArray(selected) ? selected : Array.from(selected || []);
  if (!sel.length) { host.innerHTML = ''; return; }
  let cur = HIST.hmzBaseline;
  if (!cur || !sel.includes(cur)) {
    cur = sel.includes('FR') ? 'FR' : sel[0];
    HIST.hmzBaseline = cur;
  }
  host.innerHTML = sel.map(z => {
    const isOn = z === cur;
    const col  = (window._zoneColorMap && window._zoneColorMap[z]) || '#4A6280';
    return `<button onclick="setHmzBaseline('${z}')" style="
      padding:3px 9px;border-radius:4px;font-size:10px;cursor:pointer;border:1px solid ${isOn?col:'rgba(255,255,255,.12)'};
      background:${isOn?col+'22':'transparent'};color:${isOn?col:'rgba(255,255,255,.55)'};
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.03em;transition:all .15s;
    ">${z}</button>`;
  }).join('');
}
window._hmzPopulateRefChips = _hmzPopulateRefChips;

function _hmzToggleRefWrap(mode) {
  // Kept for back-compat. Delegates to the unified _hmzUpdateTabContext.
  _hmzUpdateTabContext(mode);
}

// Switch Heatmap granularity. Persists the choice on HMZ.heatmapMode.
// ════════════════════════════════════════════════════════════════════
// Heatmap granularity auto-tuning
// When the user changes the time window (7D/1M/3M/6M/1Y/5Y/All), the
// heatmap granularity is automatically set so all cells fit on one screen
// without horizontal scroll. The logic is based on cell count, not the
// window key string, so YTD and other dynamic windows behave correctly.
//
// Cell budget (target: stay under ~60 cells horizontal):
//   ≤ 14 days  → Day   (one cell per day, max ~14 cells)
//   15-90 days → Week  (one cell per week, max ~13 cells)
//   > 90 days  → Month (one cell per month, max ~60 cells)
//
// Manual override: if the user clicks a different granularity inside a
// given window, that choice sticks until the window changes again. The
// override is tracked via HMZ._heatmapModeManual flag; resetting on
// window change brings back the auto-mode.
// ════════════════════════════════════════════════════════════════════
function _hmzAutoHeatmapMode(windowKey) {
  // Approximate days-per-window mapping (avoids needing the actual filtered
  // series length to make a decision). YTD is computed from today's date.
  const w = (windowKey || '').toUpperCase();
  let days = 90; // safe default
  if (w === '7D')       days = 7;
  else if (w === '1M')  days = 30;
  else if (w === '3M')  days = 90;
  else if (w === '6M')  days = 180;
  else if (w === '1Y')  days = 365;
  else if (w === '2Y')  days = 730;
  else if (w === '5Y')  days = 1825;
  else if (w === 'ALL') days = 3650;
  else if (w === 'YTD') {
    // Days since Jan 1 of the current year
    const today = new Date();
    const jan1 = new Date(today.getFullYear(), 0, 1);
    days = Math.floor((today - jan1) / 86400000) + 1;
  }

  if (days <= 14)  return 'day';
  if (days <= 90)  return 'week';
  return 'month';
}

// Called by setHistWindow when the HMZ window changes. Resets any manual
// override and re-applies the auto-tuned mode.
function _hmzApplyAutoHeatmapMode() {
  const win = HIST.windows['hmz'] || '3M';
  HMZ.heatmapMode = _hmzAutoHeatmapMode(win);
  HMZ._heatmapModeManual = false;
}

function setHmzHeatmapMode(mode) {
  if (!['day','week','month','dow'].includes(mode)) return;
  HMZ.heatmapMode = mode;
  HMZ._heatmapModeManual = true; // mark as user override
  renderHistMulti();
}
window.setHmzHeatmapMode = setHmzHeatmapMode;

// Switch Spread sub-mode (vsRef temporal series / vsPeers scatter).
// Persists to localStorage so the user's last choice is restored.
function setHmzSpreadMode(mode) {
  if (mode !== 'vsRef' && mode !== 'vsPeers') return;
  HMZ.spreadMode = mode;
  try { localStorage.setItem('pk_hmz_spreadMode', mode); } catch (_) {}
  renderHistMulti();
}
window.setHmzSpreadMode = setHmzSpreadMode;

function _hmzToggleHeatmapControls(mode) {
  // Kept for back-compat. Delegates to the unified _hmzUpdateTabContext.
  _hmzUpdateTabContext(mode);
}

// ════════════════════════════════════════════════════════════════════
// _hmzUpdateTabContext(tab) — single source of truth for the HMZ tabbar:
//   - Decides which sub-toggle is shown (centered under the active tab)
//   - Decides which zone chips are shown (right of the tabs row)
//   - Repositions the sub-toggle pixel-perfect via pkPositionSubToggle
//
// Sub-toggle visibility per tab:
//   lines   → none
//   heatmap → granularity (Day/Week/Month/DoW)
//   bands   → none
//   spread  → mode (vs Ref / vs Peers)
//
// Zone chips visibility per tab:
//   heatmap          → baseline chips
//   spread + vsRef   → baseline chips
//   spread + vsPeers → none (scatter cross-zones, no baseline)
//   lines / bands    → none
// ════════════════════════════════════════════════════════════════════
function _hmzUpdateTabContext(tab) {
  const subToggle   = document.getElementById('hmz-sub-toggle');
  const tabChipsEl  = document.getElementById('hmz-tab-chips');
  const tabsCont    = document.getElementById('hmz-tabs');
  if (!subToggle || !tabChipsEl) return;

  // ─── Decide content of the sub-toggle ───
  let subToggleHTML = '';
  if (tab === 'heatmap') {
    const modes = [
      { id: 'day',   label: 'Day' },
      { id: 'week',  label: 'Week' },
      { id: 'month', label: 'Month' },
      { id: 'dow',   label: 'DoW' },
    ];
    const cur = HMZ.heatmapMode || 'day';
    subToggleHTML = modes.map(m => window.pkPill({
      label:    m.label,
      active:   m.id === cur,
      onClick:  `setHmzHeatmapMode('${m.id}')`,
      dataAttr: `data-hmz-hm-mode="${m.id}"`,
    })).join('');
  } else if (tab === 'spread') {
    const modes = [
      { id: 'vsRef',   label: 'vs Ref' },
      { id: 'vsPeers', label: 'vs Peers' },
    ];
    const cur = HMZ.spreadMode || 'vsRef';
    subToggleHTML = modes.map(m => window.pkPill({
      label:    m.label,
      active:   m.id === cur,
      onClick:  `setHmzSpreadMode('${m.id}')`,
      dataAttr: `data-hmz-sm="${m.id}"`,
    })).join('');
  }

  if (subToggleHTML) {
    subToggle.innerHTML = subToggleHTML;
    subToggle.style.display = 'inline-flex';
  } else {
    subToggle.style.display = 'none';
    subToggle.innerHTML = '';
  }

  // ─── Decide content of the zone chips (right of the tabs row) ───
  const showChips =
    (tab === 'heatmap') ||
    (tab === 'spread' && HMZ.spreadMode !== 'vsPeers');

  if (showChips) {
    const sel = Array.from(window._hmzSelected || []);
    if (sel.length) {
      let baseline = HIST.hmzBaseline;
      if (!baseline || !sel.includes(baseline)) {
        baseline = sel.includes('FR') ? 'FR' : sel[0];
        HIST.hmzBaseline = baseline;
      }
      tabChipsEl.innerHTML = sel.map(z => {
        const col = (window._zoneColorMap && window._zoneColorMap[z]) || '#4A6280';
        return window.pkZoneChip({
          code: z,
          active: z === baseline,
          color: col,
          onClick: `setHmzBaseline('${z}')`,
        });
      }).join('');
      tabChipsEl.style.display = 'flex';
    } else {
      tabChipsEl.style.display = 'none';
      tabChipsEl.innerHTML = '';
    }
  } else {
    tabChipsEl.style.display = 'none';
    tabChipsEl.innerHTML = '';
  }
}

// (Resize handler removed: sub-toggle is now left-aligned via static CSS,
//  no JS positioning required.)

async function renderHistMulti() {
  buildHistMultiTabs();
  const w = HIST.windows['hmz'] || '3M';
  // Auto-tune heatmap granularity to the window unless the user has explicitly
  // overridden it during this window (HMZ._heatmapModeManual). At first load
  // the flag is undefined → falsy → auto-apply.
  if (!HMZ._heatmapModeManual) {
    HMZ.heatmapMode = _hmzAutoHeatmapMode(w);
  }
  // Refresh dynamic title (window/baseline/heatmapMode may have changed)
  if (typeof _hmzSetTitle === 'function') _hmzSetTitle(HMZ.tab);
  const s = await fetchSummary();
  if (!s?.zones) return;

  updateZoneLabels();

  const selected = getUserZones().filter(z => s.zones[z]);
  if (!selected.length) {
    _hmzPlaceholder('No zone selected');
    return;
  }
  // Expose for the controls populator (Heatmap baseline picker)
  window._hmzSelected = selected;

  // Build per-zone filtered data + stats
  const perZone = {};
  const stats = {};
  selected.forEach(z => {
    perZone[z] = filterByWindow(s.zones[z], w);
    stats[z] = _statsForZone(perZone[z]);
  });

  // KPI strip — baseline is user-configurable via the Compare header dropdown
  let baseline = HIST.hmzBaseline || 'FR';
  // Fallback: if the chosen baseline isn't in the selected zones, use FR or the first one
  if (!selected.includes(baseline)) {
    baseline = selected.includes('FR') ? 'FR' : selected[0];
  }
  const baseStats = stats[baseline];

  // KPI 1 · Zones loaded (value = zone count, meta = loaded avg + baseline tag)
  // Loaded avg = simple mean of per-zone period averages.
  const validStats = selected.filter(z => stats[z]).map(z => ({ z, avg: stats[z].avg }));
  const loadedAvg = validStats.length
    ? validStats.reduce((s, x) => s + x.avg, 0) / validStats.length
    : null;
  document.getElementById('hmz-kpi-zones-v').innerHTML = selected.length + '<span class="kpi-unit">zones</span>';
  const zonesMetaEl = document.getElementById('hmz-kpi-zones-meta');
  if (zonesMetaEl) {
    zonesMetaEl.innerHTML = loadedAvg != null
      ? `avg <strong style="color:var(--tx)">${loadedAvg.toFixed(2)} €/MWh</strong> · ${baseline} baseline`
      : `${baseline} baseline`;
  }

  // KPI 2-3-4 · Cheapest / Most expensive / Spread
  let cheap = null, pricey = null;
  if (validStats.length) {
    validStats.sort((a, b) => a.avg - b.avg);
    cheap = validStats[0];
    pricey = validStats[validStats.length - 1];
    document.getElementById('hmz-kpi-cheapest-v').innerHTML = cheap.avg.toFixed(2) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-cheapest-meta').textContent = cheap.z;
    document.getElementById('hmz-kpi-priciest-v').innerHTML = pricey.avg.toFixed(2) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-priciest-meta').textContent = pricey.z;
    document.getElementById('hmz-kpi-spread-v').innerHTML = (pricey.avg - cheap.avg).toFixed(2) + '<span class="kpi-unit">€/MWh</span>';
  }

  // KPI 5 · FR vs cheapest (gap = FR avg − cheapest avg)
  // Convention: red if FR > cheapest (FR is more expensive than the bargain market),
  //              green if FR ≤ cheapest (FR is the bargain or tied with it),
  //              flat if FR not loaded.
  const frEntry = validStats.find(x => x.z === 'FR');
  const frgapCard = document.getElementById('hmz-kpi-frgap');
  if (frgapCard) frgapCard.classList.remove('kpi-up', 'kpi-down', 'kpi-flat');
  if (frEntry && cheap) {
    const gap = frEntry.avg - cheap.avg;
    const pct = cheap.avg > 0 ? (gap / cheap.avg) * 100 : 0;
    document.getElementById('hmz-kpi-frgap-v').innerHTML =
      (gap >= 0 ? '+' : '') + gap.toFixed(2) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-frgap-meta').innerHTML =
      (pct >= 0 ? '+' : '') + pct.toFixed(1) + '% · ' + cheap.z + ' cheapest';
    // Color class: monter = rouge (FR plus cher = signal défavorable)
    if (frgapCard) {
      if (frEntry.z === cheap.z) frgapCard.classList.add('kpi-up');   // FR is the cheapest itself
      else if (gap > 0)         frgapCard.classList.add('kpi-down');  // FR more expensive than cheapest
      else                       frgapCard.classList.add('kpi-up');   // FR equal or cheaper (rare)
    }
  } else {
    // FR not loaded
    document.getElementById('hmz-kpi-frgap-v').innerHTML = '--<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-frgap-meta').textContent = 'FR not loaded';
    if (frgapCard) frgapCard.classList.add('kpi-flat');
  }

  // Period label
  let firstD = null, lastD = null;
  Object.values(perZone).forEach(arr => {
    if (arr.length) {
      const f = arr[0].d, l = arr[arr.length-1].d;
      if (!firstD || f < firstD) firstD = f;
      if (!lastD || l > lastD)   lastD = l;
    }
  });
  const periodEl = document.getElementById('hmz-period');
  if (periodEl && firstD && lastD) periodEl.textContent = periodLabel([{d:firstD},{d:lastD}]);

  // Toggle canvas vs heatmap
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = '';
  if (heatmap) heatmap.style.display = 'none';

  // ── Analyst banner (amber style ◈ + Market read) ──
  const anchor = document.getElementById('hmz-analyst-banner-anchor');
  if (anchor && cheap && pricey && typeof _buildAnalystBanner === 'function') {
    const frGap = frEntry ? (frEntry.avg - cheap.avg) : null;
    const modeMap = { lines: 'ccLines', heatmap: 'ccHeatmap', profile: 'ccProfile', bands: 'ccBands', spread: 'ccSpread', dist: 'ccLines' };
    const bannerHtml = _buildAnalystBanner(modeMap[HMZ.tab] || 'ccLines', {
      cheap, pricey, frGap, loadedAvg, zoneCount: validStats.length, view: HMZ.tab,
    });
    anchor.innerHTML = bannerHtml || '';
  } else if (anchor) {
    anchor.innerHTML = '';
  }

  // Normalise legacy tab aliases BEFORE rendering the table, so the table
  // columns match the actually-rendered chart.
  //   'profile' → Heatmap mode DoW (folded in 2026-05)
  //   'dist'    → Bands (folded in 2026-05; same boxplot semantic, lighter visuals)
  if (HMZ.tab === 'profile') { HMZ.tab = 'heatmap'; HMZ.heatmapMode = 'dow'; }
  else if (HMZ.tab === 'dist') { HMZ.tab = 'bands'; }

  // Render HMZ data table (same template as Daily Compare zones · compact)
  renderHmzTable(HMZ.tab, stats, selected, baseline);

  // Update the tabbar context: sub-toggle + tab-contextual zone chips,
  // pixel-perfect centered under the active tab.
  _hmzUpdateTabContext(HMZ.tab);

  // Dispatch by tab
  if (HMZ.tab === 'lines')   return _hmzRenderLines(perZone, selected);
  if (HMZ.tab === 'heatmap') return _hmzRenderHeatmap(perZone, selected);
  if (HMZ.tab === 'bands')   return _hmzRenderBands(perZone, selected, baseline);
  if (HMZ.tab === 'spread')  return _hmzRenderSpread(perZone, selected, baseline);
  return _hmzPlaceholder('🚧 ' + HMZ.tab + ' · data ready · chart coming next');
}
window.renderHistMulti = renderHistMulti;

// ═══════════════════════════════════════════════════════════════════
//  HMZ data table · STRICTLY MIRRORS Daily Compare zones (compact 9px 6px, 11px, 2 decimals)
//  ─ Header columns adapt to the active mode (lines/heatmap/profile/bands/spread)
//  ─ Body styled identically to ccBody* in prices.js
//  ─ Hover/click row → highlight matching curve in #hmz-canvas
// ═══════════════════════════════════════════════════════════════════
function renderHmzTable(view, stats, selected, baseline) {
  const thead = document.getElementById('hmz-data-thead');
  const tbody = document.getElementById('hmz-data-tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = _hmzTableHeader(view);
  const rows = selected.map(z => {
    const st = stats[z];
    if (!st) return null;
    return { code: z, ...st };
  }).filter(Boolean);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text3);text-align:center;padding:9px 6px;font-size:11px">No zones selected</td></tr>`;
    return;
  }
  let html = '';
  switch (view) {
    case 'heatmap': html = _hmzBodyHeatmap(rows); break;
    case 'profile': html = _hmzBodyProfile(rows); break;
    case 'bands':   html = _hmzBodyBands(rows, baseline); break;
    case 'spread':  html = _hmzBodySpread(rows, baseline); break;
    case 'lines':
    default:        html = _hmzBodyLines(rows);
  }
  tbody.innerHTML = html;
  _hmzWireRowHighlight();
}

function _hmzTableHeader(view) {
  // Spread column set depends on the active sub-mode:
  //   vsRef   → temporal series semantics (Avg spread, % vs ref, σ, min spread)
  //   vsPeers → BESS scatter semantics  (Peak avg, Off-pk avg, P-OP spread, Intraday range, Days)
  const spreadCols = (HMZ.spreadMode === 'vsPeers')
    ? [
        { w:'18%', label:'Zone' },
        { w:'12%', label:'Avg', sub:'€/MWh', align:'right' },
        { w:'14%', label:'Peak avg', sub:'€/MWh', align:'right' },
        { w:'14%', label:'Off-pk avg', sub:'€/MWh', align:'right' },
        { w:'14%', label:'P−OP spread', sub:'€/MWh', align:'right' },
        { w:'18%', label:'Intraday range', sub:'avg max−min · €/MWh', align:'right' },
        { w:'10%', label:'Days', sub:'count', align:'right' },
      ]
    : [
        { w:'22%', label:'Zone' },
        { w:'14%', label:'Avg', sub:'€/MWh', align:'right' },
        { w:'30%', label:'Avg spread vs ref', sub:'€/MWh + bar', align:'right' },
        { w:'14%', label:'% vs ref', sub:'(zone−ref)/ref', align:'right' },
        { w:'10%', label:'σ vs σ-ref', align:'right' },
        { w:'10%', label:'Min spread', align:'right' },
      ];

  const cols = {
    lines: [
      { w:'22%', label:'Zone' },
      { w:'10%', label:'Avg', sub:'€/MWh', align:'right' },
      { w:'30%', label:'Range', sub:'min — max · €/MWh', align:'left' },
      { w:'22%', label:'Peak / Off-pk avg', sub:'€/MWh', align:'right' },
      { w:'16%', label:'Intraday spread', sub:'€/MWh', align:'right' },
    ],
    heatmap: [
      { w:'22%', label:'Zone' },
      { w:'12%', label:'Avg', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Min', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Max', sub:'€/MWh', align:'right' },
      { w:'12%', label:'Neg hrs', sub:'count', align:'right' },
      { w:'26%', label:'High-stress hrs', sub:'count + bar', align:'right' },
    ],
    profile: [
      { w:'22%', label:'Zone' },
      { w:'14%', label:'Avg', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Peak avg', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Off-pk avg', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Peak shape', sub:'peak/avg %', align:'right' },
      { w:'12%', label:'Off-pk shape', sub:'off-pk/avg %', align:'right' },
      { w:'10%', label:'Spread P/OP', sub:'€/MWh', align:'right' },
    ],
    bands: [
      { w:'22%', label:'Zone' },
      { w:'14%', label:'Avg', sub:'€/MWh', align:'right' },
      { w:'12%', label:'σ', sub:'std-dev', align:'right' },
      { w:'14%', label:'Intraday', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Min', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Max', sub:'€/MWh', align:'right' },
      { w:'10%', label:'Days', sub:'count', align:'right' },
    ],
    spread: spreadCols,
  };
  const c = cols[view] || cols.lines;
  return '<tr>' + c.map(col => `
    <th style="width:${col.w};text-align:${col.align||'left'};padding:8px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" ${col.tip?`title="${col.tip}"`:''}>
      ${col.label}${col.sub?`<br><span style="color:var(--tx3);font-weight:400;font-size:9px">${col.sub}</span>`:''}
    </th>`).join('') + '</tr>';
}

function _hmzZoneCell(r) {
  const col = (window._zoneColorMap && window._zoneColorMap[r.code]) || _hmzZoneColor(r.code) || '#B8C9D9';
  const meta = (typeof ZONE_META !== 'undefined' && ZONE_META[r.code]) || {};
  const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[r.code]) || '';
  const country = meta.country || (typeof _HO_NAMES !== 'undefined' && _HO_NAMES[r.code]) || r.code;
  return `<td style="padding:9px 6px;vertical-align:middle">
    <span style="display:inline-block;width:3px;height:12px;background:${col};border-radius:2px;vertical-align:middle;margin-right:6px"></span>
    <span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${col};font-size:11px">${flag} ${r.code}</span>
    <span style="color:var(--text3);margin-left:5px;font-family:'Inter',sans-serif;font-size:10.5px">${country}</span>
  </td>`;
}
function _hmzZoneColor(code) {
  return (typeof HMZ_COLOR_FOR === 'function') ? HMZ_COLOR_FOR(code) : null;
}
function _hmzTr(r, cells) {
  return `<tr data-zone="${r.code}" style="border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;transition:background .15s">
    ${_hmzZoneCell(r)}${cells}
  </tr>`;
}

const _HMZ_TD_R = "text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle";
const _HMZ_SUB  = "color:var(--text3);font-size:9px";

function _hmzBodyLines(rows) {
  const allMins = rows.map(r => r.min).filter(v => v != null);
  const allMaxs = rows.map(r => r.max).filter(v => v != null);
  const globalMin = allMins.length ? Math.min(...allMins) : 0;
  const globalMax = allMaxs.length ? Math.max(...allMaxs) : 1;
  const globalRng = (globalMax - globalMin) || 1;
  return rows.map(r => {
    const col = (window._zoneColorMap && window._zoneColorMap[r.code]) || _hmzZoneColor(r.code) || '#B8C9D9';
    const leftPct  = r.min != null ? ((r.min - globalMin) / globalRng) * 100 : 0;
    const widthPct = (r.min != null && r.max != null) ? ((r.max - r.min) / globalRng) * 100 : 0;
    const cells = `
      <td style="${_HMZ_TD_R};font-weight:600;color:var(--text)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="padding:9px 6px;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:0 0 48px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${r.min<0?'var(--down)':'var(--text2)'};line-height:11px">
            ${r.min != null ? r.min.toFixed(2) : '--'}
          </div>
          <div style="flex:1;position:relative;height:8px">
            <div style="position:absolute;top:0;left:0;right:0;height:100%;background:rgba(255,255,255,0.05);border-radius:2px"></div>
            <div style="position:absolute;top:0;left:${leftPct.toFixed(1)}%;width:${Math.max(widthPct,2).toFixed(1)}%;height:100%;background:${col};opacity:.55;border-radius:2px"></div>
          </div>
          <div style="flex:0 0 48px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${r.max<0?'var(--down)':'var(--text2)'};line-height:11px">
            ${r.max != null ? r.max.toFixed(2) : '--'}
          </div>
        </div>
      </td>
      <td style="${_HMZ_TD_R}">
        <span style="color:var(--text)">${r.peakAvg != null ? r.peakAvg.toFixed(2) : '--'}</span> <span style="color:var(--text3)">/</span> <span style="color:var(--text2)">${r.offAvg != null ? r.offAvg.toFixed(2) : '--'}</span>
      </td>
      <td style="${_HMZ_TD_R};color:var(--text)">${r.intradaySpread != null ? r.intradaySpread.toFixed(2) : '--'}</td>`;
    return _hmzTr(r, cells);
  }).join('');
}

function _hmzBodyHeatmap(rows) {
  const maxHigh = Math.max(...rows.map(r => r.highH || 0), 1);
  return rows.map(r => {
    const negCol = (r.negH || 0) > 0 ? 'var(--down)' : 'var(--text3)';
    const highPct = ((r.highH || 0) / maxHigh) * 100;
    const highBarCol = highPct > 50 ? '#ED6965' : (highPct > 25 ? '#FBBF24' : '#14D3A9');
    const cells = `
      <td style="${_HMZ_TD_R};font-weight:600;color:var(--text)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:${r.min<0?'var(--down)':'var(--text2)'}">${r.min != null ? r.min.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text)">${r.max != null ? r.max.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:${negCol}">${(r.negH || 0).toFixed(0)}</td>
      <td style="${_HMZ_TD_R}">
        <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;width:100%">
          <span style="color:var(--text2)">${(r.highH || 0).toFixed(0)}</span>
          <span style="display:inline-block;width:50px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative">
            <span style="display:block;height:100%;width:${Math.min(highPct,100).toFixed(0)}%;background:${highBarCol};opacity:.7;border-radius:2px"></span>
          </span>
        </div>
      </td>`;
    return _hmzTr(r, cells);
  }).join('');
}

function _hmzBodyProfile(rows) {
  return rows.map(r => {
    const peakShape    = (r.peakAvg != null && r.avg != null && Math.abs(r.avg) > 0.5) ? (r.peakAvg / r.avg) * 100 : null;
    const offPeakShape = (r.offAvg != null  && r.avg != null && Math.abs(r.avg) > 0.5) ? (r.offAvg  / r.avg) * 100 : null;
    const spreadPO     = (r.peakAvg != null && r.offAvg != null) ? (r.peakAvg - r.offAvg) : null;
    const peakCol      = peakShape != null    && peakShape    > 100 ? 'var(--text)' : 'var(--warn)';
    const offPeakCol   = offPeakShape != null && offPeakShape < 100 ? 'var(--text2)' : 'var(--warn)';
    const spreadCol    = spreadPO == null ? 'var(--text3)' : (spreadPO < 0 ? 'var(--down)' : 'var(--text)');
    const cells = `
      <td style="${_HMZ_TD_R};font-weight:600;color:var(--text)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text)">${r.peakAvg != null ? r.peakAvg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.offAvg != null ? r.offAvg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:${peakCol}">${peakShape != null ? peakShape.toFixed(0)+'%' : '--'}</td>
      <td style="${_HMZ_TD_R};color:${offPeakCol}">${offPeakShape != null ? offPeakShape.toFixed(0)+'%' : '--'}</td>
      <td style="${_HMZ_TD_R};color:${spreadCol}">${spreadPO != null ? (spreadPO>=0?'+':'')+spreadPO.toFixed(2) : '--'}</td>`;
    return _hmzTr(r, cells);
  }).join('');
}

function _hmzBodyBands(rows, baseline) {
  return rows.map(r => {
    const cells = `
      <td style="${_HMZ_TD_R};font-weight:600;color:var(--text)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.sigma != null ? r.sigma.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text)">${r.intradaySpread != null ? r.intradaySpread.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:${r.min<0?'var(--down)':'var(--text2)'}">${r.min != null ? r.min.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text)">${r.max != null ? r.max.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text3)">${r.days != null ? r.days : '--'}</td>`;
    return _hmzTr(r, cells);
  }).join('');
}

function _hmzBodySpread(rows, baseline) {
  // Sub-mode dispatch: vsRef uses the temporal-spread semantics (existing
  // columns); vsPeers uses BESS-scatter semantics (Peak / Off-pk / P-OP / Intraday).
  if (HMZ.spreadMode === 'vsPeers') {
    return _hmzBodySpreadVsPeers(rows);
  }
  return _hmzBodySpreadVsRef(rows, baseline);
}

// vsRef: same columns as before — Avg, Avg spread vs ref + bar, % vs ref, σ-diff, min spread
function _hmzBodySpreadVsRef(rows, baseline) {
  const ref = rows.find(r => r.code === baseline);
  // Compute max absolute spread for divergent bar
  const validSpreads = rows.filter(r => r.code !== baseline && r.avg != null && ref?.avg != null).map(r => Math.abs(r.avg - ref.avg));
  const maxAbs = validSpreads.length ? Math.max(...validSpreads, 1) : 1;
  return rows.map(r => {
    if (r.code === baseline) {
      const cells = `<td colspan="5" style="text-align:center;padding:9px 6px;color:var(--text3);font-size:11px;font-style:italic">— reference (${baseline}) —</td>`;
      return _hmzTr(r, cells);
    }
    const avgSpread = (r.avg != null && ref?.avg != null) ? (r.avg - ref.avg) : null;
    const pctVsRef  = (avgSpread != null && Math.abs(ref?.avg || 0) > 0.5) ? (avgSpread / ref.avg) * 100 : null;
    const sigmaDiff = (r.sigma != null && ref?.sigma != null) ? (r.sigma - ref.sigma) : null;
    const minSpread = (r.min != null && ref?.min != null) ? (r.min - ref.min) : null;
    const avgCol = avgSpread == null ? 'var(--text3)' : (avgSpread > 0 ? 'var(--up)' : 'var(--down)');
    const pctCol = pctVsRef == null ? 'var(--text3)' : (pctVsRef > 0 ? 'var(--up)' : 'var(--down)');
    const sign = v => v >= 0 ? '+' : '';
    const divPct = avgSpread != null ? Math.min(Math.abs(avgSpread) / maxAbs, 1) * 50 : 0;
    const divHTML = avgSpread == null
      ? ''
      : (avgSpread >= 0
          ? `<span style="display:inline-block;width:60px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative;vertical-align:middle"><span style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,0.15)"></span><span style="position:absolute;left:50%;top:0;height:100%;width:${divPct.toFixed(1)}%;background:#ED6965;opacity:.75;border-radius:2px"></span></span>`
          : `<span style="display:inline-block;width:60px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative;vertical-align:middle"><span style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,0.15)"></span><span style="position:absolute;right:50%;top:0;height:100%;width:${divPct.toFixed(1)}%;background:#14D3A9;opacity:.75;border-radius:2px"></span></span>`);
    const cells = `
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R}">
        <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end">
          <span style="font-weight:600;color:${avgCol}">${avgSpread != null ? sign(avgSpread)+avgSpread.toFixed(2) : '--'}</span>
          ${divHTML}
        </div>
      </td>
      <td style="${_HMZ_TD_R};color:${pctCol}">${pctVsRef != null ? sign(pctVsRef)+pctVsRef.toFixed(0)+'%' : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${sigmaDiff != null ? sign(sigmaDiff)+sigmaDiff.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${minSpread != null ? sign(minSpread)+minSpread.toFixed(2) : '--'}</td>`;
    return _hmzTr(r, cells);
  }).join('');
}

// vsPeers: BESS scatter semantics — Avg, Peak avg, Off-pk avg, P−OP spread, Intraday range, Days
// Columns mirror the axes/dimensions of the scatter so the table tells the
// same story as the chart. P−OP shaded green when high (BESS-positive),
// Intraday range shaded teal when high (BESS-positive).
function _hmzBodySpreadVsPeers(rows) {
  // Compute medians for highlighting the "BESS hotspot" rows (top quadrant in
  // the scatter) — keep the highlight subtle so the table stays readable.
  const popVals = rows.map(r => (r.peakAvg != null && r.offAvg != null) ? (r.peakAvg - r.offAvg) : null).filter(v => v != null).sort((a,b)=>a-b);
  const intraVals = rows.map(r => r.intradaySpread).filter(v => v != null).sort((a,b)=>a-b);
  const popMed = popVals.length ? _percentile(popVals, 0.5) : null;
  const intraMed = intraVals.length ? _percentile(intraVals, 0.5) : null;

  return rows.map(r => {
    const popSpread = (r.peakAvg != null && r.offAvg != null) ? (r.peakAvg - r.offAvg) : null;
    const intra = r.intradaySpread;
    const isHotspot = (popSpread != null && intra != null && popMed != null && intraMed != null
                      && popSpread > popMed && intra > intraMed);
    // Highlight numbers above median (green = above median = "BESS-positive")
    const popCol = (popSpread != null && popMed != null && popSpread > popMed) ? '#14D3A9' : 'var(--text2)';
    const intraCol = (intra != null && intraMed != null && intra > intraMed) ? '#14D3A9' : 'var(--text2)';
    // Trailing badge for hotspot rows (kept very subtle)
    const badge = isHotspot
      ? '<span title="Above-median on both P−OP and Intraday — BESS hotspot" style="color:#14D3A9;font-size:10px;margin-left:4px">⚡</span>'
      : '';
    const cells = `
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.peakAvg != null ? r.peakAvg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.offAvg != null ? r.offAvg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:${popCol};font-weight:${popCol === '#14D3A9' ? '600' : '400'}">${popSpread != null ? popSpread.toFixed(2) : '--'}${badge}</td>
      <td style="${_HMZ_TD_R};color:${intraCol};font-weight:${intraCol === '#14D3A9' ? '600' : '400'}">${intra != null ? intra.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text3)">${r.days != null ? r.days : '--'}</td>`;
    return _hmzTr(r, cells);
  }).join('');
}

// Cross-highlight: hover/click row → highlight matching curve in #hmz-canvas
function _hmzWireRowHighlight() {
  const tbody = document.getElementById('hmz-data-tbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr[data-zone]').forEach(tr => {
    tr.onmouseenter = () => _hmzHighlightZone(tr.dataset.zone, false);
    tr.onmouseleave = () => _hmzHighlightZone(null, false);
    tr.onclick = () => {
      window._hmzFocusZone = (window._hmzFocusZone === tr.dataset.zone) ? null : tr.dataset.zone;
      _hmzHighlightZone(window._hmzFocusZone, true);
    };
  });
}
function _hmzHighlightZone(code, isPersistent) {
  const effective = code != null ? code : window._hmzFocusZone;
  const chart = HIST.charts && HIST.charts['hmz-canvas'];
  if (chart) {
    chart.data.datasets.forEach(ds => {
      const label = ds.label || '';
      const matches = !effective || label.startsWith(effective + ' ') || label.startsWith(effective + ' ·') || label.startsWith(effective + ' −') || label === effective || label.startsWith(effective);
      if (effective) {
        if (ds._origBorderWidth == null) ds._origBorderWidth = ds.borderWidth ?? 2;
        if (ds._origBorderColor == null) ds._origBorderColor = ds.borderColor;
        ds.borderWidth = matches ? 3 : ds._origBorderWidth;
        if (!matches && typeof ds._origBorderColor === 'string' && ds._origBorderColor.startsWith('#')) {
          ds.borderColor = ds._origBorderColor + '40';
        } else if (matches) {
          ds.borderColor = ds._origBorderColor;
        }
      } else {
        if (ds._origBorderWidth != null) ds.borderWidth = ds._origBorderWidth;
        if (ds._origBorderColor != null) ds.borderColor = ds._origBorderColor;
      }
    });
    chart.update('none');
  }
  const tbody = document.getElementById('hmz-data-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr[data-zone]').forEach(tr => {
      tr.style.background = (effective && tr.dataset.zone === effective) ? 'rgba(255,255,255,0.04)' : '';
    });
  }
}

function _hmzPlaceholder(msg) {
  const canvas = document.getElementById('hmz-canvas');
  if (!canvas) return;
  const wrap = canvas.parentNode;
  const old = wrap.querySelector('.no-data-msg');
  if (old) old.remove();
  canvas.style.display = 'none';
  const div = document.createElement('div');
  div.className = 'no-data-msg';
  div.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--tx3);font-size:12px;font-style:italic;letter-spacing:0.04em;text-align:center;padding:0 20px';
  div.innerHTML = msg;
  wrap.appendChild(div);
}

function _hmzRenderLines(perZone, selected) {
  // Union of dates
  const dateSet = new Set();
  selected.forEach(z => perZone[z].forEach(d => dateSet.add(d.d)));
  const labels = Array.from(dateSet).sort();

  const datasets = selected.map(z => {
    const map = {};
    perZone[z].forEach(d => { map[d.d] = d.avg; });
    return {
      label: z,
      data: labels.map(l => map[l] ?? null),
      borderColor: zoneColor(z),
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: zoneColor(z),
      pointHoverBorderColor: '#fff',
      pointHoverBorderWidth: 2,
      tension: 0.3,
      spanGaps: true,
      fill: false,
    };
  });

  // Inject zero line annotation when any value crosses zero (rare in daily avg
  // but possible during negative-price episodes); harmless when all positive.
  const zeroAnn = (typeof ccZeroLineAnnotation === 'function')
    ? { zeroLine: ccZeroLineAnnotation() }
    : {};

  mkHistChart('hmz-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: _HIST_TX3,
            font: { size: 10 },
            boxWidth: 10,
            padding: 10,
          },
          // Shared focus-on-click behaviour: click a zone → focus (others dim),
          // re-click → reset. Aligned with DA Cross-zone Lines.
          onClick: (e, item, legend) => {
            if (typeof window.pkLegendFocusClick === 'function') {
              window.pkLegendFocusClick(e, item, legend);
            }
          },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          },
        },
        annotation: { annotations: zeroAnn },
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 9 }, maxTicksLimit: 12 } },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 }, callback: v => v.toFixed(0) },
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 9 } },
          grace: '12%',
        },
      },
    },
  });
}

// ── HMZ · Heatmap (unified) · 4 granularities: Day / Week / Month / DoW ──
// Each cell encodes Δ vs baseline zone in colour; absolute €/MWh + Δ shown
// inside the cell. The bucketing changes with HMZ.heatmapMode but the rendering
// pipeline (matrix → deltas → colour → table) is shared.
function _hmzRenderHeatmap(perZone, selected) {
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = 'none';
  if (!heatmap) return;
  heatmap.style.display = 'block';

  // Baseline zone — use HIST.hmzBaseline if set, else first selected (often FR)
  let baseline = HIST.hmzBaseline || 'FR';
  if (!selected.includes(baseline)) baseline = selected[0] || 'FR';

  const mode = HMZ.heatmapMode || 'day';

  // ─── Bucket helpers ──────────────────────────────────────────────────
  // For each daily point d (shape: { d:'YYYY-MM-DD', avg:Number, ... })
  // return the bucket key + a sortable rank + a label for display.
  function bucketFor(d) {
    const iso = d.d;
    if (mode === 'day') {
      // Bucket = the ISO date itself, sortable as-is
      const [y, mo, da] = iso.split('-');
      return { key: iso, rank: iso, label: `${da}/${mo}` };
    }
    if (mode === 'week') {
      // ISO week (Mon-based). Use Thursday-of-week trick for ISO week number.
      const dt = new Date(iso + 'T00:00:00Z');
      const dow = (dt.getUTCDay() + 6) % 7; // 0=Mon
      dt.setUTCDate(dt.getUTCDate() - dow + 3); // Thursday of this ISO week
      const y = dt.getUTCFullYear();
      const jan1 = new Date(Date.UTC(y, 0, 1));
      const wn = Math.ceil(((dt - jan1) / 86400000 + 1) / 7);
      const key = `${y}-W${String(wn).padStart(2,'0')}`;
      return { key, rank: key, label: `W${String(wn).padStart(2,'0')} ’${String(y).slice(2)}` };
    }
    if (mode === 'month') {
      const ym = iso.slice(0, 7);
      const [y, mo] = ym.split('-');
      const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return { key: ym, rank: ym, label: `${names[parseInt(mo)-1]} ${y.slice(2)}` };
    }
    if (mode === 'dow') {
      // Day-of-week aggregated across the whole window. Mon..Sun.
      const dt = new Date(iso + 'T00:00:00Z');
      let dow = dt.getUTCDay();
      dow = (dow + 6) % 7; // 0=Mon
      const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      return { key: String(dow), rank: dow, label: labels[dow] };
    }
    return { key: iso, rank: iso, label: iso };
  }

  // Build buckets union (preserves order via rank)
  const bucketSet = new Map(); // key → { rank, label }
  selected.forEach(z => (perZone[z] || []).forEach(d => {
    if (d.avg == null) return;
    const b = bucketFor(d);
    if (!bucketSet.has(b.key)) bucketSet.set(b.key, { rank: b.rank, label: b.label });
  }));
  const buckets = Array.from(bucketSet.entries())
    .sort((a, b) => (a[1].rank < b[1].rank ? -1 : a[1].rank > b[1].rank ? 1 : 0))
    .map(([key, meta]) => ({ key, label: meta.label }));

  if (!buckets.length || !selected.length) {
    heatmap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:11px">No data</div>';
    return;
  }

  // Build matrix: avg per (zone, bucket)
  const matrix = {};
  selected.forEach(z => {
    matrix[z] = {};
    const byBucket = {};
    (perZone[z] || []).forEach(d => {
      if (d.avg == null) return;
      const b = bucketFor(d);
      if (!byBucket[b.key]) byBucket[b.key] = [];
      byBucket[b.key].push(d.avg);
    });
    buckets.forEach(b => {
      const arr = byBucket[b.key];
      matrix[z][b.key] = (arr && arr.length)
        ? arr.reduce((a, v) => a + v, 0) / arr.length
        : null;
    });
  });

  // Compute deltas vs baseline + find max abs delta for colour scaling
  let maxAbsDelta = 0;
  const deltas = {};
  selected.forEach(z => {
    deltas[z] = {};
    buckets.forEach(b => {
      const v = matrix[z][b.key];
      const baseV = matrix[baseline]?.[b.key];
      if (v != null && baseV != null && z !== baseline) {
        deltas[z][b.key] = v - baseV;
        if (Math.abs(deltas[z][b.key]) > maxAbsDelta) maxAbsDelta = Math.abs(deltas[z][b.key]);
      } else {
        deltas[z][b.key] = null;
      }
    });
  });
  if (maxAbsDelta < 1) maxAbsDelta = 1;

  // Colour by delta: green (cheaper than baseline) → grey (~0) → red (more expensive)
  // Same palette as the previous Heatmap to preserve user expectations.
  const colorForDelta = (d) => {
    if (d == null) return 'rgba(255,255,255,0.05)';
    const t = Math.max(-1, Math.min(1, d / maxAbsDelta));
    if (t < 0) {
      const intensity = Math.abs(t);
      return `rgba(20,211,169,${0.15 + intensity * 0.5})`;
    }
    if (t > 0) {
      return `rgba(237,105,101,${0.15 + t * 0.5})`;
    }
    return 'rgba(255,255,255,0.06)';
  };

  // ─── Dimensions tuned per mode ────────────────────────────────────────
  // Day with long windows = many narrow cells; Month/DoW = fewer wide cells.
  const cellMinWidth = ({
    day: 38, week: 52, month: 62, dow: 80,
  })[mode] || 60;
  const showDelta = mode !== 'dow'; // DoW has a single tile per cell; absolute is enough
  const valuePad  = ({ day: '4px 3px', week: '4px 4px', month: '5px 6px', dow: '8px 6px' })[mode] || '5px 4px';

  const modeLabel = ({ day:'Day', week:'Week', month:'Month', dow:'Day of week' })[mode] || mode;

  // ─── Render table ─────────────────────────────────────────────────────
  let html = `<div style="display:inline-block;min-width:100%;padding:8px">`;
  html += `<div style="font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace;margin-bottom:8px">
    Granularity: <b style="color:var(--tx)">${modeLabel}</b> · Baseline: <b style="color:var(--tx)">${baseline}</b> · Colour encodes Δ vs baseline
  </div>`;
  html += `<table style="border-collapse:separate;border-spacing:2px;font-size:9.5px;font-family:'JetBrains Mono',monospace">`;
  html += `<thead><tr><th style="text-align:left;padding:4px 8px;color:var(--tx3);font-weight:600">Zone</th>`;
  buckets.forEach(b => {
    html += `<th style="text-align:center;padding:4px;color:var(--tx3);font-weight:600;min-width:${cellMinWidth}px">${b.label}</th>`;
  });
  html += `</tr></thead><tbody>`;

  const renderRow = (z) => {
    const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
    const isBaseline = (z === baseline);
    let row = `<tr>`;
    row += `<td style="padding:4px 8px;color:var(--tx);font-weight:600;white-space:nowrap${isBaseline ? ';border-left:2px solid #FBBF24' : ''}">${flag} ${z}${isBaseline ? ' <span style="color:#FBBF24;font-size:8px">★</span>' : ''}</td>`;
    buckets.forEach(b => {
      const v = matrix[z][b.key];
      if (v == null) {
        row += `<td style="background:rgba(255,255,255,0.02);color:var(--tx3);text-align:center;padding:${valuePad};border-radius:3px;min-width:${cellMinWidth}px">--</td>`;
        return;
      }
      let bg, lines;
      if (isBaseline) {
        bg = 'rgba(255,255,255,0.06)';
        lines = `<div style="font-weight:600;color:var(--tx)">${v.toFixed(0)}</div>`;
      } else {
        const d = deltas[z][b.key];
        bg = colorForDelta(d);
        if (showDelta && d != null) {
          const dStr = (d >= 0 ? '+' : '') + d.toFixed(0);
          lines = `<div style="font-weight:600;color:#fff">${v.toFixed(0)}</div><div style="font-size:8.5px;color:rgba(255,255,255,0.7);font-weight:500">${dStr}</div>`;
        } else {
          lines = `<div style="font-weight:600;color:#fff">${v.toFixed(0)}</div>`;
        }
      }
      const title = `${z} · ${b.label}: ${v.toFixed(2)} €/MWh${!isBaseline && deltas[z][b.key] != null ? ' · Δ vs ' + baseline + ': ' + deltas[z][b.key].toFixed(2) : ''}`;
      row += `<td title="${title}" style="background:${bg};text-align:center;padding:${valuePad};border-radius:3px;min-width:${cellMinWidth}px">${lines}</td>`;
    });
    row += `</tr>`;
    return row;
  };
  // Baseline first, then others in their existing order (stable for the user's eye)
  html += renderRow(baseline);
  selected.filter(z => z !== baseline).forEach(z => { html += renderRow(z); });
  html += `</tbody></table>`;

  // Colour scale legend
  html += `<div style="display:flex;align-items:center;gap:10px;margin-top:14px;font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace">
    <span>Cheaper than ${baseline}</span>
    <div style="flex:1;max-width:280px;height:10px;background:linear-gradient(to right, rgba(20,211,169,0.7), rgba(255,255,255,0.1), rgba(237,105,101,0.7));border-radius:2px"></div>
    <span>More expensive</span>
    <span style="margin-left:12px">± ${maxAbsDelta.toFixed(0)} €/MWh max</span>
  </div>`;
  html += `</div>`;
  heatmap.innerHTML = html;
}


// ── HMZ · Bands · Range-bars stacked vertically on a shared €/MWh axis ──
// One row per zone. Visual language:
//   - P10–P90 segment: thin steel-blue line (#475569, stroke-width 2)
//   - P25–P75 box:     coloured by zone, opacity 0.40, height 8 (the "denser" range)
//   - P50 tick:        thick coloured vertical line (height 14, stroke-width 2.5)
//   - Shared X axis at top: nice ticks in €/MWh
// Aligned with DA Cross-zone Bands (same primitives, no boxplot whiskers/dots).
function _hmzRenderBands(perZone, selected, baseline) {
  // Render into the HTML heatmap container (SVG inside), hide the canvas.
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = 'none';
  if (!heatmap) return;
  heatmap.style.display = 'block';

  // Compute stats per zone
  const stats = selected.map(z => ({ zone: z, s: _boxStats((perZone[z] || []).map(d => d.avg)) }));
  const valid = stats.filter(x => x.s);
  if (!valid.length) {
    heatmap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:11px">No data</div>';
    return;
  }

  // ─── Global axis bounds (shared across all rows) ────────────────────
  // Use P10 / P90 union, widened by ~4% padding so segments don't touch edges.
  let gLo = Infinity, gHi = -Infinity;
  valid.forEach(({ s }) => {
    if (s.p10 < gLo) gLo = s.p10;
    if (s.p90 > gHi) gHi = s.p90;
  });
  if (!isFinite(gLo) || !isFinite(gHi)) { gLo = 0; gHi = 100; }
  const span0 = gHi - gLo || 1;
  gLo -= span0 * 0.04;
  gHi += span0 * 0.04;
  const gSpan = gHi - gLo || 1;

  // ─── "Nice" tick generator (1/2/5/10 × magnitude) ────────────────────
  const niceTicks = (lo, hi, count = 5) => {
    const raw = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    step *= mag;
    const first = Math.ceil(lo / step) * step;
    const ticks = [];
    for (let t = first; t <= hi + 1e-6; t += step) ticks.push(t);
    return ticks;
  };
  const axisTicks = niceTicks(gLo, gHi, 5);

  // ─── Dimensions ──────────────────────────────────────────────────────
  // SVG width is responsive (100%); the viewBox uses a logical 1000px width.
  // Per-zone row height ~36px, label gutter on the left.
  const W = 1000;
  const padL = 60;   // left gutter for zone labels
  const padR = 24;   // right padding
  const rowH = 38;   // height per zone row
  const headerH = 30; // top axis header height
  const baselineMark = 6;
  const nRows = valid.length;
  const H = headerH + nRows * rowH + 16; // +16 bottom padding
  const xOf = v => padL + ((v - gLo) / gSpan) * (W - padL - padR);

  // Sort zones by median P50 (cheapest → most expensive) — naturally creates
  // a vertical ranking, which is one of the key benefits of the shared axis.
  // Baseline marked with a yellow accent, kept in its sorted position.
  const sorted = [...valid].sort((a, b) => (a.s.p50 ?? 0) - (b.s.p50 ?? 0));

  // ─── Build SVG ───────────────────────────────────────────────────────
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMinYMin meet" style="display:block;font-family:'JetBrains Mono',monospace">`;

  // ─── Top axis: graduations + numeric labels ─────────────────────────
  svg += `<g>`;
  svg += `<line x1="${padL}" y1="${headerH - 8}" x2="${W - padR}" y2="${headerH - 8}" stroke="rgba(184,201,217,0.25)" stroke-width="0.5"/>`;
  axisTicks.forEach(t => {
    const x = xOf(t).toFixed(1);
    svg += `<line x1="${x}" y1="${headerH - 12}" x2="${x}" y2="${headerH - 4}" stroke="rgba(184,201,217,0.4)" stroke-width="0.5"/>`;
    svg += `<text x="${x}" y="${headerH - 16}" font-size="10" fill="#7A93AB" text-anchor="middle">${Math.round(t)}</text>`;
  });
  svg += `</g>`;

  // ─── Subtle vertical graduations spanning all rows ──────────────────
  axisTicks.forEach(t => {
    const x = xOf(t).toFixed(1);
    svg += `<line x1="${x}" y1="${headerH}" x2="${x}" y2="${H - 8}" stroke="rgba(120,140,170,0.06)" stroke-width="0.5"/>`;
  });

  // ─── One row per zone ───────────────────────────────────────────────
  sorted.forEach(({ zone, s }, i) => {
    const y = headerH + i * rowH + rowH / 2;
    const isBaseline = (zone === baseline);
    const col = (typeof zoneColor === 'function') ? zoneColor(zone) : '#14D3A9';
    const colFill = _toRgba ? _toRgba(col, 0.40) : col;

    // Zone label (left gutter) + baseline marker
    const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[zone]) || '';
    if (isBaseline) {
      svg += `<rect x="0" y="${y - rowH/2 + 4}" width="3" height="${rowH - 8}" fill="#FBBF24"/>`;
    }
    svg += `<text x="${padL - 8}" y="${y + 4}" font-size="11" fill="${col}" font-weight="700" text-anchor="end">${flag} ${zone}</text>`;

    // P10–P90 thin segment
    const xP10 = xOf(s.p10);
    const xP90 = xOf(s.p90);
    svg += `<line x1="${xP10.toFixed(1)}" y1="${y}" x2="${xP90.toFixed(1)}" y2="${y}" stroke="#475569" stroke-width="2" stroke-linecap="round"/>`;

    // P25–P75 box (coloured, opaque) — the "denser" range
    if (s.p25 != null && s.p75 != null) {
      const xP25 = xOf(s.p25);
      const xP75 = xOf(s.p75);
      const boxH = 8;
      svg += `<rect x="${xP25.toFixed(1)}" y="${(y - boxH/2).toFixed(1)}" width="${(xP75 - xP25).toFixed(1)}" height="${boxH}" fill="${colFill}" rx="2"/>`;
    }

    // P50 tick (thick coloured vertical line)
    const xP50 = xOf(s.p50);
    svg += `<line x1="${xP50.toFixed(1)}" y1="${(y - 7).toFixed(1)}" x2="${xP50.toFixed(1)}" y2="${(y + 7).toFixed(1)}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`;

    // P50 numeric label (small, to the right of the tick)
    const labelX = (xP50 + 8 < W - padR - 30) ? xP50 + 8 : xP50 - 8;
    const labelAnchor = (xP50 + 8 < W - padR - 30) ? 'start' : 'end';
    svg += `<text x="${labelX.toFixed(1)}" y="${(y - 8).toFixed(1)}" font-size="9" fill="${col}" font-weight="600" text-anchor="${labelAnchor}">${s.p50.toFixed(0)}</text>`;

    // Tooltip via <title> on the row group
    const tip = `${zone} · P10 ${s.p10.toFixed(1)} · P25 ${s.p25.toFixed(1)} · P50 ${s.p50.toFixed(1)} · P75 ${s.p75.toFixed(1)} · P90 ${s.p90.toFixed(1)} €/MWh`;
    svg += `<rect x="${padL}" y="${(y - rowH/2).toFixed(1)}" width="${W - padL - padR}" height="${rowH}" fill="transparent"><title>${tip}</title></rect>`;
  });

  svg += `</svg>`;

  // ─── Legend ──────────────────────────────────────────────────────────
  const legendHtml = `
    <div style="display:flex;align-items:center;gap:18px;margin-top:8px;font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace;flex-wrap:wrap">
      <span style="display:inline-flex;align-items:center;gap:5px">
        <svg width="20" height="6" viewBox="0 0 20 6"><line x1="0" y1="3" x2="20" y2="3" stroke="#475569" stroke-width="2" stroke-linecap="round"/></svg>
        P10–P90 range
      </span>
      <span style="display:inline-flex;align-items:center;gap:5px">
        <svg width="20" height="6" viewBox="0 0 20 6"><rect x="0" y="1" width="20" height="4" rx="1" fill="rgba(20,211,169,0.40)"/></svg>
        P25–P75 (IQR)
      </span>
      <span style="display:inline-flex;align-items:center;gap:5px">
        <svg width="6" height="14" viewBox="0 0 6 14"><line x1="3" y1="0" x2="3" y2="14" stroke="#14D3A9" stroke-width="2.5" stroke-linecap="round"/></svg>
        P50 median
      </span>
      <span style="margin-left:6px">Sorted by median (cheapest → most expensive) · Axis: €/MWh shared</span>
      ${baseline ? `<span style="margin-left:6px"><span style="display:inline-block;width:3px;height:10px;background:#FBBF24;vertical-align:middle;margin-right:4px"></span>Baseline: ${baseline}</span>` : ''}
    </div>`;

  heatmap.innerHTML = `<div style="padding:8px">${svg}${legendHtml}</div>`;
}


// ── HMZ · Spread · dispatch on HMZ.spreadMode ──────────────────────────
// 'vsRef'   → temporal Δ vs baseline (zone − baseline.avg over time)
// 'vsPeers' → scatter BESS-hotspot: x=Peak-OffPeak avg, y=Intraday spread avg
function _hmzRenderSpread(perZone, selected, baseline) {
  const mode = HMZ.spreadMode || 'vsRef';
  if (mode === 'vsPeers') {
    return _hmzRenderSpreadVsPeers(perZone, selected);
  }
  return _hmzRenderSpreadVsRef(perZone, selected, baseline);
}

// ── HMZ · Spread vs Ref · time-series of (zone − baseline) ─────────────
// Aligned with DA Cross-zone Spread semantically: one line per zone showing
// its delta vs the baseline through time. Zero line is the baseline.
function _hmzRenderSpreadVsRef(perZone, selected, baseline) {
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = '';
  if (heatmap) heatmap.style.display = 'none';

  // Build baseline lookup: date → avg
  const baseSeries = perZone[baseline] || [];
  const baseMap = {};
  baseSeries.forEach(d => { if (d.avg != null) baseMap[d.d] = d.avg; });

  // Union of dates across selected zones
  const dateSet = new Set();
  selected.forEach(z => (perZone[z] || []).forEach(d => { if (d.avg != null) dateSet.add(d.d); }));
  const labels = Array.from(dateSet).sort();

  if (!labels.length) {
    if (canvas) canvas.style.display = 'none';
    if (heatmap) {
      heatmap.style.display = 'block';
      heatmap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:11px">No data</div>';
    }
    return;
  }

  // Datasets: one per non-baseline zone. The baseline itself appears as the zero line.
  const datasets = selected
    .filter(z => z !== baseline)
    .map(z => {
      const map = {};
      (perZone[z] || []).forEach(d => { if (d.avg != null) map[d.d] = d.avg; });
      return {
        label: z,
        data: labels.map(l => {
          const v = map[l];
          const b = baseMap[l];
          return (v != null && b != null) ? (v - b) : null;
        }),
        borderColor: zoneColor(z),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: zoneColor(z),
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        tension: 0.3,
        spanGaps: true,
        fill: false,
      };
    });

  mkHistChart('hmz-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('Δ vs ' + baseline + ' (€/MWh)'),
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, padding: 10 },
          // Shared focus-on-click behaviour (DA Cross-zone Lines / HMZ Lines parity)
          onClick: (e, item, legend) => {
            if (typeof window.pkLegendFocusClick === 'function') {
              window.pkLegendFocusClick(e, item, legend);
            }
          },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              if (v == null) return ` ${ctx.dataset.label}: n/a`;
              const sign = v >= 0 ? '+' : '';
              return ` ${ctx.dataset.label}: ${sign}${v.toFixed(2)} €/MWh vs ${baseline}`;
            },
          },
        },
        annotation: {
          annotations: {
            zero: {
              type: 'line', yMin: 0, yMax: 0,
              borderColor: 'rgba(251,191,36,.55)', borderWidth: 1.2, borderDash: [4, 4],
              label: { display: true, content: baseline + ' = 0', position: 'start', color: '#FBBF24', backgroundColor: 'transparent', font: { size: 9, weight: 'bold' } },
            },
          },
        },
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 9 }, maxTicksLimit: 12 } },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 }, callback: v => (v >= 0 ? '+' : '') + v.toFixed(0) },
          title: { display: true, text: 'Δ vs ' + baseline + ' (€/MWh)', color: _HIST_TX3, font: { size: 9 } },
          grace: '12%',
        },
      },
    },
  });
}

// ── HMZ · Spread vs Peers · scatter: P-OP avg (X) vs Intraday spread (Y) ──
// Quadrant top-right = BESS hotspot (high peak-off-peak + high intraday volatility).
// One dot per zone, sized for legibility; labels rendered next to each dot.
function _hmzRenderSpreadVsPeers(perZone, selected) {
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = '';
  if (heatmap) heatmap.style.display = 'none';

  // Compute one (x,y) per zone
  const points = [];
  selected.forEach(z => {
    const pop = (perZone[z] || []).filter(d => d.peakAvg != null && d.offAvg != null);
    const sp = pop.length ? pop.reduce((a, d) => a + (d.peakAvg - d.offAvg), 0) / pop.length : null;
    const intra = (perZone[z] || []).filter(d => d.max != null && d.min != null);
    const sd = intra.length ? intra.reduce((a, d) => a + (d.max - d.min), 0) / intra.length : null;
    if (sp != null && sd != null) {
      points.push({ zone: z, x: sp, y: sd });
    }
  });

  if (!points.length) {
    if (canvas) canvas.style.display = 'none';
    if (heatmap) {
      heatmap.style.display = 'block';
      heatmap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:11px">No data</div>';
    }
    return;
  }

  // Compute medians for quadrant cutoffs
  const xs = points.map(p => p.x).sort((a, b) => a - b);
  const ys = points.map(p => p.y).sort((a, b) => a - b);
  const xMed = _percentile(xs, 0.5);
  const yMed = _percentile(ys, 0.5);
  const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.10 || 5;
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.10 || 5;
  const xMin = Math.min(...xs) - xPad;
  const xMax = Math.max(...xs) + xPad;
  const yMin = Math.max(0, Math.min(...ys) - yPad);
  const yMax = Math.max(...ys) + yPad;

  // One dataset per zone for distinct colours + legend entries
  const datasets = points.map(p => ({
    label: p.zone,
    data: [{ x: p.x, y: p.y }],
    backgroundColor: zoneColor(p.zone),
    borderColor: '#fff',
    borderWidth: 1.5,
    pointRadius: 9,
    pointHoverRadius: 12,
    pointStyle: 'circle',
    showLine: false,
  }));

  // Plugin to draw zone code labels next to each dot
  const labelsPlugin = {
    id: 'hmzScatterLabels',
    afterDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      if (!scales.x || !scales.y) return;
      ctx.save();
      ctx.font = "600 10px 'JetBrains Mono', monospace";
      ctx.textBaseline = 'middle';
      points.forEach(p => {
        const xPx = scales.x.getPixelForValue(p.x);
        const yPx = scales.y.getPixelForValue(p.y);
        // Place label slightly right and up so it doesn't overlap the dot
        ctx.fillStyle = zoneColor(p.zone);
        ctx.textAlign = 'left';
        ctx.fillText(p.zone, xPx + 12, yPx - 2);
      });
      ctx.restore();
    },
  };

  mkHistChart('hmz-canvas', {
    type: 'scatter',
    data: { datasets },
    options: {
      ...baseOptions('Intraday spread (€/MWh)'),
      plugins: {
        legend: {
          display: true, position: 'bottom',
          labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 10, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label} · P-OP: ${ctx.parsed.x.toFixed(1)} €/MWh · Intraday: ${ctx.parsed.y.toFixed(1)} €/MWh`,
          },
        },
        subtitle: {
          display: true,
          text: 'X = Peak−OffPeak spread · Y = Intraday range (max−min) · Top-right quadrant = BESS hotspot',
          color: _HIST_TX3, font: { size: 10 }, padding: { bottom: 8 },
        },
        annotation: {
          annotations: {
            xMed: { type: 'line', xMin: xMed, xMax: xMed, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderDash: [4, 4] },
            yMed: { type: 'line', yMin: yMed, yMax: yMed, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderDash: [4, 4] },
            hotspot: {
              type: 'box',
              xMin: xMed, xMax: xMax, yMin: yMed, yMax: yMax,
              backgroundColor: 'rgba(20,211,169,0.06)',
              borderColor: 'rgba(20,211,169,0.25)', borderWidth: 1,
              label: {
                display: true, content: '⚡ BESS hotspot',
                position: { x: 'end', y: 'start' },
                color: '#14D3A9', backgroundColor: 'transparent',
                font: { size: 10, weight: 'bold' },
              },
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear', min: xMin, max: xMax,
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          title: { display: true, text: 'Peak − OffPeak spread (€/MWh)', color: _HIST_TX3, font: { size: 10 } },
        },
        y: {
          min: yMin, max: yMax,
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          title: { display: true, text: 'Intraday spread (€/MWh)', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    },
    plugins: [labelsPlugin],
  });
}





// ════════════════════════════════════════════
// BLOCK 4 · MONTHLY SUMMARY TABLE
// ════════════════════════════════════════════

function setHistMonthlyZone(zone) {
  HIST.zones = HIST.zones || {};
  HIST.zones['hms'] = zone;
  renderHistMonthlyTable();
}
window.setHistMonthlyZone = setHistMonthlyZone;

async function renderHistMonthlyTable() {
  // NOTE: Block 4 standalone has been removed — monthly breakdown is now
  // a collapsible <details> inside each Historical Overview row detail
  // (see _renderHoDetailMonthly). This function is kept as a no-op stub
  // for backward compatibility with old window-toggle dispatchers.
  const tbody = document.getElementById('hms-table-tbody');
  if (!tbody) return;  // Block 4 was removed → silently skip

  const w = HIST.windows['hms'] || '2Y';
  const zone = (HIST.zones && HIST.zones['hms']) || 'FR';
  const s = await fetchSummary();
  if (!s?.zones?.[zone]) return;

  const filtered = filterByWindow(s.zones[zone], w);
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--tx3);font-size:11px">No data</td></tr>';
    return;
  }

  // Group by YYYY-MM
  const monthly = {};
  filtered.forEach(d => {
    const ym = d.d.slice(0, 7);
    if (!monthly[ym]) monthly[ym] = { rows: [] };
    monthly[ym].rows.push(d);
  });

  // Aggregate per month
  const months = Object.keys(monthly).sort();
  const aggregated = months.map(ym => {
    const rows = monthly[ym].rows;
    const st = _statsForZone(rows);
    const spread = (st?.peakAvg != null && st?.offAvg != null) ? (st.peakAvg - st.offAvg) : null;
    return { ym, ...st, spread };
  });

  // Compute vs LY (same month previous year)
  aggregated.forEach((row, i) => {
    const [y, m] = row.ym.split('-');
    const prevYm = (parseInt(y)-1) + '-' + m;
    const prev = aggregated.find(r => r.ym === prevYm);
    row.vsLY = (prev && prev.avg != null && row.avg != null) ? (row.avg - prev.avg) : null;
  });

  // Period label
  const periodEl = document.getElementById('hms-period');
  if (periodEl) periodEl.textContent = zone + ' · ' + months[0] + ' → ' + months[months.length-1];

  // Render rows (most recent first) — tbody declared at top of function
  tbody.innerHTML = aggregated.slice().reverse().map(r => {
    const fmt = v => v == null ? '--' : v.toFixed(1);
    const vsLY = r.vsLY == null ? '--' : (r.vsLY >= 0 ? '+' : '') + r.vsLY.toFixed(1);
    const vsLYColor = r.vsLY == null ? 'var(--tx3)' : (r.vsLY > 0 ? _HIST_DN : (r.vsLY < 0 ? _HIST_UP : 'var(--tx2)'));
    // Format month: Jan 2026
    const [y, m] = r.ym.split('-');
    const dt = new Date(parseInt(y), parseInt(m)-1, 1);
    const monthLabel = dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    return `<tr>
      <td style="font-family:'JetBrains Mono',monospace;font-weight:600">${monthLabel}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt(r.avg)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt(r.peakAvg)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt(r.offAvg)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt(r.spread)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:10px;color:${r.negH > 0 ? _HIST_WARN : 'var(--tx3)'}">${_fmtNegH(r.negH || 0)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${r.days}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${vsLYColor}">${vsLY}</td>
    </tr>`;
  }).join('');
}
window.renderHistMonthlyTable = renderHistMonthlyTable;


// ════════════════════════════════════════════
// AUTO-RENDER on tab activation
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Init date pickers: cap at today
  const todayStr = new Date().toISOString().slice(0, 10);
  const dfEl = document.getElementById('ho-date-from');
  const dtEl = document.getElementById('ho-date-to');
  if (dfEl) dfEl.max = todayStr;
  if (dtEl) dtEl.max = todayStr;

  // Populate [period] labels with default window
  pkUpdateHistPeriodLabels(HIST.windows?.ho || '3M');

  const obs = new MutationObserver(() => {
    const panel = document.getElementById('prtab-historical');
    if (panel && panel.classList.contains('active')) {
      if (!window._histInited) {
        window._histInited = true;
        setTimeout(() => {
          try { renderHistOverview(); } catch (e) { console.error('[hist] renderHistOverview failed:', e); }
          try { renderHistMulti(); } catch (e) { console.error('[hist] renderHistMulti failed:', e); }
          try { renderHistMonthlyTable(); } catch (e) { console.error('[hist] renderHistMonthlyTable failed:', e); }
        }, 50);
      }
    }
  });
  const target = document.getElementById('prtab-historical');
  if (target) obs.observe(target, { attributes: true, attributeFilter: ['class'] });
});

// ════════════════════════════════════════════
// Historical Cross-zone fullscreen — wraps the hmz chart + table in pkOpenFullscreen.
// Filters reproduce the view tabs (Lines/Heatmap/Profile/Bands/Spread) + window + ref.
// ════════════════════════════════════════════
function hmzOpenFullscreen() {
  if (typeof window.pkOpenFullscreen !== 'function') {
    console.error('[hmzOpenFullscreen] pkOpenFullscreen is not loaded');
    return;
  }
  const view = (window.HMZ && HMZ.tab) || 'lines';
  const w = (window.HIST && HIST.windows && HIST.windows['hmz']) || '3M';

  // Title / subtitle
  const periodMap = {
    '7D': '7 days', '1M': '1 month', '3M': '3 months', '6M': '6 months',
    '1Y': '1 year', '2Y': '2 years', '5Y': '5 years', 'All': 'all time', 'YTD': 'year-to-date',
  };
  const periodLabel = periodMap[w] || w;
  const viewTitle = {
    lines:'Lines', heatmap:'Heatmap', profile:'Profile', bands:'Bands', spread:'Spread'
  }[view] || 'Lines';
  // Pull zones from the actual source of truth (used by renderHistMulti)
  const selectedZones = Array.isArray(window._hmzSelected)
    ? window._hmzSelected
    : (typeof getUserZones === 'function' ? getUserZones() : []);
  const zonesCount = selectedZones.length;

  // ─── KPIs · clone inline strip ───
  const inlineKpis = document.getElementById('hmz-kpi-strip');
  const kpisHtml = inlineKpis
    ? `<div class="kpi-strip" style="grid-template-columns:repeat(5,1fr);width:100%">${inlineKpis.innerHTML}</div>`
    : null;

  // Clone the inline data table
  const inlineTable = document.getElementById('hmz-data-table');
  const tableHtml = inlineTable ? (
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
       <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--tx2);text-transform:uppercase">${viewTitle} — ${zonesCount} zone${zonesCount > 1 ? 's' : ''}</span>
       <span style="font-size:9px;color:var(--tx3);font-family:'JetBrains Mono',monospace">${periodLabel}</span>
     </div>
     ${inlineTable.outerHTML}`
  ) : null;

  // Clone the amber analyst banner
  const inlineBanner = document.getElementById('hmz-analyst-banner-anchor');
  const analysisHtml = inlineBanner ? inlineBanner.innerHTML : '';

  // Filters: window selector + view tabs + view-specific extras
  const windowsHtml = ['7D','1M','3M','6M','YTD','1Y','2Y','5Y','All'].map(wk => `
    <button onclick="Promise.resolve(setHistWindow('hmz','${wk}',this)).then(()=>hmzRefreshFullscreen())" style="
      padding:3px 8px;font-size:10px;border:none;cursor:pointer;border-radius:3px;
      color:${wk === w ? '#14D3A9' : '#7A93AB'};
      background:${wk === w ? 'rgba(20,211,169,0.18)' : 'transparent'};
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;
    ">${wk}</button>`).join('');

  const tabs = (window.HMZ && HMZ.tabs) || [
    { id:'lines', label:'Lines' }, { id:'heatmap', label:'Heatmap' },
    { id:'bands', label:'Bands' }, { id:'spread', label:'Spread' }
  ];
  const tabsHtml = tabs.map(t => `
    <button onclick="Promise.resolve(setHistMultiTab('${t.id}')).then(()=>hmzRefreshFullscreen())" style="
      padding:3px 8px;font-size:10px;border:none;cursor:pointer;border-radius:3px;
      color:${t.id === view ? '#14D3A9' : '#7A93AB'};
      background:${t.id === view ? 'rgba(20,211,169,0.18)' : 'transparent'};
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;
    ">${t.label}</button>`).join('');

  // ─── Build sub-toggle (Granularity for Heatmap, Mode for Spread) ──
  let subToggleHtml = '';
  let subToggleLabel = '';
  if (view === 'heatmap') {
    subToggleLabel = 'Granularity';
    const modes = [
      { id: 'day',   label: 'Day' },
      { id: 'week',  label: 'Week' },
      { id: 'month', label: 'Month' },
      { id: 'dow',   label: 'DoW' },
    ];
    const curMode = (window.HMZ && HMZ.heatmapMode) || 'day';
    subToggleHtml = modes.map(m => `
      <button onclick="Promise.resolve(setHmzHeatmapMode('${m.id}')).then(()=>hmzRefreshFullscreen())" style="
        padding:3px 8px;font-size:10px;border:none;cursor:pointer;border-radius:3px;
        color:${m.id === curMode ? '#14D3A9' : '#7A93AB'};
        background:${m.id === curMode ? 'rgba(20,211,169,0.18)' : 'transparent'};
        font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;
      ">${m.label}</button>`).join('');
  } else if (view === 'spread') {
    subToggleLabel = 'Mode';
    const modes = [
      { id: 'vsRef',   label: 'vs Ref' },
      { id: 'vsPeers', label: 'vs Peers' },
    ];
    const curMode = (window.HMZ && HMZ.spreadMode) || 'vsRef';
    subToggleHtml = modes.map(m => `
      <button onclick="Promise.resolve(setHmzSpreadMode('${m.id}')).then(()=>hmzRefreshFullscreen())" style="
        padding:3px 8px;font-size:10px;border:none;cursor:pointer;border-radius:3px;
        color:${m.id === curMode ? '#14D3A9' : '#7A93AB'};
        background:${m.id === curMode ? 'rgba(20,211,169,0.18)' : 'transparent'};
        font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;
      ">${m.label}</button>`).join('');
  }
  const subToggleBlock = subToggleHtml ? `
    <div style="display:flex;align-items:center;gap:5px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">${subToggleLabel}</span>
      <div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">${subToggleHtml}</div>
    </div>` : '';

  // ─── Baseline block (always shown when zones loaded; relevant for Heatmap/Spread but visible always for consistency) ──
  let baselineBlock = '';
  if (selectedZones.length) {
    const refCode = (window.HIST && HIST.hmzBaseline) || (selectedZones.includes('FR') ? 'FR' : selectedZones[0]);
    const refOptions = selectedZones.map(code => {
      return `<option value="${code}" ${code === refCode ? 'selected' : ''}>${code}</option>`;
    }).join('');
    baselineBlock = `
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Baseline</span>
        <select id="fs-hmz-baseline-select" style="background:var(--bg);border:1px solid var(--bd);color:var(--tx);font-size:11px;padding:3px 8px;border-radius:4px;font-family:inherit;cursor:pointer;color-scheme:dark">
          ${refOptions}
        </select>
      </div>`;
  }

  // ─── Filters: Baseline | View | SubToggle | Period (Context-first order) ──
  const filtersHtml = `
    ${baselineBlock}
    <div style="display:flex;align-items:center;gap:5px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">View</span>
      <div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">${tabsHtml}</div>
    </div>
    ${subToggleBlock}
    <div style="display:flex;align-items:center;gap:5px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Period</span>
      <div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px;flex-wrap:wrap">${windowsHtml}</div>
    </div>`;

  // Detect if this view renders HTML/SVG (Heatmap, Bands) or Chart.js (Lines, Spread).
  // HTML/SVG views go through #hmz-heatmap; Chart.js views go through #hmz-canvas.
  const isHtmlView = (view === 'heatmap' || view === 'bands');

  (window.pkOpenOrUpdate || window.pkOpenFullscreen)({
    title: `Cross-zone — Historical · ${viewTitle}`,
    subtitle: `${periodLabel} · ${zonesCount} zone${zonesCount > 1 ? 's' : ''} · ENTSO-E`,
    filenameStem: `powerklock_historical_crosszone_${view}_${w}`,
    storageKey: 'historical-crosszone',
    kpis: kpisHtml ? { html: kpisHtml } : null,
    table: tableHtml ? { html: tableHtml } : null,
    analysis: { html: analysisHtml },
    filters: {
      html: filtersHtml,
      wire: (hostEl) => {
        const blSel = hostEl.querySelector('#fs-hmz-baseline-select');
        if (blSel) {
          blSel.addEventListener('change', (e) => {
            const newBaseline = e.target.value;
            Promise.resolve(setHmzBaseline(newBaseline)).then(() => hmzRefreshFullscreen());
          });
        }
      },
    },
    chartSource: window.pkBuildChartSource({
      chartId: 'hmz-canvas',
      htmlContainerId: 'hmz-heatmap',
      isHtmlView: () => isHtmlView,
      chartsRegistry: () => (typeof HIST !== 'undefined' && HIST.charts) || {},
    }),
    onCSV: () => buildHmzCSV(),
  });

  // Tag the overlay so we can detect "HMZ fullscreen is open" from elsewhere
  // (zones-changed listener uses this to refresh the FS reactively).
  const overlayEl = document.getElementById('pk-fs-overlay');
  if (overlayEl) overlayEl.setAttribute('data-fs-context', 'hmz');
}
window.hmzOpenFullscreen = hmzOpenFullscreen;

// Detect whether HMZ fullscreen is currently open.
function _hmzFsIsOpen() {
  return !!document.querySelector('#pk-fs-overlay[data-fs-context="hmz"]');
}

function hmzRefreshFullscreen() {
  // Hot-swap via pkOpenOrUpdate
  requestAnimationFrame(() => hmzOpenFullscreen());
}
window.hmzRefreshFullscreen = hmzRefreshFullscreen;

function buildHmzCSV() {
  const table = document.getElementById('hmz-data-table');
  if (!table) return null;
  const headerCells = table.querySelectorAll('thead th');
  const headers = Array.from(headerCells).map(th =>
    th.textContent.trim().replace(/\s+/g, ' ').split(/\s{2,}/)[0]
  );
  const dataRows = table.querySelectorAll('tbody tr');
  const rows = Array.from(dataRows).map(tr => {
    const cells = tr.querySelectorAll('td');
    return Array.from(cells).map(td => {
      const txt = td.textContent.trim().replace(/\s+/g, ' ');
      if (/[,"\n]/.test(txt)) return '"' + txt.replace(/"/g, '""') + '"';
      return txt;
    });
  });
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
