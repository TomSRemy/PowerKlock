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

print('FAILED' if fails else 'all bess optimiser checks pass')
sys.exit(1 if fails else 0)
