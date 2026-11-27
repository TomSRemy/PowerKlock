# État des lieux des structures de pages (mis à jour le 17 novembre 2026)

Objectif : décider comment harmoniser PowerKlock pour qu'il se lise de la même façon partout. Ce document complète
`AUDIT_POWERKLOCK.md` (1er novembre : langue, contraste, finitions) et `STYLEGUIDE.md` (normes des tuiles, graphiques
et polices). Il porte sur un autre niveau : **ce que contient chaque page et dans quel ordre**.

Base : commit `607fab2`, site en français, 90 vues (44 adresses × onglets), mesurées automatiquement par Playwright à
1 440 × 900 px (PC) et 390 × 844 px (mobile) ; captures d'écran relues pour les pages types.

Maquettes : « Structures PowerKlock » (diagrammes, schéma du menu, avant / après de chaque vue) et « Maquettes
Électricité spot » (pages validées), sur claude.ai.

---

## 1. En bref

- **Prises une par une, les pages sont correctes** : note moyenne 4,2 / 5. Aucune ne déborde à 390 px, 71 vues sur
  90 suivent déjà « barre collante puis sections ».
- **Le côté brouillon vient des écarts entre les pages** : 90 vues donnent **64 enchaînements de blocs différents**,
  6 présentations de la « lecture marché », 8 réglages de date ou de période, 35 hauteurs de graphique, 11 pages dont
  le titre ne reprend pas le menu.
- **Cinq structures suffisent**, définies par leur **mise en page** (§ 3). Une même structure sert plusieurs
  questions : sur une page de données, c'est le réglage de la barre (un jour ou une période, l'Europe ou un pays) qui
  change la question.
- **Principe** : chaque bloc affiché aujourd'hui garde une place. On déplace, on replie, on fusionne des onglets ; on
  ne supprime rien. Contrôle automatique : 887 blocs relevés, 887 replacés.

### Note d'harmonisation du site (1 à 5, à l'échelle du site)

| Sujet | Note | Mesure |
|---|---|---|
| Gabarit de base (barre, sections) | 4 | 71 / 90 vues conformes ; 2 vues sans barre (Électricité spot › Vue d'ensemble, Mes tableaux de bord) |
| Ordre des blocs dans la page | 2 | 64 enchaînements pour 90 vues ; les plus fréquents : `B S K G` (10), `B S G` (8) |
| Nommage menu / titre de page | 2 | 11 pages dont le fil d'Ariane ne reprend pas le menu (§ 4.1) |
| Rangement dans le menu | 2 | 4 pages rangées hors de leur section ou atteintes par 2 entrées (§ 4.2) |
| Bloc « lecture marché » | 1 | 6 présentations différentes (§ 4.3) |
| Réglages de date et de période | 1 | 8 variantes, et des réglages placés dans la page sur 24 vues au lieu de la barre (§ 4.4) |
| Bandeau de KPI | 3 | 4 à 7 cartes ; à 7 cartes, les libellés passent sur 2 lignes à 1 440 px |
| Taille des graphiques | 3 | cartes de 270 à 1 320 px, 35 hauteurs ; 60 % entre 360 et 410 px |
| Polices | 3 | 22 tailles relevées, dont 11,5 px (28 vues), 10,5 px (14), 12,5 px (11) hors des paliers du STYLEGUIDE |
| Titres de section | 2 | 16 sections nommées « Tableau … » même sans tableau (« Tableau genmix quotidien ») |
| Longueur des pages | 3 | 15 vues dépassent 4 écrans sur PC ; 9 dépassent 8 écrans sur mobile |
| **Moyenne** | **2,4** | contre 4,2 pour les pages prises une par une |

---

## 2. Où on en est

### Fait

| Quoi | État |
|---|---|
| Légendes des graphiques : le repère reprend la forme de la série (trait pour une courbe, pointillé si elle l'est ; case pour barres et aires ; rond pour des points) | appliqué dans `js/libs.js` et `STYLEGUIDE.md`, sur la branche de travail ; en ligne après fusion dans `main` |

### Validé, à appliquer

| Page | Structure | Ce qui change |
|---|---|---|
| Électricité spot › Vue d'ensemble | S1 Tableau de bord | barre collante ajoutée ; lecture en tête ; chiffres du jour, profil 7 zones, puis contexte (combustibles, forwards, carte de chaleur, anomalies) ; les 4 cartes du haut deviennent des liens en bas de page |
| Day-ahead › Quotidien | S2 Analyse | une seule phrase de lecture (au lieu de 3) ; **toutes les zones par défaut** : les 30 zones dans un seul tableau classé par prix, la France surlignée ; **clic sur un pays = son détail du jour**, comme aujourd'hui ; un pays filtré passe en premier ; zone et date dans la barre |

Défauts relevés au passage, à corriger avec ces pages : graphiques « Dernier jour » et « Veille » vides (« No prices
for FR. ») ; textes en anglais (« inverted », « ES cheapest », « 30-day mean », panneau de détail d'un pays : « Day
printed… », « Volatility », « Close »).

### À décider

| # | Sujet | Proposition |
|---|---|---|
| D1 | Pages consacrées à la France (Consommation, Échanges, Régions, Météo, Nucléaire, Système France, DJU, Capture, Déséquilibre) | même structure S2 ; règle « tout le détail d'abord, un élément si on filtre » (frontières, régions, villes, réacteurs) à valider |
| D2 | Titres de page = nom du menu | 11 pages à renommer (§ 4.1) |
| D3 | Rangement du menu | Analyse de marché → Marchés ; Rejouer → Système ; Indice BESS et M0 : une seule entrée chacun |
| D4 | Un seul réglage de date ou de période | `‹ date › Dernier` pour un jour, `1S 1M 3M 1A 5A Tout` pour une période, toujours dans la barre |
| D5 | Bandeaux de 7 KPI | 6 cartes plus une ligne de détail, ou 7 cartes plus étroites |
| D6 | 8 onglets maigres fusionnés en section d'un autre onglet (adresse gardée) | Forwards › Comparaison, Gaz › Gaz, Consommation › Prévision, Échanges › Frontières, DJU › Hebdomadaire, REMIT › Plateformes, Météo › Réservoirs, Batteries › Méthode |
| D7 | Gaz, carbone, pétrole › Vue d'ensemble | passer en S1, comme celle de l'électricité |
| D8 | Empreinte carbone : 6 onglets vides sans données | exemple chargé par défaut |
| D9 | Pricer PPA (entrées à gauche, résultat à droite) | lourd, tests propres (`test_ppa_frozen.py`) : à part, sur demande |

Ordre de travail : les pages S2 qui comparent des zones, une par une, sur le modèle de Day-ahead (Prix négatifs,
Spreads, Mix de production, Spark & dark, Intensité carbone, Gaz), en Quotidien et en Historique.

---

## 3. Les 5 structures

Une structure est une mise en page. Notation : `B` barre collante, `L` lecture, `K` chiffres, `G` graphique, `T`
tableau, `S` section ouverte, `s` section repliée.

### S1. Tableau de bord
- Pour : les pages d'entrée, l'essentiel du moment sur un écran.
- Schéma : `B [zones · ‹ date › · Dernier] › L › K (chiffres du moment) › G principal › G G › liens « Aller plus loin »`.
- Règles : pas de sections ; 2 écrans au plus sur PC ; chaque tuile ou lien mène à sa page.
- Pages (5 vues) : Aujourd'hui (Coup d'œil, Découverte, Expert), Mes tableaux de bord, Électricité spot › Vue
  d'ensemble.

### S2. Analyse
- Pour : toutes les pages de données. **Même mise en page sur un jour ou sur une période** : `‹ date ›` répond à
  « où en est-on ? », `1M 3M 1A 5A` à « comment ça a évolué ? ».
- Schéma : `B [Europe ou pays · ‹ date › ou période] › L › S (K 4 à 6 › G principal › T complet) › s compléments › source`.
- Règles :
  - **toutes les zones par défaut** sur une page qui compare des zones ; un pays filtré passe en premier, surligné
    dans le tableau ;
  - **clic sur une ligne du tableau = détail** de la zone (chiffres, profil, lecture) ;
  - un seul bandeau de lecture, une phrase ;
  - au-delà de 3 écrans, les compléments sont repliés.
- Pages (52 vues) : Day-ahead, Prix négatifs, Spreads, Déséquilibre, Électricité forwards, Gaz carbone pétrole,
  Spark & dark, Garanties d'origine, Batteries, Capture & cannibalisation, Capacité installée, Carte d'Europe, Mix de
  production, Nucléaire, Consommation, Échanges, Système France, Régions, Météo, DJU, Bilan électrique, Intensité
  carbone, Ce qui fait le prix, Analyse de marché.

### S3. Liste
- Pour : les pages dont le contenu est une liste.
- Schéma : `B [filtres · recherche] › S (K comptes › T liste filtrable, 50 lignes puis « Afficher plus ») › s détail › source`.
- Pages (10 vues) : Indisponibilités & REMIT, Échanges › Frontières, Déséquilibre › mFRR, Batteries › Sources de
  revenus, Pricer BOA › Structures de contrat, Actualités, Évolutions et événements, État des données.

### S4. Outil
- Pour : les pages où l'on saisit son cas.
- Schéma : `B [étapes] › entrées (320 px) | résultat (K + G) › s détail › s méthode`.
- Règles : résultat visible sans défiler ; ouvre sur un exemple chargé, jamais vide.
- Pages (19 vues) : Pricer PPA, Pricer BOA, Prévision de production, Empreinte carbone, Comparateur, Convertisseur,
  Rejouer une journée.

### S5. Référence
- Pour : les pages de texte.
- Schéma : `B › sommaire cliquable › S thème 1 (colonne de 760 px) › s thèmes suivants`.
- Pages (4 vues) : Méthodologie, API, À propos, Batteries › Méthode.

Correspondance avec la première version (9 structures par question) : A0 → S1 ; A1 à A5 → S2 ; A6 → S3 ; A7 → S4 ;
A8 → S5.

---

## 4. Constats transverses

### 4.1 Le titre de la page ne reprend pas le menu (11 pages)

| Menu | Fil d'Ariane affiché |
|---|---|
| Électricité forwards | Forward |
| Gaz, carbone, pétrole › Prix spot | Prix combustibles & EUA |
| Garanties d'origine › Prix Europe | Prix & enchères (onglet « EU ») |
| Spreads | Spread |
| Déséquilibre | Prix de déséquilibre |
| Électricité spot › Vue d'ensemble | « Prix de l'électricité » (titre H1, sans barre) |
| Carte d'Europe | Carte électrique |
| Consommation | Charge & demande |
| Échanges transfrontaliers | Flux transfrontaliers |
| Météo › Villes & prévisions | Météo énergie |
| DJU chauffage / climatisation | Degrés-jours |

Sur mobile, le fil d'Ariane est masqué : la page n'a plus de titre visible.

### 4.2 Pages rangées hors de leur section ou en double

- Analyse de marché : menu Outils, adresse `intel/`, contenu d'analyse de marché.
- Rejouer une journée : menu Outils, adresse `system/`.
- Indice BESS : 2 adresses ; l'onglet Batteries › Indice affiche le fil « Outils ».
- Contrat M0 : entrée de menu propre et onglet de Capture & cannibalisation (6 onglets, la barre passe sur 2 lignes).
- « Pourquoi le prix bouge » : 3 pages (Ce qui fait le prix, Analyse de marché, Forwards › Lecture analyste).

### 4.3 Six présentations de la « lecture marché »

1. Bandeau à liseré jaune « ◆ LECTURE DU MARCHÉ » (Spot › Vue d'ensemble).
2. Phrase de lecture dans la section « Analyse multi-zones » (Day-ahead, Mix).
3. Section « Lecture analyste » avec 4 cartes de texte (Forwards › Tableau).
4. Section « Lecture de la période » : phrase puis 4 cartes chiffrées (Ce qui fait le prix).
5. Encadré vert plein (Bilan électrique).
6. Cartes « moments clés » numérotées sur fond coloré (Analyse de marché).

### 4.4 Huit réglages de date ou de période

| Réglage | Pages |
|---|---|
| bouton « Dernières données » + liste « Dernières données » (doublon) | Day-ahead |
| champ `mm/dd/yyyy` + « DERNIER » | Mix de production (format américain sur le site français) |
| `‹ date ›` + « DERNIER » | Capture, Système France |
| pastilles `1M 3M 1Y 2Y 5Y Tout` | Prix négatifs (abréviations anglaises) |
| pastilles `1 sem. 1 mois 3 mois` | Ce qui fait le prix |
| pastilles `2D 4D 7D 14D 30D` | Analyse de marché (dans la page) |
| pastilles d'années | Bilan électrique (dans la page) |
| champs « Du » / « Au » | Comparateur |

Réglages placés dans la page plutôt que dans la barre : 24 vues hors outils (dont Forwards › Contrats calendaires 7,
TTF 6, Cannibalisation 6, Bilan 6, Carte d'Europe 3).

### 4.5 Tailles

- **Légendes** : chaque série avait une case, y compris les courbes. Corrigé (§ 2) : le repère reprend la forme de la série.

- **KPI** : bandeaux de 4 cartes (14 fois), 5 (14), 6 (18), 7 (4). À 7 cartes, le libellé passe sur 2 lignes à 1 440 px et la carte grandit.
- **Graphiques** : hauteur de carte de 270 à 1 320 px (35 valeurs). Hors norme : BESS › Capacité 670 px avant les KPI, Comparateur 790 px, Indisponibilités 1 100 px, Bilan 1 320 px.
- **Graphiques sans carte titrée** (canvas nu) : Spreads, Forwards › Comparaison, BOA, Carte d'Europe, Analyse de marché.
- **Polices** : 22 tailles, dont 11,5 / 10,5 / 12,5 / 13,5 px, hors des 7 paliers du STYLEGUIDE.

### 4.6 Longueur

| Vue | Écrans PC | Écrans mobile |
|---|---|---|
| Actualités | 12,2 | 25,1 |
| Aujourd'hui › Expert | 11,4 | 26,7 |
| Pricer PPA › Comparaison et prix | 8,2 | 11,4 |
| Évolutions et événements | 6,9 | 13,0 |
| Bilan électrique | 5,8 | 10,8 |
| API | 5,7 | 7,1 |
| Capture › Cannibalisation | 5,6 | 10,4 |
| Indisponibilités | 5,5 | 6,5 |
| Mix › Historique | 5,3 | 7,0 |
| Pricer PPA › Le parc | 5,3 | 10,1 |
| GO › Enchères France | 5,2 | 6,2 |

À l'inverse, 19 vues font moins d'un écran : les 6 onglets vides d'Empreinte carbone, À propos, et une dizaine d'onglets à un ou deux blocs (D6).

---

## 5. Inventaire page par page

### 5.1 Comment lire

- **Structure actuelle** : blocs dans l'ordre d'apparition (notes de source omises). `G×3` = 3 graphiques à la suite.
- **Cible** : structure du § 3 (S1 à S5).
- **Écrans** : longueur de la vue divisée par la hauteur de l'écran (900 px PC, 844 px mobile).
- **Notes de 1 à 5** :
  - *Clarté* : la réponse (KPI et graphique, ou lecture) est-elle dans le premier écran ?
  - *Lisibilité* : nombre de tailles de police, hauteur des graphiques dans la norme, nombre de graphiques et de tableaux, écart PC / mobile.
  - *Densité* : longueur (≤ 1,6 écran = 5 ; ≤ 2,6 = 4 ; ≤ 4 = 3 ; ≤ 6 = 2 ; au-delà = 1), moins 1 si plus de 10 graphiques ou page maigre.
  - *Trouvabilité* : nom identique au menu, bonne section, 5 onglets au plus.
  - *Structure* : barre collante, sections, réglages dans la barre, pas plus de 2 sections empilées.
  - Notes calculées à partir des mesures puis corrigées à la lecture des captures quand la mesure trompait (pages vides d'Empreinte carbone, listes d'Actualités).

### 5.2 Les vues les moins bien notées

| Note | Vue | Cause principale |
|---|---|---|
| 2,8 | Aujourd'hui › Expert | 30 graphiques sur une vue de tableau de bord |
| 3,0 | Capture › Cannibalisation | 12 graphiques, 6 réglages dans la page |
| 3,0 | Empreinte carbone, 6 onglets de résultat | vides sans données |
| 3,2 | Capture › M0 et appels d'offres | 2 entrées de menu, 4 tableaux |
| 3,2 | Électricité spot › Vue d'ensemble | sans barre, titre différent du menu, cartes qui répètent le menu |
| 3,4 | Mix de production › Historique | 3 sections empilées, 5,3 écrans |
| 3,4 | Pricer PPA › Comparaison et prix | 8 écrans, 6 tableaux |
| 3,6 | Bilan électrique | sans sections, réglages dans la page, 11 écrans sur mobile |
| 3,6 | Pricer PPA › Entrées et prix | 55 champs, 9 écrans sur mobile |

### 5.3 Détail, section par section

La vue 7b (Day-ahead › Historique) a été mesurée à part : elle partage l'adresse de l'onglet Quotidien.

#### Aujourd'hui

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Aujourd'hui › Coup d’œil | `B t×6 G×3 t K4 t` | S1 | 1,7 / 3,9 | 4·3·0 | 3 | 4 | 4 | 5 | 5 | **4,2** | Entrée claire ; 3 boutons ronds au-dessus du titre, propres à cette page |
| 2 | Aujourd'hui › Découverte | `B t×2 G t×2` | S1 | 1,6 / 3,0 | 0·1·0 | 3 | 4 | 5 | 5 | 5 | **4,4** | Lecture guidée, bonne page d'accueil |
| 3 | Aujourd'hui › Expert | `B t×6 G×3 T t×2 S G×3 T G T G S G×10 S t×5 G×5 T S t×5 G×2 s G s G×4` | S1 | 11,4 / 26,7 | 0·30·4 | 3 | 2 | 1 | 5 | 3 | **2,8** | 30 graphiques, 4 tableaux, 6 sections : 11 écrans, 27 sur mobile |
| 4 | Mes tableaux de bord › Mon tableau de bord | `G t×8` | S1 | 0,9 / 1,2 | 0·1·0 | 3 | 3 | 5 | 5 | 3 | **3,8** | Pas de barre collante ni de fil d'Ariane (page perso) |

#### Marchés

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | Ce qui fait le prix › Flux | `B S K4 t s` | S2 | 1,5 / 2,5 | 4·0·0 | 3 | 5 | 5 | 5 | 4 | **4,4** | Bon modèle de « lecture » : phrase + 4 cartes + flux |
| 6 | Ce qui fait le prix › Tableau | `B S K4 T s` | S2 | 1,5 / 2,2 | 4·0·1 | 4 | 5 | 5 | 5 | 4 | **4,6** | Même lecture, vue tableau |
| 7 | Day-ahead › Quotidien | `B S K7 T S K5 L G T S G×3` | S2 | 3,2 / 5,1 | 12·4·2 | 4 | 4 | 3 | 5 | 3 | **3,8** | 3 sections dont une avec sous-onglets ; « Dernières données » en double dans la barre |
| 7b | Day-ahead › Historique | `B S G S K7 T S K5 L G T` | S2 | 2,5 / 3,6 | 12·2·2 | 4 | 4 | 4 | 5 | 3 | **4,0** | 3 sections ; « Tendance spot » en tête ; en-tête « 3 months » en anglais ; non mesuré par l'audit du 1er nov. |
| 8 | Spot › Vue d'ensemble | `G t G T` | S1 | 2,1 / 4,2 | 0·2·1 | 3 | 4 | 4 | 3 | 2 | **3,2** | Sans barre collante ; titre « Prix de l'électricité » ≠ menu ; sous-titre anglais ; cartes qui répètent le menu |
| 9 | Prix négatifs | `B S K7 T S K5 G T S K5 G×4 T` | S2 | 4,7 / 8,3 | 17·5·3 | 4 | 5 | 2 | 5 | 4 | **4,0** | Bien construit mais 4,7 écrans (8 sur mobile) ; périodes « 1M 1Y 5Y » en anglais |
| 10 | Spreads | `B S K7 G S G K5` | S2 | 1,5 / 2,2 | 12·2·0 | 5 | 5 | 5 | 4 | 4 | **4,6** | Fil d'Ariane « Spread » ≠ menu « Spreads » ; graphiques sans carte titrée |
| 11 | Déséquilibre › Quotidien | `B S G×3` | S2 | 1,3 / 2,1 | 0·3·0 | 3 | 5 | 5 | 4 | 5 | **4,4** | Fil « Prix de déséquilibre » ≠ menu « Déséquilibre » ; pas de KPI |
| 12 | Déséquilibre › mFRR | `B S G S T` | S3 | 1,0 / 1,5 | 0·1·1 | 3 | 5 | 5 | 4 | 5 | **4,4** | Tableau d'écarts : page registre |
| 13 | Électricité forwards › Tableau | `B S L×11 S K4 T T` | S2 | 2,0 / 3,3 | 4·0·2 | 3 | 5 | 4 | 4 | 4 | **4,0** | 1er écran = 4 blocs de texte ; le tableau forward n'arrive qu'au 2e écran |
| 14 | Électricité forwards › Comparaison | `B S G T` | S2 | 1,0 / 1,3 | 0·1·1 | 3 | 5 | 4 | 4 | 5 | **4,2** | 1 graphique + 1 tableau : onglet maigre (B-05) |
| 15 | Électricité forwards › Contrats calendaires | `B S K4 G T G` | S2 | 1,4 / 2,5 | 4·2·1 | 5 | 5 | 5 | 4 | 4 | **4,6** | Modèle courbe correct ; 7 champs dans la page, hors barre |
| 16 | Gaz, carbone, pétrole › Prix spot › Vue d'ensemble | `B S K6 G×2` | S2 | 1,4 / 2,0 | 6·2·0 | 5 | 5 | 5 | 4 | 5 | **4,8** | Bon : KPI puis 2 graphiques ; fil « Prix combustibles & EUA » ≠ menu « Prix spot » |
| 17 | Gaz, carbone, pétrole › Prix spot › Gaz | `B S G×2` | S2 | 1,2 / 1,6 | 0·2·0 | 3 | 5 | 4 | 4 | 5 | **4,2** | 2 graphiques sans KPI : onglet maigre |
| 18 | Gaz, carbone, pétrole › Prix spot › Charbon & pétrole | `B S K5 G×3` | S2 | 1,4 / 2,7 | 5·3·0 | 5 | 5 | 5 | 4 | 5 | **4,8** | Bon modèle Photo du jour |
| 19 | Gaz… › Courbes forward › Courbes | `B S K6 G×2` | S2 | 0,8 / 1,7 | 6·2·0 | 5 | 5 | 4 | 5 | 5 | **4,8** | Bon : KPI + 2 courbes en moins d'un écran |
| 20 | Gaz… › Courbes forward › TTF : contrats et cotations | `B S G T S T T` | S2 | 2,7 / 3,2 | 0·1·3 | 3 | 5 | 3 | 5 | 4 | **4,0** | 6 champs dans la page ; 3 tableaux |
| 21 | Spark & dark spreads › Quotidien | `B S K6 G T` | S2 | 2,2 / 2,6 | 6·1·1 | 5 | 5 | 4 | 5 | 5 | **4,8** | Bon modèle ; libellé « Delivery » en anglais dans la barre |
| 22 | Spark & dark spreads › Historique | `B S G×2` | S2 | 1,3 / 1,8 | 0·2·0 | 3 | 5 | 4 | 5 | 4 | **4,2** | 3 champs hors barre |
| 23 | Garanties d'origine › EU | `B S K4 G×3 T G×4` | S2 | 3,5 / 5,1 | 4·7·1 | 5 | 4 | 3 | 4 | 4 | **4,0** | 7 graphiques ; fil « Prix & enchères » ≠ menu « Garanties d'origine › Prix Europe » |
| 24 | Garanties d'origine › Enchères France | `B S K5 G T G×2 T` | S2 | 5,2 / 6,2 | 5·3·2 | 5 | 5 | 2 | 4 | 5 | **4,2** | 5,2 écrans, 7 400 caractères |
| 25 | Batteries (BESS) › Europe | `B S K4 G×2 T` | S2 | 2,1 / 2,7 | 4·2·1 | 5 | 5 | 4 | 4 | 5 | **4,6** | Bon modèle Comparaison |
| 26 | Batteries (BESS) › Valeur day-ahead | `B S K6 G×4 S T` | S2 | 2,7 / 3,8 | 6·4·1 | 5 | 5 | 3 | 4 | 5 | **4,4** | Correct |
| 27 | Batteries (BESS) › Réserves | `B S K5 G` | S2 | 1,0 / 1,6 | 5·1·0 | 5 | 5 | 5 | 4 | 5 | **4,8** | Correct, court |
| 28 | Batteries (BESS) › Sources de revenus | `B S T` | S3 | 0,9 / 1,1 | 0·0·1 | 3 | 5 | 5 | 4 | 5 | **4,4** | Tableau seul |
| 29 | Batteries (BESS) › Mécanisme de capacité | `B S G K4 T` | S2 | 1,5 / 2,1 | 4·1·1 | 5 | 4 | 5 | 4 | 4 | **4,4** | Graphique de 670 px avant les KPI (ordre inversé) |
| 30 | Batteries (BESS) › Méthode | `B S` | S5 | 1,2 / 2,0 | 0·0·0 | 3 | 5 | 5 | 4 | 5 | **4,4** | Texte seul dans un onglet de données |
| 31 | Batteries (BESS) › Indice | `B S K7 G×2` | S2 | 1,7 / 2,7 | 7·2·0 | 5 | 5 | 4 | 3 | 5 | **4,4** | Même vue sous 2 adresses (Batteries › Indice et Outils › Indice BESS) ; fil « Outils » ici |

#### Renouvelables

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 32 | Capture & cannibalisation › Quotidien | `B S K6 G×2` | S2 | 1,4 / 2,0 | 6·2·0 | 5 | 5 | 5 | 3 | 5 | **4,6** | 6 onglets, la barre passe sur 2 lignes ; titre graphique anglais « Intraday output vs price » |
| 33 | Capture & cannibalisation › Historique | `B S G×2 T` | S2 | 1,6 / 2,2 | 0·2·1 | 3 | 5 | 4 | 4 | 5 | **4,2** | Pas de KPI |
| 34 | Capture & cannibalisation › M0 et appels d’offres | `B S G T T T G×2 T` | S2 | 4,1 / 6,4 | 0·3·4 | 3 | 5 | 2 | 2 | 4 | **3,2** | Atteint par 2 entrées de menu ; 4 tableaux, 6 écrans sur mobile |
| 35 | Capture & cannibalisation › Cannibalisation | `B S G T G×11` | S2 | 5,6 / 10,4 | 0·12·1 | 3 | 3 | 1 | 4 | 4 | **3,0** | 12 graphiques, 5,6 écrans (10 sur mobile), 6 champs hors barre |
| 36 | Capture & cannibalisation › Capture forward | `B S G T` | S2 | 1,3 / 1,6 | 0·1·1 | 3 | 5 | 5 | 4 | 5 | **4,4** | Correct |
| 37 | Capture & cannibalisation › Europe | `B S G×2 T` | S2 | 1,2 / 2,1 | 0·2·1 | 3 | 5 | 5 | 4 | 4 | **4,2** | Pas de KPI ; champ hors barre |
| 38 | Capacité installée › Par année | `B S K6 G T S K4 G` | S2 | 1,7 / 3,1 | 10·2·1 | 5 | 5 | 4 | 5 | 5 | **4,8** | Bon modèle |
| 39 | Capacité installée › Comparaison | `B S K4 G S G` | S2 | 1,6 / 2,4 | 4·2·0 | 5 | 5 | 5 | 5 | 5 | **5,0** | Meilleure note du site |

#### Système électrique

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 40 | Carte d'Europe | `B S K4 M G×3` | S2 | 2,4 / 4,0 | 4·3·0 | 5 | 4 | 4 | 4 | 4 | **4,2** | Carte + 3 graphiques, filtres dans la page |
| 41 | Mix de production › Quotidien | `B S K6 T S K5 L T` | S2 | 1,8 / 2,7 | 11·0·2 | 4 | 3 | 4 | 5 | 5 | **4,2** | Section « Tableau genmix » (jargon) ; date « mm/dd/yyyy » sur site français |
| 42 | Mix de production › Historique | `B S G×3 S K6 T S K5 L T` | S2 | 5,3 / 7,0 | 11·3·2 | 3 | 4 | 2 | 5 | 3 | **3,4** | 3 sections, 5,3 écrans |
| 43 | Nucléaire | `B S K6 G×4 S` | S2 | 2,5 / 3,7 | 6·4·0 | 5 | 5 | 4 | 5 | 5 | **4,8** | Bon : KPI + 4 graphiques |
| 44 | Indisponibilités & REMIT › Indisponibilités | `B S K6 G S K5 G×2 T` | S3 | 5,5 / 6,5 | 11·3·1 | 5 | 4 | 2 | 5 | 5 | **4,2** | Diagramme de 1 100 px ; 17 000 caractères |
| 45 | Indisponibilités & REMIT › Plateformes | `B S T` | S3 | 0,6 / 0,7 | 0·0·1 | 3 | 5 | 5 | 5 | 5 | **4,6** | Tableau seul, 0,6 écran |
| 46 | Consommation › Quotidien | `B S K5 G T` | S2 | 2,0 / 2,3 | 5·1·1 | 5 | 5 | 4 | 4 | 5 | **4,6** | Fil « Charge & demande » ≠ menu « Consommation » |
| 47 | Consommation › Prévision | `B S G` | S2 | 0,8 / 1,0 | 0·1·0 | 3 | 5 | 4 | 4 | 5 | **4,2** | 1 graphique : onglet maigre |
| 48 | Consommation › Historique | `B S G×2` | S2 | 0,7 / 1,5 | 0·2·0 | 3 | 5 | 4 | 4 | 5 | **4,2** | 2 graphiques, 0,7 écran : onglet maigre |
| 49 | Échanges transfrontaliers › Quotidien | `B S K6 t G×2` | S2 | 1,6 / 2,7 | 6·2·0 | 5 | 5 | 4 | 4 | 5 | **4,6** | Fil « Flux transfrontaliers » ≠ menu « Échanges transfrontaliers » |
| 50 | Échanges transfrontaliers › Frontières | `B S T` | S3 | 0,7 / 0,8 | 0·0·1 | 3 | 5 | 5 | 4 | 5 | **4,4** | Tableau seul : onglet maigre |
| 51 | Système France › Quotidien | `B S K6 G×5` | S2 | 2,7 / 3,8 | 6·5·0 | 5 | 5 | 3 | 5 | 4 | **4,4** | 5 graphiques après les KPI |
| 52 | Système France › Historique | `B S G T` | S2 | 1,4 / 1,8 | 0·1·1 | 3 | 5 | 5 | 5 | 5 | **4,6** | Correct |
| 53 | Régions › Quotidien | `B S K5 G×2 T` | S2 | 1,8 / 2,5 | 5·2·1 | 5 | 5 | 4 | 4 | 4 | **4,4** | Correct |
| 54 | Régions › Capacités et consommation | `B S G×2` | S2 | 1,2 / 1,8 | 0·2·0 | 3 | 5 | 5 | 4 | 5 | **4,4** | Pas de KPI |
| 55 | Météo › Villes › Quotidien | `B S K6 G S T` | S2 | 1,5 / 2,1 | 6·1·1 | 5 | 5 | 5 | 4 | 5 | **4,8** | Fil « Météo énergie » ≠ menu « Villes & prévisions » |
| 56 | Météo › Villes › Prévision 5 semaines | `B S G×4` | S2 | 1,2 / 2,7 | 0·4·0 | 3 | 5 | 5 | 4 | 5 | **4,4** | 4 graphiques sans KPI |
| 57 | Météo › Villes › Réservoirs hydrauliques | `B S K4 G×2` | S2 | 0,9 / 1,9 | 4·2·0 | 5 | 5 | 5 | 4 | 4 | **4,6** | Hors sujet météo : à mettre sous Production (B-06) |
| 58 | DJU › Quotidien | `B S K6 G×2` | S2 | 1,3 / 2,0 | 6·2·0 | 5 | 5 | 5 | 4 | 5 | **4,8** | Fil « Degrés-jours » ≠ menu « DJU chauffage / climatisation » |
| 59 | DJU › Hebdomadaire | `B S G T` | S2 | 1,3 / 1,6 | 0·1·1 | 3 | 5 | 5 | 4 | 5 | **4,4** | Onglet maigre (B-06) |
| 60 | Bilan électrique | `B K6 G×8 T G t` | S2 | 5,8 / 10,8 | 6·9·1 | 5 | 3 | 2 | 5 | 3 | **3,6** | Pas de section ; filtre années dans la page ; 9 graphiques, 11 écrans sur mobile |
| 61 | Intensité carbone | `B S T` | S2 | 0,6 / 0,8 | 0·0·1 | 3 | 5 | 4 | 5 | 4 | **4,2** | Un tableau seul (622 caractères) |

#### Outils

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 62 | Pricer PPA › Entrées et prix | `B S S t×6 G×4 S T S T G` | S4 | 4,7 / 9,2 | 0·5·2 | 3 | 3 | 2 | 5 | 5 | **3,6** | 55 champs, 4 sections ; 9 écrans sur mobile |
| 63 | Pricer PPA › Le parc | `B S T S K6 G t G×9 S T G` | S4 | 5,3 / 10,1 | 6·11·2 | 4 | 4 | 1 | 5 | 5 | **3,8** | 11 graphiques, 10 écrans sur mobile |
| 64 | Pricer PPA › Méthodes | `B S T S K5 G T t S T G s G T` | S4 | 4,2 / 6,7 | 5·3·4 | 4 | 3 | 2 | 5 | 5 | **3,8** | 2 niveaux d'onglets ; 4 tableaux |
| 65 | Pricer PPA › Comparaison et prix | `B S T S G K6 T G×3 T G T T S T G S G×2` | S4 | 8,2 / 11,4 | 6·8·6 | 4 | 2 | 1 | 5 | 5 | **3,4** | Page la plus longue des outils : 8 écrans, 6 tableaux, 8 graphiques |
| 66 | Pricer BOA › Entrées et résultat | `B S G×2` | S4 | 1,3 / 3,3 | 0·2·0 | 4 | 4 | 5 | 5 | 5 | **4,6** | Correct ; graphiques sans carte titrée |
| 67 | Pricer BOA › La batterie | `B S K5 G` | S4 | 1,4 / 2,7 | 5·1·0 | 4 | 5 | 5 | 5 | 5 | **4,8** | Correct |
| 68 | Pricer BOA › Structures de contrat | `B S T` | S3 | 1,2 / 1,6 | 0·0·1 | 3 | 5 | 5 | 5 | 5 | **4,6** | Tableau seul |
| 69 | Prévision de production › Site et prévision | `B S t K4 S G×2 T` | S4 | 2,7 / 4,1 | 4·2·1 | 4 | 5 | 3 | 5 | 5 | **4,4** | Bon modèle Outil : site puis prévision |
| 70 | Prévision de production › Valoriser ce parc | `B S K4` | S4 | 0,5 / 0,8 | 4·0·0 | 4 | 5 | 5 | 5 | 5 | **4,8** | 4 KPI seuls |
| 71 | Prévision de production › Quelle fiabilité | `B S T G×2 T G×2` | S4 | 2,2 / 4,0 | 0·4·2 | 4 | 4 | 4 | 5 | 5 | **4,4** | Correct |
| 72 | Empreinte carbone › Vos données | `B S` | S4 | 0,7 / 1,0 | 0·0·0 | 3 | 4 | 5 | 4 | 5 | **4,2** | Écran d'entrée correct |
| 73 | Empreinte carbone › Vue d'ensemble | `B` | S4 | 0,3 / 0,3 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données (197 caractères), B-02 |
| 74 | Empreinte carbone › Consommation | `B` | S4 | 0,3 / 0,4 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données, B-02 |
| 75 | Empreinte carbone › Carbone | `B` | S4 | 0,3 / 0,4 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données, B-02 |
| 76 | Empreinte carbone › Coût & flexibilité | `B` | S4 | 0,3 / 0,4 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données, B-02 |
| 77 | Empreinte carbone › Solaire & couverture | `B` | S4 | 0,3 / 0,4 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données, B-02 |
| 78 | Empreinte carbone › Reporting | `B` | S4 | 0,3 / 0,4 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données, B-02 |
| 79 | Analyse de marché | `B K6 G×7 t` | S2 | 2,9 / 6,0 | 6·7·0 | 5 | 4 | 3 | 3 | 3 | **3,6** | Rangé sous Outils alors que c'est de l'analyse ; filtres hors barre ; pas de sections ; recoupe « Ce qui fait le prix » |
| 80 | Rejouer une journée | `B G` | S4 | 1,0 / 0,7 | 0·1·0 | 4 | 5 | 5 | 4 | 4 | **4,4** | Rangé sous Outils, adresse system/ ; 8 champs |
| 81 | Comparateur | `B t G t×6 G` | S4 | 2,2 / 5,1 | 0·2·0 | 4 | 3 | 4 | 5 | 4 | **4,0** | 80 champs ; graphique de 790 px |
| 82 | Convertisseur | `B T` | S4 | 1,8 / 2,0 | 0·0·1 | 3 | 5 | 4 | 5 | 4 | **4,2** | Correct |

#### Veille

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 83 | Actualités | `B S S T` | S3 | 12,2 / 25,1 | 0·0·1 | 3 | 5 | 2 | 5 | 4 | **3,8** | 12 écrans de liste (25 sur mobile) ; « 8 searches » en anglais |
| 84 | Évolutions et événements | `B` | S3 | 6,9 / 13,0 | 0·0·0 | 3 | 5 | 2 | 5 | 4 | **3,8** | 7 écrans de texte (13 sur mobile) |

#### Général

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 85 | État des données › Sources | `B S T S T` | S3 | 2,1 / 2,9 | 0·0·2 | 3 | 5 | 4 | 5 | 5 | **4,4** | Correct |
| 86 | État des données › Problèmes de flux | `B S T S T` | S3 | 2,4 / 3,4 | 0·0·2 | 3 | 5 | 4 | 5 | 5 | **4,4** | Correct |
| 87 | API | `B S t×2 S S T` | S5 | 5,7 / 7,1 | 0·0·1 | 4 | 5 | 2 | 5 | 4 | **4,0** | 5,7 écrans, 13 600 caractères |
| 88 | Méthodologie | `B T` | S5 | 1,4 / 2,2 | 0·0·1 | 3 | 4 | 2 | 5 | 4 | **3,6** | 38 000 caractères sur une page |
| 89 | À propos | `B` | S5 | 0,2 / 0,1 | 0·0·0 | 3 | 5 | 5 | 5 | 4 | **4,4** | Correct |

---

## 6. Limites

- Les blocs sont repérés par leurs classes CSS (`.kpi-card`, `.chart-container`, `.hist-section`…). Un bloc construit
  autrement peut manquer : les signatures donnent l'ordre et le poids des blocs, pas un relevé au pixel près.
- Les longueurs de Méthodologie et d'À propos sont sous-estimées (texte libre, hors blocs) ; leur nombre de caractères
  est donné dans les constats.
- Les données du jour changent la longueur de certaines vues (nombre de zones, d'articles, d'arrêts nucléaires).
- Mesures sur le thème sombre, en français. Tablette (1 024 à 1 280 px) non remesurée : l'audit du 1er novembre
  ne relevait aucun débordement après correctifs.
- Les notes de 1 à 5 sont un outil de tri, pas une vérité : elles servent à classer les chantiers, pas à comparer
  deux pages à 0,2 point près.

---

## 7. Idées en réserve

Idées discutées puis mises de côté. Elles ne sont pas abandonnées : on les reprend quand leur condition est remplie.

### Dossiers de veille (26–27 nov. 2026)

- **L'idée** : une entrée « Dossiers » dans la Veille. Un dossier suit un sujet dans le temps (exemples : Après
  l'ARENH, Flexibilité et mécanisme de capacité, Soutien aux ENR : CfD et appels d'offres, Prix négatifs ; plus tard
  PPE, Carbone EU ETS et CBAM). Une page par dossier :
  - « L'essentiel », 5 à 10 lignes écrites à la main ;
  - une chronologie qui mêle articles, textes officiels, consultations et événements ;
  - les prochaines dates (`data/events.json`) ;
  - les chiffres du site liés au sujet ;
  - des études pour approfondir.
- **Ce qui serait automatique** : chronologie, compteur de nouveautés, dates à venir, consultations, chiffres. Chaque
  dossier serait défini par quelques lignes de configuration (mots-clés FR/EN, mots exclus, thèmes d'`events.json`,
  pages liées) ; la tâche des actualités poserait l'étiquette à la collecte, pour que les archives la gardent (les
  étiquettes actuelles, « power » ou « renewables », sont trop larges).
- **Variante** : « Mes sujets », des sujets suivis définis par chaque membre connecté (stockés dans le compte).
  Écartée tant qu'il y a très peu de comptes.
- **Ce qui reste manuel** : « L'essentiel » (sa date affichée montre quand il vieillit), la vérification des dates
  d'événements, le retrait des faux positifs. Option : un brouillon automatique « ce qui a changé », affiché comme tel.
- **Pourquoi en réserve** : la valeur est réelle (relier un texte à son effet chiffré, montrer un jugement de marché,
  nourrir PowerBrunch), mais elle dépend d'un « L'essentiel » tenu à jour chaque mois. Sans ce temps d'écriture, un
  dossier n'est qu'un filtre du fil. La Veille n'avait qu'un visiteur extérieur sur un mois (23 oct.–25 nov.).
- **Pour reprendre** : commencer par 2 dossiers, les relayer dans PowerBrunch, faire le bilan au bout de 2 mois
  (visites, temps passé) et les retirer s'ils ne servent pas. Changement de collecte : à proposer en PR séparée.
