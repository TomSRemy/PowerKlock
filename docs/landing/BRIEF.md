# PowerKlock · page de garde publique : cahier des charges

Maquette validée comme direction : https://claude.ai/artifact/Wb4NGXCfSYmvWmWoFX47oy (v4, fichier `docs/landing/maquette_v4.html`).
Objectif : un visiteur non connecté comprend en 10 secondes ce que contient le site et a envie de se connecter.
Elle remplace la vue publique actuelle (Aujourd'hui › Expert sous la barre de `js/gate.js`).

## Ce qu'on garde de la maquette
- Identité : logo complet `assets/logo-header.png` (barre du haut, pied de page) ; icône jaune ronde `assets/favicon-*.png` et `assets/apple-touch-icon.png` = icône du site (onglet, écran d'accueil iPhone), reprise en signature de la section Accès ; `assets/icon-192.png` / `icon-512.png` (fond sombre, éclair turquoise) = icône de l'app installée (manifest).
- Fond du haut de page : la courbe France derrière le titre est à garder et à retravailler (plus présente qu'en v5, sans gêner la lecture).
- Palette, polices et cartes du site (`css/site.css` : `--bg`, `--accent` #14D3A9, `--price-up` / `--price-down`, Outfit, Inter, JetBrains Mono).
- Haut de page compact : titre à gauche, carte « Spot France, livraison J+1 » à droite (courbe des 96 quarts d'heure qu'on survole, plus bas, plus haut, pointe − base, écart sur la veille). La courbe France brille en fond, discrète (30 zones en fond : refusé, trop chargé).
- Bandeau défilant des chiffres du jour (validé tel quel).
- Cinq rubriques, chacune avec un vrai graphique qui s'anime à l'arrivée :
  1. Prix de l'électricité : carte d'Europe colorée par le prix moyen de J+1, survol par pays, classement (4 plus chères, France et son rang, 3 moins chères).
  2. Renouvelables : heures négatives France par mois, compteur de l'année.
  3. Outils : prix PPA solaire et éolien, M0 sur 12 mois.
  4. Veille : fil de titres qui défile, newsletter 7 O'Klock.
  5. Mes tableaux de bord : tuiles qui se réorganisent.
- « Et bien plus » : toutes les pages du menu en trois lignes qui défilent.
- Fin : appel à se connecter, compteurs, modes de connexion (mot de passe, Google, code).

## Ce qui est interdit
- **Aucun prix forward** (courbe, Cal+1…) sur la page publique : source sensible.
- Aucun texte d'article de presse : titres et liens seulement.
- Aucun chiffre inventé ou figé : tout est lu dans `data/` au chargement.

## Données (toutes déjà dans `data/`)
| Bloc | Fichier | Champ |
|---|---|---|
| Spot J+1, courbe, plus bas / haut | `data/history/daily/<J+1>.json` | `zones.FR.avg/min/max/hourly` (avant 13 h : J, avec la mention « aujourd'hui ») |
| Écart sur la veille | même fichier, jour J | `zones.FR.avg` (moyenne publiée, jamais la moyenne de la série) |
| Carte Europe | `data/history/daily/<J+1>.json` + `data/geo/europe.json` | `zones.*.avg` ; Italie = IT_NORD, Norvège = NO_1, Danemark = DK_W (à écrire sous la carte) |
| Heures négatives | `data/history/daily/2026-*.json` | `zones.FR.negH`, somme par mois |
| PPA | ce qu'affiche Outils › PPA (même calcul, pas un chiffre recopié) | prix publié solaire et éolien |
| M0 | `data/m0.json` | `months[-12:]` base, solarM0, windM0 |
| TTF, EUA | `data/commodities.json` | dernier point |
| Veille | `data/news.json` | 8 derniers titres + source ; nombre d'articles et de sources |
| Pages | menu `js/nav-v2.js` | liste et nombre, jamais écrits en dur |

À vérifier avant d'afficher : `data/fr_market.json` date du 23 nov. le prix 245,27 € que l'historique date du 24 (jour de livraison). Trouver la cause et ne prendre que l'historique.

## Règles du site (CLAUDE.md) à respecter
- Français et anglais pour chaque texte (`assets/i18n_fr.json`), le bouton FR/EN marche ; « PowerKlock » jamais traduit.
- Hausse en rouge, baisse en vert ; lignes droites entre les points.
- La source est écrite sous chaque graphique ; la Méthodologie décrit la page.
- 390, 1024, 1180, 1280 px sans défilement horizontal ; `prefers-reduced-motion` respecté (page complète sans animation).
- Bibliothèques copiées dans `js/vendor/` (pas de CDN) : GSAP 3.13 (ScrollTrigger, SplitText, gratuits) et Lenis 1.1. Chargées seulement sur la page de garde ; le test de poids de page doit passer.
- La page visiteur ne lance aucun calcul lourd des autres pages ; les boutons « Ouvrir… » et « Se connecter » ouvrent la fenêtre de connexion existante (`PKDash.openAccount`), qui recharge sur le site complet une fois approuvé.
- `scripts/check_before_push.sh` avant chaque push ; Site tests et Publish au vert.

## Niveau de finition attendu
- Chaque animation a une raison (entrée, construction d'un graphique, donnée vivante) et dure moins de 1,8 s ; rien n'attend une animation pour être lisible.
- 60 images/s sur un portable moyen : animation du fond arrêtée quand il sort de l'écran, pas de flou animé.
- Accessibilité : contrastes AA, focus visible, libellés ARIA sur les graphiques.
- Espaces insécables avant les unités et dans « 13 h », « 7 h ».
- Pistes « wow » si le temps le permet : courbe de fond en WebGL (OGL) avec particules qui suivent le prix ; transition de page vers le site complet après connexion.

## Méthode
1. Lire la maquette, `js/gate.js`, `index.html` (tête), `css/site.css`, `js/i18n.js`.
2. Proposer en une page l'intégration (où vit le code, comment la barre de connexion actuelle disparaît) et attendre l'accord de Tom (changement de structure de la vue publique).
3. Construire sur une branche, aperçu de la PR à Tom avant fusion.

## Ajouts après revue (24 nov.)
- Graphiques identiques à ceux des outils : Chart.js 4.4.1 avec les réglages de `js/pk-chart-system.js` ; les tuiles du tableau de bord viennent du catalogue (`js/widgets.js`, chiffres clés de `js/widgets-kpi.js`), rien d'inventé (pas de compte à rebours).
- Pas de cases autour des graphiques des rubriques : pleine largeur, texte posé là où les données laissent de la place.
- Courbe de fond du haut de page et carte du prix sur le même quart d'heure.
- Dépôts conseillés : chartjs-chart-geo (carte d'Europe en Chart.js), chartjs-chart-matrix (carte de chaleur), NumberFlow (chiffres qui roulent), GSAP + Lenis (déjà utilisés), OGL en bonus pour le fond.
- Vérifié à 390, 768, 1024, 1180 et 1280 px : à refaire sur la version finale.

## Nouvelle direction (24 nov., validée par Tom) : ultra moderne, pas un modèle de 2020
La maquette v9 (`docs/landing/maquette_v4.html`, https://claude.ai/artifact/Wb4NGXCfSYmvWmWoFX47oy) fixe le contenu, les données, la palette et les règles. Sa mise en scène est jugée datée (rubriques empilées sur le même gabarit, animations décoratives, graphiques posés comme des images, halo et pastilles génériques). À refaire :
1. **Un seul objet vivant qui se transforme au défilement** : la courbe des 96 quarts d'heure de J+1 reste épinglée et se transforme (carte d'Europe colorée par prix, heures négatives de l'année, M0, puis éclate en tuiles du tableau de bord). On suit une donnée qui change de forme, pas des rubriques.
2. **Typographie animée** : très grands chiffres qui roulent (NumberFlow) et réagissent au défilement ; pas de titres de section à l'ancienne.
3. **« Et bien plus » en grille bento** : tuiles de tailles différentes, chacune avec un mini-graphique vivant du catalogue, réaction au survol et au curseur.
4. **Matière et profondeur** : grain léger, parallaxe, fond WebGL (OGL) où la courbe a du relief et réagit au curseur.
5. **Micro-interactions** : valeurs au curseur, boutons magnétiques, vraie transition vers le site après connexion.
Contraintes inchangées : vraies données de `data/` uniquement, aucun prix forward, graphiques au style du site (Chart.js + `js/pk-chart-system.js`, extensions chartjs-chart-geo / chartjs-chart-matrix), FR et EN, 390 à 1280 px impeccables (sur téléphone : titre avant graphique, rien qui se chevauche), `prefers-reduced-motion` respecté, poids raisonnable, 60 images/s.
