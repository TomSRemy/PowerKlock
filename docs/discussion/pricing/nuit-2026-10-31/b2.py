"""One model version (flags from the environment), every anchoring variant, deliveries 2023–2026, 1–3 years ahead."""
import json, os, sys, warnings
import numpy as np
sys.path.insert(0, 'scripts'); sys.argv = ['x']; warnings.simplefilter('ignore')
import ppa_lab as L, ppa_scenarios as G
exec(open(os.environ["PATCH"]).read()) if os.environ.get("PATCH") else None
SET = json.load(open('data/history/ppa_forecast.json'))['settings']; F = G.fuel_cost()
lab = os.environ.get('LAB', '')
W_, S_ = (1, 2, 3, 10, 11, 12), (4, 5, 6, 7, 8, 9)
def sim(t, Y, known, st, A, cap, cost, **kw):
    return G.simulate(t, Y, known, st, A, cap, None, rule='fuel', cost=cost, batteries='both', france=True, seed=7, **{**dict(n=30, pool_from=int(os.environ.get('POOL', 2019)), fuel_dev=True), **kw})[0]
res = {}
for t, tech in (('s', 'solar'), ('w', 'wind')):
    st = {k: v for k, v in SET[t].items() if k != 'calError'}
    for Y in (2023, 2024, 2025, 2026):
        act = {m: v for m, v in L.actual(t, Y).items() if v['days'] >= 28}
        for h in (1, 2, 3):
            known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]; A = max(known)
            if A < 2022: continue
            cc = float(np.mean([v for kk, v in F.items() if f'{A}-12-01' <= kk <= f'{A}-12-31'])); cost = lambda d: cc
            capY = {c: {tt: L.cap_guess(c, tt, Y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
            capA = {c: {tt: (L.cap(c, tt, A) or L.cap_guess(c, tt, A, A)) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
            NS = int(os.environ.get('NSIM', 30)); WK = int(os.environ.get('WEEKS', 7)); WN = int(os.environ.get('WIN', 7)); FW = int(os.environ.get('FWIN', 2))
            gY = sim(t, Y, known, st, A, capY, cost, n=NS, weeks=WK, window=WN, fuel_window=FW)
            gA = sim(t, A, known, st, A, capA, cost, n=NS, weeks=WK, window=WN, fuel_window=FW)   # drawn weather
            gT = sim(t, A, known, st, A, capA, lambda d: F.get(d.isoformat(), cc), n=1, pool_from=A, window=0, fuel_dev=False, fuel_window=FW)   # its own weather
            aA = L.actual(t, A)
            def k_over(g, ms):
                w = {m: aA[m]['mwh'] * aA[m]['paid'] for m in ms if m in aA and m in g and g[m]['curt'] == g[m]['curt']}
                return sum(w[m] * aA[m]['curt'] for m in w) / sum(w[m] * g[m]['curt'] for m in w)
            V = {'none': {m: 1.0 for m in range(1, 13)},
                 'year': {m: k_over(gA, range(1, 13)) for m in range(1, 13)},
                 'winter/summer': {m: k_over(gA, W_ if m in W_ else S_) for m in range(1, 13)},
                 'year, true weather': {m: k_over(gT, range(1, 13)) for m in range(1, 13)},
                 'winter/summer, true weather': {m: k_over(gT, W_ if m in W_ else S_) for m in range(1, 13)},
                 'month, true weather': {m: k_over(gT, [m]) for m in range(1, 13)},
                 'quarter, true weather': {m: k_over(gT, [3 * ((m - 1) // 3) + i for i in (1, 2, 3)]) for m in range(1, 13)},
                 'year, half': {m: 1 + 0.5 * (k_over(gA, range(1, 13)) - 1) for m in range(1, 13)}}
            for v, k in V.items():
                e = L.score({m: gY[m]['curt'] * k[m] for m in gY}, act, 'curt')['eur']
                res.setdefault((tech, v), []).append(e)
            print(lab, tech, Y, 'h%d' % h, 'k year drawn %.3f true %.3f' % (V['year'][1], V['year, true weather'][1]), flush=True)
for (tech, v), r in sorted(res.items()):
    print(lab, 'RESULT %-5s %-28s MAE %.2f bias %+.2f' % (tech, v, np.mean(np.abs(r)), np.mean(r)), flush=True)
json.dump({f'{a}|{b}': r for (a, b), r in res.items()}, open(f'/tmp/battery_{lab}.json', 'w'))
