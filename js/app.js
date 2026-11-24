// app.js · PowerKlock on a phone: a light app inside the site (the owner's wish, 24 Nov. 2026: no store, an installable
// web app). It opens at #app (and on its own when launched from the home screen: manifest start_url) with a bottom bar of
// five tabs: Today (the morning brief, prices, tomorrow hour by hour, the next days, what moved), Grid (live mix with a
// CO₂ estimate, consumption against its forecast, cross-border flows, Europe's prices: inspired by Electricity Maps and
// RTE's éCO2mix), News (lead story, essentials, live feed, official texts, Ask), Dashboards and Alerts; the account opens
// from the avatar. It reads the same data files as the site; « Full version » leaves the app layout for the whole site.
// Every figure names its source; the CO₂ intensity is an estimate from the generation mix (factors in Methodology).
(function () {
  'use strict';
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const en = () => window.PKI18n && PKI18n.lang === 'en';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const H = document.documentElement;
  const BASE = () => (typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : 'data/');
  const nf = (v, d = 1) => v == null || isNaN(v) ? '–' : Number(v).toLocaleString(en() ? 'en-GB' : 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const paris = (off = 0) => { const d = new Date(Date.now() + off * 864e5); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d); };
  const dayName = (iso, long) => new Date(iso + 'T12:00:00Z').toLocaleDateString(en() ? 'en-GB' : 'fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const C = {};
  const get = p => C[p] || (C[p] = fetch(BASE() + p + (p.includes('?') ? '' : '?t=' + Math.floor(Date.now() / 3e5))).then(r => r.ok ? r.json() : null).catch(() => null));
  const fresh = () => Object.keys(C).forEach(k => delete C[k]);
  const signed = () => !!(window.PKAccount && PKAccount.user);
  const approved = () => signed() && !H.classList.contains('pk-public');

  // ── the app's frame ──
  const TABS = [
    ['today', T('Aujourd’hui', 'Today'), '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
    ['grid', T('Réseau', 'Grid'), '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'],
    ['news', T('Veille', 'News'), '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'],
    ['boards', T('Tableaux', 'Boards'), '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
    ['alerts', T('Alertes', 'Alerts'), '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'],
  ];
  let root = null, cur = 'today';
  const tabOf = () => { const m = location.hash.match(/^#app\/?([a-z]*)/); return m && m[1] && (TABS.some(t => t[0] === m[1]) || m[1] === 'me') ? m[1] : null; };
  function frame() {
    if (root) return root;
    root = document.createElement('div'); root.id = 'pk-app'; root.setAttribute('translate', 'no');
    root.innerHTML = `<header class="pa-top"><img src="assets/logo-header.png" alt="PowerKlock" class="pa-logo"><span class="pa-sp"></span><span class="pa-up" id="pa-up"></span>
        <button type="button" class="pa-av" id="pa-av" aria-label="${T('Compte', 'Account')}"></button></header>
      <main class="pa-main" id="pa-main"></main>
      <nav class="pa-tabs" role="tablist">${TABS.map(([k, l, ic]) => `<button type="button" role="tab" data-t="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic}</svg><span>${l}</span>${k === 'alerts' ? '<b class="pa-badge" id="pa-badge" hidden></b>' : ''}</button>`).join('')}</nav>`;
    document.body.appendChild(root);
    root.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => go(b.dataset.t)));
    root.querySelector('#pa-av').addEventListener('click', () => go('me'));
    // pull to refresh: the screen at its top, a pull of 70 px
    const main = root.querySelector('#pa-main'); let y0 = null;
    main.addEventListener('touchstart', e => { y0 = main.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    main.addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 70) { fresh(); draw(); } y0 = null; }, { passive: true });
    return root;
  }
  function av() { const b = root && root.querySelector('#pa-av'); if (!b) return; const m = signed() ? (PKAccount.user.email || '') : ''; b.textContent = m ? (m.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase() : '•'; b.classList.toggle('pa-guest', !m); }
  function go(t) { if (location.hash !== '#app/' + t) location.hash = '#app/' + t; else show(t); }
  function show(t) {
    frame(); cur = t; av();
    root.querySelectorAll('[data-t]').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    draw();
  }
  function enter() {
    H.classList.add('pk-app');
    if (!tabOf()) { history.replaceState(null, '', location.pathname + location.search + '#app/' + (localStorage.getItem('pk-app-start') || 'today')); }
    show(tabOf() || 'today');
  }
  function leave() { H.classList.remove('pk-app'); }
  function route() { if (/^#app(\/|$)/.test(location.hash)) enter(); else { leave(); backBtn(); } }
  // installed app on a page of the full site: a button back to the app
  function backBtn() {
    let b = document.getElementById('pa-back');
    if (!standalone() || /^#app/.test(location.hash)) { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('button'); b.id = 'pa-back'; b.type = 'button'; b.className = 'pa-back'; b.textContent = '‹ ' + T('Retour à l’app', 'Back to the app');
    b.addEventListener('click', () => go(cur || 'today')); document.body.appendChild(b);
  }

  // ── pieces ──
  const sec = (title, body, cls = '') => body ? `<section class="pa-sec ${cls}">${title ? `<h3 class="pa-k">${title}</h3>` : ''}${body}</section>` : '';
  const src = s => `<p class="pa-src">${s}</p>`;
  const arrow = (c, invert) => { if (c == null || !c) return ''; const up = c > 0; return `<i class="${(invert ? !up : up) ? 'up' : 'dn'}">${up ? '▲' : '▼'}</i>`; };
  const full = (hash, label) => `<a class="pa-full" href="${hash}" data-full>${label} ↗</a>`;
  const signIn = what => `<div class="pa-card pa-empty"><b>${T('Réservé aux membres', 'For members')}</b><p>${what}</p><div class="pa-row2"><button type="button" class="pa-btn" data-auth="in">${T('Se connecter', 'Sign in')}</button><button type="button" class="pa-btn pa-ghost" data-auth="up">${T('Créer un compte', 'Create an account')}</button></div></div>`;
  function bars(vals, lo) { const v = vals.filter(x => x != null), mx = Math.max(...v), mn = Math.min(...v, 0);
    return `<div class="pa-bars">${vals.map(x => `<i class="${x != null && x <= lo ? 'lo' : ''}${x != null && x < 0 ? ' neg' : ''}" style="height:${x == null ? 0 : 8 + 92 * (x - mn) / ((mx - mn) || 1)}%"></i>`).join('')}</div>`; }
  function line(series, colors, h = 120) { // series: arrays of equal length (null gaps)
    const all = series.flat().filter(x => x != null); if (!all.length) return '';
    const mx = Math.max(...all) * 1.02, mn = Math.min(...all) * 0.97, n = Math.max(...series.map(s => s.length));
    const pts = s => s.map((v, i) => v == null ? null : `${(i * 300 / (n - 1)).toFixed(1)},${(h - (v - mn) / ((mx - mn) || 1) * (h - 6)).toFixed(1)}`);
    return `<svg class="pa-line" viewBox="0 0 300 ${h}" preserveAspectRatio="none">${series.map((s, k) => { const p = pts(s); const segs = []; let c = []; p.forEach(x => { if (x) c.push(x); else if (c.length) { segs.push(c); c = []; } }); if (c.length) segs.push(c);
      return segs.map(sg => `<polyline fill="none" stroke="${colors[k]}" stroke-width="2.2"${k ? ' stroke-dasharray="4 3" stroke-opacity=".75"' : ''} points="${sg.join(' ')}"/>`).join(''); }).join('')}</svg>`;
  }
  const axis = () => `<div class="pa-axis"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>24 h</span></div>`;
  const hourly = arr => { if (!Array.isArray(arr) || !arr.length) return []; const per = arr.length / 24; if (per <= 1) return arr.slice(0, 24); const out = []; for (let i = 0; i < 24; i++) { const v = arr.slice(i * per, (i + 1) * per).filter(x => x != null); out.push(v.length ? v.reduce((a, b) => a + b, 0) / v.length : null); } return out; };

  // ── Today ──
  async function today() {
    const [E, tmr, tdy, neg, wx, pp, md] = await Promise.all([get('newsletter.json'), get('history/daily/' + paris(1) + '.json'), get('history/daily/' + paris() + '.json'), get('neg_forecast.json'), get('weather_outlook.json'), get('rte_pp.json'), get('market_digest.json')]);
    const out = [`<h2 class="pa-h">${T('Aujourd’hui', 'Today')}</h2><div class="pa-date">${dayName(paris(), true)}</div>`];
    const brief = E && ((en() && E.brief_en) || E.brief);
    if (brief) out.push(`<div class="pa-card pa-brief"><b>${T('Le point du matin.', 'The morning brief.')}</b> ${esc(String(brief).split(/\n\s*\n/)[0])}</div>`);
    const M = (E && E.markets) || [];
    if (M.length) out.push(sec(T('Les prix', 'Prices'), `<div class="pa-tiles">${M.map(r => { const c = r.chg || 0, h = r.hours;
      const ch = h ? (r.chg == null ? '' : !c ? T('stable', 'unchanged') : (c > 0 ? '+' : '−') + nf(Math.abs(c), 0) + ' h') : r.show === 'abs' ? (r.chg == null ? '' : (c > 0 ? '+' : '−') + nf(Math.abs(c), 1) + ' €') : r.pct == null ? '' : (c > 0 ? '+' : c < 0 ? '−' : '') + nf(Math.abs(r.pct), 1) + ' %';
      const dir = !c ? 'flat' : (h ? c < 0 : c > 0) ? 'up' : 'down';
      return `<a class="pa-tile pa-${dir}" href="#${esc(r.page || 'today')}" data-full><span>${esc(en() ? r.label[1] : r.label[0])}</span><b>${nf(r.value, h ? 0 : 2)}${h ? ' h' : ''}</b><small>${h ? '' : esc(r.unit)} ${arrow(c, h)} ${ch}</small></a>`; }).join('')}</div>${src(T('Sources : ', 'Sources: ') + esc([...new Set(M.map(r => r.src).filter(Boolean))].join(', ')) + '. ' + T('Variation sur la séance précédente.', 'Change on the previous session.'))}`));
    // tomorrow (or today when tomorrow is not out yet), hour by hour
    const fr = (tmr && tmr.zones && tmr.zones.FR) ? [paris(1), tmr.zones.FR] : (tdy && tdy.zones && tdy.zones.FR) ? [paris(), tdy.zones.FR] : null;
    if (fr && Array.isArray(fr[1].hourly)) { const hs = hourly(fr[1].hourly), v = hs.filter(x => x != null), mn = Math.min(...v), mx = Math.max(...v), lo = [...v].sort((a, b) => a - b)[Math.floor(v.length / 4)];
      out.push(sec(fr[0] === paris(1) ? T('Demain heure par heure', 'Tomorrow hour by hour') : T('Aujourd’hui heure par heure', 'Today hour by hour'),
        `<div class="pa-card"><div class="pa-ch"><span>${T('Spot France', 'France spot')} · ${dayName(fr[0])}</span><b>${nf(fr[1].avg, 2)} €/MWh</b></div>${bars(hs, lo)}${axis()}
        <p class="pa-note">${T('Moins cher', 'Cheapest')} ${hs.indexOf(mn)} h (${nf(mn, 0)} €) · ${T('plus cher', 'dearest')} ${hs.indexOf(mx)} h (${nf(mx, 0)} €)${fr[1].negHours ? ' · ' + nf(fr[1].negHours, 2) + ' h ' + T('négatives', 'negative') : ''}</p></div>${src('ENTSO-E · ' + T('moyenne publiée du jour', 'published daily average'))}`)); }
    // the last 7 delivery days: the published daily average (data/history/daily/<D>.json › avg)
    const back = await Promise.all([...Array(7)].map((_, i) => get('history/daily/' + paris(-6 + i) + '.json').then(j => [paris(-6 + i), j && j.zones && j.zones.FR ? j.zones.FR.avg : null])));
    if (back.filter(x => x[1] != null).length >= 3) { const v = back.map(x => x[1]), ok = v.filter(x => x != null), d0 = ok[0], d1 = ok[ok.length - 1], ch = d1 - d0;
      out.push(sec(T('Les 7 derniers jours', 'The last 7 days'), `<div class="pa-card"><div class="pa-ch"><span>${T('Spot France, moyenne du jour', 'France spot, daily average')}</span><b class="${ch > 0 ? 'up' : 'dn'}">${ch > 0 ? '+' : '−'}${nf(Math.abs(ch), 0)} € ${T('sur la semaine', 'over the week')}</b></div>
        ${line([v], ['#14D3A9'], 90)}<div class="pa-axis">${back.filter((_, i) => i % 2 === 0).map(x => `<span>${esc(dayName(x[0]))}</span>`).join('')}</div></div>${src('ENTSO-E · ' + T('moyenne publiée du jour', 'published daily average'))}`)); }
    // the next days: PowerKlock's price forecast and the risk of negative hours (data/neg_forecast.json)
    const ND = neg && neg.days ? Object.keys(neg.days).filter(d => d > (fr ? fr[0] : paris())).sort().slice(0, 5) : [];
    if (ND.length) out.push(sec(T('Les prochains jours', 'The next days'), `<div class="pa-days">${ND.map(d => { const p = neg.days[d].price || [], m = p.length ? p.reduce((a, b) => a + b, 0) / p.length : null;
      return `<div><small>${esc(dayName(d))}</small><b>${nf(m, 0)}</b><span>${neg.days[d].expected_hours ? nf(neg.days[d].expected_hours, 1) + ' h < 0' : '€/MWh'}</span></div>`; }).join('')}</div>${src(T('Prévision PowerKlock du spot France, moyenne du jour (fourchette dans la vue Expert).', 'PowerKlock forecast of the France spot, daily average (range in the Expert view).'))}`));
    // signals: negative hours this week, cold or mild, nuclear, peak days
    const tiles = [];
    const nd = neg && neg.days ? Object.keys(neg.days).filter(d => d >= paris()).sort() : [];
    if (nd.length) { const eh = nd.reduce((a, d) => a + (neg.days[d].expected_hours || 0), 0); tiles.push([T('Heures négatives attendues', 'Expected negative hours'), nf(eh, 1) + ' h', eh >= 1 ? T('épisodes possibles', 'episodes possible') : T('risque faible', 'low risk'), eh >= 1 ? 'dn' : '']);
      const na = neg.days[nd[0]].nuclear_available; if (na) tiles.push([T('Nucléaire disponible', 'Nuclear available'), nf(na / 1000, 1) + ' GW', dayName(nd[0]), '']); }
    const W = wx && wx.countries && wx.countries.FR && wx.countries.FR.series && wx.countries.FR.series.temp;
    if (W && W.days) { const k = W.days.map((d, i) => d >= paris() && W.mean[i] != null && W.normal[i] != null ? W.mean[i] - W.normal[i] : null).filter(x => x != null).slice(0, 14);
      if (k.length) { const a = k.reduce((x, y) => x + y, 0) / k.length; tiles.push([T('Températures, 2 semaines', 'Temperatures, 2 weeks'), (a > 0 ? '+' : '−') + nf(Math.abs(a), 1) + ' °C', a < -0.5 ? T('plus froid que la normale', 'colder than normal') : a > 0.5 ? T('plus doux que la normale', 'milder than normal') : T('proche de la normale', 'close to normal'), a < -0.5 ? 'up' : a > 0.5 ? 'dn' : '']); } }
    const P = pp && pp.days ? Object.keys(pp.days).filter(d => d >= paris() && (pp.days[d].pp1 || pp.days[d].pp2)).sort() : [];
    if (P.length) tiles.push([T('Jour de pointe RTE', 'RTE peak day'), pp.days[P[0]].pp1 ? 'PP1' : 'PP2', dayName(P[0]), 'up']);
    if (tiles.length) out.push(sec(T('À surveiller', 'To watch'), `<div class="pa-tiles">${tiles.map(([l, v, s, c]) => `<div class="pa-tile pa-${c === 'up' ? 'up' : c === 'dn' ? 'down' : 'flat'}"><span>${l}</span><b>${v}</b><small class="${c}">${esc(s)}</small></div>`).join('')}</div>${src(T('Prévisions PowerKlock (prix, heures négatives, nucléaire), Open-Meteo (températures), RTE (jours de pointe).', 'PowerKlock forecasts (prices, negative hours, nuclear), Open-Meteo (temperatures), RTE (peak days).'))}`));
    // what moved and why (data/market_digest.json, the analyst notes of the Expert view)
    const ctx = md && md.context || [];
    if (ctx.length) out.push(sec(T('Ce qui a bougé et pourquoi', 'What moved and why'), `<div class="pa-card pa-why">${ctx.slice(0, 5).map(c => `<div><span class="${c.tone === 'up' ? 'up' : c.tone === 'down' ? 'dn' : ''}">${c.tone === 'up' ? '▲' : c.tone === 'down' ? '▼' : '•'}</span><p><b>${esc(en() ? c.topic_en || c.topic : c.topic)}</b> ${esc(en() ? c.text_en || c.text : c.text)}</p></div>`).join('')}</div>${src(T('Lectures d’analyste rédigées automatiquement à partir des données du site', 'Analyst reads written automatically from the site’s data') + (md.asof ? ' · ' + esc(dayName(md.asof)) : ''))}`));
    out.push(full('#today?v=2', T('Vue Expert complète', 'Full Expert view')));
    return out.join('');
  }

  // ── Grid: live mix, CO₂, consumption, flows, Europe's prices ──
  // the mix's CO₂ intensity, renewable and low-carbon shares: the factors and colours of the site's Generation mix page
  // (js/genmix.js › GM_FUEL_META), so both give the same figure (Methodology)
  const META = () => window.GM_FUEL_META || { nuclear: { co2: 12, color: '#9B6BC4' }, wind: { co2: 11, color: '#14D3A9' }, solar: { co2: 45, color: '#FBBF24' }, hydro: { co2: 24, color: '#5CB2F5' }, biomass: { co2: 230, color: '#4E8A2C' }, fossil: { co2: 650, color: '#ED6965' }, other: { co2: 400, color: '#8D99AE' } };
  const FUEL = [['nuclear', T('Nucléaire', 'Nuclear')], ['hydro', T('Hydraulique', 'Hydro')], ['wind', T('Éolien', 'Wind')], ['solar', T('Solaire', 'Solar')], ['fossil', T('Fossile (gaz, charbon, fioul)', 'Fossil (gas, coal, oil)')], ['biomass', T('Biomasse', 'Biomass')], ['other', T('Autres', 'Other')]]
    .map(([k, l]) => [k, l, (META()[k] || {}).color || '#8D99AE']);
  const ZN = { FR: ['🇫🇷', 'France', 'France'], DE_LU: ['🇩🇪', 'Allemagne', 'Germany'], ES: ['🇪🇸', 'Espagne', 'Spain'], BE: ['🇧🇪', 'Belgique', 'Belgium'], NL: ['🇳🇱', 'Pays-Bas', 'Netherlands'], GB: ['🇬🇧', 'Grande-Bretagne', 'Great Britain'], PT: ['🇵🇹', 'Portugal', 'Portugal'],
    IT_NORD: ['🇮🇹', 'Italie Nord', 'Italy North'], CH: ['🇨🇭', 'Suisse', 'Switzerland'], AT: ['🇦🇹', 'Autriche', 'Austria'], DK_W: ['🇩🇰', 'Danemark Ouest', 'Denmark West'], DK_E: ['🇩🇰', 'Danemark Est', 'Denmark East'],
    PL: ['🇵🇱', 'Pologne', 'Poland'], CZ: ['🇨🇿', 'Tchéquie', 'Czechia'], NO_2: ['🇳🇴', 'Norvège Sud', 'Norway South'], SE_4: ['🇸🇪', 'Suède Sud', 'Sweden South'], LU: ['🇱🇺', 'Luxembourg', 'Luxembourg'], IE_SEM: ['🇮🇪', 'Irlande', 'Ireland'] };
  let zone = 'FR', rng = 'now';
  // the mix day by day (data/history/genmix_daily/<year>.json: daily mean MW by fuel), as stacked bars, with the low-carbon share
  async function mixHistory() {
    const y = +paris().slice(0, 4), need = rng === '1y' ? [y - 1, y] : [y];
    const files = await Promise.all(need.map(k => get('history/genmix_daily/' + k + '.json')));
    const days = [], rows = {};
    files.forEach(f => { const z = f && f.zones && f.zones[zone]; if (!z) return; z.days.forEach((d, i) => { days.push(d); FUEL.forEach(([k]) => { (rows[k] = rows[k] || []).push((z[k] || [])[i]); }); }); });
    if (!days.length) return '';
    const n = rng === '1y' ? 365 : 30, from = Math.max(0, days.length - n);
    let D = days.slice(from), R = {}; FUEL.forEach(([k]) => { R[k] = (rows[k] || []).slice(from); });
    if (rng === '1y') {   // a year: weekly means
      const W = [], WR = {}; FUEL.forEach(([k]) => { WR[k] = []; });
      for (let i = 0; i < D.length; i += 7) { W.push(D[i]); FUEL.forEach(([k]) => { const v = R[k].slice(i, i + 7).filter(x => x != null); WR[k].push(v.length ? v.reduce((a, b) => a + b, 0) / v.length : null); }); }
      D = W; R = WR;
    }
    const tot = D.map((_, i) => FUEL.reduce((a, [k]) => a + (R[k][i] || 0), 0)), mx = Math.max(...tot) || 1, w = 300 / D.length;
    const bars = D.map((_, i) => { let y0 = 120; return FUEL.map(([k, , col]) => { const h = (R[k][i] || 0) / mx * 116; y0 -= h; return h > 0 ? `<rect x="${(i * w).toFixed(2)}" y="${y0.toFixed(1)}" width="${Math.max(0.6, w - 0.6).toFixed(2)}" height="${h.toFixed(1)}" fill="${col}"/>` : ''; }).join(''); }).join('');
    const low = D.map((_, i) => tot[i] ? ((R.nuclear[i] || 0) + (R.hydro[i] || 0) + (R.wind[i] || 0) + (R.solar[i] || 0) + (R.biomass[i] || 0)) / tot[i] * 100 : null);
    const lv = low.filter(x => x != null), avg = lv.reduce((a, b) => a + b, 0) / (lv.length || 1);
    return sec(rng === '1y' ? T('Production, 12 derniers mois (moyennes hebdomadaires)', 'Generation, last 12 months (weekly means)') : T('Production, 30 derniers jours', 'Generation, last 30 days'),
      `<div class="pa-card"><div class="pa-ch"><span>${T('Part bas-carbone moyenne', 'Average low-carbon share')}</span><b>${nf(avg, 0)} %</b></div>
      <svg class="pa-line" viewBox="0 0 300 120" preserveAspectRatio="none">${bars}</svg><div class="pa-axis"><span>${esc(dayName(D[0]))}</span><span>${esc(dayName(D[D.length - 1]))}</span></div>
      <div class="pa-lg pa-lgw">${FUEL.map(([k, l, col]) => `<span><i style="background:${col}"></i>${l}</span>`).join('')}</div></div>${src('ENTSO-E · ' + T('moyenne du jour, MW', 'daily mean, MW'))}`);
  }
  function co2(m) { const M = META(); let e = 0, t = 0;
    FUEL.forEach(([k]) => { const x = m[k] || 0; if (x > 0) { e += x * ((M[k] || {}).co2 || 0); t += x; } });
    if (!t) return null; const ren = (m.wind || 0) + (m.solar || 0) + (m.hydro || 0) + (m.biomass || 0);
    return { g: e / t, ren: ren / t, low: (ren + (m.nuclear || 0)) / t }; }
  async function grid() {
    const [g, ld, fc, xb, pr] = await Promise.all([get('genmix.json'), get('load.json'), get('forecast.json'), get('crossborder.json'), get('prices.json')]);
    if (!approved()) return `<h2 class="pa-h">${T('Réseau', 'Grid')}</h2>` + signIn(T('Le réseau en direct : production par filière, intensité CO₂, consommation, échanges et prix en Europe.', 'The grid live: generation by fuel, CO₂ intensity, consumption, flows and prices across Europe.'));
    const Z = {}; Object.entries((g && g.countries) || {}).forEach(([k, v]) => { if (v && v.total > 0) Z[k] = v; }); if (!Z[zone]) zone = Object.keys(Z)[0] || 'FR';
    const m = Z[zone] || {}, tot = m.total || FUEL.reduce((a, [k]) => a + (m[k] || 0), 0), c = co2(m);
    const upd = g && g.updated ? new Date(g.updated).toLocaleTimeString(en() ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '';
    const X = (xb && xb.countries && xb.countries[zone]) || [], net = X.reduce((a, x) => a + (x.net || 0), 0);
    const out = [`<h2 class="pa-h">${T('Réseau', 'Grid')}</h2><div class="pa-date">${T('en direct', 'live')}${upd ? ' · ' + T('mise à jour', 'updated') + ' ' + upd : ''}</div>`,
      `<div class="pa-zones">${Object.keys(Z).map(k => `<button type="button" data-z="${k}" class="${k === zone ? 'on' : ''}">${(ZN[k] || ['', k])[0]} ${k.slice(0, 2)}</button>`).join('')}</div>`,
      `<div class="pa-seg">${[['now', T('Maintenant', 'Now')], ['30d', T('30 jours', '30 days')], ['1y', T('12 mois', '12 months')]].map(([k, l]) => `<button type="button" data-rng="${k}" class="${k === rng ? 'on' : ''}">${l}</button>`).join('')}</div>`];
    if (rng !== 'now') { out.push(await mixHistory() || `<p class="pa-note">${T('Pas d’historique pour cette zone.', 'No history for this zone.')}</p>`); out.push(full('#genmix', T('Toutes les données du système électrique', 'All the power system data'))); return out.join(''); }
    const pct = c ? Math.round(c.g / 8) : 0;   // the ring: 0 to 800 g
    out.push(`<div class="pa-card pa-gauge"><div class="pa-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--border2)" stroke-width="12"/>${c ? `<circle cx="60" cy="60" r="50" fill="none" stroke="${c.g < 100 ? '#14D3A9' : c.g < 300 ? '#E7B25C' : '#ED6965'}" stroke-width="12" stroke-dasharray="${Math.min(100, pct) * 3.14} 314" transform="rotate(-90 60 60)" stroke-linecap="round"/>` : ''}</svg>
      <div><b>${c ? nf(c.g, 0) : '–'}</b><small>gCO₂/kWh</small></div></div>
      <div class="pa-gk"><div><b>${c ? nf(c.low * 100, 0) + ' %' : '–'}</b><small>${T('bas-carbone', 'low-carbon')}</small></div><div><b>${c ? nf(c.ren * 100, 0) + ' %' : '–'}</b><small>${T('renouvelable', 'renewable')}</small></div>
      <div><b>${nf(tot / 1000, 1)} GW</b><small>${T('production', 'generation')}</small></div>${X.length ? `<div><b class="${net < 0 ? 'dn' : 'up'}">${nf(Math.abs(net) / 1000, 1)} GW</b><small>${net < 0 ? T('exportés', 'exported') : T('importés', 'imported')}</small></div>` : ''}</div></div>
      ${src(c ? T('Intensité CO₂ estimée à partir du mix, mêmes facteurs que la page Mix de production (Méthodologie).', 'CO₂ intensity estimated from the mix, same factors as the Generation mix page (Methodology).') : T('Détail par filière indisponible pour cette zone : pas d’estimation CO₂.', 'No breakdown by fuel for this zone: no CO₂ estimate.'))}`);
    if (tot) out.push(sec(T('Production en ce moment', 'Generation now'), `<div class="pa-stack">${FUEL.map(([k, , col]) => m[k] > 0 ? `<i style="width:${(m[k] / tot * 100).toFixed(2)}%;background:${col}"></i>` : '').join('')}</div>
      <div class="pa-card pa-list">${FUEL.filter(([k]) => m[k] > 0).sort((a, b) => m[b[0]] - m[a[0]]).map(([k, l, col]) => `<div><span class="pa-sq" style="background:${col}"></span><b>${l}</b><span class="pa-mono">${nf(m[k] / 1000, 1)} GW</span><span class="pa-pc">${nf(m[k] / tot * 100, 0)} %</span></div>`).join('')}</div>${src('ENTSO-E · ' + T('dernière heure publiée', 'latest hour published'))}`));
    // consumption: today's forecast (data/forecast.json) and, for France, what was measured (data/load.json)
    const fz = fc && fc.zones && fc.zones[zone], fd = fz && fz.days && fz.days[paris()];
    if (fd && fd.load) { const f = hourly(fd.load), L = ld && ld.countries && ld.countries[zone], a = L && Array.isArray(L.actual) ? hourly(L.actual) : [];
      const pk = Math.max(...f.filter(x => x != null)), ph = f.indexOf(pk);
      out.push(sec(T('Consommation · réalisé et prévision', 'Consumption · actual and forecast'), `<div class="pa-card"><div class="pa-ch"><span>${(ZN[zone] || ['', zone, zone])[en() ? 2 : 1]} · ${dayName(paris())}</span><b>${T('pic', 'peak')} ${nf(pk / 1000, 1)} GW ${T('à', 'at')} ${ph} h</b></div>
        ${line([a.length ? a : [], f], ['#14D3A9', '#6CB4F5'])}${axis()}<div class="pa-lg">${a.some(x => x != null) ? `<span><i style="background:#14D3A9"></i>${T('Réalisé', 'Actual')}</span>` : ''}<span><i style="background:#6CB4F5"></i>${T('Prévision du jour', 'Day forecast')}</span></div></div>${src('ENTSO-E')}`)); }
    if (X.length) out.push(sec(T('Échanges aux frontières', 'Cross-border flows'), `<div class="pa-card pa-list">${X.slice().sort((p, q) => Math.abs(q.net) - Math.abs(p.net)).map(x => { const [code, name] = String(x.partner).split(' · ');
      return `<div><b>${(ZN[code] || [''])[0]} ${esc(ZN[code] ? ZN[code][en() ? 2 : 1] : name || code)}</b><span class="pa-mono ${x.net < 0 ? 'dn' : 'im'}">${x.net < 0 ? '→ export' : '← import'} ${nf(Math.abs(x.net) / 1000, 1)} GW</span></div>`; }).join('')}</div>${src('ENTSO-E · ' + T('flux physiques, dernière heure', 'physical flows, latest hour'))}`));
    // Europe's day-ahead prices, the latest delivery day (data/prices.json)
    const PZ = pr && pr.zones ? pr.zones.filter(z => z.today != null).sort((a, b) => b.today - a.today) : [];
    if (PZ.length) { const mx = PZ[0].today, mn = PZ[PZ.length - 1].today;
      out.push(sec(T('Les prix en Europe', 'Prices across Europe'), `<div class="pa-eu">${PZ.map(z => { const t = (z.today - mn) / ((mx - mn) || 1);
        return `<div style="--t:${t.toFixed(2)}"><span>${esc(window.PKI18n && PKI18n.tr ? PKI18n.tr(z.name) : z.name)}</span><b>${nf(z.today, 0)}</b></div>`; }).join('')}</div>${src(T('Spot base du dernier jour de livraison publié, €/MWh · ENTSO-E', 'Baseload spot of the latest delivery day, €/MWh · ENTSO-E'))}`)); }
    out.push(full('#genmix', T('Toutes les données du système électrique', 'All the power system data')));
    return out.join('');
  }

  // ── News ──
  let nv = 'une', pendingPost = null;
  async function news() {
    if (!approved()) return `<h2 class="pa-h">${T('Veille', 'News')}</h2>` + signIn(T('L’actualité des marchés de l’électricité choisie pour vous, les textes officiels et les réponses de PowerKlock à vos questions.', 'Power market news chosen for you, official texts and PowerKlock’s answers to your questions.'));
    const [E, dg, N] = await Promise.all([get('newsletter.json'), get('news_digest.json'), get('news.json')]);
    if (typeof _nlMe !== 'undefined' && _nlMe === undefined && typeof _nlLoadMe === 'function') { try { await _nlLoadMe(); } catch (_) {} }
    const items = (N && N.items) || [], mine = E && typeof _nlMine === 'function' ? _nlMine(E) : null;
    const left = await askLeft();
    const out = [`<h2 class="pa-h">${T('Veille', 'News')}</h2><div class="pa-date">${mine && (mine.interests || []).length ? T('selon vos ' + mine.interests.length + ' sujets', 'from your ' + mine.interests.length + ' subjects') : T('édition générale', 'general edition')}</div>`,
      `<button type="button" class="pa-ask" id="pa-ask">✦ ${T('Posez une question à PowerKlock…', 'Ask PowerKlock a question…')}${left != null ? `<span>${left} / 30</span>` : ''}</button>`,
      `<div class="pa-seg">${[['une', T('À la une', 'Top')], ['live', T('En continu', 'Live')], ['off', T('Textes officiels', 'Official texts')], ['posts', T('Posts LinkedIn', 'LinkedIn posts')]].map(([k, l]) => `<button type="button" data-nv="${k}" class="${k === nv ? 'on' : ''}">${l}</button>`).join('')}</div>`];
    const a = (u, t) => `<a href="${esc(/^https?:\/\//.test(u || '') ? u : '#')}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`;
    const when = d => { const h = (Date.now() - new Date(d)) / 36e5; return h < 1 ? T('à l’instant', 'just now') : h < 24 ? T('il y a ' + Math.round(h) + ' h', Math.round(h) + ' h ago') : dayName(String(d).slice(0, 10)); };
    if (nv === 'une') {
      const S = (mine && mine.stories) || [], L = S[0];
      if (L) out.push(`<article class="pa-card pa-lead"><div class="pa-th">${T('À la une', 'Lead story')}</div><h3>${a(L.link, L.title)}</h3>${typeof _newsKeep === 'function' && _newsKeep(L, en()) ? `<p><b>${T('À retenir.', 'Takeaway.')}</b> ${esc(_newsKeep(L, en()))}</p>` : ''}<div class="pa-src">${esc((L.sources || []).slice(0, 3).join(' · '))}</div></article>`);
      const D = (dg && dg.daily && dg.daily.items) || [];
      if (D.length) out.push(sec(T('L’essentiel du jour', 'Today’s essentials'), `<ol class="pa-ol">${D.map(x => `<li>${a(x.link, (en() && x.text_en) || x.text || x.title)}<small>${esc((x.sources || []).slice(0, 2).join(' · '))}</small></li>`).join('')}</ol>`));
      if (S.length > 1) out.push(sec(T('Vos sujets', 'Your subjects'), `<div class="pa-feed">${S.slice(1).map(x => `<div>${a(x.link, x.title)}<small>${esc((x.sources || []).slice(0, 2).join(' · '))}</small></div>`).join('')}</div>`));
    } else if (nv === 'posts') {
      // the team's LinkedIn posts (public.news_post, as News › LinkedIn posts): link, author, note; a post shared from
      // LinkedIn to PowerKlock (share sheet) lands in the form below
      let P = []; try { const { data } = await PKAccount.client().from('news_post').select('id, url, author, note, created_at').order('created_at', { ascending: false }).limit(40); P = data || []; } catch (_) {}
      out.push(`<div class="pa-card pa-post"><b>${T('Ajouter un post LinkedIn', 'Add a LinkedIn post')}</b><input type="url" id="pa-post-url" class="pa-in" maxlength="600" value="${esc(pendingPost || '')}" placeholder="${T('Lien du post (Partager › Copier le lien)', 'Post link (Share › Copy link)')}">
        <input type="text" id="pa-post-note" class="pa-in" maxlength="300" placeholder="${T('Pourquoi le lire (facultatif)', 'Why read it (optional)')}"><button type="button" class="pa-btn pa-wide" id="pa-post-add">${T('Ajouter', 'Add')}</button><p class="pa-note" id="pa-post-msg">${pendingPost ? T('Post reçu de LinkedIn : ajoutez une note si vous voulez, puis « Ajouter ».', 'Post received from LinkedIn: add a note if you like, then « Add ».') : T('Depuis l’app LinkedIn : Partager › PowerKlock (Android, app installée) ; ou copiez le lien ici.', 'From the LinkedIn app: Share › PowerKlock (Android, installed app); or paste the link here.')}</p></div>`);
      out.push(P.length ? `<div class="pa-feed">${P.map(x => `<div>${a(x.url, x.author || 'LinkedIn')}${x.note ? `<p class="pa-pn">${esc(x.note)}</p>` : ''}<small>${esc(when(x.created_at))}</small></div>`).join('')}</div>` : `<p class="pa-note">${T('Aucun post pour l’instant.', 'No post yet.')}</p>`);
    } else {
      const off = nv === 'off', L = items.filter(i => off ? (i.tags || []).includes('official') : !(i.tags || []).includes('official') && !(i.tags || []).includes('research')).sort((p, q) => String(q.date).localeCompare(String(p.date))).slice(0, 40);
      out.push(L.length ? `<div class="pa-feed">${L.map(i => `<div>${a(i.link, i.title)}<small>${esc(i.source)} · ${esc(when(i.date))}</small></div>`).join('')}</div>` : `<p class="pa-note">${T('Rien pour l’instant.', 'Nothing yet.')}</p>`);
    }
    out.push(full('#intel/news', T('Toute la Veille', 'All the News')));
    return out.join('');
  }
  async function askLeft() { try { const { data } = await PKAccount.client().rpc('ask_left'); return data && data.ok ? data.left : null; } catch (_) { return null; } }

  // ── Dashboards ──
  async function boards() {
    if (!signed()) return `<h2 class="pa-h">${T('Mes tableaux', 'My boards')}</h2>` + signIn(T('Vos propres pages de graphiques, enregistrées sur votre compte et retrouvées sur chaque appareil.', 'Your own pages of charts, saved to your account and found on every device.'));
    const B = window.PKDash && PKDash.boards ? PKDash.boards() : [];
    return `<h2 class="pa-h">${T('Mes tableaux', 'My boards')}</h2><div class="pa-date">${B.length} ${T(B.length > 1 ? 'tableaux' : 'tableau', B.length > 1 ? 'boards' : 'board')}</div>
      <div class="pa-card pa-list pa-boards">${B.map(b => `<button type="button" data-board="${esc(b.id)}"><b>${esc(b.name)}</b><span>${b.n} ${T('widgets', 'widgets')} ›</span></button>`).join('') || `<p class="pa-note">${T('Aucun tableau pour l’instant.', 'No board yet.')}</p>`}</div>
      <p class="pa-note">${T('Un tableau s’ouvre en pleine page, un graphique par ligne. Ajoutez des graphiques depuis n’importe quelle page avec ☆.', 'A board opens full page, one chart per row. Add charts from any page with ☆.')}</p>${full('#dashboards', T('Gérer mes tableaux', 'Manage my boards'))}`;
  }

  // ── Alerts ──
  async function alerts() {
    if (!signed()) return `<h2 class="pa-h">${T('Alertes', 'Alerts')}</h2>` + signIn(T('Un e-mail ou une notification dès que le marché franchit un seuil : prix négatifs, Cal, jours de pointe…', 'An e-mail or a notification when the market crosses a level: negative prices, Cal, peak days…'));
    const A = window.PKAlerts, hits = A && A.hits ? A.hits() : [], rules = A && A.rules ? A.rules() : [];
    const push = window.PKPush ? await PKPush.state() : null;
    const out = [`<h2 class="pa-h">${T('Alertes', 'Alerts')}</h2><div class="pa-date">${T('aujourd’hui et demain', 'today and tomorrow')}</div>`];
    if (push && push.supported) out.push(`<div class="pa-card pa-notif"><div><b>${T('Notifications sur cet appareil', 'Notifications on this device')}</b><small>${push.on ? T('Activées : vos alertes arrivent ici, en plus de l’e-mail.', 'On: your alerts come here, as well as by e-mail.') : push.blocked ? T('Bloquées dans les réglages du téléphone pour ce site.', 'Blocked in the phone’s settings for this site.') : T('Recevez vos alertes ici, en plus de l’e-mail.', 'Get your alerts here, as well as by e-mail.')}</small></div><button type="button" class="pa-sw${push.on ? ' on' : ''}" id="pa-push" role="switch" aria-checked="${!!push.on}"${push.blocked ? ' disabled' : ''}></button></div>`);
    else if (push && push.iosHint) out.push(`<div class="pa-card pa-notif"><div><b>${T('Notifications', 'Notifications')}</b><small>${T('Sur iPhone, ajoutez d’abord PowerKlock à l’écran d’accueil (Partager › Sur l’écran d’accueil), puis ouvrez-le depuis son icône.', 'On iPhone, first add PowerKlock to the home screen (Share › Add to Home Screen), then open it from its icon.')}</small></div></div>`);
    out.push(sec(T('Déclenchées', 'Triggered'), hits.length ? hits.map(h => `<div class="pa-card pa-hit"><span class="pa-dot ${esc(h.kind)}"></span><div><b>${esc(A.label(h.kind))}</b><small>${esc(h.text)}</small></div></div>`).join('') : `<p class="pa-note">${T('Rien de déclenché pour aujourd’hui et demain.', 'Nothing triggered for today and tomorrow.')}</p>`));
    out.push(sec(T('Mes alertes', 'My alerts'), rules.length ? `<div class="pa-card pa-list">${rules.map(r => `<div class="pa-rule"><div class="pa-rt">${A.text(r)}</div><button type="button" class="pa-sw${r.active === false ? '' : ' on'}" data-rule="${esc(r.id)}" role="switch" aria-checked="${r.active !== false}"></button></div>`).join('')}</div>` : `<p class="pa-note">${T('Aucune alerte pour l’instant.', 'No alert yet.')}</p>`));
    out.push(`<button type="button" class="pa-btn pa-wide" id="pa-newal">+ ${T('Nouvelle alerte', 'New alert')}</button>`);
    return out.join('');
  }

  // ── Account ──
  async function me() {
    if (!signed()) return `<h2 class="pa-h">${T('Compte', 'Account')}</h2>` + signIn(T('Connectez-vous pour vos sujets, votre newsletter, vos alertes et vos tableaux.', 'Sign in for your subjects, newsletter, alerts and boards.')) + full('#today', T('Version complète du site', 'Full version of the site'));
    const mail = PKAccount.user.email || '', ini = (mail.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase();
    const st = localStorage.getItem('pk-app-start') || 'today';
    const li = (act, b, s) => `<button type="button" class="pa-li" data-act="${act}"><span><b>${b}</b>${s ? `<small>${s}</small>` : ''}</span><i>${act === 'full' ? '↗' : '›'}</i></button>`;
    return `<div class="pa-me"><span class="pa-av pa-big">${esc(ini)}</span><div><b>${esc(mail)}</b><small>${T('Membre', 'Member')}</small></div></div>
      <div class="pa-card pa-list">${li('subjects', T('Mes sujets', 'My subjects'), T('Ce que votre Veille et votre newsletter mettent en premier', 'What your News and newsletter put first'))}
      ${li('newsletter', 'Newsletter', T('Éditions, adresse, mots-clés', 'Editions, address, keywords'))}${li('display', T('Affichage', 'Display'), T('Langue, thème', 'Language, theme'))}
      <div class="pa-li"><span><b>${T('Onglet d’ouverture', 'Opening tab')}</b><small>${T('Ce que l’app montre en premier', 'What the app shows first')}</small></span></div>
      <div class="pa-seg pa-start">${TABS.filter(t => ['today', 'grid', 'boards'].includes(t[0])).map(([k, l]) => `<button type="button" data-start="${k}" class="${k === st ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${li('install', T('Installer l’app', 'Install the app'), T('Sur l’écran d’accueil, comme une application', 'On the home screen, like an app'))}
      ${li('mcp', T('Connecteur pour Claude', 'Connector for Claude'), T('PowerKlock dans votre Claude', 'PowerKlock inside your Claude'))}${li('tour', T('Visite guidée', 'Guided tour'), T('Où trouver chaque chose', 'Where to find everything'))}
      ${li('account', T('Mon compte', 'My account'), T('Mot de passe, suppression', 'Password, deletion'))}${li('full', T('Version complète du site', 'Full version of the site'), T('Pricer PPA, BESS, historiques, cartes', 'PPA pricer, BESS, history, maps'))}
      <button type="button" class="pa-li pa-out" data-act="out"><span><b>${T('Se déconnecter', 'Sign out')}</b></span></button></div>`;
  }

  // ── sharing (the phone's own share sheet, Web Share): the morning brief as text, a chart as an image with its title,
  // source and link, an article as its title and link; nothing leaves without the reader's choice in the sheet ──
  const SHARE_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>';
  const canShare = () => !!navigator.share;
  const appUrl = t => location.origin + '/?app=1#app/' + (t || cur);
  async function shareText(title, text, url) { try { await navigator.share({ title, text, url }); } catch (_) {} }
  // a chart card as a 1080 × 1080 picture: PowerKlock, the title, the figure, the chart, the source and the address
  async function chartImage(sec) {
    const W = 1080, H = 1080, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue('--bg').trim() || '#0a0e13', tx = css.getPropertyValue('--text').trim() || '#E8EEF4', t2 = css.getPropertyValue('--text2').trim() || '#9FB0C0';
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#14D3A9'; g.font = '700 40px Outfit, Inter, sans-serif'; g.fillText('PowerKlock', 60, 96);
    const h3 = (sec.querySelector('.pa-k') || {}).textContent || '', ch = sec.querySelector('.pa-ch');
    g.fillStyle = t2; g.font = '600 30px Inter, sans-serif'; g.fillText(h3.toUpperCase().slice(0, 48), 60, 170);
    if (ch) { const sp = ch.querySelector('span'), b = ch.querySelector('b');
      g.fillStyle = tx; g.font = '500 34px Inter, sans-serif'; g.fillText((sp ? sp.textContent : '').slice(0, 46), 60, 228);
      g.font = '700 54px "JetBrains Mono", Menlo, monospace'; g.fillStyle = b && b.classList.contains('up') ? '#ED6965' : b && b.classList.contains('dn') ? '#14D3A9' : tx; g.fillText((b ? b.textContent : '').slice(0, 30), 60, 300); }
    const X = 60, Y = 360, CW = 960, CH = 520;
    const bars = sec.querySelector('.pa-bars'), svg = sec.querySelector('svg.pa-line');
    if (bars) { const is = [...bars.children], w = CW / is.length;
      is.forEach((i, k) => { const h = parseFloat(i.style.height) / 100 * CH; g.fillStyle = i.classList.contains('neg') ? '#6CB4F5' : i.classList.contains('lo') ? '#14D3A9' : '#ED6965'; g.fillRect(X + k * w + 3, Y + CH - h, w - 6, h); }); }
    else if (svg) { const x = svg.cloneNode(true); x.setAttribute('width', CW); x.setAttribute('height', CH); x.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(x));
      await new Promise(r => { img.onload = r; img.onerror = r; }); try { g.drawImage(img, X, Y, CW, CH); } catch (_) {} }
    const ax = sec.querySelector('.pa-axis'); if (ax) { const ls = [...ax.children]; g.fillStyle = t2; g.font = '400 26px Inter, sans-serif'; ls.forEach((l, k) => { const tw = g.measureText(l.textContent).width; g.fillText(l.textContent, Math.min(X + CW - tw, Math.max(X, X + k * CW / Math.max(1, ls.length - 1) - tw / 2)), Y + CH + 44); }); }
    const src = (sec.querySelector('.pa-src') || {}).textContent || '';
    g.fillStyle = t2; g.font = '400 26px Inter, sans-serif'; g.fillText((T('Source : ', 'Source: ') + src.replace(/^Sources?\s*:\s*/i, '')).slice(0, 70), 60, 1000);
    g.fillStyle = '#14D3A9'; g.font = '600 28px Inter, sans-serif'; g.fillText('powerklock.com', 60, 1044);
    return new Promise(r => c.toBlob(b => r(b), 'image/png'));
  }
  async function shareChart(sec) {
    const title = 'PowerKlock · ' + ((sec.querySelector('.pa-k') || {}).textContent || '');
    const blob = await chartImage(sec), file = blob && new File([blob], 'powerklock.png', { type: 'image/png' });
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title, text: title + '\n' + appUrl() }); return; } catch (_) { return; } }
    shareText(title, title, appUrl());
  }
  // a share button beside each chart's title, each article and the morning brief
  function decorate(m) {
    if (!canShare()) return;
    m.querySelectorAll('.pa-sec').forEach(sec => { if (!sec.querySelector('.pa-bars, svg.pa-line')) return; const k = sec.querySelector('.pa-k'); if (!k || k.querySelector('.pa-shr-b')) return;
      k.insertAdjacentHTML('beforeend', `<button type="button" class="pa-shr-b" aria-label="${T('Partager ce graphique', 'Share this chart')}">${SHARE_IC}</button>`);
      k.querySelector('.pa-shr-b').addEventListener('click', () => shareChart(sec)); });
    const br = m.querySelector('.pa-brief'); if (br && !br.querySelector('.pa-shr-b')) {
      br.insertAdjacentHTML('beforeend', `<button type="button" class="pa-shr-b pa-shr-t">${SHARE_IC} ${T('Partager', 'Share')}</button>`);
      br.querySelector('.pa-shr-b').addEventListener('click', () => { const t = br.cloneNode(true); t.querySelectorAll('button').forEach(x => x.remove());
        shareText('PowerKlock · ' + T('le point du matin', 'the morning brief'), t.textContent.trim() + '\n\n' + dayName(paris(), true), appUrl('today')); }); }
    m.querySelectorAll('.pa-feed > div, .pa-ol > li, .pa-lead').forEach(it => { const a = it.querySelector('a[href^="http"]'); if (!a || it.querySelector('.pa-shr-b')) return;
      it.insertAdjacentHTML('beforeend', `<button type="button" class="pa-shr-b pa-shr-i" aria-label="${T('Partager l’article', 'Share the article')}">${SHARE_IC}</button>`);
      it.querySelector('.pa-shr-b').addEventListener('click', () => shareText(a.textContent.trim(), a.textContent.trim() + (it.querySelector('p b') ? '\n' + it.querySelector('p').textContent.trim() : ''), a.href)); });
  }

  // ── drawing and wiring ──
  let seq = 0;
  async function draw() {
    const main = root.querySelector('#pa-main'), n = ++seq;
    if (!main.innerHTML) main.innerHTML = '<div class="pa-load"></div>';
    let html = '';
    try { html = await ({ today, grid, news, boards, alerts, me }[cur] || today)(); } catch (e) { console.warn('[app]', e); html = `<p class="pa-note">${T('Données indisponibles pour l’instant.', 'Data unavailable for now.')}</p>`; }
    if (n !== seq) return;
    main.innerHTML = html; main.scrollTop = 0;
    wire(main); decorate(main);
    const up = root.querySelector('#pa-up'); if (up) up.textContent = navigator.onLine === false ? T('hors ligne', 'offline') : '';
  }
  function wire(m) {
    m.querySelectorAll('[data-full]').forEach(a => a.addEventListener('click', () => leave()));
    m.querySelectorAll('[data-auth]').forEach(b => b.addEventListener('click', () => window.PKDash && PKDash.openAuth && PKDash.openAuth(b.dataset.auth)));
    m.querySelectorAll('[data-z]').forEach(b => b.addEventListener('click', () => { zone = b.dataset.z; draw(); }));
    m.querySelectorAll('[data-rng]').forEach(b => b.addEventListener('click', () => { rng = b.dataset.rng; draw(); }));
    m.querySelectorAll('[data-nv]').forEach(b => b.addEventListener('click', () => { nv = b.dataset.nv; draw(); }));
    const ask = m.querySelector('#pa-ask'); if (ask) ask.addEventListener('click', () => { const d = document.getElementById('ask-drawer'); if (d && d.parentNode !== document.body) document.body.appendChild(d);   // out of the hidden News page
      if (typeof _askWire === 'function') _askWire(); if (typeof window.askOpen === 'function') window.askOpen(); });
    const pa = m.querySelector('#pa-post-add'); if (pa) pa.addEventListener('click', async () => {
      const u = m.querySelector('#pa-post-url').value.trim(), msg = m.querySelector('#pa-post-msg');
      if (!/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(u)) { msg.textContent = T('Collez le lien d’un post LinkedIn.', 'Paste the link of a LinkedIn post.'); return; }
      pa.disabled = true;
      const author = typeof _newsAuthorOf === 'function' ? _newsAuthorOf(u) : null;
      const { error } = await PKAccount.client().from('news_post').insert({ url: u.split('?')[0], author: author || null, note: m.querySelector('#pa-post-note').value.trim() || null });
      if (error) { msg.textContent = T('Non ajouté : ', 'Not added: ') + error.message; pa.disabled = false; return; }
      pendingPost = null; draw();
    });
    m.querySelectorAll('[data-board]').forEach(b => b.addEventListener('click', () => { if (PKDash.select) PKDash.select(b.dataset.board); leave(); location.hash = '#dashboards'; }));
    m.querySelectorAll('[data-rule]').forEach(b => b.addEventListener('click', async () => { b.classList.toggle('on'); try { await PKAlerts.toggle(b.dataset.rule); } catch (_) {} draw(); }));
    const na = m.querySelector('#pa-newal'); if (na) na.addEventListener('click', () => window.PKSetup && PKSetup.settings('alerts'));
    const pu = m.querySelector('#pa-push'); if (pu) pu.addEventListener('click', async () => { pu.disabled = true; try { await (pu.classList.contains('on') ? PKPush.off() : PKPush.on()); } catch (e) { alert(T('Notifications non activées : ', 'Notifications not turned on: ') + (e.message || e)); } draw(); });
    m.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => { try { localStorage.setItem('pk-app-start', b.dataset.start); } catch (_) {} m.querySelectorAll('[data-start]').forEach(x => x.classList.toggle('on', x === b)); }));
    m.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (['subjects', 'newsletter', 'display'].includes(a) && window.PKSetup) PKSetup.settings(a);
      else if (a === 'install') install();
      else if (a === 'mcp' && window.PKDash) { PKDash.openAccount(); setTimeout(() => { const t = document.getElementById('pkd-mcp'); if (t) t.scrollIntoView({ block: 'start' }); }, 400); }
      else if (a === 'account' && window.PKDash) PKDash.openAccount();
      else if (a === 'tour' && window.PKTour) { leave(); location.hash = '#today'; setTimeout(() => PKTour.start(), 600); }
      else if (a === 'full') { leave(); location.hash = '#today'; }
      else if (a === 'out') PKAccount.signOut().then(() => draw());
    }));
  }

  // ── installing it: Android and desktop Chrome offer a prompt; iPhone needs Share › Add to Home Screen ──
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
  function install() {
    if (standalone()) { alert(T('PowerKlock est déjà installé sur cet appareil.', 'PowerKlock is already installed on this device.')); return; }
    if (deferred) { deferred.prompt(); deferred.userChoice.finally(() => { deferred = null; }); return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const ov = document.createElement('div'); ov.className = 'pa-sheet-ov'; ov.setAttribute('translate', 'no');
    ov.innerHTML = `<div class="pa-sheet" role="dialog" aria-modal="true"><b>${T('Installer PowerKlock', 'Install PowerKlock')}</b>
      <ol>${ios ? `<li>${T('Touchez le bouton Partager', 'Tap the Share button')} <span class="pa-shr">⬆︎</span> ${T('en bas de Safari.', 'at the bottom of Safari.')}</li><li>${T('Choisissez « Sur l’écran d’accueil ».', 'Choose « Add to Home Screen ».')}</li><li>${T('Touchez « Ajouter » : l’icône PowerKlock apparaît, l’app s’ouvre en plein écran.', 'Tap « Add »: the PowerKlock icon appears, the app opens full screen.')}</li>`
        : `<li>${T('Ouvrez le menu du navigateur (⋮).', 'Open the browser menu (⋮).')}</li><li>${T('Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».', 'Choose « Install app » or « Add to Home screen ».')}</li>`}</ol>
      <button type="button" class="pa-btn pa-wide">${T('J’ai compris', 'Got it')}</button></div>`;
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.pa-btn')) ov.remove(); });
    document.body.appendChild(ov);
  }

  // ── alert notifications on this device (Web Push, warehouse migration 040; sent by scripts/alerts.py, shown by sw.js) ──
  const PKPush = {
    async state() {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:';
      if (!ok) return { supported: false, iosHint: ios && !standalone() };
      let sub = null; try { const r = await navigator.serviceWorker.getRegistration(); sub = r && await r.pushManager.getSubscription(); } catch (_) {}
      return { supported: true, on: !!sub && Notification.permission === 'granted', blocked: Notification.permission === 'denied' };
    },
    async on() {
      const cl = PKAccount.client();
      const { data } = await cl.from('push_config').select('v').eq('k', 'vapid_public').maybeSingle();
      if (!data || !data.v) throw new Error(T('les notifications ne sont pas encore ouvertes sur le site', 'notifications are not open on the site yet'));
      if (await Notification.requestPermission() !== 'granted') throw new Error(T('autorisation refusée', 'permission refused'));
      const reg = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready;
      const raw = atob(data.v.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((data.v.length + 3) % 4));
      const key = Uint8Array.from(raw, c => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const j = sub.toJSON();
      const { data: ok, error } = await cl.rpc('push_save', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 200) });
      if (error || !ok) { await sub.unsubscribe(); throw error || new Error(T('non enregistré', 'not saved')); }
    },
    async off() {
      const r = await navigator.serviceWorker.getRegistration(), sub = r && await r.pushManager.getSubscription();
      if (!sub) return;
      try { await PKAccount.client().rpc('push_drop', { p_endpoint: sub.endpoint }); } catch (_) {}
      await sub.unsubscribe();
    },
  };
  window.PKPush = PKPush;

  // the icon's badge: the alerts of today and tomorrow (installed app)
  document.addEventListener('pk-alerts', e => {
    const n = (e.detail && e.detail.n) || 0, b = document.getElementById('pa-badge');
    if (b) { b.hidden = !n; b.textContent = n; }
    try { if (standalone() && navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()); } catch (_) {}
    if (cur === 'alerts' && H.classList.contains('pk-app')) draw();
  });

  // the service worker: the site and its last data stay readable without a network (sw.js)
  if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('[sw]', e)));

  function boot() {
    // launched from the home screen: straight into the app (the manifest opens /?app=1)
    if ((/[?&]app=1/.test(location.search) || (standalone() && !location.hash)) && !/^#app/.test(location.hash)) history.replaceState(null, '', location.pathname + '#app/' + (localStorage.getItem('pk-app-start') || 'today'));
    window.addEventListener('hashchange', route);
    window.addEventListener('online', () => { fresh(); if (H.classList.contains('pk-app')) draw(); });
    window.addEventListener('offline', () => { const up = document.getElementById('pa-up'); if (up) up.textContent = T('hors ligne', 'offline'); });
    if (window.PKAccount && PKAccount.onChange) PKAccount.onChange(() => { if (H.classList.contains('pk-app')) show(cur); });
    route();
  }
  window.PKApp = { open: t => go(t || 'today'), install, sharePost: u => { pendingPost = u; nv = 'posts'; if (!H.classList.contains('pk-app')) enter(); go('news'); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
