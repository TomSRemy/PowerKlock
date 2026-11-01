# Chapitre 2 à l'oral — capture et cannibalisation, version complète

*Pour Tom · 1er novembre 2026 · à lire à voix haute, environ 15 minutes*

## 1. Un MWh n'a pas la même valeur à toutes les heures
Au chapitre 1, on a vu que le prix change à chaque quart d'heure. Un MWh produit un soir d'hiver vaut beaucoup. Un
MWh produit un dimanche de mai à 13 h vaut presque rien, parfois moins que rien.

Un parc solaire ou éolien ne choisit pas ses heures. Il produit quand il y a du soleil ou du vent. La question est
donc simple : **combien vaut, en moyenne, un MWh de ce parc**, comparé au prix moyen de l'année ?

L'image : **le marchand de glaces sur la plage**. Seul, il vend ses glaces cher. Si vingt marchands arrivent sur la
même plage, à la même heure, le prix des glaces baisse pour tout le monde. Le soleil, c'est pareil : tous les
panneaux de France produisent en même temps, à midi.

![Solaire et prix à midi](../img/05_solaire_midi.png)

Regarde le schéma (heure moyenne, avril à septembre 2025, RTE éCO2mix et ENTSO-E) :
- en haut, la production solaire monte le matin, culmine vers 13 h, redescend le soir ;
- en bas, le prix fait exactement l'inverse : il est au plus bas en début d'après-midi, et remonte le soir quand le
  soleil se couche ;
- les deux courbes sont **en miroir**.

## 2. Le taux de capture : la formule, en mots simples
Trois quantités, pour un parc qui produit une certaine quantité à chaque heure :
- **La valeur du MWh du parc (V).** On multiplie la production de chaque heure par le prix de cette heure, on
  additionne, et on divise par la production totale. C'est une moyenne des prix **pondérée par la production** : les
  heures où le parc produit beaucoup comptent beaucoup.
- **Le prix de base (B).** La moyenne simple des prix de toutes les heures. C'est ce que vaudrait un MWh « plat »,
  produit pareil à toutes les heures.
- **Le taux de capture (c) = V ÷ B.**

Si la capture vaut 1, le MWh du parc vaut le prix moyen. Si elle vaut 0,56, il vaut 56 % du prix moyen.

L'image : **un bulletin scolaire avec coefficients**. La moyenne simple de l'année, c'est B. Mais le parc a mis ses
plus gros coefficients sur les matières où il a les plus mauvaises notes (les midis d'été). Sa moyenne pondérée, V,
est donc plus basse.

**Pourquoi V et B diffèrent.** On peut écrire :
V = B + (lien entre production et prix) ÷ production moyenne.

Ce « lien », les statisticiens l'appellent la **covariance**. En mots :
- si le parc produit plutôt aux heures chères, le lien est positif, et V dépasse B ;
- s'il produit plutôt aux heures bon marché, le lien est négatif, et V tombe sous B.

Le solaire produit aux heures où le prix baisse : le lien est négatif, sa capture passe sous 1.

**La convention du site.** La production aux heures où le prix est négatif ou nul n'est pas payée : ces MWh sont
perdus. Le site publie la capture « payée » : la valeur des MWh produits aux heures à prix positif, divisée par la
base. (Le pricer passe à « non payé seulement si le prix est strictement négatif » : chapitre 3.)

## 3. Les vrais chiffres en France

![Capture par année](../img/04_capture_annees.png)

Capture « payée » (RTE éCO2mix × ENTSO-E, `data/history/fr_capture.json`) :

| | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (janv.–oct.) |
|---|---|---|---|---|---|---|---|
| Éolien | 0,94 | 0,94 | 0,84 | 0,89 | 0,90 | 0,89 | 0,89 |
| Solaire | 0,94 | 0,87 | 1,05 | 0,85 | 0,67 | 0,58 | 0,56 |

Comment le lire :
- **Le solaire s'effondre** : de 0,85 en 2023 à 0,58 en 2025, puis 0,56 sur les dix premiers mois de 2026. Un MWh
  solaire vaut un peu plus de la moitié d'un MWh moyen.
- **2022 est à part** : le solaire est au-dessus de 1. Cette année-là, le soleil produisait pendant des heures chères
  (crise du gaz et nucléaire très bas). C'est pour ça que le générateur de scénarios exclut 2022 de ses années
  d'apprentissage (chapitre 9).
- **L'éolien tient** autour de 0,89 : il perd peu.

**Le lien avec les prix négatifs.** La chute du solaire depuis 2023 suit la montée des heures à prix nul ou négatif
(chapitre 1) : 184 heures en 2023, 735 en 2025. En 2025, ces heures tombaient presque toutes à midi, au printemps et
en été (`cours_detail.md`), c'est-à-dire au cœur de la production solaire.

## 4. La cannibalisation : les parcs se mangent entre eux
Quand la capture baisse **parce qu'il y a de plus en plus de parcs**, on parle de **cannibalisation**. Chaque nouveau
panneau ajoute de la production aux mêmes heures, ce qui fait encore baisser le prix de ces heures, pour lui et pour
tous les autres.

Le lien avec le merit order (chapitre 1) : à midi, le solaire pousse les centrales chères hors de l'escalier. La
dernière marche est plus basse, donc le prix aussi. Plus il y a de solaire, plus on descend l'escalier, jusqu'au
sous-sol : les prix négatifs.

**Ce que dit la recherche.**
- **Hirth (2013)**, la référence : la valeur du vent passe de **110 %** à **50 à 80 %** du prix moyen quand sa part
  dans la production passe de 0 à 30 %.
- **Stiewe, Xu, Eicke et Hirth** (30 zones européennes, 2015–2023) : ce sont aussi **les parcs des voisins** qui
  cannibalisent. Pour le vent, un point de pénétration chez les voisins enlève 0,49 point de valeur, presque autant
  que chez soi (0,62). Pour le solaire, c'est même plus fort chez les voisins : 2,38 contre 1,39. On appelle ça la
  « cannibalisation transfrontalière ».

L'image : la plage n'est pas fermée. Les marchands de glaces de la plage d'à côté vendent aussi à vos clients.

## 5. Pourquoi l'éolien résiste mieux, et pourquoi il faut rester prudent
L'éolien perd moins de valeur que le solaire, pour deux raisons :
- **le vent ne souffle pas partout en même temps** : la production est plus étalée que celle du soleil, qui culmine
  partout à midi ;
- **il souffle plus l'hiver et la nuit**, quand on consomme beaucoup et que les prix sont plus hauts.

Mais l'éolien n'est pas à l'abri :
- en 2025, **67,5 %** de la production éolienne française est tombée dans des heures où la France était coupée de ses
  voisins (débrief du 31 octobre) ;
- dans ces heures-là, le vent français fait baisser le prix français, et lui seul ;
- d'une année à l'autre, la valeur réelle de l'éolien a baissé plus que tous nos modèles ne le prévoyaient. Sans
  recalage sur la dernière année réelle, tous les modèles le surévaluent d'environ 2 à 2,7 €/MWh
  (`pricing-v2/choix_v2.md`). C'est une vraie incertitude, pas résolue.

## 6. La méthode en 3 étapes : profil, puis cannibalisation
Ta méthode découpe la différence entre V et B en deux morceaux.

**Étape 1, le forward.** Le prix d'un MWh plat. C'est B (on le verra au chapitre 3).

**Étape 2, le profil : l'effet calendrier.** On découpe l'année en cases « mois × heure » (par exemple : juillet,
13 h). Dans chaque case, on prend la production moyenne du parc et le prix moyen. Le profil, c'est ce que le parc
gagnerait si, **à l'intérieur de chaque case**, les prix n'avaient aucun lien avec sa production. Le soleil produit à
midi l'été, et les midis d'été sont plutôt bon marché : le profil coûte déjà quelque chose.

**Étape 3, la cannibalisation : l'effet foule.** C'est le reste. À l'intérieur d'une même case, les heures où le parc
produit plus sont moins chères, **justement parce que** lui et ses semblables produisent. Un mardi de juillet très
ensoleillé à 13 h est moins cher qu'un mardi de juillet nuageux à 13 h.

L'image : le profil, c'est savoir que **les glaces se vendent moins cher l'été** ; la cannibalisation, c'est
constater que **les jours de grand soleil**, quand tous les marchands sont sur la plage, elles se vendent encore moins
cher.

**Les vrais chiffres du pricer** (`pricing-v2/parametres.md`, calculés avant le passage à la règle « strictement
négatif ») :

| €/MWh | Profil mensuel | Cannibalisation horaire |
|---|---|---|
| Solaire | −5,97 | −26,82 |
| Éolien | +7,87 | −10,68 |

Comment le lire :
- pour le **solaire**, le profil coûte un peu (environ 6 €), mais la cannibalisation coûte beaucoup plus (environ
  27 €) : le problème, ce n'est pas l'été, ce sont les midis où tout le monde produit ;
- pour l'**éolien**, le profil **rapporte** (environ +8 €) : le vent souffle plus l'hiver, quand les mois sont chers.
  Mais la cannibalisation reprend environ 11 € ;
- la somme des deux donne la décote totale du prix capté.

Ici, le profil est mesuré par les forwards des mois comparés au Cal, et la cannibalisation par les heures à
l'intérieur du mois (`parametres.md`).

**Tu n'es pas seul à découper comme ça.** Chatziandreou et Karbach (arXiv 2607.27814, juillet 2026) écrivent le prix
juste d'un PPA pay-as-produced comme : forward base + correction de profil + correction du lien prix-volume. C'est la
même décomposition. Leur calibrage porte sur l'Allemagne 2023–2024, pour des PPA courts.

**Un piège connu, évité par construction.** Modo Energy montre que si la météo du profil de production n'est pas la
même que celle des prix, on sous-estime la cannibalisation, et on surestime les revenus de plus de 10 % en 2045. Le
générateur PowerKlock tire production et prix dans les mêmes semaines réelles : ils sont alignés (débrief du
31 octobre).

## 7. Les pièges : il y a plusieurs captures
**Le plus grand piège : la capture a plusieurs définitions.** Exemple vécu avec l'éolien :
- **0,89** en 2025 : la capture « payée » nationale du site (tableau plus haut) ;
- **0,923** en 2025 : le calcul du pricer, dans sa convention « curt ». On prend la capture des MWh payés mois par
  mois, puis la moyenne pondérée par la production ;
- **0,936 → 0,976** de 2025 à 2026 : la même convention, mais sur janvier–octobre seulement (year to date) ;
- **0,971 → 0,976** : d'un seul bloc sur janvier–octobre ;
- **0,891 → 0,888** : avec toute la production comptée, même celle des prix ≤ 0.

Aucun de ces chiffres ne vient de RTE : RTE ne publie pas de taux de capture. **On ne compare que des chiffres de même
définition** (`SESSION_DISCUSSION.md`).

**Deuxième piège : le year to date n'est pas l'année entière.** Dans la convention du pricer, l'année entière finit
toujours un peu sous le cumul à fin octobre : 0,906 en 2024 et 0,923 en 2025. Les deux derniers mois changent donc le
résultat ; on n'a pas isolé précisément pourquoi. Pour pricer, on s'ancre sur une année civile complète, pas sur un cumul partiel.

**Troisième piège : la base.** La capture dépend du prix moyen choisi : spot de l'année, forward, ou spot des seules
heures payées.

**Quatrième piège : un parc n'est pas la France.** Un vrai parc n'a pas le profil national. Sa capture peut s'écarter
de plusieurs points selon sa région et son orientation. Test sur les régions RTE en solaire : partir du national et
ajouter l'écart propre du parc se trompe de 1,2 point, contre 5,5 points en regardant le parc seul
(`parametres.md`).

**Une nuance utile : la décote est surtout un montant en euros.** Quand le prix de base monte d'un euro, le prix capté
monte d'environ 0,96 € en solaire et 0,95 € en éolien (même mois d'une année sur l'autre, trois dernières années,
`parametres.md`). Autrement dit, la décote en euros bouge peu quand les prix montent. Elle se comporte moins comme un
pourcentage fixe qu'on pourrait le croire. C'est mesuré, pas certain : sur 2024–2025 seul, on trouve 0,84 en solaire.

## À retenir
1. Capture = valeur du MWh du parc ÷ prix moyen. En dessous de 1, le parc produit plutôt aux heures bon marché.
2. Le solaire est passé de 0,85 (2023) à 0,58 (2025) et 0,56 (2026, janvier–octobre). L'éolien tient vers 0,89.
3. Cannibalisation : plus il y a de parcs qui produisent aux mêmes heures, plus ces heures sont bon marché. Les
   parcs des voisins comptent presque autant que les nôtres.
4. Méthode en 3 étapes : forward, profil (l'effet calendrier), cannibalisation (l'effet foule). En solaire, c'est la
   cannibalisation qui coûte le plus.
5. Toujours dire quelle capture on utilise, et ne comparer que des chiffres de même définition et sur des années
   complètes.

## Question pour vérifier
Imagine qu'on ajoute beaucoup de batteries en France, qui se chargent à midi et se déchargent le soir.
- (a) Qu'arrive-t-il, d'après toi, au prix de midi et à la capture solaire ?
- (b) Lequel des deux morceaux bouge le plus : le profil ou la cannibalisation ?
- (c) Un collègue te dit : « la capture éolienne 2026 est de 0,976, donc mieux qu'en 2025 (0,923) ». Qu'est-ce qui
  cloche ?

## Pour aller plus loin
- L. Hirth (2013), « The market value of variable renewables », *Energy Economics* —
  https://cadmus.eui.eu/bitstream/handle/1814/27135/RSCAS_2013_36.pdf
- Stiewe, Xu, Eicke et Hirth, « Cross-border cannibalization » — https://arxiv.org/abs/2405.17166
- Pexapark, « How do you account for cannibalization? » —
  https://help.platform.pexapark.com/en/articles/9577860-how-do-you-account-for-cannibalization
- Modo Energy, « Capturing cannibalisation » — https://forecastdocs.modoenergy.com/docs/capturing-cannibalisation
- Chatziandreou et Karbach (juillet 2026), arXiv 2607.27814 — https://arxiv.org/abs/2607.27814
- Dossier PowerKlock : `data/history/fr_capture.json`, `fr_regional_capture.json`,
  `docs/discussion/pricing-v2/parametres.md`, `docs/discussion/pricing/debrief-2026-10-31.md`.
