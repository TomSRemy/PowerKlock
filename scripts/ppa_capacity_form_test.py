#!/usr/bin/env python3
"""Capacity trend: which shape of curve between the fleet and the capture rate?

The capacity trend fits   capture = f(x)   on the past years, then moves from the last year's capture along the
curve to the fleet of the delivery year:  capture_Y = capture_last + f(x_Y) − f(x_last). Today f = a + b × ln(GW).
A log says each extra GW matters less; since 2023 the capture rate falls faster, not slower. Shapes compared:

  ln        a + b ln(GW)                  (published)
  lin       a + b GW
  ln2       a + b ln(GW) + c ln(GW)²
  gw2       a + b GW + c GW²
  sh        a + b s,        s = the year's solar (wind) output ÷ French consumption, in energy
  sh2       a + b s + c s²
For a delivery year, GW comes from the fleet path (last two known years extrapolated) and s = s_last × GW_Y ÷ GW_last
(consumption held at the last year's).

Protocol as scripts/ppa_horizon_test.py: each delivery year priced 1, 2 and 3 years ahead with the complete years up
to Y − h (2022 left out); score = production-weighted error on the value of one MWh (€/MWh), both conventions;
verdict 2024–2026 (2026 to date). Also: in-sample fit on every complete year (R², and leave-one-out error, which
punishes a curve that only fits because it has one more parameter), and today's projection for 2027–2029.

Writes data/history/ppa_capacity_form_test.json
    python scripts/ppa_capacity_form_test.py
"""
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_backtest as B             # noqa: E402
import ppa_backtest_detail as BD     # noqa: E402
sys.argv = _argv

H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'ppa_capacity_form_test.json')
TARGETS = [2021, 2023, 2024, 2025, 2026]
HORIZONS = (1, 2, 3)
FORMS = {   # name → (x measure, polynomial degree, log of x)
    'ln': ('gw', 1, True), 'lin': ('gw', 1, False), 'ln2': ('gw', 2, True), 'gw2': ('gw', 2, False),
    'sh': ('share', 1, False), 'sh2': ('share', 2, False)}


def share(t, y):
    a = L.DATA[y]
    return float(a['fr_' + t].sum() / a['fr_l'].sum())


def xval(t, form, y):
    m, _, lg = FORMS[form]
    v = L.cap('FR', t, y) if m == 'gw' else share(t, y)
    return math.log(v) if lg else v


def x_target(t, form, Y, last, gwY):
    m, _, lg = FORMS[form]
    v = gwY if m == 'gw' else share(t, last) * gwY / L.cap('FR', t, last)
    return math.log(v) if lg else v


def project(t, form, train, r, last, gwY):
    deg = FORMS[form][1]
    xs = np.array([xval(t, form, y) for y in train])
    co = np.polyfit(xs, r, deg)
    xL, xY = xval(t, form, last), x_target(t, form, None, last, gwY)
    return r[train.index(last)] + np.polyval(co, xY) - np.polyval(co, xL)


def main():
    out = {'rows': [], 'fit': {}, 'today': {}}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        for conv in ('curt', 'all'):
            # in-sample, every complete year but 2022: R² and leave-one-out error (capture points)
            ys = [y for y in L.DATA if L.DATA[y]['complete'] and y != 2022]
            r = [BD.rate(BD.yr == y, V, BD.P, conv) for y in ys]
            for form, (_, deg, _) in FORMS.items():
                xs = np.array([xval(t, form, y) for y in ys])
                co = np.polyfit(xs, r, deg)
                res = np.array(r) - np.polyval(co, xs)
                loo = []
                for i in range(len(ys)):
                    k = [j for j in range(len(ys)) if j != i]
                    c2 = np.polyfit(xs[k], np.array(r)[k], deg)
                    loo.append(r[i] - np.polyval(c2, xs[i]))
                out['fit'][f'{tech} {conv} {form}'] = {'r2': round(1 - float((res ** 2).sum() / ((np.array(r) - np.mean(r)) ** 2).sum()), 3),
                                                       'loo_pts': round(float(np.sqrt(np.mean(np.square(loo)))) * 100, 2)}
                # today: from the last complete year to 2027-2029 on the fleet path the pricer uses
                last = ys[-1]
                out['today'][f'{tech} {conv} {form}'] = [round(float(project(t, form, ys, r, last, L.cap_future('FR', t, Y))) * 100, 1) for Y in (2027, 2028, 2029)]
        for Y in TARGETS:
            if Y not in L.DATA:
                continue
            act = L.actual(t, Y)
            for h in HORIZONS:
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 4:
                    continue
                last = train[-1]
                gwY = L.cap_guess('FR', t, Y, last)
                row = {'tech': tech, 'year': Y, 'h': h, 'lastKnown': last}
                for conv in ('curt', 'all'):
                    r = [BD.rate(BD.yr == y, V, BD.P, conv) for y in train]
                    row[conv] = {}
                    for form in FORMS:
                        v = float(project(t, form, train, r, last, gwY))
                        row[conv][form] = (L.score({m: v for m in range(1, 13)}, act, conv) or {}).get('eur')
                out['rows'].append(row)
                print(tech, Y, f'h={h}', 'curt', ' '.join(f"{k} {v:+.2f}" for k, v in row['curt'].items()), flush=True)
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            for h in HORIZONS:
                rs = [r for r in out['rows'] if r['tech'] == tech and r['h'] == h and r['year'] >= 2024]
                out['mae'][f'{tech} {conv} h={h}'] = {k: [round(float(np.mean([abs(r[conv][k]) for r in rs])), 2), round(float(np.mean([r[conv][k] for r in rs])), 2)] for k in FORMS}
    for k, v in out['mae'].items():
        print('%-16s MAE (bias) ' % k + '  '.join(f'{m} {e[0]:.2f} ({e[1]:+.2f})' for m, e in v.items()))
    for k, v in out['fit'].items():
        print('fit', k, v, 'today 2027-29', out['today'][k])
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
