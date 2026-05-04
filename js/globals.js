// ── CHART.JS GLOBAL DEFAULTS
Chart.defaults.color = '#7a9ab8';

// Fix infinite resize loop: use ResizeObserver guard
const _chartResizeGuard = new Map();
const _origResize = Chart.prototype.resize;
Chart.prototype.resize = function(width, height) {
  const id = this.canvas?.id;
  if (!id) return _origResize.call(this, width, height);
  const now = Date.now();
  const last = _chartResizeGuard.get(id) || 0;
  if (now - last < 100) return; // throttle 100ms
  _chartResizeGuard.set(id, now);
  return _origResize.call(this, width, height);
};
Chart.defaults.font.family = "'IBM Plex Mono', monospace";
Chart.defaults.font.size = 10;
Chart.defaults.borderColor = 'rgba(26,45,63,.5)';
Chart.defaults.plugins.legend.display = false;
Chart.defaults.plugins.tooltip.backgroundColor = '#192534';
Chart.defaults.plugins.tooltip.borderColor = '#223344';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.titleColor = '#dce8f5';
Chart.defaults.plugins.tooltip.bodyColor = '#7a9ab8';
Chart.defaults.plugins.tooltip.cornerRadius = 6;
Chart.defaults.animation.duration = 400;

// Registry of all Chart instances (for destroy/resize)
const CHARTS = {};

function mkChart(id, config) {
  if (CHARTS[id]) { CHARTS[id].destroy(); delete CHARTS[id]; }
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  // Ensure parent has explicit height to prevent resize loop
  const parent = canvas.parentElement;
  const h = canvas.style.height || '220px';
  if (parent && !parent.style.height && parent.tagName !== 'TD') {
    parent.style.height = h;
    parent.style.maxHeight = h;
  }
  canvas.style.width = '100%';
  canvas.style.height = h;
  canvas.style.display = 'block';
  const chart = new Chart(canvas, config);
  CHARTS[id] = chart;
  return chart;
}

// Zoom plugin default config
const ZOOM_CFG = {
  zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
  pan:  { enabled: true, mode: 'x' },
};

// Fullscreen button helper
function addFullscreen(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.dataset.fsAdded) return;
  canvas.dataset.fsAdded = '1';
  const btn = document.createElement('button');
  btn.innerHTML = '⛶';
  btn.title = 'Plein écran';
  btn.style.cssText = 'position:absolute;top:6px;right:6px;background:rgba(25,37,52,.8);border:1px solid #223344;color:#7a9ab8;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;z-index:10';
  btn.onclick = () => {
    const wrap = canvas.closest('.chart-container') || canvas.parentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.requestFullscreen();
  };
  const wrap = canvas.closest('.chart-container') || canvas.parentElement;
  wrap.style.position = 'relative';
  wrap.appendChild(btn);
}

// Download PNG helper
function addDownload(canvasId, filename) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.dataset.dlAdded) return;
  canvas.dataset.dlAdded = '1';
  const btn = document.createElement('button');
  btn.innerHTML = '↓';
  btn.title = 'Télécharger PNG';
  btn.style.cssText = 'position:absolute;top:6px;right:32px;background:rgba(25,37,52,.8);border:1px solid #223344;color:#7a9ab8;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;z-index:10';
  btn.onclick = () => {
    if (!CHARTS[canvasId]) return;
    const a = document.createElement('a');
    a.href = CHARTS[canvasId].toBase64Image();
    a.download = (filename||canvasId) + '.png';
    a.click();
  };
  const wrap = canvas.closest('.chart-container') || canvas.parentElement;
  wrap.style.position = 'relative';
  wrap.appendChild(btn);
}

// Common grid config
const GRID = { color: 'rgba(26,45,63,.5)', drawTicks: false };
const GRID_NONE = { display: false };

// Color helpers
const C_UP   = '#10b981';
const C_DN   = '#f05060';
const C_WARN = '#e8a020';
const C_ACC  = '#10b981';
const C_WIND = '#60a5fa';
const C_SOLAR= '#f59e0b';
const C_NUC  = '#3b82f6';
const C_HYD  = '#34d399';
const C_FOS  = '#f87171';
const C_BIO  = '#6ee7b7';
const C_TX2  = '#7a9ab8';
const C_TX3  = '#3d5a7a';

function rgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── App constants (needed by multiple modules)

const NEW_PAGES = ['renewables','nuclear','imbalance','eua','euafwd','spark','goprices','gohist','wxcities','wxhdd','remit'];
const PAGE_LOADERS = {
  map: () => {
    setTimeout(() => {
      initLeafletMap();
      renderMapKPIs();
      document.getElementById('map-upd').textContent = pricesData?.length ? 'ENTSO-E · Live' : 'Demo data';
    }, 100);
  },
  renewables: loadRenewables,
  nuclear: drawNuclear,
  imbalance: drawImbalance,
  eua: drawEUA,
  euafwd: drawEUAFwd,
  spark: renderSpark,
  goprices: renderGO,
  gohist: () => { drawGoHist(); drawGoWoW(); drawGoBox(); },
  wxcities: loadWeather,
  wxhdd: renderHDD,
};

// Patch showPage to handle new sections
const _origShowPage = showPage;
window.showPage = function(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  const pg = document.getElementById('page-' + id);
  if (pg) pg.classList.add('active');
  const nav = document.getElementById('nav-' + id);
  if (nav) nav.classList.add('active');
  const ldr = PAGE_LOADERS[id];
  if (ldr && !window['_loaded_' + id]) { window['_loaded_' + id] = true; ldr(); }
  // original loaders
  if (id === 'genmix' && !window._genmixLoaded) loadGenMix();
  if (id === 'news' && !window._newsLoaded) loadNews();
  if (id === 'crossborder' && !window._cbLoaded) loadCrossBorder();
  if (id === 'load' && !window._loadLoaded) loadLoad();
  if (id === 'overview') loadOverview();
  if (id === 'converter') { updateConverter(); updateCapacity(); }
};

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
  {k:'nuclear',l:'Nuclear',c:'#a78bfa'},{k:'wind',l:'Wind',c:'#60a5fa'},
  {k:'solar',l:'Solar',c:'#f59e0b'},{k:'hydro',l:'Hydro',c:'#34d399'},
  {k:'fossil',l:'Fossil',c:'#f87171'},{k:'biomass',l:'Biomass',c:'#6ee7b7'},
];
const WX_CITIES = [
  {name:'Paris',region:'Ile-de-France',lat:48.85,lon:2.35,norm:11.0},
  {name:'Lyon',region:'Auvergne-Rhone-Alpes',lat:45.74,lon:4.83,norm:12.5},
  {name:'Marseille',region:'PACA',lat:43.30,lon:5.37,norm:16.0},
  {name:'Bordeaux',region:'Nouvelle-Aquitaine',lat:44.84,lon:-0.58,norm:13.2},
  {name:'Strasbourg',region:'Grand Est',lat:48.57,lon:7.75,norm:10.5},
  {name:'Lille',region:'Hauts-de-France',lat:50.63,lon:3.07,norm:10.0},
  {name:'Nantes',region:'Pays de la Loire',lat:47.22,lon:-1.55,norm:12.8},
  {name:'Grenoble',region:'Auvergne-Rhone-Alpes',lat:45.18,lon:5.72,norm:11.2},
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
