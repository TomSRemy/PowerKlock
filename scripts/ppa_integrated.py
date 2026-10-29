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

Wind is anchored on the last 12 complete months instead of the last complete year (scripts/ppa_monthly_replay.py,
pricing dates every month 2018–2024: wind 2.40 → 2.22 €/MWh; solar worse, 3.06 → 3.52, so solar keeps the complete
year): the model of each of those months runs on its own year's fleet, demand and level, the delivery year at those 12
months' levels.

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


ANCHOR12 = {'s': False, 'w': True}


def last12():
    """the last 12 months with a full month of data (at least 28 days), oldest first"""
    out = []
    for y in sorted(L.DATA, reverse=True):
        a = L.DATA[y]
        for m in range(12, 0, -1):
            if len(out) < 12 and (a['month'] == m).sum() >= 28:
                out.append((y, m))
    return out[::-1]


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
        lvon = st['level'] != 'none'
        win = last12() if ANCHOR12[t] else [(A, m) for m in range(1, 13)]
        mods, acts = {}, {}
        for y in sorted({y for y, _ in win}):
            capy = {c: {tt: L.cap(c, tt, y) or L.cap_guess(c, tt, y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
            mods[y], _, _ = L.regional(t, y, past, pm, y, capy, 0, realised_month_levels(y) if lvon else None, st['regional'])
            acts[y] = L.actual(t, y)
        lvA = {m: realised_month_levels(y)[m] for y, m in win} if lvon else None
        for conv in ('curt', 'all'):
            ks = [(y, m) for y, m in win if m in acts[y] and acts[y][m][conv] is not None and m in mods[y] and mods[y][m][conv] is not None]
            w = {k: acts[k[0]][k[1]]['mwh'] * (acts[k[0]][k[1]]['paid'] if conv == 'curt' else 1) for k in ks}
            real = sum(w[k] * acts[k[0]][k[1]][conv] for k in ks) / sum(w.values())
            mod = sum(w[k] * mods[k[0]][k[1]][conv] for k in ks) / sum(w.values())
            info.setdefault(tech, {})[conv] = {'anchor': f'{win[0][0]}-{win[0][1]:02d}…{win[-1][0]}-{win[-1][1]:02d}', 'factor': round(real / mod, 4),
                                               'realised': round(real, 4), 'model': round(mod, 4)}
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
