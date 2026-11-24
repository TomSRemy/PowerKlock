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
      return `<a class="pa-tile" href="#${esc(r.page || 'today')}" data-full><span>${esc(en() ? r.label[1] : r.label[0])}</span><b>${nf(r.value, h ? 0 : 2)}${h ? ' h' : ''}</b><small>${h ? '' : esc(r.unit)} ${arrow(c, h)} ${ch}</small></a>`; }).join('')}</div>${src(T('Sources : ', 'Sources: ') + esc([...new Set(M.map(r => r.src).filter(Boolean))].join(', ')) + '. ' + T('Variation sur la séance précédente.', 'Change on the previous session.'))}`));
    // tomorrow (or today when tomorrow is not out yet), hour by hour
    const fr = (tmr && tmr.zones && tmr.zones.FR) ? [paris(1), tmr.zones.FR] : (tdy && tdy.zones && tdy.zones.FR) ? [paris(), tdy.zones.FR] : null;
    if (fr && Array.isArray(fr[1].hourly)) { const hs = hourly(fr[1].hourly), v = hs.filter(x => x != null), mn = Math.min(...v), mx = Math.max(...v), lo = [...v].sort((a, b) => a - b)[Math.floor(v.length / 4)];
      out.push(sec(fr[0] === paris(1) ? T('Demain heure par heure', 'Tomorrow hour by hour') : T('Aujourd’hui heure par heure', 'Today hour by hour'),
        `<div class="pa-card"><div class="pa-ch"><span>${T('Spot France', 'France spot')} · ${dayName(fr[0])}</span><b>${nf(fr[1].avg, 2)} €/MWh</b></div>${bars(hs, lo)}${axis()}
        <p class="pa-note">${T('Moins cher', 'Cheapest')} ${hs.indexOf(mn)} h (${nf(mn, 0)} €) · ${T('plus cher', 'dearest')} ${hs.indexOf(mx)} h (${nf(mx, 0)} €)${fr[1].negHours ? ' · ' + nf(fr[1].negHours, 2) + ' h ' + T('négatives', 'negative') : ''}</p></div>${src('ENTSO-E · ' + T('moyenne publiée du jour', 'published daily average'))}`)); }
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
    if (tiles.length) out.push(sec(T('À surveiller', 'To watch'), `<div class="pa-tiles">${tiles.map(([l, v, s, c]) => `<div class="pa-tile"><span>${l}</span><b>${v}</b><small class="${c}">${esc(s)}</small></div>`).join('')}</div>${src(T('Prévisions PowerKlock (prix, heures négatives, nucléaire), Open-Meteo (températures), RTE (jours de pointe).', 'PowerKlock forecasts (prices, negative hours, nuclear), Open-Meteo (temperatures), RTE (peak days).'))}`));
    // what moved and why (data/market_digest.json, the analyst notes of the Expert view)
    const ctx = md && md.context || [];
    if (ctx.length) out.push(sec(T('Ce qui a bougé et pourquoi', 'What moved and why'), `<div class="pa-card pa-why">${ctx.slice(0, 5).map(c => `<div><span class="${c.tone === 'up' ? 'up' : c.tone === 'down' ? 'dn' : ''}">${c.tone === 'up' ? '▲' : c.tone === 'down' ? '▼' : '•'}</span><p><b>${esc(en() ? c.topic_en || c.topic : c.topic)}</b> ${esc(en() ? c.text_en || c.text : c.text)}</p></div>`).join('')}</div>${src(T('Lectures d’analyste rédigées automatiquement à partir des données du site', 'Analyst reads written automatically from the site’s data') + (md.asof ? ' · ' + esc(dayName(md.asof)) : ''))}`));
    out.push(full('#today?v=2', T('Vue Expert complète', 'Full Expert view')));
    return out.join('');
  }

  // ── Grid: live mix, CO₂, consumption, flows, Europe's prices ──
  // life-cycle emission factors, gCO₂eq/kWh (IPCC AR5 WGIII annex III medians, as Electricity Maps): an estimate of the
  // mix's intensity, not a measure; storage discharge is left out (its charging was counted when it happened)
  const EF = { B01: 230, B02: 820, B03: 820, B04: 490, B05: 820, B06: 650, B07: 650, B08: 820, B09: 38, B11: 24, B12: 24, B13: 24, B14: 12, B15: 230, B16: 45, B17: 230, B18: 12, B19: 11, B20: 700 };
  const LOW = ['B09', 'B11', 'B12', 'B13', 'B14', 'B16', 'B18', 'B19'], REN = ['B01', 'B09', 'B11', 'B12', 'B13', 'B15', 'B16', 'B18', 'B19'];
  const FUEL = [['nuclear', T('Nucléaire', 'Nuclear'), '#E7B25C'], ['hydro', T('Hydraulique', 'Hydro'), '#4F9DDE'], ['wind', T('Éolien', 'Wind'), '#7BD3C0'], ['solar', T('Solaire', 'Solar'), '#F4D35E'], ['fossil', T('Gaz, charbon et fioul', 'Gas, coal and oil'), '#9AA5B1'], ['biomass', T('Bioénergies', 'Bioenergy'), '#8BC34A'], ['other', T('Autres', 'Other'), '#5C6B7A']];
  const ZN = { FR: ['🇫🇷', 'France', 'France'], DE_LU: ['🇩🇪', 'Allemagne', 'Germany'], ES: ['🇪🇸', 'Espagne', 'Spain'], BE: ['🇧🇪', 'Belgique', 'Belgium'], NL: ['🇳🇱', 'Pays-Bas', 'Netherlands'], GB: ['🇬🇧', 'Grande-Bretagne', 'Great Britain'], PT: ['🇵🇹', 'Portugal', 'Portugal'],
    IT_NORD: ['🇮🇹', 'Italie Nord', 'Italy North'], CH: ['🇨🇭', 'Suisse', 'Switzerland'], AT: ['🇦🇹', 'Autriche', 'Austria'], DK_W: ['🇩🇰', 'Danemark Ouest', 'Denmark West'], DK_E: ['🇩🇰', 'Danemark Est', 'Denmark East'],
    PL: ['🇵🇱', 'Pologne', 'Poland'], CZ: ['🇨🇿', 'Tchéquie', 'Czechia'], NO_2: ['🇳🇴', 'Norvège Sud', 'Norway South'], SE_4: ['🇸🇪', 'Suède Sud', 'Sweden South'], LU: ['🇱🇺', 'Luxembourg', 'Luxembourg'], IE_SEM: ['🇮🇪', 'Irlande', 'Ireland'] };
  let zone = 'FR';
  function co2(m) { const b = m.byCode || {}; let e = 0, t = 0, low = 0, ren = 0;
    Object.entries(b).forEach(([k, v]) => { const x = typeof v === 'number' ? v : (v && (v.mw != null ? v.mw : v.value)); if (!(x > 0) || EF[k] == null) return; e += x * EF[k]; t += x; if (LOW.includes(k)) low += x; if (REN.includes(k)) ren += x; });
    return t ? { g: e / t, low: low / t, ren: ren / t } : null; }
  async function grid() {
    const [g, ld, fc, xb, pr] = await Promise.all([get('genmix.json'), get('load.json'), get('forecast.json'), get('crossborder.json'), get('prices.json')]);
    if (!approved()) return `<h2 class="pa-h">${T('Réseau', 'Grid')}</h2>` + signIn(T('Le réseau en direct : production par filière, intensité CO₂, consommation, échanges et prix en Europe.', 'The grid live: generation by fuel, CO₂ intensity, consumption, flows and prices across Europe.'));
    const Z = {}; Object.entries((g && g.countries) || {}).forEach(([k, v]) => { if (v && v.total > 0) Z[k] = v; }); if (!Z[zone]) zone = Object.keys(Z)[0] || 'FR';
    const m = Z[zone] || {}, tot = m.total || FUEL.reduce((a, [k]) => a + (m[k] || 0), 0), c = co2(m);
    const upd = g && g.updated ? new Date(g.updated).toLocaleTimeString(en() ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '';
    const X = (xb && xb.countries && xb.countries[zone]) || [], net = X.reduce((a, x) => a + (x.net || 0), 0);
    const out = [`<h2 class="pa-h">${T('Réseau', 'Grid')}</h2><div class="pa-date">${T('en direct', 'live')}${upd ? ' · ' + T('mise à jour', 'updated') + ' ' + upd : ''}</div>`,
      `<div class="pa-zones">${Object.keys(Z).map(k => `<button type="button" data-z="${k}" class="${k === zone ? 'on' : ''}">${(ZN[k] || ['', k])[0]} ${k.slice(0, 2)}</button>`).join('')}</div>`];
    const pct = c ? Math.round(c.g / 8) : 0;   // the ring: 0 to 800 g
    out.push(`<div class="pa-card pa-gauge"><div class="pa-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--border2)" stroke-width="12"/>${c ? `<circle cx="60" cy="60" r="50" fill="none" stroke="${c.g < 100 ? '#14D3A9' : c.g < 300 ? '#E7B25C' : '#ED6965'}" stroke-width="12" stroke-dasharray="${Math.min(100, pct) * 3.14} 314" transform="rotate(-90 60 60)" stroke-linecap="round"/>` : ''}</svg>
      <div><b>${c ? nf(c.g, 0) : '–'}</b><small>gCO₂/kWh</small></div></div>
      <div class="pa-gk"><div><b>${c ? nf(c.low * 100, 0) + ' %' : '–'}</b><small>${T('bas-carbone', 'low-carbon')}</small></div><div><b>${c ? nf(c.ren * 100, 0) + ' %' : '–'}</b><small>${T('renouvelable', 'renewable')}</small></div>
      <div><b>${nf(tot / 1000, 1)} GW</b><small>${T('production', 'generation')}</small></div>${X.length ? `<div><b class="${net < 0 ? 'dn' : 'up'}">${nf(Math.abs(net) / 1000, 1)} GW</b><small>${net < 0 ? T('exportés', 'exported') : T('importés', 'imported')}</small></div>` : ''}</div></div>
      ${src(c ? T('Intensité CO₂ estimée à partir du mix, facteurs du cycle de vie (GIEC) : voir Méthodologie.', 'CO₂ intensity estimated from the mix, life-cycle factors (IPCC): see Methodology.') : T('Détail par filière indisponible pour cette zone : pas d’estimation CO₂.', 'No breakdown by fuel for this zone: no CO₂ estimate.'))}`);
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
  let nv = 'une';
  async function news() {
    if (!approved()) return `<h2 class="pa-h">${T('Veille', 'News')}</h2>` + signIn(T('L’actualité des marchés de l’électricité choisie pour vous, les textes officiels et les réponses de PowerKlock à vos questions.', 'Power market news chosen for you, official texts and PowerKlock’s answers to your questions.'));
    const [E, dg, N] = await Promise.all([get('newsletter.json'), get('news_digest.json'), get('news.json')]);
    if (typeof _nlMe !== 'undefined' && _nlMe === undefined && typeof _nlLoadMe === 'function') { try { await _nlLoadMe(); } catch (_) {} }
    const items = (N && N.items) || [], mine = E && typeof _nlMine === 'function' ? _nlMine(E) : null;
    const left = await askLeft();
    const out = [`<h2 class="pa-h">${T('Veille', 'News')}</h2><div class="pa-date">${mine && (mine.interests || []).length ? T('selon vos ' + mine.interests.length + ' sujets', 'from your ' + mine.interests.length + ' subjects') : T('édition générale', 'general edition')}</div>`,
      `<button type="button" class="pa-ask" id="pa-ask">✦ ${T('Posez une question à PowerKlock…', 'Ask PowerKlock a question…')}${left != null ? `<span>${left} / 30</span>` : ''}</button>`,
      `<div class="pa-seg">${[['une', T('À la une', 'Top')], ['live', T('En continu', 'Live')], ['off', T('Textes officiels', 'Official texts')]].map(([k, l]) => `<button type="button" data-nv="${k}" class="${k === nv ? 'on' : ''}">${l}</button>`).join('')}</div>`];
    const a = (u, t) => `<a href="${esc(/^https?:\/\//.test(u || '') ? u : '#')}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`;
    const when = d => { const h = (Date.now() - new Date(d)) / 36e5; return h < 1 ? T('à l’instant', 'just now') : h < 24 ? T('il y a ' + Math.round(h) + ' h', Math.round(h) + ' h ago') : dayName(String(d).slice(0, 10)); };
    if (nv === 'une') {
      const S = (mine && mine.stories) || [], L = S[0];
      if (L) out.push(`<article class="pa-card pa-lead"><div class="pa-th">${T('À la une', 'Lead story')}</div><h3>${a(L.link, L.title)}</h3>${typeof _newsKeep === 'function' && _newsKeep(L, en()) ? `<p><b>${T('À retenir.', 'Takeaway.')}</b> ${esc(_newsKeep(L, en()))}</p>` : ''}<div class="pa-src">${esc((L.sources || []).slice(0, 3).join(' · '))}</div></article>`);
      const D = (dg && dg.daily && dg.daily.items) || [];
      if (D.length) out.push(sec(T('L’essentiel du jour', 'Today’s essentials'), `<ol class="pa-ol">${D.map(x => `<li>${a(x.link, (en() && x.text_en) || x.text || x.title)}<small>${esc((x.sources || []).slice(0, 2).join(' · '))}</small></li>`).join('')}</ol>`));
      if (S.length > 1) out.push(sec(T('Vos sujets', 'Your subjects'), `<div class="pa-feed">${S.slice(1).map(x => `<div>${a(x.link, x.title)}<small>${esc((x.sources || []).slice(0, 2).join(' · '))}</small></div>`).join('')}</div>`));
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

  // ── drawing and wiring ──
  let seq = 0;
  async function draw() {
    const main = root.querySelector('#pa-main'), n = ++seq;
    if (!main.innerHTML) main.innerHTML = '<div class="pa-load"></div>';
    let html = '';
    try { html = await ({ today, grid, news, boards, alerts, me }[cur] || today)(); } catch (e) { console.warn('[app]', e); html = `<p class="pa-note">${T('Données indisponibles pour l’instant.', 'Data unavailable for now.')}</p>`; }
    if (n !== seq) return;
    main.innerHTML = html; main.scrollTop = 0;
    wire(main);
    const up = root.querySelector('#pa-up'); if (up) up.textContent = navigator.onLine === false ? T('hors ligne', 'offline') : '';
  }
  function wire(m) {
    m.querySelectorAll('[data-full]').forEach(a => a.addEventListener('click', () => leave()));
    m.querySelectorAll('[data-auth]').forEach(b => b.addEventListener('click', () => window.PKDash && PKDash.openAuth && PKDash.openAuth(b.dataset.auth)));
    m.querySelectorAll('[data-z]').forEach(b => b.addEventListener('click', () => { zone = b.dataset.z; draw(); }));
    m.querySelectorAll('[data-nv]').forEach(b => b.addEventListener('click', () => { nv = b.dataset.nv; draw(); }));
    const ask = m.querySelector('#pa-ask'); if (ask) ask.addEventListener('click', () => { const d = document.getElementById('ask-drawer'); if (d && d.parentNode !== document.body) document.body.appendChild(d);   // out of the hidden News page
      if (typeof _askWire === 'function') _askWire(); if (typeof window.askOpen === 'function') window.askOpen(); });
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
    if (/[?&]app=1/.test(location.search) && !/^#app/.test(location.hash)) history.replaceState(null, '', location.pathname + '#app/' + (localStorage.getItem('pk-app-start') || 'today'));
    window.addEventListener('hashchange', route);
    window.addEventListener('online', () => { fresh(); if (H.classList.contains('pk-app')) draw(); });
    window.addEventListener('offline', () => { const up = document.getElementById('pa-up'); if (up) up.textContent = T('hors ligne', 'offline'); });
    if (window.PKAccount && PKAccount.onChange) PKAccount.onChange(() => { if (H.classList.contains('pk-app')) show(cur); });
    route();
  }
  window.PKApp = { open: t => go(t || 'today'), install };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
