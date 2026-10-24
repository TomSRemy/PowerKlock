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
    today: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    dashboards: svg('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
    forward: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
    m0: svg('<path d="M4 19h16"/><path d="M4 15l5-5 4 3 7-7"/><circle cx="20" cy="6" r="1.5"/>'),
    gas: svg('<path d="M12 2s6 6 6 11a6 6 0 0 1-12 0c0-5 6-11 6-11z"/>'),
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
    'tools/ppa': { page: 'ppapricer' },
    'tools/forecast': { page: 'fcst' },
    'tools/carbon': { page: 'carbonfoot' },
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
      ['markets/fuels', 'Gas, carbon & oil', 'eua', [['markets/fuels', 'Spot prices'], ['markets/fuels/forwards', 'Forward curves'], ['markets/fuels/spreads', 'Spark & dark spreads']]],
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
    ]],
    ['Tools', [
      ['tools/ppa', 'PPA pricer', 'ppapricer'],
      ['tools/forecast', 'Production forecast', 'fcst'],
      ['tools/carbon', 'Carbon footprint', 'carbonfoot'],
      ['tools/converter', 'Converter', 'converter'],
    ]],
    ['Intelligence', [
      ['intel/news', 'News', 'news'],
      ['intel/analysis', 'Market analysis', 'analysis'],
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

  // ── build ──
  const keep = nav.querySelector('.sidebar-dash-switch');
  let h = '';
  const used = new Set();
  MENU.forEach(([sec, items]) => {
    h += '<div class="sidebar-section pk-nv-sec">' + (sec ? '<div class="sidebar-section-label pk-nv-label">' + sec + '</div>' : '') + '<div class="sidebar-section-items">';
    items.forEach(([route, label, ic]) => {
      const pid = R[route].page, nid = pid && !used.has(pid) ? (used.add(pid), ' id="nav-' + pid + '"') : '';   // old ids kept: tests and links use them
      h += '<a class="sidebar-item pk-nv-item' + (sec ? '' : ' pk-nv-top') + '"' + nid + ' href="#' + route + '" data-route="' + route + '">' + (icon[ic] || '') + '<span>' + label + '</span></a>';
    });
    h += '</div></div>';
  });
  h += '<div class="pk-nv-foot">' + FOOT.map(([r, l]) => '<a class="pk-nv-small" id="nav-' + R[r].page + '" href="#' + r + '" data-route="' + r + '">' + l + '</a>').join('') + '</div>';
  nav.innerHTML = h;
  if (keep) keep.remove();
  nav.classList.add('pk-nv');

  // group bars at the top of each page of a group
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
    return Object.keys(R).find(r => R[r].page === id && R[r].tab == null && !R[r].sub && !R[r].go) || null;
  }

  function mark(route) {
    const own = owner[route] || route;
    nav.querySelectorAll('[data-route]').forEach(a => { const on = a.dataset.route === own; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    // breadcrumbs inside the pages name the old menu: show the new section
    const e0 = nav.querySelector('.pk-nv-top[data-route="' + own + '"] span');
    const sec = sectionOf[own] || (e0 ? e0.textContent.trim() : null), pg = document.querySelector('.page.active');
    if (sec && pg) pg.querySelectorAll('.pr-breadcrumb-parent').forEach(c => { if (c.textContent !== sec) c.textContent = sec; });
    nav.querySelectorAll('.sidebar-section').forEach(sc => sc.classList.toggle('section-active', !!sc.querySelector('.sidebar-item.active') && !!sc.querySelector('.pk-nv-label')));
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

  const routeOfHash = () => { const m = location.hash.match(/^#([a-z0-9/]+)$/); return m && R[m[1]] ? m[1] : null; };
  const foreignHash = () => /^#(board|solo)=|access_token=|error_description=/.test(location.hash);

  // a click on any menu or bar link
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-route]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // new tab / window: the browser opens the address
    e.preventDefault();
    go(a.dataset.route, true);
    // phone: the menu is a drawer, closed once a page is chosen
    if (nav.contains(a)) setTimeout(() => { if (nav.classList.contains('open') && typeof window.toggleMobileSidebar === 'function') window.toggleMobileSidebar(); }, 120);
  });

  window.addEventListener('popstate', () => { const r = routeOfHash(); if (r) { current = null; go(r, false); } });

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
    go(r || 'today', false);
  }, 30));

  // ── zone choice (replaces the All / France tabs) ──
  function zoneChoice() {
    const ctl = id => '<label class="pk-zone" title="Zone the pages open on, kept in this browser"><span>Zone</span><select id="' + id + '"><option value="all">Europe</option><option value="FR">France</option></select></label>';
    const host = document.querySelector('.topbar-tabs');
    if (host) host.innerHTML = ctl('pk-zone');
    const foot = nav.querySelector('.pk-nv-foot');
    if (foot) foot.insertAdjacentHTML('afterbegin', '<div class="pk-nv-zone">' + ctl('pk-zone-m') + '</div>');
    const sels = [...document.querySelectorAll('#pk-zone, #pk-zone-m')];
    const sync = () => { if (window.PKScope) sels.forEach(s => { s.value = PKScope.get() === 'FR' ? 'FR' : 'all'; }); };
    sync();
    sels.forEach(sel => sel.addEventListener('change', () => { if (window.PKScope && PKScope.set) PKScope.set(sel.value); sync(); }));
    window.addEventListener('load', () => setTimeout(sync, 50));
  }
  zoneChoice();

  const css = document.createElement('style');
  css.textContent = `
  .pk-nv{display:flex;flex-direction:column}
  .pk-nv .pk-nv-sec{padding:6px 0 2px}
  .pk-nv .pk-nv-sec:first-child{padding-top:12px}
  .pk-nv .pk-nv-label{cursor:default;padding:8px 16px 4px}
  .pk-nv .pk-nv-label:hover{color:var(--text3)}
  .pk-nv a.sidebar-item{text-decoration:none}
  .pk-nv .pk-nv-top{font-weight:600;color:var(--text)}
  .pk-nv .sidebar-item span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pk-nv-foot{margin-top:auto;border-top:1px solid var(--border);padding:10px 12px 14px;display:flex;flex-wrap:wrap;gap:2px 4px}
  .pk-nv-small{font-size:11.5px;color:var(--text3);text-decoration:none;padding:6px 8px;min-height:28px;display:inline-flex;align-items:center;border-radius:5px}
  .pk-nv-small:hover{color:var(--text);background:var(--bg3)}
  .pk-nv-small.active{color:var(--accent);background:var(--accent-dim)}
  .pk-gbar{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin:0 0 14px;padding:4px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);width:fit-content;max-width:100%}
  .pk-gbar-t{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);padding:0 8px 0 6px}
  .pk-gbar a{font-size:12.5px;color:var(--text2);text-decoration:none;padding:5px 11px;border-radius:6px;white-space:nowrap}
  .pk-gbar a:hover{color:var(--text);background:var(--bg3)}
  .pk-gbar a.on{color:var(--accent);background:var(--accent-dim)}
  .pk-nv-zone{display:none;width:100%;padding:0 4px 8px}
  @media (max-width:768px){.pk-nv-zone{display:block}}
  .pk-zone{display:inline-flex;align-items:center;gap:8px;font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em}
  .pk-zone select{background:var(--bg3);color:var(--text);border:1px solid var(--border2);border-radius:999px;padding:4px 10px;font-size:12.5px;text-transform:none;letter-spacing:0;cursor:pointer}
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
