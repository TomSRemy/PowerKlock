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
      'cch':              renderCompareHist,
      'yoy':              renderHistYoY,
      'seasonal':         renderHistSeasonal,
      'hourly':           renderHistHourly,
      'weekly':           renderHistWeekly,
      'vol':              renderHistVol,
      'monthly':          renderHistMonthly,
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
    'yoy':      renderHistYoY,
    'seasonal': renderHistSeasonal,
    'hourly':   renderHistHourly,
    'weekly':   renderHistWeekly,
    'vol':      renderHistVol,
    'monthly':  renderHistMonthly,
  };
  if (renders[key]) renders[key]();
}

function getHistZone(key) {
  return (HIST.zones && HIST.zones[key]) || 'FR';
}

function setHistWindow(key, window, btn) {
  HIST.windows[key] = window;
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
    'cch':       renderCompareHist,
    'yoy':       renderHistYoY,
    'seasonal':  renderHistSeasonal,
    'hourly':    renderHistHourly,
    'weekly':    renderHistWeekly,
    'vol':       renderHistVol,
    'monthly':   renderHistMonthly,
  };
  if (renders[key]) renders[key]();
}

// ── Filter data by window ──
function filterByWindow(data, windowKey) {
  const now = new Date();
  const cutoffs = {
    '7D': 7, '1M': 30, '3M': 91, '1Y': 365,
    '2Y': 730, '5Y': 1826, 'All': 99999,
  };
  const days = cutoffs[windowKey] || 365;
  const cutoff = new Date(now - days * 86400000).toISOString().slice(0,10);
  return data.filter(d => d.d >= cutoff);
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
    { l: 'Neg h',    v: data.reduce((a,d)=>a+(d.negH||0),0).toFixed(0), u: 'h' },
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
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.parsed.y?.toFixed(1)} neg hours` } },
      },
    },
  });

  const totalNeg = negH.reduce((a,b)=>a+b,0);
  const daysNeg  = negH.filter(v=>v>0).length;
  setStats('hist-neg-stats', [
    { l: 'Total neg h',    v: totalNeg.toFixed(0), u: 'h' },
    { l: 'Days with neg',  v: daysNeg },
    { l: 'Max neg hours',  v: Math.max(...negH).toFixed(1), u: 'h' },
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
  if (el_m) el_m.innerHTML = `${monthH.toFixed(1)}<span class="kpi-unit">h</span>`;
  if (el_y) el_y.innerHTML = `${yearH.toFixed(1)}<span class="kpi-unit">h</span>`;
  if (el_w) el_w.innerHTML = `${worstH.toFixed(1)}<span class="kpi-unit">h</span>`;
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
      <div style="font-size:16px;font-weight:700;color:${col}">${h.toFixed(0)}<span style="font-size:10px;font-weight:400;color:var(--tx3)">h</span></div>
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
// HISTORICAL · 7 NEW VIEWS (Compare Zones Historical + 6 others)
// ════════════════════════════════════════════════════════════════

// State for Compare Zones · Historical
const CCH = {
  zones: ['FR'],   // currently selected zones
  baseline: 'FR',  // baseline zone for vs-FR column
};

// All zones available in summary (built lazily from data)
function cchAllZones() {
  const s = HIST.summary;
  if (!s?.zones) return [];
  return Object.keys(s.zones).sort();
}

// ── Zone filter panel control ──
function toggleCchFilterPanel() {
  const p = document.getElementById('cch-filter-panel');
  if (!p) return;
  const open = p.style.display === 'block';
  if (open) { p.style.display = 'none'; return; }
  // Position panel under the button
  const btn = document.getElementById('cch-filter-btn');
  const r = btn.getBoundingClientRect();
  p.style.top = (r.bottom + 6) + 'px';
  p.style.left = Math.max(8, r.right - 320) + 'px';
  p.style.display = 'block';
  renderCchZoneChips();
}

document.addEventListener('click', (e) => {
  const p = document.getElementById('cch-filter-panel');
  const wrap = document.getElementById('cch-filter-wrap');
  if (p && p.style.display === 'block' && wrap && !wrap.contains(e.target)) {
    p.style.display = 'none';
  }
});

function renderCchZoneChips() {
  const wrap = document.getElementById('cch-zone-chips');
  if (!wrap) return;
  const all = cchAllZones();
  if (!all.length) { wrap.innerHTML = '<div style="font-size:11px;color:var(--tx3);padding:6px">Loading zones...</div>'; return; }
  wrap.innerHTML = all.map(code => {
    const on = CCH.zones.includes(code);
    const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[code]) || '';
    const color = zoneColor(code);
    return `<label style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;${on?'background:rgba(20,211,169,0.08)':''}" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='${on?'rgba(20,211,169,0.08)':'transparent'}'">
      <input type="checkbox" ${on?'checked':''} onchange="toggleCchZone('${code}')" style="cursor:pointer;accent-color:${color}">
      <span style="font-family:'JetBrains Mono',monospace;color:var(--tx2);min-width:60px">${flag} ${code}</span>
      <span style="width:8px;height:8px;border-radius:50%;background:${color};margin-left:auto"></span>
    </label>`;
  }).join('');
}

function toggleCchZone(code) {
  const idx = CCH.zones.indexOf(code);
  if (idx >= 0) CCH.zones.splice(idx, 1);
  else CCH.zones.push(code);
  renderCchZoneChips();
  updateCchFilterLabel();
  renderCompareHist();
}

function selectAllCchZones() {
  CCH.zones = cchAllZones().slice();
  renderCchZoneChips();
  updateCchFilterLabel();
  renderCompareHist();
}

function clearCchZones() {
  CCH.zones = ['FR'];
  renderCchZoneChips();
  updateCchFilterLabel();
  renderCompareHist();
}

function cchNeighbours() {
  CCH.zones = ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'CH'].filter(z => cchAllZones().includes(z));
  renderCchZoneChips();
  updateCchFilterLabel();
  renderCompareHist();
}

function cchPresetCore() {
  CCH.zones = ['FR', 'DE_LU', 'BE', 'NL'].filter(z => cchAllZones().includes(z));
  renderCchZoneChips();
  updateCchFilterLabel();
  renderCompareHist();
}

function updateCchFilterLabel() {
  const lbl = document.getElementById('cch-filter-label');
  if (!lbl) return;
  if (CCH.zones.length === 0) lbl.textContent = 'No zone';
  else if (CCH.zones.length === 1) lbl.textContent = CCH.zones[0] + ' selected';
  else lbl.textContent = CCH.zones.length + ' zones';
}

// Expose for inline handlers
window.toggleCchFilterPanel = toggleCchFilterPanel;
window.toggleCchZone = toggleCchZone;
window.selectAllCchZones = selectAllCchZones;
window.clearCchZones = clearCchZones;
window.cchNeighbours = cchNeighbours;
window.cchPresetCore = cchPresetCore;


// ════════════════════════════════════════════
// VIEW 1 · Compare Zones · Historical (Lines)
// ════════════════════════════════════════════
async function renderCompareHist() {
  const w = HIST.windows['cch'] || '3M';
  const s = await fetchSummary();
  if (!s?.zones) return noDataMsg('cch-canvas');

  // Ensure label/chips reflect state
  updateCchFilterLabel();
  if (document.getElementById('cch-filter-panel')?.style.display === 'block') {
    renderCchZoneChips();
  }

  // Selected zones, filtered to those actually in summary
  const selected = CCH.zones.filter(z => s.zones[z]);
  if (!selected.length) return noDataMsg('cch-canvas', 'Select at least one zone');

  // Build common labels: union of all dates from selected zones (filtered by window)
  const perZoneFiltered = {};
  selected.forEach(z => { perZoneFiltered[z] = filterByWindow(s.zones[z], w); });

  // Build sorted union of dates
  const dateSet = new Set();
  selected.forEach(z => perZoneFiltered[z].forEach(d => dateSet.add(d.d)));
  const labels = Array.from(dateSet).sort();

  // Datasets · one daily-avg line per zone + rolling 7D dashed
  const datasets = [];
  selected.forEach(z => {
    const map = {};
    perZoneFiltered[z].forEach(d => { map[d.d] = d.avg; });
    const avgs = labels.map(l => map[l] ?? null);
    const color = zoneColor(z);
    datasets.push({
      label: z + ' daily',
      data: avgs,
      borderColor: color,
      borderWidth: 1.4,
      pointRadius: 0,
      tension: 0,
      spanGaps: true,
      fill: false,
    });
  });

  // Period label
  const periodEl = document.getElementById('cch-period');
  if (periodEl && labels.length) {
    periodEl.textContent = periodLabel(labels.map(l => ({ d: l })));
  }

  // Render chart
  mkHistChart('cch-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 2, padding: 8 }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`
          }
        }
      }
    }
  });

  // Build per-zone stats
  const stats = {};
  selected.forEach(z => {
    const valid = perZoneFiltered[z].map(d => d.avg).filter(v => v != null && !isNaN(v));
    if (!valid.length) { stats[z] = null; return; }
    const sum = valid.reduce((a, b) => a + b, 0);
    const avg = sum / valid.length;
    const max = Math.max(...valid);
    const min = Math.min(...valid);
    const variance = valid.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / valid.length;
    const sigma = Math.sqrt(variance);
    stats[z] = { avg, max, min, sigma, days: valid.length };
  });

  // KPI strip · use FR as baseline if present, else first selected
  const baseline = selected.includes('FR') ? 'FR' : selected[0];
  const baseStats = stats[baseline];
  if (baseStats) {
    document.getElementById('cch-kpi-avg-v').innerHTML = baseStats.avg.toFixed(1) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('cch-kpi-avg-meta').textContent = baseline + ' · ' + baseStats.days + 'd';
    document.getElementById('cch-kpi-max-v').innerHTML = baseStats.max.toFixed(1) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('cch-kpi-max-meta').textContent = baseline + ' daily peak';
    document.getElementById('cch-kpi-min-v').innerHTML = baseStats.min.toFixed(1) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('cch-kpi-min-meta').textContent = baseline + ' daily trough';
    document.getElementById('cch-kpi-vol-v').innerHTML = baseStats.sigma.toFixed(1) + '<span class="kpi-unit">€/MWh</span>';
  }
  document.getElementById('cch-kpi-zones-v').innerHTML = selected.length + '<span class="kpi-unit">zones</span>';
  document.getElementById('cch-kpi-zones-meta').textContent = (CCH.zones.length === selected.length)
    ? 'all selected available'
    : (CCH.zones.length - selected.length) + ' missing data';

  // Color KPI accents based on volatility tier (flat by default, up if high, down if very low)
  // Keep all kpi-flat for now -- no direction context applicable on long history
  ['cch-kpi-avg', 'cch-kpi-max', 'cch-kpi-min', 'cch-kpi-vol', 'cch-kpi-zones'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'kpi-card kpi-flat';
  });

  // Data table
  const tbody = document.getElementById('cch-data-tbody');
  if (tbody) {
    const frAvg = stats[baseline]?.avg;
    tbody.innerHTML = selected.map(z => {
      const st = stats[z];
      if (!st) {
        return `<tr><td style="color:var(--tx3)">${z}</td><td colspan="6" style="text-align:center;color:var(--tx3);font-size:10px">no data</td></tr>`;
      }
      const vsBase = frAvg != null ? (st.avg - frAvg) : null;
      const vsBaseStr = vsBase == null ? '--' : (vsBase >= 0 ? '+' : '') + vsBase.toFixed(1);
      const vsBaseColor = vsBase == null ? 'var(--tx3)' : (vsBase > 0 ? _HIST_UP : (vsBase < 0 ? _HIST_DN : 'var(--tx2)'));
      const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
      const color = zoneColor(z);
      return `<tr>
        <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></span>${flag} ${z}${z===baseline?' <span style="font-size:9px;color:var(--acc);font-weight:600">·BASE</span>':''}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace">${st.avg.toFixed(1)}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace">${st.max.toFixed(1)}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace">${st.min.toFixed(1)}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace">${st.sigma.toFixed(1)}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${vsBaseColor}">${vsBaseStr}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${st.days}</td>
      </tr>`;
    }).join('');
  }
}
window.renderCompareHist = renderCompareHist;


// ════════════════════════════════════════════
// VIEW 2-7 · Skeleton renderers (placeholders)
// Each loads summary data and shows a "Coming soon" placeholder for now,
// but the data hook is wired so we just have to swap the chart body later.
// ════════════════════════════════════════════

function _histPlaceholder(canvasId, msg) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const wrap = c.parentNode;
  const old = wrap.querySelector('.no-data-msg');
  if (old) old.remove();
  c.style.display = 'none';
  const div = document.createElement('div');
  div.className = 'no-data-msg';
  div.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--tx3);font-size:12px;font-style:italic;letter-spacing:0.04em;text-align:center;padding:0 20px';
  div.innerHTML = msg || 'Implementation in progress · data already loaded · chart coming next';
  wrap.appendChild(div);
}

async function renderHistYoY() {
  const s = await fetchSummary();
  const zone = getHistZone('yoy');
  const periodEl = document.getElementById('hist-yoy-period');
  if (periodEl) periodEl.textContent = zone + ' · data loaded · ' + (s?.zones?.[zone]?.length || 0) + ' days available';
  _histPlaceholder('hist-yoy-canvas', '🚧 YoY comparison chart<br><span style="font-size:10px;opacity:0.7">overlay 2024 / 2025 / 2026 on same calendar axis</span>');
}

async function renderHistSeasonal() {
  const s = await fetchSummary();
  const zone = getHistZone('seasonal');
  const periodEl = document.getElementById('hist-seasonal-period');
  if (periodEl) periodEl.textContent = zone + ' · 5Y baseline · current year overlay';
  _histPlaceholder('hist-seasonal-canvas', '🚧 Seasonal · normal vs current year<br><span style="font-size:10px;opacity:0.7">P25–P75 corridor + current year line</span>');
}

async function renderHistHourly() {
  const zone = getHistZone('hourly');
  const periodEl = document.getElementById('hist-hourly-period');
  if (periodEl) periodEl.textContent = zone + ' · 24h profile per year';
  _histPlaceholder('hist-hourly-canvas', '🚧 Hourly profile · duck curve evolution<br><span style="font-size:10px;opacity:0.7">one line per year, 24h x-axis</span>');
}

async function renderHistWeekly() {
  const zone = getHistZone('weekly');
  const periodEl = document.getElementById('hist-weekly-period');
  if (periodEl) periodEl.textContent = zone + ' · Mon → Sun distribution';
  _histPlaceholder('hist-weekly-canvas', '🚧 Weekly profile · box plot<br><span style="font-size:10px;opacity:0.7">7 box plots — weekday vs weekend</span>');
}

async function renderHistVol() {
  const zone = getHistZone('vol');
  const periodEl = document.getElementById('hist-vol-period');
  if (periodEl) periodEl.textContent = zone + ' · rolling 30D σ';
  _histPlaceholder('hist-vol-canvas', '🚧 Volatility metrics<br><span style="font-size:10px;opacity:0.7">rolling 30D σ + coefficient of variation</span>');
}

async function renderHistMonthly() {
  const zone = getHistZone('monthly');
  const periodEl = document.getElementById('hist-monthly-period');
  if (periodEl) periodEl.textContent = zone + ' · monthly aggregation';
  const tbody = document.getElementById('hist-monthly-tbody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--tx3);font-style:italic;font-size:11px">🚧 Monthly summary table · data already loaded · table render coming next</td></tr>';
  }
}

window.renderHistYoY = renderHistYoY;
window.renderHistSeasonal = renderHistSeasonal;
window.renderHistHourly = renderHistHourly;
window.renderHistWeekly = renderHistWeekly;
window.renderHistVol = renderHistVol;
window.renderHistMonthly = renderHistMonthly;


// ════════════════════════════════════════════
// AUTO-RENDER on tab activation
// ════════════════════════════════════════════
// Hook into existing tab switcher: when "historical" tab becomes active,
// the Compare Zones · Historical section is already open (default) → render it
document.addEventListener('DOMContentLoaded', () => {
  // Watch for the Historical tab being activated, then render the open section
  const obs = new MutationObserver(() => {
    const panel = document.getElementById('prtab-historical');
    if (panel && panel.classList.contains('active')) {
      // Render the default-open Compare Zones · Historical section once
      if (!window._cchInitialised) {
        window._cchInitialised = true;
        setTimeout(() => renderCompareHist(), 50);
      }
    }
  });
  const target = document.getElementById('prtab-historical');
  if (target) obs.observe(target, { attributes: true, attributeFilter: ['class'] });
});
