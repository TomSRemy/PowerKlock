import sys
sys.path.insert(0, '/tmp/mo')
from try1 import *
prm = {'rR': 0.9, 'b_lo': 0.2, 'b_hi': 1.0, 'ps_use': 0.1}
for y in (2023, 2025):
    Yd = YS[y]; pp = M.prev_params(YS[y - 1] if y - 1 != 2022 else YS[2021]); p = dict(prm); p['rF'] = {2025: 0.2}.get(y, 0.0)
    pf, pc = M.run(Yd, pp, p); P = Yd['price']; DE = Yd['de']
    ok = np.isfinite(DE)
    print(y, 'DE actual pct', np.percentile(DE[ok], [5, 25, 50, 75, 95]).round(), 'CWE model', np.percentile(pc[ok], [5, 25, 50, 75, 95]).round(), 'neg DE %d model %d' % ((DE[ok] <= 0).sum(), (pc[ok] <= 0).sum()))
    print('   FR actual', np.percentile(P, [5, 25, 50, 75, 95]).round(), 'FR model', np.percentile(pf, [5, 25, 50, 75, 95]).round())
    m = Yd['month']
    for mm in (1, 5, 7, 11):
        s = m == mm
        print('   month %2d DE by hour act ' % mm, np.nanmean(DE[s], 0)[::3].round(), '\n            model     ', pc[s].mean(0)[::3].round(), '\n            FR act    ', P[s].mean(0)[::3].round(), '\n            FR model  ', pf[s].mean(0)[::3].round())
