"""
National production of the wind and solar parks under the complément de rémunération
(ODRÉ open data, "Courbes de production mensuelles Eolien & Solaire (complément de
rémunération)", hourly since 2020, 15-min since 2026, updated each month).

It is the real profile of the supported parks, the one the CRE uses for the M0:
scripts/fetch_cre_m0.py weights the day-ahead prices with it (windCR, solarCR) where
it exists, instead of the whole national output.

Out  data/history/cr_production.json  {"updated", "source", "days": {"YYYY-MM-DD": {"wind": [96], "solar": [96]}}}
     (local Paris day, 96 quarter-hours; hourly values repeated ×4), last 40 months
"""
import json, os, sys, urllib.parse, urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'cr_production.json')
DS = 'courbes-de-production-mensuelles-eolien-solaire-complement-de-remuneration'
API = f'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/{DS}/exports/json'
MONTHS = 40


def main():
    t = date.today()
    y, m = t.year, t.month - MONTHS
    while m <= 0:
        y, m = y - 1, m + 12
    q = urllib.parse.urlencode({'select': 'date,heure,prod_eolienne_mw,prod_solaire_mw', 'where': f'date >= date\'{y}-{m:02d}-01\'', 'order_by': 'date_heure'})
    req = urllib.request.Request(f'{API}?{q}', headers={'User-Agent': 'PowerKlock data fetch'})
    rows = json.load(urllib.request.urlopen(req, timeout=180))
    if len(rows) < 1000:
        sys.exit(f'only {len(rows)} rows: previous file kept')
    days = defaultdict(lambda: {'wind': [None] * 96, 'solar': [None] * 96})
    step = defaultdict(set)
    for r in rows:
        d, h = r.get('date'), r.get('heure') or ''
        try:
            hh, mm = int(h[:2]), int(h[3:5])
        except ValueError:
            continue
        step[d].add(mm)
        k = hh * 4 + mm // 15
        if 0 <= k < 96:   # the repeated hour of the last Sunday of October: the two values averaged
            for f, c in (('wind', 'prod_eolienne_mw'), ('solar', 'prod_solaire_mw')):
                v, old = r.get(c), days[d][f][k]
                days[d][f][k] = v if old is None or v is None else (old + v) / 2
    out = {}
    for d, v in sorted(days.items()):
        if step[d] == {0}:   # hourly day: each hour holds its four quarter-hours
            for f in ('wind', 'solar'):
                v[f] = [v[f][(i // 4) * 4] for i in range(96)]
        if sum(1 for x in v['wind'] if x is not None) >= 88:   # a full day (DST days lose or gain an hour)
            out[d] = {f: [None if x is None else int(x) for x in v[f]] for f in ('wind', 'solar')}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'source': f'ODRÉ — {DS} (RTE / EDF OA, national, MW)', 'days': out}, f, separators=(',', ':'))
    print(f'{len(out)} days, {min(out)} → {max(out)}')


if __name__ == '__main__':
    main()
