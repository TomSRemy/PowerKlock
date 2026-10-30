import sys, os, warnings, json
import numpy as np
sys.argv = ['x']; warnings.simplefilter('ignore')
sys.path.insert(0, '/tmp/mo2')
import genmo2 as GM
L = GM.L
prm = {'nuc_curve': True, 'th_curve': True, 'th_season': True, 'th_markup': os.environ.get('TH') == 'markup', 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': 'jao_k', 'kall': True, 'pool2': True, 'neg_obs': True, 'resp_bid': (-3.0, 3.0)}
cases = [(2024, 1), (2025, 1), (2026, 1), (2025, 2), (2026, 2)]
errs = {'solar': [], 'wind': []}
for Y, h in cases:
    res, A = GM.replay(Y, h, prm, n=int(os.environ.get('N', 4)))
    for t, tt in (('solar', 's'), ('wind', 'w')):
        act = L.actual(tt, Y); ms = [GM.months(D, pf, t) for D, pf in res]
        P = {k: float(np.nanmean([x[k]['curt'] for x in ms])) for k in act}
        errs[t].append(L.score(P, act, 'curt')['eur'])
print('%-14s' % os.environ.get('LAB', ''), ' | '.join('%s %s MAE %.2f' % (t, ' '.join('%+.1f' % e for e in v), np.mean(np.abs(v))) for t, v in errs.items()), flush=True)
