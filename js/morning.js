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
  // tone: 'up' / 'down' (price colours) or a colour of its own (a technology: solar yellow, wind teal)
  const col = tone === 'up' ? 'var(--down)' : tone === 'down' ? 'var(--up)' : tone && /^(#|var\()/.test(tone) ? tone : 'var(--text3)';
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

// ── PowerKlock index: low-carbon coverage and the price it implies ──
// coverage = (nuclear + hydro + wind + solar + bioenergy) ÷ consumption, day by day (RTE éCO2mix). Above 100 %, France
// covers its demand without gas and exports: prices fall towards the neighbours' or below; under 100 %, gas plants set the price.
// Implied price = what a gas plant costs to run (TTF ÷ 0.55 + 0.37 × EUA) × a curve of the coverage, fitted on the last
// three years (least absolute error): the benchmark the day's spot is read against.
function _mrnIndex(rted, P) {
  const rows = rted && rted.rows; if (!rows || !rows.length) return null;
  const ttf = P('ttf'), eua = P('eua'); if (!ttf.length || !eua.length) return null;
  const at = (pts, d) => { let lo = 0, hi = pts.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (pts[m][0] <= d) { r = pts[m][1]; lo = m + 1; } else hi = m - 1; } return r; };
  const seen = new Set(), from = _mrnAdd(_mrnToday(), -1096), D = [];
  rows.forEach(x => { if (seen.has(x.d) || x.d < from || !x.loadAvg) return; seen.add(x.d);
    const cov = ((x.nuclearAvg || 0) + (x.hydroAvg || 0) + (x.windAvg || 0) + (x.solarAvg || 0) + (x.bioAvg || 0)) / x.loadAvg * 100;
    const g = at(ttf, x.d), e = at(eua, x.d); if (g == null || e == null) return;
    const wd = new Date(x.d + 'T12:00:00Z').getUTCDay();
    D.push({ d: x.d, cov, srmc: g / 0.55 + 0.37 * e, p: x.base, we: wd === 0 || wd === 6 ? 1 : 0 }); });
  const fit = D.filter(x => x.p != null); if (fit.length < 200) return null;
  // weekends: lower demand than the coverage alone says (w = their discount)
  const f = (x, a, b, w) => x.srmc / (1 + Math.exp(-(a - b * (x.cov - 100)))) * (1 - w * x.we);
  let best = [Infinity, 0, 0, 0];
  for (let a = -2; a <= 7; a += 0.25) for (let b = 0.04; b <= 0.4; b += 0.01) for (const w of [0, 0.1, 0.2, 0.3]) { let s = 0; for (const x of fit) s += Math.abs(f(x, a, b, w) - x.p); if (s < best[0]) best = [s, a, b, w]; }
  const [, A, B, Wk] = best, mae = best[0] / fit.length;
  D.forEach(x => { x.fair = f(x, A, B, Wk); });
  const pm = fit.reduce((s, x) => s + x.p, 0) / fit.length, ss = fit.reduce((s, x) => s + (x.p - pm) ** 2, 0), sr = fit.reduce((s, x) => s + (x.p - x.fair) ** 2, 0);
  return { rows: D, last: D[D.length - 1], lastP: fit[fit.length - 1], mae, r2: 1 - sr / ss, A, B, Wk };
}
// ── the same index, ahead: the coverage of the coming weeks from the weather outlook and the price it implies ──
// consumption = the usual level of those calendar days (2023–2025) − 2.4 GW per °C above normal (heating season, RTE's
// usual sensitivity); wind and solar = the ensemble mean of the outlook (GWh/day at today's fleet); hydro and bioenergy =
// their usual level; nuclear = the availability of the last day × the usual output ratio (0.92). Gas and CO₂ at today's
// prices. Read against the forward of the month: above it, the fundamentals say dearer than the market.
function _mrnAhead(I, rted, P, wxo, fmo) {
  const F = wxo && wxo.countries && wxo.countries.FR && wxo.countries.FR.series; if (!F || !F.temp || !F.temp.days) return null;
  const rows = rted.rows, today = _mrnToday(), y0 = +today.slice(0, 4) - 3;
  const norm = {}; rows.forEach(x => { const y = +x.d.slice(0, 4); if (y < y0 || x.d >= today.slice(0, 4) + '-01-01' && y >= +today.slice(0, 4) || !x.loadAvg) return;
    const k = x.d.slice(5), o = norm[k] || (norm[k] = { n: 0, load: 0, hydro: 0, bio: 0 }); o.n++; o.load += x.loadAvg; o.hydro += x.hydroAvg || 0; o.bio += x.bioAvg || 0; });
  const nl = _mrnLast(P('fr_nuc_avail')), ttf = _mrnLast(P('ttf')), eua = _mrnLast(P('eua')); if (!nl || !ttf || !eua) return null;
  const srmc = ttf[1] / 0.55 + 0.37 * eua[1], nuc = nl[1] * 0.92;
  const days = F.temp.days, V = (s, i) => F[s] && F[s].mean ? F[s].mean[i] : null, N = (s, i) => F[s] && F[s].normal ? F[s].normal[i] : null;
  const out = [];
  days.forEach((d, i) => { if (d <= today) return; const o = norm[d.slice(5)]; if (!o || !o.n) return;
    const t = V('temp', i), tn = N('temp', i), w = V('wind', i), so = V('solar', i); if (t == null || w == null || so == null) return;
    const load = o.load / o.n - (tn != null && tn < 16 ? 2400 * (t - tn) : 0);
    const cov = (nuc + o.hydro / o.n + o.bio / o.n + w / 24 * 1000 + so / 24 * 1000) / load * 100;
    const wd = new Date(d + 'T12:00:00Z').getUTCDay(), we = wd === 0 || wd === 6 ? 1 : 0;
    out.push({ d, cov, fair: srmc / (1 + Math.exp(-(I.A - I.B * (cov - 100)))) * (1 - I.Wk * we), load, nuc, hydro: o.hydro / o.n, bio: o.bio / o.n, wind: w / 24 * 1000, solar: so / 24 * 1000 }); });
  if (!out.length) return null;
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const weeks = []; for (let i = 0; i < out.length; i += 7) { const w = out.slice(i, i + 7); if (w.length >= 4) weeks.push(Object.assign({ from: w[0].d }, ...['fair', 'cov', 'load', 'nuc', 'hydro', 'bio', 'wind', 'solar'].map(k => ({ [k]: mean(w.map(x => x[k])) })))); }
  // the month after this one, as far as the outlook reaches, against its forward
  const nm = Object.keys((fmo && fmo.months) || {}).sort()[0], inM = nm ? out.filter(x => x.d.startsWith(nm)) : [];
  return { days: out, weeks, fair4: mean(out.slice(0, 28).map(x => x.fair)), cov4: mean(out.slice(0, 28).map(x => x.cov)),
    month: nm && inM.length >= 10 ? { m: nm, fair: mean(inM.map(x => x.fair)), n: inM.length, fwd: +fmo.months[nm].value } : null, srmc, nuc };
}
// everything the spot block, the tiles and the 4-week block need, fetched once
// shared by the dashboard widgets: one fetch for every Today block on a board, kept 10 minutes
function _mrnFactsP() {
  if (!MRN.kP || Date.now() - MRN.kAt > 6e5) { MRN.kAt = Date.now(); MRN.kP = _mrnFacts().then(k => { if (!MRN.k) MRN.k = k; return k; }).catch(e => { MRN.kP = null; throw e; }); }   // the tile window (dashboards) reads MRN.k too
  return MRN.kP;
}
async function _mrnFacts() {
  const t = _mrnToday(), tm = _mrnAdd(t, 1), y = _mrnAdd(t, -1);
  const [a, b, c, fwd, cs, chain, sum, neg, gos, dg, rted, wxo, fmo] = await Promise.all([_mrnDaily(t), _mrnDaily(tm), _mrnDaily(y), _mrnFwd(), _mrnSeries(), _mrnChain(), _mrnSummary().catch(() => null), _mrnNeg(), _mrnGoCsv(), _mrnGet('dg', DATA_BASE + 'market_digest.json'), _mrnGet('rted', DATA_BASE + 'history/rte/fr_daily.json').catch(() => null), _mrnGet('wx', DATA_BASE + 'weather_outlook.json').catch(() => null), _mrnGet('fm', DATA_BASE + 'history/fr_forward_monthly.json').catch(() => null)]);
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
  k.rted = rted;
  try { k.idx = _mrnIndex(rted, P); if (k.idx) k.idx.ahead = _mrnAhead(k.idx, rted, P, wxo, fmo); } catch (e) { console.warn('[index]', e); k.idx = k.idx || null; }
  return k;
}

// ── France spot, today and tomorrow: the real price as soon as it is published; before that (about 13:00), the forecast ──
function _mrnSpot(k, el) {
  const host = el || document.getElementById('mrn-days'); if (!host) return;
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
  if (!el) _mrnSpotChart(k, 'mrn-spot', true);
}
// 48 hours: today, then tomorrow (real, or hatched with the forecast until it is published)
function _mrnSpotChart(k, cid, prob) {
  if (!document.getElementById(cid) || !window._fuelChart) return;
  // three days: yesterday, today, tomorrow (its price once published around 13:00, our forecast before); for each day its
  // average (dashed), its cheapest and dearest hour (dots), its cheapest and dearest 3-hour window (shaded), and a label on top
  const H = h => _mrnFr() ? h + ' h' : String(h).padStart(2, '0') + ':00';
  const yd = (k.yday || []).slice(0, 24), tod = (k.today || []).slice(0, 24), tmr = k.tomorrow ? k.tomorrow.slice(0, 24) : null, fc = !tmr && k.fc ? k.fc.price.slice(0, 24) : null;
  const days = [k.y, k.t, k.tm], lbl = [];
  days.forEach(d => { for (let h = 0; h < 24; h++) lbl.push(h === 0 ? _mDay(d) : H(h)); });
  const pad = a => a.concat(Array(24 - a.length).fill(null)), N24 = Array(24).fill(null);
  const real = pad(yd).concat(pad(tod), tmr ? pad(tmr) : N24);
  const ds = [_fuelLineDs(_mT('Prix réel', 'Actual price'), real, '#14D3A9', { borderWidth: 2.2, spanGaps: false, yAxisID: 'y' })];
  if (fc) ds.push(_fuelLineDs(_mT('Prévision', 'Forecast'), N24.concat(N24, pad(fc)), '#7FC8F8', { borderWidth: 1.8, borderDash: [5, 4], yAxisID: 'y' }));
  if (prob && fc && k.fc.prob) ds.push({ type: 'bar', label: _mT('Probabilité de prix négatif (%)', 'Chance of a negative price (%)'), data: N24.concat(N24, pad(k.fc.prob.map(p => p == null ? null : Math.round(p * 100)))),
    backgroundColor: N24.concat(N24, pad(k.fc.prob).map(p => p != null && p >= .5 ? 'rgba(237,105,101,.55)' : 'rgba(127,200,248,.3)')), borderWidth: 0, yAxisID: 'y2', order: 5 });
  const zero = real.map(v => v != null && v <= 0 ? 100 : null);
  if (zero.some(v => v)) ds.push({ type: 'bar', label: _mT('Heures à 0 € ou moins', 'Hours at 0 € or below'), data: zero, backgroundColor: 'rgba(20,211,169,.12)', borderWidth: 0, barPercentage: 1, categoryPercentage: 1, yAxisID: 'y2', order: 9 });
  // per day: average, extremes, 3-hour windows, label
  const series = [yd, tod, tmr || fc], ann = {}, avgLine = Array(72).fill(null), lo = Array(72).fill(null), hi = Array(72).fill(null);
  let prevAvg = null;
  series.forEach((arr, di) => {
    const v = (arr || []).slice(0, 24); if (v.filter(x => x != null).length < 20) { prevAvg = null; return; }
    const off = di * 24, avg = _mrnMean(v), win = s => { let best = null; for (let h = 0; h <= 21; h++) { const w = v.slice(h, h + 3); if (w.some(x => x == null)) continue; const m = w.reduce((a, b) => a + b, 0) / 3; if (!best || (s < 0 ? m < best.m : m > best.m)) best = { h, m }; } return best; };
    for (let h = 0; h < 24; h++) avgLine[off + h] = Math.round(avg * 10) / 10;
    const mn = Math.min(...v.filter(x => x != null)), mx = Math.max(...v.filter(x => x != null)), iMin = v.indexOf(mn), iMax = v.indexOf(mx);
    lo[off + iMin] = mn; hi[off + iMax] = mx;
    const t = win(-1), p = win(1), isFc = di === 2 && !tmr;
    if (t) ann['t' + di] = { type: 'box', xMin: off + t.h - .5, xMax: off + t.h + 2.5, yScaleID: 'y', backgroundColor: 'rgba(20,211,169,.10)', borderWidth: 0, drawTime: 'beforeDatasetsDraw' };
    if (p) ann['p' + di] = { type: 'box', xMin: off + p.h - .5, xMax: off + p.h + 2.5, yScaleID: 'y', backgroundColor: 'rgba(237,105,101,.10)', borderWidth: 0, drawTime: 'beforeDatasetsDraw' };
    const ch = prevAvg ? (avg / prevAvg - 1) * 100 : null;
    ann['l' + di] = { type: 'label', xValue: off + 11.5, yValue: (ctx) => ctx.chart.scales.y.max, yAdjust: 10, position: { y: 'start' }, color: C_TX2, font: { size: 10.5, family: "'JetBrains Mono', monospace" },
      content: (`${_mDay(days[di])}${isFc ? _mT(' (prévision)', ' (forecast)') : ''} · ${_mN(avg, 1)} €${ch == null ? '' : ' (' + _mS(ch, 0) + ' %)'}`).replace(/(\d)\.(\d)/g, _mrnFr() ? '$1,$2' : '$1.$2') };   // drawn on the canvas: French decimals here
    prevAvg = avg;
  });
  ds.push(_fuelLineDs(_mT('Moyenne du jour', 'Day average'), avgLine, 'rgba(184,201,217,.7)', { borderWidth: 1.1, borderDash: [4, 4], pointRadius: 0, yAxisID: 'y', spanGaps: false }));
  ds.push({ type: 'line', label: _mT('Heure la moins chère', 'Cheapest hour'), data: lo, showLine: false, pointRadius: 4.5, pointBackgroundColor: '#14D3A9', pointBorderColor: '#0A0F14', pointBorderWidth: 1.5, yAxisID: 'y' });
  ds.push({ type: 'line', label: _mT('Heure la plus chère', 'Dearest hour'), data: hi, showLine: false, pointRadius: 4.5, pointBackgroundColor: '#ED6965', pointBorderColor: '#0A0F14', pointBorderWidth: 1.5, yAxisID: 'y' });
  const nowH = +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).format(new Date());
  _fuelChart(cid, { type: 'line', data: { labels: lbl, datasets: ds }, options: _fuelOpts({ layout: { padding: { top: 18 } },
    scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0, callback: (v, i) => i % 6 === 0 ? lbl[i] : '' } }),
      y: _fuelAxis('€/MWh'), y2: _fuelAxis('%', { position: 'right', min: 0, max: 100, grid: { display: false }, display: !!(prob && fc) }) },
    plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10.5 }, boxWidth: 12, padding: 10, filter: it => !/^_/.test(it.text) } },
      annotation: { annotations: ann },
      pkFcZone: !tmr ? { from: 48, now: 24 + nowH, label: fc ? _mT('PRÉVISION · PRIX PUBLIÉ VERS 13 H', 'FORECAST · PRICE OUT AROUND 13:00') : _mT('DEMAIN · PRIX PUBLIÉ VERS 13 H', 'TOMORROW · PRICE OUT AROUND 13:00'), nowLabel: _mT('maintenant', 'now') } : { from: -1, now: 24 + nowH, nowLabel: _mT('maintenant', 'now') } } }) }, 'spot-3-days' + (prob ? '' : '-quick'));
}

// ── tiles: France Cal+1 (Cal+2 and +3 in its footer), TTF, EUA, Brent, renewable GO, nuclear available; a click opens the page behind ──
// ── Fundamentals: the PowerKlock index as a calculation, then week by week the low-carbon supply against demand ──
function _mrnFund(k) {
  const calc = document.getElementById('mrn-fund-calc'), A = k.idx && k.idx.ahead; if (!calc) return;
  if (!A || !A.weeks.length) { calc.innerHTML = '<div class="fuel-note">' + _mT('Indice indisponible.', 'Index not available.') + '</div>'; return; }
  const W = A.weeks.slice(0, 4), m = f => W.reduce((a, w) => a + w[f], 0) / W.length, G = v => _mN(v / 1000, 1), sp7 = _mrnMean(k.spotDays.slice(-7).map(r => r.avg)), M = A.month;
  const ttf = _mrnLast(k.P('ttf')), eua = _mrnLast(k.P('eua'));
  const supply = m('nuc') + m('hydro') + m('bio') + m('wind') + m('solar');
  const term = (n, v, u, s, cls) => `<div class="fd-t${cls ? ' ' + cls : ''}"><span class="fd-n">${n}</span><span class="fd-v">${v}<small>${u}</small></span><span class="fd-s">${s}</span></div>`, op = o => `<span class="fd-op">${o}</span>`;
  calc.innerHTML = term(_mT('Demande prévue', 'Expected demand'), G(m('load')), 'GW', _mT('normale 2023–25, corrigée de la température', 'normal 2023–25, temperature-corrected')) + op('vs') +
    term(_mT('Offre bas carbone', 'Low-carbon supply'), G(supply), 'GW', `<i style="background:#A98BD4"></i>${G(m('nuc'))} <i style="background:#3FA6B4"></i>${G(m('hydro'))} <i style="background:#14D3A9"></i>${G(m('wind'))} <i style="background:#FBBF24"></i>${G(m('solar'))} <i style="background:#94D2BD"></i>${G(m('bio'))}`) + op('=') +
    term(_mT('Couverture', 'Coverage'), _mN(A.cov4, 0), '%', A.cov4 >= 100 ? _mT('au-dessus de 100 % : peu de gaz appelé', 'above 100 %: little gas needed') : _mT('sous 100 % : le gaz fixe le prix', 'below 100 %: gas sets the price')) + op('×') +
    term(_mT('Coût d’une centrale gaz', 'Gas plant cost'), _mN(A.srmc, 0), '€/MWh', `TTF ${ttf ? _mN(ttf[1], 1) : '–'} ÷ 0,55 + 0,37 × EUA ${eua ? _mN(eua[1], 1) : '–'}`) + op('→') +
    term(_mT('Spot attendu, 4 sem.', 'Expected spot, 4 wks'), _mN(A.fair4, 0), '€/MWh', (sp7 ? _mT('vs ', 'vs ') + _mN(sp7, 0) + _mT(' € les 7 derniers jours', ' € the last 7 days') : '') + (M ? ' · ' + _mT('forward ', 'forward ') + M.m.slice(5) + '/' + M.m.slice(2, 4) + ' ' + _mN(M.fwd, 0) + ' €' : ''), 'fd-res');
  if (!window._fuelChart) return;
  const wn = iso => { const t = new Date(iso + 'T12:00:00Z'), j = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7); };
  const L = W.map(w => _mT('Sem. ', 'Wk ') + wn(w.from)), g = f => W.map(w => Math.round(w[f] / 100) / 10);
  const bar = (lab, f, c) => ({ type: 'bar', label: lab, data: g(f), backgroundColor: c, stack: 's', borderWidth: 0, borderRadius: 2, order: 2, barPercentage: .62 });
  _fuelChart('mrn-fund-stack', { type: 'bar', data: { labels: L, datasets: [bar(_mT('Nucléaire', 'Nuclear'), 'nuc', '#7B4B9C'), bar(_mT('Hydraulique', 'Hydro'), 'hydro', '#3FA6B4'), bar(_mT('Bioénergies', 'Bioenergy'), 'bio', '#94D2BD'), bar(_mT('Éolien', 'Wind'), 'wind', '#14D3A9'), bar(_mT('Solaire', 'Solar'), 'solar', '#FBBF24'),
    { type: 'line', label: _mT('Demande prévue', 'Expected demand'), data: g('load'), borderColor: '#E6EDF3', borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#E6EDF3', tension: 0, order: 1, stack: 'd' }] },
    options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } },
      scales: { x: Object.assign(_fuelXAxis(), { stacked: true, ticks: { color: C_TX2, font: { size: 11 }, callback: (v, i) => [L[i], _mN(W[i].fair, 0) + ' € · ' + _mN(W[i].cov, 0) + ' %'] } }), y: _fuelAxis('GW', { stacked: true, beginAtZero: true }) } }) }, 'fundamentals-stack');
}
// ── negative prices: a bar at the top of Today when today or tomorrow has hours at 0 € or below (or the forecast expects some),
//    with the hours, the lowest price and a way to get the e-mail alert ──
// ── your site: the last carbon footprint computed in this browser (Tools › Carbon footprint), or the way in ──
function _mrnCfCard() {
  const el = document.getElementById('mrn-cf'); if (!el) return;
  let L = null; try { L = JSON.parse(localStorage.getItem('pk-cf-last') || 'null'); } catch (_) { L = null; }
  const go = `<a class="pk-btn-ghost" href="#tools/carbon" data-route="tools/carbon">${L ? _mT('Ouvrir l’outil ›', 'Open the tool ›') : _mT('Déposer une courbe ›', 'Drop a curve ›')}</a>`;
  el.innerHTML = `<span class="mrn3-cat">${_mT('Votre site', 'Your site')}</span><b>${_mT('Empreinte de votre consommation', 'Your consumption footprint')}</b>` +
    (L ? `<span>${L.meta ? L.meta + ' · ' : ''}<b>${_mN(L.mwh, 0)} MWh/an</b> · <b>${_mN((L.emL || 0) / 1e6, 1)} t CO₂</b> (${_mN(L.ciH, 1)} g/kWh) · ${_mT('profil', 'profile')} <b>${_mN(L.costAvg, 1)} €/MWh</b>${L.shape != null ? ' (' + _mS(L.shape, 1) + ' % ' + _mT('vs base', 'vs baseload') + ')' : ''}${L.gain ? ' · ' + _mT('gain possible ', 'possible saving ') + '<b>' + _mN(L.gain / 1000, 1) + ' k€/an</b>' : ''} <span class="mrn3-dim">· ${_mT('calculé le ', 'computed on ')}${L.at}</span></span>`
      : `<span class="mrn3-dim">${_mT('Votre courbe Enedis, CSV ou Excel : émissions, coût au spot et ce que vous pourriez gagner, en 30 secondes, sans rien envoyer.', 'Your Enedis, CSV or Excel curve: emissions, spot cost and what you could save, in 30 seconds, nothing sent.')}</span>`) + go;
}
// ── Renewables tiles: the PPA benchmark (3 calendar years, PowerKlock pricer) and the latest M0, solar and wind ──
async function _mrnRenTiles() {
  const host = document.getElementById('mrn-rtiles'); if (!host) return;
  const [bm, m0] = await Promise.all([_mrnGet('ppab', DATA_BASE + 'history/ppa_benchmark.json').catch(() => null), _mrnGet('m0', DATA_BASE + 'm0.json').catch(() => null)]);
  MRN.ren = { bm, m0 };
  const T = [], foot = (l, r) => `<span class="mrn3-tx"><span>${l}</span><span>${r}</span></span>`;
  const days = bm && bm.days ? Object.keys(bm.days).sort() : [];
  if (days.length) { const L = bm.days[days[days.length - 1]], W = bm.days[days[Math.max(0, days.length - 6)]] || {}, ser = t => days.slice(-60).map(d => bm.days[d][t] && bm.days[d][t].ppa).filter(v => v != null);
    [['solar', _mT('PPA solaire', 'Solar PPA'), '#FBBF24'], ['wind', _mT('PPA éolien', 'Wind PPA'), '#14D3A9']].forEach(([t, n, tc]) => { const x = L[t]; if (!x) return; const d = W[t] ? x.ppa - W[t].ppa : null;
      T.push(`<a class="mrn2-tile" data-tile="ppa${t === 'solar' ? 's' : 'w'}" href="#tools/ppa" data-route="tools/ppa" title="${_mT('Prix fixe d’un PPA ' + (t === 'solar' ? 'solaire' : 'éolien') + ' France sur 3 ans calculé chaque jour par le pricer PowerKlock (forwards, taux de capture, GO, écarts)', 'Fixed price of a 3-year French ' + t + ' PPA computed every day by the PowerKlock pricer (forwards, capture, GO, imbalance)')}">` +
        `<span class="mrn3-cat">${_mT('Benchmark PowerKlock', 'PowerKlock benchmark')}</span><span class="mrn3-th"><span class="mrn2-tn">${n} · ${(L.tenor || '').replace(/-/g, '–')}</span></span>` +
        `<span class="mrn2-tv">${_mN(x.ppa, 2)}<small>€/MWh</small></span><span class="mrn2-tc">${d == null ? '' : `<span class="${d > 0 ? 'mrn-up' : d < 0 ? 'mrn-down' : ''}">${_mS(d, 2)} €</span> <span class="mrn3-dim">${_mT('5 j ouvrés', '5 runs')}</span> · `}${_mT('forward', 'forward')} <b>${_mN(x.ref, 1)}</b></span>` +
        _mrnSpark(ser(t), tc) + foot(x.lo != null ? 'P10–P90 <b>' + _mN(x.lo, 0) + '–' + _mN(x.hi, 0) + '</b>' : '', _mT('60 j', '60 d')) + '</a>'); }); }
  const ms = m0 && m0.months ? m0.months.filter(m => m.complete !== false && m.solarM0 != null) : [];
  if (ms.length > 1) { const L = ms[ms.length - 1], P = ms[ms.length - 2], mon = iso => new Date(iso + '-15T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    [['solarM0', 'solarRatio', _mT('M0 solaire', 'Solar M0'), '#FBBF24'], ['windM0', 'windRatio', _mT('M0 éolien', 'Wind M0'), '#14D3A9']].forEach(([k, r, n, tc]) => { const d = L[k] - P[k];
      T.push(`<a class="mrn2-tile" data-tile="m0${k === 'solarM0' ? 's' : 'w'}" href="#renewables/m0" data-route="renewables/m0" title="${_mT('Prix de marché de référence du complément de rémunération : prix spot moyen pondéré par la production nationale du mois (recalculé par PowerKlock)', 'Reference market price of the contract for difference: the month’s spot weighted by national output (recomputed by PowerKlock)')}">` +
        `<span class="mrn3-cat">${_mT('Complément de rémunération', 'Contract for difference')}</span><span class="mrn3-th"><span class="mrn2-tn">${n} · ${mon(L.month)}</span></span>` +
        `<span class="mrn2-tv">${_mN(L[k], 2)}<small>€/MWh</small></span><span class="mrn2-tc"><span class="${d > 0 ? 'mrn-up' : 'mrn-down'}">${_mS(d, 2)} €</span> <span class="mrn3-dim">vs ${mon(P.month)}</span> · ${_mN(L[r] * 100, 0)} % ${_mT('du prix base', 'of baseload')}</span>` +
        _mrnSpark(ms.slice(-12).map(m => m[k]), tc) + foot(_mT('base ', 'baseload ') + '<b>' + _mN(L.base, 1) + '</b>', _mT('12 mois', '12 months')) + '</a>'); }); }
  // the latest CRE tender of each main technology: price kept, volume, when
  const ao = await _mrnGet('aot', DATA_BASE + 'cre_tenders.json').catch(() => null), rows = (ao && ao.rows) || []; MRN.ren.ao = rows;
  const last = t => rows.filter(r => r.tech === t && r.price != null && r.result).sort((a, b) => a.result.localeCompare(b.result)).pop();
  const AO = [['Photovoltaïque sol', _mT('Solaire sol', 'Ground PV'), '#FBBF24'], ['Photovoltaïque bâtiment', _mT('Solaire toiture', 'Rooftop PV'), '#F97316'], ['Éolien terrestre', _mT('Éolien terrestre', 'Onshore wind'), '#14D3A9'], ['Neutre', _mT('Techno neutre', 'Tech-neutral'), '#E6EDF3']].map(([t, n, c]) => [last(t), n, c]).filter(x => x[0]);
  if (AO.length) { const mon = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    T.push(`<a class="mrn2-tile mrn-ao" data-tile="ao" href="#renewables/m0" data-route="renewables/m0" title="${_mT('Prix moyen pondéré retenu au dernier appel d’offres CRE de chaque filière (complément de rémunération, 20 ans)', 'Weighted average price kept at the latest CRE tender of each technology (contract for difference, 20 years)')}">` +
      `<span class="mrn3-cat">${_mT('Appels d’offres CRE', 'CRE tenders')}</span><span class="mrn3-th"><span class="mrn2-tn">${_mT('Derniers prix retenus', 'Latest prices kept')}</span></span>` +
      AO.map(([r, n, c]) => `<span class="mrn-ao-r"><i style="background:${c}"></i><span>${n} <span class="mrn3-dim">${r.period || ''} · ${mon(r.result)}</span></span><b>${_mN(r.price, 2)} €</b></span>`).join('') +
      `<span class="mrn3-tx"><span>${AO.map(([r]) => _mN(r.kept_mw, 0)).join(' / ')} MW</span><span>${_mT('€/MWh', '€/MWh')}</span></span></a>`); }
  host.innerHTML = T.join('') || '';
}
function _mrnNegAlert(k) {
  const H = h => _mrnFr() ? h + ' h' : String(h).padStart(2, '0') + ':00';
  // the hours as runs (10–11 h, 12–15 h), so 4 hours never read as a 5-hour span
  const runs = z => { const out = []; z.forEach(i => { const r = out[out.length - 1]; if (r && i === r[1]) r[1] = i + 1; else out.push([i, i + 1]); });
    return out.map(([a, b]) => _mrnFr() ? (b - a === 1 ? a + ' h' : a + '–' + b + ' h') : H(a) + '–' + H(b)).join(', '); };
  // negative prices only: hours at exactly 0 € do not count
  const one = (hr, lbl) => { if (!hr) return null; const z = hr.map((x, i) => x != null && x < 0 ? i : -1).filter(i => i >= 0); if (!z.length) return null;
    const mn = Math.min(...z.map(i => hr[i]));
    return `${lbl} <b>${z.length} h</b> ${_mT('sous 0 €', 'below 0 €')} (${runs(z)}, min <b>${_mN(mn, 1)} €</b>)`; };
  const parts = [one(k.today, _mT('aujourd’hui', 'today')), k.tomorrow ? one(k.tomorrow, _mT('demain', 'tomorrow')) : null].filter(Boolean);
  if (!k.tomorrow && k.fc && k.fc.expected_hours >= 1) parts.push(`${_mT('demain (prévision)', 'tomorrow (forecast)')} <b>≈ ${_mN(k.fc.expected_hours, 0)} h</b> ${_mT('de prix négatifs probables', 'of negative prices likely')}`);
  const html = parts.length ? `<div class="mrn-negal" role="status"><span class="mrn-negal-i">⚠</span><span><b>${_mT('Prix négatifs', 'Negative prices')}</b> · ${parts.join(' · ')}</span>` +
    `<a href="#markets/spot/negative" data-route="markets/spot/negative">${_mT('détail', 'detail')} ›</a><button type="button" class="pk-btn-ghost mrn-negal-b">${_mT('M’alerter par e-mail', 'E-mail me')}</button></div>` : '';
  ['mrn-q-negal', 'mrn-negal'].forEach(id => { const el = document.getElementById(id); if (!el) return; el.innerHTML = html; el.hidden = !html;
    const b = el.querySelector('.mrn-negal-b'); if (b) b.addEventListener('click', () => { if (window.PKAlerts) PKAlerts.open(); }); });
}
function _mrnTiles(k) {
  const T = _mrnTileList(k);
  const host = document.getElementById('mrn-kpis'); if (host) host.innerHTML = T.join('');
  const q = document.getElementById('mrn-q-tiles'); if (q) q.innerHTML = T.join('');
  _mrnLearnTiles(T, document.getElementById('mrn-l-tiles'));
}
// the six tiles as HTML strings (Today and the dashboard widget 'today-tiles')
function _mrnTileList(k) {
  const since = (pts, days) => { const l = _mrnLast(pts); if (!l) return []; const t0 = new Date(l[0] + 'T12:00:00Z'); t0.setUTCDate(t0.getUTCDate() - days); const kk = t0.toISOString().slice(0, 10); return pts.filter(p => p[0] >= kk); };
  const ch7 = pts => { const l = _mrnLast(pts), b = _mrnBack(pts, 7); return l && b ? (l[1] / b - 1) * 100 : null; };
  const ch1 = pts => pts.length > 1 && pts[pts.length - 2][1] ? (pts[pts.length - 1][1] / pts[pts.length - 2][1] - 1) * 100 : null;
  // « +1.2 % D-1 · +7.1 % 7 d », each in its colour
  const moves = (pts, inv) => { const c1 = ch1(pts), c7 = ch7(pts), cl = c => { const t = tone(c, inv); return t ? 'mrn-' + t : ''; };
    return `<span class="mrn2-tc"><span class="${cl(c1)}">${_mS(c1, 1)} %</span> <span class="mrn3-dim">${_mT('J-1', 'D-1')}</span> · <span class="${cl(c7)}">${_mS(c7, 1)} %</span> <span class="mrn3-dim">${_mT('7 j', '7 d')}</span></span>`; };
  const tone = (c, inv) => c == null || Math.abs(c) < 0.5 ? '' : (c > 0) !== !!inv ? 'up' : 'down';
  const foot = (l, r) => `<span class="mrn3-tx"><span>${l}</span><span>${r}</span></span>`;
  const kv = (label, v) => `${label} <b>${v}</b>`;
  const rng60 = pts => { const v = since(pts, 60).map(p => p[1]).filter(x => x != null); return v.length ? kv('min–max', _mN(Math.min(...v), 1) + '–' + _mN(Math.max(...v), 1)) : ''; };
  // the week ahead, as in « What moved and why »: the market notes' call, else the direction prices took over 7 days
  const pill = (key, c) => { const o = key && k.look[key], t = o && o.tone ? o.tone : c == null || Math.abs(c) < 1 ? 'flat' : c > 0 ? 'up' : 'down';
    return `<span class="wk-chip ${t === 'up' ? 'wk-up' : t === 'down' ? 'wk-dn' : 'wk-fl'}" title="${_mT('Semaine à venir · ', 'Week ahead · ') + (o && o.tone ? _mT('notes de marché', 'market notes') : _mT('tendance des prix', 'price trend'))}">${t === 'up' ? '↑ ' + _mT('haussier', 'bullish') : t === 'down' ? '↓ ' + _mT('baissier', 'bearish') : '→ ' + _mT('neutre', 'neutral')}</span>`; };
  // the market above the name, so a tile reads at a glance (power, gas, CO₂…)
  const cat = t => `<span class="mrn3-cat">${t}</span>`;
  const head = (name, key, c, m) => (m ? cat(m) : '') + `<span class="mrn3-th"><span class="mrn2-tn">${name}</span>${pill(key, c)}</span>`;
  const ago = _mT('il y a 60 j', '60 d ago'), now = _mT('auj.', 'today');
  const T = [];
  if (k.cals.length) {   // the next calendar year; the two after it in the footer
    const c = k.cals[0], l = _mrnLast(c.pts), cc = ch7(c.pts), tn = tone(cc);
    const rest = k.cals.slice(1).map(x => kv('Cal ' + String(x.y).slice(2), _mN(_mrnLast(x.pts)[1], 1))).join(' · ');
    T.push(`<a class="mrn2-tile" data-tile="cal" href="#markets/forwards" data-route="markets/forwards" title="${_mT('France, base, dernière cotation', 'France, baseload, last settlement')}">${head('Cal ' + c.y, 'power', cc, _mT('Électricité · France', 'Power · France'))}<span class="mrn2-tv">${_mN(l[1], 1)}<small>€/MWh</small></span>${moves(c.pts)}${_mrnSpark(since(c.pts, 60).map(p => p[1]), tn)}${foot(rest, _mT('60 j', '60 d'))}</a>`);
  }
  [['ttf', 'TTF', '€/MWh', 'markets/fuels/ttf', 'gas', _mT('Gaz', 'Gas')], ['eua', 'EUA', '€/t', 'markets/fuels', 'carbon', _mT('CO₂', 'CO₂')], ['brent', 'Brent', '$/b', 'markets/fuels', 'oil', _mT('Pétrole', 'Oil')]].forEach(([key, n, u, r, mk, m]) => {
    const pts = k.P(key), l = _mrnLast(pts); if (!l) return;
    const c = ch7(pts), tn = tone(c);
    T.push(`<a class="mrn2-tile" data-tile="${key}" href="#${r}" data-route="${r}">${head(n, mk, c, m)}<span class="mrn2-tv">${_mN(l[1], 1)}<small>${u}</small></span>${moves(pts)}${_mrnSpark(since(pts, 60).map(p => p[1]), tn)}${foot(rng60(pts), _mT('60 j', '60 d'))}</a>`);
  });
  if (k.gos) {
    const y = +_mrnToday().slice(0, 4), g1 = _mrnGoSeries(k.gos, 'GO AIB Renewable', y + 1), g0 = _mrnGoSeries(k.gos, 'GO AIB Renewable', y);
    if (g1.length > 1) {
      const l = g1[g1.length - 1].mid, d = l - g1[g1.length - 2].mid, tn = Math.abs(d) < 1e-6 ? '' : d > 0 ? 'up' : 'down';
      T.push(`<a class="mrn2-tile" data-tile="go" href="#markets/go" data-route="markets/go" title="${_mT('AIB renouvelable, prix moyen courtier, chaque semaine', 'AIB renewable, broker mid, weekly')}">${head('GO ' + (y + 1), null, g1.length > 4 ? (l / g1[g1.length - 5].mid - 1) * 100 : null, _mT('Garanties d’origine', 'Guarantees of origin'))}<span class="mrn2-tv">${_mN(l, 3)}<small>€/MWh</small></span><span class="mrn2-tc ${tn ? 'mrn-' + tn : ''}">${_mS(d, 3)} <span class="mrn3-dim">${_mT('sur la sem.', 'on the week')}</span></span>${_mrnSpark(g1.slice(-26).map(p => p.mid), tn)}${foot(g0.length ? kv('Cal ' + String(y).slice(2), _mN(g0[g0.length - 1].mid, 3)) : '', _mT('6 mois', '6 months'))}</a>`);
    }
  }
  // the PowerKlock index: low-carbon coverage of French demand and the price it implies (see _mrnIndex)
  if (k.idx) { const I = k.idx, L = I.lastP, A = I.ahead, pts = I.rows.map(x => [x.d, x.cov]), c = ch7(pts);
    // the chip reads against the spot of the last 7 days (where prices are going), the line below against the forward
    const sp7 = _mrnMean(k.spotDays.slice(-7).map(r => r.avg));
    const M = A && A.month, mon = M ? new Date(M.m + '-15T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { month: 'short', timeZone: 'UTC' }) : '';
    const main = A ? `<span class="mrn2-tv">${_mN(A.fair4, 0)}<small>€/MWh</small></span><span class="mrn2-tc">${M ? `${mon} : ${_mT('indice', 'index')} <b>${_mN(M.fair, 0)}</b> vs fwd <b>${_mN(M.fwd, 0)}</b> <b class="${M.fair > M.fwd ? 'mrn-up' : 'mrn-down'}">${_mS(M.fair - M.fwd, 0)}</b>` : _mT('spot attendu sur 4 semaines', 'expected spot over 4 weeks')}</span>`
      : `<span class="mrn2-tv">${_mN(L.cov, 0)}<small>%</small></span><span class="mrn2-tc">${_mT('prix implicite', 'implied price')} <b>${_mN(L.fair, 1)} €</b></span>`;
    T.push(`<a class="mrn2-tile" data-tile="idx" href="#tools/compare" data-route="tools/compare" title="${_mT('Spot attendu sur 4 semaines d’après les fondamentaux : couverture de la consommation par le nucléaire, l’hydraulique, les renouvelables et les bioénergies (prévisions météo, nucléaire disponible), au coût du gaz du jour, avec une courbe ajustée sur 3 ans', 'Expected spot over 4 weeks from the fundamentals: demand covered by nuclear, hydro, renewables and bioenergy (weather outlook, nuclear available), at today’s gas cost, through a curve fitted on 3 years')}">` +
      cat(_mT('Indice PowerKlock', 'PowerKlock index')) + `<span class="mrn3-th"><span class="mrn2-tn">${A ? _mT('Spot attendu 4 sem.', 'Expected spot 4 wks') : _mT('Couv. bas carbone', 'Low-carbon cover')}</span>${A && sp7 ? pill(null, (A.fair4 / sp7 - 1) * 100) : pill(null, c == null ? null : -c)}</span>` + main +
      `${_mrnSpark(A ? A.days.slice(0, 28).map(x => x.fair) : since(pts, 60).map(p => p[1]), '')}${foot(kv(_mT('couverture auj.', 'coverage today'), _mN(L.cov, 0) + ' %'), A ? _mT('4 sem.', '4 wks') : _mT('60 j', '60 d'))}</a>`); }
  // Explain: one line under each tile (shown when the switch is on)
  return T.map(h => { const id = (h.match(/data-tile="(\w+)"/) || [])[1], x = id && MRN_EX[id]; return x ? h.replace(/<\/a>$/, `<span class="mrn-x">${_mT(x[0], x[1])}</span></a>`) : h; });
}
// Discovery: three tiles, each with a line on what it is
function _mrnLearnTiles(T, L) {
  const by = id => T.find(x => x.includes('data-tile="' + id + '"')) || '';
  if (L) L.innerHTML = [['cal', _mT('Ce que coûte un MWh livré l’an prochain, acheté aujourd’hui. Il suit surtout le gaz.', 'What a MWh delivered next year costs, bought today. It follows gas above all.')],
    ['ttf', _mT('Le prix du gaz européen. Les jours sans vent ni soleil, les centrales au gaz fixent le prix de l’électricité.', 'The European gas price. On days without wind or sun, gas plants set the power price.')],
    ['idx', _mT('La part de la consommation couverte par le nucléaire, l’hydraulique et les renouvelables. Au-dessus de 100 %, la France n’a pas besoin du gaz : les prix baissent.', 'The share of demand covered by nuclear, hydro and renewables. Above 100 %, France needs no gas: prices fall.')]]
    .map(([id, t]) => by(id) ? `<div class="mrn3-lt">${by(id)}<p>${t}</p></div>` : '').join('');
}

// ── CO₂: a small tile at the top of its folded section ──
async function _mrnTiles2(el) {
  const host = el || document.getElementById('mrn-kpis2'); if (!host || host.dataset.done) return; host.dataset.done = '1';
  // the power system right now (RTE éCO2mix, latest quarter-hour)
  // same build as the market tiles: what it is above the name, the figure, the comparison, today's curve in the source's colour
  const SYS = { [_mT('Carbone', 'Carbon')]: ['sco2', 'system/carbon'], [_mT('Demande', 'Demand')]: ['sload', 'system/demand'], [_mT('Production', 'Generation')]: ['snuc', 'system/generation/nuclear'], [_mT('Renouvelables', 'Renewables')]: ['sren', 'system/generation'], [_mT('Échanges', 'Exchanges')]: ['sexch', 'system/demand/flows'] };
  const T = [], t = (cat, n, v, u, sub, curve, col) => T.push(`<a class="mrn2-tile mrn-sys-t" data-tile="${SYS[cat][0]}" href="#${SYS[cat][1]}" data-route="${SYS[cat][1]}"><span class="mrn3-cat">${cat}</span><span class="mrn3-th"><span class="mrn2-tn">${n}</span></span><span class="mrn2-tv">${v}<small>${u}</small></span><span class="mrn2-tc">${sub}</span>${curve ? _mrnSpark(curve, col) : ''}<span class="mrn3-tx"><span></span><span>${_mT('aujourd’hui', 'today')}</span></span></a>`);
  if (window.pkRte) {
    const td = _mrnToday();
    const [R, Ry] = await Promise.all([pkRte.day(td).catch(() => null), pkRte.day(_mrnAdd(td, -1)).catch(() => null)]);
    const at = (a, i) => Array.isArray(a) ? a[i] : null, li = R && Array.isArray(R.nuclear) ? R.nuclear.reduce((m, v, j) => v != null ? j : m, -1) : -1;
    const vsY = (key, i, d, unit, scale) => { const y = Ry && at(Ry[key], i); const v = at(R[key], i); return y != null && v != null ? _mS((v - y) / (scale || 1), d) + ' ' + unit + _mT(' vs hier même heure', ' vs yesterday same time') : ''; };
    if (li >= 0) {
      const hh = String(Math.floor(li / 4)).padStart(2, '0') + ':' + String(li % 4 * 15).padStart(2, '0');
      const day = (key, f) => Array.isArray(R[key]) ? R[key].slice(0, li + 1).filter((_, j) => j % 4 === 0).map(v => v == null ? null : f ? f(v) : v) : null;
      if (at(R.co2, li) != null) t(_mT('Carbone', 'Carbon'), _mT('CO₂ France à ', 'CO₂ France at ') + hh, Math.round(at(R.co2, li)), 'g/kWh', _mT('hier en moyenne ', 'yesterday on average ') + (Ry && Array.isArray(Ry.co2) ? Math.round(_mrnMean(Ry.co2)) : '–') + ' g/kWh', day('co2'), '#94A3B8');
      if (at(R.load, li) != null) t(_mT('Demande', 'Demand'), _mT('Consommation à ', 'Consumption at ') + hh, _mN(at(R.load, li) / 1000, 1), 'GW', vsY('load', li, 1, 'GW', 1000), day('load'), '#E6EDF3');
      if (at(R.nuclear, li) != null) t(_mT('Production', 'Generation'), _mT('Nucléaire à ', 'Nuclear at ') + hh, _mN(at(R.nuclear, li) / 1000, 1), 'GW', vsY('nuclear', li, 1, 'GW', 1000), day('nuclear'), '#A98BD4');
      const ws = (at(R.wind, li) || 0) + (at(R.solar, li) || 0), ld = at(R.load, li);
      const wsD = Array.isArray(R.wind) ? R.wind.slice(0, li + 1).map((v, j) => (v || 0) + ((R.solar || [])[j] || 0)).filter((_, j) => j % 4 === 0) : null;
      t(_mT('Renouvelables', 'Renewables'), _mT('Éolien + solaire à ', 'Wind + solar at ') + hh, _mN(ws / 1000, 1), 'GW', ld ? _mN(ws / ld * 100, 0) + _mT(' % de la consommation', ' % of consumption') : '', wsD, '#14D3A9');
      const ex = at(R.exchanges, li);
      if (ex != null) t(_mT('Échanges', 'Exchanges'), _mT('Solde à ', 'Balance at ') + hh, _mN(Math.abs(ex) / 1000, 1), 'GW', ex < 0 ? _mT('la France exporte', 'France exports') : _mT('la France importe', 'France imports'), day('exchanges', v => -v), '#7FC8F8');
    }
  }
  host.innerHTML = T.join('');
}

// ── the next 4 weeks: weather against normal week by week, gas storage against its winter mark, month-ahead forward ──
async function _mrnWeeks(k, el) {
  const host = el || document.getElementById('mrn-30d'); if (!host) return;
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
    const AW = k.idx && k.idx.ahead ? k.idx.ahead.weeks : [];   // the PowerKlock index, week by week (same weeks: from tomorrow, 7 days)
    // one table: the weeks in columns, each measure once on the left; a row opens its chart (forecast against normal)
    const wl = w => _mT('Sem. ', 'Wk ') + wn(w.from) + ' · ' + new Date(w.from + 'T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const row = (id, label, f) => `<tr class="mrn-wrow" data-tile="${id}" tabindex="0" title="${_mT('Ouvrir le graphique', 'Open the chart')}"><th>${label} <span class="mrn-wgo">⤢</span></th>${weeks.map((w, wi) => `<td>${f(w, wi)}</td>`).join('')}</tr>`;
    MRN.wx = F;
    html += `<table class="mrn-wtab"><thead><tr><th>${_mT('vs normale hist.', 'vs hist. normal')}</th>${weeks.map(w => `<th>${wl(w)}</th>`).join('')}</tr></thead><tbody>` +
      row('wtemp', _mT('Température', 'Temperature'), w => cell(w.dT, 0.7, '°C', 1)) +
      row('wwind', _mT('Production éolienne', 'Wind output'), w => cell(w.wind, 8, '%', 0)) +
      row('wsun', _mT('Production solaire', 'Solar output'), w => cell(w.sun, 8, '%', 0)) +
      (AW.length ? row('idx', _mT('Spot attendu (indice)', 'Expected spot (index)'), (w, wi) => AW[wi] ? `<b>${_mN(AW[wi].fair, 0)} €</b>` : '–') : '') + '</tbody></table>';
  }
  // below the weeks, two gauges side by side: EU gas storage against its winter mark, French nuclear available against EDF's forecast
  const g = [];
  const st = _mrnLast(k.P('agsi')), ly = st ? _mrnBack(k.P('agsi'), 365) : null;
  if (st) g.push(`<div class="mrn2-g"><div>${_mT('Stockages de gaz UE remplis à', 'EU gas storage filled to')} <b>${_mN(st[1], 1)} %</b> <span class="mrn2-gs" style="display:inline">${_mT('de leur capacité', 'of capacity')}</span></div><div class="mrn2-bar"><div class="mrn2-fill" style="width:${Math.min(100, st[1])}%;background:${st[1] < 80 ? 'var(--down)' : 'var(--up)'}"></div><div class="mrn2-mark" style="left:90%"></div></div><div class="mrn2-gs">${_mT('Repère : objectif UE de 90 % au 1er novembre', 'Mark: EU target of 90 % by 1 November')}${ly != null ? ' · ' + _mS(st[1] - ly, 1) + _mT(' pts vs il y a un an', ' pts vs a year ago') : ''}</div></div>`);
  const nu = _mrnLast(k.P('fr_nuc_avail')), nf = _mrnLast(k.P('fr_nuc_avail_fc')), ny = nu ? _mrnBack(k.P('fr_nuc_avail'), 365) : null, FLEET = 63000;
  if (nu) {
    const short = nf && nu[1] < nf[1] - 1000;   // below what EDF announced: tighter supply, firmer prices
    g.push(`<div class="mrn2-g"><div>${_mT('Nucléaire disponible', 'Nuclear available')} <b>${_mN(nu[1] / 1000, 1)} GW</b> <span class="mrn2-gs" style="display:inline">${_mT('sur 63 GW installés', 'of 63 GW installed')}</span></div>` +
      `<div class="mrn2-bar"><div class="mrn2-fill" style="width:${Math.min(100, nu[1] / FLEET * 100).toFixed(1)}%;background:${short ? 'var(--down)' : 'var(--up)'}"></div>${nf ? `<div class="mrn2-mark" style="left:${Math.min(100, nf[1] / FLEET * 100).toFixed(1)}%"></div>` : ''}</div>` +
      `<div class="mrn2-gs">${nf ? _mT('Repère : prévision d’EDF ', 'Mark: EDF forecast ') + _mN(nf[1] / 1000, 1) + ' GW (' + _mS((nu[1] - nf[1]) / 1000, 1) + ' GW)' : ''}${ny != null ? ' · ' + _mS((nu[1] - ny) / 1000, 1) + _mT(' GW vs il y a un an', ' GW vs a year ago') : ''}</div></div>`);
  }
  // the weeks' table on the left, the two gauges stacked on the right: values stay close to their labels
  if (g.length) html = `<div class="mrn-w4"><div class="mrn-w4-t">${html}</div><div class="mrn2-gauges mrn-gcol">${g.join('')}</div></div>`;
  const why = '';
  const take = [];
  const cold = weeks.filter(w => w.dT != null && w.dT < -1).length, calm = weeks.filter(w => w.wind != null && w.wind < -10).length, windy = weeks.filter(w => w.wind != null && w.wind > 10).length;
  if (cold || calm) take.push(_mT((cold ? 'plus froid' : '') + (cold && calm ? ' et ' : '') + (calm ? 'moins de vent' : '') + ' que la normale sur ' + Math.max(cold, calm) + ' semaine' + (Math.max(cold, calm) > 1 ? 's' : '') + ' : plus de gaz brûlé, des prix en hausse',
    (cold ? 'colder' : '') + (cold && calm ? ' and calmer' : calm ? 'calmer' : '') + ' than normal in ' + Math.max(cold, calm) + ' week' + (Math.max(cold, calm) > 1 ? 's' : '') + ': more gas burnt, higher prices'));
  else if (windy) take.push(_mT('plus de vent que la normale sur ' + windy + ' semaine' + (windy > 1 ? 's' : '') + ' : des prix plus bas, plus d’heures négatives à midi', 'windier than normal in ' + windy + ' week' + (windy > 1 ? 's' : '') + ': lower prices, more negative hours at midday'));
  else if (weeks.length) take.push(_mT('météo proche de la normale', 'weather close to normal'));
  if (why) take.push(why);
  const legend = !weeks.length ? '' : '<p class="fuel-note" style="margin:4px 0 0">' + _mT('Normale hist. = 2016–2025, au parc actuel ; prévisions Open-Meteo calées sur RTE', 'Hist. normal = 2016–2025, at today’s fleet; Open-Meteo forecasts fitted on RTE') + '.</p>';
  // the reading goes in the block's subtitle and the legend in the ⓘ next to its title: nothing under the gauges
  const sub = document.getElementById('mrn-30d-sub'), info = document.getElementById('mrn-30d-i');
  if (sub && !el) { if (take.length) sub.textContent = take.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join('. ') + '.'; }
  else if (take.length) html += '<p class="mrn2-note">' + take.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join('. ') + '.</p>';
  if (info && !el) info.title = _mT('Normale hist. = 2016–2025, au parc actuel ; prévisions Open-Meteo calées sur RTE.', 'Hist. normal = 2016–2025, at today’s fleet; Open-Meteo forecasts fitted on RTE.');
  else html += legend;
  host.innerHTML = html || '<div class="fuel-note">' + _mT('Prévisions indisponibles.', 'Outlook not available.') + '</div>';
}

// ── News digest, short: what moves prices or the renewable business (geopolitics, regulation, deals, new
// capacity, gas…), last 48 h, highest market impact first (scripts/fetch_news.py; readers' useful / not useful votes teach the
// ranking); the reader's ★ keywords on the News page come first ──
const _MRN_CAT = { geopolitics: 1, regulation: 1, deal: 1, build: 1, gas: 1, carbon: 1, markets: 1, power: 1 };   // line icons from js/news.js
async function _mrnNews(el) {
  const host = el || document.getElementById('mrn-news'); if (!host) return;
  const j = await _mrnGet('news', DATA_BASE + 'news.json');
  const items = (j && j.items) || [];
  const kw = typeof _newsKw === 'function' ? _newsKw() : [];
  const mine = i => kw.length && typeof _newsMine === 'function' && _newsMine(i, kw);
  // France first (note of 25 Oct.): French articles with a lower bar, then the main European and world movers
  // a French-language source is not enough: the article must be about France (its institutions, places, market), not about another country
  const FR_IN = /\b(france|français|française|hexagone|edf|rte|cre|enedis|engie|totalenergies|arenh|vnu|turpe|ppe|flamanville|penly|gravelines|tricastin|bugey|gouvernement|ministre|assemblée|sénat|décret|journal officiel|appel d’offres|appel d'offres|bretagne|normandie|occitanie|provence|aquitaine|auvergne|hauts-de-france|grand est|île-de-france)\b/i;
  const FR_OUT = /\b(grecque?|grèce|italie|italien|allemagne|allemand|espagne|espagnol|portugal|belgique|royaume-uni|britannique|chine|chinois|inde|états-unis|américain|japon|australie|afrique|mondial|monde|européen champion|ce pays)\b/i;
  const isFR = i => { const t = i.title + ' ' + (i.snippet || ''); return ((i.countries || []).includes('FR') || (i.tags || []).includes('fr')) && FR_IN.test(t) && !FR_OUT.test(i.title); };
  const rank = (a, b) => (mine(b) ? 1 : 0) - (mine(a) ? 1 : 0) || (b.impact || 0) - (a.impact || 0) || Date.parse(b.date) - Date.parse(a.date);
  let span = 72, fr = [], world = [];
  for (const h of [72, 120, 240]) {
    const recent = items.filter(i => Date.parse(i.date) >= Date.now() - h * 3600e3);
    fr = recent.filter(i => isFR(i) && ((i.impact || 0) >= 1.5 || mine(i))).sort(rank);
    world = recent.filter(i => !isFR(i) && ((i.impact || 0) >= 3 || mine(i))).sort(rank);
    span = h; if (fr.length >= 6) break;
  }
  const esc = PK.esc;   // js/pk-core.js
  const cat = i => { const t = (i.tags || []).find(x => _MRN_CAT[x] && x !== 'power') || ((i.tags || []).includes('power') ? 'power' : ''); return t ? `<span class="mrn-cat" title="${t}">${window._newsIc ? _newsIc(t) : ''}</span>` : ''; };
  const vote = i => typeof _newsVoteBtns === 'function' ? `<span class="news-vote mrn-vote" data-link="${esc(i.link)}">${_newsVoteBtns(i.link)}</span>` : '';
  const li = i => `<li>${cat(i)}<a href="${/^https?:\/\//.test(i.link) ? esc(i.link) : '#'}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="mrn-src">${esc(i.source)} · ${new Date(i.date).toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' })}</span>${vote(i)}</li>`;
  const sec = t => `<div class="mrn-sec" style="margin:10px 0 4px">${t}</div>`;
  host.innerHTML = `<div class="fuel-note" style="margin-bottom:6px">${_mT('Ce qui fait bouger le marché depuis ' + (span / 24) + ' jours, la France d’abord : géopolitique, régulation, nucléaire, transactions, nouvelles capacités, gaz', 'What moved the market over the last ' + (span / 24) + ' days, France first: geopolitics, regulation, nuclear, deals, new capacity, gas') +
    (kw.length ? _mT(', vos mots-clés ★ en tête', ', your ★ keywords first') : '') + _mT('. Vos votes (utile / pas utile) affinent la sélection.', '. Your votes (useful / not useful) teach the selection.')}</div>` +
    // France on the left, Europe and world on the right (one column below the tablet width)
    '<div class="mrn-news-cols">' + (fr.length ? '<div>' + sec(_mT('France', 'France')) + '<ul class="mrn-movers">' + fr.slice(0, 8).map(li).join('') + '</ul></div>' : '') +
    (world.length ? '<div>' + sec(_mT('Europe et monde', 'Europe and world')) + '<ul class="mrn-movers">' + world.slice(0, 8).map(li).join('') + '</ul></div>' : '') + '</div>' +
    (!fr.length && !world.length ? '<div class="fuel-note">' + _mT('Aucun article marquant ces derniers jours.', 'No market-moving article in the last days.') + '</div>' : '');
}

// capture rate by region: solar or wind, over the last full year or several (the choice is the card's own)
function _mrnCreg() {
  // solar above, wind below, one period for both
  const per = document.getElementById('mrn-creg-per'); if (!per || !PKW.get('ren-capture-regions')) return;
  const y = +_mrnToday().slice(0, 4) - 1;
  if (!per.options.length) {
    per.innerHTML = [[String(y), _mT('Année ', 'Year ') + y], [(y - 2) + '-' + y, (y - 2) + '–' + y + _mT(' (3 ans)', ' (3 years)')], [(y - 4) + '-' + y, (y - 4) + '–' + y + _mT(' (5 ans)', ' (5 years)')]].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    per.addEventListener('change', _mrnCreg);
  }
  const lbl = per.options[per.selectedIndex].text;
  PKW.draw('ren-capture-regions', 'mrn-creg', { tech: 'solar', year: per.value }).then(() => { const e = document.getElementById('mrn-creg-sub'); if (e) e.textContent = lbl + _mT(' · production de chaque région au prix spot français, classée, avec la France', ' · each region’s output on the French day-ahead price, ranked, with France'); });
  PKW.draw('ren-capture-regions', 'mrn-cregw', { tech: 'wind', year: per.value }).then(() => { const e = document.getElementById('mrn-cregw-sub'); if (e) e.textContent = lbl + _mT(' · même lecture, éolien', ' · same reading, wind'); });
}
// guarantees of origin next to their chart: broker mid by production year, week and 4-week moves, the last French auction
async function _mrnGoTable(host) {
  if (!host) return;
  const [rows, au] = await Promise.all([_mrnGoCsv(), _mrnAuctions()]);
  const y = +_mrnToday().slice(0, 4), yrs = [y - 1, y, y + 1, y + 2].map(yy => [yy, _mrnGoSeries(rows || [], 'GO AIB Renewable', yy)]).filter(x => x[1].length);
  if (!yrs.length) { host.innerHTML = '<div class="fuel-note">' + _mT('Prix des GO indisponibles.', 'GO prices not available.') + '</div>'; return; }
  const chg = (a, b) => b == null ? '<td>–</td>' : `<td class="${a - b > 1e-6 ? 'mrn-up' : a - b < -1e-6 ? 'mrn-down' : ''}">${_mS(a - b, 3)}</td>`;
  // one table, four columns used by both parts: name · price · change · change (or volume for the auction)
  let h = `<table class="mrn-fwd mrn-got"><colgroup><col style="width:40%"><col style="width:20%"><col style="width:20%"><col style="width:20%"></colgroup><thead><tr><th>${_mT('Année de production', 'Production year')}</th><th>${_mT('Prix €/MWh', 'Price €/MWh')}</th><th>${_mT('vs S-1', 'vs W-1')}</th><th>${_mT('vs 4 sem.', 'vs 4 wks')}</th></tr></thead><tbody>`;
  yrs.forEach(([yy, s]) => { const l = s[s.length - 1].mid, w1 = s.length > 1 ? s[s.length - 2].mid : null, w4 = s.length > 4 ? s[s.length - 5].mid : null;
    h += `<tr><td>Cal ${yy}</td><td class="mrn-fwd-p">${_mN(l, 3)}</td>${chg(l, w1)}${chg(l, w4)}</tr>`; });
  const last = yrs[0][1][yrs[0][1].length - 1].t;
  const AU = au && Array.isArray(au.auctions) ? au.auctions : [], a = AU[AU.length - 1], pa = AU[AU.length - 2];
  if (a) { const bt = a.by_technology || [], vol = bt.reduce((x, r) => x + (r.allocated_mwh || 0), 0), val = bt.reduce((x, r) => x + (r.allocated_mwh || 0) * (r.price_eur_mwh || 0), 0);
    const prev = tech => { const r = pa && (pa.by_technology || []).find(x => x.technology === tech); return r ? r.price_eur_mwh : null; };
    const pv = pa ? (() => { const b2 = pa.by_technology || [], v2 = b2.reduce((x, r) => x + (r.allocated_mwh || 0), 0); return v2 ? b2.reduce((x, r) => x + (r.allocated_mwh || 0) * (r.price_eur_mwh || 0), 0) / v2 : null; })() : null;
    if (vol) h += `<tr class="mrn-fwd-g2"><th>${_mT('Enchère GO France', 'France GO auction')} (${a.auction_month})</th><th>€/MWh</th><th>${_mT('vs enchère préc.', 'vs previous')}${pa ? ' (' + pa.auction_month + ')' : ''}</th><th>TWh</th></tr>` +
      bt.filter(r => r.allocated_mwh).map(r => `<tr><td>${r.technology || ''}</td><td class="mrn-fwd-p">${_mN(r.price_eur_mwh, 3)}</td>${chg(r.price_eur_mwh, prev(r.technology))}<td>${_mN(r.allocated_mwh / 1e6, 2)}</td></tr>`).join('') +
      `<tr><td><b>${_mT('Moyenne', 'Average')}</b></td><td class="mrn-fwd-p"><b>${_mN(val / vol, 3)}</b></td>${chg(val / vol, pv)}<td><b>${_mN(vol / 1e6, 2)}</b></td></tr>`; }
  h += '</tbody></table>';
  host.innerHTML = h + `<div class="mrn-fwd-note">${_mT('Moyenne courtier (offre + demande) du ', 'Broker mid (bid + ask) of ')}${last} · ${_mT('hausse en rouge', 'rise in red')}</div>`;
}

function _mrnQuick(k, el) {
  const host = el || document.getElementById('mrn-q-moved'); if (!host) return;
  const L = [], B = t => '<b>' + t + '</b>';
  const sT = _mrnDayStats(k.today), sY = _mrnDayStats(k.yday), sM = _mrnDayStats(k.tomorrow);
  if (sT) L.push([_mT('Spot', 'Spot'), _mT('aujourd’hui ', 'today ') + B(_mN(sT.base, 1) + ' €') + (sY ? ' (' + _mS(sT.base - sY.base, 1) + ' €)' : '') + (sT.zero ? _mT(`, ${sT.zero} h à 0 €`, `, ${sT.zero} h at 0 €`) : '') +
    (sM ? _mT(' ; demain ', '; tomorrow ') + B(_mN(sM.base, 1) + ' €') : k.fc && k.fc.price ? _mT(' ; demain prévu ≈ ', '; tomorrow forecast ≈ ') + _mN(_mrnMean(k.fc.price), 0) + ' €' : '') + '.']);
  const c = k.cals[0], ty = k.cs && k.cs.calYears && k.cs.calYears.ttf && c && k.cs.calYears.ttf[c.y];
  if (c && ty) { const tP = ty.dates.map((d, i) => [d, ty.values[i]]), dT = _mrnLast(tP)[1] - _mrnBack(tP, 7), dF = _mrnLast(c.pts)[1] - _mrnBack(c.pts, 7);
    L.push([_mT('Forwards', 'Forwards'), (Math.abs(dF - 2 * dT) < 1 ? _mT('le Cal ' + c.y + ' suit le gaz', 'Cal ' + c.y + ' follows gas') : dF > 2 * dT ? _mT('le Cal ' + c.y + ' monte plus que le gaz', 'Cal ' + c.y + ' rises more than gas') : _mT('le Cal ' + c.y + ' monte moins que le gaz', 'Cal ' + c.y + ' rises less than gas')) +
      _mT(' : le gaz seul pèserait ', ': gas alone would weigh ') + B('≈ ' + _mS(2 * dT, 1) + ' €') + _mT(' sur la semaine.', ' on the week.')]); }
  const st = _mrnLast(k.P('agsi')), ly = st && _mrnBack(k.P('agsi'), 365);
  if (st && ly != null) L.push([_mT('Gaz', 'Gas'), _mT('stocks UE ', 'EU storage ') + B(_mS(st[1] - ly, 1) + ' pts') + _mT(' sur un an', ' on a year') + (st[1] < ly ? _mT(' : peu de marge avant l’hiver.', ': little margin before winter.') : '.')]);
  const br = k.P('brent'), v60 = br.filter(p => p[0] >= _mrnAdd(_mrnLast(br)[0], -60)).map(p => p[1]), lb = _mrnLast(br);
  if (lb && v60.length > 10) L.push([_mT('Pétrole', 'Oil'), lb[1] >= Math.max(...v60) - 1e-9 ? _mT('Brent au plus haut sur 60 jours.', 'Brent at a 60-day high.') : lb[1] <= Math.min(...v60) + 1e-9 ? _mT('Brent au plus bas sur 60 jours.', 'Brent at a 60-day low.') : _mT('Brent dans sa fourchette de 60 jours.', 'Brent within its 60-day range.')]);
  const av = _mrnLast(k.P('fr_nuc_avail')), fc = _mrnLast(k.P('fr_nuc_avail_fc'));
  if (av && fc) { const g = (fc[1] - av[1]) / 1000; L.push([_mT('Nucléaire', 'Nuclear'), Math.abs(g) < 1 ? _mT('conforme à la prévision de l’exploitant.', 'in line with the operator forecast.') : B(_mN(Math.abs(g), 1) + ' GW') + (g > 0 ? _mT(' sous la prévision de l’exploitant.', ' below the operator forecast.') : _mT(' au-dessus de la prévision de l’exploitant.', ' above the operator forecast.'))]); }
  host.innerHTML = L.map(([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join('');
}

// Discovery: the day in one sentence, today's price explained, what it means, a glossary (the figures are in the tiles)
// o (dashboard widgets): { sent, day (canvas id), note, means, gloss } — only the parts given are drawn
// ══ Discovery: the day's story in five cards, and a daily quiz checked against the real price ══
function _mrnStory(k) {
  const host = document.getElementById('mrn-story'); if (!host) return;
  const B = t => '<b>' + t + '</b>', sT = _mrnDayStats(k.today), sM = _mrnDayStats(k.tomorrow), cards = [];
  const nl = _mrnLast(k.P('fr_nuc_avail')), nf = _mrnLast(k.P('fr_nuc_avail_fc')), ttf = k.P('ttf'), tl = _mrnLast(ttf), t7 = tl ? (tl[1] / _mrnBack(ttf, 7) - 1) * 100 : null;
  // 1 · the day ahead
  if (sM && sT) { const x = sM.base / Math.max(1, sT.base);
    cards.push([_mT('Demain', 'Tomorrow'), _mT(`Demain, l’électricité coûtera ${B(_mN(sM.base, 0) + ' €/MWh')} en moyenne`, `Tomorrow, power will cost ${B(_mN(sM.base, 0) + ' €/MWh')} on average`),
      (x > 1.5 ? _mT(`${_mN(x, 1)} fois plus qu’aujourd’hui (${_mN(sT.base, 0)} €). `, `${_mN(x, 1)} times today (${_mN(sT.base, 0)} €). `) : x < 0.67 ? _mT(`Bien moins qu’aujourd’hui (${_mN(sT.base, 0)} €). `, `Much less than today (${_mN(sT.base, 0)} €). `) : _mT(`Proche d’aujourd’hui (${_mN(sT.base, 0)} €). `, `Close to today (${_mN(sT.base, 0)} €). `)) +
      (sM.zero ? _mT(`${sM.zero} heures à 0 € ou moins : le soleil et le vent produiront plus que la France ne consomme. `, `${sM.zero} hours at 0 € or below: sun and wind will produce more than France uses. `) : '') +
      _mT(`L’heure la plus chère : ${sM.maxH} h (${_mN(sM.max, 0)} €), quand la demande monte et le soleil se couche.`, `The dearest hour: ${sM.maxH}:00 (${_mN(sM.max, 0)} €), when demand rises and the sun sets.`)]); }
  else if (sT) cards.push([_mT('Aujourd’hui', 'Today'), _mT(`Aujourd’hui, l’électricité coûte ${B(_mN(sT.base, 0) + ' €/MWh')} en moyenne`, `Today, power costs ${B(_mN(sT.base, 0) + ' €/MWh')} on average`),
    (k.fc && k.fc.price ? _mT(`Le prix de demain sort vers 13 h ; notre prévision : environ ${_mN(_mrnMean(k.fc.price.filter(v => v != null)), 0)} €. `, `Tomorrow's price comes out around 13:00; our forecast: about ${_mN(_mrnMean(k.fc.price.filter(v => v != null)), 0)} €. `) : '') + (sT.zero ? _mT(`${sT.zero} h à 0 € ou moins aujourd’hui.`, `${sT.zero} h at 0 € or below today.`) : '')]);
  // 2 · gas
  if (tl) cards.push([_mT('Le gaz', 'Gas'), _mT(`Le gaz européen est à ${B(_mN(tl[1], 1) + ' €/MWh')}`, `European gas is at ${B(_mN(tl[1], 1) + ' €/MWh')}`) + (t7 != null ? ` (${_mS(t7, 1)} % ${_mT('sur 7 jours', 'over 7 days')})` : ''),
    _mT(`Quand le vent et le soleil manquent, ce sont les centrales au gaz qui fixent le prix de l’électricité : à ce niveau, une centrale coûte environ ${_mN(tl[1] / 0.55, 0)} € par MWh produit, avant le CO₂.`, `When wind and sun are short, gas plants set the power price: at this level a plant costs about ${_mN(tl[1] / 0.55, 0)} € per MWh produced, before CO₂.`)]);
  // 3 · nuclear
  if (nl) cards.push([_mT('Le nucléaire', 'Nuclear'), _mT(`${B(_mN(nl[1] / 1000, 1) + ' GW')} de nucléaire disponibles sur 63`, `${B(_mN(nl[1] / 1000, 1) + ' GW')} of nuclear available out of 63`),
    (nf ? (nf[1] - nl[1] > 1500 ? _mT(`C’est ${_mN((nf[1] - nl[1]) / 1000, 1)} GW de moins que ce qu’EDF annonçait : il faut plus de gaz, ce qui pousse les prix vers le haut. `, `That is ${_mN((nf[1] - nl[1]) / 1000, 1)} GW less than EDF announced: more gas is needed, which pushes prices up. `) : _mT('En ligne avec ce qu’EDF annonçait. ', 'In line with what EDF announced. ')) : '') +
    _mT('Le nucléaire fait les deux tiers de l’électricité française : chaque réacteur compte.', 'Nuclear makes two thirds of French power: every reactor counts.')]);
  // 4 · the year ahead
  const c = k.cals[0]; if (c) { const l = _mrnLast(c.pts), c7 = (l[1] / _mrnBack(c.pts, 7) - 1) * 100;
    cards.push([_mT('L’an prochain', 'Next year'), _mT(`Un MWh livré toute l’année ${c.y} se paie ${B(_mN(l[1], 1) + ' €')} aujourd’hui`, `A MWh delivered all through ${c.y} costs ${B(_mN(l[1], 1) + ' €')} today`),
      _mT(`${_mS(c7, 1)} % sur la semaine. C’est le prix auquel les entreprises et les fournisseurs se couvrent ; il suit surtout le gaz de l’an prochain.`, `${_mS(c7, 1)} % on the week. It is the price companies and suppliers hedge at; it follows next year's gas above all.`)]); }
  // 5 · the weeks ahead (PowerKlock index)
  const A = k.idx && k.idx.ahead; if (A) cards.push([_mT('Les semaines à venir', 'The weeks ahead'), _mT(`Les fondamentaux annoncent ${B(_mN(A.fair4, 0) + ' €/MWh')} en moyenne sur 4 semaines`, `The fundamentals point to ${B(_mN(A.fair4, 0) + ' €/MWh')} on average over 4 weeks`),
    _mT(`D’après la météo prévue, le nucléaire disponible et le prix du gaz (indice PowerKlock).`, `From the weather outlook, the nuclear available and the gas price (PowerKlock index).`) + (A.month ? _mT(` Le marché cote ${A.month.m} à ${_mN(A.month.fwd, 0)} € : ${A.month.fair > A.month.fwd ? 'les fondamentaux disent plus cher' : 'les fondamentaux disent moins cher'}.`, ` The market prices ${A.month.m} at ${_mN(A.month.fwd, 0)} €: ${A.month.fair > A.month.fwd ? 'the fundamentals say dearer' : 'the fundamentals say cheaper'}.`) : '')]);
  if (!cards.length) { host.innerHTML = '<div class="fuel-note">' + _mT('Données indisponibles.', 'Data not available.') + '</div>'; return; }
  let i = 0;
  const draw = () => { const [lbl, t, x] = cards[i];
    host.innerHTML = `<div class="mrn-story-h"><span class="mrn3-cat">${_mT('L’histoire du jour', 'The day’s story')} · ${i + 1} / ${cards.length} · ${lbl}</span><span class="mrn-dots">${cards.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</span></div>` +
      `<h3 class="mrn-story-t">${t}</h3><p class="mrn-story-p">${x}</p><div class="mrn-story-n"><button type="button" class="pk-btn-ghost" data-d="-1" ${i ? '' : 'disabled'}>‹ ${_mT('Précédent', 'Previous')}</button><button type="button" class="pk-btn-primary" data-d="1" ${i < cards.length - 1 ? '' : 'disabled'}>${i < cards.length - 1 ? _mT('Suivant : ', 'Next: ') + cards[i + 1][0] + ' ›' : _mT('Fin', 'End')}</button></div>`;
    host.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => { i = Math.max(0, Math.min(cards.length - 1, i + +b.dataset.d)); draw(); })); };
  draw();
}
function _mrnQuiz(k) {
  const host = document.getElementById('mrn-quiz'); if (!host) return;
  let st = {}; try { st = JSON.parse(localStorage.getItem('pk-quiz') || '{}') || {}; } catch (_) { st = {}; }
  const save = () => { try { localStorage.setItem('pk-quiz', JSON.stringify(st)); } catch (_) {} };
  // the real day averages known on this page
  const base = {}; k.spotDays.forEach(r => { base[r.d] = r.avg; });
  const sT = _mrnDayStats(k.today), sM = _mrnDayStats(k.tomorrow), sY = _mrnDayStats(k.yday), neg = {};
  if (sY) { base[k.y] = sY.base; neg[k.y] = sY.zero; } if (sT) { base[k.t] = sT.base; neg[k.t] = sT.zero; } if (sM) { base[k.tm] = sM.base; neg[k.tm] = sM.zero; }
  // the day to guess: tomorrow until its price is out, then the day after; the reference is the day before it
  const target = sM ? _mrnAdd(k.tm, 1) : k.tm, ref = sM ? k.tm : k.t, refB = base[ref];
  const dir = (b, r) => b > r * 1.1 ? 'up' : b < r * 0.9 ? 'down' : 'flat';
  // score: every answer whose day is now known
  let ok = 0, n = 0; const done = [];
  Object.entries(st).forEach(([d, a]) => { if (base[d] == null || a.ref == null) return;
    const r1 = dir(base[d], a.ref) === a.q1; n++; if (r1) ok++;
    let r2 = null; if (neg[d] != null && a.q2) { r2 = (neg[d] > 0 ? 'yes' : 'no') === a.q2; n++; if (r2) ok++; }
    done.push([d, r1, r2]); });
  done.sort((a, b) => b[0].localeCompare(a[0]));
  const A = st[target] || {}, dayName = new Date(target + 'T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const opt = (q, v, l) => `<button type="button" class="mrn-qa${A[q] === v ? ' on' : ''}" data-q="${q}" data-v="${v}">${l}</button>`;
  const last = done[0];
  host.innerHTML = `<span class="mrn3-cat">${_mT('Le quiz du jour', 'Today’s quiz')}</span>` +
    (refB == null ? `<p class="fuel-note">${_mT('Le prix de référence manque : revenez plus tard.', 'The reference price is missing: come back later.')}</p>` :
    `<h3 class="mrn-story-t">${_mT('Le ' + dayName + ', l’électricité sera…', 'On ' + dayName + ', power will be…')}</h3><div class="mrn-qrow">${opt('q1', 'up', _mT('plus chère (+10 % ou plus)', 'dearer (+10 % or more)'))}${opt('q1', 'flat', _mT('à peu près pareille', 'about the same'))}${opt('q1', 'down', _mT('moins chère (−10 % ou plus)', 'cheaper (−10 % or more)'))}</div>` +
    `<p class="fuel-note">${_mT('par rapport au ', 'against ')}${new Date(ref + 'T12:00:00Z').toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { weekday: 'long', timeZone: 'UTC' })} : ${_mN(refB, 0)} €/MWh</p>` +
    `<h3 class="mrn-story-t" style="font-size:14px">${_mT('Y aura-t-il au moins une heure à 0 € ou moins ?', 'Will there be at least one hour at 0 € or below?')}</h3><div class="mrn-qrow">${opt('q2', 'yes', _mT('oui', 'yes'))}${opt('q2', 'no', _mT('non', 'no'))}</div>`) +
    `<p class="mrn-qres">${A.q1 ? _mT('Réponse enregistrée : vérifiée dès que le prix sort (vers 13 h la veille). ', 'Answer saved: checked as soon as the price is out (around 13:00 the day before). ') : ''}` +
    (last ? _mT(`Dernier résultat (${last[0]}) : prix ${last[1] ? '✓' : '✗'}${last[2] == null ? '' : ', heures négatives ' + (last[2] ? '✓' : '✗')}. `, `Last result (${last[0]}): price ${last[1] ? '✓' : '✗'}${last[2] == null ? '' : ', negative hours ' + (last[2] ? '✓' : '✗')}. `) : '') +
    (n ? _mT(`Votre score : <b>${ok} / ${n}</b>.`, `Your score: <b>${ok} / ${n}</b>.`) : _mT('Votre score apparaîtra ici.', 'Your score will show here.')) + `</p><p class="fuel-note">${_mT('Gardé dans ce navigateur seulement.', 'Kept in this browser only.')}</p>`;
  host.querySelectorAll('.mrn-qa').forEach(b => b.addEventListener('click', () => { const a = st[target] || (st[target] = { ref: refB }); a[b.dataset.q] = b.dataset.v; a.ref = refB; save(); _mrnQuiz(k); }));
}
// ══ Explain: a line under each figure of Quick look and Expert, on what it is and why it moves ══
const MRN_EX = {
  cal: ['Le prix d’un MWh livré toute l’année prochaine, acheté aujourd’hui. Il suit surtout le gaz de l’an prochain.', 'The price of a MWh delivered all next year, bought today. It follows next year’s gas above all.'],
  ttf: ['Le prix du gaz européen. Les jours sans vent ni soleil, les centrales au gaz fixent le prix de l’électricité.', 'The European gas price. On days without wind or sun, gas plants set the power price.'],
  eua: ['Le prix du droit d’émettre une tonne de CO₂. Il s’ajoute au coût des centrales au gaz et au charbon (≈ 0,37 t par MWh pour le gaz).', 'The price of the right to emit a tonne of CO₂. It adds to the cost of gas and coal plants (≈ 0.37 t per MWh for gas).'],
  brent: ['Le pétrole. Peu utilisé pour produire l’électricité, mais il entraîne le gaz et signale les tensions géopolitiques.', 'Oil. Little used to make power, but it pulls gas along and signals geopolitical stress.'],
  go: ['Le prix d’un certificat qui prouve qu’un MWh est renouvelable. Un revenu en plus pour les parcs, un coût pour ceux qui veulent de l’électricité verte.', 'The price of a certificate proving a MWh is renewable. Extra income for parks, a cost for green buyers.'],
  idx: ['Le spot attendu sur 4 semaines d’après la météo, le nucléaire et le gaz. Au-dessus du forward : les fondamentaux disent plus cher que le marché.', 'The expected spot over 4 weeks from the weather, nuclear and gas. Above the forward: the fundamentals say dearer than the market.'],
};
function _mrnExplain(on) {
  const b = document.getElementById('mrn-xbtn');
  if (on == null) { try { on = localStorage.getItem('pk-explain') === '1'; } catch (_) { on = false; } }
  document.body.classList.toggle('mrn-explain', !!on);
  if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', !!on); b.textContent = 'ⓘ ' + _mT('Expliquer', 'Explain');
    if (!b.dataset.w) { b.dataset.w = '1'; b.addEventListener('click', () => { const v = !document.body.classList.contains('mrn-explain'); try { localStorage.setItem('pk-explain', v ? '1' : '0'); } catch (_) {} _mrnExplain(v); }); } }
}
function _mrnLearn(k, o) {
  const $ = id => document.getElementById(id);
  o = o || { sent: $('mrn-l-sent'), day: 'mrn-l-day', note: $('mrn-l-day-note'), means: $('mrn-l-means'), gloss: $('mrn-l-gloss') };
  const sent = o.sent;
  const sT = _mrnDayStats(k.today), sY = _mrnDayStats(k.yday), m30 = _mrnMean(k.spotDays.slice(-30).map(r => r.avg)), B = t => '<b>' + t + '</b>';
  const c = k.cals[0], c7 = c ? (_mrnLast(c.pts)[1] / _mrnBack(c.pts, 7) - 1) * 100 : null, ttf = k.P('ttf'), t7 = ttf.length ? (_mrnLast(ttf)[1] / _mrnBack(ttf, 7) - 1) * 100 : null;
  const av = _mrnLast(k.P('fr_nuc_avail')), fc = _mrnLast(k.P('fr_nuc_avail_fc')), nucLow = av && fc && fc[1] - av[1] > 2000;
  let p1 = '';
  if (sT && m30) { const lvl = sT.base < m30 * .7 ? _mT('<b class="mrn-dn">bon marché</b>', '<b class="mrn-dn">cheap</b>') : sT.base > m30 * 1.3 ? _mT('<b class="mrn-up">chère</b>', '<b class="mrn-up">expensive</b>') : _mT('dans la moyenne du mois', 'close to the month’s average');
    p1 = _mT('L’électricité est ', 'Power is ') + lvl + _mT(' aujourd’hui (', ' today (') + B(_mN(sT.base, 0) + ' €/MWh') + (sY ? _mT(' contre ', ' against ') + _mN(sY.base, 0) + _mT(' € hier', ' € yesterday') : '') + ')' + (sT.zero >= 2 ? _mT(', avec des heures à 0 € quand le vent et le soleil dépassent la consommation', ', with hours at 0 € when wind and sun exceed consumption') : '') + '. '; }
  let p2 = '';
  if (c && c7 != null) { const why = [t7 != null && Math.abs(t7) >= 2 ? (t7 > 0 ? _mT('le gaz monte', 'gas is rising') : _mT('le gaz baisse', 'gas is falling')) : null, nucLow ? _mT('il y a moins de nucléaire disponible que prévu', 'less nuclear is available than planned') : null].filter(Boolean);
    p2 = _mT('Pour ' + c.y + ', le prix ', 'For ' + c.y + ', the price ') + (c7 > 1 ? _mT('<b class="mrn-up">monte</b>', '<b class="mrn-up">is rising</b>') : c7 < -1 ? _mT('<b class="mrn-dn">baisse</b>', '<b class="mrn-dn">is falling</b>') : _mT('est stable', 'is steady')) + (why.length ? _mT(' parce que ', ' because ') + why.join(_mT(' et qu’', ' and ')) : '') + '.'; }
  if (sent) sent.innerHTML = p1 + p2;
  // today hour by hour, coloured: 0 € or below, normal, expensive
  const tod = (k.today || []).slice(0, 24);
  if (o.day && tod.length && window._fuelChart) {
    const hi = sT ? sT.base * 1.5 : Infinity, top = Math.max(...tod.filter(v => v != null), 1);
    _fuelChart(o.day, { type: 'bar', data: { labels: tod.map((_, h) => _mrnFr() ? h + ' h' : h + ':00'), datasets: [
      { label: _mT('Prix, €/MWh', 'Price, €/MWh'), data: tod.map(v => v == null ? null : Math.round(v * 10) / 10), backgroundColor: tod.map(v => v != null && v > hi ? 'rgba(237,105,101,.8)' : 'rgba(127,200,248,.6)'), borderWidth: 0, order: 1 },
      // the hours at 0 € or below, shaded over the whole height (their bar has no height)
      { label: _mT('Heures à 0 € ou moins', 'Hours at 0 € or below'), data: tod.map(v => v != null && v <= 0.1 ? top * 1.05 : null), backgroundColor: 'rgba(20,211,169,.22)', borderWidth: 0, barPercentage: 1, categoryPercentage: 1, order: 9 }] },
      options: _fuelOpts({ plugins: { legend: { display: false } }, scales: { x: Object.assign(_fuelXAxis(), { stacked: true }), y: _fuelAxis('€/MWh', { stacked: false }) } }) }, 'today-hours');
    const n = o.note;
    if (n && sT) n.innerHTML = (sT.zero ? _mT(`<b>En vert</b> : ${sT.zero} h à 0 € ou moins, quand le vent et le soleil produisent plus que la France ne consomme. `, `<b>Green</b>: ${sT.zero} h at 0 € or below, when wind and sun produce more than France consumes. `) : '') +
      _mT(`<b>En rouge</b> : plus de 1,5 fois la moyenne du jour. Le plus cher : ${sT.maxH} h (${_mN(sT.max, 0)} €)` + (sT.maxH >= 17 && sT.maxH <= 21 ? ', quand le soleil se couche et que la demande monte.' : '.'), `<b>Red</b>: above 1.5 times the day’s average. The most expensive: ${sT.maxH}:00 (${_mN(sT.max, 0)} €)` + (sT.maxH >= 17 && sT.maxH <= 21 ? ', when the sun sets and demand rises.' : '.'));
  }
  const ic = d => `<i><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg></i>`;
  const M = [
    [ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>'), _mT('<b>Pour un parc solaire</b> : les heures de midi sont souvent les moins chères ; le prix capté reste sous la moyenne. Un contrat qui arrête la production aux prix négatifs protège.', '<b>For a solar park</b>: midday hours are often the cheapest; the captured price stays below the average. A contract that stops output at negative prices protects.')],
    [ic('<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>'), _mT('<b>Pour un parc éolien</b> : les jours de vent fort, tout le parc produit en même temps et le prix baisse ; l’éolien capte un peu moins que la moyenne.', '<b>For a wind park</b>: on windy days the whole fleet produces at once and the price falls; wind captures a little less than the average.')],
    [ic('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'), _mT(`<b>Pour un achat d’électricité ${c ? c.y : ''}</b> : ` + (c7 > 1 ? 'le prix monte ; fixer une partie maintenant limite le risque d’une nouvelle hausse.' : c7 < -1 ? 'le prix baisse ; attendre peut payer, mais le risque reste ouvert.' : 'le prix est stable ; c’est le moment de décider sans pression.'), `<b>For a ${c ? c.y : ''} power purchase</b>: ` + (c7 > 1 ? 'the price is rising; fixing part of it now limits the risk of a further rise.' : c7 < -1 ? 'the price is falling; waiting may pay, but the risk stays open.' : 'the price is steady; a good time to decide without pressure.'))],
    [ic('<circle cx="12" cy="12" r="2"/><path d="M12 10V3a9 9 0 0 1 7.8 4.5L13.7 11M10.3 11 4.2 7.5A9 9 0 0 1 12 3M13.7 13l6.1 3.5A9 9 0 0 1 4.2 16.5L10.3 13"/>'), _mT('<b>Le nucléaire</b> fait l’essentiel de la production française : chaque réacteur qui revient fait baisser les prix de l’hiver.', '<b>Nuclear</b> makes most of France’s power: each reactor coming back lowers winter prices.')],
  ];
  const means = o.means; if (means) means.innerHTML = M.map(([i, t]) => `<div>${i}<span>${t}</span></div>`).join('');
  const G = [[_mT('Spot (day-ahead)', 'Spot (day-ahead)'), _mT('Prix fixé la veille, vers 13 h, pour chaque heure du lendemain.', 'Price set the day before, around 13:00, for each hour of the next day.')],
    [_mT('Cal (calendrier)', 'Cal (calendar)'), _mT('Prix d’un MWh livré toute une année, acheté aujourd’hui (Cal 27 = 2027).', 'Price of a MWh delivered over a whole year, bought today (Cal 27 = 2027).')],
    ['TTF', _mT('Prix du gaz européen, coté aux Pays-Bas, en €/MWh.', 'The European gas price, traded in the Netherlands, in €/MWh.')],
    ['EUA', _mT('Prix du droit d’émettre une tonne de CO₂ en Europe.', 'Price of the right to emit one tonne of CO₂ in Europe.')],
    [_mT('GO (garantie d’origine)', 'GO (guarantee of origin)'), _mT('Certificat qui prouve qu’un MWh vient d’une source renouvelable.', 'Certificate proving a MWh comes from a renewable source.')],
    [_mT('Taux de capture', 'Capture rate'), _mT('Ce qu’un parc touche réellement, rapporté au prix moyen de la période.', 'What a park actually earns, against the period’s average price.')]];
  const gl = o.gloss; if (gl) gl.innerHTML = G.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
}

async function renderMorning() {
  const upd = document.getElementById('mrn-date');
  if (upd) { const t = new Date().toLocaleDateString(_mrnFr() ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }); upd.textContent = _mT('Aujourd’hui · ', 'Today · ') + t; }
  const sub = (id, r) => { const e = document.getElementById(id); if (e && r && r.sub) e.textContent = r.sub; };
  _mrnFacts().then(k => {
    MRN.k = k;
    _mrnSpot(k); _mrnTiles(k); _mrnWeeks(k); _mrnNegAlert(k); _mrnCfCard(); _mrnFund(k);
    _mrnSpotChart(k, 'mrn-q-spot', false); _mrnQuick(k); _mrnLearn(k); _mrnStory(k); _mrnQuiz(k); _mrnExplain();
    const u = document.getElementById('mrn-upd'); if (u) u.textContent = _mT('mis à jour à ', 'updated ') + new Date().toLocaleTimeString(_mrnFr() ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  }).catch(e => console.warn('[morning]', e));
  if (window.PKBrief) { const b = document.getElementById('mrn-brief'); if (b) PKBrief.brief(b); }
  _mrnNews();
  // the folded sections draw when first opened
  const lazy = {
    'hs-morning-fc': () => { if (!window.PKF) return; PKW.draw('fc-48h', 'mrn-fc', { zone: 'FR' }).then(r => sub('mrn-fc-sub', r)); if (PKW.get('fc-neg')) PKW.draw('fc-neg', 'mrn-neg', {}).then(r => sub('mrn-neg-sub', r)); PKF.tiles(document.getElementById('mrn-fc-tiles'), 'FR'); if (PKW.get('fc-combined')) { PKW.draw('fc-combined', 'mrn-fcc', { tech: 'wind' }).then(r => sub('mrn-fcc-sub', r)); PKW.draw('fc-combined', 'mrn-fcs', { tech: 'solar' }).then(r => sub('mrn-fcs-sub', r)); } },
    'hs-morning-2': () => {
      PKW.draw('fr-spot-monthly', 'mrn-sptm', { zone: 'FR' }).then(r => sub('mrn-sptm-sub', r));
      // the CATE presentation's price charts not shown elsewhere on Today
      if (PKW.get('fr-spot-30d')) PKW.draw('fr-spot-30d', 'mrn-sp30', {}).then(r => sub('mrn-sp30-sub', r));
      if (PKW.get('fr-cal-drivers')) PKW.draw('fr-cal-drivers', 'mrn-drv', { win: '6M', country: 'FR' }).then(r => sub('mrn-drv-sub', r));
      // power and gas side by side with the same chart and the same table: calendar years, front month and front quarter, 3 months;
      // the tables without seasons unless asked (one box ticks both)
      const fp = { win: '3M', kinds: 'year,quarter,month', front: 1 };
      PKW.draw('fr-cal-history', 'mrn-fwdp', Object.assign({ country: 'FR' }, fp)).then(r => sub('mrn-fwdp-sub', r));
      if (PKW.get('ttf-cal-history')) PKW.draw('ttf-cal-history', 'mrn-ttfc', fp).then(r => sub('mrn-ttfc-sub', r));
      const tables = () => { const seasons = [...document.querySelectorAll('.mrn-fwd-seas')].some(x => x.checked) ? 'yes' : 'no';
        const ft = document.getElementById('mrn-fwdt'); if (ft && PKW.get('power-fwd-table')) PKW.get('power-fwd-table').html(ft, { country: 'FR', seasons });
        const tt = document.getElementById('mrn-ttft'); if (tt && PKW.get('ttf-fwd-table')) PKW.get('ttf-fwd-table').html(tt, { seasons }); };
      document.querySelectorAll('.mrn-fwd-seas').forEach(b => { if (b.dataset.w) return; b.dataset.w = '1'; b.addEventListener('change', () => { document.querySelectorAll('.mrn-fwd-seas').forEach(x => { x.checked = b.checked; }); tables(); }); });
      tables();
    },
    'hs-morning-fund': () => {   // the CATE presentation's supply and demand charts
      [['gas-storage-years', 'mrn-gsy', {}], ['nuc-monthly-years', 'mrn-nucy', {}], ['hydro-reservoirs', 'mrn-hyd', { country: 'FR' }],
        ['wx-outlook', 'mrn-wxt', { series: 'temp' }], ['fr-load-normal', 'mrn-fload', {}], ['remit-unavail', 'mrn-fremit', { period: '6M' }], ['fuel-coal-oil', 'mrn-coal', {}], ['wx-outlook', 'mrn-wxw', { series: 'wind' }], ['wx-outlook', 'mrn-wxs', { series: 'solar' }], ['wx-outlook', 'mrn-wxp', { series: 'precip' }]]
        .forEach(([w, c, p]) => { if (PKW.get(w)) PKW.draw(w, c, p).then(r => sub(c + '-sub', r)).catch(() => {}); });
    },
    'hs-morning-3': () => {
      // the rolling capture rate of Renewables › Cannibalisation: solar above, wind below
      if (PKW.get('cannib-rolling')) { PKW.draw('cannib-rolling', 'mrn-cr', { tech: 'solar' }).then(r => sub('mrn-cr-sub', r)); PKW.draw('cannib-rolling', 'mrn-crw', { tech: 'wind' }).then(r => sub('mrn-crw-sub', r)); }
      _mrnRenTiles();
      _mrnCreg();
      PKW.draw('go-vintages', 'mrn-go', { product: 'GO AIB Renewable' }).then(r => sub('mrn-go-sub', r));
      _mrnGoTable(document.getElementById('mrn-got'));
    },
    'hs-morning-4': () => { _mrnTiles2(); PKW.draw('fr-sys-prod', 'mrn-prod', { day: 'latest' }); if (PKW.get('fr-sys-monthly')) PKW.draw('fr-sys-monthly', 'mrn-sysm', { view: 'twh', win: '3Y' }); PKW.draw('remit-unavail', 'mrn-remit', { period: '3M' }); if (PKW.get('fr-load-normal')) PKW.draw('fr-load-normal', 'mrn-loadn', {}); },
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
  idx: k => { const I = k.idx; if (!I) return { name: '', series: [] };
    return { name: _mT('Indice PowerKlock · couverture bas carbone', 'PowerKlock index · low-carbon coverage'), unit: '%', dp: 0, look: null, pct: false, route: 'tools/compare', page: _mT('Outils › Comparateur', 'Tools › Comparator'),
      series: [['idx', _mT('Couverture bas carbone, %', 'Low-carbon coverage, %'), '#14D3A9', 'y', true, I.rows.map(x => [x.d, Math.round(x.cov * 10) / 10])],
        ['fair', _mT('Prix implicite, €/MWh (axe droit)', 'Implied price, €/MWh (right axis)'), '#FBBF24', 'y2', true, I.rows.map(x => [x.d, Math.round(x.fair * 10) / 10])],
        ...(I.ahead ? [['fairfc', _mT('Spot attendu, prévision, €/MWh (axe droit)', 'Expected spot, forecast, €/MWh (right axis)'), '#F59E0B', 'y2', true, I.ahead.days.map(x => [x.d, Math.round(x.fair * 10) / 10])],
          ['covfc', _mT('Couverture prévue, %', 'Forecast coverage, %'), '#7FC8F8', 'y', true, I.ahead.days.map(x => [x.d, Math.round(x.cov * 10) / 10])]] : []),
        ['spot', _mT('Spot France, €/MWh (axe droit)', 'France spot, €/MWh (right axis)'), '#E6EDF3', 'y2', true, I.rows.filter(x => x.p != null).map(x => [x.d, x.p])]], unit2: '€/MWh' }; },
  // the 4-week table's rows: forecast (ensemble mean) against the 2016–2025 normal, from data/weather_outlook.json
  wtemp: () => _mrnWxWin('temp', _mT('Température France', 'France temperature'), '°C', 1, '#FBBF24'),
  wwind: () => _mrnWxWin('wind', _mT('Production éolienne prévue', 'Expected wind output'), 'GWh/j', 0, '#14D3A9'),
  wsun: () => _mrnWxWin('solar', _mT('Production solaire prévue', 'Expected solar output'), 'GWh/j', 0, '#FBBF24'),
  // renewables tiles (data in MRN.ren, read by _mrnRenTiles)
  ppas: () => _mrnPpaWin('solar'), ppaw: () => _mrnPpaWin('wind'), m0s: () => _mrnM0Win('solar'), m0w: () => _mrnM0Win('wind'),
  ao: () => { const rows = (MRN.ren && MRN.ren.ao) || [], ser = t => rows.filter(r => r.tech === t && r.price != null && r.result).sort((a, b) => a.result.localeCompare(b.result)).map(r => [r.result, r.price]);
    return { name: _mT('Appels d’offres CRE · prix retenus', 'CRE tenders · prices kept'), unit: '€/MWh', dp: 2, look: null, noMoves: true, why: _mT('Prix moyen pondéré retenu à chaque période d’appel d’offres CRE (complément de rémunération sur 20 ans), par filière. Un point = une période.', 'Weighted average price kept at each CRE tender period (20-year contract for difference), by technology. One point = one period.'), route: 'renewables/m0', page: _mT('Renouvelables › Contrat M0', 'Renewables › M0 contract'), range: 'ALL',
      series: [['aosol', _mT('Solaire sol', 'Ground PV'), '#FBBF24', 'y', true, ser('Photovoltaïque sol')], ['aobat', _mT('Solaire toiture', 'Rooftop PV'), '#F97316', 'y', true, ser('Photovoltaïque bâtiment')], ['aowind', _mT('Éolien terrestre', 'Onshore wind'), '#14D3A9', 'y', true, ser('Éolien terrestre')], ['aoneu', _mT('Techno neutre', 'Tech-neutral'), '#E6EDF3', 'y', true, ser('Neutre')]] }; },
  // power-system tiles: daily averages since 2015 (RTE éCO2mix, data/history/rte/fr_daily.json)
  sco2: k => _mrnSysWin(k, _mT('CO₂ de la production française', 'CO₂ of French generation'), 'g/kWh', 0, [['co2', _mT('Intensité CO₂, moyenne du jour', 'CO₂ intensity, daily average'), '#94A3B8', r => r.co2Avg]], 'system/carbon', _mT('Système › Intensité carbone', 'System › Carbon intensity')),
  sload: k => _mrnSysWin(k, _mT('Consommation France', 'France consumption'), 'GW', 1, [['load', _mT('Consommation, moyenne du jour', 'Consumption, daily average'), '#E6EDF3', r => r.loadAvg / 1000]], 'system/demand', _mT('Système › Consommation', 'System › Demand')),
  snuc: k => _mrnSysWin(k, _mT('Production nucléaire', 'Nuclear output'), 'GW', 1, [['nuc', _mT('Nucléaire, moyenne du jour', 'Nuclear, daily average'), '#A98BD4', r => r.nuclearAvg / 1000]], 'system/generation/nuclear', _mT('Système › Nucléaire', 'System › Nuclear')),
  sren: k => _mrnSysWin(k, _mT('Éolien et solaire', 'Wind and solar'), 'GW', 1, [['wind', _mT('Éolien', 'Wind'), '#14D3A9', r => r.windAvg / 1000], ['solar', _mT('Solaire', 'Solar'), '#FBBF24', r => r.solarAvg / 1000]], 'system/generation', _mT('Système › Production', 'System › Generation')),
  sexch: k => _mrnSysWin(k, _mT('Solde des échanges', 'Exchange balance'), 'GW', 1, [['exch', _mT('Exports nets (+) / imports nets (−)', 'Net exports (+) / imports (−)'), '#7FC8F8', r => -r.exchAvg / 1000]], 'system/demand/flows', _mT('Système › Échanges', 'System › Flows')),
  nuc: k => ({ name: _mT('Nucléaire disponible', 'Nuclear available'), unit: 'GW', dp: 1, look: null, inv: true, route: 'system/generation/nuclear', page: _mT('Système › Production › Nucléaire', 'System › Generation › Nuclear'),
    series: [['nuc', _mT('Disponible', 'Available'), '#A98BD4', 'y', true, k.P('fr_nuc_avail').map(p => [p[0], p[1] / 1000])], ['nucfc', _mT('Prévision de l’exploitant', 'Operator forecast'), '#B8C9D9', 'y', true, k.P('fr_nuc_avail_fc').map(p => [p[0], p[1] / 1000])]] }),
};
const MRN_ORDER = ['cal', 'ttf', 'eua', 'brent', 'go', 'idx'];
const MRN_REN_ORDER = ['ppas', 'ppaw', 'm0s', 'm0w', 'ao'];
const MRN_SYS_ORDER = ['sco2', 'sload', 'snuc', 'sren', 'sexch'];
const MRN_WX_ORDER = ['wtemp', 'wwind', 'wsun', 'idx'];
function _mrnWxWin(key, name, unit, dp, col) {
  const S = MRN.wx && MRN.wx[key], d = S ? S.days : [], z = arr => d.map((x, i) => [x, arr && arr[i] != null ? Math.round(arr[i] * 10) / 10 : null]).filter(p => p[1] != null);
  return { name, unit, dp, look: null, pct: false, neutral: true, noMoves: true, route: 'system/weather', page: _mT('Système › Météo', 'System › Weather'), range: 'ALL', mainId: 'fc',
    why: _mT('Prévision moyenne de l’ensemble GFS (31 membres) face à la normale 2016–2025 ; la bande P10–P90 se coche dans la légende. Production : météo convertie au parc actuel, calée sur RTE.', 'GFS ensemble mean (31 members) against the 2016–2025 normal; tick P10–P90 in the legend. Output: weather converted at today’s fleet, fitted on RTE.'),
    series: [['fc', _mT('Prévision', 'Forecast'), col, 'y', true, z(S && S.mean)], ['nm', _mT('Normale 2016–2025', 'Normal 2016–2025'), '#B8C9D9', 'y', true, z(S && S.normal)], ['act', _mT('Observé', 'Observed'), '#E6EDF3', 'y', true, z(S && S.actual)],
      ['p10', 'P10', '#7A93AB', 'y', false, z(S && S.p10)], ['p90', 'P90', '#7A93AB', 'y', false, z(S && S.p90)]] };
}
function _mrnSysWin(k, name, unit, dp, defs, route, page) {
  const rows = ((k.rted && k.rted.rows) || []).filter((r, i, a) => r.loadAvg && (i === a.length - 1 || a[i + 1].d !== r.d));
  return { name, unit, dp, look: null, pct: false, neutral: true, route, page, range: '1Y',
    series: defs.map(([id, lab, col, f]) => [id, lab, col, 'y', true, rows.map(r => { const v = f(r); return [r.d, v == null || isNaN(v) ? null : Math.round(v * 100) / 100]; }).filter(p => p[1] != null)]) };
}
function _mrnPpaWin(t) {
  const bm = MRN.ren && MRN.ren.bm, ds = bm && bm.days ? Object.keys(bm.days).sort() : [], g = k => ds.map(d => [d, bm.days[d][t] && bm.days[d][t][k]]).filter(p => p[1] != null);
  return { name: t === 'solar' ? _mT('PPA solaire · benchmark PowerKlock', 'Solar PPA · PowerKlock benchmark') : _mT('PPA éolien · benchmark PowerKlock', 'Wind PPA · PowerKlock benchmark'), unit: '€/MWh', dp: 2, look: null, route: 'tools/ppa', page: _mT('Outils › Pricer PPA', 'Tools › PPA pricer'),
    series: [['ppa', 'PPA', t === 'solar' ? '#FBBF24' : '#14D3A9', 'y', true, g('ppa')], ['ref', _mT('Forward base', 'Forward baseload'), '#B8C9D9', 'y', true, g('ref')], ['lo', 'P10', '#7A93AB', 'y', false, g('lo')], ['hi', 'P90', '#7A93AB', 'y', false, g('hi')]] };
}
function _mrnM0Win(t) {
  const ms = ((MRN.ren && MRN.ren.m0 && MRN.ren.m0.months) || []).filter(m => m.complete !== false), k = t === 'solar' ? 'solarM0' : 'windM0';
  return { name: t === 'solar' ? _mT('M0 solaire', 'Solar M0') : _mT('M0 éolien', 'Wind M0'), unit: '€/MWh', dp: 2, look: null, route: 'renewables/m0', page: _mT('Renouvelables › Contrat M0', 'Renewables › M0 contract'), range: '3Y',
    series: [['m0', 'M0', t === 'solar' ? '#FBBF24' : '#14D3A9', 'y', true, ms.map(m => [m.month + '-15', m[k]])], ['base', _mT('Prix base du mois', 'Month baseload'), '#B8C9D9', 'y', true, ms.map(m => [m.month + '-15', m.base])]] };
}
// the window itself is shared with the market pages' tiles (js/pk-tilewin.js)
function _mrnTileDef(id) {
  const k = MRN.k; if (!k || !MRN_WIN[id] || !window.PKTile) return null;
  const W = MRN_WIN[id](k), look = W.look && k.look && k.look[W.look];
  const chip = look && look.tone ? `<span class="wk-chip ${look.tone === 'up' ? 'wk-up' : look.tone === 'down' ? 'wk-dn' : 'wk-fl'}" title="${_mT('Semaine à venir · notes de marché', 'Week ahead · market notes')}">${look.tone === 'up' ? '↑ ' + _mT('haussier', 'bullish') : look.tone === 'down' ? '↓ ' + _mT('baissier', 'bearish') : '→ ' + _mT('neutre', 'neutral')}</span>` : '';
  let more = '';
  if (id === 'ttf') { const st = _mrnLast(k.P('agsi')), ly = st && _mrnBack(k.P('agsi'), 365); if (st && ly != null) more = _mT(`Stocks de gaz UE ${_mN(st[1], 1)} % contre ${_mN(ly, 1)} % il y a un an.`, `EU gas storage ${_mN(st[1], 1)} % against ${_mN(ly, 1)} % a year ago.`); }
  if (id === 'nuc') { const fc = _mrnLast(k.P('fr_nuc_avail_fc')); if (fc) more = _mT(`Prévision de l’exploitant : ${_mN(fc[1] / 1000, 1)} GW. Moins de nucléaire, c’est plus de gaz appelé et des prix en hausse.`, `Operator forecast: ${_mN(fc[1] / 1000, 1)} GW. Less nuclear means more gas called and firmer prices.`); }
  if (id === 'idx' && k.idx) more = (k.idx.ahead && k.idx.ahead.month ? _mT(`Prévision : ${_mN(k.idx.ahead.fair4, 0)} €/MWh en moyenne sur 4 semaines, ${_mN(k.idx.ahead.month.fair, 0)} € sur ${k.idx.ahead.month.n} jours de ${k.idx.ahead.month.m} contre un forward à ${_mN(k.idx.ahead.month.fwd, 0)} € (météo de l’ensemble GFS, nucléaire au niveau du dernier jour, gaz et CO₂ du jour). `, `Forecast: ${_mN(k.idx.ahead.fair4, 0)} €/MWh on average over 4 weeks, ${_mN(k.idx.ahead.month.fair, 0)} € over ${k.idx.ahead.month.n} days of ${k.idx.ahead.month.m} against a forward at ${_mN(k.idx.ahead.month.fwd, 0)} € (GFS ensemble weather, nuclear at the last day's level, today's gas and CO₂). `) : '') + _mT(`Au-dessus de 100 %, la France couvre sa consommation sans gaz et exporte : les prix décrochent. En dessous, les centrales au gaz fixent le prix. La courbe explique ${_mN(k.idx.r2 * 100, 0)} % des variations du spot sur 3 ans (écart moyen ± ${_mN(k.idx.mae, 0)} €) : un spot au-dessus du prix implicite = marché plus tendu que ne le disent la production et la consommation (imports, prix voisins, prévisions).`,
    `Above 100 %, France covers its demand without gas and exports: prices drop. Below, gas plants set the price. The curve explains ${_mN(k.idx.r2 * 100, 0)} % of the spot's moves over 3 years (mean gap ± ${_mN(k.idx.mae, 0)} €): a spot above the implied price = a market tighter than production and demand say (imports, neighbours' prices, forecasts).`);
  if (id === 'cal') more = _mT('Coche « Gaz TTF » pour voir le gaz sur la même période.', 'Tick “TTF gas” to see gas over the same period.');
  if (id === 'go') more = _mT('Prix moyen courtier, une cotation par semaine.', 'Broker mid, one quote a week.');
  const y = +_mrnToday().slice(0, 4);
  return { name: W.name, unit: W.unit, unit2: W.unit2, pct: W.pct, neutral: W.neutral, dp: W.dp, inv: W.inv, range: W.range, noMoves: W.noMoves, why: W.why, chip, route: W.route, page: W.page, series: W.series, whyMore: more, file: 'today-' + id, mainId: W.mainId || (id === 'go' ? 'go' + (y + 1) : null) };
}
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('mrn-wrow')) e.target.click(); });
document.addEventListener('pk-view', e => {
  if (!e.detail || e.detail.key !== 'morning' || e.detail.index !== 2) return;
  ['hs-morning-2', 'hs-morning-3', 'hs-morning-4'].forEach(id => { const s = document.getElementById(id); if (s && !s.dataset.opened) { s.dataset.opened = '1'; s.classList.remove('collapsed'); } });
});
document.addEventListener('click', e => {   // a tile opens its chart full size (a modified click still opens the page in a new tab)
  const a = e.target.closest && e.target.closest('.mrn2-tile[data-tile], .mrn-wrow');
  if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  // capture phase, before the menu's handler that opens any [data-route] link as a page
  const ORD = MRN_REN_ORDER.includes(a.dataset.tile) ? MRN_REN_ORDER : MRN_SYS_ORDER.includes(a.dataset.tile) ? MRN_SYS_ORDER : a.closest('.mrn-wtab') ? MRN_WX_ORDER : MRN_ORDER, box = a.closest('.mrn-wtab') || document, ids = ORD.filter(i => box.querySelector('[data-tile="' + i + '"]')), idx = ids.indexOf(a.dataset.tile);
  if (idx >= 0 && window.PKTile && PKTile.open(_mrnTileDef(a.dataset.tile), { push: true, list: ids.map(i => () => _mrnTileDef(i)), idx, opener: a })) { e.preventDefault(); e.stopPropagation(); }
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
  .mrn2-tiles-sm{grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:14px}
  @media (max-width:1100px){.mrn2-tiles-sm{grid-template-columns:repeat(3,minmax(0,1fr))}}
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
  .mrn2-wk-sp{display:block;width:100%;height:22px;margin-top:4px}
  .mrn2-wk .mrn2-bar{display:block;position:relative;height:6px;border-radius:3px;background:var(--border)} .mrn2-wk .mrn2-fill{display:block;height:6px;border-radius:3px} .mrn2-wk .mrn2-mark{position:absolute;top:-3px;width:2px;height:12px;background:var(--text2)}
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
  .mrn3-tx{display:flex;justify-content:space-between;gap:6px;font-size:11px;color:var(--text3);margin-top:4px;white-space:nowrap} .mrn3-tx>span:first-child{overflow:hidden;text-overflow:ellipsis} .mrn3-tx b{color:var(--text2);font-weight:600;font-variant-numeric:tabular-nums}
  .mrn3-dim{color:var(--text3)}
  .mrn3-th{display:flex;justify-content:space-between;align-items:center;gap:6px;min-width:0} .mrn3-th .wk-chip{font-size:10px;flex:none} .mrn3-th .mrn2-tn{flex:1 1 auto;min-width:0}
  .mrn3-pair{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:stretch}   /* what moved, full width (its tiles in one row), then the news, full width */
  .mrn-news-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 24px}
  @media (max-width:1100px){.mrn-news-cols{grid-template-columns:1fr}}
  .mrn3-tbl{height:320px;overflow:auto}
  .mrn3-sel{display:flex;gap:6px;margin-left:auto;margin-right:8px} .mrn3-sel select{background:var(--bg3);color:var(--text);border:1px solid var(--border2);border-radius:6px;padding:3px 6px;font-size:12px}
  .mrn3-pair>section{margin:0;min-width:0}
  @media (max-width:1100px){.mrn3-pair{grid-template-columns:1fr}}
  .mrn3-row{margin-bottom:12px}
  .mrn3-row:last-child{margin-bottom:0}
  .mrn3-hdr{margin:0 0 14px}
  .mrn3-qrow{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px} .mrn3-qrow>section{margin:0;min-width:0}
  @media (max-width:1000px){.mrn3-qrow{grid-template-columns:1fr}}
  .mrn3-lines{margin:0;padding:0;list-style:none} .mrn3-lines li{display:grid;grid-template-columns:96px minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13.5px;color:var(--text2)}
  .mrn3-lines li:last-child{border-bottom:0} .mrn3-lines li>b:first-child{font:600 11px 'JetBrains Mono',monospace;text-transform:uppercase;color:var(--text)} .mrn3-lines b{color:var(--text);font-weight:600}
  .mrn3-sent{font-size:16px;line-height:1.6;color:var(--text2);margin:0} .mrn3-sent b{color:var(--text)} .mrn3-sent b.mrn-up{color:var(--down)} .mrn3-sent b.mrn-dn{color:var(--up)}
  .mrn3-ltiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px} @media (max-width:900px){.mrn3-ltiles{grid-template-columns:1fr}}
  .mrn3-lt{display:flex;flex-direction:column;gap:6px} .mrn3-lt p{margin:0 4px;font-size:13px;color:var(--text2);line-height:1.5}
  .mrn3-learn{display:flex;flex-direction:column;gap:12px;font-size:13.5px;color:var(--text2);line-height:1.5} .mrn3-learn>div{display:grid;grid-template-columns:24px minmax(0,1fr);gap:10px} .mrn3-learn i{color:var(--accent);display:flex} .mrn3-learn b{color:var(--text)}
  .mrn3-gloss{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 18px;margin:0;font-size:13px} .mrn3-gloss dt{color:var(--text);font-weight:600} .mrn3-gloss dd{margin:2px 0 0;color:var(--text2)}
  @media (max-width:900px){.mrn3-gloss{grid-template-columns:1fr}}
  .mrn-sec{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);font-weight:600;margin:18px 0 8px}
  `;
  document.head.appendChild(css);
})();
