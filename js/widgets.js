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
    ['today', 'Today'],
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
    ['intel', 'News & context'],
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
  // units for the value axes of charts drawn without one (checked over the whole catalogue: an axis never stays unnamed)
  const UNITS = { 'cb-fr-avg': { y: 'MW' }, 'load-day': { y: 'GW' }, 'go-indic': { y: '€/MWh' }, 'go-cal1': { y: '€/MWh' }, 'go-cal': { y: '€/MWh' },
    'go-spread': { y: '€/MWh' }, 'go-hist': { y: '€/MWh' }, 'go-wow': { y: '€/MWh' }, 'go-box': { y: '€/MWh' }, 'go-auct-vol': { y: 'MWh' },
    'cap-compare': { y: 'GW' }, 'fr-fwd-strip': { x: 'delivery period' } };
  function addUnits(id, canvasId) {
    const u = UNITS[id], c = u && document.getElementById(canvasId), ch = c && window.Chart && Chart.getChart(c); if (!ch) return;
    const sc = ch.config.options && ch.config.options.scales; if (!sc) return;
    let changed = false;
    Object.entries(u).forEach(([ax, text]) => { const a = sc[ax]; if (!a || (a.title && a.title.display && a.title.text)) return;
      const tc = (a.ticks && a.ticks.color) || '#7A93AB';
      a.title = { display: true, text, color: tc, font: { size: 11 } }; changed = true; });
    if (changed) try { ch.update('none'); } catch (_) {}
  }
  async function draw(id, canvasId, p) {
    const w = get(id);
    if (!w) return null;
    try {
      { const cv = document.getElementById(canvasId); if (cv) cv.dataset.pkw = id; }   // which widget a canvas shows (regulatory milestones, js/regulatory.js)
      const res = await w.draw(canvasId, params(id, p));
      addUnits(id, canvasId);
      if (w.pageCanvas === canvasId) markStar(w);
      else {   // the same chart drawn elsewhere on a page (France Morning…): a star too, with the settings it was drawn with
        const c = document.getElementById(canvasId);
        if (c && c.closest('.page') && !c.closest('#pkd-grid')) { const pp = params(id, p); markStar(Object.assign({}, w, { pageCanvas: canvasId, pageParams: () => pp })); }
      }
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

  // ── Mirror widgets ─────────────────────────────────────────────────
  // For page charts still drawn by their page's own code: the widget runs
  // that code (ensure), waits for the page chart, then copies its config
  // (data deep-copied; functions, plugins and callbacks kept by reference)
  // into the dashboard canvas. One drawing code, identical rendering.
  function cloneCfg(v) {
    if (Array.isArray(v)) return v.map(cloneCfg);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const o = {}; Object.keys(v).forEach(k => { o[k] = cloneCfg(v[k]); }); return o;
    }
    return v;   // primitives, functions, class instances (plugins, gradients)
  }
  const MIRRORS = [];
  function mirror(def) {
    MIRRORS.push(def);
    return register(Object.assign({}, def, {
      kind: 'chart',
      async draw(cid) {
        try { await def.ensure(); } catch (e) { console.warn('[PKW] mirror ensure', def.id, e); }
        const src = await waitFor(() => {
          const c = document.getElementById(def.pageCanvas), ch = c && window.Chart && Chart.getChart(c);
          return ch && ch.data && (ch.data.datasets || []).some(d => (d.data || []).length) ? ch : null;
        }, 25000);
        if (!src) { if (typeof noDataMsg === 'function') noDataMsg(cid, 'Chart not available yet', def.source || ''); return null; }
        const cfg = { type: src.config.type, data: cloneCfg(src.config.data), options: cloneCfg(src.config.options || {}),
                      plugins: (src.config.plugins || []).slice() };
        cfg.options.responsive = true; cfg.options.maintainAspectRatio = false;
        if (typeof mkChart === 'function') mkChart(cid, cfg); else new Chart(document.getElementById(cid), cfg);
        return { sub: def.subFn ? def.subFn() : '' };
      },
    }));
  }
  // Stars for mirrored charts appear once their page has drawn them.
  setInterval(() => {
    MIRRORS.forEach(def => {
      const c = document.getElementById(def.pageCanvas);
      if (c && window.Chart && Chart.getChart(c) && !(c.closest('.chart-container') || c.parentElement).querySelector('.pkw-star[data-wid="' + def.id + '"]')) markStar(get(def.id));
    });
  }, 3000);

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
        // pageParams: the page's current settings (zone, view…) go to the dashboard with the chart
        if (window.PKDash) window.PKDash.toggleWidget(w.id, typeof w.pageParams === 'function' ? w.pageParams() : undefined);
      });
      // Always in the top-right corner, next to the PNG and fullscreen tools.
      btn.classList.add('pkw-star-float');
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
      card.appendChild(btn);
    }
    refreshStars();
  }

  // ☆ on any page element (HTML widgets: tables, heatmaps) — elId is the element inside the card
  function star(id, elId) { const w = get(id); if (w) markStar(Object.assign({}, w, { pageCanvas: elId })); }

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

  window.PKW = { CATEGORIES, PERIOD_PARAM, register, get, list, params, draw, waitFor, mirror, periodButtons, refreshStars, star };
})();
