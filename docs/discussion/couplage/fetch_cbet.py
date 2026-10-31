#!/usr/bin/env python3
"""Scheduled commercial exchanges of France by border, 15 min, Jan. 2020 – Oct. 2026 (Energy-Charts cbet, ENTSO-E
data, CC BY 4.0; public API, no key). Writes /tmp/coupl/cbet_<month>.json; the API rate-limits, hence the pauses."""
import json, urllib.request, time, os
from datetime import date
out = {}
for y in range(2015, 2027):
    for m in range(1, 13):
        if (y, m) > (2026, 10): break
        s = date(y, m, 1); e = date(y + (m == 12), m % 12 + 1, 1)
        f = f'/tmp/coupl/cbet_{y}-{m:02d}.json'
        if os.path.exists(f): continue
        for k in range(5):
            try:
                r = urllib.request.urlopen(f'https://api.energy-charts.info/cbet?country=fr&start={s}&end={e}', timeout=120).read()
                json.loads(r); open(f, 'wb').write(r); print(f, flush=True); break
            except Exception as ex:
                print('retry', f, ex, flush=True); time.sleep(5 * (k + 1))
        time.sleep(6)
