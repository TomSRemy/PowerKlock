// ════════════════════════════════════════════════════════════════════
// Charts side by side start at the same height. Two cards in one row often
// have subtitles of different lengths (1, 2 or 3 lines): the chart under
// the shorter one would start higher. Each card's chart is pushed down to
// the lowest start of its row. Recomputed when the page changes or resizes.
// Not inside dashboards (their grid sets the card heights).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const vis = e => e.offsetParent !== null && e.getBoundingClientRect().width > 0;
  function wrapOf(card) {   // the block holding the card's first chart, a child of the card
    const cv = [...card.querySelectorAll('canvas')].find(vis); if (!cv) return null;
    let w = cv; while (w.parentElement && w.parentElement !== card) w = w.parentElement;
    return w.parentElement === card ? w : null;
  }
  function align() { for (let k = 0; k < 3; k++) if (!pass(k === 0)) break; }   // a few passes: lining up one row can move the next
  function pass(reset) {
    const page = document.querySelector('.page.active') || document; if (!page) return;
    const cards = [...page.querySelectorAll('.chart-container')].filter(c => vis(c) && !c.parentElement.closest('.chart-container') && !c.closest('.grid-stack, .pk-fs, .mrn-3d'));
    if (reset) cards.forEach(c => { const w = c._pkAlignW; if (w) w.style.marginTop = w.dataset.pkMt || ''; });
    let moved = false;
    const rows = [];
    cards.forEach(c => { const w = wrapOf(c); if (!w) return; if (w.dataset.pkMt == null) w.dataset.pkMt = w.style.marginTop || ''; c._pkAlignW = w;
      const r = c.getBoundingClientRect(), off = w.getBoundingClientRect().top - r.top;
      let row = rows.find(g => Math.abs(g.top - r.top) < 4 && g.cards[0][0].parentElement.closest('.hist-section-body, .page') === c.parentElement.closest('.hist-section-body, .page'));
      if (!row) rows.push(row = { top: r.top, cards: [] }); row.cards.push([c, w, off, r.width]); });
    rows.forEach(g => { if (g.cards.length < 2) return; if (g.cards.reduce((a, x) => a + x[3], 0) > innerWidth) return;   // cards stacked on a phone: nothing to line up
      const mx = Math.max(...g.cards.map(x => x[2]));
      g.cards.forEach(([, w, off]) => { if (mx - off > 1 && mx - off < 140) { w.style.marginTop = (parseFloat(getComputedStyle(w).marginTop) || 0) + (mx - off) + 'px'; moved = true; } }); });
    return moved;
  }
  let t = null; const later = () => { clearTimeout(t); t = setTimeout(align, 250); };
  window.addEventListener('resize', later);
  window.addEventListener('load', () => {
    later();
    const main = document.querySelector('main.main') || document.body;
    new MutationObserver(ms => { if (ms.some(m => !(m.target.closest && m.target.closest('.chart-container canvas, .pk-tooltip, .chartjs-tooltip')))) later(); })
      .observe(main, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  });
  window.PKAlign = align;
})();
