/* ════════════════════════════════════════════════════════════════════
   negatives.js · PowerKlock · Prices > Negative prices (redesign v2)
   STRICT clone of the Day-Ahead Daily template:
     · Section 1 "Negative price board"  → today KPI strip + per-zone table
       (ALL zones, sortable, zone-filtered, row expand = country drill)
     · Section 2 "Cross-zone analysis"   → 5 KPIs + pk-tabbar + chart + table
   Data: live global `pricesData` (array of zones) + history summary.json.
   Reuses template CSS atoms (.kpi-card.kpi-flat, .zone-row, .row-chevron,
   .is-open, .pk-tabbar) so styling is pixel-identical to Daily.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var C_NEG = '#ED6965', C_NEG_DEEP = '#66101F', C_ACC = '#14D3A9';
  var C_TX = '#FFFFFF', C_TX2 = '#B8C9D9', C_TX3 = '#7A93AB', C_BD = '#1e2d3d';

  function flag(c) { try { if (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[c]) return FLAG_MAP[c]; } catch (e) {} return ''; }
  function zname(c) { try { if (typeof ZONE_META !== 'undefined' && ZONE_META[c] && ZONE_META[c].country) return ZONE_META[c].country; } catch (e) {} return c; }

  var CC_ZONES = ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'SE', 'PL', 'FI'];

  function ic(p) { return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var ICONS = {
    grid: ic('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>'),
    bars: ic('<line x1="4" y1="20" x2="4" y2="12"/><line x1="10" y1="20" x2="10" y2="6"/><line x1="16" y1="20" x2="16" y2="9"/><line x1="20" y1="20" x2="4" y2="20"/>'),
    trend: ic('<polyline points="4 18 9 11 13 14 20 5"/>'),
    bolt: ic('<polyline points="13 3 4 14 11 14 10 21 20 9 13 9 13 3"/>'),
    cal: ic('<rect x="4" y="5" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="9" y1="3" x2="9" y2="7"/><line x1="15" y1="3" x2="15" y2="7"/>'),
    chart: ic('<line x1="4" y1="20" x2="20" y2="20"/><polyline points="4 14 9 9 13 12 20 5"/>'),
    rank: ic('<line x1="4" y1="7" x2="14" y2="7"/><line x1="4" y1="12" x2="18" y2="12"/><line x1="4" y1="17" x2="10" y2="17"/>'),
    map: ic('<rect x="4" y="6" width="16" height="12" rx="1"/><line x1="9" y1="6" x2="9" y2="18"/><line x1="14" y1="6" x2="14" y2="18"/>')
  };

  var NEG = { win: '1Y', ccView: 'year', sortKey: 'negHours', sortDir: -1, zoneFilter: null, openRow: null, drillView: {}, summary: null, _retries: 0 };

  // ── Live data access ──────────────────────────────────────────────
  function rawZones() {
    try { if (typeof pricesData !== 'undefined' && Array.isArray(pricesData) && pricesData.length) return pricesData; } catch (e) {}
    try { if (Array.isArray(window.pricesData) && window.pricesData.length) return window.pricesData; } catch (e) {}
    return [];
  }
  // Price rows come from several loaders with different field names
  // (negHrs/minHr from the daily-history loader, negHours/minHour from
  // prices.json). Normalise once, deriving neg hours, min and its slot
  // from the 15-min curve itself so the board can never disagree with the
  // window / run / %neg columns, which also read the curve.
  function getZones() {
    return rawZones().map(function (z) {
      var h = z.hourly || [], len = h.length, o = Object.assign({}, z);
      if (len) {
        var neg = 0, mn = Infinity, mi = -1;
        for (var i = 0; i < len; i++) { var v = h[i]; if (v == null) continue; if (v < 0) neg++; if (v < mn) { mn = v; mi = i; } }
        o.negHours = neg * 24 / len;
        if (mi >= 0) { o.min = mn; o.minHour = slotTime(mi, len); }
      } else {
        o.negHours = z.negHours != null ? z.negHours : (z.negHrs || 0);
      }
      return o;
    });
  }
  function loadSummary() {
    if (NEG.summary) return Promise.resolve(NEG.summary);
    if (typeof fetchSummary === 'function') return fetchSummary().then(function (s) { NEG.summary = s; return s; }).catch(function () { return null; });
    var base = (typeof DATA_BASE !== 'undefined' && DATA_BASE) ? DATA_BASE : './data/';
    return window.pkSummary().then(function (s) { NEG.summary = s; return s; }).catch(function () { return null; });
  }

  // ── Helpers ────────────────────────────────────────────────────────
  function n2(v, d) { if (v == null || isNaN(v)) return '–'; return Number(v).toFixed(d == null ? 1 : d); }
  function slotTime(i, len) { var step = Math.round(24 * 60 / (len || 24)); var m = i * step, hh = Math.floor(m / 60), mm = m % 60; return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; }
  function negWindow(h) { if (!h || !h.length) return '–'; var f = -1, l = -1; for (var i = 0; i < h.length; i++) if (h[i] != null && h[i] < 0) { if (f < 0) f = i; l = i; } if (f < 0) return '–'; return slotTime(f, h.length) + '–' + slotTime(l + 1, h.length); }
  function longestRun(h) { if (!h || !h.length) return 0; var st = 24 / h.length, r = 0, b = 0; for (var i = 0; i < h.length; i++) { if (h[i] != null && h[i] < 0) { r++; if (r > b) b = r; } else r = 0; } return b * st; }
  function negPct(h) { if (!h || !h.length) return 0; var v = h.filter(function (x) { return x != null; }); if (!v.length) return 0; return v.filter(function (x) { return x < 0; }).length / v.length * 100; }
  function inFilter(code) { return !NEG.zoneFilter || NEG.zoneFilter.has(code); }

  // History coverage: many zones only have a few months of daily files, so a
  // yearly total over a partial year must not be shown as if it were complete.
  function yearDays(s) { var o = {}; if (s) s.forEach(function (d) { var y = d.d.slice(0, 4); o[y] = (o[y] || 0) + 1; }); return o; }
  function expectedDays(y) { if (y === curYear()) return doy(pkTodayISO()); var n = +y; return (n % 4 === 0 && (n % 100 !== 0 || n % 400 === 0)) ? 366 : 365; }
  function yearComplete(s, y) { return (yearDays(s)[y] || 0) >= 0.95 * expectedDays(y); }
  function yearSum(s) { var o = {}; if (s) s.forEach(function (d) { var y = d.d.slice(0, 4); o[y] = (o[y] || 0) + (d.negH || 0); }); return o; }
  function monthSum(s, yf) { var o = new Array(12).fill(0); if (s) s.forEach(function (d) { if (yf && d.d.slice(0, 4) !== yf) return; o[+d.d.slice(5, 7) - 1] += (d.negH || 0); }); return o; }
  function deepest(s) { var mn = 0, dt = null; if (s) s.forEach(function (d) { if (d.min != null && d.min < mn) { mn = d.min; dt = d.d; } }); return { v: mn, d: dt }; }
  function winDays(w) { return ({ '1M': 31, '3M': 92, '1Y': 365, '2Y': 730, '5Y': 1825, 'all': 99999 }[w] || 365); }
  function trailing(s, w) { if (!s) return []; if (w === 'all') return s; return s.slice(-winDays(w)); }
  function curYear() { return String(new Date().getFullYear()); }
  function doy(ds) { var d = new Date(ds); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); }

  // ════════════════════════════════════════════════════════════════
  // SECTION 1 · BOARD
  // ════════════════════════════════════════════════════════════════
  function renderBoardKpis() {
    var el = document.getElementById('neg-board-kpis'); if (!el) return;
    var z = getZones();
    var fr = z.find(function (x) { return x.code === 'FR'; }), de = z.find(function (x) { return x.code === 'DE_LU'; });
    var inNeg = z.filter(function (x) { return (x.negHours || 0) > 0; });
    var total = inNeg.reduce(function (a, x) { return a + (x.negHours || 0); }, 0);
    var dp = { v: 0, z: '' }; z.forEach(function (x) { if (x.min != null && x.min < dp.v) dp = { v: x.min, z: x.code, hr: x.minHour }; });
    var lr = { h: 0, z: '' }; z.forEach(function (x) { var r = longestRun(x.hourly); if (r > lr.h) lr = { h: r, z: x.code }; });
    var most = inNeg.slice().sort(function (a, b) { return (b.negHours || 0) - (a.negHours || 0); })[0];
    // other: figures about zones other than France (hidden in the France view, js/scope.js)
    function card(lbl, val, unit, sub, dn, zoneMeta, other) {
      return '<div class="kpi-card ' + (dn ? 'kpi-down' : 'kpi-flat') + (other ? ' neg-kpi-other' : '') + '"><div class="kpi-label">' + lbl + '</div>' +
        '<div class="kpi-value"' + (dn ? ' style="color:' + C_NEG + '"' : '') + '>' + val + (unit ? '<span class="kpi-unit">' + unit + '</span>' : '') + '</div>' +
        (zoneMeta ? '<div class="kpi-meta kpi-meta-zone">' + (sub || '') + '</div>' : '<div class="kpi-chg">' + (sub || '') + '</div>') + '</div>';
    }
    // none today: when was the last negative price (history summary)
    function lastNeg(code) {
      var ser = NEG.summary && NEG.summary.zones && NEG.summary.zones[code]; if (!ser) return 'none today';
      for (var i = ser.length - 1; i >= 0; i--) if ((ser[i].negH || 0) > 0) return 'none today · last ' + ser[i].d + ' (' + n2(ser[i].negH, 1) + ' h)';
      return 'none today';
    }
    el.innerHTML =
      card('FR neg hours', fr ? n2(fr.negHours, 2) : '–', 'h', fr && fr.min != null && fr.negHours > 0 ? 'min ' + n2(fr.min, 2) + ' · ' + (fr.minHour || '') : lastNeg('FR'), fr && fr.negHours > 0) +
      card('DE neg hours', de ? n2(de.negHours, 2) : '–', 'h', de && de.min != null && de.negHours > 0 ? 'min ' + n2(de.min, 2) + ' · ' + (de.minHour || '') : lastNeg('DE_LU'), de && de.negHours > 0, false, true) +
      card('Zones in negative', inNeg.length, '/' + z.length, 'loaded today', false, false, true) +
      card('Total neg hours', n2(total, 2), 'h', 'across all zones', total > 0, false, true) +
      card('Deepest print', dp.z ? n2(dp.v, 2) : '–', '€/MWh', dp.z ? flag(dp.z) + ' ' + dp.z + (dp.hr ? ' · ' + dp.hr : '') : 'none', dp.z, true, true) +
      card('Longest run', lr.z ? n2(lr.h, 2) : '–', 'h', lr.z ? flag(lr.z) + ' ' + lr.z : 'none', lr.h > 0, true, true) +
      card('Most neg hours', most ? n2(most.negHours, 2) : '–', 'h', most ? flag(most.code) + ' ' + most.code : 'none', most, true, true);
  }

  function spark(hourly) {
    if (typeof makeSVGSparklineSmooth === 'function') {
      try {
        var raw = (hourly || []).filter(function (v) { return v != null; });
        if (raw.length > 24) { var step = raw.length / 24, ds = []; for (var i = 0; i < 24; i++) { var sl = raw.slice(Math.floor(i * step), Math.floor((i + 1) * step)); ds.push(sl.reduce(function (a, b) { return a + b; }, 0) / (sl.length || 1)); } raw = ds; }
        return makeSVGSparklineSmooth(raw, 'mixed');
      } catch (e) {}
    }
    return localSpark(hourly);
  }
  function localSpark(hourly) {
    if (!hourly || !hourly.length) return '';
    var arr = hourly.filter(function (v) { return v != null; });
    var w = 120, h = 26, nn = arr.length, mx = Math.max.apply(null, arr.concat([5])), mn = Math.min.apply(null, arr.concat([-2]));
    var X = function (i) { return i * (w / (nn - 1)); }, Y = function (v) { return h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4); }, z = Y(0);
    var line = 'M' + arr.map(function (v, i) { return X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' L');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><line x1="0" y1="' + z.toFixed(1) + '" x2="' + w + '" y2="' + z.toFixed(1) + '" stroke="' + C_NEG + '" stroke-width=".6" stroke-dasharray="2 2" opacity=".55"/><path d="' + line + '" fill="none" stroke="' + C_ACC + '" stroke-width="1.3"/></svg>';
  }

  function boardRows() {
    var z = getZones().filter(function (x) { return x.today != null && !isNaN(x.today) && inFilter(x.code); });
    z = z.map(function (x) { return { z: x, run: longestRun(x.hourly), pct: negPct(x.hourly), win: negWindow(x.hourly) }; });
    var k = NEG.sortKey, dir = NEG.sortDir;
    z.sort(function (a, b) {
      var av, bv;
      if (k === 'code') { av = a.z.code; bv = b.z.code; return dir * (av < bv ? -1 : av > bv ? 1 : 0); }
      if (k === 'country') { av = zname(a.z.code); bv = zname(b.z.code); return dir * (av < bv ? -1 : av > bv ? 1 : 0); }
      if (k === 'run') { av = a.run; bv = b.run; }
      else if (k === 'pct') { av = a.pct; bv = b.pct; }
      else if (k === 'window') { av = a.win === '–' ? 'zzz' : a.win; bv = b.win === '–' ? 'zzz' : b.win; return dir * (av < bv ? -1 : av > bv ? 1 : 0); }
      else { av = a.z[k]; bv = b.z[k]; if (av == null) av = (k === 'min' ? 1e9 : -1e9); if (bv == null) bv = (k === 'min' ? 1e9 : -1e9); }
      return dir * ((av || 0) - (bv || 0));
    });
    return z;
  }

  function renderBoardTable() {
    var tb = document.getElementById('neg-board-tbody'); if (!tb) return;
    var z = getZones();
    var meta = document.getElementById('neg-board-meta');
    var inNeg = z.filter(function (x) { return (x.negHours || 0) > 0; }).length;
    if (meta) meta.textContent = z.length ? (z.length + ' zones · ' + inNeg + ' in negative') : '--';
    var title = document.getElementById('neg-board-title');
    if (title) title.textContent = 'Negative-price board · today · ENTSO-E';
    var rows = boardRows();
    if (!rows.length) { tb.innerHTML = '<tr class="loading-row"><td colspan="9"><span class="spinner"></span> Loading ENTSO-E data...</td></tr>'; return; }
    var html = '';
    rows.forEach(function (r) {
      var x = r.z, isNeg = (x.negHours || 0) > 0;
      var negCol = isNeg ? C_NEG : C_TX3;
      html += '<tr class="zone-row" data-code="' + x.code + '" onclick="negToggleRow(\'' + x.code + '\')">' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;color:var(--tx2);text-align:left"><svg class="row-chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;opacity:.45;vertical-align:0"><polyline points="9 18 15 12 9 6"/></svg>' + flag(x.code) + ' ' + x.code + '</td>' +
        '<td style="font-size:11px;color:var(--tx2);text-align:left">' + zname(x.code) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-weight:700;color:' + negCol + ';text-align:right">' + (isNeg ? n2(x.negHours, 2) : '<span style="color:var(--tx3)">–</span>') + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_NEG + ';text-align:right">' + (x.min != null && x.min < 0 ? n2(x.min, 2) : '<span style="color:var(--tx3)">–</span>') + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:var(--tx3);text-align:right">' + r.win + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:var(--tx2);text-align:right">' + (r.run > 0 ? n2(r.run, 2) : '<span style="color:var(--tx3)">–</span>') + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + (r.pct > 0 ? C_NEG : 'var(--tx3)') + ';text-align:right">' + (r.pct > 0 ? n2(r.pct, 0) + '%' : '–') + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + (x.spark < 0 ? C_NEG : 'var(--tx2)') + ';text-align:right">' + (x.spark != null ? n2(x.spark, 1) : '–') + '</td>' +
        '<td class="sparkline-cell" style="text-align:center">' + spark(x.hourly) + '</td>' +
      '</tr>' +
      '<tr id="neg-detail-' + x.code + '" style="display:none"><td colspan="9" style="padding:0;background:#141a22;border-bottom:2px solid var(--bd2)"><div style="padding:14px 16px" id="neg-detail-inner-' + x.code + '"></div></td></tr>';
    });
    tb.innerHTML = html;
  }

  window.negSort = function (key) {
    if (NEG.sortKey === key) NEG.sortDir *= -1;
    else { NEG.sortKey = key; NEG.sortDir = (key === 'code' || key === 'country') ? 1 : -1; }
    renderBoardTable();
  };

  // ── Zone filter (own Set, identical markup) ──
  function buildZoneChips() {
    var host = document.getElementById('neg-zone-filter-chips'); if (!host) return;
    var z = getZones().slice().sort(function (a, b) { return (b.negHours || 0) - (a.negHours || 0) || (a.code < b.code ? -1 : 1); });
    host.innerHTML = z.map(function (x) {
      var on = inFilter(x.code);
      return '<div onclick="negToggleZone(\'' + x.code + '\')" style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:11px;font-family:\'JetBrains Mono\',monospace;color:' + (on ? 'var(--tx)' : 'var(--tx3)') + '">' +
        '<span style="width:13px;height:13px;border-radius:3px;border:1px solid ' + (on ? 'var(--acc)' : 'var(--bd)') + ';background:' + (on ? 'var(--acc)' : 'transparent') + ';color:#000;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700">' + (on ? '✓' : '') + '</span>' +
        flag(x.code) + ' ' + x.code + '<span style="color:var(--tx3);margin-left:auto">' + ((x.negHours || 0) > 0 ? n2(x.negHours, 1) + 'h' : '') + '</span></div>';
    }).join('');
  }
  function syncZoneLabel() {
    var lbl = document.getElementById('neg-zone-btn-label'); if (!lbl) return;
    var z = getZones();
    lbl.textContent = NEG.zoneFilter ? (NEG.zoneFilter.size + ' / ' + z.length + ' zones') : 'All zones';
  }
  window.negToggleZonePanel = function () {
    var p = document.getElementById('neg-zone-filter-panel'); var btn = document.getElementById('neg-zone-btn'); if (!p || !btn) return;
    var open = p.style.display !== 'none';
    if (open) { p.style.display = 'none'; return; }
    buildZoneChips();
    var r = btn.getBoundingClientRect();
    p.style.left = Math.max(8, r.left) + 'px'; p.style.top = (r.bottom + 6) + 'px';
    p.style.display = 'block';
  };
  window.negToggleZone = function (code) {
    var all = getZones().map(function (x) { return x.code; });
    if (!NEG.zoneFilter) NEG.zoneFilter = new Set(all);
    if (NEG.zoneFilter.has(code)) NEG.zoneFilter.delete(code); else NEG.zoneFilter.add(code);
    if (NEG.zoneFilter.size === all.length) NEG.zoneFilter = null;
    buildZoneChips(); syncZoneLabel(); renderBoardTable(); renderBoardKpis();
  };
  // Site scope (js/scope.js): null = all zones, or an array of zone codes.
  window.negSetZones = function (codes) { NEG.zoneFilter = codes ? new Set(codes) : null; buildZoneChips(); syncZoneLabel(); try { renderBoardTable(); renderBoardKpis(); } catch (_) {} };
  window.negZonesAll = function () { NEG.zoneFilter = null; buildZoneChips(); syncZoneLabel(); renderBoardTable(); renderBoardKpis(); };
  window.negZonesNeg = function () { NEG.zoneFilter = new Set(getZones().filter(function (x) { return (x.negHours || 0) > 0; }).map(function (x) { return x.code; })); buildZoneChips(); syncZoneLabel(); renderBoardTable(); renderBoardKpis(); };
  document.addEventListener('click', function (e) {
    var p = document.getElementById('neg-zone-filter-panel'); if (!p || p.style.display === 'none') return;
    if (!e.target.closest('#neg-zone-filter-wrap')) p.style.display = 'none';
  });

  // ── Row expand → drill ──
  window.negToggleRow = function (code) {
    var det = document.getElementById('neg-detail-' + code); if (!det) return;
    var row = document.querySelector('.zone-row[data-code="' + code + '"]');
    var open = det.style.display !== 'none';
    document.querySelectorAll('#neg-board-tbody tr[id^="neg-detail-"]').forEach(function (r) { r.style.display = 'none'; });
    document.querySelectorAll('#neg-board-tbody .zone-row').forEach(function (r) { r.classList.remove('is-open'); });
    if (!open) { det.style.display = ''; if (row) row.classList.add('is-open'); NEG.openRow = code; if (!NEG.drillView[code]) NEG.drillView[code] = 'month'; renderDrill(code); }
    else NEG.openRow = null;
  };

  // ════════════════════════════════════════════════════════════════
  // COUNTRY DRILL (mirrors DA row drill)
  // ════════════════════════════════════════════════════════════════
  function renderDrill(code) {
    var host = document.getElementById('neg-detail-inner-' + code); if (!host) return;
    var s = NEG.summary, series = s && s.zones && s.zones[code];
    var cy = curYear(), ly = String(+cy - 1);
    var ys = yearSum(series), ms = monthSum(series), dp = deepest(series);
    var peakM = 0; for (var i = 1; i < 12; i++) if (ms[i] > ms[peakM]) peakM = i;
    var daysNeg = series ? series.filter(function (d) { return d.d.slice(0, 4) === cy && (d.negH || 0) > 0; }).length : 0;
    var daysTot = series ? series.filter(function (d) { return d.d.slice(0, 4) === cy; }).length : 0;
    var maxDay = series ? series.reduce(function (m, d) { return Math.max(m, d.negH || 0); }, 0) : 0;
    var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var view = NEG.drillView[code] || 'month';
    function kc(lbl, val, unit, sub, dn, zm) { return '<div class="kpi-card ' + (dn ? 'kpi-down' : 'kpi-flat') + '"><div class="kpi-label">' + lbl + '</div><div class="kpi-value"' + (dn ? ' style="color:' + C_NEG + '"' : '') + '>' + val + (unit ? '<span class="kpi-unit">' + unit + '</span>' : '') + '</div>' + (zm ? '<div class="kpi-meta kpi-meta-zone">' + (sub || '') + '</div>' : '<div class="kpi-chg">' + (sub || '') + '</div>') + '</div>'; }
    var TABS = [
      { k: 'month', i: ICONS.bars, l: 'By month' }, { k: 'year', i: ICONS.bars, l: 'Per year' },
      { k: 'cumul', i: ICONS.trend, l: 'Pace' }, { k: 'cal', i: ICONS.cal, l: 'Calendar' },
      { k: 'daily', i: ICONS.chart, l: 'Daily' }, { k: 'hour', i: ICONS.bolt, l: 'Hour of day' }, { k: 'mh', i: ICONS.grid, l: 'Month × hour' }
    ];
    var tabs = TABS.map(function (t) { var on = t.k === view; return '<button onclick="negSetDrillView(\'' + code + '\',\'' + t.k + '\')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:' + (on ? 'var(--bg3)' : 'transparent') + ';color:' + (on ? 'var(--text)' : 'var(--text3)') + ';font-family:\'Inter\',sans-serif;font-weight:500;letter-spacing:.03em">' + t.i + t.l + '</button>'; }).join('');
    host.innerHTML =
      '<div class="pk-section-header"><div class="pk-section-header-text">' +
        '<div class="pk-eyebrow">Negative prices <span class="pk-sep">·</span> ' + flag(code) + ' ' + code + ' <span class="pk-sep">·</span> Country detail</div>' +
        '<div class="pk-section-title">' + zname(code) + ' — negative-price profile</div>' +
        '<div class="pk-section-subtitle">' + (series ? series.length + ' days · ' + series[0].d + ' → ' + series[series.length - 1].d : 'no history') + ' · ENTSO-E</div></div>' +
        '<div class="pk-section-header-actions"><button class="pk-btn-ghost" onclick="event.stopPropagation();negToggleRow(\'' + code + '\')">✕ Close</button></div></div>' +
      '<div class="kpi-strip" style="grid-template-columns:repeat(6,1fr);margin-bottom:14px">' +
        kc('Neg h ' + cy, n2(ys[cy] || 0, 0), 'h', 'YTD', (ys[cy] || 0) > 0) +
        kc('Neg h ' + ly, n2(ys[ly] || 0, 0), 'h', 'full year', false) +
        kc('Deepest', dp.d ? n2(dp.v, 0) : '–', '€/MWh', dp.d || '', dp.d, true) +
        kc('Days neg ' + cy, daysNeg, '/' + daysTot, daysTot ? Math.round(daysNeg / daysTot * 100) + '% of days' : '', false) +
        kc('Max neg/day', n2(maxDay, 1), 'h', 'single day', false) +
        kc('Peak month', MN[peakM], '', n2(ms[peakM], 0) + 'h cumul', (ms[peakM] || 0) > 0, true) +
      '</div>' +
      '<div class="pk-tabbar"><div class="pk-tabbar-left"><div class="pk-tabbar-tabs">' + tabs + '</div></div></div>' +
      '<div id="neg-drill-chart-' + code + '" style="position:relative;min-height:300px"></div>';
    renderDrillChart(code, view, series);
  }
  window.negSetDrillView = function (code, v) { NEG.drillView[code] = v; renderDrill(code); };
  // Fullscreen of a country drill: same KPIs, view tabs and chart (SVG/HTML views).
  window.negDrillFullscreen = function (code) {
    if (typeof window.pkOpenFullscreen !== 'function') return;
    var host = document.getElementById('neg-detail-inner-' + code); if (!host) return;
    var kpis = host.querySelector('.kpi-strip');
    var view = NEG.drillView[code] || 'month';
    var TABS = [['month', 'By month'], ['year', 'Per year'], ['cumul', 'Cumulative'], ['cal', 'Calendar'], ['daily', 'Daily bars'], ['mh', 'Month×hour'], ['driver', 'Driver']];
    var tabsHtml = TABS.map(function (t) {
      var on = t[0] === view;
      return '<button onclick="negSetDrillView(\'' + code + '\',\'' + t[0] + '\');negDrillRefreshFullscreen(\'' + code + '\')" style="padding:3px 8px;font-size:10px;border:none;cursor:pointer;border-radius:3px;color:' +
        (on ? '#14D3A9' : '#7A93AB') + ';background:' + (on ? 'rgba(20,211,169,0.18)' : 'transparent') +
        ';font-family:\'JetBrains Mono\',monospace;font-weight:600;letter-spacing:.02em">' + t[1] + '</button>';
    }).join('');
    var titleEl = document.getElementById('neg-drill-title-' + code);
    (window.pkOpenOrUpdate || window.pkOpenFullscreen)({
      title: 'Negative prices — ' + zname(code),
      subtitle: titleEl && titleEl.firstChild ? [].map.call(titleEl.firstChild.children, function (e) { return e.textContent.trim(); }).filter(Boolean).join(' · ') : '',
      filenameStem: 'powerklock_negative_' + code + '_' + view,
      storageKey: 'negative-drill',
      kpis: kpis ? { html: '<div class="kpi-strip" style="grid-template-columns:repeat(6,1fr);width:100%">' + kpis.innerHTML + '</div>' } : null,
      filters: { html: '<div class="pk-fs-filters-left"><div style="display:flex;align-items:center;gap:5px"><span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:\'JetBrains Mono\',monospace">View</span>' +
        '<div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">' + tabsHtml + '</div></div></div>' },
      chartSource: window.pkBuildChartSource({ htmlContainerId: 'neg-drill-chart-' + code, isHtmlView: function () { return true; } }),
    });
    var o = document.getElementById('pk-fs-overlay');
    if (o) o.setAttribute('data-fs-context', 'neg-drill');
  };
  window.negDrillRefreshFullscreen = function (code) {
    if (typeof window.pkFsIsOpen === 'function' && window.pkFsIsOpen('neg-drill')) window.negDrillFullscreen(code);
  };

  function renderDrillChart(code, view, series) {
    if (view === 'driver') view = 'hour';
    if (window.NegCharts) window.NegCharts.zone(code, view, NEG.win);
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 2 · CROSS-ZONE
  // ════════════════════════════════════════════════════════════════
  function renderCCKpis() {
    var el = document.getElementById('neg-cc-kpis'); if (!el) return;
    var s = NEG.summary, zk = (s && s.zones) ? Object.keys(s.zones) : [], cy = curYear();
    var most = { h: 0, z: '', y: '' }, deep = { v: 0, z: '' }, euTot = 0, euN = 0;
    CC_ZONES.forEach(function (c) { var ser = s && s.zones && s.zones[c]; if (!ser) return; var ys = yearSum(ser); Object.keys(ys).forEach(function (y) { if (yearComplete(ser, y) && ys[y] > most.h) most = { h: ys[y], z: c, y: y }; }); if (yearComplete(ser, String(+cy - 1))) { euTot += ys[String(+cy - 1)] || 0; euN++; } var dp = deepest(ser); if (dp.v < deep.v) deep = { v: dp.v, z: c }; });
    function kc(lbl, val, unit, sub, dn, zm) { return '<div class="kpi-card ' + (dn ? 'kpi-down' : 'kpi-flat') + '"><div class="kpi-label">' + lbl + '</div><div class="kpi-value"' + (dn ? ' style="color:' + C_NEG + '"' : '') + '>' + val + (unit ? '<span class="kpi-unit">' + unit + '</span>' : '') + '</div>' + (zm ? '<div class="kpi-meta kpi-meta-zone">' + (sub || '') + '</div>' : '<div class="kpi-meta">' + (sub || '') + '</div>') + '</div>'; }
    el.innerHTML =
      kc('Zones with history', zk.length || '–', '', CC_ZONES.length + ' featured below', false) +
      kc('Most neg h', n2(most.h, 0), 'h', most.z ? flag(most.z) + ' ' + most.z + ' · ' + most.y : '', most.z, true) +
      kc('Deepest print', deep.z ? n2(deep.v, 0) : '–', '€/MWh', deep.z ? flag(deep.z) + ' ' + deep.z : '', deep.z, true) +
      kc('EU total ' + (+cy - 1), n2(euTot, 0), 'h', euN + ' zone' + (euN > 1 ? 's' : '') + ' with full history', euTot > 0) +
      kc('Reference', cy, '', 'current year', false);
  }
  function renderCCTabs() {
    var el = document.getElementById('neg-cc-tabs'); if (!el) return;
    var V = [{ k: 'year', i: ICONS.bars, l: 'By zone × year' }, { k: 'rank', i: ICONS.rank, l: 'Ranking' }, { k: 'season', i: ICONS.map, l: 'Seasonality' }, { k: 'hour', i: ICONS.bolt, l: 'Hour of day' }, { k: 'cumul', i: ICONS.trend, l: 'Pace this year' }];
    el.innerHTML = V.map(function (v) { var on = v.k === NEG.ccView; return '<button onclick="negSetCCView(\'' + v.k + '\')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:' + (on ? 'var(--bg3)' : 'transparent') + ';color:' + (on ? 'var(--text)' : 'var(--text3)') + ';font-family:\'Inter\',sans-serif;font-weight:500;letter-spacing:.03em">' + v.i + v.l + '</button>'; }).join('');
  }
  window.negSetCCView = function (v) { NEG.ccView = v; renderCCTabs(); renderCCChart(); };
  function renderCCChart() {
    if (NEG.ccView === 'monthhm') NEG.ccView = 'season';
    if (window.NegCharts) window.NegCharts.cc(NEG.ccView, NEG.win);
  }
  function renderCCTable() {
    var tb = document.getElementById('neg-cc-tbody'); if (!tb) return;
    var s = NEG.summary; if (!s || !s.zones) { tb.innerHTML = ''; return; }
    var cy = curYear(), ly = String(+cy - 1);
    var rows = CC_ZONES.filter(function (c) { return s.zones[c]; }).map(function (c) {
      var ser = s.zones[c], ys = yearSum(ser), dp = deepest(ser), prevY = ys[ly] || 0;
      var daysNeg = ser.filter(function (d) { return d.d.slice(0, 4) === ly && (d.negH || 0) > 0; }).length;
      var py2 = ys[String(+ly - 1)] || 0, pct = py2 ? Math.round((prevY - py2) / py2 * 100) : null;
      var full = yearComplete(ser, ly), full2 = yearComplete(ser, String(+ly - 1));
      if (!full2) pct = null;
      return { c: c, h: full ? Math.round(prevY) : null, deep: dp.v, days: full ? daysNeg : null, vy: full ? pct : null, spark: yearsSpark(ys), cov: (yearDays(ser)[ly] || 0) };
    }).sort(function (a, b) { return (b.h == null ? -1 : b.h) - (a.h == null ? -1 : a.h); });
    var na = function (r) { return '<span style="color:var(--tx3)" title="Incomplete history for ' + ly + ': ' + r.cov + ' days">n/a</span>'; };
    tb.innerHTML = rows.map(function (r) {
      return '<tr><td style="font-family:\'JetBrains Mono\',monospace;font-weight:700;color:var(--tx2);text-align:left">' + flag(r.c) + ' ' + r.c + '</td>' +
        '<td style="text-align:left;color:var(--tx3)">' + zname(r.c) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_NEG + ';font-weight:600;text-align:right">' + (r.h == null ? na(r) : r.h) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_NEG + ';text-align:right">' + (r.deep ? Math.round(r.deep) : '–') + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:var(--tx2);text-align:right">' + (r.days == null ? na(r) : r.days) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;text-align:right;color:' + (r.vy > 0 ? C_NEG : C_ACC) + '">' + (r.vy == null ? '–' : (r.vy > 0 ? '+' : '') + r.vy + '%') + '</td>' +
        '<td style="text-align:left;color:var(--tx3);letter-spacing:2px">' + r.spark + '</td></tr>';
    }).join('');
  }
  function yearsSpark(ys) { var years = Object.keys(ys).sort(); if (!years.length) return ''; var vals = years.map(function (y) { return ys[y]; }), max = Math.max.apply(null, vals.concat([1])), b = '▁▂▃▄▅▆▇█'; return vals.slice(-7).map(function (v) { return b[Math.min(7, Math.round(v / max * 7))]; }).join(''); }

  // ── Window pills ──
  window.negSetWindow = function (w, btn) { NEG.win = w; if (btn && btn.parentNode) { btn.parentNode.querySelectorAll('.pk-gf-btn').forEach(function (b) { b.classList.remove('active'); }); btn.classList.add('active'); } try { renderCCChart(); } catch (e) {} if (NEG.openRow) { try { renderDrill(NEG.openRow); } catch (e) {} } };

  // ── Cross-zone fullscreen · same pk-fs overlay used by HMZ/DA Cross-zone.
  // All four views here (year/rank/monthhm/cumul) render raw SVG/HTML into
  // #neg-cc-chart rather than a Chart.js canvas, so pkBuildChartSource is
  // used purely in its "HTML mirror" mode (isHtmlView always true) — it just
  // clones the already-rendered markup into the overlay.
  var CC_VIEWS = [
    { k: 'year', l: 'By zone × year' }, { k: 'rank', l: 'Ranking' },
    { k: 'monthhm', l: 'Heatmap zone×month' }, { k: 'cumul', l: 'Cumulative' }
  ];
  window.negCCFullscreen = function () {
    if (typeof window.pkOpenFullscreen !== 'function') { console.error('[negCCFullscreen] pkOpenFullscreen is not loaded'); return; }

    var inlineKpis = document.getElementById('neg-cc-kpis');
    var kpisHtml = inlineKpis ? '<div class="kpi-strip" style="grid-template-columns:repeat(5,1fr);width:100%">' + inlineKpis.innerHTML + '</div>' : null;

    var inlineTableWrap = document.getElementById('neg-cc-table');
    inlineTableWrap = inlineTableWrap ? inlineTableWrap.closest('.table-wrap') : null;
    var tableHtml = inlineTableWrap ? inlineTableWrap.outerHTML : null;

    var tabsHtml = CC_VIEWS.map(function (v) {
      var on = v.k === NEG.ccView;
      return '<button onclick="Promise.resolve(negSetCCView(\'' + v.k + '\')).then(negCCRefreshFullscreen)" style="padding:3px 8px;font-size:10px;border:none;cursor:pointer;border-radius:3px;color:' +
        (on ? '#14D3A9' : '#7A93AB') + ';background:' + (on ? 'rgba(20,211,169,0.18)' : 'transparent') +
        ';font-family:\'JetBrains Mono\',monospace;font-weight:600;letter-spacing:.02em">' + v.l + '</button>';
    }).join('');
    var filtersHtml = '<div class="pk-fs-filters-left"><div style="display:flex;align-items:center;gap:5px">' +
      '<span style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-family:\'JetBrains Mono\',monospace">View</span>' +
      '<div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px">' + tabsHtml + '</div></div></div>';

    var titleEl = document.getElementById('neg-cc-title');
    var subtitleEl = document.getElementById('neg-cc-subtitle');

    (window.pkOpenOrUpdate || window.pkOpenFullscreen)({
      title: 'Negative prices — ' + (titleEl ? titleEl.textContent : 'Cross-zone analysis'),
      subtitle: subtitleEl ? subtitleEl.textContent : '',
      filenameStem: 'powerklock_negative_crosszone_' + NEG.ccView,
      storageKey: 'negative-crosszone',
      kpis: kpisHtml ? { html: kpisHtml } : null,
      table: tableHtml ? { html: tableHtml } : null,
      filters: { html: filtersHtml },
      chartSource: window.pkBuildChartSource({
        htmlContainerId: 'neg-cc-chart',
        isHtmlView: function () { return true; },
      }),
    });

    var overlayEl = document.getElementById('pk-fs-overlay');
    if (overlayEl) overlayEl.setAttribute('data-fs-context', 'neg-cc');
  };
  window.negCCRefreshFullscreen = function () {
    if (typeof window.pkFsIsOpen === 'function' && window.pkFsIsOpen('neg-cc')) window.negCCFullscreen();
  };

  // ════════════════════════════════════════════════════════════════
  // ENTRY POINT
  // ════════════════════════════════════════════════════════════════
  function renderAll() {
    var zones = getZones();
    // board first (live prices) — retry if prices.js hasn't populated yet
    if (!zones.length && NEG._retries < 8) { NEG._retries++; setTimeout(renderAll, 500); return; }
    NEG._retries = 0;
    try { renderBoardKpis(); } catch (e) { console.warn('[neg] board kpis', e); }
    try { renderBoardTable(); } catch (e) { console.warn('[neg] board table', e); }
    try { syncZoneLabel(); } catch (e) {}
    // cross-zone + drill need history summary
    loadSummary().then(function () {
      try { renderBoardKpis(); } catch (e) {}
      try { renderCCKpis(); } catch (e) { console.warn('[neg] cc kpis', e); }
      try { renderCCTabs(); } catch (e) { console.warn('[neg] cc tabs', e); }
      try { renderCCChart(); } catch (e) { console.warn('[neg] cc chart', e); }
      try { renderCCTable(); } catch (e) { console.warn('[neg] cc table', e); }
      if (NEG.openRow) { try { renderDrill(NEG.openRow); } catch (e) {} }
    });
  }
  window.negRenderAll = renderAll;
})();
