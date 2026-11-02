#!/usr/bin/env python3
"""France solar and wind capture, day by day, for Tools › PPA pricer.

Joins RTE éCO2mix output (data/history/rte/YYYY-MM.json, quarter-hours,
Paris day) with day-ahead prices (data/history/daily/YYYY-MM-DD.json) and
writes data/history/fr_capture.json:
  {"updated", "fields": [...], "days": [[date, ...fields], ...],
   "profile": {"YYYY": {"solar": 12×24 MW, "wind": 12×24 MW}}}
Per day, for both conventions used by the pricer:
  all hours      — capture = Σ(output × price) / Σ output, baseload = mean price
  price ≥ 0 only — the park stops strictly below 0 €/MWh (Tom 1 Nov. 2026; until then ≤ 0): the 'curt'
                   convention keeps every hour in the baseload, the legacy 'pos' one leaves the stopped
                   hours out of both
Also 'stopT': for a stop threshold T other than 0 (stop when the price is below T), each month's capture and
paid share at T ÷ at 0, national profile, the last two complete years' quarter-hours (the pricer scales the
generator's months with it)
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


GRID = [-100, -50, -30, -20, -10, -5, -2, -1, 0, 5, 10, 20, 30, 50]   # -2 and -1: the step is just below 0 (the −0.01 € hours)


def threshold_table(rows_q):
    """per technology and month: capture rate and paid share with a stop below T ÷ the same with a stop below 0,
    on the last two complete years (quarter-hours, national output), pooled and year by year ('byYear': the pricer
    carries the gap's trend to the delivery year for thresholds below 0, scripts/ppa_threshold_test.py)"""
    this = datetime.now(timezone.utc).year
    ys = [y for y in sorted(rows_q) if int(y) < this and len(rows_q[y]) >= 360][-2:]
    if not ys:
        return None
    out = {'years': [int(y) for y in ys], 'grid': GRID}
    # year by year: the two complete years and the running one (its months so far: a month with too few days is left
    # empty), so the pricer can take, month by month, the two latest years that have it
    yb = ys + [y for y in sorted(rows_q) if int(y) == this]
    # a park that runs below 0 produces its full output in those hours, while the national output there is already cut
    # by the parks that stop (large solar keeps about half): the ratios are taken on the output rebuilt without stops
    # (scripts/build_flex_share.py; replay 2023–2026 against a truth on rebuilt output, solar at −1 € +2.1 €/MWh off on
    # average against +2.9 on the national output, wind −0.2 against +0.6)
    pot = _potential(rows_q, yb)
    out['output'] = 'rebuilt without stops below 0'
    for k, ix in (('solar', 2), ('wind', 3)):
        out[k] = _ratios(pot, ys, ix)
        out[k]['byYear'] = {str(y): _ratios(pot, [y], ix, min_days=20) for y in yb}
    return out


def _potential(rows_q, ys):
    """the same rows with solar and wind output rebuilt where the price is below 0 (solar: the month's shape of days without
    a negative price, scaled on the day's other quarter-hours; wind: a line across each negative run, from one hour before
    to one hour after, as the parks stop ahead of it)"""
    import numpy as np
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from build_flex_share import solar_pot, wind_pot
    out = {}
    for y in ys:
        rows = rows_q[y]
        P = np.array([[np.nan if v is None else v for v in r[1]] for r in rows], float)
        Pz = np.where(np.isnan(P), 1.0, P)   # a missing price: not a stop
        S = np.array([[max(0.0, v or 0.0) for v in r[2]] for r in rows], float)
        W = np.array([[max(0.0, v or 0.0) for v in r[3]] for r in rows], float)
        mon = np.array([r[0] + 1 for r in rows])
        Sp, Wp = solar_pot(S, Pz, mon), wind_pot(W, Pz, pad=4)
        out[y] = [(r[0], r[1], list(Sp[i]), list(Wp[i])) for i, r in enumerate(rows)]
    return out


def _ratios(rows_q, ys, ix, min_days=0):
    cap, paid = {}, {}
    days = [sum(1 for y in ys for r in rows_q[y] if r[0] == m) for m in range(12)]
    for T in GRID:
        cr, pr = [], []
        for m in range(12):
            if days[m] < min_days:
                cr.append(None); pr.append(None)
                continue
            sP = n = e = ep = rp = 0.0
            for y in ys:
                for (mm, p, *vv) in rows_q[y]:
                    if mm != m:
                        continue
                    out_ = vv[ix - 2]
                    for q in range(96):
                        v = p[q]
                        if v is None:
                            continue
                        g = max(0.0, out_[q] or 0.0)
                        sP += v; n += 1; e += g
                        if v >= T:
                            ep += g; rp += g * v
            base = sP / n if n else 0
            cr.append(rp / ep / base if ep > 0 and base > 0 else None)
            pr.append(ep / e if e > 0 else None)
        cap[T], paid[T] = cr, pr
    return {'capture': {str(T): [round(c / c0, 4) if c is not None and c0 else None for c, c0 in zip(cap[T], cap[0])] for T in GRID},
            'paid': {str(T): [round(c / c0, 4) if c is not None and c0 else None for c, c0 in zip(paid[T], paid[0])] for T in GRID}}


def main():
    rows, prof, rows_q = [], {}, {}
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
            rows_q.setdefault(y, []).append((m, p, sol, win))
            acc = dict.fromkeys(FIELDS, 0.0)
            for q in range(96):
                v = p[q]
                if v is None:
                    continue
                s, w = max(0.0, sol[q] or 0.0), max(0.0, win[q] or 0.0)
                acc['pSum'] += v; acc['pN'] += 1
                acc['sE'] += s; acc['sR'] += s * v; acc['wE'] += w; acc['wR'] += w * v
                if v >= 0:
                    acc['pSumPos'] += v; acc['pNPos'] += 1
                    acc['sEPos'] += s; acc['sRPos'] += s * v; acc['wEPos'] += w; acc['wRPos'] += w * v
            if acc['pN']:
                rows.append([day] + [round(acc[k], 1) for k in FIELDS])
    stop_t = threshold_table(rows_q)
    profile = {}
    for y, pr in prof.items():
        profile[y] = {k: [[round(pr[k][m][h] / pr['n'][m][h]) if pr['n'][m][h] else None for h in range(24)] for m in range(12)] for k in ('solar', 'wind')}
    with open(OUT, 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'source': 'RTE éCO2mix output × ENTSO-E day-ahead France', 'unit': 'MW·quarter-hour, €/MWh',
                   'fields': FIELDS, 'days': rows, 'profile': profile, 'stopT': stop_t}, f, separators=(',', ':'))
    print(f'{len(rows)} days, {rows[0][0] if rows else "-"} → {rows[-1][0] if rows else "-"}, {os.path.getsize(OUT) // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
