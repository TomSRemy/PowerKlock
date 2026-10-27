// ════════════════════════════════════════════════════════════════════
// PAGE VIEWS — the Prices › Day-Ahead model everywhere: the sticky bar
// carries view tabs (Daily / Historical / …) and only the sections of the
// chosen view are shown, instead of every section stacked on the page.
// Each entry: page id (or "page:subdomain") → [[tab label, [section ids], group?]]. Tabs of the same group
// sit under one tab, as a row of sub-tabs (the PPA pricer's methods).
// The last view chosen on a page is kept for the browser session.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const VIEWS = {
    morning: [['Quick look', ['mrn-quick']], ['Discovery', ['mrn-learn']], ['Expert', ['mrn2', 'hs-morning-2', 'hs-morning-fund', 'hs-morning-3', 'hs-morning-4', 'hs-morning-fc', 'hs-morning-idx']]],
    'prices:forward': [['Board', ['hs-prfwd-read', 'hs-prfwd-board']], ['Comparison', ['hs-prfwd-compare']], ['Calendar contracts', ['hs-cal-contracts']]],
    'prices:spread': [['Intraday spread', ['hs-spread-history']], ['Battery spreads', ['hs-spread-bess']]],
    renewables: [['Daily', ['hs-renewables-0']], ['Historical', ['hs-renewables-1']], ['M0', ['hs-renewables-2']], ['Cannibalisation', ['hs-renewables-cannib']], ['Forward capture', ['hs-renewables-capfwd']]],
    nuclear: [['Availability', ['hs-nuclear-0', 'hs-nuclear-u']], ['Outages', ['hs-nuclear-1']]],
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
    remit: [['Outages', ['hs-remit-u']], ['Platforms', ['hs-remit-1']]],
    status: [['Sources', ['hs-status-0']], ['Feed problems', ['hs-status-1']]],
    // the PPA pricer: inputs and the price, the park, one tab per method (grouped under Methods), the comparison
    ppapricer: [['Inputs & price', ['hs-pp-in', 'hs-pp-sum']], ['The park', ['hs-pp-park']],
      ['Past discount', ['hs-pp-price', 'hs-pp-pctrisk'], 'Methods'], ['Capacity trend', ['hs-pp-price', 'hs-pp-mkt', 'hs-pp-mc', 'hs-pp-pctrisk'], 'Methods'],
      ['Forward shape', ['hs-pp-price', 'hs-pp-fpc'], 'Methods'], ['Weather simulation', ['hs-pp-price', 'hs-pp-wx'], 'Methods'],
      ['Short-term (monthly)', ['hs-pp-st'], 'Methods'], ['M0-indexed (complément)', ['hs-pp-cr'], 'Methods'], ['Methodology', ['hs-pp-doc'], 'Methods'],
      ['Compare & price', ['hs-pp-cmp', 'hs-pp-roll']]],
    bess: [['Index', ['hs-bess-idx']], ['Europe', ['hs-bess-eu']], ['Day-ahead value', ['hs-bess-da', 'hs-bess-years']], ['Reserves', ['hs-bess-res']], ['Revenue streams', ['hs-bess-streams']], ['Capacity mechanism', ['hs-bess-cm']], ['Method', ['hs-bess-method']]],
    boa: [['Inputs & result', ['hs-bess-boa-in']], ['The battery', ['hs-bess-boa-batt']], ['Contract structures', ['hs-bess-boa-out']]],
    fcst: [['Site & forecast', ['hs-fc-in', 'hs-fc-out']], ['Price this park', ['hs-fc-price']], ['How good is it', ['hs-fc-bt']]],
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
    const subnav = document.createElement('div'); subnav.className = 'tabs-nav pk-views pk-subviews'; subnav.setAttribute('role', 'tablist');
    const top = [], groups = {};   // top-level buttons: a plain tab, or the first tab of a group standing for the group
    present.forEach(([label, , group], i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tab-btn'; b.textContent = label; b.setAttribute('role', 'tab');
      b.addEventListener('click', () => show(i));
      if (!group) { nav.appendChild(b); top.push({ b, idx: [i] }); return; }
      subnav.appendChild(b);
      if (!groups[group]) {
        const g = document.createElement('button');
        g.type = 'button'; g.className = 'tab-btn'; g.textContent = group; g.setAttribute('role', 'tab');
        groups[group] = { b: g, idx: [], last: i };
        g.addEventListener('click', () => show(groups[group].last));
        nav.appendChild(g); top.push(groups[group]);
      }
      groups[group].idx.push(i); b.dataset.sub = '1';
    });
    crumb.after(sep); sep.after(nav);
    if (subnav.children.length) { bar.after(subnav); subnav.hidden = true; }
    const subs = [...subnav.children];
    function show(i) {
      const on = new Set(present[i][1]);
      present.forEach(([, ids]) => ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = on.has(id) ? '' : 'none'; }));
      // a page can follow the view (the PPA pricer prices with the method of the tab)
      root.dispatchEvent(new CustomEvent('pk-view', { bubbles: true, detail: { key, label: present[i][0], index: i } }));
      top.forEach(t => { const a = t.idx.includes(i); t.b.classList.toggle('active', a); t.b.setAttribute('aria-selected', a ? 'true' : 'false'); });
      const g = present[i][2];
      if (g) groups[g].last = i;
      subnav.hidden = !g;
      subs.forEach(b => { const a = b.textContent === present[i][0] || (window.pkEN && pkEN(b.textContent) === present[i][0]); b.classList.toggle('active', a); b.setAttribute('aria-selected', a ? 'true' : 'false'); });
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
