#!/usr/bin/env python3
"""Batteries absorb the midday surplus and give it back in the evening. The European price model learns its table on
past years, whose batteries are in it; for a later year, only the batteries added since then are missing. Variant:
those are added to the region's residual load, one daily cycle (charge in the lowest hours, 85 % back in the highest):
France beyond the ~0.7 GW serving reserves (RTE Bilan prévisionnel 2025, socle +0.3 GW a year, 2 h; then +5 GW by
2035, 4 h), Germany from Energy-Charts' fleet, counted at 50 %.
Protocol as scripts/ppa_horizon_test.py (2024–2026, 1, 2 and 3 years ahead, both conventions); adoption: lower
mean error over h1–h3 in the curtailed convention.

Writes data/history/ppa_storage_test.json
    python scripts/ppa_storage_test.py
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

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_storage_test.json')


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
                for vn in ('base', 'batt'):
                    L.STORAGE['on'] = vn == 'batt'
                    m4, _, _ = L.regional(t, Y, known, pm, last, capY, 0, lv, st['regional'])
                    row[vn] = {conv: (L.score({m: m4[m][conv] for m in m4 if m4[m][conv] == m4[m][conv]}, act, conv) or {}).get('eur') for conv in ('curt', 'all')}
                L.STORAGE['on'] = False
                rows.append(row)
                print(tech, Y, h, row, flush=True)
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows, 'mae': {}}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            m = {vn: [float(np.mean([abs(r[vn][conv]) for r in rows if r['tech'] == tech and r['h'] == h])) for h in (1, 2, 3)] for vn in ('base', 'batt')}
            out['mae'][f'{tech} {conv}'] = m
            print(f"{tech:5s} {conv:4s}: base {'/'.join(f'{x:.2f}' for x in m['base'])} (mean {np.mean(m['base']):.2f}) → batteries {'/'.join(f'{x:.2f}' for x in m['batt'])} (mean {np.mean(m['batt']):.2f})")
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
