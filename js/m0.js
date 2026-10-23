// ════════════════════════════════════════════════════════════════════
// France M0 — reference prices of the complément de rémunération
// (scripts/fetch_cre_m0.py → data/cre_m0.json)
//   CRE M0 (official)        — CRE open data, published 5 working days
//                              (base) / 4 weeks (wind, solar) after the month
//   Estimated M0 (PowerKlock) — the CRE method on PowerKlock data, for the
//                              month to date and months not yet published:
//                              prices ≥ 0 weighted by the output of the parks under
//                              complément de rémunération (ODRÉ) once published, else
//                              by RTE national output
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
        (j.forecast || []).map(row).join('') + `</tbody></table></div><div class="fuel-note">€/MWh. Current month: PowerKlock estimate to date with the CRE method (prices ≥ 0, RTE national output until the parks' own output is published). Coming months: forward baseload of the month (month contract, else what its quarter or year leaves) × the M0 / mean day-ahead price ratio of the same month over the last three years; range = lowest and highest year. M0 = prices ≥ 0 only (CRE); capture = every step, negative prices included (what an asset producing through negative hours earns on the spot). Forwards of ${j.forwardDate || '–'}.</div>`;
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
        `</tbody></table></div><div class="fuel-note">Bold: CRE official value; small figure: gap of the PowerKlock estimate (same method, weighted by the output of the parks under complément de rémunération published by ODRÉ, a few cents from the CRE; RTE national output for the latest weeks). "est.": not published by the CRE yet (base 5 working days, wind and solar 4 weeks after the month). The CRE solar profile covers plants above 250 kWc, PowerKlock uses all national solar: expect 1–3 €/MWh of gap on solar.${record ? ' <b>Record of the estimate since 2023</b>, mean gap to the CRE: ' + record + '.' : ''} Capture (red): PowerKlock, same weighting with every step, negative prices included.</div>`;
    },
  });
}

// ── CRE renewable tenders (data/cre_tenders.json): the price kept at each period, against the M0 the market paid
//    the same technology over the 12 months before the result (CRE official monthly M0) ──
const M0_AO = [['Photovoltaïque sol', 'Solar, ground', '#FBBF24', 'solar'], ['Photovoltaïque bâtiment', 'Solar, rooftop', '#F59E0B', 'solar'], ['Éolien terrestre', 'Onshore wind', '#7FC8F8', 'wind'], ['Neutre', 'Technology-neutral', '#A87DC4', 'solar']];
let _aoData = null;
const _aoLoad = () => _aoData || (_aoData = fetchJSON('cre_tenders.json').then(j => j && j.rows ? j : null));
const _m0Trail = (off, ym) => { const ks = Object.keys(off || {}).filter(k => k < ym).sort().slice(-12); return ks.length >= 6 ? ks.reduce((a, k) => a + off[k], 0) / ks.length : null; };
if (window.PKW) {
  PKW.register({
    id: 'cre-tenders', title: 'CRE tenders · price kept vs M0', category: 'renewables', page: 'renewables', pageCanvas: 'ren-ao',
    source: 'CRE open data', size: { w: 12, h: 5 },
    desc: 'Average price kept at each period of the CRE renewable tenders (ground and rooftop solar, onshore wind, technology-neutral), against the M0 the market paid the same technology over the 12 months before the result.',
    async draw(cid) {
      const [ao, j] = await Promise.all([_aoLoad(), _m0Load()]);
      if (!ao) { noDataMsg(cid, 'Tender results not available', ''); return null; }
      const rows = ao.rows.filter(r => r.result && M0_AO.some(t => t[0] === r.tech));
      const first = rows.reduce((a, r) => r.result < a ? r.result : a, '9999').slice(0, 7), now = new Date().toISOString().slice(0, 7);
      const months = []; for (let d = new Date(first + '-01T12:00:00Z'); d.toISOString().slice(0, 7) <= now; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
      const ds = M0_AO.map(([k, lab, col]) => { const by = {}; rows.filter(r => r.tech === k).forEach(r => { by[r.result.slice(0, 7)] = r.price; });
        return _fuelLineDs(lab + ' · price kept', months.map(m => by[m] ?? null), col, { spanGaps: true, pointRadius: 3, borderWidth: 1.5 }); });
      if (j) [['solar', 'M0 solar, 12 months', '#FDE68A'], ['wind', 'M0 wind, 12 months', '#BAE6FD']].forEach(([t, lab, col]) =>
        ds.push(_fuelLineDs(lab, months.map(m => { const v = _m0Trail(j.official[t], m); return v == null ? null : +v.toFixed(2); }), col, { borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0 })));
      _fuelChart(cid, { type: 'line', data: { labels: months, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') }, plugins: { legend: { labels: { color: C_TX2, font: { size: 10 }, boxWidth: 14 } } } }) }, 'cre-tenders');
      const last = rows[rows.length - 1];
      return { sub: `${rows.length} periods since ${first.slice(0, 4)} · last: ${last.tech} ${last.ao} ${last.period}, ${last.price.toFixed(2)} €/MWh (${last.result})` };
    },
  });
  PKW.register({
    id: 'cre-tenders-table', kind: 'html', title: 'CRE tenders · latest results', category: 'renewables', page: 'renewables', source: 'CRE open data', size: { w: 12, h: 5 },
    desc: 'Latest period of each CRE renewable tender: date, volume offered and kept, average price kept, and its gap to the M0 of the 12 months before (negative: the market paid more than the tender price, the contract pays back).',
    async html(host) {
      const [ao, j] = await Promise.all([_aoLoad(), _m0Load()]);
      if (!ao) { host.innerHTML = '<div class="fuel-note">Tender results not available.</div>'; return; }
      const f = v => v == null ? '–' : v.toFixed(2);
      const rows = M0_AO.map(([k, lab, , t]) => { const rs = ao.rows.filter(r => r.tech === k && r.result); return rs.length ? [lab, t, rs[rs.length - 1], rs[rs.length - 2]] : null; }).filter(Boolean);
      host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Tender</th><th style="text-align:left">Period</th><th>Result</th><th>MW kept / offered</th><th>Price kept</th><th>vs previous</th><th>M0, 12 months</th><th>Price − M0</th></tr></thead><tbody>` +
        rows.map(([lab, t, r, p]) => { const m0 = j ? _m0Trail(j.official[t], r.result.slice(0, 7)) : null, g = m0 != null ? r.price - m0 : null, dp = p ? r.price - p.price : null;
          return `<tr><td style="text-align:left">${lab}</td><td style="text-align:left">${r.ao} ${r.period}</td><td>${r.result}</td><td>${r.kept_mw != null ? Math.round(r.kept_mw) : '–'} / ${r.offered_mw != null ? Math.round(r.offered_mw) : '–'}</td><td><b>${f(r.price)}</b></td><td class="${dp > 0 ? 'mu-up' : dp < 0 ? 'mu-dn' : ''}">${dp == null ? '–' : (dp > 0 ? '+' : '') + f(dp)}</td><td>${f(m0)}</td><td class="${g > 0 ? 'mu-up' : g < 0 ? 'mu-dn' : ''}">${g == null ? '–' : (g > 0 ? '+' : '') + f(g)}</td></tr>`; }).join('') +
        `</tbody></table></div><div class="fuel-note">€/MWh. Price kept: average of the projects the CRE proposes to keep. Price − M0 below zero: over the last 12 months the market paid that technology more than the tender price, so the contract would pay back. Source: CRE open data, updated at each result.</div>`;
    },
  });
}

// ── public cost of the support to renewables by technology (CRE deliberation each July, data/cspe.json) ──
if (window.PKW) PKW.register({
  id: 'cspe-enr', title: 'Public cost of renewable support', category: 'renewables', page: 'renewables', pageCanvas: 'ren-cspe',
  source: 'CRE deliberation', size: { w: 6, h: 5 },
  desc: 'Charges of public service paid to support renewable power in mainland France, by technology (M€): observed for past years, CRE forecast for the coming ones. Negative: the market paid more than the support contracts.',
  async draw(cid) {
    const j = await fetchJSON('cspe.json');
    const Y = j && j.years ? Object.keys(j.years).sort() : [];
    if (!Y.length) { noDataMsg(cid, 'CSPE not available', ''); return null; }
    const pick = y => j.years[y].observed ? ['observed', j.years[y].observed] : ['forecast', j.years[y].forecast];
    const T = [['solar', 'Solar', '#FBBF24'], ['onshore', 'Onshore wind', '#7FC8F8'], ['offshore', 'Offshore wind', '#38BDF8'], ['bio', 'Bio-energies', '#86EFAC'], ['other', 'Other', '#94A3B8']];
    const ds = T.map(([k, lab, col]) => ({ label: lab, data: Y.map(y => (pick(y)[1] || {})[k] ?? null), backgroundColor: Y.map(y => pick(y)[0] === 'forecast' ? col + '66' : col), borderColor: col, borderWidth: Y.map(y => pick(y)[0] === 'forecast' ? 1 : 0), stack: 's' }));
    _fuelChart(cid, { type: 'bar', data: { labels: Y.map(y => y + (pick(y)[0] === 'forecast' ? ' (forecast)' : '')), datasets: ds },
      options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: Object.assign(_fuelAxis('M€'), { stacked: true }) }, plugins: { legend: { labels: { color: C_TX2, font: { size: 10 }, boxWidth: 12 } } } }) }, 'cspe-enr');
    const ly = Y[Y.length - 1], lo = Y.filter(y => j.years[y].observed).pop(), tot = y => (pick(y)[1] || {}).total_power;
    return { sub: `${lo ? `Observed ${lo}: ${Math.round(tot(lo)).toLocaleString('en-GB')} M€` : ''}${ly !== lo ? ` · forecast ${ly}: ${Math.round(tot(ly)).toLocaleString('en-GB')} M€` : ''} · renewable power, mainland France` };
  },
});

async function renderM0() {
  if (!document.getElementById('ren-m0')) return;
  const p = PKW.get('fr-m0').pageParams();
  PKW.draw('fr-m0', 'ren-m0', p).then(res => { const sub = document.getElementById('ren-m0-sub'); if (sub && res && res.sub) sub.textContent = res.sub; });
  const fc = document.getElementById('m0-forecast'); if (fc) { await PKW.get('fr-m0-forecast').html(fc); PKW.star('fr-m0-forecast', 'm0-forecast'); }
  const of = document.getElementById('m0-official'); if (of) { await PKW.get('fr-m0-official').html(of); PKW.star('fr-m0-official', 'm0-official'); }
  if (document.getElementById('ren-ao')) PKW.draw('cre-tenders', 'ren-ao', {}).then(res => { const e = document.getElementById('ren-ao-sub'); if (e && res && res.sub) e.textContent = res.sub; });
  if (document.getElementById('ren-cspe')) PKW.draw('cspe-enr', 'ren-cspe', {}).then(res => { const e = document.getElementById('ren-cspe-sub'); if (e && res && res.sub) e.textContent = res.sub; });
  const aot = document.getElementById('m0-ao'); if (aot) { await PKW.get('cre-tenders-table').html(aot); PKW.star('cre-tenders-table', 'm0-ao'); }
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
