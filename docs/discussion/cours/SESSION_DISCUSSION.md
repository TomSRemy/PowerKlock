# Session discussion : le cours de Tom, prêt à reprendre

*1er novembre 2026 · branche `discussion-bridge` · dossier `docs/discussion/cours/`*

Ce document suffit pour reprendre la discussion avec Tom dans une autre instance, sans relire la conversation
d'origine. Il dit qui est Tom, ce qu'il veut, ce qui est fait, où on en est, les pièges, et comment travailler.

---

## 1. La demande de Tom

Tom possède PowerKlock, un tableau de bord des marchés de l'électricité français et européens, et il price des PPA
solaires et éoliens. Le 31 octobre 2026, il a demandé :

> « Un cours qui explique toutes les interactions qu'on a étudiées, tout ce qu'on a fait, les dynamiques de marché,
> pour monter en compétence. Assez long, mais que tu puisses me donner à l'oral, sans trop compliquer. Une version
> simple d'abord, puis la possibilité d'aller dans le vrai détail. Avec des schémas. »

Ensuite il discute : il pose des questions, demande des schémas, veut approfondir.

Deux consignes données en cours de route :
- **« Inspire-toi de choses sur internet aussi, ne pars pas en roue libre »** : chaque affirmation est vérifiée
  dans une source publique (RTE, CRE, EDF, JAO, articles de recherche), avec le lien.
- **« Continue le plus complet possible »** : les chapitres racontés à l'oral sont complets, pas résumés.

---

## 2. Comment travailler avec Tom

- **Écrire en français**, avec des mots simples et une idée à la fois. Pas de jargon sans explication et sans image
  du quotidien (deux villages et un camion, la balance qui pèse 3 % trop lourd, le bus en retard…).
- **Vérifier sa compréhension** de temps en temps, avec une question courte.
- **Proposer un schéma** quand ça aide, le dessiner, et le pousser sur la branche.
- **Ne pas toucher au site.** Une question de cours reçoit une réponse, pas un changement du site. Ne jamais pousser
  sur `main`.
- **Lire `CLAUDE.md`** à la racine du dépôt et le suivre.
- **Règles des schémas :**
  - français, peu de couleurs ;
  - **pas de violet, sauf pour le nucléaire** (règle de Tom du 1er novembre) ;
  - pas trop de vert : bleu, ambre, sable, gris, ardoise ;
  - prix qui montent en rouge, qui baissent en vert ;
  - traits droits entre les points, pas de double axe ;
  - la source sous chaque schéma tiré de données.
- **Chiffres :** chacun vient d'une source nommée ou d'un calcul refait sur `data/history/`. Si c'est incertain, le
  dire.
- **Pousser :** l'autre session et Tom poussent aussi sur cette branche. Avant chaque push, faire `git fetch origin
  discussion-bridge`, puis `git rebase FETCH_HEAD`, puis `git push origin HEAD:discussion-bridge`.

---

## 3. Ce qui existe

| Fichier | Contenu |
|---|---|
| `cours_simple.md` / `.pdf` | 13 chapitres. Chacun a : l'idée, un schéma, un vrai chiffre, « à retenir », « pour aller plus loin » (liens) et un texte à dire à voix haute |
| `cours_detail.md` / `.pdf` | Les mêmes chapitres en profondeur : formules expliquées, tous les tests chiffrés, limites, questions ouvertes, sources externes en fin de document |
| `oral/chapitre_05.md` | Chapitre 5 (couplage européen), raconté en entier pour l'oral |
| `img/` | 23 schémas (`01_merit_order` à `23_etats_couplage`) |
| `calc.py` → `calc.json` | Recalcule les chiffres depuis `data/history/` : captures, heures ≤ 0 (horaires et au quart d'heure), coût du gaz, réservoirs, France–Allemagne, arrêts nucléaires 2027 |
| `charts.py` | Redessine tous les schémas |
| `build_pdf.py` | Fabrique les PDF (Markdown → HTML → Chromium), avec des liens cliquables |
| `README.md` | Mode d'emploi court |

Pour tout refaire, depuis la racine du dépôt :
1. `python3 docs/discussion/cours/calc.py`
2. `python3 docs/discussion/cours/charts.py`
3. `python3 docs/discussion/cours/build_pdf.py cours_simple cours_detail`

**Les 13 chapitres :**
1. Bases (spot, merit order, forward, prix négatifs)
2. Capture et cannibalisation
3. Le PPA et son prix
4. Le système français
5. Le couplage européen
6. France couplée ou coupée
7. Les interactions (vent, soleil, voisins, sécheresse, gaz)
8. 2026, une année à part
9. Le générateur de scénarios (cases, ancrage, analogues)
10. Tester honnêtement (rejeu, biais, dispersion, bruit)
11. Risque, P50 / P75
12. Coût des écarts
13. Ce qu'on a testé et ce qu'on a gardé

**Sources internes à connaître :**
- `docs/discussion/pricing/debrief-2026-10-31.md` : les tests de la nuit du 30 au 31 octobre ;
- `docs/discussion/pricing-v2/choix_v2.md` et `parametres.md` : **le pricer v2, en ligne depuis le 31 octobre** ;
- `docs/discussion/couplage/` : le dossier couplage (diaporama, méthodologie, sources) ;
- `docs/discussion/pricer-ux/` : la synthèse du brainstorming sur l'ergonomie du pricer ;
- `scripts/ppa_scenarios.py` : les options testées sont en commentaire, avec leurs résultats.

---

## 4. Où on en est avec Tom

**Fait à l'oral :**
- chapitre 5 (couplage), raconté en entier, avec deux schémas neufs : `22_flow_based` et `23_etats_couplage`.

**Échanges importants déjà eus :**
1. **Capture éolienne « 0,936 → 0,976 ».** Tom a demandé si le chiffre venait de RTE. Non : c'est un calcul du pricer
   PowerKlock, dans sa convention « curt ». On prend la capture des MWh payés (prix > 0), mois par mois, puis la
   moyenne pondérée par la production. Ce sont des chiffres year to date (janvier–octobre), comme Tom l'a rappelé.
   RTE ne publie pas de taux de capture.
   - Le même calcul sur l'année entière donne 0,906 (2024) et 0,923 (2025). L'année entière finit toujours un peu
     sous le cumul à fin octobre.
   - Autres définitions : d'un seul bloc sur janvier–octobre, 0,971 → 0,976 ; avec toute la production comptée,
     0,891 → 0,888. **On ne compare que des chiffres de même définition.**
2. **Sur quelle capture pricer un PPA éolien 2027–2029 signé en novembre ?** Tom a répondu : « 0,923, ou le 12 mois
   roulant (jamais essayé) ».
   - 0,923 est le bon réflexe : une année civile complète.
   - Le 12 mois roulant **a été essayé** fin octobre (commentaire de `scripts/ppa_scenarios.py`, ligne d'`ANCHOR`) :
     solaire 1,10 → 1,08, éolien 1,47 → 1,67 €/MWh sur 6 cas. Pas retenu.
3. **« 6 cas suffisent-ils pour trancher ? »** Tom a répondu non, et c'est juste :
   - le bruit des tirages (0,2 €) vaut l'écart mesuré ;
   - les cas ne sont pas indépendants (même année livrée) ;
   - une année atypique pèse lourd.

   Pour trancher, il faudrait pricer à chaque fin de mois, sur plusieurs tirages, et regarder le biais. Verdict :
   « pas mieux », plutôt que « pire ».

**Question posée à Tom, sans réponse pour l'instant** (fin du chapitre 5) : si RTE renforce les lignes
Creys–Saint-Vulbas en 2028, qu'arrive-t-il
- (a) au prix spot moyen français ?
- (b) à la capture d'un parc solaire français ?
- (c) à la rente de congestion à la frontière allemande ?

Réponse attendue :
- (a) le prix monte : la France exporte plus et rejoint plus souvent le prix de ses voisins ;
- (b) la capture solaire monte : moins d'heures où la France est seule face à son surplus de midi ;
- (c) la rente baisse par MWh, puisque l'écart de prix se réduit. Sur le total, c'est plus incertain : plus de
  volume, mais un plus petit écart.

**Suite prévue :** le chapitre 6 (France couplée ou coupée) à l'oral, sur le même modèle que le chapitre 5. Écrire
le texte dans `oral/chapitre_06.md`. Puis continuer avec les autres chapitres, ou ce que Tom demande.

---

## 5. Corrections déjà faites (ne pas les réintroduire)

1. **L'accord RTE–EDF du 27 mars 2026** (CRE, délibération 2026-67) **n'est pas un « minimum national de production
   nucléaire ».**
   - C'est une option qui permet à RTE de garder des réacteurs allumés pour régler la **tension** du réseau, du
     4 avril au 30 octobre 2026.
   - RTE juge son rôle « marginal ».
   - La moindre modulation du nucléaire au printemps 2026 (environ 10 TWh contre près de 20 TWh) vient du **cycle du
     combustible** : minimum technique du parc d'environ 31 GW le 1er mai 2026, contre 19 GW un an plus tôt (RTE,
     bilan du premier semestre 2026).
   - Le débrief du 31 octobre se trompait sur ce point.
2. **Prix nuls ou négatifs : compter au quart d'heure.** Depuis le 1er octobre 2025, le prix est fixé par quart
   d'heure. En 2026 (janvier–octobre), on trouve 805 heures-équivalent au quart d'heure, ce qui recoupe les « environ
   800 heures » de pv magazine. Faire d'abord la moyenne de chaque heure donne 670 et cache des quarts d'heure
   négatifs.
3. **Arrêts nucléaires 2027** (déclarés à ENTSO-E, au 30 octobre 2026) :
   - jusqu'à environ **21 GW** en même temps fin mai, 18 GW en avril, 11 GW en moyenne ;
   - pas 18 GW comme dans les notes ;
   - ces plannings bougent.
4. **Pricer v2 en ligne depuis le 31 octobre**, et non plus « en test » :
   - une seule méthode (le générateur) au lieu de la moyenne de quatre ;
   - règle éolienne pondérée par la production : erreur de rejeu 0,84 → 0,56 €/MWh ;
   - ancrage choisi chaque semaine par le rejeu (aujourd'hui solaire sans ancrage, éolien hiver/été) ;
   - Monte Carlo complet, et le prix publié est le prix prudent (il tient 3 fois sur 4) ;
   - plus de déduction séparée du risque de modèle ;
   - prix au 30–31 octobre : **solaire 49,75 €/MWh, éolien 80,69 €/MWh**.

---

## 6. Les chiffres clés et leurs sources

| Sujet | Chiffre | Source |
|---|---|---|
| Exports nets France 2025 | 92,3 TWh, exportatrice ~99 % du temps | RTE, bilan 2025 |
| Exports nets premier semestre 2026 | 51,0 TWh (record) | RTE, bilan S1 2026 |
| Heures négatives | 147 (2023), 352 (2024), 509 (2025 ; RTE 513), 407 au S1 2026 | `calc.py`, RTE |
| Records de prix négatifs | −478,8 € (26 avril 2026), −498,7 € (1er mai 2026) | RTE, bilan S1 2026 |
| Capture solaire (payée) | 0,85 / 0,67 / 0,58 / 0,56 (2023 / 2024 / 2025 / 2026 janv.–oct.) | `fr_capture.json` |
| Limite d'export Core | 9,2 / 7,7 / 5,4 / 5,9 GW (2023–2026) | JAO, calcul PowerKlock |
| Creys–Saint-Vulbas (2e ligne) contraignante | 49 % du temps en 2026, 21 % en 2025 | Boerman (2026) |
| France ≈ Allemagne (écart < 1 €) | 57 % des heures (2020) → 17 % (2025) | `calc.py` |
| Couplée avec Core (au centime) | 49 % (2021) → 10 % (2025) | dossier couplage |
| Prix réel / France isolée 2025 | 61 € / 23 € (+38 €, estimation de modèle) | dossier couplage |
| Éolien produit dans des heures coupées | 67,5 % (2025) | débrief 31 oct. |
| Cannibalisation par les voisins | vent −0,49 (voisins) / −0,62 (national) ; solaire −2,38 / −1,39 point de valeur par point de pénétration | Stiewe, Xu, Eicke, Hirth (30 zones, 2015–2023) |
| Prix ÷ coût du gaz, heures coupées | ≈ 0,6 (2025–2026) | débrief 31 oct. |
| Coût d'une centrale à gaz | 127 € (2026 janv.–oct.) contre 94–96 € (2025) | SEFE, `calc.py` |
| Minimum technique d'un réacteur | 25 à 100 % de sa puissance, selon le cycle du combustible | RTE, bilan S1 2026 |
| Coût des écarts éolien (12 mois) | 3,06 € (prévision du gestionnaire) → 2,82 € (notre prévision combinée) | pricer, `fr_imbalance_cost.json` |
| Rejeu, pricer v2 | solaire 0,76 ; éolien 0,56 €/MWh ; bruit des tirages 0,2 € | `pricing-v2/choix_v2.md` |
| Prix prudent tenu (Monte Carlo complet) | solaire 78 %, éolien 78–100 % (cible 75 %) | `pricing-v2/choix_v2.md` |

**Sources externes principales** (liens dans `cours_detail.md`, section « Sources externes ») :
- RTE, bilans 2025 et premier semestre 2026 ;
- CRE : délibération 2026-67, rapport de surveillance 2025, rapport sur les recettes de congestion 2025 ;
- EDF, Kpler ;
- JAO, Boerman ;
- Hirth (2013), Stiewe et al., Qorbanian et al. (EJOR 2025), Barber et al. (*Annals of Statistics*, 2023) ;
- Pexapark, Modo Energy.

---

## 7. Pièges

- **La capture a plusieurs définitions.** Toujours dire laquelle on utilise.
- **Le year to date n'est pas l'année entière.** Ne pas ancrer sur un cumul partiel.
- **Les heures négatives se comptent au quart d'heure** depuis octobre 2025.
- **Le prix d'une « France isolée » est une estimation de modèle**, jamais observée : ±15 à 20 € sur une heure,
  biais de +8 € en 2026.
- **Les analogues ne savent pas extrapoler le solaire futur** : un futur plus solaire que tout le passé reçoit les
  pires midis connus. Analogues seuls : 4,1 € d'erreur en solaire.
- **Ne pas présenter le débrief du 31 octobre comme la vérité** sur l'accord RTE–EDF (voir la section 5).
