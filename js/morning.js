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
const _mrnSummary = () => _mrnGet('sum', DATA_BASE + 'history/summary.json');
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
        fr(b) ? _fuelLineDs(_mrnDay(prev), fr(b), 'rgba(226,232,240,.75)', { borderWidth: 1.3, borderDash: [4, 3] }) : null,
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
        { type: 'bar', label: 'FR − DE', data: rows.map(r => r2(r.avg - deBy.get(r.d))), backgroundColor: rows.map(r => r.avg - deBy.get(r.d) >= 0 ? 'rgba(249,115,22,.55)' : 'rgba(96,165,250,.55)'), borderWidth: 0, yAxisID: 'y2', order: 3 },
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
      const cols = ['#14D3A9', '#FBBF24', '#A78BFA'];
      _fuelChart(cid, { type: 'line', data: { labels: dates, datasets: ser.map((x, i) => {
        const m = new Map(x.s.map(r => [r.t, r.mid]));
        return _fuelLineDs('Cal ' + x.y, dates.map(t => m.has(t) ? Math.round(m.get(t) * 1000) / 1000 : null), cols[i], { borderWidth: i ? 1.5 : 2.2, spanGaps: true });
      }) }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh') },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } } }) }, 'go-vintages');
      return { sub: p.product.replace('GO AIB ', 'AIB ') + ' · weekly mid · last 2 years' };
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
  const tile = (lbl, val, unit, sub, tone, title) => `<div class="mrn-k"${title ? ` title="${title}"` : ''}><div class="mrn-k-l">${lbl}</div><div class="mrn-k-v">${val}<small>${unit || ''}</small></div><div class="mrn-k-s ${tone || ''}">${sub || ''}</div></div>`;
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
  [['Y+1', 'Cal+1 FR'], ['M+1', 'M+1 FR'], ['Q+1', 'Q+1 FR']].forEach(([t, l]) => {
    const r = row(t); if (!r) return;
    out[t] = r;
    const d1 = r.varD1Pct != null ? r.value - r.value / (1 + r.varD1Pct / 100) : null, w1 = r.varW1Pct != null ? r.value - r.value / (1 + r.varW1Pct / 100) : null;
    tiles.push(tile(l + ' · ' + (r.contract || '').replace(/^FR\s+/, '').replace(/\s+base$/, ''), r.value.toFixed(2), ' €/MWh', sg(d1, 2) + ' d/d · ' + sg(w1, 2) + ' w/w', toneP(d1), 'Settlement ' + r.date));
  });

  // Fuels and carbon
  if (window.PKC) {
    try {
      await PKC.ready;
      [['ttf', 'TTF day-ahead', ' €/MWh'], ['eua', 'EUA ' + (PKC.contractLabel ? PKC.contractLabel('eua') : ''), ' €/t']].forEach(([k, l, u]) => {
        const last = PKC.last(k);
        if (!last) return;
        out[k] = { v: last.v, d: last.chg };
        tiles.push(tile(l, last.v.toFixed(2), u, sg(out[k].d, 2) + ' d/d', toneP(out[k].d)));
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
      tiles.push(tile('GO renewable Cal ' + yr, l.mid.toFixed(3), ' €/MWh', sg(out['go' + yr].d, 3) + ' w/w · ' + _mrnDay(l.t), toneP(out['go' + yr].d), 'AIB renewable, broker mid'));
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
    if (fr && de) L.push(`<b>FR − DE</b> on ${_mrnDay(fr.d)}: ${sg(fr.avg - de.avg)} €/MWh (FR ${fr.avg.toFixed(1)}, DE ${de.avg.toFixed(1)}); 30-day FR average ${fr.roll30 != null ? fr.roll30.toFixed(1) : '–'} €/MWh.`);
  }
  const y1 = k['Y+1'];
  if (y1 && y1.varD1Pct != null) L.push(`<b>Cal+1 FR</b> ${y1.value.toFixed(2)} €/MWh, ${sg(y1.varD1Pct, 2)}% on the day and ${sg(y1.varW1Pct || 0, 2)}% on the week (settlement ${y1.date}).`);
  if (k.ttf && k.eua) L.push(`<b>Fuels</b>: TTF ${k.ttf.v.toFixed(2)} €/MWh (${sg(k.ttf.d || 0, 2)}), EUA ${k.eua.v.toFixed(2)} €/t (${sg(k.eua.d || 0, 2)})` +
    (window.PKC && k.spot && k.spot.base != null ? `; clean spark on that day's base ${sg(PKC.cleanSpark(k.spot.base, k.ttf.v, k.eua.v))} €/MWh.` : '.'));
  const y = +_mrnToday().slice(0, 4);
  if (k['go' + (y + 1)]) { const g = k['go' + (y + 1)]; L.push(`<b>GO</b> renewable Cal ${y + 1} at ${g.v.toFixed(3)} €/MWh (${sg(g.d || 0, 3)} w/w)` + (k.auction ? `; last French state auction (${k.auction.month}) cleared ${k.auction.price.toFixed(3)} €/MWh on ${(k.auction.vol / 1e6).toFixed(2)} TWh.` : '.')); }
  if (k.nuc && k.nuc.avail) L.push(`<b>Nuclear</b>: ${k.nuc.now != null ? (k.nuc.now / 1000).toFixed(1) + ' GW produced now, ' : ''}${(k.nuc.avail / 1000).toFixed(1)} GW available.`);
  if (k.co2 && k.co2.now != null) L.push(`<b>CO₂</b>: ${Math.round(k.co2.now)} g/kWh now, ${k.co2.y != null ? Math.round(k.co2.y) : '–'} g/kWh yesterday on average (RTE).`);
  host.innerHTML = L.length ? '<ul>' + L.map(x => '<li>' + x + '</li>').join('') + '</ul>' : '<div class="fuel-note">Waiting for data…</div>';
}

async function renderMorning() {
  const upd = document.getElementById('mrn-date');
  if (upd) upd.textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const sub = (id, r) => { const e = document.getElementById(id); if (e && r && r.sub) e.textContent = r.sub; };
  _mrnKpis().then(_mrnMoves);
  PKW.draw('fr-spot-next', 'mrn-spot', {}).then(r => sub('mrn-spot-sub', r));
  PKW.draw('pf-curve', 'mrn-fwd', { country: 'FR' });
  PKW.draw('pf-history', 'mrn-cal', { country: 'FR', tenor: 'Y+1', win: '1Y' });
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
  .mrn-k{background:var(--bg2);border:1px solid var(--bd);border-radius:9px;padding:10px 12px;min-width:0}
  .mrn-k-l{font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--tx3);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mrn-k-v{font-family:'IBM Plex Mono',monospace;font-size:20px;color:var(--tx);margin-top:4px;white-space:nowrap}
  .mrn-k-v small{font-size:10px;color:var(--tx3)}
  .mrn-k-s{font-size:10px;color:var(--tx3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mrn-k-s.up{color:var(--down,#ED6965)} .mrn-k-s.down{color:var(--up,#14D3A9)}
  .mrn-moves{background:var(--bg2);border:1px solid var(--bd);border-left:3px solid #14D3A9;border-radius:9px;padding:12px 16px;margin-bottom:14px}
  .mrn-moves h3{margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--tx2)}
  .mrn-moves ul{margin:0;padding-left:18px} .mrn-moves li{font-size:12.5px;color:var(--tx2);line-height:1.6} .mrn-moves b{color:var(--tx)}
  .mrn-neg{color:#60A5FA}
  .mrn-sec{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3);font-weight:600;margin:18px 0 8px}
  `;
  document.head.appendChild(css);
})();
