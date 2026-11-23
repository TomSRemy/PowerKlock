// ════════════════════════════════════════════════════════════════════
// BETA SHELL — loaded by js/beta.js only when the beta is on.
// The same pages, charts and data as the current site, found another way:
//   · a menu by job: a rail of 8 sections (Home, Market, Renewables & PPA,
//     Flexibility & BESS, Power system, Intelligence, Tools, Data & method),
//     and the pages of the chosen section beside it, never folded;
//   · a search field in the top bar (the quick search, Ctrl+K);
//   · on every page: the path Section › Page in the sticky bar, then the
//     page's name, one sentence on what it answers, its sister pages and
//     "see also" links to the pages used with it;
//   · a site map page (#sitemap) listing every page and its views;
//   · the origination line on Today (PPA reference price, capture, M0,
//     battery value) and one chart grid.
// Nothing is removed: every address of the current site still opens the
// same page (scripts/inventory_site.py --beta proves it view by view).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.PKBeta || !PKBeta.on) return;
  const nav = document.getElementById('sidebar');
  const main = document.querySelector('main.main');
  if (!nav || !main) return;
  const EN = !!(window.PKI18n && PKI18n.lang === 'en');
  const T = (fr, en) => (EN ? en : fr);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';

  // ── the site by job. P(route, fr, en, template, what the page answers fr, en); G(group fr, en, pages) ──
  // templates: dash = dashboard, ana = analysis, tool = tool or reference
  const P = (r, fr, en, tpl, dfr, den) => ({ r, fr, en, tpl, dfr, den });
  const G = (fr, en, pages) => ({ group: true, fr, en, pages });
  // a link to one view (tab) of a page that lives in another section: shown in the menu, not counted as a page
  const X = (r, fr, en, tab, dfr, den) => ({ ext: true, r, fr, en, tab, dfr, den });
  const IA = [
    { id: 'home', fr: 'Accueil', en: 'Home', icon: svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/>'),
      dfr: 'Le marché du jour et vos propres tableaux.', den: 'Today’s market and your own boards.', items: [
        P('today', 'Aujourd’hui', 'Today', 'dash', 'Le point du matin : spot France et Europe, forwards, gaz, carbone, fondamentaux, actualités, et les repères de l’originateur.', 'The morning brief: French and European spot, forwards, gas, carbon, fundamentals, news, and the originator’s benchmarks.'),
        P('dashboards', 'Mes tableaux de bord', 'My dashboards', 'dash', 'Vos tableaux composés avec les graphiques et les chiffres de tout le site, à partager par lien.', 'Your own boards built from any chart or figure of the site, shared by link.'),
        P('sitemap', 'Plan du site', 'Site map', 'dash', 'Toutes les pages et leurs vues, rangées par métier.', 'Every page and its views, arranged by job.'),
      ] },
    { id: 'market', fr: 'Marché', en: 'Market', icon: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
      dfr: 'Prix de l’électricité, des combustibles et du carbone, du spot aux forwards.', den: 'Power, fuel and carbon prices, from spot to forwards.', items: [
        G('Électricité spot', 'Power spot', [
          P('markets/spot/overview', 'Vue d’ensemble', 'Overview', 'dash', 'Le marché spot du jour en un écran : lecture, chiffres clés, profil horaire de 7 zones, combustibles, forwards, anomalies.', 'Today’s spot market on one screen: market read, key figures, hourly profile of 7 zones, fuels, forwards, anomalies.'),
          P('markets/spot', 'Day-ahead', 'Day-ahead', 'ana', 'Les prix day-ahead de toutes les zones pour un jour de livraison, puis l’historique et la comparaison de zones.', 'Day-ahead prices of every zone for a delivery day, then history and zone comparison.'),
          P('markets/spot/negative', 'Prix négatifs', 'Negative prices', 'ana', 'Heures à prix négatif par zone : le jour, la période, les profils et la prévision.', 'Negative-price hours by zone: the day, the period, the profiles and the forecast.'),
        ]),
        G('Électricité à terme', 'Power forwards', [
          P('markets/forwards', 'Électricité forwards', 'Power forwards', 'ana', 'La courbe à terme de la France et de ses voisins : tableau des échéances, comparaison, contrats calendaires.', 'The forward curve of France and its neighbours: board of maturities, comparison, calendar contracts.'),
        ]),
        G('Gaz, carbone, pétrole', 'Gas, carbon & oil', [
          P('markets/fuels', 'Prix spot', 'Spot prices', 'ana', 'Gaz TTF, quotas EUA, charbon et pétrole : niveaux du jour et historique.', 'TTF gas, EUA allowances, coal and oil: today’s levels and history.'),
          P('markets/fuels/forwards', 'Courbes forward', 'Forward curves', 'ana', 'Courbes à terme du gaz et du carbone, contrats et cotations TTF.', 'Gas and carbon forward curves, TTF contracts and settlements.'),
          P('markets/fuels/spreads', 'Spark & dark spreads', 'Spark & dark spreads', 'ana', 'Marge d’une centrale à gaz ou à charbon, par zone, au jour le jour et dans le temps.', 'Margin of a gas or coal plant, by zone, day by day and over time.'),
        ]),
      ] },
    { id: 'ren', fr: 'ENR & PPA', en: 'RES & PPA', lfr: 'Renouvelables & PPA', len: 'Renewables & PPA', icon: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
      dfr: 'Ce que vaut la production renouvelable : prix PPA, capture, M0, garanties d’origine.', den: 'What renewable output is worth: PPA price, capture, M0, guarantees of origin.', items: [
        P('tools/ppa', 'Pricer PPA', 'PPA pricer', 'tool', 'Le prix d’un PPA solaire ou éolien français, avec ses méthodes comparées et leur erreur mesurée.', 'The price of a French solar or wind PPA, with its methods compared and their measured error.'),
        G('Capture & M0', 'Capture & M0', [
          P('renewables/capture', 'Capture & cannibalisation', 'Capture & cannibalisation', 'ana', 'Taux de capture du solaire et de l’éolien, cannibalisation, capture forward, comparaison européenne.', 'Solar and wind capture rates, cannibalisation, forward capture, European comparison.'),
          P('renewables/m0', 'M0 & appels d’offres CRE', 'M0 & CRE tenders', 'ana', 'Le prix de marché de référence M0, estimé avant la publication de la CRE, et les résultats des appels d’offres.', 'The M0 reference market price, estimated before the CRE publishes it, and tender results.'),
        ]),
        P('tools/forecast', 'Prévision de production', 'Production forecast', 'tool', 'La prévision solaire ou éolienne d’un site, ce qu’elle vaut et sa fiabilité mesurée.', 'The solar or wind forecast of a site, what it is worth and its measured reliability.'),
        X('system/weather', 'Prévision météo 5 semaines', '5-week weather outlook', 'Forecast', 'Vent, soleil et température à 5 semaines face à la normale : ce que produiront l’éolien et le solaire.', 'Wind, sun and temperature 5 weeks ahead against normal: what wind and solar will produce.'),
        G('Garanties d’origine', 'Guarantees of origin', [
          P('markets/go', 'Prix Europe', 'EU prices', 'ana', 'Prix des garanties d’origine par millésime et par technologie.', 'Guarantee of origin prices by vintage and technology.'),
          P('markets/go/auctions', 'Enchères France', 'France auctions', 'ana', 'Résultats mensuels des enchères françaises (EEX), par technologie et par région.', 'Monthly results of the French auctions (EEX), by technology and region.'),
        ]),
        G('Parc installé', 'Installed fleet', [
          P('renewables/capacity', 'Capacité installée', 'Installed capacity', 'ana', 'Le parc installé par filière et par pays, année par année et en comparaison.', 'Installed fleet by technology and country, year by year and compared.'),
          P('system/france/regions', 'Régions', 'Regions', 'ana', 'Production, capacités et consommation des régions françaises.', 'Generation, capacity and demand of the French regions.'),
        ]),
      ] },
    { id: 'flex', fr: 'Flexibilité', en: 'Flexibility', lfr: 'Flexibilité & BESS', len: 'Flexibility & BESS', icon: svg('<rect x="2.5" y="7" width="16.5" height="10" rx="2"/><path d="M22 10.5v3"/><path d="M11.5 9.2 9 12.3h3.6L10 15"/>'),
      dfr: 'Ce que vaut la flexibilité : batteries, réserves, prix négatifs, spreads, écarts.', den: 'What flexibility is worth: batteries, reserves, negative prices, spreads, imbalance.', items: [
        P('markets/bess', 'Batteries (BESS)', 'Batteries (BESS)', 'ana', 'Les revenus d’une batterie : Europe, valeur day-ahead, réserves, sources de revenus, mécanisme de capacité, indice BESS.', 'Battery revenues: Europe, day-ahead value, reserves, revenue streams, capacity mechanism, BESS index.'),
        P('tools/boa', 'Pricer BOA', 'BOA pricer', 'tool', 'Le prix d’un contrat d’optimisation de batterie pour votre batterie, et les structures de contrat.', 'The price of a battery optimisation agreement for your battery, and the contract structures.'),
        P('markets/spot/spread', 'Spreads', 'Spreads', 'ana', 'Écarts de prix dans la journée : spreads batterie TB1 à TB4 et spread intrajournalier.', 'Price spreads within the day: battery spreads TB1 to TB4 and the intraday spread.'),
        P('markets/spot/imbalance', 'Déséquilibre', 'Imbalance', 'ana', 'Le prix de règlement des écarts face au day-ahead, et les activations mFRR.', 'The imbalance settlement price against day-ahead, and mFRR activations.'),
      ] },
    { id: 'system', fr: 'Système', en: 'System', lfr: 'Système électrique', len: 'Power system', icon: svg('<path d="M12 2.5 8 21.5M12 2.5l4 19M5 9h14M6.5 15h11M9.6 9l5.6 6M14.4 9l-5.6 6"/>'),
      dfr: 'Production, consommation, échanges, météo : les fondamentaux physiques.', den: 'Generation, demand, flows, weather: the physical fundamentals.', items: [
        P('system/map', 'Carte d’Europe', 'Europe map', 'ana', 'Prix, production et échanges de chaque zone sur la carte, heure par heure.', 'Price, generation and flows of every zone on the map, hour by hour.'),
        G('Production', 'Generation', [
          P('system/generation', 'Mix de production', 'Generation mix', 'ana', 'La production par filière et par zone, le jour et dans le temps.', 'Generation by technology and zone, for a day and over time.'),
          P('system/generation/nuclear', 'Nucléaire', 'Nuclear', 'ana', 'Disponibilité et production du parc nucléaire français.', 'Availability and output of the French nuclear fleet.'),
          P('system/generation/outages', 'Indisponibilités & REMIT', 'Outages & REMIT', 'ana', 'Les arrêts déclarés des centrales, unité par unité, et les plateformes de transparence.', 'Declared plant outages, unit by unit, and the transparency platforms.'),
          P('system/carbon', 'Intensité carbone', 'Carbon intensity', 'ana', 'Le contenu carbone de l’électricité produite, par zone.', 'The carbon content of the power generated, by zone.'),
        ]),
        G('Consommation & échanges', 'Demand & flows', [
          P('system/demand', 'Consommation', 'Demand', 'ana', 'La consommation par zone : le jour, la prévision des gestionnaires de réseau, l’historique.', 'Demand by zone: the day, the grid operators’ forecast, the history.'),
          P('system/demand/flows', 'Échanges transfrontaliers', 'Cross-border flows', 'ana', 'Les échanges entre zones et le détail de chaque frontière.', 'Flows between zones and the detail of each border.'),
        ]),
        P('system/france', 'Système France', 'France system', 'ana', 'Le système électrique français du jour : production, consommation, échanges, puis l’historique.', 'The French power system of the day: generation, demand, flows, then history.'),
        G('Météo', 'Weather', [
          P('system/weather', 'Villes & prévisions', 'Cities & outlook', 'ana', 'Météo des grandes villes, prévision à 5 semaines et réservoirs hydrauliques.', 'Weather of the main cities, 5-week outlook and hydro reservoirs.'),
          P('system/weather/hdd', 'DJU chauffage / climatisation', 'HDD / CDD', 'ana', 'Degrés-jours de chauffage et de climatisation, au jour et à la semaine.', 'Heating and cooling degree days, daily and weekly.'),
        ]),
      ] },
    { id: 'analysis', fr: 'Analyse', en: 'Analysis', icon: svg('<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>'),
      dfr: 'Comprendre ce qui s’est passé : moteurs du prix, lecture croisée, bilan de l’année, journée rejouée, séries comparées.', den: 'Understand what happened: price drivers, cross reading, yearly review, replayed day, compared series.', items: [
        P('markets/drivers', 'Ce qui fait le prix', 'What drives the price', 'ana', 'Des fondamentaux aux échéances : ce qui a fait bouger le prix sur la période choisie.', 'From fundamentals to maturities: what moved the price over the chosen period.'),
        P('intel/analysis', 'Analyse de marché', 'Market analysis', 'ana', 'Prix, production, échanges et météo sur un même axe de temps, avec les moments clés de la période.', 'Prices, generation, flows and weather on one time axis, with the key moments of the period.'),
        P('system/bilan', 'Bilan électrique', 'Yearly review', 'ana', 'L’année électrique française en chiffres : prix, production, échanges, records.', 'The French power year in figures: prices, generation, flows, records.'),
        P('system/replay', 'Rejouer une journée', 'Replay a day', 'tool', 'Revoir une journée heure par heure sur la carte : prix, production, échanges.', 'Watch a day again hour by hour on the map: prices, generation, flows.'),
        P('tools/compare', 'Comparateur', 'Comparator', 'tool', 'Superposer n’importe quelles séries du site sur une même période.', 'Overlay any series of the site over the same period.'),
      ] },
    { id: 'info', fr: 'Infographies', en: 'Infographics', icon: svg('<circle cx="12" cy="12" r="9"/><path d="M12 12c0-3 3-4 4-2s-1 5-4 5-5-3-4-6 5-5 8-3"/>'),
      dfr: 'Le marché raconté en images : des graphiques à part, à lire et à partager.', den: 'The market told in pictures: charts of their own, to read and share.', items: [
        P('infographics', 'Spirale des prix', 'Price spiral', 'dash', 'Tous les prix horaires français depuis 2019 sur une horloge de 24 heures : le creux solaire, la crise de 2021-2022, les prix négatifs.', 'Every French hourly price since 2019 on a 24-hour clock: the solar hollow, the 2021-22 crisis, negative prices.'),
      ] },
    { id: 'intel', fr: 'Veille', en: 'Intel', lfr: 'Veille', len: 'Intelligence', icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8.5h6M7 12h10M7 15.5h10"/>'),
      dfr: 'Ce qui se passe et ce qui change : actualités, régulation, événements datés.', den: 'What happens and what changes: news, regulation, dated events.', items: [
        P('intel/news', 'Actualités', 'News', 'ana', 'Les titres du jour sur l’énergie, par thème, avec le lien vers la source.', 'Today’s energy headlines, by theme, with the link to the source.'),
        P('intel/regulation', 'Évolutions et événements', 'Events and changes', 'ana', 'Les changements de règles et les événements de marché, datés et sourcés.', 'Rule changes and market events, dated and sourced.'),
      ] },
    { id: 'tools', fr: 'Outils', en: 'Tools', icon: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
      dfr: 'Les outils transverses : convertir, mesurer.', den: 'The cross-cutting tools: convert, measure.', items: [
        P('tools/converter', 'Convertisseur', 'Converter', 'tool', 'Convertir les unités d’énergie, de puissance et de prix.', 'Convert energy, power and price units.'),
        P('tools/carbon', 'Empreinte carbone', 'Carbon footprint', 'tool', 'L’empreinte carbone, le coût et la couverture solaire d’une courbe de consommation.', 'The carbon footprint, cost and solar coverage of a consumption curve.'),
      ] },
    { id: 'data', fr: 'Données', en: 'Data', lfr: 'Données & méthode', len: 'Data & method', icon: svg('<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V5.5"/><path d="M4 12v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12"/>'),
      dfr: 'D’où viennent les chiffres et comment ils sont calculés.', den: 'Where the figures come from and how they are computed.', items: [
        P('status', 'État des données', 'Data status', 'ana', 'La fraîcheur de chaque source et les problèmes de flux, suivis jusqu’à leur résolution.', 'The freshness of every source and the feed problems, tracked until solved.'),
        P('methodology', 'Méthodologie', 'Methodology', 'tool', 'Comment chaque chiffre du site est calculé.', 'How every figure of the site is computed.'),
        P('api', 'API', 'API', 'tool', 'Les fichiers de données du site, à lire directement.', 'The data files of the site, to read directly.'),
        P('about', 'À propos', 'About', 'tool', 'Ce qu’est PowerKlock, ses sources et comment signaler un problème.', 'What PowerKlock is, its sources and how to report a problem.'),
      ] },
  ];
  // addresses kept outside the menu (shared links): where they sit in the tree
  const HIDDEN = [P('games', 'Jeux', 'Games', 'tool', 'Les jeux du site, hors menu.', 'The site’s games, outside the menu.')];
  const ALIAS = { 'tools/bess-index': 'markets/bess', 'tools/bess': 'markets/bess', 'markets/fuels/ttf': 'markets/fuels/forwards', 'games': 'about' };
  // pages used together: links at the top of each page
  const SEE = {
    'today': ['markets/spot/overview', 'tools/ppa', 'markets/bess', 'sitemap'],
    'markets/drivers': ['intel/analysis', 'markets/forwards', 'markets/fuels'],
    'markets/spot/overview': ['markets/forwards', 'markets/fuels', 'markets/spot/negative'],
    'markets/spot': ['markets/spot/negative', 'markets/spot/spread', 'system/generation'],
    'markets/forwards': ['markets/fuels/forwards', 'markets/fuels/spreads', 'tools/ppa'],
    'markets/fuels': ['markets/forwards', 'system/generation'],
    'markets/fuels/forwards': ['markets/forwards'],
    'markets/fuels/spreads': ['markets/forwards', 'system/generation'],
    'intel/analysis': ['markets/drivers', 'system/replay', 'tools/compare'],
    'tools/ppa': ['renewables/capture', 'renewables/m0', 'markets/forwards', 'markets/go', 'tools/forecast'],
    'renewables/capture': ['tools/ppa', 'markets/spot/negative', 'renewables/capacity'],
    'renewables/m0': ['tools/ppa', 'markets/go/auctions'],
    'tools/forecast': ['tools/ppa', 'system/weather', 'markets/spot/imbalance'],
    'markets/go': ['tools/ppa'],
    'markets/go/auctions': ['renewables/m0'],
    'renewables/capacity': ['renewables/capture', 'system/generation'],
    'markets/bess': ['tools/boa', 'markets/spot/spread', 'markets/spot/imbalance'],
    'tools/boa': ['markets/bess', 'markets/spot/spread'],
    'markets/spot/negative': ['renewables/capture', 'markets/bess', 'markets/spot'],
    'markets/spot/spread': ['markets/bess', 'tools/boa', 'markets/spot'],
    'markets/spot/imbalance': ['markets/bess', 'tools/boa', 'tools/forecast'],
    'system/map': ['system/demand/flows', 'system/replay'],
    'system/generation': ['markets/spot', 'renewables/capacity'],
    'system/generation/nuclear': ['markets/forwards'],
    'system/generation/outages': ['markets/forwards'],
    'system/carbon': ['tools/carbon'],
    'system/demand': ['system/weather/hdd'],
    'system/demand/flows': ['system/map'],
    'system/france': ['system/generation/nuclear', 'markets/spot'],
    'system/france/regions': ['renewables/capture'],
    'system/bilan': ['renewables/capacity', 'markets/spot'],
    'system/weather': ['tools/forecast', 'system/demand'],
    'system/weather/hdd': ['system/demand', 'markets/fuels'],
    'intel/news': ['intel/analysis'],
    'intel/regulation': ['renewables/m0'],
    'tools/compare': ['intel/analysis'],
    'system/replay': ['system/map', 'intel/analysis'],
    'tools/carbon': ['system/carbon', 'markets/go'],
    'status': ['methodology', 'api'], 'methodology': ['status', 'api'], 'api': ['status', 'methodology'], 'about': ['methodology', 'status'],
  };
  // route → where its blocks live in index.html (page id, or page:panel), to list a page's views in the site map
  const ROOT = { 'today': 'morning', 'dashboards': 'mydash', 'markets/drivers': 'drivers', 'markets/spot': 'prices:da', 'markets/spot/overview': 'prices:overview',
    'markets/spot/negative': 'prices:negative', 'markets/spot/spread': 'prices:spread', 'markets/spot/imbalance': 'imbalance', 'markets/forwards': 'prices:forward',
    'markets/fuels': 'eua', 'markets/fuels/forwards': 'euafwd', 'markets/fuels/spreads': 'spark', 'markets/go': 'goprices', 'markets/bess': 'bess',
    'renewables/capture': 'renewables', 'renewables/capacity': 'capacity', 'system/map': 'map', 'system/generation': 'genmix', 'system/generation/nuclear': 'nuclear',
    'system/generation/outages': 'remit', 'system/demand': 'load', 'system/demand/flows': 'crossborder', 'system/france': 'frsystem', 'system/france/regions': 'regions',
    'system/weather': 'wxcities', 'system/weather/hdd': 'wxhdd', 'system/carbon': 'carbonintensity', 'system/replay': 'replay', 'tools/ppa': 'ppapricer', 'tools/boa': 'boa',
    'tools/forecast': 'fcst', 'tools/carbon': 'carbonfoot', 'tools/compare': 'compare', 'tools/converter': 'converter', 'intel/news': 'news', 'intel/regulation': 'regulation',
    'system/bilan': 'bilan', 'intel/analysis': 'analysis', 'status': 'status', 'api': 'api', 'methodology': 'methodology', 'about': 'about' };
  const TPL = { dash: ['Tableau de bord', 'Dashboard'], ana: ['Analyse', 'Analysis'], tool: ['Outil / référence', 'Tool / reference'] };

  const L = o => T(o.fr, o.en), LL = s => T(s.lfr || s.fr, s.len || s.en), D = o => T(o.dfr, o.den);
  const byRoute = {}, secOf = {}, groupOf = {};
  IA.forEach(s => s.items.filter(it => !it.ext).forEach(it => (it.group ? it.pages : [it]).forEach(p => { byRoute[p.r] = p; secOf[p.r] = s; if (it.group) groupOf[p.r] = it; })));
  HIDDEN.forEach(p => { byRoute[p.r] = p; secOf[p.r] = IA[IA.length - 1]; });
  const pagesOf = s => s.items.filter(it => !it.ext).reduce((a, it) => a.concat(it.group ? it.pages : [it]), []);
  const link = (p, cls, label) => '<a class="' + cls + '" href="#' + p.r + '" data-route="' + p.r + '">' + esc(label || L(p)) + '</a>';

  // ── the search and the inventory read the menu from here ──
  const entries = () => IA.reduce((a, s) => a.concat(pagesOf(s).map(p => ({ label: (groupOf[p.r] ? L(groupOf[p.r]) + ' › ' : '') + L(p), sub: LL(s), route: p.r }))), [])
    .concat(HIDDEN.map(p => ({ label: L(p), sub: T('Hors menu', 'Outside the menu'), route: p.r })));
  if (window.PKNav) PKNav.entries = entries;
  PKBeta.routes = entries;
  PKBeta.tree = () => IA.map(s => ({ id: s.id, name: LL(s), pages: pagesOf(s).map(p => ({ route: p.r, name: L(p), group: groupOf[p.r] ? L(groupOf[p.r]) : '', tpl: p.tpl })) }));

  // ── menu: the rail and the pages of a section ──
  const legacy = document.createElement('div');
  legacy.className = 'pkb-legacy';
  const zoneM = nav.querySelector('.pk-nv-zone');
  while (nav.firstChild) legacy.appendChild(nav.firstChild);   // the current menu stays in the document (its code keeps running), unseen
  const rail = document.createElement('div');
  rail.className = 'pkb-rail'; rail.setAttribute('role', 'tablist'); rail.setAttribute('aria-label', T('Sections du site', 'Site sections'));
  rail.innerHTML = IA.map((s, i) => (i === IA.length - 1 ? '<span class="pkb-rail-sp"></span>' : '') +
    '<button type="button" class="pkb-rail-b" role="tab" data-sec="' + s.id + '" title="' + esc(LL(s)) + '">' + s.icon + '<span>' + esc(L(s)) + '</span></button>').join('');
  const pane = document.createElement('div');
  pane.className = 'pkb-pane';
  pane.innerHTML = IA.map(s => '<section class="pkb-sec" data-sec="' + s.id + '" hidden><div class="pkb-sec-t">' + esc(LL(s)) + '</div><div class="pkb-sec-d">' + esc(D(s)) + '</div>' +
    s.items.map(it => it.ext ? '<a class="pkb-item pkb-ext" href="#' + it.r + '" data-pkb-tab="' + esc(it.tab) + '" title="' + esc(D(it)) + '">' + esc(L(it)) + '</a>' : it.group ? '<div class="pkb-group"><div class="pkb-group-t">' + esc(L(it)) + '</div>' + it.pages.map(p => link(p, 'pkb-item')).join('') + '</div>' : link(it, 'pkb-item')).join('') +
    '</section>').join('') +
    '<div class="pkb-pane-foot">' + link(byRoute.sitemap, '', T('Plan du site', 'Site map')) + '<button type="button" data-pkb-search>' + T('Rechercher', 'Search') + ' · Ctrl K</button></div>';
  nav.appendChild(rail); nav.appendChild(pane); nav.appendChild(legacy);
  if (zoneM) pane.insertBefore(zoneM, pane.firstChild);   // phones: the zone choice stays in the drawer
  nav.classList.add('pkb-nav');

  let shownSec = null;
  function showSec(id, fly) {
    shownSec = id;
    pane.querySelectorAll('.pkb-sec').forEach(x => { x.hidden = x.dataset.sec !== id; });
    rail.querySelectorAll('.pkb-rail-b').forEach(b => { const on = b.dataset.sec === id; b.classList.toggle('sel', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    if (fly != null) nav.classList.toggle('pkb-fly', !!fly);
  }
  rail.addEventListener('click', e => {
    const b = e.target.closest('.pkb-rail-b'); if (!b) return;
    const collapsed = nav.classList.contains('collapsed') && window.innerWidth > 768;
    // collapsed: a second click on the open section closes its panel
    showSec(b.dataset.sec, collapsed ? !(nav.classList.contains('pkb-fly') && shownSec === b.dataset.sec) : false);
  });
  document.addEventListener('click', e => { if (nav.classList.contains('pkb-fly') && (!nav.contains(e.target) || e.target.closest('a[data-route]'))) nav.classList.remove('pkb-fly'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') nav.classList.remove('pkb-fly'); });
  // a narrow window keeps the rail only: the charts get the room
  // (owner, 23 Nov. 2026: a menu that folds away at every click is a pain) the menu stays open at every width above a
  // phone; only the owner's own fold button (the sidebar toggle) narrows it to the rail
  nav.classList.remove('collapsed');

  // a menu link to one view of a page (X items): open the page, then that view
  nav.addEventListener('click', e => {
    const a = e.target.closest('a[data-pkb-tab]'); if (!a) return;
    const want = a.dataset.pkbTab;
    const pick = (n) => {
      const b = [...document.querySelectorAll('main .page.active .tabs-nav .tab-btn, main .page.active .pk-views .tab-btn')].find(x => x.offsetParent !== null && (window.pkEN ? pkEN(x.textContent.trim()) : x.textContent.trim()) === want);
      if (b) { b.click(); return; }
      if (n > 0) setTimeout(() => pick(n - 1), 250);
    };
    setTimeout(() => pick(12), 200);
  });

  // ── Infographics: charts of their own (the price spiral first; the review keeps its own, filtered by year) ──
  const ig = document.createElement('div');
  ig.className = 'page'; ig.id = 'page-infographics';
  ig.innerHTML = '<div class="pr-tabs-sticky"><div class="pr-tabs-bar"></div></div><section class="bl-blk pkb-ig" id="pkb-ig-spiral"></section>';
  main.appendChild(ig);
  let igDone = false;
  const igMount = () => { if (igDone || !ig.classList.contains('active') || !window.PKSpiral) return; igDone = true; PKSpiral.mount(document.getElementById('pkb-ig-spiral'), {}); };
  new MutationObserver(igMount).observe(ig, { attributes: true, attributeFilter: ['class'] });

  // ── top bar: the search field ──
  const openSearch = () => { if (window.PKSearch) PKSearch.open(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); };
  (function searchField() {
    const logo = document.querySelector('.topbar .logo'); if (!logo) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pkb-search'; b.id = 'pkb-search';
    b.setAttribute('aria-label', T('Rechercher une page ou un graphique', 'Search a page or a chart'));
    b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>' +
      T('Rechercher une page, un graphique…', 'Search a page, a chart…') + '</span><kbd>Ctrl K</kbd>';
    b.addEventListener('click', openSearch);
    logo.after(b);
  })();
  document.addEventListener('click', e => { if (e.target.closest('[data-pkb-search]')) openSearch(); });

  // ── site map page ──
  const sm = document.createElement('div');
  sm.className = 'page'; sm.id = 'page-sitemap';
  sm.innerHTML = '<div class="pr-tabs-sticky"><div class="pr-tabs-bar"></div></div>' +
    '<div class="pkb-sm-top"><div class="pkb-head-main"><h1 class="pkb-head-t">' + T('Plan du site', 'Site map') + '</h1><p class="pkb-head-d">' +
    T('Toutes les pages de PowerKlock, rangées par métier. Chaque page suit l’un des trois gabarits : tableau de bord, analyse, outil ou référence.',
      'Every page of PowerKlock, arranged by job. Each page follows one of three templates: dashboard, analysis, tool or reference.') + '</p></div>' +
    '<input type="search" class="pkb-sm-filter" id="pkb-sm-filter" autocomplete="off" placeholder="' + T('Filtrer les pages…', 'Filter the pages…') + '" aria-label="' + T('Filtrer les pages', 'Filter the pages') + '"></div>' +
    '<div class="pkb-sm-grid" id="pkb-sm-grid"></div>';
  main.appendChild(sm);
  const rootOf = r => { const k = ROOT[r]; if (!k) return null; const [pid, sub] = k.split(':'); return sub ? document.querySelector('#page-' + pid + ' [data-subdomain-panel="' + sub + '"]') : document.getElementById('page-' + pid); };
  const viewsOf = r => { const root = rootOf(r); if (!root) return [];
    const bar = root.querySelector('.pr-tabs-bar .pk-views:not(.pk-subviews), .pr-tabs-bar .tabs-nav:not(.pk-subviews)');
    return bar ? [...bar.querySelectorAll('.tab-btn')].map(b => b.textContent.trim()).filter(Boolean) : []; };
  function drawSitemap() {
    const row = p => { const v = viewsOf(p.r);
      return '<div class="pkb-sm-row" data-k="' + esc((L(p) + ' ' + D(p) + ' ' + v.join(' ')).toLowerCase()) + '">' + link(p, '') + '<span class="pkb-tpl">' + T(...TPL[p.tpl]) + '</span><p>' + esc(D(p)) + '</p>' +
        (v.length > 1 ? '<div class="pkb-sm-views">' + v.map((t, i) => '<a href="#' + p.r + (i ? '?v=' + i : '') + '">' + esc(t) + '</a>').join('') + '</div>' : '') + '</div>'; };
    document.getElementById('pkb-sm-grid').innerHTML = IA.map(s => '<div class="pkb-sm-card"><div class="pkb-sm-h"><span class="pkb-sm-ic">' + s.icon + '</span><span class="pkb-sm-name">' + esc(LL(s)) +
      '</span><span class="pkb-sm-n">' + pagesOf(s).length + ' ' + T('pages', 'pages') + '</span></div><p class="pkb-sm-d">' + esc(D(s)) + '</p>' +
      s.items.filter(it => !it.ext).map(it => it.group ? '<div class="pkb-sm-g">' + esc(L(it)) + '</div>' + it.pages.map(row).join('') : row(it)).join('') +
      (s.id === 'data' ? HIDDEN.map(row).join('') : '') + '</div>').join('');
  }
  drawSitemap();
  window.addEventListener('load', () => setTimeout(drawSitemap, 400));   // the view tabs of each page exist once the site has loaded
  sm.addEventListener('input', e => {
    if (e.target.id !== 'pkb-sm-filter') return;
    const q = e.target.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    sm.querySelectorAll('.pkb-sm-card').forEach(c => {
      let any = false;
      c.querySelectorAll('.pkb-sm-row').forEach(r => { const hit = !q || r.dataset.k.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q); r.hidden = !hit; if (hit) any = true; });
      c.querySelectorAll('.pkb-sm-g').forEach(g => { let n = g.nextElementSibling, vis = false; while (n && n.classList.contains('pkb-sm-row')) { if (!n.hidden) vis = true; n = n.nextElementSibling; } g.hidden = !vis; });
      c.hidden = !any;
    });
  });
  // a view link of the site map (#route?v=2) opens that view
  sm.addEventListener('click', e => { const a = e.target.closest('.pkb-sm-views a'); if (!a || e.button !== 0 || e.metaKey || e.ctrlKey) return; e.preventDefault(); location.hash = a.getAttribute('href'); window.dispatchEvent(new PopStateEvent('popstate')); });

  // ── every page: path, header, sister pages, see also ──
  // the page on screen: the address says it; where the address cannot follow (a frame without history), the document does
  const WHERE = Object.assign({ 'infographics': 'infographics', 'markets/go/auctions': 'goprices', 'renewables/m0': 'renewables', 'tools/bess-index': 'bess', 'tools/bess': 'bess',
    'markets/fuels/ttf': 'euafwd', 'games': 'games', 'sitemap': 'sitemap' }, ROOT);
  const activePage = () => document.querySelector('main #page-mydash.active') || document.querySelector('main .page.active');   // a dashboard is shown over the page left behind
  const domKey = () => { const pg = activePage(); if (!pg) return null;
    if (pg.id !== 'page-prices') return pg.id.slice(5);
    const sub = pg.querySelector('.subdomain-panel.active'), k = sub ? sub.getAttribute('data-subdomain-panel') : 'da';
    return 'prices:' + (k === 'negative-legacy' ? 'negative' : k); };
  const curRoute = () => {
    const m = location.hash.match(/^#([a-z0-9/-]+)/), r = m ? m[1] : 'today', k = domKey();
    if (!k || WHERE[r] === k) return r;
    if (k === 'goprices') { const t = document.querySelector('#go-tabs-nav .tab-btn.active'); return t && t.dataset.tab === 'auctions' ? 'markets/go/auctions' : 'markets/go'; }
    return Object.keys(ROOT).find(x => ROOT[x] === k) || (WHERE[k] ? k : r);
  };
  const activeRoot = () => { const pg = activePage(); if (!pg) return null;
    if (pg.id === 'page-prices') return pg.querySelector('.subdomain-panel.active') || [...pg.querySelectorAll('[data-subdomain-panel]')].find(x => x.offsetParent !== null) || pg;
    return pg; };
  const NO_HEAD = new Set(['today', 'sitemap']);   // these pages carry their own title
  function sync() {
    let route = curRoute();
    const shownAs = byRoute[route] ? route : (ALIAS[route] || 'today');
    const p = byRoute[route] || byRoute[shownAs], s = secOf[p.r], g = groupOf[shownAs];
    // menu
    pane.querySelectorAll('.pkb-item').forEach(a => { const on = a.dataset.route === shownAs; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    rail.querySelectorAll('.pkb-rail-b').forEach(b => b.classList.toggle('cur', b.dataset.sec === s.id));
    if (sync.last !== route) { showSec(s.id); sync.last = route; }
    document.title = 'PowerKlock · ' + (g ? L(g) + ' · ' : '') + L(p);
    const root = activeRoot(); if (!root) return;
    // path in the sticky bar (a page without a bar gets one)
    let bar = root.querySelector('.pr-tabs-bar');
    if (!bar) { const st = document.createElement('div'); st.className = 'pr-tabs-sticky pkb-bar'; st.innerHTML = '<div class="pr-tabs-bar"></div>'; root.insertBefore(st, root.firstChild); bar = st.firstChild; }
    let crumb = bar.querySelector(':scope > .pkb-crumb');
    if (!crumb) { crumb = document.createElement('nav'); crumb.className = 'pkb-crumb'; crumb.setAttribute('aria-label', T('Fil d’Ariane', 'Breadcrumb')); bar.insertBefore(crumb, bar.firstChild); }
    const first = pagesOf(s)[0];
    const html = '<a href="#' + first.r + '" data-route="' + first.r + '" data-pkb-sec="' + s.id + '">' + esc(LL(s)) + '</a><i>›</i>' +
      (g ? '<a href="#' + g.pages[0].r + '" data-route="' + g.pages[0].r + '">' + esc(L(g)) + '</a><i>›</i>' : '') + '<b>' + esc(L(p)) + '</b>';
    if (crumb.dataset.k !== html) { crumb.innerHTML = html; crumb.dataset.k = html; }
    // header under the bar
    let head = root.querySelector(':scope > .pkb-head, :scope > * > .pkb-head');
    if (NO_HEAD.has(p.r)) { if (head) head.remove(); return; }
    if (!head) { head = document.createElement('div'); head.className = 'pkb-head'; const st = bar.closest('.pr-tabs-sticky') || bar; st.after(head); }
    const see = (SEE[p.r] || []).map(r => byRoute[r]).filter(Boolean);
    // a page that shows its own title (Methodology, Yearly review, Events) keeps it: the header only adds the sentence and the links
    const own = [...root.querySelectorAll('h1:not(.pkb-head-t):not(.pk-sr)')].some(h => h.offsetParent !== null);
    const h1 = !root.querySelector('h1:not(.pkb-head-t)');
    const hh = '<div class="pkb-head-main">' + (own ? '' : '<' + (h1 ? 'h1' : 'div role="heading" aria-level="2"') + ' class="pkb-head-t">' + (g && g.pages.length > 1 && L(g) !== L(p) ? '<span class="pkb-head-g">' + esc(L(g)) + ' · </span>' : '') + esc(L(p)) + '</' + (h1 ? 'h1' : 'div') + '>') +
      '<p class="pkb-head-d">' + esc(D(p)) + '</p>' +
      (g ? '<nav class="pkb-sibs" aria-label="' + esc(L(g)) + '">' + g.pages.map(x => '<a href="#' + x.r + '" data-route="' + x.r + '"' + (x.r === shownAs ? ' class="on" aria-current="page"' : '') + '>' + esc(L(x)) + '</a>').join('') + '</nav>' : '') + '</div>' +
      (see.length ? '<div class="pkb-see"><span>' + T('Voir aussi', 'See also') + '</span>' + see.map(x => link(x, '')).join('') + '</div>' : '');
    if (head.dataset.k !== hh) { const kept = [...head.querySelectorAll('[data-pkb-keep]')]; head.innerHTML = hh; head.dataset.k = hh; kept.forEach(k => head.firstChild.appendChild(k)); }
    // Power spot › Overview: its own header is hidden in the beta layout; the line it carried (market, delivery day) stays here
    if (p.r === 'markets/spot/overview') { const sub = document.getElementById('pr-home-subtitle'); if (sub && !head.contains(sub)) { sub.dataset.pkbKeep = '1'; sub.classList.add('pkb-head-meta'); head.firstChild.appendChild(sub); } }
  }
  let syncT = 0;
  const later = () => { clearTimeout(syncT); syncT = setTimeout(sync, 30); };
  ['pushState', 'replaceState'].forEach(k => { const f = history[k]; history[k] = function () { try { return f.apply(this, arguments); } finally { later(); if (PKBeta.afterNav) PKBeta.afterNav(); } }; });
  window.addEventListener('popstate', later); window.addEventListener('hashchange', later);
  window.addEventListener('load', () => { setTimeout(sync, 120); setTimeout(sync, 900); });
  document.addEventListener('click', e => { if (e.target.closest('a[data-route], .tab-btn, .pkd-tab')) setTimeout(sync, 150); });
  new MutationObserver(later).observe(main, { attributes: true, attributeFilter: ['class'], subtree: true, childList: false });
  // the section name in the path opens that section in the menu too
  document.addEventListener('click', e => { const a = e.target.closest('a[data-pkb-sec]'); if (a) showSec(a.dataset.pkbSec); });
  sync();

  // ── beta notice: what changed, in one line; can be closed ──
  (function notice() {
    const n = document.querySelector('.pk-beta-note'); if (!n) return;
    let closed = false; try { closed = localStorage.getItem('pk-beta-note') === '0'; } catch (e) { /* ignore */ }
    if (closed) { n.remove(); return; }
    n.innerHTML = '<span>' + T('<b>Version bêta</b> · menu par métier toujours ouvert, sections Analyse et Infographies, recherche (Ctrl K), plan du site, Aujourd’hui en une seule vue. Aucun graphique n’est retiré. Bouton « Bêta » en haut pour revenir à la version actuelle.',
      '<b>Beta</b> · menu by job that stays open, Analysis and Infographics sections, search (Ctrl K), site map, Today in one view. No chart is removed. “Beta” button at the top to go back to the current version.') +
      '</span><button type="button" class="pk-beta-note-x" aria-label="' + T('Fermer', 'Close') + '">×</button>';
    n.querySelector('button').addEventListener('click', () => { n.remove(); try { localStorage.setItem('pk-beta-note', '0'); } catch (e) { /* ignore */ } });
  })();

  // ── Today: the originator's benchmarks first, the stories after the figures ──
  (function home() {
    const pg = document.getElementById('page-morning'); if (!pg) return;
    const hdr = pg.querySelector('.mrn2-hdr'), stories = document.getElementById('mrn-stories'), firstVisit = document.getElementById('mrn-first');
    const box = document.createElement('section');
    box.className = 'pkb-orig'; box.id = 'pkb-orig';
    if (hdr) hdr.after(box); else pg.appendChild(box);
    // the three story bubbles stood above the figures: they sit, smaller, in the title row; the first-visit banner
    // goes under the page (the beta notice does its job at the top)
    if (stories && hdr) { hdr.classList.add('pkb-hdr'); hdr.insertBefore(stories, hdr.children[1] || null); }
    if (firstVisit) pg.appendChild(firstVisit);
    const num = (v, d) => (v == null || isNaN(v)) ? '–' : Number(v).toLocaleString(EN ? 'en-GB' : 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
    const get = u => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const day = iso => { const d = new Date(iso + 'T12:00:00Z'); return isNaN(d) ? iso : d.toLocaleDateString(EN ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
    const month = ym => { const d = new Date(ym + '-15T12:00:00Z'); return isNaN(d) ? ym : d.toLocaleDateString(EN ? 'en-GB' : 'fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
    const delta = (a, b, unit) => { if (a == null || b == null) return ''; const x = a - b; if (Math.abs(x) < 0.005) return ''; return '<span class="' + (x > 0 ? 'up' : 'down') + '">' + (x > 0 ? '▲ +' : '▼ −') + num(Math.abs(x), 2) + '</span> ' + unit; };
    const tile = (route, label, value, unit, sub) => '<a class="pkb-tile" href="#' + route + '" data-route="' + route + '"><span class="pkb-tile-l">' + label + '</span><span class="pkb-tile-v">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</span>' +
      '<span class="pkb-tile-s">' + sub + '</span><span class="pkb-tile-go">' + esc(L(byRoute[route])) + ' →</span></a>';
    // two figures in one tile (solar and wind), each under its name
    const pair = (a, b) => '<span class="pkb-tile-2"><span><i>' + T('solaire', 'solar') + '</i>' + a + '</span><span><i>' + T('éolien', 'wind') + '</i>' + b + '</span></span>';
    Promise.all([get('data/history/ppa_benchmark.json'), get('data/m0.json'), get('data/history/bess_da.json')]).then(([ppa, m0, bess]) => {
      const out = [];
      let stamp = '';
      if (ppa && ppa.days) {
        const ks = Object.keys(ppa.days).sort(), d = ppa.days[ks[ks.length - 1]], prev = ppa.days[ks[ks.length - 2]] || {};
        stamp = day(ks[ks.length - 1]);
        const years = String(d.tenor || '').split('-'), ten = years.length > 1 ? years[0] + '–' + years[years.length - 1] : (d.tenor || '');
        [['solar', T('PPA de référence · solaire', 'Reference PPA · solar')], ['wind', T('PPA de référence · éolien', 'Reference PPA · wind')]].forEach(([k, lab]) => {
          if (!d[k]) return;
          out.push(tile('tools/ppa', lab, num(d[k].ppa, 2), '€/MWh', T('livraison ', 'delivery ') + ten + ' · ' + (delta(d[k].ppa, prev[k] && prev[k].ppa, T('vs veille', 'vs day before')) || T('inchangé vs veille', 'unchanged vs day before'))));
        });
      }
      if (m0 && m0.months && m0.months.length) {
        const done = m0.months.filter(x => x.complete), m = done[done.length - 1] || m0.months[m0.months.length - 1];
        out.push(tile('renewables/capture', T('Taux de capture · ', 'Capture rate · ') + month(m.month), pair(num(m.solarRatio * 100, 0) + ' %', num(m.windRatio * 100, 0) + ' %'), '', T('part du prix base du mois (', 'share of the month’s baseload (') + num(m.base, 1) + ' €/MWh)'));
        out.push(tile('renewables/m0', 'M0 · ' + month(m.month), pair(num(m.solarM0, 1), num(m.windM0, 1)), '', T('€/MWh, recalculé avant la publication de la CRE', '€/MWh, recomputed before the CRE publishes')));
      }
      if (bess && bess.summary_ltm && bess.summary_ltm['2h']) {
        const b2 = bess.summary_ltm['2h'], b4 = bess.summary_ltm['4h'] || {};
        // two tiles (2 h and 4 h): the row of benchmarks keeps an even count (owner, 23 Nov. 2026)
        out.push(tile('markets/bess', T('Batterie 2 h · valeur day-ahead', '2 h battery · day-ahead value'), num(b2.pf, 1), 'k€/MW/' + T('an', 'yr'), T('12 mois glissants, prévision parfaite', 'last 12 months, perfect foresight')));
        if (b4.pf != null) out.push(tile('markets/bess', T('Batterie 4 h · valeur day-ahead', '4 h battery · day-ahead value'), num(b4.pf, 1), 'k€/MW/' + T('an', 'yr'), T('12 mois glissants, prévision parfaite', 'last 12 months, perfect foresight')));
      }
      if (!out.length) { box.remove(); return; }
      box.innerHTML = '<div class="pkb-orig-h"><b>' + T('Repères d’origination · France', 'Origination benchmarks · France') + '</b><span>' + (stamp ? T('PPA calculé le ', 'PPA computed on ') + stamp + ' · ' : '') +
        T('sources : pricer PowerKlock, RTE (ODRÉ), ENTSO-E', 'sources: PowerKlock pricer, RTE (ODRÉ), ENTSO-E') + '</span></div>' + out.join('');
    });
  })();

  // ── one chart grid: a few heights by width of the card, nothing tiny, nothing giant ──
  // Only charts drawn by Chart.js with a free height (maintainAspectRatio: false) whose box holds that one canvas are
  // touched; a chart that needs its own height (timeline of outages: one row per unit, maps, the spiral) keeps it.
  // ?pkbsize=0 turns this off.
  // Heights are those of STYLEGUIDE.md § 3: 280 px for charts side by side, 320 px for a full-width chart, 360 px
  // for the tall ones (hourly profiles), 240 px in a narrow column; charts of one row share the tallest.
  const SIZE_ON = !/[?&]pkbsize=0/.test(location.search);
  const KEEP = new Set(['ro-tl', 'rp-canvas']);   // timelines and maps: their height carries information
  const snap = (w, h) => (w >= 900 ? (h > 340 ? 360 : 320) : w >= 480 ? (h > 300 ? 320 : 280) : (h > 260 ? 280 : 240));
  function sizeCharts() {
    if (!SIZE_ON || !window.Chart) return;
    const root = activeRoot(); if (!root || root.id === 'page-mydash') return;   // a dashboard tile is sized by its owner
    const todo = [];
    root.querySelectorAll('canvas').forEach(c => {
      if (c.offsetParent === null || c.closest('.pkd-item, .grid-stack-item')) return;
      const ch = Chart.getChart(c), box = c.parentElement; if (!box) return;
      const r = c.getBoundingClientRect();
      if (KEEP.has(c.id)) return;
      if (!ch || ch.options.maintainAspectRatio !== false) return;
      if (r.width < 300 || r.height < 120) return;   // sparklines in tiles keep their size
      if (box.querySelectorAll('canvas').length !== 1) return;
      if (Math.abs(box.getBoundingClientRect().height - r.height) > 24) return;   // the box is not the chart's own
      const type = ch.config.type;
      if (ch.options.indexAxis === 'y' && r.height > 380) return;   // ranked bars: one row per zone
      if (type === 'doughnut' || type === 'pie' || type === 'radar' || type === 'polarArea') return;   // round charts keep their square
      todo.push({ c, ch, box, r, want: c.dataset.pkbSized ? +c.dataset.pkbSized : snap(r.width, r.height) });
    });
    // charts side by side: one height for the row
    todo.forEach(a => todo.forEach(b => {
      if (a === b || !(a.r.right <= b.r.left + 4 || b.r.right <= a.r.left + 4)) return;   // not beside each other
      const top = Math.max(a.r.top, b.r.top), bot = Math.min(a.r.bottom, b.r.bottom);
      if (bot - top > 0.5 * Math.min(a.r.height, b.r.height)) { const m = Math.max(a.want, b.want); a.want = m; b.want = m; }
    }));
    todo.forEach(({ c, ch, box, r, want }) => {
      c.dataset.pkbSized = String(want);
      if (Math.abs(r.height - want) < 6) return;
      box.classList.add('pkb-sized');
      box.style.height = want + 'px'; box.style.minHeight = '0'; box.style.maxHeight = 'none';
      if (c.style.height) c.style.height = want + 'px';
      // a chart stretched by its card to the height of a tall neighbour (a table beside it): up to 400 px it keeps
      // filling its card; beyond, it takes the tall height of the grid and stops growing
      const h = box.getBoundingClientRect().height;
      if (h > want + 24) {
        if (h > 400) { box.style.flex = '0 0 auto'; box.style.height = '360px'; c.dataset.pkbSized = '360'; if (c.style.height) c.style.height = '360px'; }
        else c.dataset.pkbSized = String(Math.round(h));
      }
      try { ch.resize(); } catch (e) { /* the chart resizes by itself on the next frame */ }
    });
  }
  let sizeT = 0;
  const sizeLater = () => { clearTimeout(sizeT); sizeT = setTimeout(sizeCharts, 500); };
  window.addEventListener('load', () => setTimeout(sizeCharts, 1500));
  window.addEventListener('resize', () => { document.querySelectorAll('canvas[data-pkb-sized]').forEach(c => { delete c.dataset.pkbSized; }); sizeLater(); });
  document.addEventListener('click', () => { sizeLater(); setTimeout(sizeCharts, 2500); });
  window.addEventListener('popstate', sizeLater);
  // a chart drawn later (slow data, a section unfolded by code) is sized too: once after the last new chart
  try { if (window.Chart && Chart.register) Chart.register({ id: 'pkbSize', afterInit() { sizeLater(); } }); } catch (e) { /* the clicks and page changes above still size the charts */ }
  new MutationObserver(ms => { if (ms.some(m => m.target.classList && m.target.classList.contains('hist-section'))) sizeLater(); })
    .observe(main, { attributes: true, attributeFilter: ['class'], subtree: true });
  PKBeta.sizeCharts = sizeCharts;
  PKBeta.afterNav = () => { sizeLater(); setTimeout(sizeCharts, 2500); };
})();
