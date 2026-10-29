#!/usr/bin/env python3
"""Section 2.3's pure historical bootstrap, to compare against the model-based Monte Carlo: real
past weeks (production AND price exactly as they happened together, not price redrawn from a
model), rescaled to the target year's capacity, block-bootstrapped — no price model, no weather
model, so the true joint pattern of a weather week and its prices survives untouched.

For each simulated week of the target year Y: pick a random past training year, take its calendar
week at the same day of year (wrapping at year end), keep that week's price exactly as a ratio to
its own year-month average (shape only, so yearly price-level drift doesn't leak in), and rescale
its solar or wind output by the ratio of Y's guessed capacity to that past year's capacity. Same
walk-forward protocol as ppa_backtest.py (history before Y only, 2022 left out of the draw pool,
capacity of Y extrapolated from the last two past years).

Result: unsuitable on its own. Solar's error grows with every target year (0.5 €/MWh in 2019, 9-12
€/MWh by 2023-2025, 21 €/MWh in 2026) because the sampled past weeks carry the price pattern of
whatever penetration France had THEN — a week drawn from 2016 (10 GW solar) still prices midday as
2016 did, even rescaled to price a 2026 fleet (28 GW), so the capture value is systematically
overstated as the fleet grows. Wind, whose fleet grew far less (17→25 GW over the same years), shows
the same growing-then-noisy pattern at a much smaller scale. A pure historical bootstrap needs a
capacity-aware price adjustment (the cannibalisation term the model-based methods already carry)
before it is usable, not just rescaled production on unrescaled prices.

Writes data/history/ppa_historical_bootstrap.json
    python scripts/ppa_historical_bootstrap.py [--sims 300]
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L   # noqa: E402  (DATA, calendar, doy, by_doy, cap_guess)
import ppa_backtest as B  # noqa: E402  (today's weather Monte Carlo, for the side-by-side)
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_historical_bootstrap.json')
VERDICT = [2024, 2025, 2026]
RNG = np.random.default_rng(11)


def month_avg(a):
    return {m: float(a['fr_p'][a['month'] == m].mean()) for m in range(1, 13) if (a['month'] == m).any()}


def bootstrap(t, Y, train_w, sims):
    """month: {'all': capture rate, production-weighted over the sims}"""
    days = L.calendar(Y)
    month = np.array([int(d[5:7]) for d in days])
    weeks = [i // 7 for i in range(len(days))]
    last = train_w[-1]
    cap_y = L.cap_guess('FR', t, Y, last)
    allm = []
    for _ in range(sims):
        pick = {wk: train_w[RNG.integers(0, len(train_w))] for wk in set(weeks)}
        ratio, prod = np.zeros(len(days) * 24), np.zeros(len(days) * 24)
        for i, d in enumerate(days):
            wy = pick[weeks[i]]
            a = L.DATA[wy]
            di = L.by_doy(a)
            k = di.get(L.doy(d))
            if k is None:
                k = min(di.values(), key=lambda q: abs(int(a['doy'][q]) - L.doy(d)))
            mavg = month_avg(a)[int(a['month'][k])]
            ratio[i * 24:(i + 1) * 24] = a['fr_p'][k] / mavg if mavg else 1.0
            cap_wy = L.cap('FR', t, wy)
            prod[i * 24:(i + 1) * 24] = a['fr_' + t][k] / (cap_wy * 1000) * cap_y * 1000
        r = ratio
        allm.append(L.month_rates(np.repeat(month, 24), prod, r, r * (r > 0), (r > 0).astype(float)))
    return {m: {k: float(np.mean([a[m][k] for a in allm if m in a and a[m].get(k) is not None])) for k in ('all', 'curt', 'paid', 'negH')} for m in range(1, 13)}


def score_year(t, Y, train_w, sims):
    V = B.S if t == 's' else B.W
    act = L.actual(t, Y)
    m = bootstrap(t, Y, train_w, sims)
    out = {}
    for conv in ('all', 'curt'):
        pred = {mm: m[mm][conv] for mm in m}
        out[conv] = L.score(pred, act, conv)
    mw, lo, hi = B.m_weather(t, Y, [y for y in B.YEARS if y < Y and y != 2022], V, 40)
    return out, act, m, (mw, lo, hi)


def main():
    sims = int(sys.argv[sys.argv.index('--sims') + 1]) if '--sims' in sys.argv else 300
    out = {'protocol': 'same as ppa_backtest.py; historical bootstrap vs today\'s weather Monte Carlo', 'rows': []}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        for Y in L.CAL + VERDICT:
            if Y not in L.DATA:
                continue
            train = [y for y in L.DATA if y < Y and L.DATA[y]['complete']]
            if len(train) < 3:
                continue
            sc, act, m, (mw, lo, hi) = score_year(t, Y, train, sims)
            row = {'tech': tech, 'year': Y, 'score': sc, 'weatherMean': mw, 'weatherP10': lo, 'weatherP90': hi}
            out['rows'].append(row)
            print(tech, Y, 'bootstrap curt err %.2f €/MWh | weatherMC %.3f vs actual-year capture' %
                  (sc['curt']['eur'] if sc['curt'] else float('nan'), mw), flush=True)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
