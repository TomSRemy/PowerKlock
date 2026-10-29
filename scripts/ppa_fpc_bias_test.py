#!/usr/bin/env python3
"""Forward shape method (FPC): why too high, and what brings it back? Walk-forward at the benchmark's horizon.

The 2024–2026 replay (scripts/ppa_horizon_test.py) put the forward shape method above what was realised (solar,
one year ahead). Variants of scripts/ppa_backtest_detail.m_fpc, everything else equal:
  base       the method as on the site (solar skeleton half-life 1 year, cannibalisation per season, log of capacity)
  sk_all     skeleton: plain average of the training years
  c_lin      cannibalisation projected linearly with installed GW instead of its log
  c_flat     cannibalisation held at the last year's (no projection)
  c_last2    cannibalisation: mean of the last two years, projected with the log
  pv_recent  production profile weighted towards the recent years (half-life 1 year), as the skeleton
  c_own      cannibalisation of each training year measured against the skeleton of ITS time (built on the years up
             to it, same weights), not against today's: with a skeleton leaning on the last year, the trend of
             (1) − (3) also carries the move of the skeleton itself, so projecting it may count the midday drop twice
  c_none     no cannibalisation term: the recent skeleton alone
  bias       the base method minus its mean error on the years already known at the time (walk-forward, h = 1),
             a correction learned only from the past
Protocol as ppa_horizon_test.py: each year priced 1, 2 and 3 years ahead with complete years up to Y − h (2022 out),
score = production-weighted error on the value of one MWh (€/MWh), both conventions; verdict 2024–2026.

Writes data/history/ppa_fpc_bias_test.json
    python scripts/ppa_fpc_bias_test.py
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

H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'ppa_fpc_bias_test.json' if '--only' not in sys.argv else 'ppa_fpc_cannib_test.json')
TARGETS = [2019, 2020, 2021, 2023, 2024, 2025, 2026]
HORIZONS = (1, 2, 3)
VARIANTS = tuple(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else ('base', 'sk_all', 'c_lin', 'c_flat', 'c_last2', 'pv_recent', 'c_own', 'c_none')


def m_fpc_v(t, Y, train, V, conv, var):
    """BD.m_fpc with one change; returns the monthly capture dict"""
    yr, mo, hr, P = BD.yr, BD.mo, BD.hr, BD.P
    half = None if var == 'sk_all' else BD.FPC_HALF[t]
    co, mc = BD.shape_coef_w(train, {y: 0.5 ** ((train[-1] - y) / half) if half else 1.0 for y in train})
    days = [date.fromordinal(o) for o in range(date(Y, 1, 1).toordinal(), date(Y + 1, 1, 1).toordinal())]
    wy = {y: (0.5 ** (train[-1] - y) if var == 'pv_recent' else 1.0) for y in train}
    prof = {}
    for m in range(1, 13):
        for h in range(24):
            i = np.isin(yr, train) & (mo == m) & (hr == h)
            if not i.any():
                prof[(m, h)] = 0
                continue
            lf = V[i] / np.array([B.CAP[t][int(y)] for y in yr[i]])
            w = np.array([wy[int(y)] for y in yr[i]])
            prof[(m, h)] = float((lf * w).sum() / w.sum())
    sk, pv, mm = [], [], []
    for d in days:
        wd = d.weekday()
        dt_ = 0 if wd < 5 else (1 if wd == 5 else 2)
        for h in range(24):
            sk.append(mc[d.month] * co[(d.month, dt_, h)]); pv.append(prof[(d.month, h)]); mm.append(d.month)
    sk, pv, mm = np.array(sk), np.array(pv), np.array(mm)
    fm = {m: (pv[mm == m] * sk[mm == m]).sum() / pv[mm == m].sum() / sk[mm == m].mean() - 1 for m in range(1, 13)}
    last = train[-1]
    fulls = {}
    for j, y in enumerate(train):
        i = yr == y
        full = np.zeros_like(P)
        if var == 'c_own':   # the skeleton of that year's time: the training years up to it
            tj = train[:j + 1] if j >= 1 else train[:2]
            co_y, _ = BD.shape_coef_w(tj, {x: 0.5 ** ((tj[-1] - x) / half) if half else 1.0 for x in tj})
            full[i] = B.decorrelated(y, co_y)
        else:
            full[i] = B.decorrelated(y, co)
        fulls[y] = full
    cterm = {}
    gl, gY = B.CAP[t][last], B.cap_guess(t, Y, last)
    for months in (BD.SUMMER, set(range(1, 13)) - BD.SUMMER):
        cs = []
        for y in train:
            k = (yr == y) & np.isin(mo, list(months))
            cs.append(BD.rate(k, V, P, conv) - BD.rate(k, V, fulls[y], conv))
        gws = [B.CAP[t][y] for y in train]
        if var == 'c_none':
            v = 0.0
        elif var == 'c_flat':
            v = cs[-1]
        elif var == 'c_lin':
            b = np.polyfit(gws, cs, 1)[0] if len(train) >= 3 else 0
            v = cs[-1] + b * (gY - gl)
        else:
            b = B.logfit(gws, cs) if len(train) >= 3 else 0
            anchor = np.mean(cs[-2:]) if var == 'c_last2' else cs[-1]
            v = anchor + b * (math.log(gY) - math.log(gl))
        for m in months:
            cterm[m] = v
    return {m: 1 + fm[m] + cterm[m] for m in range(1, 13)}


def main():
    out = {'rows': []}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        for Y in TARGETS:
            if Y not in L.DATA:
                continue
            act = L.actual(t, Y)
            for h in HORIZONS:
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                row = {'tech': tech, 'year': Y, 'h': h}
                for conv in ('curt', 'all'):
                    row[conv] = {}
                    for var in VARIANTS:
                        fm = m_fpc_v(t, Y, train, V, conv, var)
                        row[conv][var] = (L.score(fm, act, conv) or {}).get('eur')
                out['rows'].append(row)
                print(tech, Y, f'h={h}', 'curt', ' '.join(f"{k} {v:+.2f}" for k, v in row['curt'].items() if v is not None), flush=True)
    # bias: base minus its mean error on the years whose outcome was known when Y was priced (h = 1 rows, year ≤ Y − h)
    for r in out['rows']:
        for conv in ('curt', 'all'):
            past = [x[conv]['base'] for x in out['rows'] if x['tech'] == r['tech'] and x['h'] == 1 and x['year'] <= r['year'] - r['h'] and x[conv]['base'] is not None]
            r[conv]['bias'] = None if len(past) < 2 or r[conv]['base'] is None else r[conv]['base'] - float(np.mean(past))
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            for h in HORIZONS:
                rs = [r for r in out['rows'] if r['tech'] == tech and r['h'] == h and r['year'] >= 2024]
                out['mae'][f'{tech} {conv} h={h}'] = {k: [round(float(np.mean([abs(r[conv][k]) for r in rs])), 2), round(float(np.mean([r[conv][k] for r in rs])), 2)]
                                                     for k in VARIANTS + ('bias',) if rs and all(r[conv].get(k) is not None for r in rs)}
    for k, v in out['mae'].items():
        print('%-16s MAE (bias) ' % k + '  '.join(f'{m} {e[0]:.2f} ({e[1]:+.2f})' for m, e in v.items()))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
