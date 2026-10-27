// ════════════════════════════════════════════════════════════════════
// PAGE VIEWS — the Prices › Day-Ahead model everywhere: the sticky bar
// carries view tabs (Daily / Historical / …) and only the sections of the
// chosen view are shown, instead of every section stacked on the page.
// Each entry: page id (or "page:subdomain") → [[tab label, [section ids]]].
// The last view chosen on a page is kept for the browser session.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const VIEWS = {
    morning: [['Quick look', ['mrn-quick']], ['Discovery', ['mrn-learn']], ['Expert', ['mrn2', 'hs-morning-2', 'hs-morning-fund', 'hs-morning-3', 'hs-morning-4', 'hs-morning-fc', 'hs-morning-idx']]],
    'prices:forward': [['Board', ['hs-prfwd-read', 'hs-prfwd-board']], ['Comparison', ['hs-prfwd-compare']], ['Calendar contracts', ['hs-cal-contracts']]],
    'prices:spread': [['Intraday spread', ['hs-spread-history']], ['Battery spreads', ['hs-spread-bess']]],
    renewables: [['Daily', ['hs-renewables-0']], ['Historical', ['hs-renewables-1']], ['M0', ['hs-renewables-2']], ['Cannibalisation', ['hs-renewables-cannib']], ['Forward capture', ['hs-renewables-capfwd']]],
    nuclear: [['Availability', ['hs-nuclear-0']], ['Outages', ['hs-nuclear-1']]],
    capacity: [['By year', ['hs-capacity-0']], ['Comparison', ['hs-capacity-1']]],
    frsystem: [['Daily', ['hs-frsystem-0']], ['Historical', ['hs-frsystem-1']]],
    regions: [['Daily', ['hs-regions-0']], ['Capacity & consumption', ['hs-regions-1']]],
    crossborder: [['Daily', ['hs-crossborder-0']], ['Borders', ['hs-crossborder-1']]],
    imbalance: [['Daily', ['hs-imbalance-0']], ['Deviations', ['hs-imbalance-1']]],
    eua: [['Overview', ['hs-eua-0']], ['Gas', ['hs-eua-1']], ['Coal & oil', ['hs-eua-2']]],
    euafwd: [['Curves', ['hs-euafwd-0']], ['TTF forwards', ['hs-euafwd-ttf']], ['Settlements', ['hs-euafwd-1']]],
    spark: [['Daily', ['hs-spark-0']], ['Historical', ['hs-spark-1']]],
    wxcities: [['Daily', ['hs-wxcities-0', 'hs-wxcities-1']], ['5-week outlook', ['hs-wxcities-outlook']], ['Hydro reservoirs', ['hs-wxcities-hydro']]],
    wxhdd: [['Daily', ['hs-wxhdd-0']], ['Weekly', ['hs-wxhdd-1']]],
    remit: [['Overview', ['hs-remit-0']], ['Unit messages', ['hs-remit-1']]],
    status: [['Sources', ['hs-status-0']], ['Feed problems', ['hs-status-1']]],
    ppapricer: [['Compare', ['hs-pp-cmp']], ['Short-term (monthly)', ['hs-pp-st']], ['M0-indexed (complément)', ['hs-pp-cr']], ['Past discount', ['hs-pp-price', 'hs-pp-pctrisk']], ['Capacity trend', ['hs-pp-price', 'hs-pp-mkt', 'hs-pp-mc', 'hs-pp-pctrisk']], ['Forward shape', ['hs-pp-price', 'hs-pp-fpc']], ['Weather simulation', ['hs-pp-price', 'hs-pp-wx']], ['Market context', ['hs-pp-roll']], ['Methodology', ['hs-pp-doc']]],
    bess: [['Day-ahead value', ['hs-bess-da', 'hs-bess-years']], ['Revenue streams', ['hs-bess-streams']], ['Capacity mechanism', ['hs-bess-cm']], ['BOA pricer', ['hs-bess-boa-in', 'hs-bess-boa-out']], ['Method', ['hs-bess-method']]],
    carbonfoot: [['Your data', ['hs-cf-input']], ['Overview', ['hs-cf-ov']], ['Consumption', ['hs-cf-cons']], ['Carbon', ['hs-cf-carbon']], ['Cost & flexibility', ['hs-cf-cost']], ['Solar & coverage', ['hs-cf-solar']], ['Reporting', ['hs-cf-report']]],
  };
  const KEY = 'pk-view-';

  function setup(key, def) {
    const [pid, sub] = key.split(':');
    const root = sub ? document.querySelector(`#page-${pid} [data-subdomain-panel="${sub}"]`) : document.getElementById('page-' + pid);
    if (!root) return;
    const bar = root.querySelector('.pr-tabs-bar');
    const crumb = bar && bar.querySelector('.pr-breadcrumb');
    if (!crumb || bar.querySelector('.pk-views')) return;
    const present = def.filter(([, ids]) => ids.some(id => document.getElementById(id)));
    if (present.length < 2) return;
    const sep = document.createElement('div'); sep.className = 'pr-tabs-separator';
    const nav = document.createElement('div'); nav.className = 'tabs-nav pk-views'; nav.setAttribute('role', 'tablist');
    present.forEach(([label], i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tab-btn'; b.textContent = label; b.setAttribute('role', 'tab');
      b.addEventListener('click', () => show(i));
      nav.appendChild(b);
    });
    crumb.after(sep); sep.after(nav);
    function show(i) {
      const on = new Set(present[i][1]);
      present.forEach(([, ids]) => ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = on.has(id) ? '' : 'none'; }));
      // a page can follow the view (the PPA pricer prices with the method of the tab)
      root.dispatchEvent(new CustomEvent('pk-view', { bubbles: true, detail: { key, label: present[i][0], index: i } }));
      nav.querySelectorAll('.tab-btn').forEach((b, k) => { b.classList.toggle('active', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
      try { sessionStorage.setItem(KEY + key, String(i)); } catch (_) {}
      // charts drawn while hidden have no size: resize them once visible
      requestAnimationFrame(() => present[i][1].forEach(id => {
        const el = document.getElementById(id);
        if (el && window.Chart) el.querySelectorAll('canvas').forEach(c => { const ch = Chart.getChart(c); if (ch) ch.resize(); });
      }));
    }
    let start = 0;
    try { start = +(sessionStorage.getItem(KEY + key) || 0); } catch (_) {}
    show(Math.min(Math.max(0, start), present.length - 1));
  }

  window.addEventListener('load', () => setTimeout(() => Object.entries(VIEWS).forEach(([k, d]) => setup(k, d)), 0));
})();
