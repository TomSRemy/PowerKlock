// ── TICKER FILTER STATE ──
const tickerFilters = { power: true, gas: true, carbon: true, go: true };
let tickerZoneFilter = null; // null = all zones; Set of codes = filtered
let tickerAllItems = [];

function toggleTickerMenu() {
  document.getElementById('dd-btn').classList.toggle('open');
  document.getElementById('dd-menu').classList.toggle('open');
}

function toggleTickerCat(row) {
  const cat = row.dataset.cat;
  tickerFilters[cat] = !tickerFilters[cat];
  row.classList.toggle('on', tickerFilters[cat]);
  row.querySelector('.dd-check').textContent = tickerFilters[cat] ? '✓' : '';
  renderTicker();
  updateTickerLabel();
}

function updateTickerLabel() {
  const on = Object.entries(tickerFilters).filter(([,v])=>v).map(([k])=>k.toUpperCase());
  const lbl = document.getElementById('dd-label');
  if (!lbl) return;
  let label = on.length === 4 ? 'ALL' : on.join(' · ');
  if (tickerZoneFilter) {
    label += ` · ${tickerZoneFilter.size}Z`;
  }
  lbl.textContent = label;
}

document.addEventListener('click', e => {
  const btn   = document.getElementById('dd-btn');
  const menu  = document.getElementById('dd-menu');
  if (menu && menu.classList.contains('open')) {
    if (!btn?.contains(e.target) && !menu.contains(e.target)) {
      btn?.classList.remove('open');
      menu.classList.remove('open');
    }
  }
});

function renderTicker() {
  const visible = tickerAllItems.filter(item => {
    if (!tickerFilters[item.cat]) return false;
    // Zone filter applies only to power items
    if (item.cat === 'power' && tickerZoneFilter && !tickerZoneFilter.has(item.code)) return false;
    return true;
  });
  if (visible.length === 0) {
    document.getElementById('ticker-track').innerHTML = '';
    return;
  }
  const html = [...visible, ...visible].map(item => `
    <div class="ticker-item">
      <span class="ticker-cat ${item.cat}">${item.catLabel}</span>
      <span class="ticker-name">${item.name}</span>
      <span class="ticker-val ${item.up === true ? 'up' : item.up === false ? 'down' : ''}">${item.val} <span style="font-weight:400;font-size:10px;color:var(--text3)">${item.unit}</span></span>
      ${item.chg ? `<span class="ticker-chg ${item.up === true ? 'up' : item.up === false ? 'down' : ''}">${item.chg}</span>` : ''}
    </div>
  `).join('');
  document.getElementById('ticker-track').innerHTML = html;
}

function buildTicker(data) {
  tickerAllItems = [
    ...data.map(z => ({
      cat: 'power', catLabel: 'POWER',
      code: z.code,
      name: `${z.flag} ${z.code}`,
      val: z.today.toFixed(1),
      unit: '€/MWh',
      chg: z.vsYday != null ? (z.vsYday >= 0 ? `▲${z.vsYday.toFixed(1)}` : `▼${Math.abs(z.vsYday).toFixed(1)}`) : '',
      up: z.vsYday == null ? null : z.vsYday >= 0
    })),
    { cat:'gas', catLabel:'GAS', name:'TTF D+1', val:'45.14', unit:'€/MWh', chg:'▲2.35%', up:true },
    { cat:'gas', catLabel:'GAS', name:'PEG D+1', val:'42.80', unit:'€/MWh', chg:'▲1.80%', up:true },
    { cat:'gas', catLabel:'GAS', name:'NBP D+1', val:'43.50', unit:'p/th', chg:'▲1.20%', up:true },
    { cat:'carbon', catLabel:'CARBON', name:'EUA Spot', val:'74.09', unit:'€/t', chg:'▼0.09%', up:false },
    { cat:'carbon', catLabel:'CARBON', name:'EUA Dec-26', val:'76.40', unit:'€/t', chg:'▲0.32%', up:true },
    { cat:'go', catLabel:'GO', name:'GO Renew Cal-26', val:'0.42', unit:'€/MWh', chg:'', up:null },
    { cat:'go', catLabel:'GO', name:'GO Wind Cal-26', val:'0.55', unit:'€/MWh', chg:'', up:null },
  ];
  renderTicker();
  buildTickerZoneList(data);
}

function buildTickerZoneList(data) {
  const container = document.getElementById('ticker-zone-list');
  if (!container) return;

  // Only show zones that are actually in the ticker (have a power item)
  const powerItems = tickerAllItems.filter(i => i.cat === 'power');
  if (!powerItems.length) return;

  container.innerHTML = powerItems.map(item => {
    const code = item.code;
    const isOn = !tickerZoneFilter || tickerZoneFilter.has(code);
    return `<div class="dd-row${isOn?' on':''}" onclick="toggleTickerZone('${code}',this)" style="padding:5px 14px;font-size:10px">
      <span class="dd-check">${isOn?'✓':''}</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:var(--accent);min-width:60px">${item.name}</span>
      <span style="color:var(--text3)">${(ZONE_META[code]||{}).country||''}</span>
    </div>`;
  }).join('');
}

function toggleTickerZone(code, row) {
  const powerCodes = tickerAllItems.filter(i=>i.cat==='power').map(i=>i.code);
  const allCodes   = new Set(powerCodes);

  if (!tickerZoneFilter) {
    // Premier clic depuis "tout affiché" → sélectionner uniquement cette zone
    tickerZoneFilter = new Set([code]);
  } else if (tickerZoneFilter.has(code)) {
    tickerZoneFilter.delete(code);
    // Si plus rien → tout réafficher
    if (tickerZoneFilter.size === 0) tickerZoneFilter = null;
  } else {
    tickerZoneFilter.add(code);
    // Si toutes sélectionnées → reset à null (= toutes)
    if (tickerZoneFilter.size >= allCodes.size) tickerZoneFilter = null;
  }

  buildTickerZoneList();
  renderTicker();
  updateTickerLabel();
}

function tickerSelectAllZones() {
  tickerZoneFilter = null; // null = toutes actives
  buildTickerZoneList();
  renderTicker();
  updateTickerLabel();
}

function tickerSelectNoneZones() {
  const allCodes = tickerAllItems.filter(i=>i.cat==='power').map(i=>i.code);
  tickerZoneFilter = new Set(); // Set vide = aucune
  buildTickerZoneList();
  renderTicker();
  updateTickerLabel();
}

// Default ticker while loading
buildTicker([
  { flag:'🇫🇷', code:'FR', today:1.2, vsYday:-15.3, up:false },
  { flag:'🇩🇪', code:'DE', today:63.8, vsYday:-7.4, up:false },
  { flag:'🇪🇸', code:'ES', today:75.5, vsYday:+18.4, up:true },
  { flag:'🇮🇹', code:'IT', today:115.8, vsYday:+12.0, up:true },
  { flag:'🇧🇪', code:'BE', today:49.1, vsYday:-10.8, up:false },
  { flag:'🇳🇱', code:'NL', today:57.5, vsYday:-3.3, up:false },
  { flag:'🇵🇹', code:'PT', today:76.1, vsYday:+19.2, up:true },
  { flag:'🇬🇧', code:'GB', today:88.4, vsYday:+5.1, up:true },
]);

// ════════════════════════════════════════════
// GENERATION MIX
// ════════════════════════════════════════════
window._genMixType = 'bar';
function setGenMixType(type, btn) {
  window._genMixType = type;
  document.querySelectorAll('#genmix-type-btns .day-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadGenMix();
}

