(function () {
  'use strict';
  const D = window.PK, GEO = window.PKGEO2.features;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ss = t => { t = clamp(t); return t * t * (3 - 2 * t); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let lang = 'fr';
  const tr = (f, e) => lang === 'fr' ? f : e;
  const fmt = (v, d = 2) => new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v).replace('-', '−');
  const sgn = (v, d = 2) => (v > 0 ? '+' : '') + fmt(v, d);
  const MO = { fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
  const mo = i => MO[lang][i];
  const day = iso => { const [y, m, d] = iso.split('-').map(Number); return lang === 'fr' ? `${d === 1 ? '1er' : d} ${mo(m - 1)} ${y}` : `${d} ${mo(m - 1)} ${y}`; };
  const dayS = iso => day(iso).replace(/ \d{4}$/, '');
  const hhmm = q => String(Math.floor(q / 4)).padStart(2, '0') + ':' + String((q % 4) * 15).padStart(2, '0');
  const hfr = q => Math.floor(q / 4) + '\u00a0h' + (q % 4 ? '\u00a0' + (q % 4) * 15 : '');
  const QL = [...Array(96)].map((_, q) => hhmm(q));
  const T = D.tom, H = T.h, chg = T.avg - D.tod_avg;
  // the visitor's Paris date: the curve is labelled "today" or "tomorrow" from it
  const parisToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const isToday = T.date === parisToday, isTom = T.date > parisToday;

  // ── texts (French first, English ready) ──
  const I = {
    beta: ['bêta', 'beta'], eyebrow: ['Électricité · France et Europe', 'Power · France and Europe'], discover: ['Découvrir le site', 'Discover the site'], published: ['publié', 'published'],
    note0: ['Gratuit, sur validation · mot de passe, Google ou code par e-mail', 'Free, on approval · password, Google or e-mail code'], 'b-ppa': ['PPA benchmark · France', 'PPA benchmark · France'], 'u-ppas': ['€/MWh solaire', '€/MWh solar'], 'u-ppaw': ['€/MWh éolien', '€/MWh wind'],
    'k-news': ['Veille', 'Intelligence'], 'l-news': ['Presse, régulateurs, Journal officiel et consultations, triés par sujet. Chaque matin, 7 O\'Klock résume ce qui compte pour votre métier ; le lundi, PowerBrunch fait le récap de la semaine.', 'Press, regulators, the Official Journal and consultations, sorted by topic. Every morning 7 O\'Klock sums up what matters for your job; on Mondays PowerBrunch recaps the week.'],
    nl: ['7 O\'Klock, chaque jour ouvré', '7 O\'Klock, every working day'], 'open-news': ['Ouvrir la veille', 'Open the news'], d30: ['30 j', '30 d'], d60: ['60 j', '60 d'], signin: ['Se connecter', 'Sign in'],
    h1: ['Tout le marché de l\'électricité, <em>au même endroit</em>.', 'The whole power market, <em>in one place</em>.'],
    lead0: ['Prix dans 30&nbsp;zones européennes, prix négatifs, renouvelables, outils de pricing PPA et M0, veille et newsletter. Des données publiques, recoupées avec une deuxième source et mises à jour toute la journée.', 'Prices in 30&nbsp;European zones, negative prices, renewables, M0, news and a newsletter. Public data, cross-checked and updated all day.'],
    lo: ['Plus bas', 'Low'], hi: ['Plus haut', 'High'], pb: ['Pointe − base', 'Peak − base'], free: ['Gratuit, sur validation', 'Free, on approval'],
    k1: ['Prix de l\'électricité · Europe', 'Power prices · Europe'], g1u: ['zones de prix', 'bidding zones'], g1u2: ['au quart d\'heure', 'by quarter-hour'],
    'h2-1': ['La même journée, <em>vue d\'Europe</em>.', 'The same day, <em>seen from Europe</em>.'],
    lead1: ['Rejouez la journée heure par heure, survolez un pays pour voir sa courbe. Le prix de demain arrive dès sa publication, vers 13&nbsp;h.', 'Replay the day hour by hour, hover a country to see its curve. Tomorrow\'s price lands as soon as it is published, around 1&nbsp;pm.'],
    open1: ['Ouvrir les prix', 'Open prices'], lock: ['après connexion', 'after sign-in'],
    k2: ['Renouvelables · prix négatifs', 'Renewables · negative prices'], g2u: ['heures sous zéro', 'hours below zero'],
    'h2-2': ['Quand le vent et le soleil <em>dépassent la demande</em>.', 'When wind and sun <em>outrun demand</em>.'],
    open2: ['Ouvrir Renouvelables', 'Open Renewables'],
    k3: ['Outils · M0 et PPA', 'Tools · M0 and PPA'],
    'h2-3': ['Ce que le solaire et l\'éolien <em>captent vraiment</em>.', 'What solar and wind <em>really capture</em>.'],
    lead3: ['La M0 du mois recalculée selon la méthode de la CRE, un prix de référence PPA rejoué sur le passé et la valeur d\'une batterie sur le day-ahead.', 'The monthly M0 recomputed with the CRE method, a PPA reference price replayed on the past and the value of a battery on the day-ahead.'],
    open3: ['Ouvrir les outils', 'Open tools'],
    k4: ['Mes tableaux de bord', 'My dashboards'], g4: ['Votre dashboard.', 'Your dashboard.'],
    lead4: ['Choisissez vos graphiques dans le catalogue du site, rangez-les comme vous voulez, retrouvez-les sur tous vos appareils. Partagez un dashboard par lien ou affichez-le dans l\'open space.', 'Pick your charts from the site\'s catalogue, arrange them your way, find them on every device. Share a dashboard by link or put it on the office wall.'],
    open4: ['Créer mon tableau de bord', 'Build my dashboard'],
    hint: ['Faites défiler : la courbe change de forme', 'Scroll: the curve changes shape'],
    lead1b: ['', ''],
    bh: ['pages, du prix de demain au bilan de l\'année.', 'pages, from tomorrow\'s price to the yearly review.'],
    bp: ['Des graphiques du site, alimentés par les mêmes fichiers. Survolez pour lire les valeurs.', 'Charts from the site, fed by the same files. Hover to read the values.'],
    'b-nuc': ['Nucléaire disponible · France', 'Nuclear available · France'],
    's-nuc': ['Puissance nucléaire disponible, moyenne par jour (GW). Source : RTE, via PowerKlock.', 'Available nuclear capacity, daily average (GW). Source: RTE, via PowerKlock.'],
    'b-heat': ['Prix France · heure × mois', 'France price · hour × month'], 'h-heat': ['La cloche solaire se creuse d\'avril à août.', 'The solar dip deepens from April to August.'],
    's-heat': ['Prix day-ahead moyen par heure et par mois (€/MWh), blanc = négatif. Source : ENTSO-E, via PowerKlock.', 'Average day-ahead price by hour and month (€/MWh), white = negative. Source: ENTSO-E, via PowerKlock.'],
    'b-flow': ['Flux aux frontières', 'Cross-border flows'], 'b-flow2': ['net', 'net'], 'u-flow': ['GW exportés', 'GW exported'],
    's-flow': ['Échanges commerciaux nets par frontière (GW), dernier relevé. Source : RTE éCO2mix.', 'Net commercial exchanges by border (GW), latest reading. Source: RTE éCO2mix.'],
    'b-ttf': ['Gaz TTF · day-ahead', 'TTF gas · day-ahead'], 'b-spr': ['Rejouer une journée', 'Replay a day'],
    's-spr': ['Éolien et solaire (GW, empilés) et prix day-ahead (€/MWh), France. Source : ENTSO-E, via PowerKlock.', 'Wind and solar (GW, stacked) and day-ahead price (€/MWh), France. Source: ENTSO-E, via PowerKlock.'],
    'b-news': ['Veille · derniers titres', 'News · latest headlines'], 's-news': ['Titres et liens uniquement, jamais le texte des articles.', 'Headlines and links only, never the text of articles.'],
    'b-nl2': ['newsletter', 'newsletter'], 'h-nl': ['Chaque jour ouvré, ce qui compte pour votre métier. Le lundi, PowerBrunch résume la semaine.', 'Every working day, what matters for your job. On Mondays, PowerBrunch sums up the week.'],
    'b-pages': ['Tout le menu', 'The whole menu'],
    fh: ['Le site complet, gratuit, <span class="n">ouvert après validation</span>.', 'The full site, free, <span class="n">open after approval</span>.'],
    'c-pages': ['pages', 'pages'], 'c-zones': ['zones de prix', 'bidding zones'], 'c-src': ['sources de veille', 'news sources'],
    fnote: ['Connexion par mot de passe, Google ou code par e-mail. Les nouveaux comptes sont ouverts après validation. Données hébergées dans l\'Union européenne.', 'Sign in with a password, Google or an e-mail code. New accounts are opened after approval. Data hosted in the European Union.'],
    stay: ['Vous restez connecté sur ce navigateur.', 'You stay signed in on this browser.'], google: ['Continuer avec Google', 'Continue with Google'], or: ['ou', 'or'],
    mail: ['E-mail', 'E-mail'], pw: ['Mot de passe', 'Password'], code: ['Recevoir un code par e-mail', 'Get a code by e-mail'], noacc: ['Pas de compte ?', 'No account?'], create: ['Créer un compte', 'Create an account'],
    demo: ['Maquette : rien n\'est envoyé. Sur le site, ce formulaire ouvre la connexion existante, puis la page se transforme en site complet.', 'Mockup: nothing is sent. On the site, this form opens the existing sign-in, then the page turns into the full site.'],
    foot: ['Données publiques : ENTSO-E, RTE, ODRÉ, CRE. Maquette de la page de garde, non intégrée au site.', 'Public data: ENTSO-E, RTE, ODRÉ, CRE. Landing page mockup, not part of the site yet.'],
    w1: ['Transition vers le site complet.', 'Transition to the full site.'], w2: ['Ici, la fenêtre de connexion existante valide le compte, puis la page de garde s\'ouvre sur Aujourd\'hui.', 'Here the existing sign-in window checks the account, then the landing page opens onto Today.'], w3: ['Revenir à la maquette', 'Back to the mockup'],
  };
  const ZEN = { DK_E: 'Denmark East', HU: 'Hungary', SK: 'Slovakia', AT: 'Austria', DK_W: 'Denmark West', DE_LU: 'Germany', CZ: 'Czechia', CH: 'Switzerland', IT_NORD: 'Italy North', SI: 'Slovenia', NL: 'Netherlands', IT_SICI: 'Sicily', BE: 'Belgium', HR: 'Croatia', FR: 'France', LT: 'Lithuania', RO: 'Romania', RS: 'Serbia', BG: 'Bulgaria', NO_1: 'Norway (Oslo)', PL: 'Poland', GR: 'Greece', LV: 'Latvia', ES: 'Spain', PT: 'Portugal', MK: 'North Macedonia', ME: 'Montenegro', EE: 'Estonia', FI: 'Finland', SE: 'Sweden' };
  const zn = z => lang === 'fr' ? z[1] : (ZEN[z[0]] || z[1]);
  const MENU = [
    [['Marchés', 'Markets'], [['Ce qui fait le prix', 'What drives the price'], ['Day-ahead', 'Day-ahead'], ['Prix négatifs', 'Negative prices'], ['Spreads', 'Spreads'], ['Écarts', 'Imbalance'], ['Gaz, carbone et pétrole', 'Gas, carbon & oil'], ['Spark et dark spreads', 'Spark & dark spreads'], ['Garanties d\'origine', 'Guarantees of origin'], ['Batteries (BESS)', 'Batteries (BESS)']]],
    [['Renouvelables', 'Renewables'], [['Capture et cannibalisation', 'Capture & cannibalisation'], ['M0 et appels d\'offres CRE', 'M0 & CRE tenders'], ['Capacité installée', 'Installed capacity']]],
    [['Système électrique', 'Power system'], [['Carte d\'Europe', 'Europe map'], ['Mix de production', 'Generation mix'], ['Nucléaire', 'Nuclear'], ['Indisponibilités et REMIT', 'Outages & REMIT'], ['Consommation', 'Demand'], ['Flux transfrontaliers', 'Cross-border flows'], ['Régions', 'Regions'], ['Météo', 'Weather'], ['DJU', 'HDD / CDD'], ['Bilan de l\'année', 'Yearly review'], ['Intensité carbone', 'Carbon intensity']]],
    [['Outils', 'Tools'], [['Pricer PPA', 'PPA pricer'], ['Pricer BOA', 'BOA pricer'], ['Prévision de production', 'Production forecast'], ['Empreinte carbone', 'Carbon footprint'], ['Analyse de marché', 'Market analysis'], ['Rejouer une journée', 'Replay a day'], ['Comparateur', 'Compare'], ['Convertisseur', 'Converter']]],
    [['Veille', 'Intelligence'], [['Actualités', 'News'], ['Réglementation', 'Regulation'], ['7 O\'Klock', '7 O\'Klock'], ['API', 'API'], ['Méthodologie', 'Methodology'], ['Jeux', 'Games']]],
  ];

  // ── NumberFlow: figures roll digit by digit ──
  function nf(el, v, d = 2, suf) {
    if (!el) return;
    if (el.update) { el.locales = lang === 'fr' ? 'fr-FR' : 'en-GB'; el.format = { minimumFractionDigits: d, maximumFractionDigits: d }; if (suf != null) el.numberSuffix = suf; el.update(v); }
    else el.textContent = fmt(v, d) + (suf || '');
  }

  // ── the site's palette and Chart.js defaults (js/pk-chart-system.js) ──
  const PAL = { grid: 'rgba(26,45,63,.5)', text2: '#B8C9D9', text3: '#7A93AB', ref: '#B8C9D9', base: '#E8EEF4', up: '#ED6965', down: '#14D3A9', now: '#FFFD82', neg: '#8B93FF',
    fuel: { nuclear: '#9B6BC4', hydro: '#5CB2F5', wind: '#14D3A9', solar: '#FBBF24', biomass: '#4E8A2C', fossil: '#ED6965', gas: '#F79A3E' }, zone: { FR: '#14D3A9' } };
  const alpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const HAS = !!window.Chart;
  if (HAS) {
    const C = Chart.defaults;
    C.font.family = "'JetBrains Mono', monospace"; C.font.size = 10; C.color = PAL.text3; C.borderColor = PAL.grid;
    C.elements.line.tension = 0; C.elements.line.borderWidth = 1.5; C.elements.point.radius = 0; C.elements.point.hoverRadius = 3;
    C.plugins.legend.position = 'bottom'; C.plugins.legend.labels.boxWidth = 10; C.plugins.legend.labels.boxHeight = 10; C.plugins.legend.labels.color = PAL.text2;
    C.scale.grid.color = PAL.grid; C.scale.grid.drawTicks = false; C.scale.ticks.color = PAL.text3; C.scale.ticks.padding = 6;
    C.maintainAspectRatio = false; C.animation.duration = reduce ? 0 : 700; C.animation.easing = 'easeOutCubic';
    C.plugins.tooltip.backgroundColor = '#0f1419'; C.plugins.tooltip.borderColor = '#243447'; C.plugins.tooltip.borderWidth = 1; C.plugins.tooltip.titleColor = '#fff'; C.plugins.tooltip.bodyColor = PAL.text2; C.plugins.tooltip.padding = 9; C.plugins.tooltip.displayColors = false;
  }
  const charts = {};
  const mk = (id, cfg) => { if (!HAS) return null; const c = $('#' + id); const old = Chart.getChart(c); if (old) old.destroy(); return (charts[id] = new Chart(c, cfg)); };
  const cursorPlugin = { id: 'pkCursor', afterDatasetsDraw(ch) { const q = ch.$q; if (q == null) return; const p = ch.getDatasetMeta(0).data[q]; if (!p) return; const c = ch.ctx, a = ch.chartArea; c.save(); c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x, a.top); c.lineTo(p.x, a.bottom); c.stroke(); c.fillStyle = PAL.now; c.strokeStyle = '#0a0e13'; c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, 5, 0, 7); c.fill(); c.stroke(); c.restore(); } };
  const areaFill = (hex, a0 = .3) => ctx => { const a = ctx.chart.chartArea; if (!a) return 'transparent'; const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, alpha(hex, a0)); g.addColorStop(1, alpha(hex, 0)); return g; };

  // ── data prepared once ──
  const byZ = Object.fromEntries(D.eu.map(z => [z[0], z]));
  const ISO2Z = { DE: 'DE_LU', LU: 'DE_LU', IT: 'IT_NORD', NO: 'NO_1', DK: 'DK_W' };
  const zoneOf = f => byZ[ISO2Z[f.properties.iso] || f.properties.iso] || null;
  const priced = GEO.map((f, i) => ({ f, i, z: zoneOf(f) })).filter(x => x.z).sort((a, b) => a.z[2] - b.z[2]);
  const orderOf = new Map(priced.map((x, k) => [x.i, k]));
  const pLo = D.eu[D.eu.length - 1][2], pHi = D.eu[0][2];
  const STOPS = [[27, 107, 143], [20, 211, 169], [238, 155, 0], [237, 105, 101]];
  const colA = p => { const t = clamp((p - pLo) / (pHi - pLo || 1)) * 3, i = Math.min(2, Math.floor(t)), u = t - i; return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * u)); };
  const col = p => `rgb(${colA(p).join(',')})`;
  let mapHour = null, mapZone = null;
  const hAll = D.eu.flatMap(z => z[6]).sort((a, b) => a - b), hLo = hAll[Math.floor(hAll.length * .02)], hHi = hAll[Math.floor(hAll.length * .98)];
  const colH = p => { const t = clamp((p - hLo) / (hHi - hLo || 1)) * 3, i = Math.min(2, Math.floor(t)), u = t - i; return `rgb(${STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * u)).join(',')})`; };
  const rankFR = D.eu.findIndex(z => z[0] === 'FR') + 1;
  const negPts = D.negD.map(([iso, h, avg]) => ({ x: +iso.slice(8), y: +iso.slice(5, 7) - 1, v: h, iso, avg }));
  const negMax = Math.max(...negPts.map(p => p.v)), negTop = negPts.reduce((a, b) => b.v > a.v ? b : a);
  const lastMonth = Math.max(...negPts.map(p => p.y));
  const cumNeg = [...Array(12)].map((_, m) => Math.round(Math.round(negPts.filter(p => p.y <= m).reduce((a, p) => a + p.v, 0) * 10) / 10));
  const top96 = negPts.map((p, i) => ({ i, v: p.v })).sort((a, b) => b.v - a.v).slice(0, 96).map(x => x.i);
  const M0 = D.m0, m0lab = () => M0.map(m => mo(+m[0].slice(5) - 1) + (m[0].slice(5) === '01' || m === M0[0] ? ' ' + m[0].slice(2, 4) : ''));
  const netFR = D.flows.reduce((a, f) => a + f.net, 0);
  const mixTot = Object.values(D.mix).reduce((a, b) => a + b, 0);
  const sprNeg = D.spring.hourly.map((v, i) => v < 0 ? i : -1).filter(i => i >= 0);

  // ── scroll-driven build state ──
  const B = { map: priced.length, month: lastMonth, m0: M0.length - 1 };

  // ════════ the five shapes of the stage ════════
  function buildStage() {
    // 0 · 96 quarter-hours
    const qHi = H.indexOf(T.max), qLo = H.indexOf(T.min), YD = D.prev_h, yLo = Math.floor((T.min - 8) / 50) * 50, yHi = Math.ceil((T.max + 8) / 50) * 50;
    // the line takes the colour of its price level (the scale of the Europe map); yesterday stays behind, dashed
    const ramp = (ctx, a) => { const ar = ctx.chart.chartArea; if (!ar) return PAL.zone.FR; const g = ctx.chart.ctx.createLinearGradient(0, ar.bottom, 0, ar.top), s = [[20, 211, 169], [238, 155, 0], [237, 105, 101]], y = ctx.chart.scales.y, p = v => clamp((y.getPixelForValue(v) - ar.bottom) / (ar.top - ar.bottom)); g.addColorStop(0, `rgba(${s[0]},${a})`); g.addColorStop(p(T.min), `rgba(${s[0]},${a})`); g.addColorStop(p((T.min + T.max) / 2), `rgba(${s[1]},${a})`); g.addColorStop(p(T.max), `rgba(${s[2]},${a})`); g.addColorStop(1, `rgba(${s[2]},${a})`); return g; };
    const fillRamp = ctx => { const ar = ctx.chart.chartArea; if (!ar) return 'transparent'; const g = ctx.chart.ctx.createLinearGradient(0, ar.top, 0, ar.bottom); g.addColorStop(0, 'rgba(237,105,101,.20)'); g.addColorStop(.5, 'rgba(238,155,0,.08)'); g.addColorStop(1, 'rgba(20,211,169,0)'); return g; };
    const heroMarks = { id: 'heroMarks',
      afterDatasetsDraw(ch) { const m = ch.getDatasetMeta(0).data, c = ch.ctx, a = ch.chartArea; c.save(); c.font = "600 10.5px 'JetBrains Mono', monospace"; [[qHi, PAL.up, -10], [qLo, PAL.down, 17]].forEach(([q, col, dy]) => { const p = m[q]; if (!p) return; c.fillStyle = '#0f1419'; c.beginPath(); c.arc(p.x, p.y, 5, 0, 7); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(p.x, p.y, 3.2, 0, 7); c.fill(); c.textAlign = p.x > a.right - 40 ? 'right' : p.x < a.left + 40 ? 'left' : 'center'; c.fillText(fmt(H[q], 0) + ' €', p.x, p.y + dy); });
        // the cursor glides along the line (fractional quarter-hour) with its price in a small label
        const qf = ch.$qf; if (qf != null) { const i = Math.min(94, Math.floor(qf)), f = qf - i, p0 = m[i], p1 = m[i + 1]; if (p0 && p1) { const x = p0.x + (p1.x - p0.x) * f, y = p0.y + (p1.y - p0.y) * f, v = H[i] + (H[i + 1] - H[i]) * f;
          c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, a.top); c.lineTo(x, a.bottom); c.stroke(); c.setLineDash([]);
          c.fillStyle = 'rgba(255,253,130,.2)'; c.beginPath(); c.arc(x, y, 9, 0, 7); c.fill(); c.fillStyle = PAL.now; c.strokeStyle = '#0a0e13'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 4.5, 0, 7); c.fill(); c.stroke();
          const lab = hhmm(Math.round(qf) % 96) + '  ' + fmt(v, 0) + ' €'; c.font = "600 11px 'JetBrains Mono', monospace"; const w = c.measureText(lab).width + 16, bx = clamp(x - w / 2, a.left, a.right - w), by = y - 34 < a.top ? y + 14 : y - 34;
          c.fillStyle = '#0a0e13'; c.strokeStyle = '#243447'; c.lineWidth = 1; c.beginPath(); c.roundRect(bx, by, w, 22, 6); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(lab, bx + 8, by + 11.5); } }
        c.restore(); } };
    mk('c-curve', { type: 'line', plugins: [heroMarks],
      data: { labels: QL, datasets: [
        { label: 'France', data: H, borderColor: PAL.zone.FR, borderWidth: 2.2, fill: { target: 'start' }, backgroundColor: areaFill(PAL.zone.FR, .28) },
        { label: tr('Moyenne', 'Average'), data: H.map(() => T.avg), borderColor: 'rgba(184,201,217,.7)', borderWidth: 1.1, borderDash: [4, 4] }] },
      options: { animation: { duration: reduce ? 0 : 1400 }, events: [], plugins: { legend: { display: false }, tooltip: { enabled: false } }, layout: { padding: { top: 16 } },
        scales: { x: { ticks: { maxRotation: 0, autoSkip: false, callback: (v, i) => i % 24 === 0 ? (i / 4) + (lang === 'fr' ? ' h' : ':00') : '' }, grid: { display: false } },
          y: { position: 'right', min: yLo, max: yHi, ticks: { stepSize: 50, callback: v => v + ' €' } } } } });
    // 1 · Europe coloured by the day's average
    if (HAS && window.ChartGeo) mk('c-map', { type: 'choropleth',
      data: { labels: GEO.map(f => f.properties.name), datasets: [{ label: tr('Prix moyen', 'Average price'), outline: priced.map(x => x.f), showOutline: false,
        data: GEO.map(f => ({ feature: f, value: zoneOf(f) ? zoneOf(f)[2] : null })),
        backgroundColor: c => { const z = c.raw && zoneOf(c.raw.feature); if (!z) return '#111820'; return mapHour == null ? col(z[2]) : colH(z[6][mapHour]); },
        borderColor: c => (c.raw && c.raw.feature.properties.iso === 'FR') ? '#ffffff' : '#0a0e13',
        borderWidth: c => (c.raw && c.raw.feature.properties.iso === 'FR') ? 1.6 : .6, hoverBorderColor: '#ffffff', hoverBorderWidth: 1.6 }] },
      options: { animation: false, onHover: (e, els) => { const z = els[0] && zoneOf(GEO[els[0].index]); readMap(z || byZ.FR); }, onClick: (e, els) => { const z = els[0] && zoneOf(GEO[els[0].index]); if (z) readMap(z); },
        plugins: { legend: { display: false }, tooltip: { filter: c => c.raw && c.raw.value != null, callbacks: { title: () => '', label: c => { const z = zoneOf(c.raw.feature); return ` ${zn(z)} : ${fmt(mapHour == null ? z[2] : z[6][mapHour], mapHour == null ? 2 : 0)} €/MWh`; } } } },
        scales: { projection: { axis: 'x', projection: 'azimuthalEqualArea', projectionScale: 1 }, color: { axis: 'x', display: false } } } });
    // 2 · every day of the year, hours below zero
    mk('c-neg', { type: 'matrix',
      data: { datasets: [{ label: tr('Heures négatives', 'Negative hours'), data: negPts,
        backgroundColor: c => { const r = c.raw; if (!r) return 'transparent'; if (r.y > B.month) return 'rgba(122,147,171,.05)'; return r.v > 0 ? alpha(PAL.down, .2 + .8 * r.v / negMax) : 'rgba(122,147,171,.10)'; },
        borderRadius: 3, borderWidth: 0, hoverBackgroundColor: '#ffffff',
        width: ({ chart }) => Math.max(2, (chart.chartArea || {}).width / 31 - 2), height: ({ chart }) => Math.max(2, (chart.chartArea || {}).height / (lastMonth + 1) - 3) }] },
      options: { animation: false, onHover: (e, els) => readNeg(els[0] ? negPts[els[0].index] : null),
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: () => '', label: c => ` ${day(c.raw.iso)} : ${fmt(c.raw.v, 1)} h` } } },
        scales: { x: { type: 'linear', min: .5, max: 31.5, offset: false, position: 'top', grid: { display: false }, border: { display: false }, afterBuildTicks: a => { a.ticks = [1, 5, 10, 15, 20, 25, 31].map(v => ({ value: v })); } },
          y: { type: 'linear', min: -.5, max: lastMonth + .5, reverse: true, offset: false, grid: { display: false }, border: { display: false }, afterBuildTicks: a => { a.ticks = [...Array(lastMonth + 1)].map((_, v) => ({ value: v })); }, ticks: { callback: v => mo(v) } } } } });
    // 3 · M0: what solar and wind capture, against base
    const narrow = innerWidth < 700, mL = M0[M0.length - 1];
    const endLabels = { id: 'ends', afterDatasetsDraw(ch) { if (ch.width < 520) return; const c = ch.ctx; c.save(); c.font = "600 11px 'JetBrains Mono', monospace"; c.textBaseline = 'middle'; const used = [];
      ch.data.datasets.forEach((ds, i) => { const p = ch.getDatasetMeta(i).data[ds.data.length - 1]; if (!p) return; let y = p.y; used.forEach(u => { if (Math.abs(u - y) < 13) y = u + (y >= u ? 13 : -13); }); used.push(y); c.fillStyle = ds.borderColor; c.fillText(`${ds.short} ${fmt(ds.data[ds.data.length - 1])}`, p.x + 8, y); }); c.restore(); } };
    mk('c-m0', { type: 'line', plugins: [endLabels],
      data: { labels: m0lab(), datasets: [
        { label: tr('Prix base', 'Base price'), short: 'base', data: M0.map(m => m[1]), borderColor: PAL.base, borderWidth: 1.5, borderDash: [5, 4] },
        { label: tr('M0 éolien', 'Wind M0'), short: tr('éolien', 'wind'), data: M0.map(m => m[3]), borderColor: PAL.fuel.wind, borderWidth: 2.5, fill: false },
        { label: tr('M0 solaire', 'Solar M0'), short: tr('solaire', 'solar'), data: M0.map(m => m[2]), borderColor: PAL.fuel.solar, borderWidth: 2.5, backgroundColor: alpha(PAL.fuel.solar, .12), fill: { target: 0 }, pkKeepColor: true }] },
      options: { animation: false, layout: { padding: { right: narrow ? 0 : 96, top: 8 } }, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, align: 'end' }, tooltip: { displayColors: true, callbacks: { label: c => ` ${c.dataset.label} : ${fmt(c.parsed.y)} €/MWh` } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } }, y: { min: 0, position: 'right', ticks: { maxTicksLimit: 6, callback: v => v + ' €' } } } } });
    const pL = D.ppa.days[D.ppa.days.length - 1];
    $('#ppa').innerHTML = `<div class="p"><span>${tr('PPA solaire · pricer PowerKlock', 'Solar PPA · PowerKlock pricer')}</span><b>${fmt(pL[1])} <small>€/MWh</small></b></div><div class="p"><span>${tr('PPA éolien · pricer PowerKlock', 'Wind PPA · PowerKlock pricer')}</span><b>${fmt(pL[2])} <small>€/MWh</small></b></div><div class="p"><span>${tr('Solaire ÷ base · ', 'Solar ÷ base · ') + mo(+mL[0].slice(5) - 1)}</span><b>${Math.round(100 * mL[2] / mL[1])} <small>%</small></b></div>`;
    buildTiles();
  }
  const M0K = [2, 3, 1];
  const negSpan = m => (m <= 0 ? tr('France · janvier ', 'France · January ') : tr('France · de janvier à ', 'France · January to ') + mo(m) + ' ') + T.date.slice(0, 4);
  function setBuild(k, b) {
    if (k === 1) { const n = Math.round(b * priced.length); if (n !== B.map) { B.map = n; charts['c-map'] && charts['c-map'].update('none'); } }
    if (k === 2) { const m = Math.min(lastMonth, Math.floor(b * (lastMonth + 1) - 1e-6)); const mm = b >= 1 ? lastMonth : m; if (mm !== B.month) { B.month = mm; charts['c-neg'] && charts['c-neg'].update('none'); nf($('#g2'), cumNeg[Math.max(0, mm)], 0); $('#g2u2').textContent = negSpan(mm); } }
    if (k === 3) { const i = Math.round(b * (M0.length - 1)); if (i !== B.m0) { B.m0 = i; const ch = charts['c-m0']; if (ch) { ch.data.datasets.forEach((d, j) => { d.data = M0.map((m, x) => x <= i ? m[M0K[j]] : null); }); ch.update('none'); } readM0(i); } }
  }

  // caption read-outs
  function readCurve() {}
  function readMap(z) {
    mapZone = z;
    const r = D.eu.indexOf(z) + 1;
    $('#r1').innerHTML = mapHour != null ? `<b>${esc(zn(z))}</b> · ${mapHour}${tr('\u00a0h', ':00')} · <b>${fmt(z[6][mapHour], 0)} €/MWh</b> · ${tr('moyenne', 'average')} ${fmt(z[2])}` : `<b>${esc(zn(z))}</b> · ${fmt(z[2])} €/MWh · ${r}${tr(r === 1 ? 're' : 'e', '')}${tr(' sur ', ' of ')}${D.eu.length} <span style="color:${z[5] > 0 ? 'var(--up)' : 'var(--down)'}">${z[5] > 0 ? '▲' : '▼'} ${sgn(z[5])} €</span>`;
  }
  function readNeg(p) {
    p = p || negTop;
    $('#r2').innerHTML = (p === negTop ? tr('Record de l\'année : ', 'Year\'s record: ') : '') + `<b>${day(p.iso)}</b> · ${fmt(p.v, 1)} h ${tr('sous zéro', 'below zero')} · ${tr('moyenne', 'average')} ${fmt(p.avg)} €/MWh`;
  }
  function readM0(i) {
    const m = M0[i]; nf($('#g3'), m[2]);
    $('#g3u').textContent = tr('M0 solaire · ', 'Solar M0 · ') + mo(+m[0].slice(5) - 1) + ' ' + m[0].slice(0, 4);
    $('#ratio').textContent = Math.round(100 * m[2] / m[1]) + tr(' % du prix base', '% of base');
    $('#r3').innerHTML = `${tr('Éolien', 'Wind')} <b>${fmt(m[3])}</b> · ${tr('base', 'base')} <b>${fmt(m[1])}</b> €/MWh`;
  }

  // 4 · dashboard tiles, from the site's catalogue (js/widgets.js, js/widgets-kpi.js)
  function buildTiles() {
    const ttf = D.ttf[D.ttf.length - 1], nuc = D.nuc[D.nuc.length - 1];
    $('#tiles').innerHTML = [
      `<div class="tile kpi"><div class="t"><span>Day-ahead base</span><span>FR</span></div><b class="kv">${fmt(T.avg)}</b><small>€/MWh · ${dayS(T.date)}</small><span class="d" style="color:${chg > 0 ? 'var(--up)' : 'var(--down)'}">${chg > 0 ? '▲' : '▼'} ${sgn(chg)} ${tr('vs J−1', 'vs D−1')}</span></div>`,
      `<div class="tile kpi"><div class="t"><span>TTF day-ahead</span><span>${dayS(ttf[0])}</span></div><b class="kv">${fmt(ttf[1])}</b><small>€/MWh</small><span class="d" style="color:var(--fg2)">EUA ${fmt(D.eua[1])} €/t</span></div>`,
      `<div class="tile kpi hide-s"><div class="t"><span>${tr('Nucléaire dispo.', 'Nuclear avail.')}</span><span>FR</span></div><b class="kv">${fmt(nuc[1] / 1000, 1)}</b><small>GW · ${dayS(nuc[0])}</small><span class="d" style="color:var(--fg2)">${tr('sur 30 j', 'over 30 d')} ${sgn((nuc[1] - D.nuc[0][1]) / 1000, 1)} GW</span></div>`,
      `<div class="tile kpi hide-s"><div class="t"><span>${tr('Exports nets', 'Net exports')}</span><span>FR</span></div><b class="kv">${fmt(-netFR / 1000, 1)}</b><small>GW · ${D.flows.length} ${tr('frontières', 'borders')}</small><span class="d" style="color:var(--fg2)">${tr('vers l\'Italie', 'to Italy')} ${fmt(-D.flows.find(f => f.partner.startsWith('IT')).net / 1000, 1)} GW</span></div>`,
      `<div class="tile w2"><div class="t"><span>${tr('Spot France · quart d\'heure', 'France spot · quarter-hour')}</span><span>${dayS(T.date)}</span></div><div class="c"><canvas id="t-spot"></canvas></div></div>`,
      `<div class="tile w2"><div class="t"><span>${tr('Mix France', 'France mix')}</span><span>${Math.round(100 * D.mix.nuclear / mixTot)} % ${tr('nucléaire', 'nuclear')}</span></div><div class="c"><canvas id="t-mix"></canvas></div></div>`,
      `<div class="tile w2 hide-s"><div class="t"><span>${tr('Heures négatives par mois', 'Negative hours by month')}</span><span>${T.date.slice(0, 4)}</span></div><div class="c"><canvas id="t-neg"></canvas></div></div>`,
      `<div class="tile w2 hide-s"><div class="t"><span>${tr('Nucléaire disponible · 30 j', 'Nuclear available · 30 d')}</span><span>GW</span></div><div class="c"><canvas id="t-nuc"></canvas></div></div>`,
    ].join('');
    const mini = { plugins: { legend: { display: false } }, animation: false };
    mk('t-spot', { type: 'line', data: { labels: QL, datasets: [{ data: H, borderColor: PAL.zone.FR, borderWidth: 1.8, fill: { target: 'start' }, backgroundColor: areaFill(PAL.zone.FR, .22) }] },
      options: { ...mini, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y)} €/MWh` } } }, scales: { x: { display: false }, y: { display: false } } } });
    const MK = ['nuclear', 'hydro', 'wind', 'fossil', 'solar', 'biomass'], MN = { nuclear: ['Nucléaire', 'Nuclear'], hydro: ['Hydraulique', 'Hydro'], wind: ['Éolien', 'Wind'], solar: ['Solaire', 'Solar'], fossil: ['Fossile', 'Fossil'], biomass: ['Biomasse', 'Biomass'] };
    mk('t-mix', { type: 'doughnut', data: { labels: MK.map(k => tr(...MN[k])), datasets: [{ data: MK.map(k => D.mix[k]), backgroundColor: MK.map(k => PAL.fuel[k]), borderColor: '#0f1419', borderWidth: 2 }] },
      options: { ...mini, cutout: '62%', layout: { padding: 2 }, plugins: { legend: { display: innerWidth >= 700, position: 'right', labels: { font: { size: 10 }, padding: 8 } }, tooltip: { callbacks: { label: c => ` ${c.label} : ${fmt(c.parsed / 1000, 1)} GW` } } } } });
    mk('t-nuc', { type: 'line', data: { labels: D.nuc.map(x => dayS(x[0])), datasets: [{ data: D.nuc.map(x => x[1] / 1000), borderColor: PAL.fuel.nuclear, borderWidth: 1.8, fill: { target: 'start' }, backgroundColor: areaFill(PAL.fuel.nuclear, .25) }] },
      options: { ...mini, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y, 1)} GW` } } }, scales: { x: { display: false }, y: { display: false } } } });
    const byM = [...Array(lastMonth + 1)].map((_, m) => negPts.filter(p => p.y === m).reduce((a, p) => a + p.v, 0));
    mk('t-neg', { type: 'bar', data: { labels: byM.map((_, m) => mo(m)), datasets: [{ data: byM, backgroundColor: alpha(PAL.down, .8), borderRadius: 3 }] },
      options: { ...mini, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y, 0)} h` } } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 6 } }, y: { display: false } } } });
  }

  // ════════ bento: live mini-charts ════════
  function buildBento() {
    const pd = D.ppa.days, pl = pd[pd.length - 1];
    mk('b-ppa', { type: 'line', data: { labels: pd.map(x => dayS(x[0])), datasets: [
      { label: tr('PPA solaire', 'Solar PPA'), data: pd.map(x => x[1]), borderColor: '#FBBF24', borderWidth: 2, segment: { borderDash: c => pd[c.p1DataIndex][3] ? [4, 3] : undefined }, pkKeepColor: true },
      { label: tr('PPA éolien', 'Wind PPA'), data: pd.map(x => x[2]), borderColor: '#7FC8F8', borderWidth: 2, segment: { borderDash: c => pd[c.p1DataIndex][3] ? [4, 3] : undefined }, pkKeepColor: true }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true }, tooltip: { displayColors: true, callbacks: { label: c => ` ${c.dataset.label} : ${fmt(c.parsed.y)} €/MWh` } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 30 } }, y: { position: 'right', ticks: { maxTicksLimit: 5, callback: v => v + ' €' } } } } });
    nf($('#b-ppa-s'), pl[1]); nf($('#b-ppa-w'), pl[2]);
    const nucL = D.nuc[D.nuc.length - 1];
    mk('b-nuc', { type: 'line', data: { labels: D.nuc.map(x => dayS(x[0])), datasets: [{ label: tr('Nucléaire', 'Nuclear'), data: D.nuc.map(x => x[1] / 1000), borderColor: PAL.fuel.nuclear, borderWidth: 2, fill: { target: 'start' }, backgroundColor: areaFill(PAL.fuel.nuclear, .28), pkKeepColor: true }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y, 1)} GW` } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 24 } }, y: { position: 'right', ticks: { maxTicksLimit: 4, callback: v => v + ' GW' } } } } });
    const pts = []; D.heat.forEach((r, m) => r.forEach((v, h) => { if (v != null) pts.push({ x: h, y: m, v }); }));
    const hHi = Math.max(...pts.map(p => p.v)), rows = D.heat.length;
    mk('b-heat', { type: 'matrix', data: { datasets: [{ data: pts, borderWidth: 0, borderRadius: 2,
      backgroundColor: c => { const v = c.raw && c.raw.v; if (v == null) return 'transparent'; if (v < 0) return '#E6EDF3'; const t = v / hHi; return t > .5 ? alpha(PAL.up, .15 + .85 * (t - .5) * 2) : alpha(PAL.down, .12 + .8 * (.5 - t) * 2); },
      width: ({ chart }) => Math.max(2, (chart.chartArea || {}).width / 24 - 1.5), height: ({ chart }) => Math.max(2, (chart.chartArea || {}).height / rows - 1.5) }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { title: () => '', label: c => ` ${mo(c.raw.y)} · ${c.raw.x} h : ${fmt(c.raw.v, 0)} €/MWh` } } },
        scales: { x: { type: 'linear', min: -.5, max: 23.5, offset: false, grid: { display: false }, border: { display: false }, afterBuildTicks: a => { a.ticks = [0, 6, 12, 18, 23].map(v => ({ value: v })); }, ticks: { callback: v => v + ' h' } },
          y: { type: 'linear', min: -.5, max: rows - .5, reverse: true, offset: false, grid: { display: false }, border: { display: false }, afterBuildTicks: a => { a.ticks = [0, 2, 4, 6, 8, 10].filter(v => v < rows).map(v => ({ value: v })); }, ticks: { callback: v => mo(v) } } } } });
    const fl = D.flows.slice().sort((a, b) => a.net - b.net), FN = { DE_LU: ['Allemagne', 'Germany'], BE: ['Belgique', 'Belgium'], ES: ['Espagne', 'Spain'], IT_NORD: ['Italie', 'Italy'], CH: ['Suisse', 'Switzerland'], GB: ['Grande-Bretagne', 'Great Britain'] };
    mk('b-flow', { type: 'bar', data: { labels: fl.map(f => tr(...(FN[f.partner.split(' ')[0]] || [f.partner, f.partner]))), datasets: [{ data: fl.map(f => -f.net / 1000), backgroundColor: fl.map(f => f.net < 0 ? alpha(PAL.fuel.hydro, .85) : alpha(PAL.fuel.gas, .85)), borderRadius: 4, barThickness: 12 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${tr(c.parsed.x >= 0 ? 'export net' : 'import net', c.parsed.x >= 0 ? 'net export' : 'net import')} : ${fmt(Math.abs(c.parsed.x), 2)} GW` } } },
        scales: { x: { ticks: { maxTicksLimit: 4, callback: v => v + ' GW' } }, y: { grid: { display: false }, ticks: { color: PAL.text2 } } } } });
    mk('b-ttf', { type: 'line', data: { labels: D.ttf.map(x => dayS(x[0])), datasets: [{ label: 'TTF', data: D.ttf.map(x => x[1]), borderColor: PAL.fuel.gas, borderWidth: 2, fill: { target: 'start' }, backgroundColor: areaFill(PAL.fuel.gas, .22), pkKeepColor: true }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y)} €/MWh` } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 30 } }, y: { position: 'right', ticks: { maxTicksLimit: 4, callback: v => v + ' €' } } } } });
    const S = D.spring, q24 = [...Array(24)].map((_, h) => S.hourly.slice(h * 4, h * 4 + 4).reduce((a, b) => a + b, 0) / 4);
    // wind at the bottom, solar stacked on it, the price on top on its own axis (0 € marked)
    mk('b-spr', { data: { labels: [...Array(24)].map((_, h) => h + ' h'), datasets: [
      { type: 'line', label: tr('Éolien', 'Wind'), data: S.wind.map(v => v / 1000), borderColor: PAL.fuel.wind, backgroundColor: alpha(PAL.fuel.wind, .5), fill: 'origin', borderWidth: 1.5, stack: 'gen', yAxisID: 'y', order: 2 },
      { type: 'line', label: tr('Solaire', 'Solar'), data: S.solar.map(v => v / 1000), borderColor: PAL.fuel.solar, backgroundColor: alpha(PAL.fuel.solar, .5), fill: '-1', borderWidth: 1.5, stack: 'gen', yAxisID: 'y', order: 2, pkKeepColor: true },
      { type: 'line', label: tr('Prix day-ahead', 'Day-ahead price'), data: q24, borderColor: '#ffffff', borderWidth: 2.2, yAxisID: 'p', stack: 'price', order: 1, fill: false }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true }, tooltip: { displayColors: true, callbacks: { label: c => ` ${c.dataset.label} : ${fmt(c.parsed.y, c.dataset.yAxisID === 'p' ? 2 : 1)} ${c.dataset.yAxisID === 'p' ? '€/MWh' : 'GW'}` } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 18 } }, y: { stacked: true, min: 0, title: { display: true, text: 'GW', color: PAL.text3, font: { size: 10 } }, ticks: { maxTicksLimit: 5 } },
          p: { position: 'right', title: { display: true, text: '€/MWh', color: PAL.text3, font: { size: 10 } }, grid: { color: c => c.tick && c.tick.value === 0 ? 'rgba(255,255,255,.45)' : 'transparent' }, ticks: { maxTicksLimit: 6 } } } } });
    nf($('#b-nuc-v'), nucL[1] / 1000, 1); nf($('#b-flow-v'), -netFR / 1000, 1); nf($('#b-ttf-v'), D.ttf[D.ttf.length - 1][1]);
  }

  // ── all texts and figures (run again when the language changes) ──
  function texts() {
    document.documentElement.lang = lang;
    $$('[data-i]').forEach(e => { const t = I[e.dataset.i]; if (t) e.innerHTML = t[lang === 'fr' ? 0 : 1]; });
    $$('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    const when = isToday ? tr('aujourd\'hui, ', 'today, ') : isTom ? tr('demain, ', 'tomorrow, ') : '';
    $('#k0').textContent = tr('Day-ahead France · livraison ', 'France day-ahead · delivery ') + when + day(T.date); nf($('#g0'), T.avg);
    const c = $('#chg'); c.className = 'chip ' + (chg > 0 ? 'up' : 'down'); c.textContent = (chg > 0 ? '▲ ' : '▼ ') + sgn(chg) + tr(' € sur la veille', ' € on the day before');
    $('#s-lo').textContent = fmt(T.min, 0) + ' €'; $('#s-hi').textContent = fmt(T.max, 0) + ' €'; $('#s-pb').textContent = sgn(T.peak - T.avg, 0) + ' €';
    $('#src0').textContent = tr(`Prix day-ahead France par quart d'heure (€/MWh), jour de livraison ${day(T.date)}, heure de Paris. En pointillé : la moyenne publiée. Source : ENTSO-E, via PowerKlock.`, `France day-ahead price by quarter-hour (€/MWh), delivery day ${day(T.date)}, Paris time. Dashed: the published average. Source: ENTSO-E, via PowerKlock.`);
    $('#lg-lo').textContent = fmt(pLo, 0) + ' €'; $('#lg-hi').textContent = fmt(pHi, 0) + ' €/MWh';
    $('#src1').textContent = tr(` Moyenne du jour de livraison ${day(T.date)} par zone. Italie : zone Nord ; Norvège : Oslo ; Danemark : Ouest. Source : ENTSO-E, via PowerKlock.`, ` Average of delivery day ${day(T.date)} by zone. Italy: North zone; Norway: Oslo; Denmark: West. Source: ENTSO-E, via PowerKlock.`);
    const e0 = D.eu[0], e9 = D.eu[D.eu.length - 1];
    const rkRow = z => `<div class="r${z[0] === 'FR' ? ' fr' : ''}"><span>${esc(zn(z))}</span><span><b>${fmt(z[2], 0)}</b> <i style="color:${z[5] > 0 ? 'var(--up)' : 'var(--down)'}">${z[5] > 0 ? '▲' : '▼'}</i></span></div>`;
    $('#rk').innerHTML = `<div><h4>${tr('Plus chères', 'Dearest')}</h4>${D.eu.slice(0, 3).map(rkRow).join('')}</div><div><h4>France · ${rankFR}/${D.eu.length}</h4>${rkRow(byZ.FR)}<div class="r"><span>${tr('vs hier', 'vs yesterday')}</span><b style="color:${chg > 0 ? 'var(--up)' : 'var(--down)'}">${sgn(byZ.FR[5], 1)}</b></div></div><div><h4>${tr('Moins chères', 'Cheapest')}</h4>${D.eu.slice(-3).map(rkRow).join('')}</div>`;
    $('#lead2').innerHTML = tr(`En ${T.date.slice(0, 4)}, le prix français est passé sous zéro pendant <b>${D.negDays}&nbsp;jours</b>. Chaque case est un jour : plus elle est vive, plus il a compté d'heures négatives. Avril en tête.`, `In ${T.date.slice(0, 4)} the French price went below zero on <b>${D.negDays}&nbsp;days</b>. Each cell is a day: the brighter, the more negative hours.`);
    $('#lg-neg').textContent = fmt(negMax, 1) + ' h';
    $('#src2').textContent = tr(` Heures à prix day-ahead négatif par jour de livraison, France, du ${day(D.negD[0][0])} au ${day(T.date)}. Source : ENTSO-E, via PowerKlock.`, ` Hours with a negative day-ahead price per delivery day, France, ${day(D.negD[0][0])} to ${day(T.date)}. Source: ENTSO-E, via PowerKlock.`);
    $('#src3').textContent = tr(`M0 mensuelles et prix base (€/MWh), France, 13 derniers mois complets : le graphique de Renouvelables › M0. M0 recalculée par PowerKlock (courbes RTE via ODRÉ, prix ENTSO-E). Prix PPA du pricer publiés le ${day(D.ppa.days[D.ppa.days.length - 1][0])}.`, `Monthly M0 and base price (€/MWh), France, last 13 complete months: the chart of Renewables › M0. M0 recomputed by PowerKlock (RTE curves via ODRÉ, ENTSO-E prices). PPA prices of the pricer published on ${day(D.ppa.days[D.ppa.days.length - 1][0])}.`);
    $('#src4').textContent = tr('Exemple composé avec le catalogue du site (graphiques et chiffres clés). Sources : ENTSO-E, RTE éCO2mix, données de marché.', 'Example built with the site\'s catalogue (charts and key figures). Sources: ENTSO-E, RTE éCO2mix, market data.');
    nf($('#g1'), D.eu.length, 0);
    $('#pagesN').textContent = D.pagesN;
    $('#b-eua').textContent = '· EUA ' + fmt(D.eua[1]) + ' €/t';
    $('#s-ttf').textContent = tr(`TTF (€/MWh), 60 jours, dernier point ${day(D.ttf[D.ttf.length - 1][0])}. EUA au ${day(D.eua[0])}. Source : données de marché, via PowerKlock.`, `TTF (€/MWh), 60 days, last point ${day(D.ttf[D.ttf.length - 1][0])}. EUA as of ${day(D.eua[0])}. Source: market data, via PowerKlock.`);
    $('#b-spr-d').textContent = day('2026-04-05');
    $('#h-spr').textContent = sprNeg.length ? tr(`Sous zéro de ${hfr(sprNeg[0])} à ${hfr(sprNeg[sprNeg.length - 1] + 1)}, jusqu'à ${fmt(D.spring.min, 0)} €/MWh.`, `Below zero from ${hhmm(sprNeg[0])} to ${hhmm(sprNeg[sprNeg.length - 1] + 1)}, down to ${fmt(D.spring.min, 0)} €/MWh.`) : '';
    const flat3 = MENU.flatMap(([sec, items]) => items.map(p => [tr(...sec), tr(...p)])), third = Math.ceil(flat3.length / 3), mixd = flat3.map((_, i) => flat3[(i * 7) % flat3.length]);
    [0, 1, 2].forEach(i => { const p = mixd.slice(i * third, (i + 1) * third).map(([k, n]) => `<span class="pill"><b>${k}</b>${n}</span>`).join(''); $('#lane' + (i + 1)).innerHTML = p + p; });
    $('#b-ppa-t').textContent = 'Cal ' + (D.ppa.tenor || '').replace(/-/g, '–');
    $('#s-ppa').textContent = tr(`Prix PPA du pricer PowerKlock, réglages par défaut, moyenne des 4 méthodes (€/MWh), recalculé chaque jour ; pointillés : jours reconstruits. Le graphique « PPA benchmark · France » du site, dernier point ${day(D.ppa.days[D.ppa.days.length - 1][0])}.`, `PPA price of the PowerKlock pricer, default settings, average of the 4 methods (€/MWh), recomputed daily; dashed: rebuilt days. The site's "PPA benchmark · France" chart, last point ${day(D.ppa.days[D.ppa.days.length - 1][0])}.`);
    $('#h-news').innerHTML = `<span class="num">${D.newsN}</span> ${tr('articles', 'articles')}, <span class="num">${D.srcN}</span> ${tr('sources, une newsletter à 7&nbsp;h.', 'sources, a newsletter at 7&nbsp;am.')}`;
    const item = ([s, t]) => `<div class="item"><span class="s">${esc(s)}</span><span class="t">${esc(t)}</span></div>`;
    $('#newslist').innerHTML = D.news.slice(0, 4).map(item).join('');
    $('#flow').innerHTML = [0, 1, 2].map(c => { const list = D.news.map((_, i) => D.news[(i + c * 2) % D.news.length]); const h = list.map(item).join(''); return `<div class="col">${h + h}</div>`; }).join('');
    $('#s-newsd').textContent = tr(`Derniers titres du fil, ${day(D.news[0][2])} : titres et liens uniquement, jamais le texte des articles.`, `Latest headlines, ${day(D.news[0][2])}: headlines and links only, never the text of articles.`);
    const nucL = D.nuc[D.nuc.length - 1], tk = [
      [tr('Spot FR', 'FR spot'), fmt(T.avg) + ' €/MWh'], [tr('Plus bas', 'Low'), fmt(T.min) + ' €'], [tr('Plus haut', 'High'), fmt(T.max) + ' €'], [tr('Pointe', 'Peak'), fmt(T.peak) + ' €'],
      ['TTF', fmt(D.ttf[D.ttf.length - 1][1]) + ' €/MWh'], ['EUA', fmt(D.eua[1]) + ' €/t'], [tr('Heures négatives ', 'Negative hours ') + T.date.slice(0, 4), fmt(cumNeg[lastMonth], 0) + ' h'],
      [tr('Nucléaire dispo.', 'Nuclear avail.'), fmt(nucL[1] / 1000, 1) + ' GW'], [tr('M0 solaire ', 'Solar M0 ') + mo(+M0[M0.length - 1][0].slice(5) - 1), fmt(M0[M0.length - 1][2]) + ' €'], [tr('M0 éolien ', 'Wind M0 ') + mo(+M0[M0.length - 1][0].slice(5) - 1), fmt(M0[M0.length - 1][3]) + ' €'],
      [tr('Exports nets', 'Net exports'), fmt(-netFR / 1000, 1) + ' GW']];
    const h = tk.map(([a, b]) => `<span class="it">${a}<b>${b}</b></span>`).join('');
    $('#tk').innerHTML = h + `<span class="dup" aria-hidden="true">${h}</span>`;
    readMap(mapZone ? byZ[mapZone[0]] : byZ.FR); readNeg(null); readM0(B.m0); setHour(mapHour, true);
    nf($('#g2'), cumNeg[Math.max(0, B.month)], 0); $('#g2u2').textContent = negSpan(Math.max(0, B.month));
  }


  // ════════ hero: the price card and the curve behind it show the same quarter-hour ════════
  let hqf = 32, hovering = false, lastT = 0;
  const hAt = qf => { const i = Math.min(94, Math.floor(qf)), f = qf - i; return H[i] + (H[i + 1] - H[i]) * f; };
  const hcv = $('#hero-cv'), hx = hcv.getContext('2d'); let t0 = performance.now(), heroOn = true;
  function heroDraw(now) {
    if (!heroOn) return;
    const r = hcv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (hcv.width !== Math.round(r.width * dpr) || hcv.height !== Math.round(r.height * dpr)) { hcv.width = Math.round(r.width * dpr); hcv.height = Math.round(r.height * dpr); }
    const W = hcv.width, Hh = hcv.height, narrow = r.width < 960; hx.clearRect(0, 0, W, Hh);
    hx.strokeStyle = 'rgba(122,147,171,.05)'; hx.lineWidth = 1;
    for (let i = 1; i < 24; i++) { const x = W * i / 24; hx.beginPath(); hx.moveTo(x, 0); hx.lineTo(x, Hh); hx.stroke(); }
    const prog = reduce ? 1 : Math.min(1, (now - t0) / 2600), e = 1 - Math.pow(1 - prog, 3), n = Math.max(1, Math.round(95 * e));
    const top = narrow ? .30 : .22, bot = narrow ? .62 : .90;
    const X = q => W * q / 95, Y = p => Hh * bot - Hh * (bot - top) * (p - T.min) / (T.max - T.min);
    const yq = q => Y(H[q]) + (reduce ? 0 : Math.sin(now / 1800 + q / 9) * 2.5 * dpr);
    if (!reduce && !hovering && lastT) hqf = (hqf + Math.min(.1, (now - lastT) / 1000) * 3.4) % 95; lastT = now;
    const ch0 = charts['c-curve']; if (ch0 && ch0.$qf !== hqf && prog >= .6) { ch0.$qf = hqf; ch0.draw(); }
    const path = () => { hx.beginPath(); for (let q = 0; q <= n; q++) q ? hx.lineTo(X(q), yq(q)) : hx.moveTo(X(q), yq(q)); };
    path(); hx.lineTo(X(n), Hh); hx.lineTo(0, Hh); hx.closePath();
    const f = hx.createLinearGradient(0, Hh * top, 0, Hh); f.addColorStop(0, 'rgba(20,211,169,.13)'); f.addColorStop(1, 'rgba(20,211,169,0)'); hx.fillStyle = f; hx.fill();
    const sx = hqf / 95, g = hx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(20,211,169,.22)'); g.addColorStop(clamp(sx - .1), 'rgba(20,211,169,.3)'); g.addColorStop(clamp(sx), 'rgba(190,255,238,.95)'); g.addColorStop(clamp(sx + .1), 'rgba(20,211,169,.3)'); g.addColorStop(1, 'rgba(20,211,169,.22)');
    path(); hx.strokeStyle = g; hx.lineWidth = 2.5 * dpr; hx.lineJoin = 'round'; hx.shadowColor = 'rgba(20,211,169,.8)'; hx.shadowBlur = 22 * dpr; hx.stroke(); hx.shadowBlur = 0;
    if (prog >= 1) { const x = X(hqf), y = Y(hAt(hqf)) + (reduce ? 0 : Math.sin(now / 1800 + hqf / 9) * 2.5 * dpr);
      hx.strokeStyle = 'rgba(255,255,255,.12)'; hx.lineWidth = 1 * dpr; hx.beginPath(); hx.moveTo(x, 0); hx.lineTo(x, Hh); hx.stroke();
      hx.fillStyle = 'rgba(20,211,169,.18)'; hx.beginPath(); hx.arc(x, y, (12 + 6 * Math.sin(now / 260)) * dpr, 0, 7); hx.fill();
      hx.fillStyle = '#d6fff4'; hx.beginPath(); hx.arc(x, y, 4 * dpr, 0, 7); hx.fill(); }
    if (!reduce) requestAnimationFrame(heroDraw);
  }

  // map player: the day replayed hour by hour (slider at the far right = the day average)
  let playing = false, playT = 0;
  function setHour(h, quiet) {
    mapHour = (h == null || h > 23) ? null : h;
    const rg = $('#hrange'); if (+rg.value !== (mapHour == null ? 24 : mapHour)) rg.value = mapHour == null ? 24 : mapHour;
    $('#hlab').textContent = mapHour == null ? tr('moyenne du jour', 'day average') : mapHour + tr(' h → ', ':00 → ') + (mapHour + 1) + tr(' h', ':00');
    $('#lg-lo').textContent = fmt(mapHour == null ? pLo : hLo, 0) + ' €'; $('#lg-hi').textContent = fmt(mapHour == null ? pHi : hHi, 0) + ' €/MWh';
    if (!quiet && charts['c-map']) charts['c-map'].update('none');
    readMap(mapZone || byZ.FR);
  }
  function play(on) { playing = on; $('#hplay').classList.toggle('on', on); $('#hplay').setAttribute('aria-label', on ? 'Pause' : tr('Lecture', 'Play')); clearInterval(playT); if (on) { if (mapHour == null) setHour(0); playT = setInterval(() => { if (document.hidden) return; setHour(mapHour == null ? 0 : mapHour + 1); if (mapHour == null) play(false); }, 520); } }
  $('#hplay').addEventListener('click', () => play(!playing));
  $('#hrange').addEventListener('input', e => { play(false); setHour(+e.target.value); });

  // ════════ the story: the page scrolls, the chart stays and changes shape ════════
  // Captions move like any page. Beside them one stage stays in place: a line (MorphSVG) goes from the day's curve to
  // the outline of France, the month with the most negative hours, the solar M0 line, then a dashboard tile, while the
  // charts hand over to one another. Progress follows the scroll directly, with a short glide.
  let stl = null, strigs = [], stageLive = false;
  function scrolly() {
    strigs.forEach(s => s.kill()); strigs = []; if (stl) { stl.kill(); stl = null; }
    const sec = $('.scrolly'), wide = innerWidth >= 960, plates = $$('#stagebox .plate'), steps = $$('.steps .cap');
    gsap.set(plates, { clearProps: 'all' }); gsap.set([...steps, '#stagebox'], { clearProps: 'all' }); gsap.set(['#c-map', '#c-neg', '#c-m0', '#tiles .tile'], { clearProps: 'all' });
    sec.classList.toggle('live', wide); stageLive = wide;
    ['c-map', 'c-neg', 'c-m0', 't-spot', 't-mix', 't-neg', 't-nuc'].forEach(id => { const c = charts[id]; if (c) { c.resize(); c.update('none'); } });
    if (!wide) {   // phones and tablets: an ordinary page, each chart rises in under its caption
      plates.forEach(pl => strigs.push(ScrollTrigger.create({ trigger: pl, start: 'top 88%', once: true, onEnter: () => gsap.from(pl, { y: 40, autoAlpha: 0, duration: .7, ease: 'power3.out' }) })));
      return; }
    const xR = $('.sgrid').clientWidth - $('#stagebox').offsetWidth; gsap.set('#stagebox', { x: xR });   // chart on the right first, then it changes side at each step
    const box = $('#stagebox').getBoundingClientRect(), at = id => { const r = $('#' + id).getBoundingClientRect(); return [r.left - box.left, r.top - box.top]; };
    const pts = (id, ds) => { const [x, y] = at(id); return charts[id].getDatasetMeta(ds).data.map(p => { const f = p.getProps(['x', 'y'], true); return [x + f.x, y + f.y]; }); };
    const along = (line, n) => { const L = [0]; for (let i = 1; i < line.length; i++) L.push(L[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])); const out = []; let j = 1; for (let i = 0; i < n; i++) { const d = L[L.length - 1] * i / (n - 1 || 1); while (j < L.length - 1 && L[j] < d) j++; const f = (d - L[j - 1]) / (L[j] - L[j - 1] || 1); out.push([line[j - 1][0] + (line[j][0] - line[j - 1][0]) * f, line[j - 1][1] + (line[j][1] - line[j - 1][1]) * f]); } return out; };
    // five clouds of the same 96 points: the day's curve, the outline of France, the 96 days with the most negative hours,
    // the three M0 lines, the curve of a dashboard tile
    const S = [], CL = [], MINT = [20, 211, 169], WHITE = [255, 255, 255], SUN = [251, 191, 36];
    S.push(H.map((v, q) => [box.width * (.04 + .92 * q / 95), box.height * (.72 - .46 * (v - T.min) / (T.max - T.min))])); CL.push(H.map(() => MINT));
    { const ch = charts['c-map'], [x, y] = at('c-map'), fr = GEO.find(f => f.properties.iso === 'FR'), g = fr.geometry, rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(p => p[0]), ring = rings.reduce((a, b) => b.length > a.length ? b : a), pr = ch.scales.projection.projection;
      S.push(along(ring.map(c => { const q = pr(c); return [x + q[0], y + q[1]]; }), 96)); CL.push(H.map(() => WHITE)); const c = ch.getDatasetMeta(0).data[GEO.indexOf(fr)].getCenterPoint(true); S.fr = [c.x, c.y]; }
    { const [x, y] = at('c-neg'), m = charts['c-neg'].getDatasetMeta(0).data; S.push(top96.slice().sort((a, b) => a - b).map(k => { const c = m[k].getCenterPoint(true); return [x + c.x, y + c.y]; })); CL.push(H.map(() => WHITE)); }
    { const L3 = [along(pts('c-m0', 2), 32), along(pts('c-m0', 1), 32), along(pts('c-m0', 0), 32)], C3 = [SUN, MINT, [232, 238, 244]], P3 = [], K3 = []; for (let i = 0; i < 96; i++) { P3.push(L3[i % 3][Math.floor(i / 3)]); K3.push(C3[i % 3]); } S.push(P3); CL.push(K3); }
    S.push(pts('t-spot', 0)); CL.push(H.map(() => MINT));
    const cv = $('#morph'), dpr = Math.min(devicePixelRatio || 1, 2), cx = cv.getContext('2d'); cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = i => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const cloud = () => { cx.clearRect(0, 0, box.width, box.height); const tau = stl ? stl.time() : 0; if (tau <= .002 || tau >= 3.998) return; const k = Math.min(3, Math.floor(tau)), f = tau - k, A = S[k], Z = S[k + 1], env = ss(f / .1) * (1 - ss((f - .84) / .16));
      for (let i = 0; i < 96; i++) { const d = (i / 95) * .22, tt = clamp((f - d) / (1 - .22)), e = tt < .5 ? 4 * tt * tt * tt : 1 - Math.pow(-2 * tt + 2, 3) / 2, a = A[i], z = Z[i], dx = z[0] - a[0], dy = z[1] - a[1], arc = Math.sin(e * Math.PI) * (rnd(i) - .5) * .28, x = a[0] + dx * e - dy * arc, y = a[1] + dy * e + dx * arc, c = CL[k][i].map((v, j) => Math.round(v + (CL[k + 1][i][j] - v) * e));
        cx.fillStyle = `rgba(${c},${.14 * env})`; cx.beginPath(); cx.arc(x, y, 7, 0, 6.3); cx.fill(); cx.fillStyle = `rgba(${c},${env})`; cx.beginPath(); cx.arc(x, y, 2.6, 0, 6.3); cx.fill(); } };
    gsap.set(plates, { autoAlpha: 0 }); gsap.set(steps.slice(1), { autoAlpha: 0 });
    $('#c-map').style.setProperty('--fx', S.fr[0] + 'px'); $('#c-map').style.setProperty('--fy', S.fr[1] + 'px');
    stl = gsap.timeline({ paused: true, defaults: { ease: 'power2.inOut' }, onUpdate: cloud });
    for (let k = 0; k < 4; k++) {
      stl.fromTo(plates[k], { autoAlpha: 0, y: 30, scale: .975 }, { autoAlpha: 1, y: 0, scale: 1, duration: .55, ease: 'power1.out', immediateRender: false }, k + .4);
      if (k) stl.to(plates[k - 1], { autoAlpha: 0, y: -30, duration: .4, ease: 'power1.in' }, k)
        .to('#stagebox', { x: k % 2 ? 0 : xR, duration: .8, ease: 'power2.inOut' }, k + .05)
        .to(steps[k - 1], { autoAlpha: 0, duration: .3, ease: 'none' }, k + .05)
        .fromTo(steps[k], { autoAlpha: 0 }, { autoAlpha: 1, duration: .35, ease: 'none', immediateRender: false }, k + .3);
    }
    stl.to({}, { duration: .01 }, 0)
      // soft reveals: a feathered light spreads from France, washes down the calendar, runs along the M0 months
      .fromTo('#c-map', { '--r': '0%' }, { '--r': '190%', duration: .8, ease: 'power1.in', immediateRender: false }, .3)
      .fromTo('#c-neg', { '--p': '0%' }, { '--p': '140%', duration: .7, ease: 'none', immediateRender: false }, 1.35)
      .fromTo('#c-m0', { '--p': '0%' }, { '--p': '140%', duration: .7, ease: 'none', immediateRender: false }, 2.35)
      .fromTo('#tiles .tile', { autoAlpha: 0, scale: .9, y: 18 }, { autoAlpha: 1, scale: 1, y: 0, duration: .4, stagger: .03, ease: 'power2.out', immediateRender: false }, 3.4)
      .to({}, { duration: .01 }, 3.99);
    const glide = gsap.quickTo(stl, 'time', { duration: .35, ease: 'power2.out' });
    const upd = () => glide(strigs.reduce((a, s) => a + s.progress, 0));
    steps.forEach((st, k) => strigs.push(ScrollTrigger.create({ trigger: st, start: k ? 'top 82%' : 'top 100%', end: k ? 'top 38%' : 'top 52%', onUpdate: upd, onRefresh: upd })));
    stl.time(0); upd();
  }

  // dashboard tiles change places every second (GSAP Flip) while the board is on screen
  let shT = 0, dashVis = false;
  function shuffle() { if (!dashVis || document.hidden || !window.Flip || innerWidth < 700 || (stageLive && (!stl || stl.time() < 3.98))) return; const box = $('#tiles'), st = Flip.getState('#tiles .tile'); const k = [...box.querySelectorAll('.tile.kpi')], w = [...box.querySelectorAll('.tile.w2')]; if (k.length > 1) box.insertBefore(k[k.length - 1], k[0]); if (w.length > 1) box.insertBefore(w[w.length - 1], w[0]); Flip.from(st, { duration: .55, ease: 'power2.inOut' }); }
  // ════════ boot ════════
  const motion = !reduce && HAS && !!window.gsap && !!window.ScrollTrigger;
  if (motion) gsap.registerPlugin(ScrollTrigger, window.Flip, window.SplitText);
  texts();
  buildStage();
  buildBento();
  $('#flogo').src = $('.logo img').src;
  setHour(null, true); { const c0 = charts['c-curve']; if (c0) c0.$qf = hqf; }
  requestAnimationFrame(heroDraw);
  new IntersectionObserver(es => { const on = es[0].isIntersecting; if (on && !heroOn) { heroOn = true; requestAnimationFrame(heroDraw); } heroOn = on; }).observe(hcv);
  new IntersectionObserver(es => { dashVis = es[0].isIntersecting; }, { threshold: .8 }).observe($('#tiles'));
  if (!reduce) shT = setInterval(shuffle, 1000);

  // card chart: the cursor follows the pointer; the curve behind follows too
  const ccv = $('#c-curve');
  const overCurve = e => { const ch = charts['c-curve']; if (!ch) return; hovering = true; const a = ch.chartArea, r = ccv.getBoundingClientRect(); hqf = clamp((e.clientX - r.left - a.left) / (a.right - a.left)) * 94.99; if (reduce) { ch.$qf = hqf; ch.draw(); } };
  ccv.addEventListener('pointermove', overCurve); ccv.addEventListener('pointerdown', overCurve);
  ccv.addEventListener('pointerleave', () => { hovering = false; });
  $('#c-neg').addEventListener('pointerleave', () => readNeg(null));

  // language switch: texts and charts are rebuilt
  $$('.lang button').forEach(b => b.addEventListener('click', () => { if (b.dataset.lang === lang) return; lang = b.dataset.lang; texts(); buildStage(); buildBento(); counts(true); setHour(mapHour, true); if (motion) { scrolly(); ScrollTrigger.refresh(); } }));

  // smooth scroll (Lenis drives ScrollTrigger): an ordinary page, nothing pinned
  let lenis = null;
  if (!reduce && window.Lenis) { try { lenis = new Lenis({ lerp: .14, wheelMultiplier: 1.2 }); } catch (_) { lenis = null; } }
  if (lenis && motion) { lenis.on('scroll', ScrollTrigger.update); gsap.ticker.add(t => lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0); }
  else if (lenis) { const raf = ts => { lenis.raf(ts); requestAnimationFrame(raf); }; requestAnimationFrame(raf); }
  addEventListener('scroll', () => $('#top').classList.toggle('scrolled', scrollY > 8), { passive: true });
  document.addEventListener('click', e => { const a = e.target.closest('a[href^="#"]'); if (!a) return; const id = a.getAttribute('href'), tg = id.length > 1 && $(id); e.preventDefault(); if (lenis) lenis.scrollTo(id === '#story' ? 0 : tg || 0, { offset: -64, duration: 1.2 }); else (tg || document.body).scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); if (id === '#acces') setTimeout(() => $('#si-mail').focus({ preventScroll: true }), 1000); });

  let counted = false;
  function counts(force) { if (force && !counted) return; nf($('#n-pages'), D.pagesN, 0); nf($('#n-zones'), D.eu.length, 0); nf($('#n-src'), D.srcN, 0); }
  if (!motion) { counted = true; counts(); $$('.cell.rv').forEach(c => c.classList.add('in')); }
  else {
    // entrances
    const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
    if (window.SplitText) { try { const st = SplitText.create('#h1', { type: 'words,lines', linesClass: 'split-line', mask: 'lines' }); tl.from(st.words, { yPercent: 110, duration: 1, stagger: .05 }, .1); } catch (_) {} }
    tl.from('.hero .left > :not(h1)', { y: 18, opacity: 0, duration: .8, stagger: .08 }, .35).from('#live', { y: 30, opacity: 0, scale: .98, duration: 1 }, .45);
    scrolly();
    ['n-pages', 'n-zones', 'n-src'].forEach(id => nf($('#' + id), 0, 0));
    ScrollTrigger.create({ trigger: '.counts', start: 'top 85%', once: true, onEnter: () => { counted = true; counts(); } });
    $$('.cell.rv').forEach(c => c.classList.remove('rv'));
    gsap.set('.cell', { autoAlpha: .3, y: 34 });
    ScrollTrigger.batch('.cell', { start: 'top 90%', once: true, onEnter: els => { gsap.to(els, { autoAlpha: 1, y: 0, duration: .8, stagger: .08, ease: 'power3.out', overwrite: true }); els.forEach(e => { const c = e.querySelector('canvas'), ch = c && Chart.getChart(c); if (ch) { ch.reset(); ch.update(); } }); } });
    gsap.from('.head > *', { y: 30, autoAlpha: 0, duration: .8, stagger: .1, ease: 'power3.out', scrollTrigger: { trigger: '.head', start: 'top 85%', once: true } });
    gsap.from('.s-news .stack > *', { y: 26, opacity: 0, duration: .8, stagger: .07, ease: 'power3.out', scrollTrigger: { trigger: '.s-news', start: 'top 80%', once: true } });
    gsap.from('#signin', { x: 40, autoAlpha: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '.final', start: 'top 75%', once: true } });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { scrolly(); ScrollTrigger.refresh(); });
    let rz, lastW = innerWidth; addEventListener('resize', () => { if (innerWidth === lastW && innerWidth < 960) return; lastW = innerWidth; clearTimeout(rz); rz = setTimeout(() => { scrolly(); ScrollTrigger.refresh(); }, 250); });
    addEventListener('load', () => setTimeout(() => { scrolly(); ScrollTrigger.refresh(); }, 300));
  }

  if (fine && !reduce && window.gsap) {
    $$('.cell').forEach(c => c.addEventListener('pointermove', e => { const r = c.getBoundingClientRect(); c.style.setProperty('--px', (e.clientX - r.left) / r.width * 100 + '%'); c.style.setProperty('--py', (e.clientY - r.top) / r.height * 100 + '%'); }));
    $$('.magnet').forEach(b => { b.style.transition = 'box-shadow .3s, background .2s'; const qx = gsap.quickTo(b, 'x', { duration: .5, ease: 'power3.out' }), qy = gsap.quickTo(b, 'y', { duration: .5, ease: 'power3.out' });
      b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); qx((e.clientX - r.left - r.width / 2) * .3); qy((e.clientY - r.top - r.height / 2) * .4); });
      b.addEventListener('pointerleave', () => { qx(0); qy(0); }); });
  }

  const warp = $('#warp');
  function enter(from) { const r = from.getBoundingClientRect(); warp.style.setProperty('--wx', r.left + r.width / 2 + 'px'); warp.style.setProperty('--wy', r.top + r.height / 2 + 'px'); warp.classList.add('go'); warp.setAttribute('aria-hidden', 'false'); $$('.warp .g i').forEach((t, i) => t.style.transitionDelay = 350 + i * 60 + 'ms'); setTimeout(() => $('#warp-x').focus(), 700); }
  $('#signin').addEventListener('submit', e => { e.preventDefault(); enter(e.submitter || $('#signin .btn')); });
  $('#gbtn').addEventListener('click', e => enter(e.currentTarget));
  $('#warp-x').addEventListener('click', () => { warp.classList.remove('go'); warp.setAttribute('aria-hidden', 'true'); });
})();
