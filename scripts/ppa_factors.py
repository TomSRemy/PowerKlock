#!/usr/bin/env python3
"""Why the capture-rate forecasts miss: the monthly error of the test bench's methods
set against what changed in the market between the year the forecast was built on
and the delivery month.

For each delivery month (2019-2026, 2022 left out), the error of a method (predicted −
realised capture rate, points) and the change of each factor against the same month of
the year before — the year the forecast took its demand and nuclear from:
  nuclear      France nuclear output, GW                 (RTE éCO2mix)
  hydro        France hydro output, GW                   (RTE éCO2mix)
  load         France consumption, GW                    (RTE éCO2mix)
  exports      France net exports, GW                    (RTE éCO2mix)
  pumping      pumped storage + batteries charging, GW, a proxy for flexibility (RTE)
  regionSolar  solar output of France + Germany + Belgium + Spain, GW at midday (Energy-Charts)
  level        the month's baseload, €/MWh
Then one correlation per factor and a regression of the error on all factors at once,
judged by leaving one year out (so a factor that only fits one year does not count).

Writes data/history/ppa_factors.json
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
FACTORS = ('nuclear', 'hydro', 'load', 'exports', 'pumping', 'regionSolar', 'level')


def rte_month(y, m):
    try:
        d = json.load(open(os.path.join(H, 'rte', f'{y}-{m:02d}.json')))['days']
    except OSError:
        return None
    acc = {k: [] for k in ('nuclear', 'hydro', 'load', 'exchanges', 'pumping')}
    for v in d.values():
        for k in acc:
            x = [a for a in (v.get(k) or []) if a is not None]
            if x:
                acc[k].append(sum(x) / len(x))
    if not acc['load']:
        return None
    out = {k: sum(v) / len(v) / 1000 for k, v in acc.items() if v}
    out['exports'] = -out.pop('exchanges', 0)       # éCO2mix: exchanges > 0 = imports
    out['pumping'] = abs(out.get('pumping', 0))
    return out


def region_midday_solar(y, m):
    try:
        rg = json.load(open(os.path.join(H, 'region_hourly', f'{y}.json')))['countries']
        fr = json.load(open(os.path.join(H, 'fr_hourly', f'{y}.json')))['days']
    except OSError:
        return None
    tot, n = 0.0, 0
    for d, v in fr.items():
        if int(d[5:7]) != m or not v.get('s'):
            continue
        s = sum(v['s'][11:15]) / 4
        for c in rg:
            row = rg[c]['s'].get(d)
            if row:
                s += sum(x or 0 for x in row[11:15]) / 4
        tot += s; n += 1
    return tot / n / 1000 if n else None


def base(y, m):
    try:
        fr = json.load(open(os.path.join(H, 'fr_hourly', f'{y}.json')))['days']
    except OSError:
        return None
    p = [x for d, v in fr.items() if int(d[5:7]) == m for x in (v.get('p') or []) if x is not None]
    return sum(p) / len(p) if p else None


def factor_row(y, m):
    a, b = rte_month(y, m), rte_month(y - 1, m)
    if not a or not b:
        return None
    r = {k: a[k] - b[k] for k in ('nuclear', 'hydro', 'load', 'exports', 'pumping') if k in a and k in b}
    sa, sb = region_midday_solar(y, m), region_midday_solar(y - 1, m)
    ba, bb = base(y, m), base(y - 1, m)
    if None in (sa, sb, ba, bb):
        return None
    r['regionSolar'] = sa - sb
    r['level'] = ba - bb
    return r


def main():
    lab = json.load(open(os.path.join(H, 'ppa_lab.json')))
    out = {'factors': FACTORS, 'note': 'error = predicted − realised capture rate (points); factor = this month − same month a year before', 'results': {}}
    cache = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            for meth in ('ensemble', 'regional', 'step', 'fpc'):
                X, yv, yrs = [], [], []
                for r in lab['rows']:
                    if r['tech'] != tech:
                        continue
                    P = r['pred'][conv].get(meth) or {}
                    for m, a in r['actual'].items():
                        p = P.get(str(m), P.get(m)) if isinstance(P, dict) else None
                        if p is None or a[conv] is None:
                            continue
                        key = (r['year'], int(m))
                        if key not in cache:
                            cache[key] = factor_row(*key)
                        f = cache[key]
                        if not f:
                            continue
                        X.append([f[k] for k in FACTORS]); yv.append((p - a[conv]) * 100); yrs.append(r['year'])
                X, yv, yrs = np.array(X), np.array(yv), np.array(yrs)
                corr = {k: float(np.corrcoef(X[:, i], yv)[0, 1]) for i, k in enumerate(FACTORS)}
                # standardised regression, judged by leaving one year out
                Z = (X - X.mean(0)) / X.std(0)
                pred = np.zeros_like(yv)
                for y in np.unique(yrs):
                    tr, te = yrs != y, yrs == y
                    A = np.c_[np.ones(tr.sum()), Z[tr]]
                    beta, *_ = np.linalg.lstsq(A, yv[tr], rcond=None)
                    pred[te] = np.c_[np.ones(te.sum()), Z[te]] @ beta
                r2_cv = float(1 - ((yv - pred) ** 2).sum() / ((yv - yv.mean()) ** 2).sum())
                A = np.c_[np.ones(len(yv)), Z]
                beta, *_ = np.linalg.lstsq(A, yv, rcond=None)
                # what each factor alone explains out of sample
                alone = {}
                for i, k in enumerate(FACTORS):
                    pr = np.zeros_like(yv)
                    for y in np.unique(yrs):
                        tr, te = yrs != y, yrs == y
                        b = np.polyfit(Z[tr, i], yv[tr], 1)
                        pr[te] = np.polyval(b, Z[te, i])
                    alone[k] = float(1 - ((yv - pr) ** 2).sum() / ((yv - yv.mean()) ** 2).sum())
                out['results'].setdefault(tech, {}).setdefault(conv, {})[meth] = {
                    'n': int(len(yv)), 'corr': corr, 'r2LeaveYearOut': r2_cv, 'aloneLeaveYearOut': alone,
                    'beta': {k: float(beta[i + 1]) for i, k in enumerate(FACTORS)}, 'meanError': float(yv.mean())}
                if meth == 'ensemble':
                    print(tech, conv, meth, 'n', len(yv), 'R² (leave-one-year-out) %.2f' % r2_cv,
                          ' '.join('%s r=%+.2f/%+.2f' % (k, corr[k], alone[k]) for k in FACTORS), flush=True)
    with open(os.path.join(H, 'ppa_factors.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
