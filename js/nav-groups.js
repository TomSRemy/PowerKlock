// ════════════════════════════════════════════════════════════════════
// MENU GROUPS — Prices, Power › Supply & Demand, France, and the GO entries.
// One rule for every group:
//   · the group holding the current page opens by itself;
//   · the chevron folds / unfolds it at any time;
//   · clicking an open group's header again folds it (Prices: when its
//     page is already shown).
// Groups stay as the user left them otherwise. The grey tree line is CSS;
// only the green path to the current entry is measured, once the group is open.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const GROUPS = [['nav-prices', 'prices-subitems'], ['navg-supply', 'navw-supply'], ['navg-france', 'navw-france']];
  const $ = id => document.getElementById(id);
  const curPage = () => { const p = document.querySelector('.page.active'); return p ? p.id.replace('page-', '') : null; };

  function path(wrap) {
    const a = wrap.querySelector('.sidebar-subitem.active');
    if (!a || !wrap.classList.contains('open') || !wrap.offsetHeight) { wrap.style.setProperty('--path-height', '0px'); return; }
    const top = wrap.getBoundingClientRect().top, r = a.getBoundingClientRect();
    wrap.style.setProperty('--path-height', (r.top + r.height / 2 - top) + 'px');
  }
  // the menu section was sized when the page loaded: let it follow a group opening or closing
  function fitSection(el) {
    const items = el && el.closest('.sidebar-section-items'), sec = items && items.closest('.sidebar-section');
    if (!items || (sec && sec.classList.contains('collapsed'))) return;
    items.style.maxHeight = '2400px';
    setTimeout(() => { if (!sec || !sec.classList.contains('collapsed')) items.style.maxHeight = items.scrollHeight + 'px'; }, 260);
  }
  function setOpen(headId, wrapId, open) {
    const h = $(headId), w = $(wrapId); if (!w) return;
    w.classList.toggle('open', open); if (h) h.classList.toggle('open', open);
    fitSection(w);
    setTimeout(() => path(w), 240);
  }
  const isOpen = wrapId => { const w = $(wrapId); return !!(w && w.classList.contains('open')); };
  function toggle(headId, wrapId) { setOpen(headId, wrapId, !isOpen(wrapId)); }
  window.pkNavGroup = g => toggle('navg-' + g, 'navw-' + g);

  // current page → active entries, its group opened
  function sync() {
    const id = curPage();
    document.querySelectorAll('.sidebar-subitem[data-page]').forEach(s => s.classList.toggle('active', s.dataset.page === id));
    GROUPS.forEach(([hid, wid]) => {
      const w = $(wid), h = $(hid); if (!w) return;
      const mine = !!w.querySelector('.sidebar-subitem[data-page].active') || (wid === 'prices-subitems' && id === 'prices');
      if (h && wid !== 'prices-subitems') h.classList.toggle('has-active-subitem', mine);
      if (h && wid === 'prices-subitems' && !mine) h.classList.remove('has-active-subitem');
      if (mine && !w.classList.contains('open')) setOpen(hid, wid, true); else setTimeout(() => path(w), 240);
    });
    // GO: two entries for the two views of the page
    const b = document.querySelector('#go-tabs-nav .tab-btn.active'), ga = $('nav-goauctions'), gp = $('nav-goprices');
    if (ga && gp && id === 'goprices') { const auc = !!b && b.dataset.tab === 'auctions'; ga.classList.toggle('active', auc); gp.classList.toggle('active', !auc); }
  }
  window.pkGoTab = function (tab) {
    if (typeof window.showPage === 'function') window.showPage('goprices');
    const b = document.querySelector('#go-tabs-nav .tab-btn[data-tab="' + tab + '"]');
    if (b && !b.classList.contains('active')) b.click();
    sync();
  };

  window.addEventListener('load', () => setTimeout(() => {
    // chevron: fold / unfold without navigating
    document.querySelectorAll('.pk-nav-chev[data-chev="prices"]').forEach(c => c.addEventListener('click', e => { e.stopPropagation(); toggle('nav-prices', 'prices-subitems'); }));
    // Prices header: open its page, or fold the group when that page is already shown
    const np = $('nav-prices');
    if (np) { const go = np.onclick; np.onclick = function (e) { if (curPage() === 'prices' && isOpen('prices-subitems')) { if (e) e.pkFold = true; setOpen('nav-prices', 'prices-subitems', false); return; } if (go) go.call(this, e); setOpen('nav-prices', 'prices-subitems', true); }; }
    const inner = window.showPage;
    if (typeof inner === 'function') window.showPage = function () { const r = inner.apply(this, arguments); sync(); return r; };
    const sub = window.prSelectSubdomain;
    if (typeof sub === 'function') window.prSelectSubdomain = function () { const r = sub.apply(this, arguments); setOpen('nav-prices', 'prices-subitems', true); return r; };
    document.querySelectorAll('#go-tabs-nav .tab-btn').forEach(b => b.addEventListener('click', () => setTimeout(sync, 0)));
    // the phone menu is a drawer: measure the green path once it is visible
    const sb = $('sidebar');
    if (sb && window.ResizeObserver) new ResizeObserver(() => GROUPS.forEach(([, wid]) => { const w = $(wid); if (w) path(w); })).observe(sb);
    sync();
  }, 0));
})();
