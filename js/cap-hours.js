// ════════════════════════════════════════════════════════════════════
// FULL-LOAD HOURS, FRANCE (Installed Capacity page)
//   hours/year a technology would run at full output to produce its actual
//   yearly generation = production (TWh) ÷ installed capacity (GW), both
//   already in data/history/bilan.json (RTE éCO2mix + ODRÉ, scripts/build_bilan.py).
//   Coal and oil have no tracked capacity in that file (negligible, phased
//   out): left out rather than shown with a meaningless denominator.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const TECH = [['nuclear', 'Nuclear', '#7B4B9C'], ['hydro', 'Hydro', '#3FA6B4'], ['wind', 'Wind', '#14D3A9'], ['solar', 'Solar', '#FBBF24'], ['gas', 'Gas', '#ED6965'], ['bio', 'Biomass', '#76C893']];
  const LAB_FR = { Nuclear: 'Nucléaire', Hydro: 'Hydraulique', Wind: 'Éolien', Solar: 'Solaire', Gas: 'Gaz', Biomass: 'Biomasse' };
  async function draw(cid) {
    let j = null; try { const r = await fetch(DATA_BASE + 'history/bilan.json'); j = r.ok ? await r.json() : null; } catch (_) {}
    if (!j || !j.years) { noDataMsg(cid, T('Pas de données de bilan', 'No bilan data'), ''); return null; }
    const ys = Object.keys(j.years).sort();
    const cap = y => y.capacity || {};
    const capOf = (y, t) => t === 'wind' ? (cap(y).wind_on || 0) + (cap(y).wind_off || 0) : cap(y)[t];
    const hours = (y, t) => { const c = capOf(y, t), p = (y.by_source || {})[t]; return c > 0 && p != null ? Math.round(p * 1000 / c) : null; };
    const labels = ys.concat(j.current ? [String(j.current.year) + T(' (à date)', ' (to date)')] : []);
    const yearData = ys.map(y => j.years[y]).concat(j.current ? [Object.assign({ by_source: j.current.now.by_source, capacity: j.years[ys[ys.length - 1]].capacity }, {})] : []);
    const ds = TECH.map(([k, lab, col]) => ({ label: lab, data: yearData.map(y => hours(y, k)), borderColor: col, borderWidth: 2, pointRadius: 2, spanGaps: true }));
    _fuelChart(cid, { type: 'line', data: { labels, datasets: ds }, options: _fuelOpts({
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } },
      scales: { x: _fuelXAxis(), y: _fuelAxis('hours/year', { beginAtZero: true }) } }) }, 'france-full-load-hours');
    const ly = yearData[yearData.length - 1], lyLabel = labels[labels.length - 1];
    const bits = TECH.map(([k, lab]) => { const h = hours(ly, k); return h != null ? `${T(LAB_FR[lab] || lab, lab)} ${h.toLocaleString('en-GB')} h (${((ly.by_source || {})[k] || 0).toFixed(1)} TWh)` : null; }).filter(Boolean);
    return { sub: T(`${lyLabel} · 8,760 h/an possibles · ${bits.join(' · ')} · charbon et fioul exclus (capacité non suivie)`,
      `${lyLabel} · 8,760 h/year possible · ${bits.join(' · ')} · coal and oil excluded (no tracked capacity)`) };
  }
  if (window.PKW) PKW.register({ id: 'cap-hours', title: 'France · full-load hours by technology', category: 'renewables', page: 'capacity', pageCanvas: 'cap-hours', source: 'RTE (ODRÉ) · Energy-Charts', size: { w: 12, h: 5 },
    desc: 'Equivalent full-load hours each year: yearly production ÷ installed capacity, by technology. How much each technology actually ran, not just how much of it is installed.', draw });
  const show = () => { if (document.getElementById('cap-hours')) PKW.draw('cap-hours', 'cap-hours', {}).then(r => { const e = document.getElementById('cap-hours-sub'); if (e && r) e.textContent = r.sub; }); };
  PK.onPage('capacity', () => setTimeout(show, 200));
})();
