// ── GO DATA · product metadata only (label + colour). NO synthetic price fallback.
const GO_SERIES = {
  renewable: {l:'GO AIB Renewable', c:'#A87DC4'},
  wind:      {l:'GO AIB Wind',      c:'#C4A57B'},
  solar:     {l:'GO AIB Solar',     c:'#FBBF24'},
  hydro:     {l:'GO AIB Hydro',     c:'#94D2BD'},
  ireland:   {l:'GO Ireland Wind',  c:'#f472b6'},
};
let goHistPeriod = 130;
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
    const fwd = {};
    [2025,2026,2027,2028].forEach(y => {
      const cand = all.filter(r => r.year === y && r.bid != null)
                      .sort((a,b) => b.mailDate - a.mailDate)[0];
      if (cand) fwd[y] = { bid: cand.bid, ask: cand.ask };
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
    byKey[key] = { fwd, weekly, d };
  });
  return { byKey, asOf };
}
function loadGoData(text) {
  try {
    const rows = parseGoCSV(text);
    if (!rows.length) { console.warn('[go] CSV parsed but no rows'); return false; }
    GO_REAL = buildGoReal(rows);
    renderGOKPIs(); drawGoIndicChart(); drawGoCalChart(); drawGoSpreadChart();
    if (typeof renderGOFwdTable === 'function') renderGOFwdTable();
    if (document.getElementById('go-hist-canvas')) { drawGoHist(); drawGoWoW(); drawGoBox(); }
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
  if (!_goAutoTried) { _goAutoTried = true; autoloadGo(); }
  renderGOKPIs();
  if (typeof renderGOFwdTable === 'function') renderGOFwdTable();
  drawGoIndicChart();
  drawGoCalChart();
  drawGoSpreadChart();
}

function setGoProd(prod, btn) {
  goProd = prod;
  document.querySelectorAll('#go-prod-tabs .day-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('go-indic-title').textContent = prod + ' — Prix indicatifs hebdo · CAL+1 (€/MWh)';
  renderGOKPIs();
  drawGoIndicChart();
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

// chart_go_price_indications : bid/ask/mid hebdo (CAL+1)
function drawGoIndicChart() {
  const hist = getGOHistory();
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const wk = hist[key];
  if (!wk || !wk.bidArr) { goNoData('go-indic-canvas', 'Aucune donnée Commerg chargée'); return; }

  const n = goHistPeriod;
  const len = wk.data.length, take = Math.min(n, len), from = len - take;
  const bids = wk.bidArr.slice(from), asks = wk.askArr.slice(from), mids = wk.data.slice(from);
  const dates = wk.dates.slice(from);
  const every = Math.max(1, Math.ceil(take / 12));
  const labels = dates.map((d,i) => i % every === 0 ? fmtGoDate(d) : '');

  mkChart('go-indic-canvas', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Ask', data:asks, borderColor:C_DN, borderWidth:1.5, pointRadius:0, fill:false, tension:0.3 },
        { label:'Mid', data:mids, borderColor:rgba(C_TX2,.5), borderWidth:1, borderDash:[3,3], pointRadius:0, fill:false, tension:0.3 },
        { label:'Bid', data:bids, borderColor:C_UP, borderWidth:1.5, pointRadius:0,
          fill: { target:'+2', above:rgba(C_WIND,.08), below:rgba(C_WIND,.08) }, tension:0.3 },
      ]
    },
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
  setTimeout(()=>{ addFullscreen('go-indic-canvas'); addDownload('go-indic-canvas','go-prices'); },100);
}

// chart_go_cal1 : grouped bar forward curve (Cal-25 → Cal-28)
function drawGoCalChart() {
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const fwd = GO_REAL && GO_REAL.byKey[key] && GO_REAL.byKey[key].fwd;
  if (!fwd || !Object.keys(fwd).length) { goNoData('go-cal-canvas', 'Aucune donnée Commerg chargée'); return; }
  const cals = ['Cal-25','Cal-26','Cal-27','Cal-28'];
  const bids = [2025,2026,2027,2028].map(y => fwd[y] ? fwd[y].bid : null);
  const asks = [2025,2026,2027,2028].map(y => fwd[y] ? fwd[y].ask : null);

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
  const every = Math.max(1, Math.ceil(take / 8));
  const labels = dates.map((d,i) => i % every === 0 ? fmtGoDate(d) : '');

  mkChart('go-spread-canvas', {
    type: 'line',
    data: { labels, datasets:[{ label:'Spread Bid/Ask', data:spreads, borderColor:C_WARN, borderWidth:1.5,
      pointRadius:0, fill:true, backgroundColor:rgba(C_WARN,.1), tension:0.3 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>(ctx.raw==null?'–':ctx.raw.toFixed(4)+' €/MWh')}}, zoom:ZOOM_CFG },
      scales:{ x:{grid:GRID,ticks:{color:C_TX3,maxTicksLimit:8}}, y:{grid:GRID,ticks:{color:C_TX3,callback:v=>v.toFixed(4)+'€'},beginAtZero:true} }
    }
  });
  setTimeout(()=>{ addFullscreen('go-spread-canvas'); addDownload('go-spread-canvas','go-spread'); },100);
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
    const every = Math.max(1, Math.ceil(take / 12));
    labels = dts.map((d,i) => i % every === 0 ? fmtGoDate(d) : '');
  } else { labels = []; }

  const datasets = active.map(([k, s]) => ({
    label: GO_SERIES[k]?.l.replace('GO AIB ','').replace('GO ','') || k,
    data: s.data.slice(-n),
    borderColor: GO_SERIES[k]?.c || '#888',
    borderWidth: 1.8, pointRadius: 0, fill: false, tension: 0.3,
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
  const deltas = data.slice(1).map((v,i) => +(v - data[i]).toFixed(4));
  const labels = Array.from({length:deltas.length},(_,i)=>'W'+i);

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
      scales:{ x:{display:false}, y:{grid:GRID, ticks:{color:C_TX3,callback:v=>v.toFixed(3)+'€'}} }
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
  const chunks = 8, sz = Math.max(1, Math.floor(data.length/chunks));
  const col = GO_SERIES[key]?.c || C_UP;

  const labels = Array.from({length:chunks},(_,i)=>'Q'+(i+1));
  const q = (arr,p) => { const ch=arr.slice().sort((a,b)=>a-b); return ch.length?+ch[Math.floor(ch.length*p)].toFixed(4):null; };
  const medians = Array.from({length:chunks}, (_,i) => q(data.slice(i*sz,(i+1)*sz),.5));
  const q1s = Array.from({length:chunks}, (_,i) => q(data.slice(i*sz,(i+1)*sz),.25));
  const q3s = Array.from({length:chunks}, (_,i) => q(data.slice(i*sz,(i+1)*sz),.75));

  mkChart('go-box-canvas', {
    type: 'bar',
    data: { labels, datasets:[
      { label:'Q1-Q3 range', data:q3s.map((v,i)=>(v==null||q1s[i]==null)?null:v-q1s[i]), backgroundColor:rgba(col,.25), borderWidth:1, borderColor:col, borderRadius:2 },
      { label:'Median', data:medians, backgroundColor:col, borderWidth:0, borderRadius:2, barThickness:4 },
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>(ctx.raw==null?'–':ctx.raw.toFixed(4)+' €/MWh')}} },
      scales:{ x:{grid:GRID_NONE, ticks:{color:C_TX3}}, y:{grid:GRID, ticks:{color:C_TX3,callback:v=>v.toFixed(3)+'€'}, beginAtZero:false} }
    }
  });
  setTimeout(()=>{ addFullscreen('go-box-canvas'); },100);
}
