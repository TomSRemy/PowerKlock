// ════════════════════════════════════════════════════════════════════
// GUARANTEES OF ORIGIN — the menu (js/nav-v2.js) opens one of the two views of the GO page
// (EU prices, France auctions). The groups of the previous menu that this file folded and unfolded
// are gone with it.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  window.pkGoTab = function (tab) {
    if (typeof window.showPage === 'function') window.showPage('goprices');
    const b = document.querySelector('#go-tabs-nav .tab-btn[data-tab="' + tab + '"]');
    if (b && !b.classList.contains('active')) b.click();
  };
})();
