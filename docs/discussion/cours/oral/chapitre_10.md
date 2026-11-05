# Chapitre 10 à l'oral — tester honnêtement, version complète

*Pour Tom · 1er novembre 2026 · à lire à voix haute, environ 15 minutes*

## 1. Pourquoi tester
Un pricer donne toujours un chiffre. Et un chiffre a toujours l'air juste. La seule façon de savoir si une méthode
est bonne, c'est de regarder ce qu'elle aurait dit **dans le passé**, et de comparer avec ce qui s'est vraiment passé.

Tout ce qu'on a décidé au chapitre 9 (l'ancrage, la pondération, le refus des analogues) vient de ces tests. Ce
chapitre dit comment on teste, et surtout jusqu'où on peut croire un test.

## 2. Le rejeu sans fuite
**L'image.** Un prévisionniste météo qui veut savoir s'il est bon ne regarde pas ses prévisions d'hier avec la météo
d'aujourd'hui sous les yeux. Il ressort ses vieilles prévisions, telles qu'il les avait faites, et il les compare à
ce qui est arrivé.

**Chez nous.** On fait semblant d'être fin 2022. On oublie tout ce qui s'est passé après. On price 2023, 2024 et 2025
avec seulement ce qu'on savait alors. Puis on compare au réel. C'est le **rejeu**.

**« Sans fuite » veut dire : aucune information du futur ne doit entrer.** Une fuite, c'est comme un élève qui a vu
les réponses de l'examen : sa note ne dit rien de ce qu'il sait. Concrètement (`scripts/ppa_model_risk.py`) :
- la règle de prix n'apprend que sur les **années complètes connues** à la date du pricing ;
- le parc de l'année livrée est **estimé** avec ce qu'on savait alors, pas lu dans les données réelles ;
- l'ancrage se fait sur la dernière année connue à cette date, exactement comme aujourd'hui ;
- la limite d'export JAO des jours tirés est ramenée au niveau de la dernière année connue.

**Un exemple de ce qui serait une fuite.** On a essayé de donner au générateur la vraie limite JAO de l'année livrée
(un « oracle », qu'on ne peut pas connaître à l'avance). Ça n'a même pas expliqué l'erreur de l'éolien (2,59 contre
2,62, débrief du 31 octobre). Mais si ça avait aidé, on n'aurait pas pu le garder : on ne connaît pas la limite de
2028 aujourd'hui.

## 3. Les 9 cas
**La grille.** Livraisons 2023, 2024, 2025 et 2026 (mois complets seulement), pricées **1, 2 ou 3 ans avant**. Ça
ferait 12 cas. On garde seulement ceux dont la dernière année connue est 2022 ou après, parce qu'avant, il n'y a pas
de limites JAO et le marché était dans un autre régime. Trois cas tombent (2023 pricée 2 ou 3 ans avant, 2024 pricée
3 ans avant). Il reste **9 cas par filière**.

**L'erreur d'un cas.** Valeur du MWh pricée − valeur réalisée, en €/MWh. Dans les tests du 31 octobre, la
production n'était pas payée aux prix nuls ou négatifs (≤ 0) ; depuis le 1er novembre, le rejeu applique la même
règle que le pricer, arrêt **strictement sous 0 €** (`pricing-v2/parametres.md`). Les chiffres de ce chapitre sont
ceux du 31 octobre, donc avec « ≤ 0 ». On résume les 9 cas par l'**erreur moyenne absolue** : la taille moyenne de l'erreur, sans regarder son
sens. Et on regarde à part le **biais** : la moyenne avec le sens.

**Les résultats du pricer v2** (`choix_v2.md`) : **0,76 €/MWh** en solaire, **0,56** en éolien. Pour comparer, la
moyenne des quatre anciennes méthodes se trompait de 2,59 € en solaire et 2,84 € en éolien.

**D'autres formats, pour ne pas dépendre d'un seul découpage.** Le rejeu, refait chaque semaine, a quatre formats
(`v2_detail.html`, diapo 24) :

| Format | Nombre de cas | Ce que c'est |
|---|---|---|
| Années civiles | **9** | livraisons 2023–2026 pricées 1 à 3 ans avant |
| Points trimestriels | **33** | un pricing à chaque trimestre |
| Glissant 12 mois | **12** | les 12 mois qui suivent la date du pricing |
| Reste + année | **12** | le reste de l'année en cours + l'année civile suivante (ton format habituel) |

Les trois formats de prix comparés en **éolien**, erreur du centre en €/MWh (`v2_detail.html`, diapo 26) :

| Méthode | Années civiles | Reste + année | Glissant 12 mois |
|---|---|---|---|
| v1 | 0,88 | 1,07 | 1,56 |
| **v2** | **0,63** | 0,86 | 1,46 |
| Analogues | 1,63 | 0,75 | 0,85 |
| Mélange 50/50 | 0,89 | **0,68** | 1,03 |

Comment le lire :
- **aucune méthode ne gagne partout** : la v2 gagne sur les années civiles, les analogues et le mélange sur les
  formats glissants ;
- en **solaire**, la v1/v2 est la meilleure dans les trois formats (0,81 / 0,74 / 0,70, même diapo) ;
- le 0,63 de ce tableau et le 0,56 des années civiles plus haut sont la même mesure, sur des tirages différents :
  0,56 est la moyenne de 3 tirages. C'est le bruit des tirages (section 5) qu'on voit ici.

Ces formats glissants ressemblent à ce que tu signes vraiment. Mais le mélange perdait sur les années civiles (0,89
contre 0,63), et son pourcentage aurait bougé d'un pricing à l'autre. Ta règle tranche : on teste sur des **années
complètes**, et on ne change pas le pourcentage d'un mélange.

**Un autre test : le prix prudent tient-il ?** Le prix publié doit tenir dans 3 cas sur 4. Au rejeu, avec le Monte
Carlo complet, il tient dans **78 à 89 %** des cas (fiche des paramètres du 1er novembre). Sur les 33 points
trimestriels, la note du 31 octobre donnait **79 % et 70 %** selon la filière (`v2_detail.html`, diapo 27). On le
verra au chapitre 11.

## 4. Biais contre dispersion
**L'image : deux montres.**
- La première **avance toujours de cinq minutes**. Elle est fausse, mais facile à corriger : tu retires cinq minutes.
  C'est le **biais**.
- La seconde avance un jour, retarde le lendemain. Elle est peut-être juste en moyenne, mais tu ne peux jamais lui
  faire confiance. C'est la **dispersion**.

**Chez nous.**
- L'éolien sans ancrage a un **biais** : environ **+2,6 €**, presque toujours dans le même sens. L'ancrage l'enlève,
  comme on retire les cinq minutes.
- Aucune correction simple n'enlève la **dispersion**.

**L'exemple qui le montre** (débrief du 31 octobre). « Pondération + pente du vent », sans ancrage :
- le biais tombe à **+0,45 €** : presque plus de biais ;
- mais l'erreur moyenne reste **1,93 €**.

Le biais a disparu, la dispersion est restée. Une méthode sans biais n'est pas forcément une bonne méthode.

## 5. Le bruit des tirages : 0,2 €
**Le générateur tire des semaines au hasard.** Si on change le tirage, le résultat bouge un peu. Comme lancer des dés
plusieurs fois : la moyenne n'est jamais exactement la même.

**Ce qu'on a mesuré** (éolien ancré hiver/été, €/MWh, débrief du 31 octobre) :

| Tirage | Modèle publié (v1) | Modèle pondéré |
|---|---|---|
| 1 | 0,84 | 0,71 |
| 2 | 0,77 | 0,64 |
| 3 | 0,71 | 0,48 |

L'écart entre tirages atteint **0,2 €**.

**La règle qu'on en tire.** Un gain ne compte que s'il dépasse **0,2 €**, ou s'il tient sur **tous** les tirages. Le
modèle pondéré passe ce test : il gagne sur chacun des trois tirages. C'est pour ça qu'il a été adopté.

**Plus de tirages ne règle pas tout.** Passer de 30 à 60 années tirées ne bouge le rejeu que de **0,03 €** au plus.
Doubler les tirages ne fait donc pas disparaître le problème : il faut regarder plusieurs tirages différents.

## 6. Les 9 cas ne sont pas indépendants
**Le piège.** On dit « 9 cas », mais les trois horizons d'une même livraison partagent **la même année réelle**. Si
2026 est bizarre, elle est bizarre pour 2026 pricée 1 an avant, 2 ans avant et 3 ans avant. En réalité, on n'a que
**4 années livrées**.

**L'image.** Demander leur avis à neuf personnes, dont trois ont lu le même journal ce matin. Ce n'est pas neuf avis
indépendants.

**La conséquence.** Une seule année atypique, comme 2026, déplace toute la moyenne. On l'a vu au chapitre 8 :
certaines méthodes gagnaient en moyenne mais perdaient 4 à 11 € sur 2026.

## 7. Ton exemple : le 12 mois roulant
**Ta question.** Pour un PPA éolien 2027–2029 signé en novembre, sur quelle capture pricer ? Tu as répondu :
« 0,923, ou le 12 mois roulant (jamais essayé) ».

**En fait, il a été essayé**, fin octobre (commentaire de `scripts/ppa_scenarios.py`, à la ligne d'`ANCHOR`). L'idée :
ancrer sur les **12 derniers mois complets** plutôt que sur la dernière année civile. Résultat, en pricing à fin
octobre, sur **6 cas** :
- solaire : **1,10 → 1,08 €/MWh** ;
- éolien : **1,47 → 1,67 €/MWh**.

Pas retenu.

**Puis je t'ai demandé : « 6 cas suffisent-ils pour trancher ? »** Tu as répondu non. Et c'est juste, pour trois
raisons :
1. **le bruit des tirages** (0,2 €) vaut à peu près l'écart mesuré en éolien, et bien plus que l'écart en solaire ;
2. **les cas ne sont pas indépendants** : plusieurs partagent la même année livrée ;
3. **une année atypique pèse lourd** : avec 6 cas, 2026 compte pour beaucoup.

**Le bon verdict.** On ne peut pas dire que le 12 mois roulant est **pire**. On peut seulement dire qu'il n'est **pas
mieux**. Et quand une méthode n'est pas mieux, on garde celle qu'on a : l'année civile complète, plus simple, et sans
ancrage sur un cumul partiel.

## 8. Comment trancher mieux
Pour vraiment comparer « année civile » et « 12 mois roulant », il faudrait :
- **pricer à chaque fin de mois**, pas seulement fin octobre. On aurait beaucoup plus de cas ;
- le faire **sur plusieurs tirages** ;
- regarder surtout le **biais**, pas seulement l'erreur moyenne : est-ce que l'une des deux se trompe toujours dans
  le même sens ?

C'est ce que les prévisionnistes appellent l'**origine glissante** : on avance le point de départ de la prévision
pas à pas, et à chaque pas on ne s'entraîne que sur ce qui précède. Le manuel de Hyndman et Athanasopoulos l'explique
très bien (lien en fin de chapitre).

Même avec plus de points de départ, il restera le problème des années livrées : les cas d'une même année se
ressemblent. Plus de points aident à mesurer le bruit, pas à inventer des années indépendantes.

## 9. Le surapprentissage du choix
**Le danger le plus discret.** On a testé des dizaines de variantes : le débrief du 31 octobre en liste une
vingtaine. Si on garde celle qui a le meilleur score, on risque de garder celle qui a **eu de la chance** sur ces
quatre années, pas celle qui est la meilleure.

**L'image.** Vingt personnes lancent chacune une pièce cinq fois. L'une fait cinq « pile » d'affilée. Elle n'a pas
une pièce magique : sur vingt essais, un résultat étonnant finit toujours par sortir.

**Nos garde-fous :**
- un **seuil de 0,2 €** : en dessous, c'est peut-être du hasard ;
- des **vérifications sur plusieurs tirages** ;
- une préférence pour les méthodes qui ont **une raison physique**. La pondération par la production en a une : elle
  regarde surtout les heures où le vent produit vraiment. C'est aussi pour ça qu'on l'a gardée ;
- une préférence pour la **simplicité** quand deux méthodes se valent.

**Le choix de chaque semaine est lui aussi un choix.** Chaque dimanche, le rejeu choisit le mode d'ancrage qui s'est
le moins trompé. Si deux modes sont très proches, le choix peut basculer d'une semaine à l'autre, pour une raison de
hasard. D'où ta question du 30 octobre : faut-il un choix **annuel**, avec un historique recalculé et un seuil de
0,2 €, pour que la méthode ne change pas d'une semaine à l'autre ? **Elle est toujours en suspens.** Le seuil de 0,2 €
correspond justement au bruit des tirages qu'on a mesuré.

## À retenir
1. Rejeu = pricer le passé sans tricher, avec seulement ce qu'on savait alors, puis comparer au réel.
2. 9 cas par filière (livraisons 2023–2026, 1 à 3 ans avant), plus des formats trimestriels et glissants. On tranche
   sur les années complètes.
3. Biais = la montre qui avance toujours de 5 minutes (l'ancrage la corrige). Dispersion = la montre qui avance et
   retarde (rien de simple ne la corrige).
4. Le hasard des tirages vaut jusqu'à 0,2 € : un gain plus petit ne prouve rien, sauf s'il tient sur tous les
   tirages.
5. 9 cas, c'est en réalité 4 années livrées. Une année comme 2026 pèse lourd.
6. Le 12 mois roulant (éolien 1,47 → 1,67 sur 6 cas) : « pas mieux », plutôt que « pire ». 6 cas ne suffisent pas.
7. Plus on essaie de variantes, plus on risque de garder la chanceuse.

## Question pour vérifier
- (a) Une nouvelle méthode fait passer l'erreur éolienne de 0,56 à 0,45 €/MWh sur un seul tirage. Tu l'adoptes ?
  Qu'est-ce que tu demandes avant ?
- (b) Une méthode a un biais de 0 € mais une erreur moyenne de 2 €. Une autre a un biais de +0,8 € et une erreur
  moyenne de 0,8 €. Laquelle préfères-tu, et pourquoi ?
- (c) Pourquoi « livraison 2026 pricée 1, 2 et 3 ans avant » ne compte-t-il pas vraiment comme trois preuves ?

## Pour aller plus loin
- Hyndman et Athanasopoulos, *Forecasting: Principles and Practice*, section « Time series cross-validation »
  (l'origine glissante) — https://otexts.com/fpp3/tscv.html
- Barber, Candès, Ramdas et Tibshirani, « Conformal prediction beyond exchangeability », *Annals of Statistics*
  2023 (donner plus de poids aux cas récents) — https://arxiv.org/abs/2202.13415
- Dossier PowerKlock : `docs/discussion/pricing-v2/choix_v2.md` (« Comment on le sait »),
  `docs/discussion/pricing/debrief-2026-10-31.md` (tous les tests et le hasard des tirages),
  `scripts/ppa_model_risk.py` (le protocole du rejeu), `data/history/ppa_model_risk.json` (les erreurs de chaque
  cas, mises à jour chaque semaine).
