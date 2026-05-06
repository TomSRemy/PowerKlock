// ════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════
const ENTSOE_TOKEN = 'YOUR_ENTSOE_TOKEN_HERE'; // Get free at transparency.entsoe.eu

// Zone config
const ZONES = [
  { code:'IT_SOUTH', flag:'🇮🇹', name:'Italy South', eic:'10Y1001A1001A788' },
  { code:'IT_NORD',  flag:'🇮🇹', name:'Italy North',  eic:'10Y1001A1001A73I' },
  { code:'HU',       flag:'🇭🇺', name:'Hungary',      eic:'10YHU-MAVIR----U' },
  { code:'SI',       flag:'🇸🇮', name:'Slovenia',     eic:'10YSI-ELES-----O' },
  { code:'RO',       flag:'🇷🇴', name:'Romania',      eic:'10YRO-TEL------P' },
  { code:'HR',       flag:'🇭🇷', name:'Croatia',      eic:'10YHR-HEP------M' },
  { code:'RS',       flag:'🇷🇸', name:'Serbia',       eic:'10YCS-SERBIATSOV' },
  { code:'GR',       flag:'🇬🇷', name:'Greece',       eic:'10YGR-HTSO-----Y' },
  { code:'MK',       flag:'🇲🇰', name:'N. Macedonia', eic:'10YMK-MEPSO----8' },
  { code:'BG',       flag:'🇧🇬', name:'Bulgaria',     eic:'10YCA-BULGARIA-R' },
  { code:'ME',       flag:'🇲🇪', name:'Montenegro',   eic:'10YCS-CG-TSO---S' },
  { code:'CH',       flag:'🇨🇭', name:'Switzerland',  eic:'10YCH-SWISSGRIDZ' },
  { code:'AT',       flag:'🇦🇹', name:'Austria',      eic:'10YAT-APG------L' },
  { code:'LT',       flag:'🇱🇹', name:'Lithuania',    eic:'10YLT-1001A0008Q' },
  { code:'LV',       flag:'🇱🇻', name:'Latvia',       eic:'10YLV-1001A00074' },
  { code:'EE',       flag:'🇪🇪', name:'Estonia',      eic:'10Y1001A1001A39I' },
  { code:'FI',       flag:'🇫🇮', name:'Finland',      eic:'10YFI-1--------U' },
  { code:'PT',       flag:'🇵🇹', name:'Portugal',     eic:'10YPT-REN------W' },
  { code:'SK',       flag:'🇸🇰', name:'Slovakia',     eic:'10YSK-SEPS-----K' },
  { code:'ES',       flag:'🇪🇸', name:'Spain',        eic:'10YES-REE------0' },
  { code:'DK_W',     flag:'🇩🇰', name:'Denmark West', eic:'10YDK-1--------W' },
  { code:'CZ',       flag:'🇨🇿', name:'Czechia',      eic:'10YCZ-CEPS-----N' },
  { code:'NO_2',     flag:'🇳🇴', name:'Norway Central',eic:'10YNO-2--------T' },
  { code:'DE_LU',    flag:'🇩🇪', name:'Germany',      eic:'10Y1001A1001A82H' },
  { code:'NL',       flag:'🇳🇱', name:'Netherlands',  eic:'10YNL----------L' },
  { code:'BE',       flag:'🇧🇪', name:'Belgium',      eic:'10YBE----------2' },
  { code:'NO_3',     flag:'🇳🇴', name:'Norway N-Mid', eic:'10YNO-3--------J' },
  { code:'NO_1',     flag:'🇳🇴', name:'Norway North', eic:'10YNO-1--------2' },
  { code:'SE_3',     flag:'🇸🇪', name:'Sweden N-Mid', eic:'10Y1001A1001A46L' },
  { code:'FR',       flag:'🇫🇷', name:'France',       eic:'10YFR-RTE------C' },
  { code:'GB',       flag:'🇬🇧', name:'Great Britain', eic:'10YGB----------A' },
  { code:'DK_E',     flag:'🇩🇰', name:'Denmark East', eic:'10YDK-2--------M' },
];

// ════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════
let currentPage = 'prices';
let pricesData = [];
let newsData = [];
let convUnit = 'MW';
let newsFilter = 'all';

// ════════════════════════════════════════════
// CLOCK
// ════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  const cet = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const h = String(cet.getHours()).padStart(2,'0');
  const m = String(cet.getMinutes()).padStart(2,'0');
  const s = String(cet.getSeconds()).padStart(2,'0');
  document.getElementById('clock').textContent = `${h}:${m}:${s} CET`;
}
setInterval(updateClock, 1000);
updateClock();

// ════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  const nav = document.getElementById('nav-' + id);
  if (nav) nav.classList.add('active');
  currentPage = id;
  // Lazy load
  if (id === 'genmix' && !window._genmixLoaded) loadGenMix();
  if (id === 'news' && !window._newsLoaded) loadNews();
  if (id === 'crossborder' && !window._cbLoaded) loadCrossBorder();
  if (id === 'load' && !window._loadLoaded) loadLoad();
  if (id === 'overview') loadOverview();
  if (id === 'converter') { updateConverter(); updateCapacity(); }
}

function switchSection(sec) {
  document.querySelectorAll('.topbar-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  if (sec === 'power') showPage('prices');
}

// ── SIDEBAR COLLAPSIBLE ──
function toggleSection(secId) {
  const sec = document.getElementById(secId);
  if (!sec) return;
  const items = sec.querySelector('.sidebar-section-items');
  if (sec.classList.contains('collapsed')) {
    sec.classList.remove('collapsed');
    items.style.maxHeight = items.scrollHeight + 'px';
  } else {
    items.style.maxHeight = items.scrollHeight + 'px';
    requestAnimationFrame(() => { sec.classList.add('collapsed'); });
  }
}

// Init max-heights on load
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sidebar-section-items').forEach(el => {
    const sec = el.closest('.sidebar-section');
    if (sec && sec.classList.contains('collapsed')) {
      el.style.maxHeight = '0px';
    } else {
      el.style.maxHeight = el.scrollHeight + 'px';
    }
  });
});

// ── DASHBOARD TABS ──
const AVAILABLE_WIDGETS = [
  { id:'fr-da',      name:'FR Prix DA',         desc:"Prix day-ahead France temps réel" },
  { id:'de-da',      name:'DE Prix DA',          desc:"Prix day-ahead Allemagne" },
  { id:'eua',        name:'EUA Spot',            desc:"Prix carbone EU ETS" },
  { id:'ttf',        name:'TTF D+1',             desc:"Gaz naturel TTF Day-Ahead" },
  { id:'go-renew',   name:'GO Renouvelables',    desc:"Garanties d'Origine Cal-26" },
  { id:'fr-mix',     name:'Mix FR',              desc:"Mix de génération France" },
  { id:'fr-nuclear', name:'Nucléaire FR',        desc:"Puissance nucléaire disponible" },
  { id:'fr-export',  name:'Solde Export FR',     desc:"Flux nets cross-border France" },
  { id:'fr-load',    name:'Consommation FR',     desc:"Charge réseau France" },
  { id:'hdd-paris',  name:'HDD Paris',           desc:"Degrés-jours de chauffage Paris" },
];
let myDashWidgets = JSON.parse(localStorage.getItem('pk-mydash-widgets') || '[]');

function switchDashboard(tab, btn) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const sidebar = document.getElementById('sidebar');

  if (tab === 'all') {
    sidebar.style.display = '';
    // hide special pages, show last standard page
    document.getElementById('page-france').classList.remove('active');
    document.getElementById('page-mydash').classList.remove('active');
    showPage('prices');
    return;
  }

  if (tab === 'france') {
    sidebar.style.display = 'none';
    // hide all standard pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-france').classList.add('active');
    loadFranceDashboard();
    return;
  }

  if (tab === 'mydash') {
    sidebar.style.display = 'none';
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-mydash').classList.add('active');
    renderMyDash();
    return;
  }
}

// ── FRANCE DASHBOARD ──
function loadFranceDashboard() {
  // KPIs - pull from pricesData if available
  if (typeof pricesData !== 'undefined' && pricesData.length) {
    const fr = pricesData.find(z => z.code === 'FR');
    if (fr) {
      document.getElementById('fr-da-price').textContent = fr.today != null ? fr.today.toFixed(1) : '--';
      const delta = fr.vsYday;
      const deltaEl = document.getElementById('fr-da-delta');
      if (delta != null) {
        deltaEl.textContent = (delta >= 0 ? '▲' : '▼') + Math.abs(delta).toFixed(1);
        deltaEl.className = 'kpi-delta ' + (delta >= 0 ? 'up' : 'down');
      }
    }
  }
  // Static placeholders for nuclear/renew/export
  document.getElementById('fr-nuclear').textContent = '42.3';
  document.getElementById('fr-renew').textContent = '18.7';
  document.getElementById('fr-export').textContent = '+8.4';

  // FR price chart (7 days) - use dummy data if real not loaded
  const ctx = document.getElementById('fr-price-chart');
  if (ctx) {
    const labels = ['J-6','J-5','J-4','J-3','J-2','J-1','Auj'];
    const vals = [58.2, 61.4, 45.8, 32.1, 12.4, 5.2, 1.2];
    if (window.Chart && !ctx._chart) {
      ctx._chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data: vals,
            borderColor: '#14D3A9',
            backgroundColor: 'rgba(0,212,168,0.08)',
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointRadius: 3,
            pointBackgroundColor: '#14D3A9'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4A6280', font: { size: 11 } } },
            y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4A6280', font: { size: 11 } }, title: { display: true, text: '€/MWh', color: '#4A6280', font: { size: 10 } } }
          }
        }
      });
    }
  }

  // Mix chart
  const mctx = document.getElementById('fr-mix-chart');
  if (mctx && window.Chart && !mctx._chart) {
    mctx._chart = new Chart(mctx, {
      type: 'doughnut',
      data: {
        labels: ['Nucléaire', 'Eolien', 'Solaire', 'Hydro', 'Gaz', 'Autres'],
        datasets: [{
          data: [42.3, 9.2, 5.1, 8.8, 3.4, 2.2],
          backgroundColor: ['#14D3A9','#C4A57B','#fbbf24','#94D2BD','#A87DC4','#4A6280'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#B8C9D9', font: { size: 11 }, padding: 10, boxWidth: 10 } }
        }
      }
    });
  }

  // REMIT placeholder
  document.getElementById('fr-remit-list').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="padding:8px 12px;background:var(--bg3);border-radius:6px;border-left:2px solid var(--warn)">
        <div style="font-size:11px;font-weight:600;color:var(--text)">Paluel 2 — maintenance</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">1 350 MW indisponible · jusqu'au 12 mai</div>
      </div>
      <div style="padding:8px 12px;background:var(--bg3);border-radius:6px;border-left:2px solid var(--warn)">
        <div style="font-size:11px;font-weight:600;color:var(--text)">Flamanville 1 — arrêt fortuit</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">1 330 MW indisponible · retour prévu 05 mai</div>
      </div>
      <div style="padding:8px 12px;background:var(--bg3);border-radius:6px;border-left:2px solid #4A6280">
        <div style="font-size:11px;font-weight:600;color:var(--text)">Belleville 1 — programmé</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">1 310 MW · rechargement combustible</div>
      </div>
    </div>`;
}

// ── MY DASHBOARD ──
function renderMyDash() {
  const grid = document.getElementById('mydash-grid');
  const empty = document.getElementById('mydash-empty');
  if (!myDashWidgets.length) {
    empty.style.display = 'flex';
    grid.innerHTML = '';
    grid.appendChild(empty);
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = myDashWidgets.map(id => {
    const w = AVAILABLE_WIDGETS.find(x => x.id === id);
    if (!w) return '';
    const val = getWidgetValue(id);
    return `<div class="mydash-widget">
      <button class="mdash-remove" onclick="removeWidget('${id}')">×</button>
      <div class="mydash-widget-title">${w.name}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:600;color:var(--text)">${val.val}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:3px">${val.unit}</div>
      ${val.chg ? `<div style="font-size:11px;font-family:'JetBrains Mono',monospace;color:${val.up ? 'var(--up)' : 'var(--down)'};margin-top:4px">${val.chg}</div>` : ''}
    </div>`;
  }).join('');
}

function getWidgetValue(id) {
  const map = {
    'fr-da':     { val:'1.2',  unit:'€/MWh', chg:'▼15.3', up:false },
    'de-da':     { val:'63.8', unit:'€/MWh', chg:'▼7.4',  up:false },
    'eua':       { val:'74.09',unit:'€/t',   chg:'▼0.09%',up:false },
    'ttf':       { val:'45.14',unit:'€/MWh', chg:'▲2.35%',up:true  },
    'go-renew':  { val:'0.42', unit:'€/MWh', chg:'',       up:null  },
    'fr-mix':    { val:'61%',  unit:'Nuc+ENR',chg:'',      up:null  },
    'fr-nuclear':{ val:'42.3', unit:'GW',    chg:'',       up:null  },
    'fr-export': { val:'+8.4', unit:'GW',    chg:'',       up:null  },
    'fr-load':   { val:'52.8', unit:'GW',    chg:'▲1.2%',  up:true  },
    'hdd-paris': { val:'4.2',  unit:'HDD',   chg:'',       up:null  },
  };
  return map[id] || { val:'--', unit:'', chg:'', up:null };
}

function removeWidget(id) {
  myDashWidgets = myDashWidgets.filter(x => x !== id);
  localStorage.setItem('pk-mydash-widgets', JSON.stringify(myDashWidgets));
  renderMyDash();
}

function openWidgetPicker() {
  const list = document.getElementById('widget-picker-list');
  list.innerHTML = AVAILABLE_WIDGETS.map(w => `
    <div class="picker-item ${myDashWidgets.includes(w.id) ? 'added' : ''}" onclick="toggleWidget('${w.id}', this)">
      <div class="picker-item-name">${myDashWidgets.includes(w.id) ? '✓ ' : ''}${w.name}</div>
      <div class="picker-item-desc">${w.desc}</div>
    </div>`).join('');
  document.getElementById('widget-picker').style.display = 'flex';
}

function closeWidgetPicker() {
  document.getElementById('widget-picker').style.display = 'none';
  renderMyDash();
}

function toggleWidget(id, el) {
  if (myDashWidgets.includes(id)) {
    myDashWidgets = myDashWidgets.filter(x => x !== id);
    el.classList.remove('added');
    el.querySelector('.picker-item-name').textContent = AVAILABLE_WIDGETS.find(w=>w.id===id).name;
  } else {
    myDashWidgets.push(id);
    el.classList.add('added');
    el.querySelector('.picker-item-name').textContent = '✓ ' + AVAILABLE_WIDGETS.find(w=>w.id===id).name;
  }
  localStorage.setItem('pk-mydash-widgets', JSON.stringify(myDashWidgets));
}

function exportDashConfig() {
  const cfg = { widgets: myDashWidgets, exported: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'powerklock-dashboard.json';
  a.click();
}



// ════════════════════════════════════════════
// ENTSOE API HELPER
// ════════════════════════════════════════════
async function fetchEntsoe(params) {
  const base = 'https://web-api.tp.entsoe.eu/api';
  const url = `${base}?securityToken=${ENTSOE_TOKEN}&${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`ENTSO-E ${resp.status}`);
  return resp.text();
}

function parseXmlPrices(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const points = doc.querySelectorAll('Point');
  const prices = [];
  points.forEach(p => {
    const pos = parseInt(p.querySelector('position')?.textContent || '0');
    const val = parseFloat(p.querySelector('price\\.amount')?.textContent || '0');
    if (val) prices.push({ hour: pos - 1, price: val });
  });
  return prices;
}

function todayStr() {
  const now = new Date();
  const cet = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const y = cet.getFullYear();
  const m = String(cet.getMonth() + 1).padStart(2, '0');
  const d = String(cet.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function dateParam(offset = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offset);
  const cet = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const y = cet.getFullYear();
  const m = String(cet.getMonth() + 1).padStart(2, '0');
  const d = String(cet.getDate()).padStart(2, '0');
  return `${y}${m}${d}0000`;
}

// ════════════════════════════════════════════
// DEMO DATA (used when no token set)
// ════════════════════════════════════════════
// Generate 96-point (15min) hourly profile for demo data
function gen96(avg, min, max, negSlot) {
  // Shape: low at night, solar dip midday (duck curve), evening peak
  const shape96 = [];
  for (let i = 0; i < 96; i++) {
    const h = i / 4; // fractional hour
    let v;
    if (h < 6)       v = 0.30 + 0.10 * Math.sin(h / 6 * Math.PI);
    else if (h < 10) v = 0.30 + 0.70 * ((h-6)/4);
    else if (h < 14) v = 1.00 - 0.30 * Math.sin((h-10)/4 * Math.PI); // solar dip
    else if (h < 19) v = 0.70 + 0.30 * ((h-14)/5);
    else if (h < 21) v = 1.00;
    else             v = 1.00 - 0.70 * ((h-21)/3);
    shape96.push(v);
  }
  const range = max - min;
  return shape96.map((p, i) => {
    let val = min + p * range + (Math.random() - 0.5) * range * 0.06;
    // Inject negative prices in negSlot hours (midday)
    if (negSlot > 0 && i >= 40 && i < 40 + negSlot * 4) val = min * (0.5 + Math.random() * 0.5);
    return Math.round(val * 10) / 10;
  });
}

let _demoCached = null;
function getDemoData() {
  if (_demoCached) return _demoCached;
  _demoCached = _buildDemoData();
  return _demoCached;
}
function _buildDemoData() {
  return [
    { code:'IT_SOUTH', flag:'🇮🇹', name:'Italy South',    today:115.8, vsYday:+12.0, min:54.7,  minHr:10, max:169.1, maxHr:18, negHrs:0, spark:+23.7, hourly: gen96(115.8, 54.7, 169.1, 0) },
    { code:'IT_NORD',  flag:'🇮🇹', name:'Italy North',    today:115.1, vsYday:+12.7, min:54.7,  minHr:10, max:153.5, maxHr:18, negHrs:0, spark:+23,   hourly: gen96(115.1, 54.7, 153.5, 0) },
    { code:'HU',       flag:'🇭🇺', name:'Hungary',        today:109.8, vsYday:+4.1,  min:-0.8,  minHr:12, max:249.9, maxHr:18, negHrs:1, spark:+17.7, hourly: gen96(109.8, -0.8, 249.9, 1) },
    { code:'SI',       flag:'🇸🇮', name:'Slovenia',       today:109.5, vsYday:+6.6,  min:54.7,  minHr:10, max:149.7, maxHr:18, negHrs:0, spark:+17.4, hourly: gen96(109.5, 54.7, 149.7, 0) },
    { code:'RO',       flag:'🇷🇴', name:'Romania',        today:108.5, vsYday:+17.8, min:12.0,  minHr:11, max:227.3, maxHr:18, negHrs:0, spark:+16.4, hourly: gen96(108.5, 12.0, 227.3, 0) },
    { code:'HR',       flag:'🇭🇷', name:'Croatia',        today:108.5, vsYday:+7.7,  min:48.7,  minHr:11, max:168.7, maxHr:18, negHrs:0, spark:+16.4, hourly: gen96(108.5, 48.7, 168.7, 0) },
    { code:'GR',       flag:'🇬🇷', name:'Greece',         today:102.7, vsYday:+21.8, min:0.0,   minHr:7,  max:194.1, maxHr:17, negHrs:2, spark:+10.6, hourly: gen96(102.7, 0.0, 194.1, 2) },
    { code:'BG',       flag:'🇧🇬', name:'Bulgaria',       today:98.2,  vsYday:+16.7, min:6.9,   minHr:7,  max:194.1, maxHr:17, negHrs:0, spark:+6.1,  hourly: gen96(98.2, 6.9, 194.1, 0) },
    { code:'CH',       flag:'🇨🇭', name:'Switzerland',    today:94.0,  vsYday:+2.4,  min:40.0,  minHr:13, max:140.0, maxHr:18, negHrs:0, spark:+1.9,  hourly: gen96(94.0, 40.0, 140.0, 0) },
    { code:'AT',       flag:'🇦🇹', name:'Austria',        today:87.8,  vsYday:-4.3,  min:7.1,   minHr:13, max:137.4, maxHr:18, negHrs:0, spark:-4.3,  hourly: gen96(87.8, 7.1, 137.4, 0) },
    { code:'LT',       flag:'🇱🇹', name:'Lithuania',      today:87.7,  vsYday:+30.0, min:15.6,  minHr:13, max:174.0, maxHr:18, negHrs:0, spark:-4.4,  hourly: gen96(87.7, 15.6, 174.0, 0) },
    { code:'PT',       flag:'🇵🇹', name:'Portugal',       today:76.1,  vsYday:+19.2, min:14.2,  minHr:13, max:112.1, maxHr:19, negHrs:0, spark:-16,   hourly: gen96(76.1, 14.2, 112.1, 0) },
    { code:'ES',       flag:'🇪🇸', name:'Spain',          today:75.5,  vsYday:+18.4, min:16.0,  minHr:13, max:109.0, maxHr:19, negHrs:0, spark:-16.6, hourly: gen96(75.5, 16.0, 109.0, 0) },
    { code:'DK_W',     flag:'🇩🇰', name:'Denmark West',   today:73.8,  vsYday:-3.0,  min:-15.8, minHr:13, max:145.8, maxHr:18, negHrs:5, spark:-18.3, hourly: gen96(73.8, -15.8, 145.8, 5) },
    { code:'CZ',       flag:'🇨🇿', name:'Czechia',        today:73.0,  vsYday:-6.4,  min:-29.9, minHr:12, max:136.5, maxHr:18, negHrs:5, spark:-19.1, hourly: gen96(73.0, -29.9, 136.5, 5) },
    { code:'FI',       flag:'🇫🇮', name:'Finland',        today:67.8,  vsYday:+45.6, min:16.1,  minHr:13, max:127.9, maxHr:18, negHrs:0, spark:-24.3, hourly: gen96(67.8, 16.1, 127.9, 0) },
    { code:'DE_LU',    flag:'🇩🇪', name:'Germany',        today:63.8,  vsYday:-7.4,  min:-58.1, minHr:11, max:142.8, maxHr:18, negHrs:7, spark:-28.3, hourly: gen96(63.8, -58.1, 142.8, 7) },
    { code:'NL',       flag:'🇳🇱', name:'Netherlands',    today:57.5,  vsYday:-3.3,  min:-56.8, minHr:11, max:145.6, maxHr:18, negHrs:7, spark:-34.6, hourly: gen96(57.5, -56.8, 145.6, 7) },
    { code:'BE',       flag:'🇧🇪', name:'Belgium',        today:49.1,  vsYday:-10.8, min:-55.0, minHr:11, max:134.0, maxHr:17, negHrs:6, spark:-43,   hourly: gen96(49.1, -55.0, 134.0, 6) },
    { code:'SE_3',     flag:'🇸🇪', name:'Sweden N-Mid',   today:40.0,  vsYday:+21.3, min:11.8,  minHr:23, max:104.0, maxHr:5,  negHrs:0, spark:-52.1, hourly: gen96(40.0, 11.8, 104.0, 0) },
    { code:'NO_2',     flag:'🇳🇴', name:'Norway Central', today:39.8,  vsYday:+12.2, min:8.8,   minHr:22, max:103.7, maxHr:5,  negHrs:0, spark:-52.3, hourly: gen96(39.8, 8.8, 103.7, 0) },
    { code:'FR',       flag:'🇫🇷', name:'France',         today:1.2,   vsYday:-15.3, min:-48.6, minHr:11, max:36.0,  maxHr:5,  negHrs:7, spark:+2,    hourly: gen96(1.2, -48.6, 36.0, 7),
      hourlyYday: gen96(16.5, -12.0, 55.0, 3), hourlyJ2: gen96(28.0, -5.0, 70.0, 1) },
    { code:'GB',       flag:'🇬🇧', name:'Great Britain',  today:88.4,  vsYday:+5.1,  min:42.0,  minHr:13, max:150.0, maxHr:18, negHrs:0, spark:+2,    hourly: gen96(88.4, 42.0, 150.0, 0) },
  ];
}

// Fix: define loadPricesWithDates as alias calling loadPrices with date overrides
async function loadPricesWithDates(periodStart, periodEnd) {
  // periodStart/periodEnd format: YYYYMMDD0000
  if (!ENTSOE_TOKEN || ENTSOE_TOKEN === 'YOUR_ENTSOE_TOKEN_HERE') {
    document.getElementById('prices-updated').textContent = 'Historical data unavailable in demo mode';
    return;
  }
  try {
    const results = [];
    const batch = async (zones) => {
      const promises = zones.map(async zone => {
        try {
          const xml = await fetchEntsoe(
            `documentType=A44&in_Domain=${zone.eic}&out_Domain=${zone.eic}&periodStart=${periodStart}&periodEnd=${periodEnd}`
          );
          const prices = parseXmlPrices(xml);
          if (prices.length === 0) return null;
          const vals = prices.map(p => p.price);
          const avg = vals.reduce((a,b) => a+b, 0) / vals.length;
          const minP = Math.min(...vals), maxP = Math.max(...vals);
          const minHr = prices.find(p => p.price===minP)?.hour || 0;
          const maxHr = prices.find(p => p.price===maxP)?.hour || 0;
          const negHrs = vals.filter(v => v < 0).length;
          return { ...zone, today: Math.round(avg*10)/10, min: Math.round(minP*10)/10, minHr, max: Math.round(maxP*10)/10, maxHr, negHrs, hourly: vals, vsYday: null, spark: null };
        } catch { return null; }
      });
      return (await Promise.all(promises)).filter(Boolean);
    };
    const batchSize = 6;
    const histDateISO = `${periodStart.slice(0,4)}-${periodStart.slice(4,6)}-${periodStart.slice(6,8)}`;
    for (let i = 0; i < ZONES.length; i += batchSize) {
      const batchRes = await batch(ZONES.slice(i, i+batchSize));
      results.push(...batchRes);
      pricesData = results.sort((a,b) => b.today - a.today);
      renderPricesTable(pricesData);
      updateKPIs(pricesData, histDateISO);
    }
    buildTicker(pricesData);
    document.getElementById('prices-updated').textContent = `Historical · ${periodStart.slice(0,8)}`;
  } catch(e) {
    console.error(e);
    document.getElementById('prices-updated').textContent = 'Error loading historical data';
  }
}

// ════════════════════════════════════════════
// LOAD PRICES
// ════════════════════════════════════════════
async function loadPrices() {
  _demoCached = null;
  const isDemo = ENTSOE_TOKEN === 'YOUR_ENTSOE_TOKEN_HERE';

  if (isDemo) {
    // No token — load last available historical data instead of demo
    if (typeof loadLastAvailable === 'function') {
      loadLastAvailable();
    }
    return;
  }

  // Real ENTSO-E fetch
  try {
    const periodStart = dateParam(0);
    const periodEnd = dateParam(1);
    const results = [];

    // Fetch in parallel batches of 6
    const batch = async (zones) => {
      const promises = zones.map(async zone => {
        try {
          const xml = await fetchEntsoe(
            `documentType=A44&in_Domain=${zone.eic}&out_Domain=${zone.eic}&periodStart=${periodStart}&periodEnd=${periodEnd}`
          );
          const prices = parseXmlPrices(xml);
          if (prices.length === 0) return null;
          const vals = prices.map(p => p.price);
          const avg = vals.reduce((a,b) => a+b, 0) / vals.length;
          const minP = Math.min(...vals);
          const maxP = Math.max(...vals);
          const minHr = prices.find(p => p.price === minP)?.hour || 0;
          const maxHr = prices.find(p => p.price === maxP)?.hour || 0;
          const negHrs = vals.filter(v => v < 0).length;
          return { ...zone, today: Math.round(avg * 10)/10, min: Math.round(minP*10)/10, minHr, max: Math.round(maxP*10)/10, maxHr, negHrs, hourly: vals, vsYday: null, spark: null };
        } catch { return null; }
      });
      return (await Promise.all(promises)).filter(Boolean);
    };

    const liveDateISO = `${periodStart.slice(0,4)}-${periodStart.slice(4,6)}-${periodStart.slice(6,8)}`;
    const batchSize = 6;
    for (let i = 0; i < ZONES.length; i += batchSize) {
      const batchResults = await batch(ZONES.slice(i, i + batchSize));
      results.push(...batchResults);
      pricesData = results.sort((a,b) => b.today - a.today);
      renderPricesTable(pricesData);
      updateKPIs(pricesData, liveDateISO);
    }

    buildTicker(pricesData);
    dpRecordNegHours(pricesData);
    const now = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', hour:'2-digit', minute:'2-digit' });
    document.getElementById('prices-updated').textContent = `Updated ${now} CET`;

  } catch (e) {
    console.error(e);
    document.getElementById('prices-tbody').innerHTML =
      `<tr class="loading-row"><td colspan="8" style="color:var(--down)">⚠ Could not fetch ENTSO-E data. Check your token or use demo mode.</td></tr>`;
  }
}

function updateKPIs(data, dataDateStr) {
  const fr = data.find(d => d.code === 'FR');
  const de = data.find(d => d.code === 'DE_LU');
  const avg = data.reduce((a,b) => a + b.today, 0) / data.length;
  const maxZ = data[0];
  const minZ = data[data.length - 1];

  // Resolve display date for MAX/MIN labels
  const todayISO = new Date().toISOString().slice(0,10);
  const displayDate = dataDateStr || window.DP?.selectedDate || todayISO;
  const fmtShort = s => {
    const [y,m,d] = s.split('-');
    return new Date(+y, +m-1, +d).toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
  };

  // Reset all cards to flat — async vs-J-1 colorisation runs after
  ['kpicard-fr','kpicard-de','kpicard-avg','kpicard-peak','kpicard-offpeak','kpicard-max','kpicard-min']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('kpi-up','kpi-down');
        el.classList.add('kpi-flat');
      }
    });

  // Main values — neutral colour everywhere
  if (fr) {
    document.getElementById('kpi-fr').innerHTML = `${fr.today.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
  }
  if (de) {
    document.getElementById('kpi-de').innerHTML = `${de.today.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
  }
  document.getElementById('kpi-avg').innerHTML = `${avg.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
  document.getElementById('kpi-avg-chg').textContent = `${data.length} zones loaded`;

  // MAX / MIN — date in label, zone in sub
  const dateLbl = fmtShort(displayDate);
  const maxLbl = document.getElementById('kpi-max-label');
  const minLbl = document.getElementById('kpi-min-label');
  if (maxLbl) maxLbl.textContent = `Max ${dateLbl}`;
  if (minLbl) minLbl.textContent = `Min ${dateLbl}`;
  document.getElementById('kpi-max').innerHTML = `${maxZ.today.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
  document.getElementById('kpi-min').innerHTML = `${minZ.today.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;

  // Peak / Off-Peak FR
  let peakAvg = null, offPeakAvg = null;
  if (fr && fr.hourly && fr.hourly.length >= 24) {
    const h = fr.hourly;
    const nPerHour = Math.round(h.length / 24);
    const peakVals = [], offPeakVals = [];
    h.forEach((v, i) => {
      if (v == null) return;
      const hr = Math.floor(i / nPerHour);
      (hr >= 8 && hr < 20 ? peakVals : offPeakVals).push(v);
    });
    peakAvg    = peakVals.length    ? peakVals.reduce((a,b)=>a+b,0)/peakVals.length       : fr.today;
    offPeakAvg = offPeakVals.length ? offPeakVals.reduce((a,b)=>a+b,0)/offPeakVals.length : fr.today;
    const el_pk = document.getElementById('kpi-fr-peak');
    const el_op = document.getElementById('kpi-fr-offpeak');
    if (el_pk) el_pk.innerHTML = `${peakAvg.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
    if (el_op) el_op.innerHTML = `${offPeakAvg.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
  }

  // Async: fetch J-1 and apply direction-based colouring on borders + sub-texts
  const today = {
    fr:        fr ? fr.today : null,
    de:        de ? de.today : null,
    avg,
    frPeak:    peakAvg,
    frOffPeak: offPeakAvg,
    maxLvl:    maxZ ? maxZ.today : null,
    minLvl:    minZ ? minZ.today : null,
  };
  applyVsYesterdayColours(displayDate, today, { fr, de, maxZ, minZ, dataDateStr: displayDate, zoneCount: data.length });
}

// Apply vs-J-1 colour on every KPI card.
// Line 3 (kpi-chg) = delta vs J-1 only, coloured to match border.
// Line 4 (kpi-meta) = static context (zones count for AVG, country for MAX/MIN, hours for peak/off-peak).
async function applyVsYesterdayColours(displayDate, today, ctx) {
  if (typeof fetchYesterdayDaily !== 'function') return;
  const yData = await fetchYesterdayDaily(displayDate);
  const yKpi  = yData ? computeKPIs(yData.zones) : null;

  const directionFromDelta = (delta) => {
    if (delta == null || isNaN(delta) || Math.abs(delta) < 1) return { cls:'kpi-flat', txtColor:'var(--text3)' };
    return delta > 0
      ? { cls:'kpi-down', txtColor:'var(--down)' }
      : { cls:'kpi-up',   txtColor:'var(--up)' };
  };

  const setCard = (cardId, todayVal, ydayVal, payloadDelta) => {
    const card = document.getElementById(cardId);
    if (!card) return null;
    let delta = null;
    if (payloadDelta != null && !isNaN(payloadDelta)) delta = payloadDelta;
    else if (todayVal != null && ydayVal != null)     delta = todayVal - ydayVal;
    const dir = directionFromDelta(delta);
    card.classList.remove('kpi-up','kpi-down','kpi-flat');
    card.classList.add(dir.cls);
    return { delta, ...dir };
  };

  // Line 3: delta vs J-1 only (no extra info), tinted to match border colour
  const renderChg = (chgId, dir) => {
    const el = document.getElementById(chgId);
    if (!el) return;
    el.style.color = dir.txtColor;
    if (dir.delta != null && !isNaN(dir.delta)) {
      const arrow = dir.delta > 0 ? '▲' : dir.delta < 0 ? '▼' : '·';
      const sign  = dir.delta > 0 ? '+' : '';
      el.textContent = `${arrow} ${sign}${dir.delta.toFixed(1)} vs J-1`;
    } else {
      el.textContent = '--';
    }
  };

  // FR
  const frDir = setCard('kpicard-fr', today.fr,
    yData ? (yData.zones.FR?.avg ?? null) : null, ctx.fr?.vsYday);
  if (frDir) renderChg('kpi-fr-chg', frDir);

  // DE
  const deDir = setCard('kpicard-de', today.de,
    yData ? (yData.zones.DE_LU?.avg ?? null) : null, ctx.de?.vsYday);
  if (deDir) renderChg('kpi-de-chg', deDir);

  // EU avg
  const avgDir = setCard('kpicard-avg', today.avg, yKpi ? yKpi.avg : null);
  if (avgDir) {
    renderChg('kpi-avg-chg', avgDir);
    const meta = document.getElementById('kpi-avg-meta');
    if (meta) meta.textContent = `${ctx.zoneCount ?? '--'} zones`;
  }

  // Peak
  const pkDir = setCard('kpicard-peak', today.frPeak, yKpi ? yKpi.frPeak : null);
  if (pkDir) renderChg('kpi-fr-peak-chg', pkDir);

  // Off-peak
  const opDir = setCard('kpicard-offpeak', today.frOffPeak, yKpi ? yKpi.frOffPeak : null);
  if (opDir) renderChg('kpi-fr-offpeak-chg', opDir);

  // Max
  const maxDir = setCard('kpicard-max', today.maxLvl, yKpi ? yKpi.maxLvl : null);
  if (maxDir) {
    renderChg('kpi-max-chg', maxDir);
    const zone = document.getElementById('kpi-max-zone');
    if (zone) zone.textContent = ctx.maxZ ? `${ctx.maxZ.flag} ${ctx.maxZ.name}` : '--';
  }

  // Min
  const minDir = setCard('kpicard-min', today.minLvl, yKpi ? yKpi.minLvl : null);
  if (minDir) {
    renderChg('kpi-min-chg', minDir);
    const zone = document.getElementById('kpi-min-zone');
    if (zone) zone.textContent = ctx.minZ ? `${ctx.minZ.flag} ${ctx.minZ.name}` : '--';
  }
}

// Country code → ISO2 + display name mapping
const FLAG_MAP = {
  FR:'🇫🇷', DE_LU:'🇩🇪', BE:'🇧🇪', NL:'🇳🇱', ES:'🇪🇸', PT:'🇵🇹',
  IT_NORD:'🇮🇹', IT_SICI:'🇮🇹', AT:'🇦🇹', CH:'🇨🇭', CZ:'🇨🇿', SK:'🇸🇰',
  HU:'🇭🇺', PL:'🇵🇱', RO:'🇷🇴', HR:'🇭🇷', SI:'🇸🇮', RS:'🇷🇸', BG:'🇧🇬',
  GR:'🇬🇷', MK:'🇲🇰', ME:'🇲🇪', DK_W:'🇩🇰', DK_E:'🇩🇰',
  SE:'🇸🇪', SE_3:'🇸🇪', NO_1:'🇳🇴', NO_2:'🇳🇴', FI:'🇫🇮',
  EE:'🇪🇪', LV:'🇱🇻', LT:'🇱🇹', GB:'🇬🇧', MT:'🇲🇹',
};
const FR_NEIGHBOURS = new Set(['FR','DE_LU','BE','NL','ES','GB','IT_NORD','CH','AT']);

const ZONE_META = {
  'FR':      {cc:'FR', country:'France'},       'DE_LU':   {cc:'DE', country:'Germany'},
  'BE':      {cc:'BE', country:'Belgium'},       'NL':      {cc:'NL', country:'Netherlands'},
  'ES':      {cc:'ES', country:'Spain'},         'PT':      {cc:'PT', country:'Portugal'},
  'IT_NORD': {cc:'IT', country:'Italy North'},   'IT_SOUTH':{cc:'IT', country:'Italy South'},
  'IT_SICI': {cc:'IT', country:'Italy Sicily'},  'AT':      {cc:'AT', country:'Austria'},
  'CH':      {cc:'CH', country:'Switzerland'},   'CZ':      {cc:'CZ', country:'Czechia'},
  'SK':      {cc:'SK', country:'Slovakia'},      'HU':      {cc:'HU', country:'Hungary'},
  'PL':      {cc:'PL', country:'Poland'},        'RO':      {cc:'RO', country:'Romania'},
  'HR':      {cc:'HR', country:'Croatia'},       'SI':      {cc:'SI', country:'Slovenia'},
  'RS':      {cc:'RS', country:'Serbia'},        'BG':      {cc:'BG', country:'Bulgaria'},
  'GR':      {cc:'GR', country:'Greece'},        'MK':      {cc:'MK', country:'N. Macedonia'},
  'ME':      {cc:'ME', country:'Montenegro'},    'DK_W':    {cc:'DK', country:'Denmark W'},
  'DK_E':    {cc:'DK', country:'Denmark E'},     'SE':      {cc:'SE', country:'Sweden'},
  'SE_3':    {cc:'SE', country:'Sweden Mid'},    'NO_1':    {cc:'NO', country:'Norway N'},
  'NO_2':    {cc:'NO', country:'Norway C'},      'FI':      {cc:'FI', country:'Finland'},
  'EE':      {cc:'EE', country:'Estonia'},       'LV':      {cc:'LV', country:'Latvia'},
  'LT':      {cc:'LT', country:'Lithuania'},     'GB':      {cc:'GB', country:'Great Britain'},
  'MT':      {cc:'MT', country:'Malta'},
};

window._pricesFilterText = '';

function filterPricesTable(text) {
  window._pricesFilterText = (text||'').toLowerCase().trim();
  renderPricesTableBody();
}

function renderPricesTable(data, dataDateStr) {
  // dataDateStr: the date the data actually comes from (may differ from DP.selectedDate)
  const fmtLong = s => { const [y,m,d]=s.split('-'); return new Date(+y,+m-1,+d).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}); };
  const todayISO = new Date().toISOString().slice(0,10);
  const displayDate = dataDateStr || window.DP?.selectedDate || todayISO;
  const dateLabel = document.getElementById('prices-date-label');
  if (dateLabel) dateLabel.textContent = 'Day-Ahead prices · ' + fmtLong(displayDate) + ' · ENTSO-E';
  // Remove loading row if still there
  const loadingRow = document.querySelector('#prices-tbody .loading-row');
  if (loadingRow) loadingRow.remove();

  const sorted = [...data].sort((a,b) => b.today - a.today);
  window._pricesSorted = sorted;
  window._pricesSortDir = window._pricesSortDir || {};
  window._compareZones = window._compareZones || new Set(['FR']);
  renderPricesTableBody();
  buildZoneFilterDropdown();
  renderCompareChart();
  buildCompareChips();
}

// ── Zone filter panel
function positionPanel(panelId, btnId) {
  const panel = document.getElementById(panelId);
  const btn   = document.getElementById(btnId);
  if (!panel || !btn) return;
  const r = btn.getBoundingClientRect();
  panel.style.top  = (r.bottom + 4) + 'px';
  // Prefer left-aligned; if off-screen, right-align
  const leftPos = r.left;
  const panelW  = 300;
  if (leftPos + panelW > window.innerWidth - 10) {
    panel.style.left = 'auto';
    panel.style.right = (window.innerWidth - r.right) + 'px';
  } else {
    panel.style.left  = leftPos + 'px';
    panel.style.right = 'auto';
  }
}

function toggleZoneFilterPanel() {
  const panel   = document.getElementById('zone-filter-panel');
  const overlay = document.getElementById('zone-filter-overlay');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display   = isOpen ? 'none' : 'block';
  if (overlay) overlay.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) { positionPanel('zone-filter-panel','zone-filter-btn'); buildZoneFilterDropdown(); }
  const cp = document.getElementById('compare-filter-panel');
  if (cp) cp.style.display = 'none';
}

function selectAllZones() {
  if (!window._pricesSorted) return;
  window._pricesZoneFilter = null;
  applyZoneFilter();
}

function selectNeighbours() {
  window._pricesZoneFilter = new Set(['FR','DE_LU','BE','NL','ES','IT_NORD','CH','AT','PT']);
  applyZoneFilter();
}

function selectWithGenMix() {
  const gmKeys = window._genmixData ? Object.keys(window._genmixData) : ['FR','DE_LU','ES','BE','NL','IT_NORD'];
  window._pricesZoneFilter = new Set(gmKeys);
  applyZoneFilter();
}

function applyZoneFilter() {
  // Rebuild dropdown (visual state of checkboxes)
  buildZoneFilterDropdown();
  // Re-render table with new filter
  renderPricesTableBody();
  // Update button label
  const lbl = document.getElementById('zone-filter-label');
  if (lbl) {
    const zones = (window._pricesSorted||[]).filter(z=>z.today!=null);
    const n = window._pricesZoneFilter ? window._pricesZoneFilter.size : zones.length;
    lbl.textContent = window._pricesZoneFilter ? `${n} / ${zones.length} zones` : 'All zones';
  }
}

function selectAllCompareZones() {
  if (!window._pricesSorted) return;
  window._compareZones = new Set(window._pricesSorted.map(z=>z.code));
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
}

document.addEventListener('click', e => {
  // Close zone filter panel if clicking outside both the button and the panel
  const zBtn   = document.getElementById('zone-filter-btn');
  const zPanel = document.getElementById('zone-filter-panel');
  if (zPanel && zPanel.style.display !== 'none') {
    if (!zBtn?.contains(e.target) && !zPanel.contains(e.target)) {
      zPanel.style.display = 'none';
      const ov2 = document.getElementById('zone-filter-overlay');
      if (ov2) ov2.style.display = 'none';

    }
  }
  const cBtn   = document.getElementById('compare-filter-btn');
  const cPanel = document.getElementById('compare-filter-panel');
  if (cPanel && cPanel.style.display !== 'none') {
    if (!cBtn?.contains(e.target) && !cPanel.contains(e.target)) {
      cPanel.style.display = 'none';
    }
  }
});

function buildZoneFilterDropdown() {
  const container = document.getElementById('zone-filter-chips');
  if (!container || !window._pricesSorted) return;
  const active = window._pricesZoneFilter; // null = all active
  const zones  = window._pricesSorted.filter(z => z.today != null && !isNaN(z.today));

  // Group by country (CC)
  const byCC = {};
  zones.forEach(z => {
    const meta = ZONE_META[z.code] || {cc: z.code, country: z.name || z.code};
    const cc = meta.cc || z.code;
    if (!byCC[cc]) byCC[cc] = {cc, country: meta.country, zones: []};
    byCC[cc].zones.push(z);
  });

  const checkSvg = (color) =>
    `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  // Render: country header row + zone rows
  let html = '';
  Object.values(byCC).forEach(group => {
    const allOn = group.zones.every(z => !active || active.has(z.code));
    const someOn = group.zones.some(z => !active || active.has(z.code));

    // Country header — click toggles all zones in country
    html += `<button onclick="toggleCountryFilter('${group.cc}')" style="
      display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;
      border:none;text-align:left;margin-top:4px;
      background:${allOn ? 'rgba(0,212,168,.08)' : 'transparent'};
      color:${allOn ? '#14D3A9' : someOn ? '#FBBF24' : 'rgba(255,255,255,.35)'};
    ">
      <span style="width:14px;height:14px;border-radius:3px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
        border:1.5px solid ${allOn?'#14D3A9':someOn?'#FBBF24':'rgba(255,255,255,.2)'};
        background:${allOn?'rgba(0,212,168,.2)':someOn?'rgba(245,158,11,.15)':'transparent'}">
        ${allOn ? checkSvg('#14D3A9') : someOn ? '<div style="width:6px;height:2px;background:#FBBF24;border-radius:1px"></div>' : ''}
      </span>
      <span style="letter-spacing:.04em">${group.cc} — ${group.country}</span>
      <span style="margin-left:auto;font-size:10px;font-weight:400;color:var(--tx3)">${group.zones.length} zone${group.zones.length>1?'s':''}</span>
    </button>`;

    // Zone rows (indented) — only show if country has >1 zone
    if (group.zones.length > 1) {
      group.zones.forEach(z => {
        const isOn = !active || active.has(z.code);
        html += `<button onclick="toggleZoneChip('${z.code}')" id="zchip-${z.code}" style="
          display:flex;align-items:center;gap:5px;width:100%;padding:4px 8px 4px 26px;border-radius:5px;font-size:11px;cursor:pointer;
          border:none;text-align:left;
          background:${isOn ? 'rgba(0,212,168,.06)' : 'transparent'};
          color:${isOn ? '#14D3A9' : 'rgba(255,255,255,.35)'};
        ">
          <span style="width:12px;height:12px;border-radius:2px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
            border:1.5px solid ${isOn?'#14D3A9':'rgba(255,255,255,.15)'};
            background:${isOn?'rgba(0,212,168,.2)':'transparent'}">
            ${isOn ? checkSvg('#14D3A9') : ''}
          </span>
          <span style="font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${isOn?'var(--acc)':'rgba(255,255,255,.4)'};min-width:56px">${z.flag||''} ${z.code}</span>
          <span>${(ZONE_META[z.code]||{}).country||z.name||z.code}</span>
        </button>`;
      });
    }
  });

  container.innerHTML = html;

  // Update button label
  const lbl = document.getElementById('zone-filter-label');
  if (lbl) {
    const nOn = active ? active.size : zones.length;
    lbl.textContent = active ? `${nOn} / ${zones.length} zones` : 'All zones';
  }
}

function toggleCountryFilter(cc) {
  const zones = (window._pricesSorted || []).filter(z => {
    const meta = ZONE_META[z.code] || {cc: z.code};
    return (meta.cc || z.code) === cc && z.today != null;
  });
  if (!zones.length) return;

  const allCodes = new Set((window._pricesSorted||[]).filter(z=>z.today!=null).map(z=>z.code));
  // Init filter if null
  if (!window._pricesZoneFilter) window._pricesZoneFilter = new Set(allCodes);

  const ccCodes = zones.map(z=>z.code);
  const allOn = ccCodes.every(c => window._pricesZoneFilter.has(c));

  if (allOn) {
    ccCodes.forEach(c => window._pricesZoneFilter.delete(c));
    // Garder le Set même vide — ne pas reset à null
  } else {
    ccCodes.forEach(c => window._pricesZoneFilter.add(c));
    if (window._pricesZoneFilter.size === allCodes.size) window._pricesZoneFilter = null;
  }

  buildZoneFilterDropdown();
  renderPricesTableBody();
}

function toggleZoneChip(code) {
  const zones = (window._pricesSorted || []).filter(z => z.today != null && !isNaN(z.today));
  const allCodes = new Set(zones.map(z => z.code));

  // null = tous actifs → initialiser avec tous
  if (window._pricesZoneFilter === null) {
    window._pricesZoneFilter = new Set(allCodes);
  }

  if (window._pricesZoneFilter.has(code)) {
    window._pricesZoneFilter.delete(code);
    // Si tout décoché → garder le Set vide (ne pas reset à null)
  } else {
    window._pricesZoneFilter.add(code);
    // Si tout coché → reset à null (= "All zones")
    if (window._pricesZoneFilter.size === allCodes.size) window._pricesZoneFilter = null;
  }

  buildZoneFilterDropdown();
  renderPricesTableBody();
}

function filterPricesZones(sel) {
  // legacy shim
  const vals = Array.from(sel.selectedOptions||[]).map(o=>o.value);
  window._pricesZoneFilter = vals.length ? new Set(vals) : null;
  renderPricesTableBody();
}

function clearZoneFilter() {
  window._pricesZoneFilter = new Set(); // Set vide = rien affiché
  applyZoneFilter();
}

function renderPricesTableBody() {
  const sorted = window._pricesSorted;
  if (!sorted) return;
  const zoneFilter = window._pricesZoneFilter;
  const tbody = document.getElementById('prices-tbody');
  if (!tbody) return;

  const negFmt = (h) => {
    if (!h || h <= 0) return '<span style="color:var(--tx3)">–</span>';
    const totalSlots = Math.round(h * 4);
    const hrs = Math.floor(totalSlots / 4), rem = totalSlots % 4;
    const label = hrs > 0 ? (rem > 0 ? `${hrs}h${rem*15}` : `${hrs}h`) : `${rem*15}min`;
    return `<span style="color:var(--warn);font-weight:600">${label}</span>`;
  };

  // Fuel config for domFuel
  const fuelOrder = ['nuclear','wind','solar','hydro','biomass','fossil'];
  const fuelMeta = {
    nuclear: {emoji:'⚛', label:'Nuclear',  color:C_NUC},
    wind:    {emoji:'🌬', label:'Wind',     color:C_WIND},
    solar:   {emoji:'☀', label:'Solar',    color:C_SOLAR},
    hydro:   {emoji:'💧', label:'Hydro',    color:C_HYD},
    biomass: {emoji:'🌿', label:'Biomass',  color:C_BIO},
    fossil:  {emoji:'🔥', label:'Fossil',   color:C_FOS},
  };

  const rows = sorted.map((z, i) => {
    if (z.today == null || isNaN(z.today)) return {html:'', z, i};
    if (zoneFilter && !zoneFilter.has(z.code)) return {html:'', z, i};

    const meta = ZONE_META[z.code] || {cc:z.code, country:z.name||z.code};
    const priceColor = z.today < 0 ? '#ED6965' : z.today > 150 ? '#FBBF24' : z.today < 20 ? '#14D3A9' : 'var(--tx)';
    const vsColor = z.vsYday == null ? 'var(--tx3)' : z.vsYday >= 0 ? 'var(--dn)' : 'var(--up)';
    const vsText  = z.vsYday == null ? '–' : `${z.vsYday >= 0 ? '▲' : '▼'} ${Math.abs(z.vsYday).toFixed(1)}`;
    const sparkColor = z.spark == null ? 'var(--tx3)' : z.spark >= 0 ? '#14D3A9' : '#ED6965';
    const sparkText  = z.spark == null ? '–' : `${z.spark >= 0 ? '+' : ''}${z.spark.toFixed(1)}`;

    // Peak / Off-Peak
    let peakStr = '–', offPeakStr = '–';
    if (z.hourly && z.hourly.length >= 24) {
      const h = z.hourly, nph = Math.round(h.length/24);
      const pkV=[], opV=[];
      h.forEach((v,idx)=>{ if(v==null)return; const hr=Math.floor(idx/nph); (hr>=8&&hr<20?pkV:opV).push(v); });
      if (pkV.length) peakStr = (pkV.reduce((a,b)=>a+b,0)/pkV.length).toFixed(1);
      if (opV.length) offPeakStr = (opV.reduce((a,b)=>a+b,0)/opV.length).toFixed(1);
    }

    // % Renewables + Dominant fuel from GM_DEMO
    const cc = (ZONE_META[z.code]||{}).cc || z.code;
    const gmKey = z.code in GM_DEMO ? z.code : (cc in GM_DEMO ? cc : null);
    let renPctStr = '–', domFuelHtml = '–';
    if (gmKey) {
      const mix = GM_DEMO[gmKey];
      const total = mix.total || 1;
      const renMW = (mix.wind||0)+(mix.solar||0)+(mix.hydro||0)+(mix.biomass||0);
      const renP  = Math.round(renMW/total*100);
      const renColor = renP >= 60 ? '#14D3A9' : renP >= 40 ? '#FBBF24' : '#ED6965';
      renPctStr = `<span style="color:${renColor};font-weight:600">${renP}%</span>`;
      // Dominant fuel
      let domKey = fuelOrder.reduce((best,k)=> (mix[k]||0)>(mix[best]||0)?k:best, fuelOrder[0]);
      const fm = fuelMeta[domKey] || {emoji:'', label:domKey, color:'var(--tx2)'};
      domFuelHtml = `<span style="color:${fm.color};font-size:11px">${fm.emoji} ${fm.label}</span>`;
    }

    // Smooth sparkline: downsample to 24pts first for clean shape
    let rawHourly = z.hourly && z.hourly.length ? z.hourly : generateDemoHourly(z.today, z.min||0, z.max||z.today*1.5);
    rawHourly = rawHourly.filter(v=>v!=null);
    // Downsample to 24 if 96pts
    let h24spark = rawHourly;
    if (rawHourly.length > 24) {
      const step = rawHourly.length / 24;
      h24spark = Array.from({length:24}, (_,i) => {
        const start = Math.floor(i*step), end = Math.floor((i+1)*step);
        const slice = rawHourly.slice(start, end).filter(v=>v!=null);
        return slice.length ? slice.reduce((a,b)=>a+b,0)/slice.length : null;
      }).filter(v=>v!=null);
    }
    // Sparkline: shows the SHAPE of the daily profile, not a sentiment.
    // Single neutral colour for all zones — semantic info is on the row's other cells.
    const sparkSvg = makeSVGSparklineSmooth(h24spark, 'mixed');

    const html = `<tr style="cursor:pointer" onclick="togglePriceRow(${i}, event)" title="Expand 15-min chart">
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--acc)">${FLAG_MAP[z.code]||''} ${z.code}</td>
      <td style="font-size:11px;color:var(--tx2)">${meta.country||z.name||z.code}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${priceColor}">${z.today.toFixed(1)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2)" title="Avg over 08h–20h">${peakStr}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx3)" title="Avg over 00h–08h / 20h–24h">${offPeakStr}</td>
      <td style="color:${vsColor}">${vsText}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2)">${z.min!=null?z.min.toFixed(1):'–'}<span style="color:var(--tx3);font-size:9px"> @${typeof z.minHr === 'string' ? z.minHr : (z.minHr!=null ? String(z.minHr).padStart(2,'0')+'h' : '')}</span></td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2)">${z.max!=null?z.max.toFixed(1):'–'}<span style="color:var(--tx3);font-size:9px"> @${typeof z.maxHr === 'string' ? z.maxHr : (z.maxHr!=null ? String(z.maxHr).padStart(2,'0')+'h' : '')}</span></td>
      <td>${negFmt(z.negHrs)}</td>
      <td>${renPctStr}</td>
      <td>${domFuelHtml}</td>
      <td style="color:${sparkColor};font-family:'JetBrains Mono',monospace">${sparkText}</td>
      <td class="sparkline-cell">${sparkSvg}</td>
    </tr>
    <tr id="row-detail-${i}" style="display:none">
      <td colspan="13" style="padding:0;background:var(--bg3);border-bottom:2px solid var(--bd2)">
        <div style="padding:12px 16px 16px" id="row-detail-inner-${i}"></div>
      </td>
    </tr>`;
    return {html, z, i};
  });

  tbody.innerHTML = rows.map(r=>r.html).join('');
}

// Smooth sparkline using Catmull-Rom → cubic Bezier conversion
function makeSVGSparklineSmooth(data, positive) {
  if (!data || data.length < 2) return '';
  const w=80, h=28, pad=2;
  const mn=Math.min(...data), mx=Math.max(...data), rng=mx-mn||1;
  // Neutral accent colour — the sparkline shows shape only, not sentiment
  const col = positive === true ? '#14D3A9' : positive === 'mixed' ? '#B8C9D9' : '#ED6965';
  const pts = data.map((v,i) => ({
    x: pad + (i/(data.length-1))*(w-pad*2),
    y: h-pad-((v-mn)/rng)*(h-pad*2)
  }));
  // Catmull-Rom to cubic Bezier (alpha=0.5, tension=0.5)
  function crToBez(p0, p1, p2, p3) {
    const t = 0.5;
    const cp1x = p1.x + (p2.x - p0.x) * t / 2;
    const cp1y = p1.y + (p2.y - p0.y) * t / 2;
    const cp2x = p2.x - (p3.x - p1.x) * t / 2;
    const cp2y = p2.y - (p3.y - p1.y) * t / 2;
    return { cp1x, cp1y, cp2x, cp2y };
  }
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i-1)];
    const p1 = pts[i];
    const p2 = pts[i+1];
    const p3 = pts[Math.min(pts.length-1, i+2)];
    const {cp1x,cp1y,cp2x,cp2y} = crToBez(p0,p1,p2,p3);
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  const last = pts[pts.length-1];
  const areaD = d + ` L${last.x.toFixed(2)},${(h-pad).toFixed(2)} L${pad},${(h-pad).toFixed(2)} Z`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;overflow:visible">
    <defs><linearGradient id="sg${positive?'p':'n'}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity="0.25"/><stop offset="100%" stop-color="${col}" stop-opacity="0.02"/></linearGradient></defs>
    <path d="${areaD}" fill="url(#sg${positive?'p':'n'})" stroke="none"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

// Sort prices table
function sortPricesTable(key) {
  const data = window._pricesSorted;
  if (!data) return;
  window._pricesSortDir = window._pricesSortDir || {};
  const asc = window._pricesSortDir[key] !== 'asc';
  window._pricesSortDir[key] = asc ? 'asc' : 'desc';
  // Update sort indicator in header
  document.querySelectorAll('#prices-table-wrap th span').forEach(s=>{ if(s.textContent==='↑'||s.textContent==='↓') s.textContent='↕'; s.style.opacity='.4'; });
  const thEl = [...document.querySelectorAll('#prices-table-wrap th')].find(th=>th.getAttribute('onclick')===`sortPricesTable('${key}')`);
  if (thEl) { const sp=thEl.querySelector('span'); if(sp){sp.textContent=asc?'↑':'↓';sp.style.opacity='1';} }

  const calcPeak = z => {
    if (!z.hourly || z.hourly.length < 24) return z.today;
    const h=z.hourly, nph=Math.round(h.length/24), pkV=[];
    h.forEach((v,i)=>{ if(v==null)return; const hr=Math.floor(i/nph); if(hr>=8&&hr<20)pkV.push(v); });
    return pkV.length ? pkV.reduce((a,b)=>a+b,0)/pkV.length : z.today;
  };
  const calcOP = z => {
    if (!z.hourly || z.hourly.length < 24) return z.today;
    const h=z.hourly, nph=Math.round(h.length/24), opV=[];
    h.forEach((v,i)=>{ if(v==null)return; const hr=Math.floor(i/nph); if(hr<8||hr>=20)opV.push(v); });
    return opV.length ? opV.reduce((a,b)=>a+b,0)/opV.length : z.today;
  };
  const calcRenPct = z => {
    const gmKey = z.code in GM_DEMO ? z.code : null;
    if (!gmKey) return -1;
    const mix = GM_DEMO[gmKey];
    const renMW = (mix.wind||0)+(mix.solar||0)+(mix.hydro||0)+(mix.biomass||0);
    return mix.total ? renMW/mix.total*100 : -1;
  };
  const calcDomFuel = z => {
    const gmKey = z.code in GM_DEMO ? z.code : null;
    if (!gmKey) return 'zz';
    const mix = GM_DEMO[gmKey];
    const fuelOrder = ['nuclear','wind','solar','hydro','biomass','fossil'];
    return fuelOrder.reduce((best,k)=> (mix[k]||0)>(mix[best]||0)?k:best, fuelOrder[0]);
  };

  const val = z => {
    const meta = ZONE_META[z.code]||{cc:z.code,country:z.name||''};
    if (key==='code')    return z.code||'';
    if (key==='country') return meta.country||'';
    if (key==='name')    return z.name||'';
    if (key==='today')   return z.today ?? -Infinity;
    if (key==='peak')    return calcPeak(z);
    if (key==='offpeak') return calcOP(z);
    if (key==='vsYday')  return z.vsYday ?? -Infinity;
    if (key==='minVal')  return z.min ?? -Infinity;
    if (key==='maxVal')  return z.max ?? -Infinity;
    if (key==='negHrs')  return z.negHrs ?? 0;
    if (key==='renPct')  return calcRenPct(z);
    if (key==='domFuel') return calcDomFuel(z);
    if (key==='spark')   return z.spark ?? -Infinity;
    return 0;
  };
  window._pricesSorted = [...data].sort((a,b)=>{
    const va=val(a), vb=val(b);
    if (typeof va==='string') return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return asc ? (va>vb?1:-1) : (va<vb?1:-1);
  });
  renderPricesTableBody();
}


// ── TOGGLE INLINE ROW DETAIL (Hourly DA Prices) ──
let _openRow = null;
let _rowCharts = {};

function togglePriceRow(idx, e) {
  const z = window._pricesSorted?.[idx];
  if (!z || z.today == null) return;

  if (_openRow !== null && _openRow !== idx) {
    document.getElementById(`row-detail-${_openRow}`).style.display = 'none';
    if (_rowCharts[_openRow]) { _rowCharts[_openRow].destroy(); delete _rowCharts[_openRow]; }
  }

  const detailRow = document.getElementById(`row-detail-${idx}`);
  const isOpen = detailRow.style.display !== 'none';

  if (isOpen) {
    detailRow.style.display = 'none';
    _openRow = null;
    if (_rowCharts[idx]) { _rowCharts[idx].destroy(); delete _rowCharts[idx]; }
    return;
  }

  detailRow.style.display = 'table-row';
  _openRow = idx;
  setTimeout(() => detailRow.scrollIntoView({ behavior:'smooth', block:'nearest' }), 50);

  buildHourlyDetail(idx, z);
}

function buildHourlyDetail(idx, z) {
  const inner = document.getElementById(`row-detail-inner-${idx}`);
  if (!inner) return;

  const hourly = z.hourly && z.hourly.length ? z.hourly : generateDemoHourly(z.today, z.min, z.max);
  const resMin = getResolution(hourly);
  const slotsPerHour = 60 / resMin;

  // Downsample to 24h if 15min
  let h24 = hourly;
  if (resMin === 15 && hourly.length === 96) {
    h24 = Array.from({length:24}, (_,h) => {
      const s = hourly.slice(h*4, h*4+4).filter(v=>v!=null);
      return s.length ? s.reduce((a,b)=>a+b,0)/s.length : null;
    });
  }

  // All KPIs computed on RAW slots (15-min if available) for consistency with the table row
  // h24 (24-pt downsampled) is kept only for the chart rendering below
  const rawValid = hourly.filter(v => v != null);
  const avg = rawValid.length ? rawValid.reduce((a,b)=>a+b,0)/rawValid.length : 0;

  const minV = rawValid.length ? Math.min(...rawValid) : 0;
  const maxV = rawValid.length ? Math.max(...rawValid) : 0;
  const minRawIdx = hourly.indexOf(minV);
  const maxRawIdx = hourly.indexOf(maxV);
  // Format slot label as HH:MM based on slot resolution
  const fmtSlot = (idx) => {
    if (idx < 0) return '--';
    const totalMin = idx * resMin;
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
  };
  const minSlotLabel = fmtSlot(minRawIdx);
  const maxSlotLabel = fmtSlot(maxRawIdx);

  // Peak (08-20) and Off-peak — on raw slots, not downsampled hours
  const nph = hourly.length > 24 ? Math.round(hourly.length / 24) : 1;
  const peakSlots = [], offSlots = [];
  hourly.forEach((v, i) => {
    if (v == null) return;
    const hr = Math.floor(i / nph);
    (hr >= 8 && hr < 20 ? peakSlots : offSlots).push(v);
  });
  const peakAvg  = peakSlots.length ? peakSlots.reduce((a,b)=>a+b,0)/peakSlots.length : null;
  const offPkAvg = offSlots.length  ? offSlots.reduce((a,b)=>a+b,0)/offSlots.length   : null;
  const peakRatio = (peakAvg && offPkAvg && offPkAvg !== 0) ? peakAvg/offPkAvg : null;
  const isFlatter = peakRatio !== null && peakRatio < 1.20;
  const flatText  = peakRatio !== null
    ? (isFlatter ? '● Flatter than normal' : '● Normal profile')
    : '';
  const flatColor = isFlatter ? '#14D3A9' : '#EE9B00';

  // Negative hours — count from raw slots, convert to total minutes
  const negSlotsRaw = hourly.filter(v => v != null && v < 0);
  const negTotalMin = negSlotsRaw.length * resMin;
  const negHours    = Math.floor(negTotalMin / 60);
  const negMins     = negTotalMin % 60;
  const negMin      = negSlotsRaw.length ? Math.min(...negSlotsRaw) : null;

  // Labels
  const labels = h24.map((_, i) => `${String(i).padStart(2,'0')}:00`);

  // Zone colors per hour: off-peak(night), morning-peak, solar-trough, evening-peak
  const bgColors = h24.map((v, i) => {
    if (i >= 7 && i <= 9)   return 'rgba(232,160,32,0.08)';  // morning ramp
    if (i >= 11 && i <= 14) return 'rgba(0,212,168,0.06)';   // solar trough
    if (i >= 17 && i <= 21) return 'rgba(232,160,32,0.08)';  // evening peak
    return 'transparent';
  });

  // Color — defined before inner.innerHTML so KPI cards can use it
  const chartData   = (z.hourly && z.hourly.length === 96) ? z.hourly : h24;
  const negFraction = chartData.filter(v=>v!=null&&v<0).length / Math.max(1, chartData.filter(v=>v!=null).length);
  const col = negFraction >= 0.5 ? '#ED6965' : negFraction >= 0.2 ? '#FBBF24' : (typeof zoneColor === 'function' ? zoneColor(z.code) : 'var(--acc)');

  inner.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px" id="row-kpis-${idx}">
      ${[
        {k:'avg',     l:'Avg',              v:avg.toFixed(2),                            meta:'24h average',     u:'€/MWh'},
        {k:'peak',    l:'Peak avg',         v:peakAvg!=null?peakAvg.toFixed(2):'--',     meta:'08h–20h',         u:'€/MWh'},
        {k:'offpeak', l:'Off-peak avg',     v:offPkAvg!=null?offPkAvg.toFixed(2):'--',   meta:'00h–08h / 20h–24h', u:'€/MWh'},
        {k:'min',     l:'Min slot',         v:minV.toFixed(2),                           meta:'@'+minSlotLabel,   u:'€/MWh'},
        {k:'max',     l:'Max slot',         v:maxV.toFixed(2),                           meta:'@'+maxSlotLabel,   u:'€/MWh'},
      ].map(k=>`<div id="row-kpi-${idx}-${k.k}" style="background:var(--bg2);border:1px solid var(--bd);border-left:3px solid var(--text3);border-radius:6px;padding:10px 12px;transition:border-left-color 0.2s">
        <div style="font-size:10px;color:var(--text2);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">${k.l}</div>
        <div style="font-size:18px;font-weight:700;font-family:'JetBrains Mono',monospace;letter-spacing:-0.02em;color:var(--text)">${k.v}<span style="font-size:11px;color:var(--text2);font-weight:400;margin-left:3px"> ${k.u||''}</span></div>
        <div class="row-kpi-chg" data-kpi="${k.k}" style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace;margin-top:3px">--</div>
        <div style="font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace;margin-top:2px">${k.meta}</div>
      </div>`).join('')}
    </div>
    <div style="font-size:11px;margin-bottom:8px">
      <span style="color:${flatColor};font-weight:600">${flatText}</span>
      ${peakRatio!=null ? `<span style="color:var(--tx3);margin-left:8px">Peak/off-peak ratio: ${peakRatio.toFixed(2)}x (baseline 1.30x)</span>` : ''}
    </div>
    <div style="position:relative;height:180px;margin-bottom:4px">
      <canvas id="row-chart-${idx}" style="width:100%;height:180px"></canvas>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:16px;font-size:10px;color:var(--tx3);margin-bottom:8px">
      <span>— Today</span><span style="opacity:.5">- - - Yesterday</span>
      <span style="margin-left:8px">Shading: morning peak (07-09) | solar trough (11-14) | evening peak (17-21)</span>
    </div>
    ${negTotalMin > 0 ? `<div style="font-size:11px;color:var(--warn);margin-bottom:8px">⚠ ${negHours}h ${String(negMins).padStart(2,'0')}min negative prices · min: ${negMin.toFixed(1)} €/MWh</div>` : ''}
    <details style="margin-top:4px">
      <summary style="font-size:11px;font-weight:600;color:var(--tx2);cursor:pointer;letter-spacing:.05em;text-transform:uppercase;user-select:none">
        Breakdown (${z.hourly && z.hourly.length===96 ? "96 × 15min slots" : h24.length+" hours"})
      </summary>
      <div style="margin-top:8px;max-height:260px;overflow-y:auto">
        <table style="width:100%;font-size:11px;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Slot</th>
            <th style="text-align:right;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Price €/MWh</th>
            <th style="text-align:center;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Period</th>
          </tr></thead>
          <tbody>${(() => {
            // Use 96-pt (15min) if available, else 24h
            const tblData = (z.hourly && z.hourly.length === 96) ? z.hourly : h24;
            const nph = tblData.length > 24 ? Math.round(tblData.length/24) : 1; // pts per hour
            const nowSlot = new Date().getHours() * nph + Math.floor(new Date().getMinutes()/(60/nph));
            const isToday = !DP.selectedDate || DP.selectedDate === new Date().toISOString().slice(0,10);
            return tblData.map((v,i) => {
              const hr  = Math.floor(i / nph);
              const min = (i % nph) * (60 / nph);
              const timeLabel = String(hr).padStart(2,'0') + ':' + String(min).padStart(2,'0');
              const period = (hr>=8&&hr<20)
                ? '<span style="color:var(--dn);font-size:10px">PEAK</span>'
                : '<span style="color:var(--tx3);font-size:10px">OFF-PEAK</span>';
              const priceColor = v==null ? 'var(--tx3)' : v<0 ? 'var(--warn)' : 'var(--tx)';
              const isNow = isToday && i === nowSlot;
              return `<tr style="border-bottom:1px solid rgba(255,255,255,.03);${isNow?'background:rgba(0,212,168,.06)':''}">
                <td style="padding:3px 8px;color:var(--tx3)">${isNow?'▶ ':''}<span style="font-family:'JetBrains Mono',monospace">${timeLabel}</span></td>
                <td style="padding:3px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:${priceColor};font-weight:${v!=null&&v<0?'700':'400'}">${v!=null?v.toFixed(2):'--'}</td>
                <td style="padding:3px 8px;text-align:center">${period}</td>
              </tr>`;
            }).join('');
          })()}</tbody>
        </table>
      </div>
    </details>
  `;

  // Color — defined early so it can be used in KPI cards AND chart
  // Render chart — use full 15-min data (chartData, negFraction, col defined above)
  const canvas = document.getElementById(`row-chart-${idx}`);
  if (!canvas) return;
  if (_rowCharts[idx]) { _rowCharts[idx].destroy(); }

  const chartLabels = makeTimeLabels(chartData.length);
  const curSlot = (window.DP?.selectedDate && window.DP.selectedDate !== new Date().toISOString().slice(0,10))
    ? -1 : new Date().getHours() * (chartData.length / 24);

  const datasets = [{
    label: `${z.code} Today`,
    data: chartData,
    borderColor: col,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.3,
    spanGaps: true,
    fill: true,
    backgroundColor: (ctx2) => {
      const g = ctx2.chart.ctx.createLinearGradient(0,0,0,180);
      g.addColorStop(0, col+'30'); g.addColorStop(1, col+'00'); return g;
    },
  }];

  // J-1 overlay from zone data
  if (z.hourlyYday && z.hourlyYday.length) {
    datasets.push({
      label:'J-1',
      data: z.hourlyYday,
      borderColor: 'rgba(255,255,255,0.25)',
      borderWidth: 1.2, borderDash:[5,3], pointRadius:0, tension:0.3, fill:false, spanGaps:true,
    });
  }

  // Annotations
  const annotations = {};
  if (curSlot > 0) {
    annotations.nowLine = {
      type:'line', xMin:curSlot, xMax:curSlot,
      borderColor:'rgba(255,220,100,.7)', borderWidth:1.5, borderDash:[4,3],
      label:{display:true, content:'NOW', position:'start', color:'rgba(255,220,100,.9)', font:{size:9,weight:'600'}, backgroundColor:'transparent', padding:2}
    };
  }
  // Min/Max points — chartData uses raw 96pt (15-min) when available, else 24h
  // minRawIdx/maxRawIdx are already indexes into the raw `hourly` array, which
  // matches chartData when length === 96. When chartData is downsampled (24h),
  // we map the raw index back via division by slots-per-hour.
  const idxScale = (chartData.length === hourly.length) ? 1 : (chartData.length / hourly.length);
  annotations.minPt = { type:'point', xValue:Math.round(minRawIdx*idxScale), yValue:minV,
    backgroundColor:'#ef4444', radius:5,
    label:{display:true,content:minV.toFixed(0)+'€/MWh',color:'#fff',font:{size:9},backgroundColor:'#ef4444',position:'bottom',padding:2}
  };
  annotations.maxPt = { type:'point', xValue:Math.round(maxRawIdx*idxScale), yValue:maxV,
    backgroundColor:'#22c55e', radius:5,
    label:{display:true,content:maxV.toFixed(0)+'€/MWh',color:'#fff',font:{size:9},backgroundColor:'#22c55e',position:'top',padding:2}
  };

  // Shading plugin — peak / off-peak / solar trough
  const shadingPlugin = {
    id:'rowShading',
    beforeDraw(chart) {
      const {ctx,chartArea,scales:{x}}=chart; if(!x||!chartArea) return;
      const {top,bottom}=chartArea; const sc=chartData.length/24;
      const zones=[
        {from:7*sc,to:9*sc,  color:'rgba(232,160,32,0.07)'},
        {from:11*sc,to:14*sc,color:'rgba(0,212,168,0.05)'},
        {from:17*sc,to:21*sc,color:'rgba(232,160,32,0.07)'},
      ];
      ctx.save();
      zones.forEach(({from,to,color})=>{
        const x0=x.getPixelForValue(from),x1=x.getPixelForValue(to);
        ctx.fillStyle=color; ctx.fillRect(x0,top,x1-x0,bottom-top);
      });
      ctx.restore();
    }
  };

  _rowCharts[idx] = new Chart(canvas, {
    type:'line',
    data:{ labels:chartLabels, datasets },
    plugins:[shadingPlugin],
    options:{
      responsive:true, maintainAspectRatio:false, animation:{duration:100},
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display: datasets.length>1, labels:{color:'#4A6280',font:{size:10},boxWidth:16,usePointStyle:true,pointStyle:'line'}},
        tooltip:{mode:'index',intersect:false,callbacks:{label:ctx=>` ${ctx.dataset.label}: ${ctx.parsed.y!=null?ctx.parsed.y.toFixed(2)+' €/MWh':'n/a'}`}},
        annotation:{annotations},
        zoom:ZOOM_CFG,
      },
      scales:{
        x:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#4A6280',font:{size:9},maxTicksLimit:12}},
        y:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#4A6280',font:{size:10},callback:v=>v+'€/MWh'},
           title:{display:true,text:'€/MWh',color:'#4A6280',font:{size:10}}},
      },
    },
  });

  // Async: colourise expand KPI cards (border + sub-text) vs J-1 for this zone
  applyExpandKPIColours(idx, z, {
    avg, peakAvg, offPkAvg, minV, maxV,
  });
}

// Compute today's KPI values for a zone, fetch J-1 from history, and apply
// matching border-left colour + sub-text tint based on direction (±1 €/MWh)
async function applyExpandKPIColours(idx, z, today) {
  const displayDate = window.DP?.selectedDate || new Date().toISOString().slice(0,10);
  if (typeof fetchYesterdayDaily !== 'function') return;
  const yData = await fetchYesterdayDaily(displayDate);
  if (!yData) return;
  const yz = yData.zones[z.code];
  if (!yz) return;

  // Compute J-1 reference values for this zone on raw slots
  const yHourly = yz.hourly || [];
  const yValid  = yHourly.filter(v => v != null);
  if (yValid.length === 0) return;
  const yAvg = yValid.reduce((a,b)=>a+b,0) / yValid.length;
  const yMin = Math.min(...yValid);
  const yMax = Math.max(...yValid);

  const yNph = yHourly.length > 24 ? Math.round(yHourly.length / 24) : 1;
  const yPeak = [], yOff = [];
  yHourly.forEach((v, i) => {
    if (v == null) return;
    const hr = Math.floor(i / yNph);
    (hr >= 8 && hr < 20 ? yPeak : yOff).push(v);
  });
  const yPeakAvg = yPeak.length ? yPeak.reduce((a,b)=>a+b,0)/yPeak.length : null;
  const yOffAvg  = yOff.length  ? yOff.reduce((a,b)=>a+b,0)/yOff.length   : null;

  const apply = (kpiKey, todayVal, yVal) => {
    const card = document.getElementById(`row-kpi-${idx}-${kpiKey}`);
    if (!card) return;
    if (todayVal == null || yVal == null) return;
    const delta = todayVal - yVal;
    let borderColor = 'var(--text3)', subColor = 'var(--text3)';
    if (Math.abs(delta) >= 1) {
      if (delta > 0) { borderColor = 'var(--down)'; subColor = 'var(--down)'; }
      else           { borderColor = 'var(--up)';   subColor = 'var(--up)'; }
    }
    card.style.borderLeftColor = borderColor;
    const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '·';
    const sign  = delta > 0 ? '+' : '';
    const chg = card.querySelector('.row-kpi-chg');
    if (chg) {
      chg.style.color = subColor;
      chg.textContent = `${arrow} ${sign}${delta.toFixed(1)} vs J-1`;
    }
  };

  apply('avg',     today.avg,     yAvg);
  apply('peak',    today.peakAvg, yPeakAvg);
  apply('offpeak', today.offPkAvg, yOffAvg);
  apply('min',     today.minV,    yMin);
  apply('max',     today.maxV,    yMax);
}


const COMPARE_COLORS = ['#14D3A9','#C4A57B','#FBBF24','#A87DC4','#ED6965','#94D2BD','#f472b6','#38bdf8','#fb923c','#818cf8'];

function buildCompareDropdown() { buildCompareChips(); } // alias kept

function toggleCompareFilterPanel() {
  const panel = document.getElementById('compare-filter-panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) { positionPanel('compare-filter-panel','compare-filter-btn'); buildCompareChips(); }
  const zp = document.getElementById('zone-filter-panel');
  if (zp) zp.style.display = 'none';
}

function clearCompareZones() {
  window._compareZones = new Set();
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
}

function compareNeighbours() {
  window._compareZones = new Set(['FR','DE_LU','BE','NL','ES','IT_NORD','CH','AT','PT']);
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
}

function compareWithGenMix() {
  const gmKeys = window._genmixData ? Object.keys(window._genmixData) : ['FR','DE_LU','ES','BE','NL','IT_NORD'];
  window._compareZones = new Set(gmKeys);
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
}

function buildCompareChips() {
  const container = document.getElementById('compare-zone-chips');
  if (!container || !window._pricesSorted) return;
  const selected = window._compareZones || new Set(['FR']);
  if (!window._zoneColorMap) {
    window._zoneColorMap = {};
    window._pricesSorted.forEach((z,i) => { window._zoneColorMap[z.code] = COMPARE_COLORS[i % COMPARE_COLORS.length]; });
  }
  container.innerHTML = window._pricesSorted.map(z => {
    const isOn = selected.has(z.code);
    const col  = window._zoneColorMap[z.code] || '#4A6280';
    const meta = ZONE_META[z.code] || {country: z.name || z.code};
    return `<button onclick="toggleCompareChip('${z.code}')" id="chip-${z.code}" style="
      display:flex;align-items:center;gap:5px;width:100%;padding:5px 8px;border-radius:5px;font-size:11px;cursor:pointer;
      border:none;text-align:left;background:${isOn?col+'18':'transparent'};color:${isOn?col:'rgba(255,255,255,.45)'};
    ">
      <span style="width:14px;height:14px;border-radius:3px;border:1.5px solid ${isOn?col:'rgba(255,255,255,.2)'};background:${isOn?col+'33':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        ${isOn?`<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`:''}
      </span>
      <span style="font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;min-width:52px">${z.flag||''} ${z.code}</span>
      <span style="font-size:11px">${meta.country}</span>
    </button>`;
  }).join('');
  // Update label
  const lbl = document.getElementById('compare-filter-label');
  if (lbl) {
    const n = selected.size;
    lbl.textContent = n === 1 ? [...selected][0]+' selected' : `${n} zones selected`;
  }
}

function toggleCompareChip(code) {
  const allCodes = new Set((window._pricesSorted || []).map(z => z.code));

  // Si pas encore initialisé, partir de FR uniquement
  if (!window._compareZones) window._compareZones = new Set(['FR']);

  if (window._compareZones.has(code)) {
    window._compareZones.delete(code);
    // Garder au moins une zone
    if (window._compareZones.size === 0) window._compareZones.add(code);
  } else {
    window._compareZones.add(code);
  }

  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
}

function renderComparePeakStrip() {
  const strip = document.getElementById('compare-peak-strip');
  if (!strip || !window._pricesSorted || !window._compareZones) return;
  const selected = window._compareZones;
  const cards = [];
  window._pricesSorted.forEach(z => {
    if (!selected.has(z.code)) return;
    const col = window._zoneColorMap?.[z.code] || '#4A6280';
    if (!z.hourly || z.hourly.length < 24) return;
    const h = z.hourly; const nph = Math.round(h.length/24);
    const pkV=[], opV=[];
    h.forEach((v,i) => { if(v==null)return; const hr=Math.floor(i/nph); (hr>=8&&hr<20?pkV:opV).push(v); });
    const pk = pkV.length ? (pkV.reduce((a,b)=>a+b,0)/pkV.length).toFixed(1) : '--';
    const op = opV.length ? (opV.reduce((a,b)=>a+b,0)/opV.length).toFixed(1) : '--';
    const spread = pkV.length && opV.length ? (pkV.reduce((a,b)=>a+b,0)/pkV.length - opV.reduce((a,b)=>a+b,0)/opV.length).toFixed(1) : '--';
    cards.push(`<div style="background:var(--bg2);border:1px solid ${col}44;border-left:3px solid ${col};border-radius:6px;padding:6px 10px;min-width:110px">
      <div style="font-size:10px;font-weight:700;color:${col};margin-bottom:4px">${z.flag} ${z.code}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:10px;color:var(--tx2)">
        <span style="color:var(--tx3)">Peak</span><span style="font-family:'JetBrains Mono',monospace">${pk}</span>
        <span style="color:var(--tx3)">Off-pk</span><span style="font-family:'JetBrains Mono',monospace">${op}</span>
        <span style="color:var(--tx3)">Spread</span><span style="font-family:'JetBrains Mono',monospace;color:${parseFloat(spread)>0?'var(--up)':'var(--tx3)'}">${spread !== '--' ? (parseFloat(spread)>0?'+':'')+spread : '--'}</span>
      </div>
    </div>`);
  });
  strip.innerHTML = cards.join('');
}

function onCompareSelectChange(sel) {
  // Legacy shim - now handled by chips
  const vals = Array.from(sel.selectedOptions).map(o => o.value);
  window._compareZones = new Set(vals.length ? vals : ['FR']);
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
}

// ════════════════════════════════════════════
// COMPARE CHART — multi-view router (Insta-style tabs)
// ════════════════════════════════════════════
// Available views: 'lines' (default), 'heatmap', 'profile', 'bands', 'spread'
// State: window._ccView holds the current view, window._ccSpreadRef the spread reference zone

const CC_VIEWS = [
  { key:'lines',   label:'Lines',   icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M3 12c4 0 4-7 8-7s4 9 8 9"/></svg>' },
  { key:'heatmap', label:'Heatmap', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/></svg>' },
  { key:'profile', label:'Profile', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h2l2-8 4 16 3-12 2 6h5"/></svg>' },
  { key:'bands',   label:'Bands',   icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/><path d="M3 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/><path d="M3 6c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/></svg>' },
  { key:'spread',  label:'Spread',  icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 19 4-7 6 4 7-12"/><path d="M14 4h7v7"/></svg>' },
];

function renderCCTabs() {
  const tabs = document.getElementById('cc-tabs');
  if (!tabs) return;
  const cur = window._ccView || 'lines';
  tabs.innerHTML = CC_VIEWS.map(v => `
    <button onclick="setCCView('${v.key}')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:${v.key===cur?'var(--bg3)':'transparent'};color:${v.key===cur?'var(--text)':'var(--text3)'};font-family:'Inter',sans-serif;font-weight:500;letter-spacing:.03em;transition:all .15s">
      <span style="display:inline-flex;width:14px;height:14px">${v.icon}</span>${v.label}
    </button>
  `).join('');
}

function setCCView(view) {
  window._ccView = view;
  renderCCTabs();
  // Show/hide spread reference selector
  const refWrap = document.getElementById('cc-ref-wrap');
  if (refWrap) refWrap.style.display = view === 'spread' ? 'flex' : 'none';
  // Show/hide canvas vs heatmap div
  const canvas = document.getElementById('price-compare-canvas');
  const heat   = document.getElementById('cc-heatmap');
  if (canvas) canvas.style.display = view === 'heatmap' ? 'none' : 'block';
  if (heat)   heat.style.display   = view === 'heatmap' ? 'block' : 'none';
  renderCompareChart();
}
window.setCCView = setCCView;

function setSpreadRef(code) {
  window._ccSpreadRef = code;
  renderCompareChart();
}
window.setSpreadRef = setSpreadRef;

function populateSpreadRefSelect(data) {
  const sel = document.getElementById('cc-ref-select');
  if (!sel || !data) return;
  const cur = window._ccSpreadRef || 'FR';
  sel.innerHTML = data.map(z => `<option value="${z.code}" ${z.code===cur?'selected':''}>${z.code}</option>`).join('');
}

// ────────────────────────────────────────────
// Helpers shared across views
// ────────────────────────────────────────────
function ccGetSelectedZones(data, selected) {
  const out = [];
  data.forEach(z => { if (selected.has(z.code)) out.push(z); });
  return out;
}

function ccZoneColor(code, data, idx) {
  if (!window._zoneColorMap) {
    window._zoneColorMap = {};
    data.forEach((z, i) => { window._zoneColorMap[z.code] = COMPARE_COLORS[i % COMPARE_COLORS.length]; });
  }
  return window._zoneColorMap[code] || COMPARE_COLORS[idx % COMPARE_COLORS.length];
}

function ccBuildCommonShading(nPts) {
  return {
    id: 'ccShading',
    beforeDraw(chart) {
      const { ctx, chartArea, scales: { x } } = chart;
      if (!x || !chartArea) return;
      const { top, bottom } = chartArea;
      const sc = nPts / 24;
      const zones = [
        { from: 7*sc,  to: 9*sc,   color: 'rgba(232,160,32,0.05)' },
        { from: 11*sc, to: 14*sc,  color: 'rgba(0,212,168,0.04)' },
        { from: 17*sc, to: 21*sc,  color: 'rgba(232,160,32,0.05)' },
      ];
      ctx.save();
      zones.forEach(({ from, to, color }) => {
        const x0 = x.getPixelForValue(from), x1 = x.getPixelForValue(to);
        ctx.fillStyle = color;
        ctx.fillRect(x0, top, x1 - x0, bottom - top);
      });
      ctx.restore();
    }
  };
}

// ────────────────────────────────────────────
// Router
// ────────────────────────────────────────────
function renderCompareChart() {
  const data = window._pricesSorted;
  if (!data || !data.length) return;
  const selected = window._compareZones || new Set(['FR']);
  const view = window._ccView || 'lines';

  populateSpreadRefSelect(data);

  switch (view) {
    case 'heatmap': renderCCHeatmap(data, selected); break;
    case 'profile': renderCCProfile(data, selected); break;
    case 'bands':   renderCCBands(data, selected);   break;
    case 'spread':  renderCCSpread(data, selected);  break;
    case 'lines':
    default:        renderCCLines(data, selected);
  }

  // Refresh the data table below the chart
  renderCompareKPIs(data, selected);
  // Generate analysis banner for current view
  setTimeout(() => {
    if (view !== 'heatmap') addFullscreen('price-compare-canvas');
    if (view !== 'heatmap') addDownload('price-compare-canvas','price-comparison');
    renderCCAnalysis(view, data, selected);
  }, 100);
}

// ────────────────────────────────────────────
// View 1: LINES (existing chart, refactored)
// ────────────────────────────────────────────
function renderCCLines(data, selected) {
  const firstZone = data.find(z => selected.has(z.code));
  const nPts = (firstZone && firstZone.hourly && firstZone.hourly.length) ? firstZone.hourly.length : 24;
  const hours = makeTimeLabels(nPts);
  const curHr = new Date().getHours();
  const curIdx = Math.min(curHr, nPts - 1);

  const datasets = [];
  data.forEach((z, i) => {
    if (!selected.has(z.code)) return;
    const baseCol = ccZoneColor(z.code, data, i);
    const hourly = z.hourly && z.hourly.length ? z.hourly : generateDemoHourly(z.today, z.min, z.max);
    const negFracCC = hourly.filter(v => v != null && v < 0).length / Math.max(1, hourly.filter(v => v != null).length);
    const col = negFracCC >= 0.5 ? '#ED6965' : negFracCC >= 0.2 ? '#FBBF24' : baseCol;
    datasets.push({
      label: `${z.code} · ${z.name}`, data: hourly, borderColor: col, borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col,
      pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, fill: true,
      backgroundColor: (ctx2) => {
        const g = ctx2.chart.ctx.createLinearGradient(0,0,0,320);
        g.addColorStop(0, col+'28'); g.addColorStop(1, col+'00'); return g;
      },
      tension: 0.3,
    });
    if (z.hourlyYday && z.hourlyYday.length) {
      datasets.push({ label:`${z.code} J-1`, data:z.hourlyYday, borderColor:col, borderWidth:1.2, borderDash:[5,4], pointRadius:0, fill:false, tension:0, opacity:0.5 });
    }
    if (z.hourlyJ2 && z.hourlyJ2.length) {
      datasets.push({ label:`${z.code} J-2`, data:z.hourlyJ2, borderColor:col, borderWidth:1, borderDash:[2,4], pointRadius:0, fill:false, tension:0, opacity:0.3 });
    }
  });

  mkChart('price-compare-canvas', {
    type: 'line',
    data: { labels: hours, datasets },
    plugins: [ ccBuildCommonShading(nPts) ],
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display:true, position:'bottom', labels:{ color:C_TX2, font:{size:10}, boxWidth:10, padding:10,
          filter: item => !(item.text.includes('J-1') || item.text.includes('J-2')) }},
        tooltip: { mode:'index', intersect:false, callbacks: {
          title: c => c[0].label,
          label: c => { const v = c.raw; if (v == null) return null; return ` ${c.dataset.label}: ${v.toFixed(1)} €/MWh`; }
        }},
        zoom: ZOOM_CFG,
        annotation: { annotations: { nowline: {
          type:'line', xMin:curIdx, xMax:curIdx, borderColor:'rgba(255,220,100,.7)', borderWidth:1.5, borderDash:[4,3],
          label:{ display:true, content:'NOW', position:'start', color:'rgba(255,220,100,.9)', font:{size:9,weight:'600'}, backgroundColor:'transparent', padding:2 }
        }}}
      },
      scales: {
        x: { grid: GRID, ticks:{ color:C_TX3, font:{size:9}, maxTicksLimit:12 }},
        y: { grid: GRID, ticks:{ color:C_TX3, callback:v=>v.toFixed(0)+' €' }, title:{ display:true, text:'€/MWh', color:C_TX3, font:{size:9} }}
      }
    }
  });
}

// ────────────────────────────────────────────
// View 2: HEATMAP — zones × hours grid, color = price
// ────────────────────────────────────────────
function renderCCHeatmap(data, selected) {
  const host = document.getElementById('cc-heatmap');
  if (!host) return;
  const zones = ccGetSelectedZones(data, selected);
  if (!zones.length) { host.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">No zones selected</div>'; return; }

  const nPts = zones[0].hourly && zones[0].hourly.length ? zones[0].hourly.length : 24;
  const nph = nPts > 24 ? Math.round(nPts/24) : 1;
  // Aggregate to hourly granularity for the heatmap (24 cols always)
  const grid = zones.map(z => {
    const h = z.hourly && z.hourly.length ? z.hourly : [];
    const hr = [];
    for (let i = 0; i < 24; i++) {
      const slots = [];
      for (let j = 0; j < nph; j++) {
        const v = h[i*nph + j];
        if (v != null) slots.push(v);
      }
      hr.push(slots.length ? slots.reduce((a,b)=>a+b,0)/slots.length : null);
    }
    return { code: z.code, flag: z.flag, color: ccZoneColor(z.code, data, 0), hourly: hr };
  });

  // Global colour scale
  let mn = Infinity, mx = -Infinity;
  grid.forEach(r => r.hourly.forEach(v => { if (v != null) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }));
  const colorFor = (v) => {
    if (v == null) return 'var(--bg)';
    if (v < 0)    return '#5b1a2a';
    const t = Math.max(0, Math.min(1, (v - Math.max(0,mn)) / (mx - Math.max(0,mn) || 1)));
    if (t < .15) return '#0f4434';
    if (t < .35) return '#155f4a';
    if (t < .55) return '#2a7a3a';
    if (t < .70) return '#a37a1a';
    if (t < .85) return '#c25526';
    return '#a82a3a';
  };

  let html = '<div style="font-family:\'JetBrains Mono\',monospace;padding:8px 4px">';
  // header row
  html += '<div style="display:flex;align-items:end;margin-bottom:6px"><div style="width:80px"></div><div style="flex:1;display:grid;grid-template-columns:repeat(24,1fr);gap:1px;color:var(--text3);font-size:9px;padding-bottom:3px">';
  for (let h = 0; h < 24; h++) html += `<div style="text-align:center">${h%3===0?String(h).padStart(2,'0')+'h':''}</div>`;
  html += '</div></div>';
  // body rows
  grid.forEach(r => {
    html += `<div style="display:flex;align-items:center;margin-bottom:2px">
      <div style="width:80px;color:${r.color};font-weight:700;font-size:11px">${r.flag||''} ${r.code}</div>
      <div style="flex:1;display:grid;grid-template-columns:repeat(24,1fr);gap:1px;height:26px">`;
    r.hourly.forEach((v, i) => {
      const c = colorFor(v);
      const lbl = v == null ? '·' : Math.round(v);
      const tip = v == null ? `${r.code} ${i}h: no data` : `${r.code} ${i}h: ${v.toFixed(1)} €/MWh`;
      html += `<div title="${tip}" style="background:${c};display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;border-radius:1px;font-weight:500">${lbl}</div>`;
    });
    html += '</div></div>';
  });
  // scale legend
  html += `<div style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:10px;color:var(--text3);padding-left:80px">
    <span>min ${Math.round(mn)}€</span>
    <div style="display:flex;height:8px;width:200px">
      <div style="flex:1;background:#5b1a2a"></div>
      <div style="flex:1;background:#0f4434"></div>
      <div style="flex:1;background:#155f4a"></div>
      <div style="flex:1;background:#2a7a3a"></div>
      <div style="flex:1;background:#a37a1a"></div>
      <div style="flex:1;background:#c25526"></div>
      <div style="flex:1;background:#a82a3a"></div>
    </div>
    <span>max ${Math.round(mx)}€</span>
  </div></div>`;
  host.innerHTML = html;
}

// ────────────────────────────────────────────
// View 3: PROFILE — normalized to % of daily avg
// ────────────────────────────────────────────
function renderCCProfile(data, selected) {
  const firstZone = data.find(z => selected.has(z.code));
  const nPts = (firstZone && firstZone.hourly && firstZone.hourly.length) ? firstZone.hourly.length : 24;
  const hours = makeTimeLabels(nPts);

  const datasets = [];
  data.forEach((z, i) => {
    if (!selected.has(z.code)) return;
    const col = ccZoneColor(z.code, data, i);
    const h = z.hourly && z.hourly.length ? z.hourly : [];
    const valid = h.filter(v => v != null);
    if (!valid.length) return;
    const avg = valid.reduce((a,b)=>a+b,0) / valid.length;
    if (Math.abs(avg) < 0.5) return; // can't normalize on near-zero average
    const norm = h.map(v => v == null ? null : (v / avg) * 100);
    datasets.push({
      label: `${z.code}`, data: norm, borderColor: col, borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col,
      fill: false, tension: 0.3, spanGaps: true,
    });
  });

  mkChart('price-compare-canvas', {
    type: 'line',
    data: { labels: hours, datasets },
    plugins: [ ccBuildCommonShading(nPts) ],
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display:true, position:'bottom', labels:{ color:C_TX2, font:{size:10}, boxWidth:10, padding:10 }},
        tooltip: { mode:'index', intersect:false, callbacks: {
          title: c => c[0].label,
          label: c => { const v = c.raw; if (v == null) return null; return ` ${c.dataset.label}: ${v.toFixed(0)}% of daily avg`; }
        }},
        zoom: ZOOM_CFG,
        annotation: { annotations: {
          baseline: { type:'line', yMin:100, yMax:100, borderColor:'rgba(148,163,184,.4)', borderWidth:1, borderDash:[3,3],
            label:{ display:true, content:'avg = 100%', position:'end', color:'rgba(148,163,184,.7)', font:{size:9}, backgroundColor:'transparent', padding:2 }
          }
        }}
      },
      scales: {
        x: { grid: GRID, ticks:{ color:C_TX3, font:{size:9}, maxTicksLimit:12 }},
        y: { grid: GRID, ticks:{ color:C_TX3, callback:v=>v.toFixed(0)+' %' }, title:{ display:true, text:'% of daily average', color:C_TX3, font:{size:9} }}
      }
    }
  });
}

// ────────────────────────────────────────────
// View 4: BANDS — single zone, today + 30-day envelope
// ────────────────────────────────────────────
async function renderCCBands(data, selected) {
  const zones = ccGetSelectedZones(data, selected);
  // Use the first selected zone (could be made a dropdown later)
  const z = zones[0] || data[0];
  if (!z) return;
  const col = ccZoneColor(z.code, data, 0);

  const nPts = z.hourly && z.hourly.length ? z.hourly.length : 24;
  const hours = makeTimeLabels(nPts);
  const today = z.hourly || [];

  // Build 30-day envelope from history (downsampled to nPts)
  const envelope = await fetchHistoricalEnvelope(z.code, 30, nPts);

  const datasets = [];
  if (envelope) {
    datasets.push({
      label: 'Max (30d)', data: envelope.max, borderColor: 'transparent',
      backgroundColor: col + '22', fill: '+1', spanGaps: true, pointRadius: 0, tension: 0.3, order: 3,
    });
    datasets.push({
      label: 'Min (30d)', data: envelope.min, borderColor: 'transparent',
      backgroundColor: 'transparent', fill: false, spanGaps: true, pointRadius: 0, tension: 0.3, order: 3,
    });
    datasets.push({
      label: 'Median (30d)', data: envelope.median, borderColor: 'rgba(148,163,184,.5)',
      borderWidth: 1, borderDash: [4,3], pointRadius: 0, fill: false, tension: 0.3, spanGaps: true, order: 2,
    });
  }
  datasets.push({
    label: `${z.code} today`, data: today, borderColor: col, borderWidth: 2.5,
    pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col,
    fill: false, tension: 0.3, spanGaps: true, order: 1,
  });

  mkChart('price-compare-canvas', {
    type: 'line',
    data: { labels: hours, datasets },
    plugins: [ ccBuildCommonShading(nPts) ],
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display:true, position:'bottom', labels:{ color:C_TX2, font:{size:10}, boxWidth:10, padding:10 }},
        tooltip: { mode:'index', intersect:false, callbacks: {
          title: c => c[0].label,
          label: c => { const v = c.raw; if (v == null) return null; return ` ${c.dataset.label}: ${v.toFixed(1)} €/MWh`; }
        }},
        zoom: ZOOM_CFG,
      },
      scales: {
        x: { grid: GRID, ticks:{ color:C_TX3, font:{size:9}, maxTicksLimit:12 }},
        y: { grid: GRID, ticks:{ color:C_TX3, callback:v=>v.toFixed(0)+' €' }, title:{ display:true, text:'€/MWh', color:C_TX3, font:{size:9} }}
      }
    }
  });
}

// Fetch 30-day envelope (min/max/median per hour) from history files
async function fetchHistoricalEnvelope(code, nDays, nPts) {
  if (window._envelopeCache && window._envelopeCache[code]) return window._envelopeCache[code];
  const today = new Date();
  const dates = [];
  for (let i = 1; i <= nDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0,10));
  }
  const all = []; // array of hourly arrays (nPts each)
  await Promise.all(dates.map(async (dt) => {
    try {
      const r = await fetch(`data/history/daily/${dt}.json`);
      if (!r.ok) return;
      const j = await r.json();
      let z = null;
      if (j.zones && j.zones[code]) z = j.zones[code];
      else if (Array.isArray(j.zones)) z = j.zones.find(x => x.code === code);
      if (!z) return;
      const h = z.hourly || z.h;
      if (!Array.isArray(h) || !h.length) return;
      // Resample to match nPts
      const ratio = h.length / nPts;
      const resampled = [];
      for (let i = 0; i < nPts; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.max(start + 1, Math.floor((i+1) * ratio));
        const slice = h.slice(start, end).filter(v => v != null);
        resampled.push(slice.length ? slice.reduce((a,b)=>a+b,0) / slice.length : null);
      }
      all.push(resampled);
    } catch (e) { /* silent */ }
  }));
  if (!all.length) return null;
  const min = [], max = [], median = [];
  for (let i = 0; i < nPts; i++) {
    const vals = all.map(arr => arr[i]).filter(v => v != null).sort((a,b)=>a-b);
    if (!vals.length) { min.push(null); max.push(null); median.push(null); continue; }
    min.push(vals[0]);
    max.push(vals[vals.length - 1]);
    median.push(vals[Math.floor(vals.length / 2)]);
  }
  const result = { min, max, median, n: all.length };
  window._envelopeCache = window._envelopeCache || {};
  window._envelopeCache[code] = result;
  return result;
}

// ────────────────────────────────────────────
// View 5: SPREAD — all selected zones minus reference (default FR)
// ────────────────────────────────────────────
function renderCCSpread(data, selected) {
  const refCode = window._ccSpreadRef || 'FR';
  const ref = data.find(z => z.code === refCode);
  if (!ref || !ref.hourly) return;
  const refH = ref.hourly;
  const nPts = refH.length;
  const hours = makeTimeLabels(nPts);

  const datasets = [];
  data.forEach((z, i) => {
    if (!selected.has(z.code) || z.code === refCode) return;
    const col = ccZoneColor(z.code, data, i);
    const h = z.hourly && z.hourly.length === nPts ? z.hourly : null;
    if (!h) return;
    const spread = h.map((v, idx) => (v == null || refH[idx] == null) ? null : v - refH[idx]);
    datasets.push({
      label: `${z.code} − ${refCode}`, data: spread, borderColor: col, borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col,
      fill: false, tension: 0.3, spanGaps: true,
    });
  });

  mkChart('price-compare-canvas', {
    type: 'line',
    data: { labels: hours, datasets },
    plugins: [ ccBuildCommonShading(nPts) ],
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display:true, position:'bottom', labels:{ color:C_TX2, font:{size:10}, boxWidth:10, padding:10 }},
        tooltip: { mode:'index', intersect:false, callbacks: {
          title: c => c[0].label,
          label: c => { const v = c.raw; if (v == null) return null; const sign = v >= 0 ? '+' : ''; return ` ${c.dataset.label}: ${sign}${v.toFixed(1)} €/MWh`; }
        }},
        zoom: ZOOM_CFG,
        annotation: { annotations: {
          baseline: { type:'line', yMin:0, yMax:0, borderColor:'rgba(148,163,184,.5)', borderWidth:1.5,
            label:{ display:true, content:`= ${refCode}`, position:'end', color:'rgba(148,163,184,.8)', font:{size:9}, backgroundColor:'transparent', padding:2 }
          }
        }}
      },
      scales: {
        x: { grid: GRID, ticks:{ color:C_TX3, font:{size:9}, maxTicksLimit:12 }},
        y: { grid: GRID, ticks:{ color:C_TX3, callback:v=>(v>0?'+':'')+v.toFixed(0)+' €' }, title:{ display:true, text:`€/MWh vs ${refCode}`, color:C_TX3, font:{size:9} }}
      }
    }
  });
}

// ────────────────────────────────────────────
// Auto-generated analysis banner
// ────────────────────────────────────────────
function renderCCAnalysis(view, data, selected) {
  const host = document.getElementById('cc-analysis');
  if (!host) return;
  const zones = ccGetSelectedZones(data, selected);
  if (!zones.length) { host.style.display = 'none'; return; }

  const nph = zones[0].hourly && zones[0].hourly.length > 24 ? Math.round(zones[0].hourly.length/24) : 1;
  // Helper: peak/off-peak avg per zone
  const stats = zones.map(z => {
    const h = z.hourly || [];
    const valid = h.filter(v => v != null);
    if (!valid.length) return null;
    const pkV = [], opV = [];
    h.forEach((v, idx) => {
      if (v == null) return;
      const hr = Math.floor(idx / nph);
      (hr >= 8 && hr < 20 ? pkV : opV).push(v);
    });
    const avg = valid.reduce((a,b)=>a+b,0)/valid.length;
    const pk  = pkV.length ? pkV.reduce((a,b)=>a+b,0)/pkV.length : avg;
    const op  = opV.length ? opV.reduce((a,b)=>a+b,0)/opV.length : avg;
    return { code:z.code, avg, mn:Math.min(...valid), mx:Math.max(...valid), pk, op, spread:pk-op };
  }).filter(Boolean);

  let lines = [];
  let tone = 'info'; // info | warn | alert

  if (view === 'lines') {
    const inverted = stats.filter(s => s.spread < -5).length;
    const mostExpensive = [...stats].sort((a,b) => b.avg - a.avg)[0];
    const cheapest = [...stats].sort((a,b) => a.avg - b.avg)[0];
    lines.push(`Today's range across selected zones: ${cheapest.code} cheapest at <b>${cheapest.avg.toFixed(1)} €/MWh</b> avg, ${mostExpensive.code} most expensive at <b>${mostExpensive.avg.toFixed(1)} €/MWh</b> (gap: ${(mostExpensive.avg-cheapest.avg).toFixed(1)} €).`);
    if (inverted > 0) {
      lines.push(`<b>${inverted} of ${stats.length}</b> zones show inverted P/OP spread today (off-peak more expensive than peak — duck curve from solar generation).`);
      tone = inverted >= stats.length / 2 ? 'warn' : 'info';
    }
  } else if (view === 'heatmap') {
    const negZones = stats.filter(s => s.mn < 0);
    const veryLowZones = stats.filter(s => s.mn < 5 && s.mn >= 0);
    if (negZones.length) {
      lines.push(`<b>Negative prices</b> in ${negZones.map(z=>z.code).join(', ')} (min: ${Math.min(...negZones.map(z=>z.mn)).toFixed(1)} €/MWh). Solar oversupply during midday hours.`);
      tone = 'warn';
    } else if (veryLowZones.length) {
      lines.push(`Near-zero prices in ${veryLowZones.map(z=>z.code).join(', ')} during the solar trough (typical 11h-15h).`);
    }
    const peakZone = [...stats].sort((a,b) => b.mx - a.mx)[0];
    lines.push(`Highest peak: <b>${peakZone.code}</b> at ${peakZone.mx.toFixed(1)} €/MWh. Read rows left-to-right to spot zones that share or diverge in their daily shape.`);
  } else if (view === 'profile') {
    // Find zone with widest profile (max/min ratio)
    const profiles = stats.map(s => ({ ...s, spread: s.mx - s.mn, ratio: s.avg !== 0 ? (s.mx - s.mn) / Math.abs(s.avg) : 0 }));
    const flattest = [...profiles].sort((a,b) => a.ratio - b.ratio)[0];
    const peakiest = [...profiles].sort((a,b) => b.ratio - a.ratio)[0];
    lines.push(`Shape comparison normalised on each zone's daily average. <b>${peakiest.code}</b> has the most pronounced shape (max swing ${(peakiest.ratio*100).toFixed(0)}% of avg), <b>${flattest.code}</b> is the flattest (${(flattest.ratio*100).toFixed(0)}%).`);
    lines.push(`Useful for PPA shape risk: same shape ≠ same risk if avg levels differ — a 50% swing on a €30 base costs less than on a €130 base.`);
  } else if (view === 'bands') {
    const z = zones[0];
    if (z) {
      const env = window._envelopeCache && window._envelopeCache[z.code];
      if (env && env.n) {
        lines.push(`<b>${z.code}</b> today vs ${env.n}-day envelope. Shaded area = historical min/max range, dashed line = median.`);
        // Check if today is outside envelope
        const today = z.hourly || [];
        let above = 0, below = 0;
        today.forEach((v, i) => {
          if (v == null || env.max[i] == null) return;
          if (v > env.max[i]) above++;
          if (v < env.min[i]) below++;
        });
        if (above > today.length * 0.1) { lines.push(`Today's prices are <b>above the historical max</b> for ${above} hours — abnormal upside.`); tone = 'warn'; }
        else if (below > today.length * 0.1) { lines.push(`Today's prices are <b>below the historical min</b> for ${below} hours — abnormal downside.`); tone = 'warn'; }
        else lines.push(`Today's prices stay within the envelope — typical day for this zone.`);
      } else {
        lines.push(`Loading historical envelope for <b>${z.code}</b>… If empty, history files may not be available for this zone.`);
      }
    }
  } else if (view === 'spread') {
    const refCode = window._ccSpreadRef || 'FR';
    const ref = data.find(z => z.code === refCode);
    if (ref && ref.hourly) {
      const refStats = stats.find(s => s.code === refCode);
      const others = stats.filter(s => s.code !== refCode);
      if (others.length && refStats) {
        const premium = others.filter(s => s.avg > refStats.avg);
        const discount = others.filter(s => s.avg < refStats.avg);
        if (premium.length) lines.push(`<b>Premium vs ${refCode}</b>: ${premium.sort((a,b)=>(b.avg-refStats.avg)-(a.avg-refStats.avg)).map(s=>`${s.code} +${(s.avg-refStats.avg).toFixed(1)}€`).join(', ')}.`);
        if (discount.length) lines.push(`<b>Discount vs ${refCode}</b>: ${discount.sort((a,b)=>(a.avg-refStats.avg)-(b.avg-refStats.avg)).map(s=>`${s.code} ${(s.avg-refStats.avg).toFixed(1)}€`).join(', ')}.`);
        lines.push(`Spreads above the 0-line indicate import opportunities into ${refCode}; below indicate export.`);
      }
    }
  }

  if (!lines.length) { host.style.display = 'none'; return; }

  const toneColor = tone === 'warn' ? 'var(--warn)' : tone === 'alert' ? 'var(--down)' : 'var(--accent, var(--text2))';
  host.style.borderLeftColor = toneColor;
  host.style.display = 'block';
  host.innerHTML = lines.map(l => `<div style="margin:2px 0">${l}</div>`).join('');
}

// Initialise tabs on first load
if (typeof window !== 'undefined') {
  const initCCTabs = () => {
    if (!window._ccView) window._ccView = 'lines';
    if (!window._ccSpreadRef) window._ccSpreadRef = 'FR';
    renderCCTabs();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCCTabs);
  } else {
    initCCTabs();
  }
}

function renderCompareKPIs(data, selected) {
  // Renders a comparison table with horizontal Range bar (option C).
  // All metrics computed on raw slots (15-min if available) for consistency.
  const tbody = document.getElementById('compare-data-tbody');
  if (!tbody || !data) return;

  // First pass: compute all rows so we can find global min/max for Range bar scaling
  const rows = [];
  data.forEach(z => {
    if (!selected.has(z.code)) return;
    const h = z.hourly && z.hourly.length ? z.hourly : [];
    const valid = h.filter(v => v != null);
    if (!valid.length) return;
    const avg = valid.reduce((a,b)=>a+b,0) / valid.length;
    const mn  = Math.min(...valid);
    const mx  = Math.max(...valid);
    const nph = h.length > 24 ? Math.round(h.length/24) : 1;
    const resMin = nph === 4 ? 15 : 60;
    const minIdx = h.indexOf(mn);
    const maxIdx = h.indexOf(mx);
    const fmtSlot = (idx) => {
      if (idx < 0) return '--';
      const totalMin = idx * resMin;
      const hh = Math.floor(totalMin / 60);
      const mm = totalMin % 60;
      return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
    };
    const pkV = [], opV = [];
    h.forEach((v, i) => {
      if (v == null) return;
      const hr = Math.floor(i / nph);
      (hr >= 8 && hr < 20 ? pkV : opV).push(v);
    });
    const pk = pkV.length ? pkV.reduce((a,b)=>a+b,0)/pkV.length : avg;
    const op = opV.length ? opV.reduce((a,b)=>a+b,0)/opV.length : avg;
    rows.push({
      z, code: z.code, avg, mn, mx,
      minHr: fmtSlot(minIdx),
      maxHr: fmtSlot(maxIdx),
      pk, op, spread: pk - op,
    });
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--tx3);text-align:center;padding:14px">No zones selected</td></tr>';
    return;
  }

  // Global scale for Range bar (across all selected zones)
  const globalMin = Math.min(...rows.map(r => r.mn));
  const globalMax = Math.max(...rows.map(r => r.mx));
  const globalRng = globalMax - globalMin || 1;

  // Helper: spread colour by severity
  const spreadColor = (s) => {
    if (s >= 0) return 'var(--text2)';                  // normal: peak >= off-peak
    if (s > -20) return 'var(--warn)';                  // mildly inverted
    return 'var(--down)';                               // deeply inverted
  };

  const html = rows.map(r => {
    const col = window._zoneColorMap?.[r.code] || '#B8C9D9';
    const meta = ZONE_META[r.code] || { country: r.z.name || r.code };
    // Bar lives in a fixed-width inner zone between the two labels.
    // leftPct/widthPct are computed against that inner zone, not the full cell.
    const leftPct  = ((r.mn - globalMin) / globalRng) * 100;
    const widthPct = ((r.mx - r.mn) / globalRng) * 100;
    const negMin = r.mn < 0;
    const negMax = r.mx < 0;

    // Spread: value line 1, qualitative tag line 2
    let spreadValue, spreadTag = '';
    if (r.spread >= 0) {
      spreadValue = `<span style="color:var(--text2)">+${r.spread.toFixed(1)}</span>`;
    } else if (r.spread > -20) {
      spreadValue = `<span style="color:var(--warn)">${r.spread.toFixed(1)}</span>`;
      spreadTag = `<div style="font-size:9px;color:var(--text3);margin-top:2px">inverted</div>`;
    } else {
      spreadValue = `<span style="color:var(--down)">${r.spread.toFixed(1)}</span>`;
      spreadTag = `<div style="font-size:9px;color:var(--down);opacity:.75;margin-top:2px">deeply inverted</div>`;
    }

    return `<tr style="border-bottom:1px solid rgba(30,45,61,.5)">
      <td style="padding:14px;vertical-align:middle">
        <span style="display:inline-block;width:3px;height:14px;background:${col};border-radius:2px;vertical-align:middle;margin-right:8px"></span>
        <span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${col};font-size:11px">${r.z.flag||''} ${r.code}</span>
        <span style="color:var(--text3);margin-left:6px;font-family:'Inter',sans-serif;font-size:11px">${meta.country||''}</span>
      </td>
      <td style="text-align:right;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;color:var(--text);vertical-align:middle">${r.avg.toFixed(1)}</td>
      <td style="padding:10px 14px;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="flex:0 0 56px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:11px;color:${negMin?'var(--down)':'var(--text2)'};line-height:12px">
            ${r.mn.toFixed(1)}<br><span style="color:var(--text3);font-size:9px">@${r.minHr}</span>
          </div>
          <div style="flex:1;position:relative;height:10px">
            <div style="position:absolute;top:0;left:0;right:0;height:100%;background:var(--bg);border-radius:2px"></div>
            <div style="position:absolute;top:0;left:${leftPct.toFixed(1)}%;width:${Math.max(widthPct,2).toFixed(1)}%;height:100%;background:${col};opacity:.55;border-radius:2px"></div>
          </div>
          <div style="flex:0 0 56px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:11px;color:${negMax?'var(--down)':'var(--text2)'};line-height:12px">
            ${r.mx.toFixed(1)}<br><span style="color:var(--text3);font-size:9px">@${r.maxHr}</span>
          </div>
        </div>
      </td>
      <td style="text-align:right;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12px;vertical-align:middle">
        <span style="color:var(--text)">${r.pk.toFixed(1)}</span> <span style="color:var(--text3)">/</span> <span style="color:var(--text2)">${r.op.toFixed(1)}</span>
      </td>
      <td style="text-align:right;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12px;vertical-align:middle">${spreadValue}${spreadTag}</td>
    </tr>`;
  });

  tbody.innerHTML = html.join('');
}

function makeSVGSparkline(data, positive) {
  const w = 80, h = 28, pad = 2;
  const mn = Math.min(...data), mx = Math.max(...data);
  const rng = mx - mn || 1;
  const col = positive ? '#14D3A9' : '#ED6965';
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - mn) / rng) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Area fill path
  const first = `${pad},${h - pad}`;
  const last = `${(w - pad).toFixed(1)},${h - pad}`;
  const area = `${first} ${pts} ${last}`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <polygon points="${area}" fill="${col}" fill-opacity="0.15"/>
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}


// ── HOURLY DATA HELPERS
function getResolution(data) {
  // Returns interval in minutes based on number of points
  const n = data.length;
  if (n <= 24) return 60;
  if (n <= 48) return 30;
  if (n <= 96) return 15;
  return Math.round(24*60/n);
}

function makeTimeLabels(n) {
  const mins = Math.round(24*60/n);
  return Array.from({length:n}, (_,i) => {
    const totalMin = i * mins;
    const h = Math.floor(totalMin/60);
    const m = totalMin % 60;
    if (mins >= 60) return h+'h';
    return m === 0 ? h+'h' : (m === 30 ? h+':30' : h+':'+String(m).padStart(2,'0'));
  });
}

function negHoursFromData(data) {
  const mins = getResolution(data);
  const negPoints = data.filter(v => v !== null && v !== undefined && v < 0).length;
  return Math.round(negPoints * mins / 60 * 10) / 10; // in hours, 1dp
}

function generateDemoHourly(avg, min, max) {
  // Synthetic daily profile: low at night, peak morning/evening
  const profile = [0.6,0.5,0.45,0.4,0.4,0.5,0.7,0.85,0.9,0.85,0.75,0.6,0.65,0.7,0.8,0.9,0.95,1.0,0.95,0.85,0.8,0.75,0.7,0.65];
  const range = max - min;
  return profile.map(p => min + p * range + (Math.random() - 0.5) * range * 0.1);
}

function drawSparkline(canvas, data, avg) {
  if (!canvas || !data || data.length < 2) return;
  const positive = avg >= 0;
  const col = positive ? C_UP : C_DN;
  mkChart(canvas.id, {
    type: 'line',
    data: {
      labels: data.map((_,i) => i+'h'),
      datasets: [{ data, borderColor: col, borderWidth: 1.5, pointRadius: 0, fill: true,
        backgroundColor: (ctx2) => {
          const g = ctx2.chart.ctx.createLinearGradient(0,0,0,28);
          g.addColorStop(0, rgba(col,.25)); g.addColorStop(1, rgba(col,0)); return g;
        }, tension: 0.3 }]
    },
    options: {
      animation: false, responsive: false,
      plugins: { legend:{display:false}, tooltip:{enabled:false} },
      scales: { x:{display:false}, y:{display:false} },
      layout: { padding: 1 }
    }
  });
}

// ════════════════════════════════════════════
// TICKER
// ════════════════════════════════════════════
