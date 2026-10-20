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
    volume: 52000, curtail: true, model: 'flat', volStress: 20, spotStress: 20, asset: null, assetName: '', basis: 'asset' };
  let D = null;   // reference data

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
    const [daily, mkt, goCsv] = await Promise.all([get('history/rte/fr_daily.json'), get('fr_market.json'), fetch(DATA_BASE + 'go_prices.csv').then(r => r.ok ? r.text() : '').catch(() => '')]);
    const fwd = {};
    ((mkt && mkt.forwardCurve) || []).forEach(r => { const m = /Cal\s?(\d{4})/.exec(r.contract || ''); if (m && r.value != null) fwd[+m[1]] = r.value; });
    // GO: latest Commerg mid per production year (AIB renewable)
    const go = {};
    goCsv.split(/\r?\n/).slice(1).forEach(l => { const c = l.split(','); if (c.length < 8 || !/Renewable/i.test(c[4])) return; const bid = parseFloat(c[6]), ask = parseFloat(c[7]); const mid = isFinite(bid) && isFinite(ask) ? (bid + ask) / 2 : isFinite(bid) ? bid : null; if (mid != null && (!go[c[5]] || c[1] >= go[c[5]].d)) go[c[5]] = { d: c[1], v: mid }; });
    D = { rows: (daily && daily.rows) || [], fwd, fwdDate: mkt && mkt.forwardCurve && mkt.forwardCurve[0] && mkt.forwardCurve[0].date, go };
    return D;
  }

  // National capture history: output-weighted capture price ÷ average baseload, per year
  function nationalYears() {
    const key = S.tech === 'solar' ? ['solarAvg', 'sCap'] : ['windAvg', 'wCap'];
    const acc = {};
    D.rows.forEach(r => { if (r.base == null) return; const y = +r.d.slice(0, 4); const a = acc[y] || (acc[y] = { n: 0, base: 0, w: 0, wp: 0 }); a.n++; a.base += r.base;
      const o = r[key[0]], c = r[key[1]]; if (o != null && c != null) { a.w += o; a.wp += o * c; } });
    return Object.keys(acc).map(Number).sort().map(y => { const a = acc[y], base = a.base / a.n, cp = a.w ? a.wp / a.w : null;
      return { year: y, base, cp, cpPct: cp != null && base > 0 ? cp / base : null, sd: cp != null && base > 0 ? 1 - cp / base : null, days: a.n, complete: y < thisYear() && a.n >= 360 }; })
      .filter(x => x.cpPct != null);
  }
  // Asset capture history: curve × France quarter-hour prices
  async function assetYears() {
    const slots = S.asset.slots, days = [...slots.keys()].sort(), years = [...new Set(days.map(d => d.slice(0, 4)))];
    const files = await Promise.all(years.map(y => get('history/fr_prices/' + y + '.json')));
    const P = {}; files.forEach(f => { if (f && f.days) Object.assign(P, f.days); });
    const acc = {};
    days.forEach(d => { const p = P[d]; if (!p) return; const c = slots.get(d), y = +d.slice(0, 4), a = acc[y] || (acc[y] = { n: 0, bs: 0, bn: 0, e: 0, rev: 0, all: 0, neg: 0 }); a.n++;
      for (let q = 0; q < 96; q++) { if (p[q] == null) continue; a.bs += p[q]; a.bn++; const e = c[q] || 0; a.all += e; if (!e) continue;
        if (p[q] < 0) { a.neg += e; if (S.curtail) continue; } a.e += e; a.rev += e * p[q]; } });
    return Object.keys(acc).map(Number).sort().map(y => { const a = acc[y], base = a.bs / a.bn, cp = a.e ? a.rev / a.e : null;
      return { year: y, base, cp, cpPct: cp != null && base > 0 ? cp / base : null, sd: cp != null && base > 0 ? 1 - cp / base : null, days: a.n, mwh: a.e / 1000, mwhAll: a.all / 1000, negMwh: a.neg / 1000, complete: a.n >= 330 && y < thisYear() }; })
      .filter(x => x.cpPct != null);
  }

  async function compute() {
    await load();
    const nat = nationalYears();
    const ast = S.asset ? (await assetYears()) : null;
    const useAsset = ast && ast.length >= 1 && S.basis === 'asset';
    const hist = useAsset ? ast : nat;
    // Years used: chosen one by one; by default the last three complete years.
    // The percentile and the regression use the same years.
    const complete = hist.filter(x => x.complete);
    const def = (complete.length ? complete : hist).slice(-3).map(x => x.year);
    const sel = (S.years || def).filter(y => hist.some(x => x.year === y));
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
      return clamp(S.model === 'flat' ? start : S.model === 'linear' ? start + reg.sl * t : start + 2 * reg.sl * (1 - Math.pow(0.5, t))); };
    const fitLine = y => clamp(reg.ic + reg.sl * y);
    const ty = thisYear(), t0 = S.tenorStart || ty + 1, t1 = Math.max(t0, S.tenorEnd || t0 + 4);
    const known = Object.keys(D.fwd).map(Number).sort();
    const fwdFor = y => S.fwd[y] != null ? S.fwd[y] : D.fwd[y] != null ? D.fwd[y] : known.length ? D.fwd[known.filter(k => k <= y).pop() || known[0]] : 60;
    const tenor = []; for (let y = t0; y <= t1; y++) tenor.push(y);
    const fwds = tenor.map(fwdFor), ref = fwds.reduce((a, b) => a + b, 0) / fwds.length;
    const goMkt = (() => { const v = tenor.map(y => D.go[y] && D.go[y].v).filter(v => v != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();
    const goVal = S.go != null ? S.go : goMkt != null ? goMkt : 1.0;
    const sdCh = percentile(histSd, S.pct);
    const price = (f, sd) => f - f * (sd + S.add / 100 + S.volRisk / 100 + S.priceRisk / 100) - S.imb + goVal + S.margin;
    const ppa = price(ref, sdCh);
    const volume = useAsset ? (() => { const full = ast.filter(x => x.days >= 330); return full.length ? full.reduce((a, x) => a + x.mwh, 0) / full.length : ast[ast.length - 1].mwh * 365 / ast[ast.length - 1].days; })() : S.volume;
    const years = tenor.map((y, i) => { const fsd = proj(y), cp = fwds[i] * (1 - fsd); return { y, fwd: fwds[i], fsd, cp, ppaY: price(fwds[i], fsd), pnl: cp - ppa, pnlK: volume * (cp - ppa) / 1000 }; });
    const pcts = [...Array(100).keys()].map(i => i + 1), sdP = pcts.map(p => percentile(histSd, p));
    const pnlCurve = sdP.map(sd => volume * (ref * (1 - sd) - ppa) / 1000);
    const be = pcts.find((p, i) => pnlCurve[i] < 0) || null;
    // stress scenarios (same table as the PPA Dashboard): total over the tenor, k€
    const n = tenor.length, med = percentile(histSd, 50), p10 = percentile(histSd, 10), p90 = percentile(histSd, 90), vs = S.volStress / 100, ss = S.spotStress / 100;
    const scen = [['Base', 1, 0, 0], ['Cannibalisation +' + S.volStress + ' %', 1, vs, 0], ['Cannibalisation −' + S.volStress + ' %', 1, -vs, 0], ['Spot +' + S.spotStress + ' %', 1 + ss, 0, 0], ['Spot −' + S.spotStress + ' %', 1 - ss, 0, 0],
      ['Volume +' + S.volStress + ' %', 1, 0, vs], ['Volume −' + S.volStress + ' %', 1, 0, -vs], ['Total stress', 1 - ss, vs, -vs], ['Total bull', 1 + ss, -vs, vs]]
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
    if (ad) ad.textContent = o.ast ? `${S.assetName}: ${o.ast.map(x => x.year + ' ' + pc(x.cpPct) + (x.negMwh > 0.05 && S.curtail ? ' (' + f0(x.negMwh) + ' MWh at negative prices left out)' : '')).join(' · ')}` : 'No asset curve: national ' + tech.toLowerCase() + ' profile (RTE) used.';
    const goNote = $('pp-go-note'); if (goNote) goNote.textContent = o.goMkt != null ? `Market: ${f2(o.goMkt)} €/MWh (Commerg, AIB renewable, tenor years)` : '';
  }

  let busy = false, again = false;
  async function run() {
    if (busy) { again = true; return; }
    busy = true;
    try { await load(); const o = await compute(); renderForwards(o); render(o); $('pp-status').textContent = ''; }
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
    $('pp-curtail').addEventListener('change', e => { S.curtail = e.target.checked; run(); });
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
    const inner = window.showPage;
    if (typeof inner === 'function') window.showPage = function (id) { const r = inner.apply(this, arguments); if (id === 'ppapricer') wire(); return r; };
  }, 0));
  window.PKPpa = { compute: () => compute(), state: S, run };
})();
