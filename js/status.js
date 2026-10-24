// ════════════════════════════════════════════════════════════════════
// status.js · data freshness for the whole site
// ────────────────────────────────────────────────────────────────────
// Every source PowerKlock shows, with its last update, the cadence it is
// expected to follow and a status: ok / late / error. Drives the badge in
// the top bar and the "Data status" page (General → Data status), so the
// team sees at a glance when a number is not current.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const H = 3600e3;
  const parisDay = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const parisHM = (d) => d.toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  const fmt = (d) => d ? parisDay(d) + ' ' + parisHM(d) : '–';
  const getJSON = (f) => fetch(DATA_BASE + f + (f.includes('?') ? '&' : '?') + 't=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
  const exists = (f) => fetch(DATA_BASE + f + '?t=' + Date.now(), { method: 'HEAD' }).then(r => r.ok).catch(() => false);
  // Business days between d and now (SEFE publishes on trading days only).
  function businessHours(d) {
    let h = 0, t = new Date(d.getTime());
    while (t < Date.now()) { const wd = t.getUTCDay(); if (wd !== 0 && wd !== 6) h++; t = new Date(t.getTime() + H); }
    return h;
  }

  // kind: 'repo' = file written by GitHub Actions; 'live' = read by the browser from the provider.
  const SOURCES = [
    { id: 'prices', label: 'Day-ahead prices (today)', provider: 'ENTSO-E A44', kind: 'repo', cadence: '05:00 and 12:00 UTC',
      async check() { const j = await getJSON('prices.json'); const d = j && j.updated ? new Date(j.updated) : null; return { at: d, late: d && Date.now() - d > 14 * H, detail: j ? j.zones.length + ' zones' : '' }; } },
    { id: 'tomorrow', label: 'Day-ahead prices (tomorrow)', provider: 'ENTSO-E A44', kind: 'repo', cadence: 'after the 12:00 CET auction, fetched ~14:00',
      async check() {
        const t = new Date(Date.now() + 24 * H), ds = parisDay(t);
        const ok = await exists('history/daily/' + ds + '.json');
        const hm = +parisHM(new Date()).replace(':', '');
        // The 12:00 UTC run is often delayed by GitHub's scheduler: late only after 17:00 Paris.
        return { at: null, late: !ok && hm >= 1700, pending: !ok && hm < 1700, detail: ok ? 'delivery ' + ds + ' published' : (hm < 1700 ? 'expected after ~14:00' : 'not published yet') };
      } },
    { id: 'genmix', label: 'Generation mix', provider: 'ENTSO-E A75', kind: 'repo', cadence: 'with day-ahead fetch',
      async check() { const j = await getJSON('genmix.json'); const d = j && j.updated ? new Date(j.updated) : null; return { at: d, late: d && Date.now() - d > 14 * H }; } },
    { id: 'renewables', label: 'Wind & solar (actual + forecast)', provider: 'ENTSO-E A75 / A69', kind: 'repo', cadence: 'with day-ahead fetch',
      async check() { const j = await getJSON('renewables.json'); const d = j && j.updated ? new Date(j.updated) : null; return { at: d, late: d && Date.now() - d > 14 * H }; } },
    { id: 'load', label: 'Load (ENTSO-E zones)', provider: 'ENTSO-E A65', kind: 'repo', cadence: 'with day-ahead fetch',
      async check() { const j = await getJSON('load.json'); const d = j && j.updated ? new Date(j.updated) : null; return { at: d, late: d && Date.now() - d > 14 * H }; } },
    { id: 'crossborder', label: 'Cross-border flows (ENTSO-E zones)', provider: 'ENTSO-E A11', kind: 'repo', cadence: 'with day-ahead fetch',
      async check() {
        const j = await getJSON('crossborder.json'); const d = j && j.updated ? new Date(j.updated) : null;
        const any = j && j.countries && Object.values(j.countries).some(fl => (fl || []).some(f => f.imports || f.exports));
        return { at: d, late: d && Date.now() - d > 14 * H, error: j && !any, detail: j && !any ? 'feed returned no flow values' : '' };
      } },
    { id: 'commodities', label: 'Fuels, carbon, FX, nuclear availability', provider: 'Market data feed', kind: 'repo', cadence: 'trading days, 06:30 UTC',
      async check() { const j = await getJSON('commodities.json'); const d = j && j.updated ? new Date(j.updated) : null; return { at: d, late: d && businessHours(d) > 30 }; } },
    { id: 'forwards', label: 'Power forward curves', provider: 'Market data feed', kind: 'repo', cadence: 'trading days, 06:30 UTC',
      async check() { const j = await getJSON('fr_market.json'); const d = j && j.forwardCurveDate ? new Date(j.forwardCurveDate + 'T17:00:00Z') : null; return { at: d, late: d && businessHours(d) > 40, detail: j ? 'settlement ' + j.forwardCurveDate : '' }; } },
    { id: 'news', label: 'News feeds', provider: 'RSS (Montel, Euractiv…)', kind: 'repo', cadence: 'every 3 h + with day-ahead fetch',
      async check() { const j = await getJSON('news.json'); const d = j && j.updated ? new Date(j.updated) : null; return { at: d, late: d && Date.now() - d > 14 * H, detail: j && j.items ? j.items.length + ' items' : '' }; } },
    { id: 'go', label: 'Guarantees of origin (broker quotes)', provider: 'Commerg', kind: 'repo', cadence: 'weekly, Friday',
      async check() {
        const txt = await fetch(DATA_BASE + 'go_prices.csv?t=' + Date.now()).then(r => r.ok ? r.text() : '').catch(() => '');
        const dates = txt.split('\n').slice(1).map(l => l.split(',')[1]).filter(Boolean).sort();
        const d = dates.length ? new Date(dates[dates.length - 1] + 'T12:00:00Z') : null;
        return { at: d, late: d && Date.now() - d > 10 * 24 * H };
      } },
    { id: 'goauct', label: 'Guarantees of origin (state auctions)', provider: 'EEX', kind: 'repo', cadence: 'monthly',
      async check() { const j = await getJSON('go_auctions.json'); const d = j && j.updated ? new Date(j.updated + (j.updated.length === 10 ? 'T12:00:00Z' : '')) : null; return { at: d, late: d && Date.now() - d > 40 * 24 * H }; } },
    { id: 'ecflows', label: 'Cross-border physical flows (11 countries)', provider: 'Energy-Charts', kind: 'repo', cadence: '05:40 and 15:40 UTC',
      async check() {
        const ym = pkTodayISO().slice(0, 7);
        const j = await getJSON('history/flows/' + ym + '.json');
        const d = j && j.updated ? new Date(j.updated) : null;
        return { at: d, late: !d || Date.now() - d > 30 * H, detail: j ? Object.keys(j.days || {}).length + ' days this month' : 'no file this month' };
      } },
    { id: 'eccap', label: 'Installed capacity', provider: 'Energy-Charts', kind: 'repo', cadence: 'daily (yearly figures)',
      async check() { const j = await getJSON('history/capacity.json'); const d = j && j.updated ? new Date(j.updated) : null; return { at: d, late: d && Date.now() - d > 8 * 24 * H, detail: j ? Object.keys(j.countries || {}).length + ' countries' : '' }; } },
    { id: 'rte', label: 'France generation (archive)', provider: 'RTE éCO2mix (ODRÉ)', kind: 'repo', cadence: '06:10 and 18:10 UTC',
      async check() {
        const ym = pkTodayISO().slice(0, 7);
        const j = await getJSON('history/rte/' + ym + '.json');
        const d = j && j.updated ? new Date(j.updated) : null;
        const days = j && j.days ? Object.keys(j.days).sort() : [];
        return { at: d, late: !d || Date.now() - d > 30 * H, detail: days.length ? 'up to ' + days[days.length - 1] + ' · today read live from ODRÉ' : 'no file this month' };
      } },
    { id: 'wxout', label: 'Weather outlook (5 weeks vs normal)', provider: 'Open-Meteo (GFS ensemble, ERA5)', kind: 'repo', cadence: 'daily 07:30 UTC',
      async check() { const j = await getJSON('weather_outlook.json'); const d = j && j.updated ? new Date(j.updated) : null; return { at: d, late: !d || Date.now() - d > 30 * H, detail: j && j.countries ? Object.keys(j.countries).length + ' countries' : '' }; } },
    { id: 'm0', label: 'France M0 reference prices (wind, solar)', provider: 'RTE (ODRÉ)', kind: 'repo', cadence: 'daily check, RTE publishes monthly',
      async check() {
        const j = await getJSON('m0.json'); const d = j && j.updated ? new Date(j.updated) : null;
        const last = j && j.months && j.months.length ? j.months[j.months.length - 1].month : null;
        const lag = last ? (Date.parse(pkTodayISO().slice(0, 7) + '-01') - Date.parse(last + '-01')) / (24 * H) : 999;
        return { at: d, late: !d || Date.now() - d > 3 * 24 * H || lag > 75, detail: last ? 'latest month ' + last : 'no file' };
      } },
    { id: 'e2m', label: 'France load & exchanges (real time)', provider: 'RTE éCO2mix', kind: 'live', cadence: 'every 15 min',
      async check() {
        if (!window.PK_E2M) return { error: true, detail: 'module not loaded' };
        const d = await PK_E2M.day(pkTodayISO());
        if (!d) return { error: true, detail: 'ODRÉ not reachable' };
        let i = -1; d.consommation.forEach((v, k) => { if (v != null) i = k; });
        if (i < 0) return { error: true, detail: 'nothing published today' };
        const off = window.pkGenAlign ? pkGenAlign.parisOffset(pkTodayISO()) : 2;
        const at = new Date(Date.parse(pkTodayISO() + 'T00:00:00Z') - off * H + (i + 1) * 15 * 60e3);
        return { at, late: Date.now() - at > 3 * H, detail: (i + 1) + '/96 quarter-hours' };
      } },
    { id: 'elia', label: 'Belgian imbalance prices', provider: 'Elia open data', kind: 'live', cadence: 'every 15 min',
      async check() {
        const j = await fetch('https://opendata.elia.be/api/explore/v2.1/catalog/datasets/ods162/records?select=datetime&order_by=datetime%20desc&limit=1').then(r => r.ok ? r.json() : null).catch(() => null);
        const r = j && j.results && j.results[0];
        if (!r) return { error: true, detail: 'Elia API not reachable' };
        const at = new Date(r.datetime);
        return { at, late: Date.now() - at > 2 * H };
      } },
    { id: 'meteo', label: 'Weather forecast', provider: 'Open-Meteo', kind: 'live', cadence: 'on request',
      async check() {
        if (typeof _wxForecast !== 'function') return { error: true, detail: 'module not loaded' };
        const r = await _wxForecast('FR', 1);
        return r ? { at: new Date(), detail: 'reachable' } : { error: true, detail: 'not reachable (rate limit or network)' };
      } },
  ];

  let last = null, running = null;
  function state(r) { return r.error ? 'error' : r.late ? 'late' : r.pending ? 'pending' : 'ok'; }

  function run() {
    if (running) return running;
    // A provider that does not answer within 10 s is reported, not waited for.
    const timeout = () => new Promise(res => setTimeout(() => res({ error: true, detail: 'no answer within 10 s' }), 10000));
    running = Promise.all(SOURCES.map(s => Promise.race([s.check(), timeout()]).catch(e => ({ error: true, detail: e.message || String(e) }))
      .then(r => Object.assign({ source: s }, r, { state: state(r) }))))
      .then(rs => { last = rs; running = null; renderBadge(); return rs; });
    return running;
  }

  function renderBadge() {
    const el = document.getElementById('pk-status-badge');
    if (!el || !last) return;
    const issues = last.filter(r => r.state === 'late' || r.state === 'error');
    const err = issues.some(r => r.state === 'error');
    el.classList.toggle('pk-status-warn', issues.length > 0 && !err);
    el.classList.toggle('pk-status-err', err);
    el.querySelector('.pk-status-txt').textContent = issues.length ? issues.length + (issues.length > 1 ? ' sources need attention' : ' source needs attention') : 'Data up to date';
    el.dataset.short = issues.length ? issues.length + ' ⚠' : 'OK';   // phones (index.html CSS)
    el.title = issues.length ? issues.map(r => r.source.label + ': ' + r.state).join('\n') + '\nClick for details' : 'All sources up to date · click for details';
  }

  async function renderStatusPage() {
    const host = document.getElementById('status-sources');
    if (!host) return;
    host.innerHTML = '<tr><td colspan="6" style="color:var(--text3);padding:14px">Checking sources…</td></tr>';
    const rs = await run();
    const pill = s => `<span class="pk-st pk-st-${s}">${{ ok: 'Up to date', late: 'Late', error: 'Error', pending: 'Pending' }[s]}</span>`;
    host.innerHTML = rs.map(r => `<tr>
        <td class="l">${r.source.label}</td><td class="l">${r.source.provider}</td>
        <td class="l">${r.source.kind === 'live' ? 'browser, live' : 'repository'}</td>
        <td>${fmt(r.at)}</td><td class="l">${r.source.cadence}</td>
        <td class="l">${pill(r.state)}${r.detail ? ' <span style="color:var(--text3)">' + r.detail + '</span>' : ''}</td></tr>`).join('');
    document.getElementById('status-checked').textContent = 'Checked ' + fmt(new Date()) + ' (Paris)';

    // Feed problems found while loading data (js/data.js pkSanitizeZones…)
    const fi = document.getElementById('status-issues');
    const issues = window.PK_FEED_ISSUES || [];
    fi.innerHTML = issues.length ? issues.map(i => `<li><b>${i.code}</b> · ${i.date} · ${i.issue} — excluded from tables, KPIs and charts.</li>`).join('')
      : '<li style="color:var(--text3)">No feed problem detected in the data loaded on this page.</li>';
    // errors met by this browser since the page was opened (js/net.js)
    const er = window.PK_ERRORS || [];
    if (er.length) fi.insertAdjacentHTML('beforeend', er.slice(-10).map(e => `<li><b>Error</b> · ${String(e.at).slice(11, 16)} UTC · ${String(e.page).replace(/[<>&"]/g, '')} · ${String(e.msg).replace(/[<>&"]/g, '')} <span style="color:var(--text3)">${String(e.where).replace(/[<>&"]/g, '')}</span></li>`).join(''));

    // History depth per zone (daily files, via summary.json)
    const cov = document.getElementById('status-coverage');
    const s = typeof fetchSummary === 'function' ? await fetchSummary() : null;
    if (!s || !s.zones) { cov.innerHTML = '<tr><td colspan="4" style="color:var(--text3)">summary.json not available</td></tr>'; return; }
    const rows = Object.entries(s.zones).map(([z, ser]) => {
      const days = (ser || []).filter(e => e.avg != null).map(e => e.d).sort();
      return { z, first: days[0], last: days[days.length - 1], n: days.length };
    }).filter(r => r.n).sort((a, b) => (a.first || '').localeCompare(b.first || '') || a.z.localeCompare(b.z));
    cov.innerHTML = rows.map(r => {
      const span = Math.round((Date.parse(r.last) - Date.parse(r.first)) / 864e5) + 1;
      return `<tr><td class="l"><b>${r.z}</b></td><td>${r.first}</td><td>${r.last}</td><td>${r.n.toLocaleString('en-GB')} days${r.n < span ? ' <span style="color:var(--warn)">(' + (span - r.n) + ' missing)</span>' : ''}</td></tr>`;
    }).join('');
  }

  window.PKStatus = { run, renderStatusPage, SOURCES };
  // First check shortly after boot, then every 10 minutes.
  setTimeout(run, 8000);
  setInterval(run, 10 * 60e3);
})();

// ── Holes in the data (scripts/check_data_gaps.py → data/data_gaps.json, every 2 hours) ──
//    what is missing inside the histories, since when, how it gets repaired, and what came back
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = s => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '–';
  const NAME = { prices: 'Day-ahead prices', generation: 'France production by source', rte: 'RTE éCO2mix', commodities: 'Fuels and carbon', forwards: 'Power forwards', cr: 'Parks under CR (ODRÉ)', activation: 'Activation prices', pricecheck: 'Prices vs second source', gencheck: 'France production vs second source', mktcheck: 'Brent, EUR/USD vs second source', storage: 'Storage' };
  async function render() {
    const host = document.getElementById('status-gaps'); if (!host) return;
    const j = await fetch(DATA_BASE + 'data_gaps.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!j) { host.innerHTML = '<div class="fuel-note">The check has not run yet.</div>'; return; }
    // group the open holes by dataset and repair, days listed compactly
    const G = {}; (j.open || []).forEach(i => { const k = i.dataset + '|' + i.repair; (G[k] = G[k] || []).push(i); });
    const rows = Object.entries(G).map(([k, L]) => { const [ds, rep] = k.split('|'), since = L.reduce((a, i) => i.since < a ? i.since : a, L[0].since);
      L.sort((a, b) => a.id < b.id ? 1 : -1); const sample = L.slice(0, 4).map(i => esc(i.what)).join('<br>') + (L.length > 4 ? `<br><span class="fuel-note">… and ${L.length - 4} more</span>` : '');
      return `<tr><td class="l"><b>${esc(NAME[ds] || ds)}</b></td><td>${L.length}</td><td class="l" style="white-space:normal">${sample}</td><td>${when(since)}</td><td class="l" style="white-space:normal">${esc(rep)}</td></tr>`; });
    const res = (j.resolved || []).slice(0, 12);
    host.innerHTML = `<div class="fuel-note" style="margin-bottom:8px">Checked ${when(j.updated)} (every 2 hours)${j.storage && j.storage.data_mb != null ? ` · data ${j.storage.data_mb} MB${j.storage.r2_gb != null ? `, R2 ${j.storage.r2_gb} GB of 10` : ''}` : ''}. ${j.open.length ? `<b style="color:var(--down)">${j.open.length} hole${j.open.length > 1 ? 's' : ''} open</b>` : '<b style="color:var(--up)">No hole</b>'}: a missing day, zone or slot inside a series biases every average and chart built on it.</div>` +
      (rows.length ? `<div style="overflow-x:auto"><table class="status-table"><thead><tr><th class="l">Data</th><th>Holes</th><th class="l">What is missing</th><th>First seen</th><th class="l">Repair</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '') +
      (res.length ? `<div class="table-header" style="margin-top:12px"><span class="table-title">Filled in the last 30 days</span></div><div style="overflow-x:auto"><table class="status-table"><thead><tr><th class="l">Data</th><th class="l">What was missing</th><th>First seen</th><th>Filled</th></tr></thead><tbody>${res.map(i => `<tr><td class="l">${esc(NAME[i.dataset] || i.dataset)}</td><td class="l" style="white-space:normal">${esc(i.what)}</td><td>${when(i.since)}</td><td>${when(i.resolvedAt)}</td></tr>`).join('')}</tbody></table></div>` : '');
  }
  window.PKGaps = { render };
  const go = () => { const h = document.getElementById('status-gaps'); if (!h) return; const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); render(); } }); io.observe(h); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
