import sys, warnings
import os
import numpy as np
sys.argv = ['x']; warnings.simplefilter('ignore')
sys.path.insert(0, '/tmp/mo2')
import genmo2 as GM
M = GM.M; YS = GM.YS
prm = {'mr_tod': os.environ.get('MRTOD') == '1', 'th_tod': os.environ.get('TOD') == '1', 'commit': int(os.environ.get('COMMIT', 0)), 'commit_mode': os.environ.get('CMODE'), 'th_mr': os.environ.get('TH_MR') == '1', 'nuc_curve': True, 'th_curve': True, 'th_season': True, 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': 'jao_k', 'kall': True, 'pool2': True, 'neg_obs': True, 'resp_bid': (-3.0, 3.0)}
for y in (2024, 2025):
    prev = [yy for yy in GM.COMPLETE if yy < y and yy != 2022][-2:]
    pp = M.prev_params(M.merge(YS[prev[0]], YS[prev[1]])); pp['kmin'] = M.kmin_all(YS, y)
    p = dict(prm); p['rF'] = 0.2 if y >= 2025 else 0.0
    pf, pc = M.run(YS[y], pp, p); P = YS[y]['price']; DE = YS[y]['de']; m = YS[y]['month']
    mid = slice(11, 16); night = slice(0, 6)
    print(y, 'month: midday act/model | night act/model | midday ÷ day mean act/model | DE midday act / CWE model')
    for k in range(1, 13):
        s = m == k
        a_md, m_md = P[s][:, mid].mean(), pf[s][:, mid].mean(); a_n, m_n = P[s][:, night].mean(), pf[s][:, night].mean()
        print('  %2d  %6.1f/%6.1f | %6.1f/%6.1f | %.2f/%.2f | %6.1f/%6.1f' % (k, a_md, m_md, a_n, m_n, a_md / P[s].mean(), m_md / pf[s].mean(), np.nanmean(DE[s][:, mid]), pc[s][:, mid].mean()))
