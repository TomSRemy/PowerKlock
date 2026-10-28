#!/usr/bin/env python3
"""Price of an hour against the solar (wind) share of French consumption in that hour, year by year.

For every hour since 2016: penetration = national solar (wind) output ÷ consumption (RTE éCO2mix), relative price =
the hour's day-ahead price ÷ the average price of its month (ENTSO-E). Hours are grouped by penetration band and the
mean relative price of each band is kept per year (a band needs 30 hours). Read on the site as one line per year:
how much an hour loses as solar covers more of the demand, and how that link moves from one year to the next
(neighbours, nuclear, gas, storage and curtailment at negative prices all shift it).

Reads data/history/fr_hourly/YYYY.json, writes data/history/penetration_curve.json
    python scripts/build_penetration_curve.py
"""
import glob
import json
import os
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'penetration_curve.json')
BANDS = {'solar': [0, .02, .05, .1, .15, .2, .25, .3, .35, .4, .45, .5, .55, .6],
         'wind': [0, .05, .1, .15, .2, .25, .3, .35, .4, .45, .5, .55, .6],
         # France + Germany + Belgium + Spain: solar + wind + nuclear ÷ consumption (the price model's region)
         'region': [0, .2, .3, .4, .5, .6, .7, .8, .9, 1, 1.1, 1.2, 1.4]}
NEIGH = ('DE', 'BE', 'ES')
MIN_H = 30
POINTS = 1000          # hours kept per year for the scatter (evenly spaced), the last four years


def main():
    out = {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
           'source': 'RTE éCO2mix (national output and consumption) · ENTSO-E day-ahead (France)',
           'bands': BANDS, 'years': {}}
    for f in sorted(glob.glob(os.path.join(H, 'fr_hourly', '[0-9]' * 4 + '.json'))):
        y = int(os.path.basename(f)[:4])
        days = json.load(open(f))['days']
        ok = {d: v for d, v in days.items() if all(v.get(k) and len(v[k]) == 24 and None not in v[k] for k in 'pslw')}
        if len(ok) < 28:
            continue
        mon = {}
        for d, v in ok.items():
            a = mon.setdefault(d[5:7], [0.0, 0])
            a[0] += sum(v['p']); a[1] += 24
        row = {'hours': len(ok) * 24, 'complete': len(ok) >= 340 and y < date.today().year, 'to': max(ok)}
        # the coupled region's coverage by solar, wind and nuclear, hour by hour (a neighbour's missing series counts 0)
        try:
            rg = json.load(open(os.path.join(H, 'region_hourly', f'{y}.json')))['countries']
        except OSError:
            rg = {}
        def rv(c, t, d, h):
            a = rg.get(c, {}).get(t, {}).get(d)
            return (a[h] or 0) if a else 0
        reg_ok = all(c in rg for c in NEIGH)
        for d, v in ok.items():
            v['r'] = [((v['s'][h] + v['w'][h] + v['n'][h] + sum(rv(c, t, d, h) for c in NEIGH for t in 'swn'))
                       / (v['l'][h] + sum(rv(c, 'l', d, h) for c in NEIGH))) if reg_ok and v.get('n') and None not in v['n'] else None for h in range(24)]
        for tech, k in (('solar', 's'), ('wind', 'w'), ('region', 'r')):
            b = BANDS[tech]
            acc = [[0.0, 0] for _ in range(len(b) - 1)]
            for d, v in ok.items():
                lvl = mon[d[5:7]][0] / mon[d[5:7]][1]
                if lvl <= 0:
                    continue
                for h in range(24):
                    x = (v[k][h] if k == 'r' else v[k][h] / v['l'][h] if v['l'][h] else None)
                    if x is None:
                        continue
                    i = next((j for j in range(len(b) - 1) if b[j] <= x < b[j + 1]), None)
                    if i is None:
                        continue
                    acc[i][0] += v['p'][h] / lvl
                    acc[i][1] += 1
            row[tech] = [round(s / n, 3) if n >= MIN_H else None for s, n in acc]
            # the scatter: hours with some output (solar: daylight), evenly spaced through the year
            pts = []
            for d in sorted(ok):
                v = ok[d]
                lvl = mon[d[5:7]][0] / mon[d[5:7]][1]
                if lvl <= 0:
                    continue
                for h in range(24):
                    x = (v[k][h] if k == 'r' else v[k][h] / v['l'][h] if v['l'][h] else None)
                    if x is not None and (k == 'r' or x > 0.01):
                        pts.append([round(x, 3), round(v['p'][h] / lvl, 3)])
            step = max(1, len(pts) // POINTS)
            row[tech + 'Pts'] = pts[::step][:POINTS]
            row[tech + 'N'] = [n for _, n in acc]
        out['years'][str(y)] = row
        print(y, row['hours'], 'solar', row['solar'])
    for y in sorted(out['years'])[:-4]:   # the scatter keeps the last four years only
        for tech in ('solar', 'wind', 'region'):
            out['years'][y].pop(tech + 'Pts', None)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
