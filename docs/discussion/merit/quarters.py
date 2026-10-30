"""Quarter-by-quarter test of the merit order against the published generator: deliveries 2023–2026 (2026: Jan–Oct),
priced 1 and 2 years ahead, knowing nothing of the delivery year."""
import sys, os, json, warnings
import numpy as np
sys.argv = ['x']; warnings.simplefilter('ignore')
sys.path.insert(0, 'scripts'); sys.path.insert(0, '/tmp/mo2')
import ppa_lab as L, ppa_scenarios as G
import genmo2 as GM
SET = json.load(open('data/history/ppa_forecast.json'))['settings']
prm = {'nuc_curve': True, 'th_curve': True, 'th_season': True, 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': 'jao_k', 'kall': True, 'pool2': True, 'neg_obs': True, 'resp_bid': (-3.0, 3.0)}
F = G.fuel_cost(); Q = {1: (1, 2, 3), 2: (4, 5, 6), 3: (7, 8, 9), 4: (10, 11, 12)}
rows = []
for Y in (2023, 2024, 2025, 2026):
    for h in (1, 2):
        known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]; A = max(known)
        if A < 2022:
            continue
        capY = {c: {tt: L.cap_guess(c, tt, Y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
        lv = {m: float(L.DATA[A]['fr_p'][L.DATA[A]['month'] == m].mean()) for m in range(1, 13)}
        c0 = float(np.mean([v for k, v in F.items() if f'{A}-12-01' <= k <= f'{A}-12-31']))
        res, _ = GM.replay(Y, h, prm, n=int(os.environ.get('N', 4)))
        for t, tt in (('solar', 's'), ('wind', 'w')):
            st = {k: v for k, v in SET[tt].items() if k != 'calError'}
            gm, _ = G.simulate(tt, Y, known, st, A, capY, lv, n=30, rule='fuel', cost=lambda d: c0, batteries='both', pool_from=2019, fuel_dev=True, france=True, seed=7)
            act = L.actual(tt, Y)
            Pg = {m: v['curt'] for m, v in gm.items()}
            ms = [GM.months(D, pf, t) for D, pf in res]
            Pm = {k: float(np.nanmean([x[k]['curt'] for x in ms])) for k in range(1, 13)}
            for q, mq in Q.items():
                if not all(m in act for m in mq):
                    continue
                sg, sm = L.score(Pg, act, 'curt', mq), L.score(Pm, act, 'curt', mq)
                rows.append(dict(tech=t, year=Y, h=h, q=q, known=A, gen=sg['eur'], merit=sm['eur']))
                print(t, Y, 'Q%d' % q, 'h%d' % h, 'known %d' % A, 'generator %+.2f merit %+.2f' % (sg['eur'], sm['eur']), flush=True)
json.dump(rows, open('/tmp/quarters.json', 'w'))
for h in (1, 2):
    for t in ('solar', 'wind'):
        r = [x for x in rows if x['tech'] == t and x['h'] == h]
        wins = sum(abs(x['merit']) < abs(x['gen']) for x in r)
        print('h%d %-5s %2d quarters: MAE generator %.2f, merit %.2f; merit closer in %d of %d' % (h, t, len(r), np.mean([abs(x['gen']) for x in r]), np.mean([abs(x['merit']) for x in r]), wins, len(r)))
