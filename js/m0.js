// ════════════════════════════════════════════════════════════════════
// France M0 — monthly reference prices of the complément de rémunération
// (wind and solar), recomputed from RTE's national production curves and
// the France day-ahead history (scripts/fetch_rte_m0.py → data/m0.json).
// ════════════════════════════════════════════════════════════════════
let _m0Data = null;
async function _m0Load() {
  if (!_m0Data) _m0Data = fetchJSON('m0.json').then(j => j && Array.isArray(j.months) ? j : null);
  return _m0Data;
}
const M0_FMT_MONTH = ym => { const [y, m] = ym.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1] + ' ' + y; };

if (window.PKW) PKW.register({
  id: 'fr-m0', title: 'France M0 reference prices', category: 'renewables', page: 'renewables', pageCanvas: 'ren-m0',
  source: 'RTE · day-ahead', size: { w: 12, h: 5 },
  desc: 'Monthly M0 of the complément de rémunération for wind and solar against baseload, since 2020.',
  params: [
    { key: 'view', label: 'View', options: [['price', '€/MWh'], ['ratio', '% of baseload']] },
    { key: 'win', label: 'Window', options: [['2Y', '2 years'], ['4Y', '4 years'], ['All', 'All']] },
  ],
  defaults: { view: 'price', win: 'All' },
  async draw(cid, p) {
    const j = await _m0Load();
    if (!j || !j.months.length) { noDataMsg(cid, 'M0 history not available', ''); return null; }
    let ms = j.months;
    if (p.win !== 'All') ms = ms.slice(-12 * parseInt(p.win, 10));
    const r = v => v == null ? null : Math.round(v * 10) / 10;
    const lbls = ms.map(m => M0_FMT_MONTH(m.month));
    const ratio = p.view === 'ratio';
    const ds = ratio ? [
      _fuelLineDs('Wind M0 / base', ms.map(m => m.windRatio == null ? null : r(m.windRatio * 100)), C_WOFF, { pointRadius: 2 }),
      _fuelLineDs('Solar M0 / base', ms.map(m => m.solarRatio == null ? null : r(m.solarRatio * 100)), C_SOL, { pointRadius: 2 }),
    ] : [
      _fuelLineDs('Baseload', ms.map(m => r(m.base)), C_TX2, { borderDash: [4, 3], borderWidth: 1.5 }),
      _fuelLineDs('Wind M0', ms.map(m => r(m.windM0)), C_WOFF, { pointRadius: 2 }),
      _fuelLineDs('Solar M0', ms.map(m => r(m.solarM0)), C_SOL, { pointRadius: 2 }),
    ];
    const plugins = { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG };
    if (ratio) plugins.annotation = { annotations: { par: { type: 'line', yMin: 100, yMax: 100, borderColor: 'rgba(184,201,217,.35)', borderWidth: 1, borderDash: [4, 4] } } };
    _fuelChart(cid, { type: 'line', data: { labels: lbls, datasets: ds },
      options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis(ratio ? '% of baseload' : '€/MWh') }, plugins }) }, 'fr-m0-' + p.view);
    const last = ms[ms.length - 1];
    return { sub: 'Monthly · ' + M0_FMT_MONTH(ms[0].month) + ' → ' + M0_FMT_MONTH(last.month) + ' · latest RTE publication' };
  },
});

async function renderM0() {
  if (!document.getElementById('ren-m0')) return;
  const view = (document.querySelector('#m0-view .pk-gf-btn.active') || {}).dataset?.v || 'price';
  PKW.draw('fr-m0', 'ren-m0', { view, win: 'All' }).then(res => {
    const sub = document.getElementById('ren-m0-sub'); if (sub && res && res.sub) sub.textContent = res.sub;
  });
  const j = await _m0Load();
  const tb = document.getElementById('m0-tbody');
  if (!tb) return;
  if (!j) { tb.innerHTML = '<tr><td colspan="8" style="color:var(--text3)">M0 history not available</td></tr>'; return; }
  const pct = v => v == null ? '–' : (v * 100).toFixed(0) + '%';
  const crCell = v => `<td style="color:${v == null ? 'var(--text3)' : v >= 0.995 ? 'var(--up)' : 'var(--down)'};font-weight:600">${pct(v)}</td>`;
  tb.innerHTML = j.months.slice(-12).reverse().map(m =>
    `<tr><td>${M0_FMT_MONTH(m.month)}${m.complete ? '' : ' <span title="Some day-ahead prices missing for this month" style="color:var(--text3)">*</span>'}</td>` +
    `<td>${_fuelFmt(m.base)}</td><td>${_fuelFmt(m.windM0)}</td>${crCell(m.windRatio)}<td>${_fuelFmt(m.solarM0)}</td>${crCell(m.solarRatio)}` +
    `<td>${pct(m.windNegShare)}</td><td>${pct(m.solarNegShare)}</td></tr>`).join('');
}
function m0SetView(v, btn) {
  btn.parentNode.querySelectorAll('.pk-gf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderM0();
}
