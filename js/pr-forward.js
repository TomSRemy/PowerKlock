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
    { code: 'DE', label: 'Germany', flag: '🇩🇪', colour: '#EE9B00' },
    { code: 'NL', label: 'Netherlands', flag: '🇳🇱', colour: '#A87DC4' }
  ];
  var PALETTE = ['#14D3A9', '#EE9B00', '#3FA6B4', '#A87DC4', '#ED6965', '#FBBF24', '#7B4B9C', '#94D2BD'];

  var PF = {
    openCountry: null,
    drillTab: 'curve',         // curve | free | calall
    drillTenor: 'Y+1',         // for the "Graph libre" drill tab
    drillWindow: '1Y',         // period for every drill chart
    drillFrom: '',             // custom range (overrides drillWindow when set)
    drillTo: '',
    cmpTenor: 'Y+1',
    cmpWindow: '1Y',
    cmpZones: null,            // Set of active country codes, null = all
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

  // [start, end) indexes of `dates` (sorted ISO) inside the drill window:
  // the custom From/To range when set, else the period button.
  function drillRange(dates) {
    if (!dates.length) return [0, 0];
    var from = PF.drillFrom, to = PF.drillTo || '9999-12-31';
    if (!from) { var cut = windowCutoffDates(dates, PF.drillWindow); from = cut.length ? cut[0] : dates[0]; }
    var a = 0; while (a < dates.length && dates[a] < from) a++;
    var b = dates.length; while (b > a && dates[b - 1] > to) b--;
    return [a, b];
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
  // Curve = term structure today vs 1 week / 1 month ago; History = one
  // tenor over time (Y+1 is the rolling Cal+1); Contracts = each Cal contract.
  var DRILL_TABS = [
    { key: 'curve', label: 'Curve' },
    { key: 'free', label: 'History' },
    { key: 'calall', label: 'Contracts' }
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
      '<div class="pk-eyebrow">Forward <span class="pk-sep">·</span> ' + meta.flag + ' ' + meta.label + ' <span class="pk-sep">·</span> Detail</div>' +
      '<div class="pk-section-title">' + meta.label + '</div>' +
      '<div class="pk-section-subtitle">snapshot ' + (cs.spot && cs.spot.date || '') + '</div>' +
      '</div>' +
      '<div class="pk-section-header-actions"><button class="pk-btn-ghost" onclick="event.stopPropagation();window._pfCloseRow()">✕ Close</button></div>' +
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
    var y3 = tenorRow(cs, 'Y+3'), m1 = tenorRow(cs, 'M+1');
    if (y1 && y3 && y1.value != null && y3.value != null) stats.push({ l: 'Curve slope Y+3 − Y+1', v: (y3.value - y1.value >= 0 ? '+' : '') + num(y3.value - y1.value, 2), u: unit });
    if (m1 && y1 && m1.value != null && y1.value != null) stats.push({ l: 'M+1 − Y+1', v: (m1.value - y1.value >= 0 ? '+' : '') + num(m1.value - y1.value, 2), u: unit });
    if (typeof window.setStats === 'function') window.setStats('pf-drill-kpi-strip', stats);
  }

  function renderDrillTabs(cc) {
    var host = document.getElementById('pf-drill-tabs');
    if (!host) return;
    var cs = PF.snap.countries[cc];
    var tabs = DRILL_TABS;
    if (!tabs.some(function (t) { return t.key === PF.drillTab; })) PF.drillTab = 'curve';
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

  // Period buttons + From/To + reset zoom, shared by every drill tab.
  function windowBar(tab) {
    return '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:6px 0">' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">' +
        '<div class="hist-window-btns" id="pf-drill-window-btns" style="margin:0"></div>' +
        '<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--text3);font-family:\'JetBrains Mono\',monospace">From' +
          '<input type="date" id="pf-drill-from" value="' + PF.drillFrom + '" onchange="window._pfSetDrillRange()" style="background:var(--bg);border:1px solid var(--bd);color:var(--text);font-size:11px;padding:2px 6px;border-radius:4px;color-scheme:dark">' +
          'To<input type="date" id="pf-drill-to" value="' + PF.drillTo + '" onchange="window._pfSetDrillRange()" style="background:var(--bg);border:1px solid var(--bd);color:var(--text);font-size:11px;padding:2px 6px;border-radius:4px;color-scheme:dark"></span>' +
      '</div>' +
      '<button class="pk-btn-ghost" onclick="(function(){var c=Chart.getChart(document.getElementById(\'pf-drill-chart-' + tab + '\'));if(c&&c.resetZoom)c.resetZoom();})()">↺ Reset</button></div>';
  }

  function renderDrillContent(cc) {
    var host = document.getElementById('pf-drill-content');
    if (!host) return;
    if (PF.drillTab === 'curve') {
      // today's curve against a week and a month ago, or against any date the reader picks
      host.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:11px;color:var(--text3);font-family:\'JetBrains Mono\',monospace">Compare with <input type="date" id="pf-curve-vs" value="' + (PF.curveVs || '') + '" onchange="window._pfSetCurveVs(this.value)" style="background:var(--bg);border:1px solid var(--bd);color:var(--text);font-size:11px;padding:2px 6px;border-radius:4px;color-scheme:dark">' +
        (PF.curveVs ? '<button class="pk-btn-ghost" onclick="window._pfSetCurveVs(\'\')">1 week / 1 month ago</button>' : '') + '</div>' + drillChartBox('pf-drill-chart-curve');
      PKW.draw('pf-curve', 'pf-drill-chart-curve', { country: cc, vs: PF.curveVs || '' }).then(function () { addFullscreen('pf-drill-chart-curve'); addDownload('pf-drill-chart-curve', 'pf-drill-chart-curve'); });
      return;
    }
    if (PF.drillTab === 'calall') {
      // every contract family on one tab: years, quarters, months, seasons (one line per contract still to deliver)
      var cell = function (id, title) {
        return '<div class="chart-container fuel-card" style="margin:0;min-width:0"><div class="fuel-card-head"><div><div class="table-title">' + title + '</div><div class="fuel-card-sub" id="' + id + '-sub"></div></div></div>' + drillChartBox(id, 260) + '</div>';
      };
      host.innerHTML = windowBar('calall') + '<div class="fuel-grid-2" style="gap:12px">' +
        cell('pf-drill-chart-calall', 'Calendar years') + cell('pf-drill-chart-q', 'Quarters') +
        cell('pf-drill-chart-m', 'Months') + cell('pf-drill-chart-s', 'Seasons') + '</div>';
      renderDrillWindowButtons();
      var w = { country: cc, win: PF.drillWindow, from: PF.drillFrom, to: PF.drillTo };
      [['pf-cals', 'pf-drill-chart-calall', {}], ['pf-contracts', 'pf-drill-chart-q', { kind: 'quarter' }],
        ['pf-contracts', 'pf-drill-chart-m', { kind: 'month' }], ['pf-contracts', 'pf-drill-chart-s', { kind: 'season' }]].forEach(function (c) {
        PKW.draw(c[0], c[1], Object.assign({}, w, c[2])).then(function (r) {
          var sub = document.getElementById(c[1] + '-sub'); if (sub && r && r.sub) sub.textContent = r.sub;
          addFullscreen(c[1]); addDownload(c[1], c[1]);
        });
      });
      return;
    }
    host.innerHTML = '<div class="hist-window-btns" id="pf-drill-tenor-btns"></div>' +
      windowBar('free') + drillChartBox('pf-drill-chart-free');
    renderDrillTenorButtons();
    renderDrillWindowButtons();
    PKW.draw('pf-history', 'pf-drill-chart-free', { country: cc, tenor: PF.drillTenor, win: PF.drillWindow, from: PF.drillFrom, to: PF.drillTo }).then(function () { addFullscreen('pf-drill-chart-free'); addDownload('pf-drill-chart-free', 'pf-drill-chart-free'); });
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
      if (!row) return '<tr><td>' + t + '</td><td colspan="4" style="text-align:left;color:var(--text3)">unavailable</td></tr>';
      return '<tr>' +
        '<td>' + t + '</td>' +
        '<td style="text-align:left;font-family:\'Inter\',sans-serif">' + row.contract + '</td>' +
        '<td>' + num(row.value, 2) + ' ' + unit + '</td>' +
        '<td>' + deltaCell(row.varD1Pct) + '</td>' +
        '<td>' + deltaCell(row.varW1Pct) + '</td>' +
        '</tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap">' +
      '<div class="table-header"><span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:600;color:var(--text2);letter-spacing:.06em;text-transform:uppercase">Forward table · all tenors</span></div>' +
      '<table style="font-size:11px">' +
      '<thead><tr><th style="text-align:left">PRODUCT</th><th style="text-align:left">CONTRACT</th>' +
      '<th style="text-align:right">VALUE (J-1)</th><th style="text-align:right">VAR J-1</th><th style="text-align:right">VAR 1W</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
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
      return '<button class="hw-btn' + (!PF.drillFrom && !PF.drillTo && w[0] === PF.drillWindow ? ' active' : '') + '" onclick="window._pfSetDrillWindow(\'' + w[0] + '\')">' + w[1] + '</button>';
    }).join('');
  }

  // ── Charts (pages + My Dashboard) ─────────────────────────────────
  var pfLoad = null;
  function pfData() {
    if (PF.loaded) return Promise.resolve(PF);
    if (!pfLoad) pfLoad = Promise.all([loadFrMarket(), loadFrMarketSeries(), loadCalChain()]).then(function (res) {
      PF.snap = res[0]; PF.series = res[1]; PF.calchain = res[2];
      if (!PF.snap || !PF.series) { pfLoad = null; throw new Error('data/fr_market.json unavailable'); }
      PF.loaded = true;
      return PF;
    });
    return pfLoad;
  }
  // Same windowing for pages and widgets: p.win ('3M'…'all') or p.from/p.to.
  function rangeOf(dates, p) {
    var keep = { w: PF.drillWindow, f: PF.drillFrom, t: PF.drillTo };
    PF.drillWindow = p.win || '1Y'; PF.drillFrom = p.from || ''; PF.drillTo = p.to || '';
    var r = drillRange(dates);
    PF.drillWindow = keep.w; PF.drillFrom = keep.f; PF.drillTo = keep.t;
    return r;
  }
  var AX = { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12, autoSkip: true } };
  function yAx(t) { return { grid: AX.grid, ticks: AX.ticks, title: { display: true, text: t, color: '#7A93AB', font: { size: 10 } } }; }
  function lineOpts(legend) {
    return { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: legend, position: 'bottom', labels: { color: '#B8C9D9', font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 12 } }, zoom: ZOOM_CFG } };
  }
  var COUNTRY_PARAM = { key: 'country', label: 'Market', inTitle: true, options: COUNTRIES.map(function (c) { return [c.code, c.label]; }) };
  var WIN_PARAM = { key: 'win', label: 'Period', options: [['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['3Y', '3Y'], ['5Y', '5Y'], ['all', 'All']] };
  var TENOR_PARAM = { key: 'tenor', label: 'Product', inTitle: true, options: FORWARD_TENORS.map(function (t) { return [t, t]; }) };
  function reg(def) {
    if (!window.PKW) return;
    PKW.register(Object.assign({ category: 'forwards', page: 'prices', source: 'Market data', size: { w: 6, h: 5 } }, def));
  }
  // Value of one tenor on the last series date ≤ iso.
  // (walks back over weekends / holidays to the last quoted day)
  function valueAt(fc, dates, iso) {
    for (var i = dates.length - 1; i >= 0; i--) { if (dates[i] <= iso && fc[i] != null) return { v: fc[i], d: dates[i] }; }
    return null;
  }

  reg({
    id: 'pf-curve', title: 'Power forward curve vs 1W / 1M ago', pageCanvas: 'pf-drill-chart-curve',
    desc: 'Baseload forward curve of one market at the latest settlement, a week and a month earlier, tenor by tenor.',
    params: [COUNTRY_PARAM], defaults: { country: 'FR', vs: '' },
    draw: function (cid, p) {
      return pfData().then(function () {
        var cs = (PF.series.countries && PF.series.countries[p.country]) || {}, fc = cs.forwardCurve || {}, dates = PF.series.dates || [];
        var snap = PF.snap.countries[p.country] || {}, cur = snap.currency || 'EUR';
        var last = dates[dates.length - 1];
        var back = function (n) { var d = new Date(last + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
        if (p.vs) {   // the curve today against the curve of a date chosen by the reader
          var labels2 = FORWARD_TENORS.slice(), asOf2 = {};
          var ds2 = [[last, 'Latest', countryMeta(p.country).colour, 2.4, []], [p.vs, p.vs, '#FBBF24', 2, [6, 4]]].map(function (s) {
            var vals = FORWARD_TENORS.map(function (t) { var r = valueAt(fc[t] || [], dates, s[0]); if (r) asOf2[s[0]] = r.d; return r ? r.v : null; });
            return { label: (s[1] === 'Latest' ? 'Latest' : 'On') + ' ' + (asOf2[s[0]] || s[0]), data: vals, borderColor: s[2], backgroundColor: s[2], borderWidth: s[3], borderDash: s[4], pointRadius: 3, tension: 0, fill: false, spanGaps: true };
          });
          var o2 = lineOpts(true);
          o2.scales = { x: { grid: AX.grid, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, autoSkip: false, maxRotation: 0 } }, y: yAx(cur + '/MWh') };
          mkChart(cid, { type: 'line', data: { labels: labels2, datasets: ds2 }, options: o2 });
          var y1 = FORWARD_TENORS.indexOf('Y+1'), a = ds2[0].data[y1], b = ds2[1].data[y1];
          return { sub: countryMeta(p.country).label + ' · tenor by tenor · ' + (asOf2[p.vs] || p.vs) + ' → ' + (asOf2[last] || last) + (a != null && b != null ? ' · Y+1 ' + (a - b >= 0 ? '+' : '') + num(a - b, 2) + ' ' + cur + '/MWh' : '') };
        }
        // Compared tenor by tenor (rolling products): today's contract in brackets.
        var labels = FORWARD_TENORS.map(function (t) { var r = tenorRow(snap, t); return r ? t + ' · ' + r.contract.replace(/^[A-Z]{2}\s+/, '').replace(/\s+base$/i, '') : t; });
        var series = [[0, 'Latest', countryMeta(p.country).colour, 2.4, []], [7, '1 week ago', '#B8C9D9', 1.4, [5, 4]], [30, '1 month ago', '#7A93AB', 1.2, [2, 3]]];
        var asOf = [];
        var ds = series.map(function (s) {
          var iso = s[0] ? back(s[0]) : last;
          var vals = FORWARD_TENORS.map(function (t) { var r = valueAt(fc[t] || [], dates, iso); if (r && !asOf[s[0]]) asOf[s[0]] = r.d; return r ? r.v : null; });
          return { label: s[1] + (asOf[s[0]] ? ' (' + asOf[s[0]] + ')' : ''), data: vals, borderColor: s[2], backgroundColor: s[2], borderWidth: s[3], borderDash: s[4], pointRadius: s[0] ? 0 : 3, tension: 0, fill: false, spanGaps: true };
        });
        var o = lineOpts(true);
        o.scales = { x: { grid: AX.grid, ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, autoSkip: false, maxRotation: 0 } }, y: yAx(cur + '/MWh') };
        mkChart(cid, { type: 'line', data: { labels: labels, datasets: ds }, options: o });
        return { sub: countryMeta(p.country).label + ' · settlement ' + (asOf[0] || last) + ' · tenor by tenor' };
      });
    },
  });

  reg({
    id: 'pf-history', title: 'Power forward history', pageCanvas: 'pf-drill-chart-free',
    desc: 'Daily settlement of one forward product (M+1 … Y+3) of one market; Y+1 is the rolling Cal+1.',
    params: [COUNTRY_PARAM, TENOR_PARAM, WIN_PARAM], defaults: { country: 'FR', tenor: 'Y+1', win: '1Y' },
    draw: function (cid, p) {
      return pfData().then(function () {
        var cs = (PF.series.countries && PF.series.countries[p.country]) || {}, all = PF.series.dates || [];
        var rg = rangeOf(all, p);
        var vals = ((cs.forwardCurve || {})[p.tenor] || []).slice(rg[0], rg[1]);
        var cur = (PF.snap.countries[p.country] || {}).currency || 'EUR';
        var o = lineOpts(false); o.scales = { x: AX, y: yAx(cur + '/MWh') };
        mkChart(cid, { type: 'line', data: { labels: all.slice(rg[0], rg[1]), datasets: [{ label: p.tenor, data: vals, borderColor: countryMeta(p.country).colour, borderWidth: 1.6, pointRadius: 0, tension: 0, fill: false, spanGaps: true }] }, options: o });
        return { sub: countryMeta(p.country).label + ' · ' + p.tenor };
      });
    },
  });

  reg({
    id: 'pf-cals', title: 'Power forward · calendar contracts', pageCanvas: 'pf-drill-chart-calall',
    desc: 'Price history of each calendar-year baseload contract of one market, one line per contract.',
    params: [COUNTRY_PARAM, WIN_PARAM], defaults: { country: 'FR', win: '1Y' },
    draw: function (cid, p) {
      return pfData().then(function () {
        var chain = PF.calchain && PF.calchain[p.country], years = (chain && chain.years) || {};
        var yk = Object.keys(years).sort(), set = {};
        yk.forEach(function (yr) { years[yr].dates.forEach(function (d) { set[d] = true; }); });
        var all = Object.keys(set).sort(), rg = rangeOf(all, p), dates = all.slice(rg[0], rg[1]), idx = {};
        dates.forEach(function (d, i) { idx[d] = i; });
        var ds = yk.map(function (yr, i) {
          var arr = new Array(dates.length).fill(null);
          years[yr].dates.forEach(function (d, j) { if (d in idx) arr[idx[d]] = years[yr].values[j]; });
          return { label: 'Cal' + yr, data: arr, borderColor: PALETTE[i % PALETTE.length], borderWidth: 1.5, pointRadius: 0, tension: 0, fill: false, spanGaps: true };
        }).filter(function (d) { return d.data.some(function (v) { return v != null; }); });
        if (!ds.length) { noDataMsg(cid, 'No calendar contracts quoted for ' + countryMeta(p.country).label + ' in this window', ''); return null; }
        var cur = (PF.snap.countries[p.country] || {}).currency || 'EUR';
        var o = lineOpts(true); o.scales = { x: AX, y: yAx(cur + '/MWh') };
        mkChart(cid, { type: 'line', data: { labels: dates, datasets: ds }, options: o });
        return { sub: countryMeta(p.country).label };
      });
    },
  });

  // quarters, months and seasons: dated contracts (data/history/fr_market_contracts.json), baseload only,
  // those still to be delivered (front ones first), one line each
  var contractsLoad = null;
  var KIND_N = { month: 6, quarter: 5, season: 4 };
  var KIND_NAME = { month: 'months', quarter: 'quarters', season: 'seasons' };
  reg({
    id: 'pf-contracts', title: 'Power forward · dated contracts', pageCanvas: 'pf-drill-chart-q',
    desc: 'Price history of the next quarters, months or seasons of one market (baseload), one line per contract.',
    params: [COUNTRY_PARAM, { key: 'kind', label: 'Contracts', inTitle: true, options: [['quarter', 'Quarters'], ['month', 'Months'], ['season', 'Seasons']] }, WIN_PARAM],
    defaults: { country: 'FR', kind: 'quarter', win: '1Y' },
    draw: function (cid, p) {
      if (!contractsLoad) contractsLoad = fetch('data/history/fr_market_contracts.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { contractsLoad = null; return null; });
      return Promise.all([pfData(), contractsLoad]).then(function (res) {
        var C = (res[1] && res[1][p.country]) || {}, kind = p.kind || 'quarter';
        var today = new Date().toISOString().slice(0, 10);
        var list = Object.keys(C).map(function (k) { return Object.assign({ key: k }, C[k]); })
          .filter(function (c) { return c.kind === kind && !/peak/i.test(c.marketName || '') && (c.deliveryEnd || '') >= today && c.points && Object.keys(c.points).length; })
          .sort(function (a, b) { return a.deliveryStart < b.deliveryStart ? -1 : 1; })
          .slice(0, KIND_N[kind] || 6);
        var set = {};
        list.forEach(function (c) { Object.keys(c.points).forEach(function (d) { set[d] = true; }); });
        var all = Object.keys(set).sort(), rg = rangeOf(all, p), dates = all.slice(rg[0], rg[1]);
        var ds = list.map(function (c, i) {
          return { label: c.key.replace(/^(.*?)(\d{4})$/, '$1 $2'), data: dates.map(function (d) { return c.points[d] != null ? c.points[d] : null; }),
            borderColor: PALETTE[i % PALETTE.length], borderWidth: 1.5, pointRadius: 0, tension: 0, fill: false, spanGaps: true };
        }).filter(function (d) { return d.data.some(function (v) { return v != null; }); });
        if (!ds.length) { noDataMsg(cid, 'No ' + (KIND_NAME[kind] || kind) + ' quoted for ' + countryMeta(p.country).label + ' in this window', ''); return null; }
        var cur = (PF.snap.countries[p.country] || {}).currency || 'EUR';
        var o = lineOpts(true); o.scales = { x: AX, y: yAx(cur + '/MWh') };
        mkChart(cid, { type: 'line', data: { labels: dates, datasets: ds }, options: o });
        return { sub: 'next ' + ds.length + ' ' + (KIND_NAME[kind] || kind) + ' · baseload' };
      });
    },
  });

  // ══════════════════════════════════════════════════════════════════════
  // COMPARAISON PAYS · un produit, les 4 zones sur le même graph + table
  // ══════════════════════════════════════════════════════════════════════

  function renderCompareZoneChips() {
    var host = document.getElementById('prfwd-cmp-zone-chips');
    if (!host) return;
    var active = PF.cmpZones; // null = all active
    host.innerHTML = COUNTRIES.map(function (c) {
      var isOn = !active || active.has(c.code);
      return window.pkZoneChip({
        code: c.flag + ' ' + c.label,
        active: isOn,
        color: c.colour,
        onClick: "window._pfToggleCmpZone('" + c.code + "')",
        title: isOn ? 'Hide ' + c.label : 'Show ' + c.label,
      });
    }).join('');
  }
  window._pfToggleCmpZone = function (code) {
    if (!PF.cmpZones) PF.cmpZones = new Set(COUNTRIES.map(function (c) { return c.code; }));
    if (PF.cmpZones.has(code)) {
      if (PF.cmpZones.size === 1) return; // never allow zero zones selected
      PF.cmpZones.delete(code);
    } else {
      PF.cmpZones.add(code);
    }
    // Collapse back to "all" (null) once every zone is active again, so the
    // chips read as a clean default state rather than "4/4 explicitly picked".
    if (PF.cmpZones.size === COUNTRIES.length) PF.cmpZones = null;
    renderCompareZoneChips();
    renderCompareChart();
    renderCompareTable();
  };

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

  reg({
    id: 'pf-compare', title: 'Power forwards · market comparison', pageCanvas: 'prfwd-chart-compare',
    desc: 'One forward product across FR, DE, NL and GB (converted to € at each day’s close).',
    params: [TENOR_PARAM, WIN_PARAM], defaults: { tenor: 'Y+1', win: '1Y' },
    draw: function (cid, p) {
      return pfData().then(function () {
        var PKCo = window.PKC;
        return (PKCo && PKCo.loadFull ? PKCo.loadFull() : Promise.resolve()).then(function () {
          var all = PF.series.dates || [], rg = rangeOf(all, p), dates = all.slice(rg[0], rg[1]);
          var codes = p.codes || COUNTRIES.map(function (c) { return c.code; });
          var gbpEur = function (d) { if (!PKCo) return null; var g = PKCo.valueOn('gbpusd', d, true), e = PKCo.valueOn('eurusd', d, true); return g && e ? g / e : null; };
          var ds = COUNTRIES.filter(function (c) { return codes.indexOf(c.code) >= 0; }).map(function (c) {
            var cs = (PF.series.countries && PF.series.countries[c.code]) || {};
            var vals = ((cs.forwardCurve && cs.forwardCurve[p.tenor]) || []).slice(rg[0], rg[1]);
            if ((cs.currency || (c.code === 'UK' ? 'GBP' : 'EUR')) === 'GBP') vals = vals.map(function (v, i) { var r = gbpEur(dates[i]); return v == null || r == null ? null : Math.round(v * r * 100) / 100; });
            return { label: c.label + (c.code === 'UK' ? ' (£→€)' : ''), data: vals, borderColor: c.colour, borderWidth: 1.5, pointRadius: 0, tension: 0, fill: false, spanGaps: true };
          });
          var o = lineOpts(true); o.scales = { x: AX, y: yAx('€/MWh') };
          mkChart(cid, { type: 'line', data: { labels: dates, datasets: ds }, options: o });
          return { sub: p.tenor };
        });
      });
    },
  });

  function renderCompareChart() {
    PKW.draw('pf-compare', 'prfwd-chart-compare', { tenor: PF.cmpTenor, win: PF.cmpWindow, codes: PF.cmpZones ? Array.from(PF.cmpZones) : null }).then(function () {
      if (typeof addFullscreen === 'function') addFullscreen('prfwd-chart-compare');
    });
  }

  function renderCompareTable() {
    var titleEl = document.getElementById('prfwd-cmp-table-title');
    if (titleEl) titleEl.textContent = "Today's snapshot · " + PF.cmpTenor;
    var tbody = document.getElementById('prfwd-cmp-tbody');
    if (!tbody) return;
    var visibleCountries = PF.cmpZones ? COUNTRIES.filter(function (c) { return PF.cmpZones.has(c.code); }) : COUNTRIES;
    tbody.innerHTML = visibleCountries.map(function (c) {
      var cs = PF.snap.countries[c.code];
      var row = tenorRow(cs, PF.cmpTenor);
      if (!row) return '<tr><td style="text-align:left">' + c.flag + ' ' + c.label + '</td><td colspan="4" style="text-align:left;color:var(--text3)">unavailable</td></tr>';
      return '<tr>' +
        '<td style="text-align:left;font-family:\'Inter\',sans-serif">' + c.flag + ' ' + c.label + '</td>' +
        '<td style="text-align:left;font-family:\'Inter\',sans-serif">' + row.contract + '</td>' +
        '<td>' + num(row.value, 2) + ' ' + cs.currency + '/MWh</td>' +
        '<td>' + deltaCell(row.varD1Pct) + '</td>' +
        '<td>' + deltaCell(row.varW1Pct) + '</td>' +
        '</tr>';
    }).join('');
  }



  // ══════════════════════════════════════════════════════════════════════
  // ORCHESTRATION
  // ══════════════════════════════════════════════════════════════════════

  function renderAll() {
    if (!PF.snap || !PF.series) return;
    var boardMeta = document.getElementById('prfwd-board-meta');
    if (boardMeta) boardMeta.textContent = 'M+1 to Y+3 · ' + (PF.snap.forwardCurveDate || '');
    renderTopKpis();
    renderCountriesTable();
    renderCompareZoneChips();
    renderCompareTenorButtons();
    renderCompareWindowButtons();
    renderCompareChart();
    renderCompareTable();
  }

  function renderPrFwd() {
    pfData().then(renderAll).catch(function () {
      var host = document.getElementById('prfwd-board-meta');
      if (host) host.textContent = 'data/fr_market.json unavailable';
    });
  }

  window.renderPrFwd = renderPrFwd;
  window._pfToggleRow = toggleCountryRow;
  window._pfCloseRow = closeCountryRow;
  window._pfSetDrillTab = function (tab) { PF.drillTab = tab; renderDrillTabs(PF.openCountry); renderDrillContent(PF.openCountry); };
  window._pfSetDrillTenor = function (t) { PF.drillTenor = t; renderDrillContent(PF.openCountry); };
  window._pfSetCurveVs = function (d) { PF.curveVs = d || ''; renderDrillContent(PF.openCountry); };
  window._pfSetDrillWindow = function (w) { PF.drillWindow = w; PF.drillFrom = PF.drillTo = ''; renderDrillContent(PF.openCountry); };
  window._pfSetDrillRange = function () {
    PF.drillFrom = (document.getElementById('pf-drill-from') || {}).value || '';
    PF.drillTo = (document.getElementById('pf-drill-to') || {}).value || '';
    renderDrillContent(PF.openCountry);
  };
  window._pfSetCmpTenor = function (t) { PF.cmpTenor = t; renderCompareTenorButtons(); renderCompareChart(); renderCompareTable(); };
  window._pfSetCmpWindow = function (w) { PF.cmpWindow = w; renderCompareWindowButtons(); renderCompareChart(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoFillOverviewCard);
  } else {
    autoFillOverviewCard();
  }
})();
