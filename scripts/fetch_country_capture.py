#!/usr/bin/env python3
"""Solar and wind capture rates of other countries, year by year, to learn
cannibalisation from markets further along than France (PPA pricer,
Renewables › Cannibalisation).

For each country and year: hourly day-ahead price and hourly solar, wind and
load (Energy-Charts, public power), then
    capture rate = Σ production × price / Σ production / average price (all hours;
    'Pos' = hours with a price > 0 only, the PPA Dashboard convention)
and the average load, which turns installed capacity into a penetration
(GW installed ÷ GW of average load) comparable between countries.

Writes data/history/country_capture.json
    {"updated", "source", "countries": {"DE": {"years": {"2024": {...}}}}}
    python scripts/fetch_country_capture.py            # every year from 2016
    python scripts/fetch_country_capture.py --recent   # last and current year only
    python scripts/fetch_country_capture.py --only DE,BE
"""
import json
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import requests

API = 'https://api.energy-charts.info/'
OUT = Path('data/history/country_capture.json')
CAPACITY = Path('data/history/capacity.json')
# country → Energy-Charts country code, bidding zones (the German zone was DE-AT-LU until 30 Sep 2018)
COUNTRIES = {'FR': ('fr', ['FR']), 'DE': ('de', ['DE-LU', 'DE-AT-LU']), 'BE': ('be', ['BE']), 'NL': ('nl', ['NL']), 'ES': ('es', ['ES'])}
FIRST = 2016
UA = {'User-Agent': 'PowerKlock (github.com/TomSRemy/PowerKlock)'}


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
    """mean per UTC hour → {hour: value}"""
    acc = {}
    for t, v in zip(ts, vals):
        if v is None:
            continue
        a = acc.setdefault(t // 3600, [0.0, 0])
        a[0] += v
        a[1] += 1
    return {h: s / n for h, (s, n) in acc.items()}


def year_figures(cc, zones, y):
    start, end = f'{y}-01-01T00:00Z', f'{y + 1}-01-01T00:00Z'
    pw = get('public_power', {'country': cc, 'start': start, 'end': end})
    if not pw:
        return None
    types = {p['name']: p['data'] for p in pw['production_types']}
    ts = pw['unix_seconds']
    sol = hourly(ts, types.get('Solar') or [])
    won, woff = hourly(ts, types.get('Wind onshore') or []), hourly(ts, types.get('Wind offshore') or [])
    load = hourly(ts, types.get('Load') or types.get('Load (incl. self-consumption)') or [])
    price = {}
    for z in zones:            # first zone wins, older zone fills the gap
        pr = get('price', {'bzn': z, 'start': start, 'end': end})
        if pr:
            for h, v in hourly(pr['unix_seconds'], pr['price']).items():
                price.setdefault(h, v)
    if not price or not sol:
        return None
    wind = {h: won.get(h, 0) + woff.get(h, 0) for h in set(won) | set(woff)}

    def rate(V, pos=False):
        hs = [h for h in V if h in price and (not pos or price[h] > 0)]
        e = sum(V[h] for h in hs)
        if not hs or e <= 0:
            return None, 0
        base = sum(price[h] for h in hs) / len(hs)
        return sum(V[h] * price[h] for h in hs) / e / base, e

    base = sum(price.values()) / len(price)
    rs, es = rate(sol)
    rw, ew = rate(wind)
    rsp, _ = rate(sol, True)
    rwp, _ = rate(wind, True)
    n = len(price)
    return {'solarRate': round(rs, 4) if rs else None, 'windRate': round(rw, 4) if rw else None,
            'solarRatePos': round(rsp, 4) if rsp else None, 'windRatePos': round(rwp, 4) if rwp else None,
            'negH': sum(1 for v in price.values() if v <= 0), 'base': round(base, 2), 'solarTWh': round(es / 1e6, 2), 'windTWh': round(ew / 1e6, 2),
            'avgLoadGW': round(sum(load.values()) / len(load) / 1000, 2) if load else None,
            'hours': n, 'complete': y < date.today().year and n > 8000}


def capacity():
    caps = json.loads(CAPACITY.read_text())['countries']
    out = {}
    for c, d in caps.items():
        t = d['types']
        sol = t.get('Solar AC') or t.get('Solar') or t.get('Solar DC')
        won, woff = t.get('Wind onshore') or [], t.get('Wind offshore') or []
        out[c] = {y: {'solarGW': sol[i] if sol and i < len(sol) else None,
                      'windGW': ((won[i] if i < len(won) and won[i] else 0) + (woff[i] if i < len(woff) and woff[i] else 0)) or None}
                  for i, y in enumerate(d['years'])}
    return out


def main():
    recent = '--recent' in sys.argv
    old = json.loads(OUT.read_text()) if OUT.exists() else {'countries': {}}
    cap = capacity()
    this = date.today().year
    years = range(this - 1 if recent else FIRST, this + 1)
    only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
    for c, (cc, zones) in COUNTRIES.items():
        if only and c not in only:
            continue
        dst = old['countries'].setdefault(c, {'years': {}})
        for y in years:
            f = year_figures(cc, zones, y)
            if f:
                cy = cap.get(c, {}).get(y, {})
                f.update(cy)
                dst['years'][str(y)] = f
                print(c, y, f'solar {f["solarRate"]}', f'wind {f["windRate"]}', f'load {f["avgLoadGW"]} GW', f'cap {cy}', flush=True)
            else:
                print(c, y, 'no data', flush=True)
            time.sleep(2)
    old['updated'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    old['source'] = 'Energy-Charts (Fraunhofer ISE): public power and day-ahead prices; installed capacity: data/history/capacity.json'
    OUT.write_text(json.dumps(old, separators=(',', ':')))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
