#!/usr/bin/env python3
"""Both fixes Tom asked to test for the regional price model's clipping bug (found in
ppa_sensitivity_isolated.py: ppa_lab.PriceModel's trained bins stop at a residual-load share of
-0.1, but the central capacity path already needs -0.28 by 2027 and -0.61 by 2030).

  A  baseline        today's setting: region=True (France+DE+BE+ES residual load summed), flat
                     nearest-bin fallback beyond the trained edge
  B  widen           region=False (France alone): summing countries dilutes France's own extremes
                     (France alone already reaches -0.43 in 2025; blended with neighbours it only
                     reaches -0.07), so training on France alone is a free, already-built way to
                     widen the covered range — no new data needed
  C  extrapolate     keep region=True (today's setting) but replace the flat fallback beyond the
                     trained edge with a straight line fitted on the lowest few really-observed
                     bins of each (season × time-of-day) group, extended outward

Also tests a fourth option once A/B/C's results were in — D: hybrid, today's model (region=True)
where its x is inside the trained range, falling back to the region=False model (not a linear
extrapolation) only for the x's that land outside it.

Result: none of A, B, C is a clean fix.
  - B (widen) costs real accuracy on years where the answer is known — its errors run +4 to +7
    €/MWh most years (almost always too high), against baseline's -1 to -10 (almost always too low):
    opposite bias, not just more noise, so it's not simply "the same, wider."
  - C (extrapolate) is unstable: a straight line fitted on the lowest few real bins overshoots once
    projected far — solar's capture ratio hits 2.79 by 2030 (physically impossible, >1), wind's hits
    9.18. The bins nearest the edge are also the noisiest (fewest observations), so the fitted slope
    is itself unreliable before it's even extended.
  - D (hybrid) is the most promising of the four: it fixes the worst blow-up years (solar 2026:
    baseline -10.08 €/MWh error, hybrid +0.98; wind 2026: baseline +12.22, hybrid +1.75) while
    tracking baseline closely in years where baseline was already fine (2019-2021, within 0.1-0.5
    €/MWh of each other). But its forecast isn't smooth: solar's 2027 figure jumps up from 2026
    (0.785 → 0.875) before resuming its decline — the hard switch between the two models at the
    trained edge creates a visible seam, not the gradual decline a real cannibalisation effect
    should show. Needs a smoothed blend across the switchover, not a hard cutover, before it's
    usable.

Two checks: (1) same walk-forward protocol as ppa_backtest.py on 2019-2026, where the answer is
known, to see if any fix costs accuracy where today's method already works; (2) the central
capacity path's June forecast for 2027-2030, where a real fix should decline smoothly instead of
flattening (baseline) or blowing up (extrapolate).

Writes data/history/ppa_regional_clip_fix.json
    python scripts/ppa_regional_clip_fix.py
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L   # noqa: E402
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_regional_clip_fix.json')
VERDICT = [2024, 2025, 2026]


def extrapolate_tail(pm, n_edge=4):
    """for each (season × time-of-day) group, a (slope, x0, mean0) fitted on the lowest n_edge
    really-observed bins, to extend the model linearly below its trained floor"""
    tails = {}
    G = pm.mean.shape[0]
    for gi in range(G):
        bis = sorted({bi for (g2, bi) in pm.lists if g2 == gi})
        if len(bis) < 2:
            tails[gi] = None
            continue
        lo_bis = bis[:n_edge]
        xs = np.array([(bi + pm.lo) * L.BIN for bi in lo_bis])
        ys = np.array([pm.mean[gi, bi] for bi in lo_bis])
        b = np.polyfit(xs, ys, 1) if len(lo_bis) >= 2 else (0, ys.mean())
        tails[gi] = (float(b[0]), float(xs.min()), float(np.polyval(b, xs.min())))
    return tails


def expected_hybrid(pm_true, pm_false, x_true, x_false, g):
    """pm_true (region=True, today's setting) where x is inside its trained range; pm_false
    (France alone, wider native coverage) only for the x's that fall outside it — both are bounded,
    backfilled models, so no linear blow-up, unlike expected_extrapolated"""
    rm, rp, pp = pm_true.expected(x_true, g)
    floor = pm_true.lo * L.BIN
    ceiling = (pm_true.lo + pm_true.nb) * L.BIN
    outside = (x_true < floor) | (x_true > ceiling)
    if outside.any():
        rm2, rp2, pp2 = pm_false.expected(x_false, g)
        rm[outside], rp[outside], pp[outside] = rm2[outside], rp2[outside], pp2[outside]
    return rm, rp, pp


def expected_extrapolated(pm, tails, x, g):
    """pm.expected(), but x below the trained floor (per group) follows the fitted tail slope
    instead of pm's own flat nearest-bin fallback"""
    rm, rp, pp = pm.expected(x, g)
    floor = pm.lo * L.BIN
    below = x < floor
    if below.any():
        for gi in np.unique(g[below]):
            t = tails.get(int(gi))
            if t is None:
                continue
            slope, x0, y0 = t
            k = below & (g == gi)
            rm[k] = y0 + slope * (x[k] - x0)
    return rm, rp, pp


def backtest(t, Y, train, variant, tails_cache):
    past = train
    pm = L.PriceModel(past[-5:], variant != 'widen', 'mean', False)
    pm_false = L.PriceModel(past[-5:], False, 'mean', False) if variant == 'hybrid' else None
    if variant == 'extrapolate':
        tails_cache[Y] = extrapolate_tail(pm)
    capY = {c: {tt: L.cap_guess(c, tt, Y, max(past)) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
    days = L.calendar(Y)
    month = np.array([int(d[5:7]) for d in days])
    g = L.grp(month)
    res = []
    for wy in past:
        src = L.weather_index(Y, wy, days)
        h = L.assemble(Y, days, src, max(past), capY)
        x = L.residual_share(None, variant != 'widen', h['s'], h['w'], h['l'], h['n'], h['pump'])
        if variant == 'extrapolate':
            rm, rp, pp = expected_extrapolated(pm, tails_cache[Y], x, g)
        elif variant == 'hybrid':
            x_false = L.residual_share(None, False, h['s'], h['w'], h['l'], h['n'], h['pump'])
            rm, rp, pp = expected_hybrid(pm, pm_false, x, x_false, g)
        else:
            rm, rp, pp = pm.expected(x, g)
        res.append(L.month_rates(month, h[t]['FR'], rm, rp, pp))
    m4 = {m: {k: float(np.mean([r[m][k] for r in res if m in r and r[m].get(k) is not None])) for k in ('all', 'curt', 'paid', 'negH')} for m in range(1, 13)}
    return m4


def score_year(t, Y, train, variant, tails_cache):
    m4 = backtest(t, Y, train, variant, tails_cache)
    act = L.actual(t, Y)
    out = {}
    for conv in ('all', 'curt'):
        pred = {m: m4[m][conv] for m in m4}
        out[conv] = L.score(pred, act, conv)
    return out


def main():
    out = {'protocol': 'ppa_backtest.py walk-forward; same accuracy check, three model variants', 'rows': [], 'future': {}}
    tails_cache = {}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        for Y in L.CAL + VERDICT:
            if Y not in L.DATA:
                continue
            past = [y for y in L.DATA if y < Y and L.DATA[y]['complete'] and y != 2022]
            if len(past) < 3:
                continue
            row = {'tech': tech, 'year': Y}
            for variant in ('baseline', 'widen', 'extrapolate', 'hybrid'):
                row[variant] = score_year(t, Y, past, variant, tails_cache)
            out['rows'].append(row)
            print(tech, Y, ' | '.join(f"{v} {row[v]['curt']['eur']:+.2f}" if row[v]['curt'] else f'{v} -' for v in ('baseline', 'widen', 'extrapolate', 'hybrid')), flush=True)
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for scope, pred in (('all', lambda r: True), ('verdict', lambda r: r['year'] in VERDICT)):
            rs = [r for r in out['rows'] if r['tech'] == tech and pred(r)]
            out['mae'][f'{tech}_{scope}'] = {
                v: round(float(np.mean([abs(r[v]['curt']['eur']) for r in rs if r[v]['curt']])), 3) for v in ('baseline', 'widen', 'extrapolate', 'hybrid')}
    # the future check: central path, June, 2027-2030 — does the forecast flatten or decline smoothly?
    past_full = [y for y in L.DATA if L.DATA[y]['complete'] and y != 2022]
    last = max(past_full)
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        out['future'][tech] = {}
        for variant in ('baseline', 'widen', 'extrapolate', 'hybrid'):
            pm = L.PriceModel(past_full[-5:], variant != 'widen', 'mean', False)
            pm_false = L.PriceModel(past_full[-5:], False, 'mean', False) if variant == 'hybrid' else None
            vals = {}
            for Y in (2026, 2027, 2028, 2029, 2030):
                capY = {c: {tt: L.cap_future(c, tt, Y) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                days = [d for d in L.calendar(Y) if d[5:7] == '06']
                month = np.array([6] * len(days))
                g = L.grp(month)
                src = L.weather_index(Y, last, days)
                h = L.assemble(Y, days, src, last, capY)
                x = L.residual_share(None, variant != 'widen', h['s'], h['w'], h['l'], h['n'], h['pump'])
                if variant == 'extrapolate':
                    tails = extrapolate_tail(pm)
                    rm, rp, pp = expected_extrapolated(pm, tails, x, g)
                elif variant == 'hybrid':
                    x_false = L.residual_share(None, False, h['s'], h['w'], h['l'], h['n'], h['pump'])
                    rm, rp, pp = expected_hybrid(pm, pm_false, x, x_false, g)
                else:
                    rm, rp, pp = pm.expected(x, g)
                mr = L.month_rates(month, h[t]['FR'], rm, rp, pp)
                vals[Y] = mr[6]['curt']
            out['future'][tech][variant] = vals
            print(tech, variant, {y: round(v, 3) if v else None for y, v in vals.items()}, flush=True)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
