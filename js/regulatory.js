// ════════════════════════════════════════════════════════════════════
// regulatory.js · window.PKReg — regulatory watch
//   · data/regulatory.json: dated milestones of the French and European power markets, past and upcoming, each
//     with its source and the charts it concerns (tags: spot, fwd, neg, m0, balancing, nuclear, capacity, co2, go, enr)
//   · the "Veille réglementaire" page: upcoming first, then the history, by theme, plus the regulation news of the
//     last 30 days from the news feed (what may become the next milestone)
//   · on charts with a date axis whose widget concerns a tag: a dashed line at each milestone, its title on hover;
//     a click opens the page on that milestone
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const L = a => Array.isArray(a) ? T(a[0], a[1]) : a;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // which charts show which milestones (widget id → tags)
  const WIDGET_TAGS = {
    'fr-spot-30d': ['spot'], 'fr-spot-monthly': ['spot'], 'fr-de-spread': ['spot'], 'hist-spread': ['spot'], 'spark-daily': ['spot', 'co2'], 'spark-monthly': ['spot', 'co2'],
    'fr-cal-history': ['fwd', 'nuclear'], 'fr-cal-drivers': ['fwd', 'co2'], 'pf-history': ['fwd'], 'fwd-power': ['fwd'], 'ttf-cal-history': ['co2'], 'fwdc-eua': ['co2'], 'fwdc-ttf': ['co2'],
    'eua': ['co2'], 'fuel-eua-ttf': ['co2'], 'ppa-benchmark': ['fwd', 'enr'],
    'cannib-rolling': ['neg', 'enr'], 'cannib-rolling-eur': ['neg', 'enr'], 'hist-neg': ['neg'], 'neg-cost': ['neg'], 'negflex': ['neg'], 'ren-cr': ['neg', 'enr'],
    'fr-m0-official': ['m0'], 'fr-m0-forecast': ['m0'], 'cre-tenders': ['m0', 'enr'],
    'fr-imb-price': ['balancing'], 'fr-activation': ['balancing'], 'imb-days': ['balancing'],
    'bilan-prod': ['enr', 'nuclear'], 'bilan-spot': ['spot', 'neg', 'nuclear'],
    'nuc-hist': ['nuclear'], 'remit-unavail': ['nuclear'], 'cap-history': ['capacity', 'enr'], 'go-vintages': ['enr'],
  };
  let DATA = null, P = null;
  function load() {
    if (!P) P = fetch((typeof DATA_BASE !== 'undefined' ? DATA_BASE : 'data/') + 'regulatory.json').then(r => r.ok ? r.json() : null).catch(() => null)
      .then(j => { DATA = j; if (j) Object.values((window.Chart && Chart.instances) || {}).forEach(ch => { try { if (ch.canvas && ch.canvas.dataset.pkw) ch.draw(); } catch (_) {} }); return j; });
    return P;
  }
  const today = () => (window.pkTodayISO ? pkTodayISO() : new Date().toISOString().slice(0, 10));
  const fmt = it => { const d = new Date(it.date + 'T12:00:00Z');
    return it.precision === 'month' ? d.toLocaleDateString(T('fr-FR', 'en-GB'), { month: 'long', year: 'numeric', timeZone: 'UTC' }) : d.toLocaleDateString(T('fr-FR', 'en-GB'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
  const TAG_NAME = { spot: ['Spot', 'Spot'], fwd: ['Forwards', 'Forwards'], neg: ['Prix négatifs', 'Negative prices'], m0: ['M0 et soutien', 'M0 and support'], balancing: ['Équilibrage', 'Balancing'],
    nuclear: ['Nucléaire', 'Nuclear'], capacity: ['Capacité', 'Capacity'], co2: ['Carbone', 'Carbon'], go: ['GO', 'GO'], enr: ['Renouvelables', 'Renewables'] };
  const TAG_ROUTE = { spot: 'markets/spot', fwd: 'markets/forwards', neg: 'markets/spot/negative', m0: 'renewables/m0', balancing: 'markets/spot/imbalance', nuclear: 'system/generation/nuclear', capacity: 'renewables/capacity', co2: 'markets/fuels', go: 'markets/go', enr: 'renewables/capture' };

  // ── the page ──
  let theme = '';
  async function render() {
    const host = document.getElementById('reg-host'); if (!host) return;
    const j = await load();
    if (!j) { host.innerHTML = '<div class="fuel-note">' + T('Veille indisponible.', 'Watch not available.') + '</div>'; return; }
    const t = today(), items = j.items.filter(it => !theme || it.theme === theme);
    const up = items.filter(it => it.date > t).sort((a, b) => a.date.localeCompare(b.date)), past = items.filter(it => it.date <= t).sort((a, b) => b.date.localeCompare(a.date));
    const card = it => `<li class="reg-it${it.date > t ? ' reg-up' : ''}" id="reg-${esc(it.id)}"><div class="reg-d">${esc(fmt(it))}<span class="reg-sc">${it.scope === 'EU' ? '🇪🇺 UE' : '🇫🇷 France'}</span></div>
      <div class="reg-b"><div class="reg-t">${esc(L(it.title))} <span class="reg-th">${esc(L(j.themes[it.theme] || it.theme))}</span></div><p>${esc(L(it.text))}</p>
      <div class="reg-f">${(it.tags || []).map(g => `<a class="reg-tag" href="#${TAG_ROUTE[g] || ''}" data-route="${TAG_ROUTE[g] || ''}">${esc(L(TAG_NAME[g] || [g, g]))}</a>`).join('')}
      ${it.source ? `<a class="reg-src" href="${esc(it.source[1])}" target="_blank" rel="noopener">${T('Source', 'Source')} : ${esc(it.source[0])} ↗</a>` : ''}</div></div></li>`;
    const chips = ['', ...Object.keys(j.themes)].map(k => `<button type="button" class="reg-chip${k === theme ? ' on' : ''}" data-th="${k}">${esc(k ? L(j.themes[k]) : T('Tout', 'All'))}</button>`).join('');
    host.innerHTML = `<div class="reg-chips">${chips}</div>
      <h3 class="reg-h">${T('À venir', 'Upcoming')} <span>${up.length}</span></h3><ol class="reg-list">${up.map(card).join('') || '<li class="fuel-note">' + T('Rien d’annoncé pour ce thème.', 'Nothing announced for this theme.') + '</li>'}</ol>
      <h3 class="reg-h">${T('Historique', 'History')} <span>${past.length}</span></h3><ol class="reg-list">${past.map(card).join('')}</ol>
      <div class="reg-news" id="reg-news"></div>
      <p class="fuel-note">${T('Chaque date est vérifiée sur sa source. Les jalons apparaissent aussi en pointillés sur les graphiques concernés (spot, forwards, prix négatifs, M0, équilibrage…). Liste mise à jour au ', 'Each date is checked against its source. Milestones also show as dashed lines on the charts they concern (spot, forwards, negative prices, M0, balancing…). List updated on ')}${esc(j.updated)}.</p>`;
    host.querySelectorAll('.reg-chip').forEach(b => b.addEventListener('click', () => { theme = b.dataset.th; render(); }));
    news();
    const h = location.hash.match(/[?&]m=([\w-]+)/); if (h) { const el = document.getElementById('reg-' + h[1]); if (el) { el.classList.add('reg-hl'); el.scrollIntoView({ block: 'center' }); } }
  }
  // regulation news of the last 30 days, France and Europe: what may become a milestone
  async function news() {
    const el = document.getElementById('reg-news'); if (!el) return;
    const j = await fetch((typeof DATA_BASE !== 'undefined' ? DATA_BASE : 'data/') + 'news.json').then(r => r.ok ? r.json() : null).catch(() => null);
    const isFr = n => (n.tags || []).includes('fr') || (typeof _newsIsFr === 'function' && _newsIsFr(n));
    const list = ((j && j.items) || []).filter(n => (n.tags || []).includes('regulation') && (isFr(n) || (n.countries || []).some(c => c === 'FR' || c === 'EU')) && Date.now() - Date.parse(n.date) < 30 * 864e5)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 12);
    el.innerHTML = `<h3 class="reg-h">${T('Dans l’actualité réglementaire', 'In the regulatory news')} <span>${T('30 derniers jours, France et Europe', 'last 30 days, France and Europe')}</span></h3>` +
      (list.length ? '<ul class="reg-nl">' + list.map(n => `<li><a href="${/^https?:\/\//.test(n.link || '') ? esc(n.link) : '#'}" target="_blank" rel="noopener">${esc(n.title)}</a><span>${esc(n.source)} · ${new Date(n.date).toLocaleDateString(T('fr-FR', 'en-GB'), { day: 'numeric', month: 'short' })}</span></li>`).join('') + '</ul>'
        : '<p class="fuel-note">' + T('Rien ce mois-ci.', 'Nothing this month.') + '</p>');
  }

  // ── on the charts ──
  function xPos(ch, date) {
    const x = ch.scales && ch.scales.x; if (!x) return null;
    if (x.type === 'time' || x.type === 'timeseries') { const v = Date.parse(date + 'T00:00:00'); return v >= x.min && v <= x.max ? x.getPixelForValue(v) : null; }
    const labels = ch.data.labels || []; if (labels.length < 3) return null;
    const iso = String(labels[0]); const day = /^\d{4}-\d{2}-\d{2}/.test(iso), mon = /^\d{4}-\d{2}$/.test(iso); if (!day && !mon) return null;
    const key = mon ? date.slice(0, 7) : date, lo = Math.max(0, Math.floor(x.min || 0)), hi = Math.min(labels.length - 1, Math.ceil(x.max == null ? labels.length - 1 : x.max));
    if (key < String(labels[lo]).slice(0, key.length) || key > String(labels[hi]).slice(0, key.length)) return null;
    for (let i = lo; i <= hi; i++) if (String(labels[i]).slice(0, key.length) >= key) return x.getPixelForValue(i);
    return null;
  }
  function marks(ch) {
    const id = ch.canvas && ch.canvas.dataset.pkw, tags = id && WIDGET_TAGS[id];
    if (!tags || !DATA || ch.$pkRegOff) return [];
    return DATA.items.filter(it => (it.tags || []).some(g => tags.includes(g))).map(it => ({ it, x: xPos(ch, it.date) })).filter(m => m.x != null);
  }
  const plugin = {
    id: 'pkReg',
    afterDatasetsDraw(ch) {
      const ms = marks(ch); ch.$pkRegMarks = ms; if (!ms.length) return;
      const a = ch.chartArea, g = ch.ctx, up = today();
      g.save(); g.lineWidth = 1; g.font = '600 9px "JetBrains Mono", monospace'; g.textAlign = 'center';
      ms.forEach(({ it, x }) => {
        const fut = it.date > up, col = fut ? 'rgba(251,191,36,.75)' : 'rgba(184,201,217,.55)';
        g.strokeStyle = col; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, a.top + 10); g.lineTo(x, a.bottom); g.stroke(); g.setLineDash([]);
        g.fillStyle = col; g.beginPath(); g.moveTo(x - 4, a.top); g.lineTo(x + 4, a.top); g.lineTo(x, a.top + 7); g.closePath(); g.fill();   // a small flag on top
      });
      const h = ch.$pkRegHover; if (h) {   // the milestone under the pointer, written in a box
        g.font = '10px "JetBrains Mono", monospace';
        let txt = fmt(h.it) + ' · ' + L(h.it.title); while (txt.length > 12 && g.measureText(txt).width + 14 > a.right - a.left - 8) txt = txt.slice(0, -2);
        if (txt !== fmt(h.it) + ' · ' + L(h.it.title)) txt = txt.replace(/\s*\S?$/, '') + '…';
        const w = g.measureText(txt).width + 14;
        const bx = Math.max(a.left + 4, Math.min(a.right - w - 4, h.x - w / 2));
        g.fillStyle = 'rgba(10,15,20,.92)'; g.strokeStyle = 'rgba(251,191,36,.6)'; g.beginPath(); g.rect(bx, a.top + 10, w, 18); g.fill(); g.stroke();
        g.fillStyle = '#E6EDF3'; g.textAlign = 'left'; g.fillText(txt, bx + 7, a.top + 23);
      }
      g.restore();
    },
    afterEvent(ch, args) {
      const e = args.event, ms = ch.$pkRegMarks; if (!ms || !ms.length) return;
      const near = e.y != null && e.y >= ch.chartArea.top && e.y <= ch.chartArea.top + 40 ? ms.find(m => Math.abs(m.x - e.x) <= 6) : null;
      if (e.type === 'click' && near) { location.hash = '#intel/regulation?m=' + near.it.id; return; }
      if ((near && near !== ch.$pkRegHover) || (!near && ch.$pkRegHover)) { ch.$pkRegHover = near; args.changed = true; ch.canvas.style.cursor = near ? 'pointer' : ''; }
    },
  };
  if (window.Chart && Chart.register) { try { Chart.register(plugin); } catch (_) {} }
  load();
  window.PKReg = { load, render, WIDGET_TAGS };
})();
