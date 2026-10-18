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
window._loadUserPicked = false;
function setLoadDay(offset, btn) {
  window._loadDayOffset = offset;
  window._loadUserPicked = true;
  document.querySelectorAll('#load-day-btns .day-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadLoad();
}

async function loadLoad() {
  window._loadLoaded = true;
  const country = (document.getElementById('load-country') || {}).value || 'FR';
  const offset  = window._loadDayOffset || 0;
  const countryNames = { FR:'France', DE_LU:'Germany', BE:'Belgium', NL:'Netherlands', ES:'Spain', GB:'Great Britain', IT_NORD:'Italy North' };
  const cname = countryNames[country] || country;
  const today = pkTodayISO();
  const dayISO = (() => { const [y,m,d] = today.split('-').map(Number); return new Date(Date.UTC(y, m-1, d + offset)).toISOString().slice(0,10); })();
  const lyISO  = (() => { const [y,m,d] = dayISO.split('-').map(Number); return new Date(Date.UTC(y, m-1, d - 364)).toISOString().slice(0,10); })();
  const fetchDay = async iso => { try { const r = await fetch(DATA_BASE + 'history/daily/' + iso + '.json'); return r.ok ? await r.json() : null; } catch (_) { return null; } };

  // Day data: the live snapshot for today, the daily history file otherwise.
  let actual = null, forecast = null, src = '';
  const live = window._loadData && window._loadData[country];
  const liveDate = window._loadDataUpdated ? new Date(window._loadDataUpdated).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }) : null;
  if (live && liveDate === dayISO) { actual = live.actual; forecast = live.forecast || null; src = 'live snapshot'; }
  if (!actual) {
    const day = await fetchDay(dayISO);
    const z = day && day.zones && day.zones[country];
    if (z && Array.isArray(z.load)) { actual = z.load; forecast = z.loadForecast || null; src = 'daily history'; }
  }
  const lyDay = await fetchDay(lyISO);
  const lyZ = lyDay && lyDay.zones && lyDay.zones[country];
  const lastYear = lyZ && Array.isArray(lyZ.load) ? lyZ.load : null;

  const setKPI = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const fmtDay = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
  const el_title = document.getElementById('load-chart-title');
  if (el_title) el_title.textContent = `${cname} — load (GW) · ${fmtDay(dayISO)}`;
  document.getElementById('load-updated').textContent = actual ? `ENTSO-E A65 · ${src}` : 'No data for this day';

  // First visit before today's data exists: show the latest available day
  // instead of an empty "Today".
  if ((!actual || !actual.some(v => v != null)) && !window._loadUserPicked && offset === 0 && liveDate && liveDate < dayISO) {
    const back = Math.round((Date.parse(liveDate) - Date.parse(dayISO)) / 864e5);
    window._loadDayOffset = back;
    document.querySelectorAll('#load-day-btns .day-tab').forEach(b => b.classList.toggle('active', (b.getAttribute('onclick') || '').includes('(' + back + ',')));
    return loadLoad();
  }
  if (!actual || !actual.some(v => v != null)) {
    ['load-kpi-peak-actual','load-kpi-peak-fc','load-kpi-avg','load-kpi-dev','load-kpi-yoy'].forEach(id => setKPI(id, '–'));
    ['load-kpi-peak-actual-sub','load-kpi-peak-fc-sub','load-kpi-dev-sub','load-kpi-yoy-sub'].forEach(id => setKPI(id, ''));
    if (typeof noDataMsg === 'function') noDataMsg('load-canvas', `No load data stored for ${cname} on ${fmtDay(dayISO)}`, 'Load history is kept from the daily fetch onwards (actual + day-ahead forecast).');
    const tb = document.getElementById('load-hourly-tbody'); if (tb) tb.innerHTML = '';
    return;
  }
  const c = document.getElementById('load-canvas'); if (c) { const m = c.parentNode.querySelector('.no-data-msg'); if (m) m.remove(); c.style.display = 'block'; }

  const n = actual.length, per = n / 24;
  const GW = a => a ? a.map(v => v == null ? null : v / 1000) : null;
  const A = GW(actual), F = GW(forecast), L = GW(lastYear && lastYear.length === n ? lastYear : null);
  const labels = (typeof makeTimeLabels === 'function') ? makeTimeLabels(n) : Array.from({ length: n }, (_, i) => String(Math.floor(i / per)).padStart(2, '0') + ':' + String((i % per) * (60 / per)).padStart(2, '0'));
  const valid = a => a ? a.filter(v => v != null) : [];
  const argmax = a => { let mi = -1; (a || []).forEach((v, i) => { if (v != null && (mi < 0 || v > a[mi])) mi = i; }); return mi; };
  const iA = argmax(A), iF = argmax(F);
  const avgA = valid(A).reduce((x, y) => x + y, 0) / valid(A).length;
  // Forecast error (MAPE) over slots where both are published
  const pairs = A.map((v, i) => (v != null && F && F[i] != null) ? [v, F[i]] : null).filter(Boolean);
  const bias = pairs.length ? pairs.reduce((s, [a, f]) => s + (a - f), 0) / pairs.reduce((s, [, f]) => s + f, 0) * 100 : null;
  const mape = pairs.length ? pairs.reduce((s, [a, f]) => s + Math.abs(a - f), 0) / pairs.reduce((s, [, f]) => s + f, 0) * 100 : null;
  const lyPairs = L ? A.map((v, i) => (v != null && L[i] != null) ? [v, L[i]] : null).filter(Boolean) : [];
  const yoy = lyPairs.length ? (lyPairs.reduce((s, [a]) => s + a, 0) / lyPairs.reduce((s, [, l]) => s + l, 0) - 1) * 100 : null;

  setKPI('load-kpi-peak-actual', `${A[iA].toFixed(1)}<span class="kpi-unit">GW</span>`);
  setKPI('load-kpi-peak-actual-sub', `<span style="color:var(--tx3)">at ${labels[iA]} · ${valid(A).length}/${n} slots published</span>`);
  setKPI('load-kpi-peak-fc', iF >= 0 ? `${F[iF].toFixed(1)}<span class="kpi-unit">GW</span>` : '–');
  setKPI('load-kpi-peak-fc-sub', iF >= 0 ? `<span style="color:var(--tx3)">at ${labels[iF]}</span>` : '<span style="color:var(--tx3)">forecast not available</span>');
  setKPI('load-kpi-avg', `${avgA.toFixed(1)}<span class="kpi-unit">GW</span>`);
  setKPI('load-kpi-dev', bias == null ? '–' : `<span class="${bias >= 0 ? 'up' : 'down'}">${bias >= 0 ? '+' : ''}${bias.toFixed(1)}<span class="kpi-unit">%</span></span>`);
  setKPI('load-kpi-dev-sub', bias == null ? '' : `${bias >= 0 ? 'above' : 'below'} forecast · MAPE ${mape.toFixed(1)}%`);
  setKPI('load-kpi-yoy', yoy == null ? '–' : `<span class="${yoy >= 0 ? 'up' : 'down'}">${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}<span class="kpi-unit">%</span></span>`);
  setKPI('load-kpi-yoy-sub', yoy == null ? `no data for ${fmtDay(lyISO)}` : `vs ${fmtDay(lyISO)} (same weekday)`);

  const ds = [{ label: 'Actual', data: A, borderColor: C_UP, borderWidth: 2, backgroundColor: rgba(C_UP, .08), fill: true, pointRadius: 0, tension: 0, spanGaps: false }];
  if (F) ds.push({ label: 'Day-ahead forecast', data: F, borderColor: C_WIND, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0, fill: false });
  if (L) ds.push({ label: 'Same weekday last year', data: L, borderColor: 'rgba(184,201,217,.45)', borderWidth: 1, borderDash: [2, 3], pointRadius: 0, tension: 0, fill: false });
  mkChart('load-canvas', {
    type: 'line', data: { labels, datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 12 } },
        tooltip: { mode: 'index', callbacks: { label: ctx => ctx.raw == null ? null : ` ${ctx.dataset.label}: ${ctx.raw.toFixed(2)} GW` } },
        zoom: ZOOM_CFG,
        annotation: { annotations: (() => { const a = nowLineAnnotation({ slots: n, labels, chartDate: dayISO }); return a ? { nowLine: a } : {}; })() }
      },
      scales: { x: { grid: GRID, ticks: { color: C_TX3, maxTicksLimit: 13, maxRotation: 0 } },
                y: { grid: GRID, ticks: { color: C_TX3, callback: v => v.toFixed(0) + ' GW' } } }
    }
  });
  setTimeout(() => { addFullscreen('load-canvas'); addDownload('load-canvas', 'load-' + country + '-' + dayISO); }, 100);

  // Hourly table (mean of the hour's slots), Paris time
  const hourAvg = (a, h) => { if (!a) return null; const v = a.slice(h * per, (h + 1) * per).filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const tbody = document.getElementById('load-hourly-tbody');
  if (tbody) {
    tbody.innerHTML = Array.from({ length: 24 }, (_, h) => {
      const act = hourAvg(A, h), fc = hourAvg(F, h);
      const dev2 = (act != null && fc) ? (act - fc) / fc * 100 : null;
      return `<tr style="opacity:${act == null ? .45 : 1}">
        <td style="font-family:'JetBrains Mono',monospace">${String(h).padStart(2, '0')}:00</td>
        <td style="font-family:'JetBrains Mono',monospace">${act != null ? Math.round(act * 1000).toLocaleString('en-GB') : '–'}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:var(--tx3)">${fc != null ? Math.round(fc * 1000).toLocaleString('en-GB') : '–'}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:${dev2 == null ? 'var(--tx3)' : dev2 >= 0 ? 'var(--up)' : 'var(--down)'}">${dev2 != null ? (dev2 >= 0 ? '+' : '') + dev2.toFixed(1) + '%' : '–'}</td>
      </tr>`;
    }).join('');
  }
}

// ═════════════════════════════════════════════
// NEWS
// ════════════════════════════════════════════
// Feeds are fetched server-side by scripts/fetch_news.py → data/news.json.
