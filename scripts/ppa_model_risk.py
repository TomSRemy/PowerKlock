#!/usr/bin/env python3
"""Model risk of the PPA scenario generator: how far its capture has been from the realised, so the published price
does not lose money again and again when the model is wrong in the same direction.

Replay: each delivery year from 2023 (the years with France's Core export limits, JAO) to the running year (its
complete months only), priced 1, 2 and 3 years ahead with only the complete years known then, exactly as the generator
prices today (scripts/ppa_scenarios.py simulate, current settings, anchored on the last known year); error = the generator's capture − the realised
capture, output stopped at prices ≤ 0, production-weighted, in capture points (so the pricer applies it to the
forwards of the tenor) and in € on the realised baseload. Deliveries whose last known year is before 2022 are left out
(other regime, no JAO).

The pricer takes off the forwards × the LEVEL-th percentile of the errors (pooled over horizons, recent deliveries
weighing more: a case's weight halves for each year its delivery is older): with LEVEL = 75, the
published price would not have been above the realised value in 3 cases out of 4. Measured again every week (the
PPA lab workflow) as months complete.

Writes data/history/ppa_model_risk.json
    {"asOf", "level", "protocol", "rows": [{"tech", "year", "h", "known", "months", "pts", "eur"}],
     "solar" | "wind": {"n", "meanPts", "maePts", "qPts", "meanEur", "maeEur", "byH": {"1": {...}}}}
    python scripts/ppa_model_risk.py
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

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_model_risk.json')
LEVEL = 75
FIRST = 2023
HALF = 1.0   # recent cases weigh more (Tom, 31 Oct. 2026): a case's weight halves for each year its delivery is older


def wquantile(x, w, q):
    """weighted percentile q (0–100), linear between the cumulative weights' mid-points"""
    o = np.argsort(x); x, w = np.asarray(x, float)[o], np.asarray(w, float)[o]
    c = (np.cumsum(w) - 0.5 * w) / w.sum()
    return float(np.interp(q / 100, c, x))


def main():
    settings = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    F = G.fuel_cost()
    rows = []
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Y in range(FIRST, date.today().year + 1):
            if Y not in L.DATA:
                continue
            act = L.actual(t, Y)
            act = {m: v for m, v in act.items() if v['days'] >= 28}      # complete months only
            if not act:
                continue
            for h in (1, 2, 3):
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                A = max(known)
                if A < 2022:
                    continue
                capY = {c: {tt: L.cap_guess(c, tt, Y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = {m: float(L.DATA[A]['fr_p'][L.DATA[A]['month'] == m].mean()) for m in range(1, 13)}
                c0 = float(np.mean([v for k, v in F.items() if f'{A}-12-01' <= k <= f'{A}-12-31']))
                gm, _ = G.simulate(t, Y, known, st, A, capY, lv, n=30, rule='fuel', cost=lambda d: c0, batteries='both',
                                   pool_from=2019, fuel_dev=True, france=True, seed=7)
                # anchored on the last known year, as the published generator (ppa_scenarios ANCHOR)
                kA = G.anchor_factor(t, A, known, st, lambda d: c0)['curt'] if G.ANCHOR else 1.0
                sc = L.score({m: v['curt'] * kA for m, v in gm.items()}, act, 'curt')
                if not sc:
                    continue
                rows.append({'tech': tech, 'year': Y, 'h': h, 'known': A, 'months': len(act),
                             'pts': round(sc['pts'], 3), 'eur': round(sc['eur'], 3)})
                print(tech, Y, f'h={h}', f"{sc['pts']:+.2f} pts  {sc['eur']:+.2f} €/MWh", flush=True)
    out = {'asOf': date.today().isoformat(), 'level': LEVEL, 'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows}
    for tech in ('solar', 'wind'):
        rs = [r for r in rows if r['tech'] == tech]
        if not rs:
            continue
        p = np.array([r['pts'] for r in rs]); e = np.array([r['eur'] for r in rs])
        last = max(r['year'] for r in rs)
        w = np.array([0.5 ** ((last - r['year']) / HALF) for r in rs])
        out[tech] = {'n': len(rs), 'meanPts': round(float((w * p).sum() / w.sum()), 3), 'maePts': round(float(np.abs(p).mean()), 3),
                     'qPts': round(wquantile(p, w, LEVEL), 3), 'qPtsEqual': round(float(np.percentile(p, LEVEL)), 3),
                     'meanEur': round(float((w * e).sum() / w.sum()), 3), 'meanEurEqual': round(float(e.mean()), 3),
                     'maeEur': round(float(np.abs(e).mean()), 3),
                     'byH': {str(h): {'n': len(x), 'maeEur': round(float(np.mean(np.abs(x))), 3), 'meanEur': round(float(np.mean(x)), 3)}
                             for h in (1, 2, 3) for x in [[r['eur'] for r in rs if r['h'] == h]] if x}}
        print(tech, out[tech])
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
