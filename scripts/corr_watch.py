#!/usr/bin/env python3
"""Correlation breaks: pairs of markets that usually move together (or not), watched every day.

For each pair, the correlation of day-to-day changes over the last 60 quoted days against the
last year: a gap of 0.3 or more is a break (the link tightens or loosens). Day-to-day changes, not
levels: on levels anything that rises over the same months looks related.

Series (same ids as Tools › Comparator, js/compare.js):
  cal:FR:<Y+1>, cal:DE:<Y+1>   next calendar year, data/history/fr_market_calchain.json
  c:ttf, c:eua, c:coal, c:brent  data/history/commodities_series.json
  spot:FR                        France day-ahead daily mean, data/history/fr_hourly/<year>.json

Writes data/corr_watch.json   {"updated", "window", "pairs": [{"a", "b", "c60", "c365", "delta", "break", "n60"}]}
    python scripts/corr_watch.py
"""
import json
import os
from datetime import date, datetime, timezone

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(ROOT, 'data', 'corr_watch.json')
GAP = 0.3


def load(p):
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def series():
    y1 = str(date.today().year + 1)
    out = {}
    ch = load(os.path.join(H, 'fr_market_calchain.json')) or {}
    for c in ('FR', 'DE'):
        y = ((ch.get(c) or {}).get('years') or {}).get(y1)
        if y:
            out[f'cal:{c}:{y1}'] = {d: v for d, v in zip(y['dates'], y['values']) if v is not None}
    cs = (load(os.path.join(H, 'commodities_series.json')) or {}).get('series') or {}
    for k in ('ttf', 'eua', 'coal', 'brent'):
        if k in cs:
            out['c:' + k] = {d: v for d, v in cs[k]['points'] if v is not None}
    sp = {}
    for yr in (date.today().year - 1, date.today().year):
        j = load(os.path.join(H, 'fr_hourly', f'{yr}.json')) or {}
        for d, v in (j.get('days') or {}).items():
            p = [x for x in v.get('p') or [] if x is not None]
            if p:
                sp[d] = sum(p) / len(p)
    out['spot:FR'] = sp
    return out, y1


def corr(a, b, days, n):
    ds = [d for d in days if d in a and d in b][-(n + 1):]
    if len(ds) < min(40, n // 2):
        return None, len(ds)
    x = np.diff([a[d] for d in ds]); y = np.diff([b[d] for d in ds])
    if x.std() == 0 or y.std() == 0:
        return None, len(ds)
    return float(np.corrcoef(x, y)[0, 1]), len(ds)


def main():
    S, y1 = series()
    cal, cde = f'cal:FR:{y1}', f'cal:DE:{y1}'
    pairs = [(cal, 'c:ttf'), (cal, cde), ('c:ttf', 'c:eua'), ('c:ttf', 'c:coal'), (cal, 'c:eua'), ('spot:FR', 'c:ttf'), ('c:ttf', 'c:brent')]
    res = []
    for a, b in pairs:
        if a not in S or b not in S:
            continue
        days = sorted(set(S[a]) | set(S[b]))
        c60, n60 = corr(S[a], S[b], days, 60)
        c365, _ = corr(S[a], S[b], days, 250)
        if c60 is None or c365 is None:
            continue
        d = c60 - c365
        res.append({'a': a, 'b': b, 'c60': round(c60, 3), 'c365': round(c365, 3), 'delta': round(d, 3), 'break': abs(d) >= GAP, 'n60': n60})
    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'window': {'short': 60, 'long': 250, 'gap': GAP},
           'method': 'Correlation of day-to-day changes over the last 60 quoted days against the last 250 (about a year); a gap of 0.3 or more is a break.',
           'pairs': res}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(*[f"{r['a']} / {r['b']}: {r['c365']:+.2f} → {r['c60']:+.2f}{'  BREAK' if r['break'] else ''}" for r in res], sep='\n')


if __name__ == '__main__':
    main()
