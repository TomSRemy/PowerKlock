// ════════════════════════════════════════════════════════════════
// GENMIX DAILY · merged module
//
// Two sections, both strictly aligned on the Prices Day-Ahead Cross-zone
// (CC) template:
//   - .pk-tabbar with left (tabs + sub-toggle) and right (chips + Fullscreen)
//   - KPI strip BEFORE the tabbar
//   - Title block AFTER the tabbar (eyebrow + title + subtitle)
//
// Section A · Board mono-zone (gmd-*)
//   Views: Profile · Mix snapshot · Carbon · Net position
//
// Section B · Cross-zone (gmdcz-*)
//   Views: Ranking · Profiles · Spread vs reference
//
// All sub-toggles use window.pkPill (universal template).
// ════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
// SHARED CONSTANTS
// ─────────────────────────────────────────────────────────────────

// Lifecycle carbon factors (g CO2eq / kWh) — IPCC AR6 median values
const _GMD_CO2 = {
  nuclear: 12, wind: 11, solar: 45, hydro: 24, biomass: 230,
  gas: 490, coal: 820, oil: 740, other: 400, fossil: 600,
};

// Display order (bottom → top) for the stacked profile.
const _GMD_STACK_ORDER = ['nuclear', 'hydro', 'biomass', 'wind', 'solar', 'fossil', 'other'];

const _GMD_META = (typeof GM_FUEL_META !== 'undefined') ? GM_FUEL_META : {
  nuclear: { color: '#A78BFA', label: 'Nuclear' },
  wind:    { color: '#14D3A9', label: 'Wind'    },
  solar:   { color: '#FBBF24', label: 'Solar'   },
  hydro:   { color: '#06B6D4', label: 'Hydro'   },
  biomass: { color: '#84CC16', label: 'Biomass' },
  fossil:  { color: '#F97316', label: 'Fossil'  },
  other:   { color: '#7A93AB', label: 'Other'   },
};

const _GMD_ZONE_NAMES = (typeof GM_ZONE_NAMES !== 'undefined') ? GM_ZONE_NAMES : {
  FR:'France', DE_LU:'Germany', ES:'Spain', BE:'Belgium',
  NL:'Netherlands', PT:'Portugal', GB:'Great Britain', IT_NORD:'Italy North',
};

// ─────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────

// Synthetic 96-slot 15-min profile from a snapshot (placeholder until
// fetch_data.py provides real 15-min mix series).
function _gmdSynthProfile(snapshot) {
  if (!snapshot || !snapshot.total) return null;
  const profile = {};
  const N = 96;
  for (const fuel of _GMD_STACK_ORDER) {
    const meanGW = snapshot[fuel] || 0;
    if (!meanGW) { profile[fuel] = new Array(N).fill(0); continue; }
    const arr = new Array(N);
    for (let i = 0; i < N; i++) {
      const h = i / 4;
      let factor = 1.0;
      if (fuel === 'solar') {
        const noon = 13, sigma = 3.0;
        const x = (h - noon) / sigma;
        factor = Math.max(0, Math.exp(-0.5 * x * x) * 2.5);
      } else if (fuel === 'wind') {
        factor = 0.7 + 0.3 * Math.sin((h / 24) * 2 * Math.PI + 1.5);
      } else if (fuel === 'fossil') {
        const peak = 20;
        factor = 0.4 + 1.2 * Math.exp(-Math.pow((h - peak) / 3, 2));
      } else if (fuel === 'hydro') {
        factor = 0.85 + 0.15 * Math.sin((h / 24) * 2 * Math.PI - 0.3);
      }
      arr[i] = meanGW * factor;
    }
    const mean = arr.reduce((a, b) => a + b, 0) / N;
    if (mean > 0) {
      const k = meanGW / mean;
      for (let i = 0; i < N; i++) arr[i] *= k;
    }
    profile[fuel] = arr;
  }
  return profile;
}
window._gmdSynthProfile = _gmdSynthProfile;

// Carbon intensity at each slot (g CO2 / kWh)
function _gmdCarbonProfile(profile) {
  if (!profile) return null;
  const N = profile.nuclear?.length || 96;
  const co2 = new Array(N);
  for (let i = 0; i < N; i++) {
    let num = 0, den = 0;
    for (const fuel of _GMD_STACK_ORDER) {
      const v = (profile[fuel] || [])[i] || 0;
      num += v * (_GMD_CO2[fuel] || 0);
      den += v;
    }
    co2[i] = den > 0 ? num / den : 0;
  }
  return co2;
}

// P10-P90 envelope (synthetic placeholder for now)
function _gmdSynthBand(profile) {
  if (!profile) return null;
  const N = profile.nuclear?.length || 96;
  const total = new Array(N);
  for (let i = 0; i < N; i++) {
    total[i] = _GMD_STACK_ORDER.reduce((s, f) => s + ((profile[f] || [])[i] || 0), 0);
  }
  return {
    p10: total.map(v => v * 0.85),
    p90: total.map(v => v * 1.12),
  };
}

// J-1 (synthetic placeholder)
function _gmdSynthJ1(profile) {
  if (!profile) return null;
  const N = profile.nuclear?.length || 96;
  const total = new Array(N);
  for (let i = 0; i < N; i++) {
    let v = _GMD_STACK_ORDER.reduce((s, f) => s + ((profile[f] || [])[i] || 0), 0);
    total[i] = v * 1.05;
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────
// Build short ISO date string ("Sun 24 May 2026")
// ─────────────────────────────────────────────────────────────────
function _gmdLongDate() {
  return new Date().toLocaleDateString('en-GB', {
    weekday:'short', day:'2-digit', month:'short', year:'numeric',
  });
}

// ═════════════════════════════════════════════════════════════════
// ═══════════════ SECTION B · CROSS-ZONE (gmdcz-*) ════════════════
// ═════════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────────
window._gmdczView   = window._gmdczView   || 'ranking';
window._gmdczMetric = window._gmdczMetric || 'ren';
window._gmdczRef    = window._gmdczRef    || 'FR';

const GMDCZ_VIEWS = [
  {
    key:'ranking',
    label:'Ranking',
    icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="9" y2="18"/></svg>',
  },
  {
    key:'heatmap',
    label:'Heatmap',
    icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6"/><rect x="11" y="3" width="6" height="6"/><rect x="3" y="11" width="6" height="6"/><rect x="11" y="11" width="6" height="6"/></svg>',
  },
  {
    key:'profiles',
    label:'Profiles',
    icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/></svg>',
  },
  {
    key:'spread',
    label:'Spread',
    icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="4" x2="12" y2="20"/><polyline points="9 8 4 12 9 16"/><polyline points="15 8 20 12 15 16"/></svg>',
  },
];

// ─────────────────────────────────────────────────────────────────
// HELPERS (Cross-zone specific)
// ─────────────────────────────────────────────────────────────────
function _gmdczMetricLabel(m) {
  return ({ ren:'Renewable %', lowc:'Low-carbon %', co2:'CO₂ g/kWh', total:'Total GW' })[m] || 'Renewable %';
}
function _gmdczMetricUnit(m) {
  return ({ ren:'%', lowc:'%', co2:'g/kWh', total:'GW' })[m] || '';
}

function _gmdczValueFor(zone, metric) {
  const mix = (window._genmixData && window._genmixData[zone]);
  if (!mix || !mix.total) return null;
  if (typeof _gmStats !== 'function') return null;
  const st = _gmStats(mix);
  if (!st) return null;
  switch (metric) {
    case 'ren':   return st.renPct;
    case 'lowc':  return st.lowCPct;
    case 'co2':   return st.co2;
    case 'total': return st.total;
    default:      return null;
  }
}

function _gmdczRanking(metric) {
  const data = window._genmixData || {};
  const rows = Object.keys(data).map(z => ({
    zone: z,
    value: _gmdczValueFor(z, metric),
  })).filter(r => r.value !== null);
  const asc = (metric === 'co2');
  rows.sort((a, b) => asc ? a.value - b.value : b.value - a.value);
  return rows;
}

function _gmdczColor(value, metric) {
  if (value == null || isNaN(value)) return '#7A93AB';
  if (metric === 'ren') {
    if (value >= 60) return '#14D3A9';
    if (value >= 40) return '#FBBF24';
    if (value >= 20) return '#F97316';
    return '#ED6965';
  }
  if (metric === 'lowc') {
    if (value >= 80) return '#14D3A9';
    if (value >= 60) return '#FBBF24';
    if (value >= 40) return '#F97316';
    return '#ED6965';
  }
  if (metric === 'co2') {
    if (value < 50)  return '#14D3A9';
    if (value < 150) return '#FBBF24';
    if (value < 400) return '#F97316';
    return '#ED6965';
  }
  return '#7A93AB';
}

// ─────────────────────────────────────────────────────────────────
// SETTERS (CC pattern)
// ─────────────────────────────────────────────────────────────────
function setGmdczView(view) {
  window._gmdczView = view;
  renderGmdczTabs();
  _gmdczUpdateTabContext(view);
  _gmdczDispatchRender();
}
window.setGmdczView = setGmdczView;

function setGmdczMetric(m) {
  window._gmdczMetric = m;
  _gmdczUpdateTabContext(window._gmdczView || 'ranking');
  _gmdczDispatchRender();
}
window.setGmdczMetric = setGmdczMetric;

function setGmdczRef(z) {
  window._gmdczRef = z;
  _gmdczUpdateTabContext(window._gmdczView || 'ranking');
  _gmdczDispatchRender();
}
window.setGmdczRef = setGmdczRef;

// ─────────────────────────────────────────────────────────────────
// TABS · CC pattern
// ─────────────────────────────────────────────────────────────────
function renderGmdczTabs() {
  const tabs = document.getElementById('gmdcz-tabs');
  if (!tabs) return;
  const cur = window._gmdczView || 'ranking';
  tabs.innerHTML = GMDCZ_VIEWS.map(v => `
    <button onclick="setGmdczView('${v.key}')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:${v.key === cur ? 'var(--bg3)' : 'transparent'};color:${v.key === cur ? 'var(--text)' : 'var(--text3)'};font-family:'Inter',sans-serif;font-weight:500;letter-spacing:.03em;transition:all .15s">
      <span style="display:inline-flex;width:14px;height:14px">${v.icon}</span>${v.label}
    </button>`).join('');
}
window.renderGmdczTabs = renderGmdczTabs;

// ─────────────────────────────────────────────────────────────────
// _gmdczUpdateTabContext · CC pattern
// ─────────────────────────────────────────────────────────────────
function _gmdczUpdateTabContext(view) {
  const subToggle = document.getElementById('gmdcz-sub-toggle');
  const chips     = document.getElementById('gmdcz-tab-chips');
  if (!subToggle || !chips) return;

  const metric = window._gmdczMetric || 'ren';

  // Heatmap view shows zones × fuels by nature — Metric sub-toggle has no effect
  if (view === 'heatmap') {
    subToggle.innerHTML = '';
    subToggle.style.display = 'none';
    chips.innerHTML = '';
    chips.style.display = 'none';
    return;
  }

  // Sub-toggle: Metric pkPills (Total GW removed for Spread view)
  let metrics = [
    { id:'ren',   label:'REN %'      },
    { id:'lowc',  label:'Low-C %'    },
    { id:'co2',   label:'CO₂ g/kWh'  },
    { id:'total', label:'Total GW'   },
  ];
  if (view === 'spread') metrics = metrics.filter(m => m.id !== 'total');
  const pillsHtml = metrics.map(m => window.pkPill({
    label:   m.label,
    active:  m.id === metric,
    onClick: `setGmdczMetric('${m.id}')`,
  })).join('');
  subToggle.innerHTML = `
    <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace;margin-right:4px">Metric</span>
    ${pillsHtml}`;
  subToggle.style.display = 'inline-flex';

  // Chips: Reference dropdown for Spread view only
  if (view === 'spread') {
    const zones = Object.keys(window._genmixData || {}).sort();
    const ref = window._gmdczRef || 'FR';
    const refOptions = zones.map(z => {
      const n = _GMD_ZONE_NAMES[z] || z;
      return `<option value="${z}" ${z === ref ? 'selected' : ''}>${z} — ${n}</option>`;
    }).join('');
    chips.innerHTML = `
      <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace;margin-right:4px">Reference</span>
      <select onchange="setGmdczRef(this.value)" style="background:var(--bg);border:1px solid var(--bd);color:var(--tx);font-size:11px;padding:3px 8px;border-radius:4px;font-family:inherit;cursor:pointer;color-scheme:dark">${refOptions}</select>`;
    chips.style.display = 'inline-flex';
  } else {
    chips.innerHTML = '';
    chips.style.display = 'none';
  }
}
window._gmdczUpdateTabContext = _gmdczUpdateTabContext;

// ─────────────────────────────────────────────────────────────────
// TITLE BLOCK (CC pattern)
// ─────────────────────────────────────────────────────────────────
function _gmdczSetTitle() {
  const eyebrowEl = document.getElementById('gmdcz-eyebrow');
  const titleEl   = document.getElementById('gmdcz-title');
  const subEl     = document.getElementById('gmdcz-subtitle');
  if (!titleEl) return;

  const view   = window._gmdczView || 'ranking';
  const metric = window._gmdczMetric || 'ren';
  const viewLbl = (GMDCZ_VIEWS.find(v => v.key === view) || {}).label || 'Ranking';
  const metricLbl = _gmdczMetricLabel(metric);

  const longDate = _gmdLongDate();

  if (eyebrowEl) eyebrowEl.textContent = `Genmix Daily · Cross-zone · ${viewLbl}`;
  // Heatmap view shows all fuels by nature — title doesn't depend on Metric
  titleEl.textContent = (view === 'heatmap')
    ? `Cross-zone — Heatmap · Mix structure (% share per fuel)`
    : `Cross-zone — ${viewLbl} · ${metricLbl}`;
  const zonesCount = Object.keys(window._genmixData || {}).length;
  if (subEl) subEl.textContent = `${longDate} · ${zonesCount} zones · ENTSO-E`;

  const hdrDate = document.getElementById('gmdcz-header-date');
  if (hdrDate) hdrDate.textContent = longDate;
}

// ─────────────────────────────────────────────────────────────────
// KPI STRIP · 5 cards
// ─────────────────────────────────────────────────────────────────
function _gmdczRenderKpis() {
  const host = document.getElementById('gmdcz-kpi-strip');
  if (!host) return;
  const data = window._genmixData || {};
  const zones = Object.keys(data);
  if (!zones.length) { host.innerHTML = ''; return; }

  const ranks    = _gmdczRanking('ren');
  const topRen   = ranks[0] || { zone:'--', value:0 };
  const ranksCo2 = _gmdczRanking('co2');
  const cleanCo2 = ranksCo2[0] || { zone:'--', value:0 };

  const allRen = ranks.map(r => r.value);
  const euAvgRen = allRen.length ? allRen.reduce((a,b)=>a+b,0) / allRen.length : 0;
  const frRen = _gmdczValueFor('FR', 'ren');
  const frVsEu = (frRen != null) ? (frRen - euAvgRen) : null;

  const totalEU = zones.reduce((s, z) => {
    const t = _gmdczValueFor(z, 'total');
    return s + (t || 0);
  }, 0);

  host.innerHTML = `
    <div class="kpi-card kpi-flat"><div class="kpi-label">Zones loaded</div><div class="kpi-value">${zones.length}<span class="kpi-unit">zones</span></div><div class="kpi-meta">cross-zone today</div></div>
    <div class="kpi-card kpi-flat"><div class="kpi-label">Top REN today</div><div class="kpi-value" style="color:#14D3A9;font-size:18px">${topRen.zone}</div><div class="kpi-meta">${topRen.value.toFixed(0)}% · ${_GMD_ZONE_NAMES[topRen.zone] || topRen.zone}</div></div>
    <div class="kpi-card kpi-flat"><div class="kpi-label">Cleanest grid</div><div class="kpi-value" style="color:#A78BFA;font-size:18px">${cleanCo2.zone}</div><div class="kpi-meta">${cleanCo2.value.toFixed(0)} g/kWh · lowest today</div></div>
    <div class="kpi-card kpi-flat"><div class="kpi-label">FR vs EU avg</div><div class="kpi-value" style="color:${(frVsEu != null && frVsEu >= 0) ? '#14D3A9' : '#ED6965'}">${frVsEu != null ? (frVsEu >= 0 ? '+' : '') + frVsEu.toFixed(1) : '--'}<span class="kpi-unit">pts REN</span></div><div class="kpi-meta">FR ${frRen != null ? frRen.toFixed(0) : '--'}% vs EU ${euAvgRen.toFixed(0)}%</div></div>
    <div class="kpi-card kpi-flat"><div class="kpi-label">EU total load</div><div class="kpi-value">${totalEU.toFixed(0)}<span class="kpi-unit">GW</span></div><div class="kpi-meta">${zones.length} zones</div></div>`;
}

// ─────────────────────────────────────────────────────────────────
// DISPATCH
// ─────────────────────────────────────────────────────────────────
function _gmdczDispatchRender() {
  _gmdczSetTitle();
  _gmdczRenderKpis();
  const view = window._gmdczView || 'ranking';
  switch (view) {
    case 'ranking':  _gmdczRenderRanking(); break;
    case 'heatmap':  _gmdczRenderHeatmap(); break;
    case 'profiles': _gmdczRenderProfiles(); break;
    case 'spread':   _gmdczRenderSpread(); break;
    default:         _gmdczRenderRanking();
  }

  // Market read banner · context-aware per view
  const bannerAnchor = document.getElementById('gmdcz-analyst-banner-anchor');
  if (bannerAnchor) bannerAnchor.innerHTML = _gmdczBuildBannerHtml(view);

  // Summary table below content (mirrors Prices Cross-zone compare-data-table)
  _gmdczRenderSummaryTable();
}

// ─────────────────────────────────────────────────────────────────
// SUMMARY TABLE · below the chart, fixed across views (like Prices cc)
// ─────────────────────────────────────────────────────────────────
function _gmdczRenderSummaryTable() {
  const tbody = document.getElementById('gmdcz-summary-tbody');
  const label = document.getElementById('gmdcz-summary-label');
  if (!tbody) return;

  const data = window._genmixData || {};
  const zones = Object.keys(data).filter(z => data[z]?.total > 0);
  if (!zones.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--tx3);padding:16px">No data</td></tr>`;
    if (label) label.textContent = 'Cross-zone summary · 0 zones';
    return;
  }
  if (label) label.textContent = `Cross-zone summary · ${zones.length} zones · ENTSO-E A75`;

  const stats = (typeof _gmStats === 'function') ? _gmStats : null;
  if (!stats) return;
  const FUEL_META = (typeof GM_FUEL_META !== 'undefined') ? GM_FUEL_META : _GMDCZ_META;
  const FLAGS = (typeof FLAG_MAP !== 'undefined') ? FLAG_MAP : {};
  const renColor = (typeof _gmRenColor === 'function') ? _gmRenColor : (() => 'var(--tx)');
  const co2Color = (typeof _gmCo2Color === 'function') ? _gmCo2Color : (() => 'var(--tx)');

  // Reference (FR) baseline
  const refStats = data.FR ? stats(data.FR) : null;
  const frRen = refStats ? refStats.renPct : null;
  const frCo2 = refStats ? refStats.co2    : null;

  // Sort zones by Total GW desc (same ordering as Daily Board)
  const sorted = [...zones].sort((a, b) => (data[b].total || 0) - (data[a].total || 0));

  const fmt = (v, dp=1) => (v == null || isNaN(v)) ? '--' : v.toFixed(dp);
  const rows = sorted.map(z => {
    const st = stats(data[z]);
    if (!st) return '';
    const dom = FUEL_META[st.dom] || FUEL_META.other;
    const flag = FLAGS[z] || '';
    const isFr = z === 'FR';
    const dRen = (frRen != null) ? (st.renPct - frRen) : null;
    const dCo2 = (frCo2 != null) ? (st.co2 - frCo2)    : null;
    const dRenColor = (dRen == null || isFr) ? 'var(--tx3)' : (dRen >= 0 ? '#14D3A9' : '#ED6965');
    const dCo2Color = (dCo2 == null || isFr) ? 'var(--tx3)' : (dCo2 <= 0 ? '#14D3A9' : '#ED6965');
    const dRenStr = (dRen == null) ? '--' : (isFr ? '— ref —' : (dRen >= 0 ? '+' : '') + dRen.toFixed(1) + ' pts');
    const dCo2Str = (dCo2 == null) ? '--' : (isFr ? '— ref —' : (dCo2 >= 0 ? '+' : '') + Math.round(dCo2));
    return `<tr style="${isFr ? 'background:rgba(20,211,169,0.04);' : ''}">
      <td style="text-align:left;padding:6px 10px;font-family:'JetBrains Mono',monospace;font-weight:600">${flag} ${z}${isFr ? ' <span style="color:#14D3A9;font-size:9px">●</span>' : ''}</td>
      <td style="text-align:right;padding:6px 10px;font-family:'JetBrains Mono',monospace">${fmt(st.total / 1000, 2)}</td>
      <td style="text-align:right;padding:6px 10px;font-family:'JetBrains Mono',monospace;color:${renColor(st.renPct)};font-weight:600">${fmt(st.renPct, 1)}%</td>
      <td style="text-align:right;padding:6px 10px;font-family:'JetBrains Mono',monospace;color:${co2Color(st.co2)};font-weight:600">${Math.round(st.co2)}</td>
      <td style="text-align:left;padding:6px 10px;font-family:'JetBrains Mono',monospace"><span style="color:${dom.color}">${dom.emoji || ''} ${dom.label || st.dom}</span></td>
      <td style="text-align:right;padding:6px 10px;font-family:'JetBrains Mono',monospace;color:${dRenColor};font-weight:${isFr ? 500 : 600}">${dRenStr}</td>
      <td style="text-align:right;padding:6px 10px;font-family:'JetBrains Mono',monospace;color:${dCo2Color};font-weight:${isFr ? 500 : 600}">${dCo2Str}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows;
}
window._gmdczRenderSummaryTable = _gmdczRenderSummaryTable;

// ─────────────────────────────────────────────────────────────────
// MARKET READ generator · cross-zone (per view)
// ─────────────────────────────────────────────────────────────────
function _gmdczBuildBannerHtml(view) {
  const data = window._genmixData || {};
  const zones = Object.keys(data).filter(z => data[z]?.total > 0);
  if (!zones.length || typeof window._gmBuildMarketBanner !== 'function') return '';

  const metric = window._gmdczMetric || 'ren';
  const ref    = window._gmdczRef    || 'FR';

  const ranksRen = _gmdczRanking('ren');
  const ranksCo2 = _gmdczRanking('co2');
  const topRen   = ranksRen[0] || { zone:'--', value:0 };
  const cleanCo2 = ranksCo2[0] || { zone:'--', value:0 };
  const fr       = _gmdczValueFor('FR', 'ren');
  const frCo2    = _gmdczValueFor('FR', 'co2');
  const renAvg   = ranksRen.length ? ranksRen.reduce((s,r)=>s+r.value,0) / ranksRen.length : 0;
  const co2Avg   = ranksCo2.length ? ranksCo2.reduce((s,r)=>s+r.value,0) / ranksCo2.length : 0;

  if (view === 'ranking') {
    const metricLbl = _gmdczMetricLabel(metric);
    const top = _gmdczRanking(metric)[0];
    const bottom = _gmdczRanking(metric)[_gmdczRanking(metric).length - 1];
    const unit = _gmdczMetricUnit(metric);
    if (!top || !bottom) return '';
    const line1 = `Cross-zone ranking on <strong style="color:#fff">${metricLbl}</strong> · top: <strong style="color:#fff">${top.zone}</strong> ${top.value.toFixed(1)}${unit}, bottom: <strong style="color:#fff">${bottom.zone}</strong> ${bottom.value.toFixed(1)}${unit}.`;
    const spread = Math.abs(top.value - bottom.value);
    const verdict = `Spread max-min: ${spread.toFixed(1)} ${unit}. ${metric === 'co2' ? 'Wide carbon gap across EU today — geographic arbitrage on low-carbon offtake.' : 'REN/share dispersion drives capture-price differential across zones.'}`;
    return window._gmBuildMarketBanner({ line1, verdict });
  }

  if (view === 'heatmap') {
    const line1 = `EU mix structure today · top REN: <strong style="color:#fff">${topRen.zone}</strong> (${topRen.value.toFixed(0)}%). Cleanest grid: <strong style="color:#fff">${cleanCo2.zone}</strong> (${cleanCo2.value.toFixed(0)} g/kWh).`;
    const verdict = `Heatmap intensity highlights fuel concentrations. Nuclear-heavy zones anchor low CO₂; wind/solar zones swing with weather.`;
    return window._gmBuildMarketBanner({ line1, verdict });
  }

  if (view === 'profiles') {
    const line1 = `24h overlay on <strong style="color:#fff">${_gmdczMetricLabel(metric)}</strong> across ${zones.length} zones · FR highlighted in bold.`;
    const verdict = `Look for synchronicity (solar peak ~13h) and divergence (wind patterns). Cross-zone arbitrage opportunities live where curves cross.`;
    return window._gmBuildMarketBanner({ line1, verdict });
  }

  if (view === 'spread') {
    const refVal = _gmdczValueFor(ref, metric);
    if (refVal == null) return '';
    const refValFmt = (metric === 'co2') ? refVal.toFixed(0)
                     : (metric === 'total') ? refVal.toFixed(1)
                     : refVal.toFixed(1);
    const line1 = `Spread vs <strong style="color:#fff">${ref}</strong> on ${_gmdczMetricLabel(metric)} · reference value ${refValFmt}${_gmdczMetricUnit(metric)}.`;
    const verdict = `Positive spread = better than ${ref}. Use this view to size cross-border offtake opportunities relative to your home zone.`;
    return window._gmBuildMarketBanner({ line1, verdict });
  }

  return '';
}

function renderGmdczMain() {
  const data = window._genmixData;
  const host = document.getElementById('gmdcz-content');
  if (!host) return Promise.resolve();
  if (!data || !Object.keys(data).length) {
    host.innerHTML = `<div style="padding:24px;color:var(--tx3);font-family:'JetBrains Mono',monospace;font-size:11px">Waiting for generation mix data...</div>`;
    renderGmdczTabs();
    _gmdczUpdateTabContext(window._gmdczView || 'ranking');
    return Promise.resolve();
  }
  renderGmdczTabs();
  _gmdczUpdateTabContext(window._gmdczView || 'ranking');
  _gmdczDispatchRender();
  return Promise.resolve();
}
window.renderGmdczMain = renderGmdczMain;

// ─────────────────────────────────────────────────────────────────
// VIEW · HEATMAP (zones × fuels · % share)
// Recovered from legacy hs-gm-compare and embedded into Cross-zone.
// ─────────────────────────────────────────────────────────────────
function _gmdczRenderHeatmap() {
  const host = document.getElementById('gmdcz-content');
  if (!host) return;
  const data = window._genmixData || {};
  const zones = Object.keys(data)
    .filter(z => data[z]?.total > 0)
    .sort((a, b) => (data[b].total || 0) - (data[a].total || 0));
  if (!zones.length) { host.innerHTML = `<div style="padding:24px;color:var(--tx3)">No data</div>`; return; }

  // Need globals from genmix.js (already loaded before genmix-daily.js)
  const FUEL_ORDER = (typeof GM_FUEL_ORDER !== 'undefined') ? GM_FUEL_ORDER :
                     ['nuclear','wind','solar','hydro','biomass','fossil','other'];
  const FUEL_META = (typeof GM_FUEL_META !== 'undefined') ? GM_FUEL_META : _GMDCZ_META;
  const stats = (typeof _gmStats === 'function') ? _gmStats : null;
  const hexToRgb = (typeof _hexToRgb === 'function') ? _hexToRgb : (hex => {
    const h = hex.replace('#', '');
    return `${parseInt(h.substr(0,2),16)},${parseInt(h.substr(2,2),16)},${parseInt(h.substr(4,2),16)}`;
  });
  const FLAGS = (typeof FLAG_MAP !== 'undefined') ? FLAG_MAP : {};

  let html = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
        <thead>
          <tr>
            <th style="padding:4px 8px;text-align:left;color:var(--tx3);font-weight:600;width:90px;border-bottom:1px solid var(--bd)">Zone</th>`;
  FUEL_ORDER.forEach(k => {
    const m = FUEL_META[k];
    if (!m) return;
    html += `<th style="padding:4px 8px;text-align:center;color:${m.color};font-weight:600;font-size:11px;border-bottom:1px solid var(--bd)">${m.emoji || ''} ${m.label || k}</th>`;
  });
  html += `<th style="padding:4px 8px;text-align:right;color:var(--tx3);font-weight:600;width:80px;border-bottom:1px solid var(--bd)">Total</th></tr></thead><tbody>`;

  zones.forEach(z => {
    const mix = data[z];
    const st = stats ? stats(mix) : null;
    if (!st) return;
    const isFr = z === 'FR';
    const flag = FLAGS[z] || '';
    html += `<tr style="border-top:1px solid var(--bd);${isFr ? 'background:rgba(255,255,255,0.03);' : ''}">
      <td style="padding:8px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${isFr ? '#fff' : 'var(--tx)'};letter-spacing:.04em">${flag} ${z}${isFr ? ' <span style="color:#14D3A9;font-size:9px">●</span>' : ''}</td>`;
    FUEL_ORDER.forEach(k => {
      const m = FUEL_META[k];
      if (!m) return;
      const pct = ((mix[k] || 0) / st.total) * 100;
      const opacity = Math.min(0.85, pct / 50);
      const bg = `rgba(${hexToRgb(m.color)},${opacity})`;
      const txc = opacity > 0.4 ? '#0A1018' : 'var(--tx2)';
      html += `<td style="padding:8px;text-align:center;background:${bg};color:${txc};font-family:'JetBrains Mono',monospace;font-weight:${opacity > 0.4 ? 700 : 500}">${pct.toFixed(1)}%</td>`;
    });
    html += `<td style="padding:8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${(st.total/1000).toFixed(1)} GW</td></tr>`;
  });
  html += `</tbody></table></div>`;

  // Legend note
  html += `
    <div style="margin-top:12px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx3);line-height:1.5">
      Cell opacity ∝ % share. Darker cell = larger share of zone's mix. FR row highlighted.
    </div>`;

  host.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────────
// VIEW 1 · RANKING
// ─────────────────────────────────────────────────────────────────
function _gmdczRenderRanking() {
  const host = document.getElementById('gmdcz-content');
  if (!host) return;
  const metric = window._gmdczMetric || 'ren';
  const rows = _gmdczRanking(metric);
  if (!rows.length) { host.innerHTML = `<div style="padding:24px;color:var(--tx3)">No data</div>`; return; }

  const maxV = Math.max(...rows.map(r => r.value));
  const scaleMax = (metric === 'co2' || metric === 'total') ? maxV * 1.05 : Math.max(maxV * 1.05, 100);
  const unit = _gmdczMetricUnit(metric);
  const labelMetric = _gmdczMetricLabel(metric);

  const bars = rows.map((r, i) => {
    const col = _gmdczColor(r.value, metric);
    const widthPct = (r.value / scaleMax * 100);
    const isFr = r.zone === 'FR';
    const valFmt = (metric === 'co2') ? r.value.toFixed(0)
                  : (metric === 'total') ? r.value.toFixed(1)
                  : r.value.toFixed(1);
    return `
      <div style="display:grid;grid-template-columns:60px 1fr 90px;gap:10px;align-items:center;padding:5px 0;
                  ${isFr ? 'background:rgba(255,255,255,0.03);border-radius:4px;padding-left:6px;padding-right:6px;' : ''}">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:${isFr ? '#fff' : 'var(--tx)'};letter-spacing:.04em">
          ${r.zone}${isFr ? ' <span style="color:#14D3A9;font-size:9px">●</span>' : ''}
        </div>
        <div style="position:relative;height:22px;background:rgba(255,255,255,0.03);border-radius:3px;overflow:hidden">
          <div style="position:absolute;top:0;left:0;height:100%;width:${widthPct}%;background:${col};opacity:0.85;border-radius:3px;transition:width .3s"></div>
          <div style="position:absolute;top:0;left:8px;height:100%;display:flex;align-items:center;font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(10,16,24,0.85);font-weight:600;letter-spacing:.04em">
            ${i+1}. ${_GMD_ZONE_NAMES[r.zone] || r.zone}
          </div>
        </div>
        <div style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:${col}">
          ${valFmt}<span style="font-size:9px;color:var(--tx3);font-weight:400;margin-left:2px">${unit}</span>
        </div>
      </div>`;
  }).join('');

  host.innerHTML = `
    <div style="padding:8px 4px">
      <div style="display:grid;grid-template-columns:60px 1fr 90px;gap:10px;padding:2px 0 10px 0;border-bottom:1px solid var(--bd);margin-bottom:8px">
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--tx3);letter-spacing:.06em;text-transform:uppercase;font-weight:600">Zone</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--tx3);letter-spacing:.06em;text-transform:uppercase;font-weight:600">${labelMetric}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--tx3);letter-spacing:.06em;text-transform:uppercase;font-weight:600;text-align:right">Value</div>
      </div>
      ${bars}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
// VIEW 2 · PROFILES (overlay 24h per zone)
// ─────────────────────────────────────────────────────────────────
function _gmdczRenderProfiles() {
  const host = document.getElementById('gmdcz-content');
  if (!host) return;
  const metric = window._gmdczMetric || 'ren';
  const data = window._genmixData || {};
  const zones = Object.keys(data);
  if (!zones.length) { host.innerHTML = `<div style="padding:24px;color:var(--tx3)">No data</div>`; return; }

  host.innerHTML = `
    <div style="position:relative;width:100%;height:420px">
      <canvas id="gmdcz-profiles-canvas" style="width:100%;height:100%;display:block"></canvas>
    </div>
    <div id="gmdcz-profiles-legend" style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx)"></div>`;

  const zoneColor = (z) => (window._zoneColorMap && window._zoneColorMap[z]) || '#7A93AB';
  const N = 96;
  const labels = [];
  for (let i = 0; i < N; i++) {
    const m = i * 15;
    labels.push(`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`);
  }

  const datasets = zones.map(z => {
    const mix = data[z];
    if (!mix || !mix.total) return null;

    let series;
    const prof = _gmdSynthProfile(mix);
    if (prof) {
      const fuels = Object.keys(prof);
      const totals = new Array(N);
      for (let i = 0; i < N; i++) {
        totals[i] = fuels.reduce((s, f) => s + ((prof[f] || [])[i] || 0), 0);
      }
      if (metric === 'ren') {
        const ren = ['wind','solar','hydro','biomass'];
        series = new Array(N);
        for (let i = 0; i < N; i++) {
          const r = ren.reduce((s, f) => s + ((prof[f] || [])[i] || 0), 0);
          series[i] = totals[i] > 0 ? (r / totals[i] * 100) : 0;
        }
      } else if (metric === 'lowc') {
        const lc = ['wind','solar','hydro','biomass','nuclear'];
        series = new Array(N);
        for (let i = 0; i < N; i++) {
          const r = lc.reduce((s, f) => s + ((prof[f] || [])[i] || 0), 0);
          series[i] = totals[i] > 0 ? (r / totals[i] * 100) : 0;
        }
      } else if (metric === 'co2') {
        series = new Array(N);
        for (let i = 0; i < N; i++) {
          let num = 0, den = 0;
          for (const f of fuels) {
            const v = (prof[f] || [])[i] || 0;
            num += v * (_GMD_CO2[f] || 0);
            den += v;
          }
          series[i] = den > 0 ? num / den : 0;
        }
      } else if (metric === 'total') {
        series = totals;
      }
    }
    if (!series) {
      const v = _gmdczValueFor(z, metric) || 0;
      series = new Array(N).fill(v);
    }

    return {
      label: z,
      data: series,
      borderColor: zoneColor(z),
      backgroundColor: 'transparent',
      borderWidth: z === 'FR' ? 2.5 : 1.3,
      fill: false,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 4,
    };
  }).filter(d => d != null);

  const canvas = document.getElementById('gmdcz-profiles-canvas');
  if (window._gmdczProfilesChart) { try { window._gmdczProfilesChart.destroy(); } catch(_) {} }

  const yTitle = _gmdczMetricLabel(metric);
  const yUnit  = _gmdczMetricUnit(metric);

  window._gmdczProfilesChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0A1018',
          titleColor: '#fff',
          bodyColor: '#B8C9D9',
          borderColor: '#1A2533',
          borderWidth: 1,
          padding: 8,
          titleFont: { family: 'JetBrains Mono', size: 10 },
          bodyFont:  { family: 'JetBrains Mono', size: 10 },
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} ${yUnit}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#7A93AB',
            font: { family: 'JetBrains Mono', size: 9 },
            maxRotation: 0,
            autoSkip: true,
            callback: (val, idx) => (idx % 12 === 0) ? labels[idx].slice(0, 5) : '',
          },
        },
        y: {
          beginAtZero: (metric !== 'total'),
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#7A93AB',
            font: { family: 'JetBrains Mono', size: 9 },
          },
          title: {
            display: true,
            text: yTitle,
            color: '#7A93AB',
            font: { family: 'JetBrains Mono', size: 9, weight: '600' },
          },
        },
      },
    },
  });

  const legendHost = document.getElementById('gmdcz-profiles-legend');
  if (legendHost) {
    legendHost.innerHTML = datasets.map(d => `
      <span style="display:inline-flex;align-items:center;gap:5px;${d.label === 'FR' ? 'font-weight:700' : ''}">
        <span style="width:14px;height:2px;background:${d.borderColor};${d.label === 'FR' ? 'box-shadow:0 0 0 1px rgba(255,255,255,0.3)' : ''}"></span>
        ${d.label}
      </span>`).join('');
  }
}

// ─────────────────────────────────────────────────────────────────
// VIEW 3 · SPREAD vs reference
// ─────────────────────────────────────────────────────────────────
function _gmdczRenderSpread() {
  const host = document.getElementById('gmdcz-content');
  if (!host) return;
  const metric = window._gmdczMetric || 'ren';
  const ref    = window._gmdczRef    || 'FR';
  const data   = window._genmixData || {};
  if (!Object.keys(data).length) { host.innerHTML = `<div style="padding:24px;color:var(--tx3)">No data</div>`; return; }

  const refValue = _gmdczValueFor(ref, metric);
  if (refValue == null) {
    host.innerHTML = `<div style="padding:24px;color:var(--tx3)">Reference zone ${ref} has no data</div>`;
    return;
  }

  const sign = (metric === 'co2') ? -1 : 1;

  const rows = Object.keys(data)
    .filter(z => z !== ref)
    .map(z => {
      const v = _gmdczValueFor(z, metric);
      if (v == null) return null;
      return { zone: z, value: v, spread: (v - refValue) * sign };
    })
    .filter(r => r != null)
    .sort((a, b) => b.spread - a.spread);

  if (!rows.length) { host.innerHTML = `<div style="padding:24px;color:var(--tx3)">No zones to compare against ${ref}</div>`; return; }

  const maxAbs = Math.max(...rows.map(r => Math.abs(r.spread))) || 1;
  const unit = _gmdczMetricUnit(metric);

  const bars = rows.map(r => {
    const positive = r.spread >= 0;
    const col = positive ? '#14D3A9' : '#ED6965';
    const widthPct = Math.abs(r.spread) / maxAbs * 50;
    const valFmt = (metric === 'co2') ? Math.abs(r.spread).toFixed(0)
                  : Math.abs(r.spread).toFixed(1);
    const signCh = positive ? '+' : '−';
    return `
      <div style="display:grid;grid-template-columns:60px 1fr 100px;gap:10px;align-items:center;padding:5px 0">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--tx);letter-spacing:.04em">${r.zone}</div>
        <div style="position:relative;height:22px;background:rgba(255,255,255,0.03);border-radius:3px">
          <div style="position:absolute;top:0;left:50%;width:1px;height:100%;background:rgba(255,255,255,0.25);transform:translateX(-0.5px)"></div>
          ${positive ? `
            <div style="position:absolute;top:0;left:50%;height:100%;width:${widthPct}%;background:${col};opacity:0.85;border-radius:0 3px 3px 0"></div>
            <div style="position:absolute;top:0;left:calc(50% + 6px);height:100%;display:flex;align-items:center;font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(10,16,24,0.85);font-weight:600">${_GMD_ZONE_NAMES[r.zone] || r.zone}</div>
          ` : `
            <div style="position:absolute;top:0;right:50%;height:100%;width:${widthPct}%;background:${col};opacity:0.85;border-radius:3px 0 0 3px"></div>
            <div style="position:absolute;top:0;right:calc(50% + 6px);height:100%;display:flex;align-items:center;font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(10,16,24,0.85);font-weight:600">${_GMD_ZONE_NAMES[r.zone] || r.zone}</div>
          `}
        </div>
        <div style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:${col}">
          ${signCh}${valFmt}<span style="font-size:9px;color:var(--tx3);font-weight:400;margin-left:2px">${unit}</span>
        </div>
      </div>`;
  }).join('');

  const refValueFmt = (metric === 'co2') ? refValue.toFixed(0)
                     : (metric === 'total') ? refValue.toFixed(1)
                     : refValue.toFixed(1);
  const betterLbl = (metric === 'co2') ? 'cleaner than' : 'higher than';
  const worseLbl  = (metric === 'co2') ? 'dirtier than' : 'lower than';

  host.innerHTML = `
    <div style="padding:8px 4px">
      <div style="margin-bottom:14px;padding:10px 12px;background:rgba(20,211,169,0.04);border-left:2px solid #14D3A9;border-radius:0 4px 4px 0">
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx2);line-height:1.6">
          Spread of each zone vs <strong style="color:#14D3A9">${ref}</strong> (${_GMD_ZONE_NAMES[ref] || ref}) on <strong style="color:var(--tx)">${_gmdczMetricLabel(metric)}</strong>.
          Reference value: <strong style="color:var(--tx)">${refValueFmt}${unit}</strong>.<br>
          <span style="color:#14D3A9">Right (green)</span> = ${betterLbl} ${ref}.
          <span style="color:#ED6965">Left (red)</span> = ${worseLbl} ${ref}.
        </div>
      </div>

      <div style="display:grid;grid-template-columns:60px 1fr 100px;gap:10px;padding:2px 0 10px 0;border-bottom:1px solid var(--bd);margin-bottom:8px">
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--tx3);letter-spacing:.06em;text-transform:uppercase;font-weight:600">Zone</div>
        <div style="position:relative;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--tx3);letter-spacing:.06em;text-transform:uppercase;font-weight:600">
          <span style="position:absolute;left:50%;transform:translateX(-50%)">↑ ${ref} ↑</span>
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--tx3);letter-spacing:.06em;text-transform:uppercase;font-weight:600;text-align:right">Spread</div>
      </div>

      ${bars}
    </div>`;
}

// ═════════════════════════════════════════════════════════════════
// INIT · Cross-zone only (Board section moved into genmix.js drill)
// ═════════════════════════════════════════════════════════════════
function _gmdAllInit() {
  const refresh = () => {
    if (document.getElementById('gmdcz-content')) renderGmdczMain();
  };
  document.addEventListener('genmix-loaded', refresh);
  document.addEventListener('zones-changed', refresh);
  if (window._genmixData) refresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _gmdAllInit);
} else {
  _gmdAllInit();
}
