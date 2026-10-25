// ════════════════════════════════════════════════════════════════════
// PK TILE WINDOW — a key-figure tile clicked opens its chart full size over the page: more history (1 month to
// all), the related series to tick, what to look at, a link to the full page. ×, Esc, a click outside or the
// browser's Back close it and the page is where it was; ← → go to the next tile of the same strip.
//   PKTile.open(def, { push, list })   def = { name, unit, dp, inv, pct, chip, route, page, series, why }
//        series: [[id, label, colour, axis 'y'|'y2', shownAtFirst, points [[iso date, value]], 'bar'?]]
//   PKTile.rule(pageId, test, build)   a tile of that page (test: its English label → true, or a function
//        of the element) opens build(el) → def (or a promise of it); tiles without a rule stay as they are
//   PKTile.data                         the shared history files (commodities, day-ahead summary, forwards)
// Today's tiles (js/morning.js) and the market pages' tiles use the same window.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const fr = () => !window.PKI18n || PKI18n.lang !== 'en';
  const T = (a, b) => fr() ? a : b;
  const N = (v, d) => v == null || !isFinite(v) ? '–' : v.toFixed(d);   // js/i18n.js writes the French form
  const S = (v, d) => v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '−') + N(Math.abs(v), d);
  const add = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const day = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(fr() ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const last = pts => pts && pts.length ? pts[pts.length - 1] : null;
  const back = (pts, days) => { const l = last(pts); if (!l) return null; const k = add(l[0], -days); let v = null; for (const [d, x] of pts) { if (d <= k) v = x; else break; } return v; };

  // ── the window ─────────────────────────────────────────────────────
  let cur = null;   // { def, range, on, list, idx }
  const css = document.createElement('style');
  css.textContent = `
  #pk-tw{position:fixed;inset:0;z-index:2000;background:rgba(0,8,16,.72);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:16px}
  #pk-tw[hidden]{display:none}
  html.pk-tw-open{overflow:hidden}
  .pk-tw{width:min(1600px,94vw);max-height:calc(100vh - 32px);overflow:auto;background:var(--bg2);border:1px solid var(--border2);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:18px 24px 16px;display:flex;flex-direction:column;gap:12px;font-size:14px}
  .pk-tw-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  .pk-tw-n{font-size:13px;color:var(--text3)} .pk-tw-v{font:600 32px 'Outfit',sans-serif;color:var(--text);display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums} .pk-tw-v small{font:500 13px Inter,sans-serif;color:var(--text3);margin-left:-4px}
  .pk-tw-x{background:none;border:1px solid var(--border2);color:var(--text2);border-radius:8px;width:34px;height:34px;font-size:18px;cursor:pointer;flex:none} .pk-tw-x:hover{border-color:var(--accent);color:var(--text)}
  .pk-tw-chg{display:flex;gap:8px;flex-wrap:wrap} .pk-tw-chg span{font:600 13px 'JetBrains Mono',monospace;color:var(--text);border:1px solid var(--border);border-radius:6px;padding:3px 8px}
  .pk-tw-chg span i{font:500 11px Inter,sans-serif;font-style:normal;color:var(--text3);margin-right:6px} .pk-tw-chg .pk-tw-up{color:var(--down)} .pk-tw-chg .pk-tw-dn{color:var(--up)}
  .pk-tw-ctl{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}
  .pk-tw-rng{display:flex;gap:4px} .pk-tw-rng button{font:500 13px Inter,sans-serif;background:var(--bg3);color:var(--text3);border:1px solid var(--border2);border-radius:999px;padding:3px 11px;cursor:pointer} .pk-tw-rng button.on{color:var(--accent);border-color:var(--accent)}
  .pk-tw-ser{display:flex;gap:6px;flex-wrap:wrap} .pk-tw-ser label{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text2);border:1px solid var(--border);border-radius:999px;padding:3px 10px;cursor:pointer} .pk-tw-ser i{width:12px;height:3px;border-radius:2px;display:inline-block}
  .pk-tw-cw{position:relative}
  .pk-tw-why{font-size:14px;color:var(--text2);border-top:1px solid var(--border);padding-top:10px}
  .pk-tw-f{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--text3)} .pk-tw-f a{color:var(--accent);text-decoration:none;font-weight:600}
  .pk-tw-f kbd{font:500 11px 'JetBrains Mono',monospace;border:1px solid var(--border2);border-radius:4px;padding:0 5px;color:var(--text2)}
  .pk-tw-tile{cursor:pointer}
  .kpi-card.pk-tw-tile:hover,.kpi-card.pk-tw-tile:focus-visible{border-color:var(--border3);outline:none}
  @media (max-width:640px){#pk-tw{padding:8px}.pk-tw{width:100%;padding:12px}.pk-tw-f span{display:none}}`;
  document.head.appendChild(css);

  function el() {
    let ov = document.getElementById('pk-tw'); if (ov) return ov;
    ov = document.createElement('div'); ov.id = 'pk-tw'; ov.hidden = true;
    ov.innerHTML = `<div class="pk-tw" role="dialog" aria-modal="true" aria-labelledby="pk-tw-n"><div class="pk-tw-h"><div><div class="pk-tw-n" id="pk-tw-n"></div><div class="pk-tw-v" id="pk-tw-v"></div></div><button type="button" class="pk-tw-x" id="pk-tw-x">×</button></div>
      <div class="pk-tw-chg" id="pk-tw-chg"></div><div class="pk-tw-ctl"><div class="pk-tw-rng" id="pk-tw-rng"></div><div class="pk-tw-ser" id="pk-tw-ser"></div></div>
      <div class="pk-tw-cw"><canvas id="pk-tw-chart"></canvas></div><div class="pk-tw-why" id="pk-tw-why"></div><div class="pk-tw-f"><span id="pk-tw-keys"></span><a href="#" id="pk-tw-full"></a></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#pk-tw-x').addEventListener('click', () => close());
    ov.querySelector('#pk-tw-rng').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; cur.range = b.dataset.r; draw(); });
    ov.querySelector('#pk-tw-ser').addEventListener('change', e => { const c = e.target.closest('[data-s]'); if (!c) return; cur.on[c.dataset.s] = c.checked; draw(); });
    ov.querySelector('#pk-tw-full').addEventListener('click', e => { e.preventDefault(); close(cur.def.route); });
    return ov;
  }

  function open(def, opt) {
    opt = opt || {};
    const main = def && def.series.find(x => x[4] && x[5] && x[5].length);
    if (!main) return false;
    const prev = cur, ov = el();
    cur = { def, range: prev ? prev.range : (def.range || '1Y'), on: Object.fromEntries(def.series.map(x => [x[0], x[4]])), list: opt.list || (prev && prev.list) || null, idx: opt.idx != null ? opt.idx : prev ? prev.idx : 0 };
    const s = (def.mainId ? def.series.find(x => x[0] === def.mainId) : main)[5], l = last(s), pct = def.pct !== false, dp = def.dp == null ? 1 : def.dp;
    ov.querySelector('#pk-tw-n').textContent = def.name + ' · ' + T('dernière valeur ', 'last value ') + day(l[0]);
    ov.querySelector('#pk-tw-v').innerHTML = `${N(l[1], dp)}<small>${def.unit || ''}</small> ${def.chip || ''}`;
    // moves over a week, a month, a year (in % for a price, in its unit for hours, counts, spreads and margins), 12-month range
    const chg = [[T('1 sem.', '1 wk'), 7], [T('1 mois', '1 month'), 30], [T('1 an', '1 year'), 365]].map(([lab, d]) => {
      const b = back(s, d); if (b == null || (pct && !b)) return '';
      const c = pct ? (l[1] / b - 1) * 100 : l[1] - b, tn = Math.abs(c) < (pct ? .5 : 1e-9) ? '' : (c > 0) !== !!def.inv ? 'pk-tw-up' : 'pk-tw-dn';
      return `<span class="${def.neutral ? '' : tn}"><i>${lab}</i>${pct ? S(c, 1) + ' %' : S(c, dp) + (def.unit ? ' ' + def.unit : '')}</span>`; });
    const y1 = s.filter(p => p[0] >= add(l[0], -365)).map(p => p[1]).filter(v => v != null);
    if (y1.length > 2) chg.push(`<span><i>${T('12 mois', '12 months')}</i>min ${N(Math.min(...y1), dp)} · max ${N(Math.max(...y1), dp)}${pct ? '' : ' · ' + T('moy. ', 'avg ') + N(y1.reduce((a, b) => a + b, 0) / y1.length, dp)}</span>`);
    ov.querySelector('#pk-tw-chg').innerHTML = chg.join('');
    ov.querySelector('#pk-tw-ser').innerHTML = def.series.length > 1 ? def.series.filter(x => x[5] && x[5].length).map(([sid, lab, col]) => `<label><input type="checkbox" data-s="${sid}" ${cur.on[sid] ? 'checked' : ''}><i style="background:${col}"></i>${lab}</label>`).join('') : '';
    let why = def.why;
    if (why == null && y1.length > 2) {   // what to look at, from the numbers: where the value sits in its year, its yearly move
      const lo = Math.min(...y1), hi = Math.max(...y1), at = (l[1] - lo) / ((hi - lo) || 1), b = back(s, 365);
      why = (at > .9 ? T('Près du plus haut des 12 derniers mois', 'Near its 12-month high') : at < .1 ? T('Près du plus bas des 12 derniers mois', 'Near its 12-month low') : T('Dans sa fourchette des 12 derniers mois', 'Within its 12-month range')) +
        (b != null && (pct ? b : true) ? (pct ? T(` ; ${S((l[1] / b - 1) * 100, 0)} % sur un an.`, `; ${S((l[1] / b - 1) * 100, 0)} % on a year.`) : T(` ; ${S(l[1] - b, dp)} ${def.unit || ''} sur un an.`, `; ${S(l[1] - b, dp)} ${def.unit || ''} on a year.`)) : '.');
      if (def.whyMore) why += ' ' + def.whyMore;
    }
    ov.querySelector('#pk-tw-why').textContent = why || '';
    ov.querySelector('#pk-tw-keys').innerHTML = T('Fermer : <kbd>×</kbd> <kbd>Échap</kbd>, un clic à côté ou le bouton retour', 'Close: <kbd>×</kbd> <kbd>Esc</kbd>, a click outside or Back') + (cur.list && cur.list.length > 1 ? T(' · <kbd>←</kbd> <kbd>→</kbd> tuile précédente / suivante', ' · <kbd>←</kbd> <kbd>→</kbd> previous / next tile') : '');
    const full = ov.querySelector('#pk-tw-full'); full.hidden = !def.route; full.textContent = def.route ? T('Page complète : ', 'Full page: ') + (def.page || '') + ' ›' : '';
    ov.querySelector('#pk-tw-x').setAttribute('aria-label', T('Fermer', 'Close'));
    const wasHidden = ov.hidden; ov.hidden = false; document.documentElement.classList.add('pk-tw-open');
    if (opt.push !== false && wasHidden) history.pushState(Object.assign({}, history.state, { pkTile: 1 }), '', location.href);
    if (wasHidden) cur.opener = opt.opener || document.activeElement;
    else if (prev) cur.opener = prev.opener;
    draw();
    if (wasHidden) ov.querySelector('#pk-tw-x').focus();
    return true;
  }

  function draw() {
    const def = cur.def, list = def.series.filter(x => cur.on[x[0]] && x[5] && x[5].length);
    document.getElementById('pk-tw-rng').innerHTML = [['1M', T('1 mois', '1 month')], ['6M', T('6 mois', '6 months')], ['1Y', T('1 an', '1 year')], ['3Y', T('3 ans', '3 years')], ['ALL', T('Tout', 'All')]]
      .map(([r, l]) => `<button type="button" data-r="${r}" class="${cur.range === r ? 'on' : ''}">${l}</button>`).join('');
    if (!list.length || !window._fuelChart) return;
    const end = list.map(x => last(x[5])[0]).sort().pop(), from = add(end, -({ '1M': 31, '6M': 183, '1Y': 366, '3Y': 1096, ALL: 99999 }[cur.range]));
    const dates = [...new Set(list.flatMap(x => x[5].filter(p => p[0] >= from).map(p => p[0])))].sort();
    const ds = list.map(([sid, lab, col, ax, , pts, kind]) => { const m = new Map(pts), data = dates.map(d => m.has(d) && m.get(d) != null ? Math.round(m.get(d) * 1000) / 1000 : null);
      if (kind === 'bar') return { type: 'bar', label: lab, data, backgroundColor: col, borderWidth: 0, yAxisID: ax, order: 5 };
      return _fuelLineDs(lab, data, col, { borderWidth: sid === list[0][0] ? 2.2 : 1.6, spanGaps: true, yAxisID: ax, pointRadius: pts.length < 120 ? 2 : 0, borderDash: ax === 'y2' || /fc|avg5|roll/.test(sid) ? [5, 4] : [] }); });
    const y2 = list.some(x => x[3] === 'y2');
    const fmt = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString(fr() ? 'fr-FR' : 'en-GB', cur.range === '1M' || cur.range === '6M' ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { month: 'short', year: '2-digit', timeZone: 'UTC' }) : '';
    // the shared chart maker sizes a canvas from its own style (220 px when unset): give it the window's height, which follows the screen
    const cw = document.querySelector('.pk-tw-cw'), cv = document.getElementById('pk-tw-chart'), small = innerWidth < 640;
    const hpx = Math.round(Math.min(small ? 420 : 760, Math.max(small ? 240 : 300, innerHeight * (small ? .45 : .58)))) + 'px';
    cw.style.height = cw.style.maxHeight = hpx; cv.style.height = hpx;
    cv.dataset.fsTitle = def.name + (def.unit ? ' (' + def.unit + ')' : '');   // the big view's title
    _fuelChart('pk-tw-chart', { type: 'line', data: { labels: dates, datasets: ds }, options: _fuelOpts({ interaction: { mode: 'index', intersect: false },
      scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: innerWidth > 1600 ? 12.5 : 11 }, maxTicksLimit: innerWidth > 1600 ? 12 : 8, maxRotation: 0, callback: (v, i) => fmt(dates[i]) } }), y: _fuelAxis(def.unit || '', def.yZero ? { beginAtZero: true } : {}),
        y2: _fuelAxis(def.unit2 || '', { position: 'right', display: y2, grid: { display: false } }) },
      plugins: { legend: { display: false }, zoom: typeof ZOOM_CFG !== 'undefined' ? ZOOM_CFG : undefined } }) }, 'tile-' + (def.file || 'chart'));
  }

  let skipPop = false, afterPop = null;
  // then: a page to open once the window's history entry is gone (the « Full page » link)
  function close(then) {
    const ov = document.getElementById('pk-tw'); if (!ov || ov.hidden) return;
    ov.hidden = true; document.documentElement.classList.remove('pk-tw-open');
    const opener = cur && cur.opener; cur = null;
    if (history.state && history.state.pkTile) { skipPop = true; afterPop = then || null; history.back(); }
    else if (then && window.PKNav) PKNav.go(then);
    if (opener && !then && opener.focus) opener.focus();
  }
  // Back closes the window and nothing else (capture: before the menu's own handler would show the page again)
  window.addEventListener('popstate', e => {
    if (skipPop) { skipPop = false; e.stopImmediatePropagation(); const r = afterPop; afterPop = null; if (r && window.PKNav) setTimeout(() => PKNav.go(r), 0); return; }
    const ov = document.getElementById('pk-tw');
    if (ov && !ov.hidden) { ov.hidden = true; document.documentElement.classList.remove('pk-tw-open'); cur = null; e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('keydown', e => {
    const ov = document.getElementById('pk-tw'); if (!ov || ov.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && cur.list && cur.list.length > 1 && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
      e.preventDefault();
      const n = cur.list.length; let i = cur.idx;
      const step = async () => { for (let k = 0; k < n; k++) { i = (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n; const d = await cur.list[i](); if (d && open(d, { push: false, idx: i })) return; } };
      step();
    }
  });

  // ── the shared history files ───────────────────────────────────────
  const cache = {};
  const get = (k, f) => cache[k] || (cache[k] = f().catch(() => null));
  const json = p => fetch(DATA_BASE + p).then(r => r.ok ? r.json() : null);
  const data = {
    cs: () => get('cs', () => json('history/commodities_series.json')),
    chain: () => get('chain', () => json('history/fr_market_calchain.json')),
    summary: () => get('sum', () => window.pkSummary ? window.pkSummary() : json('history/summary.json')),
    async series(key) { const c = await data.cs(); return (c && c.series && c.series[key] && c.series[key].points) || []; },
    async zone(z, field) { const s = await data.summary(); return ((s && s.zones && s.zones[z]) || []).filter(r => r[field] != null).map(r => [r.d, r[field]]); },
    // one value per day across every zone of the summary: f(rows of that day) → value
    async across(f) {
      const s = await data.summary(); if (!s || !s.zones) return [];
      const by = new Map(); Object.entries(s.zones).forEach(([z, rows]) => rows.forEach(r => { if (!by.has(r.d)) by.set(r.d, []); by.get(r.d).push(Object.assign({ z }, r)); }));
      return [...by.keys()].sort().map(d => [d, f(by.get(d))]).filter(p => p[1] != null && isFinite(p[1]));
    },
    async cal(cc) { const c = await data.chain(); const y = c && c[cc] && c[cc].years; return y ? Object.keys(y).sort().slice(0, 3).map(k => ({ y: k, pts: y[k].dates.map((d, i) => [d, y[k].values[i]]) })) : []; },
    // a daily series combined with market prices of the same day (the last close on or before it)
    asof(pts) { const a = pts.slice().sort((x, y) => x[0] < y[0] ? -1 : 1); return d => { let lo = 0, hi = a.length - 1, v = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m][0] <= d) { v = a[m][1]; lo = m + 1; } else hi = m - 1; } return v; }; },
  };

  // ── which tiles open what ──────────────────────────────────────────
  const RULES = [];
  function rule(page, test, build) { RULES.push({ page, test, build }); }
  const TILE_SEL = '.kpi-card';
  const label = card => { const l = card.querySelector('.kpi-label'); const t = l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; const en = window.pkEN ? pkEN(t) : null; return (en || t).replace(/^[\u{1F1E6}-\u{1F1FF}\s]+/u, '').trim(); };
  function find(card) {
    const pg = card.closest('.page'); if (!pg) return null;
    const id = pg.id.replace(/^page-/, ''), lab = label(card);
    return RULES.find(r => r.page === id && (typeof r.test === 'function' ? r.test(card, lab) : r.test instanceof RegExp ? r.test.test(lab) : r.test === lab)) || null;
  }
  // the strip a tile belongs to: its siblings with a rule (← → walk through them)
  function strip(card) {
    const box = card.parentElement; if (!box) return [card];
    return [...box.querySelectorAll(':scope > ' + TILE_SEL)].filter(c => c.getBoundingClientRect().width && find(c));
  }
  async function openCard(card, push) {
    const r = find(card); if (!r) return false;
    const sibs = strip(card), idx = Math.max(0, sibs.indexOf(card));
    const list = sibs.map(c => async () => { const rr = find(c); if (!rr) return null; const d = await rr.build(c, label(c)); if (d && !d.name) d.name = (c.querySelector('.kpi-label') || {}).textContent || ''; return d; });
    const def = await list[idx]();
    return def ? open(def, { push, list, idx, opener: card }) : false;
  }
  // a hovered tile with a rule shows it can be clicked
  document.addEventListener('pointerover', e => {
    const c = e.target.closest && e.target.closest(TILE_SEL); if (!c || c.dataset.twChecked) return;
    c.dataset.twChecked = '1'; if (find(c)) { c.classList.add('pk-tw-tile'); c.tabIndex = 0; c.title = c.title || T('Clic : le graphique en grand', 'Click: the chart full size'); }
  });
  document.addEventListener('click', e => {
    const c = e.target.closest && e.target.closest(TILE_SEL);
    if (!c || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('a,button,select,input')) return;
    if (!find(c)) return;
    e.preventDefault(); openCard(c, true);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('pk-tw-tile')) { e.preventDefault(); openCard(e.target, true); } });

  window.PKTile = { open, close, rule, data, T, N };
})();
