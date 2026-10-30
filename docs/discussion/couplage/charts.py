#!/usr/bin/env python3
"""Charts of the deck (PNG). Needs couplage.py (illustrative merit-order panels), coupling_stats.json, summary.json,
model_results.json, drivers.json and /tmp/coupl/{hourly,cf}.npz. Rules: rising prices red, falling blue; no green;
straight lines between points; one axis per chart."""
import json, os
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
src = open('couplage.py').read().split("fig, axs = plt.subplots")[0]
exec(src)                                            # supply(), panel(), colours
LIGHT = '#9db7dc'
plt.rcParams.update({'font.size': 9, 'axes.edgecolor': '#b9bcc2', 'axes.labelcolor': INK, 'xtick.color': INK, 'ytick.color': INK})
def clean(ax, grid=True):
    for s in ('top', 'right'): ax.spines[s].set_visible(False)
    if grid: ax.yaxis.grid(True, color='#ececef', lw=.8); ax.set_axisbelow(True)
def save(fn):
    plt.tight_layout(); plt.savefig(fn, dpi=160, facecolor='white'); plt.close()

# ── illustrative panels ─────────────────────────────────────────────────────
for res, rp, title, fn in ((5, 80, 'Heure calme : la ligne a de la place', 'p1'), (20, 60, 'Heure venteuse : la ligne est pleine', 'p2')):
    fig, ax = plt.subplots(figsize=(8.6, 5.2))
    panel(ax, res, rp, title)
    ax.legend(loc='upper left', bbox_to_anchor=(0, .93), frameon=False, fontsize=8.5)
    save(f'{fn}.png')

S = json.load(open('coupling_stats.json')); U = json.load(open('summary.json')); R = json.load(open('model_results.json'))
DR = json.load(open('drivers.json'))
ys = ['2020', '2021', '2022', '2023', '2024', '2025']
ys7 = ys + ['2026']
lab7 = ys + ['2026\n(janv.–oct.)']
fmt = lambda v: f"{v:,.0f}".replace(',', ' ')

# ── France vs Germany hours (corrected labels) ──────────────────────────────
fig, ax = plt.subplots(figsize=(8.6, 4.6)); x = np.arange(len(ys))
ax.bar(x - .2, [S[y]['cut'] for y in ys], .4, color=BLUE, label='France moins chère que l’Allemagne d’au moins 5 €')
ax.bar(x + .2, [S[y]['above'] for y in ys], .4, color=AMBER, label='France plus chère que l’Allemagne d’au moins 5 €')
for i, y in enumerate(ys):
    ax.text(i - .2, S[y]['cut'] + 60, fmt(S[y]['cut']), ha='center', fontsize=8.5, color=INK)
    ax.text(i + .2, S[y]['above'] + 60, fmt(S[y]['above']), ha='center', fontsize=8.5, color=INK)
ax.set_xticks(x); ax.set_xticklabels(ys); ax.set_ylabel('heures par an')
clean(ax); ax.legend(frameon=False, fontsize=8.5, loc='upper left'); ax.set_ylim(0, 6400)
save('hours.png')

fig, ax = plt.subplots(figsize=(8.6, 4.6))
ax.plot(ys, [S[y]['fr'] for y in ys], '-o', color=BLUE, lw=2, label='France')
ax.plot(ys, [S[y]['de'] for y in ys], '-o', color=GREY, lw=2, label='Allemagne')
for y in ys:
    ax.text(y, max(S[y]['fr'], S[y]['de']) + 9, f"{S[y]['fr']:.0f} / {S[y]['de']:.0f}", ha='center', fontsize=8.5, color=INK)
ax.set_ylabel('prix spot moyen, €/MWh'); ax.legend(frameon=False); clean(ax); ax.set_ylim(0, 310)
save('prices.png')

# ── coupling states, share of hours ─────────────────────────────────────────
ST = [('core', 'Couplée avec la Belgique et l’Allemagne', BLUE), ('partial', 'Couplée avec une partie des voisins (surtout l’Espagne)', LIGHT),
      ('cut_mid', 'Coupée de tous, prix entre ceux des voisins', SAND), ('cut_exp', 'Coupée de tous, la moins chère (exporte au maximum)', VIOLET),
      ('cut_imp', 'Coupée de tous, la plus chère (importe au maximum)', RED)]
fig, ax = plt.subplots(figsize=(8.6, 6.0)); x = np.arange(len(ys7)); bot = np.zeros(len(ys7))
for k, lab, c in ST:
    v = np.array([U[y]['shares'][k] * 100 for y in ys7])
    ax.bar(x, v, .62, bottom=bot, color=c, label=lab, edgecolor='white', lw=1.2)
    for i in range(len(ys7)):
        if v[i] >= 6:
            ax.text(x[i], bot[i] + v[i] / 2, f'{v[i]:.0f} %', ha='center', va='center', fontsize=8.5, color='white' if c in (BLUE, VIOLET, RED) else INK)
    bot += v
ax.set_xticks(x); ax.set_xticklabels(lab7); ax.set_ylabel('part des heures, %'); ax.set_ylim(0, 100)
clean(ax, False); ax.legend(frameon=False, fontsize=8.3, loc='upper center', bbox_to_anchor=(.5, -.1), ncol=2)
save('states.png')

# ── coupled share by border ─────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(8.6, 4.6))
for b, lab, c in (('DE', 'Allemagne', BLUE), ('BE', 'Belgique', VIOLET), ('ES', 'Espagne', AMBER), ('IT', 'Italie (Nord)', GREY)):
    v = [U[y]['borders'][b]['coupled'] * 100 for y in ys7]
    ax.plot(range(len(ys7)), v, '-o', color=c, lw=2, label=lab)
    ax.text(len(ys7) - .85, v[-1], lab, va='center', fontsize=8.5, color=INK)
ax.set_xticks(range(len(ys7))); ax.set_xticklabels(lab7); ax.set_ylabel('heures au même prix que la France, %')
ax.set_xlim(-.3, len(ys7) + .4); ax.set_ylim(0, 60); clean(ax); ax.legend(frameon=False, loc='upper right', fontsize=8.5)
save('borders.png')

# ── real vs island price, yearly ────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(8.6, 4.8)); x = np.arange(len(ys7))
real = [U[y]['real'] for y in ys7]; iso = [U[y]['iso'] for y in ys7]
ax.bar(x - .2, real, .4, color=BLUE, label='Prix réel (couplé)')
ax.bar(x + .2, iso, .4, color=SAND, label='France isolée (estimation du modèle)')
for i in range(len(ys7)):
    ax.text(x[i] - .2, real[i] + 4, f'{real[i]:.0f}', ha='center', fontsize=8.5, color=INK)
    ax.text(x[i] + .2, iso[i] + 4, f'{iso[i]:.0f}', ha='center', fontsize=8.5, color=INK)
    d = real[i] - iso[i]
    ax.text(x[i], max(real[i], iso[i]) + 24, f'{d:+.0f} €', ha='center', fontsize=9, fontweight='bold', color=RED if d > 0 else '#3f8f5a')
ax.set_xticks(x); ax.set_xticklabels(lab7); ax.set_ylabel('prix spot moyen, €/MWh'); ax.set_ylim(0, 345)
clean(ax); ax.legend(frameon=False, loc='upper right', fontsize=8.5)
save('real_vs_iso.png')

# ── monthly, 2023–2026 ──────────────────────────────────────────────────────
D = dict(np.load('/tmp/coupl/hourly.npz')); C = dict(np.load('/tmp/coupl/cf.npz'))
mk = np.array([d[:7] for d in D['days']])[:, None].repeat(24, 1)
okm = np.isfinite(D['p_FR']) & np.isfinite(C['p_iso']) & (C['ens'] == 0)
M = [dict(m=k, real=D['p_FR'][okm & (mk == k)].mean(), iso=C['p_iso'][okm & (mk == k)].mean(), de=np.nanmean(D['p_DE_LU'][okm & (mk == k)]))
     for k in sorted(set(mk[:, 0])) if k >= '2023-01' and (okm & (mk == k)).any()]
fig, ax = plt.subplots(figsize=(11.5, 4.4)); x = np.arange(len(M))
ax.plot(x, [m['de'] for m in M], color=GREY, lw=1.6, label='Allemagne (réel)')
ax.plot(x, [m['real'] for m in M], color=BLUE, lw=2.2, label='France (réel, couplée)')
ax.plot(x, [m['iso'] for m in M], color=VIOLET, lw=2.2, ls='--', label='France isolée (modèle)')
ax.set_xticks(x[::3]); ax.set_xticklabels([m['m'][:7] for m in M][::3], rotation=0, fontsize=8)
ax.set_ylabel('prix moyen du mois, €/MWh\n(hors heures de pénurie de la France isolée)'); clean(ax); ax.legend(frameon=False, ncol=3, loc='upper right', fontsize=8.5)
ax.axhline(0, color='#b9bcc2', lw=.8)
save('monthly.png')

# ── welfare per year ────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(10.4, 5.0)); x = np.arange(len(ys7)); w = .26
cons = [-U[y]['consumers'] for y in ys7]; prod = [U[y]['producers'] for y in ys7]; rent = [U[y]['rent'] for y in ys7]
ax.bar(x - w, cons, w, color=RED, label='Consommateurs français (− = ils paient plus)')
ax.bar(x, prod, w, color=BLUE, label='Producteurs français')
ax.bar(x + w, rent, w, color=VIOLET, label='Rente de congestion (frontières françaises, les deux côtés)')
for i in range(len(ys7)):
    for dx, v in ((-w, cons[i]), (0, prod[i]), (w, rent[i])):
        ax.text(x[i] + dx, v + (0.5 if v >= 0 else -0.5), f'{v:+.1f}', ha='center', va='bottom' if v >= 0 else 'top', fontsize=7.6, color=INK)
ax.axhline(0, color=INK, lw=.8)
ax.set_xticks(x); ax.set_xticklabels(lab7); ax.set_ylabel('Md€ par an, couplage comparé à une France isolée')
ax.set_ylim(-24, 25); clean(ax); ax.legend(frameon=False, loc='lower left', fontsize=8.3)
save('welfare.png')

# ── drivers: surplus vs export limit ────────────────────────────────────────
fig, ax = plt.subplots(figsize=(8.6, 4.6)); x = list(range(len(ys7)))
sp = [DR[y]['surplus_full_nuclear_gw'] for y in ys7]; lim = [DR[y]['jao_max_gw'] for y in ys7]
ax.plot(x, sp, '-o', color=VIOLET, lw=2.2, label='Surplus français à nucléaire plein (nucléaire disponible + éolien + solaire + fil de l’eau + bio − consommation)')
xl = [i for i in x if lim[i] is not None]
ax.plot(xl, [lim[i] for i in xl], '-o', color=AMBER, lw=2.2, label='Limite d’export de la France dans Core (JAO maxNetPos, moyenne ; 2022 : juin–déc.)')
for i in x:
    ax.text(i, sp[i] + .6, f'{sp[i]:.1f}', ha='center', fontsize=8.5, color=INK)
    if lim[i] is not None: ax.text(i, lim[i] - 1.2, f'{lim[i]:.1f}', ha='center', fontsize=8.5, color=INK)
ax.axhline(0, color='#b9bcc2', lw=.8)
ax.set_xticks(x); ax.set_xticklabels(lab7); ax.set_ylabel('GW, moyenne de l’année'); ax.set_ylim(-8, 15)
clean(ax); ax.legend(frameon=False, loc='upper left', fontsize=7.8)
save('drivers.png')

# ── validation: model vs real on cut-off hours (cross-validated) ────────────
D = dict(np.load('/tmp/coupl/hourly.npz')); C = dict(np.load('/tmp/coupl/cf.npz'))
st = np.load('/tmp/coupl/states.npz')['state'].reshape(len(D['days']), 24, 4)[:, :, 0]
yr = np.array([int(d[:4]) for d in D['days']])[:, None].repeat(24, 1)
sel = np.isin(st, ['cut_exp', 'cut_mid', 'cut_imp']) & (yr >= 2024) & np.isfinite(C['cv']) & np.isfinite(D['p_FR'])
fig, ax = plt.subplots(figsize=(6.4, 5.2))
ax.hexbin(D['p_FR'][sel], C['cv'][sel], gridsize=55, extent=(-60, 220, -60, 220), cmap='Purples', mincnt=1, bins='log')
ax.plot([-60, 220], [-60, 220], color=INK, lw=1)
ax.set_xlabel('prix réel, €/MWh'); ax.set_ylabel('prix du modèle (heure jamais vue à l’apprentissage), €/MWh')
ax.set_xlim(-60, 220); ax.set_ylim(-60, 220); clean(ax, False)
e = C['cv'][sel] - D['p_FR'][sel]
ax.text(-50, 200, f'Heures coupées 2024–2026 : {sel.sum():,} h\nécart moyen absolu {np.mean(np.abs(e)):.0f} €/MWh\nbiais moyen {np.mean(e):+.1f} €/MWh'.replace(',', ' '), fontsize=8.5, va='top', color=INK)
save('validation.png')
print('ok')
