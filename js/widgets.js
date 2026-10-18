// ════════════════════════════════════════════════════════════════════
// widgets.js · window.PKW — the chart catalogue
// ────────────────────────────────────────────────────────────────────
// Every chart that can live on My Dashboard is registered here once, with
// its title, category, source and the function that draws it. The site
// pages and the dashboard call the same draw function, so a chart fixed
// on its page is fixed on every dashboard too.
//
//   PKW.register({
//     id: 'fuel-eua-ttf',            // stable id, saved in user layouts
//     title: 'EUA & TTF',
//     category: 'fuels',             // see PKW.CATEGORIES
//     source: 'SEFE',
//     desc: 'One-line description shown in the catalogue',
//     page: 'eua',                   // showPage() target for "open source page"
//     pageCanvas: 'fuel-eua-ttf',    // canvas on that page (gets the ☆ button)
//     size: { w: 6, h: 4 },          // default grid size (12 columns)
//     params: [{ key: 'period', label: 'Period', options: [['3m','3M'],['1y','1Y']] }],
//     defaults: { period: '1y' },
//     kind: 'chart',                 // 'chart' → draw(canvasId, p); 'html' → html(host, p)
//     async draw(canvasId, p) { … mkChart(canvasId, cfg); return { sub: 'optional subtitle' }; },
//   });
//
//   PKW.draw(id, canvasId, params)   // used by pages and by the dashboard
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const CATEGORIES = [
    ['kpi', 'Key figures'],
    ['prices', 'Day-ahead prices'],
    ['france', 'France'],
    ['renewables', 'Renewables'],
    ['system', 'Load & generation'],
    ['flows', 'Cross-border flows'],
    ['fuels', 'Fuels & carbon'],
    ['forwards', 'Forward curves'],
    ['spreads', 'Spreads & flexibility'],
    ['balancing', 'Balancing & outages'],
    ['weather', 'Weather'],
    ['go', 'Guarantees of origin'],
  ];

  // Period selector shared by the daily time-series charts (same keys as the pages' period buttons).
  const PERIOD_PARAM = { key: 'period', label: 'Period', options: [['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['YTD', 'YTD'], ['1Y', '1Y'], ['2Y', '2Y'], ['5Y', '5Y'], ['All', 'All']] };
  const REG = new Map();

  function register(def) {
    if (!def || !def.id) throw new Error('PKW.register: id required');
    const w = Object.assign({ kind: 'chart', size: { w: 6, h: 4 }, params: [], defaults: {} }, def);
    REG.set(w.id, w);
    return w;
  }

  function get(id) { return REG.get(id) || null; }
  function list() { return Array.from(REG.values()); }

  function params(id, p) {
    const w = get(id);
    return Object.assign({}, w ? w.defaults : {}, p || {});
  }

  // Draw a chart widget into an existing canvas (page or dashboard).
  async function draw(id, canvasId, p) {
    const w = get(id);
    if (!w) return null;
    try {
      const res = await w.draw(canvasId, params(id, p));
      if (w.pageCanvas === canvasId) markStar(w);
      return res || null;
    } catch (e) {
      console.warn('[PKW] draw failed', id, e);
      if (typeof noDataMsg === 'function') noDataMsg(canvasId, 'Chart unavailable', e.message || String(e));
      return null;
    }
  }

  // Resolves with fn()'s first truthy value, polled until timeout (→ null).
  // Lets a widget wait for data a page loader fills (pricesData, GO_REAL…).
  function waitFor(fn, timeout) {
    const limit = Date.now() + (timeout || 15000);
    return new Promise(res => {
      const tick = () => {
        let v = null;
        try { v = fn(); } catch (_) {}
        if (v) return res(v);
        if (Date.now() > limit) return res(null);
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  // Period buttons in a page chart's header (same look as the page filters).
  // options: [[value, label], …]; onPick(value) redraws.
  function periodButtons(canvasId, options, current, onPick) {
    const canvas = document.getElementById(canvasId);
    const head = canvas && (canvas.closest('.chart-container') || {}).querySelector && canvas.closest('.chart-container').querySelector('.fuel-card-head');
    if (!head) return;
    let g = head.querySelector('.pkw-period');
    if (!g) {
      g = document.createElement('div');
      g.className = 'pk-gf-group pkw-period';
      const star = head.querySelector('.pkw-star');
      head.insertBefore(g, star || null);
    }
    g.innerHTML = options.map(o => `<button type="button" class="pk-gf-btn${String(o[0]) === String(current) ? ' active' : ''}" data-v="${o[0]}">${o[1]}</button>`).join('');
    g.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      g.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      onPick(b.dataset.v);
    }));
  }

  // ── ☆ on page charts ─────────────────────────────────────────────
  // Added the first time a page draws a registered chart. PKDash answers
  // has()/toggleWidget().
  function markStar(w) {
    const canvas = document.getElementById(w.pageCanvas);
    if (!canvas) return;
    const card = canvas.closest('.chart-container') || canvas.parentElement;
    if (!card) return;
    if (!card.querySelector('.pkw-star[data-wid="' + w.id + '"]')) {
      const btn = document.createElement('button');
      btn.className = 'pkw-star';
      btn.dataset.wid = w.id;
      btn.type = 'button';
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        if (window.PKDash) window.PKDash.toggleWidget(w.id);
      });
      const head = card.querySelector('.fuel-card-head');
      if (head) head.appendChild(btn);
      else { btn.classList.add('pkw-star-float'); card.style.position = card.style.position || 'relative'; card.appendChild(btn); }
    }
    refreshStars();
  }

  function refreshStars() {
    const on = id => !!(window.PKDash && window.PKDash.has(id));
    document.querySelectorAll('.pkw-star').forEach(b => {
      const s = on(b.dataset.wid);
      b.classList.toggle('on', s);
      b.textContent = s ? '★' : '☆';
      b.title = s ? 'On My Dashboard · click to remove' : 'Add to My Dashboard';
      b.setAttribute('aria-pressed', s ? 'true' : 'false');
    });
  }

  window.PKW = { CATEGORIES, PERIOD_PARAM, register, get, list, params, draw, waitFor, periodButtons, refreshStars };
})();
