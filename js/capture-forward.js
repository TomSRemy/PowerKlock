// ════════════════════════════════════════════════════════════════════
// FORWARD CAPTURE PRICES — France
// Expected value of solar and wind output for each forward product:
//   capture ≈ forward baseload × capture rate of the months it covers,
// the monthly capture rates (output-weighted price ÷ baseload) taken from
// the last three complete years of RTE output and day-ahead prices
// (history/rte/fr_daily.json), weighted by each month's typical output.
// Range = lowest and highest of the three years. An indicator for PPA and
// origination talks, not a price: it assumes past cannibalisation repeats.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  let dataP = null;
  const get = path => fetch(DATA_BASE + path).then(r => r.ok ? r.json() : null).catch(() => null);

  // Months (0–11) covered by a contract name ("FR Nov26 base", "FR Q1 27 base", "FR Sum2027 base", "FR Win2027 base", "FR Cal2027 base")
  function months(name) {
    const n = (name || '').replace(/^[A-Z]{2}\s+/, '').replace(/\s+base$/i, '');
    let m;
    if ((m = n.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s?(\d{2})$/))) return { label: m[1] + ' ' + m[2], kind: 'Month', m: [MON[m[1]]] };
    if ((m = n.match(/^Q([1-4])\s?(\d{2})$/))) { const q = +m[1]; return { label: 'Q' + q + ' ' + m[2], kind: 'Quarter', m: [0, 1, 2].map(i => (q - 1) * 3 + i) }; }
    if ((m = n.match(/^Sum\s?(\d{4})$/))) return { label: 'Summer ' + m[1], kind: 'Season', m: [3, 4, 5, 6, 7, 8] };
    if ((m = n.match(/^Win\s?(\d{4})$/))) return { label: 'Winter ' + m[1] + '-' + String(+m[1] + 1).slice(2), kind: 'Season', m: [9, 10, 11, 0, 1, 2] };
    if ((m = n.match(/^Cal\s?(\d{4})$/))) return { label: 'Cal ' + m[1], kind: 'Year', m: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
    return null;
  }

  // Monthly capture rates and output per year from the RTE daily stats
  function monthly(rows) {
    const acc = {};
    rows.forEach(r => {
      if (r.base == null) return;
      const y = +r.d.slice(0, 4), m = +r.d.slice(5, 7) - 1, k = y + '-' + m;
      const a = acc[k] || (acc[k] = { y, m, base: 0, n: 0, sw: 0, sp: 0, ww: 0, wp: 0 });
      a.base += r.base; a.n++;
      if (r.solarAvg != null && r.sCap != null) { a.sw += r.solarAvg; a.sp += r.solarAvg * r.sCap; }
      if (r.windAvg != null && r.wCap != null) { a.ww += r.windAvg; a.wp += r.windAvg * r.wCap; }
    });
    const out = {};
    Object.values(acc).forEach(a => {
      if (a.n < 20) return;   // incomplete month
      const b = a.base / a.n;
      out[a.y] = out[a.y] || {};
      out[a.y][a.m] = { base: b, sCR: a.sw && b > 5 ? a.sp / a.sw / b : null, wCR: a.ww && b > 5 ? a.wp / a.ww / b : null, sOut: a.sw / a.n, wOut: a.ww / a.n };
    });
    return out;
  }

  async function compute() {
    if (!dataP) dataP = Promise.all([get('history/rte/fr_daily.json'), get('fr_market.json')]).then(([d, f]) => {
      if (!d || !d.rows || !f || !f.forwardCurve) return null;
      const mon = monthly(d.rows);
      const thisYear = +new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()).slice(0, 4);
      const years = Object.keys(mon).map(Number).filter(y => y < thisYear && Object.keys(mon[y]).length === 12).sort().slice(-3);
      const rate = (ms, key, outKey, ys) => {
        // output-weighted capture rate over the months, for one year or the average of years
        let num = 0, den = 0;
        ys.forEach(y => ms.forEach(m => { const c = mon[y] && mon[y][m]; if (c && c[key] != null) { num += c[key] * c[outKey]; den += c[outKey]; } }));
        return den ? num / den : null;
      };
      const rows = f.forwardCurve.map(r => {
        const per = months(r.contract); if (!per || r.value == null) return null;
        const one = key => years.map(y => rate(per.m, key, key === 'sCR' ? 'sOut' : 'wOut', [y])).filter(v => v != null);
        const s = rate(per.m, 'sCR', 'sOut', years), w = rate(per.m, 'wCR', 'wOut', years);
        const sy = one('sCR'), wy = one('wCR');
        return { tenor: r.tenor, label: per.label, kind: per.kind, base: r.value, date: r.date,
          sCR: s, sLo: sy.length ? Math.min(...sy) : null, sHi: sy.length ? Math.max(...sy) : null,
          wCR: w, wLo: wy.length ? Math.min(...wy) : null, wHi: wy.length ? Math.max(...wy) : null };
      }).filter(Boolean);
      return { rows, years };
    });
    return dataP;
  }
  const f1 = v => v == null ? '–' : v.toFixed(1), pc = v => v == null ? '–' : Math.round(v * 100) + '%';

  if (!window.PKW) return;
  PKW.register({
    id: 'fr-capture-forward', title: 'France forward capture prices (solar, wind)', category: 'renewables', page: 'renewables', pageCanvas: 'ren-capfwd',
    source: 'Market data · RTE', size: { w: 12, h: 5 },
    desc: 'Forward baseload of each French product with the solar and wind capture prices it implies at the capture rates of the last three years.',
    async draw(cid) {
      const r = await compute();
      if (!r || !r.rows.length) { noDataMsg(cid, 'Forward or capture history not available', ''); return null; }
      const L = r.rows.map(x => x.label);
      const val = (x, k) => x[k] == null ? null : Math.round(x.base * x[k] * 10) / 10;
      _fuelChart(cid, { type: 'bar', data: { labels: L, datasets: [
        { label: 'Forward baseload', data: r.rows.map(x => x.base), backgroundColor: 'rgba(184,201,217,.30)', borderColor: '#B8C9D9', borderWidth: 1, borderRadius: 3, order: 3 },
        { label: 'Wind capture (avg ' + r.years.join('–') + ')', data: r.rows.map(x => val(x, 'wCR')), backgroundColor: 'rgba(20,211,169,.75)', borderRadius: 3, order: 2 },
        { label: 'Solar capture (avg ' + r.years.join('–') + ')', data: r.rows.map(x => val(x, 'sCR')), backgroundColor: 'rgba(251,191,36,.80)', borderRadius: 3, order: 2 },
      ] }, options: _fuelOpts({ scales: { x: _fuelXAxis(), y: _fuelAxis('€/MWh', { beginAtZero: true }) },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !/^_/.test(it.text) } } } }) }, 'fr-forward-capture');
      return { sub: 'Settlement ' + r.rows[0].date + ' · capture rates ' + r.years.join(', ') + ' (RTE output × day-ahead)' };
    },
  });
  PKW.register({
    id: 'fr-capture-forward-table', kind: 'html', title: 'France forward capture prices · table', category: 'renewables', page: 'renewables',
    source: 'Market data · RTE', size: { w: 12, h: 6 },
    desc: 'Per forward product: baseload, solar and wind capture rate (three-year average and range) and the implied capture prices.',
    async html(host) {
      const r = await compute();
      if (!r || !r.rows.length) { host.innerHTML = '<div class="fuel-note">Forward or capture history not available.</div>'; return; }
      host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table"><thead><tr><th style="text-align:left">Product</th><th>Forward base</th>
        <th>Solar rate</th><th>Solar range</th><th>Solar capture</th><th>Wind rate</th><th>Wind range</th><th>Wind capture</th></tr></thead><tbody>` +
        r.rows.map(x => `<tr><td>${x.label}</td><td>${f1(x.base)}</td><td>${pc(x.sCR)}</td><td>${pc(x.sLo)}–${pc(x.sHi)}</td><td><b>${x.sCR == null ? '–' : f1(x.base * x.sCR)}</b></td>
          <td>${pc(x.wCR)}</td><td>${pc(x.wLo)}–${pc(x.wHi)}</td><td><b>${x.wCR == null ? '–' : f1(x.base * x.wCR)}</b></td></tr>`).join('') +
        `</tbody></table></div><div class="fuel-note">€/MWh. Capture rate = output-weighted day-ahead price ÷ baseload over the months the product covers, weighted by each month's typical output; average and range of ${r.years.join(', ')} (RTE éCO2mix × ENTSO-E day-ahead). Assumes the cannibalisation of those years repeats: an indicator, not a quote.</div>`;
    },
  });

  window.PKCaptureFwd = {
    render() {
      PKW.draw('fr-capture-forward', 'ren-capfwd', {}).then(r => { const e = document.getElementById('ren-capfwd-sub'); if (e && r && r.sub) e.textContent = r.sub; });
      const t = document.getElementById('ren-capfwd-table'); if (t) PKW.get('fr-capture-forward-table').html(t, {});
    },
  };
})();
