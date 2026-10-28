#!/usr/bin/env python3
"""Forward shape: how the hours at prices <= 0 are counted. Today the forward term (expected output on the skeleton
calibrated to the quotes) pays every hour, the negative ones of the skeleton included, while the cannibalisation term
(realised − decorrelated, per season) is learnt on the paid hours only (curtailed convention): the negative hours of
the skeleton weigh on the forward term and nothing offsets them. Variants:
  base    today
  paid    the forward term on the skeleton's paid hours (> 0), as the decorrelated one
  dall    the decorrelated term with every hour paid, so the cannibalisation term carries the stop at prices <= 0
  floor   the skeleton floored at 0 (plants stop at negative prices, so the price settles at about zero)
Protocol as scripts/ppa_horizon_test.py (priced 1, 2 and 3 years ahead), scored on complete delivery years
(2024, 2025; 2026 shown apart); adoption: lower mean error over h1–h3 in the curtailed convention.

Writes data/history/ppa_fpc_neg_test.json
    python scripts/ppa_fpc_neg_test.py
"""
import inspect
import json
import math
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

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_fpc_neg_test.json')
VARIANTS = ('base', 'paid', 'dall', 'floor')
_src = inspect.getsource(BD.m_fpc)
_r = [("""    sk, pv, mm, hh = np.array(sk), np.array(pv), np.array(mm), np.array(hh)
    f = (pv * sk).sum() / pv.sum() / sk.mean() - 1
    fm = {m: (pv[mm == m] * sk[mm == m]).sum() / pv[mm == m].sum() / sk[mm == m].mean() - 1 for m in range(1, 13)}""",
       """    sk, pv, mm, hh = np.array(sk), np.array(pv), np.array(mm), np.array(hh)
    if _V == 'floor':
        sk = np.maximum(sk, 0.0)
    pk = (sk > 0) if (_V == 'paid' and conv != 'all') else np.ones(len(sk), bool)
    f = (pv * sk)[pk].sum() / pv[pk].sum() / sk.mean() - 1
    fm = {m: (pv * sk)[pk & (mm == m)].sum() / pv[pk & (mm == m)].sum() / sk[mm == m].mean() - 1 for m in range(1, 13)}"""),
      ("""        full[i] = B.decorrelated(y, co)""",
       """        full[i] = B.decorrelated(y, co)
        if _V == 'floor':
            full[i] = np.maximum(full[i], 0.0)"""),
      ("""            cs.append(rate(k, V, P, conv) - rate(k, V, fulls[y], conv))""",
       """            cs.append(rate(k, V, P, conv) - rate(k, V, fulls[y], 'all' if _V == 'dall' else conv))""")]
for a, _ in _r:
    assert a in _src, a[:50]
for a, b in _r:
    _src = _src.replace(a, b, 1)
_ns = dict(BD.__dict__)
_ns['math'] = math
exec(compile(_src.replace('def m_fpc(', 'def m_fpc_v('), 'm_fpc_v', 'exec'), _ns)


def main():
    rows = []
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        for Y in (2024, 2025, 2026):
            act = L.actual(t, Y)
            for h in (1, 2, 3):
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                row = {'tech': tech, 'year': Y, 'h': h, 'complete': bool(L.DATA[Y]['complete'])}
                for vn in VARIANTS:
                    _ns['_V'] = vn
                    row[vn] = {}
                    for conv in ('curt', 'all'):
                        yy, fm, _ = _ns['m_fpc_v'](t, Y, train, V, conv)
                        row[vn][conv] = (L.score(fm, act, conv) or {}).get('eur')
                        row[vn][conv + 'Rate'] = yy
                rows.append(row)
                print(tech, Y, h, {vn: (round(row[vn]['curt'], 2), round(row[vn]['curtRate'], 3)) for vn in VARIANTS}, flush=True)
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows, 'mae': {}}
    for tech in ('solar', 'wind'):
        for scope, ok in (('complete', lambda r: r['complete']), ('with2026', lambda r: True)):
            for conv in ('curt', 'all'):
                m = {vn: [float(np.mean([abs(r[vn][conv]) for r in rows if r['tech'] == tech and r['h'] == h and ok(r)])) for h in (1, 2, 3)] for vn in VARIANTS}
                out['mae'][f'{tech} {scope} {conv}'] = m
                print(f'{tech:5s} {scope:9s} {conv:4s} ' + ' | '.join(f"{vn} {'/'.join(f'{x:.2f}' for x in v)} (mean {np.mean(v):.2f})" for vn, v in m.items()))
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
