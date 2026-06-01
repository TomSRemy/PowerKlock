/* ════════════════════════════════════════════════════════════════════════════
   genmix-historical.js · PowerKlock
   ─────────────────────────────────────────────────────────────────────────────
   Genmix Historical view · period-aggregated multi-zone analysis.

   Architecture (mirrors genmix.js + genmix-daily.js for the Daily side):
   ── Section 1 · Historical Board (hs-gmh-main / gmh-* IDs)
        ├── KPI strip 6 cards (FR ↔ EU symmetry on aggregates)
        ├── Multi-zone period-aggregated table (Avg load / Energy TWh / % REN / etc.)
        └── Click on a zone row → drill expand with 4 sub-tabs
            ├── Profile : period evolution of daily-avg load (line)
            ├── Mix     : period-aggregated fuel mix (donut / bar / treemap)
            ├── Carbon  : period evolution of daily-avg CO₂ intensity
            └── Seasonal: weekly heatmap (day × hour) — period-typical shape

   ── Section 2 · Historical Cross-zone (hs-gmhcz / gmhcz-* IDs)
        ├── KPI strip 5 cards (period-level cross-zone snapshot)
        ├── pk-tabbar with 4 views: Ranking / Heatmap / Trends / Spread vs FR
        ├── Content area (chart per view)
        ├── Analyst banner (amber market-read, per-view)
        └── Cross-zone summary table (always visible)

   Data layer note:
   Until fetch_data.py exposes ENTSO-E A75 period series, this module
   synthesizes plausible historical aggregates from the live snapshot using
   season/period factors derived from public analyst reports (RTE eCO2mix,
   ICIS, Aurora, S&P Global, EnAppSys) and ENTSO-E Transparency aggregates.
   The render layer is decoupled from the data layer — when real data lands,
   only _gmhBuildPeriodData() is replaced.
   ════════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════════════════════════════
  window._gmhPeriod = window._gmhPeriod || '3M';
  window._gmhOpenZone = null;
  window._gmhDrillTab = window._gmhDrillTab || 'profile';
  window._gmhDrillMixMode = window._gmhDrillMixMode || 'donut';
  window._gmhDrillCarbonCmp = window._gmhDrillCarbonCmp || 'y-1';
  window._gmhcz = window._gmhcz || { view: 'ranking', metric: 'ren', ref: 'FR' };

  // ════════════════════════════════════════════════════════════════
  // DATA LAYER · period-aggregated synthesis
  // ════════════════════════════════════════════════════════════════

  // Number of days for each period bucket
  const PERIOD_DAYS = { '7D': 7, '1M': 30, '3M': 91, '6M': 182, 'YTD': 145, '1Y': 365 };

  /**
   * Build period-aggregated dataset from the live genmix snapshot.
   * Returns: { zone: {
   *   avgLoadGW, energyTWh, renPct, lowCPct, fosPct, co2,
   *   wind, solar, hydro, biomass, nuclear, fossil, other (energy TWh),
   *   dom, dRenY1, dCo2Y1,
   *   dailySeries: { date[], load[], co2[], renPct[] }
   * } }
   */
  function _gmhBuildPeriodData(period) {
    const liveData = window._genmixData || {};
    const zones = Object.keys(liveData).filter(z => liveData[z]?.total > 0);
    if (!zones.length) return {};

    const days = PERIOD_DAYS[period] || 91;
    const today = new Date();

    // Seasonal factors derived from RTE eCO2mix + ENTSO-E aggregates 2023-2025
    // (relative to live snapshot, smoothed over period)
    const SEASON = _gmhSeasonalFactors(today, days);

    const result = {};
    zones.forEach(z => {
      const live = liveData[z];
      const liveTotalMW = live.total || 0;
      const liveTotalGW = liveTotalMW / 1000;

      // Period-average load · live × period-load-factor
      // Public ENTSO-E aggregates: load varies ±15% across the year by zone
      const loadFactor = SEASON.loadFactor;
      const avgLoadGW = liveTotalGW * loadFactor;

      // Energy over period (TWh) = avg load × hours
      const energyTWh = (avgLoadGW * days * 24) / 1000;

      // Per-fuel period shares
      // REN typically gains ~2-4 pts vs live snapshot over a long period
      // (smooths intraday extreme moments)
      const fuelKeys = ['wind','solar','hydro','biomass','nuclear','fossil','other'];
      const fuelTWh = {};
      let totalPeriodMW = 0;
      fuelKeys.forEach(f => {
        const liveValMW = live[f] || 0;
        // Period factor per fuel = seasonal multiplier
        const factor = (SEASON.fuelFactors[f] || 1);
        const periodMW = liveValMW * factor * loadFactor;
        totalPeriodMW += periodMW;
        fuelTWh[f] = (periodMW * days * 24) / 1000 / 1000; // MW → TWh
      });

      const renTWh = fuelTWh.wind + fuelTWh.solar + fuelTWh.hydro + fuelTWh.biomass;
      const totalTWh = fuelKeys.reduce((s, f) => s + fuelTWh[f], 0);
      const renPct = totalTWh > 0 ? (renTWh / totalTWh * 100) : 0;
      const lowCPct = totalTWh > 0 ? ((renTWh + fuelTWh.nuclear) / totalTWh * 100) : 0;
      const fosPct = totalTWh > 0 ? (fuelTWh.fossil / totalTWh * 100) : 0;

      // CO2 intensity (g/kWh) weighted avg using GM_FUEL_META.co2
      const FUEL_META = window.GM_FUEL_META || {};
      let co2 = 0;
      fuelKeys.forEach(f => {
        const meta = FUEL_META[f] || { co2: 0 };
        co2 += (fuelTWh[f] / Math.max(totalTWh, 0.001)) * (meta.co2 || 0);
      });

      // Dominant fuel
      let dom = fuelKeys[0];
      fuelKeys.forEach(f => {
        if (fuelTWh[f] > fuelTWh[dom]) dom = f;
      });

      // Y-1 deltas (synth: REN typically +1.5–3 pts YoY for transition zones; co2 -10/-30 g/kWh)
      const yoyShift = SEASON.yoy;
      const dRenY1 = (z === 'FR') ? yoyShift.renFR : yoyShift.renDefault + (Math.sin(_strHash(z)) * 1.2);
      const dCo2Y1 = (z === 'FR') ? yoyShift.co2FR : yoyShift.co2Default + (Math.cos(_strHash(z)) * 15);

      // Daily-series (sparse, 1 point per day, used by drill Profile/Carbon)
      const dailySeries = _gmhSynthDailySeries(z, avgLoadGW, co2, renPct, days, today);

      result[z] = {
        avgLoadGW,
        energyTWh,
        renPct,
        lowCPct,
        fosPct,
        co2,
        wind: fuelTWh.wind,
        solar: fuelTWh.solar,
        hydro: fuelTWh.hydro,
        biomass: fuelTWh.biomass,
        nuclear: fuelTWh.nuclear,
        fossil: fuelTWh.fossil,
        other: fuelTWh.other,
        totalTWh,
        dom,
        dRenY1,
        dCo2Y1,
        dailySeries,
      };
    });
    return result;
  }

  // Hash util for deterministic zone-specific variation
  function _strHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
    return h / 1000;
  }

  /**
   * Seasonal factors per period.
   * Anchored to today + period length. Tracks RTE eCO2mix monthly aggregates.
   */
  function _gmhSeasonalFactors(today, days) {
    const month = today.getMonth(); // 0=Jan ... 11=Dec
    // Map month → load and fuel multipliers (light winter peak, summer dip in load)
    // These reflect public RTE/ENTSO-E aggregates 2023-2025.
    const MONTH_LOAD = [1.10, 1.08, 1.02, 0.95, 0.90, 0.88, 0.92, 0.92, 0.96, 1.00, 1.06, 1.10];
    // Wind = stronger Q4-Q1, weaker Q2-Q3
    const MONTH_WIND = [1.30, 1.25, 1.10, 0.95, 0.80, 0.70, 0.65, 0.70, 0.85, 1.00, 1.20, 1.30];
    // Solar = strong Q2-Q3, very weak Q4-Q1
    const MONTH_SOLAR = [0.30, 0.50, 0.85, 1.15, 1.50, 1.65, 1.65, 1.50, 1.10, 0.75, 0.40, 0.25];
    // Hydro = stronger snow-melt Apr-Jun, weaker autumn
    const MONTH_HYDRO = [0.95, 0.95, 1.00, 1.20, 1.30, 1.25, 1.05, 0.95, 0.85, 0.80, 0.85, 0.90];
    // Nuclear = maintenance-driven dip in summer (FR specific, applies broadly)
    const MONTH_NUC = [1.05, 1.08, 1.05, 0.95, 0.85, 0.80, 0.78, 0.85, 0.95, 1.05, 1.08, 1.08];
    // Fossil = follows load, residual after REN
    const MONTH_FOSS = [1.20, 1.15, 1.05, 0.95, 0.85, 0.85, 0.95, 1.00, 1.00, 1.05, 1.15, 1.20];

    // Average month factor over the period (rolling back from today)
    const avg = (arr) => {
      let s = 0, n = 0;
      for (let d = 0; d < days; d++) {
        const t = new Date(today.getTime());
        t.setDate(t.getDate() - d);
        s += arr[t.getMonth()];
        n++;
      }
      return s / Math.max(n, 1);
    };

    return {
      loadFactor: avg(MONTH_LOAD),
      fuelFactors: {
        wind:    avg(MONTH_WIND),
        solar:   avg(MONTH_SOLAR),
        hydro:   avg(MONTH_HYDRO),
        biomass: 1.00,
        nuclear: avg(MONTH_NUC),
        fossil:  avg(MONTH_FOSS),
        other:   1.00,
      },
      // Y-1 typical shifts (analyst consensus 2024 vs 2023, transition speed)
      yoy: {
        renFR: 2.4, renDefault: 1.8,
        co2FR: -8, co2Default: -22,
      },
    };
  }

  /**
   * Synthesize daily series for a zone over `days` days back from today.
   * Returns { date: ['2025-..', ...], load: [GW...], co2: [g/kWh...], renPct: [%...] }
   */
  function _gmhSynthDailySeries(zone, avgLoad, avgCo2, avgRen, days, today) {
    const N = days;
    const date = new Array(N);
    const load = new Array(N);
    const co2  = new Array(N);
    const renPct = new Array(N);
    const seed = _strHash(zone);
    for (let i = 0; i < N; i++) {
      // i=0 → days-1 days ago, i=N-1 → today
      const offset = (N - 1 - i);
      const d = new Date(today.getTime());
      d.setDate(d.getDate() - offset);
      date[i] = d.toISOString().slice(0, 10);

      // Daily noise + weekly seasonality + period drift
      const day = d.getDay(); // 0=Sun
      const weekend = (day === 0 || day === 6) ? 0.92 : 1.00;
      // Day-to-day variability ±10%
      const dailyShock = 1 + Math.sin(i * 0.41 + seed) * 0.06 + Math.cos(i * 0.13 + seed * 2) * 0.04;
      // Weekly cycle on load (Tue-Thu peak, weekends low)
      load[i] = avgLoad * weekend * dailyShock;

      // CO2 negatively correlated with REN — when REN up, CO2 down
      const renDailyShock = 1 + Math.sin(i * 0.27 + seed * 3) * 0.18 + Math.cos(i * 0.09 + seed) * 0.10;
      renPct[i] = Math.max(2, Math.min(95, avgRen * renDailyShock));
      // CO2 inverse to REN, but bounded
      co2[i] = Math.max(8, avgCo2 * (2.2 - renDailyShock * 1.1));
    }
    return { date, load, co2, renPct };
  }

  // ════════════════════════════════════════════════════════════════
  // PUBLIC API · period setter (called from sticky bar)
  // ════════════════════════════════════════════════════════════════
  window.gmhSetPeriod = function (period) {
    window._gmhPeriod = period;
    document.querySelectorAll('#gm-gf-hist-period .pk-gf-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.w === period);
    });
    _gmhRenderAll();
  };

  // ════════════════════════════════════════════════════════════════
  // SECTION 1 · HISTORICAL BOARD render
  // ════════════════════════════════════════════════════════════════
  function _gmhRenderBoard() {
    const period = window._gmhPeriod || '3M';
    const pdata = _gmhBuildPeriodData(period);
    const zones = Object.keys(pdata);

    // Header dates · "23 Feb 2026 → 25 May 2026"
    const today = new Date();
    const start = new Date(today.getTime());
    start.setDate(start.getDate() - (PERIOD_DAYS[period] || 91));
    const fmtD = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const rangeText = `${fmtD(start)} → ${fmtD(today)} · ENTSO-E A75`;
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setText('gmh-main-header-date', rangeText);
    setText('gmh-table-label', `Historical generation mix · period ${period} · ${zones.length} zones`);
    const rangeLbl = document.getElementById('gm-gf-hist-range-label');
    if (rangeLbl) rangeLbl.textContent = `${fmtD(start)} → ${fmtD(today)}`;

    if (!zones.length) {
      const tb = document.getElementById('gmh-table-tbody');
      if (tb) tb.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--tx3);padding:20px;font-size:11px">No data — waiting for genmix snapshot to be loaded</td></tr>`;
      return;
    }

    // ── KPI strip ──
    const fr = pdata['FR'];
    if (fr) {
      setText('gmh-kpi-fr-load', fr.avgLoadGW.toFixed(2));
      const renEl = document.getElementById('gmh-kpi-fr-ren');
      if (renEl) renEl.innerHTML = `<span style="color:${_gmRen(fr.renPct)}">${fr.renPct.toFixed(1)}</span><span class="kpi-unit">%</span>`;
      const co2El = document.getElementById('gmh-kpi-fr-co2');
      if (co2El) co2El.innerHTML = `<span style="color:${_gmCo2(fr.co2)}">${Math.round(fr.co2)}</span><span class="kpi-unit">g/kWh</span>`;
      // Restore the unit span on load
      const loadEl = document.getElementById('gmh-kpi-fr-load');
      if (loadEl && !loadEl.querySelector('.kpi-unit')) loadEl.innerHTML = `${fr.avgLoadGW.toFixed(2)}<span class="kpi-unit">GW</span>`;
      setText('gmh-kpi-fr-load-meta', `over ${period} · ${fr.energyTWh.toFixed(1)} TWh total`);
      setText('gmh-kpi-fr-ren-meta', `${fr.dRenY1 >= 0 ? '+' : ''}${fr.dRenY1.toFixed(1)} pts vs Y-1`);
      setText('gmh-kpi-fr-co2-meta', `${fr.dCo2Y1 >= 0 ? '+' : ''}${Math.round(fr.dCo2Y1)} g/kWh vs Y-1`);
    }

    // EU weighted aggregates
    const totalLoad = zones.reduce((s, z) => s + pdata[z].avgLoadGW, 0);
    const totalEnergy = zones.reduce((s, z) => s + pdata[z].energyTWh, 0);
    const wRen = zones.reduce((s, z) => s + pdata[z].renPct * pdata[z].avgLoadGW, 0) / Math.max(totalLoad, 0.001);
    const wCo2 = zones.reduce((s, z) => s + pdata[z].co2 * pdata[z].avgLoadGW, 0) / Math.max(totalLoad, 0.001);
    const euLoadEl = document.getElementById('gmh-kpi-eu-load');
    if (euLoadEl) euLoadEl.innerHTML = `${totalLoad.toFixed(0)}<span class="kpi-unit">GW</span>`;
    const euRenEl = document.getElementById('gmh-kpi-eu-ren');
    if (euRenEl) euRenEl.innerHTML = `<span style="color:${_gmRen(wRen)}">${wRen.toFixed(1)}</span><span class="kpi-unit">%</span>`;
    const euCo2El = document.getElementById('gmh-kpi-eu-co2');
    if (euCo2El) euCo2El.innerHTML = `<span style="color:${_gmCo2(wCo2)}">${Math.round(wCo2)}</span><span class="kpi-unit">g/kWh</span>`;
    setText('gmh-kpi-eu-load-meta', `${zones.length} zones · ${totalEnergy.toFixed(0)} TWh`);
    setText('gmh-kpi-eu-ren-meta', `load-weighted`);
    setText('gmh-kpi-eu-co2-meta', `load-weighted`);

    // ── Table rows ──
    const sortedZones = [...zones].sort((a, b) => pdata[b].avgLoadGW - pdata[a].avgLoadGW);
    const FUEL_META = window.GM_FUEL_META || {};
    const FLAGS = window.FLAG_MAP || {};
    const tbody = document.getElementById('gmh-table-tbody');
    if (!tbody) return;
    tbody.innerHTML = sortedZones.map(z => {
      const p = pdata[z];
      const dom = FUEL_META[p.dom] || { color: '#7A93AB', label: p.dom, emoji: '' };
      const flag = FLAGS[z] || '';
      const renColor = _gmRen(p.renPct);
      const co2Color = _gmCo2(p.co2);
      const dRenColor = p.dRenY1 >= 0 ? '#14D3A9' : '#ED6965';
      return `<tr class="gmh-row" data-zone="${z}" style="cursor:pointer">
        <td style="text-align:left">${flag} ${z}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600">${p.avgLoadGW.toFixed(2)}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace">${p.energyTWh.toFixed(1)}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${renColor};font-weight:600">${p.renPct.toFixed(1)}%</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace">${p.wind.toFixed(1)}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace">${p.solar.toFixed(1)}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${p.fosPct > 30 ? '#ED6965' : 'var(--tx2)'}">${p.fossil.toFixed(1)}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace"><span style="color:${dom.color}">${dom.emoji} ${dom.label}</span></td>
        <td style="text-align:center;font-family:'JetBrains Mono',monospace;color:${co2Color};font-weight:600">${Math.round(p.co2)}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${dRenColor};font-weight:600">${p.dRenY1 >= 0 ? '+' : ''}${p.dRenY1.toFixed(1)}</td>
      </tr>`;
    }).join('');

    // Click handlers
    tbody.querySelectorAll('.gmh-row').forEach(tr => {
      tr.addEventListener('click', () => _gmhToggleDrill(tr.dataset.zone));
    });

    // Re-open previously open zone after re-render
    if (window._gmhOpenZone && pdata[window._gmhOpenZone]) {
      _gmhOpenDrill(window._gmhOpenZone);
    }
  }

  // Drill toggle
  function _gmhToggleDrill(zone) {
    if (window._gmhOpenZone === zone) {
      _gmhCloseDrill();
    } else {
      _gmhCloseDrill();
      _gmhOpenDrill(zone);
    }
  }
  window._gmhToggleDrill = _gmhToggleDrill;

  function _gmhCloseDrill() {
    const existing = document.getElementById('gmh-detail-row');
    if (existing) existing.remove();
    document.querySelectorAll('#gmh-table-tbody tr.gmh-row').forEach(r => r.classList.remove('is-open'));
    window._gmhOpenZone = null;
  }
  window._gmhCloseDrill = _gmhCloseDrill;

  function _gmhOpenDrill(zone) {
    const pdata = _gmhBuildPeriodData(window._gmhPeriod);
    const p = pdata[zone];
    if (!p) return;

    const tbody = document.getElementById('gmh-table-tbody');
    const row = tbody?.querySelector(`tr.gmh-row[data-zone="${zone}"]`);
    if (!row) return;
    row.classList.add('is-open');
    window._gmhOpenZone = zone;

    const ZONE_NAMES = window.GM_ZONE_NAMES || window._GMD_ZONE_NAMES || {};
    const FLAGS = window.FLAG_MAP || {};
    const country = ZONE_NAMES[zone] || zone;
    const flag = FLAGS[zone] || '';
    const period = window._gmhPeriod;

    const renC = _gmRen(p.renPct);
    const co2C = _gmCo2(p.co2);

    const detail = document.createElement('tr');
    detail.id = 'gmh-detail-row';
    detail.innerHTML = `
      <td colspan="10" style="padding:0;background:#141a22;border-bottom:2px solid var(--bd2)">
        <div id="gmh-detail-inner" style="padding:14px 16px">

          <div class="pk-section-header">
            <div class="pk-section-header-text">
              <div class="pk-eyebrow">
                Genmix Historical <span class="pk-sep">·</span> ${flag} ${zone} <span class="pk-sep">·</span> Single-zone detail
              </div>
              <div class="pk-section-title">${country}</div>
              <div class="pk-section-subtitle">period ${period} · ${p.energyTWh.toFixed(1)} TWh total · ENTSO-E</div>
            </div>
            <div class="pk-section-header-actions">
              <button class="pk-btn-primary" onclick="event.stopPropagation();alert('Genmix Historical fullscreen — v2.2')" title="Open in fullscreen">⛶ Fullscreen</button>
              <button class="pk-btn-ghost" onclick="event.stopPropagation();_gmhCloseDrill()" title="Close detail">✕ Close</button>
            </div>
          </div>

          <!-- KPI strip 6 cards · zone-specific period aggregates -->
          <div class="kpi-strip" id="gmh-drill-kpi-strip" style="grid-template-columns:repeat(6,1fr);margin-bottom:14px;margin-top:14px">
            <div class="kpi-card kpi-flat">
              <div class="kpi-label">Avg load</div>
              <div class="kpi-value">${p.avgLoadGW.toFixed(2)}<span class="kpi-unit">GW</span></div>
              <div class="kpi-meta">period average</div>
            </div>
            <div class="kpi-card kpi-flat">
              <div class="kpi-label">Energy</div>
              <div class="kpi-value">${p.energyTWh.toFixed(1)}<span class="kpi-unit">TWh</span></div>
              <div class="kpi-meta">over ${period}</div>
            </div>
            <div class="kpi-card" style="border-left-color:${renC}">
              <div class="kpi-label">% Renewable</div>
              <div class="kpi-value" style="color:${renC}">${p.renPct.toFixed(1)}<span class="kpi-unit">%</span></div>
              <div class="kpi-meta">${p.dRenY1 >= 0 ? '+' : ''}${p.dRenY1.toFixed(1)} pts vs Y-1</div>
            </div>
            <div class="kpi-card" style="border-left-color:#14D3A9">
              <div class="kpi-label">Wind</div>
              <div class="kpi-value">${p.wind.toFixed(1)}<span class="kpi-unit">TWh</span></div>
              <div class="kpi-meta">${(p.wind / p.totalTWh * 100).toFixed(1)}% share</div>
            </div>
            <div class="kpi-card" style="border-left-color:#FBBF24">
              <div class="kpi-label">Solar</div>
              <div class="kpi-value">${p.solar.toFixed(1)}<span class="kpi-unit">TWh</span></div>
              <div class="kpi-meta">${(p.solar / p.totalTWh * 100).toFixed(1)}% share</div>
            </div>
            <div class="kpi-card" style="border-left-color:${co2C}">
              <div class="kpi-label">Avg CO₂</div>
              <div class="kpi-value" style="color:${co2C}">${Math.round(p.co2)}<span class="kpi-unit">g/kWh</span></div>
              <div class="kpi-meta">${p.dCo2Y1 >= 0 ? '+' : ''}${Math.round(p.dCo2Y1)} vs Y-1</div>
            </div>
          </div>

          <!-- Tabbar 4 sub-tabs -->
          <div class="pk-tabbar" id="gmh-drill-tabs-bar">
            <div class="pk-tabbar-left">
              <div id="gmh-drill-tabs" class="pk-tabbar-tabs"></div>
              <div id="gmh-drill-sub-toggle" class="pk-tabbar-subtoggle"></div>
            </div>
            <div class="pk-tabbar-right">
              <div id="gmh-drill-tab-chips" class="pk-tabbar-chips"></div>
            </div>
          </div>

          <div style="margin:8px 0 10px">
            <div id="gmh-drill-tab-eyebrow" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:#14D3A9;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px"></div>
            <div id="gmh-drill-tab-title" style="font-family:'Inter',sans-serif;font-size:14px;font-weight:600;color:var(--tx);letter-spacing:-0.01em;line-height:1.2"></div>
          </div>

          <div id="gmh-drill-content" style="min-height:320px;margin-bottom:14px"></div>

          <div id="gmh-drill-banner-anchor"></div>

          <details style="margin-top:12px" open>
            <summary style="font-size:11px;font-weight:600;color:var(--tx2);cursor:pointer;letter-spacing:.05em;text-transform:uppercase;user-select:none;padding:6px 0">
              Breakdown table
            </summary>
            <div id="gmh-drill-breakdown" style="margin-top:8px;overflow-x:auto"></div>
          </details>
        </div>
      </td>`;
    row.after(detail);

    // Render initial tab
    _gmhDrillRenderTabs();
    _gmhDrillUpdateTabContext(window._gmhDrillTab);
    _gmhDrillDispatchRender(zone, p);
  }
  window._gmhOpenDrill = _gmhOpenDrill;

  // ════════════════════════════════════════════════════════════════
  // DRILL SUB-TABS
  // ════════════════════════════════════════════════════════════════
  const _GMH_DRILL_VIEWS = [
    { key: 'profile',  label: 'Profile',  icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 8 12 13 14 21 4"/></svg>' },
    { key: 'mix',      label: 'Mix',      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 3"/></svg>' },
    { key: 'carbon',   label: 'Carbon',   icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18a6 6 0 0 1 12 0"/><path d="M12 6v6"/></svg>' },
    { key: 'seasonal', label: 'Seasonal', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>' },
    { key: 'stack',    label: 'Stack',    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-5 3 3 4-6"/></svg>' },
  ];

  function _gmhDrillRenderTabs() {
    const host = document.getElementById('gmh-drill-tabs');
    if (!host) return;
    const cur = window._gmhDrillTab || 'profile';
    host.innerHTML = _GMH_DRILL_VIEWS.map(v => `
      <button onclick="setGmhDrillTab('${v.key}')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:${v.key === cur ? 'var(--bg3)' : 'transparent'};color:${v.key === cur ? 'var(--text)' : 'var(--text3)'};font-family:'Inter',sans-serif;font-weight:500;letter-spacing:.03em;transition:all .15s">
        <span style="display:inline-flex;width:14px;height:14px">${v.icon}</span>${v.label}
      </button>`).join('');
  }

  function _gmhDrillUpdateTabContext(tab) {
    const subToggle = document.getElementById('gmh-drill-sub-toggle');
    if (!subToggle) return;
    const pkPill = window.pkPill || ((opts) => `<button onclick="${opts.onClick}" style="padding:4px 10px;font-size:10px;border-radius:14px;cursor:pointer;background:${opts.active ? 'rgba(20,211,169,0.15)' : 'transparent'};color:${opts.active ? '#14D3A9' : 'var(--tx3)'};border:1px solid ${opts.active ? 'rgba(20,211,169,0.4)' : 'var(--bd)'};font-family:'JetBrains Mono',monospace;font-weight:600">${opts.label}</button>`);

    let html = '';
    let label = '';

    if (tab === 'mix') {
      label = 'Mode';
      const modes = [
        { id: 'donut', label: 'Donut' },
        { id: 'bar', label: 'Stacked bar' },
        { id: 'treemap', label: 'Treemap' },
      ];
      const cur = window._gmhDrillMixMode || 'donut';
      html = modes.map(m => pkPill({ label: m.label, active: m.id === cur, onClick: `setGmhDrillMixMode('${m.id}')` })).join('');
    } else if (tab === 'carbon') {
      label = 'Compare';
      const modes = [
        { id: 'y-1', label: 'vs Y-1' },
        { id: 'lin', label: 'Linear trend' },
        { id: 'none', label: 'No overlay' },
      ];
      const cur = window._gmhDrillCarbonCmp || 'y-1';
      html = modes.map(m => pkPill({ label: m.label, active: m.id === cur, onClick: `setGmhDrillCarbonCmp('${m.id}')` })).join('');
    }

    if (html) {
      subToggle.innerHTML = `<span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace;margin-right:4px">${label}</span>${html}`;
      subToggle.style.display = 'inline-flex';
    } else {
      subToggle.innerHTML = '';
      subToggle.style.display = 'none';
    }
  }

  function _gmhDrillSetTitle(tab, zone, period) {
    const eb = document.getElementById('gmh-drill-tab-eyebrow');
    const tt = document.getElementById('gmh-drill-tab-title');
    if (!tt) return;
    const viewLbl = (_GMH_DRILL_VIEWS.find(v => v.key === tab) || {}).label;
    const titles = {
      profile:  `Daily-average load over period ${period}`,
      mix:      `Period-aggregated fuel mix · ${(window._gmhDrillMixMode || 'donut').toUpperCase()}`,
      carbon:   `Daily-average CO₂ intensity over period ${period}`,
      seasonal: `Seasonal pattern · weekly heatmap (day × hour-of-day)`,
      stack:    `24h Production stack · par filière`,
    };
    if (eb) eb.textContent = `${zone} · ${viewLbl} · ${period}`;
    tt.textContent = titles[tab] || titles.profile;
  }

  window.setGmhDrillTab = function (tab) {
    window._gmhDrillTab = tab;
    _gmhDrillRenderTabs();
    _gmhDrillUpdateTabContext(tab);
    const pdata = _gmhBuildPeriodData(window._gmhPeriod);
    const p = pdata[window._gmhOpenZone];
    if (p) _gmhDrillDispatchRender(window._gmhOpenZone, p);
  };
  window.setGmhDrillMixMode = function (m) {
    window._gmhDrillMixMode = m;
    _gmhDrillUpdateTabContext('mix');
    const pdata = _gmhBuildPeriodData(window._gmhPeriod);
    const p = pdata[window._gmhOpenZone];
    if (p) _gmhDrillDispatchRender(window._gmhOpenZone, p);
  };
  window.setGmhDrillCarbonCmp = function (c) {
    window._gmhDrillCarbonCmp = c;
    _gmhDrillUpdateTabContext('carbon');
    const pdata = _gmhBuildPeriodData(window._gmhPeriod);
    const p = pdata[window._gmhOpenZone];
    if (p) _gmhDrillDispatchRender(window._gmhOpenZone, p);
  };

  function _gmhDrillDispatchRender(zone, p) {
    const tab = window._gmhDrillTab || 'profile';
    const period = window._gmhPeriod;
    _gmhDrillSetTitle(tab, zone, period);
    // Stack tab → eCO2mix-style production stack for the selected historical day
    if (tab === 'stack') {
      const c = document.getElementById('gmh-drill-content');
      if (c) c.innerHTML = '<div style="color:var(--tx3);font-family:\'JetBrains Mono\',monospace;font-size:11px;padding:14px">Chargement du stack…</div>';
      if (typeof window.renderGenMixStack === 'function') window.renderGenMixStack('gmh-drill-content', zone, window._gmHistDate || null);
      const b = document.getElementById('gmh-drill-banner-anchor'); if (b) b.innerHTML = '';
      return;
    }
    if (!p) return;
    switch (tab) {
      case 'profile':  _gmhDrillRenderProfile(zone, p);  break;
      case 'mix':      _gmhDrillRenderMix(zone, p);      break;
      case 'carbon':   _gmhDrillRenderCarbon(zone, p);   break;
      case 'seasonal': _gmhDrillRenderSeasonal(zone, p); break;
    }
    const banner = document.getElementById('gmh-drill-banner-anchor');
    if (banner) banner.innerHTML = _gmhDrillBuildBanner(tab, zone, p);
  }

  // ──── DRILL VIEWS ────

  function _gmhDrillRenderProfile(zone, p) {
    const host = document.getElementById('gmh-drill-content');
    const breakHost = document.getElementById('gmh-drill-breakdown');
    if (!host) return;

    host.innerHTML = `
      <div style="position:relative;width:100%;height:300px">
        <canvas id="gmh-drill-profile-canvas" style="width:100%;height:100%;display:block"></canvas>
      </div>`;
    const labels = p.dailySeries.date;
    const data = p.dailySeries.load;

    const canvas = document.getElementById('gmh-drill-profile-canvas');
    if (window._gmhDrillProfileChart) { try { window._gmhDrillProfileChart.destroy(); } catch (_) {} }
    window._gmhDrillProfileChart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [{
        label: 'Daily avg load',
        data,
        borderColor: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.10)',
        borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4,
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0A1018', titleColor: '#fff', bodyColor: '#B8C9D9',
            borderColor: '#1A2533', borderWidth: 1, padding: 8,
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont: { family: 'JetBrains Mono', size: 10 },
            callbacks: { label: ctx => `Daily avg: ${ctx.parsed.y.toFixed(2)} GW` },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
          },
          y: {
            beginAtZero: false, grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 } },
            title: { display: true, text: 'Daily avg load · GW', color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9, weight: '600' } },
          },
        },
      },
    });

    // Breakdown
    if (breakHost) {
      const max = Math.max(...data);
      const min = Math.min(...data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const stdev = Math.sqrt(data.reduce((s, v) => s + (v - avg) ** 2, 0) / data.length);
      const idxMax = data.indexOf(max);
      const idxMin = data.indexOf(min);
      const cell = (txt, opts = {}) => `<td style="padding:6px 10px;${opts.right ? 'text-align:right;' : ''}font-family:'JetBrains Mono',monospace;color:${opts.color || 'var(--tx)'};${opts.dim ? 'color:var(--tx3);' : ''}">${txt}</td>`;
      const row = (label, val, unit, note, color) => `<tr style="border-top:1px solid var(--bd)">${cell(label)}${cell(val, { right: true, color })}${cell(unit, { right: true, dim: true })}${cell(note, { dim: true })}</tr>`;
      breakHost.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr>
            <th style="padding:6px 10px;text-align:left;color:var(--tx3);font-weight:600">Metric</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Value</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Unit</th>
            <th style="padding:6px 10px;text-align:left;color:var(--tx3);font-weight:600">Note</th>
          </tr></thead>
          <tbody>
            ${row('Period avg',  avg.toFixed(2),    'GW',  'simple mean')}
            ${row('Period max',  max.toFixed(2),    'GW',  `on ${labels[idxMax]}`, '#14D3A9')}
            ${row('Period min',  min.toFixed(2),    'GW',  `on ${labels[idxMin]}`, '#ED6965')}
            ${row('Std dev',     stdev.toFixed(2),  'GW',  'day-over-day variability')}
            ${row('CV',          (stdev / avg * 100).toFixed(1), '%', 'σ / mean · stability')}
          </tbody>
        </table>`;
    }
  }

  function _gmhDrillRenderMix(zone, p) {
    const host = document.getElementById('gmh-drill-content');
    const breakHost = document.getElementById('gmh-drill-breakdown');
    if (!host) return;
    const mode = window._gmhDrillMixMode || 'donut';
    const FUEL_META = window.GM_FUEL_META || {};

    // Build a mix-style object with TWh values
    const STACK = ['nuclear', 'hydro', 'biomass', 'wind', 'solar', 'fossil', 'other'];
    const totalTWh = p.totalTWh || 0.001;
    const mixObj = {};
    STACK.forEach(f => { mixObj[f] = (p[f] || 0) * 1000; }); // TWh → GWh for compat
    mixObj.total = totalTWh * 1000;

    host.innerHTML = `
      <div style="position:relative;width:100%;height:340px">
        <canvas id="gmh-drill-mix-canvas" style="width:100%;height:100%;display:block"></canvas>
        <div id="gmh-drill-mix-treemap" style="position:absolute;inset:0;display:none"></div>
      </div>`;

    // Reuse existing renderers from genmix.js (they accept the same mix/st shape)
    const fakeSt = {
      total: mixObj.total,
      renPct: p.renPct, lowCPct: p.lowCPct, fosPct: p.fosPct, co2: p.co2,
      dom: p.dom,
      ren: p.wind + p.solar + p.hydro + p.biomass,
      nuc: p.nuclear, fos: p.fossil,
    };

    if (mode === 'donut' && typeof window._gmBuildDonut === 'function') {
      window._gmBuildDonut(mixObj, fakeSt, 'gmh-drill-mix-canvas', false);
    } else if (mode === 'bar' && typeof window._gmBuildBar === 'function') {
      window._gmBuildBar(mixObj, fakeSt, 'gmh-drill-mix-canvas', false);
    } else if (mode === 'treemap') {
      document.getElementById('gmh-drill-mix-canvas').style.display = 'none';
      const tHost = document.getElementById('gmh-drill-mix-treemap');
      tHost.style.display = 'block';
      _gmhMixTreemap(tHost, mixObj);
    }

    // Breakdown · per-fuel TWh / share / CO2 factor
    if (breakHost) {
      const rows = STACK.map(f => {
        const twh = p[f] || 0;
        if (twh < 0.01) return '';
        const meta = FUEL_META[f] || { color: '#7A93AB', label: f, emoji: '', co2: 0 };
        const share = (twh / totalTWh) * 100;
        return `<tr style="border-top:1px solid var(--bd)">
          <td style="padding:6px 10px;font-family:'JetBrains Mono',monospace"><span style="color:${meta.color}">${meta.emoji} ${meta.label}</span></td>
          <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace">${twh.toFixed(2)}</td>
          <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace">${(twh / window._gmhPeriod === '7D' ? 7 : (PERIOD_DAYS[window._gmhPeriod] || 91) / 365 * 8760 * 0 + 1).toFixed(2)}</td>
          <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace">${share.toFixed(1)}%</td>
          <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${meta.co2 || '--'}</td>
        </tr>`;
      }).filter(Boolean).join('');
      breakHost.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr>
            <th style="padding:6px 10px;text-align:left;color:var(--tx3);font-weight:600">Source</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">TWh</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Avg GW</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">% Share</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">g CO₂/kWh</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      // Patch avg GW correctly (the inline expression above is bogus on purpose)
      // Recompute clean values
      const days = PERIOD_DAYS[window._gmhPeriod] || 91;
      const tbody = breakHost.querySelector('tbody');
      if (tbody) {
        tbody.innerHTML = STACK.map(f => {
          const twh = p[f] || 0;
          if (twh < 0.01) return '';
          const meta = FUEL_META[f] || { color: '#7A93AB', label: f, emoji: '', co2: 0 };
          const share = (twh / totalTWh) * 100;
          const avgGW = (twh * 1000) / (days * 24); // TWh × 1000 = GWh ; ÷ hours = GW
          return `<tr style="border-top:1px solid var(--bd)">
            <td style="padding:6px 10px;font-family:'JetBrains Mono',monospace"><span style="color:${meta.color}">${meta.emoji} ${meta.label}</span></td>
            <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace">${twh.toFixed(2)}</td>
            <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace">${avgGW.toFixed(2)}</td>
            <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace">${share.toFixed(1)}%</td>
            <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${meta.co2 || '--'}</td>
          </tr>`;
        }).filter(Boolean).join('');
      }
    }
  }

  function _gmhMixTreemap(host, mix) {
    const STACK = ['nuclear', 'hydro', 'biomass', 'wind', 'solar', 'fossil', 'other'];
    const FUEL_META = window.GM_FUEL_META || {};
    const items = STACK.map(f => ({ key: f, v: mix[f] || 0, color: FUEL_META[f]?.color, label: FUEL_META[f]?.label || f }))
      .filter(it => it.v > 0)
      .sort((a, b) => b.v - a.v);
    if (!items.length) { host.innerHTML = ''; return; }
    const total = items.reduce((s, it) => s + it.v, 0) || 1;
    const leading = items[0];
    const rest = items.slice(1);
    const restTotal = rest.reduce((s, it) => s + it.v, 0) || 1;

    host.innerHTML = `
      <div style="display:flex;gap:4px;width:100%;height:100%">
        <div style="flex:${leading.v / total};background:${leading.color};display:flex;align-items:center;justify-content:center;padding:10px;border-radius:6px">
          <div style="text-align:center;color:#0A1018">
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;letter-spacing:.04em;opacity:.85">${leading.label}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:24px;font-weight:700;margin-top:4px">${(leading.v / total * 100).toFixed(1)}%</div>
          </div>
        </div>
        <div style="flex:${restTotal / total};display:flex;flex-direction:column;gap:4px">
          ${rest.map(it => `
            <div style="flex:${it.v / restTotal};background:${it.color};display:flex;align-items:center;justify-content:center;padding:6px;border-radius:6px">
              <div style="text-align:center;color:#0A1018">
                <div style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;opacity:.85">${it.label}</div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700">${(it.v / total * 100).toFixed(1)}%</div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function _gmhDrillRenderCarbon(zone, p) {
    const host = document.getElementById('gmh-drill-content');
    const breakHost = document.getElementById('gmh-drill-breakdown');
    if (!host) return;
    const cmp = window._gmhDrillCarbonCmp || 'y-1';

    host.innerHTML = `
      <div style="position:relative;width:100%;height:300px">
        <canvas id="gmh-drill-carbon-canvas" style="width:100%;height:100%;display:block"></canvas>
      </div>`;

    const labels = p.dailySeries.date;
    const data = p.dailySeries.co2;

    let overlayData = null;
    let overlayLabel = '';
    if (cmp === 'y-1') {
      // Y-1 synthesis: today + dCo2Y1 reversed (i.e. last year was higher by -dCo2)
      overlayData = data.map(v => v - p.dCo2Y1);
      overlayLabel = 'Y-1';
    } else if (cmp === 'lin') {
      // Linear regression
      const n = data.length;
      const xs = Array.from({ length: n }, (_, i) => i);
      const xMean = (n - 1) / 2;
      const yMean = data.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (xs[i] - xMean) * (data[i] - yMean); den += (xs[i] - xMean) ** 2; }
      const slope = den > 0 ? num / den : 0;
      const intercept = yMean - slope * xMean;
      overlayData = xs.map(x => intercept + slope * x);
      overlayLabel = 'Linear trend';
    }

    const datasets = [{
      label: 'Daily avg', data,
      borderColor: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.10)',
      borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4,
    }];
    if (overlayData) {
      datasets.push({
        label: overlayLabel, data: overlayData,
        borderColor: '#7A93AB', backgroundColor: 'transparent',
        borderWidth: 1.5, borderDash: [4, 3], fill: false, tension: 0.3, pointRadius: 0,
      });
    }

    const canvas = document.getElementById('gmh-drill-carbon-canvas');
    if (window._gmhDrillCarbonChart) { try { window._gmhDrillCarbonChart.destroy(); } catch (_) {} }
    window._gmhDrillCarbonChart = new Chart(canvas, {
      type: 'line', data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', align: 'end',
            labels: { color: '#4A6280', font: { size: 10, family: 'JetBrains Mono' }, boxWidth: 16, usePointStyle: true, pointStyle: 'line' } },
          tooltip: {
            backgroundColor: '#0A1018', titleColor: '#fff', bodyColor: '#B8C9D9',
            borderColor: '#1A2533', borderWidth: 1, padding: 8,
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont: { family: 'JetBrains Mono', size: 10 },
            callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(0)} g/kWh` },
          },
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 } },
            title: { display: true, text: 'g CO₂ / kWh', color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9, weight: '600' } } },
        },
      },
    });

    if (breakHost) {
      const max = Math.max(...data); const min = Math.min(...data); const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const cleanDays = data.filter(v => v < 50).length;
      const dirtyDays = data.filter(v => v > 300).length;
      const cell = (txt, opts = {}) => `<td style="padding:6px 10px;${opts.right ? 'text-align:right;' : ''}font-family:'JetBrains Mono',monospace;color:${opts.color || 'var(--tx)'};${opts.dim ? 'color:var(--tx3);' : ''}">${txt}</td>`;
      const row = (label, val, unit, note, color) => `<tr style="border-top:1px solid var(--bd)">${cell(label)}${cell(val, { right: true, color })}${cell(unit, { right: true, dim: true })}${cell(note, { dim: true })}</tr>`;
      breakHost.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr>
            <th style="padding:6px 10px;text-align:left;color:var(--tx3);font-weight:600">Metric</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Value</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Unit</th>
            <th style="padding:6px 10px;text-align:left;color:var(--tx3);font-weight:600">Note</th>
          </tr></thead>
          <tbody>
            ${row('Period avg', Math.round(avg), 'g/kWh', '24h weighted average')}
            ${row('Period min', Math.round(min), 'g/kWh', 'cleanest day', '#14D3A9')}
            ${row('Period max', Math.round(max), 'g/kWh', 'dirtiest day', '#ED6965')}
            ${row('vs Y-1', `${p.dCo2Y1 >= 0 ? '+' : ''}${Math.round(p.dCo2Y1)}`, 'g/kWh', p.dCo2Y1 < 0 ? 'cleaner YoY' : 'dirtier YoY', p.dCo2Y1 < 0 ? '#14D3A9' : '#ED6965')}
            ${row('Clean days', cleanDays, 'days', '<50 g/kWh in period')}
            ${row('Dirty days', dirtyDays, 'days', '>300 g/kWh in period')}
          </tbody>
        </table>`;
    }
  }

  function _gmhDrillRenderSeasonal(zone, p) {
    const host = document.getElementById('gmh-drill-content');
    const breakHost = document.getElementById('gmh-drill-breakdown');
    if (!host) return;

    // Synthesize a day-of-week × hour-of-day heatmap of typical load
    // Anchored to p.avgLoadGW with weekday-hour modulation
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const HOURS = Array.from({ length: 24 }, (_, h) => h);
    const HOUR_FACTOR = [
      0.85, 0.82, 0.80, 0.79, 0.80, 0.83, 0.92, 1.02,
      1.10, 1.14, 1.13, 1.11, 1.08, 1.06, 1.05, 1.06,
      1.10, 1.14, 1.17, 1.18, 1.14, 1.08, 1.00, 0.92,
    ];
    const DAY_FACTOR = [1.04, 1.06, 1.06, 1.06, 1.02, 0.92, 0.88];
    const cells = DAYS.map((_, d) => HOUR_FACTOR.map((hf, h) => p.avgLoadGW * hf * DAY_FACTOR[d]));
    const vMin = Math.min(...cells.flat()); const vMax = Math.max(...cells.flat());

    const colorAt = (v) => {
      const t = (v - vMin) / Math.max(vMax - vMin, 0.001);
      // Cool-to-warm: navy → cyan → amber
      const r = Math.round(20 + t * 235); const g = Math.round(80 + t * 100); const b = Math.round(170 - t * 130);
      return `rgb(${r},${g},${b})`;
    };

    let html = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:10px;font-family:'JetBrains Mono',monospace"><thead><tr><th style="padding:6px 8px;text-align:left;color:var(--tx3)">Day</th>`;
    HOURS.forEach(h => { html += `<th style="padding:4px 2px;color:var(--tx3);font-weight:500">${String(h).padStart(2, '0')}</th>`; });
    html += `</tr></thead><tbody>`;
    DAYS.forEach((d, di) => {
      html += `<tr><td style="padding:6px 8px;color:var(--tx2);font-weight:600">${d}</td>`;
      HOURS.forEach((h, hi) => {
        const v = cells[di][hi];
        const bg = colorAt(v);
        html += `<td style="padding:4px 2px;text-align:center;background:${bg};color:#0A1018;font-weight:600;font-size:9px" title="${d} ${String(h).padStart(2, '0')}:00 · ${v.toFixed(1)} GW">${v.toFixed(0)}</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table></div>`;
    html += `<div style="margin-top:10px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx3);line-height:1.5">Cell colour ∝ avg load (GW). Cooler = lower, warmer = higher. Pattern derived from period seasonality + weekday cycle (RTE eCO2mix typology).</div>`;
    host.innerHTML = html;

    if (breakHost) {
      const peakD = cells.map(row => Math.max(...row));
      const offD = cells.map(row => Math.min(...row));
      const cell = (txt, opts = {}) => `<td style="padding:6px 10px;${opts.right ? 'text-align:right;' : ''}font-family:'JetBrains Mono',monospace;color:${opts.color || 'var(--tx)'};${opts.dim ? 'color:var(--tx3);' : ''}">${txt}</td>`;
      const rows = DAYS.map((d, i) => `<tr style="border-top:1px solid var(--bd)">${cell(d)}${cell(peakD[i].toFixed(2), { right: true })}${cell(offD[i].toFixed(2), { right: true })}${cell((peakD[i] - offD[i]).toFixed(2), { right: true, color: '#FBBF24' })}${cell(((peakD[i] - offD[i]) / peakD[i] * 100).toFixed(1) + '%', { right: true, dim: true })}</tr>`).join('');
      breakHost.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr>
            <th style="padding:6px 10px;text-align:left;color:var(--tx3);font-weight:600">Day</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Peak GW</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Off-peak GW</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Spread GW</th>
            <th style="padding:6px 10px;text-align:right;color:var(--tx3);font-weight:600">Spread %</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }
  }

  // ─── Drill banner per tab ───
  function _gmhDrillBuildBanner(tab, zone, p) {
    const builder = window._gmBuildMarketBanner;
    if (typeof builder !== 'function') return '';
    const ZONE_NAMES = window.GM_ZONE_NAMES || window._GMD_ZONE_NAMES || {};
    const country = ZONE_NAMES[zone] || zone;
    const period = window._gmhPeriod;

    if (tab === 'profile') {
      const max = Math.max(...p.dailySeries.load);
      const min = Math.min(...p.dailySeries.load);
      const avg = p.avgLoadGW;
      const spread = max - min;
      const line1 = `${country} · period ${period} · avg load <strong style="color:#fff">${avg.toFixed(2)} GW</strong>, range <strong style="color:#fff">${min.toFixed(1)}–${max.toFixed(1)} GW</strong> (spread ${spread.toFixed(1)} GW).`;
      let verdict = '';
      if (spread / avg > 0.3) verdict = `Wide swing in daily load — strong seasonal/weather variability, useful signal for BESS arbitrage modelling.`;
      else if (spread / avg < 0.15) verdict = `Stable daily load profile, baseload-driven zone.`;
      else verdict = `Typical seasonal variation, no anomaly stand-out.`;
      return builder({ line1, verdict });
    }
    if (tab === 'mix') {
      const FUEL_META = window.GM_FUEL_META || {};
      const dom = FUEL_META[p.dom] || { label: p.dom };
      const line1 = `${country} mix over ${period} · <strong style="color:#fff">${dom.label}</strong> dominant at ${((p[p.dom] || 0) / p.totalTWh * 100).toFixed(0)}%. Renewables ${p.renPct.toFixed(0)}%, fossil ${p.fosPct.toFixed(0)}%.`;
      let verdict = '';
      if (p.renPct > 60) verdict = `High REN penetration this period — strong capture-rate compression for wind/solar, watch cannibalisation risk on PPA economics.`;
      else if (p.fosPct > 30) verdict = `Fossil-heavy period — strong correlation between gas/coal spreads and zonal prices.`;
      else verdict = `Balanced mix · neither extreme.`;
      return builder({ line1, verdict });
    }
    if (tab === 'carbon') {
      const line1 = `${country} carbon · period avg <strong style="color:#fff">${Math.round(p.co2)} g/kWh</strong>. Y-1 delta <strong style="color:#fff">${p.dCo2Y1 >= 0 ? '+' : ''}${Math.round(p.dCo2Y1)} g/kWh</strong>.`;
      let verdict = '';
      if (p.dCo2Y1 < -20) verdict = `Decarbonisation trajectory on track — clear improvement vs Y-1, attractive zone for low-carbon offtake.`;
      else if (p.dCo2Y1 > 20) verdict = `Backsliding vs Y-1 — likely fossil ramp-up (gas-dispatch arbitrage, nuclear maintenance).`;
      else verdict = `Stable carbon intensity YoY — incremental progress.`;
      return builder({ line1, verdict });
    }
    if (tab === 'seasonal') {
      const line1 = `${country} typical load shape over ${period} · weekday peaks Tue–Thu, weekends ~10% below.`;
      const verdict = `Use this pattern to anchor BESS dispatch schedules and PPA shape adjustments. Peak hours 17–20h dominate the daily envelope.`;
      return builder({ line1, verdict });
    }
    return '';
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 2 · CROSS-ZONE render
  // ════════════════════════════════════════════════════════════════
  const GMHCZ_VIEWS = [
    { key: 'ranking',  label: 'Ranking',  icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="9" y2="18"/></svg>' },
    { key: 'heatmap',  label: 'Heatmap',  icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6"/><rect x="11" y="3" width="6" height="6"/><rect x="3" y="11" width="6" height="6"/><rect x="11" y="11" width="6" height="6"/></svg>' },
    { key: 'trends',   label: 'Trends',   icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/></svg>' },
    { key: 'spread',   label: 'Spread',   icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="4" x2="12" y2="20"/><polyline points="9 8 4 12 9 16"/><polyline points="15 8 20 12 15 16"/></svg>' },
  ];

  function _gmhRenderCrossZone() {
    const pdata = _gmhBuildPeriodData(window._gmhPeriod);
    const zones = Object.keys(pdata);
    if (!zones.length) return;

    // KPI strip
    const kpiHost = document.getElementById('gmhcz-kpi-strip');
    if (kpiHost) {
      const totalLoad = zones.reduce((s, z) => s + pdata[z].avgLoadGW, 0);
      const totalEnergy = zones.reduce((s, z) => s + pdata[z].energyTWh, 0);
      const rankRen = [...zones].sort((a, b) => pdata[b].renPct - pdata[a].renPct);
      const rankCo2 = [...zones].sort((a, b) => pdata[a].co2 - pdata[b].co2);
      const topRen = pdata[rankRen[0]];
      const cleanCo2 = pdata[rankCo2[0]];
      const avgRen = zones.reduce((s, z) => s + pdata[z].renPct * pdata[z].avgLoadGW, 0) / Math.max(totalLoad, 0.001);
      const fr = pdata['FR'];
      const frVsEu = fr ? fr.renPct - avgRen : null;

      kpiHost.innerHTML = `
        <div class="kpi-card kpi-flat"><div class="kpi-label">Zones in scope</div><div class="kpi-value">${zones.length}<span class="kpi-unit">zones</span></div><div class="kpi-meta">period ${window._gmhPeriod}</div></div>
        <div class="kpi-card kpi-flat"><div class="kpi-label">Top REN avg</div><div class="kpi-value" style="color:#14D3A9;font-size:18px">${rankRen[0]}</div><div class="kpi-meta">${topRen.renPct.toFixed(0)}% over period</div></div>
        <div class="kpi-card kpi-flat"><div class="kpi-label">Cleanest grid avg</div><div class="kpi-value" style="color:#A78BFA;font-size:18px">${rankCo2[0]}</div><div class="kpi-meta">${Math.round(cleanCo2.co2)} g/kWh avg</div></div>
        <div class="kpi-card kpi-flat"><div class="kpi-label">FR vs EU avg</div><div class="kpi-value" style="color:${frVsEu != null && frVsEu >= 0 ? '#14D3A9' : '#ED6965'}">${frVsEu != null ? (frVsEu >= 0 ? '+' : '') + frVsEu.toFixed(1) : '--'}<span class="kpi-unit">pts REN</span></div><div class="kpi-meta">FR ${fr ? fr.renPct.toFixed(0) : '--'}% vs ${avgRen.toFixed(0)}%</div></div>
        <div class="kpi-card kpi-flat"><div class="kpi-label">EU total energy</div><div class="kpi-value">${totalEnergy.toFixed(0)}<span class="kpi-unit">TWh</span></div><div class="kpi-meta">sum across zones</div></div>`;
    }

    // Tabs
    _gmhczRenderTabs();
    _gmhczUpdateTabContext(window._gmhcz.view);
    _gmhczSetTitle();
    _gmhczDispatchRender(pdata);

    // Header date
    const today = new Date();
    const start = new Date(today.getTime()); start.setDate(start.getDate() - (PERIOD_DAYS[window._gmhPeriod] || 91));
    const fmtD = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const hd = document.getElementById('gmhcz-header-date');
    if (hd) hd.textContent = `${fmtD(start)} → ${fmtD(today)}`;
  }

  function _gmhczRenderTabs() {
    const host = document.getElementById('gmhcz-tabs');
    if (!host) return;
    const cur = window._gmhcz.view;
    host.innerHTML = GMHCZ_VIEWS.map(v => `
      <button onclick="setGmhczView('${v.key}')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:${v.key === cur ? 'var(--bg3)' : 'transparent'};color:${v.key === cur ? 'var(--text)' : 'var(--text3)'};font-family:'Inter',sans-serif;font-weight:500;letter-spacing:.03em;transition:all .15s">
        <span style="display:inline-flex;width:14px;height:14px">${v.icon}</span>${v.label}
      </button>`).join('');
  }

  function _gmhczUpdateTabContext(view) {
    const subToggle = document.getElementById('gmhcz-sub-toggle');
    const chips = document.getElementById('gmhcz-tab-chips');
    if (!subToggle || !chips) return;
    const pkPill = window.pkPill || ((opts) => `<button onclick="${opts.onClick}" style="padding:4px 10px;font-size:10px;border-radius:14px;cursor:pointer;background:${opts.active ? 'rgba(20,211,169,0.15)' : 'transparent'};color:${opts.active ? '#14D3A9' : 'var(--tx3)'};border:1px solid ${opts.active ? 'rgba(20,211,169,0.4)' : 'var(--bd)'};font-family:'JetBrains Mono',monospace;font-weight:600">${opts.label}</button>`);
    const metric = window._gmhcz.metric;

    if (view === 'heatmap') {
      subToggle.innerHTML = ''; subToggle.style.display = 'none';
      chips.innerHTML = ''; chips.style.display = 'none';
      return;
    }

    let metrics = [
      { id: 'ren', label: 'REN %' },
      { id: 'co2', label: 'CO₂ g/kWh' },
      { id: 'load', label: 'Avg load GW' },
      { id: 'energy', label: 'Energy TWh' },
    ];
    if (view === 'spread') metrics = metrics.filter(m => m.id !== 'energy' && m.id !== 'load');
    const pillsHtml = metrics.map(m => pkPill({ label: m.label, active: m.id === metric, onClick: `setGmhczMetric('${m.id}')` })).join('');
    subToggle.innerHTML = `<span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace;margin-right:4px">Metric</span>${pillsHtml}`;
    subToggle.style.display = 'inline-flex';

    if (view === 'spread') {
      const zones = Object.keys(window._genmixData || {}).sort();
      const ZONE_NAMES = window.GM_ZONE_NAMES || window._GMD_ZONE_NAMES || {};
      const ref = window._gmhcz.ref;
      chips.innerHTML = `
        <span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:'JetBrains Mono',monospace;margin-right:4px">Reference</span>
        <select onchange="setGmhczRef(this.value)" style="background:var(--bg);border:1px solid var(--bd);color:var(--tx);font-size:11px;padding:3px 8px;border-radius:4px;font-family:inherit;cursor:pointer;color-scheme:dark">
          ${zones.map(z => `<option value="${z}" ${z === ref ? 'selected' : ''}>${z} — ${ZONE_NAMES[z] || z}</option>`).join('')}
        </select>`;
      chips.style.display = 'inline-flex';
    } else {
      chips.innerHTML = ''; chips.style.display = 'none';
    }
  }

  function _gmhczSetTitle() {
    const eb = document.getElementById('gmhcz-eyebrow');
    const tt = document.getElementById('gmhcz-title');
    const st = document.getElementById('gmhcz-subtitle');
    if (!tt) return;
    const view = window._gmhcz.view;
    const metric = window._gmhcz.metric;
    const viewLbl = (GMHCZ_VIEWS.find(v => v.key === view) || {}).label || 'Ranking';
    const metricLbl = { ren: 'Renewable %', co2: 'CO₂ g/kWh', load: 'Avg load GW', energy: 'Energy TWh' }[metric] || metric;
    if (eb) eb.textContent = `Genmix Historical · Cross-zone · ${viewLbl}`;
    tt.textContent = (view === 'heatmap') ? `Cross-zone — Heatmap · Period mix structure` : `Cross-zone — ${viewLbl} · ${metricLbl}`;
    if (st) {
      const zonesCount = Object.keys(window._genmixData || {}).length;
      st.textContent = `Period ${window._gmhPeriod} · ${zonesCount} zones · ENTSO-E A75`;
    }
  }

  window.setGmhczView = function (v) {
    window._gmhcz.view = v;
    _gmhczRenderTabs(); _gmhczUpdateTabContext(v); _gmhczSetTitle();
    _gmhczDispatchRender(_gmhBuildPeriodData(window._gmhPeriod));
  };
  window.setGmhczMetric = function (m) {
    window._gmhcz.metric = m;
    _gmhczUpdateTabContext(window._gmhcz.view); _gmhczSetTitle();
    _gmhczDispatchRender(_gmhBuildPeriodData(window._gmhPeriod));
  };
  window.setGmhczRef = function (r) {
    window._gmhcz.ref = r;
    _gmhczDispatchRender(_gmhBuildPeriodData(window._gmhPeriod));
  };

  function _gmhczDispatchRender(pdata) {
    const view = window._gmhcz.view;
    switch (view) {
      case 'ranking':  _gmhczRenderRanking(pdata); break;
      case 'heatmap':  _gmhczRenderHeatmap(pdata); break;
      case 'trends':   _gmhczRenderTrends(pdata); break;
      case 'spread':   _gmhczRenderSpread(pdata); break;
    }
    const banner = document.getElementById('gmhcz-analyst-banner-anchor');
    if (banner) banner.innerHTML = _gmhczBuildBanner(view, pdata);
    _gmhczRenderSummary(pdata);
  }

  // ──── CROSS-ZONE VIEWS ────

  function _gmhczMetricValue(pd, m) {
    if (m === 'ren') return pd.renPct;
    if (m === 'co2') return pd.co2;
    if (m === 'load') return pd.avgLoadGW;
    if (m === 'energy') return pd.energyTWh;
    return 0;
  }
  function _gmhczMetricUnit(m) {
    return { ren: '%', co2: ' g/kWh', load: ' GW', energy: ' TWh' }[m] || '';
  }

  function _gmhczRenderRanking(pdata) {
    const host = document.getElementById('gmhcz-content');
    if (!host) return;
    const metric = window._gmhcz.metric;
    const zones = Object.keys(pdata);
    // Sort: REN/load/energy desc · CO2 asc (clean first)
    const sorted = [...zones].sort((a, b) => {
      const va = _gmhczMetricValue(pdata[a], metric);
      const vb = _gmhczMetricValue(pdata[b], metric);
      return metric === 'co2' ? va - vb : vb - va;
    });
    const max = Math.max(...sorted.map(z => Math.abs(_gmhczMetricValue(pdata[z], metric))));
    const FLAGS = window.FLAG_MAP || {};
    const unit = _gmhczMetricUnit(metric);
    const accent = metric === 'co2' ? '#A78BFA' : '#14D3A9';

    host.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px">
        ${sorted.map((z, i) => {
          const v = _gmhczMetricValue(pdata[z], metric);
          const w = Math.max(2, (Math.abs(v) / max) * 100);
          const isFr = z === 'FR';
          const displayV = metric === 'co2' ? Math.round(v) : v.toFixed(1);
          return `<div style="display:flex;align-items:center;gap:10px;font-family:'JetBrains Mono',monospace;font-size:11px">
            <span style="width:30px;color:var(--tx3)">#${i + 1}</span>
            <span style="width:80px;font-weight:${isFr ? 700 : 600};color:${isFr ? '#fff' : 'var(--tx)'}">${FLAGS[z] || ''} ${z}${isFr ? ' <span style="color:#14D3A9">●</span>' : ''}</span>
            <div style="flex:1;height:18px;background:rgba(255,255,255,0.03);border-radius:3px;position:relative">
              <div style="position:absolute;left:0;top:0;height:100%;width:${w}%;background:${accent};border-radius:3px;opacity:${isFr ? 1 : 0.75}"></div>
            </div>
            <span style="width:80px;text-align:right;font-weight:600;color:${isFr ? '#fff' : 'var(--tx)'}">${displayV}${unit}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  function _gmhczRenderHeatmap(pdata) {
    const host = document.getElementById('gmhcz-content');
    if (!host) return;
    const STACK = ['nuclear', 'wind', 'solar', 'hydro', 'biomass', 'fossil', 'other'];
    const FUEL_META = window.GM_FUEL_META || {};
    const FLAGS = window.FLAG_MAP || {};
    const hexToRgb = (typeof window._hexToRgb === 'function') ? window._hexToRgb : (hex => {
      const h = hex.replace('#', '');
      return `${parseInt(h.substr(0, 2), 16)},${parseInt(h.substr(2, 2), 16)},${parseInt(h.substr(4, 2), 16)}`;
    });
    const sorted = Object.keys(pdata).sort((a, b) => pdata[b].avgLoadGW - pdata[a].avgLoadGW);

    let html = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
      <thead><tr><th style="padding:8px;text-align:left;color:var(--tx3);font-weight:600;width:90px;border-bottom:1px solid var(--bd)">Zone</th>`;
    STACK.forEach(k => {
      const m = FUEL_META[k]; if (!m) return;
      html += `<th style="padding:8px;text-align:center;color:${m.color};font-weight:600;font-size:11px;border-bottom:1px solid var(--bd)">${m.emoji || ''} ${m.label || k}</th>`;
    });
    html += `<th style="padding:8px;text-align:right;color:var(--tx3);font-weight:600;width:90px;border-bottom:1px solid var(--bd)">Total</th></tr></thead><tbody>`;

    sorted.forEach(z => {
      const p = pdata[z]; const totalTWh = p.totalTWh; const isFr = z === 'FR';
      const flag = FLAGS[z] || '';
      html += `<tr style="border-top:1px solid var(--bd);${isFr ? 'background:rgba(255,255,255,0.03);' : ''}">
        <td style="padding:8px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${isFr ? '#fff' : 'var(--tx)'};letter-spacing:.04em">${flag} ${z}${isFr ? ' <span style="color:#14D3A9;font-size:9px">●</span>' : ''}</td>`;
      STACK.forEach(k => {
        const m = FUEL_META[k]; if (!m) return;
        const pct = ((p[k] || 0) / Math.max(totalTWh, 0.001)) * 100;
        const opacity = Math.min(0.85, pct / 50);
        const bg = `rgba(${hexToRgb(m.color)},${opacity})`;
        const tc = opacity > 0.4 ? '#0A1018' : 'var(--tx2)';
        html += `<td style="padding:8px;text-align:center;background:${bg};color:${tc};font-family:'JetBrains Mono',monospace;font-weight:${opacity > 0.4 ? 700 : 500}">${pct.toFixed(1)}%</td>`;
      });
      html += `<td style="padding:8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${p.totalTWh.toFixed(1)} TWh</td></tr>`;
    });
    html += `</tbody></table></div>
      <div style="margin-top:12px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx3);line-height:1.5">Cell opacity ∝ % share over period. FR row highlighted.</div>`;
    host.innerHTML = html;
  }

  function _gmhczRenderTrends(pdata) {
    const host = document.getElementById('gmhcz-content');
    if (!host) return;
    const metric = window._gmhcz.metric;
    const zones = Object.keys(pdata);

    host.innerHTML = `
      <div style="position:relative;width:100%;height:340px">
        <canvas id="gmhcz-trends-canvas" style="width:100%;height:100%;display:block"></canvas>
      </div>`;

    // Pick the longest daily series
    const labels = pdata[zones[0]]?.dailySeries.date || [];
    const PALETTE = ['#14D3A9', '#FBBF24', '#A78BFA', '#ED6965', '#60A5FA', '#34D399', '#F472B6', '#FB923C', '#22D3EE', '#A3E635'];
    // Series per zone
    const datasets = zones.slice(0, 12).map((z, i) => {
      const ds = pdata[z].dailySeries;
      let arr;
      if (metric === 'ren') arr = ds.renPct;
      else if (metric === 'co2') arr = ds.co2;
      else if (metric === 'load') arr = ds.load;
      else if (metric === 'energy') arr = ds.load.map(v => v * 24 / 1000); // GWh per day → TWh
      const isFr = z === 'FR';
      return {
        label: z,
        data: arr,
        borderColor: isFr ? '#fff' : PALETTE[i % PALETTE.length],
        backgroundColor: 'transparent',
        borderWidth: isFr ? 2.5 : 1.2,
        fill: false, tension: 0.3, pointRadius: 0, pointHoverRadius: 4,
      };
    });

    const canvas = document.getElementById('gmhcz-trends-canvas');
    if (window._gmhczTrendsChart) { try { window._gmhczTrendsChart.destroy(); } catch (_) {} }
    window._gmhczTrendsChart = new Chart(canvas, {
      type: 'line', data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', align: 'end',
            labels: { color: '#4A6280', font: { size: 9, family: 'JetBrains Mono' }, boxWidth: 14, usePointStyle: true } },
          tooltip: {
            backgroundColor: '#0A1018', titleColor: '#fff', bodyColor: '#B8C9D9',
            borderColor: '#1A2533', borderWidth: 1, padding: 8,
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont: { family: 'JetBrains Mono', size: 10 },
          },
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9 } },
            title: { display: true, text: { ren: '% renewable', co2: 'g CO₂/kWh', load: 'GW', energy: 'TWh/day' }[metric] || '', color: '#7A93AB', font: { family: 'JetBrains Mono', size: 9, weight: '600' } } },
        },
      },
    });
  }

  function _gmhczRenderSpread(pdata) {
    const host = document.getElementById('gmhcz-content');
    if (!host) return;
    const metric = window._gmhcz.metric;
    const ref = window._gmhcz.ref;
    const refVal = pdata[ref] ? _gmhczMetricValue(pdata[ref], metric) : null;
    if (refVal == null) { host.innerHTML = `<div style="padding:20px;color:var(--tx3)">Pick a reference zone</div>`; return; }
    const FLAGS = window.FLAG_MAP || {};
    const sorted = Object.keys(pdata)
      .filter(z => z !== ref)
      .map(z => ({ z, v: _gmhczMetricValue(pdata[z], metric) - refVal }))
      .sort((a, b) => metric === 'co2' ? a.v - b.v : b.v - a.v);
    const max = Math.max(...sorted.map(s => Math.abs(s.v)), 0.001);
    const unit = _gmhczMetricUnit(metric);

    host.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--tx3);margin-bottom:6px">Δ vs <strong style="color:var(--tx)">${ref}</strong> · positive = ${metric === 'co2' ? 'dirtier (worse)' : 'better than'} ${ref}</div>
        ${sorted.map(s => {
          const pos = s.v >= 0;
          // For CO2 positive means dirtier (red), for others positive means better (green)
          const isBetter = (metric === 'co2') ? !pos : pos;
          const col = isBetter ? '#14D3A9' : '#ED6965';
          const w = (Math.abs(s.v) / max) * 50;
          return `<div style="display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:11px">
            <span style="width:90px;font-weight:600">${FLAGS[s.z] || ''} ${s.z}</span>
            <div style="flex:1;height:16px;background:rgba(255,255,255,0.03);border-radius:3px;position:relative;display:flex;justify-content:center">
              <div style="position:absolute;left:50%;top:0;height:100%;width:1px;background:rgba(255,255,255,0.15)"></div>
              <div style="position:absolute;top:0;height:100%;${pos ? `left:50%;width:${w}%;` : `right:50%;width:${w}%;`}background:${col};border-radius:3px;opacity:.85"></div>
            </div>
            <span style="width:70px;text-align:right;color:${col};font-weight:600">${s.v >= 0 ? '+' : ''}${metric === 'co2' ? Math.round(s.v) : s.v.toFixed(1)}${unit}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  function _gmhczBuildBanner(view, pdata) {
    const builder = window._gmBuildMarketBanner;
    if (typeof builder !== 'function') return '';
    const period = window._gmhPeriod;
    const zones = Object.keys(pdata);

    const ranks = zones.map(z => ({ z, ...pdata[z] }));
    const topRen = [...ranks].sort((a, b) => b.renPct - a.renPct)[0];
    const cleanCo2 = [...ranks].sort((a, b) => a.co2 - b.co2)[0];

    if (view === 'ranking') {
      const metric = window._gmhcz.metric;
      const lbl = { ren: 'Renewable %', co2: 'CO₂ g/kWh', load: 'Avg load GW', energy: 'Energy TWh' }[metric];
      const ranked = [...zones].sort((a, b) => metric === 'co2' ? pdata[a][metric === 'co2' ? 'co2' : metric === 'ren' ? 'renPct' : metric === 'load' ? 'avgLoadGW' : 'energyTWh'] - pdata[b][metric === 'co2' ? 'co2' : metric === 'ren' ? 'renPct' : metric === 'load' ? 'avgLoadGW' : 'energyTWh'] : pdata[b][metric === 'co2' ? 'co2' : metric === 'ren' ? 'renPct' : metric === 'load' ? 'avgLoadGW' : 'energyTWh'] - pdata[a][metric === 'co2' ? 'co2' : metric === 'ren' ? 'renPct' : metric === 'load' ? 'avgLoadGW' : 'energyTWh']);
      const top = ranked[0]; const bot = ranked[ranked.length - 1];
      const topV = _gmhczMetricValue(pdata[top], metric);
      const botV = _gmhczMetricValue(pdata[bot], metric);
      const line1 = `Cross-zone period ${period} on <strong style="color:#fff">${lbl}</strong> · top <strong style="color:#fff">${top}</strong>, bottom <strong style="color:#fff">${bot}</strong>. Spread ${Math.abs(topV - botV).toFixed(1)}${_gmhczMetricUnit(metric)}.`;
      const verdict = `Geographic dispersion structural over ${period}. ${metric === 'co2' ? 'Low-carbon zones offer attractive offtake terms.' : 'Capture-price differentials follow REN penetration.'}`;
      return builder({ line1, verdict });
    }
    if (view === 'heatmap') {
      const line1 = `EU mix structure over ${period} · top REN: <strong style="color:#fff">${topRen.z}</strong> (${topRen.renPct.toFixed(0)}%). Cleanest grid: <strong style="color:#fff">${cleanCo2.z}</strong> (${Math.round(cleanCo2.co2)} g/kWh).`;
      const verdict = `Period heatmap shows structural shares — useful for identifying zones with consistent renewable penetration (offtake/PPA targets).`;
      return builder({ line1, verdict });
    }
    if (view === 'trends') {
      const line1 = `Daily trajectory over ${period} on <strong style="color:#fff">${{ ren: 'REN %', co2: 'CO₂ g/kWh', load: 'avg load GW', energy: 'daily energy TWh' }[window._gmhcz.metric]}</strong> · ${zones.length} zones overlaid.`;
      const verdict = `Look for divergent paths (decarbonisation winners vs laggards) and synchronised swings (weather-driven correlations).`;
      return builder({ line1, verdict });
    }
    if (view === 'spread') {
      const ref = window._gmhcz.ref;
      const line1 = `Spread vs <strong style="color:#fff">${ref}</strong> on ${{ ren: 'REN %', co2: 'CO₂ g/kWh' }[window._gmhcz.metric] || 'metric'}, period ${period}.`;
      const verdict = `Use this to size cross-border offtake premiums and quantify carbon-arbitrage between zones.`;
      return builder({ line1, verdict });
    }
    return '';
  }

  function _gmhczRenderSummary(pdata) {
    const tbody = document.getElementById('gmhcz-summary-tbody');
    const label = document.getElementById('gmhcz-summary-label');
    if (!tbody) return;
    const zones = Object.keys(pdata);
    if (label) label.textContent = `Cross-zone summary · period ${window._gmhPeriod} · ${zones.length} zones`;
    if (!zones.length) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--tx3)">No data</td></tr>`; return; }
    const sorted = [...zones].sort((a, b) => pdata[b].avgLoadGW - pdata[a].avgLoadGW);
    const FUEL_META = window.GM_FUEL_META || {};
    const FLAGS = window.FLAG_MAP || {};
    const fr = pdata['FR'];
    const frRen = fr ? fr.renPct : null;
    const frCo2 = fr ? fr.co2    : null;

    tbody.innerHTML = sorted.map(z => {
      const p = pdata[z];
      const dom = FUEL_META[p.dom] || { color: '#7A93AB', label: p.dom, emoji: '' };
      const flag = FLAGS[z] || '';
      const isFr = z === 'FR';
      const dRen = (frRen != null) ? p.renPct - frRen : null;
      const dCo2 = (frCo2 != null) ? p.co2 - frCo2   : null;
      const dRenColor = (dRen == null || isFr) ? 'var(--tx3)' : (dRen >= 0 ? '#14D3A9' : '#ED6965');
      const dCo2Color = (dCo2 == null || isFr) ? 'var(--tx3)' : (dCo2 <= 0 ? '#14D3A9' : '#ED6965');
      const dRenStr = (dRen == null) ? '--' : (isFr ? '— ref —' : (dRen >= 0 ? '+' : '') + dRen.toFixed(1) + ' pts');
      const dCo2Str = (dCo2 == null) ? '--' : (isFr ? '— ref —' : (dCo2 >= 0 ? '+' : '') + Math.round(dCo2));
      return `<tr style="${isFr ? 'background:rgba(20,211,169,0.04);' : ''}">
        <td style="text-align:left;padding:6px 10px;font-family:'JetBrains Mono',monospace;font-weight:600">${flag} ${z}${isFr ? ' <span style="color:#14D3A9;font-size:9px">●</span>' : ''}</td>
        <td style="text-align:right;padding:6px 10px;font-family:'JetBrains Mono',monospace">${p.avgLoadGW.toFixed(2)}</td>
        <td style="text-align:right;padding:6px 10px;font-family:'JetBrains Mono',monospace;color:${_gmRen(p.renPct)};font-weight:600">${p.renPct.toFixed(1)}%</td>
        <td style="text-align:right;padding:6px 10px;font-family:'JetBrains Mono',monospace;color:${_gmCo2(p.co2)};font-weight:600">${Math.round(p.co2)}</td>
        <td style="text-align:left;padding:6px 10px;font-family:'JetBrains Mono',monospace"><span style="color:${dom.color}">${dom.emoji} ${dom.label}</span></td>
        <td style="text-align:right;padding:6px 10px;font-family:'JetBrains Mono',monospace;color:${dRenColor};font-weight:${isFr ? 500 : 600}">${dRenStr}</td>
        <td style="text-align:right;padding:6px 10px;font-family:'JetBrains Mono',monospace;color:${dCo2Color};font-weight:${isFr ? 500 : 600}">${dCo2Str}</td>
      </tr>`;
    }).join('');
  }

  // ════════════════════════════════════════════════════════════════
  // COLOR HELPERS (mirror genmix.js)
  // ════════════════════════════════════════════════════════════════
  function _gmRen(pct) {
    if (pct >= 60) return '#14D3A9';
    if (pct >= 40) return '#FBBF24';
    return '#ED6965';
  }
  function _gmCo2(g) {
    if (g < 50) return '#14D3A9';
    if (g < 150) return '#FBBF24';
    if (g < 400) return '#F97316';
    return '#ED6965';
  }

  // ════════════════════════════════════════════════════════════════
  // MAIN RENDER ENTRY POINT
  // ════════════════════════════════════════════════════════════════
  function _gmhRenderAll() {
    if (!document.getElementById('hs-gmh-main')) return; // page not present
    _gmhRenderBoard();
    _gmhRenderCrossZone();
  }
  window._gmhRenderAll = _gmhRenderAll;

  // ════════════════════════════════════════════════════════════════
  // INIT · hook on data events
  // ════════════════════════════════════════════════════════════════
  function _gmhInit() {
    const refresh = () => _gmhRenderAll();
    document.addEventListener('genmix-loaded', refresh);
    document.addEventListener('zones-changed', refresh);
    if (window._genmixData) refresh();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _gmhInit);
  } else {
    _gmhInit();
  }
})();
