// ════════════════════════════════════════════════════════════════════════════
// PowerKlock · FRANCE COCKPIT
// ────────────────────────────────────────────────────────────────────────────
// Vue verrouillee sur la zone FR. Ce fichier est INTEGRALEMENT encapsule dans
// une IIFE : aucune declaration top-level `const`/`let` ne fuit vers le scope
// global. C'est deliberé — la redeclaration top-level entre deux <script>
// classiques leve une SyntaxError qui detruit le fichier entier (cf. le cas
// weather.js / prices.js). Tout ce qui doit etre expose l'est via window.*.
//
// Sources de donnees (aucune nouvelle) :
//   data/history/daily/<date>.json   · 96 slots prix + generation par filiere
//   data/history/summary.json        · serie journaliere FR depuis 2016
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  // CONFIG
  // ══════════════════════════════════════════════════════════════════════════

  var ZONE = 'FR';

  // summary.json ne contient que 5 zones : FR, DE_LU, ES, BE, NL
  var NEIGHBOURS = [
    { code: 'DE_LU', label: 'DE/LU', flag: '\uD83C\uDDE9\uD83C\uDDEA', colour: '#EE9B00' },
    { code: 'BE',    label: 'BE',    flag: '\uD83C\uDDE7\uD83C\uDDEA', colour: '#A87DC4' },
    { code: 'NL',    label: 'NL',    flag: '\uD83C\uDDF3\uD83C\uDDF1', colour: '#3FA6B4' },
    { code: 'ES',    label: 'ES',    flag: '\uD83C\uDDEA\uD83C\uDDF8', colour: '#ED6965' }
  ];

  var FUELS = [
    { key: 'nuclear', label: 'Nuclear', colour: '#7B4B9C' },
    { key: 'hydro',   label: 'Hydro',     colour: '#3FA6B4' },
    { key: 'wind',    label: 'Wind',    colour: '#14D3A9' },
    { key: 'solar',   label: 'Solar',   colour: '#FBBF24' },
    { key: 'biomass', label: 'Biomass',  colour: '#94D2BD' },
    { key: 'fossil',  label: 'Fossil',   colour: '#ED6965' },
    { key: 'other',   label: 'Other',    colour: '#4A6280' }
  ];

  // ══════════════════════════════════════════════════════════════════════════
  // ETAT
  // ══════════════════════════════════════════════════════════════════════════

  var S = {
    panel: 'today',        // today | cannib | hist | neigh
    date: null,            // ISO du jour affiche
    cannibWindow: 30,      // 7 | 30 | 90
    histWindow: '1Y',      // 1Y | 3Y | 5Y | All
    neighWindow: '1Y',
    marketTenor: 'Y+1',
    marketWindow: '1Y',
    booted: false,
    loadedPanels: {},
    charts: {}
  };

  var CACHE = { daily: {}, summary: null, frMarket: null, frMarketSeries: null };

  var FORWARD_TENORS = ['M+1', 'M+2', 'M+3', 'Q+1', 'Q+2', 'Q+3', 'S+1', 'S+2', 'Y+1', 'Y+2', 'Y+3'];

  // ══════════════════════════════════════════════════════════════════════════
  // UTILITAIRES
  // ══════════════════════════════════════════════════════════════════════════

  function $(id) { return document.getElementById(id); }

  function iso(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function shiftDays(isoStr, n) {
    var p = isoStr.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + n);
    return iso(d);
  }

  function fmtDateLong(isoStr) {
    var p = isoStr.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-GB', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  function num(v, dec) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return Number(v).toFixed(dec === undefined ? 1 : dec);
  }

  function clean(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] !== null && arr[i] !== undefined && !isNaN(arr[i])) out.push(arr[i]);
    }
    return out;
  }

  function mean(arr) {
    var c = clean(arr);
    if (!c.length) return null;
    var s = 0;
    for (var i = 0; i < c.length; i++) s += c[i];
    return s / c.length;
  }

  // Slot 15 min -> heure decimale. 96 slots = 24 h.
  function slotHour(i) { return i * 0.25; }

  function slotLabel(i) {
    var h = Math.floor(i * 0.25);
    var m = (i % 4) * 15;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function isPeak(i) { var h = slotHour(i); return h >= 8 && h < 20; }

  // ══════════════════════════════════════════════════════════════════════════
  // CHARGEMENT DONNEES
  // ══════════════════════════════════════════════════════════════════════════

  function loadDaily(dateStr) {
    if (CACHE.daily[dateStr] !== undefined) return Promise.resolve(CACHE.daily[dateStr]);
    return fetch('data/history/daily/' + dateStr + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { CACHE.daily[dateStr] = j; return j; })
      .catch(function () { CACHE.daily[dateStr] = null; return null; });
  }

  function loadSummary() {
    if (CACHE.summary) return Promise.resolve(CACHE.summary);
    return window.pkSummary().then(s => ({ ok: !!s, json: () => s }))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { CACHE.summary = j; return j; })
      .catch(function () { return null; });
  }

  function loadFrMarket() {
    if (CACHE.frMarket) return Promise.resolve(CACHE.frMarket);
    return fetch('data/fr_market.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { CACHE.frMarket = j; return j; })
      .catch(function () { return null; });
  }

  function loadFrMarketSeries() {
    if (CACHE.frMarketSeries) return Promise.resolve(CACHE.frMarketSeries);
    return fetch('data/history/fr_market_series.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { CACHE.frMarketSeries = j; return j; })
      .catch(function () { return null; });
  }

  // Charge n jours en remontant depuis `endDate`, concurrence limitee a 6.
  // Les fichiers daily pesent ~95 ko : 90 jours = ~8,5 Mo. On ne declenche
  // donc ce chargement qu'a l'ouverture de l'onglet Cannibalisation.
  function loadDailyRange(endDate, n, onProgress) {
    var dates = [];
    for (var i = 0; i < n; i++) dates.push(shiftDays(endDate, -i));

    var results = [];
    var idx = 0;
    var done = 0;

    function worker() {
      if (idx >= dates.length) return Promise.resolve();
      var my = idx++;
      return loadDaily(dates[my]).then(function (j) {
        results[my] = { date: dates[my], data: j };
        done++;
        if (onProgress) onProgress(done, dates.length);
        return worker();
      });
    }

    var pool = [];
    for (var k = 0; k < Math.min(6, dates.length); k++) pool.push(worker());
    return Promise.all(pool).then(function () {
      return results.filter(function (r) { return r && r.data; }).reverse();
    });
  }

  // Dernier jour disponible : on remonte jusqu'a 10 jours en arriere.
  function findLatestDate() {
    var today = (typeof pkTodayISO === "function") ? pkTodayISO() : iso(new Date());
    var tries = [];
    for (var i = 0; i < 10; i++) tries.push(shiftDays(today, -i));

    function step(k) {
      if (k >= tries.length) return Promise.resolve(null);
      return loadDaily(tries[k]).then(function (j) {
        if (j && j.zones && j.zones[ZONE]) return tries[k];
        return step(k + 1);
      });
    }
    return step(0);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CALCULS METIER
  // ══════════════════════════════════════════════════════════════════════════

  // Capture rate = generation-weighted price / simple average price of the
  // SAME slots (those where the technology is published), as on the
  // Renewables page: a partial day is not compared with a full-day base.
  // Null when there is no generation (e.g. solar at night).
  function captureStats(prices, gen) {
    var sumPG = 0, sumG = 0, sumP = 0, nP = 0, sumAll = 0, nAll = 0;
    for (var i = 0; i < prices.length; i++) {
      var p = prices[i], g = gen ? gen[i] : null;
      if (p === null || p === undefined || isNaN(p)) continue;
      sumAll += p; nAll++;
      if (g === null || g === undefined || isNaN(g)) continue;
      sumP += p; nP++;
      sumPG += p * g;
      sumG += g;
    }
    if (!nAll) return null;
    var base = nP ? sumP / nP : sumAll / nAll;
    if (sumG <= 0) return { base: base, capturePrice: null, captureRate: null, volume: 0 };
    var cp = sumPG / sumG;
    return {
      base: base,
      capturePrice: cp,
      captureRate: base !== 0 ? (cp / base) * 100 : null,
      volume: sumG
    };
  }

  // Heures a prix negatif sur 96 slots (chaque slot = 0,25 h).
  function negHours(prices) {
    var n = 0;
    for (var i = 0; i < prices.length; i++) {
      if (prices[i] !== null && prices[i] !== undefined && prices[i] < 0) n += 0.25;
    }
    return n;
  }

  function peakOffpeak(prices) {
    var pk = [], off = [];
    for (var i = 0; i < prices.length; i++) {
      var v = prices[i];
      if (v === null || v === undefined || isNaN(v)) continue;
      if (isPeak(i)) pk.push(v); else off.push(v);
    }
    return { peak: mean(pk), off: mean(off), nPeak: pk.length, nOff: off.length };
  }

  function frSeries(summary) {
    if (!summary || !summary.zones || !summary.zones[ZONE]) return [];
    return summary.zones[ZONE];
  }

  // enrich_summary.py n'a pas recalcule roll30 / roll365 sur la queue de serie
  // (95 entrees sans ces champs au moment de l'ecriture). On recalcule donc
  // systematiquement cote client : garantit une serie continue jusqu'au
  // dernier jour, et evite deux definitions concurrentes de la meme moyenne.
  function withRolling(series) {
    var out = series.map(function (r) {
      return { d: r.d, avg: r.avg, min: r.min, max: r.max, negH: r.negH || 0,
               peakAvg: r.peakAvg, offAvg: r.offAvg, renPct: r.renPct };
    });
    function roll(n, field) {
      var buf = [], sum = 0;
      for (var i = 0; i < out.length; i++) {
        var v = out[i].avg;
        if (v !== null && v !== undefined && !isNaN(v)) { buf.push(v); sum += v; }
        else buf.push(null);
        if (buf.length > n) {
          var drop = buf.shift();
          if (drop !== null) sum -= drop;
        }
        var valid = 0;
        for (var b = 0; b < buf.length; b++) if (buf[b] !== null) valid++;
        out[i][field] = valid ? sum / valid : null;
      }
    }
    roll(30, 'roll30');
    roll(365, 'roll365');
    return out;
  }

  function windowCutoff(win) {
    var d = new Date();
    if (win === '1Y') d.setFullYear(d.getFullYear() - 1);
    else if (win === '3Y') d.setFullYear(d.getFullYear() - 3);
    else if (win === '5Y') d.setFullYear(d.getFullYear() - 5);
    else return '0000-00-00';
    return iso(d);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDU · HELPERS UI
  // ══════════════════════════════════════════════════════════════════════════

  function kpiCard(label, value, unit, meta, tone) {
    var cls = 'kpi-card fr-kpi' + (tone ? ' kpi-' + tone : '');
    return '<div class="' + cls + '">' +
      '<div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value +
        (unit ? '<span class="kpi-unit">' + unit + '</span>' : '') + '</div>' +
      (meta ? '<div class="kpi-meta">' + meta + '</div>' : '') +
      '</div>';
  }

  function sectionOpen(title, subtitle, actionsHTML) {
    return '<div class="fr-section">' +
      '<div class="pk-section-header">' +
        '<div class="pk-section-header-text">' +
          '<div class="pk-section-title">' + title + '</div>' +
          (subtitle ? '<div class="pk-section-subtitle">' + subtitle + '</div>' : '') +
        '</div>' +
        (actionsHTML ? '<div class="pk-section-header-actions">' + actionsHTML + '</div>' : '') +
      '</div>';
  }

  function sectionClose() { return '</div>'; }

  function chartBox(canvasId, height) {
    return '<div class="fr-chart-wrap" style="position:relative;height:' + (height || 280) + 'px">' +
      '<canvas id="' + canvasId + '"></canvas></div>';
  }

  function loadingBlock(msg) {
    return '<div class="fr-loading">' + (msg || 'Loading...') + '</div>';
  }

  function destroyChart(key) {
    if (S.charts[key]) {
      try { S.charts[key].destroy(); } catch (e) {}
      delete S.charts[key];
    }
  }

  function makeChart(key, canvasId, config) {
    destroyChart(key);
    var el = $(canvasId);
    if (!el || !window.Chart) return null;
    config.options = config.options || {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;
    config.options.plugins = config.options.plugins || {};
    config.options.plugins.zoom = ZOOM_CFG;
    var ch = new Chart(el, config);
    S.charts[key] = ch;
    // Every France cockpit chart funnels through here, so wiring the ⛶
    // button once covers all of them (none had it before — addFullscreen
    // no-ops on repeat calls for the same canvas via its dataset.fsAdded guard).
    if (typeof addFullscreen === 'function') addFullscreen(canvasId);
    return ch;
  }

  function axisStyle(titleText) {
    return {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
      title: titleText ? { display: true, text: titleText, color: '#7A93AB', font: { size: 10 } } : undefined
    };
  }

  function legendStyle() {
    return {
      display: true,
      position: 'bottom',
      labels: { color: '#B8C9D9', font: { size: 10 }, boxWidth: 10, boxHeight: 10, padding: 12 }
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PANEL 1 · AUJOURD'HUI
  // ══════════════════════════════════════════════════════════════════════════

  function renderToday() {
    var host = $('fr-panel-today');
    if (!host) return;
    host.innerHTML = loadingBlock('Loading FR day...');

    var d0 = S.date;
    var d1 = shiftDays(d0, -1);

    Promise.all([loadDaily(d0), loadDaily(d1), loadSummary()]).then(function (res) {
      var day = res[0], prev = res[1], summary = res[2];
      var fr = day && day.zones ? day.zones[ZONE] : null;
      if (!fr) {
        host.innerHTML = '<div class="fr-empty">No FR data for ' + fmtDateLong(d0) + '.</div>';
        return;
      }
      var frPrev = prev && prev.zones ? prev.zones[ZONE] : null;

      var prices = fr.hourly || [];
      var po = peakOffpeak(prices);
      var base = mean(prices);
      var nh = negHours(prices);
      var mn = Math.min.apply(null, clean(prices));
      var mx = Math.max.apply(null, clean(prices));
      var ratio = (base && po.peak !== null) ? po.peak / base : null;

      var basePrev = frPrev ? mean(frPrev.hourly || []) : null;
      var delta = (base !== null && basePrev !== null) ? base - basePrev : null;

      // Capture rate du jour, filiere par filiere
      var capSolar = captureStats(prices, fr.solar);
      var capWind  = captureStats(prices, fr.wind);

      var missing = 0;
      for (var i = 0; i < prices.length; i++) {
        if (prices[i] === null || prices[i] === undefined) missing++;
      }

      var html = '';

      // ── KPI strip
      html += '<div class="kpi-strip fr-kpi-strip">';
      html += kpiCard('Base FR', num(base, 2), '\u20AC/MWh',
        delta !== null ? (delta >= 0 ? '\u25B2' : '\u25BC') + num(Math.abs(delta), 2) + ' vs J-1' : 'vs J-1 unavailable',
        delta === null ? 'flat' : (delta >= 0 ? 'up' : 'down'));
      html += kpiCard('Peak', num(po.peak, 2), '\u20AC/MWh', '08h-20h');
      html += kpiCard('Off-peak', num(po.off, 2), '\u20AC/MWh', '00h-08h / 20h-24h');
      html += kpiCard('Ratio peak/base', ratio !== null ? num(ratio, 2) : '--', 'x',
        ratio !== null && ratio < 1 ? 'Peak below base' : 'Reference 1,15x',
        ratio !== null && ratio < 1 ? 'down' : 'flat');
      html += kpiCard('Min', num(mn, 2), '\u20AC/MWh', 'lowest slot');
      html += kpiCard('Max', num(mx, 2), '\u20AC/MWh', 'highest slot');
      html += kpiCard('Negative hours', num(nh, 2), 'h', nh > 0 ? 'cannibalisation active' : 'none',
        nh > 0 ? 'down' : 'flat');
      // Same arrays and definition as GenMix: averages over published slots.
      var renShare = (function () {
        var avg = function (a) { if (!a) return 0; var v = a.filter(function (x) { return x !== null && x !== undefined && !isNaN(x); }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : 0; };
        var ren = ['wind', 'solar', 'hydro', 'biomass'].reduce(function (s, k) { return s + avg(fr[k]); }, 0);
        var tot = ['nuclear', 'wind', 'solar', 'hydro', 'biomass', 'fossil', 'other'].reduce(function (s, k) { return s + avg(fr[k]); }, 0);
        return tot > 0 ? ren / tot * 100 : fr.renPct;
      })();
      html += kpiCard('Renewable share', num(renShare, 1), '%', 'wind + solar + hydro + bio');
      html += '</div>';

      if (missing > 0) {
        html += '<div class="fr-warn">' + missing + ' price slot(s) missing out of 96: ' +
          'peak/off-peak averages are computed on available slots only.</div>';
      }

      // ── Courbe DA
      html += sectionOpen('FR day-ahead curve',
        fmtDateLong(d0) + ' \u00B7 96 \u00D7 15min slots \u00B7 ENTSO-E',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'da\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-da', 300);
      html += sectionClose();

      // ── Mix de generation
      html += sectionOpen('FR generation mix',
        'Power by fuel (RTE \u00E9CO2mix) \u00B7 DA price on secondary axis',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'mix\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-mix', 320);
      html += sectionClose();

      // ── Table mix + capture du jour
      html += sectionOpen('Fuel summary', 'Average power, mix share and captured value over the day');
      html += '<div class="table-wrap"><table class="fr-table"><thead><tr>' +
        '<th style="text-align:left">Fuel</th>' +
        '<th>Avg MW</th><th>Mix share</th><th>Captured price</th><th>Capture rate</th>' +
        '</tr></thead><tbody>';

      var totals = [];
      var grand = 0;
      for (var f = 0; f < FUELS.length; f++) {
        var m = mean(fr[FUELS[f].key] || []);
        totals.push(m);
        if (m) grand += m;
      }
      for (var f2 = 0; f2 < FUELS.length; f2++) {
        var fuel = FUELS[f2];
        var mw = totals[f2];
        var cap = captureStats(prices, fr[fuel.key]);
        var share = (mw && grand) ? (mw / grand) * 100 : null;
        html += '<tr>' +
          '<td class="fr-td-label"><span class="fr-dot" style="background:' + fuel.colour + '"></span>' + fuel.label + '</td>' +
          '<td class="fr-td-num">' + num(mw, 0) + '</td>' +
          '<td class="fr-td-num">' + num(share, 1) + '%</td>' +
          '<td class="fr-td-num">' + (cap && cap.capturePrice !== null ? num(cap.capturePrice, 2) : '--') + '</td>' +
          '<td class="fr-td-num ' + (cap && cap.captureRate !== null && cap.captureRate < 100 ? 'fr-neg' : '') + '">' +
            (cap && cap.captureRate !== null ? num(cap.captureRate, 1) + '%' : '--') + '</td>' +
          '</tr>';
      }
      html += '</tbody></table></div>';
      html += sectionClose();

      host.innerHTML = html;

      // ── Charts
      var labels = [];
      for (var s = 0; s < 96; s++) labels.push(slotLabel(s));

      var ds = [{
        label: fmtDateLong(d0),
        data: prices,
        borderColor: '#14D3A9',
        backgroundColor: 'rgba(20,211,169,0.08)',
        borderWidth: 2, tension: 0, pointRadius: 0, fill: true, spanGaps: false
      }];
      if (frPrev && frPrev.hourly) {
        ds.push({
          label: 'J-1',
          data: frPrev.hourly,
          borderColor: '#4A6280',
          borderWidth: 1.5, tension: 0, pointRadius: 0, fill: false,
          borderDash: [4, 3], spanGaps: false
        });
      }

      makeChart('da', 'fr-chart-da', {
        type: 'line',
        data: { labels: labels, datasets: ds },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: legendStyle(),
            annotation: { annotations: (function () { var nl = nowLineAnnotation({ chartDate: d0, slots: 96, label: 'NOW' }); return nl ? { nowLine: nl } : {}; })() }
          },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" },
                          maxTicksLimit: 12, autoSkip: true } },
            y: axisStyle('\u20AC/MWh')
          }
        }
      });

      var mixDs = FUELS.map(function (fu) {
        return {
          label: fu.label,
          data: fr[fu.key] || [],
          backgroundColor: fu.colour,
          borderWidth: 0,
          fill: true,
          stack: 'gen',
          yAxisID: 'y',
          type: 'bar',
          barPercentage: 1, categoryPercentage: 1
        };
      });
      mixDs.push({
        label: 'DA Price',
        data: prices,
        type: 'line',
        borderColor: '#FFFFFF',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        yAxisID: 'y1',
        tension: 0,
        order: -1          // draw the price on top of the generation stack
      });

      makeChart('mix', 'fr-chart-mix', {
        data: { labels: labels, datasets: mixDs },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: legendStyle(),
            annotation: { annotations: (function () { var nl = nowLineAnnotation({ chartDate: d0, slots: 96, label: 'NOW' }); return nl ? { nowLine: nl } : {}; })() }
          },
          scales: {
            x: { stacked: true, grid: { display: false },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" },
                          maxTicksLimit: 12, autoSkip: true } },
            y: { stacked: true, position: 'left',
                 grid: { color: 'rgba(255,255,255,0.04)' },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
                 title: { display: true, text: 'MW', color: '#7A93AB', font: { size: 10 } } },
            y1: { position: 'right', grid: { display: false },
                  ticks: { color: '#B8C9D9', font: { size: 10, family: "'JetBrains Mono', monospace" } },
                  title: { display: true, text: '\u20AC/MWh', color: '#B8C9D9', font: { size: 10 } } }
          }
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PANEL 2 · CANNIBALISATION
  // ══════════════════════════════════════════════════════════════════════════

  function renderCannib() {
    var host = $('fr-panel-cannib');
    if (!host) return;

    var n = S.cannibWindow;
    host.innerHTML = loadingBlock('Loading ' + n + ' FR days (0/' + n + ')…');

    loadDailyRange(S.date, n, function (done, total) {
      var el = host.querySelector('.fr-loading');
      if (el) el.textContent = 'Loading ' + total + ' FR days (' + done + '/' + total + ')…';
    }).then(function (days) {
      var rows = [];
      for (var i = 0; i < days.length; i++) {
        var fr = days[i].data.zones ? days[i].data.zones[ZONE] : null;
        if (!fr || !fr.hourly) continue;
        var p = fr.hourly;
        rows.push({
          date: days[i].date,
          base: mean(p),
          solar: captureStats(p, fr.solar),
          wind: captureStats(p, fr.wind),
          negH: negHours(p),
          prices: p,
          solarGen: fr.solar || [],
          windGen: fr.wind || []
        });
      }

      if (!rows.length) {
        host.innerHTML = '<div class="fr-empty">No usable day in this window.</div>';
        return;
      }

      // Agregats fenetre : capture ponderee sur toute la periode, pas moyenne
      // des capture rates journaliers (qui surponderait les jours peu productifs).
      // Only days carrying generation arrays of the same length as the prices
      // enter the capture aggregates, and the base used for the capture rate
      // is computed over those same days. (Concatenating every day's prices
      // with the generation of fewer days paired slots of different days.)
      var allP = [], genP = [], allS = [], allW = [], genDays = 0;
      var totalNeg = 0;
      for (var r = 0; r < rows.length; r++) {
        allP = allP.concat(rows[r].prices);
        totalNeg += rows[r].negH;
        var L = rows[r].prices.length;
        if (rows[r].solarGen.length === L && rows[r].windGen.length === L) {
          genP = genP.concat(rows[r].prices);
          allS = allS.concat(rows[r].solarGen);
          allW = allW.concat(rows[r].windGen);
          genDays++;
        }
      }
      var aggS = genDays ? captureStats(genP, allS) : null;
      var aggW = genDays ? captureStats(genP, allW) : null;
      var aggBase = mean(allP);
      var genBase = genDays ? mean(genP) : null;

      var html = '';

      html += '<div class="fr-toolbar">' +
        '<span class="fr-toolbar-label">Window</span>' +
        [7, 30, 90].map(function (w) {
          return '<button class="pk-gf-btn' + (w === n ? ' active' : '') +
            '" onclick="FRDash.setCannibWindow(' + w + ')">' + w + 'D</button>';
        }).join('') +
        '<span class="fr-toolbar-note">' + rows.length + ' days loaded \u00B7 ' + genDays + ' with generation data \u00B7 ending ' + fmtDateLong(S.date) + '</span>' +
        '</div>';

      html += '<div class="kpi-strip fr-kpi-strip">';
      html += kpiCard('Base FR', num(aggBase, 2), '\u20AC/MWh', 'simple average over the window');
      html += kpiCard('Solar captured price', aggS && aggS.capturePrice !== null ? num(aggS.capturePrice, 2) : '--',
        '\u20AC/MWh', 'weighted by production · base ' + (genBase == null ? '--' : num(genBase, 2)) + ' on the same ' + genDays + ' days');
      html += kpiCard('Solar capture rate', aggS && aggS.captureRate !== null ? num(aggS.captureRate, 1) : '--',
        '%', aggS && aggS.captureRate !== null ? (aggS.captureRate < 100 ? 'discount vs base' : 'prime vs base') : '',
        aggS && aggS.captureRate !== null ? (aggS.captureRate < 100 ? 'down' : 'up') : 'flat');
      html += kpiCard('Wind captured price', aggW && aggW.capturePrice !== null ? num(aggW.capturePrice, 2) : '--',
        '\u20AC/MWh', 'weighted by production');
      html += kpiCard('Wind capture rate', aggW && aggW.captureRate !== null ? num(aggW.captureRate, 1) : '--',
        '%', aggW && aggW.captureRate !== null ? (aggW.captureRate < 100 ? 'discount vs base' : 'prime vs base') : '',
        aggW && aggW.captureRate !== null ? (aggW.captureRate < 100 ? 'down' : 'up') : 'flat');
      html += kpiCard('Negative hours', num(totalNeg, 1), 'h', 'cumulative over the window',
        totalNeg > 0 ? 'down' : 'flat');
      html += '</div>';

      html += sectionOpen('Daily capture rate',
        'Captured price / FR base \u00B7 100% = no discount \u00B7 window ' + n + 'D',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'cap\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-capture', 300);
      html += sectionClose();

      html += sectionOpen('Average intraday profile',
        'Average DA price and average solar/wind production per slot over the window',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'prof\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-profile', 300);
      html += sectionClose();

      html += sectionOpen('Daily detail', 'Base, capture and negative hours, day by day');
      html += '<div class="table-wrap"><table class="fr-table"><thead><tr>' +
        '<th style="text-align:left">Date</th><th>Base</th>' +
        '<th>Solar capt.</th><th>Solar CR</th>' +
        '<th>Wind capt.</th><th>Wind CR</th><th>Neg. h</th>' +
        '</tr></thead><tbody>';
      for (var t = rows.length - 1; t >= 0; t--) {
        var row = rows[t];
        html += '<tr>' +
          '<td class="fr-td-label">' + row.date + '</td>' +
          '<td class="fr-td-num">' + num(row.base, 2) + '</td>' +
          '<td class="fr-td-num">' + (row.solar && row.solar.capturePrice !== null ? num(row.solar.capturePrice, 2) : '--') + '</td>' +
          '<td class="fr-td-num ' + (row.solar && row.solar.captureRate !== null && row.solar.captureRate < 100 ? 'fr-neg' : '') + '">' +
            (row.solar && row.solar.captureRate !== null ? num(row.solar.captureRate, 1) + '%' : '--') + '</td>' +
          '<td class="fr-td-num">' + (row.wind && row.wind.capturePrice !== null ? num(row.wind.capturePrice, 2) : '--') + '</td>' +
          '<td class="fr-td-num ' + (row.wind && row.wind.captureRate !== null && row.wind.captureRate < 100 ? 'fr-neg' : '') + '">' +
            (row.wind && row.wind.captureRate !== null ? num(row.wind.captureRate, 1) + '%' : '--') + '</td>' +
          '<td class="fr-td-num ' + (row.negH > 0 ? 'fr-neg' : '') + '">' + num(row.negH, 2) + '</td>' +
          '</tr>';
      }
      html += '</tbody></table></div>';
      html += sectionClose();

      host.innerHTML = html;

      // Chart capture rate journalier
      makeChart('cap', 'fr-chart-capture', {
        type: 'line',
        data: {
          labels: rows.map(function (r) { return r.date.slice(5); }),
          datasets: [
            { label: 'Solar', data: rows.map(function (r) { return r.solar ? r.solar.captureRate : null; }),
              borderColor: '#FBBF24', borderWidth: 2, pointRadius: 0, tension: 0, fill: false, spanGaps: true },
            { label: 'Wind', data: rows.map(function (r) { return r.wind ? r.wind.captureRate : null; }),
              borderColor: '#14D3A9', borderWidth: 2, pointRadius: 0, tension: 0, fill: false, spanGaps: true }
          ]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: legendStyle() },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 14 } },
            y: axisStyle('% of base')
          }
        }
      });

      // Profil horaire moyen : prix vs production
      var avgP = [], avgS = [], avgW = [];
      for (var s = 0; s < 96; s++) {
        var bp = [], bs = [], bw = [];
        for (var q = 0; q < rows.length; q++) {
          bp.push(rows[q].prices[s]);
          bs.push(rows[q].solarGen[s]);
          bw.push(rows[q].windGen[s]);
        }
        avgP.push(mean(bp)); avgS.push(mean(bs)); avgW.push(mean(bw));
      }
      var plabels = [];
      for (var s2 = 0; s2 < 96; s2++) plabels.push(slotLabel(s2));

      makeChart('prof', 'fr-chart-profile', {
        data: {
          labels: plabels,
          datasets: [
            { type: 'line', label: 'Average DA price', data: avgP, borderColor: '#FFFFFF',
              borderWidth: 2, pointRadius: 0, tension: 0, fill: false, yAxisID: 'y1' },
            { type: 'bar', label: 'Average solar', data: avgS, backgroundColor: 'rgba(251,191,36,0.55)',
              borderWidth: 0, yAxisID: 'y', stack: 'g', barPercentage: 1, categoryPercentage: 1 },
            { type: 'bar', label: 'Average wind', data: avgW, backgroundColor: 'rgba(20,211,169,0.55)',
              borderWidth: 0, yAxisID: 'y', stack: 'g', barPercentage: 1, categoryPercentage: 1 }
          ]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: legendStyle() },
          scales: {
            x: { stacked: true, grid: { display: false },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 12 } },
            y: { stacked: true, position: 'left', grid: { color: 'rgba(255,255,255,0.04)' },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } },
                 title: { display: true, text: 'MW', color: '#7A93AB', font: { size: 10 } } },
            y1: { position: 'right', grid: { display: false },
                  ticks: { color: '#B8C9D9', font: { size: 10, family: "'JetBrains Mono', monospace" } },
                  title: { display: true, text: '\u20AC/MWh', color: '#B8C9D9', font: { size: 10 } } }
          }
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PANEL 3 · HISTORIQUE
  // ══════════════════════════════════════════════════════════════════════════

  function renderHist() {
    var host = $('fr-panel-hist');
    if (!host) return;
    host.innerHTML = loadingBlock('Loading FR history...');

    loadSummary().then(function (summary) {
      var all = withRolling(frSeries(summary));
      if (!all.length) {
        host.innerHTML = '<div class="fr-empty">summary.json unavailable or no FR series.</div>';
        return;
      }
      var cut = windowCutoff(S.histWindow);
      var series = all.filter(function (r) { return r.d >= cut; });

      // Agregation mensuelle des heures negatives sur toute la serie
      var byMonth = {};
      for (var i = 0; i < all.length; i++) {
        var m = all[i].d.slice(0, 7);
        if (!byMonth[m]) byMonth[m] = { negH: 0, sum: 0, n: 0 };
        byMonth[m].negH += (all[i].negH || 0);
        if (all[i].avg !== null && all[i].avg !== undefined) { byMonth[m].sum += all[i].avg; byMonth[m].n++; }
      }
      var months = Object.keys(byMonth).sort();

      var last = series[series.length - 1] || {};
      var avgWin = mean(series.map(function (r) { return r.avg; }));
      var negWin = series.reduce(function (a, r) { return a + (r.negH || 0); }, 0);
      var maxWin = Math.max.apply(null, clean(series.map(function (r) { return r.max; })));
      var minWin = Math.min.apply(null, clean(series.map(function (r) { return r.min; })));

      var html = '';

      html += '<div class="fr-toolbar">' +
        '<span class="fr-toolbar-label">Period</span>' +
        ['1Y', '3Y', '5Y', 'All'].map(function (w) {
          return '<button class="pk-gf-btn' + (w === S.histWindow ? ' active' : '') +
            '" onclick="FRDash.setHistWindow(\'' + w + '\')">' + w + '</button>';
        }).join('') +
        '<span class="fr-toolbar-note">' + series.length + ' days \u00B7 since ' +
        (series[0] ? series[0].d : '--') + '</span>' +
        '</div>';

      html += '<div class="kpi-strip fr-kpi-strip">';
      html += kpiCard('Average base', num(avgWin, 2), '\u20AC/MWh', 'over the period');
      html += kpiCard('Latest day', num(last.avg, 2), '\u20AC/MWh', last.d || '');
      html += kpiCard('Avg 30d', num(last.roll30, 2), '\u20AC/MWh', 'rolling');
      html += kpiCard('Avg 365d', num(last.roll365, 2), '\u20AC/MWh', 'rolling');
      html += kpiCard('Negative hours', num(negWin, 0), 'h', 'period cumulative', negWin > 0 ? 'down' : 'flat');
      html += kpiCard('Amplitude', num(minWin, 0) + ' / ' + num(maxWin, 0), '\u20AC/MWh', 'min / max slot');
      html += '</div>';

      html += sectionOpen('FR base price',
        'Daily and rolling averages \u00B7 source summary.json',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'histbase\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-histbase', 320);
      html += sectionClose();

      html += sectionOpen('Negative price hours per month',
        'Full series since ' + (all[0] ? all[0].d.slice(0, 4) : '--') + ' \u00B7 cannibalisation indicator',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'histneg\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-histneg', 280);
      html += sectionClose();

      html += sectionOpen('Synthese mensuelle', 'last 12 months');
      html += '<div class="table-wrap"><table class="fr-table"><thead><tr>' +
        '<th style="text-align:left">Month</th><th>Base</th><th>Negative hours</th><th>Days</th>' +
        '</tr></thead><tbody>';
      var lastMonths = months.slice(-12).reverse();
      for (var k = 0; k < lastMonths.length; k++) {
        var mm = byMonth[lastMonths[k]];
        html += '<tr>' +
          '<td class="fr-td-label">' + lastMonths[k] + '</td>' +
          '<td class="fr-td-num">' + num(mm.n ? mm.sum / mm.n : null, 2) + '</td>' +
          '<td class="fr-td-num ' + (mm.negH > 0 ? 'fr-neg' : '') + '">' + num(mm.negH, 0) + '</td>' +
          '<td class="fr-td-num">' + mm.n + '</td>' +
          '</tr>';
      }
      html += '</tbody></table></div>';
      html += sectionClose();

      host.innerHTML = html;

      makeChart('histbase', 'fr-chart-histbase', {
        type: 'line',
        data: {
          labels: series.map(function (r) { return r.d; }),
          datasets: [
            { label: 'Daily base', data: series.map(function (r) { return r.avg; }),
              borderColor: 'rgba(20,211,169,0.35)', borderWidth: 1, pointRadius: 0, tension: 0, fill: false },
            { label: 'Avg 30d', data: series.map(function (r) { return r.roll30; }),
              borderColor: '#14D3A9', borderWidth: 2, pointRadius: 0, tension: 0, fill: false },
            { label: 'Avg 365d', data: series.map(function (r) { return r.roll365; }),
              borderColor: '#EE9B00', borderWidth: 2, pointRadius: 0, tension: 0, fill: false }
          ]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: legendStyle() },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" },
                          maxTicksLimit: 12, autoSkip: true } },
            y: axisStyle('\u20AC/MWh')
          }
        }
      });

      makeChart('histneg', 'fr-chart-histneg', {
        type: 'bar',
        data: {
          labels: months,
          datasets: [{
            label: 'Negative hours',
            data: months.map(function (m) { return byMonth[m].negH; }),
            backgroundColor: '#ED6965', borderWidth: 0
          }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" },
                          maxTicksLimit: 16, autoSkip: true } },
            y: axisStyle('hours / month')
          }
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PANEL 4 · VOISINS (spreads centres FR, pas un classement europeen)
  // ══════════════════════════════════════════════════════════════════════════

  function renderNeigh() {
    var host = $('fr-panel-neigh');
    if (!host) return;
    host.innerHTML = loadingBlock('Loading FR spreads...');

    loadSummary().then(function (summary) {
      if (!summary || !summary.zones) {
        host.innerHTML = '<div class="fr-empty">summary.json unavailable.</div>';
        return;
      }
      var frAll = withRolling(frSeries(summary));
      if (!frAll.length) {
        host.innerHTML = '<div class="fr-empty">FR series missing from summary.json.</div>';
        return;
      }
      var cut = windowCutoff(S.neighWindow);
      var fr = frAll.filter(function (r) { return r.d >= cut; });

      // Index par date pour chaque voisin present
      var avail = NEIGHBOURS.filter(function (nb) { return !!summary.zones[nb.code]; });
      var idxByZone = {};
      avail.forEach(function (nb) {
        var map = {};
        summary.zones[nb.code].forEach(function (r) { map[r.d] = r.avg; });
        idxByZone[nb.code] = map;
      });

      var labels = fr.map(function (r) { return r.d; });
      var spreadSeries = avail.map(function (nb) {
        return {
          nb: nb,
          data: fr.map(function (r) {
            var v = idxByZone[nb.code][r.d];
            if (v === undefined || v === null || r.avg === null || r.avg === undefined) return null;
            return r.avg - v;
          })
        };
      });

      var html = '';

      html += '<div class="fr-toolbar">' +
        '<span class="fr-toolbar-label">Period</span>' +
        ['1Y', '3Y', '5Y', 'All'].map(function (w) {
          return '<button class="pk-gf-btn' + (w === S.neighWindow ? ' active' : '') +
            '" onclick="FRDash.setNeighWindow(\'' + w + '\')">' + w + '</button>';
        }).join('') +
        '<span class="fr-toolbar-note">spread = FR base minus zone base \u00B7 positive value = FR more expensive</span>' +
        '</div>';

      html += '<div class="kpi-strip fr-kpi-strip">';
      var frAvg = mean(fr.map(function (r) { return r.avg; }));
      html += kpiCard('Base FR', num(frAvg, 2), '\u20AC/MWh', 'period average');
      spreadSeries.forEach(function (sp) {
        var m = mean(sp.data);
        html += kpiCard('Spread FR-' + sp.nb.label, num(m, 2), '\u20AC/MWh',
          m !== null ? (m >= 0 ? 'FR above' : 'FR below') : '',
          m === null ? 'flat' : (m >= 0 ? 'up' : 'down'));
      });
      html += '</div>';

      html += sectionOpen('Spread FR vs neighbouring zones',
        'FR daily base minus zone daily base \u00B7 summary.json',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'spread\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-spread', 320);
      html += sectionClose();

      html += sectionOpen('FR positioning', 'Average base and spread over the days both zones have data');
      html += '<div class="table-wrap"><table class="fr-table"><thead><tr>' +
        '<th style="text-align:left">Zone</th><th>Base</th><th>Spread vs FR</th><th>Common days</th>' +
        '</tr></thead><tbody>';
      html += '<tr><td class="fr-td-label"><span class="fr-flag">\uD83C\uDDEB\uD83C\uDDF7</span>FR</td>' +
        '<td class="fr-td-num">' + num(frAvg, 2) + '</td><td class="fr-td-num">--</td>' +
        '<td class="fr-td-num">' + fr.length + '</td></tr>';
      spreadSeries.forEach(function (sp) {
        var zAvg = mean(fr.map(function (r) { return idxByZone[sp.nb.code][r.d]; }));
        var m = mean(sp.data);
        html += '<tr>' +
          '<td class="fr-td-label"><span class="fr-flag">' + sp.nb.flag + '</span>' + sp.nb.label + '</td>' +
          '<td class="fr-td-num">' + num(zAvg, 2) + '</td>' +
          '<td class="fr-td-num ' + (m !== null && m < 0 ? 'fr-neg' : '') + '">' + num(m, 2) + '</td>' +
          '<td class="fr-td-num">' + clean(sp.data).length + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      html += sectionClose();

      host.innerHTML = html;

      makeChart('spread', 'fr-chart-spread', {
        type: 'line',
        data: {
          labels: labels,
          datasets: spreadSeries.map(function (sp) {
            return {
              label: 'FR-' + sp.nb.label,
              data: sp.data,
              borderColor: sp.nb.colour,
              borderWidth: 1.5, pointRadius: 0, tension: 0, fill: false, spanGaps: false
            };
          })
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: legendStyle() },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" },
                          maxTicksLimit: 12, autoSkip: true } },
            y: axisStyle('\u20AC/MWh')
          }
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PANEL 5 · MARCHE (courbe forward, nucleaire, analyse — source SEFE cockpit)
  // ══════════════════════════════════════════════════════════════════════════

  function windowCutoffDates(dates, win) {
    if (win === 'All' || !dates.length) return dates;
    var days = { '3M': 91, '6M': 183, '1Y': 365, '3Y': 1095, '5Y': 1826 }[win] || 365;
    var cutoff = shiftDays(dates[dates.length - 1], -days);
    var startIdx = 0;
    for (var i = 0; i < dates.length; i++) { if (dates[i] >= cutoff) { startIdx = i; break; } }
    return dates.slice(startIdx);
  }

  function sliceSeries(series, startIdx) { return series.slice(startIdx); }

  function renderMarket() {
    var host = $('fr-panel-market');
    if (!host) return;
    host.innerHTML = loadingBlock('Loading FR market data...');

    Promise.all([loadFrMarket(), loadFrMarketSeries()]).then(function (res) {
      var snap = res[0], series = res[1];
      if (!snap || !series) {
        host.innerHTML = '<div class="fr-empty">data/fr_market.json or fr_market_series.json unavailable. ' +
          'Run scripts/fetch_fr_market.py.</div>';
        return;
      }

      var html = '';

      html += '<div class="kpi-strip fr-kpi-strip">';
      // SEFE dates the day-ahead spot by its auction (trading) day.
      html += kpiCard('Spot FR', num(snap.spot && snap.spot.value, 2), '€/MWh', snap.spot && snap.spot.date ? 'delivery ' + shiftDays(snap.spot.date, 1) : '');
      var y1 = (snap.forwardCurve || []).filter(function (r) { return r.tenor === 'Y+1'; })[0];
      var y2 = (snap.forwardCurve || []).filter(function (r) { return r.tenor === 'Y+2'; })[0];
      html += kpiCard('Forward ' + (y1 ? y1.contract : 'Y+1'), num(y1 && y1.value, 2), '€/MWh',
        y1 && y1.varD1Pct !== null && y1.varD1Pct !== undefined ? (y1.varD1Pct >= 0 ? '+' : '') + num(y1.varD1Pct, 2) + '% D-1' : '',
        y1 && y1.varD1Pct > 0 ? 'down' : (y1 && y1.varD1Pct < 0 ? 'up' : 'flat'));
      html += kpiCard('Forward ' + (y2 ? y2.contract : 'Y+2'), num(y2 && y2.value, 2), '€/MWh',
        y2 && y2.varD1Pct !== null && y2.varD1Pct !== undefined ? (y2.varD1Pct >= 0 ? '+' : '') + num(y2.varD1Pct, 2) + '% D-1' : '',
        y2 && y2.varD1Pct > 0 ? 'down' : (y2 && y2.varD1Pct < 0 ? 'up' : 'flat'));
      html += kpiCard('Nuclear available', num(snap.nuclearCapacity && snap.nuclearCapacity.actualMW / 1000, 1), 'GW',
        snap.nuclearCapacityDate || '');
      html += kpiCard('Nuclear forecast', num(snap.nuclearCapacity && snap.nuclearCapacity.forecastMW / 1000, 1), 'GW',
        'operator forecast, D+1');
      html += '</div>';

      html += sectionOpen('FR forward curve (base)',
        'Today\'s snapshot · M+1 to Y+3',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'fwdcurve\')">↺ Reset</button>');
      html += chartBox('fr-chart-fwdcurve', 280);
      html += sectionClose();

      html += '<div class="fr-toolbar">' +
        '<span class="fr-toolbar-label">Tenor</span>' +
        FORWARD_TENORS.map(function (t) {
          return '<button class="pk-gf-btn' + (t === S.marketTenor ? ' active' : '') +
            '" onclick="FRDash.setMarketTenor(\'' + t + '\')">' + t + '</button>';
        }).join('') +
        '<span class="fr-toolbar-label" style="margin-left:14px">Period</span>' +
        ['3M', '6M', '1Y', '3Y', '5Y', 'All'].map(function (w) {
          return '<button class="pk-gf-btn' + (w === S.marketWindow ? ' active' : '') +
            '" onclick="FRDash.setMarketWindow(\'' + w + '\')">' + w + '</button>';
        }).join('') +
        '</div>';

      html += sectionOpen('Forward history ' + S.marketTenor,
        'Price trend of the current contract for this tenor · since it started trading',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'fwdhist\')">↺ Reset</button>');
      html += chartBox('fr-chart-fwdhist', 280);
      html += sectionClose();

      html += sectionOpen('Available nuclear: actual vs forecast',
        'French nuclear capacity · operator data',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'nuc\')">↺ Reset</button>');
      html += chartBox('fr-chart-nuc', 260);
      html += sectionClose();

      html += sectionOpen('Capacity guarantees · bilateral trades',
        'Volume-weighted monthly price per delivery year (€/MW/year, log scale) · RTE capacity registry', '');
      html += chartBox('fr-chart-gc', 280);
      html += '<div id="fr-gc-table" style="margin-top:12px"></div>';
      html += sectionClose();

      host.innerHTML = html;
      if (window.PKW && typeof renderCapacityGcTable === 'function') {
        PKW.draw('fr-capacity-gc', 'fr-chart-gc', {});
        renderCapacityGcTable('fr-gc-table');
      }

      // Courbe forward du jour (term structure)
      var curveLabels = FORWARD_TENORS;
      var curveValues = FORWARD_TENORS.map(function (t) {
        var row = (snap.forwardCurve || []).filter(function (r) { return r.tenor === t; })[0];
        return row ? row.value : null;
      });
      makeChart('fwdcurve', 'fr-chart-fwdcurve', {
        type: 'line',
        data: {
          labels: curveLabels,
          datasets: [{ label: 'FR base forward price', data: curveValues, borderColor: '#14D3A9',
            backgroundColor: 'rgba(20,211,169,0.12)', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#14D3A9',
            tension: 0, fill: true }]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" } } },
            y: axisStyle('€/MWh')
          }
        }
      });

      // Historique du tenor selectionne
      var allDates = series.dates || [];
      var startIdx = allDates.indexOf(windowCutoffDates(allDates, S.marketWindow)[0]);
      if (startIdx < 0) startIdx = 0;
      var hDates = sliceSeries(allDates, startIdx);
      var hValues = sliceSeries((series.forwardCurve && series.forwardCurve[S.marketTenor]) || [], startIdx);
      makeChart('fwdhist', 'fr-chart-fwdhist', {
        type: 'line',
        data: {
          labels: hDates,
          datasets: [{ label: S.marketTenor, data: hValues, borderColor: '#14D3A9', borderWidth: 1.5,
            pointRadius: 0, tension: 0, fill: false, spanGaps: true }]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" },
                          maxTicksLimit: 12, autoSkip: true } },
            y: axisStyle('€/MWh')
          }
        }
      });

      // Nucleaire reel vs previsionnel
      var nucActual = sliceSeries((series.nuclearCapacity && series.nuclearCapacity.actual) || [], startIdx);
      var nucForecast = sliceSeries((series.nuclearCapacity && series.nuclearCapacity.forecast) || [], startIdx);
      makeChart('nuc', 'fr-chart-nuc', {
        type: 'line',
        data: {
          labels: hDates,
          datasets: [
            { label: 'Actual', data: nucActual, borderColor: '#7B4B9C', borderWidth: 1.5,
              pointRadius: 0, tension: 0, fill: false, spanGaps: true },
            { label: 'Forecast', data: nucForecast, borderColor: '#EE9B00', borderWidth: 1.5,
              borderDash: [4, 3], pointRadius: 0, tension: 0, fill: false, spanGaps: true }
          ]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: legendStyle() },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" },
                          maxTicksLimit: 12, autoSkip: true } },
            y: axisStyle('MW')
          }
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ORCHESTRATION
  // ══════════════════════════════════════════════════════════════════════════

  var RENDERERS = { today: renderToday, cannib: renderCannib, hist: renderHist, neigh: renderNeigh, market: renderMarket };

  function renderPanel(name, force) {
    document.querySelectorAll('#page-france .fr-panel').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-fr-panel') === name);
    });
    document.querySelectorAll('#page-france .fr-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-fr-tab') === name);
    });
    S.panel = name;
    // Before boot() has resolved the day, just remember the tab: boot()
    // renders S.panel once the date is known.
    if (!S.date) return;
    if (force || !S.loadedPanels[name]) {
      S.loadedPanels[name] = true;
      if (RENDERERS[name]) RENDERERS[name]();
    }
  }

  function updateDateLabel() {
    var el = $('fr-date-label');
    if (el) el.textContent = fmtDateLong(S.date);
  }

  function boot() {
    var host = $('page-france');
    if (!host) return;

    var start = S.date ? Promise.resolve(S.date) : findLatestDate();
    start.then(function (d) {
      if (!d) {
        var body = $('fr-body');
        if (body) body.innerHTML = '<div class="fr-empty">No FR day found in data/history/daily/ over the last 10 days.</div>';
        return;
      }
      S.date = d;
      updateDateLabel();
      S.booted = true;
      renderPanel(S.panel, true);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // API PUBLIQUE
  // ══════════════════════════════════════════════════════════════════════════

  window.FRDash = {
    open: function () {
      window.PK_ZONE_SCOPE = ZONE;
      if (!S.booted) boot();
      else renderPanel(S.panel, false);
    },
    close: function () { window.PK_ZONE_SCOPE = null; },

    selectTab: function (name) { renderPanel(name, false); },

    shiftDate: function (n) {
      if (!S.date) return;
      S.date = shiftDays(S.date, n);
      updateDateLabel();
      S.loadedPanels = {};
      renderPanel(S.panel, true);
    },

    gotoLatest: function () {
      findLatestDate().then(function (d) {
        if (!d) return;
        S.date = d;
        updateDateLabel();
        S.loadedPanels = {};
        renderPanel(S.panel, true);
      });
    },

    setCannibWindow: function (w) { S.cannibWindow = w; renderCannib(); },
    setHistWindow: function (w) { S.histWindow = w; renderHist(); },
    setNeighWindow: function (w) { S.neighWindow = w; renderNeigh(); },
    setMarketTenor: function (t) { S.marketTenor = t; renderMarket(); },
    setMarketWindow: function (w) { S.marketWindow = w; renderMarket(); },

    resetChart: function (key) {
      if (S.charts[key] && S.charts[key].resetZoom) {
        try { S.charts[key].resetZoom(); } catch (e) {}
      }
    },

    _state: S
  };

  // Compatibilite avec l'ancien appel de switchDashboard()
  window.loadFranceDashboard = function () { window.FRDash.open(); };

})();
