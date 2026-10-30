import sys, warnings
import numpy as np
sys.path.insert(0, '/tmp/mo'); sys.path.insert(0, '/home/ubuntu/PowerKlock/.claude/worktrees/bridge-cse_019SBz1eD5ytFRZxqbyv9hcG/scripts')
sys.argv = ['x']; warnings.simplefilter('ignore')
import os; os.chdir('/home/ubuntu/PowerKlock/.claude/worktrees/bridge-cse_019SBz1eD5ytFRZxqbyv9hcG')
from load import eco, nuc_avail
import ppa_lab as L, ppa_scenarios as G
A = nuc_avail(); F = G.fuel_cost()
def year(y):
    days, e = eco(y)
    a = L.DATA[y]; pd = {str(d)[:10]: i for i, d in enumerate(a['days'])}
    keep = [i for i, d in enumerate(days) if d in pd and A.get(d) and F.get(d)]
    D = [days[i] for i in keep]; e = {k: v[keep] for k, v in e.items()}
    P = a['fr_p'][[pd[d] for d in D]]
    av = np.array([A[d] for d in D])[:, None]; c = np.array([F[d] for d in D])[:, None]
    R = e['load'] - e['exchanges'] - e['pumping'] - e['solar'] - e['wind'] - e['hydroRoR'] - e['bio'] - e['hydroLake'] - e['hydroPS'] - e['batteryDischarge'] + e['batteryCharge']
    mo = np.array([int(d[5:7]) for d in D])
    g = G.PriceModelFuel.groups(mo)
    return dict(D=D, e=e, P=P, m=R / av, c=c * np.ones((1, 24)), g=g, mo=mo, R=R, av=av)
Y_ = {y: year(y) for y in range(2021, 2026)}
def fit(ys, key, bw, eur):
    m = np.concatenate([Y_[y][key].ravel() for y in ys]); g = np.concatenate([Y_[y]['g'].ravel() for y in ys])
    p = np.concatenate([(Y_[y]['P'] if eur else Y_[y]['P'] / Y_[y]['c']).ravel() for y in ys])
    b = np.round(m / bw).astype(int); tab = {}
    for gi in np.unique(g):
        for bi in np.unique(b[g == gi]):
            k = (g == gi) & (b == bi)
            if k.sum() >= 15: tab[(gi, bi)] = p[k].mean()
    return tab
def pred(tab, Yd, key, bw, eur):
    b = np.round(Yd[key] / bw).astype(int); out = np.full(b.shape, np.nan)
    for (gi, bi) in set(zip(Yd['g'].ravel(), b.ravel())):
        ks = [k for k in tab if k[0] == gi]
        kb = min(ks, key=lambda k: abs(k[1] - bi))
        sel = (Yd['g'] == gi) & (b == bi); out[sel] = tab[kb]
    return out if eur else out * Yd['c']
def score(ph, Yd, t):
    v = Yd['e'][t]; P = Yd['P']; tot = 0; err = 0
    for mth in range(1, 13):
        k = Yd['mo'] == mth
        ca = (v[k] * P[k]).sum() / v[k].sum() / P[k].mean(); cp = (v[k] * ph[k]).sum() / v[k].sum() / ph[k].mean()
        w = v[k].sum(); err += (cp - ca) * P[k].mean() * w; tot += w
    return err / tot
for Y in (2023, 2024, 2025):
    tr = [Y - 2, Y - 1]
    for lab, key, bw, eur in (('nuclear load m, €', 'm', 0.02, True), ('nuclear load m, ×gas', 'm', 0.02, False)):
        ph = pred(fit(tr, key, bw, eur), Y_[Y], key, bw, eur)
        Yd = Y_[Y]; mae = np.nanmean(np.abs(ph - Yd['P']))
        print(Y, '%-22s hourly MAE %5.1f €  wind capture err %+.2f €  solar %+.2f €' % (lab, mae, score(ph, Yd, 'wind'), score(ph, Yd, 'solar')), flush=True)
