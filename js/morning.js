// ════════════════════════════════════════════════════════════════════
// FRANCE MORNING — the French market in one view, every morning.
// Spot (tomorrow vs today), forwards (curve, Cal+1), fuels and carbon,
// guarantees of origin, CO₂ and nuclear, renewables value, plus an
// automatic "what moved" summary. Charts are catalogue widgets, so any
// of them can be starred into My Dashboard.
// Sources: data/history/daily (ENTSO-E day-ahead), data/fr_market.json and
// history/fr_market_series.json (forwards, nuclear availability),
// commodities.json (TTF, EUA, coal), go_prices.csv / go_auctions.json
// (guarantees of origin), RTE éCO2mix (js/fr-rte.js), summary.json.
// ════════════════════════════════════════════════════════════════════
const MRN = { cache: {} };
function _mrnToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()); }
function _mrnAdd(iso, n) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function _mrnDay(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }); }
function _mrnGet(key, url, parse) {
  if (!MRN.cache[key]) MRN.cache[key] = fetch(url).then(r => r.ok ? (parse ? r.text().then(parse) : r.json()) : null).catch(() => null);
  return MRN.cache[key];
}
const _mrnDaily = iso => _mrnGet('d' + iso, DATA_BASE + 'history/daily/' + iso + '.json');
const _mrnFwd = () => _mrnGet('fwd', DATA_BASE + 'fr_market.json');
const _mrnFwdSeries = () => _mrnGet('fwds', DATA_BASE + 'history/fr_market_series.json');
const _mrnSummary = () => window.pkSummary();
const _mrnAuctions = () => _mrnGet('auct', DATA_BASE + 'go_auctions.json');
function _mrnGoCsv() {
  return _mrnGet('go', DATA_BASE + 'go_prices.csv', txt => {
    const lines = txt.trim().split(/\r?\n/), head = lines.shift().split(',');
    return lines.map(l => { const v = l.split(','), o = {}; head.forEach((h, i) => { o[h] = v[i]; }); return o; });
  });
}
// GO weekly mid for one product and production year: [{t, mid}]
function _mrnGoSeries(rows, product, year) {
  return rows.filter(r => r.product === product && r.year === String(year)).map(r => {
    const b = parseFloat(r.bid), a = parseFloat(r.ask);
    const mid = !isNaN(b) && !isNaN(a) ? (b + a) / 2 : !isNaN(b) ? b : !isNaN(a) ? a : null;
    return { t: r.mail_date, mid };
  }).filter(x => x.mid != null).sort((x, y) => x.t.localeCompare(y.t));
}
// Latest delivery day with FR prices, starting from tomorrow.
async function _mrnSpotDays() {
  const t = _mrnToday();
  for (const d of [_mrnAdd(t, 1), t, _mrnAdd(t, -1)]) {
    const j = await _mrnDaily(d); const z = j && j.zones && j.zones.FR;
    if (z && Array.isArray(z.hourly) && z.hourly.some(v => v != null)) return { d, prev: _mrnAdd(d, -1) };
  }
  return { d: t, prev: _mrnAdd(t, -1) };
}
const _mrnMean = a => { const v = (a || []).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const _mrnPeak = a => Array.isArray(a) && a.length === 96 ? _mrnMean(a.slice(32, 80)) : null;   // 08:00–20:00

// ── widgets ──
if (window.PKW) {
  PKW.register({
    id: 'fr-spot-next', title: 'France day-ahead · next delivery day vs previous', category: 'prices', page: 'morning', pageCanvas: 'mrn-spot',
    source: 'ENTSO-E', size: { w: 6, h: 5 },
    desc: 'Quarter-hour French day-ahead prices of the latest delivery day against the day before and a week before.',
    async draw(cid) {
      const { d, prev } = await _mrnSpotDays();
      const [a, b, c] = await Promise.all([_mrnDaily(d), _mrnDaily(prev), _mrnDaily(_mrnAdd(d, -7))]);
      const fr = j => j && j.zones && j.zones.FR && j.zones.FR.hourly;
      if (!fr(a)) { noDataMsg(cid, 'No French day-ahead prices', ''); return null; }
      const lbl = Array.from({ length: 96 }, (_, i) => String(Math.floor(i / 4)).padStart(2, '0') + ':' + String(i % 4 * 15).padStart(2, '0'));
      const ds = [
        _fuelLineDs(_mrnDay(d), fr(a), '#14D3A9', { borderWidth: 2.2, fill: true, backgroundColor: 'rgba(20,211,169,.10)' }),
        fr(b) ? _fuelLineDs(_mrnDay(prev), fr(b), 'rgba(184,201,217,.8)', { borderWidth: 1.3, borderDash: [4, 3] }) : null,
        fr(c) ? _fuelLineDs(_mrnDay(_mrnAdd(d, -7)) + ' (D-7)', fr(c), 'rgba(122,147,171,.6)', { borderWidth: 1 }) : null,
      ].filter(Boolean);
      _fuelChart(cid, { type: 'line', data: { labels: lbl, datasets: ds },
        options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 9, maxRotation: 0 } }), y: _fuelAxis('€/MWh') },
          plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } } }) }, 'fr-spot-' + d);
      return { sub: 'Delivery ' + _mrnDay(d) + ' · 15-min' };
    },
  });

  PKW.register({
    id: 'fr-de-spread', title: 'France vs Germany · daily baseload', category: 'prices', page: 'morning', pageCanvas: 'mrn-frde',
    source: 'ENTSO-E', size: { w: 6, h: 5 },
    desc: 'Daily day-ahead baseload in France and Germany and the FR − DE spread.',
    params: [{ key: 'win', label: 'Window', options: [['30', '30 days'], ['90', '90 days'], ['365', '1 year']] }], defaults: { win: '30' },
    async draw(cid, p) {
      const s = await _mrnSummary();
      const fr = s && s.zones && s.zones.FR, de = s && s.zones && s.zones.DE_LU;
      if (!fr || !de) { noDataMsg(cid, 'Price history not available', ''); return null; }
      const deBy = new Map(de.map(r => [r.d, r.avg]));
      const rows = fr.filter(r => r.avg != null && deBy.get(r.d) != null).slice(-(+p.win || 30));
      const r2 = v => Math.round(v * 100) / 100;
      _fuelChart(cid, { type: 'bar', data: { labels: rows.map(r => r.d), datasets: [
        { type: 'bar', label: 'FR − DE', data: rows.map(r => r2(r.avg - deBy.get(r.d))), backgroundColor: rows.map(r => r.avg - deBy.get(r.d) >= 0 ? 'rgba(237,105,101,.55)' : 'rgba(127,200,248,.55)'), borderWidth: 0, yAxisID: 'y2', order: 3 },
        _fuelLineDs('France', rows.map(r => r.avg), '#14D3A9', { borderWidth: 2, yAxisID: 'y', type: 'line', order: 1 }),
        _fuelLineDs('Germany', rows.map(r => r2(deBy.get(r.d))), '#FBBF24', { borderWidth: 1.6, yAxisID: 'y', type: 'line', order: 2 }),
      ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh'), y2: _fuelAxis('FR − DE', { position: 'right', grid: { display: false } }) },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } } }) }, 'fr-de-spread');
      return { sub: rows.length + ' days · ' + rows[0].d + ' → ' + rows[rows.length - 1].d };
    },
  });

  PKW.register({
    id: 'go-vintages', title: 'GO renewable · production-year contracts', category: 'go', page: 'morning', pageCanvas: 'mrn-go',
    source: 'Commerg', size: { w: 6, h: 5 },
    desc: 'Weekly mid price of AIB renewable guarantees of origin for the current and next production years (€/MWh).',
    params: [{ key: 'product', label: 'Product', inTitle: true, options: [['GO AIB Renewable', 'Renewable'], ['GO AIB Hydro', 'Hydro'], ['GO AIB Wind', 'Wind'], ['GO AIB Solar', 'Solar']] }],
    defaults: { product: 'GO AIB Renewable' },
    async draw(cid, p) {
      const rows = await _mrnGoCsv();
      if (!rows) { noDataMsg(cid, 'GO prices not available', ''); return null; }
      const y = +_mrnToday().slice(0, 4), years = [y, y + 1, y + 2];
      const ser = years.map(v => ({ y: v, s: _mrnGoSeries(rows, p.product, v) })).filter(x => x.s.length);
      if (!ser.length) { noDataMsg(cid, 'No ' + p.product + ' prices', ''); return null; }
      const dates = [...new Set(ser.flatMap(x => x.s.map(r => r.t)))].sort().filter(t => t >= _mrnAdd(_mrnToday(), -730));
      const cols = ['#14D3A9', '#FBBF24', '#A87DC4'];
      _fuelChart(cid, { type: 'line', data: { labels: dates, datasets: ser.map((x, i) => {
        const m = new Map(x.s.map(r => [r.t, r.mid]));
        return _fuelLineDs('Cal ' + x.y, dates.map(t => m.has(t) ? Math.round(m.get(t) * 1000) / 1000 : null), cols[i], { borderWidth: i ? 1.5 : 2.2, spanGaps: true });
      }) }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } } }) }, 'go-vintages');
      return { sub: p.product.replace('GO AIB ', 'AIB ') + ' · weekly mid · last 2 years' };
    },
  });
}

// ── forwards, shown by product ──
const MRN_MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// Delivery period of a contract name ("FR Nov26 base", "FR Q1 27 base", "FR Sum2027 base", "FR Win2027 base", "FR Cal2027 base")
function _mrnPeriod(name) {
  const n = (name || '').replace(/^[A-Z]{2}\s+/, '').replace(/\s+base$/i, '');
  let m;
  const U = (y, mo) => Date.UTC(y, mo, 1);
  if ((m = n.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s?(\d{2})$/))) { const y = 2000 + +m[2], mo = MRN_MON[m[1]]; return { kind: 'Month', label: m[1] + ' ' + m[2], a: U(y, mo), b: U(y, mo + 1) }; }
  if ((m = n.match(/^Q([1-4])\s?(\d{2})$/))) { const y = 2000 + +m[2], q = +m[1]; return { kind: 'Quarter', label: 'Q' + q + ' ' + m[2], a: U(y, (q - 1) * 3), b: U(y, q * 3) }; }
  if ((m = n.match(/^Sum\s?(\d{4})$/))) { const y = +m[1]; return { kind: 'Season', label: 'Summer ' + y, a: U(y, 3), b: U(y, 9) }; }
  if ((m = n.match(/^Win\s?(\d{4})$/))) { const y = +m[1]; return { kind: 'Season', label: 'Winter ' + y + '-' + String(y + 1).slice(2), a: U(y, 9), b: U(y + 1, 3) }; }
  if ((m = n.match(/^Cal\s?(\d{4})$/))) { const y = +m[1]; return { kind: 'Year', label: 'Cal ' + y, a: U(y, 0), b: U(y + 1, 0) }; }
  return null;
}
async function _mrnFwdRows(country) {
  const f = await _mrnFwd();
  const fc = country === 'FR' ? (f && f.forwardCurve) : (f && f.countries && f.countries[country] && f.countries[country].forwardCurve);
  return (fc || []).map(r => {
    const per = _mrnPeriod(r.contract);
    const d1 = r.varD1Pct != null ? r.value / (1 + r.varD1Pct / 100) : null;
    const d7 = r.varW1Pct != null ? r.value / (1 + r.varW1Pct / 100) : null;
    return { tenor: r.tenor, contract: r.contract, per, value: r.value, date: r.date, prevD1: d1, prevD7: d7, chgD1: d1 != null ? r.value - d1 : null, chgD7: d7 != null ? r.value - d7 : null, pctD1: r.varD1Pct, pctD7: r.varW1Pct };
  }).filter(r => r.value != null);
}
const MRN_COUNTRY = { key: 'country', label: 'Market', inTitle: true, options: [['FR', 'France'], ['DE', 'Germany'], ['NL', 'Netherlands']] };

if (window.PKW) {
  PKW.register({
    id: 'fr-fwd-table', kind: 'html', title: 'Power forwards · prices and changes', category: 'forwards', page: 'morning', source: 'Market data', size: { w: 6, h: 6 },
    desc: 'Baseload forward settlements by product with the change on the previous day and on the week.',
    params: [MRN_COUNTRY], defaults: { country: 'FR' },
    async html(host, p) {
      const rows = await _mrnFwdRows(p.country || 'FR');
      if (!rows.length) { host.innerHTML = '<div class="fuel-note">Forward prices not available.</div>'; return; }
      const cell = (v, pct) => v == null ? '<td>–</td>' : `<td class="${v > 0.005 ? 'mrn-up' : v < -0.005 ? 'mrn-down' : ''}">${v > 0 ? '+' : ''}${v.toFixed(2)}<small>${pct != null ? ' (' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '%)' : ''}</small></td>`;
      const groups = ['Month', 'Quarter', 'Season', 'Year'], names = { Month: 'Months', Quarter: 'Quarters', Season: 'Seasons', Year: 'Calendar years' };
      let html = `<table class="mrn-fwd"><thead><tr><th>Product</th><th>Price €/MWh</th><th>vs D-1</th><th>vs D-7</th></tr></thead><tbody>`;
      groups.forEach(g => {
        const rs = rows.filter(r => r.per && r.per.kind === g); if (!rs.length) return;
        html += `<tr class="mrn-fwd-g"><td colspan="4">${names[g]}</td></tr>` + rs.map(r => `<tr><td>${r.per.label}</td><td class="mrn-fwd-p">${r.value.toFixed(2)}</td>${cell(r.chgD1, r.pctD1)}${cell(r.chgD7, r.pctD7)}</tr>`).join('');
      });
      html += `</tbody></table><div class="mrn-fwd-note">Settlement ${rows[0].date} · price up in red</div>`;
      host.innerHTML = html;
    },
  });

  PKW.register({
    id: 'fr-fwd-products', title: 'Power forwards · price history by product', category: 'forwards', page: 'morning', pageCanvas: 'mrn-fwdp', source: 'Market data', size: { w: 6, h: 5 },
    desc: 'Daily settlements of the calendar contracts (fixed delivery years) and of the front month and front quarter.',
    params: [MRN_COUNTRY, { key: 'win', label: 'Window', options: [['1M', '1 month'], ['3M', '3 months'], ['1Y', '1 year']] }], defaults: { country: 'FR', win: '3M' },
    async draw(cid, p) {
      const [chain, ser] = await Promise.all([_mrnGet('chain', DATA_BASE + 'history/fr_market_calchain.json'), _mrnFwdSeries()]);
      const cc = p.country || 'FR';
      const from = _mrnAdd(_mrnToday(), -({ '1M': 31, '3M': 92, '1Y': 366 }[p.win] || 92));
      const lines = [];
      const yrs = chain && chain[cc] && chain[cc].years || {};
      const cols = { Y1: '#14D3A9', Y2: '#7FC8F8', Y3: '#A87DC4', M: '#FBBF24', Q: '#C4A57B' };
      Object.keys(yrs).sort().forEach((y, i) => { const v = yrs[y]; lines.push({ label: 'Cal ' + y, pts: v.dates.map((d, k) => [d, v.values[k]]), col: [cols.Y1, cols.Y2, cols.Y3][i] || '#94A3B8' }); });
      const src = cc === 'FR' ? ser : (ser && ser.countries && ser.countries[cc]);
      const fc = src && src.forwardCurve, dates = src && (src.dates || (ser && ser.dates));
      if (fc && dates) [['M+1', 'Front month', cols.M], ['Q+1', 'Front quarter', cols.Q]].forEach(([t, l, c]) => { if (fc[t]) lines.push({ label: l, pts: dates.map((d, k) => [d, fc[t][k]]), col: c, dash: true }); });
      const all = [...new Set(lines.flatMap(l => l.pts.filter(x => x[0] >= from && x[1] != null).map(x => x[0])))].sort();
      if (!all.length) { noDataMsg(cid, 'No forward history', ''); return null; }
      const ds = lines.map(l => { const m = new Map(l.pts); return _fuelLineDs(l.label, all.map(d => m.has(d) ? m.get(d) : null), l.col, Object.assign({ borderWidth: l.dash ? 1.4 : 2, spanGaps: true }, l.dash ? { borderDash: [5, 3] } : {})); })
        .filter(d => d.data.some(v => v != null));
      _fuelChart(cid, { type: 'line', data: { labels: all, datasets: ds }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } } }) }, 'forwards-products-' + cc);
      return { sub: 'Calendar contracts (fixed years) and rolling front month / quarter (dashed, change contract at expiry)' };
    },
  });

  PKW.register({
    id: 'fr-fwd-strip', title: 'Power forwards · prices over the delivery calendar', category: 'forwards', page: 'morning', pageCanvas: 'mrn-strip', source: 'Market data', size: { w: 12, h: 5 },
    desc: 'Each forward product drawn over its own delivery period (months, quarters, seasons, years), today and a week ago.',
    params: [MRN_COUNTRY], defaults: { country: 'FR' },
    async draw(cid, p) {
      const rows = (await _mrnFwdRows(p.country || 'FR')).filter(r => r.per);
      if (!rows.length) { noDataMsg(cid, 'Forward prices not available', ''); return null; }
      const style = { Year: { col: '#14D3A9', w: 6, op: 0.55 }, Season: { col: '#A87DC4', w: 4, op: 0.8 }, Quarter: { col: '#C4A57B', w: 4, op: 0.9 }, Month: { col: '#FBBF24', w: 4, op: 1 } };
      const seg = (r, val) => [{ x: r.per.a, y: val, r }, { x: r.per.b - 864e5, y: val, r }, { x: r.per.b, y: null }];
      const ds = [];
      ['Year', 'Season', 'Quarter', 'Month'].forEach(k => {
        const rs = rows.filter(r => r.per.kind === k); if (!rs.length) return;
        const st = style[k];
        ds.push({ label: { Year: 'Calendar years', Season: 'Seasons', Quarter: 'Quarters', Month: 'Months' }[k], data: rs.flatMap(r => seg(r, r.value)), borderColor: st.col, backgroundColor: st.col,
          borderWidth: st.w, pointRadius: 0, spanGaps: false, tension: 0, borderCapStyle: 'butt', order: { Year: 4, Season: 3, Quarter: 2, Month: 1 }[k] });
      });
      ds.push({ label: 'A week ago', data: rows.flatMap(r => seg(r, r.prevD7 != null ? Math.round(r.prevD7 * 100) / 100 : null)), borderColor: 'rgba(184,201,217,.6)', borderDash: [3, 3], borderWidth: 1.4, pointRadius: 0, spanGaps: false, order: 0 });
      const labelPlugin = { id: 'mrnStripLbl', afterDatasetsDraw(ch) {
        const g = ch.ctx; g.save(); g.font = '10px "IBM Plex Mono", monospace'; g.textAlign = 'center';
        const boxes = [], free = b => !boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
        // months first (shortest segments), then quarters, seasons, years; a label that would overlap is moved below its line or skipped
        const order = ch.data.datasets.map((d, i) => i).filter(i => ch.data.datasets[i].label !== 'A week ago' && ch.isDatasetVisible(i)).sort((a, b) => ch.data.datasets[a].order - ch.data.datasets[b].order);
        order.forEach(i => { const d = ch.data.datasets[i], meta = ch.getDatasetMeta(i);
          for (let k = 0; k < d.data.length; k += 3) { const p0 = meta.data[k], p1 = meta.data[k + 1]; if (!p0 || !p1) continue;
            const r = d.data[k].r, txt = r.per.label + ' ' + r.value.toFixed(1), w = g.measureText(txt).width, cx = (p0.x + p1.x) / 2;
            for (const y of [p0.y - 7, p0.y + 15]) { const b = { x0: cx - w / 2 - 2, x1: cx + w / 2 + 2, y0: y - 10, y1: y + 2 };
              if (free(b)) { boxes.push(b); g.fillStyle = d.borderColor; g.fillText(txt, cx, y); break; } } } });
        g.restore(); } };
      const minX = Math.min(...rows.map(r => r.per.a)), maxX = Math.max(...rows.map(r => r.per.b));
      const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      _fuelChart(cid, { type: 'line', data: { datasets: ds }, plugins: [labelPlugin],
        options: _fuelOpts({ parsing: false, interaction: { mode: 'nearest', intersect: false },
          scales: { x: { type: 'linear', min: minX, max: maxX, grid: GRID,
              afterBuildTicks: ax => { const t = []; const d0 = new Date(minX); for (let d = Date.UTC(d0.getUTCFullYear(), Math.floor(d0.getUTCMonth() / 3) * 3, 1); d <= maxX; d = Date.UTC(new Date(d).getUTCFullYear(), new Date(d).getUTCMonth() + 3, 1)) if (d >= minX) t.push({ value: d }); ax.ticks = t; },
              ticks: { color: C_TX3, font: { size: 10 }, callback: v => { const d = new Date(v); return mon[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2); } } },
            y: _fuelAxis('€/MWh', { grace: '12%' }) },
          plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 14, padding: 10 } },
            tooltip: { callbacks: { title: it => { const r = it[0] && it[0].raw && it[0].raw.r; return r ? r.per.label + ' (' + r.tenor + ')' : ''; },
              label: it => { const r = it.raw && it.raw.r; if (!r) return ''; return it.dataset.label === 'A week ago' ? 'A week ago: ' + (r.prevD7 != null ? r.prevD7.toFixed(2) : '–') : r.value.toFixed(2) + ' €/MWh (' + (r.chgD7 >= 0 ? '+' : '') + (r.chgD7 != null ? r.chgD7.toFixed(2) : '–') + ' vs D-7)'; } } } } }) }, 'forwards-delivery-' + (p.country || 'FR'));
      return { sub: 'Each product over its delivery period · settlement ' + rows[0].date };
    },
  });
}

// ── key figures ──
async function _mrnKpis() {
  const host = document.getElementById('mrn-kpis'); if (!host) return {};
  const out = {};
  const { d, prev } = await _mrnSpotDays();
  const [a, b, fwd, gos, auct] = await Promise.all([_mrnDaily(d), _mrnDaily(prev), _mrnFwd(), _mrnGoCsv(), _mrnAuctions()]);
  const fa = a && a.zones && a.zones.FR, fb = b && b.zones && b.zones.FR;
  // Same KPI card as the rest of the site; a price rise is red (kpi-down), a fall green.
  const tile = (lbl, val, unit, sub, tone, title) => {
    const cls = tone === 'up' ? 'kpi-down' : tone === 'down' ? 'kpi-up' : 'kpi-flat';
    const col = tone === 'up' ? 'var(--down)' : tone === 'down' ? 'var(--up)' : 'var(--text3)';
    return `<div class="kpi-card ${cls}"${title ? ` title="${title}"` : ''}><div class="kpi-label">${lbl}</div><div class="kpi-value">${val}<span class="kpi-unit">${unit || ''}</span></div><div class="kpi-meta" style="color:${col}">${sub || ''}</div></div>`;
  };
  const sg = (v, dp) => v == null || isNaN(v) ? '–' : (v >= 0 ? '+' : '') + v.toFixed(dp == null ? 1 : dp);
  const toneP = v => v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '';   // price up = red (site convention)
  const tiles = [];

  // Spot
  const base = fa ? _mrnMean(fa.hourly) : null, baseP = fb ? _mrnMean(fb.hourly) : null, peak = fa ? _mrnPeak(fa.hourly) : null;
  const negH = fa && Array.isArray(fa.hourly) ? fa.hourly.filter(v => v != null && v < 0).length / 4 : null;
  out.spot = { d, base, baseP, peak, negH };
  tiles.push(tile('Spot FR · ' + _mrnDay(d), base == null ? '–' : base.toFixed(1), ' €/MWh',
    (baseP != null && base != null ? sg(base - baseP) + ' vs ' + _mrnDay(prev) : '') + (peak != null ? ' · peak ' + peak.toFixed(0) : '') + (negH ? ' · ' + negH + ' h < 0' : ''), toneP(base - baseP)));

  // Forwards
  const fc = (fwd && fwd.forwardCurve) || [];
  const row = t => fc.find(r => r.tenor === t);
  [['Y+1', 'Cal+1 FR']].forEach(([t, l]) => {
    const r = row(t); if (!r) return;
    out[t] = r;
    const d1 = r.varD1Pct != null ? r.value - r.value / (1 + r.varD1Pct / 100) : null, w1 = r.varW1Pct != null ? r.value - r.value / (1 + r.varW1Pct / 100) : null;
    tiles.push(tile(l + ' · ' + (r.contract || '').replace(/^FR\s+/, '').replace(/\s+base$/, ''), r.value.toFixed(2), ' €/MWh', sg(d1, 2) + ' vs D-1 · ' + sg(w1, 2) + ' vs D-7', toneP(d1), 'Settlement ' + r.date));
  });

  // Fuels and carbon
  if (window.PKC) {
    try {
      await PKC.ready;
      [['ttf', 'TTF day-ahead', ' €/MWh'], ['eua', 'EUA ' + (PKC.contractLabel ? PKC.contractLabel('eua') : ''), ' €/t']].forEach(([k, l, u]) => {
        const last = PKC.last(k);
        if (!last) return;
        out[k] = { v: last.v, d: last.chg };
        tiles.push(tile(l, last.v.toFixed(2), u, sg(out[k].d, 2) + ' vs previous close', toneP(out[k].d)));
      });
    } catch (_) { /* commodities unavailable */ }
  }

  // Guarantees of origin
  if (gos) {
    const y = +_mrnToday().slice(0, 4);
    [y, y + 1].forEach(yr => {
      const s = _mrnGoSeries(gos, 'GO AIB Renewable', yr);
      if (!s.length) return;
      const l = s[s.length - 1], p = s.length > 1 ? s[s.length - 2] : null;
      out['go' + yr] = { v: l.mid, d: p ? l.mid - p.mid : null, t: l.t };
      tiles.push(tile('GO renewable Cal ' + yr, l.mid.toFixed(3), ' €/MWh', sg(out['go' + yr].d, 3) + ' vs last week', toneP(out['go' + yr].d), 'AIB renewable, broker mid'));
    });
  }
  if (auct && Array.isArray(auct.auctions) && auct.auctions.length) {
    const last = auct.auctions[auct.auctions.length - 1], bt = last.by_technology || [];
    const vol = bt.reduce((s, x) => s + (x.allocated_mwh || 0), 0), val = bt.reduce((s, x) => s + (x.allocated_mwh || 0) * (x.price_eur_mwh || 0), 0);
    if (vol) { out.auction = { month: last.auction_month, price: val / vol, vol }; tiles.push(tile('FR GO auction · ' + last.auction_month, (val / vol).toFixed(3), ' €/MWh', (vol / 1e6).toFixed(2) + ' TWh allocated · EEX', '')); }
  }

  // CO₂ and nuclear (RTE, live)
  if (window.pkRte) {
    const t = _mrnToday();
    const [R, Ry] = await Promise.all([pkRte.day(t).catch(() => null), pkRte.day(_mrnAdd(t, -1)).catch(() => null)]);
    const lastIdx = a => Array.isArray(a) ? a.reduce((m, v, i) => v != null ? i : m, -1) : -1;
    if (R && Array.isArray(R.co2)) {
      const i = lastIdx(R.co2), yAvg = Ry && _mrnMean(Ry.co2);
      out.co2 = { now: i >= 0 ? R.co2[i] : null, y: yAvg };
      tiles.push(tile('CO₂ France now', out.co2.now == null ? '–' : Math.round(out.co2.now), ' g/kWh', 'yesterday ' + (yAvg == null ? '–' : Math.round(yAvg)) + ' g/kWh · RTE'));
    }
    if (R && Array.isArray(R.nuclear)) {
      const i = lastIdx(R.nuclear), cap = fwd && fwd.nuclearCapacity;
      out.nuc = { now: i >= 0 ? R.nuclear[i] : null, avail: cap && cap.actualMW };
      tiles.push(tile('Nuclear output now', out.nuc.now == null ? '–' : (out.nuc.now / 1000).toFixed(1), ' GW',
        cap && cap.actualMW ? 'available ' + (cap.actualMW / 1000).toFixed(1) + ' GW · forecast ' + (cap.forecastMW / 1000).toFixed(1) : 'RTE éCO2mix'));
    }
  }
  host.innerHTML = tiles.join('');
  return out;
}

// ── "What moved" ──
async function _mrnMoves(k) {
  const host = document.getElementById('mrn-moves'); if (!host) return;
  const L = [];
  const sg = (v, dp) => (v >= 0 ? '+' : '') + v.toFixed(dp == null ? 1 : dp);
  const word = (v, up, down) => v >= 0 ? up : down;
  if (k.spot && k.spot.base != null && k.spot.baseP != null) {
    const d = k.spot.base - k.spot.baseP;
    L.push(`<b>Spot</b> ${_mrnDay(k.spot.d)}: baseload ${k.spot.base.toFixed(1)} €/MWh, ${word(d, 'up', 'down')} ${Math.abs(d).toFixed(1)} on the previous day` +
      (k.spot.peak != null ? `, peak ${k.spot.peak.toFixed(1)}` : '') + (k.spot.negH ? `, <span class="mrn-neg">${k.spot.negH} h of negative prices</span>` : '') + '.');
  }
  const s = await _mrnSummary();
  if (s && s.zones && s.zones.FR && s.zones.DE_LU) {
    const fr = s.zones.FR.slice(-1)[0], de = s.zones.DE_LU.find(r => r.d === fr.d);
    if (fr && de) L.push(`<b>FR − DE</b> on ${_mrnDay(fr.d)}: ${sg(fr.avg - de.avg)} €/MWh (FR ${fr.avg.toFixed(1)}, DE ${de.avg.toFixed(1)}); 30-day FR average ${(() => { if (fr.roll30 != null) return fr.roll30.toFixed(1); const v = s.zones.FR.slice(-30).map(r => r.avg).filter(x => x != null); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '–'; })()} €/MWh.`);
  }
  const y1 = k['Y+1'];
  if (y1 && y1.varD1Pct != null) L.push(`<b>Cal+1 FR</b> ${y1.value.toFixed(2)} €/MWh, ${sg(y1.varD1Pct, 2)}% on the day and ${sg(y1.varW1Pct || 0, 2)}% on the week (settlement ${y1.date}).`);
  if (window.PKFwdRead) { try { const r = PKFwdRead.line(await PKFwdRead.compute('1W')); if (r) L.push(r); } catch (_) { /* read unavailable */ } }
  if (k.ttf && k.eua) L.push(`<b>Fuels</b>: TTF ${k.ttf.v.toFixed(2)} €/MWh (${sg(k.ttf.d || 0, 2)}), EUA ${k.eua.v.toFixed(2)} €/t (${sg(k.eua.d || 0, 2)})` +
    (window.PKC && k.spot && k.spot.base != null ? `; clean spark on that day's base ${sg(PKC.cleanSpark(k.spot.base, k.ttf.v, k.eua.v))} €/MWh.` : '.'));
  const y = +_mrnToday().slice(0, 4);
  if (k['go' + (y + 1)]) { const g = k['go' + (y + 1)]; L.push(`<b>GO</b> renewable Cal ${y + 1} at ${g.v.toFixed(3)} €/MWh (${sg(g.d || 0, 3)} w/w)` + (k.auction ? `; last French state auction (${k.auction.month}) cleared ${k.auction.price.toFixed(3)} €/MWh on ${(k.auction.vol / 1e6).toFixed(2)} TWh.` : '.')); }
  if (k.nuc && k.nuc.avail) L.push(`<b>Nuclear</b>: ${k.nuc.now != null ? (k.nuc.now / 1000).toFixed(1) + ' GW produced now, ' : ''}${(k.nuc.avail / 1000).toFixed(1)} GW available.`);
  if (k.co2 && k.co2.now != null) L.push(`<b>CO₂</b>: ${Math.round(k.co2.now)} g/kWh now, ${k.co2.y != null ? Math.round(k.co2.y) : '–'} g/kWh yesterday on average (RTE).`);
  host.innerHTML = L.length ? '<ul>' + L.map(x => '<li>' + x + '</li>').join('') + '</ul>' : '<div class="fuel-note">Waiting for data…</div>';
}

// ── News digest, short: what moves prices or the renewable business (geopolitics, regulation, deals, new
// capacity, gas…), last 48 h, highest market impact first (scripts/fetch_news.py; readers' 👍 / 👎 teach the
// ranking); the reader's ★ keywords on the News page come first ──
const _MRN_CAT = { geopolitics: '🌍', regulation: '⚖', deal: '🤝', build: '🏗', gas: '🔵', carbon: '🌿', markets: '📈', power: '⚡' };
async function _mrnNews() {
  const host = document.getElementById('mrn-news'); if (!host) return;
  const j = await _mrnGet('news', DATA_BASE + 'news.json');
  const items = (j && j.items) || [];
  const kw = typeof _newsKw === 'function' ? _newsKw() : [];
  const mine = i => kw.length && typeof _newsMine === 'function' && _newsMine(i, kw);
  let span = '48 h', pick = [];
  for (const [h, lbl] of [[48, '48 h'], [120, '5 days']]) {
    pick = items.filter(i => Date.parse(i.date) >= Date.now() - h * 3600e3 && ((i.impact || 0) >= 2.5 || mine(i)))
      .sort((a, b) => (mine(b) ? 1 : 0) - (mine(a) ? 1 : 0) || (b.impact || 0) - (a.impact || 0) || Date.parse(b.date) - Date.parse(a.date));
    span = lbl; if (pick.length >= 4) break;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cat = i => { const t = (i.tags || []).find(x => _MRN_CAT[x] && x !== 'power') || ((i.tags || []).includes('power') ? 'power' : ''); return t ? `<span class="mrn-cat" title="${t}">${_MRN_CAT[t]}</span>` : ''; };
  const vote = i => typeof _newsVoteBtns === 'function' ? `<span class="news-vote mrn-vote" data-link="${esc(i.link)}">${_newsVoteBtns(i.link)}</span>` : '';
  host.innerHTML = `<div class="fuel-note" style="margin-bottom:6px">Market movers of the last ${span}: geopolitics, regulation, deals, new capacity, gas${kw.length ? ', and your ★ keywords first' : ''}. 👍 / 👎 teach the selection.</div>` +
    (pick.length ? '<ul class="mrn-movers">' + pick.slice(0, 8).map(i => `<li>${cat(i)}<a href="${/^https?:\/\//.test(i.link) ? esc(i.link) : '#'}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="mrn-src">${esc(i.source)}${(i.countries || []).length ? ' · ' + esc(i.countries.slice(0, 2).join(' · ')) : ''}</span>${vote(i)}</li>`).join('') + '</ul>' : '<div class="fuel-note">No market-moving article in the last days.</div>');
}

async function renderMorning() {
  _mrnNews();
  const upd = document.getElementById('mrn-date');
  if (upd) upd.textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const sub = (id, r) => { const e = document.getElementById(id); if (e && r && r.sub) e.textContent = r.sub; };
  _mrnKpis().then(_mrnMoves);
  PKW.draw('fr-spot-next', 'mrn-spot', {}).then(r => sub('mrn-spot-sub', r));
  if (window.PKF) { PKF.tiles(document.getElementById('mrn-fc-tiles'), 'FR'); PKW.draw('fc-48h', 'mrn-fc', { zone: 'FR' }).then(r => sub('mrn-fc-sub', r)); if (PKW.get('fc-neg')) PKW.draw('fc-neg', 'mrn-neg', {}).then(r => sub('mrn-neg-sub', r)); if (PKW.get('fc-combined')) { PKW.draw('fc-combined', 'mrn-fcc', { tech: 'wind' }).then(r => sub('mrn-fcc-sub', r)); PKW.draw('fc-combined', 'mrn-fcs', { tech: 'solar' }).then(r => sub('mrn-fcs-sub', r)); } }
  const ft = document.getElementById('mrn-fwdt'); if (ft) PKW.get('fr-fwd-table').html(ft, { country: 'FR' });
  PKW.draw('fr-fwd-products', 'mrn-fwdp', { country: 'FR', win: '3M' }).then(r => sub('mrn-fwdp-sub', r));
  const tt = document.getElementById('mrn-ttft'); if (tt && PKW.get('ttf-fwd-table')) PKW.get('ttf-fwd-table').html(tt, {});
  if (PKW.get('ttf-cal-history')) PKW.draw('ttf-cal-history', 'mrn-ttfc', { win: '6M' }).then(r => sub('mrn-ttfc-sub', r));
  PKW.draw('fr-fwd-strip', 'mrn-strip', { country: 'FR' }).then(r => sub('mrn-strip-sub', r));
  PKW.draw('fr-de-spread', 'mrn-frde', { win: '30' }).then(r => sub('mrn-frde-sub', r));
  PKW.draw('go-vintages', 'mrn-go', { product: 'GO AIB Renewable' }).then(r => sub('mrn-go-sub', r));
  PKW.draw('ren-cr', 'mrn-cr', { zone: 'FR', window: '90D' });
  PKW.draw('fr-sys-prod', 'mrn-prod', { day: 'latest' });
  PKW.draw('remit-unavail', 'mrn-remit', { period: '3M' });
}

(function () {
  const css = document.createElement('style');
  css.textContent = `
  .mrn-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:10px;margin-bottom:14px}
  .mrn-kpis .kpi-card{min-width:0}.mrn-kpis .kpi-label,.mrn-kpis .kpi-meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mrn-k{background:var(--bg2);border:1px solid var(--bd);border-radius:9px;padding:10px 12px;min-width:0}
  .mrn-k-l{font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--tx3);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mrn-k-v{font-family:'IBM Plex Mono',monospace;font-size:20px;color:var(--tx);margin-top:4px;white-space:nowrap}
  .mrn-k-v small{font-size:10px;color:var(--tx3)}
  .mrn-k-s{font-size:10px;color:var(--tx3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mrn-k-s.up{color:var(--down,#ED6965)} .mrn-k-s.down{color:var(--up,#14D3A9)}
  .mrn-moves{background:var(--bg2);border:1px solid var(--bd);border-left:3px solid #14D3A9;border-radius:9px;padding:12px 16px;margin-bottom:14px}
  .mrn-moves h3{margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--tx2)}
  .mrn-news{border-left-color:#FBBF24} .mrn-news a{color:var(--tx);text-decoration:none} .mrn-news a:hover{color:var(--acc);text-decoration:underline} .mrn-src{font-size:10.5px;color:var(--tx3)} .mrn-news-more{float:right;font-size:10px;letter-spacing:0;text-transform:none;color:var(--acc);text-decoration:none}
  .mrn-moves ul{margin:0;padding-left:18px} .mrn-moves li{font-size:12.5px;color:var(--tx2);line-height:1.6} .mrn-moves b{color:var(--tx)}
  .mrn-neg{color:#7FC8F8}
  .mrn-movers{list-style:none;margin:0;padding:0} .mrn-movers li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12.5px} .mrn-movers a{color:var(--tx);text-decoration:none;flex:1 1 60%} .mrn-movers a:hover{color:var(--acc)} .mrn-cat{width:18px;text-align:center} .mrn-vote{margin:0 0 0 auto}
  .mrn-fwd{width:100%;border-collapse:collapse;font-size:12px}
  .mrn-fwd th{font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--tx3);font-weight:600;text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd)}
  .mrn-fwd th:first-child,.mrn-fwd td:first-child{text-align:left}
  .mrn-fwd td{padding:5px 8px;text-align:right;font-family:'IBM Plex Mono',monospace;color:var(--tx2);border-bottom:1px solid rgba(255,255,255,.03);white-space:nowrap}
  .mrn-fwd td:first-child{font-family:inherit;color:var(--tx)} .mrn-fwd td small{color:var(--tx3);font-size:10px}
  .mrn-fwd .mrn-fwd-p{color:var(--tx);font-weight:600}
  .mrn-fwd .mrn-up{color:var(--down,#ED6965)} .mrn-fwd .mrn-down{color:var(--up,#14D3A9)}
  .mrn-fwd-g td{font-size:9.5px!important;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3)!important;padding-top:10px!important;font-family:inherit!important}
  .mrn-fwd-note{font-size:10px;color:var(--tx3);margin-top:8px}
  @media (max-width:600px){ .mrn-fwd td,.mrn-fwd th{padding:5px 4px} .mrn-fwd td small{display:block;font-size:9px} .mrn-fwd{font-size:11px} }
  .mrn-sec{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);font-weight:600;margin:18px 0 8px}
  `;
  document.head.appendChild(css);
})();
