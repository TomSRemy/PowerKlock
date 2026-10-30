"""Value-factor regression in the spirit of Stiewe, Xu, Eicke & Hirth (2025): monthly capture (curt) of French wind/solar
on domestic and neighbouring wind and solar penetration + month effects; replayed 1–3 years ahead."""
import sys, os, warnings, json, numpy as np
sys.path.insert(0, 'scripts'); sys.argv = ['x']; warnings.simplefilter('ignore')
import ppa_lab as L
import ppa_scenarios as G
XO = float(os.environ.get('EXO', '11000'))
NB = ('DE', 'BE', 'ES')
VARS = os.environ.get('EV', 'dw,nw,ds,ns').split(',')
RIDGE = float(os.environ.get('ER', '0.0')); HALF = float(os.environ.get('EH', '0'))   # recency half-life in years (0 = equal)
EX22 = os.environ.get('EX22', '1') == '1'
FIRST = int(os.environ.get('EF', '2016'))

def room_short(y, sS=1.0, sW=1.0, ref=None):
    """per hour: France's surplus beyond its export room (MW): available nuclear + solar + wind − load − (JAO maxFR + XO);
    sS, sW scale solar and wind (a later fleet on year y's weather); ref: JAO level of that year"""
    a = L.DATA[y]
    jm = G.fr_jmax(y) if y >= 2022 else np.full(a['fr_l'].shape, 9000.)
    if ref is not None:
        jm = jm * ref / float(np.mean(jm))
    return G.fr_avail(y) + sS * np.nan_to_num(a['fr_s']) + sW * np.nan_to_num(a['fr_w']) - a['fr_l'] - jm - XO

def month_pen(y):
    a = L.DATA[y]; mo = a['month']; out = {}
    rs = room_short(y)
    for m in range(1, 13):
        k = mo == m
        if not k.any(): continue
        sm = lambda key: float(np.nansum(a[key][k]))
        out[m] = dict(dw=sm('fr_w') / sm('fr_l'), ds=sm('fr_s') / sm('fr_l'),
                      nw=sum(sm(f'{c}_w') for c in NB) / sum(sm(f'{c}_l') for c in NB),
                      ns=sum(sm(f'{c}_s') for c in NB) / sum(sm(f'{c}_l') for c in NB),
                      cut=float((rs[k] > 0).mean()), cutw=float((np.nan_to_num(a['fr_w'][k]) * (rs[k] > 0)).sum() / max(np.nansum(a['fr_w'][k]), 1)))
    return out

PEN = {y: month_pen(y) for y in L.DATA}
ACT = {t: {y: L.actual(t, y) for y in L.DATA} for t in 'sw'}

def cf_month(c, t, y, m):
    a = L.DATA[y]; k = a['month'] == m; key = ('fr_' if c == 'FR' else c + '_') + t
    cap = L.cap(c, t, y) or L.cap_guess(c, t, y, y)
    return float(np.nansum(a[key][k])) / (cap * 1000 * k.sum() * 24) if cap else np.nan

def expected_pen(Y, A, pool):
    """penetrations of delivery year Y as seen after year A: mean monthly capacity factor of the pool × Y's fleet ÷ A's load"""
    out = {}
    for m in range(1, 13):
        d = {}
        for t in 'sw':
            frcf = np.nanmean([cf_month('FR', t, y, m) for y in pool])
            aA = L.DATA[A]; k = aA['month'] == m; hrs = k.sum() * 24
            d['d' + t] = frcf * L.cap_guess('FR', t, Y, A) * 1000 * hrs / float(np.nansum(aA['fr_l'][k]))
            num = sum(np.nanmean([cf_month(c, t, y, m) for y in pool]) * L.cap_guess(c, t, Y, A) * 1000 * hrs for c in NB)
            d['n' + t] = num / sum(float(np.nansum(aA[f'{c}_l'][k])) for c in NB)
        out[m] = d
    # the cut-off indicators: year A's own hours with Y's solar and wind fleets and A's export room
    rs = room_short(A, L.cap_guess('FR', 's', Y, A) / L.cap('FR', 's', A), L.cap_guess('FR', 'w', Y, A) / L.cap('FR', 'w', A))
    aA = L.DATA[A]; sw = L.cap_guess('FR', 'w', Y, A) / L.cap('FR', 'w', A)
    for m in out:
        k = aA['month'] == m
        out[m]['cut'] = float((rs[k] > 0).mean())
        out[m]['cutw'] = float((np.nan_to_num(aA['fr_w'][k]) * (rs[k] > 0)).sum() / max(np.nansum(aA['fr_w'][k]), 1))
    return out

def fit(t, A):
    X, yv, w = [], [], []
    for y in L.DATA:
        if y > A or y < FIRST or not L.DATA[y]['complete'] or (EX22 and y == 2022): continue
        for m, v in ACT[t][y].items():
            if v['curt'] is None or m not in PEN[y]: continue
            X.append([1.0 if mm == m else 0.0 for mm in range(1, 13)] + [PEN[y][m][k] for k in VARS]); yv.append(v['curt'])
            w.append(0.5 ** ((A - y) / HALF) if HALF > 0 else 1.0)
    X, yv, w = np.array(X), np.array(yv), np.array(w)
    W = np.sqrt(w)[:, None]
    R = RIDGE * np.diag([0] * 12 + [1] * len(VARS))
    b = np.linalg.solve((X * W).T @ (X * W) + R, (X * W).T @ (yv * np.sqrt(w)))
    return b

def predict(b, pen):
    return {m: float(b[m - 1] + sum(b[12 + i] * pen[m][k] for i, k in enumerate(VARS))) for m in pen}

if __name__ == '__main__':
    res = {}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        for Y in (2023, 2024, 2025, 2026):
            act = {m: v for m, v in ACT[t][Y].items() if v['days'] >= 28}
            for h in (1, 2, 3):
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]; A = max(known)
                if A < 2022: continue
                pool = [y for y in known if y >= 2019 and y != 2022]
                b = fit(t, A)
                pY = predict(b, expected_pen(Y, A, pool))
                e = L.score(pY, act, 'curt')['eur']
                res.setdefault(tech, []).append(e)
            if Y == 2026: print(tech, 'coef', dict(zip(VARS, np.round(b[12:], 3))))
    for tech, r in res.items():
        print(os.environ.get('LAB', ''), 'RESULT', tech, 'MAE %.2f bias %+.2f' % (np.mean(np.abs(r)), np.mean(r)), ' '.join(f'{x:+.1f}' for x in r))
