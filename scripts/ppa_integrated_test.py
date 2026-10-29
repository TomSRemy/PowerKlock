#!/usr/bin/env python3
"""An integrated method (Tom, 29 Oct. 2026: one methodology mixing the best of each): the level comes from the realised
capture of the last complete year A (the capacity trend's strength: no model level error), the change from A to the
delivery year Y from the European price model (hourly prices from the residual load of France and its neighbours, the
fleets of Y, batteries, calendar, the month's price level, every past weather year), i.e.
    capture(Y) = realised(A) × model(Y) ÷ model(A)
with model(A) the same model on A's own fleet and demand. No bias correction: the model only measures a change.
Variants of the anchor:
  eu       the European model alone (reference)
  anc_m    month by month: realised(A, m) × model(Y, m) ÷ model(A, m)
  anc_s    per season (April–September, October–March): the model's months × realised(A, season) ÷ model(A, season)
  anc_y    per year: the model's months × realised(A) ÷ model(A)
  anc2_y   per year, the ratio averaged on A and A − 1
  anc_lvA  per year, the delivery year modelled at A's monthly price levels (the change from the fleets and demand only)
  mix      half anc_y, half the capacity trend
  wx       the weather simulation alone (test bench version)
  trio     the mean of anc_y, the capacity trend and the weather simulation
  trio_lvA the same with anc_lvA
Protocol as scripts/ppa_horizon_test.py (priced 1, 2, 3 years ahead, output stopped at prices <= 0), scored on complete
delivery years from 2019 (2022 left out) and on 2024–2025 apart; compared with the capacity trend and the published
average's replay (scripts/ppa_weights.py check).

Writes data/history/ppa_integrated_test.json
    python scripts/ppa_integrated_test.py
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

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_integrated_test.json')
VARIANTS = ('eu', 'anc_m', 'anc_s', 'anc_y', 'anc2_y', 'anc_lvA', 'mix', 'step', 'wx', 'trio', 'trio_lvA')
SUMMER = set(range(4, 10))
CONV = 'curt'


def wmean(d, w, months):
    ms = [m for m in months if d.get(m) is not None and w.get(m)]
    return sum(w[m] * d[m] for m in ms) / sum(w[m] for m in ms) if ms else None


def model(t, Y, known, st, demand_year, capY, lv):
    tr = [y for y in known if st['with2022'] or y != 2022][-st['window']:]
    pm = L.PriceModel(tr, st['regional'], 'mean', st['level'] != 'none')
    m4, _, _ = L.regional(t, Y, known, pm, demand_year, capY, 0, lv, st['regional'])
    return {m: m4[m][CONV] for m in m4 if m4[m][CONV] == m4[m][CONV]}


def levels(Y, st, last):
    if st['level'] == 'forward':
        return L.levels_for(Y, 'forward')
    if st['level'] == 'lastyear':
        return {m: float(L.DATA[last]['fr_p'][L.DATA[last]['month'] == m].mean()) for m in range(1, 13)}
    return None


def main():
    settings = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    rows = []
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        cache = {}
        for Y in (2019, 2020, 2021, 2023, 2024, 2025, 2026):
            if Y not in L.DATA:
                continue
            act = L.actual(t, Y)
            for h in (1, 2, 3):
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                A = max(known)
                capY = {c: {tt: L.cap_guess(c, tt, Y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                mY = model(t, Y, known, st, A, capY, levels(Y, st, A))

                def anchor_model(a):
                    """the model on year a's own fleet and demand, the price table learnt on the years known when pricing"""
                    key = (a, A)
                    if key not in cache:
                        capA = {c: {tt: L.cap(c, tt, a) or L.cap_guess(c, tt, a, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                        cache[key] = model(t, a, known, st, a, capA, levels(a, st, a - 1 if a - 1 in L.DATA else a))
                    return cache[key]
                mA = anchor_model(A)
                rA = L.actual(t, A)
                wA = {m: rA[m]['mwh'] * rA[m]['paid'] for m in rA}
                realA = {m: rA[m][CONV] for m in rA}
                P = {'eu': mY}
                P['anc_m'] = {m: realA[m] * mY[m] / mA[m] for m in mY if m in mA and realA.get(m) and mA[m]}
                P['anc_s'] = {}
                for ms in (SUMMER, set(range(1, 13)) - SUMMER):
                    f = wmean(realA, wA, ms) / wmean(mA, wA, ms)
                    P['anc_s'].update({m: mY[m] * f for m in ms if m in mY})
                fy = wmean(realA, wA, range(1, 13)) / wmean(mA, wA, range(1, 13))
                P['anc_y'] = {m: v * fy for m, v in mY.items()}
                f2 = [fy]
                a2 = A - 1 if A - 1 != 2022 else A - 2
                if a2 in L.DATA and L.DATA[a2]['complete'] and a2 in known:
                    r2 = L.actual(t, a2); w2 = {m: r2[m]['mwh'] * r2[m]['paid'] for m in r2}
                    m2 = anchor_model(a2)
                    f2.append(wmean({m: r2[m][CONV] for m in r2}, w2, range(1, 13)) / wmean(m2, w2, range(1, 13)))
                P['anc2_y'] = {m: v * float(np.mean(f2)) for m, v in mY.items()}
                mYa = model(t, Y, known, st, A, capY, levels(A, st, A - 1 if A - 1 in L.DATA else A))
                P['anc_lvA'] = {m: v * fy for m, v in mYa.items()}
                _, wmc, _ = BD.m_weather(t, Y, train, V, 40)
                P['wx'] = wmc[CONV]
                stp = BD.m_step(t, Y, train, V, CONV)
                P['step'] = {m: stp for m in range(1, 13)}
                P['mix'] = {m: 0.5 * P['anc_y'][m] + 0.5 * stp for m in mY}
                P['trio'] = {m: (P['anc_y'][m] + stp + P['wx'][m]) / 3 for m in mY if P['wx'].get(m) is not None}
                P['trio_lvA'] = {m: (P['anc_lvA'][m] + stp + P['wx'][m]) / 3 for m in mYa if P['wx'].get(m) is not None and m in P['anc_lvA']}
                row = {'tech': tech, 'year': Y, 'h': h, 'complete': bool(L.DATA[Y]['complete']),
                       'err': {vn: (L.score(P[vn], act, CONV) or {}).get('eur') for vn in VARIANTS},
                       'cap': {vn: wmean(P[vn], {m: act[m]['mwh'] * act[m]['paid'] for m in act}, range(1, 13)) for vn in VARIANTS},
                       'real': wmean({m: act[m][CONV] for m in act}, {m: act[m]['mwh'] * act[m]['paid'] for m in act}, range(1, 13))}
                rows.append(row)
                print(tech, Y, h, 'real %.3f' % row['real'], ' '.join(f"{vn} {row['cap'][vn]:.3f}({row['err'][vn]:+.1f})" for vn in VARIANTS), flush=True)
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows, 'mae': {}}
    for tech in ('solar', 'wind'):
        for scope, ok in (('2019-2025', lambda r: r['complete']), ('2024-2025', lambda r: r['complete'] and r['year'] >= 2024), ('2024-2026', lambda r: r['year'] >= 2024)):
            rs = [r for r in rows if r['tech'] == tech and ok(r)]
            out['mae'][f'{tech} {scope}'] = {vn: round(float(np.mean([abs(r['err'][vn]) for r in rs])), 2) for vn in VARIANTS}
            out['mae'][f'{tech} {scope}']['n'] = len(rs)
            print(tech, scope, out['mae'][f'{tech} {scope}'])
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
