import sys, itertools
sys.path.insert(0, '/tmp/mo')
from try1 import *
base = {'nuc_curve': True, 'th_curve': True, 'ps_use': 0.1}
grid = dict(rR=(0.6, 0.9), eff=(False, True, 'month', 'msol'))
best = []
for vals in itertools.product(*grid.values()):
    prm = dict(base, **dict(zip(grid, vals))); r = go(prm, (2021, 2023))
    best.append((np.mean([r[y]['mae'] for y in r]), prm)); print('%.2f' % best[-1][0], prm, flush=True)
best.sort(key=lambda t: t[0])
print('== best on calibration:', best[0][1]); go(best[0][1], (2021, 2023, 2024, 2025), True)
for e in ('month', 'msol'):
    print('== eff', e); go(dict(base, rR=0.9, eff=e), (2024, 2025), True)
