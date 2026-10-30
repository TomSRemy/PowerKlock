import sys
sys.path.insert(0, '/tmp/mo')
from try1 import *
prm = {'nuc_curve': True, 'th_curve': True, 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': 'month', 'kall': True, 'pool2': True, 'neg_obs': True}
for y in (2023, 2024, 2025):
    prev = [yy for yy in sorted(YS) if yy < y and yy != 2022 and yy >= 2020][-2:]
    pp = M.prev_params(M.merge(YS[prev[0]], YS[prev[1]])); pp['kmin'] = M.kmin_all(YS, y); p = dict(prm); p['rF'] = {2025: 0.2}.get(y, 0.0)
    pf, _ = M.run(YS[y], pp, p); P = YS[y]['price']; m = YS[y]['month']; v = YS[y]['fr']['wind']; tot = v.sum()
    row = []
    for k in range(1, 13):
        s = m == k; base = P[s].mean(); bh = pf[s].mean()
        ca = (v[s] * P[s]).sum() / v[s].sum() / base; cp = (v[s] * pf[s]).sum() / v[s].sum() / bh
        row.append('%d:%.2f/%.2f(%+.1f)' % (k, ca, cp, (cp - ca) * base * v[s].sum() / tot))
    print(y, 'wind capture all, actual/model (€ contribution):', ' '.join(row))
    print('     monthly mean price act', [round(float(P[m == k].mean())) for k in range(1, 13)], '\n     model                 ', [round(float(pf[m == k].mean())) for k in range(1, 13)])
