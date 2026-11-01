# PowerKlock : guide de style (normes figées)

Ce guide fixe les valeurs que toute page, tuile, graphique ou tableau doit suivre. Il est tiré des mesures de
l'audit du 1er novembre 2026 (`scripts/audit_site.py`, voir `AUDIT_POWERKLOCK.md`) et du code existant
(`css/site.css`, `js/libs.js`, `js/palette.js`). Une valeur qui n'est pas ici se prend dans les variables CSS
(`:root` de `css/site.css`) ; une couleur ou une taille écrite en dur dans une nouvelle page est un écart.

Règles du propriétaire, rappelées car elles priment sur tout le reste : hausse de prix en rouge, baisse en vert,
partout ; lignes droites entre les points (pas de lissage) ; vert d'accent avec parcimonie ; chaque texte visible en
français et en anglais ; la source est nommée sous chaque graphique.

## 1. Gabarit de page

Toutes les pages suivent Marchés › Day-ahead :

1. **Barre collante** `.pr-tabs-sticky > .pr-tabs-bar` : fil d'Ariane `Section › Page` à gauche, onglets de vue
   (`.tabs-nav .tab-btn`), puis filtres (zone, période, date) à droite. Les filtres ne sont jamais ailleurs.
2. **Sections repliables** `.hist-section.hist-section-strong` : en-tête 13 px gras capitales, corps 18 px de marge.
   La première section est ouverte ; une section fermée par défaut doit se justifier (détail rarement lu).
3. Dans une section, toujours dans cet ordre : bandeau de KPI (`.kpi-strip`), graphiques (`.fuel-grid-2` pour deux
   côte à côte, même hauteur), tableau, note de méthode et source (`.fuel-note`).

Trois gabarits suffisent :

| Gabarit | Usage | Contenu |
|---|---|---|
| **Tableau de bord** | Aujourd'hui, Mes tableaux de bord | Barre, grille de tuiles (KPI et graphiques) sans sections |
| **Analyse** | toutes les pages de données | Barre, sections (KPI, graphiques, tableau, note) |
| **Outil / référence** | Pricers, Prévision, Empreinte carbone, Convertisseur, Méthodologie, API, À propos | Barre, sections d'entrées puis résultats ; texte long en colonne de 760 px au plus |

## 2. Tuiles

| Rôle | Classe | Fond | Bordure | Rayon | Marge interne |
|---|---|---|---|---|---|
| Carte de graphique ou de tableau | `.chart-container`, `.table-wrap` | `var(--bg2)` | 1 px `var(--border)` | 8 px | 16 px |
| Carte KPI | `.kpi-card` | `#1c242e` (un cran au-dessus de la carte) | 1 px `var(--border)`, gauche 3 px couleur de tendance | 8 px | 14 px 16 px |
| Section | `.hist-section-strong` | `var(--bg2)`, en-tête `var(--bg3)` | 1 px `var(--border2)` | 10 px | 18 px |

- Une seule ombre : celle des sections. Pas d'ombre sur les cartes.
- Espacement entre tuiles : 14 px (grilles) ; 20 px sous une carte isolée.
- Carte KPI : libellé 10 px Outfit 600 capitales, interlettrage 0,1 em, `var(--text3)` (ou couleur de tendance) ;
  valeur 22 px JetBrains Mono 600 (17 px sous 600 px de large) ; unité 12 px `var(--text3)` ; ligne de détail 11 px.
- Bordure gauche de tendance : `--up` / `--down` selon le sens favorable du chiffre (prix en hausse = rouge),
  `--kpi-flat` si neutre. Le libellé d'une carte neutre reste en `var(--text3)` (lisible), jamais en `--kpi-flat`.

## 3. Graphiques (Chart.js)

| Propriété | Norme |
|---|---|
| En-tête de carte | `.fuel-card-head` : titre `.table-title` (11 px, 600, capitales, 0,08 em, `var(--text2)`), sous-titre `.fuel-card-sub` (11 px mono, `var(--text3)`) avec unité et période, badge source `.source-badge` à droite |
| Hauteur | 280 px (paire côte à côte) ou 320 px (pleine largeur) ; 360 px pour les profils horaires ; rien sous 180 px |
| Graduations | 10 px, `#7A93AB` (`var(--text3)`), police JetBrains Mono |
| Grille | `rgba(26,45,63,.5)`, sans traits de graduation (`GRID` de `js/libs.js`) |
| Légende | en bas, cases de 10 px, 10 px de texte ; aucune légende pour une seule série |
| Trait | 1,5 px (2 px pour la série principale), `tension: 0`, `pointRadius: 0` sauf marqueurs voulus |
| Zoom | rectangle à la souris (`ZOOM_CFG`), bouton « ↺ Annuler le zoom » et double-clic pour revenir (`js/zoom-reset.js`) |
| Survol | lecture `pkHoverReadout` (ligne verticale et encadré), valeurs avec leur unité, au format de la langue |
| Axes | titre d'axe = unité (`€/MWh`, `GW`, `%`) quand le titre de la carte ne la donne pas |
| Vide | jamais d'axes seuls : `noDataMsg(canvas, titre, détail)` dit pourquoi (source muette, période vide) |
| Repère « maintenant » | trait pointillé jaune `#FFFD82`, étiquette « MAINTENANT » / « NOW » |

Palette des séries (`js/palette.js`, `SERIES_POOL`) : `#14D3A9`, `#ED6965`, `#FFFD82`, `#1A7B8C`, `#CA6702`, `#BB3E03`,
`#7DD3FC`, `#8B7FB5`, neutre `#7A93AB`. Au-delà de 8 séries : petits multiples ou sélection, pas de nouvelles teintes.
Couleurs fixes par filière (variables `--gen-*`) : nucléaire `#7B4B9C`, éolien `#14D3A9`, solaire `#FBBF24`,
hydraulique `#3FA6B4`, fossile `#ED6965`, biomasse `#94D2BD`. Une filière garde sa couleur sur tous les graphiques.
**Violet et pourpre réservés au nucléaire** (règle de Tom, 1er novembre 2026) : aucune autre série, tuile ou
bordure en violet. À remplacer : `#8B7FB5` (8e couleur de `SERIES_POOL`), `#A87DC4` (`--cat-carbon`, charge
résiduelle prévue), `#B48CF2` (carte de lecture forwards), `#E879F9` / `#A21CAF` (charge des batteries).
Une série ne se distingue jamais par la seule couleur rouge contre vert : ajouter un tiret, une épaisseur ou une étiquette.

## 4. Tableaux

- En-tête `th` : 10 px, 600, capitales, 0,06 em, `var(--text3)`, marge 10 px 12 px, aligné à droite sauf la 1re colonne.
- Cellules `td` : 13 px JetBrains Mono, marge 9 px 12 px, nombres alignés à droite, chiffres tabulaires ;
  tableaux denses (plus de 8 colonnes ou toutes les zones) : 11 px, marge 9 px 12 px.
- Tableau par zone : colonne 1 = drapeau + code (`🇫🇷 FR`), colonne 2 = nom du pays dans la langue de la page.
- Ligne au survol `var(--bg3)` ; tri au clic sur l'en-tête (curseur main) ; tableau large : défilement dans sa boîte,
  jamais de la page.

## 5. Texte

Polices : Outfit (interface), JetBrains Mono (nombres, codes, notes), Inter seulement en repli. Échelle à 7 paliers :

| Palier | Taille | Usage |
|---|---|---|
| Libellé | 10 px capitales | en-têtes de tableau, libellés KPI, badges |
| Note | 11 px | sous-titres de carte, notes, métadonnées |
| Petit | 12 px | onglets secondaires, boutons de période |
| Corps | 13 px | texte, cellules, onglets |
| Titre de section | 15 px | titres H3, en-têtes de bloc |
| Titre de page | 22 px | H1 (un seul par page) |
| Chiffre clé | 22 px mono | valeurs KPI |

Rien sous 10 px. Couleurs : `--text` titres et valeurs, `--text2` texte courant, `--text3` secondaire ; `--text4`
réservé aux textes non essentiels (contraste 4,6:1 au plus juste). Contraste minimal 4,5:1 (3:1 pour les traits et
séries de graphiques).

## 6. Couleurs et variables

Toujours `var(--…)` :
fonds `--bg` `#0a0e13`, `--bg2` `#0f1419`, `--bg3` `#151c24`, `--bg4` `#1a2332` ; bordures `--border` `#1e2d3d`,
`--border2` `#243447` ; accent `--accent` `#14D3A9` ; sémantique `--up` (hausse favorable) `#14D3A9`, `--down` `#ED6965`,
`--warn` `#EE9B00` ; texte `--text` `#FFF`, `--text2` `#B8C9D9`, `--text3` `#7A93AB`, `--text4` `#7088A4`.
Les alias courts (`--tx`, `--tx2`, `--tx3`, `--tx4`, `--bd`, `--dn`) gardent exactement les mêmes valeurs.

## 7. Boutons, onglets, filtres

| Rôle | Classe | Style |
|---|---|---|
| Onglet de vue | `.tabs-nav .tab-btn` | 13 px, 5 px 12 px, rayon 4 px, actif = fond accent atténué |
| Bouton de période | `.pk-gf-btn` | 10 px mono capitales, 3 px 8 px, rayon 3 px |
| Bouton secondaire | `.pk-btn-ghost` | 26 px de haut dans la barre, 10 px |
| Sélecteur de zone | `.country-select` | 26 px de haut, 11 px |

Cible cliquable de 24 px au moins ; focus clavier visible partout (contour 2 px `var(--accent)`) ; boutons et
champs dans la police de la page (pas l'Arial du navigateur).

## 8. Langue et formats

- Français par défaut, anglais au choix ; le texte est écrit en anglais dans le code et traduit par
  `assets/i18n_fr.json` (texte exact) et `assets/i18n_fr_tpl.json` (texte avec nombres).
- Tout texte dessiné sur un canvas (légende, axe, lecture au survol, étiquettes d'annotation) passe par
  `PKI18n.tr` : la traduction de la page ne l'atteint pas sinon.
- Nombres : `1 234,5` en français, `1,234.5` en anglais. Unités : `€/MWh`, `£/MWh`, `MW`, `GW`, `TWh`, `€/t`, `%`
  (espace avant l'unité et avant `%`). Jamais `EUR/MWh` à l'écran.
- Dates : jours de livraison, heure de Paris ; `1 nov. 2026` dans le texte, `2026-11-01` seulement dans les
  identifiants et les exports.
