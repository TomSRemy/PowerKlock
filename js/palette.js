// ════════════════════════════════════════════
// PALETTE EXTENSIONS — additions to globals.js
// ════════════════════════════════════════════
// This file contains ONLY the new palette-related functions added on top of
// the existing globals.js (which is bundled into libs.js). It must be loaded
// AFTER libs.js so the existing C_UP, C_TX2, etc. constants are already in
// scope, and BEFORE any consumer (prices.js, genmix.js, etc.).
//
// New exports:
//   SERIES_POOL              — 8 hand-picked colours for multi-zone charts
//   SERIES_NEUTRAL           — fallback grey
//   SERIES_MAX_DISTINCT      — soft limit (8)
//   getSeriesColor(i)        — returns colour for zone index i (farthest-point Lab)
//   nowLineAnnotation(opts)  — Chart.js annotation for today's current hour
// ════════════════════════════════════════════

// Multi-zone series pool — 8 hand-picked colours with max contrast
var SERIES_POOL = [
  '#14D3A9',  // 1. Mint Leaf
  '#ED6965',  // 2. Vibrant Coral
  '#FFFD82',  // 3. Canary Yellow
  '#1A7B8C',  // 4. Lagoon
  '#CA6702',  // 5. Burnt Caramel
  '#BB3E03',  // 6. Rusty Spice
  '#7DD3FC',  // 7. Sky Blue
  '#8B7FB5',  // 8. Slate Violet
];
var SERIES_NEUTRAL = '#7A93AB';
var SERIES_MAX_DISTINCT = 8;

// ── Farthest-point colour generation for indices 9+
function _hexToRgb(hex) {
  var h = hex.replace('#','');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function _rgbToLab(r, g, b) {
  var lin = function(c) { c /= 255; return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  var R = lin(r), G = lin(g), B = lin(b);
  var X = R*0.4124 + G*0.3576 + B*0.1805;
  var Y = R*0.2126 + G*0.7152 + B*0.0722;
  var Z = R*0.0193 + G*0.1192 + B*0.9505;
  var f = function(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787*t + 16/116; };
  var fx = f(X/0.95047), fy = f(Y), fz = f(Z/1.08883);
  return [116*fy - 16, 500*(fx-fy), 200*(fy-fz)];
}
function _hexToLab(hex) { var rgb = _hexToRgb(hex); return _rgbToLab(rgb[0], rgb[1], rgb[2]); }
function _labDist(a, b) {
  var d0 = a[0]-b[0], d1 = a[1]-b[1], d2 = a[2]-b[2];
  return Math.sqrt(d0*d0 + d1*d1 + d2*d2);
}
function _hslToHex(h, s, l) {
  s /= 100; l /= 100;
  var k = function(n) { return (n + h/30) % 12; };
  var a = s * Math.min(l, 1-l);
  var f = function(n) {
    var c = l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)));
    return Math.round(c*255).toString(16).padStart(2,'0');
  };
  return '#' + f(0) + f(8) + f(4);
}

var _seriesCache = [];
var _seriesUsedLabs = null;
function _initLabCache() { _seriesUsedLabs = SERIES_POOL.map(_hexToLab); }

function getSeriesColor(index) {
  if (index < SERIES_POOL.length) return SERIES_POOL[index];
  if (_seriesCache[index]) return _seriesCache[index];
  if (!_seriesUsedLabs) _initLabCache();
  for (var i = SERIES_POOL.length; i <= index; i++) {
    if (_seriesCache[i]) continue;
    var bestHex = null, bestMinDist = -1;
    for (var h = 0; h < 360; h += 12) {
      var sats = [55, 70, 85];
      for (var si = 0; si < sats.length; si++) {
        var lights = [50, 62, 72];
        for (var li = 0; li < lights.length; li++) {
          var hex = _hslToHex(h, sats[si], lights[li]);
          var lab = _hexToLab(hex);
          var minD = Infinity;
          for (var u = 0; u < _seriesUsedLabs.length; u++) {
            var d = _labDist(lab, _seriesUsedLabs[u]);
            if (d < minD) minD = d;
          }
          if (minD > bestMinDist) { bestMinDist = minD; bestHex = hex; }
        }
      }
    }
    _seriesCache[i] = bestHex;
    _seriesUsedLabs.push(_hexToLab(bestHex));
  }
  return _seriesCache[index];
}

// ── NOW line helper for daily charts
// Returns a Chart.js annotation object for the current hour, or null if the
// chart is showing a date other than today (DP.selectedDate is past/future).
function nowLineAnnotation(opts) {
  opts = opts || {};
  var today = new Date().toISOString().slice(0, 10);
  var selected = window.DP && window.DP.selectedDate;
  if (selected && selected !== today) return null;

  var slots = opts.slots || 24;
  var now = new Date();
  var x = slots === 96
    ? now.getHours() * 4 + now.getMinutes() / 15
    : now.getHours() + now.getMinutes() / 60;

  return {
    type: 'line',
    xMin: x,
    xMax: x,
    borderColor: '#FFFD82',
    borderWidth: 1.5,
    borderDash: [4, 3],
    label: {
      display: true,
      content: opts.label || 'NOW',
      position: 'start',
      color: '#FFFD82',
      font: { size: 10, weight: '600', family: "'IBM Plex Mono', monospace" },
      backgroundColor: 'transparent',
      padding: 2,
    },
  };
}
