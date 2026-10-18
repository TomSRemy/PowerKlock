// ════════════════════════════════════════════════════════════════════
// RTE éCO2mix (France) — real-time 15-min national data via ODRÉ
// (odre.opendatasoft.com, open data, CORS-enabled, no key).
// Dataset eco2mix-national-tr covers roughly the last 7 weeks plus the
// day-ahead load forecast. Used for FR load (actual, D-1 and intraday
// forecasts) and FR commercial exchanges per border.
//
// Exchanges: RTE sign convention, negative = export from France.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  // Real-time dataset (last ~7 weeks) and consolidated history (2012 →
  // ~2 months ago, half-hourly consumption).
  const API = ds => 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/' + ds + '/exports/json';
  const DS_TR = 'eco2mix-national-tr', DS_DEF = 'eco2mix-national-cons-def';
  const FIELDS = ['date_heure', 'consommation', 'prevision_j1', 'prevision_j', 'ech_physiques',
    'ech_comm_angleterre', 'ech_comm_espagne', 'ech_comm_italie', 'ech_comm_suisse', 'ech_comm_allemagne_belgique',
    'taux_co2', 'nucleaire', 'eolien', 'solaire', 'hydraulique', 'gaz', 'charbon', 'fioul', 'bioenergies', 'pompage'];
  const BORDERS = [
    { key: 'ech_comm_allemagne_belgique', label: 'Germany + Belgium', color: '#FBBF24' },
    { key: 'ech_comm_angleterre', label: 'Great Britain', color: '#7FC8F8' },
    { key: 'ech_comm_suisse', label: 'Switzerland', color: '#ED6965' },
    { key: 'ech_comm_italie', label: 'Italy', color: '#14D3A9' },
    { key: 'ech_comm_espagne', label: 'Spain', color: '#C4A57B' },
  ];
  const cache = new Map();

  // Paris calendar day [00:00, 24:00) → UTC bounds.
  function dayBoundsUTC(dateISO) {
    const off = window.pkGenAlign ? pkGenAlign.parisOffset(dateISO) : 2;
    const start = new Date(Date.parse(dateISO + 'T00:00:00Z') - off * 3600e3);
    const end = new Date(start.getTime() + 24 * 3600e3);
    return [start.toISOString().slice(0, 19), end.toISOString().slice(0, 19)];
  }

  async function fetchRange(fromUTC, toUTC, ds) {
    ds = ds || DS_TR;
    const key = ds + '|' + fromUTC + '|' + toUTC;
    if (!cache.has(key)) {
      const where = `date_heure>="${fromUTC}" and date_heure<"${toUTC}"`;
      const url = API(ds) + '?select=' + FIELDS.join(',') + '&where=' + encodeURIComponent(where) + '&order_by=date_heure';
      cache.set(key, fetch(url).then(r => r.ok ? r.json() : null).catch(() => null));
    }
    return cache.get(key);
  }

  // 96 quarter-hour slots for a Paris delivery day; each field an array (null when missing).
  async function day(dateISO) {
    const [a, b] = dayBoundsUTC(dateISO);
    let rows = await fetchRange(a, b, DS_TR);
    let ds = DS_TR;
    if (!rows || !rows.some(r => r.consommation != null)) { rows = await fetchRange(a, b, DS_DEF); ds = DS_DEF; }
    if (!rows || !rows.length) return null;
    const t0 = Date.parse(a + 'Z');
    const out = {};
    FIELDS.slice(1).forEach(f => { out[f] = new Array(96).fill(null); });
    rows.forEach(r => {
      const i = Math.round((Date.parse(r.date_heure) - t0) / 900e3);
      if (i < 0 || i >= 96) return;
      FIELDS.slice(1).forEach(f => { if (r[f] != null) out[f][i] = r[f]; });
    });
    out.date = dateISO;
    out.dataset = ds === DS_TR ? 'real-time' : 'consolidated';
    out.published = out.consommation.filter(v => v != null).length;
    return out;
  }

  window.PK_E2M = { day, fetchRange, BORDERS, dayBoundsUTC };
})();
