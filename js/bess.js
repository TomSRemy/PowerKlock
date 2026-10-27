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
  const C_PF = '#7FC8F8', C_PW = '#A87DC4', C_NV = '#FBBF24';   // blue, violet, amber: the site's palette, little green
  const fr = () => { try { return localStorage.getItem('pk-lang') !== 'en'; } catch (_) { return true; } };
  const num = (v, d) => v == null || isNaN(v) ? '–' : Number(v).toFixed(d == null ? 0 : d);

  function load() {
    if (S.doc) return Promise.resolve(S.doc);
    if (!S.loading) S.loading = fetch('data/history/bess_da.json').then(r => r.ok ? r.json() : null).catch(() => null).then(j => { S.doc = j; return j; });
    return S.loading;
  }

  // reserves: FCR French price per delivery day, French FCR need, ECB 10-year rate (scripts/fetch_reserves.py)
  let resP = null;
  const loadRes = () => resP || (resP = fetch('data/history/reserves_fr.json').then(r => r.ok ? r.json() : null).catch(() => null));
  // average of the last 365 delivery days held (or fewer when the history is shorter), € per MW per day
  function fcrLtm(R) {
    const k = Object.keys(R.fcr || {}).sort().slice(-365); if (!k.length) return null;
    return { avg: k.reduce((a, d) => a + R.fcr[d], 0) / k.length, n: k.length, from: k[0], to: k[k.length - 1] };
  }
  function lastRate(R) { const k = Object.keys(R.rate10y || {}).sort(); return k.length ? { v: R.rate10y[k[k.length - 1]], d: k[k.length - 1] } : null; }

  function reserves(R) {
    if (!$('bess-res-kpis')) return;
    const T = (f, e) => fr() ? f : e;
    const L = R && fcrLtm(R);
    if (!L) { $('bess-res-kpis').innerHTML = '<div class="fuel-note">' + T('Pas encore de données de réserve.', 'No reserve data yet.') + '</div>'; return; }
    const by = {};
    Object.keys(R.fcr).forEach(d => { const m = d.slice(0, 7); (by[m] = by[m] || []).push(R.fcr[d]); });
    const M = Object.keys(by).sort().filter(m => by[m].length >= 5);
    const mv = M.map(m => +(ann(by[m].reduce((a, b) => a + b, 0) / by[m].length)).toFixed(1));
    const days = Object.keys(R.fcr).sort(), d1 = days[days.length - 1];
    const need = R.fcr_mw && R.fcr_mw[d1], rt = lastRate(R);
    const fd = d => new Date(d + 'T12:00:00Z').toLocaleDateString(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    $('bess-res-kpis').innerHTML =
      _fuelKpi(T('FCR, annualisé', 'FCR, annualised'), num(ann(L.avg), 0), T('k€/MW/an', 'k€/MW/yr'), T(`${L.n} jours depuis le ${fd(L.from)}`, `${L.n} days since ${fd(L.from)}`)) +
      _fuelKpi(T('FCR, dernier mois', 'FCR, last month'), num(mv[mv.length - 1], 0), T('k€/MW/an', 'k€/MW/yr'), M[M.length - 1]) +
      _fuelKpi(T('FCR, dernier jour', 'FCR, last day'), num(R.fcr[d1], 0), T('€/MW/jour', '€/MW/day'), fd(d1)) +
      _fuelKpi(T('Besoin FCR de la France', 'French FCR need'), num(need, 0), 'MW', T('tout le marché, pour un parc qui grandit', 'the whole market, for a growing fleet')) +
      _fuelKpi(T('Taux 10 ans zone euro', 'Euro area 10-year rate'), rt ? num(rt.v, 2) : '–', '%', T('AAA, BCE · base du taux de la dette', 'AAA, ECB · base of the debt rate'));
    _fuelChart('bess-res-canvas', { type: 'bar', data: { labels: M, datasets: [
      { label: T('FCR France, annualisé', 'FCR France, annualised'), data: mv, backgroundColor: 'rgba(141,153,174,.75)', borderWidth: 0 },
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis(T('k€/MW/an', 'k€/MW/yr'), { beginAtZero: true }) } }) }, 'bess-res');
    const af = Object.keys(R.afrr || {}).length;
    $('bess-res-note').textContent = T(
      `Prix FCR = prix de règlement français de chaque bloc de 4 heures, somme des 6 blocs d’un jour, moyenne des jours × 365. C’est ce que paierait 1 MW engagé en FCR toute l’année ; le besoin français (${num(need, 0)} MW) est petit devant le parc de batteries attendu, donc une batterie n’en vend qu’une part et le prix baisse quand le parc grandit. Données publiques depuis janvier 2026. aFRR : ${af ? af + ' jours de prix de capacité (ENTSO-E)' : 'pas encore de prix de capacité français publié en open data'}.`,
      `FCR price = French settlement price of each 4-hour block, sum of the 6 blocks of a day, mean of the days × 365. It is what 1 MW committed to FCR all year would earn; the French need (${num(need, 0)} MW) is small next to the expected battery fleet, so a battery sells only a share of its power there and the price falls as the fleet grows. Public data since January 2026. aFRR: ${af ? af + ' days of capacity prices (ENTSO-E)' : 'no French capacity price published as open data yet'}.`);
  }

  // k€ per MW per year from an average € per MW per day
  const ann = v => v == null ? null : v * 365 / 1000;

  // ── Europe: the same battery in each bidding zone (data/history/bess_europe.json, scripts/bess_optim.py) ──
  let euP = null;
  const loadEu = () => euP || (euP = fetch('data/history/bess_europe.json').then(r => r.ok ? r.json() : null).catch(() => null));
  const ZN = { FR: ['France', 'France'], DE_LU: ['Allemagne', 'Germany'], BE: ['Belgique', 'Belgium'], NL: ['Pays-Bas', 'Netherlands'], AT: ['Autriche', 'Austria'],
    CH: ['Suisse', 'Switzerland'], CZ: ['Tchéquie', 'Czechia'], DK_W: ['Danemark Ouest', 'Denmark West'], PL: ['Pologne', 'Poland'], ES: ['Espagne', 'Spain'],
    IT_NORD: ['Italie Nord', 'Italy North'], SE: ['Suède', 'Sweden'] };
  function europe(E) {
    if (!$('bess-eu-kpis')) return;
    const T = (f, e) => fr() ? f : e, nm = z => (ZN[z] || [z, z])[fr() ? 0 : 1];
    if (!E || !E.zones) { $('bess-eu-kpis').innerHTML = '<div class="fuel-note">' + T('Pas encore calculé.', 'Not computed yet.') + '</div>'; return; }
    const Z = Object.keys(E.zones).map(z => Object.assign({ z }, E.zones[z])).sort((a, b) => (b.co30 != null ? b.co30 : b.da30) - (a.co30 != null ? a.co30 : a.da30));
    const withCo = Z.filter(x => x.co30 != null), fr0 = E.zones.FR || {};
    const top = withCo[0], topDa = Z.slice().sort((a, b) => b.da30 - a.da30)[0];
    const shares = withCo.map(x => x.co_fcr30 / x.co30 * 100), rank = withCo.findIndex(x => x.z === 'FR') + 1;
    $('bess-eu-kpis').innerHTML =
      _fuelKpi(T('Co-optimisé, le plus haut', 'Co-optimised, highest'), top ? num(top.co30, 0) : '–', T('k€/MW/an', 'k€/MW/yr'), top ? nm(top.z) + T(' · 30 jours', ' · 30 days') : '') +
      _fuelKpi(T('France, co-optimisé', 'France, co-optimised'), num(fr0.co30, 0), T('k€/MW/an', 'k€/MW/yr'), rank ? T(`${rank}ᵉ sur ${withCo.length} zones avec réserves`, `#${rank} of ${withCo.length} zones with reserves`) : '') +
      _fuelKpi(T('Part de la FCR', 'FCR share'), shares.length ? num(Math.min(...shares), 0) + '–' + num(Math.max(...shares), 0) : '–', '%', T('du revenu co-optimisé', 'of the co-optimised revenue')) +
      _fuelKpi(T('Day-ahead seul, le plus haut', 'Day-ahead alone, highest'), num(topDa.da30, 0), T('k€/MW/an', 'k€/MW/yr'), nm(topDa.z) + T(' · 30 jours', ' · 30 days'));
    const lab = Z.map(x => nm(x.z)), v = f => Z.map(x => x[f] != null ? x[f] : null);
    _fuelChart('bess-eu-c', { type: 'bar', data: { labels: lab, datasets: [
      { label: T('Co-optimisé : day-ahead', 'Co-optimised: day-ahead'), data: v('co_da30'), backgroundColor: 'rgba(127,200,248,.8)', borderWidth: 0, stack: 'co', order: 3 },
      { label: T('Co-optimisé : FCR', 'Co-optimised: FCR'), data: v('co_fcr30'), backgroundColor: 'rgba(168,125,196,.8)', borderWidth: 0, stack: 'co', order: 3 },
      { label: T('Co-optimisé : aFRR', 'Co-optimised: aFRR'), data: Z.map(x => x.co_afrr30 ? x.co_afrr30 : null), backgroundColor: 'rgba(237,105,101,.8)', borderWidth: 0, stack: 'co', order: 3 },
      { label: T('Day-ahead seul (pas de réserve en open data)', 'Day-ahead alone (no open reserve data)'), data: Z.map(x => x.co30 == null ? x.da30 : null), backgroundColor: 'rgba(127,200,248,.35)', borderWidth: 0, stack: 'co', order: 3 },
      { type: 'line', label: T('Day-ahead seul, pour comparer', 'Day-ahead alone, to compare'), data: v('da30'), showLine: false, pointStyle: 'line', pointRadius: 13, pointHoverRadius: 14, borderColor: '#E6EDF3', borderWidth: 2.5, stack: 'mk', order: 0 },
    ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true, ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 45 } }), y: _fuelAxis(T('k€/MW/an', 'k€/MW/yr'), { stacked: true, beginAtZero: true }) } }) }, 'bess-europe-zones');
    const SHOW = [['FR', C_BEST], ['DE_LU', C_FCR], ['NL', '#C4A57B'], ['ES', C_AF], ['PL', C_PF]].filter(([z]) => E.zones[z]);
    const ms = Object.keys(E.zones.FR ? E.zones.FR.months : {}).slice(-13);
    _fuelChart('bess-eu-m', { type: 'line', data: { labels: ms, datasets: SHOW.map(([z, c]) => _fuelLineDs(nm(z), ms.map(m => (E.zones[z].months[m] || {}).da), c, { borderWidth: z === 'FR' ? 3 : 1.6 })) },
      options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis(T('k€/MW/an', 'k€/MW/yr'), { beginAtZero: true }) } }) }, 'bess-europe-months');
    const f = x => x == null ? '–' : num(x, 0);
    $('bess-eu-t').innerHTML = '<thead><tr><th>' + T('Zone', 'Zone') + '</th><th>' + T('Day-ahead seul, 30 j', 'Day-ahead alone, 30 d') + '</th><th>' + T('Day-ahead seul, 12 mois', 'Day-ahead alone, 12 months') + '</th><th>' + T('Co-optimisé, 30 j', 'Co-optimised, 30 d') + '</th><th>' + T('dont FCR', 'of which FCR') + '</th><th>' + T('dont aFRR', 'of which aFRR') + '</th><th>' + T('Gain sur le meilleur marché seul', 'Gain over the best single market') + '</th></tr></thead><tbody>' +
      Z.map(x => '<tr><td>' + nm(x.z) + '</td><td>' + f(x.da30) + '</td><td>' + f(x.da365) + '</td><td><b>' + f(x.co30) + '</b></td><td>' + f(x.co_fcr30) + '</td><td>' + (x.co_afrr30 ? f(x.co_afrr30) : '–') + '</td><td>' +
        (x.co30 == null ? '–' : '+' + num(x.co30 - Math.max(x.da30, (x.co_fcr30 || 0) + 0), 0)) + '</td></tr>').join('') + '</tbody>';
    $('bess-eu-note').textContent = T(
      'Même batterie partout : 1 MW, 2 h, programme parfait net d’usure, preneur de prix. Day-ahead seul : prix ENTSO-E de chaque zone. Co-optimisé : un programme par jour qui partage le MW entre day-ahead, FCR (prix de règlement de chaque pays dans l’enchère commune, par bloc de 4 heures) et, pour l’Allemagne, la capacité aFRR (prix moyen des offres retenues, hausse et baisse séparées, 1 heure d’énergie gardée). Les zones sans réserve publiée en open data n’ont que le day-ahead. Le gain compare au meilleur marché seul (day-ahead seul ou FCR seule pour tout le MW).',
      'Same battery everywhere: 1 MW, 2 h, perfect schedule net of wear, price taker. Day-ahead alone: ENTSO-E prices of each zone. Co-optimised: one schedule a day sharing the MW between day-ahead, FCR (settlement price of each country in the common auction, per 4-hour block) and, for Germany, aFRR capacity (average price of the accepted bids, up and down apart, 1 hour of energy kept). Zones without reserve prices in open data have the day-ahead only. The gain compares with the best single market (day-ahead alone or FCR alone for the whole MW).');
  }
  // ── PowerKlock BESS index (data/history/bess_index.json, scripts/bess_optim.py): forward and realised, 1 MW / 2 h ──
  let idxP = null;
  const loadIdx = () => idxP || (idxP = fetch('data/history/bess_index.json').then(r => r.ok ? r.json() : null).catch(() => null));
  const C_BEST = '#A87DC4', C_FCR = '#8D99AE', C_AF = '#ED6965';
  // mean of the last n delivery days that have a value for field f, annualised; and the count
  function lastN(J, f, n) {
    const ks = Object.keys(J.realised).sort().filter(d => J.realised[d][f] != null).slice(-n);
    return ks.length ? { v: ann(ks.reduce((a, d) => a + J.realised[d][f], 0) / ks.length), n: ks.length, from: ks[0] } : null;
  }
  function index(J) {
    if (!$('bess-idx-kpis')) return;
    const T = (f, e) => fr() ? f : e;
    if (!J || !J.forward) { $('bess-idx-kpis').innerHTML = '<div class="fuel-note">' + T('Indice pas encore calculé.', 'Index not computed yet.') + '</div>'; return; }
    const fd = d => new Date(d + 'T12:00:00Z').toLocaleDateString(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const F = Object.keys(J.forward).sort(), fl = F[F.length - 1], cur = J.forward[fl];
    const back = n => { const t = new Date(Date.parse(fl) - n * 864e5).toISOString().slice(0, 10); const k = F.filter(d => d <= t).pop(); return k ? J.forward[k].v : null; };
    const sg = v => v == null ? '' : (v >= 0 ? '+' : '−') + num(Math.abs(v), 1);
    const b30 = lastN(J, 'best', 30), d30 = lastN(J, 'da', 30), c30 = lastN(J, 'co', 30), c365 = lastN(J, 'co', 365), f30 = lastN(J, 'co_f', 30);
    const R = Object.keys(J.realised).sort().filter(d => J.realised[d].mkt).slice(-30), share = {};
    R.forEach(d => { share[J.realised[d].mkt] = (share[J.realised[d].mkt] || 0) + 1; });
    const MK = { da: 'day-ahead', fcr: 'FCR', afrr: 'aFRR' };
    const top = Object.keys(share).sort((a, b) => share[b] - share[a]).map(m => MK[m] + ' ' + Math.round(share[m] / R.length * 100) + (fr() ? ' %' : '%')).join(' · ');
    const w7 = back(7), m30 = back(30);
    $('bess-idx-kpis').innerHTML =
      _fuelKpi(T('Indice forward', 'Forward index'), num(cur.v, 1), T('k€/MW/an', 'k€/MW/yr'), T(`day-ahead, Cal ${J.strip.split('-').filter((x, i, a) => i === 0 || i === a.length - 1).join('–')} · ${fd(fl)}`, `day-ahead, Cal ${J.strip.split('-').filter((x, i, a) => i === 0 || i === a.length - 1).join('–')} · ${fd(fl)}`)) +
      _fuelKpi(T('Sur 7 jours', 'Over 7 days'), w7 == null ? '–' : sg(cur.v - w7), T('k€/MW/an', 'k€/MW/yr'), T('30 jours : ', '30 days: ') + (m30 == null ? '–' : sg(cur.v - m30))) +
      _fuelKpi(T('Réalisé co-optimisé, 30 jours', 'Co-optimised, last 30 days'), c30 ? num(c30.v, 0) : '–', T('k€/MW/an', 'k€/MW/yr'), f30 ? T(`${num(f30.v / 365 * 1000 * 100, 0)} % du MW en FCR en moyenne`, `${num(f30.v / 365 * 1000 * 100, 0)}% of the MW in FCR on average`) : '') +
      _fuelKpi(T('Meilleur marché seul, 30 jours', 'Best single market, 30 days'), b30 ? num(b30.v, 0) : '–', T('k€/MW/an', 'k€/MW/yr'), top || '') +
      _fuelKpi(T('Co-optimisé, sur l’historique', 'Co-optimised, over the history'), c365 ? num(c365.v, 0) : '–', T('k€/MW/an', 'k€/MW/yr'), c365 ? T(`${c365.n} jours depuis le ${fd(c365.from)}`, `${c365.n} days since ${fd(c365.from)}`) : '') +
      _fuelKpi(T('Day-ahead seul, 30 jours', 'Day-ahead alone, 30 days'), d30 ? num(d30.v, 0) : '–', T('k€/MW/an', 'k€/MW/yr'), T('net d’usure', 'net of wear'));
    const xs = F.filter(d => d >= '2024-01-01');
    _fuelChart('bess-idx-f', { type: 'line', data: { labels: xs, datasets: [
      _fuelLineDs(T('Indice forward', 'Forward index'), xs.map(d => J.forward[d].v), C_BEST, { borderWidth: 2.2 }),
      _fuelLineDs(T('Day-ahead des 12 mois précédents', 'Day-ahead of the previous 12 months'), xs.map(d => J.forward[d].ltm), C_PF, { borderWidth: 1.3, borderDash: [5, 3] }),
      Object.assign(_fuelLineDs(T('Cal moyen de la période (€/MWh)', 'Mean Cal of the strip (€/MWh)'), xs.map(d => J.forward[d].strip), '#7A93AB', { borderWidth: 1, borderDash: [2, 3] }), { yAxisID: 'p' }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis(T('k€/MW/an', 'k€/MW/yr'), { beginAtZero: true }), p: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }) } }) }, 'bess-index-forward');
    const M = J.months.filter(m => m.m >= '2025-01');
    const ds = [
      { type: 'bar', label: T('Co-optimisé : part day-ahead', 'Co-optimised: day-ahead part'), data: M.map(m => m.co_da == null ? null : m.co_da), backgroundColor: 'rgba(127,200,248,.55)', borderWidth: 0, stack: 'co', order: 4 },
      { type: 'bar', label: T('Co-optimisé : part FCR', 'Co-optimised: FCR part'), data: M.map(m => m.co_fcr == null ? null : m.co_fcr), backgroundColor: 'rgba(168,125,196,.6)', borderWidth: 0, stack: 'co', order: 3 },
      Object.assign(_fuelLineDs(T('Meilleur marché seul', 'Best single market'), M.map(m => m.best), '#C4A57B', { borderWidth: 1.4, borderDash: [2, 3] }), { type: 'line', order: 0, stack: 'l0' }),
      Object.assign(_fuelLineDs('Day-ahead', M.map(m => m.da), C_PF, { borderWidth: 2 }), { type: 'line', order: 1, stack: 'l1' }),
      Object.assign(_fuelLineDs(T('FCR, tout le MW', 'FCR, the whole MW'), M.map(m => m.fcr), C_FCR, { borderWidth: 1.6, borderDash: [5, 3] }), { type: 'line', order: 2, stack: 'l2' }),
    ];
    if (M.some(m => m.afrr != null)) ds.push(Object.assign(_fuelLineDs(T('aFRR, tout le MW', 'aFRR, the whole MW'), M.map(m => m.afrr), C_AF, { borderWidth: 1.6, borderDash: [3, 3] }), { type: 'line', order: 0, stack: 'l3' }));
    _fuelChart('bess-idx-m', { type: 'bar', data: { labels: M.map(m => m.m), datasets: ds }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis(T('k€/MW/an', 'k€/MW/yr'), { beginAtZero: true, stacked: true }) } }) }, 'bess-index-months');
    const af = M.some(m => m.afrr != null);
    $('bess-idx-note').textContent = T(
      `Batterie de 1 MW, 2 h, France. Indice forward = valeur day-ahead des 12 mois précédents (programme parfait net d’usure) × Cal moyen ${J.strip.split('-').filter((x, i, a) => i === 0 || i === a.length - 1).join('–')} ÷ prix day-ahead moyen de ces 12 mois, recalculé pour chaque jour de cotation avec les forwards de ce jour : il bouge avec les forwards et avec les spreads réalisés. Réalisé = pour chaque jour de livraison, ce que tout le MW gagne sur chaque marché (day-ahead ; FCR, somme des 6 blocs ; ${af ? 'aFRR, prix de capacité haussier + baissier × 24 h ; ' : ''}) et le meilleur d’entre eux (une batterie qui choisit chaque jour un seul marché). Co-optimisé = un seul programme par jour qui partage le MW : par bloc de 4 heures, des MW en FCR, le reste en arbitrage day-ahead au quart d’heure, avec 15 minutes de réserve d’énergie dans chaque sens pour la FCR, net d’usure. Hypothèse de preneur de prix : le besoin FCR français (≈ 600 MW) est petit, une flotte de batteries ferait baisser ce prix. ${af ? '' : 'aFRR pas encore inclus : aucun prix de capacité français publié en open data pour l’instant. '}Le réalisé commence avec les prix FCR publics (janvier 2026).`,
      `1 MW, 2 h battery, France. Forward index = day-ahead value of the previous 12 months (perfect schedule net of wear) × mean Cal ${J.strip.split('-').filter((x, i, a) => i === 0 || i === a.length - 1).join('–')} ÷ mean day-ahead price of those 12 months, computed for every trading day with that day’s forwards: it moves with the forwards and with the realised spreads. Realised = for each delivery day, what the whole MW earns in each market (day-ahead; FCR, sum of the 6 blocks; ${af ? 'aFRR, up + down capacity price × 24 h; ' : ''}) and the best of them (a battery choosing one market a day). Co-optimised = one schedule per day that splits the MW: per 4-hour block, MW in FCR, the rest in day-ahead arbitrage per quarter-hour, with 15 minutes of energy kept both ways for FCR, net of wear. Price-taker assumption: the French FCR need (≈ 600 MW) is small, a battery fleet would push that price down. ${af ? '' : 'aFRR not included yet: no French capacity price is published as open data so far. '}The realised series starts with the public FCR prices (January 2026).`);
  }

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

  // ── a typical day: the last delivery day, quarter-hour by quarter-hour: when the battery buys and sells ──
  function day(doc) {
    const E = doc.example, k = S.h; if (!E || !E[k] || !$('bess-day-canvas')) return;
    const x = E[k], T = (f, e) => fr() ? f : e;
    const lab = E.price.map((_, i) => String(Math.floor(i / 4)).padStart(2, '0') + ':' + String((i % 4) * 15).padStart(2, '0'));
    const dd = new Date(E.d + 'T12:00:00Z').toLocaleDateString(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const nf = v => fr() ? Math.round(v).toLocaleString('fr-FR') : Math.round(v).toLocaleString('en-GB');
    $('bess-day-sub').innerHTML = T(`Le ${dd}, batterie de ${k.replace('h', ' h')} : <b>${nf(x.rev)} €</b> gagnés par MW sur le day-ahead, dont ${nf(x.wear)} € d’usure · programme parfait net d’usure`,
      `${dd}, ${k.replace('h', ' h')} battery: <b>€${nf(x.rev)}</b> earned per MW on the day-ahead, of which €${nf(x.wear)} wear · perfect schedule net of wear`);
    _fuelChart('bess-day-canvas', { type: 'bar', data: { labels: lab, datasets: [
      { type: 'line', label: T('Prix day-ahead', 'Day-ahead price'), data: E.price, borderColor: '#E6EDF3', borderWidth: 1.8, pointRadius: 0, tension: 0, yAxisID: 'p', order: 0 },
      { type: 'line', label: T('État de charge', 'State of charge'), data: x.soc.map(v => +(v * 100).toFixed(0)), borderColor: '#A87DC4', borderWidth: 1.4, borderDash: [4, 3], pointRadius: 0, tension: 0, yAxisID: 'soc', order: 1 },
      { label: T('Vend (décharge)', 'Sells (discharge)'), data: x.discharge, backgroundColor: 'rgba(251,191,36,.85)', borderWidth: 0, yAxisID: 'mw', order: 2, barPercentage: 1, categoryPercentage: 1 },
      { label: T('Achète (charge)', 'Buys (charge)'), data: x.charge.map(v => -v), backgroundColor: 'rgba(127,200,248,.75)', borderWidth: 0, yAxisID: 'mw', order: 3, barPercentage: 1, categoryPercentage: 1 },
    ] }, options: _fuelOpts({ scales: {
      x: Object.assign(_fuelXAxis(), { stacked: true, ticks: { color: C_TX3, font: { size: 10 }, maxRotation: 0, autoSkip: false, callback: (v, i) => i % 12 === 0 ? lab[i].slice(0, 2) + ' h' : '' } }),
      mw: _fuelAxis('MW', { position: 'left', min: -1.1, max: 1.1, stacked: true, ticks: { color: C_TX3, font: { size: 10 }, callback: v => Math.abs(v) <= 1 && v * 10 % 5 === 0 ? v : '' } }),
      p: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }),
      soc: { display: false, min: 0, max: 100 },
    } }) }, 'bess-day-' + k);
  }

  async function render() {
    if (!$('bess-da-kpis')) return;
    const doc = await load();
    if (!doc || !doc.months) { $('bess-da-kpis').innerHTML = '<div class="fuel-note">No battery data yet: the daily job writes data/history/bess_da.json.</div>'; return; }
    kpis(doc); charts(doc); years(doc); day(doc);
    loadRes().then(reserves);
    loadIdx().then(index);
    loadEu().then(europe);
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
    load, ann, loadRes, fcrLtm, lastRate, loadIdx,
    setH(h, btn) {
      S.h = h;
      if (btn) btn.parentNode.querySelectorAll('.pk-gf-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (S.doc) { kpis(S.doc); charts(S.doc); years(S.doc); day(S.doc); }
    },
  };
  if (window.PK && PK.onPage) PK.onPage('bess', () => { wire(); render(); });
})();
