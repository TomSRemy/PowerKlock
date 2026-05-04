async function loadGenMix() {
  window._genmixLoaded = true;
  const country = document.getElementById('genmix-country').value;
  document.getElementById('genmix-updated').textContent = 'Loading...';

  const demoMix = {
    'FR':     { nuclear:38000, solar:11100, wind:5500, hydro:4800, fossil:700,  imports:3200, total:63300 },
    'DE_LU':  { nuclear:0,     solar:18000, wind:22000,hydro:2500, fossil:12000,imports:1500, total:56000 },
    'ES':     { nuclear:7000,  solar:12000, wind:15000,hydro:5000, fossil:4000, imports:800,  total:43800 },
    'BE':     { nuclear:4500,  solar:2500,  wind:1800, hydro:100,  fossil:2000, imports:1200, total:12100 },
    'NL':     { nuclear:500,   solar:4000,  wind:5000, hydro:0,    fossil:8000, imports:500,  total:18000 },
    'PT':     { nuclear:0,     solar:3500,  wind:4000, hydro:2500, fossil:1500, imports:200,  total:11700 },
    'IT_NORD':{ nuclear:0,     solar:7000,  wind:1500, hydro:8000, fossil:9000, imports:2000, total:27500 },
  };

  const jsonMix = window._genmixData?.[country];
  const mix = jsonMix || demoMix[country] || demoMix['FR'];
  if (!mix.total) mix.total = Object.values(mix).reduce((a,b) => typeof b==='number' ? a+b : a, 0);
  const total = mix.total;

  const fuels = [
    { key:'nuclear', name:'Nuclear',  color:'#3b82f6', type:'NUCLEAR',   isRen:false },
    { key:'wind',    name:'Wind',     color:'#00d4a8', type:'RENEWABLE',  isRen:true  },
    { key:'solar',   name:'Solar',    color:'#fbbf24', type:'RENEWABLE',  isRen:true  },
    { key:'hydro',   name:'Hydro',    color:'#34d399', type:'RENEWABLE',  isRen:true  },
    { key:'fossil',  name:'Fossil',   color:'#f87171', type:'FOSSIL',     isRen:false },
    { key:'imports', name:'Imports',  color:'#94a3b8', type:'OTHER',      isRen:false },
  ];

  // KPI fuel cards
  document.getElementById('fuel-grid').innerHTML = fuels.map(f => {
    const val = mix[f.key] || 0;
    const pct = Math.round(val / total * 100);
    const cls = `fuel-${f.key}`;
    return `<div class="fuel-card">
      <div class="fuel-name">${f.name}</div>
      <div class="fuel-value" style="color:${f.color}">${(val/1000).toFixed(1)}<span style="font-size:13px;font-weight:400;color:var(--text2)"> GW</span></div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px">${pct}% of total</div>
      <div class="fuel-bar"><div class="fuel-bar-fill" style="width:${pct}%;background:${f.color}"></div></div>
    </div>`;
  }).join('');

  document.getElementById('genmix-updated').textContent = jsonMix ? 'ENTSO-E A75 · JSON' : 'Demo data · ENTSO-E A75';

  // Draw chart based on selected type
  const type = window._genMixType || 'bar';
  const showDA = document.getElementById('genmix-da-overlay')?.checked;
  const canvas = document.getElementById('genmix-canvas');
  drawGenMixChart(canvas, mix, fuels, type, showDA);

  // Breakdown table
  renderGenMixBreakdown(mix, fuels, total, jsonMix);
}

function drawGenMixChart(canvas, mix, fuels, type, showDA) {
  if (!canvas) return;
  const id = canvas.id || 'genmix-canvas';
  const hours = 24;
  const dayProfile = [.75,.7,.68,.66,.65,.68,.75,.85,.92,.95,.96,.97,.98,.97,.96,.97,.98,1,.98,.95,.92,.88,.84,.8];
  const labels = Array.from({length:hours}, (_,i) => i+'h');

  if (type === 'donut') {
    // Snapshot donut
    const vals  = fuels.map(f => mix[f.key] || 0);
    const colors= fuels.map(f => f.color);
    mkChart(id, {
      type: 'doughnut',
      data: { labels: fuels.map(f=>f.name), datasets: [{ data:vals, backgroundColor:colors, borderWidth:1, borderColor:'var(--bg1)' }] },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: {
          legend:{ display:true, position:'right', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:8} },
          tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${(ctx.raw/1000).toFixed(1)} GW (${Math.round(ctx.raw/(mix.total||1)*100)}%)` } },
        }
      }
    });
    return;
  }

  const datasets = fuels.map(f => ({
    label: f.name,
    data: dayProfile.map(p => Math.round((mix[f.key]||0) * p * (0.88 + Math.random()*.24))),
    backgroundColor: type === 'area' ? f.color + '99' : f.color,
    borderColor: f.color,
    borderWidth: type === 'area' ? 1 : 0,
    fill: type === 'area' ? true : undefined,
    borderRadius: type === 'bar' ? 1 : 0,
    tension: type === 'area' ? 0.3 : 0,
    pointRadius: 0,
  }));

  // DA Price overlay
  if (showDA && window._pricesSorted) {
    const frData = window._pricesSorted.find(z => z.code === (document.getElementById('genmix-country')?.value || 'FR'));
    if (frData?.hourly?.length) {
      datasets.push({
        label: 'DA Price (€/MWh)',
        data: frData.hourly,
        type: 'line',
        borderColor: '#f59e0b',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
        yAxisID: 'yPrice',
      });
    }
  }

  const chartType = type === 'area' ? 'line' : 'bar';
  mkChart(id, {
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins: {
        legend:{ display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:10} },
        tooltip:{ mode:'index', callbacks:{ label: ctx => ctx.yAxisID === 'yPrice' ? ` ${ctx.raw?.toFixed(1)} €/MWh` : ` ${ctx.dataset.label}: ${(ctx.raw/1000).toFixed(1)} GW` } },
        zoom: ZOOM_CFG,
        annotation:{ annotations:{ nowline:{ type:'line', xMin:new Date().getHours(), xMax:new Date().getHours(), borderColor:'rgba(255,220,100,.7)', borderWidth:1.5, borderDash:[4,3], label:{ display:true, content:'NOW', position:'start', color:'rgba(255,220,100,.9)', font:{size:9,weight:'600'}, backgroundColor:'transparent', padding:2 } } } }
      },
      scales: {
        x: { stacked: type!=='area', grid:GRID, ticks:{color:C_TX3} },
        y: { stacked: type!=='area', grid:GRID, ticks:{color:C_TX3, callback: v=>(v/1000).toFixed(0)+'GW'}, title:{display:true,text:'GW',color:C_TX3,font:{size:10}} },
        ...(showDA && window._pricesSorted ? { yPrice:{ position:'right', grid:{display:false}, ticks:{color:'#f59e0b',font:{size:9},callback:v=>v+'€'}, title:{display:true,text:'€/MWh',color:'#f59e0b',font:{size:9}} } } : {})
      }
    }
  });
  setTimeout(() => { addFullscreen(id); addDownload(id, 'generation-mix'); }, 100);
}

function renderGenMixBreakdown(mix, fuels, total, isLive) {
  const tbody = document.getElementById('genmix-breakdown-tbody');
  if (!tbody) return;
  const renKeys = ['wind','solar','hydro'];
  const rows = fuels.map(f => {
    const val = mix[f.key] || 0;
    const pct = total ? (val/total*100) : 0;
    const barColor = f.color;
    const typeLabel = f.type === 'NUCLEAR' ? `<span style="background:rgba(59,130,246,.15);color:#3b82f6;border-radius:3px;padding:1px 6px;font-size:10px;font-weight:600">NUCLEAR</span>`
      : f.type === 'RENEWABLE' ? `<span style="background:rgba(16,185,129,.15);color:#10b981;border-radius:3px;padding:1px 6px;font-size:10px;font-weight:600">RENEWABLE</span>`
      : f.type === 'FOSSIL' ? `<span style="background:rgba(248,113,113,.15);color:#f87171;border-radius:3px;padding:1px 6px;font-size:10px;font-weight:600">FOSSIL</span>`
      : `<span style="background:rgba(148,163,184,.1);color:#94a3b8;border-radius:3px;padding:1px 6px;font-size:10px;font-weight:600">OTHER</span>`;
    const bar = `<div style="display:flex;align-items:center;gap:6px">
      <div style="flex:1;height:5px;background:var(--bg3);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${Math.min(pct,100).toFixed(1)}%;background:${barColor};border-radius:3px"></div>
      </div>
      <span style="font-size:10px;color:var(--tx3);width:32px;text-align:right">${pct.toFixed(0)}%</span>
    </div>`;
    return `<tr>
      <td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${barColor};margin-right:7px"></span>${f.name}</td>
      <td style="font-weight:600;font-family:'JetBrains Mono',monospace">${(val/1000).toFixed(2)}</td>
      <td>${bar}</td>
      <td>${typeLabel}</td>
    </tr>`;
  });
  // Totals row
  const renTotal = fuels.filter(f=>renKeys.includes(f.key)).reduce((a,f)=>a+(mix[f.key]||0),0);
  const renPct = total ? (renTotal/total*100).toFixed(0) : '0';
  rows.push(`<tr style="border-top:1px solid var(--bd2);font-weight:600">
    <td colspan="1" style="color:var(--tx2)">Total</td>
    <td style="font-family:'JetBrains Mono',monospace">${(total/1000).toFixed(2)}</td>
    <td><span style="font-size:10px;color:#10b981">🌱 ${renPct}% renewable</span></td>
    <td></td>
  </tr>`);
  tbody.innerHTML = rows.join('');
  const upd = document.getElementById('genmix-breakdown-updated');
  if (upd) upd.textContent = isLive ? 'ENTSO-E A75 · live' : 'Demo data';
}



