// ── NUCLEAR (France) ──────────────────────────────────────────────────
// Available capacity (actual + operator forecast) from SEFE's cockpit via
// window.PKC; output from the daily ENTSO-E generation files.
// Installed capacity: 57 reactors incl. Flamanville 3 (RTE, 2025).
const FR_NUC_INSTALLED_MW = 63000;

async function drawNuclear() {
  await PKC.ready; await PKC.loadFull();
  const av = PKC.pts('fr_nuc_avail', true), fc = PKC.pts('fr_nuc_avail_fc', true);
  if (!av.length) { document.getElementById('nuc-kpis').innerHTML = '<div class="fuel-note">No availability data.</div>'; return; }
  const last = av[av.length - 1], prev = av[av.length - 2];
  const lyISO = _renAdd(last[0], -364);
  const ly = PKC.valueOn('fr_nuc_avail', lyISO, true);
  const ytd = av.filter(p => p[0] >= last[0].slice(0, 4) + '-01-01'), ytdAvg = ytd.reduce((s, p) => s + p[1], 0) / ytd.length;
  const fcLast = fc[fc.length - 1];
  const GW = v => v == null ? '–' : (v / 1000).toFixed(1);
  const chg = prev ? last[1] - prev[1] : null;
  document.getElementById('nuc-upd').textContent = 'SEFE · ' + _fuelDate(last[0]);
  document.getElementById('nuc-kpis').innerHTML =
    _fuelKpi('Available', GW(last[1]), 'GW', chg == null ? '' : `<span style="color:${chg >= 0 ? 'var(--up)' : 'var(--down)'}">${chg >= 0 ? '▲' : '▼'} ${(Math.abs(chg) / 1000).toFixed(2)} GW</span> d/d`) +
    _fuelKpi('Unavailable', GW(FR_NUC_INSTALLED_MW - last[1]), 'GW', `of ${GW(FR_NUC_INSTALLED_MW)} GW installed`, 'down') +
    _fuelKpi('Availability factor', (last[1] / FR_NUC_INSTALLED_MW * 100).toFixed(1), '%', _fuelDate(last[0])) +
    _fuelKpi('vs last year', ly == null ? '–' : _fuelSigned((last[1] - ly) / 1000, 1), 'GW', ly == null ? '' : `same weekday ${_fuelDate(lyISO)}: ${GW(ly)} GW`, ly == null ? null : (last[1] >= ly ? 'up' : 'down')) +
    _fuelKpi('YTD average', GW(ytdAvg), 'GW', (ytdAvg / FR_NUC_INSTALLED_MW * 100).toFixed(1) + '% availability') +
    _fuelKpi('Operator forecast', GW(fcLast && fcLast[1]), 'GW', fcLast ? 'as published ' + _fuelDate(fcLast[0]) : '');

  // 1 · History with forecast and installed capacity
  const from = _fuelWindowStart('nuc'), to = _fuelWindowEnd('nuc');
  const j = _fuelJoin([PKC.asMap('fr_nuc_avail', true), PKC.asMap('fr_nuc_avail_fc', true)], from, to);
  const g = a => a.map(v => v == null ? null : Math.round(v / 10) / 100);
  _fuelChart('nuc-hist', { type: 'line', data: { labels: j.labels, datasets: [
    _fuelLineDs('Available (actual)', g(j.cols[0]), C_NUC, { borderWidth: 2, fill: true, backgroundColor: rgba('#7B4B9C', .12) }),
    _fuelLineDs('Operator forecast', g(j.cols[1]), '#C4A7E7', { borderDash: [5, 4], borderWidth: 1.3 }),
  ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { min: 0, suggestedMax: 66 }) },
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
      annotation: { annotations: { inst: { type: 'line', yMin: FR_NUC_INSTALLED_MW / 1000, yMax: FR_NUC_INSTALLED_MW / 1000, borderColor: 'rgba(184,201,217,.45)', borderWidth: 1, borderDash: [4, 4],
        label: { display: true, content: 'Installed ' + GW(FR_NUC_INSTALLED_MW) + ' GW', position: 'start', color: C_TX2, backgroundColor: 'rgba(10,14,22,.8)', font: { size: 9 } } } } } } }) }, 'fr-nuclear-availability');

  // 2 · Seasonal: current year vs previous 5 years (day of year)
  const by = {};
  av.forEach(([d, v]) => { const y = d.slice(0, 4); const doy = Math.floor((Date.parse(d) - Date.parse(y + '-01-01')) / 864e5); (by[y] = by[y] || [])[doy] = v; });
  const cy = +last[0].slice(0, 4), prevY = []; for (let y = cy - 5; y < cy; y++) if (by[y]) prevY.push(by[y]);
  const labels = [], mn = [], mx = [], avg = [], cur = [];
  for (let i = 0; i < 366; i++) {
    labels.push(new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }));
    const v = prevY.map(a => a[i]).filter(x => x != null);
    mn.push(v.length ? Math.min(...v) / 1000 : null); mx.push(v.length ? Math.max(...v) / 1000 : null);
    avg.push(v.length ? v.reduce((a, b) => a + b, 0) / v.length / 1000 : null);
    cur.push(by[cy] && by[cy][i] != null ? by[cy][i] / 1000 : null);
  }
  _fuelChart('nuc-season', { type: 'line', data: { labels, datasets: [
    _fuelLineDs(`${cy - 5}–${cy - 1} range`, mx, C_TX3, { borderWidth: 0, fill: '+1', backgroundColor: 'rgba(122,147,171,.14)' }),
    _fuelLineDs('min', mn, C_TX3, { borderWidth: 0 }),
    _fuelLineDs('5-year average', avg, C_TX2, { borderDash: [4, 3], borderWidth: 1.2 }),
    _fuelLineDs(String(cy), cur, C_NUC, { borderWidth: 2 }),
  ] }, options: _fuelOpts({
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10, filter: it => it.text !== 'min' } }, zoom: ZOOM_CFG },
    scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 } }), y: _fuelAxis('GW', { suggestedMin: 25 }) } }) }, 'fr-nuclear-seasonal');

  // 3 · Output vs availability over days with generation data
  const days = (await _renDaysWithGen('FR')).filter(d => d >= from && d <= to);
  const files = await Promise.all(days.map(_renDaily));
  const rows = days.map((d, i) => {
    const z = files[i] && files[i].zones && files[i].zones.FR;
    const out = z && _renMean(z.nuclear);
    return out ? { d, out: out / 1000, avail: (PKC.valueOn('fr_nuc_avail', d, true) || 0) / 1000 } : null;
  }).filter(Boolean);
  if (rows.length) {
    _renRestore('nuc-mod');
    _fuelChart('nuc-mod', { type: 'line', data: { labels: rows.map(r => r.d), datasets: [
      _fuelLineDs('Available', rows.map(r => +r.avail.toFixed(2)), '#C4A7E7', { borderWidth: 1.5, pointRadius: 2 }),
      _fuelLineDs('Output', rows.map(r => +r.out.toFixed(2)), C_NUC, { borderWidth: 2, pointRadius: 2, fill: true, backgroundColor: rgba('#7B4B9C', .14) }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { suggestedMin: 25 }) } }) }, 'fr-nuclear-modulation');
    const mod = rows.map(r => r.avail - r.out).filter(v => v > 0);
    document.getElementById('nuc-mod-sub').textContent = `Daily average output vs available capacity (GW) · mean modulation ${(mod.reduce((a, b) => a + b, 0) / (mod.length || 1)).toFixed(1)} GW over ${rows.length} days`;
  } else if (typeof noDataMsg === 'function') {
    noDataMsg('nuc-mod', 'No ENTSO-E nuclear output archived in this period', 'Output history exists for the days with generation data (see Renewables coverage).');
  }
  document.getElementById('nuc-note').textContent =
    `Available capacity = daily average of the capacity declared available by the operator (SEFE cockpit, from ${_fuelDate(av[0][0])}); the forecast series is the operator's day-ahead view as published each day. ` +
    `Installed capacity ${GW(FR_NUC_INSTALLED_MW)} GW (57 reactors, incl. Flamanville 3). Output − availability gap = modulation / load-following.`;
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




// ── OUTAGES & REMIT ───────────────────────────────────────────────────
async function renderRemit() {
  await PKC.ready; await PKC.loadFull();
  const av = PKC.pts('fr_nuc_avail', true), fc = PKC.pts('fr_nuc_avail_fc', true);
  if (!av.length) return;
  const I = FR_NUC_INSTALLED_MW, last = av[av.length - 1];
  const un = v => v == null ? null : (I - v) / 1000;
  // Same calendar day, previous 5 years
  const prevYears = [1, 2, 3, 4, 5].map(k => PKC.valueOn('fr_nuc_avail', (+last[0].slice(0, 4) - k) + last[0].slice(4), true)).filter(v => v != null);
  const avg5 = prevYears.length ? prevYears.reduce((a, b) => a + b, 0) / prevYears.length : null;
  const fcLast = fc[fc.length - 1];
  document.getElementById('remit-upd').textContent = 'SEFE · ' + _fuelDate(last[0]);
  document.getElementById('remit-kpis').innerHTML =
    _fuelKpi('FR nuclear unavailable', un(last[1]).toFixed(1), 'GW', _fuelDate(last[0]), 'down') +
    _fuelKpi('Share of fleet', ((I - last[1]) / I * 100).toFixed(1), '%', 'of 63.0 GW installed') +
    _fuelKpi('vs 5-year same date', avg5 == null ? '–' : _fuelSigned(un(last[1]) - un(avg5), 1), 'GW', avg5 == null ? '' : `5y avg ${un(avg5).toFixed(1)} GW unavailable`, avg5 == null ? null : (last[1] >= avg5 ? 'up' : 'down')) +
    _fuelKpi('Operator forecast', fcLast ? un(fcLast[1]).toFixed(1) : '–', 'GW', fcLast ? 'unavailable, as of ' + _fuelDate(fcLast[0]) : '') +
    _fuelKpi('180-day max', Math.max(...av.slice(-180).map(p => un(p[1]))).toFixed(1), 'GW', 'unavailable') +
    _fuelKpi('180-day min', Math.min(...av.slice(-180).map(p => un(p[1]))).toFixed(1), 'GW', 'unavailable');
  const from = _renAdd(last[0], -180);
  const j = _fuelJoin([PKC.asMap('fr_nuc_avail', true), PKC.asMap('fr_nuc_avail_fc', true)], from, '9999');
  _fuelChart('remit-unavail', { type: 'line', data: { labels: j.labels, datasets: [
    _fuelLineDs('Unavailable (actual)', j.cols[0].map(v => v == null ? null : +un(v).toFixed(2)), C_DN, { borderWidth: 2, fill: true, backgroundColor: rgba(C_DN, .12) }),
    _fuelLineDs('Unavailable (operator forecast)', j.cols[1].map(v => v == null ? null : +un(v).toFixed(2)), '#F4A3A0', { borderDash: [5, 4], borderWidth: 1.3 }),
  ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { beginAtZero: true }) } }) }, 'fr-nuclear-unavailability');
}
