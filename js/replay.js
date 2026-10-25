// ════════════════════════════════════════════════════════════════════
// replay.js · Power system › Replay
// ────────────────────────────────────────────────────────────────────
// A period of the French power market played back with a clock running.
//   Day         quarter-hour by quarter-hour: imbalance price (excess, deficit)
//               against the day-ahead (data/history/fr_imbalance_price), or
//               solar, wind, nuclear and consumption (RTE éCO2mix)
//   Week        the same over 7 days (quarter-hours when imbalance prices
//               exist, else hourly from data/history/fr_hourly)
//   Month       hourly: day-ahead price or production (fr_hourly)
//   Long period day by day, any product of the Comparator catalogue
//               (forwards, gas, carbon, spot by country, capture, GO, PPA…);
//               different units → base 100
// Drawn on one canvas at the screen's own resolution; "Export video" records
// it in 1080p, 60 frames a second (MP4 where the browser can, else WebM), in
// 16:9, 1:1 or 9:16, with automatic commentary on the notable moments.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const T = (fr, en) => (typeof _mT === 'function' ? _mT(fr, en) : en);
  const cache = {};
  const json = (k, path) => cache[k] || (cache[k] = fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => { delete cache[k]; return null; }));
  const RATIO = { '16:9': 16 / 9, '1:1': 1, '9:16': 9 / 16 };
  const EXPORT = { '16:9': [1920, 1080], '1:1': [1440, 1440], '9:16': [1080, 1920] };   // video sizes
  const DURATION = { slow: 40, normal: 20, fast: 9 };   // seconds for the whole period
  const S = { per: 'day', day: null, mode: 'prices', prods: null, lfrom: '', lto: '', fmt: '16:9', speed: 'normal', t: 0, from: 0, to: 95, playing: false, data: null, rec: null, events: [] };
  const fmtN = (v, d) => v == null || !isFinite(v) ? '–' : (v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', T(',', '.'));
  const hh = q => String(Math.floor(q / 4)).padStart(2, '0') + ':' + String(q % 4 * 15).padStart(2, '0');
  const q96 = a => !Array.isArray(a) ? null : a.length >= 96 ? a.slice(0, 96) : a.length === 24 ? a.flatMap(x => [x, x, x, x]) : null;
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const loc = () => T('fr-FR', 'en-GB');
  const dfmt = (iso, o) => new Date(iso + 'T12:00:00Z').toLocaleDateString(loc(), Object.assign({ timeZone: 'UTC' }, o));

  // ── data ──
  async function loadDay(day) {
    const [imb, daily] = await Promise.all([json('imb' + day.slice(0, 7), `history/fr_imbalance_price/${day.slice(0, 7)}.json`), json('d' + day, `history/daily/${day}.json`)]);
    const da = q96(daily && daily.zones && daily.zones.FR && daily.zones.FR.hourly);
    const ib = imb && imb.days && imb.days[day];
    const R = window.pkRte ? await window.pkRte.day(day).catch(() => null) : null;
    const g = k => R && q96(R[k]) ? q96(R[k]).map(x => x == null ? null : x / 1000) : null;
    return {
      prices: [ib && { key: 'short', name: T('Écarts, déficit', 'Imbalance, deficit'), w: 3.2, v: ib.short },
        ib && !ib.long.every((x, i) => x === ib.short[i]) && { key: 'long', name: T('Écarts, excédent', 'Imbalance, excess'), w: 2.2, v: ib.long },
        da && { key: 'da', name: 'Day-ahead', w: 2.2, dash: [8, 6], v: da }].filter(Boolean),
      production: [g('load') && { key: 'load', name: T('Consommation', 'Consumption'), w: 2.6, v: g('load') },
        g('nuclear') && { key: 'nuc', name: T('Nucléaire', 'Nuclear'), w: 2.4, v: g('nuclear') },
        g('wind') && { key: 'wind', name: T('Éolien', 'Wind'), w: 2.4, v: g('wind') },
        g('solar') && { key: 'solar', name: T('Solaire', 'Solar'), w: 2.4, v: g('solar') }].filter(Boolean),
      times: Array.from({ length: 96 }, (_, q) => [day, q * 15]), step: 15,
    };
  }
  // several days: quarter-hours when every day has imbalance prices (a week), else hourly from fr_hourly
  async function loadDays(d0, n) {
    const days = Array.from({ length: n }, (_, i) => addDays(d0, i));
    const months = [...new Set(days.map(d => d.slice(0, 7)))], years = [...new Set(days.map(d => d.slice(0, 4)))];
    const [imbs, hrs] = await Promise.all([Promise.all(months.map(m => json('imb' + m, `history/fr_imbalance_price/${m}.json`))), Promise.all(years.map(y => json('frh' + y, `history/fr_hourly/${y}.json`)))]);
    const IB = Object.assign({}, ...imbs.filter(Boolean).map(f => f.days || {})), H = Object.assign({}, ...hrs.filter(Boolean).map(f => f.days || {}));
    const quarter = n <= 7 && days.every(d => IB[d]);
    if (quarter) {
      const dl = await Promise.all(days.map(loadDay));
      const cat = key => [].concat(...dl.map(x => ((x.prices.find(s => s.key === key) || {}).v) || Array(96).fill(null)));
      const catP = key => [].concat(...dl.map(x => ((x.production.find(s => s.key === key) || {}).v) || Array(96).fill(null)));
      return { prices: [{ key: 'short', name: T('Écarts, déficit', 'Imbalance, deficit'), w: 2.6, v: cat('short') }, { key: 'da', name: 'Day-ahead', w: 2, dash: [8, 6], v: cat('da') }],
        production: [['load', T('Consommation', 'Consumption')], ['nuc', T('Nucléaire', 'Nuclear')], ['wind', T('Éolien', 'Wind')], ['solar', T('Solaire', 'Solar')]].map(([k, nm]) => ({ key: k, name: nm, w: 2.2, v: catP(k) })),
        times: days.flatMap(d => Array.from({ length: 96 }, (_, q) => [d, q * 15])), step: 15 };
    }
    const h = k => [].concat(...days.map(d => { const a = (H[d] || {})[k] || []; return Array.from({ length: 24 }, (_, i) => a[i] == null ? null : k === 'p' ? a[i] : a[i] / 1000); }));
    return { prices: [{ key: 'da', name: 'Day-ahead', w: 2.6, v: h('p') }],
      production: [['load', 'l', T('Consommation', 'Consumption')], ['nuc', 'n', T('Nucléaire', 'Nuclear')], ['wind', 'w', T('Éolien', 'Wind')], ['solar', 's', T('Solaire', 'Solar')]].map(([k, f, nm]) => ({ key: k, name: nm, w: 2.2, v: h(f) })),
      times: days.flatMap(d => Array.from({ length: 24 }, (_, i) => [d, i * 60])), step: 60 };
  }
  // long period: daily series of the Comparator catalogue; several units → base 100 on the first common day
  async function loadLong(ids, from, to) {
    if (!window.PKCompare) return { long: [], times: [], step: 1440 };
    const maps = await Promise.all(ids.map(id => PKCompare.load(id)));
    const days = [...new Set(maps.flatMap(m => [...m.keys()]))].filter(d => d >= from && d <= to).sort();
    const units = [...new Set(ids.map(id => PKCompare.unit(id)))], b100 = units.length > 1;
    const ser = ids.map((id, i) => {
      let v = days.map(d => maps[i].has(d) ? maps[i].get(d) : null);
      for (let j = 1; j < v.length; j++) if (v[j] == null) v[j] = v[j - 1];   // weekends and holidays: last quote carried
      if (b100) { const f = v.find(x => x != null); v = v.map(x => x == null || !f ? null : x / f * 100); }
      return { key: 'p' + i, id, name: PKCompare.label(id), w: i === 0 ? 3 : 2.2, v };
    });
    return { long: ser, times: days.map(d => [d, 0]), step: 1440, unit: b100 ? T('base 100', 'base 100') : units[0], b100 };
  }
  const series = () => S.data ? (S.per === 'long' ? S.data.long : S.data[S.mode]) || [] : [];
  const unit = () => S.per === 'long' ? (S.data && S.data.unit) || '' : S.mode === 'prices' ? '€/MWh' : 'GW';
  const npts = () => S.data && S.data.times ? S.data.times.length : 96;

  // labels: the big clock, the date line, the axis ticks
  function lab(i) {
    const tt = S.data && S.data.times && S.data.times[Math.max(0, Math.min(i, npts() - 1))]; if (!tt) return { clock: '--:--', date: '', tick: '' };
    const [d, m] = tt, time = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    if (S.data.step === 1440) return { clock: dfmt(d, { day: 'numeric', month: 'short' }), date: dfmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), tick: dfmt(d, { month: 'short', year: '2-digit' }) };
    if (S.per === 'day') return { clock: time, date: dfmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), tick: time };
    return { clock: time, date: dfmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), tick: dfmt(d, { weekday: 'short', day: 'numeric' }) };
  }

  // ── commentary over several days (the day keeps its own, below) ──
  function eventsLong() {
    const ser = series(), head = ser[0]; if (!head) return [];
    const v = head.v, E = [], u = S.data.b100 ? '(base 100)' : unit(), d = 1 + (Math.abs(Math.max(...v.filter(x => x != null))) < 20 ? 1 : 0);
    const push = (q, txt, key) => { if (q != null && !E.some(e => Math.abs(e.q - q) < npts() / 12)) E.push({ q, txt, key: key || head.key }); };
    const arg = (a, fn) => { let b = null; a.forEach((x, q) => { if (x != null && (b == null || fn(x, a[b]))) b = q; }); return b; };
    const when = q => S.data.step === 1440 ? dfmt(S.data.times[q][0], { day: 'numeric', month: 'long', year: 'numeric' }) : dfmt(S.data.times[q][0], { weekday: 'long', day: 'numeric', month: 'long' }) + T(' à ', ' at ') + lab(q).clock;
    const hi = arg(v, (a, b) => a > b), lo = arg(v, (a, b) => a < b);
    if (hi != null) push(hi, T(`Plus haut de la période pour ${head.name} : ${fmtN(v[hi], d)} ${u}, le ${when(hi)}.`, `Period high for ${head.name}: ${fmtN(v[hi], d)} ${u}, on ${when(hi)}.`));
    if (lo != null) push(lo, T(`Plus bas : ${fmtN(v[lo], d)} ${u}, le ${when(lo)}.`, `Low: ${fmtN(v[lo], d)} ${u}, on ${when(lo)}.`));
    let j = null; for (let q = 1; q < v.length; q++) if (v[q] != null && v[q - 1] != null && (j == null || Math.abs(v[q] - v[q - 1]) > Math.abs(v[j] - v[j - 1]))) j = q;
    if (j != null) push(j, T(`Le plus gros mouvement d’un ${S.data.step === 1440 ? 'jour' : S.data.step === 60 ? 'heure' : 'quart d’heure'} à l’autre : ${fmtN(v[j] - v[j - 1], d)} ${u} (${when(j)}).`,
      `The biggest move from one ${S.data.step === 1440 ? 'day' : S.data.step === 60 ? 'hour' : 'quarter-hour'} to the next: ${fmtN(v[j] - v[j - 1], d)} ${u} (${when(j)}).`));
    if (S.per !== 'long' && S.mode === 'prices') {
      const neg = v.map(x => x != null && x <= 0), f = neg.indexOf(true), nh = neg.filter(Boolean).length * S.data.step / 60;
      if (f >= 0) push(f, T(`Premier prix à 0 € ou moins le ${when(f)}. Au total, ${fmtN(nh, 0)} heures à 0 € ou moins sur la période.`, `First price at 0 € or below on ${when(f)}. In all, ${fmtN(nh, 0)} hours at 0 € or below over the period.`));
    }
    if (S.per === 'long' && ser.length > 1) {   // where the first two series part ways the most (base 100 or same unit)
      const b = ser[1].v; let g = null; v.forEach((x, q) => { if (x != null && b[q] != null && (g == null || Math.abs(x - b[q]) > Math.abs(v[g] - b[g]))) g = q; });
      if (g != null) push(g, T(`${head.name} et ${ser[1].name} s’écartent le plus : ${fmtN(v[g], d)} contre ${fmtN(b[g], d)} ${u} (${when(g)}).`, `${head.name} and ${ser[1].name} part ways the most: ${fmtN(v[g], d)} against ${fmtN(b[g], d)} ${u} (${when(g)}).`), ser[1].key);
    }
    const f0 = v.find(x => x != null), l0 = [...v].reverse().find(x => x != null), li = v.length - 1;
    if (f0 != null && l0 != null && S.per === 'long') push(li, T(`Sur la période, ${head.name} passe de ${fmtN(f0, d)} à ${fmtN(l0, d)} ${u}` + (f0 ? ` (${fmtN((l0 / f0 - 1) * 100, 0)} %).` : '.'), `Over the period, ${head.name} goes from ${fmtN(f0, d)} to ${fmtN(l0, d)} ${u}` + (f0 ? ` (${fmtN((l0 / f0 - 1) * 100, 0)} %).` : '.')));
    return E.sort((a, b) => a.q - b.q).slice(0, 5).map((e, i) => Object.assign(e, { n: i + 1 }));
  }

  // historic periods: a button each, loaded with their products and the period
  const HPER = [
    { per: 'long', ids: ['spot:FR', 'c:ttf'], from: '2021-01-01', to: '2023-12-31', tag: ['Crise 2021–2023 : spot et gaz', '2021–2023 crisis: spot and gas'] },
    { per: 'long', ids: ['cal:FR:' + (new Date().getUTCFullYear() + 1), 'c:ttf', 'c:eua'], from: '2026-01-01', to: '', tag: ['2026 : le Cal suit le gaz', '2026: the Cal follows gas'] },
    { per: 'month', day: '2022-08-01', mode: 'prices', tag: ['Août 2022, le mois le plus cher', 'August 2022, the dearest month'] },
    { per: 'month', day: '2024-04-01', mode: 'prices', tag: ['Avril 2024, prix négatifs', 'April 2024, negative prices'] },
    { per: 'week', day: '2026-04-27', mode: 'prices', tag: ['Semaine du 1er mai 2026', 'Week of 1 May 2026'] },
    { per: 'week', day: '2018-02-24', mode: 'production', tag: ['Froid de février 2018', 'February 2018 cold'] },
  ];

  // ── historical days (records since 2016, from data/history/fr_hourly): a button each and their story as the first caption,
  //    placed at the series' high (pick 'max') or low ('min') of the day ──
  const HIST = [
    { d: '2022-04-04', mode: 'prices', key: 'da', pick: 'max', tag: ['2 988 €', '2,988 €'], fr: 'Record absolu : 2 988 €/MWh, presque le plafond de 3 000 €. Vague de froid tardive et nucléaire très bas : la France importe au prix fort.', en: 'All-time high: 2,988 €/MWh, close to the 3,000 € cap. A late cold snap and very low nuclear: France imports at any price.' },
    { d: '2022-08-30', mode: 'prices', key: 'da', pick: 'max', tag: ['744 € de moyenne', '744 € average'], fr: 'La journée la plus chère jamais vue : 744 €/MWh en moyenne. Crise du gaz et réacteurs arrêtés pour corrosion.', en: 'The most expensive day ever: 744 €/MWh on average. Gas crisis and reactors stopped for corrosion.' },
    { d: '2022-09-03', mode: 'production', key: 'nuc', pick: 'min', tag: ['nucléaire 19 GW', 'nuclear 19 GW'], fr: 'Nucléaire au plus bas : environ 19 GW, moins de la moitié d’un jour normal. La France vit à l’import.', en: 'Nuclear at its lowest: about 19 GW, less than half a normal day. France lives on imports.' },
    { d: '2016-11-07', mode: 'prices', key: 'da', pick: 'max', tag: ['874 € à 18 h', '874 € at 18:00'], fr: 'Pointe du soir à 874 €/MWh : des réacteurs à l’arrêt pour contrôles de sûreté à l’entrée de l’hiver.', en: 'Evening peak at 874 €/MWh: reactors offline for safety checks as winter starts.' },
    { d: '2018-02-28', mode: 'production', key: 'load', pick: 'max', tag: ['conso 96 GW', 'load 96 GW'], fr: 'Record de consommation : 96 GW pendant la vague de froid « Moscou-Paris ».', en: 'Consumption record: 96 GW during the “Moscow-Paris” cold wave.' },
    { d: '2026-05-01', mode: 'prices', key: 'da', pick: 'min', tag: ['−497 €', '−497 €'], fr: 'Le prix le plus bas jamais vu : −497 €/MWh. Jour férié, plein soleil, consommation faible : produire coûte.', en: 'The lowest price ever: −497 €/MWh. Bank holiday, full sun, low demand: producing costs money.' },
    { d: '2024-04-09', mode: 'prices', key: 'da', pick: 'min', tag: ['19 h négatives', '19 negative hours'], fr: '19 heures sur 24 à 0 € ou moins : le record. Vent et soleil dépassent la demande presque toute la journée.', en: '19 hours out of 24 at 0 € or below: the record. Wind and sun exceed demand almost all day.' },
    { d: '2026-08-07', mode: 'production', key: 'solar', pick: 'max', tag: ['solaire 25 GW', 'solar 25 GW'], fr: 'Record solaire : 25 GW, le parc français n’a jamais autant produit.', en: 'Solar record: 25 GW, the French fleet’s highest output ever.' },
    { d: '2025-12-13', mode: 'production', key: 'wind', pick: 'min', tag: ['zéro vent', 'no wind'], fr: 'Zéro vent : l’éolien tombe à 0 GW sur tout le pays, en plein hiver.', en: 'No wind: wind output falls to 0 GW across the country, in midwinter.' },
    { d: '2026-08-06', mode: 'prices', key: 'short', pick: 'max', tag: ['écarts 1 474 €', 'imbalance 1,474 €'], fr: 'Le plus gros pic du prix des écarts collecté : 1 474 €/MWh.', en: 'The biggest imbalance price spike collected: 1,474 €/MWh.' },
  ];

  // ── commentary: the day's notable moments, found in the data, written as a market note would ──
  function events(D, mode) {
    const E = [], by = k => (D[mode].find(s => s.key === k) || {}).v, at = (a, q) => a ? a[q] : null;
    const arg = (a, fn) => { let b = null; (a || []).forEach((v, q) => { if (v != null && (b == null || fn(v, a[b]))) b = q; }); return b; };
    const push = (q, txt, key) => { if (q != null && !E.some(e => Math.abs(e.q - q) < 8)) E.push({ q, txt, key }); };
    if (mode === 'prices') {
      const sh = by('short'), da = by('da');
      const hi = arg(sh, (a, b) => a > b), lo = arg(sh, (a, b) => a < b);
      if (hi != null && sh[hi] > 250) { const r = at(da, hi) > 0 ? sh[hi] / da[hi] : null;
        push(hi, T(`Le prix des écarts s’envole à ${fmtN(sh[hi], 0)} €/MWh` + (r && r > 1.5 ? `, ${fmtN(r, 1)} fois le day-ahead` : '') + ' : le système manque d’énergie, RTE appelle des réserves chères et ceux qui sont courts paient le prix fort.',
          `The imbalance price jumps to ${fmtN(sh[hi], 0)} €/MWh` + (r && r > 1.5 ? `, ${fmtN(r, 1)} times the day-ahead` : '') + ': the system is short, RTE calls expensive reserves and whoever is short pays the full price.'), 'short'); }
      if (lo != null && sh[lo] < -30) push(lo, T(`Le prix des écarts plonge à ${fmtN(sh[lo], 0)} €/MWh : trop d’énergie sur le réseau, être court rapporte, être long coûte.`, `The imbalance price dives to ${fmtN(sh[lo], 0)} €/MWh: too much energy on the grid, being short pays, being long costs.`), 'short');
      const neg = (da || []).findIndex(v => v != null && v <= 0);
      if (neg >= 0) push(neg, T(`Le day-ahead passe à 0 € ou moins : le soleil et le vent dépassent ce que la France consomme et exporte.`, `The day-ahead goes to 0 € or below: sun and wind exceed what France consumes and exports.`), 'da');
      const pk = arg(da, (a, b) => a > b);
      if (pk != null) push(pk, pk >= 64 && pk <= 88 ? T(`Pointe du soir : le day-ahead atteint ${fmtN(da[pk], 0)} €/MWh quand le soleil se couche et que la demande monte.`, `Evening peak: the day-ahead reaches ${fmtN(da[pk], 0)} €/MWh as the sun sets and demand rises.`)
        : pk >= 24 && pk <= 44 ? T(`Pointe du matin : ${fmtN(da[pk], 0)} €/MWh au day-ahead, avant que le solaire ne monte.`, `Morning peak: ${fmtN(da[pk], 0)} €/MWh on the day-ahead, before solar ramps up.`)
          : T(`Le day-ahead culmine à ${fmtN(da[pk], 0)} €/MWh.`, `The day-ahead tops at ${fmtN(da[pk], 0)} €/MWh.`), 'da');
      let g = null; (sh || []).forEach((v, q) => { if (v != null && at(da, q) != null && !E.some(e => Math.abs(e.q - q) < 8) && (g == null || Math.abs(v - da[q]) > Math.abs(sh[g] - da[g]))) g = q; });
      if (g != null && Math.abs(sh[g] - da[g]) > 100) push(g, T(`Écart de ${fmtN(sh[g] - da[g], 0)} €/MWh entre le prix des écarts et le day-ahead : une erreur de prévision se paie cher à cette heure-là.`, `A ${fmtN(sh[g] - da[g], 0)} €/MWh gap between imbalance and day-ahead: a forecast error costs a lot at that hour.`), 'short');
    } else {
      const ld = by('load'), so = by('solar'), wi = by('wind'), nu = by('nuc');
      const sp = arg(so, (a, b) => a > b);
      if (sp != null && so[sp] > 1) push(sp, T(`Pic solaire : ${fmtN(so[sp], 1)} GW, ${fmtN(so[sp] / ld[sp] * 100, 0)} % de la consommation.`, `Solar peak: ${fmtN(so[sp], 1)} GW, ${fmtN(so[sp] / ld[sp] * 100, 0)} % of consumption.`), 'solar');
      const lp = arg(ld, (a, b) => a > b);
      if (lp != null) push(lp, T(`Pointe de consommation : ${fmtN(ld[lp], 1)} GW.`, `Consumption peak: ${fmtN(ld[lp], 1)} GW.`), 'load');
      if (wi) { let best = null; for (let q = 12; q < 96; q++) if (wi[q] != null && wi[q - 12] != null && (best == null || Math.abs(wi[q] - wi[q - 12]) > Math.abs(wi[best] - wi[best - 12]))) best = q;
        if (best != null && Math.abs(wi[best] - wi[best - 12]) > 2) push(best, wi[best] > wi[best - 12] ? T(`Le vent se lève : +${fmtN(wi[best] - wi[best - 12], 1)} GW d’éolien en 3 heures.`, `The wind picks up: +${fmtN(wi[best] - wi[best - 12], 1)} GW of wind in 3 hours.`)
          : T(`Le vent retombe : ${fmtN(wi[best] - wi[best - 12], 1)} GW d’éolien en 3 heures.`, `The wind drops: ${fmtN(wi[best] - wi[best - 12], 1)} GW of wind in 3 hours.`), 'wind'); }
      if (nu) { const a = arg(nu, (x, y) => x > y), b = arg(nu, (x, y) => x < y);
        if (a != null && b != null && nu[a] - nu[b] > 2) push(b, T(`Le nucléaire module : ${fmtN(nu[b] - nu[a], 1)} GW par rapport à son plus haut du jour, pour laisser la place aux renouvelables.`, `Nuclear modulates: ${fmtN(nu[b] - nu[a], 1)} GW against its daily high, making room for renewables.`), 'nuc'); }
      if (so && wi && ld) { const sh = ld.map((l, q) => l ? ((so[q] || 0) + (wi[q] || 0)) / l : null), m = arg(sh, (x, y) => x > y);
        if (m != null && sh[m] > 0.3) push(m, T(`Éolien et solaire couvrent ${fmtN(sh[m] * 100, 0)} % de la consommation.`, `Wind and solar cover ${fmtN(sh[m] * 100, 0)} % of consumption.`), 'solar'); }
    }
    return E.sort((a, b) => a.q - b.q).slice(0, 5).map((e, i) => Object.assign(e, { n: i + 1 }));
  }
  function wrap(c, text, maxW) {
    const words = text.split(' '), lines = []; let l = '';
    words.forEach(w => { const tr = l ? l + ' ' + w : w; if (c.measureText(tr).width > maxW && l) { lines.push(l); l = w; } else l = tr; });
    if (l) lines.push(l); return lines;
  }

  // ── colours: the site's own (CSS variables), dark by default, light in light mode; series colours by key ──
  function pal() {
    const cs = getComputedStyle(document.documentElement), v = (n, f) => (cs.getPropertyValue(n) || '').trim() || f;
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    return { light, bg: v('--bg2', '#0f1419'), panel: v('--bg3', '#151c24'), text: v('--text', '#FFFFFF'), text2: v('--text2', '#B8C9D9'), text3: v('--text3', '#7A93AB'),
      grid: v('--border', '#1e2d3d'), axis: v('--border2', '#243447'), accent: v('--accent', '#14D3A9'), down: v('--down', '#ED6965'),
      series: light ? { short: '#D2453F', long: '#EC8B86', da: '#5F738A', load: '#13202E', nuc: '#7C4DDB', wind: '#0E8FA3', solar: '#D98A06', p0: '#0E9E7E', p1: '#D98A06', p2: '#7C4DDB', p3: '#0E8FA3' }
        : { short: '#ED6965', long: '#F2A3A0', da: '#B8C9D9', load: '#FFFFFF', nuc: '#B794F6', wind: '#7FC8F8', solar: '#FBBF24', p0: '#14D3A9', p1: '#FBBF24', p2: '#B794F6', p3: '#7FC8F8' } };
  }
  new MutationObserver(() => { if (S.data) draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // canvas size: the screen's own pixels (sharp at any size), or the video size while recording
  function size() {
    const cv = document.getElementById('rp-canvas'), st = document.getElementById('rp-stage'); if (!cv || !st) return;
    let W, H;
    if (S.rec) [W, H] = EXPORT[S.fmt];
    else {
      const dpr = Math.min(2, window.devicePixelRatio || 1), r = RATIO[S.fmt], fs = document.fullscreenElement === st;
      const maxW = st.clientWidth || 1280, maxH = Math.max(300, window.innerHeight - (fs ? 0 : 270));
      const w = Math.floor(Math.min(maxW, maxH * r));
      W = Math.round(w * dpr); H = Math.round(w / r * dpr);
      cv.style.width = w + 'px'; cv.style.height = Math.round(w / r) + 'px';   // shown at its CSS size, drawn at the screen's pixels
    }
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  }

  // ── drawing ──
  function nice(lo, hi) {
    const span = hi - lo || 1, step0 = span / 5, p = Math.pow(10, Math.floor(Math.log10(step0))), step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= step0);
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  }
  function draw() {
    const cv = document.getElementById('rp-canvas'); if (!cv || !S.data) return;
    size();
    const W = cv.width, H = cv.height;
    const c = cv.getContext('2d'), wide = W / H > 1.4, k = wide ? W / 1280 : W / 1080 * 1.3, P = 48 * k;   // square and vertical: bigger text, read on a phone
    const C = pal(), raw = series(), N = npts(), daOnly = S.per !== 'long' && S.mode === 'prices' && raw.length === 1;
    const ser = raw.map(x => Object.assign({}, x, { color: daOnly ? C.accent : C.series[x.key] || C.accent }, daOnly ? { dash: null, w: 3 } : {}));
    const from = S.per === 'day' ? S.from : 0, to = S.per === 'day' ? S.to : N - 1;
    const t = Math.max(from, Math.min(to, S.t)), qi = Math.floor(t), L = lab(qi);
    const dp = S.per === 'long' ? (S.data.b100 ? 0 : 1) : S.mode === 'prices' ? 0 : 1;
    c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
    const F = (w, px, fam) => `${w} ${Math.round(px * k)}px ${fam || 'Inter, system-ui, sans-serif'}`, MONO = "'JetBrains Mono', ui-monospace, monospace";
    c.textBaseline = 'top';
    c.fillStyle = C.text; c.font = F(700, 22); c.fillText('Power', P, P);
    const bw = c.measureText('Power').width; c.fillStyle = C.accent; c.fillText('.Klock', P + bw, P);
    c.fillStyle = C.text3; c.font = F(500, 18); c.fillText(T('France · ', 'France · ') + L.date, P, P + 36 * k);
    c.fillStyle = C.text; c.font = F(700, S.data.step === 1440 ? 66 : 84, MONO); c.fillText(L.clock, P, P + (S.data.step === 1440 ? 74 : 66) * k);
    const head = ser[0], hv = head && head.v[qi];
    const x0 = P + c.measureText(L.clock).width + 36 * k;
    if (head) {
      c.fillStyle = C.text3; c.font = F(500, 17); c.fillText(head.name, x0, P + 74 * k);
      c.fillStyle = head.color; c.font = F(700, 42, MONO); c.fillText(fmtN(hv, dp) + ' ' + unit(), x0, P + 98 * k);
      const ref = S.per !== 'long' && S.mode === 'prices' && !daOnly ? ser.find(s => s.key === 'da') : null;
      if (ref && hv != null && ref.v[qi]) {
        const r = hv / ref.v[qi], hot = Math.abs(r) >= 1.5, txt = hot ? fmtN(r, 1) + T(' × le day-ahead', ' × the day-ahead') : T('day-ahead ', 'day-ahead ') + fmtN(ref.v[qi], 0);
        c.font = F(600, 17); const tw = c.measureText(txt).width + 24 * k, ty = P + 150 * k;
        c.fillStyle = hot ? (C.light ? 'rgba(210,69,63,.12)' : 'rgba(237,105,101,.18)') : C.panel; roundRect(c, x0, ty, tw, 30 * k, 15 * k); c.fill();
        c.fillStyle = hot ? C.down : C.text2; c.textBaseline = 'middle'; c.fillText(txt, x0 + 12 * k, ty + 15 * k); c.textBaseline = 'top';
      }
      // the period's high (and low when it goes negative) so far
      let mx = -Infinity, mq = null, mn = Infinity, nq = null;
      for (let q = from; q <= qi; q++) { const v = head.v[q]; if (v == null) continue; if (v > mx) { mx = v; mq = q; } if (v < mn) { mn = v; nq = q; } }
      const at = q => S.per === 'day' ? lab(q).clock : S.data.step === 1440 ? dfmt(S.data.times[q][0], { day: 'numeric', month: 'short', year: 'numeric' }) : dfmt(S.data.times[q][0], { weekday: 'short', day: 'numeric' }) + ' ' + lab(q).clock;
      if (mq != null) {
        c.fillStyle = C.text3; c.font = F(500, 16); c.textAlign = 'right';
        c.fillText(T('Plus haut jusqu’ici : ', 'High so far: ') + fmtN(mx, dp) + ' ' + unit() + T(' · ', ' · ') + at(mq), W - P, P + 4 * k);
        if (mn < 0) c.fillText(T('Plus bas : ', 'Low: ') + fmtN(mn, dp) + ' ' + unit() + ' · ' + at(nq), W - P, P + 28 * k);
        c.textAlign = 'left';
      }
    }
    // chart and bars
    const top = P + (wide ? 200 : 210) * k, bottom = H - P - 70 * k;
    const chart = wide ? { x: P + 64 * k, y: top, w: (W - 2 * P) * 0.70 - 64 * k, h: bottom - top } : { x: P + 64 * k, y: top, w: W - 2 * P - 64 * k, h: (bottom - top) * 0.72 };
    const bars = wide ? { x: P + (W - 2 * P) * 0.74, y: top, w: (W - 2 * P) * 0.26, h: bottom - top } : { x: P, y: chart.y + chart.h + 60 * k, w: W - 2 * P, h: bottom - (chart.y + chart.h + 60 * k) };
    const vals = ser.flatMap(s => s.v.slice(from, to + 1)).filter(v => v != null);
    if (!vals.length) return;
    const Y = nice(Math.min(S.per === 'long' ? Math.min(...vals) : 0, ...vals), Math.max(...vals));
    const yOf = v => chart.y + chart.h - (v - Y.lo) / (Y.hi - Y.lo) * chart.h, xOf = q => chart.x + (q - from) / Math.max(1, to - from) * chart.w;
    c.font = F(500, 14, MONO); c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let v = Y.lo; v <= Y.hi + 1e-9; v += Y.step) {
      c.strokeStyle = Math.abs(v) < 1e-9 ? C.text3 : C.grid; c.lineWidth = Math.max(1, k * 0.8); c.beginPath(); c.moveTo(chart.x, yOf(v)); c.lineTo(chart.x + chart.w, yOf(v)); c.stroke();
      c.fillStyle = C.text3; c.fillText(fmtN(v, Y.step < 1 ? 1 : 0), chart.x - 10 * k, yOf(v));
    }
    // x ticks: hours on a day, day starts over a week or a month, months over a long period
    c.textAlign = 'center'; c.textBaseline = 'top';
    let ticks = [];
    if (S.per === 'day') for (let q = Math.ceil(from / 16) * 16; q <= to; q += 16) ticks.push(q);
    else if (S.data.step < 1440) { const st = S.data.times.map((x, i) => x[1] === 0 ? i : -1).filter(i => i >= 0); const e = Math.ceil(st.length / 8); ticks = st.filter((_, j) => j % e === 0); }
    else { const n = 6; for (let j = 0; j < n; j++) ticks.push(Math.round(j * (N - 1) / (n - 1))); }
    ticks.forEach(q => c.fillText(lab(q).tick, xOf(q), chart.y + chart.h + 10 * k));
    c.textAlign = 'left';
    ser.slice().reverse().forEach(s => {
      c.strokeStyle = s.color; c.lineWidth = s.w * k * (N > 400 ? 0.8 : 1); c.setLineDash((s.dash || []).map(x => x * k)); c.lineJoin = 'round'; c.beginPath();
      let pen = false;
      for (let q = from; q <= qi; q++) { const v = s.v[q]; if (v == null) { pen = false; continue; } pen ? c.lineTo(xOf(q), yOf(v)) : c.moveTo(xOf(q), yOf(v)); pen = true; }
      const a = s.v[qi], b = s.v[Math.min(qi + 1, N - 1)];
      if (pen && a != null && b != null && t > qi) c.lineTo(xOf(t), yOf(a + (b - a) * (t - qi)));
      c.stroke(); c.setLineDash([]);
    });
    if (head && hv != null) { c.fillStyle = head.color; c.beginPath(); c.arc(xOf(qi), yOf(hv), 6 * k, 0, 2 * Math.PI); c.fill(); }
    c.strokeStyle = C.text2; c.lineWidth = 1.5 * k; c.beginPath(); c.moveTo(xOf(t), chart.y); c.lineTo(xOf(t), chart.y + chart.h); c.stroke();
    // bars: each series now; the axis sits where the period's highs and lows leave room for both
    const n = ser.length, gap = 16 * k, bwid = Math.min(160 * k, (bars.w - gap * (n - 1)) / n);
    const posMax = Math.max(0, ...vals), negMax = Math.max(0, ...vals.map(v => -v)), room = bars.h - 96 * k;
    const scale = room / Math.max(1e-9, posMax + negMax), base = bars.y + 30 * k + posMax * scale, nameY = bars.y + bars.h - 22 * k;
    c.strokeStyle = C.axis; c.lineWidth = 1; c.beginPath(); c.moveTo(bars.x, base); c.lineTo(bars.x + bars.w, base); c.stroke();
    ser.forEach((s, i) => {
      const v = s.v[qi], x = bars.x + (bars.w - n * bwid - (n - 1) * gap) / 2 + i * (bwid + gap), h = v == null ? 0 : Math.abs(v) * scale;
      c.fillStyle = s.color; c.globalAlpha = s.key === 'long' && C.light ? 0.75 : 1;
      if (v != null) c.fillRect(x, v >= 0 ? base - h : base, bwid, h);
      c.globalAlpha = 1; c.fillStyle = C.text; c.font = F(700, 18, MONO); c.textAlign = 'center';
      if (v != null && v < 0) { c.textBaseline = 'top'; c.fillText(fmtN(v, dp), x + bwid / 2, base + h + 6 * k); }
      else { c.textBaseline = 'bottom'; c.fillText(fmtN(v, dp), x + bwid / 2, base - h - 6 * k); }
      let fs = 14; c.font = F(500, fs); while (fs > 9 && c.measureText(s.name).width > bwid + gap * 0.6) { fs--; c.font = F(500, fs); }
      c.textBaseline = 'top'; c.fillStyle = C.text2; c.fillText(s.name, x + bwid / 2, nameY); c.textAlign = 'left';
    });
    // commentary: numbered markers on the moments passed, the caption of the latest one for an eighth of the period
    const span = S.per === 'day' ? 12 : Math.max(4, Math.round(N / 8));
    (S.events || []).forEach(e => {
      if (e.q > t) return;
      const s = ser.find(x => x.key === e.key) || head, v = s && s.v[e.q]; if (v == null) return;
      const x = xOf(e.q), y = yOf(v) + (v < (Y.lo + Y.hi) / 2 && v < 0 ? 22 : -22) * k;
      c.fillStyle = C.text; c.beginPath(); c.arc(x, y, 13 * k, 0, 2 * Math.PI); c.fill();
      c.fillStyle = C.bg; c.font = F(700, 14); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(e.n), x, y); c.textAlign = 'left'; c.textBaseline = 'top';
    });
    const cur = (S.events || []).filter(e => e.q <= t && t < e.q + span).pop();
    if (cur) {
      const a = Math.min(1, (t - cur.q) / (span / 8), (cur.q + span - t) / (span / 8));
      c.globalAlpha = S.playing ? Math.max(0, a) : 1;
      c.font = F(500, 19); const bw2 = Math.min(chart.w * 0.48, 600 * k), lines = wrap(c, cur.txt, bw2 - 64 * k), bh = (lines.length * 26 + 28) * k;
      const bx = xOf(cur.q) > chart.x + chart.w / 2 ? chart.x + 12 * k : chart.x + chart.w - bw2 - 12 * k, by = chart.y + 8 * k;
      c.fillStyle = C.panel; roundRect(c, bx, by, bw2, bh, 12 * k); c.fill();
      c.strokeStyle = C.accent; c.lineWidth = 1.5 * k; c.stroke();
      c.fillStyle = C.accent; c.beginPath(); c.arc(bx + 26 * k, by + 28 * k, 13 * k, 0, 2 * Math.PI); c.fill();
      c.fillStyle = C.bg; c.font = F(700, 14); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(cur.n), bx + 26 * k, by + 28 * k); c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillStyle = C.text; c.font = F(500, 19); lines.forEach((l, i) => c.fillText(l, bx + 50 * k, by + 16 * k + i * 26 * k));
      c.globalAlpha = 1;
    }
    // footer: progress and source
    const fy = H - P - 22 * k;
    c.fillStyle = C.grid; roundRect(c, P, fy, W - 2 * P, 8 * k, 4 * k); c.fill();
    c.fillStyle = C.accent; roundRect(c, P, fy, Math.max(8 * k, (W - 2 * P) * (t - from) / Math.max(1, to - from)), 8 * k, 4 * k); c.fill();
    c.fillStyle = C.text3; c.font = F(500, 13); c.textBaseline = 'top';
    const src = S.per === 'long' ? T('Sources : ENTSO-E, RTE, données de marché' + (S.data.b100 ? ' · base 100 au premier jour' : '') + ' · powerklock', 'Sources: ENTSO-E, RTE, market data' + (S.data.b100 ? ' · base 100 on the first day' : '') + ' · powerklock')
      : S.mode === 'prices' ? (daOnly ? T('ENTSO-E · prix day-ahead France · powerklock', 'ENTSO-E · France day-ahead price · powerklock') : T('ENTSO-E · prix des écarts France et day-ahead, au quart d’heure · powerklock', 'ENTSO-E · France imbalance and day-ahead prices, quarter-hourly · powerklock'))
        : T('RTE éCO2mix · production et consommation · powerklock', 'RTE éCO2mix · output and consumption · powerklock');
    c.fillText(src, P, fy + 16 * k);
    const lb = document.getElementById('rp-time'); if (lb) lb.textContent = L.clock;
    const sc = document.getElementById('rp-scrub'); if (sc) { sc.max = String(N - 1); if (document.activeElement !== sc) sc.value = String(qi); }
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ── playback: the whole period in 9, 20 or 40 seconds ──
  let last = 0, hold = 0;
  const bounds = () => S.per === 'day' ? [S.from, S.to] : [0, npts() - 1];
  function frame(ts) {
    if (!S.playing) return;
    const [a, b] = bounds(), dt = last ? (ts - last) / 1000 : 0; last = ts;
    if (S.t < b) S.t = Math.min(b, S.t + dt * (b - a) / DURATION[S.speed]);
    else if (S.rec) { hold += dt; if (hold > 1.5) { stopRec(); return; } }
    else { S.playing = false; syncBtn(); }
    draw();
    requestAnimationFrame(frame);
  }
  function play() { const [a, b] = bounds(); if (S.t >= b) S.t = a; S.playing = true; last = 0; hold = 0; syncBtn(); requestAnimationFrame(frame); }
  function pause() { S.playing = false; syncBtn(); }
  function syncBtn() { const b = document.getElementById('rp-play'); if (b) { b.textContent = S.playing ? T('Pause', 'Pause') : T('Lecture', 'Play'); b.setAttribute('aria-pressed', String(S.playing)); } }

  // ── video export: 1080p, 60 frames a second ──
  function record() {
    const cv = document.getElementById('rp-canvas'); if (!cv || !cv.captureStream || !window.MediaRecorder) { alert(T('Ce navigateur ne sait pas enregistrer de vidéo.', 'This browser cannot record video.')); return; }
    const type = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(x => MediaRecorder.isTypeSupported(x));
    S.rec = true; size(); S.t = bounds()[0]; draw();
    const rec = new MediaRecorder(cv.captureStream(60), { mimeType: type, videoBitsPerSecond: 16e6 }), parts = [];
    rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(parts, { type }), a = document.createElement('a'), tag = S.per === 'long' ? 'long' : S.mode + '-' + S.per;
      a.href = URL.createObjectURL(blob); a.download = `powerklock-${tag}-${S.per === 'long' ? (S.lfrom || 'start') : S.day}-${S.fmt.replace(':', 'x')}.${/mp4/.test(type) ? 'mp4' : 'webm'}`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const b = document.getElementById('rp-export'); if (b) { b.disabled = false; b.textContent = T('Exporter en vidéo', 'Export video'); }
      draw();
    };
    S.rec = rec; rec.start();
    const b = document.getElementById('rp-export'); if (b) { b.disabled = true; b.textContent = T('Enregistrement…', 'Recording…'); }
    play();
  }
  function stopRec() { S.playing = false; syncBtn(); if (S.rec) { const r = S.rec; S.rec = null; r.stop(); } }

  // ── notable days and periods ──
  async function notable() {
    const host = document.getElementById('rp-days'); if (!host) return;
    const t = new Date(), months = [0, 1, 2].map(k => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
    const [fs, h] = await Promise.all([Promise.all(months.map(m => json('imb' + m, `history/fr_imbalance_price/${m}.json`))), json('frh' + t.getUTCFullYear(), `history/fr_hourly/${t.getUTCFullYear()}.json`)]);
    const imb = Object.assign({}, ...fs.filter(Boolean).map(f => f.days || {}));
    const spikes = Object.entries(imb).map(([d, v]) => [d, Math.max(...v.short.filter(x => x != null))]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const neg = Object.entries((h && h.days) || {}).filter(([d]) => d >= new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10))
      .map(([d, v]) => [d, (v.p || []).filter(x => x != null && x <= 0).length]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const lbl = d => dfmt(d, { day: 'numeric', month: 'short' }), ylbl = d => dfmt(d, { day: 'numeric', month: 'short', year: 'numeric' });
    host.innerHTML = `<div class="rp-dg"><b>${T('Périodes historiques', 'Historic periods')}</b>` + HPER.map((x, i) => `<button type="button" class="cmp-pill" data-hper="${i}">${T(x.tag[0], x.tag[1])}</button>`).join('') + '</div>' +
      `<div class="rp-dg"><b>${T('Jours historiques', 'Historic days')}</b>` + HIST.map(x => `<button type="button" class="cmp-pill" data-day="${x.d}" data-mode="${x.mode}" title="${T(x.fr, x.en).replace(/"/g, '&quot;')}">${ylbl(x.d)} · ${T(x.tag[0], x.tag[1])}</button>`).join('') + '</div>' +
      (spikes.length ? `<div class="rp-dg"><b>${T('Pics du prix des écarts', 'Imbalance price spikes')}</b>` + spikes.map(([d, v]) => `<button type="button" class="cmp-pill" data-day="${d}" data-mode="prices">${lbl(d)} · ${fmtN(v, 0)} €</button>`).join('') + '</div>' : '') +
      (neg.length ? `<div class="rp-dg"><b>${T('Heures à 0 € ou moins', 'Hours at 0 € or below')}</b>` + neg.map(([d, n]) => `<button type="button" class="cmp-pill" data-day="${d}" data-mode="production">${lbl(d)} · ${n} h</button>`).join('') + '</div>' : '');
  }

  // ── loading a period ──
  async function reload() {
    pause();
    const note = document.getElementById('rp-note'); if (note) note.textContent = T('Chargement…', 'Loading…');
    if (S.per === 'day') S.data = await loadDay(S.day);
    else if (S.per === 'week') S.data = await loadDays(S.day, 7);
    else if (S.per === 'month') { const m = S.day.slice(0, 7) + '-01', [y, mm] = m.split('-').map(Number); S.data = await loadDays(m, new Date(Date.UTC(y, mm, 0)).getUTCDate()); }
    else {
      const to = S.lto || new Date().toISOString().slice(0, 10), from = S.lfrom || addDays(to, -365);
      S.data = await loadLong(S.prods, from, to);
    }
    const ser = series(), empty = !ser.length || !ser.some(s => s.v.some(v => v != null));
    if (note) note.textContent = empty ? (S.per === 'long' ? T('Pas de données pour ces produits sur la période.', 'No data for these products in this period.') : S.mode === 'prices' ? T('Pas de prix pour cette période.', 'No prices for this period.') : T('Pas de données RTE pour cette période.', 'No RTE data for this period.')) : '';
    S.events = empty ? [] : S.per === 'day' ? events(S.data, S.mode) : eventsLong();
    if (S.per === 'day' && !empty) {   // a historic day: its story as a starred caption
      const h = HIST.find(x => x.d === S.day && x.mode === S.mode), sv = h && (S.data[S.mode].find(x => x.key === h.key) || {}).v;
      if (h && sv) {
        let q = null; sv.forEach((v, i) => { if (v != null && (q == null || (h.pick === 'min' ? v < sv[q] : v > sv[q]))) q = i; });
        if (q != null) S.events = S.events.filter(e => Math.abs(e.q - q) >= 8).concat([{ q, key: h.key, txt: '★ ' + T(h.fr, h.en) }]).sort((a, b) => a.q - b.q).slice(0, 5).map((e, i) => Object.assign(e, { n: i + 1 }));
      }
    }
    const ev = document.getElementById('rp-events');
    if (ev) ev.innerHTML = S.events.map(e => `<button type="button" class="rp-ev" data-q="${e.q}"><b>${e.n}</b><span class="cmp-dates">${S.per === 'day' ? hh(e.q) : lab(e.q).tick}</span><span>${e.txt}</span></button>`).join('');
    S.t = bounds()[1]; draw();
  }

  // ── controls ──
  function controls() {
    const b = document.getElementById('rp-ctl'); if (!b) return;
    const pill = (g, v, t, on) => `<button type="button" class="cmp-pill${on ? ' on' : ''}" data-${g}="${v}">${t}</button>`;
    let h = '<div class="cmp-grp">' + [['day', T('Jour', 'Day')], ['week', T('Semaine', 'Week')], ['month', T('Mois', 'Month')], ['long', T('Longue période', 'Long period')]].map(([v, t]) => pill('per', v, t, S.per === v)).join('') + '</div>';
    if (S.per !== 'long') {
      h += `<label class="cmp-dates">${S.per === 'week' ? T('Du', 'From') : S.per === 'month' ? T('Mois de', 'Month of') : T('Jour', 'Day')} <input type="date" id="rp-date" value="${S.day || ''}"></label>` +
        '<div class="cmp-grp">' + pill('mode', 'prices', T('Prix', 'Prices'), S.mode === 'prices') + pill('mode', 'production', T('Production', 'Production'), S.mode === 'production') + '</div>';
    } else if (window.PKCompare) {
      h += '<div class="cmp-grp">' + (S.prods || []).map((id, i) => `<span class="cmp-chip" style="padding:4px 8px"><i style="background:${['#14D3A9', '#FBBF24', '#B794F6', '#7FC8F8'][i]}"></i><span>${PKCompare.label(id)}</span><button type="button" data-delp="${id}" aria-label="${T('Retirer', 'Remove')}">×</button></span>`).join('') + '</div>';
      if ((S.prods || []).length < 4) h += `<select id="rp-addp" aria-label="${T('Ajouter un produit', 'Add a product')}"><option value="">${T('+ Ajouter un produit', '+ Add a product')}</option>` + PKCompare.groups().map(([g, n, ids]) => `<optgroup label="${n}">` + ids.filter(id => !(S.prods || []).includes(id)).map(id => `<option value="${id}">${PKCompare.label(id)}</option>`).join('') + '</optgroup>').join('') + '</select>';
      h += `<label class="cmp-dates">${T('Du', 'From')} <input type="date" id="rp-lfrom" value="${S.lfrom}"> ${T('au', 'to')} <input type="date" id="rp-lto" value="${S.lto}"></label>`;
    }
    h += '<div class="cmp-grp">' + Object.keys(RATIO).map(f => pill('fmt', f, f, S.fmt === f)).join('') + '</div>' +
      '<div class="cmp-grp">' + [['slow', T('Lent', 'Slow')], ['normal', T('Normal', 'Normal')], ['fast', T('Rapide', 'Fast')]].map(([v, t]) => pill('speed', v, t, S.speed === v)).join('') + '</div>';
    if (S.per === 'day') h += `<label class="cmp-dates">${T('De', 'From')} <select id="rp-from">${Array.from({ length: 24 }, (_, x) => `<option value="${x * 4}"${S.from === x * 4 ? ' selected' : ''}>${String(x).padStart(2, '0')}:00</option>`).join('')}</select> ${T('à', 'to')} <select id="rp-to">${Array.from({ length: 24 }, (_, x) => `<option value="${x * 4 + 3}"${S.to === x * 4 + 3 ? ' selected' : ''}>${String(x + 1).padStart(2, '0')}:00</option>`).join('')}</select></label>`;
    b.innerHTML = h;
  }
  function bind() {
    const root = document.getElementById('rp-root'); if (!root || root.dataset.bound) return; root.dataset.bound = '1';
    const top = () => { const st = document.getElementById('rp-ctl'); if (st) st.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    root.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.id === 'rp-play') { S.playing ? pause() : play(); return; }
      if (t.id === 'rp-export') { record(); return; }
      if (t.id === 'rp-full') { const st = document.getElementById('rp-stage'); if (document.fullscreenElement) document.exitFullscreen(); else if (st && st.requestFullscreen) st.requestFullscreen(); return; }
      if (t.dataset.hper) { const x = HPER[+t.dataset.hper]; S.per = x.per; if (x.per === 'long') { S.prods = x.ids.slice(); S.lfrom = x.from; S.lto = x.to; } else { S.day = x.day; S.mode = x.mode; } controls(); reload(); top(); return; }
      if (t.dataset.day) { S.per = 'day'; S.day = t.dataset.day; S.mode = t.dataset.mode || S.mode; S.from = 0; S.to = 95; controls(); reload(); top(); return; }
      if (t.dataset.per) { S.per = t.dataset.per; controls(); reload(); return; }
      if (t.dataset.mode) { S.mode = t.dataset.mode; controls(); reload(); return; }
      if (t.dataset.delp) { S.prods = S.prods.filter(x => x !== t.dataset.delp); controls(); reload(); return; }
      if (t.dataset.fmt) { S.fmt = t.dataset.fmt; controls(); draw(); return; }
      if (t.dataset.speed) { S.speed = t.dataset.speed; controls(); return; }
      if (t.dataset.q) { pause(); const [a, b] = bounds(); S.t = Math.max(a, Math.min(b, +t.dataset.q + (S.per === 'day' ? 2 : Math.max(1, npts() / 40)))); draw(); }
    });
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'rp-date' && t.value) { S.day = t.value; reload(); }
      if (t.id === 'rp-addp' && t.value) { S.prods = (S.prods || []).concat([t.value]).slice(0, 4); controls(); reload(); }
      if (t.id === 'rp-lfrom' || t.id === 'rp-lto') { S.lfrom = document.getElementById('rp-lfrom').value; S.lto = document.getElementById('rp-lto').value; reload(); }
      if (t.id === 'rp-from' || t.id === 'rp-to') { S.from = +document.getElementById('rp-from').value; S.to = Math.max(S.from + 3, +document.getElementById('rp-to').value); S.t = S.to; draw(); }
    });
    root.addEventListener('input', e => { if (e.target.id === 'rp-scrub') { pause(); const [a, b] = bounds(); S.t = Math.max(a, Math.min(b, +e.target.value)); draw(); } });
    const st = document.getElementById('rp-stage');
    if (st && window.ResizeObserver) new ResizeObserver(() => { if (!S.rec && S.data) draw(); }).observe(st);
    document.addEventListener('fullscreenchange', () => setTimeout(draw, 50));
  }
  async function init() {
    bind();
    if (!S.prods) S.prods = ['cal:FR:' + (new Date().getUTCFullYear() + 1), 'c:ttf', 'c:eua'];
    if (!S.day) {   // default: the latest day with imbalance prices, else yesterday
      const m = new Date().toISOString().slice(0, 7), f = await json('imb' + m, `history/fr_imbalance_price/${m}.json`);
      const ks = f && f.days ? Object.keys(f.days).sort() : [];
      S.day = ks.length ? ks[ks.length - 1] : addDays(new Date().toISOString().slice(0, 10), -1);
    }
    controls(); notable(); reload();
  }
  window.PKReplay = { init, state: S, draw };
  if (window.PK && PK.onPage) PK.onPage('replay', init);

  const css = document.createElement('style');
  css.textContent = `
  .rp-wrap{display:flex;flex-direction:column;gap:14px}
  .rp-ctl{display:flex;flex-wrap:wrap;gap:10px;align-items:center;scroll-margin-top:150px}
  .rp-ctl select{background:var(--bg);border:1px solid var(--border);color:var(--text);font-size:11.5px;padding:4px 6px;border-radius:6px;max-width:240px}
  .rp-stage{display:flex;justify-content:center;background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:hidden}
  .rp-stage canvas{display:block;max-width:100%;height:auto}
  .rp-stage:fullscreen{background:#000;align-items:center;border:0;border-radius:0}
  .rp-bar{display:flex;align-items:center;gap:12px}
  .rp-bar input[type=range]{flex:1;accent-color:#14D3A9}
  .rp-days{display:flex;flex-direction:column;gap:8px}
  .rp-events{display:flex;flex-direction:column;gap:6px}
  .rp-ev{display:grid;grid-template-columns:26px 90px minmax(0,1fr);gap:10px;align-items:start;text-align:left;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text2);font:13px Inter,sans-serif;cursor:pointer}
  .rp-ev:hover{border-color:var(--accent)} .rp-ev b{display:inline-flex;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#0B1118;align-items:center;justify-content:center;font-size:12px}
  .rp-dg{display:flex;flex-wrap:wrap;gap:6px;align-items:center} .rp-dg b{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-right:4px}
  `;
  document.head.appendChild(css);
})();
