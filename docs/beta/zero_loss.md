# Preuve zéro perte : site actuel → bêta

Relevé du site actuel : 100 vues (2026-11-20 20:57 UTC). Relevé de la bêta : 101 vues (2026-11-20 21:06 UTC).

| Élément | Site actuel | Retrouvés dans la bêta | Manquants | En plus dans la bêta |
|---|---|---|---|---|
| graphiques | 253 | 253 | 0 | 0 |
| tableaux | 86 | 86 | 0 | 0 |
| cartes KPI | 296 | 296 | 0 | 0 |
| sections | 117 | 117 | 0 | 0 |
| cartes | 1 | 1 | 0 | 0 |
| schémas | 4 | 4 | 0 | 0 |
| réglages | 201 | 201 | 0 | 1 |
| blocs de texte | 1275 | 1275 | 0 | 99 |

Graphiques affichés sur le site actuel et moins bien servis dans la bêta (cachés ou non dessinés) : 0.


## Sections renommées (même contenu)

- `hs-prices-main` : « Tableau Day-Ahead » → « Toutes les zones · aujourd’hui »
- `hs-cc-main` : « Analyse multi-zones » → « Zones comparées »

## Résultat

**Zéro perte** : tout graphique, tableau, carte KPI, section, carte et réglage du site actuel est présent dans la bêta.

## Comment lire ce relevé

- Fichiers : `inventory_current.json` (site actuel) et `inventory_beta.json` (bêta), produits par
  `scripts/inventory_site.py` à 1 440 px, en français, sur la copie des données du commit `4fe157a1`
  (20 novembre 2026, 15:04 UTC) ; `zero_loss.json` détaille, pour chaque graphique, la vue où il se trouve avant et
  après, et sa taille.
- Une vue = une adresse du menu × un onglet de vue (sous-onglets des méthodes du pricer compris). Les sections repliées
  sont dépliées avant le relevé. Un élément est reconnu par son identifiant (`id`), sinon par sa page, son bloc et son
  libellé où les nombres sont remplacés par `#`.
- Deux sources vivantes peuvent fausser un passage : Open-Meteo, lu en direct par le navigateur et limité en débit
  (DJU, prévision d'un site, deux phrases d'Analyse de marché), et la page État des données, dont les tableaux se
  remplissent en plusieurs secondes. Si un passage en souffre, relever ces pages seules (`--only`) et donner les deux
  fichiers au comparateur, séparés par une virgule. Le passage enregistré ici n'en a pas eu besoin.
- Ce que le relevé ne couvre pas : les interactions à l'intérieur d'une vue (chaque zone d'une liste, chaque bouton de
  période, les fenêtres ouvertes par un clic). La bêta ne touche pas à ce code : elle ne change que le menu, la barre
  du haut, l'en-tête des pages, la hauteur de certains graphiques et l'ordre de quelques blocs d'Aujourd'hui.
- 23 graphiques ne sont affichés dans aucune vue, des deux côtés, dans ce bac à sable : ceux qui lisent Elia en direct
  (déséquilibre, 3), ceux de l'outil Empreinte carbone tant qu'aucun fichier n'est chargé (14), et 6 qui attendent un
  choix ou une donnée (zone seule du mix, courbe d'un actif dans le pricer, DJU par semaine, prévision des prix
  négatifs « en test »).
