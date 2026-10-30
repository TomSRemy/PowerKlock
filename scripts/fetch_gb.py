#!/usr/bin/env python3
"""Great Britain hour by hour, on the Paris clock: generation by type (NESO, historic generation mix, open data) and
the day-ahead market index price (Elexon BMRS, APX market index, £/MWh → €/MWh at the day's GBP/EUR rate from
data/history/commodities_series.json). For the merit order of the PPA scenario generator: Britain is one of France's
main export outlets (≈ 4 GW of interconnectors), cut off from the Core coupling since 2021.

Writes data/history/gb_hourly/YYYY.json
    {"year", "source", "unit", "days": {Paris day: {"w": [24], "s": [24], "n": [24], "gas": [24], "l": [24],
                                                    "imp": [24], "p": [24]}}}
    w = wind incl. embedded, l = total generation incl. imports (demand proxy), imp = imports, p = €/MWh
    python scripts/fetch_gb.py               # this year and last
    python scripts/fetch_gb.py --since 2019  # backfill
"""
import csv
import io
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

NESO = 'https://api.neso.energy/dataset/88313ae5-94e4-4ddc-a790-593554d8c6b9/resource/f93d1835-75bc-43e5-84ad-12472b180a98/download/df_fuel_ckan.csv'
ELEXON = 'https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index'
OUT = Path('data/history/gb_hourly')
PARIS = ZoneInfo('Europe/Paris')
UA = {'User-Agent': 'PowerKlock (github.com/TomSRemy/PowerKlock)'}
COLS = {'w': ('WIND', 'WIND_EMB'), 's': ('SOLAR',), 'n': ('NUCLEAR',), 'gas': ('GAS',), 'l': ('GENERATION',), 'imp': ('IMPORTS',)}


def get(url, params=None, tries=4):
    for k in range(tries):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=300)
            if r.status_code == 200:
                return r
        except requests.RequestException:
            pass
        time.sleep(5 * (k + 1))
    return None


def fx():
    """GBP → EUR by day (gbpusd ÷ eurusd), carried over days without a quote"""
    s = json.load(open('data/history/commodities_series.json'))['series']
    g, e = dict(s['gbpusd']['points']), dict(s['eurusd']['points'])
    return {d: g[d] / e[d] for d in g if d in e and e[d]}


def main():
    y0 = int(sys.argv[sys.argv.index('--since') + 1]) if '--since' in sys.argv else date.today().year - 1
    acc = {}                                   # utc hour → {key: [sum, n]}
    r = get(NESO)
    if r is None:
        sys.exit('NESO: no answer')
    for row in csv.DictReader(io.StringIO(r.text)):
        t = datetime.fromisoformat(row['DATETIME']).replace(tzinfo=timezone.utc)
        if t.year < y0:
            continue
        a = acc.setdefault(int(t.timestamp()) // 3600, {})
        for k, cols in COLS.items():
            try:
                v = sum(float(row[c] or 0) for c in cols)
            except ValueError:
                continue
            s_ = a.setdefault(k, [0.0, 0]); s_[0] += v; s_[1] += 1
    # Elexon market index, 7 days per request
    d = date(y0, 1, 1)
    while d <= date.today() + timedelta(days=1):
        r = get(ELEXON, {'from': f'{d}T00:00Z', 'to': f'{d + timedelta(days=7)}T00:00Z', 'dataProviders': 'APXMIDP', 'format': 'json'})
        for row in (r.json().get('data') or []) if r is not None else []:
            if row.get('price') is None or not row.get('volume'):
                continue                       # an empty half-hour reads 0 £ with no volume
            t = datetime.fromisoformat(row['startTime'].replace('Z', '+00:00'))
            s_ = acc.setdefault(int(t.timestamp()) // 3600, {}).setdefault('p_gbp', [0.0, 0]); s_[0] += row['price']; s_[1] += 1
        d += timedelta(days=7)
        time.sleep(0.3)
    rate = fx(); last_rate = None
    days = {}
    for h in sorted(acc):
        loc = datetime.fromtimestamp(h * 3600, timezone.utc).astimezone(PARIS)
        days.setdefault(loc.date().isoformat(), {})[loc.hour] = {k: v[0] / v[1] for k, v in acc[h].items() if v[1]}
    years = {}
    for day in sorted(days):
        hours = days[day]
        last_rate = rate.get(day, last_rate)
        row = {}
        for k in list(COLS) + ['p']:
            vals, last = [], None
            for h in range(24):
                x = hours.get(h, {})
                v = (x.get('p_gbp') * last_rate if last_rate and x.get('p_gbp') is not None else None) if k == 'p' else x.get(k)
                last = v if v is not None else last
                vals.append(None if last is None else round(last, 2 if k == 'p' else 0))
            if any(v is not None for v in vals):
                row[k] = vals
        if row:
            years.setdefault(day[:4], {})[day] = row
    OUT.mkdir(parents=True, exist_ok=True)
    for y, dd in years.items():
        f = OUT / f'{y}.json'
        doc = json.loads(f.read_text()) if f.exists() else {'year': int(y), 'source': 'NESO historic generation mix (open data) · Elexon BMRS market index (APX), £ → € at the day\'s rate',
                                                           'unit': 'MW; p €/MWh', 'days': {}}
        doc['days'].update(dd)
        doc['days'] = dict(sorted(doc['days'].items()))
        f.write_text(json.dumps(doc, separators=(',', ':')))
        print(y, len(doc['days']), 'days', flush=True)


if __name__ == '__main__':
    main()
