#!/usr/bin/env python3
"""Negative-price profile by month and hour of day, per zone and year.

Reads data/history/daily/YYYY-MM-DD.json (day-ahead curve of each zone,
96 quarter-hours or 24 hours, Paris delivery day) and writes
data/history/neg_profile.json:
  {"updated", "zones": {"FR": {"2025": {"mh": [12 × 24 hours with a
      negative price], "days": [12 × days with data]}, …}, …}}
A quarter-hour below zero counts 0.25 h. Used by Prices › Negative prices
(month × hour heatmap, hour-of-day profile).

    python scripts/build_neg_profile.py          # current and previous year
    python scripts/build_neg_profile.py --all    # every year
"""
import glob
import json
import os
import sys
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(ROOT, 'data', 'history', 'daily')
OUT = os.path.join(ROOT, 'data', 'history', 'neg_profile.json')


def build_year(year):
    out = {}
    for path in sorted(glob.glob(os.path.join(DAILY, f'{year}-*.json'))):
        try:
            with open(path) as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        day = d.get('date') or os.path.basename(path)[:10]
        m = int(day[5:7]) - 1
        for z, v in (d.get('zones') or {}).items():
            h = v.get('hourly') if isinstance(v, dict) else None
            if not isinstance(h, list) or len(h) not in (24, 96) or all(x is None for x in h):
                continue
            step = 24 / len(h)
            rec = out.setdefault(z, {'mh': [[0.0] * 24 for _ in range(12)], 'days': [0] * 12})
            rec['days'][m] += 1
            for i, x in enumerate(h):
                if x is not None and x < 0:
                    rec['mh'][m][int(i * step)] += step
    for rec in out.values():
        rec['mh'] = [[round(x, 2) for x in row] for row in rec['mh']]
    return out


def main():
    data = {}
    if os.path.exists(OUT):
        with open(OUT) as f:
            data = json.load(f).get('zones', {})
    this = date.today().year
    years = sorted({int(os.path.basename(p)[:4]) for p in glob.glob(os.path.join(DAILY, '*.json'))}) if '--all' in sys.argv else [this - 1, this]
    for y in years:
        res = build_year(y)
        for z, rec in res.items():
            data.setdefault(z, {})[str(y)] = rec
        print(f'{y}: {len(res)} zones')
    with open(OUT, 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'zones': data}, f, separators=(',', ':'))
    print(f'Wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
