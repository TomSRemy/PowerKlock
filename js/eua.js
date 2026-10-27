// ════════════════════════════════════════════════════════════════════
// CARBON & FUELS · FORWARD CURVES · CLEAN SPARK / DARK SPREADS
// All three pages read real data only:
//   - data/commodities.json (+ history file) via window.PKC (commodities.js)
//   - data/fr_market.json (power forward curves, SEFE)
//   - pricesData / data/history/summary.json (ENTSO-E day-ahead)
// Fuel-cost conventions live in PKC.FUEL so every page agrees.
// ════════════════════════════════════════════════════════════════════

const FUEL_STATE = {
  fuel: { w: '1Y', from: null, to: null },
  sprh: { w: '1Y', from: null, to: null },
  nuc:  { w: '1Y', from: null, to: null },
};
const FUEL_RENDER = { fuel: () => drawEUA(), sprh: () => renderSparkHistory(), nuc: () => drawNuclear() };
const C_EUA = '#A87DC4', C_TTF = '#14D3A9', C_PEG = '#7FC8F8', C_THE = '#FBBF24', C_NBP = '#ED6965',
      C_COAL = '#8D99AE', C_BRENT = '#D6A77A', C_JKM = '#F472B6';

// ── Shared helpers ───────────────────────────────────────────────────
function _fuelFmt(v, dp) { return v == null || isNaN(v) ? '–' : Number(v).toFixed(dp == null ? 2 : dp); }
function _fuelSigned(v, dp) { return v == null || isNaN(v) ? '–' : (v >= 0 ? '+' : '') + Number(v).toFixed(dp == null ? 2 : dp); }
function _fuelDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function _fuelKpi(label, value, unit, sub, tone) {
  const cls = tone === 'up' ? 'kpi-up' : tone === 'down' ? 'kpi-down' : 'kpi-flat';
  return `<div class="kpi-card ${cls}"><div class="kpi-label">${label}</div>` +
    `<div class="kpi-value">${value}<span class="kpi-unit">${unit || ''}</span></div>` +
    `<div class="kpi-meta">${sub || ''}</div></div>`;
}
// Change badge; for prices a rise is shown red (cost up for a buyer).
function _fuelChg(l, dp, suffix) {
  if (!l || l.chg == null) return '';
  const col = l.chg > 0 ? 'var(--down)' : l.chg < 0 ? 'var(--up)' : 'var(--text3)';
  return `<span style="color:${col}">${l.chg >= 0 ? '▲' : '▼'} ${_fuelSigned(l.chg, dp)} (${_fuelSigned(l.pct, 1)}%)</span> ${suffix || 'd/d'}`;
}
// Window from a period key ('1M'…'5Y', 'YTD', 'All') or an explicit from/to.
function _fuelStart(w, from) {
  if (from) return from;
  const t = new Date();
  const back = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, '2Y': 731, '5Y': 1827 }[w];
  if (w === 'YTD') return t.getFullYear() + '-01-01';
  if (!back) return '0000-00-00';
  t.setDate(t.getDate() - back);
  return t.toISOString().slice(0, 10);
}
function _fuelRange(p) { return [_fuelStart(p.period, p.from), p.to || '9999-12-31']; }
// Page state → widget params.
function _fuelPageP(key, extra) { const st = FUEL_STATE[key]; return Object.assign({ period: st.w, from: st.from, to: st.to }, extra || {}); }
function _fuelLineDs(label, data, color, extra) {
  return Object.assign({ label, data, borderColor: color, backgroundColor: rgba(color, .08), borderWidth: 1.6,
    pointRadius: 0, pointHoverRadius: 3, tension: 0, spanGaps: true, fill: false }, extra || {});
}
function _fuelAxis(title, extra) {
  return Object.assign({ grid: GRID, ticks: { color: C_TX3, font: { size: 10 } },
    title: { display: !!title, text: title, color: C_TX3, font: { size: 10 } } }, extra || {});
}
function _fuelXAxis() { const small = window.innerWidth < 700; return { grid: GRID, ticks: { color: C_TX3, font: { size: small ? 9 : 10 }, maxTicksLimit: small ? 4 : 8, maxRotation: 0 } }; }
function _fuelOpts(extra) {
  return Object.assign({
    responsive: true, maintainAspectRatio: false, animation: false,
    // horizontal bars (indexAxis 'y'): the hover follows the bar under the pointer, not the pointer's x
    interaction: extra && extra.indexAxis === 'y' ? { mode: 'index', axis: 'y', intersect: false } : { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } },
      zoom: ZOOM_CFG,
    },
  }, extra || {});
}
function _fuelChart(id, cfg, file) {
  _fuelRestoreCanvas(id);
  const ch = mkChart(id, cfg);
  setTimeout(() => { addFullscreen(id); addDownload(id, file || id); }, 60);
  return ch;
}
const FUEL_PERIOD_PARAM = PKW.PERIOD_PARAM;
// Registers a chart in the dashboard catalogue (js/widgets.js).
function _fuelReg(def) {
  if (!window.PKW) return;
  PKW.register(Object.assign({ size: { w: 6, h: 5 }, source: 'Market data' }, def));
}
// Join several date-keyed maps on the union of their dates within a window.
function _fuelJoin(maps, from, to) {
  const dates = new Set();
  maps.forEach(m => m.forEach((_, d) => { if (d >= from && d <= to) dates.add(d); }));
  const labels = [...dates].sort();
  return { labels, cols: maps.map(m => labels.map(d => m.has(d) ? m.get(d) : null)) };
}

window.fuelSetPeriod = function (key, w, btn) {
  FUEL_STATE[key].w = w; FUEL_STATE[key].from = null; FUEL_STATE[key].to = null;
  const f = document.getElementById(key + '-from'), t = document.getElementById(key + '-to');
  if (f) f.value = ''; if (t) t.value = '';
  if (btn) { btn.parentNode.querySelectorAll('.pk-gf-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
  FUEL_RENDER[key]();
};
window.fuelSetRange = function (key) {
  const f = document.getElementById(key + '-from').value, t = document.getElementById(key + '-to').value;
  FUEL_STATE[key].from = f || null; FUEL_STATE[key].to = t || null;
  document.querySelectorAll('#' + key + '-period .pk-gf-btn').forEach(b => b.classList.remove('active'));
  FUEL_RENDER[key]();
};

// ════════════════════════════════════════════════════════════════════
// PAGE 1 · CARBON & FUELS
// ════════════════════════════════════════════════════════════════════
async function drawEUA() {
  await PKC.ready;
  if (!PKC.data) { document.getElementById('fuel-kpis').innerHTML = '<div class="fuel-note">Market data unavailable (data/commodities.json).</div>'; return; }
  // Full history: the storage seasonality needs 5+ years whatever the period.
  await PKC.loadFull();

  // KPIs
  const eua = PKC.last('eua'), ttf = PKC.last('ttf'), coal = PKC.last('coal'), brent = PKC.last('brent'), agsi = PKC.last('agsi');
  const fx = PKC.last('eurusd');
  const sw = (ttf && coal && fx) ? PKC.switchPrice(ttf.v, coal.v, fx.v) : null;
  const stoAvg = _fuelStorageAvg(agsi && agsi.d);
  document.getElementById('fuel-upd').textContent = 'Close ' + _fuelDate(eua && eua.d);
  document.getElementById('fuel-kpis').innerHTML =
    _fuelKpi('EUA ' + PKC.contractLabel('eua'), _fuelFmt(eua && eua.v), '€/t', _fuelChg(eua)) +
    _fuelKpi('TTF day-ahead', _fuelFmt(ttf && ttf.v), '€/MWh', _fuelChg(ttf)) +
    _fuelKpi('API2 coal ' + PKC.contractLabel('coal'), _fuelFmt(coal && coal.v), '$/t', _fuelChg(coal)) +
    _fuelKpi('Brent M+1', _fuelFmt(brent && brent.v), '$/bbl', _fuelChg(brent)) +
    _fuelKpi('EU gas storage', _fuelFmt(agsi && agsi.v, 1), '%',
      stoAvg != null ? `${_fuelSigned(agsi.v - stoAvg, 1)} pts vs 5y avg` : _fuelDate(agsi && agsi.d),
      stoAvg != null ? (agsi.v >= stoAvg ? 'up' : 'down') : null) +
    _fuelKpi('Coal→gas switch', _fuelFmt(sw, 1), '€/t',
      sw != null && eua ? (eua.v > sw ? 'EUA above → gas in merit' : 'EUA below → coal in merit') : '',
      sw != null && eua ? (eua.v > sw ? 'up' : 'down') : null);

  const P = _fuelPageP('fuel');
  ['fuel-eua-ttf', 'fuel-switch', 'fuel-hubs', 'fuel-storage', 'fuel-coal-oil', 'fuel-lng'].forEach(id => PKW.draw(id, id, P));

  const F = PKC.FUEL, fr = typeof _mrnFr === 'function' && _mrnFr(), n = (v, d) => fr ? v.toFixed(d).replace('.', ',') : v.toFixed(d);
  document.getElementById('fuel-note').innerHTML = fr
    ? `Prix de bascule = (coût du gaz − coût du charbon) ÷ (intensité CO₂ charbon − gaz), avec CCGT ${n(F.gasEff * 100, 1)} % / ${n(F.gasCO2, 3)} tCO₂/MWh et charbon ${n(F.coalEff * 100, 0)} % / ${n(F.coalCO2, 3)} tCO₂/MWh, ` +
      `API2 converti au cours EUR/USD de clôture. EUA et charbon sont des contrats de référence uniques (${PKC.contractLabel('eua')}, ${PKC.contractLabel('coal')}), pas des séries continues roulées.`
    : `Switch price = (gas cost − coal cost) ÷ (coal − gas CO₂ intensity), with CCGT ${n(F.gasEff * 100, 1)}% / ` +
      `${n(F.gasCO2, 3)} tCO₂/MWh and coal ${n(F.coalEff * 100, 0)}% / ${n(F.coalCO2, 3)} tCO₂/MWh, ` +
      `API2 converted at the EUR/USD close. EUA and coal are single benchmark contracts (${PKC.contractLabel('eua')}, ${PKC.contractLabel('coal')}), ` +
      `not rolled continuous series.`;
}

// ── Carbon & Fuels charts (page + dashboard) ────────────────────────
async function _fuelData() {
  await PKC.ready;
  if (!PKC.data) throw new Error('Market data unavailable');
  await PKC.loadFull();
}

_fuelReg({
  id: 'fuel-eua-ttf', title: 'EUA & TTF', category: 'fuels', page: 'eua', pageCanvas: 'fuel-eua-ttf',
  desc: 'EUA front-December (€/t) and TTF day-ahead (€/MWh), daily closes.',
  params: [FUEL_PERIOD_PARAM], defaults: { period: '1Y' },
  async draw(cid, p) {
    await _fuelData();
    const [from, to] = _fuelRange(p);
    const j = _fuelJoin([PKC.asMap('eua', true), PKC.asMap('ttf', true)], from, to);
    _fuelChart(cid, { type: 'line', data: { labels: j.labels, datasets: [
      _fuelLineDs('EUA ' + PKC.contractLabel('eua') + ' (€/t)', j.cols[0], C_EUA, { yAxisID: 'y' }),
      _fuelLineDs('TTF DA (€/MWh)', j.cols[1], C_TTF, { yAxisID: 'y1' }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/t', { position: 'left' }), y1: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }) } }) }, 'eua-ttf');
  },
});

_fuelReg({
  id: 'fuel-switch', title: 'Coal-to-gas switch price', category: 'fuels', page: 'eua', pageCanvas: 'fuel-switch',
  desc: 'EUA price at which a CCGT matches a coal unit, against the EUA.',
  params: [FUEL_PERIOD_PARAM], defaults: { period: '1Y' },
  async draw(cid, p) {
    await _fuelData();
    const [from, to] = _fuelRange(p);
    const ttfM = PKC.asMap('ttf', true), coalM = PKC.asMap('coal', true), fxM = PKC.asMap('eurusd', true), euaM = PKC.asMap('eua', true);
    const swM = new Map();
    let lastFx = null, lastCoal = null;
    [...ttfM.keys()].sort().forEach(d => {
      if (fxM.has(d)) lastFx = fxM.get(d);
      if (coalM.has(d)) lastCoal = coalM.get(d);
      const v = PKC.switchPrice(ttfM.get(d), lastCoal, lastFx);
      if (v != null) swM.set(d, Math.round(v * 100) / 100);
    });
    const j = _fuelJoin([swM, euaM], from, to);
    _fuelChart(cid, { type: 'line', data: { labels: j.labels, datasets: [
      _fuelLineDs('Switch price (€/t)', j.cols[0], C_THE),
      _fuelLineDs('EUA (€/t)', j.cols[1], C_EUA),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/t') } }) }, 'coal-gas-switch');
  },
});

// NBP p/th → €/MWh: ×0.01 £/p ÷ 0.0293071 MWh/th × EUR per GBP.
_fuelReg({
  id: 'fuel-hubs', title: 'European gas hubs', category: 'fuels', page: 'eua', pageCanvas: 'fuel-hubs',
  desc: 'TTF, PEG, THE and NBP day-ahead in €/MWh.',
  params: [FUEL_PERIOD_PARAM], defaults: { period: '1Y' },
  async draw(cid, p) {
    await _fuelData();
    const [from, to] = _fuelRange(p);
    const nbp = PKC.asMap('nbp', true), gbp = PKC.asMap('gbpusd', true), eur = PKC.asMap('eurusd', true);
    const nbpE = new Map(); let g = null, e = null;
    [...nbp.keys()].sort().forEach(d => {
      if (gbp.has(d)) g = gbp.get(d); if (eur.has(d)) e = eur.get(d);
      if (g && e) nbpE.set(d, Math.round(nbp.get(d) * 0.01 / 0.0293071 * (g / e) * 100) / 100);
    });
    const j = _fuelJoin([PKC.asMap('ttf', true), PKC.asMap('peg', true), PKC.asMap('the', true), nbpE], from, to);
    _fuelChart(cid, { type: 'line', data: { labels: j.labels, datasets: [
      _fuelLineDs('TTF', j.cols[0], C_TTF), _fuelLineDs('PEG', j.cols[1], C_PEG),
      _fuelLineDs('THE', j.cols[2], C_THE), _fuelLineDs('NBP (€/MWh)', j.cols[3], C_NBP),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') } }) }, 'gas-hubs');
  },
});

// Not period-bound: always the calendar year against the previous five.
_fuelReg({
  id: 'fuel-storage', title: 'EU gas storage', category: 'fuels', page: 'eua', pageCanvas: 'fuel-storage', source: 'GIE AGSI+',
  desc: 'Current year fill level against the 5-year range and average.',
  async draw(cid) { await _fuelData(); _fuelStorageChart(cid); },
});

_fuelReg({
  id: 'fuel-coal-oil', title: 'Coal & oil', category: 'fuels', page: 'eua', pageCanvas: 'fuel-coal-oil',
  desc: 'API2 coal ($/t) and Brent M+1 ($/bbl).',
  params: [FUEL_PERIOD_PARAM], defaults: { period: '1Y' },
  async draw(cid, p) {
    await _fuelData();
    const [from, to] = _fuelRange(p);
    const j = _fuelJoin([PKC.asMap('coal', true), PKC.asMap('brent', true)], from, to);
    _fuelChart(cid, { type: 'line', data: { labels: j.labels, datasets: [
      _fuelLineDs('API2 ' + PKC.contractLabel('coal') + ' ($/t)', j.cols[0], C_COAL, { yAxisID: 'y' }),
      _fuelLineDs('Brent M+1 ($/bbl)', j.cols[1], C_BRENT, { yAxisID: 'y1' }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('$/t', { position: 'left' }), y1: _fuelAxis('$/bbl', { position: 'right', grid: { display: false } }) } }) }, 'coal-oil');
  },
});

// TTF in $/MMBtu = €/MWh × USD per EUR ÷ 3.412 MMBtu/MWh.
_fuelReg({
  id: 'fuel-lng', title: 'LNG arbitrage · JKM vs TTF', category: 'fuels', page: 'eua', pageCanvas: 'fuel-lng',
  desc: 'JKM M+1 against TTF in $/MMBtu, and the spread that steers LNG cargoes.',
  params: [FUEL_PERIOD_PARAM], defaults: { period: '1Y' },
  async draw(cid, p) {
    await _fuelData();
    const [from, to] = _fuelRange(p);
    const ttfM = PKC.asMap('ttf', true), fxM = PKC.asMap('eurusd', true), ttfU = new Map(); let fx = null;
    [...ttfM.keys()].sort().forEach(d => { if (fxM.has(d)) fx = fxM.get(d); if (fx) ttfU.set(d, Math.round(ttfM.get(d) * fx / 3.412 * 100) / 100); });
    const j = _fuelJoin([PKC.asMap('jkm', true), ttfU], from, to);
    const spread = j.labels.map((_, i) => j.cols[0][i] != null && j.cols[1][i] != null ? Math.round((j.cols[0][i] - j.cols[1][i]) * 100) / 100 : null);
    _fuelChart(cid, { type: 'line', data: { labels: j.labels, datasets: [
      _fuelLineDs('JKM M+1', j.cols[0], C_JKM), _fuelLineDs('TTF DA', j.cols[1], C_TTF),
      _fuelLineDs('JKM − TTF', spread, C_TX3, { borderDash: [4, 3], borderWidth: 1.2 }),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('$/MMBtu') } }) }, 'lng-arb');
  },
});

function _fuelStorageByYear() {
  const by = {};
  PKC.pts('agsi', true).forEach(([d, v]) => {
    const y = d.slice(0, 4), doy = Math.floor((Date.UTC(+y, +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(+y, 0, 1)) / 864e5);
    (by[y] = by[y] || [])[doy] = v;
  });
  return by;
}
function _fuelStorageAvg(dateISO) {
  if (!dateISO) return null;
  const by = _fuelStorageByYear(), y = +dateISO.slice(0, 4);
  const doy = Math.floor((Date.UTC(y, +dateISO.slice(5, 7) - 1, +dateISO.slice(8, 10)) - Date.UTC(y, 0, 1)) / 864e5);
  const vals = [];
  for (let k = y - 5; k < y; k++) { const a = by[k]; if (!a) continue; for (let o = 0; o <= 3; o++) { if (a[doy - o] != null) { vals.push(a[doy - o]); break; } } }
  return vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function _fuelStorageChart(cid) {
  const by = _fuelStorageByYear(), cy = new Date().getFullYear();
  const prev = []; for (let y = cy - 5; y < cy; y++) if (by[y]) prev.push(by[y]);
  if (!by[cy] || !prev.length) { if (typeof noDataMsg === 'function') noDataMsg(cid, 'No storage history', ''); return; }
  const N = 366, labels = [], mn = [], mx = [], av = [], cur = [];
  const fill = (a, i) => { for (let o = 0; o <= 3; o++) if (a[i - o] != null) return a[i - o]; return null; };
  for (let i = 0; i < N; i++) {
    const dt = new Date(Date.UTC(2024, 0, 1 + i));
    labels.push(dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }));
    const v = prev.map(a => fill(a, i)).filter(x => x != null);
    mn.push(v.length ? Math.min(...v) : null); mx.push(v.length ? Math.max(...v) : null);
    av.push(v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null);
    cur.push(by[cy][i] != null ? by[cy][i] : null);
  }
  _fuelChart(cid, { type: 'line', data: { labels, datasets: [
    _fuelLineDs(`${cy - 5}–${cy - 1} range`, mx, C_TX3, { borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(122,147,171,.14)' }),
    _fuelLineDs(`${cy - 5}–${cy - 1} min`, mn, C_TX3, { borderWidth: 0, pointRadius: 0 }),
    _fuelLineDs('5-year average', av, C_TX2, { borderDash: [4, 3], borderWidth: 1.2 }),
    _fuelLineDs(String(cy), cur, C_TTF, { borderWidth: 2 }),
  ] }, options: _fuelOpts({
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10, filter: it => !/min$/.test(it.text) } }, zoom: ZOOM_CFG },
    scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 } }), y: _fuelAxis('% full', { min: 0, max: 100 }) },
  }) }, 'eu-gas-storage');
}

// ════════════════════════════════════════════════════════════════════
// PAGE 2 · FORWARD CURVES
// ════════════════════════════════════════════════════════════════════
let _fwdcMarket = null;
async function drawEUAFwd() {
  await PKC.ready;
  if (!_fwdcMarket) {
    try { _fwdcMarket = await (await fetch('data/fr_market.json?t=' + Date.now())).json(); } catch (_) { _fwdcMarket = null; }
  }
  const curves = (PKC.data && PKC.data.curves) || {};
  const ttfC = curves.ttf || [], euaC = curves.eua || [];
  const ttfDA = PKC.last('ttf');
  const d = (ttfC[0] && ttfC[0].date) || (euaC[0] && euaC[0].date);
  document.getElementById('fwdc-upd').textContent = 'Settlement ' + _fuelDate(d);

  const cal1 = ttfC.find(r => r.tenor === 'Y+1'), m1 = ttfC.find(r => r.tenor === 'M+1'), s1 = ttfC.find(r => r.tenor === 'S+1');
  const eua0 = euaC[0], eua1 = euaC[1];
  const winSum = (() => { const w = ttfC.find(r => /^Win/.test(r.label || '')), sm = ttfC.find(r => /^Sum/.test(r.label || '')); return w && sm ? { v: w.value - sm.value, w, sm } : null; })();
  const kpiChg = r => r && r.varD1Pct != null ? `<span style="color:${r.varD1Pct > 0 ? 'var(--down)' : r.varD1Pct < 0 ? 'var(--up)' : 'var(--text3)'}">${_fuelSigned(r.varD1Pct, 2)}%</span> d/d · ${_fuelSigned(r.varW1Pct, 2)}% w/w` : '';
  document.getElementById('fwdc-kpis').innerHTML =
    _fuelKpi('TTF day-ahead', _fuelFmt(ttfDA && ttfDA.v), '€/MWh', _fuelChg(ttfDA)) +
    _fuelKpi('TTF ' + (m1 ? m1.label : 'M+1'), _fuelFmt(m1 && m1.value), '€/MWh', kpiChg(m1)) +
    _fuelKpi('TTF ' + (cal1 ? cal1.label : 'Cal+1'), _fuelFmt(cal1 && cal1.value), '€/MWh', kpiChg(cal1)) +
    _fuelKpi('Winter − summer', _fuelSigned(winSum && winSum.v), '€/MWh', winSum ? `${winSum.w.label} vs ${winSum.sm.label}` : '') +
    _fuelKpi('EUA ' + (eua0 ? eua0.label : ''), _fuelFmt(eua0 && eua0.value), '€/t', kpiChg(eua0)) +
    _fuelKpi('EUA carry', eua0 && eua1 ? _fuelSigned((eua1.value / eua0.value - 1) * 100, 2) : '–', '%', eua0 && eua1 ? `${eua1.label} vs ${eua0.label}` : '');

  PKW.draw('fwdc-ttf', 'fwdc-ttf');
  PKW.draw('fwdc-eua', 'fwdc-eua');
  // Table
  const row = (prod, r, unit) => `<tr><td>${prod}</td><td class="l">${r.contract}</td><td><b>${_fuelFmt(r.value)}</b></td><td>${unit}</td>` +
    `<td style="color:${r.varD1Pct > 0 ? 'var(--down)' : 'var(--up)'}">${_fuelSigned(r.varD1Pct)}%</td>` +
    `<td style="color:${r.varW1Pct > 0 ? 'var(--down)' : 'var(--up)'}">${_fuelSigned(r.varW1Pct)}%</td></tr>`;
  document.getElementById('fwdc-tbody').innerHTML =
    ttfC.map(r => row('TTF ' + r.tenor, r, '€/MWh')).join('') + euaC.map(r => row('EUA', r, '€/t')).join('');

  // Implied forward clean spreads: power and gas on the same tenor; carbon
  // from the December contract covering that delivery period.
  const countries = (_fwdcMarket && _fwdcMarket.countries) || {};
  const pw = cc => (countries[cc] && countries[cc].forwardCurve) || [];
  // EUA for a delivery period = the December contract of that year; years
  // beyond the quoted strip fall back to the last December (flagged *).
  const euaFor = (label) => {
    const yy = (label.match(/(\d{2})$/) || [])[1];
    const r = euaC.find(e => e.label.endsWith('-' + yy));
    if (r) return { v: r.value, proxy: false };
    const l = euaC[euaC.length - 1];
    return l ? { v: l.value, proxy: true, label: l.label } : { v: null };
  };
  const coal = PKC.last('coal'), fx = PKC.last('eurusd');
  const tenors = ['M+1', 'M+2', 'M+3', 'Q+1', 'Q+2', 'Q+3', 'S+1', 'S+2', 'Y+1', 'Y+2', 'Y+3'];
  const cell = v => `<td style="color:${v == null ? 'var(--text3)' : v >= 0 ? 'var(--up)' : 'var(--down)'};font-weight:600">${_fuelSigned(v)}</td>`;
  document.getElementById('fwdc-css-tbody').innerHTML = tenors.map(t => {
    const g = ttfC.find(r => r.tenor === t); if (!g) return '';
    const fr = pw('FR').find(r => r.tenor === t), de = pw('DE').find(r => r.tenor === t), nl = pw('NL').find(r => r.tenor === t);
    const eu = euaFor(g.label), e = eu.v;
    const css = p => p ? PKC.cleanSpark(p.value, g.value, e) : null;
    const cds = (t === 'Y+1' && de && coal && fx) ? PKC.cleanDark(de.value, coal.v, fx.v, e) : null;
    return `<tr><td>${t}</td><td class="l">${g.label}</td><td>${_fuelFmt(g.value)}</td><td${eu.proxy ? ' title="No ' + g.label + ' December EUA quoted — ' + eu.label + ' used"' : ''}>${_fuelFmt(e)}${eu.proxy ? '*' : ''}</td>` +
      `<td>${_fuelFmt(fr && fr.value)}</td>${cell(css(fr))}<td>${_fuelFmt(de && de.value)}</td>${cell(css(de))}` +
      `${t === 'Y+1' ? cell(cds) : '<td style="color:var(--text3)">–</td>'}<td>${_fuelFmt(nl && nl.value)}</td>${cell(css(nl))}</tr>`;
  }).join('');
  document.getElementById('fwdc-css-note').innerHTML =
    `CSS = power − TTF ÷ ${PKC.FUEL.gasEff} − EUA × ${PKC.FUEL.gasCO2.toFixed(3)} t/MWh, power and TTF on the same tenor, EUA from the December contract of that year (* = beyond the quoted strip, last December used). ` +
    `CDS only for Cal+1: API2 ${PKC.contractLabel('coal')} is the only coal contract in the feed. Power curve: ${_fuelDate(_fwdcMarket && _fwdcMarket.forwardCurveDate)}.`;
}

// ── Forward curve charts (page + dashboard) ─────────────────────────
_fuelReg({
  id: 'fwdc-ttf', title: 'TTF forward curve', category: 'forwards', page: 'euafwd', pageCanvas: 'fwdc-ttf',
  desc: 'TTF day-ahead and the quoted strip (months, quarters, seasons, years).',
  async draw(cid) {
    await PKC.ready;
    const ttfC = ((PKC.data && PKC.data.curves) || {}).ttf || [], ttfDA = PKC.last('ttf');
    if (!ttfC.length) throw new Error('No TTF curve in the feed');
    const labels = ['DA'].concat(ttfC.map(r => r.label || r.tenor));
    const vals = [ttfDA ? ttfDA.v : null].concat(ttfC.map(r => r.value));
    _fuelChart(cid, { type: 'line', data: { labels, datasets: [
      _fuelLineDs('TTF (€/MWh)', vals, C_TTF, { pointRadius: 4, pointBackgroundColor: C_TTF, borderWidth: 2 }),
    ] }, options: _fuelOpts({ plugins: { legend: { display: false }, zoom: ZOOM_CFG }, scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0 } }), y: _fuelAxis('€/MWh') } }) }, 'ttf-curve');
    return { sub: 'settlement ' + _fuelDate(ttfC[0].date) };
  },
});

_fuelReg({
  id: 'fwdc-eua', title: 'EUA December strip', category: 'forwards', page: 'euafwd', pageCanvas: 'fwdc-eua',
  desc: 'EUA December contracts quoted in the feed (€/t).',
  async draw(cid) {
    await PKC.ready;
    const euaC = ((PKC.data && PKC.data.curves) || {}).eua || [];
    if (!euaC.length) throw new Error('No EUA strip in the feed');
    _fuelChart(cid, { type: 'bar', data: { labels: euaC.map(r => r.label), datasets: [
      { label: 'EUA (€/t)', data: euaC.map(r => r.value), backgroundColor: rgba(C_EUA, .55), borderColor: C_EUA, borderWidth: 1, borderRadius: 3, maxBarThickness: 60 },
    ] }, options: _fuelOpts({ plugins: { legend: { display: false }, zoom: ZOOM_CFG }, scales: { x: _fuelXAxis(), y: _fuelAxis('€/t', { beginAtZero: true }) } }) }, 'eua-strip');
    return { sub: 'settlement ' + _fuelDate(euaC[0].date) };
  },
});

// ════════════════════════════════════════════════════════════════════
// PAGE 3 · CLEAN SPARK & DARK SPREADS
// ════════════════════════════════════════════════════════════════════
const SPARK_ZONES = ['FR', 'DE_LU', 'NL', 'BE', 'ES', 'IT_NORD', 'AT', 'PL', 'CZ'];

async function renderSpark() {
  await PKC.ready;
  const dateISO = window._currentPriceDate || pkTodayISO();
  const refs = PKC.refsFor(dateISO);
  let rows = (typeof pricesData !== 'undefined' && pricesData) ? pricesData.filter(z => z.today != null) : [];
  // opened from a direct link: the spot page has not loaded the prices, so read the delivery day's file here
  if (!rows.length && typeof fetchHistoricalDaily === 'function') {
    const zn = c => (window.GM_ZONE_NAMES || {})[c] || (typeof _GMD_ZONE_NAMES !== 'undefined' && _GMD_ZONE_NAMES[c]) || '';
    let d = await fetchHistoricalDaily(dateISO);
    if (!d || !Object.keys(d.zones || {}).length) d = await fetchHistoricalDaily(_prevDateISO(dateISO));
    rows = d ? Object.entries(d.zones).filter(([, z]) => z.avg != null).map(([code, z]) => ({ code, name: zn(code), today: z.avg, hourly: z.hourly })) : [];
  }
  const gasC = refs.ttf != null ? PKC.gasCost(refs.ttf) : null, co2G = refs.eua != null ? refs.eua * PKC.FUEL.gasCO2 : null;
  const coalC = (refs.coal != null && refs.eurusd) ? PKC.coalCost(refs.coal, refs.eurusd) + (refs.eua || 0) * PKC.FUEL.coalCO2 : null;

  document.getElementById('spark-upd').textContent = 'Delivery ' + _fuelDate(dateISO);
  document.getElementById('spark-table-title').textContent = 'Spreads by zone · delivery ' + _fuelDate(dateISO);
  document.getElementById('spark-refs').textContent =
    `TTF ${_fuelFmt(refs.ttf)} €/MWh · EUA ${_fuelFmt(refs.eua)} €/t · API2 ${_fuelFmt(refs.coal)} $/t · EUR/USD ${_fuelFmt(refs.eurusd, 4)}`;

  const peakOf = z => {
    const h = z.hourly || [], n = h.length; if (!n) return null;
    const per = n / 24, vals = [];
    for (let i = 8 * per; i < 20 * per; i++) if (h[i] != null) vals.push(h[i]);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const data = rows.map(z => {
    const pk = peakOf(z);
    const cssB = PKC.cleanSpark(z.today, refs.ttf, refs.eua), cssP = PKC.cleanSpark(pk, refs.ttf, refs.eua);
    const cdsB = PKC.cleanDark(z.today, refs.coal, refs.eurusd, refs.eua);
    return { z, pk, cssB, cssP, cdsB };
  }).sort((a, b) => (b.cssB ?? -1e9) - (a.cssB ?? -1e9));

  const col = v => v == null ? 'var(--text3)' : v >= 0 ? 'var(--up)' : 'var(--down)';
  // Which thermal unit earns more at this price; "out of the money" when
  // neither covers its fuel + carbon cost (price set by RES / nuclear / hydro / imports).
  const merit = r => r.cssB == null || r.cdsB == null ? '–'
    : (r.cssB < 0 && r.cdsB < 0) ? '<span style="color:var(--text3)">Both out of the money</span>'
    : (r.cdsB > r.cssB ? 'Coal' : 'Gas') + (Math.min(r.cssB, r.cdsB) < 0 ? '<span style="color:var(--text3)"> only</span>' : '');
  document.getElementById('spark-tbody').innerHTML = data.length ? data.map(r =>
    `<tr><td><span style="font-weight:700;color:var(--accent);margin-right:6px">${r.z.code}</span><span style="color:var(--text2)">${r.z.name || ''}</span></td>` +
    `<td>${_fuelFmt(r.z.today)}</td><td>${_fuelFmt(r.pk)}</td><td style="color:var(--text3)">${_fuelFmt(gasC)}</td><td style="color:var(--text3)">${_fuelFmt(co2G)}</td>` +
    `<td style="color:${col(r.cssB)};font-weight:600">${_fuelSigned(r.cssB)}</td><td style="color:${col(r.cssP)};font-weight:600">${_fuelSigned(r.cssP)}</td>` +
    `<td style="color:var(--text3)">${_fuelFmt(coalC)}</td><td style="color:${col(r.cdsB)};font-weight:600">${_fuelSigned(r.cdsB)}</td>` +
    `<td class="l" style="color:var(--text2);text-align:left">${merit(r)}</td></tr>`).join('')
    : '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:20px">' + ((!window.PKI18n || PKI18n.lang !== 'en') ? 'Prix day-ahead indisponibles pour ce jour.' : 'No day-ahead prices for this day.') + '</td></tr>';

  const by = c => data.find(r => r.z.code === c);
  const fr = by('FR'), de = by('DE_LU');
  const pos = data.filter(r => r.cssB != null && r.cssB > 0).length;
  const sw = PKC.switchPrice(refs.ttf, refs.coal, refs.eurusd);
  document.getElementById('spark-kpis').innerHTML =
    _fuelKpi('FR CSS base', _fuelSigned(fr && fr.cssB), '€/MWh', 'peak ' + _fuelSigned(fr && fr.cssP), fr && fr.cssB != null ? (fr.cssB >= 0 ? 'up' : 'down') : null) +
    _fuelKpi('DE CSS base', _fuelSigned(de && de.cssB), '€/MWh', 'peak ' + _fuelSigned(de && de.cssP), de && de.cssB != null ? (de.cssB >= 0 ? 'up' : 'down') : null) +
    _fuelKpi('DE CDS base', _fuelSigned(de && de.cdsB), '€/MWh', 'coal 36% · API2 ' + PKC.contractLabel('coal'), de && de.cdsB != null ? (de.cdsB >= 0 ? 'up' : 'down') : null) +
    _fuelKpi('Zones CSS > 0', pos + '<span class="kpi-unit">/' + data.length + '</span>', '', 'baseload, this delivery day') +
    _fuelKpi('Gas + CO₂ cost', _fuelFmt(gasC != null && co2G != null ? gasC + co2G : null), '€/MWh', `TTF ${_fuelFmt(refs.ttf)} · EUA ${_fuelFmt(refs.eua)}`) +
    _fuelKpi('Coal→gas switch', _fuelFmt(sw, 1), '€/t', refs.eua != null && sw != null ? (refs.eua > sw ? 'EUA above → gas in merit' : 'EUA below → coal in merit') : '');

  // Zone selector for the history section
  const sel = document.getElementById('sprh-zone');
  if (sel && !sel.options.length) {
    sel.innerHTML = SPARK_ZONES.map(c => `<option value="${c}">${c}</option>`).join('');
    sel.value = 'FR';
  }
  renderSparkHistory();
}

async function renderSparkHistory() {
  const zone = (document.getElementById('sprh-zone') || {}).value || 'FR';
  const P = _fuelPageP('sprh', { zone });
  const [h] = await Promise.all([PKW.draw('spark-daily', 'sprh-daily', P), PKW.draw('spark-monthly', 'sprh-monthly', P)]);
  const info = h && h.info;
  if (!info) { document.getElementById('sprh-note').textContent = ''; return; }
  const firstFuel = (PKC.pts('eua', true)[0] || [])[0];
  document.getElementById('sprh-note').innerHTML =
    `${zone}: ${info.n} delivery days from ${_fuelDate(info.first)} to ${_fuelDate(info.last)}. ` +
    `Gas = TTF day-ahead traded the day before delivery; carbon = EUA ${PKC.contractLabel('eua')} close; coal = API2 ${PKC.contractLabel('coal')} at the EUR/USD close. ` +
    `Peak = 08:00–20:00. Fuel history starts ${_fuelDate(firstFuel)}; zones other than FR only have day-ahead history since the backfill coverage date.`;
}

// Daily clean spark / dark spreads of one zone from the day-ahead summary.
async function _sparkSeries(p) {
  await PKC.ready;
  const [summary] = await Promise.all([typeof fetchSummary === 'function' ? fetchSummary() : null, PKC.loadFull()]);
  const ser = summary && summary.zones && summary.zones[p.zone] || [];
  const [from, to] = _fuelRange(p);
  const labels = [], css = [], cssP = [], cds = [];
  ser.forEach(e => {
    if (e.d < from || e.d > to || e.avg == null) return;
    const [y, m, d] = e.d.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    const r = { ttf: PKC.valueOn('ttf', prev, true) ?? PKC.valueOn('ttf', e.d, true), eua: PKC.valueOn('eua', e.d, true),
      coal: PKC.valueOn('coal', e.d, true), eurusd: PKC.valueOn('eurusd', e.d, true) };
    labels.push(e.d);
    css.push(_r2(PKC.cleanSpark(e.avg, r.ttf, r.eua)));
    cssP.push(_r2(PKC.cleanSpark(e.peakAvg, r.ttf, r.eua)));
    cds.push(_r2(PKC.cleanDark(e.avg, r.coal, r.eurusd, r.eua)));
  });
  return { labels, css, cssP, cds };
}
const SPARK_ZONE_PARAM = { key: 'zone', label: 'Zone', inTitle: true, options: SPARK_ZONES.map(c => [c, c]) };

_fuelReg({
  id: 'spark-daily', title: 'Clean spark & dark spreads', category: 'spreads', page: 'spark', pageCanvas: 'sprh-daily', source: 'Market data · ENTSO-E',
  desc: 'Daily baseload CSS and CDS of one zone, from day-ahead prices and fuel closes.',
  params: [SPARK_ZONE_PARAM, FUEL_PERIOD_PARAM], defaults: { zone: 'FR', period: '1Y' },
  async draw(cid, p) {
    const s = await _sparkSeries(p);
    if (!s.labels.length) { noDataMsg(cid, 'No day-ahead history for ' + p.zone + ' in this window', ''); return null; }
    _fuelChart(cid, { type: 'line', data: { labels: s.labels, datasets: [
      _fuelLineDs('CSS base', s.css, C_TTF), _fuelLineDs('CDS base', s.cds, C_COAL),
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') },
      plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG,
        annotation: { annotations: { zero: { type: 'line', yMin: 0, yMax: 0, borderColor: 'rgba(184,201,217,.35)', borderWidth: 1, borderDash: [4, 4] } } } } }) }, 'spreads-' + p.zone);
    return { info: { n: s.labels.length, first: s.labels[0], last: s.labels[s.labels.length - 1] } };
  },
});

_fuelReg({
  id: 'spark-monthly', title: 'Spreads · monthly averages', category: 'spreads', page: 'spark', pageCanvas: 'sprh-monthly', source: 'Market data · ENTSO-E',
  desc: 'Monthly average CSS base, CSS peak and CDS base of one zone.',
  params: [SPARK_ZONE_PARAM, FUEL_PERIOD_PARAM], defaults: { zone: 'FR', period: '1Y' },
  async draw(cid, p) {
    const s = await _sparkSeries(p);
    if (!s.labels.length) { noDataMsg(cid, 'No day-ahead history for ' + p.zone + ' in this window', ''); return null; }
    const byM = {};
    s.labels.forEach((d, i) => { const k = d.slice(0, 7); (byM[k] = byM[k] || { a: [], p: [], c: [] }); if (s.css[i] != null) byM[k].a.push(s.css[i]); if (s.cssP[i] != null) byM[k].p.push(s.cssP[i]); if (s.cds[i] != null) byM[k].c.push(s.cds[i]); });
    const mk = Object.keys(byM).sort(), avg = a => a.length ? _r2(a.reduce((x, y) => x + y, 0) / a.length) : null;
    const mLabels = mk.map(k => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }));
    _fuelChart(cid, { type: 'bar', data: { labels: mLabels, datasets: [
      { label: 'CSS base', data: mk.map(k => avg(byM[k].a)), backgroundColor: rgba(C_TTF, .7), borderRadius: 2 },
      { label: 'CSS peak', data: mk.map(k => avg(byM[k].p)), backgroundColor: rgba(C_PEG, .6), borderRadius: 2 },
      { label: 'CDS base', data: mk.map(k => avg(byM[k].c)), backgroundColor: rgba(C_COAL, .6), borderRadius: 2 },
    ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') } }) }, 'spreads-monthly-' + p.zone);
  },
});
function _r2(v) { return v == null || isNaN(v) ? null : Math.round(v * 100) / 100; }
function _fuelRestoreCanvas(id) {
  const c = document.getElementById(id); if (!c) return;
  const msg = c.parentNode.querySelector('.no-data-msg'); if (msg) msg.remove();
  c.style.display = 'block';
}
