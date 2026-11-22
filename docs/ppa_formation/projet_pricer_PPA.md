# Pricer PPA PowerKlock : base de connaissance pour un projet Claude

À charger comme connaissance d'un projet Claude (claude.ai › Projets › Connaissances). Version du 22 novembre 2026.

## Instructions pour l'assistant du projet

- Tu es l'expert du pricer PPA de PowerKlock. Ton interlocuteur est Tom, directeur origination énergie (PPA, agrégation, BESS, marchés France et Europe). Il connaît le métier ; il veut comprendre la méthode à fond, pouvoir l'expliquer à un client ou à un comité, et la remettre en question.
- Réponds en français, en phrases courtes, avec des puces quand il y a plusieurs éléments. Pas de tiret cadratin. Virgule décimale (40,50 €/MWh).
- Appuie chaque réponse sur ce document. Si l'information n'y est pas, dis-le clairement et indique où la trouver (code du site, page Méthodologie, données du dépôt). N'invente aucun chiffre.
- Les prix et forwards changent chaque jour : les chiffres ci-dessous datent du 22 novembre 2026. Quand Tom demande « le prix », rappelle la date et renvoie vers le pricer du site pour la valeur du jour.
- Quand Tom conteste un choix, réponds avec les preuves chiffrées (section 9) et les limites (section 10), sans défendre la méthode au-delà de ce qu'elles montrent.
- Quand une question porte sur une modification de la méthode, distingue ce qui est validé par Tom, ce qui est en ligne mais à trancher, et ce qui est une idée non testée (section 12).

## 1. La méthode en une phrase

Prix PPA = forward du marché mois par mois × taux de capture calculé par le générateur de scénarios − prime de risque mesurée − coût d'écart + garanties d'origine − marge. Publié avec sa fourchette P10-P90 et le ratio de couverture retenu.

## 2. Le prix du 22 novembre 2026

Livraison 2027-2029, parc qui s'arrête strictement sous 0 €/MWh, risque accepté de 25 %.

| €/MWh | Solaire | Éolien |
| --- | --- | --- |
| Cal 2027 / 2028 / 2029 | 110,99 / 62,02 / 57,27 | idem |
| Poids des années (production payée) | 34,9 / 33,3 / 31,8 % | 33,5 / 33,3 / 33,1 % |
| Cal pondéré | 77,61 | 76,91 |
| Profil mensuel | −6,05 | +5,95 |
| Cannibalisation horaire | −25,62 | −11,33 |
| = Valeur captée | 45,94 | 71,53 |
| Prime de risque | −3,84 | −3,09 |
| Coût d'écart | −2,50 | −3,14 |
| Garanties d'origine | +1,90 | +1,90 |
| Marge | −1,00 | −1,00 |
| **Prix PPA** | **40,50** | **66,20** |
| Fourchette P10-P90 | 36,4 à 46,0 | 63,0 à 69,9 |
| Ratio de couverture retenu | 60 % | 95 % |

Méthodes repères affichées à côté (non utilisées pour le prix) : tendance de capacité 41,65 / 63,86 ; forme forward 41,79 / 68,28 ; simulation météo 35,60 / 72,26 ; modèle européen 32,48 / 67,01 ; décote passée P74 28,74 / 69,08.

## 3. Étape 1 : le forward

- Contrats France baseload EEX lus chaque jour. Seuls les produits liquides comptent : mois M+1 à M+3, trimestres Q+1 à Q+4, Cal.
- Chaque mois livré reçoit un prix : le mois coté, sinon son trimestre, sinon le Cal découpé avec la forme saisonnière de la dernière année cotée par trimestre. Chaque année retombe exactement sur son Cal.
- Poids des années : production payée attendue (production × part non arrêtée), dégradation solaire 0,4 % par an, pas d'actualisation.
- Backwardation forte : 2027 porte presque la moitié de la valeur d'un contrat 2027-2029.
- Le taux de capture ne dépend pas du niveau du baseload (130 mois 2016-2026 : effet de 0 point au plus probable, entre −5 et +2 points en solaire pour une baisse de 111 à 62 €). Les heures à prix bas restent fixes en euros quand le gaz baisse.

## 4. Étape 2 : le générateur de scénarios (le cœur)

**Taux de capture** = prix moyen touché par un MWh du parc ÷ baseload, sur les heures payées. Solaire : 101 % en 2019, 88 % en 2023, 71 % en 2025. Le parc solaire français est passé de 9,5 GW (2019) à 30,4 GW (2025).

**Fabrication d'une année future :**

1. Blocs de 7 jours réels tirés dans 2019, 2020, 2021, 2023, 2024, 2025 (2022 exclu), à la même période de l'année (±7 jours), enchaînés selon leur ressemblance (vent, consommation). Chaque bloc garde toutes les variables du même jour : solaire, éolien, consommation, nucléaire, coût du gaz, limite d'export, en France, Allemagne, Belgique, Espagne.
2. Production par GW ramenée au niveau de 2025, puis multipliée par le parc de l'année livrée, qui grandit jour par jour.
3. Parc France : le plus haut entre la trajectoire PPE3 et le rythme de la dernière année. Solaire 42,3 / 48,3 / 54,2 GW, éolien 28,4 / 29,7 / 31,0 GW fin 2027 / 2028 / 2029. Voisins : rythme de la dernière année, plafonné aux cibles 2030 (Espagne 76 GW solaire et 62 GW éolien, Allemagne 215 et 145 GW), jamais en baisse.
4. Batteries ajoutées depuis 2025 (trajectoire RTE) : chargent aux heures creuses, rendent 85 %.
5. Prix de chaque heure : table apprise sur 2024 et 2025 (2025 compte double). Cases : saison (avril-septembre ou non) × moment (0-9 h, 9-17 h, 17-24 h) × part résiduelle régionale. Chaque case donne le prix positif moyen rapporté au coût d'une centrale gaz (gaz ÷ 0,55 + 0,37 × CO2), la chance que le prix soit positif, la profondeur moyenne des prix négatifs en euros.
6. France isolée : quand l'excédent français dépasse la capacité d'export (JAO), une seconde table s'applique ; mélange selon la chance d'être isolé.
7. Couche solaire : répartit les heures nulles ou négatives entre « légèrement négatif » et « franchement négatif ».
8. Arrêt au seuil du contrat ; 23 seuils calculés de −500 à +50 €.
9. 60 années simulées, capture de chaque mois = moyenne.
10. Recalage : solaire aucun ; éolien multiplié par réalisé ÷ modèle sur la dernière année complète, par saison (×0,967 hiver, ×1,057 été).

**Résultat :**

| | 2025 réalisé | 2027 | 2028 | 2029 |
| --- | --- | --- | --- | --- |
| Capture solaire, heures payées | 71 % | 65,0 % | 62,6 % | 60,9 % |
| Part solaire payée | 84 % | 83,5 % | 82,1 % | 81,2 % |
| Capture éolienne | 90 % | 88,8 % | 87,6 % | 87,4 % |

Dans la cascade, la capture solaire 2027 vaut 60,7 % du Cal (et non 65 %) à cause du profil mensuel.

**Tenu constant jusqu'en 2029** : consommation (aucune croissance), nucléaire de 2025, limite d'export, coût du gaz des 30 derniers jours (200 €/MWh), table de prix 2024-2025, profil mensuel de production. Seuls bougent les parcs et les batteries.

## 5. Étape 3 : la règle d'arrêt

- Défaut (convention CRE, validé par Tom le 21 nov. 2026) : arrêt strictement sous 0 €. Une heure à exactement 0 € est produite et vaut 0.
- Prix selon le seuil, solaire / éolien (€/MWh livré) : à 0 € et en dessous 45,65 / 69,43 ; sous 0 € 40,50 / 66,20 ; sous −0,1 € 37,32 / 64,66 ; sous −1 € 36,40 / 64,52 ; sous −5 € 34,22 / 64,37 ; sous −20 € 32,48 / 64,04 ; jamais 30,26 / 63,34.
- Le revenu par MWh produit change très peu ; seul le volume livré change.
- Production solaire vendue à exactement 0 € (quart d'heure) : 0,7 % en 2023, 5,4 % en 2024, 8,2 % en 2025, 9,8 % en 2026. Écart de prix entre « ≤ 0 » et « < 0 » : 0,7 / 2,8 / 4,6 / 9,3 €/MWh livré.
- Erreur du modèle au 75e centile : 0,76 €/MWh avec « ≤ 0 », 2,26 avec « < 0 ».
- Le marché day-ahead est au quart d'heure depuis le 1er octobre 2025 ; le générateur apprend sur l'heure. Il voit 24 % des heures creuses à exactement 0 €, contre 34 % réalisé au quart d'heure. Correction allumée le 22 nov. 2026 au soir (PK_QH_REALISED=1 partout, PK_QH_SPLIT=c2 pour le solaire seulement) : réalisé au quart d'heure ; en solaire, production à 0 € ou moins partagée entre payée à 0 € et arrêtée comme observé sur 12 mois (rejeu : erreur q75 2,45 → 1,58 €/MWh ; en éolien 1,89 → 2,06, donc pas appliquée). Prix solaire « < 0 » environ −1 €/MWh au prochain calcul hebdomadaire.
- Obligation d'arrêt aux prix négatifs : parcs OA de 10 MW et plus depuis le 22 déc. 2025 ; parcs OA et CR de plus de 5 MW le 1er déc. 2026 ; de 1 à 5 MW le 1er mars 2027.
- Conseils : coter les deux clauses ; préférer « à 0 € et en dessous » ; écrire le pas de règlement (quart d'heure) dans le contrat ; si « < 0 » est imposé, prévoir un ajustement d'environ 0,8 €/MWh par point de production réglée à 0 €.

## 6. Étape 4 : le Monte Carlo

- 10 000 tirages, graine fixe (même jour, même prix).
- Aléas : trajectoire du prix de marché autour du forward (volatilité des Cal français, environ 36 %/an pour Cal+1), production (solaire ±6,5 %, éolien ±9 %), lien production-prix (élasticité des scénarios météo), prix capté qui suit le marché en proportion du taux de capture du générateur (aucun coefficient estimé), écart des années non cotées (environ 5 % par an, nul sur 2027-2029).
- Pour chaque futur : ce que rapporte un MWh produit = production × prix capté + résultat de la couverture (part couverte × volume attendu × (Cal − prix réalisé)), divisé par la production.
- Prime de marché = moyenne − P25. Solaire à 60 % de couverture : moyenne 45,9 €, P25 45,4 €.
- L'erreur du modèle n'est pas dans le Monte Carlo : elle est mesurée à part.

## 7. Étape 5 : la prime de risque

| Ligne | Solaire | Éolien | Calcul |
| --- | --- | --- | --- |
| Erreur du modèle | 3,67 | 2,65 | 75e centile des erreurs du générateur sur 184 livraisons de 12 mois (46 départs mensuels depuis janv. 2023 × 4 horizons de 3 à 12 mois), au seuil du contrat. Grandit comme la racine de l'horizon au-delà de 12,8 mois : ×1,25 en 2028, ×1,58 en 2029. Dont biais moyen 1,03 / 0,55 |
| Couverture | 0,14 | 0,25 | Monte Carlo (décomposition de Shapley avec le volume) |
| Volume | 0,43 | 0,97 | Monte Carlo |
| Équilibrage | 0,54 | 0,31 | Dispersion annuelle du coût d'écart, 24 mois |
| Coût de couverture | 0,06 | 0,10 | 0,10 €/MWh de fourchette sur la part couverte |
| Liquidité | 0 | 0 | Années au-delà du dernier Cal |
| Crédit | 0 | 0 | Si une probabilité de défaut est saisie (recouvrement 40 %) |
| Diversification | −1,00 | −1,18 | Écart à la somme simple |
| **Total** | **3,84** | **3,09** | |

Formule : prime = biais moyen + √(erreur du modèle hors biais² + risques de marché² + équilibrage²) + coût de couverture + crédit. Toutes les lignes suivent le niveau de risque choisi (défaut 25 %) : à 10 %, solaire 38,0 ; à 40 %, 42,2.

## 8. Étape 7 : couverture et fourchette

- Le prix capté solaire suit le baseload à environ 60 % (son taux de capture). Couvrir 100 % du volume en Cal est une sur-couverture.

| Part couverte | 0 % | 50 % | 60 % | 80 % | 95 % | 100 % |
| --- | --- | --- | --- | --- | --- | --- |
| Prime solaire | 14,25 | 5,18 | **3,84** | 5,04 | | 7,22 |
| Prix solaire | 30,09 | 39,15 | **40,50** | 39,30 | | 37,12 |
| Prime éolienne | 18,76 | 9,59 | 7,79 | 4,36 | **3,09** | 3,21 |

- Le pricer choisit le ratio qui minimise la prime et l'affiche (« auto 60 »).
- Livraison partielle : couverte avec le forward des mois livrés. Solaire avril à septembre 2027-2029 : 35,91 €/MWh, prime 3,76.
- Fourchette P10-P90 : capture du générateur à ses P10 et P90 (60 années), le reste du prix inchangé. Ne contient pas le risque de prix couvert par le forward. L'historique du benchmark affiche encore l'ancienne fourchette empruntée (solaire 37,7 à 52,1) ; la nouvelle est enregistrée à côté (genLo, genHi) ; bascule à décider.

## 9. Les preuves

**Protocole** : chaque livraison 2023 à 2026 prévue 1, 2 et 3 ans avant, avec les seules données connues alors, 2022 exclu de l'apprentissage, arrêt strictement sous 0 €. Neuf cas par filière.

| Erreur moyenne, € par MWh payé | Solaire générateur | Solaire tendance | Éolien générateur | Éolien tendance |
| --- | --- | --- | --- | --- |
| 1 an | 2,16 | 2,35 | 1,14 | 3,16 |
| 2 ans | 2,71 | 2,58 | 2,15 | 3,14 |
| 3 ans | 3,65 | 9,78 | 0,45 | 4,68 |
| Tous | 2,67 | 4,08 | 1,32 | 3,49 |
| Biais à 3 ans | −0,34 | +9,78 | +0,45 | +0,49 |
| Pire erreur | 6,3 | 13,8 | 3,4 | 5,4 |
| Cas plus proches du réalisé | 6 sur 9 | 3 sur 9 | 7 sur 9 | 2 sur 9 |

Par MWh produit (volume compris) : solaire 3,18 contre 5,91, éolien 1,54 contre 3,27. Part payée solaire : la tendance la surestime de 9 à 15 points à 2 et 3 ans ; le générateur est le seul à suivre la chute de 97 % (2023) à 81 % (2026).

Détail solaire, générateur / tendance (prévu − réalisé) : 2023 à 1 an +0,5 / −3,8 ; 2024 à 1 an +1,1 / +1,8 ; 2024 à 2 ans +2,3 / +1,1 ; 2025 à 1 an +0,8 / −1,3 ; 2025 à 2 ans +1,6 / +6,3 ; 2025 à 3 ans +3,3 / +5,8 ; 2026 à 1 an −6,3 / −2,6 ; 2026 à 2 ans −4,2 / +0,3 ; 2026 à 3 ans −4,0 / +13,8.

**Sept autres approches testées en novembre 2026, aucune meilleure :**

1. Mélanger le générateur avec d'autres méthodes : gain nul ou négatif.
2. Corriger selon le niveau de prix : effet nul.
3. Lire la capture dans les forwards peak : surestime de 5 à 13 points ; peak/base France 1,18 en 2019, 0,90 en 2026 ; peak 2028-2029 cotés non fiables (1,20 et 1,27).
4. Pays voisins à même pénétration (la France de 2029, 13,8 % de solaire dans la consommation, est dans ce que DE, BE, ES, NL ont vécu) : capture d'accord à 2 points, part payée 5 à 6 points plus basse ; pas meilleur que la tendance au rejeu ; garde-fou.
5. Courbe de saturation simple : faux positif (45 % de part payée prévue en 2026, 81 % réalisé).
6. Heures réelles et effet du parc seul (sans ancrage par construction) : 3,2 contre 1,3 € en éolien.
7. Modèle appris (gradient boosting) sur 7 pays : 8,2 contre 3,0 € en solaire ; les heures françaises restent à part (nucléaire) ; grossir de vieilles années crée des surplus jamais vus.

Également tenté pour supprimer l'ancrage éolien : une probabilité « France isolée » heure par heure (meilleure prévision des heures isolées, −20 % d'erreur) : aucun gain sur la capture (+2,21 contre +1,97 € de biais).

## 10. Limites connues

- Neuf cas de test par filière, quatre ans depuis la rupture de 2024.
- Ancrage éolien : compense environ 1,1 €/MWh d'écart sur l'année d'apprentissage et 1,3 € de plus l'année suivante, cause non trouvée. Bruit de tirage : 0,7 €/MWh (30 tirages).
- Erreur du modèle mesurée jusqu'à 12 mois ; extrapolation vérifiée en solaire (rejeu ×1,24 à 2 ans, ×1,53 à 3 ans), hypothèse en éolien (×2,02 et ×0,90 sur 9 cas).
- Partage 0,00 € / −0,01 € imprévisible ; corrigé en solaire par le partage observé sur 12 mois (depuis le 22 nov.), pas en éolien.
- Deux versions défendables du modèle diffèrent de 6 à 10 points de revenu solaire sur 2027-2029 : l'incertitude de modèle solaire est plus large que la prime ne le dit.
- Couche solaire : coefficient de signe inattendu (plus d'excédent, moins de prix très négatifs).
- Fourchette P10-P90 sur 60 scénarios, règle de prix différente de celle du prix central.

## 11. Objections et réponses

- **« Votre prix est trop bas. »** Quelle clause d'arrêt, quel pas de règlement, quel ratio de couverture ? Entre « ≤ 0 » et « < 0 », 5 € d'écart en solaire.
- **« Une droite sur le parc suffit. »** Utilisée trois ans avant, elle a surestimé le solaire 2026 de 13,8 €. Aujourd'hui 41,7 contre 40,5 : elles concordent ; un écart de plus de 2 € est un signal.
- **« Boîte noire. »** Vraies semaines météo, parc PPE3, table de prix lue sur le marché, chaque ligne de prime affichée.
- **« Et si le gaz baisse ? »** La capture ne bouge pas avec le gaz (130 mois). La couverture protège le niveau.
- **« Pourquoi 60 % de couverture ? »** Le MWh solaire suit le baseload à environ 60 % ; couvrir 100 % revient à vendre à découvert 40 % du volume.
- **« Et si une donnée manque ? »** Le site ne publie plus de prix plutôt qu'un prix faux ; un contrôle quotidien (scripts/ppa_guard.py) alerte par mail.

## 12. Historique et état des décisions

**Validé par Tom :**
- 21 nov. 2026 : le générateur de scénarios fixe le prix publié ; arrêt strictement sous 0 € ; prime incluse dans le prix, une barre par risque dans la cascade ; biais passé non retiré de la tendance de capacité et de la forme forward.
- 22 nov. 2026 : mise en ligne (« pousse tout ») de : correction de décembre (année complète seulement une fois terminée ; parc manquant extrapolé, jamais 1 GW) ; horizon glissant (plus de limite 2030) ; parcs voisins jamais en baisse ; pas de repli silencieux sur une autre méthode ; contrôles de fraîcheur des sources ; prime selon l'horizon ; prix capté proportionnel au taux de capture ; ratio de couverture optimal ; livraisons partielles couvertes avec leurs mois ; forme forward avec la bonne règle d'arrêt.

- 22 nov. 2026 au soir (« pousse tout ce qui te paraît bien ») : réalisé au quart d'heure et partage 0 € observé pour le solaire ; chaque Cal = clôture la plus récente entre l'instantané et l'historique des Cal (le pricer avait une séance de retard : 110,99 au lieu de 114,12 pour le Cal 2027 ; sur les données du 20 nov. solaire 40,50 → 41,11, éolien 66,20 → 67,15) ; courbe mensuelle calée sur la moyenne des heures de chaque contrat (mars 743 h, octobre 745 h).

**Bloquant, à faire par Tom :** ajouter le secret GitHub MARKET_API_URL (Settings › Secrets › Actions). Il manque depuis le 21 nov. : la collecte des forwards et des matières premières échoue à chaque passage, les prix restent ceux du 20 nov.

**En ligne mais à trancher :**
- Publier la fourchette du générateur dans l'historique du benchmark.
- Ancrage éolien : le rendre visible dans la cascade, 300 tirages, 12 mois glissants.
- Afficher les deux clauses d'arrêt côte à côte ; brancher le testeur d'offre et le pricer court terme sur le générateur.
- Probabilités sur les 17 graphiques de projection qui n'en ont pas.
- Réécrire la Méthodologie du site (plus de la moitié des phrases sont fausses ou périmées) et nettoyer le code d'essai.

**À mettre à jour à la main** : cibles PPE3, cibles des voisins, trajectoire batteries RTE, quand un texte change. Tout le reste se recalcule seul (jour : forwards, GO, prix ; semaine : table de prix, rejeu, primes, générateur ; année : parc RTE, horizon).

## 13. Glossaire

- **Baseload** : prix moyen de toutes les heures.
- **Cal** : contrat à terme d'une année civile.
- **Taux de capture** : prix touché par le parc ÷ baseload, heures payées.
- **Part payée** : part de la production non arrêtée.
- **Cannibalisation** : baisse du prix quand tous les parcs produisent en même temps.
- **Profil mensuel** : effet des mois de production plus ou moins chers que le Cal.
- **P25 / P75** : seuils franchis une fois sur quatre.
- **P10-P90** : 8 chances sur 10 d'être dedans.
- **Ancrage (recalage)** : multiplication par l'écart réalisé / modèle sur la dernière année.
- **France isolée** : heures où l'excédent français dépasse la capacité d'export.

## 14. Sources et fichiers

- Prix day-ahead : EPEX via ENTSO-E (quart d'heure depuis le 1er oct. 2025). Production et consommation : RTE éCO2mix. Parc France : RTE via ODRÉ. Voisins : Energy-Charts. Forwards : EEX. Export : JAO. Gaz, CO2 : TTF, EUA. GO : Commerg. Coût d'écart : ENTSO-E et prévision du site.
- Code : scripts/ppa_generator.py, scripts/ppa_scenarios.py, scripts/ppa_lab.py, scripts/ppa_error_replay.py, scripts/ppa_daily.py, scripts/ppa_guard.py, js/tool-ppa.js. Données : data/history/ppa_forecast.json, ppa_error_replay.json, ppa_benchmark.json.
- Formation complète avec graphiques : document « Formation : le pricer PPA PowerKlock pas à pas » ; présentation Formation_pricer_PPA_PowerKlock.pptx.
