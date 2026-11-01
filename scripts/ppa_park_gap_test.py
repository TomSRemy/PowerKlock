#!/usr/bin/env python3
"""A park's capture next year: from its own history, or from the national capture + the park's gap to it?

Tom (1 Nov. 2026): "test the pricers for a park, with the national and without". With no metered park at hand, the
French regions (RTE output × day-ahead, data/history/fr_regional_capture.json) stand for large parks with their own
profile. Each complete year Y from 2019 (2022 and 2023 left out: the crisis year and the year after it read nothing
normal) is predicted with only the years before it, then compared with the realised capture rate ('curt').

Result (1 Nov. 2026), mean absolute error in capture points (bias: + = too optimistic):
    solar (54 cases)  park last year 5.49 (+5.33) · park mean 3 y 7.15 · park trend 4 y 5.59
                      national (realised) + gap last year 1.03 · + gap mean 3 y 1.19
    wind  (52 cases)  park last year 2.29 · park mean 3 y 1.77 · park trend 4 y 2.54
                      national (realised) + gap last year 1.70 · + gap mean 3 y 1.51
The park's own history misses the cannibalisation to come (solar: 5 points too high a year ahead); its gap to the
national is stable. With the generator's own error on the national (0.7–0.9 points a year ahead) the national + gap
approach stays well ahead for solar and about equal for wind. The pricer uses it (js/tool-ppa.js euYears: the asset's
mean gap over its last three complete years).
    python scripts/ppa_park_gap_test.py
"""
import json
import os

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    d = json.load(open(os.path.join(ROOT, 'data', 'history', 'fr_regional_capture.json')))
    nat = d['national']

    def cap(o, y, t):
        v = o['years'].get(str(y), {}).get(t)
        return v.get('curt') if v and v.get('complete', True) else None

    for t in ('solar', 'wind'):
        E = {k: [] for k in ('park: last year', 'park: mean 3 y', 'park: trend 4 y', 'national + gap last year',
                             'national + gap mean 3 y', 'national last year (no gap)')}
        for r in d['regions'].values():
            for Y in range(2019, 2026):
                if Y in (2022, 2023):
                    continue
                past = [y for y in range(2016, Y) if y != 2022 and cap(r, y, t) is not None and cap(nat, y, t) is not None]
                if len(past) < 3 or cap(r, Y, t) is None or cap(nat, Y, t) is None:
                    continue
                if r['years'][str(Y)][t].get('twh', 0) < (0.2 if t == 'solar' else 0.3):
                    continue   # too small a fleet that year to stand for a park
                real, last, p3 = cap(r, Y, t), past[-1], past[-3:]
                gap = lambda y: cap(r, y, t) - cap(nat, y, t)
                yy = np.array(past[-4:])
                trend = np.polyval(np.polyfit(yy, [cap(r, y, t) for y in yy], 1), Y)
                pred = {'park: last year': cap(r, last, t), 'park: mean 3 y': np.mean([cap(r, y, t) for y in p3]),
                        'park: trend 4 y': trend, 'national + gap last year': cap(nat, Y, t) + gap(last),
                        'national + gap mean 3 y': cap(nat, Y, t) + np.mean([gap(y) for y in p3]),
                        'national last year (no gap)': cap(nat, last, t)}
                for k, v in pred.items():
                    E[k].append((v - real) * 100)
        print(t, 'cases', len(E['park: last year']))
        for k, v in E.items():
            v = np.array(v)
            print(f'  {k:30s} MAE {np.abs(v).mean():5.2f} pts  bias {v.mean():+5.2f}')


if __name__ == '__main__':
    main()
