import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

BLUE, VIOLET, AMBER, SAND, GREY, RED, INK = '#3b6fb6', '#7a5cc7', '#d99a1e', '#c9b48a', '#8a8f98', '#c8453a', '#22252b'
NUC, HYD, GAS = 45, 8, 10      # GW
LOAD, LIM = 55, 5              # French load, Core export limit (GW)


def supply(res):
    """French merit order: (GW start, GW end, € start, € end, colour, label)"""
    x = 0; out = []
    for w, p0, p1, c, lab in ((res, -5, -5, BLUE, 'Solaire + éolien'), (NUC, 5, 35, VIOLET, 'Nucléaire (modulable)'),
                              (HYD, 45, 45, SAND, 'Hydraulique'), (GAS, 95, 95, AMBER, 'Gaz')):
        out.append((x, x + w, p0, p1, c, lab)); x += w
    return out


def price_at(res, q):
    for x0, x1, p0, p1, *_ in supply(res):
        if q <= x1:
            return p0 + (p1 - p0) * (q - x0) / max(x1 - x0, 1e-9)
    return 120


def panel(ax, res, region_price, title):
    for x0, x1, p0, p1, c, lab in supply(res):
        ax.fill_between([x0, x1], [-20, -20], [p0, p1], color=c, alpha=.85, lw=0, label=lab)
        ax.plot([x0, x1], [p0, p1], color=INK, lw=1.6)
    ax.axvline(LOAD, color=INK, lw=1.4, ls='-')
    ax.text(LOAD - .8, 103, 'Consommation\nfrançaise', ha='right', va='top', fontsize=8.5, color=INK)
    # what France would export at the region's price
    want = sum(min(max(region_price - p0, 0) / max(p1 - p0, 1e-9), 1) * (x1 - x0) if p1 > p0 else (x1 - x0) * (p0 <= region_price)
               for x0, x1, p0, p1, *_ in supply(res)) - LOAD
    exp = min(want, LIM)
    cut = want > LIM
    ax.axvspan(LOAD, LOAD + LIM, color=GREY, alpha=.12, lw=0)
    ax.text(LOAD + LIM / 2, -14, f'export\nmax {LIM} GW', ha='center', fontsize=8, color=GREY)
    ax.axhline(region_price, color=GREY, lw=1.2, ls='--')
    ax.text(1, region_price + 2, f'Prix Allemagne / zone : {region_price} €', fontsize=8.5, color=GREY)
    p = region_price if not cut else price_at(res, LOAD + LIM)
    ax.plot([LOAD + exp], [p], 'o', ms=9, color=RED, zorder=5, mec='white', mew=2)
    lab = (f'Couplée : prix France = prix de la zone = {p:.0f} €\nla France exporte {want:.0f} GW (< {LIM} GW, la ligne suffit)' if not cut else
           f'Coupée : la France voudrait exporter {want:.0f} GW,\nla ligne n’en passe que {LIM} : prix France = {p:.0f} €\n(lu sur le merit order français seul)')
    ax.text(0.98, 0.04, lab, transform=ax.transAxes, ha='right', va='bottom', fontsize=9, color=INK,
            bbox=dict(boxstyle='round,pad=.4', fc='white', ec=RED if cut else GREY, lw=1))
    ax.set_title(title, fontsize=11, color=INK, loc='left', fontweight='bold')
    ax.set_xlim(0, 115); ax.set_ylim(-20, 105)
    ax.set_xlabel('GW disponibles en France, du moins cher au plus cher', fontsize=8.5, color=INK)
    ax.set_ylabel('€/MWh', fontsize=8.5, color=INK)
    for s in ('top', 'right'): ax.spines[s].set_visible(False)
    ax.tick_params(labelsize=8)
    return p


fig, axs = plt.subplots(1, 3, figsize=(17, 6.2))
p1 = panel(axs[0], 5, 80, '1. Heure calme')
p2 = panel(axs[1], 20, 60, '2. Heure venteuse')
p3 = panel(axs[2], 35, 55, '3. Heure très venteuse')
h, l = axs[0].get_legend_handles_labels()
fig.legend(h[:4], l[:4], loc='upper center', ncol=4, frameon=False, fontsize=9.5, bbox_to_anchor=(.5, .93))
fig.suptitle('Pourquoi la France se « coupe » de l’Allemagne, et pourquoi ça fait chuter la valeur du vent', fontsize=14, fontweight='bold', color=INK, y=1.0)
fig.text(.5, -.06,
 'Couplée, le prix n’est pas fixé par le merit order français seul : les voisins achètent l’électricité française tant qu’elle est moins chère que chez eux,\n'
 'donc la France prend le prix de toute la zone (souvent une centrale à gaz allemande). Un GW de vent en plus est absorbé par toute la zone : le prix bouge peu.\n'
 'Quand la France veut exporter plus que la ligne ne passe (limite Core publiée par JAO : 9,2 GW en 2023 → 5,4 GW en 2025), l’export est bloqué à la limite :\n'
 'le prix se lit alors sur le merit order français seul, au milieu du nucléaire qui module (ou en négatif). Chaque GW de vent en plus fait alors chuter le prix.\n'
 'Heures coupées : 629 h en 2021 → 5 460 h en 2025 ; 67 % de la production éolienne française de 2025 est tombée pendant ces heures.\n'
 'Chiffres des trois cas : illustratifs (parc et prix simplifiés). Heures coupées et limites : données PowerKlock (ENTSO-E, JAO).',
 ha='center', va='top', fontsize=9.5, color=INK)
plt.tight_layout(rect=(0, 0, 1, .9))
plt.savefig('couplage_france_allemagne.png', dpi=150, bbox_inches='tight', facecolor='white')
print(p1, p2, p3)
