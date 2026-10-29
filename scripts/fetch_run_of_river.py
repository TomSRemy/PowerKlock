#!/usr/bin/env python3
"""Daily run-of-river hydro output of France, Germany, Belgium and Spain (Energy-Charts public power, Fraunhofer ISE,
type "Hydro Run-of-River"), for the PPA scenario generator (scripts/ppa_scenarios.py): it follows the rain, not the
prices (reservoirs produce when power is dear, so they are left out), and lowers the residual load that sets the
price. Replay 2021–2025 with the same learning years (scripts/ppa_scenarios.py notes): solar 2.04 → 1.69 €/MWh, wind
3.41 → 3.30 with it.

Writes data/history/run_of_river_daily.json  {"updated", "source", "unit": "MW (daily mean)", "countries": {"FR":
{"2024-04-01": 6123.4, …}, …}}. Each run refetches the previous and the current year; --all from 2020.
    python scripts/fetch_run_of_river.py [--all]
"""
import json
import os
import sys
import time
from datetime import date, datetime, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'run_of_river_daily.json')
CC = {'FR': 'fr', 'DE': 'de', 'BE': 'be', 'ES': 'es'}
API = 'https://api.energy-charts.info/public_power'


def year(cc, y):
    """{date: MW daily mean} of one country and year, or None without an answer (rate limits are retried)"""
    for k in range(4):
        r = requests.get(API, params={'country': cc, 'start': f'{y}-01-01', 'end': f'{y}-12-31'}, timeout=180)
        if r.status_code == 200:
            d = r.json()
            pt = [p for p in d.get('production_types', []) if p['name'] == 'Hydro Run-of-River']
            acc = {}
            for t, v in zip(d.get('unix_seconds', []), pt[0]['data'] if pt else []):
                if v is not None:
                    acc.setdefault(datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%d'), []).append(v)
            return {k_: round(sum(a) / len(a), 1) for k_, a in acc.items()}
        time.sleep(30 * (k + 1))
    print(f'  {cc} {y}: no answer ({r.status_code})')
    return None


def main():
    try:
        out = json.load(open(OUT))
    except (OSError, ValueError):
        out = {'countries': {}}
    years = range(2020, date.today().year + 1) if '--all' in sys.argv else (date.today().year - 1, date.today().year)
    for c, cc in CC.items():
        dst = out['countries'].setdefault(c, {})
        for y in years:
            v = year(cc, y)
            if v:
                dst.update(v)
            print(c, y, len(v or {}), 'days', flush=True)
            time.sleep(5)
    out.update({'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'unit': 'MW (daily mean)',
                'source': 'Energy-Charts public power (Fraunhofer ISE), Hydro Run-of-River, CC BY 4.0'})
    out['countries'] = {c: dict(sorted(v.items())) for c, v in out['countries'].items()}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
