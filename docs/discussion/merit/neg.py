import sys
sys.path.insert(0, '/tmp/mo')
from try1 import *
prm = {'nuc_curve': True, 'th_curve': True, 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': 'month', 'kall': True, 'pool2': True, 'neg_obs': True}
for y in (2023, 2024, 2025):
    prev = [yy for yy in sorted(YS) if yy < y and yy != 2022 and yy >= 2020][-2:]
    pp = M.prev_params(M.merge(YS[prev[0]], YS[prev[1]])); pp['kmin'] = M.kmin_all(YS, y)
    p = dict(prm); p['rF'] = {2025: 0.2}.get(y, 0.0)
    pf, pc = M.run(YS[y], pp, p); P = YS[y]['price']; m = YS[y]['month']; fr = YS[y]['fr']
    print(y, 'hours ≤0 actual %d model %d | ≤0 by month act %s\n      model %s' % ((P <= 0).sum(), (pf <= 0).sum(), [int((P[m == k] <= 0).sum()) for k in range(1, 13)], [int((pf[m == k] <= 0).sum()) for k in range(1, 13)]))
    for t in ('wind', 'solar'):
        v = fr[t]; print('    %s paid share act %.3f model %.3f | mean price when ≤0 act %.1f model %.1f' % (t, v[P > 0].sum() / v.sum(), v[pf > 0].sum() / v.sum(), P[P <= 0].mean(), pf[pf <= 0].mean() if (pf <= 0).any() else 0))
