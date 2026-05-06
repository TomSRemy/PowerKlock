async function loadCrossBorder() {
  window._cbLoaded = true;
  const country = document.getElementById('cb-country').value;

  const demoFlows = {
    'FR':    [ { partner:'🇩🇪 Germany',      imports:450,  exports:3200 }, { partner:'🇧🇪 Belgium',       imports:800,  exports:2100 }, { partner:'🇪🇸 Spain',         imports:1200, exports:300  }, { partner:'🇮🇹 Italy',          imports:200,  exports:1800 }, { partner:'🇨🇭 Switzerland',   imports:600,  exports:2500 }, { partner:'🇬🇧 Great Britain', imports:900,  exports:400  } ],
    'DE_LU': [ { partner:'🇫🇷 France',       imports:3200, exports:450  }, { partner:'🇳🇱 Netherlands',  imports:2100, exports:1800 }, { partner:'🇧🇪 Belgium',       imports:900,  exports:1200 }, { partner:'🇦🇹 Austria',       imports:600,  exports:2800 }, { partner:'🇨🇭 Switzerland',   imports:800,  exports:1900 }, { partner:'🇨🇿 Czechia',       imports:400,  exports:1500 }, { partner:'🇵🇱 Poland',        imports:1100, exports:600  }, { partner:'🇩🇰 Denmark',       imports:1800, exports:400  } ],
    'BE':    [ { partner:'🇫🇷 France',       imports:2100, exports:800  }, { partner:'🇩🇪 Germany',      imports:1200, exports:900  }, { partner:'🇳🇱 Netherlands',  imports:600,  exports:1100 }, { partner:'🇬🇧 Great Britain', imports:400,  exports:200  } ],
    'ES':    [ { partner:'🇫🇷 France',       imports:300,  exports:1200 }, { partner:'🇵🇹 Portugal',     imports:800,  exports:1500 }, { partner:'🇲🇦 Morocco',       imports:100,  exports:400  } ],
    'NL':    [ { partner:'🇩🇪 Germany',      imports:1800, exports:2100 }, { partner:'🇧🇪 Belgium',      imports:1100, exports:600  }, { partner:'🇬🇧 Great Britain', imports:800,  exports:300  }, { partner:'🇩🇰 Denmark',       imports:400,  exports:200  } ],
    'GB':    [ { partner:'🇫🇷 France',       imports:400,  exports:900  }, { partner:'🇧🇪 Belgium',      imports:200,  exports:400  }, { partner:'🇳🇱 Netherlands',  imports:300,  exports:800  }, { partner:'🇮🇪 Ireland',       imports:100,  exports:300  } ],
  };

  const jsonFlows = window._cbData?.[country];
  const rawFlows  = jsonFlows || demoFlows[country] || demoFlows['FR'];
  const flows     = rawFlows.map(f => ({ ...f, net: f.imports - f.exports }));

  const names = { 'FR':'France','DE_LU':'Germany','BE':'Belgium','ES':'Spain','NL':'Netherlands','GB':'Great Britain' };
  const cname = names[country] || country;
  const el_title = document.getElementById('cb-title');
  if (el_title) el_title.textContent = `${cname} — Cross-Border Flows (avg MW)`;

  // KPIs
  const totalExp = flows.reduce((a,f)=>a+f.exports,0);
  const totalImp = flows.reduce((a,f)=>a+f.imports,0);
  const netPos   = totalExp - totalImp;
  const setKPI = (id,html)=>{ const el=document.getElementById(id); if(el) el.innerHTML=html; };
  setKPI('cb-kpi-exp', totalExp.toLocaleString()+'<span class="kpi-unit">MW</span>');
  setKPI('cb-kpi-imp', totalImp.toLocaleString()+'<span class="kpi-unit">MW</span>');
  setKPI('cb-kpi-net', `<span class="${netPos>=0?'up':'down'}">${netPos>=0?'+':''}${netPos.toLocaleString()}</span><span class="kpi-unit">MW</span>`);
  setKPI('cb-kpi-net-chg', netPos>=0 ? 'Net exporter' : 'Net importer');
  setKPI('cb-kpi-exp-chg', `${flows.length} borders`);
  setKPI('cb-kpi-imp-chg', `${flows.filter(f=>f.imports>f.exports).length} borders net import`);
  setKPI('cb-kpi-pairs', flows.length+'');

  // Bar chart: exports (positive) vs imports (negative) per partner
  const cbCanvas = document.getElementById('cb-chart-canvas');
  if (cbCanvas) {
    const cbLabels = flows.map(f => f.partner.split(' ').slice(1).join(' ')); // remove flag
    mkChart('cb-chart-canvas', {
      type:'bar',
      data:{ labels:cbLabels, datasets:[
        { label:'Exports MW', data:flows.map(f=>f.exports),      backgroundColor:'rgba(16,185,129,.65)',  borderWidth:0, borderRadius:3 },
        { label:'Imports MW', data:flows.map(f=>-f.imports),     backgroundColor:'rgba(240,80,96,.55)',   borderWidth:0, borderRadius:3 },
        { label:'Net MW',     data:flows.map(f=>f.net),          type:'line', borderColor:'#FBBF24', borderWidth:2, pointRadius:4, pointBackgroundColor:'#FBBF24', fill:false },
      ]},
      options:{ responsive:true, maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:true,position:'bottom',labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:10}},
          tooltip:{mode:'index',callbacks:{label:ctx=>` ${ctx.dataset.label}: ${Math.abs(ctx.raw).toLocaleString()} MW`}},
          zoom:ZOOM_CFG,
          annotation:{annotations:{ zero:{type:'line',yMin:0,yMax:0,borderColor:'rgba(255,255,255,.2)',borderWidth:1} }}
        },
        scales:{
          x:{grid:GRID,ticks:{color:C_TX3,font:{size:10}}},
          y:{grid:GRID,ticks:{color:C_TX3,callback:v=>Math.abs(v).toLocaleString()+' MW'}}
        }
      }
    });
    setTimeout(()=>{ addFullscreen('cb-chart-canvas'); addDownload('cb-chart-canvas','cross-border-flows'); },100);
  }

  // Table with flow balance bar
  const maxFlow = Math.max(...flows.map(f=>Math.max(f.imports,f.exports)));
  document.getElementById('cb-tbody').innerHTML = flows.map(f => {
    const net = f.net;
    const isExp = net < 0;
    const netColor = isExp ? 'var(--up)' : 'var(--down)';
    const dir = isExp ? '▶ Net Exporter' : '◀ Net Importer';
    const expPct = (f.exports/maxFlow*100).toFixed(0);
    const impPct = (f.imports/maxFlow*100).toFixed(0);
    const bar = `<div style="display:flex;align-items:center;gap:2px;height:8px">
      <div style="height:6px;width:${impPct}%;background:rgba(240,80,96,.5);border-radius:2px"></div>
      <div style="height:6px;width:${expPct}%;background:rgba(16,185,129,.5);border-radius:2px"></div>
    </div>`;
    return `<tr>
      <td>${f.partner}</td>
      <td style="color:var(--down);font-family:'JetBrains Mono',monospace">${f.imports.toLocaleString()}</td>
      <td style="color:var(--up);font-family:'JetBrains Mono',monospace">${f.exports.toLocaleString()}</td>
      <td style="color:${netColor};font-weight:600;font-family:'JetBrains Mono',monospace">${net>0?'+':''}${net.toLocaleString()}</td>
      <td>${bar}</td>
      <td style="color:${netColor};font-size:11px">${dir}</td>
    </tr>`;
  }).join('');

  document.getElementById('cb-updated').textContent = jsonFlows ? 'ENTSO-E A11 · JSON' : 'Demo · ENTSO-E A11';
}


// ════════════════════════════════════════════
// LOAD
// ════════════════════════════════════════════
window._loadDayOffset = 0;
function setLoadDay(offset, btn) {
  window._loadDayOffset = offset;
  document.querySelectorAll('#load-day-btns .day-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadLoad();
}

async function loadLoad() {
  window._loadLoaded = true;
  const country = (document.getElementById('load-country') || {}).value || 'FR';
  const offset  = window._loadDayOffset || 0;
  const jsonLoad = window._loadData?.[country];

  // Demo profiles (GW)
  const demoActual   = [35.2,33.8,32.5,31.4,30.8,31.5,34.2,39.5,44.8,47.1,48.3,49.0,48.8,48.2,48.5,49.8,52.2,55.0,54.1,51.8,49.2,46.8,43.2,39.1];
  const demoForecast = demoActual.map(v => v * (1.01 + (Math.random()-.5)*.04));
  const demoLastYear = demoActual.map(v => v * (1 + (Math.random()-.5)*.08));

  const actual   = jsonLoad?.actual?.map(v => v/1000)   || demoActual;
  const forecast = jsonLoad?.forecast?.map(v => v/1000) || demoForecast;
  const lastYear = jsonLoad?.lastYear?.map(v => v/1000) || demoLastYear;
  const curHr    = offset === 0 ? new Date().getHours() : 24;

  // KPIs
  const peakActual  = Math.max(...actual.filter(v=>v!=null));
  const peakFC      = Math.max(...forecast.filter(v=>v!=null));
  const avgActual   = actual.filter(v=>v!=null).reduce((a,b)=>a+b,0) / actual.filter(v=>v!=null).length;
  const actualSoFar = actual.slice(0, curHr).filter(v=>v!=null);
  const fcSoFar     = forecast.slice(0, curHr).filter(v=>v!=null);
  const dev = actualSoFar.length && fcSoFar.length
    ? ((actualSoFar.reduce((a,b)=>a+b,0)/actualSoFar.length - fcSoFar.reduce((a,b)=>a+b,0)/fcSoFar.length) /
       (fcSoFar.reduce((a,b)=>a+b,0)/fcSoFar.length) * 100) : 0;
  const lyAvg = lastYear.filter(v=>v!=null).reduce((a,b)=>a+b,0)/lastYear.filter(v=>v!=null).length;
  const yoy = lyAvg ? (avgActual - lyAvg) / lyAvg * 100 : 0;

  const countryNames = { FR:'France', DE_LU:'Germany', BE:'Belgium', NL:'Netherlands', ES:'Spain', GB:'Great Britain', IT_NORD:'Italy North' };
  const cname = countryNames[country] || country;

  const setKPI = (id, html) => { const el=document.getElementById(id); if(el) el.innerHTML=html; };
  setKPI('load-kpi-peak-actual', `${peakActual.toFixed(1)}<span class="kpi-unit">GW</span>`);
  setKPI('load-kpi-peak-actual-sub', `<span style="color:var(--tx3)">at ${actual.indexOf(peakActual)}h</span>`);
  setKPI('load-kpi-peak-fc', `${peakFC.toFixed(1)}<span class="kpi-unit">GW</span>`);
  setKPI('load-kpi-peak-fc-sub', `<span style="color:var(--tx3)">at ${forecast.indexOf(peakFC)}h</span>`);
  setKPI('load-kpi-avg', `${avgActual.toFixed(1)}<span class="kpi-unit">GW</span>`);
  setKPI('load-kpi-dev', `<span class="${dev>=0?'up':'down'}">${dev>=0?'+':''}${dev.toFixed(1)}<span class="kpi-unit">%</span></span>`);
  setKPI('load-kpi-dev-sub', dev>=0 ? 'over-forecast' : 'under-forecast');
  setKPI('load-kpi-yoy', `<span class="${yoy>=0?'up':'down'}">${yoy>=0?'+':''}${yoy.toFixed(1)}<span class="kpi-unit">%</span></span>`);
  setKPI('load-kpi-yoy-sub', `vs ${new Date().getFullYear()-1} same day`);

  const el_title = document.getElementById('load-chart-title');
  if (el_title) el_title.textContent = `${cname} — Hourly Load (GW)${offset!==0?' ('+offset+'d)':''}`;
  document.getElementById('load-updated').textContent = jsonLoad ? `ENTSO-E A65 · ${cname}` : `Demo data · ${cname}`;

  const labels = Array.from({length:24}, (_,i) => i+'h');
  const curHr2 = offset === 0 ? new Date().getHours() : 24;

  mkChart('load-canvas', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Actual (GW)', data:actual, borderColor:C_UP, borderWidth:2,
          backgroundColor: (ctx2) => { const g=ctx2.chart.ctx.createLinearGradient(0,0,0,200); g.addColorStop(0,rgba(C_UP,.15)); g.addColorStop(1,rgba(C_UP,0)); return g; },
          fill:true, pointRadius:0, tension:0.3 },
        { label:'DA Forecast (GW)', data:forecast, borderColor:C_WIND, borderWidth:1.5,
          borderDash:[5,4], pointRadius:0, tension:0, fill:false },
        { label:'Last Year Actual', data:lastYear, borderColor:'rgba(255,255,255,.2)', borderWidth:1,
          borderDash:[2,3], pointRadius:0, tension:0.3, fill:false },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins: {
        legend: { display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12} },
        tooltip: { mode:'index', callbacks:{ label: ctx => ` ${ctx.dataset.label}: ${ctx.raw?.toFixed(1)} GW` } },
        zoom: ZOOM_CFG,
        annotation: { annotations: (() => { const a = nowLineAnnotation(); return a ? { nowLine: a } : {}; })() }
      },
      scales: {
        x: { grid:GRID, ticks:{color:C_TX3} },
        y: { grid:GRID, ticks:{color:C_TX3, callback: v=>v.toFixed(0)+' GW'} }
      }
    }
  });
  setTimeout(() => { addFullscreen('load-canvas'); addDownload('load-canvas','load-demand'); }, 100);

  // Hourly table
  const tbody = document.getElementById('load-hourly-tbody');
  if (tbody) {
    tbody.innerHTML = labels.map((h, i) => {
      const act = actual[i];
      const fc  = forecast[i];
      const dev2 = (act != null && fc != null && fc !== 0) ? ((act - fc) / fc * 100) : null;
      const isPast = i <= curHr2;
      return `<tr style="opacity:${isPast||offset!==0?1:.45}">
        <td style="font-family:'JetBrains Mono',monospace">${h}</td>
        <td style="font-family:'JetBrains Mono',monospace">${act != null ? (act*1000).toLocaleString() : '–'}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:var(--tx3)">${fc != null ? (fc*1000).toLocaleString() : '–'}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:${dev2==null?'var(--tx3)':dev2>=0?'var(--up)':'var(--down)'}">
          ${dev2 != null ? (dev2>=0?'+':'')+dev2.toFixed(1)+'%' : '–'}
        </td>
      </tr>`;
    }).join('');
  }
}

// ═════════════════════════════════════════════
// NEWS
// ════════════════════════════════════════════
const RSS_SOURCES = [
  { name:'ENTSO-E', cls:'entsoe', url:'https://www.entsoe.eu/news/rss/', tags:['power','regulation'] },
  { name:'RTE', cls:'rte', url:'https://www.rte-france.com/presse/communiques-de-presse?type=rss', tags:['power','fr'] },
  { name:'CRE', cls:'cre', url:'https://www.cre.fr/en/rss', tags:['regulation','fr'] },
  { name:'ACER', cls:'acer', url:'https://www.acer.europa.eu/rss', tags:['regulation','markets'] },
  { name:'Recharge', cls:'recharge', url:'https://www.rechargenews.com/rss', tags:['power','markets'] },
  { name:'Energy Monitor', cls:'energymonitor', url:'https://energymonitor.ai/feed/', tags:['power','carbon','markets'] },
  { name:'Carbon Pulse', cls:'carbonpulse', url:'https://carbon-pulse.com/feed/', tags:['carbon','regulation'] },
  { name:'Gas Naturally', cls:'gasnaturally', url:'https://www.gasnaturally.eu/feed/', tags:['gas','regulation'] },
  { name:'Montel', cls:'montel', url:'https://www.montelnews.com/rss', tags:['power','gas','markets'] },
];

// RSS2JSON free proxy (no key needed for low volume)
const RSS_PROXY = 'https://api.rss2json.com/v1/api.json?rss_url=';
