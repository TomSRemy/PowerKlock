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

# v2 (branch claude/ppa-v2, 1 Nov. 2026): the central capture of each technology from its most accurate set-up on the
# replay, and the risk band from the full Monte Carlo (analogue weeks drawn "dear or cheap", each scenario's fleet growth,
# nuclear with a rare 2022-like year, Core export limit, load, dry or wet year), whose P75 held in 78–89 % of the
# replayed deliveries (target 75 %). Wind: the rule learnt output-weighted + the cut-off cells on French wind share,
# anchored winter/summer (replay 0.56 €/MWh vs 0.84); solar unchanged (0.76, no anchoring)
BEST = {'wind': {'env': {'PK_WTECH': '1'}, 'glob': {'DEC2': 'wind'}, 'anchor': 'season'},
        'solar': {'env': {}, 'glob': {}, 'anchor': None}}
BAND = {'env': {'PK_KNN_EX22': '1'}, 'glob': {'KNN': 500, 'KNN_DRAW': 'week', 'MC_FULL': True, 'MC_DRY': 0.1, 'MC_DRY_FREE': 0.5},
        'w_': [1, 1, 1, 2, 1, 0.7, 0.7]}


class _cfg:
    """set a test set-up of scripts/ppa_scenarios.py for the duration of a block, then put everything back"""
    def __init__(self, c):
        self.c = c

    def __enter__(self):
        self.env = {k: os.environ.get(k) for k in self.c.get('env', {})}
        self.glob = {k: getattr(G, k) for k in self.c.get('glob', {})}
        os.environ.update(self.c.get('env', {}))
        for k, v in self.c.get('glob', {}).items():
            setattr(G, k, v)
        if 'w_' in self.c:
            self.w = G.KNNRule.W_; G.KNNRule.W_ = np.array(self.c['w_'], float)
        return self

    def __exit__(self, *a):
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        for k, v in self.glob.items():
            setattr(G, k, v)
        if 'w_' in self.c:
            G.KNNRule.W_ = self.w


V2 = os.environ.get('PK_PPA_V2', '1') == '1'


def main():
    fc = json.load(open(F_PATH))
    settings = fc['settings']
    past = [y for y in L.DATA if L.DATA[y]['complete']]
    A = max(past)
    Fc = G.fuel_cost()
    c0 = float(np.mean([v for k, v in sorted(Fc.items())[-30:]]))
    this = date.today()
    below, anchors, band = {}, {}, {}
    # the anchoring of each technology, chosen on the weekly replay (scripts/ppa_model_risk.py, run just before)
    try:
        modes = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_model_risk.json'))).get('anchorMode') or {}
    except (OSError, ValueError):
        modes = {}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        # anchored on the last complete year: the realised ÷ the generator's own view of that year (ppa_scenarios ANCHOR),
        # over the year, by half-year or not at all, whichever the replay found best for this technology
        mode = modes.get(tech, 'year') if G.ANCHOR else 'none'
        if V2:
            mode = BEST[tech]['anchor'] or 'none'
        with _cfg(BEST[tech] if V2 else {}):
            k = G.anchor_factors(t, A, past, st, lambda d: c0)[mode]
        anchors[tech] = {'year': A, 'mode': mode, **{c: {'winter': round(k[c][1], 4), 'summer': round(k[c][7], 4)} for c in k}}
        print('anchor', tech, anchors[tech], flush=True)
        for Y in range(this.year, 2031):
            capY = {c: {tt: L.cap_future(c, tt, Y) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
            with _cfg(BEST[tech] if V2 else {}):
                m, dist = G.simulate(t, Y, past, st, A, capY, None, n=60, rule='fuel', cost=lambda d: c0,
                                     batteries='both', pool_from=2019, fuel_dev=True, france=True, guard='measure')
            if V2:
                with _cfg(BAND):
                    mb, db = G.simulate(t, Y, past, st, A, capY, None, n=60, rule='fuel', cost=lambda d: c0,
                                        batteries='both', pool_from=2019, fuel_dev=True, france=True, seed=7)
                # the year's capture in each scenario, weighted by the last complete year's monthly output
                wm = {mm: float(L.DATA[A]['fr_' + t][L.DATA[A]['month'] == mm].sum()) for mm in range(1, 13)}
                ann = lambda r_: sum(wm[x] * r_[x]['curt'] for x in range(1, 13)) / sum(wm.values())
                sc = [ann(r_) for r_ in db['scenarios'] if all(r_.get(x, {}).get('curt') is not None for x in range(1, 13))]
                if sc:
                    q = {f'p{p_}': round(float(np.percentile(sc, p_)), 5) for p_ in (10, 25, 50, 75, 90)}
                    band.setdefault(tech, {})[str(Y)] = q
                bandm = {mm: db[mm]['curt'] for mm in range(1, 13) if mm in db}
            below.setdefault(tech, {})[str(Y)] = round(dist['belowFloor'], 3) if dist.get('belowFloor') is not None else None
            for conv in ('curt', 'all'):
                for mm in range(1, 13):
                    e = fc['forecast'].get(tech, {}).get(conv, {}).get(f'{Y}-{mm:02d}')
                    if e is None or m[mm][conv] != m[mm][conv]:
                        continue
                    e['generator'] = round(m[mm][conv] * k[conv][mm], 5)
                    e['generatorPaid'] = round(m[mm]['paid'], 5)
                    e['generatorP10'], e['generatorP90'] = (round(v * k[conv][mm], 5) for v in dist[mm][conv])
                    if V2 and conv == 'curt' and mm in bandm and mb.get(mm, {}).get('curt') is not None:
                        # the monthly band of the full Monte Carlo, placed around the central capture
                        c_ = e['generator'] - mb[mm]['curt']
                        e['generatorP10'], e['generatorP90'] = round(bandm[mm][0] + c_, 5), round(bandm[mm][1] + c_, 5)
            print('generator', tech, Y, flush=True)
    # guardrail alarm (Tom 30 Oct. 2026): share of the simulated days whose capture falls under the floor observed at the
    # same penetration on the last two complete years (the 10th percentile, so about 10 % is expected); a clear rise
    # says the model is drifting away from what the market has shown. A measure only: nothing is corrected
    fc['generator'] = {'asOf': this.isoformat(), 'lastYear': A, 'fuelCost': round(c0, 2), 'sims': 60, 'belowFloor': below,
                       'belowFloorExpected': 0.10, 'anchor': anchors}
    if V2 and band:
        # yearly capture quantiles of the full Monte Carlo: the pricer sets its capture drift on P50 − P25
        fc['generator']['band'] = band
        fc['generator']['v2'] = True
    # model risk (Tom 31 Oct. 2026): the generator's past errors against the realised (scripts/ppa_model_risk.py), so
    # the pricer takes off the forwards × their chosen percentile and the price does not lose money again and again
    try:
        mr = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_model_risk.json')))
        fc['generator']['modelRisk'] = {k: mr[k] for k in ('asOf', 'level') if k in mr}
        for tech in ('solar', 'wind'):
            if tech in mr:
                fc['generator']['modelRisk'][tech] = {k: mr[tech][k] for k in ('n', 'meanPts', 'qPts', 'meanEur', 'maeEur', 'byH', 'anchor')
                                                      if k in mr[tech]}
                if tech in (mr.get('anchorMae') or {}):
                    fc['generator']['modelRisk'][tech]['anchorMae'] = mr['anchorMae'][tech]
    except (OSError, ValueError, KeyError):
        pass
    with open(F_PATH, 'w') as f:
        json.dump(fc, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
