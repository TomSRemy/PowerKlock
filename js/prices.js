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
            borderColor: '#00d4a8',
            backgroundColor: 'rgba(0,212,168,0.08)',
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointRadius: 3,
            pointBackgroundColor: '#00d4a8'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a6280', font: { size: 11 } } },
            y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a6280', font: { size: 11 } }, title: { display: true, text: '€/MWh', color: '#4a6280', font: { size: 10 } } }
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
          backgroundColor: ['#00d4a8','#60a5fa','#fbbf24','#34d399','#a78bfa','#4a6280'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, padding: 10, boxWidth: 10 } }
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
      <div style="padding:8px 12px;background:var(--bg3);border-radius:6px;border-left:2px solid #4a6280">
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
    for (let i = 0; i < ZONES.length; i += batchSize) {
      const batchRes = await batch(ZONES.slice(i, i+batchSize));
      results.push(...batchRes);
      pricesData = results.sort((a,b) => b.today - a.today);
      renderPricesTable(pricesData);
      updateKPIs(pricesData);
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

    const batchSize = 6;
    for (let i = 0; i < ZONES.length; i += batchSize) {
      const batchResults = await batch(ZONES.slice(i, i + batchSize));
      results.push(...batchResults);
      pricesData = results.sort((a,b) => b.today - a.today);
      renderPricesTable(pricesData);
      updateKPIs(pricesData);
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

function updateKPIs(data) {
  const fr = data.find(d => d.code === 'FR');
  const de = data.find(d => d.code === 'DE_LU');
  const avg = data.reduce((a,b) => a + b.today, 0) / data.length;
  const maxZ = data[0];
  const minZ = data[data.length - 1];

  if (fr) {
    document.getElementById('kpi-fr').innerHTML = `${fr.today.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
    document.getElementById('kpi-fr-chg').innerHTML = fr.vsYday != null
      ? `<span class="${fr.vsYday >= 0 ? 'up':'down'}">${fr.vsYday >= 0 ? '▲':'▼'} ${Math.abs(fr.vsYday).toFixed(1)} vs yday</span>`
      : '<span style="color:var(--text3)">FR bidding zone</span>';
  }
  if (de) {
    document.getElementById('kpi-de').innerHTML = `${de.today.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
    document.getElementById('kpi-de').className = `kpi-value ${de.today < 0 ? 'down' : de.today > 80 ? 'up' : ''}`;
  }
  document.getElementById('kpi-avg').innerHTML = `${avg.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
  document.getElementById('kpi-avg-chg').textContent = `${data.length} zones loaded`;
  document.getElementById('kpi-max').innerHTML = `${maxZ.today.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
  document.getElementById('kpi-max-zone').textContent = `${maxZ.flag} ${maxZ.name}`;
  document.getElementById('kpi-min').innerHTML = `${minZ.today.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
  document.getElementById('kpi-min-zone').textContent = `${minZ.flag} ${minZ.name}`;

  // Peak / Off-Peak for FR
  if (fr && fr.hourly && fr.hourly.length >= 24) {
    const h = fr.hourly;
    const nPerHour = Math.round(h.length / 24);
    const peakVals    = [], offPeakVals = [];
    h.forEach((v, i) => {
      if (v == null) return;
      const hr = Math.floor(i / nPerHour);
      (hr >= 8 && hr < 20 ? peakVals : offPeakVals).push(v);
    });
    const peakAvg    = peakVals.length    ? peakVals.reduce((a,b)=>a+b,0)/peakVals.length       : fr.today;
    const offPeakAvg = offPeakVals.length ? offPeakVals.reduce((a,b)=>a+b,0)/offPeakVals.length : fr.today;
    const el_pk = document.getElementById('kpi-fr-peak');
    const el_op = document.getElementById('kpi-fr-offpeak');
    if (el_pk) el_pk.innerHTML = `${peakAvg.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
    if (el_op) el_op.innerHTML = `${offPeakAvg.toFixed(1)}<span class="kpi-unit">€/MWh</span>`;
    const spread = peakAvg - offPeakAvg;
    const el_pks = document.getElementById('kpi-fr-peak-chg');
    const el_ops = document.getElementById('kpi-fr-offpeak-chg');
    if (el_pks) el_pks.textContent = `spread ${spread >= 0 ? '+' : ''}${spread.toFixed(1)} €`;
    if (el_ops) el_ops.textContent = `00h–08h / 20h–24h`;
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
      color:${allOn ? '#00d4a8' : someOn ? '#f59e0b' : 'rgba(255,255,255,.35)'};
    ">
      <span style="width:14px;height:14px;border-radius:3px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
        border:1.5px solid ${allOn?'#00d4a8':someOn?'#f59e0b':'rgba(255,255,255,.2)'};
        background:${allOn?'rgba(0,212,168,.2)':someOn?'rgba(245,158,11,.15)':'transparent'}">
        ${allOn ? checkSvg('#00d4a8') : someOn ? '<div style="width:6px;height:2px;background:#f59e0b;border-radius:1px"></div>' : ''}
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
          color:${isOn ? '#00d4a8' : 'rgba(255,255,255,.35)'};
        ">
          <span style="width:12px;height:12px;border-radius:2px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
            border:1.5px solid ${isOn?'#00d4a8':'rgba(255,255,255,.15)'};
            background:${isOn?'rgba(0,212,168,.2)':'transparent'}">
            ${isOn ? checkSvg('#00d4a8') : ''}
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
    nuclear: {emoji:'⚛', label:'Nuclear',  color:'#3b82f6'},
    wind:    {emoji:'🌬', label:'Wind',     color:'#00d4a8'},
    solar:   {emoji:'☀', label:'Solar',    color:'#fbbf24'},
    hydro:   {emoji:'💧', label:'Hydro',    color:'#34d399'},
    biomass: {emoji:'🌿', label:'Biomass',  color:'#6ee7b7'},
    fossil:  {emoji:'🔥', label:'Fossil',   color:'#f87171'},
  };

  const rows = sorted.map((z, i) => {
    if (z.today == null || isNaN(z.today)) return {html:'', z, i};
    if (zoneFilter && !zoneFilter.has(z.code)) return {html:'', z, i};

    const meta = ZONE_META[z.code] || {cc:z.code, country:z.name||z.code};
    const priceColor = z.today < 0 ? '#f05060' : z.today > 150 ? '#f59e0b' : z.today < 20 ? '#10b981' : 'var(--tx)';
    const vsColor = z.vsYday == null ? 'var(--tx3)' : z.vsYday >= 0 ? 'var(--dn)' : 'var(--up)';
    const vsText  = z.vsYday == null ? '–' : `${z.vsYday >= 0 ? '▲' : '▼'} ${Math.abs(z.vsYday).toFixed(1)}`;
    const sparkColor = z.spark == null ? 'var(--tx3)' : z.spark >= 0 ? '#10b981' : '#f05060';
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
      const renColor = renP >= 60 ? '#10b981' : renP >= 40 ? '#f59e0b' : '#f87171';
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
    // Color: green if positive avg, red if mostly negative, orange if mixed
    const sparkPositive = z.today >= 0 ? true : z.today < -20 ? false : 'mixed';
    const sparkSvg = makeSVGSparklineSmooth(h24spark, sparkPositive);

    const html = `<tr style="cursor:pointer" onclick="togglePriceRow(${i}, event)" title="Expand 15-min chart">
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--acc)">${FLAG_MAP[z.code]||''} ${z.code}</td>
      <td style="font-size:11px;color:var(--tx2)">${meta.country||z.name||z.code}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${priceColor}">${z.today.toFixed(1)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2)" title="Avg over 08h–20h">${peakStr}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx3)" title="Avg over 00h–08h / 20h–24h">${offPeakStr}</td>
      <td style="color:${vsColor}">${vsText}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2)">${z.min!=null?z.min.toFixed(1):'–'}<span style="color:var(--tx3);font-size:9px"> @${z.minHr??''}h</span></td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2)">${z.max!=null?z.max.toFixed(1):'–'}<span style="color:var(--tx3);font-size:9px"> @${z.maxHr??''}h</span></td>
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
  const col = positive === true ? '#10b981' : positive === 'mixed' ? '#f59e0b' : '#f05060';
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

  const valid = h24.filter(v => v != null);
  const avg   = valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : 0;
  const minV  = valid.length ? Math.min(...valid) : 0;
  const maxV  = valid.length ? Math.max(...valid) : 0;
  const minIdx = h24.indexOf(minV);
  const maxIdx = h24.indexOf(maxV);

  // Peak (08-20) and Off-peak
  const peakHours = h24.slice(8,20).filter(v=>v!=null);
  const offPkHours = [...h24.slice(0,8), ...h24.slice(20)].filter(v=>v!=null);
  const peakAvg   = peakHours.length ? peakHours.reduce((a,b)=>a+b,0)/peakHours.length : null;
  const offPkAvg  = offPkHours.length ? offPkHours.reduce((a,b)=>a+b,0)/offPkHours.length : null;
  const peakRatio = (peakAvg && offPkAvg && offPkAvg !== 0) ? peakAvg/offPkAvg : null;
  const isFlatter = peakRatio !== null && peakRatio < 1.20;
  const flatText  = peakRatio !== null
    ? (isFlatter ? '● Flatter than normal' : '● Normal profile')
    : '';
  const flatColor = isFlatter ? '#00d4a8' : '#e8a020';

  // Neg hours
  const negSlots = h24.filter(v => v != null && v < 0);
  const negH     = negSlots.length;
  const negHours = Math.floor(negH);
  const negMins  = Math.round((negH - negHours) * 60);
  const negMin   = negSlots.length ? Math.min(...negSlots) : null;

  // Labels
  const labels = h24.map((_, i) => `${String(i).padStart(2,'0')}:00`);

  // Zone colors per hour: off-peak(night), morning-peak, solar-trough, evening-peak
  const bgColors = h24.map((v, i) => {
    if (i >= 7 && i <= 9)   return 'rgba(232,160,32,0.08)';  // morning ramp
    if (i >= 11 && i <= 14) return 'rgba(0,212,168,0.06)';   // solar trough
    if (i >= 17 && i <= 21) return 'rgba(232,160,32,0.08)';  // evening peak
    return 'transparent';
  });

  // Build inner HTML
  inner.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
      ${[
        {l:'Average',      v:avg.toFixed(2),                              u:'€/MWh', c:''},
        {l:'Peak (08-20)', v:peakAvg!=null?peakAvg.toFixed(2):'--',       u:'€/MWh', c:'dn'},
        {l:'Off-Peak',     v:offPkAvg!=null?offPkAvg.toFixed(2):'--',     u:'€/MWh', c:'up'},
        {l:'Min',          v:minV.toFixed(2), sub:'@'+String(minIdx).padStart(2,'0')+'h', u:'€/MWh', c:minV<0?'warn':'up'},
        {l:'Max',          v:maxV.toFixed(2), sub:'@'+String(maxIdx).padStart(2,'0')+'h', u:'€/MWh', c:'dn'},
      ].map(k=>`<div style="background:var(--bg2);border:1px solid var(--bd);border-left:3px solid ${col};border-radius:6px;padding:9px 12px">
        <div style="font-size:9px;color:var(--tx3);font-weight:600;letter-spacing:.07em;text-transform:uppercase;margin-bottom:3px">${k.l}</div>
        <div style="font-size:15px;font-weight:700;font-family:'JetBrains Mono',monospace;color:var(--${k.c||'tx'})">${k.v}<span style="font-size:10px;color:var(--tx3);font-weight:400"> ${k.u||''}</span></div>
        ${k.sub ? `<div style="font-size:10px;color:var(--tx3)">${k.sub}</div>` : ''}
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
    ${negH > 0 ? `<div style="font-size:11px;color:var(--warn);margin-bottom:8px">⚠ ${negHours}h ${String(negMins).padStart(2,'0')}min negative prices · min: ${negMin.toFixed(1)} €/MWh</div>` : ''}
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

  // Render chart — use full 15-min data
  const canvas = document.getElementById(`row-chart-${idx}`);
  if (!canvas) return;
  if (_rowCharts[idx]) { _rowCharts[idx].destroy(); }

  // Use 96-pt data if available, fallback to h24
  const chartData   = (z.hourly && z.hourly.length === 96) ? z.hourly : h24;
  const chartLabels = makeTimeLabels(chartData.length);
  // Color: zone color if positive avg, red/orange if significant negative prices
  const negFraction = chartData.filter(v=>v!=null&&v<0).length / chartData.filter(v=>v!=null).length;
  const col = negFraction >= 0.5 ? '#f05060' : negFraction >= 0.2 ? '#f59e0b' : zoneColor(z.code);
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
  // Min/Max points on the h24 scale (approximate idx for 96pt)
  const scale = chartData.length / 24;
  annotations.minPt = { type:'point', xValue:Math.round(minIdx*scale), yValue:minV,
    backgroundColor:'#ef4444', radius:5,
    label:{display:true,content:minV.toFixed(0)+'€/MWh',color:'#fff',font:{size:9},backgroundColor:'#ef4444',position:'bottom',padding:2}
  };
  annotations.maxPt = { type:'point', xValue:Math.round(maxIdx*scale), yValue:maxV,
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
        legend:{display: datasets.length>1, labels:{color:'#4a6280',font:{size:10},boxWidth:16,usePointStyle:true,pointStyle:'line'}},
        tooltip:{mode:'index',intersect:false,callbacks:{label:ctx=>` ${ctx.dataset.label}: ${ctx.parsed.y!=null?ctx.parsed.y.toFixed(2)+' €/MWh':'n/a'}`}},
        annotation:{annotations},
        zoom:ZOOM_CFG,
      },
      scales:{
        x:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#4a6280',font:{size:9},maxTicksLimit:12}},
        y:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#4a6280',font:{size:10},callback:v=>v+'€/MWh'},
           title:{display:true,text:'€/MWh',color:'#4a6280',font:{size:10}}},
      },
    },
  });
}


const COMPARE_COLORS = ['#10b981','#60a5fa','#f59e0b','#a78bfa','#f05060','#34d399','#f472b6','#38bdf8','#fb923c','#818cf8'];

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
    const col  = window._zoneColorMap[z.code] || '#4a6280';
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
    const col = window._zoneColorMap?.[z.code] || '#4a6280';
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

function renderCompareChart() {
  const data = window._pricesSorted;
  if (!data || !data.length) return;
  const selected = window._compareZones || new Set(['FR']);
  // Use resolution of first selected zone's data
  const firstZone = data.find(z => selected.has(z.code));
  const nPts = (firstZone && firstZone.hourly && firstZone.hourly.length) ? firstZone.hourly.length : 24;
  const hours = makeTimeLabels(nPts);
  const curHr = new Date().getHours();
  const curIdx = Math.min(curHr, nPts - 1);

  const datasets = [];
  let colorIdx = 0;
  if (!window._zoneColorMap) {
    window._zoneColorMap = {};
    data.forEach((z,i) => { window._zoneColorMap[z.code] = COMPARE_COLORS[i % COMPARE_COLORS.length]; });
  }
  data.forEach((z,i) => {
    if (!selected.has(z.code)) return;
    const baseCol = window._zoneColorMap[z.code] || COMPARE_COLORS[i % COMPARE_COLORS.length];
    const hourly = z.hourly && z.hourly.length ? z.hourly : generateDemoHourly(z.today, z.min, z.max);
    const negFracCC = hourly.filter(v=>v!=null&&v<0).length / Math.max(1, hourly.filter(v=>v!=null).length);
    const col = negFracCC >= 0.5 ? '#f05060' : negFracCC >= 0.2 ? '#f59e0b' : baseCol;
    // Today — solid with transparent fill
    datasets.push({
      label:`${z.code} · ${z.name}`,
      data:hourly,
      borderColor:col,
      borderWidth:2,
      pointRadius:0,
      pointHoverRadius:5,
      pointHoverBackgroundColor:col,
      pointHoverBorderColor:'#fff',
      pointHoverBorderWidth:2,
      fill:true,
      backgroundColor:(ctx2) => {
        const g = ctx2.chart.ctx.createLinearGradient(0,0,0,320);
        g.addColorStop(0, col+'28'); g.addColorStop(1, col+'00'); return g;
      },
      tension:0.3,
    });
    // J-1 — dashed, same color, 50% opacity
    if (z.hourlyYday && z.hourlyYday.length) {
      datasets.push({
        label:`${z.code} J-1`,
        data: z.hourlyYday,
        borderColor: col,
        borderWidth: 1.2,
        borderDash: [5,4],
        pointRadius: 0,
        fill: false,
        tension: 0,
        opacity: 0.5,
      });
    }
    // J-2 — dashed, more transparent
    if (z.hourlyJ2 && z.hourlyJ2.length) {
      datasets.push({
        label:`${z.code} J-2`,
        data: z.hourlyJ2,
        borderColor: col,
        borderWidth: 1,
        borderDash: [2,4],
        pointRadius: 0,
        fill: false,
        tension: 0,
        opacity: 0.3,
      });
    }
  });

  // Shading plugin for compare chart
  const ccShadingPlugin = {
    id:'ccShading',
    beforeDraw(chart) {
      const {ctx,chartArea,scales:{x}}=chart; if(!x||!chartArea) return;
      const {top,bottom}=chartArea; const sc=nPts/24;
      const zones=[
        {from:7*sc,to:9*sc,  color:'rgba(232,160,32,0.05)'},
        {from:11*sc,to:14*sc,color:'rgba(0,212,168,0.04)'},
        {from:17*sc,to:21*sc,color:'rgba(232,160,32,0.05)'},
      ];
      ctx.save();
      zones.forEach(({from,to,color})=>{
        const x0=x.getPixelForValue(from),x1=x.getPixelForValue(to);
        ctx.fillStyle=color; ctx.fillRect(x0,top,x1-x0,bottom-top);
      });
      ctx.restore();
    }
  };

  mkChart('price-compare-canvas', {
    type:'line',
    data:{ labels:hours, datasets },
    plugins:[ccShadingPlugin],
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ display:true, position:'bottom', labels:{color:C_TX2,font:{size:10},boxWidth:10,padding:10,
          filter: item => !(item.text.includes('J-1')||item.text.includes('J-2'))
        }},
        tooltip:{
          mode:'index', intersect:false,
          callbacks:{
            title: c => c[0].label,
            label: c => {
              const v = c.raw; if (v==null) return null;
              return ` ${c.dataset.label}: ${v.toFixed(1)} €/MWh`;
            }
          }
        },
        zoom:ZOOM_CFG,
        annotation:{
          annotations:{
            nowline:{
              type:'line', xMin:curIdx, xMax:curIdx,
              borderColor:'rgba(255,220,100,.7)', borderWidth:1.5, borderDash:[4,3],
              label:{display:true,content:'NOW',position:'start',color:'rgba(255,220,100,.9)',font:{size:9,weight:'600'},backgroundColor:'transparent',padding:2}
            }
          }
        }
      },
      scales:{
        x:{grid:GRID, ticks:{color:C_TX3, font:{size:9}, maxTicksLimit:12}},
        y:{grid:GRID, ticks:{color:C_TX3, callback:v=>v.toFixed(0)+' €'}, title:{display:true,text:'€/MWh',color:C_TX3,font:{size:9}}}
      }
    }
  });

  // KPI strip per selected zone below chart
  renderCompareKPIs(data, selected);
  setTimeout(()=>{ addFullscreen('price-compare-canvas'); addDownload('price-compare-canvas','price-comparison'); renderCompareKPIs(data, selected); },100);
}

function renderCompareKPIs(data, selected) {
  // Now renders a table instead of KPI cards
  const tbody = document.getElementById('compare-data-tbody');
  if (!tbody || !data) return;
  const rows = [];
  data.forEach(z => {
    if (!selected.has(z.code)) return;
    const col = window._zoneColorMap?.[z.code] || '#4a6280';
    const h = z.hourly && z.hourly.length ? z.hourly : [];
    const valid = h.filter(v=>v!=null);
    if (!valid.length) return;
    const avg = valid.reduce((a,b)=>a+b,0)/valid.length;
    const mn  = Math.min(...valid), mx = Math.max(...valid);
    const nph = h.length > 24 ? Math.round(h.length/24) : 1;
    const pkV=[], opV=[];
    h.forEach((v,i)=>{ if(v==null)return; const hr=Math.floor(i/nph); (hr>=8&&hr<20?pkV:opV).push(v); });
    const pk = pkV.length ? pkV.reduce((a,b)=>a+b,0)/pkV.length : avg;
    const op = opV.length ? opV.reduce((a,b)=>a+b,0)/opV.length : avg;
    const spread = pk - op;
    const meta = ZONE_META[z.code] || {country:z.name||z.code};
    rows.push(`<tr>
      <td>
        <span style="display:inline-block;width:3px;height:14px;background:${col};border-radius:2px;vertical-align:middle;margin-right:6px"></span>
        <span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${col}">${z.flag||''} ${z.code}</span>
        <span style="color:var(--tx3);margin-left:4px">${meta.country}</span>
      </td>
      <td style="font-family:'JetBrains Mono',monospace;font-weight:600;color:${avg<0?'var(--dn)':avg<20?'var(--up)':'var(--tx)'}">${avg.toFixed(1)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--up)">${mn.toFixed(1)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--dn)">${mx.toFixed(1)}</td>
      <td style="font-family:'JetBrains Mono',monospace">${pk.toFixed(1)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx3)">${op.toFixed(1)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:${spread>=0?'var(--up)':'var(--tx3)'}">${spread>=0?'+':''}${spread.toFixed(1)}</td>
    </tr>`);
  });
  tbody.innerHTML = rows.join('') || '<tr><td colspan="7" style="color:var(--tx3);text-align:center">No zones selected</td></tr>';
}

function makeSVGSparkline(data, positive) {
  const w = 80, h = 28, pad = 2;
  const mn = Math.min(...data), mx = Math.max(...data);
  const rng = mx - mn || 1;
  const col = positive ? '#10b981' : '#f05060';
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