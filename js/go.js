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
let goHistPeriod = 9999;
let goHistFilter = 'all';
let goProd = 'GO AIB Renewable';

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
  return d.toLocaleDateString('fr-FR', { month:'short', year:'2-digit' });
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
      spread: (r.ask != null ? +(r.ask - r.bid).toFixed(4) : null),
    }));
    let d = null;
    const L = weekly.length;
    if (L >= 2 && weekly[L-1].bid != null && weekly[L-2].bid != null)
      d = +(weekly[L-1].bid - weekly[L-2].bid).toFixed(4);
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
    // My Dashboard's GO widget triggers this same fetch lazily (see
    // renderMyDash in prices.js) — refresh it once the data lands.
    if (document.getElementById('page-mydash')?.classList.contains('active') && typeof renderMyDash === 'function') {
      renderMyDash();
    }
    console.log('[go] real Commerg data loaded · as-of', GO_REAL.asOf);
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
  ctx.fillText(msg || 'En attente de données Commerg', cv.width/2, (cv.height||120)/2);
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
}

function setGoProd(prod, btn) {
  goProd = prod;
  document.querySelectorAll('#go-prod-tabs .day-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const t1 = document.getElementById('go-indic-title'); if (t1) t1.textContent = prod + ' — Prix indicatifs (€/MWh)';
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
    strip.innerHTML = ['Dernier Bid','Dernier Ask','Mid Price','Delta WoW'].map(l =>
      `<div class="kpi-card"><div class="kpi-label">${l}</div>
       <div class="kpi-value" style="font-size:17px">–</div>
       <div class="kpi-chg" style="color:var(--text3)">en attente Commerg</div></div>`).join('');
    return;
  }
  const last = real.weekly[real.weekly.length - 1];
  const y1 = (GO_REAL.asOf ? GO_REAL.asOf.getFullYear() : new Date().getFullYear()) + 1;
  const sub = 'Cal-' + String(y1).slice(-2);
  const asOfTxt = GO_REAL.asOf ? fmtGoDate(GO_REAL.asOf) : '';
  const d = real.d;
  const fmt = v => (v == null ? '–' : v.toFixed(4) + ' €');
  strip.innerHTML = [
    {l:'Dernier Bid', v:fmt(last.bid), sub, cls:'up'},
    {l:'Dernier Ask', v:fmt(last.ask), sub, cls:'down'},
    {l:'Mid Price',   v:fmt(last.mid), sub, cls:''},
    {l:'Delta WoW',   v:(d==null?'–':(d>=0?'+':'')+d.toFixed(4)+' €'), sub: asOfTxt ? ('as-of '+asOfTxt) : 'vs sem. préc.', cls:(d==null?'':(d>=0?'up':'down'))},
  ].map(k => `<div class="kpi-card">
    <div class="kpi-label">${k.l}</div>
    <div class="kpi-value ${k.cls}" style="font-size:17px">${k.v}</div>
    <div class="kpi-chg" style="color:var(--text3)">${k.sub}</div>
  </div>`).join('');
}

// chart_go_price_indications (reference workbook, "GoOs Brokers" pivot):
// ONE LINE PER VINTAGE YEAR (Cal-25, Cal-26…), x = weekly quote date, y = mid
// price for that vintage as quoted that week. This is the "forward curve
// evolution" view — how far the market moves each contract year over time —
// not a single rolling product's bid/ask band.
function drawGoIndicChart() {
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const real = GO_REAL && GO_REAL.byKey[key];
  if (!real || !real.years || !real.years.length) { goNoData('go-indic-canvas', 'Aucune donnée Commerg chargée'); return; }

  // Union of all dates across vintage years → shared x-axis
  const allDates = [...new Set(real.years.flatMap(y => real.byYear[y].map(w => +w.t)))].sort((a,b)=>a-b);
  const dates = allDates.map(t => new Date(t));
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
        tooltip: { mode:'index', callbacks:{ label: ctx => ctx.dataset.label+': '+(ctx.raw==null?'–':ctx.raw.toFixed(4)+' €/MWh') } },
        zoom: ZOOM_CFG,
      },
      scales: {
        x: { grid:GRID, ticks:{color:C_TX3, maxTicksLimit:12} },
        y: { grid:GRID, ticks:{color:C_TX3, callback:v=>v.toFixed(3)+'€'} }
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
    title: goProd + ' — Prix indicatifs (€/MWh)',
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
  if (!wk || !wk.data) { goNoData('go-cal1-canvas', 'Aucune donnée Commerg chargée'); return; }

  const n = goHistPeriod;
  const len = wk.data.length, take = Math.min(n, len), from = len - take;
  const mids = wk.data.slice(from);
  const dates = wk.dates.slice(from);
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
        tooltip: { callbacks:{ label: ctx => 'Y+1: '+(ctx.raw==null?'–':ctx.raw.toFixed(4)+' €/MWh') } },
        zoom: ZOOM_CFG,
      },
      scales: {
        x: { grid:GRID, ticks:{color:C_TX3, maxTicksLimit:10} },
        y: { grid:GRID, ticks:{color:C_TX3, callback:v=>v.toFixed(3)+'€'} }
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
  if (!fwd || !Object.keys(fwd).length) { goNoData('go-cal-canvas', 'Aucune donnée Commerg chargée'); return; }
  // Live curve only (current year onward) — past vintages are expired/settled,
  // not part of a "forward curve" even though their last quote is still on file.
  const curYear = GO_REAL.asOf ? GO_REAL.asOf.getFullYear() : new Date().getFullYear();
  const years = real.years.filter(y => y >= curYear);
  const cals = years.map(y => 'Cal-' + String(y).slice(-2));
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
        tooltip:{ callbacks:{ label: ctx => ctx.dataset.label+': '+(ctx.raw==null?'–':ctx.raw.toFixed(4)+' €/MWh') } },
      },
      scales: {
        x: { grid:GRID_NONE, ticks:{color:C_TX3} },
        y: { grid:GRID, ticks:{color:C_TX3, callback:v=>v.toFixed(3)+'€'}, beginAtZero:false }
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
  if (!wk || !wk.spreadArr || !wk.spreadArr.some(v => v != null)) { goNoData('go-spread-canvas', 'Aucune donnée Commerg chargée'); return; }

  const n = goHistPeriod;
  const len = wk.spreadArr.length, take = Math.min(n, len), from = len - take;
  const spreads = wk.spreadArr.slice(from);
  const dates = wk.dates.slice(from);
  const labels = dates.map(d => fmtGoDate(d));

  mkChart('go-spread-canvas', {
    type: 'line',
    data: { labels, datasets:[{ label:'Spread Bid/Ask', data:spreads, borderColor:C_WARN, borderWidth:1.5,
      pointRadius:0, fill:true, backgroundColor:rgba(C_WARN,.1), tension: 0 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>(ctx.raw==null?'–':ctx.raw.toFixed(4)+' €/MWh')}}, zoom:ZOOM_CFG },
      scales:{ x:{grid:GRID,ticks:{color:C_TX3,maxTicksLimit:8}}, y:{grid:GRID,ticks:{color:C_TX3,callback:v=>v.toFixed(4)+'€'},beginAtZero:true} }
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
  const fmt = v => (v == null ? '–' : v.toFixed(4));
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
    const wow = d == null ? '–' : (d >= 0 ? '+' : '') + d.toFixed(4);
    return `<tr><td>${label}</td>${cells}<td>${spread}</td><td style="color:${d==null?'var(--text3)':(d>=0?'var(--up)':'var(--dn)')}">${wow}</td></tr>`;
  }).join('');
  tbody.innerHTML = rows || '<tr><td colspan="11" style="color:var(--text3)">En attente de données Commerg</td></tr>';
}

// ════════════════════════════════════════════════════════════════════
// FRENCH AUCTIONS (EEX) — data/go_auctions.json, monthly, by technology.
// Mirrors the reference workbook's "Enchères FR" sheet (chart2/chart3):
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
  if (!GO_AUCTIONS || !GO_AUCTIONS.auctions.length) { goNoData('go-auct-tech-canvas', 'Aucune donnée EEX chargée'); return; }
  const auctions = GO_AUCTIONS.auctions;
  const byTech = tech => auctions.map(a => (a.by_technology || []).find(t => t.technology === tech) || null);
  const wind = byTech('Wind'), solar = byTech('Solar');
  const labels = _goAuctionLabels(auctions);

  mkChart('go-auct-tech-canvas', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type:'bar',  label:'Wind — Volume (MWh)',  data: wind.map(t => t ? t.allocated_mwh : null),  backgroundColor: rgba(C_WIND,.5), yAxisID:'vol', order:3 },
        { type:'bar',  label:'Solar — Volume (MWh)', data: solar.map(t => t ? t.allocated_mwh : null), backgroundColor: rgba('#FBBF24',.5), yAxisID:'vol', order:4 },
        { type:'line', label:'Wind — Prix pondéré (€/GO)',  data: wind.map(t => t ? t.price_eur_mwh : null),  borderColor: C_WIND, borderWidth:2, pointRadius:0, tension:0, yAxisID:'price', order:1 },
        { type:'line', label:'Solar — Prix pondéré (€/GO)', data: solar.map(t => t ? t.price_eur_mwh : null), borderColor: '#FBBF24', borderWidth:2, pointRadius:0, tension:0, yAxisID:'price', order:2 },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12} },
        tooltip: { mode:'index', callbacks:{ label: ctx => {
          const v = ctx.raw;
          return v == null ? ctx.dataset.label+': –' :
            ctx.dataset.yAxisID === 'price' ? ctx.dataset.label+': '+v.toFixed(4)+' €/GO' : ctx.dataset.label+': '+Math.round(v).toLocaleString('fr-FR')+' MWh';
        } } },
      },
      scales: {
        x: { grid:GRID_NONE, ticks:{color:C_TX3, maxTicksLimit:14, font:{size:9}} },
        vol:   { position:'left',  grid:GRID, ticks:{color:C_TX3, callback:v=>(v/1000).toFixed(0)+'k'}, title:{display:true,text:'MWh',color:C_TX3,font:{size:10}} },
        price: { position:'right', grid:GRID_NONE, ticks:{color:C_TX3, callback:v=>v.toFixed(2)+'€'}, title:{display:true,text:'€/GO',color:C_TX3,font:{size:10}} },
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-auct-tech-canvas'); addDownload('go-auct-tech-canvas','go-auctions-tech'); },100);
}
function drawGoAuctionVolChart() {
  if (!GO_AUCTIONS || !GO_AUCTIONS.auctions.length) { goNoData('go-auct-vol-canvas', 'Aucune donnée EEX chargée'); return; }
  const auctions = GO_AUCTIONS.auctions;
  const sum = (a, field) => (a.by_technology || []).reduce((s,t) => s + (t[field] || 0), 0);
  const offered  = auctions.map(a => sum(a, 'offered_mwh'));
  const allocated = auctions.map(a => sum(a, 'allocated_mwh'));
  const labels = _goAuctionLabels(auctions);

  mkChart('go-auct-vol-canvas', {
    type: 'line',
    data: { labels, datasets:[
      { label:'Volume offert (MWh)', data:offered, borderColor:C_TX2, borderWidth:1.5, pointRadius:0, fill:false, tension:0, borderDash:[4,3] },
      { label:'Volume alloué (MWh)', data:allocated, borderColor:C_UP, borderWidth:2, pointRadius:0, fill:true, backgroundColor:rgba(C_UP,.08), tension:0 },
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12} },
        tooltip: { mode:'index', callbacks:{ label: ctx => ctx.dataset.label+': '+(ctx.raw==null?'–':Math.round(ctx.raw).toLocaleString('fr-FR')+' MWh') } },
        zoom: ZOOM_CFG,
      },
      scales: {
        x: { grid:GRID_NONE, ticks:{color:C_TX3, maxTicksLimit:14, font:{size:9}} },
        y: { grid:GRID, ticks:{color:C_TX3, callback:v=>(v/1000).toFixed(0)+'k'} }
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-auct-vol-canvas'); addDownload('go-auct-vol-canvas','go-auctions-volume'); },100);
}

// ── GO HISTORY PAGE
function filterGoH(f, btn) {
  goHistFilter = f;
  document.querySelectorAll('#go-hist-filter .day-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  drawGoHist(); drawGoWoW(); drawGoBox();
}
function setGoHistPeriod(n, btn) {
  goHistPeriod = n;
  document.querySelectorAll('#go-hist-period .day-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  drawGoHist(); drawGoWoW(); drawGoBox();
}
function drawGoHist() {
  const hist = getGOHistory();
  const n = goHistPeriod;
  const filter = goHistFilter;
  const active = filter === 'all'
    ? Object.entries(hist)
    : Object.entries(hist).filter(([k]) => k === filter);
  if (!active.length) { goNoData('go-hist-canvas', 'Aucune donnée Commerg chargée'); return; }

  const sample = active[0][1];
  let labels;
  if (sample && sample.dates) {
    const len = sample.dates.length, take = Math.min(n, len), from = len - take;
    const dts = sample.dates.slice(from);
    labels = dts.map(d => fmtGoDate(d));
  } else { labels = []; }

  const datasets = active.map(([k, s]) => ({
    label: GO_SERIES[k]?.l.replace('GO AIB ','').replace('GO ','') || k,
    data: s.data.slice(-n),
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
        tooltip:{ mode:'index', callbacks:{label:ctx=>ctx.dataset.label+': '+(ctx.raw==null?'–':ctx.raw.toFixed(4)+' €/MWh')} },
        zoom: ZOOM_CFG,
      },
      scales: {
        x:{ grid:GRID, ticks:{color:C_TX3, maxTicksLimit:12} },
        y:{ grid:GRID, ticks:{color:C_TX3, callback:v=>v.toFixed(3)+'€'} }
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-hist-canvas'); addDownload('go-hist-canvas','go-history'); },100);
}

function drawGoWoW() {
  const hist = getGOHistory();
  const key = goHistFilter === 'all' ? 'renewable' : goHistFilter;
  const wk = hist[key];
  if (!wk || !wk.data || wk.data.length < 2) { goNoData('go-wow-canvas', 'Aucune donnée Commerg chargée'); return; }
  const n = Math.min(goHistPeriod, 52);
  const data = wk.data.slice(-n);
  // wk.dates lines up 1:1 with wk.data — was discarded here, leaving the
  // x-axis hidden entirely (scales.x.display:false) with synthetic "W0,W1…"
  // labels that didn't even correspond to real calendar weeks. A bar chart
  // with no x-axis gives no way to tell which week any given bar is.
  const dates = (wk.dates || []).slice(-n);
  const deltaDates = dates.slice(1);
  const deltas = data.slice(1).map((v,i) => +(v - data[i]).toFixed(4));
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
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>(ctx.raw>=0?'+':'')+ctx.raw.toFixed(4)+' €/MWh'}}, zoom:ZOOM_CFG },
      scales:{ x:{grid:GRID_NONE, ticks:{color:C_TX3, maxTicksLimit:10, font:{size:9}}}, y:{grid:GRID, ticks:{color:C_TX3,callback:v=>v.toFixed(3)+'€'}} }
    }
  });
  setTimeout(()=>{ addFullscreen('go-wow-canvas'); },100);
}

function drawGoBox() {
  const hist = getGOHistory();
  const key = goHistFilter === 'all' ? 'renewable' : goHistFilter;
  const wk = hist[key];
  if (!wk || !wk.data || !wk.data.length) { goNoData('go-box-canvas', 'Aucune donnée Commerg chargée'); return; }
  const data = wk.data.slice(-goHistPeriod);
  const dates = (wk.dates || []).slice(-goHistPeriod);
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
  const q = (arr,p) => { const ch=arr.slice().sort((a,b)=>a-b); return ch.length?+ch[Math.floor(ch.length*p)].toFixed(4):null; };
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
      { label:'Médiane', data:medians, backgroundColor:col, borderWidth:0, borderRadius:2, barThickness:4 },
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12}}, tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+(ctx.raw==null?'–':(Array.isArray(ctx.raw)?ctx.raw[0].toFixed(4)+'–'+ctx.raw[1].toFixed(4):ctx.raw.toFixed(4))+' €/MWh')}} },
      scales:{ x:{grid:GRID_NONE, ticks:{color:C_TX3, font:{size:9}}}, y:{grid:GRID, ticks:{color:C_TX3,callback:v=>v.toFixed(3)+'€'}, beginAtZero:false} }
    }
  });
  setTimeout(()=>{ addFullscreen('go-box-canvas'); },100);
}
