#!/usr/bin/env python3
"""Day-ahead prices in France, today and tomorrow: the chance of a negative price each hour, and the price.

What drives a negative price is the share of demand left once solar, wind and nuclear are served:
  R = (load − solar − wind − nuclear) ÷ load          (RTE éCO2mix actuals, data/history/fr_hourly)
nuclear = the nuclear AVAILABLE (highest hourly output of the week before: its output drops when prices go
negative, so the output itself hides the surplus). The same share for Germany (exports), the solar share,
weekend, hour and month feed a logistic regression on the last three years, recent days weighing more
(half-life one year: batteries and flexible demand change the market).

Forecast: solar, wind and load of the day-ahead forecast published by the TSO (data/forecast.json,
ENTSO-E via Energy-Charts); nuclear available as above.

Skill: replayed month by month since January 2025, each month predicted from the months before it with
the ACTUAL solar, wind and load (so forecast errors of the weather are not counted) and the nuclear of
the week before. Brier score against the frequency of the same month and hour in past years; daily
count of negative hours predicted vs real.

Writes data/neg_forecast.json          python scripts/neg_forecast.py
"""
import json
import math
import os

import numpy as np
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history', 'fr_hourly')
OUT = os.path.join(ROOT, 'data', 'neg_forecast.json')
HALF = 365.0
RH = os.path.join(ROOT, 'data', 'history', 'region_hourly')


def rows(y0):
    out = []
    for y in range(y0, date.today().year + 1):
        p = os.path.join(H, f'{y}.json')
        if not os.path.exists(p):
            continue
        de = {}
        q = os.path.join(RH, f'{y}.json')
        if os.path.exists(q):
            c = json.load(open(q))['countries'].get('DE', {})
            de = {d: (c['s'].get(d), c['w'].get(d), c['l'].get(d)) for d in c.get('l', {})}
        for d, r in sorted(json.load(open(p))['days'].items()):
            if not all(k in r for k in ('s', 'w', 'l', 'n', 'p')):
                continue
            r = dict(r); r['de'] = de.get(d)
            out.append((d, r))
    return out


def nuclear_avail(hist, d, days=7):
    """nuclear available = highest hourly output of the `days` days before day d − 1 (output itself drops when prices go negative)"""
    t = date.fromisoformat(d); v = []
    for k in range(2, 2 + days):
        r = hist.get((t - timedelta(days=k)).isoformat())
        if r:
            v += [x for x in r['n'] if x is not None]
    return max(v) if v else None


def feats(d, h, s, w, l, nav, de):
    """features of one hour: French residual share with nuclear available, German residual share, solar share, calendar"""
    R = (l - s - w - nav) / l
    if de and None not in (de[0][h], de[1][h], de[2][h]) and de[2][h]:
        Rd = (de[2][h] - de[0][h] - de[1][h]) / de[2][h]; has = 1.0
    else:
        Rd = 0.0; has = 0.0
    we = 1.0 if date.fromisoformat(d).weekday() >= 5 else 0.0
    m = int(d[5:7])
    return [1.0, R, min(R, 0) ** 2, Rd * has, min(Rd, 0) ** 2 * has, has, s / l, we, we * s / l,
            math.sin(2 * math.pi * h / 24), math.cos(2 * math.pi * h / 24), math.sin(2 * math.pi * m / 12), math.cos(2 * math.pi * m / 12), R * Rd * has]


def dataset(data, hist, d0, d1):
    X, y, w, keys = [], [], [], []
    t1 = date.fromisoformat(d1)
    for d, r in data:
        if not d0 <= d < d1:
            continue
        nav = nuclear_avail(hist, d)
        if nav is None:
            continue
        for h in range(24):
            l, p, s_, w_ = r['l'][h], r['p'][h], r['s'][h], r['w'][h]
            if None in (l, p, s_, w_) or not l:
                continue
            X.append(feats(d, h, s_, w_, l, nav, r['de'])); y.append(1.0 if p < 0 else 0.0)
            w.append(0.5 ** ((t1 - date.fromisoformat(d)).days / HALF)); keys.append((d, h))
    return np.array(X), np.array(y), np.array(w), keys


def logit(X, y, w, lam=1.0, it=30):
    """weighted logistic regression, Newton steps with a small ridge"""
    b = np.zeros(X.shape[1])
    for _ in range(it):
        z = np.clip(X @ b, -30, 30); p = 1 / (1 + np.exp(-z))
        g = X.T @ (w * (p - y)) + lam * b
        Hm = (X * (w * p * (1 - p))[:, None]).T @ X + lam * np.eye(X.shape[1])
        step = np.linalg.solve(Hm, g); b -= step
        if np.abs(step).max() < 1e-6:
            break
    return b


def predict(b, X):
    return 1 / (1 + np.exp(-np.clip(X @ b, -30, 30)))


# ── day-ahead price: ridge regression, the level of the last week, gas and CO2 cost of a gas plant, the
#    residual shares of France (nuclear available) and Germany, solar share, calendar; trained on two years
CS = os.path.join(ROOT, 'data', 'history', 'commodities_series.json')


def _asof(pts, d):
    lo, hi, ans = 0, len(pts) - 1, None
    while lo <= hi:
        m = (lo + hi) // 2
        if pts[m][0] < d:
            ans = pts[m][1]; lo = m + 1
        else:
            hi = m - 1
    return ans


def price_feats(hist, fuel_pts, d, h, s, w, l, nav, de):
    if None in (s, w, l) or not l:
        return None
    t = date.fromisoformat(d)
    prev = [hist.get((t - timedelta(days=k)).isoformat()) for k in range(2, 9)]   # known before the auction: D-2 and before
    pm = [x for pp in prev if pp for x in pp['p'] if x is not None]
    ph = [pp['p'][h] for pp in prev if pp and pp['p'][h] is not None]
    ttf, eua = _asof(fuel_pts[0], d), _asof(fuel_pts[1], d)
    if len(pm) < 48 or not ph or ttf is None or eua is None:
        return None
    fuel = 2.0 * ttf + 0.37 * eua
    R = (l - s - w - nav) / l
    Rd = 0.0
    if de and None not in (de[0][h], de[1][h], de[2][h]) and de[2][h]:
        Rd = (de[2][h] - de[0][h] - de[1][h]) / de[2][h]
    we = 1.0 if t.weekday() >= 5 else 0.0
    return [1, float(np.mean(pm)), float(np.mean(ph)), fuel, fuel * max(R, -1), R, max(R, 0) * fuel, min(R, 0), Rd, Rd * fuel, s / l, we,
            math.sin(2 * math.pi * h / 24), math.cos(2 * math.pi * h / 24), we * s / l]


def ridge(A, Y):
    sc = A.std(0); sc[sc == 0] = 1
    lam = 1e-2 * np.eye(A.shape[1]); lam[0, 0] = 0
    return np.linalg.solve((A / sc).T @ (A / sc) + len(A) * lam, (A / sc).T @ Y) / sc


def price_model(data, hist):
    cs = json.load(open(CS))['series']; fuel = (cs['ttf']['points'], cs['eua']['points'])
    X, Y, K = [], [], []
    for d, r in data:
        if d < '2023-01-01':
            continue
        nav = nuclear_avail(hist, d)
        if nav is None:
            continue
        for h in range(24):
            f = price_feats(hist, fuel, d, h, r['s'][h], r['w'][h], r['l'][h], nav, r['de'])
            if f is None or r['p'][h] is None:
                continue
            X.append(f); Y.append(r['p'][h]); K.append(d)
    X, Y = np.array(X), np.array(Y)
    err, naive = [], []
    for m in sorted({k[:7] for k in K if k >= '2025-01'}):
        tr = np.array([m + '-01' > k >= str(int(m[:4]) - 2) + m[4:] for k in K]); te = np.array([k[:7] == m for k in K])
        b = ridge(X[tr], Y[tr]); err += list(np.abs(X[te] @ b - Y[te]))
    for d, r in data:
        if d >= '2025-01':
            p2 = hist.get((date.fromisoformat(d) - timedelta(days=2)).isoformat())
            if p2:
                naive += [abs(a - b) for a, b in zip(r['p'], p2['p']) if a is not None and b is not None]
    last = K[-1]
    b = ridge(X[[k >= str(int(last[:4]) - 2) + last[4:] for k in K]], Y[[k >= str(int(last[:4]) - 2) + last[4:] for k in K]])
    skill = {'mae': round(float(np.mean(err)), 2), 'naive_mae': round(float(np.mean(naive)), 2), 'from': '2025-01'}
    return b, fuel, skill


def fc_days_hint():
    try:
        return list(json.load(open(os.path.join(ROOT, 'data', 'forecast.json')))['zones']['FR']['days'])
    except (OSError, ValueError, KeyError):
        return []


def main():
    data = rows(2022)
    hist = dict(data)
    # ── replay since January 2025
    months = sorted({d[:7] for d, _ in data if d >= '2025-01'})
    brier = brier0 = 0.0; nb = 0; daily = []
    clim = {}
    for d, r in data:
        for h in range(24):
            if r['p'][h] is not None:
                a = clim.setdefault((d[:4], d[5:7], h), [0, 0]); a[0] += r['p'][h] < 0; a[1] += 1
    for m in months:
        y0 = str(int(m[:4]) - 3) + m[4:]
        Xt, yt, wt, _ = dataset(data, hist, y0, m + '-01')
        b = logit(Xt, yt, wt)
        nxt = (date.fromisoformat(m + '-01') + timedelta(days=32)).isoformat()[:7] + '-01'
        Xv, yv, _, kv = dataset(data, hist, m + '-01', nxt)
        if not len(yv):
            continue
        pv = predict(b, Xv); per = {}
        for (d, h), q, o in zip(kv, pv, yv):
            past = [clim.get((str(yy), d[5:7], h)) for yy in range(int(d[:4]) - 3, int(d[:4]))]
            past = [x for x in past if x and x[1]]
            q0 = sum(x[0] for x in past) / sum(x[1] for x in past) if past else 0.0
            brier += (q - o) ** 2; brier0 += (q0 - o) ** 2; nb += 1
            a = per.setdefault(d, [0.0, 0.0]); a[0] += q; a[1] += o
        daily += [(d, v[0], v[1]) for d, v in sorted(per.items())]
    days_neg = [x for x in daily if x[2] > 0]
    skill = {
        'from': months[0] if months else None, 'to': daily[-1][0] if daily else None, 'hours': nb,
        'brier': round(brier / nb, 4) if nb else None, 'brier_climatology': round(brier0 / nb, 4) if nb else None,
        'skill_vs_climatology': round(1 - brier / brier0, 3) if brier0 else None,
        'daily_count_mae': round(sum(abs(p - a) for _, p, a in daily) / len(daily), 2) if daily else None,
        'days_with_negatives': len(days_neg),
        'caught': round(sum(1 for _, p, a in days_neg if p >= 1) / len(days_neg), 3) if days_neg else None,
        'false_alarms': round(sum(1 for _, p, a in daily if p >= 1 and a == 0) / max(1, sum(1 for _, p, a in daily if p >= 1)), 3),
    }
    monthly = {}
    for d, p, a in daily:
        o = monthly.setdefault(d[:7], [0.0, 0.0]); o[0] += p; o[1] += a
    # ── forecast for today and tomorrow
    last = data[-1][0]
    X, Y, W, _ = dataset(data, hist, str(int(last[:4]) - 3) + last[4:], (date.fromisoformat(last) + timedelta(days=1)).isoformat())
    b = logit(X, Y, W)
    PF = price_model(data, hist)
    rawp = {}
    for y in {d[:4] for d in fc_days_hint()}:
        try:
            rawp.update({k: v.get('p') for k, v in json.load(open(os.path.join(H, f'{y}.json')))['days'].items()})
        except OSError:
            pass
    fc = json.load(open(os.path.join(ROOT, 'data', 'forecast.json')))
    fr, dez = fc['zones']['FR']['days'], fc['zones'].get('DE_LU', {}).get('days', {})
    out_days = {}

    def hr(a):
        step = len(a) // 24 or 1
        return [None if not [x for x in a[h * step:(h + 1) * step] if x is not None] else sum(x for x in a[h * step:(h + 1) * step] if x is not None) / len([x for x in a[h * step:(h + 1) * step] if x is not None]) for h in range(24)]
    # tomorrow in the morning: the TSO load is out (ENTSO-E), wind and solar only late afternoon → PowerKlock's weather
    # forecast for them (data/fr_fc_combined.json, scripts/fcst_live.py), flagged in the output
    try:
        comb = json.load(open(os.path.join(ROOT, 'data', 'fr_fc_combined.json'))).get('days', {})
    except (OSError, ValueError):
        comb = {}
    for d in sorted(fr):
        z = dict(fr[d]); src = 'tso'
        for k in ('solar', 'wind'):
            mid = ((comb.get(d) or {}).get(k) or {}).get('mid')
            if not z.get(k) and mid and sum(x is not None for x in mid) >= 20:
                z[k] = mid; src = 'weather'
        if not all(k in z and z[k] for k in ('solar', 'wind', 'load')):
            continue
        s_, w_, l_ = hr(z['solar']), hr(z['wind']), hr(z['load'])
        zd = dez.get(d, {}); de = (hr(zd['solar']), hr(zd['wind']), hr(zd['load'])) if all(zd.get(k) for k in ('solar', 'wind', 'load')) else None
        nav = nuclear_avail(hist, d) or nuclear_avail(hist, (date.fromisoformat(last) + timedelta(days=1)).isoformat())
        if nav is None:
            continue
        pr = [None if None in (s_[h], w_[h], l_[h]) or not l_[h] else round(float(predict(b, np.array([feats(d, h, s_[h], w_[h], l_[h], nav, de)]))[0]), 3) for h in range(24)]
        pp = [None if None in (s_[h], w_[h], l_[h]) else price_feats(hist, PF[1], d, h, s_[h], w_[h], l_[h], nav, de) for h in range(24)]
        price = [None if f is None else round(float(np.array(f) @ PF[0]), 1) for f in pp]
        out_days[d] = {'prob': pr, 'expected_hours': round(sum(x or 0 for x in pr), 1), 'nuclear_available': round(nav), 'price': price, 'inputs': src,
                       'actual': rawp.get(d)}
    out = {'updated': fc.get('updated'), 'method': __doc__.split('\n\n')[1].replace('\n', ' '),
           'source': 'RTE éCO2mix (history) · ENTSO-E day-ahead forecasts via Energy-Charts · ENTSO-E day-ahead prices',
           'days': out_days, 'skill': skill, 'price_skill': PF[2], 'replay_monthly': {k: [round(v[0], 1), int(v[1])] for k, v in sorted(monthly.items())}}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
    print(json.dumps(skill), {d: v['expected_hours'] for d, v in out_days.items()})


if __name__ == '__main__':
    main()
