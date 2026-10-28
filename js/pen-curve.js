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
    const tech = (p && p.tech) === 'wind' ? 'wind' : 'solar', b = j.bands[tech];
    const ys = Object.keys(j.years).filter(y => j.years[y][tech] && j.years[y][tech].some(v => v != null)).sort();
    // bands up to the last one any year reaches
    const nb = Math.max(...ys.map(y => j.years[y][tech].reduce((a, v, i) => v != null ? i + 1 : a, 0)));
    const labels = b.slice(0, nb).map((v, i) => `${Math.round(v * 100)}–${Math.round(b[i + 1] * 100)} %`);
    const full = ys.filter(y => j.years[y].complete);
    const ds = ys.map(y => {
      const r = j.years[y], part = !r.complete, st = style(y, full, part);
      return { label: y + (part ? T(' (à date)', ' (to date)') : ''), data: r[tech].slice(0, nb).map(v => v == null ? null : +(v * 100).toFixed(1)),
        borderColor: st.c, backgroundColor: st.c, borderWidth: st.w, borderDash: st.dash, pointRadius: st.w > 2 ? 2.5 : 1.5, tension: 0, fill: false, spanGaps: false,
        order: st.w > 2 ? 0 : 1 };
    });
    _fuelChart(cid, { type: 'line', data: { labels, datasets: ds }, options: _fuelOpts({
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 6 } },
        tooltip: { callbacks: { title: it => (tech === 'solar' ? T('Part du solaire : ', 'Solar share: ') : T('Part de l’éolien : ', 'Wind share: ')) + it[0].label,
          label: c => c.raw == null ? null : ` ${c.dataset.label} : ${num(c.raw, 0)} % ${T('du prix moyen du mois', 'of the month’s average price')}` } } },
      scales: { x: Object.assign(_fuelXAxis(), { title: { display: true, text: tech === 'solar' ? T('part du solaire dans la consommation, heure par heure', 'solar share of consumption, hour by hour') : T('part de l’éolien dans la consommation, heure par heure', 'wind share of consumption, hour by hour'), color: C_TX2, font: { size: 10 } }, grid: { display: false } }),
        y: _fuelAxis(T('prix de l’heure, % du prix moyen du mois', 'price of the hour, % of the month’s average'), { min: 0 }) } }) }, 'price-vs-penetration-' + tech);
    // the reading: the same band in the first complete year, the worst year and the latest one
    const k = tech === 'solar' ? b.findIndex(v => v >= 0.25) : b.findIndex(v => v >= 0.3);
    const at = y => j.years[y] && j.years[y][tech][k];
    const seen = ys.filter(y => at(y) != null);
    let txt = '';
    if (seen.length >= 2) {
      const first = seen[0], last = seen[seen.length - 1], low = seen.reduce((a, y) => at(y) < at(a) ? y : a, seen[0]);
      const band = labels[k], pc = v => num(v * 100, 0) + ' %';
      const midF = low !== first && low !== last ? `, ${pc(at(low))} en ${low}` : '', midE = low !== first && low !== last ? `, ${pc(at(low))} in ${low}` : '';
      txt = T(`À ${band} de ${tech === 'solar' ? 'solaire' : 'éolien'}, une heure valait ${pc(at(first))} du prix moyen du mois en ${first}${midF} et ${pc(at(last))} en ${last}${j.years[last].complete ? '' : ' (à date)'} : le lien entre production et prix bouge d’une année à l’autre (voisins, nucléaire, gaz, stockage, arrêts aux prix négatifs).`,
        `At ${band} ${tech}, an hour was worth ${pc(at(first))} of the month’s average price in ${first}${midE} and ${pc(at(last))} in ${last}${j.years[last].complete ? '' : ' (to date)'}: the link between output and price moves from one year to the next (neighbours, nuclear, gas, storage, curtailment at negative prices).`);
    }
    const sub = document.getElementById(cid + '-sub');
    if (sub) sub.textContent = T('Une ligne par année · prix de chaque heure ÷ prix moyen de son mois, par part de la consommation couverte', 'One line per year · each hour’s price ÷ its month’s average, by share of consumption covered');
    const note = document.getElementById(cid + '-note');
    if (note) note.textContent = txt;
    return { sub: txt };
  }

  if (window.PKW) PKW.register({ id: 'cannib-penetration-years', title: 'Price vs solar or wind share, year by year', category: 'renewables', page: 'renewables', pageCanvas: 'cn-pen',
    source: 'RTE · ENTSO-E', size: { w: 12, h: 6 }, params: [{ key: 'tech', label: 'Technology', options: [['solar', 'Solar'], ['wind', 'Wind']], inTitle: true }], titleFn: p => 'Price vs ' + (p.tech === 'wind' ? 'wind' : 'solar') + ' share, year by year', defaults: { tech: 'solar' },
    pageParams: () => ({ tech: (document.getElementById('cn-tech') || {}).value || 'solar' }),
    desc: 'Every hour since 2016: the price of the hour (÷ its month’s average) against the share of French consumption covered by solar or wind, one line per year.', draw });
})();
