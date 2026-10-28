#!/usr/bin/env python3
"""Bias of each PPA method, learnt on its own past errors: the correction the pricer takes off.

For each technology, method, contract convention and horizon h (1, 2, 3 years between the last complete
year and the delivery year), the mean signed error of the method's yearly capture rate (production-weighted,
capture points: forecast − realised) over the delivery years already realised, 2022 left out, each priced
with the complete years up to Y − h only (as scripts/ppa_horizon_test.py). The pricer subtracts it from the
method's capture of each delivery year, at that year's horizon (h > 3 takes h = 3).

Applied only where the test (scripts/ppa_bias_test.py, variant "all", 2024–2026, 1 to 3 years ahead) lowers
the method's mean error over the three horizons (rule set by Tom on 28 Oct. 2026: take every correction that
improves, judged on the published convention, the stopped-at-prices-≤-0 one; the other convention where it
also improves there). Also writes avg4Mae: the mean absolute error of the 4-method average with these corrections,
2024–2026, 1 to 3 years ahead (€/MWh), the precision shown next to the published price:
                     curt (published)                       all hours
  capacity trend     wind 3.15 → 2.91                       solar 6.62 → 4.62, wind 3.41 → 3.13
  forward shape      solar 5.01 → 3.81                      solar 9.45 → 8.47
  weather sim.       wind 2.95 → 2.20                       solar 8.96 → 8.22, wind 3.86 → 3.55
  European model     wind 5.79 → 4.21                       wind 2.83 → 2.78
  not applied: capacity trend solar curt (2.69 → 2.79), European solar (2.68 → 2.71; 4.65 → 5.49), forward
  shape wind curt (2.68 → 2.89), weather solar curt (3.82 → 3.82, no gain)
4-method average, mean over 1–3 years: solar curt 2.10 → 1.94, wind curt 2.67 → 1.92 €/MWh.
Limits: three test years; the weather simulation of the pricer (js/ppa-wx.js) is a lighter version of the
test bench's, so its correction is the test bench's error.

Writes data/history/ppa_bias.json
    python scripts/ppa_bias.py
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_bias_test as T     # noqa: E402
import ppa_lab as L           # noqa: E402
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_bias.json')
ADOPT = {'solar': {'curt': ['fpc'], 'all': ['step', 'fpc', 'weather']},
         'wind': {'curt': ['step', 'weather', 'regional'], 'all': ['step', 'weather', 'regional']}}


def main():
    R = T.runs(use_cache='--cache' in sys.argv)
    done = [y for y in L.DATA if L.DATA[y]['complete']]
    last = max(done)
    out = {'lastYear': last, 'unit': 'capture rate (fraction): subtract from the method\'s capture', 'adopt': ADOPT, 'bias': {}}
    for tech in ('solar', 'wind'):
        t = 's' if tech == 'solar' else 'w'
        for k in T.METHODS:
            for conv in ('curt', 'all'):
                for h in T.HORIZONS:
                    errs = []
                    for Y in T.RUN_YEARS:
                        key = f'{tech}|{Y}|{h}|{conv}'
                        if Y > last or Y == 2022 or key not in R:
                            continue
                        s = L.score({int(m): v for m, v in R[key][k].items()}, L.actual(t, Y), conv)
                        if s:
                            errs.append(s['pts'] / 100)
                    if errs:
                        out['bias'].setdefault(tech, {}).setdefault(k, {}).setdefault(conv, {})[str(h)] = {'value': round(float(np.mean(errs)), 4), 'n': len(errs)}
    # the precision of the published price: the 4-method average with the adopted corrections, 2024–2026,
    # each correction learnt only on the years realised before the scored year (as in scripts/ppa_bias_test.py)
    act = {(tech, Y): L.actual('s' if tech == 'solar' else 'w', Y) for tech in ('solar', 'wind') for Y in T.RUN_YEARS if Y in L.DATA}
    pred = lambda tech, Y, h, conv, k: {int(m): v for m, v in R[f'{tech}|{Y}|{h}|{conv}'][k].items()} if f'{tech}|{Y}|{h}|{conv}' in R else None
    def corr(tech, Y, h, conv, k):
        past = [y for y in T.RUN_YEARS if y <= Y - h and y != 2022 and pred(tech, y, h, conv, k)]
        return float(np.mean([L.score(pred(tech, y, h, conv, k), act[(tech, y)], conv)['pts'] for y in past])) / 100 if past else 0.0
    out['avg4Mae'] = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            for h in T.HORIZONS:
                errs = []
                for Y in T.TEST:
                    ps = {k: pred(tech, Y, h, conv, k) for k in T.METHODS}
                    if any(v is None for v in ps.values()):
                        continue
                    c = {k: corr(tech, Y, h, conv, k) if k in ADOPT[tech][conv] else 0.0 for k in T.METHODS}
                    ms = set.intersection(*[set(p) for p in ps.values()])
                    errs.append(abs(L.score({m: float(np.mean([ps[k][m] - c[k] for k in T.METHODS])) for m in ms}, act[(tech, Y)], conv)['eur']))
                if errs:
                    out['avg4Mae'].setdefault(tech, {}).setdefault(conv, {})[str(h)] = round(float(np.mean(errs)), 2)
    print('avg4Mae', out['avg4Mae'])
    for tech, v in out['bias'].items():
        for k, c in v.items():
            print(tech, k, {conv: {h: x['value'] for h, x in hh.items()} for conv, hh in c.items()}, 'applied:', [conv for conv in ('curt', 'all') if k in ADOPT[tech][conv]])
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
