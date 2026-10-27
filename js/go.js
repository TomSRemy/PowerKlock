// ── GO DATA · product metadata only (label + colour). NO synthetic price fallback.
// Products actually present in data/go_prices.csv: the 2020-2025 backlog
// (Commerg's "Data Brokers" workbook) quotes Renewable/Wind/Solar/Hydro
// individually; the live weekly mail since 2026 quotes Renewable + the
// combined HWS bucket — see scripts/fetch_go_prices.py.
const GO_SERIES = {
  renewable: {l:'GO AIB Renewable', c:'#A87DC4'},
  wind:      {l:'GO AIB Wind',      c:'#3FA6B4'},
  solar:     {l:'GO AIB Solar',     c:'#FBBF24'},
  hydro:     {l:'GO AIB Hydro',     c:'#14D3A9'},
  hws:       {l:'GO AIB HWS',       c:'#ED6965'},
  ireland:   {l:'GO Ireland Wind',  c:'#f472b6'},
};
// Palette for the "one line per vintage year" chart (chart5 in the Commerg
// reference workbook — GOs Price Indications).
const GO_YEAR_COLORS = ['#5B7A99', '#3FA6B4', '#14D3A9', '#7FD858', '#FBBF24', '#F08A3C', '#ED6965', '#A87DC4', '#f472b6'];
let goHistPeriod = 9999;    // week count from the end — used when goCustomRange is null
let goCustomRange = null;   // { from:'YYYY-MM-DD', to:'YYYY-MM-DD' } — overrides goHistPeriod when set
let goHistFilter = 'all';
let goProd = 'GO AIB Renewable';

// Returns the [start, end) slice bounds to show from a chronological
// (ascending) array of Date objects — shared by every period-aware GO
// chart so goHistPeriod and goCustomRange only need to be interpreted once.
function _goPeriodSlice(dates) {
  const len = dates.length;
  if (goCustomRange) {
    const from = goCustomRange.from, to = goCustomRange.to;
    let start = len, end = 0;
    for (let i = 0; i < len; i++) {
      const iso = dates[i].toISOString().slice(0, 10);
      if (iso >= from && iso <= to) { if (i < start) start = i; if (i + 1 > end) end = i + 1; }
    }
    if (start > end) return { start: len, end: len }; // nothing in range
    return { start, end };
  }
  const take = Math.min(goHistPeriod, len);
  return { start: len - take, end: len };
}

// Preset period buttons (1M/3M/6M/YTD/1Y/2Y/5Y/All) — one filter governs
// every Commerg chart on the GO Prices page's EU tab.
function setGoPreset(code, btn) {
  goCustomRange = null;
  const ff = document.getElementById('go-date-from'); if (ff) ff.value = '';
  const ft = document.getElementById('go-date-to'); if (ft) ft.value = '';
  let weeks;
  if (code === 'YTD') {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    weeks = Math.max(1, Math.ceil((now - startOfYear) / (7 * 86400000)));
  } else {
    weeks = { '1M': 4, '3M': 13, '6M': 26, '1Y': 52, '2Y': 104, '5Y': 260, 'All': 9999 }[code] || 9999;
  }
  goHistPeriod = weeks;
  document.querySelectorAll('#go-prices-period .pk-gf-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`#go-prices-period .pk-gf-btn[data-w="${code}"]`).forEach(b => b.classList.add('active'));
  _goRedrawPeriodCharts();
}

// Custom date range — mirrors Day-Ahead Historical's From/To inputs.
function setGoCustomRange() {
  const f = document.getElementById('go-date-from'), t = document.getElementById('go-date-to');
  if (!f || !t || !f.value || !t.value || f.value > t.value) return;
  goCustomRange = { from: f.value, to: t.value };
  document.querySelectorAll('#go-prices-period .pk-gf-btn').forEach(b => b.classList.remove('active'));
  _goRedrawPeriodCharts();
}

function _goRedrawPeriodCharts() {
  drawGoIndicChart(); drawGoCal1Chart(); drawGoSpreadChart();
  if (document.getElementById('go-hist-canvas')) { drawGoHist(); drawGoWoW(); drawGoBox(); }
}

// ════════════════════════════════════════════════════════════════════
// REAL COMMERG DATA LAYER  (no fallback — page is empty until data loads)
// CSV schema: parsed_date, mail_date, week_num, source, product, year, bid, ask, delta, term
// Auto-fetched from data/go_prices.csv (committed by the GitHub Actions fetch)
// or loaded locally via the "Load CSV" button. Source: Commerg (credited in subtitle).
// ════════════════════════════════════════════════════════════════════
const GO_LABEL2KEY = {};
Object.entries(GO_SERIES).forEach(([k,s]) => { GO_LABEL2KEY[s.l.trim().toLowerCase()] = k; });
let GO_REAL = null;          // { byKey:{key:{fwd,weekly,d}}, asOf:Date }
let _goAutoTried = false;

function parseGoDate(str) {
  if (!str) return null;
  str = String(str).trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);            // ISO YYYY-MM-DD
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);          // DD/MM/YYYY
  if (m) return new Date(+m[3], +m[2]-1, +m[1]);
  const d = new Date(str);
  return isNaN(d) ? null : d;
}
function fmtGoDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { month:'short', year:'2-digit' });
}
function parseGoCSV(text) {
  const lines = String(text).replace(/\r/g,'').split('\n').filter(l => l.trim().length);
  if (!lines.length) return [];
  const head = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idx = name => head.indexOf(name);
  const iMail = idx('mail_date'), iWk = idx('week_num'), iSrc = idx('source'),
        iProd = idx('product'), iYear = idx('year'), iBid = idx('bid'),
        iAsk = idx('ask'), iDelta = idx('delta'), iTerm = idx('term');
  const num = v => { if (v==null||v==='') return null; const x = parseFloat(String(v).replace(',','.')); return isNaN(x)?null:x; };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const mailDate = parseGoDate(c[iMail]);
    if (!mailDate) continue;
    rows.push({
      mailDate, weekNum: iWk>=0?num(c[iWk]):null,
      source: iSrc>=0?(c[iSrc]||'').trim():'Commerg',
      product: iProd>=0?(c[iProd]||'').trim():'',
      year: iYear>=0?parseInt(c[iYear],10):null,
      bid: num(c[iBid]), ask: num(c[iAsk]),
      delta: iDelta>=0?num(c[iDelta]):null,
      term: iTerm>=0?(c[iTerm]||'').trim():'',
    });
  }
  return rows;
}
function buildGoReal(rows) {
  const byProd = {};
  let asOf = null;
  rows.forEach(r => {
    const key = GO_LABEL2KEY[(r.product||'').trim().toLowerCase()];
    if (!key) return;
    (byProd[key] = byProd[key] || []).push(r);
    if (!asOf || r.mailDate > asOf) asOf = r.mailDate;
  });
  const byKey = {};
  Object.entries(byProd).forEach(([key, all]) => {
    const years = [...new Set(all.map(r => r.year).filter(y => y != null))].sort();

    const fwd = {};
    years.forEach(y => {
      const cand = all.filter(r => r.year === y && r.bid != null)
                      .sort((a,b) => b.mailDate - a.mailDate)[0];
      if (cand) fwd[y] = { bid: cand.bid, ask: cand.ask };
    });

    // One weekly bid/ask/mid series PER VINTAGE YEAR — mirrors the Commerg
    // reference workbook's "GOs Price Indications" pivot (years as columns,
    // weeks as rows), rather than collapsing to a single rolling product.
    const byYear = {};
    years.forEach(y => {
      byYear[y] = all.filter(r => r.year === y && r.bid != null)
                     .sort((a,b) => a.mailDate - b.mailDate)
                     .map(r => ({
                       t: r.mailDate, bid: r.bid, ask: r.ask,
                       mid: (r.bid + (r.ask != null ? r.ask : r.bid)) / 2,
                     }));
    });

    const y1 = all.filter(r => (r.term && r.term.replace(/\s/g,'') === 'Y+1')
                            || (r.year === r.mailDate.getFullYear() + 1))
                  .filter(r => r.bid != null)
                  .sort((a,b) => a.mailDate - b.mailDate);
    const weekly = y1.map(r => ({
      t: r.mailDate, bid: r.bid, ask: r.ask,
      mid: (r.bid + (r.ask != null ? r.ask : r.bid)) / 2,
      spread: (r.ask != null ? +(r.ask - r.bid).toFixed(2) : null),
    }));
    let d = null;
    const L = weekly.length;
    if (L >= 2 && weekly[L-1].bid != null && weekly[L-2].bid != null)
      d = +(weekly[L-1].bid - weekly[L-2].bid).toFixed(2);
    byKey[key] = { fwd, byYear, years, weekly, d };
  });
  return { byKey, asOf };
}
function loadGoData(text) {
  try {
    const rows = parseGoCSV(text);
    if (!rows.length) { console.warn('[go] CSV parsed but no rows'); return false; }
    GO_REAL = buildGoReal(rows);
    renderGOKPIs(); drawGoIndicChart(); drawGoCal1Chart(); drawGoCalChart(); drawGoSpreadChart();
    renderGOFwdTable();
    if (document.getElementById('go-hist-canvas')) { drawGoHist(); drawGoWoW(); drawGoBox(); }
    // GO widgets on My Dashboard trigger this fetch lazily — redraw them once the data lands.
    if (window.PKDash) PKDash.refresh();
    console.log('[go] real Commerg data loaded · as-of', GO_REAL.asOf);
    const badge = document.getElementById('go-src-badge');
    if (badge && GO_REAL.asOf) badge.textContent = 'Commerg · automatic every Friday · latest ' + new Date(GO_REAL.asOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return true;
  } catch (e) { console.warn('[go] loadGoData failed', e); return false; }
}
function loadGoCSV(input) {
  const f = input && input.files && input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = e => loadGoData(e.target.result);
  r.readAsText(f);
}
function autoloadGo() {
  const base = (typeof DATA_BASE !== 'undefined' && DATA_BASE) ? DATA_BASE : './data/';
  fetch(base + 'go_prices.csv?t=' + Date.now())
    .then(r => r.ok ? r.text() : null)
    .then(t => { if (t) loadGoData(t); })
    .catch(() => {});
}

// Real-only history accessor (empty object when no data)
function getGOHistory() {
  const out = {};
  if (!GO_REAL) return out;
  Object.keys(GO_SERIES).forEach(k => {
    const r = GO_REAL.byKey[k];
    if (r && r.weekly.length) {
      out[k] = { ...GO_SERIES[k],
        data:      r.weekly.map(w => w.mid),
        bidArr:    r.weekly.map(w => w.bid),
        askArr:    r.weekly.map(w => w.ask),
        spreadArr: r.weekly.map(w => w.spread),
        dates:     r.weekly.map(w => w.t),
      };
    }
  });
  return out;
}

// Empty-state painter on a canvas
function goNoData(canvasId, msg) {
  const cv = document.getElementById(canvasId); if (!cv) return;
  try { const ex = (window.Chart && Chart.getChart) ? Chart.getChart(cv) : null; if (ex) ex.destroy(); } catch (e) {}
  const ctx = cv.getContext && cv.getContext('2d'); if (!ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.fillStyle = '#7A93AB'; ctx.font = "12px 'JetBrains Mono', monospace"; ctx.textAlign = 'center';
  ctx.fillText(msg || 'Waiting on Commerg data', cv.width/2, (cv.height||120)/2);
  ctx.restore();
}

// ── GO PRICES PAGE (= chart_go_price_indications + chart_go_cal1 + go_kpi)
function renderGO() {
  if (!_goAutoTried) { _goAutoTried = true; autoloadGo(); autoloadGoAuctions(); }
  renderGOKPIs();
  renderGOFwdTable();
  drawGoIndicChart();
  drawGoCal1Chart();
  drawGoCalChart();
  drawGoSpreadChart();
  drawGoHist(); drawGoWoW(); drawGoBox();
}

function setGoProd(prod, btn) {
  goProd = prod;
  document.querySelectorAll('#go-prod-tabs .day-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const t1 = document.getElementById('go-indic-title'); if (t1) t1.textContent = prod + ' — Price indications (€/MWh)';
  const t2 = document.getElementById('go-cal1-title');  if (t2) t2.textContent = prod + ' — CAL+1 EU price indications (€/MWh)';
  renderGOKPIs();
  drawGoIndicChart();
  drawGoCal1Chart();
  drawGoCalChart();
  drawGoSpreadChart();
}

function renderGOKPIs() {
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const strip = document.getElementById('go-kpi-strip');
  if (!strip) return;
  const real = GO_REAL && GO_REAL.byKey[key];
  if (!(real && real.weekly.length)) {
    strip.innerHTML = ['Last Bid','Last Ask','Mid Price','Delta WoW'].map(l =>
      `<div class="kpi-card"><div class="kpi-label">${l}</div>
       <div class="kpi-value">–</div>
       <div class="kpi-chg" style="color:var(--text3)">en attente Commerg</div></div>`).join('');
    return;
  }
  const last = real.weekly[real.weekly.length - 1];
  const y1 = (GO_REAL.asOf ? GO_REAL.asOf.getFullYear() : new Date().getFullYear()) + 1;
  const sub = 'Cal-' + String(y1).slice(-2);
  const asOfTxt = GO_REAL.asOf ? fmtGoDate(GO_REAL.asOf) : '';
  const d = real.d;
  const fmt = v => (v == null ? '–' : v.toFixed(2) + ' €');
  strip.innerHTML = [
    {l:'Last Bid', v:fmt(last.bid), sub, cls:'up'},
    {l:'Last Ask', v:fmt(last.ask), sub, cls:'down'},
    {l:'Mid Price',   v:fmt(last.mid), sub, cls:''},
    {l:'Delta WoW',   v:(d==null?'–':(d>=0?'+':'')+d.toFixed(2)+' €'), sub: asOfTxt ? ('as-of '+asOfTxt) : 'vs prev. week', cls:(d==null?'':(d>=0?'up':'down'))},
  ].map(k => `<div class="kpi-card">
    <div class="kpi-label">${k.l}</div>
    <div class="kpi-value ${k.cls}">${k.v}</div>
    <div class="kpi-chg" style="color:var(--text3)">${k.sub}</div>
  </div>`).join('');
}

// chart_go_price_indications (reference workbook, "GoOs Brokers" pivot):
// ONE LINE PER VINTAGE YEAR (Cal-25, Cal-26…), x = weekly quote date, y = mid
// price for that vintage as quoted that week. This is the "forward curve
// evolution" view — how far the market moves each contract year over time —
// not a single rolling product's bid/ask band.
// Decimals that follow the size of the numbers: axis labels as precise as the gap between two ticks
// (0.5 € steps → one decimal, 1 € steps → none), values in tooltips with two decimals under 10 €, one above.
function _goTick(v, i, ticks) {
  const step = ticks && ticks.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) : 1;
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return (+v).toFixed(d) + '€';
}
function _goNum(v) { return (+v).toFixed(Math.abs(v) >= 10 ? 1 : 2); }

function drawGoIndicChart() {
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const real = GO_REAL && GO_REAL.byKey[key];
  if (!real || !real.years || !real.years.length) { goNoData('go-indic-canvas', 'No Commerg data loaded'); return; }

  // Union of all dates across vintage years → shared x-axis
  let allDates = [...new Set(real.years.flatMap(y => real.byYear[y].map(w => +w.t)))].sort((a,b)=>a-b);
  const datesAll = allDates.map(t => new Date(t));
  const slice = _goPeriodSlice(datesAll);
  allDates = allDates.slice(slice.start, slice.end);
  const dates = datesAll.slice(slice.start, slice.end);
  // Full real labels on every point — Chart.js's own autoSkip (maxTicksLimit
  // below) decides which to actually draw, and reliably keeps first/last.
  const labels = dates.map(d => fmtGoDate(d));

  const datasets = real.years.map((y, i) => {
    const byT = new Map(real.byYear[y].map(w => [+w.t, w.mid]));
    return {
      label: 'Cal-' + String(y).slice(-2),
      data: allDates.map(t => byT.has(t) ? byT.get(t) : null),
      borderColor: GO_YEAR_COLORS[i % GO_YEAR_COLORS.length],
      borderWidth: 1.8, pointRadius: 0, fill: false, tension: 0, spanGaps: true,
    };
  });

  mkChart('go-indic-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12} },
        tooltip: { mode:'index', callbacks:{ label: ctx => ctx.dataset.label+': '+(ctx.raw==null?'–':_goNum(ctx.raw)+' €/MWh') } },
        zoom: ZOOM_CFG,
      },
      scales: {
        x: { grid:GRID, ticks:{color:C_TX3, maxTicksLimit:12} },
        y: { grid:GRID, ticks:{color:C_TX3, callback:_goTick} }
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-indic-canvas', _goFsContent); addDownload('go-indic-canvas','go-prices'); },100);
}

// Shared fullscreen content (KPI strip) for the main GO price charts — clones
// the already-rendered inline KPI strip so the overlay shows the same figures.
function _goFsContent() {
  const kpiEl = document.getElementById('go-kpi-strip');
  return {
    title: goProd + ' — Price indications (€/MWh)',
    subtitle: 'Commerg weekly assessment',
    kpis: kpiEl ? { html: '<div class="kpi-strip" style="grid-template-columns:repeat(4,1fr);width:100%">' + kpiEl.innerHTML + '</div>' } : null,
  };
}

// chart_go_cal1 (reference workbook): single rolling "Y+1" line — the
// front calendar-year product, stitched continuously across weeks.
function drawGoCal1Chart() {
  const hist = getGOHistory();
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const wk = hist[key];
  if (!wk || !wk.data) { goNoData('go-cal1-canvas', 'No Commerg data loaded'); return; }

  const { start, end } = _goPeriodSlice(wk.dates);
  const mids = wk.data.slice(start, end);
  const dates = wk.dates.slice(start, end);
  const labels = dates.map(d => fmtGoDate(d));

  mkChart('go-cal1-canvas', {
    type: 'line',
    data: { labels, datasets:[
      { label:'Y + 1', data:mids, borderColor:'#14D3A9', borderWidth:2,
        pointRadius:0, fill:true, backgroundColor:rgba(C_WIND,.08), tension:0 },
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { display:false },
        tooltip: { callbacks:{ label: ctx => 'Y+1: '+(ctx.raw==null?'–':_goNum(ctx.raw)+' €/MWh') } },
        zoom: ZOOM_CFG,
      },
      scales: {
        x: { grid:GRID, ticks:{color:C_TX3, maxTicksLimit:10} },
        y: { grid:GRID, ticks:{color:C_TX3, callback:_goTick} }
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-cal1-canvas', _goFsContent); addDownload('go-cal1-canvas','go-cal1'); },100);
}

// chart_go_cal1 : grouped bar forward curve (every vintage year Commerg quotes)
function drawGoCalChart() {
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const real = GO_REAL && GO_REAL.byKey[key];
  const fwd = real && real.fwd;
  if (!fwd || !Object.keys(fwd).length) { goNoData('go-cal-canvas', 'No Commerg data loaded'); return; }
  // Live curve only (current year onward) — past vintages are expired/settled,
  // not part of a "forward curve" even though their last quote is still on file.
  const curYear = GO_REAL.asOf ? GO_REAL.asOf.getFullYear() : new Date().getFullYear();
  const years = real.years.filter(y => y >= curYear);
  const cals = years.map(y => 'Cal-' + String(y).slice(-2));
  const gt = document.getElementById('go-cal-title'); if (gt && years.length) gt.textContent = `Forward curve — Cal ${years[0]} → ${years[years.length - 1]}`;
  const bids = years.map(y => fwd[y] ? fwd[y].bid : null);
  const asks = years.map(y => fwd[y] ? fwd[y].ask : null);

  mkChart('go-cal-canvas', {
    type: 'bar',
    data: {
      labels: cals,
      datasets: [
        { label:'Bid', data:bids, backgroundColor:rgba(C_UP,.75), borderRadius:4, borderWidth:0 },
        { label:'Ask', data:asks, backgroundColor:rgba(C_DN,.75), borderRadius:4, borderWidth:0 },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{ display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12} },
        tooltip:{ callbacks:{ label: ctx => ctx.dataset.label+': '+(ctx.raw==null?'–':_goNum(ctx.raw)+' €/MWh') } },
      },
      scales: {
        x: { grid:GRID_NONE, ticks:{color:C_TX3} },
        // Bars start at zero: a truncated axis made a 0.05 € gap look like 3x.
        y: { grid:GRID, ticks:{color:C_TX3, callback:_goTick}, beginAtZero:true }
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-cal-canvas'); addDownload('go-cal-canvas','go-forward'); },100);
}

// Spread bid/ask réel
function drawGoSpreadChart() {
  const hist = getGOHistory();
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const wk = hist[key];
  if (!wk || !wk.spreadArr || !wk.spreadArr.some(v => v != null)) { goNoData('go-spread-canvas', 'No Commerg data loaded'); return; }

  const { start, end } = _goPeriodSlice(wk.dates);
  const spreads = wk.spreadArr.slice(start, end);
  const dates = wk.dates.slice(start, end);
  const labels = dates.map(d => fmtGoDate(d));

  mkChart('go-spread-canvas', {
    type: 'line',
    data: { labels, datasets:[{ label:'Spread Bid/Ask', data:spreads, borderColor:C_WARN, borderWidth:1.5,
      pointRadius:0, fill:true, backgroundColor:rgba(C_WARN,.1), tension: 0 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>(ctx.raw==null?'–':_goNum(ctx.raw)+' €/MWh')}}, zoom:ZOOM_CFG },
      scales:{ x:{grid:GRID,ticks:{color:C_TX3,maxTicksLimit:8}}, y:{grid:GRID,ticks:{color:C_TX3,callback:_goTick},beginAtZero:true} }
    }
  });
  setTimeout(()=>{ addFullscreen('go-spread-canvas'); addDownload('go-spread-canvas','go-spread'); },100);
}

// "GO by Calendar Year" table — one row per product Commerg quotes.
function renderGOFwdTable() {
  const tbody = document.getElementById('go-fwd-tbody');
  if (!tbody) return;
  if (!GO_REAL) { tbody.innerHTML = ''; return; }
  const years = [2025, 2026, 2027, 2028];
  const fmt = v => (v == null ? '–' : v.toFixed(2));
  const rows = Object.keys(GO_SERIES).map(key => {
    const real = GO_REAL.byKey[key];
    if (!real || !real.fwd) return '';
    const label = GO_SERIES[key].l;
    const cells = years.map(y => {
      const f = real.fwd[y];
      return `<td>${f ? fmt(f.bid) : '–'}</td><td>${f ? fmt(f.ask) : '–'}</td>`;
    }).join('');
    const last = real.weekly[real.weekly.length - 1];
    const spread = last && last.spread != null ? fmt(last.spread) : '–';
    const d = real.d;
    const wow = d == null ? '–' : (d >= 0 ? '+' : '') + d.toFixed(2);
    return `<tr><td>${label}</td>${cells}<td>${spread}</td><td style="color:${d==null?'var(--text3)':(d>=0?'var(--up)':'var(--dn)')}">${wow}</td></tr>`;
  }).join('');
  tbody.innerHTML = rows || '<tr><td colspan="11" style="color:var(--text3)">Waiting on Commerg data</td></tr>';
}

// ════════════════════════════════════════════════════════════════════
// FRENCH AUCTIONS (EEX) — data/go_auctions.json, monthly, by technology.
// Mirrors the reference workbook's "FR Auctions" sheet (chart2/chart3):
// Wind/Solar volume sold + weighted avg price, and total volume auctioned
// (offered) vs sold (allocated).
// ════════════════════════════════════════════════════════════════════
let GO_AUCTIONS = null;
function autoloadGoAuctions() {
  const base = (typeof DATA_BASE !== 'undefined' && DATA_BASE) ? DATA_BASE : './data/';
  fetch(base + 'go_auctions.json?t=' + Date.now())
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d && d.auctions) { GO_AUCTIONS = d; drawGoAuctionTechChart(); drawGoAuctionVolChart(); } })
    .catch(() => {});
}
function _goAuctionLabels(auctions) {
  return auctions.map(a => a.auction_month);
}
function drawGoAuctionTechChart() {
  if (!GO_AUCTIONS || !GO_AUCTIONS.auctions.length) { goNoData('go-auct-tech-canvas', 'No EEX data loaded'); return; }
  const auctions = GO_AUCTIONS.auctions;
  const byTech = tech => auctions.map(a => (a.by_technology || []).find(t => t.technology === tech) || null);
  const wind = byTech('Wind'), solar = byTech('Solar');
  const labels = _goAuctionLabels(auctions);

  mkChart('go-auct-tech-canvas', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type:'bar',  label:'Wind — Volume (MWh)',  data: wind.map(t => t ? t.allocated_mwh : null),  backgroundColor: rgba('#7FC8F8',.45), yAxisID:'vol', order:3 },
        { type:'bar',  label:'Solar — Volume (MWh)', data: solar.map(t => t ? t.allocated_mwh : null), backgroundColor: rgba('#FBBF24',.5), yAxisID:'vol', order:4 },
        { type:'line', label:'Wind — Weighted price (€/GO)',  data: wind.map(t => t ? t.price_eur_mwh : null),  borderColor: '#7FC8F8', borderWidth:2, pointRadius:0, tension:0, yAxisID:'price', order:1 },
        { type:'line', label:'Solar — Weighted price (€/GO)', data: solar.map(t => t ? t.price_eur_mwh : null), borderColor: '#FBBF24', borderWidth:2, pointRadius:0, tension:0, yAxisID:'price', order:2 },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12} },
        tooltip: { mode:'index', callbacks:{ label: ctx => {
          const v = ctx.raw;
          return v == null ? ctx.dataset.label+': –' :
            ctx.dataset.yAxisID === 'price' ? ctx.dataset.label+': '+_goNum(v)+' €/GO' : ctx.dataset.label+': '+Math.round(v).toLocaleString('en-GB')+' MWh';
        } } },
      },
      scales: {
        x: { grid:GRID_NONE, ticks:{color:C_TX3, maxTicksLimit:14, font:{size:9}} },
        vol:   { position:'left',  grid:GRID, ticks:{color:C_TX3, callback:v=>(v/1000).toFixed(0)+'k'}, title:{display:true,text:'MWh',color:C_TX3,font:{size:10}} },
        price: { position:'right', grid:GRID_NONE, ticks:{color:C_TX3, callback:_goTick}, title:{display:true,text:'€/GO',color:C_TX3,font:{size:10}} },
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-auct-tech-canvas'); addDownload('go-auct-tech-canvas','go-auctions-tech'); },100);
}
function drawGoAuctionVolChart() {
  if (!GO_AUCTIONS || !GO_AUCTIONS.auctions.length) { goNoData('go-auct-vol-canvas', 'No EEX data loaded'); return; }
  const auctions = GO_AUCTIONS.auctions;
  const sum = (a, field) => (a.by_technology || []).reduce((s,t) => s + (t[field] || 0), 0);
  const offered  = auctions.map(a => sum(a, 'offered_mwh'));
  const allocated = auctions.map(a => sum(a, 'allocated_mwh'));
  const labels = _goAuctionLabels(auctions);

  mkChart('go-auct-vol-canvas', {
    type: 'line',
    data: { labels, datasets:[
      { label:'Offered volume (MWh)', data:offered, borderColor:C_TX2, borderWidth:1.5, pointRadius:0, fill:false, tension:0, borderDash:[4,3] },
      { label:'Allocated volume (MWh)', data:allocated, borderColor:C_UP, borderWidth:2, pointRadius:0, fill:true, backgroundColor:rgba(C_UP,.08), tension:0 },
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12} },
        tooltip: { mode:'index', callbacks:{ label: ctx => ctx.dataset.label+': '+(ctx.raw==null?'–':Math.round(ctx.raw).toLocaleString('en-GB')+' MWh') } },
        zoom: ZOOM_CFG,
      },
      scales: {
        x: { grid:GRID_NONE, ticks:{color:C_TX3, maxTicksLimit:14, font:{size:9}} },
        y: { grid:GRID, ticks:{color:C_TX3, callback:v=>(v/1000).toFixed(0)+'k'} }
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-auct-vol-canvas'); addDownload('go-auct-vol-canvas','go-auctions-volume'); },100);
  drawGoAuctionTable();
}
// the auctions as a table, newest first (note 45): price and volume of each technology, the total and the share allocated
function drawGoAuctionTable() {
  const el = document.getElementById('go-auct-table'); if (!el || !GO_AUCTIONS) return;
  const fr = !window.PKI18n || PKI18n.lang !== 'en', T = (f, e) => fr ? f : e;
  const nf = (v, d) => v == null || !isFinite(v) ? '–' : v.toLocaleString(fr ? 'fr-FR' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  const techs = ['Wind', 'Solar', 'Hydro', 'Thermal'].filter(t => GO_AUCTIONS.auctions.some(a => (a.by_technology || []).some(x => x.technology === t)));
  const TN = { Wind: T('Éolien', 'Wind'), Solar: T('Solaire', 'Solar'), Hydro: T('Hydraulique', 'Hydro'), Thermal: T('Thermique', 'Thermal') };
  const head = '<thead><tr><th style="text-align:left">' + T('Enchère', 'Auction') + '</th>' + techs.map(t => '<th>' + TN[t] + ' €/MWh</th><th>' + TN[t] + ' GWh</th>').join('') + '<th>' + T('Total GWh', 'Total GWh') + '</th><th>' + T('Prix moyen €/MWh', 'Average €/MWh') + '</th><th>' + T('Part allouée', 'Share allocated') + '</th></tr></thead>';
  const rows = GO_AUCTIONS.auctions.slice().reverse().map(a => {
    const bt = a.by_technology || [], g = t => bt.find(x => x.technology === t);
    const vol = bt.reduce((s, x) => s + (x.allocated_mwh || 0), 0), off = bt.reduce((s, x) => s + (x.offered_mwh || 0), 0), val = bt.reduce((s, x) => s + (x.allocated_mwh || 0) * (x.price_eur_mwh || 0), 0);
    return '<tr><td class="l" style="text-align:left;font-weight:600">' + a.auction_month + '</td>' + techs.map(t => { const x = g(t); return '<td>' + (x ? nf(x.price_eur_mwh, 3) : '–') + '</td><td>' + (x ? nf((x.allocated_mwh || 0) / 1000, 0) : '–') + '</td>'; }).join('') +
      '<td>' + nf(vol / 1000, 0) + '</td><td>' + (vol ? nf(val / vol, 3) : '–') + '</td><td>' + (off ? nf(vol / off * 100, 0) + ' %' : '–') + '</td></tr>';
  });
  el.innerHTML = head + '<tbody>' + rows.join('') + '</tbody>';
}

// ── GO HISTORY PAGE
function filterGoH(f, btn) {
  goHistFilter = f;
  document.querySelectorAll('#go-hist-filter .day-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  drawGoHist(); drawGoWoW(); drawGoBox();
}
function drawGoHist() {
  const hist = getGOHistory();
  const filter = goHistFilter;
  const active = filter === 'all'
    ? Object.entries(hist)
    : Object.entries(hist).filter(([k]) => k === filter);
  if (!active.length) { goNoData('go-hist-canvas', 'No Commerg data loaded'); return; }

  const sample = active[0][1];
  let labels, start = 0, end = 0;
  if (sample && sample.dates) {
    ({ start, end } = _goPeriodSlice(sample.dates));
    labels = sample.dates.slice(start, end).map(d => fmtGoDate(d));
  } else { labels = []; }

  const datasets = active.map(([k, s]) => ({
    label: GO_SERIES[k]?.l.replace('GO AIB ','').replace('GO ','') || k,
    data: s.data.slice(start, end),
    borderColor: GO_SERIES[k]?.c || '#888',
    borderWidth: 1.8, pointRadius: 0, fill: false, tension: 0,
  }));

  mkChart('go-hist-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{ display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12} },
        tooltip:{ mode:'index', callbacks:{label:ctx=>ctx.dataset.label+': '+(ctx.raw==null?'–':_goNum(ctx.raw)+' €/MWh')} },
        zoom: ZOOM_CFG,
      },
      scales: {
        x:{ grid:GRID, ticks:{color:C_TX3, maxTicksLimit:12} },
        y:{ grid:GRID, ticks:{color:C_TX3, callback:_goTick} }
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-hist-canvas'); addDownload('go-hist-canvas','go-history'); },100);
}

function drawGoWoW() {
  const hist = getGOHistory();
  const key = goHistFilter === 'all' ? 'renewable' : goHistFilter;
  const wk = hist[key];
  if (!wk || !wk.data || wk.data.length < 2) { goNoData('go-wow-canvas', 'No Commerg data loaded'); return; }
  const { start, end } = _goPeriodSlice(wk.dates);
  const data = wk.data.slice(start, end);
  // wk.dates lines up 1:1 with wk.data — was discarded here, leaving the
  // x-axis hidden entirely (scales.x.display:false) with synthetic "W0,W1…"
  // labels that didn't even correspond to real calendar weeks. A bar chart
  // with no x-axis gives no way to tell which week any given bar is.
  const dates = (wk.dates || []).slice(start, end);
  const deltaDates = dates.slice(1);
  const deltas = data.slice(1).map((v,i) => +(v - data[i]).toFixed(2));
  const labels = deltaDates.length === deltas.length
    ? deltaDates.map(d => fmtGoDate(d))
    : Array.from({length:deltas.length},(_,i)=>'W'+i);

  mkChart('go-wow-canvas', {
    type: 'bar',
    data: { labels, datasets:[{
      label:'Delta WoW (€/MWh)', data:deltas,
      backgroundColor: deltas.map(v=>v>=0?rgba(C_UP,.7):rgba(C_DN,.7)),
      borderWidth:0, borderRadius:2,
    }]},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>(ctx.raw>=0?'+':'')+_goNum(ctx.raw)+' €/MWh'}}, zoom:ZOOM_CFG },
      scales:{ x:{grid:GRID_NONE, ticks:{color:C_TX3, maxTicksLimit:10, font:{size:9}}}, y:{grid:GRID, ticks:{color:C_TX3,callback:_goTick}} }
    }
  });
  setTimeout(()=>{ addFullscreen('go-wow-canvas'); },100);
}

function drawGoBox() {
  const hist = getGOHistory();
  const key = goHistFilter === 'all' ? 'renewable' : goHistFilter;
  const wk = hist[key];
  if (!wk || !wk.data || !wk.data.length) { goNoData('go-box-canvas', 'No Commerg data loaded'); return; }
  const { start, end } = _goPeriodSlice(wk.dates);
  const data = wk.data.slice(start, end);
  const dates = (wk.dates || []).slice(start, end);
  const chunks = 8, sz = Math.max(1, Math.floor(data.length/chunks));
  const col = GO_SERIES[key]?.c || C_UP;

  // Each bucket's label used to be "Q1".."Q8" — meaning "period 1..8" here,
  // but the "Q1-Q3 range" dataset label means quartile-1-to-3, so with both
  // visible (the legend was off, masking the collision) "Q1" reads as two
  // different things. Label buckets by their real start date instead.
  const labels = Array.from({length:chunks}, (_,i) => {
    const d = dates[i*sz];
    return d ? fmtGoDate(d) : 'P' + (i+1);
  });
  const q = (arr,p) => { const ch=arr.slice().sort((a,b)=>a-b); return ch.length?+ch[Math.floor(ch.length*p)].toFixed(2):null; };
  const medians = Array.from({length:chunks}, (_,i) => q(data.slice(i*sz,(i+1)*sz),.5));
  const q1s = Array.from({length:chunks}, (_,i) => q(data.slice(i*sz,(i+1)*sz),.25));
  const q3s = Array.from({length:chunks}, (_,i) => q(data.slice(i*sz,(i+1)*sz),.75));

  mkChart('go-box-canvas', {
    type: 'bar',
    data: { labels, datasets:[
      // Chart.js floating-bar syntax ([min, max] per point) — previously this
      // passed a single scalar (q3-q1), which draws a bar of that HEIGHT
      // starting from the axis minimum, not actually positioned between q1
      // and q3. Height alone (the IQR width) was shown; where it sat on the
      // price axis was meaningless and could visually contradict the median bar.
      { label:'Q1–Q3 range', data:q3s.map((v,i)=>(v==null||q1s[i]==null)?null:[q1s[i], v]), backgroundColor:rgba(col,.25), borderWidth:1, borderColor:col, borderRadius:2 },
      { label:'Median', data:medians, backgroundColor:col, borderWidth:0, borderRadius:2, barThickness:4 },
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12}}, tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+(ctx.raw==null?'–':(Array.isArray(ctx.raw)?ctx.raw[0].toFixed(2)+'–'+ctx.raw[1].toFixed(2):_goNum(ctx.raw))+' €/MWh')}} },
      scales:{ x:{grid:GRID_NONE, ticks:{color:C_TX3, font:{size:9}}}, y:{grid:GRID, ticks:{color:C_TX3,callback:_goTick}, beginAtZero:false} }
    }
  });
  setTimeout(()=>{ addFullscreen('go-box-canvas'); },100);
}

// ── Dashboard catalogue (mirrors of this page's charts, js/widgets.js) ──
(function () {
  if (!window.PKW) return;
  const ensure = () => { if (!document.getElementById('go-indic-canvas') || !Chart.getChart(document.getElementById('go-indic-canvas'))) renderGO(); };
  const ensureAuct = () => { if (typeof autoloadGoAuctions === 'function' && !window._pkGoAuctTried) { window._pkGoAuctTried = true; autoloadGoAuctions(); } };
  const asOf = () => (typeof GO_REAL !== 'undefined' && GO_REAL && GO_REAL.asOf) ? 'as of ' + new Date(GO_REAL.asOf).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  [
    ['go-indic', 'go-indic-canvas', 'GO price indications by vintage', 'Weekly broker indications per production year (€/MWh), selected product.', { w: 12, h: 5 }],
    ['go-cal1', 'go-cal1-canvas', 'GO Cal+1 price', 'Rolling front-year GO price indication (€/MWh).', { w: 6, h: 5 }],
    ['go-cal', 'go-cal-canvas', 'GO forward curve by calendar year', 'Bid / ask by production year (€/MWh).', { w: 6, h: 5 }],
    ['go-spread', 'go-spread-canvas', 'GO bid/ask spread', 'Bid/ask spread over time (€/MWh).', { w: 6, h: 5 }],
    ['go-hist', 'go-hist-canvas', 'GO weekly mid prices, all products', 'Weekly mid price per GO product (€/MWh).', { w: 12, h: 5 }],
    ['go-wow', 'go-wow-canvas', 'GO week-on-week change', 'Weekly change of the mid price (€/MWh).', { w: 6, h: 4 }],
    ['go-box', 'go-box-canvas', 'GO price distribution by half-year', 'Interquartile range and median of the weekly mid price.', { w: 6, h: 4 }],
  ].forEach(([id, canvas, title, desc, size]) => PKW.mirror({ id, pageCanvas: canvas, title, desc, size, category: 'go', page: 'goprices', source: 'Commerg', ensure, subFn: asOf }));
  [
    ['go-auct-tech', 'go-auct-tech-canvas', 'French GO auctions · wind vs solar', 'Volume sold and weighted average price per technology, French state auctions.'],
    ['go-auct-vol', 'go-auct-vol-canvas', 'French GO auctions · volumes', 'Volume offered vs allocated per auction (MWh).'],
  ].forEach(([id, canvas, title, desc]) => PKW.mirror({ id, pageCanvas: canvas, title, desc, size: { w: 6, h: 5 }, category: 'go', page: 'goprices', source: 'EEX',
    ensure: () => { ensureAuct(); ensure(); } }));
})();
