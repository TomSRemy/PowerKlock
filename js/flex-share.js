// ════════════════════════════════════════════════════════════════════
// PRICES › NEGATIVE PRICES · WHO KEEPS PRODUCING BELOW 0 € IN FRANCE (Tom 1 Nov. 2026)
//   data/history/flex_share.json (scripts/build_flex_share.py, weekly): wind and solar capacity by support
//   (purchase obligation, complément de rémunération, out of support) from the ODRÉ register, the obligations to
//   stop (config/flex_rules.json), the output kept at negative prices measured each year on the CRE reference
//   production, the energy not produced, and the wind projection.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fr = () => !window.PKI18n || PKI18n.lang !== 'en';
  const T = (en, f) => fr() ? f : en;
  const n1 = v => v == null || !isFinite(v) ? '–' : (fr() ? (+v).toFixed(1).replace('.', ',') : (+v).toFixed(1));
  const pc = v => v == null || !isFinite(v) ? '–' : Math.round(v * 100) + ' %';
  const C = { oa: '#D4BE96', oaStop: '#E07B39', cr: '#7FC8F8', merchant: '#5B8DEF', wind: '#7FC8F8', large: '#E07B39', small: '#FBBF24', proj: '#9FB4C7' };
  let D = null, busy = false;

  function load() {
    if (D) return Promise.resolve(D);
    const base = /^https?:$/.test(location.protocol) ? './data/' : 'data/';
    return fetch(base + 'history/flex_share.json').then(r => r.ok ? r.json() : null).then(j => (D = j)).catch(() => null);
  }

  function kpis() {
    const y = new Date().getFullYear(), w = D.fleet.wind.years, b = D.behaviour, ly = Object.keys(b).filter(k => b[k].days > 300).pop();
    const last = b[ly] || {}, lost = last.wind ? last.wind.lostTWh + last.solarLarge.lostTWh + last.solarSmall.lostTWh : null;
    const card = (l, v, u, m) => `<div class="kpi-card kpi-flat"><div class="kpi-label">${l}</div><div class="kpi-value">${v}<span class="kpi-unit">${u}</span></div><div class="kpi-meta">${m}</div></div>`;
    $('flex-kpis').innerHTML = [
      card(T('Wind still on purchase obligation', 'Éolien encore en obligation d\'achat'), n1(w[y].oa), 'GW', T(`of ${n1(w[y].tot)} GW, ${y}`, `sur ${n1(w[y].tot)} GW, ${y}`)),
      card(T('Wind leaving it by 2030', 'Éolien qui en sort d\'ici 2030'), n1([y + 1, y + 2, y + 3, y + 4].reduce((a, k) => a + (w[k] ? w[k].exits : 0), 0)), 'GW', T(`${y + 1}–${y + 4}, register`, `${y + 1}–${y + 4}, registre`)),
      card(T('Wind output kept below 0 €', 'Production éolienne gardée sous 0 €'), pc(last.wind && last.wind.kept), '', T(`${ly}, measured`, `${ly}, mesuré`)),
      card(T('Large solar kept below 0 €', 'Grand solaire gardé sous 0 €'), pc(last.solarLarge && last.solarLarge.kept), '', T(`${ly} · small solar ${pc(last.solarSmall && last.solarSmall.kept)}`, `${ly} · petit solaire ${pc(last.solarSmall && last.solarSmall.kept)}`)),
      card(T('Not produced below 0 €', 'Non produit sous 0 €'), n1(lost), 'TWh', T(`${ly}, wind + solar`, `${ly}, éolien + solaire`)),
    ].join('');
  }

  function fleetChart(tech, id) {
    const ys = Object.keys(D.fleet[tech].years).filter(y => +y >= 2018 && +y <= 2033), e = ys.map(y => D.fleet[tech].years[y]);
    const proj = ys.map(y => D.fleet[tech].years[y].projected);
    const ds = (lab, k, c) => ({ label: lab, data: e.map(k), backgroundColor: e.map((_, i) => proj[i] ? c + '99' : c), borderColor: 'transparent', borderWidth: 0, stack: 's' });
    _fuelChart(id, { type: 'bar', data: { labels: ys, datasets: [
      ds(T('Purchase obligation, not reached by stop orders', 'Obligation d\'achat, hors ordres d\'arrêt'), r => +(r.oa - r.oaStop).toFixed(2), C.oa),
      ds(T('Purchase obligation, reached by stop orders (law)', 'Obligation d\'achat, touchée par les ordres d\'arrêt (en vigueur)'), r => +r.oaStop.toFixed(2), C.oaStop),
      ds(T('Complément de rémunération / tender', 'Complément de rémunération / appel d\'offres'), r => +r.cr.toFixed(2), C.cr),
      ds(T('Out of support (market)', 'Sorti du soutien (marché)'), r => +r.merchant.toFixed(2), C.merchant),
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true, grid: { display: false } }), y: Object.assign(_fuelAxis('GW'), { stacked: true }) } }) }, 'flex-fleet-' + tech);
  }

  function keptChart() {
    const b = D.behaviour, w = D.wind.years || {}, ys = Object.keys(w).filter(y => +y >= 2020 && +y <= 2032);
    const meas = k => ys.map(y => b[y] && b[y].negHours >= 20 && b[y][k].kept != null ? +(b[y][k].kept * 100).toFixed(1) : null);
    const ly = Math.max(...Object.keys(b).map(Number)), pj = k => ys.map(y => +y >= ly ? +(w[y][k] * 100).toFixed(1) : null);
    const line = (lab, data, c, dash) => ({ type: 'line', label: lab, data, borderColor: c, backgroundColor: c, borderWidth: 2, borderDash: dash || [], pointRadius: dash ? 0 : 3, tension: 0, spanGaps: false });
    _fuelChart('flex-kept', { type: 'line', data: { labels: ys, datasets: [
      line(T('Wind, measured', 'Éolien, mesuré'), meas('wind'), C.wind),
      line(T('Large solar, measured', 'Grand solaire, mesuré'), meas('solarLarge'), C.large),
      line(T('Small solar, measured', 'Petit solaire, mesuré'), meas('solarSmall'), C.small),
      line(T('Wind, projected: stop orders as observed', 'Éolien, projeté : ordres d\'arrêt comme observé'), pj('kept'), C.wind, [5, 4]),
      line(T('Wind, projected: stop orders applied to every park reached', 'Éolien, projeté : ordres d\'arrêt appliqués à tous les parcs visés'), pj('keptRules'), C.proj, [2, 3]),
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: Object.assign(_fuelAxis(T('% of the output that could have been produced', '% de la production possible')), { min: 0, max: 100 }) } }) }, 'flex-kept');
  }

  function lostChart() {
    const b = D.behaviour, ys = Object.keys(b);
    const ds = (lab, k, c) => ({ label: lab, data: ys.map(y => b[y][k].lostTWh), backgroundColor: c, borderWidth: 0, stack: 's' });
    const rte = (D.rte && D.rte.years) || {};
    _fuelChart('flex-lost', { type: 'bar', data: { labels: ys, datasets: [ds(T('Wind', 'Éolien'), 'wind', C.wind), ds(T('Large solar', 'Grand solaire'), 'solarLarge', C.large), ds(T('Small solar', 'Petit solaire'), 'solarSmall', C.small),
      { type: 'line', label: T('RTE estimate (Bilan électrique)', 'Estimation RTE (Bilan électrique)'), data: ys.map(y => rte[y] ? rte[y].total : null), showLine: false, pointStyle: 'rectRot', pointRadius: 6, borderColor: '#F4F1EA', backgroundColor: '#F4F1EA' }] },
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true, grid: { display: false } }), y: Object.assign(_fuelAxis('TWh'), { stacked: true }) } }) }, 'flex-lost');
  }

  function rules() {
    const today = new Date().toISOString().slice(0, 10);
    $('flex-rules').innerHTML = `<thead><tr><th style="width:96px">${T('From', 'Depuis')}</th><th>${T('Obligation', 'Obligation')}</th><th style="width:110px">${T('Status', 'Statut')}</th></tr></thead><tbody>` +
      D.rules.map(r => `<tr><td>${r.from}</td><td>${/^https?:/.test(r.source) ? `${fr() ? r.fr : r.en} · <a href="${r.source}" target="_blank" rel="noopener" style="color:#7FC8F8">${T('source', 'source')}</a>` : (fr() ? r.fr : r.en) + ' · ' + r.source}</td><td>${r.status === 'proposed' ? T('proposed', 'proposé') : r.from > today ? T('adopted, to come', 'adopté, à venir') : T('in force', 'en vigueur')}</td></tr>`).join('') + '</tbody>';
  }

  function note() {
    const w = D.wind, a = w.alphaUsed, ay = (w.alphaYears || []).join(', '), sy = D.fleet.solar.years;
    const py = Object.keys(sy).find(y => sy[y].oaStopProp > sy[y].oaStop + 0.01), extra = py ? sy[py].oaStopProp - sy[py].oaStop : 0;
    $('flex-note').textContent = T(
      `Wind: the share kept below 0 € = the purchase-obligation share (which has no reason to stop) + what the other parks keep, ${pc(a)} on average in ${ay}. The 2025 stop orders did not visibly change wind output, hence two projections. Small solar never stops: the proposed 100 kW threshold would reach about ${n1(extra)} GW more of purchase-obligation solar (plants of 100 kW to 1 MW). Updated each week.`,
      `Éolien : part gardée sous 0 € = la part en obligation d'achat (qui n'a pas de raison de s'arrêter) + ce que gardent les autres parcs, ${pc(a)} en moyenne en ${ay}. Les ordres d'arrêt de 2025 n'ont pas changé visiblement la production éolienne, d'où deux projections. Le petit solaire ne s'arrête jamais : le seuil de 100 kW proposé toucherait environ ${n1(extra)} GW de plus de solaire en obligation d'achat (installations de 100 kW à 1 MW). Mis à jour chaque semaine.`);
  }

  function render() {
    if (busy || !$('flex-kpis')) return;
    busy = true;
    load().then(d => {
      busy = false;
      if (!d || !d.fleet || !d.wind || !d.wind.years) { $('flex-kpis').innerHTML = `<div class="fuel-note">${T('Data not available.', 'Données indisponibles.')}</div>`; return; }
      kpis(); fleetChart('wind', 'flex-fleet-wind'); fleetChart('solar', 'flex-fleet-solar'); keptChart(); lostChart(); rules(); note();
    });
  }
  window.PKFlexShare = { render };
})();
