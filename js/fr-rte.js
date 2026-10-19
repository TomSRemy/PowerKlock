// ════════════════════════════════════════════════════════════════════
// France generation from RTE éCO2mix instead of ENTSO-E.
//
// RTE publishes the whole French day every 15 minutes, about an hour
// behind real time, with history since 2012; ENTSO-E's per-type data for
// France arrives late and with gaps. Every daily history file goes
// through the fetch wrapper in gen-align.js, which calls pkFrOverlay():
// the FR zone's generation arrays are replaced by RTE's (Paris slots),
// ENTSO-E's are kept under z.entsoe for comparison.
//
// Sources: data/history/rte/YYYY-MM.json (scripts/fetch_rte_eco2mix.py,
// consolidated then real-time data) and, for today and the two previous
// days, the live éCO2mix real-time dataset on ODRÉ (CORS, no key).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const LIVE_DAYS = 2;
  const ODRE = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/exports/json';
  const COLS = { nuclear: 'nucleaire', wind: 'eolien', windOnshore: 'eolien_terrestre', windOffshore: 'eolien_offshore', solar: 'solaire',
    hydro: 'hydraulique', hydroRoR: 'hydraulique_fil_eau_eclusee', hydroLake: 'hydraulique_lacs', hydroPS: 'hydraulique_step_turbinage',
    pumping: 'pompage', gas: 'gaz', coal: 'charbon', oil: 'fioul', bio: 'bioenergies', batteryCharge: 'stockage_batterie',
    batteryDischarge: 'destockage_batterie', load: 'consommation', loadForecastD1: 'prevision_j1', exchanges: 'ech_physiques', co2: 'taux_co2' };
  const months = new Map();   // 'YYYY-MM' → Promise<json|null>
  const live = new Map();     // 'YYYY-MM-DD' → Promise<day|null>
  const base = () => (typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : 'data/');
  const nativeFetch = (u) => window.fetch(u);

  function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
  function todayParis() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()); }

  function monthFile(ym) {
    if (!months.has(ym)) months.set(ym, nativeFetch(base() + 'history/rte/' + ym + '.json').then(r => r.ok ? r.json() : null).catch(() => null));
    return months.get(ym);
  }
  function liveDay(iso) {
    if (!live.has(iso)) {
      const where = `date="${iso}"`;
      const url = ODRE + '?select=' + ['heure'].concat(Object.values(COLS)).join(',') + '&where=' + encodeURIComponent(where) + '&order_by=date_heure';
      live.set(iso, nativeFetch(url).then(r => r.ok ? r.json() : null).then(rows => {
        if (!Array.isArray(rows) || !rows.length) return null;
        const day = { ds: 'tr-live', res: 15 };
        rows.forEach(r => {
          if (!r.heure) return;
          const i = +r.heure.slice(0, 2) * 4 + Math.floor(+r.heure.slice(3, 5) / 15);
          if (i < 0 || i > 95) return;
          Object.entries(COLS).forEach(([f, c]) => { const v = r[c] == null ? null : +r[c]; if (v != null && !isNaN(v)) { (day[f] = day[f] || new Array(96).fill(null))[i] = v; } });
        });
        return day.nuclear && day.nuclear.some(v => v != null) ? day : null;
      }).catch(() => null));
    }
    return live.get(iso);
  }

  async function rteDay(iso) {
    if (iso >= addDays(todayParis(), -LIVE_DAYS)) {
      const d = await liveDay(iso);
      if (d) return d;
    }
    const m = await monthFile(iso.slice(0, 7));
    return m && m.days && m.days[iso] || null;
  }

  const sumArr = (...arrs) => {
    const a = arrs.filter(Array.isArray); if (!a.length) return null;
    return a[0].map((_, i) => { let s = null; a.forEach(x => { if (x[i] != null) s = (s || 0) + x[i]; }); return s; });
  };
  // Production series end where RTE's data ends: a slot without nuclear is unpublished.
  function cut(arr, pub) { return Array.isArray(arr) ? arr.map((v, i) => pub[i] ? v : null) : null; }

  function overlayZone(z, R) {
    const pub = R.nuclear.map(v => v != null);
    const keep = {};
    ['nuclear', 'wind', 'windOnshore', 'windOffshore', 'solar', 'hydro', 'fossil', 'biomass', 'other', 'byCodeActual', 'byCode', 'genmix', 'renPct', 'domFuel']
      .forEach(k => { if (z[k] != null) keep[k] = z[k]; });
    if (Object.keys(keep).length) z.entsoe = keep;

    const split = Array.isArray(R.windOnshore) && R.windOnshore.some(v => v != null);
    const S = {
      nuclear: cut(R.nuclear, pub),
      windOnshore: cut(split ? R.windOnshore : R.wind, pub),
      windOffshore: split ? cut(R.windOffshore, pub) : null,
      solar: cut(R.solar, pub),
      hydro: cut(R.hydro, pub),
      fossil: cut(sumArr(R.gas, R.coal, R.oil), pub),
      biomass: cut(R.bio, pub),
      other: Array.isArray(R.batteryDischarge) ? cut(R.batteryDischarge, pub) : null,
    };
    S.wind = cut(R.wind || sumArr(S.windOnshore, S.windOffshore), pub);
    Object.entries(S).forEach(([k, v]) => { if (v) z[k] = v; else delete z[k]; });
    const codes = { B14: S.nuclear, B19: S.windOnshore, B18: S.windOffshore, B16: S.solar, B11: cut(R.hydroRoR, pub), B12: cut(R.hydroLake, pub),
      B10: cut(R.hydroPS, pub), B04: cut(R.gas, pub), B05: cut(R.coal, pub), B06: cut(R.oil, pub), B01: S.biomass };
    const byCode = {}; Object.entries(codes).forEach(([c, a]) => { if (Array.isArray(a)) byCode[c] = a; });
    z.byCodeActual = byCode; z.byCode = byCode;
    if (Array.isArray(R.load)) z.load = R.load.slice();
    if (Array.isArray(R.loadForecastD1)) z.loadForecast = R.loadForecastD1.slice();
    if (Array.isArray(R.pumping)) z.pumping = cut(R.pumping, pub);
    if (Array.isArray(R.batteryCharge)) z.batteryCharge = cut(R.batteryCharge, pub);
    if (Array.isArray(R.co2)) z.co2Rte = cut(R.co2, pub);

    // Daily summary fields, averages over published slots.
    const n = pub.filter(Boolean).length;
    const avg = a => { if (!Array.isArray(a) || !n) return 0; let s = 0; a.forEach((v, i) => { if (pub[i] && v != null) s += v; }); return Math.round(s / n); };
    const gm = { nuclear: avg(S.nuclear), solar: avg(S.solar), wind: avg(S.wind), hydro: avg(S.hydro), fossil: avg(S.fossil), biomass: avg(S.biomass), other: avg(S.other) };
    gm.byCode = {}; Object.entries(byCode).forEach(([c, a]) => { gm.byCode[c] = avg(a); });
    gm.total = gm.nuclear + gm.solar + gm.wind + gm.hydro + gm.fossil + gm.biomass + gm.other;
    z.genmix = gm;
    z.renPct = gm.total ? Math.round((gm.solar + gm.wind + gm.hydro + gm.biomass) / gm.total * 1000) / 10 : null;
    const top = Object.entries({ Nuclear: gm.nuclear, Wind: gm.wind, Solar: gm.solar, Hydro: gm.hydro, Fossil: gm.fossil, Biomass: gm.biomass }).sort((a, b) => b[1] - a[1])[0];
    z.domFuel = top ? top[0] : null;
    z.genSource = 'RTE éCO2mix';
    z.genDataset = R.ds === 'def' ? 'consolidated' : 'real time';
    z.genPublishedSlots = n;
  }

  // Called by gen-align.js after alignment, for every daily history file.
  window.pkFrOverlay = async function (json, dateISO) {
    if (!json || !json.zones || Array.isArray(json.zones)) return json;
    const R = await rteDay(dateISO);
    if (!R || !Array.isArray(R.nuclear)) return json;
    const z = json.zones.FR;
    if (!z) return json;
    overlayZone(z, R);
    return json;
  };
  window.pkRte = { day: rteDay, month: monthFile };
})();
