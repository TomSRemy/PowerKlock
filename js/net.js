// ════════════════════════════════════════════════════════════════════
// net.js · loaded first. Three guards for the whole site:
//   - every request gives up after a delay (after 2 minutes, even a large data file on a slow phone)
//     instead of leaving "Loading…" forever when a server does not answer;
//   - errors are no longer lost: kept in PK_ERRORS (shown on Data status);
//   - pkTodayISO(): today's date in Paris (not UTC, which is yesterday
//     between midnight and 1-2 am in Paris).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const native = window.fetch && window.fetch.bind(window);
  if (native && window.AbortSignal && AbortSignal.timeout) {
    window.fetch = function (input, init) {
      if (init && init.signal) return native(input, init);
      return native(input, Object.assign({}, init, { signal: AbortSignal.timeout(120000) }));
    };
  }
  // the same data file asked for by several modules (Today asked for commodities_series.json 4 times) is
  // downloaded once: requests for one file within a minute share the answer, each caller reading its own copy.
  // Cache-busting parameters (?t=, ?v=) are ignored for this; a request with cache 'no-store' or 'reload' goes out.
  // A delivery day that cannot be published yet is not asked for (it answered 404 on every page, several times a day):
  // data/history/daily/<D>.json is written after the day-ahead auction of D-1 (results from 12:45 in Paris), and
  // history/monthly/<YYYY-MM>.json and history/fr_hourly/<YYYY>.json with their first day. Before that the answer is
  // known: 404, no request sent.
  // From 12:45 until the file is there the request goes out as before (only the server knows).
  const parisNow = () => { const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; }); return { day: p.year + '-' + p.month + '-' + p.day, hm: +p.hour * 100 + +p.minute }; };
  const nextDay = iso => { const a = iso.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2] + 1)).toISOString().slice(0, 10); };
  const notYet = url => {
    const m = /(?:^|\/)data\/history\/(daily\/(\d{4}-\d{2}-\d{2})|monthly\/(\d{4}-\d{2})|fr_hourly\/(\d{4}))\.json(?:\?|$)/.exec(url); if (!m) return false;
    try { const now = parisNow(), last = now.hm >= 1245 ? nextDay(now.day) : now.day;   // the latest delivery day that can exist
      return m[2] ? m[2] > last : m[3] ? m[3] > last.slice(0, 7) : m[4] > last.slice(0, 4); } catch (_) { return false; }
  };
  const timed = window.fetch, SHARE = new Map(), TTL = 60000;
  if (timed) window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const method = (init && init.method) || (input && input.method) || 'GET';
    if (url && (method === 'GET' || method === 'HEAD') && notYet(url)) return Promise.resolve(new Response('', { status: 404, statusText: 'Not published yet' }));
    if (!url || method !== 'GET' || (init && (init.cache === 'no-store' || init.cache === 'reload' || init.body)) || !(/(^|\/)data\/[^?]+\.(json|csv)(\?|$)/.test(url) || /opendatasoft\.com\/api\//.test(url))) return timed(input, init);
    const key = /opendatasoft/.test(url) ? url : url.replace(/[?&](t|v|_)=[^&]*/g, '').replace(/\?$/, '');
    const hit = SHARE.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.p.then(r => r.clone());
    const p = timed(input, init).then(r => { if (r.status >= 500) SHARE.delete(key); return r; }, e => { SHARE.delete(key); throw e; });   // a 404 (file not published yet) is an answer too
    SHARE.set(key, { at: Date.now(), p });
    setTimeout(() => { if (SHARE.get(key) && SHARE.get(key).p === p) SHARE.delete(key); }, TTL);
    return p.then(r => r.clone());
  };
  window.PK_ERRORS = [];
  const keep = (msg, where) => { if (window.PK_ERRORS.length < 50) window.PK_ERRORS.push({ at: new Date().toISOString(), page: (document.querySelector('.page.active') || {}).id || '', msg: String(msg || '').slice(0, 300), where: String(where || '').slice(0, 200) }); };
  window.addEventListener('error', e => { if (e && e.message) keep(e.message, (e.filename || '').split('/').pop() + ':' + (e.lineno || '')); });
  window.addEventListener('unhandledrejection', e => { const r = e && e.reason; if (r && r.name === 'AbortError') return; keep(r && (r.message || r), 'promise'); });
  window.pkTodayISO = () => window.PK ? PK.today() : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
})();
