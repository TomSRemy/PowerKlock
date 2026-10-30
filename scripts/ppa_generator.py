#!/usr/bin/env python3
"""The single scenario generator's monthly captures for the pricer (scripts/ppa_scenarios.py), the integrated method
shown as a test since 30 Oct. 2026: chained real weeks from 2019 on (every variable of the same day, France and its
neighbours, the day's fuel-cost deviation), the delivery year's fleets day by day and its batteries, one price rule
in euros (the gas plant's cost × a factor of what is left to produce in the region and in France). No bias correction.
The fuel cost's level cancels in a month's capture (only its day-to-day moves count, and those come with the weather
days), so the last known cost is used for every day; the months' value comes in the pricer from the forward curve.

Replay (scripts/ppa_generator_test.py, deliveries 2020–2025 priced 1–3 years ahead, nothing of the delivery year known):
solar 0.84 €/MWh mean error (bias −0.20), wind 2.57 (+2.53), against 2.47 / 3.21 for the European model and 2.30 /
3.16 for the weather simulation, both without their corrections.

Guardrail alarm: 'belowFloor' = share of simulated days under the capture floor observed at the same penetration
(about 10 % expected). Adds 'generator', 'generatorPaid', 'generatorP10', 'generatorP90' to every month of data/history/ppa_forecast.json
(both conventions). Run after scripts/ppa_lab.py.
    python scripts/ppa_generator.py
"""
import json
import os
import sys
import warnings
from datetime import date

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_scenarios as G            # noqa: E402
sys.argv = _argv
warnings.simplefilter('ignore')

F_PATH = os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')


def main():
    fc = json.load(open(F_PATH))
    settings = fc['settings']
    past = [y for y in L.DATA if L.DATA[y]['complete']]
    A = max(past)
    Fc = G.fuel_cost()
    c0 = float(np.mean([v for k, v in sorted(Fc.items())[-30:]]))
    this = date.today()
    below, anchors = {}, {}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        # anchored on the last complete year: the realised ÷ the generator's own view of that year (ppa_scenarios ANCHOR)
        k = G.anchor_factor(t, A, past, st, lambda d: c0) if G.ANCHOR else {'curt': 1.0, 'all': 1.0}
        anchors[tech] = {'year': A, **{c: round(v, 4) for c, v in k.items()}}
        print('anchor', tech, anchors[tech], flush=True)
        for Y in range(this.year, 2031):
            capY = {c: {tt: L.cap_future(c, tt, Y) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
            m, dist = G.simulate(t, Y, past, st, A, capY, None, n=60, rule='fuel', cost=lambda d: c0,
                                 batteries='both', pool_from=2019, fuel_dev=True, france=True, guard='measure')
            below.setdefault(tech, {})[str(Y)] = round(dist['belowFloor'], 3) if dist.get('belowFloor') is not None else None
            for conv in ('curt', 'all'):
                for mm in range(1, 13):
                    e = fc['forecast'].get(tech, {}).get(conv, {}).get(f'{Y}-{mm:02d}')
                    if e is None or m[mm][conv] != m[mm][conv]:
                        continue
                    e['generator'] = round(m[mm][conv] * k[conv], 5)
                    e['generatorPaid'] = round(m[mm]['paid'], 5)
                    e['generatorP10'], e['generatorP90'] = (round(v * k[conv], 5) for v in dist[mm][conv])
            print('generator', tech, Y, flush=True)
    # guardrail alarm (Tom 30 Oct. 2026): share of the simulated days whose capture falls under the floor observed at the
    # same penetration on the last two complete years (the 10th percentile, so about 10 % is expected); a clear rise
    # says the model is drifting away from what the market has shown. A measure only: nothing is corrected
    fc['generator'] = {'asOf': this.isoformat(), 'lastYear': A, 'fuelCost': round(c0, 2), 'sims': 60, 'belowFloor': below,
                       'belowFloorExpected': 0.10, 'anchor': anchors}
    # model risk (Tom 31 Oct. 2026): the generator's past errors against the realised (scripts/ppa_model_risk.py), so
    # the pricer takes off the forwards × their chosen percentile and the price does not lose money again and again
    try:
        mr = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_model_risk.json')))
        fc['generator']['modelRisk'] = {k: mr[k] for k in ('asOf', 'level') if k in mr}
        for tech in ('solar', 'wind'):
            if tech in mr:
                fc['generator']['modelRisk'][tech] = {k: mr[tech][k] for k in ('n', 'meanPts', 'qPts', 'meanEur', 'maeEur', 'byH')}
    except (OSError, ValueError, KeyError):
        pass
    with open(F_PATH, 'w') as f:
        json.dump(fc, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
