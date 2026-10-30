import sys, itertools
sys.path.insert(0, '/tmp/mo')
from try1 import *
grid = dict(rR=(0.6, 0.9), b_lo=(-10.0, 0.0, 10.0), b_hi=(20.0, 40.0, 60.0), ps_use=(0.1, 0.3), nuc_eur=(True,), eff=(True,))
best = []
for vals in itertools.product(*grid.values()):
    prm = dict(zip(grid, vals))
    r = go(prm, (2021, 2023))
    best.append((np.mean([r[y]['mae'] for y in r]), prm))
best.sort(key=lambda t: t[0])
for o, p in best[:4]: print('%.2f' % o, p)
print('== walk-forward test, parameters from 2021 + 2023 hourly fit only')
go(best[0][1], (2021, 2023, 2024, 2025), True)
