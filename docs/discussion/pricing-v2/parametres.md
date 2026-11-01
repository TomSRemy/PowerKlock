# Pricer PPA : tous les paramètres, comment ils sont calculés et comment les revoir

État au 1er novembre 2026 (prix publié : solaire 46,64 €/MWh, éolien 77,39 €/MWh, PPA 2027–2029, forwards du 30–31 octobre). Pour chaque paramètre : sa valeur aujourd'hui, d'où elle vient, à quelle fréquence elle se met à jour toute seule, comment la contester (le test qui la mettrait en défaut) et quand la revoir à la main.

Légende de la colonne « Nature » :
- **mesuré** : calculé sur des données publiques, mis à jour par un job ;
- **calibré** : réglé à la main, mais validé par un test de rejeu ;
- **choix** : décision commerciale ou de prudence (la tienne) ;
- **hypothèse** : posé faute de mieux, à remplacer dès qu'une donnée existe.

## 1. Le prix central (la valeur d'un MWh)

| Paramètre | Valeur aujourd'hui | Nature | Comment c'est calculé | Mise à jour | Comment le challenger | Revoir |
|---|---|---|---|---|---|---|
| Forward Cal par année | 2027 : 128,16 · 2028 : 70,94 · 2029 : 62,97 €/MWh | mesuré | cotations EEX France base (cockpit SEFE), lues mois par mois avec les mois et trimestres cotés (facteur k) | chaque jour (fetch_fr_market) | comparer à EEX directement ; écart > 1 € = problème de collecte | jamais à la main |
| Années au-delà du dernier Cal coté | prennent le dernier Cal (2029) | hypothèse | courbe plate au-delà de Cal+3 | — | comparer le dernier Cal à l'avant-dernier : la pente moyenne mesurée est de +3 %/an | si un Cal+4 devient disponible |
| Taux de capture (générateur v2) | solaire ≈ 57 % du Cal, éolien ≈ 93 % (2027–2029) | mesuré + calibré | des milliers d'années tirées de vraies semaines 2019–2025, parcs de l'année livrée, règle de prix en € à deux régimes (couplé / coupé selon la limite d'export Core JAO) | chaque semaine (ppa_lab, dimanche) | le rejeu : livraisons 2023–2026 pricées 1 à 3 ans avant ; erreur moyenne solaire 0,76 €, éolien 0,56 € | si l'erreur de rejeu dépasse 1,5 € ou après une année atypique |
| Ancrage | solaire : aucun · éolien : un facteur hiver, un facteur été sur 2025 | calibré | la variante (aucun / année / hiver-été) qui se trompe le moins au rejeu, même règle pour les deux | chaque semaine | le rejeu le compare automatiquement ; voir data/history/ppa_model_risk.json | en janvier, quand une année complète s'ajoute |
| Règle d'arrêt | strictement sous 0 €/MWh (une heure à 0 € est produite et payée 0) | choix | appliquée partout : historique, règle de prix, générateur, rejeu | — | 225 heures à exactement 0 € en 2025 ; changer le seuil dans le pricer montre l'effet | à chaque contrat (clause de prix négatifs) |
| Seuil d'arrêt différent de 0 | réglable (positif ou négatif) | mesuré | capture et part payée de chaque mois × leur rapport au seuil choisi ÷ à 0, sur les deux dernières années complètes | chaque jour (build_fr_capture) | comparer au calcul direct sur une courbe de parc | — |
| Profil mensuel / cannibalisation horaire | solaire −5,97 / −26,82 €, éolien +7,87 / −10,68 € (avant la règle stricte) | mesuré | découpage du prix capté : forwards des mois contre le Cal, puis heures dans le mois | à chaque calcul | la somme des deux = le prix capté | — |
| Parc précis | écart moyen du parc au national sur ses 3 dernières années complètes | mesuré | sa courbe × prix horaires, contre le profil national | à chaque chargement | test sur les régions RTE : national + écart du parc 1,2 pt d'erreur contre 5,5 pour le parc seul (solaire) | — |

## 2. La prime de risque (le prix prudent)

| Paramètre | Valeur aujourd'hui | Nature | Comment c'est calculé | Mise à jour | Comment le challenger | Revoir |
|---|---|---|---|---|---|---|
| Niveau de prudence | 1 futur perdant sur 4 (P75 du prix) | choix | le prix est fixé au 25e centile de ce que rapporte un MWh dans 10 000 futurs | — | rejeu : le prix prudent a tenu 78–89 % du temps (cible 75 %) | si la politique de risque change |
| Dérive de la cannibalisation | solaire 2,38 pts/√an, éolien 1,90 | mesuré + calibré | P50 − P25 de la capture dans le Monte-Carlo complet du générateur | chaque semaine | rejeu de calibration P75 (annuel, trimestriel) | si la calibration P75 sort de 65–85 % |
| Monte-Carlo complet du générateur | parc ±40 %, nucléaire ±4 % avec 5 % de chance d'une année type 2022 (−20 %), limite d'export ±20 %/√an, consommation ±2 %, année sèche ou humide (0,1 / 0,5) | calibré | tirés pour chaque scénario | chaque semaine | les mêmes tests de calibration ; diversité des tirages (chaque scénario mélange les 6 années) | une fois par an, ou si la calibration dérive |
| Sensibilité du prix capté au prix base | solaire 0,96 € par €, éolien 0,95 | mesuré | même mois d'une année sur l'autre, 3 dernières années (la décote est surtout un montant en euros) | à chaque calcul | sur 2024–2025 seul : 0,84 en solaire ; si elle tombe sous 0,8, la prime solaire remonte | chaque trimestre |
| Volatilité des forwards | Cal+1 34 %, Cal+2 21 %, Cal+3 21 %/an ; effective 34 / 33 / 29 % pour 2027 / 2028 / 2029 | mesuré | rendements journaliers des Cal glissants, hors passage d'un contrat au suivant | chaque jour | 2026 est une année de crise (Cal+1 très volatil) : comparer à une période calme | chaque trimestre |
| Couverture supposée | back to back : le volume payé attendu vendu au Cal | choix | l'outil Couverture la compare aux autres (prime solaire 1,84 contre 1,74 au mieux) | à chaque calcul | l'outil Couverture | si tu couvres autrement en pratique |
| Dispersion du volume | solaire ±6,5 %, éolien ±9 % (national, 6 ans) ; parc : ses années face au national (β + dispersion propre), ou sa propre dispersion avec 8 ans ou plus | mesuré | écart-type des facteurs de charge annuels | chaque jour | les années ERA5 d'un parc localisé (Prévision de production) | quand on a un parc mesuré |
| Lien volume – capture | solaire 0,24, éolien 0,32 | mesuré | corrélation dans les scénarios météo du générateur | chaque semaine | — | — |
| Lien volume – prix spot | −0,12 solaire, −0,17 éolien | mesuré, non branché | mesuré par le générateur ; effet de quelques centimes | — | le brancher et regarder l'écart | si l'effet dépasse 0,2 € |
| Liquidité (années non cotées) | 5,1 % par année d'écart, non couvert | mesuré | écart quadratique moyen entre deux Cal voisins au bout de la courbe, depuis 2024 | chaque semaine | comparer à l'Allemagne, au Royaume-Uni, aux Pays-Bas (5–9 %) | — |
| Coût achat-vente (couverture, roulement) | 0,10 €/MWh dans l'outil Couverture, 0 dans le prix | hypothèse | — | — | tes frais réels de courtage / EEX | à fixer avec toi |

## 3. Les coûts et ajouts

| Paramètre | Valeur aujourd'hui | Nature | Comment c'est calculé | Mise à jour | Comment le challenger | Revoir |
|---|---|---|---|---|---|---|
| Coût des écarts | solaire 2,49, éolien 2,82 €/MWh | mesuré | coût national de la filière sur 12 mois : erreur de prévision × (prix d'écart − spot), avec la meilleure des deux prévisions (la nôtre ou celle de RTE) | chaque mois | un parc seul paie plus : traité à part (réglage « taille du portefeuille ») | à traiter à part |
| GO | 1,81 €/MWh | mesuré | prix moyen courtier (Commerg), AIB renouvelable, années du ténor | chaque semaine | comparer aux enchères EEX des GO françaises | — |
| Marge | 1 €/MWh | choix | — | — | — | à chaque offre |
| Dégradation solaire | 0,4 %/an | hypothèse | valeur typique des panneaux | — | sur des parcs mesurés | si on a des données de parc |
| Actualisation | 0 % (valeurs en euros d'aujourd'hui) | choix | — | — | — | si les PPA s'allongent |

## 4. Comment revoir tout ça, et quand

- **Chaque jour (automatique)** : forwards, volatilités, GO, capture du parc, tableau des seuils.
- **Chaque semaine, le dimanche (automatique)** : générateur, rejeu, ancrage, calibration P75, liens volume–capture, liquidité. La page Méthodologie et data/history/ppa_model_risk.json gardent les erreurs de rejeu.
- **Chaque trimestre (à la main, 15 minutes)** :
  1. vérifier que l'erreur de rejeu reste sous 1 € (solaire) et sous 1 € (éolien) ;
  2. vérifier que la calibration P75 reste entre 65 et 85 % ;
  3. regarder la sensibilité du prix capté (si elle tombe sous 0,8, la prime solaire remonte) et la volatilité des forwards hors période de crise.
- **Chaque année, en janvier** : une année complète s'ajoute. Rejouer, revoir l'ancrage et les paramètres du Monte-Carlo complet, revoir les choix (prudence, marge, dégradation).
- **À chaque offre** : règle d'arrêt et seuil du contrat, couverture prévue, marge, coût des écarts du parc.

## 5. Ce qui n'est pas modélisé

- La forme horaire à l'intérieur de l'année dans le Monte-Carlo (elle est dans le prix central, pas dans la prime).
- Le risque de contrepartie, les changements de réglementation (règles du complément de rémunération, écrêtement réseau).
- Le coût des écarts propre à un parc (à part).
- Les produits de couverture sur mesure (écarts de prix capté, options sur les heures négatives).
