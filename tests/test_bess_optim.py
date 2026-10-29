#!/usr/bin/env python3
"""Checks of scripts/bess_optim.py on small days whose answer can be worked out by hand."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts'))
import bess_optim as b  # noqa: E402

fails = []


def check(name, ok, detail=''):
    print(('ok   ' if ok else 'FAIL ') + name + (' ' + str(detail) if detail and not ok else ''))
    if not ok:
        fails.append(name)


# 12 h at 0 EUR/MWh then 12 h at 100: a 2 h battery that starts empty, with no losses and no costs, earns one full cycle
prm = {**b.PARAMS, 'rte': 1.0, 'soc_start': 0.0, 'grid_withdrawal': 0.0, 'grid_injection': 0.0, 'max_cycles_day': 1.0}
p = np.array([0.0] * 48 + [100.0] * 48)
rev, mwh = b.optimise_day(p, 2, 0.0, prm)
check('one cycle without losses = 2 MWh x 100', abs(rev - 200) < 1e-6 and abs(mwh - 2) < 1e-6, (rev, mwh))

# 81 % round trip (90 % each way): 2 MWh stored cost 2/0.9 MWh of grid energy and give back 2 x 0.9 MWh
prm2 = {**prm, 'rte': 0.81}
rev2, mwh2 = b.optimise_day(p, 2, 0.0, prm2)
check('efficiency is applied on both legs', abs(mwh2 - 1.8) < 1e-6 and abs(rev2 - 180) < 1e-6, (rev2, mwh2))

# flat prices: nothing to earn, and a wear cost never makes the battery lose money
flat = np.full(96, 50.0)
r0 = b.optimise_day(flat, 2, 0.0, b.PARAMS)
check('flat prices earn nothing', r0 is not None and r0[0] <= 1e-6, r0)
rw = b.optimise_day(p, 2, 15.0, prm2)
check('wear cost shrinks the schedule, never negative', rw is not None and rw[0] >= -1e-9 and rw[1] <= mwh2 + 1e-9, rw)

# the daily cycle cap holds
prm3 = {**b.PARAMS, 'max_cycles_day': 0.5}
zig = np.tile(np.array([0.0] * 4 + [100.0] * 4), 12)
r3 = b.optimise_day(zig, 2, 0.0, prm3)
check('cycle cap respected', r3 is not None and r3[1] <= 0.5 * 2 + 1e-6, r3)

# the schedule without price knowledge never beats the one that sees the day
rng = np.random.default_rng(1)
worse = 0
for _ in range(20):
    base = np.repeat(rng.normal(80, 30, 24), 4)
    day = base + rng.normal(0, 10, 96)
    pf = b.optimise_day(day, 2, 0.0, b.PARAMS)[0]
    nv = b.naive_day(day, base, 2, b.PARAMS)[0]
    worse += nv <= pf + 1e-6
check('naive <= perfect on 20 random days', worse == 20, worse)

# Day-ahead + FCR in one schedule
flat = np.full(96, 50.0)
co = b.cooptimise_day(flat, [100.0] * 6, 2, b.PARAMS['wear'])
check('flat prices: the whole MW goes to FCR (6 x 100)', co and abs(co[1] - 600) < 1e-6 and abs(co[3] - 1) < 1e-6, co)
co0 = b.cooptimise_day(p, [0.0] * 6, 2, 0.0, prm)
check('FCR at 0: same as the day-ahead alone', co0 and abs(co0[0] - rev) < 1e-6 and co0[3] < 1e-9, (co0, rev))
ge = 0
for _ in range(10):
    day = base + rng.normal(0, 25, 96)
    blocks = list(rng.uniform(0, 120, 6))
    c = b.cooptimise_day(day, blocks, 2, b.PARAMS['wear'])
    da = b.optimise_day(day, 2, b.PARAMS['wear'])
    ge += c is not None and c[0] + c[1] - b.PARAMS['wear'] * c[2] >= max(da[0] - b.PARAMS['wear'] * da[1], sum(blocks)) - 1e-6
check('co-optimised >= the better of day-ahead alone and FCR alone', ge == 10, ge)

co_a = b.cooptimise_day(flat, None, 2, b.PARAMS['wear'], afrr={'up': [10.0] * 6, 'down': [5.0] * 6})
check('aFRR on flat prices: 1 MW up and 1 MW down all day (24 x 10 + 24 x 5)', co_a and abs(co_a[4] - 360) < 1e-6, co_a)
co_1h = b.cooptimise_day(flat, None, 1, b.PARAMS['wear'], afrr={'up': [10.0] * 6, 'down': [0.0] * 6})
# a 1 h battery starts half full: it holds at least the 0.5 MW its energy covers, and buys energy to hold more when that pays
check('a 1 h battery: upward aFRR limited by stored energy, charging to hold more when it pays', co_1h and 0.5 - 1e-6 <= co_1h[5] <= 1 + 1e-9 and co_1h[4] + co_1h[0] >= 120 - 1e-6, co_1h)

# without perfect foresight: a perfect forecast gives back the perfect value; a wrong one never beats it
day = np.array([40.0] * 28 + [5.0] * 20 + [90.0] * 20 + [60.0] * 28)
perf = b.optimise_day(day, 2, b.PARAMS['wear'])
rl_same = b.realistic_da(day, day, 2, b.PARAMS['wear'])
check('realistic with the real prices as forecast = perfect', rl_same is not None and abs(rl_same - (perf[0] - b.PARAMS['wear'] * perf[1])) < 1e-6, (rl_same, perf))
rl_bad = b.realistic_da(day, np.roll(day, 16), 2, b.PARAMS['wear'])
check('realistic with a wrong forecast earns less than perfect', rl_bad is not None and rl_bad < perf[0] - b.PARAMS['wear'] * perf[1] - 1, (rl_bad, perf))
blocks = [500.0] * 6
co = b.cooptimise_day(day, blocks, 2, b.PARAMS['wear'])
rc = b.realistic_co(day, day, blocks, blocks, 2, b.PARAMS['wear'])
check('co-optimised realistic with exact forecasts = perfect', rc is not None and abs(rc[0] - (co[0] + co[1] + co[4] - b.PARAMS['wear'] * co[2])) < 1e-6, (rc, co))
rc0 = b.realistic_co(day, day, blocks, None, 2, b.PARAMS['wear'])
check('no FCR forecast: no FCR held, no FCR earned', rc0 is not None and abs(rc0[2]) < 1e-9, rc0)

print('FAILED' if fails else 'all bess optimiser checks pass')
sys.exit(1 if fails else 0)
