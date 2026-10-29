#!/usr/bin/env python3
"""Walk-forward of the regional price model's tail ('flat' today vs 'mixture', ppa_tail_test.TailPriceModel)
with the settings the live pricer actually uses (data/history/ppa_forecast.json → settings), on every
target year 2019-2026 (2022 left out), both contract conventions, for the regional method, its Monte
Carlo, and the 4-method average the pricer publishes (step, fpc, regional, weather — the other three
read from data/history/ppa_lab.json, unchanged).

Result: 'mixture' loses on the verdict years (solar, curtailed convention, regional method: 2.35 →
2.97 €/MWh mean absolute error; all hours 7.78 → 12.03; wind curtailed 6.71 → 8.10), ties on the
calibration years: the pricer keeps 'flat'. Why, in ppa_tail_test.py's docstring.

Writes data/history/ppa_tail_walkforward.json
    python scripts/ppa_tail_walkforward.py [--sims 60]
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L   # noqa: E402
import ppa_tail_test as T   # noqa: E402
sys.argv = _argv

H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'ppa_tail_walkforward.json')
TARGETS = [2019, 2020, 2021, 2023, 2024, 2025, 2026]


def main():
    sims = int(sys.argv[sys.argv.index('--sims') + 1]) if '--sims' in sys.argv else 60
    settings = json.load(open(os.path.join(H, 'ppa_forecast.json')))['settings']
    lab = json.load(open(os.path.join(H, 'ppa_lab.json')))
    out = {'settings': settings, 'rows': []}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        st0 = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Y in TARGETS:
            if Y not in L.DATA:
                continue
            act = L.actual(t, Y)
            lrow = next((r for r in lab['rows'] if r['tech'] == tech and r['year'] == Y), None)
            row = {'tech': tech, 'year': Y, 'set': 'calibration' if Y in L.CAL else 'verdict'}
            for tail in ('flat', 'mixture'):
                st = st0
                L.RNG = np.random.default_rng(7)          # same draws for both tails
                pm, past = L.make_pm(Y, st)
                if tail == 'mixture':
                    tr = [y for y in past if st['with2022'] or y != 2022][-st['window']:]
                    pm = T.TailPriceModel(tr, st['regional'], 'mean', st['level'] != 'none')
                last = max(past)
                capY = {c: {tt: L.cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                m4, m5, _ = L.regional(t, Y, past, pm, last, capY, sims, L.levels_for(Y, st['level']), st['regional'])
                for conv in ('all', 'curt'):
                    reg = {m: m4[m][conv] for m in m4 if m4[m][conv] == m4[m][conv]}
                    mc = {m: m5[m][conv] for m in m5 if m5[m][conv] == m5[m][conv]}
                    sc = {'regional': L.score(reg, act, conv), 'regionalMC': L.score(mc, act, conv)}
                    if lrow:
                        P = {k: {int(m): v for m, v in (lrow['pred'][conv].get(k) or {}).items()} for k in ('step', 'fpc', 'weather')}
                        P['regional'] = reg
                        ks = [m for m in reg if all(m in P[k] and P[k][m] is not None for k in P)]
                        sc['average4'] = L.score({m: float(np.mean([P[k][m] for k in P])) for m in ks}, act, conv)
                    row[f'{tail}_{conv}'] = {k: (v['eur'] if v else None) for k, v in sc.items()}
                    row[f'{tail}_{conv}_paid'] = {m: m4[m]['paid'] for m in m4}
            out['rows'].append(row)
            print(tech, Y, row['set'], ' | '.join(
                f"{conv}: reg {row['flat_' + conv]['regional']:+.2f}→{row['mixture_' + conv]['regional']:+.2f} "
                f"avg4 {row['flat_' + conv].get('average4') or 0:+.2f}→{row['mixture_' + conv].get('average4') or 0:+.2f}"
                for conv in ('curt', 'all')), flush=True)
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for scope in ('calibration', 'verdict'):
            rs = [r for r in out['rows'] if r['tech'] == tech and r['set'] == scope]
            for conv in ('curt', 'all'):
                for meth in ('regional', 'regionalMC', 'average4'):
                    for tail in ('flat', 'mixture'):
                        v = [abs(r[f'{tail}_{conv}'][meth]) for r in rs if r[f'{tail}_{conv}'].get(meth) is not None]
                        out['mae'].setdefault(f'{tech} {scope} {conv} {meth}', {})[tail] = round(float(np.mean(v)), 3) if v else None
    for k, v in out['mae'].items():
        print('%-40s flat %s  mixture %s' % (k, v['flat'], v['mixture']))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
