// ════════════════════════════════════════════════════════════════════
// compare.js · Tools › Comparator
// ────────────────────────────────────────────────────────────────────
// Any daily series of the site on one chart, the best way to show it chosen
// for the reader (one axis, two axes or base 100; lines, monthly bars or an
// X–Y scatter), and what moves together: a correlation matrix, the series
// that fit one best, leads and lags, the correlation over time.
// Correlations are measured on DAY-TO-DAY CHANGES: on levels, anything that
// rises over the same months looks related.
// Series load lazily, each from the file the site already uses.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const LS = 'pk-compare';
  const COLORS = ['#14D3A9', '#F5A524', '#B794F6', '#7FC8F8', '#ED6965', '#94D2BD', '#FBBF24', '#E879F9'];
  const T = (fr, en) => (typeof _mT === 'function' ? _mT(fr, en) : en);
  const N = (v, d) => (typeof _mN === 'function' ? _mN(v, d) : v == null ? '–' : v.toFixed(d));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cache = {};
  const json = (k, path) => cache[k] || (cache[k] = fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => { delete cache[k]; return null; }));
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const back = (iso, days) => new Date(Date.parse(iso) - days * 864e5).toISOString().slice(0, 10);

  // ── the catalogue: id → { label, group, unit, load() → Map(date → value) } ──
  const CAT = new Map();
  const add = (id, label, group, unit, load) => CAT.set(id, { id, label, group, unit, load });
  const G = { expr: ['Vos formules', 'Your formulas'], spot: ['Électricité · spot', 'Power · spot'], fwd: ['Électricité · forwards', 'Power · forwards'], fuel: ['Gaz, carbone, pétrole, change', 'Gas, carbon, oil, FX'],
    sys: ['Système France', 'France system'], ren: ['Renouvelables et PPA', 'Renewables and PPA'], bal: ['Équilibrage', 'Balancing'] };
  const ZN = { FR: 'France', DE_LU: 'Germany', BE: 'Belgium', NL: 'Netherlands', ES: 'Spain', PT: 'Portugal', IT_NORD: 'Italy North', CH: 'Switzerland', AT: 'Austria', PL: 'Poland' };
  Object.entries(ZN).forEach(([z, n]) => add('spot:' + z, 'Spot ' + n, 'spot', '€/MWh', async () => {
    const s = window.pkSummary ? await window.pkSummary().catch(() => null) : null;
    return new Map(((s && s.zones && s.zones[z]) || []).filter(r => r.avg != null).map(r => [r.d, r.avg]));
  }));
  const FC = { FR: 'France', DE: 'Germany', NL: 'Netherlands', UK: 'Great Britain' };
  Object.entries(FC).forEach(([c, n]) => {
    ['M+1', 'Q+1', 'S+1', 'Y+1', 'Y+2', 'Y+3'].forEach(t => add(`fwd:${c}:${t}`, `${n} ${t} (rolling)`, 'fwd', c === 'UK' ? '£/MWh' : '€/MWh', async () => {
      const s = await json('fms', 'history/fr_market_series.json'), a = s && s.countries && s.countries[c] && s.countries[c].forwardCurve && s.countries[c].forwardCurve[t];
      return new Map((a || []).map((v, i) => [s.dates[i], v]).filter(x => x[1] != null));
    }));
  });
  // dated Cal contracts: the next three years of each market (same as the forward pages)
  const y0 = +today().slice(0, 4);
  Object.entries(FC).forEach(([c, n]) => [1, 2, 3].forEach(k => add(`cal:${c}:${y0 + k}`, `${n} Cal ${String(y0 + k).slice(2)}`, 'fwd', c === 'UK' ? '£/MWh' : '€/MWh', async () => {
    const ch = await json('chain', 'history/fr_market_calchain.json'), y = ch && ch[c] && ch[c].years && ch[c].years[String(y0 + k)];
    return new Map(y ? y.dates.map((d, i) => [d, y.values[i]]).filter(x => x[1] != null) : []);
  })));
  const FUEL = [['ttf', 'Gas TTF', '€/MWh'], ['peg', 'Gas PEG', '€/MWh'], ['the', 'Gas THE', '€/MWh'], ['nbp', 'Gas NBP', 'p/th'], ['jkm', 'LNG JKM', '$/MMBtu'], ['eua', 'CO₂ EUA', '€/t'],
    ['coal', 'Coal API2', '$/t'], ['brent', 'Brent', '$/b'], ['eurusd', 'EUR/USD', '$'], ['gbpusd', 'GBP/USD', '$'], ['agsi', 'EU gas storage', '%'], ['fr_nuc_avail', 'France nuclear available', 'MW']];
  FUEL.forEach(([k, label, unit]) => add('c:' + k, label, k === 'agsi' || k === 'fr_nuc_avail' ? 'sys' : 'fuel', unit, async () => {
    const s = await json('cs', 'history/commodities_series.json'), p = s && s.series && s.series[k];
    return new Map(((p && p.points) || []).filter(x => x[1] != null));
  }));
  // France, day by day from the hourly file (RTE output, day-ahead price): load, nuclear, wind, solar, residual load, capture
  async function frDays(from) {
    const ys = []; for (let y = Math.max(2016, +from.slice(0, 4)); y <= y0; y++) ys.push(y);
    const fs = await Promise.all(ys.map(y => json('frh' + y, `history/fr_hourly/${y}.json`)));
    return Object.assign({}, ...fs.filter(Boolean).map(f => f.days || {}));
  }
  const day = (key, fn) => async from => {
    const D = await frDays(from), m = new Map();
    Object.keys(D).sort().forEach(d => { if (d < from) return; const v = fn(D[d]); if (v != null && isFinite(v)) m.set(d, v); });
    return m;
  };
  const mean = a => { const v = (a || []).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const sum = a => (a || []).reduce((s, x) => s + (x || 0), 0);
  const capt = k => v => { const p = v.p || [], q = v[k] || []; let a = 0, b = 0, n = 0, pb = 0; p.forEach((x, i) => { if (x == null) return; n++; pb += x; if (q[i]) { a += q[i] * x; b += q[i]; } }); return b > 0 && n && pb / n > 1 ? a / b / (pb / n) * 100 : null; };
  add('fr:load', 'France consumption', 'sys', 'GW', day('l', v => mean(v.l) / 1000));
  add('fr:nuc', 'France nuclear output', 'sys', 'GW', day('n', v => mean(v.n) / 1000));
  add('fr:wind', 'France wind output', 'sys', 'GWh/day', day('w', v => sum(v.w) / 1000));
  add('fr:solar', 'France solar output', 'sys', 'GWh/day', day('s', v => sum(v.s) / 1000));
  add('fr:resid', 'France residual load (load − wind − solar)', 'sys', 'GW', day('r', v => { const l = v.l || []; return mean(l.map((x, i) => x == null ? null : x - ((v.w || [])[i] || 0) - ((v.s || [])[i] || 0))) / 1000; }));
  add('fr:neg', 'France hours at 0 € or below', 'spot', 'h/day', day('neg', v => (v.p || []).filter(x => x != null && x <= 0).length));
  add('fr:cap:s', 'France solar capture rate', 'ren', '%', day('cs', capt('s')));
  add('fr:cap:w', 'France wind capture rate', 'ren', '%', day('cw', capt('w')));
  add('go:y1', 'GO renewable, next production year', 'ren', '€/MWh', async () => {
    if (typeof _mrnGoCsv !== 'function') return new Map();
    const rows = await _mrnGoCsv(), m = new Map();
    // each date: the contract of the year after (rolls on 1 January)
    [y0 - 2, y0 - 1, y0, y0 + 1].forEach(y => _mrnGoSeries(rows, 'GO AIB Renewable', y + 1).forEach(p => { if (+p.t.slice(0, 4) === y) m.set(p.t.slice(0, 10), p.mid); }));
    return m;
  });
  ['solar', 'wind'].forEach(t => add('ppa:' + t, `PPA benchmark ${t}`, 'ren', '€/MWh', async () => {
    const j = await json('bench', 'history/ppa_benchmark.json');
    return new Map(Object.entries((j && j.days) || {}).filter(([, v]) => v[t]).map(([d, v]) => [d, v[t].ppa]));
  }));
  add('imb:short', 'France imbalance price (deficit), daily mean', 'bal', '€/MWh', async from => {
    const m = new Map(); let ym = from.slice(0, 7) < '2026-08' ? '2026-08' : from.slice(0, 7);   // first month collected
    const months = []; while (ym <= today().slice(0, 7)) { months.push(ym); const [y, mm] = ym.split('-').map(Number); ym = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7); }
    const fs = await Promise.all(months.slice(-36).map(x => json('imb' + x, `history/fr_imbalance_price/${x}.json`)));
    fs.filter(Boolean).forEach(f => Object.entries(f.days || {}).forEach(([d, v]) => { const x = mean(v.short); if (x != null) m.set(d, x); }));
    return m;
  });

  // balancing energy prices (ENTSO-E A84, daily means) and the weather archive (ERA5, France, last 13 months)
  [['up', 'France mFRR activation price, up', 'France mFRR, prix d’activation à la hausse'], ['down', 'France mFRR activation price, down', 'France mFRR, prix d’activation à la baisse']].forEach(([k, l, f]) =>
    add('mfrr:' + k, l, 'bal', '€/MWh', async () => { const j = await json('act', 'history/fr_activation.json'); return new Map(Object.entries((j && j.days) || {}).filter(([, v]) => v.mfrr && v.mfrr[k] != null).map(([d, v]) => [d, v.mfrr[k]])); }));
  [['solar', 'France sunshine (ERA5)', 'W/m²'], ['wind', 'France wind speed (ERA5)', 'm/s']].forEach(([k, l, u]) =>
    add('wx:' + k, l, 'sys', u, async () => { const j = await json('wxa', 'history/weather_archive.json'), r = j && j.countries && j.countries.FR && j.countries.FR.recent && j.countries.FR.recent[k]; return new Map(r ? r.days.map((d, i) => [d, r.values[i]]).filter(x => x[1] != null) : []); }));
  // a series written as a formula of others (A, B, C… = the series on the chart when it was made), e.g. A − B, A − 2*B − C
  function addExpr(f, ids) {
    const id = 'expr:' + f + '|' + ids.join(',');
    if (CAT.has(id)) return id;
    const units = [...new Set(ids.map(x => (CAT.get(x) || {}).unit))];
    const code = f.replace(/[A-H]/g, ch => 'v[' + (ch.charCodeAt(0) - 65) + ']');
    let fn; try { fn = new Function('v', 'return ' + code + ';'); } catch (_) { return null; }   // only letters A–H, digits and + − * / ( ) . reach here (checked)
    const lbl = f.replace(/[A-H]/g, ch => { const x = ids[ch.charCodeAt(0) - 65]; return x ? '[' + label(x) + ']' : ch; });
    CAT.set(id, { id, label: lbl, group: 'expr', unit: units.length === 1 ? units[0] : '', load: async from => {
      const ms = await Promise.all(ids.map(x => series(x))), m = new Map();
      [...ms[0].keys()].forEach(d => { const v = ms.map(mm => mm.get(d)); if (v.every(x => x != null)) { const r = fn(v); if (isFinite(r)) m.set(d, r); } });
      return m;
    } });
    return id;
  }
  const FR_WORDS = [['Great Britain', 'Grande-Bretagne'], ['Germany', 'Allemagne'], ['Netherlands', 'Pays-Bas'], ['Belgium', 'Belgique'], ['Spain', 'Espagne'], ['Italy North', 'Italie Nord'],
    ['Switzerland', 'Suisse'], ['Austria', 'Autriche'], ['Poland', 'Pologne'], [' (rolling)', ' (glissant)'], ['Gas storage', 'Stocks de gaz'], ['EU gas storage', 'Stocks de gaz UE'], ['Gas ', 'Gaz '], ['LNG ', 'GNL '],
    ['Coal ', 'Charbon '], ['France nuclear available', 'Nucléaire disponible France'], ['France consumption', 'Consommation France'], ['France nuclear output', 'Production nucléaire France'],
    ['France wind output', 'Production éolienne France'], ['France solar output', 'Production solaire France'], ['France residual load (load − wind − solar)', 'Charge résiduelle France (conso − éolien − solaire)'],
    ['France hours at 0 € or below', 'Heures à 0 € ou moins, France'], ['France solar capture rate', 'Taux de capture solaire France'], ['France wind capture rate', 'Taux de capture éolien France'],
    ['GO renewable, next production year', 'GO renouvelable, année de production suivante'], ['PPA benchmark solar', 'Benchmark PPA solaire'], ['PPA benchmark wind', 'Benchmark PPA éolien'],
    ['France imbalance price (deficit), daily mean', 'Prix des écarts France (déficit), moyenne du jour'], ['France mFRR activation price, up', 'France mFRR, prix d’activation à la hausse'],
    ['France mFRR activation price, down', 'France mFRR, prix d’activation à la baisse'], ['France sunshine (ERA5)', 'Ensoleillement France (ERA5)'], ['France wind speed (ERA5)', 'Vent France (ERA5)']];
  const label = id => { const c = CAT.get(id); if (!c) return id; let l = c.label; if (T(1, 0)) FR_WORDS.forEach(([e, f]) => { l = l.split(e).join(f); }); return l; };
  // the market a series belongs to: forwards of one country and the PPA benchmark (built from the French Cal) move by construction together
  const family = id => { const m = /^(?:fwd|cal):([A-Z]+):/.exec(id); return m ? m[1] : id.startsWith('ppa:') ? 'FR' : null; };

  // ── state ──
  const S = Object.assign({ sel: ['cal:FR:' + (y0 + 1), 'c:ttf', 'c:eua'], per: '1Y', from: '', to: '', scale: 'auto', type: 'auto', q: '' }, (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (_) { return {}; } })());
  // a shared link (#tools/compare?s=…&p=…&sc=…&ty=…&f=…&t=…) wins over what this browser remembers
  // a list of series in a link or a card: ';' between series (a formula holds ',' inside); an old list with ',' still reads
  const splitSel = str => !str ? [] : str.includes(';') || !str.includes('expr:') ? str.split(str.includes(';') ? ';' : ',').filter(Boolean) : str.split(';');
  const HP = window.pkHashParams && window.pkHashRoute === 'tools/compare' ? window.pkHashParams : null;
  if (HP) { S.sel = splitSel(HP.s || ''); S.per = HP.p || S.per; S.scale = HP.sc || 'auto'; S.type = HP.ty || 'auto'; S.from = HP.f || ''; S.to = HP.t || ''; }
  (S.sel || []).forEach(id => { const m = /^expr:([A-H0-9+\-*/(). ]+)\|(.+)$/.exec(id); if (m) addExpr(m[1], m[2].split(',')); });
  S.sel = (S.sel || []).filter(id => CAT.has(id)).slice(0, 8);
  const save = () => { try { localStorage.setItem(LS, JSON.stringify({ sel: S.sel, per: S.per, scale: S.scale, type: S.type })); } catch (_) {} };
  const shareParams = () => 's=' + encodeURIComponent(S.sel.join(';')) + '&p=' + S.per + '&sc=' + S.scale + '&ty=' + S.type + (S.from ? '&f=' + S.from : '') + (S.to ? '&t=' + S.to : '');
  const rangeOf = st => {
    const to = st.to || today();
    const days = { '3M': 92, '6M': 183, '1Y': 366, '3Y': 1096, '5Y': 1827 }[st.per];
    return [st.from || (days ? back(to, days) : '2016-01-01'), to];
  };
  const range = () => rangeOf(S);
  const memo = {};
  async function series(id, st) {
    const [from] = rangeOf(st || S), k = id + '|' + (CAT.get(id).group === 'sys' || id.startsWith('fr:') || id.startsWith('imb') ? from.slice(0, 4) : '');
    if (!memo[k]) memo[k] = CAT.get(id).load(from).catch(() => new Map());
    return memo[k];
  }

  // ── maths ──
  function aligned(maps, from, to) {   // dates where every series has a value
    const ds = [...maps[0].keys()].filter(d => d >= from && d <= to && maps.every(m => m.has(d))).sort();
    return { ds, v: maps.map(m => ds.map(d => m.get(d))) };
  }
  const diffs = a => a.slice(1).map((x, i) => x - a[i]);
  function corr(a, b) {
    const n = Math.min(a.length, b.length); if (n < 20) return null;
    let sa = 0, sb = 0; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
    const ma = sa / n, mb = sb / n; let c = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; c += x * y; va += x * x; vb += y * y; }
    return va && vb ? c / Math.sqrt(va * vb) : null;
  }
  const dcorr = (m1, m2, from, to) => { const A = aligned([m1, m2], from, to); return A.ds.length > 20 ? { r: corr(diffs(A.v[0]), diffs(A.v[1])), n: A.ds.length, lvl: corr(A.v[0], A.v[1]) } : null; };
  const fmtR = r => r == null ? '–' : (r <= -0.005 ? '−' : '') + N(Math.abs(r), 2);
  const strength = r => { const a = Math.abs(r || 0); return a >= 0.7 ? T('très lié', 'tightly linked') : a >= 0.5 ? T('lié', 'linked') : a >= 0.3 ? T('un peu lié', 'loosely linked') : T('peu ou pas lié', 'little or no link'); };

  // ── auto choice: which scale and which chart ──
  function decide(units, st) {
    st = st || S;
    const u = [...new Set(units)];
    let scale = st.scale, why;
    if (scale === 'auto') {
      if (u.length === 1) { scale = 'raw'; why = T('même unité (' + u[0] + ') → un seul axe, valeurs réelles', 'one unit (' + u[0] + ') → one axis, actual values'); }
      else if (u.length === 2) { scale = 'dual'; why = T('deux unités → deux axes, valeurs réelles', 'two units → two axes, actual values'); }
      else { scale = 'multi'; why = T(u.length + ' unités → un axe par unité, valeurs réelles', u.length + ' units → one axis per unit, actual values'); }
    }
    let type = st.type;
    if (type === 'auto') { type = 'line'; why += T(' · courbes (séries quotidiennes)', ' · lines (daily series)'); }
    return { scale, type, why };
  }

  // ── build: the chart of a selection (the page and the dashboard card share it) ──
  async function build(sel, st) {
    const maps = await Promise.all(sel.map(id => series(id, st)));
    const [from, to] = rangeOf(st);
    const units = sel.map(id => CAT.get(id).unit);
    const D = decide(units, st);
    const all = [...new Set(maps.flatMap(m => [...m.keys()]))].filter(d => d >= from && d <= to).sort();
    if (!all.length) return { empty: true, why: D.why, maps, from, to };
    const raw = maps.map(m => all.map(d => m.has(d) ? m.get(d) : null));
    const first = a => a.find(x => x != null), stats = a => { const v = a.filter(x => x != null); const mu = v.reduce((s, x) => s + x, 0) / v.length; return [mu, Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / v.length) || 1]; };
    const tr = raw.map(a => {
      if (D.scale === 'b100') { const f = first(a); return a.map(x => x == null || !f ? null : x / f * 100); }
      if (D.scale === 'pct') { const f = first(a); return a.map(x => x == null || !f ? null : (x / f - 1) * 100); }
      if (D.scale === 'z') { const [mu, sd] = stats(a); return a.map(x => x == null ? null : (x - mu) / sd); }
      return a;
    });
    const yTitle = { b100: T('base 100', 'base 100'), pct: T('% depuis le début', '% since start'), z: T('écarts-types', 'standard deviations') }[D.scale] || units[0];
    const u2 = [...new Set(units)][1], UN = [...new Set(units)];
    // the value axes: one (raw, base 100…), two (dual) or one per unit (multi), each named by its unit
    const axisOf = i => D.scale === 'dual' ? (units[i] === u2 ? 'y2' : 'y') : D.scale === 'multi' ? (UN.indexOf(units[i]) ? 'y' + (UN.indexOf(units[i]) + 1) : 'y') : 'y';
    const yScales = () => D.scale === 'multi' ? Object.assign({ y: _fuelAxis(UN[0]) }, ...UN.slice(1).map((u, j) => ({ ['y' + (j + 2)]: _fuelAxis(u, { position: j % 2 ? 'left' : 'right', grid: { display: false } }) })))
      : Object.assign({ y: _fuelAxis(yTitle) }, D.scale === 'dual' ? { y2: _fuelAxis(u2, { position: 'right', grid: { display: false } }) } : {});
    let cfg, sub;
    if (D.type === 'scatter' && sel.length >= 2) {
      const A = aligned(maps.slice(0, 2), from, to);
      const pts = A.ds.map((d, i) => ({ x: A.v[0][i], y: A.v[1][i], d }));
      const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my_ = pts.reduce((s, p) => s + p.y, 0) / n;
      const b = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my_), 0) / (pts.reduce((s, p) => s + (p.x - mx) ** 2, 0) || 1), a0 = my_ - b * mx;
      const xs = pts.map(p => p.x), lo = Math.min(...xs), hi = Math.max(...xs);
      cfg = { type: 'scatter', data: { datasets: [
        { label: label(sel[1]) + ' vs ' + label(sel[0]), data: pts, backgroundColor: 'rgba(127,200,248,.55)', pointRadius: 2.5 },
        { type: 'line', label: T('Droite de régression', 'Regression line'), data: [{ x: lo, y: a0 + b * lo }, { x: hi, y: a0 + b * hi }], borderColor: '#F5A524', borderWidth: 2, pointRadius: 0 }] },
        options: _fuelOpts({ scales: { x: Object.assign(_fuelAxis(label(sel[0]) + ', ' + units[0]), { type: 'linear' }), y: _fuelAxis(label(sel[1]) + ', ' + units[1]) },
          plugins: { tooltip: { callbacks: { label: c => c.raw && c.raw.d ? c.raw.d + ' · ' + N(c.raw.x, 2) + ' / ' + N(c.raw.y, 2) : '' } } } }) };
      const r = dcorr(maps[0], maps[1], from, to);
      sub = T(`Pente : +1 ${units[0]} sur ${label(sel[0])} ↔ ${N(b, 2)} ${units[1]} sur ${label(sel[1])} · corrélation des niveaux ${fmtR(r && r.lvl)}, des variations journalières ${fmtR(r && r.r)} · ${n} jours`,
        `Slope: +1 ${units[0]} on ${label(sel[0])} ↔ ${N(b, 2)} ${units[1]} on ${label(sel[1])} · correlation of levels ${fmtR(r && r.lvl)}, of daily changes ${fmtR(r && r.r)} · ${n} days`);
    } else if (D.type === 'bar') {
      const months = [...new Set(all.map(d => d.slice(0, 7)))];
      const ds = tr.map((a, i) => ({ type: 'bar', label: label(sel[i]), data: months.map(m => mean(a.filter((x, j) => all[j].startsWith(m)))), backgroundColor: COLORS[i % 8], borderWidth: 0, yAxisID: axisOf(i) }));
      cfg = { type: 'bar', data: { labels: months, datasets: ds }, options: _fuelOpts({ scales: Object.assign({ x: _fuelXAxis() }, yScales()) }) };
      sub = T('Moyennes mensuelles', 'Monthly averages') + ' · ' + months[0] + ' → ' + months[months.length - 1];
    } else {
      const ds = tr.map((a, i) => _fuelLineDs(label(sel[i]) + (D.scale === 'raw' || D.scale === 'dual' || D.scale === 'multi' ? ' (' + units[i] + ')' : ''), a, COLORS[i % 8],
        { borderWidth: i === 0 ? 2.4 : 1.8, yAxisID: axisOf(i) }));
      cfg = { type: 'line', data: { labels: all, datasets: ds }, options: _fuelOpts({ scales: Object.assign({ x: _fuelXAxis() }, yScales()) }) };
      // headline: where each series ends against where it started
      const moves = raw.map((a, i) => { const f = first(a), l = [...a].reverse().find(x => x != null); return f && l ? label(sel[i]) + ' ' + (l / f >= 1 ? '×' + N(l / f, 2) : (l / f - 1) * 100 > -100 ? N((l / f - 1) * 100, 0) + ' %' : '') : null; }).filter(Boolean);
      sub = all[0] + ' → ' + all[all.length - 1] + ' · ' + moves.join(' · ');
    }
    // political and market events of the window (data/market_events.json): a dashed line each, numbered
    const ME = st.events !== false && D.type === 'line' ? await json('mevents', 'market_events.json') : null;
    const evs = ME && ME.events ? ME.events.filter(e => e.d >= all[0] && e.d <= all[all.length - 1]) : [];
    if (evs.length && cfg.options) {
      const ann = {};
      evs.forEach((e, i) => { const x = all.find(d => d >= e.d); if (!x) return;
        ann['ev' + i] = { type: 'line', xMin: x, xMax: x, borderColor: 'rgba(122,147,171,.7)', borderWidth: 1, borderDash: [4, 4],
          label: { display: true, content: String(i + 1), position: 'start', backgroundColor: 'rgba(122,147,171,.9)', color: '#0B1118', font: { size: 10, weight: 'bold' }, padding: { x: 5, y: 2 }, borderRadius: 8 } }; });
      cfg.options.plugins = Object.assign({}, cfg.options.plugins, { annotation: { annotations: ann } });
    }
    return { cfg, sub, why: D.why, maps, from, to, all, raw, evs, cats: ME ? ME.categories || {} : {} };
  }

  // ── render ──
  let busy = 0, LAST = null;
  async function render() {
    const host = document.getElementById('cmp-root'); if (!host) return;
    const my = ++busy;
    drawBar(); drawPicker();
    const sel = S.sel;
    const main = document.getElementById('cmp-main-sub'), note = document.getElementById('cmp-auto');
    if (!sel.length) { if (main) main.textContent = T('Choisissez une ou plusieurs séries à gauche.', 'Pick one or more series on the left.'); return; }
    if (main) main.textContent = T('Chargement…', 'Loading…');
    const B = await build(sel, S); if (my !== busy) return;
    if (note) note.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z"/></svg>' + (S.scale === 'auto' && S.type === 'auto' ? T('Choix auto : ', 'Auto: ') : '') + esc(B.why || T('votre choix', 'your choice'));
    if (B.empty) { if (main) main.textContent = T('Pas de données sur la période.', 'No data in this window.'); return; }
    if (main) main.textContent = B.sub;
    LAST = B;
    _fuelChart('cmp-chart', B.cfg, 'comparator');
    const EV = document.getElementById('cmp-events');
    if (EV) EV.innerHTML = B.evs && B.evs.length ? '<ol class="cmp-evs">' + B.evs.map(e => { const c = B.cats[e.cat] || [e.cat, e.cat];
      return `<li><span class="cmp-dates">${e.d}</span><b>${esc(T(c[0], c[1]))} · ${esc(T(e.fr, e.en))}</b><span>${esc(T(e.why_fr, e.why_en))}${e.url ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.src || 'source')}</a>` : ''}</span></li>`; }).join('') + '</ol>' : '';
    analyse(B.maps, B.from, B.to);
    watch();
  }

  // ── analyses ──
  function analyse(maps, from, to) {
    const sel = S.sel, M = document.getElementById('cmp-matrix'), L = document.getElementById('cmp-lag'), R = document.getElementById('cmp-roll');
    // matrix
    if (M) {
      if (sel.length < 2) M.innerHTML = '<p class="cmp-note">' + T('Ajoutez au moins deux séries.', 'Add at least two series.') + '</p>';
      else {
        const short = id => label(id).replace(/^(France|Germany|Netherlands|Great Britain) /, (m, c) => ({ France: 'FR ', Germany: 'DE ', Netherlands: 'NL ', 'Great Britain': 'UK ' }[c]));
        let h = `<div class="cmp-mx" style="grid-template-columns:minmax(90px,1.4fr) repeat(${sel.length},minmax(0,1fr))"><span></span>` + sel.map((id, i) => `<span class="cmp-mh" style="color:${COLORS[i % 8]}">${esc(short(id))}</span>`).join('');
        sel.forEach((a, i) => {
          h += `<span class="cmp-mr">${esc(short(a))}</span>`;
          sel.forEach((b, j) => {
            const r = i === j ? 1 : (dcorr(maps[i], maps[j], from, to) || {}).r;
            const bg = r == null ? 'transparent' : r >= 0 ? `rgba(20,211,169,${(0.08 + 0.8 * r).toFixed(2)})` : `rgba(238,155,0,${(0.15 + 0.8 * Math.abs(r)).toFixed(2)})`;
            h += `<span class="cmp-mc" style="background:${bg};color:${r != null && Math.abs(r) > 0.55 ? '#0B1118' : 'var(--text)'}" title="${esc(label(a))} / ${esc(label(b))}">${fmtR(r)}</span>`;
          });
        });
        M.innerHTML = h + '</div><p class="cmp-note">' + T('Corrélation des variations d’un jour à l’autre, sur les jours où les deux séries sont cotées. Sur les niveaux, tout ce qui monte en même temps paraît lié.', 'Correlation of day-to-day changes, on the days both series are quoted. On levels, anything rising over the same months looks related.') + '</p>';
      }
    }
    // lead / lag and rolling correlation of the first two
    if (sel.length < 2) { if (L) L.innerHTML = ''; if (R) R.innerHTML = ''; return; }
    const A = aligned(maps.slice(0, 2), from, to), da = diffs(A.v[0]), db = diffs(A.v[1]);
    if (L) {
      const lags = []; for (let k = -5; k <= 5; k++) { const a = k >= 0 ? da.slice(0, da.length - k) : da.slice(-k), b = k >= 0 ? db.slice(k) : db.slice(0, db.length + k); lags.push([k, corr(a, b)]); }
      const best = lags.reduce((m, x) => Math.abs(x[1] || 0) > Math.abs(m[1] || 0) ? x : m, [0, 0]);
      L.innerHTML = '<div class="cmp-lags">' + lags.map(([k, r]) => `<div class="cmp-lagc" title="${k} j"><span class="cmp-lagb" style="height:${Math.round(Math.abs(r || 0) * 100)}%;background:${(r || 0) >= 0 ? '#14D3A9' : '#F5A524'}${k === best[0] ? ';outline:2px solid #E6EDF3' : ''}"></span><em>${k > 0 ? '+' + k : k}</em></div>`).join('') + '</div>' +
        '<p class="cmp-note">' + (best[0] === 0 ? T(`${label(S.sel[0])} et ${label(S.sel[1])} bougent le même jour (${fmtR(best[1])}).`, `${label(S.sel[0])} and ${label(S.sel[1])} move on the same day (${fmtR(best[1])}).`)
          : best[0] > 0 ? T(`${label(S.sel[0])} précède ${label(S.sel[1])} de ${best[0]} j (${fmtR(best[1])}).`, `${label(S.sel[0])} leads ${label(S.sel[1])} by ${best[0]} d (${fmtR(best[1])}).`)
            : T(`${label(S.sel[1])} précède ${label(S.sel[0])} de ${-best[0]} j (${fmtR(best[1])}).`, `${label(S.sel[1])} leads ${label(S.sel[0])} by ${-best[0]} d (${fmtR(best[1])}).`)) +
        T(' Barres : corrélation avec un décalage de −5 à +5 jours de cotation.', ' Bars: correlation with a shift of −5 to +5 trading days.') + '</p>';
    }
    if (R) {
      const w = 60, pts = []; for (let i = w; i <= da.length; i += 5) pts.push([A.ds[i], corr(da.slice(i - w, i), db.slice(i - w, i))]);
      if (pts.length < 2) { R.innerHTML = '<p class="cmp-note">' + T('Période trop courte pour une corrélation glissante sur 60 jours.', 'Window too short for a 60-day rolling correlation.') + '</p>'; return; }
      R.innerHTML = '<div style="position:relative;height:150px"><canvas id="cmp-roll-c"></canvas></div>';
      _fuelChart('cmp-roll-c', { type: 'line', data: { labels: pts.map(p => p[0]), datasets: [_fuelLineDs(T('Corrélation sur 60 jours', '60-day correlation'), pts.map(p => p[1] == null ? null : Math.round(p[1] * 100) / 100), '#14D3A9', { fill: true })] },
        options: _fuelOpts({ plugins: { legend: { display: false } }, scales: { x: _fuelXAxis(), y: _fuelAxis('', { min: -1, max: 1 }) } }) }, 'rolling-correlation');
      const f = pts.find(p => p[1] != null), l = [...pts].reverse().find(p => p[1] != null);
      R.insertAdjacentHTML('beforeend', '<p class="cmp-note">' + T(`Corrélation des variations sur 60 jours glissants : ${fmtR(f[1])} → ${fmtR(l[1])}. `, `Correlation of changes over a rolling 60 days: ${fmtR(f[1])} → ${fmtR(l[1])}. `) +
        (l[1] - f[1] > 0.15 ? T('Le lien se resserre.', 'The link is tightening.') : f[1] - l[1] > 0.15 ? T('Le lien se relâche.', 'The link is loosening.') : T('Le lien est stable.', 'The link is steady.')) + '</p>');
    }
  }

  // "what fits X best": every series of the catalogue against the first one
  async function rank() {
    const host = document.getElementById('cmp-rank'); if (!host || !S.sel.length) return;
    const x = S.sel[0], [from, to] = range();
    host.innerHTML = '<p class="cmp-note">' + T('Calcul sur tout le catalogue…', 'Going through the whole catalogue…') + '</p>';
    const fx = family(x), same = S.rankSame;
    const ids = [...CAT.keys()].filter(id => id !== x && (same || !fx || family(id) !== fx));
    const mx = await series(x), res = [];
    for (const id of ids) { const r = dcorr(mx, await series(id), from, to); if (r && r.r != null) res.push([id, r.r, r.n]); }
    // the same contract under another name (Y+1 rolling and the Cal it points to) says nothing: leave out |r| > 0.97
    res.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const seen = {}, top = res.filter(r => Math.abs(r[1]) < 0.97).filter(r => { const f = family(r[0]); if (!f) return true; seen[f] = (seen[f] || 0) + 1; return seen[f] <= 2; }).slice(0, 10);   // 2 products a market at most
    host.innerHTML = top.map(([id, r, n]) => `<button type="button" class="cmp-rk" data-add="${id}" title="${T('Ajouter au graphique', 'Add to the chart')} · ${n} ${T('jours', 'days')}"><span>${esc(label(id))}</span><span class="cmp-rkb"><i style="width:${Math.round(Math.abs(r) * 100)}%;background:${r >= 0 ? '#14D3A9' : '#F5A524'}"></i></span><b>${fmtR(r)}</b></button>`).join('') +
      `<label class="cmp-it" style="margin-top:6px"><input type="checkbox" id="cmp-rank-same"${S.rankSame ? ' checked' : ''}><span>${T('Inclure les produits du même marché (forwards du même pays, benchmark PPA)', 'Include products of the same market (same-country forwards, PPA benchmark)')}</span></label>` +
      (top.length ? '<p class="cmp-note">' + T(`${label(x)} : la plus liée est ${label(top[0][0])} (${fmtR(top[0][1])}, ${strength(top[0][1])}). Un clic ajoute la série au graphique.`, `${label(x)}: the closest is ${label(top[0][0])} (${fmtR(top[0][1])}, ${strength(top[0][1])}). A click adds the series to the chart.`) + '</p>' : '<p class="cmp-note">–</p>');
  }

  // ── controls ──
  function pill(group, v, txt, on) { return `<button type="button" class="cmp-pill${on ? ' on' : ''}" data-${group}="${v}">${txt}</button>`; }
  function drawBar() {
    const b = document.getElementById('cmp-bar'); if (!b) return;
    b.innerHTML = '<div class="cmp-grp" role="group" aria-label="Period">' + [['3M', '3M'], ['6M', '6M'], ['1Y', T('1A', '1Y')], ['3Y', T('3A', '3Y')], ['5Y', T('5A', '5Y')], ['All', T('Tout', 'All')]].map(([v, t]) => pill('per', v, t, !S.from && S.per === v)).join('') + '</div>' +
      '<div class="cmp-grp" role="group" aria-label="Scale">' + [['auto', T('Auto', 'Auto')], ['raw', T('Valeurs', 'Values')], ['b100', 'Base 100'], ['pct', '%'], ['z', T('Écart à la moyenne', 'Z-score')]].map(([v, t]) => pill('scale', v, t, S.scale === v)).join('') + '</div>' +
      '<div class="cmp-grp" role="group" aria-label="Chart">' + [['auto', T('Auto', 'Auto')], ['line', T('Courbes', 'Lines')], ['bar', T('Barres mensuelles', 'Monthly bars')], ['scatter', T('Nuage X–Y', 'X–Y scatter')]].map(([v, t]) => pill('type', v, t, S.type === v)).join('') + '</div>' +
      '<div class="cmp-grp" style="margin-left:auto">' + `<button type="button" class="cmp-pill" id="cmp-link">${T('Copier le lien', 'Copy link')}</button><button type="button" class="cmp-pill" id="cmp-csv">CSV</button><button type="button" class="cmp-pill" id="cmp-dash">${T('+ Tableau de bord', '+ Dashboard')}</button>` + '</div>';
  }
  function drawPicker() {
    const sel = document.getElementById('cmp-sel'), cat = document.getElementById('cmp-cat'); if (!sel || !cat) return;
    sel.innerHTML = S.sel.map((id, i) => `<div class="cmp-chip"><i style="background:${COLORS[i % 8]}"></i><span>${esc(label(id))}</span><em>${esc(CAT.get(id).unit)}</em><button type="button" data-del="${id}" aria-label="${T('Retirer', 'Remove')} ${esc(label(id))}">×</button></div>`).join('') ||
      '<p class="cmp-note">' + T('Aucune série.', 'No series yet.') + '</p>';
    const fx = document.getElementById('cmp-fx');
    if (fx) fx.innerHTML = S.sel.length ? `<div class="cmp-note" style="margin:0 0 6px">${S.sel.map((id, i) => `<b>${String.fromCharCode(65 + i)}</b> = ${esc(label(id))}`).join(' · ')}</div>` +
      `<div style="display:flex;gap:6px"><input type="text" id="cmp-fx-in" class="cmp-search" placeholder="${T('ex. A − B, A − 2*B − C', 'e.g. A − B, A − 2*B − C')}" aria-label="${T('Formule', 'Formula')}"><button type="button" class="cmp-pill" id="cmp-fx-add">${T('Ajouter', 'Add')}</button></div>` : '';
    const q = (S.q || '').toLowerCase();
    cat.innerHTML = Object.entries(G).map(([g, n]) => {
      const items = [...CAT.values()].filter(c => c.group === g && (!q || label(c.id).toLowerCase().includes(q) || c.id.toLowerCase().includes(q)));
      return items.length ? `<div class="cmp-g"><b>${T(n[0], n[1])}</b>` + items.map(c => `<label class="cmp-it"><input type="checkbox" data-tog="${c.id}"${S.sel.includes(c.id) ? ' checked' : ''}><span>${esc(label(c.id))}</span><em>${esc(c.unit)}</em></label>`).join('') + '</div>' : '';
    }).join('');
  }
  function bind() {
    const root = document.getElementById('cmp-root'); if (!root || root.dataset.bound) return; root.dataset.bound = '1';
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-per],[data-scale],[data-type],[data-del],[data-add],[data-pair],#cmp-rank-go,#cmp-link,#cmp-csv,#cmp-dash,#cmp-fx-add'); if (!t) return;
      if (t.dataset.pair) { S.sel = t.dataset.pair.split(';').filter(id => CAT.has(id)); S.per = '1Y'; S.from = S.to = ''; save(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (t.id === 'cmp-rank-go') { rank(); return; }
      if (t.id === 'cmp-link') { const url = location.origin + location.pathname + '#tools/compare?' + shareParams(); (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { t.textContent = T('Lien copié ✓', 'Link copied ✓'); setTimeout(() => { t.textContent = T('Copier le lien', 'Copy link'); }, 2000); }).catch(() => prompt(T('Lien à copier', 'Link to copy'), url)); return; }
      if (t.id === 'cmp-csv') { csv(); return; }
      if (t.id === 'cmp-dash') { if (window.PKDash && PKDash.addCard) { PKDash.addCard('compare-chart', { s: S.sel.join(';'), per: S.per, scale: S.scale, type: S.type }); t.textContent = T('Ajouté ✓', 'Added ✓'); setTimeout(() => { t.textContent = T('+ Tableau de bord', '+ Dashboard'); }, 2000); } return; }
      if (t.id === 'cmp-fx-add') {
        const inp = document.getElementById('cmp-fx-in'), f = (inp && inp.value || '').toUpperCase().replace(/−/g, '-').replace(/×/g, '*').replace(/\s+/g, '');
        const bad = !/^[A-H0-9+\-*/().]+$/.test(f) || [...f.matchAll(/[A-H]/g)].some(m => m[0].charCodeAt(0) - 65 >= S.sel.length);
        if (bad || !f) { if (inp) { inp.setCustomValidity(T('Lettres A à ' + String.fromCharCode(64 + S.sel.length) + ', chiffres et + − * / ( )', 'Letters A to ' + String.fromCharCode(64 + S.sel.length) + ', digits and + − * / ( )')); inp.reportValidity(); } return; }
        const id = addExpr(f, S.sel.slice()); if (id && !S.sel.includes(id) && S.sel.length < 8) S.sel.push(id); save(); render(); return;
      }
      if (t.dataset.per) { S.per = t.dataset.per; S.from = S.to = ''; const f = document.getElementById('cmp-from'), g = document.getElementById('cmp-to'); if (f) f.value = ''; if (g) g.value = ''; }
      if (t.dataset.scale) S.scale = t.dataset.scale;
      if (t.dataset.type) S.type = t.dataset.type;
      if (t.dataset.del) S.sel = S.sel.filter(x => x !== t.dataset.del);
      if (t.dataset.add && !S.sel.includes(t.dataset.add) && S.sel.length < 8) S.sel.push(t.dataset.add);
      save(); render();
    });
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset && t.dataset.tog) { const id = t.dataset.tog; if (t.checked) { if (S.sel.length < 8) S.sel.push(id); else t.checked = false; } else S.sel = S.sel.filter(x => x !== id); save(); render(); }
      if (t.id === 'cmp-rank-same') { S.rankSame = t.checked; rank(); return; }
      if (t.id === 'cmp-from' || t.id === 'cmp-to') { S.from = (document.getElementById('cmp-from') || {}).value || ''; S.to = (document.getElementById('cmp-to') || {}).value || ''; render(); }
    });
    const q = document.getElementById('cmp-q'); if (q) q.addEventListener('input', () => { S.q = q.value; drawPicker(); });
  }
  // links watched every day (scripts/corr_watch.py): a click puts the pair on the chart
  async function watch() {
    const host = document.getElementById('cmp-watch'); if (!host || host.dataset.done) return;
    const j = await json('watch', 'corr_watch.json'); if (!j || !j.pairs) { host.innerHTML = '<p class="cmp-note">–</p>'; return; }
    host.dataset.done = '1';
    host.innerHTML = '<div class="cmp-watch">' + j.pairs.map(r => `<button type="button" class="cmp-wt${r.break ? ' brk' : ''}" data-pair="${r.a};${r.b}"><span>${esc(label(r.a))} / ${esc(label(r.b))}</span><b>${fmtR(r.c365)} → ${fmtR(r.c60)}</b>` +
      `<em>${r.break ? (r.delta > 0 ? T('le lien se resserre', 'tightening') : T('le lien se casse', 'breaking')) : Math.abs(r.delta) >= 0.15 ? (r.delta > 0 ? T('se resserre un peu', 'tightening a little') : T('se relâche un peu', 'loosening a little')) : T('stable', 'steady')}</em></button>`).join('') + '</div>' +
      '<p class="cmp-note">' + T('Mis à jour chaque jour à 14 h 15 UTC. Une alerte « rupture de corrélation » prévient par e-mail (menu Alertes).', 'Updated daily at 14:15 UTC. A “correlation break” alert can e-mail you (Alerts menu).') + '</p>';
  }

  // CSV of the series on the chart, aligned on dates (the window shown)
  function csv() {
    if (!LAST || !LAST.all) return;
    const head = ['date'].concat(S.sel.map(id => '"' + label(id).replace(/"/g, '""') + ' (' + (CAT.get(id).unit || '') + ')"'));
    const rows = LAST.all.map((d, i) => [d].concat(LAST.raw.map(a => a[i] == null ? '' : a[i])).join(';'));
    const blob = new Blob(['\ufeff' + head.join(';') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'powerklock-comparator-' + LAST.from + '-' + LAST.to + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // the chart as a dashboard card: the series, period, scale and chart type saved with it
  if (window.PKW) PKW.register({ id: 'compare-chart', title: 'Comparator', category: 'intel', page: 'compare', source: 'PowerKlock', size: { w: 6, h: 5 },
    desc: 'A chart of the Comparator, saved with its series, period, scale and chart type.',
    params: [{ key: 'per', label: 'Period', options: [['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['3Y', '3Y'], ['5Y', '5Y'], ['All', 'All']] }], defaults: { s: 'c:ttf;c:eua', per: '1Y', scale: 'auto', type: 'auto' },
    titleFn: p => splitSel(p.s || '').filter(id => CAT.has(id) || /^expr:/.test(id)).slice(0, 3).map(id => { const m = /^expr:([^|]+)\|(.+)$/.exec(id); if (m) addExpr(m[1], m[2].split(',')); return label(id); }).join(' · '),
    async draw(cid, p) {
      splitSel(p.s || '').forEach(id => { const m = /^expr:([^|]+)\|(.+)$/.exec(id); if (m) addExpr(m[1], m[2].split(',')); });
      const sel = splitSel(p.s || '').filter(id => CAT.has(id)); if (!sel.length) return null;
      const B = await build(sel, { per: p.per || '1Y', from: '', to: '', scale: p.scale || 'auto', type: p.type || 'auto' });
      if (B.empty) { noDataMsg(cid, T('Pas de données sur la période', 'No data in this window'), ''); return null; }
      _fuelChart(cid, B.cfg, 'comparator'); return { sub: B.sub };
    } });

  // also used by Replay (js/replay.js): any daily series of the catalogue, its label, unit and group
  window.PKCompare = { render: () => { bind(); render(); }, catalogue: () => [...CAT.keys()], label, unit: id => (CAT.get(id) || {}).unit, group: id => (CAT.get(id) || {}).group,
    groups: () => Object.entries(G).map(([g, n]) => [g, T(n[0], n[1]), [...CAT.values()].filter(c => c.group === g).map(c => c.id)]), load: id => CAT.has(id) ? CAT.get(id).load('2016-01-01').catch(() => new Map()) : Promise.resolve(new Map()) };
  if (window.PK && PK.onPage) PK.onPage('compare', () => { bind(); render(); });

  const css = document.createElement('style');
  css.textContent = `
  .cmp-wrap{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
  .cmp-side{flex:1 1 250px;max-width:320px;display:flex;flex-direction:column;gap:12px}
  .cmp-mainc{flex:999 1 600px;min-width:0;display:flex;flex-direction:column;gap:16px}
  .cmp-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .cmp-grp{display:flex;flex-wrap:wrap;gap:4px}
  .cmp-pill{background:transparent;color:var(--text2);border:1px solid var(--border);border-radius:999px;padding:5px 11px;font:500 12px Inter,sans-serif;cursor:pointer}
  .cmp-pill.on{background:rgba(20,211,169,.14);color:var(--accent);border-color:rgba(20,211,169,.5)}
  .cmp-auto{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;padding:5px 10px;border-radius:999px;background:rgba(20,211,169,.10);color:var(--accent);font-size:12px}
  .cmp-dates{display:flex;gap:6px;align-items:center;font:11px 'JetBrains Mono',monospace;color:var(--text3)}
  .cmp-dates input{background:var(--bg);border:1px solid var(--border);color:var(--text);font-size:11px;padding:3px 6px;border-radius:4px;color-scheme:dark}
  .cmp-chip{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;background:var(--bg3);font-size:12.5px}
  .cmp-chip i{width:14px;height:3px;border-radius:2px;flex:none} .cmp-chip span{flex:1;min-width:0} .cmp-chip em{font:10.5px 'JetBrains Mono',monospace;color:var(--text3);font-style:normal}
  .cmp-chip button{background:none;border:0;color:var(--text3);font-size:16px;cursor:pointer;padding:0 2px;line-height:1}
  .cmp-search{width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font:13px Inter,sans-serif}
  .cmp-cat{max-height:560px;overflow:auto;display:flex;flex-direction:column;gap:10px;padding-right:4px}
  .cmp-g b{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-bottom:4px}
  .cmp-it{display:flex;align-items:center;gap:7px;padding:3px 2px;font-size:12.5px;color:var(--text2);cursor:pointer} .cmp-it span{flex:1} .cmp-it em{font:10px 'JetBrains Mono',monospace;color:var(--text3);font-style:normal}
  .cmp-mx{display:grid;gap:3px;font:11px 'JetBrains Mono',monospace}
  .cmp-mh{text-align:center;padding-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .cmp-mr{display:flex;align-items:center;color:var(--text2);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .cmp-mc{height:30px;border-radius:4px;display:flex;align-items:center;justify-content:center}
  .cmp-note{margin:8px 0 0;font-size:12.5px;color:var(--text2);line-height:1.5}
  .cmp-lags{display:flex;gap:6px;align-items:flex-end;height:120px}
  .cmp-lagc{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px}
  .cmp-lagb{display:block;width:100%;border-radius:3px 3px 0 0;min-height:2px} .cmp-lagc em{font:10px 'JetBrains Mono',monospace;color:var(--text3);font-style:normal}
  .cmp-rk{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) 44px;gap:10px;align-items:center;width:100%;background:none;border:0;padding:5px 2px;color:var(--text);font:12.5px Inter,sans-serif;text-align:left;cursor:pointer;border-radius:6px}
  .cmp-rk:hover{background:var(--bg3)} .cmp-rkb{height:8px;border-radius:4px;background:var(--bg3);overflow:hidden} .cmp-rkb i{display:block;height:8px} .cmp-rk b{font:600 12px 'JetBrains Mono',monospace;text-align:right}
.cmp-watch{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
  .cmp-wt{display:flex;flex-direction:column;gap:3px;text-align:left;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text2);font:12.5px Inter,sans-serif;cursor:pointer}
  .cmp-wt:hover{border-color:var(--accent)} .cmp-wt b{font:600 13px 'JetBrains Mono',monospace;color:var(--text)} .cmp-wt em{font-style:normal;font-size:11.5px;color:var(--text3)}
  .cmp-wt.brk{border-color:var(--down)} .cmp-wt.brk em{color:var(--down);font-weight:600}
.cmp-evs{margin:10px 0 0;padding-left:22px;display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--text2)} .cmp-evs li{padding-left:4px}
  .cmp-evs b{color:var(--text);font-weight:600;margin:0 6px} .cmp-evs a{color:var(--accent)}
  .cmp-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px} @media (max-width:1100px){.cmp-grid2{grid-template-columns:1fr}}
  `;
  document.head.appendChild(css);
})();
