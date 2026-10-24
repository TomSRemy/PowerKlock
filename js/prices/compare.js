// js/prices/compare.js — Prices: cross-zone compare chart, its views, bands period, z-scores.
// Part of the former js/prices.js (lines 2250–4553), split without changes: plain scripts loaded in this order
// by index.html, sharing their globals as before.
// ════════════════════════════════════════════
// COMPARE CHART — multi-view router (Insta-style tabs)
// ════════════════════════════════════════════
// Available views: 'lines' (default), 'heatmap', 'profile', 'bands', 'spread'
// State: window._ccView holds the current view, window._ccSpreadRef the spread reference zone

const CC_VIEWS = [
  { key:'lines',   label:'Lines',   icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M3 12c4 0 4-7 8-7s4 9 8 9"/></svg>' },
  { key:'heatmap', label:'Heatmap', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/></svg>' },
  { key:'profile', label:'Profile', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h2l2-8 4 16 3-12 2 6h5"/></svg>' },
  { key:'bands',   label:'Bands',   icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/><path d="M3 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/><path d="M3 6c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/></svg>' },
  { key:'spread',  label:'Spread',  icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 19 4-7 6 4 7-12"/><path d="M14 4h7v7"/></svg>' },
];

function renderCCTabs() {
  const tabs = document.getElementById('cc-tabs');
  if (!tabs) return;
  const cur = window._ccView || 'lines';
  tabs.innerHTML = CC_VIEWS.map(v => `
    <button onclick="setCCView('${v.key}')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:${v.key===cur?'var(--bg3)':'transparent'};color:${v.key===cur?'var(--text)':'var(--text3)'};font-family:'Inter',sans-serif;font-weight:500;letter-spacing:.03em;transition:all .15s">
      <span style="display:inline-flex;width:14px;height:14px">${v.icon}</span>${v.label}
    </button>
  `).join('');
}

function setCCView(view) {
  window._ccView = view;
  renderCCTabs();
  // Legacy ref-wrap + bands-wrap are now hidden — their content is rendered
  // by _ccUpdateTabContext into the unified tabbar (sub-toggle + chips).
  const bandsWrap = document.getElementById('cc-bands-wrap');
  if (bandsWrap) bandsWrap.style.display = 'none';
  // Show/hide canvas vs heatmap div
  const canvas = document.getElementById('price-compare-canvas');
  const heat   = document.getElementById('cc-heatmap');
  if (canvas) canvas.style.display = view === 'heatmap' ? 'none' : 'block';
  if (heat)   heat.style.display   = view === 'heatmap' ? 'block' : 'none';
  // Shading legend is meaningful only for intraday-profile views (Lines / Profile / Bands / Spread)
  const shadeLegend = document.getElementById('cc-shading-legend');
  if (shadeLegend) shadeLegend.style.display = view === 'heatmap' ? 'none' : 'flex';
  // renderCompareChart dispatches to a sync renderer for most views, but
  // async renderCCBands for view='bands'. Capture and return so FS callers
  // can await via .then().
  const renderPromise = renderCompareChart();
  // Unified tabbar context: sub-toggle (Mode for Bands) + tab-contextual chips,
  // pixel-perfect centered under the active tab.
  _ccUpdateTabContext(view);
  return renderPromise;
}
window.setCCView = setCCView;

// ════════════════════════════════════════════════════════════════════
// _ccUpdateTabContext(view) — DA Cross-zone equivalent of _hmzUpdateTabContext.
// Decides sub-toggle (if any) + tab-contextual zone chips for the active view.
//
// Sub-toggle visibility per view:
//   lines / heatmap / profile / bands → none (Bands uses its own header for now)
//   spread → none (Daily Spread has no vs Ref / vs Peers split today)
//
// Zone chips visibility per view:
//   spread → baseline ref chips (replicates the old SPREAD vs picker)
//   others → none (kept off the tabbar for visual consistency)
// ════════════════════════════════════════════════════════════════════
function _ccUpdateTabContext(view) {
  const subToggle  = document.getElementById('cc-sub-toggle');
  const tabChipsEl = document.getElementById('cc-tab-chips');
  const tabsCont   = document.getElementById('cc-tabs');
  if (!subToggle || !tabChipsEl) return;

  // ─── Sub-toggle decision ────────────────────────────────────────────
  // bands → Mode (Z-score / Raw) pkPill, centered under Bands
  // others → none (Spread uses chips only; Lines/Heatmap/Profile have none)
  let subToggleHTML = '';
  if (view === 'bands' && typeof window.pkPill === 'function') {
    // Mode is meaningful only with >=2 zones; with 1 zone, the chart falls
    // back to raw bands. We still show the toggle (greyed if 1 zone? — keep
    // both clickable; the chart will adapt).
    const cur = window._ccBandsMode || 'zscore';
    const modes = [
      { id: 'zscore', label: 'Z-score' },
      { id: 'raw',    label: 'Raw' },
    ];
    subToggleHTML = modes.map(m => window.pkPill({
      label:    m.label,
      active:   m.id === cur,
      onClick:  `setCCBandsMode('${m.id}')`,
      dataAttr: `data-cc-bm="${m.id}"`,
    })).join('');
  }

  if (subToggleHTML) {
    subToggle.innerHTML = subToggleHTML;
    subToggle.style.display = 'inline-flex';
  } else {
    subToggle.style.display = 'none';
    subToggle.innerHTML = '';
  }

  // ─── Tab-contextual filter chips (right of the tabs row) ────────────
  // bands → Period filter chips + Zone chips for series toggle
  // spread → baseline ref Zone chips
  // others → none
  let chipsHTML = '';
  if (view === 'spread') {
    const sel = window._compareZones || new Set(['FR']);
    const zones = Array.from(sel);
    if (zones.length) {
      let cur = window._ccSpreadRef;
      if (!cur || !sel.has(cur)) {
        cur = sel.has('FR') ? 'FR' : zones[0];
        window._ccSpreadRef = cur;
      }
      chipsHTML = zones.map(z => {
        const col = (window._zoneColorMap && window._zoneColorMap[z]) || '#4A6280';
        return window.pkZoneChip({
          code: z,
          active: z === cur,
          color: col,
          onClick: `setSpreadRef('${z}')`,
        });
      }).join('');
    }
  } else if (view === 'bands') {
    // ── Period filter chips (neutral teal, pkFilterChip) ──
    const periodCur = window._ccBandsPeriod || '1M';
    // Defensive: if _CC_BANDS_PERIODS hasn't been evaluated yet (e.g. early
    // event firing during script load), fall back to a local mirror so we
    // never throw a TDZ error.
    const periods = (typeof _CC_BANDS_PERIODS !== 'undefined') ? _CC_BANDS_PERIODS : [
      { key: '7D',  label: '7D' },
      { key: '1M',  label: '1M' },
      { key: '3M',  label: '3M' },
      { key: '6M',  label: '6M' },
      { key: 'YTD', label: 'YTD' },
      { key: '1Y',  label: '1Y' },
    ];
    const periodChips = periods.map(p => window.pkFilterChip({
      label:   p.label,
      active:  p.key === periodCur,
      onClick: `setCCBandsPeriod('${p.key}')`,
    })).join('');

    // ── Zone chips (zone-coloured, pkZoneChip) for toggling series visibility ──
    const sel = window._compareZones || new Set(['FR']);
    const zones = Array.from(sel);
    window._ccBandsHidden = window._ccBandsHidden || new Set();
    const zoneChips = zones.map(z => {
      const col = (window._zoneColorMap && window._zoneColorMap[z]) || '#4A6280';
      const visible = !window._ccBandsHidden.has(z);
      return window.pkZoneChip({
        code: z,
        active: visible,
        color: col,
        onClick: `toggleCCBandsZone('${z}')`,
        title: visible ? `Hide ${z} from chart` : `Show ${z} on chart`,
      });
    }).join('');

    // Combine with a subtle vertical divider
    chipsHTML = `${periodChips}<span style="display:inline-block;width:1px;height:18px;background:rgba(255,255,255,0.08);margin:0 4px;vertical-align:middle"></span>${zoneChips}`;
  }

  if (chipsHTML) {
    tabChipsEl.innerHTML = chipsHTML;
    tabChipsEl.style.display = 'flex';
  } else {
    tabChipsEl.style.display = 'none';
    tabChipsEl.innerHTML = '';
  }
}
window._ccUpdateTabContext = _ccUpdateTabContext;

// (Resize handler removed: sub-toggle is now left-aligned via static CSS,
//  no JS positioning required.)

function setSpreadRef(code) {
  window._ccSpreadRef = code;
  const renderPromise = renderCompareChart();
  // Refresh chip highlight (active zone changed)
  if (typeof _ccUpdateTabContext === 'function') {
    _ccUpdateTabContext(window._ccView || 'lines');
  }
  return renderPromise;
}
window.setSpreadRef = setSpreadRef;

function populateSpreadRefSelect(data, selected) {
  const host = document.getElementById('cc-ref-chips');
  if (!host || !data) return;
  // Only zones currently in the compare selection
  const sel = selected || window._compareZones || new Set(['FR']);
  const zones = data.filter(z => sel.has(z.code));
  // Resolve current ref: explicit pick if still in selection, else FR if present, else first selected
  let cur = window._ccSpreadRef;
  if (!cur || !sel.has(cur)) {
    cur = sel.has('FR') ? 'FR' : (zones[0]?.code || 'FR');
    window._ccSpreadRef = cur;
  }
  host.innerHTML = zones.map(z => {
    const isOn = z.code === cur;
    const col  = (window._zoneColorMap && window._zoneColorMap[z.code]) || '#4A6280';
    return `<button onclick="setSpreadRef('${z.code}')" style="
      padding:3px 9px;border-radius:4px;font-size:10px;cursor:pointer;border:1px solid ${isOn?col:'rgba(255,255,255,.12)'};
      background:${isOn?col+'22':'transparent'};color:${isOn?col:'rgba(255,255,255,.55)'};
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.03em;transition:all .15s;
    ">${z.code}</button>`;
  }).join('');
}

// ────────────────────────────────────────────
// Helpers shared across views
// ────────────────────────────────────────────
function ccGetSelectedZones(data, selected) {
  const out = [];
  data.forEach(z => { if (selected.has(z.code)) out.push(z); });
  return out;
}

function ccZoneColor(code, data, idx) {
  if (!window._zoneColorMap) {
    window._zoneColorMap = buildZoneColorMap(data);
  }
  return window._zoneColorMap[code] || getSeriesColor(idx);
}

function ccBuildCommonShading(nPts) {
  return {
    id: 'ccShading',
    beforeDraw(chart) {
      const { ctx, chartArea, scales: { x } } = chart;
      if (!x || !chartArea) return;
      const { top, bottom } = chartArea;
      const sc = nPts / 24;
      const zones = [
        { from: 7*sc,  to: 9*sc,   color: 'rgba(232,160,32,0.05)' },
        { from: 11*sc, to: 14*sc,  color: 'rgba(0,212,168,0.04)' },
        { from: 17*sc, to: 21*sc,  color: 'rgba(232,160,32,0.05)' },
      ];
      ctx.save();
      zones.forEach(({ from, to, color }) => {
        const x0 = x.getPixelForValue(from), x1 = x.getPixelForValue(to);
        ctx.fillStyle = color;
        ctx.fillRect(x0, top, x1 - x0, bottom - top);
      });
      ctx.restore();
    }
  };
}

// Zero-line annotation: red marker for the 0 €/MWh threshold (negative price boundary)
function ccZeroLineAnnotation() {
  return {
    type: 'line',
    yMin: 0,
    yMax: 0,
    borderColor: 'rgba(237,105,101,.45)',
    borderWidth: 1,
    borderDash: [4, 4],
    label: { display: false }
  };
}

// ────────────────────────────────────────────
// Router
// ────────────────────────────────────────────
// ─── Cross-zone title block (eyebrow / title / subtitle) ────────────────────
// Populates the inline title block (#cc-title-block) and, if the Cross-zone
// fullscreen is open, also re-injects the same block at the top of the FS
// graph zone. Called whenever the view, zone selection, or spread ref changes.
function _ccSetTitle(view, opts) {
  opts = opts || {};
  const selected = window._compareZones || new Set(['FR']);
  const zonesCount = selected.size;
  const refCode = window._ccSpreadRef || 'FR';
  const dateISO = window._currentPriceDate || pkTodayISO();
  const longDate = (function(){
    try {
      const [y,m,d] = dateISO.split('-').map(Number);
      return new Date(y, m-1, d).toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
    } catch(_) { return dateISO; }
  })();
  const bandsPeriod = window._ccBandsPeriod || '1M';

  const titles = {
    lines: {
      eyebrow: `Cross-zone · Lines · ${zonesCount} zone${zonesCount > 1 ? 's' : ''}`,
      title: '15-min intraday curves overlaid',
      subtitle: `${longDate} · compare price shapes across zones · ENTSO-E`,
    },
    heatmap: {
      eyebrow: `Cross-zone · Heatmap · ${zonesCount} zone${zonesCount > 1 ? 's' : ''}`,
      title: 'Price intensity by zone × slot',
      subtitle: `${longDate} · colour scale shared across zones · ENTSO-E`,
    },
    profile: {
      eyebrow: `Cross-zone · Profile · ${zonesCount} zone${zonesCount > 1 ? 's' : ''}`,
      title: 'Normalised intraday shape',
      subtitle: `${longDate} · each curve as % of its own daily average · ENTSO-E`,
    },
    bands: {
      eyebrow: `Cross-zone · Bands · ${zonesCount} zone${zonesCount > 1 ? 's' : ''}`,
      title: `Today vs ${bandsPeriod} historical distribution`,
      subtitle: `${longDate} · P10–P90 envelope · robust Z-score (IQR/1.349) · ENTSO-E`,
    },
    spread: {
      eyebrow: `Cross-zone · Spread · ${zonesCount} zone${zonesCount > 1 ? 's' : ''} vs ${refCode}`,
      title: `Price differential vs ${refCode}`,
      subtitle: `${longDate} · hourly spread (zone − ${refCode}) in €/MWh · ENTSO-E`,
    },
  };
  const t = titles[view] || titles.lines;

  // Populate inline block
  const ey = document.getElementById('cc-eyebrow');
  const ti = document.getElementById('cc-title');
  const su = document.getElementById('cc-subtitle');
  if (ey) ey.textContent = t.eyebrow;
  if (ti) ti.textContent = t.title;
  if (su) su.textContent = t.subtitle;

  // Mirror into the fullscreen graph zone if open
  const fsOverlay = document.getElementById('pk-fs-overlay');
  if (fsOverlay) {
    let fsBlock = document.getElementById('cc-fs-title-block');
    if (!fsBlock) {
      // Insert before the chart wrap (after filters)
      const graphZone = fsOverlay.querySelector('.pk-fs-graph-zone');
      const chartWrap = fsOverlay.querySelector('.pk-fs-chart-wrap');
      if (graphZone && chartWrap) {
        fsBlock = document.createElement('div');
        fsBlock.id = 'cc-fs-title-block';
        fsBlock.style.cssText = 'margin:6px 0 10px;flex-shrink:0';
        fsBlock.innerHTML = `
          <div id="cc-fs-eyebrow" style="font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;color:#14D3A9;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px"></div>
          <div id="cc-fs-title" style="font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;font-size:15px;font-weight:600;color:var(--text);letter-spacing:-.005em;line-height:1.25"></div>
          <div id="cc-fs-subtitle" style="font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;font-size:11px;color:var(--tx2);margin-top:3px;line-height:1.4"></div>`;
        graphZone.insertBefore(fsBlock, chartWrap);
      }
    }
    const fsEy = document.getElementById('cc-fs-eyebrow');
    const fsTi = document.getElementById('cc-fs-title');
    const fsSu = document.getElementById('cc-fs-subtitle');
    if (fsEy) fsEy.textContent = t.eyebrow;
    if (fsTi) fsTi.textContent = t.title;
    if (fsSu) fsSu.textContent = t.subtitle;
  }
}
window._ccSetTitle = _ccSetTitle;

function renderCompareChart() {
  const data = window._pricesSorted;
  if (!data || !data.length) return;
  const selected = window._compareZones || new Set(['FR']);
  const view = window._ccView || 'lines';

  // Update the date label next to the section title — long format to mirror DA Board meta
  const dateLbl = document.getElementById('compare-zones-date');
  if (dateLbl) {
    const iso = window._currentPriceDate;
    if (iso) {
      const [y, m, d] = iso.split('-').map(Number);
      dateLbl.textContent = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    } else {
      dateLbl.textContent = ccFmtDay(iso);
    }
  }

  populateSpreadRefSelect(data, selected);

  // Most renderers are sync; renderCCBands is async. Capture so callers
  // (setCCView returning to FS) can await before refreshing.
  let renderPromise = null;
  switch (view) {
    case 'heatmap': renderCCHeatmap(data, selected); break;
    case 'profile': renderCCProfile(data, selected); break;
    case 'bands':   renderPromise = renderCCBands(data, selected);   break;
    case 'spread':  renderCCSpread(data, selected);  break;
    case 'lines':
    default:        renderCCLines(data, selected);
  }

  // Refresh the data table below the chart
  renderCompareKPIs(data, selected);
  // Update the title block above the chart
  _ccSetTitle(view);
  // Generate analysis banner for current view
  setTimeout(() => {
    // Native fullscreen replaced by the unified pkOpenFullscreen — see ccOpenFullscreen().
    // We keep addDownload here so the small ↓ button is still attached for inline PNG export.
    if (view !== 'heatmap') addDownload('price-compare-canvas','price-comparison');
    renderCCAnalysis(view, data, selected);
  }, 100);
  return renderPromise;
}

// ────────────────────────────────────────────
// Date helpers — produce 'Wed 06 May' style labels for Today / J-1 / J-2
// ────────────────────────────────────────────
function ccFmtDay(dateISO) {
  if (!dateISO) return 'Today';
  try {
    const [y, m, d] = dateISO.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch (e) { return dateISO; }
}
function ccFmtDayShift(dateISO, deltaDays) {
  if (!dateISO) return null;
  try {
    const [y, m, d] = dateISO.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + deltaDays);
    return dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch (e) { return null; }
}

// ────────────────────────────────────────────
// View 1: LINES (existing chart, refactored)
// ────────────────────────────────────────────
function renderCCLines(data, selected) {
  const firstZone = data.find(z => selected.has(z.code));
  const nPts = (firstZone && firstZone.hourly && firstZone.hourly.length) ? firstZone.hourly.length : 24;
  const hours = makeTimeLabels(nPts);
  const curIdx = Math.min(Math.floor(pkParisHour() * nPts / 24), nPts - 1);

  const datasets = [];
  data.forEach((z, i) => {
    if (!selected.has(z.code)) return;
    const col = ccZoneColor(z.code, data, i);
    const hourly = z.hourly && z.hourly.length ? z.hourly : [];
    datasets.push({
      label: `${z.code} · ${z.name}`, data: hourly, borderColor: col, borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col,
      pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
      fill: false,
      tension: 0,
      spanGaps: true,
    });
  });

  mkChart('price-compare-canvas', {
    type: 'line',
    data: { labels: hours, datasets },
    plugins: [ ccBuildCommonShading(nPts) ],
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: {
          display:true,
          position:'bottom',
          labels:{ color:C_TX2, font:{size:10}, boxWidth:10, padding:10 },
          // Shared focus-on-click behaviour: click a zone → focus (others dim),
          // re-click → reset. Aligned with HMZ Lines.
          onClick: (e, item, legend) => {
            if (typeof window.pkLegendFocusClick === 'function') {
              window.pkLegendFocusClick(e, item, legend);
            }
          },
        },
        tooltip: { mode:'index', intersect:false, callbacks: {
          title: c => c[0].label,
          label: c => { const v = c.raw; if (v == null) return null; return ` ${c.dataset.label}: ${v.toFixed(1)} €/MWh`; }
        }},
        zoom: ZOOM_CFG,
        annotation: { annotations: (() => { const ann = { zeroLine: ccZeroLineAnnotation() }; const a = nowLineAnnotation({ slots: nPts, labels: hours, chartDate: window._currentPriceDate, mode: 'compare' }); if (a) ann.nowLine = a; return ann; })() }
      },
      scales: {
        x: { grid: GRID, ticks:{ color:C_TX3, font:{size:9}, maxTicksLimit:12 }},
        y: { grid: GRID, ticks:{ color:C_TX3, callback:v=>v.toFixed(0) }, title:{ display:true, text:'€/MWh', color:C_TX3, font:{size:9} }, grace: '12%' }
      }
    }
  });
}

// ────────────────────────────────────────────
// View 2: HEATMAP — zones × hours grid, color = price
// ────────────────────────────────────────────
function renderCCHeatmap(data, selected) {
  const host = document.getElementById('cc-heatmap');
  if (!host) return;
  const zones = ccGetSelectedZones(data, selected);
  if (!zones.length) { host.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">No zones selected</div>'; return; }

  const nPts = zones[0].hourly && zones[0].hourly.length ? zones[0].hourly.length : 24;
  const nph = nPts > 24 ? Math.round(nPts/24) : 1;
  // Aggregate to hourly granularity for the heatmap (24 cols always)
  const grid = zones.map(z => {
    const h = z.hourly && z.hourly.length ? z.hourly : [];
    const hr = [];
    for (let i = 0; i < 24; i++) {
      const slots = [];
      for (let j = 0; j < nph; j++) {
        const v = h[i*nph + j];
        if (v != null) slots.push(v);
      }
      hr.push(slots.length ? slots.reduce((a,b)=>a+b,0)/slots.length : null);
    }
    return { code: z.code, flag: z.flag, color: ccZoneColor(z.code, data, 0), hourly: hr };
  });

  // Global colour scale — originator perspective: high price = green (good), low price = red (bad), negative = deep red
  let mn = Infinity, mx = -Infinity;
  grid.forEach(r => r.hourly.forEach(v => { if (v != null) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }));
  const colorFor = (v) => {
    if (v == null) return 'var(--bg)';
    if (v < 0)    return '#5b1a2a';
    const t = Math.max(0, Math.min(1, (v - Math.max(0,mn)) / (mx - Math.max(0,mn) || 1)));
    if (t < .15) return '#a82a3a';
    if (t < .35) return '#c25526';
    if (t < .55) return '#a37a1a';
    if (t < .70) return '#2a7a3a';
    if (t < .85) return '#155f4a';
    return '#0f4434';
  };

  let html = '<div style="font-family:\'JetBrains Mono\',monospace;padding:8px 4px">';
  // header row
  html += '<div style="display:flex;align-items:end;margin-bottom:6px"><div style="width:80px"></div><div style="flex:1;display:grid;grid-template-columns:repeat(24,1fr);gap:1px;color:var(--text3);font-size:9px;padding-bottom:3px">';
  for (let h = 0; h < 24; h++) html += `<div style="text-align:center">${h%3===0?String(h).padStart(2,'0')+'h':''}</div>`;
  html += '</div></div>';
  // body rows
  grid.forEach(r => {
    html += `<div style="display:flex;align-items:center;margin-bottom:2px">
      <div style="width:80px;color:${r.color};font-weight:700;font-size:11px">${r.flag||''} ${r.code}</div>
      <div style="flex:1;display:grid;grid-template-columns:repeat(24,1fr);gap:1px;height:26px">`;
    r.hourly.forEach((v, i) => {
      const c = colorFor(v);
      const lbl = v == null ? '·' : Math.round(v);
      const tip = v == null ? `${r.code} ${i}h: no data` : `${r.code} ${i}h: ${v.toFixed(1)} €/MWh`;
      html += `<div title="${tip}" style="background:${c};display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;border-radius:1px;font-weight:500">${lbl}</div>`;
    });
    html += '</div></div>';
  });
  // scale legend
  html += `<div style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:10px;color:var(--text3);padding-left:80px">
    <span>min ${Math.round(mn)}€</span>
    <div style="display:flex;height:8px;width:200px">
      <div style="flex:1;background:#5b1a2a"></div>
      <div style="flex:1;background:#a82a3a"></div>
      <div style="flex:1;background:#c25526"></div>
      <div style="flex:1;background:#a37a1a"></div>
      <div style="flex:1;background:#2a7a3a"></div>
      <div style="flex:1;background:#155f4a"></div>
      <div style="flex:1;background:#0f4434"></div>
    </div>
    <span>max ${Math.round(mx)}€</span>
  </div></div>`;
  host.innerHTML = html;
}

// ────────────────────────────────────────────
// View 3: PROFILE — normalized to % of daily avg
// ────────────────────────────────────────────
function renderCCProfile(data, selected) {
  const firstZone = data.find(z => selected.has(z.code));
  const nPts = (firstZone && firstZone.hourly && firstZone.hourly.length) ? firstZone.hourly.length : 24;
  const hours = makeTimeLabels(nPts);

  const datasets = [];
  data.forEach((z, i) => {
    if (!selected.has(z.code)) return;
    const col = ccZoneColor(z.code, data, i);
    const h = z.hourly && z.hourly.length ? z.hourly : [];
    const valid = h.filter(v => v != null);
    if (!valid.length) return;
    const avg = valid.reduce((a,b)=>a+b,0) / valid.length;
    if (Math.abs(avg) < 0.5) return; // can't normalize on near-zero average
    const norm = h.map(v => v == null ? null : (v / avg) * 100);
    datasets.push({
      label: `${z.code}`, data: norm, borderColor: col, borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col,
      fill: false, tension: 0, spanGaps: true,
    });
  });

  mkChart('price-compare-canvas', {
    type: 'line',
    data: { labels: hours, datasets },
    plugins: [ ccBuildCommonShading(nPts) ],
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display:true, position:'bottom', labels:{ color:C_TX2, font:{size:10}, boxWidth:10, padding:10 }},
        tooltip: { mode:'index', intersect:false, callbacks: {
          title: c => c[0].label,
          label: c => { const v = c.raw; if (v == null) return null; return ` ${c.dataset.label}: ${v.toFixed(0)}% of daily avg`; }
        }},
        zoom: ZOOM_CFG,
        annotation: { annotations: (() => {
          const ann = {
            baseline: { type:'line', yMin:100, yMax:100, borderColor:'rgba(148,163,184,.4)', borderWidth:1, borderDash:[3,3],
              label:{ display:true, content:'avg = 100%', position:'end', color:'rgba(148,163,184,.7)', font:{size:9}, backgroundColor:'transparent', padding:2 }
            }
          };
          const a = nowLineAnnotation({ slots: nPts, labels: hours, chartDate: window._currentPriceDate, mode: 'compare' });
          if (a) ann.nowLine = a;
          return ann;
        })() }
      },
      scales: {
        x: { grid: GRID, ticks:{ color:C_TX3, font:{size:9}, maxTicksLimit:12 }},
        y: { grid: GRID, ticks:{ color:C_TX3, callback:v=>v.toFixed(0)+' %' }, title:{ display:true, text:'% of daily average', color:C_TX3, font:{size:9} }}
      }
    }
  });
}

// ────────────────────────────────────────────
// View 4: BANDS — single zone, today + 30-day envelope
// ────────────────────────────────────────────
function setBandsZone(code) {
  window._ccBandsZone = code;
  renderCompareChart();
}
window.setBandsZone = setBandsZone;

function populateBandsZoneSelect(zones, current) {
  const host = document.getElementById('cc-bands-chips');
  if (!host) return;
  host.innerHTML = zones.map(z => {
    const isOn = z.code === current;
    const col  = (window._zoneColorMap && window._zoneColorMap[z.code]) || '#4A6280';
    return `<button onclick="setBandsZone('${z.code}')" style="
      padding:3px 9px;border-radius:4px;font-size:10px;cursor:pointer;border:1px solid ${isOn?col:'rgba(255,255,255,.12)'};
      background:${isOn?col+'22':'transparent'};color:${isOn?col:'rgba(255,255,255,.55)'};
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.03em;transition:all .15s;
    ">${z.code}</button>`;
  }).join('');
}

// ════════════════════════════════════════════
// Cross-zone fullscreen (Daily) — opens the compare-zones chart in the unified
// pkOpenFullscreen overlay. Filters in the chart header reproduce the live
// view tabs (Lines/Heatmap/Profile/Bands/Spread) + view-specific controls,
// and the table + KPIs are cloned from the inline DOM.
// ════════════════════════════════════════════
function ccOpenFullscreen() {
  if (typeof window.pkOpenFullscreen !== 'function') {
    console.error('[ccOpenFullscreen] pkOpenFullscreen is not loaded');
    return;
  }
  const view = window._ccView || 'lines';
  const selected = window._compareZones || new Set(['FR']);
  const data = window._pricesSorted || [];

  // ── Title / subtitle ──
  const longDate = (function(){
    try {
      const iso = window._currentPriceDate;
      if (!iso) return '';
      const [y,m,d] = iso.split('-').map(Number);
      return new Date(y, m-1, d).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    } catch(e){ return ''; }
  })();
  const viewTitle = {
    lines:'Lines', heatmap:'Heatmap', profile:'Profile',
    bands:'Bands', spread:'Spread',
  }[view] || 'Lines';
  const zonesCount = selected.size;

  // ── KPIs: clone the 5-card strip above the chart ──
  const inlineKpis = document.getElementById('cc-kpi-strip');
  const kpisHtml = inlineKpis ? inlineKpis.outerHTML : '';

  // ── Table: clone the compare-data-table ──
  const inlineTable = document.getElementById('compare-data-table');
  const tableHtml = inlineTable ? (
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
       <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--tx2);text-transform:uppercase">${viewTitle} — ${zonesCount} zone${zonesCount > 1 ? 's' : ''}</span>
     </div>
     ${inlineTable.outerHTML}`
  ) : null;

  // ── Analysis: clone the amber banner ──
  const inlineBanner = document.getElementById('cc-analyst-banner-anchor');
  const analysisHtml = inlineBanner ? inlineBanner.innerHTML : '';

  // ── Filters: View tabs + view-specific controls ──
  const currentDateISO = window._currentPriceDate || pkTodayISO();
  const todayISO = pkTodayISO();

  const viewTabsHtml = ['lines','heatmap','profile','bands','spread'].map(v => `
    <button onclick="Promise.resolve(setCCView('${v}')).then(()=>ccRefreshFullscreen())" style="
      padding:3px 8px;font-size:10px;border:none;cursor:pointer;border-radius:3px;
      color:${v === view ? '#14D3A9' : '#7A93AB'};
      background:${v === view ? 'rgba(20,211,169,0.18)' : 'transparent'};
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;text-transform:capitalize;
    ">${v}</button>`).join('');

  // ─── Build sub-toggle (Mode for Bands).
  // Uses window.pkPill for the same visual style as the inline Cross-zone
  // sub-toggle (rounded capsules, JetBrains Mono, teal accent). ──
  let subToggleHtml = '';
  let subToggleLabel = '';
  if (view === 'bands') {
    subToggleLabel = 'Mode';
    const modes = [
      { id: 'zscore', label: 'Z-score' },
      { id: 'raw',    label: 'Raw' },
    ];
    const curMode = window._ccBandsMode || 'zscore';
    subToggleHtml = modes.map(m => window.pkPill({
      label:   m.label,
      active:  m.id === curMode,
      onClick: `Promise.resolve(setCCBandsMode('${m.id}')).then(()=>ccRefreshFullscreen())`,
    })).join('');
  }
  const subToggleBlock = subToggleHtml ? `
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">${subToggleLabel}</span>
      <div style="display:inline-flex;gap:4px">${subToggleHtml}</div>
    </div>` : '';

  // ─── Baseline block (for Spread view only) ───
  let baselineBlock = '';
  if (view === 'spread') {
    const refCode = window._ccSpreadRef || 'FR';
    const refOptions = data.filter(z => selected.has(z.code)).map(z => {
      return `<option value="${z.code}" ${z.code === refCode ? 'selected' : ''}>${z.code}</option>`;
    }).join('');
    baselineBlock = `
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Baseline</span>
        <select id="fs-cc-baseline-select" style="background:var(--bg);border:1px solid var(--bd);color:var(--tx);font-size:11px;padding:3px 8px;border-radius:4px;font-family:inherit;cursor:pointer;color-scheme:dark">
          ${refOptions}
        </select>
      </div>`;
  }

  // ─── Period block (only for Bands view: history window for distribution) ──
  let periodBlock = '';
  if (view === 'bands') {
    const curPeriod = window._ccBandsPeriod || '1M';
    const periods = ['7D','1M','3M','6M','YTD','1Y'];
    const periodPills = periods.map(p => `
      <button onclick="Promise.resolve(setCCBandsPeriod('${p}')).then(()=>ccRefreshFullscreen())" style="
        padding:3px 9px;font-size:10px;border:none;cursor:pointer;border-radius:3px;
        color:${p === curPeriod ? '#14D3A9' : '#7A93AB'};
        background:${p === curPeriod ? 'rgba(20,211,169,0.18)' : 'transparent'};
        font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;text-transform:uppercase;
      ">${p}</button>`).join('');
    periodBlock = `
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Period</span>
        <div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">${periodPills}</div>
      </div>`;
  }

  let extraHtml = '';
  if (view === 'bands') {
    extraHtml = `<div id="fs-cc-bands-header" style="width:100%"></div>`;
  }

  // ─── View + SubToggle groupés visuellement (option B mockup) ──
  const viewAndSubToggleBlock = `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">View</span>
        <div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">${viewTabsHtml}</div>
      </div>
      ${subToggleBlock}
    </div>`;

  // Filters order: View+SubToggle FIRST (fixed left, never shifts when
  // graph changes), then Date, Period, Baseline.
  // Filters split: View+SubToggle on the LEFT (fixed, never shifts),
  // Date / Period / Baseline / Bands header on the RIGHT.
  const filtersHtml = `
    <div class="pk-fs-filters-left">
      ${viewAndSubToggleBlock}
    </div>
    <div class="pk-fs-filters-right">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Date</span>
        <input type="date" id="fs-cc-date-input" value="${currentDateISO}" max="${todayISO}"
          style="background:var(--bg);border:1px solid var(--bd);color:var(--tx);font-size:11px;padding:3px 8px;border-radius:4px;font-family:inherit;cursor:pointer;color-scheme:dark">
      </div>
      ${periodBlock}
      ${baselineBlock}
      ${extraHtml}
    </div>`;

  // ─── Title : harmonised pattern "Cross-zone — Day-Ahead · <View>" ──
  const viewLabel = { lines:'Lines', heatmap:'Heatmap', profile:'Profile', bands:'Bands', spread:'Spread' }[view] || 'Lines';

  (window.pkOpenOrUpdate || window.pkOpenFullscreen)({
    title: `Cross-zone — Day-Ahead · ${viewLabel}`,
    subtitle: `${longDate} · 96 × 15min slots · ENTSO-E`,
    filenameStem: `powerklock_daily_crosszone_${view}_${currentDateISO}`,
    storageKey: 'daily-crosszone',
    kpis: kpisHtml ? { html: kpisHtml } : null,
    table: tableHtml ? { html: tableHtml } : null,
    analysis: { html: analysisHtml },
    filters: {
      html: filtersHtml,
      wire: (hostEl) => {
        const dateInp = hostEl.querySelector('#fs-cc-date-input');
        if (dateInp) {
          dateInp.addEventListener('change', (e) => {
            const newDate = e.target.value;
            if (!newDate || newDate === window._currentPriceDate) return;
            if (typeof dpSelect === 'function') {
              dpSelect(newDate);
              const waitAndUpdate = (attempts) => {
                if (attempts <= 0) return;
                if (window._currentPriceDate === newDate && window._pricesSorted) {
                  requestAnimationFrame(() => ccOpenFullscreen());
                } else {
                  setTimeout(() => waitAndUpdate(attempts - 1), 150);
                }
              };
              setTimeout(() => waitAndUpdate(20), 200);
            }
          });
        }
        // Baseline select (Spread view only)
        const baselineSel = hostEl.querySelector('#fs-cc-baseline-select');
        if (baselineSel) {
          baselineSel.addEventListener('change', (e) => {
            const newRef = e.target.value;
            setSpreadRef(newRef);
            Promise.resolve().then(() => ccRefreshFullscreen());
          });
        }
        if (view === 'bands') {
          // The full bands header (Period + Mode + Zones) is rendered for the
          // inline view, but Period and Mode are now in the FS filters bar, so
          // we render ONLY the Zones pills here to avoid duplicates.
          const fsHost = hostEl.querySelector('#fs-cc-bands-header');
          if (fsHost) {
            const zones = ccGetSelectedZones(data, selected);
            window._ccBandsHidden = window._ccBandsHidden || new Set();
            const zonePills = zones.map(z => {
              const col = (window._zoneColorMap && window._zoneColorMap[z.code]) || '#4A6280';
              const isOn = !window._ccBandsHidden.has(z.code);
              return `<button onclick="toggleCCBandsZone('${z.code}')" style="
                padding:3px 9px;border-radius:3px;font-size:10px;cursor:pointer;
                border:1px solid ${isOn ? col : 'rgba(255,255,255,.10)'};
                background:${isOn ? col + '22' : 'transparent'};
                color:${isOn ? col : 'rgba(255,255,255,.35)'};
                font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.03em;
                opacity:${isOn ? 1 : 0.55};transition:all .15s">${z.code}</button>`;
            }).join('');
            fsHost.innerHTML = `
              <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
                <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Zones</span>
                <div style="display:inline-flex;gap:3px;flex-wrap:wrap">${zonePills}</div>
              </div>`;
          }
        }
      }
    },
    chartSource: window.pkBuildChartSource({
      chartId: 'price-compare-canvas',
      htmlContainerId: 'cc-heatmap',
      isHtmlView: () => (view === 'heatmap'),
      chartsRegistry: () => {
        if (typeof CHARTS !== 'undefined' && CHARTS['price-compare-canvas']) return CHARTS;
        if (window._chartInstances) return window._chartInstances;
        return {};
      },
    }),
    onCSV: () => buildCCCSV(view, data, selected),
  });

  // Tag the overlay so we can detect "CC fullscreen is open" from elsewhere
  // (zones-changed listener uses this to refresh the FS reactively).
  const overlayEl = document.getElementById('pk-fs-overlay');
  if (overlayEl) overlayEl.setAttribute('data-fs-context', 'cc');

  // Inject the title block (eyebrow + title + subtitle) at the top of the FS
  // graph zone, then populate it via _ccSetTitle which also keeps the inline
  // and FS blocks in sync.
  setTimeout(() => _ccSetTitle(view), 30);
}
window.ccOpenFullscreen = ccOpenFullscreen;

function ccRefreshFullscreen() {
  // Hot-swap via pkOpenOrUpdate — no close, no flicker.
  // We call ccOpenFullscreen directly (no requestAnimationFrame) because the
  // caller has already awaited the render (Promise.then), so the inline
  // CHARTS['price-compare-canvas'] is up to date at this point.
  ccOpenFullscreen();
}
window.ccRefreshFullscreen = ccRefreshFullscreen;

function buildCCCSV(view, data, selected) {
  const table = document.getElementById('compare-data-table');
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

// ════════════════════════════════════════════
// Bands period selector — controls the lookback window for the
// envelope used by both the chart (Z-score / Raw) and the table column.
// ════════════════════════════════════════════
const _CC_BANDS_PERIODS = [
  { key: '7D',  label: '7D',  days: 7 },
  { key: '1M',  label: '1M',  days: 30 },
  { key: '3M',  label: '3M',  days: 90 },
  { key: '6M',  label: '6M',  days: 180 },
  { key: 'YTD', label: 'YTD', days: -1 },
  { key: '1Y',  label: '1Y',  days: 365 },
];
function _ccBandsPeriodDays() {
  const key = window._ccBandsPeriod || '1M';
  const found = _CC_BANDS_PERIODS.find(p => p.key === key);
  return found ? found.days : 30;
}
window.setCCBandsPeriod = function(key) {
  window._ccBandsPeriod = key;
  // Re-render chart and table
  const data = window._pricesSorted;
  const selected = window._compareZones || new Set(['FR']);
  let renderPromise = null;
  if (data && (window._ccView || 'lines') === 'bands') {
    renderPromise = renderCCBands(data, selected);
    renderCompareKPIs(data, selected);
  }
  // Refresh tabbar so the active Period chip highlight is updated
  if (typeof _ccUpdateTabContext === 'function') {
    _ccUpdateTabContext(window._ccView || 'lines');
  }
  return renderPromise;
};
window.setCCBandsMode = function(mode) {
  window._ccBandsMode = mode; // 'zscore' | 'raw'
  const data = window._pricesSorted;
  const selected = window._compareZones || new Set(['FR']);
  let renderPromise = null;
  if (data && (window._ccView || 'lines') === 'bands') {
    renderPromise = renderCCBands(data, selected);
  }
  // Refresh tabbar so the active Mode pill highlight is updated
  if (typeof _ccUpdateTabContext === 'function') {
    _ccUpdateTabContext(window._ccView || 'lines');
  }
  return renderPromise;
};
// Toggle a single zone's visibility in the Z-score chart
window.toggleCCBandsZone = function(code) {
  window._ccBandsHidden = window._ccBandsHidden || new Set();
  if (window._ccBandsHidden.has(code)) window._ccBandsHidden.delete(code);
  else window._ccBandsHidden.add(code);
  const data = window._pricesSorted;
  const selected = window._compareZones || new Set(['FR']);
  if (data) renderCCBands(data, selected);
  // Refresh the chip active/inactive state in the tabbar
  if (typeof _ccUpdateTabContext === 'function') {
    _ccUpdateTabContext(window._ccView || 'lines');
  }
};

async function renderCCBands(data, selected) {
  const zones = ccGetSelectedZones(data, selected);
  if (!zones.length) return;
  window._ccBandsMode = window._ccBandsMode || 'zscore';
  window._ccBandsHidden = window._ccBandsHidden || new Set();
  const mode = (zones.length >= 2) ? window._ccBandsMode : 'raw'; // 1 zone → raw bands fallback

  const nPts = (zones[0].hourly && zones[0].hourly.length) ? zones[0].hourly.length : 24;
  const hours = makeTimeLabels(nPts);
  const nDays = _ccBandsPeriodDays();
  const periodLabel = (_CC_BANDS_PERIODS.find(p => p.key === (window._ccBandsPeriod || '1M')) || {}).label || '1M';

  // Fetch envelopes for every selected zone in parallel.
  const envs = await Promise.all(zones.map(z => fetchHistoricalEnvelope(z.code, nDays, nPts)));

  // Render the filter strip in the chart header (period + mode + zone pills)
  _renderCCBandsHeader(zones, mode);

  const datasets = [];

  if (mode === 'zscore') {
    // ── Z-score lines ──
    // Faint background band ±1σ (which is Z = ±1) for visual reference.
    const oneUp = new Array(nPts).fill(1);
    const oneDn = new Array(nPts).fill(-1);
    datasets.push({
      label: '__band_+1σ', data: oneUp,
      borderColor: 'transparent', backgroundColor: 'rgba(56,116,203,0.10)',
      fill: '+1', pointRadius: 0, borderWidth: 0, order: 9, spanGaps: true,
    });
    datasets.push({
      label: '__band_-1σ', data: oneDn,
      borderColor: 'transparent', backgroundColor: 'transparent',
      fill: false, pointRadius: 0, borderWidth: 0, order: 9, spanGaps: true,
    });
    // Median (Z=0) dashed line
    datasets.push({
      label: '__band_median', data: new Array(nPts).fill(0),
      borderColor: 'rgba(251,191,36,0.45)', borderWidth: 1, borderDash: [4,3],
      pointRadius: 0, fill: false, spanGaps: true, order: 8,
    });
    // Each zone: today's Z-score curve, coloured by its zone colour
    zones.forEach((z, i) => {
      if (window._ccBandsHidden.has(z.code)) return;
      const env = envs[i];
      const today = z.hourly || [];
      const z2 = _computeZScores(today, env);
      if (!z2) return;
      const col = ccZoneColor(z.code, data, data.indexOf(z));
      datasets.push({
        label: `${z.code}`, data: z2.zSlots,
        borderColor: col, borderWidth: 2.2,
        pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col,
        fill: false, tension: 0, spanGaps: true, order: 1,
      });
    });
  } else {
    // ── Raw bands view: each visible zone shows today + its own band ──
    zones.forEach((z, i) => {
      if (window._ccBandsHidden.has(z.code)) return;
      const env = envs[i];
      const today = z.hourly || [];
      const col = ccZoneColor(z.code, data, data.indexOf(z));
      if (env) {
        const fillColor = _hexToRgba(col, 0.10);
        datasets.push({
          label: `__band_${z.code}_max`, data: env.p90,
          borderColor: 'transparent', backgroundColor: fillColor,
          fill: '+1', pointRadius: 0, borderWidth: 0, tension: 0, spanGaps: true, order: 5,
        });
        datasets.push({
          label: `__band_${z.code}_min`, data: env.p10,
          borderColor: 'transparent', backgroundColor: 'transparent',
          fill: false, pointRadius: 0, borderWidth: 0, tension: 0, spanGaps: true, order: 5,
        });
        datasets.push({
          label: `${z.code} median`, data: env.median,
          borderColor: _hexToRgba(col, 0.50), borderWidth: 1, borderDash: [3,3],
          pointRadius: 0, fill: false, tension: 0, spanGaps: true, order: 3,
        });
      }
      datasets.push({
        label: `${z.code} today`, data: today,
        borderColor: col, borderWidth: 2.2,
        pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col,
        fill: false, tension: 0, spanGaps: true, order: 1,
      });
    });
  }

  const isZ = (mode === 'zscore');
  mkChart('price-compare-canvas', {
    type: 'line',
    data: { labels: hours, datasets },
    plugins: [ ccBuildCommonShading(nPts) ],
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: {
          display: !isZ,
          position: 'bottom',
          labels: {
            color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10,
            filter: (item) => !(item.text || '').startsWith('__band_'),
          }
        },
        tooltip: {
          mode: 'index', intersect: false,
          filter: ctx => !(ctx.dataset.label || '').startsWith('__band_'),
          callbacks: {
            title: c => c[0].label,
            label: c => {
              const v = c.raw;
              if (v == null) return null;
              if (isZ) return ` ${c.dataset.label}: Z = ${v.toFixed(2)}σ`;
              return ` ${c.dataset.label}: ${v.toFixed(1)} €/MWh`;
            }
          }
        },
        zoom: ZOOM_CFG,
        annotation: { annotations: (() => { const ann = { zeroLine: ccZeroLineAnnotation() }; const a = nowLineAnnotation({ slots: nPts, labels: hours, chartDate: window._currentPriceDate, mode: 'compare' }); if (a) ann.nowLine = a; return ann; })() }
      },
      scales: {
        x: { grid: GRID, ticks:{ color:C_TX3, font:{size:9}, maxTicksLimit:12 }},
        y: {
          grid: GRID,
          ticks: {
            color: C_TX3,
            callback: v => isZ ? (v.toFixed(1) + 'σ') : v.toFixed(0),
          },
          title: {
            display: true,
            text: isZ ? `Z-score (vs ${periodLabel} baseline)` : '€/MWh',
            color: C_TX3, font: { size: 9 },
          },
          grace: '12%',
          ...(isZ ? { suggestedMin: -3, suggestedMax: 3 } : {}),
        }
      }
    }
  });
}

// Renders the chart's header strip: period selector + mode toggle + zone pills.
// Targets the dedicated DOM node #cc-bands-header (defined in the Cross-zone block).
function _renderCCBandsHeader(zones, mode) {
  const host = document.getElementById('cc-bands-header');
  if (!host) return;
  const period = window._ccBandsPeriod || '1M';

  // ── Style: Historical sub-tabs ──
  // Individual pills with a border, mint background + mint text + mint border if active,
  // matching the Hourly/Daily/Weekly/Monthly look in Historical drill-down.
  const subTabStyle = (active) => `
    padding:4px 11px;font-size:10px;cursor:pointer;border-radius:14px;
    background:${active ? 'rgba(20,211,169,0.18)' : 'transparent'};
    color:${active ? '#14D3A9' : 'var(--tx3)'};
    border:1px solid ${active ? 'rgba(20,211,169,0.45)' : 'var(--bd)'};
    font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;
    transition:all .15s`;

  // Period pills — sub-tab style, individual pills with gap (no shared container)
  const periodPills = _CC_BANDS_PERIODS.map(p => `
    <button onclick="setCCBandsPeriod('${p.key}')" style="${subTabStyle(p.key === period)}">${p.label}</button>`).join('');

  // Mode pills (Z-score / Raw bands) — same sub-tab style
  const modeUi = (zones.length >= 2) ? `
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Mode</span>
      <div style="display:inline-flex;gap:6px">
        <button onclick="setCCBandsMode('zscore')" style="${subTabStyle(mode === 'zscore')}">Z-score</button>
        <button onclick="setCCBandsMode('raw')" style="${subTabStyle(mode === 'raw')}">Raw bands</button>
      </div>
    </div>` : `<span style="font-size:10px;color:var(--tx3);font-style:italic">Select 2+ zones to enable Z-score mode</span>`;

  // Zone pills — colour-coded per zone, sub-tab shape but with the zone's own colour
  // so the chart legend is implicit. Hidden zones get a faint dim treatment.
  window._ccBandsHidden = window._ccBandsHidden || new Set();
  const zonePills = zones.map(z => {
    const col = (window._zoneColorMap && window._zoneColorMap[z.code]) || '#4A6280';
    const isOn = !window._ccBandsHidden.has(z.code);
    return `<button onclick="toggleCCBandsZone('${z.code}')" style="
      padding:4px 11px;border-radius:14px;font-size:10px;cursor:pointer;
      border:1px solid ${isOn ? col : 'rgba(255,255,255,.10)'};
      background:${isOn ? col + '22' : 'transparent'};
      color:${isOn ? col : 'rgba(255,255,255,.35)'};
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.03em;
      opacity:${isOn ? 1 : 0.55};transition:all .15s">${z.code}</button>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
      <!-- Mode toggle (left) -->
      ${modeUi}

      <!-- Period + Zones (right) -->
      <div style="display:flex;align-items:center;gap:18px;margin-left:auto;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Period</span>
          <div style="display:inline-flex;gap:6px;flex-wrap:wrap">${periodPills}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Zones</span>
          <div style="display:inline-flex;gap:6px;flex-wrap:wrap">${zonePills}</div>
        </div>
      </div>
    </div>`;
}

// Tiny hex→rgba helper used to fade zone colours for band fills.
function _hexToRgba(hex, alpha) {
  if (!hex) return `rgba(74,98,128,${alpha})`;
  let s = hex.replace('#','');
  if (s.length === 3) s = s.split('').map(c => c+c).join('');
  const r = parseInt(s.slice(0,2), 16);
  const g = parseInt(s.slice(2,4), 16);
  const b = parseInt(s.slice(4,6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Fetch 30-day envelope (min/max/median per hour) from history files
async function fetchHistoricalEnvelope(code, nDays, nPts) {
  const cacheKey = `${code}|${nDays}|${nPts}`;
  window._envelopeCache = window._envelopeCache || {};
  if (window._envelopeCache[cacheKey]) return window._envelopeCache[cacheKey];

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
    const limit = nDays === 0 ? 5 * 365 : nDays;
    for (let i = 1; i <= limit; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0,10));
    }
  }

  const all = []; // array of hourly arrays (nPts each)
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
      const ratio = h.length / nPts;
      const resampled = [];
      for (let i = 0; i < nPts; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.max(start + 1, Math.floor((i+1) * ratio));
        const slice = h.slice(start, end).filter(v => v != null);
        resampled.push(slice.length ? slice.reduce((a,b)=>a+b,0) / slice.length : null);
      }
      all.push(resampled);
    } catch (e) { /* silent */ }
  }));
  if (!all.length) return null;

  // Linear-interpolation percentile from a sorted array
  const _pct = (sortedArr, p) => {
    if (!sortedArr.length) return null;
    if (sortedArr.length === 1) return sortedArr[0];
    const rank = p * (sortedArr.length - 1);
    const lo = Math.floor(rank), hi = Math.ceil(rank);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (rank - lo);
  };

  const min = [], max = [], median = [], p10 = [], p25 = [], p75 = [], p90 = [];
  for (let i = 0; i < nPts; i++) {
    const vals = all.map(arr => arr[i]).filter(v => v != null).sort((a,b)=>a-b);
    if (!vals.length) {
      min.push(null); max.push(null); median.push(null);
      p10.push(null); p25.push(null); p75.push(null); p90.push(null);
      continue;
    }
    min.push(vals[0]);
    max.push(vals[vals.length - 1]);
    median.push(_pct(vals, 0.50));
    p10.push(_pct(vals, 0.10));
    p25.push(_pct(vals, 0.25));
    p75.push(_pct(vals, 0.75));
    p90.push(_pct(vals, 0.90));
  }
  // Legacy compatibility: aliases p0 → min, p50 → median, p100 → max
  const result = {
    min, max, median, p10, p25, p75, p90,
    p0: min, p50: median, p100: max,
    n: all.length,
  };
  window._envelopeCache[cacheKey] = result;
  return result;
}

// ════════════════════════════════════════════
// Z-score helpers — robust sigma via IQR/1.349, per-slot baseline
// Used by Cross-zone Bands · Z-score view.
// See Methodology page for the full formula and rationale.
// ════════════════════════════════════════════
const _Z_SIGMA_DIV = 1.349;
function _computeZScores(todayArr, envelope) {
  if (!envelope || !todayArr || !todayArr.length) return null;
  const nPts = envelope.median.length;
  const zSlots = new Array(nPts).fill(null);
  for (let i = 0; i < nPts; i++) {
    const t = todayArr[i];
    const med = envelope.median[i];
    const q1 = envelope.p25[i], q3 = envelope.p75[i];
    if (t == null || med == null || q1 == null || q3 == null) continue;
    const sigma = (q3 - q1) / _Z_SIGMA_DIV;
    if (sigma <= 0 || !isFinite(sigma)) continue;
    zSlots[i] = (t - med) / sigma;
  }
  // Day-level Z = mean of valid per-slot Z values
  const validZ = zSlots.filter(v => v != null && isFinite(v));
  const dayZ = validZ.length ? (validZ.reduce((a,b)=>a+b,0) / validZ.length) : null;
  return { zSlots, dayZ };
}

// ────────────────────────────────────────────
// View 5: SPREAD — all selected zones minus reference (default FR)
// ────────────────────────────────────────────
function renderCCSpread(data, selected) {
  const refCode = window._ccSpreadRef || 'FR';
  const ref = data.find(z => z.code === refCode);
  if (!ref || !ref.hourly) return;
  const refH = ref.hourly;
  const nPts = refH.length;
  const hours = makeTimeLabels(nPts);

  const datasets = [];
  data.forEach((z, i) => {
    if (!selected.has(z.code) || z.code === refCode) return;
    const col = ccZoneColor(z.code, data, i);
    const h = z.hourly && z.hourly.length === nPts ? z.hourly : null;
    if (!h) return;
    const spread = h.map((v, idx) => (v == null || refH[idx] == null) ? null : v - refH[idx]);
    datasets.push({
      label: `${z.code} − ${refCode}`, data: spread, borderColor: col, borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col,
      fill: false, tension: 0, spanGaps: true,
    });
  });

  mkChart('price-compare-canvas', {
    type: 'line',
    data: { labels: hours, datasets },
    plugins: [ ccBuildCommonShading(nPts) ],
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display:true, position:'bottom', labels:{ color:C_TX2, font:{size:10}, boxWidth:10, padding:10 }},
        tooltip: { mode:'index', intersect:false, callbacks: {
          title: c => c[0].label,
          label: c => { const v = c.raw; if (v == null) return null; const sign = v >= 0 ? '+' : ''; return ` ${c.dataset.label}: ${sign}${v.toFixed(1)} €/MWh`; }
        }},
        zoom: ZOOM_CFG,
        annotation: { annotations: (() => {
          const ann = {
            baseline: { type:'line', yMin:0, yMax:0, borderColor:'rgba(148,163,184,.7)', borderWidth:1.5,
              label:{ display:true, content:`baseline · ${refCode}`, position:'end', color:'rgba(148,163,184,1)', font:{size:10,weight:'600'}, backgroundColor:'rgba(0,0,0,.4)', padding:4 }
            }
          };
          const a = nowLineAnnotation({ slots: nPts, labels: hours, chartDate: window._currentPriceDate, mode: 'compare' });
          if (a) ann.nowLine = a;
          return ann;
        })() }
      },
      scales: {
        x: { grid: GRID, ticks:{ color:C_TX3, font:{size:9}, maxTicksLimit:12 }},
        y: { grid: GRID, ticks:{ color:C_TX3, callback:v=>(v>0?'+':'')+v.toFixed(0)+' €' }, title:{ display:true, text:`€/MWh vs ${refCode}`, color:C_TX3, font:{size:9} }}
      }
    }
  });
}

// ────────────────────────────────────────────
// Auto-generated analysis banner
// ────────────────────────────────────────────
function renderCCAnalysis(view, data, selected) {
  const host = document.getElementById('cc-analysis');
  // host may be missing now that we replaced it by the amber banner; only the anchor matters
  const zones = ccGetSelectedZones(data, selected);
  if (!zones.length) {
    if (host) host.style.display = 'none';
    const anchor = document.getElementById('cc-analyst-banner-anchor');
    if (anchor) anchor.innerHTML = '';
    return;
  }

  const nph = zones[0].hourly && zones[0].hourly.length > 24 ? Math.round(zones[0].hourly.length/24) : 1;
  // Helper: peak/off-peak avg per zone
  const stats = zones.map(z => {
    const h = z.hourly || [];
    const valid = h.filter(v => v != null);
    if (!valid.length) return null;
    const pkV = [], opV = [];
    h.forEach((v, idx) => {
      if (v == null) return;
      const hr = Math.floor(idx / nph);
      (hr >= 8 && hr < 20 ? pkV : opV).push(v);
    });
    const avg = valid.reduce((a,b)=>a+b,0)/valid.length;
    const pk  = pkV.length ? pkV.reduce((a,b)=>a+b,0)/pkV.length : avg;
    const op  = opV.length ? opV.reduce((a,b)=>a+b,0)/opV.length : avg;
    return { code:z.code, avg, mn:Math.min(...valid), mx:Math.max(...valid), pk, op, spread:pk-op };
  }).filter(Boolean);

  let lines = [];
  let tone = 'info'; // info | warn | alert

  if (view === 'lines') {
    const inverted = stats.filter(s => s.spread < -5).length;
    const dateLabel = (window._currentPriceDate && window._currentPriceDate !== pkTodayISO()) ? 'On this day' : "Today";

    if (stats.length === 1) {
      // Single zone: report intra-day shape, not cross-zone comparison
      const s = stats[0];
      const range = s.mx - s.mn;
      lines.push(`<b>${s.code}</b> ${dateLabel.toLowerCase()}: avg <b>${s.avg.toFixed(1)} €/MWh</b> · range ${s.mn.toFixed(1)} → ${s.mx.toFixed(1)} (${range.toFixed(1)} € swing).`);
    } else {
      const mostExpensive = [...stats].sort((a,b) => b.avg - a.avg)[0];
      const cheapest = [...stats].sort((a,b) => a.avg - b.avg)[0];
      lines.push(`${dateLabel}'s range across selected zones: ${cheapest.code} cheapest at <b>${cheapest.avg.toFixed(1)} €/MWh</b> avg, ${mostExpensive.code} most expensive at <b>${mostExpensive.avg.toFixed(1)} €/MWh</b> (gap: ${(mostExpensive.avg-cheapest.avg).toFixed(1)} €).`);
    }
    if (inverted > 0) {
      if (stats.length === 1) {
        lines.push(`<b>${stats[0].code}</b> shows inverted P/OP spread (off-peak more expensive than peak — duck curve from solar generation).`);
      } else {
        lines.push(`<b>${inverted} of ${stats.length}</b> zones show inverted P/OP spread today (off-peak more expensive than peak — duck curve from solar generation).`);
      }
      tone = inverted >= stats.length / 2 ? 'warn' : 'info';
    }
  } else if (view === 'heatmap') {
    const negZones = stats.filter(s => s.mn < 0);
    const veryLowZones = stats.filter(s => s.mn < 5 && s.mn >= 0);
    if (negZones.length) {
      lines.push(`<b>Negative prices</b> in ${negZones.map(z=>z.code).join(', ')} (min: ${Math.min(...negZones.map(z=>z.mn)).toFixed(1)} €/MWh). Solar oversupply during midday hours.`);
      tone = 'warn';
    } else if (veryLowZones.length) {
      lines.push(`Near-zero prices in ${veryLowZones.map(z=>z.code).join(', ')} during the solar trough (typical 11h-15h).`);
    }
    const peakZone = [...stats].sort((a,b) => b.mx - a.mx)[0];
    lines.push(`Highest peak: <b>${peakZone.code}</b> at ${peakZone.mx.toFixed(1)} €/MWh. Read rows left-to-right to spot zones that share or diverge in their daily shape.`);
  } else if (view === 'profile') {
    // Find zone with widest profile (max/min ratio)
    const profiles = stats.map(s => ({ ...s, spread: s.mx - s.mn, ratio: s.avg !== 0 ? (s.mx - s.mn) / Math.abs(s.avg) : 0 }));
    const flattest = [...profiles].sort((a,b) => a.ratio - b.ratio)[0];
    const peakiest = [...profiles].sort((a,b) => b.ratio - a.ratio)[0];
    lines.push(`Shape comparison normalised on each zone's daily average. <b>${peakiest.code}</b> has the most pronounced shape (max swing ${(peakiest.ratio*100).toFixed(0)}% of avg), <b>${flattest.code}</b> is the flattest (${(flattest.ratio*100).toFixed(0)}%).`);
    lines.push(`Useful for PPA shape risk: same shape ≠ same risk if avg levels differ — a 50% swing on a €30 base costs less than on a €130 base.`);
  } else if (view === 'bands') {
    const z = zones[0];
    if (z) {
      const env = window._envelopeCache && window._envelopeCache[z.code];
      if (env && env.n) {
        lines.push(`<b>${z.code}</b> today vs ${env.n}-day envelope. Shaded area = historical min/max range, dashed line = median.`);
        // Check if today is outside envelope
        const today = z.hourly || [];
        let above = 0, below = 0;
        today.forEach((v, i) => {
          if (v == null || env.max[i] == null) return;
          if (v > env.max[i]) above++;
          if (v < env.min[i]) below++;
        });
        if (above > today.length * 0.1) { lines.push(`Today's prices are <b>above the historical max</b> for ${above} hours — abnormal upside.`); tone = 'warn'; }
        else if (below > today.length * 0.1) { lines.push(`Today's prices are <b>below the historical min</b> for ${below} hours — abnormal downside.`); tone = 'warn'; }
        else lines.push(`Today's prices stay within the envelope — typical day for this zone.`);
      } else {
        lines.push(`Loading historical envelope for <b>${z.code}</b>… If empty, history files may not be available for this zone.`);
      }
    }
  } else if (view === 'spread') {
    const refCode = window._ccSpreadRef || 'FR';
    const ref = data.find(z => z.code === refCode);
    if (ref && ref.hourly) {
      const refStats = stats.find(s => s.code === refCode);
      const others = stats.filter(s => s.code !== refCode);
      if (others.length && refStats) {
        const premium = others.filter(s => s.avg > refStats.avg);
        const discount = others.filter(s => s.avg < refStats.avg);
        if (premium.length) lines.push(`<b>Premium vs ${refCode}</b>: ${premium.sort((a,b)=>(b.avg-refStats.avg)-(a.avg-refStats.avg)).map(s=>`${s.code} +${(s.avg-refStats.avg).toFixed(1)}€`).join(', ')}.`);
        if (discount.length) lines.push(`<b>Discount vs ${refCode}</b>: ${discount.sort((a,b)=>(a.avg-refStats.avg)-(b.avg-refStats.avg)).map(s=>`${s.code} ${(s.avg-refStats.avg).toFixed(1)}€`).join(', ')}.`);
        lines.push(`Spreads above the 0-line indicate import opportunities into ${refCode}; below indicate export.`);
      }
    }
  }

  // ── Build the unified amber analyst banner (cc-analyst-banner-anchor) ──
  // Uses _buildAnalystBanner (defined in js/hist/, exposed on window) — same style
  // as Historical chart banners. cc-analysis (legacy gray banner) is left hidden.
  const anchor = document.getElementById('cc-analyst-banner-anchor');
  if (anchor && typeof window._buildAnalystBanner === 'function' && stats.length) {
    const sortedByAvg = [...stats].sort((a, b) => a.avg - b.avg);
    const cheap  = { z: sortedByAvg[0].code, avg: sortedByAvg[0].avg };
    const pricey = { z: sortedByAvg[sortedByAvg.length - 1].code, avg: sortedByAvg[sortedByAvg.length - 1].avg };
    const loadedAvg = stats.reduce((s, x) => s + x.avg, 0) / stats.length;
    const frStats = stats.find(s => s.code === 'FR');
    const frGap = frStats ? (frStats.avg - cheap.avg) : null;
    const modeMap = { lines: 'ccLines', profile: 'ccProfile', bands: 'ccBands', spread: 'ccSpread', heatmap: 'ccHeatmap' };
    const html = window._buildAnalystBanner(modeMap[view] || 'ccLines', {
      cheap, pricey, frGap, loadedAvg, zoneCount: stats.length, view,
    });
    anchor.innerHTML = html;

    // ── Bands-specific outlier addendum ──
    // After the generic banner is rendered, append a sentence listing zones with |Z| > 2
    // using the dayZ values computed by ccComputeRows. This lives in the same amber box.
    if (view === 'bands') {
      const period = window._ccBandsPeriod || '1M';
      const rows = ccComputeRows(data, selected, 'bands');
      const outliers = rows.filter(r => r.dayZ != null && Math.abs(r.dayZ) > 2);
      if (outliers.length) {
        const partsHi = outliers.filter(r => r.dayZ > 2).map(r =>
          `<span style="color:#ED6965;font-weight:600">${r.code} ${r.dayZ.toFixed(1)}σ (P${r.percentile != null ? r.percentile.toFixed(0) : '--'})</span>`);
        const partsLo = outliers.filter(r => r.dayZ < -2).map(r =>
          `<span style="color:#14D3A9;font-weight:600">${r.code} ${r.dayZ.toFixed(1)}σ (P${r.percentile != null ? r.percentile.toFixed(0) : '--'})</span>`);
        const lines = [];
        if (partsHi.length) lines.push(`uncommonly expensive: ${partsHi.join(', ')}`);
        if (partsLo.length) lines.push(`uncommonly cheap: ${partsLo.join(', ')}`);
        const banner = anchor.querySelector('.ho-analyst-banner');
        if (banner) {
          banner.insertAdjacentHTML('beforeend',
            `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed rgba(251,191,36,0.25);font-style:italic">Outliers vs ${period} baseline — ${lines.join(' · ')}.</div>`);
        }
      }
    }
  } else if (anchor) {
    anchor.innerHTML = '';
  }

  // Legacy cc-analysis: hide (we now use the amber banner above)
  if (host) host.style.display = 'none';
}

// Initialise tabs on first load
if (typeof window !== 'undefined') {
  const initCCTabs = () => {
    if (!window._ccView) window._ccView = 'lines';
    if (!window._ccSpreadRef) window._ccSpreadRef = 'FR';
    renderCCTabs();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCCTabs);
  } else {
    initCCTabs();
  }
}

// ────────────────────────────────────────────
// Compare zones — table that adapts to the current view
// ────────────────────────────────────────────
// ── Daily Compare zones · KPI strip (5 cards: Zones+avg, Cheapest, Most exp, Spread, FR vs cheapest) ──
// Sémantique : today's daily averages across selected zones.
// Cohérent avec le strip Historical Compare zones — pas de redondance avec le strip Daily du haut.
function renderCompareKpiStrip(data, selected) {
  // `data` is an array of zone objects: [{code, today, hourly, ...}, ...]
  // We use the daily averages (z.today) from the selected zones.
  if (!Array.isArray(data) || !data.length) return;

  // Build [{ z, avg }] for selected zones with data today
  const validStats = [];
  data.forEach(z => {
    if (!selected.has(z.code)) return;
    if (z.today != null && !isNaN(z.today)) {
      validStats.push({ z: z.code, avg: z.today });
    }
  });

  // KPI 1 · Zones loaded (value = count, meta = loaded avg)
  const zonesVEl = document.getElementById('cc-kpi-zones-v');
  const zonesMetaEl = document.getElementById('cc-kpi-zones-meta');
  // Count zones that actually have a price (a selected zone may have none,
  // e.g. GB has no ENTSO-E day-ahead price) so this matches the chart/table.
  if (zonesVEl) zonesVEl.innerHTML = validStats.length + '<span class="kpi-unit">zones</span>';
  if (zonesMetaEl) {
    if (validStats.length) {
      const loadedAvg = validStats.reduce((s, x) => s + x.avg, 0) / validStats.length;
      zonesMetaEl.innerHTML = `avg <strong style="color:var(--tx)">${loadedAvg.toFixed(2)} €/MWh</strong> · today`;
    } else {
      zonesMetaEl.textContent = 'no data today';
    }
  }

  if (!validStats.length) return;

  // KPI 2-3-4 · Cheapest / Most exp / Spread
  validStats.sort((a, b) => a.avg - b.avg);
  const cheap = validStats[0], pricey = validStats[validStats.length - 1];
  const setHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const setText = (id, txt)  => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setHTML('cc-kpi-cheapest-v', cheap.avg.toFixed(2) + '<span class="kpi-unit">€/MWh</span>');
  setText('cc-kpi-cheapest-meta', cheap.z);
  setHTML('cc-kpi-priciest-v', pricey.avg.toFixed(2) + '<span class="kpi-unit">€/MWh</span>');
  setText('cc-kpi-priciest-meta', pricey.z);
  setHTML('cc-kpi-spread-v', (pricey.avg - cheap.avg).toFixed(2) + '<span class="kpi-unit">€/MWh</span>');

  // KPI 5 · FR vs cheapest
  // Convention couleur: monter = rouge (FR plus cher que cheapest = défavorable),
  //                    vert si FR est le moins cher (rare/win),
  //                    flat si FR pas chargée.
  const frEntry = validStats.find(x => x.z === 'FR');
  const frgapCard = document.getElementById('cc-kpi-frgap');
  if (frgapCard) frgapCard.classList.remove('kpi-up', 'kpi-down', 'kpi-flat');
  if (frEntry && cheap) {
    const gap = frEntry.avg - cheap.avg;
    const pct = cheap.avg > 0 ? (gap / cheap.avg) * 100 : 0;
    setHTML('cc-kpi-frgap-v',
      (gap >= 0 ? '+' : '') + gap.toFixed(2) + '<span class="kpi-unit">€/MWh</span>');
    setText('cc-kpi-frgap-meta',
      (pct >= 0 ? '+' : '') + pct.toFixed(1) + '% · ' + cheap.z + ' cheapest');
    if (frgapCard) {
      if (frEntry.z === cheap.z) frgapCard.classList.add('kpi-up');
      else if (gap > 0)         frgapCard.classList.add('kpi-down');
      else                       frgapCard.classList.add('kpi-up');
    }
  } else {
    setHTML('cc-kpi-frgap-v', '--<span class="kpi-unit">€/MWh</span>');
    setText('cc-kpi-frgap-meta', 'FR not loaded');
    if (frgapCard) frgapCard.classList.add('kpi-flat');
  }
}

function renderCompareKPIs(data, selected) {
  // Populate the 5-card KPI strip above the chart
  renderCompareKpiStrip(data, selected);

  const tbody = document.getElementById('compare-data-tbody');
  const table = document.getElementById('compare-data-table');
  if (!tbody || !data) return;
  const view = window._ccView || 'lines';

  // Build the right header for the view, then dispatch to the right body builder
  const thead = table ? table.querySelector('thead') : null;
  if (thead) thead.innerHTML = ccTableHeader(view);

  const rows = ccComputeRows(data, selected, view);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--tx3);text-align:center;padding:14px">No zones selected</td></tr>`;
    return;
  }

  let html = '';
  switch (view) {
    case 'heatmap': html = ccBodyHeatmap(rows); break;
    case 'profile': html = ccBodyProfile(rows); break;
    case 'bands':   html = ccBodyBands(rows);   break;
    case 'spread':  html = ccBodySpread(rows);  break;
    case 'lines':
    default:        html = ccBodyLines(rows);
  }
  tbody.innerHTML = html;

  // After bands rendering, paint the shared X axis into the TH sub line so
  // the user can read absolute €/MWh values aligned with the tick positions.
  if (view === 'bands' && window._bandsAxis) {
    _renderBandsAxisHeader();
  }

  // Wire cross-highlight (B): hover row → highlight curve, click → toggle focus
  ccWireRowHighlight();
}

// ── Render the shared X axis legend inside the 30D position TH (bands view) ──
// The SVG layout below mirrors the per-row range bars exactly (W=200, padL=padR=6),
// so the labels at the ticks line up vertically with the per-row positions.
function _renderBandsAxisHeader() {
  const th = document.getElementById('pk-bands-axis-th');
  if (!th || !window._bandsAxis) return;
  const { lo, hi, ticks } = window._bandsAxis;
  if (!ticks || !ticks.length) return;
  const W = 200, padL = 6, padR = 6;
  const span = hi - lo || 1;
  const xOf = v => padL + ((v - lo) / span) * (W - padL - padR);

  const tickMarks = ticks.map(t => {
    const x = xOf(t).toFixed(1);
    return `<line x1="${x}" y1="0" x2="${x}" y2="4" stroke="rgba(184,201,217,0.4)" stroke-width="0.5"/>
            <text x="${x}" y="12" font-family="JetBrains Mono" font-size="8" fill="var(--tx3)" text-anchor="middle">${Math.round(t)}</text>`;
  }).join('');

  const subHtml = `
    <div style="display:flex;justify-content:center;margin-top:2px">
      <svg viewBox="0 0 ${W} 16" width="100%" height="16" preserveAspectRatio="none" style="display:block;max-width:200px">
        <line x1="${padL}" y1="0" x2="${W-padR}" y2="0" stroke="rgba(184,201,217,0.25)" stroke-width="0.5"/>
        ${tickMarks}
      </svg>
    </div>
    <div style="color:var(--tx3);font-weight:400;font-size:9px;text-align:center;margin-top:2px">€/MWh · shared scale · today tick = coloured</div>
  `;
  // Replace just the sub portion of the TH (the second line after the label)
  // by rewriting the inner HTML, preserving the label text.
  th.innerHTML = `30D position${subHtml}`;
}

// ── Header per view
function ccTableHeader(view) {
  const cols = {
    lines: [
      { w:'18%', label:'Zone', tip:'' },
      { w:'9%',  label:'Avg', sub:'€/MWh', align:'right', tip:'24h average' },
      { w:'30%', label:'Range', sub:'min slot — max slot · €/MWh', align:'left', tip:'Intraday range, scale shared across zones' },
      { w:'21%', label:'Peak avg / Off-pk avg', sub:'08-20h / 00-08+20-24h · €/MWh', align:'right', tip:'Peak vs off-peak averages' },
      { w:'13%', label:'Spread P/OP', sub:'€/MWh', align:'right', tip:'Peak − Off-peak. Negative = inverted (duck curve)' },
    ],
    heatmap: [
      { w:'18%', label:'Zone' },
      { w:'10%', label:'Avg', sub:'€/MWh', align:'right' },
      { w:'12%', label:'Min @hr', sub:'€/MWh', align:'right', tip:'Cheapest slot of the day' },
      { w:'12%', label:'Max @hr', sub:'€/MWh', align:'right', tip:'Most expensive slot of the day' },
      { w:'10%', label:'Neg hrs', sub:'count', align:'right', tip:'Hours below 0 €/MWh' },
      { w:'15%', label:'Top quartile', sub:'% of slots', align:'right', tip:'Share of slots in the top 25% globally' },
    ],
    profile: [
      { w:'18%', label:'Zone' },
      { w:'14%', label:'Volatility', sub:'max% − min%', align:'right', tip:'Spread of the normalised profile (high = peaky day)' },
      { w:'14%', label:'Peak shape', sub:'peak/avg %', align:'right', tip:'Peak average as % of daily average. >100 = peak above avg' },
      { w:'14%', label:'Off-pk shape', sub:'off-pk/avg %', align:'right' },
      { w:'14%', label:'Duck index', sub:'eve − midday %', align:'right', tip:'17-21h avg vs 11-15h avg, in % of daily avg. High = duck curve' },
      { w:'10%', label:'Neg hrs', sub:'count', align:'right' },
    ],
    bands: [
      { w:'17%', label:'Zone' },
      { w:'10%', label:'Today avg', sub:'€/MWh', align:'right' },
      { w:'10%', label:'Median', sub:'€/MWh', align:'right', tip:'Per-day median over the selected lookback window' },
      { w:'28%', label:'30D position', sub:'P10–P90 range · P50 tick · today tick', align:'center', id:'pk-bands-axis-th', tip:'Shared scale across zones (€/MWh). Coloured tick = today. Outside the range = "!" badge.' },
      { w:'9%',  label:'Pctile', sub:'today vs hist', align:'right', tip:'Percentile rank of today in the lookback window' },
      { w:'8%',  label:'Z', sub:'σ from median', align:'right', tip:'Robust Z-score: (today − median) / σ, with σ = IQR/1.349' },
      { w:'18%', label:'Above max / below min', sub:'hrs', align:'right', tip:'Hours today exceeded the historical max or fell below the historical min' },
    ],
    spread: [
      { w:'18%', label:'Zone' },
      { w:'14%', label:'Avg spread', sub:'€/MWh', align:'right', tip:'Daily mean of (zone − reference)' },
      { w:'14%', label:'Max spread @hr', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Min spread @hr', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Hrs +/−', sub:'positive / negative', align:'right', tip:'Hours where the zone trades above / below the reference' },
      { w:'12%', label:'Correlation', sub:'ρ vs ref', align:'right', tip:'Pearson correlation of hourly profiles' },
    ],
  };
  const c = cols[view] || cols.lines;
  return '<tr>' + c.map(col => `
    <th ${col.id?`id="${col.id}"`:''} style="width:${col.w};text-align:${col.align||'left'}" ${col.tip?`title="${col.tip}"`:''}>
      ${col.label}${col.sub?`<br><span style="color:var(--tx3);font-weight:400;font-size:9px">${col.sub}</span>`:''}
    </th>`).join('') + '</tr>';
}

// ── Helpers shared across body builders
function _ccZoneCell(r) {
  const col = window._zoneColorMap?.[r.code] || '#B8C9D9';
  const meta = ZONE_META[r.code] || { country: r.z?.name || r.code };
  return `<td style="padding:9px 6px;vertical-align:middle">
    <span style="display:inline-block;width:3px;height:12px;background:${col};border-radius:2px;vertical-align:middle;margin-right:6px"></span>
    <span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${col};font-size:11px">${r.z?.flag||''} ${r.code}</span>
    <span style="color:var(--text3);margin-left:5px;font-family:'Inter',sans-serif;font-size:10.5px">${meta.country||''}</span>
  </td>`;
}
function _ccTr(r, cells) {
  return `<tr data-zone="${r.code}" style="border-bottom:1px solid rgba(30,45,61,.5);cursor:pointer;transition:background .15s">
    ${_ccZoneCell(r)}${cells}
  </tr>`;
}
function _ccNum(v, color, decimals=1) {
  if (v == null || isNaN(v)) return '<span style="color:var(--text3)">--</span>';
  return `<span style="color:${color||'var(--text)'}">${v.toFixed(decimals)}</span>`;
}

// ── Compute rows: shared metrics, plus view-specific extras
function ccComputeRows(data, selected, view) {
  const out = [];
  const zonesArr = data.filter(z => selected.has(z.code) && z.hourly && z.hourly.filter(v=>v!=null).length);
  if (!zonesArr.length) return out;

  // Global pool of all valid prices across selected zones (for top-quartile, etc.)
  const allValid = [];
  zonesArr.forEach(z => z.hourly.forEach(v => { if (v != null) allValid.push(v); }));
  const sortedAll = [...allValid].sort((a,b)=>a-b);
  const q75 = sortedAll[Math.floor(sortedAll.length * 0.75)] ?? Infinity;

  zonesArr.forEach(z => {
    const h = z.hourly;
    const valid = h.filter(v => v != null);
    if (!valid.length) return;
    const nph = h.length > 24 ? Math.round(h.length/24) : 1;
    const resMin = nph === 4 ? 15 : (nph === 2 ? 30 : 60);
    const avg = valid.reduce((a,b)=>a+b,0) / valid.length;
    const mn = Math.min(...valid), mx = Math.max(...valid);
    const minIdx = h.indexOf(mn), maxIdx = h.indexOf(mx);
    const fmtSlot = (idx) => {
      if (idx < 0) return '--';
      const t = idx * resMin;
      return String(Math.floor(t/60)).padStart(2,'0') + ':' + String(t%60).padStart(2,'0');
    };
    const pkV = [], opV = [], midV = [], eveV = [];
    h.forEach((v, i) => {
      if (v == null) return;
      const hr = Math.floor(i / nph);
      if (hr >= 8 && hr < 20) pkV.push(v); else opV.push(v);
      if (hr >= 11 && hr < 15) midV.push(v);
      if (hr >= 17 && hr < 21) eveV.push(v);
    });
    const _avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
    const pk = _avg(pkV) ?? avg;
    const op = _avg(opV) ?? avg;
    const negHrs = h.filter(v => v != null && v < 0).length / nph;
    const topQ   = h.filter(v => v != null && v >= q75).length / valid.length * 100;
    const mid = _avg(midV);
    const eve = _avg(eveV);
    const duck = (mid != null && eve != null && Math.abs(avg) > 0.5) ? ((eve - mid) / avg) * 100 : null;
    const peakShape    = Math.abs(avg) > 0.5 ? (pk / avg) * 100 : null;
    const offPeakShape = Math.abs(avg) > 0.5 ? (op / avg) * 100 : null;
    // Volatility on the % profile (max% - min% of avg)
    const profile = Math.abs(avg) > 0.5 ? valid.map(v => (v / avg) * 100) : [];
    const volat = profile.length ? Math.max(...profile) - Math.min(...profile) : null;

    out.push({
      z, code: z.code, hourly: h, nph, resMin, valid, avg, mn, mx,
      minHr: fmtSlot(minIdx), maxHr: fmtSlot(maxIdx),
      pk, op, spread: pk - op,
      negHrs, topQ, peakShape, offPeakShape, duck, volat,
    });
  });

  // View-specific extras: bands and spread need extra fetches/computation
  if (view === 'bands') {
    const nDays = (typeof _ccBandsPeriodDays === 'function') ? _ccBandsPeriodDays() : 30;
    out.forEach(r => {
      const nPts = r.hourly ? r.hourly.length : 96;
      const cacheKey = `${r.code}|${nDays}|${nPts}`;
      const env = window._envelopeCache && window._envelopeCache[cacheKey];
      if (!env) { r._noEnv = true; return; }
      const med = env.median.filter(v => v != null);
      r.med30 = med.length ? med.reduce((a,b)=>a+b,0)/med.length : null;

      // Day-level percentile: rank today's daily avg in the pool of all
      // historical *per-slot* values from the envelope (every percentile of every slot).
      // This gives a fair "today value vs typical historical value" reading.
      const pool = [];
      for (let i = 0; i < nPts; i++) {
        [env.min[i], env.p10[i], env.p25[i], env.median[i], env.p75[i], env.p90[i], env.max[i]]
          .forEach(v => { if (v != null) pool.push(v); });
      }
      pool.sort((a,b)=>a-b);
      const idx = pool.findIndex(v => v >= r.avg);
      r.percentile = pool.length ? (idx < 0 ? 100 : (idx / pool.length) * 100) : null;

      // Robust Z-score per-day: average of per-slot Z values
      const z2 = (typeof _computeZScores === 'function') ? _computeZScores(r.hourly, env) : null;
      r.dayZ = z2 ? z2.dayZ : null;

      // Max divergence today vs median (hour by hour)
      let maxDiv = 0;
      for (let i = 0; i < nPts; i++) {
        const t = r.hourly[i], m = env.median[i];
        if (t != null && m != null) {
          const d = Math.abs(t - m);
          if (d > maxDiv) maxDiv = d;
        }
      }
      r.maxDiv = maxDiv;

      // Hours above historical max / below historical min
      let above = 0, below = 0;
      for (let i = 0; i < nPts; i++) {
        const t = r.hourly[i];
        if (t == null) continue;
        if (env.max[i] != null && t > env.max[i]) above++;
        if (env.min[i] != null && t < env.min[i]) below++;
      }
      r.aboveMaxHrs = above / r.nph;
      r.belowMinHrs = below / r.nph;

      // Distribution summary (day-level) for the 30D-position boxplot SVG:
      // we summarise the envelope into 5 scalar numbers (mean of per-slot stats).
      const meanOf = (arr) => {
        const v = arr.filter(x => x != null);
        return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
      };
      r.distMin = meanOf(env.min);
      r.distP10 = meanOf(env.p10);
      r.distP25 = meanOf(env.p25);
      r.distP50 = meanOf(env.median);
      r.distP75 = meanOf(env.p75);
      r.distP90 = meanOf(env.p90);
      r.distMax = meanOf(env.max);
    });
  }
  if (view === 'spread') {
    const refCode = window._ccSpreadRef || 'FR';
    const ref = data.find(z => z.code === refCode);
    if (ref && ref.hourly) {
      const refH = ref.hourly;
      out.forEach(r => {
        if (r.code === refCode) { r._isRef = true; return; }
        const n = Math.min(r.hourly.length, refH.length);
        const sp = [];
        for (let i = 0; i < n; i++) {
          if (r.hourly[i] != null && refH[i] != null) sp.push({ v: r.hourly[i] - refH[i], i });
        }
        if (!sp.length) return;
        const vals = sp.map(s => s.v);
        const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
        const mxObj = sp.reduce((a,b)=> b.v > a.v ? b : a);
        const mnObj = sp.reduce((a,b)=> b.v < a.v ? b : a);
        const fmtSlot = (idx) => {
          const t = idx * r.resMin;
          return String(Math.floor(t/60)).padStart(2,'0') + ':' + String(t%60).padStart(2,'0');
        };
        r.spreadAvg = avg;
        r.spreadMax = mxObj.v; r.spreadMaxHr = fmtSlot(mxObj.i);
        r.spreadMin = mnObj.v; r.spreadMinHr = fmtSlot(mnObj.i);
        r.spreadPos = vals.filter(v => v > 0).length / r.nph;
        r.spreadNeg = vals.filter(v => v < 0).length / r.nph;
        // Pearson correlation
        const xs = [], ys = [];
        for (let i = 0; i < n; i++) {
          if (r.hourly[i] != null && refH[i] != null) { xs.push(r.hourly[i]); ys.push(refH[i]); }
        }
        if (xs.length > 2) {
          const mx_ = xs.reduce((a,b)=>a+b,0)/xs.length;
          const my_ = ys.reduce((a,b)=>a+b,0)/ys.length;
          let num=0, dx=0, dy=0;
          for (let i = 0; i < xs.length; i++) {
            const a = xs[i]-mx_, b = ys[i]-my_;
            num += a*b; dx += a*a; dy += b*b;
          }
          r.corr = (dx>0 && dy>0) ? num / Math.sqrt(dx*dy) : null;
        }
      });
    }
  }

  return out;
}

// ── Body builders per view
function ccBodyLines(rows) {
  const globalMin = Math.min(...rows.map(r => r.mn));
  const globalMax = Math.max(...rows.map(r => r.mx));
  const globalRng = globalMax - globalMin || 1;
  const spreadCellHTML = (s) => {
    if (s == null) return '<span style="color:var(--text3)">--</span>';
    if (s >= 0)    return `<span style="color:var(--text2)">+${s.toFixed(2)}</span>`;
    if (s > -20)   return `<span style="color:var(--warn)">${s.toFixed(2)}</span><div style="font-size:9px;color:var(--text3);margin-top:1px">inverted</div>`;
    return `<span style="color:var(--down)">${s.toFixed(2)}</span><div style="font-size:9px;color:var(--down);opacity:.75;margin-top:1px">deeply inverted</div>`;
  };
  return rows.map(r => {
    const col = window._zoneColorMap?.[r.code] || '#B8C9D9';
    const leftPct  = ((r.mn - globalMin) / globalRng) * 100;
    const widthPct = ((r.mx - r.mn) / globalRng) * 100;
    const cells = `
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--text);vertical-align:middle">${r.avg.toFixed(2)}</td>
      <td style="padding:9px 6px;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:0 0 48px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${r.mn<0?'var(--down)':'var(--text2)'};line-height:11px">
            ${r.mn.toFixed(2)}<br><span style="color:var(--text3);font-size:9px">@${r.minHr}</span>
          </div>
          <div style="flex:1;position:relative;height:8px">
            <div style="position:absolute;top:0;left:0;right:0;height:100%;background:var(--bg);border-radius:2px"></div>
            <div style="position:absolute;top:0;left:${leftPct.toFixed(1)}%;width:${Math.max(widthPct,2).toFixed(1)}%;height:100%;background:${col};opacity:.55;border-radius:2px"></div>
          </div>
          <div style="flex:0 0 48px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${r.mx<0?'var(--down)':'var(--text2)'};line-height:11px">
            ${r.mx.toFixed(2)}<br><span style="color:var(--text3);font-size:9px">@${r.maxHr}</span>
          </div>
        </div>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:var(--text)">${r.pk.toFixed(2)}</span> <span style="color:var(--text3)">/</span> <span style="color:var(--text2)">${r.op.toFixed(2)}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">${spreadCellHTML(r.spread)}</td>`;
    return _ccTr(r, cells);
  }).join('');
}

function ccBodyHeatmap(rows) {
  return rows.map(r => {
    const negCol = r.negHrs > 0 ? 'var(--down)' : 'var(--text3)';
    const tqBarCol  = r.topQ > 50 ? '#ED6965' : (r.topQ > 25 ? '#FBBF24' : '#14D3A9');
    const cells = `
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--text);vertical-align:middle">${r.avg.toFixed(2)}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:${r.mn<0?'var(--down)':'var(--text2)'}">${r.mn.toFixed(2)}</span> <span style="color:var(--text3);font-size:9px">@${r.minHr}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:var(--text)">${r.mx.toFixed(2)}</span> <span style="color:var(--text3);font-size:9px">@${r.maxHr}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${negCol};vertical-align:middle">${r.negHrs.toFixed(r.negHrs%1===0?0:1)}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;width:100%">
          <span style="color:var(--text2)">${r.topQ.toFixed(0)}%</span>
          <span style="display:inline-block;width:50px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative">
            <span style="display:block;height:100%;width:${Math.min(r.topQ,100).toFixed(0)}%;background:${tqBarCol};opacity:.7;border-radius:2px"></span>
          </span>
        </div>
      </td>`;
    return _ccTr(r, cells);
  }).join('');
}

function ccBodyProfile(rows) {
  const fmtPct = (v, decimals=0) => v == null ? '--' : `${v >= 0 ? '' : ''}${v.toFixed(decimals)}%`;
  return rows.map(r => {
    const peakCol    = r.peakShape != null    && r.peakShape    > 100 ? 'var(--text)' : 'var(--warn)';
    const offPeakCol = r.offPeakShape != null && r.offPeakShape < 100 ? 'var(--text2)' : 'var(--warn)';
    const duckCol    = r.duck != null && r.duck > 30 ? 'var(--down)' : 'var(--text2)';
    const cells = `
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text);vertical-align:middle">${r.volat != null ? r.volat.toFixed(0)+'%' : '--'}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${peakCol};vertical-align:middle">${fmtPct(r.peakShape)}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${offPeakCol};vertical-align:middle">${fmtPct(r.offPeakShape)}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${duckCol};vertical-align:middle">${fmtPct(r.duck)}${r.duck != null && r.duck > 30 ? '<div style="font-size:9px;color:var(--down);opacity:.75;margin-top:1px">strong duck</div>' : ''}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${r.negHrs>0?'var(--down)':'var(--text3)'};vertical-align:middle">${r.negHrs.toFixed(r.negHrs%1===0?0:1)}</td>`;
    return _ccTr(r, cells);
  }).join('');
}

function ccBodyBands(rows) {
  // ── Compute GLOBAL bounds (shared X axis across all rows) ──
  // We use min(distP10) and max(distP90) across rows, also widened by today values
  // so a today-outside-band shows clearly without overflowing the SVG.
  let gLo = Infinity, gHi = -Infinity;
  rows.forEach(r => {
    if (r._noEnv) return;
    if (r.distP10 != null && r.distP10 < gLo) gLo = r.distP10;
    if (r.distP90 != null && r.distP90 > gHi) gHi = r.distP90;
    if (r.distMin != null && r.distMin < gLo) gLo = r.distMin;
    if (r.distMax != null && r.distMax > gHi) gHi = r.distMax;
    if (r.avg != null) {
      if (r.avg < gLo) gLo = r.avg;
      if (r.avg > gHi) gHi = r.avg;
    }
  });
  if (!isFinite(gLo) || !isFinite(gHi)) { gLo = 0; gHi = 100; }
  // Small padding so the extremes don't sit on the edge.
  const span0 = gHi - gLo || 1;
  gLo -= span0 * 0.04;
  gHi += span0 * 0.04;
  const gSpan = gHi - gLo || 1;

  // ── "Nice" tick generator for the in-SVG graduations ──
  // 4 ticks across [gLo, gHi], rounded to a sensible step.
  const niceTicks = (lo, hi, count = 4) => {
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
  const axisTicks = niceTicks(gLo, gHi, 4);

  // Expose to header builder so it can render an axis legend in the sub line.
  window._bandsAxis = { lo: gLo, hi: gHi, ticks: axisTicks };

  return rows.map(r => {
    if (r._noEnv) {
      const cells = `<td colspan="6" style="text-align:center;padding:9px 6px;color:var(--text3);font-size:11px">Loading envelope…</td>`;
      return _ccTr(r, cells);
    }

    // Outlier highlight: |Z| > 2 colours the row background subtly
    const z = r.dayZ;
    const isHighOut = (z != null && z > 2);
    const isLowOut  = (z != null && z < -2);
    const rowExtraStyle = isHighOut
      ? 'background:rgba(237,105,101,0.06)'
      : (isLowOut ? 'background:rgba(20,211,169,0.06)' : '');

    const pctCol = r.percentile == null ? 'var(--text3)'
                  : (r.percentile > 80 ? 'var(--down)'
                  : (r.percentile < 20 ? 'var(--up)' : 'var(--text2)'));
    const zCol = (z == null) ? 'var(--text3)'
                : (z > 2 ? 'var(--down)' : (z < -2 ? 'var(--up)' : 'var(--text2)'));
    const sign = v => v >= 0 ? '+' : '';

    // ── Range bar (200 × 22) on a SHARED axis ──
    // Layout: thin segment P10→P90 (steel blue), small tick P50 (neutral),
    // thick coloured tick = today. Graduations match the global axis ticks
    // so the eye can read absolute €/MWh across rows.
    const W = 200, H = 22, padL = 6, padR = 6, axisY = H / 2;
    let boxSvg = `<td style="text-align:center;padding:6px;vertical-align:middle">--</td>`;
    if (r.distP10 != null && r.distP90 != null && r.distP50 != null) {
      const xOf = v => padL + ((v - gLo) / gSpan) * (W - padL - padR);
      const xP10 = xOf(r.distP10);
      const xP90 = xOf(r.distP90);
      const xMed = xOf(r.distP50);
      const xToday = xOf(r.avg);
      const todayCol = (window._zoneColorMap && window._zoneColorMap[r.code]) || '#14D3A9';
      const outOfBand = (r.avg < r.distP10 || r.avg > r.distP90);

      // Graduations (vertical dotted lines at the global axis ticks) — very subtle
      const grads = axisTicks.map(t => {
        const x = xOf(t);
        return `<line x1="${x.toFixed(1)}" y1="2" x2="${x.toFixed(1)}" y2="${H-2}" stroke="rgba(120,140,170,0.10)" stroke-width="0.5"/>`;
      }).join('');

      const tipParts = [
        `P10 ${r.distP10.toFixed(1)}`,
        `med ${r.distP50.toFixed(1)}`,
        `P90 ${r.distP90.toFixed(1)}`,
        `today ${r.avg.toFixed(1)}`,
      ].join(' · ');

      boxSvg = `<td style="padding:6px;vertical-align:middle" title="${tipParts}">
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block;max-width:200px;margin:0 auto">
          ${grads}
          <line x1="${xP10.toFixed(1)}" y1="${axisY}" x2="${xP90.toFixed(1)}" y2="${axisY}" stroke="#475569" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="${xMed.toFixed(1)}" y1="${axisY-5}" x2="${xMed.toFixed(1)}" y2="${axisY+5}" stroke="rgba(184,201,217,0.85)" stroke-width="1.2"/>
          <line x1="${xToday.toFixed(1)}" y1="${axisY-7}" x2="${xToday.toFixed(1)}" y2="${axisY+7}" stroke="${todayCol}" stroke-width="3" stroke-linecap="round"/>
          ${outOfBand ? `<text x="${xToday + (xToday > W/2 ? -8 : 8)}" y="${axisY - 8}" font-family="JetBrains Mono" font-size="7" fill="${todayCol}" font-weight="700" text-anchor="${xToday > W/2 ? 'end' : 'start'}">!</text>` : ''}
        </svg>
      </td>`;
    }

    const cells = `
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;color:var(--text);vertical-align:middle">${r.avg.toFixed(2)}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text2);vertical-align:middle">${r.med30 != null ? r.med30.toFixed(2) : '--'}</td>
      ${boxSvg}
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:13px;color:${pctCol};font-weight:${(isHighOut||isLowOut)?'600':'400'};vertical-align:middle">${r.percentile != null ? 'P'+r.percentile.toFixed(0) : '--'}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:13px;color:${zCol};font-weight:${(isHighOut||isLowOut)?'600':'400'};vertical-align:middle">${z != null ? sign(z)+z.toFixed(2) : '--'}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:13px;vertical-align:middle">
        <span style="color:${r.aboveMaxHrs>0?'var(--down)':'var(--text3)'}">${r.aboveMaxHrs.toFixed(r.aboveMaxHrs%1===0?0:1)}</span>
        <span style="color:var(--text3)"> / </span>
        <span style="color:${r.belowMinHrs>0?'var(--up)':'var(--text3)'}">${r.belowMinHrs.toFixed(r.belowMinHrs%1===0?0:1)}</span>
      </td>`;

    // Inject the optional row-extra-style by passing through _ccTr's template
    const tr = _ccTr(r, cells);
    // Splice row style into the <tr ...> tag if any
    if (rowExtraStyle) {
      return tr.replace(/<tr([^>]*)>/, (m, attrs) => {
        if (/style=/.test(attrs)) return m.replace(/style="([^"]*)"/, (mm, s) => `style="${s};${rowExtraStyle}"`);
        return `<tr${attrs} style="${rowExtraStyle}">`;
      });
    }
    return tr;
  }).join('');
}

function ccBodySpread(rows) {
  const refCode = window._ccSpreadRef || 'FR';
  // Compute max absolute spread for divergent bar scaling
  const validSpreads = rows.filter(r => r.spreadAvg != null && !r._isRef).map(r => Math.abs(r.spreadAvg));
  const maxAbs = validSpreads.length ? Math.max(...validSpreads, 1) : 1;
  return rows.map(r => {
    if (r._isRef) {
      const cells = `<td colspan="5" style="text-align:center;padding:9px 6px;color:var(--text3);font-size:11px;font-style:italic">— reference —</td>`;
      return _ccTr(r, cells);
    }
    if (r.spreadAvg == null) {
      const cells = `<td colspan="5" style="text-align:center;padding:9px 6px;color:var(--text3);font-size:11px">No matching data vs ${refCode}</td>`;
      return _ccTr(r, cells);
    }
    const avgCol = r.spreadAvg >= 0 ? 'var(--up)' : 'var(--down)';
    const corrCol = r.corr == null ? 'var(--text3)' : (r.corr > 0.7 ? 'var(--up)' : r.corr < 0.3 ? 'var(--warn)' : 'var(--text2)');
    const sign = (v) => v >= 0 ? '+' : '';
    // Divergent bar: 60px centred on 0
    const divPct = Math.min(Math.abs(r.spreadAvg) / maxAbs, 1) * 50;
    const divHTML = r.spreadAvg >= 0
      ? `<span style="display:inline-block;width:60px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative;vertical-align:middle"><span style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,0.15)"></span><span style="position:absolute;left:50%;top:0;height:100%;width:${divPct.toFixed(1)}%;background:#ED6965;opacity:.75;border-radius:2px"></span></span>`
      : `<span style="display:inline-block;width:60px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative;vertical-align:middle"><span style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,0.15)"></span><span style="position:absolute;right:50%;top:0;height:100%;width:${divPct.toFixed(1)}%;background:#14D3A9;opacity:.75;border-radius:2px"></span></span>`;
    const cells = `
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end">
          <span style="font-weight:600;color:${avgCol}">${sign(r.spreadAvg)}${r.spreadAvg.toFixed(2)}</span>
          ${divHTML}
        </div>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:var(--up)">${sign(r.spreadMax)}${r.spreadMax.toFixed(2)}</span> <span style="color:var(--text3);font-size:9px">@${r.spreadMaxHr}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:var(--down)">${sign(r.spreadMin)}${r.spreadMin.toFixed(2)}</span> <span style="color:var(--text3);font-size:9px">@${r.spreadMinHr}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:var(--up)">${r.spreadPos.toFixed(r.spreadPos%1===0?0:1)}</span>
        <span style="color:var(--text3)"> / </span>
        <span style="color:var(--down)">${r.spreadNeg.toFixed(r.spreadNeg%1===0?0:1)}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${corrCol};vertical-align:middle">${r.corr != null ? r.corr.toFixed(2) : '--'}</td>`;
    return _ccTr(r, cells);
  }).join('');
}

// ── (B) Cross-highlight: hover/click row → highlight matching curve in the chart
function ccWireRowHighlight() {
  const tbody = document.getElementById('compare-data-tbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr[data-zone]').forEach(tr => {
    tr.onmouseenter = () => ccHighlightZone(tr.dataset.zone, false);
    tr.onmouseleave = () => ccHighlightZone(null, false);
    tr.onclick = () => {
      // Toggle persistent focus
      window._ccFocusZone = (window._ccFocusZone === tr.dataset.zone) ? null : tr.dataset.zone;
      ccHighlightZone(window._ccFocusZone, true);
    };
  });
}

function ccHighlightZone(code, isPersistent) {
  // Effective code: hover wins over focus, unless hover cleared (null) and focus exists
  const effective = code != null ? code : window._ccFocusZone;
  const chart = (typeof CHARTS !== 'undefined') ? CHARTS['price-compare-canvas'] : null;
  if (chart) {
    chart.data.datasets.forEach(ds => {
      const matches = !effective || (ds.label || '').startsWith(effective + ' ') || (ds.label || '').startsWith(effective + ' ·') || (ds.label || '').startsWith(effective + ' −') || (ds.label || '') === effective;
      const isOverlay = (ds.label || '').includes('J-1') || (ds.label || '').includes('J-2') || (ds.label || '').includes('30d') || (ds.label || '').startsWith('Median');
      if (effective) {
        ds.borderWidth = matches ? 3 : (ds._origBorderWidth ?? ds.borderWidth ?? 2);
        if (ds._origBorderWidth == null) ds._origBorderWidth = ds.borderWidth;
        if (isOverlay) {
          if (ds._origBorderColor == null) ds._origBorderColor = ds.borderColor;
        } else {
          if (ds._origBorderColor == null) ds._origBorderColor = ds.borderColor;
          if (!matches && typeof ds._origBorderColor === 'string' && ds._origBorderColor.startsWith('#')) {
            ds.borderColor = ds._origBorderColor + '40'; // 25% alpha
          } else if (matches) {
            ds.borderColor = ds._origBorderColor;
          }
        }
      } else {
        // Reset
        if (ds._origBorderWidth != null) { ds.borderWidth = ds._origBorderWidth; }
        if (ds._origBorderColor != null) { ds.borderColor = ds._origBorderColor; }
      }
    });
    chart.update('none');
  }
  // Visual feedback on rows
  const tbody = document.getElementById('compare-data-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr[data-zone]').forEach(tr => {
      const isMatch = effective && tr.dataset.zone === effective;
      tr.style.background = isMatch ? 'rgba(20,211,169,.06)' : '';
      tr.style.boxShadow = (isPersistent && isMatch) ? 'inset 3px 0 0 var(--up)' : '';
    });
  }
}
window.ccHighlightZone = ccHighlightZone;

function makeSVGSparkline(data, positive) {
  const w = 80, h = 28, pad = 2;
  const mn = Math.min(...data), mx = Math.max(...data);
  const rng = mx - mn || 1;
  const col = positive ? '#14D3A9' : '#ED6965';
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - mn) / rng) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Area fill path
  const first = `${pad},${h - pad}`;
  const last = `${(w - pad).toFixed(1)},${h - pad}`;
  const area = `${first} ${pts} ${last}`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <polygon points="${area}" fill="${col}" fill-opacity="0.15"/>
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}


// ── HOURLY DATA HELPERS
function getResolution(data) {
  // Returns interval in minutes based on number of points
  const n = data.length;
  if (n <= 24) return 60;
  if (n <= 48) return 30;
  if (n <= 96) return 15;
  return Math.round(24*60/n);
}

function makeTimeLabels(n) {
  const mins = Math.round(24*60/n);
  return Array.from({length:n}, (_,i) => {
    const totalMin = i * mins;
    const h = Math.floor(totalMin/60);
    const m = totalMin % 60;
    if (mins >= 60) return h+'h';
    return m === 0 ? h+'h' : (m === 30 ? h+':30' : h+':'+String(m).padStart(2,'0'));
  });
}

function negHoursFromData(data) {
  const mins = getResolution(data);
  const negPoints = data.filter(v => v !== null && v !== undefined && v < 0).length;
  return Math.round(negPoints * mins / 60 * 10) / 10; // in hours, 1dp
}

function generateDemoHourly(avg, min, max) {
  // Synthetic daily profile: low at night, peak morning/evening
  const profile = [0.6,0.5,0.45,0.4,0.4,0.5,0.7,0.85,0.9,0.85,0.75,0.6,0.65,0.7,0.8,0.9,0.95,1.0,0.95,0.85,0.8,0.75,0.7,0.65];
  const range = max - min;
  return profile.map(p => min + p * range + (Math.random() - 0.5) * range * 0.1);
}

function drawSparkline(canvas, data, avg) {
  if (!canvas || !data || data.length < 2) return;
  const positive = avg >= 0;
  const col = positive ? C_UP : C_DN;
  mkChart(canvas.id, {
    type: 'line',
    data: {
      labels: data.map((_,i) => i+'h'),
      datasets: [{ data, borderColor: col, borderWidth: 1.5, pointRadius: 0, fill: true,
        backgroundColor: (ctx2) => {
          const g = ctx2.chart.ctx.createLinearGradient(0,0,0,28);
          g.addColorStop(0, rgba(col,.25)); g.addColorStop(1, rgba(col,0)); return g;
        }, tension: 0 }]
    },
    options: {
      animation: false, responsive: false,
      plugins: { legend:{display:false}, tooltip:{enabled:false} },
      scales: { x:{display:false}, y:{display:false} },
      layout: { padding: 1 }
    }
  });
}

