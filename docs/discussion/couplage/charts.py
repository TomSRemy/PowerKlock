import json, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
sys.path.insert(0, '/tmp/schema')
src = open('/tmp/schema/couplage.py').read().split("fig, axs = plt.subplots")[0]
exec(src)
for res, rp, title, fn in ((5, 80, 'Heure calme : la ligne a de la place', 'p1'), (20, 60, 'Heure venteuse : la ligne est pleine', 'p2')):
    fig, ax = plt.subplots(figsize=(8.6, 5.2))
    panel(ax, res, rp, title)
    ax.legend(loc='upper left', bbox_to_anchor=(0, .93), frameon=False, fontsize=8.5)
    plt.tight_layout(); plt.savefig(f'{fn}.png', dpi=160, facecolor='white'); plt.close()
S = json.load(open('/tmp/schema/coupling_stats.json'))
ys = [y for y in ('2020', '2021', '2022', '2023', '2024', '2025')]
fig, ax = plt.subplots(figsize=(8.6, 4.6))
x = range(len(ys))
ax.bar([i - .2 for i in x], [S[y]['cut'] for y in ys], .4, color=BLUE, label='France moins chère que l’Allemagne (ligne pleine vers l’Allemagne)')
ax.bar([i + .2 for i in x], [S[y]['above'] for y in ys], .4, color=AMBER, label='France plus chère que l’Allemagne (la France manque)')
for i, y in enumerate(ys):
    ax.text(i - .2, S[y]['cut'] + 60, f"{S[y]['cut']:,}".replace(',', ' '), ha='center', fontsize=8.5, color=INK)
    ax.text(i + .2, S[y]['above'] + 60, f"{S[y]['above']:,}".replace(',', ' '), ha='center', fontsize=8.5, color=INK)
ax.set_xticks(list(x)); ax.set_xticklabels(ys); ax.set_ylabel('heures par an (écart de plus de 5 €)', fontsize=9)
for s in ('top', 'right'): ax.spines[s].set_visible(False)
ax.legend(frameon=False, fontsize=8.5, loc='upper left'); ax.set_ylim(0, 6400)
plt.tight_layout(); plt.savefig('hours.png', dpi=160, facecolor='white'); plt.close()
fig, ax = plt.subplots(figsize=(8.6, 4.6))
ax.plot(ys, [S[y]['fr'] for y in ys], '-o', color=BLUE, lw=2, label='France')
ax.plot(ys, [S[y]['de'] for y in ys], '-o', color=GREY, lw=2, label='Allemagne')
for y in ys:
    ax.text(y, max(S[y]['fr'], S[y]['de']) + 9, f"{S[y]['fr']:.0f} / {S[y]['de']:.0f}", ha='center', fontsize=8.5, color=INK)
ax.set_ylabel('prix spot moyen, €/MWh', fontsize=9); ax.legend(frameon=False, fontsize=9)
for s in ('top', 'right'): ax.spines[s].set_visible(False)
ax.set_ylim(0, 310)
plt.tight_layout(); plt.savefig('prices.png', dpi=160, facecolor='white'); plt.close()
print('ok')
