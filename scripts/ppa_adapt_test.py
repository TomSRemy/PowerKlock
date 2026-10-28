#!/usr/bin/env python3
"""Do the hourly models miss the market's adaptation? Price tables bounded by what the last year showed.

The European price model and the weather simulation read the price of an hour (÷ the month's average) in
a table learnt on past years, by time slot × residual load. With more solar each delivery year, the hours
fall deeper into surplus, where older years had few hours and very low prices; the market has since adapted
(curtailment at prices ≤ 0, batteries, exports), so the same surplus no longer drives prices as low.
Variants of the tables, everything else as today (data/history/ppa_forecast.json settings):
  base        today's tables
  lastfloor   no bin of a time slot below the lowest bin value the last complete year showed in that slot
              (European model: also its share of hours with a positive price)
  lastdeep    the bins the last complete year filled (≥ 15 hours in the European model, ≥ 20 in the weather
              table) take the last year's values instead of the multi-year ones
Protocol as scripts/ppa_horizon_test.py: delivery year Y priced with the complete years ≤ Y − h, h = 1, 2, 3,
scored on 2024–2026 (2026 to date), both conventions, production-weighted error on the value of one MWh
(€/MWh); the 4-method average recomputed with the variant (capacity trend and forward shape unchanged).
Adoption rule (Tom, 28 Oct. 2026): lower mean error over h = 1–3 in the published convention (curt).

Writes data/history/ppa_adapt_test.json
    python scripts/ppa_adapt_test.py
"""
import inspect
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
OUT = os.path.join(H, 'ppa_adapt_test.json')
TARGETS = (2024, 2025, 2026)
HORIZONS = (1, 2, 3)
VARIANTS = ('base', 'lastfloor', 'lastdeep')


# ── European model: the table bounded by the last complete year's ────────────────────────────
def eu_model(tr, last, st, variant):
    pm = L.PriceModel(tr, st['regional'], 'mean', st['level'] != 'none')
    if variant == 'base':
        return pm
    ref = L.PriceModel([last], st['regional'], 'mean', st['level'] != 'none')
    G = pm.mean.shape[0]
    for gi in range(G):
        # bins of the last year, mapped on pm's bins (same BIN width, different offsets)
        filled = [(bi, bi + ref.lo - pm.lo) for bi in range(ref.nb) if (gi, bi) in ref.lists and 0 <= bi + ref.lo - pm.lo < pm.nb]
        if not filled:
            continue
        if variant == 'lastfloor':
            lo_m = min(ref.mean[gi, bi] for bi, _ in filled); lo_p = min(ref.ppos[gi, bi] for bi, _ in filled); lo_mp = min(ref.mpos[gi, bi] for bi, _ in filled)
            pm.mean[gi] = np.maximum(pm.mean[gi], lo_m); pm.ppos[gi] = np.maximum(pm.ppos[gi], lo_p); pm.mpos[gi] = np.maximum(pm.mpos[gi], lo_mp)
        else:
            for bi, k in filled:
                pm.mean[gi, k], pm.mpos[gi, k], pm.ppos[gi, k] = ref.mean[gi, bi], ref.mpos[gi, bi], ref.ppos[gi, bi]
    return pm


# ── weather simulation: the same two variants in its price table ─────────────────────────────
_src = inspect.getsource(BD.m_weather)
_old = """    def look(g, b):"""
_new = """    if _VAR != 'base':
        lastY = train[-1]
        tl = yr == lastY
        ref = {}
        for g in range(6):
            for b in np.unique(net[tl & (grp == g)]):
                i = tl & (grp == g) & (net == b)
                if i.sum() >= 20:
                    ref[(g, int(b))] = float((P[i] / B.mavg[i]).mean())
        if _VAR == 'lastfloor':
            for g in range(6):
                lo = [v for (gg, _), v in ref.items() if gg == g]
                if lo:
                    m = min(lo)
                    for key in [k for k in tab if k[0] == g]:
                        tab[key] = max(tab[key], m)
        else:
            tab.update(ref)

    def look(g, b):"""
assert _old in _src
_ns = dict(BD.__dict__)
exec(compile(_src.replace('def m_weather(', 'def m_weather_v(').replace(_old, _new, 1), 'm_weather_v', 'exec'), _ns)


def weather(t, Y, train, V, variant):
    _ns['_VAR'] = variant
    return _ns['m_weather_v'](t, Y, train, V, 40)


def main():
    settings = json.load(open(os.path.join(H, 'ppa_forecast.json')))['settings']
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': []}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Y in TARGETS:
            act = L.actual(t, Y)
            for h in HORIZONS:
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                last = max(known)
                lastc = max(y for y in train)
                tr = [y for y in known if st['with2022'] or y != 2022][-st['window']:]
                capY = {c: {tt: L.cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = L.levels_for(Y, 'forward') if st['level'] == 'forward' else ({m: float(L.DATA[last]['fr_p'][L.DATA[last]['month'] == m].mean()) for m in range(1, 13)} if st['level'] == 'lastyear' else None)
                stp = {conv: BD.m_step(t, Y, train, V, conv) for conv in ('curt', 'all')}
                fpc = {conv: BD.m_fpc(t, Y, train, V, conv)[1] for conv in ('curt', 'all')}
                row = {'tech': tech, 'year': Y, 'h': h, 'curt': {}, 'all': {}}
                for vn in VARIANTS:
                    m4, _, _ = L.regional(t, Y, known, eu_model(tr, lastc, st, vn), last, capY, 0, lv, st['regional'])
                    _, wmc, _ = weather(t, Y, train, V, vn)
                    for conv in ('curt', 'all'):
                        reg = {m: m4[m][conv] for m in m4 if m4[m][conv] == m4[m][conv]}
                        P = {'step': {m: stp[conv] for m in range(1, 13)}, 'fpc': fpc[conv], 'weather': wmc[conv], 'regional': reg}
                        ks = [m for m in range(1, 13) if all(P[k].get(m) is not None for k in P)]
                        P['avg4'] = {m: float(np.mean([P[k][m] for k in ('step', 'fpc', 'weather', 'regional')])) for m in ks}
                        row[conv][vn] = {k: (L.score(P[k], act, conv) or {}).get('eur') for k in ('regional', 'weather', 'avg4')}
                out['rows'].append(row)
                print(tech, Y, f'h={h}', ' | '.join(f"{vn}: eu {row['curt'][vn]['regional']:+.2f} wx {row['curt'][vn]['weather']:+.2f}" for vn in VARIANTS), flush=True)
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            for h in HORIZONS:
                rs = [r for r in out['rows'] if r['tech'] == tech and r['h'] == h]
                out['mae'][f'{tech} {conv} h={h}'] = {vn: {k: round(float(np.mean([abs(r[conv][vn][k]) for r in rs if r[conv][vn].get(k) is not None])), 2) for k in ('regional', 'weather', 'avg4')} for vn in VARIANTS}
    for tech in ('solar', 'wind'):
        for k in ('regional', 'weather', 'avg4'):
            for conv in ('curt', 'all'):
                m = {vn: [out['mae'][f'{tech} {conv} h={h}'][vn][k] for h in HORIZONS] for vn in VARIANTS}
                print(f'{tech:5s} {k:8s} {conv:4s} ' + ' | '.join(f"{vn} {'/'.join(f'{x:.2f}' for x in v)} (mean {np.mean(v):.2f})" for vn, v in m.items()))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
