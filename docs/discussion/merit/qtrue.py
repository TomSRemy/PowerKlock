import sys, os, warnings
import numpy as np
sys.argv = ['x']; warnings.simplefilter('ignore')
sys.path.insert(0, '/tmp/mo2'); sys.path.insert(0, 'scripts')
import genmo2 as GM
import ppa_lab as L
M = GM.M; YS = GM.YS
prm = {'mr_tod': os.environ.get('MRTOD') == '1', 'th_tod': os.environ.get('TOD') == '1', 'nuc_curve': True, 'th_curve': True, 'th_season': True, 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': 'jao_k', 'kall': True, 'pool2': True, 'neg_obs': True, 'resp_bid': (-3.0, 3.0)}
Q = {1: (1, 2, 3), 2: (4, 5, 6), 3: (7, 8, 9), 4: (10, 11, 12)}
err = {'solar': [], 'wind': []}
for y in (2023, 2024, 2025, 2026):
    prev = [yy for yy in GM.COMPLETE if yy < y and yy != 2022][-2:]
    pp = M.prev_params(M.merge(YS[prev[0]], YS[prev[1]])); pp['kmin'] = M.kmin_all(YS, y)
    p = dict(prm); p['rF'] = 0.2 if y >= 2025 else 0.0
    pf, _ = M.run(YS[y], pp, p); Yd = YS[y]; m = Yd['month']
    for t, tt in (('solar', 's'), ('wind', 'w')):
        v = Yd['fr'][t]; act = L.actual(tt, y); P = {}
        for k in range(1, 13):
            s = m == k
            if not s.any(): continue
            pos = pf[s] > 0
            P[k] = (v[s][pos] * pf[s][pos]).sum() / max(v[s][pos].sum(), 1) / pf[s].mean()
        for q, mq in Q.items():
            if all(k in act and k in P for k in mq):
                err[t].append(L.score(P, act, 'curt', mq)['eur'])
print('%-10s' % os.environ.get('LAB', ''), ' | '.join('%s MAE %.2f (n %d)' % (t, np.mean(np.abs(v)), len(v)) for t, v in err.items()))
