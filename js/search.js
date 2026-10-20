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
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function build() {
    const out = [];
    document.querySelectorAll('.sidebar-item[onclick*="showPage"], .sidebar-subitem[data-page]').forEach(el => {
      const m = el.getAttribute('onclick').match(/showPage\('([^']+)'\)/); if (!m) return;
      const sec = el.closest('.sidebar-section');
      const group = sec ? (sec.querySelector('.sidebar-section-label') || {}).textContent : '';
      out.push({ kind: 'Page', label: el.textContent.trim(), sub: (group || '').trim(), go: () => window.showPage(m[1]) });
    });
    document.querySelectorAll('.sidebar-subitem[onclick*="prSelectSubdomain"]').forEach(el => {
      const m = el.getAttribute('onclick').match(/prSelectSubdomain\('([^']+)'\)/); if (!m) return;
      out.push({ kind: 'Page', label: 'Prices › ' + el.textContent.trim(), sub: 'Power', go: () => { window.showPage('prices'); window.prSelectSubdomain(m[1]); } });
    });
    if (window.PKW) PKW.list().forEach(w => {
      out.push({ kind: 'Chart', label: w.title, sub: [w.source, w.desc].filter(Boolean).join(' · '), w, go: () => openChart(w) });
    });
    out.forEach(o => { o.key = norm(o.label + ' ' + o.sub); });
    return out;
  }

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

  function score(o, q) {
    if (!q) return 0;
    const words = norm(q).split(/\s+/).filter(Boolean);
    let s = 0;
    for (const w of words) { const i = o.key.indexOf(w); if (i < 0) return -1; s += i === 0 ? 3 : norm(o.label).includes(w) ? 2 : 1; }
    return s + (o.kind === 'Page' ? 1 : 0);
  }

  function close() { const m = document.getElementById('pk-search'); if (m) m.remove(); }
  function open() {
    if (!idx) idx = build();
    close();
    const bg = document.createElement('div');
    bg.id = 'pk-search';
    bg.innerHTML = `<div class="pk-s-box" role="dialog" aria-label="Search"><input type="search" placeholder="Search a page or a chart…  (e.g. capture, nuclear, spark, forward)" aria-label="Search">
      <div class="pk-s-list" role="listbox"></div><div class="pk-s-foot">↑↓ to move · Enter to open · Esc to close</div></div>`;
    document.body.appendChild(bg);
    const input = bg.querySelector('input'), list = bg.querySelector('.pk-s-list');
    let res = [], sel = 0;
    const draw = () => {
      const q = input.value.trim();
      res = q ? idx.map(o => [o, score(o, q)]).filter(x => x[1] >= 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]) : idx.filter(o => o.kind === 'Page').slice(0, 12);
      sel = Math.min(sel, Math.max(0, res.length - 1));
      list.innerHTML = res.map((o, i) => `<div class="pk-s-row${i === sel ? ' on' : ''}" data-i="${i}" role="option"><span class="pk-s-k ${o.kind.toLowerCase()}">${o.kind}</span><span class="pk-s-l">${esc(o.label)}</span><span class="pk-s-sub">${esc(o.sub)}</span></div>`).join('') || '<div class="pk-s-empty">No match</div>';
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
  .pk-s-l{font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pk-s-sub{font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pk-s-empty{padding:16px;color:var(--text3);font-size:12px;text-align:center}
  .pk-s-foot{padding:8px 14px;border-top:1px solid var(--border);font-size:10.5px;color:var(--text3)}
  .pk-found{box-shadow:0 0 0 2px var(--accent),0 0 24px rgba(20,211,169,.35)!important;transition:box-shadow .3s}
  `;
  document.head.appendChild(css);
})();
