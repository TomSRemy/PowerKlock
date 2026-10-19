#!/usr/bin/env python3
"""France day-ahead prices, one compact file per year, for the consumer tools.

Reads data/history/daily/YYYY-MM-DD.json (96 quarter-hour prices per day,
Paris delivery day) and writes data/history/fr_prices/YYYY.json:
  {"year", "zone": "FR", "unit": "EUR/MWh", "slots": 96,
   "days": {"YYYY-MM-DD": [96 prices], …}}

    python scripts/build_fr_prices_year.py            # current and previous year
    python scripts/build_fr_prices_year.py --all      # every year since 2015
"""
import glob
import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(ROOT, 'data', 'history', 'daily')
OUT = os.path.join(ROOT, 'data', 'history', 'fr_prices')


def build(year):
    days = {}
    for path in sorted(glob.glob(os.path.join(DAILY, f'{year}-*.json'))):
        try:
            with open(path) as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        z = (d.get('zones') or {}).get('FR') or {}
        h = z.get('hourly')
        if isinstance(h, list) and len(h) == 96 and any(v is not None for v in h):
            days[d.get('date') or os.path.basename(path)[:10]] = [None if v is None else round(v, 2) for v in h]
    if not days:
        return 0
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f'{year}.json'), 'w') as f:
        json.dump({'year': year, 'zone': 'FR', 'unit': 'EUR/MWh', 'slots': 96, 'days': days}, f, separators=(',', ':'))
    return len(days)


def main():
    this = date.today().year
    years = range(2015, this + 1) if '--all' in sys.argv else (this - 1, this)
    for y in years:
        n = build(y)
        print(f'{y}: {n} days')
    return 0


if __name__ == '__main__':
    sys.exit(main())
