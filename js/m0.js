// ════════════════════════════════════════════════════════════════════
// France M0 — reference prices of the complément de rémunération
// (scripts/fetch_cre_m0.py → data/cre_m0.json)
//   CRE M0 (official)        — CRE open data, published 5 working days
//                              (base) / 4 weeks (wind, solar) after the month
//   Estimated M0 (PowerKlock) — the CRE method on PowerKlock data, for the
//                              month to date and months not yet published:
//                              prices ≥ 0 weighted by RTE national output
//   Forecast M0              — forward baseload × M0 / mean price ratio of
//                              the same month over the last three years
// ════════════════════════════════════════════════════════════════════
let _m0Data = null;
async function _m0Load() {
  if (!_m0Data) _m0Data = fetchJSON('cre_m0.json').then(j => j && j.official ? j : null);
  return _m0Data;
}
const M0_FMT_MONTH = ym => { const [y, m] = ym.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1] + ' ' + y; };
const M0_TECH = { solar: ['Solar', C_SOL], wind: ['Wind', C_WOFF], base: ['Base', '#B8C9D9'] };
const M0_OFF = (j, tech) => tech === 'base' ? j.official.monthly : j.official[tech];

// Timeline of one M0: official, estimate where the CRE has not published, forecast with its range
function _m0Series(j, tech, win) {
  const off = M0_OFF(j, tech) || {}, est = j.estimate || {}, fc = j.forecast || [];
  const allM = [...new Set([...Object.keys(off), ...Object.keys(est), ...fc.map(r => r.month)])].sort();
  const n = { '2Y': 24, '4Y': 48, 'All': 9999 }[win] || 36;
  const lastOff = Object.keys(off).sort().pop();
  const months = allM.filter(m => m >= (allM[allM.length - 1 - fc.length - n] || allM[0]));
  const fcM = new Map(fc.map(r => [r.month, r]));
  return { months, lastOff, off, est, fcM };
}

if (window.PKW) {
  const TECH = { key: 'tech', label: 'Technology', options: [['solar', 'Solar'], ['wind', 'Wind'], ['base', 'Base (all hours ≥ 0)']], inTitle: true };
  PKW.register({
    id: 'fr-m0', title: 'France M0', category: 'renewables', page: 'renewables', pageCanvas: 'ren-m0',
    source: 'CRE · PowerKlock', size: { w: 12, h: 5 },
    desc: 'Monthly M0 of the complément de rémunération: CRE official values, PowerKlock estimate for months not yet published, forecast from the forwards with its range, and the capture price with negative prices included.',
    params: [TECH, { key: 'view', label: 'View', options: [['price', '€/MWh'], ['ratio', '% of the mean day-ahead price']] }, { key: 'win', label: 'History', options: [['2Y', '2 years'], ['4Y', '4 years'], ['All', 'Since 2017']] }],
    defaults: { tech: 'solar', view: 'price', win: '2Y' },
    titleFn: p => 'France M0 · ' + M0_TECH[p.tech || 'solar'][0].toLowerCase(),
    pageParams: () => ({ tech: (document.getElementById('m0-tech') || {}).value || 'solar', view: (document.querySelector('#m0-view .pk-gf-btn.active') || {}).dataset?.v || 'price', win: '2Y' }),
    async draw(cid, p) {
      const j = await _m0Load();
      if (!j) { noDataMsg(cid, 'M0 not available', ''); return null; }
      const tech = p.tech || 'solar', [lbl, col] = M0_TECH[tech], ratio = p.view === 'ratio';
      const { months, lastOff, off, est, fcM } = _m0Series(j, tech, p.win);
      const baseAll = m => (est[m] && est[m].baseAll) || (fcM.get(m) && fcM.get(m).forward) || null;
      const v = x => x == null ? null : ratio ? null : Math.round(x * 100) / 100;
      const conv = (m, x) => x == null ? null : ratio ? (baseAll(m) ? Math.round(x / baseAll(m) * 1000) / 10 : null) : Math.round(x * 100) / 100;
      const estOnly = m => !off[m] && est[m] ? (tech === 'base' ? est[m].base : est[m][tech]) : null;
      const firstFc = months.find(m => fcM.has(m));
      const ds = [
        { label: '_lo', data: months.map(m => fcM.has(m) ? conv(m, fcM.get(m)[tech + 'Lo']) : null), borderWidth: 0, pointRadius: 0, fill: false },
        { label: 'Forecast range (3 years)', data: months.map(m => fcM.has(m) ? conv(m, fcM.get(m)[tech + 'Hi']) : null), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(168,125,196,.18)', fill: '-1' },
        { label: 'CRE M0 (official)', data: months.map(m => conv(m, off[m])), borderColor: col, backgroundColor: col, borderWidth: 2.4, pointRadius: 2.5, fill: false },
        { label: 'Estimated M0 (PowerKlock)', data: months.map(m => m === lastOff ? conv(m, off[m]) : conv(m, estOnly(m))), borderColor: col, borderDash: [2, 3], borderWidth: 1.8, pointRadius: months.map(m => estOnly(m) != null ? 3 : 0), pointStyle: 'rectRot', fill: false, spanGaps: true },
        { label: 'Forecast M0', data: months.map(m => fcM.has(m) ? conv(m, fcM.get(m)[tech]) : m === months[months.indexOf(firstFc) - 1] ? conv(m, off[m] != null ? off[m] : estOnly(m)) : null), borderColor: '#A87DC4', borderDash: [6, 4], borderWidth: 2, pointRadius: months.map(m => fcM.has(m) ? 2.5 : 0), fill: false, spanGaps: true },
        ...(tech !== 'base' ? [
          { label: 'Capture price (negative prices included)', data: months.map(m => est[m] ? conv(m, est[m][tech + 'Cap']) : null), borderColor: '#ED6965', borderWidth: 1.6, pointRadius: 1.5, fill: false, spanGaps: true },
          { label: 'Capture price forecast', data: months.map(m => fcM.has(m) ? conv(m, fcM.get(m)[tech + 'Cap']) : null), borderColor: '#ED6965', borderDash: [6, 4], borderWidth: 1.4, pointRadius: 0, fill: false, spanGaps: true },
        ] : []),
        ...(!ratio && tech !== 'base' ? [{ label: 'Mean day-ahead price / forward', data: months.map(m => v(baseAll(m))), borderColor: 'rgba(184,201,217,.55)', borderWidth: 1.2, pointRadius: 0, fill: false, spanGaps: true }] : []),
      ];
      _fuelChart(cid, { type: 'line', data: { labels: months.map(M0_FMT_MONTH), datasets: ds },
        options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10, filter: it => !/^_/.test(it.text) } } },
          scales: { x: _fuelXAxis(), y: _fuelAxis(ratio ? '% of the mean day-ahead price' : '€/MWh') } }) }, 'fr-m0-' + tech);
      const lastEst = Object.keys(est).sort().filter(m => !off[m] && (!lastOff || m > lastOff));
      return { sub: `${lbl} · CRE official to ${lastOff ? M0_FMT_MONTH(lastOff) : '–'}${lastEst.length ? ' · PowerKlock estimate for ' + lastEst.map(M0_FMT_MONTH).join(', ') : ''} · forecast from the forwards of ${j.forwardDate || '–'}` };
    },
  });
  PKW.register({
    id: 'fr-m0-forecast', kind: 'html', title: 'France M0 forecast', category: 'renewables', page: 'renewables', source: 'PowerKlock', size: { w: 12, h: 6 },
    desc: 'Coming months: forward baseload and the base, wind and solar M0 it implies with the ratios of the last three years (range low–high).',
    async html(host) {
      const j = await _m0Load(); if (!j) { host.innerHTML = '<div class="fuel-note">Not available.</div>'; return; }
      const f = v => v == null ? '–' : v.toFixed(2), est = j.estimate || {}, cur = j.currentMonth, e = est[cur];
      const row = r => `<tr><td style="text-align:left">${M0_FMT_MONTH(r.month)} <span class="mu-kind">${r.from}</span></td><td>${f(r.forward)}</td><td>${f(r.base)}</td>` +
        ['wind', 'windCap', 'solar', 'solarCap'].map(t => `<td${/Cap/.test(t) ? ' class="m0-cap"' : ''}><b>${f(r[t])}</b><span class="m0-rng">${f(r[t + 'Lo'])}–${f(r[t + 'Hi'])}</span></td>`).join('') + '</tr>';
      host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Month</th><th>Forward base</th><th>Base M0</th><th>Wind M0</th><th>Wind capture</th><th>Solar M0</th><th>Solar capture</th></tr></thead><tbody>` +
        (e ? `<tr class="m0-now"><td style="text-align:left">${M0_FMT_MONTH(cur)} <span class="mu-kind">to date · ${e.days} days</span></td><td>${f(e.baseAll)}</td><td>${f(e.base)}</td><td><b>${f(e.wind)}</b></td><td class="m0-cap"><b>${f(e.windCap)}</b></td><td><b>${f(e.solar)}</b></td><td class="m0-cap"><b>${f(e.solarCap)}</b></td></tr>` : '') +
        (j.forecast || []).map(row).join('') + `</tbody></table></div><div class="fuel-note">€/MWh. Current month: PowerKlock estimate to date with the CRE method (prices ≥ 0, RTE output). Coming months: forward baseload of the month (month contract, else what its quarter or year leaves) × the M0 / mean day-ahead price ratio of the same month over the last three years; range = lowest and highest year. M0 = prices ≥ 0 only (CRE); capture = every step, negative prices included (what an asset producing through negative hours earns on the spot). Forwards of ${j.forwardDate || '–'}.</div>`;
    },
  });
  PKW.register({
    id: 'fr-m0-official', kind: 'html', title: 'France M0 · CRE and PowerKlock estimate', category: 'renewables', page: 'renewables', source: 'CRE · PowerKlock', size: { w: 12, h: 6 },
    desc: 'Last 12 months: official CRE M0 (base, wind, solar), the PowerKlock estimate with the same method and the hours with a negative price.',
    async html(host) {
      const j = await _m0Load(); if (!j) { host.innerHTML = '<div class="fuel-note">Not available.</div>'; return; }
      const o = j.official, est = j.estimate || {}, f = v => v == null ? '–' : v.toFixed(2);
      const ms = [...new Set([...Object.keys(o.monthly), ...Object.keys(est)])].sort().slice(-12).reverse();
      // record of the estimate since 2023: mean absolute gap and bias against the CRE, per technology
      const rec = k => { const g = Object.keys(o[k] || {}).filter(m => m >= '2023' && est[m] && est[m][k === 'monthly' ? 'base' : k] != null).map(m => est[m][k === 'monthly' ? 'base' : k] - o[k][m]);
        return g.length ? `${k === 'monthly' ? 'base' : k} ${(g.reduce((s, x) => s + Math.abs(x), 0) / g.length).toFixed(2)} €/MWh (bias ${(g.reduce((s, x) => s + x, 0) / g.length >= 0 ? '+' : '')}${(g.reduce((s, x) => s + x, 0) / g.length).toFixed(2)}, ${g.length} months)` : ''; };
      const record = ['monthly', 'wind', 'solar'].map(rec).filter(Boolean).join(' · ');
      const gap = (a, b) => a == null || b == null ? '' : `<span class="m0-gap">${(b - a >= 0 ? '+' : '') + (b - a).toFixed(2)}</span>`;
      host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Month</th><th>Base M0</th><th>Wind M0</th><th>Wind capture</th><th>Solar M0</th><th>Solar capture</th><th>Negative hours</th></tr></thead><tbody>` +
        ms.map(m => { const e = est[m] || {}, cell = (cre, es) => cre != null ? `<b>${f(cre)}</b>${gap(cre, es)}` : es != null ? `<span class="m0-est" title="PowerKlock estimate, CRE not published yet">${f(es)} est.</span>` : '–';
          const neg = o.negSteps[m] ? o.negSteps[m].hours : e.negHours;
          return `<tr><td style="text-align:left">${M0_FMT_MONTH(m)}</td><td>${cell(o.monthly[m], e.base)}</td><td>${cell(o.wind[m], e.wind)}</td><td class="m0-cap">${f(e.windCap)}</td><td>${cell(o.solar[m], e.solar)}</td><td class="m0-cap">${f(e.solarCap)}</td><td>${neg == null ? '–' : neg.toFixed(neg % 1 ? 2 : 0) + ' h'}</td></tr>`; }).join('') +
        `</tbody></table></div><div class="fuel-note">Bold: CRE official value; small figure: gap of the PowerKlock estimate (same method on RTE éCO2mix output). "est.": not published by the CRE yet (base 5 working days, wind and solar 4 weeks after the month). The CRE solar profile covers plants above 250 kWc, PowerKlock uses all national solar: expect 1–3 €/MWh of gap on solar.${record ? ' <b>Record of the estimate since 2023</b>, mean gap to the CRE: ' + record + '.' : ''} Capture (red): PowerKlock, same weighting with every step, negative prices included.</div>`;
    },
  });
}

async function renderM0() {
  if (!document.getElementById('ren-m0')) return;
  const p = PKW.get('fr-m0').pageParams();
  PKW.draw('fr-m0', 'ren-m0', p).then(res => { const sub = document.getElementById('ren-m0-sub'); if (sub && res && res.sub) sub.textContent = res.sub; });
  const fc = document.getElementById('m0-forecast'); if (fc) { await PKW.get('fr-m0-forecast').html(fc); PKW.star('fr-m0-forecast', 'm0-forecast'); }
  const of = document.getElementById('m0-official'); if (of) { await PKW.get('fr-m0-official').html(of); PKW.star('fr-m0-official', 'm0-official'); }
  const j = await _m0Load(), ann = document.getElementById('m0-annual');
  if (j && ann) {
    const a = j.official.annual, w = j.official.winter, f = v => v == null ? '–' : v.toFixed(2);
    ann.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Year</th><th>Annual M0</th><th style="text-align:left">Contractual winter</th><th>Winter M0</th></tr></thead><tbody>` +
      Object.keys(a).sort().reverse().map((y, i) => { const wk = Object.keys(w).sort().reverse()[i]; return `<tr><td style="text-align:left">${y}</td><td>${f(a[y])}</td><td style="text-align:left">${wk || ''}</td><td>${wk ? f(w[wk]) : ''}</td></tr>`; }).join('') +
      `</tbody></table></div><div class="fuel-note">CRE: annual M0 = mean of the day-ahead prices ≥ 0 of the year; winter M0 = 20 % spot (≥ 0) of the winter + 15 % M11 + 15 % M12 + 50 % Q1 forwards (EEX).</div>`;
  }
}
function m0SetView(v, btn) {
  btn.parentNode.querySelectorAll('.pk-gf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderM0();
}
