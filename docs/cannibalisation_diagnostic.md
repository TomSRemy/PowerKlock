# Diagnostic de la projection de cannibalisation (solaire et éolien France)

Date : 27 novembre 2026. Branche `fable/cannibalisation-diag`.
Scripts : `scripts/cannib_diag.py` (analyse), `scripts/cannib_diag_data.py` (données). Résultats : `data/history/cannib_diag.json`.
Rejouer : `python scripts/cannib_diag.py` (6 secondes, aucun appel réseau, fichiers du dépôt uniquement).

## 1. Réponse courte

- La projection reste imprécise pour trois raisons, par ordre d'importance :
  1. **La forme** : la tendance `a + b·ln(GW France)` est apprise sur des années où le solaire ne pesait rien (2016-2021). Elle sous-estime la chute dès que le solaire sature la demande nette du nucléaire à midi. Erreur systématique de +17 à +25 points à 2 et 3 ans (taux prévu trop haut).
  2. **Les ruptures de régime** : accélération en 2024, aplatissement en 2026. Aucune variable disponible ne les annonce hors échantillon. C'est environ la moitié de l'erreur et elle reste après toutes les corrections testées.
  3. **Le mélange de deux phénomènes dans la cible** : le taux de capture annuel = forme mensuelle des prix (gaz, nucléaire, hiver) × perte de valeur à l'intérieur des mois (la vraie cannibalisation). Le premier terme bouge de 9 points d'une année à l'autre et n'a rien à voir avec le parc.
- Les pays « comparables » n'apportent pas l'avance espérée :
  - mesurée sur la pénétration propre à chaque pays, la pente diffère d'un facteur 3,5 (France -0,72, Allemagne -2,49 par unité de part solaire de la demande résiduelle à midi) : l'historique d'un voisin ne se transpose pas ;
  - mesurée sur la pénétration régionale (FR + DE + ES + BE), les pentes s'alignent (-1,24 à -1,65), mais les quatre pays sont alors au même point au même moment. Marchés couplés : personne n'est « en avance ».
- Meilleur modèle amélioré testé : **S2**, terme intra-mensuel projeté sur la part solaire de la demande résiduelle française à midi, multiplié par un terme saisonnier. Gain hors échantillon sur le solaire, toutes heures : **-13 % à 1 an, -12 % à 2 ans, -24 % à 3 ans** (2023-2026), jusqu'à -35 % à 3 ans sur 2021-2026.
- Éolien : rien ne bat la méthode actuelle. L'erreur est faible (1,5 à 2,5 €/MWh) et vient surtout du terme saisonnier.

## 2. Modèle actuel (audit)

- **Tendance de capacité** (`step`, benchmark publié) : taux de capture annuel = `a + b·ln(GW installés France)`, ajusté sur les années complètes (2022 exclue), ancré sur la dernière année. Parc futur : dernier rythme annuel, jamais sous la trajectoire PPE3 (48 GW solaire en 2030, 67,5 GW en 2035).
- **FPC** (`js/ppa-fpc.js`) : profil attendu × courbe forward horaire, plus un terme de cannibalisation (réalisé moins décorrélé, par saison) projeté en `a + b·ln(GW solaire France)`, ancré sur la dernière année. Le même moteur sert à l'éolien avec le parc solaire.
- **Modèle régional** (`ppa_lab.py`) : prix horaire en fonction de la charge résiduelle FR + DE + BE + ES, rejoué avec le parc de l'année de livraison. Seule méthode qui regarde les voisins.
- **Données voisins** (`fetch_country_capture.py`) : taux de capture annuels DE, BE, NL, ES, UK. Servent à l'affichage et à un test de pente, pas à la projection publiée.
- Tests déjà faits dans le dépôt et confirmés ici : remplacer le parc français par le parc européen dans `ln(x)` ne change rien (`ppa_capacity_eu_test.py`) ; aucun facteur mensuel (nucléaire, hydro, charge, exports, pompage, niveau de prix) n'explique l'erreur hors échantillon (`ppa_factors.py`, R² négatif).

## 3. Relation historique capture contre pénétration

Décomposition utilisée partout : `capture = saison × intra`.
- `saison` = production mensuelle valorisée au baseload du mois, rapportée au baseload annuel.
- `intra` = valeur réalisée rapportée à la production valorisée au baseload de son mois.

Solaire France, toutes heures :

| Année | Capture | Saison | Intra | Part résiduelle FR midi | Part régionale midi |
|---|---|---|---|---|---|
| 2019 | 0,952 | 0,946 | 1,007 | 0,28 | 0,24 |
| 2021 | 0,871 | 0,885 | 0,984 | 0,29 | 0,29 |
| 2022 | 1,046 | 1,080 | 0,969 | 0,26 | 0,33 |
| 2023 | 0,846 | 0,969 | 0,873 | 0,43 | 0,39 |
| 2024 | 0,649 | 0,878 | 0,739 | 0,57 | 0,45 |
| 2025 | 0,561 | 0,884 | 0,635 | 0,76 | 0,52 |
| 2026 (11 mois) | 0,545 | 0,932 | 0,584 | 0,93 | 0,65 |

- Part résiduelle FR midi = solaire ÷ (consommation - nucléaire), 11h-15h. En 2026 le solaire couvre 93 % de la demande française nette du nucléaire à midi, avec seulement 9,6 % de la consommation annuelle. L'Allemagne atteint le même terme intra (0,55-0,58) avec 21 % de part annuelle.
- Le terme intra est lisse et monotone. Le terme saison oscille entre 0,88 et 1,08 sans lien avec le parc.
- Variation annuelle (écart-type des variations log, 2016-2026) : capture 12,7 points, saison 9,1, intra 6,1 (3,7 une fois la tendance retirée).
- Même lecture chez les voisins (intra 2020 puis 2025) : DE 0,88 puis 0,56 ; ES 1,00 puis 0,57 ; BE 0,90 puis 0,56 ; FR 1,00 puis 0,63. Chute simultanée.
- Prix négatifs : ils ne coûtent que 2,4 à 2,9 points du terme intra en 2024-2026. La perte principale vient des heures entre 0 et 10 €/MWh (22 % de la production solaire).

### Choix de la métrique (France 2016-2026, R² en laissant une année de côté, forme linéaire)

| Métrique | Capture annuelle | Terme intra |
|---|---|---|
| ln(GW France), actuel | 0,58 | 0,81 |
| ln(GW) milieu d'année | 0,60 | 0,84 |
| ln(GW région) | 0,67 | 0,88 |
| Part de la production annuelle | 0,68 | 0,90 |
| Part de la consommation à midi | 0,68 | 0,91 |
| Part régionale de la demande résiduelle à midi | 0,71 | 0,92 |
| GW ÷ charge moyenne | 0,74 | 0,95 |
| **Part de la demande résiduelle FR à midi** | **0,80** | **0,95** |
| Part de la production en heures de surplus régional (seuil 80 %) | 0,84 | 0,94 |

- Séparer la cible fait passer le R² de 0,58 à 0,81 avec la même métrique. Changer de métrique ajoute de 0,81 à 0,95.
- Les formes quadratiques sont instables (R² de -0,3 à 0,97 selon la métrique) : à éviter.

## 4. Test walk-forward de la projection actuelle

Protocole : chaque année de livraison est prévue avec les années antérieures seulement, 1, 2 et 3 ans à l'avance. Cibles 2021, 2023, 2024, 2025, 2026 à date (2022 jamais cible). Erreur = taux prévu moins réalisé, en points et en €/MWh (× baseload de l'année). Parc futur extrapolé au dernier rythme.

Erreurs de la tendance actuelle (B0), solaire toutes heures, en points :

| Livraison | 1 an | 2 ans | 3 ans |
|---|---|---|---|
| 2021 | +6,1 | +9,6 | +21,5 |
| 2023 | -1,4 | -1,4 | +8,6 |
| 2024 | +17,9 | +16,8 | +16,8 |
| 2025 | +4,8 | +25,0 | +24,2 |
| 2026 | -4,0 | +2,8 | +23,3 |

- Biais systématique vers le haut, qui grandit avec l'horizon. Erreur moyenne absolue 2023-2026 : 4,7 / 7,3 / 14,0 €/MWh (toutes heures), 3,6 / 4,4 / 9,2 (heures payées).
- Éolien : 1,5 / 2,1 / 2,2 €/MWh. Pas de biais marqué.

## 5. Décomposition de l'erreur (solaire, toutes heures, €/MWh d'erreur moyenne absolue)

Échelle : on donne à la prévision, une information après l'autre, la vérité. L'ordre des marches influence un peu les parts.

| Marche | 1 an | 2 ans | 3 ans |
|---|---|---|---|
| Tendance actuelle, parc extrapolé | 4,66 | 7,30 | 13,99 |
| + parc réel | 4,25 | 6,92 | 12,85 |
| + cible séparée et part de demande résiduelle (S2) | 3,39 | 5,60 | 7,09 |
| + terme saisonnier réel | 2,48 | 5,29 | 6,11 |
| + part résiduelle réelle (météo, demande, nucléaire de l'année) | 3,53 | 6,04 | 6,16 |

Classement des sources (2023-2026, 4 années ; ordres de grandeur identiques sur 2021-2026) :

1. **Résidu structurel non expliqué : 2,5 / 5,3 / 6,1 €/MWh**, soit la moitié de l'erreur. Ruptures de régime (seuil franchi en 2024, aplatissement en 2026). Flexibilité, écrêtement, comportement aux prix négatifs, voisins.
2. **Forme et métrique : 0,9 / 1,3 / 5,8 €/MWh.** Premier poste à 3 ans. `ln(GW)` appris sur l'ère plate.
3. **Terme saisonnier : 0,9 / 0,3 / 1,0 €/MWh** (1,6 / 1,4 / 1,9 sur 2021-2026 ; 1,4 à 2,2 à 1 an en convention heures payées). Ce n'est pas de la cannibalisation.
4. **Prévision du parc : 0,4 / 0,4 / 1,1 €/MWh.** La trajectoire PPE3 n'est pas le problème.
5. **Météo, demande, nucléaire de l'année de livraison : gain nul**, voire négatif. Les connaître parfaitement n'améliore pas la prévision annuelle.

Facteurs testés mois par mois (France, 88 mois de mars à octobre, R² en laissant une année de côté, ajoutés à la part régionale) :

| Facteur | Gain de R² | Lecture |
|---|---|---|
| Part de production à prix négatif | +0,18 | Concomitant du résultat, pas prévisible |
| Pompage à midi (STEP et batteries) | +0,08 | Concomitant aussi (les pompes tournent quand le prix est bas). Seul signal de flexibilité |
| Hydraulique | +0,03 | Faible |
| Ensoleillement du mois | +0,02 | Faible |
| Solaire des voisins, exports, nucléaire | +0,01 ou moins | Déjà contenus dans la métrique |
| Consommation, vent à midi | 0 ou négatif | Rien |
| Niveau de prix, TTF | -0,19 à -0,37 | Sur-apprentissage : dégradent la prévision |
| CO2, taux de maintien aux prix négatifs (2020+ seulement, 56 mois) | +0,08 à +0,10 | Échantillon trop court pour conclure |

- Nucléaire 2022 : son effet passe par le terme saisonnier (1,08 en 2022) et par la demande résiduelle, pas par un facteur séparé.
- Gaz et CO2 : aucun pouvoir prédictif sur le terme intra. Ils agissent sur le terme saisonnier.
- Règles aux prix négatifs (arrêts dès 10 MW depuis le 22 décembre 2025) : coïncident avec l'aplatissement 2026, mais une seule année, effet non séparable.

## 6. Modèles améliorés testés

Erreur moyenne absolue en €/MWh, solaire, parc extrapolé, 1 / 2 / 3 ans :

| Modèle | Toutes heures 2023-2026 | Toutes heures 2021-2026 | Heures payées 2023-2026 | Années complètes 2023-2025 |
|---|---|---|---|---|
| B0 tendance actuelle | 4,66 / 7,30 / 13,99 | 5,06 / 7,94 / 15,89 | 3,57 / 4,35 / 9,16 | 4,88 / 8,80 / 10,96 |
| S1 cible séparée, ln(GW) | 4,81 / 9,54 / 15,92 | 5,19 / 9,04 / 14,40 | 3,42 / 5,44 / 10,12 | 6,20 / 10,56 / 13,25 |
| **S2 part de demande résiduelle FR** | **4,06 / 6,41 / 10,67** | **4,39 / 6,59 / 10,30** | 3,62 / 4,36 / 6,01 | 3,69 / 6,88 / 10,24 |
| S2w idem, pente sur 4 ans | 5,34 / 7,86 / 12,57 | 5,47 / 7,75 / 11,82 | 3,19 / 5,49 / 5,58 | 5,57 / 8,74 / 12,92 |
| P1 panel régional, effets pays | 7,77 / 9,61 / 7,67 | 7,38 / 8,91 / 7,83 | 5,92 / 4,23 / 6,99 | 2,66 / 5,93 / 10,18 |
| P3 panel régional avec seuil | 7,77 / 9,87 / 8,18 | 7,36 / 9,12 / 8,24 | 6,81 / 8,99 / 8,41 | 2,76 / 5,47 / 10,03 |
| S4 heures de surplus rejouées | 10,44 / 14,04 / 12,41 | 9,64 / 12,76 / 11,64 | 8,58 / 9,15 / 6,71 | 6,57 / 7,70 / 11,24 |

- **S2 est le seul gain robuste** : meilleur ou égal à B0 dans toutes les fenêtres et à tous les horizons en toutes heures. En heures payées : neutre à 1 et 2 ans, -34 % à 3 ans.
- Séparer la cible sans changer la métrique (S1) ne suffit pas : le gain vient de la métrique.
- **Panel régional (P1)** : -45 % à 1 an et -33 % à 2 ans sur les années complètes 2023-2025, et le meilleur à 3 ans partout (7,7 contre 14,0). Mais il rate 2026 de 23 points : la part régionale a bondi (0,52 à 0,65) alors que le terme intra s'est aplati. À ne pas adopter sans terme de saturation et sans vérifier la série allemande 2026.
- S4 (heures de surplus rejouées heure par heure) : échec, trop convexe.
- S2 ne se transpose pas aux voisins (Allemagne 13,3 points d'erreur contre 9,0 pour la tendance) : la demande nette du nucléaire est une métrique française.
- Éolien : aucun modèle ne bat B0 (1,54 / 2,10 / 2,23 €/MWh). R² des métriques sur le taux annuel inférieur à 0,3.
- Échantillon : 4 à 5 années cibles. Les écarts de moins de 0,5 €/MWh ne sont pas significatifs.

## 7. Corrections proposées, par priorité

1. **Remplacer `ln(GW)` par la part solaire de la demande résiduelle à midi dans la tendance de capacité et dans le terme de cannibalisation du FPC** (solaire seulement). Part projetée = production de midi par GW (moyenne 3 ans) × parc de l'année ÷ (consommation - nucléaire) de midi (moyenne 3 ans). Gain attendu : -13 / -12 / -24 % en toutes heures.
2. **Projeter le terme intra, pas le taux annuel**, et prendre le terme saisonnier dans les cotations forward (mois, trimestres) au lieu d'une moyenne. Gain plafond mesuré : 0,9 à 1,6 €/MWh à 1 an. À tester avec l'historique des cotations (`fr_market_contracts_FR.json`), non fait ici.
3. **Pondérer selon l'horizon** : tendance (S2) à 1 et 2 ans, modèles régionaux à 3 ans et plus. Cohérent avec `ppa_horizon_test.py`.
4. **Afficher l'incertitude structurelle** : environ ±2,5 €/MWh à 1 an, ±5 à 2 ans, ±6 à 3 ans, irréductible avec les données actuelles. La bande actuelle (écart des résidus de la régression) la sous-estime.
5. **Construire un terme de saturation** pour les modèles régionaux : séries de batteries (registre ODRÉ pour la France, Energy-Charts pour l'Allemagne), pompage, production potentielle corrigée de l'écrêtement. C'est la piste pour réduire le résidu, sans garantie.
6. **Ne pas ajouter** de facteur gaz, niveau de prix, nucléaire, consommation ou météo au terme de cannibalisation : gain nul ou négatif hors échantillon.
7. Éolien : laisser tel quel.

## 8. Données manquantes ou douteuses

- **Série de capacité France incohérente dans `country_capture.json`** : 22,86 GW en 2024 (Energy-Charts) puis 30,44 GW en 2025 (RTE), alors que RTE donne 24,50 puis 30,44. Saut artificiel de +33 %. À vérifier : quelle série alimente `capGW` du pricer.
- **Allemagne 2026** : production solaire en hausse d'environ 30 % pour +13 % de capacité. Série Energy-Charts à vérifier (autoconsommation ?). Elle gonfle la part régionale 2026.
- **Pays-Bas** : solaire public quasi nul (0,5 TWh pour 29 GW), inutilisable en production. **Italie** : prix seulement, pas de production ni de charge horaire. **Royaume-Uni** : prix intrajournalier, pas de day-ahead.
- **Prix horaires des voisins** : à partir de 2020 seulement dans le dépôt. Panel mensuel de 7 ans, dont 2022.
- **Capacités voisines 2026** absentes pour ES, BE, NL (extrapolées ici). Capacité France 2026 estimée par la croissance du registre.
- **Écrêtement** : pas de volume horaire. La production observée est déjà écrêtée, donc les parts sous-estiment le potentiel depuis 2024 (RTE : 1,7 TWh en 2024, 3,0 TWh en 2025).
- **Flexibilité** : pas de série de batteries France (hypothèse RTE codée en dur), pas de série de flexibilité de la demande.
- **Gaz et CO2** : TTF depuis 2019, EUA depuis décembre 2019. Rien avant.
- **2026** : année incomplète (11 mois France, 10 mois voisins), comparée sur les mêmes mois.

## 9. Limites

- Scores annuels (erreur sur le taux de l'année × baseload), alors que le banc d'essai du dépôt score mois par mois pondéré par la production. Les niveaux ne sont pas directement comparables, les classements le sont.
- B0 est une réplique de la tendance de capacité, pas le code du pricer. Ordres de grandeur conformes à `ppa_horizon_test.json`.
- Tous les modèles testés sont rapportés, y compris les échecs. B0, S1, S2, S3, P1, P2, P3 ont été définis avant les résultats ; S2w, S4 et l'ordre des marches de l'échelle (S2 à la place de S1 et P1) ont été ajoutés après un premier passage. Avec 4 à 5 années cibles, le gain de S2 reste à confirmer sur 2027.
- Rien n'est branché sur le site : ni page, ni script `ppa_*` modifié.
