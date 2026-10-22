// ════════════════════════════════════════════════════════════════════
// visits.js · audience measurement (warehouse/migrations/014_site_visits.sql)
//   one row per page opened, written straight to Supabase (REST, publishable
//   key, insert only): a random id kept in this browser (no cookie, no third
//   party), the page, the referring site, phone / tablet / desktop, the
//   language, the account when signed in. "Do Not Track" is respected.
//   Data status shows the aggregates to signed-in users.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const URL = 'https://xtqeslyjtjrbjpffpixn.supabase.co', KEY = 'sb_publishable_mfgTs1zA6ZT69hU0DhXpnA_YmjpkRQ1';
  const off = navigator.doNotTrack === '1' || window.doNotTrack === '1' || /localhost|127\.0\.0\.1/.test(location.hostname) || navigator.webdriver;
  const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n / 2)), b => b.toString(16).padStart(2, '0')).join('');
  let visitor = null; try { visitor = localStorage.getItem('pk-v'); if (!/^[0-9a-f]{16}$/.test(visitor || '')) { visitor = hex(16); localStorage.setItem('pk-v', visitor); } } catch (_) { visitor = hex(16); }
  let session = null; try { session = sessionStorage.getItem('pk-s'); if (!/^[0-9a-f]{8}$/.test(session || '')) { session = hex(8); sessionStorage.setItem('pk-s', session); } } catch (_) { session = hex(8); }
  const device = /iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'phone' : 'desktop';
  let ref = null; try { const r = document.referrer && new window.URL(document.referrer); if (r && r.hostname !== location.hostname) ref = r.hostname.slice(0, 120); } catch (_) {}
  let last = null, lastAt = 0;
  async function token() {
    try { const c = window.PKAccount && window.PKAccount.user && window.PKAccount.client(); if (c) { const { data } = await c.auth.getSession(); return data && data.session ? data.session.access_token : null; } } catch (_) {}
    return null;
  }
  async function hit(page) {
    if (off || !page) return;
    const now = Date.now(); if (page === last && now - lastAt < 30000) return; last = page; lastAt = now;
    const t = await token();
    const body = { visitor, session, page: String(page).slice(0, 60), ref, device, lang: (navigator.language || '').slice(0, 12) || null };
    if (!t) body.user_id = null;
    try {
      await fetch(URL + '/rest/v1/site_visit', { method: 'POST', keepalive: true,
        headers: { apikey: KEY, Authorization: 'Bearer ' + (t || KEY), 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(body) });
    } catch (_) {}
    ref = null;   // the referring site counts for the first page only
  }
  async function rpc(fn, args) {
    const t = await token(); if (!t) return null;
    const r = await fetch(URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
    return r.ok ? r.json() : null;
  }
  // Data status: visitors of the last 30 days (signed-in users)
  async function renderStats() {
    const host = document.getElementById('status-visits'); if (!host) return;
    const [days, pages, refs] = await Promise.all([rpc('site_visit_stats', { days: 30 }), rpc('site_visit_pages', { days: 30 }), rpc('site_visit_refs', { days: 30 })]);
    if (!days) { host.innerHTML = '<div class="fuel-note">Sign in to see who visits the site (visitors, pages, referring sites).</div>'; return; }
    const tot = k => days.reduce((s, d) => s + (+d[k] || 0), 0);
    host.innerHTML = `<div class="kpi-strip fuel-kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:10px">${[
      _fuelKpi('Visitors, 30 days', tot('visitors').toLocaleString('en-GB'), '', 'distinct browsers per day, summed'),
      _fuelKpi('Visits', tot('sessions').toLocaleString('en-GB'), '', 'browser sessions'),
      _fuelKpi('Pages opened', tot('views').toLocaleString('en-GB'), '', 'page views'),
      _fuelKpi('Signed-in users', Math.max(0, ...days.map(d => +d.signed_in || 0)), '', 'most in a day')].join('')}</div>
      <div class="fuel-grid-2"><div class="chart-container fuel-card"><div class="fuel-card-head"><div><div class="table-title">Visitors per day</div></div></div><div style="position:relative;height:220px"><canvas id="status-visits-chart" style="width:100%;height:220px"></canvas></div></div>
      <div><table class="status-table"><thead><tr><th class="l">Page</th><th>Views</th><th>Visitors</th></tr></thead><tbody>${(pages || []).slice(0, 12).map(p => `<tr><td class="l">${p.page}</td><td>${p.views}</td><td>${p.visitors}</td></tr>`).join('')}</tbody></table>
      <table class="status-table" style="margin-top:10px"><thead><tr><th class="l">Coming from</th><th>Visitors</th></tr></thead><tbody>${(refs || []).map(r => `<tr><td class="l">${String(r.ref).replace(/[<>&"]/g, '')}</td><td>${r.visitors}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="fuel-note">Measured by the site itself: a random id kept in the browser, no cookie, nothing sent to a third party; “Do Not Track” is respected; rows kept 13 months. Who exactly (accounts, times): table public.site_visit in SQL.</div>`;
    if (window._fuelChart) _fuelChart('status-visits-chart', { type: 'bar', data: { labels: days.map(d => d.day), datasets: [
      { label: 'Visitors', data: days.map(d => +d.visitors), backgroundColor: 'rgba(127,200,248,.6)', borderRadius: 3 },
      { type: 'line', label: 'Pages opened', data: days.map(d => +d.views), borderColor: '#14D3A9', borderWidth: 1.6, pointRadius: 0, yAxisID: 'y1' }] },
      options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('visitors', { beginAtZero: true }), y1: _fuelAxis('pages', { position: 'right', beginAtZero: true, grid: { display: false } }) } }) }, 'site-visitors');
  }
  window.addEventListener('load', () => setTimeout(() => {
    const active = document.querySelector('.page.active'); hit(active ? active.id.replace(/^page-/, '') : 'home');
    const inner = window.showPage;
    if (typeof inner === 'function') window.showPage = function (id) { const r = inner.apply(this, arguments); hit(id); if (id === 'status') setTimeout(renderStats, 300); return r; };
  }, 0));
  window.PKVisits = { renderStats };
})();
