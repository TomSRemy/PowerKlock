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
  data/map/YYYY-MM-DD.json          generation per ENTSO-E production type,
                                    load and net import per country, hourly
                                    (Paris clock), for the Power Map; the last
                                    10 days are kept

Usage
  python scripts/fetch_energy_charts.py                    # capacity + flows of the last 3 days
  python scripts/fetch_energy_charts.py --from 2020-01-01 --to 2026-10-18   # flow history
  python scripts/fetch_energy_charts.py --capacity-only
  python scripts/fetch_energy_charts.py --map              # map files for yesterday and today + today's flows
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



# ── Generation per country for the Power Map ─────────────────────────
MAP_DIR = os.path.join(ROOT, 'data', 'map')
MAP_KEEP_DAYS = 10
# Energy-Charts country codes with public_power data (PowerKlock / ISO code → API code)
MAP_COUNTRIES = {
    'AT': 'at', 'BA': 'ba', 'BE': 'be', 'BG': 'bg', 'CH': 'ch', 'CZ': 'cz', 'DE': 'de', 'DK': 'dk', 'EE': 'ee',
    'ES': 'es', 'FI': 'fi', 'FR': 'fr', 'GB': 'uk', 'GR': 'gr', 'HR': 'hr', 'HU': 'hu', 'IE': 'ie', 'IT': 'it',
    'LT': 'lt', 'LU': 'lu', 'LV': 'lv', 'ME': 'me', 'MK': 'mk', 'NL': 'nl', 'NO': 'no', 'PL': 'pl', 'PT': 'pt',
    'RO': 'ro', 'RS': 'rs', 'SE': 'se', 'SI': 'si', 'SK': 'sk', 'XK': 'xk', 'AL': 'al',
}
# Energy-Charts production name → ENTSO-E production type (same codes as the Carbon page)
EC_TO_PSR = {
    'Biomass': 'B01', 'Fossil brown coal / lignite': 'B02', 'Fossil coal-derived gas': 'B03', 'Fossil gas': 'B04',
    'Fossil hard coal': 'B05', 'Fossil oil': 'B06', 'Fossil oil shale': 'B07', 'Fossil peat': 'B08', 'Geothermal': 'B09',
    'Hydro pumped storage': 'B10', 'Hydro Run-of-River': 'B11', 'Hydro water reservoir': 'B12', 'Marine': 'B13',
    'Nuclear': 'B14', 'Other renewables': 'B15', 'Solar': 'B16', 'Waste': 'B17', 'Wind offshore': 'B18',
    'Wind onshore': 'B19', 'Others': 'B20', 'Battery': 'B25',
}
EC_STORAGE_IN = ('Hydro pumped storage consumption', 'Battery Consumption')


def _hourly_paris(unix, values, day):
    """Average a series onto the 24 Paris hours of `day` (None when no point)."""
    acc = [[0.0, 0] for _ in range(24)]
    for t, v in zip(unix, values):
        if v is None:
            continue
        dt = datetime.fromtimestamp(t, PARIS)
        if dt.date() != day:
            continue
        acc[dt.hour][0] += v
        acc[dt.hour][1] += 1
    return [round(s / n) if n else None for s, n in acc]


def fetch_map_day(day):
    out = {}
    for cc, api in MAP_COUNTRIES.items():
        try:
            j = get('public_power', country=api, start=day.isoformat(), end=day.isoformat())
        except Exception as e:  # one country failing must not stop the others
            print(f'  {cc}: {e}')
            continue
        if not j or not j.get('unix_seconds'):
            continue
        unix = j['unix_seconds']
        rec = {'gen': {}}
        storage_in = None
        for p in j.get('production_types', []):
            name, data = p.get('name'), p.get('data') or []
            if name in EC_TO_PSR:
                h = _hourly_paris(unix, data, day)
                if any(v for v in h if v):
                    code = EC_TO_PSR[name]
                    prev = rec['gen'].get(code)
                    rec['gen'][code] = h if prev is None else [None if a is None and b is None else (a or 0) + (b or 0) for a, b in zip(prev, h)]
            elif name == 'Load':
                rec['load'] = _hourly_paris(unix, data, day)
            elif name == 'Cross border electricity trading':
                rec['net'] = _hourly_paris(unix, data, day)          # + = net import
            elif name in EC_STORAGE_IN:
                h = _hourly_paris(unix, data, day)
                storage_in = h if storage_in is None else [None if a is None and b is None else (a or 0) + (b or 0) for a, b in zip(storage_in, h)]
        if storage_in and any(v for v in storage_in if v):
            rec['storageIn'] = storage_in                            # negative = consumption
        if rec['gen']:
            out[cc] = rec
    return out


def fetch_map(days):
    for day in days:
        countries = fetch_map_day(day)
        if not countries:
            print(f'  map {day}: no data')
            continue
        write_json(os.path.join(MAP_DIR, day.isoformat() + '.json'), {
            'date': day.isoformat(), 'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'resolution_min': 60, 'slotTz': 'Europe/Paris', 'unit': 'MW',
            'note': 'gen: ENTSO-E production type codes (B01…B25); load; net = net import (+) / export (−); storageIn = pumping and battery charging (−)',
            'source': 'Energy-Charts public_power (ENTSO-E and national sources)', 'license': LICENSE,
            'countries': countries,
        })
        print(f'  map {day}: {len(countries)} countries')
    keep = {(date.today() - timedelta(days=i)).isoformat() for i in range(MAP_KEEP_DAYS + 1)}
    for fn in os.listdir(MAP_DIR) if os.path.isdir(MAP_DIR) else []:
        if fn.endswith('.json') and fn[:10] not in keep:
            os.remove(os.path.join(MAP_DIR, fn))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--from', dest='d_from')
    ap.add_argument('--to', dest='d_to')
    ap.add_argument('--capacity-only', action='store_true')
    ap.add_argument('--flows-only', action='store_true')
    ap.add_argument('--map', action='store_true', help='map files (yesterday, today) and today\'s flows only')
    args = ap.parse_args()
    today = datetime.now(PARIS).date()
    if args.map:
        print('Power map')
        fetch_map([today - timedelta(days=1), today])
        # just after midnight (Paris) the new day has no data yet and Energy-Charts answers 500: finish yesterday instead
        try:
            fetch_flows(today - timedelta(days=1) if datetime.now(PARIS).hour < 3 else today, today)
        except Exception as e:
            print(f'  flows {today}: {e}')
            if datetime.now(PARIS).hour >= 3:
                raise
        return
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
