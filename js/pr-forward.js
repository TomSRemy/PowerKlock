// ════════════════════════════════════════════════════════════════════════════
// PowerKlock · PRICES > FORWARD (power forward curve, FR/UK/DE/NL)
// ────────────────────────────────────────────────────────────────────────────
// Source : data/fr_market.json + data/history/fr_market_series.json
//          + data/history/fr_market_calchain.json
// (scripts/fetch_fr_market.py — SEFE Energy public cockpit, daily cron)
//
// Structure (mirrors the Genmix Daily board's row-drill pattern):
//   - KPI strip, one card per country
//   - Countries table, one row per country — click a row to drill down into
//     that country's own KPI strip + sub-tabbed graphs (Forward / Tous les
//     Cal / Cal+1 glissant / Graph libre / Nucléaire), only one open at a time
//   - Separate "Comparaison pays" section: pick one product, overlay all
//     four countries on the same chart + a snapshot table
//
// Encapsulé en IIFE : seules window.renderPrFwd et les window._pf*/_prFwd* fuient.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var FORWARD_TENORS = ['M+1', 'M+2', 'M+3', 'Q+1', 'Q+2', 'Q+3', 'S+1', 'S+2', 'Y+1', 'Y+2', 'Y+3'];
  var COUNTRIES = [
    { code: 'FR', label: 'France', flag: '🇫🇷', colour: '#14D3A9' },
    { code: 'UK', label: 'UK', flag: '🇬🇧', colour: '#3FA6B4' },
    { code: 'DE', label: 'Allemagne', flag: '🇩🇪', colour: '#EE9B00' },
    { code: 'NL', label: 'Pays-Bas', flag: '🇳🇱', colour: '#A87DC4' }
  ];
  var PALETTE = ['#14D3A9', '#EE9B00', '#3FA6B4', '#A87DC4', '#ED6965', '#FBBF24', '#7B4B9C', '#94D2BD'];

  var PF = {
    openCountry: null,
    drillTab: 'calall',        // calall | cal1 | free | nuc
    drillTenor: 'Y+1',         // for the "Graph libre" drill tab
    drillWindow: '1Y',
    drillCalOffset: 1,
    cmpTenor: 'Y+1',
    cmpWindow: '1Y',
    loaded: false,
    snap: null,
    series: null,
    calchain: null
  };

  function num(v, dec) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return Number(v).toFixed(dec === undefined ? 2 : dec);
  }

  function shiftDays(isoStr, n) {
    var d = new Date(isoStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function loadFrMarket() {
    return fetch('data/fr_market.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function loadFrMarketSeries() {
    return fetch('data/history/fr_market_series.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function loadCalChain() {
    return fetch('data/history/fr_market_calchain.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function windowCutoffDates(dates, win) {
    if (win === 'all' || !dates.length) return dates;
    var days = { '3M': 91, '6M': 183, '1Y': 365, '3Y': 1095, '5Y': 1826 }[win] || 365;
    var cutoff = shiftDays(dates[dates.length - 1], -days);
    var startIdx = 0;
    for (var i = 0; i < dates.length; i++) { if (dates[i] >= cutoff) { startIdx = i; break; } }
    return dates.slice(startIdx);
  }

  function countryMeta(code) {
    return COUNTRIES.filter(function (c) { return c.code === code; })[0] || COUNTRIES[0];
  }

  function tenorRow(countrySnap, tenor) {
    return (countrySnap.forwardCurve || []).filter(function (r) { return r.tenor === tenor; })[0];
  }

  // Signed delta cell: ▲/▼/● (rising forward price = red = bad for a buyer).
  function deltaCell(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return '<span style="color:var(--text3)">–</span>';
    var arrow = pct > 0 ? '▲' : (pct < 0 ? '▼' : '●');
    var colour = pct > 0 ? 'var(--down)' : (pct < 0 ? 'var(--up)' : 'var(--text3)');
    var sign = pct > 0 ? '+' : '';
    return '<span style="color:' + colour + '">' + arrow + ' ' + sign + num(pct, 2) + '%</span>';
  }

  // ── Overview card KPI on the Prices home (runs independently at page load) ──
  function autoFillOverviewCard() {
    loadFrMarket().then(function (snap) {
      if (!snap) return;
      var y1 = tenorRow(snap, 'Y+1');
      var kpi = document.getElementById('pr-home-card-fwd-kpi');
      var lbl = document.getElementById('pr-home-card-fwd-label');
      if (kpi && y1 && y1.value !== null && y1.value !== undefined) {
        kpi.textContent = num(y1.value, 2) + ' €/MWh';
        kpi.style.color = '';
        kpi.style.fontStyle = 'normal';
      }
      if (lbl) lbl.textContent = y1 ? (y1.contract + ' · ' + y1.date) : '';
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // TOP · KPI strip (1 card/country) + countries table
  // ══════════════════════════════════════════════════════════════════════

  function renderTopKpis() {
    var stats = COUNTRIES.map(function (c) {
      var cs = PF.snap.countries[c.code];
      var y1 = tenorRow(cs, 'Y+1');
      return {
        l: c.flag + ' ' + c.label + ' · Y+1',
        v: num(y1 && y1.value, 2),
        u: cs.currency + '/MWh'
      };
    });
    if (typeof window.setStats === 'function') window.setStats('prfwd-kpi-strip', stats);
  }

  function renderCountriesTable() {
    var tbody = document.getElementById('prfwd-countries-tbody');
    if (!tbody) return;
    tbody.innerHTML = COUNTRIES.map(function (c) {
      var cs = PF.snap.countries[c.code];
      var y1 = tenorRow(cs, 'Y+1');
      return '<tr class="pf-row" data-country="' + c.code + '" style="cursor:pointer">' +
        '<td style="text-align:left;font-family:\'Inter\',sans-serif">' + c.flag + ' ' + c.label + '</td>' +
        '<td>' + num(cs.spot && cs.spot.value, 2) + ' ' + cs.currency + '/MWh</td>' +
        '<td>' + num(y1 && y1.value, 2) + ' ' + cs.currency + '/MWh</td>' +
        '<td>' + deltaCell(y1 && y1.varD1Pct) + '</td>' +
        '<td>' + deltaCell(y1 && y1.varW1Pct) + '</td>' +
        '</tr>';
    }).join('');
    tbody.querySelectorAll('tr.pf-row').forEach(function (tr) {
      tr.addEventListener('click', function () { window._pfToggleRow(tr.getAttribute('data-country')); });
    });
    // Re-open the row that was open before a re-render (e.g. after a full data reload).
    if (PF.openCountry) openCountryRow(PF.openCountry);
  }

  // ══════════════════════════════════════════════════════════════════════
  // DRILL-DOWN · row expand, mirrors Genmix Daily board's _gmOpenRow
  // ══════════════════════════════════════════════════════════════════════

  // "Forward" used to be a tab here (table only, chart hidden). The table is
  // now always shown below the chart instead — see renderDrillForwardTable —
  // mirroring the DA drill-down (chart, then its breakdown table underneath).
  var DRILL_TABS = [
    { key: 'calall', label: 'Tous les Cal' },
    { key: 'cal1', label: 'Cal+N glissant' },
    { key: 'free', label: 'Graph libre' },
    { key: 'nuc', label: 'Nucléaire' }
  ];

  function closeCountryRow() {
    var existing = document.getElementById('pf-detail-row');
    if (existing) existing.remove();
    document.querySelectorAll('#prfwd-countries-tbody tr.pf-row').forEach(function (r) { r.classList.remove('is-open'); });
    PF.openCountry = null;
  }

  function toggleCountryRow(cc) {
    if (PF.openCountry === cc) { closeCountryRow(); return; }
    closeCountryRow();
    openCountryRow(cc);
  }

  function openCountryRow(cc) {
    var tbody = document.getElementById('prfwd-countries-tbody');
    var row = tbody && tbody.querySelector('tr.pf-row[data-country="' + cc + '"]');
    if (!row) return;
    row.classList.add('is-open');
    PF.openCountry = cc;

    var meta = countryMeta(cc);
    var cs = PF.snap.countries[cc];

    var detail = document.createElement('tr');
    detail.id = 'pf-detail-row';
    detail.innerHTML =
      '<td colspan="5" style="padding:0;background:#141a22;border-bottom:2px solid var(--bd2)">' +
      '<div style="padding:14px 16px">' +
      '<div class="pk-section-header">' +
      '<div class="pk-section-header-text">' +
      '<div class="pk-eyebrow">Forward <span class="pk-sep">·</span> ' + meta.flag + ' ' + meta.label + ' <span class="pk-sep">·</span> Détail</div>' +
      '<div class="pk-section-title">' + meta.label + '</div>' +
      '<div class="pk-section-subtitle">snapshot ' + (cs.spot && cs.spot.date || '') + ' · source SEFE cockpit</div>' +
      '</div>' +
      '<div class="pk-section-header-actions"><button class="pk-btn-ghost" onclick="event.stopPropagation();window._pfCloseRow()">✕ Fermer</button></div>' +
      '</div>' +
      '<div class="kpi-strip" id="pf-drill-kpi-strip" style="margin:14px 0"></div>' +
      '<div class="pk-tabbar" id="pf-drill-tabs-bar">' +
      '<div class="pk-tabbar-left"><div id="pf-drill-tabs" class="pk-tabbar-tabs"></div></div>' +
      '</div>' +
      '<div id="pf-drill-content" style="min-height:300px;margin-top:10px"></div>' +
      '<div id="pf-drill-forward-table" style="margin-top:18px"></div>' +
      '</div></td>';
    row.after(detail);

    renderDrillKpis(cc);
    renderDrillTabs(cc);
    renderDrillContent(cc);
    renderDrillForwardTable(cc);
  }

  function renderDrillKpis(cc) {
    var cs = PF.snap.countries[cc];
    var unit = cs.currency + '/MWh';
    var y1 = tenorRow(cs, 'Y+1');
    var y2 = tenorRow(cs, 'Y+2');
    var stats = [
      { l: 'Spot', v: num(cs.spot && cs.spot.value, 2), u: unit },
      { l: 'Forward ' + (y1 ? y1.contract : 'Y+1'), v: num(y1 && y1.value, 2), u: unit },
      { l: 'Forward ' + (y2 ? y2.contract : 'Y+2'), v: num(y2 && y2.value, 2), u: unit }
    ];
    if (cs.nuclearCapacity) {
      stats.push({ l: 'Nucléaire dispo', v: num(cs.nuclearCapacity.actualMW, 0), u: 'MW' });
      stats.push({ l: 'Nucléaire prévisionnel', v: num(cs.nuclearCapacity.forecastMW, 0), u: 'MW' });
    }
    if (typeof window.setStats === 'function') window.setStats('pf-drill-kpi-strip', stats);
  }

  function renderDrillTabs(cc) {
    var host = document.getElementById('pf-drill-tabs');
    if (!host) return;
    var cs = PF.snap.countries[cc];
    var tabs = DRILL_TABS.filter(function (t) { return t.key !== 'nuc' || cs.nuclearCapacity; });
    if (tabs.indexOf(PF.drillTab) === -1 && !tabs.some(function (t) { return t.key === PF.drillTab; })) PF.drillTab = 'calall';
    host.innerHTML = tabs.map(function (t) {
      var active = t.key === PF.drillTab;
      return '<button onclick="window._pfSetDrillTab(\'' + t.key + '\')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:' +
        (active ? 'var(--bg3)' : 'transparent') + ';color:' + (active ? 'var(--tx)' : 'var(--tx3)') +
        ';font-family:\'Inter\',sans-serif;font-weight:500;letter-spacing:.03em">' + t.label + '</button>';
    }).join('');
  }

  function drillChartBox(id, height) {
    return '<div style="position:relative;height:' + (height || 280) + 'px"><canvas id="' + id + '"></canvas></div>';
  }

  function renderDrillContent(cc) {
    var host = document.getElementById('pf-drill-content');
    if (!host) return;
    var cs = PF.snap.countries[cc];

    if (PF.drillTab === 'calall') {
      host.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:6px">' +
        '<button class="pk-btn-ghost" onclick="(function(){var c=HIST.charts[\'pf-drill-chart-calall\'];if(c&&c.resetZoom)c.resetZoom();})()">↺ Reset</button></div>' +
        drillChartBox('pf-drill-chart-calall');
      renderCalAllChart(cc);
      return;
    }

    if (PF.drillTab === 'cal1') {
      host.innerHTML = '<div class="hist-window-btns" id="pf-drill-caloffset-btns"></div>' +
        '<div style="display:flex;justify-content:flex-end;margin:6px 0">' +
        '<button class="pk-btn-ghost" onclick="(function(){var c=HIST.charts[\'pf-drill-chart-cal1\'];if(c&&c.resetZoom)c.resetZoom();})()">↺ Reset</button></div>' +
        drillChartBox('pf-drill-chart-cal1');
      renderDrillCalOffsetButtons();
      renderCalRollingChart(cc);
      return;
    }

    if (PF.drillTab === 'free') {
      host.innerHTML = '<div class="hist-window-btns" id="pf-drill-tenor-btns"></div>' +
        '<div class="hist-window-btns" id="pf-drill-window-btns" style="margin-top:6px"></div>' +
        '<div style="display:flex;justify-content:flex-end;margin:6px 0">' +
        '<button class="pk-btn-ghost" onclick="(function(){var c=HIST.charts[\'pf-drill-chart-free\'];if(c&&c.resetZoom)c.resetZoom();})()">↺ Reset</button></div>' +
        drillChartBox('pf-drill-chart-free');
      renderDrillTenorButtons();
      renderDrillWindowButtons();
      renderFreeChart(cc);
      return;
    }

    if (PF.drillTab === 'nuc') {
      host.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:6px">' +
        '<button class="pk-btn-ghost" onclick="(function(){var c=HIST.charts[\'pf-drill-chart-nuc\'];if(c&&c.resetZoom)c.resetZoom();})()">↺ Reset</button></div>' +
        drillChartBox('pf-drill-chart-nuc', 260);
      renderNucChart(cc);
      return;
    }
  }

  // Forward tenor table — always shown below the chart tabs, regardless of
  // which one is active (same layout as the DA drill-down: chart, then its
  // breakdown table underneath). Rendered once on open since it doesn't
  // depend on PF.drillTab.
  function renderDrillForwardTable(cc) {
    var host = document.getElementById('pf-drill-forward-table');
    if (!host) return;
    var cs = PF.snap.countries[cc];
    var unit = cs.currency + '/MWh';
    var rows = FORWARD_TENORS.map(function (t) {
      var row = tenorRow(cs, t);
      if (!row) return '<tr><td>' + t + '</td><td colspan="4" style="text-align:left;color:var(--text3)">indisponible</td></tr>';
      return '<tr>' +
        '<td>' + t + '</td>' +
        '<td style="text-align:left;font-family:\'Inter\',sans-serif">' + row.contract + '</td>' +
        '<td>' + num(row.value, 2) + ' ' + unit + '</td>' +
        '<td>' + deltaCell(row.varD1Pct) + '</td>' +
        '<td>' + deltaCell(row.varW1Pct) + '</td>' +
        '</tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap">' +
      '<div class="table-header"><span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:600;color:var(--text2);letter-spacing:.06em;text-transform:uppercase">Tableau forward · tous les tenors</span></div>' +
      '<table style="font-size:11px">' +
      '<thead><tr><th style="text-align:left">PRODUIT</th><th style="text-align:left">CONTRAT</th>' +
      '<th style="text-align:right">VALEUR (J-1)</th><th style="text-align:right">VAR J-1</th><th style="text-align:right">VAR S-1</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function renderDrillCalOffsetButtons() {
    var host = document.getElementById('pf-drill-caloffset-btns');
    if (!host) return;
    host.innerHTML = [1, 2, 3].map(function (o) {
      return '<button class="hw-btn' + (o === PF.drillCalOffset ? ' active' : '') + '" onclick="window._pfSetDrillCalOffset(' + o + ')">Cal+' + o + '</button>';
    }).join('');
  }

  function renderDrillTenorButtons() {
    var host = document.getElementById('pf-drill-tenor-btns');
    if (!host) return;
    host.innerHTML = FORWARD_TENORS.map(function (t) {
      return '<button class="hw-btn' + (t === PF.drillTenor ? ' active' : '') + '" onclick="window._pfSetDrillTenor(\'' + t + '\')">' + t + '</button>';
    }).join('');
  }

  function renderDrillWindowButtons() {
    var host = document.getElementById('pf-drill-window-btns');
    if (!host) return;
    var wins = [['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['3Y', '3Y'], ['5Y', '5Y'], ['all', 'All']];
    host.innerHTML = wins.map(function (w) {
      return '<button class="hw-btn' + (w[0] === PF.drillWindow ? ' active' : '') + '" onclick="window._pfSetDrillWindow(\'' + w[0] + '\')">' + w[1] + '</button>';
    }).join('');
  }

  // Chart A (drill) : tous les contrats Cal, une ligne par année.
  function renderCalAllChart(cc) {
    var meta = countryMeta(cc);
    var cs = PF.snap.countries[cc];
    var chain = PF.calchain && PF.calchain[cc];
    var years = (chain && chain.years) || {};
    var yearKeys = Object.keys(years).sort();
    var allDatesSet = {};
    yearKeys.forEach(function (yr) { years[yr].dates.forEach(function (d) { allDatesSet[d] = true; }); });
    var allDates = Object.keys(allDatesSet).sort();
    var dateIdx = {};
    allDates.forEach(function (d, i) { dateIdx[d] = i; });
    var datasets = yearKeys.map(function (yr, i) {
      var arr = new Array(allDates.length).fill(null);
      years[yr].dates.forEach(function (d, j) { arr[dateIdx[d]] = years[yr].values[j]; });
      return { label: 'Cal' + yr, data: arr, borderColor: PALETTE[i % PALETTE.length], borderWidth: 1.5,
        pointRadius: 0, tension: 0, fill: false, spanGaps: true };
    });
    window.mkHistChart('pf-drill-chart-calall', {
      type: 'line',
      data: { labels: allDates, datasets: datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: '#B8C9D9', font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 12 } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12, autoSkip: true } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
               title: { display: true, text: cs.currency + '/MWh', color: '#7A93AB', font: { size: 10 } } }
        }
      }
    });
    if (typeof addFullscreen === 'function') addFullscreen('pf-drill-chart-calall');
  }

  // Chart B (drill) : Cal+N glissant, courbe continue.
  function renderCalRollingChart(cc) {
    var meta = countryMeta(cc);
    var chain = PF.calchain && PF.calchain[cc];
    var label = 'Cal+' + PF.drillCalOffset;
    var rolling = (chain && chain.rolling && chain.rolling[label]) || { dates: [], values: [] };
    window.mkHistChart('pf-drill-chart-cal1', {
      type: 'line',
      data: { labels: rolling.dates, datasets: [{ label: label, data: rolling.values, borderColor: meta.colour, borderWidth: 1.5,
        pointRadius: 0, tension: 0, fill: false, spanGaps: false }] },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12, autoSkip: true } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
               title: { display: true, text: '€/MWh', color: '#7A93AB', font: { size: 10 } } }
        }
      }
    });
    if (typeof addFullscreen === 'function') addFullscreen('pf-drill-chart-cal1');
  }

  // Chart C (drill) : graph libre, produits choisis sur la période choisie.
  function renderFreeChart(cc) {
    var countrySeries = (PF.series.countries && PF.series.countries[cc]) || {};
    var allDates = PF.series.dates || [];
    var cut = windowCutoffDates(allDates, PF.drillWindow);
    var startIdx = cut.length ? allDates.indexOf(cut[0]) : 0;
    if (startIdx < 0) startIdx = 0;
    var dates = allDates.slice(startIdx);
    var fwd = countrySeries.forwardCurve || {};
    var vals = (fwd[PF.drillTenor] || []).slice(startIdx);
    window.mkHistChart('pf-drill-chart-free', {
      type: 'line',
      data: { labels: dates, datasets: [{ label: PF.drillTenor, data: vals, borderColor: countryMeta(cc).colour, borderWidth: 1.5,
        pointRadius: 0, tension: 0, fill: false, spanGaps: true }] },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12, autoSkip: true } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
               title: { display: true, text: '€/MWh', color: '#7A93AB', font: { size: 10 } } }
        }
      }
    });
    if (typeof addFullscreen === 'function') addFullscreen('pf-drill-chart-free');
  }

  // Chart D (drill) : nucléaire réel vs prévisionnel (FR seulement).
  function renderNucChart(cc) {
    var countrySeries = (PF.series.countries && PF.series.countries[cc]) || {};
    var allDates = PF.series.dates || [];
    var cut = windowCutoffDates(allDates, '1Y');
    var startIdx = cut.length ? allDates.indexOf(cut[0]) : 0;
    if (startIdx < 0) startIdx = 0;
    var dates = allDates.slice(startIdx);
    var nuc = countrySeries.nuclearCapacity || {};
    var actual = (nuc.actual || []).slice(startIdx);
    var forecast = (nuc.forecast || []).slice(startIdx);
    window.mkHistChart('pf-drill-chart-nuc', {
      type: 'line',
      data: {
        labels: dates,
        datasets: [
          { label: 'Réel', data: actual, borderColor: '#7B4B9C', borderWidth: 1.5, pointRadius: 0, tension: 0, fill: false, spanGaps: true },
          { label: 'Prévisionnel', data: forecast, borderColor: '#EE9B00', borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, tension: 0, fill: false, spanGaps: true }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: '#B8C9D9', font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 12 } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12, autoSkip: true } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
               title: { display: true, text: 'MW', color: '#7A93AB', font: { size: 10 } } }
        }
      }
    });
    if (typeof addFullscreen === 'function') addFullscreen('pf-drill-chart-nuc');
  }

  // ══════════════════════════════════════════════════════════════════════
  // COMPARAISON PAYS · un produit, les 4 zones sur le même graph + table
  // ══════════════════════════════════════════════════════════════════════

  function renderCompareTenorButtons() {
    var host = document.getElementById('prfwd-cmp-tenor-btns');
    if (!host) return;
    host.innerHTML = FORWARD_TENORS.map(function (t) {
      return '<button class="hw-btn' + (t === PF.cmpTenor ? ' active' : '') + '" onclick="window._pfSetCmpTenor(\'' + t + '\')">' + t + '</button>';
    }).join('');
  }

  function renderCompareWindowButtons() {
    var host = document.getElementById('prfwd-cmp-window-btns');
    if (!host) return;
    var wins = [['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['3Y', '3Y'], ['5Y', '5Y'], ['all', 'All']];
    host.innerHTML = wins.map(function (w) {
      return '<button class="hw-btn' + (w[0] === PF.cmpWindow ? ' active' : '') + '" onclick="window._pfSetCmpWindow(\'' + w[0] + '\')">' + w[1] + '</button>';
    }).join('');
  }

  function renderCompareChart() {
    var allDates = PF.series.dates || [];
    var cut = windowCutoffDates(allDates, PF.cmpWindow);
    var startIdx = cut.length ? allDates.indexOf(cut[0]) : 0;
    if (startIdx < 0) startIdx = 0;
    var dates = allDates.slice(startIdx);
    var datasets = COUNTRIES.map(function (c) {
      var cs = (PF.series.countries && PF.series.countries[c.code]) || {};
      var vals = ((cs.forwardCurve && cs.forwardCurve[PF.cmpTenor]) || []).slice(startIdx);
      return { label: c.flag + ' ' + c.label, data: vals, borderColor: c.colour, borderWidth: 1.5,
        pointRadius: 0, tension: 0, fill: false, spanGaps: true };
    });
    window.mkHistChart('prfwd-chart-compare', {
      type: 'line',
      data: { labels: dates, datasets: datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: '#B8C9D9', font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 12 } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12, autoSkip: true } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
               title: { display: true, text: '€ or £ /MWh', color: '#7A93AB', font: { size: 10 } } }
        }
      }
    });
    if (typeof addFullscreen === 'function') addFullscreen('prfwd-chart-compare');
  }

  function renderCompareTable() {
    var titleEl = document.getElementById('prfwd-cmp-table-title');
    if (titleEl) titleEl.textContent = 'Snapshot du jour · ' + PF.cmpTenor;
    var tbody = document.getElementById('prfwd-cmp-tbody');
    if (!tbody) return;
    tbody.innerHTML = COUNTRIES.map(function (c) {
      var cs = PF.snap.countries[c.code];
      var row = tenorRow(cs, PF.cmpTenor);
      if (!row) return '<tr><td style="text-align:left">' + c.flag + ' ' + c.label + '</td><td colspan="4" style="text-align:left;color:var(--text3)">indisponible</td></tr>';
      return '<tr>' +
        '<td style="text-align:left;font-family:\'Inter\',sans-serif">' + c.flag + ' ' + c.label + '</td>' +
        '<td style="text-align:left;font-family:\'Inter\',sans-serif">' + row.contract + '</td>' +
        '<td>' + num(row.value, 2) + ' ' + cs.currency + '/MWh</td>' +
        '<td>' + deltaCell(row.varD1Pct) + '</td>' +
        '<td>' + deltaCell(row.varW1Pct) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderInsights() {
    var snap = PF.snap;
    var dateEl = document.getElementById('prfwd-insights-date');
    var textEl = document.getElementById('prfwd-insights-text');
    if (dateEl) dateEl.textContent = 'SEFE Energy · ' + (snap.marketInsightsDate || '');
    if (textEl) textEl.innerHTML = snap.marketInsightsHtml || '<em style="color:var(--text3)">Analyse indisponible pour le moment.</em>';
  }

  // ══════════════════════════════════════════════════════════════════════
  // ORCHESTRATION
  // ══════════════════════════════════════════════════════════════════════

  function renderAll() {
    if (!PF.snap || !PF.series) return;
    var boardMeta = document.getElementById('prfwd-board-meta');
    if (boardMeta) boardMeta.textContent = 'M+1 à Y+3 · ' + (PF.snap.forwardCurveDate || '') + ' · source SEFE cockpit';
    renderTopKpis();
    renderCountriesTable();
    renderCompareTenorButtons();
    renderCompareWindowButtons();
    renderCompareChart();
    renderCompareTable();
    renderInsights();
  }

  function renderPrFwd() {
    if (PF.loaded) { renderAll(); return; }
    Promise.all([loadFrMarket(), loadFrMarketSeries(), loadCalChain()]).then(function (res) {
      PF.snap = res[0];
      PF.series = res[1];
      PF.calchain = res[2];
      if (!PF.snap || !PF.series) {
        var host = document.getElementById('prfwd-insights-text');
        if (host) host.innerHTML = '<em style="color:var(--text3)">data/fr_market.json indisponible.</em>';
        return;
      }
      PF.loaded = true;
      renderAll();
    });
  }

  window.renderPrFwd = renderPrFwd;
  window._pfToggleRow = toggleCountryRow;
  window._pfCloseRow = closeCountryRow;
  window._pfSetDrillTab = function (tab) { PF.drillTab = tab; renderDrillTabs(PF.openCountry); renderDrillContent(PF.openCountry); };
  window._pfSetDrillCalOffset = function (o) { PF.drillCalOffset = o; renderDrillCalOffsetButtons(); renderCalRollingChart(PF.openCountry); };
  window._pfSetDrillTenor = function (t) { PF.drillTenor = t; renderDrillTenorButtons(); renderFreeChart(PF.openCountry); };
  window._pfSetDrillWindow = function (w) { PF.drillWindow = w; renderDrillWindowButtons(); renderFreeChart(PF.openCountry); };
  window._pfSetCmpTenor = function (t) { PF.cmpTenor = t; renderCompareTenorButtons(); renderCompareChart(); renderCompareTable(); };
  window._pfSetCmpWindow = function (w) { PF.cmpWindow = w; renderCompareWindowButtons(); renderCompareChart(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoFillOverviewCard);
  } else {
    autoFillOverviewCard();
  }
})();
