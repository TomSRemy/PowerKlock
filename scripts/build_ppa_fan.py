#!/usr/bin/env python3
"""Capture-rate fan for the PPA pricer: realised history and the projection of the
blend of 4 methods with its percentiles, year by year.

Percentiles are exceedance probabilities, as for production: P90 = 90 % chance that the
realised value is ABOVE it (the cautious one), P50 = the central estimate.

Spread of a delivery year h years ahead:
    σ(h) = √(σ_weather² + h · σ_model²)
  σ_weather  weather spread of the European model simulated (monthly P10–P90 of
             data/history/ppa_forecast.json, months taken as independent)
  σ_model    error of the blend replayed on the past (yearly, 2022 left out), growing
             like a random walk with the horizon (assumption)

Inputs  data/history/ppa_lab.json, ppa_forecast.json, fr_forward_monthly.json
Writes  data/history/ppa_fan.json
"""
import json
import math
import os
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
Z = {10: 1.2816, 25: 0.6745, 50: 0.0, 75: -0.6745, 90: -1.2816}   # exceedance: P90 below the centre
PS = (50, 60, 70, 75, 80, 90)


def t_cdf(x, nu):
    """Student t cumulative distribution (Simpson integration of the density)"""
    c = math.gamma((nu + 1) / 2) / (math.sqrt(nu * math.pi) * math.gamma(nu / 2))
    f = lambda u: c * (1 + u * u / nu) ** (-(nu + 1) / 2)
    a, n = 0.0, 400
    h = abs(x) / n
    if h == 0:
        return 0.5
    s = f(0) + f(abs(x)) + sum((4 if i % 2 else 2) * f(i * h) for i in range(1, n))
    area = s * h / 3
    return 0.5 + area if x > 0 else 0.5 - area


def tq(p, nu):
    """Student t quantile of the exceedance percentile p (P90 → negative): wider than the normal
    when the model error rests on few replay years"""
    q = 1 - p / 100
    lo, hi = -20.0, 20.0
    for _ in range(70):
        mid = (lo + hi) / 2
        if t_cdf(mid, nu) < q:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def z(p):
    """standard normal quantile of the exceedance percentile p (P90 → −1.2816)"""
    q = 1 - p / 100
    # Acklam's approximation is overkill here: bisection on erf
    lo, hi = -6.0, 6.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if 0.5 * (1 + math.erf(mid / math.sqrt(2))) < q:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def main():
    lab = json.load(open(os.path.join(H, 'ppa_lab.json')))
    fc = json.load(open(os.path.join(H, 'ppa_forecast.json')))
    fw = json.load(open(os.path.join(H, 'fr_forward_monthly.json')))
    this = date.today().year
    out = {'asOf': fc.get('asOf'), 'forwardAsOf': fw.get('asOf'), 'percentiles': list(PS),
           'note': 'exceedance: P90 = 90 % chance the realised capture is above it',
           'method': 'blend of 4 methods (Capacity trend, Forward shape, European price model, Weather simulation); '
                     'spread = weather (European model simulated) and model error (replay of the blend), growing with the horizon; '
                     'percentiles from a Student t with (replay years − 1) degrees of freedom',
           'tech': {}}
    for tech in ('solar', 'wind'):
        out['tech'][tech] = {}
        share = {int(k): v for k, v in fc['share'][tech].items()}
        for conv in ('curt', 'all'):
            # realised: production-weighted yearly capture rate and value per MWh produced
            hist = []
            for r in lab['rows']:
                if r['tech'] != tech:
                    continue
                A = r['actual']
                w = sum(m['mwh'] for m in A.values() if m.get('mwh'))
                if not w:
                    continue
                pay = (lambda m: m.get('paid', 1)) if conv == 'curt' else (lambda m: 1)
                rate = sum(m['mwh'] * m[conv] for m in A.values() if m.get('mwh')) / w
                val = sum(m['mwh'] * m[conv] * m['base'] * pay(m) for m in A.values() if m.get('mwh')) / w
                hist.append({'year': r['year'], 'rate': round(rate, 4), 'value': round(val, 2),
                             'complete': len(A) == 12})
            hist.sort(key=lambda x: x['year'])
            # model error of the blend, yearly, in capture points
            pts = fc['scores'][tech][conv]['pts']
            errs = [v['hybrid'] / 100 for y, v in pts.items() if int(y) != 2022 and v.get('hybrid') is not None]
            s_model = math.sqrt(sum(e * e for e in errs) / len(errs)) if errs else 0.05
            bias = sum(errs) / len(errs) if errs else 0
            F = fc['forecast'][tech][conv]
            years = sorted({int(k[:4]) for k in F if int(k[:4]) > this})
            proj = []
            for y in years:
                ms = [k for k in F if int(k[:4]) == y]
                if len(ms) < 12:
                    continue
                wt = {k: share[int(k[5:])] * (F[k].get('paid', 1) if conv == 'curt' else 1) for k in ms}
                W = sum(wt.values())
                c = sum(wt[k] * F[k]['hybrid'] for k in ms) / W
                sw = math.sqrt(sum((wt[k] / W * ((F[k]['p90'] - F[k]['p10']) / 2.5631)) ** 2 for k in ms if F[k].get('p90') is not None))
                h = y - this
                s = math.sqrt(sw ** 2 + h * s_model ** 2)
                fm = {k: (fw['months'].get(k) or {}).get('value') for k in ms}
                fwd = sum(wt[k] * fm[k] for k in ms) / W if all(fm.values()) else None
                q = {}
                nu = max(2, len(errs) - 1)
                for p in sorted(set(PS) | set(Z)):
                    zz = tq(p, nu)
                    r_ = c + zz * s
                    v = sum(wt[k] * fm[k] * (F[k]['hybrid'] + zz * s) for k in ms) / W if fwd else None
                    q[str(p)] = {'rate': round(r_, 4), 'value': None if v is None else round(v, 2)}
                proj.append({'year': y, 'h': h, 'central': round(c, 4), 'sigma': round(s, 4), 'sWeather': round(sw, 4),
                             'forward': None if fwd is None else round(fwd, 2), 'q': q})
            out['tech'][tech][conv] = {'history': hist, 'projection': proj, 'dof': max(2, len(errs) - 1),
                                       'sModel': round(s_model, 4), 'biasModel': round(bias, 4), 'nReplay': len(errs)}
    with open(os.path.join(H, 'ppa_fan.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    for t, d in out['tech'].items():
        for cv, x in d.items():
            print(t, cv, 'σ model', x['sModel'], 'years', [(p['year'], p['central'], p['sigma'], p['q']['75']['value']) for p in x['projection']])


if __name__ == '__main__':
    main()
