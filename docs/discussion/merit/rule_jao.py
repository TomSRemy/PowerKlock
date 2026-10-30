import sys, warnings, json, os
import numpy as np
sys.path.insert(0, 'scripts'); sys.argv = ['x']; warnings.simplefilter('ignore')
import ppa_lab as L, ppa_scenarios as G
F = G.fuel_cost(); Q = {1: (1, 2, 3), 2: (4, 5, 6), 3: (7, 8, 9), 4: (10, 11, 12)}
JA = {}
def jmax(y):
    if y not in JA:
        try:
            d = json.load(open(f'data/history/jao_core/{y}.json'))['days']
        except OSError:
            d = {}
        JA[y] = np.array([d.get(str(x)[:10], {}).get('maxFR') or [np.nan] * 24 for x in L.DATA[y]['days']], float)
    return JA[y]
MODE = os.environ.get('MODE', 'base')
_ys = G.year_share
def xf_of(y):
    if MODE == 'base':
        return _ys(y, False)
    # France's surplus beyond its Core export limit of the hour, GW (residual load + limit; ≤ 0 = cut off)
    res = G.year_fr_gw(y) * 1000; j = jmax(y)
    j = np.where(np.isfinite(j), j, np.nanmean(j) if np.isfinite(j).any() else 8000)
    return (res + j) / 1000
def ys(y, region=True, hydro=False):
    return _ys(y, region, hydro) if region else xf_of(y)
G.year_share = ys
if MODE != 'base':
    G.FR_GW['on'] = True        # bins of 2 GW for this input
err = {'s': [], 'w': []}
for Y in (2023, 2024, 2025, 2026):
    fy = [y for y in L.DATA if y < Y and L.DATA[y]['complete'] and y >= 2019][-2:]
    pm = G.PriceModelFuel(fy, True); pm.add_france(fy)
    a = L.DATA[Y]; mo = a['month']
    c = np.array([F.get(str(d)[:10], np.nan) for d in a['days']])[:, None]
    f1, fp, fq = pm.phi(_ys(Y, True), G.PriceModelFuel.groups(mo), xf_of(Y), c)
    for t in 'sw':
        mr = L.month_rates(mo, a['fr_' + t], f1 * c, fp * c, fq); act = L.actual(t, Y)
        P = {m: r['curt'] for m, r in mr.items()}
        for q, mq in Q.items():
            if all(k in act and k in P for k in mq):
                err[t].append(L.score(P, act, 'curt', mq)['eur'])
print(MODE, 'true weather quarterly: solar MAE %.2f | wind MAE %.2f' % (np.mean(np.abs(err['s'])), np.mean(np.abs(err['w']))))
