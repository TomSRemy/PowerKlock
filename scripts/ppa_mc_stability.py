#!/usr/bin/env python3
"""How many Monte Carlo draws the regional model needs: time per draw, and how much P10 / P50 / P90
of the yearly capture move from one random seed to another at 50, 150, 300 and 600 draws.

Same draws as the test bench's regionalMC (ppa_lab.regional: weeks of weather, demand and nuclear
from past years, prices drawn from the model's bins), live settings (ppa_forecast.json), central
capacity path, solar and wind, one forecast year. Yearly capture = paid-output-weighted mean of the
monthly capture rates (curtailed convention), as in ppa_lab's mcYear. The brief proposes a seed-to-seed
tolerance of about 0.5 €/MWh on P50 and P75: drift here in capture points, converted at a 60 €/MWh
baseload for the € reading.

Result (2028, central path): 27 ms per draw. Seed-to-seed spread of P10 / P50 / P75 / P90 at 150
draws (today's test bench): solar 0.32 / 0.06 / 0.18 / 0.40 €/MWh, wind 0.60 / 0.20 / 0.21 / 0.27;
at 300 draws every quantile of both is within 0.5 €/MWh, at 600 within 0.3. So P50 and P75 already
hold at 150; 20,000 draws would only matter for the far tails (P1, P99). A unified draw with more
random inputs (capacity path, prices drawn in the bin, curtailment rule) will need re-measuring.

Writes data/history/ppa_mc_stability.json
    python scripts/ppa_mc_stability.py [--year 2028]
"""
import json
import os
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L   # noqa: E402
sys.argv = _argv

H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'ppa_mc_stability.json')
SIMS = (50, 150, 300, 600)
SEEDS = (1, 2, 3, 4, 5)
BASE_EUR = 60.0


def yearly(dist_year):
    vals = []
    for a in dist_year:
        ms = [m for m in range(1, 13) if m in a and a[m]['curt'] is not None]
        w = np.array([a[m]['paid'] for m in ms])
        vals.append(float((w * np.array([a[m]['curt'] for m in ms])).sum() / w.sum()))
    return np.array(vals)


def main():
    Y = int(sys.argv[sys.argv.index('--year') + 1]) if '--year' in sys.argv else 2028
    settings = json.load(open(os.path.join(H, 'ppa_forecast.json')))['settings']
    past = [y for y in L.DATA if L.DATA[y]['complete']]
    last = max(past)
    capY = {c: {tt: L.cap_future(c, tt, Y) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
    out = {'year': Y, 'baseEur': BASE_EUR, 'techs': {}}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        st = settings[t]
        pm = L.PriceModel([y for y in past if st['with2022'] or y != 2022][-st['window']:], st['regional'], 'mean', st['level'] != 'none')
        lv = L.forward_levels(Y) if st['level'] == 'forward' else L.levels_for(last + 1, 'lastyear') if st['level'] == 'lastyear' else None
        res = {}
        for n in SIMS:
            qs, secs = [], []
            for seed in SEEDS:
                L.RNG = np.random.default_rng(seed)
                t0 = time.time()
                _, _, dist = L.regional(t, Y, past, pm, last, capY, n, lv, st['regional'])
                secs.append(time.time() - t0)
                v = yearly(dist['year'])
                qs.append([float(np.percentile(v, q)) for q in (10, 50, 75, 90)])
            qs = np.array(qs)
            spread = (qs.max(axis=0) - qs.min(axis=0))
            res[n] = {'p10': qs[:, 0].tolist(), 'p50': qs[:, 1].tolist(), 'p75': qs[:, 2].tolist(), 'p90': qs[:, 3].tolist(),
                      'seedSpreadPts': (spread * 100).round(2).tolist(), 'seedSpreadEur': (spread * BASE_EUR).round(2).tolist(),
                      'secondsPerRun': float(np.mean(secs)), 'secondsPerDraw': float(np.mean(secs) / n)}
            print(tech, Y, f'{n:4d} draws: P10/P50/P75/P90 seed-to-seed spread',
                  ' / '.join(f'{x:.2f}' for x in spread * BASE_EUR), '€/MWh |', f'{np.mean(secs) / n * 1000:.0f} ms per draw', flush=True)
        out['techs'][tech] = res
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
