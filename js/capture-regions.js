// ════════════════════════════════════════════════════════════════════
// CAPTURE RATE BY REGION (Renewables › Cannibalisation)
//   data/history/fr_regional_capture.json: each region's solar and wind output
//   (RTE éCO2mix regional) valued at the French day-ahead price of each step,
//   ÷ baseload; the gap to the national capture rate in points.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  let J = null;
  const load = () => J ? Promise.resolve(J) : fetch(DATA_BASE + 'history/fr_regional_capture.json').then(r => r.ok ? r.json() : null).then(j => (J = j)).catch(() => null);
  const conv = () => { const e = document.getElementById('cn-conv'); return e && e.value === 'all' ? 'all' : e && e.value === 'curt' ? 'curt' : 'pos'; };
  async function draw(cid, p) {
    const j = await load(); if (!j) { noDataMsg(cid, 'No regional capture data', ''); return null; }
    const ys = Object.keys(j.national).filter(y => j.national[y].solar && j.national[y].solar.all != null).sort();
    const sel = document.getElementById('cn-reg-year');
    if (sel && !sel.options.length) { sel.innerHTML = ys.slice().reverse().map(y => `<option>${y}</option>`).join(''); sel.value = ys[ys.length - (ys.length > 1 && new Date().getMonth() < 11 ? 2 : 1)]; sel.addEventListener('change', () => draw('cn-reg', {})); }
    const y = (p && p.year) || (sel ? sel.value : ys[ys.length - 2]), c = (p && p.conv) || conv();
    const N = j.national[y] || {}, rows = Object.values(j.regions).map(r => ({ n: r.name, s: r.years[y] && r.years[y].solar, w: r.years[y] && r.years[y].wind })).filter(r => r.s || r.w);
    rows.sort((a, b) => ((b.s && b.s[c]) || 0) - ((a.s && a.s[c]) || 0));
    const pt = v => v == null ? null : +(v * 100).toFixed(1);
    const lows = rows.flatMap(r => [r.s && r.s[c], r.w && r.w[c]]).filter(v => v != null), yMin = lows.length ? Math.max(0, Math.floor(Math.min(...lows) * 10) * 10 - 10) : 0;
    _fuelChart(cid, { type: 'bar', data: { labels: rows.map(r => r.n), datasets: [
      { label: 'Solar', data: rows.map(r => r.s ? pt(r.s[c]) : null), backgroundColor: 'rgba(244,196,48,.75)', borderRadius: 3 },
      { label: 'Wind', data: rows.map(r => r.w ? pt(r.w[c]) : null), backgroundColor: 'rgba(20,211,169,.7)', borderRadius: 3 },
      { type: 'line', label: `France solar ${pt(N.solar && N.solar[c])} %`, data: rows.map(() => pt(N.solar && N.solar[c])), borderColor: '#F4C430', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0 },
      { type: 'line', label: `France wind ${pt(N.wind && N.wind[c])} %`, data: rows.map(() => pt(N.wind && N.wind[c])), borderColor: '#14D3A9', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0 }] },
      options: _fuelOpts({ indexAxis: 'x', scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 45 } }), y: _fuelAxis('capture rate, %', { min: yMin }) },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } } }) }, 'capture-by-region-' + y);
    const best = rows.filter(r => r.s).sort((a, b) => b.s[c] - a.s[c]), lo = best[best.length - 1], hi = best[0];
    const note = document.getElementById('cn-reg-note');
    const txt = hi && lo ? `${y}${N.solar && !N.solar.complete && y === ys[ys.length - 1] ? ' (year to date)' : ''}: solar captures from ${pt(lo.s[c])} % (${lo.n}) to ${pt(hi.s[c])} % (${hi.n}) — a ${(pt(hi.s[c]) - pt(lo.s[c])).toFixed(1)}-point spread the national rate hides. Same French price everywhere: the gap comes only from when each region produces (east–west and north–south sun timing, wind regimes). Convention as selected above (${c === 'all' ? 'all hours' : c === 'curt' ? 'curtailed at prices ≤ 0' : 'hours with price > 0'}).` : '';
    if (note && cid === 'cn-reg') note.textContent = txt;
    return { sub: txt };
  }
  if (window.PKW) PKW.register({ id: 'ren-capture-regions', title: 'France · capture rate by region', category: 'renewables', page: 'renewables', pageCanvas: 'cn-reg', source: 'RTE éCO2mix · ENTSO-E', size: { w: 6, h: 5 },
    desc: 'Solar and wind capture rate of each French region for a year (its output on the French day-ahead price ÷ baseload), against the national rate.', draw });
  document.addEventListener('pk-view', e => { if (e.detail && e.detail.key === 'renewables' && /Cannibalisation/.test(e.detail.label)) setTimeout(() => draw('cn-reg', {}), 100); });
  document.addEventListener('change', e => { if (e.target && e.target.id === 'cn-conv' && document.getElementById('cn-reg') && document.getElementById('cn-reg').offsetParent) draw('cn-reg', {}); });
})();
