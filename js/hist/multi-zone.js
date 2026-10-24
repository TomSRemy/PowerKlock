// js/hist/multi-zone.js — Historical prices: block 3, multi-zone section, heatmap and data table.
// Part of the former js/hist.js (lines 7965–9466), split without changes: the parts are plain scripts loaded
// in this order by index.html and share their globals as before.
// ════════════════════════════════════════════
// BLOCK 3 · MULTI ZONE SECTION (insta tabs)
// Tabs: Lines · Heatmap · Profile · Bands · Spread
// ════════════════════════════════════════════

const HMZ = {
  tab: 'lines',
  tabs: [
    { id: 'lines',   label: 'Lines' },
    { id: 'heatmap', label: 'Heatmap' },
    { id: 'bands',   label: 'Bands' },
    { id: 'spread',  label: 'Spread' },
  ],
  // Heatmap granularity: 'day' | 'week' | 'month' | 'dow'
  // - day/week/month: chronological cells, useful for short / medium / long windows
  // - dow: zone × day-of-week (Mon..Sun), aggregated across the whole window
  // HoD (hour of day) is not supported on daily-aggregated history; peak/off-peak
  // is already captured in the Lines tab via the peakAvg/offAvg fields.
  heatmapMode: 'day',
  // Spread sub-mode: 'vsRef' (temporal series: zone − baseline) | 'vsPeers' (scatter BESS-hotspot).
  // Persisted in localStorage under 'pk_hmz_spreadMode' to honour the user's last choice.
  spreadMode: (() => {
    try {
      const v = localStorage.getItem('pk_hmz_spreadMode');
      return (v === 'vsRef' || v === 'vsPeers') ? v : 'vsRef';
    } catch (_) { return 'vsRef'; }
  })(),
};

function setHistMultiTab(tabId) {
  HMZ.tab = tabId;
  buildHistMultiTabs();
  _hmzSetTitle(tabId);
  // Return the promise so callers (e.g. FS onclick) can wait for the
  // async rebuild before refreshing the fullscreen.
  return renderHistMulti();
}
window.setHistMultiTab = setHistMultiTab;

// ── HMZ dynamic title block ──────────────────────────────────────────────
// Mirrors _ccSetTitle (Daily Cross-zone). Populates #hmz-eyebrow / #hmz-title /
// #hmz-subtitle based on the active HMZ tab + current window + selected zones.
// Called by setHistMultiTab on tab change, and also by renderHistMulti() so
// the title stays in sync when zones or window change.
function _hmzSetTitle(tab) {
  tab = tab || HMZ.tab || 'lines';
  const selected = (window._compareZones || window._userZones || new Set(['FR']));
  const zonesCount = (selected.size != null) ? selected.size : (selected.length || 0);
  const win = (HIST.windows && HIST.windows['hmz']) || '3M';
  const winLabel = (win === 'YTD') ? 'YTD' : (win === 'All' ? 'All-time' : win);
  const baseline = HIST.hmzBaseline || 'FR';
  const heatmapMode = HMZ.heatmapMode || 'day';
  const heatmapLabel = { day:'daily', week:'weekly', month:'monthly', dow:'by day-of-week' }[heatmapMode] || heatmapMode;

  const titles = {
    lines: {
      eyebrow:  `Historical Cross-zone · Lines · ${zonesCount} zone${zonesCount > 1 ? 's' : ''}`,
      title:    'Daily averages overlay across selected zones',
      subtitle: `${winLabel} window · ENTSO-E`,
    },
    heatmap: {
      eyebrow:  `Historical Cross-zone · Heatmap · ${zonesCount} zone${zonesCount > 1 ? 's' : ''}`,
      title:    `Price intensity — ${heatmapLabel} resolution`,
      subtitle: `${winLabel} window · vs ${baseline} baseline · ENTSO-E`,
    },
    bands: {
      eyebrow:  `Historical Cross-zone · Bands · ${zonesCount} zone${zonesCount > 1 ? 's' : ''}`,
      title:    'Statistical envelope per zone',
      subtitle: `${winLabel} window · P10–P90 distribution · ENTSO-E`,
    },
    spread: {
      eyebrow:  `Historical Cross-zone · Spread · ${zonesCount} zone${zonesCount > 1 ? 's' : ''} vs ${baseline}`,
      title:    `Cross-zone spread vs ${baseline}`,
      subtitle: `${winLabel} window · zone − ${baseline} in €/MWh · ENTSO-E`,
    },
  };
  const t = titles[tab] || titles.lines;

  // Populate inline block
  const ey = document.getElementById('hmz-eyebrow');
  const ti = document.getElementById('hmz-title');
  const su = document.getElementById('hmz-subtitle');
  if (ey) ey.textContent = t.eyebrow;
  if (ti) ti.textContent = t.title;
  if (su) su.textContent = t.subtitle;
}
window._hmzSetTitle = _hmzSetTitle;


function buildHistMultiTabs() {
  const wrap = document.getElementById('hmz-tabs');
  if (!wrap) return;
  wrap.innerHTML = HMZ.tabs.map(t => {
    const on = t.id === HMZ.tab;
    return `<button onclick="setHistMultiTab('${t.id}')" style="
      padding:5px 12px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;
      border:none;background:${on?'var(--bg3)':'transparent'};
      color:${on?'var(--text)':'var(--tx3)'};
      letter-spacing:.03em;
    ">${t.label}</button>`;
  }).join('');
}

function setHmzBaseline(zone) {
  HIST.hmzBaseline = zone;
  return renderHistMulti();
}
window.setHmzBaseline = setHmzBaseline;

// Inline chip picker (same UX as Daily Compare zones · "SPREAD vs [chips]")
function _hmzPopulateRefChips(selected) {
  const host = document.getElementById('hmz-ref-chips');
  if (!host) return;
  const sel = Array.isArray(selected) ? selected : Array.from(selected || []);
  if (!sel.length) { host.innerHTML = ''; return; }
  let cur = HIST.hmzBaseline;
  if (!cur || !sel.includes(cur)) {
    cur = sel.includes('FR') ? 'FR' : sel[0];
    HIST.hmzBaseline = cur;
  }
  host.innerHTML = sel.map(z => {
    const isOn = z === cur;
    const col  = (window._zoneColorMap && window._zoneColorMap[z]) || '#4A6280';
    return `<button onclick="setHmzBaseline('${z}')" style="
      padding:3px 9px;border-radius:4px;font-size:10px;cursor:pointer;border:1px solid ${isOn?col:'rgba(255,255,255,.12)'};
      background:${isOn?col+'22':'transparent'};color:${isOn?col:'rgba(255,255,255,.55)'};
      font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.03em;transition:all .15s;
    ">${z}</button>`;
  }).join('');
}
window._hmzPopulateRefChips = _hmzPopulateRefChips;

function _hmzToggleRefWrap(mode) {
  // Kept for back-compat. Delegates to the unified _hmzUpdateTabContext.
  _hmzUpdateTabContext(mode);
}

// Switch Heatmap granularity. Persists the choice on HMZ.heatmapMode.
// ════════════════════════════════════════════════════════════════════
// Heatmap granularity auto-tuning
// When the user changes the time window (7D/1M/3M/6M/1Y/5Y/All), the
// heatmap granularity is automatically set so all cells fit on one screen
// without horizontal scroll. The logic is based on cell count, not the
// window key string, so YTD and other dynamic windows behave correctly.
//
// Cell budget (target: stay under ~60 cells horizontal):
//   ≤ 14 days  → Day   (one cell per day, max ~14 cells)
//   15-90 days → Week  (one cell per week, max ~13 cells)
//   > 90 days  → Month (one cell per month, max ~60 cells)
//
// Manual override: if the user clicks a different granularity inside a
// given window, that choice sticks until the window changes again. The
// override is tracked via HMZ._heatmapModeManual flag; resetting on
// window change brings back the auto-mode.
// ════════════════════════════════════════════════════════════════════
function _hmzAutoHeatmapMode(windowKey) {
  // Approximate days-per-window mapping (avoids needing the actual filtered
  // series length to make a decision). YTD is computed from today's date.
  const w = (windowKey || '').toUpperCase();
  let days = 90; // safe default
  if (w === '7D')       days = 7;
  else if (w === '1M')  days = 30;
  else if (w === '3M')  days = 90;
  else if (w === '6M')  days = 180;
  else if (w === '1Y')  days = 365;
  else if (w === '2Y')  days = 730;
  else if (w === '5Y')  days = 1825;
  else if (w === 'ALL') days = 3650;
  else if (w === 'YTD') {
    // Days since Jan 1 of the current year
    const today = new Date();
    const jan1 = new Date(today.getFullYear(), 0, 1);
    days = Math.floor((today - jan1) / 86400000) + 1;
  }

  if (days <= 14)  return 'day';
  if (days <= 90)  return 'week';
  return 'month';
}

// Called by setHistWindow when the HMZ window changes. Resets any manual
// override and re-applies the auto-tuned mode.
function _hmzApplyAutoHeatmapMode() {
  const win = HIST.windows['hmz'] || '3M';
  HMZ.heatmapMode = _hmzAutoHeatmapMode(win);
  HMZ._heatmapModeManual = false;
}

function setHmzHeatmapMode(mode) {
  if (!['day','week','month','dow'].includes(mode)) return;
  HMZ.heatmapMode = mode;
  HMZ._heatmapModeManual = true; // mark as user override
  return renderHistMulti();
}
window.setHmzHeatmapMode = setHmzHeatmapMode;

// Switch Spread sub-mode (vsRef temporal series / vsPeers scatter).
// Persists to localStorage so the user's last choice is restored.
function setHmzSpreadMode(mode) {
  if (mode !== 'vsRef' && mode !== 'vsPeers') return;
  HMZ.spreadMode = mode;
  try { localStorage.setItem('pk_hmz_spreadMode', mode); } catch (_) {}
  return renderHistMulti();
}
window.setHmzSpreadMode = setHmzSpreadMode;

function _hmzToggleHeatmapControls(mode) {
  // Kept for back-compat. Delegates to the unified _hmzUpdateTabContext.
  _hmzUpdateTabContext(mode);
}

// ════════════════════════════════════════════════════════════════════
// _hmzUpdateTabContext(tab) — single source of truth for the HMZ tabbar:
//   - Decides which sub-toggle is shown (centered under the active tab)
//   - Decides which zone chips are shown (right of the tabs row)
//   - Repositions the sub-toggle pixel-perfect via pkPositionSubToggle
//
// Sub-toggle visibility per tab:
//   lines   → none
//   heatmap → granularity (Day/Week/Month/DoW)
//   bands   → none
//   spread  → mode (vs Ref / vs Peers)
//
// Zone chips visibility per tab:
//   heatmap          → baseline chips
//   spread + vsRef   → baseline chips
//   spread + vsPeers → none (scatter cross-zones, no baseline)
//   lines / bands    → none
// ════════════════════════════════════════════════════════════════════
function _hmzUpdateTabContext(tab) {
  const subToggle   = document.getElementById('hmz-sub-toggle');
  const tabChipsEl  = document.getElementById('hmz-tab-chips');
  const tabsCont    = document.getElementById('hmz-tabs');
  if (!subToggle || !tabChipsEl) return;

  // ─── Decide content of the sub-toggle ───
  let subToggleHTML = '';
  if (tab === 'heatmap') {
    const modes = [
      { id: 'day',   label: 'Day' },
      { id: 'week',  label: 'Week' },
      { id: 'month', label: 'Month' },
      { id: 'dow',   label: 'DoW' },
    ];
    const cur = HMZ.heatmapMode || 'day';
    subToggleHTML = modes.map(m => window.pkPill({
      label:    m.label,
      active:   m.id === cur,
      onClick:  `setHmzHeatmapMode('${m.id}')`,
      dataAttr: `data-hmz-hm-mode="${m.id}"`,
    })).join('');
  } else if (tab === 'spread') {
    const modes = [
      { id: 'vsRef',   label: 'vs Ref' },
      { id: 'vsPeers', label: 'vs Peers' },
    ];
    const cur = HMZ.spreadMode || 'vsRef';
    subToggleHTML = modes.map(m => window.pkPill({
      label:    m.label,
      active:   m.id === cur,
      onClick:  `setHmzSpreadMode('${m.id}')`,
      dataAttr: `data-hmz-sm="${m.id}"`,
    })).join('');
  }

  if (subToggleHTML) {
    subToggle.innerHTML = subToggleHTML;
    subToggle.style.display = 'inline-flex';
  } else {
    subToggle.style.display = 'none';
    subToggle.innerHTML = '';
  }

  // ─── Decide content of the zone chips (right of the tabs row) ───
  const showChips =
    (tab === 'heatmap') ||
    (tab === 'spread' && HMZ.spreadMode !== 'vsPeers');

  if (showChips) {
    const sel = Array.from(window._hmzSelected || []);
    if (sel.length) {
      let baseline = HIST.hmzBaseline;
      if (!baseline || !sel.includes(baseline)) {
        baseline = sel.includes('FR') ? 'FR' : sel[0];
        HIST.hmzBaseline = baseline;
      }
      tabChipsEl.innerHTML = sel.map(z => {
        const col = (window._zoneColorMap && window._zoneColorMap[z]) || '#4A6280';
        return window.pkZoneChip({
          code: z,
          active: z === baseline,
          color: col,
          onClick: `setHmzBaseline('${z}')`,
        });
      }).join('');
      tabChipsEl.style.display = 'flex';
    } else {
      tabChipsEl.style.display = 'none';
      tabChipsEl.innerHTML = '';
    }
  } else {
    tabChipsEl.style.display = 'none';
    tabChipsEl.innerHTML = '';
  }
}

// (Resize handler removed: sub-toggle is now left-aligned via static CSS,
//  no JS positioning required.)

async function renderHistMulti() {
  buildHistMultiTabs();
  const w = HIST.windows['hmz'] || '3M';
  // Auto-tune heatmap granularity to the window unless the user has explicitly
  // overridden it during this window (HMZ._heatmapModeManual). At first load
  // the flag is undefined → falsy → auto-apply.
  if (!HMZ._heatmapModeManual) {
    HMZ.heatmapMode = _hmzAutoHeatmapMode(w);
  }
  // Refresh dynamic title (window/baseline/heatmapMode may have changed)
  if (typeof _hmzSetTitle === 'function') _hmzSetTitle(HMZ.tab);
  const s = await fetchSummary();
  if (!s?.zones) return;

  updateZoneLabels();

  const selected = getUserZones().filter(z => s.zones[z]);
  if (!selected.length) {
    _hmzPlaceholder('No zone selected');
    return;
  }
  // Expose for the controls populator (Heatmap baseline picker)
  window._hmzSelected = selected;

  // Build per-zone filtered data + stats
  const perZone = {};
  const stats = {};
  selected.forEach(z => {
    perZone[z] = filterByWindow(s.zones[z], w);
  });
  // Cross-zone comparisons only make sense on the same delivery days: zones
  // with a shorter history (most non-FR zones before the backfill) would
  // otherwise be averaged over a different period than FR.
  const cov = _pkCommonDays(perZone);
  if (cov.restricted) selected.forEach(z => { perZone[z] = perZone[z].filter(e => cov.days.has(e.d)); });
  window._hmzCoverage = cov;
  selected.forEach(z => { stats[z] = _statsForZone(perZone[z]); });

  // KPI strip — baseline is user-configurable via the Compare header dropdown
  let baseline = HIST.hmzBaseline || 'FR';
  // Fallback: if the chosen baseline isn't in the selected zones, use FR or the first one
  if (!selected.includes(baseline)) {
    baseline = selected.includes('FR') ? 'FR' : selected[0];
  }
  const baseStats = stats[baseline];

  // KPI 1 · Zones loaded (value = zone count, meta = loaded avg + baseline tag)
  // Loaded avg = simple mean of per-zone period averages.
  const validStats = selected.filter(z => stats[z]).map(z => ({ z, avg: stats[z].avg }));
  const loadedAvg = validStats.length
    ? validStats.reduce((s, x) => s + x.avg, 0) / validStats.length
    : null;
  document.getElementById('hmz-kpi-zones-v').innerHTML = selected.length + '<span class="kpi-unit">zones</span>';
  const zonesMetaEl = document.getElementById('hmz-kpi-zones-meta');
  if (zonesMetaEl) {
    zonesMetaEl.innerHTML = loadedAvg != null
      ? `avg <strong style="color:var(--tx)">${loadedAvg.toFixed(2)} €/MWh</strong> · ${baseline} baseline`
      : `${baseline} baseline`;
  }

  // KPI 2-3-4 · Cheapest / Most expensive / Spread
  let cheap = null, pricey = null;
  if (validStats.length) {
    validStats.sort((a, b) => a.avg - b.avg);
    cheap = validStats[0];
    pricey = validStats[validStats.length - 1];
    document.getElementById('hmz-kpi-cheapest-v').innerHTML = cheap.avg.toFixed(2) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-cheapest-meta').textContent = cheap.z;
    document.getElementById('hmz-kpi-priciest-v').innerHTML = pricey.avg.toFixed(2) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-priciest-meta').textContent = pricey.z;
    document.getElementById('hmz-kpi-spread-v').innerHTML = (pricey.avg - cheap.avg).toFixed(2) + '<span class="kpi-unit">€/MWh</span>';
  }

  // KPI 5 · FR vs cheapest (gap = FR avg − cheapest avg)
  // Convention: red if FR > cheapest (FR is more expensive than the bargain market),
  //              green if FR ≤ cheapest (FR is the bargain or tied with it),
  //              flat if FR not loaded.
  const frEntry = validStats.find(x => x.z === 'FR');
  const frgapCard = document.getElementById('hmz-kpi-frgap');
  if (frgapCard) frgapCard.classList.remove('kpi-up', 'kpi-down', 'kpi-flat');
  if (frEntry && cheap) {
    const gap = frEntry.avg - cheap.avg;
    const pct = cheap.avg > 0 ? (gap / cheap.avg) * 100 : 0;
    document.getElementById('hmz-kpi-frgap-v').innerHTML =
      (gap >= 0 ? '+' : '') + gap.toFixed(2) + '<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-frgap-meta').innerHTML =
      (pct >= 0 ? '+' : '') + pct.toFixed(1) + '% · ' + cheap.z + ' cheapest';
    // Color class: monter = rouge (FR plus cher = signal défavorable)
    if (frgapCard) {
      if (frEntry.z === cheap.z) frgapCard.classList.add('kpi-up');   // FR is the cheapest itself
      else if (gap > 0)         frgapCard.classList.add('kpi-down');  // FR more expensive than cheapest
      else                       frgapCard.classList.add('kpi-up');   // FR equal or cheaper (rare)
    }
  } else {
    // FR not loaded
    document.getElementById('hmz-kpi-frgap-v').innerHTML = '--<span class="kpi-unit">€/MWh</span>';
    document.getElementById('hmz-kpi-frgap-meta').textContent = 'FR not loaded';
    if (frgapCard) frgapCard.classList.add('kpi-flat');
  }

  // Period label
  let firstD = null, lastD = null;
  Object.values(perZone).forEach(arr => {
    if (arr.length) {
      const f = arr[0].d, l = arr[arr.length-1].d;
      if (!firstD || f < firstD) firstD = f;
      if (!lastD || l > lastD)   lastD = l;
    }
  });
  const periodEl = document.getElementById('hmz-period');
  if (periodEl && firstD && lastD) {
    const cov = window._hmzCoverage;
    periodEl.innerHTML = periodLabel([{d:firstD},{d:lastD}]) + (cov && cov.restricted
      ? ` · <span style="color:var(--warn)">compared on ${cov.n} common days (history coverage differs across zones)</span>` : '');
  }

  // Toggle canvas vs heatmap
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = '';
  if (heatmap) heatmap.style.display = 'none';

  // ── Analyst banner (amber style ◈ + Market read) ──
  const anchor = document.getElementById('hmz-analyst-banner-anchor');
  if (anchor && cheap && pricey && typeof _buildAnalystBanner === 'function') {
    const frGap = frEntry ? (frEntry.avg - cheap.avg) : null;
    const modeMap = { lines: 'ccLines', heatmap: 'ccHeatmap', profile: 'ccProfile', bands: 'ccBands', spread: 'ccSpread', dist: 'ccLines' };
    const bannerHtml = _buildAnalystBanner(modeMap[HMZ.tab] || 'ccLines', {
      cheap, pricey, frGap, loadedAvg, zoneCount: validStats.length, view: HMZ.tab,
    });
    anchor.innerHTML = bannerHtml || '';
  } else if (anchor) {
    anchor.innerHTML = '';
  }

  // Normalise legacy tab aliases BEFORE rendering the table, so the table
  // columns match the actually-rendered chart.
  //   'profile' → Heatmap mode DoW (folded in 2026-05)
  //   'dist'    → Bands (folded in 2026-05; same boxplot semantic, lighter visuals)
  if (HMZ.tab === 'profile') { HMZ.tab = 'heatmap'; HMZ.heatmapMode = 'dow'; }
  else if (HMZ.tab === 'dist') { HMZ.tab = 'bands'; }

  // Render HMZ data table (same template as Daily Compare zones · compact)
  renderHmzTable(HMZ.tab, stats, selected, baseline);

  // Update the tabbar context: sub-toggle + tab-contextual zone chips,
  // pixel-perfect centered under the active tab.
  _hmzUpdateTabContext(HMZ.tab);

  // Dispatch by tab
  if (HMZ.tab === 'lines')   return _hmzRenderLines(perZone, selected);
  if (HMZ.tab === 'heatmap') return _hmzRenderHeatmap(perZone, selected);
  if (HMZ.tab === 'bands')   return _hmzRenderBands(perZone, selected, baseline);
  if (HMZ.tab === 'spread')  return _hmzRenderSpread(perZone, selected, baseline);
  return _hmzPlaceholder(HMZ.tab + ' · data ready · chart coming next');
}
window.renderHistMulti = renderHistMulti;

// ═══════════════════════════════════════════════════════════════════
//  HMZ data table · STRICTLY MIRRORS Daily Compare zones (compact 9px 6px, 11px, 2 decimals)
//  ─ Header columns adapt to the active mode (lines/heatmap/profile/bands/spread)
//  ─ Body styled identically to ccBody* in prices.js
//  ─ Hover/click row → highlight matching curve in #hmz-canvas
// ═══════════════════════════════════════════════════════════════════
function renderHmzTable(view, stats, selected, baseline) {
  const thead = document.getElementById('hmz-data-thead');
  const tbody = document.getElementById('hmz-data-tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = _hmzTableHeader(view);
  const rows = selected.map(z => {
    const st = stats[z];
    if (!st) return null;
    return { code: z, ...st };
  }).filter(Boolean);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text3);text-align:center;padding:9px 6px;font-size:11px">No zones selected</td></tr>`;
    return;
  }
  let html = '';
  switch (view) {
    case 'heatmap': html = _hmzBodyHeatmap(rows); break;
    case 'profile': html = _hmzBodyProfile(rows); break;
    case 'bands':   html = _hmzBodyBands(rows, baseline); break;
    case 'spread':  html = _hmzBodySpread(rows, baseline); break;
    case 'lines':
    default:        html = _hmzBodyLines(rows);
  }
  tbody.innerHTML = html;
  _hmzWireRowHighlight();
}

function _hmzTableHeader(view) {
  // Spread column set depends on the active sub-mode:
  //   vsRef   → temporal series semantics (Avg spread, % vs ref, σ, min spread)
  //   vsPeers → BESS scatter semantics  (Peak avg, Off-pk avg, P-OP spread, Intraday range, Days)
  const spreadCols = (HMZ.spreadMode === 'vsPeers')
    ? [
        { w:'18%', label:'Zone' },
        { w:'12%', label:'Avg', sub:'€/MWh', align:'right' },
        { w:'14%', label:'Peak avg', sub:'€/MWh', align:'right' },
        { w:'14%', label:'Off-pk avg', sub:'€/MWh', align:'right' },
        { w:'14%', label:'P−OP spread', sub:'€/MWh', align:'right' },
        { w:'18%', label:'Intraday range', sub:'avg max−min · €/MWh', align:'right' },
        { w:'10%', label:'Days', sub:'count', align:'right' },
      ]
    : [
        { w:'22%', label:'Zone' },
        { w:'14%', label:'Avg', sub:'€/MWh', align:'right' },
        { w:'30%', label:'Avg spread vs ref', sub:'€/MWh + bar', align:'right' },
        { w:'14%', label:'% vs ref', sub:'(zone−ref)/ref', align:'right' },
        { w:'10%', label:'σ vs σ-ref', align:'right' },
        { w:'10%', label:'Min spread', align:'right' },
      ];

  const cols = {
    lines: [
      { w:'22%', label:'Zone' },
      { w:'10%', label:'Avg', sub:'€/MWh', align:'right' },
      { w:'30%', label:'Range', sub:'min — max · €/MWh', align:'left' },
      { w:'22%', label:'Peak / Off-pk avg', sub:'€/MWh', align:'right' },
      { w:'16%', label:'Intraday spread', sub:'€/MWh', align:'right' },
    ],
    heatmap: [
      { w:'22%', label:'Zone' },
      { w:'12%', label:'Avg', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Min', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Max', sub:'€/MWh', align:'right' },
      { w:'12%', label:'Neg hrs', sub:'count', align:'right' },
      { w:'26%', label:'High-stress hrs', sub:'count + bar', align:'right' },
    ],
    profile: [
      { w:'22%', label:'Zone' },
      { w:'14%', label:'Avg', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Peak avg', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Off-pk avg', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Peak shape', sub:'peak/avg %', align:'right' },
      { w:'12%', label:'Off-pk shape', sub:'off-pk/avg %', align:'right' },
      { w:'10%', label:'Spread P/OP', sub:'€/MWh', align:'right' },
    ],
    bands: [
      { w:'22%', label:'Zone' },
      { w:'14%', label:'Avg', sub:'€/MWh', align:'right' },
      { w:'12%', label:'σ', sub:'std-dev', align:'right' },
      { w:'14%', label:'Intraday', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Min', sub:'€/MWh', align:'right' },
      { w:'14%', label:'Max', sub:'€/MWh', align:'right' },
      { w:'10%', label:'Days', sub:'count', align:'right' },
    ],
    spread: spreadCols,
  };
  const c = cols[view] || cols.lines;
  return '<tr>' + c.map(col => `
    <th style="width:${col.w};text-align:${col.align||'left'};padding:8px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" ${col.tip?`title="${col.tip}"`:''}>
      ${col.label}${col.sub?`<br><span style="color:var(--tx3);font-weight:400;font-size:9px">${col.sub}</span>`:''}
    </th>`).join('') + '</tr>';
}

function _hmzZoneCell(r) {
  const col = (window._zoneColorMap && window._zoneColorMap[r.code]) || _hmzZoneColor(r.code) || '#B8C9D9';
  const meta = (typeof ZONE_META !== 'undefined' && ZONE_META[r.code]) || {};
  const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[r.code]) || '';
  const country = meta.country || (typeof _HO_NAMES !== 'undefined' && _HO_NAMES[r.code]) || r.code;
  return `<td style="padding:9px 6px;vertical-align:middle">
    <span style="display:inline-block;width:3px;height:12px;background:${col};border-radius:2px;vertical-align:middle;margin-right:6px"></span>
    <span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${col};font-size:11px">${flag} ${r.code}</span>
    <span style="color:var(--text3);margin-left:5px;font-family:'Inter',sans-serif;font-size:10.5px">${country}</span>
  </td>`;
}
function _hmzZoneColor(code) {
  return (typeof HMZ_COLOR_FOR === 'function') ? HMZ_COLOR_FOR(code) : null;
}
function _hmzTr(r, cells) {
  return `<tr data-zone="${r.code}" style="border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;transition:background .15s">
    ${_hmzZoneCell(r)}${cells}
  </tr>`;
}

const _HMZ_TD_R = "text-align:right;padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;vertical-align:middle";
const _HMZ_SUB  = "color:var(--text3);font-size:9px";

function _hmzBodyLines(rows) {
  const allMins = rows.map(r => r.min).filter(v => v != null);
  const allMaxs = rows.map(r => r.max).filter(v => v != null);
  const globalMin = allMins.length ? Math.min(...allMins) : 0;
  const globalMax = allMaxs.length ? Math.max(...allMaxs) : 1;
  const globalRng = (globalMax - globalMin) || 1;
  return rows.map(r => {
    const col = (window._zoneColorMap && window._zoneColorMap[r.code]) || _hmzZoneColor(r.code) || '#B8C9D9';
    const leftPct  = r.min != null ? ((r.min - globalMin) / globalRng) * 100 : 0;
    const widthPct = (r.min != null && r.max != null) ? ((r.max - r.min) / globalRng) * 100 : 0;
    const cells = `
      <td style="${_HMZ_TD_R};font-weight:600;color:var(--text)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="padding:9px 6px;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:0 0 48px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${r.min<0?'var(--down)':'var(--text2)'};line-height:11px">
            ${r.min != null ? r.min.toFixed(2) : '--'}
          </div>
          <div style="flex:1;position:relative;height:8px">
            <div style="position:absolute;top:0;left:0;right:0;height:100%;background:rgba(255,255,255,0.05);border-radius:2px"></div>
            <div style="position:absolute;top:0;left:${leftPct.toFixed(1)}%;width:${Math.max(widthPct,2).toFixed(1)}%;height:100%;background:${col};opacity:.55;border-radius:2px"></div>
          </div>
          <div style="flex:0 0 48px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${r.max<0?'var(--down)':'var(--text2)'};line-height:11px">
            ${r.max != null ? r.max.toFixed(2) : '--'}
          </div>
        </div>
      </td>
      <td style="${_HMZ_TD_R}">
        <span style="color:var(--text)">${r.peakAvg != null ? r.peakAvg.toFixed(2) : '--'}</span> <span style="color:var(--text3)">/</span> <span style="color:var(--text2)">${r.offAvg != null ? r.offAvg.toFixed(2) : '--'}</span>
      </td>
      <td style="${_HMZ_TD_R};color:var(--text)">${r.intradaySpread != null ? r.intradaySpread.toFixed(2) : '--'}</td>`;
    return _hmzTr(r, cells);
  }).join('');
}

function _hmzBodyHeatmap(rows) {
  const maxHigh = Math.max(...rows.map(r => r.highH || 0), 1);
  return rows.map(r => {
    const negCol = (r.negH || 0) > 0 ? 'var(--down)' : 'var(--text3)';
    const highPct = ((r.highH || 0) / maxHigh) * 100;
    const highBarCol = highPct > 50 ? '#ED6965' : (highPct > 25 ? '#FBBF24' : '#14D3A9');
    const cells = `
      <td style="${_HMZ_TD_R};font-weight:600;color:var(--text)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:${r.min<0?'var(--down)':'var(--text2)'}">${r.min != null ? r.min.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text)">${r.max != null ? r.max.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:${negCol}">${(r.negH || 0).toFixed(0)}</td>
      <td style="${_HMZ_TD_R}">
        <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;width:100%">
          <span style="color:var(--text2)">${(r.highH || 0).toFixed(0)}</span>
          <span style="display:inline-block;width:50px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative">
            <span style="display:block;height:100%;width:${Math.min(highPct,100).toFixed(0)}%;background:${highBarCol};opacity:.7;border-radius:2px"></span>
          </span>
        </div>
      </td>`;
    return _hmzTr(r, cells);
  }).join('');
}

function _hmzBodyProfile(rows) {
  return rows.map(r => {
    const peakShape    = (r.peakAvg != null && r.avg != null && Math.abs(r.avg) > 0.5) ? (r.peakAvg / r.avg) * 100 : null;
    const offPeakShape = (r.offAvg != null  && r.avg != null && Math.abs(r.avg) > 0.5) ? (r.offAvg  / r.avg) * 100 : null;
    const spreadPO     = (r.peakAvg != null && r.offAvg != null) ? (r.peakAvg - r.offAvg) : null;
    const peakCol      = peakShape != null    && peakShape    > 100 ? 'var(--text)' : 'var(--warn)';
    const offPeakCol   = offPeakShape != null && offPeakShape < 100 ? 'var(--text2)' : 'var(--warn)';
    const spreadCol    = spreadPO == null ? 'var(--text3)' : (spreadPO < 0 ? 'var(--down)' : 'var(--text)');
    const cells = `
      <td style="${_HMZ_TD_R};font-weight:600;color:var(--text)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text)">${r.peakAvg != null ? r.peakAvg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.offAvg != null ? r.offAvg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:${peakCol}">${peakShape != null ? peakShape.toFixed(0)+'%' : '--'}</td>
      <td style="${_HMZ_TD_R};color:${offPeakCol}">${offPeakShape != null ? offPeakShape.toFixed(0)+'%' : '--'}</td>
      <td style="${_HMZ_TD_R};color:${spreadCol}">${spreadPO != null ? (spreadPO>=0?'+':'')+spreadPO.toFixed(2) : '--'}</td>`;
    return _hmzTr(r, cells);
  }).join('');
}

function _hmzBodyBands(rows, baseline) {
  return rows.map(r => {
    const cells = `
      <td style="${_HMZ_TD_R};font-weight:600;color:var(--text)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.sigma != null ? r.sigma.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text)">${r.intradaySpread != null ? r.intradaySpread.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:${r.min<0?'var(--down)':'var(--text2)'}">${r.min != null ? r.min.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text)">${r.max != null ? r.max.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text3)">${r.days != null ? r.days : '--'}</td>`;
    return _hmzTr(r, cells);
  }).join('');
}

function _hmzBodySpread(rows, baseline) {
  // Sub-mode dispatch: vsRef uses the temporal-spread semantics (existing
  // columns); vsPeers uses BESS-scatter semantics (Peak / Off-pk / P-OP / Intraday).
  if (HMZ.spreadMode === 'vsPeers') {
    return _hmzBodySpreadVsPeers(rows);
  }
  return _hmzBodySpreadVsRef(rows, baseline);
}

// vsRef: same columns as before — Avg, Avg spread vs ref + bar, % vs ref, σ-diff, min spread
function _hmzBodySpreadVsRef(rows, baseline) {
  const ref = rows.find(r => r.code === baseline);
  // Compute max absolute spread for divergent bar
  const validSpreads = rows.filter(r => r.code !== baseline && r.avg != null && ref?.avg != null).map(r => Math.abs(r.avg - ref.avg));
  const maxAbs = validSpreads.length ? Math.max(...validSpreads, 1) : 1;
  return rows.map(r => {
    if (r.code === baseline) {
      const cells = `<td colspan="5" style="text-align:center;padding:9px 6px;color:var(--text3);font-size:11px;font-style:italic">— reference (${baseline}) —</td>`;
      return _hmzTr(r, cells);
    }
    const avgSpread = (r.avg != null && ref?.avg != null) ? (r.avg - ref.avg) : null;
    const pctVsRef  = (avgSpread != null && Math.abs(ref?.avg || 0) > 0.5) ? (avgSpread / ref.avg) * 100 : null;
    const sigmaDiff = (r.sigma != null && ref?.sigma != null) ? (r.sigma - ref.sigma) : null;
    const minSpread = (r.min != null && ref?.min != null) ? (r.min - ref.min) : null;
    const avgCol = avgSpread == null ? 'var(--text3)' : (avgSpread > 0 ? 'var(--up)' : 'var(--down)');
    const pctCol = pctVsRef == null ? 'var(--text3)' : (pctVsRef > 0 ? 'var(--up)' : 'var(--down)');
    const sign = v => v >= 0 ? '+' : '';
    const divPct = avgSpread != null ? Math.min(Math.abs(avgSpread) / maxAbs, 1) * 50 : 0;
    const divHTML = avgSpread == null
      ? ''
      : (avgSpread >= 0
          ? `<span style="display:inline-block;width:60px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative;vertical-align:middle"><span style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,0.15)"></span><span style="position:absolute;left:50%;top:0;height:100%;width:${divPct.toFixed(1)}%;background:#ED6965;opacity:.75;border-radius:2px"></span></span>`
          : `<span style="display:inline-block;width:60px;height:6px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative;vertical-align:middle"><span style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,0.15)"></span><span style="position:absolute;right:50%;top:0;height:100%;width:${divPct.toFixed(1)}%;background:#14D3A9;opacity:.75;border-radius:2px"></span></span>`);
    const cells = `
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R}">
        <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end">
          <span style="font-weight:600;color:${avgCol}">${avgSpread != null ? sign(avgSpread)+avgSpread.toFixed(2) : '--'}</span>
          ${divHTML}
        </div>
      </td>
      <td style="${_HMZ_TD_R};color:${pctCol}">${pctVsRef != null ? sign(pctVsRef)+pctVsRef.toFixed(0)+'%' : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${sigmaDiff != null ? sign(sigmaDiff)+sigmaDiff.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${minSpread != null ? sign(minSpread)+minSpread.toFixed(2) : '--'}</td>`;
    return _hmzTr(r, cells);
  }).join('');
}

// vsPeers: BESS scatter semantics — Avg, Peak avg, Off-pk avg, P−OP spread, Intraday range, Days
// Columns mirror the axes/dimensions of the scatter so the table tells the
// same story as the chart. P−OP shaded green when high (BESS-positive),
// Intraday range shaded teal when high (BESS-positive).
function _hmzBodySpreadVsPeers(rows) {
  // Compute medians for highlighting the "BESS hotspot" rows (top quadrant in
  // the scatter) — keep the highlight subtle so the table stays readable.
  const popVals = rows.map(r => (r.peakAvg != null && r.offAvg != null) ? (r.peakAvg - r.offAvg) : null).filter(v => v != null).sort((a,b)=>a-b);
  const intraVals = rows.map(r => r.intradaySpread).filter(v => v != null).sort((a,b)=>a-b);
  const popMed = popVals.length ? _percentile(popVals, 0.5) : null;
  const intraMed = intraVals.length ? _percentile(intraVals, 0.5) : null;

  return rows.map(r => {
    const popSpread = (r.peakAvg != null && r.offAvg != null) ? (r.peakAvg - r.offAvg) : null;
    const intra = r.intradaySpread;
    const isHotspot = (popSpread != null && intra != null && popMed != null && intraMed != null
                      && popSpread > popMed && intra > intraMed);
    // Highlight numbers above median (green = above median = "BESS-positive")
    const popCol = (popSpread != null && popMed != null && popSpread > popMed) ? '#14D3A9' : 'var(--text2)';
    const intraCol = (intra != null && intraMed != null && intra > intraMed) ? '#14D3A9' : 'var(--text2)';
    // Trailing badge for hotspot rows (kept very subtle)
    const badge = isHotspot
      ? '<span title="Above-median on both P−OP and Intraday — BESS hotspot" style="color:#14D3A9;font-size:10px;margin-left:4px">⚡</span>'
      : '';
    const cells = `
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.avg != null ? r.avg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.peakAvg != null ? r.peakAvg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text2)">${r.offAvg != null ? r.offAvg.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:${popCol};font-weight:${popCol === '#14D3A9' ? '600' : '400'}">${popSpread != null ? popSpread.toFixed(2) : '--'}${badge}</td>
      <td style="${_HMZ_TD_R};color:${intraCol};font-weight:${intraCol === '#14D3A9' ? '600' : '400'}">${intra != null ? intra.toFixed(2) : '--'}</td>
      <td style="${_HMZ_TD_R};color:var(--text3)">${r.days != null ? r.days : '--'}</td>`;
    return _hmzTr(r, cells);
  }).join('');
}

// Cross-highlight: hover/click row → highlight matching curve in #hmz-canvas
function _hmzWireRowHighlight() {
  const tbody = document.getElementById('hmz-data-tbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr[data-zone]').forEach(tr => {
    tr.onmouseenter = () => _hmzHighlightZone(tr.dataset.zone, false);
    tr.onmouseleave = () => _hmzHighlightZone(null, false);
    tr.onclick = () => {
      window._hmzFocusZone = (window._hmzFocusZone === tr.dataset.zone) ? null : tr.dataset.zone;
      _hmzHighlightZone(window._hmzFocusZone, true);
    };
  });
}
function _hmzHighlightZone(code, isPersistent) {
  const effective = code != null ? code : window._hmzFocusZone;
  const chart = HIST.charts && HIST.charts['hmz-canvas'];
  if (chart) {
    chart.data.datasets.forEach(ds => {
      const label = ds.label || '';
      const matches = !effective || label.startsWith(effective + ' ') || label.startsWith(effective + ' ·') || label.startsWith(effective + ' −') || label === effective || label.startsWith(effective);
      if (effective) {
        if (ds._origBorderWidth == null) ds._origBorderWidth = ds.borderWidth ?? 2;
        if (ds._origBorderColor == null) ds._origBorderColor = ds.borderColor;
        ds.borderWidth = matches ? 3 : ds._origBorderWidth;
        if (!matches && typeof ds._origBorderColor === 'string' && ds._origBorderColor.startsWith('#')) {
          ds.borderColor = ds._origBorderColor + '40';
        } else if (matches) {
          ds.borderColor = ds._origBorderColor;
        }
      } else {
        if (ds._origBorderWidth != null) ds.borderWidth = ds._origBorderWidth;
        if (ds._origBorderColor != null) ds.borderColor = ds._origBorderColor;
      }
    });
    chart.update('none');
  }
  const tbody = document.getElementById('hmz-data-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr[data-zone]').forEach(tr => {
      tr.style.background = (effective && tr.dataset.zone === effective) ? 'rgba(255,255,255,0.04)' : '';
    });
  }
}

function _hmzPlaceholder(msg) {
  const canvas = document.getElementById('hmz-canvas');
  if (!canvas) return;
  const wrap = canvas.parentNode;
  const old = wrap.querySelector('.no-data-msg');
  if (old) old.remove();
  canvas.style.display = 'none';
  const div = document.createElement('div');
  div.className = 'no-data-msg';
  div.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--tx3);font-size:12px;font-style:italic;letter-spacing:0.04em;text-align:center;padding:0 20px';
  div.innerHTML = msg;
  wrap.appendChild(div);
}

function _hmzRenderLines(perZone, selected) {
  // Union of dates
  const dateSet = new Set();
  selected.forEach(z => perZone[z].forEach(d => dateSet.add(d.d)));
  const labels = Array.from(dateSet).sort();

  const datasets = selected.map(z => {
    const map = {};
    perZone[z].forEach(d => { map[d.d] = d.avg; });
    return {
      label: z,
      data: labels.map(l => map[l] ?? null),
      borderColor: zoneColor(z),
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: zoneColor(z),
      pointHoverBorderColor: '#fff',
      pointHoverBorderWidth: 2,
      tension: 0,
      spanGaps: true,
      fill: false,
    };
  });

  // Inject zero line annotation when any value crosses zero (rare in daily avg
  // but possible during negative-price episodes); harmless when all positive.
  const zeroAnn = (typeof ccZeroLineAnnotation === 'function')
    ? { zeroLine: ccZeroLineAnnotation() }
    : {};

  mkHistChart('hmz-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: _HIST_TX3,
            font: { size: 10 },
            boxWidth: 10,
            padding: 10,
          },
          // Shared focus-on-click behaviour: click a zone → focus (others dim),
          // re-click → reset. Aligned with DA Cross-zone Lines.
          onClick: (e, item, legend) => {
            if (typeof window.pkLegendFocusClick === 'function') {
              window.pkLegendFocusClick(e, item, legend);
            }
          },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          },
        },
        annotation: { annotations: zeroAnn },
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 9 }, maxTicksLimit: 12 } },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 }, callback: v => v.toFixed(0) },
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 9 } },
          grace: '12%',
        },
      },
    },
  });
}

// ── HMZ · Heatmap (unified) · 4 granularities: Day / Week / Month / DoW ──
// Each cell encodes Δ vs baseline zone in colour; absolute €/MWh + Δ shown
// inside the cell. The bucketing changes with HMZ.heatmapMode but the rendering
// pipeline (matrix → deltas → colour → table) is shared.
function _hmzRenderHeatmap(perZone, selected) {
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = 'none';
  if (!heatmap) return;
  heatmap.style.display = 'block';

  // Baseline zone — use HIST.hmzBaseline if set, else first selected (often FR)
  let baseline = HIST.hmzBaseline || 'FR';
  if (!selected.includes(baseline)) baseline = selected[0] || 'FR';

  const mode = HMZ.heatmapMode || 'day';

  // ─── Bucket helpers ──────────────────────────────────────────────────
  // For each daily point d (shape: { d:'YYYY-MM-DD', avg:Number, ... })
  // return the bucket key + a sortable rank + a label for display.
  function bucketFor(d) {
    const iso = d.d;
    if (mode === 'day') {
      // Bucket = the ISO date itself, sortable as-is
      const [y, mo, da] = iso.split('-');
      return { key: iso, rank: iso, label: `${da}/${mo}` };
    }
    if (mode === 'week') {
      // ISO week (Mon-based). Use Thursday-of-week trick for ISO week number.
      const dt = new Date(iso + 'T00:00:00Z');
      const dow = (dt.getUTCDay() + 6) % 7; // 0=Mon
      dt.setUTCDate(dt.getUTCDate() - dow + 3); // Thursday of this ISO week
      const y = dt.getUTCFullYear();
      const jan1 = new Date(Date.UTC(y, 0, 1));
      const wn = Math.ceil(((dt - jan1) / 86400000 + 1) / 7);
      const key = `${y}-W${String(wn).padStart(2,'0')}`;
      return { key, rank: key, label: `W${String(wn).padStart(2,'0')} ’${String(y).slice(2)}` };
    }
    if (mode === 'month') {
      const ym = iso.slice(0, 7);
      const [y, mo] = ym.split('-');
      const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return { key: ym, rank: ym, label: `${names[parseInt(mo)-1]} ${y.slice(2)}` };
    }
    if (mode === 'dow') {
      // Day-of-week aggregated across the whole window. Mon..Sun.
      const dt = new Date(iso + 'T00:00:00Z');
      let dow = dt.getUTCDay();
      dow = (dow + 6) % 7; // 0=Mon
      const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      return { key: String(dow), rank: dow, label: labels[dow] };
    }
    return { key: iso, rank: iso, label: iso };
  }

  // Build buckets union (preserves order via rank)
  const bucketSet = new Map(); // key → { rank, label }
  selected.forEach(z => (perZone[z] || []).forEach(d => {
    if (d.avg == null) return;
    const b = bucketFor(d);
    if (!bucketSet.has(b.key)) bucketSet.set(b.key, { rank: b.rank, label: b.label });
  }));
  const buckets = Array.from(bucketSet.entries())
    .sort((a, b) => (a[1].rank < b[1].rank ? -1 : a[1].rank > b[1].rank ? 1 : 0))
    .map(([key, meta]) => ({ key, label: meta.label }));

  if (!buckets.length || !selected.length) {
    heatmap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:11px">No data</div>';
    return;
  }

  // Build matrix: avg per (zone, bucket)
  const matrix = {};
  selected.forEach(z => {
    matrix[z] = {};
    const byBucket = {};
    (perZone[z] || []).forEach(d => {
      if (d.avg == null) return;
      const b = bucketFor(d);
      if (!byBucket[b.key]) byBucket[b.key] = [];
      byBucket[b.key].push(d.avg);
    });
    buckets.forEach(b => {
      const arr = byBucket[b.key];
      matrix[z][b.key] = (arr && arr.length)
        ? arr.reduce((a, v) => a + v, 0) / arr.length
        : null;
    });
  });

  // Compute deltas vs baseline + find max abs delta for colour scaling
  let maxAbsDelta = 0;
  const deltas = {};
  selected.forEach(z => {
    deltas[z] = {};
    buckets.forEach(b => {
      const v = matrix[z][b.key];
      const baseV = matrix[baseline]?.[b.key];
      if (v != null && baseV != null && z !== baseline) {
        deltas[z][b.key] = v - baseV;
        if (Math.abs(deltas[z][b.key]) > maxAbsDelta) maxAbsDelta = Math.abs(deltas[z][b.key]);
      } else {
        deltas[z][b.key] = null;
      }
    });
  });
  if (maxAbsDelta < 1) maxAbsDelta = 1;

  // Colour by delta: green (cheaper than baseline) → grey (~0) → red (more expensive)
  // Same palette as the previous Heatmap to preserve user expectations.
  const colorForDelta = (d) => {
    if (d == null) return 'rgba(255,255,255,0.05)';
    const t = Math.max(-1, Math.min(1, d / maxAbsDelta));
    if (t < 0) {
      const intensity = Math.abs(t);
      return `rgba(20,211,169,${0.15 + intensity * 0.5})`;
    }
    if (t > 0) {
      return `rgba(237,105,101,${0.15 + t * 0.5})`;
    }
    return 'rgba(255,255,255,0.06)';
  };

  // ─── Dimensions tuned per mode ────────────────────────────────────────
  // Day with long windows = many narrow cells; Month/DoW = fewer wide cells.
  const cellMinWidth = ({
    day: 38, week: 52, month: 62, dow: 80,
  })[mode] || 60;
  const showDelta = mode !== 'dow'; // DoW has a single tile per cell; absolute is enough
  const valuePad  = ({ day: '4px 3px', week: '4px 4px', month: '5px 6px', dow: '8px 6px' })[mode] || '5px 4px';

  const modeLabel = ({ day:'Day', week:'Week', month:'Month', dow:'Day of week' })[mode] || mode;

  // ─── Render table ─────────────────────────────────────────────────────
  let html = `<div style="display:inline-block;min-width:100%;padding:8px">`;
  html += `<div style="font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace;margin-bottom:8px">
    Granularity: <b style="color:var(--tx)">${modeLabel}</b> · Baseline: <b style="color:var(--tx)">${baseline}</b> · Colour encodes Δ vs baseline
  </div>`;
  html += `<table style="border-collapse:separate;border-spacing:2px;font-size:9.5px;font-family:'JetBrains Mono',monospace">`;
  html += `<thead><tr><th style="text-align:left;padding:4px 8px;color:var(--tx3);font-weight:600">Zone</th>`;
  buckets.forEach(b => {
    html += `<th style="text-align:center;padding:4px;color:var(--tx3);font-weight:600;min-width:${cellMinWidth}px">${b.label}</th>`;
  });
  html += `</tr></thead><tbody>`;

  const renderRow = (z) => {
    const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
    const isBaseline = (z === baseline);
    let row = `<tr>`;
    row += `<td style="padding:4px 8px;color:var(--tx);font-weight:600;white-space:nowrap${isBaseline ? ';border-left:2px solid #FBBF24' : ''}">${flag} ${z}${isBaseline ? ' <span style="color:#FBBF24;font-size:8px">★</span>' : ''}</td>`;
    buckets.forEach(b => {
      const v = matrix[z][b.key];
      if (v == null) {
        row += `<td style="background:rgba(255,255,255,0.02);color:var(--tx3);text-align:center;padding:${valuePad};border-radius:3px;min-width:${cellMinWidth}px">--</td>`;
        return;
      }
      let bg, lines;
      if (isBaseline) {
        bg = 'rgba(255,255,255,0.06)';
        lines = `<div style="font-weight:600;color:var(--tx)">${v.toFixed(0)}</div>`;
      } else {
        const d = deltas[z][b.key];
        bg = colorForDelta(d);
        if (showDelta && d != null) {
          const dStr = (d >= 0 ? '+' : '') + d.toFixed(0);
          lines = `<div style="font-weight:600;color:#fff">${v.toFixed(0)}</div><div style="font-size:8.5px;color:rgba(255,255,255,0.7);font-weight:500">${dStr}</div>`;
        } else {
          lines = `<div style="font-weight:600;color:#fff">${v.toFixed(0)}</div>`;
        }
      }
      const title = `${z} · ${b.label}: ${v.toFixed(2)} €/MWh${!isBaseline && deltas[z][b.key] != null ? ' · Δ vs ' + baseline + ': ' + deltas[z][b.key].toFixed(2) : ''}`;
      row += `<td title="${title}" style="background:${bg};text-align:center;padding:${valuePad};border-radius:3px;min-width:${cellMinWidth}px">${lines}</td>`;
    });
    row += `</tr>`;
    return row;
  };
  // Baseline first, then others in their existing order (stable for the user's eye)
  html += renderRow(baseline);
  selected.filter(z => z !== baseline).forEach(z => { html += renderRow(z); });
  html += `</tbody></table>`;

  // Colour scale legend
  html += `<div style="display:flex;align-items:center;gap:10px;margin-top:14px;font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace">
    <span>Cheaper than ${baseline}</span>
    <div style="flex:1;max-width:280px;height:10px;background:linear-gradient(to right, rgba(20,211,169,0.7), rgba(255,255,255,0.1), rgba(237,105,101,0.7));border-radius:2px"></div>
    <span>More expensive</span>
    <span style="margin-left:12px">± ${maxAbsDelta.toFixed(0)} €/MWh max</span>
  </div>`;
  html += `</div>`;
  heatmap.innerHTML = html;
}


// ── HMZ · Bands · Range-bars stacked vertically on a shared €/MWh axis ──
// One row per zone. Visual language:
//   - P10–P90 segment: thin steel-blue line (#475569, stroke-width 2)
//   - P25–P75 box:     coloured by zone, opacity 0.40, height 8 (the "denser" range)
//   - P50 tick:        thick coloured vertical line (height 14, stroke-width 2.5)
//   - Shared X axis at top: nice ticks in €/MWh
// Aligned with DA Cross-zone Bands (same primitives, no boxplot whiskers/dots).
function _hmzRenderBands(perZone, selected, baseline) {
  // Render into the HTML heatmap container (SVG inside), hide the canvas.
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = 'none';
  if (!heatmap) return;
  heatmap.style.display = 'block';

  // Compute stats per zone
  const stats = selected.map(z => ({ zone: z, s: _boxStats((perZone[z] || []).map(d => d.avg)) }));
  const valid = stats.filter(x => x.s);
  if (!valid.length) {
    heatmap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:11px">No data</div>';
    return;
  }

  // ─── Global axis bounds (shared across all rows) ────────────────────
  // Use P10 / P90 union, widened by ~4% padding so segments don't touch edges.
  let gLo = Infinity, gHi = -Infinity;
  valid.forEach(({ s }) => {
    if (s.p10 < gLo) gLo = s.p10;
    if (s.p90 > gHi) gHi = s.p90;
  });
  if (!isFinite(gLo) || !isFinite(gHi)) { gLo = 0; gHi = 100; }
  const span0 = gHi - gLo || 1;
  gLo -= span0 * 0.04;
  gHi += span0 * 0.04;
  const gSpan = gHi - gLo || 1;

  // ─── "Nice" tick generator (1/2/5/10 × magnitude) ────────────────────
  const niceTicks = (lo, hi, count = 5) => {
    const raw = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    step *= mag;
    const first = Math.ceil(lo / step) * step;
    const ticks = [];
    for (let t = first; t <= hi + 1e-6; t += step) ticks.push(t);
    return ticks;
  };
  const axisTicks = niceTicks(gLo, gHi, 5);

  // ─── Dimensions ──────────────────────────────────────────────────────
  // SVG width is responsive (100%); the viewBox uses a logical 1000px width.
  // Per-zone row height ~36px, label gutter on the left.
  const W = 1000;
  const padL = 60;   // left gutter for zone labels
  const padR = 24;   // right padding
  const rowH = 38;   // height per zone row
  const headerH = 30; // top axis header height
  const baselineMark = 6;
  const nRows = valid.length;
  const H = headerH + nRows * rowH + 16; // +16 bottom padding
  const xOf = v => padL + ((v - gLo) / gSpan) * (W - padL - padR);

  // Sort zones by median P50 (cheapest → most expensive) — naturally creates
  // a vertical ranking, which is one of the key benefits of the shared axis.
  // Baseline marked with a yellow accent, kept in its sorted position.
  const sorted = [...valid].sort((a, b) => (a.s.p50 ?? 0) - (b.s.p50 ?? 0));

  // ─── Build SVG ───────────────────────────────────────────────────────
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMinYMin meet" style="display:block;font-family:'JetBrains Mono',monospace">`;

  // ─── Top axis: graduations + numeric labels ─────────────────────────
  svg += `<g>`;
  svg += `<line x1="${padL}" y1="${headerH - 8}" x2="${W - padR}" y2="${headerH - 8}" stroke="rgba(184,201,217,0.25)" stroke-width="0.5"/>`;
  axisTicks.forEach(t => {
    const x = xOf(t).toFixed(1);
    svg += `<line x1="${x}" y1="${headerH - 12}" x2="${x}" y2="${headerH - 4}" stroke="rgba(184,201,217,0.4)" stroke-width="0.5"/>`;
    svg += `<text x="${x}" y="${headerH - 16}" font-size="10" fill="#7A93AB" text-anchor="middle">${Math.round(t)}</text>`;
  });
  svg += `</g>`;

  // ─── Subtle vertical graduations spanning all rows ──────────────────
  axisTicks.forEach(t => {
    const x = xOf(t).toFixed(1);
    svg += `<line x1="${x}" y1="${headerH}" x2="${x}" y2="${H - 8}" stroke="rgba(120,140,170,0.06)" stroke-width="0.5"/>`;
  });

  // ─── One row per zone ───────────────────────────────────────────────
  sorted.forEach(({ zone, s }, i) => {
    const y = headerH + i * rowH + rowH / 2;
    const isBaseline = (zone === baseline);
    const col = (typeof zoneColor === 'function') ? zoneColor(zone) : '#14D3A9';
    const colFill = _toRgba ? _toRgba(col, 0.40) : col;

    // Zone label (left gutter) + baseline marker
    const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[zone]) || '';
    if (isBaseline) {
      svg += `<rect x="0" y="${y - rowH/2 + 4}" width="3" height="${rowH - 8}" fill="#FBBF24"/>`;
    }
    svg += `<text x="${padL - 8}" y="${y + 4}" font-size="11" fill="${col}" font-weight="700" text-anchor="end">${flag} ${zone}</text>`;

    // P10–P90 thin segment
    const xP10 = xOf(s.p10);
    const xP90 = xOf(s.p90);
    svg += `<line x1="${xP10.toFixed(1)}" y1="${y}" x2="${xP90.toFixed(1)}" y2="${y}" stroke="#475569" stroke-width="2" stroke-linecap="round"/>`;

    // P25–P75 box (coloured, opaque) — the "denser" range
    if (s.p25 != null && s.p75 != null) {
      const xP25 = xOf(s.p25);
      const xP75 = xOf(s.p75);
      const boxH = 8;
      svg += `<rect x="${xP25.toFixed(1)}" y="${(y - boxH/2).toFixed(1)}" width="${(xP75 - xP25).toFixed(1)}" height="${boxH}" fill="${colFill}" rx="2"/>`;
    }

    // P50 tick (thick coloured vertical line)
    const xP50 = xOf(s.p50);
    svg += `<line x1="${xP50.toFixed(1)}" y1="${(y - 7).toFixed(1)}" x2="${xP50.toFixed(1)}" y2="${(y + 7).toFixed(1)}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`;

    // P50 numeric label (small, to the right of the tick)
    const labelX = (xP50 + 8 < W - padR - 30) ? xP50 + 8 : xP50 - 8;
    const labelAnchor = (xP50 + 8 < W - padR - 30) ? 'start' : 'end';
    svg += `<text x="${labelX.toFixed(1)}" y="${(y - 8).toFixed(1)}" font-size="9" fill="${col}" font-weight="600" text-anchor="${labelAnchor}">${s.p50.toFixed(0)}</text>`;

    // Tooltip via <title> on the row group
    const tip = `${zone} · P10 ${s.p10.toFixed(1)} · P25 ${s.p25.toFixed(1)} · P50 ${s.p50.toFixed(1)} · P75 ${s.p75.toFixed(1)} · P90 ${s.p90.toFixed(1)} €/MWh`;
    svg += `<rect x="${padL}" y="${(y - rowH/2).toFixed(1)}" width="${W - padL - padR}" height="${rowH}" fill="transparent"><title>${tip}</title></rect>`;
  });

  svg += `</svg>`;

  // ─── Legend ──────────────────────────────────────────────────────────
  const legendHtml = `
    <div style="display:flex;align-items:center;gap:18px;margin-top:8px;font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace;flex-wrap:wrap">
      <span style="display:inline-flex;align-items:center;gap:5px">
        <svg width="20" height="6" viewBox="0 0 20 6"><line x1="0" y1="3" x2="20" y2="3" stroke="#475569" stroke-width="2" stroke-linecap="round"/></svg>
        P10–P90 range
      </span>
      <span style="display:inline-flex;align-items:center;gap:5px">
        <svg width="20" height="6" viewBox="0 0 20 6"><rect x="0" y="1" width="20" height="4" rx="1" fill="rgba(20,211,169,0.40)"/></svg>
        P25–P75 (IQR)
      </span>
      <span style="display:inline-flex;align-items:center;gap:5px">
        <svg width="6" height="14" viewBox="0 0 6 14"><line x1="3" y1="0" x2="3" y2="14" stroke="#14D3A9" stroke-width="2.5" stroke-linecap="round"/></svg>
        P50 median
      </span>
      <span style="margin-left:6px">Sorted by median (cheapest → most expensive) · Axis: €/MWh shared</span>
      ${baseline ? `<span style="margin-left:6px"><span style="display:inline-block;width:3px;height:10px;background:#FBBF24;vertical-align:middle;margin-right:4px"></span>Baseline: ${baseline}</span>` : ''}
    </div>`;

  heatmap.innerHTML = `<div style="padding:8px">${svg}${legendHtml}</div>`;
}


// ── HMZ · Spread · dispatch on HMZ.spreadMode ──────────────────────────
// 'vsRef'   → temporal Δ vs baseline (zone − baseline.avg over time)
// 'vsPeers' → scatter BESS-hotspot: x=Peak-OffPeak avg, y=Intraday spread avg
function _hmzRenderSpread(perZone, selected, baseline) {
  const mode = HMZ.spreadMode || 'vsRef';
  if (mode === 'vsPeers') {
    return _hmzRenderSpreadVsPeers(perZone, selected);
  }
  return _hmzRenderSpreadVsRef(perZone, selected, baseline);
}

// ── HMZ · Spread vs Ref · time-series of (zone − baseline) ─────────────
// Aligned with DA Cross-zone Spread semantically: one line per zone showing
// its delta vs the baseline through time. Zero line is the baseline.
function _hmzRenderSpreadVsRef(perZone, selected, baseline) {
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = '';
  if (heatmap) heatmap.style.display = 'none';

  // Build baseline lookup: date → avg
  const baseSeries = perZone[baseline] || [];
  const baseMap = {};
  baseSeries.forEach(d => { if (d.avg != null) baseMap[d.d] = d.avg; });

  // Union of dates across selected zones
  const dateSet = new Set();
  selected.forEach(z => (perZone[z] || []).forEach(d => { if (d.avg != null) dateSet.add(d.d); }));
  const labels = Array.from(dateSet).sort();

  if (!labels.length) {
    if (canvas) canvas.style.display = 'none';
    if (heatmap) {
      heatmap.style.display = 'block';
      heatmap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:11px">No data</div>';
    }
    return;
  }

  // Datasets: one per non-baseline zone. The baseline itself appears as the zero line.
  const datasets = selected
    .filter(z => z !== baseline)
    .map(z => {
      const map = {};
      (perZone[z] || []).forEach(d => { if (d.avg != null) map[d.d] = d.avg; });
      return {
        label: z,
        data: labels.map(l => {
          const v = map[l];
          const b = baseMap[l];
          return (v != null && b != null) ? (v - b) : null;
        }),
        borderColor: zoneColor(z),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: zoneColor(z),
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        tension: 0,
        spanGaps: true,
        fill: false,
      };
    });

  mkHistChart('hmz-canvas', {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('Δ vs ' + baseline + ' (€/MWh)'),
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, padding: 10 },
          // Shared focus-on-click behaviour (DA Cross-zone Lines / HMZ Lines parity)
          onClick: (e, item, legend) => {
            if (typeof window.pkLegendFocusClick === 'function') {
              window.pkLegendFocusClick(e, item, legend);
            }
          },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              if (v == null) return ` ${ctx.dataset.label}: n/a`;
              const sign = v >= 0 ? '+' : '';
              return ` ${ctx.dataset.label}: ${sign}${v.toFixed(2)} €/MWh vs ${baseline}`;
            },
          },
        },
        annotation: {
          annotations: {
            zero: {
              type: 'line', yMin: 0, yMax: 0,
              borderColor: 'rgba(251,191,36,.55)', borderWidth: 1.2, borderDash: [4, 4],
              label: { display: true, content: baseline + ' = 0', position: 'start', color: '#FBBF24', backgroundColor: 'transparent', font: { size: 9, weight: 'bold' } },
            },
          },
        },
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 9 }, maxTicksLimit: 12 } },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 }, callback: v => (v >= 0 ? '+' : '') + v.toFixed(0) },
          title: { display: true, text: 'Δ vs ' + baseline + ' (€/MWh)', color: _HIST_TX3, font: { size: 9 } },
          grace: '12%',
        },
      },
    },
  });
}

// ── HMZ · Spread vs Peers · scatter: P-OP avg (X) vs Intraday spread (Y) ──
// Quadrant top-right = BESS hotspot (high peak-off-peak + high intraday volatility).
// One dot per zone, sized for legibility; labels rendered next to each dot.
function _hmzRenderSpreadVsPeers(perZone, selected) {
  const canvas = document.getElementById('hmz-canvas');
  const heatmap = document.getElementById('hmz-heatmap');
  if (canvas) canvas.style.display = '';
  if (heatmap) heatmap.style.display = 'none';

  // Compute one (x,y) per zone
  const points = [];
  selected.forEach(z => {
    const pop = (perZone[z] || []).filter(d => d.peakAvg != null && d.offAvg != null);
    const sp = pop.length ? pop.reduce((a, d) => a + (d.peakAvg - d.offAvg), 0) / pop.length : null;
    const intra = (perZone[z] || []).filter(d => d.max != null && d.min != null);
    const sd = intra.length ? intra.reduce((a, d) => a + (d.max - d.min), 0) / intra.length : null;
    if (sp != null && sd != null) {
      points.push({ zone: z, x: sp, y: sd });
    }
  });

  if (!points.length) {
    if (canvas) canvas.style.display = 'none';
    if (heatmap) {
      heatmap.style.display = 'block';
      heatmap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:11px">No data</div>';
    }
    return;
  }

  // Compute medians for quadrant cutoffs
  const xs = points.map(p => p.x).sort((a, b) => a - b);
  const ys = points.map(p => p.y).sort((a, b) => a - b);
  const xMed = _percentile(xs, 0.5);
  const yMed = _percentile(ys, 0.5);
  const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.10 || 5;
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.10 || 5;
  const xMin = Math.min(...xs) - xPad;
  const xMax = Math.max(...xs) + xPad;
  const yMin = Math.max(0, Math.min(...ys) - yPad);
  const yMax = Math.max(...ys) + yPad;

  // One dataset per zone for distinct colours + legend entries
  const datasets = points.map(p => ({
    label: p.zone,
    data: [{ x: p.x, y: p.y }],
    backgroundColor: zoneColor(p.zone),
    borderColor: '#fff',
    borderWidth: 1.5,
    pointRadius: 9,
    pointHoverRadius: 12,
    pointStyle: 'circle',
    showLine: false,
  }));

  // Plugin to draw zone code labels next to each dot
  const labelsPlugin = {
    id: 'hmzScatterLabels',
    afterDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      if (!scales.x || !scales.y) return;
      ctx.save();
      ctx.font = "600 10px 'JetBrains Mono', monospace";
      ctx.textBaseline = 'middle';
      points.forEach(p => {
        const xPx = scales.x.getPixelForValue(p.x);
        const yPx = scales.y.getPixelForValue(p.y);
        // Place label slightly right and up so it doesn't overlap the dot
        ctx.fillStyle = zoneColor(p.zone);
        ctx.textAlign = 'left';
        ctx.fillText(p.zone, xPx + 12, yPx - 2);
      });
      ctx.restore();
    },
  };

  mkHistChart('hmz-canvas', {
    type: 'scatter',
    data: { datasets },
    options: {
      ...baseOptions('Intraday spread (€/MWh)'),
      plugins: {
        legend: {
          display: true, position: 'bottom',
          labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 10, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label} · P-OP: ${ctx.parsed.x.toFixed(1)} €/MWh · Intraday: ${ctx.parsed.y.toFixed(1)} €/MWh`,
          },
        },
        subtitle: {
          display: true,
          text: 'X = Peak−OffPeak spread · Y = Intraday range (max−min) · Top-right quadrant = BESS hotspot',
          color: _HIST_TX3, font: { size: 10 }, padding: { bottom: 8 },
        },
        annotation: {
          annotations: {
            xMed: { type: 'line', xMin: xMed, xMax: xMed, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderDash: [4, 4] },
            yMed: { type: 'line', yMin: yMed, yMax: yMed, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderDash: [4, 4] },
            hotspot: {
              type: 'box',
              xMin: xMed, xMax: xMax, yMin: yMed, yMax: yMax,
              backgroundColor: 'rgba(20,211,169,0.06)',
              borderColor: 'rgba(20,211,169,0.25)', borderWidth: 1,
              label: {
                display: true, content: '⚡ BESS hotspot',
                position: { x: 'end', y: 'start' },
                color: '#14D3A9', backgroundColor: 'transparent',
                font: { size: 10, weight: 'bold' },
              },
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear', min: xMin, max: xMax,
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          title: { display: true, text: 'Peak − OffPeak spread (€/MWh)', color: _HIST_TX3, font: { size: 10 } },
        },
        y: {
          min: yMin, max: yMax,
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          title: { display: true, text: 'Intraday spread (€/MWh)', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    },
    plugins: [labelsPlugin],
  });
}




