#!/usr/bin/env python3
"""Walk-forward backtest of the PowerKlock index (js/morning.js, _mrnIndex and _mrnAhead).

The index: coverage = (nuclear + hydro + wind + solar + bioenergy) / consumption; implied price = gas plant cost
(TTF / 0.55 + 0.37 x EUA) x 1 / (1 + exp(-(a - b (coverage - 100)))) x (1 - w on weekends), the curve fitted on the
three years before the day it is used.

Every Monday from 2024-01-01, using only what was known that day:
  - the curve fitted on the three years before,
  - gas and CO2 at that day's price, nuclear at that day's output held flat,
  - hydro and bioenergy at their normal for the calendar day (three years before),
  - consumption, wind and solar in two versions that bracket the live index (which uses weather forecasts):
      perfect: what actually happened (the best a weather forecast can do),
      normal:  the normal of the calendar day (no weather information at all).
The expected spot over the next 28 days and over the next calendar month is compared with what the spot did, with the
month-ahead forward of that day (data/history/fr_market_series.json, M+1) and with a naive "last 7 days" price.

Writes data/history/index_backtest.json and prints the summary.
    python scripts/backtest_index.py
"""
import bisect
import json
import math
import os
from datetime import date, timedelta

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')


def load(name):
    with open(os.path.join(H, name)) as f:
        return json.load(f)


def main():
    rows = {}
    for r in load(os.path.join('rte', 'fr_daily.json'))['rows']:
        if r.get('loadAvg') and r.get('base') is not None:
            rows[r['d']] = r                          # the last row of a day wins (consolidated over real-time)
    days = sorted(rows)
    cs = load('commodities_series.json')['series']
    ttf, eua = cs['ttf']['points'], cs['eua']['points']
    tk, ek = [p[0] for p in ttf], [p[0] for p in eua]

    def at(keys, pts, d):
        i = bisect.bisect_right(keys, d) - 1
        return pts[i][1] if i >= 0 else None

    ms = load('fr_market_series.json')
    fwd_pts = [(d, v) for d, v in zip(ms['dates'], ms['forwardCurve']['M+1']) if v is not None]
    fk = [x[0] for x in fwd_pts]

    def srmc(d):
        g, e = at(tk, ttf, d), at(ek, eua, d)
        return None if g is None or e is None else g / 0.55 + 0.37 * e

    def low_carbon(r):
        return (r.get('nuclearAvg') or 0) + (r.get('hydroAvg') or 0) + (r.get('windAvg') or 0) + (r.get('solarAvg') or 0) + (r.get('bioAvg') or 0)

    def weekend(d):
        return date.fromisoformat(d).weekday() >= 5

    def curve(cov, s, a, b, w, we):
        return s / (1 + math.exp(-(a - b * (cov - 100)))) * (1 - w * we)

    def fit(train):
        C = np.array([x[0] for x in train]); S = np.array([x[1] for x in train]); P = np.array([x[2] for x in train]); W = np.array([x[3] for x in train])
        best = None
        for a in np.arange(-2, 7.01, 0.25):
            for b in np.arange(0.04, 0.401, 0.01):
                base = S / (1 + np.exp(-(a - b * (C - 100))))
                for w in (0, 0.1, 0.2, 0.3):
                    e = np.mean(np.abs(base * (1 - w * W) - P))
                    if best is None or e < best[0]:
                        best = (e, a, b, w)
        return best

    out = []
    d = date(2024, 1, 1)
    last_day = date.fromisoformat(days[-1])
    while d + timedelta(days=28) <= last_day:
        D = d.isoformat()
        y0 = (d - timedelta(days=3 * 365)).isoformat()
        train = []
        for x in days:
            if y0 <= x < D:
                s = srmc(x)
                if s:
                    train.append(((low_carbon(rows[x])) / rows[x]['loadAvg'] * 100, s, rows[x]['base'], 1 if weekend(x) else 0))
        if len(train) < 600:
            d += timedelta(days=7)
            continue
        _, a, b, w = fit(train)
        # normals of the calendar day over the three years before (consumption, hydro, bio, wind, solar)
        norm = {}
        for x in days:
            if y0 <= x < D:
                k, r = x[5:], rows[x]
                o = norm.setdefault(k, [0, 0, 0, 0, 0, 0])
                o[0] += 1; o[1] += r['loadAvg']; o[2] += r.get('hydroAvg') or 0; o[3] += r.get('bioAvg') or 0; o[4] += r.get('windAvg') or 0; o[5] += r.get('solarAvg') or 0
        prev = [x for x in days if x < D][-1]
        nuc, s0 = rows[prev].get('nuclearAvg') or 0, srmc(prev)
        ahead = [(d + timedelta(days=i)).isoformat() for i in range(1, 29)]
        ahead = [x for x in ahead if x in rows]
        if len(ahead) < 25 or not s0:
            d += timedelta(days=7)
            continue
        perf, nrm, real = [], [], []
        for x in ahead:
            o = norm.get(x[5:])
            if not o or not o[0]:
                continue
            n = o[0]; hy, bi = o[2] / n, o[3] / n
            r = rows[x]
            cov_p = (nuc + hy + bi + (r.get('windAvg') or 0) + (r.get('solarAvg') or 0)) / r['loadAvg'] * 100
            cov_n = (nuc + hy + bi + o[4] / n + o[5] / n) / (o[1] / n) * 100
            we = 1 if weekend(x) else 0
            perf.append((x, curve(cov_p, s0, a, b, w, we))); nrm.append((x, curve(cov_n, s0, a, b, w, we))); real.append((x, r['base']))
        m = lambda v: sum(t[1] for t in v) / len(v)
        past = [x for x in days if x < D][-14:]
        res14 = []
        for x in past:
            sx = srmc(x)
            if sx:
                res14.append(rows[x]['base'] - curve(low_carbon(rows[x]) / rows[x]['loadAvg'] * 100, sx, a, b, w, 1 if weekend(x) else 0))
        corr = sum(res14) / len(res14) if res14 else 0
        last7 = [rows[x]['base'] for x in days if x < D][-7:]
        # the next calendar month: its forward on day D against what it did
        nm = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
        mk = nm.strftime('%Y-%m')
        rm = [rows[x]['base'] for x in days if x.startswith(mk)]
        pm = [v for x, v in perf if x.startswith(mk)]
        nmm = [v for x, v in nrm if x.startswith(mk)]
        fi = bisect.bisect_right(fk, prev) - 1
        fw = fwd_pts[fi][1] if fi >= 0 and (date.fromisoformat(prev) - date.fromisoformat(fk[fi])).days <= 5 else None
        out.append({'d': D, 'a': round(a, 2), 'b': round(b, 3), 'w': w, 'real4': round(m(real), 2), 'perf4': round(m(perf), 2), 'norm4': round(m(nrm), 2), 'corr': round(corr, 2), 'perfC': round(m(perf) + corr, 2), 'normC': round(m(nrm) + corr, 2), 'perfH': round(m(perf) + corr / 2, 2), 'normH': round(m(nrm) + corr / 2, 2), 'naive': round(sum(last7) / len(last7), 2),
                    'month': mk, 'realM': round(sum(rm) / len(rm), 2) if len(rm) > 20 else None, 'fwdM': fw,
                    'perfM': round(sum(pm) / len(pm), 2) if len(pm) >= 10 else None, 'normM': round(sum(nmm) / len(nmm), 2) if len(nmm) >= 10 else None, 'nM': len(pm),
                    'perfMC': round(sum(pm) / len(pm) + corr, 2) if len(pm) >= 10 else None, 'normMC': round(sum(nmm) / len(nmm) + corr, 2) if len(nmm) >= 10 else None})
        d += timedelta(days=7)

    def mae(k1, k2):
        v = [abs(r[k1] - r[k2]) for r in out if r.get(k1) is not None and r.get(k2) is not None]
        return round(sum(v) / len(v), 1) if v else None

    def bias(k1, k2):
        v = [r[k1] - r[k2] for r in out if r.get(k1) is not None and r.get(k2) is not None]
        return round(sum(v) / len(v), 1) if v else None

    def hit(kp):
        # when the index says dearer (cheaper) than the forward, did the month come in dearer (cheaper) than the forward?
        v = [(r[kp] - r['fwdM'], r['realM'] - r['fwdM']) for r in out if r.get(kp) is not None and r.get('fwdM') and r.get('realM') is not None]
        big = [x for x in v if abs(x[0]) >= 10]
        return {'n': len(v), 'hit': round(sum(1 for a, b in v if a * b > 0) / len(v) * 100, 0) if v else None,
                'n_gap10': len(big), 'hit_gap10': round(sum(1 for a, b in big if a * b > 0) / len(big) * 100, 0) if big else None}

    summ = {
        'points': len(out), 'from': out[0]['d'] if out else None, 'to': out[-1]['d'] if out else None,
        'next28': {'mae_perfect': mae('perf4', 'real4'), 'mae_normal': mae('norm4', 'real4'), 'mae_naive': mae('naive', 'real4'),
                   'mae_perfect_corrected': mae('perfC', 'real4'), 'mae_normal_corrected': mae('normC', 'real4'), 'mae_perfect_half': mae('perfH', 'real4'), 'mae_normal_half': mae('normH', 'real4'),
                   'bias_perfect': bias('perf4', 'real4'), 'bias_normal': bias('norm4', 'real4')},
        'next_month': {'mae_forward': mae('fwdM', 'realM'), 'mae_perfect': mae('perfM', 'realM'), 'mae_normal': mae('normM', 'realM'), 'mae_perfect_corrected': mae('perfMC', 'realM'), 'mae_normal_corrected': mae('normMC', 'realM'),
                       'bias_forward': bias('fwdM', 'realM'), 'bias_perfect': bias('perfM', 'realM')},
        'direction_vs_forward': {'perfect': hit('perfM'), 'normal': hit('normM'), 'perfect_corrected': hit('perfMC'), 'normal_corrected': hit('normMC')},
    }
    with open(os.path.join(H, 'index_backtest.json'), 'w') as f:
        json.dump({'method': __doc__.strip().split('\n\n')[0], 'summary': summ, 'points': out}, f, separators=(',', ':'))
    print(json.dumps(summ, indent=1))


if __name__ == '__main__':
    main()
