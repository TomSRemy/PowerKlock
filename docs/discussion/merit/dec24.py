import sys
sys.path.insert(0, '/tmp/mo')
from try1 import *
prm = {'nuc_curve': True, 'th_curve': True, 'th_season': True, 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': 'month', 'kall': True, 'pool2': True, 'neg_obs': True, 'resp_bid': (-3.0, 3.0), 'rF': 0.0}
y = 2024; pp = M.prev_params(M.merge(YS[2021], YS[2023])); pp['kmin'] = M.kmin_all(YS, y)
pf, pc = M.run(YS[y], pp, prm); P = YS[y]['price']; DE = YS[y]['de']; fr = YS[y]['fr']; rs = YS[y]['rest']; m = YS[y]['month']
s = (m == 12)[:, None] * np.ones((1, 24), bool)
w = fr['wind'][s]; q = np.percentile(w, [33, 66])
for lab, k in (('calm', w < q[0]), ('mid', (w >= q[0]) & (w < q[1])), ('windy', w >= q[1])):
    print('Dec 2024 %-5s FR wind %5.0f | FR act %6.1f model %6.1f | DE act %6.1f CWE model %6.1f | CWE wind %5.0f | FR export to CWE act %5.0f | nuc/avail act %.2f' % (
        lab, w[k].mean(), P[s][k].mean(), pf[s][k].mean(), np.nanmean(DE[s][k]), pc[s][k].mean(), rs['wind'][s][k].mean(), -fr['link'][s][k].mean(), (fr['nuclear'][s] / fr['avail'][s])[k].mean()))
print('room Dec', pp['xm'][11], 'kmin Dec', pp['kmin'][11])
