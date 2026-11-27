# Audit de 7 O'Klock et PowerBrunch (27 nov. 2026)

Branche `fable/newsletter-audit`, rien de poussé. Lecture : le code (`scripts/news_letter.py`, `morning_mail.py`,
`news_digest.py`, `fetch_news.py`, `config/market_context_task.md`), les éditions gardées dans git et les fichiers de
données du dépôt, contre lesquels chaque chiffre des tuiles a été recalculé.

## 1. Périmètre et limites

- Git ne contient que 7 jours d'édition, pas 10 : 16, 19 et 20 nov. (essais), puis 24, 25, 26 et 27 nov. (production,
  15 versions en tout). Aucune édition le lundi 23 nov.
- PowerBrunch : une seule édition existe (essai du jeudi 19 nov., ancienne maquette). La version 2 (27 nov.) n'a jamais
  tourné : sa première sortie réelle est lundi 30 nov.
- Trois rédacteurs se succèdent sur la période : modèle gratuit seul (16 au 24), texte modèle écrit à la main (24),
  contexte de la vue Expert (26), tâche Claude du matin (27). Les notes ci-dessous en tiennent compte.
- Non vérifié : les faits de presse eux-mêmes (pas d'accès aux articles), l'envoi SMTP, le rendu dans Outlook.

## 2. Tableau de notes (sur 5)

| Édition | Pertinence | Exactitude | Sans redite | Clarté | Angle prix FR | Profils distincts | Commentaire |
|---|---|---|---|---|---|---|---|
| 16 nov. (essai) | 2 | 3 | 4 | 2 | 1 | 3 | usine de polypropylène russe et Tempo en tête ; 6 sujets sur 9 sans texte |
| 19 nov. (essai) | 3 | 2 | 4 | 2 | 2 | 4 | « À retenir » = conseils au lecteur ; aucun point du matin |
| 20 nov. | 3 | 4 | 1 | 2 | 1 | 4 | IA absente : extraits bruts, dont un en anglais ; les 14 sujets de la veille repris |
| 24 nov. | 3 | 2 | 3 | 2 | 3 | 4 | titre « Prix du gaz en baisse » avec un PEG à +3,1 % ; point du matin = texte modèle écrit à la main |
| 25 nov. | 2 | 2 | 2 | 3 | 3 | 3 | Cal et PEG de l'avant-veille ; point du matin quasi identique à celui du 24 |
| 26 nov. | 1 | 1 | 3 | 2 | 1 | 3 | offre d'emploi, Kirghizistan, Abou Dhabi ; le texte dit 255 €/MWh, la tuile 289 |
| 27 nov. (envoyée) | 4 | 3 | 4 | 4 | 4 | 1 | bon raisonnement, mais gaz, Cal et décembre de l'avant-veille ; 6 profils identiques |
| PowerBrunch 19 nov. (essai) | 2 | 2 | 3 | 2 | 2 | 1 | deux chiffres de spot contradictoires, conseils, phrases en anglais |

Moyenne 7 O'Klock : pertinence 2,6, exactitude 2,4, clarté 2,4. Le saut du 27 nov. est réel : le point du matin est
devenu une vraie note de marché. Ce qui reste faible est autour : fraîcheur des clôtures, choix d'articles, profils.

## 3. Erreurs relevées, avec preuve

### 3.1 Chiffres

1. **Cal, PEG et contrat mensuel en retard d'une séance, trois matins sur quatre.** L'édition part à 06:01 UTC ; la
   clôture de la veille arrive dans le dépôt à 06:33 UTC (`fetch_fr_market`, commits « data: update FR market »).
   Le dernier passage de la veille est à 17:23 UTC, avant le settlement.

   | Édition | Tuile Cal 27 | Vraie dernière clôture | Tuile PEG | Vrai PEG |
   |---|---|---|---|---|
   | mer. 25 nov. | 114,60 (+0,4 %), clôture du 23 | 116,97 (+2,1 %) | 89,23 (+3,1 %) | 91,34 (+2,4 %) |
   | jeu. 26 nov. | 116,97 (+2,1 %), clôture du 24 | 114,53 (−2,1 %) | 91,34 (+2,4 %) | 86,51 (−5,3 %) |
   | ven. 27 nov. | 114,53 (−2,1 %), clôture du 25 | 116,20 (+1,5 %) | 86,51 (−5,3 %) | 87,02 (+0,6 %) |

   Deux matins de suite le sens affiché est l'inverse de la dernière séance. Le point du matin du 27 en hérite :
   « le gaz a reculé de 5 % lors de la dernière séance », « le Cal 27 recule de 2 %, à 115 €/MWh », « le contrat
   décembre cote 208 €/MWh » et « les prix à terme ne suivent pas ». Or le 26 nov. décembre a pris 9,6 €/MWh
   (208,39 → 218,00) et le Cal 27 1,5 % : la courbe a suivi. C'est l'erreur la plus grave, un lecteur avec un écran
   la voit tout de suite.
2. **26 nov. : le texte contredit la tuile.** Point du matin : « des prix spot à 255,2 €/MWh » ; tuile : 289,44.
   Cause : repli sur le contexte de la vue Expert de la veille (`brief_from_context` accepte un contexte d'un jour).
3. **« Nuageux · prix stables » le 27 nov.** avec un spot à 299 €/MWh, cinquième hausse de suite, cinq fois le niveau
   du 19. La météo du marché ne regarde que la variation sur la veille (seuils −10 % et +20 %) : « Nuageux » du 24
   au 27, pendant que le spot passe de 245 à 299 (91 le dimanche 22).
4. **Heures à prix négatif : trois chiffres pour le même jour.** 19 nov. : la tuile compte 3 h (moyennes horaires
   ≤ 0), le « chiffre du jour » dit 2 h, le fichier du site dit 1,75 h (`negH`, quarts d'heure strictement négatifs).
5. **Jour de 25 heures** : la tuile spot faisait la moyenne de la série (26,32 €/MWh le 25 oct.) au lieu de la moyenne
   publiée (25,34), contre la règle de CLAUDE.md. Corrigé (voir section 7).
6. **Données, hors newsletter** : `data/history/daily/2026-11-21.json` et `2026-11-22.json` ont exactement la même
   série France (90,72 €/MWh les deux jours, les autres zones diffèrent). La « cinquième hausse consécutive » et la
   semaine de PowerBrunch en dépendent.
7. **PowerBrunch du 19 nov.** : titre « le spot recule de 11 % (256 → 229) », tableau juste dessous « Spot France,
   moyenne novembre 210,62, ▲ +26,9 % ». Deux mesures, aucune explication.
8. Texte de secours (`key_facts`) : « le complément est venu du gaz et des importations » alors que la France
   exportait 1,2 GW ce jour-là (26 nov.) ; « moitié moins que le spot » pour un Cal à 39 % du spot ; température
   lue sur les 7 jours à venir (« au-dessus de la normale de 0.2 °C », avec un point décimal) un jour à 3 °C sous
   la normale.
9. Écart nucléaire : `expert_brief` et `what_moved` comparent la disponibilité du 26 à la prévision du 27
   (7,5 GW) ; à date égale l'écart est de 6,6 GW (chiffre du point du matin). Vue Expert : non touchée, à valider.

### 3.2 Phrases de l'IA non soutenues par l'extrait

- 27 nov., titres par profil (modèle gratuit) : commercial « Baisse des prix de l'énergie, nouvelles
  réglementations » (spot au plus haut du mois) ; marchés « Prix spot à 25 ans, EDF multiplie les contrats »
  (l'article parle des 25 ans du marché spot). Ces titres sont écrits à partir de sujets qui ne sont plus affichés.
- 26 nov. : « TotalEnergies Mirny wind to FC » (bouclage financier) devient « un projet éolien associé à une
  technologie de production d'hydrogène ».
- 24 nov., profil commercial : « Prix du gaz en baisse » avec un PEG à +3,1 % ; profil marchés le même jour :
  « Prix de l'énergie en hausse ».
- 19 nov. : « barrages à 50 % de leur niveau décennal » (le titre dit « sous les 50 % de remplissage »).
- L'essentiel (digest), dont la consigne impose « ce que cela change concrètement » : « RTE enfouit 22 km de
  lignes : les habitants bénéficient d'une meilleure sécurité et esthétique » ; « la CRE réduit le budget de
  résilience : les coûts de maintenance seront revus » ; « forge nucléaire : les producteurs d'électricité pourront
  réduire leur dépendance » ; « oléoduc d'hydrogène vert ». Aucune de ces conséquences n'est dans l'extrait.
- Textes « contexte » écrits sans extrait : « Le financement d'une centrale à gaz peut influencer le marché
  énergétique », « Les cours du gaz pour 2027 et 2028 influencent les prix actuels ». Vides.
- 25 nov., point du matin : « le marché mise sur une disponibilité nucléaire en hausse » : cause non donnée par
  les chiffres (le nucléaire était sous la prévision de l'exploitant).
- 26 nov., point du matin : « la disponibilité nucléaire est en hausse, avec 47,0 GW » : c'est la valeur du
  19 nov. (47 001 MW). La série `fr_nuc_avail` est restée figée du 19 au 26 nov. dans le dépôt.

### 3.3 Conseils au lecteur (contraires à l'intention : analyse pure)

- 19 nov. : « Suggérez à vos clients d'opter pour des contrats à long terme », « Adaptez vos positions »,
  « Informez vos clients… orientez-les vers les CEE » ; PowerBrunch : « Suggérez à vos clients de verrouiller des
  tarifs pour 2029 ».
- 27 nov., première version envoyée à 7 h : « Pour un acheteur encore ouvert sur décembre, se couvrir coûte environ
  90 € de moins par MWh que le spot du jour » (retirée à la main à 13 h 20, après l'envoi).

### 3.4 Choix des sujets

- **Sujets hors marché français** : 26 nov. : offre d'emploi Orano (profil marchés) et Assystem (En bref),
  photovoltaïque flottant au Kirghizistan, centrale à gaz d'Abou Dhabi, solaire américain, enchère carbone
  californienne. 25 nov. : avis EEX sur un calendrier, PPA au Pérou, Congrès américain, lancement d'une batterie TCL.
  27 nov., En bref : Forum EnerGaïa, écoscore automobile, fusion nucléaire.
- **Cause principale** : le bonus France (+1,5 à +3 selon le profil) va à tout article d'un média francophone
  (`fetch_news.add_items` ajoute le pays FR dès que la source porte l'étiquette `fr`). Un PPA au Pérou relaté en
  français passe pour français. BORING et FARAWAY ne sont que des malus (−3, −2,5), que ce bonus compense.
- **Articles récents écartés à tort** : la règle « jamais deux fois le même article » comparait chaque titre à
  dix jours de titres avec « deux mots en commun ». Le 27 nov. : 44 des 124 articles récents écartés (« wind farm »,
  « plus », « 000 »), dont l'amendement S06-S10 au Sénat, le sujet réglementaire du jour pour un agrégateur.
  Conséquence visible : 6 des 12 articles choisis par la tâche du matin sont arrivés au lecteur. Corrigé (section 7).
- **Sources faibles** arrivées avec les recherches de presse du 27 nov. : Vietnam.vn, Laodong, Dosya Haber,
  Demócrata, 재경일보 ; « Panne EDF aujourd'hui ? » noté 7,6, « Hausse du Smic… » 8,8, CNBC sur le S&P 500 classé
  géopolitique de l'énergie.

### 3.5 Redites et profils

- Point du matin des 24 et 25 nov. : même plan, mêmes tournures (« Le froid s'installe / s'accentue », « Or le gaz se
  tend », « Le Cal 27 bouge à peine / monte peu : le marché compte / mise sur le nucléaire »).
- 20 nov. : les 14 sujets de l'édition du 19 au soir, repris tels quels (avant l'historique).
- 27 nov. : l'appel d'offres à 1,5 GW apparaît dans l'essentiel, dans les sujets et dans les articles principaux.
- **Profils** : depuis le 25 nov. les articles de la tâche du matin remplacent ceux de chaque profil. Le 27, les six
  profils ont exactement les mêmes 6 articles et les mêmes textes ; seul l'ordre des rubriques change. Les six
  appels au modèle gratuit restent faits, pour un résultat jeté.
- Étiquettes de rubrique fausses le 27 : accord ETS au Parlement = « Renouvelables », EPR2 = « Projets », fusion
  nucléaire = « Transactions ».
- Titres en anglais non traduits dans un courriel en français (3 sur 6 le 27 nov.).

## 4. Audit de la chaîne

**Sélection et score (`score`, `pick`)**
- Bonne base : poids par profil, mots-clés, nombre de médias, fraîcheur, seuil minimal plutôt que du remplissage.
- Faiblesses : bonus France fondé sur la langue (3.4) ; listes noires par titre (FARAWAY ne connaît ni les Émirats,
  ni le Kirghizistan, ni « US ») là où une liste positive (France, voisins interconnectés, niveau UE) serait plus
  courte et plus sûre ; `impact` de `fetch_news` donne 3,0 à « géopolitique », le poids le plus fort.
- `similar` (deux mots en commun) sert aussi dans une même édition : deux parcs éoliens distincts comptent pour
  « le même événement ».

**Filtres**
- BORING et FARAWAY : malus, pas d'exclusion. TEASER : correct. GENERIC : ne voyait que les noms et les infinitifs,
  pas l'impératif (« Surveillez… »). EMPTY : correct. Offres d'emploi : « H/F » était un malus, « F/H » inconnu.

**Consignes (SYSTEM, CONTEXT, digest)**
- SYSTEM demande un titre, un résumé et un fait à partir d'extraits souvent vides (recherches de presse : titre
  seul). Le modèle paraphrase le titre, `adds_nothing` le rejette, puis CONTEXT lui demande « d'expliquer le cadre
  général » : d'où les phrases creuses.
- Le digest impose une conséquence par ligne : c'est la source des conséquences inventées.
- Le texte de la tâche Claude ne passe aucun contrôle automatique (`numbers_ok`, `direction_ok`, conseils, unités) ;
  ceux-ci ne servent qu'aux modèles gratuits.

**Replis**
- Ordre : tâche Claude, contexte Expert, modèles gratuits contrôlés, phrases calculées. Sain.
- Trous : le contexte Expert de la veille est accepté (erreur du 26) ; l'édition de 00 h 05 pour le site n'a jamais le
  texte de Claude (écrit à 5 h 47) et affiche le repli jusqu'à 7 h ; `numbers_ok` accepte tout nombre présent dans
  la charge utile, années et identifiants compris, à 1,2 % près.
- IA absente (20 nov.) : l'édition sort avec les extraits bruts, sans titre. Acceptable, sauf l'anglais.

**Pannes possibles**
- Données en retard : aucun garde-fou ; la tuile affiche l'ancienne clôture. Depuis le 27 nov. chaque tuile porte
  ses deux dates, ce qui rend le retard visible mais ne le corrige pas.
- Lundi : la tuile PEG compare le dernier point au précédent ; les points du samedi et du dimanche sont identiques
  (21 et 22 nov. : 86,56), donc variation affichée 0 % le lundi. À vérifier lundi 30.
- Jours fériés : aucune logique. Le 25 déc. et le 1er janv. tombent un vendredi : l'édition partira.
- Marqueur d'envoi : écrit même quand les secrets SMTP manquent ou qu'aucun abonné n'est lu en base (rien n'est
  envoyé, la journée est notée « envoyée », l'essai suivant s'arrête) ; s'il n'est pas poussé, un second essai renvoie le courriel.
- PowerBrunch v2 : dépend d'un bloc `brunch` que la tâche du matin n'a encore jamais écrit (`weekly` et `brunch`
  vides dans `newsletter_brief.json`). Sans lui, repli sur l'ancienne maquette et ses défauts (3.1, point 7).
- Commentaires périmés : `morning_mail.yml` dit PowerBrunch à 10 h (planifié à 8 h) ; l'en-tête de
  `news_letter.py` dit 3 sujets et des tuiles TTF et EUA.

**Tests** : aucun avant cet audit. Un fichier ajouté (section 7).

## 5. Améliorations classées (effet, effort)

| # | Amélioration | Effet | Effort | Nature |
|---|---|---|---|---|
| 1 | Clôtures de la veille avant l'édition : un passage `fetch_fr_market` vers 19 h 30 à 21 h UTC, ou 7 O'Klock après 06:33 UTC ; refuser d'écrire « dernière séance » si la date de la tuile n'est pas le dernier jour ouvré | très fort | faible | planification : à décider |
| 2 | Contrôle automatique du texte de Claude avant envoi : chiffres présents dans les fichiers, sens de chaque marché, unités, aucun conseil, dates des clôtures ; en cas d'échec, avertissement dans le message final et repli | fort | moyen | proposition |
| 3 | Bonus France sur le pays de l'article et non sur la langue du média ; exclure (et non pénaliser) BORING, FARAWAY sans lien gaz ou géopolitique | fort | faible | proposition (change la sélection) |
| 4 | Essai à blanc de PowerBrunch v2 avant lundi (entrée `preview` du workflow), tâche du matin lancée à la main pour écrire `brunch` | fort | faible | à faire par le propriétaire |
| 5 | Supprimer les textes « contexte » sans extrait (afficher « titre seul ») et la seconde moitié imposée du digest | moyen | faible | consigne |
| 6 | Profils : soit une édition unique assumée (supprimer les 6 appels au modèle gratuit et les titres par profil), soit une vraie différence : la tâche du matin marque chaque article pour 1 à 3 profils et écrit une ligne de lecture par profil | moyen | faible ou moyen | à décider |
| 7 | Météo du marché sur le niveau (spot face à sa moyenne 30 jours) et non sur la seule variation ; tuile « Heures ≤ 0 € » remplacée l'hiver (contrat du mois suivant, ou nucléaire disponible) | moyen | faible | éditorial : à décider |
| 8 | Une seule définition des heures négatives (celle du site, `negH`) dans la tuile et le chiffre du jour | moyen | faible | à décider |
| 9 | Titres anglais traduits par la tâche du matin (`title_fr`) ; étiquette tirée de la rubrique choisie, non des étiquettes du média | moyen | faible | proposition |
| 10 | Liste d'exclusion de médias pour les recherches de presse (agrégateurs et traductions automatiques) | moyen | faible | config |
| 11 | Ligne « lecture marché » neutre sous les articles qui touchent un mécanisme de prix (jamais un conseil) | moyen | moyen | consigne |
| 12 | Jours fériés, marqueur d'envoi seulement après envoi réel, corriger la série du 21 et 22 nov. | faible | faible | divers |
| 13 | Édition de référence figée dans les tests (données et actualités d'un jour, sortie attendue) | faible | moyen | tests |

## 6. Consignes proposées

### 6.1 Sujets du jour, modèle gratuit (remplace SYSTEM ; le début est déjà appliqué, section 7)

```
Tu écris les résumés d'articles de la newsletter du matin de PowerKlock (marché français de l'électricité).
Lecteur : {reader}. Il lit pour comprendre le marché, pas pour recevoir un conseil.
Tu reçois des sujets : id, titre, médias, extrait. L'extrait peut être vide.

Réponds en JSON seulement :
{"headline": "...", "headline_en": "...",
 "items": [{"id": "...", "what": "...", "what_en": "...", "for_you": "...", "for_you_en": "..."}]}

Règles, dans cet ordre de priorité :
1. Rien d'inventé. Chaque nom, lieu, chiffre, date et sens de variation vient du titre ou de l'extrait.
   Un sigle que l'extrait n'explique pas reste tel quel. Aucun prix « en hausse » ou « en baisse » sans source.
2. Extrait vide : "what" et "for_you" restent vides. Ne paraphrase pas le titre.
3. "what" : 2 phrases, 45 mots au plus : qui fait quoi, où, combien, quand. En français, même si l'extrait est en anglais.
4. "for_you" : le fait chiffré ou daté que retient un professionnel (« 1,5 GW au lieu de 500 MW, toutes technologies »).
   25 mots au plus. Jamais une formule générale, jamais un conseil, jamais de « vous » ni d'impératif.
   Pas de fait précis : vide.
5. "headline" : le fait le plus important parmi les sujets reçus, sujet et verbe, 14 mots au plus.
   Jamais « Nouvelles du jour », jamais une liste de mots, jamais un mouvement de prix absent des extraits.
6. Un élément par sujet, dans l'ordre reçu. Aucun média cité.

Exemple. Sujet : titre « Vattenfall signs 56MW German battery deal », extrait « Vattenfall has signed a
tolling agreement for a 56MW/112MWh battery in Saxony, due online in late 2027 ».
what : « Vattenfall signe un contrat de tolling sur une batterie de 56 MW et 112 MWh en Saxe. La mise en service
est prévue fin 2027. » for_you : « 56 MW, 112 MWh, tolling, mise en service fin 2027 ».
```

### 6.2 Tâche du matin (ajout à `config/market_context_task.md`, section « Style »)

```
Contrôle avant de publier (à refaire à chaque version) :
1. Date de chaque clôture citée : lis la date du dernier point (Cal, mois suivant, TTF, PEG, EUA). Si ce n'est pas
   le dernier jour ouvré, n'écris pas « dernière séance » : écris la date (« le 25 novembre ») ou laisse le point.
2. Chaque chiffre du texte existe dans un fichier du dépôt, arrondi comme on le dit. Les tuiles de l'édition et le
   texte donnent la même valeur pour le même marché.
3. Une cause par mouvement, et seulement si un chiffre la porte (température face à la normale, vent face à la
   normale, nucléaire face à la prévision, coût d'une centrale au gaz face au spot, position face aux voisins).
4. La courbe : spot, mois suivant, Cal. Dis si elle suit ou non, avec l'écart en €/MWh.
5. Aucune phrase adressée à un acheteur, un producteur ou un client. Aucun « devrait se couvrir », aucun « coûte
   moins cher de ».
6. Dernière phrase : ce qui peut changer la lecture dans les 10 jours, avec sa date.
Dans le message final : la liste des clôtures dont la date n'était pas le dernier jour ouvré.
```

### 6.3 Digest (si conservé)

Remplacer « en deux temps : le fait, puis ce que cela change concrètement » par : « une phrase de 25 mots au plus,
le fait seul (qui, quoi, combien, quand). N'ajoute une conséquence que si l'extrait la donne. »

## 7. Ce qui est fait sur la branche (5 commits, chacun reprenable seul)

| Commit | Changement |
|---|---|
| `f02614e2` | Les offres d'emploi (« … F/H ORANO », « … H/F … CDI ») ne sont plus jamais un sujet ni une ligne « En bref » |
| `16e9f9ad` | « Jamais deux fois le même article » : formulation proche, ou trois mots distinctifs communs (4 écartés au lieu de 44 le 27 nov.) ; les articles choisis par la tâche du matin ne sont retenus que par leur lien (12 arrivent, non 6) |
| `7e3537af` | « À retenir » à l'impératif ou adressé à « vos clients » supprimé ; titre du modèle gratuit masqué quand les articles affichés ne sont pas ceux dont il parle ; titres creux supprimés ; consigne SYSTEM resserrée (sigles, sens des prix, français, extrait vide) |
| `639f6d21` | Tuile spot = moyenne journalière publiée, y compris le jour de 25 heures |
| `878a9f75` | Premier test de la newsletter (`tests/test_newsletter.py`), branché dans `scripts/check_before_push.sh` et dans « Site tests » |

- `scripts/check_before_push.sh` passe (contrôles rapides).
- Aucun texte visible nouveau : pas d'ajout à `assets/i18n_fr.json`. La consigne du modèle reste en français, comme avant.
- Essai à blanc de l'édition du 27 nov. sans IA, dans une copie temporaire : 8 articles au lieu de 6, tuiles datées.
- Le test demande scikit-learn et matplotlib dans « Site tests » (une ligne `pip install`, mêmes versions que
  `morning_mail.yml`).

## 8. À décider par le propriétaire

1. Fraîcheur des clôtures (amélioration 1) : passage du soir de `fetch_fr_market` (recommandé) ou édition décalée.
2. Profils : édition unique assumée (recommandé, plus simple et honnête) ou vraie différenciation.
3. Bonus France sur le pays plutôt que sur la langue (recommandé ; change la sélection de repli).
4. Définition unique des heures négatives ; météo du marché sur le niveau ; tuile d'hiver.
5. Vue Expert : écart nucléaire calculé sur deux dates différentes (7,5 GW affichés, 6,6 GW à date égale). Non touché.
6. Série France identique les 21 et 22 nov. : à corriger à la source avant PowerBrunch de lundi.
7. PowerBrunch v2 : essai à blanc avant lundi 8 h.

## 9. Édition cible : 7 O'Klock du vendredi 27 novembre, profil commercial

Écrite à partir des fichiers du dépôt tels qu'ils sont après 06:33 UTC (clôtures du 26 nov.) et des articles de
`data/news.json`. Un article sans extrait est donné par son titre seul.

---

**7 O'Klock · vendredi 27 novembre 2026**

**299 €/MWh : cinquième hausse de suite, et cette fois la courbe suit**

| Spot France | Pointe | Décembre 2026 | Cal 27 | Gaz PEG | GO 2027 |
|---|---|---|---|---|---|
| 299,05 €/MWh | 345,69 €/MWh | 218,00 €/MWh | 116,20 €/MWh | 87,02 €/MWh | 1,92 €/MWh |
| +3,3 % | +2,7 % | +4,6 % | +1,5 % | +0,6 % | +1,1 % |
| 27/11 vs 26/11 | 27/11 vs 26/11 | 26/11 vs 25/11 | 26/11 vs 25/11 | 26/11 vs 25/11 | 27/11 vs 20/11 |

**Le point du matin.** Le spot français s'établit à 299 €/MWh pour ce vendredi, en hausse de 3 % sur jeudi : c'est
la cinquième hausse consécutive, et cinq fois le niveau du 19 novembre (60 €/MWh). Le gaz n'explique que les deux
tiers de ce prix : une centrale au gaz produit aujourd'hui autour de 192 €/MWh, soit 107 €/MWh de moins que le spot.
Le reste vient du système électrique. Les températures sont 3 °C sous la normale, le vent souffle à la moitié de son
niveau habituel et le parc nucléaire offre 46,1 GW, 6,6 GW de moins que la prévision de l'exploitant. Jeudi, la
production bas-carbone ne couvrait que 93 % de la consommation française. La France n'est plus la zone bon marché du
voisinage : son prix est celui de l'Allemagne (302 €/MWh), de la Belgique (296 €/MWh) et de la Suisse (306 €/MWh).
Le fait nouveau est sur la courbe. Jeudi, le contrat décembre a pris près de 10 €/MWh, à 218 €/MWh, et janvier cote
221 €/MWh : le marché prolonge la tension sur le cœur de l'hiver. Il ne la prolonge pas au-delà : mars cote
138 €/MWh et le Cal 27, à 116 €/MWh, vaut moins de la moitié du spot. Prochain rendez-vous : lundi et mardi, avec un
vent attendu à 40 % de la normale, puis un froid modéré à partir du 5 décembre.

**Le chiffre du jour : 426 €/MWh.** Le quart d'heure le plus cher de la journée, entre 8 h et 9 h. Le moins cher
reste à 203 €/MWh, en fin de soirée : aucune heure sous le coût d'une centrale au gaz.

**Régulation**

- **Contrats solaires S06 et S10 : l'amendement est déposé au Sénat** (Gossement Avocats, Tecsol, Watts Else).
  À retenir : amendement n° II-1168 du gouvernement, déposé le 26 novembre sur l'article 82 du projet de loi de
  finances 2027. Il prévoit la résiliation de plein droit, en 2027, des contrats d'achat photovoltaïques S06 et S10 ;
  plus de 222 000 contrats sont concernés. Selon l'exposé des motifs, ce parc représente 5 % de la production
  solaire et 60 % de l'aide publique. Étape nouvelle par rapport à mercredi : le texte existe, il n'est pas voté.
- **Appel d'offres neutre porté de 500 MW à 1,5 GW** (pv magazine). À retenir : toutes technologies en concurrence,
  avec un prix de référence commun en base.
- **Éolien en mer : la réindexation des contrats signés devient possible** (GreenUnivers). À retenir : amendement
  du gouvernement au projet de loi de finances 2027, pour tenir compte de la hausse du coût des turbines.

**Nucléaire**

- **Flamanville 3 : une autorisation, pas le redémarrage** (L'EnerGeek). À retenir : le 24 novembre, l'ASNR a
  autorisé une modification des conditions d'exploitation. Le réacteur est en arrêt programmé depuis septembre et
  cette décision ne vaut pas feu vert.
- **EPR2 : Bruxelles poserait deux conditions à l'aide publique** (Connaissance des Énergies). À retenir : parmi
  elles, que d'autres fournisseurs qu'EDF puissent acheter une partie de la production des six réacteurs.
- **Après l'Arenh, EDF multiplie les contrats d'accès à son nucléaire** (Le nouvel Économiste). Titre seul : pas
  d'extrait public.

**Marchés et géopolitique**

- **Détroit d'Ormuz : le pétrole monte, le gaz européen presque pas.** À retenir : le Brent clôture à 96,57 $/b le
  26 novembre, +2 % sur la séance et +8 % en trois séances ; le TTF finit à 88 €/MWh, +0,8 %.
- **Carbone : un accord du Parlement européen sur l'ETS possible en décembre, selon les Verts** (Carbon Pulse).
  Le quota clôture à 84,15 €/t (+2,4 %).

**Stockage**

- **Batteries : des revenus « exceptionnels »** (GreenUnivers). À retenir : un site mis en service il y a deux ans
  « a déjà payé son capex », avec un taux de retour « supérieur à 20 % », selon Clean Horizon.

**À venir**

- **mar. 1er déc.** Arrêt obligatoire aux prix négatifs dès 5 MW pour le solaire et l'éolien terrestre sous
  obligation d'achat ou complément de rémunération (seuil précédent : 10 MW).
- **lun. 30 nov., 8 h.** PowerBrunch : la semaine du 23 au 29 novembre.

Sources des chiffres : ENTSO-E (spot), EEX (Cal, contrats mensuels), PowerKlock (PEG, coût d'une centrale au gaz :
TTF / 0,55 + 0,37 t × quota), Commerg (garanties d'origine), RTE (production et consommation). Résumés écrits à
partir des titres et extraits publics.

---

Ce que cette édition fait et que celle envoyée ne faisait pas :

- chiffres de la dernière séance réelle, et le texte en tire la bonne conclusion (la courbe suit sur l'hiver, pas
  au-delà) ;
- une seule idée par phrase, une cause par chiffre, aucune phrase adressée à un acheteur ;
- les sujets du jour pour un commercial : S06-S10 en tête, avec ce qui a changé depuis l'édition précédente ;
- titres en français, « titre seul » assumé quand il n'y a pas d'extrait, aucune ligne de remplissage ;
- pour contrôle, hors édition : l'enchère de 13 h a donné 201 €/MWh pour samedi 28, cohérent avec une tension
  lue comme passagère.
