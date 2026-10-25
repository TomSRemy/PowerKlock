// ════════════════════════════════════════════════════════════════════
// GENERATION MIX · HISTORICAL — generation over time, one zone
//   data/history/genmix_daily/YYYY.json (scripts/backfill_genmix_ec.py,
//   Energy-Charts public power): daily average MW per fuel + average day
//   by month. Period = the Historical tab's period (pills or From/To).
//   Daily bars by fuel with last year's total · average day of the period ·
//   fuel shares month by month.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const FUELS = ['nuclear', 'hydro', 'biomass', 'wind', 'solar', 'fossil', 'other'];
  const META = () => window.GM_FUEL_META || {};
  const ZONES = { FR: 'France', DE_LU: 'Germany', BE: 'Belgium', NL: 'Netherlands', ES: 'Spain', PT: 'Portugal', AT: 'Austria', CH: 'Switzerland', PL: 'Poland', CZ: 'Czechia' };
  const PERIOD_DAYS = { '7D': 7, '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '2Y': 730, '5Y': 1825, 'All': 2600 };
  const cache = {};
  const S = { zone: 'FR' };
  const iso = d => d.toISOString().slice(0, 10);

  function range() {
    const p = window._gmhPeriod || '3M', r = window._gmhRange;
    if (p === 'custom' && r && r.from && r.to) return [r.from, r.to];
    const end = new Date();
    const start = new Date(end);
    if (p === 'YTD') start.setMonth(0, 1); else start.setDate(start.getDate() - (PERIOD_DAYS[p] || 91));
    return [iso(start), iso(end)];
  }
  function year(y) {
    if (!cache[y]) cache[y] = fetch(DATA_BASE + 'history/genmix_daily/' + y + '.json').then(r => r.ok ? r.json() : null).catch(() => null);
    return cache[y];
  }
  // {day: {fuel: MW}} for a zone between two days
  async function days(zone, a, b) {
    const ys = []; for (let y = +a.slice(0, 4); y <= +b.slice(0, 4); y++) ys.push(y);
    const docs = await Promise.all(ys.map(year));
    const out = {}, prof = [];
    docs.forEach(doc => { const z = doc && doc.zones && doc.zones[zone]; if (!z) return;
      z.days.forEach((d, i) => { if (d >= a && d <= b) out[d] = Object.fromEntries(FUELS.map(f => [f, z[f][i]])); });
      prof.push({ year: doc.year, profile: z.profile }); });
    return { days: out, prof };
  }
  const shift = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCFullYear(t.getUTCFullYear() + n); return iso(t); };

  const PAGE = { daily: 'gms-daily', profile: 'gms-profile', share: 'gms-share' };
  async function render() {
    const host = $('gms-daily'); if (!host || host.offsetParent === null) return;
    const zs = $('gms-zone');
    if (zs && !zs.options.length) {
      zs.innerHTML = Object.entries(ZONES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
      zs.value = S.zone; zs.addEventListener('change', () => { S.zone = zs.value; render(); });
    }
    // one zone filter per page: with a country picked in the top bar, the section follows it and its own
    // selector is hidden; in Europe the selector picks the zone
    const sz = window.PKScope && PKScope.zone && PKScope.zone();
    if (zs) zs.parentNode.style.display = sz && ZONES[sz] ? 'none' : '';
    if (sz && ZONES[sz]) { S.zone = sz; if (zs) zs.value = sz; }
    await draw(S.zone, PAGE, true);
    if (window.PKW && PKW.star) [['genmix-hist-daily', 'gms-daily'], ['genmix-hist-avgday', 'gms-profile'], ['genmix-hist-shares', 'gms-share']].forEach(([w, c]) => PKW.star(w, c));
    ['gms-daily', 'gms-profile', 'gms-share'].forEach(id => { if (typeof addFullscreen === 'function') addFullscreen(id); });
  }
  // draws one, two or three charts (ids: {daily, profile, share}) for a zone; subtitles only on the page
  async function draw(zone, ids, page) {
    const [a, b] = range(), M = META();
    const setSub = (id, t) => { if (page) { const e = $(id); if (e) e.textContent = t; } };
    const [cur, prev] = await Promise.all([days(zone, a, b), days(zone, shift(a, -1), shift(b, -1))]);
    const ds = Object.keys(cur.days).sort();
    if (!ds.length) { Object.values(ids).forEach(c => noDataMsg(c, 'No generation history for this period', 'Energy-Charts')); return; }
    const many = ds.length > 120;
    // 1 · daily bars (weekly above 120 days, to stay readable)
    let labels = ds, rows = ds.map(d => cur.days[d]);
    if (many) {
      const wk = {}; ds.forEach(d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); const k = iso(t); (wk[k] = wk[k] || []).push(cur.days[d]); });
      labels = Object.keys(wk).sort(); rows = labels.map(k => Object.fromEntries(FUELS.map(f => [f, wk[k].reduce((s, r) => s + r[f], 0) / wk[k].length])));
    }
    const prevTot = labels.map(d => { if (many) return null; const r = prev.days[shift(d, -1)]; return r ? +(FUELS.reduce((s, f) => s + r[f], 0) / 1000).toFixed(2) : null; });
    if (ids.daily) _fuelChart(ids.daily, { type: 'bar', data: { labels, datasets: [
      ...FUELS.map(f => ({ label: (M[f] || {}).label || f, data: rows.map(r => +(r[f] / 1000).toFixed(2)), backgroundColor: (M[f] || {}).color || '#888', stack: 'g', borderWidth: 0 })),
      ...(prevTot.some(v => v != null) ? [{ type: 'line', label: 'Total, same day last year', data: prevTot, borderColor: '#FFFFFF', borderDash: [4, 3], borderWidth: 1.4, pointRadius: 0, fill: false }] : []),
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } },
      scales: { x: Object.assign(_fuelXAxis(), { stacked: true, grid: { display: false }, ticks: { color: C_TX3, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }), y: Object.assign(_fuelAxis('GW, daily average', { beginAtZero: true }), { stacked: true }) } }) }, 'genmix-daily-by-fuel');
    setSub('gms-daily-sub', `${ZONES[zone]} · ${a} → ${b} · ${many ? 'weekly averages' : 'daily averages'} by fuel${prevTot.some(v => v != null) ? ' · dashed: total on the same day a year before' : ''}`);
    // 2 · average day of the period, by fuel (from the monthly average days, weighted by the days of each month)
    const w = {}; ds.forEach(d => { const k = d.slice(0, 7); w[k] = (w[k] || 0) + 1; });
    const avg = Object.fromEntries(FUELS.map(f => [f, Array(24).fill(0)])); let tot = 0;
    Object.entries(w).forEach(([k, n]) => { const pf = cur.prof.find(p => p.year === +k.slice(0, 4)); if (!pf) return; const m = +k.slice(5, 7) - 1;
      if (!FUELS.every(f => pf.profile[f] && pf.profile[f][m] && pf.profile[f][m][0] != null)) return;
      FUELS.forEach(f => pf.profile[f][m].forEach((v, h) => { avg[f][h] += v * n; })); tot += n; });
    if (tot && ids.profile) _fuelChart(ids.profile, { type: 'line', data: { labels: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0') + ':00'), datasets:
      FUELS.map(f => ({ label: (M[f] || {}).label || f, data: avg[f].map(v => +(v / tot / 1000).toFixed(2)), borderColor: (M[f] || {}).color, backgroundColor: ((M[f] || {}).color || '#888') + 'CC', fill: true, pointRadius: 0, borderWidth: 1, tension: 0.3, stack: 'p' })) },
      options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } },
        scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 12 } }), y: Object.assign(_fuelAxis('GW', { beginAtZero: true }), { stacked: true }) } }) }, 'genmix-average-day');
    setSub('gms-profile-sub', `${ZONES[zone]} · average day over the period, by hour (Paris time) and fuel`);
    // 3 · fuel shares month by month
    const mon = {}; ds.forEach(d => { const k = d.slice(0, 7); const r = cur.days[d]; const m = mon[k] = mon[k] || Object.fromEntries(FUELS.map(f => [f, 0])); FUELS.forEach(f => { m[f] += r[f]; }); });
    const mk = Object.keys(mon).sort();
    if (ids.share) _fuelChart(ids.share, { type: 'bar', data: { labels: mk, datasets: FUELS.map(f => ({ label: (M[f] || {}).label || f, data: mk.map(k => { const s = FUELS.reduce((a2, g) => a2 + mon[k][g], 0); return s ? +(mon[k][f] / s * 100).toFixed(1) : null; }), backgroundColor: (M[f] || {}).color, stack: 's' })) },
      options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } },
        scales: { x: Object.assign(_fuelXAxis(), { stacked: true, grid: { display: false } }), y: Object.assign(_fuelAxis('% of generation', { min: 0, max: 100 }), { stacked: true }) } }) }, 'genmix-monthly-shares');
    setSub('gms-share-sub', `${ZONES[zone]} · share of each fuel in the month's generation`);
  }

  // follow the Historical tab's period
  const wrap = name => { const f = window[name]; if (typeof f === 'function' && !f._gms) { window[name] = function () { const r = f.apply(this, arguments); setTimeout(render, 50); return r; }; window[name]._gms = true; } };
  window.addEventListener('load', () => setTimeout(() => {
    wrap('gmhSetPeriod'); wrap('gmhSetCustomRange');
    // and the zone of the top bar
    document.addEventListener('change', e => { if (e.target && /^pk-zone/.test(e.target.id)) setTimeout(render, 80); });
    const sec = $('hs-gms');
    if (sec && window.IntersectionObserver) new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) render(); }).observe(sec);
    if (window.PKW) {
      const reg = (id, title, canvas, desc, kind) => PKW.register({ id, title, category: 'system', page: 'genmix', pageCanvas: canvas, source: 'Energy-Charts', size: { w: 12, h: 6 }, desc,
        params: [{ key: 'zone', label: 'Zone', options: Object.entries(ZONES), inTitle: true }], defaults: { zone: 'FR' }, pageParams: () => ({ zone: S.zone }),
        titleFn: p => title + ' · ' + (ZONES[p.zone] || p.zone),
        async draw(cid, p) { await draw(p.zone || 'FR', { [kind]: cid }, false); return { sub: (ZONES[p.zone] || p.zone) + ' · period of the Historical tab' }; } });
      reg('genmix-hist-daily', 'Generation by fuel, day by day', 'gms-daily', 'Daily average generation by fuel for one zone over the period, with last year\'s total.', 'daily');
      reg('genmix-hist-avgday', 'Average day by fuel', 'gms-profile', 'Average generation by hour and fuel over the period, one zone.', 'profile');
      reg('genmix-hist-shares', 'Fuel shares by month', 'gms-share', 'Share of each fuel in each month\'s generation, one zone.', 'share');
    }
  }, 0));
  window.PKGenmixSeries = { render };
})();
