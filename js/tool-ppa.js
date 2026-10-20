// ════════════════════════════════════════════════════════════════════
// TOOLS › PPA PRICER (France, solar or wind, pay-as-produced)
// Port of the team's PPA Dashboard (Streamlit) pricing engine onto
// PowerKlock data:
//   capture history  — RTE output × day-ahead price per year (national), or
//                      the uploaded asset curve × France quarter-hour prices
//   shape discount   — 1 − capture price ÷ baseload, per year
//   projection       — linear regression on the last N complete years
//                      (option: without 2022), anchored on the asset's last
//                      year when a curve is loaded; P10–P90 widening 4 pts/√t
//   PPA price        = Forward − Forward × (shape disc at the chosen
//                      percentile + add. discount + volume risk + price risk)
//                      − imbalance + GO value + margin
//   P&L              — vs the cannibalisation percentile, stress scenarios
// Forwards: France Cal contracts (market data), editable. GO: Commerg mid.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const get = path => fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => null);
  const thisYear = () => +(typeof pkTodayISO === 'function' ? pkTodayISO() : new Date().toISOString()).slice(0, 4);
  const S = { tech: 'solar', years: null, pct: 74, tenorStart: null, tenorEnd: null, fwd: {}, imb: 1.9, add: 0, volRisk: 0, priceRisk: 0, go: null, margin: 1.0,
    volume: 52000, conv: 'pos', model: 'flat', volStress: 20, spotStress: 20, asset: null, assetName: '', basis: 'asset' };
  let D = null;   // reference data
  const S0 = JSON.parse(JSON.stringify(S));   // defaults, for the site charts (Renewables › Cannibalisation)

  // ── Maths ─────────────────────────────────────────────────────────
  function percentile(arr, p) {   // numpy linear interpolation
    const a = arr.filter(v => v != null && isFinite(v)).slice().sort((x, y) => x - y);
    if (!a.length) return null; if (a.length === 1) return a[0];
    const r = (p / 100) * (a.length - 1), lo = Math.floor(r), hi = Math.ceil(r);
    return a[lo] + (a[hi] - a[lo]) * (r - lo);
  }
  function linreg(xs, ys) {
    const n = xs.length; if (n < 2) return { sl: 0, ic: ys.length ? ys[0] : 0.15, r2: 0 };
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    const sl = sxx ? sxy / sxx : 0; return { sl, ic: my - sl * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
  }

  // ── Reference data ────────────────────────────────────────────────
  async function load() {
    if (D) return D;
    const [cap, mkt, goCsv, capa] = await Promise.all([get('history/fr_capture.json'), get('fr_market.json'), fetch(DATA_BASE + 'go_prices.csv').then(r => r.ok ? r.text() : '').catch(() => ''), get('history/capacity.json')]);
    const fwd = {};
    ((mkt && mkt.forwardCurve) || []).forEach(r => { const m = /Cal\s?(\d{4})/.exec(r.contract || ''); if (m && r.value != null) fwd[+m[1]] = r.value; });
    // GO: latest Commerg mid per production year (AIB renewable)
    const go = {};
    goCsv.split(/\r?\n/).slice(1).forEach(l => { const c = l.split(','); if (c.length < 8 || !/Renewable/i.test(c[4])) return; const bid = parseFloat(c[6]), ask = parseFloat(c[7]); const mid = isFinite(bid) && isFinite(ask) ? (bid + ask) / 2 : isFinite(bid) ? bid : null; if (mid != null && (!go[c[5]] || c[1] >= go[c[5]].d)) go[c[5]] = { d: c[1], v: mid }; });
    // installed capacity (GW) by year, Energy-Charts
    const fr = capa && capa.countries && capa.countries.FR, capGW = { solar: {}, wind: {} };
    if (fr) fr.years.forEach((y, i) => { const t = fr.types; const s = t['Solar AC'] && t['Solar AC'][i]; const w = (t['Wind onshore'] && t['Wind onshore'][i] || 0) + (t['Wind offshore'] && t['Wind offshore'][i] || 0); if (s) capGW.solar[y] = s; if (w) capGW.wind[y] = w; });
    const F = cap ? cap.fields : [], ix = Object.fromEntries(F.map((f, i) => [f, i + 1]));
    D = { cap: (cap && cap.days) || [], ix, profile: (cap && cap.profile) || {}, capGW, fwd, fwdDate: mkt && mkt.forwardCurve && mkt.forwardCurve[0] && mkt.forwardCurve[0].date, go };
    return D;
  }

  // Column indexes of a day row for the technology and convention:
  // 'pos' = PPA Dashboard (hours with a price ≤ 0 left out of capture and baseload), 'all' = every hour
  function cols(st = S) {
    const t = st.tech === 'solar' ? 's' : 'w', pos = st.conv === 'pos' ? 'Pos' : '', ix = D.ix;
    return { E: ix[t + 'E' + pos], R: ix[t + 'R' + pos], P: ix['pSum' + pos], N: ix['pN' + pos] };
  }
  // Sum a set of day rows → capture price, baseload, capture rate
  function agg(rows, st = S) {
    const c = cols(st); let E = 0, R = 0, P = 0, N = 0;
    rows.forEach(r => { E += r[c.E]; R += r[c.R]; P += r[c.P]; N += r[c.N]; });
    const base = N ? P / N : null, cp = E ? R / E : null;
    return { base, cp, cpPct: cp != null && base > 0 ? cp / base : null, E };
  }
  // National capture history per year (RTE output × day-ahead price)
  function nationalYears(st = S) {
    const by = {}; D.cap.forEach(r => { (by[r[0].slice(0, 4)] = by[r[0].slice(0, 4)] || []).push(r); });
    return Object.keys(by).map(Number).sort().map(y => { const a = agg(by[y], st);
      return { year: y, base: a.base, cp: a.cp, cpPct: a.cpPct, sd: a.cpPct != null ? 1 - a.cpPct : null, days: by[y].length, complete: y < thisYear() && by[y].length >= 360 }; })
      .filter(x => x.cpPct != null);
  }
  // Rolling capture rate and price over 30 / 90 / 365 days (national)
  function rolling(st = S) {
    const c = cols(st), rows = D.cap, n = rows.length, cum = [[0, 0, 0, 0]];
    rows.forEach((r, i) => { const p = cum[i]; cum.push([p[0] + r[c.E], p[1] + r[c.R], p[2] + r[c.P], p[3] + r[c.N]]); });
    const win = w => rows.map((r, i) => { if (i + 1 < w) return null; const a = cum[i + 1], b = cum[i + 1 - w]; const E = a[0] - b[0], R = a[1] - b[1], P = a[2] - b[2], N = a[3] - b[3];
      const base = N ? P / N : null, cp = E ? R / E : null; return { cp, base, pct: cp != null && base > 0 ? cp / base : null }; });
    return { days: rows.map(r => r[0]), w30: win(30), w90: win(90), w365: win(365) };
  }
  // Asset capture history: curve × France quarter-hour prices
  async function assetYears(st = S) {
    const slots = st.asset.slots, days = [...slots.keys()].sort(), years = [...new Set(days.map(d => d.slice(0, 4)))];
    const files = await Promise.all(years.map(y => get('history/fr_prices/' + y + '.json')));
    const P = {}; files.forEach(f => { if (f && f.days) Object.assign(P, f.days); });
    const acc = {};
    const pos = st.conv === 'pos';
    days.forEach(d => { const p = P[d]; if (!p) return; const c = slots.get(d), y = +d.slice(0, 4), a = acc[y] || (acc[y] = { n: 0, bs: 0, bn: 0, e: 0, rev: 0, all: 0, neg: 0 }); a.n++;
      for (let q = 0; q < 96; q++) { if (p[q] == null) continue; const e = c[q] || 0; a.all += e;
        if (pos && p[q] <= 0) { a.neg += e; continue; }   // PPA Dashboard convention: hours ≤ 0 €/MWh left out
        a.bs += p[q]; a.bn++; if (!e) continue; a.e += e; a.rev += e * p[q]; } });
    return Object.keys(acc).map(Number).sort().map(y => { const a = acc[y], base = a.bs / a.bn, cp = a.e ? a.rev / a.e : null;
      return { year: y, base, cp, cpPct: cp != null && base > 0 ? cp / base : null, sd: cp != null && base > 0 ? 1 - cp / base : null, days: a.n, mwh: a.e / 1000, mwhAll: a.all / 1000, negMwh: a.neg / 1000, complete: a.n >= 330 && y < thisYear() }; })
      .filter(x => x.cpPct != null);
  }

  async function compute(st = S) {
    await load();
    const nat = nationalYears(st);
    const ast = st.asset ? (await assetYears(st)) : null;
    const useAsset = ast && ast.length >= 1 && st.basis === 'asset';
    const hist = useAsset ? ast : nat;
    // Years used: chosen one by one; by default the last three complete years.
    // The percentile and the regression use the same years.
    const complete = hist.filter(x => x.complete);
    const def = (complete.length ? complete : hist).slice(-3).map(x => x.year);
    const sel = (st.years || def).filter(y => hist.some(x => x.year === y));
    const used = hist.filter(x => sel.includes(x.year));
    const fitRows = used.length ? used : hist.slice(-3);
    const histSd = fitRows.map(x => x.sd);
    const reg = linreg(fitRows.map(x => x.year), fitRows.map(x => x.sd));
    const lastYr = fitRows[fitRows.length - 1].year;
    const anchor = useAsset ? fitRows[fitRows.length - 1].cpPct : null;
    // Projection of the shape discount from the last complete year: the PPA
    // Dashboard's straight line (capped), a trend halving every year, or flat
    const start = fitRows[fitRows.length - 1].sd;   // the last year used, as observed
    const clamp = v => Math.max(0, Math.min(0.95, v));
    const proj = y => { const t = Math.max(0, y - lastYr);
      return clamp(st.model === 'flat' ? start : st.model === 'linear' ? start + reg.sl * t : start + 2 * reg.sl * (1 - Math.pow(0.5, t))); };
    const fitLine = y => clamp(reg.ic + reg.sl * y);
    const ty = thisYear(), t0 = st.tenorStart || ty + 1, t1 = Math.max(t0, st.tenorEnd || t0 + 4);
    const known = Object.keys(D.fwd).map(Number).sort();
    const fwdFor = y => st.fwd[y] != null ? st.fwd[y] : D.fwd[y] != null ? D.fwd[y] : known.length ? D.fwd[known.filter(k => k <= y).pop() || known[0]] : 60;
    const tenor = []; for (let y = t0; y <= t1; y++) tenor.push(y);
    const fwds = tenor.map(fwdFor), ref = fwds.reduce((a, b) => a + b, 0) / fwds.length;
    const goMkt = (() => { const v = tenor.map(y => D.go[y] && D.go[y].v).filter(v => v != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();
    const goVal = st.go != null ? st.go : goMkt != null ? goMkt : 1.0;
    const sdCh = percentile(histSd, st.pct);
    const price = (f, sd) => f - f * (sd + st.add / 100 + st.volRisk / 100 + st.priceRisk / 100) - st.imb + goVal + st.margin;
    const ppa = price(ref, sdCh);
    const volume = useAsset ? (() => { const full = ast.filter(x => x.days >= 330); return full.length ? full.reduce((a, x) => a + x.mwh, 0) / full.length : ast[ast.length - 1].mwh * 365 / ast[ast.length - 1].days; })() : st.volume;
    const years = tenor.map((y, i) => { const fsd = proj(y), cp = fwds[i] * (1 - fsd); return { y, fwd: fwds[i], fsd, cp, ppaY: price(fwds[i], fsd), pnl: cp - ppa, pnlK: volume * (cp - ppa) / 1000 }; });
    const pcts = [...Array(100).keys()].map(i => i + 1), sdP = pcts.map(p => percentile(histSd, p));
    const pnlCurve = sdP.map(sd => volume * (ref * (1 - sd) - ppa) / 1000);
    const be = pcts.find((p, i) => pnlCurve[i] < 0) || null;
    // stress scenarios (same table as the PPA Dashboard): total over the tenor, k€
    const n = tenor.length, med = percentile(histSd, 50), p10 = percentile(histSd, 10), p90 = percentile(histSd, 90), vs = st.volStress / 100, ss = st.spotStress / 100;
    const scen = [['Base', 1, 0, 0], ['Cannibalisation +' + st.volStress + ' %', 1, vs, 0], ['Cannibalisation −' + st.volStress + ' %', 1, -vs, 0], ['Spot +' + st.spotStress + ' %', 1 + ss, 0, 0], ['Spot −' + st.spotStress + ' %', 1 - ss, 0, 0],
      ['Volume +' + st.volStress + ' %', 1, 0, vs], ['Volume −' + st.volStress + ' %', 1, 0, -vs], ['Total stress', 1 - ss, vs, -vs], ['Total bull', 1 + ss, -vs, vs]]
      .map(([name, sm, da, va]) => { const base = volume * (1 + va) / 1000 * n; return { name, p10: base * (sm * ref * (1 - (p90 + da)) - ppa), p50: base * (sm * ref * (1 - (med + da)) - ppa), p90: base * (sm * ref * (1 - (p10 + da)) - ppa) }; });
    const ppaProj = years.reduce((a, r) => a + r.ppaY, 0) / years.length;
    return { nat, ast, hist, useAsset, complete, sel: fitRows.map(x => x.year), histSd, reg, lastYr, anchor, proj, fitLine, ppaProj, tenor, fwds, ref, goVal, goMkt, sdCh, ppa, volume, years, pcts, pnlCurve, be, scen, fitRows };
  }

  // ── Rendering ─────────────────────────────────────────────────────
  const f2 = v => v == null || !isFinite(v) ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f0 = v => v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-GB');
  const pc = v => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1) + ' %';
  const sgn = v => (v > 0 ? '+' : '') + f0(v);

  function renderForwards(o) {
    const host = $('pp-fwd'); if (!host) return;
    host.innerHTML = o.tenor.map((y, i) => `<label class="cf-field"><span>Cal ${y}${D.fwd[y] == null ? ' · assumed' : ''}</span><span class="cf-in"><input type="number" step="0.01" data-fy="${y}" value="${o.fwds[i].toFixed(2)}"><em>€/MWh</em></span></label>`).join('') +
      `<div class="pp-fwd-note">${D.fwdDate ? 'Market settlements of ' + D.fwdDate + '; years without a contract take the last one. ' : ''}Edit to test another curve.</div>`;
    host.querySelectorAll('input[data-fy]').forEach(inp => inp.addEventListener('change', () => { S.fwd[+inp.dataset.fy] = parseFloat(inp.value); run(); }));
  }

  function renderYears(o) {
    const host = $('pp-yearsel'); if (!host) return;
    host.innerHTML = o.hist.map(x => `<button type="button" class="pp-chip${o.sel.includes(x.year) ? ' on' : ''}" data-y="${x.year}" title="Shape discount ${pc(x.sd)}${x.complete ? '' : ' · incomplete year'}">${x.year}${x.complete ? '' : ' YTD'}<em>${pc(x.sd)}</em></button>`).join('') +
      `<button type="button" class="pp-chip pp-chip-reset" data-y="reset">Last 3 years</button>`;
    host.querySelectorAll('.pp-chip').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.y === 'reset') S.years = null;
      else { const y = +b.dataset.y, cur = new Set(o.sel); cur.has(y) ? cur.delete(y) : cur.add(y); if (!cur.size) return; S.years = [...cur].sort(); }
      run();
    }));
  }

  function render(o) {
    renderYears(o);
    const tech = S.tech === 'solar' ? 'Solar' : 'Wind';
    $('pp-kpis').innerHTML = [
      _fuelKpi('PPA price', f2(o.ppa), '€/MWh', `${tech} · ${o.tenor[0]}–${o.tenor[o.tenor.length - 1]} · ${o.ref ? (o.ppa / o.ref * 100).toFixed(1) + ' % of forward' : ''}`, ''),
      _fuelKpi('PPA on projection', f2(o.ppaProj), '€/MWh', `average of the yearly prices with the ${({ damped: 'damped', linear: 'linear', flat: 'flat' })[S.model]} projected shape discount`),
      _fuelKpi('Reference forward', f2(o.ref), '€/MWh', 'average of the tenor Cal contracts'),
      _fuelKpi('Shape discount used', pc(o.sdCh), '', `P${S.pct} of ${o.sel.join(', ')} (${o.useAsset ? 'asset' : 'national'})`),
      _fuelKpi('Break-even', o.be ? 'P' + o.be : '> P100', '', 'cannibalisation percentile where P&L turns negative', o.be && o.be <= S.pct ? 'down' : 'up'),
      _fuelKpi('Volume', f0(o.volume), 'MWh/yr', o.useAsset ? 'asset average' : 'entered'),
    ].join('');
    // waterfall
    const steps = [['Forward', o.ref], ['Shape discount', -o.ref * o.sdCh], ['Add. discount', -o.ref * S.add / 100], ['Volume risk', -o.ref * S.volRisk / 100], ['Price risk', -o.ref * S.priceRisk / 100], ['Imbalance', -S.imb], ['GO value', o.goVal], ['Margin', S.margin]];
    let run_ = 0; const bars = steps.map(([l, v], i) => { if (i === 0) { run_ = v; return [0, v]; } const a = run_; run_ += v; return [a, run_]; });
    bars.push([0, o.ppa]);
    const labels = steps.map(s => s[0].split(' ')).concat([['PPA', 'price']]), cols = steps.map(([, v], i) => i === 0 ? 'rgba(127,200,248,.75)' : v < 0 ? 'rgba(237,105,101,.8)' : 'rgba(20,211,169,.8)').concat('#FBBF24');
    _fuelChart('pp-waterfall', { type: 'bar', data: { labels, datasets: [{ label: '€/MWh', data: bars, backgroundColor: cols, borderRadius: 3, borderSkipped: false }] },
      options: _fuelOpts({ plugins: { legend: { display: false }, pkHoverReadout: false, tooltip: { enabled: true, callbacks: { label: c => { const r = c.raw; const v = c.dataIndex === 0 || c.dataIndex === labels.length - 1 ? r[1] : r[1] - r[0]; return ' ' + (v > 0 && c.dataIndex && c.dataIndex < labels.length - 1 ? '+' : '') + v.toFixed(2) + ' €/MWh'; } } } },
        scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false }, ticks: { color: C_TX2, font: { size: 10 }, autoSkip: false, maxRotation: 0 } }), y: _fuelAxis('€/MWh', { beginAtZero: true }) } }) }, 'ppa-waterfall');
    // capture history + projection
    const hy = o.hist.map(x => x.year), all = hy.concat(o.tenor.filter(y => !hy.includes(y))).sort();
    const band = (k) => all.map(y => { if (!o.tenor.includes(y)) return null; const t = y - o.lastYr, cs = 0.04 * Math.sqrt(Math.max(1, t)); return Math.round((1 - (o.proj(y) + k * cs)) * 1000) / 10; });
    const natMap = new Map(o.nat.map(x => [x.year, x])), astMap = o.ast ? new Map(o.ast.map(x => [x.year, x])) : null;
    _fuelChart('pp-history', { type: 'bar', data: { labels: all, datasets: [
      { label: 'National ' + tech.toLowerCase() + ' capture rate', data: all.map(y => natMap.has(y) ? Math.round(natMap.get(y).cpPct * 1000) / 10 : null), backgroundColor: all.map(y => natMap.has(y) && !natMap.get(y).complete ? 'rgba(127,200,248,.3)' : 'rgba(127,200,248,.7)'), borderRadius: 3 },
      ...(astMap ? [{ label: (S.assetName || 'Asset') + ' capture rate', data: all.map(y => astMap.has(y) ? Math.round(astMap.get(y).cpPct * 1000) / 10 : null), backgroundColor: S.tech === 'solar' ? 'rgba(251,191,36,.8)' : 'rgba(20,211,169,.8)', borderRadius: 3 }] : []),
      { type: 'line', label: 'Regression fit', data: all.map(y => o.fitRows.some(r => r.year === y) ? Math.round((1 - o.fitLine(y)) * 1000) / 10 : null), borderColor: '#B8C9D9', borderWidth: 1.4, pointRadius: 2, fill: false },
      { type: 'line', label: '_p10', data: band(1.28), borderWidth: 0, pointRadius: 0, fill: false },
      { type: 'line', label: 'Projection P10–P90', data: band(-1.28), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(168,125,196,.18)', fill: '-1' },
      { type: 'line', label: 'Projection (median)', data: all.map(y => o.tenor.includes(y) ? Math.round((1 - o.proj(y)) * 1000) / 10 : y === o.lastYr ? Math.round((1 - o.proj(y)) * 1000) / 10 : null), borderColor: '#A87DC4', borderWidth: 2, borderDash: [5, 4], pointRadius: 2, fill: false, spanGaps: true },
    ] }, options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10, filter: it => !/^_/.test(it.text) } } },
      scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('capture rate, % of baseload') } }) }, 'ppa-capture-history');
    // P&L vs percentile
    _fuelChart('pp-pnl', { type: 'line', data: { labels: o.pcts.map(p => 'P' + p), datasets: [
      { label: 'Annual P&L (k€)', data: o.pnlCurve.map(v => Math.round(v)), borderColor: '#FFFFFF', borderWidth: 2, pointRadius: 0, fill: { target: { value: 0 }, above: 'rgba(20,211,169,.18)', below: 'rgba(237,105,101,.22)' } },
    ] }, options: _fuelOpts({ plugins: { legend: { display: false } }, scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 11, maxRotation: 0 } }), y: _fuelAxis('k€ per year') } }) }, 'ppa-pnl-percentile');
    $('pp-pnl-sub').textContent = `Volume × (forward × (1 − shape discount at each percentile) − PPA) · chosen P${S.pct}: ${sgn(o.pnlCurve[S.pct - 1])} k€/yr` + (o.be ? ` · break-even P${o.be}` : '');
    // year table
    $('pp-years').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Year</th><th>Forward</th><th>Projected shape disc.</th><th>Capture price</th><th>PPA if priced on the year</th><th>Capture − PPA</th><th>P&L k€</th></tr></thead><tbody>` +
      o.years.map(r => `<tr><td style="text-align:left">${r.y}</td><td>${f2(r.fwd)}</td><td>${pc(r.fsd)}</td><td>${f2(r.cp)}</td><td>${f2(r.ppaY)}</td><td class="${r.pnl >= 0 ? 'pp-pos' : 'pp-neg'}">${(r.pnl >= 0 ? '+' : '') + f2(r.pnl)}</td><td class="${r.pnlK >= 0 ? 'pp-pos' : 'pp-neg'}">${sgn(r.pnlK)}</td></tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">Projection: shape discount regressed on ${o.fitRows.map(r => r.year).join(', ') || '–'} (slope ${(o.reg.sl * 100).toFixed(2)} pts/yr, R² ${o.reg.r2.toFixed(2)}), starting from the ${o.lastYr} shape discount, projected ${({ damped: 'with the trend halving every year', linear: 'in a straight line (capped at 95 %)', flat: 'flat at the last year' })[S.model]}. P&L per year against the contract price ${f2(o.ppa)} €/MWh for ${f0(o.volume)} MWh.</div>`;
    // scenarios
    $('pp-scen').innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Scenario · total over ${o.tenor.length} years</th><th>P10 k€</th><th>P50 k€</th><th>P90 k€</th></tr></thead><tbody>` +
      o.scen.map(r => `<tr><td style="text-align:left">${r.name}</td>${[r.p10, r.p50, r.p90].map(v => `<td class="${v >= 0 ? 'pp-pos' : 'pp-neg'}">${sgn(v)}</td>`).join('')}</tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">P10 / P90 use the 90th / 10th percentile of the historical shape discount (high cannibalisation = low P&L). Spot stress scales the forward; cannibalisation stress shifts the shape discount; volume stress scales production.</div>`;
    // asset diagnostics
    const ad = $('pp-asset-info');
    if (ad) ad.textContent = o.ast ? `${S.assetName}: ${o.ast.map(x => x.year + ' ' + pc(x.cpPct) + (x.negMwh > 0.05 && S.conv === 'pos' ? ' (' + f0(x.negMwh) + ' MWh at prices ≤ 0 left out)' : '')).join(' · ')}` : 'No asset curve: national ' + tech.toLowerCase() + ' profile (RTE) used.';
    const goNote = $('pp-go-note'); if (goNote) goNote.textContent = o.goMkt != null ? `Market: ${f2(o.goMkt)} €/MWh (Commerg, AIB renewable, tenor years)` : '';
  }


  // ── Market & methodology charts (the PPA Dashboard Overview and Market Evolution tabs) ──
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MCOL = ['#3B82F6', '#7FC8F8', '#ED6965', '#F4A7A3', '#14D3A9', '#6EE7B7', '#F59E0B', '#FBBF24', '#A87DC4', '#C9CED6', '#1D4ED8', '#93C5FD'];
  const PPE3 = { solar: { 2030: 48.0, 2035: 67.5 }, wind: { 2030: 31.0, 2035: 37.5 } };
  // Text labels drawn on given points: [{ ds, i, text, dy }]
  const labelPlugin = (marks) => ({ id: 'ppMarks', afterDatasetsDraw(ch) {
    const g = ch.ctx; g.save(); g.font = '600 10.5px "JetBrains Mono", monospace'; g.textAlign = 'center';
    marks.forEach(m => { const meta = ch.getDatasetMeta(m.ds); const el = meta && meta.data[m.i]; if (!el || meta.hidden) return;
      const x = el.x, y = el.y + (m.dy || -12); const w = g.measureText(m.text).width + 8;
      if (m.box) { g.fillStyle = 'rgba(15,20,25,.92)'; g.strokeStyle = m.color || '#FBBF24'; g.lineWidth = 1; g.fillRect(x - w / 2, y - 10, w, 15); g.strokeRect(x - w / 2, y - 10, w, 15); }
      g.fillStyle = m.color || '#FFFFFF'; g.fillText(m.text, x, y + 1); });
    g.restore(); } });
  // Shade category columns (years left out of the regression)
  const shadePlugin = (idx) => ({ id: 'ppShade', beforeDatasetsDraw(ch) {
    const xs = ch.scales.x, a = ch.chartArea, g = ch.ctx; if (!xs || !idx.length) return;
    const step = xs.getPixelForValue(1) - xs.getPixelForValue(0); g.save(); g.fillStyle = 'rgba(251,191,36,.10)';
    idx.forEach(i => { const x = xs.getPixelForValue(i); g.fillRect(x - step / 2, a.top, step, a.bottom - a.top); }); g.restore(); } });

  function capFit(o, st = S) {
    const cap = D.capGW[st.tech], pts = o.nat.filter(x => cap[x.year] && x.complete && o.sel.includes(x.year) || (cap[x.year] && x.complete && !st.years && true));
    const use = o.nat.filter(x => cap[x.year] && x.complete && !(o.excluded || []).includes(x.year));
    if (use.length < 3) return null;
    const X = use.map(x => Math.log(cap[x.year])), Y = use.map(x => x.cpPct), r = linreg(X, Y);
    return { f: gw => r.ic + r.sl * Math.log(gw), r2: r.r2, pts, use };
  }

  const IDS = { proj: 'pp-proj', projSub: 'pp-proj-sub', projTable: 'pp-proj-table', capfit: 'pp-capfit', capfitSub: 'pp-capfit-sub', profNat: 'pp-prof-nat', profNatSub: 'pp-prof-nat-sub',
    profAsset: 'pp-prof-asset', profAssetSub: 'pp-prof-asset-sub', monthly: 'pp-monthly', annual: 'pp-annual', rollPct: 'pp-roll-pct', rollEur: 'pp-roll-eur', rollSub: 'pp-roll-pct-sub' };
  function renderMarket(o, st = S, ids) {
    ids = ids || IDS;
    const has = k => ids[k] && document.getElementById(ids[k]);
    const setT = (k, t) => { const e = ids[k] && document.getElementById(ids[k]); if (e) e.textContent = t; };
    const tech = st.tech === 'solar' ? 'Solar' : 'Wind', tc = st.tech === 'solar' ? '#FBBF24' : '#14D3A9';
    const first = o.hist[0].year, endY = Math.max(2035, o.tenor[o.tenor.length - 1]), Y = [];
    for (let y = first; y <= endY; y++) Y.push(y);
    const pc1 = v => v == null ? null : Math.round(v * 1000) / 10;
    const natM = new Map(o.nat.map(x => [x.year, x])), astM = o.ast ? new Map(o.ast.map(x => [x.year, x])) : null;
    const lastY = o.lastYr, sig = t => 0.04 * Math.sqrt(Math.max(1, t));
    const bandV = (y, z) => y <= lastY ? null : pc1(1 - (o.proj(y) + z * sig(y - lastY)));
    const excluded = Y.filter(y => y < lastY && natM.has(y) && natM.get(y).complete && !o.sel.includes(y) && y >= o.sel[0]);
    o.excluded = excluded;
    const fit = capFit(o, st), ppe = fit ? Object.entries(PPE3[st.tech]).map(([yr, gw]) => ({ yr: +yr, gw, cp: fit.f(gw) })) : [];
    const tenorSet = new Set(o.tenor);
    const ds = [
      { label: '_p90', data: Y.map(y => bandV(y, -1.28)), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'P10–P90', data: Y.map(y => bandV(y, 1.28)), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(251,191,36,.12)', fill: '-1' },
      { label: '_p75', data: Y.map(y => bandV(y, -0.674)), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'P25–P75', data: Y.map(y => bandV(y, 0.674)), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(251,191,36,.24)', fill: '-1' },
      { label: 'National ' + tech.toLowerCase() + ' capture rate', data: Y.map(y => natM.has(y) ? pc1(natM.get(y).cpPct) : null), borderColor: '#3FA6B4', borderDash: [6, 4], borderWidth: 1.6, pointStyle: 'rect', pointRadius: 4, backgroundColor: '#3FA6B4', fill: false, spanGaps: false },
      ...(astM ? [{ label: (st.assetName || 'Asset') + ' capture rate', data: Y.map(y => astM.has(y) ? pc1(astM.get(y).cpPct) : null), borderColor: tc, borderWidth: 2, pointRadius: 4, backgroundColor: tc, fill: false }] : []),
      { label: 'Trend (regression on the years used)', data: Y.map(y => y >= Math.min(...o.sel) - 4 ? pc1(1 - Math.max(-0.5, Math.min(1.5, o.reg.ic + o.reg.sl * y))) : null), borderColor: 'rgba(184,201,217,.55)', borderDash: [2, 3], borderWidth: 1.2, pointRadius: 0, fill: false },
      { label: 'P50 — tenor', data: Y.map(y => tenorSet.has(y) || y === lastY ? pc1(1 - o.proj(y)) : null), borderColor: '#FFFFFF', borderWidth: 2.6, pointRadius: Y.map(y => tenorSet.has(y) ? 4 : y === lastY ? 5 : 0), backgroundColor: '#FFFFFF', fill: false, spanGaps: true },
      { label: 'P50 after the tenor', data: Y.map(y => y >= o.tenor[o.tenor.length - 1] ? pc1(1 - o.proj(y)) : null), borderColor: 'rgba(255,255,255,.45)', borderDash: [3, 3], borderWidth: 1.2, pointRadius: 2, fill: false, spanGaps: true },
      ...ppe.map(t => ({ label: 'PPE3 ' + t.yr, data: Y.map(y => y === t.yr ? pc1(t.cp) : null), pointStyle: 'rectRot', pointRadius: 8, backgroundColor: '#3FA6B4', borderColor: '#0F1419', showLine: false })),
    ];
    const iP50 = ds.findIndex(d => d.label === 'P50 — tenor');
    const marks = o.tenor.map((y, k) => ({ ds: iP50, i: Y.indexOf(y), text: Math.round((1 - o.proj(y)) * 100) + '%', dy: k % 2 ? 22 : -14, box: true }))
      .concat(ppe.map(t => ({ ds: ds.findIndex(d => d.label === 'PPE3 ' + t.yr), i: Y.indexOf(t.yr), text: t.yr + ' ' + Math.round(t.cp * 100) + '%', dy: -14, color: '#3FA6B4' })));
    if (has('proj')) _fuelChart(ids.proj, { type: 'line', data: { labels: Y, datasets: ds }, plugins: [labelPlugin(marks), shadePlugin(excluded.map(y => Y.indexOf(y)))],
      options: _fuelOpts({ layout: { padding: { right: 46, top: 10 } }, plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10, filter: it => !/^_/.test(it.text) } } },
        scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0 } }), y: _fuelAxis('capture rate, % of baseload') } }) }, 'ppa-capture-projection');
    setT('projSub', `Slope ${(-o.reg.sl * 100).toFixed(2)} %/yr · R² ${o.reg.r2.toFixed(2)} · ${o.useAsset ? 'asset' : 'national'} regression on ${o.sel.join(', ')}${excluded.length ? ' · shaded: left out' : ''} · tenor ${o.tenor[0]}–${o.tenor[o.tenor.length - 1]} · ${({ flat: 'flat', damped: 'damped trend', linear: 'straight line' })[st.model]} projection`);
    // P10 / P50 / P90 table
    const rows = []; for (let y = lastY + 1; y <= endY; y++) rows.push(y);
    if (has('projTable')) document.getElementById(ids.projTable).innerHTML = `<table class="fuel-table pp-ptab"><thead><tr><th style="text-align:left">Year</th><th>P10</th><th>P50</th><th>P90</th></tr></thead><tbody>` +
      rows.map(y => `<tr class="${tenorSet.has(y) ? 'pp-tenor' : ''}"><td style="text-align:left">${y}</td><td>${bandV(y, 1.28).toFixed(1)}%</td><td><b>${pc1(1 - o.proj(y)).toFixed(1)}%</b></td><td>${bandV(y, -1.28).toFixed(1)}%</td></tr>`).join('') +
      `</tbody></table><div class="fuel-note">Capture rate, % of baseload. Highlighted: tenor. P10 = low capture (strong cannibalisation).</div>`;
    // CP% vs installed capacity
    const cap = D.capGW[st.tech];
    const scat = o.nat.filter(x => cap[x.year] || (x.year === thisYear() && Object.keys(cap).length));
    const capOf = x => cap[x.year] || cap[Math.max(...Object.keys(cap).map(Number))];
    if (fit) {
      const xMax = Math.max(...ppe.map(t => t.gw), ...scat.map(capOf)) * 1.05, xMin = Math.min(...scat.map(capOf)) * 0.95, line = [];
      for (let k = 0; k <= 60; k++) { const gw = xMin + (xMax - xMin) * k / 60; line.push({ x: gw, y: pc1(fit.f(gw)) }); }
      const pts = scat.map(x => ({ x: capOf(x), y: pc1(x.cpPct), yr: x.year, partial: !x.complete }));
      const ds2 = [
        { type: 'scatter', label: 'National ' + tech.toLowerCase() + ' (one point per year)', data: pts, pointRadius: 7, backgroundColor: pts.map(p => p.partial ? '#FBBF24' : (o.excluded || []).includes(p.yr) ? 'rgba(63,166,180,.35)' : '#3FA6B4'), borderColor: '#0F1419' },
        { type: 'line', label: `Log fit (R² ${fit.r2.toFixed(2)})`, data: line, borderColor: '#FFFFFF', borderWidth: 1.8, pointRadius: 0, fill: false },
        { type: 'scatter', label: 'PPE3 targets', data: ppe.map(t => ({ x: t.gw, y: pc1(t.cp) })), pointStyle: 'rectRot', pointRadius: 9, backgroundColor: '#ED6965', borderColor: '#0F1419' },
      ];
      const marks2 = pts.map((p, i) => ({ ds: 0, i, text: String(p.yr) + (p.partial ? ' YTD' : ''), dy: p.partial ? 20 : -11, color: p.partial ? '#FBBF24' : '#B8C9D9' }))
        .concat(ppe.map((t, i) => ({ ds: 2, i, text: `PPE3 ${t.yr}: ${t.gw} GW → ${Math.round(t.cp * 100)}%`, dy: -14, color: '#ED6965' })));
      if (has('capfit')) _fuelChart(ids.capfit, { type: 'scatter', data: { datasets: ds2 }, plugins: [labelPlugin(marks2)],
        options: _fuelOpts({ interaction: { mode: 'nearest', intersect: true }, plugins: { pkHoverReadout: false, tooltip: { enabled: true, callbacks: { label: c => ` ${c.raw.yr || ''} ${c.raw.x.toFixed(1)} GW · ${c.raw.y.toFixed(1)} %` } } },
          layout: { padding: { right: 30, top: 10 } }, scales: { x: Object.assign(_fuelAxis(tech + ' installed capacity (GW)'), { type: 'linear' }), y: _fuelAxis('capture rate, % of baseload') } }) }, 'ppa-cp-vs-capacity');
      setT('capfitSub', `Each point = one year (${st.conv === 'pos' ? 'hours > 0 €/MWh' : 'all hours'}). Log fit on the complete years${(o.excluded || []).length ? ' except ' + o.excluded.join(', ') : ''}; PPE3 targets ${Object.entries(PPE3[st.tech]).map(([y, g]) => y + ' ' + g + ' GW').join(', ')}.`);
    } else if (has('capfit')) noDataMsg(ids.capfit, 'Installed capacity not available', '');
    // daily profiles
    const profYear = String(Math.max(...o.nat.filter(x => x.complete).map(x => x.year)));
    const prof = D.profile[profYear] && D.profile[profYear][st.tech];
    const hrs = [...Array(24).keys()].map(h => h + 'h');
    const profChart = (cid, grid, unit, file) => {
      const avg = hrs.map((_, h) => { const v = grid.map(r => r[h]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 : null; });
      _fuelChart(cid, { type: 'line', data: { labels: hrs, datasets: grid.map((r, m) => ({ label: MONTHS[m], data: r, borderColor: MCOL[m], borderWidth: 1.2, pointRadius: 0, tension: .35, fill: false }))
        .concat([{ label: 'Annual average', data: avg, borderColor: '#FFFFFF', borderWidth: 2.6, pointRadius: 2.5, tension: .35, fill: false }]) },
        options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis(unit, { beginAtZero: true }) } }) }, file);
    };
    if (prof) { if (has('profNat')) profChart(ids.profNat, prof, 'MW', 'ppa-profile-national'); setT('profNatSub', `Average MW by hour, one line per month · France ${profYear} (RTE)`); }
    // asset profile / monthly / annual
    const A = st.asset && st.asset.slots;
    if (A) {
      const grid = MONTHS.map(() => new Array(24).fill(0)), cnt = MONTHS.map(() => new Array(24).fill(0)), monthE = new Array(12).fill(0), monthDays = new Array(12).fill(0), yearE = {};
      A.forEach((arr, d) => { const m = +d.slice(5, 7) - 1, y = d.slice(0, 4); monthDays[m]++; let tot = 0;
        for (let q = 0; q < 96; q++) { const e = arr[q] || 0; tot += e; grid[m][Math.floor(q / 4)] += e * 4 / 1000 / 4; } for (let h = 0; h < 24; h++) cnt[m][h]++; monthE[m] += tot; yearE[y] = (yearE[y] || 0) + tot; });
      const g2 = grid.map((r, m) => r.map((v, h) => cnt[m][h] ? Math.round(v / cnt[m][h] * 100) / 100 : null));
      if (has('profAsset')) profChart(ids.profAsset, g2, 'MW', 'ppa-profile-asset'); setT('profAssetSub', `Same view for ${st.assetName}, all years of the curve`);
      const yrsN = Object.keys(yearE).length || 1, natMW = prof ? prof.map(r => Math.round(r.reduce((a, b) => a + (b || 0), 0) / 24)) : [];
      if (has('monthly')) _fuelChart(ids.monthly, { type: 'bar', data: { labels: MONTHS, datasets: [
        { label: st.assetName + ' (GWh per month, average year)', data: monthE.map((v, m) => monthDays[m] ? Math.round(v / 1e6 * (30.4 / (monthDays[m] / yrsN)) / yrsN * 100) / 100 : null), backgroundColor: tc, borderRadius: 3, yAxisID: 'y' },
        { type: 'line', label: 'National average MW', data: natMW, borderColor: '#FFFFFF', borderDash: [5, 4], borderWidth: 1.6, pointRadius: 3, yAxisID: 'y1' },
      ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('GWh / month', { beginAtZero: true }), y1: _fuelAxis('MW national', { position: 'right', beginAtZero: true, grid: { display: false } }) } }) }, 'ppa-monthly-production');
      const ys = Object.keys(yearE).sort();
      if (has('annual')) _fuelChart(ids.annual, { type: 'bar', data: { labels: ys, datasets: [{ label: st.assetName + ' (GWh per year)', data: ys.map(y => Math.round(yearE[y] / 1e6 * 100) / 100), backgroundColor: tc, borderRadius: 3 }] },
        options: _fuelOpts({ plugins: { legend: { display: false } }, scales: { x: Object.assign(_fuelXAxis(), { grid: { display: false } }), y: _fuelAxis('GWh', { beginAtZero: true }) } }) }, 'ppa-annual-production');
    } else {
      ['profAsset', 'annual'].filter(has).forEach(k => noDataMsg(ids[k], 'Load an asset production curve above', 'Same view for the asset'));
      const natMW = prof ? prof.map(r => Math.round(r.reduce((a, b) => a + (b || 0), 0) / 24)) : [];
      if (has('monthly')) _fuelChart(ids.monthly, { type: 'line', data: { labels: MONTHS, datasets: [{ label: 'National average MW', data: natMW, borderColor: '#FFFFFF', borderDash: [5, 4], borderWidth: 1.6, pointRadius: 3 }] },
        options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('MW national', { beginAtZero: true }) } }) }, 'ppa-monthly-production');
    }
    // rolling capture
    const R = rolling(st), step = 3, idx = R.days.map((_, i) => i).filter(i => i % step === 0 || i === R.days.length - 1);
    const L = idx.map(i => R.days[i]);
    const annualPts = L.map(d => { const y = +d.slice(0, 4); return d.slice(5) >= '07-01' && d.slice(5) < '07-04' && natM.has(y) ? pc1(natM.get(y).cpPct) : null; });
    if (has('rollPct')) _fuelChart(ids.rollPct, { type: 'line', data: { labels: L, datasets: [
      { label: '30 days', data: idx.map(i => R.w30[i] && pc1(R.w30[i].pct)), borderColor: 'rgba(127,200,248,.55)', borderDash: [2, 2], borderWidth: 1, pointRadius: 0, fill: false },
      { label: '90 days', data: idx.map(i => R.w90[i] && pc1(R.w90[i].pct)), borderColor: '#7FC8F8', borderDash: [6, 3], borderWidth: 1.4, pointRadius: 0, fill: false },
      { label: '365 days', data: idx.map(i => R.w365[i] && pc1(R.w365[i].pct)), borderColor: tc, borderWidth: 2.4, pointRadius: 0, fill: false },
      { label: 'Calendar year', data: annualPts, pointStyle: 'rect', pointRadius: 5, backgroundColor: '#3FA6B4', borderColor: '#3FA6B4', showLine: false },
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('capture rate, % of baseload') } }) }, 'ppa-rolling-capture-rate');
    if (has('rollEur')) _fuelChart(ids.rollEur, { type: 'line', data: { labels: L, datasets: [
      { label: 'Baseload, 365 days', data: idx.map(i => R.w365[i] && R.w365[i].base != null ? Math.round(R.w365[i].base * 10) / 10 : null), borderColor: '#B8C9D9', borderWidth: 1.8, pointRadius: 0, fill: false },
      { label: tech + ' captured price, 365 days', data: idx.map(i => R.w365[i] && R.w365[i].cp != null ? Math.round(R.w365[i].cp * 10) / 10 : null), borderColor: tc, borderWidth: 2.4, pointRadius: 0, fill: { target: 0, above: 'rgba(20,211,169,.12)', below: 'rgba(237,105,101,.18)' } },
      { label: tech + ' captured price, 90 days', data: idx.map(i => R.w90[i] && R.w90[i].cp != null ? Math.round(R.w90[i].cp * 10) / 10 : null), borderColor: tc, borderDash: [4, 3], borderWidth: 1, pointRadius: 0, fill: false },
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') } }) }, 'ppa-rolling-captured-price');
    const last = R.w365[R.w365.length - 1], l90 = R.w90[R.w90.length - 1], l30 = R.w30[R.w30.length - 1];
    setT('rollSub', `Latest: 30 days ${pc1(l30 && l30.pct)}% · 90 days ${pc1(l90 && l90.pct)}% · 365 days ${pc1(last && last.pct)}% (${R.days[R.days.length - 1]}) · 100% = no cannibalisation`);
  }

  let busy = false, again = false;
  async function run() {
    if (busy) { again = true; return; }
    busy = true;
    try { await load(); const o = await compute(); renderForwards(o); render(o); try { renderMarket(o); } catch (e) { console.warn('[ppa] market', e); } $('pp-status').textContent = ''; }
    catch (e) { console.warn('[ppa]', e); $('pp-status').textContent = 'Pricing failed: ' + e.message; }
    busy = false; if (again) { again = false; run(); }
  }

  function wire() {
    const page = $('page-ppapricer'); if (!page || page.dataset.wired) return;
    page.dataset.wired = '1';
    const ty = thisYear();
    $('pp-t0').value = ty + 1; $('pp-t1').value = ty + 5;
    const num = (id, key, after) => $(id).addEventListener('change', e => { const v = e.target.value === '' ? null : parseFloat(e.target.value); S[key] = v; if (after) after(); run(); });
    $('pp-tech').addEventListener('change', e => { S.tech = e.target.value; run(); });
    $('pp-basis').addEventListener('change', e => { S.basis = e.target.value; run(); });
    $('pp-model').addEventListener('change', e => { S.model = e.target.value; run(); });
    num('pp-t0', 'tenorStart'); num('pp-t1', 'tenorEnd'); num('pp-pct', 'pct', () => { $('pp-pct-v').textContent = 'P' + S.pct; });
    $('pp-pct').addEventListener('input', e => { $('pp-pct-v').textContent = 'P' + e.target.value; });
    $('pp-conv').addEventListener('change', e => { S.conv = e.target.value; run(); });
    num('pp-imb', 'imb'); num('pp-add', 'add'); num('pp-volrisk', 'volRisk'); num('pp-pricerisk', 'priceRisk'); num('pp-go', 'go'); num('pp-margin', 'margin'); num('pp-volume', 'volume');
    num('pp-vs', 'volStress'); num('pp-ss', 'spotStress');
    const file = $('pp-file');
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      $('pp-status').textContent = 'Reading ' + f.name + '…';
      try { const rows = await window.PKLoadCurve.readFile(f); S.asset = window.PKLoadCurve.build(rows, { unit: $('pp-unit').value, stamp: 'auto' }); S.years = null; S.assetName = f.name.replace(/\.[^.]+$/, ''); $('pp-asset-clear').hidden = false; run(); }
      catch (e) { $('pp-status').textContent = e.message; }
      file.value = '';
    });
    $('pp-asset-clear').addEventListener('click', () => { S.years = null; S.asset = null; S.assetName = ''; $('pp-asset-clear').hidden = true; run(); });
    run();
  }
  window.addEventListener('load', () => setTimeout(() => {
    ['cn-tech', 'cn-conv', 'cn-model'].forEach(id => { const e = $(id); if (e) e.addEventListener('change', () => PKCannib.render()); });
    let cnDone = false;
    const sec = $('hs-renewables-cannib');
    if (sec && window.IntersectionObserver) new IntersectionObserver(es => { if (!cnDone && es.some(e => e.isIntersecting)) { cnDone = true; PKCannib.render(); } }).observe(sec);
    const inner = window.showPage;
    if (typeof inner === 'function') window.showPage = function (id) { const r = inner.apply(this, arguments); if (id === 'ppapricer') wire(); return r; };
  }, 0));
  // ── Site charts: Renewables › Cannibalisation (same engine, PowerKlock data, no asset) ──
  const stFor = p => Object.assign(JSON.parse(JSON.stringify(S0)), { tech: p.tech || 'solar', conv: p.conv || 'pos', model: p.model || 'flat' });
  async function siteDraw(p, ids) { await load(); const st = stFor(p), o = await compute(st); renderMarket(o, st, ids); return o; }
  const TECH = { key: 'tech', label: 'Technology', options: [['solar', 'Solar'], ['wind', 'Wind']], inTitle: true };
  const CONV = { key: 'conv', label: 'Capture convention', options: [['pos', 'Hours with price > 0 (PPA Dashboard)'], ['all', 'All hours']] };
  const MODEL = { key: 'model', label: 'Projection', options: [['flat', 'Flat'], ['damped', 'Damped trend'], ['linear', 'Straight line']] };
  const pageP = () => ({ tech: ($('cn-tech') || {}).value || 'solar', conv: ($('cn-conv') || {}).value || 'pos', model: ($('cn-model') || {}).value || 'flat' });
  if (window.PKW) {
    const reg = (id, title, canvas, desc, params, ids, size) => PKW.register({ id, title, category: 'renewables', page: 'renewables', pageCanvas: canvas, source: 'RTE · ENTSO-E', size: size || { w: 12, h: 6 },
      desc, params, defaults: { tech: 'solar', conv: 'pos', model: 'flat' }, pageParams: pageP,
      titleFn: p => title + ' · ' + (p.tech === 'wind' ? 'wind' : 'solar'),
      async draw(cid, p) { const sub = cid + '-sub'; const o = await siteDraw(p, ids(cid, sub)); const e = document.getElementById(sub); return { sub: e ? e.textContent : '' }; } });
    reg('cannib-projection', 'Capture rate · history and projection', 'cn-proj', 'National capture rate per year, regression on the last three years, P50 with P10–P90 and P25–P75 bands to 2035, PPE3 targets.', [TECH, CONV, MODEL], (c, s2) => ({ proj: c, projSub: s2, projTable: c === 'cn-proj' ? 'cn-proj-table' : null }));
    reg('cannib-capacity', 'Capture rate vs installed capacity', 'cn-capfit', 'One point per year: national capture rate against installed capacity, log fit and the PPE3 2030 / 2035 targets.', [TECH, CONV], (c, s2) => ({ capfit: c, capfitSub: s2 }));
    reg('cannib-rolling', 'Rolling capture rate', 'cn-roll', 'National capture rate over the last 30, 90 and 365 days, with the calendar-year values.', [TECH, CONV], (c, s2) => ({ rollPct: c, rollSub: s2 }));
    reg('cannib-rolling-eur', 'Rolling captured price vs baseload', 'cn-roll-eur', '365-day captured price against the 365-day baseload: the gap is the shape discount in €/MWh.', [TECH, CONV], c => ({ rollEur: c }));
    reg('cannib-profile', 'Daily production profile by month', 'cn-prof', 'Average MW by hour of the day, one line per month, last complete year (RTE).', [TECH], (c, s2) => ({ profNat: c, profNatSub: s2 }), { w: 6, h: 5 });
  }
  window.PKCannib = { render() { const p = pageP(); [['cannib-projection', 'cn-proj'], ['cannib-capacity', 'cn-capfit'], ['cannib-rolling', 'cn-roll'], ['cannib-rolling-eur', 'cn-roll-eur'], ['cannib-profile', 'cn-prof']].forEach(([w, c]) => PKW.draw(w, c, p)); } };
  window.PKPpa = { compute: () => compute(), state: S, run };
})();
