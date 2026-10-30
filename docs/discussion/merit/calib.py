import sys, itertools
sys.path.insert(0, '/tmp/mo')
from try1 import *
grid = dict(rR=(0.3, 0.6, 0.9), b_lo=(-0.1, 0.0, 0.2), b_hi=(0.5, 0.8, 1.0), ps_use=(0.1, 0.3, 0.6))
best = []
for vals in itertools.product(*grid.values()):
    prm = dict(zip(grid, vals))
    r = go(prm, (2021, 2023))
    obj = np.mean([r[y]['mae'] for y in r])
    best.append((obj, prm))
best.sort(key=lambda t: t[0])
for o, p in best[:5]: print('%.2f' % o, p)
prm = best[0][1]
print('== test with best (calibrated on 2021, 2023 hourly MAE only)')
go(prm, (2021, 2023, 2024, 2025), True)
