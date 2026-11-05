# Chapitre 6 à l'oral — la France couplée ou coupée, version complète

*Pour Tom · 1er novembre 2026, complété le 5 novembre (argent, facture, robustesse, autres sources) · à lire à voix haute, environ 30 minutes*

## 1. Deux mots à bien comprendre
On reprend les deux villages et le camion du chapitre 5.
- **Couplée** : le camion a encore de la place. Les deux villages ont **le même prix**.
- **Coupée** : le camion est plein. Chaque village garde **son propre prix**, et l'écart va au propriétaire du camion
  (la rente de congestion).

**Comment on compte.** Il y a deux règles, et il faut toujours dire laquelle on utilise.
- **Au centime près** (la règle de la CRE) : deux prix sont égaux si l'écart est sous 0,01 €. Nos taux
  France–Allemagne : 49 % en 2021, 34 % en 2022, 29 % en 2023, 14 % en 2024, 11 % en 2025. Ceux de la CRE : 49, 34,
  29, 14 et 10 %. Ils retombent les uns sur les autres.
- **À 1 € près** (`calc.py`) : plus tolérant. Il compte comme « presque égaux » des prix séparés par quelques
  centimes d'arrondi ou par une petite congestion. Exemple : « couplée avec Core » passe de 10 % à 17 % en 2025
  (dossier couplage).

Ce chapitre utilise surtout la règle à 1 €, parce que c'est celle du schéma qui suit. Quand on parle des « états de
couplage » (couplée avec Core, coupée de tous), c'est la règle au centime.

## 2. La France s'est séparée de l'Allemagne
![France et Allemagne](../img/10_france_allemagne.png)

La courbe bleue : la part des heures où la France et l'Allemagne sont à **moins de 1 €** l'une de l'autre (`calc.py`,
prix ENTSO-E).

| 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (janv.–oct.) |
|---|---|---|---|---|---|---|
| 57 % | 54 % | 39 % | 46 % | 25 % | 17 % | 19 % |

En 2020, plus d'une heure sur deux, les deux pays avaient presque le même prix. En 2025, moins d'une heure sur cinq.

La courbe orange : la part des heures où la France est **moins chère d'au moins 5 €**. Elle passe de **8 %** en 2020
à **63 %** en 2025, puis **52 %** sur janvier–octobre 2026.

**Les prix moyens annuels** (ENTSO-E, dossier couplage) :
- 2020–2021 : prix proches, la France souvent un peu plus chère ;
- 2022 : crise, la France plus chère (277 € contre 236 €), elle importe ;
- 2024 : **58 € contre 79 €** ; 2025 : **61 € contre 90 €**.

RTE (bilan 2025) le dit aussi : les prix français se sont « largement découplés de ceux de l'ensemble des pays
voisins ».

**Pourquoi** (couplage_europeen.pdf, page 23, « Les causes ») — plusieurs causes à la fois :
- **plus de surplus** : nucléaire disponible de 33,8 GW en 2022 à 46,9 GW en 2025 ; éolien + solaire de 6,5 à 9,4 GW
  en moyenne ; consommation basse (50,7 GW en moyenne en 2025) ;
- **moins de place sur les lignes Core** : limite d'export de la France (JAO) de 9,2 GW (2023) à 5,4 GW (2025) ;
- **des lignes Core sous-utilisées** : les gestionnaires n'ont donné que 54 % de la capacité de leurs lignes les plus
  chargées en 2024, au lieu des 70 % exigés (ACER) ;
- **le vent et le soleil allemands** : quand ils débordent, c'est l'Allemagne qui passe sous la France.

Le mécanisme technique qui fait la limite JAO est documenté par Boerman (2026) : la marge réservée aux flux vers
l'Italie sur les lignes Creys–Saint-Vulbas, près de Lyon (chapitre 5). Mais **aucune source publique ne chiffre la
part de chaque cause** dans le découplage, ni dans la baisse de la limite (dossier couplage, page 23).

**L'image.** Le village A produit de plus en plus de pommes, et le camion rétrécit. Il est plein de plus en plus
souvent.

## 3. Quand la France est coupée, elle est presque toujours la moins chère
**Deux heures sur trois.** En 2025, la France est moins chère que l'Allemagne environ deux heures sur trois.
Le chiffre exact dépend de la règle :
- **68 %** des heures si on compte toute heure où la France est sous l'Allemagne, même d'un centime (dossier
  couplage, frontière par frontière) ;
- **67 %** dans le débrief du 31 octobre ;
- **63 %** si on exige au moins 5 € d'écart (`calc.py`, 5 460 heures).

Dans ces heures, le prix moyen est d'environ **58 € en France contre 103 € en Allemagne** (débrief), soit 45 €
d'écart.

**Et quand la France est plus chère ?** En 2025, ça arrive environ 1 800 heures (1 822). On pourrait croire que la
France manque d'électricité. Non : le dossier couplage montre qu'elle **exporte dans 96 %** de ces heures (7,7 GW en
moyenne). C'est l'Allemagne qui déborde de vent et de soleil : l'éolien et le solaire y couvrent **64 %** de sa
consommation dans ces heures (contre 36 % quand la France est moins chère), et son prix est négatif dans **23 %** de
ces heures.

**Coupée de tous, en étant la plus chère : jamais depuis 2024.** Quand on compare la France à **tous** ses voisins,
elle n'est jamais à la fois coupée de tous et la plus chère : **0 heure** en 2024 et 2025 (couplage_europeen.pdf,
page 9). Mais attention : face à la **Belgique et l'Allemagne seules**, la France importe encore à pleine ligne en
étant plus chère qu'elles environ **1 %** du temps (le cas 4 du chapitre 5 : 0,8 % en 2024, 0,7 % en 2025,
`cases_hist.json`). Ce sont des heures où le prix allemand est négatif, pas des heures de manque.

**Frontière par frontière, 2025** (couplage_europeen.pdf, page 10) :

| 2025 | Même prix | France moins chère | France plus chère | Prix moyen du voisin |
|---|---|---|---|---|
| Allemagne | 11 % | 68 % | 21 % | 89 € |
| Belgique | 11 % | 72 % | 17 % | 83 € |
| Espagne | 38 % | 34 % | 28 % | 65 € |
| Italie Nord | 4 % | 96 % | 0 % | 116 € |
| Suisse | 0 % | 91 % | 9 % | 102 € |
| Grande-Bretagne | 0 % | 80 % | 20 % | 94 € |

Prix français moyen 2025 : 61 €. Sources : ENTSO-E, Elexon ; calcul PowerKlock.

**Comment le lire.**
- L'**Espagne** est la seule voisine encore souvent au même prix : France et péninsule Ibérique forment un même bloc
  exportateur, coupé du reste.
- L'**Italie** est presque toujours plus chère : c'est là que la France vend le plus (26,2 TWh en 2025, RTE).
- La **Suisse** et la **Grande-Bretagne** n'ont presque jamais le prix français : elles sont hors du couplage.
- La CRE trouve la même chose (rapport de surveillance 2025) : France égale à l'Espagne « environ 33 % du temps, 10 %
  pour la Belgique et l'Allemagne et 4 % pour l'Italie ». Notre 38 % pour l'Espagne est un peu plus haut ; le dossier
  n'explique pas cet écart de 5 points.

## 4. Même coupée, la France suit l'Allemagne
C'est le point le plus surprenant du chapitre.

On prend les heures coupées de 2025 et on les sépare en deux, selon le vent **allemand** (débrief du 31 octobre) :

| Heures coupées 2025 | Prix France | Prix Allemagne | Export vers Core |
|---|---|---|---|
| Vent allemand faible | **67,5 €** | 123 € | 4,5 GW |
| Vent allemand fort | **42,4 €** | 82 € | 4,5 GW |

La ligne vers Core est pleine dans les deux cas : la France y exporte la même chose. Pourtant, le prix français bouge
de 25 € avec le vent allemand.

**Pourquoi ?** La France a d'autres portes de sortie :
- l'**Italie**, la **Suisse**, la **Grande-Bretagne**, l'**Espagne**.
- Quand le vent allemand tombe, le prix allemand monte. Les pays autour (Italie, Suisse…) voient leurs prix monter
  aussi, et paient plus cher l'électricité française qui leur arrive par les autres frontières. Le prix français
  monte.

**L'image.** Le village A a un camion vers B, plein. Mais il a aussi des charrettes vers C, D et E. Quand les pommes
manquent en B, les prix montent aussi en C, D et E. Les charrettes vendent plus cher, et le prix monte en A.

**Le lien avec la recherche.** C'est ce que Stiewe, Xu, Eicke et Hirth appellent la **cannibalisation
transfrontalière** : le vent des voisins fait baisser la valeur de nos éoliennes presque autant que notre propre vent
(on le détaille au chapitre 7).

## 5. Le vent tombe surtout dans les heures coupées
Part de la production éolienne française tombée dans des heures où la France est séparée de l'Allemagne. Il y a
**deux définitions**, et deux sources :

| | 2021 | 2023 | 2024 | 2025 |
|---|---|---|---|---|
| Heures « coupées » (débrief du 31 octobre) | – | 18,5 % | 49 % | **67,5 %** |
| Indicateur prévisible (débrief) | – | 17 % | 39 % | 66 % |
| Heures où la France est au moins 5 € sous l'Allemagne (couplage_europeen.pdf, page 29) | **8 %** | – | 49 % | **68 %** |

- Le **débrief** compte les heures « coupées » ; le fichier ne détaille pas la règle exacte utilisée.
- Le **dossier couplage** compte les heures où la France est **au moins 5 €** moins chère que l'Allemagne.
- Les deux donnent à peu près la même chose en 2024 et 2025 : **environ deux tiers** du vent français de 2025.
  Retiens « 67,5 à 68 % selon la définition ».
- En **2021**, ce n'était que **8 %** : le vent français tombait presque toujours dans des heures au prix de
  l'Allemagne.

(À ne pas confondre avec les 68 % de la section 3, la part des **heures** où la France est moins chère que
l'Allemagne : même chiffre par hasard, autre mesure.)

L'**indicateur prévisible**, c'est le surplus français au-delà de la limite d'export Core, calculé à l'avance. Il
suit très bien la réalité, surtout en 2025.

**Pourquoi c'est logique.** Le vent souffle souvent longtemps, et sur toute l'Europe en même temps. C'est justement
quand il y a du vent que la France a le plus de surplus, donc que la ligne est pleine. Le MWh éolien vaut alors le
prix français, pas le prix allemand.

C'est pour ça que notre générateur de scénarios a **deux régimes**, « couplée » et « coupée ». Il choisit le régime de
chaque heure en comparant le surplus français à la limite d'export JAO de l'heure.

## 6. Et si la France était isolée ? Une estimation de modèle
**La question.** Le couplage a-t-il fait monter le prix spot français ?

Pour y répondre, il faudrait connaître le prix d'une France **sans aucun échange**. Ce monde n'a jamais existé. On
doit donc l'**estimer** avec un modèle. Tout ce qui suit est une estimation, pas une observation.

**La méthode, en quatre étapes** (dossier couplage, `methodologie.md`) :
1. **Le volume demandé aux centrales pilotables** (nucléaire, lacs, STEP, gaz, charbon, fioul), d'après RTE éCO2mix :
   consommation + exports nets − éolien − solaire − fil de l'eau − bioénergies.
2. **La courbe apprise.** Un modèle apprend, sur environ 60 000 heures (2020–2026), le prix en fonction de ce volume,
   du nucléaire disponible, du coût du gaz et du charbon, et du moment (mois, heure, week-end). Le modèle est forcé
   à monter avec le volume et avec le prix des combustibles.
3. **La France isolée.** Même heure, mêmes centrales, même vent, même soleil, mais **exports = 0**. On relit la courbe
   à ce volume plus petit.
4. **Les bornes physiques.**
   - Sous le minimum nucléaire (63 % du nucléaire disponible en 2024–2025), il faut écrêter le surplus : le prix vaut
     alors le prix négatif médian de l'année (environ 0 €).
   - Au-dessus de toute la capacité, c'est une pénurie : on compte ces heures à part.

**L'image.** C'est comme estimer le prix des pommes du village A si le pont était coupé. On connaît la courbe des
vendeurs de A. On regarde à quel prix ils vendraient s'il fallait tout écouler sur place.

**La validation.** On vérifie le modèle sur les heures coupées, où le prix réel est déjà celui du marché français
seul, avec un export fixé par la limite du réseau (la France y exporte en médiane 92 % de sa limite en 2025). Chaque
heure est prédite par un modèle qui ne l'a jamais vue : on coupe les données en 12 blocs de mois entiers, et chaque
bloc est prédit par un modèle appris sur les 11 autres.

| Année | Heures coupées | Prix réel | Écart moyen absolu | Biais |
|---|---|---|---|---|
| 2020 | 2 003 | 26 € | 9,6 € | +2,5 € |
| 2021 | 1 797 | 97 € | 19,5 € | +2,6 € |
| 2022 | 2 426 | 272 € | **50,2 €** | +5,3 € |
| 2023 | 3 425 | 86 € | 17,1 € | +2,6 € |
| 2024 | 4 901 | 54 € | 14,9 € | +0,9 € |
| 2025 | 4 603 | 56 € | 17,2 € | +0,6 € |
| 2026 (janv.–oct.) | 3 665 | 82 € | 25,5 € | **+8,1 €** |

Source : couplage_europeen.pdf, page 14.

- Une heure prise seule : erreur de **±15 à 20 €** (bien plus en 2022 : 50 €, l'année de crise).
- Biais annuel : **+0,6 à +2,6 €** de 2020 à 2025 (hors 2022 : +5,3 €), et **+8 €** en 2026.
- Le biais est positif chaque année : le modèle surestime un peu le prix isolé. L'effet du couplage est donc plutôt
  sous-estimé, surtout en 2026.

Petite incohérence du diaporama : la page 2 écrit « biais +0,6 à +2,6 € en 2020–2025 », alors que le tableau de la
page 14 donne +5,3 € pour 2022. La fourchette n'est vraie qu'hors 2022 (à moins que la page 2 parle d'une autre
mesure ; le dossier ne le précise pas).

## 7. Les résultats : +38 € en 2025
![Prix réel contre France isolée](../img/11_reel_vs_isole.png)

| Année | Prix réel | France isolée (modèle) | Écart |
|---|---|---|---|
| 2020 | 32 | 19 | +14 |
| 2021 | 107 | 78 | +29 |
| 2022 | 273 | 295 | **−22** |
| 2023 | 96 | 65 | +31 |
| 2024 | 58 | 19 | +39 |
| 2025 | 61 | 23 | **+38** |
| 2026 (janv.–oct.) | 89 | 38 | +51 |

En €/MWh, hors heures de pénurie.

**Comment le lire.**
- **Les années où la France exporte,** le couplage fait monter son prix spot. En 2025, une France isolée aurait eu
  environ **23 €** au lieu de **61 €**. Avec 90 TWh de trop et personne à qui les vendre, le nucléaire aurait modulé
  sans arrêt, et il aurait fallu écrêter environ **8,9 TWh** de surplus.
- **En 2022, c'est l'inverse :** la France importait, et les voisins ont fait **baisser** son prix (−22 €). Ils ont
  aussi couvert **89 heures** où, seule, elle aurait manqué d'énergie.
- **Robustesse :** on refait le calcul en changeant un réglage à la fois (couplage_europeen.pdf, page 30).

| Prix isolé (€/MWh, hors pénurie) | Principal | Plancher bas (prix négatifs profonds) | Garde l'erreur de l'heure | Appris sur les heures coupées |
|---|---|---|---|---|
| 2024 | 19,4 | 13,7 | 19,2 | 20,0 |
| 2025 | 22,7 | 17,5 | 22,8 | 24,7 |
| 2026 (janv.–oct.) | 37,9 | 26,3 | 38,6 | 36,5 |

  En 2025, le prix isolé va de **17,5 à 24,7 €** selon le réglage. Le réglage qui pèse le plus est le **plancher** :
  le prix qu'on donne aux heures où il faut écrêter. La raison : en 2024–2025, **12 à 13 %** des heures isolées sont
  plus basses en volume que tout ce qu'on a vu dans le mois (26 % en 2026). Leur prix vient du plancher, pas des
  données. Dans tous les cas, l'écart avec le prix réel (61 €) reste entre **36 et 44 €**.

**Le paradoxe.** La France est de plus en plus coupée de l'Allemagne, mais l'écart avec une France isolée
**grandit**. Pourquoi ? Même coupée, elle exporte toujours à pleine ligne. Dans l'état « coupée, la moins chère » de
2025, elle exporte **14,1 GW** en moyenne, à **51 €**. Sans ces exports, le modèle donne un prix de l'ordre de **4 €**.

**Les limites, à dire à chaque fois.**
- C'est une **borne théorique à court terme** : même parc, même consommation.
- À long terme, deux effets jouent en sens contraire. Une France isolée en surplus aurait arrêté plus de réacteurs
  (prix plus haut). Ses offres n'auraient plus de coûts d'opportunité européens (prix plus bas). **Le sens net est
  inconnu.**
- **Aucune étude publiée** ne chiffre l'effet du couplage sur le prix français. On ne peut donc pas recouper ce
  chiffre (section 12).

## 8. Et si la France était coupée 100 % du temps ?
C'est l'hypothèse poussée au bout (couplage_europeen.pdf, page 24). Attention à ne pas la confondre avec nos heures
« coupées » : dans celles-ci, la France exporte encore à pleine ligne.
- **Prix spot :** **23 €** au lieu de 61 € en 2025, **19 €** au lieu de 58 € en 2024 (modèle). Bien plus bas que
  pendant nos heures « coupées » (51 € dans l'état « coupée, la moins chère » de 2025), où la France exporte encore
  14 GW.
- **Quand elle manque** (froid, nucléaire indisponible) : des prix bien plus hauts. En 2022, **+22 €** en moyenne
  (295 € isolée contre 273 € réels), et **89 heures** de pénurie.
- **Les producteurs** encaisseraient **22,9 Md€ de moins** en 2025, dont **16,2 Md€** pour le nucléaire.
- **Le surplus serait perdu :** le nucléaire au minimum en permanence, et **8,9 TWh** d'éolien, de solaire ou de
  nucléaire à écrêter en 2025 (page 22).
- **À long terme, ce monde serait différent :** EDF planifierait autrement ses arrêts, on investirait autrement. Notre
  calcul garde le parc réel : c'est un « isolement pour une heure », pas un autre système électrique.

**L'image.** On ferme le pont pour de bon. Les pommes en trop pourrissent au village A en été, et en hiver, quand la
récolte est mauvaise, plus personne ne peut en apporter.

## 9. La comparaison sans modèle
On peut aussi regarder les données sans modèle. On compare les heures où la France est **couplée avec Core** aux
heures où elle est **coupée de tous**, mais **à situation française égale** : même année, même trimestre, même moment
de la journée, même surplus français (par tranches de 2 GW).

| Année | Couplée avec Core (brut) | Coupée (brut) | Allemagne pendant ces heures coupées | Écart à situation égale | Heures coupées comparées |
|---|---|---|---|---|---|
| 2020 | 34 € | 26 € | 23 € | +2 € | 72 % |
| 2021 | 98 € | 90 € | 79 € | +11 € | 64 % |
| 2022 | 281 € | 260 € | 217 € | +23 € | 66 % |
| 2023 | 99 € | 86 € | 86 € | +9 € | 66 % |
| 2024 | 68 € | 54 € | 76 € | +2 € | 39 % |
| 2025 | 74 € | 56 € | 87 € | −2 € | 23 % |
| 2026 (janv.–oct.) | 122 € | 82 € | 108 € | +13 € | 24 % |

Source : couplage_europeen.pdf, page 12 ; `couplage/observed.json`, calcul PowerKlock (ENTSO-E, RTE éCO2mix).

**Regarde la colonne « Allemagne ».** Jusqu'en 2022, quand la France est coupée, l'Allemagne est **moins chère**
qu'elle (23 € contre 26 € en 2020, 217 € contre 260 € en 2022). Depuis 2024, c'est l'inverse : coupée, la France est
**bien moins chère** que l'Allemagne (56 € contre 87 € en 2025). Le sens de la coupure s'est retourné.

**Comment le lire.**
- L'écart brut est grand : **18 €** en 2025. Mais ce ne sont pas les mêmes heures : le vent, la saison et la
  consommation ne sont pas les mêmes.
- À situation égale, l'écart tombe à **−2 à +9 €** en 2023–2025. Il est plus grand en 2021 (+11 €), 2022 (+23 €) et
  2026 (+13 €), des années où le gaz était cher : l'écart en euros grandit avec le niveau des prix.
- **Le prix français dépend d'abord de son surplus.** Le couplage décide surtout s'il rejoint ses voisins ou non.

**Pourquoi les deux chiffres ne se contredisent pas.** La comparaison sans modèle oppose deux mondes où la France
**échange dans les deux cas**. Elle ne dit pas ce que serait une France sans aucun échange. Le +38 € répond à une
autre question : « et si le pont n'existait pas du tout ? ». Attention aussi : en 2025, on ne compare que 23 % des
heures coupées, car beaucoup n'ont pas d'heure couplée semblable.

## 10. Où va l'argent
Si le prix spot français est plus haut grâce au couplage, l'argent ne disparaît pas. Le dossier couplage (calcul
PowerKlock, comparé à la France isolée, couplage_europeen.pdf page 19) donne pour **2025** :

**D'où vient l'argent :**
- la consommation française vaut **17,1 Md€** de plus **au prix spot**. **Ce n'est pas la facture** : les clients
  achètent surtout à terme, avec un ou deux ans de lissage ;
- les acheteurs étrangers paient **10,0 Md€** pour les exports.

**Qui le reçoit :**
- le **nucléaire** : **16,2 Md€** de chiffre d'affaires en plus ;
- l'**hydraulique** : 2,6 Md€ ;
- l'**éolien et le solaire** : **2,8 Md€** ;
- gaz, charbon, fioul et bioénergies : 1,2 Md€ ;
- la **rente de congestion** : **4,5 Md€**, les deux côtés de la frontière réunis.

**Ce que veulent dire ces chiffres** (page 19). Ce sont des **chiffres d'affaires** de marché en plus (prix ×
production réelle − prix isolé × production isolée), **pas des bénéfices**. Dans le monde isolé, les exports retirés
sont pris sur chaque centrale pilotable au prorata de sa production de l'heure, et l'écrêtement sur l'éolien et le
solaire.

**Quatre précautions, une par bénéficiaire :**
- **Nucléaire → EDF**, détenue à 100 % par l'État depuis juin 2023 (EDF, communiqué du 9 juin 2023) : une partie
  revient au contribuable (dividendes, impôts). **Jusqu'en 2025, l'ARENH** vendait une partie du nucléaire à
  **42 €/MWh** : sur cette part, pas de hausse pour le consommateur ni de gain pour EDF. Le 16,2 Md€ est donc un
  **maximum**.
- **Depuis 2026, le VNU** (versement nucléaire universel) prélève les revenus nucléaires d'EDF **au-dessus de
  78 €/MWh**, plus fortement au-dessus de 110 €, et les reverse aux consommateurs. En 2026, le revenu estimé est de
  **66,08 €/MWh** : **rien à reverser** (CRE, délibération 2026-52).
- **Éolien et solaire :** pour les parcs sous contrat (obligation d'achat, complément de rémunération), l'État paie la
  différence entre le tarif garanti et le prix de marché. Un prix plus haut allège la dépense publique. Le soutien à
  l'électricité renouvelable a coûté **6,2 Md€** en 2025 (CRE, délibération CSPE 2026-149) ; sans couplage, il aurait
  été plus élevé, **jusqu'à 2,8 Md€** si tous les parcs étaient sous contrat. La part réellement sous contrat n'est
  pas chiffrée dans le dossier.
- **Rente :** en principe moitié pour RTE, moitié pour le voisin. La part de RTE finance d'abord le réseau ;
  l'excédent est déduit du TURPE (**459,7 M€** en 2025, CRE).

**Année par année** (couplage_europeen.pdf, page 20), en Md€, comparé à une France isolée :

| Année | Consommation française (valeur au prix spot) | Acheteurs étrangers (exports) | Nucléaire (EDF, État) | Hydraulique | Éolien, solaire | Gaz, charbon, fioul, bio | Rente (deux côtés) |
|---|---|---|---|---|---|---|---|
| 2020 | 5,9 | 1,6 | 5,0 | 0,9 | 0,8 | 0,6 | 0,5 |
| 2021 | 10,6 | 4,5 | 11,0 | 1,0 | 1,5 | 0,4 | 1,9 |
| **2022** | **−10,2** | **−2,3** | **−7,5** | **−4,5** | **−0,7** | **−4,5** | **5,6** |
| 2023 | 12,2 | 6,0 | 11,3 | 1,7 | 2,5 | 0,9 | 2,1 |
| 2024 | 16,8 | 8,4 | 15,4 | 3,0 | 2,6 | 1,2 | 3,3 |
| 2025 | 17,1 | 10,0 | 16,2 | 2,6 | 2,8 | 1,2 | 4,5 |
| 2026 (janv.–oct.) | 17,7 | 10,5 | 17,0 | 2,5 | 3,2 | 1,4 | 4,5 |

**Comment le lire.**
- **De 2020 à 2026, sauf 2022**, le schéma est le même et grandit : la consommation française vaut plus au prix spot,
  les étrangers paient, le nucléaire encaisse l'essentiel.
- **2022, le bloc inversé.** Tout change de signe. La France importe : la consommation française vaut **10,2 Md€ de
  moins** au prix spot, les producteurs encaissent moins, et les exports nets sont négatifs (c'est la France qui paie
  l'étranger). Le couplage a **protégé** le consommateur cette année-là.
- **La rente, elle, reste positive en 2022**, et c'est même son record (**5,6 Md€**). Normal : la rente n'existe que
  parce qu'il y a des échanges, et en 2022 les écarts de prix étaient énormes. Le camion gagne de l'argent dans les
  deux sens.
- **2026** (dix mois seulement) dépasse déjà 2025 : le gaz est cher chez les voisins, et la France exporte toujours
  environ 11 GW.
- Ce sont des montants **au prix spot**. La facture des ménages suit avec un à deux ans de retard, et passe par
  l'ARENH puis le VNU (section 11).
- Les deux côtés du tableau ne tombent pas pile : 27,1 Md€ payés contre 27,3 Md€ reçus en 2025 ; l'écart va jusqu'à
  environ 1 Md€ en 2022. Une partie vient des arrondis ; le dossier n'explique pas le reste. À dire si Tom fait
  l'addition.

**L'image.** Le village A vend ses pommes plus cher grâce au pont. Les habitants de A paient leurs pommes plus cher
aussi, mais les vergers (surtout celui de l'État) encaissent plus, et le péage du pont rembourse une partie de
l'entretien des routes.

## 11. Du spot à la facture : le chemin des prix à terme
**La facture des ménages n'est pas le prix spot** (couplage_europeen.pdf, pages 25 et 26).

**Jusqu'à fin 2025 : l'ARENH.** La CRE l'écrit : « En 2025, l'ARENH couvrait **43,8 %** de la consommation d'un
consommateur aux TRVE au prix de **42 €/MWh** inchangé depuis 2012 ». Cette part de la facture ne dépendait pas du
marché.

**Depuis le 1er janvier 2026 :** l'ARENH a pris fin. Le tarif réglementé (TRVE) achète toute son énergie sur le
marché, « lissé de manière régulière sur deux ans » en produits annuels base et pointe. Résultat : **63,9 €/MWh** en
moyenne pour 2026, contre **103,0 €/MWh** pour 2025 (CRE, délibération TRVE 2026-06).

**Le VNU** remplace l'ARENH : l'État taxe les revenus nucléaires d'EDF au-dessus de 78 €/MWh et reverse aux
consommateurs. En 2026, revenu estimé **66,08 €/MWh** : rien à reverser (CRE, délibération 2026-52).

**L'image.** Le client ne fait pas ses courses au marché du jour. Il a un abonnement, dont le prix a été fixé en
moyenne sur les deux années précédentes. Si le marché du jour monte, l'abonnement ne bouge que plus tard, et à
moitié.

**Le prix à terme a-t-il suivi le couplage ?** Le Cal (contrat annuel base), coté l'année avant la livraison
(page 26, SEFE dans la base PowerKlock, et ENTSO-E pour le spot) :

| Livraison | France, Cal coté l'année d'avant | France, spot réalisé | Allemagne, Cal | Allemagne, spot | Écart FR − DE, Cal | Écart FR − DE, spot |
|---|---|---|---|---|---|---|
| 2024 | 99,8 | 58,0 | 96,8 | 78,5 | +3 | −20 |
| 2025 | 63,8 | 61,1 | 73,4 | 89,3 | −10 | −28 |
| 2026 (janv.–oct.) | 59,5 | 90,1 | 81,0 | 114,0 | −22 | −24 |
| 2027 | 64,8 | – | 102,1 | – | −37 | – |

€/MWh. Cal = moyenne des cotations de l'année avant la livraison (le Cal 2027 : coté du 2 janvier au 29 octobre
2026). Source : `couplage/forwards.json`.

**Comment le lire.**
- **Le forward a intégré le découplage**, année après année : écart France − Allemagne de **+3 €** pour 2024, **−37 €**
  pour 2027.
- **Il se trompe dans les deux sens :** 2024, 100 € coté pour 58 € réalisés ; 2026, 60 € cotés pour 90 € réalisés.
  Pas d'écart systématique avec le spot.
- **Ce qu'on ne peut pas mesurer :** le forward d'une France isolée n'a jamais existé. On sait que le spot couplé
  passe dans le forward, avec un à deux ans de décalage. On **ne sait pas chiffrer l'effet du couplage sur la
  facture**. Le dossier ne trouve pas non plus de chiffre officiel sur la part de l'énergie dans la facture d'un
  ménage.

## 12. Ce que disent les autres
Le dossier a cherché d'autres estimations (couplage_europeen.pdf, page 28) :
- **CRE, rapport sur les interconnexions (2024), p. 6** : l'intégration a permis « de limiter les différentiels de prix
  entre la France et les pays limitrophes au bénéfice des consommateurs français ». Cela vaut pour les années
  d'import (2022) et via la rente reversée au TURPE. La CRE ne chiffre pas l'effet sur le prix spot les années
  d'export.
- **CRE, même rapport, p. 41** : le mécanisme ibérique (le plafonnement du prix du gaz en Espagne et au Portugal)
  n'aurait pas été viable en France seule, car « un prix de gros de l'électricité français artificiellement baissé
  aurait conduit à des exports massifs vers les pays voisins ». C'est exactement notre mécanisme, dit par le
  régulateur.
- **Ambec et Crampes** (Toulouse School of Economics) : « France has benefited amply from the market ».
- **ACER** (Final Assessment of the EU Wholesale Electricity Market Design, avril 2022, p. 21) : les échanges
  transfrontaliers ont rapporté environ **34 Md€** à l'Europe en 2021, comparé à un monde sans interconnexions.

**Ce qui manque.** Aucune estimation publiée de l'effet du couplage sur le **prix français**, ni du partage entre
consommateurs, producteurs et État, n'a été trouvée. Nos montants sont les seuls du dossier qu'on ne peut pas
recouper. Le **sens** de l'effet est solide (un pays qui exporte voit son prix tiré vers celui de ses acheteurs) ;
l'**ordre de grandeur** est une estimation de modèle (page 27).

## 13. Ce que ça change pour un PPA
- **Un MWh éolien vaut le prix de la zone quand la ligne a de la place, et seulement le prix français quand elle est
  pleine.** En 2025, deux MWh éoliens sur trois sont tombés dans des heures coupées (67,5 à 68 % selon la
  définition ; 8 % en 2021).
- **Même coupée, la France suit les voisins.** Un modèle qui ignore le vent allemand se tromperait sur le prix des
  heures coupées.
- **La limite d'export est un risque du PPA.** Si elle remonte (nouvelles lignes), la France rejoint plus souvent ses
  voisins, et la capture remonte. Si elle baisse encore, l'inverse.
- **Le forward a déjà intégré le découplage** : l'écart Cal France − Allemagne passe de +3 € (livraison 2024) à
  −37 € (livraison 2027) (SEFE, dossier couplage).

## À retenir
1. Couplée = même prix que le voisin. Coupée = ligne pleine, deux prix. Toujours dire la règle (au centime ou à 1 €).
2. France et Allemagne à moins de 1 € : 57 % des heures en 2020, 17 % en 2025.
3. Quand elle est coupée, la France est presque toujours la moins chère, et elle exporte quand même à pleine ligne.
4. Même coupée, elle suit l'Allemagne, par l'Italie, la Suisse, la Grande-Bretagne et l'Espagne.
5. Environ deux tiers de l'éolien français de 2025 est tombé dans des heures séparées de l'Allemagne (67,5 % ou
   68 % selon la définition), contre 8 % en 2021.
6. France isolée : 23 € au lieu de 61 € en 2025, soit +38 € dus au couplage (17,5 à 24,7 € selon les réglages).
   C'est une estimation de modèle, jamais observée, validée année par année sur les heures coupées.
7. Sans modèle, à situation égale, couplée ou coupée change peu le prix : c'est le surplus qui décide.
8. L'argent ne disparaît pas : en 2025, 17,1 Md€ de valeur au spot côté consommateurs et 10,0 Md€ payés par
   l'étranger, reçus surtout par le nucléaire (16,2 Md€, un maximum à cause de l'ARENH) et la rente (4,5 Md€). En
   2022, tout s'inverse, sauf la rente.
9. La facture passe par les prix à terme, lissés sur deux ans (TRVE 2026 : 63,9 € contre 103,0 € en 2025). Le
   forward a intégré le découplage ; l'effet du couplage sur la facture n'est pas chiffrable.
10. Aucune autre étude ne chiffre l'effet sur le prix français ; la CRE, la TSE et l'ACER confirment le sens, pas le
    montant.

## Question pour vérifier
Une heure de mai 2025, la France est coupée de tous ses voisins et la ligne vers Core est pleine. D'un coup, le vent
tombe en Allemagne. D'après toi :
- (a) le prix français monte-t-il, baisse-t-il ou reste-t-il pareil, et par quel chemin ;
- (b) l'export de la France vers Core change-t-il ;
- (c) pourquoi le chiffre « +38 € » ne contredit-il pas l'écart de −2 € trouvé sans modèle ?
- (d) en 2022, presque tout le tableau « où va l'argent » change de signe. Pourquoi la rente, elle, reste-t-elle
  positive ?

## Pour aller plus loin
- CRE, *Rapport de surveillance des marchés de gros 2025*, pp. 79–82 (convergence des prix) —
  https://www.cre.fr/fileadmin/Documents/Rapports_et_etudes/2026/Rapport_de_surveillance_2025.pdf
- RTE, *Bilan électrique 2025* (exports, prix découplés) —
  https://assets.rte-france.com/prod/public/2026-02/Bilan-electrique-2025-principaux-resultats.pdf
- CRE, rapport sur l'utilisation des recettes de congestion 2025 —
  https://www.cre.fr/fileadmin/Documents/Rapports_et_etudes/2026/260407_Rapport_Utilisation_recettes_congestion_2025.pdf
- Stiewe, Xu, Eicke et Hirth, « Cross-border cannibalization » — https://arxiv.org/abs/2405.17166
- CRE, délibération TRVE 2026-06 du 14 janvier 2026 —
  https://www.cre.fr/fileadmin/Documents/Deliberations/2026/260114_2026-06_TRVE_2026.pdf
- CRE, délibération 2026-52 (VNU 2026) —
  https://www.cre.fr/fileadmin/Documents/Deliberations/2026/260226_2026-52_Tarif_unitaire_minoration_du_vnu_2026.pdf
- CRE, versement exceptionnel de RTE au titre de 2022 (1,939 Md€) —
  https://www.cre.fr/actualites/nos-lettres-dinformation/la-cre-fixe-le-montant-du-versement-exceptionnel-de-rte-aux-utilisateurs-de-son-reseau-a-1-939-milliard-d-euros-au-titre-de-2022.html
- CRE, *Rapport sur les interconnexions électriques et gazières* (2024), pp. 6 et 41 (sur cre.fr) ; Ambec et Crampes,
  « France and the European electricity market » (sur tse-fr.eu) ; ACER, *Final Assessment of the EU Wholesale
  Electricity Market Design* (avril 2022), p. 21. Le dossier ne donne pas les liens exacts de ces trois documents.
- Dossier PowerKlock : `docs/discussion/couplage/couplage_europeen.pdf` (pages 10, 12, 14, 19, 20, 23 à 30),
  `methodologie.md` (sections 2, 3 bis et 7), `sources.md`, `forwards.json`, `summary.json` ;
  `docs/discussion/pricing/debrief-2026-10-31.md` (section 4).
