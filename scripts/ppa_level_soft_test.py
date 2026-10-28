#!/usr/bin/env python3
"""The European price model sorts months by their price level (below 60 €/MWh, 60–110, above) and learns one
table per class: a month that moves from 61 € to 59 € jumps to another table (summer 2028 quoted at 41 € against
69 € for 2027 made the model's output at prices ≤ 0 jump by 13 points in one year). Variant: a gradual change, the
two neighbouring classes blended linearly within ±15 €/MWh of each threshold.
Protocol as scripts/ppa_horizon_test.py (2024–2026, 1, 2 and 3 years ahead, both conventions); adoption: lower
mean error over h1–h3 in the curtailed convention.

Writes data/history/ppa_level_soft_test.json
    python scripts/ppa_level_soft_test.py
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_level_soft_test.json')


def main():
    settings = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    rows = []
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Y in (2024, 2025, 2026):
            act = L.actual(t, Y)
            for h in (1, 2, 3):
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                if len([y for y in known if y != 2022]) < 3:
                    continue
                last = max(known)
                tr = [y for y in known if st['with2022'] or y != 2022][-st['window']:]
                pm = L.PriceModel(tr, st['regional'], 'mean', st['level'] != 'none')
                capY = {c: {tt: L.cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = L.levels_for(Y, 'forward') if st['level'] == 'forward' else ({m: float(L.DATA[last]['fr_p'][L.DATA[last]['month'] == m].mean()) for m in range(1, 13)} if st['level'] == 'lastyear' else None)
                row = {'tech': tech, 'year': Y, 'h': h}
                for vn in ('base', 'soft'):
                    L.SOFT_LEVEL['on'] = vn == 'soft'
                    m4, _, _ = L.regional(t, Y, known, pm, last, capY, 0, lv, st['regional'])
                    row[vn] = {conv: (L.score({m: m4[m][conv] for m in m4 if m4[m][conv] == m4[m][conv]}, act, conv) or {}).get('eur') for conv in ('curt', 'all')}
                L.SOFT_LEVEL['on'] = False
                rows.append(row)
                print(tech, Y, h, row, flush=True)
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows, 'mae': {}}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            m = {vn: [float(np.mean([abs(r[vn][conv]) for r in rows if r['tech'] == tech and r['h'] == h])) for h in (1, 2, 3)] for vn in ('base', 'soft')}
            out['mae'][f'{tech} {conv}'] = m
            print(f"{tech:5s} {conv:4s}: base {'/'.join(f'{x:.2f}' for x in m['base'])} (mean {np.mean(m['base']):.2f}) → soft {'/'.join(f'{x:.2f}' for x in m['soft'])} (mean {np.mean(m['soft']):.2f})")
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
