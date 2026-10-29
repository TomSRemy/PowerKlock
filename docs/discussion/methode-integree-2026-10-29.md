# Méthode intégrée du pricer PPA — nuit du 28 au 29 octobre 2026

Demande de Tom (29 oct., ~01:00) : « Crée-moi une nouvelle méthodologie mélangeant tout cette nuit. Je te laisse voir
pour la cohérence. »

## Principe

Chaque méthode actuelle a un point fort et un défaut :

| Méthode | Point fort | Défaut |
|---|---|---|
| Méthode capacité | niveau = décote réalisée, la plus juste au rejeu en solaire | tendance = simple pente sur le parc français |
| Modèle européen | mécanique physique (voisins, batteries, calendrier, météo) | son niveau dérive (corrigé jusqu'ici par un biais appris) |
| Simulation météo | corrélation météo/prix | niveau incertain |
| Forme forward | cotations mensuelles | décomposition fragile en solaire, retirée du prix solaire le 29 oct. |

La méthode intégrée prend **le niveau dans le réalisé** et **l'évolution dans le modèle physique** :

    capture(année livrée) = capture réalisée(dernière année complète) × modèle(année livrée) ÷ modèle(dernière année)

- les deux modèles tournent au **même niveau de prix** (celui de la dernière année) : on ne mesure que ce que changent
  les parcs (France et voisins), les batteries et la demande ; le niveau de marché reste le Cal et les mois cotés,
  comme dans toutes les méthodes ;
- **aucune correction de biais** : le modèle ne fixe jamais un niveau ;
- **éolien** : cette capture seule ; **solaire** : moyenne de cette capture, de la méthode capacité et de la
  simulation météo (l'évolution du solaire est le point le plus incertain, trois vues indépendantes valent mieux).

## Rejeu (`scripts/ppa_integrated_test.py`)

Pricé 1, 2 et 3 ans à l'avance, production arrêtée aux prix ≤ 0, erreur moyenne sur la valeur d'un MWh (€/MWh).
Méthodes brutes (sans correction de biais) ; la moyenne publiée est rejouée avec ses corrections et ses poids.

| | Éolien 2019–25 | Éolien 2024–25 | Solaire 2019–25 | Solaire 2024–25 |
|---|---|---|---|---|
| Modèle européen seul | 2,74 | 3,64 | 2,47 | 2,51 |
| Ancré, niveau de prix de l'année livrée | 1,80 | 1,81 | 2,95 | 2,41 |
| **Ancré, niveau de prix constant** | **1,49** | **1,07** | 2,28 | 2,87 |
| Méthode capacité (banc) | 3,32 | 3,43 | 2,85 | 1,65 |
| Simulation météo (banc) | 2,68 | 3,11 | 1,96 | 1,68 |
| **Solaire : moyenne ancré + capacité + météo** | — | — | **1,68** | 1,46 |
| Moyenne publiée actuelle | 2,01 | 1,73 | 1,86 | 1,25 |

Lecture :
- **éolien** : nettement meilleure que tout, y compris la moyenne publiée (−0,5 à −0,7 €) ;
- **solaire** : meilleure sur 2019–2025 (−0,18 €), moins bonne sur 2024–2025 seules (+0,21 €) ; avec 2026 partiel,
  1,89 contre 1,64. Pas de gain net en solaire.
- variantes écartées : ancrage mois par mois ou par saison (plus bruité), ancrage moyen sur deux ans, mélanges
  pondérés par l'erreur passée (moins bons que les parts égales en solaire, que l'ancré seul en éolien).

## Prix du jour (29 oct., convention arrêt, ténor 2027–2029)

| | Méthode intégrée | Prix publié |
|---|---|---|
| Solaire | 50,83 €/MWh | 50,90 €/MWh |
| Éolien | 78,55 €/MWh | 79,52 €/MWh |

Facteurs d'ancrage 2025 (réalisé ÷ modèle) : solaire 1,153, éolien 0,918 en convention arrêt.

## Ce qui est en ligne

- carte « Méthode intégrée » dans le pricer, **hors prix publié** (mention « test : pas encore dans le prix ») ;
- calcul hebdomadaire (`scripts/ppa_integrated.py`, job « PPA pricer test bench ») et suivi quotidien
  (`int` dans `data/history/ppa_benchmark.json`) ;
- méthodologie FR/EN.

## À décider par Tom

1. Éolien : publier la méthode intégrée à la place de la moyenne des 4 (gain net au rejeu) ?
2. Solaire : garder la moyenne actuelle (meilleure sur 2024–2025) ou passer à l'intégrée (meilleure sur 2019–2025) ?
3. Une fois 2026 complète (janvier 2027), refaire le test avec trois années récentes.
