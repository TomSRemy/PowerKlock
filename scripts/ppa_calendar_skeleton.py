#!/usr/bin/env python3
"""Method 3 (forme forward), walk-forward test of the calendar skeleton Tom asked for (brief 2.2
item 5): a coefficient per real day type (weekday in term time, Saturday, Sunday, public holiday,
bridge day "pont", weekday during a school holiday) instead of today's (month, weekday/Sat/Sun,
hour) skeleton — matched against the same day type in past years, same test as scripts/ppa_backtest.py.

Day type (priority order, a day is only one type):
  hol     a public holiday (calendrier.api.gouv.fr)
  bridge  a weekday next to a holiday that bridges it to a weekend ("pont": Monday before a Tuesday
          holiday, Friday after a Thursday holiday)
  sat/sun weekend
  vac     a weekday when every school zone (A, B and C) is on holiday at once (Toussaint, Christmas,
          summer — the zones that stagger apart, February/Easter, are left as ordinary weekdays: a
          known simplification, see LIMITATIONS)
  week    an ordinary school-term weekday

This only changes the 'f' profile-cost term's skeleton (the (month, day type, hour) ratio to the
month average); the cannibalisation term 'c' is untouched, same as ppa_backtest.m_fpc. Needs
data/history/calendar_days.json (scripts/fetch_calendar_days.py).

Writes data/history/ppa_calendar_skeleton.json
    python scripts/ppa_calendar_skeleton.py
"""
import json
import math
import os
import sys
from datetime import date, timedelta

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_backtest as B   # noqa: E402
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_calendar_skeleton.json')
CAL_DATA = json.load(open(os.path.join(ROOT, 'data', 'history', 'calendar_days.json')))
HOLIDAYS = set(CAL_DATA['holidays'])
VAC_RANGES = {z: [(date.fromisoformat(s), date.fromisoformat(e)) for s, e in v] for z, v in CAL_DATA['vacations'].items()}
LIMITATIONS = (
    "'vac' only fires when zones A, B and C are on holiday on the same day — February and Easter "
    "break are staggered by zone and a park-level pricer would need the park's own académie; this "
    "national test instead treats staggered weeks as ordinary weekdays, understating the vacation "
    "effect on those two breaks."
)


def in_vacation_all_zones(d):
    return all(any(s <= d < e for s, e in VAC_RANGES[z]) for z in ('A', 'B', 'C'))


def day_type(d):
    iso = d.isoformat()
    if iso in HOLIDAYS:
        return 'hol'
    wd = d.weekday()
    if wd == 0 and (d + timedelta(days=1)).isoformat() in HOLIDAYS:
        return 'bridge'
    if wd == 4 and (d - timedelta(days=1)).isoformat() in HOLIDAYS:
        return 'bridge'
    if wd == 5:
        return 'sat'
    if wd == 6:
        return 'sun'
    if in_vacation_all_zones(d):
        return 'vac'
    return 'week'


TYPES = ('week', 'sat', 'sun', 'hol', 'bridge', 'vac')
DT = np.array([day_type(date.fromordinal(int(o))) for o in B.DAY])


def shape_coef_calendar(train):
    co = {}
    idx = np.isin(B.yr, train)
    for m in range(1, 13):
        for dt_ in TYPES:
            for h in range(24):
                i = idx & (B.mo == m) & (DT == dt_) & (B.hr == h)
                co[(m, dt_, h)] = float((B.P[i] / B.mavg[i]).mean()) if i.any() else None
    # a (month, type) with no day of that type in training borrows the month's 'week' coefficient
    for m in range(1, 13):
        for dt_ in TYPES:
            for h in range(24):
                if co[(m, dt_, h)] is None:
                    co[(m, dt_, h)] = co.get((m, 'week', h)) or 1.0
    mc = {}
    for m in range(1, 13):
        v = []
        for y in train:
            i = (B.yr == y) & (B.mo == m)
            if i.any():
                v.append(B.P[i].mean() / B.P[B.yr == y].mean())
        mc[m] = float(np.mean(v)) if v else 1.0
    return co, mc


def m_fpc_calendar(t, Y, train, V):
    co, mc = shape_coef_calendar(train)
    days = [date.fromordinal(o) for o in range(date(Y, 1, 1).toordinal(), date(Y + 1, 1, 1).toordinal())]
    prof = {}
    for m in range(1, 13):
        for h in range(24):
            i = np.isin(B.yr, train) & (B.mo == m) & (B.hr == h)
            lf = V[i] / np.array([B.CAP[t][int(y)] for y in B.yr[i]])
            prof[(m, h)] = lf.mean() if i.any() else 0
    sk, pv = [], []
    for d in days:
        for h in range(24):
            sk.append(mc[d.month] * co[(d.month, day_type(d), h)]); pv.append(prof[(d.month, h)])
    sk, pv = np.array(sk), np.array(pv)
    f = (pv * sk).sum() / pv.sum() / sk.mean() - 1
    cs = []
    for y in train:
        i = B.yr == y
        co_y, _ = co, mc
        c = np.array([co_y[(int(m), dt_, int(h))] for m, dt_, h in zip(B.mo[i], DT[i], B.hr[i])])
        ks = B.key[i]
        pt = np.zeros(i.sum())
        for k in np.unique(ks):
            j = ks == k
            pt[j] = c[j] / c[j].mean() * B.mavg[i][j]
        cs.append(B.rate(i, V, B.P) - (V[i] * pt).sum() / V[i].sum() / pt.mean())
    last = train[-1]
    b = B.logfit([B.CAP[t][y] for y in train], cs) if len(train) >= 3 else 0
    c = cs[-1] + b * (math.log(B.cap_guess(t, Y, last)) - math.log(B.CAP[t][last]))
    return 1 + f + c


def main():
    out = {'protocol': B.__doc__.split('\n')[0], 'note': LIMITATIONS, 'rows': []}
    for t, V in (('s', B.S), ('w', B.W)):
        for Y in B.TARGETS:
            train = [y for y in B.YEARS if y < Y and y != 2022]
            if len(train) < 3:
                continue
            real = B.rate(B.yr == Y, V, B.P)
            fpc_today = B.m_fpc(t, Y, train, V)
            fpc_cal = m_fpc_calendar(t, Y, train, V)
            row = {'tech': 'solar' if t == 's' else 'wind', 'year': Y, 'actual': real,
                   'fpc': fpc_today, 'fpcCalendar': fpc_cal}
            out['rows'].append(row)
            print(row['tech'], Y, 'actual %.3f fpc %.3f fpcCalendar %.3f' % (real, fpc_today, fpc_cal), flush=True)
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for scope, pred in (('all', lambda r: r['year'] != 2022), ('verdict', lambda r: r['year'] >= 2024)):
            rs = [r for r in out['rows'] if r['tech'] == tech and pred(r)]
            out['mae'][f'{tech}_{scope}'] = {
                k: round(float(np.mean([abs(r[k] - r['actual']) for r in rs])), 4) for k in ('fpc', 'fpcCalendar')}
    print(json.dumps(out['mae'], indent=1))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
