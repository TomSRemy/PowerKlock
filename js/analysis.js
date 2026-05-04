// ── RENEWABLES
let renTab = 'today';
let renTech = 'both';

function setRenTab(t, btn) {
  renTab = t;
  document.querySelectorAll('#page-renewables .day-tabs .day-tab').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  drawRenChart();
}

function setRenTech(tech, btn) {
  renTech = tech;
  document.querySelectorAll('#page-renewables .page-header .day-tab').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  drawRenChart();
  drawRenCaptureChart();
  renderRenSummaryTable();
}

function loadRenewables() {
  const country = document.getElementById('ren-country').value;
  const mix = (window._genmixData && window._genmixData[country]) || GM_DEMO[country] || GM_DEMO.FR;
  const renData = window._renData && window._renData[country];
  const curHr = new Date().getHours();

  const windOn  = renData?.windOnshoreNow  || mix.wind * 0.7;
  const solar   = renData?.solarNow        || mix.solar;
  const feW     = renData?.windErrorPct    || 5.2;
  const feS     = renData?.solarErrorPct   || -8.1;

  // Demo spot prices for M0 calculation
  const spotPrices = window._pricesSorted?.find(z=>z.code===country)?.hourly || gen96(45, -10, 120, 2);
  // Demo hourly wind/solar generation
  const wOnP  = [.3,.26,.24,.22,.22,.28,.35,.40,.42,.44,.45,.46,.47,.45,.44,.42,.40,.38,.37,.36,.34,.32,.31,.30];
  const sP    = [0,0,0,0,0,.02,.08,.2,.35,.5,.65,.78,.88,.92,.9,.82,.65,.45,.25,.1,.02,0,0,0];
  const windHourly  = wOnP.map(p=>Math.round((mix.wind||5500)*p*(0.9+Math.random()*.2)));
  const solarHourly = sP.map(p=>Math.round((mix.solar||11000)*p*(0.9+Math.random()*.15)));

  // M0 capture rate: WAP = Σ(MW×Spot) / Σ(MW)
  const calcM0 = (genH, spotH) => {
    const n = Math.min(genH.length, spotH.length);
    const sumGen = genH.slice(0,n).reduce((a,b)=>a+b,0);
    const sumWAP = genH.slice(0,n).reduce((a,v,i)=>a+v*spotH[i],0);
    return sumGen > 0 ? sumWAP/sumGen : 0;
  };
  const baseload = spotPrices.slice(0, Math.min(24,spotPrices.length)).reduce((a,b)=>a+b,0) / Math.min(24,spotPrices.length);
  const m0Wind  = calcM0(windHourly,  spotPrices.slice(0,24));
  const m0Solar = calcM0(solarHourly, spotPrices.slice(0,24));
  const m0WPct  = baseload ? m0Wind/baseload*100  : 0;
  const m0SPct  = baseload ? m0Solar/baseload*100 : 0;

  const kv = v => `${(v/1000).toFixed(1)}<span class="kpi-unit">GW</span>`;
  const setEl = (id,html) => { const el=document.getElementById(id); if(el) el.innerHTML=html; };
  setEl('ren-wind-on',    kv(windOn));
  setEl('ren-solar-now',  kv(solar));
  setEl('ren-wind-on-sub', `<span style="color:var(--tx3)">onshore · ${(windOn*0.3/1000).toFixed(1)} GW offshore</span>`);
  setEl('ren-solar-sub',  `<span style="color:var(--tx3)">peak @${sP.indexOf(Math.max(...sP))}h</span>`);
  setEl('ren-m0-wind',    `${m0WPct.toFixed(0)}<span class="kpi-unit">%</span>`);
  setEl('ren-m0-solar',   `${m0SPct.toFixed(0)}<span class="kpi-unit">%</span>`);
  setEl('ren-m0-wind-sub',  `<span class="${m0WPct>=100?'up':'down'}">WAP ${m0Wind.toFixed(1)} €/MWh vs BL ${baseload.toFixed(1)}</span>`);
  setEl('ren-m0-solar-sub', `<span class="${m0SPct>=100?'up':'down'}">WAP ${m0Solar.toFixed(1)} €/MWh</span>`);
  setEl('ren-fe-wind',    `<span style="color:${feW>0?'var(--down)':'var(--up)'}">${feW>0?'+':''}${feW.toFixed(1)}%</span>`);
  setEl('ren-fe-solar',   `<span style="color:${feS<0?'var(--up)':'var(--down)'}">${feS.toFixed(1)}%</span>`);
  document.getElementById('ren-upd').textContent = renData ? 'ENTSO-E A69/A71 · JSON' : 'Demo · ENTSO-E A69/A71';

  drawRenChart();
  renderRenSummaryTable();
  drawRenCaptureChart();
}

function renderRenSummaryTable() {
  const tbody = document.getElementById('ren-summary-tbody');
  if (!tbody) return;
  const country = document.getElementById('ren-country')?.value || 'FR';
  const mix = GM_DEMO[country] || GM_DEMO.FR;
  // Demo periods — in real implementation would use historical JSON
  const periods = [
    { label:'Last 30D',  windGW: (mix.wind*0.65/1000).toFixed(1), windM0:+(45+Math.random()*15).toFixed(1), windBL:+(90+Math.random()*10).toFixed(0), solarGW:(mix.solar*0.30/1000).toFixed(1), solarM0:+(30+Math.random()*20).toFixed(1), solarBL:+(65+Math.random()*15).toFixed(0) },
    { label:'Last 90D',  windGW: (mix.wind*0.60/1000).toFixed(1), windM0:+(48+Math.random()*12).toFixed(1), windBL:+(92+Math.random()*8).toFixed(0),  solarGW:(mix.solar*0.28/1000).toFixed(1), solarM0:+(35+Math.random()*18).toFixed(1), solarBL:+(70+Math.random()*12).toFixed(0) },
    { label:'Last 365D', windGW: (mix.wind*0.58/1000).toFixed(1), windM0:+(50+Math.random()*10).toFixed(1), windBL:+(88+Math.random()*8).toFixed(0),  solarGW:(mix.solar*0.20/1000).toFixed(1), solarM0:+(38+Math.random()*15).toFixed(1), solarBL:+(72+Math.random()*10).toFixed(0) },
    { label:'YTD',       windGW: (mix.wind*0.62/1000).toFixed(1), windM0:+(47+Math.random()*13).toFixed(1), windBL:+(91+Math.random()*9).toFixed(0),  solarGW:(mix.solar*0.25/1000).toFixed(1), solarM0:+(33+Math.random()*17).toFixed(1), solarBL:+(68+Math.random()*13).toFixed(0) },
  ];
  tbody.innerHTML = periods.map(p => {
    const wc = p.windBL>=100?'up':'down', sc = p.solarBL>=100?'up':'down';
    return `<tr>
      <td style="font-weight:600">${p.label}</td>
      <td style="font-family:'JetBrains Mono',monospace">${p.windGW}</td>
      <td style="font-family:'JetBrains Mono',monospace">${p.windM0}</td>
      <td><span class="${wc}" style="font-family:'JetBrains Mono',monospace">${p.windBL}%</span></td>
      <td style="font-family:'JetBrains Mono',monospace">${p.solarGW}</td>
      <td style="font-family:'JetBrains Mono',monospace">${p.solarM0}</td>
      <td><span class="${sc}" style="font-family:'JetBrains Mono',monospace">${p.solarBL}%</span></td>
    </tr>`;
  }).join('');
}

function drawRenCaptureChart() {
  const canvas = document.getElementById('ren-cap-canvas');
  if (!canvas) return;
  const w = HIST.windows['ren-cap'] || '365D';
  const n = w==='30D'?30 : w==='90D'?90 : w==='YTD'?new Date().getDayOfYear?.()??120 : w==='all'?730 : 365;
  const labels = Array.from({length:Math.min(n,365)}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate()-n+i);
    return i%(Math.round(n/8))===0 ? d.toLocaleDateString('en-GB',{month:'short',day:'numeric'}) : '';
  });
  const nPts = labels.length;
  const windM0  = Array.from({length:nPts}, (_,i) => +(80+15*Math.sin(i/nPts*Math.PI*4)+(Math.random()-.5)*8).toFixed(1));
  const solarM0 = Array.from({length:nPts}, (_,i) => +(65+20*Math.sin(i/nPts*Math.PI*4-1)+(Math.random()-.5)*10).toFixed(1));
  const datasets = [];
  if (renTech==='wind'||renTech==='both') datasets.push({ label:'Wind M0/BL (%)', data:windM0, borderColor:C_WIND, borderWidth:1.5, pointRadius:0, tension:0.2, fill:false });
  if (renTech==='solar'||renTech==='both') datasets.push({ label:'Solar M0/BL (%)', data:solarM0, borderColor:C_SOLAR, borderWidth:1.5, pointRadius:0, tension:0.2, fill:false });
  datasets.push({ label:'Par (100%)', data:Array(nPts).fill(100), borderColor:'rgba(255,255,255,.2)', borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false });

  mkHistChart('ren-cap-canvas', {
    type:'line', data:{labels,datasets},
    options:{
      ...baseOptions('%'),
      plugins:{
        legend:{display:true,labels:{color:_HIST_TX3,font:{size:10},boxWidth:12,usePointStyle:true,pointStyle:'line'}},
        tooltip:{mode:'index',intersect:false,callbacks:{label:ctx=>` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%`}},
      }
    }
  });
}


function drawRenChart() {
  const countryEl = document.getElementById('ren-country');
  const country = countryEl ? countryEl.value : 'FR';
  const mix = (window._genmixData && window._genmixData[country]) || GM_DEMO[country] || GM_DEMO.FR;
  const renData = window._renData && window._renData[country];

  const wOnP=[.3,.26,.24,.22,.22,.28,.35,.40,.42,.44,.45,.46,.47,.45,.44,.42,.40,.38,.37,.36,.34,.32,.31,.30];
  const wOffP=[.5,.45,.43,.42,.42,.46,.55,.62,.65,.68,.70,.72,.74,.71,.70,.68,.65,.62,.60,.58,.56,.54,.52,.51];
  const sP=[0,0,0,0,0,.02,.08,.2,.35,.5,.65,.78,.88,.92,.9,.82,.65,.45,.25,.1,.02,0,0,0];
  const hours = Array.from({length:24},(_,i)=>i+'h');

  // Data sources -- JSON if available, demo otherwise
  let wOnA, wOffA, sA, wOnF, wOffF, sF, wE, sE;

  if (renData && renData.windActual && renData.windActual.some(v=>v>0)) {
    wOnA  = renData.windOnshoreActual  || renData.windActual.map(v=>Math.round(v*0.7));
    wOffA = renData.windOffshoreActual || renData.windActual.map(v=>Math.round(v*0.3));
    sA    = renData.solarActual || sP.map(v=>Math.round((mix.solar||10000)*v));
    wOnF  = renData.windOnshoreForecast  || wOnA.map(v=>Math.round(v*(1+(Math.random()-.5)*.1)));
    wOffF = renData.windOffshoreForecast || wOffA.map(v=>Math.round(v*(1+(Math.random()-.5)*.1)));
    sF    = renData.solarForecast || sA.map(v=>Math.round(v*(1+(Math.random()-.5)*.1)));
    wE    = renData.windError || wOnA.map((v,i)=>v+wOffA[i]-wOnF[i]-wOffF[i]);
    sE    = renData.solarError || sA.map((v,i)=>v-sF[i]);
  } else {
    wOnA  = wOnP.map(v=>Math.round((mix.wind||5500)*0.7*v*(0.9+Math.random()*.2)));
    wOffA = wOffP.map(v=>Math.round((mix.wind||5500)*0.3*v*(0.9+Math.random()*.15)));
    sA    = sP.map(v=>Math.round((mix.solar||11000)*v*(0.9+Math.random()*.15)));
    wOnF  = wOnA.map(v=>Math.round(v*(1+(Math.random()-.5)*.12)));
    wOffF = wOffA.map(v=>Math.round(v*(1+(Math.random()-.5)*.1)));
    sF    = sA.map(v=>Math.round(v*(1+(Math.random()-.5)*.12)));
    wE    = wOnA.map((v,i)=>v+wOffA[i]-wOnF[i]-wOffF[i]);
    sE    = sA.map((v,i)=>v-sF[i]);
  }

  // History: 7 days
  const histWOn  = Array.from({length:168},(_,i)=>Math.round(wOnA[i%24]*(0.85+Math.random()*.3)));
  const histWOff = Array.from({length:168},(_,i)=>Math.round(wOffA[i%24]*(0.85+Math.random()*.25)));
  const histS    = Array.from({length:168},(_,i)=>Math.round(sA[i%24]*(0.85+Math.random()*.2)));

  let datasets = [], labels = hours, type = 'line';
  const C_WIND_OFF = '#93c5fd'; // lighter blue for offshore

  if (renTab === 'today') {
    datasets = [
      { label:'Wind Onshore', data:wOnA, borderColor:C_WIND, borderWidth:2, pointRadius:0, fill:true, backgroundColor:rgba(C_WIND,.12), tension:0.3 },
      { label:'Wind Offshore', data:wOffA, borderColor:C_WIND_OFF, borderWidth:2, pointRadius:0, fill:true, backgroundColor:rgba(C_WIND_OFF,.1), tension:0.3 },
      { label:'Solar', data:sA, borderColor:C_SOLAR, borderWidth:2, pointRadius:0, fill:true, backgroundColor:rgba(C_SOLAR,.1), tension:0.3 },
    ];
  } else if (renTab === 'forecast') {
    datasets = [
      { label:'Wind Onshore actual', data:wOnA, borderColor:C_WIND, borderWidth:2, pointRadius:0, fill:false, tension:0.3 },
      { label:'Wind Onshore fc.', data:wOnF, borderColor:C_WIND, borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false, tension:0.3 },
      { label:'Wind Offshore actual', data:wOffA, borderColor:C_WIND_OFF, borderWidth:2, pointRadius:0, fill:false, tension:0.3 },
      { label:'Wind Offshore fc.', data:wOffF, borderColor:C_WIND_OFF, borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false, tension:0.3 },
      { label:'Solar actual', data:sA, borderColor:C_SOLAR, borderWidth:2, pointRadius:0, fill:false, tension:0.3 },
      { label:'Solar fc.', data:sF, borderColor:C_SOLAR, borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false, tension:0.3 },
    ];
  } else if (renTab === 'error') {
    type = 'bar';
    const wE_total = wOnA.map((v,i)=>v+wOffA[i]-wOnF[i]-wOffF[i]);
    datasets = [
      { label:'Wind error (MW)', data:wE_total, backgroundColor:wE_total.map(v=>v>=0?rgba(C_WIND,.7):rgba(C_DN,.7)), borderWidth:0, borderRadius:2 },
      { label:'Solar error (MW)', data:sE, backgroundColor:sE.map(v=>v>=0?rgba(C_SOLAR,.7):rgba(C_DN,.7)), borderWidth:0, borderRadius:2 },
    ];
  } else {
    labels = Array.from({length:168},(_,i)=>{const d=Math.floor(i/24);return i%24===0?['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]:'';});
    datasets = [
      { label:'Wind Onshore', data:histWOn, borderColor:C_WIND, borderWidth:1.5, pointRadius:0, fill:false, tension:0.2 },
      { label:'Wind Offshore', data:histWOff, borderColor:C_WIND_OFF, borderWidth:1.5, pointRadius:0, fill:false, tension:0.2 },
      { label:'Solar', data:histS, borderColor:C_SOLAR, borderWidth:1.5, pointRadius:0, fill:false, tension:0.2 },
    ];
  }

  mkChart('ren-canvas', {
    type, data:{ labels, datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:10} },
        tooltip:{ mode:'index', callbacks:{ label:ctx=>ctx.dataset.label+': '+(ctx.raw/1000).toFixed(2)+' GW' } },
        zoom:ZOOM_CFG,
      },
      scales:{
        x:{ grid:GRID, ticks:{color:C_TX3, maxTicksLimit:8} },
        y:{ grid:GRID, ticks:{color:C_TX3, callback:v=>(v/1000).toFixed(1)+'GW'}, beginAtZero:true }
      }
    }
  });
  setTimeout(()=>{ addFullscreen('ren-canvas'); addDownload('ren-canvas','renewables'); },100);
}
function drawRenChart() {
  const countryEl = document.getElementById('ren-country');
  const country = countryEl ? countryEl.value : 'FR';
  const mix = (window._genmixData && window._genmixData[country]) || GM_DEMO[country] || GM_DEMO.FR;
  const renData = window._renData && window._renData[country];

  const wP=[.4,.35,.33,.32,.32,.38,.45,.52,.55,.58,.6,.62,.63,.61,.6,.58,.55,.52,.5,.48,.47,.45,.43,.41];
  const sP=[0,0,0,0,0,.02,.08,.2,.35,.5,.65,.78,.88,.92,.9,.82,.65,.45,.25,.1,.02,0,0,0];
  const hours = Array.from({length:24},(_,i)=>i+'h');

  let wA, sA, wF, sF, wE, sE, histW, histS;

  if (renData && renData.windActual && renData.windActual.length > 0) {
    // Real JSON data
    wA = renData.windActual;
    sA = renData.solarActual || sP.map(v=>(mix.solar||10000)*v);
    wF = renData.windForecast || wA.map(v=>v*(1+(Math.random()-.5)*.1));
    sF = renData.solarForecast || sA.map(v=>v*(1+(Math.random()-.5)*.1));
    wE = renData.windError || wA.map((v,i)=>v-(wF[i]||v));
    sE = renData.solarError || sA.map((v,i)=>v-(sF[i]||v));
    // History: repeat actual 7 times with noise
    histW = Array.from({length:168},(_,i)=>wA[i%24]*(0.85+Math.random()*.3));
    histS = Array.from({length:168},(_,i)=>sA[i%24]*(0.85+Math.random()*.2));
  } else {
    // Demo data
    wA = wP.map(v=>(mix.wind||5000)*v*(0.9+Math.random()*.2));
    sA = sP.map(v=>(mix.solar||10000)*v*(0.9+Math.random()*.15));
    wF = wA.map(v=>v*(1+(Math.random()-.5)*.15));
    sF = sA.map(v=>v*(1+(Math.random()-.5)*.15));
    wE = wA.map((v,i)=>v-wF[i]);
    sE = sA.map((v,i)=>v-sF[i]);
    histW = Array.from({length:168},(_,i)=>(mix.wind||5000)*wP[i%24]*(0.85+Math.random()*.3));
    histS = Array.from({length:168},(_,i)=>(mix.solar||10000)*sP[i%24]*(0.85+Math.random()*.2));
  }

  // Validate data is non-zero
  const hasData = wA.some(v => v > 0) || sA.some(v => v > 0);
  if (!hasData) {
    wA = wP.map(v=>(mix.wind||5500)*v);
    sA = sP.map(v=>(mix.solar||11000)*v);
  }

  let datasets = [];
  let labels = hours;
  let type = 'line';

  if (renTab === 'today') {
    datasets = [
      { label:'Wind actual', data:wA, borderColor:C_WIND, borderWidth:2, pointRadius:0, fill:true,
        backgroundColor:rgba(C_WIND,.1), tension:0.3 },
      { label:'Solar actual', data:sA, borderColor:C_SOLAR, borderWidth:2, pointRadius:0, fill:true,
        backgroundColor:rgba(C_SOLAR,.1), tension:0.3 },
    ];
  } else if (renTab === 'forecast') {
    datasets = [
      { label:'Wind actual', data:wA, borderColor:C_WIND, borderWidth:2, pointRadius:0, fill:false, tension:0.3 },
      { label:'Wind forecast', data:wF, borderColor:C_WIND, borderWidth:1.5, borderDash:[4,4], pointRadius:0, fill:false, tension:0.3 },
      { label:'Solar actual', data:sA, borderColor:C_SOLAR, borderWidth:2, pointRadius:0, fill:false, tension:0.3 },
      { label:'Solar forecast', data:sF, borderColor:C_SOLAR, borderWidth:1.5, borderDash:[4,4], pointRadius:0, fill:false, tension:0.3 },
    ];
  } else if (renTab === 'error') {
    type = 'bar';
    datasets = [
      { label:'Wind error (MW)', data:wE, backgroundColor: wE.map(v=>v>=0?rgba(C_WIND,.7):rgba(C_DN,.7)), borderWidth:0, borderRadius:2 },
      { label:'Solar error (MW)', data:sE, backgroundColor: sE.map(v=>v>=0?rgba(C_SOLAR,.7):rgba(C_DN,.7)), borderWidth:0, borderRadius:2 },
    ];
  } else { // history
    labels = Array.from({length:168},(_,i)=>{const d=Math.floor(i/24);const h=i%24;return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]+(h===0?' 0h':'');});
    datasets = [
      { label:'Wind', data:histW, borderColor:C_WIND, borderWidth:1.5, pointRadius:0, fill:false, tension:0.2 },
      { label:'Solar', data:histS, borderColor:C_SOLAR, borderWidth:1.5, pointRadius:0, fill:false, tension:0.2 },
    ];
  }

  mkChart('ren-canvas', {
    type,
    data: { labels, datasets },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12} },
        tooltip: { mode:'index', callbacks:{ label: ctx => ctx.dataset.label+': '+(ctx.raw/1000).toFixed(2)+' GW' } },
        zoom: ZOOM_CFG,
        annotation:{ annotations:{ nowline:{ type:'line', xMin:new Date().getHours(), xMax:new Date().getHours(), borderColor:'rgba(255,220,100,.7)', borderWidth:1.5, borderDash:[4,3], label:{ display:true, content:'NOW', position:'start', color:'rgba(255,220,100,.9)', font:{size:9,weight:'600'}, backgroundColor:'transparent', padding:2 } } } },
      },
      scales: {
        x: { grid:GRID, ticks:{color:C_TX3, maxTicksLimit:8} },
        y: { grid:GRID, ticks:{color:C_TX3, callback:v=>(v/1000).toFixed(1)+'GW'}, beginAtZero:true }
      }
    }
  });
  setTimeout(()=>{ addFullscreen('ren-canvas'); addDownload('ren-canvas','renewables'); },100);
}


function renderRenErrorTable(mix) {
  const wP=[.4,.35,.33,.32,.32,.38,.45,.52,.55,.58,.6,.62,.63,.61,.6,.58,.55,.52,.5,.48,.47,.45,.43,.41];
  const sP=[0,0,0,0,0,.02,.08,.2,.35,.5,.65,.78,.88,.92,.9,.82,.65,.45,.25,.1,.02,0,0,0];
  const rows=Array.from({length:24},(_,hr)=>{
    const wA=Math.round((mix.wind||5000)*wP[hr]*(0.9+Math.random()*.2));
    const wF=Math.round(wA*(1+(Math.random()-.5)*.15));
    const sA=Math.round((mix.solar||10000)*sP[hr]*(0.9+Math.random()*.15));
    const sF=Math.round(sA*(1+(Math.random()-.5)*.15));
    const wE=wA-wF, sE=sA-sF;
    const wPct=wF?((wE/wF)*100).toFixed(1):'-';
    const sPct=sF?((sE/sF)*100).toFixed(1):'-';
    const ec=v=>Math.abs(+v)>10?'color:var(--warn)':'color:var(--text3)';
    const wCol = wE > 200 ? 'var(--down)' : wE < -200 ? 'var(--up)' : 'var(--text3)';
    const sCol = sE > 500 ? 'var(--down)' : sE < -500 ? 'var(--up)' : 'var(--text3)';
    return '<tr>' +
      '<td style="color:var(--text2)">' + hr + ':00</td>' +
      '<td>' + wA.toLocaleString() + '</td>' +
      '<td style="color:var(--text3)">' + wF.toLocaleString() + '</td>' +
      '<td style="color:' + wCol + '">' + (wE > 0 ? '+' : '') + wE.toLocaleString() + '</td>' +
      '<td style="' + ec(wPct) + '">' + wPct + '%</td>' +
      '<td>' + sA.toLocaleString() + '</td>' +
      '<td style="color:var(--text3)">' + sF.toLocaleString() + '</td>' +
      '<td style="color:' + sCol + '">' + (sE > 0 ? '+' : '') + sE.toLocaleString() + '</td>' +
      '<td style="' + ec(sPct) + '">' + sPct + '%</td>' +
      '</tr>';
  });
  document.getElementById('ren-err-tbody').innerHTML = rows.join('');
}

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
    'spot':   renderHistSpot,
    'spread': renderHistSpread,
    'neg':    renderHistNeg,
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
var _HIST_TX3  = '#4a6280';
var _HIST_ACC  = '#00d4a8';
var _HIST_WARN = '#e8a020';
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
        { label: '30D avg', data: roll30, type: 'line', borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, tension: 0, spanGaps: true, fill: false, borderDash: [4,3], order:0 },
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
        { label:'365d rolling', data: roll365, borderColor:'#f59e0b', borderWidth:2.5, pointRadius:0, tension:0, spanGaps:true, order:1 },
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

