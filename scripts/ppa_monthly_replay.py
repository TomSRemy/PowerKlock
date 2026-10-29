#!/usr/bin/env python3
"""Monthly-origin replay (Tom 29 Oct. 2026: more points to decide; anchor on the last 12 months). The yearly replay
prices each delivery year once, at the end of a complete year (6 to 15 points per decision). Here the pricing date T
runs over the first day of every month, 2019–2025; what is known at T: the complete years before T's year (price
tables, trends, weather) and the realised months before T (the anchor). Delivery years Y = T's year + 1 to + 3,
complete, 2022 left out; output stopped at prices <= 0; error on the value of one MWh (€/MWh, production-weighted).
Methods (h = Y − T's year):
  anc_A     integrated, anchored on the last complete year (today's): realised(A) × model(Y) ÷ model(A)
  anc_12    integrated, anchored on the 12 months before T: realised(12 m) × model(Y) ÷ model(12 m), the model of
            each month on its own year's fleet and demand, Y modelled at the 12 months' price levels
  step_A    capacity trend (test bench), anchored on the last complete year
  step_12   capacity trend anchored on the 12 months before T (its capture moved by the gap between the 12 months
            and the last complete year, same data)
  wx        weather simulation (test bench)
  int_A / int_12   the pricer's integrated method: wind = anc; solar = mean of anc, step and wx (same anchor for both)
The points within a year share their complete-year inputs, so they are correlated: n is larger, not independent.

Writes data/history/ppa_monthly_replay.json
    python scripts/ppa_monthly_replay.py
"""
import json
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

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_monthly_replay.json')
CONV = 'curt'
TARGETS = [y for y in range(2019, 2026) if y != 2022]
VARIANTS = ('anc_A', 'anc_12', 'step_A', 'step_12', 'wx', 'int_A', 'int_12')


def levels_of(y):
    a = L.DATA[y]
    return {m: float(a['fr_p'][a['month'] == m].mean()) for m in range(1, 13) if (a['month'] == m).any()}


def window(Ty, M):
    """the 12 (year, month) before the first day of month M of year Ty"""
    out = []
    y, m = Ty, M
    for _ in range(12):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append((y, m))
    return out[::-1]


def realised_rate(t, months):
    """curtailed capture of the hours of these (year, month), from the lab's hourly data"""
    num = den = ps = pn = 0.0
    for y, m in months:
        a = L.DATA[y]
        k = a['month'] == m
        P, V = a['fr_p'][k].ravel(), a['fr_' + t][k].ravel()
        pos = P > 0
        num += (V[pos] * P[pos]).sum(); den += V[pos].sum(); ps += P.sum(); pn += P.size
    return num / den / (ps / pn)


def main():
    settings = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    rows = []
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Ty in range(2018, 2025):
            known = [y for y in L.DATA if y < Ty and L.DATA[y]['complete']]
            train = [y for y in known if y != 2022]
            if len(train) < 3:
                continue
            A = max(known)
            pm = L.PriceModel([y for y in known if st['with2022'] or y != 2022][-st['window']:], st['regional'], 'mean', st['level'] != 'none')
            lvon = st['level'] != 'none'
            mcache = {}

            def model(y, lv_key, lv):
                """the European model for year y; a past or current year on its own fleet and demand"""
                key = (y, lv_key)
                if key not in mcache:
                    if y <= Ty:
                        cap = {c: {tt: L.cap(c, tt, y) or L.cap_guess(c, tt, y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                        dy = y if y in L.DATA else A
                    else:
                        cap = {c: {tt: L.cap_guess(c, tt, y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                        dy = A
                    m4, _, _ = L.regional(t, y, known, pm, dy, cap, 0, lv if lvon else None, st['regional'])
                    mcache[key] = {m: m4[m][CONV] for m in m4 if m4[m][CONV] is not None}
                return mcache[key]
            # complete-year inputs, shared by every month of Ty
            mA = model(A, 'own', levels_of(A))
            rA = L.actual(t, A)
            wA = {m: rA[m]['mwh'] * rA[m]['paid'] for m in rA}
            fA = sum(wA[m] * rA[m][CONV] for m in rA if m in mA) / sum(wA[m] * mA[m] for m in rA if m in mA)
            rateA_L = realised_rate(t, [(A, m) for m in range(1, 13)])
            step_r = {}
            wx = {}
            for Y in TARGETS:
                if not 1 <= Y - Ty <= 3:
                    continue
                stp = BD.m_step(t, Y, train, V, CONV)
                step_r[Y] = stp
                _, wmc, _ = BD.m_weather(t, Y, train, V, 40)
                wx[Y] = wmc[CONV]
            for M in range(1, 13):
                win = window(Ty, M)
                if any(y not in L.DATA for y, _ in win):
                    continue
                lv12 = {m: float(L.DATA[y]['fr_p'][L.DATA[y]['month'] == m].mean()) for y, m in win}
                # model of the window: each month from its own year's model at its own levels
                mw = {}
                for y, m in win:
                    mw[(y, m)] = model(y, 'own', levels_of(y)).get(m)
                rw = {}
                for y in {y for y, _ in win}:
                    a = L.actual(t, y)
                    for yy, m in win:
                        if yy == y and m in a:
                            rw[(y, m)] = a[m]
                ks = [k for k in win if k in rw and mw.get(k) is not None and rw[k][CONV] is not None]
                ww = {k: rw[k]['mwh'] * rw[k]['paid'] for k in ks}
                f12 = sum(ww[k] * rw[k][CONV] for k in ks) / sum(ww[k] * mw[k] for k in ks)
                rate12_L = realised_rate(t, win)
                for Y in step_r:
                    act = L.actual(t, Y)
                    mY_A = model(Y, ('lv', A), levels_of(A))
                    mY_12 = model(Y, ('lv', Ty, M), lv12)
                    P = {'anc_A': {m: v * fA for m, v in mY_A.items()},
                         'anc_12': {m: v * f12 for m, v in mY_12.items()},
                         'step_A': {m: step_r[Y] for m in range(1, 13)},
                         'step_12': {m: step_r[Y] + (rate12_L - rateA_L) for m in range(1, 13)},
                         'wx': wx[Y]}
                    for an in ('A', '12'):
                        if t == 'w':
                            P['int_' + an] = P['anc_' + an]
                        else:
                            P['int_' + an] = {m: (P['anc_' + an][m] + P['step_' + an][m] + P['wx'][m]) / 3 for m in P['anc_' + an] if P['wx'].get(m) is not None}
                    rows.append({'tech': tech, 'Ty': Ty, 'M': M, 'Y': Y, 'h': Y - Ty,
                                 'err': {vn: (L.score(P[vn], act, CONV) or {}).get('eur') for vn in VARIANTS}})
            print(tech, Ty, 'done', len(rows), flush=True)
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows, 'mae': {}}
    for tech in ('solar', 'wind'):
        for scope, ok in (('all', lambda r: True), ('Y>=2024', lambda r: r['Y'] >= 2024)):
            rs = [r for r in rows if r['tech'] == tech and ok(r)]
            out['mae'][f'{tech} {scope}'] = dict({vn: round(float(np.mean([abs(r['err'][vn]) for r in rs])), 2) for vn in VARIANTS}, n=len(rs))
            print(tech, scope, out['mae'][f'{tech} {scope}'])
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
