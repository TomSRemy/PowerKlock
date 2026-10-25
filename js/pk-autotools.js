// ════════════════════════════════════════════════════════════════════
// Chart tools everywhere (chart audit, 2026-10-22)
//   · fullscreen on every drawn chart card that has none
//   · period buttons (1Y / 3Y / All, or 3M / 1Y / All) on long time series
//     that have no period control of their own (card, section or page):
//     they zoom the x axis, the data stays whole
// Runs every 2.5 s on the visible page only; charts redrawn by their page
// keep the window picked.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const TIME_CTL = /(\b1M\b|\b3M\b|\b6M\b|\b1Y\b|\b2Y\b|\b3Y\b|\b5Y\b|\b7D\b|\b30D\b|YTD|\bAll\b|period|from|range|history|depth|since|window|\b20\d\d\b)/i;
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const picked = {};      // canvas id → window
  const done = new WeakMap();

  // a label → a date (or null): 2026-10-21 · 2026-10 · Oct 2026 · Oct 26
  function toDate(l) {
    if (l == null) return null;
    if (l instanceof Date) return l;
    const s = String(l).trim();
    let m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1)));
    m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4}|\d{2})$/.exec(s);
    if (m && MON[m[1].toLowerCase()] != null) return new Date(Date.UTC(m[2].length === 2 ? 2000 + +m[2] : +m[2], MON[m[1].toLowerCase()], 1));
    return null;
  }
  const ctlText = el => el ? [...el.querySelectorAll('button, select, input')].filter(x => !x.classList.contains('pk-tool') && !x.classList.contains('pkw-star') && !x.closest('.pk-auto-period')).map(x => x.tagName === 'SELECT' ? [...x.options].map(o => o.text).join(' ') : (x.type === 'date' || x.type === 'month' ? 'from' : x.textContent || '')).join(' ') : '';

  function hasPeriodControl(card, canvas) {
    const sec = canvas.closest('.hist-section'), panel = canvas.closest('.subdomain-panel, .page');
    const bits = [card.querySelector('.fuel-card-head, .chart-header, .chart-controls'), sec && sec.querySelector('.pk-sec-controls, .hist-section-header'),
      canvas.closest('.tab-panel') && canvas.closest('.tab-panel').querySelector('.pk-sec-controls, .pr-tabs-bar-filters'), panel && panel.querySelector('.pr-tabs-bar-filters')];
    return bits.some(b => TIME_CTL.test(ctlText(b)));
  }

  function applyWindow(ch, cid) {
    const w = picked[cid];
    const labels = ch.data.labels || [];
    if (!w || w === 'all') { if (ch.options.scales.x) { delete ch.options.scales.x.min; delete ch.options.scales.x.max; } ch.update('none'); return; }
    const last = toDate(labels[labels.length - 1]); if (!last) return;
    const from = new Date(last); from.setUTCMonth(from.getUTCMonth() - { '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '3Y': 36 }[w]);
    const i = labels.findIndex(l => { const d = toDate(l); return d && d >= from; });
    if (i < 0) return;
    ch.options.scales.x = Object.assign(ch.options.scales.x || {}, { min: labels[i], max: labels[labels.length - 1] });
    ch.update('none');
  }

  function periodPills(card, canvas, ch) {
    const head = card.querySelector('.fuel-card-head, .chart-header'); if (!head) return;
    const labels = ch.data.labels || [];
    const a = toDate(labels[0]), b = toDate(labels[labels.length - 1]);
    if (!a || !b) return;
    const years = (b - a) / 3.156e10;
    if (years < 1.4) return;                          // short series: nothing to zoom
    const opts = years > 3.5 ? ['3M', '6M', '1Y', '2Y', '3Y', 'all'] : ['3M', '6M', '1Y', '2Y', 'all'];
    let g = head.querySelector('.pk-auto-period');
    if (!g) {
      g = document.createElement('div'); g.className = 'pk-gf-group pk-auto-period'; g.title = 'Zoom the time axis (the data stays whole)';
      const star = head.querySelector('.pkw-star, .source-badge'); head.insertBefore(g, star || null);
      g.innerHTML = opts.map(o => `<button type="button" class="pk-gf-btn${(picked[canvas.id] || 'all') === o ? ' active' : ''}" data-v="${o}">${o === 'all' ? 'All' : o}</button>`).join('');
      g.querySelectorAll('button').forEach(bt => bt.addEventListener('click', ev => {
        ev.stopPropagation();
        picked[canvas.id] = bt.dataset.v;
        g.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === bt));
        const c = window.Chart && Chart.getChart(document.getElementById(canvas.id)); if (c) applyWindow(c, canvas.id);
      }));
    }
  }

  function scan() {
    const page = document.querySelector('.page.active'); if (!page || !window.Chart) return;
    page.querySelectorAll('canvas[id]').forEach(canvas => {
      if (canvas.offsetParent === null || canvas.closest('.pkd-item')) return;
      const ch = Chart.getChart(canvas); if (!ch) return;
      const card = canvas.closest('.chart-container, .fuel-card'); if (!card) return;
      if (!card.querySelector('.pk-tool-fs') && typeof addFullscreen === 'function') { delete canvas.dataset.fsAdded; addFullscreen(canvas.id); }
      if (done.get(canvas) === ch) return;             // this chart instance already handled
      done.set(canvas, ch);
      const labels = ch.data.labels || [];
      if (['line', 'bar'].includes(ch.config.type) && labels.length >= 60 && toDate(labels[0]) && !card.querySelector('.pkw-period') &&
          (card.querySelector('.pk-auto-period') || !hasPeriodControl(card, canvas))) {
        periodPills(card, canvas, ch);
        if (picked[canvas.id] && picked[canvas.id] !== 'all') applyWindow(ch, canvas.id);
      }
    });
  }
  window.addEventListener('load', () => setInterval(scan, 2500));
  window.PKAutoTools = { scan };
})();
