#!/usr/bin/env python3
"""Capacity trend, French or European fleet: which installed capacity explains the French capture rate best?

The capacity trend prices a year with   capture = a + b × ln(x)   fitted on the past years and anchored on the
last one. Today x is France's installed GW. But the French midday price is set with the neighbours (coupled
markets share one price most hours), so their solar should count too. Variants of x, everything else equal:

  fr        France's installed GW (the method as published)
  eu_sum    GW of France + Germany + Belgium + Spain (the European price model's region), each GW counts once
  eu_pen    the same GW ÷ the region's average load (GW of solar or wind per GW of demand: a big country's GW
            weighs by its demand, not by its size alone)
  eu_cpl    France's GW + each neighbour's GW × its coupling with France = the share of hours its day-ahead price
            was within 1 €/MWh of the French one, measured on the training years only (prices since 2020;
            before that the variant has no weights and is not scored)

Protocol as scripts/ppa_horizon_test.py: each delivery year Y priced 1, 2 and 3 years ahead with the complete
years up to Y − h (2022 left out), the fleets of Y extrapolated from their last two known years; score =
production-weighted error on the value of one MWh (€/MWh), both conventions; verdict on 2024–2026 (2026 to date).

Writes data/history/ppa_capacity_eu_test.json
    python scripts/ppa_capacity_eu_test.py
"""
import glob
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
OUT = os.path.join(H, 'ppa_capacity_eu_test.json')
TARGETS = [2021, 2023, 2024, 2025, 2026]
HORIZONS = (1, 2, 3)
REGION = ('FR',) + L.NEIGH                          # FR, DE, BE, ES
ZONE = {'DE': 'DE_LU', 'BE': 'BE', 'ES': 'ES'}
VARIANTS = ('fr', 'eu_sum', 'eu_pen', 'eu_cpl')


def coupling():
    """per year and neighbour: hours priced within 1 €/MWh of France, and hours compared"""
    out = {}
    for f in sorted(glob.glob(os.path.join(H, 'daily', '20*.json'))):
        y = int(os.path.basename(f)[:4])
        z = json.load(open(f))['zones']
        fr = z.get('FR', {}).get('hourly')
        if not fr:
            continue
        def hr(a):   # hourly means of the slots that have a price (96 quarter-hours or 24 hours a day; 23 / 25 on clock changes are skipped)
            if len(a) % 24:
                return None
            k = len(a) // 24
            return [(lambda v: sum(v) / len(v) if v else None)([x for x in a[i:i + k] if x is not None]) for i in range(0, len(a), k)]
        frh = hr(fr)
        for c, zn in ZONE.items():
            h = z.get(zn, {}).get('hourly')
            if not h or not frh:
                continue
            ch = hr(h)
            if not ch or len(ch) != len(frh):
                continue
            e = out.setdefault(y, {}).setdefault(c, [0, 0])
            e[0] += sum(1 for a, b in zip(ch, frh) if a is not None and b is not None and abs(a - b) <= 1.0)
            e[1] += len(ch)
    return out


CPL = coupling()


def weights(train):
    """coupling share of each neighbour over the training years that have prices; None without any"""
    w = {}
    for c in ZONE:
        n = sum(CPL[y][c][0] for y in train if y in CPL and c in CPL[y])
        d = sum(CPL[y][c][1] for y in train if y in CPL and c in CPL[y])
        if not d:
            return None
        w[c] = n / d
    return w


def load_gw(c, y):
    a = L.DATA.get(y)
    if a is None:
        return None
    return float(a[('fr' if c == 'FR' else c) + '_l'].mean()) / 1000


def x_of(var, t, gw, load, w):
    """the capacity measure of one year from its GW by country (and loads, coupling weights)"""
    if var == 'fr':
        return gw['FR']
    if var == 'eu_sum':
        return sum(gw[c] for c in REGION)
    if var == 'eu_pen':
        return sum(gw[c] for c in REGION) / sum(load[c] for c in REGION)
    if var == 'eu_cpl':
        return None if w is None else gw['FR'] + sum(w[c] * gw[c] for c in ZONE)


def trend(var, t, Y, train, V, conv, last):
    r = [BD.rate(BD.yr == y, V, BD.P, conv) for y in train]
    w = weights(train) if var == 'eu_cpl' else None
    xs = []
    for y in train:
        gw = {c: L.cap(c, t, y) for c in REGION}
        ld = {c: load_gw(c, y) for c in REGION}
        if any(v is None for v in gw.values()) or (var == 'eu_pen' and any(v is None for v in ld.values())):
            return None
        xs.append(x_of(var, t, gw, ld, w))
    if any(x is None or x <= 0 for x in xs):
        return None
    gwY = {c: L.cap_guess(c, t, Y, last) for c in REGION}
    ldY = {c: load_gw(c, last) for c in REGION}           # demand of the target year: the last known one
    xY, xL = x_of(var, t, gwY, ldY, w), xs[train.index(last)] if last in train else None
    if xY is None or xL is None:
        return None
    b = B.logfit(xs, r)
    return r[train.index(last)] + b * (math.log(xY) - math.log(xL)), b


def main():
    out = {'coupling': {y: {c: round(v[0] / v[1], 3) for c, v in d.items()} for y, d in CPL.items()}, 'rows': []}
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
                last = train[-1]
                row = {'tech': tech, 'year': Y, 'h': h, 'lastKnown': last}
                for conv in ('curt', 'all'):
                    row[conv], row[conv + '_b'] = {}, {}
                    for var in VARIANTS:
                        res = trend(var, t, Y, train, V, conv, last)
                        if res is None:
                            continue
                        v, b = res
                        row[conv][var] = (L.score({m: v for m in range(1, 13)}, act, conv) or {}).get('eur')
                        row[conv + '_b'][var] = round(b, 4)
                    if conv == 'curt':   # the published method, as the test bench computes it: the 'fr' variant must match
                        ref = BD.m_step(t, Y, train, V, conv)
                        row['check_fr'] = round((L.score({m: ref for m in range(1, 13)}, act, conv) or {}).get('eur') or 0, 4)
                out['rows'].append(row)
                print(tech, Y, f'h={h}', 'curt', ' '.join(f"{k} {v:+.2f}" for k, v in row['curt'].items() if v is not None),
                      '| check fr', row['check_fr'], flush=True)
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            for h in HORIZONS:
                rs = [r for r in out['rows'] if r['tech'] == tech and r['h'] == h and r['year'] >= 2024]
                out['mae'][f'{tech} {conv} h={h}'] = {k: round(float(np.mean([abs(r[conv][k]) for r in rs])), 2)
                                                     for k in VARIANTS if rs and all(r[conv].get(k) is not None for r in rs)}
                out['mae'][f'{tech} {conv} h={h}']['n'] = len(rs)
    for k, v in out['mae'].items():
        print('%-18s 2024-2026 MAE  ' % k + ' '.join(f'{m} {e}' for m, e in v.items()))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
