#!/usr/bin/env python3
"""France solar and wind capture, day by day, for Tools › PPA pricer.

Joins RTE éCO2mix output (data/history/rte/YYYY-MM.json, quarter-hours,
Paris day) with day-ahead prices (data/history/daily/YYYY-MM-DD.json) and
writes data/history/fr_capture.json:
  {"updated", "fields": [...], "days": [[date, ...fields], ...],
   "profile": {"YYYY": {"solar": 12×24 MW, "wind": 12×24 MW}}}
Per day, for both conventions used by the pricer:
  all hours      — capture = Σ(output × price) / Σ output, baseload = mean price
  price > 0 only — the PPA Dashboard convention: hours with a price ≤ 0 are
                   left out of both the capture price and the baseload
Sums are kept (not ratios) so the page can aggregate any window: year,
month, rolling 30 / 90 / 365 days.
"""
import glob
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RTE = os.path.join(ROOT, 'data', 'history', 'rte')
DAILY = os.path.join(ROOT, 'data', 'history', 'daily')
OUT = os.path.join(ROOT, 'data', 'history', 'fr_capture.json')
FIELDS = ['pSum', 'pN', 'pSumPos', 'pNPos',
          'sE', 'sR', 'sEPos', 'sRPos',
          'wE', 'wR', 'wEPos', 'wRPos']


def prices(day):
    try:
        with open(os.path.join(DAILY, day + '.json')) as f:
            h = (json.load(f).get('zones') or {}).get('FR', {}).get('hourly')
    except (OSError, ValueError):
        return None
    if not isinstance(h, list) or len(h) not in (24, 96):
        return None
    return [x for x in h for _ in range(4)] if len(h) == 24 else h


def main():
    rows, prof = [], {}
    for path in sorted(glob.glob(os.path.join(RTE, '[0-9][0-9][0-9][0-9]-[0-9][0-9].json'))):
        with open(path) as f:
            days = json.load(f).get('days') or {}
        for day in sorted(days):
            r = days[day]
            sol, win = r.get('solar') or [], r.get('wind') or []
            if len(sol) != 96 or len(win) != 96:
                continue
            y, m = day[:4], int(day[5:7]) - 1
            pr = prof.setdefault(y, {'solar': [[0.0] * 24 for _ in range(12)], 'wind': [[0.0] * 24 for _ in range(12)], 'n': [[0] * 24 for _ in range(12)]})
            for q in range(96):
                h = q // 4
                pr['solar'][m][h] += sol[q] or 0
                pr['wind'][m][h] += win[q] or 0
                pr['n'][m][h] += 1
            p = prices(day)
            if not p:
                continue
            acc = dict.fromkeys(FIELDS, 0.0)
            for q in range(96):
                v = p[q]
                if v is None:
                    continue
                s, w = max(0.0, sol[q] or 0.0), max(0.0, win[q] or 0.0)
                acc['pSum'] += v; acc['pN'] += 1
                acc['sE'] += s; acc['sR'] += s * v; acc['wE'] += w; acc['wR'] += w * v
                if v > 0:
                    acc['pSumPos'] += v; acc['pNPos'] += 1
                    acc['sEPos'] += s; acc['sRPos'] += s * v; acc['wEPos'] += w; acc['wRPos'] += w * v
            if acc['pN']:
                rows.append([day] + [round(acc[k], 1) for k in FIELDS])
    profile = {}
    for y, pr in prof.items():
        profile[y] = {k: [[round(pr[k][m][h] / pr['n'][m][h]) if pr['n'][m][h] else None for h in range(24)] for m in range(12)] for k in ('solar', 'wind')}
    with open(OUT, 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'source': 'RTE éCO2mix output × ENTSO-E day-ahead France', 'unit': 'MW·quarter-hour, €/MWh',
                   'fields': FIELDS, 'days': rows, 'profile': profile}, f, separators=(',', ':'))
    print(f'{len(rows)} days, {rows[0][0] if rows else "-"} → {rows[-1][0] if rows else "-"}, {os.path.getsize(OUT) // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
