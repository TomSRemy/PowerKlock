// Beta: the new page layout of docs/ETAT_DES_LIEUX_STRUCTURES.md, behind a switch in the top bar.
// Off by default: visitors see the site as it is. The owner turns it on with the "Bêta" button (or ?beta=1),
// the choice is kept in this browser, and the page reloads so each layout starts from a clean state.
// The beta only MOVES existing blocks (charts, tables, KPI strips) and renames sections: every chart keeps its
// own code, data and interactions, and nothing is removed. Pages are added one by one once validated.
// Since 20 Nov. 2026 the beta also carries a new shell (js/beta-shell.js, css/beta.css, loaded only when it is on):
// menu by job, search field, path and header on every page, site map, origination line on Today, one chart grid.
// scripts/inventory_site.py and scripts/inventory_diff.py prove that every chart, table and figure is still there.
(function () {
  let on = false;
  try { on = localStorage.getItem('pk-beta') === '1'; } catch (e) { /* storage blocked: beta stays off */ }
  const q = /[?&]beta=([01])/.exec(location.search);
  if (q) { on = q[1] === '1'; try { localStorage.setItem('pk-beta', on ? '1' : '0'); } catch (e) { /* ignore */ } }
  window.PKBeta = { on };
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  if (on) document.documentElement.classList.add('pk-beta');

  // ── Switch in the top bar ──
  function addButton() {
    const right = document.querySelector('.topbar-right');
    if (!right || document.getElementById('pk-beta-btn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'pk-beta-btn';
    b.className = 'pk-theme-btn pk-beta-btn' + (on ? ' on' : '');
    b.textContent = T('Bêta', 'Beta');
    b.title = on ? T('Bêta activée : revenir à la version actuelle', 'Beta on: back to the current version')
                 : T('Essayer la nouvelle organisation des pages', 'Try the new page layout');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.addEventListener('click', () => {
      try { localStorage.setItem('pk-beta', on ? '0' : '1'); } catch (e) { /* ignore */ }
      const u = new URL(location.href); u.searchParams.delete('beta'); location.replace(u.toString());
    });
    right.insertBefore(b, right.firstChild);
  }
  addButton();
  if (!on) return;
  // the shell: its style sheet is asked for by js/nav-v2.js before the first paint (never on the public page or a
  // shared dashboard); its script comes here, in order
  if (window.pkBetaShell) {
    if (document.readyState === 'loading') document.write('<script src="js/beta-shell.js"><\/script>');
    else { const sc = document.createElement('script'); sc.src = 'js/beta-shell.js'; document.body.appendChild(sc); }
  }

  const $ = id => document.getElementById(id);
  const crumbBar = parts => {
    const bar = document.createElement('div');
    bar.className = 'pr-tabs-sticky pk-beta-bar';
    bar.innerHTML = '<div class="pr-tabs-bar"><div class="pr-breadcrumb">' + parts.map((p, i) =>
      (i ? '<span class="pr-breadcrumb-sep">›</span>' : '') +
      `<span class="${i === parts.length - 1 ? 'pr-breadcrumb-current' : i === 0 ? 'pr-breadcrumb-parent' : 'pr-breadcrumb-parent-beta'}">${p}</span>`).join('') + '</div></div>';
    return bar;
  };
  const setTitle = (sectionId, text) => {
    const t = document.querySelector('#' + sectionId + ' .hist-section-title');
    if (!t) return;
    const node = [...t.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (node) node.textContent = text;
  };

  // ── Électricité spot › Vue d'ensemble (structure S1 Tableau de bord) ──
  // bar · market read · today's figures · intraday profile · fuels · forwards + heatmap · anomalies · links
  (function spotOverview() {
    const p = document.querySelector('[data-subdomain-panel="overview"]');
    if (!p) return;
    const labels = [...p.querySelectorAll(':scope > .pr-home-section-label')];
    const head = p.querySelector(':scope > .pr-overview-header');
    const sub = p.querySelector(':scope > .pr-overview-grid');
    const intra = p.querySelector(':scope > .pr-home-chart-card');
    const grid = p.querySelector(':scope > .fuel-grid-2');
    const anom = p.querySelector(':scope > .pr-home-anomalies-card');
    const kpi = $('pr-home-kpi-strip'), read = $('pr-home-market-read'), fuels = $('pr-home-fuels');
    if (labels.length !== 5 || !head || !sub || !intra || !grid || !anom || !kpi || !read || !fuels) return;   // layout changed: leave it as is
    const [subL, snapL, fuelsL, intraL, anomL] = labels;
    head.style.display = 'none';
    subL.textContent = T('Aller plus loin', 'Go further');
    const bar = crumbBar([T('Marchés', 'Markets'), T('Électricité spot', 'Power spot'), T('Vue d’ensemble', 'Overview')]);
    read.style.marginTop = '0';
    [bar, read, snapL, kpi, intraL, intra, fuelsL, fuels, grid, anomL, anom, subL, sub].forEach(n => p.appendChild(n));
  })();

  // ── Électricité spot › Day-ahead › Quotidien (structure S2 Analyse) ──
  // one market read at the top · all zones in the table (by price, a click opens the zone) · compared zones · trend
  (function dayAhead() {
    const daily = $('prtab-daily'), main = $('hs-prices-main'), banner = $('cc-analyst-banner-anchor');
    if (!daily || !main) return;
    if (banner) { banner.classList.add('pk-beta-read'); daily.insertBefore(banner, main); }
    setTitle('hs-prices-main', T('Toutes les zones · aujourd’hui', 'All zones · today'));
    setTitle('hs-cc-main', T('Zones comparées', 'Compared zones'));
    // the trend section sits beyond three screens: folded, one click away
    const trend = $('hs-spot-trend');
    if (trend) trend.classList.add('collapsed');
    // the table lists every zone by default (the 7-zone default stays for the compared-zones chart)
    const orig = window.applyDefaultGenMixZones;
    if (typeof orig === 'function') {
      window.applyDefaultGenMixZones = function () {
        orig.apply(this, arguments);
        window._pricesZoneFilter = null;
        if (typeof window.applyZoneFilter === 'function') window.applyZoneFilter();
      };
    }
    if (window._pricesSorted && typeof window.applyZoneFilter === 'function') { window._pricesZoneFilter = null; window.applyZoneFilter(); }
    // France stays easy to find among 30 rows: its row is highlighted
    const tb = $('prices-tbody');
    if (tb) {
      const mark = () => tb.querySelectorAll('tr.zone-row').forEach(tr => {
        const z = (window._pricesSorted || [])[+tr.dataset.rowIdx];
        tr.classList.toggle('pk-beta-hl', !!z && z.code === 'FR');
      });
      new MutationObserver(mark).observe(tb, { childList: true });
      mark();
    }
  })();

  // ── Beta notice ──
  const main = document.querySelector('main') || document.body;
  const note = document.createElement('div');
  note.className = 'pk-beta-note';
  note.innerHTML = T('<b>Version bêta</b> · nouvelle organisation de <i>Électricité spot › Vue d’ensemble</i> et <i>Day-ahead › Quotidien</i>. Bouton « Bêta » en haut pour revenir à la version actuelle.',
                     '<b>Beta</b> · new layout of <i>Power spot › Overview</i> and <i>Day-ahead › Daily</i>. “Beta” button at the top to go back to the current version.');
  main.insertBefore(note, main.firstChild);
})();
