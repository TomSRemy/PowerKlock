import sys, os
sys.argv = ['x']
sys.path.insert(0, '/tmp/mo2')
import genmo2 as GM
M = GM.M; L = GM.L; YS = GM.YS
prm = {'nuc_curve': True, 'th_curve': True, 'th_season': True, 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': 'jao_k', 'kall': True, 'pool2': True, 'neg_obs': True, 'resp_bid': (-3.0, 3.0)}
Y = 2025
src = [(Y, r) for r in range(len(YS[Y]['days']))]
GM.draw = lambda *a, **k: src
if Y not in GM.COMPLETE: GM.COMPLETE.append(Y)
res, _ = GM.replay(Y, 1, prm, n=1)
D, pf = res[0]
out = []
for t, tt in (('solar', 's'), ('wind', 'w')):
    P = {k: v['curt'] for k, v in GM.months(D, pf, t).items()}
    out.append('%s %+.2f' % (t, L.score(P, L.actual(tt, Y), 'curt')['eur']))
print(os.environ.get('LAB'), ' '.join(out))
