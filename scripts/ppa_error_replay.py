#!/usr/bin/env python3
"""Model-error quantiles of the PPA scenario generator, by stop threshold and horizon: the pricer's model-risk premium.

Why: the published capture is a model's central view. The owner approved a "dynamic premium" (3 Nov. 2026): the pricer
takes off the forwards the 75th percentile of the generator's past errors for the contract's stop threshold T and
horizon, so the price would not have been above the realised value in 3 cases out of 4. This script measures those
errors again every week as months complete.

Replay: 12-month deliveries starting on the first of every month from January 2023 to the last start with at least
one complete month, each priced 3, 6, 9 and 12 months before its start, with only what was known at that pricing date
D: the complete calendar years before D (price rule, weather weeks, demand, fleets guessed from the last known year),
the fuel cost of the 30 days before D, D as the date of the physical merit-order layer. Exactly the published set-up of
each technology (scripts/ppa_generator.py BEST: solar with the merit-order split, no anchoring; wind learnt
output-weighted, anchored winter / summer on the last complete year), 30 draws, seed 7. Each pricing date is simulated
once per calendar year its deliveries touch, and every delivery priced on that date reads the same simulation.

Captures at each stop threshold T come from the cells, as the pricer's 'generatorT' (a park that stops when the price
is strictly below T): T = −20, −5, −1, −0.5, −0.1, 0, 0.01, 0.1, 1, 5 €/MWh. Scored on the complete months of the
delivery (28 days or more of data), against the realised capture at the same T, months weighted by the national output
× its paid share × the month's baseload. A delivery that runs past the last complete month is scored on the months it
has (the latest starts therefore weigh their first months only).

Error of a case = central capture value − realised capture value, in €/MWh and in capture points of the realised
baseload (pts = € ÷ base × 100; the pricer applies the points to the forwards). Positive = the model priced too high.
Every case weighs the same. Per technology, T and horizon h (3, 6, 9, 12 months, and 'all' pooled): n, bias (mean),
mean absolute error and the LEVEL-th percentile of the signed error.

Checked against the validation replay of 3 Nov. 2026 (same 184 solar cases, non-January starts, T = 0 / −1 / 0.01:
q75 2.26 / 3.36 / 0.76 €/MWh).

Runs in parallel over pricing dates (--jobs, default the machine's cores): about 25 min on 2 cores. --step 3 keeps the
deliveries starting each quarter only (a third of the pricing dates) for a quick look.

Writes data/history/ppa_error_replay.json
    {"asOf", "protocol", "level", "lastMonth", "starts": [first, last], "thresholds", "horizons",
     "solar" | "wind": {"<T>": {"<h>" | "all": {"n", "bias_pts", "mae_pts", "q75_pts", "bias_eur", "mae_eur", "q75_eur"}}},
     "rows": {"solar" | "wind": [{"S", "h", "months", "pts": [per T], "eur": [per T]}]}}   (rows kept while small)
    python scripts/ppa_error_replay.py [--step 1] [--jobs N] [--out path]
"""
import argparse
import json
import os
import sys
import time
import warnings
from datetime import date
from multiprocessing import get_context

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_scenarios as G            # noqa: E402
from ppa_generator import BEST, _cfg  # noqa: E402
sys.argv = _argv
warnings.simplefilter('ignore')

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_error_replay.json')
LEVEL = 75
FIRST = date(2023, 1, 1)
HORIZONS = (3, 6, 9, 12)
TS = (-20.0, -5.0, -1.0, -0.5, -0.1, 0.0, 0.01, 0.1, 1.0, 5.0)
SIMS, SEED = 30, 7
ROWS_MAX = 200_000   # bytes: the per-case rows are kept in the file while it stays this small
# the generator's grid of stop thresholds (as scripts/ppa_generator.py sets it); TS is a subset
GRID = (-500.0, -200.0, -100.0, -50.0, -20.0, -10.0, -5.0, -2.0, -1.0, -0.5, -0.2, -0.1, 0.0, 0.01, 0.1, 0.2, 0.5,
        1.0, 2.0, 5.0, 10.0, 20.0, 50.0)
TECH = {'s': 'solar', 'w': 'wind'}


def complete_months(t):
    """{(year, month): realised month at each T} for the months with 28 days or more of data"""
    out = {}
    for Y in sorted(L.DATA):
        if Y < FIRST.year:
            continue
        for T in TS:
            for m, v in G.actual_T(t, Y, T).items():
                if v['days'] >= 28 and v['curt'] is not None:
                    out.setdefault((Y, m), {})[T] = v
    return {k: v for k, v in out.items() if len(v) == len(TS)}


def plan(step):
    """the delivery starts and, per pricing date, the calendar years to simulate"""
    last = max(k for k in complete_months('s'))
    lastS = date(*last, 1)
    starts, S = [], FIRST
    while S <= lastS:
        starts.append(S)
        S = G._add_months(S, step)
    need = {}
    for S in starts:
        for h in HORIZONS:
            D = G._add_months(S, -h)
            need.setdefault(D, set()).update(y for y in {S.year, G._add_months(S, 11).year} if y <= last[0])
    return starts, need, last


def price_date(task):
    """one technology at one pricing date D: the published central capture, anchored, at every T, month by month, for
    each calendar year asked (the simulation of a (D, year) is made once and shared by every delivery priced on D)"""
    t, D, years = task
    tech = TECH[t]
    G.STOP_GRID = GRID
    G.ROLL['on'], G.ROLL['cells'], G.ROLL['anchor'], G.ROLL['D'] = False, 'cal', False, D
    st = {k: v for k, v in SETTINGS[t].items() if k != 'calError'}
    known = [y for y in L.DATA if y < D.year and L.DATA[y]['complete']]
    A = max(known)
    c0 = float(np.mean([FUEL[k] for k in sorted(k for k in FUEL if k < D.isoformat())[-30:]]))
    mode = BEST[tech]['anchor'] or 'none'
    if mode == 'none':
        K = {m: 1.0 for m in range(1, 13)}
    else:
        with _cfg(BEST[tech]):
            K = G.anchor_factors(t, A, known, st, lambda d: c0)[mode]['curt']
    out = {}
    for Y in sorted(years):
        capY = {c: {tt: L.cap_guess(c, tt, Y, A) for tt in 'sw'} for c in G.CS}
        with _cfg(BEST[tech]):
            m, _ = G.simulate(t, Y, known, st, A, capY, None, n=SIMS, rule='fuel', cost=lambda d: c0, batteries='both',
                              pool_from=2019, fuel_dev=True, france=True, seed=SEED)
        for mm in range(1, 13):
            gT = (m.get(mm) or {}).get('curtT') or {}
            # as the pricer's 'generatorT': the cells' capture at T × the T = 0 anchoring factor, never below 0
            out[(Y, mm)] = [max(0.0, gT[T] * K[mm]) if gT.get(T) is not None else None for T in TS]
    return t, D, out


def _init():
    global SETTINGS, FUEL
    SETTINGS = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    FUEL = G.fuel_cost()


def stats(e, p):
    e, p = np.asarray(e, float), np.asarray(p, float)
    return {'n': int(e.size), 'bias_pts': round(float(p.mean()), 3), 'mae_pts': round(float(np.abs(p).mean()), 3),
            'q75_pts': round(float(np.percentile(p, LEVEL)), 3), 'bias_eur': round(float(e.mean()), 3),
            'mae_eur': round(float(np.abs(e).mean()), 3), 'q75_eur': round(float(np.percentile(e, LEVEL)), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--step', type=int, default=1, help='months between delivery starts (3: quarter starts only)')
    ap.add_argument('--jobs', type=int, default=os.cpu_count() or 1)
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    T0 = time.time()
    _init()
    starts, need, last = plan(a.step)
    tasks = [(t, D, need[D]) for D in sorted(need) for t in 'ws']   # wind first: its anchoring makes it the longer one
    print(f'{len(starts)} starts {starts[0]} … {starts[-1]}, {len(need)} pricing dates, {len(tasks)} tasks, {a.jobs} jobs', flush=True)
    sim = {}
    if a.jobs > 1:
        with get_context('fork').Pool(a.jobs, initializer=_init) as pool:
            for t, D, o in pool.imap_unordered(price_date, tasks):
                sim[(t, D)] = o
                print(TECH[t], D, f'{time.time() - T0:.0f}s', flush=True)
    else:
        for task in tasks:
            t, D, o = price_date(task)
            sim[(t, D)] = o
            print(TECH[t], D, f'{time.time() - T0:.0f}s', flush=True)
    out = {'asOf': date.today().isoformat(), 'protocol': __doc__.split('Writes')[0].strip(), 'level': LEVEL,
           'lastMonth': f'{last[0]}-{last[1]:02d}', 'starts': [starts[0].isoformat(), starts[-1].isoformat()], 'step': a.step,
           'thresholds': [f'{T:g}' for T in TS], 'horizons': list(HORIZONS), 'rows': {}}
    for t, tech in TECH.items():
        act = complete_months(t)
        rows = []
        for S in starts:
            months = [(x.year, x.month) for x in (G._add_months(S, i) for i in range(12)) if (x.year, x.month) in act]
            if not months:
                continue
            for h in HORIZONS:
                o = sim[(t, G._add_months(S, -h))]
                e_, p_ = [], []
                for i, T in enumerate(TS):
                    a_ = [act[k][T] for k in months]
                    w = np.array([x['mwh'] * x['paid'] for x in a_]); b = np.array([x['base'] for x in a_])
                    pred = [o[k][i] for k in months]
                    if None in pred or w.sum() <= 0:
                        e_.append(None); p_.append(None)
                        continue
                    real = float((w * np.array([x['curt'] for x in a_]) * b).sum() / w.sum())
                    pv = float((w * np.array(pred) * b).sum() / w.sum())
                    wb = float((w * b).sum() / w.sum())
                    e_.append(round(pv - real, 4)); p_.append(round((pv - real) / wb * 100, 4))
                rows.append({'S': S.isoformat()[:7], 'h': h, 'months': len(months), 'eur': e_, 'pts': p_})
        out['rows'][tech] = rows
        res = {}
        for i, T in enumerate(TS):
            ok = [r for r in rows if r['eur'][i] is not None]
            res[f'{T:g}'] = {str(h): stats([r['eur'][i] for r in ok if r['h'] == h], [r['pts'][i] for r in ok if r['h'] == h])
                             for h in HORIZONS if any(r['h'] == h for r in ok)}
            if ok:
                res[f'{T:g}']['all'] = stats([r['eur'][i] for r in ok], [r['pts'][i] for r in ok])
        out[tech] = res
        print(tech, len(rows), 'cases;', '  '.join(f"T{T}: q75 {v['all']['q75_pts']:+.2f} pts / {v['all']['q75_eur']:+.2f} €"
                                                  for T, v in res.items() if 'all' in v), flush=True)
    out['runtime'] = round(time.time() - T0)
    if len(json.dumps(out, separators=(',', ':'))) > ROWS_MAX:
        out.pop('rows')
    with open(a.out, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', a.out, f'{out["runtime"]}s')


if __name__ == '__main__':
    main()
