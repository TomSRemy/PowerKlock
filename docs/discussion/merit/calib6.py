import sys, itertools
sys.path.insert(0, '/tmp/mo')
from try1 import *
base = {'nuc_curve': True, 'th_curve': True, 'rR': 0.9, 'eff': 'month', 'kall': True, 'pool2': True, 'neg_obs': True}
grid = dict(ps_use=(0.1, 0.3), ps_fr=(0.1, 0.4, 0.7, 1.0))
best = []
for vals in itertools.product(*grid.values()):
    prm = dict(base, **dict(zip(grid, vals))); r = go(prm, (2021, 2023))
    best.append((np.mean([r[y]['mae'] for y in r]), prm)); print('%.2f' % best[-1][0], dict(zip(grid, vals)), flush=True)
best.sort(key=lambda t: t[0])
print('== best', best[0][1]); go(best[0][1], (2021, 2023, 2024, 2025), True)
