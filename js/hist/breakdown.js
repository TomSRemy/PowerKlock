// js/hist/breakdown.js — Historical prices: contextual breakdown module.
// Part of the former js/hist.js (lines 2301–3993), split without changes: the parts are plain scripts loaded
// in this order by index.html and share their globals as before.
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
      } else if (hourlyMode === 'hodshape') {
        label = 'Hour-of-day shape · YoY';
        renderer = () => _bdHodShape(zone, summary);
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
    <td colspan="12" style="padding:0;background:#141a22;border-bottom:2px solid var(--bd2)">
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
            <button class="pk-btn-ghost" onclick="event.stopPropagation();window._HO_CLOSED_BY_USER=window._HO_OPEN_ZONE;_closeHoRow()" title="Close detail">✕ Close</button>
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
          <div id="ho-detail-ypresets-wrap" style="display:flex;align-items:center;gap:4px;border-right:1px solid var(--bd);padding-right:10px;margin-right:6px">
            ${window.pkPill({ label: 'Focus',    active: (window._HO_YPRESET === 'focus'), onClick: `event.stopPropagation();_hoSetYPreset('focus')`,    dataAttr: 'data-ho-preset="focus"',    title: 'Tight Y axis around rolling trend (Daily avg stays visible)' })}
            ${window.pkPill({ label: 'Standard', active: (window._HO_YPRESET === 'standard' || !window._HO_YPRESET), onClick: `event.stopPropagation();_hoSetYPreset('standard')`, dataAttr: 'data-ho-preset="standard"', title: 'Default Y axis (balanced)' })}
            ${window.pkPill({ label: 'All',      active: (window._HO_YPRESET === 'all'),   onClick: `event.stopPropagation();_hoSetYPreset('all')`,      dataAttr: 'data-ho-preset="all"',      title: 'Full Y range — shows all outliers' })}
          </div>
          <button class="pk-btn-ghost" id="ho-detail-reset-btn" onclick="event.stopPropagation();window._hoResetZoom()" title="Reset zoom and Y range to standard">↺ Reset</button>
          <button class="pk-btn-primary" onclick="event.stopPropagation();_downloadHoChart('${zone}')" title="Download chart as PNG">${PK.icon('download')} PNG</button>
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
  // We resolve the label from HSZ.tabs (single source of truth for ids+labels).
  const _hsTab = HSZ.tabs.find(t => t.id === tab);
  const subTabLabel = (_hsTab && _hsTab.label) || 'Lines';
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
  // Use HSZ.tabs as the single source of truth — its ids ('vol', 'dist') are
  // what _hszRenderTab and the inline tab bar expect. Previously we used
  // 'volatility'/'distribution' here, which broke the dispatcher (no match in
  // _hszRenderTab → blank chart).
  const subTabsHtml = HSZ.tabs.map(t => `
    <button data-ho-subtab="${t.id}" style="
      padding:3px 9px;font-size:10px;cursor:pointer;border-radius:3px;
      color:${t.id === tab ? '#14D3A9' : 'var(--tx3)'};
      background:${t.id === tab ? 'rgba(20,211,169,0.18)' : 'transparent'};
      border:none;font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em">${t.label}</button>`).join('');

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
  // Uses pkPill (universal sub-toggle template).
  const yPreset = window._HO_YPRESET || 'standard';
  const yPresetsHtml = ['focus','standard','all'].map(p => window.pkPill({
    label:    p.charAt(0).toUpperCase() + p.slice(1),
    active:   yPreset === p,
    dataAttr: `data-ho-ypreset="${p}"`,
  })).join('');

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
    const n = _HO_NAMES[z] || z;
    return `<option value="${z}" ${z === zone ? 'selected' : ''}>${z} — ${n}</option>`;
  }).join('');

  // ─── Y-presets visible seulement sur Lines/YoY (cohérent avec inline) ──
  const showYPresetsInFs = (tab === 'lines' || tab === 'yoy');
  const yAxisBlock = showYPresetsInFs ? `
    <div style="display:flex;align-items:center;gap:5px">
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Y-axis</span>
      <div id="fs-ho-ypresets" style="display:inline-flex;gap:4px">${yPresetsHtml}</div>
    </div>` : '';

  // Filters order: View+SubMenu FIRST (fixed left, never shifts when graph
  // changes), then Zone, Period, Y-axis. View and its sub-menu (YoY modes,
  // Volatility metric, Distribution mode) are grouped in a single flex
  // container so they form a visual block.
  // Filters split: View+SubMenu on the LEFT (fixed, never shifts),
  // Zone / Period / Y-axis on the RIGHT.
  const filtersHtml = `
    <div class="pk-fs-filters-left">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">View</span>
          <div id="fs-ho-subtabs" style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">${subTabsHtml}</div>
        </div>
        <div id="fs-ho-tab-submenu" style="display:none;align-items:center;gap:4px;flex-wrap:wrap"></div>
      </div>
    </div>
    <div class="pk-fs-filters-right">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Zone</span>
        <select id="fs-ho-zone-select" style="background:var(--bg);border:1px solid var(--bd);color:var(--tx);font-size:11px;padding:3px 8px;border-radius:4px;font-family:inherit;cursor:pointer;color-scheme:dark">
          ${zoneOptions}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Period</span>
        <div id="fs-ho-windows" style="display:inline-flex;gap:3px;flex-wrap:wrap">${winPillsHtml}</div>
      </div>
      ${yAxisBlock}
    </div>`;

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

  // Window pills (7D / 1M / 3M / ...) — use setHistWindow so it propagates
  // to hsz/hmz too (shared period across all Historical sections).
  hostEl.querySelectorAll('[data-ho-win]').forEach(btn => {
    btn.addEventListener('click', () => {
      const w = btn.dataset.hoWin;
      if (!w) return;
      if (typeof setHistWindow === 'function') {
        setHistWindow('ho', w);
      } else {
        HIST.windows['ho'] = w;
      }
      if (typeof pkUpdateHistPeriodLabels === 'function') pkUpdateHistPeriodLabels(w);
      _openHoFullscreen(zone);
    });
  });

  // Y-presets (Focus / Standard / All)
  // We re-open the FS so the chart is re-rendered with the new preset
  // applied (consistent with how subtab/window pills behave). The previous
  // approach called _buildHoTabChart(..., true) which targets a canvas
  // ('ho-fs-chart') that doesn't exist in the unified FS DOM.
  hostEl.querySelectorAll('[data-ho-ypreset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.hoYpreset;
      if (!p) return;
      window._HO_YPRESET = p;
      // Update inline chart so the new preset is reflected when the user
      // exits the FS, then re-open the FS to pick up the new chart.
      if (typeof _buildHoTabChart === 'function') {
        _buildHoTabChart(zone, series, HSZ.tab || 'lines', false);
      }
      requestAnimationFrame(() => _openHoFullscreen(zone));
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
          tension: 0,
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
          tension: 0,
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
        // 5 datasets (Daily max/min ribbon + Daily avg + 7D rolling + 30D
        // rolling) with no legend at all — the ribbon is meant to stay
        // "ultra-discreet" per the comment above, so the filter here keeps
        // it out of the legend while still surfacing the 3 lines that
        // actually need identifying (colour alone wasn't enough: 7D is grey
        // dashed, 30D is solid teal, and that distinction isn't obvious
        // without a key, especially in a screenshot or on a quick glance).
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: 'rgba(184,201,217,.6)', font: { size: fontSize, family: "'JetBrains Mono', monospace" },
            boxWidth: 14, usePointStyle: true, pointStyle: 'line',
            filter: (item) => item.text === 'Daily avg' || item.text === '7D rolling' || item.text === '30D rolling',
          },
        },
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

