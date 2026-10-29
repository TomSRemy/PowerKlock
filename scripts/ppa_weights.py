#!/usr/bin/env python3
"""Weights of the four methods in the published PPA price: each method weighs by the inverse of its past error.

For each technology and convention, a method's error is its mean absolute error on the complete delivery years from 2024, one, two and three
years ahead, AFTER its bias correction where that correction is adopted (data/history/ppa_bias_test.json, the
'all' variant for an adopted cell, 'none' otherwise; data/history/ppa_bias.json says which). Weight = 1 / error,
normalised to 1. Applied where it lowered the mean error of the average in the published convention (decided by
Tom 28 Oct. 2026 after a walk-forward test: solar 1.97 → 1.75 €/MWh with output stopped at ≤ 0 €; wind got worse,
1.29 → 1.36, so wind keeps equal weights). Recomputed every week with the test bench.

Leave-one-out check of the forward shape, every week (Tom 29 Oct. 2026: out of the solar price, kept for wind, to be
checked regularly): the published average is replayed with and without it (data/history/ppa_bias_test.json's runs,
with the adopted corrections, complete delivery years from 2024, 1 to 3 years ahead, output stopped at prices <= 0);
where it is better without, its weight is 0 in both conventions. On 29 Oct. 2026: solar 1.50 → 1.25 €/MWh without
(out), wind 1.73 → 1.92 (kept).

Writes data/history/ppa_weights.json  {"applied": {"solar": true, "wind": false}, "weights": {tech: {conv: {method: w}}},
                                       "mae": {tech: {conv: {method: €/MWh}}}, "exclude": {tech: [method]},
                                       "check": {tech: {"with": €/MWh, "without": €/MWh, "n": n}},
                                       "pubMae": {tech: {conv: {h: €/MWh}}} (the published average's precision)}
    python scripts/ppa_weights.py
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
METHODS = ('step', 'fpc', 'weather', 'regional')
APPLIED = {'solar': True, 'wind': False}


TESTED = ('fpc',)     # methods whose place in the average is checked every week


def replay():
    """monthly predictions (ppa_bias_test runs), realised values and each method's correction at a delivery year"""
    sys.path.insert(0, os.path.join(ROOT, 'scripts'))
    argv, sys.argv = sys.argv, ['x']
    import ppa_bias_test as T     # noqa: E402
    import ppa_lab as L           # noqa: E402
    sys.argv = argv
    R = T.runs(use_cache=True)
    act = {}
    def pred(tech, Y, h, conv, k):
        key = f'{tech}|{Y}|{h}|{conv}'
        return {int(m): v for m, v in R[key][k].items()} if key in R else None
    def actual(tech, Y):
        if (tech, Y) not in act:
            act[(tech, Y)] = L.actual('s' if tech == 'solar' else 'w', Y)
        return act[(tech, Y)]
    def corr(tech, Y, h, conv, k):
        past = [y for y in T.RUN_YEARS if y <= Y - h and y != 2022 and y in L.DATA and L.DATA[y]['complete'] and pred(tech, y, h, conv, k)]
        return float(np.mean([L.score(pred(tech, y, h, conv, k), actual(tech, y), conv)['pts'] for y in past])) / 100 if past else 0.0
    def errors(tech, conv, methods, w, adopt):
        out = []
        for Y in T.TEST:
            for h in T.HORIZONS:
                ps = {k: pred(tech, Y, h, conv, k) for k in methods}
                if any(v is None for v in ps.values()):
                    continue
                c = {k: corr(tech, Y, h, conv, k) if k in adopt else 0.0 for k in methods}
                ms = set.intersection(*[set(p) for p in ps.values()])
                sw = sum(w[k] for k in methods)
                out.append((h, L.score({m: sum(w[k] * (ps[k][m] - c[k]) for k in methods) / sw for m in ms}, actual(tech, Y), conv)['eur']))
        return out
    return errors


def main():
    mae_t = json.load(open(os.path.join(H, 'ppa_bias_test.json')))['mae']
    adopt = json.load(open(os.path.join(H, 'ppa_bias.json')))['adopt']
    out = {'applied': APPLIED, 'weights': {}, 'mae': {}}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            ad = adopt.get(tech, {}).get(conv, [])
            mae = {k: sum(mae_t[f'{tech} {conv} h={h}'][k]['all' if k in ad else 'none'] for h in (1, 2, 3)) / 3 for k in METHODS}
            inv = {k: 1 / max(v, 0.2) for k, v in mae.items()}
            s = sum(inv.values())
            w = {k: round(v / s, 4) for k, v in inv.items()} if APPLIED[tech] else {k: 0.25 for k in METHODS}
            out['weights'].setdefault(tech, {})[conv] = w
            out['mae'].setdefault(tech, {})[conv] = {k: round(v, 2) for k, v in mae.items()}
            print(tech, conv, w)
    # leave-one-out check of the methods in TESTED, in the published convention; then the published average's precision
    out['exclude'], out['check'], out['pubMae'] = {}, {}, {}
    try:
        errors = replay()
    except Exception as e:     # no runs: keep every method
        print('leave-one-out check skipped:', type(e).__name__)
        errors = None
    for tech in ('solar', 'wind'):
        ad = adopt.get(tech, {})
        if errors:
            for k in TESTED:
                w = out['weights'][tech]['curt']
                a = errors(tech, 'curt', METHODS, w, ad.get('curt', []))
                rest = tuple(m for m in METHODS if m != k)
                b = errors(tech, 'curt', rest, w, ad.get('curt', []))
                if a and b:
                    ea, eb = float(np.mean([abs(e) for _, e in a])), float(np.mean([abs(e) for _, e in b]))
                    out['check'].setdefault(tech, {})[k] = {'with': round(ea, 2), 'without': round(eb, 2), 'n': len(a)}
                    if eb < ea:
                        out['exclude'].setdefault(tech, []).append(k)
                    print(tech, k, 'with %.2f, without %.2f €/MWh' % (ea, eb), '→ out' if eb < ea else '→ kept')
        for conv in ('curt', 'all'):
            w = out['weights'][tech][conv]
            for k in out['exclude'].get(tech, []):
                w[k] = 0.0
            s = sum(w.values()) or 1
            out['weights'][tech][conv] = {k: round(v / s, 4) for k, v in w.items()}
            if errors:
                use = tuple(m for m in METHODS if out['weights'][tech][conv][m] > 0)
                e = errors(tech, conv, use, out['weights'][tech][conv], ad.get(conv, []))
                out['pubMae'].setdefault(tech, {})[conv] = {str(h): round(float(np.mean([abs(x) for hh, x in e if hh == h])), 2) for h in (1, 2, 3) if any(hh == h for hh, _ in e)}
    print('exclude', out['exclude'], 'pubMae', out['pubMae'])
    with open(os.path.join(H, 'ppa_weights.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
