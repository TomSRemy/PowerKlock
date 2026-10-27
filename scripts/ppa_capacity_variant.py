#!/usr/bin/env python3
"""Method 2 (tendance de capacité), walk-forward test of the brief's section 2.1 items that don't
need Selfee park data: regional/pénétration slope (1), recency-weighted and seasonal slope (5),
other functional forms (6).

Protocol: same as ppa_backtest.py — history before Y only, 2022 left out, capacity of Y extrapolated
from the last two past years. Calibration years 2019-2021+2023 choose nothing here (each variant is
fixed, not tuned); scored on every year 2019-2026 like ppa_backtest.py's MAE table, and separately on
the verdict years 2024-2026.

Variants
  step        today's method: France-only GW, ln(capacity), slope on all past years, anchored last year
  multiPen    pooled slope across France + neighbours in ln(penetration) (GW ÷ average load GW) — already
              in ppa_backtest.m_multi, re-run here for the side-by-side table
  recentW     France-only, same as step but the slope fit weights years by recency (weight 0.8^(age))
  seasonal    two slopes (summer Apr-Sep, winter Oct-Mar) instead of one on the yearly rate
  linPen      France-only, linear (not log) in penetration instead of ln(capacity)
  threshold   France-only, flat below a penetration knee, ln(capacity) above it (knee = median penetration)

Writes data/history/ppa_capacity_variant.json
    python scripts/ppa_capacity_variant.py
"""
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_backtest as B   # noqa: E402
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_capacity_variant.json')
CAL, VERDICT = [2019, 2020, 2021, 2023], [2024, 2025, 2026]
SUMMER = set(range(4, 10))


def rate_season(y, V, summer):
    i = (B.yr == y) & (np.isin(B.mo, list(SUMMER)) if summer else ~np.isin(B.mo, list(SUMMER)))
    return B.rate(i, V, B.P)


def step(t, Y, train, V):
    return B.m_step(t, Y, train, V)


def multi_pen(t, Y, train, V):
    return B.m_multi(t, Y, train, V)


def recent_w(t, Y, train, V, halflife=0.8):
    r = [B.rate(B.yr == y, V, B.P) for y in train]
    x = [math.log(B.CAP[t][y]) for y in train]
    last = train[-1]
    w = np.array([halflife ** (last - y) for y in train])
    xm, rm = np.average(x, weights=w), np.average(r, weights=w)
    b = (w * (np.array(x) - xm) * (np.array(r) - rm)).sum() / (w * (np.array(x) - xm) ** 2).sum()
    r_last = r[-1]
    x_last, x_y = math.log(B.CAP[t][last]), math.log(B.cap_guess(t, Y, last))
    return r_last + b * (x_y - x_last)


def seasonal(t, Y, train, V):
    last = train[-1]
    x = [math.log(B.CAP[t][y]) for y in train]
    x_last, x_y = math.log(B.CAP[t][last]), math.log(B.cap_guess(t, Y, last))
    out = {}
    for summer in (True, False):
        r = [rate_season(y, V, summer) for y in train]
        b = np.polyfit(x, r, 1)[0] if len(train) >= 2 else 0
        r_last = rate_season(last, V, summer)
        out['summer' if summer else 'winter'] = r_last + b * (x_y - x_last)
    share_summer = 0.5  # months, not production-weighted: a rough 50/50 split of a yearly rate
    return share_summer * out['summer'] + (1 - share_summer) * out['winter']


def lin_pen(t, Y, train, V):
    r = [B.rate(B.yr == y, V, B.P) for y in train]
    pen = [B.CAP[t][y] / B.fr_load(y) for y in train]
    last = train[-1]
    b = np.polyfit(pen, r, 1)[0] if len(train) >= 2 else 0
    pen_last, pen_y = B.CAP[t][last] / B.fr_load(last), B.cap_guess(t, Y, last) / B.fr_load(last)
    return r[-1] + b * (pen_y - pen_last)


def threshold(t, Y, train, V):
    r = [B.rate(B.yr == y, V, B.P) for y in train]
    pen = [B.CAP[t][y] / B.fr_load(y) for y in train]
    knee = float(np.median(pen))
    x = [math.log(p / knee) if p > knee else 0.0 for p in pen]
    last = train[-1]
    pts = [(xx, rr) for xx, rr in zip(x, r) if xx > 0]
    b = np.polyfit(*zip(*pts), 1)[0] if len(pts) >= 2 else 0
    pen_last, pen_y = B.CAP[t][last] / B.fr_load(last), B.cap_guess(t, Y, last) / B.fr_load(last)
    x_last = math.log(pen_last / knee) if pen_last > knee else 0.0
    x_y = math.log(pen_y / knee) if pen_y > knee else 0.0
    return r[-1] + b * (x_y - x_last)


VARIANTS = {'step': step, 'multiPen': multi_pen, 'recentW': recent_w, 'seasonal': seasonal,
            'linPen': lin_pen, 'threshold': threshold}


def main():
    out = {'protocol': {'calibration': CAL, 'verdict': VERDICT, 'left_out': [2022],
                         'note': 'fixed variants, not tuned on calibration here — this is a side-by-side, not a selection'},
           'rows': []}
    for t, V in (('s', B.S), ('w', B.W)):
        for Y in B.TARGETS:
            train = [y for y in B.YEARS if y < Y and y != 2022]
            if len(train) < 3 or Y not in B.YEARS:
                continue
            real = B.rate(B.yr == Y, V, B.P)
            row = {'tech': 'solar' if t == 's' else 'wind', 'year': Y, 'actual': real}
            for name, fn in VARIANTS.items():
                try:
                    row[name] = fn(t, Y, train, V)
                except Exception as e:
                    row[name] = None
                    print('skip', name, t, Y, e, file=sys.stderr)
            out['rows'].append(row)
            print(row['tech'], Y, 'actual %.3f' % real,
                  ' '.join(f'{k} {row[k]:+.3f}' if row[k] is not None else f'{k} -' for k in VARIANTS), flush=True)
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for scope, pred in (('all', lambda r: r['year'] != 2022), ('verdict', lambda r: r['year'] in VERDICT)):
            rs = [r for r in out['rows'] if r['tech'] == tech and pred(r)]
            out['mae'][f'{tech}_{scope}'] = {
                k: round(float(np.mean([abs(r[k] - r['actual']) for r in rs if r[k] is not None])), 4) for k in VARIANTS}
    print(json.dumps(out['mae'], indent=1))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
