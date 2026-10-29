#!/usr/bin/env python3
"""The integrated method's monthly captures for the pricer (Tom, 29 Oct. 2026: one methodology mixing the best of each).

    capture(Y, m) = model(Y, m) × realised(A) ÷ model(A)
A = the last complete year; model = the European price model (scripts/ppa_lab.py regional: hourly prices from the
residual load of France and its neighbours, every past weather year, the batteries to come, the calendar), run for
the delivery year Y on Y's fleets with A's demand and A's monthly price levels, and for A on A's own fleets, demand and
levels; realised(A) = A's realised capture (production-weighted, each convention). So the level is the realised one
and the model only gives the change from A to Y that the fleets bring, at the same price level (the market level is
then the Cal and the quoted months, as in every method). No bias correction.
In the pricer: wind = this capture; solar = the mean of the prices of this capture, the capacity trend and the weather
simulation (scripts/ppa_integrated_test.py, complete delivery years 2019–2025 without 2022, 1 to 3 years ahead, output
stopped at prices <= 0: wind 1.49 €/MWh mean error against 2.01 for the published average with its corrections, solar
1.68 against 1.86; on 2024–2025 alone wind 1.07 against 1.73, solar 1.46 against 1.25).

Adds 'anchored' to every month of data/history/ppa_forecast.json (both conventions) and 'anchored' = {tech: {conv:
{lastYear, factor}}} at its top. Run after scripts/ppa_lab.py.
    python scripts/ppa_integrated.py
"""
import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
sys.argv = _argv

F = os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')


def realised_month_levels(y):
    a = L.DATA[y]
    return {m: float(a['fr_p'][a['month'] == m].mean()) for m in range(1, 13) if (a['month'] == m).any()}


def main():
    fc = json.load(open(F))
    settings = fc['settings']
    past = [y for y in L.DATA if L.DATA[y]['complete']]
    A = max(past)
    this = date.today()
    info = {}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        pm = L.PriceModel([y for y in past if st['with2022'] or y != 2022][-st['window']:], st['regional'], 'mean', st['level'] != 'none')
        lvA = realised_month_levels(A) if st['level'] != 'none' else None
        capA = {c: {tt: L.cap(c, tt, A) or L.cap_guess(c, tt, A, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
        mA, _, _ = L.regional(t, A, past, pm, A, capA, 0, lvA, st['regional'])
        act = L.actual(t, A)
        for conv in ('curt', 'all'):
            w = {m: act[m]['mwh'] * (act[m]['paid'] if conv == 'curt' else 1) for m in act}
            ms = [m for m in act if act[m][conv] is not None and m in mA and mA[m][conv] is not None]
            real = sum(w[m] * act[m][conv] for m in ms) / sum(w[m] for m in ms)
            mod = sum(w[m] * mA[m][conv] for m in ms) / sum(w[m] for m in ms)
            info.setdefault(tech, {})[conv] = {'lastYear': A, 'factor': round(real / mod, 4), 'realised': round(real, 4), 'model': round(mod, 4)}
        for Y in range(this.year, 2031):
            capY = {c: {tt: L.cap_future(c, tt, Y) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
            mY, _, _ = L.regional(t, Y, past, pm, A, capY, 0, lvA, st['regional'])
            for conv in ('curt', 'all'):
                f = info[tech][conv]['factor']
                for m in range(1, 13):
                    e = fc['forecast'].get(tech, {}).get(conv, {}).get(f'{Y}-{m:02d}')
                    if e is not None and m in mY and mY[m][conv] is not None:
                        e['anchored'] = round(mY[m][conv] * f, 5)
            print('anchored', tech, Y, flush=True)
    fc['anchored'] = info
    print(info)
    with open(F, 'w') as f:
        json.dump(fc, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
