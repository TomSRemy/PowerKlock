// ════════════════════════════════════════════════════════════════════
// English / French. The site is written in English; in French the fixed
// labels (menus, titles, buttons, legends, axis titles) are swapped from a
// dictionary (assets/i18n_fr.json, exact text → French), on the page and on
// everything drawn later (MutationObserver), and in chart legends and axis
// titles (Chart.js plugin). Texts computed from the data stay in English for
// now. The choice is kept in this browser (pk-lang); back to English reloads.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const KEY = 'pk-lang';
  let lang = 'en', D = null;
  try { lang = localStorage.getItem(KEY) === 'fr' ? 'fr' : 'en'; } catch (_) {}
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const tr = s => { if (!D || typeof s !== 'string') return s; const v = D[norm(s)]; return v == null ? s : s.match(/^\s*/)[0] + v + s.match(/\s*$/)[0]; };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);
  function walk(root) {
    if (!D || !root) return;
    if (root.nodeType === 3) { const t = root.nodeValue; if (t && /[A-Za-z]{2}/.test(t)) { const n = tr(t); if (n !== t) root.nodeValue = n; } return; }
    if (root.nodeType !== 1 || SKIP.has(root.tagName) || root.isContentEditable) return;
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
  async function start() {
    button();
    if (lang !== 'fr') return;
    document.documentElement.lang = 'fr';
    try { D = await fetch('assets/i18n_fr.json').then(r => r.ok ? r.json() : null); } catch (_) { D = null; }
    if (!D) return;
    if (window.Chart && Chart.register) { try { Chart.register(plugin); } catch (_) {} }
    walk(document.body);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.PKI18n = { tr, lang };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.PKI18n = { tr: s => s, lang };
})();
