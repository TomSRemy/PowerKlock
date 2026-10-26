// ════════════════════════════════════════════════════════════════════
// regulatory.js · window.PKReg — regulatory watch
//   · data/events.json: dated events of the French and European power markets, past and upcoming — regulation,
//     market, gas and geopolitics, nuclear, grid, weather — each with its source, an importance (1-3), a short label
//     and the charts it concerns (tags: spot, fwd, neg, m0, balancing, nuclear, capacity, co2, go, enr)
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
    if (!P) P = fetch((typeof DATA_BASE !== 'undefined' ? DATA_BASE : 'data/') + 'events.json').then(r => r.ok ? r.json() : null).catch(() => null)
      .then(j => { DATA = j; if (j) Object.values((window.Chart && Chart.instances) || {}).forEach(ch => { try { if (ch.canvas && ch.canvas.dataset.pkw) ch.draw(); } catch (_) {} }); return j; });
    return P;
  }
  const today = () => (window.pkTodayISO ? pkTodayISO() : new Date().toISOString().slice(0, 10));
  const fmt = it => { const d = new Date(it.date + 'T12:00:00Z');
    return it.precision === 'month' ? d.toLocaleDateString(T('fr-FR', 'en-GB'), { month: 'long', year: 'numeric', timeZone: 'UTC' }) : d.toLocaleDateString(T('fr-FR', 'en-GB'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
  const KC = { reg: '#7FC8F8', marche: '#FBBF24', gaz: '#F59E0B', geo: '#ED6965', nucleaire: '#A98BD4', reseau: '#14D3A9', meteo: '#F97316' };   // one colour per kind of event
  const TAG_NAME = { spot: ['Spot', 'Spot'], fwd: ['Forwards', 'Forwards'], neg: ['Prix négatifs', 'Negative prices'], m0: ['M0 et soutien', 'M0 and support'], balancing: ['Équilibrage', 'Balancing'],
    nuclear: ['Nucléaire', 'Nuclear'], capacity: ['Capacité', 'Capacity'], co2: ['Carbone', 'Carbon'], go: ['GO', 'GO'], enr: ['Renouvelables', 'Renewables'] };
  const TAG_ROUTE = { spot: 'markets/spot', fwd: 'markets/forwards', neg: 'markets/spot/negative', m0: 'renewables/m0', balancing: 'markets/spot/imbalance', nuclear: 'system/generation/nuclear', capacity: 'renewables/capacity', co2: 'markets/fuels', go: 'markets/go', enr: 'renewables/capture' };

  // ── the page ──
  let theme = '';
  async function render() {
    const host = document.getElementById('reg-host'); if (!host) return;
    const j = await load();
    if (!j) { host.innerHTML = '<div class="fuel-note">' + T('Veille indisponible.', 'Watch not available.') + '</div>'; return; }
    const t = today(), items = j.items.filter(it => !theme || it.kind === theme);
    const up = items.filter(it => it.date > t).sort((a, b) => a.date.localeCompare(b.date)), past = items.filter(it => it.date <= t).sort((a, b) => b.date.localeCompare(a.date));
    const card = it => `<li class="reg-it${it.date > t ? ' reg-up' : ''}" id="reg-${esc(it.id)}"><div class="reg-d">${esc(fmt(it))}<span class="reg-sc">${it.scope === 'EU' ? '🇪🇺 UE' : '🇫🇷 France'}</span></div>
      <div class="reg-b"><div class="reg-t"><i class="reg-k" style="background:${KC[it.kind] || '#7A93AB'}"></i>${esc(L(it.title))} <span class="reg-th">${esc(L((j.kinds || {})[it.kind] || j.themes[it.theme] || it.theme))}</span></div><p>${esc(L(it.text))}</p>
      <div class="reg-f">${(it.tags || []).map(g => `<a class="reg-tag" href="#${TAG_ROUTE[g] || ''}" data-route="${TAG_ROUTE[g] || ''}">${esc(L(TAG_NAME[g] || [g, g]))}</a>`).join('')}
      ${it.source ? `<a class="reg-src" href="${esc(it.source[1])}" target="_blank" rel="noopener">${T('Source', 'Source')} : ${esc(it.source[0])} ↗</a>` : ''}</div></div></li>`;
    const chips = ['', ...Object.keys(j.kinds)].map(k => `<button type="button" class="reg-chip${k === theme ? ' on' : ''}" data-th="${k}">${k ? `<i class="reg-k" style="background:${KC[k]}"></i>` : ''}${esc(k ? L(j.kinds[k]) : T('Tout', 'All'))} <span>${k ? j.items.filter(it => it.kind === k).length : j.items.length}</span></button>`).join('');
    host.innerHTML = `<div class="reg-chips">${chips}</div>
      <h3 class="reg-h">${T('À venir', 'Upcoming')} <span>${up.length}</span></h3><ol class="reg-list">${up.map(card).join('') || '<li class="fuel-note">' + T('Rien d’annoncé pour ce thème.', 'Nothing announced for this theme.') + '</li>'}</ol>
      <h3 class="reg-h">${T('Historique', 'History')} <span>${past.length}</span></h3><ol class="reg-list">${past.map(card).join('')}</ol>
      <div class="reg-news" id="reg-news"></div>
      <p class="fuel-note">${T('Chaque date est vérifiée sur sa source. Les événements apparaissent aussi sur les graphiques qu’ils concernent : en encadré pour les plus importants quand la place le permet, en pointillés sinon. Liste mise à jour au ', 'Each date is checked against its source. Events also show on the charts they concern: as a framed block for the most important ones when there is room, as dashed lines otherwise. List updated on ')}${esc(j.updated)}.</p>`;
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
  // Like RTE's charts: the most important events of the window get a framed block above the plot (its short label and
  // date, in the colour of its kind) with a line down to its date; the others a small flag. Blocks only when the chart
  // is large enough (≥ 600 × 220 px), never overlapping: what does not fit stays a flag. Hover: the full title;
  // click: the event on its page.
  const BLOCK_H = 33, ROWS = 2, GAP = 6;
  function idxOf(ch, date) {   // where a date falls on a category axis of ISO dates or months (before the scales exist)
    const labels = ch.data.labels || []; if (labels.length < 3) return null;
    const iso = String(labels[0]), mon = /^\d{4}-\d{2}$/.test(iso); if (!/^\d{4}-\d{2}/.test(iso)) return null;
    const key = mon ? date.slice(0, 7) : date;
    if (key < String(labels[0]).slice(0, key.length) || key > String(labels[labels.length - 1]).slice(0, key.length)) return null;
    for (let i = 0; i < labels.length; i++) if (String(labels[i]).slice(0, key.length) >= key) return i;
    return null;
  }
  function xPos(ch, date) {
    const x = ch.scales && ch.scales.x; if (!x) return null;
    if (x.type === 'time' || x.type === 'timeseries') { const v = Date.parse(date + 'T00:00:00'); return v >= x.min && v <= x.max ? x.getPixelForValue(v) : null; }
    const i = idxOf(ch, date); if (i == null) return null;
    if (x.min != null && (i < x.min || i > x.max)) return null;
    return x.getPixelForValue(i);
  }
  const BLOCK_CHARTS = new Set(['bilan-prod', 'bilan-spot']);   // framed blocks only on the yearly review (the RTE-style page); elsewhere a discreet dashed line
  const eligible = ch => { const id = ch.canvas && ch.canvas.dataset.pkw, tags = id && WIDGET_TAGS[id];
    return tags && DATA && !ch.$pkRegOff ? DATA.items.filter(it => (it.tags || []).some(g => tags.includes(g))) : []; };
  const plugin = {
    id: 'pkReg',
    beforeInit(ch) {   // room above the plot for the blocks, decided once from the container's size and the dates
      const box = ch.canvas && ch.canvas.parentElement, w = box ? box.clientWidth : 0, h = box ? box.clientHeight : 0;
      const want = BLOCK_CHARTS.has(ch.canvas && ch.canvas.dataset.pkw) && w >= 420 && h >= 200 && eligible(ch).some(it => it.importance >= 2 && idxOf(ch, it.date) != null);
      ch.$pkRegBlocks = want; if (!want) return;
      const o = ch.config.options = ch.config.options || {}, l = o.layout = o.layout || {}, pd = l.padding;
      l.padding = typeof pd === 'object' && pd ? Object.assign({}, pd, { top: (pd.top || 0) + ROWS * (BLOCK_H + GAP) + 8 }) : { top: (pd || 0) + ROWS * (BLOCK_H + GAP) + 8, right: pd || 0, bottom: pd || 0, left: pd || 0 };
    },
    afterDatasetsDraw(ch) {
      const ms = eligible(ch).map(it => ({ it, x: xPos(ch, it.date) })).filter(m => m.x != null);
      ch.$pkRegMarks = ms; if (!ms.length) return;
      const a = ch.chartArea, g = ch.ctx, up = today();
      // which get a block: importance first, then the most recent; greedy rows from left to right
      const placed = [], rows = Array.from({ length: ROWS }, () => []);
      if (ch.$pkRegBlocks) {
        g.save(); g.font = '500 10.5px "Outfit", "Inter", sans-serif';
        ms.filter(m => m.it.importance >= 2).sort((p, q) => q.it.importance - p.it.importance || q.it.date.localeCompare(p.it.date)).forEach(m => {
          const txt = L(m.it.short || m.it.title), w = Math.min(190, Math.max(g.measureText(txt).width, 60) + 26);
          const x0 = Math.max(a.left, Math.min(a.right - w, m.x - w / 2));
          for (let r = 0; r < ROWS; r++) { if (rows[r].every(o => x0 + w + 4 < o[0] || x0 > o[1] + 4)) { rows[r].push([x0, x0 + w]); placed.push(Object.assign({ x0, w, r, txt }, m)); return; } }
        });
        g.restore();
      }
      g.save(); g.lineWidth = 1;
      ms.forEach(({ it, x }) => {   // the dashed line at each date, through the plot
        const fut = it.date > up, col = KC[it.kind] || '#B8C9D9';
        g.strokeStyle = fut ? 'rgba(251,191,36,.6)' : 'rgba(184,201,217,.35)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, a.top); g.lineTo(x, a.bottom); g.stroke(); g.setLineDash([]);
        if (!placed.find(p => p.it === it)) { g.fillStyle = col; g.beginPath(); g.moveTo(x - 4, a.top); g.lineTo(x + 4, a.top); g.lineTo(x, a.top + 7); g.closePath(); g.fill(); }
      });
      const top0 = a.top - ROWS * (BLOCK_H + GAP) - 4;
      placed.forEach(p => {   // the blocks, sober: a dark card, a thin neutral border, a dot of the kind's colour, a thin leader to the date
        const col = KC[p.it.kind] || '#B8C9D9', y = top0 + p.r * (BLOCK_H + GAP), cx = Math.max(p.x0 + 10, Math.min(p.x0 + p.w - 10, p.x));
        g.strokeStyle = 'rgba(184,201,217,.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, y + BLOCK_H); g.lineTo(p.x, a.top - 4); g.stroke();
        g.fillStyle = 'rgba(184,201,217,.6)'; g.beginPath(); g.moveTo(p.x - 3.5, a.top - 6); g.lineTo(p.x + 3.5, a.top - 6); g.lineTo(p.x, a.top - 1); g.closePath(); g.fill();
        g.fillStyle = 'rgba(21,32,41,.96)'; g.strokeStyle = 'rgba(184,201,217,.28)'; g.beginPath(); if (g.roundRect) g.roundRect(p.x0, y, p.w, BLOCK_H, 6); else g.rect(p.x0, y, p.w, BLOCK_H); g.fill(); g.stroke();
        g.fillStyle = col; g.beginPath(); g.arc(p.x0 + 9, y + 11, 3, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#E6EDF3'; g.textAlign = 'left'; g.font = '500 10.5px "Outfit", "Inter", sans-serif';
        let t = p.txt; while (t.length > 4 && g.measureText(t).width > p.w - 22) t = t.slice(0, -2); if (t !== p.txt) t = t.replace(/\s*\S?$/, '') + '…';
        g.fillText(t, p.x0 + 17, y + 14);
        g.fillStyle = '#7A93AB'; g.font = '9.5px "JetBrains Mono", monospace'; g.fillText(fmt(p.it).replace(/^1er |^1 /, ''), p.x0 + 17, y + 26);
      });
      ch.$pkRegPlaced = placed;
      const h = ch.$pkRegHover; if (h) {   // the event under the pointer, its full title
        g.font = '10px "JetBrains Mono", monospace';
        let txt = fmt(h.it) + ' · ' + L(h.it.title); while (txt.length > 12 && g.measureText(txt).width + 14 > a.right - a.left - 8) txt = txt.slice(0, -2);
        if (txt !== fmt(h.it) + ' · ' + L(h.it.title)) txt = txt.replace(/\s*\S?$/, '') + '…';
        const w = g.measureText(txt).width + 14, bx = Math.max(a.left + 4, Math.min(a.right - w - 4, h.x - w / 2));
        g.fillStyle = 'rgba(10,15,20,.95)'; g.strokeStyle = 'rgba(251,191,36,.6)'; g.beginPath(); g.rect(bx, a.top + 10, w, 18); g.fill(); g.stroke();
        g.fillStyle = '#E6EDF3'; g.textAlign = 'left'; g.fillText(txt, bx + 7, a.top + 23);
      }
      g.restore();
    },
    afterEvent(ch, args) {
      const e = args.event, ms = ch.$pkRegMarks; if (!ms || !ms.length || e.y == null) return;
      const a = ch.chartArea, top0 = a.top - ROWS * (BLOCK_H + GAP) - 4;
      const box = (ch.$pkRegPlaced || []).find(p => e.x >= p.x0 && e.x <= p.x0 + p.w && e.y >= top0 + p.r * (BLOCK_H + GAP) && e.y <= top0 + p.r * (BLOCK_H + GAP) + BLOCK_H);
      const near = box || (e.y >= a.top && e.y <= a.top + 40 ? ms.find(m => Math.abs(m.x - e.x) <= 6) : null);
      if (e.type === 'click' && near) { location.hash = '#intel/regulation?m=' + near.it.id; return; }
      const cur = ch.$pkRegHover && ch.$pkRegHover.it, nxt = near && near.it;
      if (cur !== nxt) { ch.$pkRegHover = near ? { it: near.it, x: near.x } : null; args.changed = true; ch.canvas.style.cursor = near ? 'pointer' : ''; }
    },
  };
  if (window.Chart && Chart.register) { try { Chart.register(plugin); } catch (_) {} }
  load();
  // the market events in the shape the comparator and Replay read (d, cat, fr, en, why): every non-regulatory event
  // and the regulatory ones of importance 3
  const CAT = { geo: 'geo', gaz: 'gas', nucleaire: 'nuclear', reseau: 'grid', meteo: 'nuclear', marche: 'gas', reg: 'reg' };
  async function marketEvents() {
    const j = await load(); if (!j) return null;
    return { categories: { geo: ['Géopolitique', 'Geopolitics'], gas: ['Gaz et marché', 'Gas and market'], nuclear: ['Nucléaire et météo', 'Nuclear and weather'], reg: ['Régulation', 'Regulation'], grid: ['Réseau', 'Grid'] },
      events: j.items.filter(it => it.date <= today() && (it.kind !== 'reg' || it.importance >= 3)).map(it => ({ d: it.date, cat: CAT[it.kind] || 'reg', fr: it.title[0], en: it.title[1], why_fr: it.text[0], why_en: it.text[1], src: it.source ? it.source[0] : '' })) };
  }
  window.PKReg = { load, render, marketEvents, WIDGET_TAGS };
})();
