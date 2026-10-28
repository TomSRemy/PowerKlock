#!/usr/bin/env python3
"""A price floor near zero in the hourly models (European price model, weather simulation): since 2025 most
plants stop at negative prices (stop obligation, balancing mechanism), so the price settles at about zero instead
of diving (Jan.–Oct. 2026: 74 % of the hours ≤ 0 € were between −1 € and 0). The floor changes only the
all-hours-paid convention (in the curtailed one, the hours ≤ 0 are not paid either way).
Protocol as scripts/ppa_horizon_test.py: delivery years 2024–2026 priced 1, 2 and 3 years ahead, error on the
value of one MWh (€/MWh), all-hours convention. Adoption: lower mean error over h1–h3.

Writes data/history/ppa_floor_test.json
    python scripts/ppa_floor_test.py
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

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_floor_test.json')
_src = inspect.getsource(BD.m_weather)
_a = """                pr = look(g, int(round((Ld[h] - s_ - w_ - nav) / 1000)))
                if res.get(g):
                    pr *= res[g][R.randrange(len(res[g]))]"""
assert _a in _src
_ns = dict(BD.__dict__)
exec(compile(_src.replace('def m_weather(', 'def m_weather_f(').replace(_a, _a + "\n                pr = max(pr, 0.0) if _FLOOR else pr", 1), 'm_weather_f', 'exec'), _ns)


class Floored(L.PriceModel):
    def expected(self, x, g):
        rm, rp, pp = super().expected(x, g)
        return rp, rp, pp          # the mean of max(price, 0): negative hours settle at zero


def main():
    settings = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')))['settings']
    rows = []
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Y in (2024, 2025, 2026):
            act = L.actual(t, Y)
            for h in (1, 2, 3):
                known = [y for y in L.DATA if y <= Y - h and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                last = max(known)
                tr = [y for y in known if st['with2022'] or y != 2022][-st['window']:]
                capY = {c: {tt: L.cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = L.levels_for(Y, 'forward') if st['level'] == 'forward' else ({m: float(L.DATA[last]['fr_p'][L.DATA[last]['month'] == m].mean()) for m in range(1, 13)} if st['level'] == 'lastyear' else None)
                row = {'tech': tech, 'year': Y, 'h': h}
                for vn, cls in (('base', L.PriceModel), ('floor', Floored)):
                    pm = cls(tr, st['regional'], 'mean', st['level'] != 'none')
                    m4, _, _ = L.regional(t, Y, known, pm, last, capY, 0, lv, st['regional'])
                    _ns['_FLOOR'] = vn == 'floor'
                    _ns['WX_FLOOR'] = vn == 'floor'
                    _, wmc, _ = _ns['m_weather_f'](t, Y, train, V, 40)
                    row[vn] = {'eu': (L.score({m: m4[m]['all'] for m in m4 if m4[m]['all'] == m4[m]['all']}, act, 'all') or {}).get('eur'),
                               'wx': (L.score(wmc['all'], act, 'all') or {}).get('eur')}
                rows.append(row)
                print(tech, Y, h, row, flush=True)
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': rows, 'mae': {}}
    for tech in ('solar', 'wind'):
        for k in ('eu', 'wx'):
            m = {vn: [float(np.mean([abs(r[vn][k]) for r in rows if r['tech'] == tech and r['h'] == h])) for h in (1, 2, 3)] for vn in ('base', 'floor')}
            out['mae'][f'{tech} {k}'] = m
            print(f"{tech:5s} {k}: base {'/'.join(f'{x:.2f}' for x in m['base'])} (mean {np.mean(m['base']):.2f}) → floor {'/'.join(f'{x:.2f}' for x in m['floor'])} (mean {np.mean(m['floor']):.2f})")
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
