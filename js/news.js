// News come from data/news.json, written every 3 hours by
// scripts/fetch_news.py (GitHub Actions) from public RSS/Atom feeds.
// No client-side proxy and no placeholder articles: if the file is missing
// the page says so.
async function loadNews() {
  window._newsLoaded = true;
  const badge = document.getElementById('news-updated');
  try {
    const r = await fetch(DATA_BASE + 'news.json?t=' + Date.now());
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    newsData = (j.items || []).map(i => Object.assign({}, i, { date: new Date(i.date) }))
      .sort((a, b) => b.date - a.date);
    const upd = j.updated ? new Date(j.updated).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '';
    if (badge) badge.textContent = `${newsData.length} articles · ${new Set(newsData.map(n => n.source)).size} sources · ${upd}`;
  } catch (e) {
    newsData = [];
    if (badge) badge.textContent = 'News feed unavailable';
  }
  renderNews(newsData);
}

function _newsEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderNews(items) {
  const q = ((document.getElementById('news-search') || {}).value || '').trim().toLowerCase();
  const filtered = (items || []).filter(i =>
    (newsFilter === 'all' || (i.tags || []).includes(newsFilter)) &&
    (!q || (i.title + ' ' + i.snippet + ' ' + i.source).toLowerCase().includes(q)));
  const grid = document.getElementById('news-grid');
  if (!items || !items.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No news available — data/news.json could not be loaded.</div>';
    return;
  }
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No articles for this filter.</div>';
    return;
  }
  grid.innerHTML = filtered.map(item => {
    const link = /^https?:\/\//.test(item.link || '') ? item.link : '#';
    const tagsHtml = (item.tags || []).map(t => `<span class="news-tag">${_newsEsc(t)}</span>`).join(' ');
    return `<a class="news-card" href="${_newsEsc(link)}" target="_blank" rel="noopener noreferrer">
      <div class="news-meta">
        <span class="news-source ${_newsEsc(item.cls)}">${_newsEsc(item.source)}</span>
        <span class="news-time" title="${_newsEsc(item.date.toLocaleString('en-GB', { timeZone: 'Europe/Paris' }))}">${formatTimeAgo(item.date)}</span>
      </div>
      <div class="news-title">${_newsEsc(item.title)}</div>
      <div class="news-snippet">${_newsEsc(item.snippet)}</div>
      <div>${tagsHtml}</div>
    </a>`;
  }).join('');
}

function filterNews(tag, btn) {
  newsFilter = tag;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderNews(newsData);
}

function formatTimeAgo(date) {
  const diff = (Date.now() - date) / 1000;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

// ════════════════════════════════════════════
// OVERVIEW
// ════════════════════════════════════════════
function loadOverview() {
  const prices = (typeof pricesData !== 'undefined' && pricesData) ? pricesData : [];
  const fr = prices.find(d => d.code === 'FR'), de = prices.find(d => d.code === 'DE_LU'), be = prices.find(d => d.code === 'BE');
  const P = window.PKC, ttf = P && P.last('ttf'), eua = P && P.last('eua'), fx = P && P.last('eurusd');
  document.getElementById('overview-prices').innerHTML = [
    { label:'🇫🇷 France DA', val:fr && fr.today, unit:'€/MWh' },
    { label:'🇩🇪 Germany DA', val:de && de.today, unit:'€/MWh' },
    { label:'🇧🇪 Belgium DA', val:be && be.today, unit:'€/MWh' },
    { label:'TTF DA', val:ttf && ttf.v, unit:'€/MWh' },
    { label:'EUA ' + (P ? P.contractLabel('eua') : ''), val:eua && eua.v, unit:'€/t' },
    { label:'EUR/USD', val:fx && fx.v, unit:'', dp:4 },
  ].map(r => `<tr>
    <td style="font-family:Inter;text-align:left;color:var(--text2)">${r.label}</td>
    <td style="font-weight:600">${r.val != null ? r.val.toFixed(r.dp || 2) : '--'}</td>
    <td style="color:var(--text3);font-size:11px">${r.unit}</td>
  </tr>`).join('');
  const pct = l => l && l.pct != null ? `${l.pct >= 0 ? 'up' : 'down'} ${Math.abs(l.pct).toFixed(2)}% vs prior close` : '';
  document.getElementById('market-status').innerHTML = `
    <div style="margin-bottom:10px"><span style="color:var(--accent)">⚡ Power</span><br>
    ${fr ? `FR day-ahead at ${fr.today.toFixed(2)} €/MWh. ${fr.negHrs > 0 ? `${fr.negHrs}h of negative prices.` : 'No negative hours.'}` : 'Day-ahead prices not loaded.'}</div>
    <div style="margin-bottom:10px"><span style="color:#C4A57B">⛽ Gas</span><br>
    ${ttf ? `TTF day-ahead at ${ttf.v.toFixed(2)} €/MWh, ${pct(ttf)}.` : 'Gas data not loaded.'}</div>
    <div><span style="color:#A87DC4">🌿 Carbon</span><br>
    ${eua ? `EUA ${P.contractLabel('eua')} at ${eua.v.toFixed(2)} €/t, ${pct(eua)}.` : 'Carbon data not loaded.'}</div>
  `;
}

// ════════════════════════════════════════════
// CONVERTER
// ════════════════════════════════════════════
const CONV_FACTORS = {
  'MW':  { MW:1, GW:0.001, MWh:1, GWh:0.001, TWh:0.000001 },
  'GW':  { MW:1000, GW:1, MWh:1000, GWh:1, TWh:0.001 },
  'MWh': { MW:1, GW:0.001, MWh:1, GWh:0.001, TWh:0.000001 },
  'GWh': { MW:1000, GW:1, MWh:1000, GWh:1, TWh:0.001 },
  'TWh': { MW:1000000, GW:1000, MWh:1000000, GWh:1000, TWh:1 },
};

function setConvUnit(unit, btn) {
  convUnit = unit;
  document.querySelectorAll('.conv-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateConverter();
}

function updateConverter() {
  const val = parseFloat(document.getElementById('conv-input').value) || 0;
  const factors = CONV_FACTORS[convUnit] || CONV_FACTORS['MW'];
  const units = ['MW','GW','MWh','GWh','TWh'];
  const descs = {
    'MW':'Megawatt (capacity)','GW':'Gigawatt = 1,000 MW',
    'MWh':'Megawatt-hour (energy)','GWh':'Gigawatt-hour = 1,000 MWh','TWh':'Terawatt-hour = 1,000 GWh'
  };
  document.getElementById('conv-results').innerHTML = units.map(u => {
    const result = val * (factors[u] || 1);
    const disp = result >= 1e6 ? result.toExponential(2) : result >= 1000 ? result.toLocaleString('en-GB', {maximumFractionDigits:1}) : result.toFixed(result < 0.01 ? 6 : 3);
    const active = u === convUnit ? 'border-color:var(--accent)' : '';
    return `<div class="conv-result" style="${active}" onclick="setConvUnit('${u}', document.querySelectorAll('.conv-tab')[${units.indexOf(u)}])">
      <div class="conv-result-label">${u}</div>
      <div class="conv-result-value">${disp}</div>
      <div class="conv-result-desc">${descs[u]}</div>
    </div>`;
  }).join('');
}

function updateCapacity() {
  const mw = parseFloat(document.getElementById('cap-mw').value) || 0;
  const lf = parseFloat(document.getElementById('cap-lf').value) || 0;
  const annualMWh = mw * (lf/100) * 8760;
  const annualGWh = annualMWh / 1000;
  const annualTWh = annualGWh / 1000;
  const fLH = (lf/100) * 8760;

  document.getElementById('cap-results').innerHTML = `
    <div class="conv-result"><div class="conv-result-label">Annual Production</div><div class="conv-result-value">${(annualTWh).toFixed(3)} TWh</div><div class="conv-result-desc">= ${annualGWh.toFixed(1)} GWh</div></div>
    <div class="conv-result"><div class="conv-result-label">Full-Load Hours</div><div class="conv-result-value">${Math.round(fLH).toLocaleString()}</div><div class="conv-result-desc">hours/year</div></div>
    <div class="conv-result" style="grid-column:1/-1"><div class="conv-result-label">Formula</div><div style="font-size:12px;color:var(--text2);margin-top:4px;font-family:JetBrains Mono">${mw} MW × ${lf}% × 8,760 h = ${Math.round(annualMWh).toLocaleString()} MWh/year</div></div>
  `;
}

function setLF(val, btn) {
  document.getElementById('cap-lf').value = val;
  document.querySelectorAll('.day-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateCapacity();
}


// ── NEW SECTION LOADER ──
const NEW_PAGES = ['renewables','nuclear','imbalance','eua','euafwd','spark','goprices','wxcities','wxhdd','remit'];
const PAGE_LOADERS = {
  map: () => {
    setTimeout(() => {
      initLeafletMap();
      renderMapKPIs();
      document.getElementById('map-upd').textContent = pricesData?.length ? 'ENTSO-E · Live' : 'Demo data';
    }, 100);
  },
  // Several `hist.js` historical sections only re-render reactively, when the
  // user clicks a window/zone control (setHistWindow/setHistZone) — they were
  // never wired to render once on first page visit, so the chart stayed an
  // empty canvas until the user happened to click a pill button. Each loader
  // below now also fires that first render.
  renewables: () => loadRenewables(),
  nuclear:    () => drawNuclear(),
  imbalance:  () => {
    drawImbalance();
    if (typeof renderHistImb === 'function') renderHistImb();
    if (typeof renderHistFCR === 'function') renderHistFCR();
  },
  analysis:   () => { if (typeof loadMarketAnalysis === 'function') loadMarketAnalysis(); },
  carbonintensity: () => { if (typeof initCarbon === 'function') initCarbon(); },
  eua:        () => drawEUA(),
  euafwd:     () => drawEUAFwd(),
  spark:      () => typeof renderSpark!=="undefined"&&renderSpark(),
  goprices:   () => typeof renderGO!=="undefined"&&renderGO(),
  remit:      () => renderRemit(),
  wxcities:   () => { if (typeof loadWeather === 'function') loadWeather(); },
  wxhdd:      () => typeof renderHDD!=="undefined"&&renderHDD(),
};

// Weather pages: see js/meteo.js

// Patch showPage to handle new sections
// showPage patch applied after all scripts load
window.addEventListener("load", () => { if (typeof showPage === "undefined") return;
const _origShowPage = showPage;
window.showPage = function(id) {
  // Was a full copy-paste of the original page/nav toggling (which had gone
  // stale — e.g. it never got the dashboard-switcher reset added to prices.js'
  // showPage, since this duplicate silently shadowed it). Delegate to the
  // original and only add what this patch actually needs on top: the new
  // section loaders below.
  _origShowPage(id);
  const ldr = PAGE_LOADERS[id];
  if (ldr && !window['_loaded_' + id]) { window['_loaded_' + id] = true; ldr(); }
};
});  // end load listener

// ── DEMO DATA
const GM_DEMO = {
  FR:{nuclear:38000,wind:5500,solar:11100,hydro:4800,fossil:700,biomass:900,total:61400},
  DE_LU:{nuclear:0,wind:22000,solar:18000,hydro:2500,fossil:12000,biomass:4000,total:59000},
  ES:{nuclear:7000,wind:15000,solar:12000,hydro:5000,fossil:4000,biomass:800,total:44000},
  BE:{nuclear:4500,wind:1800,solar:2500,hydro:100,fossil:2000,biomass:600,total:11700},
  NL:{nuclear:500,wind:5000,solar:4000,hydro:0,fossil:8000,biomass:500,total:18100},
  IT_NORD:{nuclear:0,wind:1500,solar:7000,hydro:8000,fossil:9000,biomass:700,total:26500},
  GB:{nuclear:5000,wind:8000,solar:3000,hydro:1500,fossil:6000,biomass:1200,total:25100},
  PT:{nuclear:0,wind:4000,solar:3500,hydro:2500,fossil:1500,biomass:400,total:12000},
};
const FUELS = [
  {k:'nuclear',l:'Nuclear',c:'#A87DC4'},{k:'wind',l:'Wind',c:'#C4A57B'},
  {k:'solar',l:'Solar',c:'#FBBF24'},{k:'hydro',l:'Hydro',c:'#94D2BD'},
  {k:'fossil',l:'Fossil',c:'#ED6965'},{k:'biomass',l:'Biomass',c:'#94D2BD'},
];
const GO_CURRENT = [
  {tech:'Wind',cal:'Cal-26',bid:.51,ask:.55,delta:-.02},
  {tech:'Solar',cal:'Cal-26',bid:.38,ask:.41,delta:-.01},
  {tech:'Hydro',cal:'Cal-26',bid:.49,ask:.53,delta:-.02},
  {tech:'Renewable',cal:'Cal-26',bid:.45,ask:.48,delta:-.015},
];
const GO_FWD = [
  {p:'GO AIB Wind',b25:.52,a25:.56,b26:.51,a26:.55,b27:.48,a27:.52,d:-.02},
  {p:'GO AIB Solar',b25:.39,a25:.42,b26:.38,a26:.41,b27:.35,a27:.38,d:-.01},
  {p:'GO AIB Hydro',b25:.50,a25:.54,b26:.49,a26:.53,b27:.46,a27:.50,d:-.02},
  {p:'GO AIB Renewable',b25:.46,a25:.49,b26:.45,a26:.48,b27:.42,a27:.45,d:-.015},
  {p:'GO Ireland Wind',b25:.28,a25:.32,b26:.27,a26:.31,b27:.25,a27:.29,d:-.01},
];

// ── HELPERS
function genHourly24(base, min, max) {
  const p=[.6,.5,.45,.4,.4,.5,.7,.85,.9,.85,.75,.6,.55,.58,.65,.75,.88,.95,1,.95,.88,.82,.75,.68];
  const r = max - min;
  return p.map(v => min + v*r + (Math.random()-.5)*r*.08);
}
function drawLineSimple(ctx, w, h, data, color, mn, mx) {
  // Legacy shim -- find canvas from ctx and use Chart.js
  const canvas = ctx.canvas;
  if (!canvas || !canvas.id) return;
  mkChart(canvas.id, {
    type: 'line',
    data: {
      labels: data.map((_,i)=>i),
      datasets: [{ data, borderColor:color, borderWidth:2, pointRadius:0, fill:true,
        backgroundColor:(c2)=>{const g=c2.chart.ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,rgba(color,.2));g.addColorStop(1,rgba(color,0));return g;},
        tension: 0 }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{enabled:true}, zoom:ZOOM_CFG },
      scales:{
        x:{display:false},
        y:{grid:GRID, ticks:{color:C_TX3}, min:mn, max:mx}
      }
    }
  });
  setTimeout(()=>{ addFullscreen(canvas.id); addDownload(canvas.id,canvas.id); },100);
}
