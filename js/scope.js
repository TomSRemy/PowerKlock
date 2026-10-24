// ════════════════════════════════════════════════════════════════════
// SITE SCOPE — "All" (Europe) or "France".
// The France tab no longer opens a separate dashboard: it switches the
// whole site to a French preset, remembered per browser.
//   · landing page: France Morning;
//   · every page opens on France: zone / country selectors set to FR the
//     first time the page is shown (a selector the user changes is left
//     alone afterwards); zone filters of boards and tables (day-ahead,
//     negative prices, generation mix, news, ticker) on France only;
//     comparison views keep France and its neighbours;
//   · menu: French pages first, pages without French data hidden;
//   · a "France" pill in the top bar to go back to All.
// The previous France dashboard stays reachable from France Morning
// (PKScope.openLegacy) until it is retired.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const KEY = 'pk-scope';
  const FR_ZONES = ['FR', 'DE_LU', 'BE', 'NL', 'CH', 'IT_NORD', 'ES'];   // France and its coupled neighbours
  const ls = { get() { try { return localStorage.getItem(KEY); } catch (_) { return null; } }, set(v) { try { localStorage.setItem(KEY, v); } catch (_) {} } };
  let scope = ls.get() === 'FR' ? 'FR' : 'all';
  let preset = new Set();          // pages whose selectors were set for this activation
  const userSet = new WeakSet();   // selectors the user changed by hand
  let legacy = false;

  document.addEventListener('change', e => { if (e.isTrusted && e.target && e.target.tagName === 'SELECT') userSet.add(e.target); }, true);

  function tabs(name) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.dash === name));
  }
  function pill() {
    let p = document.getElementById('pk-scope-pill');
    if (scope !== 'FR' || document.getElementById('pk-zone')) { if (p) p.remove(); return; }
    if (!p) {
      p = document.createElement('button');
      p.id = 'pk-scope-pill'; p.type = 'button'; p.className = 'pk-scope-pill';
      p.title = 'France view: pages open on France. Click to show all of Europe.';
      p.innerHTML = '🇫🇷 France <span aria-hidden="true">×</span>';
      p.addEventListener('click', () => window.switchDashboard('all'));
      const anchor = document.getElementById('pk-status-badge');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor); else document.body.appendChild(p);
    }
  }
  function applyChrome() {
    document.body.classList.toggle('pk-scope-fr', scope === 'FR');
    pill();
  }
  function priceZones() {
    if (typeof setUserZones !== 'function') return;
    if (scope === 'FR') setUserZones(FR_ZONES);
    else setUserZones(window.PK_DEFAULT_PRICE_ZONES || ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'PT', 'IT_NORD']);
  }
  // Set the page's zone / country selectors to France (retried while options load).
  function presetPage(id) {
    if (scope !== 'FR' || preset.has(id)) return;
    preset.add(id);
    const run = () => {
      const page = document.getElementById('page-' + id); if (!page) return;
      page.querySelectorAll('select').forEach(sel => {
        if (userSet.has(sel)) return;
        const opt = Array.from(sel.options).find(o => o.value === 'FR' || o.value === 'fr');
        if (!opt || sel.value === opt.value) return;
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    [60, 900, 2500].forEach(t => setTimeout(run, t));
  }
  // Multi-zone filters that are not comparisons: France only in the France
  // view, back to their defaults in All. Comparison views (cross-zone
  // analysis, daily compare, multi-zone history) use the user zone set:
  // France and its neighbours. Each step is retried while the module loads.
  const FILTERS = {
    prices() {   // day-ahead board table and its key figures
      if (!window._pricesSorted || typeof applyZoneFilter !== 'function') return false;
      window._pricesZoneFilter = scope === 'FR' ? new Set(['FR']) : null; applyZoneFilter(); return true;
    },
    negatives() { if (typeof window.negSetZones !== 'function') return false; window.negSetZones(scope === 'FR' ? ['FR'] : null); return true; },
    genmix() {
      let ok = false;
      if (typeof window.gmApplyZoneFilter === 'function' && (window._gmBoardData || window._genmixData)) { window.gmApplyZoneFilter(scope === 'FR' ? new Set(['FR']) : null); ok = true; }
      if (typeof window.gmhApplyZoneFilter === 'function' && (window._gmhAllZones || []).length) { window.gmhApplyZoneFilter(scope === 'FR' ? new Set(['FR']) : null); ok = true; }
      return ok;
    },
    news() {
      if (typeof filterNews !== 'function') return false;
      const btn = Array.from(document.querySelectorAll('#page-news .filter-btn')).find(b => scope === 'FR' ? /France/.test(b.textContent) : /^All$/.test(b.textContent.trim()));
      if (!btn) return false; btn.click(); return true;
    },
    compare() { if (typeof setUserZones !== 'function') return false; priceZones(); return true; },
    ticker() {
      try {
        if (typeof renderTicker !== 'function') return false;
        tickerZoneFilter = scope === 'FR' ? new Set(['FR']) : null;   // ticker.js global
        renderTicker();
        if (typeof buildTickerZoneList === 'function' && typeof pricesData !== 'undefined' && pricesData) buildTickerZoneList(pricesData);
        return true;
      } catch (_) { return false; }
    },
  };
  const PAGE_FILTERS = { prices: ['prices', 'negatives', 'compare'], genmix: ['genmix'], news: ['news'] };
  function runFilter(name) {
    let n = 0;
    const tick = () => { let ok = false; try { ok = FILTERS[name](); } catch (e) { ok = false; } if (!ok && ++n < 12) setTimeout(tick, 700); };
    tick();
  }
  function runFiltersFor(id) { (PAGE_FILTERS[id] || []).forEach(runFilter); }

  function setScope(s) {
    scope = s; ls.set(s); preset = new Set();
    applyChrome(); priceZones();
    Object.keys(FILTERS).forEach(runFilter);
  }

  window.PKScope = {
    get: () => scope,
    zones: () => scope === 'FR' ? FR_ZONES.slice() : null,
    openLegacy() { legacy = true; origSwitch('france'); },
    // zone choice of the top bar (js/nav-v2.js): switch the scope, stay on the page
    set(s) {
      setScope(s === 'FR' ? 'FR' : 'all');
      const p = document.querySelector('.page.active'), id = p ? p.id.replace('page-', '') : null;
      if (id && scope === 'FR') { presetPage(id); preset.add('f:' + id); runFiltersFor(id); }
    },
  };

  // ── hook into the existing navigation (after news.js has wrapped showPage) ──
  let origSwitch = null;
  window.addEventListener('load', () => setTimeout(() => {
    origSwitch = window.switchDashboard;
    window.switchDashboard = function (tab, btn) {
      if (tab === 'france') { setScope('FR'); legacy = false; window.showPage('morning'); return; }
      if (tab === 'all') { setScope('all'); return origSwitch('all', btn); }
      return origSwitch(tab, btn);
    };
    if (typeof window.prSelectSubdomain === 'function') {
      const innerSub = window.prSelectSubdomain;
      window.prSelectSubdomain = function (d) { const r = innerSub.apply(this, arguments); if (scope === 'FR') runFiltersFor('prices'); return r; };
    }
    const innerShow = window.showPage;
    window.showPage = function (id) {
      innerShow(id);
      if (scope === 'FR') { tabs('france'); presetPage(id); if (!preset.has('f:' + id)) { preset.add('f:' + id); runFiltersFor(id); } }
    };
    applyChrome();
    if (scope === 'FR') { priceZones(); runFilter('ticker'); if (!window.PKNav) window.showPage('morning'); }
  }, 0));

  const css = document.createElement('style');
  css.textContent = `
  .pk-scope-pill{display:inline-flex;align-items:center;gap:6px;margin-right:8px;padding:4px 10px;border-radius:999px;border:1px solid rgba(20,211,169,.45);background:rgba(20,211,169,.10);color:#14D3A9;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
  .pk-scope-pill span{opacity:.7;font-size:13px;line-height:1}
  .pk-scope-pill:hover{background:rgba(20,211,169,.18)}
  body.pk-scope-fr #sec-power-items{display:flex;flex-direction:column}
  body.pk-scope-fr #nav-morning{order:-4} body.pk-scope-fr #nav-frsystem{order:-3} body.pk-scope-fr #nav-regions{order:-2}
  body.pk-scope-fr #nav-imbalance{display:none}
  /* Board key figures about other countries: hidden in the France view (the
     comparison sections below keep them) */
  body.pk-scope-fr #kpicard-de, body.pk-scope-fr #kpicard-avg, body.pk-scope-fr #kpicard-max, body.pk-scope-fr #kpicard-min{display:none}
  body.pk-scope-fr .neg-kpi-other{display:none}
  /* Top bar: keep the centred tabs clear of the right-hand badges */
  @media (max-width:1700px){.topbar-right{gap:10px}.pk-status-badge .pk-status-txt{display:none}.pk-status-badge::after{content:attr(data-short)}}
  @media (max-width:1500px) and (min-width:761px){.topbar-right .clock{display:none}}
  @media (max-width:760px){.pk-scope-pill{padding:3px 8px;font-size:10px;margin-right:4px}}
  `;
  document.head.appendChild(css);
})();
