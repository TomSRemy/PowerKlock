#!/usr/bin/env python3
"""France, one compact file per year at the hourly step: day-ahead price and
national solar, wind, consumption and nuclear. Input of the PPA pricer's FPC methods
(js/ppa-fpc.js): shaping coefficients of the forward price curve, the
historical and the decorrelated pricings, the production model.

Reads   data/history/fr_prices/YYYY.json   (France day-ahead, 96 quarter-hours a day)
        data/history/rte/YYYY-MM.json       (RTE éCO2mix, 96 slots a day, Paris time)
Writes  data/history/fr_hourly/YYYY.json
  {"year", "unit": {"p": "€/MWh", "s|w|l": "MW"}, "days": {"YYYY-MM-DD": {"p": [24], "s": [24], "w": [24], "l": [24]}}}
  hourly = mean of the four quarter-hours; null where a source has no data.

    python scripts/build_fr_hourly.py          # current and previous year
    python scripts/build_fr_hourly.py --all    # every year from 2016
"""
import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRICES = os.path.join(ROOT, 'data', 'history', 'fr_prices')
RTE = os.path.join(ROOT, 'data', 'history', 'rte')
OUT = os.path.join(ROOT, 'data', 'history', 'fr_hourly')


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def hourly(arr):
    if not isinstance(arr, list) or len(arr) < 24:
        return None
    per = len(arr) // 24
    out = []
    for h in range(24):
        v = [x for x in arr[h * per:(h + 1) * per] if x is not None]
        out.append(round(sum(v) / len(v), 2) if v else None)
    return out


def build(year):
    pr = load(os.path.join(PRICES, f'{year}.json')) or {}
    days = {}
    for m in range(1, 13):
        rte = load(os.path.join(RTE, f'{year}-{m:02d}.json')) or {}
        for d, row in (rte.get('days') or {}).items():
            days.setdefault(d, {})
            for k, src in (('s', 'solar'), ('w', 'wind'), ('l', 'load'), ('n', 'nuclear')):
                h = hourly(row.get(src))
                if h:
                    days[d][k] = [None if v is None else round(v) for v in h]
    for d, arr in (pr.get('days') or {}).items():
        h = hourly(arr)
        if h:
            days.setdefault(d, {})['p'] = h
    days = {d: v for d, v in sorted(days.items()) if 'p' in v}
    if not days:
        return 0
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f'{year}.json'), 'w') as f:
        json.dump({'year': year, 'unit': {'p': '€/MWh', 's': 'MW', 'w': 'MW', 'l': 'MW', 'n': 'MW'}, 'days': days}, f, separators=(',', ':'))
    return len(days)


def main():
    y = date.today().year
    years = range(2016, y + 1) if '--all' in sys.argv else (y - 1, y)
    for yr in years:
        print(yr, build(yr), 'days')


if __name__ == '__main__':
    main()
