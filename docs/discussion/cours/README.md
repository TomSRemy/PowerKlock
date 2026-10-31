# Cours pour Tom : le marché de l'électricité et le prix d'un PPA

- `cours_simple.md` / `.pdf` : 13 chapitres courts. Chacun contient l'idée, un schéma, un vrai chiffre, un encadré
  « à retenir » et un texte à dire à voix haute.
- `cours_detail.md` / `.pdf` : les mêmes chapitres, avec les formules, les tests chiffrés, les limites et les
  questions ouvertes.
- `img/` : les schémas. Chaque schéma tiré de données porte sa source.
- Pour tout refaire, depuis la racine du dépôt :
  - `python3 docs/discussion/cours/calc.py` : recalcule les chiffres à partir de `data/history`, dans `calc.json` ;
  - `python3 docs/discussion/cours/charts.py` : redessine les schémas ;
  - `python3 docs/discussion/cours/build_pdf.py cours_simple cours_detail` : refait les PDF (Playwright, Chromium).

Sources externes vérifiées le 31 oct. 2026 (RTE, CRE, EDF, JAO, recherche) : liens à la fin de chaque chapitre
(version simple) et en fin de version détaillée. Correction faite à cette occasion : l'accord RTE–EDF du 27 mars 2026
sert à la tension du réseau et RTE juge son rôle marginal ; la moindre modulation du nucléaire au printemps 2026 vient
du cycle du combustible (RTE, bilan S1 2026), pas d'un « minimum national ».

Point incertain, à vérifier avec Tom : la capture éolienne 2025 de « 0,936 » donnée dans le brief n'est pas
retrouvée dans les données (chapitre 8).
