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
  const C_PF = '#14D3A9', C_PW = '#7FC8F8', C_NV = '#FBBF24';
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

  async function render() {
    if (!$('bess-da-kpis')) return;
    const doc = await load();
    if (!doc || !doc.months) { $('bess-da-kpis').innerHTML = '<div class="fuel-note">No battery data yet: the daily job writes data/history/bess_da.json.</div>'; return; }
    kpis(doc); charts(doc); years(doc);
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
      if (S.doc) { kpis(S.doc); charts(S.doc); years(S.doc); }
    },
  };
  if (window.PK && PK.onPage) PK.onPage('bess', () => { wire(); render(); });
})();
