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
         'wind': [0, .05, .1, .15, .2, .25, .3, .35, .4, .45, .5, .55, .6]}
MIN_H = 30


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
        for tech, k in (('solar', 's'), ('wind', 'w')):
            b = BANDS[tech]
            acc = [[0.0, 0] for _ in range(len(b) - 1)]
            for d, v in ok.items():
                lvl = mon[d[5:7]][0] / mon[d[5:7]][1]
                if lvl <= 0:
                    continue
                for h in range(24):
                    x = v[k][h] / v['l'][h] if v['l'][h] else None
                    if x is None:
                        continue
                    i = next((j for j in range(len(b) - 1) if b[j] <= x < b[j + 1]), None)
                    if i is None:
                        continue
                    acc[i][0] += v['p'][h] / lvl
                    acc[i][1] += 1
            row[tech] = [round(s / n, 3) if n >= MIN_H else None for s, n in acc]
            row[tech + 'N'] = [n for _, n in acc]
        out['years'][str(y)] = row
        print(y, row['hours'], 'solar', row['solar'])
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
