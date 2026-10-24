// Page start-up (formerly inline at the end of index.html, same place in the load order):
// safety stubs, Prices sub-pages, sidebar and mobile drawer behaviour.
  // ─────────────────────────────────────────────────────────────
  // SAFETY STUBS · in case prices.js fails to load
  // These are no-ops if prices.js loaded successfully (it defines them first)
  // ─────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  // Toggle collapse on .hist-section-strong (Day-Ahead board, Cross-zone analysis)
  // Standalone — does NOT affect the older .hist-section blocks which stay always-open.
  // ─────────────────────────────────────────────────────────────
  window.toggleStrongSection = function(sectionId) {
    const sec = document.getElementById(sectionId);
    if (!sec || !sec.classList.contains('hist-section-strong')) return;
    sec.classList.toggle('collapsed');
  };

  (function ensureGlobalStubs() {
    if (typeof window.showPage !== 'function') {
      window.showPage = function(id) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
        const page = document.getElementById('page-' + id);
        const nav = document.getElementById('nav-' + id);
        if (page) page.classList.add('active');
        if (nav) nav.classList.add('active');
      };
    }
    if (typeof window.toggleSection !== 'function') {
      window.toggleSection = function(secId) {
        const sec = document.getElementById(secId);
        if (!sec) return;
        const items = sec.querySelector('.sidebar-section-items');
        if (!items) return;
        if (sec.classList.contains('collapsed')) {
          sec.classList.remove('collapsed');
          items.style.maxHeight = items.scrollHeight + 'px';
        } else {
          items.style.maxHeight = items.scrollHeight + 'px';
          requestAnimationFrame(() => { sec.classList.add('collapsed'); });
        }
      };
    }
  })();

  // Initialize all section max-heights so the collapse animation works
  function prInitSectionHeights() {
    document.querySelectorAll('.sidebar-section-items').forEach(el => {
      const sec = el.closest('.sidebar-section');
      if (sec && sec.classList.contains('collapsed')) {
        el.style.maxHeight = '0px';
      } else if (!el.style.maxHeight || el.style.maxHeight === '0px') {
        el.style.maxHeight = el.scrollHeight + 'px';
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Sync the .section-active class on the sidebar-section that contains
  // the currently active .sidebar-item
  // Also handle has-active-subitem state cleanup
  // ─────────────────────────────────────────────────────────────
  function prSyncActiveSection() {
    document.querySelectorAll('.sidebar-section').forEach(s => s.classList.remove('section-active'));
    const activeItem = document.querySelector('.sidebar-item.active');
    if (!activeItem) return;
    const parentSection = activeItem.closest('.sidebar-section');
    if (parentSection) parentSection.classList.add('section-active');

    // If the active item is NOT Prices, remove has-active-subitem from nav-prices
    // (this hides the subdomain sub-items and clears the false "active" green bg)
    const navPrices = document.getElementById('nav-prices');
    if (navPrices && activeItem.id !== 'nav-prices') {
      navPrices.classList.remove('has-active-subitem');
    }
  }

  function prOnDOMReady() {
    prInitSectionHeights();
    prSyncActiveSection();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prOnDOMReady);
  } else {
    prOnDOMReady();
  }

  // Hook into showPage so any change updates the active section
  (function hookShowPage() {
    const orig = window.showPage;
    if (typeof orig !== 'function') return;
    window.showPage = function(id) {
      orig.apply(this, arguments);
      prSyncActiveSection();
    };
  })();

  // Belt and suspenders : also sync on click
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', function() {
      setTimeout(prSyncActiveSection, 10);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Compute heights : grey line stops at last item, green path stops at active item
  // ─────────────────────────────────────────────────────────────
  function prUpdateActivePath() {
    const wrap = document.getElementById('prices-subitems');
    if (!wrap) return;

    const items = wrap.querySelectorAll('.sidebar-subitem');
    if (items.length === 0) return;

    const wrapTop = wrap.getBoundingClientRect().top;

    // Grey line ends at the middle of the LAST item
    const lastItem = items[items.length - 1];
    const lastRect = lastItem.getBoundingClientRect();
    const lineEnd = (lastRect.top + lastRect.height / 2) - wrapTop;
    wrap.style.setProperty('--line-end', lineEnd + 'px');

    // Green path ends at the middle of the ACTIVE item (if any)
    const active = wrap.querySelector('.sidebar-subitem.active');
    if (!active) {
      wrap.style.setProperty('--path-height', '0px');
      return;
    }
    const activeRect = active.getBoundingClientRect();
    const pathHeight = (activeRect.top + activeRect.height / 2) - wrapTop;
    wrap.style.setProperty('--path-height', pathHeight + 'px');
  }

  // ─────────────────────────────────────────────────────────────
  // Select a subdomain (called from sidebar sub-items, breadcrumb, or overview cards)
  // Attached to window explicitly so inline onclick="prSelectSubdomain(...)" works
  // reliably across browsers (Edge with Strict Tracking Prevention notably).
  // ─────────────────────────────────────────────────────────────
  window.prSelectSubdomain = function(target) {
    const page = document.getElementById('page-prices');
    if (!page) return;

    // Ensure we're on the prices page first
    const activePage = document.querySelector('.page.active');
    if (!activePage || activePage.id !== 'page-prices') {
      if (typeof window.showPage === 'function') window.showPage('prices');
    }

    // Update sidebar sub-items state
    document.querySelectorAll('.sidebar-subitem').forEach(s => s.classList.remove('active'));
    const sub = document.querySelector('.sidebar-subitem[data-subdomain="' + target + '"]');
    if (sub) sub.classList.add('active');

    // Update parent Prices visual state
    const parentNav = document.getElementById('nav-prices');
    if (parentNav) {
      if (target === 'overview') {
        parentNav.classList.remove('has-active-subitem');
      } else {
        parentNav.classList.add('has-active-subitem');
      }
    }

    // Switch subdomain panel
    page.querySelectorAll('.subdomain-panel').forEach(p => p.classList.remove('active'));
    const panel = page.querySelector('[data-subdomain-panel="' + target + '"]');
    if (panel) panel.classList.add('active');

    // Populate the overview home with live data once it becomes visible
    if (target === 'overview' && typeof window.prRenderHome === 'function') {
      // Defer one tick so layout settles before the chart is built
      setTimeout(() => window.prRenderHome(), 30);
    }

    // Negative prices (redesign) — render board + cross-zone on activation
    if (target === 'negative' && typeof window.negRenderAll === 'function') {
      setTimeout(() => window.negRenderAll(), 30);
    }
    // Negative prices (legacy) — keep the old renderer alive
    if (target === 'negative-legacy' && typeof window.renderHistNeg === 'function') {
      setTimeout(() => window.renderHistNeg(), 30);
    }
    // Spread — same first-render gap as negative-legacy had (chart stayed
    // empty until the user clicked a window pill button).
    if (target === 'spread' && typeof window.renderHistSpread === 'function') {
      setTimeout(() => window.renderHistSpread(), 30);
    }
    // Forward curve power — FR forward curve, nuclear, market insights (SEFE cockpit)
    if (target === 'forward' && typeof window.renderPrFwd === 'function') {
      setTimeout(() => window.renderPrFwd(), 30);
    }

    // Update the green path height
    prUpdateActivePath();

    // Scroll the scrollable container back to top
    const main = document.querySelector('.main');
    if (main) main.scrollTop = 0;
  };

  // Run once at load to compute the initial path (if any active sub-item)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prUpdateActivePath);
  } else {
    prUpdateActivePath();
  }

  // ─────────────────────────────────────────────────────────────
  // Override the Prices sidebar click: show overview by default
  // ─────────────────────────────────────────────────────────────
  (function setupPricesClick() {
    const navPrices = document.getElementById('nav-prices');
    if (!navPrices) return;
    // Remove the inline onclick that calls showPage('prices') and replace with a wrapper
    navPrices.onclick = function(e) {
      if (typeof window.showPage === 'function') window.showPage('prices');
      prSelectSubdomain('overview');
    };
  })();

  // ─────────────────────────────────────────────────────────────
  // Tab switch (Daily / Historical / Distribution within DA)
  // ─────────────────────────────────────────────────────────────
  function prTabNav(e) {
    const btn = e.currentTarget;
    const target = btn.dataset.tab;
    const daPanel = document.querySelector('[data-subdomain-panel="da"]');
    if (!daPanel) return;

    document.querySelectorAll('#pr-tabs-nav .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    daPanel.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const panel = daPanel.querySelector('[data-tab-panel="' + target + '"]');
    if (panel) panel.classList.add('active');

    // Switch global filters visibility in sticky bar
    document.querySelectorAll('.pk-gf-tabset').forEach(g => {
      g.style.display = (g.dataset.gfTab === target) ? 'flex' : 'none';
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Genmix tab nav · Daily / Historical (mirrors prTabNav)
  // ─────────────────────────────────────────────────────────────
  function gmTabNav(e) {
    const btn = e.currentTarget;
    const target = btn.dataset.tab;
    const gmPanel = document.getElementById('page-genmix');
    if (!gmPanel) return;

    document.querySelectorAll('#gm-tabs-nav .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Only switch .tab-panel children that are direct descendants of page-genmix
    // (NOT the .tab-panel inside #pr-da-sticky for Day-Ahead, etc.).
    gmPanel.querySelectorAll(':scope > .tab-panel').forEach(p => p.classList.remove('active'));
    const panel = gmPanel.querySelector(':scope > [data-tab-panel="' + target + '"]');
    if (panel) panel.classList.add('active');

    // Switch global filters visibility (Daily filters vs Historical filters)
    gmPanel.querySelectorAll('#gm-sticky .pk-gf-tabset').forEach(g => {
      g.style.display = (g.dataset.gfTab === target) ? 'inline-flex' : 'none';
    });

    // First-time activation of Historical: trigger its render
    if (target === 'historical' && typeof window._gmhRenderAll === 'function') {
      window._gmhRenderAll();
    }
  }
  window.gmTabNav = gmTabNav;

  // ─────────────────────────────────────────────────────────────
  // GO Prices · EU / France Auction tab nav
  // ─────────────────────────────────────────────────────────────
  function goTabNav(e) {
    const btn = e.currentTarget;
    const target = btn.dataset.tab;
    const goPanel = document.getElementById('page-goprices');
    if (!goPanel) return;

    document.querySelectorAll('#go-tabs-nav .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    goPanel.querySelectorAll(':scope > .tab-panel').forEach(p => p.classList.remove('active'));
    const panel = goPanel.querySelector(':scope > [data-tab-panel="' + target + '"]');
    if (panel) panel.classList.add('active');

    // The auction charts may have been built while this tab was hidden
    // (display:none at construction time gives Chart.js a 0-width canvas);
    // redraw once the tab becomes visible so they size correctly. Cheap
    // and safe to call every time — both functions just show a "no data"
    // placeholder if GO_AUCTIONS hasn't loaded yet.
    if (target === 'auctions' && typeof drawGoAuctionTechChart === 'function') {
      drawGoAuctionTechChart(); drawGoAuctionVolChart();
    }
  }
  window.goTabNav = goTabNav;

  // ─────────────────────────────────────────────────────────────
  // Genmix · Latest data refresh (stub — fires data reload event)
  // ─────────────────────────────────────────────────────────────
  function gmRefreshData() {
    // Re-trigger the data loader (if available) by dispatching the event
    // listened to by renderGmMain / renderGmdczMain. If not wired, reload page.
    if (typeof window._loadGenmix === 'function') {
      window._loadGenmix();
    } else {
      document.dispatchEvent(new CustomEvent('genmix-loaded'));
    }
    const btn = document.getElementById('gm-gf-refresh');
    if (btn) {
      const old = btn.innerHTML;
      btn.innerHTML = '✓ Refreshed';
      setTimeout(() => { btn.innerHTML = old; }, 1500);
    }
  }
  window.gmRefreshData = gmRefreshData;

  // ─────────────────────────────────────────────────────────────
  // Global filters · HISTORICAL period
  // Pilots ho (overview), hsz (single zone), hmz (compare zones)
  // and keeps the local hw-* button states in sync.
  // ─────────────────────────────────────────────────────────────
  function pkSetGlobalHistWindow(w, btn) {
    // Update global group button state (A-mode pills + popup pills both)
    document.querySelectorAll('#pk-gf-hist-period .pk-gf-btn, #pk-gf-hist-time-popup .pk-gf-popup-pill').forEach(b => {
      if (b.dataset.w === w) b.classList.add('active');
      else b.classList.remove('active');
    });
    // Propagate to existing per-bloc window state
    if (typeof HIST !== 'undefined' && HIST && HIST.windows) {
      HIST.windows['ho']  = w;
      HIST.windows['hsz'] = w;
      HIST.windows['hmz'] = w;
      HIST.customRange = null;
    }
    // Sync local hw-* buttons (so legacy UI reflects the global choice)
    ['hw-ho', 'hw-hsz', 'hw-hmz'].forEach(id => {
      const wrap = document.getElementById(id);
      if (!wrap) return;
      wrap.querySelectorAll('.hw-btn').forEach(b => {
        if (b.textContent.trim() === w) b.classList.add('active');
        else b.classList.remove('active');
      });
    });
    // Clear local custom date inputs (consistent with setHistWindow behaviour)
    const dfEl = document.getElementById('ho-date-from');
    const dtEl = document.getElementById('ho-date-to');
    if (dfEl) dfEl.value = '';
    if (dtEl) dtEl.value = '';
    // Clear popup date inputs too
    const dfP = document.getElementById('ho-date-from-popup');
    const dtP = document.getElementById('ho-date-to-popup');
    if (dfP) dfP.value = '';
    if (dtP) dtP.value = '';
    // Update C-mode combo button label
    pkUpdateTimeComboLabel(w, null, null);
    // Auto-tune HMZ heatmap granularity for the new window (resets any
    // manual override the user did inside the previous window). Matches
    // setHistWindow() behaviour.
    if (typeof _hmzApplyAutoHeatmapMode === 'function') {
      _hmzApplyAutoHeatmapMode();
    }
    // Re-render the historical blocks
    if (typeof renderHistOverview === 'function') renderHistOverview();
    if (typeof renderHistMulti   === 'function') renderHistMulti();
  }
  window.pkSetGlobalHistWindow = pkSetGlobalHistWindow;

  // ─────────────────────────────────────────────────────────────
  // Historical time-combo (C-mode, narrow screens ≤1200px) helpers
  // ─────────────────────────────────────────────────────────────
  function pkToggleTimePopup() {
    const popup = document.getElementById('pk-gf-hist-time-popup');
    if (!popup) return;
    popup.style.display = (popup.style.display === 'none' || !popup.style.display) ? 'block' : 'none';
  }
  window.pkToggleTimePopup = pkToggleTimePopup;

  function pkPickTimeFromPopup(w) {
    // Find the matching A-mode pill so existing handler logic runs identically
    const btn = document.querySelector(`#pk-gf-hist-period .pk-gf-btn[data-w="${w}"]`);
    if (btn) pkSetGlobalHistWindow(w, btn);
    // Close popup
    const popup = document.getElementById('pk-gf-hist-time-popup');
    if (popup) popup.style.display = 'none';
  }
  window.pkPickTimeFromPopup = pkPickTimeFromPopup;

  function pkPickCustomFromPopup() {
    const dfP = document.getElementById('ho-date-from-popup');
    const dtP = document.getElementById('ho-date-to-popup');
    if (!dfP || !dtP || !dfP.value || !dtP.value) return;
    // Mirror to A-mode date inputs and trigger existing handler
    const df = document.getElementById('ho-date-from');
    const dt = document.getElementById('ho-date-to');
    if (df) df.value = dfP.value;
    if (dt) dt.value = dtP.value;
    if (typeof setHistCustomRange === 'function') setHistCustomRange();
    // Deactivate all period pills (custom range cancels any preset)
    document.querySelectorAll('#pk-gf-hist-period .pk-gf-btn, #pk-gf-hist-time-popup .pk-gf-popup-pill').forEach(b => b.classList.remove('active'));
    pkUpdateTimeComboLabel(null, dfP.value, dtP.value);
    // Close popup
    const popup = document.getElementById('pk-gf-hist-time-popup');
    if (popup) popup.style.display = 'none';
  }
  window.pkPickCustomFromPopup = pkPickCustomFromPopup;

  // Update the C-mode combo button label to reflect the current selection
  // (called from both pill picks and custom-range picks).
  function pkUpdateTimeComboLabel(period, from, to) {
    const periodEl = document.getElementById('pk-gf-hist-time-period');
    const rangeEl  = document.getElementById('pk-gf-hist-time-range');
    if (!periodEl || !rangeEl) return;
    const fmt = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    };
    if (from && to) {
      periodEl.textContent = 'Custom';
      rangeEl.textContent = `${fmt(from)} → ${fmt(to)}`;
    } else if (period) {
      periodEl.textContent = period;
      // Compute date range from period for display
      const today = new Date();
      const start = new Date(today);
      const map = { '7D': 7, '1M': 30, '3M': 90, '6M': 180, 'YTD': null, '1Y': 365, '2Y': 730, '5Y': 1825, 'All': null };
      const days = map[period];
      if (days != null) start.setDate(start.getDate() - days);
      else if (period === 'YTD') start.setMonth(0, 1);
      else if (period === 'All') { rangeEl.textContent = ''; return; }
      rangeEl.textContent = `${fmt(start)} → ${fmt(today)}`;
    }
  }
  window.pkUpdateTimeComboLabel = pkUpdateTimeComboLabel;

  // Initialise label on load (default 3M)
  setTimeout(() => pkUpdateTimeComboLabel('3M', null, null), 100);

  // Close popup on outside click
  document.addEventListener('click', (e) => {
    const popup = document.getElementById('pk-gf-hist-time-popup');
    if (!popup || popup.style.display === 'none') return;
    if (!e.target.closest('.pk-gf-cmode')) {
      popup.style.display = 'none';
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Responsive A↔C bascule: detect real overflow (not fixed breakpoint).
  // The parent .pr-tabs-bar has flex-wrap:wrap so when content doesn't fit
  // on one line, the row's height grows (filters drop to a second line).
  // We measure the row's height: a single line ≈ 32-40px, a wrapped row ≈ 60-80px.
  // If the row is taller than ~50px, switch the Historical filter tabset to C-mode.
  // ─────────────────────────────────────────────────────────────
  function pkCheckFilterOverflow() {
    const row = document.querySelector('#pr-da-sticky .pr-tabs-bar');
    const tabset = document.querySelector('.pk-gf-tabset[data-gf-tab="historical"]');
    if (!row || !tabset) return;
    // Step 1: remove the narrow class to measure the natural height with A-mode visible
    tabset.classList.remove('pk-gf-narrow');
    // Force a reflow then measure
    void row.offsetHeight;
    const rowH = row.offsetHeight;
    // Threshold: if the row is taller than ~50px, it has wrapped (default ≈ 38-42px)
    if (rowH > 50) {
      tabset.classList.add('pk-gf-narrow');
    }
  }
  window.pkCheckFilterOverflow = pkCheckFilterOverflow;

  // Hook to: initial load, window resize, and DOM mutations in the sticky bar
  setTimeout(pkCheckFilterOverflow, 150);
  window.addEventListener('resize', pkCheckFilterOverflow);
  // Also re-check after tab switches (different tab → different filter visible)
  document.querySelectorAll('#pr-tabs-nav .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setTimeout(pkCheckFilterOverflow, 50));
  });
  // ResizeObserver for any layout change to the sticky bar
  if (typeof ResizeObserver !== 'undefined') {
    const row = document.querySelector('#pr-da-sticky .pr-tabs-bar');
    if (row) {
      const ro = new ResizeObserver(() => pkCheckFilterOverflow());
      ro.observe(row);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Global filters · DISTRIBUTION period (1Y / 2Y / 5Y / All)
  // ─────────────────────────────────────────────────────────────
  function pkSetGlobalDistWindow(w, btn) {
    const grp = btn.closest('.pk-gf-group');
    if (grp) {
      grp.querySelectorAll('.pk-gf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    if (typeof HIST !== 'undefined' && HIST && HIST.windows) {
      HIST.windows['dist'] = w;
    }
    // Sync local hw-dist buttons
    const wrap = document.getElementById('hw-dist');
    if (wrap) {
      wrap.querySelectorAll('.hw-btn').forEach(b => {
        if (b.textContent.trim().toLowerCase() === String(w).toLowerCase()) b.classList.add('active');
        else b.classList.remove('active');
      });
    }
    if (typeof renderHistDist === 'function') renderHistDist();
  }
  window.pkSetGlobalDistWindow = pkSetGlobalDistWindow;

  // ─────────────────────────────────────────────────────────────
  // Global Distribution zone selector (delegates to setHistZone for 'dist')
  // ─────────────────────────────────────────────────────────────
  function pkOpenDistZoneSelect() {
    // Try to focus the existing local select; if not present, open a minimal prompt
    const localSel = document.querySelector('select[onchange*="setHistZone(\'dist\'"], #hz-dist');
    if (localSel) {
      localSel.focus();
      try { localSel.click(); } catch (_) {}
      return;
    }
    // Fallback: cycle through a default zone list
    const zones = ['FR','DE_LU','BE','NL','ES','PT','IT_NORD','AT','CH','GB'];
    const current = (typeof HIST !== 'undefined' && HIST && HIST.zones && HIST.zones['dist']) || 'FR';
    const idx = Math.max(0, zones.indexOf(current));
    const next = zones[(idx + 1) % zones.length];
    if (typeof setHistZone === 'function') setHistZone('dist', next);
    pkSyncDistZoneLabel(next);
  }
  window.pkOpenDistZoneSelect = pkOpenDistZoneSelect;

  function pkSyncDistZoneLabel(zone) {
    const lbl = document.getElementById('pk-gf-dist-zone-label');
    if (lbl) lbl.textContent = zone;
  }
  window.pkSyncDistZoneLabel = pkSyncDistZoneLabel;

  // ─────────────────────────────────────────────────────────────
  // Sticky bar scroll shadow
  // Adds .pk-scrolled to .pr-tabs-sticky when its top edge has scrolled
  // past the viewport top (i.e. it is in its "sticky" state).
  // ─────────────────────────────────────────────────────────────
  (function initStickyScrollShadow() {
    function update() {
      document.querySelectorAll('.pr-tabs-sticky').forEach(el => {
        const rect = el.getBoundingClientRect();
        // When sticking (top <= 0 within a small margin), apply shadow
        if (rect.top <= 1) el.classList.add('pk-scrolled');
        else el.classList.remove('pk-scrolled');
      });
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // Initial state
    setTimeout(update, 0);
  })();

  // ─────────────────────────────────────────────────────────────
  // Toggle sidebar collapse/expand
  // ─────────────────────────────────────────────────────────────
  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('collapsed');
  }

  // Keyboard shortcut: Ctrl+B (or Cmd+B on Mac) to toggle sidebar
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // ── MOBILE: sidebar drawer toggle ──
  function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('mobile-backdrop');
    if (!sidebar || !backdrop) return;
    const willOpen = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    backdrop.classList.toggle('open', willOpen);
    // Prevent body scroll when drawer is open
    document.body.style.overflow = willOpen ? 'hidden' : '';
  }
  window.toggleMobileSidebar = toggleMobileSidebar;

  // Auto-close drawer after navigation (mobile only)
  document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.addEventListener('click', (e) => {
      // Only auto-close if we're in mobile drawer mode (open class active)
      if (!sidebar.classList.contains('open')) return;
      // Close only when clicking a navigable item (not section labels)
      const clickedNav = e.target.closest('.sidebar-item, .sidebar-subitem, .mobile-dash-tab');
      // folding / unfolding a menu group is not a navigation: keep the drawer open
      if (e.pkFold || e.target.closest('.pk-nav-group, .pk-nav-chev')) return;
      if (clickedNav) {
        // Small delay so the navigation has time to register first
        setTimeout(() => { if (sidebar.classList.contains('open')) toggleMobileSidebar(); }, 120);   // close, never re-open
      }
    });
  });

  // Close drawer if user resizes back to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      const sidebar = document.getElementById('sidebar');
      const backdrop = document.getElementById('mobile-backdrop');
      if (sidebar) sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');
      document.body.style.overflow = '';
    }
  });

