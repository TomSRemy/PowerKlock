#!/usr/bin/env python3
"""P75 calibration of the full Monte Carlo at each stop threshold T (the check behind "the prudent price held in 78–89 %
of deliveries", 31 Oct. 2026, run then as a one-off; set-up ppa_generator BAND). For each replay case (delivery Y =
2023–2026 priced h = 1–3 years ahead, the last known complete year 2022 or later), the 25th percentile of the scenarios'
delivery value (capture at T × the realised base, weighted by the realised paid output at T) against the realised value
at T (ppa_scenarios.actual_T, national output). Held = realised ≥ P25. Also by quarter. Writes
/tmp/ppa_band_stop_<tech>.json.
    python scripts/ppa_band_stop_test.py s|w     (about 12 minutes per technology at 60 draws; NSIM to change)

Run 2 Nov. 2026 (60 draws, 9 deliveries per technology), realised ≥ P25, yearly / quarterly (33 quarters):
  T (€)   -20      -5       -1       -0.5     -0.1     0        0.01     0.1      1        5
  solar   44/45 %  44/42    44/45    44/45    44/45    44/55    78/70    78/67    78/70    89/79
  wind    56/61    67/64    67/64    67/64    67/64    67/64    78/79    67/76    67/76    78/76
T = 0.01 (also stopping at exactly 0 €, the realised convention of the 31 Oct. check) gives back its 78 % in solar. At
T = 0 and below the scenarios miss part of what the hours at exactly 0 € and −0.01 € took from the realised capture in
2025–2026 (solar 2025: realised 42.58 €/MWh at T = 0 against 47.13 at 0.01; the scenarios' gap about half that), so the
P25 sits above the realised in most solar deliveries.
"""
import json
import os
import sys
import time
import warnings

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_scenarios as G            # noqa: E402
import ppa_generator as PG           # noqa: E402
sys.argv = _argv
warnings.simplefilter('ignore')

NS = int(os.environ.get('NSIM', 60))
TS = [-20.0, -5.0, -1.0, -0.5, -0.1, 0.0, 0.01, 0.1, 1.0, 5.0]
# the generator's own grid (ppa_generator.main), so the cells and analogues see the same thresholds as when publishing
GRID = (-500.0, -200.0, -100.0, -50.0, -20.0, -10.0, -5.0, -2.0, -1.0, -0.5, -0.2, -0.1, 0.0, 0.01, 0.1, 0.2, 0.5, 1.0, 2.0,
        5.0, 10.0, 20.0, 50.0)


def main():
    t = sys.argv[1] if len(sys.argv) > 1 else 's'
    tech = {'s': 'solar', 'w': 'wind'}[t]
    G.STOP_GRID = GRID
    SET = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    F = G.fuel_cost()
    st = {k: v for k, v in SET[t].items() if k != 'calError'}
    rows, qrows = [], []
    t_all = time.time()
    for Y in (2023, 2024, 2025, 2026):
        acts = {T: {m: v for m, v in G.actual_T(t, Y, T).items() if v['days'] >= 28} for T in TS}
        for h in (1, 2, 3):
            known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
            A = max(known)
            if A < 2022:
                continue
            cc = float(np.mean([v for k, v in F.items() if f'{A}-12-01' <= k <= f'{A}-12-31']))
            cap = {c: {tt: L.cap_guess(c, tt, Y, A) for tt in 'sw'} for c in G.CS}
            t0 = time.time()
            with PG._cfg(PG.BAND):
                _, dist = G.simulate(t, Y, known, st, A, cap, None, n=NS, rule='fuel', cost=lambda d: cc, batteries='both',
                                     pool_from=2019, fuel_dev=True, france=True, seed=7)
            el = time.time() - t0
            for T in TS:
                act = acts[T]
                ms = [m for m in act if act[m]['curt'] is not None]
                cap_ = (lambda r, m: r[m]['curt']) if T == 0 else (lambda r, m, T=T: (r[m].get('curtT') or {}).get(T))
                for scope, sub in [('year', ms)] + [(f'q{q + 1}', [m for m in ms if (m - 1) // 3 == q]) for q in range(4)]:
                    if scope != 'year' and len(sub) < 3:
                        continue
                    w = np.array([act[m]['mwh'] * act[m]['paid'] for m in sub])
                    b = np.array([act[m]['base'] for m in sub])

                    def val(caps, w=w, b=b):
                        return float((w * np.array(caps) * b).sum() / w.sum())   # € per paid MWh at the realised prices
                    real = val([act[m]['curt'] for m in sub])
                    sc = [val([cap_(r, m) for m in sub]) for r in dist['scenarios']
                          if all(m in r and cap_(r, m) is not None for m in sub)]
                    q10, q25, q50, q90 = (float(np.percentile(sc, q)) for q in (10, 25, 50, 90))
                    (rows if scope == 'year' else qrows).append(dict(Y=Y, h=h, T=T, scope=scope, real=real, q10=q10, q25=q25,
                                                                     q50=q50, q90=q90))
            r0 = {r['T']: r for r in rows if r['Y'] == Y and r['h'] == h}
            print(tech, Y, f'h{h}', '%.0fs' % el, ' | '.join('T%g real %.2f P25%+.2f' % (T, r0[T]['real'], r0[T]['q25'] - r0[T]['real'])
                                                           for T in TS), flush=True)
    print('TOTAL %.0fs' % (time.time() - t_all))
    summ = {}
    for T in TS:
        rs = [r for r in rows if r['T'] == T]
        qs = [r for r in qrows if r['T'] == T]
        s = summ[f'{T:g}'] = {
            'n': len(rs), 'held': float(np.mean([r['real'] >= r['q25'] for r in rs])),
            'inP10P90': float(np.mean([r['q10'] <= r['real'] <= r['q90'] for r in rs])),
            'gapP25': float(np.mean([r['q25'] - r['real'] for r in rs])), 'gapP50': float(np.mean([r['q50'] - r['real'] for r in rs])),
            'nQ': len(qs), 'heldQ': float(np.mean([r['real'] >= r['q25'] for r in qs])),
            'inP10P90Q': float(np.mean([r['q10'] <= r['real'] <= r['q90'] for r in qs]))}
        print(tech, 'SUMMARY T=%-5g held %3.0f%% (n %d) | in P10–P90 %3.0f%% | P25−real %+.2f € P50−real %+.2f € | '
              'quarters held %3.0f%% (n %d) in P10–P90 %3.0f%%'
              % (T, 100 * s['held'], s['n'], 100 * s['inP10P90'], s['gapP25'], s['gapP50'], 100 * s['heldQ'], s['nQ'], 100 * s['inP10P90Q']))
    with open(f'/tmp/ppa_band_stop_{tech}.json', 'w') as f:
        json.dump({'rows': rows, 'quarters': qrows, 'summary': summ, 'nsim': NS}, f)


if __name__ == '__main__':
    main()
