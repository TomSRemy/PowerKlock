#!/usr/bin/env python3
"""The four coupling cases drawn on a simplified French merit order (illustrative fleet and prices, not data).
Each panel: France's supply curve (wind + solar, nuclear that modulates, hydro, gas), French load, the room on the
lines, the neighbours' prices, the French price (filled dot) and the price France would have alone (open dot).
Output: c5_1.png … c5_5.png (five cases: exporter / importer × line saturated or not, and France cut off)"""
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
        ax.text(LOAD + 1, p_iso - 7, iso_lab or f'seule : {p_iso:.0f} €', fontsize=8.3, color=INK)
    if abs(q_fr - LOAD) > .1:
        ax.axvline(q_fr, color=RED, lw=1.2, ls='--')
        ax.text(q_fr + (.7 if q_fr > LOAD else -.7), 128, 'Production\nfrançaise', ha='left' if q_fr > LOAD else 'right', va='top', fontsize=8.5, color=RED)
    ax.plot([q_fr], [p_fr], 'o', ms=10, color=RED, mec='white', mew=2, zorder=7)
    ax.text(q_fr + 1.2, p_fr + 4, f'prix France {p_fr:.0f} €', fontsize=9.5, color=RED, fontweight='bold')
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



LIM = 10
# 1 ── exporter, line not saturated
st = stack(5)
fig, ax = plt.subplots(figsize=(7.2, 4.0))
draw(ax, st, '1. Exportatrice, ligne pas saturée', 58, 75, [(75, 'Prix des voisins 75 €', GREY)], (55, 58), f'export 3 GW\n(ligne : {LIM} GW)',
     'La ligne a de la place : la France exporte\njusqu’à ce que son prix égale celui des voisins.\nPrix France = prix voisins.', p_iso=price(st, LOAD))
save(fig, 'c5_1.png')
# 2 ── exporter, line saturated
st = stack(25); q = LOAD + LIM
fig, ax = plt.subplots(figsize=(7.2, 4.0))
draw(ax, st, '2. Exportatrice, ligne saturée', q, price(st, q), [(94, 'Prix des voisins 94 €', GREY)], (55, q), f'export {LIM} GW :\nligne pleine',
     'La France voudrait exporter plus que la ligne.\nSon prix se lit sur son merit order à\n« consommation + exports » : sous les voisins.', p_iso=price(st, LOAD))
save(fig, 'c5_2.png')
# 3 ── importer, line not saturated
st = stack(5, nuc=35)
fig, ax = plt.subplots(figsize=(7.2, 4.0))
draw(ax, st, '3. Importatrice, ligne pas saturée', 48, 80, [(80, 'Prix des voisins 80 €', GREY)], (55, 48), f'import 7 GW\n(ligne : {LIM} GW)',
     'La France importe jusqu’à ce que son prix\négale celui des voisins : les imports remplacent\nses centrales les plus chères (gaz).', p_iso=price(st, LOAD), note_y=.5)
save(fig, 'c5_3.png')
# 4 ── importer, line saturated
st = stack(5, nuc=30); q = LOAD - LIM
fig, ax = plt.subplots(figsize=(7.2, 4.0))
draw(ax, st, '4. Importatrice, ligne saturée', q, price(st, q), [(80, 'Prix des voisins 80 €', GREY)], (55, q), f'import {LIM} GW :\nligne pleine',
     'La France manque plus que la ligne ne peut\napporter : son prix reste au-dessus des voisins.\nSeule, elle serait en pénurie.', p_iso=160, note_y=.5, iso_lab='seule : pénurie')
save(fig, 'c5_4.png')
# 5 ── cut off: no exchange at all
st = stack(15)
fig, ax = plt.subplots(figsize=(7.2, 4.0))
draw(ax, st, '5. Coupée : aucun échange', LOAD, price(st, LOAD), [(85, 'Prix des voisins 85 € (inaccessible)', GREY)], None, '',
     'Pas de ligne : la France produit exactement\nce qu’elle consomme. Son prix se lit sur son\nmerit order à la consommation. Jamais observé :\non ne peut que l’estimer.')
save(fig, 'c5_5.png')
print('ok')
