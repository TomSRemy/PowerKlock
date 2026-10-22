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
  const ZONES = { FR: 'France', DE_LU: 'Germany', BE: 'Belgium', NL: 'Netherlands', ES: 'Spain' };
  const COL = { solar: '#F4C430', wind: '#14D3A9', load: '#E6EDF3', resid: '#A87DC4' };
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
        const t = o.label || 'FORECAST';
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
        const nl = o.nowLabel || 'now', tw = g.measureText(nl).width;
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
  .pkf-chip{display:inline-flex;align-items:center;gap:4px;font:600 9px/1 'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--acc,#7FC8F8);background:rgba(127,200,248,.12);border:1px dashed rgba(127,200,248,.55);border-radius:4px;padding:3px 6px;white-space:nowrap;vertical-align:middle}
  .pkf-note{font-size:10.5px;color:var(--tx3);margin-top:6px;line-height:1.45}
  .pkf-note b{color:var(--tx2);font-weight:600}
  .pkf-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;height:100%;align-content:start}
  .pkf-t{background:var(--bg2);border:1px dashed rgba(127,200,248,.4);border-radius:8px;padding:8px 10px;min-width:0}
  .pkf-t-l{font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--tx3);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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

    PKW.register({
      id: 'fc-tomorrow', kind: 'html', title: 'Tomorrow · forecast output and load', category: 'kpi', page: 'analysis', source: 'TSO day-ahead forecasts (ENTSO-E, via Energy-Charts)', size: { w: 6, h: 2 },
      desc: 'Tomorrow’s forecast wind and solar output (GWh), load and residual load (average GW), against today; flagged as a forecast with its usual error.',
      params: [ZOPT], defaults: { zone: 'FR' },
      titleFn: p => (ZONES[p.zone] || p.zone) + ' · tomorrow (forecast)',
      async html(host, p) { return tiles(host, p.zone || 'FR'); },
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
      ['Wind', sum(cur.wind), ref && sum(ref.wind), 'GWh', 'wind'],
      ['Solar', sum(cur.solar), ref && sum(ref.solar), 'GWh', 'solar'],
      ['Load (avg)', mean(cur.load), ref && mean(ref.load), 'GW', 'load'],
      ['Residual load (avg)', mean(resid(cur)), ref && mean(resid(ref)), 'GW', null],
    ];
    const when = (b ? 'Tomorrow ' : 'Today ') + new Date((b ? d2 : t) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', timeZone: 'UTC' });
    host.innerHTML = '<div class="pkf-tiles">' + rows.map(r => {
      const dlt = r[1] != null && r[2] ? ((r[1] / r[2] - 1) * 100) : null;
      const e = r[4] && acc[r[4]] && acc[r[4]].wape != null ? '± ' + pct(acc[r[4]].wape) + ' usual' : '';
      return `<div class="pkf-t"><div class="pkf-t-l">${r[0]} · ${when}</div><div class="pkf-t-v">${r[1] == null ? '–' : r[1].toFixed(r[3] === 'GW' ? 1 : 0)} <small>${r[3]}</small></div><div class="pkf-t-s">${[dlt == null ? '' : (dlt >= 0 ? '+' : '') + dlt.toFixed(0) + ' % vs today', e].filter(Boolean).join(' · ') || '&nbsp;'}</div></div>`;
    }).join('') + '</div><div class="pkf-note">' + chip() + ' TSO day-ahead forecast · <b>' + (ZONES[zone] || zone) + '</b> · fetched ' + (await published()) + (b ? '' : ' · tomorrow\u2019s forecast is not published yet (usually by midday): today shown') + '</div>';
  }

  window.PKF = { get, day, accuracy, accText, published, bias, chip, tiles, nowSlot, today, zonePlugin, ZONES };
})();
