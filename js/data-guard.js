// ════════════════════════════════════════════════════════════════════
// Data guard: no chart shows an analysis over a hole without saying so.
// The server checks the histories every 2 hours (scripts/check_data_gaps.py →
// data/data_gaps.json: a zone missing on a day, France production incomplete,
// an RTE day, fuel or carbon closes, forwards…). Every chart of the site is
// looked at after it is drawn (Chart.js plugin): if its period covers an open
// hole of the data it is about — its zone or country, its fuel, its source,
// read from the card's title and the chart's legend — a badge says what is
// missing; a click opens Data status. The top-bar badge counts recent holes.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  let holes = [];
  // zone names in any case, zone codes in capitals only ('AT' the code, not 'at' the word)
  const ZN = { FR: 'France|French|Fran[cç]ais|\\bFR\\b', DE_LU: 'Germany|German|Allemagne|\\bDE\\b', BE: 'Belgi|\\bBE\\b', NL: 'Netherlands|Dutch|Pays-Bas|\\bNL\\b', ES: 'Spain|Spanish|Espagne|\\bES\\b',
    PT: 'Portugal|\\bPT\\b', IT_NORD: 'Italy|Itali|IT[ _]NORD|\\bIT\\b', CH: 'Switzerland|Swiss|Suisse|\\bCH\\b', AT: 'Austria|Autriche|\\bAT\\b' };
  const COM = { brent: 'Brent|oil', ttf: 'TTF|gas', eua: 'EUA|carbon|CO₂', coal: 'coal|API2', agsi: 'storage' };
  const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  // each hole: the day it concerns and what a chart must be about to be affected
  function parse(j) {
    return (j.open || []).map(i => {
      const day = (i.id.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
      let re = null;
      if (i.dataset === 'prices') { const zs = (i.what.match(/for (.+)$/) || [])[1]; re = zs ? zs.split(/,\s*/).map(z => ZN[z.trim()]).filter(Boolean).join('|') : '[Dd]ay-ahead|[Ss]pot'; }
      else if (i.dataset === 'generation' || i.dataset === 'rte') re = '(France|French|\\bFR\\b).*?(production|generation|output|load|consumption|nuclear|wind|solar|capture)|(production|generation|output|load|consumption|nuclear|wind|solar|capture).*?(France|French|\\bFR\\b)';
      else if (i.dataset === 'commodities') re = COM[i.id.split(':')[1]] || 'TTF|EUA|Brent|coal';
      else if (i.dataset === 'forwards') re = 'Cal|forward';
      else if (i.dataset === 'activation') re = 'activation|mFRR|balancing';
      else if (i.dataset === 'gencheck') re = '(France|French|\\bFR\\b).*?(production|generation|output|nuclear|wind|solar|hydro|gas|load|consumption)|(production|generation|output|nuclear|wind|solar|hydro|load|consumption).*?(France|French|\\bFR\\b)';
      else if (i.dataset === 'mktcheck') re = /eurusd/.test(i.id) ? 'EUR/USD|EURUSD' : 'Brent|oil';
      else if (i.dataset === 'pricecheck') { const z = (i.id.split(':')[1] || ''); re = ZN[z] || null; if (re) return { day, re: new RegExp(re), what: i.what.replace(/^\d{4}-\d{2}-\d{2}: /, '') + ' (prices being checked)', ds: i.dataset }; }
      return re ? { day, re: new RegExp(re, i.dataset === 'prices' ? '' : 'i'), what: i.what, ds: i.dataset } : null;
    }).filter(Boolean);
  }
  // the dates a chart covers, from its labels (2026-10-24, 2026-10, 24 Oct)
  function span(ch) {
    const L = (ch.data && ch.data.labels) || [];
    if (L.length < 2) return null;
    const yr = new Date().getFullYear();
    const iso = v => { const s = String(Array.isArray(v) ? v.join(' ') : v);
      let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
      m = s.match(/^(\d{4})-(\d{2})$/); if (m) return m[0] + '-01';
      m = s.match(/(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/); if (m) return yr + '-' + String(MON[m[2]]).padStart(2, '0') + '-' + m[1].padStart(2, '0');
      m = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}|\d{4})$/); if (m) return (m[2].length === 2 ? '20' + m[2] : m[2]) + '-' + String(MON[m[1]]).padStart(2, '0') + '-01';
      return null; };
    const a = iso(L[0]), b = iso(L[L.length - 1]);
    if (!a || !b) return null;
    let lo = a < b ? a : b, hi = a < b ? b : a;
    if (/^(\d{4}-\d{2}|[A-Z][a-z]{2} \d{2,4})$/.test(String(L[L.length - 1]))) hi = hi.slice(0, 8) + '31';   // a monthly axis covers its last month
    return [lo, hi];
  }
  // next to the card's title when there is one, else on the chart's corner
  function badge(ch, list) {
    const c = ch.canvas, host = c && c.parentElement; if (!host) return;
    const card = c.closest('.chart-container, .pkd-item, .fuel-card'), title = card && card.querySelector('.table-title, .pkd-title');
    const key = 'pkg' + c.id;
    let b = (card || host).querySelector('.pk-guard[data-for="' + key + '"]');
    if (!list.length) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'pk-guard' + (title ? ' pk-guard-inline' : ''); b.dataset.for = key;
      b.addEventListener('click', e => { e.stopPropagation(); if (typeof showPage === 'function') showPage('status'); });
      if (title) title.insertAdjacentElement('afterend', b);
      else { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; host.appendChild(b); } }
    b.textContent = '⚠ incomplete data · ' + (list.length === 1 ? list[0].what.replace(/^\d{4}-\d{2}-\d{2}: /, list[0].day ? list[0].day.slice(5) + ' · ' : '') : list.length + ' gaps in this period');
    b.title = 'This chart covers data that is missing:\n' + list.slice(0, 12).map(h => '· ' + h.what).join('\n') + (list.length > 12 ? '\n…' : '') + '\nAverages and totals over this period are biased until it is filled (checked every 2 hours). Click for Data status.';
  }
  function check(ch) {
    if (!holes.length) return badge(ch, []);
    const sp = span(ch); if (!sp) return badge(ch, []);
    const card = ch.canvas && ch.canvas.closest('.chart-container, .pkd-item, .fuel-card, .grid-stack-item');
    // the zone or market chosen for the chart: menus in the card, or in its section's controls
    const sec = ch.canvas && ch.canvas.closest('.hist-section-body, .pkd-item');
    const chosen = [...((card && card.querySelectorAll('select')) || []), ...((sec && sec.querySelectorAll(':scope > .pk-sec-controls select')) || [])]
      .map(x => (x.options[x.selectedIndex] || {}).text || '').join(' ');
    const text = chosen + ' ' + ((card && (card.querySelector('.table-title, .pkd-title') || {}).textContent) || '') + ' ' +
      ((ch.data.datasets || []).map(d => d.label || '').join(' ')) + ' ' + ((card && card.querySelector('.fuel-card-sub, .pkd-sub') || {}).textContent || '');
    badge(ch, holes.filter(h => (!h.day || (h.day >= sp[0] && h.day <= sp[1])) && h.re.test(text)));
  }
  const plugin = { id: 'pkGuard', afterUpdate(ch) { try { check(ch); } catch (_) {} } };
  async function start() {
    const j = await fetch(DATA_BASE + 'data_gaps.json?t=' + Math.floor(Date.now() / 6e5)).then(r => r.ok ? r.json() : null).catch(() => null);
    holes = j ? parse(j) : [];
    if (window.Chart && Chart.register) { try { Chart.register(plugin); } catch (_) {} }
    Object.values((window.Chart && Chart.instances) || {}).forEach(ch => { try { check(ch); } catch (_) {} });
    // top bar: recent holes (last 60 days) count as a source needing attention
    const recent = holes.filter(h => h.day && (Date.now() - Date.parse(h.day)) < 60 * 864e5);
    const el = document.getElementById('pk-status-badge');
    if (el && recent.length) { el.classList.add('pk-status-warn');
      el.title = (el.title ? el.title + '\n' : '') + recent.length + ' recent data gap' + (recent.length > 1 ? 's' : '') + ' (charts covering them carry a ⚠)'; }
    window.PKGuard = { holes, check };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
