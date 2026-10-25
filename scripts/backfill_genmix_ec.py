#!/usr/bin/env python3
"""Generation mix history by zone from Energy-Charts (public power, Fraunhofer ISE), for
the Generation mix › Historical view, where the ENTSO-E backfill never ran.

1. data/history/daily/YYYY-MM-DD.json: zones[zone].{nuclear, hydro, biomass, wind, solar,
   fossil, other} = 24 hourly MW (Paris day), the format the page reads, added only where
   the day has no generation arrays for that zone (ENTSO-E data is never overwritten).
2. data/history/genmix_daily/YYYY.json: compact series for the charts —
   {"zones": {zone: {"days": [...], fuel: [daily average MW], "profile": {fuel: 12×24 MW}}}}

The Netherlands' solar is mostly behind the meter and missing from the public series.
    python scripts/backfill_genmix_ec.py                 # 2020 → today
    python scripts/backfill_genmix_ec.py --recent        # last 40 days
"""
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
API = 'https://api.energy-charts.info/public_power'
PARIS = ZoneInfo('Europe/Paris')
UA = {'User-Agent': 'PowerKlock (github.com/TomSRemy/PowerKlock)'}
ZONES = {'FR': 'fr', 'DE_LU': 'de', 'BE': 'be', 'NL': 'nl', 'ES': 'es', 'PT': 'pt', 'AT': 'at', 'CH': 'ch', 'PL': 'pl', 'CZ': 'cz'}
FUELS = ('nuclear', 'hydro', 'biomass', 'wind', 'solar', 'fossil', 'other')
MAP = {'Nuclear': 'nuclear', 'Hydro Run-of-River': 'hydro', 'Hydro water reservoir': 'hydro', 'Hydro pumped storage': 'hydro',
       'Biomass': 'biomass', 'Wind onshore': 'wind', 'Wind offshore': 'wind', 'Solar': 'solar',
       'Fossil brown coal / lignite': 'fossil', 'Fossil hard coal': 'fossil', 'Fossil oil': 'fossil', 'Fossil gas': 'fossil',
       'Fossil coal-derived gas': 'fossil', 'Fossil oil shale': 'fossil', 'Fossil peat': 'fossil',
       'Geothermal': 'other', 'Waste': 'other', 'Others': 'other', 'Other, renewable': 'other', 'Other, non-renewable': 'other', 'Other renewables': 'other'}


def get(cc, a, b):
    for k in range(4):
        try:
            r = requests.get(API, params={'country': cc, 'start': a, 'end': b}, headers=UA, timeout=240)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (400, 404):
                return None
        except requests.RequestException:
            pass
        time.sleep(10 * (k + 1))
    return None


def by_paris_hour(pw):
    """{(Paris day, hour): {fuel: MW}}: each production type averaged over its quarter-hours of the
    hour, then the types of a fuel added up (onshore + offshore wind, the three hydro kinds, the
    fossil fuels). Averaging the types together, as before, halved wind where there is offshore."""
    ts = pw['unix_seconds']
    acc = {}
    for p in pw['production_types']:
        f = MAP.get(p['name'])
        if not f:
            continue
        for t, v in zip(ts, p['data']):
            if v is None:
                continue
            loc = datetime.fromtimestamp(t, timezone.utc).astimezone(PARIS)
            k = (loc.date().isoformat(), loc.hour)
            a = acc.setdefault(k, {}).setdefault(f, {}).setdefault(p['name'], [0.0, 0])
            a[0] += max(0.0, v); a[1] += 1
    out = {}
    for k, fs in acc.items():
        out[k] = {f: sum(s / n for s, n in types.values()) for f, types in fs.items()}
    return out


def main():
    today = date.today()
    if '--recent' in sys.argv:
        spans = [(today - timedelta(days=40), today)]
    else:
        y0 = int(sys.argv[sys.argv.index('--from') + 1]) if '--from' in sys.argv else 2020
        spans = [(date(y, 1, 1), min(date(y, 12, 31), today)) for y in range(y0, today.year + 1)]
    for a, b in spans:
        y = a.year
        days = {}
        for z, cc in ZONES.items():
            pw = get(cc, f'{a.isoformat()}T00:00+01:00', f'{(b + timedelta(days=1)).isoformat()}T01:00+01:00')
            if not pw:
                print(y, z, 'no data', flush=True)
                continue
            hh = by_paris_hour(pw)
            for (d, h), fs in hh.items():
                if not (a.isoformat() <= d <= b.isoformat()):
                    continue
                days.setdefault(d, {}).setdefault(z, {f: [None] * 24 for f in FUELS})
                for f in FUELS:
                    days[d][z][f][h] = round(fs.get(f, 0))
            print(y, z, 'hours', len(hh), flush=True)
            time.sleep(1.5)
        # 1) daily files: add arrays where the zone has none
        added = 0
        for d, zs in days.items():
            path = os.path.join(H, 'daily', f'{d}.json')
            try:
                j = json.load(open(path))
            except (OSError, ValueError):
                j = {'date': d, 'zones': {}}
            changed = False
            for z, arr in zs.items():
                for f in FUELS:   # an hour missing at a DST change repeats its neighbour
                    for h in range(24):
                        if arr[f][h] is None:
                            arr[f][h] = arr[f][h - 1] if h and arr[f][h - 1] is not None else 0
                zd = j['zones'].get(z) or {}
                j['zones'][z] = zd
                # ENTSO-E arrays are kept; Energy-Charts ones written by this script are rewritten
                if zd.get('genSource') != 'Energy-Charts' and any(isinstance(zd.get(f), list) and any(zd[f]) for f in ('nuclear', 'hydro', 'fossil')):
                    continue
                for f in FUELS:
                    zd[f] = arr[f]
                zd['genSource'] = 'Energy-Charts'
                changed = True
            if changed:
                with open(path, 'w') as fh:
                    json.dump(j, fh, separators=(',', ':'))
                added += 1
        # 2) compact yearly series for the charts
        yp = os.path.join(H, 'genmix_daily', f'{y}.json')
        os.makedirs(os.path.dirname(yp), exist_ok=True)
        doc = json.load(open(yp)) if os.path.exists(yp) else {'year': y, 'unit': 'MW', 'fuels': FUELS, 'source': 'Energy-Charts public power (Fraunhofer ISE)', 'zones': {}}
        for z in ZONES:
            ds = sorted(d for d in days if z in days[d])
            if not ds:
                continue
            old = doc['zones'].get(z, {})
            series = {d: {f: v for f, v in zip(FUELS, [old[f][i] for f in FUELS])} for i, d in enumerate(old.get('days', []))} if old else {}
            for d in ds:
                series[d] = {f: round(sum(x for x in days[d][z][f] if x is not None) / 24) for f in FUELS}
            keys = sorted(series)
            prof = {f: [[0.0] * 24 for _ in range(12)] for f in FUELS}
            cnt = [[0] * 24 for _ in range(12)]
            for d in ds:
                m = int(d[5:7]) - 1
                for h in range(24):
                    cnt[m][h] += 1
                    for f in FUELS:
                        prof[f][m][h] += days[d][z][f][h] or 0
            zdoc = {'days': keys, **{f: [series[d][f] for d in keys] for f in FUELS}}
            zdoc['profile'] = {f: [[round(prof[f][m][h] / cnt[m][h]) if cnt[m][h] else None for h in range(24)] for m in range(12)] for f in FUELS}
            if old.get('profile'):     # months not refetched keep their profile
                for f in FUELS:
                    for m in range(12):
                        if not any(cnt[m]):
                            zdoc['profile'][f][m] = old['profile'][f][m]
            doc['zones'][z] = zdoc
        doc['updated'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
        with open(yp, 'w') as fh:
            json.dump(doc, fh, separators=(',', ':'))
        print(y, 'daily files updated:', added, flush=True)


if __name__ == '__main__':
    main()
