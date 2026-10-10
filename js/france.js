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
    { key: 'nuclear', label: 'Nucleaire', colour: '#7B4B9C' },
    { key: 'hydro',   label: 'Hydro',     colour: '#3FA6B4' },
    { key: 'wind',    label: 'Eolien',    colour: '#14D3A9' },
    { key: 'solar',   label: 'Solaire',   colour: '#FBBF24' },
    { key: 'biomass', label: 'Biomasse',  colour: '#94D2BD' },
    { key: 'fossil',  label: 'Fossile',   colour: '#ED6965' },
    { key: 'other',   label: 'Autres',    colour: '#4A6280' }
  ];

  // Norme graphs PowerKlock : drag rectangle XY, pas de molette, pas de pan.
  var ZOOM_OPTS = {
    zoom: {
      drag: { enabled: true, backgroundColor: 'rgba(20,211,169,0.15)', borderColor: '#14D3A9', borderWidth: 1 },
      wheel: { enabled: false },
      pinch: { enabled: false },
      mode: 'xy'
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ETAT
  // ══════════════════════════════════════════════════════════════════════════

  var S = {
    panel: 'today',        // today | cannib | hist | neigh
    date: null,            // ISO du jour affiche
    cannibWindow: 30,      // 7 | 30 | 90
    histWindow: '1Y',      // 1Y | 3Y | 5Y | All
    neighWindow: '1Y',
    booted: false,
    loadedPanels: {},
    charts: {}
  };

  var CACHE = { daily: {}, summary: null };

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
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('fr-FR', {
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
    return fetch('data/history/summary.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { CACHE.summary = j; return j; })
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
    var today = iso(new Date());
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

  // Capture rate = (prix moyen pondere par la production) / (prix moyen simple).
  // Retourne null si la production totale est nulle (ex : solaire en hiver la nuit).
  function captureStats(prices, gen) {
    var sumPG = 0, sumG = 0, sumP = 0, nP = 0;
    for (var i = 0; i < prices.length; i++) {
      var p = prices[i], g = gen ? gen[i] : null;
      if (p === null || p === undefined || isNaN(p)) continue;
      sumP += p; nP++;
      if (g === null || g === undefined || isNaN(g)) continue;
      sumPG += p * g;
      sumG += g;
    }
    if (!nP) return null;
    var base = sumP / nP;
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
    return '<div class="fr-loading">' + (msg || 'Chargement...') + '</div>';
  }

  // Attache la norme graphs : dblclick = reset, bouton reset dans l'entete.
  function zoomify(chart, canvasId) {
    var c = $(canvasId);
    if (!c || !chart) return;
    c.ondblclick = function () { try { chart.resetZoom(); } catch (e) {} };
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
    config.options.plugins.zoom = ZOOM_OPTS;
    var ch = new Chart(el, config);
    S.charts[key] = ch;
    zoomify(ch, canvasId);
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
    host.innerHTML = loadingBlock('Chargement de la journee FR...');

    var d0 = S.date;
    var d1 = shiftDays(d0, -1);

    Promise.all([loadDaily(d0), loadDaily(d1), loadSummary()]).then(function (res) {
      var day = res[0], prev = res[1], summary = res[2];
      var fr = day && day.zones ? day.zones[ZONE] : null;
      if (!fr) {
        host.innerHTML = '<div class="fr-empty">Aucune donnee FR pour le ' + fmtDateLong(d0) + '.</div>';
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
        delta !== null ? (delta >= 0 ? '\u25B2' : '\u25BC') + num(Math.abs(delta), 2) + ' vs J-1' : 'vs J-1 indisponible',
        delta === null ? 'flat' : (delta >= 0 ? 'up' : 'down'));
      html += kpiCard('Peak', num(po.peak, 2), '\u20AC/MWh', '08h-20h');
      html += kpiCard('Off-peak', num(po.off, 2), '\u20AC/MWh', '00h-08h / 20h-24h');
      html += kpiCard('Ratio peak/base', ratio !== null ? num(ratio, 2) : '--', 'x',
        ratio !== null && ratio < 1 ? 'Peak sous la base' : 'Reference 1,15x',
        ratio !== null && ratio < 1 ? 'down' : 'flat');
      html += kpiCard('Min', num(mn, 2), '\u20AC/MWh', 'slot le plus bas');
      html += kpiCard('Max', num(mx, 2), '\u20AC/MWh', 'slot le plus haut');
      html += kpiCard('Heures negatives', num(nh, 2), 'h', nh > 0 ? 'cannibalisation active' : 'aucune',
        nh > 0 ? 'down' : 'flat');
      html += kpiCard('Part renouvelable', num(fr.renPct, 1), '%', 'eolien + solaire + hydro + bio');
      html += '</div>';

      if (missing > 0) {
        html += '<div class="fr-warn">' + missing + ' slot(s) de prix manquant(s) sur 96 : ' +
          'les moyennes peak / off-peak sont calculees sur les slots disponibles uniquement.</div>';
      }

      // ── Courbe DA
      html += sectionOpen('Courbe day-ahead FR',
        fmtDateLong(d0) + ' \u00B7 96 pas de 15 min \u00B7 ENTSO-E',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'da\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-da', 300);
      html += sectionClose();

      // ── Mix de generation
      html += sectionOpen('Mix de generation FR',
        'Puissance par filiere \u00B7 prix DA en axe secondaire',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'mix\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-mix', 320);
      html += sectionClose();

      // ── Table mix + capture du jour
      html += sectionOpen('Synthese filieres', 'Puissance moyenne, part du mix et valeur captee sur la journee');
      html += '<div class="table-wrap"><table class="fr-table"><thead><tr>' +
        '<th style="text-align:left">Filiere</th>' +
        '<th>MW moyen</th><th>Part mix</th><th>Prix capte</th><th>Capture rate</th>' +
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
        borderWidth: 2, tension: 0.25, pointRadius: 0, fill: true, spanGaps: false
      }];
      if (frPrev && frPrev.hourly) {
        ds.push({
          label: 'J-1',
          data: frPrev.hourly,
          borderColor: '#4A6280',
          borderWidth: 1.5, tension: 0.25, pointRadius: 0, fill: false,
          borderDash: [4, 3], spanGaps: false
        });
      }

      makeChart('da', 'fr-chart-da', {
        type: 'line',
        data: { labels: labels, datasets: ds },
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
        label: 'Prix DA',
        data: prices,
        type: 'line',
        borderColor: '#FFFFFF',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        yAxisID: 'y1',
        tension: 0.25
      });

      makeChart('mix', 'fr-chart-mix', {
        data: { labels: labels, datasets: mixDs },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: legendStyle() },
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
    host.innerHTML = loadingBlock('Chargement de ' + n + ' journees FR (0/' + n + ')...');

    loadDailyRange(S.date, n, function (done, total) {
      var el = host.querySelector('.fr-loading');
      if (el) el.textContent = 'Chargement de ' + total + ' journees FR (' + done + '/' + total + ')...';
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
        host.innerHTML = '<div class="fr-empty">Aucune journee exploitable sur la fenetre.</div>';
        return;
      }

      // Agregats fenetre : capture ponderee sur toute la periode, pas moyenne
      // des capture rates journaliers (qui surponderait les jours peu productifs).
      var allP = [], allS = [], allW = [];
      var totalNeg = 0;
      for (var r = 0; r < rows.length; r++) {
        allP = allP.concat(rows[r].prices);
        allS = allS.concat(rows[r].solarGen);
        allW = allW.concat(rows[r].windGen);
        totalNeg += rows[r].negH;
      }
      var aggS = captureStats(allP, allS);
      var aggW = captureStats(allP, allW);
      var aggBase = mean(allP);

      var html = '';

      html += '<div class="fr-toolbar">' +
        '<span class="fr-toolbar-label">Fenetre</span>' +
        [7, 30, 90].map(function (w) {
          return '<button class="pk-gf-btn' + (w === n ? ' active' : '') +
            '" onclick="FRDash.setCannibWindow(' + w + ')">' + w + 'J</button>';
        }).join('') +
        '<span class="fr-toolbar-note">' + rows.length + ' journees chargees \u00B7 fin ' + fmtDateLong(S.date) + '</span>' +
        '</div>';

      html += '<div class="kpi-strip fr-kpi-strip">';
      html += kpiCard('Base FR', num(aggBase, 2), '\u20AC/MWh', 'moyenne simple sur la fenetre');
      html += kpiCard('Prix capte solaire', aggS && aggS.capturePrice !== null ? num(aggS.capturePrice, 2) : '--',
        '\u20AC/MWh', 'pondere par la production');
      html += kpiCard('Capture rate solaire', aggS && aggS.captureRate !== null ? num(aggS.captureRate, 1) : '--',
        '%', aggS && aggS.captureRate !== null ? (aggS.captureRate < 100 ? 'decote vs base' : 'prime vs base') : '',
        aggS && aggS.captureRate !== null ? (aggS.captureRate < 100 ? 'down' : 'up') : 'flat');
      html += kpiCard('Prix capte eolien', aggW && aggW.capturePrice !== null ? num(aggW.capturePrice, 2) : '--',
        '\u20AC/MWh', 'pondere par la production');
      html += kpiCard('Capture rate eolien', aggW && aggW.captureRate !== null ? num(aggW.captureRate, 1) : '--',
        '%', aggW && aggW.captureRate !== null ? (aggW.captureRate < 100 ? 'decote vs base' : 'prime vs base') : '',
        aggW && aggW.captureRate !== null ? (aggW.captureRate < 100 ? 'down' : 'up') : 'flat');
      html += kpiCard('Heures negatives', num(totalNeg, 1), 'h', 'cumul sur la fenetre',
        totalNeg > 0 ? 'down' : 'flat');
      html += '</div>';

      html += sectionOpen('Capture rate journalier',
        'Prix capte / base FR \u00B7 100% = pas de decote \u00B7 fenetre ' + n + 'J',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'cap\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-capture', 300);
      html += sectionClose();

      html += sectionOpen('Profil horaire moyen',
        'Prix DA moyen et production solaire / eolienne moyenne par slot sur la fenetre',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'prof\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-profile', 300);
      html += sectionClose();

      html += sectionOpen('Detail journalier', 'Base, capture et heures negatives, jour par jour');
      html += '<div class="table-wrap"><table class="fr-table"><thead><tr>' +
        '<th style="text-align:left">Date</th><th>Base</th>' +
        '<th>Capt. solaire</th><th>CR solaire</th>' +
        '<th>Capt. eolien</th><th>CR eolien</th><th>H. neg.</th>' +
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
            { label: 'Solaire', data: rows.map(function (r) { return r.solar ? r.solar.captureRate : null; }),
              borderColor: '#FBBF24', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false, spanGaps: true },
            { label: 'Eolien', data: rows.map(function (r) { return r.wind ? r.wind.captureRate : null; }),
              borderColor: '#14D3A9', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false, spanGaps: true }
          ]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: legendStyle() },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' },
                 ticks: { color: '#7A93AB', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 14 } },
            y: axisStyle('% de la base')
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
            { type: 'line', label: 'Prix DA moyen', data: avgP, borderColor: '#FFFFFF',
              borderWidth: 2, pointRadius: 0, tension: 0.3, fill: false, yAxisID: 'y1' },
            { type: 'bar', label: 'Solaire moyen', data: avgS, backgroundColor: 'rgba(251,191,36,0.55)',
              borderWidth: 0, yAxisID: 'y', stack: 'g', barPercentage: 1, categoryPercentage: 1 },
            { type: 'bar', label: 'Eolien moyen', data: avgW, backgroundColor: 'rgba(20,211,169,0.55)',
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
    host.innerHTML = loadingBlock('Chargement de l\'historique FR...');

    loadSummary().then(function (summary) {
      var all = withRolling(frSeries(summary));
      if (!all.length) {
        host.innerHTML = '<div class="fr-empty">summary.json indisponible ou sans serie FR.</div>';
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
        '<span class="fr-toolbar-label">Periode</span>' +
        ['1Y', '3Y', '5Y', 'All'].map(function (w) {
          return '<button class="pk-gf-btn' + (w === S.histWindow ? ' active' : '') +
            '" onclick="FRDash.setHistWindow(\'' + w + '\')">' + w + '</button>';
        }).join('') +
        '<span class="fr-toolbar-note">' + series.length + ' jours \u00B7 depuis ' +
        (series[0] ? series[0].d : '--') + '</span>' +
        '</div>';

      html += '<div class="kpi-strip fr-kpi-strip">';
      html += kpiCard('Base moyenne', num(avgWin, 2), '\u20AC/MWh', 'sur la periode');
      html += kpiCard('Dernier jour', num(last.avg, 2), '\u20AC/MWh', last.d || '');
      html += kpiCard('Moyenne 30j', num(last.roll30, 2), '\u20AC/MWh', 'glissante');
      html += kpiCard('Moyenne 365j', num(last.roll365, 2), '\u20AC/MWh', 'glissante');
      html += kpiCard('Heures negatives', num(negWin, 0), 'h', 'cumul periode', negWin > 0 ? 'down' : 'flat');
      html += kpiCard('Amplitude', num(minWin, 0) + ' / ' + num(maxWin, 0), '\u20AC/MWh', 'min / max slot');
      html += '</div>';

      html += sectionOpen('Prix de base FR',
        'Journalier et moyennes glissantes \u00B7 source summary.json',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'histbase\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-histbase', 320);
      html += sectionClose();

      html += sectionOpen('Heures a prix negatif par mois',
        'Serie complete depuis ' + (all[0] ? all[0].d.slice(0, 4) : '--') + ' \u00B7 indicateur de cannibalisation',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'histneg\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-histneg', 280);
      html += sectionClose();

      html += sectionOpen('Synthese mensuelle', '12 derniers mois');
      html += '<div class="table-wrap"><table class="fr-table"><thead><tr>' +
        '<th style="text-align:left">Mois</th><th>Base</th><th>Heures negatives</th><th>Jours</th>' +
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
            { label: 'Base journaliere', data: series.map(function (r) { return r.avg; }),
              borderColor: 'rgba(20,211,169,0.35)', borderWidth: 1, pointRadius: 0, tension: 0.1, fill: false },
            { label: 'Moyenne 30j', data: series.map(function (r) { return r.roll30; }),
              borderColor: '#14D3A9', borderWidth: 2, pointRadius: 0, tension: 0.2, fill: false },
            { label: 'Moyenne 365j', data: series.map(function (r) { return r.roll365; }),
              borderColor: '#EE9B00', borderWidth: 2, pointRadius: 0, tension: 0.2, fill: false }
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
            label: 'Heures negatives',
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
            y: axisStyle('heures / mois')
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
    host.innerHTML = loadingBlock('Chargement des spreads FR...');

    loadSummary().then(function (summary) {
      if (!summary || !summary.zones) {
        host.innerHTML = '<div class="fr-empty">summary.json indisponible.</div>';
        return;
      }
      var frAll = withRolling(frSeries(summary));
      if (!frAll.length) {
        host.innerHTML = '<div class="fr-empty">Serie FR absente de summary.json.</div>';
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
        '<span class="fr-toolbar-label">Periode</span>' +
        ['1Y', '3Y', '5Y', 'All'].map(function (w) {
          return '<button class="pk-gf-btn' + (w === S.neighWindow ? ' active' : '') +
            '" onclick="FRDash.setNeighWindow(\'' + w + '\')">' + w + '</button>';
        }).join('') +
        '<span class="fr-toolbar-note">spread = base FR moins base zone \u00B7 valeur positive = FR plus cher</span>' +
        '</div>';

      html += '<div class="kpi-strip fr-kpi-strip">';
      var frAvg = mean(fr.map(function (r) { return r.avg; }));
      html += kpiCard('Base FR', num(frAvg, 2), '\u20AC/MWh', 'moyenne periode');
      spreadSeries.forEach(function (sp) {
        var m = mean(sp.data);
        html += kpiCard('Spread FR-' + sp.nb.label, num(m, 2), '\u20AC/MWh',
          m !== null ? (m >= 0 ? 'FR au-dessus' : 'FR en dessous') : '',
          m === null ? 'flat' : (m >= 0 ? 'up' : 'down'));
      });
      html += '</div>';

      html += sectionOpen('Spread FR vs zones adjacentes',
        'Base journaliere FR moins base journaliere de la zone \u00B7 summary.json',
        '<button class="pk-btn-ghost" onclick="FRDash.resetChart(\'spread\')">\u21BA Reset</button>');
      html += chartBox('fr-chart-spread', 320);
      html += sectionClose();

      html += sectionOpen('Positionnement FR', 'Base moyenne et ecart, sur la periode selectionnee');
      html += '<div class="table-wrap"><table class="fr-table"><thead><tr>' +
        '<th style="text-align:left">Zone</th><th>Base</th><th>Spread vs FR</th><th>Jours communs</th>' +
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
              borderWidth: 1.5, pointRadius: 0, tension: 0.15, fill: false, spanGaps: true
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
  // ORCHESTRATION
  // ══════════════════════════════════════════════════════════════════════════

  var RENDERERS = { today: renderToday, cannib: renderCannib, hist: renderHist, neigh: renderNeigh };

  function renderPanel(name, force) {
    document.querySelectorAll('#page-france .fr-panel').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-fr-panel') === name);
    });
    document.querySelectorAll('#page-france .fr-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-fr-tab') === name);
    });
    S.panel = name;
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
        if (body) body.innerHTML = '<div class="fr-empty">Aucune journee FR trouvee dans data/history/daily/ sur les 10 derniers jours.</div>';
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
