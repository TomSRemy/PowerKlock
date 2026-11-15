# État des lieux des structures de pages (15 novembre 2026)

Objectif : décider comment harmoniser PowerKlock pour qu'il se lise de la même façon partout. Ce document ne change
rien au site. Il complète `AUDIT_POWERKLOCK.md` (1er novembre : langue, contraste, finitions) et `STYLEGUIDE.md`
(normes des tuiles, graphiques et polices). Il porte sur un autre niveau : **ce que contient chaque page et dans
quel ordre**.

Base : commit `607fab2`, site en français, 90 vues (44 adresses × onglets), mesurées automatiquement par Playwright à
1 440 × 900 px (PC) et 390 × 844 px (mobile) ; captures d'écran relues pour les pages types.

---

## 1. En bref

- **Prises une par une, les pages sont correctes** : note moyenne 4,2 / 5. Aucune ne déborde à 390 px, 71 vues sur
  90 suivent déjà « barre collante puis sections ».
- **Le côté brouillon vient des écarts entre les pages**, pas d'une page en particulier : 90 vues donnent
  **64 enchaînements de blocs différents**. Une même fonction se présente de plusieurs façons : 6 présentations
  de la « lecture marché », 8 réglages de date ou de période, 35 hauteurs de graphique, et 11 pages dont le titre ne
  reprend pas le nom du menu.
- **Neuf structures suffisent** pour tout le site (§ 3). Toutes les vues ont été rattachées à l'une d'elles (§ 5).
- **Les 10 décisions à prendre** sont au § 2, avec une recommandation pour chacune.

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

## 2. Décisions à prendre

| # | Décision | Options | Recommandation | Impact lecture | Effort |
|---|---|---|---|---|---|
| D1 | Figer 9 structures de page (§ 3) et y ramener chaque vue | (a) 9 structures ; (b) garder les 3 gabarits du STYLEGUIDE seulement | **(a)** : les 3 gabarits fixent le cadre, pas l'ordre des blocs, d'où les 64 variantes | fort | M (par lots de pages) |
| D2 | Un seul bloc « lecture marché » | (a) une phrase verdict + 3 ou 4 chiffres, même style partout ; (b) laisser chaque page libre | **(a)** : bandeau `.pk-read` sous la barre, 1 phrase de 30 mots au plus, chiffres colorés hausse rouge / baisse vert | fort | S |
| D3 | Un seul réglage de date et de période | (a) `‹ date › Dernier` pour un jour, pastilles `1S 1M 3M 1A 5A Tout` pour une période, toujours dans la barre ; (b) statu quo | **(a)**, libellés traduits (« 1A » et non « 1Y ») | fort | M |
| D4 | Le titre de page reprend le nom du menu | (a) menu = fil d'Ariane, mot pour mot ; (b) fil plus descriptif | **(a)** : 11 pages à renommer (§ 4.1), en choisissant le meilleur des deux noms | moyen | S |
| D5 | Ranger chaque page à un seul endroit | Analyse de marché et Rejouer : Outils ou Marchés ; Indice BESS et M0 : une seule entrée | **Analyse de marché → Marchés, à côté de Ce qui fait le prix** ; Rejouer → Système ; Indice BESS : onglet de Batteries seulement ; M0 : entrée de menu seulement, retirée des onglets de Capture | moyen | S |
| D6 | Un sujet = une page : fusionner les recoupements | « pourquoi le prix bouge » est traité à 3 endroits (Ce qui fait le prix, Analyse de marché, Forwards › Lecture analyste) | Garder Ce qui fait le prix comme page de référence ; Forwards ouvre sur le tableau, la lecture analyste passe en section repliée sous le tableau | moyen | M |
| D7 | Plafond de longueur par vue | (a) 3 écrans PC, 6 mobile, le détail en sections repliées ; (b) pas de plafond | **(a)** : 15 vues à traiter, d'abord Aujourd'hui › Expert (11 écrans), Cannibalisation (5,6), Pricer PPA (4 à 8), Bilan (5,8) | fort | M |
| D8 | Onglets maigres (une seule table ou un seul graphique) | fusionner ou enrichir | Fusionner : Forwards › Comparaison, Gaz › Gaz, Consommation › Prévision et Historique, Échanges › Frontières, DJU › Hebdomadaire, Plateformes REMIT ; déplacer Réservoirs vers Production | moyen | S |
| D9 | Empreinte carbone : 6 onglets vides sans données | (a) masquer jusqu'au chargement ; (b) exemple chargé par défaut | **(b)** : l'exemple montre ce que l'outil fait (rejoint B-02 de l'audit) | moyen | S |
| D10 | Tailles fixes | KPI 4 à 6 cartes (jamais 7) ; graphique 280 px en paire, 320 px seul, 360 px profil horaire ; polices limitées aux 7 paliers | **oui** : ce sont déjà les normes du STYLEGUIDE, elles ne sont pas appliquées | moyen | S |

Ordre conseillé : D4 et D5 (renommer, ranger : rapide, très visible), puis D2 et D3 (les deux blocs qui donnent
l'impression de désordre), puis D1 page par page en commençant par les vues les moins bien notées (§ 5.2).

---

## 3. Les 9 structures cibles

Notation des schémas : `B` barre collante (fil d'Ariane, onglets, réglages), `S` section repliable, `L` lecture
(verdict), `K6` bandeau de 6 KPI, `G` graphique, `T` tableau, `t` tuile, `M` carte, `n` note de source.

### A0. Tableau de bord : « que se passe-t-il aujourd'hui ? »
- Pages : Aujourd'hui (3 onglets), Mes tableaux de bord, Électricité spot › Vue d'ensemble.
- Schéma : `B › titre du jour + 1 phrase › tuiles KPI avec mini-courbe (6 au plus) › 3 graphiques de même hauteur › liens « Voir le détail »`.
- Règles : pas de sections ; 2 écrans PC au plus ; chaque tuile renvoie vers sa page d'analyse.
- État : 3,7 / 5. Expert est une page d'analyse de 30 graphiques déguisée en tableau de bord ; Vue d'ensemble n'a pas de barre et répète le menu sous forme de cartes.

### A1. Photo du jour : « où en est-on aujourd'hui, ici et chez les voisins ? »
- Pages : les onglets « Quotidien » (Day-ahead, Mix, Capture, Consommation, Échanges, Système France, Régions, Météo, DJU, Déséquilibre, Spark), Prix négatifs, Spreads, Gaz › Vue d'ensemble, Nucléaire, Intensité carbone.
- Schéma : `B [zone · ‹ date › Dernier] › S1 « Aujourd'hui » : K6 + G profil horaire 320 px › S2 « Entre zones » : L + T des zones › n`.
- Règles : France en première carte ; le graphique avant le tableau ; 2,5 écrans au plus.
- État : 4,5 / 5. Meilleure famille ; les écarts tiennent aux titres (« Tableau genmix ») et aux réglages de date.

### A2. Historique : « comment ça a évolué ? »
- Pages : les onglets « Historique », Cannibalisation, BESS › Valeur day-ahead, Réserves, Indice, Capacité › Par année, GO, Météo › Prévision 5 semaines.
- Schéma : `B [zone · période 1S 1M 3M 1A 5A Tout] › S1 : K4 de la période + G pleine largeur 320 px › S2 : paire de G 280 px › S3 repliée : T mensuel ou annuel › n`.
- Règles : un seul graphique principal ; le tableau en dernier et replié ; 3 écrans au plus.
- État : 4,2 / 5. Pas de KPI sur la moitié des vues ; Cannibalisation (12 graphiques) et Mix › Historique (3 sections) trop longs.

### A3. Courbe forward : « que vaut la livraison future ? »
- Pages : Électricité forwards (3 onglets), Courbes forward gaz, carbone, pétrole (2), Capture forward, M0 et appels d'offres.
- Schéma : `B [produit · date de cotation] › K4 produits phares (M+1, Q+1, Cal+1, Cal+2) › G courbe + T contrats côte à côte › G historique de cotation › S repliée : lecture analyste`.
- État : 4,2 / 5. Forwards › Tableau ouvre sur 4 blocs de texte ; le tableau n'arrive qu'au 2e écran.

### A4. Comparaison entre pays : « où la France se situe-t-elle ? »
- Pages : Batteries › Europe et Mécanisme de capacité, Capture › Europe, Capacité › Comparaison, Régions › Capacités, Carte d'Europe.
- Schéma : `B [indicateur · année] › K4 (France, rang, écart à la moyenne, meilleur) › G classement en barres ou M pleine largeur › T pays`.
- État : 4,5 / 5. Capacité › Comparaison est la vue la mieux notée du site (5,0).

### A5. Lecture : « pourquoi ça bouge ? »
- Pages : Ce qui fait le prix (2), Analyse de marché, Bilan électrique.
- Schéma : `B [zone · période] › L (1 phrase) › K4 chiffres de l'explication › G explicatif pleine largeur › S repliée : méthode`.
- État : 4,0 / 5. Ce qui fait le prix est le modèle à suivre ; Analyse de marché et Bilan placent leurs réglages dans la page et n'ont pas de sections.

### A6. Registre : « quelle est la liste ? »
- Pages : Indisponibilités et Plateformes, Échanges › Frontières, Déséquilibre › mFRR, BESS › Sources de revenus, BOA › Structures de contrat, Actualités, Évolutions et événements, État des données.
- Schéma : `B [filtres · recherche] › K3 comptes (nombre, nouveaux, critiques) › T ou liste filtrable, 50 lignes puis « Afficher plus » › n`.
- État : 4,3 / 5. Actualités (12 écrans, 25 sur mobile) et Évolutions (7 écrans) n'ont ni compte ni pagination.

### A7. Outil : « que vaut mon cas ? »
- Pages : Pricer PPA, Pricer BOA, Prévision de production, Empreinte carbone, Comparateur, Convertisseur, Rejouer une journée.
- Schéma : `B [étapes en onglets] › S Entrées (repliable, colonne de 320 px à gauche sur PC) › Résultat : K4 + G › S repliées : détail, méthode`.
- Règles : le résultat visible sans défiler après saisie ; onglets de résultat cachés tant qu'il n'y a pas de donnée.
- État : 3,8 / 5. Pricer PPA de 4 à 8 écrans (9 à 11 sur mobile), 55 champs ; Empreinte carbone : 6 onglets vides.

### A8. Référence : « comment c'est calculé ? »
- Pages : Méthodologie, API, À propos, Batteries › Méthode.
- Schéma : `B › sommaire ancré › colonne de texte de 760 px › sections repliables par thème`.
- État : 4,1 / 5. Méthodologie tient 38 000 caractères sur une page sans sommaire cliquable en tête ; Batteries › Méthode devrait être une section repliée, pas un onglet.

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

À l'inverse, 19 vues font moins d'un écran : les 6 onglets vides d'Empreinte carbone, À propos, et une dizaine d'onglets à un ou deux blocs (D8).

---

## 5. Inventaire page par page

### 5.1 Comment lire

- **Structure actuelle** : blocs dans l'ordre d'apparition (notes de source omises). `G×3` = 3 graphiques à la suite.
- **Cible** : structure du § 3.
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
| 1 | Aujourd'hui › Coup d’œil | `B t×6 G×3 t K4 t` | A0 | 1,7 / 3,9 | 4·3·0 | 3 | 4 | 4 | 5 | 5 | **4,2** | Entrée claire ; 3 boutons ronds au-dessus du titre, propres à cette page |
| 2 | Aujourd'hui › Découverte | `B t×2 G t×2` | A0 | 1,6 / 3,0 | 0·1·0 | 3 | 4 | 5 | 5 | 5 | **4,4** | Lecture guidée, bonne page d'accueil |
| 3 | Aujourd'hui › Expert | `B t×6 G×3 T t×2 S G×3 T G T G S G×10 S t×5 G×5 T S t×5 G×2 s G s G×4` | A0 | 11,4 / 26,7 | 0·30·4 | 3 | 2 | 1 | 5 | 3 | **2,8** | 30 graphiques, 4 tableaux, 6 sections : 11 écrans, 27 sur mobile |
| 4 | Mes tableaux de bord › Mon tableau de bord | `G t×8` | A0 | 0,9 / 1,2 | 0·1·0 | 3 | 3 | 5 | 5 | 3 | **3,8** | Pas de barre collante ni de fil d'Ariane (page perso) |

#### Marchés

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | Ce qui fait le prix › Flux | `B S K4 t s` | A5 | 1,5 / 2,5 | 4·0·0 | 3 | 5 | 5 | 5 | 4 | **4,4** | Bon modèle de « lecture » : phrase + 4 cartes + flux |
| 6 | Ce qui fait le prix › Tableau | `B S K4 T s` | A5 | 1,5 / 2,2 | 4·0·1 | 4 | 5 | 5 | 5 | 4 | **4,6** | Même lecture, vue tableau |
| 7 | Day-ahead › Quotidien | `B S K7 T S K5 L G T S G×3` | A1 | 3,2 / 5,1 | 12·4·2 | 4 | 4 | 3 | 5 | 3 | **3,8** | 3 sections dont une avec sous-onglets ; « Dernières données » en double dans la barre |
| 7b | Day-ahead › Historique | `B S G S K7 T S K5 L G T` | A2 | 2,5 / 3,6 | 12·2·2 | 4 | 4 | 4 | 5 | 3 | **4,0** | 3 sections ; « Tendance spot » en tête ; en-tête « 3 months » en anglais ; non mesuré par l'audit du 1er nov. |
| 8 | Spot › Vue d'ensemble | `G t G T` | A0 | 2,1 / 4,2 | 0·2·1 | 3 | 4 | 4 | 3 | 2 | **3,2** | Sans barre collante ; titre « Prix de l'électricité » ≠ menu ; sous-titre anglais ; cartes qui répètent le menu |
| 9 | Prix négatifs | `B S K7 T S K5 G T S K5 G×4 T` | A1 | 4,7 / 8,3 | 17·5·3 | 4 | 5 | 2 | 5 | 4 | **4,0** | Bien construit mais 4,7 écrans (8 sur mobile) ; périodes « 1M 1Y 5Y » en anglais |
| 10 | Spreads | `B S K7 G S G K5` | A1 | 1,5 / 2,2 | 12·2·0 | 5 | 5 | 5 | 4 | 4 | **4,6** | Fil d'Ariane « Spread » ≠ menu « Spreads » ; graphiques sans carte titrée |
| 11 | Déséquilibre › Quotidien | `B S G×3` | A1 | 1,3 / 2,1 | 0·3·0 | 3 | 5 | 5 | 4 | 5 | **4,4** | Fil « Prix de déséquilibre » ≠ menu « Déséquilibre » ; pas de KPI |
| 12 | Déséquilibre › mFRR | `B S G S T` | A6 | 1,0 / 1,5 | 0·1·1 | 3 | 5 | 5 | 4 | 5 | **4,4** | Tableau d'écarts : page registre |
| 13 | Électricité forwards › Tableau | `B S L×11 S K4 T T` | A3 | 2,0 / 3,3 | 4·0·2 | 3 | 5 | 4 | 4 | 4 | **4,0** | 1er écran = 4 blocs de texte ; le tableau forward n'arrive qu'au 2e écran |
| 14 | Électricité forwards › Comparaison | `B S G T` | A3 | 1,0 / 1,3 | 0·1·1 | 3 | 5 | 4 | 4 | 5 | **4,2** | 1 graphique + 1 tableau : onglet maigre (B-05) |
| 15 | Électricité forwards › Contrats calendaires | `B S K4 G T G` | A3 | 1,4 / 2,5 | 4·2·1 | 5 | 5 | 5 | 4 | 4 | **4,6** | Modèle courbe correct ; 7 champs dans la page, hors barre |
| 16 | Gaz, carbone, pétrole › Prix spot › Vue d'ensemble | `B S K6 G×2` | A1 | 1,4 / 2,0 | 6·2·0 | 5 | 5 | 5 | 4 | 5 | **4,8** | Bon : KPI puis 2 graphiques ; fil « Prix combustibles & EUA » ≠ menu « Prix spot » |
| 17 | Gaz, carbone, pétrole › Prix spot › Gaz | `B S G×2` | A1 | 1,2 / 1,6 | 0·2·0 | 3 | 5 | 4 | 4 | 5 | **4,2** | 2 graphiques sans KPI : onglet maigre |
| 18 | Gaz, carbone, pétrole › Prix spot › Charbon & pétrole | `B S K5 G×3` | A1 | 1,4 / 2,7 | 5·3·0 | 5 | 5 | 5 | 4 | 5 | **4,8** | Bon modèle Photo du jour |
| 19 | Gaz… › Courbes forward › Courbes | `B S K6 G×2` | A3 | 0,8 / 1,7 | 6·2·0 | 5 | 5 | 4 | 5 | 5 | **4,8** | Bon : KPI + 2 courbes en moins d'un écran |
| 20 | Gaz… › Courbes forward › TTF : contrats et cotations | `B S G T S T T` | A3 | 2,7 / 3,2 | 0·1·3 | 3 | 5 | 3 | 5 | 4 | **4,0** | 6 champs dans la page ; 3 tableaux |
| 21 | Spark & dark spreads › Quotidien | `B S K6 G T` | A1 | 2,2 / 2,6 | 6·1·1 | 5 | 5 | 4 | 5 | 5 | **4,8** | Bon modèle ; libellé « Delivery » en anglais dans la barre |
| 22 | Spark & dark spreads › Historique | `B S G×2` | A2 | 1,3 / 1,8 | 0·2·0 | 3 | 5 | 4 | 5 | 4 | **4,2** | 3 champs hors barre |
| 23 | Garanties d'origine › EU | `B S K4 G×3 T G×4` | A2 | 3,5 / 5,1 | 4·7·1 | 5 | 4 | 3 | 4 | 4 | **4,0** | 7 graphiques ; fil « Prix & enchères » ≠ menu « Garanties d'origine › Prix Europe » |
| 24 | Garanties d'origine › Enchères France | `B S K5 G T G×2 T` | A2 | 5,2 / 6,2 | 5·3·2 | 5 | 5 | 2 | 4 | 5 | **4,2** | 5,2 écrans, 7 400 caractères |
| 25 | Batteries (BESS) › Europe | `B S K4 G×2 T` | A4 | 2,1 / 2,7 | 4·2·1 | 5 | 5 | 4 | 4 | 5 | **4,6** | Bon modèle Comparaison |
| 26 | Batteries (BESS) › Valeur day-ahead | `B S K6 G×4 S T` | A2 | 2,7 / 3,8 | 6·4·1 | 5 | 5 | 3 | 4 | 5 | **4,4** | Correct |
| 27 | Batteries (BESS) › Réserves | `B S K5 G` | A2 | 1,0 / 1,6 | 5·1·0 | 5 | 5 | 5 | 4 | 5 | **4,8** | Correct, court |
| 28 | Batteries (BESS) › Sources de revenus | `B S T` | A6 | 0,9 / 1,1 | 0·0·1 | 3 | 5 | 5 | 4 | 5 | **4,4** | Tableau seul |
| 29 | Batteries (BESS) › Mécanisme de capacité | `B S G K4 T` | A4 | 1,5 / 2,1 | 4·1·1 | 5 | 4 | 5 | 4 | 4 | **4,4** | Graphique de 670 px avant les KPI (ordre inversé) |
| 30 | Batteries (BESS) › Méthode | `B S` | A8 | 1,2 / 2,0 | 0·0·0 | 3 | 5 | 5 | 4 | 5 | **4,4** | Texte seul dans un onglet de données |
| 31 | Batteries (BESS) › Indice | `B S K7 G×2` | A2 | 1,7 / 2,7 | 7·2·0 | 5 | 5 | 4 | 3 | 5 | **4,4** | Même vue sous 2 adresses (Batteries › Indice et Outils › Indice BESS) ; fil « Outils » ici |

#### Renouvelables

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 32 | Capture & cannibalisation › Quotidien | `B S K6 G×2` | A1 | 1,4 / 2,0 | 6·2·0 | 5 | 5 | 5 | 3 | 5 | **4,6** | 6 onglets, la barre passe sur 2 lignes ; titre graphique anglais « Intraday output vs price » |
| 33 | Capture & cannibalisation › Historique | `B S G×2 T` | A2 | 1,6 / 2,2 | 0·2·1 | 3 | 5 | 4 | 4 | 5 | **4,2** | Pas de KPI |
| 34 | Capture & cannibalisation › M0 et appels d’offres | `B S G T T T G×2 T` | A3 | 4,1 / 6,4 | 0·3·4 | 3 | 5 | 2 | 2 | 4 | **3,2** | Atteint par 2 entrées de menu ; 4 tableaux, 6 écrans sur mobile |
| 35 | Capture & cannibalisation › Cannibalisation | `B S G T G×11` | A2 | 5,6 / 10,4 | 0·12·1 | 3 | 3 | 1 | 4 | 4 | **3,0** | 12 graphiques, 5,6 écrans (10 sur mobile), 6 champs hors barre |
| 36 | Capture & cannibalisation › Capture forward | `B S G T` | A3 | 1,3 / 1,6 | 0·1·1 | 3 | 5 | 5 | 4 | 5 | **4,4** | Correct |
| 37 | Capture & cannibalisation › Europe | `B S G×2 T` | A4 | 1,2 / 2,1 | 0·2·1 | 3 | 5 | 5 | 4 | 4 | **4,2** | Pas de KPI ; champ hors barre |
| 38 | Capacité installée › Par année | `B S K6 G T S K4 G` | A2 | 1,7 / 3,1 | 10·2·1 | 5 | 5 | 4 | 5 | 5 | **4,8** | Bon modèle |
| 39 | Capacité installée › Comparaison | `B S K4 G S G` | A4 | 1,6 / 2,4 | 4·2·0 | 5 | 5 | 5 | 5 | 5 | **5,0** | Meilleure note du site |

#### Système électrique

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 40 | Carte d'Europe | `B S K4 M G×3` | A4 | 2,4 / 4,0 | 4·3·0 | 5 | 4 | 4 | 4 | 4 | **4,2** | Carte + 3 graphiques, filtres dans la page |
| 41 | Mix de production › Quotidien | `B S K6 T S K5 L T` | A1 | 1,8 / 2,7 | 11·0·2 | 4 | 3 | 4 | 5 | 5 | **4,2** | Section « Tableau genmix » (jargon) ; date « mm/dd/yyyy » sur site français |
| 42 | Mix de production › Historique | `B S G×3 S K6 T S K5 L T` | A2 | 5,3 / 7,0 | 11·3·2 | 3 | 4 | 2 | 5 | 3 | **3,4** | 3 sections, 5,3 écrans |
| 43 | Nucléaire | `B S K6 G×4 S` | A1 | 2,5 / 3,7 | 6·4·0 | 5 | 5 | 4 | 5 | 5 | **4,8** | Bon : KPI + 4 graphiques |
| 44 | Indisponibilités & REMIT › Indisponibilités | `B S K6 G S K5 G×2 T` | A6 | 5,5 / 6,5 | 11·3·1 | 5 | 4 | 2 | 5 | 5 | **4,2** | Diagramme de 1 100 px ; 17 000 caractères |
| 45 | Indisponibilités & REMIT › Plateformes | `B S T` | A6 | 0,6 / 0,7 | 0·0·1 | 3 | 5 | 5 | 5 | 5 | **4,6** | Tableau seul, 0,6 écran |
| 46 | Consommation › Quotidien | `B S K5 G T` | A1 | 2,0 / 2,3 | 5·1·1 | 5 | 5 | 4 | 4 | 5 | **4,6** | Fil « Charge & demande » ≠ menu « Consommation » |
| 47 | Consommation › Prévision | `B S G` | A2 | 0,8 / 1,0 | 0·1·0 | 3 | 5 | 4 | 4 | 5 | **4,2** | 1 graphique : onglet maigre |
| 48 | Consommation › Historique | `B S G×2` | A2 | 0,7 / 1,5 | 0·2·0 | 3 | 5 | 4 | 4 | 5 | **4,2** | 2 graphiques, 0,7 écran : onglet maigre |
| 49 | Échanges transfrontaliers › Quotidien | `B S K6 t G×2` | A1 | 1,6 / 2,7 | 6·2·0 | 5 | 5 | 4 | 4 | 5 | **4,6** | Fil « Flux transfrontaliers » ≠ menu « Échanges transfrontaliers » |
| 50 | Échanges transfrontaliers › Frontières | `B S T` | A6 | 0,7 / 0,8 | 0·0·1 | 3 | 5 | 5 | 4 | 5 | **4,4** | Tableau seul : onglet maigre |
| 51 | Système France › Quotidien | `B S K6 G×5` | A1 | 2,7 / 3,8 | 6·5·0 | 5 | 5 | 3 | 5 | 4 | **4,4** | 5 graphiques après les KPI |
| 52 | Système France › Historique | `B S G T` | A2 | 1,4 / 1,8 | 0·1·1 | 3 | 5 | 5 | 5 | 5 | **4,6** | Correct |
| 53 | Régions › Quotidien | `B S K5 G×2 T` | A1 | 1,8 / 2,5 | 5·2·1 | 5 | 5 | 4 | 4 | 4 | **4,4** | Correct |
| 54 | Régions › Capacités et consommation | `B S G×2` | A4 | 1,2 / 1,8 | 0·2·0 | 3 | 5 | 5 | 4 | 5 | **4,4** | Pas de KPI |
| 55 | Météo › Villes › Quotidien | `B S K6 G S T` | A1 | 1,5 / 2,1 | 6·1·1 | 5 | 5 | 5 | 4 | 5 | **4,8** | Fil « Météo énergie » ≠ menu « Villes & prévisions » |
| 56 | Météo › Villes › Prévision 5 semaines | `B S G×4` | A2 | 1,2 / 2,7 | 0·4·0 | 3 | 5 | 5 | 4 | 5 | **4,4** | 4 graphiques sans KPI |
| 57 | Météo › Villes › Réservoirs hydrauliques | `B S K4 G×2` | A2 | 0,9 / 1,9 | 4·2·0 | 5 | 5 | 5 | 4 | 4 | **4,6** | Hors sujet météo : à mettre sous Production (B-06) |
| 58 | DJU › Quotidien | `B S K6 G×2` | A1 | 1,3 / 2,0 | 6·2·0 | 5 | 5 | 5 | 4 | 5 | **4,8** | Fil « Degrés-jours » ≠ menu « DJU chauffage / climatisation » |
| 59 | DJU › Hebdomadaire | `B S G T` | A2 | 1,3 / 1,6 | 0·1·1 | 3 | 5 | 5 | 4 | 5 | **4,4** | Onglet maigre (B-06) |
| 60 | Bilan électrique | `B K6 G×8 T G t` | A5 | 5,8 / 10,8 | 6·9·1 | 5 | 3 | 2 | 5 | 3 | **3,6** | Pas de section ; filtre années dans la page ; 9 graphiques, 11 écrans sur mobile |
| 61 | Intensité carbone | `B S T` | A1 | 0,6 / 0,8 | 0·0·1 | 3 | 5 | 4 | 5 | 4 | **4,2** | Un tableau seul (622 caractères) |

#### Outils

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 62 | Pricer PPA › Entrées et prix | `B S S t×6 G×4 S T S T G` | A7 | 4,7 / 9,2 | 0·5·2 | 3 | 3 | 2 | 5 | 5 | **3,6** | 55 champs, 4 sections ; 9 écrans sur mobile |
| 63 | Pricer PPA › Le parc | `B S T S K6 G t G×9 S T G` | A7 | 5,3 / 10,1 | 6·11·2 | 4 | 4 | 1 | 5 | 5 | **3,8** | 11 graphiques, 10 écrans sur mobile |
| 64 | Pricer PPA › Méthodes | `B S T S K5 G T t S T G s G T` | A7 | 4,2 / 6,7 | 5·3·4 | 4 | 3 | 2 | 5 | 5 | **3,8** | 2 niveaux d'onglets ; 4 tableaux |
| 65 | Pricer PPA › Comparaison et prix | `B S T S G K6 T G×3 T G T T S T G S G×2` | A7 | 8,2 / 11,4 | 6·8·6 | 4 | 2 | 1 | 5 | 5 | **3,4** | Page la plus longue des outils : 8 écrans, 6 tableaux, 8 graphiques |
| 66 | Pricer BOA › Entrées et résultat | `B S G×2` | A7 | 1,3 / 3,3 | 0·2·0 | 4 | 4 | 5 | 5 | 5 | **4,6** | Correct ; graphiques sans carte titrée |
| 67 | Pricer BOA › La batterie | `B S K5 G` | A7 | 1,4 / 2,7 | 5·1·0 | 4 | 5 | 5 | 5 | 5 | **4,8** | Correct |
| 68 | Pricer BOA › Structures de contrat | `B S T` | A6 | 1,2 / 1,6 | 0·0·1 | 3 | 5 | 5 | 5 | 5 | **4,6** | Tableau seul |
| 69 | Prévision de production › Site et prévision | `B S t K4 S G×2 T` | A7 | 2,7 / 4,1 | 4·2·1 | 4 | 5 | 3 | 5 | 5 | **4,4** | Bon modèle Outil : site puis prévision |
| 70 | Prévision de production › Valoriser ce parc | `B S K4` | A7 | 0,5 / 0,8 | 4·0·0 | 4 | 5 | 5 | 5 | 5 | **4,8** | 4 KPI seuls |
| 71 | Prévision de production › Quelle fiabilité | `B S T G×2 T G×2` | A7 | 2,2 / 4,0 | 0·4·2 | 4 | 4 | 4 | 5 | 5 | **4,4** | Correct |
| 72 | Empreinte carbone › Vos données | `B S` | A7 | 0,7 / 1,0 | 0·0·0 | 3 | 4 | 5 | 4 | 5 | **4,2** | Écran d'entrée correct |
| 73 | Empreinte carbone › Vue d'ensemble | `B` | A7 | 0,3 / 0,3 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données (197 caractères), B-02 |
| 74 | Empreinte carbone › Consommation | `B` | A7 | 0,3 / 0,4 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données, B-02 |
| 75 | Empreinte carbone › Carbone | `B` | A7 | 0,3 / 0,4 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données, B-02 |
| 76 | Empreinte carbone › Coût & flexibilité | `B` | A7 | 0,3 / 0,4 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données, B-02 |
| 77 | Empreinte carbone › Solaire & couverture | `B` | A7 | 0,3 / 0,4 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données, B-02 |
| 78 | Empreinte carbone › Reporting | `B` | A7 | 0,3 / 0,4 | 0·0·0 | 1 | 5 | 1 | 4 | 4 | **3,0** | Vide sans données, B-02 |
| 79 | Analyse de marché | `B K6 G×7 t` | A5 | 2,9 / 6,0 | 6·7·0 | 5 | 4 | 3 | 3 | 3 | **3,6** | Rangé sous Outils alors que c'est de l'analyse ; filtres hors barre ; pas de sections ; recoupe « Ce qui fait le prix » |
| 80 | Rejouer une journée | `B G` | A7 | 1,0 / 0,7 | 0·1·0 | 4 | 5 | 5 | 4 | 4 | **4,4** | Rangé sous Outils, adresse system/ ; 8 champs |
| 81 | Comparateur | `B t G t×6 G` | A7 | 2,2 / 5,1 | 0·2·0 | 4 | 3 | 4 | 5 | 4 | **4,0** | 80 champs ; graphique de 790 px |
| 82 | Convertisseur | `B T` | A7 | 1,8 / 2,0 | 0·0·1 | 3 | 5 | 4 | 5 | 4 | **4,2** | Correct |

#### Veille

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 83 | Actualités | `B S S T` | A6 | 12,2 / 25,1 | 0·0·1 | 3 | 5 | 2 | 5 | 4 | **3,8** | 12 écrans de liste (25 sur mobile) ; « 8 searches » en anglais |
| 84 | Évolutions et événements | `B` | A6 | 6,9 / 13,0 | 0·0·0 | 3 | 5 | 2 | 5 | 4 | **3,8** | 7 écrans de texte (13 sur mobile) |

#### Général

| # | Page › onglet | Structure actuelle | Cible | Écrans PC / mobile | KPI·G·T | Clarté | Lisib. | Densité | Trouv. | Struct. | **Moy.** | Constat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 85 | État des données › Sources | `B S T S T` | A6 | 2,1 / 2,9 | 0·0·2 | 3 | 5 | 4 | 5 | 5 | **4,4** | Correct |
| 86 | État des données › Problèmes de flux | `B S T S T` | A6 | 2,4 / 3,4 | 0·0·2 | 3 | 5 | 4 | 5 | 5 | **4,4** | Correct |
| 87 | API | `B S t×2 S S T` | A8 | 5,7 / 7,1 | 0·0·1 | 4 | 5 | 2 | 5 | 4 | **4,0** | 5,7 écrans, 13 600 caractères |
| 88 | Méthodologie | `B T` | A8 | 1,4 / 2,2 | 0·0·1 | 3 | 4 | 2 | 5 | 4 | **3,6** | 38 000 caractères sur une page |
| 89 | À propos | `B` | A8 | 0,2 / 0,1 | 0·0·0 | 3 | 5 | 5 | 5 | 4 | **4,4** | Correct |

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
