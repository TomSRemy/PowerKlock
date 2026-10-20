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
// Default zones for the price views. Same 7 zones as the Prices overview
// (HOME_ZONES) — the GenMix list includes GB, which has no ENTSO-E
// day-ahead price since Brexit, so using it here showed "7 zones" over a
// 6-row table.
const PK_DEFAULT_PRICE_ZONES = ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'PT', 'IT_NORD'];

// Feed sanity. A whole delivery day at exactly 0.00 while every coupled
// neighbour averages above 20 €/MWh is a broken ENTSO-E series (seen for
// EE), not a price: such zones are dropped and listed in PK_FEED_ISSUES.
const PK_COUPLED = {
  EE: ['FI', 'LV'], LV: ['EE', 'LT'], LT: ['LV', 'PL'], FI: ['EE', 'SE'], SE: ['FI', 'NO_1'],
  ES: ['PT'], PT: ['ES'], DE_LU: ['NL', 'AT'], NL: ['BE', 'DE_LU'], BE: ['NL', 'FR'], FR: ['BE', 'DE_LU'],
  AT: ['DE_LU', 'CZ'], CZ: ['SK', 'AT'], SK: ['CZ', 'HU'], HU: ['SK', 'RO'], RO: ['HU', 'BG'], BG: ['RO', 'GR'],
  HR: ['SI', 'HU'], SI: ['HR', 'AT'], PL: ['CZ', 'SK'], DK_W: ['DE_LU', 'DK_E'], DK_E: ['DK_W', 'SE'],
};
window.PK_FEED_ISSUES = [];
function pkSanitizeZones(list, dateISO) {
  const avg = c => { const z = list.find(x => x.code === c); return z ? z.today : null; };
  const out = [];
  list.forEach(z => {
    const h = (z.hourly || []).filter(v => v != null);
    const allZero = h.length > 0 && h.every(v => v === 0);
    const nb = (PK_COUPLED[z.code] || []).map(avg).filter(v => v != null);
    if (allZero && nb.length && nb.every(v => v > 20)) {
      window.PK_FEED_ISSUES.push({ code: z.code, date: dateISO, issue: 'all slots 0.00 while coupled zones average ' + nb.map(v => v.toFixed(0)).join(' / ') + ' €/MWh' });
      console.warn('[prices] ' + z.code + ' dropped for ' + dateISO + ': flat 0.00 feed');
      return;
    }
    out.push(z);
  });
  return out;
}
window.pkSanitizeZones = pkSanitizeZones;

// Generation mix of one delivery day from its daily file (realigned to Paris
// by gen-align.js): per zone, MW averaged over the slots where something was
// published. → { zones: {FR: {nuclear, solar, …, total, byCode}}, asOf, slots }
const PK_GEN_AGG = { nuclear: 'nuclear', solar: 'solar', wind: 'wind', hydro: 'hydro', fossil: 'fossil', biomass: 'biomass', other: 'other' };
async function pkGenmixFromDaily(dateISO) {
  const r = await fetch(DATA_BASE + 'history/daily/' + dateISO + '.json?t=' + Date.now());
  let j = r.ok ? await r.json() : null;
  // No file for the day yet: France can still come live from RTE (js/fr-rte.js).
  if (!j && window.pkFrOverlay) { j = await window.pkFrOverlay({ zones: { FR: {} } }, dateISO); if (!j.zones.FR.genSource) return null; }
  if (!j) return null;
  const out = {}; let lastSlot = -1, n = 96;
  Object.entries(j.zones || {}).forEach(([code, z]) => {
    if (!z || !Array.isArray(z.nuclear) && !Array.isArray(z.solar)) return;
    const keys = Object.keys(PK_GEN_AGG).filter(k => Array.isArray(z[k]));
    n = z[keys[0]].length;
    const pub = []; for (let i = 0; i < n; i++) if (keys.some(k => z[k][i] != null)) pub.push(i);
    if (!pub.length) return;
    lastSlot = Math.max(lastSlot, pub[pub.length - 1]);
    // Each series over its own published slots (the first hours come from
    // the previous day's file, which may lack the per-type breakdown).
    const avg = a => { if (!Array.isArray(a)) return 0; const v = pub.map(i => a[i]).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; };
    const m = {};
    keys.forEach(k => { m[PK_GEN_AGG[k]] = Math.round(avg(z[k])); });
    Object.values(PK_GEN_AGG).forEach(k => { if (m[k] == null) m[k] = 0; });
    m.total = Object.values(PK_GEN_AGG).reduce((s, k) => s + m[k], 0);
    const bc = z.byCodeActual || z.byCode;
    if (bc && typeof bc === 'object') {
      // The breakdown can lag the aggregates: slots where every type is 0 are unpublished for it.
      const ser = Object.values(bc).filter(a => Array.isArray(a) && a.length === n);
      const bpub = pub.filter(i => ser.some(a => a[i]));
      const bavg = a => { const v = bpub.map(i => a[i]).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; };
      m.byCode = {}; Object.entries(bc).forEach(([c, a]) => { m.byCode[c] = Array.isArray(a) ? Math.round(bavg(a)) : 0; });
    }
    m.publishedSlots = pub.length;
    if (m.total > 0) out[code] = m;
  });
  if (!Object.keys(out).length) return null;
  // asOf = end of the last published slot, Paris clock, as an ISO instant.
  const off = window.pkGenAlign ? pkGenAlign.parisOffset(dateISO) : 2;
  const asOf = new Date(Date.parse(dateISO + 'T00:00:00Z') - off * 3600e3 + (lastSlot + 1) * 86400e3 / n).toISOString();
  return { zones: out, asOf, slots: n };
}
window.pkGenmixFromDaily = pkGenmixFromDaily;
window.PK_DEFAULT_PRICE_ZONES = PK_DEFAULT_PRICE_ZONES;

function applyDefaultGenMixZones() {
  const zones = getGenMixDefaultZones();
  const set = new Set(zones);
  // Daily Prices table filter
  window._pricesZoneFilter = new Set(PK_DEFAULT_PRICE_ZONES);
  // Daily Compare + Historical shared user zones (via setUserZones if available,
  // else direct mutation)
  // Shared price-view zones (Compare / Historical): same 7 as the board.
  if (typeof setUserZones === 'function') {
    setUserZones(PK_DEFAULT_PRICE_ZONES);  // also dispatches 'zones-changed'
  } else {
    window._userZones = new Set(PK_DEFAULT_PRICE_ZONES);
    window._compareZones = window._userZones;
  }
  // Re-render daily tables and chips if those renderers exist
  if (typeof renderPricesTableBody === 'function') renderPricesTableBody();
  if (typeof buildZoneFilterDropdown === 'function') buildZoneFilterDropdown();
  if (typeof renderCompareChart === 'function')   renderCompareChart();
  if (typeof buildCompareChips === 'function')    buildCompareChips();
  // Update button labels
  const n = PK_DEFAULT_PRICE_ZONES.length;
  const labelText = `${n} zones`;
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
  // Same completeness bar as loadPricesForDate's MIN_VALID_ZONES — a file with
  // a handful of zones (e.g. a missed-cron day that still wrote a partial
  // snapshot) must not be accepted as "the last available day" just because
  // it's non-empty; keep walking back to a genuinely complete one.
  // Files are named by DELIVERY date (see loadPricesForDate).
  const MIN_VALID_ZONES = 20;
  let dateISO = pkTodayISO();
  for (let i = 0; i <= 14; i++, dateISO = _prevDateISO(dateISO)) {
    try {
      const r = await fetch(DATA_BASE + 'history/daily/' + dateISO + '.json?t=' + Date.now());
      if (r.ok) {
        const data = await r.json();
        const zoneCount = Array.isArray(data.zones) ? data.zones.length
          : (data.zones ? Object.keys(data.zones).length : 0);
        if (zoneCount >= MIN_VALID_ZONES) {
          console.log('Last available delivery day:', dateISO);
          if (typeof dpSelect === 'function') dpSelect(dateISO);
          else loadPricesForDate(dateISO);
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
    pricesData = pkSanitizeZones(pricesData, jsonDate);
    // Clean spark from the real TTF / EUA closes (prices.json carries a fixed-fuel placeholder)
    if (window.PKC) {
      await PKC.ready;
      const refs = PKC.refsFor(jsonDate || pkTodayISO());
      pricesData.forEach(z => { const v = PKC.cleanSpark(z.today, refs.ttf, refs.eua); z.spark = v == null ? null : Math.round(v * 100) / 100; });
    }

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
      ? new Date(prices.updated).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ' UTC'
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
    // Drop zones with no generation reported (GB: ENTSO-E stopped publishing
    // after Brexit) so counts/KPIs match the table.
    window._genmixData = Object.fromEntries(Object.entries(genmix.countries).filter(([, m]) => m && m.total > 0));
    window._genmixUpdated = genmix.updated || null;
    // Same day's 15-min arrays (Paris-aligned): averages over the published
    // slots, consistent with the profile charts. Replaces the fetch-time
    // snapshot, which could be built from a partly published last slot.
    try {
      const day = await pkGenmixFromDaily(pkTodayISO());
      if (day) {
        Object.assign(window._genmixData, day.zones);
        window._genmixUpdated = day.asOf;
        window._genmixSlots = day.slots;
      }
    } catch (e) { console.warn('genmix from daily file failed', e); }
    console.log('✅ Genmix from JSON');
    // Re-apply default zone filters now that we know which zones have genmix data
    if (typeof applyDefaultGenMixZones === 'function') applyDefaultGenMixZones();
  }

  // Renewables
  const ren = await fetchJSON('renewables.json');
  if (ren?.countries && window.pkGenAlign) await pkGenAlign.alignSnapshot(ren, 'ren');
  if (ren?.countries) {
    window._renData = ren.countries;
    window._renUpdated = ren.updated || null;
    console.log('✅ Renewables from JSON');
    if (document.getElementById('page-renewables')?.classList.contains('active')) drawRenChart();
  }

  // Load
  const load = await fetchJSON('load.json');
  if (load?.countries && window.pkGenAlign) await pkGenAlign.alignSnapshot(load, 'load');
  if (load?.countries) { window._loadData = load.countries; window._loadDataUpdated = load.updated || null; console.log('✅ Load from JSON'); }

  // Cross-border
  const cb = await fetchJSON('crossborder.json');
  if (cb?.countries) { window._cbData = cb.countries; window._cbUpdated = cb.updated || null; console.log('✅ Cross-border from JSON'); }

  // My Dashboard's widgets read pricesData/_genmixData/_loadData/_cbData
  // directly — refresh it if the user has it open, same as the map refresh
  // above.
  if (window.PKDash) PKDash.refresh();
}

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
updateConverter();
updateCapacity();
// Load data strategy:
//   data/history/daily/<D>.json holds the day-ahead prices for DELIVERY day D
//   (fetch_data.py requests [D 00:00, D+1 00:00) and keeps the CET/CEST
//   delivery day with the largest overlap). Default view = delivery today
//   (Europe/Paris calendar day). If today's file isn't written yet (the
//   first fetch of the day runs at 05:00 UTC), fall back to the most recent
//   complete day — labelled with ITS date, never relabelled as today.
(async () => {
  // Load auxiliary JSON (genmix, renewables, load, crossborder) but skip
  // prices.json — the daily history file is the single source for prices so
  // every page shows the same numbers.
  await loadFromJSON({ skipPrices: true });

  if (typeof loadPricesForDate === 'function') {
    await loadPricesForDate(pkTodayISO());
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
  const key = pkTodayISO();
  const maxNeg = Math.max(...zonesData.map(z => z.negHours || 0));
  if (maxNeg > 0) {
    DP.negDays[key] = maxNeg;
    localStorage.setItem('pk-neg-days', JSON.stringify(DP.negDays));
  }
}

// Load historical neg hours from summary.json for red dots
async function dpLoadHistoryNegDays() {
  try {
    const s = await window.pkSummary();
    if (!s) return;
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
// Loaded the first time the date picker opens (the history is large: not at start-up)
let _dpNegLoaded = false;

function toggleDatePicker() {
  const btn = document.getElementById('date-picker-btn');
  const popup = document.getElementById('date-picker-popup');
  btn.classList.toggle('open');
  popup.classList.toggle('open');
  if (popup.classList.contains('open')) { dpRender(); if (!_dpNegLoaded) { _dpNegLoaded = true; dpLoadHistoryNegDays().then(() => { if (popup.classList.contains('open')) dpRender(); }); } }
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

  const todayStr = pkTodayISO();
  const selStr = DP.selectedDate || todayStr;

  let html = '';
  // Empty cells
  for (let i = 0; i < offset; i++) html += '<div class="dp-day dp-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday  = dateStr === todayStr;
    const isSel    = dateStr === selStr;
    // Tomorrow is selectable once its auction file exists (see PK_TOMORROW).
    const isFuture = dateStr > todayStr && !(window.PK_TOMORROW && dateStr === window.PK_TOMORROW);
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
  // dateStr = the DELIVERY date the user clicked in the calendar, which is
  // also the history file name (files are named by delivery date).
  const todayStr = pkTodayISO();
  const isToday  = dateStr === todayStr;
  DP.selectedDate = isToday ? null : dateStr;

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
  loadPricesForDate(dateStr);
  document.getElementById('date-picker-btn')?.classList.remove('open');
  document.getElementById('date-picker-popup')?.classList.remove('open');
}
function dpSelectTomorrow() {
  if (window.PK_TOMORROW) dpSelect(window.PK_TOMORROW);
}
// Probe the next delivery day's file (written after the day-ahead auction).
(function probeTomorrow() {
  const tomorrow = (() => { const [y, m, d] = pkTodayISO().split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); })();
  setTimeout(() => {
    fetch(DATA_BASE + 'history/daily/' + tomorrow + '.json?t=' + Date.now(), { method: 'GET' }).then(r => {
      if (!r.ok) return;
      window.PK_TOMORROW = tomorrow;
      const b = document.getElementById('btn-tomorrow-hdr');
      if (b) { b.style.display = 'inline-flex'; b.textContent = 'Tomorrow · ' + tomorrow.slice(8, 10) + '/' + tomorrow.slice(5, 7); }
      if (typeof dpRender === 'function') dpRender();
    }).catch(() => {});
  }, 3000);
})();

function dpSelectToday() {
  dpSelect(pkTodayISO());
}

function dpChangeMonth(dir) {
  DP.viewMonth += dir;
  if (DP.viewMonth > 11) { DP.viewMonth = 0; DP.viewYear++; }
  if (DP.viewMonth < 0)  { DP.viewMonth = 11; DP.viewYear--; }
  dpRender();
}

// ── Load prices for a specific date ──
// `dateStr` is the DELIVERY date, which is also the file name in
// data/history/daily/ (fetch_data.py writes delivery day D to D.json).
async function loadPricesForDate(dateStr) {
  if (!dateStr) { loadPrices(); return; }
  const todayStr = pkTodayISO();
  const deliveryStr = dateStr;

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
              // Keep 2 decimals (the source precision): rounding to 1dp
              // here made KPIs disagree with values recomputed from the
              // 15-min slots elsewhere (e.g. 191.60 vs 191.64).
              today:  Math.round(avg * 100) / 100,
              vsYday: null,
              min:    Math.round(mn * 100) / 100,
              minHr:  minIdx >= 0 ? Math.floor(minIdx/nph) : 0,
              max:    Math.round(mx * 100) / 100,
              maxHr:  maxIdx >= 0 ? Math.floor(maxIdx/nph) : 0,
              negHrs: z.negH ?? z.negHours ?? 0,
              spark:  null,
              // Generation-based fields of the day (zones covered by the GenMix fetch)
              renPct: z.renPct ?? null,
              domFuel: z.domFuel ?? null,
              hourly,
            };
          });
        }

        // Reject obviously corrupt/partial files (e.g. fetch_data.py crashed mid-run,
        // or a scheduled run was missed and this file is a stale partial from a prior
        // failure). Real daily data has ~27-30 zones out of 30 possible. 10 let through
        // a real 13-zone incident (2026-10-15: most of Western Europe, including France,
        // silently missing) that still rendered a "complete-looking" table/map — so the
        // threshold needs to sit above what a genuine partial outage ever produces.
        const MIN_VALID_ZONES = 20;
        if (mapped.length > 0 && mapped.length < MIN_VALID_ZONES) {
          console.warn(`Daily file for ${dateStr} has only ${mapped.length} zones — treating as corrupt, falling back.`);
          mapped = [];
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

          // Clean spark spread per zone from the day's TTF / EUA (commodities.js)
          if (window.PKC) {
            await PKC.ready;
            const refs = PKC.refsFor(deliveryStr);
            mapped.forEach(z => { const v = PKC.cleanSpark(z.today, refs.ttf, refs.eua); z.spark = v == null ? null : Math.round(v * 100) / 100; });
          }
          pricesData = pkSanitizeZones(mapped, deliveryStr).sort((a,b) => b.today - a.today);
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
  daily: {},           // 'YYYY-MM-DD' → daily file (or null if missing), cache for fetchDailyRange
  windows: {},         // current window per chart key
  charts: {},          // Chart.js instances
  customRange: null,   // { from, to } if date picker active (overrides window for 'ho')
};
