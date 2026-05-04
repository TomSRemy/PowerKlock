// ── WEATHER
let wxVar = 'temp';
function setWxVar(v, btn) {
  wxVar = v;
  document.querySelectorAll('#wx-var-btns .day-tab').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  drawWxForecastChart();
}

async function loadWeather() {
  document.getElementById('wx-upd').textContent='Loading...';
  const country = document.getElementById('wx-country')?.value || 'FR';
  const citiesByCountry = {
    'FR': WX_CITIES,
    'DE': [{name:'Berlin',lat:52.52,lon:13.40,norm:10,region:'Nord'},{name:'Hamburg',lat:53.55,lon:9.99,norm:9.5,region:'Nord'},{name:'Munich',lat:48.14,lon:11.58,norm:9,region:'Sud'},{name:'Frankfurt',lat:50.11,lon:8.68,norm:10.5,region:'Centre'}],
    'ES': [{name:'Madrid',lat:40.42,lon:-3.70,norm:15,region:'Centre'},{name:'Barcelona',lat:41.39,lon:2.16,norm:16,region:'Est'},{name:'Valencia',lat:39.47,lon:-0.38,norm:18,region:'Est'},{name:'Seville',lat:37.39,lon:-5.99,norm:20,region:'Sud'}],
    'GB': [{name:'London',lat:51.51,lon:-0.13,norm:12,region:'SE'},{name:'Manchester',lat:53.48,lon:-2.24,norm:10,region:'NW'},{name:'Edinburgh',lat:55.95,lon:-3.19,norm:9,region:'Scotland'},{name:'Birmingham',lat:52.49,lon:-1.90,norm:10.5,region:'Midlands'}],
    'BE': [{name:'Brussels',lat:50.85,lon:4.35,norm:11,region:'Centre'},{name:'Liège',lat:50.63,lon:5.57,norm:10.5,region:'Est'},{name:'Ghent',lat:51.05,lon:3.72,norm:11,region:'Ouest'},{name:'Antwerp',lat:51.22,lon:4.40,norm:11,region:'Nord'}],
    'NL': [{name:'Amsterdam',lat:52.37,lon:4.90,norm:11,region:'NH'},{name:'Rotterdam',lat:51.92,lon:4.48,norm:11.5,region:'ZH'},{name:'Utrecht',lat:52.09,lon:5.12,norm:11,region:'UT'},{name:'Eindhoven',lat:51.44,lon:5.48,norm:11,region:'NB'}],
  };
  const cities = citiesByCountry[country] || WX_CITIES;
  const cards=[], tableRows=[];
  window._wxCities = [];

  for(const city of cities.slice(0,8)){
    try{
      const url=`https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weathercode,windspeed_10m,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,shortwave_radiation_sum&timezone=auto&forecast_days=14`;
      const r=await fetch(url); const d=await r.json();
      const temp=d.current.temperature_2m, wind=d.current.windspeed_10m, precip=d.current.precipitation??0;
      const hdd=Math.max(0,18-temp), vs=(temp-(city.norm||12)).toFixed(1);
      const tmax=d.daily?.temperature_2m_max?.[0]??temp+3, tmin=d.daily?.temperature_2m_min?.[0]??temp-3;
      const rad=d.daily?.shortwave_radiation_sum?.[0]??0;
      window._wxCities.push({...city,temp,wind,precip,hdd,vs,tmax,tmin,rad,daily:d.daily});
      const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const fc7=(d.daily?.temperature_2m_max||[]).slice(0,7).map((t,i)=>{
        const tmn=d.daily?.temperature_2m_min?.[i]??t-4; const day=new Date(); day.setDate(day.getDate()+i);
        return `<div style="flex:1;text-align:center"><div style="font-size:8px;color:var(--tx3)">${dayNames[day.getDay()]}</div><div style="font-size:10px;font-weight:600">${Math.round(t)}°</div><div style="font-size:9px;color:var(--tx3)">${Math.round(tmn)}°</div></div>`;
      }).join('');
      const wc=+vs>=2?'var(--down)':+vs<=-2?'var(--up)':'var(--tx2)';
      cards.push(`<div style="background:var(--bg3);border:1px solid var(--bd);border-radius:8px;padding:12px 14px">
        <div style="font-size:12px;font-weight:600;margin-bottom:2px">${city.name}</div>
        <div style="font-size:9px;color:var(--tx3);margin-bottom:6px">${city.region||''}</div>
        <div style="font-size:22px;font-weight:700;font-family:'JetBrains Mono',monospace">${temp.toFixed(1)}<span style="font-size:13px;font-weight:400;color:var(--tx3)">°C</span></div>
        <div style="font-size:10px;color:var(--tx3);margin-top:2px">${tmin.toFixed(0)}° / ${tmax.toFixed(0)}° · 💨 ${wind} km/h</div>
        <div style="font-size:10px;color:${wc};font-family:'JetBrains Mono',monospace;margin:4px 0 8px">${+vs>=0?'+':''}${vs}°C vs norm · HDD ${hdd.toFixed(1)}</div>
        <div style="display:flex;gap:2px;border-top:1px solid var(--bd);padding-top:8px">${fc7}</div>
      </div>`);
      tableRows.push(`<tr>
        <td style="font-weight:600">${city.name}</td>
        <td style="font-family:'JetBrains Mono',monospace">${temp.toFixed(1)}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:var(--tx3)">${tmin.toFixed(0)} / ${tmax.toFixed(0)}</td>
        <td style="font-family:'JetBrains Mono',monospace">${wind.toFixed(0)}</td>
        <td style="font-family:'JetBrains Mono',monospace">${precip.toFixed(1)}</td>
        <td style="font-family:'JetBrains Mono',monospace">${rad?.toFixed(0)??'--'}</td>
        <td style="font-family:'JetBrains Mono',monospace">${hdd.toFixed(1)}</td>
      </tr>`);
    }catch{ cards.push(`<div style="background:var(--bg3);border:1px solid var(--bd);border-radius:8px;padding:12px 14px"><div style="font-weight:600">${city.name}</div><div style="color:var(--tx3);font-size:11px;margin-top:8px">Unavailable</div></div>`); }
  }
  document.getElementById('wx-cards').innerHTML=cards.join('');
  const tbody=document.getElementById('wx-city-tbody'); if(tbody) tbody.innerHTML=tableRows.join('')||'<tr><td colspan="7" style="color:var(--tx3)">No data</td></tr>';
  document.getElementById('wx-upd').textContent='Open-Meteo · Live';
  drawWxForecastChart();
}

function drawWxForecastChart() {
  const canvas=document.getElementById('wx-forecast-canvas');
  if(!canvas||!window._wxCities?.length) return;
  const varColors={'temp':'#60a5fa','wind':'#00d4a8','precip':'#a78bfa','radiation':'#fbbf24'};
  const varLabels={'temp':'°C','wind':'km/h','precip':'mm','radiation':'MJ/m²'};
  const el=document.getElementById('wx-chart-title'); if(el) el.textContent={'temp':'Temperature','wind':'Wind Speed','precip':'Precipitation','radiation':'Solar Radiation'}[wxVar]+' — 14-day Forecast';
  const datasets=window._wxCities.slice(0,5).map((city,ci)=>{
    const col=['#60a5fa','#00d4a8','#f59e0b','#34d399','#f87171'][ci]||'#60a5fa';
    let data;
    if(wxVar==='temp')      data=city.daily?.temperature_2m_max?.slice(0,14);
    else if(wxVar==='wind') data=city.daily?.windspeed_10m_max?.slice(0,14);
    else if(wxVar==='precip') data=city.daily?.precipitation_sum?.slice(0,14);
    else data=city.daily?.shortwave_radiation_sum?.slice(0,14);
    return{label:city.name,data:data||[],borderColor:col,borderWidth:1.5,pointRadius:3,pointBackgroundColor:col,tension:0.3,fill:false};
  });
  const labels=Array.from({length:14},(_,i)=>{const d=new Date();d.setDate(d.getDate()+i);return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});});
  mkChart('wx-forecast-canvas',{
    type:wxVar==='precip'?'bar':'line',
    data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:true,position:'bottom',labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:10}},
        tooltip:{mode:'index',callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.raw?.toFixed(1)} ${varLabels[wxVar]}`}},zoom:ZOOM_CFG},
      scales:{x:{grid:GRID,ticks:{color:C_TX3,font:{size:9},maxRotation:45}},y:{grid:GRID,ticks:{color:C_TX3,callback:v=>v+' '+varLabels[wxVar]}}}
    }
  });
  setTimeout(()=>{addFullscreen('wx-forecast-canvas');},100);
}

// ── HDD
function renderHDD() {
  const norms={Paris:11,Lyon:12.5,Marseille:16,Bordeaux:13.2,Strasbourg:10.5,Lille:10,Nantes:12.8,Grenoble:11.2};
  const rows=WX_CITIES.map(c=>{
    const daily=Array.from({length:7},()=>(Math.random()*4).toFixed(1));
    const sum=daily.reduce((a,b)=>a+ +b,0).toFixed(1);
    const norm=(7*(18-norms[c.name])/10).toFixed(1);
    const diff=(sum-norm).toFixed(1);
    return `<tr><td><span style="font-size:10px;color:var(--accent);font-weight:600;margin-right:4px">${c.name.slice(0,3).toUpperCase()}</span>${c.name}</td>${daily.map(v=>`<td>${v}</td>`).join('')}<td style="font-weight:600">${sum}</td><td class="${+diff>=0?'down':'up'}">${+diff>=0?'+':''}${diff}</td></tr>`;
  });
  document.getElementById('hdd-tbody').innerHTML=rows.join('');
  // HDD cumul chart - Chart.js
  const n2=120;
  let cum2=0; const cumD=Array.from({length:n2},(_,i)=>{cum2+=Math.max(0,18-(10+5*Math.sin(i/n2*Math.PI*2)+2*(Math.random()-.5)));return +cum2.toFixed(1);});
  let cumN2=0; const normD=Array.from({length:n2},(_,i)=>{cumN2+=Math.max(0,18-(10+5*Math.sin(i/n2*Math.PI*2)));return +cumN2.toFixed(1);});
  const hddLabels=Array.from({length:n2},(_,i)=>i%17===0?['Oct','Nov','Dec','Jan','Feb','Mar','Apr'][Math.floor(i/17)]||'':'');
  mkChart('hdd-canvas', {
    type:'line', data:{ labels:hddLabels, datasets:[
      { label:'Actual 2025-26', data:cumD, borderColor:'#3b82f6', borderWidth:2, pointRadius:0, fill:true, backgroundColor:rgba('#3b82f6',.15), tension:0.3 },
      { label:'Normale 20 ans', data:normD, borderColor:rgba(C_TX2,.5), borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:true,position:'bottom',labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12}},
        tooltip:{mode:'index',callbacks:{label:ctx=>ctx.dataset.label+': '+ctx.raw+' HDD'}}, zoom:ZOOM_CFG },
      scales:{ x:{grid:GRID,ticks:{color:C_TX3}}, y:{grid:GRID,ticks:{color:C_TX3,callback:v=>v+' HDD'},beginAtZero:true} }
    }
  });
  setTimeout(()=>{ addFullscreen('hdd-canvas'); addDownload('hdd-canvas','hdd-cumul'); },100);
}


// ════════════════════════════════════════════
// PRICE MAP — Leaflet
// ════════════════════════════════════════════

// Zone coordinates (centroid of each bidding zone)
const ZONE_COORDS = {
  'FR':     [46.5, 2.3],   'DE':    [51.2, 10.4],  'DE_LU': [51.2, 10.4],
  'BE':     [50.5, 4.5],   'NL':    [52.3, 5.3],   'ES':    [40.4, -3.7],
  'PT':     [39.6, -8.0],  'IT_NORD':[45.5, 11.0], 'IT_SICI':[38.1, 13.4],
  'IT-N':   [45.5, 11.0],  'IT-S':  [38.1, 13.4],  'CH':    [46.8, 8.2],
  'AT':     [47.5, 14.5],  'CZ':    [49.8, 15.5],  'SK':    [48.7, 19.7],
  'HU':     [47.2, 19.5],  'PL':    [52.0, 19.5],  'RO':    [45.9, 24.9],
  'HR':     [45.1, 15.2],  'SI':    [46.1, 14.8],  'RS':    [44.0, 21.0],
  'BG':     [42.7, 25.5],  'GR':    [39.1, 21.8],  'MK':    [41.6, 21.7],
  'ME':     [42.8, 19.2],  'DK_W':  [55.8, 9.5],   'DK_E':  [55.4, 11.8],
  'SE':     [59.3, 16.0],  'NO_1':  [62.0, 10.0],  'FI':    [64.0, 26.0],
  'EE':     [58.6, 25.0],  'LV':    [56.9, 24.6],  'LT':    [55.2, 23.9],
  'GB':     [52.5, -1.5],  'MT':    [35.9, 14.4],
};

// Color scale for prices
function priceToColor(price, mn, mx) {
  if (price === null || price === undefined) return '#111c28';
  const pct = Math.max(0, Math.min(1, (price - mn) / (mx - mn || 1)));
  // Green (low) → Yellow (mid) → Red (high)
  if (pct < 0.5) {
    const t = pct * 2;
    const r = Math.round(34  + t * (220 - 34));
    const g = Math.round(197 + t * (200 - 197));
    const b = Math.round(94  - t * 94);
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (pct - 0.5) * 2;
    const r = Math.round(220 + t * (220 - 220));
    const g = Math.round(200 - t * 200);
    const b = 0;
    return `rgb(${r},${g},${b})`;
  }
}

function negToColor(neg) {
  if (!neg) return '#1e3a2f';
  const pct = Math.min(1, neg / 12);
  return `rgb(${Math.round(16+pct*(232-16))},${Math.round(185-pct*(185-80))},${Math.round(129-pct*129)})`;
}

function deltaToColor(delta) {
  if (delta === null) return '#1a2d3f';
  if (delta > 0) return `rgba(240,80,96,${Math.min(0.9, Math.abs(delta)/30)})`;
  return `rgba(16,185,129,${Math.min(0.9, Math.abs(delta)/30)})`;
}

let leafletMap = null;
let mapMarkers = [];
let mapView = 'price';
let mapInitialized = false;

