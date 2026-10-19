#!/usr/bin/env python3
"""France generation, load and exchanges from RTE éCO2mix (ODRÉ, Etalab 2.0).

Writes data/history/rte/YYYY-MM.json:
  {"updated", "source", "fields": [...],
   "days": {"YYYY-MM-DD": {"ds": "def"|"tr", "res": 15|30, "<field>": [96 values or null]}}}

Slots follow the Paris clock of the delivery day (slot = hour * 4 + minute / 15).
The consolidated dataset (eco2mix-national-cons-def, 2012 → about two months
ago) has half-hourly values: each one is held over its two quarter-hours.
The real-time dataset (eco2mix-national-tr, last ~7 weeks) is quarter-hourly.
Days in the real-time window are replaced by consolidated data once RTE
publishes it.

Usage:
  fetch_rte_eco2mix.py                      # current and previous month
  fetch_rte_eco2mix.py --from 2015-01 --to 2026-10
"""
import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'data', 'history', 'rte')
API = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/{}/exports/json'

# output field ← RTE column
FIELDS = {
    'nuclear': 'nucleaire',
    'wind': 'eolien',
    'windOnshore': 'eolien_terrestre',      # real-time dataset only
    'windOffshore': 'eolien_offshore',      # real-time dataset only
    'solar': 'solaire',
    'hydro': 'hydraulique',
    'hydroRoR': 'hydraulique_fil_eau_eclusee',
    'hydroLake': 'hydraulique_lacs',
    'hydroPS': 'hydraulique_step_turbinage',
    'pumping': 'pompage',                   # negative = consumption
    'gas': 'gaz',
    'coal': 'charbon',
    'oil': 'fioul',
    'bio': 'bioenergies',
    'batteryCharge': 'stockage_batterie',   # real-time dataset only, negative
    'batteryDischarge': 'destockage_batterie',
    'load': 'consommation',
    'loadForecastD1': 'prevision_j1',
    'exchanges': 'ech_physiques',           # RTE sign: negative = net export
    'co2': 'taux_co2',                      # g/kWh
}
DEF_ONLY_MISSING = {'windOnshore', 'windOffshore', 'batteryCharge', 'batteryDischarge'}


def fetch(ds, cols, where):
    url = API.format(ds) + '?' + urllib.parse.urlencode({
        'select': ','.join(['date', 'heure'] + cols), 'where': where, 'order_by': 'date_heure'})
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'PowerKlock/1.0'})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:  # network / 429: back off
            print('   retry', attempt + 1, e)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError('ODRÉ unreachable for ' + ds)


def month_rows(ds, ym):
    y, m = map(int, ym.split('-'))
    start = date(y, m, 1)
    end = date(y + (m == 12), m % 12 + 1, 1)
    # UTC window wide enough for the Paris month; rows are kept by their local date.
    where = 'date_heure>="{}T00:00:00" and date_heure<"{}T00:00:00"'.format(
        (start - timedelta(days=1)).isoformat(), (end + timedelta(days=1)).isoformat())
    cols = [c for f, c in FIELDS.items() if not (ds.endswith('cons-def') and f in DEF_ONLY_MISSING)]
    rows = fetch(ds, cols, where)
    return [r for r in rows if (r.get('date') or '').startswith(ym)]


def num(v):
    """ODRÉ returns some columns as text (e.g. run-of-river): coerce to a number."""
    if v is None or isinstance(v, (int, float)):
        return v
    try:
        x = float(str(v).replace(',', '.'))
        return int(x) if x.is_integer() else x
    except ValueError:
        return None


def build_days(rows, ds_tag):
    days = {}
    for r in rows:
        d, hm = r.get('date'), r.get('heure')
        if not d or not hm:
            continue
        i = int(hm[:2]) * 4 + int(hm[3:5]) // 15
        if not 0 <= i < 96:
            continue
        day = days.setdefault(d, {'ds': ds_tag, 'res': 15})
        for f, c in FIELDS.items():
            v = num(r.get(c))
            if v is None:
                continue
            arr = day.setdefault(f, [None] * 96)
            arr[i] = v
    for day in days.values():
        arrs = [a for k, a in day.items() if isinstance(a, list)]
        if not arrs:
            continue
        # Half-hourly series (every odd quarter empty): hold each value over its half-hour.
        for a in arrs:
            if any(v is not None for v in a[0::2]) and all(v is None for v in a[1::2]):
                for i in range(1, 96, 2):
                    a[i] = a[i - 1]
                if a is day.get('nuclear'):
                    day['res'] = 30
    # Drop days without any production value (forecast-only rows of tomorrow).
    return {d: v for d, v in days.items() if v.get('nuclear') and any(x is not None for x in v['nuclear'])}


def write_month(ym, days):
    path = os.path.join(OUT_DIR, ym + '.json')
    old = {}
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f).get('days', {})
    # Consolidated data wins; real-time data never replaces a consolidated day.
    merged = dict(old)
    for d, v in days.items():
        if v['ds'] == 'def' or merged.get(d, {}).get('ds') != 'def':
            merged[d] = v
    payload = {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'RTE éCO2mix via ODRÉ (eco2mix-national-cons-def / eco2mix-national-tr), Etalab 2.0',
        'slotTz': 'Europe/Paris',
        'fields': list(FIELDS),
        'days': dict(sorted(merged.items())),
    }
    if merged == old and os.path.exists(path):
        return False
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(path, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))
    return True


def months_between(a, b):
    y, m = map(int, a.split('-'))
    out = []
    while '%04d-%02d' % (y, m) <= b:
        out.append('%04d-%02d' % (y, m))
        y, m = y + (m == 12), m % 12 + 1
    return out


def daily_stats():
    """data/history/rte/fr_daily.json: one row per day since 2015 — average
    output per technology, load (average, peak, trough), exchanges, CO2
    intensity and, on days with France day-ahead prices, the baseload and
    wind / solar / nuclear capture prices (Σ price × MW ÷ Σ MW over the
    quarter-hours where both exist)."""
    daily_dir = os.path.join(ROOT, 'data', 'history', 'daily')
    rows = []
    for fn in sorted(os.listdir(OUT_DIR)):
        if not fn[:4].isdigit():
            continue
        with open(os.path.join(OUT_DIR, fn)) as f:
            days = json.load(f).get('days', {})
        for d, v in sorted(days.items()):
            nuc = v.get('nuclear') or [None] * 96
            slots = [i for i in range(96) if nuc[i] is not None]
            if len(slots) < 80:
                continue          # day in progress: the site reads it live

            def avg(k, idx=slots):
                a = v.get(k)
                if not a:
                    return None
                x = [a[i] for i in idx if a[i] is not None]
                return round(sum(x) / len(x)) if x else None
            load = [v['load'][i] for i in slots if v.get('load') and v['load'][i] is not None]
            row = {'d': d, 'ds': v.get('ds'),
                   'nuclearAvg': avg('nuclear'), 'windAvg': avg('wind'), 'windOnAvg': avg('windOnshore'), 'windOffAvg': avg('windOffshore'),
                   'solarAvg': avg('solar'), 'hydroAvg': avg('hydro'), 'hydroPSAvg': avg('hydroPS'), 'pumpingAvg': avg('pumping'),
                   'gasAvg': avg('gas'), 'coalAvg': avg('coal'), 'oilAvg': avg('oil'), 'bioAvg': avg('bio'),
                   'loadAvg': round(sum(load) / len(load)) if load else None, 'loadMax': max(load) if load else None, 'loadMin': min(load) if load else None,
                   'exchAvg': avg('exchanges'), 'co2Avg': avg('co2')}
            try:
                with open(os.path.join(daily_dir, d + '.json')) as f:
                    price = ((json.load(f).get('zones') or {}).get('FR') or {}).get('hourly')
            except (OSError, ValueError):
                price = None
            if isinstance(price, list) and len(price) == 96:
                pub = [i for i in slots if price[i] is not None]
                if len(pub) >= 80:
                    def cap(k):
                        a = v.get(k)
                        if not a:
                            return None
                        w = [(a[i], price[i]) for i in pub if a[i] is not None and a[i] > 0]
                        sw = sum(g for g, _ in w)
                        return round(sum(g * p for g, p in w) / sw, 2) if sw > 0 else None
                    row.update({'base': round(sum(price[i] for i in pub) / len(pub), 2),
                                'wCap': cap('wind'), 'sCap': cap('solar'), 'nCap': cap('nuclear')})
            rows.append({k: x for k, x in row.items() if x is not None})
    with open(os.path.join(OUT_DIR, 'fr_daily.json'), 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'source': 'RTE éCO2mix (generation, load, exchanges, CO2) × France day-ahead (PowerKlock history)',
                   'unit': 'MW daily averages; g/kWh; €/MWh', 'rows': rows},
                  f, separators=(',', ':'))
    print('fr_daily.json: %d days' % len(rows))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='frm')
    ap.add_argument('--to')
    ap.add_argument('--stats-only', action='store_true')
    args = ap.parse_args()
    if args.stats_only:
        daily_stats()
        return
    today = date.today()
    prev = (today.replace(day=1) - timedelta(days=1))
    frm = args.frm or prev.strftime('%Y-%m')
    to = args.to or today.strftime('%Y-%m')
    # Consolidated data lags about two months: always revisit the last three.
    if not args.frm:
        frm = (today.replace(day=1) - timedelta(days=75)).strftime('%Y-%m')
    for ym in months_between(frm, to):
        days = build_days(month_rows('eco2mix-national-cons-def', ym), 'def')
        tr = {}
        if len(days) < 28:
            tr = build_days(month_rows('eco2mix-national-tr', ym), 'tr')
        for d, v in tr.items():
            days.setdefault(d, v)
        changed = write_month(ym, days)
        print('%s: %d days (%d consolidated)%s' % (ym, len(days), sum(1 for v in days.values() if v['ds'] == 'def'),
                                                    '' if changed else ', unchanged'))
        time.sleep(1)
    daily_stats()


if __name__ == '__main__':
    main()
