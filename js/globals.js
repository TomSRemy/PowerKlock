// ── CHART.JS GLOBAL DEFAULTS
Chart.defaults.color = '#B8C9D9';

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
Chart.defaults.plugins.tooltip.titleColor = '#FFFFFF';
Chart.defaults.plugins.tooltip.bodyColor = '#B8C9D9';
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
  btn.style.cssText = 'position:absolute;top:6px;right:6px;background:rgba(25,37,52,.8);border:1px solid #223344;color:#B8C9D9;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;z-index:10';
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
  btn.style.cssText = 'position:absolute;top:6px;right:32px;background:rgba(25,37,52,.8);border:1px solid #223344;color:#B8C9D9;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;z-index:10';
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

// ── Color constants (aligned with Klock palette V3 — see :root in index.html)
// Brand & semantic
const C_UP   = '#14D3A9';   // Mint Leaf — up, primary, power, wind
const C_DN   = '#ED6965';   // Vibrant Coral — down, fossil, alert
const C_WARN = '#EE9B00';   // Golden Orange — warning
const C_ACC  = '#14D3A9';   // accent (= up)
const C_HL   = '#FFFD82';   // Canary Yellow — highlight, breaking event

// Energy sectors
const C_WIND = '#14D3A9';   // Mint Leaf — wind (= primary)
const C_SOLAR= '#FBBF24';   // Solar Gold
const C_NUC  = '#7B4B9C';   // Amethyst — nuclear (was bleu, now violet)
const C_HYD  = '#3FA6B4';   // Sea Glass — hydro
const C_FOS  = '#ED6965';   // Vibrant Coral — fossil
const C_BIO  = '#94D2BD';   // Pearl Aqua — biomass

// Market categories
const C_GAS    = '#C4A57B'; // Sand — gas
const C_CARBON = '#A87DC4'; // Lavender — carbon / EUA
const C_GO     = '#94D2BD'; // Pearl Aqua — guarantees of origin

// Text scale
const C_TX1  = '#FFFFFF';   // primary
const C_TX2  = '#B8C9D9';   // secondary
const C_TX3  = '#7A93AB';   // tertiary
const C_TX4  = '#4A6280';   // disabled / no-data

// Multi-zone series pool — 8 hand-picked colours with max contrast
const SERIES_POOL = [
  '#14D3A9',  // 1. Mint Leaf
  '#ED6965',  // 2. Vibrant Coral
  '#FFFD82',  // 3. Canary Yellow
  '#1A7B8C',  // 4. Lagoon
  '#CA6702',  // 5. Burnt Caramel
  '#BB3E03',  // 6. Rusty Spice
  '#7DD3FC',  // 7. Sky Blue
  '#8B7FB5',  // 8. Slate Violet
];

// ── Farthest-point colour generation for indices 9+
// Each new colour is the candidate that maximises the minimum perceptual
// distance to ALL previously used colours (pool + already generated).
// Distance is computed in approximate Lab space (better than RGB euclidean
// for perceptual contrast).

function _hexToRgb(hex) {
  const h = hex.replace('#','');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function _rgbToLab(r, g, b) {
  // sRGB → linear
  const lin = c => { c /= 255; return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  // linear RGB → XYZ (D65)
  const X = R*0.4124 + G*0.3576 + B*0.1805;
  const Y = R*0.2126 + G*0.7152 + B*0.0722;
  const Z = R*0.0193 + G*0.1192 + B*0.9505;
  // XYZ → Lab
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787*t + 16/116;
  const fx = f(X/0.95047), fy = f(Y), fz = f(Z/1.08883);
  return [116*fy - 16, 500*(fx-fy), 200*(fy-fz)];
}
function _hexToLab(hex) { const [r,g,b] = _hexToRgb(hex); return _rgbToLab(r,g,b); }
function _labDist(a, b) { return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2); }
function _hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h/30) % 12;
  const a = s * Math.min(l, 1-l);
  const f = n => {
    const c = l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)));
    return Math.round(c*255).toString(16).padStart(2,'0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Cache for generated colours so same index always returns same hex
const _seriesCache = [];
let _seriesUsedLabs = null;

function _initLabCache() {
  _seriesUsedLabs = SERIES_POOL.map(_hexToLab);
}

function getSeriesColor(index) {
  if (index < SERIES_POOL.length) return SERIES_POOL[index];
  if (_seriesCache[index]) return _seriesCache[index];
  if (!_seriesUsedLabs) _initLabCache();

  // Build all generated colours up to and including `index` so cache is filled
  // in order (later calls with smaller indices stay deterministic).
  for (let i = SERIES_POOL.length; i <= index; i++) {
    if (_seriesCache[i]) continue;

    // Generate a grid of candidates across HSL space — wide hue, mid-high
    // saturation, mid lightness (readable on dark bg).
    let bestHex = null;
    let bestMinDist = -1;
    for (let h = 0; h < 360; h += 12) {
      for (const s of [55, 70, 85]) {
        for (const l of [50, 62, 72]) {
          const hex = _hslToHex(h, s, l);
          const lab = _hexToLab(hex);
          // Min distance to all already-used colours
          let minD = Infinity;
          for (const u of _seriesUsedLabs) {
            const d = _labDist(lab, u);
            if (d < minD) minD = d;
          }
          if (minD > bestMinDist) { bestMinDist = minD; bestHex = hex; }
        }
      }
    }
    _seriesCache[i] = bestHex;
    _seriesUsedLabs.push(_hexToLab(bestHex));
  }
  return _seriesCache[index];
}

const SERIES_NEUTRAL = '#7A93AB';
const SERIES_MAX_DISTINCT = 8;

function rgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── NOW line helper for daily charts
// Returns a Chart.js annotation object for the current hour, or null if the
// chart is showing a date other than today (DP.selectedDate is past/future).
//   - xValue: position on the chart (defaults to current hour 0-23)
//   - opts.slots: total x-axis slots (24 for hourly, 96 for 15-min). Default 24.
//   - opts.label: label text (default 'NOW')
// Usage:
//   const ann = nowLineAnnotation();           // hourly chart
//   const ann = nowLineAnnotation({slots:96}); // 15-min chart
//   if (ann) annotations.nowLine = ann;
function nowLineAnnotation(opts = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const selected = window.DP && window.DP.selectedDate;
  if (selected && selected !== today) return null;

  const slots = opts.slots || 24;
  const now = new Date();
  // For 24h charts: x = hour + minute fraction. For 96-slot 15-min charts: x = hour*4 + minute/15.
  const x = slots === 96
    ? now.getHours() * 4 + now.getMinutes() / 15
    : now.getHours() + now.getMinutes() / 60;

  return {
    type: 'line',
    xMin: x,
    xMax: x,
    borderColor: '#FFFD82',
    borderWidth: 1.5,
    borderDash: [4, 3],
    label: {
      display: true,
      content: opts.label || 'NOW',
      position: 'start',
      color: '#FFFD82',
      font: { size: 10, weight: '600', family: "'IBM Plex Mono', monospace" },
      backgroundColor: 'transparent',
      padding: 2,
    },
  };
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
  {k:'nuclear',l:'Nuclear',c:'#A87DC4'},{k:'wind',l:'Wind',c:'#C4A57B'},
  {k:'solar',l:'Solar',c:'#FBBF24'},{k:'hydro',l:'Hydro',c:'#94D2BD'},
  {k:'fossil',l:'Fossil',c:'#ED6965'},{k:'biomass',l:'Biomass',c:'#94D2BD'},
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
