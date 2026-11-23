# PowerKlock · page de garde publique : cahier des charges

Maquette validée comme direction : https://claude.ai/artifact/Wb4NGXCfSYmvWmWoFX47oy (v4, fichier `docs/landing/maquette_v4.html`).
Objectif : un visiteur non connecté comprend en 10 secondes ce que contient le site et a envie de se connecter.
Elle remplace la vue publique actuelle (Aujourd'hui › Expert sous la barre de `js/gate.js`).

## Ce qu'on garde de la maquette
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
