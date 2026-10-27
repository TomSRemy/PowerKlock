// ════════════════════════════════════════════════════════════════════════════════════════
// BESS · Tools › BESS
//   · Day-ahead value of 1 MW of battery (1 h, 2 h, 4 h) in France: data/history/bess_da.json, written every day by
//     scripts/bess_optim.py from the day-ahead prices of the site (method on the page, view "Method").
//   · Capacity mechanism calculator (certified capacity of a battery).
//   · The BOA pricer lives in js/bess-boa.js and reads the same data.
// ════════════════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const S = { doc: null, h: '2h', loading: null };
  const C_PF = '#7FC8F8', C_PW = '#A87DC4', C_NV = '#FBBF24';   // blue, violet, amber: the site's palette, little green
  const fr = () => { try { return localStorage.getItem('pk-lang') !== 'en'; } catch (_) { return true; } };
  const num = (v, d) => v == null || isNaN(v) ? '–' : Number(v).toFixed(d == null ? 0 : d);

  function load() {
    if (S.doc) return Promise.resolve(S.doc);
    if (!S.loading) S.loading = fetch('data/history/bess_da.json').then(r => r.ok ? r.json() : null).catch(() => null).then(j => { S.doc = j; return j; });
    return S.loading;
  }

  // k€ per MW per year from an average € per MW per day
  const ann = v => v == null ? null : v * 365 / 1000;

  function kpis(doc) {
    const L = doc.summary_ltm[S.h];
    const cyc = L.cycles_day, perHour = L.pf * 1000 / 8760;
    $('bess-da-kpis').innerHTML =
      _fuelKpi('Perfect schedule, gross', num(L.pf, 0), 'k€/MW/yr', 'ceiling · no wear cost') +
      _fuelKpi('Perfect schedule, net of wear', num(L.pw, 0), 'k€/MW/yr', 'wear cost inside the schedule') +
      _fuelKpi('Without foresight', num(L.nv, 0), 'k€/MW/yr', 'fixed schedule · floor') +
      _fuelKpi('Gross, per hour', num(perHour, 1), '€/MW/h', 'over 8,760 hours') +
      _fuelKpi('Cycles', num(cyc, 2), 'per day', 'perfect schedule, gross') +
      _fuelKpi('Floor over ceiling', num(L.pf ? L.nv / L.pf * 100 : null, 0), '%', 'what a fixed schedule keeps');
    const upd = $('bess-upd'); if (upd) upd.textContent = 'Day-ahead, France';
  }

  function charts(doc) {
    const k = S.h, M = doc.months.filter(m => m.days >= 5);
    const lab = M.map(m => m.m);
    const line = (name, f, col, extra) => _fuelLineDs(name, M.map(m => { const v = m[k] && m[k][f]; return v == null ? null : +ann(v).toFixed(1); }), col, extra);
    _fuelChart('bess-m-canvas', { type: 'line', data: { labels: lab, datasets: [
      line('Perfect schedule, gross', 'pf', C_PF, { borderWidth: 2 }),
      line('Perfect schedule, net of wear', 'pw', C_PW),
      line('Without foresight', 'nv', C_NV, { borderDash: [5, 3] }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('k€/MW/yr', { beginAtZero: true }) } }) }, 'bess-monthly-' + k);
    const D = doc.days;
    const dl = (name, f, col, extra) => _fuelLineDs(name, D.map(r => r[k] && r[k][f] != null ? r[k][f] : null), col, extra);
    _fuelChart('bess-d-canvas', { type: 'line', data: { labels: D.map(r => r.d), datasets: [
      dl('Perfect schedule, gross', 'pf', C_PF, { borderWidth: 1.6 }),
      dl('Without foresight', 'nv', C_NV, { borderDash: [5, 3] }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MW/day', { beginAtZero: true }) } }) }, 'bess-daily-' + k);
    const p = doc.params;
    $('bess-da-note').textContent = fr()
      ? 'Day-ahead France uniquement. Rendement aller-retour ' + (p.rte * 100).toFixed(0) + ' %, ' + p.max_cycles_day + ' cycles par jour au maximum, frais de réseau ' + p.grid_withdrawal + ' €/MWh au soutirage, usure ' + p.wear + ' €/MWh déchargé. Intraday, réserves et mécanisme de capacité non inclus.'
      : 'France day-ahead only. ' + (p.rte * 100).toFixed(0) + '% round trip, ' + p.max_cycles_day + ' cycles a day at most, grid fee ' + p.grid_withdrawal + ' €/MWh on withdrawal, wear ' + p.wear + ' €/MWh discharged. Intraday, reserves and the capacity mechanism are not included.';
  }

  function years(doc) {
    const k = S.h, by = {};
    doc.months.forEach(m => {
      const y = m.m.slice(0, 4), e = m[k]; if (!e) return;
      const a = by[y] || (by[y] = { n: 0, pf: 0, pw: 0, nv: 0, nvn: 0, cyc: 0 });
      a.n += m.days; a.pf += (e.pf || 0) * m.days; a.pw += (e.pw || 0) * m.days; a.cyc += (e.pf_cyc || 0) * m.days;
      if (e.nv != null) { a.nv += e.nv * m.days; a.nvn += m.days; }
    });
    const rows = Object.keys(by).sort().map(y => {
      const a = by[y];
      return '<tr><td>' + y + '</td><td>' + num(ann(a.pf / a.n), 0) + '</td><td>' + num(ann(a.pw / a.n), 0) + '</td><td>' + (a.nvn ? num(ann(a.nv / a.nvn), 0) : '–') +
        '</td><td>' + num(a.cyc / a.n, 2) + '</td><td>' + num(ann(a.pf / a.n) * 1000 / 8760, 1) + '</td></tr>';
    });
    $('bess-years').innerHTML = '<thead><tr><th>Year</th><th>Perfect schedule, gross</th><th>Perfect schedule, net of wear</th><th>Without foresight</th><th>Cycles per day</th><th>Gross, €/MW/h</th></tr></thead><tbody>' + rows.join('') + '</tbody>';
  }

  // ── a typical day: the last delivery day, quarter-hour by quarter-hour: when the battery buys and sells ──
  function day(doc) {
    const E = doc.example, k = S.h; if (!E || !E[k] || !$('bess-day-canvas')) return;
    const x = E[k], T = (f, e) => fr() ? f : e;
    const lab = E.price.map((_, i) => String(Math.floor(i / 4)).padStart(2, '0') + ':' + String((i % 4) * 15).padStart(2, '0'));
    const dd = new Date(E.d + 'T12:00:00Z').toLocaleDateString(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const nf = v => fr() ? Math.round(v).toLocaleString('fr-FR') : Math.round(v).toLocaleString('en-GB');
    $('bess-day-sub').innerHTML = T(`Le ${dd}, batterie de ${k.replace('h', ' h')} : <b>${nf(x.rev)} €</b> gagnés par MW sur le day-ahead, dont ${nf(x.wear)} € d’usure · programme parfait net d’usure`,
      `${dd}, ${k.replace('h', ' h')} battery: <b>€${nf(x.rev)}</b> earned per MW on the day-ahead, of which €${nf(x.wear)} wear · perfect schedule net of wear`);
    _fuelChart('bess-day-canvas', { type: 'bar', data: { labels: lab, datasets: [
      { type: 'line', label: T('Prix day-ahead', 'Day-ahead price'), data: E.price, borderColor: '#E6EDF3', borderWidth: 1.8, pointRadius: 0, tension: 0, yAxisID: 'p', order: 0 },
      { type: 'line', label: T('État de charge', 'State of charge'), data: x.soc.map(v => +(v * 100).toFixed(0)), borderColor: '#A87DC4', borderWidth: 1.4, borderDash: [4, 3], pointRadius: 0, tension: 0, yAxisID: 'soc', order: 1 },
      { label: T('Vend (décharge)', 'Sells (discharge)'), data: x.discharge, backgroundColor: 'rgba(251,191,36,.85)', borderWidth: 0, yAxisID: 'mw', order: 2, barPercentage: 1, categoryPercentage: 1 },
      { label: T('Achète (charge)', 'Buys (charge)'), data: x.charge.map(v => -v), backgroundColor: 'rgba(127,200,248,.75)', borderWidth: 0, yAxisID: 'mw', order: 3, barPercentage: 1, categoryPercentage: 1 },
    ] }, options: _fuelOpts({ scales: {
      x: Object.assign(_fuelXAxis(), { stacked: true, ticks: { color: C_TX3, font: { size: 10 }, maxRotation: 0, autoSkip: false, callback: (v, i) => i % 12 === 0 ? lab[i].slice(0, 2) + ' h' : '' } }),
      mw: _fuelAxis('MW', { position: 'left', min: -1.1, max: 1.1, stacked: true, ticks: { color: C_TX3, font: { size: 10 }, callback: v => Math.abs(v) <= 1 && v * 10 % 5 === 0 ? v : '' } }),
      p: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }),
      soc: { display: false, min: 0, max: 100 },
    } }) }, 'bess-day-' + k);
  }

  async function render() {
    if (!$('bess-da-kpis')) return;
    const doc = await load();
    if (!doc || !doc.months) { $('bess-da-kpis').innerHTML = '<div class="fuel-note">No battery data yet: the daily job writes data/history/bess_da.json.</div>'; return; }
    kpis(doc); charts(doc); years(doc); day(doc);
    document.dispatchEvent(new CustomEvent('pk-bess-data', { detail: doc }));
  }

  // ── Capacity mechanism: certified capacity = installed power × constraint coefficient (Kj × Kh) ──
  const KJKH = { 0.5: 0.84, 1: 0.88, 2: 0.93, 3: 0.95, 4: 0.97, 5: 0.98, 6: 0.99, 8: 1 };
  function cm() {
    if (!$('cm-kpis')) return;
    const mw = Math.max(+$('cm-mw').value || 0, 0), h = +$('cm-h').value, price = +$('cm-p').value;
    $('cm-p-d').textContent = price;
    const k = KJKH[h] || 1, cert = mw * k, rev = cert * price;   // MW × €/kW × 1000 kW/MW = k€
    $('cm-kpis').innerHTML =
      _fuelKpi('Coefficient', num(k, 2), '', 'by duration') +
      _fuelKpi('Certified capacity', num(cert, 1), 'MW', 'power × coefficient') +
      _fuelKpi('Revenue', num(rev, 0), 'k€/yr', 'certified MW × price') +
      _fuelKpi('Per MW installed', num(mw ? rev / mw : 0, 1), 'k€/MW/yr', 'adds to the other streams');
  }

  function wire() {
    const g = $('page-bess'); if (!g || g.dataset.wired) return; g.dataset.wired = '1';
    ['cm-mw', 'cm-h', 'cm-p'].forEach(id => { const e = $(id); if (e) e.addEventListener('input', cm); });
    cm();
  }

  window.PKBess = {
    load, ann,
    setH(h, btn) {
      S.h = h;
      if (btn) btn.parentNode.querySelectorAll('.pk-gf-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (S.doc) { kpis(S.doc); charts(S.doc); years(S.doc); day(S.doc); }
    },
  };
  if (window.PK && PK.onPage) PK.onPage('bess', () => { wire(); render(); });
})();
