# Banc d'essai PPA : 6 approches rejouées sur des périodes de livraison

Note du 27 novembre 2026. Branche `fable/ppa-bench`. Rien n'est branché sur le site : c'est un banc d'essai.
Tout se régénère avec `python scripts/ppa_bench.py --md` (18 secondes). Données : `data/history/ppa_bench.json`.

## En bref

- Contrat testé : PPA court à prix fixe, solaire et éolien France (parc national), centrale arrêtée quand le prix est négatif.
- 61 livraisons rejouées par techno (6, 12 et 20 mois, départ à chaque trimestre depuis 2019), dont 55 ne sont pas des années civiles. Exemple : avril N à novembre N+1.
- Aucune approche seule ne tient la rupture de 2024. Toutes celles qui construisent une courbe sont trop optimistes sur le solaire (+2,4 à +4,8 EUR/MWh de biais).
- Le Monte Carlo météo corrigé reste le moins bon (solaire MAE 5,1, éolien 3,0), malgré des heures négatives enfin produites.
- Hybride proposé (choisi sur les livraisons finies avant 2024, vérifié après) : MAE 1,8 EUR/MWh solaire, 1,7 éolien, contre 2,8 et 1,9 pour la meilleure approche seule.
- Les bandes issues des tirages Monte Carlo sont trop étroites : le réalisé tombe dans leur P10-P90 dans 16 à 48 % des cas au lieu de 80 %.
- Bande proposée : quantiles des erreurs réelles de l'hybride depuis 2023. Elle n'est pas symétrique : le risque est du côté d'un prix trop haut.

## 1. Ce qui existait déjà (audit)

- `scripts/ppa_backtest.py`, `ppa_backtest_detail.py` : approches 1 (PPA Dashboard), 2 (Step by step), 3 (FPC) et un Monte Carlo météo, par année civile. Le Monte Carlo y est planché à zéro : aucun prix négatif.
- `scripts/ppa_lab.py` : banc "six approches" par année civile. Son approche 4 est un modèle de prix régional (pas une FPC), sa 6 est la FPC avec un simple écart-type autour (même médiane, pas de tirages).
- `scripts/ppa_fpc_variants.py`, `ppa_fpc_neg_test.py`, `ppa_fpc_driver_test.py` : réglages de la FPC (squelette récent, terme par saison, parc solaire comme moteur). Repris tels quels.
- `scripts/ppa_historical_bootstrap.py` : bootstrap de semaines réelles sans modèle de prix. Conclusion déjà écrite : inutilisable seul.
- `scripts/ppa_walkforward.py`, `ppa_horizon_test.py`, `ppa_mc_stability.py` : walk-forward par année civile, horizons 1 à 3 ans, stabilité des tirages.
- `scripts/ppa_error_replay.py` : à corriger dans le brief, une méthode a déjà été rejouée hors années civiles. C'est le générateur de scénarios du site (`ppa_scenarios.py`), sur des livraisons de 12 mois glissants. Il n'est pas dans ce banc (trop lourd, hors des 6 approches).
- `js/ppa-fpc.js`, `js/tool-ppa.js` : la FPC et le pricer du site. Non modifiés. `tests/test_ppa_frozen.py` passe.
- Manquaient donc : la FPC avec cannibalisation dans la courbe horaire (4), le Monte Carlo météo corrigé (5), la FPC avec projection simulée (6), les périodes non civiles, la grille commune avec erreur de forme horaire et la distribution complète des erreurs.

## 2. Ce qui a été ajouté

- `scripts/ppa_bench.py` : les 6 approches, l'hybride et l'évaluation commune.
- `scripts/ppa_backtest.py` : `load()` accepte une liste d'années (pour lire 2026). Comportement par défaut inchangé.
- Principe : les formules existantes sont réécrites sur des "pseudo-années" = blocs de 12 mois finissant à la date de pricing. Pour une livraison qui commence en janvier, on retombe sur les chiffres de `ppa_backtest_detail.py` (`--check` : écart maximal 0,2 point).
- Sans regard vers l'avant : seules les heures avant la date de pricing sont lues. Parcs installés : fins d'année connues à cette date, puis prolongés au dernier rythme annuel.
- 2022 : bloc d'apprentissage écarté s'il est à moitié en 2022, livraison non notée si elle touche 2022 (comme les bancs existants).
- Niveau de prix : le baseload mensuel réalisé remplace la courbe forward. Le banc mesure donc l'erreur de capture, pas l'erreur de forward.

Les approches :

- **1 dash** (référence) : 1 - P74 des décotes passées. `dash` dans sa convention d'origine, `dash_curt` dans celle du contrat.
- **2 step** (référence) : capture contre ln(GW installés), ancrée sur le dernier bloc.
- **3 fpc** : FPC classique, réglages du site. `fpc_plain` = version de base (terme annuel, parc propre, squelette simple).
- **4 fpc_inj** : chaque case de la courbe (mois x type de jour x heure) porte 3 chiffres : prix moyen, moyenne de la partie positive du prix, probabilité d'un prix >= 0. Chacun est déplacé vers le parc de la livraison par une pente sur ln(GW solaires). La courbe se creuse donc avec le parc et donne le volume arrêté. Seule la covariance météo restante est ajoutée après.
- **5 wx_mc** : blocs de 7 jours réels tirés dans la même saison (forme horaire de la production et consommation des mêmes jours, donc saisonnalité et autocorrélation conservées). Prix tiré dans la distribution des prix récents à ce niveau de charge résiduelle, prolongée sous la charge la plus basse observée. Les prix négatifs apparaissent.
- **6 fpc_mc** : FPC dont la projection est tirée 2000 fois : pente, surprise d'une année sur l'autre, rythme du parc, année météo du profil. Sortie : une distribution de la décote future.

## 3. Convention des heures négatives

- Convention retenue (celle du dépôt depuis le 1er novembre) : arrêt strictement sous 0 EUR/MWh. Les heures négatives restent dans le baseload.
- Fait connu confirmé : la convention PPA Dashboard (heures <= 0 retirées de la capture ET du baseload) sous-estime de 6,8 points le solaire 2025, mais seulement face à un contrat qui s'arrête aussi à 0 EUR/MWh (76,8 contre 70,0).
- Face à un arrêt strictement sous 0, l'écart sur le solaire disparaît (69,4 contre 70,0). Sur l'éolien il reste 5,7 points (92,3 contre 86,6).
- Point à trancher avec le contrat : arrêt à "< 0" ou à "<= 0". En 2025, 226 heures sont à exactement 0 EUR/MWh : 7,4 points de capture solaire entre les deux clauses.
- Avec arrêt à 0 inclus (`--thr 0.001`), le classement ne change pas : hybride MAE 1,5 solaire et 1,5 éolien.

**Realise par annee et par convention (taux de capture, % du baseload)**

| annee | h < 0 | h <= 0 | solaire: tout paye | arret < 0 | arret <= 0 | PPA Dashboard | eolien: tout paye | arret < 0 | arret <= 0 | PPA Dashboard |
|---|---|---|---|---|---|---|---|---|---|---|
| 2016 | 2 | 2 | 95.6 | 95.7 | 95.7 | 95.6 | 93.4 | 93.4 | 93.4 | 93.4 |
| 2017 | 4 | 4 | 91.4 | 91.6 | 91.6 | 91.5 | 98.5 | 98.6 | 98.6 | 98.6 |
| 2018 | 11 | 12 | 101.6 | 101.7 | 101.8 | 101.6 | 95.4 | 95.8 | 95.8 | 95.6 |
| 2019 | 27 | 28 | 95.2 | 96.0 | 96.1 | 95.7 | 94.5 | 95.1 | 95.1 | 94.7 |
| 2020 | 102 | 105 | 93.2 | 96.3 | 96.5 | 94.9 | 93.5 | 95.5 | 95.5 | 94.0 |
| 2021 | 64 | 66 | 87.1 | 88.8 | 88.8 | 88.1 | 94.0 | 95.0 | 95.0 | 94.2 |
| 2022 | 4 | 8 | 104.6 | 104.6 | 104.7 | 104.6 | 83.7 | 83.8 | 83.9 | 83.8 |
| 2023 | 147 | 184 | 84.6 | 87.7 | 88.4 | 86.4 | 89.1 | 90.7 | 91.3 | 89.3 |
| 2024 | 352 | 549 | 64.8 | 74.7 | 79.5 | 74.0 | 89.3 | 92.6 | 96.1 | 89.5 |
| 2025 | 501 | 727 | 56.1 | 69.4 | 76.8 | 70.0 | 88.9 | 92.3 | 95.1 | 86.6 |
| 2026 (au 2026-11-26) | 518 | 692 | 54.5 | 70.1 | 75.9 | 68.6 | 89.8 | 93.8 | 96.4 | 87.2 |

## 4. Résultats

- Erreur = prix prévu moins prix réalisé d'un MWh produit, en EUR/MWh. Positif = méthode trop optimiste.
- Biais, MAE, P10, P50, P90 : sur l'erreur de la livraison entière. MAE trim. et MAE mois : erreur moyenne par trimestre et par mois de livraison.
- Forme horaire : écart moyen entre la courbe horaire prévue et réalisée, en % du baseload du mois, pondéré par la production.
- Part payée : écart en points sur la part de production vendue à prix >= 0 (positif = pas assez d'arrêts prévus).

**solar, toutes livraisons (n = 61)**

| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dash | +1.83 | 4.64 | -3.9 | +2.2 | +8.6 | 4.83 | 6.33 |  |  |  |  |
| dash_curt | +2.08 | 4.72 | -3.6 | +2.4 | +9.4 | 4.89 | 6.32 |  |  |  |  |
| step | -1.23 | 2.92 | -5.2 | -1.1 | +3.4 | 4.07 | 6.01 |  |  |  |  |
| step_curt | -0.75 | 2.81 | -4.2 | -0.7 | +4.4 | 3.93 | 5.87 |  |  |  |  |
| fpc_plain | +3.40 | 3.45 | -0.0 | +3.3 | +7.1 | 3.70 | 4.22 | 22.8 | +7.3 | 6 / 253 |  |
| fpc | +2.48 | 2.87 | -0.3 | +2.7 | +5.9 | 3.45 | 3.77 | 15.9 | +6.0 | 33 / 253 |  |
| fpc_inj | +2.52 | 2.90 | -0.6 | +2.7 | +6.2 | 3.41 | 3.90 | 12.3 | +2.7 | 153 / 253 |  |
| wx_mc | +4.79 | 5.14 | +0.1 | +5.8 | +9.5 | 5.60 | 5.60 | 13.2 | -2.3 | 340 / 253 | 16 % |
| fpc_mc | +2.38 | 2.83 | -0.4 | +2.5 | +5.9 | 3.41 | 3.77 | 15.9 | +6.0 | 33 / 253 | 34 % |
| hybrid | +0.82 | 1.84 | -1.4 | +0.2 | +5.2 | 2.51 | 3.98 | 12.3 | +2.7 | 153 / 253 |  |

**wind, toutes livraisons (n = 61)**

| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dash | +1.64 | 2.39 | -0.3 | +1.0 | +4.7 | 3.20 | 3.73 |  |  |  |  |
| dash_curt | +2.13 | 2.65 | -0.1 | +1.3 | +5.4 | 3.38 | 3.83 |  |  |  |  |
| step | +0.52 | 2.40 | -2.0 | +0.4 | +5.0 | 3.31 | 4.01 |  |  |  |  |
| step_curt | +1.82 | 2.76 | -1.4 | +0.8 | +5.9 | 3.57 | 4.11 |  |  |  |  |
| fpc_plain | +0.16 | 2.11 | -3.4 | +0.6 | +2.9 | 2.89 | 3.81 | 13.1 | +2.3 | 6 / 253 |  |
| fpc | +0.30 | 2.00 | -4.2 | +0.7 | +2.3 | 2.76 | 3.61 | 13.1 | +2.3 | 6 / 253 |  |
| fpc_inj | -0.24 | 1.95 | -3.1 | -0.4 | +3.6 | 3.00 | 4.04 | 8.9 | +0.5 | 153 / 253 |  |
| wx_mc | +2.94 | 2.98 | -0.0 | +2.3 | +6.5 | 3.44 | 4.00 | 10.9 | -3.1 | 340 / 253 | 41 % |
| fpc_mc | +0.15 | 1.90 | -4.4 | +0.6 | +2.1 | 2.70 | 3.60 | 13.1 | +2.3 | 6 / 253 | 48 % |
| hybrid | +0.95 | 1.69 | -1.7 | +0.3 | +4.0 | 2.63 | 3.39 | 8.9 | +0.5 | 153 / 253 |  |

**Avant / apres la rupture (livraisons finies avant 2024, puis les autres), MAE et biais en EUR/MWh**

| methode | solaire avant | solaire apres | eolien avant | eolien apres |
|---|---|---|---|---|
| dash | 3.12 (-2.43), n=30 | 6.11 (+5.94), n=31 | 0.80 (+0.66), n=30 | 3.94 (+2.58), n=31 |
| dash_curt | 3.01 (-2.22), n=30 | 6.37 (+6.23), n=31 | 1.02 (+0.93), n=30 | 4.23 (+3.29), n=31 |
| step | 2.14 (-1.40), n=30 | 3.67 (-1.06), n=31 | 1.59 (+0.21), n=30 | 3.19 (+0.83), n=31 |
| step_curt | 1.80 (-0.93), n=30 | 3.80 (-0.58), n=31 | 1.73 (+0.72), n=30 | 3.75 (+2.88), n=31 |
| fpc_plain | 1.52 (+1.41), n=30 | 5.32 (+5.32), n=31 | 1.02 (+0.82), n=30 | 3.18 (-0.47), n=31 |
| fpc | 1.26 (+1.14), n=30 | 4.43 (+3.78), n=31 | 1.01 (+1.01), n=30 | 2.96 (-0.38), n=31 |
| fpc_inj | 1.37 (+0.79), n=30 | 4.39 (+4.19), n=31 | 1.10 (-0.23), n=30 | 2.79 (-0.25), n=31 |
| wx_mc | 2.36 (+2.32), n=30 | 7.83 (+7.18), n=31 | 1.00 (+0.95), n=30 | 4.89 (+4.87), n=31 |
| fpc_mc | 1.26 (+1.06), n=30 | 4.35 (+3.66), n=31 | 0.86 (+0.80), n=30 | 2.91 (-0.48), n=31 |
| hybrid | 0.84 (+0.07), n=30 | 2.80 (+1.54), n=31 | 0.68 (+0.50), n=30 | 2.67 (+1.38), n=31 |

**Erreur mensuelle par saison (MAE EUR/MWh, toutes livraisons)**

| methode | solaire ete | solaire hiver | eolien ete | eolien hiver |
|---|---|---|---|---|
| dash | 5.50 (+3.28) | 7.20 (-2.79) | 3.34 (-1.13) | 4.15 (+3.40) |
| dash_curt | 5.59 (+3.48) | 7.09 (-2.52) | 3.25 (-0.78) | 4.44 (+3.93) |
| step | 3.40 (+1.07) | 8.77 (-6.54) | 4.00 (-1.93) | 4.01 (+1.95) |
| step_curt | 3.45 (+1.49) | 8.42 (-5.92) | 3.70 (-0.99) | 4.54 (+3.32) |
| fpc_plain | 4.37 (+3.76) | 4.07 (+1.63) | 3.83 (-2.22) | 3.79 (+1.62) |
| fpc | 3.51 (+2.03) | 4.04 (+2.93) | 3.43 (-0.39) | 3.79 (+0.54) |
| fpc_inj | 3.65 (+2.79) | 4.16 (+1.37) | 4.07 (-1.61) | 4.01 (+0.49) |
| wx_mc | 5.02 (+4.07) | 6.21 (+6.11) | 3.42 (+2.23) | 4.61 (+3.46) |
| fpc_mc | 3.47 (+1.93) | 4.08 (+2.85) | 3.45 (-0.65) | 3.76 (+0.46) |
| hybrid | 3.17 (+1.71) | 4.85 (-1.53) | 3.25 (-0.01) | 3.54 (+1.47) |

## 5. Où chaque méthode casse

- **dash** : aucune tendance. Bon avant 2024 sur l'éolien (0,8), très mauvais après sur le solaire (+5,9 de biais). Pire méthode au mois (6,3).
- **step** : seule méthode sans biais optimiste sur le solaire, car elle repart du dernier niveau réalisé. Mais un seul chiffre par an : erreur mensuelle 5,9, hiver solaire sous-estimé de 5,9. Instable hors année civile sur l'éolien (P90 à +5,9).
- **fpc** : bonne forme mensuelle, mais la cannibalisation ajoutée après coup ne creuse pas la courbe. Forme horaire fausse de 16 % (solaire), 33 heures négatives prévues contre 253 réelles, part payée surestimée de 6 points. Biais +3,8 après 2024.
- **fpc_inj** : meilleure forme horaire (12,3 % solaire, 8,9 % éolien) et meilleur volume arrêté parmi les méthodes sans tirages. Meilleure méthode seule sur l'éolien en année civile (0,64). Mais la pente sur ln(GW) reste trop lente quand les heures négatives doublent en un an : biais solaire +4,2 après 2024.
- **wx_mc** : produit enfin des prix négatifs, et même trop (340 heures contre 253). Mais la règle de prix, apprise sur la charge résiduelle française des deux derniers blocs, lie trop peu le prix au vent et au soleil : capture trop haute partout (+7,2 solaire, +4,9 éolien après 2024). Sa bande ne couvre que 16 à 41 %.
- **fpc_mc** : même centre que la FPC (erreur quasi identique). Sa distribution est la plus honnête des deux Monte Carlo, mais reste trop étroite (34 % solaire, 48 % éolien au lieu de 80 %).
- **Toutes** : les erreurs triplent après la rupture de 2024. Un horizon plus long coûte cher : pricé 6 mois avant le début (`--lead 6`), l'hybride passe à 3,4 (solaire) et 2,1 (éolien).
- **Périodes non civiles** : l'année civile flatte les méthodes. Hybride solaire : MAE 0,98 en année civile (6 cas), 1,57 sur 12 mois non civils, 1,94 sur 6 mois, 2,29 sur 20 mois (biais +2,0). Éolien : 1,5 à 1,8 partout. Les 6 mois ont les queues les plus larges (P10 à -3,4 sur le solaire).

## 6. Méthode hybride proposée

- Règle de choix : la combinaison à poids égaux qui a la plus faible erreur sur les 30 livraisons finies avant 2024. Vérifiée sur les 31 suivantes, jamais utilisées pour choisir.
- **Solaire : moyenne de step_curt et fpc_mc.** Le premier ancre le niveau sur le dernier réalisé (biais négatif), le second apporte la forme mensuelle (biais positif). Leurs erreurs se compensent.
- **Éolien : moyenne de fpc_inj, wx_mc et fpc_mc.**
- **Courbe horaire et volume arrêté : ceux de fpc_inj**, pour les deux technos.
- Résultat après 2024 : solaire 2,80 (meilleure approche seule : 3,67), éolien 2,67 (meilleure seule : 2,79). C'est aussi la meilleure combinaison a posteriori sur l'éolien, et à 0,02 près sur le solaire.
- Limite : l'hybride garde un biais optimiste après 2024 (+1,5 solaire, +1,4 éolien). La bande ci-dessous le corrige.

## 7. Bande calibrée

- Construction : erreurs de l'hybride en points de capture (prévu moins réalisé).
- Prix au quantile q = (capture centrale - erreur q) x forward.
- Bande walk-forward (quantiles des seules livraisons déjà finies à la date de pricing) : elle ne tient pas. Le réalisé tombe dans le P10-P90 dans 52 % (solaire) et 39 % (éolien) des cas. Il faut l'élargir 3 fois pour atteindre 80 %.
- Raison : les erreurs d'avant 2024 sont trop petites pour décrire le régime actuel.
- Proposition : quantiles sur les livraisons démarrées depuis 2023 (35 par techno). Les probabilités sont des fréquences observées, mais sur l'échantillon lui-même.

**Bande (erreurs de la methode hybride, points de capture)**

| techno | n (walk-forward) | realise dans P10-P90 | dans P25-P75 | prix P75 tenu | prix P90 tenu | largeur P10-P90 EUR/MWh | facteur pour 80 % | largeur elargie | q10 / q25 / q50 / q75 / q90, toutes | idem, livraisons depuis 2023 |
|---|---|---|---|---|---|---|---|---|---|---|
| solar | 46 | 52 % | 26 % | 39 % | 65 % | 4.4 | x 3.0 | 13.2 | -3.5 / -1.3 / +1.2 / +4.2 / +9.5 (n=61) | -3.5 / -0.1 / +3.6 / +7.6 / +11.2 (n=35) |
| wind | 46 | 39 % | 26 % | 52 % | 63 % | 2.7 | x 3.0 | 8.1 | -2.0 / -0.7 / +0.6 / +2.5 / +6.1 (n=61) | -3.0 / -1.0 / +1.9 / +4.1 / +7.1 (n=35) |

| techno | duree | n | q10 | q25 | q50 | q75 | q90 |
|---|---|---|---|---|---|---|---|
| solar | 6 mois | 14 | -4.7 | -2.7 | -0.1 | +6.1 | +8.1 |
| solar | 12 mois | 12 | -0.0 | +1.1 | +2.8 | +7.2 | +9.4 |
| solar | 20 mois | 9 | +2.3 | +3.6 | +4.2 | +11.6 | +12.2 |
| wind | 6 mois | 14 | -4.8 | -2.6 | -0.1 | +5.8 | +7.1 |
| wind | 12 mois | 12 | -2.6 | +0.6 | +2.0 | +3.7 | +6.0 |
| wind | 20 mois | 9 | -0.4 | +0.8 | +2.5 | +3.6 | +5.8 |

Lecture pour une livraison de 12 mois, forward à 60 EUR/MWh :

| | haut (10 %) | médian | prudent (tenu 3 fois sur 4) | bas (tenu 9 fois sur 10) |
|---|---|---|---|---|
| solaire, points à retirer de la capture centrale | 0,0 | 2,8 | 7,2 | 9,4 |
| solaire, EUR/MWh à retirer | 0,0 | 1,7 | 4,3 | 5,6 |
| éolien, points | -2,6 | 2,0 | 3,7 | 6,0 |
| éolien, EUR/MWh | -1,6 | 1,2 | 2,2 | 3,6 |

## 8. Réserves

- Livraisons qui se chevauchent : 61 livraisons, mais environ 6 années indépendantes. Les quantiles depuis 2023 reposent sur moins de 4 ans.
- Bande finale calculée sur l'échantillon lui-même. Le test walk-forward montre qu'une bande du passé a été 3 fois trop étroite pendant la rupture.
- Les trois corrections de wx_mc (groupes par mois, plancher des prix négatifs, lien du prix aux facteurs de charge) ont été regardées sur toutes les livraisons de 12 mois. Aucune ne change son rang.
- La forme de la bande (points de capture plutôt qu'erreur relative) a été choisie après essai de plusieurs variantes.
- Forward remplacé par le baseload réalisé : l'erreur de forward n'est pas mesurée.
- Parc national, données horaires. Pas d'actif précis, pas de quart d'heure, pas de coût d'écart.
- Pricing au premier jour de livraison dans le tableau principal. À 6 mois d'avance, l'erreur de l'hybride monte de 26 % (éolien) et 86 % (solaire).
- Le générateur de scénarios du site n'est pas comparé ici. À faire avant toute décision sur le prix publié.

## Annexe : tableaux par famille de livraison

**solar, annees civiles (n = 6)**

| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dash | +0.63 | 3.95 | -3.8 | -0.1 | +5.8 | 4.34 | 6.01 |  |  |  |  |
| dash_curt | +0.89 | 3.98 | -3.5 | +0.1 | +6.1 | 4.34 | 5.94 |  |  |  |  |
| step | -1.88 | 2.54 | -4.9 | -1.8 | +1.0 | 4.28 | 5.88 |  |  |  |  |
| step_curt | -1.17 | 2.11 | -3.5 | -1.5 | +1.4 | 3.77 | 5.46 |  |  |  |  |
| fpc_plain | +3.15 | 3.24 | -0.0 | +3.6 | +5.9 | 3.03 | 3.78 | 18.9 | +5.5 | 5 / 199 |  |
| fpc | +2.53 | 2.62 | -0.0 | +3.3 | +4.4 | 2.91 | 3.35 | 13.6 | +4.7 | 25 / 199 |  |
| fpc_inj | +2.15 | 2.30 | +0.2 | +2.1 | +4.2 | 2.86 | 3.40 | 10.0 | +2.1 | 131 / 199 |  |
| wx_mc | +4.67 | 4.67 | +0.2 | +5.6 | +8.2 | 4.90 | 5.05 | 11.1 | -2.1 | 295 / 199 | 17 % |
| fpc_mc | +2.41 | 2.54 | -0.1 | +3.1 | +4.2 | 2.85 | 3.34 | 13.6 | +4.7 | 25 / 199 | 0 % |
| hybrid | +0.62 | 0.98 | -0.5 | +0.4 | +2.0 | 1.74 | 3.46 | 10.0 | +2.1 | 131 / 199 |  |

**solar, 12 mois non civils (n = 15)**

| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dash | +2.26 | 4.71 | -3.2 | +3.9 | +8.7 | 4.86 | 6.38 |  |  |  |  |
| dash_curt | +2.47 | 4.82 | -3.1 | +4.1 | +8.9 | 4.91 | 6.39 |  |  |  |  |
| step | -0.78 | 2.28 | -4.1 | -1.0 | +3.5 | 3.83 | 5.97 |  |  |  |  |
| step_curt | -0.38 | 2.26 | -3.8 | -0.5 | +4.1 | 3.76 | 5.85 |  |  |  |  |
| fpc_plain | +3.70 | 3.78 | -0.1 | +4.4 | +7.0 | 3.78 | 4.28 | 24.4 | +8.2 | 8 / 278 |  |
| fpc | +2.19 | 2.50 | -0.3 | +2.4 | +4.5 | 3.27 | 3.65 | 16.2 | +6.5 | 46 / 278 |  |
| fpc_inj | +2.55 | 2.84 | -0.5 | +2.8 | +5.3 | 3.35 | 3.89 | 12.9 | +2.6 | 189 / 278 |  |
| wx_mc | +4.70 | 4.81 | +0.3 | +7.0 | +8.9 | 5.39 | 5.44 | 14.1 | -2.6 | 386 / 278 | 20 % |
| fpc_mc | +2.09 | 2.46 | -0.3 | +2.3 | +4.6 | 3.19 | 3.64 | 16.2 | +6.5 | 46 / 278 | 60 % |
| hybrid | +0.86 | 1.57 | -1.2 | +0.2 | +4.4 | 2.51 | 3.97 | 12.9 | +2.6 | 189 / 278 |  |

**solar, 20 mois (n = 15)**

| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dash | +2.58 | 4.79 | -3.1 | +3.4 | +8.2 | 4.82 | 6.17 |  |  |  |  |
| dash_curt | +2.75 | 4.93 | -3.0 | +3.6 | +8.4 | 4.92 | 6.20 |  |  |  |  |
| step | +0.18 | 2.85 | -3.0 | -0.8 | +4.7 | 4.01 | 5.89 |  |  |  |  |
| step_curt | +0.69 | 2.82 | -2.6 | -0.5 | +5.3 | 3.97 | 5.82 |  |  |  |  |
| fpc_plain | +4.01 | 4.02 | +0.1 | +5.9 | +7.2 | 3.95 | 4.34 | 25.8 | +8.2 | 9 / 455 |  |
| fpc | +3.44 | 3.46 | +0.0 | +4.4 | +6.4 | 3.81 | 3.99 | 20.2 | +7.4 | 38 / 455 |  |
| fpc_inj | +3.42 | 3.58 | -0.3 | +3.7 | +7.1 | 3.78 | 4.09 | 15.3 | +4.6 | 222 / 455 |  |
| wx_mc | +5.82 | 5.82 | +0.3 | +8.3 | +10.4 | 6.01 | 5.86 | 16.0 | -1.1 | 571 / 455 | 13 % |
| fpc_mc | +3.36 | 3.43 | -0.1 | +4.3 | +6.5 | 3.80 | 4.01 | 20.2 | +7.4 | 38 / 455 | 33 % |
| hybrid | +2.02 | 2.29 | -0.4 | +1.2 | +6.1 | 2.81 | 4.12 | 15.3 | +4.6 | 222 / 455 |  |

**solar, 6 mois (n = 25)**

| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dash | +1.40 | 4.67 | -4.1 | -0.2 | +9.7 | 5.06 | 6.71 |  |  |  |  |
| dash_curt | +1.72 | 4.71 | -3.8 | +0.2 | +10.1 | 5.07 | 6.64 |  |  |  |  |
| step | -2.18 | 3.42 | -6.0 | -1.7 | +1.9 | 4.37 | 6.35 |  |  |  |  |
| step_curt | -1.74 | 3.31 | -5.9 | -1.6 | +2.2 | 4.12 | 6.18 |  |  |  |  |
| fpc_plain | +2.91 | 2.97 | -0.1 | +2.1 | +7.2 | 3.40 | 4.14 | 20.9 | +6.7 | 4 / 130 |  |
| fpc | +2.07 | 2.80 | -0.5 | +2.2 | +5.7 | 3.16 | 3.65 | 13.7 | +5.2 | 23 / 130 |  |
| fpc_inj | +2.05 | 2.68 | -0.9 | +1.7 | +6.0 | 2.94 | 3.76 | 10.7 | +1.8 | 95 / 130 |  |
| wx_mc | +4.26 | 5.04 | -0.1 | +4.4 | +9.6 | 5.34 | 5.54 | 11.6 | -2.9 | 184 / 130 | 16 % |
| fpc_mc | +1.96 | 2.76 | -0.6 | +2.2 | +5.6 | 3.09 | 3.65 | 13.7 | +5.2 | 23 / 130 | 28 % |
| hybrid | +0.11 | 1.94 | -3.4 | -0.4 | +3.7 | 2.25 | 3.98 | 10.7 | +1.8 | 95 / 130 |  |

**wind, annees civiles (n = 6)**

| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dash | +2.31 | 2.31 | +0.2 | +2.5 | +4.3 | 2.97 | 3.73 |  |  |  |  |
| dash_curt | +2.81 | 2.81 | +0.2 | +3.3 | +4.9 | 3.23 | 3.86 |  |  |  |  |
| step | +1.46 | 1.46 | +0.6 | +1.2 | +2.6 | 2.38 | 3.54 |  |  |  |  |
| step_curt | +2.54 | 2.54 | +0.8 | +2.7 | +4.2 | 2.94 | 3.72 |  |  |  |  |
| fpc_plain | +1.29 | 1.52 | -0.1 | +1.7 | +2.3 | 2.32 | 3.70 | 10.6 | +1.8 | 5 / 199 |  |
| fpc | +1.17 | 1.49 | -0.3 | +1.7 | +2.1 | 2.20 | 3.46 | 10.6 | +1.8 | 5 / 199 |  |
| fpc_inj | +0.57 | 0.64 | -0.0 | +0.6 | +1.1 | 2.43 | 3.86 | 7.2 | +0.3 | 131 / 199 |  |
| wx_mc | +3.07 | 3.07 | +0.2 | +3.4 | +5.7 | 3.23 | 3.99 | 9.6 | -2.8 | 295 / 199 | 33 % |
| fpc_mc | +0.97 | 1.37 | -0.4 | +1.4 | +1.9 | 2.16 | 3.49 | 10.6 | +1.8 | 5 / 199 | 67 % |
| hybrid | +1.54 | 1.54 | +0.5 | +1.5 | +2.6 | 2.32 | 3.40 | 7.2 | +0.3 | 131 / 199 |  |

**wind, 12 mois non civils (n = 15)**

| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dash | +1.73 | 2.27 | -0.2 | +0.7 | +5.4 | 3.10 | 3.68 |  |  |  |  |
| dash_curt | +2.25 | 2.44 | +0.0 | +1.0 | +6.0 | 3.27 | 3.73 |  |  |  |  |
| step | +0.45 | 2.43 | -1.9 | -0.6 | +5.3 | 3.26 | 4.00 |  |  |  |  |
| step_curt | +1.82 | 2.50 | -1.2 | +0.6 | +7.1 | 3.42 | 4.03 |  |  |  |  |
| fpc_plain | -0.02 | 2.32 | -4.1 | +0.5 | +3.2 | 3.08 | 3.85 | 13.2 | +2.3 | 8 / 278 |  |
| fpc | +0.07 | 2.17 | -4.0 | +0.8 | +3.0 | 2.87 | 3.56 | 13.2 | +2.3 | 8 / 278 |  |
| fpc_inj | -0.12 | 2.04 | -2.6 | -0.8 | +4.1 | 2.98 | 3.93 | 9.0 | +0.5 | 189 / 278 |  |
| wx_mc | +2.96 | 3.00 | -0.1 | +2.2 | +7.7 | 3.45 | 4.04 | 11.2 | -3.3 | 386 / 278 | 47 % |
| fpc_mc | -0.05 | 2.06 | -4.2 | +0.6 | +2.6 | 2.78 | 3.52 | 13.2 | +2.3 | 8 / 278 | 33 % |
| hybrid | +0.93 | 1.73 | -1.3 | +0.1 | +4.3 | 2.68 | 3.35 | 9.0 | +0.5 | 189 / 278 |  |

**wind, 20 mois (n = 15)**

| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dash | +2.37 | 2.39 | +0.0 | +2.9 | +4.7 | 3.39 | 3.78 |  |  |  |  |
| dash_curt | +2.68 | 2.69 | +0.1 | +3.8 | +4.9 | 3.58 | 3.90 |  |  |  |  |
| step | +1.05 | 2.26 | -1.9 | +0.7 | +5.3 | 3.61 | 4.14 |  |  |  |  |
| step_curt | +1.98 | 2.85 | -1.5 | +0.9 | +7.0 | 3.93 | 4.29 |  |  |  |  |
| fpc_plain | +0.89 | 1.78 | -1.5 | +1.0 | +2.4 | 2.96 | 3.77 | 13.7 | +2.3 | 9 / 455 |  |
| fpc | +0.74 | 1.71 | -1.8 | +1.0 | +2.1 | 2.83 | 3.62 | 13.7 | +2.3 | 9 / 455 |  |
| fpc_inj | +0.28 | 1.59 | -2.0 | -0.1 | +2.7 | 3.09 | 4.00 | 10.1 | +0.8 | 222 / 455 |  |
| wx_mc | +3.36 | 3.38 | +0.1 | +4.3 | +6.5 | 3.66 | 4.00 | 11.6 | -3.0 | 571 / 455 | 40 % |
| fpc_mc | +0.59 | 1.53 | -1.5 | +0.7 | +1.9 | 2.76 | 3.61 | 13.7 | +2.3 | 9 / 455 | 40 % |
| hybrid | +1.41 | 1.57 | -0.2 | +0.5 | +3.7 | 2.71 | 3.37 | 10.1 | +0.8 | 222 / 455 |  |

**wind, 6 mois (n = 25)**

| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dash | +0.98 | 2.49 | -1.4 | +1.0 | +4.5 | 3.01 | 3.72 |  |  |  |  |
| dash_curt | +1.57 | 2.71 | -0.4 | +1.1 | +5.0 | 3.18 | 3.79 |  |  |  |  |
| step | +0.03 | 2.69 | -3.7 | -0.2 | +4.3 | 3.20 | 3.96 |  |  |  |  |
| step_curt | +1.56 | 2.91 | -1.5 | +0.7 | +5.9 | 3.32 | 4.03 |  |  |  |  |
| fpc_plain | -0.43 | 2.33 | -3.7 | +0.1 | +3.7 | 2.81 | 3.89 | 13.3 | +2.4 | 4 / 130 |  |
| fpc | -0.03 | 2.20 | -4.8 | +0.5 | +3.4 | 2.77 | 3.71 | 13.3 | +2.4 | 4 / 130 |  |
| fpc_inj | -0.82 | 2.44 | -4.5 | -0.7 | +3.1 | 3.08 | 4.34 | 8.6 | +0.3 | 95 / 130 |  |
| wx_mc | +2.65 | 2.71 | -0.1 | +2.3 | +6.3 | 3.09 | 3.93 | 10.7 | -3.1 | 184 / 130 | 40 % |
| fpc_mc | -0.20 | 2.15 | -4.6 | +0.3 | +3.1 | 2.73 | 3.73 | 13.3 | +2.4 | 4 / 130 | 56 % |
| hybrid | +0.54 | 1.78 | -2.0 | +0.1 | +4.6 | 2.53 | 3.49 | 8.6 | +0.3 | 95 / 130 |  |
