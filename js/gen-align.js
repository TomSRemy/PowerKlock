// ════════════════════════════════════════════════════════════════════
// GENERATION / LOAD SLOT ALIGNMENT  (UTC → Europe/Paris)
//
// fetch_data.py / enrich_summary.py request ENTSO-E generation (A75) and
// load (A65) with a UTC-midnight window, so slot 0 of those arrays is
// 00:00 UTC — 01:00 CET / 02:00 CEST — while day-ahead prices are indexed
// on the CET/CEST delivery day. Plotted on the same x-axis (or multiplied
// together for capture rates) everything was off by 1–2 hours: the solar
// peak showed at "11:00" next to a 13:45 price trough.
//
// Fix at the single entry point: daily history files and the live
// renewables/load snapshots are realigned when they are loaded, so every
// page downstream sees Paris-time slots. Files that already carry
// slotTz === 'Europe/Paris' (written by a fixed fetcher) are left as-is.
//
// Slots ENTSO-E hasn't published yet are zero-filled by the fetcher; a slot
// where every technology reads 0 is turned into null so charts end where
// the data ends instead of dropping to zero.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const GEN_KEYS = ['windOnshore', 'windOffshore', 'wind', 'solar', 'nuclear', 'hydro', 'fossil', 'biomass', 'other'];
  const GEN_MAPS = ['byCodeActual', 'byCode'];
  const LOAD_KEYS = ['load', 'loadForecast'];   // shifted too; zero = unpublished
  const origFetch = window.fetch.bind(window);
  const rawCache = new Map();   // dateISO → Promise<raw json|null>

  // Paris UTC offset (hours) at noon on a given day: 1 (CET) or 2 (CEST).
  function parisOffset(dateISO) {
    const d = new Date(dateISO + 'T12:00:00Z');
    const h = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(d);
    return h - 12;
  }
  function prevISO(dateISO) {
    const [y, m, d] = dateISO.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  }
  // the one download of a daily file (raw, before alignment), shared by the day itself and by the next day's
  // alignment, which needs this day's last hours; refreshed every 5 minutes
  function rawDaily(baseUrl, dateISO) {
    const slot = Math.floor(Date.now() / (5 * 60 * 1000)), hit = rawCache.get(dateISO);
    if (!hit || hit.slot !== slot) {
      rawCache.set(dateISO, { slot, p: origFetch(baseUrl + dateISO + '.json?t=' + slot)
        .then(r => r.ok ? r.json() : null).catch(() => null) });
    }
    return rawCache.get(dateISO).p;
  }

  // out[i] = arr[i - k]; the first k slots come from the previous UTC day.
  // prevOk = false when the caller knows that tail was not published.
  function shift(arr, prevArr, offH, prevOk) {
    if (!Array.isArray(arr) || !arr.length) return arr;
    const n = arr.length, k = Math.round(offH * n / 24);
    prevOk = prevOk !== false && Array.isArray(prevArr) && prevArr.length === n;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      if (i >= k) out[i] = arr[i - k];
      else out[i] = prevOk ? prevArr[n - k + i] : null;
    }
    return out;
  }
  function hasGen(z) { return z && GEN_KEYS.concat(LOAD_KEYS).some(k => Array.isArray(z[k]) && z[k].length); }

  // Null out slots where no technology reported anything (unpublished).
  // The per-type maps can lag behind the aggregates (a later run completes
  // the aggregates, the map keeps the zero-filled tail): a slot where every
  // type is 0 while the aggregates produce is unpublished for the map.
  function nullUnpublished(z) {
    const arrs = GEN_KEYS.filter(k => Array.isArray(z[k]) && z[k].length).map(k => z[k]);
    if (!arrs.length) return;
    const n = arrs[0].length;
    for (let i = 0; i < n; i++) {
      let any = false, allNullish = true;
      for (const a of arrs) { const v = a[i]; if (v != null) { allNullish = false; if (v !== 0) { any = true; break; } } }
      if (!any && !allNullish) {
        GEN_KEYS.forEach(k => { if (Array.isArray(z[k]) && z[k].length === n) z[k][i] = null; });
        GEN_MAPS.forEach(m => { if (z[m] && typeof z[m] === 'object') Object.values(z[m]).forEach(a => { if (Array.isArray(a) && a.length === n) a[i] = null; }); });
      } else if (any) {
        GEN_MAPS.forEach(m => {
          const series = z[m] && typeof z[m] === 'object' ? Object.values(z[m]).filter(a => Array.isArray(a) && a.length === n) : [];
          if (series.length && series.every(a => !a[i])) series.forEach(a => { a[i] = null; });
        });
      }
    }
  }

  function alignZone(z, pz, offH) {
    GEN_KEYS.forEach(k => { if (Array.isArray(z[k])) z[k] = shift(z[k], pz && pz[k], offH); });
    GEN_MAPS.forEach(m => {
      if (z[m] && typeof z[m] === 'object' && !Array.isArray(z[m])) {
        // The previous file may carry the per-type breakdown only up to the
        // fetch time, zero-filled after: when every type's tail is 0 that
        // tail was unpublished (a single type at 0, e.g. solar at night, is real).
        const pm = pz && pz[m];
        const mapOk = !!pm && Object.values(pm).some(a => Array.isArray(a) && a.length && (() => {
          const n = a.length, k = Math.round(offH * n / 24);
          return a.slice(n - k).some(v => v != null && v !== 0);
        })());
        Object.keys(z[m]).forEach(code => {
          if (Array.isArray(z[m][code])) z[m][code] = shift(z[m][code], pm && pm[code], offH, mapOk);
        });
      }
    });
    nullUnpublished(z);
    LOAD_KEYS.forEach(k => { if (Array.isArray(z[k])) z[k] = shift(z[k], pz && pz[k], offH).map(v => v === 0 ? null : v); });
  }

  async function alignDaily(json, dateISO, baseUrl) {
    if (!json || json.slotTz === 'Europe/Paris' || !json.zones || Array.isArray(json.zones)) return json;
    const zones = json.zones;
    if (!Object.values(zones).some(hasGen)) return json;   // prices-only file: nothing to do
    const prev = await rawDaily(baseUrl, prevISO(dateISO));
    const offH = parisOffset(dateISO);
    Object.entries(zones).forEach(([code, z]) => { if (hasGen(z)) alignZone(z, prev && prev.zones && prev.zones[code], offH); });
    json.slotTz = 'Europe/Paris';
    json._alignedClientSide = true;
    return json;
  }

  // one download and one alignment per daily file every 5 minutes: a dozen modules ask for the same days at boot
  // (271 requests for 45 files before), each with its own ?t= cache-buster
  const memo = new Map(), MEMO_MS = 5 * 60 * 1000;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const m = url.match(/^(.*history\/daily\/)(\d{4}-\d{2}-\d{2})\.json/);
    if (!m || (init && init.method && init.method !== 'GET')) return origFetch(input, init);
    const hit = memo.get(m[2]);
    if (hit && Date.now() - hit.at < MEMO_MS) {
      const body = await hit.p;
      return body == null ? origFetch(input, init) : new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    let failed = null;
    const p = (async () => {
      const raw = await rawDaily(m[1], m[2]);
      if (raw == null) return null;   // missing or unreadable: the caller's own request answers below
      const json = JSON.parse(JSON.stringify(raw));
      let aligned = await alignDaily(json, m[2], m[1]);
      if (window.pkFrOverlay) { try { aligned = await window.pkFrOverlay(aligned, m[2]); } catch (e) { console.warn('RTE overlay failed', e); } }
      return JSON.stringify(aligned);
    })();
    memo.set(m[2], { at: Date.now(), p });
    const body = await p;
    if (body == null) { memo.delete(m[2]); return failed || origFetch(input, init); }
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  // Live snapshots (renewables.json / load.json): arrays cover the UTC day
  // of `updated`. Actuals borrow the first slots from the previous daily
  // file; forecasts / load have no previous-day copy and start empty.
  async function alignSnapshot(snap, kind) {
    if (!snap || snap.slotTz === 'Europe/Paris' || !snap.countries || !snap.updated) return snap;
    const dateISO = snap.updated.slice(0, 10);
    const offH = parisOffset(dateISO);
    const base = (typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : 'data/') + 'history/daily/';
    const prev = kind === 'ren' ? await rawDaily(base, prevISO(dateISO)) : null;
    const MAP = { windOnshoreActual: 'windOnshore', windOffshoreActual: 'windOffshore', windActual: 'wind', solarActual: 'solar',
      nuclearActual: 'nuclear', hydroActual: 'hydro', fossilActual: 'fossil', biomassActual: 'biomass', otherActual: 'other' };
    Object.entries(snap.countries).forEach(([code, c]) => {
      const pz = prev && prev.zones && prev.zones[code];
      Object.keys(c).forEach(k => {
        if (!Array.isArray(c[k])) return;
        const prevArr = pz && MAP[k] ? pz[MAP[k]] : null;
        c[k] = shift(c[k], prevArr, offH);
      });
      if (c.byCodeActual && typeof c.byCodeActual === 'object') {
        Object.keys(c.byCodeActual).forEach(b => { c.byCodeActual[b] = shift(c.byCodeActual[b], pz && pz.byCodeActual && pz.byCodeActual[b], offH); });
      }
      if (kind === 'ren') {
        // Unpublished actual slots → null (forecast kept), errors recomputed.
        const act = Object.keys(MAP).filter(k => Array.isArray(c[k]));
        const n = act.length ? c[act[0]].length : 0;
        for (let i = 0; i < n; i++) {
          if (act.every(k => !c[k][i])) act.forEach(k => { c[k][i] = null; });
        }
        if (Array.isArray(c.windActual) && Array.isArray(c.windForecast)) c.windError = c.windActual.map((v, i) => v == null || c.windForecast[i] == null ? null : v - c.windForecast[i]);
        if (Array.isArray(c.solarActual) && Array.isArray(c.solarForecast)) c.solarError = c.solarActual.map((v, i) => v == null || c.solarForecast[i] == null ? null : v - c.solarForecast[i]);
      } else if (kind === 'load' && Array.isArray(c.actual)) {
        c.actual = c.actual.map(v => v === 0 ? null : v);
      }
    });
    snap.slotTz = 'Europe/Paris';
    return snap;
  }

  window.pkGenAlign = { alignSnapshot, alignDaily, parisOffset, shift };
})();
