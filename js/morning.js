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

// ── language: the morning reads in French unless the EN / FR button says English ──
const _mrnFr = () => !window.PKI18n || PKI18n.lang !== 'en';
const _mT = (fr, en) => _mrnFr() ? fr : en;
const _mN = (v, d) => v == null || !isFinite(v) ? '–' : v.toFixed(d);   // js/i18n.js writes it the French way (26.3 → 26,3)
const _mS = (v, d) => v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '−') + _mN(Math.abs(v), d);
const _mDay = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const _mrnSeries = () => _mrnGet('cs', DATA_BASE + 'history/commodities_series.json');
const _mrnChain = () => _mrnGet('chain', DATA_BASE + 'history/fr_market_calchain.json');
const _mrnNeg = () => _mrnGet('neg', DATA_BASE + 'neg_forecast.json');
const _mrnLast = pts => pts && pts.length ? pts[pts.length - 1] : null;
function _mrnBack(pts, days) {   // value on or before the last date − days
  if (!pts || !pts.length) return null;
  const t = new Date(pts[pts.length - 1][0] + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - days);
  const k = t.toISOString().slice(0, 10); let v = null; for (const [d, x] of pts) { if (d <= k) v = x; else break; } return v;
}
function _mrnSpark(vals, tone) {
  const s = vals.filter(v => v != null); if (s.length < 2) return '';
  const W = 100, H = 26, lo = Math.min(...s), hi = Math.max(...s), sx = W / (s.length - 1), sy = v => H - 2 - (v - lo) / ((hi - lo) || 1) * (H - 4);
  const d = s.map((v, i) => (i ? 'L' : 'M') + (i * sx).toFixed(1) + ' ' + sy(v).toFixed(1)).join(' ');
  const col = tone === 'up' ? 'var(--down)' : tone === 'down' ? 'var(--up)' : 'var(--text3)';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d} L ${W} ${H} L 0 ${H} Z" fill="${col}" fill-opacity=".12"/><path d="${d}" fill="none" stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}

// hourly values of a delivery day (quarter-hours, or 92 / 100 on clock-change days, averaged by hour)
function _mrnHourly(z) {
  const h = z && Array.isArray(z.hourly) ? z.hourly : null; if (!h || !h.some(v => v != null)) return null;
  const n = Math.max(1, Math.round(h.length / 24));
  return Array.from({ length: Math.ceil(h.length / n) }, (_, i) => _mrnMean(h.slice(i * n, i * n + n))).slice(0, 25);
}
// the day's figures: base, peak (8–20 h), lowest and highest hour, hours at or below zero
function _mrnDayStats(hr) {
  if (!hr) return null;
  const v = hr.filter(x => x != null), mn = Math.min(...v), mx = Math.max(...v);
  return { base: _mrnMean(hr), peak: _mrnMean(hr.slice(8, 20)), min: mn, minH: hr.indexOf(mn), max: mx, maxH: hr.indexOf(mx), zero: hr.filter(x => x != null && x <= 0).length };
}

// everything the spot block, the tiles and the 4-week block need, fetched once
async function _mrnFacts() {
  const t = _mrnToday(), tm = _mrnAdd(t, 1), y = _mrnAdd(t, -1);
  const [a, b, c, fwd, cs, chain, sum, neg, gos, dg] = await Promise.all([_mrnDaily(t), _mrnDaily(tm), _mrnDaily(y), _mrnFwd(), _mrnSeries(), _mrnChain(), _mrnSummary().catch(() => null), _mrnNeg(), _mrnGoCsv(), _mrnGet('dg', DATA_BASE + 'market_digest.json')]);
  const S = (cs && cs.series) || {}, P = k => (S[k] || {}).points || [];
  const k = { t, tm, y, cs, P, gos, neg, look: dg && Date.now() - Date.parse(dg.updated) < 5 * 864e5 ? (dg.outlook || {}) : {} };
  const fr = j => j && j.zones && j.zones.FR;
  k.today = _mrnHourly(fr(a)); k.tomorrow = _mrnHourly(fr(b)); k.yday = _mrnHourly(fr(c));
  k.fc = neg && neg.days && neg.days[tm] ? neg.days[tm] : null;
  k.skill = neg && neg.price_skill;
  k.spotDays = ((sum && sum.zones && sum.zones.FR) || []).filter(r => r.avg != null && r.d <= t);
  const yrs = chain && chain.FR && chain.FR.years;
  k.cals = yrs ? Object.keys(yrs).sort().slice(0, 3).map(yy => ({ y: yy, pts: yrs[yy].dates.map((x, i) => [x, yrs[yy].values[i]]) })) : [];
  k.nucCap = fwd && fwd.nuclearCapacity;
  return k;
}

// ── France spot, today and tomorrow: the real price as soon as it is published; before that (about 13:00), the forecast ──
function _mrnSpot(k) {
  const host = document.getElementById('mrn-days'); if (!host) return;
  const B = v => '<b>' + v + '</b>', H = h => _mrnFr() ? h + ' h' : String(h).padStart(2, '0') + ':00';
  const card = (title, st, ref, refLbl, chip) => `<div class="mrn3-day"><div class="mrn3-day-h"><span>${title}</span>${chip}</div>
    <div><span class="mrn3-big">${_mN(st.base, 1)}<small>€/MWh base</small></span>${ref != null ? ` <span class="mrn3-kv">${refLbl} <b class="${st.base - ref > 0 ? 'mrn-up' : 'mrn-dn'}">${_mS(st.base - ref, 1)} €</b></span>` : ''}</div>
    <div class="mrn3-kv">${_mT('pointe 8–20 h', 'peak 8–20h')} ${B(_mN(st.peak, 1))} · min ${B(_mN(st.min, 1))} ${_mT('à', 'at')} ${H(st.minH)} · max ${B(_mN(st.max, 1))} ${_mT('à', 'at')} ${H(st.maxH)} · ${B(st.zero + ' h')} ${_mT('à 0 € ou moins', 'at 0 € or below')}</div></div>`;
  const real = `<span class="mrn3-chip real">${_mT('prix réel', 'actual price')}</span>`;
  const sT = _mrnDayStats(k.today), sY = _mrnDayStats(k.yday), sM = _mrnDayStats(k.tomorrow);
  const out = [];
  out.push(sT ? card(_mT('Aujourd’hui · ', 'Today · ') + _mDay(k.t), sT, sY && sY.base, _mT('vs veille', 'vs day before'), real) : `<div class="mrn3-day"><div class="mrn3-kv">${_mT('Prix du jour pas encore lu.', 'Today’s price not read yet.')}</div></div>`);
  if (sM) out.push(card(_mT('Demain · ', 'Tomorrow · ') + _mDay(k.tm), sM, sT && sT.base, _mT('vs aujourd’hui', 'vs today'), real));
  else if (k.fc && k.fc.price) {
    const fb = _mrnMean(k.fc.price);
    out.push(`<div class="mrn3-day fcst"><div class="mrn3-day-h"><span>${_mT('Demain · ', 'Tomorrow · ') + _mDay(k.tm)}</span><span class="mrn3-chip fc">${_mT('prévision', 'forecast')}</span></div>
      <div><span class="mrn3-big fc">≈ ${_mN(fb, 0)}<small>€/MWh base</small></span> <span class="mrn3-kv">${_mT('prix publié vers 13 h', 'price out around 13:00')}</span></div>
      <div class="mrn3-kv">${k.fc.expected_hours != null ? B('≈ ' + _mN(k.fc.expected_hours, 0) + ' h') + ' ' + _mT('de prix négatif probables', 'of likely negative prices') : ''}${k.skill ? ' · ' + _mT('erreur habituelle ± ', 'usual error ± ') + _mN(k.skill.mae, 0) + ' €' : ''}</div></div>`);
  } else out.push(`<div class="mrn3-day fcst"><div class="mrn3-day-h"><span>${_mT('Demain · ', 'Tomorrow · ') + _mDay(k.tm)}</span><span class="mrn3-chip fc">${_mT('prévision', 'forecast')}</span></div><div class="mrn3-kv">${_mT('Prévision au prochain passage du modèle ; prix publié vers 13 h.', 'Forecast at the model’s next run; price out around 13:00.')}</div></div>`);
  const d7 = k.spotDays.slice(-7), p7 = k.spotDays.slice(-14, -7), m7 = _mrnMean(d7.map(r => r.avg)), mp = _mrnMean(p7.map(r => r.avg));
  const r30 = _mrnMean(k.spotDays.slice(-30).map(r => r.avg));
  if (m7 != null) out.push(`<div class="mrn3-day"><div class="mrn3-day-h"><span>${_mT('7 derniers jours', 'Last 7 days')}</span><span class="mrn3-chip av">${_mT('moyenne', 'average')}</span></div>
    <div><span class="mrn3-big">${_mN(m7, 1)}<small>€/MWh</small></span>${mp ? ` <span class="mrn3-kv">${_mT('vs 7 jours avant', 'vs the 7 days before')} <b class="${m7 > mp ? 'mrn-up' : 'mrn-dn'}">${_mS((m7 / mp - 1) * 100, 1)} %</b></span>` : ''}</div>
    <div class="mrn3-kv">${_mT('moyenne 30 jours', '30-day average')} ${B(_mN(r30, 1))} €/MWh</div></div>`);
  host.innerHTML = out.join('');
  // 48 hours: today, then tomorrow (real or forecast)
  const cid = 'mrn-spot'; if (!document.getElementById(cid) || !window._fuelChart) return;
  const tod = (k.today || []).slice(0, 24), tmr = k.tomorrow ? k.tomorrow.slice(0, 24) : null, fc = !tmr && k.fc ? k.fc.price.slice(0, 24) : null;
  const lbl = [];
  [k.t, k.tm].forEach(d => { for (let h = 0; h < 24; h++) lbl.push(h === 0 ? _mDay(d) : H(h)); });
  const pad = a => a.concat(Array(24 - a.length).fill(null));
  const ds = [_fuelLineDs(_mT('Prix réel', 'Actual price'), pad(tod).concat(tmr ? pad(tmr) : Array(24).fill(null)), '#14D3A9', { borderWidth: 2.2, spanGaps: false, yAxisID: 'y' })];
  if (fc) ds.push(_fuelLineDs(_mT('Prévision', 'Forecast'), Array(24).fill(null).concat(pad(fc)), '#7FC8F8', { borderWidth: 1.8, borderDash: [5, 4], yAxisID: 'y' }));
  if (fc && k.fc.prob) ds.push({ type: 'bar', label: _mT('Probabilité de prix négatif (%)', 'Chance of a negative price (%)'), data: Array(24).fill(null).concat(pad(k.fc.prob.map(p => p == null ? null : Math.round(p * 100)))),
    backgroundColor: Array(24).fill(null).concat(pad(k.fc.prob).map(p => p != null && p >= .5 ? 'rgba(237,105,101,.55)' : 'rgba(127,200,248,.3)')), borderWidth: 0, yAxisID: 'y2', order: 5 });
  const zero = pad(tod).concat(tmr ? pad(tmr) : Array(24).fill(null)).map(v => v != null && v <= 0 ? 100 : null);
  if (zero.some(v => v)) ds.push({ type: 'bar', label: _mT('Heures à 0 € ou moins', 'Hours at 0 € or below'), data: zero, backgroundColor: 'rgba(20,211,169,.12)', borderWidth: 0, barPercentage: 1, categoryPercentage: 1, yAxisID: 'y2', order: 9 });
  const nowH = +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).format(new Date());
  _fuelChart(cid, { type: 'line', data: { labels: lbl, datasets: ds }, options: _fuelOpts({
    scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0, callback: (v, i) => i % 6 === 0 ? lbl[i] : '' } }),
      y: _fuelAxis('€/MWh'), y2: _fuelAxis('%', { position: 'right', min: 0, max: 100, grid: { display: false }, display: !!fc }) },
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10.5 }, boxWidth: 12, padding: 10 } },
      pkFcZone: fc ? { from: 24, now: nowH, label: _mT('PRÉVISION · PRIX PUBLIÉ VERS 13 H', 'FORECAST · PRICE OUT AROUND 13:00'), nowLabel: _mT('maintenant', 'now') } : { from: -1, now: nowH, nowLabel: _mT('maintenant', 'now') } } }) }, 'spot-today-tomorrow');
}

// ── tiles: France Cal+1 (Cal+2 and +3 in its footer), TTF, EUA, Brent, renewable GO, nuclear available; a click opens the page behind ──
function _mrnTiles(k) {
  const host = document.getElementById('mrn-kpis'); if (!host) return;
  const since = (pts, days) => { const l = _mrnLast(pts); if (!l) return []; const t0 = new Date(l[0] + 'T12:00:00Z'); t0.setUTCDate(t0.getUTCDate() - days); const kk = t0.toISOString().slice(0, 10); return pts.filter(p => p[0] >= kk); };
  const ch7 = pts => { const l = _mrnLast(pts), b = _mrnBack(pts, 7); return l && b ? (l[1] / b - 1) * 100 : null; };
  const tone = (c, inv) => c == null || Math.abs(c) < 0.5 ? '' : (c > 0) !== !!inv ? 'up' : 'down';
  const foot = (l, r) => `<span class="mrn3-tx"><span>${l}</span><span>${r}</span></span>`;
  // the week ahead, as in « What moved and why »: the market notes' call, else the direction prices took over 7 days
  const pill = (key, c) => { const o = key && k.look[key], t = o && o.tone ? o.tone : c == null || Math.abs(c) < 1 ? 'flat' : c > 0 ? 'up' : 'down';
    return `<span class="wk-chip ${t === 'up' ? 'wk-up' : t === 'down' ? 'wk-dn' : 'wk-fl'}" title="${_mT('Semaine à venir · ', 'Week ahead · ') + (o && o.tone ? _mT('notes de marché', 'market notes') : _mT('tendance des prix', 'price trend'))}">${t === 'up' ? '↑ ' + _mT('haussier', 'bullish') : t === 'down' ? '↓ ' + _mT('baissier', 'bearish') : '→ ' + _mT('neutre', 'neutral')}</span>`; };
  const head = (name, key, c) => `<span class="mrn3-th"><span class="mrn2-tn">${name}</span>${pill(key, c)}</span>`;
  const ago = _mT('il y a 60 j', '60 d ago'), now = _mT('auj.', 'today');
  const T = [];
  if (k.cals.length) {   // the next calendar year; the two after it in the footer
    const c = k.cals[0], l = _mrnLast(c.pts), cc = ch7(c.pts), tn = tone(cc);
    const rest = k.cals.slice(1).map(x => x.y + ' ' + _mN(_mrnLast(x.pts)[1], 1)).join(' · ');
    T.push(`<a class="mrn2-tile" data-tile="cal" href="#markets/forwards" data-route="markets/forwards" title="${_mT('France, base, dernière cotation', 'France, baseload, last settlement')}">${head('Cal ' + c.y, 'power', cc)}<span class="mrn2-tv">${_mN(l[1], 1)}<small>€/MWh</small></span><span class="mrn2-tc ${tn ? 'mrn-' + tn : ''}">${_mS(cc, 1)} % <span class="mrn3-dim">${_mT('sur 7 j', 'on 7 d')}</span></span>${_mrnSpark(since(c.pts, 60).map(p => p[1]), tn)}${foot(rest, now)}</a>`);
  }
  [['ttf', 'TTF', '€/MWh', 'markets/fuels/ttf', 'gas'], ['eua', 'EUA', '€/t', 'markets/fuels', 'carbon'], ['brent', 'Brent', '$/b', 'markets/fuels', 'oil']].forEach(([key, n, u, r, mk]) => {
    const pts = k.P(key), l = _mrnLast(pts); if (!l) return;
    const c = ch7(pts), tn = tone(c);
    T.push(`<a class="mrn2-tile" data-tile="${key}" href="#${r}" data-route="${r}">${head(n, mk, c)}<span class="mrn2-tv">${_mN(l[1], 1)}<small>${u}</small></span><span class="mrn2-tc ${tn ? 'mrn-' + tn : ''}">${_mS(c, 1)} % <span class="mrn3-dim">${_mT('sur 7 j', 'on 7 d')}</span></span>${_mrnSpark(since(pts, 60).map(p => p[1]), tn)}${foot(ago, now)}</a>`);
  });
  if (k.gos) {
    const y = +_mrnToday().slice(0, 4), g1 = _mrnGoSeries(k.gos, 'GO AIB Renewable', y + 1), g0 = _mrnGoSeries(k.gos, 'GO AIB Renewable', y);
    if (g1.length > 1) {
      const l = g1[g1.length - 1].mid, d = l - g1[g1.length - 2].mid, tn = Math.abs(d) < 1e-6 ? '' : d > 0 ? 'up' : 'down';
      T.push(`<a class="mrn2-tile" data-tile="go" href="#markets/go" data-route="markets/go" title="${_mT('AIB renouvelable, prix moyen courtier, chaque semaine', 'AIB renewable, broker mid, weekly')}">${head('GO ' + (y + 1), null, g1.length > 4 ? (l / g1[g1.length - 5].mid - 1) * 100 : null)}<span class="mrn2-tv">${_mN(l, 3)}<small>€/MWh</small></span><span class="mrn2-tc ${tn ? 'mrn-' + tn : ''}">${_mS(d, 3)} <span class="mrn3-dim">${_mT('sur la sem.', 'on the week')}</span></span>${_mrnSpark(g1.slice(-26).map(p => p.mid), tn)}${foot(g0.length ? 'Cal ' + y + ' ' + _mN(g0[g0.length - 1].mid, 3) : '', _mT('6 mois', '6 months'))}</a>`);
    }
  }
  const nuc = k.P('fr_nuc_avail'), nl = _mrnLast(nuc), fc = _mrnLast(k.P('fr_nuc_avail_fc'));
  if (nl) { const c = ch7(nuc), tn = tone(c, true);   // more nuclear available pushes prices down: green when it rises
    T.push(`<a class="mrn2-tile" data-tile="nuc" href="#system/generation/nuclear" data-route="system/generation/nuclear"><span class="mrn2-tn">${_mT('Nucléaire disponible', 'Nuclear available')}</span><span class="mrn2-tv">${_mN(nl[1] / 1000, 1)}<small>GW</small></span><span class="mrn2-tc ${tn ? 'mrn-' + tn : ''}">${_mS(c, 1)} % <span class="mrn3-dim">${_mT('sur 7 j', 'on 7 d')}</span></span>${_mrnSpark(since(nuc, 60).map(p => p[1]), tn)}${foot(fc ? _mT('prévision exploitant ', 'operator forecast ') + _mN(fc[1] / 1000, 1) : ago, now)}</a>`); }
  host.innerHTML = T.join('');
}

// ── CO₂: a small tile at the top of its folded section ──
async function _mrnTiles2() {
  const host = document.getElementById('mrn-kpis2'); if (!host || host.dataset.done) return; host.dataset.done = '1';
  // GO broker prices are in the tiles at the top, the last state auction in « What moved and why »: here CO₂ only
  const T = [], t = (n, v, u, sub) => T.push(`<div class="mrn2-tile"><span class="mrn2-tn">${n}</span><span class="mrn2-tv">${v}<small>${u}</small></span><span class="mrn2-tc">${sub}</span></div>`);
  if (window.pkRte) {
    const td = _mrnToday();
    const [R, Ry] = await Promise.all([pkRte.day(td).catch(() => null), pkRte.day(_mrnAdd(td, -1)).catch(() => null)]);
    if (R && Array.isArray(R.co2)) { const i = R.co2.reduce((m, v, j) => v != null ? j : m, -1), yAvg = Ry && _mrnMean(Ry.co2);
      if (i >= 0) t(_mT('CO₂ France maintenant', 'CO₂ France now'), Math.round(R.co2[i]), 'g/kWh', _mT('hier ', 'yesterday ') + (yAvg == null ? '–' : Math.round(yAvg)) + ' g/kWh'); }
  }
  host.innerHTML = T.join('');
}

// ── the next 4 weeks: weather against normal week by week, gas storage against its winter mark, month-ahead forward ──
async function _mrnWeeks(k) {
  const host = document.getElementById('mrn-30d'); if (!host) return;
  const [wx, fm] = await Promise.all([_mrnGet('wx', DATA_BASE + 'weather_outlook.json'), _mrnGet('fm', DATA_BASE + 'history/fr_forward_monthly.json')]);
  const pct = (a, b) => a != null && b ? (a / b - 1) * 100 : null;
  let html = '';
  const F = wx && wx.countries && wx.countries.FR && wx.countries.FR.series, weeks = [];
  if (F && F.temp) {
    const days = F.temp.days, today = wx.today || _mrnToday(), i0 = days.findIndex(d => d > today);
    for (let w = 0; w < 4 && i0 >= 0; w++) {
      const ix = days.map((d, i) => i).filter(i => i >= i0 + w * 7 && i < i0 + (w + 1) * 7); if (!ix.length) break;
      const avg = (key, f) => { const v = ix.map(i => F[key] && F[key][f] ? F[key][f][i] : null).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      const tm = avg('temp', 'mean'), tn = avg('temp', 'normal');
      weeks.push({ from: days[ix[0]], dT: tm != null && tn != null ? tm - tn : null, wind: pct(avg('wind', 'mean'), avg('wind', 'normal')), sun: pct(avg('solar', 'mean'), avg('solar', 'normal')) });
    }
  }
  // colder or calmer than normal = firmer prices (red); milder or windier = softer (green)
  const cell = (v, eps, unit, d, inv) => v == null ? '–' : Math.abs(v) < eps ? `<b>≈ ${_mT('normal', 'normal')}</b>` : `<b class="${(inv ? v > 0 : v < 0) ? 'mrn-up' : 'mrn-dn'}">${_mS(v, d)} ${unit}</b>`;
  if (weeks.length) {
    const wn = iso => { const t = new Date(iso + 'T12:00:00Z'), j = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7); };
    html += '<div class="mrn2-weeks">' + weeks.map(w => `<div class="mrn2-wk"><span class="mrn2-wk-t">${_mT('Sem. ', 'Wk ')}${wn(w.from)} · ${new Date(w.from + 'T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
      <span class="mrn2-wk-r"><span>${_mT('Température', 'Temperature')}</span>${cell(w.dT, 0.7, '°C', 1)}</span><span class="mrn2-wk-r"><span>${_mT('Vent', 'Wind')}</span>${cell(w.wind, 8, '%', 0)}</span><span class="mrn2-wk-r"><span>${_mT('Soleil', 'Sun')}</span>${cell(w.sun, 8, '%', 0)}</span></div>`).join('') + '</div>';
  }
  const g = [];
  const st = _mrnLast(k.P('agsi')), ly = st ? _mrnBack(k.P('agsi'), 365) : null;
  if (st) g.push(`<div class="mrn2-g"><div>${_mT('Stocks de gaz UE', 'EU gas storage')} <b>${_mN(st[1], 1)} %</b></div><div class="mrn2-bar"><div class="mrn2-fill" style="width:${Math.min(100, st[1])}%;background:${st[1] < 80 ? 'var(--down)' : 'var(--up)'}"></div><div class="mrn2-mark" style="left:90%"></div></div><div class="mrn2-gs">${_mT('Repère : 90 % au 1er novembre', 'Mark: 90 % on 1 November')}${ly != null ? ' · ' + _mS(st[1] - ly, 1) + _mT(' pts sur un an', ' pts on a year') : ''}</div></div>`);
  if (g.length) html += '<div class="mrn2-gauges">' + g.join('') + '</div>';
  const take = [];
  if (fm && fm.months) { const m1 = Object.keys(fm.months).sort()[0], v1 = fm.months[m1];
    take.push(_mT('Mois prochain (', 'Next month (') + new Date(m1 + '-15T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + ') : <b>' + _mN(+v1.value, 1) + ' €/MWh</b>'); }
  const cold = weeks.filter(w => w.dT != null && w.dT < -1).length, calm = weeks.filter(w => w.wind != null && w.wind < -10).length, windy = weeks.filter(w => w.wind != null && w.wind > 10).length;
  if (cold || calm) take.push(_mT((cold ? 'plus froid' : '') + (cold && calm ? ' et ' : '') + (calm ? 'moins de vent' : '') + ' que la normale sur ' + Math.max(cold, calm) + ' semaine' + (Math.max(cold, calm) > 1 ? 's' : '') + ' : plus de gaz brûlé, des prix plus fermes',
    (cold ? 'colder' : '') + (cold && calm ? ' and calmer' : calm ? 'calmer' : '') + ' than normal in ' + Math.max(cold, calm) + ' week' + (Math.max(cold, calm) > 1 ? 's' : '') + ': more gas burnt, firmer prices'));
  else if (windy) take.push(_mT('plus de vent que la normale sur ' + windy + ' semaine' + (windy > 1 ? 's' : '') + ' : des prix plus bas, plus d’heures négatives à midi', 'windier than normal in ' + windy + ' week' + (windy > 1 ? 's' : '') + ': lower prices, more negative hours at midday'));
  else if (weeks.length) take.push(_mT('météo proche de la normale', 'weather close to normal'));
  if (take.length) html += '<p class="mrn2-note">' + take.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join('. ') + '.</p>';
  host.innerHTML = html || '<div class="fuel-note">' + _mT('Prévisions indisponibles.', 'Outlook not available.') + '</div>';
}

// ── News digest, short: what moves prices or the renewable business (geopolitics, regulation, deals, new
// capacity, gas…), last 48 h, highest market impact first (scripts/fetch_news.py; readers' useful / not useful votes teach the
// ranking); the reader's ★ keywords on the News page come first ──
const _MRN_CAT = { geopolitics: 1, regulation: 1, deal: 1, build: 1, gas: 1, carbon: 1, markets: 1, power: 1 };   // line icons from js/news.js
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
  const esc = PK.esc;   // js/pk-core.js
  const cat = i => { const t = (i.tags || []).find(x => _MRN_CAT[x] && x !== 'power') || ((i.tags || []).includes('power') ? 'power' : ''); return t ? `<span class="mrn-cat" title="${t}">${window._newsIc ? _newsIc(t) : ''}</span>` : ''; };
  const vote = i => typeof _newsVoteBtns === 'function' ? `<span class="news-vote mrn-vote" data-link="${esc(i.link)}">${_newsVoteBtns(i.link)}</span>` : '';
  host.innerHTML = `<div class="fuel-note" style="margin-bottom:6px">Market movers of the last ${span}: geopolitics, regulation, deals, new capacity, gas${kw.length ? ', and your ★ keywords first' : ''}. Your votes (useful / not useful) teach the selection.</div>` +
    (pick.length ? '<ul class="mrn-movers">' + pick.slice(0, 8).map(i => `<li>${cat(i)}<a href="${/^https?:\/\//.test(i.link) ? esc(i.link) : '#'}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="mrn-src">${esc(i.source)}${(i.countries || []).length ? ' · ' + esc(i.countries.slice(0, 2).join(' · ')) : ''}</span>${vote(i)}</li>`).join('') + '</ul>' : '<div class="fuel-note">No market-moving article in the last days.</div>');
}

async function renderMorning() {
  const upd = document.getElementById('mrn-date');
  if (upd) { const t = new Date().toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }); upd.textContent = _mT('Aujourd’hui · ', 'Today · ') + t; }
  const sub = (id, r) => { const e = document.getElementById(id); if (e && r && r.sub) e.textContent = r.sub; };
  _mrnFacts().then(k => {
    MRN.k = k;
    _mrnSpot(k); _mrnTiles(k); _mrnWeeks(k);
    const u = document.getElementById('mrn-upd'); if (u) u.textContent = _mT('mis à jour à ', 'updated ') + new Date().toLocaleTimeString(_mrnFr() ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  }).catch(e => console.warn('[morning]', e));
  if (window.PKBrief) { const b = document.getElementById('mrn-brief'); if (b) PKBrief.brief(b); }
  _mrnNews();
  // the folded sections draw when first opened
  const lazy = {
    'hs-morning-fc': () => { if (!window.PKF) return; PKW.draw('fc-48h', 'mrn-fc', { zone: 'FR' }).then(r => sub('mrn-fc-sub', r)); if (PKW.get('fc-neg')) PKW.draw('fc-neg', 'mrn-neg', {}).then(r => sub('mrn-neg-sub', r)); PKF.tiles(document.getElementById('mrn-fc-tiles'), 'FR'); if (PKW.get('fc-combined')) { PKW.draw('fc-combined', 'mrn-fcc', { tech: 'wind' }).then(r => sub('mrn-fcc-sub', r)); PKW.draw('fc-combined', 'mrn-fcs', { tech: 'solar' }).then(r => sub('mrn-fcs-sub', r)); } },
    'hs-morning-2': () => {
      PKW.draw('fr-de-spread', 'mrn-frde', { win: '30' }).then(r => sub('mrn-frde-sub', r));
      PKW.draw('fr-spot-monthly', 'mrn-sptm', { zone: 'FR' }).then(r => sub('mrn-sptm-sub', r));
      const ft = document.getElementById('mrn-fwdt'); if (ft) PKW.get('fr-fwd-table').html(ft, { country: 'FR' });
      PKW.draw('fr-fwd-products', 'mrn-fwdp', { country: 'FR', win: '3M' }).then(r => sub('mrn-fwdp-sub', r));
      const tt = document.getElementById('mrn-ttft'); if (tt && PKW.get('ttf-fwd-table')) PKW.get('ttf-fwd-table').html(tt, {});
      if (PKW.get('ttf-cal-history')) PKW.draw('ttf-cal-history', 'mrn-ttfc', { win: '6M' }).then(r => sub('mrn-ttfc-sub', r));
      PKW.draw('fr-fwd-strip', 'mrn-strip', { country: 'FR' }).then(r => sub('mrn-strip-sub', r));
    },
    'hs-morning-3': () => { _mrnTiles2(); PKW.draw('go-vintages', 'mrn-go', { product: 'GO AIB Renewable' }).then(r => sub('mrn-go-sub', r)); PKW.draw('ren-cr', 'mrn-cr', { zone: 'FR', window: '90D' }); },
    'hs-morning-4': () => { PKW.draw('fr-sys-prod', 'mrn-prod', { day: 'latest' }); PKW.draw('remit-unavail', 'mrn-remit', { period: '3M' }); },
  };
  Object.entries(lazy).forEach(([id, fn]) => {
    const sec = document.getElementById(id); if (!sec) return;
    if (!sec.classList.contains('collapsed')) { fn(); return; }
    if (sec._mrnLazy) { sec._mrnLazy.fn = fn; return; }   // a refresh: the next opening draws the new data
    const st = sec._mrnLazy = { fn };
    new MutationObserver((_, ob) => { if (!sec.classList.contains('collapsed')) { ob.disconnect(); sec._mrnLazy = null; requestAnimationFrame(() => st.fn()); } }).observe(sec, { attributes: true, attributeFilter: ['class'] });
  });
}

// ── a tile opened full size: its chart with more history and the related series, over the page; ×, Esc, a click
//    outside or the browser's Back close it and the page is where it was; ← → go to the next tile; a link opens the full page ──
const MRN_WIN = {
  cal: k => { const c = k.cals; return { name: 'Cal ' + (c[0] && c[0].y) + ' France', unit: '€/MWh', dp: 1, look: 'power', route: 'markets/forwards', page: _mT('Marchés › Forwards', 'Markets › Forwards'),
    series: c.map((x, i) => ['cal' + x.y, 'Cal ' + x.y, ['#14D3A9', '#7FC8F8', '#A87DC4'][i], 'y', true, x.pts]).concat([['ttf', _mT('Gaz TTF, €/MWh (axe droit)', 'TTF gas, €/MWh (right axis)'), '#FBBF24', 'y2', false, k.P('ttf')]]) }; },
  ttf: k => ({ name: 'TTF', unit: '€/MWh', dp: 1, look: 'gas', route: 'markets/fuels/ttf', page: _mT('Marchés › Combustibles › TTF', 'Markets › Fuels › TTF'),
    series: [['ttf', 'TTF', '#FBBF24', 'y', true, k.P('ttf')], ['agsi', _mT('Stocks de gaz UE, % (axe droit)', 'EU gas storage, % (right axis)'), '#7FC8F8', 'y2', true, k.P('agsi')]] }),
  eua: k => ({ name: 'EUA', unit: '€/t', dp: 1, look: 'carbon', route: 'markets/fuels', page: _mT('Marchés › Combustibles', 'Markets › Fuels'),
    series: [['eua', 'EUA', '#A87DC4', 'y', true, k.P('eua')], ['coal', _mT('Charbon API2, $/t (axe droit)', 'Coal API2, $/t (right axis)'), '#C4A57B', 'y2', false, k.P('coal')]] }),
  brent: k => ({ name: 'Brent', unit: '$/b', dp: 1, look: 'oil', route: 'markets/fuels', page: _mT('Marchés › Combustibles', 'Markets › Fuels'),
    series: [['brent', 'Brent', '#ED6965', 'y', true, k.P('brent')], ['coal', _mT('Charbon API2, $/t (axe droit)', 'Coal API2, $/t (right axis)'), '#C4A57B', 'y2', false, k.P('coal')]] }),
  go: k => { const y = +_mrnToday().slice(0, 4), g = yy => k.gos ? _mrnGoSeries(k.gos, 'GO AIB Renewable', yy).map(r => [r.t, r.mid]) : [];
    return { name: 'GO ' + (y + 1), unit: '€/MWh', dp: 3, look: null, route: 'markets/go', page: _mT('Marchés › Garanties d’origine', 'Markets › Guarantees of origin'), weekly: true,
      series: [y, y + 1, y + 2].map((yy, i) => ['go' + yy, 'Cal ' + yy, ['#7FC8F8', '#14D3A9', '#A87DC4'][i], 'y', true, g(yy)]).filter(x => x[5].length) }; },
  nuc: k => ({ name: _mT('Nucléaire disponible', 'Nuclear available'), unit: 'GW', dp: 1, look: null, inv: true, route: 'system/generation/nuclear', page: _mT('Système › Production › Nucléaire', 'System › Generation › Nuclear'),
    series: [['nuc', _mT('Disponible', 'Available'), '#A98BD4', 'y', true, k.P('fr_nuc_avail').map(p => [p[0], p[1] / 1000])], ['nucfc', _mT('Prévision de l’exploitant', 'Operator forecast'), '#B8C9D9', 'y', true, k.P('fr_nuc_avail_fc').map(p => [p[0], p[1] / 1000])]] }),
};
const MRN_ORDER = ['cal', 'ttf', 'eua', 'brent', 'go', 'nuc'];
let _mrnW = null;   // { id, range, on }
function _mrnWinEl() {
  let ov = document.getElementById('mrn-win'); if (ov) return ov;
  ov = document.createElement('div'); ov.id = 'mrn-win'; ov.hidden = true;
  ov.innerHTML = `<div class="mrn-win" role="dialog" aria-modal="true" aria-labelledby="mrn-win-n"><div class="mrn-win-h"><div><div class="mrn-win-n" id="mrn-win-n"></div><div class="mrn-win-v" id="mrn-win-v"></div></div><button type="button" class="mrn-win-x" id="mrn-win-x">×</button></div>
    <div class="mrn-win-chg" id="mrn-win-chg"></div><div class="mrn-win-ctl"><div class="mrn-win-rng" id="mrn-win-rng"></div><div class="mrn-win-ser" id="mrn-win-ser"></div></div>
    <div class="mrn-win-cw"><canvas id="mrn-win-chart"></canvas></div><div class="mrn-win-why" id="mrn-win-why"></div><div class="mrn-win-f"><span id="mrn-win-keys"></span><a href="#" id="mrn-win-full"></a></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) _mrnWinClose(); });
  ov.querySelector('#mrn-win-x').addEventListener('click', () => _mrnWinClose());
  ov.querySelector('#mrn-win-rng').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; _mrnW.range = b.dataset.r; _mrnWinDraw(); });
  ov.querySelector('#mrn-win-ser').addEventListener('change', e => { const c = e.target.closest('[data-s]'); if (!c) return; _mrnW.on[c.dataset.s] = c.checked; _mrnWinDraw(); });
  ov.querySelector('#mrn-win-full').addEventListener('click', e => { e.preventDefault(); _mrnWinClose(MRN_WIN[_mrnW.id](MRN.k).route); });
  return ov;
}
function _mrnWinOpen(id, push) {
  const k = MRN.k; if (!k || !MRN_WIN[id]) return false;
  const W = MRN_WIN[id](k), main = W.series[0] && W.series.find(x => x[0] !== 'nucfc' && x[4]) ; if (!main || !main[5].length) return false;
  const prev = _mrnW; _mrnW = { id, range: prev ? prev.range : '1Y', on: Object.fromEntries(W.series.map(x => [x[0], x[4]])) };
  const ov = _mrnWinEl(), s = (id === 'go' ? W.series.find(x => x[0] === 'go' + (+_mrnToday().slice(0, 4) + 1)) || main : main)[5], l = _mrnLast(s);
  const look = W.look && k.look && k.look[W.look];
  const chip = look && look.tone ? `<span class="wk-chip ${look.tone === 'up' ? 'wk-up' : look.tone === 'down' ? 'wk-dn' : 'wk-fl'}" title="${_mT('Semaine à venir · notes de marché', 'Week ahead · market notes')}">${look.tone === 'up' ? '↑ ' + _mT('haussier', 'bullish') : look.tone === 'down' ? '↓ ' + _mT('baissier', 'bearish') : '→ ' + _mT('neutre', 'neutral')}</span>` : '';
  ov.querySelector('#mrn-win-n').textContent = W.name + ' · ' + _mT('dernière valeur ', 'last value ') + _mDay(l[0]);
  ov.querySelector('#mrn-win-v').innerHTML = `${_mN(l[1], W.dp)}<small>${W.unit}</small> ${chip}`;
  const chg = [[_mT('1 sem.', '1 wk'), 7], [_mT('1 mois', '1 month'), 30], [_mT('1 an', '1 year'), 365]].map(([lab, d]) => { const b = _mrnBack(s, d); if (b == null || !b) return ''; const c = (l[1] / b - 1) * 100, tn = Math.abs(c) < .5 ? '' : (c > 0) !== !!W.inv ? 'mrn-up' : 'mrn-dn'; return `<span class="${tn}"><i>${lab}</i>${_mS(c, 1)} %</span>`; });
  const y1 = s.filter(p => p[0] >= _mrnAdd(l[0], -365)).map(p => p[1]);
  if (y1.length > 2) chg.push(`<span><i>${_mT('12 mois', '12 months')}</i>min ${_mN(Math.min(...y1), W.dp)} · max ${_mN(Math.max(...y1), W.dp)}</span>`);
  ov.querySelector('#mrn-win-chg').innerHTML = chg.join('');
  ov.querySelector('#mrn-win-ser').innerHTML = W.series.length > 1 ? W.series.map(([sid, lab, col]) => `<label><input type="checkbox" data-s="${sid}" ${_mrnW.on[sid] ? 'checked' : ''}><i style="background:${col}"></i>${lab}</label>`).join('') : '';
  // what to look at, from the numbers
  const y1c = _mrnBack(s, 365) ? (l[1] / _mrnBack(s, 365) - 1) * 100 : null, lo = Math.min(...y1), hi = Math.max(...y1), at = (l[1] - lo) / ((hi - lo) || 1);
  let why = (at > .9 ? _mT('Près du plus haut des 12 derniers mois', 'Near its 12-month high') : at < .1 ? _mT('Près du plus bas des 12 derniers mois', 'Near its 12-month low') : _mT('Dans sa fourchette des 12 derniers mois', 'Within its 12-month range')) + (y1c != null ? _mT(` ; ${_mS(y1c, 0)} % sur un an.`, `; ${_mS(y1c, 0)} % on a year.`) : '.');
  if (id === 'ttf') { const st = _mrnLast(k.P('agsi')), ly = st && _mrnBack(k.P('agsi'), 365); if (st && ly != null) why += _mT(` Stocks de gaz UE ${_mN(st[1], 1)} % contre ${_mN(ly, 1)} % il y a un an.`, ` EU gas storage ${_mN(st[1], 1)} % against ${_mN(ly, 1)} % a year ago.`); }
  if (id === 'nuc') { const fc = _mrnLast(k.P('fr_nuc_avail_fc')); if (fc) why += _mT(` Prévision de l’exploitant : ${_mN(fc[1] / 1000, 1)} GW. Moins de nucléaire, c’est plus de gaz appelé et des prix plus fermes.`, ` Operator forecast: ${_mN(fc[1] / 1000, 1)} GW. Less nuclear means more gas called and firmer prices.`); }
  if (id === 'cal' && W.series.length > 1) why += _mT(' Coche « Gaz TTF » pour voir le gaz sur la même période.', ' Tick “TTF gas” to see gas over the same period.');
  if (id === 'go') why = _mT('Prix moyen courtier, une cotation par semaine. ', 'Broker mid, one quote a week. ') + why;
  ov.querySelector('#mrn-win-why').textContent = why;
  ov.querySelector('#mrn-win-keys').innerHTML = _mT('Fermer : <kbd>×</kbd> <kbd>Échap</kbd>, un clic à côté ou le bouton retour · <kbd>←</kbd> <kbd>→</kbd> tuile précédente / suivante', 'Close: <kbd>×</kbd> <kbd>Esc</kbd>, a click outside or Back · <kbd>←</kbd> <kbd>→</kbd> previous / next tile');
  ov.querySelector('#mrn-win-full').textContent = _mT('Page complète : ', 'Full page: ') + W.page + ' ›';
  ov.querySelector('#mrn-win-x').setAttribute('aria-label', _mT('Fermer', 'Close'));
  const wasHidden = ov.hidden; ov.hidden = false; document.documentElement.classList.add('mrn-win-open');
  if (push && wasHidden) history.pushState(Object.assign({}, history.state, { mrnWin: id }), '', location.href);
  _mrnWinDraw();
  if (wasHidden) ov.querySelector('#mrn-win-x').focus();
  return true;
}
function _mrnWinDraw() {
  const k = MRN.k, W = MRN_WIN[_mrnW.id](k), list = W.series.filter(x => _mrnW.on[x[0]] && x[5].length);
  { const rs = [['1M', _mT('1 mois', '1 month')], ['6M', _mT('6 mois', '6 months')], ['1Y', _mT('1 an', '1 year')], ['3Y', _mT('3 ans', '3 years')], ['ALL', _mT('Tout', 'All')]];
    document.getElementById('mrn-win-rng').innerHTML = rs.map(([r, l]) => `<button type="button" data-r="${r}" class="${_mrnW.range === r ? 'on' : ''}">${l}</button>`).join(''); }
  if (!list.length) return;
  const end = list.map(x => _mrnLast(x[5])[0]).sort().pop(), from = _mrnAdd(end, -({ '1M': 31, '6M': 183, '1Y': 366, '3Y': 1096, ALL: 99999 }[_mrnW.range]));
  const dates = [...new Set(list.flatMap(x => x[5].filter(p => p[0] >= from).map(p => p[0])))].sort();
  const ds = list.map(([sid, lab, col, ax, , pts]) => { const m = new Map(pts); return _fuelLineDs(lab, dates.map(d => m.has(d) ? Math.round(m.get(d) * 1000) / 1000 : null), col,
    { borderWidth: sid === W.series[0][0] ? 2.2 : 1.6, spanGaps: true, yAxisID: ax, pointRadius: pts.length < 120 ? 2 : 0, borderDash: ax === 'y2' || sid === 'nucfc' ? [5, 4] : [] }); });
  const y2 = list.some(x => x[3] === 'y2');
  const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', _mrnW.range === '1M' ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { month: 'short', year: '2-digit', timeZone: 'UTC' });
  _fuelChart('mrn-win-chart', { type: 'line', data: { labels: dates, datasets: ds }, options: _fuelOpts({ interaction: { mode: 'index', intersect: false },
    scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10.5 }, maxTicksLimit: 8, maxRotation: 0, callback: (v, i) => fmt(dates[i]) } }), y: _fuelAxis(W.unit),
      y2: _fuelAxis('', { position: 'right', display: y2, grid: { display: false } }) },
    plugins: { legend: { display: false } } }) }, 'today-' + _mrnW.id);
}
// then: a page to open once the window's history entry is gone (the « Full page » link)
function _mrnWinClose(then) {
  const ov = document.getElementById('mrn-win'); if (!ov || ov.hidden) return;
  ov.hidden = true; document.documentElement.classList.remove('mrn-win-open');
  const id = _mrnW && _mrnW.id; _mrnW = null;
  if (history.state && history.state.mrnWin) { MRN.skipPop = true; MRN.afterPop = then || null; history.back(); }
  else if (then && window.PKNav) PKNav.go(then);
  const t = id && document.querySelector('.mrn2-tile[data-tile="' + id + '"]'); if (t && !then) t.focus();
}
// Back closes the window and nothing else (capture: before the menu's own handler would show the page again)
window.addEventListener('popstate', e => {
  if (MRN.skipPop) { MRN.skipPop = false; e.stopImmediatePropagation(); const r = MRN.afterPop; MRN.afterPop = null; if (r && window.PKNav) setTimeout(() => PKNav.go(r), 0); return; }
  const ov = document.getElementById('mrn-win');
  if (ov && !ov.hidden) { ov.hidden = true; document.documentElement.classList.remove('mrn-win-open'); _mrnW = null; e.stopImmediatePropagation(); }
}, true);
document.addEventListener('keydown', e => {
  const ov = document.getElementById('mrn-win'); if (!ov || ov.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); _mrnWinClose(); return; }
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    const ids = MRN_ORDER.filter(i => document.querySelector('.mrn2-tile[data-tile="' + i + '"]')), i = ids.indexOf(_mrnW.id);
    _mrnWinOpen(ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length], false); e.preventDefault();
  }
});
document.addEventListener('click', e => {   // a tile opens its chart full size (a modified click still opens the page in a new tab)
  const a = e.target.closest && e.target.closest('.mrn2-tile[data-route]');
  if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  // capture phase, before the menu's handler that opens any [data-route] link as a page
  if (a.dataset.tile && _mrnWinOpen(a.dataset.tile, true)) { e.preventDefault(); e.stopPropagation(); }
}, true);

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
  .mrn-movers{list-style:none;margin:0;padding:0} .mrn-movers li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12.5px} .mrn-movers a{color:var(--tx);text-decoration:none;flex:1 1 60%} .mrn-movers a:hover{color:var(--acc)} .mrn-cat{width:18px;text-align:center;color:var(--tx3)} .mrn-vote{margin:0 0 0 auto}
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
  .mrn2{display:flex;flex-direction:column;gap:14px;margin-bottom:16px}
  .mrn2-hdr{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .mrn2-hdr h1{font:600 22px 'Outfit',sans-serif;margin:0;color:var(--text)} .mrn2-hdr h1::first-letter{text-transform:uppercase} .mrn2-upd{font-size:12px;color:var(--text3)}
  .mrn2-card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 18px}
  .mrn2-lbl{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--text3);font-weight:600;margin:0 0 8px}
  .mrn2-brief{border-left:3px solid var(--accent)} .mrn2-brief ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:7px}
  .mrn2-brief li{font-size:14.5px;line-height:1.5;color:var(--text2)} .mrn2-brief b{color:var(--text);font-variant-numeric:tabular-nums;font-weight:600}
  .mrn2-brief b.mrn-up,.mrn2 .mrn-up{color:var(--down)} .mrn2-brief b.mrn-dn,.mrn2 .mrn-dn,.mrn2 .mrn-down{color:var(--up)}
  .mrn2-tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
  .mrn2-tiles-sm{grid-template-columns:repeat(auto-fill,minmax(190px,1fr));margin-bottom:12px}
  @media (max-width:1100px){.mrn2-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media (max-width:560px){.mrn2-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .mrn2-tile{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:1px;min-width:0;text-decoration:none;color:inherit}
  a.mrn2-tile:hover{border-color:var(--border3)}
  .mrn2-tn{font-size:11.5px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mrn2-tv{font:600 21px 'Outfit',sans-serif;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap} .mrn2-tv small{font:500 11px Inter,sans-serif;color:var(--text3);margin-left:4px}
  .mrn2-tc{font-size:11.5px;color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mrn2-tc.mrn-up{color:var(--down)} .mrn2-tc.mrn-down{color:var(--up)}
  .mrn2-tile svg{width:100%;height:28px;margin-top:5px;display:block}
  .mrn2 .fuel-grid-2{margin:0} .mrn2>.chart-container{margin:0}
  .mrn2-weeks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .mrn2-wk{background:var(--bg3);border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:3px;min-width:0}
  .mrn2-wk-t{font-size:11px;color:var(--text3)} .mrn2-wk-r{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:var(--text2)} .mrn2-wk-r b{color:var(--text);font-weight:600;white-space:nowrap}
  .mrn2-gauges{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px;font-size:12.5px;color:var(--text2)} .mrn2-gauges b{color:var(--text)}
  .mrn2-bar{height:8px;border-radius:4px;background:var(--bg3);position:relative;margin-top:6px} .mrn2-fill{height:100%;border-radius:4px}
  .mrn2-mark{position:absolute;top:-4px;width:2px;height:16px;background:var(--text2)} .mrn2-gs{font-size:11.5px;color:var(--text3);margin-top:5px}
  .mrn2-note{font-size:12.5px;color:var(--text2);margin:10px 0 0} .mrn2-note b{color:var(--text)}
  @media (max-width:700px){.mrn2-weeks{grid-template-columns:repeat(2,minmax(0,1fr))}.mrn2-gauges{grid-template-columns:1fr}}
  .mrn-news .mrn-news-more{font-size:11.5px;color:var(--accent);text-decoration:none;margin-left:auto}
  .mrn3-days{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:8px}
  @media (max-width:900px){.mrn3-days{grid-template-columns:1fr}}
  .mrn3-day{border:1px solid var(--border);border-radius:10px;padding:8px 12px;display:flex;flex-direction:column;gap:3px;min-width:0}
  .mrn3-day.fcst{border-style:dashed;border-color:rgba(127,200,248,.5)}
  .mrn3-day-h{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:12px;color:var(--text2)}
  .mrn3-chip{font:600 9.5px 'JetBrains Mono',monospace;letter-spacing:.06em;text-transform:uppercase;border-radius:4px;padding:2px 6px;white-space:nowrap}
  .mrn3-chip.real{color:var(--accent);background:var(--accent-dim)} .mrn3-chip.fc{color:#7FC8F8;background:rgba(127,200,248,.12);border:1px dashed rgba(127,200,248,.55)} .mrn3-chip.av{color:var(--text2);background:rgba(122,147,171,.14)}
  .mrn3-big{font:600 22px 'Outfit',sans-serif;color:var(--text);font-variant-numeric:tabular-nums} .mrn3-big small{font:500 11px Inter,sans-serif;color:var(--text3);margin-left:4px} .mrn3-big.fc{color:#7FC8F8}
  .mrn3-kv{font-size:12px;color:var(--text3)} .mrn3-kv b{color:var(--text);font-weight:600} .mrn3-kv b.mrn-up{color:var(--down)} .mrn3-kv b.mrn-dn{color:var(--up)}
  .mrn2-tiles.mrn3-tiles{grid-template-columns:repeat(6,minmax(0,1fr))}
  .mrn3-w2{grid-column:span 2}
  @media (max-width:1250px){.mrn2-tiles.mrn3-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media (max-width:560px){.mrn2-tiles.mrn3-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .mrn3-fw{display:flex;gap:4px 12px;flex-wrap:wrap;font-size:12px;color:var(--text3);margin-top:3px} .mrn3-fw b{color:var(--text);font:600 13.5px 'JetBrains Mono',monospace}
  .mrn3-fw i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:4px;vertical-align:middle} .mrn3-fw .mrn-up{color:var(--down)} .mrn3-fw .mrn-down{color:var(--up)}
  .mrn2-tile svg{height:40px}
  .mrn3-tx{display:flex;justify-content:space-between;gap:6px;font-size:10px;color:var(--text3);margin-top:2px}
  .mrn3-dim{color:var(--text3)}
  .mrn3-th{display:flex;justify-content:space-between;align-items:center;gap:6px;min-width:0} .mrn3-th .wk-chip{font-size:10px;flex:none} .mrn3-th .mrn2-tn{flex:1 1 auto;min-width:0}
  #mrn-win{position:fixed;inset:0;z-index:2000;background:rgba(0,8,16,.72);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:24px}
  #mrn-win[hidden]{display:none}
  html.mrn-win-open{overflow:hidden}
  .mrn-win{width:min(1100px,100%);max-height:calc(100vh - 48px);overflow:auto;background:var(--bg2);border:1px solid var(--border2);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:16px 20px 14px;display:flex;flex-direction:column;gap:12px}
  .mrn-win-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  .mrn-win-n{font-size:12px;color:var(--text3)} .mrn-win-v{font:600 28px 'Outfit',sans-serif;color:var(--text);display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums} .mrn-win-v small{font:500 13px Inter,sans-serif;color:var(--text3);margin-left:-4px}
  .mrn-win-x{background:none;border:1px solid var(--border2);color:var(--text2);border-radius:8px;width:34px;height:34px;font-size:18px;cursor:pointer;flex:none} .mrn-win-x:hover{border-color:var(--accent);color:var(--text)}
  .mrn-win-chg{display:flex;gap:8px;flex-wrap:wrap} .mrn-win-chg span{font:600 12px 'JetBrains Mono',monospace;color:var(--text);border:1px solid var(--border);border-radius:6px;padding:3px 8px}
  .mrn-win-chg span i{font:500 11px Inter,sans-serif;font-style:normal;color:var(--text3);margin-right:6px} .mrn-win-chg .mrn-up{color:var(--down)} .mrn-win-chg .mrn-dn{color:var(--up)}
  .mrn-win-ctl{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}
  .mrn-win-rng{display:flex;gap:4px} .mrn-win-rng button{font:500 12px Inter,sans-serif;background:var(--bg3);color:var(--text3);border:1px solid var(--border2);border-radius:999px;padding:3px 11px;cursor:pointer} .mrn-win-rng button.on{color:var(--accent);border-color:var(--accent)}
  .mrn-win-ser{display:flex;gap:6px;flex-wrap:wrap} .mrn-win-ser label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);border:1px solid var(--border);border-radius:999px;padding:3px 10px;cursor:pointer} .mrn-win-ser i{width:12px;height:3px;border-radius:2px;display:inline-block}
  .mrn-win-cw{position:relative;height:min(380px,48vh)}
  .mrn-win-why{font-size:13px;color:var(--text2);border-top:1px solid var(--border);padding-top:10px}
  .mrn-win-f{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--text3)} .mrn-win-f a{color:var(--accent);text-decoration:none;font-weight:600}
  .mrn-win-f kbd{font:500 11px 'JetBrains Mono',monospace;border:1px solid var(--border2);border-radius:4px;padding:0 5px;color:var(--text2)}
  @media (max-width:640px){#mrn-win{padding:8px}.mrn-win{padding:12px}.mrn-win-f span{display:none}}
  .mrn-sec{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);font-weight:600;margin:18px 0 8px}
  `;
  document.head.appendChild(css);
})();
