// ─────────────────────────────────────────────────────────────
// Yesterday data — cache + fetch + KPI computation
// Used by updateKPIs to compute vs-J-1 direction across all KPIs
// ─────────────────────────────────────────────────────────────
window._yesterdayCache = window._yesterdayCache || {};

// ─────────────────────────────────────────────────────────────
// GenMix zone defaults
// Returns the list of zone codes that have actual generation mix data
// loaded from genmix.json. Used as the default filter "With GenMix"
// across Daily, Compare, Historical Overview, and Historical Multi-zone.
// Falls back to a hard-coded conservative list if data not yet loaded.
// ─────────────────────────────────────────────────────────────
function getGenMixDefaultZones() {
  if (window._genmixData && typeof window._genmixData === 'object') {
    const keys = Object.keys(window._genmixData);
    if (keys.length) return keys;
  }
  // Fallback while genmix.json hasn't loaded yet
  return ['FR', 'DE_LU', 'ES', 'BE', 'NL', 'GB', 'PT'];
}

// Apply GenMix default zones to all zone filters (called once when genmix.json
// finishes loading, to set the default filter state across the app).
function applyDefaultGenMixZones() {
  const zones = getGenMixDefaultZones();
  const set = new Set(zones);
  // Daily Prices table filter
  window._pricesZoneFilter = new Set(set);
  // Daily Compare + Historical shared user zones (via setUserZones if available,
  // else direct mutation)
  if (typeof setUserZones === 'function') {
    setUserZones(zones);  // also dispatches 'zones-changed'
  } else {
    window._userZones = new Set(set);
    window._compareZones = new Set(set);
  }
  // Re-render daily tables and chips if those renderers exist
  if (typeof renderPricesTableBody === 'function') renderPricesTableBody();
  if (typeof buildZoneFilterDropdown === 'function') buildZoneFilterDropdown();
  if (typeof renderCompareChart === 'function')   renderCompareChart();
  if (typeof buildCompareChips === 'function')    buildCompareChips();
  // Update button labels
  const n = zones.length;
  const labelText = `${n} / ${n} zones`;
  ['zone-filter-label', 'zone-filter-label-hdr'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = labelText;
  });
}
window.getGenMixDefaultZones = getGenMixDefaultZones;
window.applyDefaultGenMixZones = applyDefaultGenMixZones;

// Upsample hourly data to 96 slots (15-min resolution) by duplicating each value.
// Some zones (e.g. CH) deliver DA prices at 1h resolution while most are 15-min.
// Since the price is constant over the hour for those zones, duplicating x4 is
// not fake precision — it's the actual price applied across the 4 quarters.
// - 24 values (1h)  -> duplicated x4 to give 96 slots
// - 48 values (30m) -> duplicated x2 to give 96 slots
// - 96 values (15m) -> returned as-is
// - other lengths   -> returned as-is (caller decides)
function upsampleHourly(hourly) {
  if (!Array.isArray(hourly)) return hourly;
  const n = hourly.length;
  if (n === 24) return hourly.flatMap(v => [v, v, v, v]);
  if (n === 48) return hourly.flatMap(v => [v, v]);
  return hourly;
}

// Returns the ISO date string for J-1 given an ISO date string
function _prevDateISO(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

// Fetch the historical daily JSON for any given ISO date (cached)
// Returns { zones: {code: {avg, hourly, ...}} } or null on failure
async function fetchHistoricalDaily(dateISO) {
  if (!DATA_BASE || !dateISO) return null;
  if (window._yesterdayCache[dateISO] !== undefined) {
    return window._yesterdayCache[dateISO];
  }
  try {
    const r = await fetch(DATA_BASE + 'history/daily/' + dateISO + '.json?t=' + Date.now());
    if (!r.ok) { window._yesterdayCache[dateISO] = null; return null; }
    const data = await r.json();
    const norm = { zones: {} };
    if (Array.isArray(data.zones)) {
      data.zones.forEach(z => {
        norm.zones[z.code] = {
          avg:    z.today ?? z.avg ?? null,
          hourly: upsampleHourly(z.hourly || []),
          min:    z.min ?? null,
          max:    z.max ?? null,
        };
      });
    } else if (data.zones && typeof data.zones === 'object') {
      Object.entries(data.zones).forEach(([code, z]) => {
        norm.zones[code] = {
          avg:    z.avg ?? z.today ?? null,
          hourly: upsampleHourly(z.hourly || []),
          min:    z.min ?? null,
          max:    z.max ?? null,
        };
      });
    }
    window._yesterdayCache[dateISO] = norm;
    return norm;
  } catch (e) {
    window._yesterdayCache[dateISO] = null;
    return null;
  }
}

// Fetch the historical daily JSON for J-1 of the given ISO date
// Returns { zones: {code: {avg, hourly, ...}} } or null on failure
async function fetchYesterdayDaily(currentDateISO) {
  if (!currentDateISO) return null;
  return fetchHistoricalDaily(_prevDateISO(currentDateISO));
}

// Compute summary KPIs (avg, peak, off-peak, max, min) from a {zones} dict
// Used to derive J-1 reference values matching today's metric computations
function computeKPIs(zonesDict) {
  if (!zonesDict) return null;
  const codes = Object.keys(zonesDict);
  if (codes.length === 0) return null;
  const avgs = codes.map(c => zonesDict[c].avg).filter(v => v != null);
  if (avgs.length === 0) return null;
  const out = {
    avg:    avgs.reduce((a,b) => a+b, 0) / avgs.length,
    maxLvl: Math.max(...avgs),
    minLvl: Math.min(...avgs),
    frPeak: null,
    frOffPeak: null,
  };
  const fr = zonesDict.FR;
  if (fr && fr.hourly && fr.hourly.length >= 24) {
    const h = fr.hourly;
    const nph = Math.round(h.length / 24);
    const peak = [], off = [];
    h.forEach((v, i) => {
      if (v == null) return;
      const hr = Math.floor(i / nph);
      (hr >= 8 && hr < 20 ? peak : off).push(v);
    });
    out.frPeak    = peak.length ? peak.reduce((a,b)=>a+b,0)/peak.length : null;
    out.frOffPeak = off.length  ? off.reduce((a,b)=>a+b,0)/off.length   : null;
  }
  return out;
}

async function loadLastAvailable() {
  if (!DATA_BASE) return;
  for (let i = 1; i <= 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const auctionStr = d.toISOString().slice(0,10);
    try {
      const r = await fetch(DATA_BASE + 'history/daily/' + auctionStr + '.json?t=' + Date.now());
      if (r.ok) {
        const data = await r.json();
        const hasData = Array.isArray(data.zones) ? data.zones.length > 0
          : (data.zones && Object.keys(data.zones).length > 0);
        if (hasData) {
          // Auction date in filename → delivery date = auction + 1
          const deliveryDt = new Date(auctionStr); deliveryDt.setDate(deliveryDt.getDate() + 1);
          const deliveryStr = deliveryDt.toISOString().slice(0,10);
          console.log('Last available delivery:', deliveryStr, '(auction:', auctionStr + ')');
          if (typeof dpSelect === 'function') dpSelect(deliveryStr);
          else loadPricesForDate(auctionStr);
          return;
        }
      }
    } catch(e) {}
  }
}

async function loadFromJSON(opts) {
  opts = opts || {};
  // Prices (skippable: caller may prefer the daily history file for "delivery today")
  if (!opts.skipPrices) {
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
      hourly:  upsampleHourly(z.hourly || []),
    }));
    // Extract date from JSON updated field
    const jsonDate = prices.updated ? prices.updated.slice(0,10) : null;

    // Backfill vsYday synchronously if missing (so the table never shows '–' when J-1 is available)
    if (jsonDate && typeof fetchYesterdayDaily === 'function' && pricesData.some(z => z.vsYday == null)) {
      try {
        const yData = await fetchYesterdayDaily(jsonDate);
        if (yData && yData.zones) {
          pricesData.forEach(z => {
            if (z.vsYday != null) return;
            const y = yData.zones[z.code];
            if (y && y.avg != null && z.today != null) {
              z.vsYday = Math.round((z.today - y.avg) * 100) / 100;
            }
          });
        }
      } catch (e) { console.warn('vsYday backfill (loadFromJSON) failed:', e); }
    }

    renderPricesTable(pricesData, jsonDate);
    updateKPIs(pricesData, jsonDate);
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
  }

  // Genmix
  const genmix = await fetchJSON('genmix.json');
  if (genmix?.countries) {
    window._genmixData = genmix.countries;
    console.log('✅ Genmix from JSON');
    // Re-apply default zone filters now that we know which zones have genmix data
    if (typeof applyDefaultGenMixZones === 'function') applyDefaultGenMixZones();
  }

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
// Load data strategy:
//   ENTSO-E publishes DA prices in the afternoon (~14h CET) for next-day delivery.
//   Convention used by the fetcher: filename = AUCTION date (the day the prices
//   were published), NOT the delivery date.
//   So `yesterday.json` contains prices for delivery TODAY (auction yesterday).
//      `today.json`     contains prices for delivery TOMORROW (auction today,
//                       only available after ~14h CET).
//   Default view = delivery today => load yesterday.json.
(async () => {
  // Load auxiliary JSON (genmix, renewables, load, crossborder) but skip prices
  // — we want the daily history file, not the live snapshot which is one day
  // ahead of what the user expects to see by default.
  await loadFromJSON({ skipPrices: true });

  // Load DA prices for "delivery today" = auction yesterday's history file
  const today = new Date();
  const ySrc  = new Date(today); ySrc.setDate(ySrc.getDate() - 1);
  const auctionDate = ySrc.toISOString().slice(0, 10);
  if (typeof loadPricesForDate === 'function') {
    await loadPricesForDate(auctionDate);
  } else if (!pricesData || pricesData.length === 0) {
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
  // dateStr = the DELIVERY date the user clicked in the calendar.
  // The fetcher's history files are named by AUCTION date = delivery - 1 day.
  const todayStr = new Date().toISOString().slice(0,10);
  const isToday  = dateStr === todayStr;
  DP.selectedDate = isToday ? null : dateStr;

  // Compute auction date = delivery - 1 (used to find the right history file)
  const _dt = new Date(dateStr);
  _dt.setDate(_dt.getDate() - 1);
  const auctionDate = _dt.toISOString().slice(0, 10);

  // Update picker button label — European format DD/MM/YY (delivery date)
  const lbl = document.getElementById('date-picker-label');
  if (lbl) {
    if (isToday) {
      lbl.textContent = 'Today';
    } else {
      const [y,m,d] = dateStr.split('-');
      lbl.textContent = d + '/' + m + '/' + y.slice(2); // DD/MM/YY
    }
  }

  // Update prices-date-label immediately (show DELIVERY date, not auction)
  const fmtLong2 = s => { const [y,m,d]=s.split('-'); return new Date(+y,+m-1,+d).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}); };
  const dateLabel = document.getElementById('prices-date-label');
  if (dateLabel) dateLabel.textContent = 'Day-Ahead prices · ' + fmtLong2(dateStr) + ' · ENTSO-E';

  dpRender();
  loadPricesForDate(auctionDate);
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
// `dateStr` is the AUCTION date (= filename in data/history/daily/),
// per the fetcher's naming convention. The DELIVERY date is auction + 1 day.
async function loadPricesForDate(dateStr) {
  if (!dateStr) { loadPrices(); return; }
  const todayStr = new Date().toISOString().slice(0,10);

  // Compute delivery date (= auction + 1 day)
  const _auctionDt = new Date(dateStr);
  _auctionDt.setDate(_auctionDt.getDate() + 1);
  const deliveryStr = _auctionDt.toISOString().slice(0, 10);

  const updEl = document.getElementById('prices-updated');
  if (updEl) updEl.textContent = 'Loading ' + deliveryStr + '...';

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
            hourly: upsampleHourly(z.hourly || []),
          }));
        } else if (d.zones && typeof d.zones === 'object') {
          // dict format: { FR: { avg, min, max, negH, hourly }, ... }
          mapped = Object.entries(d.zones).map(([code, z]) => {
            const meta   = ZONE_META[code] || {};
            const hourly = upsampleHourly(z.hourly || []);
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
          // Backfill vsYday SYNCHRONOUSLY before first render, so '–' never appears when J-1 data is available
          if (typeof fetchYesterdayDaily === 'function' && mapped.some(z => z.vsYday == null)) {
            try {
              const yData = await fetchYesterdayDaily(dateStr);
              if (yData && yData.zones) {
                mapped.forEach(z => {
                  if (z.vsYday != null) return;
                  const y = yData.zones[z.code];
                  if (y && y.avg != null && z.today != null) {
                    z.vsYday = Math.round((z.today - y.avg) * 100) / 100;
                  }
                });
              }
            } catch (e) { console.warn('vsYday backfill failed:', e); }
          }

          pricesData = mapped.sort((a,b) => b.today - a.today);
          renderPricesTable(pricesData, deliveryStr);
          updateKPIs(pricesData, deliveryStr);
          buildTicker(pricesData);
          if (updEl) updEl.textContent = fmtDate(dateStr) + ' · ENTSO-E historical';

          // Backfill hourlyYday (J-1) for the single-zone chart overlay (async, doesn't block rendering)
          if (typeof fetchHistoricalDaily === 'function') {
            const j1Date = _prevDateISO(dateStr);
            fetchHistoricalDaily(j1Date).then(j1 => {
              if (!j1 || !j1.zones) {
                console.warn('J-1 hourly file not available:', j1Date);
                return;
              }
              let touched = false;
              pricesData.forEach(z => {
                if (j1.zones[z.code] && Array.isArray(j1.zones[z.code].hourly) && j1.zones[z.code].hourly.length) {
                  z.hourlyYday = j1.zones[z.code].hourly;
                  touched = true;
                } else {
                  // Clear stale J-1 data from a previous date
                  delete z.hourlyYday;
                }
              });
              if (touched && typeof rerenderOpenRowDetail === 'function') {
                rerenderOpenRowDetail();
              }
            });
          }
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
// IMPORTANT: this block is loaded AFTER hist.js. Any var declared here that
// shares a name with hist.js will overwrite hist.js. Keep these aligned with
// the Daily palette (libs.js C_* family) so up/down/warn read the same way
// across Daily and Historical charts.
var _HIST_TX3  = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim() || '#7A93AB';
var _HIST_ACC  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#14D3A9';
var _HIST_WARN = '#e8a020';
var _HIST_DN   = '#ED6965';  // aligned with Daily C_DN (brand coral)
var _HIST_UP   = '#14D3A9';  // aligned with Daily C_UP (brand teal)
var _HIST_GRID = 'rgba(255,255,255,0.04)';

// ── Fixed country colours ──
var ZONE_COLORS = {
  'FR':      '#14D3A9',
  'DE_LU':   '#C4A57B',
  'BE':      '#fbbf24',
  'NL':      '#A87DC4',
  'ES':      '#ED6965',
  'PT':      '#fb923c',
  'IT_NORD': '#94D2BD',
  'IT_SICI': '#94D2BD',
  'AT':      '#e879f9',
  'CH':      '#B8C9D9',
  'CZ':      '#f472b6',
  'SK':      '#38bdf8',
  'HU':      '#facc15',
  'RO':      '#4ade80',
  'HR':      '#fb7185',
  'SI':      '#c084fc',
  'GR':      '#2dd4bf',
  'BG':      '#FFFFFF',
  'DK_W':    '#7dd3fc',
  'DK_E':    '#93c5fd',
  'SE':      '#86efac',
  'NO_1':    '#94D2BD',
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
  return ZONE_COLORS[code] || '#B8C9D9';
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
  customRange: null,   // { from, to } if date picker active (overrides window for 'ho')
};
