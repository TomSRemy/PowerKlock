// ── EUA
function drawEUA() {
  const n=90;
  const eua90=Array.from({length:n},(_,i)=>+(74+8*Math.sin(i/30*Math.PI)+(Math.random()-.5)*6).toFixed(2));
  const brent90=Array.from({length:n},(_,i)=>+(110+15*Math.sin(i/45*Math.PI)+(Math.random()-.5)*8).toFixed(2));
  const labels=Array.from({length:n},(_,i)=>i%15===0?'D-'+(n-i):'');

  mkChart('eua-spot-canvas', {
    type:'line', data:{ labels, datasets:[{ label:'EUA spot (€/t)', data:eua90,
      borderColor:C_NUC, borderWidth:2, pointRadius:0, fill:true,
      backgroundColor:rgba(C_NUC,.1), tension:0.3 }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>ctx.raw+' €/t'}}, zoom:ZOOM_CFG },
      scales:{ x:{grid:GRID,ticks:{color:C_TX3,maxTicksLimit:8}}, y:{grid:GRID,ticks:{color:C_TX3,callback:v=>v+' €'},min:55,max:100} }
    }
  });

  // Scatter EUA vs Brent
  const scatterData = eua90.map((e,i)=>({x:brent90[i], y:e}));
  mkChart('eua-corr-canvas', {
    type:'scatter', data:{ datasets:[{ label:'EUA vs Brent', data:scatterData,
      backgroundColor:rgba(C_NUC,.5), pointRadius:3, pointHoverRadius:5 }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>'Brent: '+ctx.raw.x+'$ · EUA: '+ctx.raw.y+'€'}} },
      scales:{
        x:{grid:GRID, ticks:{color:C_TX3}, title:{display:true,text:'Brent ($/bbl)',color:C_TX3}},
        y:{grid:GRID, ticks:{color:C_TX3}, title:{display:true,text:'EUA (€/t)',color:C_TX3}}
      }
    }
  });

  const sparkData=Array.from({length:n},(_,i)=>+(-28+20*Math.sin(i/20*Math.PI)+(Math.random()-.5)*8).toFixed(2));
  mkChart('eua-spark-canvas', {
    type:'line', data:{ labels, datasets:[{ label:'Clean Spark Spread (€/MWh)', data:sparkData,
      borderColor:C_SOLAR, borderWidth:2, pointRadius:0, fill:true,
      backgroundColor:rgba(C_SOLAR,.1), tension:0.3 }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>ctx.raw+' €/MWh'}}, zoom:ZOOM_CFG },
      scales:{ x:{grid:GRID,ticks:{color:C_TX3,maxTicksLimit:8}}, y:{grid:GRID,ticks:{color:C_TX3,callback:v=>v+' €'}} }
    }
  });
  setTimeout(()=>{
    addFullscreen('eua-spot-canvas'); addDownload('eua-spot-canvas','eua-spot');
    addFullscreen('eua-corr-canvas'); addDownload('eua-corr-canvas','eua-corr');
    addFullscreen('eua-spark-canvas'); addDownload('eua-spark-canvas','spark-spread');
  },100);
}


function drawEUAFwd() {
  const labels=['Dec-25','Dec-26','Dec-27','Dec-28','Dec-29','Dec-30'];
  const bids=[74.48,76.35,79.05,82.10,85.50,89.00];
  const asks=[74.56,76.45,79.25,82.50,86.10,90.00];
  mkChart('eua-fwd-canvas', {
    type:'line', data:{ labels, datasets:[
      { label:'Ask', data:asks, borderColor:C_DN, borderWidth:2, pointRadius:5,
        pointBackgroundColor:C_DN, fill:false },
      { label:'Bid', data:bids, borderColor:C_UP, borderWidth:2, pointRadius:5,
        pointBackgroundColor:C_UP, fill:false },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:true,position:'bottom',labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:12}},
        tooltip:{mode:'index',callbacks:{label:ctx=>ctx.dataset.label+': '+ctx.raw+' €/t'}} },
      scales:{ x:{grid:GRID,ticks:{color:C_TX3}}, y:{grid:GRID,ticks:{color:C_TX3,callback:v=>v+' €'},min:70,max:95} }
    }
  });
  setTimeout(()=>{ addFullscreen('eua-fwd-canvas'); addDownload('eua-fwd-canvas','eua-forward'); },100);
}


// ── SPARK SPREAD
function renderSpark() {
  const TTF=45.14,EUA=74.09,EFF=0.49,CO2=0.365;
  const gasCost=TTF/EFF,carbCost=EUA*CO2;
  const demoZones=getDemoData();
  document.getElementById('spark-tbody').innerHTML=demoZones.slice(0,14).map(z=>{
    const css=z.today-gasCost-carbCost;
    return `<tr><td><span style="font-size:10px;color:var(--accent);font-weight:600;margin-right:4px">${z.code}</span>${z.name}</td><td style="font-weight:600">${z.today.toFixed(1)}</td><td style="color:var(--text3)">${gasCost.toFixed(1)}</td><td style="color:var(--text3)">${carbCost.toFixed(1)}</td><td class="${css>=0?'up':'down'}" style="font-weight:600">${css>=0?'+':''}${css.toFixed(1)}</td><td class="${z.vsYday>=0?'up':'down'}">${z.vsYday>=0?'▲':'▼'}${Math.abs(z.vsYday).toFixed(1)}</td></tr>`;
  }).join('');
}

