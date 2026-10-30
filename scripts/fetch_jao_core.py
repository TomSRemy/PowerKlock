#!/usr/bin/env python3
"""Flow-based limits of the Core day-ahead coupling: each hour's minimum and maximum net position of France and its
Core neighbours (Belgium, Germany, the Netherlands, Austria), from JAO's publication tool (public API, no key).

The maximum net position of France is how much it can export inside Core that hour (Belgium and Germany borders and
through them); when its surplus is larger, its price leaves its neighbours' (the PPA scenario generator's merit order,
docs/discussion/merit-order-plan.md). Published every day for the next one; history from the Core go-live (8 June 2022).

Writes data/history/jao_core/YYYY.json
    {"year", "source", "unit": "MW", "zones": [...],
     "days": {Paris day: {"maxFR": [24], "minFR": [24], ...}}}   (local hours; the spring hour repeats the one before,
                                                                   the autumn extra hour is dropped)
    python scripts/fetch_jao_core.py                    # the last 10 days and tomorrow
    python scripts/fetch_jao_core.py --since 2022-06-08 [--until 2022-12-31]   # backfill
"""
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

API = 'https://publicationtool.jao.eu/core/api/data/maxNetPos'
OUT = Path('data/history/jao_core')
ZONES = ('FR', 'BE', 'DE', 'NL', 'AT')
PARIS = ZoneInfo('Europe/Paris')
UA = {'User-Agent': 'PowerKlock (github.com/TomSRemy/PowerKlock)'}


def get(t0, t1):
    """hourly records between two UTC instants (the API takes at most 2 days)"""
    for k in range(4):
        try:
            r = requests.get(API, params={'FromUtc': t0.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'ToUtc': t1.strftime('%Y-%m-%dT%H:%M:%S.000Z')},
                             headers=UA, timeout=120)
            if r.status_code == 200:
                return r.json().get('data') or []
        except (requests.RequestException, ValueError):
            pass
        time.sleep(5 * (k + 1))
    return None


def main():
    if '--since' in sys.argv:
        d0 = date.fromisoformat(sys.argv[sys.argv.index('--since') + 1])
    else:
        d0 = date.today() - timedelta(days=10)
    d1 = date.fromisoformat(sys.argv[sys.argv.index('--until') + 1]) if '--until' in sys.argv else date.today() + timedelta(days=1)
    by_hour = {}
    # 48 UTC hours per request (the API refuses more: a Paris day can last 25 hours)
    t = datetime(d0.year, d0.month, d0.day, tzinfo=PARIS).astimezone(timezone.utc)
    end = datetime(d1.year, d1.month, d1.day, tzinfo=PARIS).astimezone(timezone.utc) + timedelta(days=1)
    while t < end:
        t1 = min(t + timedelta(hours=48), end)
        rows = get(t, t1)
        if rows is None:
            print(t.date(), 'no answer', flush=True)
        else:
            for r in rows:
                u = datetime.fromisoformat(r['dateTimeUtc'].replace('Z', '+00:00'))
                by_hour[int(u.timestamp()) // 3600] = {f'{k}{z}': r.get(f'{k}{z}') for z in ZONES for k in ('min', 'max')}
        t = t1
        time.sleep(0.5)
    # Paris days, 24 local hours
    days = {}
    for h in sorted(by_hour):
        loc = datetime.fromtimestamp(h * 3600, timezone.utc).astimezone(PARIS)
        days.setdefault(loc.date().isoformat(), {})[loc.hour] = by_hour[h]
    OUT.mkdir(parents=True, exist_ok=True)
    years = {}
    for day, hours in days.items():
        row = {}
        for key in (f'{k}{z}' for z in ZONES for k in ('min', 'max')):
            vals, last = [], None
            for h in range(24):
                v = (hours.get(h) or {}).get(key)
                last = v if v is not None else last
                vals.append(last)
            if any(v is not None for v in vals):
                row[key] = vals
        if row:
            years.setdefault(day[:4], {})[day] = row
    for y, dd in years.items():
        f = OUT / f'{y}.json'
        doc = json.loads(f.read_text()) if f.exists() else {'year': int(y), 'source': 'JAO publication tool, Core flow-based day-ahead coupling, maximum and minimum net positions (publicationtool.jao.eu/core)',
                                                           'unit': 'MW (+ export, − import)', 'zones': list(ZONES), 'days': {}}
        doc['days'].update(dd)
        doc['days'] = dict(sorted(doc['days'].items()))
        f.write_text(json.dumps(doc, separators=(',', ':')))
        print(y, len(doc['days']), 'days', flush=True)


if __name__ == '__main__':
    main()
