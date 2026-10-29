#!/usr/bin/env python3
"""Full replay of the single scenario generator (scripts/ppa_scenarios.py: chained real weeks, every variable of the
same day, France and its neighbours, the current 1-D price rule, no price surprise, no bias correction) against the
European model and the weather simulation it would replace; price rule: the gas plant's cost of the day × φ(residual
share) (PriceModelFuel), the fuel cost known when pricing (the last month before, held flat; no forward history for these deliveries) (test bench versions, no bias correction either).
Delivery years 2019–2025 (complete, 2022 left out) priced 1, 2 and 3 years ahead when at least one complete year
from 2019 is known (the fuel prices start then; in practice delivery years 2020 to 2025), output stopped at prices <= 0, error
on the value of one MWh (€/MWh); one method for both technologies, judged on both.

Writes data/history/ppa_generator_test.json
    python scripts/ppa_generator_test.py
"""
import json
import os
import sys
import warnings

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_backtest as B             # noqa: E402
import ppa_backtest_detail as BD     # noqa: E402
import ppa_scenarios as G            # noqa: E402
sys.argv = _argv
warnings.simplefilter('ignore')

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_generator_test.json')
METHODS = ('gen', 'eu', 'wx')


def main():
    settings = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    rows = []
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Y in (2019, 2020, 2021, 2023, 2024, 2025):
            act = L.actual(t, Y)
            for h in (1, 2, 3):
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                if not [y for y in known if y >= 2019]:
                    continue          # the fuel prices start in 2019: no year to learn the rule on
                A = max(known)
                capY = {c: {tt: L.cap_guess(c, tt, Y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = L.levels_for(Y, 'forward') if st['level'] == 'forward' else {m: float(L.DATA[A]['fr_p'][L.DATA[A]['month'] == m].mean()) for m in range(1, 13)}
                F = G.fuel_cost()
                # what was known when pricing (31 Dec. of the last known year): the last month's fuel cost, held flat
                # over the delivery year (no forward history for 2020–2025 deliveries); the realised cost of the
                # delivery year would be a leak
                c0 = float(np.mean([v for k, v in F.items() if f'{A}-12-01' <= k <= f'{A}-12-31']))
                gm, _ = G.simulate(t, Y, known, st, A, capY, lv, n=30, rule='fuel', cost=lambda d: c0, batteries='both', pool_from=2019, fuel_dev=True, france=True)
                pm = L.PriceModel([y for y in known if st['with2022'] or y != 2022][-st['window']:], st['regional'], 'mean', st['level'] != 'none')
                m4, _, _ = L.regional(t, Y, known, pm, A, capY, 0, lv, st['regional'])
                _, wmc, _ = BD.m_weather(t, Y, train, V, 40)
                P = {'gen': {m: v['curt'] for m, v in gm.items() if v['curt'] == v['curt']},
                     'eu': {m: m4[m]['curt'] for m in m4 if m4[m]['curt'] == m4[m]['curt']}, 'wx': wmc['curt']}
                row = {'tech': tech, 'year': Y, 'h': h, 'err': {k: (L.score(P[k], act, 'curt') or {}).get('eur') for k in METHODS}}
                rows.append(row)
                print(tech, Y, h, ' '.join(f"{k} {row['err'][k]:+.2f}" for k in METHODS), flush=True)
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows, 'mae': {}}
    for tech in ('solar', 'wind', 'both'):
        rs = [r for r in rows if tech == 'both' or r['tech'] == tech]
        out['mae'][tech] = {k: {'mae': round(float(np.mean([abs(r['err'][k]) for r in rs])), 2), 'bias': round(float(np.mean([r['err'][k] for r in rs])), 2)} for k in METHODS}
        print(tech, out['mae'][tech])
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
