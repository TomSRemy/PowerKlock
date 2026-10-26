// ════════════════════════════════════════════════════════════════════
// FORWARD READ — why the French Cal+1 moved, in an analyst's words
// Prices › Forward (top of the Board view), France Morning (one line) and
// the dashboard catalogue (fr-fwd-read).
//   1 the move       Cal+1 France over the day / week / month, Germany alongside
//   2 fuel & carbon  daily changes of Cal+1 regressed on the change of a gas
//                    plant's cost for the same delivery year (TTF Cal ÷ 49.13 %
//                    + EUA × CCGT emissions, site-wide clean-spark convention),
//                    6 months: β × Δcost = the part that follows gas and CO₂,
//                    split into its gas and carbon parts; the rest is France
//                    specific
//   3 France         FR − DE spread, nuclear availability (forecast and
//                    actual), spot vs forward, weather outlook vs normal, EU
//                    gas storage
//   4 level & curve  Cal+1 as a share of the gas plant cost (France vs
//                    Germany), shape of the Cal curve
//   5 policy & news  articles of the period on French power policy, nuclear,
//                    gas and carbon (News page sources)
// Everything is computed from the site's data; nothing is invented when a
// series is missing (the sentence is left out).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const C = {};
  const get = (k, p) => C[k] || (C[k] = fetch(DATA_BASE + p).then(r => r.ok ? r.json() : null).catch(() => null));
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const WIN = { '1D': 1, '1W': 5, '1M': 21 };
  // French or English (the reading is built here, not translated afterwards)
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const WIN_T = { get '1D'() { return T('sur la séance', 'on the day'); }, get '1W'() { return T('sur la semaine', 'over the week'); }, get '1M'() { return T('sur le mois', 'over the month'); } };
  const f1 = v => v == null || !isFinite(v) ? '–' : v.toFixed(1), f2 = v => v == null || !isFinite(v) ? '–' : v.toFixed(2);
  const sg = (v, d) => v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d == null ? 2 : d);
  const B = s => '<b>' + s + '</b>';
  const esc = PK.esc;   // js/pk-core.js
  const day = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(T('fr-FR', 'en-GB'), { day: 'numeric', month: 'short', timeZone: 'UTC' });

  // value of a [date, value] series on or before a date
  const asOf = (pts, d) => { let v = null; for (const [x, y] of pts) { if (x > d) break; if (y != null) v = y; } return v; };
  function linreg(x, y) {
    const n = x.length; if (n < 10) return null;
    const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0; x.forEach((v, i) => { sxy += (v - mx) * (y[i] - my); sxx += (v - mx) ** 2; syy += (y[i] - my) ** 2; });
    return sxx ? { b: sxy / sxx, r2: syy ? sxy * sxy / (sxx * syy) : 0, n } : null;
  }

  async function compute(win) {
    win = WIN[win] ? win : '1W';
    const [chain, cs, news, mkt, wx, spot] = await Promise.all([get('chain', 'history/fr_market_calchain.json'), get('cs', 'history/commodities_series.json'), get('news', 'news.json'), get('mkt', 'fr_market.json'), get('wx', 'weather_outlook.json'), get('fs', 'history/fr_market_series.json')]);
    if (!chain || !chain.FR || !cs) return null;
    if (window.PKC) { try { await PKC.ready; } catch (_) { /* fallback below */ } }
    const y0 = +today().slice(0, 4), yrs = Object.keys(chain.FR.years).map(Number).sort(), k = yrs.find(y => y > y0) || yrs[0];
    const FR = chain.FR.years[k], DE = chain.DE && chain.DE.years[k];
    const ser = cs.series, eua = (ser.eua && ser.eua.points) || [], gasY = cs.calYears && cs.calYears.ttf && cs.calYears.ttf[k];
    const gasPts = gasY ? gasY.dates.map((d, i) => [d, gasY.values[i]]) : ((ser.ttf && ser.ttf.points) || []);
    // gas plant cost for the delivery year: fuel part and carbon part
    const fuelOf = g => window.PKC ? -PKC.cleanSpark(0, g, 0) : g / 0.4913;
    const co2Of = e => window.PKC ? -PKC.cleanSpark(0, 0, e) : e * 0.411;
    const dates = FR.dates, P = FR.values;
    const rows = dates.map((d, i) => { const g = asOf(gasPts, d), e = asOf(eua, d);
      return { d, p: P[i], de: DE ? DE.values[DE.dates.indexOf(d)] : null, fuel: g != null ? fuelOf(g) : null, co2: e != null ? co2Of(e) : null, g, e }; })
      .filter(r => r.p != null);
    if (rows.length < 30) return null;
    rows.forEach(r => { r.cost = r.fuel != null && r.co2 != null ? r.fuel + r.co2 : null; });
    // pass-through of the gas plant cost, 6 months of daily changes
    const last = rows.length - 1, from = Math.max(1, last - 126), dx = [], dy = [];
    for (let i = from; i <= last; i++) { const a = rows[i - 1], b = rows[i]; if (a.cost != null && b.cost != null) { dx.push(b.cost - a.cost); dy.push(b.p - a.p); } }
    const reg = linreg(dx, dy), beta = reg ? Math.max(0, Math.min(1.2, reg.b)) : null;
    let regDE = null;
    if (DE) { const ex = [], ey = []; for (let i = from; i <= last; i++) { const a = rows[i - 1], b = rows[i]; if (a.cost != null && b.cost != null && a.de != null && b.de != null) { ex.push(b.cost - a.cost); ey.push(b.de - a.de); } } regDE = linreg(ex, ey); }
    const n = WIN[win], A = rows[Math.max(0, last - n)], Z = rows[last];
    const dP = Z.p - A.p, dDE = Z.de != null && A.de != null ? Z.de - A.de : null;
    const dFuel = Z.fuel != null && A.fuel != null ? Z.fuel - A.fuel : null, dCo2 = Z.co2 != null && A.co2 != null ? Z.co2 - A.co2 : null;
    const fromFuel = beta != null && dFuel != null ? beta * dFuel : null, fromCo2 = beta != null && dCo2 != null ? beta * dCo2 : null;
    const resid = fromFuel != null && fromCo2 != null ? dP - fromFuel - fromCo2 : null;
    // France specific
    const nucFc = (ser.fr_nuc_avail_fc && ser.fr_nuc_avail_fc.points) || [], nucAc = (ser.fr_nuc_avail && ser.fr_nuc_avail.points) || [];
    const nfZ = asOf(nucFc, Z.d), nfA = asOf(nucFc, A.d), naZ = nucAc.length ? nucAc[nucAc.length - 1] : null;
    const agsi = (ser.agsi && ser.agsi.points) || [], gsZ = agsi.length ? agsi[agsi.length - 1] : null;
    const gsLY = gsZ ? asOf(agsi, (+gsZ[0].slice(0, 4) - 1) + gsZ[0].slice(4)) : null;
    let spot5 = null;
    if (spot && spot.dates && spot.spot) { const v = []; for (let i = spot.dates.length - 1; i >= 0 && v.length < 5; i--) if (spot.spot[i] != null) v.push(spot.spot[i]); if (v.length) spot5 = v.reduce((a, b) => a + b, 0) / v.length; }
    let wxAnom = null;
    const wf = wx && wx.countries && wx.countries.FR && wx.countries.FR.series && wx.countries.FR.series.temp;
    if (wf && wf.days) { const t = wx.today, a = []; wf.days.forEach((d, i) => { if (d > t && wf.mean[i] != null && wf.normal[i] != null && a.length < 14) a.push(wf.mean[i] - wf.normal[i]); }); if (a.length >= 5) wxAnom = a.reduce((x, y) => x + y, 0) / a.length; }
    // curve
    const curve = yrs.map(y => { const s = chain.FR.years[y]; return { y, v: s.values[s.values.length - 1] }; });
    // policy & news of the period
    // France: power policy, nuclear, grid, regulator; Europe: gas and carbon market moves
    const FR_RX = /(France|French|EDF|RTE\b|CRE\b|Flamanville|ARENH|VNU|PPE|TURPE|électri|nucléaire|réacteur|tarif|prix de l)/i;
    const TOPIC = /(nucl|réacteur|reactor|électri|electric|power|price|prix|tarif|capacit|grid|réseau|PPA|renouvel|renewable|gas|gaz)/i;
    const MKT = /(\bEUAs?\b|\bETS\b|\bMSR\b|carbon (market|price)|\bTTF\b|gas price|\bLNG\b|GNL|gas storage|stockage de gaz|power price|electricity price|interconnect)/i;
    const since = new Date(A.d + 'T00:00:00Z').getTime() - (n === 1 ? 864e5 : 0);
    const items = ((news && news.items) || []).filter(it => { if (Date.parse(it.date) < since) return false; const t = it.title || '';
      const fr = (it.tags || []).includes('fr') || FR_RX.test(t); return (fr && TOPIC.test(t)) || MKT.test(t); })
      .map(it => Object.assign({ fr: (it.tags || []).includes('fr') || FR_RX.test(it.title) }, it))
      .sort((a, b) => (b.fr ? 1 : 0) - (a.fr ? 1 : 0) || Date.parse(b.date) - Date.parse(a.date)).slice(0, 6);
    return { win, k, A, Z, dP, dDE, beta, reg, regDE, dFuel, dCo2, fromFuel, fromCo2, resid, nfZ, nfA, naZ, gsZ, gsLY, spot5, wxAnom, curve, items, rows };
  }

  function html(o) {
    if (!o) return `<div class="fuel-note">${T('Données forwards indisponibles.', 'Forward data not available.')}</div>`;
    const { k, A, Z, dP, win } = o, W = WIN_T[win], up = dP >= 0;
    const P = [];
    // 1 · the move
    P.push(`<p>${B('Cal ' + k + ' France')} ${T('a clôturé à', 'settled at')} ${B(f2(Z.p) + ' €/MWh')} ${T('le', 'on')} ${day(Z.d)}, ${B(sg(dP) + ' €')} ${W} (${sg(dP / A.p * 100, 1)} %)` +
      (o.dDE != null ? `; ${T('Allemagne', 'Germany')} ${sg(o.dDE)} € ${T('à', 'to')} ${f2(Z.de)}, ${T('la France', 'so France')} ${Math.abs(dP - o.dDE) < 0.5 ? T('garde sa décote', 'kept its discount') : dP - o.dDE > 0 ? T('fait mieux que l’Allemagne de ', 'outperformed Germany by ') + f2(dP - o.dDE) + ' €' : T('fait moins bien que l’Allemagne de ', 'underperformed Germany by ') + f2(o.dDE - dP) + ' €'} (FR − DE ${sg(Z.p - Z.de)} €).` : '.') + '</p>');
    // 2 · fuel and carbon
    if (o.beta != null && o.fromFuel != null) {
      const fc = o.fromFuel + o.fromCo2, share = Math.abs(dP) >= 1 && fc * dP > 0 ? fc / dP * 100 : null;
      P.push(`<p>${B(T('Combustibles et carbone.', 'Fuel and carbon.'))} ${T(`Le coût d’une centrale gaz pour ${k} (TTF Cal ${k} et EUA) a bougé de ${sg(o.dFuel + o.dCo2)} € (gaz ${sg(o.dFuel)}, CO₂ ${sg(o.dCo2)}). Sur six mois, le Cal ${k} France a suivi ${B(Math.round(o.beta * 100) + ' %')} des variations quotidiennes de ce coût (R² ${o.reg.r2.toFixed(2)}`, `The cost of a gas plant for ${k} (TTF Cal ${k} and EUA) moved ${sg(o.dFuel + o.dCo2)} € (gas ${sg(o.dFuel)}, CO₂ ${sg(o.dCo2)}). Over six months French Cal ${k} has followed ${B(Math.round(o.beta * 100) + ' %')} of that cost’s daily moves (R² ${o.reg.r2.toFixed(2)}`)}` +
        (o.regDE ? `; ${T('Allemagne', 'Germany')} ${Math.round(Math.max(0, o.regDE.b) * 100)} %` : '') + `), ` + (fc * dP < 0 && Math.abs(dP) >= 0.3
          ? T(`donc le gaz et le carbone seuls l’auraient fait bouger de ${B(sg(fc) + ' €')} : des facteurs propres à la France l’ont tiré dans l’autre sens de ${B(sg(o.resid) + ' €')}.`, `so gas and carbon alone would have moved it by ${B(sg(fc) + ' €')}: France-specific factors pulled it the other way by ${B(sg(o.resid) + ' €')}.`)
          : T(`donc ${B(sg(fc) + ' €')} du mouvement vient du gaz et du carbone${share != null && share <= 150 ? ` (${Math.round(share)} %)` : ''} et ${B(sg(o.resid) + ' €')} est propre à la France.`, `so ${B(sg(fc) + ' €')} of the move comes from gas and carbon${share != null && share <= 150 ? ` (${Math.round(share)} % of it)` : ''} and ${B(sg(o.resid) + ' €')} is France-specific.`)) +
        (o.beta < 0.4 ? T(' Une faible transmission est typique de la France : le nucléaire et l’hydraulique fixent le prix la plupart des heures, le gaz seulement à la marge des pointes d’hiver.', ' A low pass-through is typical of France: nuclear and hydro set the price most hours, gas only at the margin of winter peaks.') : o.beta <= 0.7 ? T(' Une transmission moyenne : le marché voit le gaz fixer le prix français une partie des heures (pointes d’hiver, nucléaire bas, exports élevés), moins qu’en Allemagne où gaz et charbon le fixent la plupart du temps.', ' A moderate pass-through: the market sees gas setting the French price in part of the hours (winter peaks, low nuclear output, high exports), less than in Germany where gas and coal plants set it most of the time.') : T(' Une forte transmission : le marché traite la France presque comme un marché fixé par le gaz, typiquement quand le nucléaire manque ou que les exports vers les voisins sont élevés.', ' A high pass-through: the market prices France almost like a gas-set market, typically when nuclear output is short or exports to neighbours are high.')) + '</p>');
    }
    // 3 · France
    const fr = [];
    if (o.nfZ != null) fr.push(T(`prévision de disponibilité nucléaire ${B(f1(o.nfZ / 1000) + ' GW')}`, `nuclear availability forecast ${B(f1(o.nfZ / 1000) + ' GW')}`) + (o.nfA != null && Math.abs(o.nfZ - o.nfA) > 200 ? ` (${sg((o.nfZ - o.nfA) / 1000, 1)} GW ${W} : ${o.nfZ > o.nfA ? T('plus de production attendue, baissier', 'more output expected, bearish') : T('moins de production attendue, haussier', 'less output expected, bullish')})` : T(', inchangée', ', unchanged')) + (o.naZ ? `, ${f1(o.naZ[1] / 1000)} GW ${T('disponibles le', 'available on')} ${day(o.naZ[0])}` : ''));
    if (o.spot5 != null) fr.push(T(`spot moyen ${B(f1(o.spot5) + ' €/MWh')} sur les cinq derniers jours, ${o.spot5 > Z.p ? f1(o.spot5 - Z.p) + ' € au-dessus' : f1(Z.p - o.spot5) + ' € sous'} le Cal ${k}`, `spot averaged ${B(f1(o.spot5) + ' €/MWh')} over the last five days, ${o.spot5 > Z.p ? f1(o.spot5 - Z.p) + ' € above' : f1(Z.p - o.spot5) + ' € below'} Cal ${k}`) + (o.spot5 > Z.p * 1.15 ? T(' : un court terme tendu pousse l’avant de la courbe', ': a tight prompt keeps pressure on the front of the curve') : o.spot5 < Z.p * 0.85 ? T(' : un court terme détendu pèse sur la courbe', ': a soft prompt weighs on the curve') : ''));
    if (o.wxAnom != null) fr.push(T(`les deux prochaines semaines sont prévues à ${B(sg(o.wxAnom, 1) + ' °C')} vs normale (${o.wxAnom < -1 ? 'plus froid : chauffage, haussier pour l’avant de la courbe' : o.wxAnom > 1 ? 'plus doux : moins de chauffage, baissier pour l’avant de la courbe' : 'proche de la normale'})`, `the next two weeks are forecast ${B(sg(o.wxAnom, 1) + ' °C')} vs normal (${o.wxAnom < -1 ? 'colder: heating demand, bullish for the front' : o.wxAnom > 1 ? 'milder: less heating demand, bearish for the front' : 'close to normal'})`));
    if (o.gsZ) fr.push(T(`stocks de gaz UE remplis à ${B(f1(o.gsZ[1]) + ' %')}`, `EU gas storage ${B(f1(o.gsZ[1]) + ' %')} full`) + (o.gsLY != null ? ` (${sg(o.gsZ[1] - o.gsLY, 1)} ${T('pts vs il y a un an', 'pts vs a year ago')})` : ''));
    if (fr.length) P.push(`<p>${B(T('La France et ses fondamentaux.', 'France and the fundamentals.'))} ${fr.map((s, i) => i ? s : s.charAt(0).toUpperCase() + s.slice(1)).join('; ')}.</p>`);
    // 4 · level and curve
    const lv = [];
    if (Z.cost != null) lv.push(T(`le Cal ${k} cote ${B(Math.round(Z.p / Z.cost * 100) + ' %')} du coût d’une centrale gaz ${k} (${f1(Z.cost)} €)`, `Cal ${k} trades at ${B(Math.round(Z.p / Z.cost * 100) + ' %')} of the ${k} gas plant cost (${f1(Z.cost)} €)`) + (Z.de != null ? T(` contre ${Math.round(Z.de / Z.cost * 100)} % pour l’Allemagne`, ` against ${Math.round(Z.de / Z.cost * 100)} % for Germany`) : '') + T(' : l’écart est la valeur que le marché donne au nucléaire et à l’hydraulique français', ': the gap is the value the market gives to French nuclear and hydro'));
    if (o.curve.length > 1) lv.push(T('la courbe : ', 'the curve reads ') + o.curve.map(c => 'Cal ' + c.y + ' ' + f1(c.v)).join(', ') + (o.curve[0].v > o.curve[o.curve.length - 1].v * 1.1 ? T(' — en déport : le court terme porte le risque gaz et d’approvisionnement, les années suivantes intègrent plus de nucléaire et de renouvelables', ' — backwardated: the near term carries the gas and supply risk, later years price more nuclear output and renewables') : o.curve[0].v < o.curve[o.curve.length - 1].v * 0.9 ? T(' — en report : le marché attend des années plus tendues', ' — in contango: the market expects tighter years ahead') : T(' — plutôt plate', ' — fairly flat')));
    if (lv.length) P.push(`<p>${B(T('Niveau et courbe.', 'Level and curve.'))} ${lv.map((s, i) => i ? s : s.charAt(0).toUpperCase() + s.slice(1)).join('; ')}.</p>`);
    // 5 · policy and news
    if (o.items.length) P.push(`<p>${B(T('Politique et actualité ', 'Policy and news ') + W + '.')}</p><ul class="fr-read-news">` + o.items.map(it => `<li><a href="${/^https?:\/\//.test(it.link) ? esc(it.link) : '#'}" target="_blank" rel="noopener">${esc(it.title)}</a> <span>${esc(it.source)} · ${day(it.date.slice(0, 10))}</span></li>`).join('') + '</ul>');
    else P.push(`<p class="fuel-note">${T('Aucune actualité politique ou de marché sur l’électricité, le nucléaire, le gaz ou le carbone français dans les sources ', 'No policy or market news on French power, nuclear, gas or carbon in the News sources ')}${W}.</p>`);
    return P.join('');
  }

  // one line for France Morning
  function line(o) {
    if (!o) return '';
    return `<b>Cal ${o.k} FR</b> ${f2(o.Z.p)} €/MWh, ${sg(o.dP)} € over the week` + (o.fromFuel != null ? `: ${sg(o.fromFuel + o.fromCo2)} € from gas and CO₂ (pass-through ${Math.round(o.beta * 100)} %), ${sg(o.resid)} € France-specific` : '') +
      (o.dDE != null ? `; Germany ${sg(o.dDE)} €` : '') + '. <a href="#" onclick="showPage(\'prices\');prSelectSubdomain(\'forward\');return false">Full read</a>';
  }

  async function render(hostId, win) {
    const host = document.getElementById(hostId); if (!host) return;
    host.innerHTML = '<div class="fuel-note">Reading the market…</div>';
    try { host.innerHTML = html(await compute(win)); } catch (e) { console.warn('[fwd-read]', e); host.innerHTML = '<div class="fuel-note">Forward read unavailable.</div>'; }
  }
  window.PKFwdRead = { compute, html, line, render };

  if (window.PKW) PKW.register({
    id: 'fr-fwd-read', kind: 'html', title: 'Cal+1 France · analyst read', category: 'forwards', page: 'prices', source: 'Market data · News',
    desc: 'Why the French Cal+1 moved: part explained by gas and carbon, France-specific part, nuclear, spot, weather, gas storage, level vs the gas plant cost, policy news.',
    params: [{ key: 'win', label: 'Period', options: [['1D', 'Day'], ['1W', 'Week'], ['1M', 'Month']] }], defaults: { win: '1W' }, size: { w: 6, h: 7 },
    async html(el, p) { el.classList.add('fr-read'); el.innerHTML = html(await compute(p.win)); },
  });

  // Prices › Forward: period pills and first render when the page opens
  function wire() {
    const pills = document.getElementById('fr-read-win'); if (!pills || pills.dataset.wired) return;
    pills.dataset.wired = '1';
    pills.addEventListener('click', e => { const b = e.target.closest('button[data-w]'); if (!b) return; pills.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); render('fr-read', b.dataset.w); });
    render('fr-read', '1W');
  }
  window.addEventListener('load', () => setTimeout(() => {
    const sub = window.prSelectSubdomain;
    if (typeof sub === 'function') window.prSelectSubdomain = function (d) { const r = sub.apply(this, arguments); if (d === 'forward') wire(); return r; };
    const panel = document.querySelector('[data-subdomain-panel="forward"]');
    if (panel && panel.offsetParent) wire();
  }, 0));

  const css = document.createElement('style');
  css.textContent = `
  .fr-read { font-size: 12.5px; line-height: 1.65; color: var(--text2); max-width: 1100px; }
  .fr-read p { margin: 0 0 9px; }
  .fr-read b { color: var(--text); }
  .fr-read-news { margin: 0 0 6px 16px; padding: 0; }
  .fr-read-news li { margin-bottom: 4px; }
  .fr-read-news a { color: var(--text); text-decoration: none; } .fr-read-news a:hover { color: var(--accent); text-decoration: underline; }
  .fr-read-news span { color: var(--text3); font-size: 11px; }
  `;
  document.head.appendChild(css);
})();
