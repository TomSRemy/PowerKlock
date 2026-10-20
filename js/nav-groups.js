// ════════════════════════════════════════════════════════════════════
// MENU GROUPS — Power › Supply & Demand, France, and pages listed under
// Prices (Imbalance). A group header opens its pages; the group holding
// the current page stays open and shows the same tree lines as Prices.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  function lines(wrap) {
    const items = wrap.querySelectorAll('.sidebar-subitem'); if (!items.length) return;
    // hidden (closed phone menu): let the CSS default draw the line until it can be measured
    if (!wrap.offsetHeight) { wrap.style.removeProperty('--line-end'); return; }
    const top = wrap.getBoundingClientRect().top, mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 - top; };
    wrap.style.setProperty('--line-end', mid(items[items.length - 1]) + 'px');
    const a = wrap.querySelector('.sidebar-subitem.active');
    wrap.style.setProperty('--path-height', a ? mid(a) + 'px' : '0px');
  }
  // the menu section was sized when the page loaded: let it follow a group opening or closing
  function fitSection(el) {
    const items = el && el.closest('.sidebar-section-items'), sec = items && items.closest('.sidebar-section');
    if (!items || (sec && sec.classList.contains('collapsed'))) return;
    items.style.maxHeight = '2000px';
    setTimeout(() => { if (!sec || !sec.classList.contains('collapsed')) items.style.maxHeight = items.scrollHeight + 'px'; }, 260);
  }
  function sync(id) {
    document.querySelectorAll('.sidebar-subitem[data-page]').forEach(s => s.classList.toggle('active', !!id && s.dataset.page === id));
    document.querySelectorAll('.pk-nav-wrap, #prices-subitems').forEach(w => {
      const on = !!w.querySelector('.sidebar-subitem[data-page].active');
      const head = w.previousElementSibling;
      if (on) w.classList.add('open'); else if (w.id === 'prices-subitems') w.classList.remove('open');
      if (head) head.classList.toggle('has-active-subitem', on || (head.id === 'nav-prices' && head.classList.contains('has-active-subitem') && !id));
      if (head && head.classList.contains('pk-nav-group')) head.classList.toggle('open', w.classList.contains('open'));
    });
    setTimeout(() => document.querySelectorAll('.pk-nav-wrap, #prices-subitems').forEach(lines), 230);
    fitSection(document.getElementById('sec-power-items') && document.querySelector('#sec-power-items > *'));
  }
  window.pkNavGroup = function (g) {
    const w = document.getElementById('navw-' + g), h = document.getElementById('navg-' + g); if (!w) return;
    w.classList.toggle('open'); if (h) h.classList.toggle('open', w.classList.contains('open'));
    fitSection(w); setTimeout(() => lines(w), 230);
  };
  // phone: the menu is a drawer — measure the tree lines once it is open
  window.addEventListener('load', () => {
    const sb = document.getElementById('sidebar');
    if (sb && window.ResizeObserver) new ResizeObserver(() => document.querySelectorAll('.pk-nav-wrap, #prices-subitems').forEach(lines)).observe(sb);
  });
  window.addEventListener('load', () => setTimeout(() => {
    const inner = window.showPage;
    if (typeof inner === 'function') window.showPage = function (id) { const r = inner.apply(this, arguments); sync(id); return r; };
    const cur = document.querySelector('.page.active'); sync(cur ? cur.id.replace('page-', '') : null);
  }, 0));
})();
