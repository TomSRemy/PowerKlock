// ════════════════════════════════════════════════════════════════════
// QUICK SEARCH — Ctrl+K / ⌘K or the magnifier in the top bar.
// Finds pages, sub-pages and view tabs (from the menu and the bars) and
// every chart of the catalogue. Enter opens the result: a chart opens its
// page, the right view tab, and is scrolled into view and highlighted.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  let idx = null;
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const esc = PK.esc;   // js/pk-core.js
  function build() {
    const out = [];
    if (window.PKNav) PKNav.entries().forEach(e => out.push({ kind: 'Page', label: e.label, sub: e.sub, go: () => PKNav.go(e.route) }));
    document.querySelectorAll('#sidebar .sidebar-item[onclick*="showPage"], #sidebar .sidebar-subitem[data-page]').forEach(el => {
      const m = el.getAttribute('onclick').match(/showPage\('([^']+)'\)/); if (!m) return;
      const sec = el.closest('.sidebar-section');
      const group = sec ? (sec.querySelector('.sidebar-section-label') || {}).textContent : '';
      out.push({ kind: 'Page', label: el.textContent.trim(), sub: (group || '').trim(), go: () => window.showPage(m[1]) });
    });
    document.querySelectorAll('.sidebar-subitem[onclick*="prSelectSubdomain"]').forEach(el => {
      const m = el.getAttribute('onclick').match(/prSelectSubdomain\('([^']+)'\)/); if (!m) return;
      out.push({ kind: 'Page', label: 'Prices › ' + el.textContent.trim(), sub: 'Power', go: () => { window.showPage('prices'); window.prSelectSubdomain(m[1]); } });
    });
    // sections of every page (tools included): open the page, the view tab holding the section, and scroll to it
    document.querySelectorAll('.page[id^="page-"] .hist-section-strong[id]').forEach(sec => {
      const t = sec.querySelector('.hist-section-title'); if (!t) return;
      const page = sec.closest('.page').id.slice(5), meta = (t.querySelector('.pk-hs-meta') || {}).textContent || '';
      const label = [...t.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim(); if (!label) return;
      const navEl = document.getElementById('nav-' + page), pageName = (window.PKNav && PKNav.pageLabel(page)) || (navEl ? navEl.textContent.trim() : page);
      out.push({ kind: 'Section', label: pageName + ' › ' + label, sub: meta.trim(), go: () => openSection(page, sec) });
    });
    if (window.PKW) PKW.list().forEach(w => {
      out.push({ kind: 'Chart', label: w.title, sub: [w.source, w.desc].filter(Boolean).join(' · '), w, go: () => openChart(w) });
    });
    // every card on every page by the title it shows (French when the site is in French), so what you read is what you find
    const seen = new Set(out.map(o => norm(o.label)));
    document.querySelectorAll('.page[id^="page-"] .chart-container .table-title, .page[id^="page-"] .fuel-card .table-title').forEach(t => {
      const label = t.textContent.replace(/\s+/g, ' ').trim(); if (!label || label.length < 4 || seen.has(norm(label))) return; seen.add(norm(label));
      const card = t.closest('.chart-container, .fuel-card'), page = t.closest('.page').id.slice(5);
      const pageName = (window.PKNav && PKNav.pageLabel(page)) || page, sub = ((card && card.querySelector('.fuel-card-sub')) || {}).textContent || '';
      out.push({ kind: 'Chart', label, sub: pageName + (sub ? ' · ' + sub.trim() : ''), go: () => openCard(page, card) });
    });
    // labels in both languages: the English the code is written in and the French shown on screen
    const fr = s => (window.PKI18n && PKI18n.tr ? PKI18n.tr(s) : s);
    out.forEach(o => { o.labelFr = fr(o.label); o.key = norm(o.label + ' ' + o.labelFr + ' ' + o.sub + ' ' + fr(o.sub)); o.lk = norm(o.label + ' ' + o.labelFr); });
    // one result per title (a chart of the catalogue and its card on the page read the same)
    const once = new Set();
    return out.filter(o => { const k = o.kind[0] + norm(o.labelFr); if (once.has(k)) return false; once.add(k); return true; });
  }

  function openCard(page, card) {
    window.showPage(page);
    setTimeout(() => {
      const sec = card && card.closest('.hist-section-strong');
      if (sec && sec.style.display === 'none') { for (const t of sec.closest('.page').querySelectorAll('.pk-views .tab-btn')) { t.click(); if (sec.style.display !== 'none') break; } }
      if (sec && sec.classList.contains('collapsed') && typeof toggleStrongSection === 'function') toggleStrongSection(sec.id);
      setTimeout(() => { if (!card) return; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('pk-found'); setTimeout(() => card.classList.remove('pk-found'), 2200); }, 300);
    }, 450);
  }
  function openSection(page, sec) {
    window.showPage(page);
    setTimeout(() => {
      if (sec.style.display === 'none') { for (const t of sec.closest('.page').querySelectorAll('.pk-views .tab-btn')) { t.click(); if (sec.style.display !== 'none') break; } }
      setTimeout(() => { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); sec.classList.add('pk-found'); setTimeout(() => sec.classList.remove('pk-found'), 2200); }, 250);
    }, 450);
  }
  // French words typed in the search find the English labels
  const FR = { negatif: 'negative', negatifs: 'negative', prix: 'price', eolien: 'wind', eolienne: 'wind', solaire: 'solar', nucleaire: 'nuclear', charbon: 'coal', gaz: 'gas',
    prevision: 'forecast', previsions: 'forecast', consommation: 'consumption', carbone: 'carbon', parc: 'park', production: 'output', capacite: 'capacity', echanges: 'flows',
    stockage: 'storage', hydraulique: 'hydro', meteo: 'weather', garanties: 'guarantees', origine: 'origin', facture: 'bill', fourniture: 'supply', ecarts: 'imbalance',
    desequilibre: 'imbalance', interconnexion: 'flows', marche: 'market', actualites: 'news', alerte: 'alert', alertes: 'alerts', cannibalisation: 'cannibalisation',
    complement: 'complément', remuneration: 'complément', agregation: 'aggregation', taux: 'rate', cout: 'cost', couts: 'cost', fixe: 'fixed', regions: 'regions', region: 'region',
    ao: 'tender', aos: 'tender', appel: 'tender', appels: 'tender', offre: 'tender', offres: 'tender', cre: 'cre', spot: 'spot', terme: 'forward', jour: 'day', nucleaire: 'nuclear', indispo: 'unavailability', indisponibilites: 'unavailability', reservoirs: 'reservoirs', stocks: 'storage', go: 'go', ppa: 'ppa', m0: 'm0', capture: 'capture', convertisseur: 'converter', comparateur: 'comparator', rejouer: 'replay' };
  const tr = q => norm(q).split(/\s+/).filter(Boolean).map(w => FR[w] || w).join(' ');
  function openChart(w) {
    if (!w.page) return;
    if (w.page === 'prices') window.showPage('prices'); else window.showPage(w.page);
    setTimeout(() => {
      const c = w.pageCanvas && document.getElementById(w.pageCanvas);
      if (!c) return;
      // open the sub-page / view tab holding the chart
      const panel = c.closest('[data-subdomain-panel]');
      if (panel && window.prSelectSubdomain && !panel.classList.contains('active') && panel.dataset.subdomainPanel !== 'genmix') window.prSelectSubdomain(panel.dataset.subdomainPanel);
      const sec = c.closest('.hist-section-strong');
      if (sec && sec.style.display === 'none') {
        const root = c.closest('.page');
        const tabs = [...root.querySelectorAll('.pk-views .tab-btn')];
        // views.js hides the other views' sections: click tabs until the chart shows
        for (const t of tabs) { t.click(); if (sec.style.display !== 'none') break; }
      }
      setTimeout(() => {
        const card = c.closest('.chart-container') || c.parentElement;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('pk-found'); setTimeout(() => card.classList.remove('pk-found'), 2200);
      }, 250);
    }, 450);
  }

  // one typo allowed on words of 5 letters or more (a letter missing, extra or wrong)
  const near = (w, key) => { if (w.length < 5) return false; for (const t of key.split(/[^a-z0-9]+/)) { if (Math.abs(t.length - w.length) > 1) continue;
    let i = 0, j = 0, e = 0; while (i < w.length && j < t.length) { if (w[i] === t[j]) { i++; j++; continue; } if (++e > 1) break; if (w.length > t.length) i++; else if (t.length > w.length) j++; else { i++; j++; } }
    if (e + (w.length - i) + (t.length - j) <= 1) return true; } return false; };
  function score(o, q) {
    if (!q) return 0;
    const raw = norm(q).split(/\s+/).filter(w => w && !['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'en', 'a', 'the', 'of', 'and'].includes(w));
    if (!raw.length) return 0;
    let s = 0, hit = 0;
    for (const w0 of raw) { const ws = [w0, FR[w0]].filter(Boolean); let best = 0;
      for (const w of ws) { const i = o.key.indexOf(w); if (i >= 0) best = Math.max(best, o.lk.includes(w) ? (o.lk.startsWith(w) ? 4 : 3) : 1); else if (near(w, o.key)) best = Math.max(best, 0.8); }
      if (best) { hit++; s += best; } }
    if (hit < Math.ceil(raw.length * (raw.length > 2 ? 0.6 : 1))) return -1;   // every word for one or two words, most of them beyond
    return s + hit * 2 + (o.kind === 'Page' ? 1 : o.kind === 'Section' ? 0.5 : 0);
  }

  function close() { const m = document.getElementById('pk-search'); if (m) m.remove(); }
  function open() {
    if (!idx) idx = build();
    close();
    const bg = document.createElement('div');
    bg.id = 'pk-search';
    bg.innerHTML = `<div class="pk-s-box" role="dialog" aria-label="Search"><input type="search" placeholder="${window.PKI18n && PKI18n.lang !== 'en' ? 'Chercher une page ou un graphique… (ex. capture, nucléaire, appels d’offres, forward)' : 'Search a page or a chart…  (e.g. capture, nuclear, tenders, forward)'}" aria-label="Search">
      <div class="pk-s-list" role="listbox"></div><div class="pk-s-foot">↑↓ to move · Enter to open · Esc to close</div></div>`;
    document.body.appendChild(bg);
    const input = bg.querySelector('input'), list = bg.querySelector('.pk-s-list');
    let res = [], sel = 0;
    const draw = () => {
      const q = input.value.trim();
      res = q ? idx.map(o => [o, score(o, q)]).filter(x => x[1] >= 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]) : idx.filter(o => o.kind === 'Page').slice(0, 12);
      sel = Math.min(sel, Math.max(0, res.length - 1));
      list.innerHTML = res.map((o, i) => `<div class="pk-s-row${i === sel ? ' on' : ''}" data-i="${i}" role="option"><span class="pk-s-k ${o.kind.toLowerCase()}">${o.kind}</span><span class="pk-s-l">${esc(o.labelFr || o.label)}</span><span class="pk-s-sub">${esc(o.sub)}</span></div>`).join('') || '<div class="pk-s-empty">No match</div>';
      list.querySelectorAll('.pk-s-row').forEach(r => r.addEventListener('click', () => go(+r.dataset.i)));
    };
    const go = i => { const o = res[i]; if (!o) return; close(); o.go(); };
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, res.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { go(sel); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    draw(); input.focus();
  }

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    else if (e.key === 'Escape') close();
  });
  window.addEventListener('load', () => setTimeout(() => {
    const anchor = document.getElementById('pk-alert-bell') || document.getElementById('pk-status-badge');
    if (!anchor || document.getElementById('pk-search-btn')) return;
    const b = document.createElement('button');
    b.id = 'pk-search-btn'; b.type = 'button'; b.className = 'pk-alert-bell'; b.title = 'Search a page or a chart (Ctrl+K)';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    b.addEventListener('click', open);
    anchor.parentNode.insertBefore(b, anchor);
  }, 700));
  window.PKSearch = { open };

  const css = document.createElement('style');
  css.textContent = `
  #pk-search{position:fixed;inset:0;z-index:10050;background:rgba(5,8,12,.6);backdrop-filter:blur(2px);display:flex;justify-content:center;align-items:flex-start;padding:12vh 16px 16px}
  .pk-s-box{width:min(640px,100%);background:var(--bg2);border:1px solid var(--border2);border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}
  .pk-s-box input{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--text);font:15px 'Inter',sans-serif;padding:14px 16px;outline:none}
  .pk-s-list{max-height:52vh;overflow-y:auto;padding:6px}
  .pk-s-row{display:grid;grid-template-columns:56px minmax(0,1fr);grid-template-rows:auto auto;column-gap:10px;padding:8px 10px;border-radius:6px;cursor:pointer}
  .pk-s-row.on,.pk-s-row:hover{background:var(--accent-dim)}
  .pk-s-k{grid-row:1/3;align-self:center;font:600 9.5px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);border:1px solid var(--border2);border-radius:4px;text-align:center;padding:2px 0}
  .pk-s-k.page{color:var(--accent);border-color:rgba(20,211,169,.4)}
  .pk-s-k.section{color:#7FC8F8;border-color:rgba(127,200,248,.4)}
  .pk-s-l{font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pk-s-sub{font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pk-s-empty{padding:16px;color:var(--text3);font-size:12px;text-align:center}
  .pk-s-foot{padding:8px 14px;border-top:1px solid var(--border);font-size:10.5px;color:var(--text3)}
  .pk-found{box-shadow:0 0 0 2px var(--accent),0 0 24px rgba(20,211,169,.35)!important;transition:box-shadow .3s}
  `;
  document.head.appendChild(css);
})();
