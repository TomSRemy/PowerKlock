// ════════════════════════════════════════════════════════════════════
// PowerKlock chart system: one semantic palette + one set of Chart.js
// defaults for every chart on the site. Loaded right after js/palette.js.
//
// Colour follows the ENTITY, never the rank: a fuel, a bidding zone or a
// product keeps the same colour on every chart. Values validated on the
// chart surface #0f1419 with the dataviz validator (OKLab ΔE, Machado CVD
// simulation): see STYLEGUIDE § 3 and sitepass/a3/out/palette_validation.txt.
//
//   PK_PAL.fuel.<key>      fixed fuel colours (violet = nuclear only)
//   PK_PAL.zone.<code>     fixed zone colours (8 zones; others: small multiples)
//   PK_PAL.series[i]       generic categorical order (≤ 8, never generated)
//   PK_PAL.price.up/down   rising price red, falling price green (Tom's rule)
//   PK_PAL.product / tenor Base · Peak · Off-peak; ordinal ramp M+1 → Y+3
//   pkFuelColor(labelOrKey), pkZoneColor(labelOrCode), pkAlpha(hex, a)
//
// A global Chart.js plugin (pkPalette) maps, before each update, any dataset
// whose label names a fuel or one of the 8 zones to its fixed colour (alpha of
// the original fill kept, neutral greys kept for emphasis charts). Opt out per
// chart with options.plugins.pkPalette = false, per dataset with pkKeepColor.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var PK_PAL = {
    surface: '#0f1419',
    ink: { text: '#FFFFFF', text2: '#B8C9D9', text3: '#7A93AB' },
    grid: 'rgba(26,45,63,.5)',
    price: { up: '#ED6965', down: '#14D3A9', flat: '#7A93AB' },
    now: '#FFFD82',
    neutral: '#7A93AB',
    reference: '#B8C9D9',            // averages, previous year, envelopes
    // stack order = array order (validated on adjacent pairs, worst CVD ΔE 7.8 coal/oil)
    fuelOrder: ['nuclear', 'hydro', 'pumped', 'wind', 'windOff', 'solar', 'biomass', 'gas', 'coal', 'oil', 'other', 'battery'],
    fuel: {
      nuclear: '#9B6BC4',   // violet reserved for nuclear; 4.7:1 on #0f1419 (was #7B4B9C, 2.9:1)
      hydro: '#5CB2F5',
      pumped: '#2F6FC0',
      wind: '#14D3A9',      // STYLEGUIDE: wind = mint, everywhere
      windOff: '#0B8F7E',
      solar: '#FBBF24',
      biomass: '#4E8A2C',
      gas: '#F79A3E',
      coal: '#83563A',      // lignite: same hue, hatched or dashed when split
      lignite: '#83563A',
      oil: '#E0525A',
      fossil: '#ED6965',    // aggregate "fossil" when gas/coal/oil are not split
      other: '#8D99AE',
      battery: '#C2457E',
      load: '#E6EDF3',      // consumption line drawn over stacks
      exchange: '#B8C9D9',
    },
    // 8 zones on the validated categorical order (worst adjacent CVD ΔE 10.6)
    zoneOrder: ['FR', 'DE', 'BE', 'ES', 'NL', 'IT', 'GB', 'CH'],
    zone: { FR: '#14D3A9', DE: '#F2A65A', BE: '#4AA3E0', ES: '#ED6965', NL: '#E8C547', IT: '#E879A6', GB: '#7DD3FC', CH: '#8BC34A' },
    series: ['#14D3A9', '#F2A65A', '#4AA3E0', '#ED6965', '#E8C547', '#E879A6', '#7DD3FC', '#8BC34A'],
    product: { base: '#E8EEF4', peak: '#F2A65A', offpeak: '#4AA3E0' },
    tenor: ['#C6E3FB', '#93C6F4', '#62A6E8', '#3F86D2', '#2D68B0'],   // M+1 … Y+3 (ordinal, validated)
  };

  // FR + EN labels → fuel key. Order matters (offshore before wind, pumped before hydro).
  var FUEL_RX = [
    ['windOff', /(é|e)olien (en )?mer|offshore|wind off/i],
    ['wind', /(é|e)olien|\bwind\b|onshore/i],
    ['solar', /solaire|\bsolar\b|photovolta|\bpv\b/i],
    ['pumped', /pompage|pumped|\bstep\b|turbinage|turbining/i],
    ['battery', /batter|\bbess\b/i],
    ['hydro', /hydrau|\bhydro/i],
    ['nuclear', /nucl/i],
    ['biomass', /biomass|bio(é|e)nerg|bioenerg/i],
    ['lignite', /lignite/i],
    // "coal-derived gas" (ENTSO-E B03) is a gas category, not coal: excluded here so it falls through to ['gas'] below
    ['coal', /charbon|\bcoal\b(?!-derived)|houille|hard coal/i],
    ['oil', /fioul|p(é|e)trole|\boil\b/i],
    ['gas', /^gaz\b|\bgaz\b|^gas\b|\bgas\b(?!oil)|ccgt|cycle combin/i],
    ['fossil', /fossil/i],
  ];
  // things that merely mention a fuel without being it (prices of gas, TTF, spreads…)
  var NOT_FUEL = /ttf|spark|dark|spread|€\/t|eua|co2|co₂|clean|ratio|prix du gaz|gas price|coût|cost/i;
  var ZONE_NAMES = { france: 'FR', allemagne: 'DE', germany: 'DE', belgique: 'BE', belgium: 'BE', espagne: 'ES', spain: 'ES',
    'pays-bas': 'NL', netherlands: 'NL', italie: 'IT', italy: 'IT', 'royaume-uni': 'GB', 'great britain': 'GB', 'united kingdom': 'GB', suisse: 'CH', switzerland: 'CH' };

  function fuelKey(label) {
    if (!label || typeof label !== 'string') return null;
    if (PK_PAL.fuel[label]) return label;
    if (NOT_FUEL.test(label)) return null;
    for (var i = 0; i < FUEL_RX.length; i++) if (FUEL_RX[i][1].test(label)) return FUEL_RX[i][0];
    return null;
  }
  function zoneKey(label) {
    if (!label || typeof label !== 'string') return null;
    var m = label.trim().match(/^([A-Z]{2})(?:_[A-Z]+)?\b/);
    if (m && PK_PAL.zone[m[1]] && !/^(IT_(?!NORD))/.test(label)) return m[1];
    var w = label.trim().toLowerCase().split(/\s*[·(,]\s*/)[0];
    return ZONE_NAMES[w] || null;
  }
  function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function alphaOf(c) {
    if (typeof c !== 'string') return 1;
    var m = c.match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i); if (m) return parseInt(m[1], 16) / 255;
    m = c.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/i); if (m) return +m[1];
    return 1;
  }
  function isNeutral(c) {
    if (typeof c !== 'string') return false;
    var rgb;
    if (/^#[0-9a-f]{6}/i.test(c)) rgb = hexToRgb(c.slice(0, 7));
    else { var m = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i); if (!m) return false; rgb = [+m[1], +m[2], +m[3]]; }
    var mx = Math.max.apply(null, rgb), mn = Math.min.apply(null, rgb);
    return mx === 0 || (mx - mn) / mx < 0.18;   // greys / near-whites: emphasis or reference series
  }
  function pkAlpha(hex, a) { if (a >= 0.999) return hex; var r = hexToRgb(hex); return 'rgba(' + r[0] + ',' + r[1] + ',' + r[2] + ',' + (+a).toFixed(2) + ')'; }
  function mix(hex, to, t) { var a = hexToRgb(hex), b = hexToRgb(to); return '#' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0'); }).join(''); }
  // second and third member of the same family in one chart (Grand / Petit solaire…)
  function variant(hex, n) { return n === 0 ? hex : n === 1 ? mix(hex, '#ffffff', 0.38) : mix(hex, '#000000', 0.32); }

  function pkFuelColor(labelOrKey) { var k = fuelKey(labelOrKey); return k ? PK_PAL.fuel[k] : null; }
  function pkZoneColor(labelOrCode) { var k = zoneKey(labelOrCode); return k ? PK_PAL.zone[k] : null; }

  function recolour(ds, base) {
    var single = function (c) { return typeof c === 'string' || c == null; };
    if (!single(ds.borderColor) || !single(ds.backgroundColor)) return false;   // per-point colours: left as built
    var bA = alphaOf(ds.borderColor), fA = alphaOf(ds.backgroundColor);
    if (ds.borderColor && ds.borderColor !== 'transparent') ds.borderColor = pkAlpha(base, bA);
    if (ds.backgroundColor && ds.backgroundColor !== 'transparent') ds.backgroundColor = pkAlpha(base, fA);
    if (!ds.borderColor && !ds.backgroundColor) ds.borderColor = base;
    return true;
  }

  function applyPalette(chart) {
    var cfg = chart.config || chart;
    var opts = cfg.options || {};
    if (opts.plugins && opts.plugins.pkPalette === false) return;
    var dsets = (cfg.data && cfg.data.datasets) || [];
    var seen = {};
    var zset = {}; dsets.forEach(function (d) { var z = d && zoneKey(d.label); if (z) zset[z] = 1; });
    var zoneHits = Object.keys(zset).length;   // two different zones at least: a zone comparison
    dsets.forEach(function (d) {
      if (!d || d.pkKeepColor || d._pkPal === 1) return;
      var lab = typeof d.label === 'string' ? d.label : '';
      if (!lab || lab.charAt(0) === '_') return;
      var cur = d.borderColor || d.backgroundColor;
      if (isNeutral(cur)) return;                         // emphasis / reference greys stay grey
      var fk = fuelKey(lab), base = null;
      if (fk) {
        // same fuel twice in one chart: same colour when dash or type tells them apart, else a lighter/darker step
        var sig = fk + '|' + (d.type || '') + '|' + (Array.isArray(d.borderDash) && d.borderDash.length ? 'dash' : '') + '|' + (d.yAxisID || '');
        var n = seen[sig] = (seen[sig] === undefined ? 0 : seen[sig] + 1);
        base = variant(PK_PAL.fuel[fk], n);
      } else if (zoneHits >= 2) {
        var zk = zoneKey(lab);
        if (zk) base = PK_PAL.zone[zk];
      }
      if (base && recolour(d, base)) d._pkPal = 1;
    });
  }

  // ── Chart.js defaults (STYLEGUIDE § 3): Chart.defaults now reach every chart
  // (the duplicate bundle that used to override them is gone, see libs.js).
  if (window.Chart && Chart.defaults) {
    var D = Chart.defaults;
    D.font.family = "'JetBrains Mono', monospace";   // ticks and legends (Helvetica/Arial before)
    D.font.size = 10;
    D.color = PK_PAL.ink.text3;
    D.borderColor = PK_PAL.grid;
    D.elements.line.tension = 0;          // straight lines between points (owner's rule)
    D.elements.line.borderWidth = 1.5;
    D.elements.point.radius = 0;
    D.elements.point.hoverRadius = 3;
    D.plugins.legend.position = 'bottom';
    D.plugins.legend.labels.boxWidth = 10;
    D.plugins.legend.labels.boxHeight = 10;
    D.plugins.legend.labels.color = PK_PAL.ink.text2;
    try { D.scale.grid.color = PK_PAL.grid; D.scale.grid.drawTicks = false; D.scale.ticks.color = PK_PAL.ink.text3; } catch (_) {}
    Chart.register({
      id: 'pkPalette',
      beforeUpdate: function (chart) {
        applyPalette(chart);
        // guard for the "no smoothing" rule, whatever a chart asked for
        ((chart.config.data && chart.config.data.datasets) || []).forEach(function (d) { if (d && d.tension) d.tension = 0; if (d && d.cubicInterpolationMode === 'monotone') d.cubicInterpolationMode = 'default'; });
        // 10 px floor for text drawn on the canvas (STYLEGUIDE § 5: nothing under 10 px)
        var o = chart.config.options || {};
        var floor = function (f) { if (f && typeof f === 'object' && typeof f.size === 'number' && f.size < 10) f.size = 10; };
        Object.keys(o.scales || {}).forEach(function (k) { var s = o.scales[k] || {}; if (s.ticks) floor(s.ticks.font); if (s.title) floor(s.title.font); });
        if (o.plugins && o.plugins.legend && o.plugins.legend.labels) floor(o.plugins.legend.labels.font);
      },
    });
  }

  // CSS custom properties, so HTML legends and KPI chips use the same values
  try {
    var st = document.documentElement.style;
    Object.keys(PK_PAL.fuel).forEach(function (k) { st.setProperty('--fuel-' + k, PK_PAL.fuel[k]); });
    Object.keys(PK_PAL.zone).forEach(function (k) { st.setProperty('--zone-' + k, PK_PAL.zone[k]); });
    st.setProperty('--price-up', PK_PAL.price.up); st.setProperty('--price-down', PK_PAL.price.down);
  } catch (_) {}

  window.PK_PAL = PK_PAL;
  window.pkFuelColor = pkFuelColor;
  window.pkZoneColor = pkZoneColor;
  window.pkAlpha = pkAlpha;
  window.pkApplyPalette = applyPalette;
  window.pkFuelKey = fuelKey;
  window.pkZoneKey = zoneKey;
})();
