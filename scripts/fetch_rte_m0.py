#!/usr/bin/env python3
"""Monthly M0 reference prices for wind and solar (France, complément de rémunération).

Production curves: RTE dataset "Courbes de production mensuelles Eolien &
Solaire (complément de rémunération)" on ODRÉ (open licence, Etalab 2.0),
national, hourly until April 2026 and 15-min from May 2026, published once a
month. Prices: France day-ahead from data/history/daily (EPEX/ENTSO-E,
96 quarter-hour slots per Paris delivery day).

M0 = Σ(price × production) / Σ production over the calendar month, the
weighting the CRE uses for the reference price. Figures are recomputed here
and can differ marginally from the values the CRE publishes.

Writes data/m0.json.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(ROOT, 'data', 'history', 'daily')
OUT = os.path.join(ROOT, 'data', 'm0.json')
DATASET = 'courbes-de-production-mensuelles-eolien-solaire-complement-de-remuneration'
URL = ('https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/' + DATASET +
       '/exports/json?select=date,heure,prod_eolienne_mw,prod_solaire_mw&order_by=date_heure')


def load_curves(path=None):
    if path:
        with open(path) as f:
            return json.load(f)
    req = urllib.request.Request(URL, headers={'User-Agent': 'PowerKlock/1.0'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


_prices = {}


def fr_prices(day):
    """96 FR day-ahead slots (Paris clock) for a delivery day, or None."""
    if day not in _prices:
        arr = None
        try:
            with open(os.path.join(DAILY, day + '.json')) as f:
                z = (json.load(f).get('zones') or {}).get('FR') or {}
            h = z.get('hourly')
            if isinstance(h, list) and len(h) == 96 and any(v is not None for v in h):
                arr = h
        except (OSError, ValueError):
            pass
        _prices[day] = arr
    return _prices[day]


def main():
    rows = load_curves(sys.argv[1] if len(sys.argv) > 1 else None)
    # month → accumulators
    acc = defaultdict(lambda: {'pw': 0.0, 'w': 0.0, 'ps': 0.0, 's': 0.0, 'wneg': 0.0, 'sneg': 0.0,
                               'wall': 0.0, 'sall': 0.0, 'n': 0, 'miss': 0, 'step': 60, 'days': set()})
    for r in rows:
        day, hhmm = r.get('date'), r.get('heure')
        if not day or not hhmm:
            continue
        wind = r.get('prod_eolienne_mw') or 0
        solar = r.get('prod_solaire_mw') or 0
        hh, mm = int(hhmm[:2]), int(hhmm[3:5])
        m = acc[day[:7]]
        step = 15 if mm % 60 else (15 if m['step'] == 15 else 60)
        m['wall'] += wind
        m['sall'] += solar
        prices = fr_prices(day)
        if prices is None:
            m['miss'] += 1
            continue
        # A row covers its own quarter-hour, or a whole hour on the hourly part.
        i0 = hh * 4 + mm // 15
        span = 1 if (mm or step == 15) else 4
        vals = [prices[i] for i in range(i0, min(i0 + span, 96)) if prices[i] is not None]
        if not vals:
            m['miss'] += 1
            continue
        p = sum(vals) / len(vals)
        m['pw'] += p * wind
        m['w'] += wind
        m['ps'] += p * solar
        m['s'] += solar
        if p < 0:
            m['wneg'] += wind
            m['sneg'] += solar
        m['n'] += 1
        m['days'].add(day)
        if mm:
            m['step'] = 15

    months = []
    for ym in sorted(acc):
        m = acc[ym]
        # Monthly baseload from the same daily files (every published slot).
        base_v = []
        for d in sorted(m['days']):
            base_v.extend(v for v in fr_prices(d) if v is not None)
        base = sum(base_v) / len(base_v) if base_v else None
        if not m['w'] or base is None:
            continue
        wind_m0 = m['pw'] / m['w']
        solar_m0 = m['ps'] / m['s'] if m['s'] else None
        months.append({
            'month': ym,
            'base': round(base, 2),
            'windM0': round(wind_m0, 2),
            'solarM0': round(solar_m0, 2) if solar_m0 is not None else None,
            'windRatio': round(wind_m0 / base, 4) if base > 0 else None,
            'solarRatio': round(solar_m0 / base, 4) if base > 0 and solar_m0 is not None else None,
            'windAvgMW': round(m['wall'] / max(1, m['n'] + m['miss'])),
            'solarAvgMW': round(m['sall'] / max(1, m['n'] + m['miss'])),
            'windNegShare': round(m['wneg'] / m['w'], 4) if m['w'] else None,
            'solarNegShare': round(m['sneg'] / m['s'], 4) if m['s'] else None,
            'days': len(m['days']),
            'step': m['step'],
            'missingRows': m['miss'],
            'complete': m['miss'] == 0,
        })
    out = {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'RTE via ODRÉ (production curves, Etalab 2.0); France day-ahead prices from PowerKlock history',
        'method': 'M0 = sum(price x production) / sum(production) over the month; recomputed, may differ marginally from CRE publications',
        'months': months,
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('m0.json: %d months, %s → %s' % (len(months), months[0]['month'] if months else '-',
                                             months[-1]['month'] if months else '-'))
    for m in months[-4:]:
        print('  ', m)


if __name__ == '__main__':
    main()
