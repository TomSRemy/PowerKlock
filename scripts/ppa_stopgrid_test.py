#!/usr/bin/env python3
"""Stop threshold priced by the cells themselves against the pricer's ratio (Tom 2 Nov. 2026: price any stop threshold
T "with cells like the rest").

Same cases as scripts/ppa_threshold_test.py and ppa_model_risk.py: each delivery year from 2023, priced 1, 2 and 3 years
ahead with only the complete years known then, 30 draws, seed 7, each technology's anchoring (ppa_model_risk.json
'anchorMode'). For each T, the capture of a park stopping below T:
  pricer      the T = 0 capture × the pricer's ratio (js/tool-ppa.js stopRatio; ppa_threshold_test 'pricer')
  pricerPot   the same ratio measured on France's output without its stops at negative prices
  cells       the generator's cells at T (ppa_scenarios PK_STOP_GRID), anchored at T
  cells0      the same, anchored with the T = 0 factor
  cellsPot    the cells at T weighted by the output without stops (PK_STOP_POT), anchored on the realised at T on
              that output
  cellsPot0   the same, anchored with its T = 0 factor
each scored against two realised captures at T: on the national output ('act', as ppa_threshold_test) and on the
output without stops ('pot', what a park that keeps producing below 0 would have produced). Also checks that the
option leaves the T = 0 capture unchanged, and times the generator with and without it.

    PK_STOP_GRID=1 PK_STOP_POT=1 python scripts/ppa_stopgrid_test.py [out.json] [--best]
--best: each technology in its published set-up (scripts/ppa_generator.py BEST) instead of the replay's default one.
"""
import json
import os
import sys
import time
import warnings
from datetime import date

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_scenarios as G            # noqa: E402
import ppa_model_risk as R           # noqa: E402
import ppa_threshold_test as TT      # noqa: E402
import ppa_generator as PG           # noqa: E402
sys.argv = _argv
warnings.simplefilter('ignore')

GRID = [-10.0, -5.0, -1.0, 0.0, 0.01, 5.0]   # 0.01: the park also stops at exactly 0 € (the rule until 1 Nov. 2026, common in contracts)
OUT = next((a for a in sys.argv[1:] if not a.startswith('--')), '/tmp/ppa_stopgrid_test.json')
BEST = '--best' in sys.argv


def ratios_pot(t, years, T):
    """ppa_threshold_test.ratios on the output without stops"""
    c = {}
    for m in range(1, 13):
        n = {T: [0.0, 0.0], 0: [0.0, 0.0]}
        for y in years:
            a = L.DATA[y]; k = a['month'] == m
            P, V = a['fr_p'][k], G.potential(y, t)[k]
            for tt in (T, 0):
                pos = P >= tt
                n[tt][0] += float((V[pos] * P[pos]).sum()); n[tt][1] += float(V[pos].sum())
        if n[0][1] > 0 and n[T][1] > 0 and n[0][0] != 0:
            c[m] = (n[T][0] / n[T][1]) / (n[0][0] / n[0][1])
    return c


def pricer(base0, rat, t, A, T, h):
    """js/tool-ppa.js stopRatio as replayed in ppa_threshold_test: below 0 the last year's gap + its change, damped;
    above 0 the last year's level"""
    if T < 0 and A - 1 in L.DATA:
        ra, rb = rat(t, [A], T), rat(t, [A - 1], T)
        k = sum(0.5 ** j for j in range(h))
        return {m: b * min(1.0, max(0.5, 1 - max(0.0, (1 - ra.get(m, 1)) + k * ((1 - ra.get(m, 1)) - (1 - rb.get(m, 1))))))
                for m, b in base0.items()}
    rc = rat(t, [A], T)
    return {m: b * rc.get(m, 1.0) for m, b in base0.items()}


def main():
    assert G.STOP_GRID and G.STOP_POT and all(T in G.STOP_GRID for T in GRID), 'run with PK_STOP_GRID=1 PK_STOP_POT=1'
    grid = G.STOP_GRID
    settings = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    modes = json.load(open(R.OUT))['anchorMode']
    F = G.fuel_cost()
    rows, times, d0 = [], {'on': 0.0, 'off': 0.0, 'anchorOn': 0.0, 'anchorOff': 0.0}, 0.0
    rat_act = lambda t, ys, T: TT.ratios(t, ys, T)[0]
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        mode = (PG.BEST[tech]['anchor'] or 'none') if BEST else modes.get(tech, 'none')
        cfg = PG.BEST[tech] if BEST else {}
        for Y in range(R.FIRST, date.today().year + 1):
            if Y not in L.DATA:
                continue
            acts = {('pot' if p else 'act', T): {m: v for m, v in G.actual_T(t, Y, T, p).items() if v['days'] >= 28}
                    for p in (False, True) for T in GRID}
            if not acts[('act', 0.0)]:
                continue
            for h in (1, 2, 3):
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                A = max(known)
                if A < 2022:
                    continue
                capY = {c: {tt: L.cap_guess(c, tt, Y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = {m: float(L.DATA[A]['fr_p'][L.DATA[A]['month'] == m].mean()) for m in range(1, 13)}
                c0 = float(np.mean([v for k, v in F.items() if f'{A}-12-01' <= k <= f'{A}-12-31']))
                kw = dict(n=30, rule='fuel', cost=lambda d: c0, batteries='both', pool_from=2019, fuel_dev=True, france=True, seed=7)
                with PG._cfg(cfg):
                    # the option off (today's generator), then on: T = 0 must not move
                    G.STOP_GRID, G.STOP_POT = None, False
                    t0 = time.time(); off, _ = G.simulate(t, Y, known, st, A, capY, lv, **kw); times['off'] += time.time() - t0
                    t0 = time.time(); Koff = G.anchor_factors(t, A, known, st, lambda d: c0); times['anchorOff'] += time.time() - t0
                    G.STOP_GRID, G.STOP_POT = grid, True
                    t0 = time.time(); gm, _ = G.simulate(t, Y, known, st, A, capY, lv, **kw); times['on'] += time.time() - t0
                    t0 = time.time(); K = G.anchor_factors(t, A, known, st, lambda d: c0); times['anchorOn'] += time.time() - t0
                for m in gm:
                    for x_, y_ in ((gm[m]['curt'], off[m]['curt']), (gm[m]['curtT'][0.0], off[m]['curt'])):
                        if x_ == x_ and y_ == y_:
                            d0 = max(d0, abs(x_ - y_))
                    d0 = max(d0, abs(K[mode]['curt'][m] - Koff[mode]['curt'][m]))
                base0 = {m: v['curt'] * K[mode]['curt'][m] for m, v in gm.items()}
                row = {'tech': tech, 'year': Y, 'h': h, 'known': A, 'byT': {}}
                for T in GRID:
                    pred = {'pricer': pricer(base0, rat_act, t, A, T, h), 'pricerPot': pricer(base0, ratios_pot, t, A, T, h),
                            'cells': {m: v['curtT'][T] * K[mode]['curtT'][T][m] for m, v in gm.items() if v['curtT'][T] is not None},
                            'cells0': {m: v['curtT'][T] * K[mode]['curt'][m] for m, v in gm.items() if v['curtT'][T] is not None},
                            'cellsPot': {m: v['curtTp'][T] * K[mode]['curtTp'][T][m] for m, v in gm.items() if v['curtTp'][T] is not None},
                            'cellsPot0': {m: v['curtTp'][T] * K[mode]['curtTp'][0.0][m] for m, v in gm.items() if v['curtTp'][T] is not None}}
                    paid = {'cells': {m: v['paidT'][T] for m, v in gm.items()}, 'cellsPot': {m: v['paidTp'][T] for m, v in gm.items()}}
                    e = {}
                    for tg in ('act', 'pot'):
                        for name, p_ in pred.items():
                            sc = TT.score(p_, acts[(tg, T)])
                            if sc:
                                e[f'{name}|{tg}'] = {'pts': round(sc['pts'], 3), 'eur': round(sc['eur'], 3)}
                        for name, p_ in paid.items():
                            ms = [m for m in acts[(tg, T)] if m in p_]
                            w = np.array([acts[(tg, T)][m]['mwh'] for m in ms])
                            e[f'{name}|{tg}']['paidPts'] = round(float((w * np.array([p_[m] - acts[(tg, T)][m]['paid'] for m in ms])).sum() / w.sum() * 100), 3)
                    row['byT'][str(T)] = e
                rows.append(row)
                print(tech, Y, f'h={h}', ' | '.join(f"T{T:+.0f} " + ' '.join(f"{k.split('|')[0]} {v['eur']:+.2f}" for k, v in row['byT'][str(T)].items() if k.endswith('|act'))
                                                       for T in GRID), flush=True)
    out = {'asOf': date.today().isoformat(), 'best': BEST, 'grid': GRID, 'stopGrid': list(grid), 'maxT0Diff': d0,
           'timeSec': {k: round(v, 1) for k, v in times.items()}, 'rows': rows}
    for tech in ('solar', 'wind'):
        rs = [r for r in rows if r['tech'] == tech]
        if not rs:
            continue
        last = max(r['year'] for r in rs)
        w = np.array([0.5 ** ((last - r['year']) / R.HALF) for r in rs])
        out[tech] = {}
        for T in GRID:
            out[tech][str(T)] = {}
            for key in rs[0]['byT'][str(T)]:
                ok = [i for i, r in enumerate(rs) if key in r['byT'][str(T)]]
                p = np.array([rs[i]['byT'][str(T)][key]['pts'] for i in ok]); e = np.array([rs[i]['byT'][str(T)][key]['eur'] for i in ok]); ww = w[ok]
                s_ = {'n': len(ok), 'meanEur': round(float((ww * e).sum() / ww.sum()), 3), 'maeEur': round(float(np.abs(e).mean()), 3),
                      'meanPts': round(float((ww * p).sum() / ww.sum()), 3), 'qPts': round(R.wquantile(p, ww, R.LEVEL), 3)}
                if 'paidPts' in rs[ok[0]]['byT'][str(T)][key]:
                    s_['paidPts'] = round(float(np.mean([rs[i]['byT'][str(T)][key]['paidPts'] for i in ok])), 3)
                out[tech][str(T)][key] = s_
    print('max |T=0 change| with the option on', d0, 'times', out['timeSec'])
    for tech in ('solar', 'wind'):
        for T in GRID:
            for key, v in out.get(tech, {}).get(str(T), {}).items():
                print(f'{tech:5s} T{T:+5.0f} {key:16s} mean {v["meanEur"]:+6.2f}  MAE {v["maeEur"]:5.2f}  q75 {v["qPts"]:+6.2f} pts', v.get('paidPts', ''))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
