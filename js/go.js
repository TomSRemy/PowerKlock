// ── GO DATA
const GO_SERIES = {
  renewable: {l:'GO AIB Renewable', c:'#a78bfa', b25:.46,a25:.49,b26:.45,a26:.48,b27:.42,a27:.45,b28:.40,a28:.43,d:-.015},
  wind:      {l:'GO AIB Wind',      c:'#60a5fa', b25:.52,a25:.56,b26:.51,a26:.55,b27:.48,a27:.52,b28:.45,a28:.49,d:-.020},
  solar:     {l:'GO AIB Solar',     c:'#f59e0b', b25:.39,a25:.42,b26:.38,a26:.41,b27:.35,a27:.38,b28:.33,a28:.36,d:-.010},
  hydro:     {l:'GO AIB Hydro',     c:'#34d399', b25:.50,a25:.54,b26:.49,a26:.53,b27:.46,a27:.50,b28:.44,a28:.48,d:-.020},
  ireland:   {l:'GO Ireland Wind',  c:'#f472b6', b25:.28,a25:.32,b26:.27,a26:.31,b27:.25,a27:.29,b28:.23,a28:.27,d:-.010},
};

// Generate weekly history — realistic Commerg-style data (2022-Q3 → 2026-Q2)
function goGenHistory(series, n) {
  const out = {};
  Object.entries(series).forEach(([k,s]) => {
    const mid = (s.b26 + s.a26) / 2;
    // Price started higher in 2022 (~1.2€) collapsed to current ~0.45€
    const data = Array.from({length:n}, (_,i) => {
      const pct = i / (n-1);
      const baseLevel = 1.2 - pct * (1.2 - mid) + 0.05 * Math.sin(i/12*Math.PI);
      const noise = (Math.random()-.5) * 0.04;
      return Math.max(0.05, baseLevel + noise);
    });
    out[k] = { ...s, data };
  });
  return out;
}
let GO_HISTORY = null;
let goHistPeriod = 130;
let goHistFilter = 'all';
let goProd = 'GO AIB Renewable';

function getGOHistory() {
  if (!GO_HISTORY) GO_HISTORY = goGenHistory(GO_SERIES, 208);
  return GO_HISTORY;
}

// ── GO PRICES PAGE (= chart_go_price_indications + chart_go_cal1 + go_kpi)
function renderGO() {
  renderGOKPIs();
  renderGOFwdTable();
  drawGoIndicChart();
  drawGoCalChart();
  drawGoSpreadChart();
}

function setGoProd(prod, btn) {
  goProd = prod;
  document.querySelectorAll('#go-prod-tabs .day-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('go-indic-title').textContent = prod + ' — Prix indicatifs hebdo (€/MWh)';
  renderGOKPIs();
  drawGoIndicChart();
  drawGoCalChart();
  drawGoSpreadChart();
}

function renderGOKPIs() {
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const s = GO_SERIES[key];
  const mid = (s.b26 + s.a26) / 2;
  const spread = s.a26 - s.b26;
  const strip = document.getElementById('go-kpi-strip');
  if (!strip) return;
  strip.innerHTML = [
    {l:'Dernier Bid', v:s.b26.toFixed(4)+' €', sub:'Cal-26', cls:'up'},
    {l:'Dernier Ask', v:s.a26.toFixed(4)+' €', sub:'Cal-26', cls:'down'},
    {l:'Mid Price',   v:mid.toFixed(4)+' €',   sub:'Cal-26', cls:''},
    {l:'Delta WoW',   v:(s.d>=0?'+':'')+s.d.toFixed(4)+' €', sub:'vs semaine préc.', cls:s.d>=0?'up':'down'},
  ].map(k => `<div class="kpi-card">
    <div class="kpi-label">${k.l}</div>
    <div class="kpi-value ${k.cls}" style="font-size:17px">${k.v}</div>
    <div class="kpi-chg" style="color:var(--text3)">${k.sub}</div>
  </div>`).join('');
}

// chart_go_price_indications : courbe bid/ask historique
function drawGoIndicChart() {
  const hist = getGOHistory();
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const s = GO_SERIES[key];
  const n = goHistPeriod;
  const rawMid = hist[key].data.slice(-n);
  const halfSp = (s.a26 - s.b26) / 2;
  const bids = rawMid.map(v => Math.max(0.01, v - halfSp*(0.9+Math.random()*.2)));
  const asks = rawMid.map(v => v + halfSp*(0.9+Math.random()*.2));
  const mids = rawMid;

  const quarters = ['Q3 22','Q4 22','Q1 23','Q2 23','Q3 23','Q4 23','Q1 24','Q2 24','Q3 24','Q4 24','Q1 25','Q2 25','Q3 25','Q4 25','Q1 26','Q2 26'];
  const labels = Array.from({length:n}, (_,i) => {
    const qi = Math.round(i*(quarters.length-1)/(n-1));
    return i % Math.floor(n/quarters.length) === 0 ? quarters[qi] : '';
  });

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
        tooltip: { mode:'index', callbacks:{ label: ctx => ctx.dataset.label+': '+ctx.raw.toFixed(4)+' €/MWh' } },
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


// chart_go_cal1 : grouped bar forward curve
function drawGoCalChart() {
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const s = GO_SERIES[key];
  const cals = ['Cal-25','Cal-26','Cal-27','Cal-28'];
  const bids = [s.b25, s.b26, s.b27, s.b28];
  const asks = [s.a25, s.a26, s.a27, s.a28];

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
        tooltip:{ callbacks:{ label: ctx => ctx.dataset.label+': '+ctx.raw.toFixed(4)+' €/MWh' } },
      },
      scales: {
        x: { grid:GRID_NONE, ticks:{color:C_TX3} },
        y: { grid:GRID, ticks:{color:C_TX3, callback:v=>v.toFixed(3)+'€'}, beginAtZero:false }
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-cal-canvas'); addDownload('go-cal-canvas','go-forward'); },100);
}


// Spread chart
function drawGoSpreadChart() {
  const hist = getGOHistory();
  const key = Object.keys(GO_SERIES).find(k => GO_SERIES[k].l === goProd) || 'renewable';
  const s = GO_SERIES[key];
  const n = goHistPeriod;
  const halfSp = (s.a26 - s.b26) / 2;
  const spreads = hist[key].data.slice(-n).map(() => halfSp*2*(0.7+Math.random()*.6));
  const labels = Array.from({length:n},(_,i)=>i%13===0?'W'+(Math.floor(i/13)):'');

  mkChart('go-spread-canvas', {
    type: 'line',
    data: { labels, datasets:[{ label:'Spread Bid/Ask', data:spreads, borderColor:C_WARN, borderWidth:1.5,
      pointRadius:0, fill:true, backgroundColor:rgba(C_WARN,.1), tension:0.3 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>ctx.raw.toFixed(4)+' €/MWh'}}, zoom:ZOOM_CFG },
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

  const quarters = ['Q3 22','Q4 22','Q1 23','Q2 23','Q3 23','Q4 23','Q1 24','Q2 24','Q3 24','Q4 24','Q1 25','Q2 25','Q3 25','Q4 25','Q1 26','Q2 26'];
  const labels = Array.from({length:n}, (_,i) => {
    const qi = Math.round(i*(quarters.length-1)/(n-1));
    return i % Math.floor(n/quarters.length) === 0 ? quarters[qi] : '';
  });

  const datasets = active.map(([k, s]) => ({
    label: GO_SERIES[k]?.l.replace('GO AIB ','').replace('GO ','') || k,
    data: s.data.slice(-n),
    borderColor: GO_SERIES[k]?.c || '#888',
    borderWidth: 1.8,
    pointRadius: 0,
    fill: false,
    tension: 0.3,
  }));

  mkChart('go-hist-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{ display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12} },
        tooltip:{ mode:'index', callbacks:{label:ctx=>ctx.dataset.label+': '+ctx.raw.toFixed(4)+' €/MWh'} },
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
  const key = goHistFilter === 'all' ? 'renewable' : (goHistFilter in hist ? goHistFilter : 'renewable');
  const n = Math.min(goHistPeriod, 52);
  const data = hist[key].data.slice(-n);
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
      scales:{
        x:{display:false},
        y:{grid:GRID, ticks:{color:C_TX3,callback:v=>v.toFixed(3)+'€'}}
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-wow-canvas'); },100);
}

function drawGoBox() {
  const hist = getGOHistory();
  const key = goHistFilter === 'all' ? 'renewable' : (goHistFilter in hist ? goHistFilter : 'renewable');
  const data = hist[key].data.slice(-goHistPeriod);
  const chunks = 8, sz = Math.floor(data.length/chunks);
  const col = GO_SERIES[key]?.c || C_UP;

  // Approximate box plot with min/q1/med/q3/max bars
  const labels = Array.from({length:chunks},(_,i)=>'Q'+(i+1));
  const medians = Array.from({length:chunks}, (_,i) => {
    const ch = data.slice(i*sz,(i+1)*sz).sort((a,b)=>a-b);
    return +ch[Math.floor(ch.length*.5)].toFixed(4);
  });
  const q1s = Array.from({length:chunks}, (_,i) => {
    const ch = data.slice(i*sz,(i+1)*sz).sort((a,b)=>a-b);
    return +ch[Math.floor(ch.length*.25)].toFixed(4);
  });
  const q3s = Array.from({length:chunks}, (_,i) => {
    const ch = data.slice(i*sz,(i+1)*sz).sort((a,b)=>a-b);
    return +ch[Math.floor(ch.length*.75)].toFixed(4);
  });

  mkChart('go-box-canvas', {
    type: 'bar',
    data: { labels, datasets:[
      { label:'Q1-Q3 range', data:q3s.map((v,i)=>v-q1s[i]), backgroundColor:rgba(col,.25), borderWidth:1, borderColor:col, borderRadius:2 },
      { label:'Median', data:medians, backgroundColor:col, borderWidth:0, borderRadius:2, barThickness:4 },
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>ctx.raw.toFixed(4)+' €/MWh'}} },
      scales:{
        x:{grid:GRID_NONE, ticks:{color:C_TX3}},
        y:{grid:GRID, ticks:{color:C_TX3,callback:v=>v.toFixed(3)+'€'}, beginAtZero:false}
      }
    }
  });
  setTimeout(()=>{ addFullscreen('go-box-canvas'); },100);
}


