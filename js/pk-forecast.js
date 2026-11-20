// ════════════════════════════════════════════════════════════════════
// pk-forecast.js · window.PKF — solar, wind and load forecasts, always
// flagged as forecasts
//   · data/forecast.json (scripts/fetch_forecast.py): TSO day-ahead
//     forecasts for today and tomorrow, quarter-hourly MW, and their error
//     over the last 30 days (WAPE, bias)
//   · one look everywhere: the part of a chart that is a forecast sits on a
//     hatched band labelled FORECAST, a dashed "now" line splits it from what
//     has happened, forecast series are dashed, the card says where the
//     forecast comes from, when it was published and how far off it usually is
//   · chart option  plugins.pkFcZone = { from: <index>, now: <index> }
//   · widgets: fc-48h (chart), fc-tomorrow (key figures)
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const _fT = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;   // French unless the site is in English
  const ZONES = { FR: 'France', DE_LU: 'Germany', BE: 'Belgium', NL: 'Netherlands', ES: 'Spain' };
  const COL = { solar: '#FBBF24', wind: '#14D3A9', load: '#E6EDF3', resid: '#5FA8D3' };
  const KIND = { solar: 'solar', wind: 'wind', load: 'load' };
  let fcP = null;
  const dayP = {};
  const base = () => (typeof DATA_BASE !== 'undefined' ? DATA_BASE : 'data/');

  function get() {
    if (!fcP) fcP = fetch(base() + 'forecast.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    return fcP;
  }
  function daily(iso) {
    if (!dayP[iso]) dayP[iso] = fetch(base() + 'history/daily/' + iso + '.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    return dayP[iso];
  }
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  // quarter-hour of the Paris day we are in
  function nowSlot() {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':');
    return (+p[0] % 24) * 4 + Math.floor(+p[1] / 15);
  }
  // 96 quarter-hours → n slots per day (averages)
  function resample(a, n) {
    if (!a) return new Array(n).fill(null);
    if (a.length === n) return a.slice();
    const r = a.length / n, out = [];
    for (let i = 0; i < n; i++) {
      if (r >= 1) { const v = a.slice(Math.round(i * r), Math.round((i + 1) * r)).filter(x => x != null); out.push(v.length ? v.reduce((s, x) => s + x, 0) / v.length : null); }
      else out.push(a[Math.floor(i * r)] == null ? null : a[Math.floor(i * r)]);
    }
    return out;
  }
  async function day(zone, iso) {
    const j = await get();
    const z = j && j.zones && j.zones[zone];
    return (z && z.days && z.days[iso]) || null;
  }
  async function accuracy(zone) {
    const j = await get();
    return (j && j.zones && j.zones[zone] && j.zones[zone].accuracy) || {};
  }
  const pct = v => v == null ? '–' : Math.round(Math.abs(v) * 100) + ' %';
  // "usual error wind 9 % · solar 14 % · load 3 %" (30 days, hourly)
  async function accText(zone, kinds) {
    const a = await accuracy(zone);
    const parts = (kinds || ['wind', 'solar', 'load']).filter(k => a[k] && a[k].wape != null).map(k => k + ' ' + pct(a[k].wape));
    return parts.length ? 'usual error ' + parts.join(' · ') : '';
  }
  async function published() {
    const j = await get();
    if (!j || !j.updated) return '';
    const d = new Date(j.updated);
    return d.toLocaleString('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function bias(a) {
    if (!a || a.bias == null || Math.abs(a.bias) < 0.03) return '';
    return a.bias > 0 ? 'tends to be high by ' + pct(a.bias) : 'tends to be low by ' + pct(a.bias);
  }

  // ── the FORECAST band ──
  const css = n => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); } catch (_) { return ''; } };
  let hatch = null;
  function pattern(g) {
    if (hatch) return hatch;
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const x = c.getContext('2d');
    x.strokeStyle = 'rgba(127,200,248,.16)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(0, 8); x.lineTo(8, 0); x.stroke();
    hatch = g.createPattern(c, 'repeat');
    return hatch;
  }
  const zonePlugin = {
    id: 'pkFcZone',
    beforeDatasetsDraw(ch, _a, o) {
      if (!o || o.from == null || o.from < 0 || !ch.scales.x) return;
      const a = ch.chartArea, g = ch.ctx, n = (ch.data.labels || []).length;
      if (o.from >= n) return;
      const x0 = Math.max(a.left, ch.scales.x.getPixelForValue(o.from) - (o.from > 0 ? (ch.scales.x.getPixelForValue(o.from) - ch.scales.x.getPixelForValue(o.from - 1)) / 2 : 0));
      g.save();
      g.fillStyle = 'rgba(127,200,248,.05)'; g.fillRect(x0, a.top, a.right - x0, a.bottom - a.top);
      g.fillStyle = pattern(g); g.fillRect(x0, a.top, a.right - x0, a.bottom - a.top);
      g.restore();
    },
    afterDatasetsDraw(ch, _a, o) {
      if (!o || ((o.from == null || o.from < 0) && (o.now == null || o.now < 0)) || !ch.scales.x) return;
      const a = ch.chartArea, g = ch.ctx, n = (ch.data.labels || []).length;
      g.save();
      g.font = '600 9px "IBM Plex Mono", "JetBrains Mono", monospace';
      if (o.from != null && o.from >= 0 && o.from < n) {
        const x0 = Math.max(a.left, ch.scales.x.getPixelForValue(o.from));
        const tr = x => window.PKI18n && PKI18n.tr ? PKI18n.tr(x) : x;
        const t = tr(o.label || 'FORECAST');
        const w = g.measureText(t).width + 10;
        if (a.right - x0 > w + 4) {
          g.fillStyle = 'rgba(127,200,248,.18)'; g.fillRect(x0 + 4, a.top + 3, w, 14);
          g.fillStyle = css('--acc') || '#7FC8F8'; g.fillText(t, x0 + 9, a.top + 13);
        }
      }
      if (o.now != null && o.now >= 0 && o.now < n) {
        const x = ch.scales.x.getPixelForValue(o.now);
        g.strokeStyle = 'rgba(184,201,217,.7)'; g.setLineDash([3, 3]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, a.top); g.lineTo(x, a.bottom); g.stroke();
        g.setLineDash([]); g.fillStyle = 'rgba(184,201,217,.9)';
        const nl = window.PKI18n && PKI18n.tr ? PKI18n.tr(o.nowLabel || 'now') : (o.nowLabel || 'now'), tw = g.measureText(nl).width;
        g.fillText(nl, x - tw - 4, a.bottom - 4);
      }
      g.restore();
    },
  };
  if (window.Chart && Chart.register) Chart.register(zonePlugin);
  else window.addEventListener('load', () => { if (window.Chart && Chart.register) Chart.register(zonePlugin); });

  // flagged card head: "FORECAST" chip + source line
  function chip(text) { return '<span class="pkf-chip" title="Forecast, not measured data">' + (text || 'Forecast') + '</span>'; }
  const style = document.createElement('style');
  style.textContent = `
  .pkf-chip{display:inline-flex;align-items:center;gap:4px;font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--acc,#7FC8F8);background:rgba(127,200,248,.12);border:1px dashed rgba(127,200,248,.55);border-radius:4px;padding:3px 6px;white-space:nowrap;vertical-align:middle}
  .pkf-note{font-size:10.5px;color:var(--tx3);margin-top:6px;line-height:1.45}
  .pkf-note b{color:var(--tx2);font-weight:600}
  .pkf-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;height:100%;align-content:start}
  .pkf-t{background:var(--bg2);border:1px dashed rgba(127,200,248,.4);border-radius:8px;padding:8px 10px;min-width:0}
  .pkf-t-l{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--tx3);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pkf-t-v{font-family:'IBM Plex Mono',monospace;font-size:18px;color:var(--tx);margin-top:3px;white-space:nowrap}
  .pkf-t-v small{font-size:10px;color:var(--tx3)}
  .pkf-t-s{font-size:10px;color:var(--tx3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  `;
  document.head.appendChild(style);

  // ── today + tomorrow: actual so far, forecast for the rest ──
  async function series48(zone) {
    const t = today(), d2 = addDays(t, 1);
    const [f1, f2, a1] = await Promise.all([day(zone, t), day(zone, d2), daily(t)]);
    if (!f1 && !f2) return null;
    const za = a1 && a1.zones && a1.zones[zone];
    const act = k => {
      if (!za) return null;
      let v = k === 'wind' ? ((Array.isArray(za.wind) && za.wind.length) ? za.wind : za.windOnshore) : za[k];
      if (!Array.isArray(v) || !v.some(x => x)) return null;
      v = resample(v, 96);
      const ns = nowSlot();
      return v.map((x, i) => i <= ns ? x : null);
    };
    const days = [t].concat(f2 ? [d2] : []);
    const fc = k => [].concat(resample(f1 && f1[k], 96), f2 ? resample(f2[k], 96) : []);
    const s = { days, solar: fc('solar'), wind: fc('wind'), load: fc('load') };
    s.resid = s.load.map((l, i) => l == null ? null : l - (s.wind[i] || 0) - (s.solar[i] || 0));
    const pad = a => a ? a.concat(f2 ? new Array(96).fill(null) : []) : null;
    s.actual = { solar: pad(act('solar')), wind: pad(act('wind')), load: pad(act('load')) };
    s.now = nowSlot();
    return s;
  }

  if (window.PKW) {
    const ZOPT = { key: 'zone', label: 'Zone', inTitle: true, options: Object.entries(ZONES) };
    PKW.register({
      id: 'fc-48h', title: 'Forecast · solar, wind and load, today and tomorrow', category: 'renewables', page: 'analysis', pageCanvas: 'ma-fc-48h',
      source: 'TSO day-ahead forecasts (ENTSO-E, via Energy-Charts)', size: { w: 6, h: 5 },
      desc: 'Day-ahead forecasts of solar, wind and load published by the grid operators, quarter-hourly, for today and tomorrow, with what has happened so far today. The forecast part is hatched and labelled; the note gives the usual error over the last 30 days.',
      params: [ZOPT], defaults: { zone: 'FR' },
      titleFn: p => (ZONES[p.zone] || p.zone) + ' · forecast, today and tomorrow',
      async draw(cid, p) {
        const zone = p.zone || 'FR';
        const s = await series48(zone);
        if (!s) { noDataMsg(cid, 'No forecast for ' + (ZONES[zone] || zone) + ' yet', 'Forecasts are published from the morning before'); return null; }
        const lbl = [];
        s.days.forEach(d => { for (let i = 0; i < 96; i++) lbl.push(i === 0 ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', timeZone: 'UTC' }) : String(Math.floor(i / 4)).padStart(2, '0') + ':' + String(i % 4 * 15).padStart(2, '0')); });
        const gw = a => a ? a.map(v => v == null ? null : Math.round(v / 10) / 100) : null;
        const ds = [
          _fuelLineDs('Load · forecast', gw(s.load), COL.load, { borderDash: [5, 4], borderWidth: 1.4, spanGaps: false }),
          _fuelLineDs('Residual load · forecast', gw(s.resid), COL.resid, { borderDash: [5, 4], borderWidth: 1.4, spanGaps: false }),
          _fuelLineDs('Wind · forecast', gw(s.wind), COL.wind, { borderDash: [5, 4], borderWidth: 1.6, spanGaps: false }),
          _fuelLineDs('Solar · forecast', gw(s.solar), COL.solar, { borderDash: [5, 4], borderWidth: 1.6, spanGaps: false }),
        ];
        ['load', 'wind', 'solar'].forEach(k => { if (s.actual[k]) ds.push(_fuelLineDs(k[0].toUpperCase() + k.slice(1) + ' · actual', gw(s.actual[k]), COL[k], { borderWidth: 2.2, spanGaps: false })); });
        _fuelChart(cid, { type: 'line', data: { labels: lbl, datasets: ds },
          options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0, callback: (v, i) => i % 24 === 0 ? lbl[i] : '' } }), y: _fuelAxis('GW', { beginAtZero: true }) },
            plugins: { pkFcZone: { from: s.now + 1, now: s.now }, legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8 } } } }) }, 'forecast-' + zone);
        const [acc, pub] = await Promise.all([accText(zone), published()]);
        return { sub: 'Forecast (dashed, hatched) · TSO day-ahead · fetched ' + pub + (acc ? ' · ' + acc + ' (30 days)' : '') };
      },
    });


    // negative day-ahead prices: chance of each hour, today and tomorrow (scripts/neg_forecast.py)
    PKW.register({
      id: 'fc-neg', title: 'France · day-ahead price and chance of a negative price, today and tomorrow', category: 'prices', page: 'morning', pageCanvas: 'mrn-neg',
      source: 'PowerKlock model on RTE éCO2mix history and TSO day-ahead forecasts', size: { w: 6, h: 4 },
      desc: 'For each hour of today and tomorrow, the chance that the French day-ahead price is below zero, and the price: residual demand once solar, wind and the nuclear available are served, the solar share, the calendar, the price of the day before and the gas and CO2 cost; models on the last two to three years. Germany is left out: its forecasts come out after the morning forecast. Under the chart, two records: the replay with the real French weather (a best case) and the live record of every forecast published before 11:00 the day before, against the real prices. Where the price is already known, the real price is drawn.',
      async draw(cid) {
        let j = null; try { const r = await fetch(DATA_BASE + 'neg_forecast.json?t=' + Math.floor(Date.now() / 6e5)); j = r.ok ? await r.json() : null; } catch (_) {}
        const ds0 = j && j.days ? Object.keys(j.days).sort().slice(-2) : [];
        if (!ds0.length) { noDataMsg(cid, _fT('Pas encore de prévision de prix négatifs', 'No negative-price forecast yet'), _fT('Construite avec les prévisions de la veille, plusieurs fois par jour', 'Built with the day-ahead forecasts, several times a day')); return null; }
        // shown only once the live record of the forecasts published the day before proves it works (data/history/neg_forecast_rex.json):
        //   price: ≥ 30 days scored and a mean error at least 15 % below « tomorrow = today »;
        //   negative hours: ≥ 10 real negative days, ≥ 70 % of them flagged, ≤ 30 % false alarms
        const n1 = v => _fT(String(v).replace('.', ','), String(v));
        const lv = j.live && j.live.models ? j.live.models[j.live.current] : null;
        const priceOk = !!(lv && lv.days >= 30 && lv.naive_mae && lv.mae <= 0.85 * lv.naive_mae);
        const negOk = !!(lv && lv.days_negative >= 10 && lv.caught / lv.days_negative >= 0.7 && lv.days_flagged && lv.false_alarms / lv.days_flagged <= 0.3);
        const rec = lv ? _fT(`bilan réel : ${lv.days} jour(s) depuis le ${lv.from}, erreur moyenne ${n1(lv.mae)} €/MWh contre ${n1(lv.naive_mae)} pour « demain = aujourd’hui », ${lv.days_negative} jour(s) réellement négatif(s), ${lv.false_alarms} fausse(s) alerte(s) sur ${lv.days_flagged}`,
                                `live record: ${lv.days} day(s) since ${lv.from}, mean error ${lv.mae} €/MWh vs ${lv.naive_mae} for « tomorrow = today », ${lv.days_negative} real negative day(s), ${lv.false_alarms} false alarm(s) out of ${lv.days_flagged}`)
                       : _fT('bilan réel : pas encore de jour noté (nouveau modèle depuis le 20 nov. 2026)', 'live record: no day scored yet (new model since 20 Nov 2026)');
        if (!priceOk && !negOk) {
          const why = _fT('Prévision en test : elle s’affichera quand son bilan réel le justifiera (prix : 30 jours et 15 % mieux que « demain = aujourd’hui » ; heures négatives : 10 jours négatifs, 70 % repérés, au plus 30 % de fausses alertes).',
                          'Forecast on trial: it will show once its live record justifies it (price: 30 days and 15 % better than « tomorrow = today »; negative hours: 10 negative days, 70 % flagged, at most 30 % false alarms).');
          noDataMsg(cid, _fT('Prévision en test', 'Forecast on trial'), why);
          // a deliberate state, not missing data: marked so that tests/smoke.py can tell the two apart (it checks the record itself)
          const tm = document.getElementById(cid) && document.getElementById(cid).parentNode.querySelector('.no-data-msg'); if (tm) tm.dataset.pkTrial = 'fc-neg';
          return { sub: why + ' · ' + rec };
        }
        const lbl = [], pr = [], act = [], pf = [], plo = [], phi = [];
        ds0.forEach(d => { const x = j.days[d]; for (let h = 0; h < 24; h++) { lbl.push(h === 0 ? new Date(d + 'T12:00:00Z').toLocaleDateString(_fT('fr-FR', 'en-GB'), { weekday: 'short', day: '2-digit', timeZone: 'UTC' }) : String(h).padStart(2, '0') + 'h');
          pr.push(x.prob[h] == null ? null : Math.round(x.prob[h] * 100)); act.push(x.actual && x.actual[h] != null ? +(+x.actual[h]).toFixed(1) : null); pf.push(x.price && x.price[h] != null ? x.price[h] : null);
          plo.push(x.price_lo && x.price_lo[h] != null ? x.price_lo[h] : null); phi.push(x.price_hi && x.price_hi[h] != null ? x.price_hi[h] : null); } });
        if (!priceOk) { pf.fill(null); plo.fill(null); phi.fill(null); }   // only the part that has proved itself is drawn
        if (!negOk) pr.fill(null);
        _fuelChart(cid, { type: 'bar', data: { labels: lbl, datasets: [
          { label: _fT('Probabilité de prix négatif (%)', 'Chance of a negative price (%)'), data: pr, backgroundColor: pr.map(v => v == null ? 'transparent' : v >= 50 ? 'rgba(237,105,101,.8)' : v >= 20 ? 'rgba(251,191,36,.7)' : 'rgba(127,200,248,.45)'), borderRadius: 2, yAxisID: 'y' },
          { type: 'line', label: _fT('Prix day-ahead, quand il est connu (€/MWh)', 'Day-ahead price, when known (€/MWh)'), data: act, borderColor: '#E6EDF3', borderWidth: 1.6, pointRadius: 0, spanGaps: false, yAxisID: 'y1' },
          // error band: 8 times out of 10 the price fell inside it over the last twelve replayed months (P10–P90 of the error, hour by hour)
          { type: 'line', label: '', data: plo, borderWidth: 0, pointRadius: 0, spanGaps: false, yAxisID: 'y1', fill: false },
          { type: 'line', label: _fT('Marge d’erreur, 8 fois sur 10 (€/MWh)', 'Error margin, 8 times out of 10 (€/MWh)'), data: phi, borderWidth: 0, pointRadius: 0, spanGaps: false, yAxisID: 'y1', fill: '-1', backgroundColor: 'rgba(251,191,36,.16)' },
          { type: 'line', label: _fT('Prévision de prix (€/MWh)', 'Price forecast (€/MWh)'), data: pf, borderColor: '#FBBF24', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0, spanGaps: false, yAxisID: 'y1' }] },
          options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0, callback: (v, i) => i % 6 === 0 ? lbl[i] : '' } }), y: _fuelAxis(_fT('% de probabilité', '% chance'), { min: 0, max: 100 }), y1: _fuelAxis('€/MWh', { position: 'right', grid: { display: false } }) },
            plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !!it.text } } } }) }, 'forecast-negative-prices');
        const k = j.skill || {}, exp = ds0.map(d => new Date(d + 'T12:00:00Z').toLocaleDateString(_fT('fr-FR', 'en-GB'), { weekday: 'short', timeZone: 'UTC' }) + ' ≈ ' + _fT(String(j.days[d].expected_hours).replace('.', ','), String(j.days[d].expected_hours)) + ' h').join(' · ');
        const ps = j.price_skill; const n0 = v => _fT(String(v).replace('.', ','), String(v));
        // live record: forecasts published before 11:00 the day before, against the real prices (data/history/neg_forecast_rex.json)
        const old = j.live && j.live.models ? j.live.models.v1 : null;
        const liveTxt = lv && lv.days >= 7
          ? _fT(` · bilan réel des prévisions publiées la veille (${lv.days} jours depuis le ${lv.from}) : erreur moyenne ${n0(lv.mae)} €/MWh, contre ${n0(lv.naive_mae)} pour « demain = aujourd’hui » ; ${lv.false_alarms} fausse(s) alerte(s) sur ${lv.days_flagged} jour(s) annoncé(s) avec des prix négatifs`,
                ` · live record of the forecasts published the day before (${lv.days} days since ${lv.from}): mean error ${lv.mae} €/MWh vs ${lv.naive_mae} for « tomorrow = today »; ${lv.false_alarms} false alarm(s) out of ${lv.days_flagged} day(s) flagged with negative prices`)
          : _fT(' · bilan réel des prévisions publiées : nouveau modèle depuis le 20 nov. 2026, pas encore assez de jours', ' · live record of the published forecasts: new model since 20 Nov 2026, not enough days yet')
            + (old ? _fT(` (l’ancien modèle, avec l’Allemagne absente le matin, se trompait de ${n0(old.mae)} €/MWh sur ${old.days} jours, contre ${n0(old.naive_mae)} pour « demain = aujourd’hui »)`, ` (the former model, with Germany missing in the morning, was off by ${old.mae} €/MWh over ${old.days} days vs ${old.naive_mae} for « tomorrow = today »)`) : '');
        return { sub: _fT('Heures négatives attendues : ', 'Expected negative hours: ') + exp
          + (ps ? _fT(` · rejeu avec la météo réelle depuis ${ps.from} (cas le plus favorable) : erreur moyenne sur le prix ${n0(ps.mae)} €/MWh, contre ${n0(ps.naive_mae)} pour le prix de la veille`, ` · replay with the real weather since ${ps.from} (best case): mean price error ${ps.mae} €/MWh vs ${ps.naive_mae} for the day-before price`) : '')
          + (ps && ps.band_by_hour ? _fT(' ; la zone jaune est la marge d’erreur : sur les 12 derniers mois rejoués, le prix est tombé dedans 8 fois sur 10 (sans compter l’erreur de la prévision météo, donc un peu trop étroite)', '; the yellow area is the error margin: over the last 12 replayed months the price fell inside it 8 times out of 10 (weather forecast error not included, so slightly too narrow)') : '')
          + (k.caught != null ? _fT(', ', ', ') + Math.round(k.caught * 100) + _fT(' % des jours à prix négatifs repérés', ' % of the days with negative prices flagged') : '')
          + (k.false_alarms != null ? ', ' + Math.round(k.false_alarms * 100) + _fT(' % de fausses alertes', ' % false alarms') : '')
          + liveTxt };
      },
    });

    // France: PowerKlock's combined forecast (physics + learned weights + TSO forecast, scripts/fcst_live.py), P10–P90 band
    PKW.register({
      id: 'fc-combined', title: 'France · PowerKlock combined forecast, solar and wind', category: 'renewables', page: 'morning', pageCanvas: 'mrn-fcc',
      source: 'PowerKlock model on Open-Meteo and the TSO day-ahead forecast', size: { w: 6, h: 5 },
      desc: 'Solar and wind output of France for today and tomorrow: PowerKlock’s forecast (the forecast tool’s physics at 15 points weighted by the fleet, with the TSO forecast as an input), its P10–P90 band, the TSO forecast and the actual output so far. Walk-forward since 2024 it beats the TSO forecast alone.',
      params: [{ key: 'tech', label: 'Technology', options: [['wind', 'Wind'], ['solar', 'Solar']] }], defaults: { tech: 'wind' },
      titleFn: p => 'France · ' + (p.tech === 'solar' ? 'solar' : 'wind') + ' forecast, PowerKlock vs TSO',
      async draw(cid, p) {
        const tech = p.tech === 'solar' ? 'solar' : 'wind';
        let j = null; try { const r = await fetch(DATA_BASE + 'fr_fc_combined.json?t=' + Math.floor(Date.now() / 6e5)); j = r.ok ? await r.json() : null; } catch (_) {}
        const ds0 = j && j.days ? Object.keys(j.days).sort().slice(-2) : [];
        if (!ds0.length) { noDataMsg(cid, _fT('Pas encore de prévision combinée', 'No combined forecast yet'), _fT('Construite avec chaque prévision du GRT', 'Built with each TSO day-ahead forecast')); return null; }
        const s = await series48('FR');
        const lbl = [], mid = [], lo = [], hi = [], tso = [], act = [];
        ds0.forEach((d, k) => { const x = j.days[d][tech] || {}; for (let h = 0; h < 24; h++) {
          lbl.push(h === 0 ? new Date(d + 'T12:00:00Z').toLocaleDateString(_fT('fr-FR', 'en-GB'), { weekday: 'short', day: '2-digit', timeZone: 'UTC' }) : String(h).padStart(2, '0') + 'h');
          const g = v => v == null ? null : Math.round(v / 10) / 100;
          mid.push(g((x.mid || [])[h])); lo.push(g((x.p10 || [])[h])); hi.push(g((x.p90 || [])[h])); tso.push(g((x.tso || [])[h]));
          const a = s && s.days && s.days.indexOf(d) >= 0 && s.actual[tech] ? s.actual[tech].slice(s.days.indexOf(d) * 96 + h * 4, s.days.indexOf(d) * 96 + h * 4 + 4).filter(v => v != null) : [];
          act.push(a.length ? Math.round(a.reduce((u, v) => u + v, 0) / a.length / 10) / 100 : null); } });
        const col = tech === 'solar' ? '#FBBF24' : '#14D3A9';   // = PK_PAL.fuel
        _fuelChart(cid, { type: 'line', data: { labels: lbl, datasets: [
          { label: 'P90', data: hi, borderColor: 'transparent', backgroundColor: tech === 'solar' ? 'rgba(244,196,48,.15)' : 'rgba(20,211,169,.15)', pointRadius: 0, fill: '+1' },
          { label: 'P10', data: lo, borderColor: 'transparent', pointRadius: 0, fill: false },
          { label: 'PowerKlock', data: mid, borderColor: col, borderWidth: 2.2, pointRadius: 0 },
          { label: _fT('GRT (ENTSO-E)', 'TSO (ENTSO-E)'), data: tso, borderColor: '#7FC8F8', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0 },
          { label: _fT('Réel', 'Actual'), data: act, borderColor: '#E6EDF3', borderWidth: 1.8, pointRadius: 0, spanGaps: false }] },
          options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0, callback: (v, i) => i % 6 === 0 ? lbl[i] : '' } }), y: _fuelAxis('GW', { beginAtZero: true }) },
            plugins: { legend: { display: true, position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10, padding: 8, filter: it => !/^P[19]0$/.test(it.text) } } } }) }, 'forecast-combined-' + tech);
        const k = (j.skill || {})[tech] || {}, tot = a => a.reduce((u, v) => u + (v || 0), 0);
        const per = ds0.map((d, i) => `${new Date(d + 'T12:00:00Z').toLocaleDateString(_fT('fr-FR', 'en-GB'), { weekday: 'short', timeZone: 'UTC' })} ${tot(mid.slice(i * 24, i * 24 + 24)).toFixed(0)} GWh (${_fT('GRT', 'TSO')} ${tot(tso.slice(i * 24, i * 24 + 24)).toFixed(0)})`).join(' · ');
        const cv = Math.round((k.coverage || 0.8) * 100), dd = v => _fT(String(v).replace('.', ','), String(v));
        return { sub: per + _fT(` · bande P10–P90 (${cv} % des heures passées à l’intérieur) · bilan depuis 2024 : ${dd(k.combined)} % de la capacité vs GRT ${dd(k.tso)} %`, ` · band P10–P90 (${cv} % of past hours inside) · record since 2024: ${k.combined} % of capacity vs TSO ${k.tso} %`) };
      },
    });
    PKW.register({
      id: 'fc-tomorrow', kind: 'html', title: 'Tomorrow · forecast output and load', category: 'kpi', page: 'analysis', source: 'TSO day-ahead forecasts (ENTSO-E, via Energy-Charts)', size: { w: 6, h: 2 },
      desc: 'Tomorrow’s forecast wind and solar output (GWh), load and residual load (average GW), against today; flagged as a forecast with its usual error.',
      params: [ZOPT], defaults: { zone: 'FR' },
      titleFn: p => (ZONES[p.zone] || p.zone) + ' · tomorrow (forecast)',
      async html(host, p) { return tiles(host, p.zone || 'FR'); },
    });
  }

  // forecast error history: how far off the TSO day-ahead forecast was, day by day, from data/history/forecast/<YYYY-MM>.json
  //   error (WAPE) = Σ|forecast − actual| ÷ Σ actual over the hours of the delivery day; bias = Σ(forecast − actual) ÷ Σ actual
  const histP = {};
  function histMonth(ym) {
    if (!histP[ym]) histP[ym] = fetch(base() + 'history/forecast/' + ym + '.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    return histP[ym];
  }
  const prevYm = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };
  async function errorSeries(zone, kind) {
    const out = [];
    let ym = today().slice(0, 7);
    for (let i = 0; i < 36; i++) {                       // back month by month until the archive stops
      const j = await histMonth(ym);
      if (!j || !j.days) break;
      Object.keys(j.days).forEach(d => {
        const k = j.days[d][zone] && j.days[d][zone][kind];
        if (!k || !k.fc || !k.act) return;
        let e = 0, a = 0, b = 0, n = 0;
        k.fc.forEach((f, h) => { const v = k.act[h]; if (f == null || v == null) return; e += Math.abs(f - v); b += f - v; a += v; n++; });
        if (n >= 20 && a > 0) out.push({ d, err: e / a, bias: b / a });   // a day still in progress (hours missing) is left out
      });
      // a month whose file starts after its first days is the month the archive began: nothing before it to ask for
      const first = Object.keys(j.days).sort()[0]; if (first && first.slice(0, 7) === ym && +first.slice(8) > 5) break;
      ym = prevYm(ym);
    }
    return out.sort((x, y) => x.d < y.d ? -1 : 1);
  }
  const KIND_NAME = { solar: 'Solar', wind: 'Wind', load: 'Load' };

  if (window.PKW) {
    PKW.register({
      id: 'fc-error', title: 'Forecast error · day by day', category: 'renewables', page: 'analysis', pageCanvas: 'ma-fc-err',
      source: 'TSO day-ahead forecasts and actual output (ENTSO-E, via Energy-Charts)', size: { w: 6, h: 5 },
      desc: 'How far off the grid operators’ day-ahead forecast was, day by day, as a share of actual output (error = Σ|forecast − actual| ÷ Σ actual over the hours of the day), with its 7-day average. Solar, wind or load.',
      params: [{ key: 'zone', label: 'Zone', inTitle: true, options: Object.entries(ZONES) }, { key: 'kind', label: 'Series', options: [['solar', 'Solar'], ['wind', 'Wind'], ['load', 'Load']] }], defaults: { zone: 'FR', kind: 'solar' },
      titleFn: p => (ZONES[p.zone] || p.zone) + ' · ' + (KIND_NAME[p.kind] || 'Solar').toLowerCase() + ' forecast error',
      async draw(cid, p) {
        const zone = p.zone || 'FR', kind = KIND_NAME[p.kind] ? p.kind : 'solar';
        const acc = await accuracy(zone);
        if (acc[kind] && acc[kind].note) { noDataMsg(cid, 'Error not measurable', 'Actual output is reported for only part of the fleet'); return null; }
        const ser = await errorSeries(zone, kind);
        if (ser.length < 3) { noDataMsg(cid, 'Not enough history yet', 'The forecast archive is still short'); return null; }
        const lbl = ser.map(r => new Date(r.d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }));
        const pc = v => Math.round(v * 1000) / 10;
        const daily = ser.map(r => pc(r.err));
        const roll = ser.map((_, i) => { const w = ser.slice(Math.max(0, i - 6), i + 1); return w.length >= 4 ? pc(w.reduce((s, r) => s + r.err, 0) / w.length) : null; });
        _fuelChart(cid, { type: 'line', data: { labels: lbl, datasets: [
          _fuelLineDs('Daily error', daily, COL[kind], { borderWidth: 1, pointRadius: 2, borderColor: COL[kind] + '99' }),
          _fuelLineDs('7-day average', roll, COL[kind], { borderWidth: 2.4, spanGaps: false }),
        ] }, options: _fuelOpts({
          scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 8, maxRotation: 0 } }),
                    y: _fuelAxis('% of actual output', { beginAtZero: true, ticks: { color: C_TX3, font: { size: 10 }, callback: v => v + ' %' } }) },
          plugins: { tooltip: { callbacks: { label: c => c.dataset.label + ': ' + (c.parsed.y == null ? '–' : c.parsed.y.toFixed(1)) + ' %' } } } }) }, 'forecast-error-' + kind + '-' + zone);
        const mean = ser.reduce((s, r) => s + r.err, 0) / ser.length, bias = ser.reduce((s, r) => s + r.bias, 0) / ser.length;
        const bt = Math.abs(bias) < 0.01 ? '' : ', bias ' + pc(Math.abs(bias)) + ' % ' + (bias > 0 ? 'high' : 'low');
        return {
          finding: KIND_NAME[kind] + ' forecast error: ' + pc(mean) + ' % on average over ' + ser.length + ' days' + bt,
          sub: 'Day-ahead forecast against actual output, hourly · error = Σ|forecast − actual| ÷ Σ actual',
        };
      },
    });
  }

  // key figures for tomorrow (falls back to today when tomorrow is not published yet)
  async function tiles(host, zone) {
    if (!host) return;
    const t = today(), d2 = addDays(t, 1);
    const [a, b, acc] = await Promise.all([day(zone, t), day(zone, d2), accuracy(zone)]);
    const cur = b || a, ref = b ? a : null;
    if (!cur) { host.innerHTML = '<div class="fuel-note">No forecast for ' + (ZONES[zone] || zone) + ' yet.</div>'; return; }
    const sum = v => v ? v.reduce((s, x) => s + (x || 0), 0) / 4 / 1000 : null;          // MW quarter-hours → GWh
    const mean = v => { const x = (v || []).filter(y => y != null); return x.length ? x.reduce((s, y) => s + y, 0) / x.length / 1000 : null; };
    const resid = d => d && d.load ? d.load.map((l, i) => l == null ? null : l - ((d.wind || [])[i] || 0) - ((d.solar || [])[i] || 0)) : null;
    const rows = [
      ['Wind', sum(cur.wind), ref && sum(ref.wind), 'GWh', 'wind', false],
      ['Solar', sum(cur.solar), ref && sum(ref.solar), 'GWh', 'solar', false],
      ['Load (avg)', mean(cur.load), ref && mean(ref.load), 'GW', 'load', true],
      ['Residual load (avg)', mean(resid(cur)), ref && mean(resid(ref)), 'GW', null, true],
    ];
    const when = (b ? 'Tomorrow ' : 'Today ') + new Date((b ? d2 : t) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', timeZone: 'UTC' });
    host.innerHTML = '<div class="pkf-tiles">' + rows.map(r => {
      const dlt = r[1] != null && r[2] ? ((r[1] / r[2] - 1) * 100) : null;
      const e = r[4] && acc[r[4]] && acc[r[4]].wape != null ? '± ' + pct(acc[r[4]].wape) + ' usual' : '';
      // the title follows the site's rule (note 81): red when the change pushes prices up, green when it eases them
      const tt = dlt == null || Math.abs(dlt) < 2 ? '' : (dlt > 0) === r[5] ? ' pk-tt-bad' : ' pk-tt-good';
      return `<div class="pkf-t"><div class="pkf-t-l${tt}">${r[0]} · ${when}</div><div class="pkf-t-v">${r[1] == null ? '–' : r[1].toFixed(r[3] === 'GW' ? 1 : 0)} <small>${r[3]}</small></div><div class="pkf-t-s">${[dlt == null ? '' : (dlt >= 0 ? '+' : '') + dlt.toFixed(0) + ' % vs today', e].filter(Boolean).join(' · ') || '&nbsp;'}</div></div>`;
    }).join('') + '</div><div class="pkf-note">' + chip() + ' TSO day-ahead forecast · <b>' + (ZONES[zone] || zone) + '</b> · fetched ' + (await published()) + (b ? '' : ' · tomorrow\u2019s forecast is not published yet (usually by midday): today shown') + '</div>';
  }

  window.PKF = { get, day, accuracy, errorSeries, accText, published, bias, chip, tiles, nowSlot, today, zonePlugin, ZONES };
})();
