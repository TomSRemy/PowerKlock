#!/usr/bin/env python3
"""Staleness and completeness checks on what the published PPA price stands on (PPA review, 21 Nov. 2026): run in the
weekly test bench after the scenario generator and in the daily benchmark before the day is priced. Prints one line per
failed check and exits 1 when any fails, so the job's e-mail on failure goes out; a warning does not fail.

Checks (thresholds below):
  · the last complete year is last year, once past LAST_YEAR_GRACE (it becomes the generator's reference year);
  · the running year's days left out of the model because a neighbour's data is missing (Energy-Charts), and a
    neighbour whose last fetch failed (data/history/region_hourly/<year>.json 'coverage');
  · France's installed fleet (RTE): the last year known, a warning with the number of years extrapolated since;
  · the age of the gas and CO2 prices (the fuel cost), of the JAO Core export limits, of the GO prices, of the model-error
    replay and of the generator's own block;
  · the generator gives every month of every year of the pricer's default tenor (next year to the last quoted Cal);
  · plausibility: France's and the neighbours' yearly output per GW of the reference year within the range of the five
    years before it, widened by LF_TOL; with --prev (last week's data/history/ppa_forecast.json) the tenor's capture not
    moving by more than CAPTURE_MOVE_PTS points while the tenor's Cal forwards moved by less than FWD_STILL.

    python scripts/ppa_guard.py [--prev /tmp/ppa_forecast_prev.json]
"""
import csv
import json
import os
import sys
from datetime import date

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
sys.argv = _argv

LAST_YEAR_GRACE = 15        # day of January from which last year must be the last complete year
NEIGH_DROP_MAX = 0.05       # share of the running year's French days left out for a neighbour's missing data
REGION_MAX_AGE = 10         # days: the neighbours' hourly data (weekly, Sunday)
FUEL_MAX_AGE = 7            # days: TTF and EUA, daily quotes (a long weekend is 4 days)
JAO_MAX_AGE = 10            # days: JAO Core export limits
GO_MAX_AGE = 21             # days: GO prices (weekly broker mail)
REPLAY_MAX_AGE = 10         # days: model-error replay (weekly, Sunday)
GEN_MAX_AGE = 10            # days: the generator's block (weekly, Sunday; a restored week keeps the week before's date)
LF_YEARS, LF_TOL = 5, 0.25  # output per GW of the reference year within [min × 0.75, max × 1.25] of the five years before
CAPTURE_MOVE_PTS = 8.0      # capture points the tenor may move in a week...
FWD_STILL = 0.05            # ...when the tenor's Cal forwards moved by less than this (relative)

fails, warns = [], []


def fail(check, why):
    fails.append(f'{check}: {why}')


def age(d, today):
    return (today - date.fromisoformat(str(d)[:10])).days


def check_last_year(today):
    done = [y for y in L.DATA if L.DATA[y]['complete']]
    A = max(done) if done else None
    if today >= date(today.year, 1, LAST_YEAR_GRACE) and A != today.year - 1:
        fail('last complete year', f'{A}, expected {today.year - 1} (a year counts once over, with 340 days or more where France and '
                                   'every neighbour are complete)')
    return A


def check_neighbours(today):
    # the running year; in the first days of January, last year (the new year's file comes with the next weekly run)
    y = today.year if today >= date(today.year, 1, LAST_YEAR_GRACE) else today.year - 1
    try:
        fr = json.load(open(os.path.join(H, 'fr_hourly', f'{y}.json')))['days']
        rg = json.load(open(os.path.join(H, 'region_hourly', f'{y}.json')))
    except (OSError, ValueError) as e:
        fail('neighbours', f'{y} not readable ({e})')
        return
    for c, v in (rg.get('coverage') or {}).items():
        if v.get('failed'):
            fail('neighbours', f'Energy-Charts gave no data for {c} on {v["failed"]} (older data kept)')
    C = rg['countries']
    # the days after the neighbours' last fetched day are not fetched yet (weekly job), not missing: counted up to it
    end = min((max(C[c]['l']) for c in L.NEIGH if C.get(c, {}).get('l')), default='')
    if not end or age(end, today) > REGION_MAX_AGE:
        fail('neighbours', f'last neighbour day {end or None}, over {REGION_MAX_AGE} days')
    frd = [d for d, v in fr.items() if d <= end and all(v.get(k) and None not in v[k] for k in 'pswln')]
    drop = {c: [d for d in frd if not (c in C and d in C[c]['l'] and None not in C[c]['l'][d])] for c in L.NEIGH}
    out = sorted({d for v in drop.values() for d in v})
    share = len(out) / len(frd) if frd else 1.0
    line = f'{y} to {end}: {len(out)} of {len(frd)} French days left out (' + ', '.join(f'{c} {len(v)}' for c, v in drop.items()) + ')'
    if share > NEIGH_DROP_MAX:
        fail('neighbours', line + f', above {NEIGH_DROP_MAX:.0%}')
    else:
        print('ok  neighbours', line)


def fleet_last_year(today):
    last = min(max(y for y, v in L.B.CAP[t].items() if v) for t in 'sw')
    n = today.year - 1 - last
    if n > 0:
        warns.append(f'France fleet (RTE): known to {last}, {n} complete year(s) extrapolated since')
    else:
        print(f'ok  France fleet known to {last}')
    return last


def check_ages(today, fc):
    n = len(fails)
    s = json.load(open(os.path.join(H, 'commodities_series.json')))['series']
    for k in ('ttf', 'eua'):
        d = s[k]['points'][-1][0]
        if age(d, today) > FUEL_MAX_AGE:
            fail('fuel cost', f'{k.upper()} last quoted {d}, over {FUEL_MAX_AGE} days')
    jao = {}
    for y in (today.year, today.year - 1):
        try:
            jao = json.load(open(os.path.join(H, 'jao_core', f'{y}.json')))['days']
            break
        except (OSError, ValueError, KeyError):
            continue
    d = max(jao) if jao else None
    if not d or age(d, today) > JAO_MAX_AGE:
        fail('JAO limits', f'last day {d}, over {JAO_MAX_AGE} days')
    with open(os.path.join(ROOT, 'data', 'go_prices.csv')) as f:
        go = max((r['mail_date'] for r in csv.DictReader(f) if r.get('mail_date')), default=None)
    if not go or age(go, today) > GO_MAX_AGE:
        fail('GO prices', f'last mail {go}, over {GO_MAX_AGE} days')
    try:
        d = json.load(open(os.path.join(H, 'ppa_error_replay.json'))).get('asOf')
    except (OSError, ValueError):
        d = None
    if not d or age(d, today) > REPLAY_MAX_AGE:
        fail('model-error replay', f'as of {d}, over {REPLAY_MAX_AGE} days')
    g = fc.get('generator') or {}
    if not g.get('asOf') or age(g['asOf'], today) > GEN_MAX_AGE:
        fail('generator', f'as of {g.get("asOf")}' + (f' (restored {g["restored"]})' if g.get('restored') else '') + f', over {GEN_MAX_AGE} days')
    print(f'{"ok " if len(fails) == n else "-- "} ages: TTF {s["ttf"]["points"][-1][0]}, EUA {s["eua"]["points"][-1][0]}, JAO {max(jao) if jao else None}, '
          f'GO {go}, replay {d}, generator {g.get("asOf")} (limits {FUEL_MAX_AGE}/{JAO_MAX_AGE}/{GO_MAX_AGE}/{REPLAY_MAX_AGE}/{GEN_MAX_AGE} days)')


def tenor(today):
    """the pricer's default tenor: next year to the last quoted Cal"""
    return list(range(today.year + 1, max(L.last_quoted_cal() or today.year + 1, today.year + 1) + 1))


def check_tenor(today, fc):
    T, n = tenor(today), len(fails)
    for tech in ('solar', 'wind'):
        F = fc.get('forecast', {}).get(tech, {}).get('curt', {})
        miss = [f'{Y}-{m:02d}' for Y in T for m in range(1, 13) if (F.get(f'{Y}-{m:02d}') or {}).get('generator') is None]
        band = ((fc.get('generator') or {}).get('band') or {}).get(tech) or {}
        nob = [Y for Y in T if str(Y) not in band]
        if miss:
            fail('generator tenor', f'{tech}: no generator capture for {len(miss)} month(s) of {T[0]}-{T[-1]} ({miss[0]}…{miss[-1]})')
        if nob:
            fail('generator tenor', f'{tech}: no capture band for {", ".join(map(str, nob))}')
    if len(fails) == n:
        print(f'ok  generator covers the default tenor {T[0]}-{T[-1]}')


def output_per_gw(c, t, y):
    a = L.DATA[y]
    x = a[('fr_' if c == 'FR' else c + '_') + t]
    g0 = L.cap(c, t, y - 1) or L.cap_guess(c, t, y - 1, y - 1)
    g1 = L.cap(c, t, y) or L.cap_guess(c, t, y, y)
    return float(np.mean(x)) / ((g0 + g1) / 2 * 1000) if g0 and g1 else None   # mid-year fleet


def check_plausible(A):
    if A is None:
        return
    for c in ('FR',) + L.NEIGH:
        for t in 'sw':
            v = output_per_gw(c, t, A)
            ref = [output_per_gw(c, t, y) for y in range(A - LF_YEARS, A) if y in L.DATA]
            ref = [r for r in ref if r]
            if v is None or len(ref) < 2:
                warns.append(f'output per GW {c} {L.TECH[t]} {A}: not enough years to compare')
                continue
            lo, hi = min(ref) * (1 - LF_TOL), max(ref) * (1 + LF_TOL)
            if not lo <= v <= hi:
                fail('output per GW', f'{c} {L.TECH[t]} {A}: {v:.3f} outside {lo:.3f}-{hi:.3f} (the {LF_YEARS} years before ±{LF_TOL:.0%})')
    print(f'ok  output per GW of {A} checked against the {LF_YEARS} years before')


def year_capture(fc, tech, Y, A):
    t = 's' if tech == 'solar' else 'w'
    F = fc.get('forecast', {}).get(tech, {}).get('curt', {})
    w = {m: float(L.DATA[A]['fr_' + t][L.DATA[A]['month'] == m].sum()) for m in range(1, 13)}
    v = {m: (F.get(f'{Y}-{m:02d}') or {}).get('generator') for m in range(1, 13)}
    return sum(w[m] * v[m] for m in v) / sum(w.values()) if all(x is not None for x in v.values()) else None


def cal_on(day):
    """mean of the French Cal settlements quoted on or before day, per year"""
    ch = json.load(open(os.path.join(H, 'fr_market_calchain.json')))['FR']['years']
    out = {}
    for y, v in ch.items():
        ok = [x for d, x in zip(v['dates'], v['values']) if d <= day and x is not None]
        if ok:
            out[int(y)] = ok[-1]
    return out


def check_week(today, fc, prev, A):
    g0, g1 = (prev.get('generator') or {}).get('asOf'), (fc.get('generator') or {}).get('asOf')
    if not g0 or not g1 or g0 == g1:
        print('ok  week on week: no earlier generator run to compare')
        return
    T = tenor(today)
    f0, f1 = cal_on(g0), cal_on(g1)
    ys = [Y for Y in T if Y in f0 and Y in f1]
    fwd = abs(np.mean([f1[Y] for Y in ys]) / np.mean([f0[Y] for Y in ys]) - 1) if ys else None
    for tech in ('solar', 'wind'):
        c = [(year_capture(prev, tech, Y, A), year_capture(fc, tech, Y, A)) for Y in T]
        c = [(a, b) for a, b in c if a is not None and b is not None]
        if not c:
            continue
        mv = (np.mean([b for _, b in c]) - np.mean([a for a, _ in c])) * 100
        line = f'{tech} {T[0]}-{T[-1]}: capture {mv:+.1f} pts from {g0} to {g1}, Cal forwards ' + (f'{fwd:+.1%}' if fwd is not None else 'n/a')
        if abs(mv) > CAPTURE_MOVE_PTS and (fwd is None or fwd < FWD_STILL):
            fail('capture week on week', line + f' (over {CAPTURE_MOVE_PTS:g} pts with forwards within {FWD_STILL:.0%})')
        else:
            print('ok  ' + line)


def main():
    today = date.today()
    fc = json.load(open(os.path.join(H, 'ppa_forecast.json')))
    A = check_last_year(today)
    check_neighbours(today)
    fleet_last_year(today)
    check_ages(today, fc)
    check_tenor(today, fc)
    check_plausible(A)
    if '--prev' in sys.argv:
        try:
            prev = json.load(open(sys.argv[sys.argv.index('--prev') + 1]))
        except (OSError, ValueError, IndexError) as e:
            prev = None
            warns.append(f'last week\'s forecast file not readable ({e})')
        if prev:
            check_week(today, fc, prev, A)
    for w in warns:
        print(f'::warning::PPA guard: {w}')
    for f in fails:
        print(f'::error::PPA guard: {f}')
    if os.environ.get('GITHUB_ENV') and fails:
        with open(os.environ['GITHUB_ENV'], 'a') as f:
            f.write('PPA_GUARD=' + ' · '.join(fails).replace('\n', ' ') + '\n')
    print(f'PPA guard: {len(fails)} failed, {len(warns)} warning(s)')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
