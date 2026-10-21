#!/usr/bin/env python3
"""Walk-forward test of the PPA pricer's methods: is a conclusion true for one year only?

Every delivery year from 2020 to 2026 (2022 left out) is a test year in turn. For each one,
everything is chosen with the years BEFORE it only, exactly as it would have been at the time:
  1. the regional price model's settings (window, neighbours, price level, 2022 in training);
  2. the method or combination used (the lowest production-weighted monthly error, €/MWh,
     on the earlier years);
then the test year is scored. Fixed strategies (each method, the 3- and 4-method averages)
are scored on every year too, to see which ones hold across years and which shine once.

Inputs: data/history/ppa_lab.json (dashboard, step, fpc), ppa_backtest_detail.json and a
weather run for 2026 (MC weather), regional runs recomputed here for every setting.
Writes data/history/ppa_walkforward.json
"""
import itertools
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
OUT = os.path.join(H, 'ppa_walkforward.json')
YEARS = [2019, 2020, 2021, 2023, 2024, 2025, 2026]
TESTS = [2020, 2021, 2023, 2024, 2025, 2026]
SETTINGS = [dict(window=k, regional=r, level=lv, with2022=w) for k, r, lv, w in itertools.product((2, 3, 5, 8), (True, False), ('none', 'lastyear', 'forward'), (False, True))]
BASE = ('dashboard', 'step', 'fpc', 'weather')
COMBOS = {'avg3': ('step', 'fpc', 'regional'), 'avg4': ('step', 'fpc', 'regional', 'weather'), 'avg_sfw': ('step', 'fpc', 'weather')}


def key(st):
    return f"w{st['window']}{'R' if st['regional'] else 'F'}{st['level'][0]}{'22' if st['with2022'] else ''}"


def monthly_err(pred, act, conv):
    """production-weighted mean |error| (€/MWh) over the months, and the weight"""
    num = den = 0.0
    for m, a in act.items():
        p = pred.get(m)
        if p is None or a[conv] is None:
            continue
        w = a['mwh'] * (a['paid'] if conv == 'curt' else 1)
        num += w * abs(p - a[conv]) * a['base']; den += w
    return num, den


def main():
    lab = json.load(open(os.path.join(H, 'ppa_lab.json')))
    det = json.load(open(os.path.join(H, 'ppa_backtest_detail.json')))
    cache_f = os.environ.get('PK_WF_CACHE', '/tmp/pk_wf_cache.json')
    cache = json.load(open(cache_f)) if os.path.exists(cache_f) else {}
    preds, acts = {}, {}
    for t in 'sw':
        tech = L.TECH[t]
        V = B.S if t == 's' else B.W
        for Y in YEARS:
            acts[(tech, Y)] = {m: v for m, v in L.actual(t, Y).items()}
            row = next(r for r in lab['rows'] if r['tech'] == tech and r['year'] == Y)
            for conv in ('all', 'curt'):
                P = preds.setdefault((tech, Y, conv), {})
                for k in ('dashboard', 'step', 'fpc'):
                    P[k] = {int(m): v for m, v in row['pred'][conv][k].items()}
                d = next((x for x in det['rows'] if x['tech'] == tech and x['year'] == Y and x['conv'] == conv), None)
                if d:
                    P['weather'] = {mm['m']: mm['pred']['weather'] for mm in d['months'] if mm['pred']['weather'] is not None}
            if Y == 2026:
                ck = f'weather|{tech}|2026'
                if ck not in cache:
                    train = [y for y in B.YEARS if y < 2026 and y != 2022]
                    _, wm, _ = BD.m_weather(t, 2026, train, V, 40)
                    cache[ck] = {c: {str(m): v for m, v in wm[c].items()} for c in ('all', 'curt')}
                for conv in ('all', 'curt'):
                    preds[(tech, Y, conv)]['weather'] = {int(m): v for m, v in cache[ck][conv].items()}
            # the regional model under every setting
            for st in SETTINGS:
                ck = f'reg|{tech}|{Y}|{key(st)}'
                if ck not in cache:
                    pm, past = L.make_pm(Y, st)
                    last = max(past)
                    capY = {c: {tt: L.cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                    m4, _, _ = L.regional(t, Y, past, pm, last, capY, 0, L.levels_for(Y, st['level']), st['regional'])
                    cache[ck] = {c: {str(m): m4[m][c] for m in m4} for c in ('all', 'curt')}
                for conv in ('all', 'curt'):
                    preds[(tech, Y, conv)]['reg:' + key(st)] = {int(m): v for m, v in cache[ck][conv].items()}
            json.dump(cache, open(cache_f, 'w'))
            print('computed', tech, Y, flush=True)

    def series(tech, Y, conv, name, regkey):
        P = preds[(tech, Y, conv)]
        if name in COMBOS:
            parts = [P['reg:' + regkey] if k == 'regional' else P.get(k) for k in COMBOS[name]]
            if any(p is None for p in parts):
                return {}
            return {m: float(np.mean([p[m] for p in parts])) for m in range(1, 13) if all(m in p for p in parts)}
        if name == 'regional':
            return P['reg:' + regkey]
        return P.get(name, {})

    def err_over(tech, years, conv, name, regkey):
        num = den = 0.0
        for y in years:
            n, d = monthly_err(series(tech, y, conv, name, regkey), acts[(tech, y)], conv)
            num += n; den += d
        return num / den if den else None

    out = {'years': YEARS, 'tests': TESTS, 'criterion': 'production-weighted monthly error, €/MWh', 'fixed': {}, 'walk': {}}
    strategies = list(BASE) + ['regional'] + list(COMBOS)
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            # fixed strategies, every year (regional at the settings chosen on 2019-2023, as in the test bench)
            st0 = lab['settings']['s' if tech == 'solar' else 'w']
            rk0 = key(st0)
            fixed = {s: {y: err_over(tech, [y], conv, s, rk0) for y in YEARS} for s in strategies}
            # walk-forward: settings and strategy chosen on the years before
            walk = {}
            for Y in TESTS:
                prior = [y for y in YEARS if y < Y]
                rk = min((key(st) for st in SETTINGS), key=lambda k: err_over(tech, prior, conv, 'regional', k) or 9e9)
                cand = {s: err_over(tech, prior, conv, s, rk) for s in strategies}
                cand = {s: v for s, v in cand.items() if v is not None}
                pick = min(cand, key=cand.get)
                walk[Y] = {'settings': rk, 'pick': pick, 'error': err_over(tech, [Y], conv, pick, rk),
                           'best_in_hindsight': min(strategies, key=lambda s: err_over(tech, [Y], conv, s, rk) or 9e9),
                           'all': {s: err_over(tech, [Y], conv, s, rk) for s in strategies}}
            out['fixed'].setdefault(tech, {})[conv] = fixed
            out['walk'].setdefault(tech, {})[conv] = walk
            print(f'\n{tech} {conv}')
            for s in strategies:
                v = [fixed[s][y] for y in TESTS]
                if None in v:
                    continue
                print('  %-10s ' % s + ' '.join('%5.1f' % x for x in v) + '   mean %.2f  worst %.1f' % (np.mean(v), max(v)))
            print('  walk-fwd   ' + ' '.join('%5.1f' % walk[y]['error'] for y in TESTS) + '   mean %.2f' % np.mean([walk[y]['error'] for y in TESTS]) +
                  '   picks: ' + ', '.join(f"{y}:{walk[y]['pick']}" for y in TESTS))
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))


if __name__ == '__main__':
    main()
