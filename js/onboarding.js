// onboarding.js · the first sign-in and Settings (one component, two layouts). At the first sign-in of an approved account
// (public.news_profile.onboarded_at empty, warehouse migration 039) a card walks the reader through, one screen at a
// time: welcome, subjects, newsletter, alerts, display, summary; « Later » stops it for good. The same screens, as tabs,
// are Settings (account menu › Settings). It writes public.news_profile (subjects, France first, editions, address),
// public.news_keyword (keywords), public.alert_rule (alerts, migration 038) and this browser's display choices (language,
// theme, the Today page's opening view). Approved by the owner from mockup v5 (24 Nov. 2026).
(function () {
  'use strict';
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  // ── the alerts (same kinds and rules as js/alerts.js and scripts/alerts.py) ──
  const AL = {
    neg_price: [T('Prix négatifs', 'Negative prices'), T('Prix spot négatif, compté au quart d’heure.', 'Negative spot price, counted by the quarter-hour.')],
    base_above: [T('Prix base au-dessus de', 'Baseload above'), T('La moyenne du jour dépasse un prix.', 'The day’s average above a price.')],
    base_below: [T('Prix base en dessous de', 'Baseload below'), T('La moyenne du jour passe sous un prix.', 'The day’s average below a price.')],
    pp1: [T('Jour PP1 (France)', 'PP1 day (France)'), T('RTE annonce un jour de pointe PP1, la veille vers 9 h 30.', 'RTE signals a PP1 peak day, the day before about 09:30.')],
    pp2: [T('Jour PP2 (France)', 'PP2 day (France)'), T('RTE annonce un jour PP2, la veille à 9 h 30 ou 19 h.', 'RTE signals a PP2 day, the day before at 09:30 or 19:00.')],
    cal_move: [T('Cal : fort mouvement', 'Cal: big move'), T('Un contrat annuel bouge fortement en une séance ou en une semaine.', 'An annual contract moves sharply in a session or a week.')],
    cal_above: [T('Cal : au-dessus d’un prix', 'Cal: above a price'), T('Un contrat annuel clôture au-dessus d’un prix.', 'An annual contract settles above a price.')],
    cal_below: [T('Cal : en dessous d’un prix', 'Cal: below a price'), T('Un contrat annuel clôture en dessous d’un prix.', 'An annual contract settles below a price.')],
    ppa_move: [T('Référence PPA : mouvement sur 7 jours', 'PPA benchmark: 7-day move'), T('La référence PPA solaire ou éolien bouge fortement en une semaine.', 'The solar or wind PPA benchmark moves sharply in a week.')],
    corr_break: [T('Rupture de corrélation', 'Correlation break'), T('Deux marchés suivis (Cal FR / TTF, Cal FR / Cal DE…) ne bougent plus ensemble comme d’habitude.', 'Two watched markets (Cal FR / TTF, Cal FR / Cal DE…) stop moving together as usual.')],
  };
  const GROUPS = [[T('Prix spot', 'Spot prices'), ['neg_price', 'base_above', 'base_below']], [T('Jours de pointe RTE', 'RTE peak days'), ['pp1', 'pp2']],
    [T('Forwards annuels (Cal)', 'Annual forwards (Cal)'), ['cal_move', 'cal_above', 'cal_below']], [T('PPA et corrélations', 'PPA and correlations'), ['ppa_move', 'corr_break']]];
  const CAL_C = [['FR', '🇫🇷', T('France', 'France')], ['DE', '🇩🇪', T('Allemagne', 'Germany')], ['NL', '🇳🇱', T('Pays-Bas', 'Netherlands')], ['UK', '🇬🇧', T('Royaume-Uni', 'United Kingdom')]];
  const DEF = { neg_price: { zones: ['FR'], min_hours: 0.25 }, base_above: { zones: ['FR'], threshold: 150 }, base_below: { zones: ['FR'], threshold: 20 }, pp1: {}, pp2: {},
    cal_move: { threshold: 3, params: { country: 'FR', cal: 1, period: '1d', unit: 'eur' } }, cal_above: { threshold: 130, params: { country: 'FR', cal: 1 } },
    cal_below: { threshold: 80, params: { country: 'FR', cal: 1 } }, ppa_move: { threshold: 3 }, corr_break: { threshold: 0.3 } };
  const PROPOSED = ['neg_price', 'pp1', 'pp2'];
  const zones = () => { const Z = (typeof ZONES !== 'undefined' && ZONES.length ? ZONES : [{ code: 'FR', name: 'France', flag: '🇫🇷' }]).slice();
    return Z.sort((a, b) => (a.code === 'FR' ? -1 : b.code === 'FR' ? 1 : zn(a).localeCompare(zn(b)))); };
  const isCal = k => /^cal_/.test(k);
  const zn = z => (window.PKI18n && PKI18n.tr ? PKI18n.tr(z.name) : z.name);   // the zone's French name (assets/i18n_fr.json)

  let S = null;   // the screen's state

  async function load() {
    const A = window.PKAccount, cl = A.client(), uid = A.user.id;
    const [p, k, r] = await Promise.all([
      cl.from('news_profile').select('*').eq('user_id', uid).maybeSingle(),
      cl.from('news_keyword').select('keyword').eq('user_id', uid),
      cl.from('alert_rule').select('*').order('created_at')]);
    const me = (p && p.data) || {};
    const rules = ((r && r.data) || []).filter(x => AL[x.kind]);
    const alerts = [];
    Object.keys(AL).forEach(kind => {
      const mine = rules.filter(x => x.kind === kind);
      if (mine.length) mine.forEach(x => alerts.push({ id: x.id, kind, on: x.active !== false, zones: x.zones || ['FR'], min_hours: x.min_hours, threshold: x.threshold, params: x.params || {}, email_to: x.email_to || '' }));
      else alerts.push(Object.assign({ kind, on: !me.onboarded_at && !rules.length && PROPOSED.includes(kind), email_to: '' }, JSON.parse(JSON.stringify(DEF[kind]))));
    });
    S = { me, first: !me.onboarded_at, interests: new Set(me.interests || []), france: !!me.france, daily: me.onboarded_at ? !!me.daily : true, weekly: !!me.weekly,
      email_to: me.email_to || '', keywords: ((k && k.data) || []).map(x => x.keyword), alerts, alertTo: '',
      lang: (window.PKI18n && PKI18n.lang) || 'fr', theme: 'dark',
      view: lsGet('pk-view-default-morning', '2') };
  }

  // ── pieces ──
  const sw = (id, on) => `<button type="button" class="ob-sw${on ? ' on' : ''}" data-sw="${id}" role="switch" aria-checked="${on}"></button>`;
  const seg = (name, val, opts) => `<div class="ob-seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const zonePick = (i, sel) => { const Z = zones(), on = Z.filter(z => sel.includes(z.code));
    const label = !on.length ? T('Aucune zone', 'No zone') : on.length <= 2 ? on.map(z => z.flag + ' ' + zn(z)).join(', ') : on.slice(0, 2).map(z => z.flag + ' ' + zn(z)).join(', ') + ' + ' + (on.length - 2);
    return `<div class="ob-sub">${T('Zones', 'Zones')}</div><div class="ob-dd" data-dd="${i}"><button type="button" class="ob-ddb"><span>${esc(label)}</span><i>▾</i></button>
      <div class="ob-ddp"><input class="ob-dds" placeholder="${T('Rechercher une zone', 'Find a zone')}"><div class="ob-ddl">${Z.map(z => `<label class="ob-zo"><input type="checkbox" value="${esc(z.code)}"${sel.includes(z.code) ? ' checked' : ''}> <span>${esc(z.flag)}</span> ${esc(zn(z))} <small>${esc(z.code)}</small></label>`).join('')}</div>
      <div class="ob-ddf"><a href="#" data-all>${T('Tout cocher', 'All')}</a><a href="#" data-none>${T('Aucune', 'None')}</a><button type="button" class="ob-ddok">OK</button></div></div></div>`; };
  const fx = v => T(String(v).replace('.', ','), String(v));   // 0,25 in French
  const num = (i, f, v, step, unit) => `<span class="ob-num"><button type="button" data-step="${i}|${f}|-${step}">−</button><input data-num="${i}|${f}" inputmode="decimal" value="${esc(fx(v))}"><button type="button" data-step="${i}|${f}|${step}">+</button><b>${unit}</b></span>`;
  const sel = (i, f, v, opts) => `<select class="ob-sel" data-sel="${i}|${f}">${opts.map(([k, l]) => `<option value="${k}"${String(k) === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  function alertOpts(a, i) {
    const p = a.params || {}, u = p.country === 'UK' ? '£/MWh' : '€/MWh';
    let h = '';
    if (a.kind === 'neg_price') h = zonePick(i, a.zones || []) + `<div class="ob-sub">${T('Durée minimale', 'Minimum duration')}</div>${num(i, 'min_hours', a.min_hours || 0.25, 0.25, 'h')}<div class="ob-hint">${T('0,25 h par défaut : un seul quart d’heure négatif suffit. Montez à 1 h, 2 h… pour ne garder que les épisodes longs.', '0.25 h by default: a single negative quarter-hour is enough. Go up to 1 h, 2 h… to keep only long episodes.')}</div>`;
    else if (a.kind === 'base_above' || a.kind === 'base_below') h = zonePick(i, a.zones || []) + `<div class="ob-sub">${T('Prix', 'Price')}</div>${num(i, 'threshold', a.threshold, 5, '€/MWh')}`;
    else if (isCal(a.kind)) h = `<div class="ob-two"><div><div class="ob-sub">${T('Pays', 'Country')}</div>${sel(i, 'country', p.country || 'FR', CAL_C.map(([c, f, n]) => [c, f + ' ' + n]))}</div>
        <div><div class="ob-sub">${T('Contrat', 'Contract')}</div>${sel(i, 'cal', p.cal || 1, [1, 2, 3].map(n => [n, `Cal+${n} (${new Date().getFullYear() + n})`]))}</div></div>`
      + (a.kind === 'cal_move' ? `<div class="ob-two"><div><div class="ob-sub">${T('Sur', 'Over')}</div>${sel(i, 'period', p.period || '1d', [['1d', T('Une séance', 'One session')], ['1w', T('Une semaine', 'One week')]])}</div>
        <div><div class="ob-sub">${T('Unité', 'Unit')}</div>${sel(i, 'unit', p.unit || 'eur', [['eur', u], ['pct', '%']])}</div></div><div class="ob-sub">${T('Seuil (hausse ou baisse)', 'Threshold (up or down)')}</div>${num(i, 'threshold', a.threshold, 0.5, p.unit === 'pct' ? '%' : u)}`
        : `<div class="ob-sub">${T('Prix', 'Price')}</div>${num(i, 'threshold', a.threshold, 5, u)}`);
    else if (a.kind === 'ppa_move') h = `<div class="ob-sub">${T('Seuil (hausse ou baisse)', 'Threshold (up or down)')}</div>${num(i, 'threshold', a.threshold, 0.5, '€/MWh')}`;
    else if (a.kind === 'corr_break') h = `<div class="ob-sub">${T('Écart de corrélation', 'Gap in correlation')}</div>${num(i, 'threshold', a.threshold, 0.05, '')}<div class="ob-hint">${T('De 0 à 2 : 0,3 signale un vrai changement de comportement.', 'From 0 to 2: 0.3 flags a real change of behaviour.')}</div>`;
    return h + `<details class="ob-more"${a.email_to ? ' open' : ''}><summary>${T('Envoyer à une autre adresse', 'Send to another address')}</summary><input class="ob-in" type="email" data-to="${i}" value="${esc(a.email_to)}" placeholder="adresse@exemple.fr"></details>
      ${a.kind === 'pp1' || a.kind === 'pp2' ? '' : `<button type="button" class="ob-addal" data-add="${i}">+ ${T('Ajouter une autre alerte de ce type', 'Add another alert of this kind')}</button>`}`;
  }
  const alertCard = (a, i) => `<div class="ob-al${a.on ? ' on' : ''}"><div class="ob-row"><div><b>${AL[a.kind][0]}</b><small>${AL[a.kind][1]}</small></div>${sw('a' + i, a.on)}</div><div class="ob-opts">${a.on ? alertOpts(a, i) : ''}</div></div>`;

  // ── the screens ──
  const SCREENS = {
    welcome: () => { const mail = window.PKAccount.user.email || '', ini = (mail.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase();
      return `<div class="ob-hero"><span class="ob-av">${esc(ini)}</span><div><div class="ob-k">${T('Bienvenue', 'Welcome')}</div><h1>${T('Votre accès est ouvert', 'Your access is open')}</h1></div></div>
      <p class="ob-lead">${T('Deux minutes pour régler PowerKlock à votre façon. Tout se change ensuite dans Réglages, depuis le menu de votre compte en haut à droite.', 'Two minutes to set PowerKlock up your way. Everything can be changed later in Settings, from your account menu at the top right.')}</p>
      <ol class="ob-what"><li>${T('Les sujets qui vous intéressent', 'The subjects you follow')}</li><li>${T('Votre newsletter', 'Your newsletter')}</li><li>${T('Vos alertes (facultatif)', 'Your alerts (optional)')}</li><li>${T('Votre affichage', 'Your display')}</li></ol>`; },
    subjects: () => `<h1>${T('Qu’est-ce qui vous intéresse&nbsp;?', 'What are you interested in?')}</h1>
      <p class="ob-lead">${T('Votre newsletter et votre page Veille mettent ces sujets en premier. Choisissez-en autant que vous voulez.', 'Your newsletter and your News page put these subjects first. Choose as many as you like.')}</p>
      ${(window.PK_INTERESTS || []).map(([gf, ge, list]) => `<div class="ob-grp">${T(gf, ge)}</div><div class="ob-chips">${list.map(([k, fr, en]) => `<button type="button" class="ob-chip${S.interests.has(k) ? ' on' : ''}" data-int="${k}" aria-pressed="${S.interests.has(k)}">${T(fr, en)}</button>`).join('')}</div>`).join('')}
      <div class="ob-grp">${T('Zone', 'Area')}</div>${seg('france', S.france ? 1 : 0, [[1, T('France d’abord', 'France first')], [0, T('France et Europe', 'France and Europe')]])}`,
    newsletter: () => `<h1>${T('Votre newsletter', 'Your newsletter')}</h1>
      <p class="ob-lead">${T('Un e-mail court, écrit à partir de vos sujets. Rien ne part sans votre accord.', 'A short e-mail, written from your subjects. Nothing is sent without your consent.')}</p>
      <div class="ob-row"><div><b translate="no">7 O’Klock</b><small>${T('Chaque matin de semaine à 7 h : les prix, le point du marché, l’essentiel de l’actualité.', 'Every weekday at 7:00: prices, the market brief, the day’s news.')}</small></div>${sw('daily', S.daily)}</div>
      <div class="ob-row"><div><b translate="no">PowerBrunch</b><small>${T('Le lundi à 10 h : la semaine écoulée en une page.', 'Monday at 10:00: last week on one page.')}</small></div>${sw('weekly', S.weekly)}</div>
      ${S.daily || S.weekly ? `<label class="ob-f">${T('Adresse de réception', 'Delivery address')}</label><input class="ob-in" type="email" id="ob-to" value="${esc(S.email_to)}" placeholder="${esc(window.PKAccount.user.email || '')}">
      <div class="ob-hint">${T('Vide : celle de votre compte. Une autre adresse (professionnelle par exemple) fonctionne aussi.', 'Empty: your account’s. Another address (a work one, say) works too.')}</div>` : ''}
      <label class="ob-f">${T('Mots-clés à suivre', 'Keywords to follow')} <span class="ob-mut">(${T('facultatif', 'optional')})</span></label>
      <div class="ob-kwf"><input class="ob-in" id="ob-kw" maxlength="60" placeholder="${T('Tapez un mot-clé puis Entrée', 'Type a keyword, then Enter')}"><button type="button" class="ob-kwadd" id="ob-kwadd">${T('Ajouter', 'Add')}</button></div>
      <div class="ob-chips ob-kwl">${S.keywords.map((k, i) => `<span class="ob-chip on ob-kw">${esc(k)} <button type="button" data-kwdel="${i}" aria-label="${T('Retirer', 'Remove')}">×</button></span>`).join('')}</div>
      <div class="ob-hint">${T('Chaque article qui les cite remonte dans une rubrique « Vos mots-clés ».', 'Every article that mentions them comes up in a « Your keywords » section.')}</div>`,
    alerts: () => `<h1>${T('Vos alertes', 'Your alerts')}</h1>
      <p class="ob-lead">${T('Un e-mail dès que le marché franchit un seuil qui compte pour vous. Activez une alerte pour la régler.', 'An e-mail as soon as the market crosses a level that matters to you. Turn an alert on to set it.')}</p>
      ${GROUPS.map(([g, ks]) => `<div class="ob-grp">${g}</div>` + S.alerts.map((a, i) => ks.includes(a.kind) ? alertCard(a, i) : '').join('')).join('')}`,
    display: () => `<h1>${T('Votre affichage', 'Your display')}</h1><p class="ob-lead">${T('Comment le site s’ouvre pour vous, sur ce navigateur.', 'How the site opens for you, on this browser.')}</p>
      <label class="ob-f">${T('Langue', 'Language')}</label>${seg('lang', S.lang, [['fr', 'Français'], ['en', 'English']])}

      <label class="ob-f">${T('Page Aujourd’hui', 'Today page')}</label>${seg('view', S.view, [['0', T('Coup d’œil', 'Quick look')], ['1', T('Découverte', 'Discovery')], ['2', 'Expert']])}
      <div class="ob-hint">${T('Coup d’œil : l’essentiel en un écran. Découverte : chaque chiffre expliqué. Expert : tous les chiffres et les lectures d’analyste.', 'Quick look: the essentials on one screen. Discovery: each figure explained. Expert: every figure and the analyst reads.')}</div>`,
    summary: () => { const on = S.alerts.filter(a => a.on);
      return `<div class="ob-k">${T('C’est prêt', 'All set')}</div><h1>${T('Votre PowerKlock', 'Your PowerKlock')}</h1><p class="ob-lead">${T('Voici vos réglages. Tout se modifie dans Réglages, depuis le menu de votre compte.', 'Here are your settings. Everything can be changed in Settings, from your account menu.')}</p>
      <div class="ob-sum">
        <div class="ob-row"><span>${T('Sujets', 'Subjects')}</span><b>${S.interests.size ? S.interests.size + ' ' + T('sujets', 'subjects') : T('édition générale', 'general edition')} · ${S.france ? T('France d’abord', 'France first') : T('France et Europe', 'France and Europe')}</b></div>
        <div class="ob-row"><span>Newsletter</span><b>${[S.daily && '7 O’Klock', S.weekly && 'PowerBrunch'].filter(Boolean).join(', ') || T('aucune', 'none')}</b></div>
        <div class="ob-row"><span>${T('Alertes', 'Alerts')}</span><b>${on.length ? on.map(a => AL[a.kind][0]).filter((x, i, l) => l.indexOf(x) === i).join(', ') : T('aucune', 'none')}</b></div>
        <div class="ob-row"><span>${T('Affichage', 'Display')}</span><b>${S.lang === 'en' ? 'English' : 'Français'} · ${[T('Coup d’œil', 'Quick look'), T('Découverte', 'Discovery'), 'Expert'][+S.view]}</b></div>
      </div>${window.PKTour ? `<p class="ob-hint">${T('Une visite guidée d’une minute vous montre ensuite où trouver chaque chose.', 'A one-minute guided tour then shows you where everything is.')}</p>` : ''}`; },
  };
  const ORDER = ['welcome', 'subjects', 'newsletter', 'alerts', 'display', 'summary'];
  const TABS = [['subjects', T('Sujets', 'Subjects')], ['newsletter', 'Newsletter'], ['alerts', T('Alertes', 'Alerts')], ['display', T('Affichage', 'Display')]];

  // ── the card ──
  let cur = 0, mode = 'first', box = null;
  function draw() {
    const name = mode === 'first' ? ORDER[cur] : TABS[cur][0];
    const steps = ORDER.length - 2;   // welcome and summary are not counted
    const k = mode === 'first' && cur > 0 && cur <= steps ? `<div class="ob-k">${T('Étape', 'Step')} ${cur} ${T('sur', 'of')} ${steps}${name === 'alerts' ? ' · ' + T('facultatif', 'optional') : ''}</div>` : '';
    box.innerHTML = `<div class="ob-top"><img src="assets/logo-header.png" alt="PowerKlock" translate="no" class="ob-logo">${mode === 'first' ? `<button type="button" class="ob-later" id="ob-later">${T('Plus tard', 'Later')}</button>` : `<button type="button" class="ob-later" id="ob-close" aria-label="${T('Fermer', 'Close')}">✕</button>`}</div>
      ${mode === 'first' ? `<div class="ob-bar">${ORDER.map((_, i) => `<i class="${i <= cur ? 'on' : ''}"></i>`).join('')}</div>` : `<div class="ob-tabs" role="tablist">${TABS.map(([t, l], i) => `<button type="button" role="tab" data-tab="${i}" class="${i === cur ? 'on' : ''}" aria-selected="${i === cur}">${l}</button>`).join('')}</div>`}
      <div class="ob-step">${k}${SCREENS[name]()}</div>
      <div class="ob-msg" id="ob-msg" role="status"></div>
      <div class="ob-foot">${mode === 'first' ? `<button type="button" class="ob-back" id="ob-back"${cur ? '' : ' style="visibility:hidden"'}>${T('Retour', 'Back')}</button>
        <button type="button" class="ob-next" id="ob-next">${cur === 0 ? T('Commencer', 'Start') : cur === ORDER.length - 1 ? (window.PKTour ? T('Lancer la visite guidée', 'Start the guided tour') : T('Terminer', 'Finish')) : cur === ORDER.length - 2 ? T('Terminer', 'Finish') : T('Continuer', 'Continue')}</button>`
        : `<span></span><button type="button" class="ob-next" id="ob-save">${T('Enregistrer', 'Save')}</button>`}</div>`;
    wire();
    const st = box.querySelector('.ob-step'); if (st) st.scrollTop = 0;
  }
  function wire() {
    const $ = s => box.querySelector(s), all = s => box.querySelectorAll(s);
    all('[data-int]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.int; S.interests.has(k) ? S.interests.delete(k) : S.interests.add(k); b.classList.toggle('on'); b.setAttribute('aria-pressed', S.interests.has(k)); }));
    all('[data-seg]').forEach(g => g.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const n = g.dataset.seg, v = b.dataset.v; if (n === 'france') S.france = v === '1'; else S[n] = v; g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); })));
    all('[data-sw]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.sw;
      if (id === 'daily' || id === 'weekly') { keepInputs(); S[id] = !S[id]; draw(); return; }
      const i = +id.slice(1); keepInputs(); S.alerts[i].on = !S.alerts[i].on; draw(); scrollToAlert(i);
    }));
    const to = $('#ob-to'); if (to) to.addEventListener('input', () => { S.email_to = to.value.trim(); });
    const kw = $('#ob-kw'), add = () => { kw.value.split(',').map(x => x.trim()).filter(Boolean).forEach(v => { if (!S.keywords.some(k => k.toLowerCase() === v.toLowerCase())) S.keywords.push(v.slice(0, 60)); }); kw.value = ''; keepInputs(); draw(); const k2 = box.querySelector('#ob-kw'); if (k2) k2.focus(); };
    if (kw) { kw.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }); $('#ob-kwadd').addEventListener('click', add); }
    all('[data-kwdel]').forEach(b => b.addEventListener('click', () => { S.keywords.splice(+b.dataset.kwdel, 1); keepInputs(); draw(); }));
    // alerts: numbers, selects, addresses, zones, another of the same kind
    all('[data-step]').forEach(b => b.addEventListener('click', () => { const [i, f, d] = b.dataset.step.split('|'), a = S.alerts[+i];
      const min = f === 'min_hours' ? 0.25 : f === 'threshold' && a.kind === 'corr_break' ? 0.05 : 0;
      a[f] = Math.round(Math.max(min, (+a[f] || 0) + +d) * 100) / 100; const inp = box.querySelector(`[data-num="${i}|${f}"]`); if (inp) inp.value = fx(a[f]); }));
    all('[data-num]').forEach(inp => inp.addEventListener('change', () => { const [i, f] = inp.dataset.num.split('|'), v = parseFloat(inp.value.replace(',', '.')); if (!isNaN(v)) S.alerts[+i][f] = f === 'min_hours' ? Math.max(0.25, Math.round(v * 4) / 4) : v; inp.value = fx(S.alerts[+i][f]); }));
    all('[data-sel]').forEach(s => s.addEventListener('change', () => { const [i, f] = s.dataset.sel.split('|'), a = S.alerts[+i]; a.params = Object.assign({}, a.params, { [f]: f === 'cal' ? +s.value : s.value }); keepInputs(); draw(); scrollToAlert(+i); }));
    all('[data-to]').forEach(inp => inp.addEventListener('input', () => { S.alerts[+inp.dataset.to].email_to = inp.value.trim(); }));
    all('[data-add]').forEach(b => b.addEventListener('click', () => { keepInputs(); const i = +b.dataset.add, a = S.alerts[i];
      S.alerts.splice(i + 1, 0, Object.assign({ kind: a.kind, on: true, email_to: '' }, JSON.parse(JSON.stringify(DEF[a.kind])))); draw(); scrollToAlert(i + 1); }));
    all('[data-dd]').forEach(dd => {
      const i = +dd.dataset.dd, boxes = [...dd.querySelectorAll('.ob-zo input')];
      const sync = () => { S.alerts[i].zones = boxes.filter(x => x.checked).map(x => x.value); };
      dd.querySelector('.ob-ddb').addEventListener('click', () => { all('.ob-dd.open').forEach(x => x !== dd && x.classList.remove('open')); dd.classList.toggle('open'); const q = dd.querySelector('.ob-dds'); if (dd.classList.contains('open') && q) q.focus(); });
      boxes.forEach(x => x.addEventListener('change', sync));
      dd.querySelector('[data-all]').addEventListener('click', e => { e.preventDefault(); boxes.forEach(x => { x.checked = true; }); sync(); });
      dd.querySelector('[data-none]').addEventListener('click', e => { e.preventDefault(); boxes.forEach(x => { x.checked = false; }); sync(); });
      dd.querySelector('.ob-ddok').addEventListener('click', () => { keepInputs(); draw(); scrollToAlert(i); });
      dd.querySelector('.ob-dds').addEventListener('input', e => { const q = e.target.value.toLowerCase(); boxes.forEach(x => { x.parentNode.style.display = x.parentNode.textContent.toLowerCase().includes(q) ? '' : 'none'; }); });
    });
    all('[data-tab]').forEach(b => b.addEventListener('click', () => { keepInputs(); cur = +b.dataset.tab; draw(); }));
    const later = $('#ob-later'); if (later) later.addEventListener('click', () => { mark(); close(); toast(T('Vous retrouverez ces réglages dans le menu de votre compte, en haut à droite.', 'You will find these settings in your account menu, at the top right.')); });
    const cl = $('#ob-close'); if (cl) cl.addEventListener('click', close);
    const back = $('#ob-back'); if (back) back.addEventListener('click', () => { keepInputs(); cur = Math.max(0, cur - 1); draw(); });
    const next = $('#ob-next'); if (next && mode === 'first') next.addEventListener('click', async () => {
      keepInputs();
      if (!check()) return;
      if (ORDER[cur] === 'display') { if (!await save()) return; }
      if (cur === ORDER.length - 1) { finish(); return; }
      cur++; draw();
    });
    const sv = $('#ob-save'); if (sv) sv.addEventListener('click', async () => { keepInputs(); if (!check()) return; if (await save()) { const relang = S.lang !== ((window.PKI18n && PKI18n.lang) || 'fr'); close(); toast(T('Réglages enregistrés', 'Settings saved')); if (relang) location.reload(); } });
  }
  const keepInputs = () => { const to = box && box.querySelector('#ob-to'); if (to) S.email_to = to.value.trim(); };
  const scrollToAlert = i => requestAnimationFrame(() => { const c = box.querySelectorAll('.ob-al')[S.alerts.slice(0, i).length]; const st = box.querySelector('.ob-step');
    const el = [...box.querySelectorAll('.ob-al')].find(x => x.querySelector(`[data-sw="a${i}"]`)) || c; if (el && st) st.scrollTop = el.offsetTop - st.offsetTop - 12; });
  const okMail = v => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  function check() {
    const msg = box.querySelector('#ob-msg'); msg.textContent = '';
    const name = mode === 'first' ? ORDER[cur] : TABS[cur][0];
    if ((name === 'newsletter' || mode !== 'first') && !okMail(S.email_to)) { msg.textContent = T('Adresse de réception non valide.', 'Invalid delivery address.'); return false; }
    if (name === 'alerts' || mode !== 'first') {
      const bad = S.alerts.find(a => a.on && ((['neg_price', 'base_above', 'base_below'].includes(a.kind) && !(a.zones || []).length) || !okMail(a.email_to)));
      if (bad) { msg.textContent = !okMail(bad.email_to) ? T('Une adresse d’alerte n’est pas valide.', 'An alert address is not valid.') : T('Choisissez au moins une zone pour « ', 'Choose at least one zone for « ') + AL[bad.kind][0] + ' ».'; return false; }
    }
    return true;
  }

  // ── saving ──
  async function save() {
    const A = window.PKAccount, cl = A.client(), uid = A.user.id, msg = box.querySelector('#ob-msg');
    msg.textContent = T('Enregistrement…', 'Saving…');
    try {
      const own = (A.user.email || '').toLowerCase();
      const row = Object.assign({ profiles: [], exclude: [] }, S.me, { user_id: uid, interests: [...S.interests], france: S.france, daily: S.daily, weekly: S.weekly,
        email_to: S.email_to && S.email_to.toLowerCase() !== own ? S.email_to : null, onboarded_at: S.me.onboarded_at || new Date().toISOString(), updated_at: new Date().toISOString() });
      let r = await cl.from('news_profile').upsert(row, { onConflict: 'user_id' }); if (r.error) throw r.error;
      S.me = row;
      // keywords: the list as shown (team keywords are kept as they are)
      const { data: had } = await cl.from('news_keyword').select('keyword, team').eq('user_id', uid);
      const gone = (had || []).filter(x => !x.team && !S.keywords.some(k => k.toLowerCase() === x.keyword.toLowerCase())).map(x => x.keyword);
      if (gone.length) { r = await cl.from('news_keyword').delete().eq('user_id', uid).in('keyword', gone); if (r.error) throw r.error; }
      const add = S.keywords.filter(k => !(had || []).some(x => x.keyword.toLowerCase() === k.toLowerCase()));
      if (add.length) { r = await cl.from('news_keyword').upsert(add.map(k => ({ user_id: uid, keyword: k, team: false })), { onConflict: 'user_id,keyword' }); if (r.error) throw r.error; }
      // alerts: a rule already saved is updated (off = paused, never deleted here); a new one turned on is added
      for (const a of S.alerts) {
        const f = { kind: a.kind, active: !!a.on, zones: isCal(a.kind) ? [(a.params || {}).country || 'FR'] : ['neg_price', 'base_above', 'base_below'].includes(a.kind) ? a.zones : ['FR'],
          min_hours: a.kind === 'neg_price' ? Math.max(0.25, +a.min_hours || 0.25) : null, threshold: ['pp1', 'pp2', 'neg_price'].includes(a.kind) ? null : +a.threshold,
          params: isCal(a.kind) ? a.params : {}, email: true, email_to: a.email_to && a.email_to.toLowerCase() !== own ? a.email_to : null };
        if (a.id) { r = await cl.from('alert_rule').update(f).eq('id', a.id); if (r.error) throw r.error; }
        else if (a.on) { r = await cl.from('alert_rule').insert(f).select('id').single(); if (r.error) throw r.error; a.id = r.data.id; }
      }
      // this browser's display
      if (window.PKTheme) PKTheme.apply(S.theme); else lsSet('pk-theme', S.theme);
      lsSet('pk-view-default-morning', S.view);
      if (S.lang !== ((window.PKI18n && PKI18n.lang) || 'fr')) lsSet('pk-lang', S.lang);
      try { localStorage.setItem('pk-nl-interests', JSON.stringify({ interests: [...S.interests], france: S.france })); } catch (_) {}
      if (window.PKAlerts && PKAlerts.refresh) PKAlerts.refresh();
      if (typeof _nlLoadMe === 'function') { try { await _nlLoadMe(); if (typeof renderNewsHome === 'function') renderNewsHome(); } catch (_) {} }
      msg.textContent = '';
      return true;
    } catch (e) {
      msg.textContent = T('Non enregistré : ', 'Not saved: ') + (e.message || e);
      return false;
    }
  }
  async function mark() {
    const A = window.PKAccount; if (!A || !A.user) return;
    try { await A.client().from('news_profile').upsert(Object.assign({ profiles: [], exclude: [] }, S && S.me, { user_id: A.user.id, onboarded_at: new Date().toISOString() }), { onConflict: 'user_id' }); } catch (_) {}
  }
  function finish() {
    close();
    const relang = S.lang !== ((window.PKI18n && PKI18n.lang) || 'fr');
    if (relang) { lsSet('pk-tour-pending', '1'); location.reload(); return; }
    if (window.PKTour) PKTour.start(); else toast(T('Bienvenue sur PowerKlock', 'Welcome to PowerKlock'));
  }
  const toast = t => { const d = document.createElement('div'); d.className = 'ob-toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 4200); };
  function close() { const o = document.getElementById('ob-ov'); if (o) o.remove(); document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('ob-lock'); }
  const onKey = e => { if (e.key === 'Escape' && mode !== 'first') close(); };

  async function open(m, tab) {
    const A = window.PKAccount; if (!A || !A.user || !A.client()) return;
    mode = m === 'settings' ? 'settings' : 'first';
    await load();
    cur = mode === 'first' ? 0 : Math.max(0, TABS.findIndex(t => t[0] === tab));
    close();
    const ov = document.createElement('div'); ov.id = 'ob-ov'; ov.className = 'ob-ov' + (mode === 'first' ? ' ob-first' : '');
    ov.innerHTML = `<div class="ob" role="dialog" aria-modal="true" aria-label="${mode === 'first' ? T('Bienvenue sur PowerKlock', 'Welcome to PowerKlock') : T('Réglages', 'Settings')}"></div>`;
    ov.setAttribute('translate', 'no');   // written in both languages here: the page translator leaves it alone
    if (mode !== 'first') ov.addEventListener('click', e => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    document.documentElement.classList.add('ob-lock');
    document.addEventListener('keydown', onKey);
    box = ov.querySelector('.ob');
    draw();
  }

  // the first sign-in of an approved account: once, a moment after the site has opened (not on a shared dashboard)
  let checked = null;
  async function maybeFirst() {
    const A = window.PKAccount;
    if (!A || !A.user || document.body.classList.contains('pk-solo') || /^#(solo|board)=/.test(location.hash) || document.documentElement.classList.contains('pk-public')) return;
    if (checked === A.user.id) return; checked = A.user.id;
    try {
      const cl = A.client();
      const { data: ok } = await cl.rpc('is_approved'); if (!ok) return;
      const { data } = await cl.from('news_profile').select('onboarded_at').eq('user_id', A.user.id).maybeSingle();
      if (data && data.onboarded_at) { if (lsGet('pk-tour-pending', '') === '1' && window.PKTour) { lsSet('pk-tour-pending', ''); setTimeout(() => PKTour.start(), 1200); } return; }
      setTimeout(() => open('first'), 1200);
    } catch (e) { console.warn('[onboarding]', e); }
  }
  function boot() {
    const A = window.PKAccount; if (!A || !A.configured) return;
    A.ready().then(maybeFirst);
    if (A.onChange) A.onChange(() => maybeFirst());
  }
  window.PKSetup = { open, first: () => open('first'), settings: tab => open('settings', tab) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
