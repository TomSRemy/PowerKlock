// ════════════════════════════════════════════════════════════════════
// France capacity mechanism — bilateral transactions of capacity
// guarantees (RTE registry on ODRÉ, open licence, CORS-enabled).
// One guarantee = pugc MW (0.1 MW); prices are converted to €/MW/year.
// Indexed trades without a fixed price are counted in volumes only.
// ════════════════════════════════════════════════════════════════════
let _gcRows = null;
async function _gcLoad() {
  if (!_gcRows) {
    const url = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/registre-garanties-capacite/exports/json' +
      '?select=date_saisie,type,annee_livraison,quantite,pugc,prix_unitaire_eur_gc,statut&order_by=date_saisie';
    _gcRows = fetch(url).then(r => r.ok ? r.json() : null).then(rows => {
      if (!Array.isArray(rows)) return null;
      const num = v => { if (v == null) return null; const x = parseFloat(String(v).replace(/[\s ]/g, '').replace(',', '.')); return isNaN(x) ? null : x; };
      return rows.map(r => {
        const q = num(r.quantite) || 0, unit = num(r.pugc) || 0.1, p = num(r.prix_unitaire_eur_gc);
        return { d: r.date_saisie, y: String(r.annee_livraison || '').slice(0, 4), mw: q * unit, price: p != null && p > 0 ? p / unit : null, type: r.type };
      }).filter(r => r.d && r.y && r.mw > 0 && /^Transaction/.test(r.type || ''));
    }).catch(() => null);
  }
  return _gcRows;
}
const GC_COLORS = ['#7FC8F8', '#14D3A9', '#FBBF24', '#ED6965', '#C4A57B', '#A78BFA'];

if (window.PKW) PKW.register({
  id: 'fr-capacity-gc', title: 'France capacity guarantees · OTC prices', category: 'prices', page: 'france', pageCanvas: 'fr-chart-gc',
  source: 'RTE registry (ODRÉ)', size: { w: 12, h: 5 },
  desc: 'Volume-weighted monthly price (log scale) of bilateral capacity guarantee trades per delivery year (€/MW/year), with traded volume.',
  async draw(cid) {
    const rows = await _gcLoad();
    if (!rows || !rows.length) { noDataMsg(cid, 'Capacity registry not available (ODRÉ did not respond)', ''); return null; }
    const months = [...new Set(rows.map(r => r.d.slice(0, 7)))].sort();
    const years = [...new Set(rows.map(r => r.y))].sort();
    const ds = years.map((y, k) => {
      const col = GC_COLORS[k % GC_COLORS.length];
      const data = months.map(m => {
        const sel = rows.filter(r => r.y === y && r.d.startsWith(m) && r.price != null);
        const w = sel.reduce((s, r) => s + r.mw, 0);
        return w ? Math.round(sel.reduce((s, r) => s + r.mw * r.price, 0) / w) : null;
      });
      return _fuelLineDs('Delivery ' + y, data, col, { pointRadius: 2, spanGaps: true, yAxisID: 'y' });
    });
    ds.push({ type: 'bar', label: 'Volume traded (MW)', data: months.map(m => Math.round(rows.filter(r => r.d.startsWith(m)).reduce((s, r) => s + r.mw, 0))),
      backgroundColor: 'rgba(122,147,171,.25)', borderWidth: 0, yAxisID: 'y2', order: 10 });
    const fmtM = ym => { const [y, m] = ym.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1] + ' ' + y; };
    _fuelChart(cid, { type: 'line', data: { labels: months.map(fmtM), datasets: ds },
      options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MW/year', { type: 'logarithmic', min: 50, ticks: { color: C_TX3, font: { size: 10 }, callback: v => [50, 100, 300, 1000, 3000, 10000, 30000, 100000, 300000].includes(v) ? v.toLocaleString('en-GB') : '' } }), y2: _fuelAxis('MW traded', { position: 'right', grid: { display: false } }) },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 10 } }, zoom: ZOOM_CFG } }) }, 'fr-capacity-guarantees');
    return { sub: rows.length + ' trades · ' + fmtM(months[0]) + ' → ' + fmtM(months[months.length - 1]) };
  },
});

// Summary table per delivery year (France page, Market & Forward tab).
async function renderCapacityGcTable(hostId) {
  const host = document.getElementById(hostId); if (!host) return;
  const rows = await _gcLoad();
  if (!rows) { host.innerHTML = '<div class="fuel-note">Capacity registry not available.</div>'; return; }
  const last = rows.reduce((m, r) => r.d > m ? r.d : m, '');
  const cut = new Date(Date.parse(last) - 90 * 864e5).toISOString().slice(0, 10);
  const vw = sel => { const p = sel.filter(r => r.price != null), w = p.reduce((s, r) => s + r.mw, 0); return w ? p.reduce((s, r) => s + r.mw * r.price, 0) / w : null; };
  const f = v => v == null ? '–' : Math.round(v).toLocaleString('en-GB');
  const years = [...new Set(rows.map(r => r.y))].sort().reverse();
  host.innerHTML = '<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Delivery year</th><th>Trades</th><th>Volume (GW)</th><th>VWAP all trades</th><th>VWAP last 90 days</th><th>Last trade</th></tr></thead><tbody>' +
    years.map(y => { const s = rows.filter(r => r.y === y); return `<tr><td>${y}</td><td>${s.length}</td><td>${(s.reduce((a, r) => a + r.mw, 0) / 1000).toFixed(1)}</td><td>${f(vw(s))}</td><td>${f(vw(s.filter(r => r.d >= cut)))}</td><td>${s.reduce((m, r) => r.d > m ? r.d : m, '')}</td></tr>`; }).join('') +
    '</tbody></table></div><div class="fuel-note">Prices in €/MW of certified capacity per delivery year (registry price per guarantee ÷ 0.1 MW). Bilateral trades only, parties anonymised by RTE; indexed trades without a fixed price count in volumes, not in prices. Central auction results (EPEX) are not in this registry.</div>';
}
