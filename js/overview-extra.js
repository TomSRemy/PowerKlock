// ════════════════════════════════════════════════════════════════════
// PRICES OVERVIEW (dashboard home) — analyst blocks
//   · Fuels, carbon & spreads strip (commodities feed + displayed DA day)
//   · Power forward curves FR / DE / NL / UK (SEFE, UK converted to EUR)
//   · FR hourly price heatmap, last 14 delivery days (daily history files)
// Called from prRenderHome() after the core blocks.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  let fwdData = null;

  async function renderFuelStrip(data) {
    const host = document.getElementById('pr-home-fuels');
    if (!host || !window.PKC) return;
    await PKC.ready;
    const day = window._currentPriceDate || pkTodayISO();
    const refs = PKC.refsFor(day);
    const by = c => data.find(z => z.code === c);
    const fr = by('FR'), de = by('DE_LU');
    const ttf = PKC.last('ttf'), eua = PKC.last('eua'), coal = PKC.last('coal'), agsi = PKC.last('agsi');
    const css = fr ? PKC.cleanSpark(fr.today, refs.ttf, refs.eua) : null;
    const cdsDE = de ? PKC.cleanDark(de.today, refs.coal, refs.eurusd, refs.eua) : null;
    const pct = l => l && l.pct != null ? `<span style="color:${l.pct > 0 ? 'var(--down)' : 'var(--up)'}">${l.pct >= 0 ? '▲' : '▼'} ${Math.abs(l.pct).toFixed(2)}%</span>` : '';
    const card = (label, val, unit, meta, page, tone) =>
      `<div class="pr-home-kpi" style="cursor:pointer" onclick="showPage('${page}')"><div class="pr-home-kpi-label">${label}</div>` +
      `<div class="pr-home-kpi-value"${tone ? ` style="color:${tone}"` : ''}>${val}<span class="pr-home-kpi-unit"> ${unit}</span></div><div class="pr-home-kpi-meta">${meta}</div></div>`;
    const sg = v => v == null ? '--' : (v >= 0 ? '+' : '') + v.toFixed(2);
    const col = v => v == null ? null : v >= 0 ? '#14D3A9' : '#ED6965';
    host.innerHTML =
      card('TTF day-ahead', ttf ? ttf.v.toFixed(2) : '--', '€/MWh', pct(ttf) + ' d/d', 'eua') +
      card('EUA ' + PKC.contractLabel('eua'), eua ? eua.v.toFixed(2) : '--', '€/t', pct(eua) + ' d/d', 'eua') +
      card('API2 ' + PKC.contractLabel('coal'), coal ? coal.v.toFixed(2) : '--', '$/t', pct(coal) + ' d/d', 'eua') +
      card('FR clean spark', sg(css), '€/MWh', 'baseload, this delivery day', 'spark', col(css)) +
      card('DE clean dark', sg(cdsDE), '€/MWh', 'baseload, this delivery day', 'spark', col(cdsDE)) +
      card('EU gas storage', agsi ? agsi.v.toFixed(1) : '--', '%', agsi ? 'GIE AGSI · ' + agsi.d : '', 'eua');
  }

  async function renderForwards() {
    const id = 'pr-home-fwd-canvas';
    if (!document.getElementById(id)) return;
    if (!fwdData) { try { fwdData = await (await fetch(DATA_BASE + 'fr_market.json?t=' + Date.now())).json(); } catch (_) { return; } }
    await PKC.ready;
    const fx = PKC.last('gbpusd'), eu = PKC.last('eurusd');
    const gbpEur = fx && eu ? fx.v / eu.v : null;
    const C = fwdData.countries || {};
    const tenors = ['M+1', 'M+2', 'M+3', 'Q+1', 'Q+2', 'Q+3', 'S+1', 'S+2', 'Y+1', 'Y+2', 'Y+3'];
    const ref = (C.FR && C.FR.forwardCurve) || [];
    const labels = tenors.map(t => { const r = ref.find(x => x.tenor === t); return r ? r.contract.replace(/^FR\s+/, '').replace(/\s+base$/, '') : t; });
    const series = [['FR', '#14D3A9'], ['DE', '#FBBF24'], ['NL', '#A87DC4'], ['UK', '#7FC8F8']].map(([cc, color]) => {
      const fc = (C[cc] && C[cc].forwardCurve) || [];
      const conv = cc === 'UK' ? gbpEur : 1;
      return { label: cc === 'UK' ? 'GB (GBP→EUR)' : cc === 'DE' ? 'DE' : cc, data: tenors.map(t => { const r = fc.find(x => x.tenor === t); return r && r.value != null && conv ? +(r.value * conv).toFixed(2) : null; }),
        borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, tension: 0, fill: false, spanGaps: true };
    });
    _fuelChart(id, { type: 'line', data: { labels, datasets: series }, options: _fuelOpts({
      scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0 } }), y: _fuelAxis('€/MWh') } }) }, 'power-forward-curves');
    const sub = document.getElementById('pr-home-fwd-sub');
    if (sub) sub.textContent = `Baseload settlements ${fwdData.forwardCurveDate || ''} · SEFE${gbpEur ? ` · GB converted at ${gbpEur.toFixed(4)} EUR/GBP` : ''}`;
  }

  async function renderHeatmap() {
    const host = document.getElementById('pr-home-heatmap');
    if (!host) return;
    const end = window._currentPriceDate || pkTodayISO();
    const days = Array.from({ length: 14 }, (_, i) => _renAdd(end, i - 13));
    const files = await Promise.all(days.map(d => fetch(DATA_BASE + 'history/daily/' + d + '.json').then(r => r.ok ? r.json() : null).catch(() => null)));
    const rows = days.map((d, k) => {
      const z = files[k] && files[k].zones && files[k].zones.FR;
      if (!z || !z.hourly) return { d, h: null };
      const h = z.hourly, per = h.length / 24;
      return { d, h: Array.from({ length: 24 }, (_, i) => { const v = h.slice(i * per, (i + 1) * per).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }) };
    });
    const all = rows.flatMap(r => r.h || []).filter(v => v != null).sort((a, b) => a - b);
    if (!all.length) { host.innerHTML = '<div class="fuel-note">No FR history.</div>'; return; }
    const lo = all[Math.floor(all.length * 0.05)], hi = all[Math.floor(all.length * 0.95)];
    // Diverging scale: negative → blue, low → teal, high → coral
    const color = v => {
      if (v == null) return 'transparent';
      if (v < 0) return 'rgba(127,200,248,.85)';
      const t = Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1)));
      const a = [20, 211, 169], b = [251, 191, 36], c = [237, 105, 101];
      const mix = (p, q, u) => p.map((x, i) => Math.round(x + (q[i] - x) * u));
      const rgb = t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2);
      return `rgba(${rgb.join(',')},.85)`;
    };
    let html = '<div style="display:grid;grid-template-columns:92px repeat(24,1fr) 64px;gap:2px;font-family:\'JetBrains Mono\',monospace;font-size:9.5px">';
    html += '<div></div>' + Array.from({ length: 24 }, (_, i) => `<div style="text-align:center;color:var(--tx3)">${i % 3 === 0 ? String(i).padStart(2, '0') : ''}</div>`).join('') + '<div style="text-align:right;color:var(--tx3)">avg</div>';
    rows.forEach(r => {
      const dt = new Date(r.d + 'T12:00:00Z'), wk = [0, 6].includes(dt.getUTCDay());
      html += `<div style="color:${wk ? 'var(--text2)' : 'var(--tx3)'};white-space:nowrap">${dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })}</div>`;
      if (!r.h) { html += `<div style="grid-column:span 24;color:var(--tx3);font-style:italic;padding-left:6px">no data</div><div></div>`; return; }
      r.h.forEach((v, i) => { html += `<div title="${r.d} ${String(i).padStart(2, '0')}:00 · ${v == null ? '–' : v.toFixed(2) + ' €/MWh'}" style="height:16px;border-radius:2px;background:${color(v)}"></div>`; });
      const avg = r.h.filter(v => v != null).reduce((a, b, _, arr) => a + b / arr.length, 0);
      html += `<div style="text-align:right;color:var(--text)">${avg.toFixed(1)}</div>`;
    });
    html += '</div>';
    html += `<div style="display:flex;gap:14px;align-items:center;margin-top:10px;font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(127,200,248,.85);vertical-align:-1px"></span> negative</span>
      <span style="display:inline-block;width:160px;height:10px;border-radius:2px;background:linear-gradient(90deg,rgba(20,211,169,.85),rgba(251,191,36,.85),rgba(237,105,101,.85))"></span>
      <span>${lo.toFixed(0)} → ${hi.toFixed(0)} €/MWh (P5–P95 of the window)</span><span>· hourly averages of 15-min prices, CET/CEST</span></div>`;
    host.innerHTML = html;
  }

  window.prRenderHomeExtra = function (data) {
    renderFuelStrip(data).catch(e => console.warn('fuel strip', e));
    renderForwards().catch(e => console.warn('forwards', e));
    renderHeatmap().catch(e => console.warn('heatmap', e));
  };
})();

// ════════════════════════════════════════════════════════════════════
// SPREAD PAGE · battery arbitrage (TB1 / TB2 / TB4)
// TBn = mean of the n most expensive hours − mean of the n cheapest hours
// of the delivery day (hourly averages of the 15-min prices).
// Revenue proxy: 1 MW / 2 MWh battery, one cycle a day, 85% round trip:
//   daily € ≈ 2 MWh × (top-2h avg × 0.85 − bottom-2h avg)  (charge at bottom, discharge at top)
// ════════════════════════════════════════════════════════════════════
window._bessDays = 30;
function bessSetWindow(n, btn) {
  window._bessDays = n;
  if (btn) { btn.parentNode.querySelectorAll('.pk-gf-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
  renderBess();
}
async function renderBess() {
  if (!document.getElementById('bess-canvas')) return;
  const zone = (typeof getHistZone === 'function' ? getHistZone('spread') : 'FR') || 'FR';
  const end = window._currentPriceDate || pkTodayISO();
  const days = Array.from({ length: window._bessDays }, (_, i) => _renAdd(end, i - window._bessDays + 1));
  const files = await Promise.all(days.map(d => fetch(DATA_BASE + 'history/daily/' + d + '.json').then(r => r.ok ? r.json() : null).catch(() => null)));
  const rows = [];
  days.forEach((d, k) => {
    const z = files[k] && files[k].zones && files[k].zones[zone];
    if (!z || !z.hourly || !z.hourly.length) return;
    const per = z.hourly.length / 24;
    const h = Array.from({ length: 24 }, (_, i) => { const v = z.hourly.slice(i * per, (i + 1) * per).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }).filter(v => v != null);
    if (h.length < 20) return;
    const srt = h.slice().sort((a, b) => a - b), m = a => a.reduce((x, y) => x + y, 0) / a.length;
    const tb = n => m(srt.slice(-n)) - m(srt.slice(0, n));
    const rev2 = 2 * (m(srt.slice(-2)) * 0.85 - m(srt.slice(0, 2)));
    rows.push({ d, tb1: tb(1), tb2: tb(2), tb4: tb(4), rev2 });
  });
  const cov = document.getElementById('bess-cov');
  if (cov) cov.textContent = `${zone} · ${rows.length}/${days.length} delivery days with prices`;
  if (!rows.length) { noDataMsg('bess-canvas', 'No price data for ' + zone + ' in this window', ''); document.getElementById('bess-kpis').innerHTML = ''; return; }
  _renRestore('bess-canvas');
  const avg = k => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  const r2 = v => Math.round(v * 100) / 100;
  const annual = avg('rev2') * 365 / 1000;   // k€ per MW per year
  document.getElementById('bess-kpis').innerHTML =
    _fuelKpi('TB1 average', avg('tb1').toFixed(1), '€/MWh', 'best hour − worst hour') +
    _fuelKpi('TB2 average', avg('tb2').toFixed(1), '€/MWh', '2-hour battery reference') +
    _fuelKpi('TB4 average', avg('tb4').toFixed(1), '€/MWh', '4-hour battery reference') +
    _fuelKpi('Max TB2', Math.max(...rows.map(r => r.tb2)).toFixed(1), '€/MWh', rows.reduce((a, b) => b.tb2 > a.tb2 ? b : a).d) +
    _fuelKpi('2h BESS DA margin', avg('rev2').toFixed(0), '€/MW/day', '1 MW / 2 MWh, 1 cycle, 85% RTE') +
    _fuelKpi('Annualised', annual.toFixed(0), 'k€/MW/yr', 'window average × 365 · DA only', annual > 0 ? 'up' : null);
  _fuelChart('bess-canvas', { type: 'line', data: { labels: rows.map(r => r.d), datasets: [
    _fuelLineDs('TB1', rows.map(r => r2(r.tb1)), '#ED6965', { borderWidth: 1.3 }),
    _fuelLineDs('TB2', rows.map(r => r2(r.tb2)), '#14D3A9', { borderWidth: 2, pointRadius: 2 }),
    _fuelLineDs('TB4', rows.map(r => r2(r.tb4)), '#7FC8F8', { borderWidth: 1.3 }),
  ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh', { beginAtZero: true }) } }) }, 'tb-spreads-' + zone);
  document.getElementById('bess-note').textContent = 'Day-ahead only (no intraday, balancing or ancillary revenues, no degradation or fees). Hours are clock hours of the delivery day; TB spreads ignore the order of the hours, so they are an upper bound for one cycle.';
}
