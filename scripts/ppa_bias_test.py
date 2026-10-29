#!/usr/bin/env python3
"""Bias correction learnt only on a method's past errors, at the benchmark's horizon.

A method that keeps missing on the same side (the weather simulation too low on solar, the forward
shape too high) can be shifted by its own average past error. Here each method's capture is shifted by
the mean signed error (capture points, production-weighted) it made at the same horizon on the delivery
years already realised at pricing time (delivery year ≤ Y − h, 2022 left out), over the last N such years.

Protocol as scripts/ppa_horizon_test.py: delivery year Y priced with complete years ≤ Y − h, h = 1, 2, 3;
scored on 2024–2026 (2026 to date), both conventions; error on the value of one MWh (€/MWh). The
corrections need past errors, so the methods are also run on delivery years 2018–2023.
  none   no correction
  lastN  shift by the mean error of the last N realised years (N = 1, 2, 3, all)
  half   shift by half that mean (shrinkage)
Conclusive = lower mean absolute error at 1 and 2 years ahead in both conventions, 3 years no worse.

Writes data/history/ppa_bias_test.json (and caches the runs in .cache/ppa_bias_runs.json)
    python scripts/ppa_bias_test.py
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_backtest as B             # noqa: E402
import ppa_backtest_detail as BD     # noqa: E402
sys.argv = _argv

H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'ppa_bias_test.json')
CACHE = os.path.join(ROOT, '.cache', 'ppa_bias_runs.json')
RUN_YEARS = (2018, 2019, 2020, 2021, 2023, 2024, 2025, 2026)
# scored delivery years: complete ones only (a year still running has no realised capture yet: 2026 counts from 2027)
TEST = tuple(y for y in (2024, 2025, 2026, 2027, 2028) if y in L.DATA and L.DATA[y]['complete'])
HORIZONS = (1, 2, 3)
METHODS = ('step', 'fpc', 'weather', 'regional')
VARIANTS = {'none': (0, 0), 'last1': (1, 1), 'last2': (2, 1), 'last3': (3, 1), 'all': (99, 1), 'half2': (2, 0.5), 'half3': (3, 0.5)}


def runs(use_cache=True):
    """monthly predictions of every method, delivery year × horizon × technology × convention"""
    if use_cache and os.path.exists(CACHE):
        return json.load(open(CACHE))
    settings = json.load(open(os.path.join(H, 'ppa_forecast.json')))['settings']
    out = {}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Y in RUN_YEARS:
            if Y not in L.DATA:
                continue
            for h in HORIZONS:
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                last = max(known)
                tr = [y for y in known if st['with2022'] or y != 2022][-st['window']:]
                pm = L.PriceModel(tr, st['regional'], 'mean', st['level'] != 'none')
                capY = {c: {tt: L.cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = L.levels_for(Y, 'forward') if st['level'] == 'forward' else ({m: float(L.DATA[last]['fr_p'][L.DATA[last]['month'] == m].mean()) for m in range(1, 13)} if st['level'] == 'lastyear' else None)
                m4, _, _ = L.regional(t, Y, known, pm, last, capY, 0, lv, st['regional'])
                _, wmc, _ = BD.m_weather(t, Y, train, V, 40)
                for conv in ('curt', 'all'):
                    _, fm, _ = BD.m_fpc(t, Y, train, V, conv)
                    stp = BD.m_step(t, Y, train, V, conv)
                    P = {'step': {m: stp for m in range(1, 13)}, 'fpc': fm, 'weather': wmc[conv],
                         'regional': {m: m4[m][conv] for m in m4 if m4[m][conv] == m4[m][conv]}}
                    out[f'{tech}|{Y}|{h}|{conv}'] = {k: {str(m): float(v) for m, v in p.items() if v is not None} for k, p in P.items()}
                print('ran', tech, Y, h, flush=True)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(out, open(CACHE, 'w'))
    return out


def main():
    R = runs()
    act = {(tech, Y): L.actual('s' if tech == 'solar' else 'w', Y) for tech in ('solar', 'wind') for Y in RUN_YEARS if Y in L.DATA}
    pred = lambda tech, Y, h, conv, k: {int(m): v for m, v in R[f'{tech}|{Y}|{h}|{conv}'][k].items()} if f'{tech}|{Y}|{h}|{conv}' in R else None
    sc = lambda p, tech, Y, conv: L.score(p, act[(tech, Y)], conv) if p else None
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'mae': {}, 'conclusive': {}}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            for h in HORIZONS:
                res = {}
                for k in METHODS + ('avg4',):
                    for vn, (n, f) in VARIANTS.items():
                        errs = []
                        for Y in TEST:
                            def get(y, kk):
                                if kk == 'avg4':
                                    ps = [pred(tech, y, h, conv, mm) for mm in METHODS]
                                    if any(p is None for p in ps):
                                        return None
                                    ms = set.intersection(*[set(p) for p in ps])
                                    return {m: float(np.mean([p[m] for p in ps])) for m in ms}
                                return pred(tech, y, h, conv, kk)
                            p = get(Y, k)
                            if p is None:
                                continue
                            past = [y for y in RUN_YEARS if y <= Y - h and y != 2022 and get(y, k) is not None][-n:] if n else []
                            c = float(np.mean([sc(get(y, k), tech, y, conv)['pts'] for y in past])) / 100 * f if past else 0.0
                            s = sc({m: v - c for m, v in p.items()}, tech, Y, conv)
                            if s:
                                errs.append(abs(s['eur']))
                        res.setdefault(k, {})[vn] = round(float(np.mean(errs)), 2) if errs else None
                out['mae'][f'{tech} {conv} h={h}'] = res
    # conclusive: better than none at h=1 and h=2 in both conventions, not worse at h=3
    for tech in ('solar', 'wind'):
        for k in METHODS + ('avg4',):
            for vn in VARIANTS:
                if vn == 'none':
                    continue
                ok = True
                for conv in ('curt', 'all'):
                    m = lambda h: out['mae'][f'{tech} {conv} h={h}'][k]
                    if not (m(1)[vn] < m(1)['none'] and m(2)[vn] < m(2)['none'] and m(3)[vn] <= m(3)['none']):
                        ok = False
                if ok:
                    out['conclusive'].setdefault(f'{tech} {k}', []).append(vn)
    for key, res in out['mae'].items():
        print(key)
        for k, v in res.items():
            print('   %-9s ' % k + ' '.join(f'{vn} {e:.2f}' for vn, e in v.items() if e is not None))
    print('conclusive:', out['conclusive'])
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
