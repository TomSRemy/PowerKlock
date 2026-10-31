#!/usr/bin/env python3
"""Hourly day-ahead prices of France, Belgium and Germany 2015–2019 (Energy-Charts public API, no key), for
cases_hist.py. Writes /tmp/coupl/price_<zone>_<year>.json; the API rate-limits, hence the pauses."""
import json, urllib.request, time, os
jobs = []
for y in range(2015, 2020):
    for z in ('FR', 'BE'):
        jobs.append((z, f'{y}-01-01', f'{y + 1}-01-01', f'{z}_{y}'))
    if y < 2018:
        jobs.append(('DE-AT-LU', f'{y}-01-01', f'{y + 1}-01-01', f'DE_{y}'))
    elif y == 2018:
        jobs.append(('DE-AT-LU', '2018-01-01', '2018-10-01', 'DE_2018a')); jobs.append(('DE-LU', '2018-10-01', '2019-01-01', 'DE_2018b'))
    else:
        jobs.append(('DE-LU', '2019-01-01', '2020-01-01', 'DE_2019'))
for z, s, e, name in jobs:
    f = f'/tmp/coupl/price_{name}.json'
    if os.path.exists(f): continue
    for k in range(6):
        try:
            r = urllib.request.urlopen(f'https://api.energy-charts.info/price?bzn={z}&start={s}&end={e}', timeout=120).read()
            json.loads(r); open(f, 'wb').write(r); print(f, flush=True); break
        except Exception as ex:
            print('retry', f, ex, flush=True); time.sleep(8 * (k + 1))
    time.sleep(6)
