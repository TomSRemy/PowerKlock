// ════════════════════════════════════════════════════════════════
// GENERATION MIX V2 · module complet
// 4 blocks: Live snapshot · Single zone deep-dive · Compare zones · Historical
// Inspired by Prices/Historical structure for consistency
// ════════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────────
const GM = {
  singleZone:  'FR',
  singleTab:   'donut',
  histZone:    'FR',
  histWindow:  '1M',
  openZone:    null,
};
window.GM = GM;

// Fuel meta — aligned with Daily DA and Historical
const GM_FUEL_META = {
  nuclear: { emoji: '⚛', label: 'Nuclear',  color: '#7B4B9C', co2: 12   },
  wind:    { emoji: '⌬', label: 'Wind',     color: '#14D3A9', co2: 11   },
  solar:   { emoji: '☀', label: 'Solar',    color: '#FBBF24', co2: 45   },
  hydro:   { emoji: '💧', label: 'Hydro',    color: '#3FA6B4', co2: 24   },
  biomass: { emoji: '🌿', label: 'Biomass',  color: '#94D2BD', co2: 230  },
  fossil:  { emoji: '🔥', label: 'Fossil',   color: '#ED6965', co2: 820  }, // gas+coal mix
  other:   { emoji: '◇', label: 'Other',    color: '#7A93AB', co2: 400  },
};

const GM_FUEL_ORDER = ['nuclear', 'wind', 'solar', 'hydro', 'biomass', 'fossil', 'other'];

// ════════════════════════════════════════════════════════════════
// Stored-archive loaders (single source of truth = data/history/*)
// Shared by Stack, Profile (daily 15-min), and Historical aggregation.
// ════════════════════════════════════════════════════════════════
const GM_STACK_FUELS = ['nuclear', 'hydro', 'biomass', 'wind', 'solar', 'fossil', 'other'];

// ── Zoom norm (drag XY rectangle + ↺ reset + dblclick reset; no wheel/pan) ──
const GM_ZOOM_OPTS = {
  zoom: { drag: { enabled: true, backgroundColor: 'rgba(20,211,169,0.15)', borderColor: '#14D3A9', borderWidth: 1 }, wheel: { enabled: false }, pinch: { enabled: false }, mode: 'xy' },
};
function _gmZoomify(chart, canvasId) {
  const c = document.getElementById(canvasId);
  if (!c || !chart) return;
  c.ondblclick = () => { try { chart.resetZoom(); } catch (_) {} };
  const wrap = c.parentElement;
  if (wrap && !wrap.querySelector('.gm-zoom-reset')) {
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    const btn = document.createElement('button');
    btn.className = 'gm-zoom-reset';
    btn.textContent = '↺'; btn.title = 'Reset zoom (double-clic)';
    btn.style.cssText = 'position:absolute;top:4px;right:4px;z-index:5;width:24px;height:24px;border:1px solid var(--bd);background:var(--bg);color:var(--tx2);border-radius:4px;cursor:pointer;font-size:13px;line-height:1;font-family:inherit';
    btn.onclick = () => { try { chart.resetZoom(); } catch (_) {} };
    wrap.appendChild(btn);
  }
}
function _gmFmtDate(d) { return d.toISOString().slice(0, 10); }
async function _gmFetchDaily(ds) {
  try { const r = await fetch(`data/history/daily/${ds}.json`); if (!r.ok) return null; return await r.json(); }
  catch (_) { return null; }
}
function _gmHasArrays(zd) {
  return zd && ['nuclear', 'hydro', 'fossil'].some(k => Array.isArray(zd[k]) && zd[k].some(v => v));
}
// Resolve a real stored day for a zone: the requested date if it has arrays,
// else walk back up to 8 days. Returns { ds, zd } or null.
async function _gmResolveDay(zone, dateStr) {
  if (dateStr) {
    const j = await _gmFetchDaily(dateStr);
    if (j && j.zones && _gmHasArrays(j.zones[zone])) return { ds: dateStr, zd: j.zones[zone] };
  }
  const t = new Date();
  for (let i = 0; i < 8; i++) {
    const dt = new Date(t); dt.setDate(dt.getDate() - i);
    const ds = _gmFmtDate(dt);
    const j = await _gmFetchDaily(ds);
    if (j && j.zones && _gmHasArrays(j.zones[zone])) return { ds, zd: j.zones[zone] };
  }
  return null;
}
// Per-fuel 96-slot arrays (0-filled) for a resolved zone-day.
function _gmDayArrays(zd) {
  const N = Math.max.apply(null, GM_STACK_FUELS.map(f => (Array.isArray(zd[f]) ? zd[f].length : 0)).concat([96]));
  const DATA = {};
  GM_STACK_FUELS.forEach(f => {
    const a = Array.isArray(zd[f]) ? zd[f] : [];
    DATA[f] = new Array(N).fill(0).map((_, i) => (a[i] == null ? 0 : a[i]));
  });
  return { DATA, N };
}

// Per-slot envelope of TOTAL generation (GW) over the last nDays stored days.
// Returns { p0, p5, p50, p95, p100, n } each length N. Cached by zone|nDays|N.
async function _gmFetchGenEnvelope(zone, nDays, N) {
  const key = `${zone}|${nDays}|${N}`;
  window._gmGenEnvCache = window._gmGenEnvCache || {};
  if (window._gmGenEnvCache[key]) return window._gmGenEnvCache[key];

  const today = new Date();
  const dates = [];
  for (let i = 1; i <= nDays; i++) { const d = new Date(today); d.setDate(d.getDate() - i); dates.push(_gmFmtDate(d)); }

  const rows = []; // each = N-length total-GW array
  await Promise.all(dates.map(async (dt) => {
    const j = await _gmFetchDaily(dt);
    const zd = j && j.zones && j.zones[zone];
    if (!zd || !_gmHasArrays(zd)) return;
    const { DATA, N: dn } = _gmDayArrays(zd);
    const tot = new Array(dn).fill(0).map((_, i) => GM_STACK_FUELS.reduce((s, f) => s + DATA[f][i], 0) / 1000);
    // resample dn → N
    rows.push(new Array(N).fill(0).map((_, i) => tot[Math.min(dn - 1, Math.round(i / (N - 1) * (dn - 1)))]));
  }));
  if (!rows.length) return null;

  const pct = (sorted, q) => {
    if (sorted.length === 1) return sorted[0];
    const idx = q * (sorted.length - 1), lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  const p0 = [], p5 = [], p50 = [], p95 = [], p100 = [];
  for (let i = 0; i < N; i++) {
    const vals = rows.map(r => r[i]).filter(v => v != null).sort((a, b) => a - b);
    if (!vals.length) { [p0, p5, p50, p95, p100].forEach(a => a.push(null)); continue; }
    p0.push(vals[0]); p5.push(pct(vals, 0.05)); p50.push(pct(vals, 0.5)); p95.push(pct(vals, 0.95)); p100.push(vals[vals.length - 1]);
  }
  const res = { p0, p5, p50, p95, p100, n: rows.length };
  window._gmGenEnvCache[key] = res;
  return res;
}


const GM_ZONE_NAMES = {
  FR:'France', DE_LU:'Germany', ES:'Spain', BE:'Belgium',
  NL:'Netherlands', PT:'Portugal', GB:'Great Britain', IT_NORD:'Italy North',
};

// ── Compute stats for a zone snapshot (from _genmixData) ────────
function _gmStats(mix) {
  if (!mix || !mix.total) return null;
  const total = mix.total;
  const ren     = (mix.wind || 0) + (mix.solar || 0) + (mix.hydro || 0) + (mix.biomass || 0);
  const nuc     = mix.nuclear || 0;
  const fos     = mix.fossil || 0;
  const lowC    = ren + nuc;
  const renPct  = ren / total * 100;
  const lowCPct = lowC / total * 100;
  const fosPct  = fos / total * 100;
  // CO2 intensity proxy (g CO2eq / kWh) — weighted average by share
  let co2 = 0;
  GM_FUEL_ORDER.forEach(k => {
    const v = mix[k] || 0;
    co2 += (v / total) * (GM_FUEL_META[k]?.co2 || 0);
  });
  // Dominant fuel
  const dom = GM_FUEL_ORDER.reduce((best, k) =>
    (mix[k] || 0) > (mix[best] || 0) ? k : best, GM_FUEL_ORDER[0]);
  return { total, ren, nuc, fos, lowC, renPct, lowCPct, fosPct, co2, dom };
}

// ── Color helpers ───────────────────────────────────────────────
function _gmRenColor(pct) {
  if (pct >= 60) return '#14D3A9';
  if (pct >= 40) return '#FBBF24';
  return '#ED6965';
}
function _gmCo2Color(g) {
  if (g < 50)  return '#14D3A9';
  if (g < 150) return '#FBBF24';
  if (g < 400) return '#F97316';
  return '#ED6965';
}

// ────────────────────────────────────────────────────────────────
// MARKET READ BANNER (amber, mirrors Prices / Historical pattern)
// Usage: _gmBuildMarketBanner({ line1: 'observation', verdict: 'interpretation' })
// ────────────────────────────────────────────────────────────────
function _gmBuildMarketBanner({ line1, verdict, icon }) {
  if (!line1) return '';
  const ICO = icon || '◈';
  const verdictHtml = verdict
    ? `<span style="display:block;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(251,191,36,0.22);font-style:italic;color:rgba(255,255,255,0.82)">Market read : ${verdict}</span>`
    : '';
  return `<div class="ho-analyst-banner" style="margin-top:14px;padding:11px 14px;font-size:11.5px;border-radius:3px;color:#FBBF24;background:rgba(251,191,36,0.08);border-left:3px solid #FBBF24;line-height:1.6">
    <span style="margin-right:8px">${ICO}</span>${line1}${verdictHtml}
  </div>`;
}
window._gmBuildMarketBanner = _gmBuildMarketBanner;

// ────────────────────────────────────────────────────────────────
// MARKET READ generator · multi-zone snapshot (Genmix Daily Board)
// ────────────────────────────────────────────────────────────────
function _gmBuildMainBannerHtml() {
  const data = window._genmixData || {};
  const zones = Object.keys(data).filter(z => data[z]?.total > 0);
  if (!zones.length) return '';

  const rows = zones.map(z => {
    const st = _gmStats(data[z]);
    return st ? { z, ...st } : null;
  }).filter(Boolean);
  if (!rows.length) return '';

  const topRen = [...rows].sort((a, b) => b.renPct - a.renPct)[0];
  const cleanCo2 = [...rows].sort((a, b) => a.co2 - b.co2)[0];
  const fr = rows.find(r => r.z === 'FR');

  const renAvg = rows.reduce((s, r) => s + r.renPct, 0) / rows.length;
  const co2Avg = rows.reduce((s, r) => s + r.co2, 0) / rows.length;

  // Line 1 : facts
  const line1 = `Cleanest grid today: <strong style="color:#fff">${cleanCo2.z}</strong> (${cleanCo2.co2.toFixed(0)} g/kWh). Top renewable: <strong style="color:#fff">${topRen.z}</strong> (${topRen.renPct.toFixed(0)}%, ${(GM_FUEL_META[topRen.dom]?.label || topRen.dom).toLowerCase()}-led). EU avg ${renAvg.toFixed(0)}% REN · ${co2Avg.toFixed(0)} g/kWh.`;

  // Verdict : FR positioning vs EU
  let verdict = '';
  if (fr) {
    const frVsEu = fr.renPct - renAvg;
    const frVsCo2 = fr.co2 - co2Avg;
    const renSign = frVsEu >= 0 ? '+' : '';
    const co2Sign = frVsCo2 >= 0 ? '+' : '';
    if (frVsCo2 < -50) {
      verdict = `FR runs ${Math.abs(frVsCo2).toFixed(0)} g/kWh below the EU mean (${renSign}${frVsEu.toFixed(0)}pts REN), keeping its low-carbon edge through nuclear baseload.`;
    } else if (frVsCo2 < 0) {
      verdict = `FR slightly below EU mean (${co2Sign}${frVsCo2.toFixed(0)} g/kWh, ${renSign}${frVsEu.toFixed(0)}pts REN). Steady low-carbon footprint.`;
    } else {
      verdict = `FR runs +${frVsCo2.toFixed(0)} g/kWh above the EU mean (${renSign}${frVsEu.toFixed(0)}pts REN). Watch the fossil component today.`;
    }
  }

  return _gmBuildMarketBanner({ line1, verdict });
}
window._gmBuildMainBannerHtml = _gmBuildMainBannerHtml;

// ════════════════════════════════════════════════════════════════
// BLOCK 1 · Multi-zone live snapshot table
// ════════════════════════════════════════════════════════════════
function renderGmMain() {
  const data = window._genmixData;
  if (!data || !Object.keys(data).length) {
    const tbody = document.getElementById('gm-table-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--tx3);padding:20px;font-size:11px">No GenMix data loaded — check genmix.json</td></tr>';
    return;
  }

  // Sort zones by total generation (desc)
  const zones = Object.keys(data)
    .filter(z => data[z]?.total > 0)
    .sort((a, b) => (data[b].total || 0) - (data[a].total || 0));

  // ── KPI strip ──
  const fr  = data['FR'] ? _gmStats(data['FR']) : null;
  if (fr) {
    _setText('gm-kpi-fr-total', (fr.total / 1000).toFixed(2), 'GW');
    const renEl = document.getElementById('gm-kpi-fr-ren');
    if (renEl) {
      const c = _gmRenColor(fr.renPct);
      renEl.innerHTML = `<span style="color:${c}">${fr.renPct.toFixed(1)}</span><span class="kpi-unit">%</span>`;
    }
    const co2El = document.getElementById('gm-kpi-fr-co2');
    if (co2El) {
      const c = _gmCo2Color(fr.co2);
      co2El.innerHTML = `<span style="color:${c}">${Math.round(fr.co2)}</span><span class="kpi-unit">g/kWh</span>`;
    }
  }

  // EU-loaded aggregated stats (weighted avg)
  const allStats = zones.map(z => _gmStats(data[z])).filter(s => s);
  const euTotal = allStats.reduce((a, s) => a + s.total, 0);
  const euRen   = allStats.reduce((a, s) => a + s.ren, 0);
  const euCo2W  = allStats.reduce((a, s) => a + (s.co2 * s.total), 0);
  const euRenPct = euTotal > 0 ? (euRen / euTotal * 100) : 0;
  const euCo2Avg = euTotal > 0 ? (euCo2W / euTotal)       : 0;
  _setText('gm-kpi-eu-total', (euTotal / 1000).toFixed(2), 'GW');
  const euRenEl = document.getElementById('gm-kpi-eu-ren');
  if (euRenEl) {
    const c = _gmRenColor(euRenPct);
    euRenEl.innerHTML = `<span style="color:${c}">${euRenPct.toFixed(1)}</span><span class="kpi-unit">%</span>`;
  }
  const euCo2El = document.getElementById('gm-kpi-eu-co2');
  if (euCo2El) {
    const c = _gmCo2Color(euCo2Avg);
    euCo2El.innerHTML = `<span style="color:${c}">${Math.round(euCo2Avg)}</span><span class="kpi-unit">g/kWh</span>`;
  }
  _setText('gm-kpi-eu-total-meta', `${zones.length} zones`);
  _setText('gm-kpi-eu-ren-meta', `avg across ${zones.length} zones`);

  // ── Table rows ──
  const tbody = document.getElementById('gm-table-tbody');
  if (!tbody) return;

  const fmt = (v, dp=2) => (v == null || isNaN(v)) ? '--' : v.toFixed(dp);
  const flagOf = z => (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
  const nameOf = z => GM_ZONE_NAMES[z] || z;

  const rowsHtml = zones.map(z => {
    const mix = data[z];
    const st  = _gmStats(mix);
    if (!st) return '';
    const renC  = _gmRenColor(st.renPct);
    const co2C  = _gmCo2Color(st.co2);
    const dom   = GM_FUEL_META[st.dom] || GM_FUEL_META.other;
    return `<tr class="gm-row" data-zone="${z}" style="cursor:pointer">
      <td style="text-align:left">${flagOf(z)} ${z}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600">${fmt(st.total / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${renC};font-weight:600">${fmt(st.renPct, 1)}%</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt((mix.wind || 0) / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt((mix.solar || 0) / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt((mix.nuclear || 0) / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt((mix.hydro || 0) / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${st.fosPct > 30 ? '#ED6965' : 'var(--tx2)'}">${fmt((mix.fossil || 0) / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace"><span style="color:${dom.color};font-size:11px">${dom.emoji} ${dom.label}</span></td>
      <td style="text-align:center;font-family:'JetBrains Mono',monospace;color:${co2C};font-weight:600">${Math.round(st.co2)}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rowsHtml;

  // Header date hint (mirrors pr-daily-board-meta in Prices Day-Ahead)
  const hdrDate = document.getElementById('gm-main-header-date');
  if (hdrDate) {
    hdrDate.textContent = new Date().toLocaleDateString('en-GB', {
      weekday:'short', day:'2-digit', month:'short', year:'numeric',
    }) + ' · ENTSO-E';
  }

  // Table-header label (mirrors prices-date-label in Day-Ahead table-header)
  const tbLabel = document.getElementById('gm-table-label');
  if (tbLabel) {
    const zonesCount = Object.keys(window._genmixData || {}).length;
    tbLabel.textContent = `Live generation mix · ${zonesCount} zones · ENTSO-E A75`;
  }

  // NOTE · template decision (mirrors Prices Day-Ahead Board):
  // No "Market read" banner under the main multi-zone table.
  // The amber banner pattern lives inside drill rows (per-zone) and Cross-zone
  // analysis (per-view) only. Keeps the main board a pure snapshot.

  // Click handlers for expand
  tbody.querySelectorAll('.gm-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const z = tr.getAttribute('data-zone');
      _gmToggleRow(z);
    });
  });

  // Re-apply open state
  if (GM.openZone && data[GM.openZone]) {
    _gmOpenRow(GM.openZone);
  }
}

function _setText(id, val, unit) {
  const el = document.getElementById(id);
  if (!el) return;
  if (unit !== undefined) {
    el.innerHTML = `${val}<span class="kpi-unit">${unit}</span>`;
  } else {
    el.textContent = val;
  }
}

// ── Toggle / Open / Close detail row ─────────────────────
function _gmToggleRow(zone) {
  if (GM.openZone === zone) { _gmCloseRow(); return; }
  if (GM.openZone)          { _gmCloseRow(); }
  _gmOpenRow(zone);
}

function _gmCloseRow() {
  const existing = document.getElementById('gm-detail-row');
  if (existing) existing.remove();
  document.querySelectorAll('#gm-table-tbody tr.gm-row').forEach(r => r.classList.remove('is-open'));
  if (window._GM_DONUT_CHART) {
    try { window._GM_DONUT_CHART.destroy(); } catch (_) {}
    window._GM_DONUT_CHART = null;
  }
  if (window._GM_BAR_CHART) {
    try { window._GM_BAR_CHART.destroy(); } catch (_) {}
    window._GM_BAR_CHART = null;
  }
  GM.openZone = null;
}
window._gmCloseRow = _gmCloseRow;
window._gmToggleRow = _gmToggleRow;

function _gmOpenRow(zone) {
  const data = window._genmixData;
  if (!data?.[zone]) return;
  const mix = data[zone];
  const st  = _gmStats(mix);
  if (!st) return;

  const tbody = document.getElementById('gm-table-tbody');
  const row   = tbody.querySelector(`tr.gm-row[data-zone="${zone}"]`);
  if (!row) return;
  row.classList.add('is-open');
  GM.openZone = zone;

  const country = GM_ZONE_NAMES[zone] || zone;
  const flag    = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[zone]) || '';
  const renC    = _gmRenColor(st.renPct);
  const co2C    = _gmCo2Color(st.co2);

  // Default drill sub-tab
  window._gmDrillTab = window._gmDrillTab || 'profile';

  const detail = document.createElement('tr');
  detail.id = 'gm-detail-row';
  detail.innerHTML = `
    <td colspan="10" style="padding:0;background:#141a22;border-bottom:2px solid var(--bd2)">
      <div id="gm-detail-inner" style="padding:14px 16px">

        <!-- Drill header (pk-section-* pattern, mirrors Day-Ahead / Historical drill) -->
        <div class="pk-section-header">
          <div class="pk-section-header-text">
            <div class="pk-eyebrow">
              Genmix Daily <span class="pk-sep">·</span> ${flag} ${zone} <span class="pk-sep">·</span> Single-zone detail
            </div>
            <div class="pk-section-title">${country}</div>
            <div class="pk-section-subtitle" id="gm-drill-subtitle">live snapshot · ${(st.total/1000).toFixed(2)} GW total · ENTSO-E</div>
          </div>
          <div class="pk-section-header-actions">
            <button class="pk-btn-primary" onclick="event.stopPropagation();_gmOpenFullscreen('${zone}')" title="Open in fullscreen">⛶ Fullscreen</button>
            <button class="pk-btn-ghost" onclick="event.stopPropagation();_gmCloseRow()" title="Close detail">✕ Close</button>
          </div>
        </div>

        <!-- KPI strip 6 cards · zone-specific · BESS / origination POV
             (Total · %REN · Wind · Solar · Fossil · CO₂) -->
        <div class="kpi-strip" id="gm-drill-kpi-strip" style="grid-template-columns:repeat(6,1fr);margin-bottom:14px;margin-top:14px">
          <div class="kpi-card kpi-flat">
            <div class="kpi-label">Total gen</div>
            <div class="kpi-value">${(st.total/1000).toFixed(2)}<span class="kpi-unit">GW</span></div>
            <div class="kpi-meta">${(st.total).toFixed(0)} MW · instantaneous</div>
          </div>
          <div class="kpi-card" style="border-left-color:${renC}">
            <div class="kpi-label">% Renewable</div>
            <div class="kpi-value" style="color:${renC}">${st.renPct.toFixed(1)}<span class="kpi-unit">%</span></div>
            <div class="kpi-meta">W+S+H+B share</div>
          </div>
          <div class="kpi-card" style="border-left-color:#14D3A9">
            <div class="kpi-label">Wind</div>
            <div class="kpi-value">${((mix.wind||0)/1000).toFixed(2)}<span class="kpi-unit">GW</span></div>
            <div class="kpi-meta">${(((mix.wind||0)/st.total)*100).toFixed(1)}% share</div>
          </div>
          <div class="kpi-card" style="border-left-color:#FBBF24">
            <div class="kpi-label">Solar</div>
            <div class="kpi-value">${((mix.solar||0)/1000).toFixed(2)}<span class="kpi-unit">GW</span></div>
            <div class="kpi-meta">${(((mix.solar||0)/st.total)*100).toFixed(1)}% share</div>
          </div>
          <div class="kpi-card" style="border-left-color:#ED6965">
            <div class="kpi-label">Fossil</div>
            <div class="kpi-value" style="color:${st.fosPct > 30 ? '#ED6965' : 'var(--tx)'}">${((mix.fossil||0)/1000).toFixed(2)}<span class="kpi-unit">GW</span></div>
            <div class="kpi-meta">${st.fosPct.toFixed(1)}% share</div>
          </div>
          <div class="kpi-card" style="border-left-color:${co2C}">
            <div class="kpi-label">CO₂ intensity</div>
            <div class="kpi-value" style="color:${co2C}">${Math.round(st.co2)}<span class="kpi-unit">g/kWh</span></div>
            <div class="kpi-meta">proxy from mix</div>
          </div>
        </div>

        <!-- Tabbar with 4 sub-tabs (pk-tabbar template, same as CC/HMZ/HO) -->
        <div class="pk-tabbar" id="gm-drill-tabs-bar">
          <div class="pk-tabbar-left">
            <div id="gm-drill-tabs" class="pk-tabbar-tabs"></div>
            <div id="gm-drill-sub-toggle" class="pk-tabbar-subtoggle"></div>
          </div>
          <div class="pk-tabbar-right">
            <div id="gm-drill-tab-chips" class="pk-tabbar-chips"></div>
            <button onclick="gmDrillFullscreen('daily')" title="Plein écran" style="display:inline-flex;align-items:center;gap:5px;margin-left:8px;background:var(--bg);border:1px solid var(--bd);color:var(--tx2);font-size:11px;padding:3px 9px;border-radius:4px;cursor:pointer;font-family:inherit">⛶ Fullscreen</button>
          </div>
        </div>

        <!-- Tab eyebrow + title (below tabbar, CC pattern) -->
        <div style="margin:8px 0 10px">
          <div id="gm-drill-tab-eyebrow" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:#14D3A9;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px"></div>
          <div id="gm-drill-tab-title" style="font-family:'Inter',sans-serif;font-size:14px;font-weight:600;color:var(--tx);letter-spacing:-0.01em;line-height:1.2"></div>
        </div>

        <!-- Content (rendered per active tab) -->
        <div id="gm-drill-content" style="min-height:320px;margin-bottom:14px"></div>

        <!-- Market read banner (amber, mirrors Prices / Historical · ABOVE the breakdown) -->
        <div id="gm-drill-banner-anchor"></div>

        <!-- Breakdown table (adapts to active tab) -->
        <details style="margin-top:12px" open>
          <summary style="font-size:11px;font-weight:600;color:var(--tx2);cursor:pointer;letter-spacing:.05em;text-transform:uppercase;user-select:none;padding:6px 0">
            Breakdown table
          </summary>
          <div id="gm-drill-breakdown" style="margin-top:8px;overflow-x:auto"></div>
        </details>
      </div>
    </td>`;
  row.after(detail);

  // Cache for fullscreen
  window._GM_LAST_ZONE = zone;
  window._GM_LAST_MIX  = mix;
  window._GM_LAST_ST   = st;
  window._GM_DRILL_ZONE = zone;

  // Render tabbar + initial tab
  _gmDrillRenderTabs();
  _gmDrillUpdateTabContext(window._gmDrillTab);
  _gmDrillDispatchRender(zone);
}
window._gmOpenRow = _gmOpenRow;

// ════════════════════════════════════════════════════════════════
// DRILL SUB-TABS · Profile / Mix / Carbon / Net pos
// Mirrors the CC tabbar pattern (renderCCTabs + _ccUpdateTabContext).
// ════════════════════════════════════════════════════════════════

const _GM_DRILL_VIEWS = [
  {
    key:'profile',
    label:'Profile',
    icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 8 12 13 14 21 4"/><path d="M3 21h18"/></svg>',
  },
  {
    key:'mix',
    label:'Mix',
    icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 3"/></svg>',
  },
  {
    key:'carbon',
    label:'Carbon',
    icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18a6 6 0 0 1 12 0"/><path d="M12 6v6"/><circle cx="12" cy="18" r="1.5"/></svg>',
  },
  {
    key:'stack',
    label:'Stack',
    icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-5 3 3 4-6"/></svg>',
  },
];

// Per-tab state
window._gmDrillProfileOverlay = window._gmDrillProfileOverlay || 'j-1'; // 'none' | 'j-1' | '7d'
window._gmDrillMixMode     = window._gmDrillMixMode     || 'donut';    // 'donut' | 'bar' | 'treemap'
window._gmDrillCarbonCmp   = window._gmDrillCarbonCmp   || 'j-1';      // 'j-1' | '7d' | 'y-1'

function _gmDrillRenderTabs() {
  const tabs = document.getElementById('gm-drill-tabs');
  if (!tabs) return;
  const cur = window._gmDrillTab || 'profile';
  tabs.innerHTML = _GM_DRILL_VIEWS.map(v => `
    <button onclick="setGmDrillTab('${v.key}')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:${v.key === cur ? 'var(--bg3)' : 'transparent'};color:${v.key === cur ? 'var(--text)' : 'var(--text3)'};font-family:'Inter',sans-serif;font-weight:500;letter-spacing:.03em;transition:all .15s">
      <span style="display:inline-flex;width:14px;height:14px">${v.icon}</span>${v.label}
    </button>`).join('');
}

function _gmDrillUpdateTabContext(tab) {
  const subToggle = document.getElementById('gm-drill-sub-toggle');
  const chips     = document.getElementById('gm-drill-tab-chips');
  if (!subToggle || !chips) return;

  // Per-tab sub-toggle (Display/Mode/Compare)
  let subToggleHtml = '';
  let subToggleLabel = '';
  const pkPill = window.pkPill || ((opts) => `<button onclick="${opts.onClick}" style="padding:4px 10px;font-size:10px;border-radius:14px;cursor:pointer;background:${opts.active?'rgba(20,211,169,0.15)':'transparent'};color:${opts.active?'#14D3A9':'var(--tx3)'};border:1px solid ${opts.active?'rgba(20,211,169,0.4)':'var(--bd)'};font-family:'JetBrains Mono',monospace;font-weight:600">${opts.label}</button>`);

  if (tab === 'profile') {
    subToggleLabel = 'Overlay';
    const modes = [
      { id:'none',  label:'None'    },
      { id:'j-1',   label:'vs J-1'  },
      { id:'7d',    label:'vs 7d avg' },
    ];
    const cur = window._gmDrillProfileOverlay || 'j-1';
    subToggleHtml = modes.map(m => pkPill({
      label:m.label, active:m.id === cur, onClick:`setGmDrillProfileOverlay('${m.id}')`,
    })).join('');
  } else if (tab === 'mix') {
    subToggleLabel = 'Mode';
    const modes = [
      { id:'donut',   label:'Donut'       },
      { id:'bar',     label:'Stacked bar' },
      { id:'treemap', label:'Treemap'     },
    ];
    const cur = window._gmDrillMixMode || 'donut';
    subToggleHtml = modes.map(m => pkPill({
      label:m.label, active:m.id === cur, onClick:`setGmDrillMixMode('${m.id}')`,
    })).join('');
  } else if (tab === 'carbon') {
    subToggleLabel = 'Compare';
    const modes = [
      { id:'j-1', label:'vs J-1'       },
      { id:'7d',  label:'vs 7-day avg' },
      { id:'y-1', label:'vs Y-1'       },
    ];
    const cur = window._gmDrillCarbonCmp || 'j-1';
    subToggleHtml = modes.map(m => pkPill({
      label:m.label, active:m.id === cur, onClick:`setGmDrillCarbonCmp('${m.id}')`,
    })).join('');
  }

  if (subToggleHtml) {
    subToggle.innerHTML = `
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace;margin-right:4px">${subToggleLabel}</span>
      ${subToggleHtml}`;
    subToggle.style.display = 'inline-flex';
  } else {
    subToggle.innerHTML = '';
    subToggle.style.display = 'none';
  }

  // No chips for now (drill doesn't need zone picker, the zone is the row clicked)
  chips.innerHTML = '';
  chips.style.display = 'none';
}

function _gmDrillSetTitle(tab, zone) {
  const eyebrowEl = document.getElementById('gm-drill-tab-eyebrow');
  const titleEl   = document.getElementById('gm-drill-tab-title');
  if (!titleEl) return;
  const viewLbl = (_GM_DRILL_VIEWS.find(v => v.key === tab) || {}).label || 'Profile';
  const titles = {
    profile: `24h Generation profile · stacked area`,
    mix:     `Current snapshot · ${(window._gmDrillMixMode || 'donut').toUpperCase()}`,
    carbon:  `24h Carbon intensity · g CO₂/kWh`,
    netpos:  `Cross-border net position · 24h`,
    stack:   `24h Production stack · par filière`,
  };
  if (eyebrowEl) eyebrowEl.textContent = `${zone} · ${viewLbl}`;
  titleEl.textContent = titles[tab] || titles.profile;
}

// Setters
function setGmDrillTab(tab) {
  window._gmDrillTab = tab;
  _gmDrillRenderTabs();
  _gmDrillUpdateTabContext(tab);
  _gmDrillDispatchRender(window._GM_DRILL_ZONE);
}
window.setGmDrillTab = setGmDrillTab;

function setGmDrillProfileOverlay(mode) {
  window._gmDrillProfileOverlay = mode;
  _gmDrillUpdateTabContext('profile');
  _gmDrillDispatchRender(window._GM_DRILL_ZONE);
}
window.setGmDrillProfileOverlay = setGmDrillProfileOverlay;

function setGmDrillMixMode(mode) {
  window._gmDrillMixMode = mode;
  _gmDrillUpdateTabContext('mix');
  _gmDrillDispatchRender(window._GM_DRILL_ZONE);
}
window.setGmDrillMixMode = setGmDrillMixMode;

function setGmDrillCarbonCmp(cmp) {
  window._gmDrillCarbonCmp = cmp;
  _gmDrillUpdateTabContext('carbon');
  _gmDrillDispatchRender(window._GM_DRILL_ZONE);
}
window.setGmDrillCarbonCmp = setGmDrillCarbonCmp;

// Dispatch render based on active tab
function _gmDrillDispatchRender(zone) {
  if (!zone) return;
  const tab = window._gmDrillTab || 'profile';
  _gmDrillSetTitle(tab, zone);

  // Stack tab → eCO2mix-style production stack (reads the daily JSON, async)
  if (tab === 'stack') {
    const c = document.getElementById('gm-drill-content');
    if (c) c.innerHTML = '<div style="color:var(--tx3);font-family:\'JetBrains Mono\',monospace;font-size:11px;padding:14px">Chargement du stack…</div>';
    if (typeof window.renderGenMixStack === 'function') window.renderGenMixStack('gm-drill-content', zone, window._gmHistDate || null);
    const b = document.getElementById('gm-drill-banner-anchor'); if (b) b.innerHTML = '';
    return;
  }

  const mix = window._genmixData && window._genmixData[zone];
  if (!mix) return;
  const st = _gmStats(mix);
  if (!st) return;

  switch (tab) {
    case 'profile': _gmDrillRenderProfile(zone, mix, st); break;
    case 'mix':     _gmDrillRenderMix(zone, mix, st);     break;
    case 'carbon':  _gmDrillRenderCarbon(zone, mix, st);  break;
    case 'netpos':  _gmDrillRenderNetPos(zone, mix, st);  break;
  }

  // Market read banner · context-aware per tab
  const bannerAnchor = document.getElementById('gm-drill-banner-anchor');
  if (bannerAnchor) bannerAnchor.innerHTML = _gmDrillBuildBannerHtml(tab, zone, mix, st);
}

// ─────────────────────────────────────────────────────────────────
// MARKET READ generator · drill row (per tab)
// ─────────────────────────────────────────────────────────────────
function _gmDrillBuildBannerHtml(tab, zone, mix, st) {
  const country = GM_ZONE_NAMES[zone] || zone;
  const co2C = _gmCo2Color(st.co2);
  const co2Verdict = (st.co2 < 50) ? 'very low-carbon' : (st.co2 < 150) ? 'low-carbon' : (st.co2 < 400) ? 'moderate' : 'carbon-intensive';

  if (tab === 'profile') {
    const synth = window._gmdSynthProfile;
    const prof = (typeof synth === 'function') ? synth(mix) : null;
    if (!prof) {
      const line1 = `${country} total ${(st.total/1000).toFixed(2)} GW · ${st.renPct.toFixed(0)}% REN. Top fuel: <strong style="color:#fff">${GM_FUEL_META[st.dom]?.label || st.dom}</strong> at ${(((mix[st.dom]||0)/st.total)*100).toFixed(0)}%.`;
      return _gmBuildMarketBanner({ line1 });
    }
    const solarPeak = prof.solar ? Math.max(...prof.solar) : 0;
    const fossilPeak = prof.fossil ? Math.max(...prof.fossil) : 0;
    const nucBase = prof.nuclear ? (prof.nuclear.reduce((a,b)=>a+b,0) / prof.nuclear.length) : 0;
    const line1 = `${country} 24h profile · solar peak <strong style="color:#fff">${solarPeak.toFixed(1)} GW</strong>, nuclear baseload <strong style="color:#fff">${nucBase.toFixed(1)} GW</strong>, fossil peak <strong style="color:#fff">${fossilPeak.toFixed(1)} GW</strong>.`;
    let verdict = '';
    if (st.renPct >= 60) {
      verdict = `Wind+solar drive the shape today. Mid-day price softening likely on solar surplus.`;
    } else if (nucBase > st.total / 2 / 1000) {
      verdict = `Flat nuclear baseload dominates · prices anchor around marginal fossil ramps morning/evening.`;
    } else if (st.fosPct > 30) {
      verdict = `Fossil-heavy day — gas/coal sets marginal price across most slots.`;
    } else {
      verdict = `Mixed shape: REN moderate, residual demand on flexible thermal.`;
    }
    return _gmBuildMarketBanner({ line1, verdict });
  }

  if (tab === 'mix') {
    const topF = GM_FUEL_META[st.dom] || GM_FUEL_META.other;
    const topPct = (((mix[st.dom] || 0) / st.total) * 100).toFixed(0);
    const line1 = `${country} mix · <strong style="color:#fff">${topF.label}</strong> dominates at ${topPct}% of generation. Renewables ${st.renPct.toFixed(0)}%. Fossil ${st.fosPct.toFixed(0)}%.`;
    let verdict = '';
    if (st.fosPct < 5 && st.renPct > 50) {
      verdict = `Decarbonised mix: very low fossil share. Capture prices for variable REN typically strong on days like today.`;
    } else if (st.fosPct > 30) {
      verdict = `Fossil-led mix. Capture rates for wind/solar depressed when REN coincides with high fossil dispatch.`;
    } else {
      verdict = `Balanced mix, neither extreme. Watch shifts in dominant fuel through the day.`;
    }
    return _gmBuildMarketBanner({ line1, verdict });
  }

  if (tab === 'carbon') {
    const line1 = `${country} carbon intensity · current snapshot <strong style="color:${co2C}">${Math.round(st.co2)} g/kWh</strong> (${co2Verdict}). REN ${st.renPct.toFixed(0)}%, nuclear ${(((mix.nuclear||0)/st.total)*100).toFixed(0)}%.`;
    let verdict = '';
    if (st.co2 < 50) {
      verdict = `Among the cleanest grids in Europe today. Strong PPA pricing potential for low-carbon offtake here.`;
    } else if (st.co2 < 150) {
      verdict = `Solid low-carbon footprint. CO₂ price exposure (EUA cost in spot) limited for thermal margins.`;
    } else if (st.co2 < 400) {
      verdict = `Moderate carbon intensity. EUA pass-through becomes material for marginal generators.`;
    } else {
      verdict = `High-carbon mix today — EUA cost weighs heavily on the marginal price.`;
    }
    return _gmBuildMarketBanner({ line1, verdict });
  }

  if (tab === 'netpos') {
    const line1 = `${country} cross-border net position · awaiting ENTSO-E flows endpoint integration.`;
    return _gmBuildMarketBanner({ line1, verdict: 'Will populate in v2.1.', icon: '⏱' });
  }

  return '';
}
window._gmDrillBuildBannerHtml = _gmDrillBuildBannerHtml;

// ─────────────────────────────────────────────────────────────────
// VIEW · PROFILE (24h Total gen line · 15-min slots · Today + overlay J-1)
// Mirrors Prices Day-Ahead drill chart: one main line per zone, with
// optional J-1 / 7d overlay. Total generation across all fuels per slot.
// ─────────────────────────────────────────────────────────────────
function _gmDrillRenderProfile(zone, mix, st) {
  const host = document.getElementById('gm-drill-content');
  if (!host) return;
  const bh = document.getElementById('gm-drill-breakdown'); if (bh) bh.innerHTML = '';
  host.innerHTML = `<div style="position:relative;width:100%;height:300px"><canvas id="gm-drill-profile-canvas" style="width:100%;height:100%;display:block"></canvas></div>`;
  _gmRenderProfileReal('gm-drill-profile-canvas', zone, window._gmHistDate || null, '_gmDrillProfileChart');
}

// Shared real-data 15-min profile renderer (daily drill + historical Daily mode).
// Reads stored arrays for the selected day + the previous stored day (J-1).
async function _gmRenderProfileReal(canvasId, zone, dateStr, chartKey) {
  zone = zone || 'FR';
  const cur = await _gmResolveDay(zone, dateStr);
  if (!cur) {
    const c = document.getElementById(canvasId);
    if (c && c.parentElement) c.parentElement.innerHTML = `<div style="padding:20px;color:var(--tx3);font-family:'JetBrains Mono',monospace;font-size:11px">Pas de données stockées pour ${zone}.</div>`;
    return;
  }
  const { DATA, N } = _gmDayArrays(cur.zd);
  const total = new Array(N).fill(0).map((_, i) => GM_STACK_FUELS.reduce((s, f) => s + DATA[f][i], 0) / 1000); // GW

  // Real J-1 (previous stored day, resampled to N)
  let prev = null;
  const pd = new Date(cur.ds + 'T00:00:00'); pd.setDate(pd.getDate() - 1);
  const pj = await _gmFetchDaily(_gmFmtDate(pd));
  const pzd = pj && pj.zones && pj.zones[zone];
  if (_gmHasArrays(pzd)) {
    const pa = _gmDayArrays(pzd);
    const pTot = new Array(pa.N).fill(0).map((_, i) => GM_STACK_FUELS.reduce((s, f) => s + pa.DATA[f][i], 0) / 1000);
    prev = new Array(N).fill(0).map((_, i) => pTot[Math.min(pa.N - 1, Math.round(i / (N - 1) * (pa.N - 1)))]);
  }

  const labels = [];
  for (let i = 0; i < N; i++) { const m = Math.round(i / N * 24 * 60); labels.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`); }

  const datasets = [];

  // Percentile envelope (P0–P100 outer, P5–P95 inner, P50 median) over 30 stored days
  const env = await _gmFetchGenEnvelope(zone, 30, N);
  if (env) {
    datasets.push({ label: '__p0', data: env.p0, borderColor: 'transparent', pointRadius: 0, fill: false, tension: 0.35 });
    datasets.push({ label: 'P0–P100', data: env.p100, borderColor: 'transparent', backgroundColor: 'rgba(20,211,169,0.06)', pointRadius: 0, fill: '-1', tension: 0.35 });
    datasets.push({ label: '__p5', data: env.p5, borderColor: 'transparent', pointRadius: 0, fill: false, tension: 0.35 });
    datasets.push({ label: 'P5–P95', data: env.p95, borderColor: 'transparent', backgroundColor: 'rgba(20,211,169,0.14)', pointRadius: 0, fill: '-1', tension: 0.35 });
    datasets.push({ label: 'P50 (médiane 30j)', data: env.p50, borderColor: '#7A93AB', borderWidth: 1.25, borderDash: [2, 3], pointRadius: 0, fill: false, tension: 0.35 });
  }

  datasets.push({
    label: cur.ds, data: total, borderColor: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.10)',
    borderWidth: 2.5, fill: false, tension: 0.35, pointRadius: 0, pointHoverRadius: 4,
  });
  if (prev) datasets.push({
    label: 'J-1', data: prev, borderColor: '#7A93AB', backgroundColor: 'transparent',
    borderWidth: 1.5, borderDash: [4, 3], fill: false, tension: 0.35, pointRadius: 0, pointHoverRadius: 4,
  });

  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  if (window[chartKey]) { try { window[chartKey].destroy(); } catch (_) {} }
  window[chartKey] = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { color: '#4A6280', font: { size: 10, family: 'JetBrains Mono' }, boxWidth: 16, usePointStyle: true, pointStyle: 'line', filter: (item) => !(item.text || '').startsWith('__') } },
        zoom: GM_ZOOM_OPTS,
        tooltip: {
          backgroundColor: '#0A1018', titleColor: '#fff', bodyColor: '#B8C9D9', borderColor: '#1A2533', borderWidth: 1, padding: 8,
          titleFont: { family: 'JetBrains Mono', size: 10 }, bodyFont: { family: 'JetBrains Mono', size: 10 },
          filter: (ctx) => !(ctx.dataset.label || '').startsWith('__'),
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} GW` },
        },
      },
      scales: {
        x: { ticks: { color: '#4A6280', font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 12, autoSkip: true }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#4A6280', font: { size: 9, family: 'JetBrains Mono' }, callback: (v) => v + ' GW' }, grid: { color: 'rgba(255,255,255,0.04)' }, title: { display: true, text: 'Generation (GW)', color: '#4A6280', font: { size: 9, family: 'JetBrains Mono' } } },
      },
    },
  });
  _gmZoomify(window[chartKey], canvasId);
}

function _gmDrillRenderProfile_OLD(zone, mix, st) {
  const host = document.getElementById('gm-drill-content');
  const breakHost = document.getElementById('gm-drill-breakdown');
  if (!host) return;

  const synth = window._gmdSynthProfile;
  if (typeof synth !== 'function') {
    host.innerHTML = `<div style="padding:20px;color:var(--tx3);font-family:'JetBrains Mono',monospace;font-size:11px">Profile synthesizer not loaded (check genmix-daily.js)</div>`;
    return;
  }

  host.innerHTML = `
    <div style="position:relative;width:100%;height:300px">
      <canvas id="gm-drill-profile-canvas" style="width:100%;height:100%;display:block"></canvas>
    </div>`;

  const profile = synth(mix);
  if (!profile) return;
  const STACK = ['nuclear','hydro','biomass','wind','solar','fossil','other'];
  const N = profile.nuclear?.length || 96;

  // Sum across all fuels at each 15-min slot to get TOTAL generation
  const total = new Array(N);
  for (let i = 0; i < N; i++) {
    total[i] = STACK.reduce((s, f) => s + ((profile[f] || [])[i] || 0), 0);
  }

  const labels = [];
  for (let i = 0; i < N; i++) {
    const m = i * 15;
    labels.push(`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`);
  }

  // Overlay synthesis (J-1 ≈ today × small variance, 7d avg ≈ smoothed today)
  const overlay = window._gmDrillProfileOverlay || 'j-1';
  let cmpData = null;
  let cmpLabel = '';
  if (overlay === 'j-1') {
    // Synthesize J-1 with a small temporal shift + noise
    cmpData = total.map((v, i) => {
      const phase = Math.sin((i / N) * Math.PI * 2 + 0.3) * 0.04;
      return v * (1 + phase) * 0.97;
    });
    cmpLabel = 'J-1';
  } else if (overlay === '7d') {
    // 7d avg ≈ flatter version (lower amplitude)
    const mean = total.reduce((a,b)=>a+b,0) / total.length;
    cmpData = total.map(v => mean + (v - mean) * 0.6);
    cmpLabel = '7d avg';
  }

  const todayColor = '#FBBF24'; // amber, same accent as Prices drill chart
  const datasets = [
    {
      label:           'Today',
      data:            total,
      borderColor:     todayColor,
      backgroundColor: 'rgba(251, 191, 36, 0.10)',
      borderWidth: 2.5,
      fill: true,
      tension: 0.35,
      pointRadius: 0,
      pointHoverRadius: 4,
    },
  ];
  if (cmpData) {
    datasets.push({
      label:           cmpLabel,
      data:            cmpData,
      borderColor:     '#7A93AB',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [4, 3],
      fill: false,
      tension: 0.35,
      pointRadius: 0,
      pointHoverRadius: 4,
    });
  }

  const canvas = document.getElementById('gm-drill-profile-canvas');
  if (window._gmDrillProfileChart) { try { window._gmDrillProfileChart.destroy(); } catch(_) {} }
  window._gmDrillProfileChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'end',
          labels: { color:'#4A6280', font:{ size:10, family:'JetBrains Mono' }, boxWidth:16, usePointStyle:true, pointStyle:'line' } },
        tooltip: {
          backgroundColor: '#0A1018', titleColor: '#fff', bodyColor: '#B8C9D9',
          borderColor: '#1A2533', borderWidth: 1, padding: 8,
          titleFont: { family: 'JetBrains Mono', size: 10 },
          bodyFont:  { family: 'JetBrains Mono', size: 10 },
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} GW` },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 }, maxRotation: 0, autoSkip: true,
            callback: function(val, idx) { return (idx % 8 === 0) ? labels[idx].slice(0, 5) : ''; },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 } },
          title: { display: true, text: 'Total generation · GW',
            color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9, weight: '600' } },
        },
      },
    },
  });

  // Breakdown · Total gen stats over 24h (peak / off-peak / avg / energy / range)
  if (breakHost) {
    const peakIdx  = total.indexOf(Math.max(...total));
    const minIdx   = total.indexOf(Math.min(...total));
    const peakVal  = total[peakIdx];
    const minVal   = total[minIdx];
    const avg      = total.reduce((a,b)=>a+b,0) / total.length;
    const energy   = avg * 24;           // GWh
    const spread   = peakVal - minVal;
    // Peak (08-20h) / off-peak (00-08h + 20-24h) split — 4 slots per hour
    const peakSlots = [];
    const offSlots  = [];
    for (let i = 0; i < total.length; i++) {
      const hour = Math.floor(i / 4);
      if (hour >= 8 && hour < 20) peakSlots.push(total[i]);
      else                          offSlots.push(total[i]);
    }
    const peakAvg = peakSlots.length ? peakSlots.reduce((a,b)=>a+b,0) / peakSlots.length : 0;
    const offAvg  = offSlots.length  ? offSlots.reduce((a,b)=>a+b,0)  / offSlots.length  : 0;

    const cell = (txt, opts = {}) =>
      `<td style="padding:6px 10px;${opts.right ? 'text-align:right;' : ''}font-family:'JetBrains Mono',monospace;color:${opts.color || 'var(--tx)'};${opts.dim ? 'color:var(--tx3);' : ''}">${txt}</td>`;
    const row = (label, val, unit, note, color) =>
      `<tr style="border-top:1px solid var(--bd)">${cell(label)}${cell(val, { right:true, color })}${cell(unit, { right:true, dim:true })}${cell(note, { dim:true })}</tr>`;

    breakHost.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr>
            <th style="padding:6px 10px;text-align:left;color:var(--tx3);font-weight:600">Metric</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Value</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Unit</th>
            <th style="padding:6px 10px;text-align:left;color:var(--tx3);font-weight:600">Note</th>
          </tr>
        </thead>
        <tbody>
          ${row('Today peak',  peakVal.toFixed(2), 'GW',  `at ${labels[peakIdx]} · max instantaneous`, '#14D3A9')}
          ${row('Today min',   minVal.toFixed(2),  'GW',  `at ${labels[minIdx]} · trough`,              '#ED6965')}
          ${row('24h avg',     avg.toFixed(2),     'GW',  '24-hour average power')}
          ${row('24h energy',  energy.toFixed(1),  'GWh', 'avg power × 24h')}
          ${row('Peak avg',    peakAvg.toFixed(2), 'GW',  'mean over 08:00–20:00')}
          ${row('Off-peak avg',offAvg.toFixed(2),  'GW',  'mean over 00–08 + 20–24')}
          ${row('Spread',      spread.toFixed(2),  'GW',  'peak − min · within day')}
        </tbody>
      </table>`;
  }
}

// ─────────────────────────────────────────────────────────────────
// VIEW · MIX (donut / bar / treemap)
// ─────────────────────────────────────────────────────────────────
function _gmDrillRenderMix(zone, mix, st) {
  const host = document.getElementById('gm-drill-content');
  if (!host) return;
  host.innerHTML = `
    <div style="display:flex;gap:16px;align-items:stretch;flex-wrap:wrap">
      <div style="flex:1 1 55%;min-width:280px;position:relative;height:340px">
        <canvas id="gm-drill-mix-canvas" style="width:100%;height:100%;display:block"></canvas>
        <div id="gm-drill-mix-treemap" style="position:absolute;inset:0;display:none"></div>
      </div>
      <div style="flex:1 1 38%;min-width:240px;align-self:center" id="gm-drill-mix-table"></div>
    </div>`;
  _gmRenderMixReal(zone, window._gmHistDate || null, mix, st);
}

// Mix of the selected stored day (per-fuel average over real slots); fallback to instant snapshot.
async function _gmRenderMixReal(zone, dateStr, fallbackMix, fallbackSt) {
  const breakHost = document.getElementById('gm-drill-breakdown');
  const tableHost = document.getElementById('gm-drill-mix-table');
  const mode = window._gmDrillMixMode || 'donut';
  const STACK = ['nuclear', 'hydro', 'biomass', 'wind', 'solar', 'fossil', 'other'];

  let mix, st, srcLabel = '';
  const cur = await _gmResolveDay(zone, dateStr);
  if (cur) {
    const { DATA, N } = _gmDayArrays(cur.zd);
    let nReal = 0; for (let i = N - 1; i >= 0; i--) { if (STACK.reduce((s, f) => s + DATA[f][i], 0) > 0) { nReal = i + 1; break; } }
    if (nReal < 1) nReal = N;
    mix = {}; STACK.forEach(f => { mix[f] = DATA[f].slice(0, nReal).reduce((s, v) => s + v, 0) / nReal; });
    mix.total = STACK.reduce((s, f) => s + mix[f], 0);
    const ren = mix.wind + mix.solar + mix.hydro + mix.biomass;
    st = { total: mix.total, renPct: mix.total ? ren / mix.total * 100 : 0, fosPct: mix.total ? mix.fossil / mix.total * 100 : 0, ren, nuc: mix.nuclear, fos: mix.fossil };
    srcLabel = 'moyenne du ' + cur.ds;
  } else {
    mix = fallbackMix; st = fallbackSt; srcLabel = 'instantané';
  }

  if (mode === 'donut') { document.getElementById('gm-drill-mix-canvas').style.display = 'block'; document.getElementById('gm-drill-mix-treemap').style.display = 'none'; _gmBuildDonut(mix, st, 'gm-drill-mix-canvas', false); }
  else if (mode === 'bar') { document.getElementById('gm-drill-mix-canvas').style.display = 'block'; document.getElementById('gm-drill-mix-treemap').style.display = 'none'; _gmBuildBar(mix, st, 'gm-drill-mix-canvas', false); }
  else if (mode === 'treemap') { document.getElementById('gm-drill-mix-canvas').style.display = 'none'; const t = document.getElementById('gm-drill-mix-treemap'); t.style.display = 'block'; _gmDrillBuildTreemap(t, mix); }

  if (tableHost) tableHost.innerHTML = _gmBuildBreakdownTable(mix, st);
  if (breakHost) breakHost.innerHTML = '';
}

function _gmDrillBuildTreemap(host, mix) {
  const STACK = ['nuclear','hydro','biomass','wind','solar','fossil','other'];
  const items = STACK
    .map(f => ({ key: f, v: mix[f] || 0, color: GM_FUEL_META[f]?.color, label: GM_FUEL_META[f]?.label || f }))
    .filter(it => it.v > 0)
    .sort((a, b) => b.v - a.v);
  if (!items.length) { host.innerHTML = ''; return; }
  const total = items.reduce((s, it) => s + it.v, 0) || 1;
  const leading = items[0];
  const rest = items.slice(1);
  const restTotal = rest.reduce((s, it) => s + it.v, 0) || 1;

  host.innerHTML = `
    <div style="display:flex;gap:4px;width:100%;height:100%">
      <div style="flex:${leading.v / total};background:${leading.color};display:flex;align-items:center;justify-content:center;padding:10px;border-radius:6px;">
        <div style="text-align:center;color:#0A1018">
          <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;letter-spacing:.04em;opacity:.85">${leading.label}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:24px;font-weight:700;margin-top:4px">${(leading.v/total*100).toFixed(1)}%</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;opacity:.7;margin-top:2px">${(leading.v/1000).toFixed(2)} GW</div>
        </div>
      </div>
      <div style="flex:${rest.reduce((s,it)=>s+it.v,0) / total};display:flex;flex-direction:column;gap:4px">
        ${rest.map(it => `
          <div style="flex:${it.v/restTotal};background:${it.color};display:flex;align-items:center;justify-content:center;padding:6px;border-radius:6px;">
            <div style="text-align:center;color:#0A1018">
              <div style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;letter-spacing:.04em;opacity:.85">${it.label}</div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700">${(it.v/total*100).toFixed(1)}%</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
// VIEW · CARBON (24h carbon intensity)
// ─────────────────────────────────────────────────────────────────
function _gmDrillRenderCarbon(zone, mix, st) {
  const host = document.getElementById('gm-drill-content');
  if (!host) return;
  host.innerHTML = `<div style="position:relative;width:100%;height:340px"><canvas id="gm-drill-carbon-canvas" style="width:100%;height:100%;display:block"></canvas></div>`;
  _gmRenderCarbonReal(zone, window._gmHistDate || null);
}

// Real-data 24h carbon-intensity (g CO2/kWh) from the stored archive + real J-1.
async function _gmRenderCarbonReal(zone, dateStr) {
  zone = zone || 'FR';
  const breakHost = document.getElementById('gm-drill-breakdown');
  const STACK = ['nuclear', 'hydro', 'biomass', 'wind', 'solar', 'fossil', 'other'];
  const CO2 = {}; STACK.forEach(f => { CO2[f] = (GM_FUEL_META[f] && GM_FUEL_META[f].co2) || 0; });
  const intensity = (DATA, n) => {
    const out = [];
    for (let i = 0; i < n; i++) { let num = 0, den = 0; for (const f of STACK) { const v = DATA[f][i] || 0; num += v * CO2[f]; den += v; } out.push(den > 0 ? num / den : null); }
    return out;
  };

  const cur = await _gmResolveDay(zone, dateStr);
  if (!cur) { const c = document.getElementById('gm-drill-carbon-canvas'); if (c && c.parentElement) c.parentElement.innerHTML = `<div style="padding:20px;color:var(--tx3);font-family:'JetBrains Mono',monospace;font-size:11px">Pas de données stockées pour ${zone}.</div>`; return; }
  const { DATA, N } = _gmDayArrays(cur.zd);
  let nReal = 0; for (let i = N - 1; i >= 0; i--) { const t = STACK.reduce((s, f) => s + DATA[f][i], 0); if (t > 0) { nReal = i + 1; break; } }
  if (nReal < 1) nReal = N;
  const co2 = intensity(DATA, nReal);
  const labels = []; for (let i = 0; i < nReal; i++) { const m = Math.round(i / N * 24 * 60); labels.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`); }

  // Real J-1
  let cmpData = null; const cmpLabel = 'J-1';
  const pd = new Date(cur.ds + 'T00:00:00'); pd.setDate(pd.getDate() - 1);
  const pj = await _gmFetchDaily(_gmFmtDate(pd)); const pzd = pj && pj.zones && pj.zones[zone];
  if (_gmHasArrays(pzd)) { const pa = _gmDayArrays(pzd); const pc = intensity(pa.DATA, pa.N); cmpData = co2.map((_, i) => pc[Math.min(pa.N - 1, Math.round(i / Math.max(1, nReal - 1) * (pa.N - 1)))]); }

  const canvas = document.getElementById('gm-drill-carbon-canvas');
  if (!canvas || typeof Chart === 'undefined') return;
  if (window._gmDrillCarbonChart) { try { window._gmDrillCarbonChart.destroy(); } catch (_) {} }
  window._gmDrillCarbonChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: cur.ds, data: co2, borderColor: '#14D3A9', backgroundColor: 'rgba(20,211,169,0.10)', borderWidth: 2.5, fill: true, tension: 0.4, pointRadius: 0 },
        cmpData ? { label: cmpLabel, data: cmpData, borderColor: '#7A93AB', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4, 3], fill: false, tension: 0.4, pointRadius: 0 } : null,
      ].filter(Boolean),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { color: '#4A6280', font: { size: 10, family: 'JetBrains Mono' }, boxWidth: 16, usePointStyle: true, pointStyle: 'line' } },
        zoom: GM_ZOOM_OPTS,
        tooltip: {
          backgroundColor: '#0A1018', titleColor: '#fff', bodyColor: '#B8C9D9', borderColor: '#1A2533', borderWidth: 1, padding: 8,
          titleFont: { family: 'JetBrains Mono', size: 10 }, bodyFont: { family: 'JetBrains Mono', size: 10 },
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? '--' : ctx.parsed.y.toFixed(0)} g/kWh` },
        },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 } }, title: { display: true, text: 'g CO₂ / kWh', color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9, weight: '600' } } },
      },
    },
  });
  _gmZoomify(window._gmDrillCarbonChart, 'gm-drill-carbon-canvas');

  _gmRenderCarbonBreakdown(breakHost, co2, cmpData, cmpLabel, STACK);
}

// Carbon breakdown: stats over real slots + calculation hypotheses + sources.
function _gmRenderCarbonBreakdown(breakHost, co2, cmpData, cmpLabel, STACK) {
  if (!breakHost) return;
  const real = co2.filter(v => v != null);
  if (!real.length) { breakHost.innerHTML = ''; return; }
  const todayMin = Math.min.apply(null, real), todayMax = Math.max.apply(null, real);
  const todayAvg = real.reduce((a, b) => a + b, 0) / real.length;
  const cmpReal = (cmpData || []).filter(v => v != null);
  const cmpAvg = cmpReal.length ? cmpReal.reduce((a, b) => a + b, 0) / cmpReal.length : null;
  const diff = cmpAvg == null ? null : todayAvg - cmpAvg;
  const perH = co2.length / 24;
  const cleanH = co2.filter(v => v != null && v < 100).length / (perH || 1);
  const dirtyH = co2.filter(v => v != null && v > 300).length / (perH || 1);
  const cell = (txt, o = {}) => `<td style="padding:6px 8px;${o.right ? 'text-align:right;' : ''}font-family:'JetBrains Mono',monospace;color:${o.color || 'var(--tx)'}">${txt}</td>`;
  const row = (l, v, u, n, c) => `<tr style="border-top:1px solid var(--bd)">${cell(l, { color: 'var(--tx2)' })}${cell(v, { right: true, color: c })}${cell(u, { right: true, color: 'var(--tx3)' })}${cell(n, { color: 'var(--tx3)' })}</tr>`;
  breakHost.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>
        <th style="padding:4px 8px;text-align:left;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Metric</th>
        <th style="padding:4px 8px;text-align:right;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Value</th>
        <th style="padding:4px 8px;text-align:right;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Unit</th>
        <th style="padding:4px 8px;text-align:left;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Note</th>
      </tr></thead>
      <tbody>
        ${row('Today min', todayMin.toFixed(0), 'g/kWh', 'cleanest slot', '#14D3A9')}
        ${row('Today max', todayMax.toFixed(0), 'g/kWh', 'dirtiest slot', '#ED6965')}
        ${row('Today avg', todayAvg.toFixed(0), 'g/kWh', '24h average')}
        ${cmpAvg != null ? row(cmpLabel + ' avg', cmpAvg.toFixed(0), 'g/kWh', 'baseline') : ''}
        ${diff != null ? row('Δ vs ' + cmpLabel, (diff >= 0 ? '+' : '') + diff.toFixed(0), 'g/kWh', diff < 0 ? 'cleaner today' : 'dirtier today', diff < 0 ? '#14D3A9' : '#ED6965') : ''}
        ${row('Clean hours', cleanH.toFixed(1), 'h', 'below 100 g/kWh')}
        ${row('Dirty hours', dirtyH.toFixed(1), 'h', 'above 300 g/kWh')}
      </tbody>
    </table>
    <div style="margin-top:14px;border-top:1px solid var(--bd);padding-top:12px">
      <div style="font-family:'JetBrains Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);font-weight:600;margin-bottom:8px">Hypothèses de calcul</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--tx2);line-height:1.6;margin-bottom:10px">
        <span style="color:var(--tx)">CI(t) = Σ<sub>f</sub> [ génération<sub>f</sub>(t) × FE<sub>f</sub> ] / Σ<sub>f</sub> génération<sub>f</sub>(t)</span><br>
        <span style="color:var(--tx3)">Moyenne attributionnelle, périmètre cycle de vie. Pas de FE marginal, pas d'imports.</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px">
        <thead><tr>
          <th style="padding:4px 8px;text-align:left;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Filière</th>
          <th style="padding:4px 8px;text-align:right;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">FE (g CO₂eq/kWh)</th>
          <th style="padding:4px 8px;text-align:left;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Données génération</th>
        </tr></thead>
        <tbody>
          ${STACK.map(f => `<tr style="border-top:1px solid var(--bd)">
            <td style="padding:6px 8px;font-family:'JetBrains Mono',monospace"><span style="color:${GM_FUEL_META[f].color}">${GM_FUEL_META[f].emoji} ${GM_FUEL_META[f].label}</span></td>
            <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx)">${GM_FUEL_META[f].co2}</td>
            <td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;color:var(--tx3)">ENTSO-E A75 · 15 min</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--tx3);line-height:1.6">
        <span style="color:var(--tx2)">Sources :</span> génération par filière = ENTSO-E Transparency (Actual Generation per Type, A75), archive PowerKlock 15 min. Facteurs d'émission = base ADEME / GIEC (médianes cycle de vie). « Fossil » = moyenne gaz/charbon agrégée ENTSO-E.
      </div>
    </div>`;
}

function _gmDrillRenderCarbon_OLD(zone, mix, st) {
  const host = document.getElementById('gm-drill-content');
  const breakHost = document.getElementById('gm-drill-breakdown');
  if (!host) return;

  const synth = window._gmdSynthProfile;
  const carbonFn = (typeof synth === 'function') ? synth(mix) : null;
  if (!carbonFn) {
    host.innerHTML = `<div style="padding:20px;color:var(--tx3);font-family:'JetBrains Mono',monospace;font-size:11px">Profile synthesizer not loaded</div>`;
    return;
  }

  // Compute carbon intensity per slot
  const STACK = ['nuclear','hydro','biomass','wind','solar','fossil','other'];
  const CO2 = {}; STACK.forEach(f => { CO2[f] = (GM_FUEL_META[f] && GM_FUEL_META[f].co2) || 0; });
  const N = (carbonFn.nuclear?.length) || 96;
  const co2 = new Array(N);
  for (let i = 0; i < N; i++) {
    let num = 0, den = 0;
    for (const f of STACK) {
      const v = (carbonFn[f] || [])[i] || 0;
      num += v * (CO2[f] || 0);
      den += v;
    }
    co2[i] = den > 0 ? num / den : 0;
  }
  const labels = [];
  for (let i = 0; i < N; i++) {
    const m = i * 15;
    labels.push(`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`);
  }

  host.innerHTML = `
    <div style="position:relative;width:100%;height:340px">
      <canvas id="gm-drill-carbon-canvas" style="width:100%;height:100%;display:block"></canvas>
    </div>`;

  const cmp = window._gmDrillCarbonCmp || 'j-1';
  let cmpData = null, cmpLabel = '';
  if (cmp === 'j-1') { cmpData = co2.map(v => v * 1.08); cmpLabel = 'J-1'; }
  if (cmp === '7d')  { cmpData = co2.map(v => v * 1.03); cmpLabel = '7-day avg'; }
  if (cmp === 'y-1') { cmpData = co2.map(v => v * 1.20); cmpLabel = 'Y-1'; }

  const canvas = document.getElementById('gm-drill-carbon-canvas');
  if (window._gmDrillCarbonChart) { try { window._gmDrillCarbonChart.destroy(); } catch(_) {} }
  window._gmDrillCarbonChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Today', data: co2, borderColor: '#14D3A9', backgroundColor: 'rgba(20,211,169,0.10)', borderWidth: 2.5, fill: true, tension: 0.4, pointRadius: 0 },
        { label: cmpLabel, data: cmpData, borderColor: '#7A93AB', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4, 3], fill: false, tension: 0.4, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0A1018', titleColor: '#fff', bodyColor: '#B8C9D9',
          borderColor: '#1A2533', borderWidth: 1, padding: 8,
          titleFont: { family: 'JetBrains Mono', size: 10 },
          bodyFont:  { family: 'JetBrains Mono', size: 10 },
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(0)} g/kWh` },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 }, maxRotation: 0, autoSkip: true,
            callback: function(val, idx) { return (idx % 12 === 0) ? labels[idx].slice(0, 5) : ''; },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 } },
          title: { display: true, text: 'g CO₂ / kWh', color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9, weight: '600' } },
        },
      },
    },
  });

  // Breakdown · carbon stats over 24h
  if (breakHost) {
    const todayMin = Math.min(...co2);
    const todayMax = Math.max(...co2);
    const todayAvg = co2.reduce((a,b)=>a+b,0) / co2.length;
    const cmpAvg   = cmpData.reduce((a,b)=>a+b,0) / cmpData.length;
    const cleanH = co2.filter(g => g < 100).length / 4;  // hours below 100 g/kWh
    const dirtyH = co2.filter(g => g > 300).length / 4;
    const diff = todayAvg - cmpAvg;

    breakHost.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr style="border-bottom:1px solid var(--bd)">
            <th style="padding:6px 8px;text-align:left;color:var(--tx3);font-weight:600">Metric</th>
            <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">Value</th>
            <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">Unit</th>
            <th style="padding:6px 8px;text-align:left;color:var(--tx3);font-weight:600">Note</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace">Today min</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:#14D3A9">${todayMin.toFixed(0)}</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">g/kWh</td><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;color:var(--tx3)">cleanest slot</td></tr>
          <tr><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace">Today max</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:#ED6965">${todayMax.toFixed(0)}</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">g/kWh</td><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;color:var(--tx3)">dirtiest slot</td></tr>
          <tr><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace">Today avg</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace">${todayAvg.toFixed(0)}</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">g/kWh</td><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;color:var(--tx3)">24h average</td></tr>
          <tr><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace">${cmpLabel} avg</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${cmpAvg.toFixed(0)}</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">g/kWh</td><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;color:var(--tx3)">comparison baseline</td></tr>
          <tr><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace">Δ vs ${cmpLabel}</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:${diff < 0 ? '#14D3A9' : '#ED6965'}">${diff >= 0 ? '+' : ''}${diff.toFixed(0)}</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">g/kWh</td><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${diff < 0 ? 'cleaner today' : 'dirtier today'}</td></tr>
          <tr><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace">Clean hours</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:#14D3A9">${cleanH.toFixed(1)}</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">h / 24</td><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;color:var(--tx3)">below 100 g/kWh</td></tr>
          <tr><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace">Dirty hours</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:#ED6965">${dirtyH.toFixed(1)}</td><td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">h / 24</td><td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;color:var(--tx3)">above 300 g/kWh</td></tr>
        </tbody>
      </table>
      <div style="margin-top:14px;border-top:1px solid var(--bd);padding-top:12px">
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);font-weight:600;margin-bottom:8px">Hypothèses de calcul</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--tx2);line-height:1.6;margin-bottom:10px">
          Intensité carbone du mix, par pas de 15 min :<br>
          <span style="color:var(--tx)">CI(t) = Σ<sub>f</sub> [ génération<sub>f</sub>(t) × FE<sub>f</sub> ] / Σ<sub>f</sub> génération<sub>f</sub>(t)</span><br>
          <span style="color:var(--tx3)">Approche moyenne (attributionnelle), périmètre cycle de vie. Pas de FE marginal, pas d'imports.</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px">
          <thead><tr>
            <th style="padding:5px 8px;text-align:left;color:var(--tx3);font-weight:600">Filière</th>
            <th style="padding:5px 8px;text-align:right;color:var(--tx3);font-weight:600">FE (g CO₂eq/kWh)</th>
            <th style="padding:5px 8px;text-align:left;color:var(--tx3);font-weight:600">Données génération</th>
          </tr></thead>
          <tbody>
            ${STACK.map(f => `<tr style="border-top:1px solid var(--bd)">
              <td style="padding:5px 8px;font-family:'JetBrains Mono',monospace"><span style="color:${GM_FUEL_META[f].color}">${GM_FUEL_META[f].emoji} ${GM_FUEL_META[f].label}</span></td>
              <td style="padding:5px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx)">${GM_FUEL_META[f].co2}</td>
              <td style="padding:5px 8px;font-family:'JetBrains Mono',monospace;color:var(--tx3)">ENTSO-E A75 · 15 min</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx3);line-height:1.6">
          <span style="color:var(--tx2)">Sources :</span> génération par filière = ENTSO-E Transparency (Actual Generation per Type, A75), archive PowerKlock 15 min. Facteurs d'émission = base ADEME / GIEC (médianes cycle de vie). « Fossil » = moyenne gaz/charbon agrégée ENTSO-E.
        </div>
      </div>`;
  }
}
function _gmDrillRenderNetPos(zone, mix, st) {
  const host = document.getElementById('gm-drill-content');
  const breakHost = document.getElementById('gm-drill-breakdown');
  if (!host) return;
  host.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;text-align:center;padding:40px">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7A93AB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:16px;opacity:.6">
        <path d="M7 7h10M7 12h10M7 17h10M5 7l-2 5 2 5M19 7l2 5-2 5"/>
      </svg>
      <div style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx);font-weight:600;margin-bottom:8px;letter-spacing:.02em">Net position · cross-border flows</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--tx3);max-width:520px;line-height:1.6;letter-spacing:.02em">
        Physical flows on each interconnector + daily net position (importer / exporter).<br><br>
        Requires the <strong style="color:var(--tx)">ENTSO-E cross-border physical flows</strong> endpoint
        (not yet in <code style="background:var(--bg);padding:2px 6px;border-radius:3px;color:#14D3A9">fetch_data.py</code>).
      </div>
    </div>`;
  if (breakHost) breakHost.innerHTML = `<div style="padding:14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--tx3);text-align:center">No interconnector data yet. Will ship in v2.1 once ENTSO-E flows are integrated.</div>`;
}

function _gmBuildBreakdownTable(mix, st) {
  const fmt = v => (v == null || isNaN(v)) ? '--' : v.toFixed(2);
  const rows = GM_FUEL_ORDER.map(k => {
    const v = mix[k] || 0;
    if (v <= 0) return null;
    const m = GM_FUEL_META[k];
    const pct = (v / st.total) * 100;
    return `<tr>
      <td style="padding:6px 8px;font-family:'JetBrains Mono',monospace"><span style="color:${m.color}">${m.emoji} ${m.label}</span></td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx)">${fmt(v / 1000)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx2)">${pct.toFixed(2)}%</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${m.co2}</td>
    </tr>`;
  }).filter(r => r).join('');
  return `
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead>
        <tr>
          <th style="padding:4px 8px;text-align:left;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Source</th>
          <th style="padding:4px 8px;text-align:right;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">GW</th>
          <th style="padding:4px 8px;text-align:right;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">% Share</th>
          <th style="padding:4px 8px;text-align:right;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">g CO₂/kWh</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── Chart builders ──────────────────────────────────────────────
function _gmBuildDonut(mix, st, canvasId, fullscreen) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  const fuels  = GM_FUEL_ORDER.filter(k => (mix[k] || 0) > 0);
  const labels = fuels.map(k => GM_FUEL_META[k].label);
  const dataArr = fuels.map(k => mix[k] || 0);
  const colors  = fuels.map(k => GM_FUEL_META[k].color);

  const targetVar = fullscreen ? '_GM_FS_DONUT_CHART' : '_GM_DONUT_CHART';
  if (window[targetVar]) {
    try { window[targetVar].destroy(); } catch (_) {}
  }

  window[targetVar] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: dataArr,
        backgroundColor: colors,
        borderColor: 'var(--bg2)',
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: 'rgba(184,201,217,.85)',
            font: { size: fullscreen ? 13 : 11, family: "'Inter', sans-serif" },
            usePointStyle: true,
            padding: 10,
            generateLabels: (chart) => {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((l, i) => ({
                text: `${l} · ${(ds.data[i] / st.total * 100).toFixed(1)}%`,
                fillStyle: ds.backgroundColor[i],
                strokeStyle: ds.backgroundColor[i],
                lineWidth: 0,
                hidden: false,
                index: i,
              }));
            },
          },
        },
        tooltip: {
          backgroundColor: '#0f1419',
          borderColor: 'rgba(255,255,255,.08)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed;
              const pct = (v / st.total * 100).toFixed(2);
              return `${ctx.label}: ${(v/1000).toFixed(2)} GW (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function _gmBuildBar(mix, st, canvasId, fullscreen) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  const fuels  = GM_FUEL_ORDER.filter(k => (mix[k] || 0) > 0);
  // Sort by value desc
  fuels.sort((a, b) => (mix[b] || 0) - (mix[a] || 0));
  const labels = fuels.map(k => `${GM_FUEL_META[k].emoji} ${GM_FUEL_META[k].label}`);
  const dataArr = fuels.map(k => (mix[k] || 0) / 1000);
  const colors  = fuels.map(k => GM_FUEL_META[k].color);

  const targetVar = fullscreen ? '_GM_FS_BAR_CHART' : '_GM_BAR_CHART';
  if (window[targetVar]) {
    try { window[targetVar].destroy(); } catch (_) {}
  }

  window[targetVar] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: dataArr,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 0,
        borderRadius: 3,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f1419',
          borderColor: 'rgba(255,255,255,.08)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.x;
              const pct = (v * 1000 / st.total * 100).toFixed(2);
              return `${v.toFixed(2)} GW (${pct}%)`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: 'rgba(184,201,217,.6)', font: { size: fullscreen ? 12 : 10, family: "'JetBrains Mono', monospace" } },
          grid:  { color: 'rgba(255,255,255,.04)' },
          title: { display: true, text: 'GW', color: 'rgba(184,201,217,.4)', font: { size: 10 } },
        },
        y: {
          ticks: { color: 'rgba(184,201,217,.85)', font: { size: fullscreen ? 13 : 11, family: "'Inter', sans-serif" } },
          grid:  { display: false },
        },
      },
    },
  });
}

// ── PNG download (both charts on one image — render via composite) ──
function _gmDownloadChart(zone) {
  // Simple version: download donut chart only (most representative)
  const chart = window._GM_DONUT_CHART;
  if (!chart) return;
  const bgFill = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#0a0d12';
  const dataUrl = chart.toBase64Image('image/png', 1, bgFill);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `powerklock_genmix_${zone}_${new Date().toISOString().slice(0,10)}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
window._gmDownloadChart = _gmDownloadChart;

// ── Fullscreen overlay ─────────────────────────────────────────
function _gmOpenFullscreen(zone) {
  const mix = window._GM_LAST_MIX;
  const st  = window._GM_LAST_ST;
  if (!mix || !st) return;
  const country = GM_ZONE_NAMES[zone] || zone;
  const flag    = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[zone]) || '';

  let fs = document.getElementById('gm-fs-overlay');
  if (fs) fs.remove();

  fs = document.createElement('div');
  fs.id = 'gm-fs-overlay';
  fs.style.cssText = `
    position: fixed; inset: 0; background: var(--bg);
    z-index: 9999; display: flex; flex-direction: column;
    padding: 16px 24px 24px; overflow: hidden;
  `;
  fs.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-shrink:0">
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--tx);letter-spacing:-0.01em">${flag} ${zone} — ${country}</div>
        <div style="font-size:12px;color:var(--tx2);margin-top:2px">Generation Mix · Live snapshot · ${(st.total/1000).toFixed(2)} GW total</div>
      </div>
      <button id="gm-fs-close-btn" style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:8px 14px;font-size:12px;border-radius:6px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">✕ Close (Esc)</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;flex:1;min-height:0">
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:18px;display:flex;flex-direction:column;min-height:0">
        <div style="font-size:11px;font-weight:700;color:var(--tx2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;flex-shrink:0">Fuel mix · share</div>
        <div style="flex:1;position:relative;min-height:0">
          <canvas id="gm-fs-donut" style="width:100%;height:100%"></canvas>
        </div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:18px;display:flex;flex-direction:column;min-height:0">
        <div style="font-size:11px;font-weight:700;color:var(--tx2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;flex-shrink:0">Fuel mix · GW per source</div>
        <div style="flex:1;position:relative;min-height:0">
          <canvas id="gm-fs-bar" style="width:100%;height:100%"></canvas>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(fs);
  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    _gmBuildDonut(mix, st, 'gm-fs-donut', true);
    _gmBuildBar(mix, st, 'gm-fs-bar', true);
  }, 50);

  document.getElementById('gm-fs-close-btn').addEventListener('click', _gmCloseFullscreen);
  document.addEventListener('keydown', _gmFsEscHandler);
}
window._gmOpenFullscreen = _gmOpenFullscreen;

function _gmFsEscHandler(e) {
  if (e.key === 'Escape') _gmCloseFullscreen();
}
function _gmCloseFullscreen() {
  const fs = document.getElementById('gm-fs-overlay');
  if (fs) fs.remove();
  document.body.style.overflow = '';
  if (window._GM_FS_DONUT_CHART) { try { window._GM_FS_DONUT_CHART.destroy(); } catch(_) {} window._GM_FS_DONUT_CHART = null; }
  if (window._GM_FS_BAR_CHART)   { try { window._GM_FS_BAR_CHART.destroy(); }   catch(_) {} window._GM_FS_BAR_CHART = null; }
  document.removeEventListener('keydown', _gmFsEscHandler);
}
window._gmCloseFullscreen = _gmCloseFullscreen;

// ════════════════════════════════════════════════════════════════
// BLOCK 2 · Single zone deep-dive
// Insta tabs: Donut · Bars · Stacked · Capacity factor
// ════════════════════════════════════════════════════════════════
function setGmSingleZone(zone) {
  GM.singleZone = zone;
  renderGmSingle();
}
function setGmSingleTab(tab, btn) {
  GM.singleTab = tab;
  // Update active class
  const parent = btn.parentElement;
  parent.querySelectorAll('.hw-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderGmSingle();
}
window.setGmSingleZone = setGmSingleZone;
window.setGmSingleTab  = setGmSingleTab;

function renderGmSingle() {
  const zone = GM.singleZone;
  const data = window._genmixData;
  if (!data?.[zone]) return;
  const mix = data[zone];
  const st  = _gmStats(mix);
  if (!st) return;

  const periodEl = document.getElementById('gm-single-period');
  if (periodEl) periodEl.textContent = `${zone} · live · ${(st.total/1000).toFixed(2)} GW total`;

  const canvas = document.getElementById('gm-single-canvas');
  const legend = document.getElementById('gm-single-legend');
  if (!canvas) return;

  if (window._GM_SINGLE_CHART) {
    try { window._GM_SINGLE_CHART.destroy(); } catch (_) {}
    window._GM_SINGLE_CHART = null;
  }

  const tab = GM.singleTab;
  if (tab === 'donut') {
    _gmSingleDonut(canvas, mix, st);
    if (legend) legend.textContent = 'Click a legend item to toggle';
  } else if (tab === 'bars') {
    _gmSingleBars(canvas, mix, st);
    if (legend) legend.textContent = 'Bars sorted by generation in GW';
  } else if (tab === 'stacked') {
    _gmSingleStacked(canvas, mix, st);
    if (legend) legend.textContent = 'Stacked horizontal bar — 100% share';
  } else if (tab === 'capacity') {
    _gmSingleCapacityFactor(canvas, mix, st, zone);
    if (legend) legend.textContent = 'Capacity factor proxy: actual / estimated installed (rough)';
  }
}
window.renderGmSingle = renderGmSingle;

function _gmSingleDonut(canvas, mix, st) {
  const fuels  = GM_FUEL_ORDER.filter(k => (mix[k] || 0) > 0);
  const labels = fuels.map(k => GM_FUEL_META[k].label);
  const data   = fuels.map(k => mix[k] || 0);
  const colors = fuels.map(k => GM_FUEL_META[k].color);
  window._GM_SINGLE_CHART = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: 'var(--bg2)', borderWidth: 2, hoverOffset: 10 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: 'rgba(184,201,217,.9)', font: { size: 12, family: "'Inter', sans-serif" }, usePointStyle: true, padding: 12,
            generateLabels: (chart) => {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((l, i) => ({ text: `${l} · ${(ds.data[i] / st.total * 100).toFixed(1)}%`, fillStyle: ds.backgroundColor[i], strokeStyle: ds.backgroundColor[i], lineWidth: 0, hidden: false, index: i }));
            },
          },
        },
        tooltip: { backgroundColor: '#0f1419', borderColor: 'rgba(255,255,255,.08)', borderWidth: 1, padding: 10,
          callbacks: { label: (ctx) => `${ctx.label}: ${(ctx.parsed/1000).toFixed(2)} GW (${(ctx.parsed/st.total*100).toFixed(2)}%)` } },
      },
    },
  });
}

function _gmSingleBars(canvas, mix, st) {
  const fuels  = GM_FUEL_ORDER.filter(k => (mix[k] || 0) > 0);
  fuels.sort((a, b) => (mix[b] || 0) - (mix[a] || 0));
  const labels = fuels.map(k => `${GM_FUEL_META[k].emoji} ${GM_FUEL_META[k].label}`);
  const data   = fuels.map(k => (mix[k] || 0) / 1000);
  const colors = fuels.map(k => GM_FUEL_META[k].color);
  window._GM_SINGLE_CHART = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#0f1419', padding: 10, callbacks: { label: (ctx) => `${ctx.parsed.x.toFixed(2)} GW (${(ctx.parsed.x*1000/st.total*100).toFixed(2)}%)` } },
      },
      scales: {
        x: { ticks: { color: 'rgba(184,201,217,.6)', font: { size: 11, family: "'JetBrains Mono', monospace" } }, grid: { color: 'rgba(255,255,255,.04)' }, title: { display: true, text: 'GW', color: 'rgba(184,201,217,.4)' } },
        y: { ticks: { color: 'rgba(184,201,217,.9)', font: { size: 12, family: "'Inter', sans-serif" } }, grid: { display: false } },
      },
    },
  });
}

function _gmSingleStacked(canvas, mix, st) {
  // 100% stacked horizontal bar — one row showing all fuel shares
  const fuels = GM_FUEL_ORDER.filter(k => (mix[k] || 0) > 0);
  const datasets = fuels.map(k => ({
    label: GM_FUEL_META[k].label,
    data:  [(mix[k] || 0) / st.total * 100],
    backgroundColor: GM_FUEL_META[k].color,
    borderWidth: 0,
    barThickness: 60,
  }));
  window._GM_SINGLE_CHART = new Chart(canvas, {
    type: 'bar',
    data: { labels: [''], datasets },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: 'rgba(184,201,217,.9)', font: { size: 12 }, usePointStyle: true, padding: 12 } },
        tooltip: { backgroundColor: '#0f1419', padding: 10, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(2)}%` } },
      },
      scales: {
        x: { stacked: true, max: 100, ticks: { color: 'rgba(184,201,217,.6)', callback: (v) => v + '%' }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: { stacked: true, display: false, grid: { display: false } },
      },
    },
  });
}

function _gmSingleCapacityFactor(canvas, mix, st, zone) {
  // Rough installed-capacity assumptions per zone (in MW) — used as a proxy
  // for capacity factor (= actual generation / installed capacity)
  // Source: ENTSO-E TYNDP / approximate end-2024 values
  const installedMW = {
    FR:      { wind: 23000,  solar: 22000,  nuclear: 61400, hydro: 25700, fossil: 19000 },
    DE_LU:   { wind: 70000,  solar: 90000,  nuclear: 0,     hydro: 11000, fossil: 70000 },
    ES:      { wind: 31000,  solar: 27000,  nuclear: 7100,  hydro: 17000, fossil: 25000 },
    BE:      { wind: 6000,   solar: 8000,   nuclear: 3900,  hydro: 1400,  fossil: 8000  },
    NL:      { wind: 11000,  solar: 23000,  nuclear: 500,   hydro: 0,     fossil: 27000 },
    GB:      { wind: 30000,  solar: 16000,  nuclear: 5900,  hydro: 4700,  fossil: 36000 },
    PT:      { wind: 6000,   solar: 4500,   nuclear: 0,     hydro: 8000,  fossil: 5000  },
    IT_NORD: { wind: 12000,  solar: 35000,  nuclear: 0,     hydro: 22000, fossil: 50000 },
  };
  const inst = installedMW[zone] || installedMW.FR;
  const fuels = ['wind','solar','nuclear','hydro','fossil'];
  const labels = fuels.map(k => `${GM_FUEL_META[k].emoji} ${GM_FUEL_META[k].label}`);
  const dataCF = fuels.map(k => {
    const a = mix[k] || 0;
    const cap = inst[k] || 1;
    return Math.min(100, (a / cap) * 100);
  });
  const colors = fuels.map(k => GM_FUEL_META[k].color);
  window._GM_SINGLE_CHART = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data: dataCF, backgroundColor: colors, borderWidth: 0, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#0f1419', padding: 10, callbacks: { label: (ctx) => `${ctx.parsed.x.toFixed(1)}% capacity factor` } },
      },
      scales: {
        x: { max: 100, ticks: { color: 'rgba(184,201,217,.6)', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,.04)' }, title: { display: true, text: 'Capacity factor proxy (%)', color: 'rgba(184,201,217,.4)' } },
        y: { ticks: { color: 'rgba(184,201,217,.9)', font: { size: 12 } }, grid: { display: false } },
      },
    },
  });
}

// ════════════════════════════════════════════════════════════════
// BLOCK 3 · Cross-zones compare
// Heatmap %fuel + Sorted %REN bar + Auto insights
// ════════════════════════════════════════════════════════════════
function renderGmCompare() {
  const data = window._genmixData;
  if (!data || !Object.keys(data).length) return;

  const zones = Object.keys(data).filter(z => data[z]?.total > 0)
                                 .sort((a, b) => (data[b].total || 0) - (data[a].total || 0));
  const fuels = GM_FUEL_ORDER;

  // ── Heatmap ──
  const heatCt = document.getElementById('gm-compare-heatmap');
  if (heatCt) {
    let html = '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    // Header
    html += '<thead><tr><th style="padding:8px;text-align:left;color:var(--tx3);font-weight:600">Zone</th>';
    fuels.forEach(k => {
      const m = GM_FUEL_META[k];
      html += `<th style="padding:8px;text-align:center;color:${m.color};font-weight:600;font-size:11px">${m.emoji} ${m.label}</th>`;
    });
    html += '<th style="padding:8px;text-align:right;color:var(--tx3);font-weight:600">Total</th></tr></thead>';
    html += '<tbody>';
    zones.forEach(z => {
      const mix = data[z]; const st = _gmStats(mix);
      if (!st) return;
      const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
      html += `<tr style="border-top:1px solid var(--bd)"><td style="padding:8px;font-weight:600">${flag} ${z}</td>`;
      fuels.forEach(k => {
        const pct = ((mix[k] || 0) / st.total) * 100;
        // Heatmap cell colour intensity
        const m = GM_FUEL_META[k];
        const opacity = Math.min(0.85, pct / 50);  // 50% share → opaque
        const bg = `rgba(${_hexToRgb(m.color)},${opacity})`;
        const txc = opacity > 0.4 ? '#fff' : 'var(--tx2)';
        html += `<td style="padding:8px;text-align:center;background:${bg};color:${txc};font-family:'JetBrains Mono',monospace">${pct.toFixed(1)}%</td>`;
      });
      html += `<td style="padding:8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${(st.total/1000).toFixed(1)} GW</td></tr>`;
    });
    html += '</tbody></table>';
    heatCt.innerHTML = html;
  }

  // ── Sorted %REN bar ──
  const renBar = document.getElementById('gm-compare-renbar');
  if (renBar) {
    const ranked = zones.map(z => {
      const mix = data[z]; const st = _gmStats(mix);
      return st ? { z, renPct: st.renPct } : null;
    }).filter(Boolean).sort((a, b) => b.renPct - a.renPct);
    const max = Math.max(...ranked.map(r => r.renPct), 1);
    let html = '<div style="display:flex;flex-direction:column;gap:6px">';
    ranked.forEach(r => {
      const c = _gmRenColor(r.renPct);
      const w = (r.renPct / max * 100).toFixed(1);
      const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[r.z]) || '';
      html += `<div style="display:flex;align-items:center;gap:10px">
        <div style="width:80px;font-size:11px;font-weight:600">${flag} ${r.z}</div>
        <div style="flex:1;background:rgba(255,255,255,0.04);border-radius:3px;height:18px;position:relative;overflow:hidden">
          <div style="width:${w}%;height:100%;background:${c};border-radius:3px;transition:width .3s"></div>
          <span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${w > 30 ? '#fff' : 'var(--tx2)'}">${r.renPct.toFixed(1)}%</span>
        </div>
      </div>`;
    });
    html += '</div>';
    renBar.innerHTML = html;
  }

  // ── Auto insights ──
  const insightsEl = document.getElementById('gm-compare-insights');
  if (insightsEl) {
    const stats = zones.map(z => ({ z, ...(_gmStats(data[z]) || {}) }));
    const greenest = [...stats].sort((a, b) => (b.renPct || 0) - (a.renPct || 0))[0];
    const dirtiest = [...stats].sort((a, b) => (a.renPct || 0) - (b.renPct || 0))[0];
    const lowestCo2 = [...stats].sort((a, b) => (a.co2 || 1e9) - (b.co2 || 1e9))[0];
    const highestCo2 = [...stats].sort((a, b) => (b.co2 || 0) - (a.co2 || 0))[0];
    const biggestSolar = [...stats].sort((a, b) => (data[b.z]?.solar || 0) / (b.total || 1) - (data[a.z]?.solar || 0) / (a.total || 1))[0];
    const biggestWind  = [...stats].sort((a, b) => (data[b.z]?.wind  || 0) / (b.total || 1) - (data[a.z]?.wind  || 0) / (a.total || 1))[0];

    const insights = [
      { icon: '🌱', txt: `<strong>${greenest.z}</strong> has the highest renewable share at <strong style="color:#14D3A9">${greenest.renPct.toFixed(1)}%</strong>`, color: '#14D3A9' },
      { icon: '🔥', txt: `<strong>${dirtiest.z}</strong> has the lowest renewable share at <strong style="color:#ED6965">${dirtiest.renPct.toFixed(1)}%</strong>`, color: '#ED6965' },
      { icon: '✅', txt: `<strong>${lowestCo2.z}</strong> has the lowest CO₂ intensity at <strong style="color:#14D3A9">${Math.round(lowestCo2.co2)} g/kWh</strong>`, color: '#14D3A9' },
      { icon: '⚠', txt: `<strong>${highestCo2.z}</strong> has the highest CO₂ intensity at <strong style="color:#ED6965">${Math.round(highestCo2.co2)} g/kWh</strong>`, color: '#ED6965' },
      { icon: '☀', txt: `<strong>${biggestSolar.z}</strong> has the highest solar share at <strong style="color:#FBBF24">${((data[biggestSolar.z]?.solar||0)/biggestSolar.total*100).toFixed(1)}%</strong>`, color: '#FBBF24' },
      { icon: '⌬', txt: `<strong>${biggestWind.z}</strong> has the highest wind share at <strong style="color:#14D3A9">${((data[biggestWind.z]?.wind||0)/biggestWind.total*100).toFixed(1)}%</strong>`, color: '#14D3A9' },
    ];
    insightsEl.innerHTML = insights.map(i => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg3);border-left:3px solid ${i.color};border-radius:4px;font-size:12px;color:var(--tx)">
        <span style="font-size:14px;flex-shrink:0">${i.icon}</span>
        <span>${i.txt}</span>
      </div>
    `).join('');
  }
}
window.renderGmCompare = renderGmCompare;

// ── Hex to RGB ─────
function _hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

// ════════════════════════════════════════════════════════════════
// BLOCK 4 · Historical wind & solar trends
// ════════════════════════════════════════════════════════════════
function setGmHistZone(zone) {
  GM.histZone = zone;
  renderGmHistory();
}
function setGmHistWindow(w, btn) {
  GM.histWindow = w;
  const parent = btn.parentElement;
  parent.querySelectorAll('.hw-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderGmHistory();
}
window.setGmHistZone   = setGmHistZone;
window.setGmHistWindow = setGmHistWindow;

async function renderGmHistory() {
  const zone = GM.histZone;
  const w    = GM.histWindow;
  const canvas = document.getElementById('gm-hist-canvas');
  const periodEl = document.getElementById('gm-hist-period');

  if (periodEl) periodEl.textContent = `${zone} · ${w} · loading...`;

  // ──────────────────────────────────────────────────────────────
  // Fetch enriched summary.json — contains per-fuel daily avg/max
  // (windAvg, solarAvg, nuclearAvg, hydroAvg, fossilAvg, biomassAvg, ...Max)
  // Falls back to per-day fetch if summary lacks these fields (backward compat)
  // ──────────────────────────────────────────────────────────────
  let series = [];
  let fullZoneData = [];  // unfiltered series for rolling-window context
  try {
    if (!window._GM_HIST_SUMMARY_CACHE) {
      const r = await fetch('data/history/summary.json');
      if (r.ok) window._GM_HIST_SUMMARY_CACHE = await r.json();
    }
    const summary = window._GM_HIST_SUMMARY_CACHE;
    const zoneData = summary?.zones?.[zone];
    if (zoneData && zoneData.length) {
      fullZoneData = zoneData.map(e => ({
        d:         e.d,
        windAvg:   e.windAvg    ?? null,
        windMax:   e.windMax    ?? null,
        solarAvg:  e.solarAvg   ?? null,
        solarMax:  e.solarMax   ?? null,
        nuclearAvg:e.nuclearAvg ?? null,
        hydroAvg:  e.hydroAvg   ?? null,
        fossilAvg: e.fossilAvg  ?? null,
        biomassAvg:e.biomassAvg ?? null,
      }));
      // Filter by window
      const days = _gmHistDaysForWindow(w);
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const filtered = (w === 'All') ? fullZoneData : fullZoneData.filter(e => e.d >= cutoffStr);
      series = filtered.filter(s => s.windAvg != null || s.solarAvg != null);
    }
  } catch (e) {
    console.warn('GenMix history fetch error:', e);
  }

  // Backward-compatible fallback (slow path): fetch daily files if summary empty
  if (!series.length) {
    if (periodEl) periodEl.textContent = `${zone} · ${w} · fallback fetch (slow)`;
    const days = _gmHistDaysForWindow(w);
    const today = new Date();
    for (let i = 0; i < Math.min(days, 31); i++) {  // cap fallback at 31 days for safety
      const d = new Date(today); d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      try {
        const r = await fetch(`data/history/daily/${ds}.json`);
        if (!r.ok) continue;
        const j = await r.json();
        const z = j?.zones?.[zone];
        if (!z) continue;
        const meanOf = arr => {
          const vv = (arr || []).filter(v => v != null);
          return vv.length ? vv.reduce((a,b)=>a+b,0)/vv.length : null;
        };
        const maxOf = arr => {
          const vv = (arr || []).filter(v => v != null);
          return vv.length ? Math.max(...vv) : null;
        };
        if ((z.wind || z.solar) && (z.wind?.length || z.solar?.length)) {
          series.push({
            d: ds,
            windAvg:   meanOf(z.wind),  windMax:   maxOf(z.wind),
            solarAvg:  meanOf(z.solar), solarMax:  maxOf(z.solar),
            nuclearAvg:meanOf(z.nuclear),
            hydroAvg:  meanOf(z.hydro),
            fossilAvg: meanOf(z.fossil),
            biomassAvg:meanOf(z.biomass),
          });
        }
      } catch (e) { /* silent */ }
    }
    series.sort((a, b) => a.d.localeCompare(b.d));
  }

  if (!series.length) {
    if (periodEl) periodEl.textContent = `${zone} · ${w} · no data`;
    _setText('gm-hist-kpi-wind',  '--', 'GW');
    _setText('gm-hist-kpi-solar', '--', 'GW');
    _setText('gm-hist-kpi-windmax',  '--', 'GW');
    _setText('gm-hist-kpi-solarmax', '--', 'GW');
    _setText('gm-hist-kpi-cf', '--', '%');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#7A93AB';
      ctx.font = '13px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('No wind/solar history found for this zone & window', canvas.width / 2, canvas.height / 2);
      ctx.fillStyle = '#5A6F88';
      ctx.font = '11px Inter';
      ctx.fillText('Run enrich_summary.py to populate the summary, or check fetch_data.py', canvas.width / 2, canvas.height / 2 + 22);
    }
    return;
  }

  // KPIs
  const winds  = series.map(s => s.windAvg).filter(v => v != null);
  const solars = series.map(s => s.solarAvg).filter(v => v != null);
  const windMaxes  = series.map(s => s.windMax).filter(v => v != null);
  const solarMaxes = series.map(s => s.solarMax).filter(v => v != null);

  const windAvg   = winds.length  ? winds.reduce((a,b)=>a+b,0)/winds.length  : null;
  const solarAvg  = solars.length ? solars.reduce((a,b)=>a+b,0)/solars.length : null;
  const windPeak  = windMaxes.length  ? Math.max(...windMaxes)  : null;
  const solarPeak = solarMaxes.length ? Math.max(...solarMaxes) : null;
  const windCF    = (windAvg != null && windPeak != null && windPeak > 0) ? (windAvg / windPeak * 100) : null;

  _setText('gm-hist-kpi-wind',     windAvg  != null ? (windAvg/1000).toFixed(2)  : '--', 'GW');
  _setText('gm-hist-kpi-windmax',  windPeak != null ? (windPeak/1000).toFixed(2) : '--', 'GW');
  _setText('gm-hist-kpi-solar',    solarAvg != null ? (solarAvg/1000).toFixed(2) : '--', 'GW');
  _setText('gm-hist-kpi-solarmax', solarPeak!= null ? (solarPeak/1000).toFixed(2): '--', 'GW');
  _setText('gm-hist-kpi-cf',       windCF   != null ? windCF.toFixed(1)          : '--', '%');

  if (periodEl) periodEl.textContent = `${zone} · ${series[0].d} → ${series[series.length-1].d} · ${series.length} days`;

  // Chart
  if (window._GM_HIST_CHART) {
    try { window._GM_HIST_CHART.destroy(); } catch (_) {}
  }
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = series.map(s => s.d);
  const windData    = series.map(s => s.windAvg    != null ? s.windAvg    / 1000 : null);
  const solarData   = series.map(s => s.solarAvg   != null ? s.solarAvg   / 1000 : null);
  const nuclearData = series.map(s => s.nuclearAvg != null ? s.nuclearAvg / 1000 : null);
  const hydroData   = series.map(s => s.hydroAvg   != null ? s.hydroAvg   / 1000 : null);
  const fossilData  = series.map(s => s.fossilAvg  != null ? s.fossilAvg  / 1000 : null);
  // 7D rolling on wind, computed on the FULL zone series so a short window
  // (e.g. 7D) still gives a meaningful trend at the last visible point. Each
  // visible date looks up the 7 prior days from `fullZoneData`, even if those
  // days are outside the visible window.
  const r7Context = (filteredEntries, fullEntries, n, valKey) => {
    if (!filteredEntries.length) return [];
    const idx = new Map();
    fullEntries.forEach((e, i) => idx.set(e.d, i));
    const fullVals = fullEntries.map(e => (e[valKey] != null ? e[valKey] / 1000 : null));
    return filteredEntries.map(fe => {
      const i = idx.get(fe.d);
      if (i == null) return null;
      const slice = fullVals.slice(Math.max(0, i - n + 1), i + 1).filter(v => v != null);
      if (!slice.length) return null;
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
  };
  const windR7 = r7Context(series, fullZoneData, 7, 'windAvg');

  // Build datasets — only include fuels with non-null data
  const datasets = [
    { label: 'Wind',        data: windData,    borderColor: '#14D3A9', backgroundColor: 'rgba(20,211,169,0.08)', borderWidth: 1.5, pointRadius: 0, tension: 0, fill: true, spanGaps: true },
    { label: 'Solar',       data: solarData,   borderColor: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.08)', borderWidth: 1.5, pointRadius: 0, tension: 0, fill: true, spanGaps: true },
  ];
  if (nuclearData.some(v => v != null && v > 0)) datasets.push({ label: 'Nuclear', data: nuclearData, borderColor: '#7B4B9C', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [], pointRadius: 0, tension: 0, fill: false, spanGaps: true });
  if (hydroData.some(v => v != null && v > 0))   datasets.push({ label: 'Hydro',   data: hydroData,   borderColor: '#3FA6B4', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [], pointRadius: 0, tension: 0, fill: false, spanGaps: true });
  if (fossilData.some(v => v != null && v > 0))  datasets.push({ label: 'Fossil',  data: fossilData,  borderColor: '#ED6965', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [], pointRadius: 0, tension: 0, fill: false, spanGaps: true });
  datasets.push({ label: 'Wind 7D rolling', data: windR7, borderColor: '#94a3b8', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4,3], pointRadius: 0, tension: 0.2, fill: false, spanGaps: true });

  window._GM_HIST_CHART = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#0f1419', borderColor: 'rgba(255,255,255,.08)', borderWidth: 1, padding: 10,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? '--' : ctx.parsed.y.toFixed(2)} GW` } },
      },
      layout: { padding: { top: 16, bottom: 8 } },
      scales: {
        x: { type: 'category', ticks: { color: 'rgba(184,201,217,.5)', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,.03)' } },
        y: { grace: '5%', ticks: { color: 'rgba(184,201,217,.5)', font: { size: 10, family: "'JetBrains Mono', monospace" }, callback: v => v.toFixed(0) }, grid: { color: 'rgba(255,255,255,.04)' }, title: { display: true, text: 'GW', color: 'rgba(184,201,217,.4)', font: { size: 10 } } },
      },
    },
  });
}
window.renderGmHistory = renderGmHistory;

function _gmHistDaysForWindow(w) {
  const map = { '7D': 7, '1M': 31, '3M': 92, '1Y': 366, '2Y': 731, '5Y': 1827, 'All': 1827 };
  return map[w] || 31;
}

// ════════════════════════════════════════════════════════════════
// INIT — wire up on page load
// ════════════════════════════════════════════════════════════════
function _gmInit() {
  if (!window._genmixData) {
    // Retry shortly — genmix.json may still be loading
    setTimeout(_gmInit, 500);
    return;
  }
  renderGmMain();
  renderGmSingle();
  renderGmCompare();
  // Don't fetch history at init — only when block 4 is rendered for the first time
  // Trigger first render with default 1M
  renderGmHistory();
}
// Hook into page show
document.addEventListener('DOMContentLoaded', () => {
  // Re-render when the page is shown
  const observer = new MutationObserver(() => {
    const page = document.getElementById('page-genmix');
    if (page && page.classList.contains('active')) {
      _gmInit();
    }
  });
  const page = document.getElementById('page-genmix');
  if (page) {
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
    // Also trigger if already active
    if (page.classList.contains('active')) _gmInit();
  }
  // Sections are always open — no collapse/expand listeners needed.
});

// ── Backward-compat shim ──
// Legacy code (news.js, globals.js, prices.js, ticker.js) still calls
// loadGenMix() — keep it working by aliasing to the V2 init function.
window.loadGenMix = function() {
  window._genmixLoaded = true;
  if (typeof _gmInit === 'function') _gmInit();
};


// ════════════════════════════════════════════════════════════════
// GenMix selected-date state — drives the date-aware drill views
// (Stack now; Profile/Mix/Carbon once migrated to the stored archive).
// Empty/“Latest” clears the override → views resolve the latest stored day.
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// GenMix drill fullscreen — reuses the Prices fullscreen overlay
// (pkOpenFullscreen + pkBuildChartSource). Opens the active sub-tab's
// graph for the open zone, with its table beside it.
// scope = 'daily' | 'hist'
// ════════════════════════════════════════════════════════════════
function gmDrillFullscreen(scope) {
  if (typeof window.pkOpenFullscreen !== 'function' || typeof window.pkBuildChartSource !== 'function') return;
  const isHist = scope === 'hist';
  const tab = (isHist ? window._gmhDrillTab : window._gmDrillTab) || 'profile';
  const zone = (isHist ? window._gmhOpenZone : window._GM_DRILL_ZONE) || 'FR';
  const contentId = isHist ? 'gmh-drill-content' : 'gm-drill-content';
  const mixMode = (isHist ? window._gmhDrillMixMode : window._gmDrillMixMode) || 'donut';
  const kpiStripId = isHist ? 'gmh-drill-kpi-strip' : 'gm-drill-kpi-strip';
  const bannerId = isHist ? 'gmh-drill-banner-anchor' : 'gm-drill-banner-anchor';

  // ── chart source (canvas clone) or HTML mirror (stack / treemap) ──
  let chartId = null, htmlContainerId = null, isHtml = false, tableHtml = null;
  const reg = {};
  if (tab === 'profile') {
    chartId = 'p'; reg.p = isHist ? window._gmhDrillProfileChart : window._gmDrillProfileChart;
  } else if (tab === 'carbon') {
    chartId = 'c'; reg.c = isHist ? window._gmhDrillCarbonChart : window._gmDrillCarbonChart;
    const bh = document.getElementById(isHist ? 'gmh-drill-breakdown' : 'gm-drill-breakdown');
    if (bh && bh.innerHTML.trim()) tableHtml = bh.innerHTML;
  } else if (tab === 'mix') {
    if (mixMode === 'treemap') { isHtml = true; htmlContainerId = isHist ? 'gmh-drill-mix-treemap' : 'gm-drill-mix-treemap'; }
    else { chartId = 'm'; reg.m = (mixMode === 'bar') ? window._GM_BAR_CHART : window._GM_DONUT_CHART; }
    const mt = document.getElementById(isHist ? 'gmh-drill-mix-table' : 'gm-drill-mix-table');
    if (mt && mt.innerHTML.trim()) tableHtml = mt.innerHTML;
  } else { // stack, netpos, seasonal → HTML mirror (same approach Prices uses for Heatmap/Bands)
    isHtml = true; htmlContainerId = contentId;
  }
  const chartSource = window.pkBuildChartSource({
    chartId, htmlContainerId, isHtmlView: () => isHtml, chartsRegistry: () => reg,
  });

  // ── KPIs strip (clone of the inline drill strip) ──
  const stripEl = document.getElementById(kpiStripId);
  const kpisHtml = stripEl ? stripEl.outerHTML : null;

  // ── Analysis (the market-read banner) ──
  const bannerEl = document.getElementById(bannerId);
  const analysisHtml = (bannerEl && bannerEl.innerHTML.trim()) ? bannerEl.innerHTML : '';

  // ── Filters: View pills (switch sub-tab) + Date (mirrors Prices FS bar) ──
  const VIEWS = isHist
    ? [['profile', 'Profile'], ['mix', 'Mix'], ['carbon', 'Carbon'], ['seasonal', 'Seasonal'], ['stack', 'Stack']]
    : [['profile', 'Profile'], ['mix', 'Mix'], ['carbon', 'Carbon'], ['stack', 'Stack']];
  const viewPills = VIEWS.map(([k, lbl]) =>
    `<button data-gmfs-view="${k}" style="font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;border:1px solid ${k === tab ? 'rgba(20,211,169,0.4)' : 'var(--bd)'};background:${k === tab ? 'rgba(20,211,169,0.15)' : 'var(--bg)'};color:${k === tab ? '#14D3A9' : 'var(--tx3)'};font-family:'Inter',sans-serif;font-weight:500">${lbl}</button>`
  ).join('');
  const curDate = window._gmHistDate || '';
  const filtersHtml = `
    <div class="pk-fs-filters-left">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">View</span>
        <div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">${viewPills}</div>
      </div>
    </div>
    <div class="pk-fs-filters-right">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace">Date</span>
        <input type="date" id="fs-gm-date-input" value="${curDate}"
          style="background:var(--bg);border:1px solid var(--bd);color:var(--tx);font-size:11px;padding:3px 8px;border-radius:4px;font-family:inherit;cursor:pointer;color-scheme:dark">
        <button id="fs-gm-date-latest" style="border:1px solid var(--bd);background:var(--bg);color:var(--tx3);cursor:pointer;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-family:'JetBrains Mono',monospace;padding:3px 7px;border-radius:4px">Latest</button>
      </div>
    </div>`;

  const titles = { profile: 'Profile', mix: 'Mix', carbon: 'Carbon', netpos: 'Net position', stack: 'Production stack', seasonal: 'Seasonal' };
  const reopen = () => { setTimeout(() => requestAnimationFrame(() => gmDrillFullscreen(scope)), 320); };

  (window.pkOpenOrUpdate || window.pkOpenFullscreen)({
    title: `${zone} — GenMix · ${titles[tab] || tab}`,
    subtitle: `${isHist ? (window._gmhPeriod || '3M') + ' · ' : ''}${window._gmHistDate ? window._gmHistDate : 'latest'} · ENTSO-E A75`,
    filenameStem: `powerklock_genmix_${scope}_${zone}_${tab}`,
    storageKey: 'genmix-drill',
    kpis: kpisHtml ? { html: kpisHtml } : null,
    table: tableHtml ? { html: tableHtml } : null,
    analysis: { html: analysisHtml },
    chartSource,
    filters: {
      html: filtersHtml,
      wire: (hostEl) => {
        hostEl.querySelectorAll('[data-gmfs-view]').forEach(btn => {
          btn.addEventListener('click', () => {
            const v = btn.getAttribute('data-gmfs-view');
            if (v === tab) return;
            if (isHist && typeof window.setGmhDrillTab === 'function') window.setGmhDrillTab(v);
            else if (!isHist && typeof window.setGmDrillTab === 'function') window.setGmDrillTab(v);
            reopen();
          });
        });
        const dInp = hostEl.querySelector('#fs-gm-date-input');
        if (dInp) dInp.addEventListener('change', (e) => { window.gmSetHistDate(e.target.value); reopen(); });
        const dLatest = hostEl.querySelector('#fs-gm-date-latest');
        if (dLatest) dLatest.addEventListener('click', () => { window.gmSetHistDate(''); reopen(); });
      },
    },
  });
}
window.gmDrillFullscreen = gmDrillFullscreen;

// Daily cross-zone board fullscreen (chart for 'profiles' view, HTML mirror otherwise)
// Historical cross-zone board fullscreen (chart for 'trends', HTML mirror otherwise)
window.gmhczFullscreen = function () {
  if (typeof window.pkOpenFullscreen !== 'function' || typeof window.pkBuildChartSource !== 'function') return;
  const view = (window._gmhcz && window._gmhcz.view) || 'ranking';
  const isChart = view === 'trends';
  const reg = { g: window._gmhczTrendsChart };
  const cs = window.pkBuildChartSource({ chartId: 'g', htmlContainerId: 'gmhcz-content', isHtmlView: () => !isChart, chartsRegistry: () => reg });
  (window.pkOpenOrUpdate || window.pkOpenFullscreen)({
    title: 'GenMix — Cross-zone (historical)', subtitle: `${view} · ${window._gmhPeriod || '3M'}`,
    filenameStem: `powerklock_genmix_cz_hist_${view}`, storageKey: 'genmix-cz-hist', chartSource: cs,
  });
};

window.gmdczFullscreen = function () {
  if (typeof window.pkOpenFullscreen !== 'function' || typeof window.pkBuildChartSource !== 'function') return;
  const view = window._gmdczView || 'ranking';
  const isChart = view === 'profiles';
  const reg = { g: window._gmdczProfilesChart };
  const cs = window.pkBuildChartSource({ chartId: 'g', htmlContainerId: 'gmdcz-content', isHtmlView: () => !isChart, chartsRegistry: () => reg });
  (window.pkOpenOrUpdate || window.pkOpenFullscreen)({
    title: 'GenMix — Cross-zone', subtitle: `${view} · ENTSO-E A75`,
    filenameStem: `powerklock_genmix_crosszone_${view}`, storageKey: 'genmix-cz', chartSource: cs,
  });
};

window.gmSetHistDate = function (ds) {
  ds = (ds && /^\d{4}-\d{2}-\d{2}$/.test(ds)) ? ds : null;
  window._gmHistDate = ds;

  // sync the date control
  const input = document.getElementById('gm-date-picker-input');
  if (input) input.value = ds || '';
  const histInput = document.getElementById('gm-hist-date-input');
  if (histInput) histInput.value = ds || '';
  const latestBtn = document.getElementById('gm-date-latest-btn');
  if (latestBtn) latestBtn.style.color = ds ? 'var(--tx3)' : 'var(--accent)';

  // re-render whichever drill is open so the selected day propagates
  if (window._GM_DRILL_ZONE && document.getElementById('gm-drill-content') &&
      typeof _gmDrillDispatchRender === 'function') {
    _gmDrillDispatchRender(window._GM_DRILL_ZONE);
  }
  if (window._gmhOpenZone && document.getElementById('gmh-drill-content') &&
      typeof window._gmhOpenDrill === 'function') {
    window._gmhOpenDrill(window._gmhOpenZone);
  }
};


// Rendered on demand by the drill "Stack" sub-tab (daily + historical):
//   window.renderGenMixStack(containerId, zone, dateStr)
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// PowerKlock · GenMix production stack (eCO2mix-style, strict template)
// Self-contained module. Reads the 96-slot per-fuel arrays from the
// daily JSON (data/history/daily/<date>.json) and renders:
//   - stacked production area (24h) with Mint "now" cursor + MIN/MAX
//   - combined panel: per-fuel KPI list + vertical % bar on its right
//   - full per-fuel table below (instant / part / min / max / avg / CO2)
// Auto-wires on the GenMix page (daily + historical tabs) without
// touching genmix.js logic. Exposes window.renderGenMixStack().
// ════════════════════════════════════════════════════════════════
(function () {
  const FUEL = {
    nuclear: { label: 'Nuclear',     color: '#7B4B9C', co2: 12 },
    hydro:   { label: 'Hydro',       color: '#3FA6B4', co2: 24 },
    biomass: { label: 'Bioenergies', color: '#94D2BD', co2: 230 },
    wind:    { label: 'Wind',        color: '#14D3A9', co2: 11 },
    solar:   { label: 'Solar',       color: '#FBBF24', co2: 45 },
    fossil:  { label: 'Gas/Fossil',  color: '#ED6965', co2: 820 },
    other:   { label: 'Other',       color: '#7A93AB', co2: 400 },
  };
  const STACK = ['nuclear', 'hydro', 'biomass', 'wind', 'solar', 'fossil', 'other'];

  // ── one-time CSS (uses existing PowerKlock CSS vars) ──
  function injectCSS() {
    if (document.getElementById('gms-css')) return;
    const s = document.createElement('style');
    s.id = 'gms-css';
    s.textContent = `
    .gms-wrap{--mono:'JetBrains Mono',ui-monospace,monospace}
    .gms-body{display:grid;grid-template-columns:1fr 296px;gap:18px;align-items:stretch}
    .gms-chart-wrap{position:relative}
    .gms-rt{font-family:var(--mono);font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
    .gms-wrap svg{display:block;width:100%;height:300px}
    .gms-wrap .grid-line{stroke:rgba(255,255,255,.05)}
    .gms-wrap .axis-txt{fill:var(--tx3);font-family:var(--mono);font-size:11px}
    .gms-wrap .band-line{stroke:var(--tx4);stroke-dasharray:3 3;stroke-width:1}
    .gms-wrap .band-txt{fill:var(--tx3);font-family:var(--mono);font-size:10px;font-weight:600}
    .gms-wrap .now-line{stroke:var(--accent);stroke-width:2}
    .gms-wrap .j1-line{fill:none;stroke:var(--tx3);stroke-width:1.5;stroke-dasharray:4 4;opacity:.75}
    .gms-wrap .j1-txt{fill:var(--tx3);font-family:var(--mono);font-size:10px;font-weight:600;opacity:.85}
    .gms-wrap .area{stroke:none}
    .gms-nowpill{position:absolute;transform:translateX(-50%);background:var(--accent);color:#04201a;font-family:var(--mono);font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;white-space:nowrap;pointer-events:none}
    .gms-panel{background:var(--bg3);border:1px solid var(--bd);border-radius:8px;padding:14px;display:flex;gap:14px}
    .gms-panel-main{flex:1;display:flex;flex-direction:column;min-width:0}
    .gms-panel-hd{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);font-weight:600;margin-bottom:10px}
    .gms-panel-hd b{color:var(--accent)}
    .gms-list{display:flex;flex-direction:column;gap:7px;flex:1;justify-content:center}
    .gms-li{display:grid;grid-template-columns:16px 1fr auto auto;align-items:center;gap:8px}
    .gms-li .dot{width:14px;height:14px;border-radius:4px;border:1px solid rgba(255,255,255,.08)}
    .gms-li .nm{font-size:11px;color:var(--tx2);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .gms-li .vv{font-family:var(--mono);font-size:11px;color:var(--tx3);text-align:right}
    .gms-li .pc{font-family:var(--mono);font-size:13px;color:var(--tx);font-weight:700;text-align:right;min-width:34px}
    .gms-vbar{width:34px;border-radius:6px;overflow:hidden;display:flex;flex-direction:column-reverse;border:1px solid var(--bd2);align-self:stretch}
    .gms-vseg{width:100%}
    .gms-tbl-lab{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);font-weight:600;margin:18px 0 8px}
    .gms-wrap table{width:100%;border-collapse:collapse}
    .gms-wrap thead th{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--tx3);font-weight:600;padding:6px 10px;border-bottom:1px solid var(--bd2);text-align:right}
    .gms-wrap thead th:first-child{text-align:left}
    .gms-wrap tbody td{padding:6px 10px;font-family:var(--mono);font-size:11px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right}
    .gms-wrap tbody td:first-child{text-align:left}
    .gms-wrap tbody tr.total td{border-top:1px solid var(--bd2);font-weight:700;color:var(--tx);background:rgba(20,211,169,.04)}
    .gms-cellnm{display:inline-flex;align-items:center;gap:8px;font-weight:600}
    .gms-cellnm .dot{width:11px;height:11px;border-radius:3px}
    @media(max-width:820px){.gms-body{grid-template-columns:1fr}}
    `;
    document.head.appendChild(s);
  }

  function fmtDate(d) { return d.toISOString().slice(0, 10); }
  async function fetchDaily(ds) {
    try { const r = await fetch(`data/history/daily/${ds}.json`); if (!r.ok) return null; return await r.json(); }
    catch (_) { return null; }
  }
  function hasArrays(zd) {
    return zd && ['nuclear', 'hydro', 'fossil'].some(k => Array.isArray(zd[k]) && zd[k].some(v => v));
  }
  async function resolveLatest(zone) {
    const t = new Date();
    for (let i = 0; i < 8; i++) {
      const dt = new Date(t); dt.setDate(dt.getDate() - i);
      const ds = fmtDate(dt);
      const j = await fetchDaily(ds);
      if (j && j.zones && hasArrays(j.zones[zone])) return { ds, daily: j };
    }
    return null;
  }
  function synthDay(N) {
    const d = {}; STACK.forEach(f => d[f] = []);
    for (let i = 0; i < N; i++) {
      const h = i / N * 24;
      d.nuclear.push(40000 + 2500 * Math.sin((h - 7) / 24 * 2 * Math.PI));
      d.hydro.push(5500 + 3500 * Math.max(0, Math.sin((h - 12) / 24 * 2 * Math.PI)));
      d.biomass.push(690);
      d.wind.push(Math.max(400, 2500 + 1800 * Math.sin((h - 3) / 24 * 2 * Math.PI) + 800 * Math.sin(h / 2)));
      d.solar.push(13500 * Math.pow(Math.max(0, Math.sin((h - 6) / 12 * Math.PI)), 1.4));
      d.fossil.push(300 + 1400 * Math.max(0, Math.sin((h - 18) / 24 * 2 * Math.PI)));
      d.other.push(0);
    }
    return d;
  }

  window.renderGenMixStack = async function (containerId, zone, dateStr) {
    injectCSS();
    const host = document.getElementById(containerId);
    if (!host) return;
    zone = zone || 'FR';

    let daily = null, ds = dateStr || null, isReal = true;
    if (dateStr) daily = await fetchDaily(dateStr);
    if (!daily || !hasArrays(daily.zones && daily.zones[zone])) {
      const r = await resolveLatest(zone);
      if (r) { daily = r.daily; ds = r.ds; }
    }
    const zd = daily && daily.zones && daily.zones[zone];

    let DATA, N;
    if (hasArrays(zd)) {
      N = Math.max.apply(null, STACK.map(f => (Array.isArray(zd[f]) ? zd[f].length : 0)).concat([96]));
      DATA = {};
      STACK.forEach(f => {
        const a = Array.isArray(zd[f]) ? zd[f] : [];
        DATA[f] = new Array(N).fill(0).map((_, i) => (a[i] == null ? 0 : a[i]));
      });
    } else {
      N = 96; DATA = synthDay(N); isReal = false;
    }

    const dateLabel = ds || (daily && daily.date) || '—';

    // ── J-1 (previous stored day) total curve, resampled to N ──
    let prevTotals = null, prevDs = null;
    if (isReal && ds) {
      const pd = new Date(ds + 'T00:00:00'); pd.setDate(pd.getDate() - 1);
      prevDs = fmtDate(pd);
      const pj = await fetchDaily(prevDs);
      const pzd = pj && pj.zones && pj.zones[zone];
      if (hasArrays(pzd)) {
        const pN = Math.max.apply(null, STACK.map(f => (Array.isArray(pzd[f]) ? pzd[f].length : 0)).concat([1]));
        const pt = new Array(pN).fill(0);
        STACK.forEach(f => { const a = Array.isArray(pzd[f]) ? pzd[f] : []; for (let i = 0; i < pN; i++) pt[i] += (a[i] == null ? 0 : a[i]); });
        // resample pN → N
        prevTotals = new Array(N).fill(0).map((_, i) => pt[Math.min(pN - 1, Math.round(i / (N - 1) * (pN - 1)))]);
      }
    }

    // build DOM shell
    host.innerHTML =
      '<div class="gms-wrap">'
      + '<div class="gms-body">'
      +   '<div class="gms-chart-wrap"><div class="gms-rt">Production · stack (' + (N === 96 ? '15 min' : 'horaire') + ')</div>'
      +     '<svg viewBox="0 0 1000 440" preserveAspectRatio="none"></svg><div class="gms-nowpill" style="display:none"></div></div>'
      +   '<div class="gms-panel"><div class="gms-panel-main"><div class="gms-panel-hd">Mix instantané · <b class="gms-ptime">—</b></div><div class="gms-list"></div></div><div class="gms-vbar"></div></div>'
      + '</div>'
      + '<div class="gms-tbl-lab">Détail par filière · journée' + (isReal ? '' : ' · (données simulées — pas d\'arrays réels ce jour)') + '</div>'
      + '<table><thead><tr><th>Filière</th><th>Instant</th><th>Part</th><th>Min j.</th><th>Max j.</th><th>Moy j.</th><th>CO2</th></tr></thead><tbody></tbody></table>'
      + '</div>';

    const wrap = host.querySelector('.gms-wrap');
    const svg = wrap.querySelector('svg');
    const NS = 'http://www.w3.org/2000/svg';
    const elx = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

    const totals = []; for (let i = 0; i < N; i++) totals.push(STACK.reduce((s, f) => s + DATA[f][i], 0));
    // Last populated slot (the daily archive can be a partial day captured intraday)
    let nReal = 0; for (let i = N - 1; i >= 0; i--) { if (totals[i] > 0) { nReal = i + 1; break; } }
    if (nReal < 1) nReal = N;
    const realTotals = totals.slice(0, nReal);
    const maxTotal = Math.max.apply(null, realTotals), minTotal = Math.min.apply(null, realTotals);
    // J-1 last real slot
    let prevReal = 0; if (prevTotals) { for (let i = N - 1; i >= 0; i--) { if (prevTotals[i] > 0) { prevReal = i + 1; break; } } }
    const prevPeak = prevReal ? Math.max.apply(null, prevTotals.slice(0, prevReal)) : 0;
    const peakForScale = Math.max(maxTotal, prevPeak);
    const yMax = Math.max(10000, Math.ceil(peakForScale / 10000) * 10000);
    const STAT = {}; STACK.forEach(f => { const a = DATA[f].slice(0, nReal); STAT[f] = { min: Math.min.apply(null, a) / 1000, max: Math.max.apply(null, a) / 1000, avg: a.reduce((s, v) => s + v, 0) / a.length / 1000 }; });
    // Coverage note for partial days
    if (isReal && nReal < N) {
      const cm = Math.round(nReal / N * 24 * 60);
      const note = ' · données ENTSO-E jusqu\'à ' + String(Math.floor(cm / 60)).padStart(2, '0') + ':' + String(cm % 60).padStart(2, '0') + ' (jour en cours)';
      const lab = wrap.querySelector('.gms-tbl-lab'); if (lab) lab.insertAdjacentHTML('beforeend', '<span style="color:var(--tx4)">' + note + '</span>');
    }

    const W = 1000, H = 440, L = 52, R = 14, T = 12, B = 30;
    const px = i => L + i / (N - 1) * (W - L - R), py = v => T + (1 - v / yMax) * (H - T - B);
    let nowLine;
    (function draw() {
      svg.innerHTML = '';
      for (let g = 0; g <= yMax / 1000; g += 10) {
        const y = py(g * 1000);
        svg.appendChild(elx('line', { class: 'grid-line', x1: L, y1: y, x2: W - R, y2: y }));
        const tx = elx('text', { class: 'axis-txt', x: L - 6, y: y + 3, 'text-anchor': 'end' }); tx.textContent = g; svg.appendChild(tx);
      }
      const lower = new Array(N).fill(0);
      const lastI = nReal - 1;
      STACK.forEach(f => {
        const upper = lower.map((lo, i) => lo + DATA[f][i]);
        let d = 'M ' + px(0) + ' ' + py(lower[0]);
        for (let i = 0; i <= lastI; i++) d += ' L ' + px(i).toFixed(1) + ' ' + py(upper[i]).toFixed(1);
        for (let i = lastI; i >= 0; i--) d += ' L ' + px(i).toFixed(1) + ' ' + py(lower[i]).toFixed(1);
        d += ' Z';
        svg.appendChild(elx('path', { class: 'area', d: d, fill: FUEL[f].color, 'fill-opacity': .82 }));
        for (let i = 0; i < N; i++) lower[i] = upper[i];
      });
      [['MAX', maxTotal], ['MIN', minTotal]].forEach(([lab, v]) => {
        const y = py(v);
        svg.appendChild(elx('line', { class: 'band-line', x1: L, y1: y, x2: W - R, y2: y }));
        const tx = elx('text', { class: 'band-txt', x: W - R - 2, y: y - 4, 'text-anchor': 'end' }); tx.textContent = lab; svg.appendChild(tx);
      });
      // J-1 total curve (dashed, discreet) — up to its own last real slot
      if (prevTotals && prevReal > 1) {
        let pd = 'M ' + px(0) + ' ' + py(prevTotals[0]);
        for (let i = 1; i < prevReal; i++) pd += ' L ' + px(i).toFixed(1) + ' ' + py(prevTotals[i]).toFixed(1);
        svg.appendChild(elx('path', { class: 'j1-line', d: pd }));
        const lg = elx('text', { class: 'j1-txt', x: L + 4, y: T + 12 }); lg.textContent = 'J-1 (' + (prevDs || '') + ')'; svg.appendChild(lg);
      }
      for (let h = 0; h <= 24; h += 4) {
        const i = Math.min(N - 1, Math.round(h / 24 * N));
        const tx = elx('text', { class: 'axis-txt', x: px(i), y: H - 8, 'text-anchor': 'middle' }); tx.textContent = String(h).padStart(2, '0') + ':00'; svg.appendChild(tx);
      }
      nowLine = elx('line', { class: 'now-line', x1: 0, y1: T, x2: 0, y2: H - B }); svg.appendChild(nowLine);
    })();

    const fmtInst = v => v >= 1000 ? (v / 1000).toFixed(2) + ' GW' : Math.round(v) + ' MW';
    const listEl = wrap.querySelector('.gms-list');
    const vbarEl = wrap.querySelector('.gms-vbar');
    const tbody = wrap.querySelector('tbody');
    const pill = wrap.querySelector('.gms-nowpill');
    const ptime = wrap.querySelector('.gms-ptime');

    function update(idx) {
      idx = Math.max(0, Math.min(nReal - 1, idx));
      const x = px(idx); nowLine.setAttribute('x1', x); nowLine.setAttribute('x2', x);
      const mins = Math.round(idx / N * 24 * 60), hh = String(Math.floor(mins / 60)).padStart(2, '0'), mm = String(mins % 60).padStart(2, '0');
      pill.style.display = 'block'; pill.textContent = hh + ':' + mm;
      const cw = svg.clientWidth || svg.getBoundingClientRect().width || W;
      pill.style.left = (x / W * cw) + 'px';
      pill.style.top = (wrap.querySelector('.gms-rt').offsetHeight + 2) + 'px';
      ptime.textContent = hh + ':' + mm;

      const slot = STACK.map(f => ({ f, v: DATA[f][idx] })); const tot = slot.reduce((s, o) => s + o.v, 0) || 1;
      vbarEl.innerHTML = '';
      STACK.forEach(f => { const v = DATA[f][idx]; if (v <= 0) return; const seg = document.createElement('div'); seg.className = 'gms-vseg'; seg.style.height = (v / tot * 100) + '%'; seg.style.background = FUEL[f].color; vbarEl.appendChild(seg); });
      listEl.innerHTML = '';
      slot.slice().sort((a, b) => b.v - a.v).forEach(o => {
        const r = document.createElement('div'); r.className = 'gms-li';
        r.innerHTML = '<span class="dot" style="background:' + FUEL[o.f].color + '"></span><span class="nm">' + FUEL[o.f].label + '</span><span class="vv">' + fmtInst(o.v) + '</span><span class="pc">' + (o.v / tot * 100).toFixed(0) + '%</span>';
        listEl.appendChild(r);
      });
      tbody.innerHTML = '';
      slot.slice().sort((a, b) => b.v - a.v).forEach(o => {
        const f = o.f, s = STAT[f]; const tr = document.createElement('tr');
        tr.innerHTML = '<td><span class="gms-cellnm"><span class="dot" style="background:' + FUEL[f].color + '"></span>' + FUEL[f].label + '</span></td>'
          + '<td>' + fmtInst(o.v) + '</td><td style="color:var(--tx);font-weight:700">' + (o.v / tot * 100).toFixed(1) + '%</td>'
          + '<td style="color:var(--tx3)">' + s.min.toFixed(2) + '</td><td style="color:var(--tx3)">' + s.max.toFixed(2) + '</td><td>' + s.avg.toFixed(2) + '</td><td style="color:var(--tx3)">' + FUEL[f].co2 + '</td>';
        tbody.appendChild(tr);
      });
      const co2 = slot.reduce((s, o) => s + o.v * FUEL[o.f].co2, 0) / tot;
      const tr = document.createElement('tr'); tr.className = 'total';
      tr.innerHTML = '<td>Total</td><td>' + fmtInst(tot) + '</td><td>100%</td><td>' + (minTotal / 1000).toFixed(2) + '</td><td>' + (maxTotal / 1000).toFixed(2) + '</td><td>—</td><td>' + Math.round(co2) + ' g</td>';
      tbody.appendChild(tr);
    }

    const defSlot = Math.max(0, nReal - 1);
    update(defSlot);
    svg.addEventListener('mousemove', e => { const r = svg.getBoundingClientRect(); const xrel = (e.clientX - r.left) / r.width * W; update(Math.round((xrel - L) / (W - L - R) * (N - 1))); });
    svg.addEventListener('mouseleave', () => update(defSlot));
    host._gmsReflow = () => update(defSlot);
  };

  // The stack is rendered on demand by the GenMix drill "Stack" sub-tab,
  // which calls window.renderGenMixStack('gm-drill-content', zone, date).
  // Keep the now-cursor aligned on resize.
  window.addEventListener('resize', () => {
    const h = document.getElementById('gm-drill-content');
    if (h && h._gmsReflow) h._gmsReflow();
  });
})();
