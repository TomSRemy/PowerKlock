"""Charts of the PPA pricer training (docs/ppa_formation). Run from the repo root: python3 docs/ppa_formation/make_charts.py
Reads data/history/*, docs/ppa_formation/pricer_dump.json (the pricer's own figures of 22 Nov. 2026) and backtest.json."""
import json, os, sys, datetime as dt
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
sys.path.insert(0, 'scripts'); _a, sys.argv = sys.argv, ['x']
import ppa_lab as L  # noqa: E402
sys.argv = _a
OUT = 'docs/ppa_formation/img'; os.makedirs(OUT, exist_ok=True)
BLUE, ORANGE, AQUA, GREY, INK, INK2, SURF = '#2a78d6', '#eb6834', '#1baf7a', '#8f8e89', '#0b0b0b', '#52514e', '#fcfcfb'
plt.rcParams.update({'font.size': 11, 'axes.edgecolor': '#c9c8c2', 'axes.labelcolor': INK2, 'xtick.color': INK2, 'ytick.color': INK2,
                     'axes.spines.top': False, 'axes.spines.right': False, 'axes.grid': True, 'grid.color': '#e7e6e1', 'grid.linewidth': 0.8,
                     'axes.axisbelow': True, 'figure.facecolor': SURF, 'axes.facecolor': SURF, 'savefig.facecolor': SURF, 'legend.frameon': False})
D = json.load(open('docs/ppa_formation/pricer_dump.json'))
F = json.load(open('data/history/ppa_forecast.json'))


def fr(v, d=2, sign=False):
    v = v + (5e-7 if v >= 0 else -5e-7)
    t = f'{v:+.{d}f}' if sign else f'{v:.{d}f}'
    return t.replace('.', ',').replace('-', '−')


def fig(w=10, h=5.2):
    return plt.subplots(figsize=(w, h), dpi=160)


def save(f, name, title, sub=None):
    f.suptitle(title, x=0.01, ha='left', fontsize=14, fontweight='bold', color=INK, y=0.985)
    if sub:
        f.text(0.01, 0.885, sub, ha='left', fontsize=10.5, color=INK2)
    f.tight_layout(rect=(0, 0.02, 1, 0.86 if sub else 0.92))
    f.savefig(f'{OUT}/{name}.png'); plt.close(f)


# 1. capture history and projection
def yearly_actual(t, y):
    a = L.actual(t, y)
    if not a:
        return None
    w = np.array([a[m]['mwh'] * a[m]['paid'] for m in a]); r = np.array([a[m]['curt'] for m in a])
    return float((w * r).sum() / w.sum())


def yearly_gen(tech, Y):
    f = F['forecast'][tech]['curt']; sh = F['share'][tech]
    ms = [m for m in range(1, 13) if f.get(f'{Y}-{m:02d}', {}).get('generator') is not None]
    if len(ms) < 12:
        return None
    w = [sh[str(m)] * f[f'{Y}-{m:02d}']['generatorPaid'] for m in ms]
    return sum(x * f[f'{Y}-{m:02d}']['generator'] for x, m in zip(w, ms)) / sum(w)


f, ax = fig()
for t, tech, col, lab in (('s', 'solar', ORANGE, 'Solaire'), ('w', 'wind', BLUE, 'Éolien')):
    hy = [y for y in range(2016, 2027) if y != 2022]
    hv = [100 * yearly_actual(t, y) for y in hy]
    ax.plot(hy, hv, color=col, lw=2, marker='o', ms=5, label=f'{lab}, réalisé')
    py = [Y for Y in range(2027, 2031) if yearly_gen(tech, Y)]
    pv = [100 * yearly_gen(tech, Y) for Y in py]
    B = F['generator']['band'][tech]
    lo = [v * B[str(Y)]['p10'] / B[str(Y)]['p50'] for v, Y in zip(pv, py)]; hi = [v * B[str(Y)]['p90'] / B[str(Y)]['p50'] for v, Y in zip(pv, py)]
    ax.plot([hy[-1]] + py, [hv[-1]] + pv, color=col, lw=2, ls='--', marker='o', ms=5, mfc=SURF, label=f'{lab}, générateur (P50)')
    ax.errorbar(py, pv, yerr=[np.array(pv) - lo, np.array(hi) - pv], fmt='none', ecolor=col, elinewidth=1.4, capsize=4)
    ax.annotate(f'{fr(pv[-1], 0)} %', (py[-1], pv[-1]), xytext=(8, 0), textcoords='offset points', va='center', color=INK2, fontsize=10)
ax.axvspan(2026.5, 2030.5, color='#f1f0ec', zorder=0); ax.text(2026.6, 47, 'projection', color=INK2, fontsize=10)
ax.set_ylabel('Taux de capture, heures payées (%)'); ax.set_ylim(45, 110); ax.set_xticks(range(2016, 2031, 2)); ax.legend(loc='lower left', ncol=2, fontsize=9.5)
save(f, 'fig1_capture', 'Le taux de capture : historique et projection du générateur',
     'Prix capté par MWh payé ÷ baseload. Arrêt strictement sous 0 €. 2022 omis (crise). Barres : P10–P90 du générateur.')

# 2. monthly forward shape
fm = json.load(open('data/history/fr_forward_monthly.json'))['months']
ks = [k for k in sorted(fm) if '2027-01' <= k <= '2029-12']
f, ax = fig(10, 4.6)
x = np.arange(len(ks)); v = [fm[k]['value'] for k in ks]
ax.bar(x, v, width=0.82, color=[BLUE if fm[k]['from'].startswith(('Q', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')) else '#9fc1ea' for k in ks])
for Y, c in ((2027, 110.99), (2028, 62.02), (2029, 57.27)):
    i0 = ks.index(f'{Y}-01'); ax.hlines(c, i0 - 0.4, i0 + 11.4, color=INK, lw=1.5); ax.text(i0 + 5.5, c + 4, f'Cal {Y} : {fr(c, 0)} €', ha='center', fontsize=10, color=INK)
ax.set_xticks(x[::3]); ax.set_xticklabels([k[5:] + '/' + k[2:4] for k in ks][::3], fontsize=9); ax.set_ylabel('€/MWh')
save(f, 'fig2_forward', 'Étape 1 : le forward, mois par mois',
     'Courbe du 20 nov. 2026. Bleu foncé : mois ou trimestre cotés (liquides). Bleu clair : forme historique calée sur le Cal.')

# 3. the duck curve: summer price hour by hour, as a share of the day's mean, 2019 / 2023 / 2025
f, ax = fig(10, 5)
for y, col in ((2019, GREY), (2023, BLUE), (2025, ORANGE)):
    a = L.DATA[y]; k = (a['month'] >= 4) & (a['month'] <= 9)
    P = a['fr_p'][k]; rel = P / P.mean(axis=1, keepdims=True)
    prof = 100 * np.nanmedian(np.where(np.abs(P.mean(axis=1, keepdims=True)) > 5, rel, np.nan), axis=0)
    ax.plot(range(24), prof, color=col, lw=2.2, marker='o', ms=4, label=str(y))
ax.axhline(100, color=INK, lw=1); ax.set_xticks(range(0, 24, 2)); ax.set_xlabel('Heure (Paris)'); ax.set_ylabel('Prix de l\'heure ÷ prix moyen du jour (%)')
ax.legend(loc='lower left', ncol=3)
save(f, 'fig3_cannibalisation', 'La cannibalisation : le prix de midi s\'effondre à mesure que le solaire grandit',
     'Prix médian de chaque heure, avril à septembre, rapporté à la moyenne du jour. Parc solaire : 9,5 GW en 2019, 30,4 GW en 2025.')

# 4. price according to the stop threshold
f, ax = fig(10, 4.8)
labels = ['≤ 0', '< 0', '< −0,1', '< −0,5', '< −1', '< −2', '< −5', '< −10', '< −20', '< −50', '< −100', 'jamais']
for tech, col, lab in (('solar', ORANGE, 'Solaire'), ('wind', BLUE, 'Éolien')):
    th = D[tech]['thr'][1:]
    ax.plot(range(len(th)), [r['price'] for r in th], color=col, lw=2, marker='o', ms=6, label=lab)
    ax.annotate(fr(th[0]['price'], 1), (0, th[0]['price']), xytext=(-6, 6), textcoords='offset points', ha='right', fontsize=9.5, color=INK2)
    ax.annotate(fr(th[1]['price'], 1), (1, th[1]['price']), xytext=(6, 6), textcoords='offset points', fontsize=9.5, color=INK2)
    ax.annotate(fr(th[-1]['price'], 1), (len(th) - 1, th[-1]['price']), xytext=(6, 0), textcoords='offset points', va='center', fontsize=9.5, color=INK2)
ax.set_xticks(range(len(labels))); ax.set_xticklabels(labels, fontsize=9.5); ax.set_xlabel('Le parc s\'arrête quand le prix est… (€/MWh)')
ax.set_ylabel('Prix PPA (€/MWh livré)'); ax.legend(loc='center right')
save(f, 'fig4_seuil', 'Étape 3 : le prix dépend de la clause d\'arrêt',
     'Livraison 2027–2029, pricer du 22 nov. 2026. Le revenu par MWh produit, lui, ne change presque pas.')

# 5. Monte Carlo distribution
U = np.array(D['solar']['U']); b = D['solar']['base']
f, ax = fig(10, 4.8)
ax.hist(U, bins=70, color='#9fc1ea', edgecolor=SURF, linewidth=0.5)
q25 = np.percentile(U, 25)
for x0, txt, c, ha in ((U.mean(), f' Moyenne {fr(U.mean(), 1)} €', INK, 'left'), (q25, f'P25 {fr(q25, 1)} € ', ORANGE, 'right')):
    ax.axvline(x0, color=c, lw=2); ax.text(x0, ax.get_ylim()[1] * 0.95, txt, color=c, fontsize=10.5, va='top', ha=ha)
ax.set_xlabel('Ce que rapporte un MWh vendu au prix forward, sur les 3 ans (€/MWh)'); ax.set_ylabel('Nombre de tirages')
save(f, 'fig5_montecarlo', 'Étape 4 : le Monte Carlo, 10 000 futurs possibles',
     f'Solaire, couverture {b["hedgeUsed"]} %. Risques de marché seuls (forward, volume) ; l\'erreur du modèle s\'ajoute à part.')

# 6. price waterfall (solar)
def waterfall(ax, steps, unit='€/MWh'):
    run, xs = 0, []
    for i, (lab, v, kind) in enumerate(steps):
        if kind == 'total':
            ax.bar(i, v, color=GREY, width=0.62); run = v; y = v
        else:
            ax.bar(i, v, bottom=run, color=AQUA if v >= 0 else ORANGE, width=0.62); y = run + max(v, 0); run += v
        ax.text(i, (v if kind == 'total' else y) + 1.2, fr(v, 2, kind != 'total'), ha='center', fontsize=9.5, color=INK)
        xs.append(lab)
    ax.set_xticks(range(len(xs))); ax.set_xticklabels(xs, fontsize=9.5); ax.set_ylabel(unit); ax.grid(axis='x', visible=False)


s = D['solar']['base']
steps = [('Cal pondéré', s['refW'], 'total'), ('Profil\nmensuel', s['genProf'] - s['refW'], 'd'), ('Cannibalisation\nhoraire', s['genFair'] - s['genProf'], 'd'),
         ('Prime de\nrisque', -s['premiumGen'], 'd'), ('Coût\nd\'écart', -s['imb'], 'd'), ('GO', s['goW'], 'd'), ('Marge', -s['margin'], 'd'), ('Prix PPA', s['ppaGen'], 'total')]
f, ax = fig(10, 5.2); waterfall(ax, steps); ax.set_ylim(0, 90)
save(f, 'fig6_cascade', f'Étape 6 : du forward au prix PPA solaire ({fr(s["ppaGen"])} €/MWh)',
     'Livraison 2027–2029, arrêt strictement sous 0 €. Pricer du 22 nov. 2026.')

# 7. premium waterfall (solar)
steps = [('Erreur du\nmodèle', s['modelRiskDyn'], 'd'), ('Couverture', s['hedgeRisk'], 'd'), ('Volume', s['premVolGen'], 'd'), ('Équilibrage', s['balRisk'], 'd'),
         ('Coût de\ncouverture', s['hedgeCost'], 'd'), ('Diversification', s['diversif'], 'd'), ('Prime', s['premiumGen'], 'total')]
f, ax = fig(10, 4.8)
run = 0
for i, (lab, v, kind) in enumerate(steps):
    if kind == 'total':
        ax.bar(i, v, color=GREY, width=0.62); ax.text(i, v + 0.1, fr(v), ha='center', fontsize=10)
    else:
        ax.bar(i, v, bottom=run, color=ORANGE if v >= 0 else AQUA, width=0.62); ax.text(i, run + max(v, 0) + 0.1, fr(v, 2, True), ha='center', fontsize=10); run += v
ax.set_xticks(range(len(steps))); ax.set_xticklabels([x[0] for x in steps], fontsize=9.5); ax.set_ylabel('€/MWh'); ax.grid(axis='x', visible=False)
save(f, 'fig7_prime', 'Étape 5 : la prime de risque solaire, ligne par ligne',
     f'Dont biais moyen du modèle {fr(s["biasDyn"])} €. Les risques presque indépendants s\'additionnent en racine de la somme des carrés.')

# 8. premium according to the hedge ratio
f, ax = fig(10, 4.8)
for tech, col, lab in (('solar', ORANGE, 'Solaire'), ('wind', BLUE, 'Éolien')):
    h = D[tech]['hedge']; ax.plot([r['h'] for r in h], [r['prem'] for r in h], color=col, lw=2, marker='o', ms=5, label=lab)
    bu = D[tech]['base']; ax.scatter([bu['hedgeUsed']], [bu['premiumGen']], s=90, color=col, edgecolor=INK, zorder=5)
    ax.annotate(f"optimum {bu['hedgeUsed']} % : {fr(bu['premiumGen'])} €", (bu['hedgeUsed'], bu['premiumGen']), xytext=(-10, -22), textcoords='offset points', ha='right', fontsize=9.5, color=INK2)
ax.set_xlabel('Part du volume attendu vendue en Cal baseload (%)'); ax.set_ylabel('Prime de risque (€/MWh)'); ax.set_ylim(0, 20); ax.legend(loc='upper right')
save(f, 'fig8_couverture', 'Étape 7 : un PPA solaire se couvre à environ 60 %, pas à 100 %',
     'Le prix capté suit le baseload en proportion de la capture : couvrir 100 % du volume, c\'est sur-couvrir.')

# 9. backtest generator vs capacity trend
bt = json.load(open('docs/ppa_formation/backtest.json'))
f, axs = plt.subplots(1, 2, figsize=(11, 5), dpi=160, sharey=True)
for ax, t, lab in ((axs[0], 's', 'Solaire'), (axs[1], 'w', 'Éolien')):
    rows = bt[t]; x = np.arange(len(rows))
    ax.axhline(0, color=INK, lw=1)
    for i, r in enumerate(rows):
        ax.plot([i, i], [r['gen'], r['trend']], color='#d6d5cf', lw=1.5, zorder=1)
    ax.scatter(x, [r['trend'] for r in rows], s=55, color=GREY, label='Tendance de capacité', zorder=3)
    ax.scatter(x, [r['gen'] for r in rows], s=55, color=ORANGE if t == 's' else BLUE, label='Générateur', zorder=4)
    ax.set_xticks(x); ax.set_xticklabels([f"{r['Y']}\n{r['h']} an{'s' if r['h'] > 1 else ''}" for r in rows], fontsize=8.5)
    g = np.mean([abs(r['gen']) for r in rows]); tr = np.mean([abs(r['trend']) for r in rows])
    ax.set_title(f'{lab} : erreur moyenne {fr(g, 1)} contre {fr(tr, 1)} €/MWh', fontsize=11, loc='left', color=INK)
    ax.legend(loc='upper left', fontsize=9)
axs[0].set_ylabel('Prévu − réalisé (€ par MWh payé)')
save(f, 'fig9_backtest', 'Les preuves : chaque livraison 2023–2026 prévue 1, 2 et 3 ans avant',
     'Positif = trop optimiste. Mêmes données disponibles à l\'époque pour les deux méthodes.')
print('done', sorted(os.listdir(OUT)))
