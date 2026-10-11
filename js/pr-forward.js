// ════════════════════════════════════════════════════════════════════════════
// PowerKlock · PRICES > FORWARD (power forward curve, FR/UK/DE/NL)
// ────────────────────────────────────────────────────────────────────────────
// Source : data/fr_market.json + data/history/fr_market_series.json
//          + data/history/fr_market_calchain.json
// (scripts/fetch_fr_market.py — SEFE Energy public cockpit, daily cron)
// Encapsulé en IIFE : seules window.renderPrFwd et les window._prFwdSet* fuient.
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
  // Cycled across multi-line charts (Tous les Cal, Graph libre) — distinct, readable on dark bg.
  var PALETTE = ['#14D3A9', '#EE9B00', '#3FA6B4', '#A87DC4', '#ED6965', '#FBBF24', '#7B4B9C', '#94D2BD'];

  var PRFWD = {
    country: 'FR',
    tenors: ['Y+1'],     // multi-select, for the "Graph libre" chart
    window: '1Y',
    calOffset: 1,        // Cal+1 / Cal+2 / Cal+3 for the rolling chart
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

  // ── Overview card KPI (runs independently, as soon as the page loads) ──
  function autoFillOverviewCard() {
    loadFrMarket().then(function (snap) {
      if (!snap) return;
      var y1 = (snap.forwardCurve || []).filter(function (r) { return r.tenor === 'Y+1'; })[0];
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

  function countryMeta(code) {
    return COUNTRIES.filter(function (c) { return c.code === code; })[0] || COUNTRIES[0];
  }

  function renderCountryButtons() {
    var host = document.getElementById('prfwd-country-btns');
    if (!host) return;
    host.innerHTML = COUNTRIES.map(function (c) {
      return '<button class="hw-btn' + (c.code === PRFWD.country ? ' active' : '') + '" onclick="window._prFwdSetCountry(\'' + c.code + '\')">' + c.flag + ' ' + c.label + '</button>';
    }).join('');
  }

  function renderKpiStrip(countrySnap) {
    var unit = countrySnap.currency + '/MWh';
    var y1 = (countrySnap.forwardCurve || []).filter(function (r) { return r.tenor === 'Y+1'; })[0];
    var y2 = (countrySnap.forwardCurve || []).filter(function (r) { return r.tenor === 'Y+2'; })[0];
    var stats = [
      { l: 'Spot', v: num(countrySnap.spot && countrySnap.spot.value, 2), u: unit },
      { l: 'Forward ' + (y1 ? y1.contract : 'Y+1'), v: num(y1 && y1.value, 2), u: unit },
      { l: 'Forward ' + (y2 ? y2.contract : 'Y+2'), v: num(y2 && y2.value, 2), u: unit }
    ];
    if (countrySnap.nuclearCapacity) {
      stats.push({ l: 'Nucléaire dispo', v: num(countrySnap.nuclearCapacity.actualMW, 0), u: 'MW' });
      stats.push({ l: 'Nucléaire prévisionnel', v: num(countrySnap.nuclearCapacity.forecastMW, 0), u: 'MW' });
    }
    if (typeof window.setStats === 'function') window.setStats('prfwd-kpi-strip', stats);
  }

  function renderInsights(snap) {
    var dateEl = document.getElementById('prfwd-insights-date');
    var textEl = document.getElementById('prfwd-insights-text');
    if (dateEl) dateEl.textContent = 'SEFE Energy · ' + (snap.marketInsightsDate || '');
    if (textEl) textEl.innerHTML = snap.marketInsightsHtml || '<em style="color:var(--text3)">Analyse indisponible pour le moment.</em>';
  }

  // Multi-select toggle buttons for the "Graph libre" product picker.
  function renderTenorButtons() {
    var host = document.getElementById('prfwd-tenor-btns');
    if (!host) return;
    host.innerHTML = FORWARD_TENORS.map(function (t) {
      var active = PRFWD.tenors.indexOf(t) !== -1;
      return '<button class="hw-btn' + (active ? ' active' : '') + '" onclick="window._prFwdToggleTenor(\'' + t + '\')">' + t + '</button>';
    }).join('');
  }

  function renderWindowButtons() {
    var host = document.getElementById('prfwd-window-btns');
    if (!host) return;
    var wins = [['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['3Y', '3Y'], ['5Y', '5Y'], ['all', 'All']];
    host.innerHTML = wins.map(function (w) {
      return '<button class="hw-btn' + (w[0] === PRFWD.window ? ' active' : '') + '" onclick="window._prFwdSetWindow(\'' + w[0] + '\')">' + w[1] + '</button>';
    }).join('');
  }

  function renderCalOffsetButtons() {
    var host = document.getElementById('prfwd-caloffset-btns');
    if (!host) return;
    host.innerHTML = [1, 2, 3].map(function (o) {
      return '<button class="hw-btn' + (o === PRFWD.calOffset ? ' active' : '') + '" onclick="window._prFwdSetCalOffset(' + o + ')">Cal+' + o + '</button>';
    }).join('');
  }

  // Signed delta cell: ▲/▼/● coloured like the rest of the site (priceContext:
  // a rising forward price is "bad" for a buyer, so up = red, down = green).
  function deltaCell(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) {
      return '<span style="color:var(--text3)">–</span>';
    }
    var arrow = pct > 0 ? '▲' : (pct < 0 ? '▼' : '●');
    var colour = pct > 0 ? 'var(--down)' : (pct < 0 ? 'var(--up)' : 'var(--text3)');
    var sign = pct > 0 ? '+' : '';
    return '<span style="color:' + colour + '">' + arrow + ' ' + sign + num(pct, 2) + '%</span>';
  }

  // Same table for every country — mirrors the SEFE report's own forward table
  // (product / contract / D-1 value / D-1 var% / W-1 var%).
  function renderCurveTable(countrySnap) {
    var host = document.getElementById('prfwd-curve-tbody');
    if (!host) return;
    var unit = countrySnap.currency + '/MWh';
    host.innerHTML = FORWARD_TENORS.map(function (t) {
      var row = (countrySnap.forwardCurve || []).filter(function (r) { return r.tenor === t; })[0];
      if (!row) {
        return '<tr><td>' + t + '</td><td colspan="4" style="text-align:left;color:var(--text3)">indisponible</td></tr>';
      }
      return '<tr>' +
        '<td>' + t + '</td>' +
        '<td style="text-align:left;font-family:\'Inter\',sans-serif">' + row.contract + '</td>' +
        '<td>' + num(row.value, 2) + ' ' + unit + '</td>' +
        '<td>' + deltaCell(row.varD1Pct) + '</td>' +
        '<td>' + deltaCell(row.varW1Pct) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ── Chart A : tous les contrats Cal, une ligne par année, vie complète de chaque contrat ──
  function renderCalAllChart(countryChain, meta) {
    var years = (countryChain && countryChain.years) || {};
    var yearKeys = Object.keys(years).sort();
    var subEl = document.getElementById('prfwd-calall-sub');
    if (subEl) {
      subEl.textContent = yearKeys.length
        ? 'Cal ' + yearKeys.join(', ') + ' · un contrat Cal = une ligne, vie complète de chaque contrat'
        : 'Aucun contrat Cal disponible pour cette zone';
    }
    // Union of all dates across years, so every line shares the same x-axis.
    var allDatesSet = {};
    yearKeys.forEach(function (yr) { years[yr].dates.forEach(function (d) { allDatesSet[d] = true; }); });
    var allDates = Object.keys(allDatesSet).sort();
    var dateIdx = {};
    allDates.forEach(function (d, i) { dateIdx[d] = i; });

    var datasets = yearKeys.map(function (yr, i) {
      var arr = new Array(allDates.length).fill(null);
      years[yr].dates.forEach(function (d, j) { arr[dateIdx[d]] = years[yr].values[j]; });
      var colour = PALETTE[i % PALETTE.length];
      return { label: 'Cal' + yr, data: arr, borderColor: colour, borderWidth: 1.5,
        pointRadius: 0, tension: 0.1, fill: false, spanGaps: true };
    });

    window.mkHistChart('prfwd-chart-calall', {
      type: 'line',
      data: { labels: allDates, datasets: datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: '#B8C9D9', font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 12 } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' },
               ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12, autoSkip: true } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' },
               ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
               title: { display: true, text: meta.currency ? meta.currency + '/MWh' : '€/MWh', color: '#7A93AB', font: { size: 10 } } }
        }
      }
    });
  }

  // ── Chart B : Cal+N glissant, une seule courbe continue, rebranchée à chaque bascule d'année ──
  function renderCalRollingChart(countryChain, meta) {
    var label = 'Cal+' + PRFWD.calOffset;
    var rolling = (countryChain && countryChain.rolling && countryChain.rolling[label]) || { dates: [], values: [] };
    window.mkHistChart('prfwd-chart-cal1', {
      type: 'line',
      data: {
        labels: rolling.dates,
        datasets: [{ label: label, data: rolling.values, borderColor: meta.colour, borderWidth: 1.5,
          pointRadius: 0, tension: 0.1, fill: false, spanGaps: false }]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' },
               ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12, autoSkip: true } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' },
               ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
               title: { display: true, text: '€/MWh', color: '#7A93AB', font: { size: 10 } } }
        }
      }
    });
  }

  // ── Chart C : graph libre, produits choisis par l'utilisateur sur la période choisie ──
  function renderFreeChart(countrySeries, startIdx, dates) {
    var subEl = document.getElementById('prfwd-hist-sub');
    var fwd = countrySeries.forwardCurve || {};
    var datasets = PRFWD.tenors.map(function (t, i) {
      var vals = (fwd[t] || []).slice(startIdx);
      var colour = PALETTE[i % PALETTE.length];
      return { label: t, data: vals, borderColor: colour, borderWidth: 1.5,
        pointRadius: 0, tension: 0.1, fill: false, spanGaps: true };
    });
    window.mkHistChart('prfwd-chart-hist', {
      type: 'line',
      data: { labels: dates, datasets: datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: '#B8C9D9', font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 12 } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' },
               ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12, autoSkip: true } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' },
               ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
               title: { display: true, text: '€/MWh', color: '#7A93AB', font: { size: 10 } } }
        }
      }
    });
  }

  function renderNucChart(countrySeries, startIdx, dates) {
    var nucActual = ((countrySeries.nuclearCapacity && countrySeries.nuclearCapacity.actual) || []).slice(startIdx);
    var nucForecast = ((countrySeries.nuclearCapacity && countrySeries.nuclearCapacity.forecast) || []).slice(startIdx);
    window.mkHistChart('prfwd-chart-nuc', {
      type: 'line',
      data: {
        labels: dates,
        datasets: [
          { label: 'Réel', data: nucActual, borderColor: '#7B4B9C', borderWidth: 1.5, pointRadius: 0, tension: 0.1, fill: false, spanGaps: true },
          { label: 'Prévisionnel', data: nucForecast, borderColor: '#EE9B00', borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, tension: 0.1, fill: false, spanGaps: true }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: '#B8C9D9', font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 12 } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' },
               ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12, autoSkip: true } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' },
               ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
               title: { display: true, text: 'MW', color: '#7A93AB', font: { size: 10 } } }
        }
      }
    });
  }

  function renderWindowed() {
    if (!PRFWD.series) return;
    var countrySeries = (PRFWD.series.countries && PRFWD.series.countries[PRFWD.country]) || {};
    var meta = countryMeta(PRFWD.country);
    var allDates = PRFWD.series.dates || [];
    var cut = windowCutoffDates(allDates, PRFWD.window);
    var startIdx = cut.length ? allDates.indexOf(cut[0]) : 0;
    if (startIdx < 0) startIdx = 0;
    var dates = allDates.slice(startIdx);

    renderFreeChart(countrySeries, startIdx, dates);

    var nucSection = document.getElementById('hs-prfwd-nuc');
    if (nucSection) nucSection.style.display = countrySeries.nuclearCapacity ? '' : 'none';
    if (countrySeries.nuclearCapacity) renderNucChart(countrySeries, startIdx, dates);
  }

  function renderCalCharts() {
    if (!PRFWD.calchain) return;
    var meta = countryMeta(PRFWD.country);
    var countrySnap = PRFWD.snap && PRFWD.snap.countries[PRFWD.country];
    var metaWithCurrency = { colour: meta.colour, currency: countrySnap && countrySnap.currency };
    var countryChain = PRFWD.calchain[PRFWD.country];
    renderCalAllChart(countryChain, metaWithCurrency);
    renderCalRollingChart(countryChain, meta);
  }

  function renderAll() {
    if (!PRFWD.snap || !PRFWD.series) return;
    var countrySnap = PRFWD.snap.countries[PRFWD.country];
    renderCountryButtons();
    renderKpiStrip(countrySnap);
    renderInsights(PRFWD.snap);
    renderTenorButtons();
    renderWindowButtons();
    renderCalOffsetButtons();
    renderCurveTable(countrySnap);
    renderWindowed();
    renderCalCharts();
  }

  function renderPrFwd() {
    if (PRFWD.loaded) { renderAll(); return; }
    Promise.all([loadFrMarket(), loadFrMarketSeries(), loadCalChain()]).then(function (res) {
      PRFWD.snap = res[0];
      PRFWD.series = res[1];
      PRFWD.calchain = res[2];
      if (!PRFWD.snap || !PRFWD.series) {
        var host = document.getElementById('prfwd-insights-text');
        if (host) host.innerHTML = '<em style="color:var(--text3)">data/fr_market.json indisponible.</em>';
        return;
      }
      PRFWD.loaded = true;
      renderAll();
    });
  }

  window.renderPrFwd = renderPrFwd;
  window._prFwdToggleTenor = function (t) {
    var i = PRFWD.tenors.indexOf(t);
    if (i === -1) PRFWD.tenors.push(t);
    else if (PRFWD.tenors.length > 1) PRFWD.tenors.splice(i, 1); // keep at least one selected
    renderTenorButtons();
    renderWindowed();
  };
  window._prFwdSetWindow = function (w) { PRFWD.window = w; renderWindowButtons(); renderWindowed(); };
  window._prFwdSetCountry = function (cc) { PRFWD.country = cc; renderAll(); };
  window._prFwdSetCalOffset = function (o) { PRFWD.calOffset = o; renderCalOffsetButtons(); renderCalCharts(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoFillOverviewCard);
  } else {
    autoFillOverviewCard();
  }
})();
