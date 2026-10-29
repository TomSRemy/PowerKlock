#!/usr/bin/env python3
"""Each pricing method against what was realised, year by year (PPA pricer › Compare & price).

From scripts/ppa_horizon_test.py (data/history/ppa_horizon_test.json): each delivery year priced 1, 2 and 3 years
ahead with only the years known then, each method's error on the value of one MWh (€/MWh, production-weighted).
Here the realised value of one MWh of the national profile is added (French day-ahead × national output, the
same weights as the test's score), so each method's prediction reads as realised + its error.

Writes data/history/ppa_vs_actual.json
    {"asOf", "source", "tech": {"solar": {"curt": {"1": {"2024": {"actual", "step", "fpc", "weather", "regional",
     "avg4", "partial"}, …}, "2": …, "3": …}, "all": …}, "wind": …}}
    python scripts/ppa_vs_actual.py
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
sys.argv = _argv

H = os.path.join(ROOT, 'data', 'history')
METHODS = ('step', 'fpc', 'weather', 'regional', 'avg4')


def value(act, conv):
    """the realised value of one MWh (€/MWh), months weighted as in ppa_lab.score"""
    ms = [m for m in act if act[m][conv] is not None]
    w = np.array([act[m]['mwh'] * (act[m]['paid'] if conv == 'curt' else 1) for m in ms])
    v = np.array([act[m][conv] * act[m]['base'] for m in ms])
    return float((w * v).sum() / w.sum())


def main():
    hz = json.load(open(os.path.join(H, 'ppa_horizon_test.json')))
    out = {'asOf': hz.get('asOf'), 'source': 'scripts/ppa_horizon_test.py + realised national value', 'tech': {}}
    acts = {}
    for r in hz['rows']:
        t = 's' if r['tech'] == 'solar' else 'w'
        Y = r['year']
        if (t, Y) not in acts:
            acts[(t, Y)] = L.actual(t, Y)
        for conv in ('curt', 'all'):
            a = value(acts[(t, Y)], conv)
            row = {'actual': round(a, 2), 'partial': not L.DATA[Y]['complete']}
            for k in METHODS:
                e = (r.get(conv) or {}).get(k)
                row[k] = None if e is None else round(a + e, 2)
            out['tech'].setdefault(r['tech'], {}).setdefault(conv, {}).setdefault(str(r['h']), {})[str(Y)] = row
    with open(os.path.join(H, 'ppa_vs_actual.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    for tech, d in out['tech'].items():
        for y, row in sorted(d['curt']['1'].items()):
            print(tech, y, row)


if __name__ == '__main__':
    main()
