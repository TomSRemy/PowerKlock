"""Schémas du cours (lancer depuis la racine du dépôt) → docs/discussion/cours/img/*.png"""
import json, glob, os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle

OUT = 'docs/discussion/cours/img'
R = 'data/history'
BLUE, VIOLET, AMBER, SAND, GREY, INK = '#2f6db5', '#7a5aa6', '#d08a1e', '#c9b48a', '#8a94a3', '#1f2933'
RED, GREEN = '#c0392b', '#3d8b5a'
plt.rcParams.update({'font.size': 12, 'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.titleweight': 'bold', 'axes.titlesize': 14, 'figure.dpi': 110,
                     'axes.edgecolor': '#555', 'axes.labelcolor': INK, 'text.color': INK})
C = json.load(open('docs/discussion/cours/calc.json'))
S = json.load(open('docs/discussion/couplage/summary.json'))
ST = json.load(open('docs/discussion/couplage/coupling_stats.json'))


def save(fig, name, src=None):
    if src:
        fig.text(0.01, -0.03, 'Source : ' + src, fontsize=9, color=GREY, ha='left', va='top')
    fig.savefig(f'{OUT}/{name}.png', bbox_inches='tight', dpi=130)
    plt.close(fig)


def box(ax, x, y, w, h, txt, fc, ec, fs=11, bold=False):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle='round,pad=0.02,rounding_size=0.03', fc=fc, ec=ec, lw=1.6))
    ax.text(x + w / 2, y + h / 2, txt, ha='center', va='center', fontsize=fs, fontweight='bold' if bold else None, wrap=True)


def arrow(ax, a, b, col=GREY):
    ax.add_patch(FancyArrowPatch(a, b, arrowstyle='-|>', mutation_scale=16, color=col, lw=1.6))


# 01 merit order (schéma)
fig, ax = plt.subplots(figsize=(10, 5.2))
blocs = [('Éolien\nsolaire', 20, 0, SAND), ('Nucléaire', 45, 15, BLUE), ('Hydraulique', 8, 40, '#6b9bd1'),
         ('Gaz', 12, 90, AMBER), ('Fioul,\npointe', 5, 200, VIOLET)]
x = 0
for n, w, p, c in blocs:
    ax.add_patch(Rectangle((x, 0), w, max(p, 1.5), fc=c, ec='white', lw=1.5))
    ax.text(x + w / 2, max(p, 1.5) + 6, n, ha='center', va='bottom', fontsize=10)
    x += w
ax.axvline(78, color=INK, ls='--', lw=1.5); ax.text(78.5, 160, 'Consommation\nde l\'heure', fontsize=10)
ax.axhline(90, xmax=78 / 95, color=RED, lw=2); ax.text(1, 95, 'Prix de l\'heure = coût du gaz (90 €) : tout le monde est payé ce prix', color=RED, fontsize=11)
ax.set_xlim(0, 95); ax.set_ylim(0, 230)
ax.set_xlabel('Puissance offerte, rangée de la moins chère à la plus chère (GW)'); ax.set_ylabel('Coût de produire un MWh (€/MWh)')
ax.set_title('Le merit order : la dernière centrale appelée fixe le prix')
save(fig, '01_merit_order', 'schéma illustratif, chiffres arrondis (pas une heure réelle)')

# 02 forward vs spot
F = json.load(open('docs/discussion/couplage/forwards.json'))
yrs = ['2024', '2025', '2026']
fig, ax = plt.subplots(figsize=(9, 4.8))
xx = np.arange(len(yrs))
ax.bar(xx - 0.2, [F['cal_y1']['FR'][y] for y in yrs], 0.4, color=BLUE, label='Cal France coté l\'année d\'avant')
ax.bar(xx + 0.2, [F['spot']['FR'][y] for y in yrs], 0.4, color=AMBER, label='Spot France réalisé')
for i, y in enumerate(yrs):
    ax.text(i - 0.2, F['cal_y1']['FR'][y] + 2, f"{F['cal_y1']['FR'][y]:.0f}", ha='center')
    ax.text(i + 0.2, F['spot']['FR'][y] + 2, f"{F['spot']['FR'][y]:.0f}", ha='center')
ax.set_xticks(xx, ['2024', '2025', '2026 (janv.–oct.)']); ax.set_ylabel('€/MWh'); ax.legend(frameon=False, loc='upper right')
ax.set_title('Le forward est un pari : il se trompe dans les deux sens')
save(fig, '02_forward_spot', 'SEFE (Cal base Y+1, moyenne des clôtures) via la base PowerKlock ; spot ENTSO-E')

# 03 heures à prix négatif, et nul ou négatif
ys = [str(y) for y in range(2020, 2027)]
fig, ax = plt.subplots(figsize=(9.5, 4.8)); xx = np.arange(7)
a = [C['capture_jan_oct'][y]['h_lt0'] for y in ys]; b = [C['capture_jan_oct'][y]['h_le0'] for y in ys]
ax.bar(xx - 0.2, a, 0.4, color=VIOLET, label='prix négatif (< 0)'); ax.bar(xx + 0.2, b, 0.4, color=SAND, label='prix nul ou négatif (≤ 0)')
for i in range(7):
    ax.text(i - 0.2, a[i] + 10, str(a[i]), ha='center', fontsize=10); ax.text(i + 0.2, b[i] + 10, str(b[i]), ha='center', fontsize=10)
ax.set_xticks(xx, ys[:-1] + ['2026\n(janv.–oct.)']); ax.set_ylabel("heures dans l'année"); ax.legend(frameon=False, loc='upper left')
ax.set_title('Heures où le prix français est négatif, ou nul')
save(fig, '03_heures_negatives', 'ENTSO-E day-ahead France, prix horaire (moyenne des quarts d\'heure), calcul PowerKlock (calc.py)')

# 04 capture solaire et éolienne par année
d = json.load(open(f'{R}/fr_capture.json')); FF = d['fields']; rows = d['days']
capw, caps = [], []
for y in ys:
    A = np.array([r[1:] for r in rows if r[0].startswith(y)], float); s = dict(zip(FF, A.sum(0)))
    b = s['pSum'] / s['pN']
    capw.append(s['wRPos'] / s['wE'] / b); caps.append(s['sRPos'] / s['sE'] / b)
fig, ax = plt.subplots(figsize=(9, 4.8))
ax.plot(ys, capw, '-o', color=BLUE, lw=2.2, label='Éolien'); ax.plot(ys, caps, '-o', color=AMBER, lw=2.2, label='Solaire')
for y, a, b in zip(ys, capw, caps):
    ax.text(y, a + 0.025, f'{a:.2f}', ha='center', color=BLUE, fontsize=10); ax.text(y, b - 0.05, f'{b:.2f}', ha='center', color=AMBER, fontsize=10)
ax.axhline(1, color=GREY, lw=1, ls=':'); ax.text(0, 1.01, '1 = le MWh vaut le prix moyen', color=GREY, fontsize=9)
ax.set_ylim(0.4, 1.12); ax.set_ylabel('taux de capture'); ax.legend(frameon=False, loc='lower left')
ax.set_xticks(range(7), ys[:-1] + ['2026\n(janv.–oct.)'])
ax.set_title('Taux de capture : ce que vaut un MWh ÷ prix moyen')
save(fig, '04_capture_annees', 'RTE éCO2mix × ENTSO-E day-ahead (fr_capture.json) ; production non payée aux prix ≤ 0')

# 05 profil d'une journée 2025 : solaire et prix (deux panneaux)
H = json.load(open(f'{R}/fr_hourly/2025.json'))['days']
P = np.array([[np.nan if v is None else v for v in H[k]['p'][:24]] for k in H if len(H[k]['p']) >= 24 and 4 <= int(k[5:7]) <= 9], float)
Sx = np.array([[np.nan if v is None else v for v in H[k]['s'][:24]] for k in H if len(H[k]['s']) >= 24 and 4 <= int(k[5:7]) <= 9], float)
fig, (a1, a2) = plt.subplots(2, 1, figsize=(9, 6.4), sharex=True)
a1.plot(range(24), np.nanmean(Sx, 0) / 1000, '-o', color=AMBER, lw=2); a1.set_ylabel('Solaire (GW)')
a1.set_title('Avril–septembre 2025, heure moyenne : plus de soleil, prix plus bas')
a2.plot(range(24), np.nanmean(P, 0), '-o', color=BLUE, lw=2); a2.set_ylabel('Prix (€/MWh)'); a2.set_xlabel('Heure (Paris)')
a2.set_xticks(range(0, 24, 2))
save(fig, '05_solaire_midi', 'RTE éCO2mix, ENTSO-E day-ahead (fr_hourly 2025), calcul PowerKlock')

# 06 prix PPA, schéma en cascade (valeurs illustratives)
st = [('Forward\nbase', 70, BLUE), ('× capture\n(profil +\ncannibal.)', -14, SAND), ('− prime\nde risque', -4, SAND),
      ('− coût des\nécarts', -2.5, SAND), ('+ garanties\nd\'origine', 1, '#6b9bd1'), ('− marge', -1, SAND)]
fig, ax = plt.subplots(figsize=(10, 5))
cur = 0
for i, (n, vv, c) in enumerate(st):
    if i == 0:
        ax.bar(i, vv, color=c); cur = vv
    else:
        ax.bar(i, vv, bottom=cur, color=c); cur += vv
    ax.text(i, max(cur, cur - vv) + 1.5, f'{vv:+g}'.replace('.', ',') if i else f'{vv:g}', ha='center')
ax.set_ylim(0, 82)
ax.bar(len(st), cur, color=VIOLET); ax.text(len(st), cur + 1.5, f'{cur:g}'.replace('.', ','), ha='center', fontweight='bold')
ax.set_xticks(range(len(st) + 1), [s[0] for s in st] + ['= prix\nPPA']); ax.set_ylabel('€/MWh')
ax.set_title('Du forward au prix d\'un PPA (exemple, chiffres ronds)')
save(fig, '06_cascade_ppa', 'schéma illustratif ; les vrais montants sont dans le pricer PowerKlock')

# 07 nucléaire disponible
c = json.load(open(f'{R}/commodities_series.json'))['series']['fr_nuc_avail']['points']
dd = np.array([np.datetime64(x[0]) for x in c]); vv = np.array([x[1] for x in c]) / 1000
k = dd >= np.datetime64('2020-01-01')
wk = np.convolve(vv[k], np.ones(7) / 7, mode='same')
fig, ax = plt.subplots(figsize=(10, 4.6))
ax.plot(dd[k][3:-3], wk[3:-3], color=BLUE, lw=1.6)
ax.set_ylabel('GW disponibles (moyenne 7 jours)'); ax.set_ylim(20, 65)
ax.annotate('2022 : corrosion sous contrainte,\nla moitié du parc à l\'arrêt', xy=(np.datetime64('2022-08-15'), 28), xytext=(np.datetime64('2020-06-01'), 25), arrowprops=dict(arrowstyle='->', color=GREY), fontsize=10)
ax.set_title('Nucléaire disponible en France : hiver haut, été bas (arrêts programmés)')
save(fig, '07_nucleaire_dispo', 'ENTSO-E, capacité nucléaire disponible (commodities_series.json, fr_nuc_avail)')

# 08 deux villages, un camion
fig, ax = plt.subplots(figsize=(10, 4.4)); ax.axis('off'); ax.set_xlim(0, 10); ax.set_ylim(0, 4.4)
box(ax, 0.3, 1.4, 2.8, 1.8, 'Village A (la France)\ntrop de pommes\n30 € la caisse', '#e8f0fa', BLUE, 12)
box(ax, 6.9, 1.4, 2.8, 1.8, 'Village B (l\'Allemagne)\npas assez de pommes\n60 € la caisse', '#fbeee0', AMBER, 12)
arrow(ax, (3.2, 2.3), (6.8, 2.3), INK)
ax.text(5, 2.6, 'un seul camion : 5 caisses', ha='center', fontsize=12, fontweight='bold')
ax.text(5, 1.75, 'achète à 30 €, revend à 60 €\n→ garde 30 € par caisse = rente de congestion', ha='center', fontsize=11, color=VIOLET)
ax.text(5, 0.5, 'Camion plein : deux prix. Camion avec de la place : les prix s\'égalisent, plus de rente.', ha='center', fontsize=11)
ax.set_title('Deux villages, un seul camion')
save(fig, '08_deux_villages')

# 09 limite d'export Core
yy = ['2023', '2024', '2025', '2026']; jm = [ST[y]['jmax'] for y in yy]
fig, ax = plt.subplots(figsize=(8, 4.6))
ax.bar(yy, jm, color=VIOLET)
for y, j in zip(yy, jm):
    ax.text(y, j + 0.15, f'{j:.1f}'.replace('.', ','), ha='center')
ax.set_xticks(range(4), ['2023', '2024', '2025', '2026\n(janv.–oct.)']); ax.set_ylabel('GW (moyenne horaire)')
ax.set_title('Limite d\'export de la France vers la zone Core')
save(fig, '09_limite_core', 'JAO, maxNetPos France, flow-based Core (jao_core), calcul PowerKlock')

# 10 France–Allemagne : écart < 1 € et France moins chère
fd = C['fr_de']; yy = [str(y) for y in range(2020, 2027)]
fig, ax = plt.subplots(figsize=(9.5, 4.8))
a = [fd[y]['share_gap_lt1'] * 100 for y in yy]; b = [fd[y]['share_fr_cheaper_5'] * 100 for y in yy]
ax.plot(yy, a, '-o', color=BLUE, lw=2.2, label='France et Allemagne à moins de 1 € l\'une de l\'autre')
ax.plot(yy, b, '-o', color=AMBER, lw=2.2, label='France moins chère d\'au moins 5 €')
for y, p, q in zip(yy, a, b):
    ax.text(y, p + 2.5, f'{p:.0f} %', ha='center', color=BLUE, fontsize=10); ax.text(y, q - 6, f'{q:.0f} %', ha='center', color=AMBER, fontsize=10)
ax.set_ylim(-5, 75); ax.set_ylabel('% des heures'); ax.legend(frameon=False, loc='upper left')
ax.set_xticks(range(7), yy[:-1] + ['2026\n(janv.–oct.)'])
ax.set_title('La France se sépare de l\'Allemagne')
save(fig, '10_france_allemagne', 'ENTSO-E day-ahead, prix horaires (moyenne des quarts d\'heure), calcul PowerKlock (calc.py)')

# 11 prix réel vs France isolée
yy = [str(y) for y in range(2020, 2027)]
fig, ax = plt.subplots(figsize=(10, 4.8)); xx = np.arange(7)
ax.bar(xx - 0.2, [S[y]['real'] for y in yy], 0.4, color=BLUE, label='Prix réel')
ax.bar(xx + 0.2, [S[y]['iso'] for y in yy], 0.4, color=SAND, label='France isolée (modèle)')
for i, y in enumerate(yy):
    g = S[y]['gap']; ax.text(i, max(S[y]['real'], S[y]['iso']) + 6, f'{g:+.0f}', ha='center', color=RED if g > 0 else GREEN, fontweight='bold')
ax.set_yscale('linear'); ax.set_ylim(0, 340); ax.set_xticks(xx, yy[:-1] + ['2026\n(janv.–oct.)']); ax.set_ylabel('€/MWh')
ax.legend(frameon=False, loc='upper right'); ax.set_title('Le couplage a-t-il monté le prix spot français ? (écart en €/MWh)')
save(fig, '11_reel_vs_isole', 'ENTSO-E, RTE éCO2mix, JAO ; prix isolé = estimation de modèle PowerKlock (± 15–20 € sur une heure)')

# 12 prix selon le vent français, 2025
H = json.load(open(f'{R}/fr_hourly/2025.json'))['days']
W = np.concatenate([np.array([np.nan if v is None else v for v in H[k]['w'][:24]], float) for k in H if len(H[k]['w']) >= 24 and len(H[k]['p']) >= 24])
Pp = np.concatenate([np.array([np.nan if v is None else v for v in H[k]['p'][:24]], float) for k in H if len(H[k]['w']) >= 24 and len(H[k]['p']) >= 24])
ok = np.isfinite(W) & np.isfinite(Pp); W, Pp = W[ok] / 1000, Pp[ok]
q = np.quantile(W, np.linspace(0, 1, 11)); mid, pm = [], []
for i in range(10):
    m = (W >= q[i]) & (W <= q[i + 1]); mid.append(W[m].mean()); pm.append(Pp[m].mean())
fig, ax = plt.subplots(figsize=(9, 4.8))
ax.plot(mid, pm, '-o', color=BLUE, lw=2.2)
for x_, y_ in zip(mid, pm):
    ax.text(x_, y_ + 2.5, f'{y_:.0f}', ha='center', fontsize=10)
ax.set_xlabel('Production éolienne française de l\'heure (GW, par dixième des heures)'); ax.set_ylabel('Prix moyen (€/MWh)')
ax.set_title('2025 : plus il y a de vent, plus le prix est bas')
save(fig, '12_vent_prix', 'RTE éCO2mix, ENTSO-E day-ahead (fr_hourly 2025), calcul PowerKlock')

# 13 années sèches / humides
yy = ['2017\n(sèche)', '2026\n(sèche)', '2020\n(humide)']; r = [-20, -14, 26]; w = [-7, -4, 14]
fig, ax = plt.subplots(figsize=(8.5, 4.6)); xx = np.arange(3)
ax.bar(xx - 0.2, r, 0.4, color=BLUE, label='Remplissage des réservoirs'); ax.bar(xx + 0.2, w, 0.4, color=VIOLET, label='Vent')
for i in range(3):
    ax.text(i - 0.2, r[i] + (1 if r[i] > 0 else -3), f'{r[i]:+d} %', ha='center'); ax.text(i + 0.2, w[i] + (1 if w[i] > 0 else -3), f'{w[i]:+d} %', ha='center')
ax.axhline(0, color=INK, lw=1); ax.set_xticks(xx, yy); ax.set_ylabel('écart à la normale'); ax.legend(frameon=False, loc='upper left')
ax.set_title('Année sèche = année peu venteuse (même météo)')
save(fig, '13_sec_vent', 'ENTSO-E (réservoirs, A72), RTE éCO2mix (vent) ; analyse PowerKlock du 31 oct. 2026')

# 14 coût du gaz et prix français
yy = [str(y) for y in range(2020, 2027)]
fig, ax = plt.subplots(figsize=(9.5, 4.8))
g = [C['gas_plant_cost_jan_oct'][y] for y in yy]; p = [C['fr_de'][y]['fr'] for y in yy]
ax.plot(yy, g, '-o', color=AMBER, lw=2.2, label='Coût d\'une centrale à gaz (janv.–oct.)'); ax.plot(yy, p, '-o', color=BLUE, lw=2.2, label='Prix spot France (année)')
for y_, a_, b_ in zip(yy, g, p):
    if y_ != '2022':
        ax.text(y_, a_ + 8, f'{a_:.0f}', ha='center', color=AMBER, fontsize=10)
ax.set_ylabel('€/MWh'); ax.legend(frameon=False); ax.set_xticks(range(7), yy[:-1] + ['2026\n(janv.–oct.)'])
ax.set_title('Le gaz donne le niveau des prix')
save(fig, '14_gaz_prix', 'SEFE (TTF, EUA) ; coût = TTF ÷ 0,55 + 0,37 × EUA ; ENTSO-E day-ahead')

# 15 répartition mensuelle du vent 2025 vs 2026
fig, ax = plt.subplots(figsize=(9.5, 4.6)); mm = np.arange(1, 11)
for y, col in (('2025', GREY), ('2026', BLUE)):
    A = [r for r in rows if r[0].startswith(y) and int(r[0][5:7]) <= 10]
    tot = sum(r[1 + FF.index('wE')] for r in A)
    sh = [sum(r[1 + FF.index('wE')] for r in A if int(r[0][5:7]) == m) / tot * 100 for m in mm]
    ax.plot(mm, sh, '-o', color=col, lw=2.2, label=y)
ax.set_xticks(mm, ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct'])
ax.set_ylabel('% de la production éolienne janv.–oct.'); ax.legend(frameon=False)
ax.set_title('2026 : plus de vent en hiver, moins au soleil')
save(fig, '15_vent_saisons', 'RTE éCO2mix (fr_capture.json), calcul PowerKlock')

# 16 générateur de scénarios (schéma)
fig, ax = plt.subplots(figsize=(11, 4.6)); ax.axis('off'); ax.set_xlim(0, 11); ax.set_ylim(0, 4.6)
box(ax, 0.2, 2.6, 2.4, 1.5, '① Vraies semaines\nde météo passées\n(vent, soleil, conso)', '#e8f0fa', BLUE)
box(ax, 0.2, 0.4, 2.4, 1.5, '② Le parc futur\n(plus de solaire,\nd\'éolien, batteries)', '#e8f0fa', BLUE)
box(ax, 3.4, 1.5, 2.6, 1.6, '③ Production\nde chaque heure\ndu futur', '#f1ebf7', VIOLET)
box(ax, 6.6, 1.5, 2.0, 1.6, '④ Règle de prix\napprise sur\nle passé', '#fbeee0', AMBER)
box(ax, 9.0, 1.5, 1.8, 1.6, '⑤ Capture\nde chaque\nmois', '#eef0f3', GREY, bold=True)
arrow(ax, (2.6, 3.3), (3.4, 2.6), BLUE); arrow(ax, (2.6, 1.2), (3.4, 2.0), BLUE)
arrow(ax, (6.0, 2.3), (6.6, 2.3), VIOLET); arrow(ax, (8.6, 2.3), (9.0, 2.3), AMBER)
ax.text(7.6, 0.9, 'cases par situation\nou heures analogues', ha='center', fontsize=10, color=AMBER)
ax.set_title('Le générateur de scénarios en 5 étapes')
save(fig, '16_generateur')

# 17 erreurs de rejeu
labels = ['Règle publiée\nsans ancrage', 'Pondérée par\nla production', 'Pondération\n+ pente du vent', 'Analogues', 'Règle publiée\nancrée hiver/été']
vals = [2.62, 2.15, 1.93, 1.1, 0.84]; cols = [GREY, BLUE, BLUE, VIOLET, AMBER]
fig, ax = plt.subplots(figsize=(10, 4.8))
ax.bar(range(5), vals, color=cols)
for i, v_ in enumerate(vals):
    ax.text(i, v_ + 0.05, f'{v_:.2f}'.replace('.', ',') if i != 3 else '≈ 1,1', ha='center')
ax.set_xticks(range(5), labels); ax.set_ylabel('erreur moyenne (€/MWh)')
ax.set_title('Éolien : erreur de rejeu 2023–2026 (9 cas)')
save(fig, '17_rejeu_eolien', 'rejeu PowerKlock (débrief pricing du 31 oct. 2026 ; analogues : tests du 31 oct.)')

# 18 P50 / P75
xg = np.linspace(-4, 4, 400); yg = np.exp(-xg ** 2 / 2)
fig, ax = plt.subplots(figsize=(9.5, 4.6))
ax.plot(xg, yg, color=VIOLET, lw=2.2); ax.fill_between(xg, 0, yg, where=xg <= -0.674, color=SAND, alpha=0.8)
ax.axvline(0, color=BLUE, lw=2); ax.axvline(-0.674, color=AMBER, lw=2)
ax.text(0.08, 1.02, 'P50 : le prix le plus probable', color=BLUE); ax.text(-3.9, 0.62, 'P75 : prix prudent.\nLa vraie valeur\nest au-dessus\n3 fois sur 4', color=AMBER)
ax.text(-1.4, 0.06, '25 %', ha='center', fontsize=11)
ax.set_yticks([]); ax.set_xticks([]); ax.set_xlabel('valeur future du MWh (bas ← → haut)')
ax.set_title('P50 et P75')
save(fig, '18_p50_p75', 'schéma illustratif')

# 19 couverture des bandes
fig, ax = plt.subplots(figsize=(9, 4.4))
ax.barh([1, 0], [45, 83.5], color=[GREY, VIOLET])
ax.errorbar([83.5], [0], xerr=[[5.5], [5.5]], fmt='none', color=INK, capsize=6)
ax.text(46.5, 1, '≈ 45 % des mois dans la bande P10–P90\n(il en faudrait 80 %)', va='center', fontsize=11)
ax.text(30, 0, 'P75 tenu dans 78 à 89 % des cas\n(il en faudrait 75 %)', va='center', ha='center', fontsize=11, color='white')
ax.set_yticks([1, 0], ['Monte Carlo\nmétéo seule', 'Monte Carlo\ncomplet']); ax.set_xlim(0, 100); ax.set_xlabel('% des cas où la réalité est dans la cible')
ax.set_title('Un Monte Carlo ne connaît que les risques qu\'on lui donne')
save(fig, '19_couverture', 'tests PowerKlock du 31 oct. 2026 (générateur de scénarios, rejeu)')

# 20 coût des écarts mensuel
m = json.load(open(f'{R}/fr_imbalance_cost.json'))['months']
ks = sorted(m)
fig, ax = plt.subplots(figsize=(10, 4.6))
ax.plot(range(len(ks)), [m[k]['wind']['eurMWh'] for k in ks], '-o', color=BLUE, lw=2, label='Éolien')
ax.plot(range(len(ks)), [m[k]['solar']['eurMWh'] for k in ks], '-o', color=AMBER, lw=2, label='Solaire')
ax.axhline(0, color=INK, lw=1); ax.set_xticks(range(0, len(ks), 3), [ks[i] for i in range(0, len(ks), 3)])
ax.set_ylabel('€ par MWh produit'); ax.legend(frameon=False); ax.set_title('Coût des écarts, France entière, prévision du gestionnaire de réseau')
save(fig, '20_cout_ecarts', 'ENTSO-E (prévision J-1 A69, prix d\'écart A85), RTE éCO2mix, calcul PowerKlock (fr_imbalance_cost.json)')

# 21 le bus en retard
fig, ax = plt.subplots(figsize=(9.5, 4.4))
late = np.array([0, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8])
ax.bar(range(len(late)), late, color=[SAND] * 9 + [VIOLET] * 3)
ax.axhline(np.quantile(late, 0.75), color=AMBER, lw=2); ax.text(0, np.quantile(late, 0.75) + 0.2, 'partir avec cette marge = à l\'heure 3 fois sur 4', color=AMBER)
ax.set_xticks(range(len(late)), [f'j{i+1}' for i in range(len(late))]); ax.set_ylabel('minutes de retard')
ax.set_title('Le bus en retard : on règle sa marge sur ses retards passés')
save(fig, '21_bus', 'image illustrative (retards inventés pour l\'exemple)')
print('ok')
