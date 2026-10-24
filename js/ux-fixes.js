// ════════════════════════════════════════════════════════════════════
// UX AND ACCESSIBILITY FIXES shared by every page (UX audit 2, lot B).
//   · view tabs announced as tabs (role="tab", aria-selected), whatever
//     module draws them (WCAG 4.1.2);
//   · tables that scroll sideways reachable with the keyboard (WCAG 2.1.1);
//   · fields without a visible label given a name (WCAG 4.1.2);
//   · one colour rule for a price change: up = red (dearer for the buyer),
//     down = green, the ticker included;
//   · phone: one-line top bar, no scrolling ticker; vote buttons 28 px;
//   · contrast of a few inline colours (nuclear purple, links in the brief).
// Runs when the site opens, when a page is shown and when a view tab is clicked.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function tabs(root) {
    root.querySelectorAll('[role="tablist"]').forEach(list => {
      list.querySelectorAll(':scope > .tab-btn, :scope > button').forEach(b => {
        if (b.getAttribute('role') !== 'tab') b.setAttribute('role', 'tab');
        const on = b.classList.contains('active') ? 'true' : 'false';
        if (b.getAttribute('aria-selected') !== on) b.setAttribute('aria-selected', on);
      });
    });
  }

  const titleNear = el => {
    const box = el.closest('.chart-container, .table-wrap, .hist-section, .fuel-card, .pkd-item');
    const t = box && box.querySelector('.table-title, .chart-title, .hist-section-title, .pkd-title');
    return t ? t.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) : 'Table';
  };
  function scrollers(root) {
    root.querySelectorAll('.page.active [style*="overflow-x:auto"], .page.active [style*="overflow-x: auto"], .page.active .table-wrap').forEach(el => {
      if (el.hasAttribute('tabindex') || el.scrollWidth <= el.clientWidth + 1) return;
      if (el.querySelector('a, button, input, select, textarea, [tabindex]')) return;   // already reachable
      el.setAttribute('tabindex', '0'); el.setAttribute('role', 'region');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', titleNear(el));
    });
  }

  const NAMES = { 'gm-date-picker-input': 'Date', 'pp-fan-unit': 'Unit' };
  function names(root) {
    Object.entries(NAMES).forEach(([id, n]) => { const e = document.getElementById(id); if (e && !e.getAttribute('aria-label')) e.setAttribute('aria-label', n); });
    // the page on screen only: going through every field of the site at each page cost ~40 ms (profiler)
    const scope = document.querySelector('.page.active') || document.getElementById('page-mydash') || root;
    scope.querySelectorAll('select:not([aria-label]):not([aria-labelledby]), input:not([type=hidden]):not([aria-label]):not([aria-labelledby])').forEach(e => {
      if (e.labels && e.labels.length) return;
      const n = e.getAttribute('title') || e.getAttribute('placeholder') || (e.dataset && e.dataset.label);
      if (n) e.setAttribute('aria-label', n);
    });
  }

  // run at fixed moments (not on every change of the page: measuring scroll widths on each change slowed phones down)
  const run = () => { try { tabs(document); names(document); scrollers(document); } catch (_) {} };
  const soon = () => [300, 1500, 4000].forEach(t => setTimeout(run, t));
  document.addEventListener('DOMContentLoaded', run);
  window.addEventListener('load', () => {
    soon();
    PK.onPage('*', soon);
    ['switchDashboard'].forEach(name => {
      const inner = window[name];
      if (typeof inner === 'function') window[name] = function () { const r = inner.apply(this, arguments); soon(); return r; };
    });
  });
  // a view tab clicked: its tab list says which one is selected
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.tab-btn, [role="tablist"] > button')) setTimeout(() => { tabs(document); scrollers(document); }, 50); });

  const css = document.createElement('style');
  css.textContent = `
  /* one rule for a price change: up = red (dearer for the buyer), down = green; the arrow and the sign stay */
  .ticker .ticker-val.up, .ticker .ticker-chg.up { color: var(--down); }
  .ticker .ticker-val.down, .ticker .ticker-chg.down { color: var(--up); }
  /* contrast (WCAG 1.4.3): inline nuclear purple and plain links in text blocks */
  html:not([data-theme="light"]) [style*="#7B4B9C"]:not(canvas):not(svg *) { color: #A98BD4 !important; }
  .mrn-moves a:not([class]), .fuel-note a:not([class]) { color: var(--accent); }
  .news-vote .nv { opacity: .8; min-width: 28px; min-height: 28px; justify-content: center; }
  /* phone: one-line top bar, the scrolling ticker and the clock hidden */
  @media (max-width: 768px) {
    :root { --ticker-h: 0px !important; }
    .ticker { display: none !important; }
    .topbar .clock, .topbar-right .clock { display: none !important; }
    .topbar-right { flex-wrap: nowrap; }
  }`;
  document.head.appendChild(css);
})();
