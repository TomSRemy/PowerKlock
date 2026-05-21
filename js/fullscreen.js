// ════════════════════════════════════════════
// fullscreen.js · pkOpenFullscreen()
// ────────────────────────────────────────────
// Unified fullscreen overlay used across all Prices charts.
//
// Usage:
//   pkOpenFullscreen({
//     title:       'France · Day-Ahead',
//     subtitle:    'Thu, 21 May 2026 · 96 × 15min slots · ENTSO-E',
//     chartSource: { instance: chartInstance }   // or { rebuildInto: canvasEl => Chart }
//     filters:     { html: '<div>…</div>', wire: hostEl => {…} },
//     kpis:        { html: '<div>…</div>' },           // optional · top zone
//     table:       { html: '<table>…</table>' },       // optional · right pane
//     analysis:    { html: '<div>Market Read</div>' }, // optional · under graph
//     onCSV:       () => csvString,                    // optional · CSV export
//     storageKey:  'fs:daily-drill'                    // optional · persist resize state
//   });
//
// Hard requirements:
//   - Native browser fullscreen on the overlay container (ESC closes naturally)
//   - Two resize handles: vertical between graph and table, horizontal between KPI and graph
//   - Drag a panel to the edge to collapse; double-click the handle to restore
//   - Screenshot mode: hides header + KPI + table, shows only title + chart + small logo
//   - Reset zoom / PNG / CSV / Auto-fit table buttons in the global header
// ════════════════════════════════════════════
(function() {
  'use strict';

  const OVERLAY_ID = 'pk-fs-overlay';

  // ── Default sizing ──
  const DEFAULTS = {
    kpiHeight: 90,
    tableWidth: 320,
    minKpi: 20,      // below → collapsed
    minTable: 30,    // below → collapsed
    maxKpi: 220,
    maxTableRatio: 0.70  // max 70% of the main row width
  };

  // ── Public entry point ──
  function pkOpenFullscreen(config) {
    // Strip any prior overlay (defensive — e.g. user re-opens before closing)
    closePrev();

    const root = buildOverlay(config);
    document.body.appendChild(root);

    // No native fullscreen — overlay sits on top of the page, keeps browser tabs visible.
    // ESC is still wired below in wireESC().

    // Build the chart inside the FS canvas now that the DOM is in the document
    setupChart(root, config);

    // Wire interactions: resize handles, buttons, ESC, screenshot toggle
    wireResize(root, config);
    wireHeaderButtons(root, config);
    wireESC(root);

    // Filters (user-supplied HTML + wire callback)
    if (config.filters && typeof config.filters.wire === 'function') {
      const host = root.querySelector('.pk-fs-filters');
      if (host) config.filters.wire(host);
    }

    // Restore previous resize state if a storageKey was given
    if (config.storageKey) restoreLayout(root, config.storageKey);

    // Auto-fit table + KPI to natural content on open, so the user sees
    // a tidy layout immediately. We wait ~250ms for the chart canvas to
    // finish laying out so the resize() call inside autofitTable has the
    // right dimensions.
    setTimeout(() => {
      if (document.getElementById(OVERLAY_ID) === root) {
        autofitTable(root);
      }
    }, 250);
  }

  // ── Build DOM ─────────────────────────────────────────────────
  function buildOverlay(cfg) {
    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;
    wrap.className = 'pk-fs';
    wrap.innerHTML = `
      <div class="pk-fs-header">
        <div class="pk-fs-titles">
          <div class="pk-fs-title">${esc(cfg.title || '')}</div>
          ${cfg.subtitle ? `<div class="pk-fs-subtitle">${esc(cfg.subtitle)}</div>` : ''}
        </div>
        <div class="pk-fs-actions">
          ${(cfg.table || cfg.kpis) ? `<button class="pk-fs-btn" data-act="autofit" title="Auto-fit KPI and table to natural size">⇆ Auto-fit</button>` : ''}
          <button class="pk-fs-btn" data-act="reset" title="Reset zoom">↺ Reset</button>
          <button class="pk-fs-btn" data-act="png" title="Download PNG">⤓ PNG</button>
          ${typeof cfg.onCSV === 'function' ? `<button class="pk-fs-btn" data-act="csv" title="Download CSV">⤓ CSV</button>` : ''}
          <button class="pk-fs-btn" data-act="screenshot" title="Screenshot mode (clean view for sharing)">▢ Screenshot</button>
          <div class="pk-fs-sep"></div>
          <button class="pk-fs-btn pk-fs-btn-close" data-act="close" title="Close (ESC)">✕ ESC</button>
        </div>
      </div>

      <div class="pk-fs-body">

        <div class="pk-fs-main">

          <div class="pk-fs-left-col">
            ${cfg.kpis ? `
            <div class="pk-fs-kpi" style="height:${DEFAULTS.kpiHeight}px">
              ${cfg.kpis.html || ''}
            </div>
            <div class="pk-fs-resizer pk-fs-resizer-h" data-resizer="h" title="Drag to resize · double-click to collapse / restore">
              <div class="pk-fs-resizer-grip"></div>
            </div>
            ` : ''}
            <div class="pk-fs-graph-zone">
              ${cfg.filters ? `<div class="pk-fs-filters">${cfg.filters.html || ''}</div>` : ''}
              <div class="pk-fs-chart-wrap">
                <canvas class="pk-fs-chart"></canvas>
              </div>
              ${cfg.analysis ? `<div class="pk-fs-analysis">${cfg.analysis.html || ''}</div>` : ''}
            </div>
          </div>

          ${cfg.table ? `
          <div class="pk-fs-resizer pk-fs-resizer-v" data-resizer="v" title="Drag to resize · double-click to collapse / restore">
            <div class="pk-fs-resizer-grip"></div>
          </div>
          <div class="pk-fs-table-zone" style="width:${DEFAULTS.tableWidth}px">
            ${cfg.table.html || ''}
          </div>
          ` : ''}

        </div>

      </div>

      <div class="pk-fs-screenshot" style="display:none">
        <div class="pk-fs-screenshot-header">
          <div>
            <div class="pk-fs-screenshot-title">${esc(cfg.title || '')}</div>
            ${cfg.subtitle ? `<div class="pk-fs-screenshot-subtitle">${esc(cfg.subtitle)}</div>` : ''}
          </div>
          <div class="pk-fs-screenshot-logo">
            <img src="assets/logo-header.png" alt="PowerKlock" class="pk-fs-screenshot-logo-img">
          </div>
        </div>
        <div class="pk-fs-screenshot-chart-wrap">
          <canvas class="pk-fs-screenshot-chart"></canvas>
        </div>
        <div class="pk-fs-screenshot-source">Source: ENTSO-E Transparency · powerklock.com</div>
        <button class="pk-fs-btn pk-fs-screenshot-exit" data-act="screenshot-exit" title="Back to full view">↩ Back</button>
      </div>
    `;
    injectStylesOnce();
    return wrap;
  }

  // ── Styles (injected once on first use) ───────────────────────
  function injectStylesOnce() {
    if (document.getElementById('pk-fs-styles')) return;
    const css = `
      .pk-fs {
        position: fixed; inset: 0; background: #060a0f; color: #FFFFFF;
        font-family: 'Inter', 'Outfit', system-ui, sans-serif;
        display: flex; flex-direction: column; z-index: 100000;
        user-select: none;
      }
      .pk-fs * { box-sizing: border-box; }
      /* Re-enable interaction on form controls: the overlay-wide user-select:none
         can otherwise block opening native <select> dropdowns, focusing <input>s,
         or selecting text inside textareas (varies by browser). */
      .pk-fs input,
      .pk-fs select,
      .pk-fs textarea,
      .pk-fs button {
        user-select: auto;
      }

      /* While any fullscreen overlay is in the DOM, hide every easter-egg
         layer (esheep sprites, dots bar, ground, platforms, pipes, lightning,
         tornado, etc.) so they don't bleed through the fullscreen view.
         Covers: pkOpenFullscreen (Daily drill, Cross-zone), Historical drill-down. */
      body:has(#pk-fs-overlay) [class^="es-"],
      body:has(#pk-fs-overlay) [class*=" es-"],
      body:has(#ho-fs-overlay) [class^="es-"],
      body:has(#ho-fs-overlay) [class*=" es-"] {
        display: none !important;
      }

      .pk-fs-header {
        display: flex; justify-content: space-between; align-items: flex-start;
        padding: 14px 20px 12px; border-bottom: 1px solid #1e2d3d; flex-shrink: 0;
      }
      .pk-fs-titles .pk-fs-title {
        font-size: 18px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.04em;
      }
      .pk-fs-titles .pk-fs-subtitle {
        font-size: 11px; color: #B8C9D9;
        font-family: 'JetBrains Mono', monospace; margin-top: 3px;
      }
      .pk-fs-actions { display: flex; align-items: center; gap: 6px; }
      .pk-fs-btn {
        background: #0f1419; border: 1px solid #243447; color: #B8C9D9;
        padding: 5px 9px; border-radius: 4px; font: inherit; font-size: 10px;
        cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease;
      }
      .pk-fs-btn:hover { background: #151c24; border-color: #2d4055; }
      .pk-fs-btn-close { color: #ED6965; }
      .pk-fs-sep { width: 1px; height: 20px; background: #243447; margin: 0 4px; }

      .pk-fs-body {
        flex: 1; padding: 14px 20px 18px;
        min-height: 0; overflow: hidden;
      }

      .pk-fs-main {
        display: flex; flex: 1; gap: 0; min-height: 0; height: 100%;
      }
      .pk-fs-left-col {
        flex: 1; min-width: 0; min-height: 0;
        display: flex; flex-direction: column;
      }
      .pk-fs-kpi {
        flex-shrink: 0; overflow: hidden;
      }
      .pk-fs-graph-zone {
        flex: 1; min-height: 0;
        background: #0f1419; border: 1px solid #1e2d3d; border-radius: 8px;
        padding: 10px; display: flex; flex-direction: column;
      }
      .pk-fs-filters {
        flex-shrink: 0; display: flex; justify-content: flex-end;
        align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;
      }
      .pk-fs-chart-wrap {
        flex: 1; position: relative; min-height: 0;
      }
      .pk-fs-chart {
        width: 100% !important; height: 100% !important; display: block;
      }
      .pk-fs-analysis { flex-shrink: 0; margin-top: 10px; }

      .pk-fs-table-zone {
        flex-shrink: 0; background: #0f1419; border: 1px solid #1e2d3d;
        border-radius: 8px; padding: 10px; overflow: auto; min-height: 0;
      }

      .pk-fs-resizer {
        flex-shrink: 0; background: transparent; display: flex;
        align-items: center; justify-content: center; z-index: 2;
      }
      .pk-fs-resizer-h { height: 8px; cursor: row-resize; margin: 2px 0; }
      .pk-fs-resizer-v { width: 8px; cursor: col-resize; margin: 0 2px; }
      .pk-fs-resizer-grip {
        background: #243447; border-radius: 2px;
        transition: background 0.15s ease;
      }
      .pk-fs-resizer-h .pk-fs-resizer-grip { width: 40px; height: 3px; }
      .pk-fs-resizer-v .pk-fs-resizer-grip { width: 3px; height: 40px; }
      .pk-fs-resizer:hover .pk-fs-resizer-grip,
      .pk-fs-resizer.pk-fs-dragging .pk-fs-resizer-grip { background: #14D3A9; }

      /* Screenshot mode */
      .pk-fs-screenshot {
        position: absolute; inset: 0;
        background: #060a0f; padding: 40px 60px 30px;
        display: flex; flex-direction: column;
      }
      .pk-fs-screenshot-header {
        display: flex; justify-content: space-between; align-items: baseline;
        margin-bottom: 20px;
      }
      .pk-fs-screenshot-title {
        font-size: 24px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.03em;
      }
      .pk-fs-screenshot-subtitle {
        font-size: 13px; color: #B8C9D9;
        font-family: 'JetBrains Mono', monospace; margin-top: 5px;
      }
      .pk-fs-screenshot-logo {
        display: flex; align-items: center; gap: 9px;
      }
      .pk-fs-screenshot-logo-img {
        height: 36px; width: auto; display: block;
      }
      .pk-fs-screenshot-chart-wrap {
        flex: 1; background: #0a0e13; border: 1px solid #1e2d3d;
        border-radius: 8px; padding: 24px; position: relative; min-height: 0;
      }
      .pk-fs-screenshot-chart {
        width: 100% !important; height: 100% !important;
      }
      .pk-fs-screenshot-source {
        margin-top: 14px; font-size: 11px; color: #7A93AB;
        font-family: 'JetBrains Mono', monospace; text-align: right;
      }
      .pk-fs-screenshot-exit {
        position: absolute; top: 20px; right: 20px;
      }
    `;
    const style = document.createElement('style');
    style.id = 'pk-fs-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Chart setup ───────────────────────────────────────────────
  function setupChart(root, cfg) {
    const canvas = root.querySelector('.pk-fs-chart');
    if (!canvas) return;
    let chart = null;
    if (cfg.chartSource && typeof cfg.chartSource.rebuildInto === 'function') {
      chart = cfg.chartSource.rebuildInto(canvas);
    } else if (cfg.chartSource && cfg.chartSource.instance) {
      // Clone config of the source chart, attach to our FS canvas.
      chart = cloneChartTo(canvas, cfg.chartSource.instance);
    }
    root._fsChart = chart;
  }

  function cloneChartTo(canvas, src) {
    try {
      const cfg = {
        type: src.config.type,
        data: JSON.parse(JSON.stringify(src.data, replaceUndef)),
        options: JSON.parse(JSON.stringify(src.options, replaceUndef)),
        plugins: src.config.plugins || []
      };
      // Bump axis fonts for fullscreen readability (default scales)
      bumpFonts(cfg.options);
      // Preserve datasets reference where possible (color etc.)
      if (src.data.datasets && cfg.data.datasets) {
        src.data.datasets.forEach((d, i) => {
          if (cfg.data.datasets[i]) {
            Object.keys(d).forEach(k => {
              if (typeof d[k] === 'function' || typeof d[k] === 'symbol') {
                cfg.data.datasets[i][k] = d[k];
              }
            });
          }
        });
      }
      // eslint-disable-next-line no-undef
      return new Chart(canvas, cfg);
    } catch (e) {
      console.warn('[pk-fs] cloneChartTo failed', e);
      return null;
    }
  }

  function replaceUndef(_k, v) {
    if (v === undefined) return null;
    return v;
  }

  function bumpFonts(opts) {
    try {
      const scales = opts && opts.scales;
      if (!scales) return;
      Object.values(scales).forEach(s => {
        if (!s) return;
        s.ticks = s.ticks || {};
        const f = s.ticks.font || {};
        s.ticks.font = Object.assign({}, f, { size: Math.max((f.size || 11), 13) });
      });
      if (opts.plugins && opts.plugins.legend && opts.plugins.legend.labels) {
        const f = opts.plugins.legend.labels.font || {};
        opts.plugins.legend.labels.font = Object.assign({}, f, { size: Math.max((f.size || 11), 13) });
      }
    } catch (_e) { /* best-effort */ }
  }

  // ── Resize wiring ─────────────────────────────────────────────
  function wireResize(root, cfg) {
    const main = root.querySelector('.pk-fs-main');
    const kpi = root.querySelector('.pk-fs-kpi');
    const table = root.querySelector('.pk-fs-table-zone');

    let dragging = null, startPos = 0, startSize = 0, activeHandle = null;

    function onDown(handle, e) {
      dragging = handle.dataset.resizer;
      activeHandle = handle;
      handle.classList.add('pk-fs-dragging');
      if (dragging === 'v') {
        startPos = e.clientX;
        startSize = table ? table.offsetWidth : 0;
        document.body.style.cursor = 'col-resize';
      } else if (dragging === 'h') {
        startPos = e.clientY;
        startSize = kpi ? kpi.offsetHeight : 0;
        document.body.style.cursor = 'row-resize';
      }
      e.preventDefault();
    }

    function onMove(e) {
      if (!dragging) return;
      if (dragging === 'v' && table) {
        const delta = startPos - e.clientX;
        const newWidth = startSize + delta;
        const maxWidth = main.offsetWidth * DEFAULTS.maxTableRatio;
        const clamped = Math.max(0, Math.min(newWidth, maxWidth));
        table.style.width = clamped + 'px';
        if (clamped < DEFAULTS.minTable) {
          table.style.display = 'none';
        } else {
          table.style.display = '';
        }
      } else if (dragging === 'h' && kpi) {
        const delta = e.clientY - startPos;
        const newHeight = startSize + delta;
        const clamped = Math.max(0, Math.min(newHeight, DEFAULTS.maxKpi));
        kpi.style.height = clamped + 'px';
        if (clamped < DEFAULTS.minKpi) {
          kpi.style.display = 'none';
        } else {
          kpi.style.display = '';
        }
      }
      // Tell Chart.js to relayout since panel sizes changed
      if (root._fsChart && typeof root._fsChart.resize === 'function') {
        root._fsChart.resize();
      }
    }

    function onUp() {
      if (!dragging) return;
      if (activeHandle) activeHandle.classList.remove('pk-fs-dragging');
      dragging = null; activeHandle = null;
      document.body.style.cursor = '';
      if (cfg.storageKey) persistLayout(root, cfg.storageKey);
    }

    root.querySelectorAll('.pk-fs-resizer').forEach(handle => {
      handle.addEventListener('mousedown', e => onDown(handle, e));
      // Double-click to collapse / restore
      handle.addEventListener('dblclick', () => {
        if (handle.dataset.resizer === 'v' && table) {
          if (table.style.display === 'none' || table.offsetWidth < DEFAULTS.minTable) {
            table.style.display = '';
            table.style.width = DEFAULTS.tableWidth + 'px';
          } else {
            table.style.display = 'none';
          }
        } else if (handle.dataset.resizer === 'h' && kpi) {
          if (kpi.style.display === 'none' || kpi.offsetHeight < DEFAULTS.minKpi) {
            kpi.style.display = '';
            kpi.style.height = DEFAULTS.kpiHeight + 'px';
          } else {
            kpi.style.display = 'none';
          }
        }
        if (root._fsChart && typeof root._fsChart.resize === 'function') {
          root._fsChart.resize();
        }
        if (cfg.storageKey) persistLayout(root, cfg.storageKey);
      });
    });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    root._mousemove = onMove;
    root._mouseup = onUp;
  }

  // ── Header buttons ────────────────────────────────────────────
  function wireHeaderButtons(root, cfg) {
    root.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'close') closeOverlay();
        else if (act === 'reset' && root._fsChart && typeof root._fsChart.resetZoom === 'function') root._fsChart.resetZoom();
        else if (act === 'png') downloadPNG(root, cfg);
        else if (act === 'csv' && typeof cfg.onCSV === 'function') downloadCSV(cfg);
        else if (act === 'autofit') autofitTable(root);
        else if (act === 'screenshot') enterScreenshot(root, cfg);
        else if (act === 'screenshot-exit') exitScreenshot(root);
      });
    });
  }

  function downloadPNG(root, cfg) {
    const chart = root._fsChart;
    if (!chart) return;
    try {
      const url = chart.toBase64Image('image/png', 1.0);
      const a = document.createElement('a');
      a.href = url;
      a.download = (cfg.filenameStem || 'chart') + '.png';
      a.click();
    } catch (e) { console.warn('[pk-fs] PNG export failed', e); }
  }

  function downloadCSV(cfg) {
    try {
      const csv = cfg.onCSV();
      if (!csv) return;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (cfg.filenameStem || 'chart') + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch (e) { console.warn('[pk-fs] CSV export failed', e); }
  }

  function autofitTable(root) {
    // Auto-fit the table column to its natural content width AND
    // auto-fit the KPI strip height to fit its cards without scroll.
    const main = root.querySelector('.pk-fs-main');

    // ── Table column ──
    const tableZone = root.querySelector('.pk-fs-table-zone');
    const table = tableZone ? tableZone.querySelector('table') : null;
    if (tableZone && table) {
      const prevWidth = tableZone.style.width;
      tableZone.style.width = 'auto';
      table.style.width = 'max-content';
      const natural = table.offsetWidth + 24; // padding inside zone
      table.style.width = '';
      const maxWidth = main.offsetWidth * DEFAULTS.maxTableRatio;
      tableZone.style.width = Math.min(natural, maxWidth) + 'px';
      tableZone.style.display = '';
    }

    // ── KPI strip ──
    const kpi = root.querySelector('.pk-fs-kpi');
    if (kpi) {
      // Save current style, measure natural height via temporary height:auto
      const prevH = kpi.style.height;
      kpi.style.height = 'auto';
      const natural = kpi.scrollHeight;
      // Clamp to MAX so a very large KPI doesn't eat the graph
      kpi.style.height = Math.min(Math.max(natural, 40), DEFAULTS.maxKpi) + 'px';
      kpi.style.display = '';
    }

    if (root._fsChart && typeof root._fsChart.resize === 'function') root._fsChart.resize();
  }

  // ── Screenshot mode ───────────────────────────────────────────
  function enterScreenshot(root, cfg) {
    root.querySelector('.pk-fs-header').style.display = 'none';
    root.querySelector('.pk-fs-body').style.display = 'none';
    const overlay = root.querySelector('.pk-fs-screenshot');
    overlay.style.display = 'flex';
    // Build a clean chart copy in the screenshot canvas
    const canvas = overlay.querySelector('.pk-fs-screenshot-chart');
    if (canvas && root._fsChart) {
      try { if (root._fsShotChart) { root._fsShotChart.destroy(); } } catch (_) {}
      root._fsShotChart = cloneChartTo(canvas, root._fsChart);
    }
  }
  function exitScreenshot(root) {
    root.querySelector('.pk-fs-header').style.display = '';
    root.querySelector('.pk-fs-body').style.display = '';
    root.querySelector('.pk-fs-screenshot').style.display = 'none';
    if (root._fsShotChart) {
      try { root._fsShotChart.destroy(); } catch (_) {}
      root._fsShotChart = null;
    }
    if (root._fsChart && typeof root._fsChart.resize === 'function') root._fsChart.resize();
  }

  // ── ESC key handler (no native fullscreen) ───────────────────
  function wireESC(root) {
    function onKey(e) {
      if (e.key === 'Escape') {
        // If in screenshot mode, exit it first; otherwise close overlay
        const shot = root.querySelector('.pk-fs-screenshot');
        if (shot && shot.style.display !== 'none') {
          exitScreenshot(root);
        } else {
          closeOverlay();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    root._keyHandler = onKey;
  }

  function closeOverlay() {
    const root = document.getElementById(OVERLAY_ID);
    if (!root) return;
    // Cleanup listeners + chart
    if (root._mousemove) document.removeEventListener('mousemove', root._mousemove);
    if (root._mouseup) document.removeEventListener('mouseup', root._mouseup);
    if (root._keyHandler) document.removeEventListener('keydown', root._keyHandler);
    try { if (root._fsChart) root._fsChart.destroy(); } catch (_) {}
    try { if (root._fsShotChart) root._fsShotChart.destroy(); } catch (_) {}
    root.parentNode && root.parentNode.removeChild(root);
  }

  function closePrev() {
    const prev = document.getElementById(OVERLAY_ID);
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
  }

  // ── Layout persistence (optional) ────────────────────────────
  function persistLayout(root, key) {
    try {
      const kpi = root.querySelector('.pk-fs-kpi');
      const table = root.querySelector('.pk-fs-table-zone');
      const state = {
        kpiHeight: kpi ? kpi.offsetHeight : null,
        kpiHidden: kpi ? kpi.style.display === 'none' : false,
        tableWidth: table ? table.offsetWidth : null,
        tableHidden: table ? table.style.display === 'none' : false
      };
      localStorage.setItem('pk-fs:' + key, JSON.stringify(state));
    } catch (_) {}
  }
  function restoreLayout(root, key) {
    try {
      const raw = localStorage.getItem('pk-fs:' + key);
      if (!raw) return;
      const s = JSON.parse(raw);
      const kpi = root.querySelector('.pk-fs-kpi');
      const table = root.querySelector('.pk-fs-table-zone');
      if (kpi) {
        if (s.kpiHidden) kpi.style.display = 'none';
        else if (s.kpiHeight) kpi.style.height = s.kpiHeight + 'px';
      }
      if (table) {
        if (s.tableHidden) table.style.display = 'none';
        else if (s.tableWidth) table.style.width = s.tableWidth + 'px';
      }
    } catch (_) {}
  }

  // ── Utils ────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  // ── Hot-swap content of an open overlay ──────────────────────
  // Use this instead of close+reopen when a user switches zone, view,
  // date, etc. Keeps the overlay container, the resize state, and the
  // ESC handler intact. Only the content (title, KPI, table, filters,
  // analysis, chart) is replaced.
  function pkUpdateContent(config) {
    const root = document.getElementById(OVERLAY_ID);
    if (!root) return false; // nothing open — caller should fall back to open
    try {
      // Title / subtitle
      const titleEl = root.querySelector('.pk-fs-title');
      const subtitleEl = root.querySelector('.pk-fs-subtitle');
      if (titleEl) titleEl.textContent = config.title || '';
      if (subtitleEl) subtitleEl.textContent = config.subtitle || '';

      // KPI strip
      const kpi = root.querySelector('.pk-fs-kpi');
      if (kpi) {
        kpi.innerHTML = (config.kpis && config.kpis.html) ? config.kpis.html : '';
      }

      // Filters
      const filters = root.querySelector('.pk-fs-filters');
      if (filters) {
        filters.innerHTML = (config.filters && config.filters.html) ? config.filters.html : '';
        if (config.filters && typeof config.filters.wire === 'function') {
          try { config.filters.wire(filters); }
          catch (e) { console.warn('[pk-fs] filters.wire failed', e); }
        }
      }

      // Analysis
      const analysis = root.querySelector('.pk-fs-analysis');
      if (analysis) {
        analysis.innerHTML = (config.analysis && config.analysis.html) ? config.analysis.html : '';
      }

      // Table
      const tableZone = root.querySelector('.pk-fs-table-zone');
      if (tableZone) {
        tableZone.innerHTML = (config.table && config.table.html) ? config.table.html : '';
      }

      // Chart — destroy the current one and rebuild via the same chartSource path
      const canvas = root.querySelector('.pk-fs-chart');
      if (canvas) {
        try { if (root._fsChart) root._fsChart.destroy(); } catch (_) {}
        root._fsChart = null;
        if (config.chartSource && typeof config.chartSource.rebuildInto === 'function') {
          root._fsChart = config.chartSource.rebuildInto(canvas);
        } else if (config.chartSource && config.chartSource.instance) {
          root._fsChart = cloneChartTo(canvas, config.chartSource.instance);
        }
      }

      // Filename stem (used by CSV/PNG exports) is stored on the overlay for later use
      root._fsConfig = config;

      // Re-run auto-fit so the new content settles into a tidy layout
      setTimeout(() => {
        if (document.getElementById(OVERLAY_ID) === root) autofitTable(root);
      }, 200);
      return true;
    } catch (e) {
      console.warn('[pk-fs] pkUpdateContent failed, falling back to close+open', e);
      return false;
    }
  }

  // ── Export ───────────────────────────────────────────────────
  window.pkOpenFullscreen = pkOpenFullscreen;
  window.pkCloseFullscreen = closeOverlay;
  window.pkUpdateContent = pkUpdateContent;
  // Helper for callers: open if closed, else update in place
  window.pkOpenOrUpdate = function(config) {
    const root = document.getElementById(OVERLAY_ID);
    if (root) {
      const ok = pkUpdateContent(config);
      if (ok) return;
    }
    pkOpenFullscreen(config);
  };
})();
