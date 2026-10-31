#!/usr/bin/env python3
"""The four coupling cases drawn on a simplified French merit order (illustrative fleet and prices, not data).
Each panel: France's supply curve (wind + solar, nuclear that modulates, hydro, gas), French load, the room on the
lines, the neighbours' prices, the French price (filled dot) and the price France would have alone (open dot).
Output: m_0.png (France alone, the reference), m_1.png … m_4.png (one curve, one load, only the neighbours' price and
the line change), m_all.png (all cases on one drawing), hist_<case>.png (share of time per year)"""
import os
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
os.chdir(os.path.dirname(os.path.abspath(__file__)))
BLUE, VIOLET, AMBER, SAND, GREY, RED, INK = '#3b6fb6', '#7a5cc7', '#d99a1e', '#c9b48a', '#8a8f98', '#c8453a', '#22252b'
LOAD = 55


def stack(res, nuc=45):
    # nuc: GW of nuclear available
    """(x0, x1, p0, p1, colour, label): wind + solar at −5 €, nuclear sloped 10 → 55 €, hydro 8 GW at 65 €, gas 10 GW at 100 €"""
    x = 0; out = []
    for w, p0, p1, c, lab in ((res, -5, -5, BLUE, 'Éolien + solaire'), (nuc, 10, 55, VIOLET, 'Nucléaire (module)'),
                              (8, 65, 65, SAND, 'Hydraulique'), (10, 100, 100, AMBER, 'Gaz')):
        out.append((x, x + w, p0, p1, c, lab)); x += w
    return out


def price(st, q):
    for x0, x1, p0, p1, *_ in st:
        if q <= x1:
            return p0 + (p1 - p0) * (q - x0) / max(x1 - x0, 1e-9)
    return 160.0                                      # beyond the fleet: scarcity


def draw(ax, st, title, q_fr, p_fr, lines, band, band_lab, note, p_iso=None, note_y=.97, iso_lab=None):
    for x0, x1, p0, p1, c, lab in st:
        ax.fill_between([x0, x1], [-20, -20], [p0, p1], color=c, alpha=.85, lw=0, label=lab)
        ax.plot([x0, x1], [p0, p1], color=INK, lw=1.4)
    xe = st[-1][1]
    ax.plot([xe, xe, 100], [100, 160, 160], color=INK, lw=1.4, ls=':')
    ax.axvline(LOAD, color=INK, lw=1.3)
    ax.text(LOAD - .7, 152, 'Consommation\nfrançaise', ha='right', va='top', fontsize=8.5, color=INK)
    if band:
        ax.axvspan(min(band), max(band), color=GREY, alpha=.13, lw=0)
        ax.annotate('', xy=(band[1], -12), xytext=(band[0], -12), arrowprops=dict(arrowstyle='->', color=INK, lw=1.4))
        ax.text(sum(band) / 2, -9, band_lab, ha='center', va='bottom', fontsize=8.3, color=INK)
    for p, lab, c in lines:
        ax.axhline(p, color=c, lw=1.3, ls='--')
        ax.text(1, p + 2, lab, fontsize=8.5, color=c)
    if p_iso is not None:
        ax.plot([LOAD], [p_iso], 'o', ms=9, mfc='white', mec=INK, mew=1.6, zorder=6)
        ax.text(LOAD + 1.2, p_iso - 9, iso_lab or f'seule : {p_iso:.0f} €', fontsize=8.3, color=INK)
    if abs(q_fr - LOAD) > .1:
        ax.axvline(q_fr, color=RED, lw=1.2, ls='--')
        ax.text(q_fr + (.7 if q_fr > LOAD else -.7), 128, 'Production\nfrançaise', ha='left' if q_fr > LOAD else 'right', va='top', fontsize=8.5, color=RED)
    ax.plot([q_fr], [p_fr], 'o', ms=10, color=RED, mec='white', mew=2, zorder=7)
    left = q_fr < LOAD - .1
    ax.text(q_fr + (-1.2 if left else 1.2), p_fr + 4, f'prix France {p_fr:.0f} €', fontsize=9.5, color=RED, fontweight='bold', ha='right' if left else 'left')
    # the explanation sits in the slide's caption, not on the drawing
    ax.set_title(title, fontsize=11.5, color=INK, loc='left', fontweight='bold')
    ax.set_xlim(0, 100); ax.set_ylim(-20, 165)
    ax.set_xlabel('GW disponibles en France, du moins cher au plus cher', fontsize=8.5, color=INK)
    ax.set_ylabel('€/MWh', fontsize=8.5, color=INK)
    for s in ('top', 'right'): ax.spines[s].set_visible(False)
    ax.tick_params(labelsize=8)


def save(fig, fn):
    h, l = fig.axes[0].get_legend_handles_labels()
    fig.legend(h[:4], l[:4], loc='lower center', ncol=4, frameon=False, fontsize=9, bbox_to_anchor=(.5, -.01))
    plt.tight_layout(rect=(0, .05, 1, 1)); plt.savefig(fn, dpi=160, facecolor='white'); plt.close()




import json
import numpy as np
LIM = 10
ST = stack(15)                                    # the same French merit order in every drawing
P0 = price(ST, LOAD)                              # France alone: 50 €/MWh
NB = {1: 58, 2: 95, 3: 45, 4: 20}                 # neighbours' price in each case

def solve(pn):
    """France's production and price when coupled with neighbours at price pn through a line of LIM GW"""
    grid = np.linspace(LOAD - LIM, LOAD + LIM, 2001)
    want = [g for g in grid if price(ST, g) <= pn + 1e-9] if pn >= P0 else [g for g in grid if price(ST, g) >= pn - 1e-9]
    if pn >= P0:
        q = max(want) if want else LOAD
        return q, (pn if q < LOAD + LIM - 1e-6 else price(ST, q))
    q = min(want) if want else LOAD
    return q, (pn if q > LOAD - LIM + 1e-6 else price(ST, q))

def fig_case(i, title, fn):
    q, p = solve(NB[i])
    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    lab = f'export {q - LOAD:.0f} GW' if q > LOAD else f'import {LOAD - q:.0f} GW'
    lab += ' : ligne pleine' if abs(abs(q - LOAD) - LIM) < 1e-3 else f' (ligne : {LIM} GW)'
    draw(ax, ST, title, q, p, [(NB[i], f'Prix des voisins {NB[i]} €', GREY)], (LOAD, q), lab, '', p_iso=P0)
    save(fig, fn)
    return q, p

fig, ax = plt.subplots(figsize=(7.2, 4.4))
draw(ax, ST, '0. La référence : la France seule', LOAD, P0, [], None, '', '')
save(fig, 'm_0.png')
RES = {0: (LOAD, P0)}
for i, t in ((1, '1. Exportatrice, ligne pas saturée'), (2, '2. Exportatrice, ligne saturée'), (3, '3. Importatrice, ligne pas saturée'), (4, '4. Importatrice, ligne saturée')):
    RES[i] = fig_case(i, t, f'm_{i}.png')

# all cases on one drawing
fig, ax = plt.subplots(figsize=(9.6, 5.4))
for x0, x1, p0, p1, c, lab in ST:
    ax.fill_between([x0, x1], [-20, -20], [p0, p1], color=c, alpha=.8, lw=0, label=lab)
    ax.plot([x0, x1], [p0, p1], color=INK, lw=1.3)
ax.axvline(LOAD, color=INK, lw=1.3); ax.text(LOAD - .7, 152, 'Consommation\nfrançaise', ha='right', va='top', fontsize=9, color=INK)
ax.axvspan(LOAD - LIM, LOAD + LIM, color=GREY, alpha=.12, lw=0)
ax.text(LOAD, -14, f'± {LIM} GW : ce que les lignes laissent passer', ha='center', fontsize=8.5, color=INK)
ax.plot([LOAD], [P0], 'o', ms=11, mfc='white', mec=INK, mew=1.8, zorder=6)
ax.text(LOAD + 1, P0 - 9, f'0. seule : {P0:.0f} €', fontsize=9, color=INK)
lab = {1: '1 : 58 €', 2: '2 : 65 €', 3: '3 : 45 €', 4: '4 : 40 €'}
off = {1: (-1.2, 6), 2: (1.2, 5), 3: (-1.2, 6), 4: (-1.2, -11)}
for i in (1, 2, 3, 4):
    q, p = RES[i]
    ax.plot([q, 100 if q > LOAD else 0], [NB[i], NB[i]], color=GREY, lw=.9, ls='--')
    ax.text(99 if q > LOAD else 1, NB[i] + 2, f'voisins {NB[i]} €', fontsize=8, color=GREY, ha='right' if q > LOAD else 'left')
    ax.plot([q], [p], 'o', ms=10, color=RED, mec='white', mew=2, zorder=7)
    ax.text(q + off[i][0], p + off[i][1], lab[i], fontsize=9, color=RED, ha='left' if off[i][0] > 0 else 'right', fontweight='bold')
ax.set_xlim(0, 100); ax.set_ylim(-20, 165); ax.set_xlabel('GW disponibles en France, du moins cher au plus cher', fontsize=9); ax.set_ylabel('€/MWh', fontsize=9)
ax.set_title('Même merit order, même consommation : seul le prix des voisins change', fontsize=11.5, loc='left', fontweight='bold', color=INK)
for s_ in ('top', 'right'): ax.spines[s_].set_visible(False)
h, l = ax.get_legend_handles_labels(); fig.legend(h[:4], l[:4], loc='lower center', ncol=4, frameon=False, fontsize=9)
plt.tight_layout(rect=(0, .05, 1, 1)); plt.savefig('m_all.png', dpi=160, facecolor='white'); plt.close()

# share of time per year, one chart per case
H = json.load(open('cases_hist.json')); yh = sorted(H)
for k, c in (('exp_free', BLUE), ('exp_sat', VIOLET), ('imp_free', AMBER), ('imp_sat', RED)):
    v = [H[y][k]['share'] * 100 for y in yh]
    fig, ax = plt.subplots(figsize=(6.4, 2.0))
    ax.bar(range(len(yh)), v, .62, color=c)
    for i, x in enumerate(v):
        ax.text(i, x + 1.5, f'{x:.0f}', ha='center', fontsize=7.5, color=INK)
    ax.set_xticks(range(len(yh))); ax.set_xticklabels([y if y != '2026' else '2026*' for y in yh], fontsize=7.5)
    ax.set_ylim(0, max(v) * 1.25 + 2); ax.set_ylabel('% du temps', fontsize=8); ax.tick_params(labelsize=7.5)
    ax.set_title('Part du temps chaque année (* janv.–oct.)', fontsize=9, loc='left')
    for s_ in ('top', 'right'): ax.spines[s_].set_visible(False)
    plt.tight_layout(); plt.savefig(f'hist_{k}.png', dpi=160, facecolor='white'); plt.close()
json.dump({'P0': P0, 'NB': NB, 'res': {str(k): [round(v[0], 1), round(v[1], 1)] for k, v in RES.items()}, 'LIM': LIM}, open('m_cases.json', 'w'))
print(RES)
