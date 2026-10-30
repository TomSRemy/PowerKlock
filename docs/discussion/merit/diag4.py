import sys
sys.path.insert(0, '/tmp/mo')
from try1 import *
prm = {'rR': 0.9, 'ps_use': 0.1, 'eff': False, 'nuc_curve': True}
y = 2025; Yd = YS[y]; pp = M.prev_params(YS[2024]); p = dict(prm); p['rF'] = 0.2
pf, pc = M.run(Yd, pp, p); DE = Yd['de']; rs = Yd['rest']; ok = np.isfinite(DE)
res = (rs['load'] - rs['ext'] - rs['solar'] - rs['wind'] - rs['mr'] - rs['nuclear']) / 1000
cst = M.costs(Yd['days']); cc = np.repeat(((cst['ttf'] + 0.202 * cst['eua']) / 0.54 + 3)[:, None], 24, 1)
print('CCGT cost mean', cc.mean().round(1))
for lo in range(-30, 80, 10):
    s = ok & (res >= lo) & (res < lo + 10)
    if s.sum() > 50:
        th = (rs['gas'] + rs['coal'] + rs['lignite'])[s].mean() / 1000
        print('CWE residual %3d..%3d GW: hours %4d  DE actual %6.1f  model %6.1f   actual thermal %5.1f GW  lake %4.1f' % (lo, lo + 10, s.sum(), DE[s].mean(), pc[s].mean(), th, rs['lake'][s].mean() / 1000))
print('capacities GW gas/coal/lig', [round(sum(M.capacity(c, t, y) for c in M.REST), 1) for t in ('Fossil gas', 'Fossil hard coal', 'Fossil brown coal / lignite')])
print('must-run (prev p5 by month, GW) gas', (pp['r_gas'] / 1000).round(1), 'coal', (pp['r_coal'] / 1000).round(1), 'lig', (pp['r_lig'] / 1000).round(1))
