import sys, os, json, warnings
import numpy as np
sys.argv = ['x']; warnings.simplefilter('ignore')
sys.path.insert(0, 'scripts'); sys.path.insert(0, '/tmp/mo2')
import ppa_lab as L, ppa_scenarios as G
import genmo2 as GM
SET = json.load(open('data/history/ppa_forecast.json'))['settings']
prm = {'nuc_curve': True, 'th_curve': True, 'th_season': True, 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': 'jao_k', 'kall': True, 'pool2': True, 'neg_obs': True, 'resp_bid': (-3.0, 3.0)}
F = G.fuel_cost()
Y = 2026
for h in (1, 2):
    known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]; A = max(known)
    capY = {c: {tt: L.cap_guess(c, tt, Y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
    lv = {m: float(L.DATA[A]['fr_p'][L.DATA[A]['month'] == m].mean()) for m in range(1, 13)}
    c0 = float(np.mean([v for k, v in F.items() if f'{A}-12-01' <= k <= f'{A}-12-31']))
    res, _ = GM.replay(Y, h, prm, n=int(os.environ.get('N', 6)))
    for t, tt in (('solar', 's'), ('wind', 'w')):
        st = {k: v for k, v in SET[tt].items() if k != 'calError'}
        gm, _ = G.simulate(tt, Y, known, st, A, capY, lv, n=30, rule='fuel', cost=lambda d: c0, batteries='both', pool_from=2019, fuel_dev=True, france=True, seed=7)
        act = L.actual(tt, Y)
        Pg = {m: v['curt'] for m, v in gm.items() if m in act}
        ms = [GM.months(D, pf, t) for D, pf in res]
        Pm = {k: float(np.nanmean([x[k]['curt'] for x in ms])) for k in act}
        sg, sm = L.score(Pg, act, 'curt')['eur'], L.score(Pm, act, 'curt')['eur']
        # month by month (€ contribution)
        tot = sum(act[m]['mwh'] * act[m]['paid'] for m in act)
        cg = ' '.join('%d:%+.1f/%+.1f' % (m, (Pg[m] - act[m]['curt']) * act[m]['base'] * act[m]['mwh'] * act[m]['paid'] / tot * len(act), (Pm[m] - act[m]['curt']) * act[m]['base'] * act[m]['mwh'] * act[m]['paid'] / tot * len(act)) for m in sorted(act))
        print('2026 Jan–Oct, priced %d year(s) ahead (known up to %d), %s: generator %+.2f | merit order %+.2f €/MWh' % (h, A, t, sg, sm), flush=True)
        print('    by month generator/merit (€, ×10 months scale):', cg, flush=True)
