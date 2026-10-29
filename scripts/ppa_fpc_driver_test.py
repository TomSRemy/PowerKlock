#!/usr/bin/env python3
"""Forward shape, wind: the cannibalisation term (realised value − value on the decorrelated skeleton, per season) is
projected with the logarithm of wind's own installed capacity, anchored on the last year. But wind's summer value is
eaten by solar's midday hours (prices ≤ 0), and the wind fleet grows slowly: the projection stays flat while solar
adds 14 GW by 2029. Variants of the driver: own (today), solar (the solar fleet, both seasons), vre (solar + wind),
mix (summer on solar, winter on wind's own), each anchored on the last year; solar_a2 and solar_fit: the solar
driver anchored on the mean of the last two years, or on the fitted line at the last year.
Protocol as scripts/ppa_horizon_test.py (delivery years priced 1, 2 and 3 years ahead), scored on complete delivery
years only (2024, 2025; 2026 shown apart, not counted: a year still running); adoption: lower mean error over
h1–h3 in the curtailed convention.

Writes data/history/ppa_fpc_driver_test.json
    python scripts/ppa_fpc_driver_test.py
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

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_fpc_driver_test.json')
VARIANTS = ('own', 'solar', 'vre', 'mix', 'solar_a2', 'solar_fit')
_src = inspect.getsource(BD.m_fpc)
_a = """        b = B.logfit([B.CAP[FPC_DRIVER][y] for y in train], cs) if len(train) >= 3 else 0
        for m in months:
            cterm[m] = cs[-1] + b * (math.log(B.cap_guess(FPC_DRIVER, Y, last)) - math.log(B.CAP[FPC_DRIVER][last]))"""
_b = """        drv = lambda y, g=None: _drv(t, months, y, g)
        b = B.logfit([drv(y) for y in train], cs) if len(train) >= 3 else 0
        for m in months:
            anc = float(np.mean(cs[-2:])) if _V == 'solar_a2' else (float(np.mean(cs)) + b * (math.log(drv(last)) - float(np.mean([math.log(drv(y)) for y in train]))) if _V == 'solar_fit' else cs[-1])
            cterm[m] = anc + b * (math.log(drv(Y, last)) - math.log(drv(last)))"""
assert _a in _src
_ns = dict(BD.__dict__)
_ns['math'] = math
_ns['np'] = np


def _drv(t, months, y, last=None):
    """installed GW driving the cannibalisation of technology t in these months, year y (a future year: last + trend)"""
    g = (lambda tt: B.cap_guess(tt, y, last)) if last is not None else (lambda tt: B.CAP[tt][y])
    v = _ns['_V']
    if t == 's' or v == 'own':
        return g(t)
    if v in ('solar', 'solar_a2', 'solar_fit') or (v == 'mix' and 4 in months):
        return g('s')
    if v == 'vre':
        return g('s') + g('w')
    return g(t)


_ns['_drv'] = _drv
exec(compile(_src.replace('def m_fpc(', 'def m_fpc_v(').replace(_a, _b, 1), 'm_fpc_v', 'exec'), _ns)


def main():
    rows = []
    t, V = 'w', B.W
    for Y in (2024, 2025, 2026):
        act = L.actual(t, Y)
        for h in (1, 2, 3):
            known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
            train = [y for y in known if y != 2022]
            if len(train) < 3:
                continue
            row = {'year': Y, 'h': h, 'complete': bool(L.DATA[Y]['complete'])}
            for vn in VARIANTS:
                _ns['_V'] = vn
                row[vn] = {}
                for conv in ('curt', 'all'):
                    _, fm, _ = _ns['m_fpc_v'](t, Y, train, V, conv)
                    row[vn][conv] = (L.score(fm, act, conv) or {}).get('eur')
            rows.append(row)
            print(Y, h, {vn: round(row[vn]['curt'], 2) for vn in VARIANTS}, flush=True)
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows, 'mae': {}}
    for scope, ok in (('complete', lambda r: r['complete']), ('with2026', lambda r: True)):
        for conv in ('curt', 'all'):
            m = {vn: [float(np.mean([abs(r[vn][conv]) for r in rows if r['h'] == h and ok(r)])) for h in (1, 2, 3)] for vn in VARIANTS}
            out['mae'][f'{scope} {conv}'] = m
            print(f'{scope:9s} {conv:4s} ' + ' | '.join(f"{vn} {'/'.join(f'{x:.2f}' for x in v)} (mean {np.mean(v):.2f})" for vn, v in m.items()))
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
