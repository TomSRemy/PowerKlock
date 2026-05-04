// ── NUCLEAR
function drawNuclear() {
  // Nuclear availability — 12 weeks (% of installed 61.4 GW)
  const nData  = [72,68,65,62,64,63,61,62,63,64,65,66];
  const labels = ['W-12','W-11','W-10','W-9','W-8','W-7','W-6','W-5','W-4','W-3','W-2','W-1'];
  const outage = [28,32,35,38,36,37,39,38,37,36,35,34]; // unavailability
  mkChart('nuc-canvas', {
    type:'bar',
    data:{ labels, datasets:[
      { label:'Available (%)', data:nData, backgroundColor:'rgba(59,130,246,.6)', borderWidth:0, borderRadius:2, stack:'s' },
      { label:'Outage (%)',    data:outage, backgroundColor:'rgba(240,80,96,.4)', borderWidth:0, borderRadius:2, stack:'s' },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,position:'bottom',labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:10}},
        tooltip:{mode:'index',callbacks:{label:ctx=>ctx.dataset.label+': '+ctx.raw+'%'}},
        annotation:{annotations:{
          ref:{type:'line',yMin:75,yMax:75,borderColor:'rgba(255,255,255,.25)',borderWidth:1,borderDash:[4,4],
            label:{display:true,content:'Normal 75%',position:'end',color:'rgba(255,255,255,.4)',font:{size:9},backgroundColor:'transparent'}}
        }}
      },
      scales:{
        x:{stacked:true,grid:GRID,ticks:{color:C_TX3}},
        y:{stacked:true,grid:GRID,ticks:{color:C_TX3,callback:v=>v+'%'},min:0,max:100}
      }
    }
  });

  // Hydro reservoir — 52 weeks
  const hData   = Array.from({length:52},(_,i)=>+(20+40*Math.sin(i/52*Math.PI)+(Math.random()-.5)*5).toFixed(1));
  const hMedian = Array.from({length:52},(_,i)=>+(25+30*Math.sin(i/52*Math.PI)).toFixed(1));
  const hLabels = Array.from({length:52},(_,i)=>{
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return i%4===0 ? months[Math.floor(i*12/52)] : '';
  });
  mkChart('hydro-canvas', {
    type:'line', data:{ labels:hLabels, datasets:[
      { label:'Fill level (%)',  data:hData,   borderColor:C_HYD, borderWidth:2, pointRadius:0, fill:true, backgroundColor:rgba(C_HYD,.1), tension:0.3 },
      { label:'20yr median (%)',data:hMedian, borderColor:rgba(C_WARN,.6), borderWidth:1.5, borderDash:[4,4], pointRadius:0, fill:false },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,position:'bottom',labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:10}},
        tooltip:{mode:'index',callbacks:{label:ctx=>ctx.dataset.label+': '+ctx.raw.toFixed(1)+'%'}}
      },
      scales:{ x:{grid:GRID,ticks:{color:C_TX3}}, y:{grid:GRID,ticks:{color:C_TX3,callback:v=>v+'%'},min:0,max:80} }
    }
  });
  setTimeout(()=>{ addFullscreen('nuc-canvas'); addFullscreen('hydro-canvas'); },100);
  document.getElementById('nuc-upd').textContent = 'ENTSO-E A73 · Demo';
}


// ── IMBALANCE
window._imbDay = 0;
function setImbDay(offset, btn) {
  window._imbDay = offset;
  document.querySelectorAll('#page-imbalance .day-tab').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  drawImbalance();
}

function drawImbalance() {
  const n = 96; // 15-min slots
  const daPrice = 45; // demo DA ref

  // Synthetic: imbalance spikes during wind ramp events
  const data = Array.from({length:n}, (_,i) => {
    const hr = i/4;
    const base = daPrice * (0.8 + 0.4*Math.sin(hr/24*Math.PI*2));
    const spike = (i>28&&i<36)||(i>52&&i<60) ? (Math.random()<.5?1:-1)*150*Math.random() : 0;
    return +(base + spike + (Math.random()-.5)*30).toFixed(1);
  });
  const longData  = data.map(v => v > 0 ? v : null);
  const shortData = data.map(v => v < 0 ? v : null);
  const labels = Array.from({length:n}, (_,i) => i%4===0 ? Math.floor(i/4)+'h' : '');
  const curIdx = (window._imbDay === 0) ? new Date().getHours()*4 : n;

  // KPIs
  const longVals  = data.filter(v=>v>0);
  const shortVals = data.filter(v=>v<0);
  const lastPrice = data[Math.max(0, curIdx-1)] || data[data.length-1];
  const longAvg   = longVals.length  ? longVals.reduce((a,b)=>a+b,0)/longVals.length   : 0;
  const shortAvg  = shortVals.length ? shortVals.reduce((a,b)=>a+b,0)/shortVals.length : 0;
  const netPos    = +(Math.random()*2000 - 1000).toFixed(0);
  const spread    = longAvg - shortAvg;

  const setKPI = (id, html) => { const el=document.getElementById(id); if(el) el.innerHTML=html; };
  setKPI('imb-kpi-last', `<span class="${lastPrice>=0?'up':'down'}">${lastPrice>=0?'+':''}${lastPrice.toFixed(1)}</span><span class="kpi-unit">€/MWh</span>`);
  setKPI('imb-kpi-last-chg', lastPrice>=0 ? 'System long' : 'System short');
  setKPI('imb-kpi-long', `+${longAvg.toFixed(1)}<span class="kpi-unit">€/MWh</span>`);
  setKPI('imb-kpi-long-chg', `${longVals.length} long periods`);
  setKPI('imb-kpi-short', `${shortAvg.toFixed(1)}<span class="kpi-unit">€/MWh</span>`);
  setKPI('imb-kpi-short-chg', `${shortVals.length} short periods`);
  setKPI('imb-kpi-pos', `<span class="${netPos>=0?'up':'down'}">${netPos>=0?'+':''}${netPos.toLocaleString()}</span><span class="kpi-unit">MW</span>`);
  setKPI('imb-kpi-spread', `+${spread.toFixed(1)}<span class="kpi-unit">€/MWh</span>`);

  mkChart('imb-canvas', {
    type:'bar',
    data:{ labels, datasets:[
      { label:'Long price (€/MWh)', data:longData,  backgroundColor:'rgba(16,185,129,.65)',  borderWidth:0, borderRadius:1 },
      { label:'Short price (€/MWh)',data:shortData, backgroundColor:'rgba(240,80,96,.65)',   borderWidth:0, borderRadius:1 },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,position:'bottom',labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:10}},
        tooltip:{mode:'index',callbacks:{label:ctx=>(ctx.raw!=null?(ctx.raw>=0?'+':'')+ctx.raw.toFixed(1)+' €/MWh':null)}},
        zoom:ZOOM_CFG,
        annotation:{annotations:{
          nowLine:{type:'line',xMin:curIdx,xMax:curIdx,borderColor:'rgba(255,220,100,.6)',borderWidth:1.5,borderDash:[4,3]},
          daRef:{type:'line',yMin:daPrice,yMax:daPrice,borderColor:'rgba(255,255,255,.15)',borderWidth:1,borderDash:[4,4],
            label:{display:true,content:'DA '+daPrice+'€',position:'start',color:'rgba(255,255,255,.4)',font:{size:9},backgroundColor:'transparent'}}
        }}
      },
      scales:{
        x:{grid:GRID_NONE,ticks:{color:C_TX3,maxTicksLimit:12}},
        y:{grid:GRID,ticks:{color:C_TX3,callback:v=>(v>=0?'+':'')+v+' €'},title:{display:true,text:'€/MWh',color:C_TX3,font:{size:10}}}
      }
    }
  });
  setTimeout(()=>{ addFullscreen('imb-canvas'); addDownload('imb-canvas','imbalance'); },100);

  // Periods table — show top 10 most extreme
  const tbody = document.getElementById('imb-periods-tbody');
  if (tbody) {
    const extremes = data.map((v,i)=>({i,v,label:Math.floor(i/4)+'h'+(i%4*15).toString().padStart(2,'0')}))
      .sort((a,b)=>Math.abs(b.v)-Math.abs(a.v)).slice(0,12);
    tbody.innerHTML = extremes.map(({i,v,label}) => {
      const pos = v >= 0;
      const vs = (v - daPrice);
      return `<tr>
        <td style="font-family:'JetBrains Mono',monospace">${label}</td>
        <td style="color:${pos?'var(--up)':'var(--down)'}">${pos?'LONG':'SHORT'}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:${pos?'var(--up)':'var(--down)'};font-weight:600">${v>=0?'+':''}${v.toFixed(1)}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:${vs>=0?'var(--up)':'var(--down)'}">${vs>=0?'+':''}${vs.toFixed(1)}</td>
        <td style="color:${pos?'var(--up)':'var(--down)'};font-size:11px">${pos?'▶ net long':'◀ net short'}</td>
      </tr>`;
    }).join('');
  }
  document.getElementById('imb-upd').textContent = 'Demo data · RTE';
}



