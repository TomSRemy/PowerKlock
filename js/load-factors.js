// ════════════════════════════════════════════════════════════════════
// MEASURED LOAD FACTORS (Tools › Converter, and a dashboard table)
//   Countries: output ÷ installed capacity, year by year.
//     output   data/history/genmix_daily/YYYY.json (Energy-Charts public power, daily average MW)
//     capacity data/history/capacity.json (Energy-Charts installed power, GW at year end):
//              the year's capacity = mean of the year-end before and the year-end of the year,
//              so a fleet that grows fast (solar) is not divided by capacity built in December.
//   French regions: RTE éCO2mix regional consolidated data (ODRÉ), the published load factor
//     (TCH, % of the installed capacity) averaged over each year.
//   A click on a figure puts it in the converter's "Load factor" box.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fr = () => !window.PKI18n || PKI18n.lang !== 'en';
  const T = (f, e) => fr() ? f : e;
  const num = (v, d) => v == null ? '–' : (fr() ? v.toFixed(d).replace('.', ',') : v.toFixed(d));
  const ZONES = [['FR', 'FR', 'France', 'France'], ['DE_LU', 'DE', 'Allemagne', 'Germany'], ['BE', 'BE', 'Belgique', 'Belgium'], ['NL', 'NL', 'Pays-Bas', 'Netherlands'],
    ['ES', 'ES', 'Espagne', 'Spain'], ['PT', 'PT', 'Portugal', 'Portugal'], ['AT', 'AT', 'Autriche', 'Austria'], ['CH', 'CH', 'Suisse', 'Switzerland'],
    ['PL', 'PL', 'Pologne', 'Poland'], ['CZ', 'CZ', 'Tchéquie', 'Czechia']];
  // technology → genmix fuel and the Energy-Charts capacity types behind it
  const TECH = [
    ['solar', 'Solaire', 'Solar', ['Solar AC'], ['Solar DC']],
    ['wind', 'Éolien', 'Wind', ['Wind onshore', 'Wind offshore']],
    ['nuclear', 'Nucléaire', 'Nuclear', ['Nuclear']],
    ['hydro', 'Hydraulique', 'Hydro', ['Hydro Run-of-River', 'Hydro water reservoir', 'Hydro pumped storage', 'Hydro', 'Hydro pumped storage (w/o natural inflow)']],
    ['fossil', 'Fossile', 'Fossil', ['Fossil gas', 'Fossil hard coal', 'Fossil brown coal / lignite', 'Fossil oil', 'Fossil coal-derived gas', 'Conventional-thermal']],
  ];
  const getJSON = p => fetch(DATA_BASE + p).then(r => r.ok ? r.json() : null).catch(() => null);
  let CP = null;
  // {years: [y…], v: {zone: {tech: {y: lf}}}} for the last complete years
  function countries() {
    if (CP) return CP;
    const last = new Date().getFullYear() - 1, ys = [last - 2, last - 1, last];
    return (CP = Promise.all([getJSON('history/capacity.json')].concat(ys.map(y => getJSON('history/genmix_daily/' + y + '.json')))).then(([cap, ...gm]) => {
      if (!cap || !cap.countries) return null;
      const v = {};
      ZONES.forEach(([z, cc]) => {
        const C = cap.countries[cc]; if (!C) return;
        v[z] = {};
        TECH.forEach(([t, , , types, alt]) => {
          const capAt = y => { const i = C.years.indexOf(y); if (i < 0) return null;
            let s = 0, any = false; (types.some(k => C.types[k]) ? types : alt || []).forEach(k => { const a = C.types[k]; if (a && a[i] != null) { s += a[i]; any = true; } });
            return any ? s : null; };
          v[z][t] = {};
          ys.forEach((y, k) => {
            const doc = gm[k], zd = doc && doc.zones && doc.zones[z]; if (!zd || !zd[t]) return;
            const vals = zd[t].filter(x => x != null); if (vals.length < 330) return;     // full years only
            const c1 = capAt(y), c0 = capAt(y - 1), c = c1 != null && c0 != null ? (c0 + c1) / 2 : c1;
            // a fleet opening or closing during the year (German nuclear 2023) gives no meaningful factor
            if (c1 == null || c1 < 0.05 || (c0 != null && c0 < 0.05)) return;
            const lf = vals.reduce((a, b) => a + b, 0) / vals.length / (c * 1000) * 100;
            if (lf >= 1 && lf < 100) v[z][t][y] = lf;   // < 1 %: output not in the public series (Dutch rooftop solar)
          });
        });
      });
      return { years: ys, v };
    }));
  }
  let RP = null;
  // {years, v: {region: {wind: {y: lf}, solar: {y: lf}}}} from the consolidated regional éCO2mix
  function regions() {
    if (RP) return RP;
    const last = new Date().getFullYear() - 1, ys = [last - 2, last - 1, last];
    const url = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-regional-cons-def/records?' + [
      ['select', 'libelle_region, year(date_heure) as y, avg(tch_eolien) as w, avg(tch_solaire) as s, count(tch_solaire) as n'],
      ['group_by', 'libelle_region, year(date_heure)'], ['where', `date_heure >= "${ys[0]}-01-01" and date_heure < "${last + 1}-01-01"`], ['limit', '100']]
      .map(([k, x]) => k + '=' + encodeURIComponent(x)).join('&');
    return (RP = fetch(url).then(r => r.ok ? r.json() : null).then(j => {
      if (!j || !j.results) return null;
      const v = {};
      j.results.forEach(r => { const y = r.y != null ? r.y : r['year(date_heure)']; if (!ys.includes(y) || r.n < 16000) return;
        const o = v[r.libelle_region] = v[r.libelle_region] || { wind: {}, solar: {} };
        if (r.w != null) o.wind[y] = r.w; if (r.s != null) o.solar[y] = r.s; });
      return Object.keys(v).length ? { years: ys, v } : null;
    }).catch(() => null));
  }
  const pick = (byY, ys, per) => { if (!byY) return null; if (per === 'last') return byY[ys[ys.length - 1]] != null ? byY[ys[ys.length - 1]] : null;
    const a = ys.map(y => byY[y]).filter(x => x != null); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };

  // the table: rows = countries or regions, columns = technologies; cells clickable when `use` is given
  async function table(host, scope, per, use) {
    host.innerHTML = '<div class="fuel-note">' + T('Calcul…', 'Computing…') + '</div>';
    const D = scope === 'region' ? await regions() : await countries();
    if (!D) { host.innerHTML = '<div class="fuel-note">' + (scope === 'region' ? T('Données régionales RTE (ODRÉ) injoignables.', 'RTE regional data (ODRÉ) not reachable.') : T('Pas de données.', 'No data.')) + '</div>'; return null; }
    const ys = D.years, perTxt = per === 'last' ? String(ys[ys.length - 1]) : ys[0] + '–' + ys[ys.length - 1];
    const techs = scope === 'region' ? TECH.filter(t => t[0] === 'solar' || t[0] === 'wind') : TECH;
    const rows = scope === 'region' ? Object.keys(D.v).sort((a, b) => a.localeCompare(b, 'fr')).map(r => [r, r]) : ZONES.filter(z => D.v[z[0]]).map(z => [z[0], fr() ? z[2] : z[3]]);
    const cell = (k, name, t) => { const v = pick(D.v[k][t[0]], ys, per); if (v == null) return '<td>–</td>';
      const lbl = name + ' · ' + (fr() ? t[1] : t[2]) + ' · ' + perTxt;
      return `<td${use ? ` class="lf-cell" tabindex="0" data-lf="${v.toFixed(1)}" data-lbl="${lbl.replace(/"/g, '&quot;')}" title="${T('Utiliser ce facteur de charge', 'Use this load factor')}"` : ''}>${num(v, 1)} %</td>`; };
    host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table lf-table"><thead><tr><th style="text-align:left">${scope === 'region' ? T('Région', 'Region') : T('Pays', 'Country')}</th>${techs.map(t => `<th>${fr() ? t[1] : t[2]}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(([k, name]) => `<tr><td style="text-align:left">${name}</td>${techs.map(t => cell(k, name, t)).join('')}</tr>`).join('') + '</tbody></table></div>';
    if (use) host.querySelectorAll('.lf-cell').forEach(c => { const go = () => use(+c.dataset.lf, c.dataset.lbl); c.addEventListener('click', go); c.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); });
    return perTxt;
  }
  const NOTE = scope => scope === 'region'
    ? T('Facteur de charge publié par RTE pour chaque région (production ÷ puissance installée), moyenne des quarts d’heure de l’année, données consolidées (ODRÉ).',
        'Load factor published by RTE for each region (output ÷ installed capacity), mean of the year’s quarter-hours, consolidated data (ODRÉ).')
    : T('Production de l’année ÷ puissance installée (moyenne des fins d’année avant et après), Energy-Charts. Années complètes seulement. Hydraulique : avec le pompage-turbinage, dont la production dépend des pompages ; fossile : gaz, charbon, lignite, fioul.',
        'The year’s output ÷ installed capacity (mean of the year-ends before and after), Energy-Charts. Full years only. Hydro includes pumped storage, whose output depends on pumping; fossil: gas, hard coal, lignite, oil.');

  // ── converter page ──
  function page() {
    const host = $('lf-table'); if (!host || host.dataset.wired) return; host.dataset.wired = '1';
    const sc = $('lf-scope'), pe = $('lf-period');
    const use = (lf, lbl) => {
      const box = $('cap-lf'); if (!box) return;
      box.value = lf; if (typeof updateCapacity === 'function') updateCapacity();
      document.querySelectorAll('#page-converter .day-tab').forEach(b => b.classList.remove('active'));
      const u = $('lf-used'); if (u) u.textContent = T('Facteur de charge utilisé : ', 'Load factor in use: ') + lbl + ' — ' + num(lf, 1) + ' %';
      const s = $('cap-lf-auto'); if (s) { const o = [...s.options].find(x => x.dataset.lbl === lbl); s.selectedIndex = o ? o.index : 0; }
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const draw = () => { table(host, sc.value, pe.value, use); const n = $('lf-note'); if (n) n.textContent = NOTE(sc.value); fill(); };
    sc.addEventListener('change', draw); pe.addEventListener('change', draw);
    // the measured factors in a list under the box: France wind picked by default, any typed value or rule of thumb
    // switches it back to manual entry
    const sel = $('cap-lf-auto'), box = $('cap-lf');
    let first = true;
    async function fill() {
      if (!sel) return;
      const C = await countries();
      render(C, null);
      const R = await regions();
      if (R) render(C, R);
    }
    function render(C, R) {
      const per = pe.value, cur = sel.options[sel.selectedIndex], keep = cur && cur.value ? cur.dataset.lbl : null;
      const opt = (lf, lbl, text) => `<option value="${lf.toFixed(1)}" data-lbl="${lbl.replace(/"/g, '&quot;')}">${text} — ${num(lf, 1)} %</option>`;
      let html = `<option value="">${T('Saisie libre', 'Manual entry')}</option>`;
      if (C) {
        const pt = per === 'last' ? String(C.years[C.years.length - 1]) : C.years[0] + '–' + C.years[C.years.length - 1];
        ZONES.filter(z => C.v[z[0]]).forEach(z => {
          const name = fr() ? z[2] : z[3];
          const o = TECH.map(t => { const v = pick(C.v[z[0]][t[0]], C.years, per); return v == null ? '' : opt(v, name + ' · ' + (fr() ? t[1] : t[2]) + ' · ' + pt, name + ' · ' + (fr() ? t[1] : t[2])); }).join('');
          if (o) html += `<optgroup label="${name} · ${pt}">${o}</optgroup>`;
        });
      }
      if (R) {
        const pt = per === 'last' ? String(R.years[R.years.length - 1]) : R.years[0] + '–' + R.years[R.years.length - 1];
        TECH.filter(t => t[0] === 'wind' || t[0] === 'solar').forEach(t => {
          const o = Object.keys(R.v).sort((a, b) => a.localeCompare(b, 'fr')).map(r => { const v = pick(R.v[r][t[0]], R.years, per); return v == null ? '' : opt(v, r + ' · ' + (fr() ? t[1] : t[2]) + ' · ' + pt, r); }).join('');
          if (o) html += `<optgroup label="${T('Régions françaises', 'French regions')} · ${fr() ? t[1] : t[2]} · ${pt}">${o}</optgroup>`;
        });
      }
      sel.innerHTML = html;
      if (first && C) {
        first = false;
        const fw = [...sel.options].find(o => (o.dataset.lbl || '').startsWith((fr() ? 'France · Éolien' : 'France · Wind')));
        if (fw) { sel.value = fw.value; sel.selectedIndex = fw.index; choose(); return; }
      }
      // the same choice kept when the list is redrawn (the period changes the figures, so the label is matched without it)
      const base = l => (l || '').split(' · ').slice(0, 2).join(' · ');
      const again = keep ? [...sel.options].find(o => o.value && base(o.dataset.lbl) === base(keep)) : null;
      sel.selectedIndex = again ? again.index : 0;
      if (again && again.value !== box.value) choose();
    }
    function choose() {
      const o = sel.options[sel.selectedIndex]; if (!o || !o.value) return;
      box.value = o.value; if (typeof updateCapacity === 'function') updateCapacity();
      document.querySelectorAll('#page-converter .day-tab').forEach(b => b.classList.remove('active'));
      const u = $('lf-used'); if (u) u.textContent = T('Facteur de charge utilisé : ', 'Load factor in use: ') + o.dataset.lbl + ' — ' + num(+o.value, 1) + ' %';
    }
    if (sel) {
      sel.addEventListener('change', choose);
      box.addEventListener('input', () => { sel.selectedIndex = 0; const u = $('lf-used'); if (u) u.textContent = ''; });
      document.querySelectorAll('#page-converter .day-tab').forEach(b => b.addEventListener('click', () => { sel.selectedIndex = 0; const u = $('lf-used'); if (u) u.textContent = ''; }));
    }
    draw();
  }
  document.addEventListener('pk-view', e => { if (e.detail && e.detail.key === 'converter') setTimeout(page, 50); });
  window.addEventListener('load', () => setTimeout(() => { const p = $('page-converter'); if (p && p.classList.contains('active')) page();
    const mo = p && new MutationObserver(() => { if (p.classList.contains('active')) page(); }); if (mo) mo.observe(p, { attributes: true, attributeFilter: ['class'] }); }, 300));

  // ── dashboard table ──
  if (window.PKW) PKW.register({ id: 'load-factors', kind: 'html', title: 'Measured load factors', category: 'renewables', page: 'converter', source: 'Energy-Charts · RTE (ODRÉ)', size: { w: 6, h: 6 },
    desc: 'Load factor (output ÷ installed capacity) by country and technology, or of each French region for wind and solar: last full year or 3-year average.',
    params: [{ key: 'scope', label: 'Scope', options: [['country', 'Countries'], ['region', 'French regions']] }, { key: 'per', label: 'Period', options: [['avg3', '3-year average'], ['last', 'Last full year']] }],
    defaults: { scope: 'country', per: 'avg3' },
    async html(host, p) { const per = await table(host, (p && p.scope) || 'country', (p && p.per) || 'avg3', null); if (per) host.insertAdjacentHTML('beforeend', '<div class="fuel-note">' + per + ' · ' + NOTE((p && p.scope) || 'country') + '</div>'); } });
  window.PKLoadFactors = { countries, regions };
})();
