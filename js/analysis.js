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

