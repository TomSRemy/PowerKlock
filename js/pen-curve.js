// ════════════════════════════════════════════════════════════════════
// PRICE vs SOLAR (WIND) PENETRATION, YEAR BY YEAR (Renewables › Cannibalisation)
//   data/history/penetration_curve.json (scripts/build_penetration_curve.py): for every hour since 2016,
//   penetration = national solar (wind) output ÷ consumption, relative price = the hour's day-ahead price ÷ its
//   month's average; mean relative price by penetration band, one line per year. Shows how much an hour loses as
//   solar covers more of the demand, and how that link moves from year to year.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  let J = null;
  const load = () => J ? Promise.resolve(J) : fetch(DATA_BASE + 'history/penetration_curve.json').then(r => r.ok ? r.json() : null).then(j => (J = j)).catch(() => null);
  const fr = () => !window.PKI18n || PKI18n.lang !== 'en';
  const T = (f, e) => fr() ? f : e;
  const num = (v, d) => { const s = v.toFixed(d); return fr() ? s.replace('.', ',') : s; };

  // the last three complete years in their own colours, the year to date in violet and dashed, 2022 (gas crisis) in sand
  // and dotted, the older years thin and grey
  const RECENT = ['#E8A33D', '#4FB3BF', '#5B9BD5'];
  function style(y, full, partial) {
    if (partial) return { c: '#A87DC4', w: 2.6, dash: [6, 4] };
    const k = full.slice(-3).indexOf(y);
    if (k >= 0) return { c: RECENT[k], w: 2.4, dash: [] };
    if (y === '2022') return { c: '#B8A07E', w: 1.4, dash: [2, 3] };
    return { c: '#6B7C89', w: 1.1, dash: [] };
  }

  async function draw(cid, p) {
    const j = await load(); if (!j) { noDataMsg(cid, 'No hourly data', 'RTE · ENTSO-E'); return null; }
    // the coupled region (France, Germany, Belgium, Spain): what drives the French price hour by hour
    const tech = 'region', b = j.bands[tech];
    const ys = Object.keys(j.years).filter(y => j.years[y][tech] && j.years[y][tech].some(v => v != null)).sort();
    // bands up to the last one any year reaches (for the reading below)
    const nb = Math.max(...ys.map(y => j.years[y][tech].reduce((a, v, i) => v != null ? i + 1 : a, 0)));
    const labels = b.slice(0, nb).map((v, i) => `${Math.round(v * 100)}–${Math.round(b[i + 1] * 100)} %`);
    const full = ys.filter(y => j.years[y].complete);
    const mid = i => +((b[i] + b[i + 1]) / 2 * 100).toFixed(1);
    const alpha = (c, a) => { const h = c.replace('#', ''); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };
    // one point per hour (a sample of each recent year), each year's mean by band as a line over the points;
    // the older years as thin lines only
    const ds = [];
    ys.forEach(y => {
      const r = j.years[y], part = !r.complete, st = style(y, full, part), pts = r[tech + 'Pts'];
      const name = y + (part ? T(' (à date)', ' (to date)') : '');
      if (pts && pts.length) ds.push({ type: 'scatter', label: name, data: pts.map(([x, v]) => ({ x: +(x * 100).toFixed(1), y: +(v * 100).toFixed(1) })),
        backgroundColor: alpha(st.c, 0.42), borderWidth: 0, pointRadius: 1.8, pkPts: true, pointHoverRadius: 3, order: 2 });
      ds.push({ type: 'line', label: name, pkMean: true, data: r[tech].slice(0, nb).map((v, i) => v == null ? null : { x: mid(i), y: +(v * 100).toFixed(1) }).filter(Boolean),
        borderColor: st.c, backgroundColor: st.c, borderWidth: pts ? 2.6 : st.w, borderDash: st.dash, pointRadius: 0, tension: 0, fill: false, order: pts ? 0 : 1 });
    });
    const n0 = Math.min(...ys.map(y => j.years[y][tech].findIndex(v => v != null)).filter(i => i >= 0));
    const xMin = Math.floor(b[n0] * 100 / 10) * 10, xMax = Math.ceil(b[nb] * 100 / 10) * 10;
    _fuelChart(cid, { type: 'scatter', data: { datasets: ds }, options: _fuelOpts({
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 6,
          filter: (it, d) => !d.datasets[it.datasetIndex].pkPts } },   // one entry per year: its line
        tooltip: { callbacks: { title: it => T('Couverture : ', 'Covered: ') + num(it[0].parsed.x, 0) + ' %',
          label: c => ` ${c.dataset.label} : ${num(c.parsed.y, 0)} % ${T('du prix moyen du mois', 'of the month’s average price')}` } } },
      scales: { x: Object.assign(_fuelXAxis(), { type: 'linear', min: xMin, max: xMax, ticks: Object.assign({}, _fuelXAxis().ticks, { callback: v => v + ' %' }),
          title: { display: true, text: T('part de la consommation de la région couverte par solaire, éolien et nucléaire, heure par heure', 'share of the region’s consumption covered by solar, wind and nuclear, hour by hour'), color: C_TX2, font: { size: 10 } }, grid: { display: false } }),
        y: _fuelAxis(T('prix de l’heure, % du prix moyen du mois', 'price of the hour, % of the month’s average'), { min: -50, max: 250 }) } }) }, 'price-vs-penetration-' + tech);
    // the reading: the same band in the first complete year, the worst year and the latest one
    const k = b.findIndex(v => v >= 0.8);
    const at = y => j.years[y] && j.years[y][tech][k];
    const seen = ys.filter(y => at(y) != null);
    let txt = '';
    if (seen.length >= 2) {
      const first = seen[0], last = seen[seen.length - 1], low = seen.reduce((a, y) => at(y) < at(a) ? y : a, seen[0]);
      const band = labels[k], pc = v => num(v * 100, 0) + ' %';
      const midF = low !== first && low !== last ? `, ${pc(at(low))} en ${low}` : '', midE = low !== first && low !== last ? `, ${pc(at(low))} in ${low}` : '';
      txt = T(`Quand solaire, éolien et nucléaire couvrent ${band} de la consommation de la région, une heure valait ${pc(at(first))} du prix moyen du mois en ${first}${midF} et ${pc(at(last))} en ${last}${j.years[last].complete ? '' : ' (à date)'} : le lien entre production et prix bouge d’une année à l’autre (voisins, nucléaire, gaz, stockage, arrêts aux prix négatifs).`,
        `When solar, wind and nuclear cover ${band} of the region’s consumption, an hour was worth ${pc(at(first))} of the month’s average price in ${first}${midE} and ${pc(at(last))} in ${last}${j.years[last].complete ? '' : ' (to date)'}: the link between output and price moves from one year to the next (neighbours, nuclear, gas, storage, curtailment at negative prices).`);
    }
    const sub = document.getElementById(cid + '-sub');
    if (sub) sub.textContent = T('France + Allemagne + Belgique + Espagne · un point par heure (échantillon des quatre dernières années) et la moyenne de chaque année · prix français de l’heure ÷ prix moyen de son mois', 'France + Germany + Belgium + Spain · one point per hour (a sample of the last four years) and each year’s mean · the French price of the hour ÷ its month’s average');
    const note = document.getElementById(cid + '-note');
    if (note) note.textContent = txt;
    return { sub: txt };
  }

  if (window.PKW) PKW.register({ id: 'cannib-penetration-years', title: 'Price vs the region’s coverage by solar, wind and nuclear', category: 'renewables', page: 'renewables', pageCanvas: 'cn-pen',
    source: 'RTE · ENTSO-E', size: { w: 12, h: 6 },
    desc: 'Every hour since 2016: the French price of the hour (÷ its month’s average) against the share of the coupled region’s consumption (France, Germany, Belgium, Spain) covered by solar, wind and nuclear; a point per hour for the last four years and one mean line per year.', draw });
})();
