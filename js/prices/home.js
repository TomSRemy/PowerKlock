// js/prices/home.js — Prices: Prices home (Overview sub-page).
// Part of the former js/prices.js (lines 4879–5333), split without changes: plain scripts loaded in this order
// by index.html, sharing their globals as before.
// ════════════════════════════════════════════════════════════════════
// Prices home (Overview subdomain) · live data renderer
// ────────────────────────────────────────────────────────────────────
// Populates the home page with:
//   1. Sub-domain cards · enriched mini-KPI per card
//   2. Snapshot KPI strip · FR / EU panel / Cheapest / Most exp / Spread
//   3. Market Read banner (amber)
//   4. Today's intraday chart (multi-zone, today vs J-1)
//   5. Recent anomalies table (last 7 days, |Z|>2 vs 30D baseline)
//
// Triggered on every overview activation via prSelectSubdomain('overview').
// Reads from window._pricesSorted (must be loaded before first call).
// ════════════════════════════════════════════════════════════════════
(function() {
  'use strict';

  // Top 7 zones tracked on the home chart, in display order
  const HOME_ZONES = ['FR', 'DE_LU', 'ES', 'BE', 'NL', 'IT_NORD', 'PT'];

  // Pretty long date label
  function _fmtLongDate(iso) {
    if (!iso) return '';
    try {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(y, m-1, d).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    } catch (_) { return ''; }
  }

  // ── 1 · Enrich the four sub-domain cards with live KPIs ──
  function _renderSubdomainCards(data) {
    if (!Array.isArray(data) || !data.length) return;

    // Day-Ahead card · FR today
    const fr = data.find(z => z.code === 'FR');
    const daKpi = document.getElementById('pr-home-card-da-kpi');
    const daLbl = document.getElementById('pr-home-card-da-label');
    const daDesc = document.getElementById('pr-home-card-da-desc');
    const nLoaded = data.filter(z => z.today != null).length;
    if (daDesc && nLoaded) daDesc.textContent = `ENTSO-E day-ahead market · ${nLoaded} European bidding zones`;
    if (fr && fr.today != null) {
      if (daKpi) daKpi.textContent = `${fr.today.toFixed(2)} €/MWh`;
      if (daLbl) daLbl.textContent = `FR · today's average`;
    } else {
      const loadedFirst = data.find(z => z.today != null);
      if (loadedFirst && daKpi) daKpi.textContent = `${loadedFirst.today.toFixed(2)} €/MWh`;
      if (loadedFirst && daLbl) daLbl.textContent = `${loadedFirst.code} · today's average`;
    }

    // Spread card · FR daily spread today
    const spreadKpi = document.getElementById('pr-home-card-spread-kpi');
    const spreadLbl = document.getElementById('pr-home-card-spread-label');
    if (fr && fr.hourly && fr.hourly.length) {
      const vals = fr.hourly.filter(v => v != null);
      if (vals.length) {
        const sp = Math.max(...vals) - Math.min(...vals);
        if (spreadKpi) spreadKpi.textContent = `${sp.toFixed(2)} €/MWh`;
        if (spreadLbl) spreadLbl.textContent = `FR · today (max − min)`;
      }
    }

    // Negative-prices card · total neg hours today across all loaded zones
    const negKpi = document.getElementById('pr-home-card-neg-kpi');
    const negLbl = document.getElementById('pr-home-card-neg-label');
    // KPI = negative hours in the most-affected zone (a sum across zones
    // mixes zone-hours with clock hours and isn't readable).
    let zonesWithNeg = 0, topZone = null, topH = 0;
    data.forEach(z => {
      if (!z.hourly || !z.hourly.length) return;
      const n = z.hourly.filter(v => v != null && v < 0).length;
      if (!n) return;
      zonesWithNeg++;
      const h = n * 24 / z.hourly.length;
      if (h > topH) { topH = h; topZone = z.code; }
    });
    if (negKpi) {
      negKpi.textContent = `${topH.toFixed(topH % 1 === 0 ? 0 : 2)} h`;
      negKpi.style.color = topH === 0 ? 'var(--up)' : 'var(--down)';
    }
    if (negLbl) {
      negLbl.textContent = zonesWithNeg > 0
        ? (window.PKI18n && PKI18n.lang !== 'en' ? `Aujourd’hui · max ${topZone} · ${zonesWithNeg} zone${zonesWithNeg > 1 ? 's' : ''} concernée${zonesWithNeg > 1 ? 's' : ''}` : `Today · max ${topZone} · ${zonesWithNeg} zone${zonesWithNeg > 1 ? 's' : ''} affected`)
        : `Today · no negative prices`;
    }
  }

  // J-1 daily average: rows carry vsYday (= today − J-1), not J-1 itself.
  function _yday(z) {
    if (z.yesterday != null) return z.yesterday;
    return (z.vsYday != null && z.today != null) ? z.today - z.vsYday : null;
  }

  // ── 2 · Snapshot KPI strip (5 cards) ──
  function _renderKpiStrip(data) {
    if (!Array.isArray(data) || !data.length) return;
    const loaded = data.filter(z => z.today != null && !isNaN(z.today));
    if (!loaded.length) return;

    const setV = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const setT = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

    // FR
    const fr = loaded.find(z => z.code === 'FR');
    if (fr) {
      setV('pr-home-kpi-fr-v', `${fr.today.toFixed(2)}<span class="pr-home-kpi-unit"> €/MWh</span>`);
      if (_yday(fr) != null) {
        const diff = fr.today - _yday(fr);
        const sign = diff >= 0 ? '▲ +' : '▼ ';
        const col = diff >= 0 ? 'var(--down)' : 'var(--up)';
        const meta = document.getElementById('pr-home-kpi-fr-meta');
        if (meta) {
          meta.innerHTML = `<span style="color:${col}">${sign}${diff.toFixed(2)}</span> vs J-1`;
        }
      } else {
        setT('pr-home-kpi-fr-meta', 'no J-1 data');
      }
    } else {
      setV('pr-home-kpi-fr-v', `--<span class="pr-home-kpi-unit"> €/MWh</span>`);
      setT('pr-home-kpi-fr-meta', 'FR not loaded');
    }

    // EU panel avg
    const avg = loaded.reduce((s, z) => s + z.today, 0) / loaded.length;
    setV('pr-home-kpi-eu-v', `${avg.toFixed(2)}<span class="pr-home-kpi-unit"> €/MWh</span>`);
    setT('pr-home-kpi-eu-meta', `${loaded.length} zones · avg`);

    // Cheapest
    const sorted = [...loaded].sort((a, b) => a.today - b.today);
    const cheap = sorted[0];
    const pricey = sorted[sorted.length - 1];
    setV('pr-home-kpi-cheap-v', `${cheap.today.toFixed(2)}<span class="pr-home-kpi-unit"> €/MWh</span>`);
    setT('pr-home-kpi-cheap-meta', cheap.code);
    setV('pr-home-kpi-pricey-v', `${pricey.today.toFixed(2)}<span class="pr-home-kpi-unit"> €/MWh</span>`);
    setT('pr-home-kpi-pricey-meta', pricey.code);

    // EU spread (max − min)
    const sp = pricey.today - cheap.today;
    const spPct = cheap.today > 0 ? (sp / cheap.today) * 100 : 0;
    setV('pr-home-kpi-spread-v', `${sp.toFixed(2)}<span class="pr-home-kpi-unit"> €/MWh</span>`);
    setT('pr-home-kpi-spread-meta', `${pricey.code} − ${cheap.code} · ${loaded.length} zones`);
  }

  // ── 3 · Market Read banner ──
  function _renderMarketRead(data) {
    const host = document.getElementById('pr-home-market-read');
    if (!host) return;
    const loaded = data.filter(z => z.today != null && !isNaN(z.today));
    if (!loaded.length) { host.innerHTML = ''; return; }

    const sorted = [...loaded].sort((a, b) => a.today - b.today);
    const cheap = sorted[0];
    const pricey = sorted[sorted.length - 1];
    const avg = loaded.reduce((s, z) => s + z.today, 0) / loaded.length;
    const fr = loaded.find(z => z.code === 'FR');

    // J-1 movement of the panel average (if available)
    let panelMove = '';
    const withYday = loaded.filter(z => _yday(z) != null);
    if (withYday.length >= 3) {
      // Same-zone comparison: avg of today vs avg of J-1 over the zones that have both
      const tAvg = withYday.reduce((s, z) => s + z.today, 0) / withYday.length;
      const yAvg = withYday.reduce((s, z) => s + _yday(z), 0) / withYday.length;
      const dAvg = tAvg - yAvg;
      const sign = dAvg >= 0 ? '+' : '';
      const col = dAvg >= 0 ? '#ED6965' : '#14D3A9';
      panelMove = ` EU panel <span style="color:${col};font-weight:600">${sign}${dAvg.toFixed(2)} €/MWh vs J-1</span>.`;
    }

    let frPart = '';
    if (fr) {
      const gap = fr.today - cheap.today;
      if (Math.abs(gap) < 1) {
        frPart = ` FR is among the cheapest markets.`;
      } else {
        frPart = ` FR sits <span style="color:#FBBF24;font-weight:600">+${gap.toFixed(2)} €/MWh</span> above ${cheap.code}.`;
      }
    }

    const spread = pricey.today - cheap.today;
    // Regime from the dispersion of the whole panel (coefficient of
    // variation), not max/min: one near-zero outlier (SE, NO) made the old
    // "% of cheapest" ratio explode and every day read "highly fragmented".
    const sd = Math.sqrt(loaded.reduce((s, z) => s + (z.today - avg) ** 2, 0) / loaded.length);
    const cv = Math.abs(avg) > 1 ? sd / Math.abs(avg) : 0;
    let regime;
    if (cv > 0.5) regime = `<b>Highly fragmented European zones</b>`;
    else if (cv > 0.3) regime = `<b>Pronounced cross-zone divergence</b>`;
    else if (cv > 0.15) regime = `<b>Moderate cross-zone gap</b>`;
    else regime = `<b>Tightly aligned zones</b>`;

    host.innerHTML = `
      <div style="padding:10px 14px;font-size:11.5px;border-radius:3px;color:#FBBF24;background:rgba(251,191,36,0.08);border-left:3px solid #FBBF24;line-height:1.55">
        <strong>◈ MARKET READ · </strong>
        ${regime}. Cheapest <span style="color:#14D3A9;font-weight:600">${cheap.code} ${cheap.today.toFixed(2)}</span>, most expensive <span style="color:#ED6965;font-weight:600">${pricey.code} ${pricey.today.toFixed(2)}</span> · spread <span style="font-weight:600">${spread.toFixed(2)} €/MWh</span>.${panelMove}${frPart}
      </div>`;
  }

  // ── 4 · Intraday chart (multi-zone, today vs J-1) ──
  function _renderIntradayChart(data) {
    const canvas = document.getElementById('pr-home-intraday-canvas');
    if (!canvas || typeof Chart === 'undefined') return;

    // Zone filter chips (default: the 7 home zones)
    if (!window._prHomeZones) window._prHomeZones = new Set(HOME_ZONES);
    const chipHost = document.getElementById('pr-home-zone-chips');
    if (chipHost) {
      const avail = data.filter(z => z.hourly && z.hourly.length).map(z => z.code);
      const order = HOME_ZONES.filter(c => avail.includes(c)).concat(avail.filter(c => !HOME_ZONES.includes(c)).sort());
      chipHost.innerHTML = order.map(c => {
        const on = window._prHomeZones.has(c);
        return `<button class="pk-gf-btn${on ? ' active' : ''}" style="padding:2px 8px;font-size:10px" onclick="prHomeToggleZone('${c}')">${c}</button>`;
      }).join('');
    }
    // Update card title with zone count
    const zonesOn = [...window._prHomeZones].filter(c => data.some(z => z.code === c && z.hourly && z.hourly.length));
    const title = document.getElementById('pr-home-chart-title');
    if (title) title.textContent = `${zonesOn.length} zone${zonesOn.length > 1 ? 's' : ''} · 15-min day-ahead profile`;
    PKW.draw('da-intraday', 'pr-home-intraday-canvas', { codes: [...window._prHomeZones] }).then(() => {
      setTimeout(() => { addFullscreen('pr-home-intraday-canvas'); addDownload('pr-home-intraday-canvas', 'intraday-' + (window._currentPriceDate || '')); }, 60);
    });
  }

  // ── 5 · Recent anomalies table (last 7 days · |Z| > 2 vs 30D baseline) ──
  // For each of the last 7 delivery days, fetch the daily-history JSON,
  // compute the daily average per zone, build a robust Z-score using the
  // 30D baseline already cached, and surface anything with |Z| > 2.
  async function _renderAnomaliesTable(data) {
    const tbody = document.getElementById('pr-home-anomalies-tbody');
    if (!tbody) return;
    if (!Array.isArray(data) || !data.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--tx3);font-style:italic">No prices loaded yet.</td></tr>`;
      return;
    }

    // Collect last 7 dates (delivery days, today included)
    const today = new Date();
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    // For each zone in HOME_ZONES, ensure we have its 30D envelope (cache).
    // Then walk each date and pull the historical JSON to derive that day's avg.
    const candidates = HOME_ZONES
      .map(code => data.find(z => z.code === code))
      .filter(Boolean);
    if (!candidates.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--tx3);font-style:italic">No zones available.</td></tr>`;
      return;
    }

    // Default lookback for anomaly detection
    const nDays = 30;
    const nPts = (candidates[0].hourly && candidates[0].hourly.length) || 96;

    // Pre-fetch envelopes in parallel
    await Promise.all(candidates.map(z =>
      (typeof fetchHistoricalEnvelope === 'function')
        ? fetchHistoricalEnvelope(z.code, nDays, nPts)
        : Promise.resolve(null)
    ));

    // For each historical day in our window, load the day's prices JSON
    // and compute per-zone daily averages.
    const historicalDays = await Promise.all(dates.map(async (dt) => {
      try {
        const r = await fetch(`data/history/daily/${dt}.json`);
        if (!r.ok) return null;
        const j = await r.json();
        const out = { date: dt, zones: {} };
        const zArr = Array.isArray(j.zones) ? j.zones : Object.entries(j.zones || {}).map(([k, v]) => ({ code: k, ...v }));
        zArr.forEach(z => {
          const h = z.hourly || z.h;
          if (!Array.isArray(h) || !h.length) return;
          const valid = h.filter(v => v != null);
          if (!valid.length) return;
          out.zones[z.code] = {
            avg: valid.reduce((a, b) => a + b, 0) / valid.length,
            hourly: h,
          };
        });
        return out;
      } catch (e) { return null; }
    }));

    // Compute outliers per (date, zone)
    const outliers = [];
    candidates.forEach(z => {
      const cacheKey = `${z.code}|${nDays}|${nPts}`;
      const env = (window._envelopeCache || {})[cacheKey];
      if (!env) return;

      historicalDays.forEach(day => {
        if (!day || !day.zones[z.code]) return;
        const dayData = day.zones[z.code];
        // Per-slot Z scores via _computeZScores
        const z2 = (typeof _computeZScores === 'function') ? _computeZScores(dayData.hourly, env) : null;
        if (!z2 || z2.dayZ == null) return;
        if (Math.abs(z2.dayZ) < 2) return;
        // Compute median across env for "vs median" reporting
        const medVals = env.median.filter(v => v != null);
        const medAvg = medVals.length ? medVals.reduce((a, b) => a + b, 0) / medVals.length : null;
        outliers.push({
          date: day.date,
          code: z.code,
          avg: dayData.avg,
          medAvg,
          dayZ: z2.dayZ,
          vsMedian: medAvg != null ? (dayData.avg - medAvg) : null,
        });
      });
    });

    if (!outliers.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--tx3);font-style:italic">No anomalies detected (|Z| &gt; 2) over the last 7 days.</td></tr>`;
      return;
    }

    // Sort by |Z| desc, keep top 10
    outliers.sort((a, b) => Math.abs(b.dayZ) - Math.abs(a.dayZ));
    const top = outliers.slice(0, 10);

    const fmtDate = (iso) => {
      try {
        const [y, m, d] = iso.split('-').map(Number);
        return new Date(y, m-1, d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
      } catch (_) { return iso; }
    };
    const sign = v => v >= 0 ? '+' : '';

    tbody.innerHTML = top.map(o => {
      const isHi = o.dayZ > 2;
      const cls = isHi ? 'row-hi' : 'row-lo';
      const zCol = isHi ? 'var(--down)' : 'var(--up)';
      const read = isHi
        ? `Uncommonly expensive vs ${nDays}D baseline`
        : `Uncommonly cheap vs ${nDays}D baseline`;
      return `
        <tr class="${cls}">
          <td class="mono">${fmtDate(o.date)}</td>
          <td class="code">${o.code}</td>
          <td class="mono" style="text-align:right">${o.avg.toFixed(2)}</td>
          <td class="mono" style="text-align:right;color:${zCol}">${o.vsMedian != null ? sign(o.vsMedian) + o.vsMedian.toFixed(2) : '--'}</td>
          <td class="mono" style="text-align:right;color:${zCol};font-weight:600">${sign(o.dayZ)}${o.dayZ.toFixed(1)}σ</td>
          <td>${read}</td>
        </tr>`;
    }).join('');
  }

  // ── Main entry point ──
  function prRenderHome() {
    const data = window._pricesSorted;
    // Update subtitle date
    const subtitle = document.getElementById('pr-home-subtitle');
    if (subtitle) {
      const dateStr = _fmtLongDate(window._currentPriceDate || pkTodayISO());
      subtitle.textContent = `European power markets · ${dateStr}`;
    }
    if (!Array.isArray(data) || !data.length) {
      // No data yet · leave placeholders, retry shortly
      setTimeout(prRenderHome, 500);
      return;
    }
    _renderSubdomainCards(data);
    _renderKpiStrip(data);
    _renderMarketRead(data);
    _renderIntradayChart(data);
    if (typeof window.prRenderHomeExtra === 'function') window.prRenderHomeExtra(data);
    // Anomalies table runs async (fetches 7 days of JSON)
    _renderAnomaliesTable(data).catch(e => console.warn('[prRenderHome] anomalies failed', e));
  }

  // ── Day-ahead intraday profile (page + dashboard) ──
  const DA_GROUPS = {
    core: ['FR', 'DE_LU', 'ES', 'BE', 'NL', 'IT_NORD', 'PT'],
    FR: ['FR'], 'FR-DE': ['FR', 'DE_LU'],
    CWE: ['FR', 'DE_LU', 'BE', 'NL', 'AT'],
    iberia: ['FR', 'ES', 'PT'],
    south: ['FR', 'IT_NORD', 'CH', 'ES'],
    nordic: ['DK_W', 'DK_E', 'NO_1', 'SE', 'FI'],
    cee: ['DE_LU', 'PL', 'CZ', 'SK', 'HU', 'RO'],
  };
  PKW.register({
    id: 'da-intraday', title: 'Day-ahead intraday profile', category: 'prices', source: 'ENTSO-E',
    page: 'prices', pageCanvas: 'pr-home-intraday-canvas', size: { w: 8, h: 5 },
    desc: '15-minute day-ahead prices of a group of zones for the current delivery day.',
    params: [{ key: 'group', label: 'Zones', inTitle: true, options: [
      ['core', 'Main zones'], ['FR', 'France'], ['FR-DE', 'France · Germany'], ['CWE', 'CWE'], ['iberia', 'France · Iberia'],
      ['south', 'France · Italy · Switzerland · Spain'], ['nordic', 'Nordics'], ['cee', 'Central-East Europe']] }],
    defaults: { group: 'core' },
    async draw(cid, p) {
      const data = await PKW.waitFor(() => { const d = window._pricesSorted || (typeof pricesData !== 'undefined' ? pricesData : null); return d && d.length ? d : null; });
      if (!data) { noDataMsg(cid, 'Day-ahead prices not loaded', 'ENTSO-E'); return null; }
      const codes = p.codes || DA_GROUPS[p.group] || DA_GROUPS.core;
      const zones = codes.map(code => data.find(z => z.code === code)).filter(z => z && z.hourly && z.hourly.length);
      if (!zones.length) { noDataMsg(cid, 'No prices for these zones today', 'ENTSO-E'); return null; }
      const nPts = zones[0].hourly.length;
      const labels = makeTimeLabels(nPts);
      const datasets = zones.map(z => {
        const col = ccZoneColor(z.code, data, data.indexOf(z));
        return { label: z.code, data: z.hourly, borderColor: col, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
          pointHoverBackgroundColor: col, fill: false, tension: 0, spanGaps: true };
      });
      const a = nowLineAnnotation({ slots: nPts, labels, chartDate: window._currentPriceDate });
      mkChart(cid, {
        type: 'line',
        data: { labels, datasets },
        plugins: [ccBuildCommonShading(nPts)],
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: true, position: 'bottom', labels: { color: '#B8C9D9', font: { size: 10 }, boxWidth: 10, padding: 10 } },
            tooltip: { mode: 'index', intersect: false, callbacks: {
              title: c => c[0].label,
              label: c => c.raw != null ? ` ${c.dataset.label}: ${c.raw.toFixed(1)} €/MWh` : null,
            } },
            zoom: ZOOM_CFG,
            annotation: { annotations: a ? { nowLine: a } : {} },
          },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 9 }, maxTicksLimit: 12 } },
            y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', callback: v => v.toFixed(0) }, title: { display: true, text: '€/MWh', color: '#7A93AB', font: { size: 9 } }, grace: '12%' },
          },
        },
      });
      return { sub: 'delivery ' + (window._currentPriceDate || '') };
    },
  });

  window.prRenderHome = prRenderHome;
  window.prHomeToggleZone = function (code) {
    const s = window._prHomeZones || new Set(HOME_ZONES);
    if (s.has(code)) { if (s.size > 1) s.delete(code); } else s.add(code);
    window._prHomeZones = s;
    _renderIntradayChart(window._pricesSorted || []);
  };

  // Auto-render when the overview panel is initially active (page load)
  function _maybeAutoRender() {
    const panel = document.querySelector('.subdomain-panel[data-subdomain-panel="overview"]');
    if (panel && panel.classList.contains('active')) {
      // Wait a bit so _pricesSorted is populated by loadPrices()
      setTimeout(prRenderHome, 800);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _maybeAutoRender);
  } else {
    _maybeAutoRender();
  }
})();
