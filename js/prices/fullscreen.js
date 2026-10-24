// js/prices/fullscreen.js — Prices: fullscreen and screenshots.
// Part of the former js/prices.js (lines 4554–4878), split without changes: plain scripts loaded in this order
// by index.html, sharing their globals as before.
// ════════════════════════════════════════════
// FULLSCREEN + SCREENSHOT
// ════════════════════════════════════════════

// Download the row chart as a PNG image
function downloadRowChart(idx) {
  const chart = _rowCharts[idx];
  if (!chart) {
    console.warn('No chart found for row', idx);
    return;
  }
  const z = window._pricesSorted?.[idx];
  const code = z?.code || `zone-${idx}`;
  const dateStr = window._currentPriceDate || pkTodayISO();
  // High-res PNG with theme bg color
  const bgFill = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#fff';
  const dataUrl = chart.toBase64Image('image/png', 1, bgFill);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `powerklock_${code}_${dateStr}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Open the row detail in native fullscreen with chart left, table right
// Table pane is resizable via a drag handle.
function openRowFullscreen(idx) {
  const z = window._pricesSorted?.[idx];
  if (!z) return;
  const inner = document.getElementById(`row-detail-inner-${idx}`);
  if (!inner) return;

  if (typeof window.pkOpenFullscreen !== 'function') {
    console.error('[openRowFullscreen] pkOpenFullscreen is not loaded');
    return;
  }

  const code = z.code;
  // (FLAG_MAP[code] no longer used in the title per the no-emoji design)
  const country = z.name || code;
  const dateStr = (typeof ccFmtDay === 'function') ? ccFmtDay(window._currentPriceDate) : (window._currentPriceDate || '');
  const longDate = (function(){
    try {
      const iso = window._currentPriceDate;
      if (!iso) return dateStr;
      const [y,m,d] = iso.split('-').map(Number);
      return new Date(y, m-1, d).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    } catch(e){ return dateStr; }
  })();

  // ── Clone KPIs from inline drill-down ──
  const inlineKpis = document.getElementById(`row-kpis-${idx}`);
  const kpisHtml = inlineKpis ? inlineKpis.outerHTML : '';

  // ── Clone breakdown table from inline <details> ──
  const inlineDetails = inner.querySelector('details');
  const tableEl = inlineDetails ? inlineDetails.querySelector('table') : null;
  const tableHtml = tableEl ? (
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
       <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--tx2);text-transform:uppercase">15-min breakdown</span>
       <span style="font-size:9px;color:var(--tx3);font-family:'JetBrains Mono',monospace">${tableEl.querySelectorAll('tbody tr').length} slots</span>
     </div>
     ${tableEl.outerHTML}`
  ) : null;

  // ── Clone Market Read banner (analysis) ──
  const inlineBanner = document.getElementById(`row-analyst-banner-${idx}`);
  const analysisHtml = inlineBanner ? inlineBanner.innerHTML : '';

  // ── Filters HTML: Zone selector (dropdown) + Band pills ──
  // The Zone selector lists every zone currently selected in the sidebar
  // (getUserZones) so the user can hop from FR → DE → ES etc.
  // without leaving the fullscreen. The currently-open zone is always included
  // (defensive — in case the user pruned the selection after opening the FS).
  const allLoadedZones = window._pricesSorted || [];
  const userSelectedSet = (typeof getUserZones === 'function')
    ? new Set(getUserZones())
    : null;
  let zonesList = userSelectedSet
    ? allLoadedZones.filter(zi => userSelectedSet.has(zi.code))
    : allLoadedZones;
  // Ensure the currently-open zone is in the list
  if (!zonesList.find(zi => zi.code === code)) {
    const cur = allLoadedZones.find(zi => zi.code === code);
    if (cur) zonesList = [cur, ...zonesList];
  }
  const zoneOptions = zonesList.map((zi) => {
    // Map back to the original index in _pricesSorted (idx used by row toggle / FS reopen)
    const origIdx = allLoadedZones.indexOf(zi);
    const safeName = (zi.name || zi.code).replace(/"/g, '&quot;');
    return `<option value="${origIdx}" ${origIdx === idx ? 'selected' : ''}>${zi.code} — ${safeName}</option>`;
  }).join('');

  const currentDateISO = window._currentPriceDate || pkTodayISO();

  // Filters split: Band (the sub-toggle equivalent) on the LEFT (fixed),
  // Date and Zone on the RIGHT.
  const filtersHtml = `
    <div class="pk-fs-filters-left">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Band</span>
        <div style="display:inline-flex;gap:4px" id="fs-row-band-pills-${idx}">
          ${_rowBandPillsHTML(idx)}
        </div>
      </div>
    </div>
    <div class="pk-fs-filters-right">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Date</span>
        <input type="date" id="fs-row-date-input-${idx}" value="${currentDateISO}" max="${pkTodayISO()}"
          style="background:var(--bg);border:1px solid var(--bd);color:var(--tx);font-size:11px;padding:3px 8px;border-radius:4px;font-family:inherit;cursor:pointer;color-scheme:dark">
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Zone</span>
        <select id="fs-row-zone-select-${idx}" style="background:var(--bg);border:1px solid var(--bd);color:var(--tx);font-size:11px;padding:3px 8px;border-radius:4px;font-family:inherit;cursor:pointer;color-scheme:dark">
          ${zoneOptions}
        </select>
      </div>
    </div>`;

  (window.pkOpenOrUpdate || window.pkOpenFullscreen)({
    title: `${code} — ${country}`,
    subtitle: `${longDate} · 96 × 15min slots · ENTSO-E`,
    filenameStem: `powerklock_daily_drill_${code}_${window._currentPriceDate || 'today'}`,
    storageKey: 'daily-drill',
    kpis: { html: kpisHtml },
    table: tableHtml ? { html: tableHtml } : null,
    analysis: { html: analysisHtml },
    filters: {
      html: filtersHtml,
      // Band pill clicks call setRowBandWindow() via their inline onclick,
      // which now updates BOTH inline and fullscreen pill hosts.
      // Zone select needs explicit wiring: closing + reopening with the new idx.
      wire: (hostEl) => {
        // ── Zone switch ─────────────────────────────────────
        // pkOpenOrUpdate hot-swaps the open overlay in place — no close.
        const sel = hostEl.querySelector(`#fs-row-zone-select-${idx}`);
        if (sel) {
          sel.addEventListener('change', (e) => {
            const newIdx = parseInt(e.target.value, 10);
            if (isNaN(newIdx) || newIdx === idx) return;
            // Make sure the inline row chart for the target index exists
            // (openRowFullscreen reads its config from _rowCharts[newIdx])
            const inlineOpen = document.getElementById(`row-detail-inner-${newIdx}`);
            if (!inlineOpen && typeof togglePriceRow === 'function') {
              togglePriceRow(newIdx, { stopPropagation: () => {} });
            }
            // Defer one tick so togglePriceRow finishes building the chart
            requestAnimationFrame(() => openRowFullscreen(newIdx));
          });
        }
        // ── Date change ─────────────────────────────────────
        // Date change has to reload the whole board, so we still wait for
        // data to land before re-running openRowFullscreen (which will then
        // hot-swap via pkOpenOrUpdate without closing the overlay).
        const dateInp = hostEl.querySelector(`#fs-row-date-input-${idx}`);
        if (dateInp) {
          dateInp.addEventListener('change', (e) => {
            const newDate = e.target.value;
            if (!newDate || newDate === window._currentPriceDate) return;
            if (typeof dpSelect === 'function') {
              dpSelect(newDate);
              const targetCode = code;
              const waitAndUpdate = (attempts) => {
                if (attempts <= 0) return;
                const newIdx = (window._pricesSorted || []).findIndex(z => z.code === targetCode);
                if (newIdx >= 0 && window._currentPriceDate === newDate) {
                  const inlineOpen = document.getElementById(`row-detail-inner-${newIdx}`);
                  if (!inlineOpen && typeof togglePriceRow === 'function') {
                    togglePriceRow(newIdx, { stopPropagation: () => {} });
                  }
                  requestAnimationFrame(() => openRowFullscreen(newIdx));
                } else {
                  setTimeout(() => waitAndUpdate(attempts - 1), 150);
                }
              };
              setTimeout(() => waitAndUpdate(20), 200);
            }
          });
        }
      }
    },
    chartSource: window.pkBuildChartSource({
      chartId: 'row-' + idx,
      isHtmlView: () => false,
      chartsRegistry: () => ({ ['row-' + idx]: _rowCharts[idx] }),
    }),
    onCSV: () => buildRowCSV(idx, code, window._currentPriceDate)
  });

  // Tag the overlay so we can detect "Daily drill fullscreen is open" from
  // elsewhere (zones-changed listener can refresh the FS if needed).
  const overlayEl = document.getElementById('pk-fs-overlay');
  if (overlayEl) overlayEl.setAttribute('data-fs-context', 'daily-drill');
  // Remember the open zone code so zones-changed can recompute idx (since
  // _pricesSorted index may shift if zones are added/removed).
  window._FS_DAILY_DRILL_CODE = code;
}

// Build CSV from the inline 15-min breakdown table — used by pkOpenFullscreen
function buildRowCSV(idx, code, dateStr) {
  const inner = document.getElementById(`row-detail-inner-${idx}`);
  const tableEl = inner?.querySelector('details table');
  if (!tableEl) return null;
  const headerCells = tableEl.querySelectorAll('thead th');
  const headers = Array.from(headerCells).map(th =>
    th.textContent.trim().replace(/\s+/g, ' ').split(/\s{2,}/)[0]
  );
  const dataRows = tableEl.querySelectorAll('tbody tr');
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


// Export 15-min breakdown to CSV
function exportRowCSV(idx, code, dateStr) {
  const z = window._pricesSorted?.[idx];
  if (!z) return;

  // Get the inline table (most reliable source)
  const inner = document.getElementById(`row-detail-inner-${idx}`);
  const tableEl = inner?.querySelector('details table');
  if (!tableEl) {
    alert('No breakdown data available to export');
    return;
  }

  // Extract headers
  const headerCells = tableEl.querySelectorAll('thead th');
  const headers = Array.from(headerCells).map(th => {
    // Clean up: strip HTML, keep first line
    return th.textContent.trim().replace(/\s+/g, ' ').split(/\s{2,}/)[0];
  });

  // Extract rows
  const dataRows = tableEl.querySelectorAll('tbody tr');
  const rows = Array.from(dataRows).map(tr => {
    const cells = tr.querySelectorAll('td');
    return Array.from(cells).map(td => {
      const txt = td.textContent.trim().replace(/\s+/g, ' ');
      // Escape CSV: wrap in quotes if contains comma/quote/newline
      if (/[,"\n]/.test(txt)) return '"' + txt.replace(/"/g, '""') + '"';
      return txt;
    });
  });

  // Build CSV
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `powerklock_${code}_${dateStr||'today'}_15min.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Expose for inline onclick handlers
window.openRowFullscreen = openRowFullscreen;
window.downloadRowChart = downloadRowChart;
window.exportRowCSV = exportRowCSV;
window.hoverSlotOnChart = hoverSlotOnChart;
window.clearSlotHover = clearSlotHover;


// ── Sync hover between breakdown table rows and chart points ───────
// Highlights the matching point on the chart (inline + fullscreen).
function hoverSlotOnChart(idx, slotIdx) {
  // Find which chart to use: prefer fullscreen if open, else inline
  let chart = null;
  const fs = document.getElementById('zone-fullscreen-overlay');
  if (fs && fs._fsChart) {
    chart = fs._fsChart;
  } else {
    chart = _rowCharts[idx];
  }
  if (!chart) return;

  // Find the first dataset that has a non-null value at this slot
  // (datasets typically: today, yesterday, etc.)
  const datasets = chart.data?.datasets || [];
  let targetDS = -1;
  for (let d = 0; d < datasets.length; d++) {
    const v = datasets[d].data?.[slotIdx];
    if (v != null) { targetDS = d; break; }
  }
  if (targetDS === -1) return;

  try {
    chart.setActiveElements([{ datasetIndex: targetDS, index: slotIdx }]);
    if (chart.tooltip) {
      chart.tooltip.setActiveElements([{ datasetIndex: targetDS, index: slotIdx }], { x: 0, y: 0 });
    }
    chart.update('none');
  } catch (e) {
    // Chart.js version mismatch; ignore silently
  }
}

function clearSlotHover(idx) {
  let chart = null;
  const fs = document.getElementById('zone-fullscreen-overlay');
  if (fs && fs._fsChart) {
    chart = fs._fsChart;
  } else {
    chart = _rowCharts[idx];
  }
  if (!chart) return;
  try {
    chart.setActiveElements([]);
    if (chart.tooltip) chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    chart.update('none');
  } catch (e) {}
}

