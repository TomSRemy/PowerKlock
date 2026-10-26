// ════════════════════════════════════════════════════════════════════
// MENU v2 — the menu by use rather than by kind of data, and an address
// for every page.
//   · Today · My dashboards · Markets · Renewables · Power system · Tools ·
//     Intelligence; Data status, API and Methodology at the foot.
//   · Entries that gather several existing pages (Power spot, Generation…)
//     show a bar of those pages at the top of each of them.
//   · Every entry has an address (#markets/spot/negative): it is written on
//     each navigation, read when the site opens, and the browser Back button
//     goes back to the previous page instead of leaving the site.
//   · The All / France tabs become a zone choice in the top bar (PKScope).
// The pages themselves are unchanged. Loaded right after the <nav>, so the
// new menu replaces the old one before anything paints.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const nav = document.getElementById('sidebar');
  if (!nav) return;

  // icons of the old menu, reused by page id
  const icon = {};
  nav.querySelectorAll('.sidebar-item[id^="nav-"]').forEach(el => { const s = el.querySelector('svg'); if (s) icon[el.id.slice(4)] = s.outerHTML; });
  const svg = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + d + '</svg>';
  Object.assign(icon, {
    replay: svg('<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>'),
    compare: svg('<path d="M3 20h18"/><path d="M4 16l5-6 4 3 7-8"/><path d="M4 12l5 2 4-5 7 3" stroke-dasharray="2 2"/>'),
    today: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    dashboards: svg('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
    forward: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
    m0: svg('<path d="M4 19h16"/><path d="M4 15l5-5 4 3 7-7"/><circle cx="20" cy="6" r="1.5"/>'),
    gas: svg('<path d="M12 2s6 6 6 11a6 6 0 0 1-12 0c0-5 6-11 6-11z"/>'),
    ppa: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h4"/>'),
    fcst: svg('<path d="M3 17c3-6 5-6 8-2s5 4 10-6"/><path d="M3 21h18"/><circle cx="17" cy="5" r="2"/>'),
    capacity: svg('<rect x="3" y="12" width="4" height="8"/><rect x="10" y="8" width="4" height="12"/><rect x="17" y="4" width="4" height="16"/>'),
    genmix: svg('<path d="M12 3v9l7 4"/><circle cx="12" cy="12" r="9"/>'),
    load: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
    frsystem: svg('<path d="M12 2l3 4 5 1-1 5 2 4-5 2-2 4-5-2-5 1 1-5-3-4 4-3 1-5z"/>'),
  });

  // route → where it leads. page: page id; sub: Prices sub-page; tab: view tab (index); go: GO view
  const R = {
    'today': { page: 'morning' },
    'dashboards': { dash: 'mydash' },
    'markets/spot': { page: 'prices', sub: 'da' },
    'markets/spot/overview': { page: 'prices', sub: 'overview' },
    'markets/spot/negative': { page: 'prices', sub: 'negative' },
    'markets/spot/spread': { page: 'prices', sub: 'spread' },
    'markets/spot/imbalance': { page: 'imbalance' },
    'markets/forwards': { page: 'prices', sub: 'forward' },
    'markets/fuels': { page: 'eua' },
    'markets/fuels/forwards': { page: 'euafwd' },
    'markets/fuels/ttf': { page: 'euafwd', tab: 1 },
    'markets/fuels/spreads': { page: 'spark' },
    'markets/go': { page: 'goprices', go: 'eu' },
    'markets/go/auctions': { page: 'goprices', go: 'auctions' },
    'renewables/capture': { page: 'renewables', tab: 0 },
    'renewables/m0': { page: 'renewables', tab: 2 },
    'renewables/capacity': { page: 'capacity' },
    'system/map': { page: 'map' },
    'system/generation': { page: 'genmix' },
    'system/generation/nuclear': { page: 'nuclear' },
    'system/generation/outages': { page: 'remit' },
    'system/demand': { page: 'load' },
    'system/demand/flows': { page: 'crossborder' },
    'system/france': { page: 'frsystem' },
    'system/france/regions': { page: 'regions' },
    'system/weather': { page: 'wxcities' },
    'system/weather/hdd': { page: 'wxhdd' },
    'system/carbon': { page: 'carbonintensity' },
    'system/replay': { page: 'replay' },
    'tools/ppa': { page: 'ppapricer' },
    'tools/forecast': { page: 'fcst' },
    'tools/carbon': { page: 'carbonfoot' },
    'tools/compare': { page: 'compare' },
    'tools/converter': { page: 'converter' },
    'intel/news': { page: 'news' },
    'intel/analysis': { page: 'analysis' },
    'status': { page: 'status' },
    'api': { page: 'api' },
    'methodology': { page: 'methodology' },
  };

  // the menu: [section, [[route, label, icon, group bar?]]]
  const MENU = [
    [null, [['today', 'Today', 'today'], ['dashboards', 'My dashboards', 'dashboards']]],
    ['Markets', [
      ['markets/spot', 'Power spot', 'prices', [['markets/spot/overview', 'Overview'], ['markets/spot', 'Day-ahead'], ['markets/spot/negative', 'Negative prices'], ['markets/spot/spread', 'Spreads'], ['markets/spot/imbalance', 'Imbalance']]],
      ['markets/forwards', 'Power forwards', 'forward'],
      ['markets/fuels', 'Gas, carbon & oil', 'eua', [['markets/fuels', 'Spot prices'], ['markets/fuels/forwards', 'Forward curves'], ['markets/fuels/ttf', 'TTF forwards'], ['markets/fuels/spreads', 'Spark & dark spreads']]],
      ['markets/go', 'Guarantees of origin', 'goprices', [['markets/go', 'EU prices'], ['markets/go/auctions', 'France auctions']]],
    ]],
    ['Renewables', [
      ['renewables/capture', 'Capture & cannibalisation', 'renewables'],
      ['renewables/m0', 'M0 contract', 'm0'],
      ['renewables/capacity', 'Installed capacity', 'capacity'],
    ]],
    ['Power system', [
      ['system/map', 'Europe map', 'map'],
      ['system/generation', 'Generation', 'genmix', [['system/generation', 'Generation mix'], ['system/generation/nuclear', 'Nuclear'], ['system/generation/outages', 'Outages & REMIT']]],
      ['system/demand', 'Demand & flows', 'load', [['system/demand', 'Demand'], ['system/demand/flows', 'Cross-border flows']]],
      ['system/france', 'France', 'frsystem', [['system/france', 'France system'], ['system/france/regions', 'Regions']]],
      ['system/weather', 'Weather', 'wxcities', [['system/weather', 'Cities & outlook'], ['system/weather/hdd', 'HDD / CDD']]],
      ['system/carbon', 'Carbon intensity', 'carbonintensity'],
      ['system/replay', 'Replay a day', 'replay'],
    ]],
    ['Tools', [
      ['tools/ppa', 'PPA pricer', 'ppa'],
      ['tools/forecast', 'Production forecast', 'fcst'],
      ['tools/carbon', 'Carbon footprint', 'carbonfoot'],
      ['intel/analysis', 'Market analysis', 'analysis'],   // a tool more than news (note 19); its address stays
      ['tools/compare', 'Comparator', 'compare'],
      ['tools/converter', 'Converter', 'converter'],
    ]],
    ['Intelligence', [
      ['intel/news', 'News', 'news'],
    ]],
  ];
  const FOOT = [['status', 'Data status'], ['api', 'API'], ['methodology', 'Methodology']];

  // route → menu entry it belongs to, and the group bar it shows
  const owner = {}, bars = [], sectionOf = {}, pageLabel = {};
  MENU.forEach(([sec, items]) => items.forEach(([route, label, ic, group]) => {
    owner[route] = route; sectionOf[route] = sec;
    if (R[route].page && !pageLabel[R[route].page]) pageLabel[R[route].page] = label;
    if (group) group.forEach(([gr, gl]) => { const pg = R[gr].page; if (pg && (!pageLabel[pg] || pg !== R[route].page)) pageLabel[pg] = pg === R[route].page ? label : gl; });
    if (group) { bars.push({ entry: route, label, sec, group }); group.forEach(([r]) => { owner[r] = route; }); }
  }));
  FOOT.forEach(([r]) => { owner[r] = r; });

  // ── build: the previous menu's look (sections with a chevron, groups as a tree with the green path), new order ──
  const keep = nav.querySelector('.sidebar-dash-switch');
  const CHEV = '<svg class="sidebar-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
  const GCHEV = '<svg class="pk-nav-chev" data-fold viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
  const slug = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // the translation (js/i18n.js) leaves form fields alone: the search field gets its words here
  let lang = 'fr'; try { lang = localStorage.getItem('pk-lang') === 'en' ? 'en' : 'fr'; } catch (_) {}
  const ph = lang === 'fr' ? 'Rechercher dans le menu…' : 'Search the menu…';
  let h = '<div class="pk-nv-search"><input type="search" id="pk-nv-q" placeholder="' + ph + '" aria-label="' + ph + '" autocomplete="off"><span class="pk-nv-noq" hidden>No page found · <a href="#" data-allsearch>search everywhere</a></span></div>';
  const used = new Set();
  const item = (route, label, ic, group) => {
    const pid = R[route].page, nid = pid && !used.has(pid) ? (used.add(pid), ' id="nav-' + pid + '"') : '';   // old ids kept: tests and links use them
    if (!group) return '<a class="sidebar-item pk-nv-item" ' + nid + ' href="#' + route + '" data-route="' + route + '" data-en="' + label + '">' + (icon[ic] || '') + '<span>' + label + '</span></a>';
    return '<a class="sidebar-item pk-nav-group pk-nv-item"' + nid + ' href="#' + route + '" data-route="' + route + '" data-en="' + label + '">' + (icon[ic] || '') + '<span>' + label + '</span>' + GCHEV + '</a>' +
      '<div class="sidebar-subitems-wrap pk-nav-wrap" data-entry="' + route + '">' +
      group.map(([gr, gl]) => '<a class="sidebar-subitem" href="#' + gr + '" data-route="' + gr + '" data-en="' + gl + '">' + gl + '</a>').join('') + '</div>';
  };
  const SECTIONS = MENU;
  SECTIONS.forEach(([sec, items], k) => {
    if (!sec) { h += '<div class="sidebar-section pk-nv-top-sec"><div class="sidebar-section-items">' + items.map(x => item(...x)).join('') + '</div></div>'; return; }
    const id = 'sec-' + slug(sec);
    h += '<div class="sidebar-divider"></div><div class="sidebar-section' + (sec === 'General' ? ' collapsed' : '') + '" id="' + id + '">' +
      '<div class="sidebar-section-label" onclick="toggleSection(\'' + id + '\')">' + sec + ' ' + CHEV + '</div>' +
      '<div class="sidebar-section-items" id="' + id + '-items">' + items.map(x => item(...x)).join('') + '</div></div>';
  });
  h += '<div class="pk-nv-foot">' + FOOT.map(([r, l]) => '<a class="pk-nv-small" id="nav-' + R[r].page + '" href="#' + r + '" data-route="' + r + '">' + l + '</a>').join('') + '</div>';
  nav.innerHTML = h;
  if (keep) keep.remove();
  nav.classList.add('pk-nv');

  // groups: the active one opens by itself, the chevron folds or unfolds any of them; the green path stops at the active page
  function path(wrap) {
    const a = wrap.querySelector('.sidebar-subitem.active');
    if (!a || !wrap.classList.contains('open') || !wrap.offsetHeight) { wrap.style.setProperty('--path-height', '0px'); return; }
    const top = wrap.getBoundingClientRect().top, r = a.getBoundingClientRect();
    wrap.style.setProperty('--path-height', (r.top + r.height / 2 - top) + 'px');
  }
  function fitSection(el) {   // a section sized when it opened follows a group opening or closing inside it
    const items = el && el.closest('.sidebar-section-items'), sec = items && items.closest('.sidebar-section');
    if (!items || !items.style.maxHeight || (sec && sec.classList.contains('collapsed'))) return;
    items.style.maxHeight = '2400px';
    setTimeout(() => { if (!sec.classList.contains('collapsed')) items.style.maxHeight = items.scrollHeight + 'px'; }, 260);
  }
  function setOpen(wrap, open) {
    if (!wrap) return;
    wrap.classList.toggle('open', open);
    const head = wrap.previousElementSibling; if (head) head.classList.toggle('open', open);
    fitSection(wrap); setTimeout(() => path(wrap), 240);
  }
  if (window.ResizeObserver) new ResizeObserver(() => nav.querySelectorAll('.pk-nav-wrap.open').forEach(path)).observe(nav);

  // a closed group shows its pages beside the menu on hover or keyboard focus: one click from anywhere
  const fly = document.createElement('div'); fly.className = 'pk-nv-fly'; fly.hidden = true; document.body.appendChild(fly);
  let flyT = 0, flyFor = null;
  const hideFly = () => { flyT = setTimeout(() => { fly.hidden = true; flyFor = null; }, 140); };
  function showFly(head) {
    clearTimeout(flyT);
    const wrap = head.nextElementSibling;
    if (window.innerWidth <= 768 || !wrap || wrap.classList.contains('open') || nav.classList.contains('collapsed') || nav.classList.contains('pk-nv-searching')) { fly.hidden = true; return; }
    if (flyFor !== head) {
      fly.innerHTML = '<div class="pk-nv-fly-t">' + head.querySelector('span').textContent + '</div>' + [...wrap.querySelectorAll('.sidebar-subitem')].map(a => '<a href="#' + a.dataset.route + '" data-route="' + a.dataset.route + '">' + a.textContent + '</a>').join('');
      flyFor = head;
    }
    const r = head.getBoundingClientRect();
    fly.hidden = false;
    fly.style.left = Math.round(r.right + 4) + 'px';
    fly.style.top = Math.round(Math.max(8, Math.min(r.top - 4, window.innerHeight - fly.offsetHeight - 8))) + 'px';
  }
  nav.querySelectorAll('.pk-nav-group').forEach(hd => {
    hd.addEventListener('mouseenter', () => showFly(hd));
    hd.addEventListener('mouseleave', hideFly);
    hd.addEventListener('focus', () => showFly(hd));
    hd.addEventListener('blur', hideFly);
  });
  fly.addEventListener('mouseenter', () => clearTimeout(flyT));
  fly.addEventListener('mouseleave', hideFly);
  fly.addEventListener('click', e => { if (e.target.closest('a[data-route]')) { fly.hidden = true; flyFor = null; } });
  nav.addEventListener('scroll', () => { fly.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fly.hidden = true; });

  // ── search in the menu: filters as you type (French or English names), Enter opens the first page ──
  const q = nav.querySelector('#pk-nv-q'), noq = nav.querySelector('.pk-nv-noq');
  const norm = t => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const opened = new Set();
  function filter() {
    const v = norm(q.value.trim()); nav.classList.toggle('pk-nv-searching', !!v);
    let any = false;
    nav.querySelectorAll('.sidebar-section').forEach(sec => {
      let secAny = false;
      sec.querySelectorAll('.pk-nv-item').forEach(a => {
        const wrap = a.classList.contains('pk-nav-group') ? a.nextElementSibling : null;
        const hit = t => !v || norm(t.textContent).includes(v) || norm(t.dataset.en).includes(v);
        const subs = wrap ? [...wrap.querySelectorAll('.sidebar-subitem')] : [];
        const subHits = subs.filter(hit), self = hit(a);
        subs.forEach(x => { x.hidden = !!v && !(self || subHits.includes(x)); });
        a.hidden = !!v && !self && !subHits.length;
        if (wrap) {
          if (v && subHits.length && !wrap.classList.contains('open')) { opened.add(wrap); setOpen(wrap, true); }
          if (!v && opened.has(wrap)) { opened.delete(wrap); if (!wrap.querySelector('.active')) setOpen(wrap, false); }
        }
        if (!a.hidden) secAny = true;
      });
      sec.hidden = !!v && !secAny; if (secAny) any = true;
    });
    nav.querySelectorAll('.sidebar-divider').forEach(d => { d.hidden = !!v; });
    noq.hidden = !v || any;
  }
  q.addEventListener('input', filter);
  q.addEventListener('keydown', e => {
    if (e.key === 'Escape') { q.value = ''; filter(); q.blur(); }
    if (e.key === 'Enter') {
      const first = [...nav.querySelectorAll('.sidebar-subitem, .pk-nv-item')].find(a => a.offsetParent && !a.hidden && (!a.classList.contains('pk-nav-group') || norm(a.textContent).includes(norm(q.value.trim()))));
      if (first) { e.preventDefault(); go(first.dataset.route, true); q.value = ''; filter(); }
    }
  });
  noq.querySelector('[data-allsearch]').addEventListener('click', e => {   // the site-wide search (pages, sections, charts) with what was typed
    e.preventDefault(); const t = q.value;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    setTimeout(() => { const i = document.querySelector('#pk-search input'); if (i) { i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); } }, 60);
  });

  // a short message (unknown address)
  function notice(msg) {
    const d = document.createElement('div');
    d.className = 'pk-nv-notice'; d.setAttribute('role', 'status'); d.textContent = msg;
    document.body.appendChild(d); setTimeout(() => d.remove(), 5000);
  }

  // group bars at the top of each page of a group (phones; on a computer the menu shows the pages)
  function placeBars() {
    bars.forEach(b => {
      const pages = new Set(b.group.map(([r]) => R[r].page));
      pages.forEach(pid => {
        const pg = document.getElementById('page-' + pid);
        if (!pg || pg.querySelector(':scope > .pk-gbar')) return;
        const d = document.createElement('nav');
        d.className = 'pk-gbar'; d.dataset.entry = b.entry; d.setAttribute('aria-label', b.label);
        d.innerHTML = '<span class="pk-gbar-t">' + b.label + '</span>' + b.group.map(([r, l]) => '<a href="#' + r + '" data-route="' + r + '">' + l + '</a>').join('');
        pg.insertBefore(d, pg.firstChild);
      });
    });
  }

  // ── navigation ──
  let current = null, silent = false;
  const curPage = () => { const p = document.querySelector('.page.active'); return p ? p.id.replace('page-', '') : null; };
  const curSub = () => { const p = document.querySelector('#page-prices .subdomain-panel.active'); return p ? p.getAttribute('data-subdomain-panel') : null; };
  const curGo = () => { const b = document.querySelector('#go-tabs-nav .tab-btn.active'); return b && b.dataset.tab === 'auctions' ? 'auctions' : 'eu'; };

  // the route matching what is on screen now
  function detect() {
    if (document.getElementById('page-mydash') && document.getElementById('page-mydash').classList.contains('active')) return 'dashboards';
    const id = curPage(); if (!id) return null;
    if (id === 'prices') { const s = curSub() || 'da'; return { da: 'markets/spot', overview: 'markets/spot/overview', negative: 'markets/spot/negative', 'negative-legacy': 'markets/spot/negative', spread: 'markets/spot/spread', forward: 'markets/forwards' }[s] || 'markets/spot'; }
    if (id === 'goprices') return curGo() === 'auctions' ? 'markets/go/auctions' : 'markets/go';
    if (id === 'renewables') return current === 'renewables/m0' ? 'renewables/m0' : 'renewables/capture';
    if (id === 'euafwd') return current === 'markets/fuels/ttf' ? 'markets/fuels/ttf' : 'markets/fuels/forwards';
    return Object.keys(R).find(r => R[r].page === id && R[r].tab == null && !R[r].sub && !R[r].go) || null;
  }

  function mark(route) {
    const own = owner[route] || route;
    nav.querySelectorAll('.pk-nv-item').forEach(a => {
      const grp = a.classList.contains('pk-nav-group'), on = a.dataset.route === own;
      a.classList.toggle('active', on && !grp);                       // a plain entry: the green active style
      a.classList.toggle('has-active-subitem', on && grp);            // a group: its header lights, the page is marked below
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    nav.querySelectorAll('.pk-nv-small').forEach(a => { const on = a.dataset.route === own; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    nav.querySelectorAll('.sidebar-subitem').forEach(a => { const on = a.dataset.route === route; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    // at rest only the page's section and group are unfolded, everything else folds (a search unfolds what it finds)
    const searching = nav.classList.contains('pk-nv-searching');
    nav.querySelectorAll('.pk-nav-wrap').forEach(w => { const mine = w.dataset.entry === own; if (mine !== w.classList.contains('open') && (mine || !searching)) setOpen(w, mine); });
    nav.querySelectorAll('.pk-nav-wrap.open').forEach(w => setTimeout(() => path(w), 60));
    nav.querySelectorAll('.sidebar-section').forEach(sc => {
      const label = sc.querySelector('.sidebar-section-label'); if (!label) return;
      const mine = !!sc.querySelector('.pk-nv-item[aria-current]');
      sc.classList.toggle('section-active', mine);
      if (searching) return;
      const items = sc.querySelector('.sidebar-section-items');
      if (mine) { sc.classList.remove('collapsed'); if (items) items.style.maxHeight = ''; }
      else sc.classList.add('collapsed');
    });
    // breadcrumbs inside the pages name the old menu: show the new section
    const e0 = nav.querySelector('.pk-nv-top-sec [data-route="' + own + '"] span');
    const sec = sectionOf[own] || (e0 ? e0.textContent.trim() : null), pg = document.querySelector('.page.active');
    if (sec && pg) pg.querySelectorAll('.pr-breadcrumb-parent').forEach(c => { if (c.textContent !== sec) c.textContent = sec; });
    // the page's own name after it, when the page only repeated the section ("Renouvelables › Renouvelables")
    const it = nav.querySelector('.pk-nv-item[aria-current]'), itName = it && (it.querySelector('span') || it).textContent.trim();
    if (sec && pg && itName) pg.querySelectorAll('.pr-breadcrumb-current').forEach(c => { if (c.textContent.trim() === sec || c.dataset.pkAuto) { c.textContent = itName; c.dataset.pkAuto = '1'; } });
    document.querySelectorAll('.pk-gbar').forEach(g => { g.hidden = g.dataset.entry !== own; });
    document.querySelectorAll('.pk-gbar a').forEach(a => a.classList.toggle('on', a.dataset.route === route));
  }

  function write(route, push) {
    if (document.body.classList.contains('pk-solo')) return;   // shared dashboard: its #solo= address stays
    if (!route || route === current) { if (route) mark(route); return; }
    current = route; mark(route);
    const url = location.pathname + location.search + '#' + route;
    try { if (push) history.pushState({ pk: route }, '', url); else history.replaceState({ pk: route }, '', url); } catch (_) {}
    // page title from the menu as shown (French or English)
    const own = owner[route] || route, e = nav.querySelector('[data-route="' + own + '"]'), g = document.querySelector('.pk-gbar:not([hidden]) a[data-route="' + route + '"]');
    document.title = 'PowerKlock · ' + ((e ? e.textContent.trim() : labelOf(route)) + (g && route !== own ? ' · ' + g.textContent.trim() : ''));
  }
  function labelOf(route) {
    for (const [, items] of MENU) for (const [r, l, , g] of items) {
      if (r === route && !g) return l;
      if (g) for (const [gr, gl] of g) if (gr === route) return l + ' · ' + gl;
    }
    const f = FOOT.find(([r]) => r === route); return f ? f[1] : 'PowerKlock';
  }

  function openTab(pid, i) {
    const tabs = document.querySelectorAll('#page-' + pid + ' .pk-views .tab-btn, #page-' + pid + ' .tabs-nav .tab-btn');
    const b = tabs[i]; if (b && !b.classList.contains('active')) b.click();
  }

  // go to a route; push = a new entry in the browser history
  function go(route, push) {
    const t = R[route]; if (!t) return false;
    silent = true;
    try {
      if (t.dash) {
        if (typeof window.switchDashboard === 'function') window.switchDashboard(t.dash);
        nav.classList.remove('sidebar-special-hidden');   // the menu stays beside the dashboards
      } else if (t.sub) {
        if (curPage() !== 'prices') window.showPage('prices');
        window.prSelectSubdomain(t.sub);
      } else if (t.go) {
        if (typeof window.pkGoTab === 'function') window.pkGoTab(t.go); else window.showPage('goprices');
      } else {
        window.showPage(t.page);
        if (t.tab != null) setTimeout(() => openTab(t.page, t.tab), 60);
      }
    } finally { silent = false; }
    current = null;
    write(route, push);
    return true;
  }
  window.pkGo = route => go(route, true);

  // an address may carry settings after the page (#tools/compare?s=…): kept for the page, which reads them once
  const routeOfHash = () => { const m = location.hash.match(/^#([a-z0-9/]+)(?:\?([^#]*))?$/); if (!m || !R[m[1]]) return null; if (m[2]) { window.pkHashRoute = m[1]; window.pkHashParams = Object.fromEntries(new URLSearchParams(m[2])); } return m[1]; };
  const foreignHash = () => /^#(board|solo)=|access_token=|error_description=/.test(location.hash);

  // a click on any menu or bar link
  document.addEventListener('click', e => {
    // a click anywhere on a group's name folds or unfolds its pages (no need to aim at the chevron); its pages are
    // opened from the list. A middle click or Ctrl+click still opens the group's first page in a new tab.
    const head = e.target.closest('.pk-nav-group');
    if (head && nav.contains(head) && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.pkFold = true;
      const wrap = head.nextElementSibling; setOpen(wrap, !wrap.classList.contains('open'));
      fly.hidden = true;
      return;
    }
    const a = e.target.closest('a[data-route]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // new tab / window: the browser opens the address
    e.preventDefault();
    go(a.dataset.route, true);
    // phone: the menu is a drawer, closed once a page is chosen
    if (nav.contains(a)) setTimeout(() => { if (nav.classList.contains('open') && typeof window.toggleMobileSidebar === 'function') window.toggleMobileSidebar(); }, 120);
  });

  window.addEventListener('popstate', () => {
    const r = routeOfHash();
    if (r) { current = null; go(r, false); return; }
    // an address typed by hand that is not a page (shared-dashboard and sign-in addresses left alone)
    if (/^#[a-z]/i.test(location.hash) && !foreignHash()) { notice('Page not found (old or mistyped address): showing Today'); current = null; go('today', false); }
  });

  // the page of the address is shown as soon as the page structure is there (DOMContentLoaded), not once
  // every script and data file has loaded: until then the default page (Prices) stays hidden, so it is
  // never painted and then swapped (LCP, layout shift). The full navigation, with each page's loader,
  // runs again at 'load'.
  const early = (() => { if (/^#solo=/.test(location.hash) || foreignHash()) return null; return routeOfHash() || 'today'; })();
  const earlyPage = early && (R[early].page || (R[early].dash ? null : 'prices'));
  const hide = document.createElement('style');
  // the page of the address is painted as soon as its HTML is parsed, before the scripts below it
  if (earlyPage && earlyPage !== 'prices') { hide.textContent = '#page-prices.active{display:none!important} #page-' + earlyPage + '{display:block!important}'; document.head.appendChild(hide); }
  document.addEventListener('DOMContentLoaded', () => {
    if (earlyPage && earlyPage !== 'prices') {
      document.querySelectorAll('.page.active').forEach(p => p.classList.remove('active'));
      const pg = document.getElementById('page-' + earlyPage); if (pg) pg.classList.add('active');
    }
    hide.remove();
    if (early) mark(early);
  });

  window.addEventListener('load', () => setTimeout(() => {
    placeBars();
    // any navigation from elsewhere (search, links inside pages, tabs) writes the address too
    const wrap = name => { const f = window[name]; if (typeof f !== 'function') return; window[name] = function () { const r = f.apply(this, arguments); if (!silent) setTimeout(() => write(detect(), true), 0); return r; }; };
    wrap('showPage'); wrap('prSelectSubdomain'); wrap('switchDashboard');
    document.addEventListener('click', e => { if (e.target.closest('#go-tabs-nav .tab-btn')) setTimeout(() => write(detect(), true), 0); });
    if (document.body.classList.contains('pk-solo') || foreignHash()) { mark(detect()); return; }
    const r = routeOfHash();
    if (!r && /^#[a-z]/i.test(location.hash)) notice('Page not found (old or mistyped address): showing Today');
    go(r || 'today', false);
  }, 30));

  // ── zone choice (replaces the All / France tabs) ──
  function zoneChoice() {
    // a pill with the flag and the name; a click opens a grid of flags. The select stays (hidden) for the code that reads it.
    const ctl = id => '<div class="pk-zone" title="Zone the pages open on, kept in this browser"><span class="pk-zone-l">Zone</span><select id="' + id + '" class="pk-zone-sel" tabindex="-1" aria-hidden="true"><option value="all">Europe</option><option value="FR">France</option></select>' +
      '<button type="button" class="pk-zbtn" aria-haspopup="true" aria-expanded="false"></button><div class="pk-zpop" role="menu" hidden></div></div>';
    const host = document.querySelector('.topbar-tabs');
    if (host) host.innerHTML = ctl('pk-zone');
    const srch = nav.querySelector('.pk-nv-search');   // phones: the top bar has no room, the zone sits in the menu
    if (srch) srch.insertAdjacentHTML('afterend', '<div class="pk-nv-zone">' + ctl('pk-zone-m') + '</div>');
    const sels = [...document.querySelectorAll('#pk-zone, #pk-zone-m')];
    const list = () => [['all', 'Europe']].concat(window.PKScope && PKScope.countries ? PKScope.countries() : [['FR', 'France']]);
    const item = ([k, n], cur) => '<button type="button" role="menuitemradio" aria-checked="' + (k === cur) + '" class="pk-zitem' + (k === cur ? ' on' : '') + '" data-z="' + k + '">' + zoneFlag(k) + '<span>' + n + '</span></button>';
    const sync = () => sels.forEach(s => {
      // js/scope.js loads after this file: its country list replaces the France-only fallback
      if (window.PKScope && PKScope.countries && s.options.length < 3) s.innerHTML = list().map(([k, n]) => '<option value="' + k + '">' + n + '</option>').join('');
      const cur = (window.PKScope && PKScope.get()) || 'all', box = s.parentNode;
      s.value = cur;
      const name = (list().find(x => x[0] === cur) || ['all', 'Europe'])[1];
      box.querySelector('.pk-zbtn').innerHTML = zoneFlag(cur) + '<span>' + name + '</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
      box.querySelector('.pk-zpop').innerHTML = '<div class="pk-zpop-h">' + item(list()[0], cur) + '</div><div class="pk-zpop-g">' + list().slice(1).map(x => item(x, cur)).join('') + '</div>';
    });
    const close = except => sels.forEach(s => { const b = s.parentNode; if (b === except) return; b.querySelector('.pk-zpop').hidden = true; b.querySelector('.pk-zbtn').setAttribute('aria-expanded', 'false'); });
    sync();
    sels.forEach(sel => {
      const box = sel.parentNode, btn = box.querySelector('.pk-zbtn'), pop = box.querySelector('.pk-zpop');
      sel.addEventListener('change', () => { if (window.PKScope && PKScope.set) PKScope.set(sel.value); sync(); });
      btn.addEventListener('click', e => { e.stopPropagation(); const open = pop.hidden; close(); pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) { const on = pop.querySelector('.on') || pop.querySelector('button'); if (on) on.focus(); } });
      pop.addEventListener('click', e => { const b = e.target.closest('.pk-zitem'); if (!b) return; e.stopPropagation(); close(); sel.value = b.dataset.z; sel.dispatchEvent(new Event('change', { bubbles: true })); btn.focus(); });
    });
    document.addEventListener('click', () => close());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    window.addEventListener('load', () => setTimeout(sync, 50));
  }
  // small flags drawn in SVG (emoji flags do not show on Windows)
  function zoneFlag(k) {
    const v = c => c.map((x, i) => '<rect x="' + (i * 6) + '" width="6" height="12" fill="' + x + '"/>').join('');
    const h = (c, hs) => { let y = 0; return c.map((x, i) => { const r = '<rect y="' + y + '" width="18" height="' + hs[i] + '" fill="' + x + '"/>'; y += hs[i]; return r; }).join(''); };
    const F = {
      FR: v(['#0055A4', '#fff', '#EF4135']), BE: v(['#1a1a1a', '#FDDA24', '#EF3340']), IT: v(['#009246', '#fff', '#CE2B37']),
      DE: h(['#1a1a1a', '#DD0000', '#FFCE00'], [4, 4, 4]), NL: h(['#AE1C28', '#fff', '#21468B'], [4, 4, 4]), AT: h(['#ED2939', '#fff', '#ED2939'], [4, 4, 4]),
      PL: h(['#fff', '#DC143C'], [6, 6]), ES: h(['#AA151B', '#F1BF00', '#AA151B'], [3, 6, 3]),
      PT: '<rect width="7" height="12" fill="#046A38"/><rect x="7" width="11" height="12" fill="#DA291C"/><circle cx="7" cy="6" r="2.2" fill="#FFE900"/>',
      CH: '<rect width="18" height="12" fill="#DA291C"/><rect x="7.6" y="2.5" width="2.8" height="7" fill="#fff"/><rect x="5.5" y="4.6" width="7" height="2.8" fill="#fff"/>',
      all: '<rect width="18" height="12" fill="#003399"/>' + Array.from({ length: 12 }, (_, i) => '<circle cx="' + (9 + 3.6 * Math.cos(i * Math.PI / 6)).toFixed(2) + '" cy="' + (6 + 3.6 * Math.sin(i * Math.PI / 6)).toFixed(2) + '" r=".55" fill="#FFCC00"/>').join(''),
    };
    return '<svg class="pk-zflag" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' + (F[k] || '<rect width="18" height="12" fill="#3a4656"/>') + '</svg>';
  }
  zoneChoice();

  const css = document.createElement('style');
  css.textContent = `
  .pk-nv a.sidebar-item, .pk-nv a.sidebar-subitem{text-decoration:none}
  .pk-nv a.sidebar-subitem{display:block}
  .pk-nv .pk-nv-top-sec{padding-top:6px}
  .pk-nv .pk-nv-top-sec .sidebar-item{font-weight:600;color:var(--text)}
  .pk-nv .sidebar-item span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pk-nv .pk-nav-chev{cursor:pointer;padding:4px;margin-right:-4px;width:19px;height:19px;box-sizing:border-box;border-radius:4px}
  .pk-nv .pk-nav-chev:hover{background:rgba(255,255,255,.08);opacity:1}
  .pk-nv{display:flex;flex-direction:column}
  .pk-nv-foot{margin-top:auto;border-top:1px solid var(--border);padding:10px 12px 14px;display:flex;flex-wrap:wrap;gap:2px 4px}
  .pk-nv-small{font-size:11.5px;color:var(--text3);text-decoration:none;padding:6px 8px;min-height:28px;display:inline-flex;align-items:center;border-radius:5px}
  .pk-nv-small:hover{color:var(--text);background:var(--bg3)}
  .pk-nv-small.active{color:var(--accent);background:var(--accent-dim)}
  .pk-nv-fly{position:fixed;z-index:1200;min-width:200px;padding:6px;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;flex-direction:column}
  .pk-nv-fly[hidden]{display:none}
  .pk-nv-fly-t{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);padding:4px 10px 6px}
  .pk-nv-fly a{font-size:12.5px;color:var(--text2);text-decoration:none;padding:6px 10px;border-radius:5px;min-height:28px;display:flex;align-items:center}
  .pk-nv-fly a:hover{color:var(--text);background:var(--bg3)}
  .pk-nv-search{padding:12px 12px 4px;position:relative}
  .pk-nv-search input{width:100%;box-sizing:border-box;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font:inherit;font-size:12.5px;padding:7px 10px}
  .pk-nv-search input:focus{outline:none;border-color:var(--accent)}
  .pk-nv-noq{display:block;font-size:11.5px;color:var(--text3);padding:8px 4px 0}
  .pk-nv-noq[hidden]{display:none}
  .pk-nv-noq a{color:var(--accent)}
  .pk-nv.pk-nv-searching .sidebar-section.collapsed .sidebar-section-items{max-height:none!important}
  .pk-nv.pk-nv-searching .sidebar-section-items{max-height:none!important}
  [data-theme="light"] .pk-nv .pk-nav-chev:hover{background:rgba(0,0,0,.06)}
  .pk-nv-notice{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:3000;background:var(--bg3);color:var(--text);border:1px solid var(--border2);border-radius:8px;padding:10px 16px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:calc(100vw - 32px)}
  @media (min-width:769px){.pk-gbar{display:none!important}}
  @media (max-width:768px){.page:has(> .pk-gbar:not([hidden])) .pr-breadcrumb{display:none}}
  .pk-gbar{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin:0 0 14px;padding:4px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);width:fit-content;max-width:100%}
  .pk-gbar-t{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);padding:0 8px 0 6px}
  .pk-gbar a{font-size:12.5px;color:var(--text2);text-decoration:none;padding:5px 11px;border-radius:6px;white-space:nowrap}
  .pk-gbar a:hover{color:var(--text);background:var(--bg3)}
  .pk-gbar a.on{color:var(--accent);background:var(--accent-dim)}
  .pk-nv-zone{display:none;width:100%;padding:0 4px 8px}
  @media (max-width:768px){.pk-nv-zone{display:block}}
  .pk-zone{display:inline-flex;align-items:center;gap:8px;font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em}
  .pk-zone{position:relative}
  .pk-zone .pk-zone-sel{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
  .pk-zbtn{display:inline-flex;align-items:center;gap:8px;background:var(--bg3);color:var(--text);border:1px solid var(--border2);border-radius:999px;padding:5px 12px 5px 9px;font:600 12.5px Inter,sans-serif;text-transform:none;letter-spacing:0;cursor:pointer;transition:border-color .15s,background .15s}
  .pk-zbtn:hover,.pk-zbtn[aria-expanded="true"]{border-color:var(--accent);background:rgba(20,211,169,.08)}
  .pk-zbtn svg:last-child{opacity:.6;transition:transform .15s} .pk-zbtn[aria-expanded="true"] svg:last-child{transform:rotate(180deg)}
  .pk-zflag{flex:none;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,.18)}
  .pk-zpop{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);z-index:1200;width:340px;max-width:calc(100vw - 32px);background:var(--bg2);border:1px solid var(--border2);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.45);padding:8px;text-transform:none;letter-spacing:0}
  .pk-zpop[hidden]{display:none}
  .pk-zpop-h{padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid var(--border)}
  .pk-zpop-g{display:grid;grid-template-columns:1fr 1fr;gap:2px}
  .pk-zitem{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:var(--text2);font:500 13px Inter,sans-serif;text-align:left;cursor:pointer}
  .pk-zitem:hover,.pk-zitem:focus-visible{background:var(--bg3);color:var(--text);outline:none}
  .pk-zitem.on{background:rgba(20,211,169,.12);color:var(--accent);font-weight:600}
  .pk-nv-zone .pk-zpop{left:0;transform:none;width:272px}
  @media (max-width:768px){.pk-gbar{width:auto;flex-wrap:nowrap;overflow-x:auto}.pk-gbar-t{display:none}}
  `;
  document.head.appendChild(css);

  window.PKNav = {
    entries() {   // for the quick search
      const out = [];
      MENU.forEach(([sec, items]) => items.forEach(([r, l, , g]) => {
        out.push({ label: l, sub: sec || '', route: r });
        if (g) g.forEach(([gr, gl]) => { if (gr !== r) out.push({ label: l + ' › ' + gl, sub: sec || '', route: gr }); });
      }));
      FOOT.forEach(([r, l]) => out.push({ label: l, sub: '', route: r }));
      return out;
    },
    go: r => go(r, true),
    pageLabel: id => pageLabel[id] || null,   // menu name of a page (quick search)
  };
})();

// Methodology menu: scroll to the section instead of letting the router read "#meth-…" as a page
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('.meth-nav a[href^="#meth-"]');
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  const t = document.getElementById(a.getAttribute('href').slice(1));
  if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
}, true);
