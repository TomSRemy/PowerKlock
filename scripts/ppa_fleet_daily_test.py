#!/usr/bin/env python3
"""Installed capacity through the year: the published fleets are year-end values; the European model and the weather
simulation put the delivery year's year-end fleet on every day of it (about half a year's growth too much: solar 2027
42.3 GW against 39.4 on average), and the European model divided a past weather year's output by its year-end fleet
(the early months' load factors too low). Variant: day by day, linearly from the previous year-end to the year-end
(ppa_lab FLEET_DAILY, ppa_backtest_detail WX_FLEET_DAILY).
Protocol as scripts/ppa_horizon_test.py: complete delivery years 2019–2025 (2022 left out) priced 1, 2 and 3 years
ahead, output stopped at prices <= 0, error on the value of one MWh (€/MWh); adoption: lower mean error.

Writes data/history/ppa_fleet_daily_test.json
    python scripts/ppa_fleet_daily_test.py
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

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_fleet_daily_test.json')


def main():
    settings = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    rows = []
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Y in (2019, 2020, 2021, 2023, 2024, 2025):
            act = L.actual(t, Y)
            for h in (1, 2, 3):
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                last = max(known)
                tr = [y for y in known if st['with2022'] or y != 2022][-st['window']:]
                pm = L.PriceModel(tr, st['regional'], 'mean', st['level'] != 'none')
                capY = {c: {tt: L.cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = L.levels_for(Y, 'forward') if st['level'] == 'forward' else {m: float(L.DATA[last]['fr_p'][L.DATA[last]['month'] == m].mean()) for m in range(1, 13)}
                row = {'tech': tech, 'year': Y, 'h': h}
                for vn in ('yearend', 'daily'):
                    L.FLEET_DAILY['on'] = BD.WX_FLEET_DAILY = vn == 'daily'
                    m4, _, _ = L.regional(t, Y, known, pm, last, capY, 0, lv, st['regional'])
                    _, wmc, _ = BD.m_weather(t, Y, train, V, 40)
                    row[vn] = {'eu': (L.score({m: m4[m]['curt'] for m in m4 if m4[m]['curt'] == m4[m]['curt']}, act, 'curt') or {}).get('eur'),
                               'wx': (L.score(wmc['curt'], act, 'curt') or {}).get('eur')}
                rows.append(row)
                print(tech, Y, h, row, flush=True)
    L.FLEET_DAILY['on'] = BD.WX_FLEET_DAILY = True
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows, 'mae': {}}
    for tech in ('solar', 'wind'):
        for k in ('eu', 'wx'):
            m = {vn: (float(np.mean([abs(r[vn][k]) for r in rows if r['tech'] == tech])), float(np.mean([r[vn][k] for r in rows if r['tech'] == tech]))) for vn in ('yearend', 'daily')}
            out['mae'][f'{tech} {k}'] = m
            print(f"{tech:5s} {k}: year-end MAE {m['yearend'][0]:.2f} (bias {m['yearend'][1]:+.2f}) → daily MAE {m['daily'][0]:.2f} (bias {m['daily'][1]:+.2f})")
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
