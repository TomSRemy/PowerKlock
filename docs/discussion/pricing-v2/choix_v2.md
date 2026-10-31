# Pricing PPA v2 : les choix et pourquoi

*Note PowerKlock, 1er novembre 2026. v2 en ligne depuis le 31 octobre 2026.*

## La méthode en quelques lignes

Prix PPA = Σ poids × forward Cal × capture − prime de risque − coût des écarts + GO − marge.

- **Forward** : Cal base France, lu mois par mois (les mois et trimestres cotés donnent la forme de l'année). Poids = production attendue × actualisation. Durée par défaut : les 3 prochaines années civiles (2027–2029).
- **Capture** : sortie d'un générateur de scénarios. Des milliers d'années possibles faites de vraies semaines de 2019 à 2025 (2022 exclue), posées sur les parcs de l'année livrée (France : rythme récent, jamais sous la PPE3 ; batteries). Une seule règle de prix en euros : coût d'une centrale à gaz × un facteur selon ce qui reste à produire, avec deux régimes (France couplée à ses voisins, ou coupée quand son export dépasse sa limite Core de l'heure).
- **Risque** : la bande P10–P90 du générateur (Monte Carlo complet) donne une dérive de capture (solaire 2,75, éolien 2,12 pts/√an). Le pricer tire 10 000 trajectoires (forward, volume, capture, liquidité), couvre le volume attendu au Cal et retire la prime = valeur juste − 25e centile.
- **Convention** : production non payée quand le prix est ≤ 0 €/MWh (passage à strictement < 0 en cours).

Aujourd'hui (forwards des 30–31 oct. 2026) : **solaire 49,75 €/MWh, éolien 80,69 €/MWh**.

## Les règles de Tom qui tranchent

Pas de recalibrage caché ; une seule méthode pour le solaire et l'éolien ; produits liquides seulement ; réalisme face à l'historique ; tests sur des années complètes ; jamais changer le % d'un mélange à chaque pricing.

## Les six choix

**1. Une seule méthode plutôt que la moyenne de quatre.** La moyenne des 4 anciennes méthodes, corrigées de leur biais passé, se trompait au rejeu de 2,59 € (solaire) et 2,84 € (éolien). Le générateur seul : 0,76 et 0,56. Décision : le générateur fait le prix ; les anciennes méthodes restent dans le pricer comme repères, hors du prix.

**2. L'ancrage choisi par une règle.** capture(Y) = générateur(Y) × réalisé(2025) ÷ générateur(2025). Trois modes : aucun, un facteur sur l'année, hiver/été. Chaque semaine, le rejeu garde le mode qui s'est le moins trompé, la même règle pour les deux technos. Aujourd'hui : solaire sans ancrage (0,76 contre 1,18 et 1,22), éolien hiver/été (0,84 contre 0,96 et 2,62 en v1). Ancrages au mois ou au trimestre testés et moins bons.

**3. Une règle éolienne pondérée par la production.** Les cases de la règle sont apprises en donnant plus de poids aux heures où le vent produit (idée de Qorbanian, Löhndorf & Wozabal) et, quand la France est coupée, lisent aussi la part de l'éolien. Erreur éolienne 0,84 → 0,56 €/MWh (3 tirages). Même générateur : seule la pondération suit la techno pricée.

**4. Le mélange 50/50 analogues + règle : refusé.** Il gagne en moyenne sur les formats glissants (reste + année 0,68, glissant 1,03) mais perd sur les années civiles (0,89 contre 0,63 pour la v2). Les analogues seuls se trompent de 4,1 € en solaire. Et le % du mélange finirait par bouger. Tom : « on avait une bonne méthode ».

**5. Un prix prudent plutôt que le P50.** « Ne pas perdre d'argent systématiquement » : le prix est le niveau qui tient dans 3 cas sur 4 ; P25, P50 et P75 sont affichés. Au rejeu, avec le Monte Carlo complet, le prix prudent tient dans 78 % des cas en solaire et 78 à 100 % en éolien (cible 75 %).

**6. La bande complète, sans déduction séparée de risque de modèle.** La bande météo seule était trop étroite (prix prudent éolien tenu dans 0 % des cas). Le Monte Carlo complet tire aussi la croissance des parcs (± 40 %), le nucléaire (avec 5 % de chance d'une année type 2022), la limite Core, la consommation, une année sèche ou humide. La bande contient donc déjà l'erreur du modèle : plus de déduction à part. La corrélation volume–capture est mesurée (0,06 solaire, 0,26 éolien) au lieu d'être supposée (0,3 / 0,2).

## Pourquoi deux régimes

La France est de plus en plus souvent coupée de l'Allemagne : 5 460 heures en 2025, qui portent 67 % des MWh éoliens français. Sa limite d'export Core est passée de 9,2 GW (2023) à 7,6 (2024) puis 5,4 (2025). Même coupée, son prix suit celui de l'Allemagne par ses autres frontières. Au-delà du surplus le plus fort jamais vu, le prix continue de baisser jusqu'au plancher observé : un parc qui grandit continue de faire baisser la capture.

## Testé et laissé de côté

Analogues seuls (solaire 4,1 €) ; mélange 50/50 ; merit order v1 à v3 avec courbes d'offre observées (bon à 1 an, casse à 2–3 ans) ; analogues multi-pays ; surprise du jour ajoutée à la règle ; ancrages au mois ou au trimestre ; moyenne des 4 méthodes.

## Comment on le sait

Rejeu sans fuite, refait chaque semaine : livraisons 2023–2026 pricées 1 à 3 ans avant (9 cas), 33 points trimestriels, 12 glissants 12 mois, 12 « reste + année ». Le bruit de tirage atteint 0,2 € : seuls les gains plus grands comptent.

## Limites et points ouverts

- L'éolien reste ancré : sans ancrage, tous les modèles le surévaluent de 2 à 2,7 €, et le biais est dans les heures coupées (règle 6,9 € trop haute).
- Le générateur fait trop peu varier le volume (solaire 2,1 % contre ~5 %) : l'écart de volume vient des vraies années (6,5 % solaire, 9 % éolien, ou le parc lui-même).
- Captures jusqu'à 2030 : à prolonger pour les PPA longs.
- Liquidité : 5,1 % × √années au-delà du dernier Cal coté, mais pas de source d'écart achat–vente.
- Arrêts EDF 2027 : option seulement (éolien +2 pts), impossible à tester sur le passé.
- Convention des prix négatifs : passage de ≤ 0 à strictement < 0 en cours.
