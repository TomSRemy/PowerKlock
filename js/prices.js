// ════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════
const ENTSOE_TOKEN = 'YOUR_ENTSOE_TOKEN_HERE'; // Get free at transparency.entsoe.eu

// ════════════════════════════════════════════
// PK_FMT — Shared formatting helpers (used by prices.js + hist.js)
// Single source of truth for number/delta/neg-hours formatting and
// semantic color thresholds. Keep in sync with brief decisions.
// ════════════════════════════════════════════
window.PK_FMT = (function() {
  // Decimal separator: point. Thousands separator: thin space.
  // Always 2 decimals for prices (€/MWh).
  function num(v, decimals) {
    if (v == null || isNaN(v)) return '--';
    const d = decimals == null ? 2 : decimals;
    const fixed = Number(v).toFixed(d);
    const [intPart, decPart] = fixed.split('.');
    // Insert thin space (U+202F) every 3 digits from right; handle minus sign.
    const sign = intPart.startsWith('-') ? '-' : '';
    const absInt = sign ? intPart.slice(1) : intPart;
    const withSep = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
    return sign + withSep + (decPart != null ? '.' + decPart : '');
  }

  // Signed delta: "▲ +1.50" / "▼ -1.50" / "● 0.00".
  // Returns {html, color}. Caller wraps with <span style="color:..."> if needed.
  // priceContext = true means "lower is better for buyer": down=green, up=red.
  function delta(v, opts) {
    opts = opts || {};
    const priceContext = opts.priceContext !== false; // default true
    if (v == null || isNaN(v)) return { text: '–', color: 'var(--tx3)' };
    const abs = Math.abs(v);
    let arrow, color;
    if (v > 0) {
      arrow = '▲';
      color = priceContext ? 'var(--dn)' : 'var(--up)';
    } else if (v < 0) {
      arrow = '▼';
      color = priceContext ? 'var(--up)' : 'var(--dn)';
    } else {
      arrow = '●';
      color = 'var(--tx3)';
    }
    const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
    return { text: `${arrow} ${sign}${num(abs, 2)}`, color };
  }

  // Negative hours: compact variable format.
  //   - h <= 0      → '–'
  //   - h < 1       → 'XXmin'   (15-min granularity)
  //   - h < 100     → 'XhYY' (or 'Xh' when minutes are 0)
  //   - h >= 100    → 'XXXh'    (integer hours)
  function negHours(h) {
    if (h == null || isNaN(h) || h <= 0) return '–';
    if (h >= 100) return `${Math.round(h)}h`;
    const totalMin = Math.round(h * 60 / 15) * 15;
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hrs === 0) return `${mins}min`;
    if (mins === 0) return `${hrs}h`;
    return `${hrs}h${String(mins).padStart(2,'0')}`;
  }

  // %REN color thresholds (harmonised T1 + T2):
  //   < 35   → red
  //   35-65  → orange
  //   > 65   → green
  function renColor(pct) {
    if (pct == null || isNaN(pct)) return 'var(--tx3)';
    if (pct < 35) return '#ED6965';
    if (pct <= 65) return '#FBBF24';
    return '#14D3A9';
  }

  // SPREAD INTRADAY color thresholds (T2):
  //   < 80   → neutral grey
  //   80-150 → light green
  //   > 150  → intense green
  function spreadColor(v) {
    if (v == null || isNaN(v)) return 'var(--tx3)';
    if (v < 80) return 'var(--tx2)';
    if (v <= 150) return '#14D3A9';
    return '#0FAC8A';
  }

  // NEG HOURS color (Daily T1 + Historical T2 share same logic):
  //   - 0/null → muted
  //   - light  → warn (orange)
  //   - heavy  → red (>50h in window, or >2h on a single day)
  function negColor(h, opts) {
    opts = opts || {};
    const heavy = opts.heavyThreshold != null ? opts.heavyThreshold : 50;
    const light = opts.lightThreshold != null ? opts.lightThreshold : 0.001;
    if (h == null || isNaN(h) || h <= 0) return 'var(--tx3)';
    if (h > heavy) return '#ED6965';
    if (h > light) return 'var(--warn)';
    return 'var(--tx2)';
  }

  return { num, delta, negHours, renColor, spreadColor, negColor };
})();

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
          const hourly = (typeof upsampleHourly === 'function') ? upsampleHourly(vals) : vals;
          return { ...zone, today: Math.round(avg*10)/10, min: Math.round(minP*10)/10, minHr, max: Math.round(maxP*10)/10, maxHr, negHrs, hourly, vsYday: null, spark: null };
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
      renderPricesTable(pricesData, histDateISO);
      updateKPIs(pricesData, histDateISO);
    }

    // Backfill vsYday from J-1 daily file (J-1 delivery = histDateISO − 1, file = histDateISO − 2)
    if (typeof fetchHistoricalDaily === 'function' && histDateISO) {
      try {
        const [y,m,d] = histDateISO.split('-').map(Number);
        const j1Auc = new Date(Date.UTC(y, m-1, d));
        j1Auc.setUTCDate(j1Auc.getUTCDate() - 2);
        const yData = await fetchHistoricalDaily(j1Auc.toISOString().slice(0,10));
        if (yData && yData.zones) {
          let touched = false;
          pricesData.forEach(z => {
            if (z.vsYday != null) return;
            const y = yData.zones[z.code];
            if (y && y.avg != null && z.today != null) {
              z.vsYday = Math.round((z.today - y.avg) * 100) / 100;
              touched = true;
            }
          });
          if (touched) {
            renderPricesTable(pricesData, histDateISO);
            updateKPIs(pricesData, histDateISO);
          }
        }
      } catch (e) { console.warn('vsYday backfill (historical live) failed:', e); }
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
          const hourly = (typeof upsampleHourly === 'function') ? upsampleHourly(vals) : vals;
          return { ...zone, today: Math.round(avg * 10)/10, min: Math.round(minP*10)/10, minHr, max: Math.round(maxP*10)/10, maxHr, negHrs, hourly, vsYday: null, spark: null };
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
      renderPricesTable(pricesData, liveDateISO);
      updateKPIs(pricesData, liveDateISO);
    }

    // Backfill vsYday for live data: J-1 delivery = liveDateISO − 1, file = liveDateISO − 2
    if (typeof fetchHistoricalDaily === 'function' && liveDateISO) {
      try {
        const [y,m,d] = liveDateISO.split('-').map(Number);
        const j1Auc = new Date(Date.UTC(y, m-1, d));
        j1Auc.setUTCDate(j1Auc.getUTCDate() - 2);
        const yData = await fetchHistoricalDaily(j1Auc.toISOString().slice(0,10));
        if (yData && yData.zones) {
          let touched = false;
          pricesData.forEach(z => {
            if (z.vsYday != null) return;
            const y = yData.zones[z.code];
            if (y && y.avg != null && z.today != null) {
              z.vsYday = Math.round((z.today - y.avg) * 100) / 100;
              touched = true;
            }
          });
          if (touched) {
            renderPricesTable(pricesData, liveDateISO);
            updateKPIs(pricesData, liveDateISO);
          }
        }
      } catch (e) { console.warn('vsYday backfill (live) failed:', e); }
    }

    buildTicker(pricesData);
    dpRecordNegHours(pricesData);
    const now = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', hour:'2-digit', minute:'2-digit' });
    document.getElementById('prices-updated').textContent = `Updated ${now} CET`;

    // Backfill hourlyYday for the single-zone chart overlay (J-1 delivery = today-1, file = today-2)
    if (typeof fetchHistoricalDaily === 'function' && liveDateISO) {
      const [y,m,d] = liveDateISO.split('-').map(Number);
      const j1Auc = new Date(Date.UTC(y, m-1, d));
      j1Auc.setUTCDate(j1Auc.getUTCDate() - 2);
      const j1FileISO = j1Auc.toISOString().slice(0,10);
      fetchHistoricalDaily(j1FileISO).then(j1 => {
        if (!j1 || !j1.zones) return;
        let touched = false;
        pricesData.forEach(z => {
          if (j1.zones[z.code] && Array.isArray(j1.zones[z.code].hourly) && j1.zones[z.code].hourly.length) {
            z.hourlyYday = j1.zones[z.code].hourly;
            touched = true;
          }
        });
        if (touched && typeof rerenderOpenRowDetail === 'function') rerenderOpenRowDetail();
      });
    }

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
  if (typeof fetchHistoricalDaily !== 'function' && typeof fetchYesterdayDaily !== 'function') return;
  // Files are named by AUCTION date. Today's delivery file = auction (displayDate - 1).
  // So J-1's delivery file = auction (displayDate - 2). We pass that filename directly.
  let yData = null;
  if (displayDate && typeof fetchHistoricalDaily === 'function') {
    const [y,m,d] = displayDate.split('-').map(Number);
    const j1Auction = new Date(Date.UTC(y, m-1, d));
    j1Auction.setUTCDate(j1Auction.getUTCDate() - 2);
    const j1FileISO = j1Auction.toISOString().slice(0,10);
    yData = await fetchHistoricalDaily(j1FileISO);
  } else if (typeof fetchYesterdayDaily === 'function') {
    yData = await fetchYesterdayDaily(displayDate);
  }
  const yKpi  = yData ? computeKPIs(yData.zones) : null;

  const directionFromDelta = (delta) => {
    if (delta == null || isNaN(delta))      return { cls:'kpi-flat', txtColor:'var(--text3)' };
    if (Math.abs(delta) < 1)                 return { cls:'kpi-flat', txtColor:'var(--text3)' };
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
  // Show '--' when no J-1 data, '~ 0' when delta is < 0.5, full value otherwise
  const renderChg = (chgId, dir) => {
    const el = document.getElementById(chgId);
    if (!el) return;
    el.style.color = dir.txtColor;
    if (dir.delta == null || isNaN(dir.delta)) {
      el.textContent = '--';
    } else if (Math.abs(dir.delta) < 0.5) {
      el.textContent = `≈ 0 vs J-1`;
    } else {
      const arrow = dir.delta > 0 ? '▲' : '▼';
      const sign  = dir.delta > 0 ? '+' : '';
      el.textContent = `${arrow} ${sign}${dir.delta.toFixed(1)} vs J-1`;
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

  // Max — compare today's max-zone with the SAME zone's J-1 avg
  const maxYday = (yData && ctx.maxZ) ? (yData.zones[ctx.maxZ.code]?.avg ?? null) : null;
  const maxDir = setCard('kpicard-max', today.maxLvl, maxYday);
  if (maxDir) {
    renderChg('kpi-max-chg', maxDir);
    const zone = document.getElementById('kpi-max-zone');
    if (zone) zone.textContent = ctx.maxZ ? `${ctx.maxZ.flag} ${ctx.maxZ.name}` : '--';
  }

  // Min — compare today's min-zone with the SAME zone's J-1 avg
  const minYday = (yData && ctx.minZ) ? (yData.zones[ctx.minZ.code]?.avg ?? null) : null;
  const minDir = setCard('kpicard-min', today.minLvl, minYday);
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
  // Store globally so chart helpers (e.g. nowLineAnnotation) can determine
  // whether the current price data is for today or another day (DA settled or fwd).
  window._currentPriceDate = displayDate;
  const dateLabel = document.getElementById('prices-date-label');
  if (dateLabel) dateLabel.textContent = 'Day-Ahead prices · ' + fmtLong(displayDate) + ' · ENTSO-E';
  // Update the new section-header metas (page + board) with the current date
  const pageMeta = document.getElementById('pr-daily-page-meta');
  if (pageMeta) pageMeta.textContent = fmtLong(displayDate) + ' · ENTSO-E';
  const boardMeta = document.getElementById('pr-daily-board-meta');
  if (boardMeta) boardMeta.textContent = fmtLong(displayDate) + ' · ENTSO-E';
  // Remove loading row if still there
  const loadingRow = document.querySelector('#prices-tbody .loading-row');
  if (loadingRow) loadingRow.remove();

  const sorted = [...data].sort((a,b) => b.today - a.today);
  window._pricesSorted = sorted;
  window._pricesSortDir = window._pricesSortDir || {};
  // Default Compare Zones selection: shared global zones (default = GenMix data-driven)
  if (!window._userZones) {
    window._userZones = new Set(getGenMixDefaultZones());
  }
  // _compareZones always mirrors _userZones (global state)
  window._compareZones = window._userZones;
  // Default Daily prices table filter: same GenMix zones (data-driven, "With GenMix")
  if (window._pricesZoneFilter === undefined) {
    window._pricesZoneFilter = new Set(getGenMixDefaultZones());
  }
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
  const margin = 10;
  panel.style.top  = (r.bottom + 4) + 'px';
  // Constrain max-height to the available space below the button so the inner scroll works
  const availableBelow = window.innerHeight - r.bottom - margin - 4;
  panel.style.maxHeight = Math.max(200, availableBelow) + 'px';
  panel.style.overflowY = 'auto';
  // Prefer left-aligned; if off-screen, right-align
  const leftPos = r.left;
  const panelW  = 300;
  if (leftPos + panelW > window.innerWidth - margin) {
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
  if (!isOpen) {
    // Prefer header button if visible, fallback to original
    const hdrBtn = document.getElementById('zone-filter-btn-hdr');
    const anchorId = (hdrBtn && hdrBtn.offsetParent !== null) ? 'zone-filter-btn-hdr' : 'zone-filter-btn';
    positionPanel('zone-filter-panel', anchorId);
    buildZoneFilterDropdown();
  }
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
  window._pricesZoneFilter = new Set(getGenMixDefaultZones());
  applyZoneFilter();
}

function applyZoneFilter() {
  // Rebuild dropdown (visual state of checkboxes)
  buildZoneFilterDropdown();
  // Re-render table with new filter
  renderPricesTableBody();
  // Update button labels (both old position + new header position + sticky bar)
  const zones = (window._pricesSorted||[]).filter(z=>z.today!=null);
  const n = window._pricesZoneFilter ? window._pricesZoneFilter.size : zones.length;
  const text = window._pricesZoneFilter ? `${n} / ${zones.length} zones` : 'All zones';
  const lbl1 = document.getElementById('zone-filter-label');
  if (lbl1) lbl1.textContent = text;
  const lbl2 = document.getElementById('zone-filter-label-hdr');
  if (lbl2) lbl2.textContent = text;
  const lbl3 = document.getElementById('pk-gf-daily-zones-label');
  if (lbl3) lbl3.textContent = text;
}

function selectAllCompareZones() {
  if (!window._pricesSorted) return;
  window._compareZones = new Set(window._pricesSorted.map(z=>z.code));
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
}

document.addEventListener('click', e => {
  // Close zone filter panel if clicking outside both ANY zone-filter button and the panel.
  // Multiple buttons can open the same panel:
  //   - 'zone-filter-btn'       (legacy inline button)
  //   - 'zone-filter-btn-hdr'   (header button in Day-Ahead Daily)
  //   - 'pk-gf-daily-zones'     (global filter button)
  const zBtns = [
    document.getElementById('zone-filter-btn'),
    document.getElementById('zone-filter-btn-hdr'),
    document.getElementById('pk-gf-daily-zones'),
  ].filter(Boolean);
  const zPanel = document.getElementById('zone-filter-panel');
  if (zPanel && zPanel.style.display !== 'none') {
    const clickInButton = zBtns.some(b => b.contains(e.target));
    if (!clickInButton && !zPanel.contains(e.target)) {
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

  // Update button labels (both old position + new header position)
  const nOn = active ? active.size : zones.length;
  const text = active ? `${nOn} / ${zones.length} zones` : 'All zones';
  const lbl1 = document.getElementById('zone-filter-label');
  if (lbl1) lbl1.textContent = text;
  const lbl2 = document.getElementById('zone-filter-label-hdr');
  if (lbl2) lbl2.textContent = text;
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
    return `<span style="color:${PK_FMT.negColor(h, {lightThreshold:0, heavyThreshold:6})};font-weight:600">${PK_FMT.negHours(h)}</span>`;
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
    // Signed delta with triangle: ▲ +1.50 (red, price up) / ▼ -1.50 (green, price down)
    const vs = PK_FMT.delta(z.vsYday, {priceContext:true});
    // Spark spread: signed, but coloured by sign (positive=green, negative=red) — already aligned
    const sparkColor = z.spark == null ? 'var(--tx3)' : z.spark >= 0 ? '#14D3A9' : '#ED6965';
    const sparkSign  = z.spark == null ? '' : (z.spark >= 0 ? '+' : '-');
    const sparkText  = z.spark == null ? '–' : `${sparkSign}${PK_FMT.num(Math.abs(z.spark), 2)}`;

    // Peak / Off-Peak
    let peakStr = '–', offPeakStr = '–';
    if (z.hourly && z.hourly.length >= 24) {
      const h = z.hourly, nph = Math.round(h.length/24);
      const pkV=[], opV=[];
      h.forEach((v,idx)=>{ if(v==null)return; const hr=Math.floor(idx/nph); (hr>=8&&hr<20?pkV:opV).push(v); });
      if (pkV.length) peakStr = PK_FMT.num(pkV.reduce((a,b)=>a+b,0)/pkV.length, 2);
      if (opV.length) offPeakStr = PK_FMT.num(opV.reduce((a,b)=>a+b,0)/opV.length, 2);
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
      // Harmonised thresholds (T1 + T2): <35 red / 35-65 orange / >65 green
      renPctStr = `<span style="color:${PK_FMT.renColor(renP)};font-weight:600">${renP}%</span>`;
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

    // 2-level color hierarchy: AVG is the prime metric (white/priceColor, bold).
    // All other plain price cells use tx2 (single muted level).
    // Semantic-colored cells (VS J-1, NEG HRS, %REN, DOM FUEL, SPARK) keep their own colors.
    const html = `<tr class="zone-row" data-row-idx="${i}" style="cursor:pointer" onclick="togglePriceRow(${i}, event)" title="Click to expand 15-min chart">
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--tx2);text-align:left"><svg class="row-chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;opacity:0.45;vertical-align:0;transition:transform 0.15s ease"><polyline points="9 18 15 12 9 6"/></svg>${FLAG_MAP[z.code]||''} ${z.code}</td>
      <td style="font-size:11px;color:var(--tx2);text-align:left">${meta.country||z.name||z.code}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${priceColor};text-align:right">${PK_FMT.num(z.today, 2)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2);text-align:right" title="Avg over 08h–20h">${peakStr}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2);text-align:right" title="Avg over 00h–08h / 20h–24h">${offPeakStr}</td>
      <td style="color:${vs.color};font-family:'JetBrains Mono',monospace;text-align:right">${vs.text}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2);text-align:right">${z.min!=null?PK_FMT.num(z.min,2):'–'}<span style="color:var(--tx3);font-size:10px"> @${typeof z.minHr === 'string' ? z.minHr : (z.minHr!=null ? String(z.minHr).padStart(2,'0')+'h' : '')}</span></td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2);text-align:right">${z.max!=null?PK_FMT.num(z.max,2):'–'}<span style="color:var(--tx3);font-size:10px"> @${typeof z.maxHr === 'string' ? z.maxHr : (z.maxHr!=null ? String(z.maxHr).padStart(2,'0')+'h' : '')}</span></td>
      <td style="text-align:right">${negFmt(z.negHrs)}</td>
      <td style="text-align:right">${renPctStr}</td>
      <td style="text-align:left">${domFuelHtml}</td>
      <td style="color:${sparkColor};font-family:'JetBrains Mono',monospace;text-align:right">${sparkText}</td>
      <td class="sparkline-cell" style="text-align:center">${sparkSvg}</td>
    </tr>
    <tr id="row-detail-${i}" style="display:none">
      <td colspan="13" style="padding:0;background:#141a22;border-bottom:2px solid var(--bd2)">
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

// Re-render the currently expanded row detail (used when J-1/J-2 hourly data arrives async)
function rerenderOpenRowDetail() {
  if (_openRow == null) return;
  const z = (window._pricesSorted || [])[_openRow];
  if (!z) return;
  buildHourlyDetail(_openRow, z);
}
window.rerenderOpenRowDetail = rerenderOpenRowDetail;

let _rowCharts = {};

function togglePriceRow(idx, e) {
  const z = window._pricesSorted?.[idx];
  if (!z || z.today == null) return;

  // Helper: clear .is-open class
  const clearOpenClass = () => {
    document.querySelectorAll('tr.zone-row.is-open').forEach(tr => tr.classList.remove('is-open'));
  };

  if (_openRow !== null && _openRow !== idx) {
    const prevDetail = document.getElementById(`row-detail-${_openRow}`);
    if (prevDetail) prevDetail.style.display = 'none';
    if (_rowCharts[_openRow]) { _rowCharts[_openRow].destroy(); delete _rowCharts[_openRow]; }
    _openRow = null;
    clearOpenClass();
  }

  const detailRow = document.getElementById(`row-detail-${idx}`);
  if (!detailRow) return;
  const isOpen = detailRow.style.display !== 'none';

  if (isOpen) {
    detailRow.style.display = 'none';
    _openRow = null;
    if (_rowCharts[idx]) { _rowCharts[idx].destroy(); delete _rowCharts[idx]; }
    clearOpenClass();
    return;
  }

  detailRow.style.display = 'table-row';
  _openRow = idx;
  // Highlight the clicked row
  clearOpenClass();
  const clickedRow = document.querySelector(`tr.zone-row[data-row-idx="${idx}"]`);
  if (clickedRow) clickedRow.classList.add('is-open');

  setTimeout(() => detailRow.scrollIntoView({ behavior:'smooth', block:'nearest' }), 50);

  buildHourlyDetail(idx, z);
}

function buildHourlyDetail(idx, z) {
  const inner = document.getElementById(`row-detail-inner-${idx}`);
  if (!inner) return;

  // Debug: verify hourly data presence
  if (!z.hourly || !z.hourly.length) {
    console.warn('[buildHourlyDetail] No hourly data for zone', z.code, '— showing demo. _currentPriceDate=', window._currentPriceDate);
  }

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
    <div class="kpi-strip" style="grid-template-columns:repeat(5,1fr);margin-bottom:12px" id="row-kpis-${idx}">
      ${[
        {k:'avg',     l:'Avg',              v:avg.toFixed(2),                            meta:'24h average',     u:'€/MWh'},
        {k:'peak',    l:'Peak avg',         v:peakAvg!=null?peakAvg.toFixed(2):'--',     meta:'08h–20h',         u:'€/MWh'},
        {k:'offpeak', l:'Off-peak avg',     v:offPkAvg!=null?offPkAvg.toFixed(2):'--',   meta:'00h–08h / 20h–24h', u:'€/MWh'},
        {k:'min',     l:'Min slot',         v:minV.toFixed(2),                           meta:'@'+minSlotLabel,   u:'€/MWh'},
        {k:'max',     l:'Max slot',         v:maxV.toFixed(2),                           meta:'@'+maxSlotLabel,   u:'€/MWh'},
      ].map(k=>`<div class="kpi-card kpi-flat" id="row-kpi-${idx}-${k.k}">
        <div class="kpi-label">${k.l}</div>
        <div class="kpi-value">${k.v}<span class="kpi-unit">${k.u||''}</span></div>
        <div class="kpi-chg row-kpi-chg" data-kpi="${k.k}">--</div>
        <div class="kpi-meta">${k.meta}</div>
      </div>`).join('')}
    </div>
    <div style="font-size:11px;margin-bottom:4px">
      <span style="color:${flatColor};font-weight:600">${flatText}</span>
      ${peakRatio!=null ? `<span style="color:var(--tx3);margin-left:8px">Peak/off-peak ratio: ${peakRatio.toFixed(2)}x (baseline 1.30x)</span>` : ''}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:2px 0 6px;flex-wrap:wrap;gap:8px">
      <div style="font-size:11px;color:var(--tx2);font-weight:600;letter-spacing:.05em;text-transform:uppercase">
        ${FLAG_MAP[z.code]||''} ${z.code} — ${ccFmtDay(window._currentPriceDate)}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <!-- Band window selector · pills inline (Off / 7D / 1M / 3M / 6M / YTD / 1Y) -->
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Band</span>
          <div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px" id="row-band-pills-${idx}">
            ${_rowBandPillsHTML(idx)}
          </div>
        </div>
        <button onclick="event.stopPropagation();(function(){var c=_rowCharts[${idx}];if(c&&c.resetZoom)c.resetZoom();})()" title="Reset zoom to original view"
          style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--tx3);padding:4px 10px;font-size:10px;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">↺ Reset</button>
        <button onclick="event.stopPropagation();downloadRowChart(${idx})" title="Download chart as PNG" style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:4px 10px;font-size:10px;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">📸 PNG</button>
        <button onclick="event.stopPropagation();openRowFullscreen(${idx})" title="Open in fullscreen" style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:4px 10px;font-size:10px;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">⛶ Fullscreen</button>
      </div>
    </div>
    <!-- Market Read banner moved BELOW the chart for visual parity with Historical drill-down.
         Populated after innerHTML by _buildAnalystBanner('dailyDrill', …). -->
    <div style="position:relative;height:260px;margin-bottom:4px">
      <canvas id="row-chart-${idx}" style="width:100%;height:260px"></canvas>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:16px;font-size:10px;color:var(--tx3);margin-bottom:8px">
      <span>— ${ccFmtDay(window._currentPriceDate)}</span><span style="opacity:.5">- - - ${ccFmtDayShift(window._currentPriceDate, -1) || 'J-1'}</span>
      <span style="margin-left:8px">Shading: morning peak (07-09) | solar trough (11-14) | evening peak (17-21)</span>
    </div>
    <!-- Market Read banner anchor · populated post-innerHTML to keep 2-line layout parity with Historical -->
    <div id="row-analyst-banner-${idx}"></div>
    <!-- Band stats line · populated when the band selector is active -->
    <div id="row-band-stats-${idx}" style="display:none;margin-top:8px;padding:8px 12px;background:rgba(255,255,255,0.02);border-left:2px solid rgba(255,255,255,0.15);border-radius:0 4px 4px 0;font-size:11px;color:var(--tx2);font-family:'JetBrains Mono',monospace;line-height:1.6"></div>
    <details style="margin-top:4px">
      <summary style="font-size:11px;font-weight:600;color:var(--tx2);cursor:pointer;letter-spacing:.05em;text-transform:uppercase;user-select:none">
        Breakdown (${z.hourly && z.hourly.length===96 ? "96 × 15min slots" : h24.length+" hours"})
      </summary>
      <div style="margin-top:8px;max-height:260px;overflow-y:auto">
        <table style="width:100%;font-size:11px;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Slot</th>
            <th style="text-align:right;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Price €/MWh</th>
            <th style="text-align:right;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd);opacity:0.6">J-1 €/MWh</th>
            <th style="text-align:right;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Diff</th>
            <th class="bd-p50-h" style="text-align:right;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd);display:none">P50 <span style="opacity:.6;font-weight:400" id="bd-p50-header-${idx}"></span></th>
            <th class="bd-vsp50-h" style="text-align:right;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd);display:none">vs P50</th>
            <th style="text-align:center;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Period</th>
          </tr></thead>
          <tbody>${(() => {
            // Use 96-pt (15min) if available, else 24h
            const tblData = (z.hourly && z.hourly.length === 96) ? z.hourly : h24;
            // J-1 data : aligned on the same resolution as tblData
            const j1Raw = z.hourlyYday || null;
            let j1Data = null;
            if (j1Raw && j1Raw.length) {
              if (j1Raw.length === tblData.length) {
                j1Data = j1Raw;
              } else if (j1Raw.length === 96 && tblData.length === 24) {
                // Downsample J-1 from 15min to hourly
                j1Data = Array.from({length:24}, (_,h) => {
                  const s = j1Raw.slice(h*4, h*4+4).filter(v=>v!=null);
                  return s.length ? s.reduce((a,b)=>a+b,0)/s.length : null;
                });
              } else if (j1Raw.length === 24 && tblData.length === 96) {
                // Upsample J-1 from hourly to 15min (repeat each value 4x)
                j1Data = [];
                j1Raw.forEach(v => { for (let k=0;k<4;k++) j1Data.push(v); });
              }
            }
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

              // J-1 cell
              const vj1 = j1Data ? j1Data[i] : null;
              const j1Cell = vj1!=null ? vj1.toFixed(2) : '--';

              // Diff cell (J vs J-1)
              let diffCell = '--';
              let diffColor = 'var(--tx3)';
              if (v!=null && vj1!=null && vj1 !== 0) {
                const diffAbs = v - vj1;
                const diffPct = (diffAbs / Math.abs(vj1)) * 100;
                const sign = diffAbs >= 0 ? '+' : '';
                diffColor = diffAbs > 0 ? '#ED6965' : diffAbs < 0 ? '#14D3A9' : 'var(--tx3)';
                diffCell = `${sign}${diffAbs.toFixed(1)} (${sign}${diffPct.toFixed(1)}%)`;
              }

              return `<tr data-slot="${i}" data-row-idx="${idx}" onmouseenter="hoverSlotOnChart(${idx},${i})" onmouseleave="clearSlotHover(${idx})" style="border-bottom:1px solid rgba(255,255,255,.03);cursor:default;${isNow?'background:rgba(0,212,168,.06)':''}">
                <td style="padding:3px 8px;color:var(--tx3)">${isNow?'▶ ':''}<span style="font-family:'JetBrains Mono',monospace">${timeLabel}</span></td>
                <td style="padding:3px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:${priceColor};font-weight:${v!=null&&v<0?'700':'400'}">${v!=null?v.toFixed(2):'--'}</td>
                <td style="padding:3px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx2);opacity:0.55">${j1Cell}</td>
                <td style="padding:3px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:${diffColor};font-size:10px">${diffCell}</td>
                <td class="bd-p50-cell" data-bd-p50-row="${idx}-${i}" style="padding:3px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx2);display:none">--</td>
                <td class="bd-vsp50-cell" data-bd-vsp50-row="${idx}-${i}" style="padding:3px 8px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx3);display:none">--</td>
                <td style="padding:3px 8px;text-align:center">${period}</td>
              </tr>`;
            }).join('');
          })()}</tbody>
        </table>
      </div>
    </details>
  `;

  // ── Populate the Market Read banner (below the chart, 2-line layout, mirrors Historical drill-down) ──
  // Uses the shared _buildAnalystBanner('dailyDrill', …) defined in hist.js.
  // The band-stats sentence (P50 / vs median) is later injected by _loadAndApplyRowBand
  // into the #row-market-read-band-${idx} span that lives inside the verdict block.
  (function _renderDrillBanner() {
    const host = document.getElementById(`row-analyst-banner-${idx}`);
    if (!host || typeof window._buildAnalystBanner !== 'function') return;
    // J-1 average from z.hourlyYday if available
    const todayVal = (z.today != null) ? z.today : null;
    let j1Avg = null;
    if (z.hourlyYday && z.hourlyYday.length) {
      const valid = z.hourlyYday.filter(v => v != null);
      if (valid.length) j1Avg = valid.reduce((a,b)=>a+b,0)/valid.length;
    }
    const delta = (todayVal != null && j1Avg != null) ? todayVal - j1Avg : null;
    const deltaPct = (delta != null && j1Avg && j1Avg !== 0) ? (delta / Math.abs(j1Avg)) * 100 : null;
    const html = window._buildAnalystBanner('dailyDrill', {
      zone: z.code,
      dayLabel: ccFmtDay(window._currentPriceDate),
      today: todayVal,
      j1Avg, delta, deltaPct,
      peakAvg, offPkAvg, peakRatio,
      min: minV, max: maxV,
      minSlot: minSlotLabel, maxSlot: maxSlotLabel,
      negHours, negMins, negMin,
      negSlots: negSlotsRaw.length,
      bandIdSuffix: idx,
    });
    host.innerHTML = html || '';
  })();

  // Color — defined early so it can be used in KPI cards AND chart
  // Render chart — use full 15-min data (chartData, negFraction, col defined above)
  const canvas = document.getElementById(`row-chart-${idx}`);
  if (!canvas) return;
  if (_rowCharts[idx]) { _rowCharts[idx].destroy(); }

  const chartLabels = makeTimeLabels(chartData.length);
  const curSlot = (window.DP?.selectedDate && window.DP.selectedDate !== new Date().toISOString().slice(0,10))
    ? -1 : new Date().getHours() * (chartData.length / 24);

  const datasets = [{
    label: `${z.code} ${ccFmtDay(window._currentPriceDate)}`,
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
      label: ccFmtDayShift(window._currentPriceDate, -1) || 'J-1',
      data: z.hourlyYday,
      borderColor: 'rgba(255,255,255,0.35)',
      borderWidth: 1.3, borderDash:[5,4], pointRadius:0, tension:0.3, fill:false, spanGaps:true,
    });
  }

  // Annotations
  const annotations = {};
  // Zero line — same discreet style as in Compare zones
  if (typeof ccZeroLineAnnotation === 'function') {
    annotations.zeroLine = ccZeroLineAnnotation();
  }
  const _nowAnn = nowLineAnnotation({ slots: chartData.length, labels: chartLabels, chartDate: window._currentPriceDate });
  if (_nowAnn) annotations.nowLine = _nowAnn;
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
      onClick: (evt) => {
        if (evt && evt.native && evt.native.detail === 2) {
          const c = _rowCharts[idx];
          if (c && typeof c.resetZoom === 'function') c.resetZoom();
        }
      },
      plugins:{
        legend:{display: true, labels:{color:'#4A6280',font:{size:10},boxWidth:16,usePointStyle:true,pointStyle:'line',
          filter: (item, data) => {
            const lbl = data.datasets[item.datasetIndex]?.label || '';
            return !lbl.startsWith('__band_');
          }
        }},
        tooltip:{mode:'index',intersect:false,callbacks:{label:ctx=>` ${ctx.dataset.label}: ${ctx.parsed.y!=null?ctx.parsed.y.toFixed(2)+' €/MWh':'n/a'}`}},
        annotation:{annotations},
        zoom:ZOOM_CFG,
      },
      scales:{
        x:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#4A6280',font:{size:9},maxTicksLimit:12}},
        y:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#4A6280',font:{size:10}},
           title:{display:true,text:'€/MWh',color:'#4A6280',font:{size:10}},
           grace:'15%'},
      },
    },
  });

  // Async: colourise expand KPI cards (border + sub-text) vs J-1 for this zone
  applyExpandKPIColours(idx, z, {
    avg, peakAvg, offPkAvg, minV, maxV,
  });

  // Lazy-fetch J-1 hourly if missing (e.g. user clicked before backfill completed,
  // or J-1 file is dated differently from current view)
  if ((!z.hourlyYday || !z.hourlyYday.length) && typeof fetchHistoricalDaily === 'function') {
    const displayDate = window._currentPriceDate || new Date().toISOString().slice(0,10);
    const [yy,mm,dd] = displayDate.split('-').map(Number);
    const j1Auc = new Date(Date.UTC(yy, mm-1, dd));
    j1Auc.setUTCDate(j1Auc.getUTCDate() - 2);
    const j1FileISO = j1Auc.toISOString().slice(0,10);
    fetchHistoricalDaily(j1FileISO).then(j1 => {
      if (!j1 || !j1.zones || !j1.zones[z.code] || !Array.isArray(j1.zones[z.code].hourly) || !j1.zones[z.code].hourly.length) return;
      z.hourlyYday = j1.zones[z.code].hourly;
      // Rerender only if this row is still open
      if (_openRow === idx) buildHourlyDetail(idx, z);
    });
  }

  // Apply band overlay (async, non-blocking) — fetches percentiles for the current window
  _loadAndApplyRowBand(idx, z);
}

// ─── Row band overlay (P0/P5/P50/P95/P100) — drill-down only ───
// State: window._drillBandWindow[idx] = 'off' | '7D' | '1M' | '3M' | '6M' | 'YTD' | '1Y'
const _ROW_BAND_OPTIONS = [
  { key: 'off',  label: 'Off',  days: null },
  { key: '7D',   label: '7D',   days: 7 },
  { key: '1M',   label: '1M',   days: 30 },
  { key: '3M',   label: '3M',   days: 90 },
  { key: '6M',   label: '6M',   days: 180 },
  { key: 'YTD',  label: 'YTD',  days: -1 },
  { key: '1Y',   label: '1Y',   days: 365 },
];

function _rowBandPillsHTML(idx) {
  window._drillBandWindow = window._drillBandWindow || {};
  const cur = window._drillBandWindow[idx] || 'off';
  return _ROW_BAND_OPTIONS.map(opt => {
    const isOn = opt.key === cur;
    const isOff = opt.key === 'off';
    return `<button onclick="event.stopPropagation();setRowBandWindow(${idx},'${opt.key}')" data-win="${opt.key}"
      style="padding:3px 8px;font-size:10px;color:${isOn?'#14D3A9':(isOff?'#5A6B7E':'#7A93AB')};
             background:${isOn?'rgba(20,211,169,0.18)':'transparent'};
             border:none;border-radius:3px;font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.02em;cursor:pointer;transition:all .15s"
    >${opt.label}</button>`;
  }).join('');
}

function setRowBandWindow(idx, key) {
  window._drillBandWindow = window._drillBandWindow || {};
  window._drillBandWindow[idx] = key;
  const host = document.getElementById(`row-band-pills-${idx}`);
  if (host) host.innerHTML = _rowBandPillsHTML(idx);
  const chart = _rowCharts[idx];
  if (!chart) return;
  if (key === 'off') {
    _removeBandDatasets(chart);
    chart.update('none');
    _clearBreakdownBandStats(idx);
    _clearBreakdownTableP50(idx);
    return;
  }
  const z = window._pricesSorted ? window._pricesSorted[idx] : null;
  if (!z) return;
  _loadAndApplyRowBand(idx, z);
}
window.setRowBandWindow = setRowBandWindow;

function _removeBandDatasets(chart) {
  chart.data.datasets = chart.data.datasets.filter(ds => {
    const lbl = ds.label || '';
    return !lbl.startsWith('__band_')
        && !lbl.startsWith('Hist median')
        && !lbl.startsWith('Typical (P10–P90)')
        && !lbl.startsWith('Min–Max range');
  });
}

async function _loadAndApplyRowBand(idx, z) {
  window._drillBandWindow = window._drillBandWindow || {};
  const cur = window._drillBandWindow[idx] || 'off';
  const chart = _rowCharts[idx];
  if (!chart) return;
  if (cur === 'off') {
    _removeBandDatasets(chart);
    chart.update('none');
    _clearBreakdownBandStats(idx);
    _clearBreakdownTableP50(idx);
    return;
  }
  const opt = _ROW_BAND_OPTIONS.find(o => o.key === cur);
  if (!opt) return;
  const nPts = chart.data.datasets[0]?.data?.length || 96;
  if (typeof fetchHistoricalEnvelopeP !== 'function') return;
  let env;
  try {
    env = await fetchHistoricalEnvelopeP(z.code, opt.days, nPts);
  } catch (e) {
    console.warn('[row-band] fetch failed', e);
    return;
  }
  if (!env) return;
  if ((window._drillBandWindow[idx] || 'off') !== cur) return;
  _removeBandDatasets(chart);
  chart.data.datasets.push(
    {
      label: `Min–Max range (${opt.label})`, data: env.p100,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.04)',
      borderWidth: 0.8, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: '+1', order: 8,
    },
    {
      label: '__band_outer_min', data: env.p0,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'transparent',
      borderWidth: 0.8, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: false, order: 8,
    },
    {
      label: `Typical (P10–P90) (${opt.label})`, data: env.p90,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: '+1', order: 7,
    },
    {
      label: '__band_inner_min', data: env.p10,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'transparent',
      borderWidth: 1, pointRadius: 0, tension: 0.2, spanGaps: true,
      fill: false, order: 7,
    },
    {
      label: `Hist median (${opt.label})`, data: env.p50,
      borderColor: 'rgba(255,255,255,0.30)', borderWidth: 1, pointRadius: 0,
      tension: 0.2, spanGaps: true, fill: false, borderDash: [2, 3], order: 6,
    }
  );
  chart.update('none');
  // Update the breakdown stats line for this drill-down (median, today percentile, divergence)
  _updateBreakdownBandStats(idx, z, env, opt.label);
  // Update the breakdown table cells: show P50 + vs P50 columns per slot
  _updateBreakdownTableP50(idx, z, env, opt.label);
}
window._loadAndApplyRowBand = _loadAndApplyRowBand;

// Compute & inject the band stats line for a drill-down:
//   Period · Median · Today percentile · Today vs median · Max divergence
function _updateBreakdownBandStats(idx, z, env, periodLabel) {
  const host = document.getElementById(`row-band-stats-${idx}`);
  if (!host || !env) return;

  // Today's hourly (96 × 15min or 24h) — pick the array used by the chart
  const todayRaw = (z.hourly && z.hourly.length) ? z.hourly : (z.h24 || []);
  const nPts = env.p50.length;
  // Resample today to nPts (same logic as in fetchHistoricalEnvelopeP)
  const today = [];
  if (todayRaw.length === nPts) {
    today.push(...todayRaw);
  } else {
    const ratio = todayRaw.length / nPts;
    for (let i = 0; i < nPts; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.max(start + 1, Math.floor((i+1) * ratio));
      const slice = todayRaw.slice(start, end).filter(v => v != null);
      today.push(slice.length ? slice.reduce((a,b)=>a+b,0) / slice.length : null);
    }
  }

  // Median (single value = mean of P50 slots, weighted equally)
  const validMed = env.p50.filter(v => v != null);
  const medianAvg = validMed.length ? validMed.reduce((a,b)=>a+b,0) / validMed.length : null;

  // Today's avg
  const validToday = today.filter(v => v != null);
  const todayAvg = validToday.length ? validToday.reduce((a,b)=>a+b,0) / validToday.length : null;

  // Today percentile: rank today's avg within the distribution of all historical slot values
  // We use the union of all env.p0...p100 per-slot data, then count how many are below todayAvg.
  // Simpler & robust: compare each slot to its (p0..p100) — count fraction of slot ranks where today >= that slot's percentile range.
  // Even simpler: for the daily avg, rank against the daily P50 distribution.
  // Use a slot-by-slot percentile approach: for each slot, compute today's percentile in [p0, p50, p100] (linear interpolation).
  // Then aggregate as mean percentile across slots.
  const slotPercentiles = [];
  for (let i = 0; i < nPts; i++) {
    const t = today[i], p0 = env.p0[i], p10 = env.p10[i], p50 = env.p50[i], p90 = env.p90[i], p100 = env.p100[i];
    if (t == null || p0 == null || p100 == null) continue;
    // Piecewise linear interpolation: P0 → P10 → P50 → P90 → P100
    let pct;
    if (t <= p0) pct = 0;
    else if (t >= p100) pct = 100;
    else if (t <= p10) pct = 10 * (t - p0) / Math.max(p10 - p0, 0.01);
    else if (t <= p50) pct = 10 + 40 * (t - p10) / Math.max(p50 - p10, 0.01);
    else if (t <= p90) pct = 50 + 40 * (t - p50) / Math.max(p90 - p50, 0.01);
    else               pct = 90 + 10 * (t - p90) / Math.max(p100 - p90, 0.01);
    slotPercentiles.push(pct);
  }
  const todayPercentile = slotPercentiles.length
    ? slotPercentiles.reduce((a,b)=>a+b,0) / slotPercentiles.length
    : null;

  // Today vs median (€/MWh)
  const todayVsMedian = (todayAvg != null && medianAvg != null) ? (todayAvg - medianAvg) : null;

  // Max divergence: largest signed gap (today - p50) across slots, with slot label
  let maxDiv = null, maxDivSlot = null;
  for (let i = 0; i < nPts; i++) {
    if (today[i] == null || env.p50[i] == null) continue;
    const diff = today[i] - env.p50[i];
    if (maxDiv == null || Math.abs(diff) > Math.abs(maxDiv)) {
      maxDiv = diff;
      maxDivSlot = i;
    }
  }
  const slotToHour = (i) => {
    // If 96 slots, each = 15min; if 24, each = 1h
    if (nPts === 96) {
      const h = Math.floor(i / 4), m = (i % 4) * 15;
      return `${String(h).padStart(2,'0')}h${m === 0 ? '' : String(m).padStart(2,'0')}`;
    }
    return `${String(i).padStart(2,'0')}h`;
  };

  // Color helpers
  const pctCol = todayPercentile == null ? 'var(--tx3)' : (todayPercentile > 80 ? '#ED6965' : todayPercentile < 20 ? '#14D3A9' : 'var(--tx)');
  const vsMedCol = todayVsMedian == null ? 'var(--tx3)' : (todayVsMedian > 0 ? '#ED6965' : '#14D3A9');
  const divCol = maxDiv == null ? 'var(--tx3)' : (maxDiv > 0 ? '#ED6965' : '#14D3A9');
  const sign = v => v >= 0 ? '+' : '';

  host.innerHTML = `
    <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-right:8px">Today vs ${periodLabel} band</span>
    <span style="color:var(--tx3)">Median </span><span style="color:var(--tx)">${medianAvg != null ? medianAvg.toFixed(2) : '--'}</span>
    <span style="color:var(--tx3)"> · Percentile </span><span style="color:${pctCol};font-weight:600">${todayPercentile != null ? 'P'+todayPercentile.toFixed(0) : '--'}</span>
    <span style="color:var(--tx3)"> · Today vs median </span><span style="color:${vsMedCol};font-weight:600">${todayVsMedian != null ? sign(todayVsMedian)+todayVsMedian.toFixed(2) : '--'}</span>
    <span style="color:var(--tx3)"> · Max divergence </span><span style="color:${divCol};font-weight:600">${maxDiv != null ? sign(maxDiv)+maxDiv.toFixed(2) : '--'}</span>${maxDivSlot != null ? ` <span style="color:var(--tx3);font-size:9px">@${slotToHour(maxDivSlot)}</span>` : ''}
  `;
  host.style.display = 'block';

  // Extend Market Read banner with a "vs band" sentence
  const banderSpan = document.getElementById(`row-market-read-band-${idx}`);
  if (banderSpan) {
    if (todayPercentile != null && todayVsMedian != null) {
      let qualifier;
      if (todayPercentile >= 80) qualifier = `<span style="color:#ED6965;font-weight:600">expensive</span>`;
      else if (todayPercentile <= 20) qualifier = `<span style="color:#14D3A9;font-weight:600">cheap</span>`;
      else qualifier = `<span style="color:var(--tx)">in line</span>`;
      banderSpan.innerHTML = ` Day sits at <span style="color:${pctCol};font-weight:600">P${todayPercentile.toFixed(0)}</span> vs ${periodLabel} history — ${qualifier} with <span style="color:${vsMedCol};font-weight:600">${sign(todayVsMedian)}${todayVsMedian.toFixed(2)} €/MWh</span> vs ${periodLabel} median.`;
    } else {
      banderSpan.innerHTML = '';
    }
  }
}

function _clearBreakdownBandStats(idx) {
  const host = document.getElementById(`row-band-stats-${idx}`);
  if (host) {
    host.innerHTML = '';
    host.style.display = 'none';
  }
  // Also clear the "vs band" sentence in the Market Read banner
  const banderSpan = document.getElementById(`row-market-read-band-${idx}`);
  if (banderSpan) banderSpan.innerHTML = '';
}

// Show / update the P50 + vs P50 columns in the breakdown table for a given row idx.
// env = { p0, p10, p50, p90, p100 } (from fetchHistoricalEnvelopeP).
// periodLabel = '7D' | '1M' etc. (shown in the header).
function _updateBreakdownTableP50(idx, z, env, periodLabel) {
  if (!env || !env.p50) return;
  // Show the columns (headers + cells) — they are display:none by default
  document.querySelectorAll(`th.bd-p50-h, th.bd-vsp50-h`).forEach(el => el.style.display = '');
  document.querySelectorAll(`td.bd-p50-cell, td.bd-vsp50-cell`).forEach(el => el.style.display = '');
  // Update header label with current period
  const hdr = document.getElementById(`bd-p50-header-${idx}`);
  if (hdr) hdr.textContent = `(${periodLabel})`;

  // Resample today to env's nPts (same as chart datasets)
  const nPts = env.p50.length;
  const todayRaw = (z.hourly && z.hourly.length) ? z.hourly : (z.h24 || []);
  let today = [];
  if (todayRaw.length === nPts) today = todayRaw;
  else {
    const ratio = todayRaw.length / nPts;
    for (let i = 0; i < nPts; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.max(start + 1, Math.floor((i+1) * ratio));
      const slice = todayRaw.slice(start, end).filter(v => v != null);
      today.push(slice.length ? slice.reduce((a,b)=>a+b,0) / slice.length : null);
    }
  }

  // Resolve table data length (may be 96 if 15min, or 24 if hourly). Cells in DOM are based on tblData.
  // We assume tblData.length === env.p50.length (both 96 by default). If not, resample.
  const cells = document.querySelectorAll(`td[data-bd-p50-row^="${idx}-"]`);
  cells.forEach(cell => {
    const slotIdx = parseInt(cell.dataset.bdP50Row.split('-')[1], 10);
    if (isNaN(slotIdx) || slotIdx >= env.p50.length) return;
    const p50 = env.p50[slotIdx];
    cell.textContent = p50 != null ? p50.toFixed(2) : '--';
    cell.style.color = 'var(--tx2)';
  });
  document.querySelectorAll(`td[data-bd-vsp50-row^="${idx}-"]`).forEach(cell => {
    const slotIdx = parseInt(cell.dataset.bdVsp50Row.split('-')[1], 10);
    if (isNaN(slotIdx) || slotIdx >= env.p50.length) return;
    const p50 = env.p50[slotIdx];
    const t = today[slotIdx];
    if (p50 == null || t == null) { cell.textContent = '--'; cell.style.color = 'var(--tx3)'; return; }
    const diff = t - p50;
    const sign = diff >= 0 ? '+' : '';
    cell.textContent = `${sign}${diff.toFixed(2)}`;
    cell.style.color = diff > 5 ? '#ED6965' : diff < -5 ? '#14D3A9' : 'var(--tx2)';
  });
}

function _clearBreakdownTableP50(idx) {
  // Hide the columns (cells in breakdown for this idx)
  document.querySelectorAll(`th.bd-p50-h, th.bd-vsp50-h`).forEach(el => el.style.display = 'none');
  document.querySelectorAll(`td.bd-p50-cell, td.bd-vsp50-cell`).forEach(el => el.style.display = 'none');
}

// Compute today's KPI values for a zone, fetch J-1 from history, and apply
// matching border-left colour + sub-text tint based on direction (±1 €/MWh)
async function applyExpandKPIColours(idx, z, today) {
  const displayDate = window._currentPriceDate || window.DP?.selectedDate || new Date().toISOString().slice(0,10);
  if (typeof fetchHistoricalDaily !== 'function') return;
  // Files are named by AUCTION date. J-1 delivery file = displayDate − 2 (auction).
  const [yy,mm,dd] = displayDate.split('-').map(Number);
  const j1Auc = new Date(Date.UTC(yy, mm-1, dd));
  j1Auc.setUTCDate(j1Auc.getUTCDate() - 2);
  const j1FileISO = j1Auc.toISOString().slice(0,10);
  const yData = await fetchHistoricalDaily(j1FileISO);
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
    const chg = card.querySelector('.row-kpi-chg');
    card.classList.remove('kpi-up','kpi-down','kpi-flat');
    if (todayVal == null || yVal == null) {
      card.classList.add('kpi-flat');
      if (chg) { chg.style.color = 'var(--text3)'; chg.textContent = '--'; }
      return;
    }
    const delta = todayVal - yVal;
    let cls = 'kpi-flat', subColor = 'var(--text3)';
    if (Math.abs(delta) >= 1) {
      if (delta > 0) { cls = 'kpi-down'; subColor = 'var(--down)'; }
      else           { cls = 'kpi-up';   subColor = 'var(--up)'; }
    }
    card.classList.add(cls);
    if (chg) {
      chg.style.color = subColor;
      if (Math.abs(delta) < 0.5) {
        chg.textContent = '≈ 0 vs J-1';
      } else {
        const arrow = delta > 0 ? '▲' : '▼';
        const sign  = delta > 0 ? '+' : '';
        chg.textContent = `${arrow} ${sign}${delta.toFixed(1)} vs J-1`;
      }
    }
  };

  apply('avg',     today.avg,     yAvg);
  apply('peak',    today.peakAvg, yPeakAvg);
  apply('offpeak', today.offPkAvg, yOffAvg);
  apply('min',     today.minV,    yMin);
  apply('max',     today.maxV,    yMax);
}


// Compare-mode pool: use SERIES_POOL from globals.js (8 hand-picked + farthest-point fallback)
const COMPARE_COLORS = SERIES_POOL;

// Build a colour map for a list of zones. Priority:
//  1. ZONE_COLORS[code] if defined (FR=Mint Leaf, etc — fixed identity)
//  2. else: pick from SERIES_POOL by index, skipping colours already used
function buildZoneColorMap(zones) {
  const map = {};
  const used = new Set();
  // Pass 1: assign fixed colours from ZONE_COLORS
  zones.forEach(z => {
    const fixed = (typeof ZONE_COLORS !== 'undefined') ? ZONE_COLORS[z.code] : null;
    if (fixed) { map[z.code] = fixed; used.add(fixed.toUpperCase()); }
  });
  // Pass 2: assign generated colours, skipping ones already used by Pass 1
  let poolIdx = 0;
  zones.forEach(z => {
    if (map[z.code]) return;
    let c, guard = 0;
    do {
      c = getSeriesColor(poolIdx++);
      guard++;
    } while (used.has(c.toUpperCase()) && guard < 100);
    map[z.code] = c;
    used.add(c.toUpperCase());
  });
  return map;
}

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
  window._userZones = window._compareZones;
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
  document.dispatchEvent(new CustomEvent('zones-changed'));
}

function compareNeighbours() {
  window._compareZones = new Set(['FR','DE_LU','BE','NL','ES','IT_NORD','CH','AT','PT']);
  window._userZones = window._compareZones;
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
  document.dispatchEvent(new CustomEvent('zones-changed'));
}

function compareWithGenMix() {
  window._compareZones = new Set(getGenMixDefaultZones());
  window._userZones = window._compareZones;
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
  document.dispatchEvent(new CustomEvent('zones-changed'));
}

function buildCompareChips() {
  const container = document.getElementById('compare-zone-chips');
  if (!container || !window._pricesSorted) return;
  const selected = window._compareZones || new Set(['FR']);
  if (!window._zoneColorMap) {
    window._zoneColorMap = buildZoneColorMap(window._pricesSorted);
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

  // Sync global state
  window._userZones = window._compareZones;
  window._zoneColorMap = null;
  buildCompareChips();
  renderCompareChart();
  document.dispatchEvent(new CustomEvent('zones-changed'));
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
  // Show/hide bands zone selector
  const bandsWrap = document.getElementById('cc-bands-wrap');
  if (bandsWrap) bandsWrap.style.display = view === 'bands' ? 'flex' : 'none';
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

function populateSpreadRefSelect(data, selected) {
  const host = document.getElementById('cc-ref-chips');
  if (!host || !data) return;
  // Only zones currently in the compare selection
  const sel = selected || window._compareZones || new Set(['FR']);
  const zones = data.filter(z => sel.has(z.code));
  // Resolve current ref: explicit pick if still in selection, else FR if present, else first selected
  let cur = window._ccSpreadRef;
  if (!cur || !sel.has(cur)) {
    cur = sel.has('FR') ? 'FR' : (zones[0]?.code || 'FR');
    window._ccSpreadRef = cur;
  }
  host.innerHTML = zones.map(z => {
    const isOn = z.code === cur;
    const col  = (window._zoneColorMap && window._zoneColorMap[z.code]) || '#4A6280';
    return `<button onclick="setSpreadRef('${z.code}')" style="
      padding:3px 9px;border-radius:4px;font-size:10px;cursor:pointer;border:1px solid ${isOn?col:'rgba(255,255,255,.12)'};
      background:${isOn?col+'22':'transparent'};color:${isOn?col:'rgba(255,255,255,.55)'};
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.03em;transition:all .15s;
    ">${z.code}</button>`;
  }).join('');
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
    window._zoneColorMap = buildZoneColorMap(data);
  }
  return window._zoneColorMap[code] || getSeriesColor(idx);
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

// Zero-line annotation: red marker for the 0 €/MWh threshold (negative price boundary)
function ccZeroLineAnnotation() {
  return {
    type: 'line',
    yMin: 0,
    yMax: 0,
    borderColor: 'rgba(237,105,101,.45)',
    borderWidth: 1,
    borderDash: [4, 4],
    label: { display: false }
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

  // Update the date label next to the section title — long format to mirror DA Board meta
  const dateLbl = document.getElementById('compare-zones-date');
  if (dateLbl) {
    const iso = window._currentPriceDate;
    if (iso) {
      const [y, m, d] = iso.split('-').map(Number);
      dateLbl.textContent = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    } else {
      dateLbl.textContent = ccFmtDay(iso);
    }
  }

  populateSpreadRefSelect(data, selected);

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
// Date helpers — produce 'Wed 06 May' style labels for Today / J-1 / J-2
// ────────────────────────────────────────────
function ccFmtDay(dateISO) {
  if (!dateISO) return 'Today';
  try {
    const [y, m, d] = dateISO.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch (e) { return dateISO; }
}
function ccFmtDayShift(dateISO, deltaDays) {
  if (!dateISO) return null;
  try {
    const [y, m, d] = dateISO.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + deltaDays);
    return dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch (e) { return null; }
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
    const col = ccZoneColor(z.code, data, i);
    const hourly = z.hourly && z.hourly.length ? z.hourly : generateDemoHourly(z.today, z.min, z.max);
    datasets.push({
      label: `${z.code} · ${z.name}`, data: hourly, borderColor: col, borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col,
      pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
      fill: false,
      tension: 0.3,
      spanGaps: true,
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
          label: c => { const v = c.raw; if (v == null) return null; return ` ${c.dataset.label}: ${v.toFixed(1)} €/MWh`; }
        }},
        zoom: ZOOM_CFG,
        annotation: { annotations: (() => { const ann = { zeroLine: ccZeroLineAnnotation() }; const a = nowLineAnnotation({ slots: nPts, labels: hours, chartDate: window._currentPriceDate, mode: 'compare' }); if (a) ann.nowLine = a; return ann; })() }
      },
      scales: {
        x: { grid: GRID, ticks:{ color:C_TX3, font:{size:9}, maxTicksLimit:12 }},
        y: { grid: GRID, ticks:{ color:C_TX3, callback:v=>v.toFixed(0) }, title:{ display:true, text:'€/MWh', color:C_TX3, font:{size:9} }, grace: '12%' }
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

  // Global colour scale — originator perspective: high price = green (good), low price = red (bad), negative = deep red
  let mn = Infinity, mx = -Infinity;
  grid.forEach(r => r.hourly.forEach(v => { if (v != null) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }));
  const colorFor = (v) => {
    if (v == null) return 'var(--bg)';
    if (v < 0)    return '#5b1a2a';
    const t = Math.max(0, Math.min(1, (v - Math.max(0,mn)) / (mx - Math.max(0,mn) || 1)));
    if (t < .15) return '#a82a3a';
    if (t < .35) return '#c25526';
    if (t < .55) return '#a37a1a';
    if (t < .70) return '#2a7a3a';
    if (t < .85) return '#155f4a';
    return '#0f4434';
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
      <div style="flex:1;background:#a82a3a"></div>
      <div style="flex:1;background:#c25526"></div>
      <div style="flex:1;background:#a37a1a"></div>
      <div style="flex:1;background:#2a7a3a"></div>
      <div style="flex:1;background:#155f4a"></div>
      <div style="flex:1;background:#0f4434"></div>
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
        annotation: { annotations: (() => {
          const ann = {
            baseline: { type:'line', yMin:100, yMax:100, borderColor:'rgba(148,163,184,.4)', borderWidth:1, borderDash:[3,3],
              label:{ display:true, content:'avg = 100%', position:'end', color:'rgba(148,163,184,.7)', font:{size:9}, backgroundColor:'transparent', padding:2 }
            }
          };
          const a = nowLineAnnotation({ slots: nPts, labels: hours, chartDate: window._currentPriceDate, mode: 'compare' });
          if (a) ann.nowLine = a;
          return ann;
        })() }
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
function setBandsZone(code) {
  window._ccBandsZone = code;
  renderCompareChart();
}
window.setBandsZone = setBandsZone;

function populateBandsZoneSelect(zones, current) {
  const host = document.getElementById('cc-bands-chips');
  if (!host) return;
  host.innerHTML = zones.map(z => {
    const isOn = z.code === current;
    const col  = (window._zoneColorMap && window._zoneColorMap[z.code]) || '#4A6280';
    return `<button onclick="setBandsZone('${z.code}')" style="
      padding:3px 9px;border-radius:4px;font-size:10px;cursor:pointer;border:1px solid ${isOn?col:'rgba(255,255,255,.12)'};
      background:${isOn?col+'22':'transparent'};color:${isOn?col:'rgba(255,255,255,.55)'};
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.03em;transition:all .15s;
    ">${z.code}</button>`;
  }).join('');
}

async function renderCCBands(data, selected) {
  const zones = ccGetSelectedZones(data, selected);
  // Default: first selected zone, persisted across renders
  if (!window._ccBandsZone || !zones.find(x => x.code === window._ccBandsZone)) {
    window._ccBandsZone = (zones[0] || data[0])?.code;
  }
  const z = data.find(x => x.code === window._ccBandsZone) || zones[0] || data[0];
  if (!z) return;
  const col = ccZoneColor(z.code, data, data.indexOf(z));
  populateBandsZoneSelect(zones, z.code);

  const nPts = z.hourly && z.hourly.length ? z.hourly.length : 24;
  const hours = makeTimeLabels(nPts);
  const today = z.hourly || [];

  // Preload envelopes for ALL selected zones in parallel (so the table below can use them).
  // The chart itself only needs the active zone's envelope, but the table reads all of them.
  const otherZones = zones.filter(zz => zz.code !== z.code);
  Promise.all(otherZones.map(zz => fetchHistoricalEnvelope(zz.code, 30, nPts))).then(() => {
    // Re-render the table once all envelopes are cached, but only if we're still on Bands
    if ((window._ccView || 'lines') === 'bands') {
      renderCompareKPIs(window._pricesSorted, window._compareZones || new Set(['FR']));
    }
  });

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
        annotation: { annotations: (() => { const ann = { zeroLine: ccZeroLineAnnotation() }; const a = nowLineAnnotation({ slots: nPts, labels: hours, chartDate: window._currentPriceDate, mode: 'compare' }); if (a) ann.nowLine = a; return ann; })() }
      },
      scales: {
        x: { grid: GRID, ticks:{ color:C_TX3, font:{size:9}, maxTicksLimit:12 }},
        y: { grid: GRID, ticks:{ color:C_TX3, callback:v=>v.toFixed(0) }, title:{ display:true, text:'€/MWh', color:C_TX3, font:{size:9} }, grace: '12%' }
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
        annotation: { annotations: (() => {
          const ann = {
            baseline: { type:'line', yMin:0, yMax:0, borderColor:'rgba(148,163,184,.7)', borderWidth:1.5,
              label:{ display:true, content:`baseline · ${refCode}`, position:'end', color:'rgba(148,163,184,1)', font:{size:10,weight:'600'}, backgroundColor:'rgba(0,0,0,.4)', padding:4 }
            }
          };
          const a = nowLineAnnotation({ slots: nPts, labels: hours, chartDate: window._currentPriceDate, mode: 'compare' });
          if (a) ann.nowLine = a;
          return ann;
        })() }
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
  // host may be missing now that we replaced it by the amber banner; only the anchor matters
  const zones = ccGetSelectedZones(data, selected);
  if (!zones.length) {
    if (host) host.style.display = 'none';
    const anchor = document.getElementById('cc-analyst-banner-anchor');
    if (anchor) anchor.innerHTML = '';
    return;
  }

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
    const dateLabel = (window._currentPriceDate && window._currentPriceDate !== new Date().toISOString().slice(0,10)) ? 'On this day' : "Today";

    if (stats.length === 1) {
      // Single zone: report intra-day shape, not cross-zone comparison
      const s = stats[0];
      const range = s.mx - s.mn;
      lines.push(`<b>${s.code}</b> ${dateLabel.toLowerCase()}: avg <b>${s.avg.toFixed(1)} €/MWh</b> · range ${s.mn.toFixed(1)} → ${s.mx.toFixed(1)} (${range.toFixed(1)} € swing).`);
    } else {
      const mostExpensive = [...stats].sort((a,b) => b.avg - a.avg)[0];
      const cheapest = [...stats].sort((a,b) => a.avg - b.avg)[0];
      lines.push(`${dateLabel}'s range across selected zones: ${cheapest.code} cheapest at <b>${cheapest.avg.toFixed(1)} €/MWh</b> avg, ${mostExpensive.code} most expensive at <b>${mostExpensive.avg.toFixed(1)} €/MWh</b> (gap: ${(mostExpensive.avg-cheapest.avg).toFixed(1)} €).`);
    }
    if (inverted > 0) {
      if (stats.length === 1) {
        lines.push(`<b>${stats[0].code}</b> shows inverted P/OP spread (off-peak more expensive than peak — duck curve from solar generation).`);
      } else {
        lines.push(`<b>${inverted} of ${stats.length}</b> zones show inverted P/OP spread today (off-peak more expensive than peak — duck curve from solar generation).`);
      }
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

  // ── Build the unified amber analyst banner (cc-analyst-banner-anchor) ──
  // Uses _buildAnalystBanner (defined in hist.js, exposed on window) — same style
  // as Historical chart banners. cc-analysis (legacy gray banner) is left hidden.
  const anchor = document.getElementById('cc-analyst-banner-anchor');
  if (anchor && typeof window._buildAnalystBanner === 'function' && stats.length) {
    const sortedByAvg = [...stats].sort((a, b) => a.avg - b.avg);
    const cheap  = { z: sortedByAvg[0].code, avg: sortedByAvg[0].avg };
    const pricey = { z: sortedByAvg[sortedByAvg.length - 1].code, avg: sortedByAvg[sortedByAvg.length - 1].avg };
    const loadedAvg = stats.reduce((s, x) => s + x.avg, 0) / stats.length;
    const frStats = stats.find(s => s.code === 'FR');
    const frGap = frStats ? (frStats.avg - cheap.avg) : null;
    const modeMap = { lines: 'ccLines', profile: 'ccProfile', bands: 'ccBands', spread: 'ccSpread', heatmap: 'ccHeatmap' };
    const html = window._buildAnalystBanner(modeMap[view] || 'ccLines', {
      cheap, pricey, frGap, loadedAvg, zoneCount: stats.length, view,
    });
    anchor.innerHTML = html;
  } else if (anchor) {
    anchor.innerHTML = '';
  }

  // Legacy cc-analysis: hide (we now use the amber banner above)
  if (host) host.style.display = 'none';
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

// ────────────────────────────────────────────
// Compare zones — table that adapts to the current view
// ────────────────────────────────────────────
// ── Daily Compare zones · KPI strip (5 cards: Zones+avg, Cheapest, Most exp, Spread, FR vs cheapest) ──
// Sémantique : today's daily averages across selected zones.
// Cohérent avec le strip Historical Compare zones — pas de redondance avec le strip Daily du haut.
function renderCompareKpiStrip(data, selected) {
  // `data` is an array of zone objects: [{code, today, hourly, ...}, ...]
  // We use the daily averages (z.today) from the selected zones.
  if (!Array.isArray(data) || !data.length) return;

  // Build [{ z, avg }] for selected zones with data today
  const validStats = [];
  data.forEach(z => {
    if (!selected.has(z.code)) return;
    if (z.today != null && !isNaN(z.today)) {
      validStats.push({ z: z.code, avg: z.today });
    }
  });

  // KPI 1 · Zones loaded (value = count, meta = loaded avg)
  const zonesVEl = document.getElementById('cc-kpi-zones-v');
  const zonesMetaEl = document.getElementById('cc-kpi-zones-meta');
  if (zonesVEl) zonesVEl.innerHTML = selected.size + '<span class="kpi-unit">zones</span>';
  if (zonesMetaEl) {
    if (validStats.length) {
      const loadedAvg = validStats.reduce((s, x) => s + x.avg, 0) / validStats.length;
      zonesMetaEl.innerHTML = `avg <strong style="color:var(--tx)">${loadedAvg.toFixed(2)} €/MWh</strong> · today`;
    } else {
      zonesMetaEl.textContent = 'no data today';
    }
  }

  if (!validStats.length) return;

  // KPI 2-3-4 · Cheapest / Most exp / Spread
  validStats.sort((a, b) => a.avg - b.avg);
  const cheap = validStats[0], pricey = validStats[validStats.length - 1];
  const setHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const setText = (id, txt)  => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setHTML('cc-kpi-cheapest-v', cheap.avg.toFixed(2) + '<span class="kpi-unit">€/MWh</span>');
  setText('cc-kpi-cheapest-meta', cheap.z);
  setHTML('cc-kpi-priciest-v', pricey.avg.toFixed(2) + '<span class="kpi-unit">€/MWh</span>');
  setText('cc-kpi-priciest-meta', pricey.z);
  setHTML('cc-kpi-spread-v', (pricey.avg - cheap.avg).toFixed(2) + '<span class="kpi-unit">€/MWh</span>');

  // KPI 5 · FR vs cheapest
  // Convention couleur: monter = rouge (FR plus cher que cheapest = défavorable),
  //                    vert si FR est le moins cher (rare/win),
  //                    flat si FR pas chargée.
  const frEntry = validStats.find(x => x.z === 'FR');
  const frgapCard = document.getElementById('cc-kpi-frgap');
  if (frgapCard) frgapCard.classList.remove('kpi-up', 'kpi-down', 'kpi-flat');
  if (frEntry && cheap) {
    const gap = frEntry.avg - cheap.avg;
    const pct = cheap.avg > 0 ? (gap / cheap.avg) * 100 : 0;
    setHTML('cc-kpi-frgap-v',
      (gap >= 0 ? '+' : '') + gap.toFixed(2) + '<span class="kpi-unit">€/MWh</span>');
    setText('cc-kpi-frgap-meta',
      (pct >= 0 ? '+' : '') + pct.toFixed(1) + '% · ' + cheap.z + ' cheapest');
    if (frgapCard) {
      if (frEntry.z === cheap.z) frgapCard.classList.add('kpi-up');
      else if (gap > 0)         frgapCard.classList.add('kpi-down');
      else                       frgapCard.classList.add('kpi-up');
    }
  } else {
    setHTML('cc-kpi-frgap-v', '--<span class="kpi-unit">€/MWh</span>');
    setText('cc-kpi-frgap-meta', 'FR not loaded');
    if (frgapCard) frgapCard.classList.add('kpi-flat');
  }
}

function renderCompareKPIs(data, selected) {
  // Populate the 5-card KPI strip above the chart
  renderCompareKpiStrip(data, selected);

  const tbody = document.getElementById('compare-data-tbody');
  const table = document.getElementById('compare-data-table');
  if (!tbody || !data) return;
  const view = window._ccView || 'lines';

  // Build the right header for the view, then dispatch to the right body builder
  const thead = table ? table.querySelector('thead') : null;
  if (thead) thead.innerHTML = ccTableHeader(view);

  const rows = ccComputeRows(data, selected, view);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--tx3);text-align:center;padding:14px">No zones selected</td></tr>`;
    return;
  }

  let html = '';
  switch (view) {
    case 'heatmap': html = ccBodyHeatmap(rows); break;
    case 'profile': html = ccBodyProfile(rows); break;
    case 'bands':   html = ccBodyBands(rows);   break;
    case 'spread':  html = ccBodySpread(rows);  break;
    case 'lines':
    default:        html = ccBodyLines(rows);
  }
  tbody.innerHTML = html;

  // Wire cross-highlight (B): hover row → highlight curve, click → toggle focus
  ccWireRowHighlight();
}

// ── Header per view
function ccTableHeader(view) {
  const cols = {
    lines: [
      { w:'18%', label:'Zone', tip:'' },
      { w:'9%',  label:'Avg', sub:'€/MWh', align:'right', tip:'24h average' },
      { w:'30%', label:'Range', sub:'min slot — max slot · €/MWh', align:'left', tip:'Intraday range, scale shared across zones' },
      { w:'21%', label:'Peak avg / Off-pk avg', sub:'08-20h / 00-08+20-24h · €/MWh', align:'right', tip:'Peak vs off-peak averages' },
      { w:'13%', label:'Spread P/OP', sub:'€/MWh', align:'right', tip:'Peak − Off-peak. Negative = inverted (duck curve)' },
    ],
    heatmap: [
      { w:'18%', label:'Zone' },
      { w:'10%', label:'Avg', sub:'€/MWh', align:'right' },
      { w:'12%', label:'Min @hr', sub:'€/MWh', align:'right', tip:'Cheapest slot of the day' },
      { w:'12%', label:'Max @hr', sub:'€/MWh', align:'right', tip:'Most expensive slot of the day' },
      { w:'10%', label:'Neg hrs', sub:'count', align:'right', tip:'Hours below 0 €/MWh' },
      { w:'15%', label:'Top quartile', sub:'% of slots', align:'right', tip:'Share of slots in the top 25% globally' },
    ],
    profile: [
      { w:'18%', label:'Zone' },
      { w:'14%', label:'Volatility', sub:'max% − min%', align:'right', tip:'Spread of the normalised profile (high = peaky day)' },
      { w:'14%', label:'Peak shape', sub:'peak/avg %', align:'right', tip:'Peak average as % of daily average. >100 = peak above avg' },
      { w:'14%', label:'Off-pk shape', sub:'off-pk/avg %', align:'right' },
      { w:'14%', label:'Duck index', sub:'eve − midday %', align:'right', tip:'17-21h avg vs 11-15h avg, in % of daily avg. High = duck curve' },
      { w:'10%', label:'Neg hrs', sub:'count', align:'right' },
    ],
    bands: [
      { w:'18%', label:'Zone' },
      { w:'12%', label:'Today avg', sub:'€/MWh', align:'right' },
      { w:'12%', label:'30d median', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Percentile', sub:'today vs 30d', align:'right', tip:'Where today sits in the 30-day distribution (0 = below all, 100 = above all)' },
      { w:'14%', label:'Max divergence', sub:'€/MWh from median', align:'right', tip:'Largest gap between today and 30-day median across hours' },
      { w:'14%', label:'Above max / below min', sub:'hrs', align:'right', tip:'Hours today exceeded the 30-day max or fell below the 30-day min' },
    ],
    spread: [
      { w:'18%', label:'Zone' },
      { w:'14%', label:'Avg spread', sub:'€/MWh', align:'right', tip:'Daily mean of (zone − reference)' },
      { w:'14%', label:'Max spread @hr', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Min spread @hr', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Hrs +/−', sub:'positive / negative', align:'right', tip:'Hours where the zone trades above / below the reference' },
      { w:'12%', label:'Correlation', sub:'ρ vs ref', align:'right', tip:'Pearson correlation of hourly profiles' },
    ],
  };
  const c = cols[view] || cols.lines;
  return '<tr>' + c.map(col => `
    <th style="width:${col.w};text-align:${col.align||'left'}" ${col.tip?`title="${col.tip}"`:''}>
      ${col.label}${col.sub?`<br><span style="color:var(--tx3);font-weight:400;font-size:9px">${col.sub}</span>`:''}
    </th>`).join('') + '</tr>';
}

// ── Helpers shared across body builders
function _ccZoneCell(r) {
  const col = window._zoneColorMap?.[r.code] || '#B8C9D9';
  const meta = ZONE_META[r.code] || { country: r.z?.name || r.code };
  return `<td style="padding:9px 6px;vertical-align:middle">
    <span style="display:inline-block;width:3px;height:12px;background:${col};border-radius:2px;vertical-align:middle;margin-right:6px"></span>
    <span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${col};font-size:11px">${r.z?.flag||''} ${r.code}</span>
    <span style="color:var(--text3);margin-left:5px;font-family:'Inter',sans-serif;font-size:10.5px">${meta.country||''}</span>
  </td>`;
}
function _ccTr(r, cells) {
  return `<tr data-zone="${r.code}" style="border-bottom:1px solid rgba(30,45,61,.5);cursor:pointer;transition:background .15s">
    ${_ccZoneCell(r)}${cells}
  </tr>`;
}
function _ccNum(v, color, decimals=1) {
  if (v == null || isNaN(v)) return '<span style="color:var(--text3)">--</span>';
  return `<span style="color:${color||'var(--text)'}">${v.toFixed(decimals)}</span>`;
}

// ── Compute rows: shared metrics, plus view-specific extras
function ccComputeRows(data, selected, view) {
  const out = [];
  const zonesArr = data.filter(z => selected.has(z.code) && z.hourly && z.hourly.filter(v=>v!=null).length);
  if (!zonesArr.length) return out;

  // Global pool of all valid prices across selected zones (for top-quartile, etc.)
  const allValid = [];
  zonesArr.forEach(z => z.hourly.forEach(v => { if (v != null) allValid.push(v); }));
  const sortedAll = [...allValid].sort((a,b)=>a-b);
  const q75 = sortedAll[Math.floor(sortedAll.length * 0.75)] ?? Infinity;

  zonesArr.forEach(z => {
    const h = z.hourly;
    const valid = h.filter(v => v != null);
    if (!valid.length) return;
    const nph = h.length > 24 ? Math.round(h.length/24) : 1;
    const resMin = nph === 4 ? 15 : (nph === 2 ? 30 : 60);
    const avg = valid.reduce((a,b)=>a+b,0) / valid.length;
    const mn = Math.min(...valid), mx = Math.max(...valid);
    const minIdx = h.indexOf(mn), maxIdx = h.indexOf(mx);
    const fmtSlot = (idx) => {
      if (idx < 0) return '--';
      const t = idx * resMin;
      return String(Math.floor(t/60)).padStart(2,'0') + ':' + String(t%60).padStart(2,'0');
    };
    const pkV = [], opV = [], midV = [], eveV = [];
    h.forEach((v, i) => {
      if (v == null) return;
      const hr = Math.floor(i / nph);
      if (hr >= 8 && hr < 20) pkV.push(v); else opV.push(v);
      if (hr >= 11 && hr < 15) midV.push(v);
      if (hr >= 17 && hr < 21) eveV.push(v);
    });
    const _avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
    const pk = _avg(pkV) ?? avg;
    const op = _avg(opV) ?? avg;
    const negHrs = h.filter(v => v != null && v < 0).length / nph;
    const topQ   = h.filter(v => v != null && v >= q75).length / valid.length * 100;
    const mid = _avg(midV);
    const eve = _avg(eveV);
    const duck = (mid != null && eve != null && Math.abs(avg) > 0.5) ? ((eve - mid) / avg) * 100 : null;
    const peakShape    = Math.abs(avg) > 0.5 ? (pk / avg) * 100 : null;
    const offPeakShape = Math.abs(avg) > 0.5 ? (op / avg) * 100 : null;
    // Volatility on the % profile (max% - min% of avg)
    const profile = Math.abs(avg) > 0.5 ? valid.map(v => (v / avg) * 100) : [];
    const volat = profile.length ? Math.max(...profile) - Math.min(...profile) : null;

    out.push({
      z, code: z.code, hourly: h, nph, resMin, valid, avg, mn, mx,
      minHr: fmtSlot(minIdx), maxHr: fmtSlot(maxIdx),
      pk, op, spread: pk - op,
      negHrs, topQ, peakShape, offPeakShape, duck, volat,
    });
  });

  // View-specific extras: bands and spread need extra fetches/computation
  if (view === 'bands') {
    out.forEach(r => {
      const env = window._envelopeCache && window._envelopeCache[r.code];
      if (!env) { r._noEnv = true; return; }
      const med = env.median.filter(v => v != null);
      r.med30 = med.length ? med.reduce((a,b)=>a+b,0)/med.length : null;
      // Percentile of today's avg vs 30d hourly distribution
      const pool = [];
      env.median.forEach((_, i) => {
        if (env.min[i] != null) pool.push(env.min[i]);
        if (env.max[i] != null) pool.push(env.max[i]);
        if (env.median[i] != null) pool.push(env.median[i]);
      });
      pool.sort((a,b)=>a-b);
      const idx = pool.findIndex(v => v >= r.avg);
      r.percentile = pool.length ? (idx < 0 ? 100 : (idx / pool.length) * 100) : null;
      // Max divergence today vs median (hour by hour)
      let maxDiv = 0;
      const nPts = r.hourly.length;
      for (let i = 0; i < nPts; i++) {
        const t = r.hourly[i], m = env.median[i];
        if (t != null && m != null) {
          const d = Math.abs(t - m);
          if (d > maxDiv) maxDiv = d;
        }
      }
      r.maxDiv = maxDiv;
      // Hours above 30d max / below 30d min
      let above = 0, below = 0;
      for (let i = 0; i < nPts; i++) {
        const t = r.hourly[i];
        if (t == null) continue;
        if (env.max[i] != null && t > env.max[i]) above++;
        if (env.min[i] != null && t < env.min[i]) below++;
      }
      r.aboveMaxHrs = above / r.nph;
      r.belowMinHrs = below / r.nph;
    });
  }
  if (view === 'spread') {
    const refCode = window._ccSpreadRef || 'FR';
    const ref = data.find(z => z.code === refCode);
    if (ref && ref.hourly) {
      const refH = ref.hourly;
      out.forEach(r => {
        if (r.code === refCode) { r._isRef = true; return; }
        const n = Math.min(r.hourly.length, refH.length);
        const sp = [];
        for (let i = 0; i < n; i++) {
          if (r.hourly[i] != null && refH[i] != null) sp.push({ v: r.hourly[i] - refH[i], i });
        }
        if (!sp.length) return;
        const vals = sp.map(s => s.v);
        const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
        const mxObj = sp.reduce((a,b)=> b.v > a.v ? b : a);
        const mnObj = sp.reduce((a,b)=> b.v < a.v ? b : a);
        const fmtSlot = (idx) => {
          const t = idx * r.resMin;
          return String(Math.floor(t/60)).padStart(2,'0') + ':' + String(t%60).padStart(2,'0');
        };
        r.spreadAvg = avg;
        r.spreadMax = mxObj.v; r.spreadMaxHr = fmtSlot(mxObj.i);
        r.spreadMin = mnObj.v; r.spreadMinHr = fmtSlot(mnObj.i);
        r.spreadPos = vals.filter(v => v > 0).length / r.nph;
        r.spreadNeg = vals.filter(v => v < 0).length / r.nph;
        // Pearson correlation
        const xs = [], ys = [];
        for (let i = 0; i < n; i++) {
          if (r.hourly[i] != null && refH[i] != null) { xs.push(r.hourly[i]); ys.push(refH[i]); }
        }
        if (xs.length > 2) {
          const mx_ = xs.reduce((a,b)=>a+b,0)/xs.length;
          const my_ = ys.reduce((a,b)=>a+b,0)/ys.length;
          let num=0, dx=0, dy=0;
          for (let i = 0; i < xs.length; i++) {
            const a = xs[i]-mx_, b = ys[i]-my_;
            num += a*b; dx += a*a; dy += b*b;
          }
          r.corr = (dx>0 && dy>0) ? num / Math.sqrt(dx*dy) : null;
        }
      });
    }
  }

  return out;
}

// ── Body builders per view
function ccBodyLines(rows) {
  const globalMin = Math.min(...rows.map(r => r.mn));
  const globalMax = Math.max(...rows.map(r => r.mx));
  const globalRng = globalMax - globalMin || 1;
  const spreadCellHTML = (s) => {
    if (s == null) return '<span style="color:var(--text3)">--</span>';
    if (s >= 0)    return `<span style="color:var(--text2)">+${s.toFixed(2)}</span>`;
    if (s > -20)   return `<span style="color:var(--warn)">${s.toFixed(2)}</span><div style="font-size:9px;color:var(--text3);margin-top:1px">inverted</div>`;
    return `<span style="color:var(--down)">${s.toFixed(2)}</span><div style="font-size:9px;color:var(--down);opacity:.75;margin-top:1px">deeply inverted</div>`;
  };
  return rows.map(r => {
    const col = window._zoneColorMap?.[r.code] || '#B8C9D9';
    const leftPct  = ((r.mn - globalMin) / globalRng) * 100;
    const widthPct = ((r.mx - r.mn) / globalRng) * 100;
    const cells = `
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--text);vertical-align:middle">${r.avg.toFixed(2)}</td>
      <td style="padding:9px 6px;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:0 0 48px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${r.mn<0?'var(--down)':'var(--text2)'};line-height:11px">
            ${r.mn.toFixed(2)}<br><span style="color:var(--text3);font-size:9px">@${r.minHr}</span>
          </div>
          <div style="flex:1;position:relative;height:8px">
            <div style="position:absolute;top:0;left:0;right:0;height:100%;background:var(--bg);border-radius:2px"></div>
            <div style="position:absolute;top:0;left:${leftPct.toFixed(1)}%;width:${Math.max(widthPct,2).toFixed(1)}%;height:100%;background:${col};opacity:.55;border-radius:2px"></div>
          </div>
          <div style="flex:0 0 48px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${r.mx<0?'var(--down)':'var(--text2)'};line-height:11px">
            ${r.mx.toFixed(2)}<br><span style="color:var(--text3);font-size:9px">@${r.maxHr}</span>
          </div>
        </div>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:var(--text)">${r.pk.toFixed(2)}</span> <span style="color:var(--text3)">/</span> <span style="color:var(--text2)">${r.op.toFixed(2)}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">${spreadCellHTML(r.spread)}</td>`;
    return _ccTr(r, cells);
  }).join('');
}

function ccBodyHeatmap(rows) {
  return rows.map(r => {
    const negCol = r.negHrs > 0 ? 'var(--down)' : 'var(--text3)';
    const tqBarCol  = r.topQ > 50 ? '#ED6965' : (r.topQ > 25 ? '#FBBF24' : '#14D3A9');
    const cells = `
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--text);vertical-align:middle">${r.avg.toFixed(2)}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:${r.mn<0?'var(--down)':'var(--text2)'}">${r.mn.toFixed(2)}</span> <span style="color:var(--text3);font-size:9px">@${r.minHr}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:var(--text)">${r.mx.toFixed(2)}</span> <span style="color:var(--text3);font-size:9px">@${r.maxHr}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${negCol};vertical-align:middle">${r.negHrs.toFixed(r.negHrs%1===0?0:1)}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;width:100%">
          <span style="color:var(--text2)">${r.topQ.toFixed(0)}%</span>
          <span style="display:inline-block;width:50px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative">
            <span style="display:block;height:100%;width:${Math.min(r.topQ,100).toFixed(0)}%;background:${tqBarCol};opacity:.7;border-radius:2px"></span>
          </span>
        </div>
      </td>`;
    return _ccTr(r, cells);
  }).join('');
}

function ccBodyProfile(rows) {
  const fmtPct = (v, decimals=0) => v == null ? '--' : `${v >= 0 ? '' : ''}${v.toFixed(decimals)}%`;
  return rows.map(r => {
    const peakCol    = r.peakShape != null    && r.peakShape    > 100 ? 'var(--text)' : 'var(--warn)';
    const offPeakCol = r.offPeakShape != null && r.offPeakShape < 100 ? 'var(--text2)' : 'var(--warn)';
    const duckCol    = r.duck != null && r.duck > 30 ? 'var(--down)' : 'var(--text2)';
    const cells = `
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text);vertical-align:middle">${r.volat != null ? r.volat.toFixed(0)+'%' : '--'}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${peakCol};vertical-align:middle">${fmtPct(r.peakShape)}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${offPeakCol};vertical-align:middle">${fmtPct(r.offPeakShape)}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${duckCol};vertical-align:middle">${fmtPct(r.duck)}${r.duck != null && r.duck > 30 ? '<div style="font-size:9px;color:var(--down);opacity:.75;margin-top:1px">strong duck</div>' : ''}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${r.negHrs>0?'var(--down)':'var(--text3)'};vertical-align:middle">${r.negHrs.toFixed(r.negHrs%1===0?0:1)}</td>`;
    return _ccTr(r, cells);
  }).join('');
}

function ccBodyBands(rows) {
  return rows.map(r => {
    if (r._noEnv) {
      const cells = `<td colspan="5" style="text-align:center;padding:9px 6px;color:var(--text3);font-size:11px">Loading 30-day envelope…</td>`;
      return _ccTr(r, cells);
    }
    const pctCol = r.percentile == null ? 'var(--text3)' : (r.percentile > 80 ? 'var(--up)' : r.percentile < 20 ? 'var(--down)' : 'var(--text2)');
    const cells = `
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--text);vertical-align:middle">${r.avg.toFixed(2)}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2);vertical-align:middle">${r.med30 != null ? r.med30.toFixed(2) : '--'}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${pctCol};vertical-align:middle">${r.percentile != null ? 'P'+r.percentile.toFixed(0) : '--'}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2);vertical-align:middle">${r.maxDiv != null ? r.maxDiv.toFixed(2) : '--'}</td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:${r.aboveMaxHrs>0?'var(--up)':'var(--text3)'}">${r.aboveMaxHrs.toFixed(r.aboveMaxHrs%1===0?0:1)}</span>
        <span style="color:var(--text3)"> / </span>
        <span style="color:${r.belowMinHrs>0?'var(--down)':'var(--text3)'}">${r.belowMinHrs.toFixed(r.belowMinHrs%1===0?0:1)}</span>
      </td>`;
    return _ccTr(r, cells);
  }).join('');
}

function ccBodySpread(rows) {
  const refCode = window._ccSpreadRef || 'FR';
  // Compute max absolute spread for divergent bar scaling
  const validSpreads = rows.filter(r => r.spreadAvg != null && !r._isRef).map(r => Math.abs(r.spreadAvg));
  const maxAbs = validSpreads.length ? Math.max(...validSpreads, 1) : 1;
  return rows.map(r => {
    if (r._isRef) {
      const cells = `<td colspan="5" style="text-align:center;padding:9px 6px;color:var(--text3);font-size:11px;font-style:italic">— reference —</td>`;
      return _ccTr(r, cells);
    }
    if (r.spreadAvg == null) {
      const cells = `<td colspan="5" style="text-align:center;padding:9px 6px;color:var(--text3);font-size:11px">No matching data vs ${refCode}</td>`;
      return _ccTr(r, cells);
    }
    const avgCol = r.spreadAvg >= 0 ? 'var(--up)' : 'var(--down)';
    const corrCol = r.corr == null ? 'var(--text3)' : (r.corr > 0.7 ? 'var(--up)' : r.corr < 0.3 ? 'var(--warn)' : 'var(--text2)');
    const sign = (v) => v >= 0 ? '+' : '';
    // Divergent bar: 60px centred on 0
    const divPct = Math.min(Math.abs(r.spreadAvg) / maxAbs, 1) * 50;
    const divHTML = r.spreadAvg >= 0
      ? `<span style="display:inline-block;width:60px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative;vertical-align:middle"><span style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,0.15)"></span><span style="position:absolute;left:50%;top:0;height:100%;width:${divPct.toFixed(1)}%;background:#ED6965;opacity:.75;border-radius:2px"></span></span>`
      : `<span style="display:inline-block;width:60px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative;vertical-align:middle"><span style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,0.15)"></span><span style="position:absolute;right:50%;top:0;height:100%;width:${divPct.toFixed(1)}%;background:#14D3A9;opacity:.75;border-radius:2px"></span></span>`;
    const cells = `
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end">
          <span style="font-weight:600;color:${avgCol}">${sign(r.spreadAvg)}${r.spreadAvg.toFixed(2)}</span>
          ${divHTML}
        </div>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:var(--up)">${sign(r.spreadMax)}${r.spreadMax.toFixed(2)}</span> <span style="color:var(--text3);font-size:9px">@${r.spreadMaxHr}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:var(--down)">${sign(r.spreadMin)}${r.spreadMin.toFixed(2)}</span> <span style="color:var(--text3);font-size:9px">@${r.spreadMinHr}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle">
        <span style="color:var(--up)">${r.spreadPos.toFixed(r.spreadPos%1===0?0:1)}</span>
        <span style="color:var(--text3)"> / </span>
        <span style="color:var(--down)">${r.spreadNeg.toFixed(r.spreadNeg%1===0?0:1)}</span>
      </td>
      <td style="text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${corrCol};vertical-align:middle">${r.corr != null ? r.corr.toFixed(2) : '--'}</td>`;
    return _ccTr(r, cells);
  }).join('');
}

// ── (B) Cross-highlight: hover/click row → highlight matching curve in the chart
function ccWireRowHighlight() {
  const tbody = document.getElementById('compare-data-tbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr[data-zone]').forEach(tr => {
    tr.onmouseenter = () => ccHighlightZone(tr.dataset.zone, false);
    tr.onmouseleave = () => ccHighlightZone(null, false);
    tr.onclick = () => {
      // Toggle persistent focus
      window._ccFocusZone = (window._ccFocusZone === tr.dataset.zone) ? null : tr.dataset.zone;
      ccHighlightZone(window._ccFocusZone, true);
    };
  });
}

function ccHighlightZone(code, isPersistent) {
  // Effective code: hover wins over focus, unless hover cleared (null) and focus exists
  const effective = code != null ? code : window._ccFocusZone;
  const chart = (typeof CHARTS !== 'undefined') ? CHARTS['price-compare-canvas'] : null;
  if (chart) {
    chart.data.datasets.forEach(ds => {
      const matches = !effective || (ds.label || '').startsWith(effective + ' ') || (ds.label || '').startsWith(effective + ' ·') || (ds.label || '').startsWith(effective + ' −') || (ds.label || '') === effective;
      const isOverlay = (ds.label || '').includes('J-1') || (ds.label || '').includes('J-2') || (ds.label || '').includes('30d') || (ds.label || '').startsWith('Median');
      if (effective) {
        ds.borderWidth = matches ? 3 : (ds._origBorderWidth ?? ds.borderWidth ?? 2);
        if (ds._origBorderWidth == null) ds._origBorderWidth = ds.borderWidth;
        if (isOverlay) {
          if (ds._origBorderColor == null) ds._origBorderColor = ds.borderColor;
        } else {
          if (ds._origBorderColor == null) ds._origBorderColor = ds.borderColor;
          if (!matches && typeof ds._origBorderColor === 'string' && ds._origBorderColor.startsWith('#')) {
            ds.borderColor = ds._origBorderColor + '40'; // 25% alpha
          } else if (matches) {
            ds.borderColor = ds._origBorderColor;
          }
        }
      } else {
        // Reset
        if (ds._origBorderWidth != null) { ds.borderWidth = ds._origBorderWidth; }
        if (ds._origBorderColor != null) { ds.borderColor = ds._origBorderColor; }
      }
    });
    chart.update('none');
  }
  // Visual feedback on rows
  const tbody = document.getElementById('compare-data-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr[data-zone]').forEach(tr => {
      const isMatch = effective && tr.dataset.zone === effective;
      tr.style.background = isMatch ? 'rgba(20,211,169,.06)' : '';
      tr.style.boxShadow = (isPersistent && isMatch) ? 'inset 3px 0 0 var(--up)' : '';
    });
  }
}
window.ccHighlightZone = ccHighlightZone;

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
// FULLSCREEN + SCREENSHOT
// ════════════════════════════════════════════

// Download the row chart as a PNG image
function downloadRowChart(idx) {
  const chart = _rowCharts[idx];
  if (!chart) {
    console.warn('No chart found for row', idx);
    return;
  }
  const z = window._pricesSorted?.[idx];
  const code = z?.code || `zone-${idx}`;
  const dateStr = window._currentPriceDate || new Date().toISOString().slice(0,10);
  // High-res PNG with theme bg color
  const bgFill = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#fff';
  const dataUrl = chart.toBase64Image('image/png', 1, bgFill);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `powerklock_${code}_${dateStr}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Open the row detail in native fullscreen with chart left, table right
// Table pane is resizable via a drag handle.
function openRowFullscreen(idx) {
  const z = window._pricesSorted?.[idx];
  if (!z) return;
  const inner = document.getElementById(`row-detail-inner-${idx}`);
  if (!inner) return;

  // Build fullscreen container if not already there
  let fs = document.getElementById('zone-fullscreen-overlay');
  if (fs) fs.remove();

  fs = document.createElement('div');
  fs.id = 'zone-fullscreen-overlay';
  fs.style.cssText = `
    position: fixed; inset: 0; background: var(--bg);
    z-index: 9999; display: flex; flex-direction: column;
    padding: 16px 24px 24px; overflow: hidden;
  `;

  const code = z.code;
  const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[code]) || '';
  const country = z.name || code;
  const dateStr = (typeof ccFmtDay === 'function') ? ccFmtDay(window._currentPriceDate) : (window._currentPriceDate || '');

  fs.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-shrink:0">
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--tx);letter-spacing:-0.01em">
          ${flag} ${code} — ${country}
        </div>
        <div style="font-size:12px;color:var(--tx2);margin-top:2px">${dateStr} <span style="color:var(--tx3);margin-left:12px">· Click-drag to zoom · Double-click to reset</span></div>
      </div>
      <div style="display:flex;gap:8px">
        <button id="fs-csv-btn" title="Export 15-min breakdown as CSV" style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:8px 14px;font-size:11px;border-radius:6px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">📊 CSV</button>
        <button id="fs-download-btn" title="Download chart as PNG" style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:8px 14px;font-size:11px;border-radius:6px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">📸 PNG</button>
        <button id="fs-resize-btn" title="Reset table width" style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:8px 10px;font-size:11px;border-radius:6px;cursor:pointer;font-family:inherit">⇔</button>
        <button id="fs-close-btn" style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:8px 14px;font-size:11px;border-radius:6px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">✕ Close (Esc)</button>
      </div>
    </div>
    <div id="fs-split" style="display:flex;gap:0;flex:1;min-height:0;position:relative">
      <div id="fs-chart-pane" style="flex:1;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:16px;display:flex;flex-direction:column;min-height:0;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0">
          <div style="font-size:11px;color:var(--tx3);font-family:'JetBrains Mono',monospace">Drag to zoom area · double-click to reset</div>
          <button onclick="(function(){var fs=document.getElementById('zone-fullscreen-overlay');if(fs&&fs._fsChart&&fs._fsChart.resetZoom)fs._fsChart.resetZoom();})()" title="Reset zoom"
            style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--tx3);padding:3px 10px;font-size:10px;border-radius:3px;cursor:pointer;font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.04em;text-transform:uppercase">↺ Reset</button>
        </div>
        <div id="fs-kpis" style="margin-bottom:12px;flex-shrink:0"></div>
        <div style="flex:1;position:relative;min-height:0">
          <canvas id="fs-chart-${idx}" style="width:100%;height:100%"></canvas>
        </div>
      </div>
      <div id="fs-divider" title="Drag to resize · double-click to reset" style="width:8px;cursor:col-resize;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:transparent">
        <div style="width:2px;height:40px;background:var(--bd);border-radius:1px;transition:background 0.15s"></div>
      </div>
      <div id="fs-table-pane" style="flex-shrink:0;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:16px;overflow-y:auto;min-height:0;min-width:200px;max-width:50%">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:11px;font-weight:600;color:var(--tx2);letter-spacing:.06em;text-transform:uppercase">15-min breakdown</div>
          <div style="font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace" id="fs-table-count">--</div>
        </div>
        <div id="fs-table-container"></div>
      </div>
    </div>
  `;
  document.body.appendChild(fs);

  // Clone KPIs from the inline detail (if present)
  const inlineKpis = document.getElementById(`row-kpis-${idx}`);
  if (inlineKpis) {
    document.getElementById('fs-kpis').innerHTML = inlineKpis.outerHTML;
  }

  // Clone the breakdown table from the inline <details>
  let tableData = null; // for CSV export
  const inlineDetails = inner.querySelector('details');
  if (inlineDetails) {
    const tableEl = inlineDetails.querySelector('table');
    if (tableEl) {
      document.getElementById('fs-table-container').innerHTML = tableEl.outerHTML;
      tableData = tableEl;
      const rowCount = tableEl.querySelectorAll('tbody tr').length;
      const cntEl = document.getElementById('fs-table-count');
      if (cntEl) cntEl.textContent = rowCount + ' slots';
    }
  }

  // Auto-fit table pane width to its natural content after layout
  requestAnimationFrame(() => {
    const tablePaneEl = document.getElementById('fs-table-pane');
    const tableElInside = document.querySelector('#fs-table-container table');
    if (tablePaneEl && tableElInside) {
      // Measure: table's natural width + container padding (32px = 16px x 2)
      const naturalW = Math.ceil(tableElInside.getBoundingClientRect().width) + 36;
      // Clamp between min (200) and 50% of viewport
      const clamped = Math.min(Math.max(naturalW, 200), Math.floor(window.innerWidth * 0.5));
      tablePaneEl.style.width = clamped + 'px';
      // Trigger chart resize after width is set
      if (fs._fsChart) { try { fs._fsChart.resize(); } catch(e){} }
    }
  });

  // Clone chart config from inline chart and render bigger
  const srcChart = _rowCharts[idx];
  if (srcChart) {
    const cfg = {
      type: srcChart.config.type,
      data: JSON.parse(JSON.stringify(srcChart.config.data)),
      options: JSON.parse(JSON.stringify(srcChart.config.options || {}))
    };
    cfg.options.maintainAspectRatio = false;
    cfg.options.responsive = true;

    // ── Bigger axis fonts in fullscreen (≈ Word 10pt) ─────
    cfg.options.scales = cfg.options.scales || {};
    Object.keys(cfg.options.scales).forEach(k => {
      const sc = cfg.options.scales[k];
      sc.ticks = sc.ticks || {};
      sc.ticks.font = Object.assign({}, sc.ticks.font || {}, { size: 13 });
      if (sc.title) {
        sc.title.font = Object.assign({}, sc.title.font || {}, { size: 13 });
      }
    });
    // Legend + tooltip fonts also bigger
    cfg.options.plugins = cfg.options.plugins || {};
    cfg.options.plugins.legend = cfg.options.plugins.legend || {};
    cfg.options.plugins.legend.labels = Object.assign(
      {}, cfg.options.plugins.legend.labels || {},
      { font: { size: 13 } }
    );
    cfg.options.plugins.tooltip = cfg.options.plugins.tooltip || {};
    cfg.options.plugins.tooltip.titleFont = Object.assign(
      {}, cfg.options.plugins.tooltip.titleFont || {}, { size: 13 }
    );
    cfg.options.plugins.tooltip.bodyFont = Object.assign(
      {}, cfg.options.plugins.tooltip.bodyFont || {}, { size: 13 }
    );

    // ── Drag-select zoom (chartjs-plugin-zoom) ────────────
    cfg.options.plugins.zoom = {
      zoom: {
        drag: {
          enabled: true,
          backgroundColor: 'rgba(20, 211, 169, 0.15)',
          borderColor: 'rgba(20, 211, 169, 0.6)',
          borderWidth: 1
        },
        wheel: { enabled: false },
        pinch: { enabled: true },
        mode: 'xy'
      },
      pan: { enabled: false }
    };

    const fsCanvas = document.getElementById(`fs-chart-${idx}`);
    if (fsCanvas && typeof Chart !== 'undefined') {
      try {
        fs._fsChart = new Chart(fsCanvas, cfg);
        // Double-click on canvas → reset zoom
        fsCanvas.addEventListener('dblclick', () => {
          if (fs._fsChart && typeof fs._fsChart.resetZoom === 'function') {
            fs._fsChart.resetZoom();
          }
        });
      } catch (e) {
        console.warn('Failed to clone chart for fullscreen', e);
      }
    }
  }

  // ── Resizable table pane (drag handle) ─────────────
  const divider = document.getElementById('fs-divider');
  const tablePane = document.getElementById('fs-table-pane');
  const splitEl = document.getElementById('fs-split');
  const dividerBar = divider.querySelector('div');
  let isDragging = false;

  const startDrag = (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    dividerBar.style.background = 'var(--acc)';
    e.preventDefault();
  };
  const onDrag = (e) => {
    if (!isDragging) return;
    const splitRect = splitEl.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const newWidth = splitRect.right - clientX;
    const minW = 200;
    const maxW = splitRect.width - 320;
    tablePane.style.width = Math.max(minW, Math.min(maxW, newWidth)) + 'px';
    // Resize chart to fit new chart pane size
    if (fs._fsChart) { try { fs._fsChart.resize(); } catch(e){} }
  };
  const stopDrag = () => {
    isDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    dividerBar.style.background = 'var(--bd)';
  };
  divider.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
  divider.addEventListener('dblclick', () => {
    const tableElInside = document.querySelector('#fs-table-container table');
    if (tableElInside) {
      const naturalW = Math.ceil(tableElInside.getBoundingClientRect().width) + 36;
      tablePane.style.width = Math.min(Math.max(naturalW, 200), Math.floor(window.innerWidth * 0.5)) + 'px';
    } else {
      tablePane.style.width = '340px';
    }
    if (fs._fsChart) { try { fs._fsChart.resize(); } catch(e){} }
  });
  divider.addEventListener('mouseenter', () => { dividerBar.style.background = 'var(--acc)'; });
  divider.addEventListener('mouseleave', () => { if (!isDragging) dividerBar.style.background = 'var(--bd)'; });

  // Reset button
  document.getElementById('fs-resize-btn').onclick = () => {
    const tableElInside = document.querySelector('#fs-table-container table');
    if (tableElInside) {
      const naturalW = Math.ceil(tableElInside.getBoundingClientRect().width) + 36;
      tablePane.style.width = Math.min(Math.max(naturalW, 200), Math.floor(window.innerWidth * 0.5)) + 'px';
    } else {
      tablePane.style.width = '340px';
    }
    if (fs._fsChart) { try { fs._fsChart.resize(); } catch(e){} }
  };

  // ── Buttons ─────────────
  const closeFs = () => {
    if (fs._fsChart) { try { fs._fsChart.destroy(); } catch(e){} }
    if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    fs.remove();
    document.removeEventListener('keydown', escHandler);
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
  };
  const escHandler = (ev) => { if (ev.key === 'Escape') closeFs(); };
  document.addEventListener('keydown', escHandler);

  document.getElementById('fs-close-btn').onclick = closeFs;
  document.getElementById('fs-download-btn').onclick = () => {
    if (!fs._fsChart) return;
    const bgFill = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#fff';
    const dataUrl = fs._fsChart.toBase64Image('image/png', 1, bgFill);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `powerklock_${code}_${(window._currentPriceDate||'')}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // CSV export
  document.getElementById('fs-csv-btn').onclick = () => {
    exportRowCSV(idx, code, window._currentPriceDate);
  };

  // Request native fullscreen
  if (fs.requestFullscreen) {
    fs.requestFullscreen().catch(err => console.warn('Fullscreen denied:', err));
  }
}

// Export 15-min breakdown to CSV
function exportRowCSV(idx, code, dateStr) {
  const z = window._pricesSorted?.[idx];
  if (!z) return;

  // Get the inline table (most reliable source)
  const inner = document.getElementById(`row-detail-inner-${idx}`);
  const tableEl = inner?.querySelector('details table');
  if (!tableEl) {
    alert('No breakdown data available to export');
    return;
  }

  // Extract headers
  const headerCells = tableEl.querySelectorAll('thead th');
  const headers = Array.from(headerCells).map(th => {
    // Clean up: strip HTML, keep first line
    return th.textContent.trim().replace(/\s+/g, ' ').split(/\s{2,}/)[0];
  });

  // Extract rows
  const dataRows = tableEl.querySelectorAll('tbody tr');
  const rows = Array.from(dataRows).map(tr => {
    const cells = tr.querySelectorAll('td');
    return Array.from(cells).map(td => {
      const txt = td.textContent.trim().replace(/\s+/g, ' ');
      // Escape CSV: wrap in quotes if contains comma/quote/newline
      if (/[,"\n]/.test(txt)) return '"' + txt.replace(/"/g, '""') + '"';
      return txt;
    });
  });

  // Build CSV
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `powerklock_${code}_${dateStr||'today'}_15min.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Expose for inline onclick handlers
window.openRowFullscreen = openRowFullscreen;
window.downloadRowChart = downloadRowChart;
window.exportRowCSV = exportRowCSV;
window.hoverSlotOnChart = hoverSlotOnChart;
window.clearSlotHover = clearSlotHover;


// ── Sync hover between breakdown table rows and chart points ───────
// Highlights the matching point on the chart (inline + fullscreen).
function hoverSlotOnChart(idx, slotIdx) {
  // Find which chart to use: prefer fullscreen if open, else inline
  let chart = null;
  const fs = document.getElementById('zone-fullscreen-overlay');
  if (fs && fs._fsChart) {
    chart = fs._fsChart;
  } else {
    chart = _rowCharts[idx];
  }
  if (!chart) return;

  // Find the first dataset that has a non-null value at this slot
  // (datasets typically: today, yesterday, etc.)
  const datasets = chart.data?.datasets || [];
  let targetDS = -1;
  for (let d = 0; d < datasets.length; d++) {
    const v = datasets[d].data?.[slotIdx];
    if (v != null) { targetDS = d; break; }
  }
  if (targetDS === -1) return;

  try {
    chart.setActiveElements([{ datasetIndex: targetDS, index: slotIdx }]);
    if (chart.tooltip) {
      chart.tooltip.setActiveElements([{ datasetIndex: targetDS, index: slotIdx }], { x: 0, y: 0 });
    }
    chart.update('none');
  } catch (e) {
    // Chart.js version mismatch; ignore silently
  }
}

function clearSlotHover(idx) {
  let chart = null;
  const fs = document.getElementById('zone-fullscreen-overlay');
  if (fs && fs._fsChart) {
    chart = fs._fsChart;
  } else {
    chart = _rowCharts[idx];
  }
  if (!chart) return;
  try {
    chart.setActiveElements([]);
    if (chart.tooltip) chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    chart.update('none');
  } catch (e) {}
}
