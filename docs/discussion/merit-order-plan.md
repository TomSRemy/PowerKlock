# Plan : un vrai merit order pour le générateur de scénarios (30 oct. 2026)

## Pourquoi
La règle actuelle (prix = coût d'une centrale à gaz × un coefficient appris selon « ce qui reste à produire ») est un
merit order implicite appris sur les deux dernières années. Sur la vraie météo de 2025, sa courbe est trop plate : trop
chère en surplus (+4 à +8 €/MWh), pas assez en tension (−4 à −12 €). Comme l'éolien produit surtout en surplus (≈ 72 %
de ses MWh), il est surévalué d'environ +2 €/MWh. La courbe de 2025 est plus pentue que celle de 2023–2024 apprise : une
règle apprise sur le passé a toujours un temps de retard quand le parc change.

## Le principe
Chaque heure, on empile l'offre du moins cher au plus cher face à la consommation ; le prix est celui de la dernière
unité appelée. L'empilement se construit à partir du parc et des coûts de l'année livrée, pas des prix passés.

## Les briques (toutes avec une source automatique déjà dans le site)
| Brique | Prix d'offre | Source |
|---|---|---|
| Solaire, éolien | 0 € pour la part qui s'arrête aux prix négatifs (≈ 30 % de l'éolien, 17 % du solaire en 2025, et la part grandit avec les nouveaux parcs) ; le reste produit quel que soit le prix | météo des semaines tirées × parc ; part qui s'arrête : RTE Bilan électrique (chaque année) |
| Fil de l'eau, biomasse, cogénération | produisent toujours | Energy-Charts (production, capacités) |
| Nucléaire disponible | bas (coût du combustible), avec un minimum technique ; il module au-dessus | disponibilité nucléaire ENTSO-E jour par jour (depuis 2019), prévision de disponibilité |
| Hydraulique de lac | énergie de la semaine limitée (remplissage des réservoirs), placée sur les heures les plus chères | réservoirs ENTSO-E (A72), semaine par semaine |
| STEP et batteries | achètent aux heures basses, revendent aux heures hautes | déjà dans le générateur |
| Gaz, charbon | coût combustible + CO2 (TTF ÷ rendement + EUA ; API2) | SEFE (TTF, EUA, charbon) |
| Pays voisins (Allemagne, Belgique, Espagne) | leur propre empilement, mêmes règles | Energy-Charts, ENTSO-E (déjà dans le générateur) |
| Échanges | prix commun tant que les lignes ne sont pas saturées ; au-delà de la capacité d'export, la France a son propre prix | flux physiques Energy-Charts (capacité d'export : 14,8 GW en 2023, 18,2 en 2025) |

Les paramètres (rendements, coût du combustible nucléaire, minimum technique, part qui s'arrête) sont des constantes
économiques ou physiques tirées de sources, fixées une fois. Ils ne sont pas ajustés pour coller aux prix (pas de recalage).

## Étapes, chacune testée avant la suivante
1. **La courbe sur la vraie météo** (France + capacité d'export) : on retrouve-t-on la pente réelle par situation
   (surplus / équilibre / tendu) sur 2023–2025, mieux que la règle actuelle ? Si non, on s'arrête et on en parle.
2. **Les voisins** (Allemagne, Belgique, Espagne) et le couplage aux frontières.
3. **Branchement dans le générateur** comme règle alternative (le reste ne change pas : semaines réelles, parcs, batteries).
4. **Rejeu 2020–2025**, 1 à 3 ans avant, sans connaître l'année livrée, même protocole qu'aujourd'hui. Adoption seulement
   si l'erreur baisse sur les deux technologies prises ensemble et que le biais éolien se réduit.
5. Si adopté : méthodologie FR/EN, texte du pricer, garde-fou inchangé.

## Risques, dits d'avance
- Plus de briques = plus d'hypothèses ; la règle actuelle capte implicitement des choses (exports, hydraulique) que
  le merit order doit reconstruire. La première version peut être moins bonne : on le saura à l'étape 1.
- Charbon : prix API2 seulement depuis 2022 (peu de charbon en France ; compte pour l'Allemagne).
- Suisse, Italie, Grande-Bretagne : pas d'empilement propre ; leurs échanges pris comme ceux du jour météo tiré.
