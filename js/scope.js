// ════════════════════════════════════════════════════════════════════
// SITE SCOPE — "All" (Europe) or "France".
// The France tab no longer opens a separate dashboard: it switches the
// whole site to a French preset, remembered per browser.
//   · landing page: France Morning;
//   · every page opens on France: zone / country selectors set to FR the
//     first time the page is shown (a selector the user changes is left
//     alone afterwards), price tables on France and its neighbours;
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
    if (scope !== 'FR') { if (p) p.remove(); return; }
    if (!p) {
      p = document.createElement('button');
      p.id = 'pk-scope-pill'; p.type = 'button'; p.className = 'pk-scope-pill';
      p.title = 'France view: pages open on France. Click to show all of Europe.';
      p.innerHTML = '🇫🇷 France view <span aria-hidden="true">×</span>';
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
  function setScope(s) {
    scope = s; ls.set(s); preset = new Set();
    applyChrome(); priceZones();
  }

  window.PKScope = {
    get: () => scope,
    zones: () => scope === 'FR' ? FR_ZONES.slice() : null,
    openLegacy() { legacy = true; origSwitch('france'); },
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
    const innerShow = window.showPage;
    window.showPage = function (id) {
      innerShow(id);
      if (scope === 'FR') { tabs('france'); presetPage(id); }
    };
    applyChrome();
    if (scope === 'FR') { priceZones(); window.showPage('morning'); }
  }, 0));

  const css = document.createElement('style');
  css.textContent = `
  .pk-scope-pill{display:inline-flex;align-items:center;gap:6px;margin-right:8px;padding:4px 10px;border-radius:999px;border:1px solid rgba(20,211,169,.45);background:rgba(20,211,169,.10);color:#14D3A9;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
  .pk-scope-pill span{opacity:.7;font-size:13px;line-height:1}
  .pk-scope-pill:hover{background:rgba(20,211,169,.18)}
  body.pk-scope-fr #sec-power-items{display:flex;flex-direction:column}
  body.pk-scope-fr #nav-morning{order:-4} body.pk-scope-fr #nav-frsystem{order:-3} body.pk-scope-fr #nav-regions{order:-2}
  body.pk-scope-fr #nav-imbalance{display:none}
  @media (max-width:760px){.pk-scope-pill{padding:3px 8px;font-size:10px;margin-right:4px}}
  `;
  document.head.appendChild(css);
})();
