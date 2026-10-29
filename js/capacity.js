// ════════════════════════════════════════════════════════════════════
// INSTALLED CAPACITY — Energy-Charts (Fraunhofer ISE), CC BY 4.0
// data/history/capacity.json (scripts/fetch_energy_charts.py): installed net
// capacity per country, production type and year (GW). Energy-Charts types
// are grouped into families; planning targets, storage energy (GWh) and the
// DC duplicate of solar never enter a total (same rule as the warehouse
// function analytics.capacity_counts).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const NAMES = { FR: 'France', DE: 'Germany', BE: 'Belgium', NL: 'Netherlands', ES: 'Spain', IT: 'Italy', CH: 'Switzerland',
    AT: 'Austria', PL: 'Poland', CZ: 'Czechia', DK: 'Denmark', PT: 'Portugal' };
  const FAMILIES = [
    ['Nuclear', '#7B4B9C', t => t === 'Nuclear'],
    ['Wind onshore', '#14D3A9', t => /^Wind onshore$/.test(t)],
    ['Wind offshore', '#7FC8F8', t => /^Wind offshore$/.test(t)],
    ['Solar', '#FBBF24', t => /^Solar( AC)?$/.test(t)],
    ['Hydro', '#3FA6B4', t => /^Hydro/.test(t) && !/pumped/i.test(t)],
    ['Pumped storage', '#2C7DA0', t => /pumped/i.test(t)],
    ['Batteries (power)', '#94D2BD', t => /Battery storage \(power\)/.test(t)],
    ['Gas', '#ED6965', t => /gas/i.test(t) && /Fossil/.test(t) && !/coal-derived/.test(t)],
    ['Coal & lignite', '#8D99AE', t => /coal|lignite/i.test(t)],
    ['Oil', '#D6A77A', t => /oil/i.test(t)],
    ['Biomass & waste', '#76C893', t => /Biomass|Waste|Landfill|incinerat/i.test(t)],
    ['Other', '#5C6B7A', () => true],
  ];
  const counts = t => !(/planned/i.test(t) || /\(capacity\)/.test(t) || t === 'Solar DC');
  const family = t => FAMILIES.find(f => f[2](t));

  let dataP = null;
  const load = () => dataP || (dataP = fetch(DATA_BASE + 'history/capacity.json').then(r => r.ok ? r.json() : null).catch(() => null));

  // { years, fam: {family: [GW per year]} } for one country.
  function byFamily(c) {
    const fam = {};
    Object.entries(c.types).forEach(([t, vals]) => {
      if (!counts(t)) return;
      const f = family(t)[0];
      fam[f] = fam[f] || c.years.map(() => null);
      vals.forEach((v, i) => { if (v != null) fam[f][i] = (fam[f][i] || 0) + v; });
    });
    return fam;
  }
  // Last year with a reported total, never a future year.
  function lastYearIdx(c) {
    const cy = new Date().getFullYear();
    for (let i = c.years.length - 1; i >= 0; i--) {
      if (c.years[i] > cy) continue;
      if (Object.entries(c.types).some(([t, v]) => counts(t) && v[i] != null && v[i] > 0)) return i;
    }
    return c.years.length - 1;
  }
  const cTitle = cc => NAMES[cc] || cc;
  const COUNTRY_PARAM = { key: 'country', label: 'Country', inTitle: true, options: Object.entries(NAMES) };
  function reg(def) {
    if (!window.PKW) return;
    PKW.register(Object.assign({ category: 'system', page: 'capacity', source: 'Energy-Charts', size: { w: 6, h: 5 } }, def));
  }

  reg({
    id: 'cap-history', title: 'Installed capacity by year', pageCanvas: 'cap-history',
    desc: 'Installed net capacity by technology and year (GW), one country.',
    params: [COUNTRY_PARAM], defaults: { country: 'FR' },
    async draw(cid, p) {
      const j = await load();
      const c = j && j.countries && j.countries[p.country];
      if (!c) { noDataMsg(cid, 'No capacity data for ' + cTitle(p.country), 'Energy-Charts'); return null; }
      const fam = byFamily(c), li = lastYearIdx(c);
      const first = Math.max(0, c.years.findIndex(y => y >= 2010));
      const idx = c.years.map((_, i) => i).filter(i => i >= first && i <= li);
      const ds = FAMILIES.filter(f => fam[f[0]] && fam[f[0]].some(v => v)).map(f => ({
        label: f[0], data: idx.map(i => fam[f[0]][i] == null ? null : +fam[f[0]][i].toFixed(2)), backgroundColor: rgba(f[1], .8), borderWidth: 0, stack: 'c' }));
      _fuelChart(cid, { type: 'bar', data: { labels: idx.map(i => String(c.years[i])), datasets: ds },
        options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis('GW', { stacked: true, beginAtZero: true }) } }) }, 'capacity-' + p.country);
      return { sub: cTitle(p.country) + ' · ' + c.years[idx[0]] + '–' + c.years[li] };
    },
  });

  reg({
    id: 'cap-compare', title: 'Installed capacity · country comparison', pageCanvas: 'cap-compare', size: { w: 12, h: 6 },
    desc: 'Latest installed capacity by technology for the 12 covered countries (GW).',
    async draw(cid) {
      const j = await load();
      if (!j || !j.countries) { noDataMsg(cid, 'capacity.json not available', 'Energy-Charts'); return null; }
      const rows = Object.entries(j.countries).map(([cc, c]) => { const fam = byFamily(c), li = lastYearIdx(c); return { cc, year: c.years[li], fam: Object.fromEntries(Object.entries(fam).map(([k, v]) => [k, v[li] || 0])) }; })
        .map(r => Object.assign(r, { total: Object.values(r.fam).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
      const ds = FAMILIES.filter(f => rows.some(r => r.fam[f[0]])).map(f => ({ label: f[0], data: rows.map(r => +(r.fam[f[0]] || 0).toFixed(2)), backgroundColor: rgba(f[1], .8), borderWidth: 0, stack: 'c' }));
      _fuelChart(cid, { type: 'bar', data: { labels: rows.map(r => cTitle(r.cc) + ' ' + r.year), datasets: ds },
        options: _fuelOpts({ indexAxis: 'y', scales: { x: _fuelAxis('GW', { stacked: true, beginAtZero: true }), y: { stacked: true, grid: { display: false }, ticks: { color: C_TX2, font: { size: 10 } } } } }) }, 'capacity-compare');
      return { sub: 'latest reported year per country' };
    },
  });

  window.renderCapacity = async function () {
    const cc = (document.getElementById('cap-country') || {}).value || 'FR';
    const j = await load();
    const upd = document.getElementById('cap-upd');
    if (!j || !j.countries) { if (upd) upd.textContent = 'capacity.json not available'; return; }
    if (upd) upd.textContent = (window.PKI18n && PKI18n.lang === 'en' ? 'Energy-Charts · RTE (France, solar and wind) · ' : 'Energy-Charts · RTE (France, solaire et éolien) · ') + (j.updated || '').slice(0, 10);
    PKW.draw('cap-history', 'cap-history', { country: cc }).then(() => { addFullscreen('cap-history'); addDownload('cap-history', 'capacity-' + cc); });
    PKW.draw('cap-compare', 'cap-compare').then(() => { addFullscreen('cap-compare'); addDownload('cap-compare', 'capacity-compare'); });
    document.getElementById('cap-history-title').textContent = 'Installed capacity by year · ' + cTitle(cc);

    const c = j.countries[cc];
    if (!c) return;
    const fam = byFamily(c), li = lastYearIdx(c), y5 = c.years.indexOf(c.years[li] - 5);
    const tot = i => Object.values(fam).reduce((a, v) => a + (v[i] || 0), 0);
    const ren = i => ['Wind onshore', 'Wind offshore', 'Solar', 'Hydro', 'Biomass & waste'].reduce((a, k) => a + ((fam[k] || [])[i] || 0), 0);
    const f1 = v => v == null ? '–' : v.toFixed(1);
    const sg = v => v == null ? '–' : (v >= 0 ? '+' : '') + v.toFixed(1);
    document.getElementById('cap-kpis').innerHTML =
      _fuelKpi('Total installed', f1(tot(li)), 'GW', c.years[li] + (y5 >= 0 ? ` · ${sg(tot(li) - tot(y5))} GW in 5 years` : '')) +
      _fuelKpi('Renewables', f1(ren(li)), 'GW', (ren(li) / tot(li) * 100).toFixed(0) + '% of installed') +
      _fuelKpi('Solar', f1((fam.Solar || [])[li]), 'GW', y5 >= 0 && fam.Solar ? sg(fam.Solar[li] - (fam.Solar[y5] || 0)) + ' GW in 5 years' : '') +
      _fuelKpi('Wind', f1(((fam['Wind onshore'] || [])[li] || 0) + ((fam['Wind offshore'] || [])[li] || 0)), 'GW', 'onshore + offshore') +
      _fuelKpi('Nuclear', f1((fam.Nuclear || [])[li] || 0), 'GW', '') +
      _fuelKpi('Gas + coal', f1(((fam.Gas || [])[li] || 0) + ((fam['Coal & lignite'] || [])[li] || 0)), 'GW', y5 >= 0 ? sg(((fam.Gas || [])[li] || 0) + ((fam['Coal & lignite'] || [])[li] || 0) - ((fam.Gas || [])[y5] || 0) - ((fam['Coal & lignite'] || [])[y5] || 0)) + ' GW in 5 years' : '');
    document.getElementById('cap-table-title').textContent = 'By technology · ' + cTitle(cc) + ' ' + c.years[li];
    document.getElementById('cap-tbody').innerHTML = FAMILIES.filter(f => fam[f[0]] && fam[f[0]][li]).map(f => {
      const v = fam[f[0]][li], old = y5 >= 0 ? fam[f[0]][y5] : null;
      return `<tr><td class="l"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${f[1]};margin-right:7px"></span>${f[0]}</td>` +
        `<td style="font-weight:600">${f1(v)}</td><td>${(v / tot(li) * 100).toFixed(1)}%</td><td>${old == null ? '–' : f1(old)}</td>` +
        `<td style="color:${old == null ? 'var(--text3)' : v - old >= 0 ? 'var(--up)' : 'var(--down)'}">${old == null ? '–' : sg(v - old)}</td></tr>`;
    }).join('');
  };
})();
