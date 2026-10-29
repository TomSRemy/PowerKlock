#!/usr/bin/env python3
"""The weather simulation exists twice: in the test bench (scripts/ppa_backtest_detail.py m_weather, whose errors
set its bias correction) and in the pricer (js/ppa-wx.js). Two choices differ; which one prices better?
  noise   the pricer multiplies each hour's price by a residual drawn from the same recent years (price ÷ the
          table's value for that slot and net load), so prices scatter around the table, with more hours ≤ 0;
          the test bench takes the table's mean only
  demand  the pricer draws consumption and nuclear from the last two complete years (same month and day type),
          the test bench from the last one
Variants: bench (today's test bench), +noise, +demand2, +both (= the pricer's choices).
Protocol as scripts/ppa_horizon_test.py (delivery years 2024–2026 priced 1, 2, 3 years ahead, both conventions,
production-weighted error on the value of one MWh); adoption rule: lower mean error over h1–h3 in the published
convention (curt). The winning version goes into both, so the bias correction is the pricer's own.

Writes data/history/ppa_wx_align_test.json
    python scripts/ppa_wx_align_test.py
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

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_wx_align_test.json')
TARGETS = (2024, 2025, 2026)
HORIZONS = (1, 2, 3)
VARIANTS = {'bench': (False, False), 'noise': (True, False), 'demand2': (False, True), 'both': (True, True)}

_src = inspect.getsource(BD.m_weather)
# residuals of the price around the table, by slot (as js/ppa-wx.js priceCurve)
_a = """    def look(g, b):"""
_b = """    res = {}
    if _NOISE:
        for g in range(6):
            i = tr & (grp == g)
            vals = P[i] / B.mavg[i]
            bins = net[i]
            for v, bb in zip(vals, bins):
                f = tab.get((g, int(bb)))
                if f is not None and f > 0.05:
                    res.setdefault(g, []).append(float(v / f))

    def look(g, b):"""
# demand pool: last two complete years instead of the last one
_c = """    i_last = yr == last"""
_d = """    i_last = np.isin(yr, train[-2:]) if _DEM2 else yr == last"""
# the hour's price: × a drawn residual
_e = """                pr = look(g, int(round((Ld[h] - s_ - w_ - nav) / 1000)))"""
_f = """                pr = look(g, int(round((Ld[h] - s_ - w_ - nav) / 1000)))
                if _NOISE and res.get(g):
                    rr = res[g]
                    pr *= rr[R.randrange(len(rr))]"""
if not all(x in _src for x in (_a, _c, _e)):
    # since 28 Oct. 2026 the test bench carries the chosen rule (WX_NOISE / WX_DEMAND2): this test is a record
    sys.exit('the test bench already applies the per-technology rule; results in data/history/ppa_wx_align_test.json')
_ns = dict(BD.__dict__)
exec(compile(_src.replace('def m_weather(', 'def m_weather_v(').replace(_a, _b, 1).replace(_c, _d, 1).replace(_e, _f, 1), 'm_weather_v', 'exec'), _ns)


def main():
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': []}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        for Y in TARGETS:
            act = L.actual(t, Y)
            for h in HORIZONS:
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                row = {'tech': tech, 'year': Y, 'h': h, 'curt': {}, 'all': {}}
                for vn, (noise, dem2) in VARIANTS.items():
                    _ns['_NOISE'], _ns['_DEM2'] = noise, dem2
                    _, wmc, _ = _ns['m_weather_v'](t, Y, train, V, 40)
                    for conv in ('curt', 'all'):
                        row[conv][vn] = (L.score(wmc[conv], act, conv) or {}).get('eur')
                out['rows'].append(row)
                print(tech, Y, f'h={h}', ' | '.join(f"{vn} {row['curt'][vn]:+.2f}" for vn in VARIANTS), flush=True)
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            m = {vn: [float(np.mean([abs(r[conv][vn]) for r in out['rows'] if r['tech'] == tech and r['h'] == h])) for h in HORIZONS] for vn in VARIANTS}
            out['mae'][f'{tech} {conv}'] = {vn: [round(x, 2) for x in v] for vn, v in m.items()}
            print(f'{tech:5s} {conv:4s} ' + ' | '.join(f"{vn} {'/'.join(f'{x:.2f}' for x in v)} (mean {np.mean(v):.2f})" for vn, v in m.items()))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
