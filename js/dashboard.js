// ════════════════════════════════════════════════════════════════════
// dashboard.js · window.PKDash — My Dashboard
// ────────────────────────────────────────────────────────────────────
// Several named dashboards per user. Each one is a 12-column grid
// (GridStack) holding three kinds of items:
//   widget  — a chart or key figure from the PKW catalogue, with its own
//             title and parameters (zone, period…)
//   section — a full-width heading
//   note    — free text
// Layouts are saved in the browser, and in the user's account when signed
// in (PKAccount). Charts draw lazily when they scroll into view.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const LS_KEY = 'pk-dash-v2';
  const LS_OLD = 'pk-mydash-widgets';
  // a fine grid (since 25 Oct. 2026): 24 columns and half-height rows, so a card can be sized twice as precisely.
  // Templates, widget sizes and older saved dashboards are in the coarse 12-column units: fine() doubles them once.
  const COLS = 24, CELL_H = 32, FINE = 2;
  // GridStack 10 ships the CSS for 12 columns only: the 24-column widths and offsets, written once
  (function () {
    if (document.getElementById('pkd-gs24')) return;
    let css = '.gs-24>.grid-stack-item{width:4.1667%}';
    for (let i = 1; i <= 24; i++) css += `.gs-24>.grid-stack-item[gs-w="${i}"]{width:${(i / 24 * 100).toFixed(4)}%}` + (i < 24 ? `.gs-24>.grid-stack-item[gs-x="${i}"]{left:${(i / 24 * 100).toFixed(4)}%}` : '');
    const st = document.createElement('style'); st.id = 'pkd-gs24'; st.textContent = css; document.head.appendChild(st);
  })();
  const fine = b => { if (!b || b.grid === FINE) return b; (b.items || []).forEach(it => ['x', 'y', 'w', 'h'].forEach(k => { if (it[k] != null) it[k] *= FINE; })); b.grid = FINE; return b; };
  const GS_JS = 'js/vendor/gridstack-all.min.js';
  const GS_CSS = 'js/vendor/gridstack.min.css';

  // ── Templates ────────────────────────────────────────────────────
  // Items reference catalogue ids; ids not (yet) registered are skipped.
  const S = (title) => ({ t: 's', title, w: 12, h: 1 });
  const W = (wid, w, h, p) => ({ t: 'w', wid, w, h, p });
  const TEMPLATES = [
    // The three Today views (js/today-widgets.js), same blocks and order as the Today page
    { id: 'today-quick', name: 'Today · Quick look', desc: 'One screen: France spot today and tomorrow, what moved, the six key prices.', items: [
      W('today-spot', 7, 5), W('today-moved', 5, 5),
      W('today-tiles', 12, 3),
    ] },
    { id: 'today-learn', name: 'Today · Discovery', desc: 'Few figures, each explained: the day in one sentence, three prices and what they are, today hour by hour, what it means, a glossary.', items: [
      W('today-sentence', 12, 2),
      W('today-tiles-explained', 12, 4),
      W('today-hours', 6, 6), W('today-means', 6, 6),
      W('today-glossary', 12, 3),
    ] },
    { id: 'today-expert', mirror: 'today-expert', name: 'Today · Expert', desc: "The French power market this morning, as on the Expert view of Today. At the top: the key prices (power, gas, CO₂, oil, guarantees of origin, PowerKlock index), the spot of yesterday, today and tomorrow, the next 4 weeks, what moved and why, and the news. Below, one section per subject: Markets (spot, power and gas forwards, Cal+1 drivers), Fundamentals (demand, low-carbon supply, gas cost), Renewables (capture rates, guarantees of origin), Power system (production, nuclear outages, consumption), Detailed forecasts (the grid operator's) and, folded at the end, PowerKlock · calculations (the index and our own forecasts).", items: [
      W('today-tiles', 12, 3),
      W('fr-spot-day', 4, 7, { zone: 'FR', day: 'yesterday' }), W('fr-spot-day', 4, 7, { zone: 'FR', day: 'today' }), W('fr-spot-day', 4, 7, { zone: 'FR', day: 'tomorrow' }),
      W('today-weeks', 12, 4),
      W('today-brief', 12, 8), W('today-news', 12, 6),
      S('Markets'),
      W('fr-spot-monthly', 6, 5, { zone: 'FR' }), W('fr-spot-30d', 6, 5),
      W('fr-cal-history', 6, 5, { country: 'FR', win: '3M', kinds: 'year,quarter,month', front: 1 }), W('power-fwd-table', 6, 5, { country: 'FR', seasons: 'no' }),
      W('ttf-cal-history', 6, 5, { win: '3M', kinds: 'year,quarter,month', front: 1 }), W('ttf-fwd-table', 6, 5, { seasons: 'no' }),
      W('fr-cal-drivers', 12, 5, { win: '6M', country: 'FR' }),
      S('Weather, demand and nuclear'),
      W('today-fund', 12, 7),
      W('wx-outlook', 6, 5, { series: 'temp' }), W('fr-load-normal', 6, 5),
      W('nuc-monthly-years', 6, 5), W('remit-unavail', 6, 5, { period: '6M' }),
      W('wx-outlook', 6, 5, { series: 'wind' }), W('wx-outlook', 6, 5, { series: 'solar' }),
      W('hydro-reservoirs', 6, 5, { country: 'FR' }), W('wx-outlook', 6, 5, { series: 'precip' }),
      W('gas-storage-years', 6, 5), W('fuel-coal-oil', 6, 5),
      S('Renewables'),
      W('today-rtiles', 12, 3),
      W('cannib-rolling', 6, 5, { tech: 'solar' }), W('ren-capture-regions', 6, 5, { tech: 'solar' }),
      W('cannib-rolling', 6, 5, { tech: 'wind' }), W('ren-capture-regions', 6, 5, { tech: 'wind' }),
      W('go-vintages', 6, 5, { product: 'GO AIB Renewable' }), W('today-gotable', 6, 5),
      S('Power system'),
      W('today-system', 12, 3),
      W('fr-sys-prod', 6, 5, { day: 'latest' }), W('fr-sys-monthly', 6, 5, { view: 'twh', win: '3Y' }),
      W('remit-unavail', 6, 5, { period: '3M' }), W('fr-load-normal', 6, 5),
      S('Detailed forecasts'),
      W('fc-tomorrow', 12, 2, { zone: 'FR' }),
      W('fc-48h', 6, 5, { zone: 'FR' }), W('fc-neg', 6, 5),
      W('fc-combined', 6, 5, { tech: 'wind' }), W('fc-combined', 6, 5, { tech: 'solar' }),
    ] },
    // Business dashboards (agreed 2026-10-25): operations, origination + support scheme, hedging, negative prices,
    // winter, monthly review, Europe, the internal market presentation
    { id: 'ops', name: 'Aggregator operations · today and tomorrow', desc: 'How much the parks will produce, at what price, with what imbalance risk: spot and negative-price chance, production forecasts, imbalance and activation prices.', items: [
      S('Today and tomorrow'),
      W('today-spot', 12, 5, { detail: 'yes' }),
      W('fc-neg', 6, 5), W('fc-48h', 6, 5, { zone: 'FR' }),
      S('Production forecasts'),
      W('fc-combined', 6, 5, { tech: 'solar' }), W('fc-combined', 6, 5, { tech: 'wind' }),
      W('fc-tomorrow', 6, 2, { zone: 'FR' }), W('today-system', 6, 2),
      W('ren-fc', 12, 5),
      S('Imbalance'),
      W('fr-imb-price', 6, 5, { view: 'day' }), W('fr-imb-price', 6, 5, { view: '30d' }),
      W('imb-park', 6, 5), W('fr-activation', 6, 5, { win: '90' }),
    ] },
    { id: 'orig', name: 'Origination and support scheme · France', desc: 'PPA price recalculated every day, forwards and forward capture, capture rates by technology and region, hours at 0 € or below, M0 and CRE tenders, guarantees of origin.', items: [
      S('PPA price'),
      W('ppa-today', 6, 3), W('kpi-da', 3, 3, { zone: 'FR' }), W('kpi-go', 3, 3),
      W('ppa-benchmark', 6, 5, { tech: 'both', win: '6M' }), W('pf-curve', 6, 5, { country: 'FR' }),
      W('ppa-bridge', 6, 5, { tech: 'solar', win: '30' }), W('ppa-bridge', 6, 5, { tech: 'wind', win: '30' }),
      W('fr-capture-forward', 6, 5), W('fr-capture-forward-table', 6, 5),
      S('Value of solar and wind'),
      W('ren-cr', 6, 5, { zone: 'FR', window: '1Y' }), W('ren-capture-regions', 6, 5, { tech: 'solar' }),
      W('neg-cost', 6, 6), W('fr-reg-lf', 6, 6),
      S('Support scheme · M0'),
      W('fr-m0-official', 12, 6), W('fr-m0-forecast', 12, 6),
      W('cre-tenders', 6, 5), W('cspe-enr', 6, 5),
      S('Guarantees of origin'),
      W('go-vintages', 12, 5, { product: 'GO AIB Renewable' }),
    ] },
    { id: 'hedge', name: 'Hedging and risk · weekly', desc: 'Whether to fix now: Cal+1 and its drivers, every contract (years, quarters, months, seasons), gas, carbon, nuclear and the weather ahead, and the PPA benchmark.', items: [
      S('Cal+1'),
      W('fr-fwd-read', 12, 4), W('fr-cal-drivers', 6, 5, { country: 'FR', win: '6M' }), W('ppa-benchmark', 6, 5, { tech: 'both', win: '1Y' }),
      S('Contracts'),
      W('pf-cals', 6, 5, { country: 'FR', win: '1Y' }), W('pf-contracts', 6, 5, { country: 'FR', kind: 'quarter', win: '1Y' }),
      W('pf-contracts', 6, 5, { country: 'FR', kind: 'month', win: '6M' }), W('pf-contracts', 6, 5, { country: 'FR', kind: 'season', win: '1Y' }),
      W('fr-fwd-strip', 12, 5, { country: 'FR' }),
      S('Drivers'),
      W('fuel-eua-ttf', 6, 5), W('gas-storage-years', 6, 5),
      W('nuc-season', 6, 5), W('wx-outlook', 6, 5, { series: 'temp' }),
    ] },
    { id: 'negflex', name: 'Negative prices and flexibility', desc: 'When the price goes to zero or below, what it costs a park and who earns from it: negative hours by month and hour, across zones, tomorrow\u2019s chance, storage and battery spreads.', items: [
      W('neg-zone', 6, 5, { zone: 'FR', view: 'month', win: '1Y' }), W('neg-zone-heatmap', 6, 5, { zone: 'FR' }),
      W('fc-neg', 6, 6), W('neg-cost', 6, 6),
      W('neg-crosszone', 12, 5, { view: 'year', win: '1Y' }),
      W('ren-intraday', 6, 5), W('fr-sys-flex', 6, 5),
      W('bess-spreads', 12, 5), W('da-heatmap', 12, 5, { zone: 'FR' }),
    ] },
    { id: 'winter', name: 'Winter · security of supply', desc: 'Enough power this winter? Nuclear availability and outages, hydro reservoirs, gas storage, heating degree days, consumption, capacity guarantees and exchanges.', items: [
      W('nuc-season', 6, 5), W('remit-unavail', 6, 5, { period: '3M' }),
      W('hydro-reservoirs', 6, 5, { country: 'FR' }), W('gas-storage-years', 6, 5),
      W('hdd-cum', 6, 5), W('fr-load-normal', 6, 5),
      W('fr-capacity-gc', 6, 5), W('cb-fr-avg', 6, 5),
      W('wx-outlook', 12, 5, { series: 'temp' }),
    ] },
    { id: 'monthly', name: 'Monthly review', desc: 'The last month written out, then the month in charts: spot, production, spreads, M0, capacity against the PPE3, GO, CO₂ and the PPA benchmark. Exports to PowerPoint.', items: [
      W('month-review', 12, 5),
      W('fr-spot-monthly', 6, 5, { zone: 'FR' }), W('fr-sys-monthly', 6, 5, { view: 'twh', win: '3Y' }),
      W('spark-monthly', 6, 5, { zone: 'FR', period: '1Y' }), W('ppa-benchmark', 6, 5, { tech: 'both', win: '1Y' }),
      W('fr-m0-official', 12, 6),
      W('cap-ppe3', 6, 5), W('go-vintages', 6, 5, { product: 'GO AIB Renewable' }),
      W('fr-sys-co2', 6, 6), W('neg-cost', 6, 6),
    ] },
    { id: 'europe', name: 'Europe compared', desc: 'France against its neighbours: generation mix, forwards by market, France–Germany spread, negative prices and installed capacity across zones.', items: [
      W('gm-crosszone', 12, 5),
      W('pf-compare', 6, 5, { tenor: 'Y+1', win: '1Y' }), W('fr-de-spread', 6, 5, { win: '30' }),
      W('neg-crosszone', 6, 5, { view: 'year', win: '1Y' }), W('cap-compare', 6, 5),
      W('da-intraday', 12, 5),
    ] },
    { id: 'mu', name: 'Market update · CATE presentation', desc: 'The market update in the order of the internal presentation, opened by a market introduction (key prices, what moved and why, the next 30 days); then renewables outlook vs normal, nuclear, gas storage, temperature and demand, news, forwards and spot.', items: [
      S('0 · Market introduction'),
      W('today-tiles', 12, 3),
      W('today-brief', 6, 7), W('next-30-days', 6, 7),
      S('1 · Supply'),
      W('wx-outlook', 6, 5, { series: 'precip' }), W('wx-outlook', 6, 5, { series: 'solar' }),
      W('wx-outlook', 6, 5, { series: 'wind' }), W('nuc-monthly-years', 6, 5),
      W('gas-storage-years', 6, 5), W('hydro-reservoirs', 6, 5, { country: 'FR' }),
      S('2 · Demand'),
      W('wx-outlook', 6, 5, { series: 'temp' }), W('fr-load-normal', 6, 5),
      S('3 · News and geopolitics'),
      W('fuel-coal-oil', 6, 5), W('news-latest', 6, 5),
      S('4 · Prices'),
      W('fr-cal-history', 6, 5, { win: '3M' }), W('fr-cal-drivers', 6, 5, { win: '6M' }),
      W('ttf-cal-history', 6, 5, { win: '6M' }), W('ttf-fwd-table', 6, 5),
      W('fr-spot-monthly', 6, 5), W('fr-spot-30d', 6, 5),
      W('fr-spot-day', 6, 7, { day: 'latest' }), W('fr-spot-day', 6, 7, { day: 'previous' }),
    ] },
  ];

  // ── State ────────────────────────────────────────────────────────
  let state = null;            // { v, active, boards: [{ id, name, items }] }
  let grid = null, gsReady = null, observer = null;
  let saveTimer = null, cloudTimer = null, syncing = false;
  const uid = () => Math.random().toString(36).slice(2, 10);

  // A dashboard opened from a shared link: shown as is, never saved unless
  // the viewer adds it to their own dashboards.
  let shared = null;           // { id: 'shared', name, items, code }
  function board() {
    const b = fine(shared || state.boards.find(b => b.id === state.active) || state.boards[0]);
    if (b && b.items && b.items.some(it => it.wid === 'today-reel')) b.items = b.items.filter(it => it.wid !== 'today-reel');   // the morning reel widget was withdrawn
    // boards made from the Expert template before it became a mirror (and links shared then) become one
    // (exactly the template's charts, nothing added or removed: a board the user composed stays a grid)
    if (b && b.mirror === undefined) { const sig = a => a.filter(it => it.t === 'w').map(it => it.wid).sort().join(',');
      const t = TEMPLATES.find(x => x.id === 'today-expert'); if (t && (b.items || []).length && (sig(b.items) === sig(t.items.filter(it => PKW.get(it.wid) || it.t !== 'w')) || b.desc === t.desc || /^The Expert view of Today, block for block/.test(b.desc || ''))) b.mirror = 'today-expert'; }
    return b;
  }

  // A mirror board shows a page of the site itself rather than a grid of cards: the Expert view of Today, block for block,
  // at the same sizes, so the dashboard is the page and stays so when Today changes. The page's blocks are moved into the
  // dashboard while it is open and put back as soon as it is left (another board, another page). The cards of the
  // template stay in the board for the PowerPoint export.
  const MIRRORS = {
    'today-expert': { page: 'page-morning', ids: ['mrn-stories', 'mrn2', 'hs-morning-2', 'hs-morning-fund', 'hs-morning-3', 'hs-morning-4', 'hs-morning-fc', 'hs-morning-idx'],
      hide: ['mrn-quick', 'mrn-learn'], draw: () => { if (typeof renderMorning === 'function' && !(typeof MRN !== 'undefined' && MRN.k)) renderMorning(); } },
  };
  const mirrorOf = tid => { const t = TEMPLATES.find(x => x.id === tid); return t && t.mirror || undefined; };
  let mirrored = null;   // { key, moved: [[node, placeholder, display]] }
  function unmirror() {
    if (!mirrored) return;
    if (mirrored.io) mirrored.io.disconnect();
    mirrored.moved.forEach(([n, ph, disp]) => { ph.replaceWith(n); n.style.display = disp; });
    const page = document.getElementById('page-mydash'); if (page) page.classList.remove('pkd-is-mirror');
    const box = document.getElementById('pkd-mirror'); if (box) box.remove();
    mirrored = null;
  }
  function mirror(key) {
    const m = MIRRORS[key]; if (!m) return false;
    if (mirrored && mirrored.key === key) return true;
    unmirror();
    const grid = document.getElementById('pkd-grid'); if (!grid) return false;
    const box = document.createElement('div'); box.id = 'pkd-mirror'; box.className = 'pkd-mirror';
    grid.after(box);
    const moved = [];
    m.ids.forEach(id => { const n = document.getElementById(id); if (!n) return;
      const ph = document.createComment('pkd-mirror ' + id); n.replaceWith(ph); moved.push([n, ph, n.style.display]);
      n.style.display = '';
      n.querySelectorAll('.hist-section-header, .hist-section-body').forEach(x => x.classList.add('open'));
      box.appendChild(n); });
    // the folded sections open one after the other as the reader scrolls near them (the first screen loads alone, fast);
    // the last one, PowerKlock · calculations, stays folded as on Today
    const secs = moved.map(m => m[0]).filter(n => n.classList.contains('hist-section-strong') && n.classList.contains('collapsed') && n.id !== 'hs-morning-idx');
    const io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; io.unobserve(e.target);
      e.target.classList.remove('collapsed'); const nx = secs[secs.indexOf(e.target) + 1]; if (nx) setTimeout(() => io.observe(nx), 400); }), { rootMargin: '0px 0px 500px 0px' });
    if (secs[0]) io.observe(secs[0]);
    mirrored = { key, moved, io };
    document.getElementById('page-mydash').classList.add('pkd-is-mirror');
    m.draw();
    requestAnimationFrame(() => box.querySelectorAll('canvas').forEach(c => { const ch = window.Chart && Chart.getChart(c); if (ch) ch.resize(); }));
    // the page itself comes back: put its blocks back first
    const src = document.getElementById(m.page);
    if (src && !src._pkdMirrorWatch) { src._pkdMirrorWatch = true;
      new MutationObserver(() => { if (src.classList.contains('active')) unmirror(); }).observe(src, { attributes: true, attributeFilter: ['class'] }); }
    return true;
  }

  function fromTemplate(tid) {
    const t = TEMPLATES.find(x => x.id === tid) || TEMPLATES[0];
    return t.items
      .filter(it => it.t !== 'w' || PKW.get(it.wid))
      .map(it => Object.assign({ i: uid() }, JSON.parse(JSON.stringify(it))));
  }

  // Old "pk-mydash-widgets" ids → catalogue items.
  const OLD_MAP = {
    'fr-da': W('kpi-da', 2, 2, { zone: 'FR' }), 'de-da': W('kpi-da', 2, 2, { zone: 'DE_LU' }),
    'ttf': W('kpi-fuel', 2, 2, { c: 'ttf' }), 'eua': W('kpi-fuel', 2, 2, { c: 'eua' }),
    'fr-nuclear': W('kpi-fr-nuclear', 2, 2), 'fr-load': W('kpi-fr-load', 2, 2), 'fr-export': W('kpi-fr-net', 2, 2), 'hdd-paris': W('kpi-hdd', 2, 2),
    'fr-da-chart': W('da-intraday', 6, 5, { zone: 'FR' }), 'de-da-chart': W('da-intraday', 6, 5, { zone: 'DE_LU' }),
    'fr-load-chart': W('load-day', 6, 5, { zone: 'FR' }), 'fr-cb-chart': W('cb-fr-avg', 6, 5), 'fr-ren-chart': W('ren-intraday', 6, 5),
  };

  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { const s = JSON.parse(raw); if (s && Array.isArray(s.boards) && s.boards.length) return s; }
    } catch (_) {}
    let items = null;
    try {
      const old = JSON.parse(localStorage.getItem(LS_OLD) || 'null');
      if (Array.isArray(old) && old.length) {
        items = old.map(id => OLD_MAP[id]).filter(Boolean).filter(it => PKW.get(it.wid))
          .map(it => Object.assign({ i: uid() }, JSON.parse(JSON.stringify(it))));
      }
    } catch (_) {}
    const id = uid();
    return { v: 2, active: id, boards: [{ id, name: 'My Dashboard', items: items && items.length ? items : fromTemplate('today-quick') }] };
  }

  // Built-in boards: added once to every user's dashboards (then theirs to
  // rename, edit or delete — a deleted one does not come back).
  const BUILTIN = [{ key: 'mu', name: 'Market update', tpl: 'mu' }];
  function seed() {
    if (!state || !Array.isArray(state.boards)) return false;
    state.seeded = state.seeded || {};
    let added = false;
    BUILTIN.forEach(b => {
      if (state.seeded[b.key]) return;
      if (!state.boards.some(x => x.name === b.name)) state.boards.push({ id: uid(), name: b.name, items: fromTemplate(b.tpl) });
      state.seeded[b.key] = true; added = true;
    });
    return added;
  }

  function writeLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (_) { if (!(window.PKAccount && PKAccount.user)) setSync('error'); }   // storage full or blocked: say it, do not pretend it is saved
  }

  function save() {
    if (shared) return;
    state.updated = new Date().toISOString();
    try { const b = board(); if (b) b.updated = state.updated; } catch (_) {}   // per dashboard: the merge at sign-in keeps the newest
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeLocal, 200);
    if (window.PKAccount && PKAccount.user) {
      clearTimeout(cloudTimer);
      setSync('saving');
      cloudTimer = setTimeout(() => {
        PKAccount.save(state).then(() => setSync('saved')).catch(e => { console.warn(e); setSync('error'); });
      }, 900);
    }
    PKW.refreshStars();
  }

  // ── Account sync ─────────────────────────────────────────────────
  async function syncFromCloud() {
    if (!window.PKAccount || !PKAccount.user || syncing) return;
    syncing = true; setSync('loading');
    try {
      const row = await PKAccount.load();
      if (row && row.data && Array.isArray(row.data.boards) && row.data.boards.length) {
        // merge, never replace: a dashboard only in this browser is kept, one changed on both sides keeps its newest
        // version; a copy of this browser's dashboards is kept before (pk-dash-v2-backup)
        try { localStorage.setItem(LS_KEY + '-backup', JSON.stringify(state)); } catch (_) {}
        const cloud = row.data, byId = new Map(cloud.boards.map(b => [b.id, b]));
        let localWins = false;
        (state && state.boards || []).forEach(b => { const c = byId.get(b.id);
          if (!c || (b.updated || '') > (c.updated || '')) { byId.set(b.id, b); localWins = true; } });
        state = Object.assign({}, cloud, { boards: [...byId.values()], active: byId.has(cloud.active) ? cloud.active : (state && state.active) || cloud.active });
        if (seed() || localWins) PKAccount.save(state).catch(() => {});
        writeLocal();
        if (isOpen()) render();
        setSync('saved');
      } else {
        // First sign-in: the dashboards built in this browser become the account's.
        await PKAccount.save(state);
        setSync('saved');
      }
    } catch (e) { console.warn('[PKDash] sync', e); setSync('error'); }
    syncing = false;
    PKW.refreshStars();
    renderAccount();
  }

  function setSync(s) {
    const el = document.getElementById('pkd-sync');
    if (!el) return;
    const txt = { loading: 'Loading…', saving: 'Saving…', saved: 'Saved to your account', error: 'Not saved · check connection' }[s] || '';
    el.textContent = txt;
    el.dataset.state = s;
  }

  // ── Public helpers for ☆ buttons ─────────────────────────────────
  function has(wid) { return !!(state && board().items.some(it => it.t === 'w' && it.wid === wid)); }

  function toggleWidget(wid, p) {
    const b = board();
    if (has(wid)) {
      b.items = b.items.filter(it => !(it.t === 'w' && it.wid === wid));
      toast('Removed from “' + b.name + '”');
    } else {
      const w = PKW.get(wid);
      if (!w) return;
      b.items.push(Object.assign({ i: uid(), t: 'w', wid, w: w.size.w * FINE, h: w.size.h * FINE }, p ? { p } : {}));
      toast('Added to “' + b.name + '”');
    }
    save();
    if (isOpen()) render();
  }

  function toast(msg, action, fn) {
    let el = document.getElementById('pkd-toast');
    if (!el) { el = document.createElement('div'); el.id = 'pkd-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    if (action && fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'pkd-toast-act'; b.textContent = action; b.addEventListener('click', () => { el.classList.remove('show'); fn(); }); el.appendChild(b); }
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), action ? 8000 : 2200);
  }

  // ── GridStack ────────────────────────────────────────────────────
  function loadGridStack() {
    if (window.GridStack) return Promise.resolve();
    if (gsReady) return gsReady;
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = GS_CSS;
    document.head.appendChild(css);
    gsReady = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = GS_JS; s.onload = res; s.onerror = () => rej(new Error('GridStack failed to load'));
      document.head.appendChild(s);
    });
    return gsReady;
  }

  function isOpen() { const p = document.getElementById('page-mydash'); return !!(p && p.classList.contains('active')); }

  async function open() {
    if (!state) init();
    renderTabs();
    renderAccount();
    try { await loadGridStack(); } catch (e) {
      document.getElementById('pkd-grid').innerHTML = '<div class="pkd-empty">The layout engine could not load. Check your connection and reload the page.</div>';
      return;
    }
    render();
  }

  // row height follows the screen width: on a large screen every chart grows in height as well as in width
  //   (64 px up to ~1300 px of grid, then proportional, capped at 120 px)
  const cellH = () => Math.round(Math.max(28, Math.min(48, (window.innerWidth - 260) / 48)));   // half the former row height (fine grid)   // 64 px at ~1800 px wide, 72 at 2000   // the menu's width taken off even when hidden: the shared view keeps PowerKlock's proportions
  let resizeT = null;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => {
    const host = document.getElementById('pkd-grid'); if (!grid || !host || !host.offsetParent) return;
    const h = cellH(host); if (h !== grid.getCellHeight()) { grid.cellHeight(h); setTimeout(() => host.querySelectorAll('canvas').forEach(c => { const ch = window.Chart && Chart.getChart(c); if (ch) ch.resize(); }), 300); } }, 200); });
  // the layout is locked unless "Edit layout" is on: no card moves by accident; while editing, a card dropped on
  // another of the same size swaps with it, and every move or resize can be undone
  let editing = false;
  function setEditing(on) {
    editing = !!on && !shared;
    const page = document.getElementById('page-mydash'); if (page) page.classList.toggle('pkd-editing', editing);
    const btn = document.getElementById('pkd-edit');
    if (btn) { btn.textContent = editing ? '✓ Done' : '✎ Edit layout'; btn.classList.toggle('pk-btn-primary', editing); btn.classList.toggle('pk-btn-ghost', !editing); }
    if (!grid) return;
    grid.setStatic(!editing);
    if (!editing) { syncFromGrid(board()); save(); }
  }
  function render() {
    const host = document.getElementById('pkd-grid');
    if (!host || !window.GridStack) return;
    renderTabs();
    renderShared();
    renderDesc();
    if (grid) { grid.destroy(false); grid = null; }
    if (observer) observer.disconnect();
    destroyCharts(host);
    host.innerHTML = '';
    const b = board();
    if (b.mirror && mirror(b.mirror)) { document.getElementById('pkd-empty').hidden = true; return; }
    unmirror();
    document.getElementById('pkd-empty').hidden = b.items.length > 0;
    grid = GridStack.init({
      column: COLS, cellHeight: cellH(host), margin: 6, float: false, animate: true,
      handle: '.pkd-drag', draggable: { handle: '.pkd-drag', cancel: '.pkd-sec-move, .pkd-ic, [contenteditable="plaintext-only"]' }, resizable: { handles: 'se' }, staticGrid: !!shared || !editing,
      columnOpts: { breakpoints: [{ w: 760, c: 1 }], columnMax: COLS },
    }, host);
    observer = new IntersectionObserver(onVisible, { rootMargin: '200px' });
    grid.batchUpdate();
    b.items.filter(it => !it.hid).forEach(it => {
      const el = itemEl(it);
      host.appendChild(el);
      grid.makeWidget(el);
    });
    grid.batchUpdate(false);
    { const secs = b.items.filter(x => x.t === 's').sort((x, y) => x.y - y.y), first = secs[0], lastS = secs[secs.length - 1];
      secs.forEach(sct => { const el = host.querySelector('.grid-stack-item[data-i="' + sct.i + '"]'); if (!el) return;
        const up = el.querySelector('.pkd-sec-up'), dn = el.querySelector('.pkd-sec-dn');
        if (up) { up.disabled = sct === first; up.title = sct === first ? 'Already the first section' : 'Move the whole section up (with its charts)'; }
        if (dn) { dn.disabled = sct === lastS; dn.title = sct === lastS ? 'Already the last section' : 'Move the whole section down (with its charts)'; } }); }
    host.querySelectorAll('.pkd-item[data-kind="w"]').forEach(el => observer.observe(el));
    grid.on('change', (_e, nodes) => {
      if (grid.getColumn() !== COLS) return;   // phone layout is derived, never saved
      nodes.forEach(n => {
        const it = b.items.find(x => x.i === n.el.dataset.i);
        if (it) Object.assign(it, { x: n.x, y: n.y, w: n.w, h: n.h });
      });
      save();
    });
    // in edit mode, each move or resize can be undone (the layout as it was when the card was picked up)
    grid.on('dragstart resizestart', () => { syncFromGrid(b); snapshot(b); });
    grid.on('dragstop', () => setTimeout(() => toast('Card moved', 'Undo', undoMove), 50));
    grid.on('resizestop', (_e, el) => {
      setTimeout(() => toast('Card resized', 'Undo', undoMove), 50);
      const c = el.querySelector('canvas');
      const ch = c && window.Chart && Chart.getChart(c);
      if (ch) ch.resize();
    });
  }

  function destroyCharts(root) {
    root.querySelectorAll('canvas').forEach(c => {
      const ch = window.Chart && Chart.getChart(c);
      if (ch) ch.destroy();
      if (typeof CHARTS !== 'undefined' && CHARTS[c.id]) delete CHARTS[c.id];
    });
  }

  const esc = PK.esc;   // js/pk-core.js
  function itemEl(it) {
    const el = document.createElement('div');
    el.className = 'grid-stack-item';
    el.dataset.i = it.i;
    const pos = { x: it.x, y: it.y, w: it.w || 12, h: it.h || 8 };
    Object.keys(pos).forEach(k => { if (pos[k] != null) el.setAttribute('gs-' + k, pos[k]); });
    if (it.t === 's') { el.setAttribute('gs-w', COLS); el.setAttribute('gs-h', FINE); el.setAttribute('gs-no-resize', 'true'); }
    const inner = document.createElement('div');
    inner.className = 'grid-stack-item-content pkd-item';
    inner.dataset.kind = it.t;
    el.appendChild(inner);

    if (it.t === 's') {
      const nHid = board().items.filter(x => x.hid === it.i).length;
      inner.innerHTML = `<div class="pkd-section pkd-drag${it.c ? ' pkd-sec-closed' : ''}">
          <button class="pkd-ic pkd-sec-fold" type="button" title="${it.c ? 'Show this section' + (nHid ? ' (' + nHid + ' item' + (nHid > 1 ? 's' : '') + ')' : '') : 'Collapse this section'}" aria-expanded="${!it.c}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
          <h2 class="pkd-section-title" contenteditable="${shared ? 'false' : 'plaintext-only'}" spellcheck="false" data-ph="Section title">${esc(it.title)}</h2>
          <span class="pkd-sec-move"><button class="pkd-ic pkd-sec-up" title="Move the whole section up (with its charts)" type="button">▲</button><button class="pkd-ic pkd-sec-dn" title="Move the whole section down (with its charts)" type="button">▼</button></span>
          ${it.c && nHid ? `<span class="pkd-sec-n">${nHid} hidden</span>` : ''}<button class="pkd-ic pkd-del" title="Remove section" type="button">✕</button>
        </div>`;
      const fold = inner.querySelector('.pkd-sec-fold');
      ['pointerdown', 'mousedown', 'touchstart'].forEach(ev => fold.addEventListener(ev, e => e.stopPropagation()));
      fold.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); foldSection(it.i); });
      inner.querySelectorAll('.pkd-sec-move button').forEach(btn => ['pointerdown', 'mousedown', 'touchstart'].forEach(ev => btn.addEventListener(ev, e => e.stopPropagation())));   // a click on an arrow never starts a drag
      inner.querySelector('.pkd-sec-up').addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); moveSection(it.i, -1); });
      inner.querySelector('.pkd-sec-dn').addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); moveSection(it.i, 1); });
      const h = inner.querySelector('.pkd-section-title');
      h.addEventListener('blur', () => { it.title = h.textContent.trim(); save(); });
      h.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); h.blur(); } });
    } else if (it.t === 'n') {
      inner.innerHTML = `<div class="pkd-head pkd-drag"><span class="pkd-title">${esc(it.title || 'Note')}</span>
          <span class="pkd-actions"><button class="pkd-ic pkd-cfg" title="Rename" type="button">⚙</button><button class="pkd-ic pkd-del" title="Remove note" type="button">✕</button></span></div>
        <div class="pkd-note" contenteditable="${shared ? 'false' : 'plaintext-only'}" spellcheck="true" data-ph="Write your market view…"></div>`;
      const n = inner.querySelector('.pkd-note');
      n.textContent = it.text || '';
      n.addEventListener('blur', () => { it.text = n.textContent; save(); });
    } else {
      const w = PKW.get(it.wid);
      const title = it.title || (w ? autoTitle(w, it) : 'Unavailable widget');
      inner.innerHTML = `<div class="pkd-head pkd-drag">
          <div class="pkd-titles"><span class="pkd-title">${esc(title)}</span><span class="pkd-sub">${esc(w ? w.source : '')}</span></div>
          <span class="pkd-actions">
            ${w && w.params.length ? '<button class="pkd-ic pkd-cfg" title="Settings" type="button">⚙</button>' : '<button class="pkd-ic pkd-cfg" title="Rename" type="button">⚙</button>'}
            ${w && w.kind === 'chart' ? '<button class="pkd-ic pkd-fs pk-tool" data-pk-tool="1" title="Fullscreen" aria-label="Fullscreen" type="button">' + PK_ICON_FS + '</button>' : ''}
            ${w && w.page ? '<button class="pkd-ic pkd-go" title="Open source page" type="button">↗</button>' : ''}
            <button class="pkd-ic pkd-del" title="Remove from dashboard" type="button">✕</button>
          </span>
        </div>
        <div class="pkd-body">${w ? '<div class="pkd-loading">Loading…</div>' : '<div class="pkd-empty-w">This chart is no longer in the catalogue.</div>'}</div>`;
      inner._item = it;
      if (w && w.kind === 'html') inner.classList.add('pkd-html');
    }

    inner.querySelector('.pkd-del')?.addEventListener('click', () => removeItem(it.i));
    inner.querySelector('.pkd-cfg')?.addEventListener('click', () => openSettings(it.i));
    inner.querySelector('.pkd-fs')?.addEventListener('click', () => fullscreen(inner, it));
    inner.querySelector('.pkd-go')?.addEventListener('click', () => {
      const w = PKW.get(it.wid);
      if (w && typeof showPage === 'function') showPage(w.page);
    });
    return el;
  }

  // Default title: catalogue title, plus the zone/fuel picked when the
  // widget has such a parameter.
  function autoTitle(w, it) {
    const p = PKW.params(w.id, it.p);
    const tag = w.params.filter(d => d.inTitle).map(d => {
      const o = d.options.find(x => x[0] === p[d.key]);
      return o ? o[1] : p[d.key];
    }).filter(Boolean).join(' · ');
    return tag ? (w.titleFn ? w.titleFn(p) : w.title + ' · ' + tag) : (w.titleFn ? w.titleFn(p) : w.title);
  }

  function onVisible(entries) {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      observer.unobserve(e.target);
      drawItem(e.target);
    });
  }

  async function drawItem(inner) {
    const it = inner._item;
    const w = it && PKW.get(it.wid);
    const body = inner.querySelector('.pkd-body');
    if (!w || !body) return;
    const p = PKW.params(w.id, it.p);
    if (w.kind === 'html') {
      try { await w.html(body, p); } catch (e) { body.innerHTML = '<div class="pkd-empty-w">Unavailable</div>'; console.warn(e); }
      hideBoot();
      return;
    }
    const cid = 'pkd-c-' + it.i, kOn = it.k && it.k.on && window.PKFacts;
    body.classList.toggle('kf-on', !!kOn);
    body.innerHTML = (kOn ? '<div class="pkd-kf"></div>' : '') + `<div class="pkd-canvas"><canvas id="${cid}" style="width:100%;height:100%"></canvas></div>`;
    const res = await PKW.draw(w.id, cid, p);
    hideBoot();
    if (res && res.sub) inner.querySelector('.pkd-sub').textContent = w.source + ' · ' + res.sub;
    // enriched card: key figures from the chart's own data, min / max marked
    if (kOn) {
      const ch = window.Chart && Chart.getChart(document.getElementById(cid));
      const f = ch && PKFacts.compute(ch, it.k);
      const box = body.querySelector('.pkd-kf'); if (box) box.innerHTML = PKFacts.html(f, it.k);
      if (f) { PKFacts.mark(ch, f, it.k); setTimeout(() => { try { ch.resize(); } catch (_) {} }, 30); }
    }
  }

  function redrawItem(i) {
    const inner = document.querySelector('.grid-stack-item[data-i="' + i + '"] .pkd-item');
    if (!inner) return;
    destroyCharts(inner);
    const it = board().items.find(x => x.i === i);
    const w = it && PKW.get(it.wid);
    if (w) inner.querySelector('.pkd-title').textContent = it.title || autoTitle(w, it);
    drawItem(inner);
  }

  function fullscreen(inner, it) {
    const c = inner.querySelector('canvas');
    if (!c || !window.pkOpenOrUpdate) return;
    window.pkOpenOrUpdate({
      title: inner.querySelector('.pkd-title').textContent,
      subtitle: inner.querySelector('.pkd-sub').textContent,
      filenameStem: it.wid, source: (PKW.get(it.wid) || {}).source || '', noLogo: true,   // a dashboard's screenshots carry no PowerKlock logo
      storageKey: 'fs:pkd:' + it.wid,
      table: { html: typeof pkAutoTable === 'function' ? pkAutoTable(Chart.getChart(c)) : '' },
      chartSource: { rebuildInto: dst => pkCloneCanvasChart(c, dst) },
    });
  }

  // Data arrived elsewhere (prices, GO…): redraw widgets already drawn.
  function refresh() {
    if (!isOpen()) return;
    document.querySelectorAll('#pkd-grid .pkd-item[data-kind="w"]').forEach(inner => {
      if (!inner.querySelector('.pkd-loading')) { destroyCharts(inner); drawItem(inner); }
    });
  }

  // ── Item operations ──────────────────────────────────────────────
  function addItem(it) {
    const b = board();
    it.i = uid();
    b.items.push(it);
    save();
    render();
    const el = document.querySelector('.grid-stack-item[data-i="' + it.i + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (it.t === 's') setTimeout(() => el.querySelector('.pkd-section-title')?.focus(), 350);
      if (it.t === 'n') setTimeout(() => el.querySelector('.pkd-note')?.focus(), 350);
    }
  }
  function addWidget(wid) {
    const w = PKW.get(wid);
    if (!w) return;
    addItem({ t: 'w', wid, w: w.size.w * FINE, h: w.size.h * FINE });
  }
  function addSection() { addItem({ t: 's', title: '', w: COLS, h: FINE }); }
  function addNote() { addItem({ t: 'n', title: 'Note', text: '', w: 4 * FINE, h: 3 * FINE }); }

  function removeItem(i) {
    const b = board();
    const freed = b.items.filter(x => x.hid === i);   // a collapsed section removed: its cards come back at the bottom
    if (freed.length) { const y0 = Math.max(0, ...b.items.filter(x => !x.hid && x.i !== i).map(x => x.y + x.h)); freed.forEach(x => { delete x.hid; x.y = y0 + (x.cy || 0); delete x.cy; }); }
    b.items = b.items.filter(x => x.i !== i);
    save();
    if (freed.length) { render(); return; }
    const el = document.querySelector('.grid-stack-item[data-i="' + i + '"]');
    if (el && grid) { destroyCharts(el); grid.removeWidget(el); }
    document.getElementById('pkd-empty').hidden = b.items.length > 0;
  }

  // ── Settings dialog (title + parameters) ─────────────────────────
  function openSettings(i) {
    const it = board().items.find(x => x.i === i);
    if (!it) return;
    const w = it.t === 'w' ? PKW.get(it.wid) : null;
    const p = w ? PKW.params(w.id, it.p) : {};
    const fields = (w ? w.params : []).map(d => `
      <label class="pkd-field"><span>${esc(d.label)}</span>
        <select id="pkd-set-${esc(d.key)}">${d.options.map(o => `<option value="${esc(o[0])}"${String(p[d.key]) === String(o[0]) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>
      </label>`).join('');
    modal(`
      <div class="pkd-modal-head"><div><div class="pkd-modal-title">${w ? 'Widget settings' : 'Rename'}</div>
        ${w ? `<div class="pkd-modal-sub">${esc(w.title)} · ${esc(w.source)}</div>` : ''}</div>
        <button class="pkd-ic" data-close type="button" title="Close">✕</button></div>
      <form class="pkd-form" id="pkd-set-form">
        <label class="pkd-field"><span>Title</span>
          <input id="pkd-set-title" type="text" maxlength="80" value="${esc(it.title || '')}" placeholder="${esc(w ? autoTitle(w, Object.assign({}, it, { title: '' })) : 'Note')}"></label>
        ${fields}
        ${w && w.kind === 'chart' && window.PKFacts ? (() => {
          const k = it.k || {}, c = document.querySelector('.grid-stack-item[data-i="' + it.i + '"] canvas'), ch = c && window.Chart && Chart.getChart(c);
          const series = ch ? PKFacts.candidates(ch).map(x => x.d.label) : [], want = k.facts && k.facts.length ? k.facts : PKFacts.DEFAULT;
          return `<div class="pkd-kf-set"><label class="pkd-kf-on"><input type="checkbox" id="pkd-set-kf"${k.on ? ' checked' : ''}> <b>Key figures above the chart</b> <em>computed from the chart, min and max marked</em></label>
            <div class="pkd-kf-opts">${PKFacts.FACTS.map(([id, l]) => `<label><input type="checkbox" data-kf="${id}"${want.includes(id) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
            ${series.length > 1 ? `<label class="pkd-field"><span>Series</span><select id="pkd-set-kfs">${series.map(sr => `<option${sr === k.series ? ' selected' : ''}>${esc(sr)}</option>`).join('')}</select></label>` : ''}
            <label class="pkd-field"><span>A rise is</span><select id="pkd-set-kfr">${[['auto', 'Automatic (prices: unfavourable)'], ['bad', 'Unfavourable (red)'], ['good', 'Favourable (green)'], ['neutral', 'Neutral']].map(o => `<option value="${o[0]}"${(k.rise || 'auto') === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label></div>`;
        })() : ''}
        <div class="pkd-form-foot"><button type="button" class="pk-btn-ghost" data-close>Cancel</button><button type="submit" class="pk-btn-primary">Apply</button></div>
      </form>`, root => {
      root.querySelector('#pkd-set-form').addEventListener('submit', ev => {
        ev.preventDefault();
        it.title = root.querySelector('#pkd-set-title').value.trim();
        const kfOn = root.querySelector('#pkd-set-kf');
        if (kfOn) {
          it.k = { on: kfOn.checked, facts: [...root.querySelectorAll('[data-kf]')].filter(x => x.checked).map(x => x.dataset.kf),
            series: (root.querySelector('#pkd-set-kfs') || {}).value || (it.k && it.k.series), rise: root.querySelector('#pkd-set-kfr').value };
          if (!it.k.on && !it.k.facts.length) delete it.k;
        }
        if (w) {
          it.p = {};
          w.params.forEach(d => { it.p[d.key] = root.querySelector('#pkd-set-' + d.key).value; });
        }
        save();
        closeModal();
        if (w) redrawItem(i);
        else { const el = document.querySelector('.grid-stack-item[data-i="' + i + '"] .pkd-title'); if (el) el.textContent = it.title || 'Note'; }
      });
    });
  }

  // ── Catalogue ────────────────────────────────────────────────────
  let catCat = 'all', catQuery = '';
  function openCatalog() {
    modal(`
      <div class="pkd-modal-head"><div><div class="pkd-modal-title">Add to “${esc(board().name)}”</div>
        <div class="pkd-modal-sub">Every chart of the site, by theme. You can also use ☆ on any chart.</div></div>
        <button class="pkd-ic" data-close type="button" title="Close">✕</button></div>
      <div class="pkd-cat">
        <nav class="pkd-cat-nav" id="pkd-cat-nav"></nav>
        <div class="pkd-cat-main">
          <input id="pkd-cat-q" class="pkd-cat-q" type="search" placeholder="Search charts, sources, zones…" value="${esc(catQuery)}">
          <div class="pkd-cat-extra">
            <button type="button" class="pkd-chip" id="pkd-cat-sec">+ Section title</button>
            <button type="button" class="pkd-chip" id="pkd-cat-note">+ Text note</button>
          </div>
          <div class="pkd-cat-list" id="pkd-cat-list"></div>
        </div>
      </div>`, root => {
      root.classList.add('pkd-modal-wide');
      root.querySelector('#pkd-cat-q').addEventListener('input', e => { catQuery = e.target.value; drawCatalog(root); });
      root.querySelector('#pkd-cat-sec').addEventListener('click', () => { closeModal(); addSection(); });
      root.querySelector('#pkd-cat-note').addEventListener('click', () => { closeModal(); addNote(); });
      drawCatalog(root);
      setTimeout(() => root.querySelector('#pkd-cat-q').focus(), 30);
    });
  }

  function drawCatalog(root) {
    const all = PKW.list();
    const counts = {};
    all.forEach(w => { counts[w.category] = (counts[w.category] || 0) + 1; });
    root.querySelector('#pkd-cat-nav').innerHTML =
      `<button type="button" class="pkd-cat-tab${catCat === 'all' ? ' on' : ''}" data-c="all">All <span>${all.length}</span></button>` +
      PKW.CATEGORIES.filter(c => counts[c[0]]).map(c =>
        `<button type="button" class="pkd-cat-tab${catCat === c[0] ? ' on' : ''}" data-c="${c[0]}">${esc(c[1])} <span>${counts[c[0]]}</span></button>`).join('');
    root.querySelectorAll('.pkd-cat-tab').forEach(b => b.addEventListener('click', () => { catCat = b.dataset.c; drawCatalog(root); }));
    const q = catQuery.trim().toLowerCase();
    const rows = all.filter(w => (catCat === 'all' || w.category === catCat)
      && (!q || (w.title + ' ' + w.desc + ' ' + w.source).toLowerCase().includes(q)));
    const catName = id => (PKW.CATEGORIES.find(c => c[0] === id) || [, ''])[1];
    root.querySelector('#pkd-cat-list').innerHTML = rows.length ? rows.map(w => {
      const n = board().items.filter(it => it.t === 'w' && it.wid === w.id).length;
      return `<div class="pkd-cat-item">
        <div class="pkd-cat-txt"><div class="pkd-cat-name">${esc(w.title)}</div>
          <div class="pkd-cat-desc">${esc(w.desc)}</div>
          <div class="pkd-cat-meta">${esc(catName(w.category))} · ${esc(w.source)}${w.params.length ? ' · ' + w.params.map(d => esc(d.label)).join(', ') : ''}</div></div>
        <button type="button" class="pkd-add${n ? ' on' : ''}" data-w="${w.id}">${n ? '✓ Added' + (n > 1 ? ' ×' + n : '') : '+ Add'}</button>
      </div>`;
    }).join('') : '<div class="pkd-empty-w">No chart matches “' + esc(catQuery) + '”.</div>';
    root.querySelectorAll('.pkd-add').forEach(b => b.addEventListener('click', () => {
      const w = PKW.get(b.dataset.w);
      board().items.push({ i: uid(), t: 'w', wid: w.id, w: w.size.w * FINE, h: w.size.h * FINE });
      save();
      drawCatalog(root);
      toast('Added “' + w.title + '”');
    }));
  }

  // ── Dashboards (tabs) ────────────────────────────────────────────
  // a short text under the dashboard's name saying what it shows; empty = a suggestion built from its charts
  function suggestDesc(b) {
    // a sentence from the dashboard's own content: its sections, then its charts
    const its = b.items.slice().sort((x, y) => (x.y - y.y) || (x.x - y.x));
    const secs = its.filter(it => it.t === 's' && it.title).map(it => it.title);
    const charts = its.filter(it => it.t === 'w').map(it => { const w = PKW.get(it.wid); return w ? (it.title || autoTitle(w, it)) : null; }).filter(Boolean);
    if (!charts.length) return '';
    const list = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
    const shown = charts.slice(0, 4).map(t => t.replace(/\s*·\s*/g, ' '));
    return (secs.length ? `${list(secs)}: ` : '') + list(shown) + (charts.length > 4 ? `, and ${charts.length - 4} more chart${charts.length > 5 ? 's' : ''}` : '') + '.';
  }
  function renderDesc() {
    const page = document.getElementById('page-mydash'); if (!page) return;
    let el = document.getElementById('pkd-desc');
    if (!el) { el = document.createElement('div'); el.id = 'pkd-desc'; el.className = 'pkd-desc'; const g = document.getElementById('pkd-grid'); g.parentElement.insertBefore(el, g); }
    const b = shared || board(), own = (b && b.desc) || '', auto = b ? suggestDesc(b) : '';
    const txt = own || auto;
    el.classList.toggle('pkd-desc-auto', !own);
    el.textContent = txt; el.hidden = !txt;                       // nothing to say: no empty line
    if (shared) { el.contentEditable = 'false'; el.removeAttribute('title'); return; }
    el.contentEditable = 'plaintext-only'; el.spellcheck = true;
    el.title = own ? 'What this dashboard shows: click to edit' : 'Proposed from the charts: click to rewrite it (kept with the dashboard and in its share links)';
    el.onfocus = () => { if (!b.desc) { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } };
    el.onblur = () => { const v = el.textContent.trim().slice(0, 400); if (v && v !== auto && v !== (b.desc || '')) { b.desc = v; save(); } else if (!v && b.desc) { b.desc = ''; save(); } renderDesc(); };
    el.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } };
  }
  // shared view: the loading animation leaves once the first chart is drawn (at least 1.2 s, at most 8 s)
  const bootAt = Date.now();
  function hideBoot() { const b = document.getElementById('pk-boot'); if (!b || b.dataset.going) return; b.dataset.going = '1';
    setTimeout(() => { b.classList.add('gone'); setTimeout(() => b.remove(), 600); }, Math.max(0, 1200 - (Date.now() - bootAt))); }
  setTimeout(hideBoot, 8000);
  // a section moves with everything under it, down to the next section: blocks are swapped, each keeps its layout
  let undoLayout = null;
  function syncFromGrid(b) {
    // the positions shown on screen are the truth: the grid compacts cards without always reporting it
    if (!grid || grid.getColumn() !== COLS) return;
    grid.engine.nodes.forEach(n => { const it = b.items.find(x => x.i === (n.el && n.el.dataset.i)); if (it) Object.assign(it, { x: n.x, y: n.y, w: n.w, h: n.h }); });
  }
  function undoMove() {
    const b = board(); if (!undoLayout || undoLayout.board !== b.id) return;
    undoLayout.items.forEach(u => { const it = b.items.find(x => x.i === u.i); if (it) Object.assign(it, { x: u.x, y: u.y, w: u.w, h: u.h }); });
    undoLayout = null; save(); render(); toast('Undone');
  }
  // blocks of the dashboard: what sits before the first section, then each section with every card whose top
  // is at or below it and above the next section (side by side included); sections are made full width
  function blocksOf(b) {
    syncFromGrid(b);
    const secs = b.items.filter(it => it.t === 's').sort((x, y) => x.y - y.y);
    secs.forEach(sc => { sc.x = 0; sc.w = COLS; });
    const blocks = [{ items: [] }].concat(secs.map(sc => ({ sec: sc.i, title: sc.title || '', items: [sc] })));
    b.items.filter(it => it.t !== 's' && !it.hid).sort((x, y) => (x.y - y.y) || (x.x - y.x)).forEach(it => {
      let k = 0; secs.forEach((sc, j) => { if (sc.y <= it.y) k = j + 1; }); blocks[k].items.push(it); });
    return blocks.filter(bl => bl.items.length);
  }
  function stack(blocks) {
    let y = 0;
    blocks.forEach(bl => { const top = Math.min(...bl.items.map(it => it.y)); let h = 0;
      bl.items.forEach(it => { it.y = y + (it.y - top); h = Math.max(h, it.y + it.h - y); });   // a section is its block's top: cards keep their places under it
      y += Math.max(h, 1); });
  }
  function snapshot(b) { undoLayout = { board: b.id, items: b.items.map(it => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h })) }; }
  // the page never jumps: the section clicked stays where it was on screen after the grid is rebuilt
  function scroller(el) { for (let p = el && el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p; } return document.scrollingElement || document.documentElement; }
  function keepInView(id, fn) {
    const q = () => document.querySelector('#pkd-grid .grid-stack-item[data-i="' + id + '"]');
    const host = document.getElementById('pkd-grid'), el0 = q(), sc = scroller(host), top0 = el0 ? el0.getBoundingClientRect().top : null, st = sc.scrollTop;
    if (host) host.style.minHeight = host.offsetHeight + 'px';   // no collapse of the page while the grid is rebuilt
    fn();
    sc.scrollTop = st;
    const el1 = q(); if (el1 && top0 != null) sc.scrollTop += el1.getBoundingClientRect().top - top0;
    setTimeout(() => { if (host) host.style.minHeight = ''; }, 400);
  }
  // collapse / expand a section: its cards leave the grid (remembered under it, with their places) and what follows moves up
  function foldSection(id) {
    const b = board(), sc = b.items.find(x => x.i === id); if (!sc) return;
    if (!sc.c) {
      const blocks = blocksOf(b), bl = blocks.find(x => x.sec === id);
      (bl ? bl.items : []).filter(it => it.t !== 's').forEach(it => { it.hid = id; it.cy = it.y - sc.y; });
      sc.c = true;
      stack(blocksOf(b));
    } else {
      const blocks = blocksOf(b), bl = blocks.find(x => x.sec === id);
      b.items.filter(it => it.hid === id).forEach(it => { delete it.hid; it.y = sc.y + Math.max(1, it.cy || 1); delete it.cy; if (bl) bl.items.push(it); });
      delete sc.c;
      stack(blocks);
    }
    save(); keepInView(id, render);
  }
  function moveSection(id, dir) {
    const b = board(); snapshot(b);
    const blocks = blocksOf(b);
    const k = blocks.findIndex(bl => bl.sec === id), j = k + dir;
    if (k < 0 || j < 0 || j >= blocks.length || !blocks[j].sec) return;   // never above the charts that sit before the first section
    [blocks[k], blocks[j]] = [blocks[j], blocks[k]];
    stack(blocks); save(); keepInView(id, render);
    toast('Section moved with its ' + (blocks[j].items.length - 1) + ' item' + (blocks[j].items.length > 2 ? 's' : ''), 'Undo', undoMove);
  }
  // sections numbered "1 · …", "2 · …": put them back in their numbers' order, each with its charts
  function orderSections() {
    const b = board(); snapshot(b);
    const blocks = blocksOf(b), head = blocks[0] && !blocks[0].sec ? [blocks.shift()] : [];
    const num = t => { const m = String(t || '').match(/^\s*(\d+)/); return m ? +m[1] : 1e9; };
    blocks.sort((a, c) => num(a.title) - num(c.title) || String(a.title).localeCompare(String(c.title)));
    stack(head.concat(blocks)); save(); keepInView(blocks[0] && blocks[0].sec, render);
    toast('Sections in order: ' + blocks.map(bl => bl.title.trim().split(/\s+/)[0]).join(', '), 'Undo', undoMove);
  }
  function renderTabs() {
    const el = document.getElementById('pkd-tabs');
    if (!el || !state) return;
    el.innerHTML = (shared ? `<button type="button" class="pkd-tab on pkd-tab-shared" title="Shared with you">↗ ${esc(shared.name)}</button>` : '') +
      state.boards.map(b =>
      `<button type="button" class="pkd-tab${!shared && b.id === state.active ? ' on' : ''}" data-b="${b.id}">${esc(b.name)}</button>`).join('') +
      '<button type="button" class="pkd-tab pkd-tab-new" id="pkd-new" title="New dashboard">+ New</button>';
    el.querySelectorAll('.pkd-tab[data-b]').forEach(t => t.addEventListener('click', () => {
      if (!shared && state.active === t.dataset.b) return;
      if (shared) closeShared(false);
      state.active = t.dataset.b; save(); render();
    }));
    el.querySelector('#pkd-new').addEventListener('click', () => { if (shared) closeShared(false); openNewBoard(); });
  }

  function openNewBoard() {
    modal(`
      <div class="pkd-modal-head"><div><div class="pkd-modal-title">New dashboard</div>
        <div class="pkd-modal-sub">Start from a template or from an empty page.</div></div>
        <button class="pkd-ic" data-close type="button" title="Close">✕</button></div>
      <form class="pkd-form" id="pkd-new-form">
        <label class="pkd-field"><span>Name</span><input id="pkd-new-name" type="text" maxlength="40" required value="Dashboard ${state.boards.length + 1}"></label>
        <div class="pkd-tpls">
          ${TEMPLATES.map((t, k) => `<label class="pkd-tpl"><input type="radio" name="tpl" value="${t.id}"${k === 0 ? ' checked' : ''}><span><b>${esc(t.name)}</b><em>${esc(t.desc)}</em></span></label>`).join('')}
          <label class="pkd-tpl"><input type="radio" name="tpl" value=""><span><b>Empty</b><em>Add charts yourself from the catalogue or with ☆.</em></span></label>
        </div>
        <div class="pkd-form-foot"><button type="button" class="pk-btn-ghost" data-close>Cancel</button><button type="submit" class="pk-btn-primary">Create</button></div>
      </form>`, root => {
      root.querySelector('#pkd-new-form').addEventListener('submit', ev => {
        ev.preventDefault();
        const tpl = root.querySelector('input[name=tpl]:checked').value;
        const id = uid();
        state.boards.push({ id, name: root.querySelector('#pkd-new-name').value.trim() || 'Dashboard', desc: tpl ? ((TEMPLATES.find(t => t.id === tpl) || {}).desc || '') : '', items: tpl ? fromTemplate(tpl) : [], mirror: mirrorOf(tpl) });
        state.active = id;
        save(); closeModal(); render();
      });
    });
  }

  function openBoardMenu() {
    const b = board();
    modal(`
      <div class="pkd-modal-head"><div><div class="pkd-modal-title">Dashboard “${esc(b.name)}”</div></div>
        <button class="pkd-ic" data-close type="button" title="Close">✕</button></div>
      <form class="pkd-form" id="pkd-board-form">
        <label class="pkd-field"><span>Name</span><input id="pkd-board-name" type="text" maxlength="40" required value="${esc(b.name)}"></label>
        <label class="pkd-field"><span>Replace content with a template</span>
          <select id="pkd-board-tpl"><option value="">Keep current content</option>${TEMPLATES.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
        <div class="pkd-form-row">
          <button type="button" class="pk-btn-ghost" id="pkd-board-order" title="Sections numbered 1 · …, 2 · …: back in their numbers' order, each with its charts">Order sections by number</button>
          <button type="button" class="pk-btn-ghost" id="pkd-board-dup">Duplicate</button>
          <button type="button" class="pk-btn-ghost" id="pkd-board-export">Export layout</button>
          <button type="button" class="pk-btn-ghost" id="pkd-board-import">Import layout</button>
          <button type="button" class="pk-btn-ghost pkd-danger" id="pkd-board-del"${state.boards.length < 2 ? ' disabled title="Your only dashboard cannot be deleted"' : ''}>Delete</button>
        </div>
        <div class="pkd-confirm" id="pkd-board-confirm" hidden>Delete “${esc(b.name)}” and its ${b.items.length} items? <button type="button" class="pk-btn-ghost pkd-danger" id="pkd-board-del2">Delete</button></div>
        <div class="pkd-form-foot"><button type="button" class="pk-btn-ghost" data-close>Cancel</button><button type="submit" class="pk-btn-primary">Save</button></div>
      </form>`, root => {
      root.querySelector('#pkd-board-form').addEventListener('submit', ev => {
        ev.preventDefault();
        b.name = root.querySelector('#pkd-board-name').value.trim() || b.name;
        const tpl = root.querySelector('#pkd-board-tpl').value;
        if (tpl) { b.items = fromTemplate(tpl); delete b.grid; fine(b); b.mirror = mirrorOf(tpl); }
        save(); closeModal(); render();
      });
      root.querySelector('#pkd-board-order').addEventListener('click', () => { closeModal(); orderSections(); });
      root.querySelector('#pkd-board-dup').addEventListener('click', () => {
        const id = uid();
        state.boards.push({ id, name: b.name + ' (copy)', desc: b.desc || '', grid: b.grid, mirror: b.mirror, items: JSON.parse(JSON.stringify(b.items)).map(it => Object.assign(it, { i: uid() })) });
        state.active = id; save(); closeModal(); render();
      });
      root.querySelector('#pkd-board-export').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify({ powerklock: 'dashboard', v: 2, grid: b.grid, name: b.name, desc: b.desc || '', items: b.items }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'powerklock-' + b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
      root.querySelector('#pkd-board-import').addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'application/json,.json';
        inp.onchange = () => {
          const f = inp.files[0]; if (!f) return;
          f.text().then(txt => {
            const j = JSON.parse(txt);
            if (!j || !Array.isArray(j.items)) throw new Error('Not a PowerKlock layout file');
            const id = uid();
            state.boards.push({ id, name: String(j.name || 'Imported').slice(0, 40), desc: String(j.desc || '').slice(0, 400), grid: j.grid === FINE ? FINE : undefined, items: reid(j.items.filter(it => it && ['w', 's', 'n'].includes(it.t))) });
            state.active = id; save(); closeModal(); render();
            toast('Layout imported');
          }).catch(e => toast('Import failed: ' + e.message));
        };
        inp.click();
      });
      root.querySelector('#pkd-board-del').addEventListener('click', () => { root.querySelector('#pkd-board-confirm').hidden = false; });
      root.querySelector('#pkd-board-del2').addEventListener('click', () => {
        state.boards = state.boards.filter(x => x.id !== b.id);
        state.active = state.boards[0].id;
        save(); closeModal(); render();
      });
    });
  }

  // ── Account UI ───────────────────────────────────────────────────
  // Rendered twice: in the topbar (#pk-account, always visible) and inside My Dashboard (#pkd-account, with the
  // "saved in this browser" note since that page is where layouts live). Both call the same sign-in modal.
  function renderAccount() {
    const A = window.PKAccount;
    ['pk-account', 'pkd-account'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const note = id === 'pkd-account';
      if (!A || !A.configured) {
        el.innerHTML = note ? '<span class="pkd-acc-note" title="Layouts are kept in this browser until accounts are enabled">Saved in this browser</span>' : '';
        return;
      }
      if (A.user && !note) {
        // the header: a round avatar with the initial, opening the account menu
        const mail = A.user.email || '', ini = (mail.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase();
        el.innerHTML = `<button type="button" class="pk-avatar" id="${id}-btn" aria-haspopup="menu" aria-expanded="false" title="${esc(mail)}"><span class="pk-avatar-c">${esc(ini)}</span><svg class="pk-avatar-chev" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>`;
        el.querySelector(`#${id}-btn`).addEventListener('click', ev => { ev.stopPropagation(); accountMenu(ev.currentTarget); });
        return;
      }
      if (A.user) {
        el.innerHTML = `<span class="pkd-sync" id="pkd-sync"></span><button type="button" class="pk-btn-ghost pkd-acc" id="${id}-btn">${esc(A.user.email || 'Account')}</button>`;
      } else {
        el.innerHTML = `${note ? '<span class="pkd-acc-note">Saved in this browser</span>' : ''}<button type="button" class="pk-btn-ghost pkd-acc" id="${id}-btn">Sign in</button>`;
      }
      el.querySelector(`#${id}-btn`).addEventListener('click', openAccount);
    });
  }

  // The account menu under the avatar: who is signed in, then every personal setting in one place, then sign out
  let menuAdmin = null;
  function accountMenu(btn) {
    const A = window.PKAccount, old = document.getElementById('pk-acc-menu');
    if (old) { old.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    const mail = A.user.email || '', ini = (mail.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase();
    const I = {
      user: '<path d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 7c0-3 2.7-5 6-5s6 2 6 5" />',
      mail: '<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="m3 6 7 5 7-5"/>',
      bell: '<path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 1.5h-13Z"/><path d="M8.5 17.5a1.6 1.6 0 0 0 3 0"/>',
      grid: '<rect x="3" y="3" width="6" height="6" rx="1.2"/><rect x="11" y="3" width="6" height="6" rx="1.2"/><rect x="3" y="11" width="6" height="6" rx="1.2"/><rect x="11" y="11" width="6" height="6" rx="1.2"/>',
      spark: '<path d="M10 2.5 11.6 8.4 17.5 10l-5.9 1.6L10 17.5l-1.6-5.9L2.5 10l5.9-1.6Z"/>',
      shield: '<path d="M10 2.5 16 5v4.5c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V5Z"/><path d="m7.5 10 1.8 1.8L12.8 8"/>',
      out: '<path d="M8 4H4.5v12H8"/><path d="m12 6.5 3.5 3.5L12 13.5M15.5 10H7.5"/>',
      gear: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
      phone: '<rect x="5.5" y="2.5" width="9" height="15" rx="2"/><path d="M9 15h2"/>',
      map: '<path d="M3 5.5 7.5 3.5l5 2 4.5-2v11l-4.5 2-5-2L3 16.5Z"/><path d="M7.5 3.5v11M12.5 5.5v11"/>',
    };
    const ic = k => `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
    const item = (k, label, sub, act) => `<button type="button" role="menuitem" class="pk-am-i" data-act="${act}">${ic(k)}<span><b>${label}</b><small>${sub}</small></span></button>`;
    const m = document.createElement('div');
    m.id = 'pk-acc-menu'; m.className = 'pk-acc-menu'; m.setAttribute('role', 'menu');
    m.innerHTML = `<div class="pk-am-head"><span class="pk-avatar-c pk-am-av">${esc(ini)}</span><span><b>${esc(mail)}</b><small id="pk-am-role">Member</small></span></div>
      ${item('gear', 'Settings', 'Subjects, newsletter, alerts, display', 'settings')}
      ${item('mail', 'My newsletter', 'Editions, subjects, address', 'letter')}
      ${item('bell', 'My alerts', 'Prices, forwards, peak days', 'alerts')}
      ${item('grid', 'My dashboards', 'Your own pages of charts', 'boards')}
      ${item('spark', 'Connector for Claude', 'PowerKlock inside your Claude', 'mcp')}
      <div class="pk-am-sep"></div>
      ${item('user', 'My account', 'Password, delete the account', 'account')}
      ${item('map', 'Guided tour', 'Where to find everything, in one minute', 'tour')}
      ${item('phone', 'PowerKlock on your phone', 'The app: open it, install it on the home screen', 'app')}
      <div id="pk-am-admin"></div>
      <div class="pk-am-sep"></div>
      ${item('out', 'Sign out', '', 'out')}`;
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.top = (r.bottom + 8) + 'px';
    m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    const close = () => { m.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', away, true); document.removeEventListener('keydown', esc_); };
    const away = e => { if (!m.contains(e.target) && !btn.contains(e.target)) close(); };
    const esc_ = e => { if (e.key === 'Escape') { close(); btn.focus(); } };
    setTimeout(() => document.addEventListener('click', away, true), 0);
    document.addEventListener('keydown', esc_);
    const scrollTo = sel => setTimeout(() => { const t = document.querySelector(sel); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 350);
    const go = {
      settings: () => { if (window.PKSetup) PKSetup.settings('subjects'); },
      letter: () => { if (window.PKSetup) PKSetup.settings('newsletter'); },
      alerts: () => { if (window.PKSetup) PKSetup.settings('alerts'); else if (window.PKAlerts) PKAlerts.open(); },
      tour: () => { if (window.PKTour) PKTour.start(); },
      app: () => { if (window.PKApp) { PKApp.open('today'); if (!(matchMedia && matchMedia('(display-mode: standalone)').matches)) setTimeout(() => PKApp.install(), 500); } },
      boards: () => { location.hash = '#dashboards'; },
      mcp: () => { openAccount(); scrollTo('#pkd-mcp'); },
      account: () => openAccount(),
      admin: () => { openAccount(); scrollTo('#pkd-admin'); },
      out: () => A.signOut().then(() => { renderAccount(); toast('Signed out'); }),
    };
    m.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; close(); (go[b.dataset.act] || (() => {}))(); });
    // the administrator also gets the accounts to approve
    const showAdmin = on => { if (!on) return; const h = m.querySelector('#pk-am-admin'); if (h) h.innerHTML = item('shield', 'Accounts to approve', 'New members, access', 'admin'); const ro = m.querySelector('#pk-am-role'); if (ro) ro.textContent = 'Administrator'; };
    if (menuAdmin !== null) showAdmin(menuAdmin);
    else if (A.client && A.client()) A.client().rpc('is_news_admin').then(({ data }) => { menuAdmin = !!data; showAdmin(menuAdmin); });
    const first = m.querySelector('.pk-am-i'); if (first) first.focus({ preventScroll: true });
  }

  function openAccount(hint) {
    const A = window.PKAccount;
    if (typeof hint !== 'string') hint = '';
    if (A.user) {
      modal(`
        <div class="pkd-modal-head"><div><div class="pkd-modal-title">Account</div><div class="pkd-modal-sub">${esc(A.user.email || '')}</div></div>
          <button class="pkd-ic" data-close type="button" title="Close">✕</button></div>
        <div class="pkd-form"><p class="pkd-p">Your dashboards are saved to this account and follow you on every device. You stay signed in on this browser until you sign out.</p>
          <form id="pkd-pw-form" class="pkd-pw"><input type="email" name="username" autocomplete="username" value="${esc(A.user.email || '')}" hidden>
            <label class="pkd-field"><span>Password: sign in with it next time, no e-mail needed</span>
            <input id="pkd-pw" name="new-password" type="password" minlength="10" autocomplete="new-password" placeholder="10 characters or more"></label>
            <button type="submit" class="pk-btn-ghost">Set password</button></form>
          <div class="pkd-msg" id="pkd-pw-msg" role="status">${hint ? esc(hint) : ''}</div>
          <div id="pkd-mcp"></div>
          <div id="pkd-admin"></div>
          <details class="pkd-del"><summary>Delete my account</summary>
            <p class="pkd-p">Your account and everything it holds are erased for good: dashboards, alerts, newsletter settings, keywords, the connector for Claude. This cannot be undone.</p>
            <button type="button" class="pkd-del-go" id="pkd-del-go">Delete my account for good</button>
            <div class="pkd-msg" id="pkd-del-msg" role="status"></div></details>
          <div class="pkd-form-foot"><button type="button" class="pk-btn-ghost" data-close>Close</button><button type="button" class="pk-btn-primary" id="pkd-out">Sign out</button></div></div>`, root => {
        // « Delete my account » (warehouse migration 037): a second click confirms; the site's administrators are refused
        root.querySelector('#pkd-del-go').addEventListener('click', ev => {
          const b = ev.currentTarget, m = root.querySelector('#pkd-del-msg');
          if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Click again to confirm'; return; }
          b.disabled = true; m.textContent = 'Deleting…';
          A.client().rpc('delete_my_account').then(({ data, error }) => {
            if (error || !data || !data.ok) {
              b.disabled = false;
              m.textContent = data && data.reason === 'admin' ? 'An administrator account cannot delete itself here.' : 'Not deleted.';
              if (error && error.message) m.append(' ' + error.message);
              return;
            }
            try { localStorage.removeItem('pk-last-email'); localStorage.removeItem('pk-approved'); } catch (_) {}
            A.signOut().finally(() => { closeModal(); renderAccount(); toast('Account deleted'); });
          });
        });
        root.querySelector('#pkd-out').addEventListener('click', () => { A.signOut().then(() => { closeModal(); renderAccount(); toast('Signed out'); }); });
        root.querySelector('#pkd-pw-form').addEventListener('submit', ev => {
          ev.preventDefault();
          const pw = root.querySelector('#pkd-pw').value, msg = root.querySelector('#pkd-pw-msg');
          if (pw.length < 10) { msg.textContent = 'At least 10 characters.'; return; }
          A.setPassword(pw).then(() => { msg.textContent = 'Password set: next time, sign in with your e-mail and this password.'; root.querySelector('#pkd-pw').value = ''; })
            .catch(e => { msg.textContent = 'Not saved: ' + (e.message || e); });
        });
        if (hint) setTimeout(() => root.querySelector('#pkd-pw').focus(), 30);
        adminAccounts(root.querySelector('#pkd-admin'));
        mcpConnector(root.querySelector('#pkd-mcp'));
      });
      return;
    }
    authModal('in');
  }

  // Sign in, create an account, forgotten password: one classic card, one step at a time. An account is an e-mail and a
  // password; the e-mail only confirms the address (a link back to the site). A forgotten password: a link by e-mail,
  // back on the site with ?pk=reset, where the new password is chosen (view 'pw'). Google shows once the provider is on.
  function authModal(view, email, kind) {
    const A = window.PKAccount;
    let last = email || '';
    if (!last) { try { last = localStorage.getItem('pk-last-email') || ''; } catch (_) {} }
    const remember = e => { try { localStorage.setItem('pk-last-email', e); } catch (_) {} };
    const eye = `<button type="button" class="pkd-eye" data-eye title="Show the password" aria-label="Show the password">👁</button>`;
    const google = `<div class="pkd-google" id="pkd-google" hidden><button type="button" class="pkd-auth-btn pkd-auth-google" id="pkd-google-go"><svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg><span>Continue with Google</span></button>
        <div class="pkd-or"><span>or with your e-mail</span></div></div>`;
    const mail = `<label class="pkd-field"><span>E-mail address</span><input id="pkd-in-email" name="username" type="email" required autocomplete="username" placeholder="you@company.com" value="${esc(last)}"></label>`;
    const V = {
      in: { title: 'Sign in', sub: 'Welcome back to PowerKlock.', body: google + mail +
        `<label class="pkd-field"><span class="pkd-field-row">Password<button type="button" class="pkd-link" data-go="forgot">Forgot password?</button></span>
          <span class="pkd-pw-wrap"><input id="pkd-in-pw" name="password" type="password" required autocomplete="current-password">${eye}</span></label>`,
        btn: 'Sign in', foot: `New to PowerKlock? <button type="button" class="pkd-link" data-go="up">Create an account</button>` },
      up: { title: 'Create an account', sub: 'Free. Once your address is confirmed, your access opens after approval.', body: google + mail +
        `<label class="pkd-field"><span>Password</span>
          <span class="pkd-pw-wrap"><input id="pkd-up-pw" name="new-password" type="password" required minlength="8" autocomplete="new-password" placeholder="8 characters or more">${eye}</span></label>`,
        btn: 'Create my account', foot: `Already have an account? <button type="button" class="pkd-link" data-go="in">Sign in</button>` },
      forgot: { title: 'Reset your password', sub: 'Type your e-mail address: we send you a link to choose a new password.', body: mail,
        btn: 'Send the link', foot: `<button type="button" class="pkd-link" data-go="in">Back to sign in</button>` },
      sent: { title: 'Check your inbox', sub: kind === 'reset' ? 'We sent a link to choose a new password to:' : 'To finish, confirm your address with the link we sent to:',
        body: `<div class="pkd-auth-to">${esc(last)}</div><p class="pkd-auth-note">Nothing after a few minutes? Look in your spam folder.</p>`,
        btn: kind === 'reset' ? 'Send the link again' : 'Send the e-mail again', foot: `<button type="button" class="pkd-link" data-go="in">Back to sign in</button>` },
      pw: { title: 'Choose a new password', sub: 'You will sign in with your e-mail and this password.', body: `<input type="email" name="username" autocomplete="username" value="${esc(last)}" hidden>
        <label class="pkd-field"><span>New password</span><span class="pkd-pw-wrap"><input id="pkd-new-pw" name="new-password" type="password" minlength="8" required autocomplete="new-password" placeholder="8 characters or more">${eye}</span></label>`,
        btn: 'Save the password', foot: '' },
    }[view];
    modal(`
      <div class="pkd-auth">
        <button class="pkd-ic pkd-auth-x" data-close type="button" title="Close">✕</button>
        <img class="pkd-auth-logo" src="assets/logo-header.png" alt="PowerKlock" translate="no">
        <div class="pkd-auth-title">${V.title}</div>
        <div class="pkd-auth-sub">${V.sub}</div>
        <form class="pkd-auth-form" id="pkd-auth-form" novalidate>${V.body}
          <div class="pkd-msg" id="pkd-in-msg" role="status"></div>
          <button type="submit" class="pkd-auth-btn pkd-auth-main" id="pkd-in-go">${V.btn}</button>
        </form>
        ${V.foot ? `<div class="pkd-auth-foot">${V.foot}</div>` : ''}
        <a class="pkd-auth-privacy" href="privacy.html" target="_blank" rel="noopener">Privacy</a>
      </div>`, root => {
      root.classList.add('pkd-modal-auth');
      const msg = root.querySelector('#pkd-in-msg'), go = root.querySelector('#pkd-in-go');
      const fail = (t, e) => { msg.textContent = ''; const x = document.createElement('span'); x.textContent = t; msg.append(x); if (e) msg.append(' ' + (e.message || e)); msg.className = 'pkd-msg pkd-msg-err'; go.disabled = false; };
      const ok = t => { msg.textContent = t; msg.className = 'pkd-msg pkd-msg-ok'; go.disabled = false; };
      const busy = t => { msg.className = 'pkd-msg'; msg.textContent = t; go.disabled = true; };
      const mailOk = () => { const el = root.querySelector('#pkd-in-email'); if (el && el.value.trim() && el.checkValidity()) return el.value.trim(); fail('Type a valid e-mail address.'); if (el) el.focus(); return ''; };
      const pwOk = id => { const el = root.querySelector(id), v = el ? el.value : ''; if (v.length >= 8) return v; fail(v ? 'The password needs 8 characters or more.' : 'Type a password.'); if (el) el.focus(); return ''; };
      root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { const el = root.querySelector('#pkd-in-email'); authModal(b.dataset.go, (el && el.value.trim()) || last); }));
      root.querySelectorAll('[data-eye]').forEach(b => b.addEventListener('click', () => { const i = b.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; i.focus(); }));
      root.querySelector('#pkd-auth-form').addEventListener('submit', ev => {
        ev.preventDefault();
        if (view === 'in') {
          const e = mailOk(); if (!e) return;
          const pw = root.querySelector('#pkd-in-pw').value;
          if (!pw) { fail('Type your password.'); root.querySelector('#pkd-in-pw').focus(); return; }
          remember(e); busy('Signing in…');
          A.signInPassword(e, pw).then(() => { closeModal(); renderAccount(); toast('Signed in'); }).catch(x => {
            if (/confirm/i.test(x && x.message || '')) { fail('Your address is not confirmed yet: click the link in the e-mail we sent you.'); return; }
            fail('Wrong e-mail or password. First time here with a password? Use « Forgot password? » to choose one.');
          });
        } else if (view === 'up') {
          const e = mailOk(); if (!e) return; const pw = pwOk('#pkd-up-pw'); if (!pw) return;
          remember(e); busy('Creating the account…');
          A.signUp(e, pw).then(r => {
            if (r.exists) { fail('This address already has an account: sign in, or use « Forgot password? ».'); return; }
            if (r.session) { closeModal(); renderAccount(); toast('Account created'); return; }
            authModal('sent', e, 'confirm');
          }).catch(x => fail('The account was not created.', x));
        } else if (view === 'forgot') {
          const e = mailOk(); if (!e) return;
          remember(e); busy('Sending…');
          A.resetPassword(e).then(() => authModal('sent', e, 'reset')).catch(x => fail('The e-mail could not be sent.', x));
        } else if (view === 'sent') {
          busy('Sending…');
          (kind === 'reset' ? A.resetPassword(last) : A.resendConfirm(last)).then(() => ok('Sent again.')).catch(x => fail('The e-mail could not be sent.', x));
        } else if (view === 'pw') {
          const pw = pwOk('#pkd-new-pw'); if (!pw) return;
          busy('Saving…');
          A.setPassword(pw).then(() => { try { sessionStorage.removeItem('pk-reset'); } catch (_) {} closeModal(); renderAccount(); toast('Password saved'); }).catch(x => fail('Not saved.', x));
        }
      });
      const gg = root.querySelector('#pkd-google-go');
      if (gg) {
        gg.addEventListener('click', () => { busy('Opening Google…'); A.signInGoogle().catch(x => fail('Google sign-in failed.', x)); });
        if (A.googleEnabled) A.googleEnabled().then(on => { const g = root.querySelector('#pkd-google'); if (g) g.hidden = !on; });
      }
      const first = { in: last ? '#pkd-in-pw' : '#pkd-in-email', up: last ? '#pkd-up-pw' : '#pkd-in-email', forgot: '#pkd-in-email', pw: '#pkd-new-pw' }[view];
      setTimeout(() => { const f = first && root.querySelector(first); if (f) f.focus(); }, 30);
    });
  }

  // The connector for Claude (workers/mcp, warehouse migration 033): a personal link to add PowerKlock to one's Claude;
  // made by the database, shown once, only its fingerprint kept; a new link replaces the old one
  const MCP_URL = 'https://powerklock-mcp.tom-s-remy.workers.dev/mcp/';
  async function mcpConnector(host) {
    const A = window.PKAccount, cl = A.client && A.client();
    if (!host || !cl) return;
    const { data: st, error } = await cl.rpc('mcp_status');
    if (error) return;   // not approved yet, or the database is not ready: nothing to show
    const how = open => `<details class="pkd-mcp-guide"${open ? ' open' : ''}><summary>How to add PowerKlock to Claude</summary><p class="pkd-p">What you need: a paid Claude plan (Pro, Max, Team or Enterprise) and your approved PowerKlock account.</p><div class="pkd-mcp-h">On a computer</div><ol class="pkd-mcp-how"><li>Make your link below, then Copy it.</li><li>On claude.ai: Settings › Connectors › Add custom connector.</li><li>Name: PowerKlock. URL: paste your link. Then Add.</li><li>In a conversation, turn PowerKlock on in the tools menu (the « + » or sliders button under the message box).</li></ol><p class="pkd-p">On a phone: add the connector once on claude.ai in the phone’s browser (the app may not offer it yet); it then works in the Claude app too.</p><div class="pkd-mcp-h">To try</div><ul class="pkd-mcp-how"><li>« What was the average French spot price this week, and why? »</li><li>« The open consultations on grid connection, with their deadlines »</li><li>« Solar capture rate in France, 2025 against 2024, month by month »</li><li>« Everything said about negative prices since October »</li></ul><div class="pkd-mcp-h">If it does not work</div><ul class="pkd-mcp-how"><li>« Link not valid »: make a new link here and replace it in Claude (Settings › Connectors).</li><li>Your link is personal: keep it to yourself; a new link cancels the old one. 400 calls a day.</li></ul></details>`;
    const draw = (link) => {
      host.innerHTML = `<div class="pkd-mcp"><div class="pkd-acc-t">Connector for Claude</div>
        <p class="pkd-p">Add PowerKlock to your own Claude (paid plan): Claude then reads the site's prices, forwards, reservoirs, guarantees of origin, news, official texts and consultations, and queries the SQL warehouse (full history), answering with their sources. Read only, 400 calls a day.</p>
        ${link ? `<div class="pkd-mcp-link"><input type="text" readonly value="${esc(link)}" aria-label="Your personal link"><button type="button" class="pk-btn-primary" id="pkd-mcp-copy">Copy</button></div>
          <p class="pkd-p pkd-mcp-warn">Personal link: shown only now, keep it to yourself. A new link cancels this one.</p>`
        : st && st.active ? `<p class="pkd-p">Your link is active since ${esc(String(st.created_at || '').slice(0, 10))}.</p>` : ''}
        <div class="pkd-mcp-b"><button type="button" class="pk-btn-ghost" id="pkd-mcp-new">${st && st.active ? 'Make a new link' : 'Make my link'}</button>${st && st.active ? '<button type="button" class="pk-btn-ghost" id="pkd-mcp-del">Remove my link</button>' : ''}</div>
        <div class="pkd-msg" id="pkd-mcp-msg" role="status"></div>${how(!!link)}</div>`;
      const msg = host.querySelector('#pkd-mcp-msg');
      const cp = host.querySelector('#pkd-mcp-copy'); if (cp) cp.addEventListener('click', () => { const i = host.querySelector('.pkd-mcp-link input'); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => { msg.textContent = 'Copied.'; }).catch(() => { document.execCommand('copy'); msg.textContent = 'Copied.'; }); });
      host.querySelector('#pkd-mcp-new').addEventListener('click', async () => {
        if (st && st.active && !window.confirm('A new link cancels the current one in Claude. Go on?')) return;
        const { data: t, error: e } = await cl.rpc('mcp_new');
        if (e || !t) { msg.textContent = 'Not made: ' + ((e && e.message) || 'try again'); return; }
        st.active = true; st.created_at = new Date().toISOString(); draw(MCP_URL + t);
      });
      const del = host.querySelector('#pkd-mcp-del'); if (del) del.addEventListener('click', async () => {
        if (!window.confirm('Remove your link? Claude will no longer reach PowerKlock.')) return;
        const { error: e } = await cl.rpc('mcp_revoke'); if (e) { msg.textContent = 'Not removed: ' + e.message; return; }
        st.active = false; draw(null);
      });
    };
    draw(null);
  }

  // Accounts, for the admin (public.news_admin): approve a new account, refuse it, close or reopen one
  // (public.user_access, warehouse migration 022: the admin may read and update every row). Closing keeps the account's
  // data; it only takes the site and the newsletter away.
  const SECS = [['dashboards', 'My dashboards'], ['markets', 'Markets'], ['renewables', 'Renewables'], ['power-system', 'Power system'], ['tools', 'Tools'], ['intelligence', 'Intelligence'], ['games', 'Games']];
  async function adminAccounts(host) {
    const A = window.PKAccount, cl = A.client && A.client();
    if (!host || !cl) return;
    const { data: isAdmin } = await cl.rpc('is_news_admin');
    if (!isAdmin) return;
    const draw = async () => {
      let { data, error } = await cl.from('user_access').select('user_id, email, status, requested_at, sections').order('requested_at', { ascending: false });
      if (error && /sections/.test(error.message)) ({ data, error } = await cl.from('user_access').select('user_id, email, status, requested_at').order('requested_at', { ascending: false }));
      if (error) { host.innerHTML = `<p class="pkd-p">Accounts not read: ${esc(error.message)}</p>`; return; }
      const lab = { pending: 'Waiting', approved: 'Approved', refused: 'Closed' };
      const btn = (r, to, txt, cls) => `<button type="button" class="${cls}" data-u="${r.user_id}" data-s="${to}">${txt}</button>`;
      host.innerHTML = `<div class="pkd-acc"><div class="pkd-acc-t">Accounts (admin) · ${data.filter(r => r.status === 'pending').length} waiting</div>` +
        data.map(r => `<div class="pkd-acc-r"><span class="pkd-acc-e">${esc(r.email || '')}<small>${lab[r.status] || r.status} · ${esc(String(r.requested_at || '').slice(0, 10))}</small></span>
          <span class="pkd-acc-b">${r.status !== 'approved' ? btn(r, 'approved', 'Approve', 'pk-btn-primary') : ''}${r.status === 'pending' ? btn(r, 'refused', 'Refuse', 'pk-btn-ghost') : ''}${r.status === 'approved' && r.user_id !== A.user.id ? btn(r, 'refused', 'Close', 'pk-btn-ghost') : ''}</span></div>` +
          (r.status === 'approved' && r.user_id !== A.user.id && 'sections' in r ? `<details class="pkd-acc-s"><summary>Access: ${r.sections ? r.sections.length + ' of ' + SECS.length + ' sections' : 'whole site'}</summary>
            <div>${SECS.map(([k, l]) => `<label><input type="checkbox" data-sec="${k}" data-uid="${r.user_id}"${!r.sections || r.sections.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</div>
            <small>Today is always shown. Untick a section to hide it from this account.</small></details>` : '')).join('') + '</div>';
      host.querySelectorAll('[data-sec]').forEach(cb => cb.addEventListener('change', async () => {
        const boxes = [...host.querySelectorAll('[data-uid="' + cb.dataset.uid + '"]')], on = boxes.filter(x => x.checked).map(x => x.dataset.sec);
        const { error: e } = await cl.from('user_access').update({ sections: on.length === SECS.length ? null : on }).eq('user_id', cb.dataset.uid);
        if (e) { toast('Not saved: ' + e.message); cb.checked = !cb.checked; return; }
        toast('Access saved');
      }));
      host.querySelectorAll('[data-u]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        const { error: e } = await cl.from('user_access').update({ status: b.dataset.s, decided_at: new Date().toISOString() }).eq('user_id', b.dataset.u);
        if (e) { toast('Not saved: ' + e.message); b.disabled = false; return; }
        draw();
      }));
    };
    draw();
  }

  // ── Modal shell ──────────────────────────────────────────────────
  function modal(html, wire) {
    closeModal();
    const bg = document.createElement('div');
    bg.id = 'pkd-modal';
    bg.innerHTML = `<div class="pkd-modal" role="dialog" aria-modal="true">${html}</div>`;
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeModal(); });
    document.body.appendChild(bg);
    document.addEventListener('keydown', escClose);
    if (wire) wire(bg.querySelector('.pkd-modal'));
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    const m = document.getElementById('pkd-modal');
    if (m) m.remove();
    document.removeEventListener('keydown', escClose);
    // Catalogue adds are batched: redraw the grid once when it closes.
    if (isOpen() && grid && grid.engine.nodes.length !== board().items.length) render();
  }

  // ── Sharing ──────────────────────────────────────────────────────
  // The link carries the layout itself (charts, parameters, sections,
  // notes), compressed in the address after "#": no account or server
  // needed, and the charts show the data of the day the link is opened.
  const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  // fresh ids for a copied layout, the cards of a collapsed section still pointing to it
  function reid(items) {
    const m = {}; const out = items.map(it => { const n = uid(); if (it.i) m[it.i] = n; return Object.assign({}, it, { i: n }); });
    out.forEach(it => { if (it.hid) { if (m[it.hid]) it.hid = m[it.hid]; else { delete it.hid; delete it.cy; } } });
    return out;
  }
  function boardData(b) {
    const used = new Set(b.items.map(it => it.hid).filter(Boolean));   // ids kept only where a collapsed section needs them
    const items = b.items.map(it => { const o = Object.assign({}, it); if (!used.has(o.i)) delete o.i; return o; });
    return { n: b.name, d: b.desc || suggestDesc(b) || undefined, g: b.grid, m: b.mirror || undefined, items };
  }
  async function encodeBoard(b) {
    const raw = new TextEncoder().encode(JSON.stringify(boardData(b)));
    if (window.CompressionStream) { try { return 'z' + b64u(await pipe(raw, new CompressionStream('deflate-raw'))); } catch (_) {} }
    return 'j' + b64u(raw);
  }
  function boardFromData(j, code) {
    if (!j || !Array.isArray(j.items)) throw new Error('not a dashboard');
    return { id: 'shared', name: String(j.n || 'Shared dashboard').slice(0, 40), desc: String(j.d || '').slice(0, 400), code, grid: j.g === FINE ? FINE : undefined, mirror: MIRRORS[j.m] ? j.m : undefined,
      items: reid(j.items.filter(it => it && ['w', 's', 'n'].includes(it.t))) };
  }
  async function decodeBoard(code) {
    const bytes = unb64u(code.slice(1));
    const raw = code[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
    return boardFromData(JSON.parse(new TextDecoder().decode(raw)), code);
  }
  const baseUrl = () => location.origin + location.pathname;

  // The "dashboard only" link can instead point at a row kept in Supabase (id prefixed "r"), so it can be
  // republished later without changing the link. b.share = { id, token } is created once per board and kept
  // with it; the token never leaves this browser (except to Supabase, which needs it to check a republish).
  async function ensureShare(b) {
    if (b.share && b.share.id && b.share.token) return b.share;
    if (!(window.PKAccount && PKAccount.configured)) return null;
    try {
      const { id, token } = await PKAccount.sharedCreate(boardData(b));
      b.share = { id, token };
      save();
      return b.share;
    } catch (e) { console.warn('[PKDash] shared board create', e); return null; }
  }

  async function openShare() {
    const b = board();
    const code = shared ? shared.code : await encodeBoard(b);
    const link = baseUrl() + '#board=' + code;
    const share = shared ? null : await ensureShare(b);
    const solo = share ? baseUrl() + '#solo=r' + share.id : baseUrl() + '#solo=' + code;
    modal(`
      <div class="pkd-modal-head"><div><div class="pkd-modal-title">Share “${esc(b.name)}”</div>
        <div class="pkd-modal-sub">The link carries the layout: whoever opens it sees the same charts with the latest data. No account needed. Later changes to your dashboard are not in a link already sent: share again.</div></div>
        <button class="pkd-ic" data-close type="button" title="Close">✕</button></div>
      <div class="pkd-form">
        <div class="pkd-share-row"><div class="pkd-share-t"><b>Link to the dashboard</b><em>Opens PowerKlock on this dashboard; your colleague can add it to theirs.</em></div>
          <div class="pkd-share-l"><input type="text" readonly value="${esc(link)}" aria-label="Link to the dashboard"><button type="button" class="pk-btn-primary" data-copy="${esc(link)}">Copy</button></div></div>
        <div class="pkd-share-row"><div class="pkd-share-t"><b>Dashboard only</b><em>The dashboard alone, without the menus: for a meeting-room screen or a quick read on a phone.</em></div>
          <div class="pkd-share-l"><input type="text" readonly value="${esc(solo)}" aria-label="Link to the dashboard only"><button type="button" class="pk-btn-primary" data-copy="${esc(solo)}">Copy</button>
          <a class="pk-btn-ghost" href="${esc(solo)}" target="_blank" rel="noopener">Open ↗</a></div>
          ${share ? `<div class="pkd-share-repub"><em>The link stays the same: this sends it today's layout.</em><button type="button" class="pk-btn-ghost" id="pkd-share-republish">Republish</button></div>` : ''}</div>
        <div class="pkd-form-foot"><button type="button" class="pk-btn-ghost" data-close>Close</button></div>
      </div>`, root => {
      root.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', () => {
        const inp = btn.parentElement.querySelector('input');
        const done = () => { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = 'Copy'; }, 1800); };
        (navigator.clipboard ? navigator.clipboard.writeText(btn.dataset.copy) : Promise.reject()).then(done).catch(() => { inp.select(); try { document.execCommand('copy'); done(); } catch (_) {} });
      }));
      root.querySelectorAll('.pkd-share-l input').forEach(i => i.addEventListener('focus', () => i.select()));
      root.querySelector('#pkd-share-republish')?.addEventListener('click', async ev => {
        const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Republishing…';
        try {
          const ok = await PKAccount.sharedUpdate(share.id, share.token, boardData(b));
          btn.textContent = ok ? 'Republished ✓' : 'Could not republish';
        } catch (e) { console.warn(e); btn.textContent = 'Could not republish'; }
        setTimeout(() => { btn.textContent = 'Republish'; btn.disabled = false; }, 1800);
      });
    });
  }

  // same switch as Today's "Explain" (body.mrn-explain, css/site.css): widgets built from Today's own
  // code (e.g. the today-tiles widget) already carry the same hidden .mrn-x lines and light up with it.
  // Bound on both the normal toolbar button and the solo-view bar's own button (solo hides .pkd-top).
  function bindExplain(btn) {
    if (!btn || btn.dataset.xw) return; btn.dataset.xw = '1';
    const setX = on => {
      document.body.classList.toggle('mrn-explain', on);
      document.querySelectorAll('#pkd-explain, #pkd-solo-explain').forEach(b => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      try { localStorage.setItem('pk-explain', on ? '1' : '0'); } catch (_) {}
    };
    let on; try { on = localStorage.getItem('pk-explain') === '1'; } catch (_) { on = false; }
    setX(on);
    btn.addEventListener('click', () => setX(!document.body.classList.contains('mrn-explain')));
  }

  function renderShared() {
    const page = document.getElementById('page-mydash');
    if (!page) return;
    page.classList.toggle('pkd-viewing', !!shared);
    let bar = document.getElementById('pkd-shared-bar');
    if (!shared) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'pkd-shared-bar'; bar.className = 'pkd-shared-bar';
      page.querySelector('.pkd-top').after(bar);
    }
    const solo = document.body.classList.contains('pk-solo');
    const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
    bar.innerHTML = solo
      ? `<div class="pkd-solo-t"><span class="pkd-solo-name">${esc(shared.name)}</span><span class="pkd-solo-date">${esc(date)}</span></div>
         <button type="button" class="pk-btn-ghost" id="pkd-solo-explain" aria-pressed="false" title="Show a line under each figure on what it is and why it moves">ⓘ Explain</button>
         <button type="button" class="pk-btn-ghost" id="pkd-solo-pptx" title="This dashboard as a PowerPoint">⤓ PowerPoint</button>`
      : `<div class="pkd-shared-t"><b>Shared dashboard · ${esc(shared.name)}</b><span>A copy of a colleague's layout with today's data. Add it to your dashboards to keep or change it.</span></div>
         <div class="pkd-shared-a"><button type="button" class="pk-btn-ghost" id="pkd-shared-close">Close</button><button type="button" class="pk-btn-primary" id="pkd-shared-add">+ Add to my dashboards</button></div>`;
    bindExplain(bar.querySelector('#pkd-solo-explain'));
    bar.querySelector('#pkd-solo-pptx')?.addEventListener('click', async ev => {
      const btn = ev.currentTarget, label = btn.textContent; if (!window.PKExport) return;
      btn.disabled = true;
      try { const name = await PKExport.open(shared, (k, n) => { btn.textContent = 'Exporting ' + k + '/' + n + '…'; }); if (name) toast('Downloaded ' + name); }
      catch (e) { console.warn(e); toast('Export failed: ' + (e.message || e)); }
      btn.disabled = false; btn.textContent = label;
    });
    bar.querySelector('#pkd-shared-add')?.addEventListener('click', () => {
      const id = uid();
      state.boards.push({ id, name: shared.name, desc: shared.desc || '', grid: shared.grid, mirror: shared.mirror, items: reid(shared.items) });
      state.active = id;
      closeShared(false); save(); render();
      toast('Added to your dashboards');
    });
    bar.querySelector('#pkd-shared-close')?.addEventListener('click', () => closeShared(true));
  }

  function closeShared(redraw) {
    shared = null;
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    if (redraw) render();
  }

  // A shared dashboard is a closed room: no link leads to another page of the site. Links inside the site lose their
  // address (the tiles still open their chart in the window, which stays on the dashboard); links to articles elsewhere
  // keep opening in a new tab. Done on everything drawn later too, and any click on an internal address is stopped.
  function sealLinks() {
    const seal = root => root.querySelectorAll('a[href^="#"], [data-route]').forEach(a => {
      a.removeAttribute('data-route');
      if (a.tagName === 'A' && /^#/.test(a.getAttribute('href') || '')) { a.removeAttribute('href'); a.classList.add('pk-sealed'); }
    });
    seal(document);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) seal(n.parentNode || n); }))).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a');
      if (a && (a.classList.contains('pk-sealed') || /^#/.test(a.getAttribute('href') || '')) && !a.closest('.mrn2-tile, .mrn-wrow')) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('hashchange', () => { if (!/^#solo=/.test(location.hash)) history.back(); });   // no way out by the address either
  }

  // ── A shared widget alone (index.html?bare#solo=…): its figure, its change and a small line, nothing else, on a transparent
  // ground, to sit in a small iframe on another site. &w=2 takes the dashboard's second widget; &theme=light|dark sets the text colours.
  function sparkSVG(vals, tone) {
    const v = (vals || []).map(x => x && typeof x === 'object' ? x.y : x).filter(x => x != null && isFinite(x));
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), k = hi - lo || 1;
    const pts = v.map((x, i) => (i / (v.length - 1) * 100).toFixed(2) + ',' + (96 - (x - lo) / k * 92).toFixed(2)).join(' ');   // straight lines between the points
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" class="pkb-l ${tone || ''}" vector-effect="non-scaling-stroke"/></svg>`;
  }
  async function bareView(b) {
    const n = Math.max(1, parseInt((location.search.match(/[?&]w=(\d+)/) || [])[1], 10) || 1);
    const it = b.items.filter(x => x.t === 'w')[n - 1], w = it && PKW.get(it.wid);
    const host = document.createElement('div'); host.id = 'pk-bare'; document.body.appendChild(host);
    if (!w) { host.innerHTML = '<div class="pkb-v">–</div>'; return; }
    const p = PKW.params(w.id, it.p);
    const out = o => {
      host.innerHTML = `<div class="pkb-v">${esc(o.value)}<span class="pkb-u">${esc((o.unit || '').trim())}</span></div>` +
        (o.chg ? `<div class="pkb-c ${o.tone || ''}">${esc(o.chg)}</div>` : '') + `<div class="pkb-s">${sparkSVG(o.spark, o.tone)}</div>`;
      document.body.dataset.bareReady = '1';
    };
    if (w.kind === 'html') {
      const src = document.createElement('div'); src.className = 'pkb-src';
      try { await w.html(src, p); } catch (e) { console.warn(e); }
      if (src._bare) return out(src._bare);
      host.classList.add('pkb-html'); host.appendChild(src); document.body.dataset.bareReady = '1'; return;   // a widget with no single figure: shown as it is
    }
    // a chart: drawn off screen, then its first line gives the last value, its change and the small line
    const off = document.createElement('div'); off.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:320px';
    off.innerHTML = '<canvas id="pkb-cv"></canvas>'; document.body.appendChild(off);
    await PKW.draw(w.id, 'pkb-cv', p);
    const ch = window.Chart && Chart.getChart(document.getElementById('pkb-cv')), ds = ch && ch.data.datasets[0];
    const vals = ds ? ds.data.map(x => x && typeof x === 'object' ? x.y : x) : [];
    let i = vals.length - 1; while (i >= 0 && (vals[i] == null || !isFinite(vals[i]))) i--;
    if (i < 0) { off.remove(); return out({ value: '–' }); }
    const v = vals[i]; let j = i - 1; while (j >= 0 && (vals[j] == null || vals[j] === v) && j > i - 8) j--;   // the last different value
    const pv = j >= 0 && vals[j] != null ? vals[j] : null, d = pv == null ? null : v - pv;
    const yt = ch.options && ch.options.scales && ch.options.scales.y && ch.options.scales.y.title;
    const sg = x => (x >= 0 ? '+' : '') + x.toFixed(2);
    try { ch.destroy(); } catch (_) {} off.remove();
    out({ value: v.toFixed(2), unit: yt && yt.display !== false && yt.text ? ' ' + yt.text : '',
      chg: d == null ? '' : (d >= 0 ? '▲ ' : '▼ ') + sg(d) + (pv ? ' (' + sg(d / pv * 100) + ' %)' : ''),
      tone: !d ? null : d > 0 ? 'down' : 'up',   // a rise in red, a fall in green
      spark: vals });
  }

  async function openFromLink() {
    const m = location.hash.match(/^#(board|solo)=(r[0-9a-f]+|[zj][A-Za-z0-9_-]+)$/);
    if (!m) return;
    try {
      if (m[2][0] === 'r') {
        if (!(window.PKAccount && PKAccount.configured)) throw new Error('sharing not configured');
        const j = await PKAccount.sharedGet(m[2].slice(1));
        if (!j) throw new Error('not found');
        shared = boardFromData(j, m[2]);
      } else shared = await decodeBoard(m[2]);
    } catch (e) { console.warn('[PKDash] shared link', e); toast('This dashboard link is damaged or incomplete'); return; }
    if (m[1] === 'solo') { document.body.classList.add('pk-solo'); sealLinks(); }
    if (m[1] === 'solo' && document.documentElement.classList.contains('pk-bare')) return bareView(shared);
    const tab = document.querySelector('.nav-tab[data-dash="mydash"]');
    if (typeof switchDashboard === 'function') switchDashboard('mydash', tab);
    else open();
  }

  // ── Boot ─────────────────────────────────────────────────────────
  function init() {
    if (state) return;
    state = readLocal();
    seed();
    writeLocal();
    const page = document.getElementById('page-mydash');
    if (page) {
      document.getElementById('pkd-add')?.addEventListener('click', openCatalog);
      document.getElementById('pkd-add-empty')?.addEventListener('click', openCatalog);
      document.getElementById('pkd-add-sec')?.addEventListener('click', addSection);
      document.getElementById('pkd-edit')?.addEventListener('click', () => setEditing(!editing));
      document.getElementById('pkd-add-note')?.addEventListener('click', addNote);
      document.getElementById('pkd-menu')?.addEventListener('click', openBoardMenu);
      document.getElementById('pkd-share')?.addEventListener('click', openShare);
      bindExplain(document.getElementById('pkd-explain'));
      document.getElementById('pkd-pptx')?.addEventListener('click', async ev => {
        const btn = ev.currentTarget, label = btn.textContent;
        if (!window.PKExport) return;
        btn.disabled = true;
        try {
          const name = await PKExport.open(shared || board(), (k, n) => { btn.textContent = 'Exporting ' + k + '/' + n + '…'; });
          if (name) toast('Downloaded ' + name);
        } catch (e) { console.warn(e); toast('Export failed: ' + (e.message || e)); }
        btn.disabled = false; btn.textContent = label;
      });
    }
    PKW.refreshStars();
    if (/^#(board|solo)=/.test(location.hash)) {
      if (document.readyState === 'complete') openFromLink(); else window.addEventListener('load', () => setTimeout(openFromLink, 50));
    }
    if (window.PKAccount && PKAccount.configured) {
      // Coming back from the e-mail link: open My Dashboard once signed in.
      // back from an e-mail link: ?pk=reset (forgotten password) asks for the new password once signed in, even after the
      // page reloads into the full site (js/gate.js); ?pk=confirmed says the address is confirmed
      const pkq = (location.search.match(/[?&]pk=(reset|confirmed)/) || [])[1];
      if (pkq === 'reset') { try { sessionStorage.setItem('pk-reset', '1'); } catch (_) {} }
      const resetDue = () => { try { return sessionStorage.getItem('pk-reset') === '1'; } catch (_) { return false; } };
      const afterLink = u => {
        if (!u) return;
        if (resetDue()) { authModal('pw', u.email || ''); return; }
        if (pkq === 'confirmed') toast('Address confirmed');
      };
      if (pkq) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (_) {} }
      const fromLink = /access_token=|[?&]code=|error_description=/.test(location.hash + location.search);
      const linkError = (location.hash.match(/error_description=([^&]+)/) || [])[1];
      PKAccount.onChange(u => { renderAccount(); if (u) syncFromCloud(); });
      PKAccount.ready().then(u => {
        renderAccount();
        if (u) syncFromCloud();
        setTimeout(() => afterLink(u), 600);
        if (fromLink) {
          const tab = document.querySelector('.nav-tab[data-dash="mydash"]');
          if (typeof switchDashboard === 'function') switchDashboard('mydash', tab);
          if (linkError) toast('Sign-in link failed: ' + decodeURIComponent(linkError.replace(/\+/g, ' ')));
          else if (u) toast('Signed in as ' + (u.email || ''));
          try { history.replaceState(null, '', location.pathname); } catch (_) {}
        }
      });
    }
  }

  // for the API page: the reader's dashboards and the link that shows one alone (a copy of its layout at that moment)
  function boards() { if (!state) init(); return state.boards.map(b => ({ id: b.id, name: b.name, n: b.items.filter(i => i.t === 'w').length })); }
  async function soloLink(id, site) { if (!state) init(); const b = state.boards.find(x => x.id === id); return b ? (site || baseUrl()) + '#solo=' + await encodeBoard(b) : null; }
  // a card added from another page with its own settings (always a new card, never a toggle)
  function addCard(wid, p) {
    const w = PKW.get(wid), b = board(); if (!w) return;
    b.items.push(Object.assign({ i: uid(), t: 'w', wid, w: w.size.w * FINE, h: w.size.h * FINE }, p ? { p } : {}));
    toast('Added to “' + b.name + '”'); save(); if (isOpen()) render();
  }
  window.PKDash = { select: id => { if (!state) init(); if (state.boards.some(b => b.id === id)) { state.active = id; save(); render(); } }, init, open, refresh, has, toggleWidget, addWidget, addCard, addSection, addNote, TEMPLATES, boards, soloLink, openAccount, openAuth: v => (window.PKAccount && PKAccount.user) ? openAccount() : authModal(v || 'in') };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
