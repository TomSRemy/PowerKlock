// ════════════════════════════════════════════════════════════════════
// KPI TONE — key figures that compare with a reference (vs yesterday,
// vs normal, vs last year, vs baseload…) are coloured by what the change
// means for the market: green = easing / favourable, red = tightening /
// unfavourable (a price rise is red, as everywhere on the site), blue /
// amber = colder / warmer. The left border of the card and the comparison
// text take the colour. Rules are matched on the card label.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const num = s => { const m = String(s).replace(/−/g, '-').replace(/(\d)[\u202f\u00a0 ](?=\d{3}\b)/g, '$1').match(/([+-]?\d+(?:[.,]\d+)?)/); return m ? parseFloat(m[1].replace(',', '.')) : null; };
  const sign = (re, up) => card => {
    const leaf = leaves(card).find(e => re.test(e.textContent));
    if (!leaf) return null;
    const t = leaf.textContent.replace(/−/g, '-');
    let v = /▼/.test(t) ? -1 : /▲/.test(t) ? 1 : num(t.match(re)[0]);
    if (v == null) return null;
    return { leaf, tone: Math.abs(v) < 1e-9 ? 'flat' : (v > 0) === (up === 'good') ? 'good' : 'bad' };
  };
  const valueSign = up => card => {
    const el = card.querySelector('.kpi-value'); if (!el) return null;
    const v = num(el.textContent); if (v == null) return null;
    return { leaf: el, tone: Math.abs(v) < 1e-9 ? 'flat' : (v > 0) === (up === 'good') ? 'good' : 'bad' };
  };
  const ofBase = card => {
    const leaf = leaves(card).find(e => /% of baseload/.test(e.textContent)); if (!leaf) return null;
    const v = num(leaf.textContent); return v == null ? null : { leaf, tone: v >= 100 ? 'good' : 'bad' };
  };
  const temp = card => {
    const leaf = leaves(card).find(e => /°C vs/.test(e.textContent)); if (!leaf) return null;
    const v = num(leaf.textContent); return v == null ? null : { leaf, tone: Math.abs(v) < 0.05 ? 'flat' : v < 0 ? 'cold' : 'warm' };
  };
  function leaves(card) { return [...card.querySelectorAll('*')].filter(e => !e.children.length && e.textContent.trim()); }

  // [label pattern, rule]
  const RULES = [
    [/gas storage/i, sign(/[+-]?\d+(?:[.,]\d+)? pts vs/, 'good')],
    [/% ?renewable|avg %ren/i, sign(/[▲▼][^v]*vs/, 'good')],
    [/vs panel avg/i, valueSign('good')],
    [/yoy demand/i, valueSign('bad')],
    [/^go .*cal|delta wow/i, sign(/[+-]\d+(?:[.,]\d+)?\s*(?:€|vs last week|vs semaine précédente)/, 'bad')],
    [/^vs last year$/i, valueSign('good')],
    [/vs 5-year same date/i, valueSign('bad')],
    [/(solar|wind) capture/i, ofBase],
    [/c[sd]s base|spark|dark/i, valueSign('good')],
    [/next 7 days/i, temp],
    [/fr vs cheapest/i, valueSign('bad')],
  ];
  const CLS = { good: 'kpi-up', bad: 'kpi-down', flat: 'kpi-flat', cold: 'kpi-cold', warm: 'kpi-warm' };

  function apply(card) {
    const lab = card.querySelector('.kpi-label'); if (!lab) return;
    // rules are written on the English label: a French label is read back in English (js/i18n.js)
    const en = window.pkEN ? window.pkEN(lab.textContent.trim()) : lab.textContent.trim();
    const rule = RULES.find(([re]) => re.test(en) || re.test(lab.textContent.trim()));
    if (!rule) return;
    let r = null;
    try { r = rule[1](card); } catch (_) {}
    Object.values(CLS).forEach(c => card.classList.remove(c));
    card.classList.remove('pk-toned');
    card.querySelectorAll('.pk-tone').forEach(e => e.classList.remove('pk-tone', 'pk-tone-good', 'pk-tone-bad', 'pk-tone-flat', 'pk-tone-cold', 'pk-tone-warm'));
    if (!r) return;
    card.classList.add(CLS[r.tone], 'pk-toned');
    if (!r.leaf.classList.contains('kpi-value')) r.leaf.classList.add('pk-tone', 'pk-tone-' + r.tone);
  }

  let timer = null;
  const run = () => document.querySelectorAll('.kpi-card').forEach(apply);
  new MutationObserver(muts => {
    const el = m => m.target.nodeType === 3 ? m.target.parentElement : m.target;
    if (muts.every(m => { const e = el(m); return e && e.closest && e.closest('#pk-search, .chart-container, .ticker, .topbar, #pkd-toast'); })) return;
    clearTimeout(timer); timer = setTimeout(run, 150);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('load', () => setTimeout(run, 500));

  const css = document.createElement('style');
  css.textContent = `
  .kpi-card.pk-toned { border-left-width: 3px !important; border-left-style: solid !important; }
  .kpi-card.pk-toned.kpi-up { border-left-color: var(--up) !important; } .kpi-card.pk-toned.kpi-down { border-left-color: var(--down) !important; }
  .kpi-card.pk-toned.kpi-flat { border-left-color: var(--kpi-flat) !important; }
  .kpi-card.pk-toned.kpi-cold { border-left-color: #7FC8F8 !important; } .kpi-card.pk-toned.kpi-warm { border-left-color: #FBBF24 !important; }
  .pk-tone-good { color: var(--up) !important; } .pk-tone-bad { color: var(--down) !important; }
  .pk-tone-cold { color: #7FC8F8 !important; } .pk-tone-warm { color: #FBBF24 !important; }
  `;
  document.head.appendChild(css);
})();
