#!/usr/bin/env python3
"""Cannibalisation hour by hour: at each hour, the solar (or wind) share of the
load and the price of that hour against the month's average price.

Two readings of penetration for every country:
  own      — the country's solar output ÷ its load, that hour
  regional — solar output ÷ load summed over the coupled region
             (France, Germany, Belgium, Spain), that hour
If the regional share explains a country's price better than its own share,
its cannibalisation is imported through market coupling.

Writes data/history/hourly_cannib.json
    {"updated", "years", "countries", "curves": {"solar": {"own": {"FR": [[x %, price %, hours], ...]}, "regional": {...}}},
     "r2": {"solar": {"FR": {"own": .., "regional": ..}}}}
    python scripts/hourly_cannib.py [--years 2023,2024,2025]
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

API = 'https://api.energy-charts.info/'
OUT = Path('data/history/hourly_cannib.json')
CACHE = Path(os.environ.get('PK_CACHE', '/tmp/pk_hourly_cache'))
# the Netherlands are left out: most of their solar is behind the meter and missing from the public power series
COUNTRIES = {'FR': ('fr', ['FR']), 'DE': ('de', ['DE-LU']), 'BE': ('be', ['BE']), 'ES': ('es', ['ES'])}
UA = {'User-Agent': 'PowerKlock (github.com/TomSRemy/PowerKlock)'}
BIN = 5          # % of load per bin


def get(path, params):
    for k in range(4):
        try:
            r = requests.get(API + path, params=params, headers=UA, timeout=180)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (400, 404):
                return None
        except requests.RequestException:
            pass
        time.sleep(5 * (k + 1))
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


def year_hours(c, y):
    """{hour: (price, solar MW, wind MW, load MW)}, cached on disk"""
    f = CACHE / f'{c}_{y}.json'
    if f.exists():
        return {int(k): v for k, v in json.loads(f.read_text()).items()}
    cc, zones = COUNTRIES[c]
    start, end = f'{y}-01-01T00:00Z', f'{y + 1}-01-01T00:00Z'
    pw = get('public_power', {'country': cc, 'start': start, 'end': end})
    pr = get('price', {'bzn': zones[0], 'start': start, 'end': end})
    if not pw or not pr:
        return {}
    t = {p['name']: p['data'] for p in pw['production_types']}
    ts = pw['unix_seconds']
    sol, won, woff = hourly(ts, t.get('Solar')), hourly(ts, t.get('Wind onshore')), hourly(ts, t.get('Wind offshore'))
    load, price = hourly(ts, t.get('Load')), hourly(pr['unix_seconds'], pr['price'])
    out = {h: (price[h], sol.get(h, 0), won.get(h, 0) + woff.get(h, 0), load[h]) for h in price if h in load and load[h] > 0}
    CACHE.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(out))
    return out


def main():
    years = [int(y) for y in sys.argv[sys.argv.index('--years') + 1].split(',')] if '--years' in sys.argv else [2023, 2024, 2025]
    data = {}
    for c in COUNTRIES:
        data[c] = {}
        for y in years:
            data[c].update(year_hours(c, y))
            print(c, y, len(data[c]), 'hours so far', flush=True)
    common = set.intersection(*(set(d) for d in data.values()))
    # price relative to the country's monthly average (removes gas and carbon levels)
    def month(h):
        return time.strftime('%Y-%m', time.gmtime(h * 3600))
    out = {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'years': years, 'countries': list(COUNTRIES), 'bin': BIN,
           'source': 'Energy-Charts (Fraunhofer ISE): public power and day-ahead prices', 'curves': {}, 'r2': {}}
    for k, tech in ((1, 'solar'), (2, 'wind')):
        reg = {h: sum(data[c][h][k] for c in COUNTRIES) / sum(data[c][h][3] for c in COUNTRIES) for h in common}
        out['curves'][tech] = {'own': {}, 'regional': {}}
        out['r2'][tech] = {}
        for c in COUNTRIES:
            d = data[c]
            mavg = {}
            for h, v in d.items():
                a = mavg.setdefault(month(h), [0.0, 0])
                a[0] += v[0]
                a[1] += 1
            mavg = {m: s / n for m, (s, n) in mavg.items()}
            rows = [(d[h][k] / d[h][3], reg[h], d[h][0] / mavg[month(h)]) for h in common if mavg[month(h)] > 5]
            out['r2'][tech][c] = {}
            for name, ix in (('own', 0), ('regional', 1)):
                bins = {}
                for r in rows:
                    b = min(int(r[ix] * 100 // BIN), 40)
                    a = bins.setdefault(b, [0.0, 0])
                    a[0] += r[2]
                    a[1] += 1
                curve = [[b * BIN + BIN / 2, round(s / n * 100, 1), n] for b, (s, n) in sorted(bins.items()) if n >= 30]
                out['curves'][tech][name][c] = curve
                # share of the hourly price variance explained by the binned penetration
                mean = sum(r[2] for r in rows) / len(rows)
                fit = {b: s / n for b, (s, n) in bins.items()}
                ss = sum((r[2] - mean) ** 2 for r in rows)
                sr = sum((r[2] - fit[min(int(r[ix] * 100 // BIN), 40)]) ** 2 for r in rows)
                out['r2'][tech][c][name] = round(1 - sr / ss, 3) if ss else None
            print(tech, c, out['r2'][tech][c], flush=True)
    OUT.write_text(json.dumps(out, separators=(',', ':')))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
