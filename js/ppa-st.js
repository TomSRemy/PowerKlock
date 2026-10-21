// ════════════════════════════════════════════════════════════════════
// PPA PRICER · SHORT-TERM (MONTHLY) — any period inside the quoted horizon
//   forward of each month  data/history/fr_forward_monthly.json (month,
//                          else quarter / season / Cal shaped by history)
//   capture of each month  data/history/ppa_forecast.json (scripts/ppa_lab.py:
//                          six approaches replayed, hybrid chosen on 2019-2023,
//                          judged on 2024, 2025 and 2026 to date)
//   price = Σ output × paid share × forward × capture ÷ Σ output × paid share
//           − imbalance + GO − margin
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const f2 = v => v == null || !isFinite(v) ? '–' : (+v).toFixed(2);
  const f1 = v => v == null || !isFinite(v) ? '–' : (+v).toFixed(1);
  const pc = v => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1) + ' %';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const lab = k => MON[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4);
  const NAMES = { hybrid: 'Ensemble (4 methods)', weather: 'MC weather', regional: 'Regional model', regionalMC: 'Regional Monte Carlo', fpc: 'Asset-specific FPC', step: 'Step by step', dashboard: 'PPA Dashboard', weather: 'MC weather' };
  let FW = null, FC = null, RG = null, loading = null;
  const S = { from: null, to: null, region: '' };

  function load() {
    if (loading) return loading;
    const get = p => fetch(DATA_BASE + p + '?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
    loading = Promise.all([get('history/fr_forward_monthly.json'), get('history/ppa_forecast.json'), get('history/fr_regional_capture.json')]).then(([a, b, c]) => { FW = a; FC = b; RG = c; });
    return loading;
  }

  function ctx() {
    const P = window.PKPpa, st = P && P.state, o = st && st.last;
    const tech = st ? st.tech : 'solar', conv = st && st.conv === 'all' ? 'all' : 'curt';
    return { st, o, tech, conv, legacy: st && st.conv === 'pos' };
  }

  // months of the period that have both a forward and a forecast
  function months(tech, conv) {
    const f = FC && FC.forecast && FC.forecast[tech] && FC.forecast[tech][conv];
    return FW && f ? Object.keys(FW.months).filter(k => f[k]).sort() : [];
  }

  // regional basis: capture gap of the region to the national profile (capture points), average of the last
  // three complete years, and the region's monthly output shape
  function regionOf(tech, conv) {
    const r = S.region && RG && RG.regions[S.region];
    if (!r) return null;
    const ys = Object.keys(r.years).filter(y => r.years[y][tech] && r.years[y][tech].complete && r.years[y][tech].gap).sort().slice(-3);
    if (!ys.length) return null;
    const gap = ys.reduce((a, y) => a + r.years[y][tech].gap[conv], 0) / ys.length;
    const share = Array.from({ length: 12 }, (_, i) => ys.reduce((a, y) => a + (r.years[y][tech].share || [])[i] || 0, 0) / ys.length);
    return { name: r.name, gap, share, years: ys };
  }
  // the asset's own monthly output shape when a curve is loaded, else the region's, else the national one
  function shareOf(tech, st, conv) {
    const nat = FC.share[tech];
    const A = st && st.asset && st.asset.slots;
    const rg = regionOf(tech, conv);
    if (!A && rg) return m => rg.share[m - 1];
    if (!A) return m => nat[m];
    const acc = Array(13).fill(0);
    A.forEach((row, d) => { const m = +d.slice(5, 7); row.forEach(v => { if (v) acc[m] += v; }); });
    const tot = acc.reduce((a, b) => a + b, 0);
    return tot > 0 && acc.slice(1).every(v => v > 0) ? m => acc[m] / tot : m => nat[m];
  }

  function price(ks, method, c) {
    const f = FC.forecast[c.tech][c.conv], sh = shareOf(c.tech, c.st, c.conv), rg = regionOf(c.tech, c.conv), gap = rg ? rg.gap : 0;
    let w = 0, v = 0, F = 0, cap = 0, paid = 0, out = 0;
    ks.forEach(k => { const e = f[k], m = +k.slice(5, 7), cr0 = e[method]; if (cr0 == null) return; const cr = cr0 + gap;
      const p = c.conv === 'curt' ? e.paid : 1, o = sh(m), fw = FW.months[k].value;
      w += o * p; v += o * p * fw * cr; F += o * p * fw; cap += o * p * cr; paid += o * p; out += o; });
    if (!w) return null;
    const o = c.o, cost = o ? -o.imb + o.goW - o.margin : 0;
    return { value: v / w, fwd: F / w, capture: cap / w, paid: paid / out, ppa: v / w + cost, cost, mwhShare: out };
  }

  function render() {
    const host = $('pp-st-body'); if (!host) return;
    const c = ctx();
    if (!FW || !FC) { host.innerHTML = '<div class="fuel-note">Monthly forward or forecasts not available yet.</div>'; return; }
    const all = months(c.tech, c.conv);
    if (!all.length) { host.innerHTML = '<div class="fuel-note">No month with both a forward and a forecast.</div>'; return; }
    const sf = $('pp-st-from'), stt = $('pp-st-to');
    if (sf && !sf.options.length) {
      sf.innerHTML = stt.innerHTML = all.map(k => `<option value="${k}">${lab(k)}</option>`).join('');
      S.from = S.from || all[Math.min(5, all.length - 1)]; S.to = S.to || all[Math.min(24, all.length - 1)];
      sf.value = S.from; stt.value = S.to;
      sf.addEventListener('change', () => { S.from = sf.value; if (S.to < S.from) { S.to = S.from; stt.value = S.to; } render(); });
      stt.addEventListener('change', () => { S.to = stt.value; if (S.from > S.to) { S.from = S.to; sf.value = S.from; } render(); });
    }
    host.innerHTML = '';
    const sr = $('pp-st-region');
    if (sr && RG && !sr.dataset.wired) {
      sr.dataset.wired = '1';
      sr.innerHTML = '<option value="">National profile</option>' + Object.entries(RG.regions).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, r]) => `<option value="${k}">${r.name}</option>`).join('');
      sr.addEventListener('change', () => { S.region = sr.value; render(); });
    }
    const ks = all.filter(k => k >= S.from && k <= S.to);
    const h = FC.hybrid[c.tech][c.conv], res = {};
    ['hybrid', 'regional', 'regionalMC', 'weather', 'fpc', 'step', 'dashboard'].forEach(m => { res[m] = price(ks, m, c); });
    const H = res.hybrid, band = h.bandPts;
    const lo = H ? H.ppa + band.lo / 100 * H.fwd : null, hi = H ? H.ppa + band.hi / 100 * H.fwd : null;
    const rule = h.used === 'ensemble' ? `average of ${h.members.map(m => NAMES[m]).join(', ')}` : h.pick === 'season' ? `${NAMES[h.summerBest]} in summer, ${NAMES[h.winterBest]} in winter` : h.pick === 'avg2' ? `average of ${NAMES[h.ranking[0]]} and ${NAMES[h.ranking[1]]}` : h.pick === 'bestDebiased' ? `${NAMES[h.ranking[0]]}, bias removed` : NAMES[h.ranking[0]];
    $('pp-st-kpis').innerHTML = H ? [
      _fuelKpi('PPA price', f2(H.ppa), '€/MWh', `${c.tech === 'solar' ? 'Solar' : 'Wind'} · ${lab(ks[0])} → ${lab(ks[ks.length - 1])} · ensemble`, ''),
      _fuelKpi('80 % range', f1(lo) + '–' + f1(hi), '€/MWh', `± ${f1(band.hi)} capture pts: the replay's errors, ${band.n} years`),
      _fuelKpi('Forward', f2(H.fwd), '€/MWh', 'weighted by the output paid, month by month'),
      _fuelKpi('Capture rate', pc(H.capture), '', `value ÷ forward · ${c.conv === 'curt' ? 'curtailed at ≤ 0 €' : 'every hour paid'}`),
      _fuelKpi(c.conv === 'curt' ? 'Output paid' : 'Costs and GO', c.conv === 'curt' ? pc(H.paid) : f2(H.cost), c.conv === 'curt' ? '' : '€/MWh', c.conv === 'curt' ? 'the rest is curtailed at prices ≤ 0' : 'imbalance, GO, margin (inputs above)'),
    ].join('') : '';
    $('pp-st-note').innerHTML = (h.used === 'ensemble' ? `<b>Ensemble</b> = ${rule}, equal weights.`
      : `<b>Hybrid</b> = ${rule}: the combination that erred least on 2019–2023, set before looking at 2024–2026.`) +
      (c.legacy ? ' The PPA Dashboard convention has no monthly forecast: shown with curtailment.' : '') +
      (regionOf(c.tech, c.conv) ? ` <b>${regionOf(c.tech, c.conv).name}</b>: ${(regionOf(c.tech, c.conv).gap * 100 >= 0 ? '+' : '') + f1(regionOf(c.tech, c.conv).gap * 100)} capture points against the national profile (average ${regionOf(c.tech, c.conv).years.join(', ')}), and the region's monthly output shape.` : '') +
      ` Costs: imbalance −${f2(c.o && c.o.imb)}, GO +${f2(c.o && c.o.goW)}, margin −${f2(c.o && c.o.margin)} €/MWh (inputs above).`;
    // the methods for the period, with their replay record
    const sc = FC.scores[c.tech][c.conv], ver = Object.keys(sc.pts).map(Number).filter(y => y >= 2024).sort();
    $('pp-st-methods').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table pp-ptab"><thead><tr><th style="text-align:left">Method</th><th>PPA €/MWh</th><th>Capture</th>${ver.map(y => `<th title="Replay error on ${y}, capture points">${y}${y >= new Date().getFullYear() ? '*' : ''}</th>`).join('')}</tr></thead><tbody>` +
      ['hybrid', 'regional', 'regionalMC', 'weather', 'fpc', 'step', 'dashboard'].filter(m => res[m]).map(m => `<tr${m === 'hybrid' ? ' class="pp-main"' : ''}><td style="text-align:left">${NAMES[m]}</td><td>${f2(res[m].ppa)}</td><td>${pc(res[m].capture)}</td>${ver.map(y => { const e = sc.pts[y] && sc.pts[y][m]; return `<td class="${e == null ? '' : Math.abs(e) < 3 ? 'pp-pos' : Math.abs(e) > 8 ? 'pp-neg' : ''}">${e == null ? '–' : (e > 0 ? '+' : '') + f1(e) + ' pts'}</td>`; }).join('')}</tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">Years: replay error in capture points on years the method never saw (production-weighted, + = too optimistic; * = to date). 2019–2023 chose every setting; 2024–2026 only judge.</div>`;
    // month by month
    const f = FC.forecast[c.tech][c.conv];
    $('pp-st-months').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table pp-ptab"><thead><tr><th style="text-align:left">Month</th><th>Forward</th><th style="text-align:left">From</th><th>Capture (hybrid)</th><th>P10 – P90</th><th>Paid</th><th>Hours ≤ 0</th><th>Value</th></tr></thead><tbody>` +
      ks.map(k => { const e = f[k], fw = FW.months[k]; return `<tr><td style="text-align:left">${lab(k)}</td><td>${f2(fw.value)}</td><td style="text-align:left" class="pp-hint">${fw.from}</td><td>${pc(e.hybrid)}</td><td class="pp-hint">${pc(e.p10)} – ${pc(e.p90)}</td><td>${c.conv === 'curt' ? pc(e.paid) : '–'}</td><td>${Math.round(e.negH)}</td><td>${f2(fw.value * e.hybrid)}</td></tr>`; }).join('') + '</tbody></table></div>';
    _fuelChart('pp-st-chart', { type: 'bar', data: { labels: ks.map(lab), datasets: [
      { type: 'line', label: 'Value of one MWh (hybrid)', data: ks.map(k => +(FW.months[k].value * f[k].hybrid).toFixed(2)), borderColor: '#FBBF24', backgroundColor: '#FBBF24', borderWidth: 2.4, pointRadius: 2.5, fill: false, order: 0 },
      { type: 'line', label: 'P10 – P90 (simulated weather)', data: ks.map(k => +(FW.months[k].value * f[k].p90).toFixed(2)), borderColor: 'rgba(251,191,36,0)', backgroundColor: 'rgba(251,191,36,.14)', pointRadius: 0, fill: '+1', order: 1 },
      { type: 'line', label: '_p10', data: ks.map(k => +(FW.months[k].value * f[k].p10).toFixed(2)), borderColor: 'rgba(251,191,36,0)', pointRadius: 0, fill: false, order: 1 },
      { label: 'Forward (baseload)', data: ks.map(k => +FW.months[k].value.toFixed(2)), backgroundColor: 'rgba(127,200,248,.35)', borderRadius: 2, order: 2 },
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !it.text.startsWith('_') } } },
      scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false }, ticks: { color: C_TX3, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }), y: _fuelAxis('€/MWh', { beginAtZero: true }) } }) }, 'ppa-short-term-months');
    $('pp-st-chart-sub').textContent = `Forward of ${FW.asOf} by month (bars) and what one MWh earns (line) · P10–P90: spread over simulated weather years`;
  }

  async function show() { await load(); try { render(); } catch (e) { console.warn('[ppa-st]', e); } }
  document.addEventListener('pk-ppa-run', show);
  document.addEventListener('pk-view', e => { if (e.detail && e.detail.key === 'ppapricer' && /Short-term/.test(e.detail.label)) show(); });
  window.PKPpaST = { show };
})();
