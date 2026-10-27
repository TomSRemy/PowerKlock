// ════════════════════════════════════════════════════════════════════
// PPA PRICER · CAPTURE FAN — realised capture rates, then the projection
// of the blend of 4 methods with its percentiles (P10–P90 bands) and the
// line of the percentile picked. Percentiles are exceedance probabilities:
// P90 = 90 % chance the realised capture is above the line (cautious).
// Data: data/history/ppa_fan.json (scripts/build_ppa_fan.py)
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let FAN = null;
  const S = { p: 75, unit: 'value' };
  const get = () => FAN || (FAN = fetch(DATA_BASE + 'history/ppa_fan.json').then(r => r.ok ? r.json() : null).catch(() => null));
  const f2 = v => v == null || !isFinite(v) ? '–' : (+v).toFixed(2);
  const pc = v => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1) + ' %';

  async function draw() {
    const host = $('pp-fan'); if (!host || host.offsetParent === null && !host.dataset.force) { if (host) host.dataset.pending = '1'; }
    const j = await get(); if (!j) { if ($('pp-fan-sub')) $('pp-fan-sub').textContent = 'Projection not available yet'; return; }
    const st = window.PKPpa ? PKPpa.state : { tech: 'solar', conv: 'curt' };
    const tech = st.tech === 'wind' ? 'wind' : 'solar', conv = st.conv === 'all' ? 'all' : 'curt';
    const D = j.tech[tech] && j.tech[tech][conv]; if (!D) return;
    const val = S.unit === 'value', k = val ? 'value' : 'rate';
    // one point per calendar year: complete realised years, the current year to date, then the projection
    const P = D.projection, byY = new Map(D.history.map(h => [h.year, h]));
    const y0 = Math.min(...D.history.map(h => h.year)), y1 = P.length ? P[P.length - 1].year : Math.max(...D.history.map(h => h.year));
    const years = []; for (let y = y0; y <= y1; y++) years.push(y);
    const labels = years.map(String), pad = n => new Array(n).fill(null);
    const sc = v => v == null ? null : val ? v : +(v * 100).toFixed(2);
    const H = years.filter(y => byY.has(y) && byY.get(y).complete).map(y => byY.get(y));
    const lastH = H[H.length - 1], iLast = years.indexOf(lastH.year), iP = years.indexOf(P[0].year), nH = iP;
    const q = p => P.map(x => x.q[String(p)] ? x.q[String(p)][k] : null);
    // the fan starts from the last complete realised year
    const fut = p => years.map((y, i) => i === iLast ? sc(lastH[k]) : i >= iP ? sc(q(p)[i - iP]) : null);
    const band = (hi, lo, col, lbl) => [
      { label: '_' + lbl + 'hi', data: fut(hi), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: col, tension: .25, spanGaps: true },
      { label: lbl, data: fut(lo), borderWidth: 0, pointRadius: 0, fill: false, backgroundColor: col, tension: .25, spanGaps: true },
    ];
    const pick = String(S.p);
    const ds = [
      ...band(10, 90, 'rgba(127,200,248,.13)', 'P10–P90'),
      ...band(25, 75, 'rgba(127,200,248,.24)', 'P25–P75'),
      { label: 'P50 (central)', data: fut(50), borderColor: 'rgba(230,237,243,.75)', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0, fill: false, tension: .25, spanGaps: true },
      { label: 'P' + pick + ' (picked)', data: fut(S.p), borderColor: '#FBBF24', borderWidth: 3, pointRadius: 3, pointBackgroundColor: '#FBBF24', fill: false, tension: .25, spanGaps: true },
      { label: 'Realised', data: years.map(y => byY.has(y) && byY.get(y).complete ? sc(byY.get(y)[k]) : null), borderColor: '#E6EDF3', backgroundColor: '#E6EDF3', borderWidth: 2.4, pointRadius: 3, fill: false, tension: .2, spanGaps: true },
    ];
    const ytd = D.history.find(h => !h.complete);
    if (ytd) ds.push({ label: ytd.year + ' to date', data: years.map(y => y === ytd.year ? sc(ytd[k]) : null), borderColor: '#E6EDF3', backgroundColor: 'transparent', pointStyle: 'circle', pointRadius: 5, pointBorderWidth: 2, showLine: false });
    if (val) ds.push({ label: 'Forward baseload (weighted by output)', data: years.map((y, i) => i >= iP ? P[i - iP].forward : null), borderColor: 'rgba(168,125,196,.8)', borderDash: [2, 3], borderWidth: 1.3, pointRadius: 0, fill: false });
    _fuelChart('pp-fan', { type: 'line', data: { labels, datasets: ds },
      options: _fuelOpts({ plugins: { pkFcZone: { from: iP, label: 'PROJECTION' }, legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !/^_/.test(it.text) } },
        tooltip: { callbacks: { label: c => /^_/.test(c.dataset.label) || c.raw == null ? null : ` ${c.dataset.label}: ${val ? f2(c.raw) + ' €/MWh' : (+c.raw).toFixed(1) + ' %'}` } } },
        scales: { x: _fuelXAxis(), y: _fuelAxis(val ? '€/MWh produced' : 'capture rate, %') } }) }, 'ppa-capture-fan-' + tech);
    const tb = $('pp-fan-table');
    if (tb) tb.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Delivery year</th><th>Forward €/MWh</th><th>P50 capture</th><th>P${pick} capture</th><th>P${pick} value €/MWh</th><th>Spread σ</th></tr></thead><tbody>` +
      P.map(p => `<tr><td style="text-align:left">${p.year}</td><td>${f2(p.forward)}</td><td>${pc(p.q['50'].rate)}</td><td><b>${pc(p.q[pick].rate)}</b></td><td><b>${f2(p.q[pick].value)}</b></td><td>${(p.sigma * 100).toFixed(1)} pts</td></tr>`).join('') + '</tbody></table></div>';
    const sub = $('pp-fan-sub');
    const FR = !window.PKI18n || PKI18n.lang !== 'en';
    if (sub) sub.textContent = FR
      ? `${tech === 'wind' ? 'Éolien' : 'Solaire'} · ${conv === 'curt' ? 'arrêt aux prix ≤ 0 €' : 'toutes heures payées'} · profil national · P${pick} = ${pick} % de chances que la valeur réalisée soit au-dessus de la ligne · 2022 (crise du gaz) écartée`
      : `${tech === 'wind' ? 'Wind' : 'Solar'} · ${conv === 'curt' ? 'curtailed at ≤ 0 €' : 'all hours paid'} · national profile · P${pick} = ${pick} % chance the realised value is above the line · 2022 (gas crisis) left out`;
  }

  function wire() {
    const ps = $('pp-fan-p'), un = $('pp-fan-unit');
    if (ps && !ps.dataset.w) { ps.dataset.w = 1; ps.addEventListener('change', () => { S.p = +ps.value; draw(); }); }
    if (un && !un.dataset.w) { un.dataset.w = 1; un.addEventListener('change', () => { S.unit = un.value; draw(); }); }
  }
  document.addEventListener('pk-ppa-run', () => { wire(); draw(); });
  document.addEventListener('pk-view', e => { if (e.detail && e.detail.key === 'ppapricer') setTimeout(() => { wire(); draw(); }, 50); });
  window.PKPpaFan = { draw };
})();
