import sys
sys.path.insert(0, '/tmp/mo')
from try1 import *
prm = {'nuc_curve': True, 'th_curve': True, 'th_season': True, 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': 'month', 'kall': True, 'pool2': True, 'neg_obs': True}
for y, t in ((2023, 'wind'), (2024, 'solar')):
    prev = [yy for yy in sorted(YS) if yy < y and yy != 2022 and yy >= 2020][-2:]
    pp = M.prev_params(M.merge(YS[prev[0]], YS[prev[1]])); pp['kmin'] = M.kmin_all(YS, y); p = dict(prm); p['rF'] = 0.0
    pf, _ = M.run(YS[y], pp, p); P = YS[y]['price']; m = YS[y]['month']; v = YS[y]['fr'][t]
    tw = sum(v[(m == k)[:, None] & (P > 0)].sum() for k in range(1, 13)); row = []
    for k in range(1, 13):
        s = m == k; base = P[s].mean(); bh = pf[s].mean(); vs, Ps, ps = v[s], P[s], pf[s]
        cua = (vs[Ps > 0] * Ps[Ps > 0]).sum() / vs[Ps > 0].sum() / base; cuh = (vs[ps > 0] * ps[ps > 0]).sum() / vs[ps > 0].sum() / bh
        row.append('%d:%.2f/%.2f(%+.1f) base %d/%d' % (k, cua, cuh, (cuh - cua) * base * vs[Ps > 0].sum() / tw, base, bh))
    print(y, t, 'curt capture actual/model (€):\n  ' + '\n  '.join(row))
