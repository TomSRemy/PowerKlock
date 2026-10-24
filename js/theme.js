// ════════════════════════════════════════════════════════════════════
// Light / dark theme. The page's colours are CSS variables, redefined under
// html[data-theme="light"] (index.html). Charts carry their own colours, set
// for a dark background: a Chart.js plugin swaps, in light mode, the light
// texts and dark grid lines for their light-theme counterparts before each
// draw (datasets keep their colours, except near-white lines). The choice is
// kept in this browser (pk-theme); the attribute is set before the first paint.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const KEY = 'pk-theme';
  const light = () => document.documentElement.getAttribute('data-theme') === 'light';
  const lum = c => { // relative luminance of #rgb / #rrggbb / rgb(a)(), null if unknown
    if (typeof c !== 'string') return null;
    let r, g, b, m;
    if ((m = c.match(/^#([0-9a-f]{3})$/i))) [r, g, b] = m[1].split('').map(x => parseInt(x + x, 16));
    else if ((m = c.match(/^#([0-9a-f]{6})/i))) [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    else if ((m = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i))) [r, g, b] = [m[1], m[2], m[3]].map(Number);
    else if (/^(white|#fff)$/i.test(c)) [r, g, b] = [255, 255, 255];
    else return null;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const TXT = '#1F2D3D', TXT2 = '#3D5068', GRIDC = 'rgba(31,45,61,.10)';
  const text = c => { const l = lum(c); return l == null ? c : l > 0.62 ? TXT : l > 0.45 ? TXT2 : c; };
  const grid = c => { const l = lum(c); return l != null && l < 0.35 ? GRIDC : c; };
  function fix(o, depth) {
    if (!o || typeof o !== 'object' || depth > 6) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (k === 'color' && typeof v === 'string') o[k] = text(v);
      else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'data') fix(v, depth + 1);
    }
  }
  const plugin = {
    id: 'pkTheme',
    beforeUpdate(ch) {
      if (!light()) return;
      const o = ch.config.options || {};
      Object.values(o.scales || {}).forEach(s => { if (s.grid && s.grid.color) s.grid.color = grid(s.grid.color); if (s.border && s.border.color) s.border.color = grid(s.border.color); fix(s.ticks, 1); fix(s.title, 1); });
      if (o.plugins) { fix(o.plugins.legend, 1); fix(o.plugins.title, 1); fix(o.plugins.subtitle, 1); }
      (ch.config.data.datasets || []).forEach(d => { if (typeof d.borderColor === 'string' && lum(d.borderColor) > 0.8) d.borderColor = '#5B6B7E'; });
    },
  };
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(KEY, t); } catch (_) {}
    if (window.Chart) { Chart.defaults.color = t === 'light' ? TXT2 : '#B8C9D9';
      Object.values(Chart.instances || {}).forEach(c => { try { if (t === 'dark') { location.reload(); return; } c.update('none'); } catch (_) {} }); }
    const b = document.getElementById('pk-theme-btn'); if (b) { b.title = t === 'light' ? 'Dark theme' : 'Light theme'; b.innerHTML = t === 'light' ? MOON : SUN; }
  }
  const SUN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  const MOON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  function init() {
    if (window.Chart && Chart.register) { try { Chart.register(plugin); } catch (_) {} if (light()) Chart.defaults.color = TXT2; }
    const right = document.querySelector('.topbar-right'); if (!right || document.getElementById('pk-theme-btn')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'pk-theme-btn'; b.className = 'pk-theme-btn';
    b.addEventListener('click', () => apply(light() ? 'dark' : 'light'));
    right.insertBefore(b, right.firstChild);
    apply(light() ? 'light' : 'dark');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.PKTheme = { apply };
})();
