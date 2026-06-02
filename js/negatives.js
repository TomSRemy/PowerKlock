/* ════════════════════════════════════════════════════════════════════
   negatives.js · PowerKlock · Prices > Negative prices (redesign)
   Mirrors the Day-Ahead template:
     · Section 1 "Negative price board"  → today KPIs + per-zone table
       (row expand = country drill, DA row-drill pattern)
     · Section 2 "Cross-zone analysis"   → KPIs + pk-tabbar toggles + chart + table
   Self-contained & defensive: reads data/prices.json + data/history/summary.json.
   Never throws into the page (all renders guarded). Legacy panel untouched.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Palette (kept local; matches design system) ──
  var C_NEG = '#ED6965', C_NEG_DEEP = '#66101F', C_ACC = '#14D3A9';
  var C_TX = '#FFFFFF', C_TX2 = '#B8C9D9', C_TX3 = '#7A93AB', C_BD = '#1e2d3d';

  // ── Flags + names (fallback to global FLAG_MAP/ZONE_META if present) ──
  var FLAGS = {
    FR:'🇫🇷',DE_LU:'🇩🇪',ES:'🇪🇸',PT:'🇵🇹',BE:'🇧🇪',NL:'🇳🇱',SE:'🇸🇪',FI:'🇫🇮',
    PL:'🇵🇱',GR:'🇬🇷',AT:'🇦🇹',CH:'🇨🇭',IT_NORD:'🇮🇹',IT_SICI:'🇮🇹',CZ:'🇨🇿',
    DK_W:'🇩🇰',DK_E:'🇩🇰',NO_1:'🇳🇴',HU:'🇭🇺',RO:'🇷🇴',SK:'🇸🇰',SI:'🇸🇮',HR:'🇭🇷',
    BG:'🇧🇬',LT:'🇱🇹',LV:'🇱🇻',EE:'🇪🇪',RS:'🇷🇸',MK:'🇲🇰',ME:'🇲🇪'
  };
  var NAMES = {
    FR:'France',DE_LU:'Germany',ES:'Spain',PT:'Portugal',BE:'Belgium',NL:'Netherlands',
    SE:'Sweden',FI:'Finland',PL:'Poland',GR:'Greece',AT:'Austria',CH:'Switzerland',
    IT_NORD:'Italy North',IT_SICI:'Italy Sicily',CZ:'Czechia',DK_W:'Denmark W',DK_E:'Denmark E',
    NO_1:'Norway',HU:'Hungary',RO:'Romania',SK:'Slovakia',SI:'Slovenia',HR:'Croatia',
    BG:'Bulgaria',LT:'Lithuania',LV:'Latvia',EE:'Estonia',RS:'Serbia',MK:'N. Macedonia',ME:'Montenegro'
  };
  function flag(c){ try { if (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[c]) return FLAG_MAP[c]; } catch(e){} return FLAGS[c] || ''; }
  function zname(c){ try { if (typeof ZONE_META !== 'undefined' && ZONE_META[c] && ZONE_META[c].country) return ZONE_META[c].country; } catch(e){} return NAMES[c] || c; }

  // Zones featured in the cross-zone analysis (have meaningful history)
  var CC_ZONES = ['FR','DE_LU','BE','NL','ES','SE','PL','FI'];

  // ── Tabler-style icons (1.5px outline), no emojis ──
  function ic(p){ return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>'; }
  var ICONS = {
    grid:   ic('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>'),
    bars:   ic('<line x1="4" y1="20" x2="4" y2="12"/><line x1="10" y1="20" x2="10" y2="6"/><line x1="16" y1="20" x2="16" y2="9"/><line x1="20" y1="20" x2="4" y2="20"/>'),
    trend:  ic('<polyline points="4 18 9 11 13 14 20 5"/>'),
    bolt:   ic('<polyline points="13 3 4 14 11 14 10 21 20 9 13 9 13 3"/>'),
    cal:    ic('<rect x="4" y="5" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="9" y1="3" x2="9" y2="7"/><line x1="15" y1="3" x2="15" y2="7"/>'),
    chart:  ic('<line x1="4" y1="20" x2="20" y2="20"/><polyline points="4 14 9 9 13 12 20 5"/>'),
    rank:   ic('<line x1="4" y1="7" x2="14" y2="7"/><line x1="4" y1="12" x2="18" y2="12"/><line x1="4" y1="17" x2="10" y2="17"/>'),
    map:    ic('<rect x="4" y="6" width="16" height="12" rx="1"/><line x1="9" y1="6" x2="9" y2="18"/><line x1="14" y1="6" x2="14" y2="18"/>')
  };

  // ── State ──
  var NEG = { win:'1Y', ccView:'year', data:null, loading:null, openRow:null, drillView:{} };

  // ── Data load (cached) ──
  function loadData() {
    if (NEG.data) return Promise.resolve(NEG.data);
    if (NEG.loading) return NEG.loading;
    var base = (typeof DATA_BASE === 'string' && DATA_BASE) ? DATA_BASE : '';
    function j(u){ return fetch(u).then(function(r){ if(!r.ok) throw 0; return r.json(); }); }
    NEG.loading = Promise.all([
      // prices: prefer already-loaded global if present
      (function(){
        try { if (typeof pricesData !== 'undefined' && pricesData && pricesData.zones) return Promise.resolve(pricesData); } catch(e){}
        return j((base||'') + 'data/prices.json').catch(function(){ return null; });
      })(),
      // summary: prefer global fetchSummary
      (function(){
        try { if (typeof fetchSummary === 'function') return fetchSummary().catch(function(){ return null; }); } catch(e){}
        return j((base||'') + 'data/history/summary.json').catch(function(){ return null; });
      })()
    ]).then(function (res) {
      NEG.data = { prices: res[0], summary: res[1] };
      return NEG.data;
    });
    return NEG.loading;
  }

  // ── Helpers ────────────────────────────────────────────────────────
  function num(v, d) { if (v == null || isNaN(v)) return '–'; return Number(v).toFixed(d == null ? 1 : d); }
  function slotTime(i, len) {
    var stepMin = Math.round(24 * 60 / (len || 24));
    var m = i * stepMin, hh = Math.floor(m / 60), mm = m % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function negWindow(hourly) {
    if (!hourly || !hourly.length) return '–';
    var first = -1, last = -1;
    for (var i = 0; i < hourly.length; i++) { if (hourly[i] != null && hourly[i] < 0) { if (first < 0) first = i; last = i; } }
    if (first < 0) return '–';
    return slotTime(first, hourly.length) + '–' + slotTime(last + 1, hourly.length);
  }
  function longestRun(hourly) {
    if (!hourly || !hourly.length) return 0;
    var stepH = 24 / hourly.length, run = 0, best = 0;
    for (var i = 0; i < hourly.length; i++) { if (hourly[i] != null && hourly[i] < 0) { run++; if (run > best) best = run; } else run = 0; }
    return best * stepH;
  }
  // summary series aggregations
  function yearSum(series) { var o = {}; if (!series) return o; series.forEach(function (d) { var y = d.d.slice(0, 4); o[y] = (o[y] || 0) + (d.negH || 0); }); return o; }
  function monthSum(series, yearFilter) { var o = new Array(12).fill(0); if (!series) return o; series.forEach(function (d) { if (yearFilter && d.d.slice(0,4) !== yearFilter) return; o[+d.d.slice(5,7)-1] += (d.negH || 0); }); return o; }
  function deepest(series) { var mn = 0, dt = null; if (series) series.forEach(function (d) { if (d.min != null && d.min < mn) { mn = d.min; dt = d.d; } }); return { v: mn, d: dt }; }
  function winDays(w) { return ({ '1M':31,'3M':92,'1Y':365,'2Y':730,'5Y':1825,'all':99999 }[w] || 365); }
  function trailing(series, w) { if (!series) return []; if (w === 'all') return series; var n = winDays(w); return series.slice(-n); }
  function curYear() { return String(new Date().getFullYear()); }

  // ════════════════════════════════════════════════════════════════
  // SECTION 1 · BOARD (today KPIs + per-zone table)
  // ════════════════════════════════════════════════════════════════
  function renderBoardKpis() {
    var el = document.getElementById('neg-board-kpis'); if (!el) return;
    var p = NEG.data && NEG.data.prices; var zones = (p && p.zones) || [];
    function byCode(c) { for (var i = 0; i < zones.length; i++) if (zones[i].code === c) return zones[i]; return null; }
    var fr = byCode('FR'), de = byCode('DE_LU');
    var inNeg = zones.filter(function (z) { return (z.negHours || 0) > 0; });
    var total = inNeg.reduce(function (a, z) { return a + (z.negHours || 0); }, 0);
    var dp = { v: 0, z: '' }; zones.forEach(function (z) { if (z.min != null && z.min < dp.v) dp = { v: z.min, z: z.code, hr: z.minHour }; });
    var lr = { h: 0, z: '' }; zones.forEach(function (z) { var r = longestRun(z.hourly); if (r > lr.h) lr = { h: r, z: z.code }; });
    function card(lbl, val, unit, sub, neg, zoneMeta) {
      return '<div class="kpi-card' + (neg ? ' kpi-down' : ' kpi-flat') + '"><div class="kpi-label">' + lbl + '</div>' +
        '<div class="kpi-value' + (neg ? '" style="color:' + C_NEG : '') + '">' + val + (unit ? '<span class="kpi-unit">' + unit + '</span>' : '') + '</div>' +
        (zoneMeta ? '<div class="kpi-meta-zone">' + sub + '</div>' : '<div class="kpi-chg">' + (sub || '') + '</div>') + '</div>';
    }
    el.innerHTML =
      card('FR neg hours', fr ? num(fr.negHours, 2) : '–', 'h', fr && fr.min != null ? 'min ' + num(fr.min, 1) + ' · ' + (fr.minHour||'') : '', true) +
      card('DE neg hours', de ? num(de.negHours, 2) : '–', 'h', de && de.min != null ? 'min ' + num(de.min, 1) + ' · ' + (de.minHour||'') : '', true) +
      card('Zones negative', inNeg.length, '/' + zones.length, 'loaded today', false) +
      card('Total neg h', num(total, 2), 'h', 'all zones', true) +
      card('Deepest print', dp.z ? num(dp.v, 1) : '–', '€', dp.z ? flag(dp.z) + ' ' + dp.z + (dp.hr ? ' · ' + dp.hr : '') : '', true, true) +
      card('Longest run', lr.z ? num(lr.h, 2) : '–', 'h', lr.z ? flag(lr.z) + ' ' + lr.z : '', false, true) +
      card('Neg window FR', fr ? negWindow(fr.hourly) : '–', '', 'first → last slot', false);
  }

  function boardSpark(hourly) {
    if (!hourly || !hourly.length) return '';
    var arr = hourly.filter(function (v) { return v != null; });
    if (arr.length > 24) { var step = arr.length / 24, ds = []; for (var i = 0; i < 24; i++) { var s = arr.slice(Math.floor(i*step), Math.floor((i+1)*step)); ds.push(s.reduce(function(a,b){return a+b;},0)/(s.length||1)); } arr = ds; }
    var w = 120, h = 26, n = arr.length, mx = Math.max.apply(null, arr.concat([5])), mn = Math.min.apply(null, arr.concat([-2]));
    var X = function (i) { return i * (w / (n - 1)); }, Y = function (v) { return h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4); }, z = Y(0);
    var line = 'M' + arr.map(function (v, i) { return X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' L');
    var negA = '', seg = null;
    arr.forEach(function (v, i) { if (v < 0) { if (!seg) seg = { s: i }; seg.e = i; } else if (seg) { negA += segArea(seg, arr, X, Y, z); seg = null; } });
    if (seg) negA += segArea(seg, arr, X, Y, z);
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><line x1="0" y1="' + z.toFixed(1) + '" x2="' + w + '" y2="' + z.toFixed(1) + '" stroke="' + C_NEG + '" stroke-width=".6" stroke-dasharray="2 2" opacity=".55"/>' + negA + '<path d="' + line + '" fill="none" stroke="' + C_ACC + '" stroke-width="1.3"/></svg>';
  }
  function segArea(seg, arr, X, Y, z) { var p = []; for (var i = seg.s; i <= seg.e; i++) p.push(X(i).toFixed(1) + ' ' + Y(arr[i]).toFixed(1)); return '<path d="M' + X(seg.s).toFixed(1) + ' ' + z.toFixed(1) + ' L' + p.join(' L') + ' L' + X(seg.e).toFixed(1) + ' ' + z.toFixed(1) + ' Z" fill="rgba(237,105,101,.35)" stroke="' + C_NEG + '" stroke-width=".8"/>'; }

  function renderBoardTable() {
    var tb = document.getElementById('neg-board-tbody'); if (!tb) return;
    var p = NEG.data && NEG.data.prices; var zones = ((p && p.zones) || []).slice();
    // Only zones in negative today, sorted by neg hours desc (board = today snapshot)
    var rows = zones.filter(function (z) { return (z.negHours || 0) > 0; })
                    .sort(function (a, b) { return (b.negHours || 0) - (a.negHours || 0); });
    var title = document.getElementById('neg-board-title');
    if (title) title.textContent = 'Negative-price board · ' + (p && p.updated ? p.updated.slice(0, 10) : 'today') + ' · ENTSO-E';
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:' + C_TX3 + ';padding:18px;font-family:\'JetBrains Mono\',monospace">No negative prices today · last episode loads from history</td></tr>'; return; }
    var html = '';
    rows.forEach(function (z) {
      var run = longestRun(z.hourly);
      html += '<tr class="neg-zone-row" data-code="' + z.code + '" onclick="negToggleRow(\'' + z.code + '\')" style="cursor:pointer">' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;color:' + C_TX2 + ';text-align:left"><svg class="neg-row-chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;opacity:.45;transition:transform .15s"><polyline points="9 18 15 12 9 6"/></svg>' + flag(z.code) + ' ' + z.code + '</td>' +
        '<td style="font-size:11px;color:' + C_TX3 + ';text-align:left">' + zname(z.code) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_NEG + ';font-weight:600;text-align:right">' + num(z.negHours, 2) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_NEG + ';font-weight:600;text-align:right">' + num(z.min, 1) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_TX3 + ';text-align:right">' + negWindow(z.hourly) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_TX2 + ';text-align:right">' + num(run, 2) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_TX3 + ';text-align:right">' + (z.spark != null ? num(z.spark, 1) : '–') + '</td>' +
        '<td style="text-align:left;color:' + C_TX3 + ';font-size:11px">' + (z.maxHour ? 'max ' + z.maxHour : '–') + '</td>' +
        '<td style="text-align:center">' + boardSpark(z.hourly) + '</td>' +
      '</tr>' +
      '<tr class="neg-detail-row" id="neg-detail-' + z.code + '" style="display:none"><td colspan="9" style="padding:0;background:#141a22;border-bottom:2px solid #2a3a4a"><div style="padding:16px 18px" id="neg-detail-inner-' + z.code + '"></div></td></tr>';
    });
    tb.innerHTML = html;
  }

  // ── Row expand → country drill ──
  window.negToggleRow = function (code) {
    var det = document.getElementById('neg-detail-' + code); if (!det) return;
    var row = document.querySelector('.neg-zone-row[data-code="' + code + '"]');
    var open = det.style.display !== 'none';
    // close others
    document.querySelectorAll('.neg-detail-row').forEach(function (r) { r.style.display = 'none'; });
    document.querySelectorAll('.neg-zone-row .neg-row-chevron').forEach(function (c) { c.style.transform = ''; c.style.color = ''; c.style.opacity = '.45'; });
    if (!open) {
      det.style.display = '';
      if (row) { var ch = row.querySelector('.neg-row-chevron'); if (ch) { ch.style.transform = 'rotate(90deg)'; ch.style.color = C_NEG; ch.style.opacity = '.9'; } row.style.background = 'rgba(237,105,101,.05)'; }
      NEG.openRow = code;
      if (!NEG.drillView[code]) NEG.drillView[code] = 'month';
      renderDrill(code);
    } else { NEG.openRow = null; if (row) row.style.background = ''; }
  };

  // ════════════════════════════════════════════════════════════════
  // COUNTRY DRILL (inside expanded row) — KPIs + one chart + toggles
  // ════════════════════════════════════════════════════════════════
  function renderDrill(code) {
    var host = document.getElementById('neg-detail-inner-' + code); if (!host) return;
    var s = NEG.data && NEG.data.summary; var series = s && s.zones && s.zones[code];
    var cy = curYear(), ly = String(+cy - 1);
    var ys = yearSum(series);
    var ms = monthSum(series); var peakM = 0; for (var i = 1; i < 12; i++) if (ms[i] > ms[peakM]) peakM = i;
    var dp = deepest(series);
    var daysNeg = series ? series.filter(function (d) { return d.d.slice(0,4) === cy && (d.negH||0) > 0; }).length : 0;
    var daysTot = series ? series.filter(function (d) { return d.d.slice(0,4) === cy; }).length : 0;
    var maxDay = series ? series.reduce(function (m, d) { return Math.max(m, d.negH||0); }, 0) : 0;
    var MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var view = NEG.drillView[code] || 'month';

    function kc(lbl, val, unit, sub, neg, zoneMeta) {
      return '<div class="kpi-card' + (neg ? ' kpi-down' : ' kpi-flat') + '"><div class="kpi-label">' + lbl + '</div><div class="kpi-value"' + (neg ? ' style="color:' + C_NEG + '"' : '') + '>' + val + (unit ? '<span class="kpi-unit">' + unit + '</span>' : '') + '</div>' + (zoneMeta ? '<div class="kpi-meta">' + (sub||'') + '</div>' : '<div class="kpi-chg">' + (sub||'') + '</div>') + '</div>';
    }
    var TABS = [
      { k:'month', i:ICONS.bars,  l:'By month' },
      { k:'year',  i:ICONS.bars,  l:'Per year' },
      { k:'cumul', i:ICONS.trend, l:'Cumulative' },
      { k:'cal',   i:ICONS.cal,   l:'Calendar' },
      { k:'daily', i:ICONS.chart, l:'Daily bars' },
      { k:'mh',    i:ICONS.grid,  l:'Month×hour' },
      { k:'driver',i:ICONS.bolt,  l:'Driver' }
    ];
    var tabsHtml = TABS.map(function (t) {
      var on = t.k === view;
      return '<button onclick="negSetDrillView(\'' + code + '\',\'' + t.k + '\')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 11px;border-radius:4px;cursor:pointer;border:none;background:' + (on ? '#151c24' : 'transparent') + ';color:' + (on ? C_TX : C_TX3) + ';font-family:\'Inter\',sans-serif;font-weight:500;letter-spacing:.03em">' + t.i + t.l + '</button>';
    }).join('');

    host.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid ' + C_BD + ';padding-bottom:11px;margin-bottom:12px">' +
        '<div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;font-weight:600;color:' + C_NEG + ';letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">Negative prices · ' + flag(code) + ' ' + code + ' · Country detail</div>' +
        '<div style="font-size:16px;font-weight:700;letter-spacing:-0.01em">' + zname(code) + ' — negative-price profile</div>' +
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:' + C_TX3 + ';margin-top:3px">' + (series ? series.length + ' days · ' + series[0].d + ' → ' + series[series.length-1].d : 'no history') + ' · ENTSO-E</div></div>' +
        '<button class="pk-btn-ghost" onclick="negToggleRow(\'' + code + '\')">✕ Close</button></div>' +
      '<div class="kpi-strip" style="grid-template-columns:repeat(6,1fr);margin-bottom:14px">' +
        kc('Neg h ' + cy, num(ys[cy]||0, 0), 'h', 'YTD', true) +
        kc('Neg h ' + ly, num(ys[ly]||0, 0), 'h', 'full year', false) +
        kc('Deepest', dp.d ? num(dp.v, 0) : '–', '€', dp.d || '', true, true) +
        kc('Days neg ' + cy, daysNeg, '/' + daysTot, daysTot ? Math.round(daysNeg/daysTot*100) + '%' : '', false) +
        kc('Max neg/day', num(maxDay, 1), 'h', 'single day', false) +
        kc('Peak month', MN[peakM], '', num(ms[peakM], 0) + 'h cumul', true, true) +
      '</div>' +
      '<div class="pk-tabbar"><div class="pk-tabbar-left"><div class="pk-tabbar-tabs">' + tabsHtml + '</div></div>' +
        '<div class="pk-tabbar-right"><span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:' + C_TX3 + '">↺ Reset · zoom XY</span></div></div>' +
      '<div id="neg-drill-chart-' + code + '"></div>';

    renderDrillChart(code, view, series);
  }

  window.negSetDrillView = function (code, v) { NEG.drillView[code] = v; renderDrill(code); };

  function drillTitle(eyebrow, title, sub) {
    return '<div style="margin:6px 0 8px"><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;font-weight:600;color:' + C_NEG + ';letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">' + eyebrow + '</div><div style="font-size:15px;font-weight:700;letter-spacing:-0.01em">' + title + '</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:' + C_TX3 + '">' + sub + '</div></div>';
  }

  function renderDrillChart(code, view, series) {
    var host = document.getElementById('neg-drill-chart-' + code); if (!host) return;
    var MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var cy = curYear();
    if (!series) { host.innerHTML = backlogBox('No history for this zone.'); return; }

    if (view === 'month') {
      var ms = monthSum(series);
      host.innerHTML = drillTitle('Seasonality', 'Negative hours by month', 'cumulative, all years · ENTSO-E') + svgBars(MN, ms, { color: C_NEG });
    } else if (view === 'year') {
      var ys = yearSum(series), yk = Object.keys(ys).sort();
      host.innerHTML = drillTitle('Trend', 'Negative hours per year', yk[0] + ' → ' + yk[yk.length-1]) + svgBars(yk, yk.map(function (y) { return ys[y]; }), { color: C_NEG, partialLast: cy });
    } else if (view === 'cumul') {
      host.innerHTML = drillTitle('Pace tracker', 'Cumulative negative hours · YTD', 'current year vs prior years') + svgCumulative(series);
    } else if (view === 'cal') {
      host.innerHTML = drillTitle('Existing', 'Calendar heatmap — neg hours per day', 'last 12 months') + svgCalendar(series);
    } else if (view === 'daily') {
      host.innerHTML = drillTitle('Existing', 'Daily negative hours', NEG.win + ' window') + svgDailyBars(trailing(series, NEG.win));
    } else if (view === 'mh') {
      host.innerHTML = drillTitle('Signature', 'When do negative prices hit? — month × hour', 'requires hourly aggregate') +
        backlogBox('Month×hour heatmap needs a precomputed hourly aggregate (occurrences per month×hour). Backlog: add neg_mh matrix to enrich_summary.py — the daily history files already carry the hourly arrays needed.');
    } else if (view === 'driver') {
      host.innerHTML = drillTitle('Driver attribution', 'Occurrences by hour + renewable surplus', 'requires hourly aggregate') +
        backlogBox('Driver chart needs hourly occurrence + wind/solar aggregate. Backlog: add neg_driver to enrich_summary.py (daily files carry solar/wind arrays).');
    }
  }

  function backlogBox(msg) {
    return '<div style="border:1px dashed #2c4054;border-radius:8px;background:rgba(255,253,130,.04);padding:18px;color:' + C_TX3 + ';font-family:\'JetBrains Mono\',monospace;font-size:11px;line-height:1.5;text-align:center">' +
      '<div style="color:#c49a2a;font-weight:700;margin-bottom:6px">◈ Coming soon — needs precomputed aggregate</div>' + msg + '</div>';
  }

  // ════════════════════════════════════════════════════════════════
  // SVG chart primitives (no external libs)
  // ════════════════════════════════════════════════════════════════
  function svgBars(labels, values, opt) {
    opt = opt || {}; var W = 720, H = 220, padL = 34, padB = 24, padT = 12, padR = 8;
    var max = Math.max.apply(null, values.concat([1])) * 1.1;
    var sy = function (v) { return H - padB - (v / max) * (H - padB - padT); };
    var bw = (W - padL - padR) / labels.length;
    var s = '<line x1="' + padL + '" y1="' + (H-padB) + '" x2="' + W + '" y2="' + (H-padB) + '" stroke="' + C_BD + '"/>';
    var ticks = niceTicks(max);
    ticks.forEach(function (g) { var y = sy(g); s += '<line x1="' + padL + '" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="' + C_BD + '" stroke-dasharray="2 3" opacity=".4"/><text x="' + (padL-5) + '" y="' + (y+3) + '" fill="' + C_TX3 + '" font-size="8" text-anchor="end" font-family="monospace">' + g + '</text>'; });
    labels.forEach(function (lb, i) {
      var v = values[i] || 0, x = padL + i * bw + bw * 0.18, w = bw * 0.64, bh = (H - padB) - sy(v);
      var partial = opt.partialLast && String(lb) === String(opt.partialLast);
      s += '<rect x="' + x.toFixed(1) + '" y="' + sy(v).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(0, bh).toFixed(1) + '" rx="2" fill="' + (opt.color||C_NEG) + '"' + (partial ? ' opacity=".55" stroke="' + C_NEG + '" stroke-dasharray="3 2"' : '') + '/>';
      if (v > 0) s += '<text x="' + (x+w/2).toFixed(1) + '" y="' + (sy(v)-4).toFixed(1) + '" fill="' + C_NEG + '" font-size="8.5" font-weight="700" text-anchor="middle" font-family="monospace">' + Math.round(v) + '</text>';
      s += '<text x="' + (x+w/2).toFixed(1) + '" y="' + (H-9) + '" fill="' + C_TX3 + '" font-size="8" text-anchor="middle" font-family="monospace">' + String(lb).slice(-3) + '</text>';
    });
    return '<svg style="width:100%;height:auto;display:block" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg>';
  }

  function svgCumulative(series) {
    var W = 720, H = 220, padL = 34, padB = 22, padT = 12, padR = 8;
    var byYear = {}; series.forEach(function (d) { var y = d.d.slice(0,4); (byYear[y] = byYear[y] || []).push(d); });
    var years = Object.keys(byYear).sort().slice(-5);
    var max = 1;
    var cum = {}; years.forEach(function (y) { var c = 0; cum[y] = byYear[y].map(function (d) { c += (d.negH||0); return { doy: doy(d.d), v: c }; }); max = Math.max(max, c); });
    max *= 1.1;
    var sx = function (dy) { return padL + (dy / 366) * (W - padL - padR); }, sy = function (v) { return H - padB - (v / max) * (H - padB - padT); };
    var cols = { }; var cy = curYear();
    var grey = ['#3a434d','#566370','#7a8794','#9aa7b4'];
    var s = '<line x1="' + padL + '" y1="' + (H-padB) + '" x2="' + W + '" y2="' + (H-padB) + '" stroke="' + C_BD + '"/>';
    niceTicks(max).forEach(function (g) { var y = sy(g); s += '<line x1="' + padL + '" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="' + C_BD + '" stroke-dasharray="2 3" opacity=".4"/><text x="' + (padL-5) + '" y="' + (y+3) + '" fill="' + C_TX3 + '" font-size="8" text-anchor="end" font-family="monospace">' + g + '</text>'; });
    var leg = '';
    years.forEach(function (y, idx) {
      var col = (y === cy) ? C_NEG : grey[Math.max(0, grey.length - (years.length - idx))];
      var pts = cum[y]; if (!pts.length) return;
      var path = 'M' + pts.map(function (p) { return sx(p.doy).toFixed(1) + ' ' + sy(p.v).toFixed(1); }).join(' L');
      s += '<path d="' + path + '" fill="none" stroke="' + col + '" stroke-width="' + (y === cy ? 2.4 : 1.3) + '"/>';
      var last = pts[pts.length-1];
      s += '<circle cx="' + sx(last.doy).toFixed(1) + '" cy="' + sy(last.v).toFixed(1) + '" r="' + (y===cy?3:2) + '" fill="' + col + '"/>';
      leg += '<span style="margin-right:14px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + col + ';vertical-align:-1px;margin-right:4px"></span>' + y + (y===cy?' (YTD)':'') + '</span>';
    });
    return '<svg style="width:100%;height:auto;display:block" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:' + C_TX3 + ';margin-top:8px">' + leg + '</div>';
  }

  function svgDailyBars(series) {
    var W = 720, H = 150, padL = 28, padB = 18, padT = 8, padR = 6;
    var vals = series.map(function (d) { return d.negH || 0; });
    var max = Math.max.apply(null, vals.concat([1])) * 1.1;
    var sy = function (v) { return H - padB - (v / max) * (H - padB - padT); };
    var bw = (W - padL - padR) / (vals.length || 1);
    var s = '<line x1="' + padL + '" y1="' + (H-padB) + '" x2="' + W + '" y2="' + (H-padB) + '" stroke="' + C_BD + '"/>';
    vals.forEach(function (v, i) { if (!v) return; var x = padL + i * bw, bh = (H - padB) - sy(v); s += '<rect x="' + x.toFixed(1) + '" y="' + sy(v).toFixed(1) + '" width="' + Math.max(0.8, bw-0.5).toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + C_NEG + '" opacity="' + (0.5 + 0.5*v/max).toFixed(2) + '"/>'; });
    return '<svg style="width:100%;height:auto;display:block" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg>';
  }

  function svgCalendar(series) {
    // last ~52 weeks, day cells coloured by negH
    var last = series.slice(-371);
    var max = Math.max.apply(null, last.map(function (d) { return d.negH || 0; }).concat([1]));
    function col(v) { if (!v) return '#0f1419'; var t = v / max; return t < .25 ? 'rgba(237,105,101,.3)' : t < .55 ? 'rgba(237,105,101,.55)' : t < .85 ? C_NEG : C_NEG_DEEP; }
    // group into weeks (columns)
    var cells = '';
    var startDow = new Date(last[0].d).getDay(); // 0 Sun
    var pad = (startDow + 6) % 7; // Monday-first
    var html = '<div style="display:grid;grid-template-rows:repeat(7,1fr);grid-auto-flow:column;gap:2px;max-width:100%;overflow-x:auto">';
    for (var i = 0; i < pad; i++) html += '<div style="width:11px;height:11px"></div>';
    last.forEach(function (d) { html += '<div title="' + d.d + ': ' + (d.negH||0).toFixed(1) + 'h" style="width:11px;height:11px;border-radius:2px;background:' + col(d.negH||0) + '"></div>'; });
    html += '</div>';
    return html;
  }

  function niceTicks(max) { var step = Math.pow(10, Math.floor(Math.log10(max))); if (max/step < 2) step/=2; else if (max/step > 6) step*=2; var t = []; for (var v = 0; v <= max; v += step) t.push(Math.round(v)); return t; }
  function doy(dstr) { var d = new Date(dstr); var start = new Date(d.getFullYear(), 0, 0); return Math.floor((d - start) / 86400000); }

  // ════════════════════════════════════════════════════════════════
  // SECTION 2 · CROSS-ZONE ANALYSIS
  // ════════════════════════════════════════════════════════════════
  function renderCCKpis() {
    var el = document.getElementById('neg-cc-kpis'); if (!el) return;
    var s = NEG.data && NEG.data.summary; var zk = (s && s.zones) ? Object.keys(s.zones) : [];
    var cy = curYear();
    var most = { h: 0, z: '', y: '' }, deep = { v: 0, z: '' };
    CC_ZONES.forEach(function (c) {
      var ser = s && s.zones && s.zones[c]; if (!ser) return;
      var ys = yearSum(ser);
      Object.keys(ys).forEach(function (y) { if (ys[y] > most.h) most = { h: ys[y], z: c, y: y }; });
      var dp = deepest(ser); if (dp.v < deep.v) deep = { v: dp.v, z: c };
    });
    function kc(lbl, val, unit, sub, neg, zoneMeta) { return '<div class="kpi-card' + (neg?' kpi-down':' kpi-flat') + '"><div class="kpi-label">' + lbl + '</div><div class="kpi-value"' + (neg?' style="color:'+C_NEG+'"':'') + '>' + val + (unit?'<span class="kpi-unit">'+unit+'</span>':'') + '</div>' + (zoneMeta?'<div class="kpi-meta-zone">'+(sub||'')+'</div>':'<div class="kpi-chg">'+(sub||'')+'</div>') + '</div>'; }
    el.innerHTML =
      kc('Zones tracked', zk.length, '', CC_ZONES.length + ' featured', false) +
      kc('Most neg h', num(most.h, 0), 'h', most.z ? flag(most.z) + ' ' + most.z + ' · ' + most.y : '', true, true) +
      kc('Deepest print', deep.z ? num(deep.v, 0) : '–', '€', deep.z ? flag(deep.z) + ' ' + deep.z : '', true, true) +
      kc('Featured zones', CC_ZONES.length, '', 'with history', false) +
      kc('Reference', cy, '', 'current year', false);
  }

  function renderCCTabs() {
    var el = document.getElementById('neg-cc-tabs'); if (!el) return;
    var VIEWS = [
      { k:'year',   i:ICONS.bars,  l:'By zone × year' },
      { k:'rank',   i:ICONS.rank,  l:'Ranking' },
      { k:'monthhm',i:ICONS.map,   l:'Heatmap zone×month' },
      { k:'cumul',  i:ICONS.trend, l:'Cumulative' }
    ];
    el.innerHTML = VIEWS.map(function (v) {
      var on = v.k === NEG.ccView;
      return '<button onclick="negSetCCView(\'' + v.k + '\')" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:4px;cursor:pointer;border:none;background:' + (on ? '#151c24' : 'transparent') + ';color:' + (on ? C_TX : C_TX3) + ';font-family:\'Inter\',sans-serif;font-weight:500;letter-spacing:.03em">' + v.i + v.l + '</button>';
    }).join('');
  }
  window.negSetCCView = function (v) { NEG.ccView = v; renderCCTabs(); renderCCChart(); };

  function ccSetTitle(eyebrow, title, sub) {
    var e = document.getElementById('neg-cc-eyebrow'), t = document.getElementById('neg-cc-title'), su = document.getElementById('neg-cc-sub');
    if (e) e.textContent = eyebrow; if (t) t.textContent = title; if (su) su.textContent = sub;
  }

  function renderCCChart() {
    var host = document.getElementById('neg-cc-chart'); if (!host) return;
    var s = NEG.data && NEG.data.summary; if (!s || !s.zones) { host.innerHTML = backlogBox('No history loaded.'); return; }
    var view = NEG.ccView, cy = curYear();
    var zones = CC_ZONES.filter(function (c) { return s.zones[c]; });

    if (view === 'year') {
      ccSetTitle('Cross-zone — negative hours', 'Negative hours by zone and year', '2022 → ' + cy + ' · featured zones · ENTSO-E');
      var years = []; for (var y = 2022; y <= +cy; y++) years.push(String(y));
      var data = zones.map(function (c) { var ys = yearSum(s.zones[c]); return { c: c, vals: years.map(function (yy) { return ys[yy] || 0; }) }; });
      host.innerHTML = svgGrouped(data, years, cy);
    } else if (view === 'rank') {
      ccSetTitle('Cross-zone — ranking', 'Negative hours over window', NEG.win + ' · sorted desc');
      var rk = zones.map(function (c) { return { c: c, v: trailing(s.zones[c], NEG.win).reduce(function (a, d) { return a + (d.negH||0); }, 0) }; }).sort(function (a, b) { return b.v - a.v; });
      host.innerHTML = svgHBars(rk);
    } else if (view === 'monthhm') {
      ccSetTitle('Cross-zone — seasonality', 'Negative hours · zone × month', 'cumulative all years');
      host.innerHTML = svgZoneMonthHeatmap(zones, s);
    } else if (view === 'cumul') {
      ccSetTitle('Cross-zone — pace', 'Cumulative negative hours · ' + cy, 'featured zones, current year');
      host.innerHTML = svgCCcumul(zones, s, cy);
    }
  }

  function svgGrouped(data, years, partial) {
    var W = 740, H = 260, padL = 34, padB = 26, padT = 12, padR = 8;
    var max = 1; data.forEach(function (d) { d.vals.forEach(function (v) { if (v > max) max = v; }); }); max *= 1.1;
    var sy = function (v) { return H - padB - (v / max) * (H - padB - padT); };
    var gw = (W - padL - padR) / data.length, bw = (gw * 0.78) / years.length;
    var YCOL = {}; var greys = ['#3a434d','#566370','#7a8794']; years.forEach(function (y, i) { YCOL[y] = (y === partial) ? C_NEG_DEEP : (i === years.length - 2 ? C_NEG : greys[Math.min(i, greys.length-1)]); });
    var s = '<line x1="' + padL + '" y1="' + (H-padB) + '" x2="' + W + '" y2="' + (H-padB) + '" stroke="' + C_BD + '"/>';
    niceTicks(max).forEach(function (g) { var y = sy(g); s += '<line x1="' + padL + '" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="' + C_BD + '" stroke-dasharray="2 3" opacity=".4"/><text x="' + (padL-5) + '" y="' + (y+3) + '" fill="' + C_TX3 + '" font-size="8" text-anchor="end" font-family="monospace">' + g + '</text>'; });
    data.forEach(function (d, gi) {
      var gx = padL + gi * gw + gw * 0.11;
      d.vals.forEach(function (v, yi) { var x = gx + yi * bw, bh = (H - padB) - sy(v); s += '<rect x="' + x.toFixed(1) + '" y="' + sy(v).toFixed(1) + '" width="' + (bw-1).toFixed(1) + '" height="' + Math.max(0,bh).toFixed(1) + '" rx="1.5" fill="' + YCOL[years[yi]] + '"' + (years[yi]===partial?' opacity=".75"':'') + '/>'; });
      s += '<text x="' + (gx + (years.length*bw)/2).toFixed(1) + '" y="' + (H-9) + '" fill="' + C_TX2 + '" font-size="9.5" text-anchor="middle" font-family="monospace" font-weight="700">' + flag(d.c) + ' ' + d.c + '</text>';
    });
    var leg = years.map(function (y) { return '<span style="margin-right:12px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + YCOL[y] + ';vertical-align:-1px;margin-right:4px"></span>' + y + (y===partial?' (YTD)':'') + '</span>'; }).join('');
    return '<svg style="width:100%;height:auto;display:block" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:' + C_TX3 + ';margin-top:8px">' + leg + '</div>';
  }

  function svgHBars(rk) {
    var W = 720, rowH = 26, padL = 90, padR = 40, padT = 6;
    var H = padT + rk.length * rowH + 6;
    var max = Math.max.apply(null, rk.map(function (r) { return r.v; }).concat([1]));
    var s = '';
    rk.forEach(function (r, i) {
      var y = padT + i * rowH, bw = (r.v / max) * (W - padL - padR);
      s += '<text x="' + (padL-8) + '" y="' + (y+rowH/2+3) + '" fill="' + C_TX2 + '" font-size="10.5" text-anchor="end" font-family="monospace" font-weight="700">' + flag(r.c) + ' ' + r.c + '</text>';
      s += '<rect x="' + padL + '" y="' + (y+4) + '" width="' + Math.max(1,bw).toFixed(1) + '" height="' + (rowH-10) + '" rx="3" fill="' + C_NEG + '"/>';
      s += '<text x="' + (padL+bw+6).toFixed(1) + '" y="' + (y+rowH/2+3) + '" fill="' + C_NEG + '" font-size="10" font-family="monospace" font-weight="700">' + Math.round(r.v) + 'h</text>';
    });
    return '<svg style="width:100%;height:auto;display:block" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg>';
  }

  function svgZoneMonthHeatmap(zones, s) {
    var MN = ['J','F','M','A','M','J','J','A','S','O','N','D'];
    var rows = zones.map(function (c) { return { c: c, m: monthSum(s.zones[c]) }; });
    var max = 1; rows.forEach(function (r) { r.m.forEach(function (v) { if (v > max) max = v; }); });
    function col(v) { if (!v) return '#0f1419'; var t = v/max; return t<.25?'rgba(237,105,101,.28)':t<.55?'rgba(237,105,101,.55)':t<.85?C_NEG:C_NEG_DEEP; }
    var html = '<div style="display:grid;grid-template-columns:60px repeat(12,1fr);gap:3px;margin-top:6px">';
    html += '<div></div>' + MN.map(function (m) { return '<div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:' + C_TX3 + ';text-align:center">' + m + '</div>'; }).join('');
    rows.forEach(function (r) {
      html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:' + C_TX2 + ';font-weight:700;display:flex;align-items:center;gap:4px">' + flag(r.c) + ' ' + r.c + '</div>';
      r.m.forEach(function (v) { html += '<div title="' + Math.round(v) + 'h" style="aspect-ratio:2.2;border-radius:2px;background:' + col(v) + '"></div>'; });
    });
    html += '</div>';
    return html;
  }

  function svgCCcumul(zones, s, cy) {
    var W = 740, H = 240, padL = 34, padB = 22, padT = 12, padR = 60;
    var palette = ['#ED6965','#14D3A9','#FFB454','#7FC8F8','#9b8cff','#34D399','#F472B6','#FBBF24'];
    var seriesC = zones.map(function (c, i) {
      var ser = s.zones[c].filter(function (d) { return d.d.slice(0,4) === cy; });
      var cum = 0; var pts = ser.map(function (d) { cum += (d.negH||0); return { doy: doy(d.d), v: cum }; });
      return { c: c, pts: pts, col: palette[i % palette.length], tot: cum };
    });
    var max = Math.max.apply(null, seriesC.map(function (x) { return x.tot; }).concat([1])) * 1.1;
    var sx = function (dy) { return padL + (dy/366) * (W-padL-padR); }, sy = function (v) { return H-padB-(v/max)*(H-padB-padT); };
    var s2 = '<line x1="' + padL + '" y1="' + (H-padB) + '" x2="' + (W-padR) + '" y2="' + (H-padB) + '" stroke="' + C_BD + '"/>';
    niceTicks(max).forEach(function (g) { var y = sy(g); s2 += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W-padR) + '" y2="' + y + '" stroke="' + C_BD + '" stroke-dasharray="2 3" opacity=".4"/><text x="' + (padL-5) + '" y="' + (y+3) + '" fill="' + C_TX3 + '" font-size="8" text-anchor="end" font-family="monospace">' + g + '</text>'; });
    seriesC.forEach(function (x) {
      if (!x.pts.length) return;
      var path = 'M' + x.pts.map(function (p) { return sx(p.doy).toFixed(1) + ' ' + sy(p.v).toFixed(1); }).join(' L');
      s2 += '<path d="' + path + '" fill="none" stroke="' + x.col + '" stroke-width="1.6"/>';
      var last = x.pts[x.pts.length-1];
      s2 += '<text x="' + (sx(last.doy)+5).toFixed(1) + '" y="' + (sy(last.v)+3).toFixed(1) + '" fill="' + x.col + '" font-size="8.5" font-family="monospace" font-weight="700">' + x.c + '</text>';
    });
    return '<svg style="width:100%;height:auto;display:block" viewBox="0 0 ' + W + ' ' + H + '">' + s2 + '</svg>';
  }

  function renderCCTable() {
    var tb = document.getElementById('neg-cc-tbody'); if (!tb) return;
    var s = NEG.data && NEG.data.summary; if (!s || !s.zones) { tb.innerHTML = ''; return; }
    var cy = curYear(), ly = String(+cy - 1);
    var rows = CC_ZONES.filter(function (c) { return s.zones[c]; }).map(function (c) {
      var ser = s.zones[c], ys = yearSum(ser), dp = deepest(ser);
      var thisY = ys[cy] || 0, prevY = ys[ly] || 0;
      var daysNeg = ser.filter(function (d) { return d.d.slice(0,4) === ly && (d.negH||0) > 0; }).length;
      var pct = prevY ? Math.round((thisY - prevY) / prevY * 100) : null;
      return { c: c, h: Math.round(prevY), deep: dp.v, days: daysNeg, vy: pct, spark: yearsSpark(ys) };
    }).sort(function (a, b) { return b.h - a.h; });
    tb.innerHTML = rows.map(function (r) {
      return '<tr><td style="font-family:\'JetBrains Mono\',monospace;font-weight:700;color:' + C_TX2 + ';text-align:left">' + flag(r.c) + ' ' + r.c + '</td>' +
        '<td style="text-align:left;color:' + C_TX3 + '">' + zname(r.c) + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_NEG + ';font-weight:600;text-align:right">' + r.h + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_NEG + ';text-align:right">' + (r.deep ? Math.round(r.deep) : '–') + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;color:' + C_TX2 + ';text-align:right">' + r.days + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;text-align:right;color:' + (r.vy > 0 ? C_NEG : C_ACC) + '">' + (r.vy == null ? '–' : (r.vy > 0 ? '+' : '') + r.vy + '%') + '</td>' +
        '<td style="text-align:left;color:' + C_TX3 + '">' + r.spark + '</td></tr>';
    }).join('');
  }
  function yearsSpark(ys) {
    var years = Object.keys(ys).sort(); if (!years.length) return '';
    var vals = years.map(function (y) { return ys[y]; }); var max = Math.max.apply(null, vals.concat([1]));
    var blocks = '▁▂▃▄▅▆▇█';
    return vals.slice(-7).map(function (v) { return blocks[Math.min(7, Math.round(v/max*7))]; }).join('');
  }

  // ════════════════════════════════════════════════════════════════
  // ENTRY POINT
  // ════════════════════════════════════════════════════════════════
  function renderAll() {
    loadData().then(function () {
      try { renderBoardKpis(); } catch (e) { console.warn('[neg] board kpis', e); }
      try { renderBoardTable(); } catch (e) { console.warn('[neg] board table', e); }
      try { renderCCKpis(); } catch (e) { console.warn('[neg] cc kpis', e); }
      try { renderCCTabs(); } catch (e) { console.warn('[neg] cc tabs', e); }
      try { renderCCChart(); } catch (e) { console.warn('[neg] cc chart', e); }
      try { renderCCTable(); } catch (e) { console.warn('[neg] cc table', e); }
    });
  }
  window.negRenderAll = renderAll;

  // Window filter pills (affect cross-zone ranking/cumulative + drill daily)
  window.negSetWindow = function (w, btn) {
    NEG.win = w;
    if (btn && btn.parentNode) { btn.parentNode.querySelectorAll('.pk-gf-btn').forEach(function (b) { b.classList.remove('active'); }); btn.classList.add('active'); }
    try { renderCCChart(); } catch (e) {}
    if (NEG.openRow) { try { renderDrill(NEG.openRow); } catch (e) {} }
  };

  window.negCCFullscreen = function () { /* placeholder — fullscreen wiring backlog */ };
})();
