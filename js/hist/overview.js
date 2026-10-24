// js/hist/overview.js — Historical prices: Historical tab layout and block 1, the multi-zone overview table.
// Part of the former js/hist.js (lines 1099–2300), split without changes: the parts are plain scripts loaded
// in this order by index.html and share their globals as before.
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
    // Default: the 7 price zones of the Prices overview (data.js)
    const defaults = window.PK_DEFAULT_PRICE_ZONES || ['FR','DE_LU','BE','NL','ES','PT','IT_NORD'];
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
  // Re-render Historical sections (multi-zone) — only once the Historical tab
  // has been opened: they need the full price history, not loaded at start-up
  if (window._histInited) {
    if (typeof renderHistOverview === 'function') renderHistOverview();
    if (typeof renderHistMulti === 'function') renderHistMulti();
  }
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

  // Daily drill: zone dropdown now filters on user selection, so refresh
  // the open FS to update the dropdown options when zones change.
  if (fsOpen && fsOpen('daily-drill')) {
    // Re-open with the same idx (zone) — the FS hot-swaps via pkOpenOrUpdate.
    // We need to recompute idx since _pricesSorted may have shifted.
    const openCode = window._FS_DAILY_DRILL_CODE;
    if (openCode && typeof openRowFullscreen === 'function') {
      const newIdx = (window._pricesSorted || []).findIndex(z => z.code === openCode);
      if (newIdx >= 0) {
        requestAnimationFrame(() => openRowFullscreen(newIdx));
      }
    }
  }
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
  Nuclear: { emoji: '', label: 'Nuclear', color: '#7B4B9C' },
  Wind:    { emoji: '', label: 'Wind',    color: '#14D3A9' },
  Solar:   { emoji: '', label: 'Solar',   color: '#FBBF24' },
  Hydro:   { emoji: '', label: 'Hydro',   color: '#3FA6B4' },
  Biomass: { emoji: '', label: 'Biomass', color: '#94D2BD' },
  Gas:     { emoji: '', label: 'Fossil',  color: '#ED6965' },
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

// Update the preset button styles to reflect the active preset.
// Aligned with pkPill design: rgba(20,211,169,0.45) for active border.
function _hoRenderPresetButtons() {
  ['focus', 'standard', 'all'].forEach(p => {
    const btns = document.querySelectorAll(`[data-ho-preset="${p}"]`);
    const active = window._HO_YPRESET === p;
    btns.forEach(b => {
      b.style.background = active ? 'rgba(20,211,169,0.18)' : 'transparent';
      b.style.borderColor = active ? 'rgba(20,211,169,0.45)' : 'var(--bd)';
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

// Days present in every zone's series; `restricted` when that is fewer
// than some zone has on its own.
function _pkCommonDays(perZone) {
  const zs = Object.keys(perZone).filter(z => perZone[z] && perZone[z].length);
  if (!zs.length) return { days: new Set(), restricted: false, min: 0, max: 0 };
  let common = new Set(perZone[zs[0]].map(e => e.d));
  zs.slice(1).forEach(z => { const own = new Set(perZone[z].map(e => e.d)); common = new Set([...common].filter(d => own.has(d))); });
  const counts = zs.map(z => perZone[z].length);
  return { days: common, restricted: Math.max(...counts) > common.size, min: Math.min(...counts), max: Math.max(...counts), n: common.size };
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
  if (zonesLabel) {
    const cov = _pkCommonDays(seriesByZone);
    zonesLabel.innerHTML = `${selected.length} zones loaded` + (cov.restricted
      ? ` · <span style="color:var(--warn)" title="Per-zone figures use each zone's own days; history backfill pending for most non-FR zones">coverage differs: ${cov.min}–${cov.max} days per zone</span>`
      : '');
  }

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
    : pkTodayISO();
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
    : pkTodayISO();
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
    : pkTodayISO();
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
