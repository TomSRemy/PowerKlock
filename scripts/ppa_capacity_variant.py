#!/usr/bin/env python3
"""Method 2 (tendance de capacité), walk-forward test of the brief's section 2.1 items that don't
need Selfee park data: regional/pénétration slope (1), recency-weighted and seasonal slope (5),
other functional forms (6), and the denominator of the penetration term (7).

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
  totalCapPen France-only, ln(solar or wind GW ÷ total installed GW of all technologies) instead of
              ln(solar or wind GW ÷ average demand GW) — denominator question of item 7
  prodSharePen France-only, ln(solar or wind GW ÷ (solar + wind + nuclear GW)) — the technology's share
              of the dispatchable-plus-renewable fleet, the other denominator item 7 asks to test

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

_cap_all = json.load(open(os.path.join(ROOT, 'data', 'history', 'capacity.json')))['countries']['FR']
TOTAL_CAP = {y: sum(v[i] or 0 for v in _cap_all['types'].values()) for i, y in enumerate(_cap_all['years'])}


def nuclear_gw(y):
    """France's nuclear fleet, GW (needed for the production-share denominator)"""
    i = _cap_all['years'].index(y) if y in _cap_all['years'] else None
    return _cap_all['types']['Nuclear'][i] if i is not None else None


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


def _series_guess(series, Y, last):
    """last value extrapolated one step at a time, same linear rule as B.cap_guess"""
    prev = series.get(last - 1, series[last])
    return series[last] + (series[last] - prev) * (Y - last)


def total_cap_pen(t, Y, train, V):
    """ln(solar or wind GW ÷ total installed GW of all technologies) instead of ÷ average demand GW"""
    r = [B.rate(B.yr == y, V, B.P) for y in train]
    x = [math.log(B.CAP[t][y] / TOTAL_CAP[y]) for y in train]
    last = train[-1]
    b = np.polyfit(x, r, 1)[0] if len(train) >= 2 else 0
    x_last = math.log(B.CAP[t][last] / TOTAL_CAP[last])
    tot_y = _series_guess(TOTAL_CAP, Y, last)
    x_y = math.log(B.cap_guess(t, Y, last) / tot_y)
    return r[-1] + b * (x_y - x_last)


def prod_share_pen(t, Y, train, V):
    """ln(solar or wind GW ÷ (solar + wind + nuclear GW)) — share of the low-carbon fleet instead of ÷ demand"""
    def denom(y):
        return B.CAP['s'][y] + B.CAP['w'][y] + (nuclear_gw(y) or 0)
    r = [B.rate(B.yr == y, V, B.P) for y in train]
    x = [math.log(B.CAP[t][y] / denom(y)) for y in train]
    last = train[-1]
    b = np.polyfit(x, r, 1)[0] if len(train) >= 2 else 0
    x_last = math.log(B.CAP[t][last] / denom(last))
    nuc_y = _series_guess({y: nuclear_gw(y) for y in _cap_all['years']}, Y, last)
    tot_y = B.cap_guess('s', Y, last) + B.cap_guess('w', Y, last) + nuc_y
    x_y = math.log(B.cap_guess(t, Y, last) / tot_y)
    return r[-1] + b * (x_y - x_last)


VARIANTS = {'step': step, 'multiPen': multi_pen, 'recentW': recent_w, 'seasonal': seasonal,
            'linPen': lin_pen, 'threshold': threshold, 'totalCapPen': total_cap_pen, 'prodSharePen': prod_share_pen}


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
