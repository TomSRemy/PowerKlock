# Audit UX et visuel de PowerKlock (1er novembre 2026)

Base mesurée : `main` au commit 4e894f72 (après le lot de notes du 1er novembre), servi en local, site en français
(langue par défaut). Outil : `scripts/audit_site.py` (calibré pour PowerKlock, voir son en-tête), 85 vues à 1 440 px,
les mêmes 85 à 390 px, puis une passe de largeur à 1 024, 1 180 et 1 280 px. Mesures brutes : `audit_out/data.json`
et `audit_out/rapport.md` (non versionnés, à régénérer). Complété par une sonde de langue (chaque texte, légende,
titre d'axe, info-bulle et lecture au survol relevé en français puis en anglais) et par la lecture du code.

## 1. Synthèse

État général : site dense, rapide à lire pour un professionnel, sans erreur JavaScript sur les 170 vues, aucune
valeur cassée (NaN, undefined) affichée, aucun graphique vide sans message. Le gabarit Marchés › Day-ahead est
appliqué presque partout. Les défauts sont de finition et de cohérence, pas de structure.

Cinq problèmes majeurs (avant correctifs) :
1. **Langue** : 357 textes restaient en anglais sur le site français (légendes, titres d'axes, libellés KPI,
   info-bulles, notes de source) et la lecture au survol des graphiques écrivait `278.6 €/MWh` (point décimal).
2. **Contraste** : 210 textes sous 4,5:1, dont 160 noms de cartes KPI neutres en `#4A6280` (2,5:1) ; liens bruts en
   bleu navigateur (2:1) sous Événements et sous le réel du matin.
3. **Lissage interdit** : 30 courbes encore lissées (`tension` 0,2 à 0,35), contraire à la règle « lignes droites ».
4. **Débordements** : Méthodologie (1 324 px) et Analyse de marché (1 285 px) plus larges que l'écran entre 1 024
   et 1 280 px ; tableaux d'Aujourd'hui › Expert et barre de Rejouer coupés sur téléphone.
5. **Dispersion des styles** : 31 structures de pages, 11 tailles de police (dont 9 et 9,5 px), 39 styles de boutons,
   4 rayons de tuiles (8, 10, 12 px), 167 couleurs de séries ; `EUR/MWh` sur Électricité forwards seulement.

## 2. Arbre de navigation et gabarits

### Arbre (adresse › onglets de vue)

- **Aujourd'hui** `#today` › Coup d'œil, Découverte, Expert
- **Mes tableaux de bord** `#dashboards` › Mon tableau de bord, Point marché, + Nouveau
- **Marchés**
  - Électricité spot (barre de groupe) : Vue d'ensemble `#markets/spot/overview` ; Day-ahead `#markets/spot` › Quotidien,
    Historique ; Prix négatifs `#markets/spot/negative` ; Spreads `#markets/spot/spread` ; Déséquilibre
    `#markets/spot/imbalance` › Quotidien, mFRR
  - Électricité forwards `#markets/forwards` › Tableau, Comparaison, Contrats calendaires
  - Gaz, carbone, pétrole (barre de groupe) : Prix spot `#markets/fuels` › Vue d'ensemble, Gaz, Charbon & pétrole ;
    Courbes forward `#markets/fuels/forwards` › Courbes, TTF : contrats et cotations ; Spark & dark spreads
    `#markets/fuels/spreads` › Quotidien, Historique
  - Garanties d'origine `#markets/go` › EU, Enchères France
  - Batteries (BESS) `#markets/bess` › Europe, Valeur day-ahead, Réserves, Sources de revenus, Mécanisme de capacité,
    Méthode, Indice
- **Renouvelables** : Capture & cannibalisation `#renewables/capture` › Quotidien, Historique, M0, Cannibalisation,
  Capture forward ; Contrat M0 `#renewables/m0` (onglet M0 de la même page) ; Capacité installée
  `#renewables/capacity` › Par année, Comparaison
- **Système électrique** : Carte d'Europe `#system/map` ; Production (groupe) : Mix `#system/generation` › Quotidien,
  Historique, Nucléaire `#system/generation/nuclear`, Indisponibilités & REMIT `#system/generation/outages` ›
  Indisponibilités, Plateformes ; Conso. & échanges (groupe) : Consommation `#system/demand`, Échanges
  `#system/demand/flows` › Quotidien, Frontières ; France (groupe) : Système `#system/france` › Quotidien, Historique,
  Régions `#system/france/regions` › Quotidien, Capacités et consommation ; Météo (groupe) : Villes `#system/weather` ›
  Quotidien, Prévision 5 semaines, Réservoirs hydrauliques, DJU `#system/weather/hdd` › Quotidien, Hebdomadaire ;
  Bilan électrique `#system/bilan` ; Intensité carbone `#system/carbon`
- **Outils** : Pricer PPA `#tools/ppa` › Entrées et prix, Le parc, Méthodes, Comparaison et prix ; Pricer BOA
  `#tools/boa` › Entrées et résultat, La batterie, Structures de contrat ; Prévision de production `#tools/forecast` ›
  Site et prévision, Valoriser ce parc, Quelle fiabilité (+ Solaire, Éolien) ; Empreinte carbone `#tools/carbon` ›
  Vos données, Vue d'ensemble, Consommation, Carbone, Coût & flexibilité, Solaire & couverture, Reporting ; Analyse
  de marché `#intel/analysis` ; Rejouer une journée `#system/replay` ; Indice BESS `#tools/bess-index` (onglet Indice
  de Batteries) ; Comparateur `#tools/compare` ; Convertisseur `#tools/converter`
- **Veille** : Actualités `#intel/news` ; Évolutions et événements `#intel/regulation`
- **Pied de menu** : État des données `#status` › Sources, Problèmes de flux ; API `#api` ; Méthodologie
  `#methodology` ; À propos `#about`
- **Hors menu** : tableau de bord France (choix de zone « France » de la barre du haut, `js/scope.js`, annoncé « à
  retirer ») ; page `#page-overview` « Market Overview » (HTML resté dans `index.html`, aucune adresse ne l'ouvre).

44 adresses, 86 vues distinctes (les adresses qui ouvrent un onglet d'une autre page ne comptent qu'une fois).

### Gabarits mesurés

Le script relève 31 enchaînements de blocs différents, mais ils se ramènent à **5 gabarits réels** :

| Gabarit | Signature | Pages |
|---|---|---|
| G1 Analyse (cible) | barre collante › sections (KPI, graphiques, tableau) | 62 vues : Marchés, Renouvelables, Système, État des données |
| G2 Tableau de bord | barre › grille de tuiles sans sections | Aujourd'hui (Coup d'œil, Découverte), Mes tableaux de bord, Bilan électrique |
| G3 Outil | barre › entrées › résultats en sections | Pricers PPA et BOA, Prévision, Empreinte carbone, Comparateur, Rejouer |
| G4 Lecture longue | barre › texte ou liste | Méthodologie, API, À propos, Actualités, Évolutions, Batteries › Méthode |
| G5 Pleine page | panneaux propres (axe de temps commun) | Analyse de marché, Carte d'Europe |

Cible : 3 gabarits (Tableau de bord, Analyse, Outil / référence). G4 se fond dans G3 (une colonne de texte de 760 px
dans des sections) ; G5 garde sa mise en page interne mais prend la barre collante standard (déjà le cas). Effort de
migration : faible, les écarts sont des pages qui empilent un deuxième niveau de sections (Électricité spot ›
Quotidien : 3 sections dont une avec ses propres onglets) ; voir B-03.

## 3. Tableau A. À FAIRE (correctifs sans débat)

Statut : **fait** = dans les commits de cette nuit ; **reste** = non fait, avec la raison.

| ID | Prio | Page | Problème (mesure) | Correctif précis | Effort | Statut |
|---|---|---|---|---|---|---|
| A-01 | P1 | Tout le site | 357 textes visibles restés en anglais en français (sonde FR/EN) | 191 textes + 52 modèles ajoutés à `assets/i18n_fr.json` / `i18n_fr_tpl.json` | M | fait |
| A-02 | P1 | Électricité spot | Lecture multi-zones à moitié anglaise (« Cheapest… most expensive… above ES ») : phrase coupée par les chiffres en couleur, le dictionnaire ne peut pas la traduire | branche fr/en dans `js/hist/single-zone.js` (`_buildAnalystBanner`, modes cc*) et `js/prices/home.js` | S | fait |
| A-03 | P1 | Tous les graphiques | Lecture au survol dessinée sur le canvas, hors traduction : `278.6 €/MWh`, noms anglais, « +3 more » | `js/libs.js` pkHoverReadout : nom, valeur et date passent par `PKI18n.tr` | S | fait |
| A-04 | P2 | Graphiques intrajournaliers | Repère « NOW » en anglais | `js/palette.js` nowLineAnnotation et `js/meteo.js` : « MAINTENANT » en français | S | fait |
| A-05 | P1 | 30 courbes | Lissage `tension` 0,2 à 0,35 (règle : lignes droites) | `tension: 0` dans fr-system, genmix-series, market-update, negatives-charts, power-map, tool-carbon, tool-forecast | S | fait |
| A-06 | P1 | ~45 pages | 160 noms de cartes KPI neutres à 2,5:1 (`#4A6280`) | `.kpi-card.kpi-flat .kpi-label { color: var(--text3) }` (bordure grise gardée) | S | fait |
| A-07 | P1 | Analyse de marché | Sous-libellés `.ma-lbl-sub` 9 px en `#4A6280` (3,1:1) | 10 px, `var(--text3)` | S | fait |
| A-08 | P2 | Global | Alias `--tx4: #4A6280` (2,95:1) alors que `--text4` corrigé en `#7088A4` | `--tx4: #7088A4` | S | fait |
| A-09 | P1 | Évolutions, Aujourd'hui | Liens au bleu du navigateur `rgb(0,0,238)` (2:1) | `.reg-nl a`, `.mrn-reel-open` aux couleurs du site | S | fait |
| A-10 | P1 | Méthodologie | Page de 1 324 px à 1 024 à 1 280 px (tableau `.meth-table` de 793 px) | `.meth-table { display:block; max-width:100%; overflow-x:auto }` | S | fait |
| A-11 | P1 | Analyse de marché | 1 285 px après rétrécissement de la fenêtre (colonne `1fr` gardait la largeur du canvas) | `.ma-panel-row { grid-template-columns: 136px minmax(0,1fr) }` | S | fait |
| A-12 | P1 | Aujourd'hui › Expert, Rejouer, Méthodologie (390 px) | Tableaux coupés à 491 px, bouton Exporter à 422 px | sous 700 px : boîte du tableau défilante, `.rp-bar { flex-wrap: wrap }` | S | en partie : Rejouer corrigé ; Expert (439 px) et Méthodologie (471 px, mots longs dans `.meth-p`) débordent encore, cause relevée, correctif au prochain lot |
| A-13 | P2 | Global | Texte à 8, 8,5, 9 et 9,5 px (bandeau, M0, point marché, analyse, puces du pricer) | plancher 10 px dans `css/site.css` (23 règles) | S | fait |
| A-14 | P2 | Global | Sous-titres et notes à 10,5 px (42 000 caractères) | `.fuel-card-sub`, `.fuel-note`, tuiles BOA : 11 px | S | fait |
| A-15 | P2 | Aujourd'hui, Bilan | Rayons 10 et 12 px au lieu de 8 | `.mrn2-tile`, `.bl-k`, `.bl-blk` : 8 px | S | fait |
| A-16 | P2 | Global | 921 caractères en Arial (boutons sans police) | `:where(button, select, input, textarea) { font-family: inherit }` | S | fait |
| A-17 | P2 | system/demand, Analyse | Focus clavier invisible (WCAG 2.4.7) | `:where(…):focus-visible { outline: 2px solid var(--accent) }` | S | fait |
| A-18 | P2 | Électricité forwards | `EUR/MWh` (12 fois) au lieu de `€/MWh` | `pfSym()` dans `js/pr-forward.js` (€ et £) | S | fait |
| A-19 | P2 | Garanties d'origine | 4 graphiques sans source | badge « Commerg weekly » (`index.html`) | S | fait |
| A-20 | P2 | 7 pages | 11 champs de date sans libellé accessible | `aria-label` From / To / Delivery day (traduits) | S | fait |
| A-21 | P2 | Prévision › Quelle fiabilité | Lignes « Solar · Occitanie » en anglais | `TT('Solaire','Solar')` dans `js/tool-forecast.js` | S | fait |
| A-22 | P2 | Production (Mix, Historique, multi-zones) | « Market read : Geographic dispersion structural… » : 35 verdicts en anglais | verdict dans son propre élément (`js/genmix.js`) + 22 textes et 13 modèles au dictionnaire | M | fait |
| A-23 | P2 | Capture, M0, Prévision, Analyse | 7 notes longues générées avec chiffres (m0.js, capture-forward.js, tool-forecast.js x2, meteo.js `wx-note`, news.js, note « Data sources » d'Analyse) | branche fr/en à la source | M | reste |
| A-24 | P2 | Prévision | Statut « Solar · 49,44, 1,10 · 10,0 MW · average of 3 weather models… » en anglais | branche fr/en `js/tool-forecast.js` (statut du site et historique du parc) | S | fait |
| A-25 | P2 | Sources de graphiques | 45 graphiques sans badge source sous le titre ; « Market data » ne nomme pas la source (Gaz, carbone, pétrole) | nommer le flux réel (voir `scripts/fetch_commodities.py`) | S | reste : nom du fournisseur à confirmer par Tom |
| A-26 | P2 | Global | 326 cibles cliquables < 24 px (boutons de période `.pk-gf-btn` 22 px, étoiles, ↓, ⤢) | hauteur 24 px minimum | S | reste : touche toutes les barres d'outils, à valider visuellement |
| A-27 | P2 | Tableaux | 14 tableaux hors norme (marges 5 à 7 px, 11 à 13 px) | appliquer la norme du STYLEGUIDE § 4 | M | reste |
| A-28 | P3 | H1 | 3 tailles de H1 (22, 24, 26 px), H3 en 5 variantes | `.meth-h1`, `.reg-h1`, `.bl-h1` à 22 px ; H3 non traités | S | fait pour H1 |
| A-29 | P3 | Graphiques | 22 canvas sans description ; GO : 7 axes sans unité | `js/align-rows.js` décrit aussi les cartes du Bilan, de l'Analyse et d'Aujourd'hui (22 → 13) ; axes GO non traités | S | en partie |
| A-30 | P3 | Requêtes | 404 attendus et répétés : fichier du lendemain (`daily/2026-11-02.json`) et du mois neuf (`rte/2026-11.json`, `monthly/2026-11.json`) demandés avant publication, sur Prévision, État, API, Méthodologie, Rejouer | lire d'abord l'index (`data/history/index`) au lieu de sonder | S | reste : pas un bug visible, bruit dans la console |
| A-31 | P3 | Carte d'Europe | Bouton de zoom Leaflet « Zoom in » non traduit | entrée de dictionnaire ajoutée (A-01) | S | fait |

Total sur 31 : 23 faits, 3 en partie (A-12, A-28, A-29), 5 restent (A-23, A-25 en attente d'une information de Tom, A-26, A-27, A-30).

Problèmes relevés dans le **pricer PPA** (non touché, travail en cours en parallèle) : 3 liens `href="#"` par onglet ;
bouton `.pp-chip-reset` sans libellé ; tuiles `pp-mcard` à 10 px de rayon et fond `#151c24` ; 2 courbes encore
lissées (`tension: .35`, `js/tool-ppa.js` l. 1387-1388) et 5 dans `js/ppa-fan.js` ; 25 info-bulles des réglages en
anglais (traduites cette nuit par le dictionnaire, sans toucher au code).

## 4. Tableau B. À VALIDER (modifications fortes, rien n'est fait)

| ID | Page(s) | Proposition | Bénéfice | Risque | Effort | Alternative |
|---|---|---|---|---|---|---|
| B-01 | Toutes | Trois gabarits seulement (Tableau de bord, Analyse, Outil / référence), voir STYLEGUIDE § 1 ; maquette : barre collante, puis sections ; en G3 les entrées dans une première section repliable à gauche | lecture identique partout (Nielsen 4, cohérence) | casse de mise en page sur les pages G4/G5 | M | garder 5 gabarits documentés |
| B-02 | Empreinte carbone | Masquer les 6 onglets de résultat tant qu'aucune donnée n'est chargée (aujourd'hui 197 à 309 caractères, contenus identiques) ; maquette : un seul écran « Vos données » avec bouton « Voir l'exemple » | supprime 6 pages vides (Nielsen 8) | aucun | S | afficher l'exemple chargé par défaut |
| B-03 | Électricité spot › Day-ahead | Scinder Quotidien (3 sections, 15 tuiles, 4 graphiques, 2 tableaux, une sous-barre d'onglets) : « Tendance spot » rejoint Historique | page plus courte, un seul niveau d'onglets | habitudes | S | replier la 3e section par défaut |
| B-04 | Hors menu | Supprimer `#page-overview` (HTML mort, « Market Overview / Loading… ») et le tableau de bord France annoncé « à retirer » | 2 pages mortes en moins, `index.html` plus léger | lien « Previous France dashboard » à retirer | S | les garder jusqu'à la refonte France |
| B-05 | Forwards, Gaz | Fusionner Électricité forwards › Comparaison (587 caractères, 1 graphique) dans Tableau, et Gaz › Charbon & pétrole (2 graphiques) dans Vue d'ensemble | moins d'onglets maigres | densité accrue | S | enrichir ces onglets |
| B-06 | Météo | Fusionner DJU › Hebdomadaire (1 graphique, 1 tableau) dans DJU › Quotidien ; Réservoirs hydrauliques vers Production › Mix | onglets maigres en moins | aucun | S | garder |
| B-07 | Global | Couleurs fixes par filière et par zone dans une seule table JS (`js/palette.js`) : aujourd'hui « Solaire » a 4 couleurs, « Éolien » 4, « Gaz » 3, « France » 5, `C_WIND` `#C4A57B` dans `libs.js` contre `--gen-wind` `#14D3A9` | même série = même couleur partout (Forsell : encodage) | changement visuel sur des dizaines de graphiques | M | ne corriger que les filières |
| B-08 | Global | Nucléaire `#7B4B9C` (2,4:1 sur le fond) vers `#9B6BC4` (3,2:1) ; pompage `#1E3A8A` vers `#4F7BD9` ; séries `#0F1419` (marqueurs invisibles) en `#B8C9D9` | séries lisibles (WCAG 1.4.11) | couleur de marque du nucléaire modifiée | S | contour clair 1 px sur les aires |
| B-09 | Global | Hauteur de bouton 24 px minimum (A-26) et 2 styles de bouton de période au lieu de 39 variantes mesurées | cibles tactiles (WCAG 2.5.8) | barres plus hautes | M | ne traiter que le mobile |
| B-10 | Global | Recherche globale déjà là (Ctrl K) : ajouter les données (« prix négatifs FR 2025 » ouvre la page filtrée) et des liens profonds `?zone=` `&date=` sur chaque adresse | données trouvées en 1 geste (Nielsen 7) | stockage d'état dans l'URL | M | liens contextuels entre pages seulement |
| B-11 | Aujourd'hui › Expert | 29 graphiques et 47 tuiles sur une page (15 500 caractères) : petits multiples ou sections repliées par défaut | temps de lecture | moins de choses visibles d'un coup | S | ancre « Aller à » en haut |
| B-12 | Global | Libellés de 10 px (en-têtes de tableau, libellés KPI, badges, 2 700 occurrences) à 11 px | lisibilité (le brief vise 11 px) | densité Bloomberg réduite | S | garder 10 px en capitales (choix actuel, STYLEGUIDE) |
| B-13 | Tableaux de bord | Les modèles de tableau de bord ont des noms anglais en dur (« Market update ») et la description générée est anglaise | cohérence | noms enregistrés chez les utilisateurs | S | traduire à l'affichage seulement (fait pour le nom) |
| B-14 | Global | Appliquer la règle « violet réservé au nucléaire » : remplacer `#8B7FB5`, `#A87DC4`, `#B48CF2`, `#E879F9`, `#A21CAF` (carbone, charge résiduelle, batteries, 8e couleur de série) par des teintes bleues, ambre ou sable | le nucléaire se reconnaît d'un coup d'œil | change des couleurs installées (carbone dans le bandeau et les actualités) | S | ne traiter que les séries de graphiques |

Maquettes décrites : B-01 (gabarit Outil) = barre collante avec fil d'Ariane et onglets, section 1 « Entrées »
repliable sur 320 px à gauche, sections de résultats à droite (KPI en tête, graphiques par paires, tableau, note) ;
B-02 = écran unique avec la zone de dépôt du fichier, deux boutons « Charger l'exemple » et « Mes données », les
onglets apparaissent après le chargement ; B-03 = Quotidien garde « Tableau day-ahead » et « Analyse multi-zones »,
« Tendance spot » devient la première section d'Historique.

## 5. Normes proposées

Voir `STYLEGUIDE.md` (tuile, graphique, tableau, texte, couleurs, boutons, langue). Points figés :
tuile 8 px de rayon, 16 px de marge, bordure 1 px `--border`, KPI sur `#1c242e` ; graphique 280 ou 320 px,
graduations 10 px `#7A93AB`, grille `rgba(26,45,63,.5)`, légende en bas, `tension: 0`, zoom rectangle et « ↺ » ;
tableau en-têtes 10 px capitales, cellules 13 px mono ; texte en 7 paliers (10, 11, 12, 13, 15, 22 px) ;
`€/MWh`, nombres au format de la langue, tout texte dessiné sur canvas passé par `PKI18n.tr`.

## 6. Verdict par page

| Page | Verdict | Justification |
|---|---|---|
| Aujourd'hui › Coup d'œil, Découverte | Garder | page d'entrée claire, date du jour visible, KPI en haut à gauche |
| Aujourd'hui › Expert | Enrichir (alléger) | 29 graphiques sur une page : B-11 |
| Mes tableaux de bord | Garder | page personnelle, rien à signaler |
| Électricité spot › Vue d'ensemble | Garder | |
| Électricité spot › Day-ahead | Enrichir | B-03 |
| Prix négatifs, Spreads | Garder | |
| Déséquilibre › Quotidien, mFRR | Garder | |
| Électricité forwards › Tableau | Garder | |
| Électricité forwards › Comparaison | Fusionner avec Tableau | 1 graphique (B-05) |
| Électricité forwards › Contrats calendaires | Garder | |
| Gaz, carbone, pétrole › Vue d'ensemble, Gaz | Garder | source « Market data » à nommer (A-25) |
| Gaz › Charbon & pétrole | Fusionner avec Vue d'ensemble | 2 graphiques (B-05) |
| Courbes forward, Spark & dark spreads | Garder | |
| Garanties d'origine › EU, Enchères France | Garder | |
| Batteries (7 onglets) | Garder | Méthode : texte seul, à placer en note repliée |
| Capture & cannibalisation (5 onglets) | Garder | page de référence la plus riche |
| Contrat M0 | Garder (adresse) | même page que Capture › M0 |
| Capacité installée | Garder | |
| Carte d'Europe | Garder | |
| Production › Mix, Nucléaire, Indisponibilités | Garder | verdicts anglais (A-22) |
| Consommation, Échanges | Garder | |
| France › Système, Régions | Garder | |
| Météo › Villes, Prévision 5 semaines | Garder | |
| Météo › Réservoirs hydrauliques | Fusionner (Production) | B-06 |
| DJU › Quotidien | Garder | dépend d'Open-Meteo dans le navigateur (429 possible) |
| DJU › Hebdomadaire | Fusionner avec Quotidien | B-06 |
| Bilan électrique | Garder | |
| Intensité carbone | Enrichir | un tableau seul (622 caractères) : ajouter le graphique de la carte |
| Pricer PPA, Pricer BOA, Prévision | Garder | |
| Empreinte carbone | Enrichir | 6 onglets vides sans données (B-02) |
| Analyse de marché | Garder | |
| Rejouer une journée | Garder | |
| Indice BESS | Garder (adresse) | même vue que Batteries › Indice |
| Comparateur, Convertisseur | Garder | |
| Actualités, Évolutions et événements | Garder | |
| État des données, API, Méthodologie, À propos | Garder | |
| Market Overview (`#page-overview`) | Supprimer | HTML mort (B-04) |
| Tableau de bord France (hors menu) | Supprimer | annoncé « à retirer » (B-04) |

## 7. Notation (heuristiques)

Nielsen (0 à 4) : visibilité de l'état 3 (dates de livraison partout, « Dernières données ») ; correspondance avec
le monde réel 4 ; contrôle et liberté 3 (Retour du navigateur, ↺, mais pas de lien profond vers une zone ou une date) ;
cohérence et standards 2 (31 enchaînements, 39 styles de boutons, langue mêlée avant correctifs) ; prévention des
erreurs 3 ; reconnaissance plutôt que rappel 3 ; flexibilité 3 (Ctrl K, tableaux de bord) ; esthétique et
minimalisme 2 (Aujourd'hui › Expert, Day-ahead › Quotidien surchargés) ; aide à la récupération 3 (messages « pas de
données » présents) ; aide et documentation 4 (Méthodologie, notes de source). **Total 30/40 : bon.**

Forsell et Johansson (visualisation) : type de graphique adapté 3 ; ratio signal/bruit 3 ; encodage lisible 2
(couleurs de séries instables entre pages, nucléaire peu contrasté) ; interaction claire 3 (zoom, ↺, lecture au
survol) ; orientation (titre, unité, source) 3.

Sévérité des constats (fréquence × impact × persistance) : langue et contraste = élevée (toutes les pages, à chaque
visite) ; débordements = moyenne (largeurs précises) ; dispersion des styles = faible (gêne, pas de blocage).

**Les 3 correctifs les plus rentables** : (1) passer tout texte de canvas et toute phrase générée par `PKI18n.tr` ou
une branche fr/en (A-01 à A-03) ; (2) le contraste des libellés KPI neutres (A-06, une ligne de CSS, 160 tuiles) ;
(3) le plancher de 10 px et la norme de tuile (A-13 à A-15).

## 8. Ce qui n'a pas pu être vérifié

- Tableau de bord France (hors menu) : la vue n'a pas été mesurée par le script (ouverte par le choix de zone).
- Électricité spot › Day-ahead › Historique : l'onglet n'a pas été mesuré séparément (même clé de vue que Quotidien
  pour le script) ; ouvert à la main seulement.
- Interactions une à une (tri de chaque tableau, chaque bouton de période) : vérifiées par échantillon (5 pages), pas
  exhaustivement ; le zoom rectangle et « ↺ » sont globaux (`js/zoom-reset.js`).
- Graphiques nourris en direct par Open-Meteo dans le navigateur (DJU, prévision météo) : la limite 429 d'Open-Meteo a
  touché la première passe ; leur message « Open-Meteo did not respond » existe dans le code.
- Mobile réel (tactile) : simulé à 390 px dans Chromium, pas sur un téléphone.
- Version en ligne (https://tomsremy.github.io/PowerKlock/) : non auditée cette nuit ; la mesure porte sur le code
  de `main`, identique une fois publié.
- Thème clair : non audité (contrastes mesurés sur le thème sombre par défaut).

## 9. Avant / après

Même script, mêmes réglages, deux passes complètes (desktop et 390 px, plus 1 024 / 1 180 / 1 280 px). « Avant » = `main` au début de l'audit ; « Après » = `main` après les correctifs de la partie A poussés (le lot de notes du 1er novembre est arrivé entre les deux : 3 vues de plus). Les constats « À faire » du script comptent aussi des écarts que la partie A ne traite pas (cibles < 24 px, tableaux hors norme, libellés de 10 px gardés par choix).

| Mesure | Avant (4e894f72) | Après (65bd7baa) |
|---|---|---|
| vues desktop / mobile | 84 / 84 | 87 / 87 |
| erreurs JS | 0 | 0 |
| textes < 4,5:1 | 209 | 8 |
| textes < 11 px | 2474 | 2215 |
| textes < 10 px | 81 | 33 |
| vues plus larges que l'écran (390 px) | 3 | 2 |
| vues plus larges que l'écran (1 024 à 1 280 px) | 6 | 0 |
| courbes lissées (tension > 0) | 10 | 3 |
| champs sans libellé accessible | 19 | 3 |
| canvas sans description (aria) | 22 | 13 |
| focus clavier invisible (pages) | 2 | 0 |
| « EUR/MWh » affichés | 12 | 0 |
| caractères en Arial | 921 | 0 |
| tailles de police utilisées (> 0,5 %) | 11 | 10 |
| rayons de tuiles | 10px, 12px, 8px | 10px, 8px |
| constats « À faire » du script | 600 | 551 |
| textes restés en anglais (sonde FR/EN, candidats) | 599 | 256 |

Restes mesurés après : 8 textes peu contrastés (classement multi-zones de Production › Quotidien : texte sombre sur fond clair de rang ; deux valeurs rouges d'Intensité carbone à 4,2 et 4,5:1) ; 3 courbes lissées dans le pricer PPA et le profil journalier de Cannibalisation (`js/tool-ppa.js`, hors périmètre cette nuit) ; 256 candidats de langue, surtout des noms propres et termes métier (Open-Meteo, TTF day-ahead, Spread, codes de contrats), des titres d'articles et les info-bulles du pricer.
