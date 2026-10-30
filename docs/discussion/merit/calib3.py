import sys, itertools
sys.path.insert(0, '/tmp/mo')
from try1 import *
pp = M.prev_params(YS[2024]); print('curve 2024 → 2025:', list(zip(pp['nc_u'].round(2), pp['nc_r'].round(2)))[5::3], 'xeff', round(pp['xeff']), 'ieff', round(pp['ieff']))
grid = dict(rR=(0.6, 0.9), ps_use=(0.1, 0.3), eff=(True, False), nuc_curve=(True,))
best = []
for vals in itertools.product(*grid.values()):
    prm = dict(zip(grid, vals)); r = go(prm, (2021, 2023))
    best.append((np.mean([r[y]['mae'] for y in r]), prm))
best.sort(key=lambda t: t[0])
for o, p in best[:4]: print('%.2f' % o, p)
go(best[0][1], (2021, 2023, 2024, 2025), True)
