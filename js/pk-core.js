// ════════════════════════════════════════════════════════════════════
// PK CORE — helpers shared by every script, loaded first.
//   PK.esc(text)          text safe inside HTML (& < > " ')
//   PK.today()            calendar date in Paris, YYYY-MM-DD (day-ahead days are Paris days)
//   PK.onPage(id, fn)     run fn(id) each time page `id` is shown ('*' = every page), once the site has
//                         loaded. One extension point instead of each module wrapping showPage.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const PK = window.PK = window.PK || {};
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  PK.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  PK.today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

  // line icons in the site's style (no emojis): PK.icon('download')
  const IC = {
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    leaf: '<path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19 13 11"/>',
    flame: '<path d="M12 3s5 5 5 10a5 5 0 0 1-10 0c0-3 2-5 2-5s0 3 3 3c0-4-0-6 0-8z"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    alert: '<path d="M12 4 2 20h20z"/><path d="M12 10v5M12 17.5v.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z"/>',
    tank: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  };
  PK.icon = (name, size) => IC[name] ? '<svg class="pk-ic" width="' + (size || 13) + '" height="' + (size || 13) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px">' + IC[name] + '</svg>' : '';

  const hooks = [];
  let ready = false;
  PK.onPage = (id, fn) => { hooks.push([id, fn]); };
  // called by showPage (js/prices/core.js) after a page is shown; hooks run from the window load on, as the
  // wrappers they replace did (they were installed at load)
  PK.pageShown = id => {
    if (!ready) return;
    for (const [k, fn] of hooks) {
      if (k !== '*' && k !== id) continue;
      try { fn(id); } catch (e) { console.warn('[PK.onPage ' + k + ']', e); }
    }
  };
  window.addEventListener('load', () => { ready = true; });
})();
