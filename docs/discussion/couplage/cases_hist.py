#!/usr/bin/env python3
"""Share of time in each of the four coupled cases, 2015 – Oct. 2026 (exporter / importer × line to Belgium and
Germany saturated or not). 2020 onwards: cases5.json (quarter-hours, ENTSO-E prices). 2015–2019: hourly day-ahead
prices of France, Belgium and Germany (DE-AT-LU until 30 Sept. 2018, DE-LU after) from Energy-Charts (public API,
same ENTSO-E / exchange prices), and France's commercial exchanges (Energy-Charts cbet), fetched to /tmp/coupl by
fetch_prices_old.py and fetch_cbet.py. Same rules as cases5.py (four cases + mixed). Output: cases_hist.json"""
import json, glob
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import numpy as np
PAR = ZoneInfo('Europe/Paris')

def hourly(files):
    """{(date, hour): value} in Paris time from Energy-Charts unix-second series (mean if several per hour)"""
    acc = {}
    for f in files:
        j = json.load(open(f))
        for t, v in zip(j['unix_seconds'], j['price']):
            if v is None:
                continue
            d = datetime.fromtimestamp(t, timezone.utc).astimezone(PAR)
            acc.setdefault((d.date().isoformat(), d.hour), []).append(v)
    return {k: float(np.mean(v)) for k, v in acc.items()}

out = {}
FR = hourly(glob.glob('/tmp/coupl/price_FR_*.json')); BE = hourly(glob.glob('/tmp/coupl/price_BE_*.json'))
DE = hourly(glob.glob('/tmp/coupl/price_DE_*.json'))
NX = {}
for f in glob.glob('/tmp/coupl/cbet_201[5-9]-*.json'):
    j = json.load(open(f)); tot = np.zeros(len(j['unix_seconds']))
    for c in j['countries']:
        if c['name'] != 'sum':
            tot += np.array([0 if x is None else x for x in c['data']], float)
    acc = {}
    for t, v in zip(j['unix_seconds'], tot):
        d = datetime.fromtimestamp(t, timezone.utc).astimezone(PAR)
        acc.setdefault((d.date().isoformat(), d.hour), []).append(-v * 1000)          # + export, MW
    NX.update({k: float(np.mean(v)) for k, v in acc.items()})
for y in range(2015, 2020):
    cnt = {'exp_free': 0, 'exp_sat': 0, 'imp_free': 0, 'imp_sat': 0, 'mix_dearer': 0, 'mixed': 0}; px = {k: [] for k in cnt}; n = 0
    for k, p in FR.items():
        if not k[0].startswith(str(y)) or k not in BE or k not in DE or k not in NX:
            continue
        core = abs(p - BE[k]) < 0.01 and abs(p - DE[k]) < 0.01
        exp = NX[k] > 0
        if core:
            c = 'exp_free' if exp else 'imp_free'
        elif exp and p < min(BE[k], DE[k]) - 0.005:
            c = 'exp_sat'
        elif not exp and p > max(BE[k], DE[k]) + 0.005:
            c = 'imp_sat'
        elif exp and p > max(BE[k], DE[k]) + 0.005:
            c = 'mix_dearer'
        else:
            c = 'mixed'
        cnt[c] += 1; px[c].append((p, DE[k])); n += 1
    out[y] = {c: dict(hours=v, share=round(v / n, 3) if n else None,
                      fr=round(float(np.mean([a for a, _ in px[c]])), 1) if px[c] else None,
                      de=round(float(np.mean([b for _, b in px[c]])), 1) if px[c] else None) for c, v in cnt.items()}
    out[y]['_hours'] = n
    print(y, n, {c: v['share'] for c, v in out[y].items() if c != '_hours'})
C5 = json.load(open('cases5.json'))
for y, v in C5.items():
    out[int(y)] = {c: dict(hours=w['hours'], share=w['share'], fr=w['fr'], de=w['de']) for c, w in v.items()}
json.dump({str(k): out[k] for k in sorted(out)}, open('cases_hist.json', 'w'), indent=1)
