#!/usr/bin/env python3
"""Is the PPA price as good at any stop threshold as at 0 €? (Tom 1–2 Nov. 2026: "le pricer doit être robuste quel
que soit le seuil d'arrêt choisi")

The pricer prices a park that stops below a threshold T by the scenario generator's capture at T = 0, times each
month's ratio of capture (and paid share) at T to at 0 measured on the last two complete years (build_fr_capture
'stopT'). Replay, the cases of scripts/ppa_model_risk.py (each delivery year from 2023, priced 1, 2 and 3 years ahead
with only the complete years known then, the anchoring it chose): for each T of the grid, the generator's capture × the
ratio measured on the two complete years known then, against the realised capture at T; production-weighted on the
paid output, in capture points and in € on the realised baseload, as the model risk. Variants of the ratio: the last
two known years (the pricer until 2 Nov. 2026), the last known year only, none (the T = 0 capture kept), and 'pricer'
(the rule since 2 Nov. 2026: below 0, the last year's gap plus its change on the year before, damped; above 0, the last
year's level).

The model risk taken off the price (75th percentile of the errors, recent deliveries weighing more) is given per T, so
the pricer can take the one of the threshold chosen instead of the one measured at 0.

Writes data/history/ppa_threshold_test.json
    python scripts/ppa_threshold_test.py
"""
import json
import os
import sys
import warnings
from datetime import date

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_scenarios as G            # noqa: E402
import ppa_model_risk as R           # noqa: E402
sys.argv = _argv
warnings.simplefilter('ignore')

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_threshold_test.json')
GRID = [-20, -10, -5, -1, 0, 5]


def month_stats(t, Y, T):
    """each month of year Y: capture at T (stop below T) ÷ baseload, paid share, baseload, output"""
    a = L.DATA[Y]
    P, V = a['fr_p'], a['fr_' + t]
    out = {}
    for m in range(1, 13):
        k = a['month'] == m
        if k.sum() < 20:
            continue
        Pm, Vm = P[k], V[k]
        pos = Pm >= T
        base = Pm.mean()
        out[m] = {'curt': float((Vm[pos] * Pm[pos]).sum() / Vm[pos].sum() / base) if Vm[pos].sum() > 0 else None,
                  'paid': float(Vm[pos].sum() / Vm.sum()), 'base': float(base), 'mwh': float(Vm.sum()), 'days': int(k.sum())}
    return out


def ratios(t, years, T):
    """per month, capture and paid share at T ÷ at 0, pooled over the years given (sums, as build_fr_capture)"""
    c, p = {}, {}
    for m in range(1, 13):
        n = {T: [0.0, 0.0, 0.0], 0: [0.0, 0.0, 0.0]}
        for y in years:
            a = L.DATA[y]
            k = a['month'] == m
            P, V = a['fr_p'][k], a['fr_' + t][k]
            for tt in (T, 0):
                pos = P >= tt
                n[tt][0] += float((V[pos] * P[pos]).sum()); n[tt][1] += float(V[pos].sum()); n[tt][2] += float(V.sum())
        if n[0][1] > 0 and n[T][1] > 0 and n[0][0] != 0:
            c[m] = (n[T][0] / n[T][1]) / (n[0][0] / n[0][1])
            p[m] = n[T][1] / n[0][1]
    return c, p


def score(pred, act):
    ms = [m for m in act if pred.get(m) is not None and act[m]['curt'] is not None]
    if not ms:
        return None
    w = np.array([act[m]['mwh'] * act[m]['paid'] for m in ms])
    ep = np.array([pred[m] - act[m]['curt'] for m in ms])
    e = ep * np.array([act[m]['base'] for m in ms])
    return {'pts': float((w * ep).sum() / w.sum() * 100), 'eur': float((w * e).sum() / w.sum())}


def main():
    settings = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    mr = json.load(open(R.OUT))
    F = G.fuel_cost()
    rows = []
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        mode = mr['anchorMode'].get(tech, 'none')
        for Y in range(R.FIRST, date.today().year + 1):
            if Y not in L.DATA:
                continue
            acts = {T: {m: v for m, v in month_stats(t, Y, T).items() if v['days'] >= 28} for T in GRID}
            if not acts[0]:
                continue
            for h in (1, 2, 3):
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                A = max(known)
                if A < 2022:
                    continue
                capY = {c: {tt: L.cap_guess(c, tt, Y, A) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = {m: float(L.DATA[A]['fr_p'][L.DATA[A]['month'] == m].mean()) for m in range(1, 13)}
                c0 = float(np.mean([v for k, v in F.items() if f'{A}-12-01' <= k <= f'{A}-12-31']))
                gm, _ = G.simulate(t, Y, known, st, A, capY, lv, n=30, rule='fuel', cost=lambda d: c0, batteries='both',
                                   pool_from=2019, fuel_dev=True, france=True, seed=7)
                K = G.anchor_factors(t, A, known, st, lambda d: c0)
                k_ = K.get(mode, K.get('none'))
                base0 = {m: v['curt'] * k_['curt'][m] for m, v in gm.items()}
                row = {'tech': tech, 'year': Y, 'h': h, 'known': A, 'byT': {}}
                for T in GRID:
                    two = [y for y in known if y >= A - 1]
                    v = {}
                    for name, ys in (('two', two), ('one', [A]), ('none', None), ('pricer', [A, A - 1])):
                        if ys is None:
                            pred = base0
                        elif name == 'pricer' and T < 0 and A - 1 in L.DATA:
                            # the pricer's rule (js/tool-ppa.js stopRatio): the latest year's gap + its change on the year
                            # before, damped (×1, ×1.5, ×1.75 at 1, 2, 3 years)
                            ra, _ = ratios(t, [A], T); rb, _ = ratios(t, [A - 1], T)
                            k = sum(0.5 ** j for j in range(h))
                            pred = {m: b * min(1.0, max(0.5, 1 - max(0.0, (1 - ra.get(m, 1)) + k * ((1 - ra.get(m, 1)) - (1 - rb.get(m, 1)))))) for m, b in base0.items()}
                        else:
                            rc, _ = ratios(t, ys if name != 'pricer' else [A], T)
                            pred = {m: b * rc.get(m, 1.0) for m, b in base0.items()}
                        sc = score(pred, acts[T])
                        if sc:
                            v[name] = {'pts': round(sc['pts'], 3), 'eur': round(sc['eur'], 3)}
                    row['byT'][str(T)] = v
                rows.append(row)
                print(tech, Y, f'h={h}', '  '.join(f"T{T}: {row['byT'][str(T)].get('two', {}).get('eur', float('nan')):+.2f}" for T in GRID), flush=True)
    out = {'asOf': date.today().isoformat(), 'grid': GRID, 'level': R.LEVEL, 'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows}
    for tech in ('solar', 'wind'):
        rs = [r for r in rows if r['tech'] == tech]
        if not rs:
            continue
        last = max(r['year'] for r in rs)
        w = np.array([0.5 ** ((last - r['year']) / R.HALF) for r in rs])
        out[tech] = {}
        for T in GRID:
            out[tech][str(T)] = {}
            for name in ('two', 'one', 'none', 'pricer'):
                ok = [i for i, r in enumerate(rs) if name in r['byT'][str(T)]]
                if not ok:
                    continue
                p = np.array([rs[i]['byT'][str(T)][name]['pts'] for i in ok]); e = np.array([rs[i]['byT'][str(T)][name]['eur'] for i in ok]); ww = w[ok]
                out[tech][str(T)][name] = {'n': len(ok), 'meanEur': round(float((ww * e).sum() / ww.sum()), 3), 'maeEur': round(float(np.abs(e).mean()), 3),
                                           'meanPts': round(float((ww * p).sum() / ww.sum()), 3), 'qPts': round(R.wquantile(p, ww, R.LEVEL), 3)}
            print(tech, T, out[tech][str(T)])
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
        print('wrote', OUT)


if __name__ == '__main__':
    main()
