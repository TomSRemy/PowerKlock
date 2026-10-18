// ════════════════════════════════════════════════════════════════════
// FRANCE REGIONS — RTE / ODRÉ open data (Etalab licence), read in the browser
//   eco2mix-regional-tr  : 15-min regional consumption, production per
//                          technology and load factors (TCH, %), ~2 months
//   registre-national-…  : national registry of production / storage
//                          installations (power in kW), aggregated by region
//   consommation-quotidienne-brute : France gas (hourly, MW PCS) and
//                          electricity (30-min, MW) consumption since 2012,
//                          consolidated with a lag of about six weeks
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const API = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/';
  const cache = new Map();
  function q(ds, params) {
    const url = API + ds + '/records?' + Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    if (!cache.has(url)) cache.set(url, fetch(url).then(r => r.ok ? r.json() : null).then(j => j && j.results ? j.results : null).catch(() => null));
    return cache.get(url);
  }
  const SHORT = { 'Auvergne-Rhône-Alpes': 'ARA', 'Bourgogne-Franche-Comté': 'BFC', 'Bretagne': 'BRE', 'Centre-Val de Loire': 'CVL', 'Grand Est': 'GES',
    'Hauts-de-France': 'HDF', 'Normandie': 'NOR', 'Nouvelle-Aquitaine': 'NAQ', 'Occitanie': 'OCC', 'Pays de la Loire': 'PDL',
    "Provence-Alpes-Côte d'Azur": 'PACA', 'Île-de-France': 'IDF' };
  const f1 = v => v == null || isNaN(v) ? '–' : (+v).toFixed(1);

  // Daily averages per region for one Paris day.
  async function regionDay(day) {
    const [a, b] = PK_E2M.dayBoundsUTC(day);
    const rows = await q('eco2mix-regional-tr', {
      select: 'libelle_region, avg(consommation) as cons, avg(eolien) as wind, avg(solaire) as solar, avg(tch_eolien) as lf_wind, avg(tch_solaire) as lf_solar, avg(nucleaire) as nuc, avg(hydraulique) as hydro, avg(thermique) as thermal, avg(bioenergies) as bio, avg(ech_physiques) as exch, count(consommation) as n',
      where: `date_heure >= "${a}" and date_heure < "${b}"`, group_by: 'libelle_region', limit: 20 });
    return rows && rows.length ? rows : null;
  }
  // Latest day with (nearly) complete regional data, within 5 days.
  async function latestDay() {
    for (let k = 1; k <= 5; k++) {
      const d = _renAdd(pkTodayISO(), -k), r = await regionDay(d);
      if (r && r.every(x => x.n >= 90)) return { day: d, rows: r };
    }
    return null;
  }

  function reg(def) {
    if (!window.PKW) return;
    PKW.register(Object.assign({ category: 'france', page: 'regions', source: 'RTE · ODRÉ', size: { w: 6, h: 5 } }, def));
  }

  reg({
    id: 'fr-reg-lf', title: 'France regions · wind & solar load factors', pageCanvas: 'reg-lf',
    desc: 'Average load factor (output ÷ installed capacity) of wind and solar per region, latest complete day.',
    async draw(cid) {
      const L = await latestDay();
      if (!L) { noDataMsg(cid, 'Regional éCO2mix not reachable', 'ODRÉ'); return null; }
      const rows = L.rows.slice().sort((x, y) => (y.lf_wind || 0) - (x.lf_wind || 0));
      _fuelChart(cid, { type: 'bar', data: { labels: rows.map(r => SHORT[r.libelle_region] || r.libelle_region), datasets: [
        { label: 'Wind load factor (%)', data: rows.map(r => r.lf_wind == null ? null : +(+r.lf_wind).toFixed(1)), backgroundColor: rgba('#14D3A9', .75), borderRadius: 2 },
        { label: 'Solar load factor (%)', data: rows.map(r => r.lf_solar == null ? null : +(+r.lf_solar).toFixed(1)), backgroundColor: rgba('#FBBF24', .75), borderRadius: 2 },
      ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('% of installed capacity', { beginAtZero: true }) } }) }, 'regional-load-factors-' + L.day);
      return { sub: _renFmtDay(L.day), L };
    },
  });

  // Installed capacity per region and technology from the national registry (kW → GW).
  let capP = null;
  function regionCapacity() {
    return capP || (capP = q('registre-national-installation-production-stockage-electricite-agrege', {
      select: 'region, filiere, sum(puismaxinstallee) as kw, sum(nbinstallations) as n', group_by: 'region, filiere', limit: 400 }));
  }
  const FIL = [['Nucléaire', 'Nuclear', '#7B4B9C'], ['Hydraulique', 'Hydro', '#3FA6B4'], ['Eolien', 'Wind', '#14D3A9'], ['Solaire', 'Solar', '#FBBF24'],
    ['Thermique non renouvelable', 'Fossil thermal', '#ED6965'], ['Bioénergies', 'Bioenergy', '#94D2BD'], ['Stockage non hydraulique', 'Storage (non-hydro)', '#2C7DA0']];
  reg({
    id: 'fr-reg-cap', title: 'France regions · installed capacity', pageCanvas: 'reg-cap', size: { w: 12, h: 6 },
    desc: 'Installed capacity per region and technology from the national registry of installations (GW).',
    async draw(cid) {
      const rows = await regionCapacity();
      if (!rows) { noDataMsg(cid, 'National registry not reachable', 'ODRÉ'); return null; }
      const regions = [...new Set(rows.map(r => r.region).filter(r => SHORT[r]))];
      const tot = rg => rows.filter(r => r.region === rg).reduce((a, r) => a + (r.kw || 0), 0);
      regions.sort((x, y) => tot(y) - tot(x));
      const val = (rg, fil) => { const r = rows.find(x => x.region === rg && x.filiere === fil); return r && r.kw ? +(r.kw / 1e6).toFixed(2) : 0; };
      _fuelChart(cid, { type: 'bar', data: { labels: regions.map(r => SHORT[r] || r), datasets: FIL.map(([fr, en, col]) => ({
        label: en, data: regions.map(rg => val(rg, fr)), backgroundColor: rgba(col, .8), borderWidth: 0, stack: 'c' })) },
        options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis('GW', { stacked: true, beginAtZero: true }) } }) }, 'regional-capacity');
      return { sub: 'registry of installations · ' + regions.length + ' regions' };
    },
  });

  // France daily gas and electricity consumption (GW, daily averages).
  const DEM_PERIOD = { key: 'years', label: 'History', options: [['1', '1 year'], ['3', '3 years'], ['5', '5 years'], ['14', 'Since 2012']] };
  reg({
    id: 'fr-gas-elec', title: 'France · daily gas and electricity consumption', pageCanvas: 'reg-gas-elec', size: { w: 12, h: 5 },
    desc: 'Daily average consumption in GW: gas (NaTran + Teréga, PCS) and electricity (RTE), consolidated data.',
    params: [DEM_PERIOD], defaults: { years: '3' },
    async draw(cid, p) {
      const from = (new Date().getFullYear() - (+p.years || 3)) + '-01-01';
      // Grouped on the dataset's own Paris-day field (dd/mm/yyyy); the export
      // endpoint has no 100-row cap.
      const url = API + 'consommation-quotidienne-brute/exports/json?' + [
        ['select', 'date, avg(consommation_brute_gaz_totale) as gas, avg(consommation_brute_electricite_rte) as elec'],
        ['where', `date_heure >= "${from}"`], ['group_by', 'date']].map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
      if (!cache.has(url)) cache.set(url, fetch(url).then(r => r.ok ? r.json() : null).catch(() => null));
      const raw = await cache.get(url);
      if (!raw || !raw.length) { noDataMsg(cid, 'ODRÉ not reachable', 'odre.opendatasoft.com'); return null; }
      const rows = raw.map(r => ({ d: r.date.split('/').reverse().join('-'), gas: r.gas, elec: r.elec }))
        .filter(r => r.gas != null || r.elec != null).sort((a, b) => a.d < b.d ? -1 : 1);
      const gw = v => v == null ? null : +(v / 1000).toFixed(2);
      _fuelChart(cid, { type: 'line', data: { labels: rows.map(r => r.d), datasets: [
        _fuelLineDs('Gas (GW, PCS)', rows.map(r => gw(r.gas)), '#C4A57B', { borderWidth: 1.4 }),
        _fuelLineDs('Electricity (GW)', rows.map(r => gw(r.elec)), '#14D3A9', { borderWidth: 1.4 }),
      ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { beginAtZero: true }) } }) }, 'fr-gas-elec');
      return { sub: rows[0].d + ' → ' + rows[rows.length - 1].d + ' (consolidated, ~6-week lag)' };
    },
  });

  window.renderRegions = async function () {
    const upd = document.getElementById('reg-upd');
    const lf = await PKW.draw('fr-reg-lf', 'reg-lf');
    PKW.draw('fr-reg-cap', 'reg-cap').then(() => { addFullscreen('reg-cap'); addDownload('reg-cap', 'regional-capacity'); });
    const yrs = window._regYears || '3';
    PKW.draw('fr-gas-elec', 'reg-gas-elec', { years: yrs }).then(r => {
      addFullscreen('reg-gas-elec'); addDownload('reg-gas-elec', 'fr-gas-elec');
      const s = document.getElementById('reg-gas-elec-sub'); if (s && r) s.textContent = 'Daily averages, GW · ' + r.sub;
    });
    PKW.periodButtons('reg-gas-elec', DEM_PERIOD.options.map(o => [o[0], o[0] === '14' ? 'All' : o[0] + 'Y']), yrs, v => { window._regYears = v; PKW.draw('fr-gas-elec', 'reg-gas-elec', { years: v }); });
    setTimeout(() => { addFullscreen('reg-lf'); addDownload('reg-lf', 'regional-load-factors'); }, 100);
    const L = lf && lf.L;
    if (!L) { if (upd) upd.textContent = 'Regional éCO2mix not reachable'; return; }
    if (upd) upd.textContent = 'RTE éCO2mix régional · ' + _renFmtDay(L.day);
    document.getElementById('reg-lf-title').textContent = 'Wind & solar load factors · ' + _renFmtDay(L.day);
    document.getElementById('reg-table-title').textContent = 'Regions · daily averages · ' + _renFmtDay(L.day);
    const rows = L.rows.slice().sort((a, b) => (b.cons || 0) - (a.cons || 0));
    const sum = k => rows.reduce((a, r) => a + (+r[k] || 0), 0);
    document.getElementById('reg-kpis').innerHTML =
      _fuelKpi('Consumption', f1(sum('cons') / 1000), 'GW', 'sum of regions, day average') +
      _fuelKpi('Wind', f1(sum('wind') / 1000), 'GW', 'top region ' + (SHORT[rows.slice().sort((a, b) => b.wind - a.wind)[0].libelle_region] || '')) +
      _fuelKpi('Solar', f1(sum('solar') / 1000), 'GW', 'top region ' + (SHORT[rows.slice().sort((a, b) => b.solar - a.solar)[0].libelle_region] || '')) +
      _fuelKpi('Best wind load factor', f1(Math.max(...rows.map(r => +r.lf_wind || 0))), '%', SHORT[rows.slice().sort((a, b) => b.lf_wind - a.lf_wind)[0].libelle_region] || '') +
      _fuelKpi('Best solar load factor', f1(Math.max(...rows.map(r => +r.lf_solar || 0))), '%', SHORT[rows.slice().sort((a, b) => b.lf_solar - a.lf_solar)[0].libelle_region] || '');
    const g = v => v == null ? '–' : (v / 1000).toFixed(2);
    document.getElementById('reg-tbody').innerHTML = rows.map(r =>
      `<tr><td class="l">${r.libelle_region}</td><td>${g(r.cons)}</td><td>${g(r.nuc)}</td><td>${g(r.wind)}</td><td>${f1(r.lf_wind)}%</td><td>${g(r.solar)}</td><td>${f1(r.lf_solar)}%</td>` +
      `<td>${g(r.hydro)}</td><td>${g(r.thermal)}</td><td style="color:${(r.exch || 0) > 0 ? 'var(--down)' : 'var(--up)'}">${(r.exch || 0) > 0 ? '+' : ''}${g(r.exch)}</td></tr>`).join('');
  };
})();
