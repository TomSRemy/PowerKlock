#!/usr/bin/env python3
"""National solar and wind production model for the PPA pricer (Monte Carlo
method), calibrated on RTE éCO2mix 2016 → last complete year.

Model, per technology, at the daily step then the hourly step:
  daily capacity factor  each month's empirical distribution (pooled years),
                         reached through normal scores (quantile mapping)
  persistence            AR(1) on the normal scores, one φ per technology
  solar ↔ wind           correlation of the AR innovations
  hourly shape           an analog day: a real day of the same month whose
                         daily capacity factor is close, its hourly shape
                         scaled to the simulated day
Capacity: Energy-Charts year-end GW, interpolated through each year.

    python scripts/prod_model.py            # writes data/history/fr_prod_model.json
    python scripts/prod_model.py --check N  # also simulates N years and prints the checks
"""
import json
import math
import os
import random
import statistics as st
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'fr_prod_model.json')


def load(p):
    with open(os.path.join(ROOT, p)) as f:
        return json.load(f)


def norm_ppf(p):
    # Acklam's approximation of the inverse normal
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549671627638132e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
    p = min(max(p, 1e-9), 1 - 1e-9)
    if p < 0.02425:
        q = math.sqrt(-2 * math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > 1 - 0.02425:
        q = math.sqrt(-2 * math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5; r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def capacity():
    c = load('data/history/capacity.json')['countries']['FR']
    t = c['types']
    sol = {y: t['Solar AC'][i] for i, y in enumerate(c['years']) if t['Solar AC'][i]}
    win = {y: (t['Wind onshore'][i] or 0) + (t['Wind offshore'][i] or 0) for i, y in enumerate(c['years'])}
    def at(cap, d):   # GW on a day: year-end values interpolated through the year
        y = d.year; a, b = cap.get(y - 1, cap.get(y)), cap.get(y, cap.get(y - 1))
        if a is None or b is None:
            return None
        f = (d.timetuple().tm_yday - 0.5) / (366 if y % 4 == 0 else 365)
        return a + (b - a) * f
    return lambda d: at(sol, d), lambda d: at(win, d)


def calibrate(years):
    capS, capW = capacity()
    days = []   # (date, month, cfS, cfW, shapeS[24], shapeW[24])
    for y in years:
        H = load(f'data/history/fr_hourly/{y}.json')['days']
        for iso, v in sorted(H.items()):
            d = date.fromisoformat(iso)
            s, w = v.get('s'), v.get('w')
            if not s or not w or any(x is None for x in s + w):
                continue
            gs, gw = capS(d), capW(d)
            if not gs or not gw:
                continue
            ds, dw = st.mean(s) / (gs * 1000), st.mean(w) / (gw * 1000)
            if ds <= 0 or dw <= 0:
                continue
            days.append((iso, d.month, ds, dw, [x / (ds * gs * 1000) for x in s], [x / (dw * gw * 1000) for x in w]))
    model = {'years': years, 'months': {}, 'n': len(days)}
    # empirical distributions per month, normal scores
    score = {}
    for m in range(1, 13):
        md = [x for x in days if x[1] == m]
        for k, idx in (('s', 2), ('w', 3)):
            vals = sorted(x[idx] for x in md)
            model['months'].setdefault(str(m), {})[k] = [round(v, 5) for v in vals[::max(1, len(vals) // 200)]]   # ≤ 200 quantiles
            rank = {id(x): r for r, x in enumerate(sorted(md, key=lambda x: x[idx]))}
            for x in md:
                score[(x[0], k)] = norm_ppf((rank[id(x)] + 0.5) / len(md))
    # AR(1) on consecutive days, and the innovations' correlation
    phi, eps = {}, {'s': [], 'w': []}
    seq = sorted(days)
    for k in ('s', 'w'):
        num = den = 0
        for a, b in zip(seq, seq[1:]):
            if (date.fromisoformat(b[0]) - date.fromisoformat(a[0])).days != 1:
                continue
            za, zb = score[(a[0], k)], score[(b[0], k)]
            num += za * zb; den += za * za
        phi[k] = num / den
    for a, b in zip(seq, seq[1:]):
        if (date.fromisoformat(b[0]) - date.fromisoformat(a[0])).days != 1:
            continue
        for k in ('s', 'w'):
            eps[k].append(score[(b[0], k)] - phi[k] * score[(a[0], k)])
    rho = st.correlation(eps['s'], eps['w'])
    model.update({'phi': {k: round(v, 4) for k, v in phi.items()}, 'rho': round(rho, 4)})
    return model, days


def quantile(vals, p):
    r = p * (len(vals) - 1); lo = int(r); hi = min(lo + 1, len(vals) - 1)
    return vals[lo] + (vals[hi] - vals[lo]) * (r - lo)


def simulate(model, days, n_years, seed=7, year=2025):
    R = random.Random(seed)
    by_month = {m: [x for x in days if x[1] == m] for m in range(1, 13)}
    for m in by_month:
        by_month[m].sort(key=lambda x: x[2])
    out = []
    zs = zw = 0.0
    ps, pw, rho = model['phi']['s'], model['phi']['w'], model['rho']
    for _ in range(n_years):
        yr = []
        d = date(year, 1, 1)
        while d.year == year:
            e1, e2 = R.gauss(0, 1), R.gauss(0, 1)
            zs = ps * zs + math.sqrt(1 - ps * ps) * e1
            zw = pw * zw + math.sqrt(1 - pw * pw) * (rho * e1 + math.sqrt(1 - rho * rho) * e2)
            q = model['months'][str(d.month)]
            cs, cw = quantile(q['s'], norm_cdf(zs)), quantile(q['w'], norm_cdf(zw))
            # analog days: among the 10 closest real days of the month, one at random
            cand = by_month[d.month]
            an_s = sorted(cand, key=lambda x: abs(x[2] - cs))[:10]
            an_w = sorted(cand, key=lambda x: abs(x[3] - cw))[:10]
            hs, hw = R.choice(an_s)[4], R.choice(an_w)[5]
            yr.append((d.month, cs, cw, [cs * x for x in hs], [cw * x for x in hw]))
            d = date.fromordinal(d.toordinal() + 1)
        out.append(yr)
    return out


def main():
    last = date.today().year - 1
    years = list(range(2016, last + 1))
    model, days = calibrate(years)
    with open(OUT, 'w') as f:
        json.dump(model, f, separators=(',', ':'))
    print(f'calibrated on {len(days)} days: phi {model["phi"]}, rho {model["rho"]}')
    if '--check' in sys.argv:
        n = int(sys.argv[sys.argv.index('--check') + 1])
        sims = simulate(model, days, n)
        json.dump({'sims': [[(m, round(cs, 4), round(cw, 4)) for m, cs, cw, _, _ in y] for y in sims[:n]],
                   'hourly': {str(m): {'s': [round(st.mean(x[3][h] for x in sims[0] + sims[1] + sims[2] if x[0] == m), 4) for h in range(24)],
                                       'w': [round(st.mean(x[4][h] for x in sims[0] + sims[1] + sims[2] if x[0] == m), 4) for h in range(24)]} for m in (1, 6)},
                   'real': [(x[0], x[1], round(x[2], 4), round(x[3], 4)) for x in days],
                   'realHourly': {str(m): {'s': [round(st.mean(x[2] * x[4][h] for x in days if x[1] == m), 4) for h in range(24)],
                                           'w': [round(st.mean(x[3] * x[5][h] for x in days if x[1] == m), 4) for h in range(24)]} for m in (1, 6)}},
                  open(os.path.join(os.environ.get('CHECK_DIR', ROOT), 'prod_check.json'), 'w'))
        print('wrote prod_check.json')


if __name__ == '__main__':
    main()
