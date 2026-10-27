// ════════════════════════════════════════════════════════════════════
// English / French. The site is written in English. In French:
//   · fixed labels (menus, titles, buttons, legends, axis titles) are swapped
//     from a dictionary (assets/i18n_fr.json, exact text → French);
//   · texts computed from the data are matched on templates
//     (assets/i18n_fr_tpl.json: numbers, day and month names become {n}, {d},
//     {m}, filled back in French: "Oct 2026 so far: 153.1 €/MWh" →
//     "oct. 2026 à date : 153,1 €/MWh");
//   · every other number on the page takes the French format (1 234,5) and
//     day and month names next to a date are translated;
//   · Chart.js draws its ticks in French (Chart.defaults.locale).
// All this on the page and on everything drawn later (MutationObserver), and
// in chart legends and axis titles (Chart.js plugin). French by default; the
// choice is kept in this browser (pk-lang); back to English reloads.
// window.pkEN(text) gives back the English of a translated label (rules that
// read labels, js/kpi-tone.js).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const KEY = 'pk-lang';
  let lang = 'en', D = null, T = null;
  // French by default; a choice made with the EN / FR button is kept in this browser
  try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'fr'; } catch (_) { lang = 'fr'; }
  const norm = s => s.replace(/\s+/g, ' ').trim();

  const MON = { Jan: 'janv.', January: 'janvier', Feb: 'févr.', February: 'février', Mar: 'mars', March: 'mars', Apr: 'avr.', April: 'avril', May: 'mai',
    Jun: 'juin', June: 'juin', Jul: 'juil.', July: 'juillet', Aug: 'août', August: 'août', Sep: 'sept.', Sept: 'sept.', September: 'septembre',
    Oct: 'oct.', October: 'octobre', Nov: 'nov.', November: 'novembre', Dec: 'déc.', December: 'décembre' };
  const DAY = { Mon: 'lun.', Monday: 'lundi', Tue: 'mar.', Tuesday: 'mardi', Wed: 'mer.', Wednesday: 'mercredi', Thu: 'jeu.', Thursday: 'jeudi',
    Fri: 'ven.', Friday: 'vendredi', Sat: 'sam.', Saturday: 'samedi', Sun: 'dim.', Sunday: 'dimanche' };
  const MONS = Object.keys(MON).sort((a, b) => b.length - a.length).join('|'), DAYS = Object.keys(DAY).sort((a, b) => b.length - a.length).join('|');
  // one token at a time, left to right: a day name before a date, a month name next to a number, a number or an ISO date
  // (same rules as the script that built the templates)
  const TOK = new RegExp('\\b(' + DAYS + ')\\b(?=,? \\d)|(?<=\\d )\\b(' + MONS + ')\\b|\\b(' + MONS + ')\\b(?= \\d)|(\\d{4}-\\d{2}-\\d{2}|[+\\-−]?\\d[\\d,]*(?:\\.\\d+)?)', 'g');

  // 1,234.5 → 1 234,5 (narrow no-break space); versions (0.20.3), codes (Cal2027) and times (07:42) left alone
  const fmtNum = v => v.replace(/^([+\-−]?)(\d{1,3}(?:,\d{3})+)(\.\d+)?$/, (m, s, i, d) => s + i.replace(/,/g, ' ') + (d ? ',' + d.slice(1) : ''))
    .replace(/^([+\-−]?\d+)\.(\d+)$/, '$1,$2');
  // compiled once: this runs on every text of the page
  const RE_TH = /(^|[^\w.,\u202f])(\d{1,3}(?:,\d{3})+)(\.\d+)?(?![\w,]|\.\d)/g, RE_DEC = /(^|[^\w.,])(\d+)\.(\d+)(?![\w]|\.\d)/g;
  const RE_DAY = new RegExp('\\b(' + DAYS + '),? (?=\\d)', 'g'), RE_MON = new RegExp('(?<=\\d )\\b(' + MONS + ')\\b|\\b(' + MONS + ')\\b(?= \\d)', 'g');
  const fmtText = s => {
    if (/\d,\d{3}/.test(s)) s = s.replace(RE_TH, (m, p, i, d) => p + i.replace(/,/g, '\u202f') + (d ? ',' + d.slice(1) : ''));
    // decimals get a comma, but not version numbers (CC BY 4.0, Etalab 2.0, v1.2)
    if (/\d\.\d/.test(s)) s = s.replace(RE_DEC, (m, p1, a, b, off, str) => /(?:\bBY|Etalab|\bv|version|HTTP\/?)\s?$/i.test(str.slice(Math.max(0, off - 12), off + p1.length)) ? m : p1 + a + ',' + b);
    if (/[A-Z][a-z]{2}/.test(s)) s = s.replace(RE_DAY, (m, d) => DAY[d] + ' ').replace(RE_MON, (m, a, b) => MON[a || b]);
    return s;
  };

  function template(s) {
    const vals = [];
    const key = s.replace(TOK, (m, d, m1, m2, n, off, str) => { if (d) { vals.push(['d', d]); return '{d}'; } if (m1 || m2) { vals.push(['m', m1 || m2]); return '{m}'; } vals.push([/(?:\bBY|Etalab|\bv|version)\s?$/i.test(str.slice(Math.max(0, off - 10), off)) ? 'raw' : 'n', n]); return '{n}'; });   // a version number (CC BY 4.0) is kept as written
    if (!vals.length || !T) return null;
    const fr = T[key]; if (fr == null) return null;
    let i = 0;
    return fr.replace(/\{([nmd])\}/g, () => { const v = vals[i++]; if (!v) return ''; return v[0] === 'n' ? fmtNum(v[1]) : v[0] === 'raw' ? v[1] : v[0] === 'm' ? MON[v[1]] : DAY[v[1]]; });
  }

  const OUT = new Set();   // strings this script wrote: never translated twice (1,234 must not become 1 234 once more)
  const keep = s => { if (OUT.size > 60000) OUT.clear(); OUT.add(s); return s; };
  const tr = s => {
    if (!D || typeof s !== 'string' || OUT.has(s)) return s;
    const k = norm(s); if (!k) return s;
    let v = D[k];
    if (v == null && T) v = T[k];
    if (v == null && /\d/.test(k)) {   // computed texts all carry a number: the rest skips the template work
      v = template(k);
      if (v == null) v = fmtText(k);
    }
    if (v == null) return s;
    if (v === k) return s;
    return keep(s.match(/^\s*/)[0] + v + s.match(/\s*$/)[0]);
  };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);
  function walk(root) {
    if (!D || !root) return;
    if (root.nodeType === 3) { if (root.parentNode && root.parentNode.closest && root.parentNode.closest('[translate="no"]')) return; const t = root.nodeValue; if (t && /[A-Za-z]{2}|\d[.,]\d/.test(t)) { const n = tr(t); if (n !== t) root.nodeValue = n; } return; }
    // translate="no": the brand (Power.Klock) and anything else that must stay as written
    if (root.nodeType !== 1 || SKIP.has(root.tagName) || root.isContentEditable || root.getAttribute('translate') === 'no') return;
    for (const a of ['title', 'placeholder', 'aria-label']) { const v = root.getAttribute && root.getAttribute(a); if (v) { const n = tr(v); if (n !== v) root.setAttribute(a, n); } }
    if (root.tagName === 'OPTION' || root.tagName === 'OPTGROUP') { if (root.label && root.tagName === 'OPTGROUP') root.label = tr(root.label); }
    for (let c = root.firstChild; c; c = c.nextSibling) walk(c);
  }
  let queued = new Set(), raf = 0;
  const flush = () => { raf = 0; const q = queued; queued = new Set(); q.forEach(walk); };
  const obs = new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') queued.add(m.target); else m.addedNodes.forEach(n => queued.add(n)); } if (!raf) raf = requestAnimationFrame(flush); });
  const plugin = { id: 'pkI18n', beforeUpdate(ch) {
    if (!D) return;
    (ch.config.data.datasets || []).forEach(d => { if (typeof d.label === 'string') d.label = tr(d.label); });
    const o = ch.config.options || {};
    Object.values(o.scales || {}).forEach(s => { if (s.title && typeof s.title.text === 'string') s.title.text = tr(s.title.text); });
    if (o.plugins && o.plugins.title && typeof o.plugins.title.text === 'string') o.plugins.title.text = tr(o.plugins.title.text);
  } };
  function button() {
    const right = document.querySelector('.topbar-right'); if (!right || document.getElementById('pk-lang-btn')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'pk-lang-btn'; b.className = 'pk-theme-btn pk-lang-btn';
    b.textContent = lang === 'fr' ? 'EN' : 'FR'; b.title = lang === 'fr' ? 'English' : 'Français';
    b.addEventListener('click', () => { try { localStorage.setItem(KEY, lang === 'fr' ? 'en' : 'fr'); } catch (_) {} location.reload(); });
    right.insertBefore(b, right.firstChild);
  }
  let EN = null;
  window.pkEN = s => { if (!EN || typeof s !== 'string') return s; const v = EN.get(norm(s)); return v == null ? s : v; };
  async function start() {
    button();
    document.documentElement.lang = lang === 'fr' ? 'fr' : 'en';   // the page is declared French (the default); English when chosen
    if (lang !== 'fr') return;
    const get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
    [D, T] = await Promise.all([get('assets/i18n_fr.json'), get('assets/i18n_fr_tpl.json')]);
    if (!D) return;
    EN = new Map();
    for (const src of [D, T || {}]) for (const [en, fr] of Object.entries(src)) if (!/\{[nmd]\}/.test(en)) EN.set(fr, en);
    if (window.Chart) {
      try { Chart.defaults.locale = 'fr-FR'; } catch (_) {}   // ticks drawn by Chart.js: 1 234,5
      if (Chart.register) { try { Chart.register(plugin); } catch (_) {} }
    }
    walk(document.body);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.PKI18n = { tr, lang, num: fmtText, walk };   // walk(el): translate a block at once, before it is painted
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.PKI18n = { tr: s => s, lang, num: s => s, walk: () => {} };
})();
