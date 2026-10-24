// ════════════════════════════════════════════════════════════════════
// FRANCE AGAINST THE PPE3 (Installed Capacity page)
//   installed solar and onshore wind (Energy-Charts, data/history/capacity.json)
//   against the PPE3 targets used by the PPA pricer (same constants), the
//   yearly pace needed from the last year to each target vs the last 3 years
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const PPE3 = { solar: { 2030: 48.0, 2035: 67.5 }, wind: { 2030: 31.0, 2035: 37.5 } };   // GW, same as js/tool-ppa.js
  const KEY = { solar: ['Solar AC', 'Solar'], wind: ['Wind onshore'] };
  async function draw(cid) {
    let j = null; try { const r = await fetch(DATA_BASE + 'history/capacity.json'); j = r.ok ? await r.json() : null; } catch (_) {}
    const fr = j && j.countries && j.countries.FR; if (!fr) { noDataMsg(cid, 'No capacity data', ''); return null; }
    const ys = fr.years, ser = t => { const k = KEY[t].find(x => fr.types[x]); return k ? fr.types[k] : []; };
    const S = ser('solar'), W = ser('wind'), y0 = ys[ys.length - 1];
    const labels = []; for (let y = ys[0]; y <= 2035; y++) labels.push(String(y));
    const at = (arr, y) => { const i = ys.indexOf(y); return i < 0 ? null : arr[i]; };
    const path = (arr, t) => labels.map(l => { const y = +l, v0 = at(arr, y0); if (y < y0 || v0 == null) return null; const T = PPE3[t];
      return y <= 2030 ? +(v0 + (T[2030] - v0) * (y - y0) / (2030 - y0)).toFixed(2) : +(T[2030] + (T[2035] - T[2030]) * (y - 2030) / 5).toFixed(2); });
    const pts = (t) => labels.map(l => [2030, 2035].includes(+l) ? PPE3[t][+l] : null);
    _fuelChart(cid, { type: 'line', data: { labels, datasets: [
      { label: 'Solar installed', data: labels.map(l => at(S, +l)), borderColor: '#F4C430', borderWidth: 2.4, pointRadius: 2 },
      { label: 'Solar · path to PPE3', data: path(S, 'solar'), borderColor: '#F4C430', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0 },
      { label: 'Solar targets', data: pts('solar'), borderColor: '#F4C430', backgroundColor: '#F4C430', pointStyle: 'rectRot', pointRadius: 7, showLine: false },
      { label: 'Onshore wind installed', data: labels.map(l => at(W, +l)), borderColor: '#14D3A9', borderWidth: 2.4, pointRadius: 2 },
      { label: 'Wind · path to PPE3', data: path(W, 'wind'), borderColor: '#14D3A9', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0 },
      { label: 'Wind targets', data: pts('wind'), borderColor: '#14D3A9', backgroundColor: '#14D3A9', pointStyle: 'rectRot', pointRadius: 7, showLine: false }] },
      options: _fuelOpts({ plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } }, scales: { x: _fuelXAxis(), y: _fuelAxis('GW', { beginAtZero: true }) } }) }, 'france-ppe3');
    const pace = (arr) => { const n = Math.min(3, ys.length - 1); return (arr[arr.length - 1] - arr[arr.length - 1 - n]) / n; };
    const need = (arr, t) => (PPE3[t][2030] - arr[arr.length - 1]) / (2030 - y0);
    const k = document.getElementById('cap-ppe-kpis');
    const tile = (lab, a, t) => { const p = pace(a), nd = need(a, t), ok = p >= nd;
      return _fuelKpi(lab + ' · end ' + y0, a[a.length - 1].toFixed(1), 'GW', `PPE3 ${PPE3[t][2030]} GW in 2030, ${t === 'solar' ? '55–80' : '35–40'} in 2035`) +
        _fuelKpi(lab + ' · pace', p.toFixed(2), 'GW/yr', `last 3 years · ${nd.toFixed(2)} GW/yr needed to 2030 · ${ok ? 'on track' : 'behind by ' + (nd - p).toFixed(2) + ' GW/yr'}`, ok ? 'up' : 'down'); };
    if (k) k.innerHTML = tile('Solar', S, 'solar') + tile('Onshore wind', W, 'wind');
    return { sub: `GW, end of year (Energy-Charts) · PPE3 (decree 2026-76, 13 Feb 2026): solar 48 GW in 2030, 55–80 GW in 2035; onshore wind 31 GW, then 35–40 GW · 2035 drawn at the middle of the range, the value the PPA pricer's capture projections use` };
  }
  if (window.PKW) PKW.register({ id: 'cap-ppe3', title: 'France · installed solar and wind vs the PPE3', category: 'renewables', page: 'capacity', pageCanvas: 'cap-ppe', source: 'Energy-Charts · PPE3', size: { w: 6, h: 5 },
    desc: 'Installed solar and onshore wind in France against the PPE3 targets for 2030 and 2035, with the straight path to them and the yearly pace needed vs the recent pace.', draw });
  const show = () => { if (document.getElementById('cap-ppe')) PKW.draw('cap-ppe3', 'cap-ppe', {}).then(r => { const e = document.getElementById('cap-ppe-sub'); if (e && r) e.textContent = r.sub; }); };
  PK.onPage('capacity', () => setTimeout(show, 200));
})();
