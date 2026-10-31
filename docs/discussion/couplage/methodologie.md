# Le couplage européen a-t-il fait monter le prix de l'électricité en France ? Note de méthode

Période : 1er janvier 2020 – 29 octobre 2026 (2026 = janvier–octobre). Jours de livraison en heure de Paris.
Tous les chiffres viennent des scripts de ce dossier, qui se lancent dans cet ordre :
`fetch_cbet.py` → `build_data.py` → `states.py` (puis `states.py 1.0` pour la variante à 1 €) → `model.py` (puis
`PK_TRAIN=cut model.py` pour la variante) → `drivers.py` → `summary.py` → `flows.py` → `charts.py` → `deck.py`.
Il faut scikit-learn (`pip install scikit-learn`) et Playwright (Chromium) pour le PDF.
Résultats : `states.json`, `model_results.json`, `drivers.json`, `summary.json`. Sources : `sources.md`.

## 1. État de couplage, quart d'heure par quart d'heure

**Données.** Prix day-ahead ENTSO-E (France, Belgique, Allemagne-Luxembourg, Espagne, Italie Nord, Suisse ;
Grande-Bretagne : Elexon). Échanges commerciaux programmés par frontière : ENTSO-E via Energy-Charts (`cbet`).

**Règle.** Une frontière est couplée quand les deux prix sont égaux (écart < 0,01 €/MWh). C'est la définition de la
CRE : nos taux France–Allemagne (2021 49 %, 2022 34 %, 2023 29 %, 2024 14 %, 2025 11 %) retombent sur ceux de son
rapport de surveillance (49, 34, 29, 14, 10 %). Avec une tolérance de 1 €, le couplage complet monte de 7 à 9 points
(2025 : 17 % au lieu de 10 %). Le jeu de diapos précédent utilisait cette tolérance de 1 €.

**États** (voisins du couplage unique européen : Belgique, Allemagne, Espagne, Italie ; la Grande-Bretagne en 2020
seulement, elle en sort au 1er janvier 2021 ; la Suisse n'en a jamais fait partie) :
- *couplée avec Core* : même prix que la Belgique et l'Allemagne ;
- *couplée avec une partie des voisins* : même prix qu'au moins un voisin, mais pas les deux voisins Core. Depuis 2024,
  c'est presque toujours l'Espagne seule ;
- *coupée de tous, la moins chère* : prix différent de tous les voisins et plus bas que tous. La France exporte au
  maximum de ses limites ;
- *coupée de tous, la plus chère* : prix plus haut que tous. La France importe au maximum ;
- *coupée de tous, entre ses voisins* : prix différent de tous, ni le plus bas ni le plus haut (en 2025 : toujours sous l'Italie,
  au-dessus de l'Espagne 70 % du temps, sous l'Allemagne 58 % du temps). La France y exporte 98 % du temps en 2025.

**Pas de 15 minutes.** Depuis le 1er octobre 2025, l'enchère day-ahead fixe un prix par quart d'heure. Tout est donc
calculé au quart d'heure, chaque quart d'heure comptant pour 0,25 h. Avant cette date, une heure correspond à quatre
quarts d'heure identiques : le résultat est le même qu'en horaire. Le modèle de prix (§ 2) est horaire, car éCO2mix,
la limite JAO et la disponibilité nucléaire le sont. Il prend le prix moyen des quatre quarts d'heure. La rente de
congestion (§ 3) est calculée au quart d'heure.

## 2. Prix d'une France isolée (estimation, jamais observée)

**Idée.** À chaque heure, le prix français se trouve sur la courbe d'offre française, au volume que la France produit.
C'est une identité de l'enchère : les courbes de chaque zone se croisent au prix de la zone et à sa position nette.
C'est vrai quand la France est couplée. Quand elle est coupée, c'est la seule chose qui fixe son prix. Si on apprend
cette courbe, on peut la lire à un autre volume : celui d'une France qui n'exporte pas.

**Volume demandé aux moyens pilotables** (nucléaire, lacs, STEP, gaz, charbon, fioul), en MW, source RTE éCO2mix :

  RD = consommation + exports nets − éolien − solaire − fil de l'eau − bioénergies

Contrôle : RD est égal à la production pilotable observée, à 59 MW près en moyenne (écart-type 44 MW).

**Courbe apprise.** P = f(RD, nucléaire disponible, coût d'une centrale gaz, coût d'une centrale charbon, mois, heure,
week-end, éolien + solaire, année). Les arbres de gradient forcent f à monter avec RD et avec les coûts des
combustibles, et à baisser quand le nucléaire disponible augmente.
- Coût gaz = TTF ÷ 0,55 + 0,37 × EUA. Coût charbon = API2 ÷ 0,38 + 0,90 × EUA.
- Nucléaire disponible : ENTSO-E, valeur journalière.

**Bornes physiques**, que les arbres ne voient pas, appliquées ensuite :
- *minimum nucléaire et écrêtement* : en dessous de (nucléaire disponible × le plus bas taux d'utilisation de l'année,
  1er centile : 0,63 en 2024–2025) + gaz fatal (5e centile), le surplus doit être écrêté (éolien, solaire, ou tranches
  arrêtées). Le prix est alors la médiane des prix négatifs de l'année (≈ 0 €/MWh ; −6 € en 2020–2021). Variante :
  le 10e centile des prix négatifs (−18 à −36 €) ;
- *pénurie* : au-dessus de (nucléaire disponible + les records de l'année en lacs + STEP, gaz, charbon + fioul), il
  manque de l'énergie. Le prix est le plafond du marché : 3 000 €/MWh, puis 4 000 €/MWh à partir du 10 mai 2022. Ces
  heures sont comptées à part (§ 4).

**Validation.** Validation croisée en 12 blocs de mois entiers : chaque heure est prédite par un modèle qui ne l'a
jamais vue. L'erreur est donnée sur les heures **coupées**, où le prix réel est le merit order français seul, l'export
étant fixé par la limite du réseau. Dans les heures « coupée, la moins chère », la France exporte en médiane
75 % (2023), 85 % (2024), 92 % (2025) et 95 % (2026) de sa limite Core JAO augmentée de ses échanges hors Core.

| Année | Heures coupées | Prix réel moyen | Écart moyen absolu | Biais moyen (modèle − réel) |
|---|---|---|---|---|
| 2020 | 2 003 | 26 € | 9,6 € | +2,5 € |
| 2021 | 1 797 | 97 € | 19,5 € | +2,6 € |
| 2022 | 2 426 | 272 € | 50,2 € | +5,3 € |
| 2023 | 3 425 | 86 € | 17,1 € | +2,6 € |
| 2024 | 4 901 | 54 € | 14,9 € | +0,9 € |
| 2025 | 4 603 | 56 € | 17,2 € | +0,6 € |
| 2026 (janv.–oct.) | 3 665 | 82 € | 25,5 € | +8,1 € |

Une heure prise seule peut être fausse de 15 à 20 €/MWh. La moyenne d'une année est presque sans biais en 2024–2025.
Le biais est positif dans toutes les années : le modèle surestime un peu le prix d'une France seule. L'écart mesuré
« réel − isolé » est donc plutôt sous-estimé, surtout en 2026 (+8 €).

Par profondeur de surplus (heures coupées 2023–2026, RD ÷ nucléaire disponible) :

| Bande | Heures | Écart moyen absolu | Biais moyen | Prix réel moyen |
|---|---|---|---|---|
| < 0,6 | 82 | 24,7 € | −1,7 € | −24 € |
| 0,6–0,7 | 390 | 27,6 € | +4,6 € | −18 € |
| 0,7–0,8 | 966 | 17,9 € | +0,7 € | 5 € |
| 0,8–0,9 | 2 491 | 20,9 € | +6,6 € | 25 € |
| 0,9–1,0 | 4 543 | 19,2 € | +2,3 € | 59 € |
| > 1,0 | 8 122 | 16,6 € | +2,1 € | 97 € |

**Hors des données.** Une France isolée descend plus bas en volume que tout ce qu'on a observé : elle exportait
toujours en période de surplus. En 2024 et 2025, 12 à 13 % des heures isolées sont sous le plus bas volume pilotable
vu dans le même mois (26 % en 2026). Leur prix vient de la borne d'écrêtement, pas des données.

**Scénarios.**
- *France isolée* : exports nets = 0. RD_iso = RD − exports nets.
- *Exports fixés à la limite JAO* (France coupée 100 % du temps en exportatrice) : calculé, puis **écarté** des
  résultats. Dans les heures où la ligne avait de la place, le prix français était déjà égal à celui des voisins.
  Forcer plus d'exports pousserait le prix français au-dessus du leur, et aucun acheteur ne paierait ce prix : ce
  monde n'est pas cohérent. Le prix réel des heures « coupées » est déjà ce prix-là, observé là où la limite tient
  vraiment.

**Robustesse** (prix isolé moyen, hors pénurie, €/MWh) :

| Année | Principal | Plancher bas (10e centile des prix négatifs) | Garde le résidu de l'heure | Appris sur les seules heures coupées |
|---|---|---|---|---|
| 2024 | 19,4 | 13,7 | 19,2 | 20,0 |
| 2025 | 22,7 | 17,5 | 22,8 | 24,7 |
| 2026 | 37,9 | 26,3 | 38,6 | 36,5 |

## 3. Qui gagne, qui perd (€ par an)

Demande identique dans les deux mondes. Signe + = le couplage rapporte à ce groupe (ou lui coûte, pour les
consommateurs). Sommes horaires :

- **Consommateurs français** (surcoût dû au couplage) = Σ consommation × (P_réel − P_isolé)
- **Producteurs français** = Σ [P_réel × (consommation + exports nets) − P_isolé × consommation − A], où
  A = ∫ f(q) dq de RD_iso à RD_réel. A est le coût de production des exports, lu sur la courbe d'offre (8 pas,
  trapèzes). C'est un surplus « au prix des offres », comme le fait l'ACER, pas un coût comptable.
- **Rente de congestion** sur chaque frontière = Σ (P_voisin − P_France) × export commercial programmé vers ce voisin,
  au quart d'heure. On prend les **échanges commerciaux** (ENTSO-E, via Energy-Charts) et non les flux physiques : la
  rente se gagne sur les échanges vendus, et les flux physiques comptent des transits en boucle. La rente totale est
  partagée entre les deux gestionnaires de réseau (règle par défaut 50/50, décision ACER 16/2023).
- **Gain net de la France** = producteurs − consommateurs + ½ rente.

Le gain des voisins n'est **pas calculé** : il faudrait leurs propres courbes d'offre. On sait seulement qu'ils
achètent moins cher que chez eux, et que la rente côté voisin leur revient pour moitié.

## 3 bis. Les heures, et où va l'argent (`flows.py`, `flows.json`)

**Cas, heure par heure**, avec Δ = prix réel − prix isolé (modèle) :
- *le prix monte, France couplée* : Δ ≥ +5 €/MWh, la France a le prix d'au moins un voisin ;
- *le prix monte, France coupée* : Δ ≥ +5 €/MWh, prix différent de tous les voisins ;
- *pas d'effet sur le prix* : |Δ| < 5 €/MWh (une rente peut quand même être gagnée aux frontières) ;
- *le prix baisse* : Δ ≤ −5 €/MWh ;
- *pénurie évitée* : la France seule n'aurait pas couvert sa consommation.

Le seuil de 5 €/MWh sert à la lecture, ce n'est pas une précision : une heure du modèle peut être fausse de 15 à
20 €/MWh. La rente de chaque heure est la somme de ses quarts d'heure.

**Où va l'argent** (réel comparé à isolé, même consommation, hors heures de pénurie) :
- facture spot des consommateurs : Σ consommation × (P_réel − P_isolé) ;
- chiffre d'affaires de marché des producteurs, par filière : Σ P_réel × production_réelle − P_isolé × production_isolée.
  C'est égal (aux arrondis de bilan près) à la facture spot en plus + les exports valorisés au prix français ;
- acheteurs étrangers : exports valorisés au prix de chaque voisin = exports au prix français + rente de congestion.

Production d'une France isolée par filière :
- éolien, solaire, fil de l'eau et bioénergies comme observés, moins l'écrêtement nécessaire, pris sur l'éolien et
  le solaire ;
- la baisse due aux exports est répartie entre les centrales pilotables au prorata de leur production de l'heure ;
- aux heures d'import, le surcroît vient du nucléaire jusqu'à sa disponibilité, puis des lacs, STEP, gaz, charbon et
  fioul au prorata de leur marge.

À qui ça revient ensuite (non chiffré, décrit avec ses sources dans le jeu de diapos) :
- EDF, détenue à 100 % par l'État depuis juin 2023 ;
- l'ARENH jusqu'en 2025, puis le VNU ;
- le soutien public aux renouvelables sous contrat, qui baisse quand le prix de marché monte (CRE, charges de
  service public) ;
- la part de rente de RTE, dont l'excédent est déduit du TURPE.

## 4. Contrôles

- **Exports nets** 2025 : 93,1 TWh (éCO2mix, physique) ; 92,5 TWh (échanges commerciaux, somme des frontières) ;
  RTE : 92,3 TWh. Par frontière, en commercial : Italie 26,2 (RTE 26,2) ; Grande-Bretagne 22,6 (22,6) ;
  Suisse 20,2 (20,1) ; Belgique + Allemagne 23,3 (23,1) ; Espagne 0,2 (0,2).
- **Valeur des exports** 2025 : 5,51 Md€ au prix français (RTE : 5,4 Md€, au même prix) ; 9,96 Md€ au prix des
  pays acheteurs (RTE : « de l'ordre de 9 Md€ »). 2024 : 5,19 Md€ (RTE : « 5 milliards »).
- **Rente** : notre rente day-ahead sur les frontières UE (Espagne, Italie, Belgique, Allemagne), moitié française :
  0,72 Md€ en 2023, 1,11 en 2024, 1,36 en 2025. La CRE publie les recettes brutes de RTE sur ces frontières : 1,94,
  1,59 et 2,05 Md€. Ce total inclut les enchères de capacité de long terme. En 2025, RTE en a reversé 0,80 Md€ aux
  détenteurs de droits de long terme. Les périmètres diffèrent : l'ordre de grandeur concorde, pas le montant exact.
- **Heures de pénurie** de la France isolée (dispatchable insuffisant) : 11 h en 2020, 65 h en 2021, 89 h en 2022,
  38 h en 2023, 15 h en 2026. Ce sont des vagues de froid (janvier 2021, fin 2021, 4 avril 2022, décembre 2022,
  janvier–mars 2023, 5–6 janvier 2026), avec jusqu'à 7,5 GW manquants. On les met à part : leur prix (le plafond) est une
  convention, et à 4 000 €/MWh elles pèseraient plus que tout le reste de l'année. Ce sont des heures où les imports
  ont couvert un manque. Les moyens d'urgence de RTE (interruptibilité, baisse de tension) n'entrent pas dans le
  modèle : dire qu'il y aurait eu ces coupures serait aller trop loin.

## 5. Limites

1. Le prix isolé est une **estimation**. Une heure seule peut être fausse de 15–20 €/MWh. La moyenne annuelle est
   fiable à quelques €/MWh en 2024–2025, beaucoup moins en 2022 (erreur de 50 €/MWh par heure).
2. **Court terme** : parc, disponibilité nucléaire et stocks d'eau restent ceux observés. À long terme, deux effets
   jouent en sens contraire. Une France isolée et en surplus aurait arrêté plus de tranches, ce qui monte le prix
   isolé. Ses offres ne contiendraient plus les coûts d'opportunité européens (valeur de l'eau, du combustible),
   ce qui le baisse. **Le sens net est inconnu.** (Une version précédente de cette note disait à tort que les deux
   effets baissaient le prix isolé.)
3. Demande fixe (aucune réaction au prix). Les heures de pénurie sont comptées à part.
4. Surplus « au prix des offres » : des offres négatives d'éolien et de solaire sous contrat de soutien comptent
   comme des coûts.
5. Rente : day-ahead seulement, partage 50/50 par défaut. Avec la Grande-Bretagne et la Suisse, la capacité est
   vendue aux enchères explicites, et la rente va en partie à des tiers (ElecLink, détenteurs de capacité).
6. Gain des voisins non chiffré. Part des recettes des producteurs qui revient à l'État (dividendes, impôts,
   soutien public évité) non chiffrée.
7. Aucune étude publiée trouvée qui chiffre l'effet du couplage sur le prix français ou son partage : les montants
   de ce dossier ne peuvent pas être recoupés. Le sens de l'effet, lui, est appuyé par la théorie du commerce et par la
   CRE (rapport sur les interconnexions 2024, p. 41).
