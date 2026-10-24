// ════════════════════════════════════════════════════════════════════
// CAPTURE RATE BY REGION (Renewables › Cannibalisation)
//   data/history/fr_regional_capture.json: each region's solar and wind output
//   (RTE éCO2mix regional) valued at the French day-ahead price of each step,
//   ÷ baseload. One technology at a time, ranked best → worst, France as its
//   own bar. Over several years: each year's rate weighted by the region's
//   output that year (TWh), full years only.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  let J = null;
  const load = () => J ? Promise.resolve(J) : fetch(DATA_BASE + 'history/fr_regional_capture.json').then(r => r.ok ? r.json() : null).then(j => (J = j)).catch(() => null);
  const conv = () => { const e = document.getElementById('cn-conv'); return e && e.value === 'all' ? 'all' : e && e.value === 'curt' ? 'curt' : 'pos'; };
  const fr = () => !window.PKI18n || PKI18n.lang !== 'en';
  const num = (v, d) => { const s = v.toFixed(d); return fr() ? s.replace('.', ',') : s; };

  // years with data; "full" = every region marked complete that year
  function years(j) {
    const ys = Object.keys(j.national).filter(y => j.national[y].solar && j.national[y].solar.all != null).sort();
    const full = ys.filter(y => Object.values(j.regions).every(r => !r.years[y] || !r.years[y].solar || r.years[y].solar.complete !== false));
    return { ys, full };
  }
  // the period's rate: output-weighted mean of the yearly rates
  function rate(get, yrs, tech, c) {
    let s = 0, w = 0;
    yrs.forEach(y => { const v = get(y) && get(y)[tech]; if (v && v[c] != null && v.twh) { s += v[c] * v.twh; w += v.twh; } });
    return w ? { v: s / w, twh: w } : null;
  }
  function periods(ys, full) {
    const last = full[full.length - 1], out = [];
    [3, 5].forEach(n => { if (full.length >= n) out.push({ key: (+last - n + 1) + '-' + last, label: (+last - n + 1) + '–' + last + ' (' + n + (fr() ? ' ans' : ' years') + ')' }); });
    if (full.length > 5) out.push({ key: full[0] + '-' + last, label: full[0] + '–' + last + (fr() ? ' (tout)' : ' (all)') });
    return out.concat(ys.slice().reverse().map(y => ({ key: y, label: y + (full.includes(y) ? '' : fr() ? ' (en cours)' : ' (to date)') })));
  }
  const span = (key, ys) => { const [a, b] = key.split('-'); return b ? ys.filter(y => y >= a && y <= b) : [a]; };

  async function draw(cid, p) {
    const j = await load(); if (!j) { noDataMsg(cid, 'No regional capture data', ''); return null; }
    const { ys, full } = years(j);
    const sel = document.getElementById('cn-reg-year'), tsel = document.getElementById('cn-reg-tech');
    if (sel && !sel.options.length) {
      sel.innerHTML = periods(ys, full).map(o => `<option value="${o.key}">${o.label}</option>`).join('');
      sel.value = full[full.length - 1] || ys[ys.length - 1];
      sel.addEventListener('change', () => draw('cn-reg', {}));
      if (tsel) tsel.addEventListener('change', () => draw('cn-reg', {}));
    }
    const key = (p && p.year) || (sel ? sel.value : full[full.length - 1]), c = (p && p.conv) || conv();
    const tech = (p && p.tech) || (tsel && tsel.value) || 'solar';
    const yrs = span(String(key), ys);
    const N = rate(y => j.national[y], yrs, tech, c);
    const rows = Object.values(j.regions).map(r => ({ n: r.name, r: rate(y => r.years[y], yrs, tech, c) })).filter(x => x.r);
    if (N) rows.push({ n: 'France', r: N, fr: true });
    rows.sort((a, b) => b.r.v - a.r.v);   // best → worst
    const pt = v => +(v * 100).toFixed(1);
    const base = tech === 'solar' ? [244, 196, 48] : [20, 211, 169], rgba = a => `rgba(${base.join(',')},${a})`;
    const vals = rows.map(x => pt(x.r.v)), yMin = Math.max(0, Math.floor(Math.min(...vals) / 10) * 10 - 10);
    const name = tech === 'solar' ? 'Solar' : 'Wind', FRC = getComputedStyle(document.documentElement).getPropertyValue('--text2').trim() || '#B8C9D9';
    _fuelChart(cid, { type: 'bar', data: { labels: rows.map(x => x.n), datasets: [
      { label: name, data: vals, backgroundColor: rows.map(x => x.fr ? FRC : rgba(.75)), borderColor: rows.map(x => x.fr ? FRC : rgba(1)), borderWidth: 0, borderRadius: 3, barPercentage: .78 }] },
      options: _fuelOpts({ indexAxis: 'y',
        scales: { x: _fuelAxis('capture rate, %', { min: yMin }), y: { grid: { display: false }, ticks: { color: C_TX2, font: ctx => ({ size: 11, weight: rows[ctx.index] && rows[ctx.index].fr ? '700' : '400' }), autoSkip: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => {
          const x = rows[ctx.dataIndex], d = x.fr ? '' : ' · ' + (x.r.v >= N.v ? '+' : '') + num((x.r.v - N.v) * 100, 1) + ' pts vs France';
          return ' ' + num(ctx.parsed.x, 1) + ' %' + d + ' · ' + num(x.r.twh, 1) + ' TWh';
        } } } } }) }, 'capture-by-region-' + tech + '-' + key);
    const reg = rows.filter(x => !x.fr), hi = reg[0], lo = reg[reg.length - 1];
    const note = document.getElementById('cn-reg-note');
    const cv = { all: fr() ? 'toutes les heures' : 'all hours', curt: fr() ? 'écrêté aux prix ≤ 0' : 'curtailed at prices ≤ 0', pos: fr() ? 'heures à prix > 0' : 'hours with price > 0' }[c];
    const per = yrs.length > 1 ? yrs[0] + '–' + yrs[yrs.length - 1] : yrs[0] + (full.includes(yrs[0]) ? '' : fr() ? ' (en cours)' : ' (to date)');
    const tn = tech === 'solar' ? (fr() ? 'le solaire' : 'solar') : (fr() ? 'l’éolien' : 'wind');
    const txt = hi && lo && N ? (fr()
      ? `${per} : ${tn} capte de ${num(pt(lo.r.v), 1)} % (${lo.n}) à ${num(pt(hi.r.v), 1)} % (${hi.n}), France ${num(pt(N.v), 1)} % — un écart de ${num(pt(hi.r.v) - pt(lo.r.v), 1)} points que le taux national cache. Même prix français partout : l'écart vient seulement du moment où chaque région produit.${yrs.length > 1 ? ' Plusieurs années : moyenne des taux annuels pondérée par la production de chaque année.' : ''} Convention : ${cv}.`
      : `${per}: ${tn} captures from ${num(pt(lo.r.v), 1)} % (${lo.n}) to ${num(pt(hi.r.v), 1)} % (${hi.n}), France ${num(pt(N.v), 1)} % — a ${num(pt(hi.r.v) - pt(lo.r.v), 1)}-point spread the national rate hides. Same French price everywhere: the gap comes only from when each region produces.${yrs.length > 1 ? ' Several years: yearly rates weighted by each year’s output.' : ''} Convention: ${cv}.`) : '';
    if (note && cid === 'cn-reg') note.textContent = txt;
    return { sub: txt };
  }
  if (window.PKW) PKW.register({ id: 'ren-capture-regions', title: 'France · capture rate by region', category: 'renewables', page: 'renewables', pageCanvas: 'cn-reg', source: 'RTE éCO2mix · ENTSO-E', size: { w: 6, h: 5 },
    desc: 'Solar or wind capture rate of each French region over a year or several (its output on the French day-ahead price ÷ baseload), ranked, with France.', draw });
  document.addEventListener('pk-view', e => { if (e.detail && e.detail.key === 'renewables' && /Cannibalisation/.test(e.detail.label)) setTimeout(() => draw('cn-reg', {}), 100); });
  document.addEventListener('change', e => { if (e.target && e.target.id === 'cn-conv' && document.getElementById('cn-reg') && document.getElementById('cn-reg').offsetParent) draw('cn-reg', {}); });
})();
