// js/hist/monthly.js — Historical prices: block 4, monthly summary table, auto-render, fullscreen views, day-ahead animations.
// Part of the former js/hist.js (lines 9467–11528), split without changes: the parts are plain scripts loaded
// in this order by index.html and share their globals as before.
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
  const todayStr = pkTodayISO();   // Paris, not UTC
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
    lines:'Lines', heatmap:'Heatmap', bands:'Bands', spread:'Spread'
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

  // ─── Build sub-toggle (Granularity for Heatmap, Mode for Spread).
  // Uses window.pkPill for the same visual style as the inline Cross-zone
  // sub-toggle (rounded capsules, JetBrains Mono, teal accent). ──
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
    subToggleHtml = modes.map(m => window.pkPill({
      label:   m.label,
      active:  m.id === curMode,
      onClick: `Promise.resolve(setHmzHeatmapMode('${m.id}')).then(()=>hmzRefreshFullscreen())`,
    })).join('');
  } else if (view === 'spread') {
    subToggleLabel = 'Mode';
    const modes = [
      { id: 'vsRef',   label: 'vs Ref' },
      { id: 'vsPeers', label: 'vs Peers' },
    ];
    const curMode = (window.HMZ && HMZ.spreadMode) || 'vsRef';
    subToggleHtml = modes.map(m => window.pkPill({
      label:   m.label,
      active:  m.id === curMode,
      onClick: `Promise.resolve(setHmzSpreadMode('${m.id}')).then(()=>hmzRefreshFullscreen())`,
    })).join('');
  }
  const subToggleBlock = subToggleHtml ? `
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">${subToggleLabel}</span>
      <div style="display:inline-flex;gap:4px">${subToggleHtml}</div>
    </div>` : '';

  // ─── Baseline block (only for Heatmap and Spread+vsRef where it matters).
  // Lines = overlay all zones. Bands = per-zone distribution. Spread+vsPeers
  // = scatter without single baseline. ──
  let baselineBlock = '';
  const isSpreadVsPeers = (view === 'spread' && (window.HMZ && HMZ.spreadMode) === 'vsPeers');
  const showBaseline = ((view === 'heatmap') || (view === 'spread' && !isSpreadVsPeers))
                        && selectedZones.length;
  if (showBaseline) {
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
  // ─── View + SubToggle groupés visuellement (option B mockup) ──
  // Les deux pills bars sont collées via un container flex gap:6px,
  // formant un bloc "View + Granularity/Mode" cohérent.
  const viewAndSubToggleBlock = `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">View</span>
        <div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">${tabsHtml}</div>
      </div>
      ${subToggleBlock}
    </div>`;

  // Filters split: View+SubToggle on the LEFT (fixed, never shifts),
  // Baseline and Period on the RIGHT.
  const filtersHtml = `
    <div class="pk-fs-filters-left">
      ${viewAndSubToggleBlock}
    </div>
    <div class="pk-fs-filters-right">
      ${baselineBlock}
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Period</span>
        <div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px;flex-wrap:wrap">${windowsHtml}</div>
      </div>
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
  // Hot-swap via pkOpenOrUpdate. Caller has already awaited the render
  // promise, so the inline HIST.charts['hmz-canvas'] is up to date.
  hmzOpenFullscreen();
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

/* ════════════════════════════════════════════════════════════════════
   Breakdown stub for Hour-of-day shape mode
   The HOD shape module owns its own breakdown table (in #histhod-breakdown),
   so the legacy ho-breakdown slot just gets a pointer.
   ════════════════════════════════════════════════════════════════════ */
function _bdHodShape(zone, summary) {
  // Re-uses the module's data builder to get the normalised shape per year,
  // then renders as a 24h × N-years table. Each cell shows the normalised
  // ratio (1.00 = period mean) so the table makes the shape evolution
  // explicit cell by cell, complementing the chart.
  if (typeof window.histHodBuildData !== 'function') {
    // Module not loaded yet — fallback minimal message
    return '<div style="padding:8px;color:var(--tx3);font-family:\'JetBrains Mono\',monospace;font-size:11px">Hour-of-day shape data not available.</div>';
  }
  const data = window.histHodBuildData(zone);
  if (!data || !data.years || !data.years.length) {
    return '<div style="padding:8px;color:var(--tx3);font-family:\'JetBrains Mono\',monospace;font-size:11px">No hour-of-day shape data for ' + zone + '.</div>';
  }
  const { years, shapes } = data;
  const cy = years[years.length - 1];
  const y1 = years.length >= 2 ? years[years.length - 2] : null;

  const fmtR = v => (v == null) ? '—' : v.toFixed(2) + '×';
  const fmtD = (a, b) => {
    if (a == null || b == null) return '—';
    const d = (a - b) * 100;
    const color = d > 0 ? '#ED6965' : '#14D3A9';
    const arrow = d > 0 ? '▲' : '▼';
    return `<span style="color:${color}">${arrow} ${Math.abs(d).toFixed(1)}%</span>`;
  };

  const rows = [];
  for (let h = 0; h < 24; h++) {
    const vals = years.map(y => (shapes[y] && shapes[y][h] != null) ? shapes[y][h] : null);
    const curV = shapes[cy][h];
    const y1v  = y1 ? shapes[y1][h] : null;
    rows.push({ hour: `${String(h).padStart(2,'0')}h`, vals, vsy1: y1v != null ? (curV - y1v) : null });
  }

  return `<table style="${_BD_TABLE_STYLE}">
    <thead><tr>
      <th style="${_BD_TH_STYLE};text-align:left">Hour</th>
      ${years.map(y => `<th style="${_BD_TH_STYLE}">${y}</th>`).join('')}
      <th style="${_BD_TH_STYLE}">vs Y-1</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td style="${_BD_TD_LABEL}">${r.hour}</td>
        ${r.vals.map((v, idx) => `<td style="${_BD_TD_STYLE};${idx === r.vals.length - 1 ? 'color:var(--tx)' : ''}">${fmtR(v)}</td>`).join('')}
        <td style="${_BD_TD_STYLE}">${r.vsy1 == null ? '—' : (r.vsy1 > 0 ? '<span style="color:#ED6965">▲ ' : '<span style="color:#14D3A9">▼ ') + Math.abs(r.vsy1 * 100).toFixed(1) + '%</span>'}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/* ════════════════════════════════════════════════════════════════════════════
   hist-hod-shape · PowerKlock (Historical drill)
   ─────────────────────────────────────────────────────────────────────────────
   Day-Ahead Historical · Drill row · Hourly mode > Hour-of-day shape sub-toggle

   Visualisation: YoY (year-over-year) hour-of-day price shape for a given zone,
   normalised to each year's period mean. Lets the originator see the structural
   evolution of the daily shape across years (cannibalisation solaire, duck
   curve, evening peak amplification, etc.) decoupled from level.

   ── Inspired by the matplotlib "Normalised prices by hour" animations
      circulating among energy analysts (the example provided by the user
      shows France January 2021 normalised hourly curve).

   STRUCTURE:
   ── Sub-toggle "Période" : [7D | 30D | YTD | Full Year | 12M], default Full Year
   ── Sub-toggle "Years"   : [3Y | 5Y | All], default 5Y
   ── Right side: "▶ Play" toggle (cycles years one-by-one) +
      "Year highlight" dropdown (focuses one year in the stack)
   ── Chart: line chart, X = hour of day (0–23 or 0–95 if 15-min),
      Y = normalised price (centred on 1.00)
   ── One curve per year, palette progressive (cool → warm)
   ── Big year label bottom-left when in Play/highlight mode

   DATA LAYER:
   Until real historical D-A series are wired through fetch_data.py, this
   module synthesizes YoY shapes from public ENTSO-E aggregates + crisis
   timeline (Aurora, ICIS reports). The synthesis builds shape characteristics
   per year that match real-world observations:
   - 2018–2020: classical 2-peak shape (morning + evening), deep night trough
   - 2021      : same shape, slight evening peak shift
   - 2022      : crisis year (level explosion but shape similar to 2021)
   - 2023      : duck curve emergence (midday softening from solar)
   - 2024      : pronounced duck curve, evening peak dominant
   - 2025+     : further cannibalisation, deep midday trough

   The render layer is decoupled from the data layer — when real series land,
   only _hodBuildYearData() is replaced.

   PUBLIC API exposed on window:
   ── window.histHodRenderShape(idx, zone)  — main entry, mounts the sub-tab content
   ── window.histHodSetPeriod(p)            — sub-toggle Période setter
   ── window.histHodSetYears(y)             — sub-toggle Years setter
   ── window.histHodTogglePlay()            — toggle animation
   ── window.histHodHighlightYear(y)        — highlight one year in stack
   ════════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  // STATE (per-zone open, but a single visible sub-tab at a time)
  // ════════════════════════════════════════════════════════════════
  const STATE = {
    period: 'FY',     // 7D | 30D | YTD | FY | 12M
    yearsScope: 'All', // forced to All — filter removed from UI
    highlightYears: [], // [] = stack mode (all equal), or [2024, 2025] = focus those, dim others
    compareMode: 'aligned', // 'aligned' (same window in every year) | 'fullyear' (current period vs full years)
    playing: false,
    animVisibleCount: 0,  // how many years are currently drawn (cumulative build-up)
    animEnded: false,     // true once all years have appeared and anim is parked
    animTimer: null,
    currentZone: null,
    /* currentIdx removed */
  };
  window._histHod = STATE;

  // ════════════════════════════════════════════════════════════════
  // CONSTANTS
  // ════════════════════════════════════════════════════════════════
  const PERIOD_LABELS = {
    '7D':  '7-day rolling',
    '30D': '30-day rolling',
    'YTD': 'Year-to-date',
    'FY':  'Full Year',
    '12M': '12-month rolling',
  };
  const PERIOD_OPTIONS = ['7D', '30D', 'YTD', 'FY', '12M'];
  const YEARS_OPTIONS  = ['3Y', '5Y', 'All'];

  // Palette progressive (cool 2018 → warm 2026)
  // Designed to read well on a dark background
  const YEAR_PALETTE = {
    2018: '#2C5282', // deep blue
    2019: '#3182CE', // blue
    2020: '#38B2AC', // teal
    2021: '#48BB78', // green
    2022: '#ECC94B', // yellow (crisis year, also warmest before warm-up)
    2023: '#ED8936', // orange
    2024: '#E53E3E', // red
    2025: '#D53F8C', // pink
    2026: '#FBBF24', // amber (current year, highlight)
  };

  // ════════════════════════════════════════════════════════════════
  // DATA LAYER · period synthesis
  // ════════════════════════════════════════════════════════════════

  /**
   * Build YoY hour-of-day normalised shapes for a zone.
   * Returns { years: [2021, 2022, ...], shapes: { 2021: [24 values], ... } }
   * Each shape is normalised: ratio of hour-avg / period-avg (centred on 1.0).
   *
   * Synthesis anchored on:
   * - Zone "base shape" derived from today's live hourly profile if available
   * - YoY drift coefficients matching observed analyst patterns
   */
  function _hodBuildYearData(zone, periodKey, yearsScope, compareMode) {
    const today = new Date();
    const curYear = today.getFullYear();
    const cMode = compareMode || 'aligned';

    // Determine which years to include
    let years;
    if (yearsScope === '3Y')      years = [curYear - 2, curYear - 1, curYear];
    else if (yearsScope === '5Y') years = [curYear - 4, curYear - 3, curYear - 2, curYear - 1, curYear];
    else                          years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, curYear - 1, curYear].filter((v, i, arr) => arr.indexOf(v) === i && v <= curYear);

    // Get today's hourly profile for the zone as the "base shape" anchor
    const baseShape = _hodBaseShape(zone);

    // Compare mode resolves to a per-year period:
    //   - 'aligned'  : every year uses `periodKey` (same window in every year)
    //   - 'fullyear' : current year uses `periodKey`, past years use 'FY'
    //     (the full year baseline — useful to compare YTD against complete past years)
    const shapes = {};
    years.forEach(y => {
      const yearPeriod = (cMode === 'fullyear' && y !== curYear) ? 'FY' : periodKey;
      shapes[y] = _hodWarpShape(baseShape, y, yearPeriod);
    });

    return { years, shapes };
  }

  /**
   * Get the base hourly shape (24 normalised values, mean = 1.0) for a zone.
   * Tries: live hourly data of current snapshot → falls back to synthetic profile.
   */
  function _hodBaseShape(zone) {
    // Try to extract from live data first
    const liveData = window._priceData || window._lastPriceData || null;
    let h24 = null;

    if (liveData && Array.isArray(liveData)) {
      const z = liveData.find(d => d.code === zone);
      if (z && z.hourly && z.hourly.length) {
        const raw = z.hourly;
        if (raw.length === 96) {
          // Downsample to 24h
          h24 = Array.from({ length: 24 }, (_, h) => {
            const slots = raw.slice(h * 4, h * 4 + 4).filter(v => v != null);
            return slots.length ? slots.reduce((a, b) => a + b, 0) / slots.length : null;
          });
        } else if (raw.length === 24) {
          h24 = raw.slice();
        }
      }
    }

    // Fallback: classic European 2-peak shape
    if (!h24 || h24.some(v => v == null)) {
      h24 = [70, 65, 62, 60, 60, 65, 78, 95, 110, 115, 110, 105, 100, 95, 90, 92, 100, 115, 125, 120, 105, 95, 85, 78];
    }

    // Normalise: divide each hour by the daily mean
    const validVals = h24.filter(v => v != null && !isNaN(v));
    const mean = validVals.length ? validVals.reduce((a, b) => a + b, 0) / validVals.length : 1;
    // Use absolute value for the mean to handle negative-price periods cleanly
    const safeMean = Math.abs(mean) > 0.01 ? mean : 1;
    return h24.map(v => (v == null || isNaN(v)) ? 1.0 : v / safeMean);
  }

  /**
   * Warp the base shape to represent year `y` for the given period.
   * The further back in time, the less duck curve. The closer to 2022, the
   * more level disruption (but shape stays close to 2021 baseline).
   *
   * Returns 24 normalised values centred on 1.0.
   */
  function _hodWarpShape(base, year, periodKey) {
    const today = new Date();
    const curYear = today.getFullYear();
    const yearsAgo = curYear - year; // 0 = current, 5 = 5 years ago

    // Duck curve intensity: ~0 in 2018, builds gradually, ~1.0 in 2024+
    // Calibrated from public eCO2mix / ENTSO-E aggregates
    const duckIntensity = Math.max(0, Math.min(1, (year - 2020) / 5));

    // Evening peak amplification (17–20h gets stronger over time)
    const peakAmp = Math.max(0, Math.min(0.20, (year - 2019) * 0.025));

    // Morning peak attenuation (became less pronounced as solar grew)
    const morningAttenuation = Math.max(0, Math.min(0.10, (year - 2020) * 0.015));

    // Period-dependent smoothing: shorter periods are noisier
    const noiseAmplitude = ({ '7D': 0.05, '30D': 0.02, 'YTD': 0.012, 'FY': 0.008, '12M': 0.010 })[periodKey] || 0.01;
    // Deterministic noise seed from year (no jitter between renders)
    const noiseAt = (h) => Math.sin(h * 1.7 + year * 0.31) * noiseAmplitude;

    const out = base.map((v, h) => {
      let nv = v;

      // Duck curve: depress midday (10–15h) by up to 18% × duckIntensity
      if (h >= 10 && h <= 15) {
        const phase = Math.sin(((h - 10) / 5) * Math.PI); // 0 at 10/15, 1 at 12.5
        nv *= (1 - 0.18 * duckIntensity * phase);
      }

      // Evening peak amplification (17–20h)
      if (h >= 17 && h <= 20) {
        const phase = Math.sin(((h - 17) / 3) * Math.PI); // peaks at 18-19h
        nv *= (1 + peakAmp * phase);
      }

      // Morning peak attenuation (7–9h)
      if (h >= 7 && h <= 9) {
        nv *= (1 - morningAttenuation);
      }

      // Tiny noise
      nv *= (1 + noiseAt(h));
      return nv;
    });

    // Re-normalise to mean 1 (the warps may have shifted the mean)
    const sum = out.reduce((a, b) => a + b, 0);
    const m = sum / out.length;
    return m > 0 ? out.map(v => v / m) : out;
  }

  // ════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════════════
  window.histHodRenderShape = function (zone) {
    const host = document.getElementById(`histhod-shape`);
    if (!host) return;

    // ── HARD RESET (no idempotence) ─────────────────────────────────
    // Always reset animation state on mount. This prevents zombie states
    // (e.g. STATE.playing=true but setInterval dead → button stuck on PAUSE
    // and only first year visible).
    if (STATE.animTimer) { clearInterval(STATE.animTimer); STATE.animTimer = null; }
    STATE.playing = false;
    STATE.animEnded = false;
    STATE.animVisibleCount = 0;
    STATE.currentZone = zone;

    // Detect fullscreen context via the active _HSZ_TARGET (set by hist.js)
    const isFullscreen = (typeof window._HSZ_TARGET !== 'undefined'
                          && window._HSZ_TARGET
                          && window._HSZ_TARGET.canvasId === 'ho-fs-chart')
                        || (host.closest('#pk-fs-overlay') != null)
                        || (host.closest('#ho-fs-overlay') != null);
    // Chart height: 360px inline, ~ viewport-driven for fullscreen
    const chartHeight = isFullscreen ? 'min(72vh, 760px)' : '360px';
    // Year label size: slightly bigger in fullscreen
    const lblSize = isFullscreen ? '48px' : '34px';

    // ── TITLE BLOCK via the canonical _setHoTitle helper ───────────
    if (typeof _setHoTitle === 'function') {
      const titleHelper = (typeof _titleWithDescription === 'function')
        ? _titleWithDescription
        : (t, d) => `${t} <span style="color:var(--tx3);font-weight:400;font-size:0.78em;margin-left:6px">| ${d}</span>`;
      const cmpLabel = STATE.compareMode === 'fullyear'
        ? 'Current period vs past full years'
        : 'Same calendar window across years';
      _setHoTitle({
        eyebrow: `Prices · YoY · ${zone} · Hourly · Hour-of-day shape`,
        title:   titleHelper('Normalised hourly price shape',
                             'YoY · price ÷ period mean · centred on 1.00'),
        subtitle: `Reveals structural evolution of the daily shape (cannibalisation, duck-curve, peak shift) decoupled from level. <span style="color:var(--tx2)">Compare mode: <b style="color:var(--acc)">${cmpLabel}</b></span>.`,
      });
    }

    // ── FORCE Years scope to 'All' (no longer a user-controlled filter) ──
    // Period filtering is delegated to the page's sticky window filter
    // (HIST.windows['ho']) which propagates via the dispatcher re-render.
    STATE.yearsScope = 'All';

    // ── MINIMAL HOST: filters bar (Compare + Highlight) + chart area ─
    // Period and Years filters have been removed (Period comes from the page
    // sticky window filter, Years is always 'All'). Action buttons live in
    // the tab-bar slot (injected below).
    host.innerHTML = `
      <!-- ═══ Filters bar · Compare mode + multi-select Highlight ═══ -->
      <div class="pk-filters-bar" id="histhod-toolbar">
        <div style="display:flex;align-items:center;gap:6px" title="How to compare past years to the current window. Same window: compare year-to-year on the same calendar dates. vs Full year: current period vs past full years.">
          <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Compare to past years</span>
          <div id="histhod-compare-pills" style="display:inline-flex;gap:4px"></div>
        </div>
        <div class="pk-filters-bar-spacer"></div>
        <div style="display:flex;align-items:center;gap:6px" title="Click one or more years to focus them (others dim). Click All to reset.">
          <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Highlight (multi)</span>
          <div id="histhod-highlight-pills" style="display:inline-flex;gap:4px;flex-wrap:wrap"></div>
        </div>
      </div>

      <!-- Chart container -->
      <div style="position:relative;height:${chartHeight};margin-top:6px">
        <canvas id="histhod-canvas" style="width:100%;height:100%"></canvas>
        <!-- Year label · top-LEFT inside chart area, in the plot zone (matplotlib style) -->
        <div id="histhod-year-label" style="position:absolute;left:78px;top:22px;font-family:'Inter',sans-serif;font-size:${lblSize};font-weight:700;letter-spacing:-.02em;color:var(--acc);opacity:0;pointer-events:none;transition:opacity .3s, color .3s;text-shadow:0 1px 14px rgba(0,0,0,0.55);z-index:5">2026</div>
      </div>
    `;

    // ── INJECT ACTION BUTTONS in the canonical tab-bar slot ──
    const slotId = isFullscreen ? 'ho-fs-toggle-slot' : 'ho-detail-toggle-slot';
    const slot = document.getElementById(slotId);
    if (slot) {
      slot.style.display = 'flex';
      slot.style.alignItems = 'center';
      slot.style.gap = '6px';
      slot.innerHTML = `
        <button class="pk-btn-primary" id="histhod-play-btn" onclick="event.stopPropagation();histHodTogglePlay()" title="Cycle through years cumulatively">▶ Play</button>
        <button class="pk-btn-ghost" onclick="event.stopPropagation();histHodDownloadPng()" title="Download current frame as PNG">${PK.icon('download')} PNG</button>
        <button class="pk-btn-ghost" id="histhod-gif-btn" onclick="event.stopPropagation();histHodDownloadGif()" title="Record animation and download as GIF">${PK.icon('film')} GIF</button>
      `;
    }

    _hodPaintControls();
    _hodRedraw();
  };

  // ── Public data builder (exposed for _bdHodShape in hist.js) ──────
  // Returns { years, shapes } for the active zone, using the default period
  // and full year scope. Independent of UI state — pure data accessor.
  window.histHodBuildData = function (zone) {
    if (!zone) zone = STATE.currentZone;
    if (!zone) return null;
    return _hodBuildYearData(zone, STATE.period, 'All', STATE.compareMode);
  };


  window.histHodSetCompare = function (mode) {
    if (mode !== 'aligned' && mode !== 'fullyear') return;
    if (STATE.compareMode === mode) return;
    STATE.compareMode = mode;
    // Drop animation cleanly — comparison topology changed
    if (STATE.playing || STATE.animEnded) _hodStopPlay();
    // Refresh the title block subtitle to reflect the new compare mode
    if (typeof _setHoTitle === 'function' && STATE.currentZone) {
      const zone = STATE.currentZone;
      const titleHelper = (typeof _titleWithDescription === 'function')
        ? _titleWithDescription
        : (t, d) => `${t} <span style="color:var(--tx3);font-weight:400;font-size:0.78em;margin-left:6px">| ${d}</span>`;
      const cmpLabel = mode === 'fullyear'
        ? 'Current period vs past full years'
        : 'Same calendar window across years';
      _setHoTitle({
        eyebrow: `Prices · YoY · ${zone} · Hourly · Hour-of-day shape`,
        title:   titleHelper('Normalised hourly price shape',
                             'YoY · price ÷ period mean · centred on 1.00'),
        subtitle: `Reveals structural evolution of the daily shape (cannibalisation, duck-curve, peak shift) decoupled from level. <span style="color:var(--tx2)">Compare mode: <b style="color:var(--acc)">${cmpLabel}</b></span>.`,
      });
    }
    _hodPaintControls();
    _hodRedraw();
  };

  // Multi-select highlight: toggle a year in/out of STATE.highlightYears.
  // When the array is empty → stack mode (all years drawn equally).
  // When the array has ≥ 1 year(s) → those years are full-style, others faded.
  window.histHodToggleHighlight = function (y) {
    y = parseInt(y, 10);
    if (isNaN(y)) return;
    if (!STATE.highlightYears) STATE.highlightYears = [];
    const idx = STATE.highlightYears.indexOf(y);
    if (idx >= 0) STATE.highlightYears.splice(idx, 1);
    else          STATE.highlightYears.push(y);
    // Highlight is incompatible with parked animation · drop it
    if (STATE.animEnded && STATE.highlightYears.length > 0) _hodStopPlay();
    _hodPaintControls();
    _hodRedraw();
  };

  // Clear all highlights · return to stack mode (every year drawn equally)
  window.histHodHighlightClear = function () {
    STATE.highlightYears = [];
    _hodPaintControls();
    _hodRedraw();
  };

  window.histHodTogglePlay = function () {
    if (STATE.playing) {
      _hodStopPlay();
    } else {
      _hodStartPlay();
    }
  };

  // ════════════════════════════════════════════════════════════════
  // UI RENDER · pills + chart
  // ════════════════════════════════════════════════════════════════
  function _hodPaintControls() {
    const pkPill = window.pkPill || ((opts) => `<button onclick="${opts.onClick}"${opts.title ? ` title="${opts.title}"` : ''} style="padding:4px 10px;font-size:10px;border-radius:14px;cursor:pointer;background:${opts.active ? 'rgba(20,211,169,0.15)' : 'transparent'};color:${opts.active ? '#14D3A9' : 'var(--tx3)'};border:1px solid ${opts.active ? 'rgba(20,211,169,0.4)' : 'var(--bd)'};font-family:'JetBrains Mono',monospace;font-weight:600">${opts.label}</button>`);

    // Compare mode pills · clearer labels
    // - 'aligned'  : Same window — same calendar dates in every year
    // - 'fullyear' : vs Full years — current period vs past full years
    const cmp = document.getElementById(`histhod-compare-pills`);
    if (cmp) {
      cmp.innerHTML =
        pkPill({ label: 'Same window', active: STATE.compareMode === 'aligned',  onClick: `histHodSetCompare('aligned')`,  title: 'Like-for-like: same calendar window in every year (e.g. YTD 2026 vs YTD 2025, YTD 2024, ...)' }) +
        pkPill({ label: 'vs Full years', active: STATE.compareMode === 'fullyear', onClick: `histHodSetCompare('fullyear')`, title: 'Current period vs past full years (e.g. YTD 2026 vs 2025/2024/... complete years)' });
    }

    // Year highlight pills · multi-select. Click a year to toggle its focus.
    // Click "All" to clear (stack mode, every year drawn equally).
    const hl = document.getElementById(`histhod-highlight-pills`);
    if (hl) {
      const { years } = _hodBuildYearData(STATE.currentZone, STATE.period, STATE.yearsScope, STATE.compareMode);
      const allActive = (!STATE.highlightYears || STATE.highlightYears.length === 0);
      let html = pkPill({ label: 'All', active: allActive, onClick: `histHodHighlightClear()`, title: 'Show all years equally (clear focus)' });
      years.forEach(y => {
        const isFocus = STATE.highlightYears && STATE.highlightYears.includes(y);
        html += pkPill({ label: String(y), active: isFocus, onClick: `histHodToggleHighlight(${y})`, title: 'Toggle focus on this year' });
      });
      hl.innerHTML = html;
    }
  }

  // Helper: convert hex colour to rgba with given alpha
  function _hodHexToRgba(hex, alpha) {
    if (!hex) return `rgba(122,147,171,${alpha})`;
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function _hodRedraw() {
    const canvas = document.getElementById(`histhod-canvas`);
    if (!canvas) return;

    // During Play, ignore yearsScope and use ALL available years (from 2020 onwards
    // at least). This ensures the animation walks the full history.
    const scopeForDraw = STATE.playing ? 'All' : STATE.yearsScope;
    const { years, shapes } = _hodBuildYearData(STATE.currentZone, STATE.period, scopeForDraw, STATE.compareMode);
    if (!years.length) return;

    const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

    const highlightYears = (STATE.highlightYears && STATE.highlightYears.length > 0) ? STATE.highlightYears : null;

    // ── ANIMATION MODE · cumulative build-up ──
    // animVisibleCount = how many years are currently drawn (0 → years.length)
    // - The latest year drawn is in "full" style (current focus)
    // - All previous years are in "faded" style (background trace)
    // - Years beyond animVisibleCount are not drawn at all
    const animMode = STATE.playing || STATE.animEnded;
    const visibleCount = animMode ? STATE.animVisibleCount : years.length;
    const latestVisibleIdx = visibleCount - 1; // -1 if visibleCount = 0

    const datasets = years.map((y, yIdx) => {
      const baseColor = YEAR_PALETTE[y] || '#7A93AB';
      let isFullStyle, isFadedStyle, isHidden;

      if (animMode) {
        // Cumulative build-up: only show years up to visibleCount
        if (yIdx > latestVisibleIdx) { isHidden = true; }
        else if (yIdx === latestVisibleIdx) { isFullStyle = true; }
        else { isFadedStyle = true; }
      } else if (highlightYears) {
        // Manual multi-highlight mode (not playing): focus selected years, dim others
        if (highlightYears.includes(y)) isFullStyle = true;
        else                            isFadedStyle = true;
      } else {
        // Default stack: all equal weight
        isFullStyle = true;
      }

      if (isHidden) {
        // Render an invisible dataset (keeps the legend stable but no line)
        return {
          label: String(y),
          data: shapes[y],
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          borderWidth: 0,
          fill: false,
          pointRadius: 0,
          order: 100 + yIdx,
          hidden: true,
        };
      }

      return {
        label: String(y),
        data:  shapes[y],
        borderColor:     isFullStyle ? baseColor : _hodHexToRgba(baseColor, 0.28),
        backgroundColor: 'transparent',
        borderWidth: isFullStyle ? 2.6 : 1.1,
        borderDash:  isFadedStyle ? [3, 3] : undefined,
        fill: false,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4,
        // The "current focus" year on top, faded years stacked below
        order: isFullStyle ? 0 : (50 - yIdx),
      };
    });

    // Reference line at 1.0 (period average)
    datasets.push({
      label: '__period_avg__',
      data: new Array(24).fill(1.0),
      borderColor: 'rgba(255,255,255,0.20)',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderDash: [2, 4],
      pointRadius: 0,
      fill: false,
      order: 999,
    });

    // ── PRE-COMPUTE Y-AXIS BOUNDS on FULL dataset (all years) ──
    // Critical for animation: Chart.js would otherwise auto-fit Y bounds to
    // currently visible datasets, causing the axis to shift each time a year
    // is revealed. We freeze the axis to the global min/max across all years
    // (plus padding) so the animation stays visually anchored.
    let yMinAll = Infinity, yMaxAll = -Infinity;
    years.forEach(y => {
      const s = shapes[y];
      if (!s) return;
      for (let h = 0; h < s.length; h++) {
        if (s[h] < yMinAll) yMinAll = s[h];
        if (s[h] > yMaxAll) yMaxAll = s[h];
      }
    });
    // Padding: 5% of range on each side, but always include 1.00 (the reference line)
    const yRange = (yMaxAll - yMinAll) || 0.1;
    const yPad = yRange * 0.05;
    const fixedYMin = Math.min(yMinAll - yPad, 1.0 - yPad);
    const fixedYMax = Math.max(yMaxAll + yPad, 1.0 + yPad);

    // Destroy previous instance
    if (window._histHodChart) {
      try { window._histHodChart.destroy(); } catch (_) {}
    }

    window._histHodChart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        // Animation strategy:
        // - In animMode (during Play): only fade-in colors, no Y/X movement
        // - In idle mode (mount): no animation at all (instant render)
        // The global Chart.defaults (set in index.html) already kill X/Y axis
        // animations dashboard-wide, so we only need to add the color fade here.
        animation: animMode ? {
          duration: 600,
          easing: 'easeOutQuad',
        } : {
          duration: 0,
        },
        animations: animMode ? {
          // Fade-in by animating border color from transparent to its target
          borderColor: { type: 'color', duration: 600, from: 'rgba(0,0,0,0)' },
          backgroundColor: { type: 'color', duration: 600, from: 'rgba(0,0,0,0)' },
        } : {},
        plugins: {
          legend: {
            display: true, position: 'top', align: 'end',
            labels: {
              color: '#4A6280',
              font: { size: 10, family: 'JetBrains Mono' },
              boxWidth: 14,
              usePointStyle: true,
              pointStyle: 'line',
              filter: (item, data) => !(data.datasets[item.datasetIndex]?.label || '').startsWith('__'),
            },
          },
          tooltip: {
            backgroundColor: '#0A1018',
            titleColor: '#fff',
            bodyColor: '#B8C9D9',
            borderColor: '#1A2533',
            borderWidth: 1,
            padding: 8,
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont:  { family: 'JetBrains Mono', size: 10 },
            filter: ctx => !(ctx.dataset.label || '').startsWith('__') && !ctx.dataset.hidden,
            callbacks: {
              title: items => items.length ? `Hour ${items[0].label}` : '',
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}× (${(ctx.parsed.y * 100 - 100 >= 0 ? '+' : '')}${(ctx.parsed.y * 100 - 100).toFixed(1)}% vs avg)`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            title: { display: true, text: 'Hour of day', color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9, weight: '600' } },
          },
          y: {
            min: fixedYMin,
            max: fixedYMax,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 }, callback: v => v.toFixed(2) + '×' },
            title: { display: true, text: 'Normalised price · ratio vs period average', color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9, weight: '600' } },
          },
        },
      },
    });

    // Big year label · shows the current focus year during play/animEnded mode
    const lbl = document.getElementById(`histhod-year-label`);
    if (lbl) {
      if (animMode && latestVisibleIdx >= 0) {
        const focusYear = years[latestVisibleIdx];
        lbl.textContent = String(focusYear);
        lbl.style.color = YEAR_PALETTE[focusYear] || 'var(--acc)';
        lbl.style.opacity = STATE.playing ? 0.85 : 0.65;
      } else if (highlightYears && highlightYears.length > 0) {
        // Show all focused years joined by · (e.g. "2024 · 2025")
        // Colour follows the most-recent highlighted year for visual coherence
        const sortedHl = [...highlightYears].sort((a, b) => a - b);
        const latestHl = sortedHl[sortedHl.length - 1];
        lbl.textContent = sortedHl.join(' · ');
        // If just one year highlighted, use its colour; otherwise neutral accent
        lbl.style.color = sortedHl.length === 1 ? (YEAR_PALETTE[latestHl] || 'var(--acc)') : 'var(--acc)';
        lbl.style.opacity = 0.65;
      } else {
        lbl.style.opacity = 0;
      }
    }

    // Banner only — breakdown is rendered by _bdHodShape via the native
    // drill breakdown slot (#ho-detail-breakdown), not by this module
    _hodRenderBanner(undefined, years, shapes);
  }

  // ════════════════════════════════════════════════════════════════
  // ANIMATION · cumulative build-up year by year, stops on final state
  // ════════════════════════════════════════════════════════════════
  const ANIM_INTERVAL_MS = 1200; // cadence per year

  function _hodStartPlay() {
    // Reset state and start with the first year already visible
    // (avoid empty chart for 1.2s at the start of the animation)
    STATE.playing = true;
    STATE.animEnded = false;
    STATE.animVisibleCount = 1;
    const btn = document.getElementById('histhod-play-btn');
    if (btn) btn.innerHTML = '⏸ Pause';

    // Get the full list of years to walk through (ignore yearsScope, use All)
    const { years } = _hodBuildYearData(STATE.currentZone, STATE.period, 'All', STATE.compareMode);
    if (!years.length) { _hodStopPlay(); return; }

    // T=0: first year already drawn (not empty chart)
    _hodRedraw();

    // Walk years cumulatively (2 → years.length)
    STATE.animTimer = setInterval(() => {
      STATE.animVisibleCount += 1;
      if (STATE.animVisibleCount >= years.length) {
        // Reached the end · park in "final figural state" (all years visible,
        // latest in full style, rest faded). Button becomes Replay.
        STATE.animVisibleCount = years.length;
        _hodRedraw();
        _hodEndAnim();
        return;
      }
      _hodRedraw();
    }, ANIM_INTERVAL_MS);
  }

  function _hodEndAnim() {
    // Animation completed naturally · keep final state, switch button to Replay
    if (STATE.animTimer) { clearInterval(STATE.animTimer); STATE.animTimer = null; }
    STATE.playing = false;
    STATE.animEnded = true;
    const btn = document.getElementById('histhod-play-btn');
    if (btn) btn.innerHTML = '↻ Replay';
  }

  function _hodStopPlay() {
    // User-triggered pause · go back to normal stack view
    if (STATE.animTimer) { clearInterval(STATE.animTimer); STATE.animTimer = null; }
    STATE.playing = false;
    STATE.animEnded = false;
    STATE.animVisibleCount = 0;
    const btn = document.getElementById('histhod-play-btn');
    if (btn) btn.innerHTML = '▶ Play';
    _hodRedraw();
  }

  // ════════════════════════════════════════════════════════════════
  // MARKET READ BANNER · contextual analyst commentary
  // ════════════════════════════════════════════════════════════════
  function _hodRenderBanner(idx, years, shapes) {
    // No DOM host needed: we route through _renderAnalystBanner which fills
    // the canonical anchor (#ho-detail-analyst-banner or FS equivalent).
    if (!years || !years.length || !shapes) return;

    // Pick the most recent year as the "current" reference
    const curYear = years[years.length - 1];
    const refYear = years[0];
    const curShape = shapes[curYear];
    const refShape = shapes[refYear];

    // Compute mid-day depression (10–15h) for current vs reference
    const midRange = [10, 11, 12, 13, 14, 15];
    const midCur = midRange.map(h => curShape[h]).reduce((a, b) => a + b, 0) / midRange.length;
    const midRef = midRange.map(h => refShape[h]).reduce((a, b) => a + b, 0) / midRange.length;
    const midDelta = (midCur - midRef) * 100;

    // Evening peak amplitude (17–20h)
    const eveRange = [17, 18, 19, 20];
    const eveCur = eveRange.map(h => curShape[h]).reduce((a, b) => a + b, 0) / eveRange.length;
    const eveRef = eveRange.map(h => refShape[h]).reduce((a, b) => a + b, 0) / eveRange.length;
    const eveDelta = (eveCur - eveRef) * 100;

    // Morning peak (7–9h)
    const mornRange = [7, 8, 9];
    const mornCur = mornRange.map(h => curShape[h]).reduce((a, b) => a + b, 0) / mornRange.length;
    const mornRef = mornRange.map(h => refShape[h]).reduce((a, b) => a + b, 0) / mornRange.length;
    const mornDelta = (mornCur - mornRef) * 100;

    const periodLbl = PERIOD_LABELS[STATE.period];
    const zone = STATE.currentZone || '--';
    const builder = window._gmBuildMarketBanner;

    const line1 = `<strong style="color:#fff">${zone}</strong> hour-of-day shape · ${periodLbl} · normalised vs period avg. Mid-day (10–15h) ${midDelta >= 0 ? '+' : ''}${midDelta.toFixed(1)}% vs ${refYear}, evening (17–20h) ${eveDelta >= 0 ? '+' : ''}${eveDelta.toFixed(1)}%, morning (07–09h) ${mornDelta >= 0 ? '+' : ''}${mornDelta.toFixed(1)}%.`;

    let verdict = '';
    if (midDelta < -5 && eveDelta > 2) {
      verdict = `<b>Duck-curve pattern</b>. Solar cannibalisation visible in the midday trough, evening peak amplifying. Capture-rate compression for solar PPAs, BESS arbitrage opportunity widening.`;
    } else if (midDelta < -2) {
      verdict = `<b>Mid-day softening</b>. Early signal of solar penetration. Watch capture rates for solar offtake.`;
    } else if (eveDelta > 5) {
      verdict = `<b>Evening peak amplification</b>. Flex value rising for peakers and BESS evening discharge.`;
    } else if (mornDelta < -3) {
      verdict = `<b>Morning peak fading</b>. Shift in demand timing (heating + EV charging behaviour).`;
    } else {
      verdict = `<b>Shape stable</b>. Classical 2-peak European pattern persists across years.`;
    }

    // Use the canonical analyst banner renderer (same as Annual average, By
    // quarter, etc.) — fills the #ho-detail-analyst-banner anchor in the
    // drill, or the FS-pane equivalent. Template strict.
    const renderFn = window._renderAnalystBanner || (typeof _renderAnalystBanner === 'function' ? _renderAnalystBanner : null);
    if (renderFn) {
      const ICON = `<span style="font-size:13px;margin-right:6px;vertical-align:-1px">◈</span>`;
      const html = `<div class="hist-analyst-banner" style="padding:11px 14px;font-size:11.5px;border-radius:3px;color:#FBBF24;background:rgba(251,191,36,0.08);border-left:3px solid #FBBF24;line-height:1.6;margin-top:10px">${ICON}${line1}<span style="display:block;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(251,191,36,0.22);font-style:italic;color:rgba(255,255,255,0.82)">Market read : ${verdict}</span></div>`;
      renderFn(html);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // BREAKDOWN TABLE · YoY shape characteristics per year
  // ════════════════════════════════════════════════════════════════
  function _hodRenderBreakdown(idx, years, shapes) {
    const host = document.getElementById(`histhod-breakdown`);
    if (!host) return;

    const fmtR = v => (v - 1) >= 0 ? '+' + ((v - 1) * 100).toFixed(1) + '%' : ((v - 1) * 100).toFixed(1) + '%';

    const rows = years.map(y => {
      const s = shapes[y];
      // Min/max hour
      const minV = Math.min(...s);
      const maxV = Math.max(...s);
      const minH = s.indexOf(minV);
      const maxH = s.indexOf(maxV);
      // Mid-day depression (10–15h)
      const mid = [10, 11, 12, 13, 14, 15].map(h => s[h]).reduce((a, b) => a + b, 0) / 6;
      // Evening peak (17–20h)
      const eve = [17, 18, 19, 20].map(h => s[h]).reduce((a, b) => a + b, 0) / 4;
      // Spread (max − min) as % of avg
      const spread = (maxV - minV) * 100;
      const color = YEAR_PALETTE[y] || '#7A93AB';

      return `<tr style="border-top:1px solid var(--bd)">
        <td style="padding:6px 10px;font-family:'JetBrains Mono',monospace;font-weight:600;color:${color}">${y}</td>
        <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace">${maxV.toFixed(2)}× <span style="color:var(--tx3);font-size:9px">@${String(maxH).padStart(2, '0')}h</span></td>
        <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace">${minV.toFixed(2)}× <span style="color:var(--tx3);font-size:9px">@${String(minH).padStart(2, '0')}h</span></td>
        <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace">${fmtR(mid)}</td>
        <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace">${fmtR(eve)}</td>
        <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace;color:#FBBF24">${spread.toFixed(1)}%</td>
      </tr>`;
    }).join('');

    host.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr>
          <th style="padding:6px 10px;text-align:left;color:var(--tx3);font-weight:600">Year</th>
          <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Peak (× avg)</th>
          <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Trough (× avg)</th>
          <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Mid-day (10–15h)</th>
          <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Evening (17–20h)</th>
          <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Spread max−min</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }


  // ════════════════════════════════════════════════════════════════
  // DOWNLOAD · PNG (snapshot of current frame) + GIF (record full anim)
  // ════════════════════════════════════════════════════════════════

  /**
   * Compose chart canvas + year label overlay into a single offscreen
   * canvas for export. Returns the composed canvas.
   * The year label is rendered on top of the chart at top-right.
   */
  function _hodComposeFrame() {
    const chart = window._histHodChart;
    if (!chart) return null;
    const baseCanvas = chart.canvas;
    const w = baseCanvas.width;
    const h = baseCanvas.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    // Solid dark background (the dashboard's bg)
    ctx.fillStyle = '#0A1018';
    ctx.fillRect(0, 0, w, h);
    // Paint chart
    ctx.drawImage(baseCanvas, 0, 0, w, h);
    // Year label (if visible)
    const lbl = document.getElementById('histhod-year-label');
    if (lbl && parseFloat(lbl.style.opacity || '0') > 0) {
      const text = lbl.textContent;
      const colour = lbl.style.color || '#FBBF24';
      const dpr = (window.devicePixelRatio || 1);
      const fontSize = Math.round(34 * dpr);
      ctx.font = `700 ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      // Soft shadow to detach from chart
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 14 * dpr;
      ctx.shadowOffsetY = 1 * dpr;
      ctx.fillStyle = colour;
      // Position at top-left inside plot area: 78px right of canvas edge (past
      // Y-axis ticks), 22px down from top — matches the on-screen position.
      ctx.fillText(text, 78 * dpr, 22 * dpr);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
    return out;
  }

  window.histHodDownloadPng = function () {
    const composed = _hodComposeFrame();
    if (!composed) {
      alert('Chart not ready · open the sub-tab first');
      return;
    }
    const blob = composed.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = blob;
    a.download = `powerklock_hod_shape_${STATE.currentZone || 'zone'}_${STATE.period}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /**
   * GIF recorder: plays the animation cumulatively from T=0 to T=N, captures
   * one frame per year, then encodes to GIF using gif.js (loaded lazily from
   * jsdelivr CDN). Final state is the figural state (last year full, others
   * faded). Recording can take a few seconds depending on years count.
   */
  function _hodLoadGifLib() {
    return new Promise((resolve, reject) => {
      if (typeof GIF !== 'undefined') { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'js/vendor/gif.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load gif.js'));
      document.head.appendChild(s);
    });
  }

  window.histHodDownloadGif = async function () {
    const btn = document.getElementById('histhod-gif-btn');
    if (!btn) return;
    const originalLabel = btn.innerHTML;
    btn.innerHTML = '⏺ Loading lib...';
    btn.disabled = true;
    try {
      await _hodLoadGifLib();
    } catch (e) {
      btn.innerHTML = originalLabel;
      btn.disabled = false;
      alert('Could not load gif.js (network error). Try PNG instead.');
      return;
    }

    // Stop any current animation
    if (STATE.playing || STATE.animEnded) {
      STATE.playing = false;
      STATE.animEnded = false;
      if (STATE.animTimer) { clearInterval(STATE.animTimer); STATE.animTimer = null; }
    }
    STATE.animVisibleCount = 0;
    _hodRedraw();

    // Build the years list we'll walk through
    const { years } = _hodBuildYearData(STATE.currentZone, STATE.period, 'All', STATE.compareMode);
    if (!years.length) {
      btn.innerHTML = originalLabel;
      btn.disabled = false;
      return;
    }

    // Same-origin blob worker (avoids cross-origin SecurityError)
    let _wkUrl;
    try {
      _wkUrl = await window._pkGetGifWorkerUrl();
    } catch (e) {
      btn.innerHTML = originalLabel;
      btn.disabled = false;
      alert('Could not load gif.js worker (network error). Try PNG instead.');
      return;
    }
    const gif = new GIF({
      workers: 2,
      quality: 10,
      workerScript: _wkUrl,
      width: 720,
      height: 360,
      background: '#0A1018',
    });

    // Frame timing
    const FRAME_DELAY_MS = 1200;
    const FINAL_HOLD_MS  = 2000;

    // Walk years cumulatively, capture a frame at each step
    for (let i = 0; i < years.length; i++) {
      STATE.animVisibleCount = i + 1;
      STATE.playing = true;
      STATE.animEnded = false;
      _hodRedraw();
      // Wait for Chart.js to repaint
      await new Promise(r => setTimeout(r, 320));
      const composed = _hodComposeFrame();
      if (composed) {
        // Scale down for GIF target size
        const target = document.createElement('canvas');
        target.width = 720; target.height = 360;
        target.getContext('2d').drawImage(composed, 0, 0, 720, 360);
        gif.addFrame(target, { delay: i === years.length - 1 ? FINAL_HOLD_MS : FRAME_DELAY_MS });
      }
      btn.innerHTML = `⏺ Capturing ${i + 1}/${years.length}`;
    }

    // Park in animEnded state for the figural final
    STATE.playing = false;
    STATE.animEnded = true;
    _hodRedraw();

    btn.innerHTML = '⏺ Encoding GIF...';

    gif.on('finished', (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `powerklock_hod_shape_${STATE.currentZone || 'zone'}_${STATE.period}.gif`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      btn.innerHTML = originalLabel;
      btn.disabled = false;
      // Restore play state: stop & reset to figural final
      STATE.animEnded = true;
      STATE.playing = false;
      _hodRedraw();
      const playBtn = document.getElementById('histhod-play-btn');
      if (playBtn) playBtn.innerHTML = '↻ Replay';
    });

    gif.render();
  };

})();
/* ════════════════════════════════════════════════════════════════════════════
 * HISTORICAL · YOY HOURLY · ANNUAL AVERAGE — CUMULATIVE ANIMATION
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Mirrors the HOD shape animation engine but uses REAL ENTSO-E intraday data
 * (summary.intraday[zone][year].all) so the curves are actual yearly profiles
 * — not synthesised shapes.
 *
 * Mounted by _hszRenderHourlyYoY (in hist.js) which delegates to histAnnualMount.
 *
 * Public API (exposed on window):
 *   - histAnnualMount(zone, intraday, summary, ctx)  · setup + first render
 *   - histAnnualTogglePlay()                          · start/stop animation
 *   - histAnnualToggleHighlight(year)                 · multi-select highlight
 *   - histAnnualHighlightClear()                      · reset highlight
 *   - histAnnualSetCompare(mode)                      · 'aligned' | 'fullyear'
 *   - histAnnualDownloadPng()                         · current frame PNG
 *   - histAnnualDownloadGif()                         · animation GIF
 *   - histAnnualUnmount()                             · cleanup (called by other modes)
 *   - histAnnualBuildData(zone)                       · public data accessor (for _bdHourlyAnnual + others)
 * ════════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Same palette as HOD module for visual consistency
  const YEAR_PALETTE = {
    2018: '#2C5282', 2019: '#3182CE', 2020: '#38B2AC', 2021: '#48BB78',
    2022: '#ECC94B', 2023: '#ED8936', 2024: '#E53E3E', 2025: '#D53F8C',
    2026: '#FBBF24',
  };

  const STATE = {
    zone: null,
    intraday: null,
    summary: null,
    ctx: null,                  // { canvasId, isFullscreen }
    playing: false,
    animVisibleCount: 0,
    animEnded: false,
    animTimer: null,
    highlightYears: [],
    compareMode: 'aligned',     // 'aligned' | 'fullyear'
    showBands: false,           // P0-P100 + P5-P95 + median bands toggle
  };

  const ANIM_INTERVAL_MS = 1200;

  /* ── DATA ACCESSORS ───────────────────────────────────────────── */

  // Returns { years: ['2018', ..., '2026'], profiles: { '2018': [24 vals], ... } }
  // Uses REAL ENTSO-E intraday[year].all (€/MWh per hour) — not normalised.
  function _buildYearData() {
    if (!STATE.intraday) return { years: [], profiles: {} };
    const yearsAll = Object.keys(STATE.intraday).filter(k => /^\d{4}$/.test(k)).sort();
    const profiles = {};
    yearsAll.forEach(y => {
      const raw = STATE.intraday[y]?.all;
      // Re-use the sanitiser from hist.js scope if available (sparse-data smoothing)
      const sanitised = (typeof window._hszSanitiseHourlyProfile === 'function')
        ? window._hszSanitiseHourlyProfile(raw)
        : raw;
      if (sanitised && Array.isArray(sanitised) && sanitised.length === 24) {
        profiles[y] = sanitised;
      }
    });
    const years = Object.keys(profiles).sort();
    return { years, profiles };
  }

  window.histAnnualBuildData = function (zone) {
    if (zone !== STATE.zone) return null;
    return _buildYearData();
  };

  /* ── MOUNT ─────────────────────────────────────────────────────── */

  window.histAnnualMount = function (zone, intraday, summary, ctx) {
    // Hard reset animation state
    if (STATE.animTimer) { clearInterval(STATE.animTimer); STATE.animTimer = null; }
    STATE.playing = false;
    STATE.animEnded = false;
    STATE.animVisibleCount = 0;

    STATE.zone = zone;
    STATE.intraday = intraday;
    STATE.summary = summary;
    STATE.ctx = ctx || {};

    _injectFiltersBar();
    _injectToolbar();
    _ensureYearLabel();
    _renderTitle();
    _redraw();
  };

  window.histAnnualUnmount = function () {
    if (STATE.animTimer) { clearInterval(STATE.animTimer); STATE.animTimer = null; }
    STATE.playing = false;
    STATE.animEnded = false;
    STATE.animVisibleCount = 0;
    // Remove our injected DOM
    const filters = document.getElementById('histannual-filters');
    if (filters) filters.remove();
    const lbl = document.getElementById('histannual-year-label');
    if (lbl) lbl.remove();
    // Empty toolbar slot
    ['ho-detail-toggle-slot', 'ho-fs-toggle-slot'].forEach(id => {
      const s = document.getElementById(id);
      if (s) { s.innerHTML = ''; s.style.display = 'none'; }
    });
  };

  function _injectFiltersBar() {
    // Find canvas parent; insert filters bar before it.
    const canvasId = (STATE.ctx && STATE.ctx.canvasId) || 'ho-detail-chart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;

    // Remove any previous filters bar (in case we re-mount)
    const old = document.getElementById('histannual-filters');
    if (old) old.remove();

    const bar = document.createElement('div');
    bar.id = 'histannual-filters';
    bar.className = 'pk-filters-bar';
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px" title="How to compare past years to the current window.">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Compare to past years</span>
        <div id="histannual-compare-pills" style="display:inline-flex;gap:4px"></div>
      </div>
      <div class="pk-filters-bar-spacer"></div>
      <div style="display:flex;align-items:center;gap:6px" title="Click one or more years to focus them.">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Highlight (multi)</span>
        <div id="histannual-highlight-pills" style="display:inline-flex;gap:4px;flex-wrap:wrap"></div>
      </div>
    `;
    // Insert before the chart wrap
    wrap.parentNode.insertBefore(bar, wrap);
    _paintControls();
  }

  function _injectToolbar() {
    const isFs = !!(STATE.ctx && STATE.ctx.isFullscreen);
    const slotId = isFs ? 'ho-fs-toggle-slot' : 'ho-detail-toggle-slot';
    const slot = document.getElementById(slotId);
    if (!slot) return;
    slot.style.display = 'flex';
    slot.style.alignItems = 'center';
    slot.style.gap = '6px';

    // Check whether bands are available in the summary (P0-P100, P5-P95)
    const dist = STATE.summary && STATE.summary.intradayDist && STATE.summary.intradayDist[STATE.zone];
    const bandsAvailable = !!(dist && Array.isArray(dist.p0) && dist.p0.length === 24);

    const bandsBtn = bandsAvailable
      ? `<button class="${STATE.showBands ? 'pk-btn-primary' : 'pk-btn-ghost'}" id="histannual-bands-btn" onclick="event.stopPropagation();histAnnualToggleBands()" title="Show/hide historical distribution bands (P0-P100, P5-P95, median)">${STATE.showBands ? '◉' : '○'} Bands</button>`
      : '';

    slot.innerHTML = `
      ${bandsBtn}
      <button class="pk-btn-primary" id="histannual-play-btn" onclick="event.stopPropagation();histAnnualTogglePlay()" title="Cycle through years cumulatively">▶ Play</button>
      <button class="pk-btn-ghost" onclick="event.stopPropagation();histAnnualDownloadPng()" title="Download current frame as PNG">${PK.icon('download')} PNG</button>
      <button class="pk-btn-ghost" id="histannual-gif-btn" onclick="event.stopPropagation();histAnnualDownloadGif()" title="Record animation and download as GIF">${PK.icon('film')} GIF</button>
    `;
  }

  function _ensureYearLabel() {
    const canvasId = (STATE.ctx && STATE.ctx.canvasId) || 'ho-detail-chart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    let lbl = document.getElementById('histannual-year-label');
    if (!lbl) {
      lbl = document.createElement('div');
      lbl.id = 'histannual-year-label';
      lbl.style.cssText = "position:absolute;left:78px;top:22px;font-family:'Inter',sans-serif;font-size:34px;font-weight:700;letter-spacing:-.02em;color:var(--acc);opacity:0;pointer-events:none;transition:opacity .3s, color .3s;text-shadow:0 1px 14px rgba(0,0,0,0.55);z-index:5";
      wrap.appendChild(lbl);
    }
  }

  function _renderTitle() {
    if (typeof window._setHoTitle !== 'function') return;
    const titleHelper = window._titleWithDescription || ((t, d) => `${t} <span style="color:var(--tx3);font-weight:400;font-size:0.78em;margin-left:6px">| ${d}</span>`);
    const cmpLabel = STATE.compareMode === 'fullyear'
      ? 'Current period vs past full years'
      : 'Same calendar window across years';
    window._setHoTitle({
      eyebrow: `Prices · YoY · ${STATE.zone} · Hourly · Annual average`,
      title:   titleHelper('Intraday 24h profile · YoY stack',
                           'Average price by hour of day — all available years'),
      subtitle: `Each curve = one year's average daily profile (€/MWh). Latest year highlighted, past years faded. <span style="color:var(--tx2)">Compare mode: <b style="color:var(--acc)">${cmpLabel}</b></span>. Click Play to animate the historical build-up.`,
    });
  }

  /* ── UI CONTROLS ──────────────────────────────────────────────── */

  function _paintControls() {
    const pkPill = window.pkPill || ((opts) => `<button onclick="${opts.onClick}"${opts.title ? ` title="${opts.title}"` : ''} style="padding:4px 10px;font-size:10px;border-radius:14px;cursor:pointer;background:${opts.active ? 'rgba(20,211,169,0.15)' : 'transparent'};color:${opts.active ? '#14D3A9' : 'var(--tx3)'};border:1px solid ${opts.active ? 'rgba(20,211,169,0.4)' : 'var(--bd)'};font-family:'JetBrains Mono',monospace;font-weight:600">${opts.label}</button>`);

    const cmp = document.getElementById('histannual-compare-pills');
    if (cmp) {
      cmp.innerHTML =
        pkPill({ label: 'Same window',    active: STATE.compareMode === 'aligned',  onClick: `histAnnualSetCompare('aligned')`,  title: 'Like-for-like: same calendar window in every year' }) +
        pkPill({ label: 'vs Full years',  active: STATE.compareMode === 'fullyear', onClick: `histAnnualSetCompare('fullyear')`, title: 'Current period vs past full years' });
    }

    const hl = document.getElementById('histannual-highlight-pills');
    if (hl) {
      const { years } = _buildYearData();
      const allActive = (!STATE.highlightYears || STATE.highlightYears.length === 0);
      let html = pkPill({ label: 'All', active: allActive, onClick: `histAnnualHighlightClear()`, title: 'Show all years equally (clear focus)' });
      years.forEach(y => {
        const yNum = parseInt(y, 10);
        const isFocus = STATE.highlightYears && STATE.highlightYears.includes(yNum);
        html += pkPill({ label: y, active: isFocus, onClick: `histAnnualToggleHighlight(${yNum})`, title: 'Toggle focus on this year' });
      });
      hl.innerHTML = html;
    }
  }

  /* ── SETTERS ──────────────────────────────────────────────────── */

  window.histAnnualSetCompare = function (mode) {
    if (mode !== 'aligned' && mode !== 'fullyear') return;
    if (STATE.compareMode === mode) return;
    STATE.compareMode = mode;
    if (STATE.playing || STATE.animEnded) _stopPlay();
    _renderTitle();
    _paintControls();
    _redraw();
  };

  window.histAnnualToggleHighlight = function (y) {
    y = parseInt(y, 10);
    if (isNaN(y)) return;
    if (!STATE.highlightYears) STATE.highlightYears = [];
    const idx = STATE.highlightYears.indexOf(y);
    if (idx >= 0) STATE.highlightYears.splice(idx, 1);
    else          STATE.highlightYears.push(y);
    if (STATE.animEnded && STATE.highlightYears.length > 0) _stopPlay();
    _paintControls();
    _redraw();
  };

  window.histAnnualHighlightClear = function () {
    STATE.highlightYears = [];
    _paintControls();
    _redraw();
  };

  window.histAnnualToggleBands = function () {
    STATE.showBands = !STATE.showBands;
    _injectToolbar();
    _redraw();
  };

  window.histAnnualTogglePlay = function () {
    if (STATE.playing) _stopPlay();
    else               _startPlay();
  };

  /* ── ANIMATION ────────────────────────────────────────────────── */

  function _startPlay() {
    STATE.playing = true;
    STATE.animEnded = false;
    STATE.animVisibleCount = 1;
    const btn = document.getElementById('histannual-play-btn');
    if (btn) btn.innerHTML = '⏸ Pause';

    const { years } = _buildYearData();
    if (!years.length) { _stopPlay(); return; }

    _redraw();

    STATE.animTimer = setInterval(() => {
      STATE.animVisibleCount += 1;
      if (STATE.animVisibleCount >= years.length) {
        STATE.animVisibleCount = years.length;
        _redraw();
        _endAnim();
        return;
      }
      _redraw();
    }, ANIM_INTERVAL_MS);
  }

  function _stopPlay() {
    if (STATE.animTimer) { clearInterval(STATE.animTimer); STATE.animTimer = null; }
    STATE.playing = false;
    STATE.animEnded = false;
    STATE.animVisibleCount = 0;
    const btn = document.getElementById('histannual-play-btn');
    if (btn) btn.innerHTML = '▶ Play';
    _redraw();
  }

  function _endAnim() {
    if (STATE.animTimer) { clearInterval(STATE.animTimer); STATE.animTimer = null; }
    STATE.playing = false;
    STATE.animEnded = true;
    const btn = document.getElementById('histannual-play-btn');
    if (btn) btn.innerHTML = '↻ Replay';
  }

  /* ── COLOUR HELPER ────────────────────────────────────────────── */
  function _hexToRgba(hex, alpha) {
    if (!hex) return `rgba(122,147,171,${alpha})`;
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /* ── REDRAW ───────────────────────────────────────────────────── */

  function _redraw() {
    const canvasId = (STATE.ctx && STATE.ctx.canvasId) || 'ho-detail-chart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (typeof window.Chart === 'undefined') return;

    const { years, profiles } = _buildYearData();
    if (!years.length) return;

    const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
    const animMode = STATE.playing || STATE.animEnded;
    const highlightYears = (STATE.highlightYears && STATE.highlightYears.length > 0) ? STATE.highlightYears : null;
    const visibleCount = animMode ? STATE.animVisibleCount : years.length;
    const latestVisibleIdx = visibleCount - 1;

    const datasets = [];

    // ── HISTORICAL DISTRIBUTION BANDS (optional, toggle via Bands button) ──
    // Source: summary.intradayDist[zone] = {p0, p5, p50, p95, p100} (computed
    // by enrich_summary.py on all years EXCEPT current). Order=8 puts them in
    // the back, behind the year curves.
    const dist = STATE.summary && STATE.summary.intradayDist && STATE.summary.intradayDist[STATE.zone];
    const hasBands = !!(dist && Array.isArray(dist.p0) && dist.p0.length === 24);
    if (STATE.showBands && hasBands) {
      // Outer Min–Max (P0–P100)
      datasets.push({
        label: 'Min–Max range', data: dist.p100,
        borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(122,147,171,0.04)',
        borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
        fill: '+1', order: 10,
      });
      datasets.push({
        label: '_outer_min', data: dist.p0,
        borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'transparent',
        borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
        fill: false, order: 10, _hideFromLegend: true,
      });
      // Inner P5–P95
      datasets.push({
        label: 'Typical range (P5–P95)', data: dist.p95,
        borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'rgba(122,147,171,0.10)',
        borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
        fill: '+1', order: 9,
      });
      datasets.push({
        label: '_inner_min', data: dist.p5,
        borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'transparent',
        borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
        fill: false, order: 9, _hideFromLegend: true,
      });
      // Historical median
      datasets.push({
        label: 'Hist median', data: dist.p50,
        borderColor: 'rgba(255,255,255,0.30)', borderWidth: 1, pointRadius: 0,
        tension: 0, spanGaps: true, fill: false, borderDash: [2, 3], order: 8,
      });
    }

    // ── YEAR CURVES · one per year ──
    years.forEach((y, yIdx) => {
      const yNum = parseInt(y, 10);
      const baseColor = YEAR_PALETTE[yNum] || '#7A93AB';
      let isFull, isFaded, isHidden;

      if (animMode) {
        if (yIdx > latestVisibleIdx) isHidden = true;
        else if (yIdx === latestVisibleIdx) isFull = true;
        else isFaded = true;
      } else if (highlightYears) {
        if (highlightYears.includes(yNum)) isFull = true;
        else                                isFaded = true;
      } else {
        // Default · latest year full, others faded
        if (yIdx === years.length - 1) isFull = true;
        else                            isFaded = true;
      }

      if (isHidden) {
        datasets.push({
          label: y,
          data: profiles[y],
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          borderWidth: 0,
          fill: false,
          pointRadius: 0,
          hidden: true,
        });
      } else {
        datasets.push({
          label: y,
          data: profiles[y],
          borderColor:     isFull ? baseColor : _hexToRgba(baseColor, 0.28),
          backgroundColor: 'transparent',
          borderWidth:     isFull ? 2.4 : 1.0,
          borderDash:      isFaded ? [3, 3] : undefined,
          fill: false,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 4,
          spanGaps: true,
          order: isFull ? 0 : (5 - yIdx * 0.01),
        });
      }
    });

    // Pre-compute Y bounds on FULL dataset (all years + bands if shown)
    // for stable animation axis
    let yMinAll = Infinity, yMaxAll = -Infinity;
    years.forEach(y => {
      const p = profiles[y];
      if (!p) return;
      for (let h = 0; h < p.length; h++) {
        if (p[h] != null) {
          if (p[h] < yMinAll) yMinAll = p[h];
          if (p[h] > yMaxAll) yMaxAll = p[h];
        }
      }
    });
    // Include band extents in Y bounds when bands are shown (so they fit)
    if (STATE.showBands && hasBands) {
      for (let h = 0; h < 24; h++) {
        if (dist.p0[h]   != null && dist.p0[h]   < yMinAll) yMinAll = dist.p0[h];
        if (dist.p100[h] != null && dist.p100[h] > yMaxAll) yMaxAll = dist.p100[h];
      }
    }
    if (!isFinite(yMinAll)) yMinAll = 0;
    if (!isFinite(yMaxAll)) yMaxAll = 100;
    const yPad = Math.max((yMaxAll - yMinAll) * 0.05, 2);

    // Destroy previous chart on this canvas
    if (window.HIST && window.HIST.charts && window.HIST.charts[canvasId]) {
      try { window.HIST.charts[canvasId].destroy(); } catch (_) {}
      delete window.HIST.charts[canvasId];
    }
    if (window._histAnnualChart) {
      try { window._histAnnualChart.destroy(); } catch (_) {}
    }

    window._histAnnualChart = new window.Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: animMode ? { duration: 600, easing: 'easeOutQuad' } : { duration: 0 },
        animations: animMode ? {
          borderColor: { type: 'color', duration: 600, from: 'rgba(0,0,0,0)' },
          backgroundColor: { type: 'color', duration: 600, from: 'rgba(0,0,0,0)' },
        } : {},
        plugins: {
          legend: {
            display: true, position: 'top', align: 'end',
            labels: {
              color: '#4A6280',
              font: { size: 10, family: 'JetBrains Mono' },
              boxWidth: 14,
              usePointStyle: true,
              pointStyle: 'line',
              filter: (item, data) => {
                const ds = data.datasets[item.datasetIndex];
                return !(ds?.hidden) && !(ds?._hideFromLegend);
              },
            },
          },
          tooltip: {
            backgroundColor: '#0A1018',
            titleColor: '#fff',
            bodyColor: '#B8C9D9',
            borderColor: '#1A2533',
            borderWidth: 1,
            padding: 8,
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont:  { family: 'JetBrains Mono', size: 10 },
            filter: ctx => {
              const ds = ctx.dataset;
              return !ds.hidden && !ds._hideFromLegend;
            },
            callbacks: {
              label: c => ` ${c.dataset.label}: ${c.parsed.y != null ? c.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
            },
          },
          zoom: (window.Chart && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
            zoom: {
              drag: { enabled: true, backgroundColor: 'rgba(20,211,169,0.12)', borderColor: 'rgba(20,211,169,0.5)', borderWidth: 1 },
              wheel: { enabled: false },
              pinch: { enabled: true },
              mode: 'xy',
            },
            pan: { enabled: false },
          } : {},
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 } },
            title: { display: true, text: 'Hour of day', color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9, weight: '600' } },
          },
          y: {
            min: yMinAll - yPad,
            max: yMaxAll + yPad,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 } },
            title: { display: true, text: '€/MWh', color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9, weight: '600' } },
          },
        },
      },
    });
    // Register in HIST.charts so the global reset-zoom button works
    if (window.HIST && window.HIST.charts) window.HIST.charts[canvasId] = window._histAnnualChart;

    // Year label · top-LEFT inside chart area
    const lbl = document.getElementById('histannual-year-label');
    if (lbl) {
      if (animMode && latestVisibleIdx >= 0) {
        const focusYear = years[latestVisibleIdx];
        lbl.textContent = focusYear;
        lbl.style.color = YEAR_PALETTE[parseInt(focusYear, 10)] || 'var(--acc)';
        lbl.style.opacity = STATE.playing ? 0.85 : 0.65;
      } else if (highlightYears && highlightYears.length > 0) {
        const sortedHl = [...highlightYears].sort((a, b) => a - b);
        lbl.textContent = sortedHl.join(' · ');
        lbl.style.color = sortedHl.length === 1 ? (YEAR_PALETTE[sortedHl[0]] || 'var(--acc)') : 'var(--acc)';
        lbl.style.opacity = 0.65;
      } else {
        lbl.style.opacity = 0;
      }
    }
  }

  /* ── DOWNLOAD PNG / GIF ───────────────────────────────────────── */

  function _composeFrame() {
    const canvasId = (STATE.ctx && STATE.ctx.canvasId) || 'ho-detail-chart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const lbl = document.getElementById('histannual-year-label');
    const dpr = (window.devicePixelRatio || 1);
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx2d = out.getContext('2d');
    ctx2d.drawImage(canvas, 0, 0);
    if (lbl && parseFloat(lbl.style.opacity || '0') > 0.05) {
      const text = lbl.textContent || '';
      const colour = lbl.style.color || '#FBBF24';
      const fontSize = Math.round(34 * dpr);
      ctx2d.font = `700 ${fontSize}px Inter, sans-serif`;
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'top';
      ctx2d.shadowColor = 'rgba(0,0,0,0.55)';
      ctx2d.shadowBlur = 14 * dpr;
      ctx2d.shadowOffsetY = 1 * dpr;
      ctx2d.fillStyle = colour;
      ctx2d.fillText(text, 78 * dpr, 22 * dpr);
      ctx2d.shadowBlur = 0;
      ctx2d.shadowOffsetY = 0;
    }
    return out;
  }

  window.histAnnualDownloadPng = function () {
    const composed = _composeFrame();
    if (!composed) return alert('Chart not ready');
    const a = document.createElement('a');
    a.href = composed.toDataURL('image/png');
    a.download = `${STATE.zone || 'annual'}-yoy-${Date.now()}.png`;
    a.click();
  };

  window.histAnnualDownloadGif = async function () {
    if (typeof window.GIF === 'undefined') {
      const script = document.createElement('script');
      script.src = 'js/vendor/gif.js';
      script.onload = () => window.histAnnualDownloadGif();
      script.onerror = () => alert('Failed to load gif.js library');
      document.head.appendChild(script);
      return;
    }
    const btn = document.getElementById('histannual-gif-btn');
    if (btn) { btn.innerHTML = '⏳ Recording'; btn.disabled = true; }

    const originalLabel = PK.icon('film') + ' GIF';

    if (STATE.animTimer) { clearInterval(STATE.animTimer); STATE.animTimer = null; }
    STATE.playing = false;
    STATE.animEnded = false;
    STATE.animVisibleCount = 0;
    _redraw();

    const { years } = _buildYearData();
    if (!years.length) {
      if (btn) { btn.innerHTML = originalLabel; btn.disabled = false; }
      return;
    }

    let _wkUrl;
    try {
      _wkUrl = await window._pkGetGifWorkerUrl();
    } catch (e) {
      if (btn) { btn.innerHTML = originalLabel; btn.disabled = false; }
      alert('Could not load gif.js worker (network error). Try PNG instead.');
      return;
    }
    const gif = new window.GIF({
      workers: 2,
      quality: 10,
      workerScript: _wkUrl,
    });

    let stepIdx = 1;
    function captureNext() {
      STATE.playing = true;
      STATE.animVisibleCount = stepIdx;
      _redraw();
      setTimeout(() => {
        const frame = _composeFrame();
        if (frame) gif.addFrame(frame, { delay: 800, copy: true });
        if (stepIdx < years.length) {
          stepIdx += 1;
          captureNext();
        } else {
          STATE.playing = false;
          STATE.animEnded = true;
          gif.render();
        }
      }, 200);
    }
    captureNext();

    gif.on('finished', (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${STATE.zone || 'annual'}-yoy-${Date.now()}.gif`;
      a.click();
      URL.revokeObjectURL(url);
      if (btn) {
        btn.innerHTML = originalLabel;
        btn.disabled = false;
      }
      const playBtn = document.getElementById('histannual-play-btn');
      if (playBtn) playBtn.innerHTML = '↻ Replay';
    });
  };

})();

// ── Dashboard catalogue: mirrors of the Prices history charts (js/widgets.js) ──
(function () {
  if (!window.PKW) return;
  PKW.mirror({ id: 'hist-spread', pageCanvas: 'hist-spread-canvas', title: 'Daily intraday spread (max − min)', category: 'spreads', page: 'prices', source: 'ENTSO-E',
    desc: 'Daily max − min day-ahead price per zone over the selected window (Prices → Spread).', size: { w: 6, h: 5 },
    ensure: () => { if (typeof renderHistSpread === 'function') return renderHistSpread(); } });
  PKW.mirror({ id: 'hist-neg', pageCanvas: 'hist-neg-canvas', title: 'Negative-price hours per day', category: 'prices', page: 'prices', source: 'ENTSO-E',
    desc: 'Hours with a negative day-ahead price per day over the selected window.', size: { w: 6, h: 5 },
    ensure: () => { if (typeof renderHistNeg === 'function') return renderHistNeg(); } });
})();
