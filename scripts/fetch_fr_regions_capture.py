#!/usr/bin/env python3
"""Solar and wind capture rate of each French region (12 mainland regions, RTE éCO2mix
regional, consolidated, half-hourly), against the national day-ahead price: the regional
basis of a PPA, i.e. how much more or less a park earns per MWh than the national profile
because of where it produces.

For each region, year and technology: capture rate in the three conventions (all hours,
curtailment at prices ≤ 0, PPA Dashboard), the gap to the sum of all regions (the national
profile on the same data), the monthly share of the yearly output, and an average day by
month (MW, last three complete years) for the pricer.

Writes data/history/fr_regional_capture.json
    python scripts/fetch_fr_regions_capture.py            # every year from 2016
    python scripts/fetch_fr_regions_capture.py --recent   # last and current year
"""
import json
import os
import sys
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'fr_regional_capture.json')
API = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-regional-cons-def/exports/json'
PARIS = ZoneInfo('Europe/Paris')


def fetch_year(y):
    where = f'date_heure>="{y}-01-01T00:00:00+01:00" and date_heure<"{y + 1}-01-01T00:00:00+01:00"'
    for k in range(4):
        try:
            r = requests.get(API, params={'select': 'date_heure,code_insee_region,libelle_region,solaire,eolien', 'where': where}, timeout=600)
            if r.status_code == 200:
                return r.json()
        except requests.RequestException:
            pass
        time.sleep(15 * (k + 1))
    return None


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def capture(V, P):
    """{'all', 'curt', 'pos'} capture rates of output V (MW per hour) against prices P"""
    hs = [k for k in V if k in P]
    if not hs:
        return None
    base = sum(P[k] for k in hs) / len(hs)
    pos = [k for k in hs if P[k] > 0]
    e, ep = sum(V[k] for k in hs), sum(V[k] for k in pos)
    if e <= 0 or ep <= 0 or base <= 0:
        return None
    basep = sum(P[k] for k in pos) / len(pos)
    cp_all = sum(V[k] * P[k] for k in hs) / e
    cp_pos = sum(V[k] * P[k] for k in pos) / ep
    return {'all': round(cp_all / base, 4), 'curt': round(cp_pos / base, 4), 'pos': round(cp_pos / basep, 4), 'paid': round(ep / e, 4), 'twh': round(e / 1e6, 3)}


def main():
    old = json.load(open(OUT)) if os.path.exists(OUT) else {'regions': {}, 'national': {}, 'profile': {}}
    this = date.today().year
    years = range(this - 1, this + 1) if '--recent' in sys.argv else range(2016, this + 1)
    prof_acc = {}
    for y in years:
        try:
            fr = json.load(open(os.path.join(H, 'fr_hourly', f'{y}.json')))['days']
        except OSError:
            continue
        P = {}
        for d, v in fr.items():
            for h, p in enumerate(v.get('p') or []):
                if p is not None:
                    P[(d, h)] = p
        rows = fetch_year(y)
        if not rows:
            print(y, 'no regional data', flush=True)
            continue
        acc = {}
        names = {}
        for r in rows:
            t = datetime.fromisoformat(r['date_heure']).astimezone(PARIS)
            k = (t.date().isoformat(), t.hour)
            c = r['code_insee_region']
            names[c] = r['libelle_region']
            for tech, src in (('solar', 'solaire'), ('wind', 'eolien')):
                v = num(r.get(src))
                if v is None:
                    continue
                a = acc.setdefault((c, tech), {}).setdefault(k, [0.0, 0])
                a[0] += max(0.0, v); a[1] += 1
        nat = {}
        for (c, tech), d in acc.items():
            V = {k: s / n for k, (s, n) in d.items()}
            for k, v in V.items():
                nat.setdefault(tech, {})[k] = nat.get(tech, {}).get(k, 0) + v
            cr = capture(V, P)
            if not cr:
                continue
            months = [0.0] * 12
            for (dd, h), v in V.items():
                months[int(dd[5:7]) - 1] += v
            tot = sum(months)
            cr['share'] = [round(x / tot, 4) for x in months] if tot else None
            cr['complete'] = y < this and len(V) > 8000
            old['regions'].setdefault(c, {'name': names[c], 'years': {}})['years'].setdefault(str(y), {})[tech] = cr
            if y >= this - 3 and y < this:
                pa = prof_acc.setdefault((c, tech), [[[0.0, 0] for _ in range(24)] for _ in range(12)])
                for (dd, h), v in V.items():
                    q = pa[int(dd[5:7]) - 1][h]; q[0] += v; q[1] += 1
        for tech, V in nat.items():
            cr = capture(V, P)
            if cr:
                old['national'].setdefault(str(y), {})[tech] = cr
        # gap of each region to the national profile, capture points
        for c, reg in old['regions'].items():
            for tech, cr in (reg['years'].get(str(y)) or {}).items():
                n = old['national'].get(str(y), {}).get(tech)
                if n:
                    cr['gap'] = {k: round(cr[k] - n[k], 4) for k in ('all', 'curt', 'pos')}
        print(y, len(acc) // 2, 'regions', flush=True)
    for (c, tech), pa in prof_acc.items():
        old['profile'].setdefault(c, {})[tech] = [[round(s / n) if n else 0 for s, n in row] for row in pa]
    old['updated'] = datetime.now().isoformat(timespec='seconds')
    old['source'] = 'RTE éCO2mix regional consolidated data (ODRÉ, Etalab licence) × ENTSO-E day-ahead France'
    with open(OUT, 'w') as f:
        json.dump(old, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
