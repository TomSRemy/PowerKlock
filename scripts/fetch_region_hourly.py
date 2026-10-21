#!/usr/bin/env python3
"""Hourly solar, wind, load and nuclear of France's coupled neighbours (Germany,
Belgium, Spain), on the same clock as data/history/fr_hourly (Paris day, 24 hours),
for the regional price model of the PPA pricer (scripts/ppa_lab.py).

The Netherlands are left out: most of their solar is behind the meter and missing
from the public power series.

Writes data/history/region_hourly/YYYY.json
    {"year", "unit": "MW", "countries": {"DE": {"s": {day: [24]}, "w": …, "l": …, "n": …}}}
    python scripts/fetch_region_hourly.py            # every year from 2016
    python scripts/fetch_region_hourly.py --recent   # last and current year
"""
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

API = 'https://api.energy-charts.info/public_power'
OUT = Path('data/history/region_hourly')
COUNTRIES = {'DE': 'de', 'BE': 'be', 'ES': 'es'}
PARIS = ZoneInfo('Europe/Paris')
UA = {'User-Agent': 'PowerKlock (github.com/TomSRemy/PowerKlock)'}


def get(cc, y):
    for k in range(4):
        try:
            r = requests.get(API, params={'country': cc, 'start': f'{y}-01-01T00:00Z', 'end': f'{y + 1}-01-01T02:00Z'}, headers=UA, timeout=240)
            if r.status_code == 200:
                return r.json()
        except requests.RequestException:
            pass
        time.sleep(10 * (k + 1))
    return None


def hourly(ts, vals):
    acc = {}
    for t, v in zip(ts, vals or []):
        if v is None:
            continue
        a = acc.setdefault(t // 3600, [0.0, 0])
        a[0] += v
        a[1] += 1
    return {h: s / n for h, (s, n) in acc.items()}


def by_paris_day(series, y):
    """UTC hourly → {Paris day: [24]} (the missing spring hour repeats the one before, the autumn extra hour is dropped)"""
    out = {}
    d = date(y, 1, 1)
    while d.year == y:
        row = []
        for h in range(24):
            loc = datetime(d.year, d.month, d.day, h, tzinfo=PARIS)
            u = int(loc.astimezone(timezone.utc).timestamp()) // 3600
            v = series.get(u)
            row.append(None if v is None else round(v))
        if any(v is not None for v in row):
            for h in range(1, 24):
                if row[h] is None and row[h - 1] is not None:
                    row[h] = row[h - 1]
            out[d.isoformat()] = row
        d += timedelta(days=1)
    return out


def main():
    this = date.today().year
    years = range(this - 1, this + 1) if '--recent' in sys.argv else range(2016, this + 1)
    OUT.mkdir(parents=True, exist_ok=True)
    for y in years:
        f = OUT / f'{y}.json'
        doc = json.loads(f.read_text()) if f.exists() else {'year': y, 'unit': 'MW', 'source': 'Energy-Charts public power (Fraunhofer ISE)', 'countries': {}}
        for c, cc in COUNTRIES.items():
            pw = get(cc, y)
            if not pw:
                print(y, c, 'no data', flush=True)
                continue
            t = {p['name']: p['data'] for p in pw['production_types']}
            ts = pw['unix_seconds']
            won, woff = hourly(ts, t.get('Wind onshore')), hourly(ts, t.get('Wind offshore'))
            wind = {h: won.get(h, 0) + woff.get(h, 0) for h in set(won) | set(woff)}
            doc['countries'][c] = {'s': by_paris_day(hourly(ts, t.get('Solar')), y), 'w': by_paris_day(wind, y),
                                   'l': by_paris_day(hourly(ts, t.get('Load')), y), 'n': by_paris_day(hourly(ts, t.get('Nuclear')), y)}
            print(y, c, len(doc['countries'][c]['l']), 'days', flush=True)
            time.sleep(2)
        f.write_text(json.dumps(doc, separators=(',', ':')))


if __name__ == '__main__':
    main()
