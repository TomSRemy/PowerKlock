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
  function getZones() {
    try { if (typeof pricesData !== 'undefined' && Array.isArray(pricesData) && pricesData.length) return pricesData; } catch (e) {}
    try { if (Array.isArray(window.pricesData) && window.pricesData.length) return window.pricesData; } catch (e) {}
    return [];
  }
  function loadSummary() {
    if (NEG.summary) return Promise.resolve(NEG.summary);
    if (typeof fetchSummary === 'function') return fetchSummary().then(function (s) { NEG.summary = s; return s; }).catch(function () { return null; });
    var base = (typeof DATA_BASE !== 'undefined' && DATA_BASE) ? DATA_BASE : './data/';
    return fetch(base + 'history/summary.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (s) { NEG.summary = s; return s; }).catch(function () { return null; });
  }

  // ── Helpers ────────────────────────────────────────────────────────
  function n2(v, d) { if (v == null || isNaN(v)) return '–'; return Number(v).toFixed(d == null ? 1 : d); }
  function slotTime(i, len) { var step = Math.round(24 * 60 / (len || 24)); var m = i * step, hh = Math.floor(m / 60), mm = m % 60; return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; }
  function negWindow(h) { if (!h || !h.length) return '–'; var f = -1, l = -1; for (var i = 0; i < h.length; i++) if (h[i] != null && h[i] < 0) { if (f < 0) f = i; l = i; } if (f < 0) return '–'; return slotTime(f, h.length) + '–' + slotTime(l + 1, h.length); }
  function longestRun(h) { if (!h || !h.length) return 0; var st = 24 / h.length, r = 0, b = 0; for (var i = 0; i < h.length; i++) { if (h[i] != null && h[i] < 0) { r++; if (r > b) b = r; } else r = 0; } return b * st; }
  function negPct(h) { if (!h || !h.length) return 0; var v = h.filter(function (x) { return x != null; }); if (!v.length) return 0; return v.filter(function (x) { return x < 0; }).length / v.length * 100; }
  function inFilter(code) { return !NEG.zoneFilter || NEG.zoneFilter.has(code); }

  function yearSum(s) { var o = {}; if (s) s.forEach(function (d) { var y = d.d.slice(0, 4); o[y] = (o[y] || 0) + (d.negH || 0); }); return o; }
  function monthSum(s, yf) { var o = new Array(12).fill(0); if (s) s.forEach(function (d) { if (yf && d.d.slice(0, 4) !== yf) return; o[+d.d.slice(5, 7) - 1] += (d.negH || 0); }); return o; }
  function deepest(s) { var mn = 0, dt = null; if (s) s.forEach(function (d) { if (d.min != null && d.min < mn) { mn = d.min; dt = d.d; } }); return { v: mn, d: dt }; }
  function winDays(w) { return ({ '1M': 31, '3M': 92, '1Y': 365, '2Y': 730, '5Y': 1825, 'all': 99999 }[w] || 365); }
  function trailing(s, w) { if (!s) return []; if (w === 'all') return s; return s.slice(-winDays(w)); }
  function curYear() { return String(new Date().getFullYear()); }
  function doy(ds) { var d = new Date(ds); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); }
  function niceTicks(max) { var step = Math.pow(10, Math.floor(Math.log10(max || 1))); if (max / step < 2) step /= 2; else if (max / step > 6) step *= 2; var t = []; for (var v = 0; v <= max; v += step) t.push(Math.round(v)); return t; }

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
    function card(lbl, val, unit, sub, dn, zoneMeta) {
      return '<div class="kpi-card ' + (dn ? 'kpi-down' : 'kpi-flat') + '"><div class="kpi-label">' + lbl + '</div>' +
        '<div class="kpi-value"' + (dn ? ' style="color:' + C_NEG + '"' : '') + '>' + val + (unit ? '<span class="kpi-unit">' + unit + '</span>' : '') + '</div>' +
        (zoneMeta ? '<div class="kpi-meta kpi-meta-zone">' + (sub || '') + '</div>' : '<div class="kpi-chg">' + (sub || '') + '</div>') + '</div>';
    }
    el.innerHTML =
      card('FR neg hours', fr ? n2(fr.negHours, 2) : '–', 'h', fr && fr.min != null && fr.negHours > 0 ? 'min ' + n2(fr.min, 1) + ' · ' + (fr.minHour || '') : 'none today', fr && fr.negHours > 0) +
      card('DE neg hours', de ? n2(de.negHours, 2) : '–', 'h', de && de.min != null && de.negHours > 0 ? 'min ' + n2(de.min, 1) + ' · ' + (de.minHour || '') : 'none today', de && de.negHours > 0) +
      card('Zones in negative', inNeg.length, '/' + z.length, 'loaded today', false) +
      card('Total neg hours', n2(total, 2), 'h', 'across all zones', total > 0) +
      card('Deepest print', dp.z ? n2(dp.v, 1) : '–', '€/MWh', dp.z ? flag(dp.z) + ' ' + dp.z + (dp.hr ? ' · ' + dp.hr : '') : 'none', dp.z, true) +
      card('Longest run', lr.z ? n2(lr.h, 2) : '–', 'h', lr.z ? flag(lr.z) + ' ' + lr.z : 'none', false, true) +
      card('Most negative', most ? n2(most.negHours, 2) : '–', 'h', most ? flag(most.code) + ' ' + most.code : 'none', most, true);
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
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + (x.min < 0 ? C_NEG : 'var(--tx2)') + ';text-align:right">' + (x.min != null ? n2(x.min, 1) : '–') + '</td>' +
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
      { k: 'cumul', i: ICONS.trend, l: 'Cumulative' }, { k: 'cal', i: ICONS.cal, l: 'Calendar' },
      { k: 'daily', i: ICONS.chart, l: 'Daily bars' }, { k: 'mh', i: ICONS.grid, l: 'Month×hour' }, { k: 'driver', i: ICONS.bolt, l: 'Driver' }
    ];
    var tabs = TABS.map(function (t) { var on = t.k === view; return '<button onclick="negSetDrillView(\'' + code + '\',\'' + t.k + '\')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:' + (on ? 'var(--bg3)' : 'transparent') + ';color:' + (on ? 'var(--text)' : 'var(--text3)') + ';font-family:\'Inter\',sans-serif;font-weight:500;letter-spacing:.03em">' + t.i + t.l + '</button>'; }).join('');
    host.innerHTML =
      '<div class="pk-section-header"><div class="pk-section-header-text">' +
        '<div class="pk-eyebrow">Negative prices <span class="pk-sep">·</span> ' + flag(code) + ' ' + code + ' <span class="pk-sep">·</span> Country detail</div>' +
        '<div class="pk-section-title">' + zname(code) + ' — negative-price profile</div>' +
        '<div class="pk-section-subtitle">' + (series ? series.length + ' days · ' + series[0].d + ' → ' + series[series.length - 1].d : 'no history') + ' · ENTSO-E</div></div>' +
        '<div class="pk-section-header-actions"><button class="pk-btn-primary" onclick="event.stopPropagation();negDrillFullscreen(\'' + code + '\')">⛶ Fullscreen</button><button class="pk-btn-ghost" onclick="event.stopPropagation();negToggleRow(\'' + code + '\')">✕ Close</button></div></div>' +
      '<div class="kpi-strip" style="grid-template-columns:repeat(6,1fr);margin-bottom:14px">' +
        kc('Neg h ' + cy, n2(ys[cy] || 0, 0), 'h', 'YTD', (ys[cy] || 0) > 0) +
        kc('Neg h ' + ly, n2(ys[ly] || 0, 0), 'h', 'full year', false) +
        kc('Deepest', dp.d ? n2(dp.v, 0) : '–', '€/MWh', dp.d || '', dp.d, true) +
        kc('Days neg ' + cy, daysNeg, '/' + daysTot, daysTot ? Math.round(daysNeg / daysTot * 100) + '% of days' : '', false) +
        kc('Max neg/day', n2(maxDay, 1), 'h', 'single day', false) +
        kc('Peak month', MN[peakM], '', n2(ms[peakM], 0) + 'h cumul', (ms[peakM] || 0) > 0, true) +
      '</div>' +
      '<div class="pk-tabbar"><div class="pk-tabbar-left"><div class="pk-tabbar-tabs">' + tabs + '</div></div>' +
        '<div class="pk-tabbar-right"><span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--tx3)">↺ Reset · zoom XY</span></div></div>' +
      '<div id="neg-drill-title-' + code + '"></div>' +
      '<div id="neg-drill-chart-' + code + '" style="position:relative;min-height:300px;margin-top:6px"></div>';
    renderDrillChart(code, view, series);
  }
  window.negSetDrillView = function (code, v) { NEG.drillView[code] = v; renderDrill(code); };
  window.negDrillFullscreen = function () { /* backlog */ };

  function dTitle(code, eyebrow, title, sub) {
    var el = document.getElementById('neg-drill-title-' + code); if (!el) return;
    el.innerHTML = '<div style="margin:6px 0 4px"><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;font-weight:600;color:' + C_NEG + ';letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">' + eyebrow + '</div><div style="font-size:15px;font-weight:700;letter-spacing:-0.01em">' + title + '</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:' + C_TX3 + '">' + sub + '</div></div>';
  }
  function renderDrillChart(code, view, series) {
    var host = document.getElementById('neg-drill-chart-' + code); if (!host) return;
    var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], cy = curYear();
    if (!series) { dTitle(code, 'No history', zname(code), ''); host.innerHTML = backlog('No history for this zone.'); return; }
    if (view === 'month') { dTitle(code, 'Seasonality', 'Negative hours by month', 'cumulative, all years'); host.innerHTML = svgBars(MN, monthSum(series), {}); }
    else if (view === 'year') { var ys = yearSum(series), yk = Object.keys(ys).sort(); dTitle(code, 'Trend', 'Negative hours per year', yk[0] + ' → ' + yk[yk.length - 1]); host.innerHTML = svgBars(yk, yk.map(function (y) { return ys[y]; }), { partial: cy }); }
    else if (view === 'cumul') { dTitle(code, 'Pace tracker', 'Cumulative negative hours · YTD', 'current year vs prior'); host.innerHTML = svgCumul(series, cy); }
    else if (view === 'cal') { dTitle(code, 'Existing', 'Calendar heatmap — neg hours / day', 'last 12 months'); host.innerHTML = svgCalendar(series); }
    else if (view === 'daily') { dTitle(code, 'Existing', 'Daily negative hours', NEG.win + ' window'); host.innerHTML = svgDaily(trailing(series, NEG.win)); }
    else if (view === 'mh') { dTitle(code, 'Signature', 'When do negative prices hit? — month × hour', 'needs hourly aggregate'); host.innerHTML = backlog('Month×hour heatmap needs a precomputed hourly aggregate (neg_mh) in enrich_summary.py. Daily history files already carry the hourly arrays.'); }
    else if (view === 'driver') { dTitle(code, 'Driver attribution', 'Occurrences by hour + renewable surplus', 'needs hourly aggregate'); host.innerHTML = backlog('Driver chart needs a precomputed hourly aggregate (neg_driver) in enrich_summary.py.'); }
  }
  function backlog(msg) { return '<div style="border:1px dashed #2c4054;border-radius:8px;background:rgba(255,253,130,.04);padding:18px;color:' + C_TX3 + ';font-family:\'JetBrains Mono\',monospace;font-size:11px;line-height:1.5;text-align:center"><div style="color:#c49a2a;font-weight:700;margin-bottom:6px">◈ Coming soon — needs precomputed aggregate</div>' + msg + '</div>'; }

  // ════════════════════════════════════════════════════════════════
  // SVG primitives (viewBox 1000×320 → reads at template chart size)
  // ════════════════════════════════════════════════════════════════
  function svgOpen() { return '<svg style="width:100%;height:auto;display:block" viewBox="0 0 1000 320" preserveAspectRatio="xMidYMid meet">'; }
  function svgBars(labels, values, opt) {
    opt = opt || {}; var W = 1000, H = 320, padL = 44, padB = 30, padT = 16, padR = 12;
    var max = Math.max.apply(null, values.concat([1])) * 1.12, sy = function (v) { return H - padB - (v / max) * (H - padB - padT); };
    var bw = (W - padL - padR) / labels.length;
    var s = '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="' + C_BD + '"/>';
    niceTicks(max).forEach(function (g) { var y = sy(g); s += '<line x1="' + padL + '" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="' + C_BD + '" stroke-dasharray="2 3" opacity=".4"/><text x="' + (padL - 6) + '" y="' + (y + 3) + '" fill="' + C_TX3 + '" font-size="11" text-anchor="end" font-family="monospace">' + g + '</text>'; });
    labels.forEach(function (lb, i) {
      var v = values[i] || 0, x = padL + i * bw + bw * 0.18, w = bw * 0.64, bh = (H - padB) - sy(v), partial = opt.partial && String(lb) === String(opt.partial);
      s += '<rect x="' + x.toFixed(1) + '" y="' + sy(v).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(0, bh).toFixed(1) + '" rx="2" fill="' + C_NEG + '"' + (partial ? ' opacity=".55" stroke="' + C_NEG + '" stroke-dasharray="3 2"' : '') + '/>';
      if (v > 0) s += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (sy(v) - 5).toFixed(1) + '" fill="' + C_NEG + '" font-size="11" font-weight="700" text-anchor="middle" font-family="monospace">' + Math.round(v) + '</text>';
      s += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 10) + '" fill="' + C_TX3 + '" font-size="11" text-anchor="middle" font-family="monospace">' + String(lb).slice(-4) + '</text>';
    });
    return svgOpen() + s + '</svg>';
  }
  function svgCumul(series, cy) {
    var W = 1000, H = 320, padL = 44, padB = 26, padT = 16, padR = 12;
    var byY = {}; series.forEach(function (d) { (byY[d.d.slice(0, 4)] = byY[d.d.slice(0, 4)] || []).push(d); });
    var years = Object.keys(byY).sort().slice(-5), max = 1, cum = {};
    years.forEach(function (y) { var c = 0; cum[y] = byY[y].map(function (d) { c += (d.negH || 0); return { x: doy(d.d), v: c }; }); max = Math.max(max, c); });
    max *= 1.12;
    var sx = function (x) { return padL + (x / 366) * (W - padL - padR); }, sy = function (v) { return H - padB - (v / max) * (H - padB - padT); };
    var grey = ['#3a434d', '#566370', '#7a8794', '#9aa7b4'];
    var s = '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="' + C_BD + '"/>';
    niceTicks(max).forEach(function (g) { var y = sy(g); s += '<line x1="' + padL + '" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="' + C_BD + '" stroke-dasharray="2 3" opacity=".4"/><text x="' + (padL - 6) + '" y="' + (y + 3) + '" fill="' + C_TX3 + '" font-size="11" text-anchor="end" font-family="monospace">' + g + '</text>'; });
    var leg = '';
    years.forEach(function (y, i) {
      var col = y === cy ? C_NEG : grey[Math.max(0, grey.length - (years.length - i))], pts = cum[y]; if (!pts.length) return;
      s += '<path d="M' + pts.map(function (p) { return sx(p.x).toFixed(1) + ' ' + sy(p.v).toFixed(1); }).join(' L') + '" fill="none" stroke="' + col + '" stroke-width="' + (y === cy ? 2.6 : 1.4) + '"/>';
      var lp = pts[pts.length - 1]; s += '<circle cx="' + sx(lp.x).toFixed(1) + '" cy="' + sy(lp.v).toFixed(1) + '" r="' + (y === cy ? 3.5 : 2.2) + '" fill="' + col + '"/>';
      leg += '<span style="margin-right:14px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + col + ';vertical-align:-1px;margin-right:4px"></span>' + y + (y === cy ? ' (YTD)' : '') + '</span>';
    });
    return svgOpen() + s + '</svg><div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:' + C_TX3 + ';margin-top:6px">' + leg + '</div>';
  }
  function svgDaily(series) {
    var W = 1000, H = 220, padL = 40, padB = 22, padT = 10, padR = 10;
    var vals = series.map(function (d) { return d.negH || 0; }), max = Math.max.apply(null, vals.concat([1])) * 1.1, sy = function (v) { return H - padB - (v / max) * (H - padB - padT); };
    var bw = (W - padL - padR) / (vals.length || 1);
    var s = '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="' + C_BD + '"/>';
    vals.forEach(function (v, i) { if (!v) return; var x = padL + i * bw, bh = (H - padB) - sy(v); s += '<rect x="' + x.toFixed(1) + '" y="' + sy(v).toFixed(1) + '" width="' + Math.max(0.8, bw - 0.5).toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + C_NEG + '" opacity="' + (0.5 + 0.5 * v / max).toFixed(2) + '"/>'; });
    return '<svg style="width:100%;height:auto;display:block" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg>';
  }
  function svgCalendar(series) {
    var last = series.slice(-371), max = Math.max.apply(null, last.map(function (d) { return d.negH || 0; }).concat([1]));
    function col(v) { if (!v) return '#0f1419'; var t = v / max; return t < .25 ? 'rgba(237,105,101,.3)' : t < .55 ? 'rgba(237,105,101,.55)' : t < .85 ? C_NEG : C_NEG_DEEP; }
    var startDow = new Date(last[0].d).getDay(), pad = (startDow + 6) % 7;
    var html = '<div style="display:grid;grid-template-rows:repeat(7,1fr);grid-auto-flow:column;gap:3px;max-width:100%;overflow-x:auto;padding:6px 0">';
    for (var i = 0; i < pad; i++) html += '<div style="width:13px;height:13px"></div>';
    last.forEach(function (d) { html += '<div title="' + d.d + ': ' + (d.negH || 0).toFixed(1) + 'h" style="width:13px;height:13px;border-radius:2px;background:' + col(d.negH || 0) + '"></div>'; });
    return html + '</div>';
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 2 · CROSS-ZONE
  // ════════════════════════════════════════════════════════════════
  function renderCCKpis() {
    var el = document.getElementById('neg-cc-kpis'); if (!el) return;
    var s = NEG.summary, zk = (s && s.zones) ? Object.keys(s.zones) : [], cy = curYear();
    var most = { h: 0, z: '', y: '' }, deep = { v: 0, z: '' }, euTot = 0;
    CC_ZONES.forEach(function (c) { var ser = s && s.zones && s.zones[c]; if (!ser) return; var ys = yearSum(ser); Object.keys(ys).forEach(function (y) { if (ys[y] > most.h) most = { h: ys[y], z: c, y: y }; }); euTot += ys[String(+cy - 1)] || 0; var dp = deepest(ser); if (dp.v < deep.v) deep = { v: dp.v, z: c }; });
    function kc(lbl, val, unit, sub, dn, zm) { return '<div class="kpi-card ' + (dn ? 'kpi-down' : 'kpi-flat') + '"><div class="kpi-label">' + lbl + '</div><div class="kpi-value"' + (dn ? ' style="color:' + C_NEG + '"' : '') + '>' + val + (unit ? '<span class="kpi-unit">' + unit + '</span>' : '') + '</div>' + (zm ? '<div class="kpi-meta kpi-meta-zone">' + (sub || '') + '</div>' : '<div class="kpi-meta">' + (sub || '') + '</div>') + '</div>'; }
    el.innerHTML =
      kc('Zones tracked', zk.length || '–', '', CC_ZONES.length + ' featured', false) +
      kc('Most neg h', n2(most.h, 0), 'h', most.z ? flag(most.z) + ' ' + most.z + ' · ' + most.y : '', most.z, true) +
      kc('Deepest print', deep.z ? n2(deep.v, 0) : '–', '€/MWh', deep.z ? flag(deep.z) + ' ' + deep.z : '', deep.z, true) +
      kc('EU total ' + (+cy - 1), n2(euTot, 0), 'h', CC_ZONES.length + ' zones', euTot > 0) +
      kc('Reference', cy, '', 'current year', false);
  }
  function renderCCTabs() {
    var el = document.getElementById('neg-cc-tabs'); if (!el) return;
    var V = [{ k: 'year', i: ICONS.bars, l: 'By zone × year' }, { k: 'rank', i: ICONS.rank, l: 'Ranking' }, { k: 'monthhm', i: ICONS.map, l: 'Heatmap zone×month' }, { k: 'cumul', i: ICONS.trend, l: 'Cumulative' }];
    el.innerHTML = V.map(function (v) { var on = v.k === NEG.ccView; return '<button onclick="negSetCCView(\'' + v.k + '\')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:' + (on ? 'var(--bg3)' : 'transparent') + ';color:' + (on ? 'var(--text)' : 'var(--text3)') + ';font-family:\'Inter\',sans-serif;font-weight:500;letter-spacing:.03em">' + v.i + v.l + '</button>'; }).join('');
  }
  window.negSetCCView = function (v) { NEG.ccView = v; renderCCTabs(); renderCCChart(); };
  function ccTitle(e, t, su) { var E = document.getElementById('neg-cc-eyebrow'), T = document.getElementById('neg-cc-title'), S = document.getElementById('neg-cc-subtitle'); if (E) E.textContent = e; if (T) T.textContent = t; if (S) S.textContent = su; }
  function renderCCChart() {
    var host = document.getElementById('neg-cc-chart'); if (!host) return;
    var s = NEG.summary; if (!s || !s.zones) { host.innerHTML = backlog('No history loaded.'); return; }
    var view = NEG.ccView, cy = curYear(), zones = CC_ZONES.filter(function (c) { return s.zones[c]; });
    if (view === 'year') { ccTitle('Cross-zone — negative hours', 'Negative hours by zone and year', '2022 → ' + cy + ' · featured zones'); var years = []; for (var y = 2022; y <= +cy; y++) years.push(String(y)); host.innerHTML = svgGrouped(zones.map(function (c) { var ys = yearSum(s.zones[c]); return { c: c, vals: years.map(function (yy) { return ys[yy] || 0; }) }; }), years, cy); }
    else if (view === 'rank') { ccTitle('Cross-zone — ranking', 'Negative hours over window', NEG.win + ' · sorted'); host.innerHTML = svgHBars(zones.map(function (c) { return { c: c, v: trailing(s.zones[c], NEG.win).reduce(function (a, d) { return a + (d.negH || 0); }, 0) }; }).sort(function (a, b) { return b.v - a.v; })); }
    else if (view === 'monthhm') { ccTitle('Cross-zone — seasonality', 'Negative hours · zone × month', 'cumulative all years'); host.innerHTML = svgZoneMonth(zones, s); }
    else if (view === 'cumul') { ccTitle('Cross-zone — pace', 'Cumulative negative hours · ' + cy, 'featured zones, current year'); host.innerHTML = svgCCcumul(zones, s, cy); }
  }
  function svgGrouped(data, years, partial) {
    var W = 1000, H = 320, padL = 44, padB = 30, padT = 16, padR = 12, max = 1;
    data.forEach(function (d) { d.vals.forEach(function (v) { if (v > max) max = v; }); }); max *= 1.12;
    var sy = function (v) { return H - padB - (v / max) * (H - padB - padT); }, gw = (W - padL - padR) / data.length, bw = (gw * 0.8) / years.length;
    var greys = ['#3a434d', '#566370', '#7a8794'], YC = {}; years.forEach(function (y, i) { YC[y] = y === partial ? C_NEG_DEEP : (i === years.length - 2 ? C_NEG : greys[Math.min(i, greys.length - 1)]); });
    var s = '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="' + C_BD + '"/>';
    niceTicks(max).forEach(function (g) { var y = sy(g); s += '<line x1="' + padL + '" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="' + C_BD + '" stroke-dasharray="2 3" opacity=".4"/><text x="' + (padL - 6) + '" y="' + (y + 3) + '" fill="' + C_TX3 + '" font-size="11" text-anchor="end" font-family="monospace">' + g + '</text>'; });
    data.forEach(function (d, gi) { var gx = padL + gi * gw + gw * 0.1; d.vals.forEach(function (v, yi) { var x = gx + yi * bw, bh = (H - padB) - sy(v); s += '<rect x="' + x.toFixed(1) + '" y="' + sy(v).toFixed(1) + '" width="' + (bw - 1.5).toFixed(1) + '" height="' + Math.max(0, bh).toFixed(1) + '" rx="1.5" fill="' + YC[years[yi]] + '"' + (years[yi] === partial ? ' opacity=".75"' : '') + '/>'; }); s += '<text x="' + (gx + (years.length * bw) / 2).toFixed(1) + '" y="' + (H - 10) + '" fill="' + C_TX2 + '" font-size="12" text-anchor="middle" font-family="monospace" font-weight="700">' + flag(d.c) + ' ' + d.c + '</text>'; });
    var leg = years.map(function (y) { return '<span style="margin-right:12px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + YC[y] + ';vertical-align:-1px;margin-right:4px"></span>' + y + (y === partial ? ' (YTD)' : '') + '</span>'; }).join('');
    return svgOpen() + s + '</svg><div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:' + C_TX3 + ';margin-top:6px">' + leg + '</div>';
  }
  function svgHBars(rk) {
    var W = 1000, rowH = 34, padL = 120, padR = 60, padT = 8, H = padT + rk.length * rowH + 6, max = Math.max.apply(null, rk.map(function (r) { return r.v; }).concat([1])), s = '';
    rk.forEach(function (r, i) { var y = padT + i * rowH, bw = (r.v / max) * (W - padL - padR); s += '<text x="' + (padL - 10) + '" y="' + (y + rowH / 2 + 4) + '" fill="' + C_TX2 + '" font-size="13" text-anchor="end" font-family="monospace" font-weight="700">' + flag(r.c) + ' ' + r.c + '</text><rect x="' + padL + '" y="' + (y + 6) + '" width="' + Math.max(1, bw).toFixed(1) + '" height="' + (rowH - 14) + '" rx="3" fill="' + C_NEG + '"/><text x="' + (padL + bw + 8).toFixed(1) + '" y="' + (y + rowH / 2 + 4) + '" fill="' + C_NEG + '" font-size="12" font-family="monospace" font-weight="700">' + Math.round(r.v) + 'h</text>'; });
    return '<svg style="width:100%;height:auto;display:block" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg>';
  }
  function svgZoneMonth(zones, s) {
    var MN = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'], rows = zones.map(function (c) { return { c: c, m: monthSum(s.zones[c]) }; }), max = 1;
    rows.forEach(function (r) { r.m.forEach(function (v) { if (v > max) max = v; }); });
    function col(v) { if (!v) return '#0f1419'; var t = v / max; return t < .25 ? 'rgba(237,105,101,.28)' : t < .55 ? 'rgba(237,105,101,.55)' : t < .85 ? C_NEG : C_NEG_DEEP; }
    var html = '<div style="display:grid;grid-template-columns:70px repeat(12,1fr);gap:4px;padding:6px 0"><div></div>' + MN.map(function (m) { return '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:' + C_TX3 + ';text-align:center">' + m + '</div>'; }).join('');
    rows.forEach(function (r) { html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:' + C_TX2 + ';font-weight:700;display:flex;align-items:center;gap:4px">' + flag(r.c) + ' ' + r.c + '</div>'; r.m.forEach(function (v) { html += '<div title="' + Math.round(v) + 'h" style="aspect-ratio:2.4;border-radius:2px;background:' + col(v) + '"></div>'; }); });
    return html + '</div>';
  }
  function svgCCcumul(zones, s, cy) {
    var W = 1000, H = 320, padL = 44, padB = 26, padT = 16, padR = 70, pal = ['#ED6965', '#14D3A9', '#FFB454', '#7FC8F8', '#9b8cff', '#34D399', '#F472B6', '#FBBF24'];
    var sc = zones.map(function (c, i) { var ser = s.zones[c].filter(function (d) { return d.d.slice(0, 4) === cy; }), cum = 0, pts = ser.map(function (d) { cum += (d.negH || 0); return { x: doy(d.d), v: cum }; }); return { c: c, pts: pts, col: pal[i % pal.length], tot: cum }; });
    var max = Math.max.apply(null, sc.map(function (x) { return x.tot; }).concat([1])) * 1.12, sx = function (x) { return padL + (x / 366) * (W - padL - padR); }, sy = function (v) { return H - padB - (v / max) * (H - padB - padT); };
    var s2 = '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '" stroke="' + C_BD + '"/>';
    niceTicks(max).forEach(function (g) { var y = sy(g); s2 += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="' + C_BD + '" stroke-dasharray="2 3" opacity=".4"/><text x="' + (padL - 6) + '" y="' + (y + 3) + '" fill="' + C_TX3 + '" font-size="11" text-anchor="end" font-family="monospace">' + g + '</text>'; });
    sc.forEach(function (x) { if (!x.pts.length) return; s2 += '<path d="M' + x.pts.map(function (p) { return sx(p.x).toFixed(1) + ' ' + sy(p.v).toFixed(1); }).join(' L') + '" fill="none" stroke="' + x.col + '" stroke-width="1.8"/>'; var lp = x.pts[x.pts.length - 1]; s2 += '<text x="' + (sx(lp.x) + 6).toFixed(1) + '" y="' + (sy(lp.v) + 3).toFixed(1) + '" fill="' + x.col + '" font-size="11" font-family="monospace" font-weight="700">' + x.c + '</text>'; });
    return svgOpen() + s2 + '</svg>';
  }
  function renderCCTable() {
    var tb = document.getElementById('neg-cc-tbody'); if (!tb) return;
    var s = NEG.summary; if (!s || !s.zones) { tb.innerHTML = ''; return; }
    var cy = curYear(), ly = String(+cy - 1);
    var rows = CC_ZONES.filter(function (c) { return s.zones[c]; }).map(function (c) {
      var ser = s.zones[c], ys = yearSum(ser), dp = deepest(ser), prevY = ys[ly] || 0;
      var daysNeg = ser.filter(function (d) { return d.d.slice(0, 4) === ly && (d.negH || 0) > 0; }).length;
      var py2 = ys[String(+ly - 1)] || 0, pct = py2 ? Math.round((prevY - py2) / py2 * 100) : null;
      return { c: c, h: Math.round(prevY), deep: dp.v, days: daysNeg, vy: pct, spark: yearsSpark(ys) };
    }).sort(function (a, b) { return b.h - a.h; });
    tb.innerHTML = rows.map(function (r) {
      return '<tr><td style="font-family:\'JetBrains Mono\',monospace;font-weight:700;color:var(--tx2);text-align:left">' + flag(r.c) + ' ' + r.c + '</td>' +
        '<td style="text-align:left;color:var(--tx3)">' + zname(r.c) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_NEG + ';font-weight:600;text-align:right">' + r.h + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_NEG + ';text-align:right">' + (r.deep ? Math.round(r.deep) : '–') + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:var(--tx2);text-align:right">' + r.days + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;text-align:right;color:' + (r.vy > 0 ? C_NEG : C_ACC) + '">' + (r.vy == null ? '–' : (r.vy > 0 ? '+' : '') + r.vy + '%') + '</td>' +
        '<td style="text-align:left;color:var(--tx3);letter-spacing:2px">' + r.spark + '</td></tr>';
    }).join('');
  }
  function yearsSpark(ys) { var years = Object.keys(ys).sort(); if (!years.length) return ''; var vals = years.map(function (y) { return ys[y]; }), max = Math.max.apply(null, vals.concat([1])), b = '▁▂▃▄▅▆▇█'; return vals.slice(-7).map(function (v) { return b[Math.min(7, Math.round(v / max * 7))]; }).join(''); }

  // ── Window pills ──
  window.negSetWindow = function (w, btn) { NEG.win = w; if (btn && btn.parentNode) { btn.parentNode.querySelectorAll('.pk-gf-btn').forEach(function (b) { b.classList.remove('active'); }); btn.classList.add('active'); } try { renderCCChart(); } catch (e) {} if (NEG.openRow) { try { renderDrill(NEG.openRow); } catch (e) {} } };
  window.negCCFullscreen = function () { /* backlog */ };

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
      try { renderCCKpis(); } catch (e) { console.warn('[neg] cc kpis', e); }
      try { renderCCTabs(); } catch (e) { console.warn('[neg] cc tabs', e); }
      try { renderCCChart(); } catch (e) { console.warn('[neg] cc chart', e); }
      try { renderCCTable(); } catch (e) { console.warn('[neg] cc table', e); }
      if (NEG.openRow) { try { renderDrill(NEG.openRow); } catch (e) {} }
    });
  }
  window.negRenderAll = renderAll;
})();
