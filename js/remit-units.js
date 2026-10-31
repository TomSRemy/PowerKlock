// ════════════════════════════════════════════════════════════════════
// OUTAGES & REMIT · unit by unit (data/history/fr_outages.json, scripts/fetch_fr_outages.py)
//   every outage message of French nuclear units on the ENTSO-E Transparency Platform:
//   reactors out now, a timeline of the next four months, the table, and a cross-check with
//   the operator's aggregate available capacity (Nuclear page)
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fr = () => !window.PKI18n || PKI18n.lang !== 'en';
  const T = (f, e) => fr() ? f : e;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const num = (v, d) => v == null || !isFinite(v) ? '–' : fr() ? v.toFixed(d).replace('.', ',') : v.toFixed(d);
  const DAY = 864e5;
  const dt = iso => new Date(iso.replace(/Z$/, ':00Z'));
  const dshort = iso => dt(iso).toLocaleDateString(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
  const dlong = iso => dt(iso).toLocaleDateString(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' });
  const C_PLAN = '#7FC8F8', C_FORCED = '#ED6965';

  async function render() {
    const box = $('ro-kpis'); if (!box) return;
    let j = null;
    try { j = await fetchJSON('history/fr_outages.json'); } catch (e) { j = null; }
    const ev = (j && j.events || []).filter(e => e.fuel === 'nuclear' && e.unavail != null && e.unavail > 0);
    if (!ev.length) {
      box.innerHTML = '';
      $('ro-tl-card').style.display = 'none'; $('ro-table-wrap').style.display = 'none';   // nothing to draw yet
      $('ro-empty').style.display = '';
      $('ro-empty').textContent = T('Première collecte en cours : les arrêts réacteur par réacteur apparaîtront ici dès que le job ENTSO-E aura tourné.',
        'First collection under way: the unit-by-unit outages will show here once the ENTSO-E job has run.');
      return;
    }
    $('ro-empty').style.display = 'none'; $('ro-tl-card').style.display = ''; $('ro-table-wrap').style.display = '';
    const now = Date.now();
    const on = ev.filter(e => dt(e.start) <= now && dt(e.end) > now);
    // one unit can carry several messages at once: count each unit once, with its largest unavailability
    const byUnit = {};
    on.forEach(e => { if (!byUnit[e.unit] || e.unavail > byUnit[e.unit].unavail) byUnit[e.unit] = e; });
    const cur = Object.values(byUnit);
    const gw = cur.reduce((a, e) => a + e.unavail, 0) / 1000;
    const forced = cur.filter(e => e.type === 'forced'), gwF = forced.reduce((a, e) => a + e.unavail, 0) / 1000;
    const nextBack = cur.slice().sort((a, b) => dt(a.end) - dt(b.end))[0];
    const week = ev.filter(e => e.type === 'forced' && e.published && now - new Date(e.published) < 7 * DAY);
    // operator aggregate (Nuclear page) for the cross-check
    let agg = null;
    try { await PKC.ready; const av = PKC.pts('fr_nuc_avail', true); if (av.length) agg = (FR_NUC_INSTALLED_MW - av[av.length - 1][1]) / 1000; } catch (e) { agg = null; }
    box.innerHTML =
      _fuelKpi(T('Réacteurs à l’arrêt', 'Reactors out'), String(cur.length), '', T(`dont ${forced.length} fortuits`, `${forced.length} forced`), cur.length ? 'down' : null) +
      _fuelKpi(T('Indisponible maintenant', 'Unavailable now'), num(gw, 1), 'GW', agg != null ? T(`agrégat de l’exploitant : ${num(agg, 1)} GW`, `operator aggregate: ${num(agg, 1)} GW`) : '') +
      _fuelKpi(T('Dont fortuit', 'Of which forced'), num(gwF, 1), 'GW', T('arrêts non planifiés', 'unplanned outages'), gwF > 0 ? 'down' : null) +
      _fuelKpi(T('Prochain retour', 'Next return'), nextBack ? esc(nextBack.unit) : '–', '', nextBack ? T('prévu le ', 'expected ') + dlong(nextBack.end) : '') +
      _fuelKpi(T('Arrêts fortuits publiés', 'Forced outages published'), String(week.length), '', T('sur 7 jours', 'last 7 days'), week.length ? 'down' : null);
    $('ro-upd').textContent = T('ENTSO-E · ', 'ENTSO-E · ') + (j.updated ? dlong(j.updated) + ' ' + j.updated.slice(11, 16) + ' UTC' : '');

    // timeline: every nuclear outage that overlaps [−14 days, +120 days], one row per unit
    const t0 = now - 14 * DAY, t1 = now + 120 * DAY;
    const win = ev.filter(e => dt(e.end) > t0 && dt(e.start) < t1);
    const units = [...new Set(win.slice().sort((a, b) => dt(a.start) - dt(b.start)).map(e => e.unit))];
    const rel = t => (Math.min(Math.max(t, t0), t1) - now) / DAY;
    const ds = ['planned', 'forced'].map(ty => ({
      label: ty === 'planned' ? T('Planifié', 'Planned') : T('Fortuit', 'Forced'),
      data: win.filter(e => e.type === ty).map(e => ({ x: [rel(+dt(e.start)), rel(+dt(e.end))], y: e.unit, e })),
      backgroundColor: ty === 'planned' ? C_PLAN : C_FORCED, borderWidth: 0, borderSkipped: false, barPercentage: 0.8, categoryPercentage: 0.9, grouped: false,
    }));
    const h = Math.max(220, units.length * 20 + 70);
    $('ro-tl-wrap').style.height = h + 'px'; $('ro-tl').style.height = h + 'px';
    $('ro-tl-sub').textContent = T(`${units.length} réacteurs avec un arrêt entre il y a 14 jours et dans 4 mois · ligne = aujourd’hui · MW indisponibles au survol`,
      `${units.length} reactors with an outage between 14 days ago and 4 months ahead · line = today · MW unavailable on hover`);
    const today = { id: 'roToday', afterDatasetsDraw(c) { const x = c.scales.x.getPixelForValue(0), a = c.chartArea; const g = c.ctx; g.save(); g.strokeStyle = '#F1F5F9'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(x, a.top); g.lineTo(x, a.bottom); g.stroke(); g.restore(); } };
    _fuelChart('ro-tl', { type: 'bar', data: { labels: units, datasets: ds }, plugins: [today],
      options: _fuelOpts({ indexAxis: 'y', interaction: { mode: 'nearest', intersect: true },
        scales: {
          x: { type: 'linear', min: -14, max: 120, grid: GRID, ticks: { color: C_TX3, font: { size: 10 }, stepSize: 14, callback: v => dshort(new Date(now + v * DAY).toISOString().slice(0, 16) + 'Z') } },
          y: { type: 'category', grid: { display: false }, ticks: { color: C_TX2, font: { size: 10 }, autoSkip: false } },
        },
        plugins: { legend: { position: 'bottom', labels: { color: C_TX2, font: { size: 10 }, boxWidth: 10 } }, zoom: false,
          tooltip: { callbacks: { title: it => it[0].raw.e.unit, label: it => { const e = it.raw.e; return [`${it.dataset.label} · ${num(e.unavail, 0)} MW ${T('indisponibles', 'unavailable')}`, `${dlong(e.start)} → ${dlong(e.end)}`, e.reason ? e.reason : ''].filter(Boolean); } } } } }) }, 'nuclear-outages');

    // announced availability, day by day for the next 120 days (notes 77, 97): installed capacity minus the outages
    // announced for that day, one unit counted once with its largest unavailability; last year's actual alongside
    try {
      const days = [], avail = [], ly = [];
      let lyPts = []; try { await PKC.ready; lyPts = PKC.pts('fr_nuc_avail', true); } catch (_) {}
      const lyMap = new Map(lyPts.map(p => [p[0], p[1]]));
      for (let k = 0; k <= 120; k++) {
        const t = now + k * DAY, mid = t - (t % DAY) + DAY / 2, u = {};
        ev.forEach(e => { if (dt(e.start) <= mid && dt(e.end) > mid && (!u[e.unit] || e.unavail > u[e.unit])) u[e.unit] = e.unavail; });
        const iso = new Date(mid).toISOString().slice(0, 10);
        days.push(iso); avail.push(Math.round((FR_NUC_INSTALLED_MW - Object.values(u).reduce((a, v) => a + v, 0)) / 100) / 10);
        const l = lyMap.get(String(+iso.slice(0, 4) - 1) + iso.slice(4)); ly.push(l != null ? Math.round(l / 100) / 10 : null);
      }
      _fuelChart('ro-proj', { type: 'line', data: { labels: days.map(d => dshort(d + 'T12:00Z')), datasets: [
        { label: T('Disponible annoncé (REMIT)', 'Announced available (REMIT)'), data: avail, borderColor: '#A87DC4', backgroundColor: 'rgba(168,125,196,.12)', borderWidth: 2.2, pointRadius: 0, fill: true, stepped: true },
        { label: T('Disponible réalisé, même jour l’an dernier', 'Actual available, same day last year'), data: ly, borderColor: '#B8C9D9', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0, fill: false },
        { label: T('Capacité installée', 'Installed capacity'), data: days.map(() => FR_NUC_INSTALLED_MW / 1000), borderColor: 'rgba(241,245,249,.35)', borderWidth: 1, pointRadius: 0, fill: false },
      ] }, options: _fuelOpts({ scales: { x: Object.assign(_fuelXAxis(), { ticks: { color: C_TX3, font: { size: 10 }, maxTicksLimit: 9, maxRotation: 0 } }), y: _fuelAxis('GW') } }) }, 'nuclear-announced-availability');
      const lo = Math.min(...avail), i = avail.indexOf(lo);
      $('ro-proj-sub').textContent = T(`Capacité installée moins les arrêts déjà annoncés · plus bas annoncé : ${num(lo, 1)} GW le ${dshort(days[i] + 'T12:00Z')} · des arrêts fortuits s’ajouteront`,
        `Installed capacity minus the outages already announced · lowest announced: ${num(lo, 1)} GW on ${dshort(days[i] + 'T12:00Z')} · forced outages will add to it`);
    } catch (e) { console.warn('[remit projection]', e); }

    // table: out now first, then the next starts
    const rows = ev.filter(e => dt(e.end) > now);
    rows.sort((a, b) => { const A = dt(a.start) <= now, B = dt(b.start) <= now; return A !== B ? (A ? -1 : 1) : dt(a.start) - dt(b.start); });
    $('ro-table').innerHTML = `<thead><tr><th style="text-align:left">${T('Réacteur', 'Unit')}</th><th style="text-align:left">${T('Type', 'Type')}</th><th>${T('Début', 'Start')}</th><th>${T('Fin prévue', 'Expected end')}</th><th>${T('MW indisp.', 'MW out')}</th><th style="text-align:left">${T('Motif', 'Reason')}</th><th>${T('Publié', 'Published')}</th></tr></thead><tbody>` +
      rows.slice(0, 80).map(e => `<tr><td class="l" style="text-align:left;font-weight:600">${esc(e.unit)}${dt(e.start) <= now ? ` <span style="color:var(--text3);font-weight:400">· ${T('en cours', 'now')}</span>` : ''}</td>` +
        `<td class="l" style="text-align:left;color:${e.type === 'forced' ? C_FORCED : C_PLAN}">${e.type === 'forced' ? T('Fortuit', 'Forced') : T('Planifié', 'Planned')}</td>` +
        `<td>${dlong(e.start)}</td><td>${dlong(e.end)}</td><td>${num(e.unavail, 0)}</td><td class="l" style="text-align:left;color:var(--text2)">${esc(e.reason)}</td><td>${e.published ? dshort(e.published.slice(0, 16) + 'Z') : ''}</td></tr>`).join('') + '</tbody>';
  }
  window.PKRemitUnits = { render };
})();
