#!/usr/bin/env python3
"""Bias of each PPA method, learnt on its own past errors: the correction the pricer takes off.

For each technology, method, contract convention and horizon h (1, 2, 3 years between the last complete
year and the delivery year), the mean signed error of the method's yearly capture rate (production-weighted,
capture points: forecast − realised) over the delivery years already realised, 2022 left out, each priced
with the complete years up to Y − h only (as scripts/ppa_horizon_test.py). The pricer subtracts it from the
method's capture of each delivery year, at that year's horizon (h > 3 takes h = 3).

Applied only where the test (scripts/ppa_bias_test.py, variant "all", complete delivery years from 2024, 1 to 3
years ahead; rerun every week before this script, which reads its choice) lowers the method's mean error over the
three horizons (rule set by Tom on 28 Oct. 2026: take every correction that
improves, judged on the published convention, the stopped-at-prices-≤-0 one; the other convention where it
also improves there). Also writes avg4Mae: the mean absolute error of the 4-method average with these corrections,
complete delivery years from 2024, 1 to 3 years ahead (€/MWh), the precision shown next to the published price.
The corrections taken and their gains: data/history/ppa_bias_test.json (rerun weekly; until 30 Oct. 2026 the
choice was a fixed list learnt with 2026 still running, ADOPT_FIXED).
Limits: few test years (two while 2026 runs); the weather simulation of the pricer (js/ppa-wx.js) is a lighter version of the
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
# the corrections chosen until 30 Oct. 2026 (fixed list); now kept only as the fallback without a test file
ADOPT_FIXED = {'solar': {'curt': ['fpc'], 'all': ['step', 'fpc', 'weather']},
               'wind': {'curt': ['step', 'weather', 'regional'], 'all': ['step', 'weather', 'regional']}}


def adopt_from_test():
    """Tom's rule, applied to the latest test (data/history/ppa_bias_test.json, complete delivery years only): a method's
    correction is taken in a convention where the 'all' variant lowers its mean error over the three horizons"""
    try:
        mae = json.load(open(T.OUT))['mae']
    except (OSError, KeyError, ValueError):
        return ADOPT_FIXED
    out = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            keep = []
            for k in T.METHODS:
                try:
                    n = np.mean([mae[f'{tech} {conv} h={h}'][k]['none'] for h in T.HORIZONS])
                    a = np.mean([mae[f'{tech} {conv} h={h}'][k]['all'] for h in T.HORIZONS])
                except (KeyError, TypeError):
                    continue
                if a < n:
                    keep.append(k)
            out.setdefault(tech, {})[conv] = keep
    return out


ADOPT = adopt_from_test()


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
    # the precision of the published price: the 4-method average with the adopted corrections, complete years from 2024,
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
    # the spread of the published average's capture errors, for its P10–P90 band: errors (capture points) of the
    # corrected 4-method average on the realised delivery years (2022 out), σ(h) = a × √h fitted on all horizons,
    # with n the number of errors (the pricer widens it with the Student t of n − 1 degrees of freedom).
    # Walk-forward check 2021–2026 (σ learnt only on errors realised at pricing time): the band holds the realised
    # value 11 times in 13 for solar, 12 in 13 for wind (target 8 in 10), against 12/13 and 13/13 with the capacity
    # trend's own spread, used until 28 Oct. 2026 (too wide: σ 4.28 and 3.0 pts per √year against 2.43 and 1.70).
    out['bandSigma'] = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            errs = []
            for Y in T.RUN_YEARS:
                if Y > last or Y == 2022:
                    continue
                for h in T.HORIZONS:
                    ps = {k: pred(tech, Y, h, conv, k) for k in T.METHODS}
                    if any(v is None for v in ps.values()):
                        continue
                    c = {k: corr(tech, Y, h, conv, k) if k in ADOPT[tech][conv] else 0.0 for k in T.METHODS}
                    ms = set.intersection(*[set(p) for p in ps.values()])
                    errs.append((h, L.score({m: float(np.mean([ps[k][m] - c[k] for k in T.METHODS])) for m in ms}, act[(tech, Y)], conv)['pts'] / 100))
            if len(errs) >= 3:
                out['bandSigma'].setdefault(tech, {})[conv] = {'a': round(float(np.sqrt(sum(e * e for _, e in errs) / sum(h for h, _ in errs))), 4), 'n': len(errs)}
    print('bandSigma', out['bandSigma'])
    for tech, v in out['bias'].items():
        for k, c in v.items():
            print(tech, k, {conv: {h: x['value'] for h, x in hh.items()} for conv, hh in c.items()}, 'applied:', [conv for conv in ('curt', 'all') if k in ADOPT[tech][conv]])
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
