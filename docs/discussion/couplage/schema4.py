#!/usr/bin/env python3
"""The four coupling cases drawn on a simplified French merit order (illustrative fleet and prices, not data).
Each panel: France's supply curve (wind + solar, nuclear that modulates, hydro, gas), French load, the room on the
lines, the neighbours' prices, the French price (filled dot) and the price France would have alone (open dot).
Output: case1.png … case4.png"""
import os
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
os.chdir(os.path.dirname(os.path.abspath(__file__)))
BLUE, VIOLET, AMBER, SAND, GREY, RED, INK = '#3b6fb6', '#7a5cc7', '#d99a1e', '#c9b48a', '#8a8f98', '#c8453a', '#22252b'
LOAD = 55


def stack(res, nuc=45):
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
    ax.plot([q_fr], [p_fr], 'o', ms=10, color=RED, mec='white', mew=2, zorder=7)
    ax.text(q_fr + 1.2, p_fr + 4, f'prix France {p_fr:.0f} €', fontsize=9.5, color=RED, fontweight='bold')
    ax.text(.99, note_y, note, transform=ax.transAxes, ha='right', va='top', fontsize=8.6, color=INK,
            bbox=dict(boxstyle='round,pad=.45', fc='white', ec=GREY, lw=.8))
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


# 1 ── coupled with Core: the line has room, France takes the zone price
st = stack(5)
fig, ax = plt.subplots(figsize=(7.2, 4.9))
draw(ax, st, '1. Couplée avec la Belgique et l’Allemagne', 58, 75, [(75, 'Prix Allemagne = Belgique = 75 €', GREY)],
     (55, 58), 'export 3 GW\n(ligne : 5 GW)',
     'La ligne a de la place.\nLa France exporte jusqu’à ce que les prix\nsoient égaux : prix France = prix voisins.\nSeule, elle serait au prix de son hydraulique.',
     p_iso=price(st, LOAD))
save(fig, 'case1.png')

# 2 ── coupled with Spain only: line to Core full, France and Spain form one block
st = stack(12)
fig, ax = plt.subplots(figsize=(7.2, 4.9))
draw(ax, st, '2. Couplée avec l’Espagne seulement', 63, 65, [(97, 'Prix Allemagne 97 €', GREY), (65, 'Prix Espagne = France = 65 €', AMBER)],
     (55, 63), 'export 8 GW : Core plein (5)\n+ Italie, Suisse, GB',
     'La ligne vers l’Allemagne est pleine :\nle prix France ne monte pas jusqu’à 97 €.\nLa France et l’Espagne restent au même prix\n(un seul bloc, coupé du reste).',
     p_iso=price(st, LOAD))
save(fig, 'case2.png')

# 3 ── cut off from everyone, exporter: every line full, price read on France's own curve at load + exports
st = stack(25)
q = LOAD + 10
fig, ax = plt.subplots(figsize=(7.2, 4.9))
draw(ax, st, '3. Coupée de tous, exportatrice', q, price(st, q), [(94, 'Prix Allemagne 94 €', GREY), (82, 'Italie, Espagne… plus chers', GREY)],
     (55, 65), 'export 10 GW :\ntoutes les lignes pleines',
     'Toutes les lignes sont pleines.\nLe prix se lit sur le merit order français\nà « consommation + exports » :\nle nucléaire module, prix bas.',
     p_iso=price(st, LOAD))
save(fig, 'case3.png')

# 4 ── cut off from everyone, importer: France short, imports at the limit
st = stack(5, nuc=30)
fig, ax = plt.subplots(figsize=(7.2, 4.9))
draw(ax, st, '4. Coupée de tous, importatrice (2022)', 48, 100, [(80, 'Prix des voisins 80 €', GREY)],
     (55, 48), 'import 7 GW :\nlignes pleines vers la France',
     'Nucléaire en panne, froid : la France manque.\nElle importe au maximum, son prix reste\nau-dessus des voisins (gaz).\nSeule, elle serait en pénurie.',
     p_iso=160, note_y=.5, iso_lab='seule : pénurie')
save(fig, 'case4.png')
print('ok')
