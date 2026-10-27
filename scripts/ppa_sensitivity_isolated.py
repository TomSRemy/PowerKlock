#!/usr/bin/env python3
"""First pass at the full sensitivity module (brief 2.4): isolate weather alone and capacity alone
for a forecast year, the two easiest factors to isolate with what's already built. Not the full
module — nuclear, demand, forward level, the negative-price stop, the park's own profile and the
price-in-bin draw (tornado by parameter, Sobol indices with interactions) are still to do; this is
a first, narrower cut, not a replacement for it.

  weather alone    capacity held at the central PPE3 path (scripts/ppa_capacity_scenarios.py),
                   P10-P90 from the regional model's weather Monte Carlo (ppa_lab.regional, sims)
  capacity alone   weather held at its expectation (sims=0, the model's mean), capacity run through
                   low/central/high (France only — neighbours have no official bracket, see
                   ppa_capacity_scenarios.LIMITATIONS, so they stay at their central pace)
  combined         both varied together, to see whether the two spreads simply add up or interact

First result (2033 and 2035): weather spread (~5-9 capture points) dwarfs the capacity-scenario
spread (under 1 point even at 2035's full 55-80 GW solar bracket) — checked directly and this gap is
an artefact, not a real result, AND IT ALREADY MATTERS FOR THE LIVE PRICER, not just this far-out
test. ppa_lab.PriceModel's trained bins (5 recent years, blended France+neighbours residual load)
only go down to a residual share of -0.1. Checked the forecast ppa_lab.forecast() actually writes to
data/history/ppa_forecast.json (what the live pricer reads): on the central capacity path alone,
2027's blended regional residual share already reaches -0.28 — past the trained floor one year out —
and -0.61 by 2030. Every capacity scenario at 2035 clips to around -1.1 to -1.2, so 'low', 'central'
and 'high' all land on the same edge bin and the model can't tell them apart: that's why the
capacity-scenario spread above is near zero. This isn't only a 2035 sensitivity artefact — the live
regional/regionalMC methods are plausibly already clipping for part of their 2027-2030 forecast
horizon today. Needs checking against the live ppa_forecast.json and, if confirmed, either wider
training bins or an explicit extrapolated tail beyond PriceModel.near's nearest-bin fallback.

Writes data/history/ppa_sensitivity_isolated.json
    python scripts/ppa_sensitivity_isolated.py [--year 2030] [--sims 300]
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                      # noqa: E402
import ppa_capacity_scenarios as SCN      # noqa: E402
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_sensitivity_isolated.json')


def cap_year(Y, t, scenario, last_year, last_gw):
    """FR under `scenario`, neighbours at their own central pace (ppa_lab.cap_future)"""
    out = {'FR': {}}
    for tt in 'sw':
        if tt == t:
            out['FR'][tt] = SCN.fr_path(tt, scenario, last_year, last_gw[tt])(Y)
        else:
            out['FR'][tt] = L.cap_future('FR', tt, Y)
    for c in L.NEIGH:
        out[c] = {tt: L.cap_future(c, tt, Y) for tt in 'sw'}
    return out


def run(t, Y, sims):
    past = [y for y in L.DATA if L.DATA[y]['complete']]
    last = max(past)
    last_gw = {tt: L.cap('FR', tt, last) for tt in 'sw'}
    st = {'window': 5, 'regional': True, 'level': 'lastyear', 'with2022': False}
    pm = L.PriceModel([y for y in past if y != 2022][-st['window']:], st['regional'], 'mean', False)
    lv = L.levels_for(last + 1, 'lastyear')

    def capture(capY, n_sims):
        m4, m5, dist = L.regional(t, Y, past, pm, last, capY, n_sims, lv, st['regional'])
        if n_sims:
            vals = []
            for a in dist['year']:
                ms = [m for m in range(1, 13) if m in a]
                w = np.array([a[m]['paid'] for m in ms])
                vals.append(float((w * np.array([a[m]['curt'] or 0 for m in ms])).sum() / w.sum()))
            return float(np.mean(vals)), float(np.percentile(vals, 10)), float(np.percentile(vals, 90))
        ms = [m for m in range(1, 13) if m in m4]
        w = np.array([m4[m]['paid'] for m in ms])
        v = float((w * np.array([m4[m]['curt'] or 0 for m in ms])).sum() / w.sum())
        return v, v, v

    central = cap_year(Y, t, 'central', last, last_gw)
    weather_mean, weather_lo, weather_hi = capture(central, sims)
    cap_only = {}
    for scen in ('low', 'central', 'high'):
        capY = cap_year(Y, t, scen, last, last_gw)
        cap_only[scen], _, _ = capture(capY, 0)
    combined = {}
    for scen in ('low', 'central', 'high'):
        capY = cap_year(Y, t, scen, last, last_gw)
        combined[scen] = capture(capY, sims)
    return {
        'weatherAlone': {'mean': weather_mean, 'p10': weather_lo, 'p90': weather_hi, 'spread': weather_hi - weather_lo},
        'capacityAlone': {**cap_only, 'spread': cap_only['high'] - cap_only['low']},
        'combined': {k: {'mean': v[0], 'p10': v[1], 'p90': v[2]} for k, v in combined.items()},
        # weather AND capacity scenario together: the widest band across all three scenarios
        'combinedSpread': max(v[2] for v in combined.values()) - min(v[1] for v in combined.values()),
    }


def main():
    Y = int(sys.argv[sys.argv.index('--year') + 1]) if '--year' in sys.argv else 2030
    sims = int(sys.argv[sys.argv.index('--sims') + 1]) if '--sims' in sys.argv else 300
    out = {'year': Y, 'note': __doc__.split('\n\n')[0], 'techs': {}}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        out['techs'][tech] = run(t, Y, sims)
        r = out['techs'][tech]
        print(tech, 'weather spread %.3f | capacity spread %.3f | combined %.3f' %
              (r['weatherAlone']['spread'], r['capacityAlone']['spread'], r['combinedSpread']), flush=True)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
