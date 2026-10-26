// ════════════════════════════════════════════════════════════════════
// bilan.js · the yearly review of the French power system (Système électrique › Bilan électrique), RTE "Bilan
// électrique" style, from data/history/bilan.json (scripts/build_bilan.py, rebuilt every day):
//   the current year to date against the same period of the year before, every past year complete against the
//   one before; key figures, a sentence written from them, production by source, prices, consumption, exchanges
//   by border, emissions since 2015, installed capacity, the year's regulatory milestones (js/regulatory.js)
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const N = (v, d = 1) => v == null || isNaN(v) ? '–' : T(Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }), Number(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const S = (v, d = 1, u = '') => v == null || isNaN(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + N(Math.abs(v), d) + u;
  const pct = (a, b) => a == null || !b ? null : (a / b - 1) * 100;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SRC = [['nuclear', ['Nucléaire', 'Nuclear'], '#A98BD4'], ['hydro', ['Hydraulique', 'Hydro'], '#4FB8C6'], ['wind', ['Éolien', 'Wind'], '#14D3A9'], ['solar', ['Solaire', 'Solar'], '#FBBF24'],
    ['bio', ['Bioénergies', 'Bioenergy'], '#9BC46A'], ['gas', ['Gaz', 'Gas'], '#F07B6B'], ['coal', ['Charbon', 'Coal'], '#8D7B6A'], ['oil', ['Fioul', 'Oil'], '#B07A5A']];
  const BORDER = { GB: ['Grande-Bretagne', 'Great Britain'], CH: ['Suisse', 'Switzerland'], IT: ['Italie', 'Italy'], DE: ['Allemagne', 'Germany'], BE: ['Belgique', 'Belgium'], ES: ['Espagne', 'Spain'] };
  const L = a => T(a[0], a[1]);
  let D = null, RM = null, year = null;
  const MON = () => T(['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'], ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

  async function render() {
    const host = document.getElementById('bilan-host'); if (!host) return;
    if (!D) D = await fetch((typeof DATA_BASE !== 'undefined' ? DATA_BASE : 'data/') + 'history/bilan.json').then(r => r.ok ? r.json() : null).catch(() => null);
    if (!RM) RM = await fetch((typeof DATA_BASE !== 'undefined' ? DATA_BASE : 'data/') + 'residual_mix.json').then(r => r.ok ? r.json() : null).catch(() => null);
    if (!D) { host.innerHTML = '<div class="fuel-note">' + T('Bilan indisponible.', 'Review not available.') + '</div>'; return; }
    const cur = D.current, y0 = String(cur.year);
    if (!year) year = y0;
    const live = year === y0, A = D.years[year], B = live ? cur.prev_same_period : D.years[String(+year - 1)];
    const to = new Date(D.to + 'T12:00:00Z').toLocaleDateString(T('fr-FR', 'en-GB'), { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const vs = live ? T(`même période de ${+year - 1}`, `same period of ${+year - 1}`) : String(+year - 1);
    const yrs = Object.keys(D.years).sort().reverse();
    const kpi = (l, v, u, c) => `<div class="bl-k"><span class="bl-kl">${l}</span><span class="bl-kv">${v}<small>${u}</small></span><span class="bl-kc">${c}</span></div>`;
    const ch = (a, b, d = 1, u = ' %') => { const p = pct(a, b); return p == null ? '' : `<span class="${p > 0 ? 'bl-up' : 'bl-dn'}">${S(p, d, u)}</span>`; };
    const sp = A.spot || {}, bsp = (B && B.spot) || {};
    // the sentence: what moved most, in plain words
    const dS = k => A.by_source[k] - ((B && B.by_source[k]) || 0);
    const movers = SRC.map(([k, n]) => [k, n, dS(k)]).sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])).slice(0, 3);
    const sent = B ? T(`Production ${pct(A.production, B.production) >= 0 ? 'en hausse' : 'en baisse'} de ${N(Math.abs(pct(A.production, B.production)), 1)} % (${N(A.production, 1)} TWh) ; `, `Production ${pct(A.production, B.production) >= 0 ? 'up' : 'down'} ${N(Math.abs(pct(A.production, B.production)), 1)} % (${N(A.production, 1)} TWh); `) +
      movers.map(([, n, d]) => `${L(n).toLowerCase()} ${S(d, 1, ' TWh')}`).join(', ') + '. ' +
      T(`Consommation ${S(pct(A.load, B.load), 1, ' %')}, solde ${A.net_export >= 0 ? 'exportateur' : 'importateur'} ${N(Math.abs(A.net_export), 1)} TWh. Spot moyen ${N(sp.avg, 1)} €/MWh (${S(pct(sp.avg, bsp.avg), 0, ' %')}), ${N(sp.neg_h, 0)} heures à prix négatif (${N(bsp.neg_h, 0)} sur la ${live ? 'même période' : 'année'} ${+year - 1}).`,
        `Consumption ${S(pct(A.load, B.load), 1, ' %')}, net ${A.net_export >= 0 ? 'exports' : 'imports'} ${N(Math.abs(A.net_export), 1)} TWh. Average spot ${N(sp.avg, 1)} €/MWh (${S(pct(sp.avg, bsp.avg), 0, ' %')}), ${N(sp.neg_h, 0)} negative-price hours (${N(bsp.neg_h, 0)} in the ${live ? 'same period of' : 'year'} ${+year - 1}).`) : '';
    host.setAttribute('translate', 'no');
    host.innerHTML = `
      <div class="bl-head"><div><h1 class="bl-h1">${T('Bilan électrique', 'Power system review')} ${year}${live ? T(', à date', ', to date') : ''}</h1>
        <p class="bl-sub">${live ? T(`Du 1er janvier au ${to} ${year}, comparé à la ${vs} · mis à jour chaque jour`, `1 January to ${to} ${year}, against the ${vs} · updated daily`) : T(`Année complète, comparée à ${vs}`, `Full year, against ${vs}`)}</p></div>
        <div class="bl-yrs">${yrs.map(y => `<button type="button" class="bl-y${y === year ? ' on' : ''}" data-y="${y}">${y === y0 ? y + T(' à date', ' to date') : y}</button>`).join('')}</div></div>
      <div class="bl-kpis">
        ${kpi(T('Consommation', 'Consumption'), N(A.load, 1), 'TWh', `${ch(A.load, B && B.load)} · ${T('pointe', 'peak')} ${N(A.peak_gw, 1)} GW`)}
        ${kpi(T('Production', 'Production'), N(A.production, 1), 'TWh', `${ch(A.production, B && B.production)} vs ${vs}`)}
        ${kpi(T('Bas carbone', 'Low-carbon'), N(A.low_carbon_pct, 1), '%', `${T('de la production', 'of production')} · ${N(B && B.low_carbon_pct, 1)} % ${T('avant', 'before')}`)}
        ${kpi(A.net_export >= 0 ? T('Solde exportateur', 'Net exports') : T('Solde importateur', 'Net imports'), N(Math.abs(A.net_export), 1), 'TWh', `<span class="${A.net_export >= ((B && B.net_export) || 0) ? 'bl-up' : 'bl-dn'}">${S(A.net_export - ((B && B.net_export) || 0), 1, ' TWh')}</span> · ${N(100 * A.net_export / A.production, 0)} % ${T('de la production', 'of production')}`)}
        ${kpi(T('Spot moyen', 'Average spot'), N(sp.avg, 1), '€/MWh', `${ch(sp.avg, bsp.avg, 0)} · ${N(bsp.avg, 1)} € ${T('avant', 'before')}`)}
        ${kpi(T('Heures négatives', 'Negative hours'), N(sp.neg_h, 0), 'h', `${S((sp.neg_h || 0) - (bsp.neg_h || 0), 0, ' h')} · ${N(sp.high_h, 0)} h ${T('au-dessus de 100 €', 'above 100 €')}`)}
      </div>
      ${sent ? `<p class="bl-lead">${esc(sent)}</p>` : ''}
      <section class="bl-blk"><div class="bl-t"><h2>${T('Production par filière', 'Production by source')}</h2><span class="bl-src">RTE éCO2mix · TWh</span></div>
        <div class="bl-cols"><div class="bl-c" style="height:300px"><canvas id="bl-src"></canvas></div><div class="bl-c" style="height:300px"><canvas id="bl-mon"></canvas></div></div></section>
      <section class="bl-blk"><div class="bl-t"><h2>${T('Prix', 'Prices')}</h2><span class="bl-src">ENTSO-E day-ahead · €/MWh</span></div>
        <div class="bl-cols"><div class="bl-c" style="height:280px"><canvas id="bl-spot"></canvas></div>
        <div class="bl-mini">${[[N(sp.avg, 1) + ' €', T('spot moyen', 'average spot')], [N(sp.neg_h, 0) + ' h', T('à prix négatif', 'at a negative price')], [N(sp.high_h, 0) + ' h', T('au-dessus de 100 €/MWh', 'above 100 €/MWh')],
          [N(sp.max_day_avg, 0) + ' €', T('journée la plus chère', 'dearest day') + ' (' + (sp.max_day ? new Date(sp.max_day + 'T12:00:00Z').toLocaleDateString(T('fr-FR', 'en-GB'), { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '–') + ')']].map(([v, l]) => `<div><b>${v}</b>${l}</div>`).join('')}</div></div></section>
      <div class="bl-cols">
        <section class="bl-blk"><div class="bl-t"><h2>${T('Consommation', 'Consumption')}</h2><span class="bl-src">RTE éCO2mix · TWh ${T('par mois', 'per month')}</span></div><div class="bl-c" style="height:240px"><canvas id="bl-load"></canvas></div></section>
        <section class="bl-blk"><div class="bl-t"><h2>${T('Échanges par frontière', 'Exchanges by border')}</h2><span class="bl-src">Energy-Charts · ${T('solde physique, TWh', 'physical balance, TWh')}</span></div><div class="bl-c" style="height:240px"><canvas id="bl-bord"></canvas></div></section>
        <section class="bl-blk"><div class="bl-t"><h2>${T('Émissions de la production', 'Emissions from production')}</h2><span class="bl-src">RTE · ${T('émissions directes', 'direct emissions')}</span></div><div class="bl-c" style="height:240px"><canvas id="bl-co2"></canvas></div></section>
        <section class="bl-blk"><div class="bl-t"><h2>${T('Capacités installées', 'Installed capacity')}</h2><span class="bl-src">Energy-Charts · GW ${T('fin d’année', 'end of year')}</span></div><div id="bl-cap"></div></section>
      </div>
      <section class="bl-blk" id="bl-rm"></section>
      <section class="bl-blk"><div class="bl-t"><h2>${T('Jalons réglementaires de l’année', 'Regulatory milestones of the year')}</h2><a class="bl-src" href="#intel/regulation" data-route="intel/regulation">${T('Veille réglementaire ›', 'Regulatory watch ›')}</a></div><ul class="bl-reg" id="bl-reg"></ul></section>
      <p class="bl-foot">${T('Méthode : sommes des données quotidiennes de RTE (éCO2mix consolidé puis temps réel) et des prix day-ahead ENTSO-E. Vérifié sur 2025 contre le Bilan électrique de RTE : nucléaire ', 'Method: sums of RTE’s daily data (éCO2mix consolidated then real time) and ENTSO-E day-ahead prices. Checked on 2025 against RTE’s Bilan électrique: nuclear ')}${N(D.check_2025.nuclear[0], 1)} TWh (RTE ${N(D.check_2025.nuclear[1], 1)}), ${T('production', 'production')} ${N(D.check_2025.production[0], 1)} (${N(D.check_2025.production[1], 1)}), ${T('solde exportateur', 'net exports')} ${N(D.check_2025.net_export[0], 1)} (${N(D.check_2025.net_export[1], 1)}), spot ${N(D.check_2025.spot[0], 1)} € (${N(D.check_2025.spot[1], 0)}), ${T('heures négatives', 'negative hours')} ${N(D.check_2025.neg_h[0], 0)} (${N(D.check_2025.neg_h[1], 0)}). ${T('La consommation est brute (RTE publie aussi une consommation corrigée de la météo) ; toutes les bioénergies comptent comme bas carbone ; les heures au-dessus de 100 € sont comptées sur les pas publiés (heure, puis quart d’heure depuis octobre 2025), RTE en compte 1 807 en 2025 contre 1 580 ici. Les émissions sont le taux de CO₂ d’éCO2mix appliqué à la production : 10,0 Mt en 2025, RTE publie 10,9 Mt dans son bilan (périmètre plus large).', 'Consumption is raw (RTE also publishes a weather-corrected figure); all bioenergy counts as low-carbon; hours above 100 € are counted on the published steps (hour, then quarter-hour since October 2025), RTE counts 1,807 in 2025 against 1,580 here. Emissions are éCO2mix’s CO₂ rate applied to production: 10.0 Mt in 2025, RTE’s review gives 10.9 Mt (wider scope).')}</p>`;
    host.querySelectorAll('.bl-y').forEach(b => b.addEventListener('click', () => { year = b.dataset.y; render(); }));
    charts(A, B, live, vs);
    residual();
  }

  function opts(extra) { return Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: true, position: 'bottom', labels: { color: '#B8C9D9', boxWidth: 10, font: { size: 11 } } } },
    scales: { x: { ticks: { color: '#7A93AB', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#7A93AB', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,.05)' } } } }, extra || {}); }
  function mk(id, cfg, pkw) { const c = document.getElementById(id); if (!c || !window.Chart) return; const old = Chart.getChart(c); if (old) old.destroy(); if (pkw) c.dataset.pkw = pkw; new Chart(c, cfg); }

  function charts(A, B, live, vs) {
    const prevLbl = live ? T('même période ', 'same period ') + (+year - 1) : String(+year - 1);
    // production by source, this year against the comparison
    mk('bl-src', { type: 'bar', data: { labels: SRC.map(s => L(s[1])), datasets: [
      { label: year, data: SRC.map(s => A.by_source[s[0]]), backgroundColor: SRC.map(s => s[2]), borderRadius: 3 },
      { label: prevLbl, data: SRC.map(s => B ? B.by_source[s[0]] : null), backgroundColor: SRC.map(s => s[2] + '55'), borderRadius: 3 }] },
      options: opts({ indexAxis: 'y', scales: { x: { ticks: { color: '#7A93AB' }, grid: { color: 'rgba(255,255,255,.05)' }, title: { display: true, text: 'TWh', color: '#7A93AB' } }, y: { ticks: { color: '#B8C9D9' }, grid: { display: false } } } }) });
    // monthly: only the current year and the one before carry months
    const M = D.months[year], P = D.months[String(+year - 1)], mons = M ? Object.keys(M).sort() : [];
    const box = id => { const c = document.getElementById(id); if (c) c.closest('.bl-c').hidden = !mons.length; };
    ['bl-mon', 'bl-spot', 'bl-load'].forEach(box);
    if (mons.length) {
      const at = (src, m, k) => { const r = src && src[(+m.slice(0, 4) - (src === P ? 1 : 0)) + m.slice(4)]; return r ? r[k] : null; };
      const lab = mons.map(m => m);   // ISO months: the regulatory milestones find their place
      const tick = { color: '#7A93AB', font: { size: 11 }, callback: (v, i) => MON()[+lab[i].slice(5, 7) - 1] };
      mk('bl-mon', { type: 'bar', data: { labels: lab, datasets: SRC.filter(s => s[0] !== 'oil' && s[0] !== 'coal').map(s => ({ label: L(s[1]), data: mons.map(m => M[m][s[0]]), backgroundColor: s[2], stack: 'p' })) },
        options: opts({ scales: { x: { stacked: true, ticks: tick, grid: { display: false } }, y: { stacked: true, ticks: { color: '#7A93AB' }, grid: { color: 'rgba(255,255,255,.05)' }, title: { display: true, text: T('TWh par mois', 'TWh per month'), color: '#7A93AB' } } } }) }, 'bilan-prod');
      mk('bl-spot', { type: 'line', data: { labels: lab, datasets: [
        { label: year, data: mons.map(m => M[m].spot), borderColor: '#14D3A9', borderWidth: 2.4, pointRadius: 2, tension: 0 },
        { label: String(+year - 1), data: mons.map(m => at(P, m, 'spot')), borderColor: '#7A93AB', borderDash: [4, 3], borderWidth: 1.6, pointRadius: 0, tension: 0 },
        { type: 'bar', label: T('heures négatives', 'negative hours'), data: mons.map(m => M[m].neg_h), backgroundColor: 'rgba(237,105,101,.45)', yAxisID: 'y1' }] },
        options: opts({ scales: { x: { ticks: tick, grid: { display: false } }, y: { ticks: { color: '#7A93AB' }, grid: { color: 'rgba(255,255,255,.05)' }, title: { display: true, text: '€/MWh', color: '#7A93AB' } },
          y1: { position: 'right', ticks: { color: '#ED6965' }, grid: { display: false }, title: { display: true, text: T('h négatives', 'negative h'), color: '#ED6965' } } } }) }, 'bilan-spot');
      mk('bl-load', { type: 'bar', data: { labels: lab, datasets: [
        { label: year, data: mons.map(m => M[m].load), backgroundColor: '#7FC8F8', borderRadius: 2 },
        { label: String(+year - 1), data: mons.map(m => at(P, m, 'load')), backgroundColor: 'rgba(127,200,248,.3)', borderRadius: 2 }] },
        options: opts({ scales: { x: { ticks: tick, grid: { display: false } }, y: { ticks: { color: '#7A93AB' }, grid: { color: 'rgba(255,255,255,.05)' } } } }) });
    }
    // borders: positive = net export to the neighbour
    const bd = A.borders, bp = live ? D.current.prev_borders_same_period : (D.years[String(+year - 1)] || {}).borders;
    const bc = document.getElementById('bl-bord'); if (bc) bc.closest('.bl-c').hidden = !bd;
    if (bd) { const ks = Object.keys(BORDER).filter(k => bd[k] != null);
      mk('bl-bord', { type: 'bar', data: { labels: ks.map(k => L(BORDER[k])), datasets: [{ label: year, data: ks.map(k => bd[k]), backgroundColor: '#14D3A9', borderRadius: 3 }, { label: prevLbl, data: ks.map(k => bp ? bp[k] : null), backgroundColor: 'rgba(20,211,169,.3)', borderRadius: 3 }] },
        options: opts({ indexAxis: 'y', scales: { x: { ticks: { color: '#7A93AB' }, grid: { color: 'rgba(255,255,255,.05)' }, title: { display: true, text: T('TWh exportés (net)', 'TWh exported (net)'), color: '#7A93AB' } }, y: { ticks: { color: '#B8C9D9' }, grid: { display: false } } } }) }); }
    // emissions every year since 2015 (the current year to date, marked)
    const ys = Object.keys(D.years).sort();
    mk('bl-co2', { type: 'bar', data: { labels: ys.map(y => y === String(D.current.year) ? y + '*' : y), datasets: [
      { label: T('Mt CO₂', 'Mt CO₂'), data: ys.map(y => D.years[y].co2_mt), backgroundColor: ys.map(y => y === year ? '#F07B6B' : 'rgba(240,123,107,.45)'), borderRadius: 3 },
      { type: 'line', label: 'g/kWh', data: ys.map(y => D.years[y].co2_g_kwh), borderColor: '#E6EDF3', borderWidth: 1.6, pointRadius: 2, yAxisID: 'y1', tension: 0 }] },
      options: opts({ scales: { x: { ticks: { color: '#7A93AB' }, grid: { display: false } }, y: { ticks: { color: '#7A93AB' }, grid: { color: 'rgba(255,255,255,.05)' }, title: { display: true, text: 'Mt', color: '#7A93AB' } },
        y1: { position: 'right', ticks: { color: '#B8C9D9' }, grid: { display: false }, title: { display: true, text: 'g/kWh', color: '#B8C9D9' } } } }) });
    // capacity: end of the year shown (or the latest known), change on the year before
    const capY = A.capacity ? year : Object.keys(D.years).filter(y => D.years[y].capacity).sort().pop(), C = capY && D.years[capY].capacity, C0 = capY && (D.years[String(+capY - 1)] || {}).capacity;
    const capEl = document.getElementById('bl-cap');
    if (capEl) capEl.innerHTML = C ? `<table class="bl-tab"><thead><tr><th>${T('Filière', 'Source')}</th><th>${T('fin', 'end')} ${capY}</th><th>${T('sur un an', 'on the year')}</th></tr></thead><tbody>` +
      [['nuclear', SRC[0][1]], ['solar', SRC[3][1]], ['wind_on', ['Éolien terrestre', 'Onshore wind']], ['wind_off', ['Éolien en mer', 'Offshore wind']], ['hydro', SRC[1][1]], ['gas', SRC[5][1]], ['bio', SRC[4][1]]]
        .map(([k, n]) => `<tr><td>${L(n)}</td><td>${N(C[k], 1)} GW</td><td class="${(C[k] - ((C0 || {})[k] || 0)) > 0.05 ? 'bl-up' : ''}">${C0 ? S(C[k] - C0[k], 1, ' GW') : '–'}</td></tr>`).join('') + '</tbody></table>' +
      (capY !== year ? `<p class="bl-note">${T('Capacités de fin ' + capY + ' : celles de ' + year + ' sont publiées en début d’année suivante.', 'End-' + capY + ' capacity: ' + year + '’s is published early next year.')}</p>` : '')
      : `<p class="bl-note">${T('Pas de données de capacité pour cette année.', 'No capacity data for this year.')}</p>`;
    // the year's milestones
    const reg = document.getElementById('bl-reg');
    if (reg && window.PKReg) PKReg.load().then(j => { const its = ((j && j.items) || []).filter(it => it.date.slice(0, 4) === year);
      reg.innerHTML = its.length ? its.map(it => `<li><span>${new Date(it.date + 'T12:00:00Z').toLocaleDateString(T('fr-FR', 'en-GB'), { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span><a href="#intel/regulation?m=${esc(it.id)}">${esc(L(it.title))}</a></li>`).join('') : `<li class="bl-note">${T('Aucun jalon recensé cette année.', 'No milestone listed this year.')}</li>`; });
  }
  // Production, supplier and residual mixes (EEX, keeper of the guarantee-of-origin registry) next to RTE's production
  // mix as PowerKlock computes it: where they differ and why
  function residual() {
    const el = document.getElementById('bl-rm'); if (!el || !RM) { if (el) el.hidden = true; return; }
    const ys = Object.keys(RM.years).sort(), y = RM.years[year] ? year : ys[ys.length - 1], E = RM.years[y], P = (D.years[y] || {}).mix_ex_ps, ex = E.eex || {};
    const rows = [['nuclear', ['Nucléaire', 'Nuclear']], ['hydro', ['Hydraulique (hors STEP)', 'Hydro (excl. pumped storage)']], ['wind', ['Éolien', 'Wind']], ['solar', ['Solaire', 'Solar']], ['bio', ['Biomasse', 'Biomass']],
      ['gas', ['Gaz', 'Gas']], ['coal', ['Charbon', 'Coal']], ['oil', ['Fioul', 'Oil']]];
    const ren = m => m ? ['hydro', 'wind', 'solar', 'bio'].reduce((a, k) => a + (m[k] || 0), 0) : null;
    const cell = (v, d = 2) => v == null ? '–' : N(v, d) + ' %';
    el.hidden = false;
    el.innerHTML = `<div class="bl-t"><h2>${T('Mix de production, de fourniture et mix résiduel', 'Production, supplier and residual mix')} ${y}</h2><a class="bl-src" href="${esc(E.file || RM.page)}" target="_blank" rel="noopener">EEX · ${T('registre des garanties d’origine', 'guarantee-of-origin registry')} ↗</a></div>
      ${y !== year ? `<p class="bl-note">${T(`EEX publie le mix d’une année en juin de l’année suivante : voici ${y}.`, `EEX publishes a year’s mix in June of the next year: here is ${y}.`)}</p>` : ''}
      <p class="bl-p">${ex.go_cancelled_twh != null ? T(`${N(ex.go_cancelled_twh, 1)} TWh de garanties d’origine annulées en France pour des offres vertes (${N(ex.go_issued_twh, 1)} TWh émises${ex.go_expired_twh != null ? ', ' + N(ex.go_expired_twh, 1) + ' TWh expirées' : ''}) : la part renouvelable passe de ${N(E.production.renewable, 1)} % dans la production à ${N(E.residual.renewable, 1)} % dans l’électricité vendue sans garantie (mix résiduel), et le nucléaire de ${N(E.production.nuclear, 1)} % à ${N(E.residual.nuclear, 1)} %.`,
        `${N(ex.go_cancelled_twh, 1)} TWh of guarantees of origin cancelled in France for green offers (${N(ex.go_issued_twh, 1)} TWh issued${ex.go_expired_twh != null ? ', ' + N(ex.go_expired_twh, 1) + ' TWh expired' : ''}): the renewable share goes from ${N(E.production.renewable, 1)} % in production to ${N(E.residual.renewable, 1)} % in electricity sold without a guarantee (residual mix), nuclear from ${N(E.production.nuclear, 1)} % to ${N(E.residual.nuclear, 1)} %.`)
        : T(`La part renouvelable passe de ${N(E.production.renewable, 1)} % dans la production à ${N(E.residual.renewable, 1)} % dans le mix résiduel.`, `The renewable share goes from ${N(E.production.renewable, 1)} % in production to ${N(E.residual.renewable, 1)} % in the residual mix.`)}</p>
      <div class="bl-rmgrid"><div style="overflow-x:auto;min-width:0"><table class="bl-tab"><thead><tr><th>${T('Filière', 'Source')}</th><th>${T('Production RTE<br>(PowerKlock)', 'RTE production<br>(PowerKlock)')}</th><th>${T('Production<br>EEX', 'EEX<br>production')}</th><th>${T('Écart', 'Gap')}</th><th>${T('Fourniture<br>EEX', 'EEX<br>supplier')}</th><th>${T('Résiduel<br>EEX', 'EEX<br>residual')}</th></tr></thead><tbody>` +
        rows.map(([k, n]) => { const a = P && P[k], b = E.production[k], g = a != null && b != null ? a - b : null;
          return `<tr><td>${L(n)}</td><td>${cell(a)}</td><td>${cell(b)}</td><td class="${g != null && Math.abs(g) > 0.3 ? 'bl-up' : ''}">${g == null ? '–' : S(g, 2, ' pt')}</td><td>${cell(E.supplier[k])}</td><td>${cell(E.residual[k])}</td></tr>`; }).join('') +
        `<tr class="bl-tot"><td>${T('Renouvelable', 'Renewable')}</td><td>${cell(ren(P), 1)}</td><td>${cell(E.production.renewable, 1)}</td><td></td><td>${cell(E.supplier.renewable, 1)}</td><td>${cell(E.residual.renewable, 1)}</td></tr>
         <tr><td>CO₂ (g/kWh)</td><td>${N((D.years[y] || {}).co2_g_kwh, 1)}</td><td>${N(E.production.co2_g_kwh, 1)}</td><td></td><td>${N(E.supplier.co2_g_kwh, 1)}</td><td>${N(E.residual.co2_g_kwh, 1)}</td></tr></tbody></table></div>
      <div class="bl-c" style="height:240px"><canvas id="bl-rmc"></canvas></div></div>
      <details class="bl-why"><summary>${T('D’où viennent les écarts entre RTE et EEX ?', 'Where do the gaps between RTE and EEX come from?')}</summary><ul>
        <li>${T('<b>Même source.</b> EEX calcule le mix de production avec les données de RTE, que PowerKlock utilise aussi.', '<b>Same source.</b> EEX computes the production mix from RTE’s data, which PowerKlock also uses.')}</li>
        <li>${T('<b>Le pompage-turbinage (STEP) est exclu par EEX</b> : c’est de l’énergie stockée, pas produite. Inclus, l’hydraulique gagnerait environ 1 point (6,7 TWh en 2025) ; hors STEP, les deux mix concordent à 0,2 point près par filière.', '<b>Pumped storage is excluded by EEX</b>: it is stored energy, not production. Included, hydro would gain about 1 point (6.7 TWh in 2025); without it the two mixes agree within 0.2 point per source.')}</li>
        <li>${T(`<b>Données définitives contre provisoires.</b> EEX part des données consolidées de RTE (${N(ex.production_twh, 1)} TWh en ${y}) ; PowerKlock somme les données quotidiennes, dont les derniers mois sont encore provisoires (${N((D.years[y] || {}).production_ex_ps, 1)} TWh hors STEP).`, `<b>Final against provisional data.</b> EEX starts from RTE’s consolidated data (${N(ex.production_twh, 1)} TWh in ${y}); PowerKlock sums the daily data, whose last months are still provisional (${N((D.years[y] || {}).production_ex_ps, 1)} TWh excluding pumped storage).`)}</li>
        <li>${T('<b>Fioul : seul écart notable restant</b> (0,15 % ici, 0,29 % chez EEX en 2025), sans doute un classement différent de quelques centrales (turbines à combustion, cogénérations au fioul). À vérifier.', '<b>Oil: the only notable gap left</b> (0.15 % here, 0.29 % at EEX in 2025), probably a different classification of a few plants (combustion turbines, oil-fired cogeneration). To be checked.')}</li>
        <li>${T('<b>Le CO₂ n’est pas calculé pareil.</b> Les volumes concordent, l’écart vient des facteurs d’émission : EEX applique des facteurs par filière (méthode européenne de l’AIB), éCO2mix des facteurs par centrale (dont la cogénération). Hypothèse à confirmer auprès d’EEX.', '<b>CO₂ is not computed the same way.</b> Volumes agree; the gap comes from the emission factors: EEX applies factors per source (the AIB’s European method), éCO2mix factors per plant (cogeneration included). A hypothesis to confirm with EEX.')}</li>
        <li>${T('<b>Mix de fourniture</b> = production corrigée des échanges physiques hors de la zone AIB et des garanties d’origine émises, expirées et annulées. <b>Mix résiduel</b> = mix de fourniture moins les garanties annulées en France pour les offres vertes, calculé du 1er avril au 31 mars suivant : c’est le mix que doivent afficher les fournisseurs pour l’électricité achetée sans garantie.', '<b>Supplier mix</b> = production corrected for physical exchanges outside the AIB area and for guarantees of origin issued, expired and cancelled. <b>Residual mix</b> = supplier mix minus guarantees cancelled in France for green offers, computed from 1 April to the next 31 March: the mix suppliers must show for electricity bought without a guarantee.')}</li></ul></details>`;
    const yy = ys.filter(k => RM.years[k].production.renewable != null);
    mk('bl-rmc', { type: 'line', data: { labels: yy, datasets: [
      { label: T('Renouvelable · production', 'Renewable · production'), data: yy.map(k => RM.years[k].production.renewable), borderColor: '#14D3A9', borderWidth: 2.2, pointRadius: 2, tension: 0 },
      { label: T('Renouvelable · mix résiduel', 'Renewable · residual mix'), data: yy.map(k => RM.years[k].residual.renewable), borderColor: '#14D3A9', borderDash: [4, 3], borderWidth: 1.6, pointRadius: 2, tension: 0 },
      { label: T('GO annulées en France (TWh)', 'GOs cancelled in France (TWh)'), type: 'bar', data: yy.map(k => (RM.years[k].eex || {}).go_cancelled_twh ?? null), backgroundColor: 'rgba(251,191,36,.35)', yAxisID: 'y1' }] },
      options: opts({ scales: { x: { ticks: { color: '#7A93AB' }, grid: { display: false } }, y: { ticks: { color: '#7A93AB' }, grid: { color: 'rgba(255,255,255,.05)' }, title: { display: true, text: '%', color: '#7A93AB' } },
        y1: { position: 'right', ticks: { color: '#FBBF24' }, grid: { display: false }, title: { display: true, text: 'TWh', color: '#FBBF24' } } } }) });
  }
  window.PKBilan = { render };
})();
