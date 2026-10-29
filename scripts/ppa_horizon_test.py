#!/usr/bin/env python3
"""Walk-forward at the benchmark's horizon: each delivery year Y priced 1, 2 and 3 years ahead.

The test bench (ppa_lab.py) prices Y with the years before Y: one year ahead. The published
benchmark covers the next three calendar years (Cal Y+1 … Y+3), so a method that holds one year
ahead may not hold three. Here Y is priced with the complete years up to Y − h only (2022 left out
as in the pricer), the fleet of Y extrapolated from the last two known years, and scored like the
test bench: production-weighted error on the value of one MWh (€/MWh), both contract conventions.

Methods: step (capacity trend), fpc (forward shape), weather (simulated weather), regional
(European price model, the live settings in ppa_forecast.json), and their equal-weight average
(the 4-method blend the brief's decision n° 1 asks to publish), plus the 3-method average without
the European model.

Result (mean absolute error on 2024-2026, €/MWh, curtailed | all hours; 3 years, 2026 to date — a
small sample): solar 1 / 2 / 3 years ahead — capacity trend 0.99|2.95, 2.10|4.84, 4.69|11.13;
European model 2.35|7.78, 3.21|4.62, 2.93|2.16; average of 3 without it 0.85|3.19, 1.99|5.62,
4.37|12.38; average of 4 with it 0.31|2.99, 1.65|3.84, 4.01|9.59. The trend methods degrade with the
horizon, the European model holds (it reprices with the new fleet); the 4-method average beats the
3-method one at every horizon for solar, and the capacity trend alone (the benchmark published today)
at 1 and 2 years. Wind: the 4-method average is within 0.4 €/MWh of the best single method throughout.

Writes data/history/ppa_horizon_test.json
    python scripts/ppa_horizon_test.py
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_backtest as B             # noqa: E402
import ppa_backtest_detail as BD     # noqa: E402
sys.argv = _argv

H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'ppa_horizon_test.json')
TARGETS = [2021, 2023, 2024, 2025, 2026]
HORIZONS = (1, 2, 3)
METHODS = ('step', 'fpc', 'weather', 'regional')


def main():
    settings = json.load(open(os.path.join(H, 'ppa_forecast.json')))['settings']
    out = {'rows': []}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Y in TARGETS:
            if Y not in L.DATA:
                continue
            act = L.actual(t, Y)
            for h in HORIZONS:
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                last = max(known)
                tr = [y for y in known if st['with2022'] or y != 2022][-st['window']:]
                pm = L.PriceModel(tr, st['regional'], 'mean', st['level'] != 'none')
                capY = {c: {tt: L.cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = L.levels_for(Y, 'forward') if st['level'] == 'forward' else ({m: float(L.DATA[last]['fr_p'][L.DATA[last]['month'] == m].mean()) for m in range(1, 13)} if st['level'] == 'lastyear' else None)
                m4, _, _ = L.regional(t, Y, known, pm, last, capY, 0, lv, st['regional'])
                _, wmc, _ = BD.m_weather(t, Y, train, V, 40)
                row = {'tech': tech, 'year': Y, 'h': h, 'lastKnown': last}
                for conv in ('curt', 'all'):
                    _, fm, _ = BD.m_fpc(t, Y, train, V, conv)
                    stp = BD.m_step(t, Y, train, V, conv)
                    P = {'step': {m: stp for m in range(1, 13)}, 'fpc': fm, 'weather': wmc[conv],
                         'regional': {m: m4[m][conv] for m in m4 if m4[m][conv] == m4[m][conv]}}
                    ks = [m for m in range(1, 13) if all(P[k].get(m) is not None for k in METHODS)]
                    P['avg4'] = {m: float(np.mean([P[k][m] for k in METHODS])) for m in ks}
                    P['avg3'] = {m: float(np.mean([P[k][m] for k in ('step', 'fpc', 'weather')])) for m in ks}
                    row[conv] = {k: (L.score(v, act, conv) or {}).get('eur') for k, v in P.items()}
                out['rows'].append(row)
                print(tech, Y, f'h={h}', 'curt', ' '.join(f"{k} {v:+.2f}" for k, v in row['curt'].items() if v is not None), flush=True)
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            for h in HORIZONS:
                rs = [r for r in out['rows'] if r['tech'] == tech and r['h'] == h and r['year'] >= 2024]
                out['mae'][f'{tech} {conv} h={h}'] = {k: round(float(np.mean([abs(r[conv][k]) for r in rs if r[conv].get(k) is not None])), 2)
                                                     for k in METHODS + ('avg4', 'avg3')}
    for k, v in out['mae'].items():
        print('%-18s 2024-2026 MAE  ' % k + ' '.join(f'{m} {e:.2f}' for m, e in v.items()))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
