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
  window.PK_ERRORS = [];
  const keep = (msg, where) => { if (window.PK_ERRORS.length < 50) window.PK_ERRORS.push({ at: new Date().toISOString(), page: (document.querySelector('.page.active') || {}).id || '', msg: String(msg || '').slice(0, 300), where: String(where || '').slice(0, 200) }); };
  window.addEventListener('error', e => { if (e && e.message) keep(e.message, (e.filename || '').split('/').pop() + ':' + (e.lineno || '')); });
  window.addEventListener('unhandledrejection', e => { const r = e && e.reason; if (r && r.name === 'AbortError') return; keep(r && (r.message || r), 'promise'); });
  window.pkTodayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
})();
