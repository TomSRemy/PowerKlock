#!/usr/bin/env python3
"""
Energy-Charts (Fraunhofer ISE) → PowerKlock data files.
Public API, no key, data under CC BY 4.0 (attribution: "Energy-Charts.info,
Fraunhofer ISE"). The API does not allow browser (CORS) calls, so the site
reads these files instead.

Writes
  data/history/capacity.json        installed capacity per country, production
                                    type and year (GW)
  data/history/flows/YYYY-MM.json   physical cross-border flows per country
                                    and neighbour, hourly averages (MW) on the
                                    Paris delivery day; + = import, − = export

Usage
  python scripts/fetch_energy_charts.py                    # capacity + flows of the last 3 days
  python scripts/fetch_energy_charts.py --from 2020-01-01 --to 2026-10-18   # flow history
  python scripts/fetch_energy_charts.py --capacity-only
"""
import argparse
import json
import os
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

API = 'https://api.energy-charts.info/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history')
PARIS = ZoneInfo('Europe/Paris')
PAUSE = 3.0   # seconds between calls (the API rate-limits)

# PowerKlock code → Energy-Charts country code
COUNTRIES = {'FR': 'fr', 'DE': 'de', 'BE': 'be', 'NL': 'nl', 'ES': 'es', 'IT': 'it', 'CH': 'ch',
             'AT': 'at', 'PL': 'pl', 'CZ': 'cz', 'DK': 'dk', 'PT': 'pt'}
NEIGHBOUR = {  # Energy-Charts neighbour name → code
    'Austria': 'AT', 'Belgium': 'BE', 'Czech Republic': 'CZ', 'Denmark': 'DK', 'France': 'FR', 'Germany': 'DE',
    'Luxembourg': 'LU', 'Netherlands': 'NL', 'Norway': 'NO', 'Poland': 'PL', 'Sweden': 'SE', 'Switzerland': 'CH',
    'Italy': 'IT', 'Spain': 'ES', 'Portugal': 'PT', 'United Kingdom': 'GB', 'Slovenia': 'SI', 'Slovakia': 'SK',
    'Hungary': 'HU', 'Lithuania': 'LT', 'Greece': 'GR', 'Montenegro': 'ME', 'Malta': 'MT', 'Ireland': 'IE',
}
LICENSE = 'CC BY 4.0 — Energy-Charts.info, Fraunhofer ISE'


def get(path, **params):
    q = '&'.join(f'{k}={v}' for k, v in params.items())
    url = API + path + ('?' + q if q else '')
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = json.load(r)
            time.sleep(PAUSE)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(30 * (attempt + 1))
                continue
            if e.code == 404:
                return None
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f'Energy-Charts unreachable: {url}')


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
    os.replace(tmp, path)


# ── Installed capacity ────────────────────────────────────────────────
def fetch_capacity():
    out = {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'unit': 'GW',
           'source': 'Energy-Charts installed_power (yearly, net)', 'license': LICENSE, 'countries': {}}
    for code, ec in COUNTRIES.items():
        j = get('installed_power', country=ec, time_step='yearly', installation_decommission='false')
        if not j or not j.get('time'):
            print(f'  capacity {code}: no data')
            continue
        types = {}
        for p in j.get('production_types') or []:
            vals = [None if v is None else round(float(v), 3) for v in p.get('data') or []]
            if any(v for v in vals):
                types[p['name']] = vals
        out['countries'][code] = {'years': [int(t) for t in j['time']], 'types': types}
        print(f'  capacity {code}: {len(types)} types, {j["time"][0]}–{j["time"][-1]}')
    if out['countries']:
        write_json(os.path.join(OUT, 'capacity.json'), out)


# ── Cross-border physical flows ───────────────────────────────────────
def month_path(ym):
    return os.path.join(OUT, 'flows', ym + '.json')


def load_month(ym):
    p = month_path(ym)
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return {'month': ym, 'unit': 'MW', 'resolution_min': 60, 'sign': '+ import into the country, − export',
            'source': 'Energy-Charts cbpf (physical flows)', 'license': LICENSE, 'days': {}}


def fetch_flows(d_from, d_to):
    months = {}
    for code, ec in COUNTRIES.items():
        # Ranges of at most 31 days per call.
        a = d_from
        while a <= d_to:
            b = min(d_to, a + timedelta(days=30))
            j = get('cbpf', country=ec, start=a.isoformat(), end=b.isoformat())
            if j and j.get('unix_seconds'):
                ts = j['unix_seconds']
                for c in j.get('countries') or []:
                    nb = NEIGHBOUR.get(c.get('name'))
                    if not nb:
                        continue
                    acc = {}
                    for t, v in zip(ts, c.get('data') or []):
                        local = datetime.fromtimestamp(t, PARIS)
                        key = (local.date().isoformat(), local.hour)
                        if v is not None:
                            s, n = acc.get(key, (0.0, 0))
                            acc[key] = (s + float(v), n + 1)
                    for (ds, h), (s, n) in acc.items():
                        ym = ds[:7]
                        if ym not in months:
                            months[ym] = load_month(ym)
                        day = months[ym]['days'].setdefault(ds, {})
                        arr = day.setdefault(code, {}).setdefault(nb, [None] * 24)
                        if 0 <= h < 24:
                            arr[h] = round(s / n * 1000)   # GW → MW
            print(f'  flows {code}: {a} → {b}')
            a = b + timedelta(days=1)
    for ym, m in months.items():
        m['updated'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
        m['days'] = dict(sorted(m['days'].items()))
        write_json(month_path(ym), m)
    print(f'  flows written: {sorted(months)}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--from', dest='d_from')
    ap.add_argument('--to', dest='d_to')
    ap.add_argument('--capacity-only', action='store_true')
    ap.add_argument('--flows-only', action='store_true')
    args = ap.parse_args()
    today = datetime.now(PARIS).date()
    if not args.flows_only:
        print('Installed capacity')
        fetch_capacity()
    if not args.capacity_only:
        d_from = date.fromisoformat(args.d_from) if args.d_from else today - timedelta(days=3)
        d_to = date.fromisoformat(args.d_to) if args.d_to else today
        print(f'Cross-border flows {d_from} → {d_to}')
        fetch_flows(d_from, d_to)


if __name__ == '__main__':
    main()
