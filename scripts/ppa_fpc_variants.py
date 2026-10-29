#!/usr/bin/env python3
"""Forward shape method (FPC): two changes proposed after the 27 Oct. review, tested before entering the pricer.

  1. a recent skeleton: the hourly shape (month × day type × hour, P ÷ month average) taken on the last K
     training years only, or on all of them weighted towards the recent ones (half-life h years), instead of
     the plain average of every training year since 2016;
  2. a seasonal cannibalisation term: c = historical (1) − decorrelated (3) computed and projected per season
     (summer April–September, winter October–March) instead of once a year.
The cannibalisation term is always measured against the skeleton in use (c is the residual of that
skeleton), so the two parts cannot count the same effect twice.

Protocol (as scripts/ppa_lab.py): each delivery year priced with the years before it (2022 left out of the
training); score = production-weighted monthly error of the value of one MWh, €/MWh (capture error × the
month's baseload); settings chosen on 2019–2021 and 2023, verdict on 2024–2026 (2026 to date).

Writes data/history/ppa_fpc_variants.json
    python scripts/ppa_fpc_variants.py
"""
import json
import math
import os
import sys
from datetime import date

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_backtest as B             # noqa: E402
import ppa_backtest_detail as BD     # noqa: E402
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_fpc_variants.json')
YEARS = [2019, 2020, 2021, 2023, 2024, 2025, 2026]
CALIB, VERDICT = [2019, 2020, 2021, 2023], [2024, 2025, 2026]
yr, mo, ty, hr, P, mavg = B.yr, B.mo, B.ty, B.hr, B.P, B.mavg
SUMMER = set(range(4, 10))


def shape_coef(train, weights):
    """B.shape_coef with year weights: hourly coefficients and month ÷ year ratios"""
    co, mc = {}, {}
    rel = P / mavg
    for m in range(1, 13):
        for d in range(3):
            for h in range(24):
                num = den = 0.0
                for y in train:
                    i = (yr == y) & (mo == m) & (ty == d) & (hr == h)
                    if i.any():
                        num += weights[y] * rel[i].mean(); den += weights[y]
                co[(m, d, h)] = num / den if den else 1.0
        num = den = 0.0
        for y in train:
            i = (yr == y) & (mo == m)
            if i.any():
                num += weights[y] * P[i].mean() / P[yr == y].mean(); den += weights[y]
        mc[m] = num / den if den else 1.0
    return co, mc


def fpc(t, Y, train, V, conv, skel, seasonal):
    """monthly capture rates of the forward shape method for one variant"""
    if skel[0] == 'last':
        sy = train[-skel[1]:]
        w = {y: 1.0 for y in sy}
    elif skel[0] == 'half':
        sy = train
        w = {y: 0.5 ** ((train[-1] - y) / skel[1]) for y in train}
    else:
        sy, w = train, {y: 1.0 for y in train}
    co, mc = shape_coef(sy, w)
    days = [date.fromordinal(o) for o in range(date(Y, 1, 1).toordinal(), date(Y + 1, 1, 1).toordinal())]
    prof = {}
    for m in range(1, 13):
        for h in range(24):
            i = np.isin(yr, train) & (mo == m) & (hr == h)
            lf = V[i] / np.array([B.CAP[t][int(y)] for y in yr[i]])
            prof[(m, h)] = lf.mean() if i.any() else 0
    sk, pv, mm = [], [], []
    for d in days:
        wd = d.weekday()
        dt_ = 0 if wd < 5 else (1 if wd == 5 else 2)
        for h in range(24):
            sk.append(mc[d.month] * co[(d.month, dt_, h)]); pv.append(prof[(d.month, h)]); mm.append(d.month)
    sk, pv, mm = np.array(sk), np.array(pv), np.array(mm)
    fm = {m: (pv[mm == m] * sk[mm == m]).sum() / pv[mm == m].sum() / sk[mm == m].mean() - 1 for m in range(1, 13)}
    groups = (('summer', SUMMER), ('winter', set(range(1, 13)) - SUMMER)) if seasonal else (('year', set(range(1, 13))),)
    last = train[-1]
    cterm = {}
    for g, ms in groups:
        cs = []
        for y in train:
            i = yr == y
            full = np.zeros_like(P)
            full[i] = B.decorrelated(y, co)
            k = i & np.isin(mo, list(ms))
            cs.append(BD.rate(k, V, P, conv) - BD.rate(k, V, full, conv))
        b = B.logfit([B.CAP[t][y] for y in train], cs) if len(train) >= 3 else 0
        c = cs[-1] + b * (math.log(B.cap_guess(t, Y, last)) - math.log(B.CAP[t][last]))
        for m in ms:
            cterm[m] = c
    return {m: 1 + fm[m] + cterm[m] for m in range(1, 13)}


def monthly_err(pred, act, conv):
    num = den = 0.0
    for m, a in act.items():
        p = pred.get(m)
        if p is None or a[conv] is None:
            continue
        w = a['mwh'] * (a['paid'] if conv == 'curt' else 1)
        num += w * abs(p - a[conv]) * a['base']; den += w
    return num, den


VARIANTS = {'all years (today)': (('all', 0), False)}
for k in (2, 3, 4, 5):
    VARIANTS[f'last {k} years'] = (('last', k), False)
for h in (1, 2, 3):
    VARIANTS[f'half-life {h} y'] = (('half', h), False)
for name in list(VARIANTS):
    VARIANTS[name + ' + seasonal c'] = (VARIANTS[name][0], True)


def main():
    res = {}
    for t in 'sw':
        tech = L.TECH[t]
        V = B.S if t == 's' else B.W
        for Y in YEARS:
            past = [y for y in L.DATA if y < Y and L.DATA[y]['complete']]
            train = [y for y in past if y != 2022 and y >= 2016]
            act = L.actual(t, Y)
            for name, (skel, seas) in VARIANTS.items():
                for conv in ('curt', 'all'):
                    n, d = monthly_err(fpc(t, Y, train, V, conv, skel, seas), act, conv)
                    res.setdefault(tech, {}).setdefault(conv, {}).setdefault(name, {})[Y] = (n, d)
            print('done', tech, Y, flush=True)
    out = {'protocol': 'each year priced with the years before it, 2022 left out of training; production-weighted monthly error, €/MWh',
           'calibration': CALIB, 'verdict': VERDICT, 'rows': []}
    for tech in res:
        for conv in res[tech]:
            score = lambda name, ys: sum(res[tech][conv][name][y][0] for y in ys) / sum(res[tech][conv][name][y][1] for y in ys)
            best = min(VARIANTS, key=lambda nm: score(nm, CALIB))
            for name in VARIANTS:
                out['rows'].append({'tech': tech, 'conv': conv, 'variant': name, 'calib': round(score(name, CALIB), 3), 'verdict': round(score(name, VERDICT), 3),
                                    'years': {y: round(res[tech][conv][name][y][0] / res[tech][conv][name][y][1], 3) for y in YEARS}, 'chosen': name == best})
            print(f'\n{tech} {conv}: chosen on calibration = {best}')
            for name in VARIANTS:
                print(f"  {name:32s} calib {score(name, CALIB):6.2f}  verdict {score(name, VERDICT):6.2f}  " + ' '.join(f"{y}:{res[tech][conv][name][y][0] / res[tech][conv][name][y][1]:5.2f}" for y in YEARS))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
