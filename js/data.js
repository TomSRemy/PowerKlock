
async function loadLastAvailable() {
  if (!DATA_BASE) return;
  for (let i = 1; i <= 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0,10);
    try {
      const r = await fetch(DATA_BASE + 'history/daily/' + dateStr + '.json?t=' + Date.now());
      if (r.ok) {
        const data = await r.json();
        const hasData = Array.isArray(data.zones) ? data.zones.length > 0
          : (data.zones && Object.keys(data.zones).length > 0);
        if (hasData) {
          console.log('Last available:', dateStr);
          if (typeof dpSelect === 'function') dpSelect(dateStr);
          else loadPricesForDate(dateStr);
          return;
        }
      }
    } catch(e) {}
  }
}

async function loadFromJSON() {
  // Prices
  const prices = await fetchJSON('prices.json');
  if (prices?.zones?.length) {
    // Map JSON fields to dashboard format
    pricesData = prices.zones.map(z => ({
      code:    z.code,
      name:    z.name,
      flag:    z.code.slice(0,2),
      today:   z.today,
      vsYday:  z.vsYday,
      min:     z.min,
      minHr:   z.minHour || 0,
      max:     z.max,
      maxHr:   z.maxHour || 0,
      negHrs:  z.negHours || 0,
      spark:   z.spark,
      hourly:  z.hourly || [],
    }));
    // Extract date from JSON updated field
    const jsonDate = prices.updated ? prices.updated.slice(0,10) : null;
    renderPricesTable(pricesData, jsonDate);
    updateKPIs(pricesData);
    buildTicker(pricesData);
    const upd = prices.updated
      ? new Date(prices.updated).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) + ' UTC'
      : 'JSON';
    const badge = document.getElementById('prices-updated');
    if (badge) { badge.textContent = 'ENTSO-E · ' + upd; badge.style.color = 'var(--accent)'; }
    // Recompute negHours from actual hourly data (handles 15min resolution)
    pricesData.forEach(z => {
      if (z.hourly && z.hourly.length > 0) {
        z.negHrs = negHoursFromData(z.hourly);
      }
    });
    console.log('✅ Prices from JSON:', pricesData.length, 'zones');
    // Refresh map if visible
    if (leafletMap && document.getElementById('page-map')?.classList.contains('active')) {
      updateMapMarkers(); renderMapKPIs(); refreshGeoLayer();
    }
  }

  // Genmix
  const genmix = await fetchJSON('genmix.json');
  if (genmix?.countries) { window._genmixData = genmix.countries; console.log('✅ Genmix from JSON'); }

  // Renewables
  const ren = await fetchJSON('renewables.json');
  if (ren?.countries) {
    window._renData = ren.countries;
    console.log('✅ Renewables from JSON');
    if (document.getElementById('page-renewables')?.classList.contains('active')) drawRenChart();
  }

  // Load
  const load = await fetchJSON('load.json');
  if (load?.countries) { window._loadData = load.countries; console.log('✅ Load from JSON'); }

  // Cross-border
  const cb = await fetchJSON('crossborder.json');
  if (cb?.countries) { window._cbData = cb.countries; console.log('✅ Cross-border from JSON'); }
}

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
updateConverter();
updateCapacity();
// Load data: try JSON first, then last available
(async () => {
  await loadFromJSON();
  if (!pricesData || pricesData.length === 0) {
    await loadLastAvailable();
  }
})();


// ══════════════════════════════════════════════════════
// DATE PICKER
// ══════════════════════════════════════════════════════
const DP = {
  selectedDate: null,   // null = today
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  // negDays: map of 'YYYY-MM-DD' → negHours (populated from prices history)
  negDays: JSON.parse(localStorage.getItem('pk-neg-days') || '{}'),
};

// Record today's neg hours when prices load
function dpRecordNegHours(zonesData) {
  const today = new Date();
  const key = today.toISOString().slice(0,10);
  const maxNeg = Math.max(...zonesData.map(z => z.negHours || 0));
  if (maxNeg > 0) {
    DP.negDays[key] = maxNeg;
    localStorage.setItem('pk-neg-days', JSON.stringify(DP.negDays));
  }
}

// Load historical neg hours from summary.json for red dots
async function dpLoadHistoryNegDays() {
  try {
    const base = typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : './data/';
    const r = await fetch(base + 'history/summary.json?t=' + Date.now());
    if (!r.ok) return;
    const s = await r.json();
    const fr = s?.zones?.FR;
    if (!fr) return;
    let changed = false;
    fr.forEach(d => {
      if (d.negH > 0 && !DP.negDays[d.d]) {
        DP.negDays[d.d] = d.negH;
        changed = true;
      }
    });
    if (changed) {
      localStorage.setItem('pk-neg-days', JSON.stringify(DP.negDays));
    }
  } catch(e) {}
}
// Call on load
dpLoadHistoryNegDays();

function toggleDatePicker() {
  const btn = document.getElementById('date-picker-btn');
  const popup = document.getElementById('date-picker-popup');
  btn.classList.toggle('open');
  popup.classList.toggle('open');
  if (popup.classList.contains('open')) dpRender();
}

document.addEventListener('click', e => {
  if (!e.target.closest('.date-picker-wrap')) {
    document.getElementById('date-picker-btn')?.classList.remove('open');
    document.getElementById('date-picker-popup')?.classList.remove('open');
  }
});

function dpRender() {
  const today = new Date();
  const y = DP.viewYear, m = DP.viewMonth;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('dp-month-label').textContent = months[m] + ' ' + y;

  const firstDay = new Date(y, m, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(y, m+1, 0).getDate();
  // Convert to Mon-first: 0=Mon ... 6=Sun
  const offset = (firstDay + 6) % 7;

  const todayStr = today.toISOString().slice(0,10);
  const selStr = DP.selectedDate || todayStr;

  let html = '';
  // Empty cells
  for (let i = 0; i < offset; i++) html += '<div class="dp-day dp-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday  = dateStr === todayStr;
    const isSel    = dateStr === selStr;
    const isFuture = dateStr > todayStr;
    const negH     = DP.negDays[dateStr];

    let cls = 'dp-day';
    if (isToday) cls += ' dp-today';
    if (isSel)   cls += ' dp-selected'; // today gets dp-selected when selectedDate is null
    if (isFuture) cls += ' dp-future';

    const dot = (negH > 0 && !isSel) ? '<div class="dp-neg-dot"></div>' : '';
    html += `<div class="${cls}" ${isFuture ? '' : `onclick="dpSelect('${dateStr}')"`}>${d}${dot}</div>`;
  }
  document.getElementById('dp-grid').innerHTML = html;
}

function dpSelect(dateStr) {
  const todayStr = new Date().toISOString().slice(0,10);
  const isToday  = dateStr === todayStr;
  DP.selectedDate = isToday ? null : dateStr;

  // Update picker button label — European format DD/MM/YY
  const lbl = document.getElementById('date-picker-label');
  if (lbl) {
    if (isToday) {
      lbl.textContent = 'Today';
    } else {
      const [y,m,d] = dateStr.split('-');
      lbl.textContent = d + '/' + m + '/' + y.slice(2); // DD/MM/YY
    }
  }

  // Update prices-date-label immediately
  const fmtLong2 = s => { const [y,m,d]=s.split('-'); return new Date(+y,+m-1,+d).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}); };
  const dateLabel = document.getElementById('prices-date-label');
  if (dateLabel) dateLabel.textContent = 'Day-Ahead prices · ' + fmtLong2(dateStr) + ' · ENTSO-E';

  dpRender();
  loadPricesForDate(dateStr);
  document.getElementById('date-picker-btn')?.classList.remove('open');
  document.getElementById('date-picker-popup')?.classList.remove('open');
}
function dpSelectToday() {
  dpSelect(new Date().toISOString().slice(0,10));
}

function dpChangeMonth(dir) {
  DP.viewMonth += dir;
  if (DP.viewMonth > 11) { DP.viewMonth = 0; DP.viewYear++; }
  if (DP.viewMonth < 0)  { DP.viewMonth = 11; DP.viewYear--; }
  dpRender();
}

// ── Load prices for a specific date ──
async function loadPricesForDate(dateStr) {
  if (!dateStr) { loadPrices(); return; }
  const todayStr = new Date().toISOString().slice(0,10);

  const updEl = document.getElementById('prices-updated');
  if (updEl) updEl.textContent = 'Loading ' + dateStr + '...';

  const fmtDate = s => { const [y,m,d]=s.split('-'); return d+'/'+m+'/'+y.slice(2); };

  // Flag lookup from ZONES array
  const flagOf = code => {
    const z = ZONES.find(z => z.code === code);
    if (z) return z.flag || '';
    const flagMap = {FR:'🇫🇷',DE_LU:'🇩🇪',BE:'🇧🇪',NL:'🇳🇱',ES:'🇪🇸',PT:'🇵🇹',IT_NORD:'🇮🇹',IT_SICI:'🇮🇹',
      AT:'🇦🇹',CH:'🇨🇭',CZ:'🇨🇿',SK:'🇸🇰',HU:'🇭🇺',PL:'🇵🇱',RO:'🇷🇴',HR:'🇭🇷',SI:'🇸🇮',RS:'🇷🇸',
      BG:'🇧🇬',GR:'🇬🇷',MK:'🇲🇰',ME:'🇲🇪',DK_W:'🇩🇰',DK_E:'🇩🇰',SE:'🇸🇪',SE_3:'🇸🇪',
      NO_1:'🇳🇴',NO_2:'🇳🇴',FI:'🇫🇮',EE:'🇪🇪',LV:'🇱🇻',LT:'🇱🇹',GB:'🇬🇧',MT:'🇲🇹'};
    return flagMap[code] || '';
  };

  // ── 1. Try historical JSON file (GitHub Pages / localhost)
  if (DATA_BASE) {
    try {
      const url = DATA_BASE + 'history/daily/' + dateStr + '.json?t=' + Date.now();
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        let mapped = [];

        if (Array.isArray(d.zones)) {
          // prices.json list format
          mapped = d.zones.map(z => ({
            code:   z.code,
            name:   z.name || (ZONE_META[z.code]||{}).country || z.code,
            flag:   flagOf(z.code),
            today:  z.today ?? z.avg ?? 0,
            vsYday: z.vsYday ?? null,
            min:    z.min ?? 0,
            minHr:  z.minHour ?? z.minHr ?? 0,
            max:    z.max ?? 0,
            maxHr:  z.maxHour ?? z.maxHr ?? 0,
            negHrs: z.negHours ?? z.negH ?? 0,
            spark:  z.spark ?? null,
            hourly: z.hourly || [],
          }));
        } else if (d.zones && typeof d.zones === 'object') {
          // dict format: { FR: { avg, min, max, negH, hourly }, ... }
          mapped = Object.entries(d.zones).map(([code, z]) => {
            const meta   = ZONE_META[code] || {};
            const hourly = z.hourly || [];
            const valid  = hourly.filter(v => v != null);
            const avg    = z.avg ?? (valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : 0);
            const mn     = z.min ?? (valid.length ? Math.min(...valid) : 0);
            const mx     = z.max ?? (valid.length ? Math.max(...valid) : 0);
            const nph    = hourly.length > 24 ? Math.round(hourly.length/24) : 1;
            const minIdx = valid.length ? hourly.indexOf(mn) : 0;
            const maxIdx = valid.length ? hourly.indexOf(mx) : 0;
            return {
              code,
              name:   meta.country || code,
              flag:   flagOf(code),
              today:  Math.round(avg * 10) / 10,
              vsYday: null,
              min:    Math.round(mn * 10) / 10,
              minHr:  minIdx >= 0 ? Math.floor(minIdx/nph) : 0,
              max:    Math.round(mx * 10) / 10,
              maxHr:  maxIdx >= 0 ? Math.floor(maxIdx/nph) : 0,
              negHrs: z.negH ?? z.negHours ?? 0,
              spark:  null,
              hourly,
            };
          });
        }

        if (mapped.length) {
          pricesData = mapped.sort((a,b) => b.today - a.today);
          renderPricesTable(pricesData, dateStr);
          updateKPIs(pricesData);
          buildTicker(pricesData);
          if (updEl) updEl.textContent = fmtDate(dateStr) + ' · ENTSO-E historical';
          return;
        }
      }
    } catch(e) { console.warn('Historical fetch failed:', e); }
  }

  // If today and no historical file yet:
  // - with token: try live ENTSO-E fetch
  // - without token: load last available
  if (dateStr === todayStr) {
    if (ENTSOE_TOKEN && ENTSOE_TOKEN !== 'YOUR_ENTSOE_TOKEN_HERE') {
      loadPrices();
    } else {
      loadLastAvailable();
    }
    return;
  }

  // ── 2. Real ENTSO-E token
  if (ENTSOE_TOKEN && ENTSOE_TOKEN !== 'YOUR_ENTSOE_TOKEN_HERE') {
    const d  = dateStr.replace(/-/g,'');
    const d2 = (() => { const n=new Date(dateStr); n.setDate(n.getDate()+1); return n.toISOString().slice(0,10).replace(/-/g,''); })();
    loadPricesWithDates(d+'0000', d2+'0000');
    return;
  }

  // No data available — load last available date instead
  showNoDataMessage(dateStr);
  loadLastAvailable();
}

function showNoDataMessage(dateStr) {
  const tbody = document.getElementById('prices-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--tx3)">
    <div style="font-size:14px;margin-bottom:8px">No data yet for ${dateStr}</div>
    <div style="font-size:11px">ENTSO-E publishes Day-Ahead prices after 13:00 CET.<br>Loading last available date…</div>
  </td></tr>`;
}
function showPricesUnavailable(dateStr) {
  const tbody = document.getElementById('prices-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text3);font-size:13px">
    Historical data for ${dateStr} requires direct ENTSO-E API access.<br>
    <span style="font-size:11px;margin-top:4px;display:block">Data is available on GitHub Pages after daily fetch.</span>
  </td></tr>`;
}



// ══════════════════════════════════════════════════════════════
// HISTORICAL CHARTS ENGINE
// Colour tokens (var = window-scoped, accessible across script blocks)
var _HIST_TX3  = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim() || '#4a6280';
var _HIST_ACC  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00d4a8';
var _HIST_WARN = '#e8a020';
var _HIST_DN   = '#ef4444';
var _HIST_UP   = '#22c55e';
var _HIST_GRID = 'rgba(255,255,255,0.04)';

// ── Fixed country colours ──
var ZONE_COLORS = {
  'FR':      '#00d4a8',
  'DE_LU':   '#60a5fa',
  'BE':      '#fbbf24',
  'NL':      '#a78bfa',
  'ES':      '#f87171',
  'PT':      '#fb923c',
  'IT_NORD': '#34d399',
  'IT_SICI': '#6ee7b7',
  'AT':      '#e879f9',
  'CH':      '#94a3b8',
  'CZ':      '#f472b6',
  'SK':      '#38bdf8',
  'HU':      '#facc15',
  'RO':      '#4ade80',
  'HR':      '#fb7185',
  'SI':      '#c084fc',
  'GR':      '#2dd4bf',
  'BG':      '#e2e8f0',
  'DK_W':    '#7dd3fc',
  'DK_E':    '#93c5fd',
  'SE':      '#86efac',
  'NO_1':    '#6ee7b7',
  'FI':      '#fda4af',
  'LT':      '#fdba74',
  'LV':      '#fcd34d',
  'EE':      '#d9f99d',
  'PL':      '#f9a8d4',
  'RS':      '#c4b5fd',
  'ME':      '#a5f3fc',
  'MK':      '#bbf7d0',
};

function zoneColor(code) {
  return ZONE_COLORS[code] || '#94a3b8';
}

// ── Period label ──
function periodLabel(data) {
  if (!data || !data.length) return '';
  const first = data[0].d || data[0];
  const last  = data[data.length-1].d || data[data.length-1];
  const fmt = d => {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  };
  return fmt(first) + ' → ' + fmt(last);
}

// ══════════════════════════════════════════════════════════════

// Cache for fetched summary data
const HIST = {
  summary: null,       // all-time daily summary
  monthly: {},         // 'YYYY-MM' → monthly data
  windows: {},         // current window per chart key
  charts: {},          // Chart.js instances
};
