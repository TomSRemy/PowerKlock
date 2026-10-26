// js/prices/board.js — Prices: day-ahead board: loading, KPIs, table, row detail.
// Part of the former js/prices.js (lines 298–1658), split without changes: plain scripts loaded in this order
// by index.html, sharing their globals as before.
// ════════════════════════════════════════════
// LOAD PRICES
// ════════════════════════════════════════════
async function loadPrices() {
  // the latest day-ahead file written by the collection jobs
  if (typeof loadLastAvailable === 'function') loadLastAvailable();
}

function updateKPIs(data, dataDateStr) {
  const fr = data.find(d => d.code === 'FR');
  const de = data.find(d => d.code === 'DE_LU');
  const avg = data.reduce((a,b) => a + b.today, 0) / data.length;
  const maxZ = data[0];
  const minZ = data[data.length - 1];

  // Resolve display date for MAX/MIN labels
  const todayISO = pkTodayISO();
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
  // Files in data/history/daily/ are named by DELIVERY date, so J-1's file
  // is simply displayDate - 1.
  let yData = null;
  if (displayDate && typeof fetchHistoricalDaily === 'function') {
    const [y,m,d] = displayDate.split('-').map(Number);
    const j1Auction = new Date(Date.UTC(y, m-1, d));
    j1Auction.setUTCDate(j1Auction.getUTCDate() - 1);
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
    if (zone) zone.textContent = ctx.maxZ ? `${ctx.maxZ.flag} ${window.PKI18n ? PKI18n.tr(ctx.maxZ.name) : ctx.maxZ.name}` : '--';
  }

  // Min — compare today's min-zone with the SAME zone's J-1 avg
  const minYday = (yData && ctx.minZ) ? (yData.zones[ctx.minZ.code]?.avg ?? null) : null;
  const minDir = setCard('kpicard-min', today.minLvl, minYday);
  if (minDir) {
    renderChg('kpi-min-chg', minDir);
    const zone = document.getElementById('kpi-min-zone');
    if (zone) zone.textContent = ctx.minZ ? `${ctx.minZ.flag} ${window.PKI18n ? PKI18n.tr(ctx.minZ.name) : ctx.minZ.name}` : '--';
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
  'IT_SICI': {cc:'IT', country:'Italy South'},  'AT':      {cc:'AT', country:'Austria'},
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
  const todayISO = pkTodayISO();
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
    window._userZones = new Set(window.PK_DEFAULT_PRICE_ZONES || getGenMixDefaultZones());
  }
  // _compareZones always mirrors _userZones (global state)
  window._compareZones = window._userZones;
  // Default Daily prices table filter: same GenMix zones (data-driven, "With GenMix")
  if (window._pricesZoneFilter === undefined) {
    window._pricesZoneFilter = new Set(window.PK_DEFAULT_PRICE_ZONES || getGenMixDefaultZones());
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
    // Find the first visible anchor button. The header has gone through
    // several iterations (legacy, hdr, pk-gf), so we try each in order.
    const candidates = [
      'pk-gf-daily-zones',   // current global filter button (Daily)
      'zone-filter-btn-hdr', // old header button
      'zone-filter-btn',     // legacy inline button
    ];
    let anchorId = null;
    for (const id of candidates) {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null) { anchorId = id; break; }
    }
    if (!anchorId) anchorId = candidates[0]; // last-resort, even if hidden
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
    if (!h || h <= 0) return '<span style="color:var(--tx3)">0</span>';   // no negative hour is a value, not a gap
    return `<span style="color:${PK_FMT.negColor(h, {lightThreshold:0, heavyThreshold:6})};font-weight:600">${PK_FMT.negHours(h)}</span>`;
  };

  // Fuel config for domFuel
  const fuelOrder = ['nuclear','wind','solar','hydro','biomass','fossil'];
  const fuelMeta = {
    nuclear: {emoji: '', label:'Nuclear',  color:C_NUC},
    wind:    {emoji: '', label:'Wind',     color:C_WIND},
    solar:   {emoji: '', label:'Solar',    color:C_SOLAR},
    hydro:   {emoji: '', label:'Hydro',    color:C_HYD},
    biomass: {emoji: '', label:'Biomass',  color:C_BIO},
    fossil:  {emoji: '', label:'Fossil',   color:C_FOS},
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

    // % Renewables + dominant fuel of the delivery day (daily history file;
    // only zones covered by the generation fetch have them).
    let renPctStr = '–', domFuelHtml = '–';
    if (z.renPct != null) {
      const renP = Math.round(z.renPct);
      renPctStr = `<span style="color:${PK_FMT.renColor(renP)};font-weight:600">${renP}%</span>`;
    }
    if (z.domFuel) {
      const domKey = String(z.domFuel).toLowerCase();
      const fm = fuelMeta[domKey] || {emoji:'', label:z.domFuel, color:'var(--tx2)'};
      domFuelHtml = `<span style="color:${fm.color};font-size:11px">${fm.emoji} ${fm.label}</span>`;
    }

    // Smooth sparkline: downsample to 24pts first for clean shape
    let rawHourly = z.hourly && z.hourly.length ? z.hourly : [];
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
        <div style="padding:14px 16px" id="row-detail-inner-${i}"></div>
      </td>
    </tr>`;
    return {html, z, i};
  });

  tbody.innerHTML = rows.map(r=>r.html).join('');
  // columns with nothing to show for any zone (renewable share and main fuel before the generation data is in) are hidden
  const tbl = document.getElementById('prices-table');
  if (tbl) { tbl.classList.toggle('pk-noren', sorted.every(z => z.renPct == null)); tbl.classList.toggle('pk-nodom', sorted.every(z => !z.domFuel)); }
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
  const calcRenPct = z => z.renPct != null ? z.renPct : -1;
  const calcDomFuel = z => {
    return z.domFuel ? String(z.domFuel).toLowerCase() : 'zz';
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

// Close a Daily drill row programmatically. Symmetric with the
// '✕ Close' button in the drill header. Identical behaviour to re-clicking
// the parent row, kept as a dedicated function so the inline button onclick
// is self-explanatory.
function _dailyCloseRow(idx) {
  const detailRow = document.getElementById(`row-detail-${idx}`);
  if (!detailRow) return;
  detailRow.style.display = 'none';
  if (_rowCharts[idx]) { _rowCharts[idx].destroy(); delete _rowCharts[idx]; }
  if (_openRow === idx) _openRow = null;
  document.querySelectorAll('tr.zone-row.is-open').forEach(tr => tr.classList.remove('is-open'));
}
window._dailyCloseRow = _dailyCloseRow;

function buildHourlyDetail(idx, z) {
  const inner = document.getElementById(`row-detail-inner-${idx}`);
  if (!inner) return;

  if (!z.hourly || !z.hourly.length) {
    inner.innerHTML = '<div style="padding:18px;color:var(--tx3);font-size:12px">No intraday prices stored for ' + z.code + ' on this day.</div>';
    return;
  }

  const hourly = z.hourly && z.hourly.length ? z.hourly : [];
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

  // Volatility (σ) of intraday slots, and spread (max-min of the day)
  // These complement Avg/Peak/Min/Max to match the 6-KPI template aligned with HO drill.
  const sigma = rawValid.length > 1
    ? Math.sqrt(rawValid.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / rawValid.length)
    : null;
  const spreadDay = (minV != null && maxV != null) ? (maxV - minV) : null;

  // Mix info — pulled from window._genmixData if Genmix data is loaded for this zone.
  // _genmixData is shared across the app and populated by genmix.js when the
  // GenMix panel renders. Each entry is the raw mix per fuel type ({wind, solar, ...}).
  let mixRenPct = null, mixDomFuel = null, mixDomFuelColor = '#7A93AB';
  try {
    const gm = window._genmixData && window._genmixData[z.code];
    if (gm && gm.total > 0) {
      const ren = (gm.wind || 0) + (gm.solar || 0) + (gm.hydro || 0) + (gm.biomass || 0);
      mixRenPct = (ren / gm.total) * 100;
      // Find dominant fuel by max share
      let domKey = null, domVal = -Infinity;
      for (const k of ['wind','solar','hydro','biomass','nuclear','gas','coal','oil','other']) {
        if ((gm[k] || 0) > domVal) { domVal = gm[k] || 0; domKey = k; }
      }
      if (domKey) {
        const fuelColors = { wind:'#14D3A9', solar:'#FBBF24', hydro:'#06B6D4',
                             biomass:'#84CC16', nuclear:'#A78BFA', gas:'#F97316',
                             coal:'#7A93AB', oil:'#ED6965', other:'#7A93AB' };
        mixDomFuel = domKey.charAt(0).toUpperCase() + domKey.slice(1);
        mixDomFuelColor = fuelColors[domKey] || '#7A93AB';
      }
    }
  } catch (_) { /* mix optional */ }

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
    <!-- ═══ Drill row header · uses pk-section-* classes ═══ -->
    <div class="pk-section-header">
      <div class="pk-section-header-text">
        <div class="pk-eyebrow">
          Day-Ahead <span class="pk-sep">·</span> ${FLAG_MAP[z.code]||''} ${z.code} <span class="pk-sep">·</span> Intraday detail
        </div>
        <div class="pk-section-title">
          ${z.hourly && z.hourly.length === 96 ? '15-min slots · price profile' : 'Hourly price profile'}
        </div>
        <div class="pk-section-subtitle">
          ${ccFmtDay(window._currentPriceDate)} · ${z.hourly && z.hourly.length === 96 ? '96 × 15min slots' : (h24.length+' hours')} · ENTSO-E
        </div>
      </div>
      <div class="pk-section-header-actions">
        <button class="pk-btn-primary" onclick="event.stopPropagation();openRowFullscreen(${idx})" title="Open in fullscreen">⛶ Fullscreen</button>
        <button class="pk-btn-ghost" onclick="event.stopPropagation();_dailyCloseRow(${idx})" title="Close detail">✕ Close</button>
      </div>
    </div>

    <!-- ═══ KPI strip · 6 cards aligned with HO drill ═══ -->
    <div class="kpi-strip" style="grid-template-columns:repeat(6,1fr);margin-bottom:14px" id="row-kpis-${idx}">
      <!-- 1. Avg -->
      <div class="kpi-card kpi-flat" id="row-kpi-${idx}-avg">
        <div class="kpi-label">Avg</div>
        <div class="kpi-value">${avg.toFixed(2)}<span class="kpi-unit">€/MWh</span></div>
        <div class="kpi-chg row-kpi-chg" data-kpi="avg">--</div>
        <div class="kpi-meta">24h average</div>
      </div>
      <!-- 2. Peak / Off-peak (merged) -->
      <div class="kpi-card kpi-flat" id="row-kpi-${idx}-peakoff">
        <div class="kpi-label">Peak / Off-peak</div>
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;line-height:1.15">
          ▲ ${peakAvg!=null?peakAvg.toFixed(2):'--'}<span style="font-size:9px;color:var(--tx3);margin-left:3px;font-weight:400">€/MWh</span>
        </div>
        <div style="font-size:9px;color:var(--tx3);margin-bottom:4px">08h–20h</div>
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;line-height:1.15">
          ▼ ${offPkAvg!=null?offPkAvg.toFixed(2):'--'}<span style="font-size:9px;color:var(--tx3);margin-left:3px;font-weight:400">€/MWh</span>
        </div>
        <div style="font-size:9px;color:var(--tx3)">off-peak${peakRatio!=null?' · ratio '+peakRatio.toFixed(2)+'x':''}</div>
      </div>
      <!-- 3. Extremes (max + min + neg meta) -->
      <div class="kpi-card kpi-flat" id="row-kpi-${idx}-extremes">
        <div class="kpi-label">Extremes</div>
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;color:#14D3A9;line-height:1.15">
          ▲ ${maxV.toFixed(2)}<span style="font-size:9px;color:var(--tx3);margin-left:3px;font-weight:400">€/MWh</span>
        </div>
        <div style="font-size:9px;color:var(--tx3);margin-bottom:4px">@ ${maxSlotLabel}</div>
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;color:#ED6965;line-height:1.15">
          ▼ ${minV.toFixed(2)}<span style="font-size:9px;color:var(--tx3);margin-left:3px;font-weight:400">€/MWh</span>
        </div>
        <div style="font-size:9px;color:var(--tx3)">@ ${minSlotLabel} · ${negHours}h neg</div>
      </div>
      <!-- 4. Volatility σ -->
      <div class="kpi-card kpi-flat" id="row-kpi-${idx}-sigma" title="Volatility = standard deviation of all intraday slots. Higher σ means prices swing more across the day.">
        <div class="kpi-label">Volatility σ</div>
        <div class="kpi-value">${sigma!=null?sigma.toFixed(2):'--'}<span class="kpi-unit">€/MWh</span></div>
        <div class="kpi-chg row-kpi-chg" data-kpi="sigma">--</div>
        <div class="kpi-meta">intraday stdev</div>
      </div>
      <!-- 5. Spread -->
      <div class="kpi-card kpi-flat" id="row-kpi-${idx}-spread" title="Daily spread = max - min slot. Proxy for BESS arbitrage potential.">
        <div class="kpi-label">Spread</div>
        <div class="kpi-value">${spreadDay!=null?spreadDay.toFixed(2):'--'}<span class="kpi-unit">€/MWh</span></div>
        <div class="kpi-chg row-kpi-chg" data-kpi="spread">--</div>
        <div class="kpi-meta">max − min</div>
      </div>
      <!-- 6. Mix (renewable + dominant fuel) -->
      <div class="kpi-card kpi-flat" id="row-kpi-${idx}-mix">
        <div class="kpi-label">Mix</div>
        <div style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;line-height:1.15">
          ${mixRenPct!=null?mixRenPct.toFixed(1):'--'}<span class="kpi-unit">%</span><span style="font-size:9px;color:var(--tx3);margin-left:5px;font-weight:400">renewable</span>
        </div>
        <div style="font-size:9px;color:var(--tx3);margin-bottom:4px">(W + S + H + B)</div>
        <div style="font-size:13px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${mixDomFuelColor};line-height:1.15">${mixDomFuel||'--'}</div>
        <div style="font-size:9px;color:var(--tx3)">dominant fuel</div>
      </div>
    </div>

    <!-- Verdict bandeau (unified with HO drill via _buildHoVerdict) -->
    <div style="font-size:11px;color:var(--tx2);margin-bottom:14px;font-family:'Inter',sans-serif">
      ${(typeof window._buildHoVerdict === 'function')
        ? window._buildHoVerdict({
            avg: avg,
            sigma: sigma,
            renPctAvg: mixRenPct,
            negH: negHours,
          })
        : `<span style="color:${flatColor};font-weight:600">${flatText}</span>${peakRatio!=null ? `<span style="color:var(--tx3);margin-left:8px">Peak/off-peak ratio: ${peakRatio.toFixed(2)}x (baseline 1.30x)</span>` : ''}`}
    </div>

    <!-- ═══ Filters bar · band selector + actions ═══ -->
    <div class="pk-filters-bar">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Band</span>
        <div style="display:inline-flex;gap:4px" id="row-band-pills-${idx}">
          ${_rowBandPillsHTML(idx)}
        </div>
      </div>
      <div class="pk-filters-bar-spacer"></div>
      <button class="pk-btn-ghost" onclick="event.stopPropagation();(function(){var c=_rowCharts[${idx}];if(c&&c.resetZoom)c.resetZoom();})()" title="Reset zoom to original view">↺ Reset</button>
      <button class="pk-btn-primary" onclick="event.stopPropagation();downloadRowChart(${idx})" title="Download chart as PNG">${PK.icon('download')} PNG</button>
    </div>

    <!-- ═══ Chart ═══ -->
    <div style="position:relative;height:340px;margin-bottom:4px">
      <canvas id="row-chart-${idx}" style="width:100%;height:340px"></canvas>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:16px;font-size:10px;color:var(--tx3);margin-bottom:8px">
      <span>— ${ccFmtDay(window._currentPriceDate)}</span><span style="opacity:.5">- - - ${ccFmtDayShift(window._currentPriceDate, -1) || 'J-1'}</span>
      <span style="margin-left:8px">Shading: morning peak (07-09) | solar trough (11-14) | evening peak (17-21)</span>
    </div>

    <!-- ═══ Analyst banner (amber) · populated post-innerHTML ═══ -->
    <div id="row-analyst-banner-${idx}"></div>

    <!-- Band stats line · populated when the band selector is active -->
    <div id="row-band-stats-${idx}" style="display:none;margin-top:8px;padding:8px 12px;background:rgba(255,255,255,0.02);border-left:2px solid rgba(255,255,255,0.15);border-radius:0 4px 4px 0;font-size:11px;color:var(--tx2);font-family:'JetBrains Mono',monospace;line-height:1.6"></div>

    <!-- ═══ Breakdown table (collapsible) ═══ -->
    <details style="margin-top:18px">
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
            const _parisHM = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
            const nowSlot = _parisHM[0] * nph + Math.floor(_parisHM[1]/(60/nph));
            const isToday = (window._currentPriceDate || pkTodayISO()) === pkTodayISO();
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
  // Uses the shared _buildAnalystBanner('dailyDrill', …) defined in js/hist/single-zone.js.
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
  const curSlot = ((window._currentPriceDate || pkTodayISO()) !== pkTodayISO())
    ? -1 : Math.floor(pkParisHour()) * (chartData.length / 24);

  const datasets = [{
    label: `${z.code} ${ccFmtDay(window._currentPriceDate)}`,
    data: chartData,
    borderColor: col,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0,
    spanGaps: true,
    fill: true,
    backgroundColor: (ctx2) => {
      const g = ctx2.chart.ctx.createLinearGradient(0,0,0,180);
      g.addColorStop(0, col+'30'); g.addColorStop(1, col+'00'); return g;
    },
  }];

  // J-1 overlay from zone data — grey dashed, more legible than the 0.35 alpha used before
  if (z.hourlyYday && z.hourlyYday.length) {
    datasets.push({
      label: ccFmtDayShift(window._currentPriceDate, -1) || 'J-1',
      data: z.hourlyYday,
      borderColor: 'rgba(195,210,225,0.70)',
      borderWidth: 1.6, borderDash: [6, 4], pointRadius: 0, tension: 0, fill: false, spanGaps: true,
      _isJ1: true,
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
        tooltip: {
          mode: 'index',
          intersect: false,
          filter: ctx => !(ctx.dataset.label || '').startsWith('__band_'),
          itemSort: (a, b) => {
            // Today first, J-1 second, then median, then bands
            const order = (lbl) => {
              if (!lbl) return 99;
              if (lbl.startsWith('Range 0-100%')) return 4;
              if (lbl.startsWith('Typical 10-90%')) return 3;
              if (lbl.startsWith('Median ')) return 2;
              if (lbl.includes('Wed') || lbl.includes('Tue') || lbl.includes('Mon') || lbl.includes('Thu') || lbl.includes('Fri') || lbl.includes('Sat') || lbl.includes('Sun') || lbl === 'J-1') return 1;
              return 0;
            };
            return order(a.dataset.label) - order(b.dataset.label);
          },
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`
          }
        },
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
    const displayDate = window._currentPriceDate || pkTodayISO();
    const [yy,mm,dd] = displayDate.split('-').map(Number);
    const j1Auc = new Date(Date.UTC(yy, mm-1, dd));
    j1Auc.setUTCDate(j1Auc.getUTCDate() - 1);
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
  // Universal pill template (pkPill) for visual consistency across all sub-toggles.
  return _ROW_BAND_OPTIONS.map(opt => window.pkPill({
    label:    opt.label,
    active:   opt.key === cur,
    onClick:  `event.stopPropagation();setRowBandWindow(${idx},'${opt.key}')`,
    dataAttr: `data-win="${opt.key}"`,
  })).join('');
}

function setRowBandWindow(idx, key) {
  window._drillBandWindow = window._drillBandWindow || {};
  window._drillBandWindow[idx] = key;
  // Update inline pills
  const host = document.getElementById(`row-band-pills-${idx}`);
  if (host) host.innerHTML = _rowBandPillsHTML(idx);
  // Update fullscreen pills (if open)
  const fsHost = document.getElementById(`fs-row-band-pills-${idx}`);
  if (fsHost) fsHost.innerHTML = _rowBandPillsHTML(idx);
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
        && !lbl.startsWith('Median ')           // new label
        && !lbl.startsWith('Typical (P10–P90)') // legacy
        && !lbl.startsWith('Typical 10-90%')    // new label
        && !lbl.startsWith('Min–Max range')     // legacy
        && !lbl.startsWith('Range 0-100%');     // new label
  });
}

// Toggle visibility of the J-1 dataset on the chart.
// When bands turn on, J-1 is auto-hidden; when bands turn off, J-1 comes back.
// The user can override at any time by clicking the J-1 entry in the legend.
function _setJ1Hidden(chart, hidden) {
  if (!chart || !chart.data || !chart.data.datasets) return;
  const j1Idx = chart.data.datasets.findIndex(ds => ds && ds._isJ1);
  if (j1Idx < 0) return;
  if (typeof chart.getDatasetMeta === 'function') {
    const meta = chart.getDatasetMeta(j1Idx);
    if (meta) meta.hidden = hidden;
  } else {
    chart.data.datasets[j1Idx].hidden = hidden;
  }
}

