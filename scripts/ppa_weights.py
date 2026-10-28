#!/usr/bin/env python3
"""Weights of the four methods in the published PPA price: each method weighs by the inverse of its past error.

For each technology and convention, a method's error is its mean absolute error on 2024–2026, one, two and three
years ahead, AFTER its bias correction where that correction is adopted (data/history/ppa_bias_test.json, the
'all' variant for an adopted cell, 'none' otherwise; data/history/ppa_bias.json says which). Weight = 1 / error,
normalised to 1. Applied where it lowered the mean error of the average in the published convention (decided by
Tom 28 Oct. 2026 after a walk-forward test: solar 1.97 → 1.75 €/MWh with output stopped at ≤ 0 €; wind got worse,
1.29 → 1.36, so wind keeps equal weights). Recomputed every week with the test bench.

Writes data/history/ppa_weights.json  {"applied": {"solar": true, "wind": false}, "weights": {tech: {conv: {method: w}}},
                                       "mae": {tech: {conv: {method: €/MWh}}}}
    python scripts/ppa_weights.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
METHODS = ('step', 'fpc', 'weather', 'regional')
APPLIED = {'solar': True, 'wind': False}


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
    with open(os.path.join(H, 'ppa_weights.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
