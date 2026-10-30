import sys
sys.path.insert(0, '/tmp/mo')
from try1 import *
prm = dict(rR=0.5, b_lo=0.0, b_hi=0.8, ps_use=0.7)
for y in (2021, 2024, 2025):
    Yd = YS[y]; pp = M.prev_params(YS[y - 1] if y - 1 != 2022 else YS[2021]); p = dict(prm); p['rF'] = {2025: 0.2}.get(y, 0.0)
    pf, pc = M.run(Yd, pp, p); P = Yd['price']; fr = Yd['fr']
    xf = (fr['load'] - fr['solar'] - fr['wind'] - fr['nuclear']) / fr['load']
    win = np.isin(Yd['month'], (1, 2, 3, 10, 11, 12))[:, None] * np.ones((1, 24), bool)
    print(y, 'pp', {k: (round(v) if np.isscalar(v) else None) for k, v in pp.items()}, 'neg actual %d model %d' % ((P <= 0).sum(), (pf <= 0).sum()))
    for lab, se in (('winter', win), ('summer', ~win)):
        row = []
        for lo, hi in ((-1, 0), (0, .1), (.1, .2), (.2, .3), (.3, 1)):
            s = se & (xf >= lo) & (xf < hi)
            if s.sum() > 30: row.append('%4.1f:%5.0f/%5.0f' % (lo, P[s].mean(), pf[s].mean()))
        print('  ', lab, ' | '.join(row))
    q = [5, 25, 50, 75, 95]
    print('   pct actual', np.percentile(P, q).round(), 'model', np.percentile(pf, q).round(), 'coupled', np.percentile(pc, q).round())
