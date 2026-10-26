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
      S('Fundamentals'),
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
    // boards made from the Expert template before it became a mirror (and links shared then) become one
    if (b && b.mirror === undefined && ['today-brief', 'today-fund', 'today-weeks'].every(w => (b.items || []).some(it => it.wid === w))) b.mirror = 'today-expert';
    return b;
  }

  // A mirror board shows a page of the site itself rather than a grid of cards: the Expert view of Today, block for block,
  // at the same sizes, so the dashboard is the page and stays so when Today changes. The page's blocks are moved into the
  // dashboard while it is open and put back as soon as it is left (another board, another page). The cards of the
  // template stay in the board for the PowerPoint export.
  const MIRRORS = {
    'today-expert': { page: 'page-morning', ids: ['mrn2', 'hs-morning-2', 'hs-morning-fund', 'hs-morning-3', 'hs-morning-4', 'hs-morning-fc', 'hs-morning-idx'],
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
  function renderAccount() {
    const el = document.getElementById('pkd-account');
    if (!el) return;
    const A = window.PKAccount;
    if (!A || !A.configured) {
      el.innerHTML = '<span class="pkd-acc-note" title="Layouts are kept in this browser until accounts are enabled">Saved in this browser</span>';
      return;
    }
    if (A.user) {
      el.innerHTML = `<span class="pkd-sync" id="pkd-sync"></span><button type="button" class="pk-btn-ghost pkd-acc" id="pkd-acc-btn" title="Signed in · click to sign out">${esc(A.user.email || 'Account')}</button>`;
      el.querySelector('#pkd-acc-btn').addEventListener('click', openAccount);
    } else {
      el.innerHTML = '<span class="pkd-acc-note">Saved in this browser</span><button type="button" class="pk-btn-ghost pkd-acc" id="pkd-acc-btn">Sign in</button>';
      el.querySelector('#pkd-acc-btn').addEventListener('click', openAccount);
    }
  }

  function openAccount() {
    const A = window.PKAccount;
    if (A.user) {
      modal(`
        <div class="pkd-modal-head"><div><div class="pkd-modal-title">Account</div><div class="pkd-modal-sub">${esc(A.user.email || '')}</div></div>
          <button class="pkd-ic" data-close type="button" title="Close">✕</button></div>
        <div class="pkd-form"><p class="pkd-p">Your dashboards are saved to this account and follow you on every device.</p>
          <div class="pkd-form-foot"><button type="button" class="pk-btn-ghost" data-close>Close</button><button type="button" class="pk-btn-primary" id="pkd-out">Sign out</button></div></div>`, root => {
        root.querySelector('#pkd-out').addEventListener('click', () => { A.signOut().then(() => { closeModal(); renderAccount(); toast('Signed out'); }); });
      });
      return;
    }
    modal(`
      <div class="pkd-modal-head"><div><div class="pkd-modal-title">Sign in</div>
        <div class="pkd-modal-sub">Keep your dashboards on every device. No password: we e-mail you a sign-in link.</div></div>
        <button class="pkd-ic" data-close type="button" title="Close">✕</button></div>
      <form class="pkd-form" id="pkd-in-form">
        <label class="pkd-field"><span>E-mail</span><input id="pkd-in-email" type="email" required autocomplete="email" placeholder="you@company.com"></label>
        <div class="pkd-msg" id="pkd-in-msg" role="status"></div>
        <div class="pkd-form-foot"><button type="button" class="pk-btn-ghost" data-close>Cancel</button><button type="submit" class="pk-btn-primary" id="pkd-in-go">Send link</button></div>
      </form>`, root => {
      root.querySelector('#pkd-in-form').addEventListener('submit', ev => {
        ev.preventDefault();
        const email = root.querySelector('#pkd-in-email').value.trim();
        const msg = root.querySelector('#pkd-in-msg');
        const go = root.querySelector('#pkd-in-go');
        go.disabled = true; msg.textContent = 'Sending…';
        A.signIn(email).then(() => {
          msg.textContent = 'Link sent to ' + email + '. Open it on this device to finish signing in. The dashboards in this browser will be copied to your account.';
        }).catch(e => { msg.textContent = 'Could not send the link: ' + (e.message || e); go.disabled = false; });
      });
      setTimeout(() => root.querySelector('#pkd-in-email').focus(), 30);
    });
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
  async function encodeBoard(b) {
    const used = new Set(b.items.map(it => it.hid).filter(Boolean));   // ids kept only where a collapsed section needs them
    const items = b.items.map(it => { const o = Object.assign({}, it); if (!used.has(o.i)) delete o.i; return o; });
    const raw = new TextEncoder().encode(JSON.stringify({ n: b.name, d: b.desc || suggestDesc(b) || undefined, g: b.grid, m: b.mirror || undefined, items }));
    if (window.CompressionStream) { try { return 'z' + b64u(await pipe(raw, new CompressionStream('deflate-raw'))); } catch (_) {} }
    return 'j' + b64u(raw);
  }
  async function decodeBoard(code) {
    const bytes = unb64u(code.slice(1));
    const raw = code[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
    const j = JSON.parse(new TextDecoder().decode(raw));
    if (!j || !Array.isArray(j.items)) throw new Error('not a dashboard');
    return { id: 'shared', name: String(j.n || 'Shared dashboard').slice(0, 40), desc: String(j.d || '').slice(0, 400), code, grid: j.g === FINE ? FINE : undefined, mirror: MIRRORS[j.m] ? j.m : undefined,
      items: reid(j.items.filter(it => it && ['w', 's', 'n'].includes(it.t))) };
  }
  const baseUrl = () => location.origin + location.pathname;

  async function openShare() {
    const b = board();
    const code = shared ? shared.code : await encodeBoard(b);
    const link = baseUrl() + '#board=' + code, solo = baseUrl() + '#solo=' + code;
    modal(`
      <div class="pkd-modal-head"><div><div class="pkd-modal-title">Share “${esc(b.name)}”</div>
        <div class="pkd-modal-sub">The link carries the layout: whoever opens it sees the same charts with the latest data. No account needed. Later changes to your dashboard are not in a link already sent: share again.</div></div>
        <button class="pkd-ic" data-close type="button" title="Close">✕</button></div>
      <div class="pkd-form">
        <div class="pkd-share-row"><div class="pkd-share-t"><b>Link to the dashboard</b><em>Opens PowerKlock on this dashboard; your colleague can add it to theirs.</em></div>
          <div class="pkd-share-l"><input type="text" readonly value="${esc(link)}" aria-label="Link to the dashboard"><button type="button" class="pk-btn-primary" data-copy="${esc(link)}">Copy</button></div></div>
        <div class="pkd-share-row"><div class="pkd-share-t"><b>Dashboard only</b><em>The dashboard alone, without the menus: for a meeting-room screen or a quick read on a phone.</em></div>
          <div class="pkd-share-l"><input type="text" readonly value="${esc(solo)}" aria-label="Link to the dashboard only"><button type="button" class="pk-btn-primary" data-copy="${esc(solo)}">Copy</button>
          <a class="pk-btn-ghost" href="${esc(solo)}" target="_blank" rel="noopener">Open ↗</a></div></div>
        <div class="pkd-form-foot"><button type="button" class="pk-btn-ghost" data-close>Close</button></div>
      </div>`, root => {
      root.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', () => {
        const inp = btn.parentElement.querySelector('input');
        const done = () => { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = 'Copy'; }, 1800); };
        (navigator.clipboard ? navigator.clipboard.writeText(btn.dataset.copy) : Promise.reject()).then(done).catch(() => { inp.select(); try { document.execCommand('copy'); done(); } catch (_) {} });
      }));
      root.querySelectorAll('.pkd-share-l input').forEach(i => i.addEventListener('focus', () => i.select()));
    });
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
         <button type="button" class="pk-btn-ghost" id="pkd-solo-pptx" title="This dashboard as a PowerPoint">⤓ PowerPoint</button>`
      : `<div class="pkd-shared-t"><b>Shared dashboard · ${esc(shared.name)}</b><span>A copy of a colleague's layout with today's data. Add it to your dashboards to keep or change it.</span></div>
         <div class="pkd-shared-a"><button type="button" class="pk-btn-ghost" id="pkd-shared-close">Close</button><button type="button" class="pk-btn-primary" id="pkd-shared-add">+ Add to my dashboards</button></div>`;
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

  async function openFromLink() {
    const m = location.hash.match(/^#(board|solo)=([zj][A-Za-z0-9_-]+)$/);
    if (!m) return;
    try { shared = await decodeBoard(m[2]); } catch (e) { console.warn('[PKDash] shared link', e); toast('This dashboard link is damaged or incomplete'); return; }
    if (m[1] === 'solo') { document.body.classList.add('pk-solo'); sealLinks(); }
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
      const fromLink = /access_token=|[?&]code=|error_description=/.test(location.hash + location.search);
      const linkError = (location.hash.match(/error_description=([^&]+)/) || [])[1];
      PKAccount.onChange(u => { renderAccount(); if (u) syncFromCloud(); });
      PKAccount.ready().then(u => {
        renderAccount();
        if (u) syncFromCloud();
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
  window.PKDash = { init, open, refresh, has, toggleWidget, addWidget, addCard, addSection, addNote, TEMPLATES, boards, soloLink };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
