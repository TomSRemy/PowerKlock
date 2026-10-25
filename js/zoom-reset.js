// ════════════════════════════════════════════════════════════════════
// Zoom reset, everywhere: a chart zoomed by a drag or a pinch shows a
// "↺ Reset zoom" button on its corner, and a double-click on it goes back
// to the full view. Pages, dashboards, shared dashboards and embedded
// charts (API) alike: some places had no way back.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.Chart || !Chart.register) return;
  function sync(ch) {
    const c = ch.canvas, host = c && c.parentElement; if (!host) return;
    const zoomed = typeof ch.isZoomedOrPanned === 'function' && ch.isZoomedOrPanned();
    let b = host.querySelector(':scope > .pk-zoom-reset');
    if (!zoomed) { if (b) b.remove(); return; }
    // top-left corner of the plot area: clear of the axes, the legend and the chart's own buttons (top right)
    const place = x => { const a = ch.chartArea; if (!a) return; x.style.left = Math.round(a.left + 8) + 'px'; x.style.top = Math.round(a.top + 6) + 'px'; };
    if (b) { place(b); return; }
    const fr = !window.PKI18n || PKI18n.lang !== 'en';
    b = document.createElement('button'); b.type = 'button'; b.className = 'pk-zoom-reset'; b.textContent = fr ? '↺ Annuler le zoom' : '↺ Reset zoom'; b.title = fr ? 'Revenir à la vue complète (ou double-clic sur le graphique)' : 'Back to the full view (or double-click the chart)';
    place(b);
    b.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); try { ch.resetZoom(); } catch (_) {} });
    ['pointerdown', 'mousedown', 'touchstart'].forEach(ev => b.addEventListener(ev, e => e.stopPropagation()));   // never starts a dashboard drag
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(b);
  }
  Chart.register({
    id: 'pkZoomReset',
    afterDraw(ch) { try { sync(ch); } catch (_) {} },
    afterInit(ch) {
      const c = ch.canvas; if (!c || c.dataset.pkDbl) return; c.dataset.pkDbl = '1';
      c.addEventListener('dblclick', () => { const x = Chart.getChart(c); if (x && typeof x.resetZoom === 'function' && x.isZoomedOrPanned && x.isZoomedOrPanned()) x.resetZoom(); });
    },
  });
})();
