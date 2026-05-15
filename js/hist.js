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

// ── Toggle section open/close ──
function toggleHistSection(id) {
  const header = document.querySelector('#hs-' + id + ' .hist-section-header');
  const body   = document.getElementById('hs-body-' + id);
  if (!header || !body) return;
  const opening = !body.classList.contains('open');
  header.classList.toggle('open', opening);
  body.classList.toggle('open', opening);
  if (opening) {
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
  // Update button states
  const btns = btn.closest('.hist-window-btns').querySelectorAll('.hw-btn');
  btns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // Re-render
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
    'hsz':       renderHistSingle,
    'hmz':       renderHistMulti,
    'hms':       renderHistMonthlyTable,
  };
  if (renders[key]) renders[key]();
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
  // Activate custom mode: clear preset highlights
  HIST.customRange = { from, to };
  document.querySelectorAll('#hw-ho .hw-btn').forEach(b => b.classList.remove('active'));
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

// Colour aliases (redefined here since const doesn't cross script blocks)
var _HIST_TX3  = '#4A6280';
var _HIST_ACC  = '#14D3A9';
var _HIST_WARN = '#EE9B00';
var _HIST_DN   = '#ef4444';
var _HIST_UP   = '#22c55e';
var _HIST_GRID = 'rgba(255,255,255,0.04)';

function baseOptions(yLabel) {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 200 },
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
  const roll7  = rolling(avgs, 7);
  const roll30 = rolling(avgs, 30);

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
  const roll30  = rolling(spreads, 30);

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
  const dailies = await fetchDailyRange(start, end, true);

  if (!dailies.length) return noDataMsg('hist-ren-trend');

  const labels = [], solar = [], wind = [], solarR7 = [], windR7 = [];

  dailies.forEach(day => {
    const fr = day.zones?.FR;
    if (!fr) return;
    labels.push(day.date);
    const s = fr.solar   ? round2(fr.solar.reduce((a,b)=>a+b,0)/fr.solar.length)   : null;
    const w = fr.wind    ? round2(fr.wind.reduce((a,b)=>a+b,0)/fr.wind.length)      : null;
    solar.push(s);
    wind.push(w);
  });

  const sr7 = rolling(solar, 7);
  const wr7 = rolling(wind, 7);

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

  // Fetch daily files -- we need both prices and generation
  const dailies = await fetchDailyRange(start, end, true);
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
  const labels = [], captureRaw = [];

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

    labels.push(day.date);
    captureRaw.push(capture);
  });

  if (!labels.length) return noDataMsg(canvasId);

  const roll30  = rolling(captureRaw, 30);
  const roll90  = rolling(captureRaw, 90);
  const roll365 = rolling(captureRaw, 365);

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
});

function updateZoneLabels() {
  const n = (window._userZones || new Set()).size;
  const lbl1 = document.getElementById('ho-zone-label');
  if (lbl1) lbl1.textContent = n + (n > 1 ? ' zones' : ' zone');
  const lbl2 = document.getElementById('hmz-zone-label');
  if (lbl2) lbl2.textContent = n + (n > 1 ? ' zones' : ' zone');
  // Existing Daily Compare label
  const lbl3 = document.getElementById('compare-filter-label');
  if (lbl3) lbl3.textContent = n + (n > 1 ? ' zones selected' : ' zone selected');
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
    negH, renPctAvg, domFuel,
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
  if (zone && series && typeof _buildHoChart === 'function') {
    // Re-render the chart (non-fullscreen) with the new preset
    _buildHoChart(zone, series, false);
    // Also update the preset buttons UI
    _hoRenderPresetButtons();
  }
};

window._hoResetZoom = function() {
  if (window._HO_CHART && typeof window._HO_CHART.resetZoom === 'function') {
    window._HO_CHART.resetZoom();
  }
  if (window._HO_FS_CHART && typeof window._HO_FS_CHART.resetZoom === 'function') {
    window._HO_FS_CHART.resetZoom();
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
  ['ho-kpi-fr-avg-meta', 'ho-kpi-loaded-meta', 'ho-kpi-fr-peak-meta', 'ho-kpi-fr-off-meta', 'ho-kpi-fr-sigma-meta', 'ho-kpi-fr-negh-meta'].forEach(id => {
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

  // Helper to set a metric value + meta YoY delta
  const setMetric = (idVal, idMeta, currentVal, refVal, status, fallbackText, unit) => {
    _setHoKpi(idVal, currentVal, unit);
    const elMeta = document.getElementById(idMeta);
    if (elMeta) {
      const { html } = _formatYoYDelta(currentVal, refVal, status, fallbackText);
      elMeta.innerHTML = html;
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
  } else {
    _setHoKpi('ho-kpi-fr-avg',   null);
    _setHoKpi('ho-kpi-fr-peak',  null);
    _setHoKpi('ho-kpi-fr-off',   null);
    _setHoKpi('ho-kpi-fr-sigma', null);
    const elN = document.getElementById('ho-kpi-fr-negh');
    if (elN) elN.innerHTML = '--<span class="kpi-unit">h</span>';
    ['ho-kpi-fr-avg-meta','ho-kpi-fr-peak-meta','ho-kpi-fr-off-meta','ho-kpi-fr-sigma-meta','ho-kpi-fr-negh-meta'].forEach(id=>{
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
  } else {
    const elMeta = document.getElementById('ho-kpi-loaded-meta');
    if (elMeta) elMeta.innerHTML = '<span style="color:var(--tx3)">— no Y-1 ref</span>';
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
        <td style="text-align:left;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--tx2)">${flag} ${z}</td>
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
      <td style="text-align:left;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--tx2)">${flag} ${z}</td>
      <td style="text-align:left;font-size:11px;color:var(--tx2)">${countryName}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--tx)">${fmt(st.avg)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx2)">${fmt(st.peakAvg)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${fmt(st.offAvg)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${spreadColor};font-weight:600">${fmt(st.intradaySpread)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx2)">${fmt(st.sigma)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx2)">${fmt(st.min)} / ${fmt(st.max)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:10px;color:${negColor}">${_fmtNegH(st.negH)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${renHtml}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fuelHtml}</td>
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
function _downloadHoChart(zone) {
  const chart = window._HO_CHART;
  if (!chart) {
    console.warn('No Historical chart found for download');
    return;
  }
  const series = window._HO_LAST_SERIES;
  const periodStr = series && series.length
    ? `${series[0].d}_to_${series[series.length-1].d}`
    : new Date().toISOString().slice(0,10);
  // High-res PNG with theme bg color
  const bgFill = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#0a0d12';
  const dataUrl = chart.toBase64Image('image/png', 1, bgFill);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `powerklock_historical_${zone}_${periodStr}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
window._downloadHoChart = _downloadHoChart;

// ── Helper: short date "15 Feb 2026" ──
function _fmtShortDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[m-1]} ${y}`;
}

// ── Helper: build "verdict" sentence summarising the period ──
// Format: "● {Verdict} period · σ {σ} €/MWh · {%REN}% renewable · {neg days} days below 0"
// Verdict categorisation:
//   avg < 50 → "Cheap"          50 ≤ avg ≤ 100 → "Average"        avg > 100 → "Expensive"
//   σ < 15  → "stable"          15 ≤ σ < 30   → "moderate"        σ ≥ 30   → "volatile"
function _buildHoVerdict(st) {
  if (!st || st.avg == null) return '';
  // Price level
  let level;
  if (st.avg < 50)      level = 'Cheap';
  else if (st.avg <= 100) level = 'Average';
  else                  level = 'Expensive';
  // Volatility
  let vol;
  if (st.sigma == null || st.sigma < 15)      vol = 'stable';
  else if (st.sigma < 30)                     vol = 'moderate';
  else                                        vol = 'volatile';
  // Dot colour based on level
  const dotColor = level === 'Cheap'    ? '#14D3A9'
                 : level === 'Average'  ? '#FBBF24'
                 :                        '#ED6965';
  // Build secondary indicators
  const parts = [];
  if (st.sigma != null)      parts.push(`σ ${st.sigma.toFixed(1)} €/MWh`);
  if (st.renPctAvg != null)  parts.push(`${Math.round(st.renPctAvg)}% renewable`);
  // Days with negative prices (count distinct days where negH > 0 in the period)
  // We don't have access to series here; fallback to total negH if days unknown
  if (st.negH > 0)           parts.push(`${_fmtNegH(st.negH)} negative`);
  const secondary = parts.length ? ' · ' + parts.join(' · ') : '';

  // "stable" → use lowercase joined "Cheap & stable", "Expensive & volatile" etc.
  const phrase = `${level} & ${vol}`;
  return `<span style="color:${dotColor};margin-right:6px">●</span><span style="color:var(--tx)">${phrase} period</span><span style="color:var(--tx3)">${secondary}</span>`;
}

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
    <td colspan="12" style="padding:0;background:#141a22;border-bottom:2px solid var(--bd2)">
      <div id="ho-detail-inner" style="padding:14px 16px">

        <!-- Header: zone title + close -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:14px;font-weight:700;color:var(--tx);letter-spacing:-.01em">${flag} ${zone} · ${country}</span>
            <span style="font-size:11px;color:var(--tx3);font-family:'JetBrains Mono',monospace">${periodTxt}</span>
          </div>
          <button onclick="event.stopPropagation();_closeHoRow()"
            style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:4px 10px;font-size:10px;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">✕ Close</button>
        </div>

        <!-- KPI strip (8 cards) -->
        <div id="ho-detail-kpi-strip" class="kpi-strip" style="grid-template-columns:repeat(8,1fr);margin-bottom:14px">
          <!-- filled by _renderHoDetailKpis -->
        </div>

        <!-- Verdict bandeau ("Cheap & stable period · σ X · X% renewable · X neg days") -->
        <div id="ho-detail-verdict" style="font-size:11px;color:var(--tx2);margin-bottom:10px;font-family:'Inter',sans-serif;padding:6px 0">
          ${_buildHoVerdict(st)}
        </div>

        <!-- Legend + actions (above chart, Daily-style) -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin:2px 0 6px;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:14px;font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace;flex-wrap:wrap">
            <span><span style="display:inline-block;width:12px;height:2px;background:${color};vertical-align:middle;margin-right:5px"></span>${zone} · ${series.length}D</span>
            <span><span style="display:inline-block;width:12px;height:1px;border-top:1.5px dashed #94a3b8;vertical-align:middle;margin-right:5px"></span>7D rolling</span>
            <span><span style="display:inline-block;width:12px;height:2px;background:#14D3A9;vertical-align:middle;margin-right:5px"></span>30D rolling</span>
            <span style="opacity:0.75"><span style="display:inline-block;width:12px;height:1px;background:rgba(251,191,36,0.55);vertical-align:middle;margin-right:5px"></span>Daily max</span>
            <span style="opacity:0.75"><span style="display:inline-block;width:12px;height:1px;background:rgba(237,105,101,0.5);vertical-align:middle;margin-right:5px"></span>Daily min</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <div style="display:flex;gap:3px;border-right:1px solid var(--bd);padding-right:6px;margin-right:2px">
              <button data-ho-preset="focus" onclick="event.stopPropagation();_hoSetYPreset('focus')" title="Tight Y axis — hides outliers"
                style="background:${(window._HO_YPRESET==='focus')?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${(window._HO_YPRESET==='focus')?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${(window._HO_YPRESET==='focus')?'#14D3A9':'var(--tx3)'};padding:3px 8px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Focus</button>
              <button data-ho-preset="standard" onclick="event.stopPropagation();_hoSetYPreset('standard')" title="Default Y axis (balanced)"
                style="background:${(window._HO_YPRESET==='standard'||!window._HO_YPRESET)?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${(window._HO_YPRESET==='standard'||!window._HO_YPRESET)?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${(window._HO_YPRESET==='standard'||!window._HO_YPRESET)?'#14D3A9':'var(--tx3)'};padding:3px 8px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Standard</button>
              <button data-ho-preset="all" onclick="event.stopPropagation();_hoSetYPreset('all')" title="Full Y range — shows all outliers"
                style="background:${(window._HO_YPRESET==='all')?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${(window._HO_YPRESET==='all')?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${(window._HO_YPRESET==='all')?'#14D3A9':'var(--tx3)'};padding:3px 8px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">All</button>
              <button onclick="event.stopPropagation();window._hoResetZoom()" title="Reset zoom"
                style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--tx3);padding:3px 8px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">↺</button>
            </div>
            <button onclick="event.stopPropagation();_downloadHoChart('${zone}')" title="Download chart as PNG"
              style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:4px 10px;font-size:10px;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">📸 PNG</button>
            <button onclick="event.stopPropagation();_openHoFullscreen('${zone}')" title="Open in fullscreen"
              style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:4px 10px;font-size:10px;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">⛶ Fullscreen</button>
          </div>
        </div>

        <!-- Chart container — no background, matches Daily style -->
        <div style="position:relative;height:340px;margin-bottom:4px">
          <canvas id="ho-detail-chart" style="width:100%;height:340px"></canvas>
        </div>

        <!-- Alert neg prices (shown only if negH > 0) -->
        ${st.negH > 0 ? `
          <div style="font-size:11px;color:#FBBF24;margin-top:8px;margin-bottom:4px;padding:6px 10px;background:rgba(251,191,36,0.08);border-left:3px solid #FBBF24;border-radius:3px">
            ⚠ ${_fmtNegH(st.negH)} negative prices in period · min: ${st.min != null ? st.min.toFixed(2) : '--'} €/MWh${st.minDate ? ' on ' + _fmtShortDate(st.minDate) : ''}
          </div>
        ` : ''}

        <!-- Monthly breakdown collapsible (replaces standalone Block 4) -->
        <details style="margin-top:12px">
          <summary style="font-size:11px;font-weight:600;color:var(--tx2);cursor:pointer;letter-spacing:.05em;text-transform:uppercase;user-select:none;padding:6px 0">
            Monthly breakdown
          </summary>
          <div id="ho-detail-monthly" style="margin-top:8px;overflow-x:auto"></div>
        </details>
      </div>
    </td>`;
  row.after(detail);

  // Render the KPI strip with dynamic border-left colors (vs Y-1)
  _renderHoDetailKpis(zone, series, st);

  // Build chart
  _buildHoChart(zone, series);

  // Render monthly breakdown inside the <details> (lazy: only when expanded)
  const detailsEl = detail.querySelector('details');
  if (detailsEl) {
    detailsEl.addEventListener('toggle', () => {
      if (detailsEl.open) _renderHoDetailMonthly(zone, series);
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
  // Convention: rouge si plus haut (= plus cher/volatile = mauvais), vert si plus bas
  const cls = (cur, prev, status) => {
    if (status === 'no-ref' || prev == null || cur == null) return 'kpi-flat';
    if (status === 'partial') return 'kpi-flat';
    if (Math.abs(cur - prev) < 0.01 * Math.max(1, Math.abs(prev))) return 'kpi-flat';
    return cur > prev ? 'kpi-up' : 'kpi-down';
  };

  // For spread: higher is "good" for BESS arbitrage → inverse colour convention
  const clsSpread = (cur, prev, status) => {
    if (status === 'no-ref' || prev == null || cur == null) return 'kpi-flat';
    if (status === 'partial') return 'kpi-flat';
    if (Math.abs(cur - prev) < 0.01 * Math.max(1, Math.abs(prev))) return 'kpi-flat';
    return cur > prev ? 'kpi-down' : 'kpi-up';  // up spread = good (green)
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

  const cards = [
    {
      key: 'avg',
      cls: cls(st.avg, ref?.avg, ystat),
      label: 'Avg',
      value: `${fmt(st.avg)}<span class="kpi-unit">€/MWh</span>`,
      metaHtml: meta(st.avg, ref?.avg, ystat),
    },
    {
      key: 'peak',
      cls: cls(st.peakAvg, ref?.peakAvg, ystat),
      label: 'Peak avg',
      value: `${fmt(st.peakAvg)}<span class="kpi-unit">€/MWh</span>`,
      metaHtml: meta(st.peakAvg, ref?.peakAvg, ystat),
    },
    {
      key: 'off',
      cls: cls(st.offAvg, ref?.offAvg, ystat),
      label: 'Off-peak avg',
      value: `${fmt(st.offAvg)}<span class="kpi-unit">€/MWh</span>`,
      metaHtml: meta(st.offAvg, ref?.offAvg, ystat),
    },
    {
      key: 'spread',
      cls: clsSpread(st.intradaySpread, ref?.intradaySpread, ystat),
      label: 'Spread intraday',
      value: `${fmt(st.intradaySpread)}<span class="kpi-unit">€/MWh</span>`,
      metaHtml: meta(st.intradaySpread, ref?.intradaySpread, ystat, true),
      title: 'Average intraday spread (max - min per day) — proxy for BESS arbitrage potential',
    },
    {
      key: 'sigma',
      cls: cls(st.sigma, ref?.sigma, ystat),
      label: 'Volatility (σ)',
      value: `${fmt(st.sigma)}<span class="kpi-unit">€/MWh</span>`,
      metaHtml: meta(st.sigma, ref?.sigma, ystat),
      title: 'Volatility = standard deviation of daily average prices over the selected period. Higher σ means prices swing more day-to-day. Rule of thumb: <15 stable · 15-30 moderate · >30 volatile.',
    },
    {
      key: 'extremes',
      cls: 'kpi-flat',
      label: 'Extremes',
      // Custom 2-line layout instead of single value
      customHtml: `
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;color:#14D3A9;line-height:1.15">▲ ${fmt(st.max)}<span style="font-size:9px;color:var(--tx3);margin-left:3px">€/MWh</span></div>
        <div style="font-size:9px;color:var(--tx3);margin-bottom:4px">${fmtDate(st.maxDate)}</div>
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;color:#ED6965;line-height:1.15">▼ ${fmt(st.min)}<span style="font-size:9px;color:var(--tx3);margin-left:3px">€/MWh</span></div>
        <div style="font-size:9px;color:var(--tx3)">${fmtDate(st.minDate)}</div>
      `,
    },
    {
      key: 'negh',
      cls: cls(st.negH, ref?.negH, ystat),
      label: 'Neg hours',
      value: _fmtNegH(st.negH),
      metaHtml: meta(st.negH, ref?.negH, ystat),
    },
    {
      key: 'mix',
      cls: 'kpi-flat',
      label: 'Mix',
      // Custom 2-line layout: each line explicitly labelled
      customHtml: `
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;line-height:1.15">${renHtml}<span style="font-size:9px;color:var(--tx3);margin-left:5px;font-weight:400">renewable share</span></div>
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

  const country = _HO_NAMES[zone] || zone;
  const flag    = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[zone]) || '';
  const color   = zoneColor(zone);
  const fmt     = v => (v == null || isNaN(v)) ? '--' : v.toFixed(2);

  const periodTxt = (HIST.customRange && HIST.customRange.from)
    ? `${HIST.customRange.from} → ${HIST.customRange.to}`
    : periodLabel(series);

  // Remove existing overlay
  let fs = document.getElementById('ho-fs-overlay');
  if (fs) fs.remove();

  fs = document.createElement('div');
  fs.id = 'ho-fs-overlay';
  fs.style.cssText = `
    position: fixed; inset: 0; background: var(--bg);
    z-index: 9999; display: flex; flex-direction: column;
    padding: 16px 24px 24px; overflow: hidden;
  `;

  fs.innerHTML = `
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-shrink:0">
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--tx);letter-spacing:-0.01em">
          ${flag} ${zone} — ${country}
        </div>
        <div style="font-size:12px;color:var(--tx2);margin-top:2px">
          ${periodTxt}
          <span style="color:var(--tx3);margin-left:12px">· Click-drag chart to zoom · Double-click to reset</span>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button id="ho-fs-resize-btn" title="Reset side pane width"
          style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:8px 10px;font-size:11px;border-radius:6px;cursor:pointer;font-family:inherit">⇔</button>
        <button id="ho-fs-close-btn"
          style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:8px 14px;font-size:11px;border-radius:6px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">✕ Close (Esc)</button>
      </div>
    </div>

    <!-- KPI strip full width at the top -->
    <div id="ho-fs-kpis" style="margin-bottom:14px;flex-shrink:0"></div>

    <!-- Verdict bandeau full width -->
    <div id="ho-fs-verdict" style="font-size:12px;color:var(--tx2);margin-bottom:12px;font-family:'Inter',sans-serif;flex-shrink:0">
      ${_buildHoVerdict(st)}
    </div>

    <!-- Split: chart left, Monthly breakdown right, drag handle in between -->
    <div id="ho-fs-split" style="display:flex;gap:0;flex:1;min-height:0;position:relative">
      <div id="ho-fs-chart-pane" style="flex:1;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:16px;display:flex;flex-direction:column;min-height:0;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-shrink:0">
          <div style="font-size:11px;font-weight:600;color:var(--tx2);letter-spacing:.06em;text-transform:uppercase">Daily price chart</div>
          <div style="display:flex;gap:3px">
            <button data-ho-preset="focus" onclick="_hoSetYPreset('focus');_renderHoFsChart('${zone}')" title="Tight Y axis"
              style="background:${(window._HO_YPRESET==='focus')?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${(window._HO_YPRESET==='focus')?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${(window._HO_YPRESET==='focus')?'#14D3A9':'var(--tx3)'};padding:3px 10px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Focus</button>
            <button data-ho-preset="standard" onclick="_hoSetYPreset('standard');_renderHoFsChart('${zone}')" title="Default Y axis"
              style="background:${(window._HO_YPRESET==='standard'||!window._HO_YPRESET)?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${(window._HO_YPRESET==='standard'||!window._HO_YPRESET)?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${(window._HO_YPRESET==='standard'||!window._HO_YPRESET)?'#14D3A9':'var(--tx3)'};padding:3px 10px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Standard</button>
            <button data-ho-preset="all" onclick="_hoSetYPreset('all');_renderHoFsChart('${zone}')" title="Full Y range"
              style="background:${(window._HO_YPRESET==='all')?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${(window._HO_YPRESET==='all')?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${(window._HO_YPRESET==='all')?'#14D3A9':'var(--tx3)'};padding:3px 10px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">All</button>
            <button onclick="window._hoResetZoom()" title="Reset zoom"
              style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--tx3);padding:3px 10px;font-size:9px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase">↺ Reset</button>
          </div>
        </div>
        <div style="flex:1;position:relative;min-height:0">
          <canvas id="ho-fs-chart" style="width:100%;height:100%"></canvas>
        </div>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:14px;font-size:10px;color:var(--tx3);margin-top:6px;font-family:'JetBrains Mono',monospace;flex-shrink:0;flex-wrap:wrap">
          <span><span style="display:inline-block;width:12px;height:2px;background:${color};vertical-align:middle;margin-right:4px"></span>Daily avg</span>
          <span><span style="display:inline-block;width:12px;height:1px;border-top:1px dashed #94a3b8;vertical-align:middle;margin-right:4px"></span>7D rolling</span>
          <span><span style="display:inline-block;width:12px;height:2px;background:#14D3A9;vertical-align:middle;margin-right:4px"></span>30D rolling</span>
          <span style="opacity:0.75"><span style="display:inline-block;width:12px;height:1px;background:rgba(251,191,36,0.55);vertical-align:middle;margin-right:4px"></span>Daily max</span>
          <span style="opacity:0.75"><span style="display:inline-block;width:12px;height:1px;background:rgba(237,105,101,0.5);vertical-align:middle;margin-right:4px"></span>Daily min</span>
        </div>
        <!-- Alert neg prices (shown only if negH > 0) -->
        ${st.negH > 0 ? `
          <div style="font-size:11px;color:#FBBF24;margin-top:8px;padding:6px 10px;background:rgba(251,191,36,0.08);border-left:3px solid #FBBF24;border-radius:3px;flex-shrink:0">
            ⚠ ${_fmtNegH(st.negH)} negative prices in period · min: ${st.min != null ? st.min.toFixed(2) : '--'} €/MWh${st.minDate ? ' on ' + _fmtShortDate(st.minDate) : ''}
          </div>
        ` : ''}
      </div>

      <div id="ho-fs-divider" title="Drag to resize · double-click to reset"
        style="width:8px;cursor:col-resize;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:transparent">
        <div style="width:2px;height:40px;background:var(--bd);border-radius:1px;transition:background 0.15s"></div>
      </div>

      <div id="ho-fs-info-pane" style="flex-shrink:0;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:16px;overflow-y:auto;min-height:0;min-width:280px;max-width:60%;width:440px;display:flex;flex-direction:column">
        <div style="font-size:11px;font-weight:600;color:var(--tx2);letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px;flex-shrink:0">Monthly breakdown</div>
        <div id="ho-fs-monthly" style="flex:1;overflow-y:auto;min-height:0"></div>
      </div>
    </div>
  `;

  document.body.appendChild(fs);
  document.body.style.overflow = 'hidden';

  // Render the KPI strip directly in the fullscreen target (8 cards, identical to inline)
  const kpiTarget = document.getElementById('ho-fs-kpis');
  if (kpiTarget) {
    // Temporarily swap the target id so _renderHoDetailKpis writes here
    const inlineStrip = document.getElementById('ho-detail-kpi-strip');
    let originalParent = null;
    let originalNext = null;
    if (inlineStrip) {
      // Move the inline strip aside while we render into the fs target
      originalParent = inlineStrip.parentNode;
      originalNext = inlineStrip.nextSibling;
    }
    // Create a temporary div with the same id and render into it, then move into kpiTarget
    const tmp = document.createElement('div');
    tmp.id = 'ho-detail-kpi-strip';
    tmp.className = 'kpi-strip';
    tmp.style.cssText = 'grid-template-columns:repeat(8,1fr)';
    document.body.appendChild(tmp);
    // Hide the original temporarily if it exists (avoid id collision)
    if (inlineStrip) inlineStrip.id = 'ho-detail-kpi-strip-bak';
    _renderHoDetailKpis(zone, series, st).then(() => {
      // Move rendered HTML into the fullscreen target
      kpiTarget.innerHTML = `<div class="kpi-strip" style="grid-template-columns:repeat(8,1fr)">${tmp.innerHTML}</div>`;
      tmp.remove();
      if (inlineStrip) inlineStrip.id = 'ho-detail-kpi-strip';
    });
  }

  // Render the Monthly breakdown directly in the right pane
  const monthlyTarget = document.getElementById('ho-fs-monthly');
  if (monthlyTarget) {
    // _renderHoDetailMonthly writes into #ho-detail-monthly — temporarily swap ids
    const inlineMonthly = document.getElementById('ho-detail-monthly');
    if (inlineMonthly) inlineMonthly.id = 'ho-detail-monthly-bak';
    const tmp = document.createElement('div');
    tmp.id = 'ho-detail-monthly';
    document.body.appendChild(tmp);
    _renderHoDetailMonthly(zone, series).then(() => {
      monthlyTarget.innerHTML = tmp.innerHTML;
      tmp.remove();
      if (inlineMonthly) inlineMonthly.id = 'ho-detail-monthly';
    });
  }

  // Build the fullscreen chart
  window._renderHoFsChart = function(zone) {
  const series = window._HO_LAST_SERIES;
  if (!zone || !series) return;
  if (typeof _buildHoChart === 'function') {
    _buildHoChart(zone, series, true);
  }
  // Update FS button styles
  document.querySelectorAll('#ho-fs-chart-pane [data-ho-preset]').forEach(btn => {
    const p = btn.dataset.hoPreset;
    const active = window._HO_YPRESET === p || (p === 'standard' && !window._HO_YPRESET);
    btn.style.background = active ? 'rgba(20,211,169,0.15)' : 'transparent';
    btn.style.borderColor = active ? 'rgba(20,211,169,0.4)' : 'rgba(255,255,255,0.15)';
    btn.style.color = active ? '#14D3A9' : 'var(--tx3)';
  });
};

setTimeout(() => _buildHoChart(zone, series, true), 50);

  // Drag-resize handle
  const divider  = document.getElementById('ho-fs-divider');
  const infoPane = document.getElementById('ho-fs-info-pane');
  const split    = document.getElementById('ho-fs-split');
  if (divider && infoPane && split) {
    let dragging = false;
    divider.addEventListener('mousedown', (e) => {
      dragging = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = split.getBoundingClientRect();
      const newWidth = Math.max(240, Math.min(rect.right - e.clientX, rect.width * 0.7));
      infoPane.style.width = newWidth + 'px';
      // Resize chart
      if (window._HO_FS_CHART) window._HO_FS_CHART.resize();
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    });
    divider.addEventListener('dblclick', () => {
      infoPane.style.width = '340px';
      if (window._HO_FS_CHART) window._HO_FS_CHART.resize();
    });
  }

  // Reset width button
  const resetBtn = document.getElementById('ho-fs-resize-btn');
  if (resetBtn && infoPane) {
    resetBtn.addEventListener('click', () => {
      infoPane.style.width = '340px';
      if (window._HO_FS_CHART) window._HO_FS_CHART.resize();
    });
  }

  // Close button + Esc key
  const closeBtn = document.getElementById('ho-fs-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', _closeHoFullscreen);
  document.addEventListener('keydown', _hoFsEscHandler);
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

const HSZ = {
  zone: 'FR',
  tab: 'lines',
  hourlyMode: 'quarter',  // 'quarter' | 'yoy'
  tabs: [
    { id: 'lines',    label: 'Lines' },
    { id: 'yoy',      label: 'YoY' },
    { id: 'seasonal', label: 'Seasonal' },
    { id: 'hourly',   label: 'Hourly' },
    { id: 'weekly',   label: 'Weekly' },
    { id: 'vol',      label: 'Volatility' },
  ],
};

function setHistHourlyMode(mode) {
  HSZ.hourlyMode = mode;
  renderHistSingle();
}
window.setHistHourlyMode = setHistHourlyMode;

function setHistSingleZone(zone) {
  HSZ.zone = zone;
  renderHistSingle();
}
window.setHistSingleZone = setHistSingleZone;

function setHistSingleTab(tabId) {
  HSZ.tab = tabId;
  buildHistSingleTabs();
  renderHistSingle();
}
window.setHistSingleTab = setHistSingleTab;

function buildHistSingleTabs() {
  const wrap = document.getElementById('hsz-tabs');
  if (!wrap) return;
  wrap.innerHTML = HSZ.tabs.map(t => {
    const on = t.id === HSZ.tab;
    return `<button onclick="setHistSingleTab('${t.id}')" style="
      padding:5px 12px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;
      border:none;background:${on?'var(--bg3)':'transparent'};
      color:${on?'var(--text)':'var(--tx3)'};
      letter-spacing:.03em;
    ">${t.label}</button>`;
  }).join('');
}

async function renderHistSingle() {
  buildHistSingleTabs();
  const w = HIST.windows['hsz'] || '3M';
  const zone = HSZ.zone;
  const s = await fetchSummary();
  if (!s?.zones?.[zone]) {
    _hszPlaceholder('No data for ' + zone);
    return;
  }

  const filtered = filterByWindow(s.zones[zone], w);
  if (!filtered.length) {
    _hszPlaceholder('No data in selected window');
    return;
  }

  // KPI strip (always shown, computed from filtered)
  const st = _statsForZone(filtered);
  if (st) {
    document.getElementById('hsz-kpi-avg-v').innerHTML = st.avg.toFixed(1) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hsz-kpi-avg-meta').textContent = zone + ' · ' + st.days + 'd';
    document.getElementById('hsz-kpi-peak-v').innerHTML = (st.peakAvg != null ? st.peakAvg.toFixed(1) : '--') + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hsz-kpi-offpeak-v').innerHTML = (st.offAvg != null ? st.offAvg.toFixed(1) : '--') + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hsz-kpi-vol-v').innerHTML = st.sigma.toFixed(1) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hsz-kpi-neg-v').innerHTML = _fmtNegH(st.negH);
    const spread = (st.peakAvg != null && st.offAvg != null) ? (st.peakAvg - st.offAvg) : null;
    document.getElementById('hsz-kpi-spread-v').innerHTML = (spread != null ? spread.toFixed(1) : '--') + '<span class="kpi-unit">€/MWh</span>';
  }

  // Period label
  const periodEl = document.getElementById('hsz-period');
  if (periodEl) periodEl.textContent = periodLabel(filtered);

  // Toggle canvas vs heatmap
  const canvas = document.getElementById('hsz-canvas');
  const heatmap = document.getElementById('hsz-heatmap');
  if (canvas) canvas.style.display = '';
  if (heatmap) heatmap.style.display = 'none';

  // Cleanup Hourly-specific UI when switching to another tab
  if (HSZ.tab !== 'hourly') {
    const tg = document.getElementById('hsz-hourly-toggle');
    if (tg) tg.remove();
    const qg = document.getElementById('hsz-quarter-grid');
    if (qg) qg.remove();
  }
  // Cleanup Lines-specific Y preset bar when switching to another tab
  if (HSZ.tab !== 'lines') {
    const yp = document.getElementById('hsz-y-presets');
    if (yp) yp.remove();
  }

  // Dispatch render by tab
  if (HSZ.tab === 'lines')    return _hszRenderLines(filtered, zone);
  if (HSZ.tab === 'yoy')      return _hszRenderYoY(filtered, zone, s);
  if (HSZ.tab === 'seasonal') return _hszRenderSeasonal(filtered, zone, s);
  if (HSZ.tab === 'hourly')   return _hszRenderHourly(filtered, zone);
  if (HSZ.tab === 'weekly')   return _hszRenderWeekly(filtered, zone);
  if (HSZ.tab === 'vol')      return _hszRenderVolatility(filtered, zone);
  return _hszPlaceholder('🚧 ' + HSZ.tab + ' · data ready · chart coming next');
}
window.renderHistSingle = renderHistSingle;

function _hszPlaceholder(msg) {
  const canvas = document.getElementById('hsz-canvas');
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
  renderHistSingle();
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

// Inject Y preset buttons in the HSZ header area (above tabs / chart)
function _hszInjectYPresets() {
  const canvas = document.getElementById('hsz-canvas');
  if (!canvas) return;
  const wrap = canvas.parentNode;
  const old = document.getElementById('hsz-y-presets');
  if (old) old.remove();
  // Only inject for 'lines' tab (the one where Y range matters most)
  if (HSZ.tab !== 'lines') return;
  const bar = document.createElement('div');
  bar.id = 'hsz-y-presets';
  bar.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;margin-bottom:8px;font-size:10px;font-family:\'JetBrains Mono\',monospace;flex-wrap:wrap';
  const mkBtn = (id, label, title) => {
    const active = _hszYPreset === id;
    return `<button onclick="setHszYPreset('${id}')" title="${title}" style="background:${active?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${active?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${active?'#14D3A9':'var(--tx3)'};padding:3px 10px;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;font-family:inherit;letter-spacing:0.04em;text-transform:uppercase">${label}</button>`;
  };
  bar.innerHTML = `
    ${mkBtn('focus', 'Focus', 'Y axis ± 20% around avg — hides outliers')}
    ${mkBtn('standard', 'Standard', 'Y axis ± 30% around avg — default')}
    ${mkBtn('all', 'All', 'Y axis covers daily max/min — shows outliers')}
    <button onclick="_hszResetZoom()" title="Reset any manual zoom/pan" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--tx3);padding:3px 10px;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;font-family:inherit;letter-spacing:0.04em;text-transform:uppercase">↺ Reset</button>
  `;
  wrap.insertBefore(bar, canvas);
}

function _hszResetZoom() {
  const ch = HIST.charts['hsz-canvas'];
  if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
}
window._hszResetZoom = _hszResetZoom;

function _hszRenderLines(filtered, zone) {
  const labels = filtered.map(d => d.d);
  const avgs   = filtered.map(d => d.avg);
  const maxes  = filtered.map(d => d.max);
  const mins   = filtered.map(d => d.min);
  const roll7  = rolling(avgs, 7);
  const roll30 = rolling(avgs, 30);
  const color = zoneColor(zone);

  // Convert zone color to rgba for ribbon fill (now ultra-discreet: 5%)
  let ribbonFill = 'rgba(20,211,169,0.05)';
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    ribbonFill = `rgba(${r},${g},${b},0.05)`;
  }
  // Very thin, very faint max/min lines (decorative guides)
  const maxBorder = 'rgba(251,191,36,0.30)';
  const minBorder = 'rgba(237,105,101,0.28)';

  // Compute Y range based on preset (Focus uses rolling lines range)
  const validAvgs  = avgs.filter(v => v != null);
  const validMaxes = maxes.filter(v => v != null && !isNaN(v));
  const validMins  = mins.filter(v => v != null && !isNaN(v));
  const { yMin, yMax } = _computeYRange(validAvgs, validMaxes, validMins, _hszYPreset, roll7, roll30);

  // In Focus mode, hide the ribbon entirely (we want pure trend view)
  const showRibbon = _hszYPreset !== 'focus';

  // Min/max avg markers
  const annotations = {};
  if (validAvgs.length) {
    const minVal = Math.min(...validAvgs);
    const maxVal = Math.max(...validAvgs);
    annotations.minPt = {
      type: 'point', xValue: avgs.indexOf(minVal), yValue: minVal,
      backgroundColor: _HIST_DN, radius: 4,
      label: { enabled: true, content: minVal.toFixed(0)+'€', color:'#fff', font:{size:9}, backgroundColor:_HIST_DN, position:'bottom', padding:2 }
    };
    annotations.maxPt = {
      type: 'point', xValue: avgs.indexOf(maxVal), yValue: maxVal,
      backgroundColor: _HIST_UP, radius: 4,
      label: { enabled: true, content: maxVal.toFixed(0)+'€', color:'#fff', font:{size:9}, backgroundColor:_HIST_UP, position:'top', padding:2 }
    };
  }

  // Inject preset buttons in the header
  setTimeout(_hszInjectYPresets, 0);

  mkHistChart('hsz-canvas', {
    type: 'line',
    data: {
      labels,
      datasets: [
        // Ribbon: max-min daily envelope (ultra discreet, hidden in Focus mode)
        {
          label: 'Daily max',
          data: maxes,
          borderColor: maxBorder,
          backgroundColor: ribbonFill,
          borderWidth: 0.7,
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
          borderWidth: 0.7,
          pointRadius: 0,
          tension: 0,
          spanGaps: true,
          fill: false,
          order: 5,
          hidden: !showRibbon,
        },
        // Main 3 lines
        { label: 'Daily avg', data: avgs,   borderColor: 'rgba(255,255,255,0.25)', borderWidth: 1,   pointRadius: 0, tension: 0, spanGaps: true, fill: false, order: 3 },
        { label: '7D avg',    data: roll7,  borderColor: color,                    borderWidth: 2,   pointRadius: 0, tension: 0, spanGaps: true, fill: false, order: 2 },
        { label: '30D avg',   data: roll30, borderColor: _HIST_WARN,               borderWidth: 2,   pointRadius: 0, tension: 0, spanGaps: true, fill: false, borderDash: [5,3], order: 1 },
      ],
    },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        legend: {
          display: true, position: 'top', align: 'end',
          // Allow toggling visibility by clicking legend items (including Daily max/min)
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 2, padding: 8,
          },
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const index = legendItem.datasetIndex;
            // Special handling: clicking on "Daily max" or "Daily min" toggles BOTH
            const lbl = ci.data.datasets[index].label;
            if (lbl === 'Daily max' || lbl === 'Daily min') {
              // Find both indices
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
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` }
        },
        annotation: { annotations },
        subtitle: yMin != null && yMax != null ? { display: true, text: `${_hszYPreset === 'focus' ? 'Focus: rolling trend ('+yMin+'→'+yMax+' €/MWh, ribbon hidden)' : (_hszYPreset === 'all' ? 'All: full daily range ('+yMin+'→'+yMax+' €/MWh)' : 'Standard: avg ± margin ('+yMin+'→'+yMax+' €/MWh)')} · Drag to zoom area · Double-click to reset`, color: _HIST_TX3, font: { size: 9 }, padding: { bottom: 8 } } : undefined,
        // Click-and-drag zoom (rectangle selection), no wheel zoom (less intrusive)
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.15)',
              borderColor: 'rgba(20,211,169,0.6)',
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
          const ch = HIST.charts['hsz-canvas'];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 12 } },
        y: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } }, min: yMin, max: yMax, title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } } },
      },
    }
  });
}

// ── HSZ · YoY: same calendar window vs N-1/N-2 with historical envelope.
// Auto-switches to "calendar overlay" mode for windows >= 2Y.
function _hszRenderYoY(filtered, zone, summary) {
  const color = zoneColor(zone);
  const all = summary.zones[zone] || [];
  if (!filtered.length || !all.length) return _hszPlaceholder('Not enough data for YoY');

  // Determine if we're in "long window" mode (2Y, 5Y, All) → calendar overlay
  const w = HIST.windows['hsz'] || '3M';
  const longWindow = ['2Y', '5Y', 'All'].includes(w);

  if (longWindow) {
    // ── CALENDAR OVERLAY: one line per year, X axis = Jan..Dec ──
    return _hszRenderYoYCalendar(filtered, zone, summary, all);
  }

  // ── SUPERPOSITION MODE: current vs N-1 vs N-2 aligned by day-of-period ──
  const curFrom = filtered[0].d;
  const curTo   = filtered[filtered.length - 1].d;

  // Slice N-1 and N-2 windows by shifting the date range
  const sliceWindow = (fromStr, toStr) => all.filter(e => e.d >= fromStr && e.d <= toStr);
  const ny1 = sliceWindow(_shiftYearsISO(curFrom, 1), _shiftYearsISO(curTo, 1));
  const ny2 = sliceWindow(_shiftYearsISO(curFrom, 2), _shiftYearsISO(curTo, 2));

  // Use day-of-period index as label for alignment
  const labels = filtered.map((_, i) => `D${i+1}`);

  // Map curr/prev by day index (align position 0 of cur with position 0 of ny1/ny2)
  const cur  = filtered.map(d => d.avg);
  const prev1 = labels.map((_, i) => ny1[i]?.avg ?? null);
  const prev2 = labels.map((_, i) => ny2[i]?.avg ?? null);

  // Build historical envelope: collect all entries from years OTHER than current/N-1/N-2
  // to give a "min-max over all past years" backdrop.
  const curYear = curFrom.slice(0, 4);
  const histYears = all.filter(e => {
    const y = e.d.slice(0, 4);
    // Use all years strictly older than the current period start
    return e.d < curFrom;
  });
  const env = _historicalEnvelope(filtered, histYears);

  // Compute aggregate deltas for subtitle
  const curMean = _meanIgnoreNull(cur);
  const p1Mean  = _meanIgnoreNull(prev1);
  const p2Mean  = _meanIgnoreNull(prev2);

  const ribbonFill = _toRgba(color, 0.08);

  mkHistChart('hsz-canvas', {
    type: 'line',
    data: {
      labels,
      datasets: [
        // Historical envelope (max line + fill down to min line)
        {
          label: 'Hist max', data: env.maxLine,
          borderColor: 'rgba(255,255,255,0.18)', backgroundColor: ribbonFill,
          borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true, fill: '+1', order: 6,
        },
        {
          label: 'Hist min', data: env.minLine,
          borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'transparent',
          borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true, fill: false, order: 6,
        },
        // Historical median (thin reference line)
        {
          label: 'Hist median', data: env.medianLine,
          borderColor: 'rgba(255,255,255,0.35)', borderWidth: 1, pointRadius: 0,
          tension: 0, spanGaps: true, fill: false, borderDash: [2,3], order: 5,
        },
        // N-2 (more visible than before: brighter, thicker, distinct dash)
        {
          label: zone + ' · N-2', data: prev2,
          borderColor: 'rgba(168,125,196,0.65)', borderWidth: 1.5, pointRadius: 0,
          tension: 0, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
        },
        // N-1
        {
          label: zone + ' · N-1', data: prev1,
          borderColor: 'rgba(255,255,255,0.6)', borderWidth: 1.5, pointRadius: 0,
          tension: 0, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
        },
        // Current (bold)
        {
          label: zone + ' · current', data: cur,
          borderColor: color, borderWidth: 2.5, pointRadius: 0,
          tension: 0, spanGaps: true, fill: false, order: 1,
        },
      ],
    },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 2, padding: 8,
            // Hide envelope datasets from legend (decorative)
            filter: (item) => !['Hist max', 'Hist min', 'Hist median'].includes(item.text),
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
            title: ctx => 'Day ' + (ctx[0]?.dataIndex + 1) + ' of period',
          },
        },
        subtitle: {
          display: true,
          text: curMean != null && p1Mean != null
            ? `Period avg: ${curMean.toFixed(1)} €/MWh · N-1: ${p1Mean.toFixed(1)} (Δ ${((curMean - p1Mean)).toFixed(1)})${p2Mean != null ? ' · N-2: ' + p2Mean.toFixed(1) : ''}`
            : 'Period vs previous year(s) + historical envelope (grey)',
          color: _HIST_TX3, font: { size: 11 }, padding: { bottom: 8 },
        },
      },
    },
  });
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

  mkHistChart('hsz-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 2, padding: 8 } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` } },
        subtitle: { display: true, text: `Calendar overlay · ${years.length} years aligned by month`, color: _HIST_TX3, font: { size: 10 }, padding: { bottom: 8 } },
      },
    },
  });
}

// ── HSZ · Seasonal: avg per calendar month across years ──
// ── HSZ · Seasonal: monthly P10-P90 envelope + median + 2 prior years + current ──
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
  const priorYears = years.slice(0, -1);  // all years except current
  // For "2 prior years individuals", keep the 2 most recent past years
  const recent2 = priorYears.slice(-2);
  // For "historical envelope", use all years OLDER than the 2 recent ones (deep history)
  // If we only have <= 3 years total, fall back to using all past years for envelope.
  const envYears = priorYears.length > 2 ? priorYears.slice(0, -2) : priorYears;

  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build envelope (P5, P95, median) per month across envYears to avoid
  // extreme outlier years (e.g. 2022 gas crisis) crushing the Y axis.
  const envMin = Array(12).fill(null);
  const envMax = Array(12).fill(null);
  const envMedian = Array(12).fill(null);
  for (let m = 0; m < 12; m++) {
    const vals = envYears.map(y => byYear[y][m]).filter(v => v != null);
    if (vals.length) {
      const sorted = [...vals].sort((a, b) => a - b);
      if (sorted.length < 4) {
        // Too few years — use absolute min/max
        envMin[m] = sorted[0];
        envMax[m] = sorted[sorted.length - 1];
      } else {
        envMin[m] = _percentile(sorted, 0.05);
        envMax[m] = _percentile(sorted, 0.95);
      }
      envMedian[m] = _percentile(sorted, 0.5);
    }
  }

  // 2 recent past years
  const recent2Colors = ['rgba(63,166,180,0.55)', 'rgba(186,117,23,0.55)'];

  const ribbonFill = 'rgba(255,255,255,0.05)';

  const datasets = [
    // Envelope max + fill down to min
    {
      label: 'Hist max', data: envMax,
      borderColor: 'rgba(255,255,255,0.12)', backgroundColor: ribbonFill,
      borderWidth: 0.5, pointRadius: 0, tension: 0, spanGaps: true, fill: '+1', order: 6,
    },
    {
      label: 'Hist min', data: envMin,
      borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'transparent',
      borderWidth: 0.5, pointRadius: 0, tension: 0, spanGaps: true, fill: false, order: 6,
    },
    // Median historical
    {
      label: 'Hist median', data: envMedian,
      borderColor: 'rgba(255,255,255,0.4)', borderWidth: 1.2,
      pointRadius: 0, tension: 0.2, spanGaps: true, fill: false, borderDash: [3, 2], order: 5,
    },
  ];

  // 2 recent past years (individual lines)
  recent2.forEach((y, idx) => {
    datasets.push({
      label: y,
      data: byYear[y],
      borderColor: recent2Colors[idx],
      borderWidth: 1.5,
      pointRadius: 3,
      pointBackgroundColor: recent2Colors[idx],
      tension: 0.25, spanGaps: true, fill: false, order: 3,
    });
  });

  // Current year (bold)
  datasets.push({
    label: currentYear + ' (current)',
    data: byYear[currentYear],
    borderColor: color,
    borderWidth: 3,
    pointRadius: 4,
    pointBackgroundColor: color,
    tension: 0.25, spanGaps: true, fill: false, order: 1,
  });

  mkHistChart('hsz-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 2, padding: 8,
            filter: (item) => !['Hist max', 'Hist min'].includes(item.text),
          },
        },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` } },
        subtitle: {
          display: true,
          text: envYears.length > 0
            ? `Grey ribbon = historical range (${envYears.length} years before ${recent2[0] || currentYear}) · median dashed`
            : 'Seasonal pattern',
          color: _HIST_TX3, font: { size: 10 }, padding: { bottom: 8 },
        },
      },
    },
  });
}

// ── HSZ · Hourly: intraday profile, toggleable Quarter / YoY ──
// Quarter mode: 4 mini-charts (Q1..Q4) each with 24h profile + N-1 + N-2 ghosts.
// YoY mode: 1 chart with 24h profile of the whole period vs N-1 / N-2.
// Data source: summary.intraday[zone][year] = {Q1: [24h], Q2: [...], ..., all: [...]}
async function _hszRenderHourly(filtered, zone) {
  if (!filtered.length) return _hszPlaceholder('No data');

  const summary = await fetchSummary();
  const intraday = summary?.intraday?.[zone];
  if (!intraday) {
    return _hszPlaceholder('No intraday profile data — run enrich_summary.py to populate it');
  }

  const mode = HSZ.hourlyMode || 'quarter';

  // Render the mode toggle UI in the chart area header (above the canvas/grid)
  _hszInjectHourlyToggle(mode);

  if (mode === 'quarter') {
    _hszRenderHourlyQuarter(zone, intraday);
  } else {
    _hszRenderHourlyYoY(zone, intraday);
  }
}

// Inject a small Quarter / YoY toggle above the chart area
function _hszInjectHourlyToggle(mode) {
  const canvas = document.getElementById('hsz-canvas');
  if (!canvas) return;
  const wrap = canvas.parentNode;
  // Remove old toggle if any
  const oldT = document.getElementById('hsz-hourly-toggle');
  if (oldT) oldT.remove();
  const toggle = document.createElement('div');
  toggle.id = 'hsz-hourly-toggle';
  toggle.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;margin-bottom:8px;font-size:10px;font-family:\'JetBrains Mono\',monospace';
  toggle.innerHTML = `
    <button onclick="setHistHourlyMode('quarter')" style="background:${mode==='quarter'?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${mode==='quarter'?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${mode==='quarter'?'#14D3A9':'var(--tx3)'};padding:3px 10px;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;font-family:inherit;letter-spacing:0.04em;text-transform:uppercase">BY QUARTER</button>
    <button onclick="setHistHourlyMode('yoy')" style="background:${mode==='yoy'?'rgba(20,211,169,0.15)':'transparent'};border:1px solid ${mode==='yoy'?'rgba(20,211,169,0.4)':'rgba(255,255,255,0.15)'};color:${mode==='yoy'?'#14D3A9':'var(--tx3)'};padding:3px 10px;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;font-family:inherit;letter-spacing:0.04em;text-transform:uppercase">YoY GLOBAL</button>
  `;
  wrap.insertBefore(toggle, canvas);
}

// Determine "current year" and "N-1/N-2" years from the intraday data
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

  // Destroy any existing single chart
  if (HIST.charts['hsz-canvas']) {
    HIST.charts['hsz-canvas'].destroy();
    delete HIST.charts['hsz-canvas'];
  }
  // Hide single canvas, render a 2×2 grid in its place
  const canvas = document.getElementById('hsz-canvas');
  if (!canvas) return;
  canvas.style.display = 'none';
  const wrap = canvas.parentNode;

  // Clean previous grid if any
  const oldGrid = document.getElementById('hsz-quarter-grid');
  if (oldGrid) oldGrid.remove();

  const grid = document.createElement('div');
  grid.id = 'hsz-quarter-grid';
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;height:100%;min-height:340px';

  const Qmeta = [
    { id: 'Q1', label: 'Q1 Winter (Jan-Mar)', color: '#A87DC4' },
    { id: 'Q2', label: 'Q2 Spring (Apr-Jun)', color: '#14D3A9' },
    { id: 'Q3', label: 'Q3 Summer (Jul-Sep)', color: '#FBBF24' },
    { id: 'Q4', label: 'Q4 Autumn (Oct-Dec)', color: '#ED6965' },
  ];

  Qmeta.forEach(q => {
    const cell = document.createElement('div');
    cell.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid var(--bd);border-radius:6px;padding:10px;display:flex;flex-direction:column;min-height:0';
    cell.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <span style="font-size:11px;font-weight:700;color:${q.color};font-family:'JetBrains Mono',monospace">${q.label}</span>
        <span id="hsz-q-meta-${q.id}" style="font-size:9px;color:var(--tx3);font-family:'JetBrains Mono',monospace"></span>
      </div>
      <div style="flex:1;position:relative;min-height:140px">
        <canvas id="hsz-q-canvas-${q.id}"></canvas>
      </div>
    `;
    grid.appendChild(cell);
  });

  wrap.appendChild(grid);

  // Build a chart per quarter
  const hours = Array.from({length: 24}, (_, i) => `${String(i).padStart(2,'0')}h`);
  Qmeta.forEach(q => {
    const curProfile = intraday[cur]?.[q.id];
    const n1Profile  = n1 ? intraday[n1]?.[q.id] : null;
    const n2Profile  = n2 ? intraday[n2]?.[q.id] : null;

    if (!curProfile || curProfile.every(v => v == null)) {
      const cellMeta = document.getElementById(`hsz-q-meta-${q.id}`);
      if (cellMeta) cellMeta.textContent = 'no data';
      return;
    }
    const curMean = _meanIgnoreNull(curProfile);
    const cellMeta = document.getElementById(`hsz-q-meta-${q.id}`);
    if (cellMeta) cellMeta.textContent = `avg ${curMean != null ? curMean.toFixed(1) : '--'} €/MWh`;

    const datasets = [];
    if (n2Profile) {
      datasets.push({
        label: n2 + ' (N-2)', data: n2Profile,
        borderColor: 'rgba(255,255,255,0.25)', borderWidth: 1.2,
        pointRadius: 0, tension: 0.25, spanGaps: true, fill: false, borderDash: [6,4], order: 4,
      });
    }
    if (n1Profile) {
      datasets.push({
        label: n1 + ' (N-1)', data: n1Profile,
        borderColor: 'rgba(255,255,255,0.5)', borderWidth: 1.3,
        pointRadius: 0, tension: 0.25, spanGaps: true, fill: false, borderDash: [3,3], order: 3,
      });
    }
    datasets.push({
      label: cur + ' (current)', data: curProfile,
      borderColor: q.color, borderWidth: 2.5,
      pointRadius: 0, tension: 0.3, spanGaps: true, fill: false, order: 1,
    });

    mkHistChart(`hsz-q-canvas-${q.id}`, {
      type: 'line',
      data: { labels: hours, datasets },
      options: {
        ...baseOptions(''),
        plugins: {
          legend: { display: false },
          tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €' : 'n/a'}` } },
        },
        scales: {
          x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 9 }, maxTicksLimit: 8 } },
          y: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 9 } } },
        },
      },
    });
  });
}

// YoY mode: single chart with 24h profile of period vs N-1 / N-2
function _hszRenderHourlyYoY(zone, intraday) {
  const color = zoneColor(zone);
  const { cur, n1, n2 } = _hszPickIntradayYears(intraday);
  if (!cur) return _hszPlaceholder('No intraday data');

  // Remove the quarter grid if present, show the main canvas
  const oldGrid = document.getElementById('hsz-quarter-grid');
  if (oldGrid) oldGrid.remove();
  const canvas = document.getElementById('hsz-canvas');
  if (canvas) canvas.style.display = '';

  const curProfile = intraday[cur]?.all;
  const n1Profile  = n1 ? intraday[n1]?.all : null;
  const n2Profile  = n2 ? intraday[n2]?.all : null;

  if (!curProfile) return _hszPlaceholder('No "all" intraday profile in summary');

  const hours = Array.from({length: 24}, (_, i) => `${String(i).padStart(2,'0')}h`);
  const datasets = [];

  if (n2Profile) {
    datasets.push({
      label: n2 + ' (N-2)', data: n2Profile,
      borderColor: 'rgba(255,255,255,0.3)', borderWidth: 1.5,
      pointRadius: 0, tension: 0.25, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
    });
  }
  if (n1Profile) {
    datasets.push({
      label: n1 + ' (N-1)', data: n1Profile,
      borderColor: 'rgba(255,255,255,0.55)', borderWidth: 1.5,
      pointRadius: 0, tension: 0.25, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
    });
  }
  datasets.push({
    label: cur + ' (current)', data: curProfile,
    borderColor: color, borderWidth: 2.8,
    pointRadius: 0, tension: 0.3, spanGaps: true, fill: false, order: 1,
  });

  // Compute summary stats for the subtitle
  const curMean = _meanIgnoreNull(curProfile);
  const n1Mean  = n1Profile ? _meanIgnoreNull(n1Profile) : null;

  mkHistChart('hsz-canvas', {
    type: 'line',
    data: { labels: hours, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 2, padding: 8 } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` } },
        subtitle: {
          display: true,
          text: curMean != null && n1Mean != null
            ? `Avg 24h profile · ${cur}: ${curMean.toFixed(1)} €/MWh · N-1: ${n1Mean.toFixed(1)} (Δ ${(curMean - n1Mean).toFixed(1)})`
            : `Avg 24h profile across the period`,
          color: _HIST_TX3, font: { size: 10 }, padding: { bottom: 8 },
        },
      },
    },
  });
}

// ── HSZ · Weekly: avg per day-of-week (Mon..Sun) ──
// ── HSZ · Weekly: box plot per day-of-week (P10/P25/P50/P75/P90) ──
// Chart.js core doesn't natively support box plots — we render it as a stack of:
//  - floating bar dataset for the IQR (P25 to P75)
//  - line overlays for whiskers (P10/P90) and outliers (min/max)
//  - thick median line via a bar dataset
function _hszRenderWeekly(filtered, zone) {
  const color = zoneColor(zone);
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

  // Compute Y range: cap at 1.15× P90 max but only if outliers exceed it significantly
  const validStats = stats.filter(s => s);
  const p90Max = Math.max(...validStats.map(s => s.p90));
  const p10Min = Math.min(...validStats.map(s => s.p10));
  const dataMax = Math.max(...validStats.map(s => s.max));
  const dataMin = Math.min(...validStats.map(s => s.min));
  // If dataMax > 1.5× p90Max, cap at p90Max × 1.4 (outliers visible just above box)
  // Otherwise use real data extent
  const yTop = (dataMax > p90Max * 1.5) ? Math.ceil(p90Max * 1.4 / 10) * 10 : Math.ceil(dataMax * 1.05 / 10) * 10;
  const yBot = (dataMin < p10Min * 0.5 || dataMin < 0) ? Math.floor(Math.min(dataMin * 1.05, p10Min - Math.abs(p10Min) * 0.2) / 10) * 10 : Math.floor(Math.max(0, dataMin - Math.abs(dataMin) * 0.05) / 10) * 10;

  const colorIqrFill = _toRgba(color, 0.25);
  const colorWhisker = _toRgba(color, 0.7);

  // Custom plugin: draw the whole box plot in afterDatasetsDraw
  // Uses the chart's scales to convert (categoryIdx, value) → pixels
  const boxPlotPlugin = {
    id: 'boxPlot',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      const yScale = scales.y;
      const boxHalfWidth = (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) * 0.22;
      stats.forEach((s, i) => {
        if (!s) return;
        const xPx = xScale.getPixelForValue(i);
        const yP25 = yScale.getPixelForValue(s.p25);
        const yP75 = yScale.getPixelForValue(s.p75);
        const yP10 = yScale.getPixelForValue(s.p10);
        const yP90 = yScale.getPixelForValue(s.p90);
        const yP50 = yScale.getPixelForValue(s.p50);

        // IQR box (P25-P75)
        ctx.fillStyle = colorIqrFill;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(xPx - boxHalfWidth, yP75, boxHalfWidth * 2, yP25 - yP75);
        ctx.fill();
        ctx.stroke();

        // Median line (thick horizontal line at P50)
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(xPx - boxHalfWidth, yP50);
        ctx.lineTo(xPx + boxHalfWidth, yP50);
        ctx.stroke();

        // Whiskers (vertical lines + caps)
        ctx.strokeStyle = colorWhisker;
        ctx.lineWidth = 1.2;
        // Lower whisker
        ctx.beginPath();
        ctx.moveTo(xPx, yP25);
        ctx.lineTo(xPx, yP10);
        ctx.stroke();
        // Upper whisker
        ctx.beginPath();
        ctx.moveTo(xPx, yP75);
        ctx.lineTo(xPx, yP90);
        ctx.stroke();
        // Whisker caps (small horizontal lines at P10 / P90)
        const capWidth = boxHalfWidth * 0.45;
        ctx.beginPath();
        ctx.moveTo(xPx - capWidth, yP10);
        ctx.lineTo(xPx + capWidth, yP10);
        ctx.moveTo(xPx - capWidth, yP90);
        ctx.lineTo(xPx + capWidth, yP90);
        ctx.stroke();

        // Min / Max as small dots (if within Y range, else they're clipped by Chart.js naturally)
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
      });
    },
  };

  mkHistChart('hsz-canvas', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        // Invisible bar to drive the X categorical axis and tooltip
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
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            label: (ctx) => {
              const s = stats[ctx.dataIndex];
              if (!s) return '';
              return [
                ` Min:    ${s.min.toFixed(1)} €/MWh`,
                ` P10:    ${s.p10.toFixed(1)} €/MWh`,
                ` P25:    ${s.p25.toFixed(1)} €/MWh`,
                ` Median: ${s.p50.toFixed(1)} €/MWh`,
                ` P75:    ${s.p75.toFixed(1)} €/MWh`,
                ` P90:    ${s.p90.toFixed(1)} €/MWh`,
                ` Max:    ${s.max.toFixed(1)} €/MWh`,
                ` n = ${s.n}`,
              ];
            },
          },
        },
        subtitle: { display: true, text: 'Box: P25-P75 · Whiskers: P10-P90 · Dots: min/max (when within range) · Scroll to zoom Y · drag to pan', color: _HIST_TX3, font: { size: 10 }, padding: { bottom: 8 } },
        zoom: _zoomConfig({ mode: 'y' }),
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } } },
        y: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } }, min: yBot, max: yTop, title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } } },
      },
    },
    plugins: [boxPlotPlugin],
  });
}

// ── HSZ · Volatility: rolling σ on 7D / 30D windows ──
function _hszRenderVolatility(filtered, zone) {
  const color = zoneColor(zone);
  if (!filtered.length) return _hszPlaceholder('No data');

  const labels = filtered.map(d => d.d);
  const avgs   = filtered.map(d => d.avg);

  // Rolling sigma on a window
  const rollingSigma = (arr, n) => arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i-n+1), i+1).filter(v => v != null);
    if (slice.length < 3) return null;
    const m = slice.reduce((a,b)=>a+b,0) / slice.length;
    const v = slice.reduce((a,b)=>a+Math.pow(b-m,2),0) / slice.length;
    return Math.sqrt(v);
  });

  const sig7  = rollingSigma(avgs, 7);
  const sig30 = rollingSigma(avgs, 30);

  // Annotate the global σ for reference
  const valid = avgs.filter(v => v != null);
  const periodMean = valid.length ? valid.reduce((a,b)=>a+b,0) / valid.length : 0;
  const periodSigma = valid.length ? Math.sqrt(valid.reduce((a,b)=>a+Math.pow(b-periodMean,2),0) / valid.length) : 0;

  // Compute dynamic Y range based on actual σ values (not the static 0-200 box)
  const allSig = [...sig7, ...sig30].filter(v => v != null && !isNaN(v));
  const sigMax = allSig.length ? Math.max(...allSig) : 30;
  // Round up to a sensible value, leave 10% headroom, but cap at a value that
  // makes the 3 regime zones look reasonable
  const yMaxData = Math.ceil(Math.max(sigMax * 1.1, 35) / 5) * 5;

  mkHistChart('hsz-canvas', {
    type: 'line',
    data: {
      labels,
      datasets: [
        // σ 7D — no fill, clean line
        { label: 'σ 7D rolling',  data: sig7,  borderColor: _HIST_WARN, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.2, spanGaps: true, fill: false },
        // σ 30D — thicker, zone color
        { label: 'σ 30D rolling', data: sig30, borderColor: color,      backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.3, spanGaps: true, fill: false },
      ],
    },
    options: {
      ...baseOptions('σ (€/MWh)'),
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 2, padding: 8 } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` } },
        subtitle: { display: true, text: `Period σ: ${periodSigma.toFixed(2)} €/MWh — Stable < 15 < Moderate < 30 < Volatile`, color: _HIST_TX3, font: { size: 10 }, padding: { bottom: 8 } },
        annotation: {
          annotations: {
            // Regime zones in the background — cap at actual data max
            zoneStable:   { type: 'box', yMin: 0,  yMax: Math.min(15, yMaxData), backgroundColor: 'rgba(20,211,169,0.06)', borderWidth: 0 },
            zoneModerate: { type: 'box', yMin: 15, yMax: Math.min(30, yMaxData), backgroundColor: 'rgba(251,191,36,0.06)', borderWidth: 0 },
            zoneVolatile: { type: 'box', yMin: 30, yMax: yMaxData,               backgroundColor: 'rgba(237,105,101,0.06)', borderWidth: 0 },
            // Reference lines at σ=15 and σ=30 (only if within range)
            ref15: yMaxData >= 15 ? { type: 'line', yMin: 15, yMax: 15, borderColor: 'rgba(20,211,169,0.4)', borderWidth: 1, borderDash: [3,3],
              label: { enabled: true, content: 'σ=15 · stable', color: '#14D3A9', font: { size: 9 }, position: 'end', backgroundColor: 'transparent', padding: 2 } } : undefined,
            ref30: yMaxData >= 30 ? { type: 'line', yMin: 30, yMax: 30, borderColor: 'rgba(237,105,101,0.4)', borderWidth: 1, borderDash: [3,3],
              label: { enabled: true, content: 'σ=30 · volatile', color: '#ED6965', font: { size: 9 }, position: 'end', backgroundColor: 'transparent', padding: 2 } } : undefined,
          },
        },
        zoom: _zoomConfig({ mode: 'y' }),
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 12 } },
        y: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } }, min: 0, max: yMaxData, title: { display: true, text: 'σ (€/MWh)', color: _HIST_TX3, font: { size: 10 } } },
      },
    },
  });
}

// Helper: mean ignoring null / NaN
function _meanIgnoreNull(arr) {
  const v = arr.filter(x => x != null && !isNaN(x));
  return v.length ? v.reduce((a,b)=>a+b,0) / v.length : null;
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
  const minLine = buckets.map(b => {
    if (!b.length) return null;
    if (b.length < 4) return Math.min(...b);
    const s = [...b].sort((a, b) => a - b);
    return _percentile(s, 0.05);  // P5 instead of absolute min
  });
  const maxLine = buckets.map(b => {
    if (!b.length) return null;
    if (b.length < 4) return Math.max(...b);
    const s = [...b].sort((a, b) => a - b);
    return _percentile(s, 0.95);  // P95 instead of absolute max
  });
  const medianLine = buckets.map(b => {
    if (!b.length) return null;
    const s = [...b].sort((a, b) => a - b);
    return _percentile(s, 0.5);
  });
  return { minLine, maxLine, medianLine };
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
    { id: 'profile', label: 'Profile' },
    { id: 'bands',   label: 'Bands' },
    { id: 'spread',  label: 'Spread' },
  ],
};

function setHistMultiTab(tabId) {
  HMZ.tab = tabId;
  buildHistMultiTabs();
  renderHistMulti();
}
window.setHistMultiTab = setHistMultiTab;

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
  renderHistMulti();
}
window.setHmzBaseline = setHmzBaseline;

async function renderHistMulti() {
  buildHistMultiTabs();
  const w = HIST.windows['hmz'] || '3M';
  const s = await fetchSummary();
  if (!s?.zones) return;

  updateZoneLabels();

  const selected = getUserZones().filter(z => s.zones[z]);
  if (!selected.length) {
    _hmzPlaceholder('No zone selected');
    return;
  }

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
  // Sync the dropdown value (in case it was set programmatically)
  const baselineSelect = document.getElementById('hmz-baseline-select');
  if (baselineSelect && baselineSelect.value !== baseline) baselineSelect.value = baseline;
  document.getElementById('hmz-kpi-zones-v').innerHTML = selected.length + '<span class="kpi-unit">zones</span>';
  document.getElementById('hmz-kpi-zones-meta').textContent = baseline + ' as baseline';
  if (baseStats) {
    document.getElementById('hmz-kpi-avg-v').innerHTML = baseStats.avg.toFixed(2) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-avg-meta').textContent = baseline + ' · ' + baseStats.days + 'd';
  }
  // Update the "Baseline avg" KPI card label dynamically
  const baseLabelEl = document.querySelector('#hmz-kpi-avg .kpi-label');
  if (baseLabelEl) baseLabelEl.textContent = baseline + ' avg';
  // Cheapest / Most expensive
  const validStats = selected.filter(z => stats[z]).map(z => ({ z, avg: stats[z].avg }));
  if (validStats.length) {
    validStats.sort((a, b) => a.avg - b.avg);
    const cheap = validStats[0], pricey = validStats[validStats.length-1];
    document.getElementById('hmz-kpi-cheapest-v').innerHTML = cheap.avg.toFixed(1) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-cheapest-meta').textContent = cheap.z;
    document.getElementById('hmz-kpi-priciest-v').innerHTML = pricey.avg.toFixed(1) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-priciest-meta').textContent = pricey.z;
    document.getElementById('hmz-kpi-spread-v').innerHTML = (pricey.avg - cheap.avg).toFixed(1) + '<span class="kpi-unit">€/MWh</span>';
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

  // Dispatch by tab
  if (HMZ.tab === 'lines')   return _hmzRenderLines(perZone, selected);
  if (HMZ.tab === 'heatmap') return _hmzRenderHeatmap(perZone, selected);
  if (HMZ.tab === 'profile') return _hmzRenderProfile(perZone, selected);
  if (HMZ.tab === 'bands')   return _hmzRenderBands(perZone, selected, baseline);
  if (HMZ.tab === 'spread')  return _hmzRenderSpread(perZone, selected, baseline);
  return _hmzPlaceholder('🚧 ' + HMZ.tab + ' · data ready · chart coming next');
}
window.renderHistMulti = renderHistMulti;

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
      borderWidth: 1.4,
      pointRadius: 0,
      tension: 0,
      spanGaps: true,
      fill: false,
    };
  });

  mkHistChart('hmz-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 2, padding: 8 } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` } }
      }
    }
  });
}

// ── HMZ · Heatmap: zone × month, color by monthly avg price ──
function _hmzRenderHeatmap(perZone, selected) {
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = 'none';
  if (!heatmap) return;
  heatmap.style.display = 'block';

  // Baseline zone — use HIST.hmzBaseline if set, else first selected (often FR)
  let baseline = HIST.hmzBaseline || 'FR';
  if (!selected.includes(baseline)) baseline = selected[0] || 'FR';

  // Collect all months across zones
  const monthsSet = new Set();
  selected.forEach(z => perZone[z].forEach(d => monthsSet.add(d.d.slice(0,7))));
  const months = Array.from(monthsSet).sort();

  if (!months.length || !selected.length) {
    heatmap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:11px">No data</div>';
    return;
  }

  // Build matrix: monthly avg per (zone, month)
  const matrix = {};
  selected.forEach(z => {
    matrix[z] = {};
    const byMonth = {};
    perZone[z].forEach(d => {
      const m = d.d.slice(0,7);
      if (!byMonth[m]) byMonth[m] = [];
      if (d.avg != null) byMonth[m].push(d.avg);
    });
    months.forEach(m => {
      matrix[z][m] = byMonth[m] && byMonth[m].length
        ? byMonth[m].reduce((a,b)=>a+b,0) / byMonth[m].length
        : null;
    });
  });

  // Compute deltas vs baseline for every cell + find max abs delta for scaling
  let maxAbsDelta = 0;
  const deltas = {};
  selected.forEach(z => {
    deltas[z] = {};
    months.forEach(m => {
      const v = matrix[z][m];
      const baseV = matrix[baseline]?.[m];
      if (v != null && baseV != null && z !== baseline) {
        deltas[z][m] = v - baseV;
        if (Math.abs(deltas[z][m]) > maxAbsDelta) maxAbsDelta = Math.abs(deltas[z][m]);
      } else {
        deltas[z][m] = null;
      }
    });
  });
  if (maxAbsDelta < 1) maxAbsDelta = 1; // avoid div by zero

  // Color based on delta: green (cheaper), grey (~0), red (more expensive)
  const colorForDelta = (d) => {
    if (d == null) return 'rgba(255,255,255,0.05)';
    const t = Math.max(-1, Math.min(1, d / maxAbsDelta));
    if (t < 0) {
      // Green for "cheaper than baseline"
      const intensity = Math.abs(t);
      return `rgba(20,211,169,${0.15 + intensity * 0.5})`;
    } else if (t > 0) {
      // Red for "more expensive than baseline"
      return `rgba(237,105,101,${0.15 + t * 0.5})`;
    } else {
      return 'rgba(255,255,255,0.06)';
    }
  };

  const monthLabels = months.map(m => {
    const [y, mo] = m.split('-');
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[parseInt(mo)-1]} ${y.slice(2)}`;
  });

  let html = `<div style="display:inline-block;min-width:100%;padding:8px">`;
  // Subtitle
  html += `<div style="font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace;margin-bottom:8px">
    Baseline: <b style="color:var(--tx)">${baseline}</b> · Color encodes Δ vs baseline · Each cell: absolute €/MWh + Δ
  </div>`;
  html += `<table style="border-collapse:separate;border-spacing:2px;font-size:9.5px;font-family:'JetBrains Mono',monospace">`;
  html += `<thead><tr><th style="text-align:left;padding:4px 8px;color:var(--tx3);font-weight:600">Zone</th>`;
  monthLabels.forEach(ml => {
    html += `<th style="text-align:center;padding:4px;color:var(--tx3);font-weight:600;min-width:62px">${ml}</th>`;
  });
  html += `</tr></thead><tbody>`;

  // Render baseline row first (neutral grey, no delta)
  const renderRow = (z) => {
    const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
    const isBaseline = (z === baseline);
    let row = `<tr>`;
    row += `<td style="padding:4px 8px;color:var(--tx);font-weight:600;white-space:nowrap${isBaseline ? ';border-left:2px solid #FBBF24' : ''}">${flag} ${z}${isBaseline ? ' <span style="color:#FBBF24;font-size:8px">★</span>' : ''}</td>`;
    months.forEach(m => {
      const v = matrix[z][m];
      if (v == null) {
        row += `<td style="background:rgba(255,255,255,0.02);color:var(--tx3);text-align:center;padding:6px 4px;border-radius:3px;min-width:62px">--</td>`;
        return;
      }
      let bg, lines;
      if (isBaseline) {
        bg = 'rgba(255,255,255,0.06)';
        lines = `<div style="font-weight:600;color:var(--tx)">${v.toFixed(0)}</div>`;
      } else {
        const d = deltas[z][m];
        bg = colorForDelta(d);
        const dStr = d != null ? (d >= 0 ? '+' : '') + d.toFixed(0) : '';
        lines = `<div style="font-weight:600;color:#fff">${v.toFixed(0)}</div><div style="font-size:8.5px;color:rgba(255,255,255,0.7);font-weight:500">${dStr}</div>`;
      }
      const title = `${z} · ${m}: ${v.toFixed(2)} €/MWh${!isBaseline && deltas[z][m] != null ? ' · Δ vs ' + baseline + ': ' + deltas[z][m].toFixed(2) : ''}`;
      row += `<td title="${title}" style="background:${bg};text-align:center;padding:4px;border-radius:3px;min-width:62px">${lines}</td>`;
    });
    row += `</tr>`;
    return row;
  };
  html += renderRow(baseline);
  selected.filter(z => z !== baseline).forEach(z => { html += renderRow(z); });
  html += `</tbody></table>`;
  // Color scale legend
  html += `<div style="display:flex;align-items:center;gap:10px;margin-top:14px;font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace">
    <span>Cheaper than ${baseline}</span>
    <div style="flex:1;max-width:280px;height:10px;background:linear-gradient(to right, rgba(20,211,169,0.7), rgba(255,255,255,0.1), rgba(237,105,101,0.7));border-radius:2px"></div>
    <span>More expensive</span>
    <span style="margin-left:12px">± ${maxAbsDelta.toFixed(0)} €/MWh max</span>
  </div>`;
  html += `</div>`;
  heatmap.innerHTML = html;
}

// ── HMZ · Profile: heatmap zones × day-of-week (avg price) ──
function _hmzRenderProfile(perZone, selected) {
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = 'none';
  if (!heatmap) return;
  heatmap.style.display = 'block';

  const dowLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  // Build matrix: zone × dow → avg
  const matrix = {};
  let globalMin = Infinity, globalMax = -Infinity;
  selected.forEach(z => {
    matrix[z] = Array(7).fill(null);
    const byDow = Array.from({length: 7}, () => []);
    perZone[z].forEach(e => {
      if (e.avg == null) return;
      const dt = new Date(e.d);
      let dow = dt.getUTCDay();
      dow = (dow + 6) % 7;
      byDow[dow].push(e.avg);
    });
    for (let d = 0; d < 7; d++) {
      const m = _meanIgnoreNull(byDow[d]);
      matrix[z][d] = m;
      if (m != null) {
        if (m < globalMin) globalMin = m;
        if (m > globalMax) globalMax = m;
      }
    }
  });
  if (!isFinite(globalMin) || !isFinite(globalMax)) {
    heatmap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:11px">No data</div>';
    return;
  }
  if (globalMax === globalMin) globalMax = globalMin + 1;

  // 3-stop gradient: green → yellow → red
  const colorFor = (val) => {
    if (val == null) return 'rgba(255,255,255,0.05)';
    const t = Math.max(0, Math.min(1, (val - globalMin) / (globalMax - globalMin)));
    if (t < 0.5) {
      const k = t * 2;
      const r = Math.round(20 + (251-20)*k);
      const g = Math.round(211 + (191-211)*k);
      const b = Math.round(169 + (36-169)*k);
      return `rgba(${r},${g},${b},0.75)`;
    } else {
      const k = (t - 0.5) * 2;
      const r = Math.round(251 + (237-251)*k);
      const g = Math.round(191 + (105-191)*k);
      const b = Math.round(36 + (101-36)*k);
      return `rgba(${r},${g},${b},0.75)`;
    }
  };

  let html = `<div style="display:inline-block;min-width:100%;padding:8px">`;
  html += `<div style="font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace;margin-bottom:8px">
    Average price (€/MWh) per zone × day of week · Color encodes price level
  </div>`;
  html += `<table style="border-collapse:separate;border-spacing:2px;font-size:10px;font-family:'JetBrains Mono',monospace">`;
  html += `<thead><tr><th style="text-align:left;padding:4px 8px;color:var(--tx3);font-weight:600">Zone</th>`;
  dowLabels.forEach(d => {
    html += `<th style="text-align:center;padding:4px;color:var(--tx3);font-weight:600;min-width:70px">${d}</th>`;
  });
  html += `</tr></thead><tbody>`;
  selected.forEach(z => {
    const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
    html += `<tr><td style="padding:4px 8px;color:var(--tx);font-weight:600;white-space:nowrap">${flag} ${z}</td>`;
    for (let d = 0; d < 7; d++) {
      const v = matrix[z][d];
      if (v == null) {
        html += `<td style="background:rgba(255,255,255,0.02);color:var(--tx3);text-align:center;padding:8px 4px;border-radius:3px">--</td>`;
        continue;
      }
      const bg = colorFor(v);
      const title = `${z} · ${dowLabels[d]}: ${v.toFixed(2)} €/MWh`;
      html += `<td title="${title}" style="background:${bg};text-align:center;padding:8px 4px;border-radius:3px;font-weight:700;color:#fff">${v.toFixed(0)}</td>`;
    }
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  html += `<div style="display:flex;align-items:center;gap:10px;margin-top:14px;font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace">
    <span>Cheap</span>
    <div style="flex:1;max-width:280px;height:10px;background:linear-gradient(to right, rgba(20,211,169,0.75), rgba(251,191,36,0.75), rgba(237,105,101,0.75));border-radius:2px"></div>
    <span>Expensive</span>
    <span style="margin-left:12px">${globalMin.toFixed(0)} → ${globalMax.toFixed(0)} €/MWh</span>
  </div>`;
  html += `</div>`;
  heatmap.innerHTML = html;
}

// ── HMZ · Bands: full box plot per zone (P10/P25/P50/P75/P90 + min/max) ──
function _hmzRenderBands(perZone, selected, baseline) {
  // Make sure canvas is shown, heatmap is hidden
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = '';
  if (heatmap) heatmap.style.display = 'none';

  const labels = selected;
  const stats = selected.map(z => _boxStats(perZone[z].map(d => d.avg)));

  if (stats.every(s => s == null)) return;

  // Compute Y range: smart capping based on outliers vs P90
  const validStats = stats.filter(s => s);
  const p90Max = validStats.length ? Math.max(...validStats.map(s => s.p90)) : 100;
  const p10Min = validStats.length ? Math.min(...validStats.map(s => s.p10)) : 0;
  const dataMax = validStats.length ? Math.max(...validStats.map(s => s.max)) : 100;
  const dataMin = validStats.length ? Math.min(...validStats.map(s => s.min)) : 0;
  // If outlier max is way above P90, cap; else use real max
  const yTop = (dataMax > p90Max * 1.5) ? Math.ceil(p90Max * 1.4 / 10) * 10 : Math.ceil(dataMax * 1.05 / 10) * 10;
  const yBot = (dataMin < p10Min * 0.5 || dataMin < 0) ? Math.floor(Math.min(dataMin * 1.05, p10Min - Math.abs(p10Min) * 0.2) / 10) * 10 : Math.floor(Math.max(0, dataMin - Math.abs(dataMin) * 0.05) / 10) * 10;

  // Per-zone colors for boxes
  const zoneColors = selected.map(z => zoneColor(z));
  const zoneIqrFills = zoneColors.map(c => _toRgba(c, 0.25));
  const zoneWhiskers = zoneColors.map(c => _toRgba(c, 0.7));

  // Custom plugin: draw box plot using chart's scales
  const boxPlotPlugin = {
    id: 'hmzBoxPlot',
    afterDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const xScale = scales.x;
      const yScale = scales.y;
      const boxHalfWidth = (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) * 0.2;
      stats.forEach((s, i) => {
        if (!s) return;
        const xPx = xScale.getPixelForValue(i);
        const yP25 = yScale.getPixelForValue(s.p25);
        const yP75 = yScale.getPixelForValue(s.p75);
        const yP10 = yScale.getPixelForValue(s.p10);
        const yP90 = yScale.getPixelForValue(s.p90);
        const yP50 = yScale.getPixelForValue(s.p50);

        // IQR box
        ctx.fillStyle = zoneIqrFills[i];
        ctx.strokeStyle = zoneColors[i];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(xPx - boxHalfWidth, yP75, boxHalfWidth * 2, yP25 - yP75);
        ctx.fill();
        ctx.stroke();

        // Median line (thick horizontal at P50)
        ctx.strokeStyle = zoneColors[i];
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(xPx - boxHalfWidth, yP50);
        ctx.lineTo(xPx + boxHalfWidth, yP50);
        ctx.stroke();

        // Whiskers + caps
        ctx.strokeStyle = zoneWhiskers[i];
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(xPx, yP25);
        ctx.lineTo(xPx, yP10);
        ctx.moveTo(xPx, yP75);
        ctx.lineTo(xPx, yP90);
        ctx.stroke();
        const capWidth = boxHalfWidth * 0.45;
        ctx.beginPath();
        ctx.moveTo(xPx - capWidth, yP10);
        ctx.lineTo(xPx + capWidth, yP10);
        ctx.moveTo(xPx - capWidth, yP90);
        ctx.lineTo(xPx + capWidth, yP90);
        ctx.stroke();

        // Min / Max dots (only if within Y range)
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
      });
    },
  };

  mkHistChart('hmz-canvas', {
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
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            label: (ctx) => {
              const s = stats[ctx.dataIndex];
              const z = selected[ctx.dataIndex];
              if (!s) return '';
              return [
                ` ${z}`,
                ` Min:    ${s.min.toFixed(1)} €/MWh`,
                ` P10:    ${s.p10.toFixed(1)} €/MWh`,
                ` P25:    ${s.p25.toFixed(1)} €/MWh`,
                ` Median: ${s.p50.toFixed(1)} €/MWh`,
                ` P75:    ${s.p75.toFixed(1)} €/MWh`,
                ` P90:    ${s.p90.toFixed(1)} €/MWh`,
                ` Max:    ${s.max.toFixed(1)} €/MWh`,
                ` n = ${s.n}`,
              ];
            },
          },
        },
        subtitle: { display: true, text: 'Box: P25-P75 · Whiskers: P10-P90 · Dots: min/max (when within range) · Scroll to zoom Y · drag to pan', color: _HIST_TX3, font: { size: 10 }, padding: { bottom: 8 } },
        zoom: _zoomConfig({ mode: 'y' }),
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 11 } } },
        y: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } }, min: yBot, max: yTop, title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } } },
      },
    },
    plugins: [boxPlotPlugin],
  });
}

// ── HMZ · Spread: scatter 2D — P-OP avg (X) vs Intraday spread (Y) per zone ──
// Quadrant top-right = BESS hotspot (high P-OP + high intraday volatility)
function _hmzRenderSpread(perZone, selected, baseline) {
  // Make sure canvas is shown, heatmap is hidden
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = '';
  if (heatmap) heatmap.style.display = 'none';

  // Compute one (x,y) per zone
  const points = [];
  selected.forEach(z => {
    const pop = perZone[z].filter(d => d.peakAvg != null && d.offAvg != null);
    const sp = pop.length ? pop.reduce((a,d) => a + (d.peakAvg - d.offAvg), 0) / pop.length : null;
    const intra = perZone[z].filter(d => d.max != null && d.min != null);
    const sd = intra.length ? intra.reduce((a,d) => a + (d.max - d.min), 0) / intra.length : null;
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
  const xMin = Math.min(...xs) - 5;
  const xMax = Math.max(...xs) + 5;
  const yMin = Math.min(...ys) - 5;
  const yMax = Math.max(...ys) + 5;

  // Build one dataset per zone for distinct colors
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

  mkHistChart('hmz-canvas', {
    type: 'scatter',
    data: { datasets },
    options: {
      ...baseOptions('Intraday spread (€/MWh)'),
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 8, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const z = ctx.dataset.label;
              return ` ${z} · P-OP: ${ctx.parsed.x.toFixed(1)} €/MWh · Intraday: ${ctx.parsed.y.toFixed(1)} €/MWh`;
            },
          },
        },
        subtitle: { display: true, text: 'X = Peak−OffPeak spread · Y = Intraday spread (max−min) · Top-right = BESS hotspot', color: _HIST_TX3, font: { size: 10 }, padding: { bottom: 8 } },
        annotation: {
          annotations: {
            // Quadrant cutoffs (dashed lines at medians)
            xMed: { type: 'line', xMin: xMed, xMax: xMed, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderDash: [4, 4] },
            yMed: { type: 'line', yMin: yMed, yMax: yMed, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderDash: [4, 4] },
            // BESS hotspot quadrant highlight (top-right)
            hotspot: {
              type: 'box', xMin: xMed, xMax: xMax, yMin: yMed, yMax: yMax,
              backgroundColor: 'rgba(20,211,169,0.06)', borderColor: 'rgba(20,211,169,0.2)', borderWidth: 1,
              label: { display: true, content: '⚡ BESS hotspot', position: { x: 'end', y: 'start' }, color: '#14D3A9', backgroundColor: 'transparent', font: { size: 10, weight: 'bold' } },
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: xMin, max: xMax,
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

  const obs = new MutationObserver(() => {
    const panel = document.getElementById('prtab-historical');
    if (panel && panel.classList.contains('active')) {
      if (!window._histInited) {
        window._histInited = true;
        setTimeout(() => {
          renderHistOverview();
          renderHistSingle();
          renderHistMulti();
          renderHistMonthlyTable();
        }, 50);
      }
    }
  });
  const target = document.getElementById('prtab-historical');
  if (target) obs.observe(target, { attributes: true, attributeFilter: ['class'] });
});
