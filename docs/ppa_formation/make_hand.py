"""Charts and worked figures of the 'redo it by hand' sheets (docs/ppa_formation). Run from the repo root:
python3 docs/ppa_formation/make_hand.py  → docs/ppa_formation/img_main/*.png and hand_figures.json"""
import json, os, sys, math, datetime as dt
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
sys.path.insert(0, 'scripts'); _a, sys.argv = sys.argv, ['x']
import ppa_lab as L  # noqa: E402
import ppa_backtest as B  # noqa: E402
sys.argv = _a
OUT = 'docs/ppa_formation/img_main'; os.makedirs(OUT, exist_ok=True)
BLUE, LBLUE, ORANGE, AQUA, GREY, LGREY, INK, INK2, SURF, VIOL = '#2a78d6', '#9fc1ea', '#eb6834', '#1baf7a', '#8f8e89', '#d6d5cf', '#0b0b0b', '#52514e', '#fcfcfb', '#6250d6'
plt.rcParams.update({'font.size': 11, 'axes.edgecolor': '#c9c8c2', 'axes.labelcolor': INK2, 'xtick.color': INK2, 'ytick.color': INK2,
                     'axes.spines.top': False, 'axes.spines.right': False, 'axes.grid': True, 'grid.color': '#e7e6e1', 'grid.linewidth': 0.8,
                     'axes.axisbelow': True, 'figure.facecolor': SURF, 'axes.facecolor': SURF, 'savefig.facecolor': SURF, 'legend.frameon': False})
FIG = {}
MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
MFR = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc']


def fr(v, d=2, sign=False):
    v = v + (5e-7 if v >= 0 else -5e-7)
    t = f'{v:+.{d}f}' if sign else f'{v:.{d}f}'
    return t.replace('.', ',').replace('-', '−')


def save(f, name, title, sub=None):
    f.suptitle(title, x=0.01, ha='left', fontsize=14, fontweight='bold', color=INK, y=0.985)
    if sub:
        f.text(0.01, 0.885 if f.get_figheight() < 7 else 0.93, sub, ha='left', fontsize=10.5, color=INK2)
    top = 0.86 if f.get_figheight() < 7 else 0.91
    f.tight_layout(rect=(0, 0.02, 1, top if sub else 0.93))
    f.savefig(f'{OUT}/{name}.png'); plt.close(f)


# ───────────────────────── Fiche 1: the monthly forward curve, step by step ─────────────────────────
ct = json.load(open('data/history/fr_market_contracts.json'))['FR']
newest = max(max(v['points']) for k, v in ct.items() if v.get('points') and not k.endswith('Peak'))
allq = {k: v['points'][max(v['points'])] for k, v in ct.items() if v.get('points') and max(v['points']) >= newest and not k.endswith('Peak')}
d0 = dt.date.fromisoformat(newest)


def liquid(k):
    if k.startswith('Cal'):
        return True
    if k[:3] in MON:
        y, m = int(k[3:]), MON.index(k[:3]) + 1
        return 1 <= (y - d0.year) * 12 + m - d0.month <= 3
    if k.startswith('Q'):
        q, y = int(k[1]), int(k[2:])
        return 1 <= (y - d0.year) * 4 + q - ((d0.month - 1) // 3 + 1) <= 4
    return False


live = {k: v for k, v in allq.items() if liquid(k)}
FM = json.load(open('data/history/fr_forward_monthly.json'))
R = {k: {int(m): x for m, x in v.items()} for k, v in FM['ratios'].items() if isinstance(v, dict)}
YRS = (2027, 2028, 2029)
mk = [f'{y}-{m:02d}' for y in YRS for m in range(1, 13)]
stA = {k: live[f'Cal{k[:4]}'] for k in mk}
stB = {k: live[f'Cal{k[:4]}'] * R['year'][int(k[5:])] for k in mk}
stC = {}
for k in mk:
    y, m = int(k[:4]), int(k[5:]); q = (m - 1) // 3 + 1
    if f'{MON[m - 1]}{y}' in live: stC[k] = (live[f'{MON[m - 1]}{y}'], 'mois')
    elif f'Q{q}{y}' in live: stC[k] = (live[f'Q{q}{y}'] * R['quarter'][m], 'trimestre')
    else: stC[k] = (stB[k], 'Cal × forme historique')
final = {k: FM['months'][k]['value'] for k in mk}
FIG['fpc'] = {'asOf': newest, 'live': live, 'illiquid': sorted(k for k in allq if k not in live), 'ratios_year': R['year'], 'ratios_quarter': R['quarter'],
              'final': final, 'from': {k: FM['months'][k]['from'] for k in mk}, 'shape': {k: FM['months'][k].get('shape') for k in mk}}
# worked months
FIG['fpc']['ex'] = {
    'jan27': final['2027-01'],
    'apr27': {'Q2': live['Q22027'], 'ratio': R['quarter'][4], 'raw': live['Q22027'] * R['quarter'][4], 'final': final['2027-04']},
    'q2_27': {k: (stC[k][0], final[k]) for k in ('2027-04', '2027-05', '2027-06')},
    'apr28': {'Cal': live['Cal2028'], 'hist': R['year'][4], 'final': final['2028-04']},
}
# shape of 2027 (month ÷ year) used for 2028 at 50 %, 2029 at 25 %
m27 = [final[f'2027-{m:02d}'] for m in range(1, 13)]; s27 = [v / (sum(m27) / 12) for v in m27]
FIG['fpc']['shape27'] = s27
w28 = 0.5
FIG['fpc']['ex']['apr28']['s27'] = s27[3]; FIG['fpc']['ex']['apr28']['mix'] = w28 * s27[3] + (1 - w28) * R['year'][4]
FIG['fpc']['ex']['apr28']['beforeCal'] = live['Cal2028'] * FIG['fpc']['ex']['apr28']['mix']
FIG['fpc']['ex']['apr28']['Q2_28'] = live.get('Q22028')

# H1: the quoted products, as segments at their price over their period
f, ax = plt.subplots(figsize=(11, 5.4), dpi=160)
def seg(k, v, col, lw, ls='-', lab=None):
    if k.startswith('Cal'): y = int(k[3:]); a, b = dt.date(y, 1, 1), dt.date(y, 12, 31)
    elif k.startswith('Q'): q, y = int(k[1]), int(k[2:]); a = dt.date(y, 3 * q - 2, 1); b = dt.date(y + (q == 4), 1 if q == 4 else 3 * q + 1, 1) - dt.timedelta(1)
    elif k.startswith('Sum'): y = int(k[3:]); a, b = dt.date(y, 4, 1), dt.date(y, 9, 30)
    elif k.startswith('Win'): y = int(k[3:]); a, b = dt.date(y, 10, 1), dt.date(y + 1, 3, 31)
    else: y, m = int(k[3:]), MON.index(k[:3]) + 1; a = dt.date(y, m, 1); b = dt.date(y + (m == 12), 1 if m == 12 else m + 1, 1) - dt.timedelta(1)
    ax.hlines(v, a, b, color=col, lw=lw, ls=ls, label=lab)
    return a, b
lab_done = set()
for k, v in sorted(allq.items()):
    if k.startswith('Dec2026') or k.startswith(('Cal2030', 'Cal2031', 'Cal2032')):
        continue
    kind = 'Cal' if k.startswith('Cal') else 'Trimestre' if k.startswith('Q') else 'Saison' if k[:3] in ('Sum', 'Win') else 'Mois'
    liq = k in live
    col = {'Cal': INK, 'Trimestre': BLUE, 'Mois': ORANGE, 'Saison': GREY}[kind]
    lab = (kind + (' (liquide)' if liq else ' (peu liquide, écarté)')) if (kind, liq) not in lab_done else None; lab_done.add((kind, liq))
    a, b = seg(k, v, col if liq else LGREY, 3 if liq else 2, '-' if liq else '--', lab)
    if liq and kind != 'Mois':
        ax.text(a + (b - a) / 2, v + 4, f"{k.replace('Cal', 'Cal ').replace('Q1', 'T1 ').replace('Q2', 'T2 ').replace('Q3', 'T3 ').replace('Q4', 'T4 ')} : {fr(v, 0)}", ha='center', fontsize=8.5, color=INK2)
ax.set_ylabel('€/MWh'); ax.set_ylim(0, 230); ax.legend(loc='upper right', fontsize=9, ncol=2)
save(f, 'h1_produits', 'Fiche 1 : la matière première, les produits cotés le 20 nov. 2026',
     'Chaque trait : un contrat baseload France, à son prix, sur sa période. Gris pointillé : coté mais peu échangé, non utilisé pour la forme.')

# H2: the four steps
f, axs = plt.subplots(2, 2, figsize=(12, 7.4), dpi=160, sharey=True)
x = np.arange(len(mk))
steps = [('A. Le Cal seul, plat', [stA[k] for k in mk], GREY),
         ('B. × la forme historique du day-ahead (mois ÷ année)', [stB[k] for k in mk], LBLUE),
         ('C. On pose les mois et trimestres liquides', [stC[k][0] for k in mk], BLUE),
         ('D. Recalage : chaque produit coté et chaque Cal tenus exactement', [final[k] for k in mk], ORANGE)]
for ax, (t, v, c) in zip(axs.flat, steps):
    cols = [c] * len(mk)
    if t.startswith('C'):
        cols = [ORANGE if stC[k][1] == 'mois' else BLUE if stC[k][1] == 'trimestre' else LBLUE for k in mk]
    ax.bar(x, v, color=cols, width=0.8)
    for i0, y in enumerate(YRS):
        ax.hlines(live[f'Cal{y}'], i0 * 12 - 0.4, i0 * 12 + 11.4, color=INK, lw=1.3)
    ax.set_title(t, fontsize=11, loc='left', color=INK); ax.set_xticks([0, 12, 24]); ax.set_xticklabels(['janv. 2027', 'janv. 2028', 'janv. 2029'], fontsize=9)
axs[0, 0].set_ylabel('€/MWh'); axs[1, 0].set_ylabel('€/MWh')
save(f, 'h2_construction', 'Fiche 1 : la courbe forward mensuelle se construit en 4 étapes',
     'Trait noir : le Cal de chaque année. En C, orange = mois coté, bleu = trimestre coté, bleu clair = Cal × forme (2028, 2029).')

# ───────────────────────── Fiche 2: the hourly curve ─────────────────────────
years = [y for y in range(2016, 2026) if y != 2022]
H = {y: L.DATA[y] for y in years}
def dtype(d):
    w = d.weekday(); return 2 if w == 6 else 1 if w == 5 else 0
mc, dc, hc = {}, {}, {}
lastY = years[-1]
for y in years:
    a = H[y]; wt = 0.5 ** (lastY - y)
    ya = np.nanmean(a['fr_p']); days = [dt.date.fromisoformat(str(d)[:10]) for d in a['days']]
    for m in range(1, 13):
        km = a['month'] == m; ma = np.nanmean(a['fr_p'][km]); mc.setdefault(m, []).append((ma / ya, wt))
        for t in range(3):
            kt = km & np.array([dtype(d) == t for d in days])
            if not kt.any(): continue
            ta = np.nanmean(a['fr_p'][kt]); dc.setdefault((m, t), []).append((ta / ma, wt))
            prof = np.nanmean(a['fr_p'][kt], axis=0) / ta
            for h in range(24): hc.setdefault((m, t, h), []).append((prof[h], wt))
avg = lambda o: {k: sum(x * w for x, w in v) / sum(w for _, w in v) for k, v in o.items()}
MC, DC, HC = avg(mc), avg(dc), avg(hc)
FIG['hourly'] = {'mc': {m: MC[m] for m in range(1, 13)}, 'dc_june': {t: DC[(6, t)] for t in range(3)}, 'hc_june_wd': [HC[(6, 0, h)] for h in range(24)],
                 'hc_jan_wd': [HC[(1, 0, h)] for h in range(24)]}
grid = np.array([[HC[(m, 0, h)] for h in range(24)] for m in range(1, 13)])
f, ax = plt.subplots(figsize=(11, 5.2), dpi=160)
im = ax.imshow(grid * 100, aspect='auto', cmap='RdBu_r', vmin=0, vmax=200)
ax.set_yticks(range(12)); ax.set_yticklabels(MFR); ax.set_xticks(range(0, 24, 2)); ax.set_xlabel('Heure (Paris)'); ax.grid(False)
for m in (0, 5):
    for h in (3, 8, 13, 19):
        ax.text(h, m, fr(grid[m, h] * 100, 0), ha='center', va='center', fontsize=8, color=INK)
cb = f.colorbar(im, ax=ax, fraction=0.03); cb.set_label('% du prix moyen du jour ouvré du mois')
save(f, 'h3_coefficients', 'Fiche 2 : les coefficients horaires (jours ouvrés)',
     'Prix de chaque heure ÷ prix moyen des jours ouvrés du mois, 2016-2025 sans 2022, poids divisé par 2 par année de recul.')
# week of June 2027: skeleton × level of June 2027 from the monthly curve (simplified: month level × day-type × hour)
d0w = dt.date(2027, 6, 7); wk = [d0w + dt.timedelta(i) for i in range(7)]
lvl = final['2027-06']
# day-type coefficients inside June normalised so the month averages its level
nd = {t: sum(1 for i in range(30) if dtype(dt.date(2027, 6, 1) + dt.timedelta(i)) == t) for t in range(3)}
norm = sum(DC[(6, t)] * nd[t] for t in range(3)) / 30
vals = [lvl * DC[(6, dtype(d))] / norm * HC[(6, dtype(d), h)] for d in wk for h in range(24)]
prof = []
for d in wk:
    s = [np.nanmean([L.DATA[y]['fr_s'][(L.DATA[y]['month'] == 6)][:, h].mean() / (B.CAP['s'][y] * 1000) for y in (2024, 2025)]) for h in range(24)]
    prof += s
f, (a1, a2) = plt.subplots(2, 1, figsize=(11, 6.2), dpi=160, sharex=True, gridspec_kw={'height_ratios': [2, 1]})
xx = np.arange(len(vals))
a1.plot(xx, vals, color=BLUE, lw=1.8); a1.axhline(lvl, color=INK, lw=1, ls='--'); a1.text(2, lvl + 3, f'Forward juin 2027 : {fr(lvl)} €', fontsize=9.5, color=INK)
a1.set_ylabel('€/MWh')
a2.fill_between(xx, np.array(prof) * 100, color=ORANGE, alpha=0.6, lw=0); a2.set_ylabel('Facteur de\ncharge solaire (%)')
a2.set_xticks(range(12, 168, 24)); a2.set_xticklabels([['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'][i] + ' ' + str(d.day) for i, d in enumerate(wk)])
save(f, 'h4_semaine', 'Fiche 2 : une semaine de juin 2027, heure par heure',
     'Courbe forward horaire = forward du mois × coefficient du type de jour × coefficient de l\'heure. En dessous : production solaire moyenne de juin.')
FIG['hourly']['june27'] = lvl; FIG['hourly']['norm_june'] = norm; FIG['hourly']['nd_june'] = nd

# ───────────────────────── Fiche 3: one real day ─────────────────────────
DAY = dt.date(2025, 6, 12)
a = L.DATA[2025]; di = [str(d)[:10] for d in a['days']].index(DAY.isoformat())
P, S = a['fr_p'][di], a['fr_s'][di]
rows = [{'h': h, 'p': float(P[h]), 's': float(S[h])} for h in range(24)]
base = float(P.mean())
paid = P >= 0
FIG['day'] = {'date': DAY.isoformat(), 'rows': rows, 'base': base, 'prod': float(S.sum()), 'paidMWh': float(S[paid].sum()),
              'value_all': float((S * P).sum()), 'value_paid': float((S[paid] * P[paid]).sum()),
              'cap_all': float((S * P).sum() / S.sum() / base), 'cap_paid': float((S[paid] * P[paid]).sum() / S[paid].sum() / base),
              'paid_share': float(S[paid].sum() / S.sum()), 'value_le0': float((S[P > 0] * P[P > 0]).sum()), 'paid_le0': float(S[P > 0].sum())}
f, (a1, a2) = plt.subplots(2, 1, figsize=(11, 6.4), dpi=160, sharex=True, gridspec_kw={'height_ratios': [1, 1]})
a1.bar(range(24), P, color=[ORANGE if p < 0 else GREY if p == 0 else BLUE for p in P]); a1.axhline(0, color=INK, lw=1); a1.axhline(base, color=INK, lw=1, ls='--')
a1.text(23.5, base + 3, f'baseload {fr(base, 1)} €', ha='right', fontsize=9.5); a1.set_ylabel('Prix (€/MWh)')
a2.bar(range(24), S / 1000, color=[LGREY if p < 0 else ORANGE for p in P]); a2.set_ylabel('Solaire France (GW)')
a2.set_xticks(range(0, 24, 2)); a2.set_xlabel('Heure (Paris)')
a2.text(0.3, max(S / 1000) * 0.9, 'gris : production arrêtée (prix < 0)', fontsize=9.5, color=INK2)
save(f, 'h5_journee', f'Fiche 3 : une vraie journée, le 12 juin 2025', 'En haut : prix day-ahead (orange : négatif, gris : 0 €). En bas : production solaire nationale. Source : RTE, ENTSO-E.')

# ───────────────────────── Fiche 4: the price table and a future hour ─────────────────────────
FC = None
try:
    sys.path.insert(0, 'scripts'); _a2, sys.argv = sys.argv, ['x']; import ppa_scenarios as G; sys.argv = _a2
    FC = G.fuel_cost()
except Exception as e:
    print('fuel', e)
xs, pos, share = [], [], []
for y in (2024, 2025):
    b = L.DATA[y]
    regR = sum(b[c + '_l'] - b[c + '_s'] - b[c + '_w'] - b[c + '_n'] for c in ('DE', 'BE', 'ES')) + b['fr_l'] - b['fr_s'] - b['fr_w'] - b['fr_n']
    regL = sum(b[c + '_l'] for c in ('DE', 'BE', 'ES')) + b['fr_l']
    sh = regR / regL
    cost = np.array([FC.get(str(d)[:10], np.nan) for d in b['days']])[:, None] if FC else np.nan
    hr = np.tile(np.arange(24), (len(b['days']), 1)); mo = np.repeat(b['month'][:, None], 24, 1)
    k = (mo >= 4) & (mo <= 9) & (hr >= 9) & (hr < 17)
    xs.append(sh[k]); pos.append((b['fr_p'] / cost)[k]); share.append(b['fr_p'][k])
X, Rr, Pp = np.concatenate(xs), np.concatenate(pos), np.concatenate(share)
bins = np.arange(np.floor(np.nanmin(X) / 0.025) * 0.025, np.nanmax(X) + 0.025, 0.025)
cx, cpos, cq, cn = [], [], [], []
for b0, b1 in zip(bins[:-1], bins[1:]):
    s = (X >= b0) & (X < b1) & np.isfinite(Rr)
    if s.sum() >= 15:
        cx.append((b0 + b1) / 2); q = Pp[s] >= 0; cq.append(q.mean()); cpos.append(np.mean(Rr[s][q]) if q.any() else np.nan); cn.append(int(s.sum()))
FIG['table'] = {'x': cx, 'pos': cpos, 'q': cq, 'n': cn}
f, (a1, a2) = plt.subplots(1, 2, figsize=(11.5, 4.8), dpi=160)
a1.plot(np.array(cx) * 100, np.array(cq) * 100, color=BLUE, lw=2, marker='o', ms=4); a1.set_ylabel('Chance que le prix soit ≥ 0 (%)'); a1.set_xlabel('Part résiduelle régionale (%)')
a2.plot(np.array(cx) * 100, np.array(cpos) * 100, color=ORANGE, lw=2, marker='o', ms=4); a2.set_ylabel('Prix positif ÷ coût d\'une centrale gaz (%)'); a2.set_xlabel('Part résiduelle régionale (%)')
save(f, 'h6_table', 'Fiche 4 : une case de la table de prix (été, 9 h–17 h)',
     'Part résiduelle = (conso − solaire − éolien − nucléaire) ÷ conso, France + Allemagne + Belgique + Espagne. Heures de 2024-2025, tranches de 2,5 points.')

# the same real day with the 2028 fleets, priced by the generator's own rule
try:
    sys.path.insert(0, '/tmp/claude-0/-home-user-PowerKlock/dee61f96-497a-584e-96c2-e0b3653a988e/scratchpad/incr'); _a3, sys.argv = sys.argv, ['x']
    import incr as I; import ppa_generator as PG; sys.argv = _a3
    with PG._cfg(PG.BEST['solar']):
        known = [y for y in L.DATA if y <= 2025 and L.DATA[y]['complete']]
        rule = I.Rule('s', known)
        s0 = I.state_at(2025); capY = {c: {tt: L.cap_future(c, tt, 2028) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
        s1 = I.state_at(2025, 2028, capY)
        e0, e1 = rule.evaluate(s0), rule.evaluate(s1)
    FIG['future'] = {'M0': [float(v) for v in e0['Mv'][di]], 'M1': [float(v) for v in e1['Mv'][di]], 'q0': [float(v) for v in e0['fq'][di]], 'q1': [float(v) for v in e1['fq'][di]],
                     'x0': [float(v) for v in e0['x'][di]], 'x1': [float(v) for v in e1['x'][di]], 'S1': [float(v) for v in s1['S']['FR'][di]], 'ratio': float(s1['ratio'][('FR', 's')][di][0]),
                     'cost': float(s0['cday'][di][0]), 'need0': [float(v) for v in e0['need'][di]], 'need1': [float(v) for v in e1['need'][di]]}
    fu = FIG['future']
    f, (a1, a2) = plt.subplots(2, 1, figsize=(11, 6.4), dpi=160, sharex=True)
    a1.plot(range(24), P, color=GREY, lw=2, marker='o', ms=3, label='Prix réel 2025')
    a1.plot(range(24), fu['M0'], color=BLUE, lw=2, label='Table, parc 2025')
    a1.plot(range(24), fu['M1'], color=ORANGE, lw=2, label='Table, parc 2028')
    a1.axhline(0, color=INK, lw=1); a1.set_ylabel('€/MWh'); a1.legend(loc='upper center', ncol=3, fontsize=9.5)
    a2.bar(np.arange(24) - 0.2, S / 1000, width=0.4, color=LBLUE, label='Solaire 2025'); a2.bar(np.arange(24) + 0.2, np.array(fu['S1']) / 1000, width=0.4, color=ORANGE, label='Même météo, parc 2028')
    a2.set_ylabel('GW'); a2.legend(loc='upper left', fontsize=9.5); a2.set_xticks(range(0, 24, 2)); a2.set_xlabel('Heure (Paris)')
    save(f, 'h7_futur', 'Fiche 4 : la même journée avec le parc 2028', 'Le générateur garde la météo, la consommation et le nucléaire du jour, grossit le parc, et relit le prix dans sa table.')
except Exception as e:
    import traceback; traceback.print_exc(); print('future skipped', e)

# H8: generator pipeline schema
f, ax = plt.subplots(figsize=(12, 4.4), dpi=160); ax.axis('off'); ax.set_xlim(0, 12); ax.set_ylim(0, 4.4)
boxes = [('Vraies semaines\n2019-2025', 'météo, conso,\nnucléaire, gaz,\nexport, voisins'), ('Parc futur', 'production par GW\n× GW de l\'année\n(PPE3, voisins,\nbatteries)'),
         ('Table de prix', 'case = saison ×\nmoment × part\nrésiduelle → prix,\nchance ≥ 0'), ('Arrêt', 'heures sous\nle seuil du\ncontrat retirées'), ('60 années', 'capture et part\npayée de chaque\nmois = moyenne'), ('× forward', 'valeur par MWh\nde chaque mois\n→ prix')]
for i, (h, d) in enumerate(boxes):
    x0 = 0.15 + i * 1.98
    ax.add_patch(FancyBboxPatch((x0, 0.5), 1.7, 3.3, boxstyle='round,pad=0.02,rounding_size=0.12', fc='#eef2f7', ec='#c9d3e0'))
    ax.text(x0 + 0.85, 3.4, h, ha='center', va='center', fontsize=11.5, fontweight='bold', color=INK)
    ax.text(x0 + 0.85, 1.85, d, ha='center', va='center', fontsize=9.5, color=INK2)
    if i < 5:
        ax.annotate('', xy=(x0 + 1.95, 2.15), xytext=(x0 + 1.72, 2.15), arrowprops=dict(arrowstyle='->', color=INK, lw=1.4))
ax.grid(False)
f.suptitle('Fiche 4 : le générateur de scénarios en une image', x=0.01, ha='left', fontsize=14, fontweight='bold', color=INK, y=0.97)
f.tight_layout(rect=(0, 0, 1, 0.92)); f.savefig(f'{OUT}/h8_generateur.png'); plt.close(f)

# ───────────────────────── Fiche 6: months → contract value ─────────────────────────
F = json.load(open('data/history/ppa_forecast.json'))
sh = F['share']['solar']; fc = F['forecast']['solar']['curt']
rows6 = []
cal27 = 110.99
q27 = [final[f'2027-{m:02d}'] for m in range(1, 13)]; dm = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
calw = sum(v * d for v, d in zip(q27, dm)) / sum(dm)
for m in range(1, 13):
    e = fc[f'2027-{m:02d}']
    rows6.append({'m': m, 'F': q27[m - 1], 'q': q27[m - 1] / calw, 'share': sh[str(m)], 'paid': e['generatorPaid'], 'c': e['generator']})
W = [r['share'] * r['paid'] for r in rows6]
cap = sum(w * r['q'] * r['c'] for w, r in zip(W, rows6)) / sum(W)
prof = sum(w * r['q'] for w, r in zip(W, rows6)) / sum(W)
FIG['months'] = {'rows': rows6, 'cap2027': cap, 'prof2027': prof, 'calw': calw, 'cal27_pricer': cal27}
f, ax = plt.subplots(figsize=(11, 4.8), dpi=160)
xm = np.arange(12)
ax.bar(xm - 0.2, [r['q'] * 100 for r in rows6], width=0.4, color=LBLUE, label='Forward du mois ÷ Cal')
ax.bar(xm + 0.2, [r['q'] * r['c'] * 100 for r in rows6], width=0.4, color=ORANGE, label='× capture du mois = valeur d\'un MWh solaire ÷ Cal')
for i, r in enumerate(rows6):
    ax.text(i + 0.2, r['q'] * r['c'] * 100 + 3, fr(r['share'] * r['paid'] * 100, 0) + ' %', ha='center', fontsize=8, color=INK2)
ax.axhline(100, color=INK, lw=1); ax.set_xticks(xm); ax.set_xticklabels(MFR); ax.set_ylabel('% du Cal 2027'); ax.legend(loc='upper center', fontsize=9.5, ncol=2)
save(f, 'h9_mois', 'Fiche 6 : de la capture de chaque mois à la valeur de 2027 (solaire)',
     f'Chiffre au-dessus des barres : poids du mois (part de la production × part payée). Moyenne pondérée : {fr(cap * 100, 1)} % du Cal.')

# ───────────────────────── Fiche 9: hedge payoff ─────────────────────────
c = 0.586  # solar capture of the tenor, weighted
mv = np.linspace(-40, 40, 81)
f, ax = plt.subplots(figsize=(11, 4.8), dpi=160)
F0 = 77.61
for h, col, lab in ((0, GREY, 'Pas de couverture'), (0.6, ORANGE, 'Couverture 60 %'), (1.0, BLUE, 'Couverture 100 %')):
    val = c * (F0 + mv) + h * (F0 - (F0 + mv))
    ax.plot(mv, val, color=col, lw=2.2, label=lab)
    ax.annotate(f'{lab.lower()} : {fr(val[0], 1)} → {fr(val[-1], 1)} €', (mv[-1], val[-1]), xytext=(6, 0), textcoords='offset points', va='center', fontsize=9, color=INK2)
ax.axvline(0, color=INK, lw=0.8); ax.set_xlabel('Écart du prix de marché réalisé au forward (€/MWh)'); ax.set_ylabel('Ce que rapporte un MWh solaire (€)'); ax.set_xlim(-40, 70)
ax.legend(loc='lower center', fontsize=9.5)
save(f, 'h10_couverture', 'Fiche 9 : pourquoi couvrir à 60 % et pas à 100 %',
     'MWh solaire = 0,59 × prix de marché. Couverture : + part couverte × (forward − prix réalisé). À 60 %, le résultat ne dépend presque plus du marché.')
FIG['hedge'] = {'c': c, 'F0': F0}

json.dump(FIG, open('docs/ppa_formation/hand_figures.json', 'w'), indent=1, default=float)
print('ok', sorted(os.listdir(OUT)))
