#!/usr/bin/env python3
"""
Day-ahead forecasts of solar, wind and load (TSO forecasts published on the
ENTSO-E platform, served by Energy-Charts) → data/forecast.json, plus how far
off those forecasts have been over the last 30 days.

Writes
  data/forecast.json
    zones.<zone>.days.<YYYY-MM-DD>   solar, wind (onshore + offshore), load:
                                     96 quarter-hours of the Paris delivery
                                     day, MW (null where not published)
    zones.<zone>.accuracy.<kind>     wape (Σ|forecast − actual| ÷ Σ actual),
                                     bias (Σ(forecast − actual) ÷ Σ actual),
                                     days, over the last 30 complete days
                                     (hourly averages; kept from the last
                                     --accuracy run)
  data/history/forecast/YYYY-MM.json day-ahead forecast and actual, hourly MW,
                                     per zone and day (the archive behind the
                                     accuracy figures)

France, tomorrow, before Energy-Charts has it: the TSO load forecast straight from ENTSO-E (A65,
published around 10:00, needs ENTSOE_TOKEN); wind and solar come in the late afternoon only, so the
morning price model uses PowerKlock's weather forecast for them (scripts/fcst_live.py, neg_forecast.py).

Usage
  python scripts/fetch_forecast.py               # yesterday, today and tomorrow (once published)
  python scripts/fetch_forecast.py --accuracy    # + the last 30 days, actuals and error
"""
import argparse
import json
import os
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fetch_energy_charts import get, write_json, LICENSE

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'forecast.json')
ARCH = os.path.join(ROOT, 'data', 'history', 'forecast')
PARIS = ZoneInfo('Europe/Paris')
# PowerKlock zone → Energy-Charts country
ZONES = {'FR': 'fr', 'DE_LU': 'de', 'BE': 'be', 'NL': 'nl', 'ES': 'es'}
OFFSHORE = {'FR', 'DE_LU', 'BE', 'NL'}
KINDS = ('solar', 'wind', 'load')
ACTUAL_NAME = {'solar': ('Solar',), 'wind': ('Wind onshore', 'Wind offshore'), 'load': ('Load',)}


def paris_days(unix, values):
    """unix seconds + values → {day: [96 quarter-hours]} on the Paris clock (hourly data repeated)."""
    out = {}
    step = (unix[1] - unix[0]) if len(unix) > 1 else 900
    rep = max(1, round(step / 900))
    for t, v in zip(unix, values):
        if v is None:
            continue
        loc = datetime.fromtimestamp(t, timezone.utc).astimezone(PARIS)
        d = loc.date().isoformat()
        i = (loc.hour * 60 + loc.minute) // 15
        arr = out.setdefault(d, [None] * 96)
        for k in range(rep):
            if i + k < 96:
                arr[i + k] = v if arr[i + k] is None else arr[i + k]
    return out


def entsoe_load(day):
    """France day-ahead load forecast (ENTSO-E A65) for a Paris day → [96] MW, or None"""
    tok = os.environ.get('ENTSOE_TOKEN')
    if not tok:
        return None
    a = datetime(day.year, day.month, day.day, tzinfo=PARIS).astimezone(timezone.utc)
    b = (datetime(day.year, day.month, day.day, tzinfo=PARIS) + timedelta(days=1)).astimezone(timezone.utc)
    url = ('https://web-api.tp.entsoe.eu/api?securityToken=' + tok + '&documentType=A65&processType=A01'
           '&outBiddingZone_Domain=10YFR-RTE------C&periodStart=' + a.strftime('%Y%m%d%H%M') + '&periodEnd=' + b.strftime('%Y%m%d%H%M'))
    try:
        root = ET.fromstring(urllib.request.urlopen(url, timeout=60).read())
    except Exception as e:
        print('ENTSO-E load:', e)
        return None
    loc = lambda e: e.tag.split('}')[-1]
    unix, vals = [], []
    for per in (e for e in root.iter() if loc(e) == 'Period'):
        st = res = None
        for e in per.iter():
            if loc(e) == 'start' and st is None:
                st = datetime.strptime(e.text.strip(), '%Y-%m-%dT%H:%MZ').replace(tzinfo=timezone.utc)
            elif loc(e) == 'resolution':
                res = e.text.strip()
        step = {'PT15M': 15, 'PT30M': 30, 'PT60M': 60}.get(res, 60)
        for pt in (e for e in per if loc(e) == 'Point'):
            pos = q = None
            for c in pt:
                if loc(c) == 'position':
                    pos = int(c.text)
                elif loc(c) == 'quantity':
                    q = float(c.text)
            if pos is not None and q is not None:
                for k in range(step // 15):   # spread on quarter-hours
                    unix.append((st + timedelta(minutes=step * (pos - 1) + 15 * k)).timestamp()); vals.append(q)
    if not unix:
        return None
    arr = paris_days(unix, vals).get(day.isoformat())
    return [None if x is None else round(x) for x in arr] if arr and sum(x is not None for x in arr) >= 80 else None


def add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return [None if x is None and y is None else (x or 0) + (y or 0) for x, y in zip(a, b)]


def forecasts(zone, start, end):
    """{day: {solar, wind, load}} quarter-hourly MW for [start, end]."""
    c = ZONES[zone]
    raw = {}
    for pt in ('solar', 'wind_onshore', 'wind_offshore', 'load'):
        if pt == 'wind_offshore' and zone not in OFFSHORE:
            continue
        j = get('public_power_forecast', country=c, production_type=pt, forecast_type='day-ahead',
                start=start.isoformat(), end=end.isoformat())
        if j and j.get('unix_seconds'):
            raw[pt] = paris_days(j['unix_seconds'], j['forecast_values'])
    days = {}
    d = start
    while d <= end:
        k = d.isoformat()
        g = lambda pt: raw.get(pt, {}).get(k)
        row = {'solar': g('solar'), 'wind': add(g('wind_onshore'), g('wind_offshore')), 'load': g('load')}
        if any(v and any(x is not None for x in v) for v in row.values()):
            days[k] = {kk: [None if x is None else round(x) for x in v] if v else None for kk, v in row.items()}
        d += timedelta(days=1)
    return days


def actuals(zone, start, end):
    j = get('public_power', country=ZONES[zone], start=start.isoformat(), end=end.isoformat())
    if not j:
        return {}
    by = {p['name']: paris_days(j['unix_seconds'], p['data']) for p in j['production_types']}
    out = {}
    for kind, names in ACTUAL_NAME.items():
        for n in names:
            for d, arr in by.get(n, {}).items():
                out.setdefault(d, {})[kind] = add(out.get(d, {}).get(kind), arr)
    return out


def hourly(a):
    if not a:
        return None
    h = []
    for i in range(24):
        v = [x for x in a[i * 4:i * 4 + 4] if x is not None]
        h.append(round(sum(v) / len(v)) if v else None)
    return h


def load_json(p, default):
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def archive(zone, fc, ac):
    """Store hourly day-ahead forecast and actual per day in data/history/forecast/YYYY-MM.json."""
    months = {}
    for d in sorted(set(fc) | set(ac)):
        months.setdefault(d[:7], []).append(d)
    for ym, ds in months.items():
        p = os.path.join(ARCH, ym + '.json')
        j = load_json(p, {'source': 'Energy-Charts.info (TSO day-ahead forecasts, ENTSO-E)', 'unit': 'MW, hourly average, Paris clock', 'days': {}})
        for d in ds:
            z = j['days'].setdefault(d, {}).setdefault(zone, {})
            for kind in KINDS:
                f = hourly((fc.get(d) or {}).get(kind))
                a = hourly((ac.get(d) or {}).get(kind))
                if f and any(x is not None for x in f):
                    z.setdefault(kind, {})['fc'] = f
                if a and any(x is not None for x in a):
                    z.setdefault(kind, {})['act'] = a
        j['days'] = dict(sorted(j['days'].items()))
        write_json(p, j)


def accuracy(zone, today):
    """WAPE and bias of the hourly day-ahead forecast over the last 30 complete days (from the archive)."""
    res = {}
    for kind in KINDS:
        se = sb = sa = 0.0
        nd = 0
        for k in range(1, 31):
            d = (today - timedelta(days=k)).isoformat()
            j = load_json(os.path.join(ARCH, d[:7] + '.json'), {'days': {}})
            z = ((j['days'].get(d) or {}).get(zone) or {}).get(kind) or {}
            f, a = z.get('fc'), z.get('act')
            if not f or not a:
                continue
            pairs = [(x, y) for x, y in zip(f, a) if x is not None and y is not None]
            if len(pairs) < 20:
                continue
            nd += 1
            for x, y in pairs:
                se += abs(x - y); sb += x - y; sa += y
        if nd >= 7 and sa > 0:
            if abs(sb / sa) > 0.5:   # e.g. NL solar: ENTSO-E actuals cover a fraction of the fleet
                res[kind] = {'note': 'actual output reported for only part of the fleet: error not measurable', 'days': nd}
            else:
                res[kind] = {'wape': round(se / sa, 4), 'bias': round(sb / sa, 4), 'days': nd}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--accuracy', action='store_true', help='also fetch the last 30 days and measure the error')
    args = ap.parse_args()
    today = datetime.now(PARIS).date()
    old = load_json(OUT, {})
    out = {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'TSO day-ahead forecasts published on the ENTSO-E transparency platform, via Energy-Charts.info (Fraunhofer ISE)',
        'license': LICENSE,
        'unit': 'MW, quarter-hours of the Paris delivery day',
        'today': today.isoformat(),
        'zones': {},
    }
    for zone in ZONES:
        prev = (old.get('zones') or {}).get(zone) or {}
        try:
            fc = forecasts(zone, today - timedelta(days=1), today + timedelta(days=1))
        except Exception as e:  # keep the last good copy of this zone
            print(f'{zone}: forecast error {e}')
            if prev:
                out['zones'][zone] = prev
            continue
        if args.accuracy:
            try:
                start = today - timedelta(days=31)
                hist = forecasts(zone, start, today - timedelta(days=1))
                act = actuals(zone, start, today - timedelta(days=1))
                archive(zone, hist, act)
            except Exception as e:
                print(f'{zone}: accuracy error {e}')
        else:
            archive(zone, fc, {})
        if zone == 'FR':   # tomorrow's load before Energy-Charts serves it
            tm = today + timedelta(days=1)
            row = fc.get(tm.isoformat()) or {}
            if not row.get('load'):
                ld = entsoe_load(tm)
                if ld:
                    fc[tm.isoformat()] = {'solar': row.get('solar'), 'wind': row.get('wind'), 'load': ld, 'loadFrom': 'ENTSO-E A65'}
        acc = accuracy(zone, today) or prev.get('accuracy') or {}
        days = {d: v for d, v in fc.items() if d >= today.isoformat() or d == (today - timedelta(days=1)).isoformat()}
        out['zones'][zone] = {'days': days, 'accuracy': acc, 'last_day': max(days) if days else None}
        print(zone, sorted(days), {k: v.get('wape', v.get('note')) for k, v in acc.items()})
    if not any(z.get('days') for z in out['zones'].values()):
        print('nothing fetched, keeping the old file')
        return
    write_json(OUT, out)


if __name__ == '__main__':
    main()
