# Preuve zéro perte : site actuel → bêta

Relevé du site actuel : 100 vues (2026-11-20 20:57 UTC). Relevé de la bêta : 101 vues (2026-11-20 20:57 UTC).

| Élément | Site actuel | Retrouvés dans la bêta | Manquants | En plus dans la bêta |
|---|---|---|---|---|
| graphiques | 253 | 253 | 0 | 0 |
| tableaux | 86 | 86 | 0 | 1 |
| cartes KPI | 296 | 296 | 0 | 4 |
| sections | 117 | 117 | 0 | 0 |
| cartes | 1 | 1 | 0 | 0 |
| schémas | 4 | 4 | 0 | 0 |
| réglages | 201 | 201 | 0 | 1 |
| blocs de texte | 1275 | 1275 | 0 | 101 |

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
- Dans la bêta, trois vues ont été relevées une seconde fois, seules, puis fusionnées : État des données (2 onglets),
  dont les tableaux n'avaient pas fini de se remplir au premier passage, et Analyse de marché, où Open-Meteo avait
  refusé un appel (429) : deux phrases y perdaient la vitesse du vent.
- Ce que le relevé ne couvre pas : les interactions à l'intérieur d'une vue (chaque zone d'une liste, chaque bouton de
  période, les fenêtres ouvertes par un clic). La bêta ne touche pas à ce code : elle ne change que le menu, la barre
  du haut, l'en-tête des pages, la hauteur de certains graphiques et l'ordre de quelques blocs d'Aujourd'hui.
- Graphiques jamais dessinés dans ce bac à sable, des deux côtés : ceux qui lisent Elia en direct (déséquilibre) et
  ceux de l'outil Empreinte carbone tant qu'aucun fichier n'est chargé.
